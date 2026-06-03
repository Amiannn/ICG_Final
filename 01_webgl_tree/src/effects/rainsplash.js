import * as THREE from "three";

// Rain impact splashes — when it rains, drops striking the meadow, rocks and pond
// pop a little expanding ring that fades out, scattered across the scene with
// staggered phases so the surfaces look like they are being pattered by rain.
//
// One InstancedMesh of flat ring quads lying just above the ground. Each instance
// runs its own splash cycle (fract(time)) in the shader: a thin ring expands from
// the centre and fades as it grows, then repeats — cheap and entirely GPU-driven.

export function makeRainSplash({ count = 180, area = { x0: -11, x1: 11, z0: -5, z1: 12 }, y = 0.085 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const phase = new Float32Array(count);
  const rate = new Float32Array(count);
  const size = new Float32Array(count);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // lie flat, face up
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const mesh = new THREE.InstancedMesh(geo, null, count);
  for (let i = 0; i < count; i++) {
    const x = area.x0 + Math.random() * (area.x1 - area.x0);
    const z = area.z0 + Math.random() * (area.z1 - area.z0);
    const sz = 0.45 + Math.random() * 0.55; // ring footprint
    p.set(x, y, z);
    s.set(sz, sz, sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    phase[i] = Math.random();
    rate[i] = 0.7 + Math.random() * 0.7; // splashes per second-ish (varied)
    size[i] = sz;
  }
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute("aRate", new THREE.InstancedBufferAttribute(rate, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uRain: { value: 0 },
      uColor: { value: new THREE.Color(0xdfeaf2) },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aRate;
      varying vec2 vUv;
      varying float vCyc;
      uniform float uTime;
      void main() {
        vUv = uv;
        vCyc = fract(uTime * aRate + aPhase);     // 0 → 1 splash cycle
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vCyc;
      uniform float uRain;
      uniform vec3 uColor;
      void main() {
        if (uRain < 0.01) discard;
        float d = length((vUv - 0.5) * 2.0);       // 0 centre … 1 quad edge
        float R = vCyc;                             // ring expands outward
        // a thin bright crest at the wavefront + a fainter trailing ring
        float crest = smoothstep(0.16, 0.0, abs(d - R));
        float trail = smoothstep(0.30, 0.0, abs(d - R * 0.55)) * 0.35;
        float fade = (1.0 - vCyc) * (1.0 - vCyc);   // fades as it spreads
        float a = (crest + trail) * fade * uRain;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a * 0.55);
      }
    `,
  });
  mesh.material = material;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;                 // over the pond surface
  mesh.userData.noReflect = true;       // keep splashes out of the mirror pass
  mesh.userData.skipNormal = true;
  mesh.visible = false;

  function setTime(t) { material.uniforms.uTime.value = t; }
  function setRain(on) { material.uniforms.uRain.value = on ? 1 : 0; mesh.visible = !!on; }

  return { mesh, setTime, setRain };
}
