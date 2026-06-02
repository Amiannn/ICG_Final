import * as THREE from "three";
import { WebGLPathTracer, GradientEquirectTexture } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js";
import { PixelArtPost } from "./post_pixelart.js";
import { mergeBillboardsToMesh } from "./merge_instances.js";

// 03 · Path-traced view of the Pixel Bonsai scene.
//
// Architectural constraints (see ICG_Final/03_ray_tracing/PLAN.md §3):
//   B1. three-gpu-pathtracer does NOT support InstancedMesh. We hide every
//       InstancedMesh in the scene on init (kills the 18k grass blades and
//       the tree's instanced foliage) and restore them on dispose. The tree
//       trunk/branches/core still trace — the foliage merge lives in M4.
//   B2. Only MeshStandardMaterial / MeshPhysicalMaterial are supported. We
//       swap every Mesh's material into a MeshStandardMaterial that copies
//       the visible diffuse colour, and put the original back on dispose.
//   B3. Built-in denoiser is weak. M5 will add OIDN as a post-process; for
//       now we just blit the path tracer output through ACES tonemap.
//
// B4 (look + speed). The path tracer only parses directional/point/spot/
//   rect-area lights (sceneUpdateUtils.getLights) — the scene's HemisphereLight
//   fill is silently dropped. With only the single hard sun and no environment
//   the result is flat diffuse (no ambient / GI / reflections) AND slow to
//   converge (one tiny light samples poorly). We attach a gradient sky→ground
//   environment so the path tracer gets image-based lighting: soft sky fill,
//   contact AO, colour bleed, and faster, cleaner convergence.
//
// The 01 camera is OrthographicCamera, which the path tracer doesn't handle.
// We build a temporary telephoto PerspectiveCamera (fov 30°, pulled back
// along the same eye offset) that approximates the iso framing.

const PERSP_FOV_DEG = 30;
const PERSP_DIST_SCALE = 2.0; // pull eye back so the narrow FOV roughly matches the ortho extent

// Sky / ground colours for the IBL gradient (replaces the dropped HemisphereLight).
const ENV_SKY_COLOR = 0xbfe0df; // palette.skyDay
const ENV_GROUND_COLOR = 0x6f8a52; // hemisphere groundColor (grassy fill)
const ENV_INTENSITY = 1.0; // fill + GI; replaces the dropped HemisphereLight (intensity 1.3), so vertical tree surfaces aren't left near-black
const SURFACE_ROUGHNESS = 0.7; // a touch glossy so the env actually reflects (sheen / RT cue)

let _state = null;

