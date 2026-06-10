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

// solid obstacles (set by makeAnimals): the tree, rocks, campfire — circles
// {x,z,r} — and the pond — an ellipse {x,z,rx,rz}. Animals walk AROUND all of
// these; only grass is passable, so they still wander through tufts.
// MAJOR is the subset that must never be overlapped (trunk/pond/hills/pavilion/
// campfire/boulders): the festival sprint uses it so the small meadow rocks
// can't pocket the herd into a dead end on the way to the stage.
let OBSTACLES = [];
let MAJOR = [];
function resolveXZ(x, z, list = OBSTACLES) {
  for (let pass = 0; pass < 2; pass++) {
    for (const o of list) {
      const dx = x - o.x, dz = z - o.z;
      if (o.rx) { // ellipse (the pond): push out along the normalized direction
        const d = Math.hypot(dx / o.rx, dz / o.rz);
        if (d < 1) {
          if (d < 1e-3) { x = o.x + o.rx; }
          else { x = o.x + dx / d; z = o.z + dz / d; }
        }
      } else {
        const d = Math.hypot(dx, dz);
        if (d < o.r) {
          if (d < 1e-3) { x = o.x + o.r; }
          else { const k = o.r / d; x = o.x + dx * k; z = o.z + dz * k; }
        }
      }
    }
  }
  return [x, z];
}

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
// Graze spots sit right beside the tree (trunk at 2.6,1.2 — kept ~2-3 units
// clear of it), while still avoiding the pond and the campfire.
// (enter/exit points are picked OFF the hill footprints — visitors come around
// the slopes through the gaps, never out of a hillside)
const PATHS = [
  { enter: [-13, 3], graze: [0.4, 2.2], exit: [-13, -1] },
  { enter: [-14, -4], graze: [0.2, -0.8], exit: [-15, -3] },
  { enter: [3, -11], graze: [3.2, -1.6], exit: [6, -13] },
  { enter: [13, -7], graze: [4.8, -1.2], exit: [14, -9] },
  { enter: [-12, 7], graze: [-0.6, 0.6], exit: [-13, 9] },
  { enter: [-7, 10], graze: [-0.2, 3.0], exit: [-11, 12] },
];

// Visit pacing (in seconds of clear-weather daytime).
const GAP_MIN = 8, GAP_MAX = 26;   // wait between visits
// visitors settle in for about half an in-game day before wandering off
const GRAZE_DAY_MIN = 0.45, GRAZE_DAY_MAX = 0.65; // fraction of a day

// Walk the animal toward (tx,tz); animate trot + heading. Returns true on
// arrival. `hustle` scales the pace (the festival gather is a sprint).
// Obstacles: a step that lands inside one is pushed back out by resolveXZ; if
// that cancels the whole step (a head-on stall against a rock), deflect the
// step sideways and walk AROUND the obstacle instead of marching in place.
function walk(a, tx, tz, dt, t, hustle = 1, list = OBSTACLES) {
  [tx, tz] = resolveXZ(tx, tz, list); // never aim into a rock / the tree
  const px = a.group.position.x, pz = a.group.position.z;
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.2) return true;
  const step = Math.min(dist, a.spd * hustle * dt);
  const ux = dx / dist, uz = dz / dist;
  let [nx, nz] = resolveXZ(px + ux * step, pz + uz * step, list); // slide around obstacles
  const moved = Math.hypot(nx - px, nz - pz);
  if (a.dodgeT > 0) {
    // committed WALL-FOLLOW: keep skirting the chosen side until the way ahead
    // opens up — flip-flopping sides each frame would pin us in concave pockets
    a.dodgeT -= dt;
    const skirt = step * 1.5;
    const [sx, sz] = resolveXZ(px - uz * skirt * a.dodge, pz + ux * skirt * a.dodge, list);
    if (Math.hypot(sx - px, sz - pz) > moved) { nx = sx; nz = sz; }
    else if (moved > step * 0.6) a.dodgeT = 0; // direct route is clear again
  } else if (moved < step * 0.25) {
    // stalled head-on: sample skirting BOTH ways, commit to whichever ends
    // closer to the target (with a bonus for actually moving)
    const skirt = step * 1.5;
    const [lx, lz] = resolveXZ(px - uz * skirt, pz + ux * skirt, list);
    const [rx, rz] = resolveXZ(px + uz * skirt, pz - ux * skirt, list);
    const sl = Math.hypot(tx - lx, tz - lz) - Math.hypot(lx - px, lz - pz) * 0.5;
    const sr = Math.hypot(tx - rx, tz - rz) - Math.hypot(rx - px, rz - pz) * 0.5;
    if (sl <= sr) { a.dodge = 1; nx = lx; nz = lz; } else { a.dodge = -1; nx = rx; nz = rz; }
    a.dodgeT = 0.7;
  }
  a.group.position.x = nx;
  a.group.position.z = nz;
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

