import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js";

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
// The 01 camera is OrthographicCamera, which the path tracer doesn't handle.
// We build a temporary telephoto PerspectiveCamera (fov 30°, pulled back
// along the same eye offset) that approximates the iso framing.

const PERSP_FOV_DEG = 30;
const PERSP_DIST_SCALE = 2.0; // pull eye back so the narrow FOV roughly matches the ortho extent

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
      hidden: [], // [obj] visible flipped to false
      matSwap: [], // [{ obj, original }]

      perspCam: null,
      pathTracer: null,
      bvhWorker: null,
      ready: false,
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
        roughness: 0.85,
        metalness: 0.0,
      });
      _state.matSwap.push({ obj, original: m });
      obj.material = std;
    });

    // 3. Renderer setup expected by the path tracer.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.autoClear = true;

    // 4. Build a perspective camera approximating the existing iso framing.
    const persp = new THREE.PerspectiveCamera(
      PERSP_FOV_DEG,
      renderer.domElement.clientWidth / renderer.domElement.clientHeight,
      0.5,
      200,
    );
    _state.perspCam = persp;
    this._syncCamera(ctx);

    // 5. Path tracer.
    const tracer = new WebGLPathTracer(renderer);
    tracer.bounces = 4;
    tracer.multipleImportanceSampling = true;
    tracer.renderScale = 0.5; // half-res; upscale + denoise comes later
    tracer.tiles.set(2, 2);
    tracer.renderToCanvas = true;
    _state.pathTracer = tracer;

    // Build the BVH on a web worker so switching into this mode doesn't freeze
    // the tab. setSceneAsync routes through generateAsync, which requires a BVH
    // worker registered via setBVHWorker (else it throws). GenerateMeshBVHWorker
    // is the single-worker variant — no SharedArrayBuffer / cross-origin
    // isolation needed, unlike ParallelMeshBVHWorker.
    const bvhWorker = new GenerateMeshBVHWorker();
    _state.bvhWorker = bvhWorker;
    tracer.setBVHWorker(bvhWorker);

    const p = tracer.setSceneAsync(scene, persp);
    if (p && typeof p.then === "function") {
      p.then(() => {
        _state.ready = true;
      });
    } else {
      _state.ready = true;
    }
  },

  render(ctx /*, time */) {
    if (!_state || !_state.pathTracer) return;

    // Mirror current ortho camera into our perspective camera. If anything
    // moved, kick the accumulation.
    const moved = this._syncCamera(ctx);
    if (moved && _state.ready) _state.pathTracer.updateCamera();

    if (_state.ready) _state.pathTracer.renderSample();
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

    // Terminate the BVH worker so we don't leak a worker thread per mode switch.
    if (_state.bvhWorker) _state.bvhWorker.dispose?.();

    for (const obj of _state.hidden) obj.visible = true;
    for (const { obj, original } of _state.matSwap) {
      if (obj.material && obj.material !== original) obj.material.dispose();
      obj.material = original;
    }

    renderer.toneMapping = _state.toneMapping;
    renderer.autoClear = _state.autoClear;

    _state = null;
  },

  // --- helpers (bound via this in init/render) ---

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
