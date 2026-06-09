import * as THREE from "three";
import { toonMaterial } from "../materials.js";

// Low-poly, cel-shaded barnyard animals that wander and graze on the meadow in
// clear weather. Built from simple boxes/icospheres to match the flat pixel-art
// register. Each animal strolls along a gentle looping path, turns to face its
// heading, swings its legs in a diagonal trot gait, and bobs its head.

const M = {
  cowBody: toonMaterial(0xf3efe8),
  cowSpot: toonMaterial(0x3b3733),
  muzzle: toonMaterial(0xd98c8c),
  sheepWool: toonMaterial(0xeae6dc),
  sheepFace: toonMaterial(0x46413c),
  dogBody: toonMaterial(0xb87a44),
  dogDark: toonMaterial(0x7a4f2c),
  hoof: toonMaterial(0x2c2825),
  horn: toonMaterial(0xd8cdb4),
};

function box(parent, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Four legs as hip-pivoted groups so they can swing from the shoulder.
// gait = ±1 puts the diagonal pairs (FL+BR vs FR+BL) in antiphase (a trot).
function legs(g, mat, halfX, halfZ, legH, legW) {
  const out = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * halfX, legH, sz * halfZ);
    const m = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), mat);
    m.position.y = -legH / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    hip.add(m);
    hip.userData.gait = sx * sz;
    g.add(hip);
    out.push(hip);
  }
  return out;
}

function makeCow() {
  const g = new THREE.Group();
  const legH = 0.42, bodyH = 0.5, bodyY = legH + bodyH / 2;
  const ls = legs(g, M.hoof, 0.34, 0.18, legH, 0.13);
  box(g, 1.0, bodyH, 0.52, M.cowBody, 0, bodyY, 0);
  box(g, 0.26, 0.3, 0.54, M.cowSpot, 0.18, bodyY + 0.02, 0);
  box(g, 0.2, 0.26, 0.56, M.cowSpot, -0.28, bodyY - 0.04, 0);
  const head = new THREE.Group(); head.position.set(0.55, bodyY + 0.16, 0); g.add(head);
  box(head, 0.34, 0.32, 0.34, M.cowBody, 0, 0, 0);
  box(head, 0.2, 0.18, 0.24, M.muzzle, 0.2, -0.06, 0);
  for (const sz of [-1, 1]) box(head, 0.07, 0.16, 0.07, M.horn, 0.02, 0.22, sz * 0.1);
  for (const sz of [-1, 1]) box(head, 0.1, 0.08, 0.14, M.cowBody, -0.02, 0.08, sz * 0.2);
  box(g, 0.06, 0.42, 0.06, M.cowSpot, -0.52, bodyY - 0.06, 0);
  return { group: g, head, legs: ls, bodyY };
}

function makeSheep() {
  const g = new THREE.Group();
  const legH = 0.3, bodyY = legH + 0.3;
  const ls = legs(g, M.sheepFace, 0.22, 0.14, legH, 0.1);
  for (const [x, y, z, r] of [[0, 0, 0, 0.42], [0.22, 0.05, 0, 0.32], [-0.22, 0.04, 0, 0.34], [0, 0.06, 0.18, 0.28], [0, 0.05, -0.18, 0.28]]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), M.sheepWool);
    m.position.set(x, bodyY + y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  const head = new THREE.Group(); head.position.set(0.42, bodyY + 0.02, 0); g.add(head);
  box(head, 0.2, 0.24, 0.2, M.sheepFace, 0, 0, 0);
  for (const sz of [-1, 1]) box(head, 0.08, 0.1, 0.12, M.sheepFace, -0.04, 0.1, sz * 0.14);
  return { group: g, head, legs: ls, bodyY };
}

function makeDog() {
  const g = new THREE.Group();
  const legH = 0.24, bodyH = 0.26, bodyY = legH + bodyH / 2;
  const ls = legs(g, M.dogDark, 0.2, 0.1, legH, 0.08);
  box(g, 0.6, bodyH, 0.26, M.dogBody, 0, bodyY, 0);
  const head = new THREE.Group(); head.position.set(0.34, bodyY + 0.12, 0); g.add(head);
  box(head, 0.22, 0.2, 0.2, M.dogBody, 0, 0, 0);
  box(head, 0.14, 0.1, 0.16, M.dogDark, 0.14, -0.04, 0);
  for (const sz of [-1, 1]) box(head, 0.05, 0.12, 0.1, M.dogDark, -0.06, 0.12, sz * 0.1);
  const tail = box(g, 0.06, 0.26, 0.06, M.dogBody, -0.32, bodyY + 0.1, 0);
  tail.rotation.z = 0.8;
  return { group: g, head, legs: ls, bodyY };
}

const BUILDERS = { cow: makeCow, sheep: makeSheep, dog: makeDog };

const TURN_RATE = 3.0;     // max heading change (rad/s) → no snap-turns
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// The animal pool — a few critters that take turns visiting (never all at once).
// [type, scale]
const POOL = [
  ["cow", 1.6], ["sheep", 1.5], ["sheep", 1.45], ["dog", 1.4], ["cow", 1.55],
];