// ANTHROPOMORPHIC DANCE BATTLE — locked to the MUSIC'S BEAT GRID.
//
// game mode measures the track (115.25 BPM) and feeds us, every frame:
//   • beat   — a sharp 0..1 pulse that SPIKES exactly on each beat and decays,
//   • beatStep — the exact beat index (no drift), bars are groups of 4,
//   • finale — true for the last stretch (everyone goes all-out).
//
// The animals rear up onto their hind legs (front legs become "arms") and battle
// in a cypher around the pond stage: each dancer gets an 8-beat turn (2 bars).
// The battler throws its own SIGNATURE power move — every count lands ON the
// beat — while the crew faces the battler and bounces/claps in rhythm, hitting
// the bar downbeat harder. In the finale everyone dances at battler intensity.
let danceLevel = 0;   // 0..1 music energy
let danceBeat = 0;    // 0..1 pulse, spikes exactly on each beat
let beatStep = 0;     // exact beat index from the music grid
let battleIdx = 0;    // who currently has the spotlight
let danceFinale = false;

const _approach = (cur, target, k) => cur + (target - cur) * Math.min(1, k);
const _approachAngle = (cur, target, k) => {
  let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * Math.min(1, k);
};

// BREAKING routine — clean keyframed POSES that snap onto each count and HOLD
// (continuous wobble reads as spasm; held poses that change exactly on the beat
// read as dancing). The battler runs the classic structure over its 8-beat turn:
//   counts 0-3 TOPROCK  — upright, big alternating arm throws, hop on the count
//   counts 4-5 DOWNROCK — drops low, fast alternating footwork on each count
//   count    6 POWER    — a full spin in exactly one beat (dog: two)
//   count    7 FREEZE   — held tilted pose, one arm to the sky, dead still
// The crew two-steps: weight shifts side to side per count, arm pumps, and the
// whole row throws both arms up on every bar's downbeat. The finale staggers the
// battler routine across everyone (offset by index → a coordinated wave).
const DANCE_BPM = 115.25; // must match game.js's measured beat grid
const FLAVOR = { // per-type feel: hop height, spin revolutions, pose snap speed
  cow:   { hop: 0.85, spin: 1, snap: 11 },
  sheep: { hop: 1.20, spin: 1, snap: 13 },
  dog:   { hop: 1.05, spin: 2, snap: 16 },
};

