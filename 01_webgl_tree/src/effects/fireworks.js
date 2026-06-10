import * as THREE from "three";

// Festival fireworks — physically simulated.
//
// Rockets launch from the ground with an upward velocity and rise under GRAVITY
// (decelerating); at apex (vy ≤ 0) they burst into a particle shell. Every shell
// particle then flies out and falls under the same gravity + air drag, fading as
// it goes — so the whole sky arcs and droops like real fireworks. Several burst
// STYLES (peony, chrysanthemum, ring, willow, palm, strobe, crossette) and a
// vivid palette give it a carnival feel, ramping into a rapid finale.
//
// One additive THREE.Points pool (struct-of-arrays, recycled) keeps it cheap.

const G = 7.6;        // gravity (scene units / s²)
const MAX = 26000;    // particle pool (fine, dense shells)
const TAU = Math.PI * 2;
const PALETTE = [
  0xff4d4d, 0xffd24d, 0x5cff7a, 0x4dd2ff, 0x9b6dff,
  0xff6dce, 0xffffff, 0xff9b3d, 0x6dffd2, 0xffe680,
];
const STYLES = ["peony", "chrys", "ring", "willow", "palm", "strobe", "crossette"];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
function sphere() { // uniform point on the unit sphere
  const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(th), y: u, z: s * Math.sin(th) };
}

