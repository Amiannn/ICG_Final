import * as THREE from "three";

// Floating dust / pollen motes drifting through the air. They live in world
// space (so panning the camera gives parallax = depth), are size-attenuated to
// a few low-res pixels, and use additive blending so they read as little specks
// catching the light. Drift is animated in the vertex shader (no per-frame CPU).
export class DustParticles {
  constructor({
    count = 300,
    center = new THREE.Vector3(2, 9, 1),
    extent = new THREE.Vector3(15, 9, 14),
    color = 0xfdf3cf,
  } = {}) {
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const size = new Float32Array(count);
    const amp = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = center.x + (Math.random() * 2 - 1) * extent.x;
      positions[i * 3 + 1] = center.y + (Math.random() * 2 - 1) * extent.y;
      positions[i * 3 + 2] = center.z + (Math.random() * 2 - 1) * extent.z;
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = 1.2 + Math.random() * 2.6; // low-res pixels
      amp[i] = 0.3 + Math.random() * 0.7; // drift amplitude (world units)
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAmp", new THREE.BufferAttribute(amp, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: 0.6 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        attribute float aAmp;
        uniform float uTime;
        varying float vTwinkle;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.25 + aPhase) * aAmp;
          p.y += sin(uTime * 0.17 + aPhase * 1.7) * aAmp * 0.8 + sin(uTime * 0.05) * 0.2;
          p.z += cos(uTime * 0.21 + aPhase * 0.7) * aAmp;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize;
          vTwinkle = 0.6 + 0.4 * sin(uTime * 1.3 + aPhase * 3.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vTwinkle;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a = smoothstep(0.5, 0.05, r);
          gl_FragColor = vec4(uColor * a * uIntensity * vTwinkle, a);
        }
      `,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.userData.skipNormal = true; // keep dust out of the outline pass
    this.points.renderOrder = 2;
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }
}
