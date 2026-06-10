import * as THREE from "three";
import { makeWaterTexture } from "../textures.js";

// Pixel-perfect-ish planar reflection water.
//
// Reflection: each frame we render the scene from a camera mirrored across the
// water plane into a low-res texture, then sample it at the fragment's screen
// uv (the defining property of a planar reflection). During that render we flip
// all materials to DoubleSide so the mirror's handedness flip doesn't cull the
// visible faces.
//
// Waves: a packed procedural texture (R = crisp horizontal wave lines, G = a
// slow swell used to perturb the reflection, B = sparkle) scrolled over time.
// Edge fade softens where the plane meets the shore.

// Irregular rim radius (relative, ~0.7–1.34) shared by the pond geometry, the
// shore decoration in world.js (rimPoint) and the inside test (containsPoint).
const rimR = (a) =>
  1.0 +
  0.18 * Math.sin(3 * a + 1.1) +
  0.10 * Math.sin(5 * a + 2.3) +
  0.06 * Math.sin(7 * a - 0.7);

const MAX_TAPS = 8;

export class Water {
  constructor({ width = 7, depth = 5, y = 0.06, center = new THREE.Vector3(-4, 0, -2) } = {}) {
    this.y = y;
    this.center = center.clone();
    this.rx = width * 0.5;
    this.rz = depth * 0.5;
    this._tapIdx = 0;

    this.reflectionRT = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this.waveTex = makeWaterTexture(256);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        tReflect: { value: this.reflectionRT.texture },
        tWave: { value: this.waveTex },
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0x9fd8d2) },
        uDeep: { value: new THREE.Color(0x2f6f7a) },
        uReflectStrength: { value: 0.5 },
        uReflectEnabled: { value: 1 },
        uPlaneSize: { value: new THREE.Vector2(width, depth) },
        uRain: { value: 0 },
        uCenter: { value: new THREE.Vector2(center.x, center.z) },
        uNight: { value: 0 }, // 0 day → 1 deep night (set from lighting.dayness)
        // tap ripples: xy = world xz of the tap, z = tap time (uTime clock)
        uTaps: { value: Array.from({ length: MAX_TAPS }, () => new THREE.Vector3(0, 0, -1e3)) },
      },
      vertexShader: /* glsl */ `
        attribute float aEdge;   // 1 at pond centre, 0 at the irregular rim
        varying float vEdge;
        varying vec4 vScreen;
        varying vec3 vWorld;
        void main() {
          vEdge = aEdge;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 clip = projectionMatrix * viewMatrix * world;
          vScreen = clip;
          gl_Position = clip;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vEdge;
        varying vec4 vScreen;
        varying vec3 vWorld;

        uniform sampler2D tReflect;
        uniform sampler2D tWave;
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform float uReflectStrength;
        uniform int uReflectEnabled;
        uniform vec2 uPlaneSize;
        uniform float uRain;
        uniform vec2 uCenter;
        uniform float uNight;
        uniform vec3 uTaps[${MAX_TAPS}];

        // player taps: an expanding crest ring + a trailing inner ring per tap,
        // fading out as they spread (same idea as the rain rings, but one-shot,
        // anchored at the tap point, and much bolder so a poke clearly answers)
        float tapRipples(vec2 wpos, out float crest) {
          crest = 0.0;
          float total = 0.0;
          for (int i = 0; i < ${MAX_TAPS}; i++) {
            float age = uTime - uTaps[i].z;
            if (age <= 0.0 || age >= 1.8) continue;
            float fade = 1.0 - age / 1.8;
            float d = length(wpos - uTaps[i].xy);
            float R = age * 2.0;
            float ring = smoothstep(0.26, 0.0, abs(d - R)) * fade;
            float inner = smoothstep(0.2, 0.0, abs(d - max(0.0, R - 0.7))) * fade * 0.6;
            crest += ring;
            total += ring + inner;
          }
          return total;
        }

        // a couple of expanding raindrop rings at pseudo-random spots on the pond
        float rainRipples(vec2 wpos, out float crest) {
          crest = 0.0;
          float total = 0.0;
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            // a fresh drop site every ~1.1s, jumping around the surface
            float life = 1.1;
            float t = uTime / life + fi * 0.41;
            float k = floor(t);
            float age = fract(t);                         // 0 → 1 ring lifetime
            vec2 c = (vec2(fract(sin(k * 12.9 + fi * 7.7) * 43758.5),
                           fract(sin(k * 78.2 + fi * 3.3) * 12733.1)) - 0.5) * uPlaneSize * 0.8;
            float d = length(wpos - c);
            float R = age * 1.6;                          // ring radius grows
            float ring = smoothstep(0.10, 0.0, abs(d - R)) * (1.0 - age);
            crest += ring;
            total += ring;
          }
          return total;
        }

        void main() {
          vec2 scroll1 = vec2(0.02, 0.05) * uTime;
          vec2 scroll2 = vec2(-0.03, 0.02) * uTime;
          vec2 wuv = vWorld.xz * 0.12;

          vec4 wave = texture2D(tWave, wuv + scroll1);
          float swell = texture2D(tWave, wuv * 0.5 + scroll2).g;
          float lines = wave.r;
          float sparkle = wave.b;

          // tap ripples are always live (the player poking the pond)
          float tapCrest = 0.0;
          float tapped = tapRipples(vWorld.xz, tapCrest);
          swell = clamp(swell + tapped * 0.55, 0.0, 1.0);
          float crest = tapCrest;

          // rain dimpling the pond: expanding rings perturb the swell + add crests
          if (uRain > 0.5) {
            float rainCrest = 0.0;
            float ripple = rainRipples(vWorld.xz - uCenter, rainCrest);
            swell = clamp(swell + ripple * 0.5, 0.0, 1.0);
            crest += rainCrest;
          }

          // depth grade: bright shallows hugging the shore, deeper colour toward
          // the middle (vEdge is 0 at the rim, 1 at the pond centre)
          float depthF = smoothstep(0.04, 0.6, vEdge);
          vec3 col = mix(uShallow, uDeep, depthF * (0.78 - swell * 0.32));
          col = mix(col, uShallow, lines * 0.7);
          col += sparkle * 0.25;

          // planar reflection sampled at screen uv, perturbed by the swell + ripples;
          // deep water mirrors more than the bright shallows
          if (uReflectEnabled == 1) {
            vec2 screenUv = vScreen.xy / vScreen.w * 0.5 + 0.5;
            screenUv += (swell - 0.5) * 0.03;
            screenUv += crest * 0.02;
            vec3 refl = texture2D(tReflect, screenUv).rgb;
            col = mix(col, refl, uReflectStrength * (0.62 + lines * 0.38) * (0.45 + 0.55 * depthF));
          }
          col += crest * 0.18; // bright ripple crests catching the light
          col += tapCrest * 0.24; // tap rings flash brighter than rain dimples

          // shoreline: a crisp waterline plus patches of foam lapping just off
          // the shore (drifting with the swell so the edge looks like it laps)
          float shoreBand = 1.0 - smoothstep(0.0, 0.2, vEdge);
          float lap = 0.5 + 0.5 * sin(uTime * 1.3 + vEdge * 26.0 + vWorld.x * 0.7 + vWorld.z * 0.9);
          float foam = shoreBand * smoothstep(0.6, 0.78, swell * 0.55 + lap * 0.45);
          foam += (1.0 - smoothstep(0.0, 0.05, vEdge)) * 0.8; // the waterline itself
          foam = clamp(foam, 0.0, 1.0);
          col = mix(col, vec3(0.93, 0.97, 0.9), foam * 0.8);

          // night grade: the shader water doesn't receive scene lighting, so
          // fade it to a deep moonlit blue ourselves (matching the meadow's
          // moonlit-blue look) instead of staying sunlit white after dark
          vec3 moonlit = col * vec3(0.26, 0.32, 0.52);
          // ...with a soft moon-glade: a patch of pale light whose shimmer
          // rides the wave lines and ripple crests
          float glade = smoothstep(2.6, 0.0, length(vWorld.xz - uCenter - vec2(-0.9, -0.6)));
          moonlit += glade * (lines * 0.38 + crest * 0.3 + swell * 0.07) * vec3(0.62, 0.68, 0.85);
          col = mix(col, moonlit, uNight);

          // soften the shoreline using the per-vertex edge factor (0 at rim)
          float a = smoothstep(0.0, 0.28, vEdge) * 0.85 + 0.12;

          gl_FragColor = vec4(col, clamp(a + lines * 0.25 + foam * 0.4, 0.0, 1.0));
        }
      `,
    });

    const geo = makePondGeometry(width * 0.5, depth * 0.5);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.copy(this.center);
    this.mesh.position.y = y;
    this.mesh.userData.skipNormal = true;
    this.mesh.renderOrder = 1;

    // mirror across the horizontal plane y = this.y
    this._reflect = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 2 * y,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this._virtualCam = new THREE.OrthographicCamera();
    this._virtualCam.matrixWorldAutoUpdate = false;
  }

  // World-space point on the pond rim at angle `a`, scaled by `k` (k=1 is the
  // waterline; k>1 walks outward onto the shore). The pond mesh is rotated
  // -90° about x, which maps geometry +y to world -z.
  rimPoint(a, k = 1) {
    const r = rimR(a) * k;
    return {
      x: this.center.x + Math.cos(a) * r * this.rx,
      z: this.center.z - Math.sin(a) * r * this.rz,
    };
  }

  // Is the world-space point (x, z) inside the irregular pond outline?
  containsPoint(x, z, k = 1) {
    const ex = (x - this.center.x) / this.rx;
    const ey = -(z - this.center.z) / this.rz;
    return Math.hypot(ex, ey) <= rimR(Math.atan2(ey, ex)) * k;
  }

  // Start a one-shot tap ripple at the world-space point (x, z). Oldest slot
  // is recycled; the ring animates entirely in the fragment shader.
  addRipple(x, z) {
    const u = this.material.uniforms;
    u.uTaps.value[this._tapIdx].set(x, z, u.uTime.value);
    this._tapIdx = (this._tapIdx + 1) % u.uTaps.value.length;
  }

  get bounds() {
    // a touch larger than the base radii to cover the irregular rim bumps
    const w = this.material.uniforms.uPlaneSize.value.x * 0.62;
    const d = this.material.uniforms.uPlaneSize.value.y * 0.62;
    return {
      minX: this.center.x - w,
      maxX: this.center.x + w,
      minZ: this.center.z - d,
      maxZ: this.center.z + d,
    };
  }

  setReflectionSize(w, h) {
    this.reflectionRT.setSize(Math.max(2, w), Math.max(2, h));
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }

  // Render the mirrored scene into the reflection target. Called as the
  // pipeline's pre-render hook, before the main colour pass.
  updateReflection(renderer, mainCamera, scene) {
    if (this.material.uniforms.uReflectEnabled.value === 0) return;

    const cam = this._virtualCam;
    cam.matrixWorld.multiplyMatrices(this._reflect, mainCamera.matrixWorld);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(mainCamera.projectionMatrix);
    cam.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);

    // flip culling-sensitive faces to double-sided for the mirrored pass, and
    // hide noReflect objects (the grass carpet) so the tree mirrors against the
    // sky instead of being buried in a sea of reflected grass.
    const restore = [];
    const hiddenR = [];
    this.mesh.visible = false;
    scene.traverse((o) => {
      if (o.userData && o.userData.noReflect && o.visible) {
        hiddenR.push(o);
        o.visible = false;
      }
      if (o.isMesh && o.material && o.material.side !== THREE.DoubleSide) {
        restore.push([o.material, o.material.side]);
        o.material.side = THREE.DoubleSide;
      }
    });

    const prevBg = scene.background;
    renderer.setRenderTarget(this.reflectionRT);
    renderer.setClearColor(prevBg || new THREE.Color(0xbfe0df), 1);
    renderer.clear();
    renderer.render(scene, cam);

    restore.forEach(([mat, side]) => (mat.side = side));
    hiddenR.forEach((o) => (o.visible = true));
    this.mesh.visible = true;
  }
}

// Irregular pond blob as a triangle fan (centre + perturbed rim ring). The
// `aEdge` attribute is 1 at the centre and 0 on the rim so the shader can fade
// the shoreline smoothly regardless of the organic outline.
function makePondGeometry(rx, rz, segments = 72) {
  const positions = [0, 0, 0];
  const edges = [1];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = rimR(a);
    positions.push(Math.cos(a) * r * rx, Math.sin(a) * r * rz, 0);
    edges.push(0);
  }

  const indices = [];
  for (let i = 1; i <= segments; i++) {
    const next = i === segments ? 1 : i + 1;
    indices.push(0, i, next);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