export function makeFireworks() {
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const size = new Float32Array(MAX);
  const drag = new Float32Array(MAX);   // air-resistance coefficient
  const gscale = new Float32Array(MAX); // per-particle gravity multiplier
  const flick = new Float32Array(MAX);  // twinkle amount (strobe/glitter)
  const aAlpha = new Float32Array(MAX);
  const aSize = new Float32Array(MAX);
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(aAlpha, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      varying vec3 vCol; varying float vA;
      void main() {
        vCol = color; vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (130.0 / max(0.001, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        // the spark cools to a warm ember as it dies → realistic firework fade
        vec3 c = mix(vec3(1.0, 0.42, 0.12), vCol, smoothstep(0.0, 0.6, vA));
        float core = smoothstep(0.25, 0.0, r2);
        float a = core * vA;
        gl_FragColor = vec4(c * (0.95 + 0.9 * vA) + vec3(core * vA * vA * 0.6), a);
      }`,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.userData.skipNormal = true;
  points.userData.noReflect = true;

  const rockets = [];
  const secondary = []; // delayed mini-bursts (crossette)
  const _c = new THREE.Color();
  const _WHITE = new THREE.Color(1, 1, 1);

  // burst flash: spikes when a shell explodes, decays each frame — drives the
  // festival point-light (lights up the animals) and a screen-wide flash.
  let flash = 0;
  const flashColor = new THREE.Color(1, 0.86, 0.6);

  function emit(x, y, z, vx, vy, vz, r, g, b, lifeS, sz, dragC, gs, fl) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    vel[i*3]=vx; vel[i*3+1]=vy; vel[i*3+2]=vz;
    col[i*3]=r; col[i*3+1]=g; col[i*3+2]=b;
    life[i]=lifeS; maxLife[i]=lifeS; size[i]=sz*0.78; drag[i]=dragC; gscale[i]=gs; flick[i]=fl;
  }

  // a bright near-white core pop at the heart of every shell (the flash you see
  // the instant it explodes)
  function core(x, y, z) {
    for (let k = 0; k < 16; k++) { const v = sphere(), sp = rand(1, 3.5);
      emit(x, y, z, v.x*sp, v.y*sp, v.z*sp, 1.0, 0.96, 0.85, rand(0.28, 0.5), rand(2.4, 3.4), 1.4, 1.0, 0.0); }
  }

  function burst(x, y, z, style, hex) {
    _c.set(hex); const r = _c.r, g = _c.g, b = _c.b;
    flash = Math.min(1.0, flash + (style === "strobe" ? 0.3 : 0.55)); // light up the sky
    flashColor.copy(_c).lerp(_WHITE, 0.4);
    core(x, y, z);
    if (style === "ring") {
      const n = 240, ax = rand(0, TAU), ay = rand(0, TAU); // random plane orientation
      const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU, sp = rand(7, 9) * (0.95 + 0.1 * Math.random());
        let dx = Math.cos(a), dy = Math.sin(a), dz = 0;       // ring in XY
        let ry = dy * cx - dz * sx, rz = dy * sx + dz * cx;   // tilt about X
        let rx = dx * cy + rz * sy, fz = -dx * sy + rz * cy;  // tilt about Y
        emit(x, y, z, rx*sp, ry*sp, fz*sp, r, g, b, rand(1.2, 1.7), rand(1.5, 2.2), 0.9, 1.0, 0.3);
      }
    } else if (style === "willow") {
      for (let k = 0; k < 320; k++) { const v = sphere(), sp = rand(5, 7.5);
        emit(x, y, z, v.x*sp, Math.abs(v.y)*sp*0.6 + rand(2,4), v.z*sp, 1.0, 0.82, 0.4,
             rand(2.6, 3.8), rand(1.6, 2.4), 0.45, 1.5, 0.12); }
    } else if (style === "palm") {
      for (let k = 0; k < 140; k++) { const v = sphere(), sp = rand(8, 11);
        emit(x, y, z, v.x*sp, Math.abs(v.y)*sp + rand(1,3), v.z*sp, r, g, b,
             rand(1.7, 2.5), rand(2.2, 3.2), 0.7, 1.1, 0.18); }
    } else if (style === "strobe") {
      for (let k = 0; k < 400; k++) { const v = sphere(), sp = rand(5, 8);
        emit(x, y, z, v.x*sp, v.y*sp, v.z*sp, r, g, b, rand(1.6, 2.4), rand(1.3, 1.9), 1.1, 1.0, 1.0); }
    } else if (style === "crossette") {
      for (let k = 0; k < 180; k++) { const v = sphere(), sp = rand(6, 8);
        emit(x, y, z, v.x*sp, v.y*sp, v.z*sp, r, g, b, rand(1.0, 1.4), rand(1.7, 2.4), 0.9, 1.0, 0.3); }
      for (let q = 0; q < 10; q++) secondary.push({ t: rand(0.55, 0.9), x, y, z, hex });
    } else { // peony / chrysanthemum — the big dense round shells
      const n = style === "chrys" ? 520 : 380, trail = style === "chrys";
      for (let k = 0; k < n; k++) { const v = sphere(), sp = rand(6.0, 9.5) * (0.9 + 0.2 * Math.random());
        emit(x, y, z, v.x*sp, v.y*sp, v.z*sp, r, g, b,
             rand(1.4, 2.1), rand(1.5, 2.3), trail ? 0.7 : 1.0, 1.0, trail ? 0.5 : 0.22); }
    }
  }

  function launch() {
    // burst just above the full-grown tree top (~20u), in the background sky
    // behind the tree (toward −x,−z) so it crowns the tree without covering it.
    // Apex kept low enough that the blooms stay inside the festival framing on
    // tall (portrait) screens with the raised camera.
    const apex = rand(17, 22);
    rockets.push({
      x: rand(-11, 3), y: 1.0, z: rand(-11, 3),
      vx: rand(-0.5, 0.5), vy: Math.sqrt(2 * G * (apex - 1.0)) * rand(0.97, 1.03), vz: rand(-0.5, 0.5),
      style: pick(STYLES), hex: pick(PALETTE), trailT: 0,
    });
  }

  let active = false, showT = 0, launchT = 0;

  function start(duration = 26) { active = true; showT = duration; launchT = 0.12; }
  function stop() { active = false; }

  function update(dt, time) {
    if (active) {
      showT -= dt; launchT -= dt;
      const finale = showT <= 5;
      if (launchT <= 0) {
        const n = finale ? 4 : (Math.random() < 0.35 ? 2 : 1);
        for (let q = 0; q < n; q++) launch();
        launchT = finale ? rand(0.1, 0.2) : rand(0.3, 0.6);
      }
      if (showT <= 0) active = false;
    }
    flash *= Math.exp(-3.4 * dt); // decay the burst flash

    for (let i = secondary.length - 1; i >= 0; i--) {
      const s = secondary[i]; s.t -= dt;
      if (s.t <= 0) { burst(s.x + rand(-1.2, 1.2), s.y + rand(-1, 1), s.z + rand(-1.2, 1.2), "peony", s.hex); secondary.splice(i, 1); }
    }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const rk = rockets[i];
      rk.vy -= G * dt; rk.x += rk.vx*dt; rk.y += rk.vy*dt; rk.z += rk.vz*dt;
      rk.trailT -= dt;
      if (rk.trailT <= 0) { rk.trailT = 0.018;
        emit(rk.x, rk.y, rk.z, rand(-0.3,0.3), rand(-0.4,0.2), rand(-0.3,0.3), 1.0, 0.7, 0.3, 0.4, 1.6, 1.4, 0.5, 0.25); }
      if (rk.vy <= 0) { burst(rk.x, rk.y, rk.z, rk.style, rk.hex); rockets.splice(i, 1); }
    }

    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { aAlpha[i] = 0; aSize[i] = 0; continue; }
      life[i] -= dt;
      const k = Math.exp(-drag[i] * dt);
      vel[i*3] *= k; vel[i*3+1] = vel[i*3+1]*k - G*gscale[i]*dt; vel[i*3+2] *= k;
      pos[i*3] += vel[i*3]*dt; pos[i*3+1] += vel[i*3+1]*dt; pos[i*3+2] += vel[i*3+2]*dt;
      let a = Math.max(0, life[i] / maxLife[i]);
      if (flick[i] > 0.5) a *= 0.45 + 0.55 * Math.sin(time * 38 + i * 1.7);
      aAlpha[i] = a; aSize[i] = size[i];
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  return {
    points, update, start, stop, flashColor,
    get flash() { return flash; },
    get active() { return active || rockets.length > 0 || secondary.length > 0; },
  };
}