function dance(a, t, dt) {
  const f = FLAVOR[a.type] || FLAVOR.cow;
  const hit = danceBeat;                        // 1 exactly on the count → decays
  const step = beatStep;
  const bar = step % 4;                         // 0 = the bar's downbeat
  const solo = danceFinale || a.idx === battleIdx;
  const seq = (danceFinale ? step + a.idx * 2 : step) % 8; // finale: staggered wave
  const energy = 0.6 + 0.4 * danceLevel;
  const L = (step & 1) === 0;                   // which side this count lands on

  // pose channels (targets; snapped to at f.snap rate, then HELD)
  let rear = 1.05, roll = 0, hop = 0, armL = -0.9, armR = -0.9, legKick = 0, head = -0.1;
  let face = FRONT_FACE, snap = f.snap;

  if (solo && seq === 6) {
    // POWER SPIN — exactly f.spin revolutions in this one beat, low + tight
    rear = 1.0; hop = 0.3;
    armL = armR = -1.7;
    a.heading += dt * Math.PI * 2 * (DANCE_BPM / 60) * f.spin;
    face = null;
  } else if (solo && seq === 7) {
    // FREEZE — tall, tilted, one arm to the sky; rock-still until the next turn
    rear = 1.5; roll = 0.32; hop = 0;
    armL = -2.4; armR = 0.5; head = -0.35; snap = 18;
  } else if (solo && seq >= 4) {
    // DOWNROCK — low to the floor, feet flick alternately on every count
    rear = 0.45; hop = hit * 0.18;
    armL = armR = -0.5;
    legKick = (L ? 1 : -1) * (0.5 + hit * 0.9);
    head = 0.15;
  } else if (solo) {
    // TOPROCK — upright; arms trade BIG throws every count; downbeat hits harder
    rear = 1.3; roll = (L ? 1 : -1) * 0.22;
    hop = hit * 0.55 * f.hop * energy * (bar === 0 ? 1.3 : 1);
    armL = L ? -2.1 : -0.4;
    armR = L ? -0.4 : -2.1;
    head = -0.15 + hit * 0.35;
  } else {
    // CREW two-step — weight shift per count, pump the near arm, both arms up
    // + a bigger hop on each bar's downbeat; always watching the battler
    const down = bar === 0;
    rear = 1.02; roll = (L ? 1 : -1) * 0.14;
    hop = hit * (down ? 0.45 : 0.26) * energy;
    armL = down ? -1.7 : L ? -1.3 : -0.5;
    armR = down ? -1.7 : L ? -0.5 : -1.3;
    head = -0.08 + hit * 0.3;
    const s = FRONT_SLOTS[battleIdx % FRONT_SLOTS.length];
    face = danceFinale ? FRONT_FACE : Math.atan2(-(s.z - a.slot.z), s.x - a.slot.x);
  }

  // ease into the pose fast (≈1/snap s) so each hit SNAPS, then holds still
  const k = dt * snap;
  a.group.rotation.z = _approach(a.group.rotation.z, rear, k);
  a.group.rotation.x = _approach(a.group.rotation.x, roll, k);
  if (face != null) a.heading = _approachAngle(a.heading, face, dt * (solo ? 9 : 5));
  a.group.rotation.y = a.heading;

  // hold the slot (slots live on open front-row grass; pond/tree/hills solid)
  const [nx, nz] = resolveXZ(_approach(a.group.position.x, a.slot.x, dt * 3), _approach(a.group.position.z, a.slot.z, dt * 3), MAJOR);
  a.group.position.x = nx; a.group.position.z = nz;

  // limbs: front legs are the raised "arms", back legs step/kick — pose-driven
  const [bl, br, al, ar] = a.legs; // [back-left, back-right, arm-left, arm-right]
  al.rotation.x = _approach(al.rotation.x, armL, k);
  ar.rotation.x = _approach(ar.rotation.x, armR, k);
  bl.rotation.x = _approach(bl.rotation.x, legKick + hit * 0.25, k);
  br.rotation.x = _approach(br.rotation.x, -legKick - hit * 0.25, k);
  a.head.rotation.x = _approach(a.head.rotation.x, head, k);

  // lift the body so the rear-up / freeze tilt never sinks it through the ground
  const gs = a.group.scale.x || 1;
  const lift = Math.sin(Math.max(0, a.group.rotation.z)) * 0.6 * gs
             + Math.abs(Math.sin(a.group.rotation.x)) * 0.35 * gs;
  a.group.position.y = hop + lift;
}

// The FINISHING POSE — when the show ends, each animal snaps into its own hero
// pose facing the crowd and HOLDS it, dead still, while the last shells fade:
//   cow   — victory V: tall on the hind legs, both arms thrown to the sky
//   sheep — cool tilt: leaned way over, one arm up, one tucked, chin high
//   dog   — b-boy lunge: crouched low, one arm punched forward-up
const END_POSES = {
  cow:   { rear: 1.55, roll: 0.0,  armL: -2.5, armR: -2.5, head: -0.4 },
  sheep: { rear: 1.4,  roll: 0.38, armL: -2.3, armR: 0.6,  head: -0.3 },
  dog:   { rear: 0.85, roll: -0.2, armL: -2.0, armR: -0.3, head: -0.25 },
};

