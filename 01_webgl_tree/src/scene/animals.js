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
const _ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
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

// ---- A* router (the festival gather must NEVER strand a dancer) -----------
// A coarse grid over the meadow; cells inside any obstacle are blocked. A* with
// no corner-cutting finds a guaranteed route, then line-of-sight smoothing
// reduces it to a few waypoints. Local steering only has to follow short,
// provably-clear legs, so concave rock/hill/campfire pockets can't trap anyone.
const NAV = { x0: -22, x1: 26, z0: -18, z1: 18, cell: 0.6 };

function navBlocked(x, z, list) {
  for (const o of list) {
    const dx = x - o.x, dz = z - o.z;
    if (o.rx) { if (Math.hypot(dx / (o.rx + 0.2), dz / (o.rz + 0.2)) < 1) return true; }
    else if (Math.hypot(dx, dz) < o.r + 0.2) return true;
  }
  return false;
}

function findPath(sx, sz, tx, tz, list) {
  const W = Math.round((NAV.x1 - NAV.x0) / NAV.cell);
  const H = Math.round((NAV.z1 - NAV.z0) / NAV.cell);
  const cellX = (i) => NAV.x0 + (i % W) * NAV.cell;
  const cellZ = (i) => NAV.z0 + ((i / W) | 0) * NAV.cell;
  const toIdx = (x, z) => {
    const ix = Math.min(W - 1, Math.max(0, Math.round((x - NAV.x0) / NAV.cell)));
    const iz = Math.min(H - 1, Math.max(0, Math.round((z - NAV.z0) / NAV.cell)));
    return iz * W + ix;
  };
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) blocked[i] = navBlocked(cellX(i), cellZ(i), list) ? 1 : 0;

  // snap endpoints to the nearest free cell (an animal pushed onto a rim, or a
  // slot brushing an obstacle, must still route)
  const nearestFree = (i0) => {
    if (!blocked[i0]) return i0;
    const x0 = i0 % W, z0 = (i0 / W) | 0;
    for (let r = 1; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = x0 + dx, z = z0 + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        if (!blocked[z * W + x]) return z * W + x;
      }
    }
    return i0;
  };
  const s = nearestFree(toIdx(sx, sz));
  const t = nearestFree(toIdx(tx, tz));

  const g = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const open = [s];
  g[s] = 0;
  const hcost = (i) => Math.hypot((i % W) - (t % W), ((i / W) | 0) - ((t / W) | 0));
  while (open.length) {
    let bk = 0, bf = g[open[0]] + hcost(open[0]);
    for (let k = 1; k < open.length; k++) { const f = g[open[k]] + hcost(open[k]); if (f < bf) { bf = f; bk = k; } }
    const cur = open.splice(bk, 1)[0];
    if (cur === t) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W, cz = (cur / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const ni = nz * W + nx;
      if (blocked[ni] || closed[ni]) continue;
      if (dx && dz && (blocked[cz * W + nx] || blocked[nz * W + cx])) continue; // no corner cutting
      const ng = g[cur] + Math.hypot(dx, dz);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; if (!open.includes(ni)) open.push(ni); }
    }
  }
  if (t !== s && came[t] === -1) return null; // no route (shouldn't happen on this map)

  const cells = [t];
  for (let c = t; c !== s && came[c] !== -1;) { c = came[c]; cells.push(c); }
  cells.reverse();
  const pts = cells.map((i) => ({ x: cellX(i), z: cellZ(i) }));
  pts.push({ x: tx, z: tz });

  // line-of-sight smoothing: keep only the waypoints that turn a corner
  const clearSeg = (A, B) => {
    const n = Math.ceil(Math.hypot(B.x - A.x, B.z - A.z) / 0.3);
    for (let k = 1; k < n; k++) {
      const u = k / n;
      if (navBlocked(A.x + (B.x - A.x) * u, A.z + (B.z - A.z) * u, list)) return false;
    }
    return true;
  };
  const route = [];
  let anchor = { x: sx, z: sz };
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearSeg(anchor, pts[j])) j--;
    anchor = pts[j];
    route.push(anchor);
    if (j === pts.length - 1) break;
    i = j + 1;
  }
  return route;
}