// per-type gait
const TRAITS = {
  cow:   { spd: 1.0, stride: 7, amp: 0.5 },
  sheep: { spd: 1.35, stride: 8, amp: 0.5 },
  dog:   { spd: 2.1, stride: 10, amp: 0.7 },
};

// A few meadow routes: walk in from off-screen → graze spot → walk back out.
// All graze spots avoid the pond + tree base.
const PATHS = [
  { enter: [-13, 3], graze: [-5.5, 2.5], exit: [-13, -1] },
  { enter: [-9, -9], graze: [-3.5, -4.5], exit: [-13, -7] },
  { enter: [-12, 7], graze: [-5, 6], exit: [-13, 9] },
  { enter: [13, -7], graze: [8.5, -4], exit: [14, -9] },
  { enter: [3, -11], graze: [-1, -6.5], exit: [6, -13] },
  { enter: [-7, 10], graze: [-2.5, 8.5], exit: [-11, 12] },
];

// Visit pacing (in seconds of clear-weather daytime).
const GAP_MIN = 8, GAP_MAX = 26;   // wait between visits
const GRAZE_MIN = 4, GRAZE_MAX = 9; // how long a visitor lingers, head down

// Walk the animal toward (tx,tz); animate trot + heading. Returns true on arrival.
function walk(a, tx, tz, dt, t) {
  const px = a.group.position.x, pz = a.group.position.z;
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.2) return true;
  const step = Math.min(dist, a.spd * dt);
  a.group.position.x = px + (dx / dist) * step;
  a.group.position.z = pz + (dz / dist) * step;
  a.group.position.y = Math.abs(Math.sin(t * a.stride + a.phase)) * 0.04; // gentle bob

  const want = Math.atan2(-dz, dx); // model faces +x at heading 0
  let d = want - a.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  a.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, d));
  a.group.rotation.y = a.heading;

  const swing = Math.sin(t * a.stride + a.phase) * a.strideAmp;
  for (const hip of a.legs) hip.rotation.x = swing * hip.userData.gait;
  a.head.rotation.x = 0.1 + 0.08 * Math.sin(t * a.stride * 0.5 + a.phase);
  return false;
}

// Stand still, legs settling, head down nibbling at the grass.
function graze(a, t) {
  a.group.position.y = 0;
  for (const hip of a.legs) hip.rotation.x *= 0.82; // ease legs to a stand
  a.head.rotation.x = 0.72 + 0.08 * Math.sin(t * 6 + a.phase); // head down, nibbling
}

export function makeAnimals() {
  const group = new THREE.Group();
  const anims = [];
  POOL.forEach(([type, sc], i) => {
    const a = BUILDERS[type]();
    a.group.scale.setScalar(sc);
    a.group.visible = false;
    group.add(a.group);
    const tr = TRAITS[type];
    anims.push({
      ...a, type,
      spd: tr.spd, stride: tr.stride, strideAmp: tr.amp,
      phase: i * 1.7,
      state: "idle",    // idle → enter → graze → leave → idle
      path: null,
      grazeT: 0,
      heading: 0,
    });
  });
  group.userData.noReflect = true; // keep barnyard out of the small pond mirror

  let lastT = null;
  let gap = rand(2, 6); // first visitor wanders in a few seconds after load

  // Send 1 (usually) or 2 idle animals on a visit along distinct paths.
  function startVisit() {
    const idle = anims.filter((a) => a.state === "idle");
    if (!idle.length) return;
    const n = Math.min(Math.random() < 0.3 ? 2 : 1, idle.length);
    const paths = [...PATHS];
    for (let k = 0; k < n; k++) {
      const a = idle.splice(Math.floor(Math.random() * idle.length), 1)[0];
      const path = paths.splice(Math.floor(Math.random() * paths.length), 1)[0] || pick(PATHS);
      a.path = path;
      a.state = "enter";
      a.group.position.set(path.enter[0], 0, path.enter[1]);
      a.group.visible = true;
      a.heading = Math.atan2(-(path.graze[1] - path.enter[1]), path.graze[0] - path.enter[0]);
      a.group.rotation.y = a.heading;
    }
  }

  // active = clear daylight; visitors only arrive while it's true, and head out
  // early if it turns to night or rain. (frac is unused now — visits aren't
  // gated by tree growth.)
  function update(t, active = true) {
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;

    if (active) {
      gap -= dt;
      if (gap <= 0) {
        startVisit();
        gap = rand(GAP_MIN, GAP_MAX);
      }
    }

    for (const a of anims) {
      if (a.state === "idle") { a.group.visible = false; continue; }
      // bad weather / nightfall → cut the visit short and walk off
      if (!active && a.state !== "leave") a.state = "leave";

      if (a.state === "enter") {
        if (walk(a, a.path.graze[0], a.path.graze[1], dt, t)) {
          a.state = "graze";
          a.grazeT = rand(GRAZE_MIN, GRAZE_MAX);
        }
      } else if (a.state === "graze") {
        graze(a, t);
        a.grazeT -= dt;
        if (a.grazeT <= 0) a.state = "leave";
      } else if (a.state === "leave") {
        if (walk(a, a.path.exit[0], a.path.exit[1], dt, t)) {
          a.state = "idle";
          a.group.visible = false;
        }
      }
    }
  }

  return { group, update };
}
