import * as THREE from "three";
import { WebGLPathTracer, PhysicalCamera } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js";
import { PixelArtPost } from "./post_pixelart.js";
import { mergeBillboardsToMesh, buildFoliageClumps } from "./merge_instances.js";
import { makeSkyEnv } from "./sky_env.js";
import { makeGrassTextures, makeBarkTextures, makeWaterNormal, disposeTextures } from "./detail_textures.js";

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
const TARGET_POND_BIAS = 0.2; // look-down bias toward the relocated foreground pond so it stays framed
const WATER_FOREGROUND_DIST = 9.5; // how far in front of the tree (toward camera) to relocate the pond in PT mode
const MAX_SPP = 256; // stop accumulating once converged — beyond this the image barely changes but the GPU keeps running at full load. Camera motion resets samples to 0 and re-accumulates up to here.

// Outline is OFF by default in path-trace mode, matching the real-time view
// (whose outline slider also defaults to 0 — its pixel-art look comes from the
// cel ramp + low-res, not ink edges). Forcing an outline on the path-traced
// scene inked the trunk/branches through the soft canopy in a distracting way.
// The user can still drag the Outline slider to add edges if they want.

// Environment lighting is now a baked sky+sun HDR (see sky_env.js): a blue
// dome, warm pale horizon, and a bright warm SUN DISK at the real sun
// direction. The path tracer importance-samples it, so the sun is the key
// light (warm directional shading + soft shadows + a glint in the pond) and the
// blue sky fills shadows cool — instead of the old flat-green gradient. With a
// real sun in the env we ZERO the scene's DirectionalLight in this mode so the
// sun isn't double-counted (restored on dispose).
const ENV_INTENSITY = 1.0;
const SURFACE_ROUGHNESS = 0.65; // a touch glossy so the env actually reflects (sheen / RT cue)

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
      waterPos: null, // original pond position, restored on dispose (we relocate it to the foreground)

      perspCam: null,
      pathTracer: null,
      bvhWorker: null,
      post: null, // M3 pixel-art post chain (cel + outline + low-res upscale)
      ready: false,
      hud: null, // sample-count overlay
      lastTargetWorld: new THREE.Vector3(),
      lastEyeWorld: new THREE.Vector3(),
    };

    // 1. Hide every InstancedMesh (grass + tree foliage) and the Points dust
    //    cloud — instancing isn't supported (B1) and the dust is a custom shader.
    //    Also hide real-time-only helpers that would break the photoreal hero
    //    shot: shadowOnly canopy casters (colour-silent meshes that would become
    //    solid blobs once their material is swapped) and noReflect wildlife
    //    (animals / birds / rain splashes — they belong only to the live scene).
    //    The water plane is NOT hidden: it gets a real reflective material below.
    scene.traverse((obj) => {
      if (!obj.visible) return;
      const ud = obj.userData || {};
      if (obj.isInstancedMesh || obj.isPoints || ud.shadowOnly || ud.noReflect) {
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
        const mesh = mergeBillboardsToMesh(obj, { roughness: SURFACE_ROUGHNESS, foliage: false, sizeScale: 0.72 });
        obj.parent.add(mesh);
        _state.merged.push({ mesh, parent: obj.parent });
        continue;
      }
      // Tree canopy: each sprig explodes into a scattered puff of small SOLID
      // leaf cards (see merge_instances). Solid (not the feathery cutout texture,
      // which has too little opaque area to ever fill — a sparse cutout canopy
      // just vanishes to black under GI). Kept FEW + small so the canopy stays
      // open/sparse like the real-time view: the small green clumps leave gaps
      // that show the lit trunk/branches through them, instead of a dense bush.
      // Real 3D foliage: each sprig anchor becomes a couple of small icosahedron
      // leaf-clumps (see buildFoliageClumps). Replaces the flat crossed cards,
      // which read as ugly cardboard under the path tracer — the 3D blobs have
      // real form, self-shadowing and GI colour bleed (a clean low-poly conifer).
      const leaves = buildFoliageClumps(obj, { sizeScale: 1.2, clumpsPerInst: 22 });
      obj.parent.add(leaves);
      _state.merged.push({ mesh: leaves, parent: obj.parent });
    }

    // 1c. Path-traced water. Two parts:
    //
    //   • Reposition. The scene's pond sits far to the left of the tree and falls
    //     completely outside the path-trace camera framing — so it never showed.
    //     In path-trace mode we relocate it into the FOREGROUND, in front of the
    //     tree toward the camera, so it's clearly in frame and the tree reflects
    //     in it. (PT-only; the original position is restored on dispose so the
    //     real-time planar-reflection pond is untouched.)
    //
    //   • Material. The real-time pond is a custom planar-reflection shader; here
    //     we hand the path tracer a near-mirror MeshPhysicalMaterial so it
    //     computes TRUE reflections of the sky env + tree (the showcase the
    //     real-time fake approximates). Deep blue-teal base + clearcoat so it
    //     reads as water, not flat ground; no transmission (there's no pond-floor
    //     geometry, so a see-through surface would reveal the background).
    //     Swapped before the generic pass below so that pass skips it; both the
    //     material and the position are restored on dispose.
    if (world.water && world.water.mesh && world.tree) {
      const wm = world.water.mesh;
      const eye = ctx.pixel.eyeOffset;
      const hlen = Math.hypot(eye.x, eye.z) || 1;
      _state.waterPos = wm.position.clone();
      wm.position.set(
        world.tree.position.x + (eye.x / hlen) * WATER_FOREGROUND_DIST,
        wm.position.y,
        world.tree.position.z + (eye.z / hlen) * WATER_FOREGROUND_DIST,
      );

      // A real dielectric water surface only reflects ~2-10% looking down, so
      // the rest is the dull body colour and it never reads as a mirror from
      // this top-ish angle. A still lake reads "mirror" when the REFLECTION
      // dominates, so we make it a tinted near-metal: reflection-dominant,
      // tinted teal, with a clearcoat for a wet sheen. Unphysical, but it's the
      // bright mirror lake the look calls for (and what the real-time fake fakes).
      // Ripple normals turn the flat mirror into real water: they break up the
      // reflection and scatter the sun into sparkling specular highlights (the
      // "light on water" feel). The pond geometry has no UVs (it's a custom
      // triangle fan), so derive planar UVs from its local XY for the normal map.
      _state.waterNormalTex = makeWaterNormal(512);
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

      const waterMat = new THREE.MeshPhysicalMaterial({
        color: 0x8fc0cc, // tints the (dominant) reflection a cool teal
        roughness: 0.03, // crisp ripple reflections + sharp sun sparkles
        metalness: 0.88, // reflection-dominant -> sky + tree mirror clearly
        normalMap: _state.waterNormalTex,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        side: THREE.DoubleSide,
      });
      waterMat.normalScale.set(0.32, 0.32);
      _state.matSwap.push({ obj: wm, original: wm.material });
      wm.material = waterMat;
    }

    // Procedural detail textures (albedo + normal): grass for the ground, bark
    // for the trunk. Path tracing can't invent surface detail, so we bake some —
    // the normal maps catch the low golden key and read as real relief instead
    // of flat plastic (the biggest "this isn't real" tell).
    _state.grassTex = makeGrassTextures();
    _state.barkTex = makeBarkTextures();

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

      // Ground: tiling grass albedo + normal relief.
      if (obj === world.ground) {
        const g = _state.grassTex;
        std.map = g.map;
        std.normalMap = g.normalMap;
        std.map.repeat.set(20, 20);
        std.normalMap.repeat.set(20, 20);
        std.normalScale.set(0.9, 0.9);
        std.color.set(0xffffff); // let the texture carry the colour
        std.roughness = 0.96;
      }

      _state.matSwap.push({ obj, original: m });
      obj.material = std;
    });

    // 2b. Lift the tree's woody parts (trunk / branches / core) out of GI-black.
    //     With the canopy now sparse + open, the trunk shows through the gaps —
    //     but GI leaves it a dark void deep in the canopy shadow, unlike the
    //     real-time toon ramp. A dim warm-brown emissive floor makes it read as
    //     lit wood through the foliage, like the real-time view. Targets only the
    //     swapped meshes under world.tree (not the green foliage puffs, which
    //     aren't in matSwap, nor rocks/ground/flowers, which aren't under tree).
    for (const { obj } of _state.matSwap) {
      let p = obj;
      let inTree = false;
      while (p) {
        if (p === world.tree) {
          inTree = true;
          break;
        }
        p = p.parent;
      }
      if (inTree && obj.material && obj.material.isMeshStandardMaterial) {
        obj.material.emissive = new THREE.Color(0x3a2a1c);
        obj.material.emissiveIntensity = 0.4;
        // bark albedo + vertical-ridge normal on the woody parts
        const b = _state.barkTex;
        obj.material.map = b.map;
        obj.material.normalMap = b.normalMap;
        b.map.repeat.set(2.5, 3.0);
        b.normalMap.repeat.set(2.5, 3.0);
        obj.material.normalScale.set(0.8, 0.8);
        obj.material.color.set(0xffffff);
        obj.material.roughness = 0.9;
        obj.material.needsUpdate = true;
      }
    }

    // 3. Lighting. Two parts working together for a photoreal golden-hour look:
    //
    //   • KEY = the scene's DirectionalLight, repointed LOW + front-right and
    //     warmed up. The real-time sun is near-overhead (flat); a low sun gives
    //     side-lit form + long soft shadows. A directional (delta) light is a
    //     near-free, noise-free key the tracer samples efficiently — far better
    //     than relying on a tiny-solid-angle env sun (which a big sky dome just
    //     washes out). Repointed only for this mode; restored on dispose.
    //   • FILL + REFLECTIONS = the baked sky env (sky_env.js): a deep-blue dome
    //     fading to a warm horizon = cool shadow fill, plus a bright sun disk at
    //     the SAME direction so the pond + glossy surfaces show a real sky with a
    //     sun glint, and the background is a true sky.
    const ptSunDir = new THREE.Vector3(0.82, 0.33, 0.46).normalize();

    _state.prevSunPos = ctx.lighting.sun.position.clone();
    _state.prevSunColor = ctx.lighting.sun.color.clone();
    _state.prevSunIntensity = ctx.lighting.sun.intensity;
    ctx.lighting.sun.position.copy(ptSunDir).multiplyScalar(20);
    ctx.lighting.sun.color.setHex(0xffdca6); // warm golden key
    ctx.lighting.sun.intensity = 3.2;
    ctx.lighting.sun.target.position.set(0, 0, 0);
    ctx.lighting.sun.target.updateMatrixWorld();
    ctx.lighting.sun.updateMatrixWorld();

    const env = makeSkyEnv(ptSunDir, {
      skyIntensity: 0.65,
      sunColor: [1.0, 0.86, 0.6],
      sunIntensity: 16.0, // bright sun glint in the pond/glossy reflections — directional light stays the diffuse key
      sunAngularDeg: 2.0,
      zenith: [0.09, 0.24, 0.58],
      horizon: [0.52, 0.62, 0.74],
      ground: [0.16, 0.16, 0.13],
    });
    scene.environment = env;
    scene.environmentIntensity = 0.7; // cool sky fill in shadow, secondary to the key
    _state.prevBackground = scene.background;
    scene.background = env; // show the real sky behind the scene
    _state.envTex = env;

    // Disable the real-time distance fog in PT: it's a fixed pale haze that
    // washes the photoreal render to grey (depth here comes from the sky env +
    // GI, not flat fog). Restored on dispose.
    _state.prevFog = scene.fog;
    scene.fog = null;

    // 4. Renderer setup. Tonemapping is done in the post chain's edge shader
    //    (in-shader ACES on the linear PT target), so keep the renderer itself
    //    on NoToneMapping to avoid double-grading.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;

    // 5. Build a physical camera approximating the existing iso framing, with a
    //    shallow-ish depth of field. Focus sits on the tree; the foreground pond
    //    and the far ground fall slightly out of focus — the bokeh is a strong
    //    "this is a render" cue and reads as a tasteful tilt-shift on the diorama.
    const persp = new PhysicalCamera(
      PERSP_FOV_DEG,
      renderer.domElement.clientWidth / renderer.domElement.clientHeight,
      0.5,
      200,
    );
    // Subtle depth of field: the scene stays mostly in focus, with only a gentle
    // far/near falloff for depth (not the heavy macro blur). three-gpu-pathtracer
    // scales the aperture by bokehSize*1e-3 (assumes a mm-scale scene); our scene
    // is ~40 units, so the f-stop is unusually small. f/0.03 ≈ light separation;
    // 0.008 was strong macro blur.
    persp.fStop = 0.07; // very subtle DoF — only the far background softens slightly
    persp.apertureBlades = 6;
    persp.focusDistance = 40; // refined to the eye→tree distance each frame in _syncCamera
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
    tracer.bounces = 5;
    tracer.multipleImportanceSampling = true;
    tracer.renderScale = 1.0; // full-res for a crisp hero (the 0.75 scale read as soft)
    tracer.tiles.set(3, 3);
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

    // Post chain — only its renderPhotoreal() path is used now (ACES + sRGB
    // full-res blit of the traced radiance). The pixel-art cel/outline register
    // was removed: PT is the photoreal showcase, the pixel-art look lives in 01.
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
      // Accumulate only up to MAX_SPP. Once converged we stop tracing (GPU goes
      // idle) but keep blitting the same finished target.texture every frame, so
      // the canvas stays lit. updateCamera() above resets samples on motion, so
      // moving the camera transparently re-arms accumulation up to MAX_SPP again.
      if (_state.pathTracer.samples < MAX_SPP) {
        _state.pathTracer.renderSample();
      }
      // Path Trace is photoreal-only now: ACES-tonemapped radiance at full
      // resolution (no cel/outline/pixelation). Exposure < 1 keeps the lit
      // foliage in the saturated midtones instead of ACES's pale shoulder.
      _state.post.renderPhotoreal(_state.pathTracer.target.texture, 0.6);
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

    // Restore the pond to its original (off-frame) position for the other modes,
    // and remove the UVs we added for the ripple normal map.
    if (ctx.world.water && ctx.world.water.mesh) {
      if (_state.waterPos) ctx.world.water.mesh.position.copy(_state.waterPos);
      if (_state.waterAddedUV) ctx.world.water.mesh.geometry.deleteAttribute("uv");
    }

    // Restore the scene's environment lighting and free the generated sky.
    ctx.scene.environment = _state.prevEnvironment;
    ctx.scene.environmentIntensity = _state.prevEnvIntensity;
    if (_state.prevBackground !== undefined) ctx.scene.background = _state.prevBackground;
    if (_state.prevFog !== undefined) ctx.scene.fog = _state.prevFog;
    if (_state.prevSunPos) ctx.lighting.sun.position.copy(_state.prevSunPos);
    if (_state.prevSunColor) ctx.lighting.sun.color.copy(_state.prevSunColor);
    if (_state.prevSunIntensity !== undefined) ctx.lighting.sun.intensity = _state.prevSunIntensity;
    ctx.lighting.sun.updateMatrixWorld();
    if (_state.envTex) _state.envTex.dispose();
    disposeTextures(_state.grassTex);
    disposeTextures(_state.barkTex);
    if (_state.waterNormalTex) _state.waterNormalTex.dispose();

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
    const status = spp >= MAX_SPP ? "converged" : spp <= 1 ? "tracing…" : "converging…";
    el.textContent = `Path trace · photoreal · ${status}\n${spp} spp`;
  },

  _syncCamera(ctx) {
    const persp = _state.perspCam;
    const eyeOffset = ctx.pixel.eyeOffset;

    // Pan/tilt the look-at slightly toward the relocated foreground pond so the
    // reflective water sits clearly in the lower frame. This translates both eye
    // and target by the same delta, so it's a pan, not a rotation.
    const target = ctx.pixel.desiredTarget.clone();
    if (ctx.world && ctx.world.water && ctx.world.water.mesh) {
      target.lerp(ctx.world.water.mesh.position, TARGET_POND_BIAS);
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
    // Keep focus locked on the tree (target) for the depth-of-field blur.
    const focus = eyePos.distanceTo(target);
    if (persp.focusDistance !== undefined && Math.abs(persp.focusDistance - focus) > 0.05) {
      persp.focusDistance = focus;
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