function strikePose(a, dt) {
  const p = END_POSES[a.type] || END_POSES.cow;
  const k = dt * 10; // confident snap into the pose, then hold
  a.heading = _approachAngle(a.heading, FRONT_FACE, k);
  a.group.rotation.y = a.heading;
  a.group.rotation.z = _approach(a.group.rotation.z, p.rear, k);
  a.group.rotation.x = _approach(a.group.rotation.x, p.roll, k);
  const [bl, br, al, ar] = a.legs;
  al.rotation.x = _approach(al.rotation.x, p.armL, k);
  ar.rotation.x = _approach(ar.rotation.x, p.armR, k);
  bl.rotation.x = _approach(bl.rotation.x, 0, k);
  br.rotation.x = _approach(br.rotation.x, 0, k);
  a.head.rotation.x = _approach(a.head.rotation.x, p.head, k);
  const gs = a.group.scale.x || 1;
  a.group.position.y = Math.sin(Math.max(0, a.group.rotation.z)) * 0.6 * gs
                     + Math.abs(Math.sin(a.group.rotation.x)) * 0.35 * gs;
}

// Dance stage: a FRONT ROW across the BOTTOM of the screen at the game's
// default framing (camera yaw 0.85 → on the ground, screen-down ≈ (+0.998,
// −0.065), screen-right ≈ (−0.0645, −0.998)). The low iso camera compresses
// ground depth to ~0.23 screen-units per world unit, so reading "front row"
// on the phone takes a real ~17 ground units toward the camera: the row lands
// at x ≈ 18.8 — open flat meadow (mountain ring only rises past r ≈ 28),
// 15+ units clear of the trunk, pond, campfire and every rock, so the dancers
// physically CANNOT touch any of them (slots still pass resolveXZ at party
// start as a final guarantee).
const STAGE_DOWN = { x: 0.998, z: -0.065 };   // toward the camera (screen-down)
const STAGE_RIGHT = { x: -0.0645, z: -0.998 }; // along the screen to the right
const STAGE_BASE = { x: 1.8 + STAGE_DOWN.x * 15.0, z: 1.0 + STAGE_DOWN.z * 15.0 };
const FRONT_FACE = Math.atan2(-STAGE_DOWN.z, STAGE_DOWN.x); // face the camera
const FRONT_SLOTS = [-5.0, -2.5, 0, 2.5, 5.0].map((s) => ({
  x: STAGE_BASE.x + s * STAGE_RIGHT.x,
  z: STAGE_BASE.z + s * STAGE_RIGHT.z,
}));