export const raytraceMode = {
  name: "raytrace",
  label: "Path Trace",

  init(ctx) {
    const { renderer, scene, world, pixel } = ctx;

    _state = {
      // restore on dispose
      toneMapping: renderer.toneMapping,
      autoClear: renderer.autoClear,
      prevEnvironment: scene.environment,
      prevEnvIntensity: scene.environmentIntensity,
      hidden: [], // [obj] visible flipped to false
      matSwap: [], // [{ obj, original }]
      merged: [], // [{ mesh, parent }] static stand-ins for instanced foliage/grass (M4)
      envTex: null, // generated gradient IBL, disposed on exit

      perspCam: null,
      pathTracer: null,
      bvhWorker: null,
      post: null, // M3 pixel-art post chain (cel + outline + low-res upscale)
      ready: false,
      hud: null, // sample-count overlay
      lastTargetWorld: new THREE.Vector3(),
      lastEyeWorld: new THREE.Vector3(),
    };

    // 1. Hide every InstancedMesh (grass + tree foliage), the Points dust
    //    cloud, and the procedural-shader water plane. Custom shaders aren't
    //    PBR so the path tracer can't see them anyway.
    scene.traverse((obj) => {
      if (!obj.visible) return;
      const shouldHide =
        obj.isInstancedMesh ||
        obj.isPoints ||
        (world.water && obj === world.water.mesh);
      if (shouldHide) {
        _state.hidden.push(obj);
        obj.visible = false;
      }
    });

    // 1b. (M4) Rebuild the hidden instanced billboards (tree canopy + grass) as
    //     static crossed-quad meshes the path tracer CAN render, so the foliage
    //     doesn't vanish. Parent each stand-in to the original's parent so it
    //     inherits the same world transform.
    for (const obj of _state.hidden) {
      if (!obj.isInstancedMesh || !obj.material || !obj.material.map || !obj.parent) continue;
      // Tree foliage gets leaf translucency (transmission); the ground grass
      // stays opaque so the 18k-blade canopy doesn't slow convergence — it's lit
      // fine sitting flat on the ground anyway.
      const translucent = obj !== world.grass;
      const mesh = mergeBillboardsToMesh(obj, { roughness: SURFACE_ROUGHNESS, translucent });
      obj.parent.add(mesh);
      _state.merged.push({ mesh, parent: obj.parent });
    }

    // 2. Swap MeshToonMaterial / ShaderMaterial → MeshStandardMaterial.
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.visible || !obj.material) return;
      const m = obj.material;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return;

      const std = new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map ?? null,
        transparent: !!m.transparent,
        alphaTest: m.alphaTest ?? 0,
        side: THREE.DoubleSide, // path tracer renders single-sided back-faces as black; LatheGeometry core normals point inward, so force double-sided
        roughness: SURFACE_ROUGHNESS,
        metalness: 0.0,
        envMapIntensity: 1.0,
      });
      _state.matSwap.push({ obj, original: m });
      obj.material = std;
    });

    // 3. Environment lighting. The path tracer ignores the HemisphereLight
    //    (see B4), so without this the scene is lit by the bare sun and looks
    //    flat. A gradient sky→ground equirect gives image-based fill + GI and
    //    converges much faster/cleaner than the lone directional light.
    const env = new GradientEquirectTexture(512);
    env.topColor.set(ENV_SKY_COLOR);
    env.bottomColor.set(ENV_GROUND_COLOR);
    env.exponent = 1.5;
    env.update();
    scene.environment = env;
    scene.environmentIntensity = ENV_INTENSITY;
    _state.envTex = env;

    // 4. Renderer setup. Tonemapping is done in the post chain's edge shader
    //    (in-shader ACES on the linear PT target), so keep the renderer itself
    //    on NoToneMapping to avoid double-grading.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;

    // 5. Build a perspective camera approximating the existing iso framing.
    const persp = new THREE.PerspectiveCamera(
      PERSP_FOV_DEG,
      renderer.domElement.clientWidth / renderer.domElement.clientHeight,
      0.5,
      200,
    );
    _state.perspCam = persp;
    this._syncCamera(ctx);

    // 6. Path tracer.
    //   renderToCanvas stays TRUE: this is the accumulation path proven to work
    //   on the target multi-GPU Windows setup. Going off-canvas regressed to
    //   60 fps / 0 spp (update() skipped every frame) on that hardware. The
    //   library blits its result to the canvas AND populates tracer.target.texture
    //   — we sample that same texture in the M3 pixel-art post chain and draw
    //   over the canvas, so the proven path is untouched and we still restyle.
    const tracer = new WebGLPathTracer(renderer);
    tracer.bounces = 4;
    tracer.multipleImportanceSampling = true;
    tracer.renderScale = 0.6;
    tracer.tiles.set(2, 2);
    tracer.renderToCanvas = true;
    tracer.filterGlossyFactor = 0.5; // clamp glossy fireflies -> faster perceptual convergence
    _state.pathTracer = tracer;

    // M3 post chain — renders the traced output in the pixel-art register.
    _state.post = new PixelArtPost(renderer);

    // Build the BVH on a web worker so switching into this mode doesn't freeze
    // the tab. setSceneAsync routes through generateAsync, which requires a BVH
    // worker registered via setBVHWorker (else it throws). GenerateMeshBVHWorker
    // is the single-worker variant — no SharedArrayBuffer / cross-origin
    // isolation needed, unlike ParallelMeshBVHWorker.
    const bvhWorker = new GenerateMeshBVHWorker();
    _state.bvhWorker = bvhWorker;
    tracer.setBVHWorker(bvhWorker);

    // 7. Sample-count HUD. The tracer accumulates over many frames, so surface
    //    the current spp and a "building BVH / converging / converged" state —
    //    without it the progressive refinement looks like it never finishes.
    _state.hud = this._buildHud();

    const p = tracer.setSceneAsync(scene, persp);
    if (p && typeof p.then === "function") {
      p.then(() => {
        _state.ready = true;
      });
    } else {
      _state.ready = true;
    }
  },

  render(ctx, time) {
    if (!_state || !_state.pathTracer) return;

    // Mirror current ortho camera into our perspective camera. If anything
    // moved, kick the accumulation.
    const moved = this._syncCamera(ctx);
    if (moved && _state.ready) _state.pathTracer.updateCamera();

    if (_state.ready) {
      _state.pathTracer.renderSample();

      // Post chain runs at the same low-res as the real-time view so the pixel
      // grid matches. uVertical resolution drives the block size.
      const { renderer, scene, settings } = ctx;
      const bufH = renderer.domElement.height;
      const bufW = renderer.domElement.width;
      const displayH = Math.max(1, settings.verticalResolution);
      const displayW = Math.max(1, Math.round(displayH * (bufW / bufH)));
      _state.post.setSize(displayW, displayH);

      const outline = settings.outlines ? settings.outlineStrength : 0;
      _state.post.render({
        colorTex: _state.pathTracer.target.texture,
        scene,
        camera: _state.perspCam,
        outline,
        grain: settings.grain,
        time,
      });
    }
    this._updateHud();
  },

  dispose(ctx) {
    if (!_state) return;
    const { renderer } = ctx;

    // three-gpu-pathtracer@0.0.23 has a bug: dispose() reads this._renderQuad,
    // which is never assigned (the field is named this._quad), so the call
    // always throws. Try the official dispose, then fall back to cleaning up
    // the resources it intended to free using the real field names.
    if (_state.pathTracer) {
      try {
        _state.pathTracer.dispose();
      } catch {
        _state.pathTracer._quad?.dispose?.();
        _state.pathTracer._quad?.material?.dispose?.();
        _state.pathTracer._pathTracer?.dispose?.();
      }
    }

    // Free the pixel-art post chain (render targets + shader materials).
    if (_state.post) _state.post.dispose();

    // Terminate the BVH worker so we don't leak a worker thread per mode switch.
    if (_state.bvhWorker) _state.bvhWorker.dispose?.();

    // Remove the M4 static foliage stand-ins and free their GPU buffers.
    for (const { mesh, parent } of _state.merged) {
      parent.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }

    for (const obj of _state.hidden) obj.visible = true;
    for (const { obj, original } of _state.matSwap) {
      if (obj.material && obj.material !== original) obj.material.dispose();
      obj.material = original;
    }

    // Restore the scene's environment lighting and free the generated gradient.
    ctx.scene.environment = _state.prevEnvironment;
    ctx.scene.environmentIntensity = _state.prevEnvIntensity;
    if (_state.envTex) _state.envTex.dispose();

    if (_state.hud) _state.hud.remove();

    renderer.toneMapping = _state.toneMapping;
    renderer.autoClear = _state.autoClear;

    _state = null;
  },

  // --- helpers (bound via this in init/render) ---

  _buildHud() {
    const el = document.createElement("div");
    el.id = "pt-hud";
    el.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:20",
      "padding:8px 12px",
      "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace",
      "color:#cdeae8",
      "background:rgba(8,18,20,0.72)",
      "border:1px solid rgba(120,200,195,0.35)",
      "border-radius:8px",
      "pointer-events:none",
      "white-space:pre",
    ].join(";");
    el.textContent = "Path trace\nbuilding BVH…";
    document.body.appendChild(el);
    return el;
  },

  _updateHud() {
    const el = _state.hud;
    if (!el) return;
    if (!_state.ready) {
      el.textContent = "Path trace\nbuilding BVH…";
      return;
    }
    const spp = Math.floor(_state.pathTracer.samples || 0);
    const status = spp >= 64 ? "converged" : spp <= 1 ? "tracing…" : "converging…";
    el.textContent = `Path trace · ${status}\n${spp} spp`;
  },

  _syncCamera(ctx) {
    const persp = _state.perspCam;
    const target = ctx.pixel.desiredTarget;
    const eyeOffset = ctx.pixel.eyeOffset;

    const eye = eyeOffset.clone().normalize().multiplyScalar(eyeOffset.length() * PERSP_DIST_SCALE);
    const eyePos = target.clone().add(eye);

    const aspect = ctx.renderer.domElement.clientWidth / ctx.renderer.domElement.clientHeight;
    let dirty = false;
    if (Math.abs(persp.aspect - aspect) > 1e-4) {
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      dirty = true;
    }
    if (!_state.lastEyeWorld.equals(eyePos) || !_state.lastTargetWorld.equals(target)) {
      persp.position.copy(eyePos);
      persp.lookAt(target);
      persp.updateMatrixWorld();
      _state.lastEyeWorld.copy(eyePos);
      _state.lastTargetWorld.copy(target);
      dirty = true;
    }
    return dirty;
  },
};
