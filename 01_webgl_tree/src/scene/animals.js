import * as THREE from "three";
import { toonMaterial } from "../materials.js";
import { game } from "../config.js";

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
// Graze spots hug the tree (trunk at 2.6,1.2 — about 1.8-2 units out, just
// beyond the root spread), while avoiding the pond and the campfire.
const PATHS = [
  { enter: [-13, 3], graze: [1.1, 2.0], exit: [-13, -1] },
  { enter: [-9, -9], graze: [1.4, -0.2], exit: [-13, -7] },
  { enter: [3, -11], graze: [3.0, -0.6], exit: [6, -13] },
  { enter: [13, -7], graze: [4.0, -0.2], exit: [14, -9] },
  { enter: [-12, 7], graze: [0.9, 0.5], exit: [-13, 9] },
  { enter: [-7, 10], graze: [1.2, 2.6], exit: [-11, 12] },
];

// Visit pacing (in seconds of clear-weather daytime).
const GAP_MIN = 8, GAP_MAX = 26;   // wait between visits
// visitors settle in for roughly a morning (or an evening — they're happy to
// stay through the night) before wandering off
const GRAZE_DAY_MIN = 0.35, GRAZE_DAY_MAX = 0.55; // fraction of a day

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
      poopT: 0, // countdown to leaving a dropping mid-graze
      heading: 0,
    });
  });
  group.userData.noReflect = true; // keep barnyard out of the small pond mirror

  // ---- droppings: visitors leave one mid-graze; tap to collect (fertiliser).
  // A small recycled pool of dark lumps lying on the grass.
  const POOP_POOL = 8;
  const poopMat = toonMaterial(0x5c4630);
  const poops = [];
  for (let i = 0; i < POOP_POOL; i++) {
    // the classic soft-serve swirl: squashed tiers tapering upward, each one
    // nudged a little sideways so the stack curls, topped with a bent tip
    const lump = new THREE.Group();
    const TIERS = [
      [0.21, 0.06, 0, 0],
      [0.165, 0.155, 0.035, 0.02],
      [0.115, 0.235, 0.06, 0.045],
    ];
    for (const [r, y, ox, oz] of TIERS) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), poopMat);
      m.position.set(ox, y, oz);
      m.scale.y = 0.58; // squashed rings
      m.castShadow = true;
      m.receiveShadow = true;
      lump.add(m);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 6), poopMat);
    tip.position.set(0.1, 0.315, 0.075);
    tip.rotation.z = -0.55; // the little curl leaning off the top
    tip.castShadow = true;
    lump.add(tip);
    lump.scale.setScalar(1.55); // big enough to read above the grass tufts
    lump.visible = false;
    group.add(lump);
    poops.push({ on: false, mesh: lump });
  }

  function dropPoop(a) {
    // reuse a free slot, else recycle the oldest
    const slot = poops.find((p) => !p.on) || poops[0];
    slot.on = true;
    // a little behind the animal, so it reads as left there while grazing
    const bx = a.group.position.x - Math.cos(a.heading) * 0.6;
    const bz = a.group.position.z + Math.sin(a.heading) * 0.6;
    slot.mesh.position.set(bx, 0, bz);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.visible = true;
  }

  // tap pick-up: returns the dropping's world spot (and clears it) or null
  const _spot = new THREE.Vector3();
  function collectDroppingAt(ray, radius = 0.9) {
    for (const p of poops) {
      if (!p.on) continue;
      _spot.set(p.mesh.position.x, 0.18, p.mesh.position.z);
      if (ray.distanceSqToPoint(_spot) < radius * radius) {
        p.on = false;
        p.mesh.visible = false;
        return { x: p.mesh.position.x, z: p.mesh.position.z };
      }
    }
    return null;
  }

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
      api.onVisit?.(a.type); // let the game toast + journal the arrival
    }
  }

  // canArrive = clear daylight (new visitors only show up then); raining cuts
  // a visit short — but nightfall does NOT: an evening guest stays the night.
  function update(t, canArrive = true, raining = false) {
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;

    if (canArrive) {
      gap -= dt;
      if (gap <= 0) {
        startVisit();
        gap = rand(GAP_MIN, GAP_MAX);
      }
    }

    for (const a of anims) {
      if (a.state === "idle") { a.group.visible = false; continue; }
      // rain → seek shelter and walk off early (night is fine to stay)
      if (raining && a.state !== "leave") a.state = "leave";

      if (a.state === "enter") {
        if (walk(a, a.path.graze[0], a.path.graze[1], dt, t)) {
          a.state = "graze";
          a.grazeT = rand(GRAZE_DAY_MIN, GRAZE_DAY_MAX) * game.dayLengthSeconds;
          a.poopT = a.grazeT * rand(0.25, 0.7); // it'll happen sometime mid-graze
        }
      } else if (a.state === "graze") {
        graze(a, t);
        a.grazeT -= dt;
        if (a.poopT > 0) {
          a.poopT -= dt;
          if (a.poopT <= 0) {
            dropPoop(a);
            api.onPoop?.(a.type);
          }
        }
        if (a.grazeT <= 0) a.state = "leave";
      } else if (a.state === "leave") {
        if (walk(a, a.path.exit[0], a.path.exit[1], dt, t)) {
          a.state = "idle";
          a.group.visible = false;
        }
      }
    }
  }

  // onVisit(type) / onPoop(type) are assignable by the game for toasts;
  // collectDroppingAt(ray) is the tap pick-up test (→ fertiliser).
  const api = { group, update, onVisit: null, onPoop: null, collectDroppingAt };
  return api;
}
