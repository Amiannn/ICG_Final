import * as THREE from "three";
import { WebGLPathTracer, PhysicalCamera } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js";
import { PixelArtPost } from "./post_pixelart.js";
import { mergeBillboardsToMesh, buildFoliageBlocks } from "./merge_instances.js";
import { makeSkyEnv } from "./sky_env.js";
import { makeWaterNormal } from "./detail_textures.js";

// 03 · Path-traced view of the Pixel Bonsai scene.
//
// Design (rewritten 2026-06-04 to match the real-time look):
//
//   Take the real-time scene as-is — minus the cel toon ramp, the procedural
//   cloud-shadow injection, the depth/normal outline pass, and the low-res
//   nearest-upscale composite. Let the path tracer compute the lighting (sun,
//   shadows, indirect bounce, soft AO, GI colour bleed). Then apply the ONE
//   piece of "pixel art" we want to keep: render into a low-resolution target
//   and blit it to the canvas with nearest sampling.
//
//   So the chunky pixel grain comes from the low-res render, and every other
//   visual is whatever the path tracer naturally produces from the realtime
//   scene's albedo + lights. Materials (B2): swap MeshToon/ShaderMaterial to
//   MeshStandardMaterial, copying the base colour over. InstancedMeshes (B1)
//   can't be traced, so we bake the foliage into solid 3D LEAF BLOCKS — small
//   thick boxes per sprig anchor, baked from the original per-instance colours
//   — and the grass into crossed alpha-cutout quads.
//
//   The path tracer doesn't handle the OrthographicCamera, so we drive a
//   matching telephoto PerspectiveCamera (narrow FOV, pulled back along the
//   same eye offset). The sun is a SNAPSHOT of the real-time DirectionalLight
//   at the moment the user entered PT mode (per user's choice): cycle/night/
//   rain were last applied to it by real-time, so PT shows that exact moment.

const PERSP_FOV_DEG = 33;
const PERSP_DIST_SCALE = 2.05; // pull eye back so the narrow FOV roughly matches the ortho extent
const MAX_SPP = 256; // stop accumulating once converged — beyond this the image barely changes but the GPU keeps running at full load. Camera motion resets samples to 0 and re-accumulates up to here.

let _state = null;

