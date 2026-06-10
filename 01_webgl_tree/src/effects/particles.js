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

// Fireflies — sparse green glints drifting low over the meadow that wink on
// and off out of phase with one another. They fade in only after dark (driven
// by setNight), so dusk turns the dust motes into a field of soft green lights.
export class Fireflies {
  constructor({
    count = 80,
    center = new THREE.Vector3(2, 1.6, 2),
    extent = new THREE.Vector3(17, 1.5, 16),
    color = 0xa6f070,
  } = {}) {
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const size = new Float32Array(count);
    const amp = new Float32Array(count);
    const blink = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = center.x + (Math.random() * 2 - 1) * extent.x;
      positions[i * 3 + 1] = center.y + (Math.random() * 2 - 1) * extent.y;
      positions[i * 3 + 2] = center.z + (Math.random() * 2 - 1) * extent.z;
      phase[i] = Math.random();
      size[i] = 4.5 + Math.random() * 5.0; // bigger so the halo reads
      amp[i] = 0.4 + Math.random() * 0.9;
      blink[i] = 0.22 + Math.random() * 0.4; // each blinks at its own rate
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAmp", new THREE.BufferAttribute(amp, 1));
    geo.setAttribute("aBlink", new THREE.BufferAttribute(blink, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uNight: { value: 0 }, // 0 day (hidden) → 1 night (lit)
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        attribute float aAmp;
        attribute float aBlink;
        uniform float uTime;
        varying float vGlow;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.3 + aPhase * 6.28) * aAmp;
          p.y += sin(uTime * 0.22 + aPhase * 11.0) * aAmp * 0.5 + 0.15 * sin(uTime * 0.07);
          p.z += cos(uTime * 0.26 + aPhase * 4.4) * aAmp;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize;
          // a slow blink with dark gaps: quick rise, hold, fade — out of phase
          float c = fract(uTime * aBlink + aPhase);
          vGlow = smoothstep(0.0, 0.12, c) * (1.0 - smoothstep(0.45, 0.9, c));
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uNight;
        varying float vGlow;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0; // 0 centre … 1 edge
          // bright pinpoint core + a wide soft halo ring around it
          float core = smoothstep(0.22, 0.0, r);
          float halo = smoothstep(1.0, 0.18, r) * 0.55;
          float g = (core + halo) * vGlow * uNight;
          if (g < 0.01) discard;
          // additive: brighten the core toward white-green so it really pops
          vec3 col = mix(uColor, vec3(0.85, 1.0, 0.7), core * 0.7);
          gl_FragColor = vec4(col * g * 2.4, (core + halo * 0.6) * vGlow * uNight);
        }
      `,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.userData.skipNormal = true;
    this.points.userData.noReflect = true;
    this.points.renderOrder = 2;
  }

  setTime(t) { this.material.uniforms.uTime.value = t; }
  setNight(n) {
    const v = Math.max(0, Math.min(1, n));
    this.material.uniforms.uNight.value = v;
    this.points.visible = v > 0.02;
  }
}