export function makeAnimals(obstacles = [], majorObstacles = obstacles) {
  OBSTACLES = obstacles;
  MAJOR = majorObstacles;
  const group = new THREE.Group();
  const anims = [];
  POOL.forEach(([type, sc], i) => {
    const a = BUILDERS[type]();
    a.group.scale.setScalar(sc);
    a.group.visible = false;
    group.add(a.group);
    const tr = TRAITS[type];
    anims.push({
      ...a, type, baseScale: sc,
      spd: tr.spd, stride: tr.stride, strideAmp: tr.amp,
      phase: i * 1.7,
      state: "idle",    // idle → enter → graze → leave → idle
      path: null,
      grazeT: 0,
      heading: 0,
      dodge: 1,         // wall-follow side while skirting an obstacle
      dodgeT: 0,        // commitment time left on that side
    });
  });
  group.userData.noReflect = true; // keep barnyard out of the small pond mirror

  let lastT = null;
  let gap = rand(2, 6); // first visitor wanders in a few seconds after load
  let party = false;

  // Festival! Every animal gathers to the front row and breakdances. Overrides
  // the normal visit logic until turned off (then they disperse off-screen).
  function setParty(on) {
    party = !!on;
    if (on) {
      beatStep = 0; battleIdx = 0;
      anims.forEach((a, i) => {
        const sl = FRONT_SLOTS[i % FRONT_SLOTS.length];
        const [sx, sz] = resolveXZ(sl.x, sl.z, MAJOR); // slots clear of pond/hills/trunk
        a.slot = { x: sx, z: sz };
        a.idx = i;                                   // place in the battle order
        a.state = "gather";
        a.group.visible = true;
        a.group.scale.setScalar(a.baseScale * 1.3); // stand out for the show
        // sprint pace sized so EVERYONE reaches the stage in ~4s, however far
        // they start (and whatever the frame rate manages)
        const d = Math.hypot(sx - a.group.position.x, sz - a.group.position.z);
        a.hustle = Math.max(3.2, d / (4 * a.spd));
      });
    } else {
      anims.forEach((a) => {
        a.group.rotation.z = 0;
        a.group.rotation.x = 0;
        a.group.scale.setScalar(a.baseScale);
        a.state = "leave";
        // disperse past the camera (clear, hill-free ground off the bottom edge)
        a.path = { exit: [21, a.group.position.z] };
      });
    }
  }

  // beat from the festival music — pulse + the EXACT beat index from the track's
  // measured grid (115.25 BPM), so the choreography can never drift off-rhythm.
  function setBeat(level, beat, step = beatStep, finale = false) {
    danceLevel = level;
    danceBeat = beat;
    beatStep = step;
    danceFinale = finale;
    battleIdx = Math.floor(step / 8) % anims.length; // spotlight passes every 2 bars
  }

  // the show's last seconds: everyone snaps into their hero pose and holds it
  function endPose() {
    anims.forEach((a) => { if (a.state === "dance") a.state = "pose"; });
  }

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
      const [ex, ez] = resolveXZ(path.enter[0], path.enter[1]); // never spawn inside anything
      a.group.position.set(ex, 0, ez);
      a.group.visible = true;
      a.heading = Math.atan2(-(path.graze[1] - path.enter[1]), path.graze[0] - path.enter[0]);
      a.group.rotation.y = a.heading;
      api.onVisit?.(a.type); // let the game toast + journal the arrival
    }
  }

  // active = clear daylight; visitors only arrive while it's true, and head out
  // early if it turns to night or rain. (frac is unused now — visits aren't
  // gated by tree growth.)
  function update(t, active = true) {
    const dt = lastT == null ? 0 : Math.min(0.08, Math.max(0, t - lastT));
    lastT = t;

    // festival: everyone sprints to the front-row stage, dance-battles, and
    // finishes in a held hero pose
    if (party) {
      for (const a of anims) {
        a.group.visible = true;
        if (a.state === "pose") {
          strikePose(a, dt);
        } else if (a.state === "dance") {
          dance(a, t, dt);
        } else if (walk(a, a.slot.x, a.slot.z, dt, t, a.hustle || 3.2, MAJOR)) { // sprint → arrive
          a.state = "dance";
          a.heading = FRONT_FACE;
        }
      }
      // dancers are solid too: pairwise push-apart so they never overlap on the
      // stage. Only settled dancers push — a sprinting runner must not shove a
      // neighbour into a rock's push field (that sandwich deadlocks them both).
      const onStage = (s) => s === "dance" || s === "pose";
      for (let i = 0; i < anims.length; i++) {
        for (let k = i + 1; k < anims.length; k++) {
          if (!onStage(anims[i].state) || !onStage(anims[k].state)) continue;
          const A = anims[i].group.position, B = anims[k].group.position;
          const dx = B.x - A.x, dz = B.z - A.z;
          const d = Math.hypot(dx, dz), min = 2.1;
          if (d < min && d > 1e-4) {
            const push = (min - d) * 0.5, ux = dx / d, uz = dz / d;
            [A.x, A.z] = resolveXZ(A.x - ux * push, A.z - uz * push, MAJOR);
            [B.x, B.z] = resolveXZ(B.x + ux * push, B.z + uz * push, MAJOR);
          }
        }
      }
      return;
    }

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
          a.grazeT = rand(GRAZE_DAY_MIN, GRAZE_DAY_MAX) * game.dayLengthSeconds;
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

  // onVisit(type) is assignable by the game to be told when a visitor arrives
  const api = { group, update, party: setParty, setBeat, endPose, onVisit: null };
  api.debug = () => anims.map((a) => ({
    type: a.type, state: a.state,
    x: +a.group.position.x.toFixed(1), z: +a.group.position.z.toFixed(1),
    slot: a.slot ? `${a.slot.x.toFixed(1)},${a.slot.z.toFixed(1)}` : null,
  }));
  return api;
}