export const raytraceMode = {
  name: "raytrace",
  label: "Path Trace",

  init(ctx) {
    const { renderer, scene, world } = ctx;

    _state = {
      // restore on dispose
      toneMapping: renderer.toneMapping,
      autoClear: renderer.autoClear,
      hidden: [], // [obj] visible flipped to false
      matSwap: [], // [{ obj, original }]
      merged: [], // [{ mesh, parent }] static stand-ins for instanced foliage/grass

      perspCam: null,
      pathTracer: null,
      bvhWorker: null,
      post: null,
      ready: false,
      hud: null, // sample-count overlay
      lastTargetWorld: new THREE.Vector3(),
      lastEyeWorld: new THREE.Vector3(),
      lastTracerW: 0,
      lastTracerH: 0,
      lastTracerScale: 0,
    };

    // 1. Hide every InstancedMesh (grass + tree foliage) and Points dust cloud
    //    — neither is traceable. Also hide real-time-only helpers tagged
    //    shadowOnly (the canopy's colour-silent cast-shadow blobs would become
    //    solid blobs once material-swapped) and noReflect (animals, birds,
    //    rain splashes, campfire — live-scene-only decor).
    scene.traverse((obj) => {
      if (!obj.visible) return;
      const ud = obj.userData || {};
      if (obj.isInstancedMesh || obj.isPoints || ud.shadowOnly || ud.noReflect) {
        _state.hidden.push(obj);
        obj.visible = false;
      }
    });

    // 1b. Rebuild hidden instanced billboards as static path-traceable
    //     geometry. Tree canopy → DENSE VOXEL CLUSTERS of small leaf cubes
    //     per sprig (jagged Minecraft-shader silhouette) so PT renders crisp
    //     orthogonal sun/shadow on every chunk. Grass → cheap alpha-cutout
    //     crossed quads at the ground (a single thin layer reads fine for a
    //     flat carpet).
    for (const obj of _state.hidden) {
      if (!obj.isInstancedMesh || !obj.material || !obj.parent) continue;
      if (obj === world.grass) {
        if (!obj.material.map) continue;
        const mesh = mergeBillboardsToMesh(obj, { roughness: 0.95, foliage: false, sizeScale: 0.72 });
        obj.parent.add(mesh);
        _state.merged.push({ mesh, parent: obj.parent });
        continue;
      }
      // tree canopy → voxel cluster of small leaf cubes
      const blocks = buildFoliageBlocks(obj, {
        sizeScale: 1.0,
        blocksPerInst: 10,
        cubeRatio: 0.26,
        spread: 0.65,
        spreadY: 0.5,
      });
      obj.parent.add(blocks);
      _state.merged.push({ mesh: blocks, parent: obj.parent });
    }

    // 2. Swap MeshToonMaterial / ShaderMaterial → MeshStandardMaterial.
    //    PT only handles standard/physical materials; this keeps the realtime
    //    BASE colour intact so the lit picture comes out in the same palette.
    //    Water gets a MeshPhysicalMaterial with a CLEARCOAT layer instead — a
    //    proper dielectric water surface only reflects ~3% at iso angles, so a
    //    plain MeshStandard reads as a flat blue patch. The clearcoat adds a
    //    sharp Fresnel-driven reflection layer (sky / tree / hills mirrored on
    //    the surface) over the dark-teal body, with a ripple normal map
    //    breaking the reflection into water-like wavelets.
    if (world.water && world.water.mesh) {
      const wm = world.water.mesh;
      // The pond geometry has no UVs (custom triangle fan), so derive planar
      // ones from its local XY for the normal map repeat.
      const wg = wm.geometry;
      if (!wg.attributes.uv) {
        const wpos = wg.attributes.position;
        const uvArr = new Float32Array(wpos.count * 2);
        for (let i = 0; i < wpos.count; i++) {
          uvArr[2 * i] = wpos.getX(i) * 0.7;
          uvArr[2 * i + 1] = wpos.getY(i) * 0.7;
        }
        wg.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
        _state.waterAddedUV = true;
      }
      _state.waterNormalTex = makeWaterNormal(512);
      // Tinted near-metal water — realtime's planar reflection is essentially
      // a 90% mirror, so a physically-correct dielectric (~5% Fresnel at iso
      // angles) reads as flat colour. We push toward metal so the env + tree
      // mirror clearly. The pale teal tint then colours that reflection
      // toward "still pond water" instead of "chrome".
      const waterMat = new THREE.MeshPhysicalMaterial({
        color: 0xa8c8cc, // pale teal — tints the (dominant) reflection
        roughness: 0.05, // sharp mirror
        metalness: 0.7, // reflection-dominant, tinted by colour
        clearcoat: 1.0, // wet sheen on top
        clearcoatRoughness: 0.05,
        normalMap: _state.waterNormalTex,
        side: THREE.DoubleSide,
      });
      waterMat.normalScale.set(0.18, 0.18);
      _state.matSwap.push({ obj: wm, original: wm.material });
      wm.material = waterMat;
    }

    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.visible || !obj.material) return;
      if (world.water && obj === world.water.mesh) return; // already swapped above
      const m = obj.material;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return;

      const std = new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map ?? null,
        transparent: !!m.transparent,
        alphaTest: m.alphaTest ?? 0,
        // LatheGeometry (tree core) normals point inward; the cylindrical
        // trunk/branches and ground plane also benefit from double-sided
        // tracing for cheap "no black back-faces" robustness.
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.0,
      });

      _state.matSwap.push({ obj, original: m });
      obj.material = std;
    });

    // 3. Lighting. Photoreal-reference look (matching the user's reference
    //    image), not realtime's current cycle state:
    //
    //   • KEY = realtime DirectionalLight repointed to upper-right-back +
    //     warmed. Half-back lighting gives the reference's rim-lit right side
    //     of the tree and the dark front-left shadow. Snapshot prior state
    //     for safe restore on dispose.
    //   • FILL = a baked sky env (sky_env.js) — blue zenith → pale horizon
    //     with the sun disk at the SAME direction. PT importance-samples it,
    //     so shadows fill with cool sky instead of going pitch black, and
    //     glossy surfaces reflect a real sky.
    _state.prevSunPos = ctx.lighting.sun.position.clone();
    _state.prevSunColor = ctx.lighting.sun.color.clone();
    _state.prevSunIntensity = ctx.lighting.sun.intensity;
    _state.prevEnvironment = scene.environment;
    _state.prevEnvIntensity = scene.environmentIntensity;
    _state.prevBackground = scene.background;
    _state.prevFog = scene.fog;

    // Upper-right-back sun: rim-lights the +x face of the canopy while the
    // -x front-left falls into shadow, matching the reference's lighting axis.
    const ptSunDir = new THREE.Vector3(0.55, 0.78, -0.32).normalize();
    _state.ptSunDir = ptSunDir;
    ctx.lighting.sun.position.copy(ptSunDir).multiplyScalar(25);
    ctx.lighting.sun.color.setHex(0xfff0c8); // warm pale sun
    ctx.lighting.sun.intensity = 2.6; // softer key — was 4.0 (everything looked overlit)
    ctx.lighting.sun.target.position.set(0, 0, 0);
    ctx.lighting.sun.target.updateMatrixWorld();
    ctx.lighting.sun.updateMatrixWorld();

    const env = makeSkyEnv(ptSunDir, {
      skyIntensity: 0.42,
      sunColor: [1.0, 0.92, 0.72],
      sunIntensity: 3.5, // env sun mostly for sky reflection / sparkle; DirectionalLight is the diffuse key
      sunAngularDeg: 2.4,
      zenith: [0.18, 0.32, 0.55],
      horizon: [0.64, 0.74, 0.78],
      ground: [0.18, 0.22, 0.14],
    });
    scene.environment = env;
    // Lower env fill so shadow side actually reads as shadow (was 0.45 — too
    // much soft fill flattened the lighting into "all-lights-on" key+fill).
    scene.environmentIntensity = 0.22;
    _state.envTex = env;
    // Keep realtime's fog + background — atmospheric perspective on the hills
    // is exactly what the reference image shows.

    // 4. Renderer. We do ACES + sRGB ourselves in the pixel-blit shader, so
    //    keep three's built-in tonemap off to avoid double-grading.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;

    // 5. Telephoto PerspectiveCamera approximating the iso framing. NO depth
    //    of field — the realtime view has none, and DoF makes the pixel grid
    //    smear at near/far so it stops reading as pixel art.
    const persp = new PhysicalCamera(
      PERSP_FOV_DEG,
      renderer.domElement.clientWidth / renderer.domElement.clientHeight,
      0.5,
      200,
    );
    persp.fStop = 100; // effectively pinhole — no bokeh
    persp.apertureBlades = 0;
    _state.perspCam = persp;
    this._syncCamera(ctx);

    // 6. Path tracer. renderToCanvas=false so we own the output — the lib's
    //    internal blit upscales with LINEAR, which would defeat the chunky
    //    pixel-art look we want from low-res rendering.
    const tracer = new WebGLPathTracer(renderer);
    tracer.bounces = 5;
    tracer.multipleImportanceSampling = true;
    tracer.tiles.set(2, 2);
    tracer.renderToCanvas = false;
    tracer.filterGlossyFactor = 0.5;
    _state.pathTracer = tracer;
    this._applyTracerSize(ctx);

    _state.post = new PixelArtPost(renderer);

    const bvhWorker = new GenerateMeshBVHWorker();
    _state.bvhWorker = bvhWorker;
    tracer.setBVHWorker(bvhWorker);

    _state.hud = this._buildHud();

    const p = tracer.setSceneAsync(scene, persp);
    if (p && typeof p.then === "function") {
      p.then(() => {
        // Force NEAREST on the internal target so any downstream sampling we
        // didn't author (e.g. accidental linear reads) doesn't blur the
        // low-res pixels. Our own pixel-blit shader also snaps UVs, belt and
        // braces.
        const t = tracer.target?.texture;
        if (t) {
          t.minFilter = THREE.NearestFilter;
          t.magFilter = THREE.NearestFilter;
          t.needsUpdate = true;
        }
        _state.ready = true;
      });
    } else {
      _state.ready = true;
    }
  },

  render(ctx, time) {
    if (!_state || !_state.pathTracer) return;

    const moved = this._syncCamera(ctx);
    const resized = this._applyTracerSize(ctx);
    if ((moved || resized) && _state.ready) _state.pathTracer.updateCamera();

    if (_state.ready) {
      if (_state.pathTracer.samples < MAX_SPP) {
        _state.pathTracer.renderSample();
      }
      const t = _state.pathTracer.target;
      // The first frame may run before the tracer has sized its target — skip
      // the blit until width/height are non-zero (otherwise sampling a 0×0
      // texture paints the canvas pure black).
      if (t && t.width > 0 && t.height > 0) {
        _state.post.renderPixelBlit(t.texture, t.width, t.height, 0.8);
      }
    }
    this._updateHud();
  },

  dispose(ctx) {
    if (!_state) return;
    const { renderer } = ctx;

    if (_state.pathTracer) {
      try {
        _state.pathTracer.dispose();
      } catch {
        _state.pathTracer._quad?.dispose?.();
        _state.pathTracer._quad?.material?.dispose?.();
        _state.pathTracer._pathTracer?.dispose?.();
      }
    }
    if (_state.post) _state.post.dispose();
    if (_state.bvhWorker) _state.bvhWorker.dispose?.();

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

    // Restore lighting / env / fog snapshots (defensive — we didn't write
    // through, so these are no-ops in normal flow).
    if (_state.prevSunPos) ctx.lighting.sun.position.copy(_state.prevSunPos);
    if (_state.prevSunColor) ctx.lighting.sun.color.copy(_state.prevSunColor);
    if (_state.prevSunIntensity !== undefined) ctx.lighting.sun.intensity = _state.prevSunIntensity;
    ctx.lighting.sun.updateMatrixWorld();
    ctx.scene.environment = _state.prevEnvironment;
    ctx.scene.environmentIntensity = _state.prevEnvIntensity;
    ctx.scene.background = _state.prevBackground;
    ctx.scene.fog = _state.prevFog;
    if (_state.envTex) _state.envTex.dispose();
    if (_state.waterNormalTex) _state.waterNormalTex.dispose();
    if (_state.waterAddedUV && ctx.world.water && ctx.world.water.mesh) {
      ctx.world.water.mesh.geometry.deleteAttribute("uv");
    }

    if (_state.hud) _state.hud.remove();

    renderer.toneMapping = _state.toneMapping;
    renderer.autoClear = _state.autoClear;

    _state = null;
  },

  // --- helpers ---

  _buildHud() {
    const existing = document.getElementById("pt-hud");
    if (existing) existing.remove();
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
    const status = spp >= MAX_SPP ? "converged" : spp <= 1 ? "tracing…" : "converging…";
    const t = _state.pathTracer.target;
    el.textContent = `Path trace · pixel · ${status}\n${spp} spp · ${t.width}×${t.height}`;
  },

  // Drive the tracer's internal target at the realtime pixel-art resolution
  // (settings.verticalResolution). WebGLPathTracer@0.0.23 sizes the target as
  // floor(renderer.getSize() * renderScale) on each renderSample, so we only
  // need to set renderScale — the lib does the rest. Result: each PT sample
  // lights a chunky low-res pixel and the canvas-side nearest-upscale
  // produces clean blocks.
  _applyTracerSize(ctx) {
    const ch = ctx.renderer.domElement.clientHeight;
    const vRes = Math.max(60, Math.min(ch, ctx.settings.verticalResolution || 420));
    const scale = vRes / ch;
    if (Math.abs(_state.lastTracerScale - scale) < 1e-3) return false;
    _state.pathTracer.renderScale = scale;
    _state.lastTracerScale = scale;
    return true;
  },

  _syncCamera(ctx) {
    const persp = _state.perspCam;
    const eyeOffset = ctx.pixel.eyeOffset;
    const target = ctx.pixel.desiredTarget.clone();
    const eye = eyeOffset.clone().normalize().multiplyScalar(eyeOffset.length() * PERSP_DIST_SCALE);
    const eyePos = target.clone().add(eye);

    const aspect = ctx.renderer.domElement.clientWidth / ctx.renderer.domElement.clientHeight;
    let dirty = false;
    if (Math.abs(persp.aspect - aspect) > 1e-4) {
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      dirty = true;
    }

    // Tolerance on eye/target equality so sub-unit camera nudges (a continuous
    // yaw-drag arc, tiny drift) don't restart accumulation every frame — PT
    // only resets when the camera has actually moved meaningfully.
    const CAMERA_EPS_SQ = 0.04 * 0.04;
    if (
      _state.lastEyeWorld.distanceToSquared(eyePos) > CAMERA_EPS_SQ ||
      _state.lastTargetWorld.distanceToSquared(target) > CAMERA_EPS_SQ
    ) {
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
