import * as THREE from "three";

// Watering-can burst — a short shower of droplets sprinkled over the tree when
// the player taps Water. Unlike the weather rain (screen-space streaks + storm
// grade), this is a local, friendly sprinkle: a few hundred pale-blue droplets
// spawn in a disc above the canopy, fall through it and vanish at the ground.
// All motion runs in the vertex shader off a single "seconds since trigger"
// uniform, so the burst costs nothing while idle.
export function makeWatering({ count = 320, color = 0x8fd0f5, ripple = true } = {}) {
  const disc = new Float32Array(count * 2); // unit-disc xz, denser middle
  const delay = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    disc[i * 2] = Math.cos(a) * r;
    disc[i * 2 + 1] = Math.sin(a) * r;
    delay[i] = Math.random() * 0.9; // staggered so it reads as a pour
    speed[i] = 9 + Math.random() * 5;
    size[i] = 5 + Math.random() * 4;
  }

  const geo = new THREE.BufferGeometry();
  // dummy position attribute (real position comes from the uniforms + aDisc)
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aDisc", new THREE.BufferAttribute(disc, 2));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      uT: { value: -1 }, // seconds since trigger (-1 = idle)
      uCenter: { value: new THREE.Vector3(2.6, 0, 1.2) },
      uTop: { value: 16 }, // spawn height above the ground
      uRadius: { value: 4 }, // sprinkle disc radius
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aDisc;
      attribute float aDelay;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uT;
      uniform vec3 uCenter;
      uniform float uTop;
      uniform float uRadius;
      varying float vAlpha;
      void main() {
        float t = uT - aDelay;
        float y = uTop - t * aSpeed;
        // alive while falling between the spawn height and the ground
        float alive = step(0.0, t) * step(0.15, y) * step(0.0, uT);
        vAlpha = alive * smoothstep(0.15, 1.2, y); // fade just before landing
        vec3 p = uCenter + vec3(aDisc.x * uRadius, max(y, 0.15), aDisc.y * uRadius);
        // a tiny sideways waggle so drops don't fall in dead-straight lines
        p.x += sin(t * 7.0 + aDelay * 40.0) * 0.06;
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
        // a thin vertical streak so each drop reads as falling water
        float a = (1.0 - smoothstep(0.06, 0.18, abs(d.x))) * (1.0 - smoothstep(0.3, 0.5, abs(d.y))) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.visible = false;
  points.userData.skipNormal = true; // stay out of the outline pass
  points.userData.noReflect = true; // and out of the pond mirror
  points.renderOrder = 2;

  // ---- local ground ripples: rain-splash style rings, but only inside the
  // watering disc, and only while drops are actually landing ----------------
  const SPLASH_N = 60;
  const splashGeo = new THREE.PlaneGeometry(1, 1);
  const sPhase = new Float32Array(SPLASH_N);
  const sRate = new Float32Array(SPLASH_N);
  for (let i = 0; i < SPLASH_N; i++) {
    sPhase[i] = Math.random();
    sRate[i] = 0.8 + Math.random() * 0.8;
  }
  splashGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(sPhase, 1));
  splashGeo.setAttribute("aRate", new THREE.InstancedBufferAttribute(sRate, 1));

  const splashMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uWet: { value: 0 }, // ramps in while drops land, then dries out
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
        vCyc = fract(uTime * aRate + aPhase); // 0 → 1 splash cycle
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vCyc;
      uniform float uWet;
      uniform vec3 uColor;
      void main() {
        if (uWet < 0.01) discard;
        float d = length((vUv - 0.5) * 2.0);
        float R = vCyc; // ring expands outward
        float crest = smoothstep(0.16, 0.0, abs(d - R));
        float trail = smoothstep(0.30, 0.0, abs(d - R * 0.55)) * 0.35;
        float fade = (1.0 - vCyc) * (1.0 - vCyc);
        float a = (crest + trail) * fade * uWet;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a * 0.55);
      }
    `,
  });
  const splash = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_N);
  splash.frustumCulled = false;
  splash.visible = false;
  splash.userData.skipNormal = true;
  splash.userData.noReflect = true;
  splash.renderOrder = 2;

  // scatter the rings across the current watering disc
  const _q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  function placeSplashes(center, radius) {
    for (let i = 0; i < SPLASH_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.95;
      const sz = 0.4 + Math.random() * 0.5;
      _p.set(center.x + Math.cos(a) * r, 0.09, center.z + Math.sin(a) * r);
      _s.set(sz, sz, sz);
      _m.compose(_p, _q, _s);
      splash.setMatrixAt(i, _m);
    }
    splash.instanceMatrix.needsUpdate = true;
  }

  const group = new THREE.Group();
  group.add(points, splash);

  let pending = false;
  let t0 = null;
  const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

  // sprinkle over the tree as it currently stands (height/radius follow growth)
  function trigger(center, top, radius) {
    if (center) material.uniforms.uCenter.value.copy(center);
    if (top != null) material.uniforms.uTop.value = top;
    if (radius != null) material.uniforms.uRadius.value = radius;
    placeSplashes(material.uniforms.uCenter.value, material.uniforms.uRadius.value);
    pending = true;
  }

  // called every frame with the global clock time
  function setTime(t) {
    if (pending) {
      t0 = t;
      pending = false;
      points.visible = true;
      splash.visible = ripple;
    }
    if (t0 == null) return;
    const el = t - t0;
    material.uniforms.uT.value = el;

    // ground gets wet while drops are landing (first drop → last drop + a tail)
    const top = material.uniforms.uTop.value;
    const firstLand = (top - 0.15) / 14;
    const lastLand = 0.9 + (top - 0.15) / 9;
    const wet = ss(firstLand, firstLand + 0.35, el) * (1 - ss(lastLand, lastLand + 0.7, el));
    splashMat.uniforms.uWet.value = wet;
    splashMat.uniforms.uTime.value = t;

    if (el > lastLand + 1.0) {
      t0 = null;
      points.visible = false;
      splash.visible = false;
      material.uniforms.uT.value = -1;
      splashMat.uniforms.uWet.value = 0;
    }
  }

  return { group, points, trigger, setTime };
}