// The animal pool — a few critters that take turns visiting (never all at once).
// [type, scale] — kept on the small side so they slip easily between the
// rocks, the campfire and the tree without ever looking wedged.
// base scales (0.7× the previous size — daintier visitors)
const POOL = [
  ["cow", 0.91], ["sheep", 0.84], ["sheep", 0.805], ["dog", 0.77], ["cow", 0.875],
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
// (enter/exit points are picked OFF the hill footprints — visitors come around
// the slopes through the gaps, never out of a hillside)
const PATHS = [
  { enter: [-13, 3], graze: [1.1, 2.0], exit: [-13, -1] },
  { enter: [-14, -4], graze: [1.4, -0.2], exit: [-15, -3] },
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

// the cedar (matches world.js: tree.position = (2.6, 0, 1.2))
const TREE = { x: 2.6, z: 1.2 };
// pre-cleared viewing spots ringing the trunk (just outside its ~2.08 obstacle
// radius, all in open meadow — never in the pond or a rock), so the walk to
// admire always has a reachable target instead of snapping somewhere odd.
const ADMIRE_SPOTS = [
  [2.6, 3.6], [0.2, 1.2], [0.9, -0.6], [4.3, -0.6], [2.6, -1.3],
];

// stand before the tree, turn to face it, and gaze UP at the canopy
function admire(a, t, dt) {
  a.group.position.y = 0;
  for (const hip of a.legs) hip.rotation.x *= 0.82; // legs settle
  // smoothly turn to face the tree
  const want = Math.atan2(-(TREE.z - a.group.position.z), TREE.x - a.group.position.x);
  let d = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading));
  a.heading += Math.max(-3 * dt, Math.min(3 * dt, d));
  a.group.rotation.y = a.heading;
  // head tilts UP, looking at the canopy, with a slow gentle bob
  a.head.rotation.x = -0.32 + 0.07 * Math.sin(t * 1.6 + a.phase);
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
// (distance re-derived for the raised 8.0-high eye: depth compression is now
// ~0.40 screen-units per ground unit, so 13.5 units forward sits just above
// the HUD at the festival's pulled-back framing)
const STAGE_BASE = { x: 1.8 + STAGE_DOWN.x * 13.5, z: 1.0 + STAGE_DOWN.z * 13.5 };
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
      ...a, type, sc, baseScale: sc,
      spd: tr.spd, stride: tr.stride, strideAmp: tr.amp,
      phase: i * 1.7,
      state: "idle",    // idle → enter → graze → leave → idle (or → tofire → roast)
      path: null,
      grazeT: 0,
      poopT: 0, // countdown to leaving a dropping mid-graze
      roastT: 0,
      heading: 0,
      dodge: 1,         // wall-follow side while skirting an obstacle
      dodgeT: 0,        // commitment time left on that side
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

  // tap test: returns the visiting animal the pick ray touches, or null
  const _body = new THREE.Vector3();
  function animalAt(ray) {
    for (const a of anims) {
      if (!["enter", "graze", "toadmire", "admire"].includes(a.state)) continue;
      const s = a.group.scale.x;
      _body.copy(a.group.position);
      _body.y += 0.55 * s; // aim at the body, not the feet
      if (ray.distanceSqToPoint(_body) < (1.1 * s) ** 2) return a;
    }
    return null;
  }

  // lead a visitor to the campfire; it vanishes there (… into bone meal).
  // A*-routed like every other walk (the campfire itself is an obstacle, so
  // the route's endpoint snaps to the nearest free spot at its rim).
  function sendToFire(a, fx, fz) {
    a.state = "tofire";
    a.fire = [fx, fz];
    // route IGNORING the campfire's own obstacle so it walks right INTO the
    // flames (not to the rim), then roasts at the centre
    const list = OBSTACLES.filter((o) => Math.hypot((o.x || 0) - fx, (o.z || 0) - fz) > 1.2);
    planTo(a, fx, fz, list);
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
  let party = false;
  let posing = false; // the end pose has been called — late arrivals join it

  // ---- universal A* travel: EVERY walk is a planned route -------------------
  // Visits, exits, the march to the campfire and the festival sprint all use
  // the same machinery: plan against an obstacle list (the full list for
  // everyday strolls, MAJOR for the festival sprint), follow it waypoint by
  // waypoint, and re-plan in place if progress ever stalls — so no animal can
  // be caught on a rock, a hillside, the pavilion, the pond or the campfire.
  function planTo(a, tx, tz, list = OBSTACLES) {
    a.goal = { x: tx, z: tz };
    a.routeList = list;
    a.route = findPath(a.group.position.x, a.group.position.z, tx, tz, list) || [a.goal];
    a.wp = 0;
    a.stuckT = 0; a.lastPX = a.group.position.x; a.lastPZ = a.group.position.z;
  }

  // follow the current route; returns true when the FINAL goal is reached
  function followRoute(a, dt, t, hustle = 1) {
    const list = a.routeList || OBSTACLES;
    const route = a.route || [a.goal];
    const wp = route[Math.min(a.wp || 0, route.length - 1)];
    const lastLeg = (a.wp || 0) >= route.length - 1;
    if (walk(a, wp.x, wp.z, dt, t, hustle, list)) {
      if (lastLeg) return true;
      a.wp++;
    }
    // watchdog: no real progress for ~1.2s (shoved by a neighbour, wedged on a
    // rim, anything) → re-plan from where it stands; it can always route out
    a.stuckT += dt;
    if (a.stuckT > 1.2) {
      if (Math.hypot(a.group.position.x - a.lastPX, a.group.position.z - a.lastPZ) < 0.25) {
        a.route = findPath(a.group.position.x, a.group.position.z, a.goal.x, a.goal.z, list) || [a.goal];
        a.wp = 0;
      }
      a.stuckT = 0; a.lastPX = a.group.position.x; a.lastPZ = a.group.position.z;
    }
    return false;
  }

  // Festival! Every animal gathers to the front row and breakdances. Overrides
  // the normal visit logic until turned off (then they disperse off-screen).
  function setParty(on) {
    party = !!on;
    if (on) {
      beatStep = 0; battleIdx = 0; posing = false;
      anims.forEach((a, i) => {
        const sl = FRONT_SLOTS[i % FRONT_SLOTS.length];
        const [sx, sz] = resolveXZ(sl.x, sl.z, MAJOR); // slots clear of pond/hills/trunk
        a.slot = { x: sx, z: sz };
        a.idx = i;                                   // place in the battle order
        a.state = "gather";
        a.group.visible = true;
        a.group.scale.setScalar(a.baseScale * 1.3); // stand out for the show
        // A* route to the stage (guaranteed clear of every major obstacle)
        planTo(a, sx, sz, MAJOR);
        // sprint pace sized from the ACTUAL route length (detours included) so
        // everyone reaches the stage in ~4.5s, whatever the way around
        let len = 0, px = a.group.position.x, pz = a.group.position.z;
        for (const w of a.route) { len += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; }
        a.hustle = Math.max(3.2, len / (4.5 * a.spd));
      });
    } else {
      anims.forEach((a) => {
        a.group.rotation.z = 0;
        a.group.rotation.x = 0;
        a.group.scale.setScalar(a.baseScale);
        a.state = "leave";
        // disperse past the camera through the GAP between the mid-distance
        // hills at (27,-5) and (26,15) — off the bottom edge, never up a slope
        planTo(a, 23, Math.max(1.5, Math.min(8, a.group.position.z)));
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
  // (anyone still sprinting in joins the pose the moment they arrive)
  function endPose() {
    posing = true;
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
      planTo(a, path.graze[0], path.graze[1]); // A* in — around every rock/hill
      a.heading = Math.atan2(-(path.graze[1] - path.enter[1]), path.graze[0] - path.enter[0]);
      a.group.rotation.y = a.heading;
      api.onVisit?.(a.type); // let the game toast + journal the arrival
    }
  }

  // canArrive = clear daylight (new visitors only show up then); raining cuts
  // a visit short — but nightfall does NOT: an evening guest stays the night.
  function update(t, canArrive = true, raining = false) {
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
        } else if (followRoute(a, dt, t, a.hustle || 3.2)) {
          // arrived on stage (late arrivals join the held pose directly)
          a.state = posing ? "pose" : "dance";
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
      // final guarantee: nobody on the stage sits inside any major obstacle
      for (const a of anims) {
        if (!a.group.visible) continue;
        const p = a.group.position;
        [p.x, p.z] = resolveXZ(p.x, p.z, MAJOR);
      }
      return;
    }

    if (canArrive) {
      gap -= dt;
      if (gap <= 0) {
        startVisit();
        gap = rand(GAP_MIN, GAP_MAX);
      }
    }

    for (const a of anims) {
      if (a.state === "idle") { a.group.visible = false; continue; }
      // rain → seek shelter and walk off early (night is fine to stay;
      // a march to the fire is, alas, not interrupted by weather)
      if (raining && a.state !== "leave" && a.state !== "tofire") {
        a.state = "leave";
        planTo(a, a.path.exit[0], a.path.exit[1]);
      }

      if (a.state === "enter") {
        if (followRoute(a, dt, t)) {
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
        if (a.grazeT <= 0) {
          // ...then wander up to the tree for a look before heading off:
          // pick the nearest pre-cleared viewing spot so the walk is reachable
          a.state = "toadmire";
          const px = a.group.position.x, pz = a.group.position.z;
          let best = ADMIRE_SPOTS[0], bd = Infinity;
          for (const sp of ADMIRE_SPOTS) {
            const d = (sp[0] - px) ** 2 + (sp[1] - pz) ** 2;
            if (d < bd) { bd = d; best = sp; }
          }
          planTo(a, best[0], best[1]);
        }
      } else if (a.state === "toadmire") {
        if (followRoute(a, dt, t)) {
          a.state = "admire";
          a.admireT = rand(3.0, 5.5); // gaze up at the tree for a few seconds
        }
      } else if (a.state === "admire") {
        admire(a, t, dt);
        a.admireT -= dt;
        if (a.admireT <= 0) {
          a.state = "leave";
          planTo(a, a.path.exit[0], a.path.exit[1]);
        }
      } else if (a.state === "leave") {
        if (followRoute(a, dt, t)) {
          a.state = "idle";
          a.group.visible = false;
        }
      } else if (a.state === "tofire") {
        // marching to the campfire (rain doesn't save it now)
        if (followRoute(a, dt, t)) {
          a.state = "roast";
          a.roastT = 0;
          api.onRoastStart?.(a.type); // fire flares (ember burst)
        }
      } else if (a.state === "roast") {
        // (keels over at the legal standoff beside the flames — never in them)
        // cartoon send-off: keel over with a little hop, then shrink away
        a.roastT += dt;
        const TIP = 0.55, GONE = 1.6;
        if (a.roastT < TIP) {
          const k = _ss(0, 1, a.roastT / TIP);
          a.group.rotation.z = k * 1.35; // falls onto its side
          a.group.position.y = Math.sin(k * Math.PI) * 0.22; // the hop
          for (const hip of a.legs) hip.rotation.x *= 0.8; // legs go limp
        } else {
          a.group.rotation.z = 1.35;
          const k = Math.min(1, (a.roastT - TIP) / (GONE - TIP));
          a.group.scale.setScalar(a.sc * (1 - _ss(0, 1, k))); // burns down
          a.group.position.y = -0.08 * k;
          if (k >= 1) {
            a.state = "idle";
            a.group.visible = false;
            a.group.rotation.z = 0;
            a.group.scale.setScalar(a.sc); // restored for its next life
            api.onRoasted?.(a.type);
          }
        }
      }
    }

    // final guarantee, every frame: no visible animal — whatever its state —
    // ever rests inside an obstacle's clearance (grazing beside the trunk,
    // keeling over at the fire, anything)
    for (const a of anims) {
      if (!a.group.visible) continue;
      const p = a.group.position;
      [p.x, p.z] = resolveXZ(p.x, p.z);
    }
  }

  // onVisit / onPoop / onRoasted are assignable by the game for toasts;
  // collectDroppingAt(ray) picks up droppings (→ fertiliser), animalAt(ray) +
  // sendToFire(a,…) drive the night-time bone-meal "harvest";
  // party/setBeat/endPose drive the Day-30 festival dance show.
  const api = {
    group, update, party: setParty, setBeat, endPose,
    onVisit: null, onPoop: null, onRoastStart: null, onRoasted: null,
    collectDroppingAt, animalAt, sendToFire,
  };
  api.debug = () => anims.map((a) => ({
    type: a.type, state: a.state,
    x: +a.group.position.x.toFixed(1), z: +a.group.position.z.toFixed(1),
    slot: a.slot ? `${a.slot.x.toFixed(1)},${a.slot.z.toFixed(1)}` : null,
  }));
  return api;
}
