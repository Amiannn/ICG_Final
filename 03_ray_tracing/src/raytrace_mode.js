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

const PERSP_FOV_DEG = 33;
const PERSP_DIST_SCALE = 2.05; // pull eye back so the narrow FOV roughly matches the ortho extent
const TARGET_POND_BIAS = 0.16; // shift the look-at slightly toward the pond so the reflective water reads in frame

// Pixel-art outline strength used in path-trace mode when the user hasn't set the
// outline slider (its global default is 0). The cel-quantise + ink-edge pass is
// the whole point of the pixel-art register, so default it ON here for character;
// dragging the slider still overrides, and toggling Outlines off still kills it.
const PT_OUTLINE_DEFAULT = 1.2;

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
      photoreal: false, // report hero-shot: bypass pixel-art post (PLAN item 9)
      photorealBtn: null,
      lastTargetWorld: new THREE.Vector3(),
      lastEyeWorld: new THREE.Vector3(),
    };

    // 1. Hide every InstancedMesh (grass + tree foliage) and the Points dust
    //    cloud — instancing isn't supported (B1) and the dust is a custom shader.
    //    The water plane is NOT hidden anymore: it gets a real reflective
    //    material below (see 2b) so the path tracer can render true reflections.
    scene.traverse((obj) => {
      if (!obj.visible) return;
      if (obj.isInstancedMesh || obj.isPoints) {
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
      if (obj === world.grass) {
        // Ground grass: a single cheap alpha-cutout cross (lit fine flat on the
        // ground, and seeing the ground through blade gaps is correct).
        const mesh = mergeBillboardsToMesh(obj, { roughness: SURFACE_ROUGHNESS, foliage: false });
        obj.parent.add(mesh);
        _state.merged.push({ mesh, parent: obj.parent });
        continue;
      }
      // Tree canopy: two layers. A solid inner filler sized just inside the
      // leaves so see-through gaps reveal soft shadowed green (never black), plus
      // a leafy alpha-cutout outer shell that restores the sprig silhouette and
      // tier separation of the real-time view.
      const inner = mergeBillboardsToMesh(obj, {
        roughness: SURFACE_ROUGHNESS,
        foliage: true,
        cutout: false,
        sizeScale: 1.15,
      });
      const outer = mergeBillboardsToMesh(obj, {
        roughness: SURFACE_ROUGHNESS,
        foliage: true,
        cutout: true,
        sizeScale: 1.5,
      });
      obj.parent.add(inner, outer);
      _state.merged.push({ mesh: inner, parent: obj.parent }, { mesh: outer, parent: obj.parent });
    }

    // 1c. Path-traced water. The real-time pond is a custom planar-reflection
    //     shader; here we hand the path tracer a near-mirror MeshPhysicalMaterial
    //     so it computes *true* reflections of the sky env + tree (the showcase
    //     the real-time fake approximates). Opaque + low roughness reads as a
    //     calm reflective pond; we don't add transmission because there is no
    //     pond-floor geometry, so a see-through surface would reveal the world
    //     background like a hole. Swapped before the generic pass below so that
    //     pass skips it; restored from matSwap on dispose.
    if (world.water && world.water.mesh) {
      const wm = world.water.mesh;
      const waterMat = new THREE.MeshPhysicalMaterial({
        color: 0x35787f, // deep teal tint where the dielectric isn't reflecting
        roughness: 0.07, // near-mirror; a touch of roughness tames fireflies
        metalness: 0.0,
        ior: 1.33, // water — Fresnel reflects strongly at the grazing pond angle
        side: THREE.DoubleSide,
      });
      _state.matSwap.push({ obj: wm, original: wm.material });
      wm.material = waterMat;
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
    // Sampling (PLAN item 7). three-gpu-pathtracer's PhysicalPathTracingMaterial
    // already defaults to RANDOM_TYPE = 2 (stratified-list sampling), the
    // higher-quality, lower-variance option — the spiritual sibling of the
    // Owen-scrambled Sobol sequence used in the term-project CPU tracer. We
    // deliberately keep it: RANDOM_TYPE 1 (Sobol) is documented in the library to
    // break the shader compiler on macOS, and 0 (PCG) is noisier. So stratified
    // sampling is confirmed active by default; no override is needed.
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
    _state.photorealBtn = this._buildPhotorealToggle();

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

      if (_state.photoreal) {
        // Report hero shot: raw ACES-tonemapped radiance at full resolution,
        // no cel/outline/pixelation (PLAN item 9).
        _state.post.renderPhotoreal(_state.pathTracer.target.texture);
      } else {
        // Post chain runs at the same low-res as the real-time view so the pixel
        // grid matches. uVertical resolution drives the block size.
        const { renderer, scene, settings } = ctx;
        const bufH = renderer.domElement.height;
        const bufW = renderer.domElement.width;
        const displayH = Math.max(1, settings.verticalResolution);
        const displayW = Math.max(1, Math.round(displayH * (bufW / bufH)));
        _state.post.setSize(displayW, displayH);

        const outline = settings.outlines
          ? settings.outlineStrength > 0
            ? settings.outlineStrength
            : PT_OUTLINE_DEFAULT
          : 0;
        _state.post.render({
          colorTex: _state.pathTracer.target.texture,
          scene,
          camera: _state.perspCam,
          outline,
          grain: settings.grain,
          time,
        });
      }
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
    if (_state.photorealBtn) _state.photorealBtn.remove();

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

  // Report hero-shot toggle (PLAN item 9). Flips between the pixel-art post
  // chain and the raw ACES/sRGB photoreal blit. Sits just above the spp HUD.
  _buildPhotorealToggle() {
    const btn = document.createElement("button");
    btn.id = "pt-photoreal";
    btn.type = "button";
    btn.textContent = "◻ Photoreal";
    btn.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:64px",
      "z-index:21",
      "padding:6px 12px",
      "font:12px/1.2 ui-monospace,Menlo,Consolas,monospace",
      "color:#cdeae8",
      "background:rgba(8,18,20,0.72)",
      "border:1px solid rgba(120,200,195,0.35)",
      "border-radius:8px",
      "cursor:pointer",
    ].join(";");
    btn.addEventListener("click", () => {
      if (!_state) return;
      _state.photoreal = !_state.photoreal;
      btn.textContent = _state.photoreal ? "◼ Photoreal" : "◻ Photoreal";
      btn.style.color = _state.photoreal ? "#fff2c8" : "#cdeae8";
    });
    document.body.appendChild(btn);
    return btn;
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
    const look = _state.photoreal ? "photoreal" : "pixel-art";
    el.textContent = `Path trace · ${status} · ${look}\n${spp} spp`;
  },

  _syncCamera(ctx) {
    const persp = _state.perspCam;
    const eyeOffset = ctx.pixel.eyeOffset;

    // Pan the look-at slightly toward the pond so the reflective water reads in
    // frame (the tree alone leaves it cut off at the edge). This translates both
    // eye and target by the same delta, so it's a pan, not a rotation.
    const target = ctx.pixel.desiredTarget.clone();
    if (ctx.world && ctx.world.water) {
      target.lerp(ctx.world.water.center, TARGET_POND_BIAS);
    }

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
