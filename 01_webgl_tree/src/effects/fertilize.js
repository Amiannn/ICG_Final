import * as THREE from "three";

// Fertilize burst — when the player feeds the tree, a ring of soft green
// nutrient motes rises from the soil around the trunk, spiralling gently up
// into the canopy and fading out. The mirror image of the watering shower
// (which falls); all motion runs in the vertex shader off one uT uniform.
export function makeFertilizeBurst({ count = 150, color = 0xb9e478 } = {}) {
  const disc = new Float32Array(count * 2); // ring around the trunk base
  const delay = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + 0.65 * Math.sqrt(Math.random()); // hollow middle (trunk)
    disc[i * 2] = Math.cos(a) * r;
    disc[i * 2 + 1] = Math.sin(a) * r;
    delay[i] = Math.random() * 0.7;
    speed[i] = 1.4 + Math.random() * 1.6;
    size[i] = 2.2 + Math.random() * 2.6;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aDisc", new THREE.BufferAttribute(disc, 2));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending, // glowing sparkle feel
    uniforms: {
      uT: { value: -1 }, // seconds since trigger (-1 = idle)
      uCenter: { value: new THREE.Vector3(2.6, 0, 1.2) },
      uRise: { value: 3.2 }, // how high the motes climb before fading
      uRadius: { value: 1.6 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aDisc;
      attribute float aDelay;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uT;
      uniform vec3 uCenter;
      uniform float uRise;
      uniform float uRadius;
      varying float vAlpha;
      void main() {
        float t = uT - aDelay;
        float y = t * aSpeed;
        float alive = step(0.0, t) * step(0.0, uT) * step(y, uRise);
        // quick fade-in from the soil, slow fade toward the top of the climb
        vAlpha = alive * smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(uRise * 0.55, uRise, y));
        // gentle spiral as the motes rise
        float ang = t * 1.6 + aDelay * 30.0;
        vec3 p = uCenter + vec3(
          aDisc.x * uRadius + sin(ang) * 0.12,
          max(y, 0.0) + 0.1,
          aDisc.y * uRadius + cos(ang) * 0.12
        );
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * alive;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.08, length(d)) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.visible = false;
  points.userData.skipNormal = true;
  points.userData.noReflect = true;
  points.renderOrder = 2;

  let pending = false;
  let t0 = null;

  // burst at the tree's base; rise/spread follow the tree's current size
  function trigger(center, rise, radius) {
    if (center) material.uniforms.uCenter.value.copy(center);
    if (rise != null) material.uniforms.uRise.value = rise;
    if (radius != null) material.uniforms.uRadius.value = radius;
    pending = true;
  }

  // called every frame with the global clock time
  function setTime(t) {
    if (pending) {
      t0 = t;
      pending = false;
      points.visible = true;
    }
    if (t0 == null) return;
    const el = t - t0;
    material.uniforms.uT.value = el;
    // done when the slowest late mote has finished its climb
    if (el > 0.7 + material.uniforms.uRise.value / 1.4 + 0.3) {
      t0 = null;
      points.visible = false;
      material.uniforms.uT.value = -1;
    }
  }

  return { points, trigger, setTime };
}
