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

export class Water {
  constructor({ width = 7, depth = 5, y = 0.06, center = new THREE.Vector3(-4, 0, -2) } = {}) {
    this.y = y;
    this.center = center.clone();

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

        void main() {
          vec2 scroll1 = vec2(0.02, 0.05) * uTime;
          vec2 scroll2 = vec2(-0.03, 0.02) * uTime;
          vec2 wuv = vWorld.xz * 0.12;

          vec4 wave = texture2D(tWave, wuv + scroll1);
          float swell = texture2D(tWave, wuv * 0.5 + scroll2).g;
          float lines = wave.r;
          float sparkle = wave.b;

          // base water colour: deep, with crisp crests lightening it
          vec3 col = mix(uDeep, uShallow, 0.35 + swell * 0.4);
          col = mix(col, uShallow, lines * 0.7);
          col += sparkle * 0.25;

          // planar reflection sampled at screen uv, perturbed by the swell
          if (uReflectEnabled == 1) {
            vec2 screenUv = vScreen.xy / vScreen.w * 0.5 + 0.5;
            screenUv += (swell - 0.5) * 0.03;
            vec3 refl = texture2D(tReflect, screenUv).rgb;
            col = mix(col, refl, uReflectStrength * (0.62 + lines * 0.38));
          }

          // soften the shoreline using the per-vertex edge factor (0 at rim)
          float a = smoothstep(0.0, 0.28, vEdge) * 0.85 + 0.12;

          gl_FragColor = vec4(col, clamp(a + lines * 0.25, 0.0, 1.0));
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
    const r =
      1.0 +
      0.18 * Math.sin(3 * a + 1.1) +
      0.10 * Math.sin(5 * a + 2.3) +
      0.06 * Math.sin(7 * a - 0.7);
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
