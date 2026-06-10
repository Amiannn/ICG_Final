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

// solid obstacles (set by makeAnimals): the tree, rocks, campfire — circles
// {x,z,r} — and the pond — an ellipse {x,z,rx,rz}. Animals walk AROUND all of
// these; only grass is passable, so they still wander through tufts.
let OBSTACLES = [];
function resolveXZ(x, z) {
  for (let pass = 0; pass < 2; pass++) {
    for (const o of OBSTACLES) {
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
  [tx, tz] = resolveXZ(tx, tz); // never aim into a rock / the tree
  const px = a.group.position.x, pz = a.group.position.z;
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.2) return true;
  const step = Math.min(dist, a.spd * dt);
  const [nx, nz] = resolveXZ(px + (dx / dist) * step, pz + (dz / dist) * step); // slide around obstacles
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

// per-type signature move for the battler's showcase (so each battle differs)
const SIGNATURE = { cow: "windmill", sheep: "bounce-spin", dog: "frenzy" };

function dance(a, t, dt) {
  const beat = danceBeat;                       // 1 exactly on the beat → decays
  const bar = beatStep % 4;                     // 4-beat bar; 0 = downbeat
  const turnBeat = beatStep % 8;                // position within a battler turn
  const active = danceFinale || a.idx === battleIdx;
  const amp = (danceFinale ? 1.15 : active ? 1 : 0.6) * (0.6 + 0.4 * danceLevel);
  const downbeat = bar === 0 ? 1.35 : 1.0;      // hit the bar's first count harder
  let hopY = 0;

  // rear up onto the hind legs — upright, human-like; deeper on the beat
  a.group.rotation.z = _approach(a.group.rotation.z, (active ? 1.35 : 1.05) - beat * 0.12, dt * 9);

  // facing: battler works the crowd (camera), crew turns to watch the battler
  if (active) {
    const sig = SIGNATURE[a.type] || "windmill";
    if (sig === "windmill" && turnBeat >= 2 && turnBeat <= 5) {
      a.heading += dt * 8.6;                    // power spin: ~2 beats / revolution
    } else if (sig === "frenzy") {
      // quarter-turn SNAP on every beat (hits the grid), facing camera on bar end
      const snap = FRONT_FACE + (beatStep % 4) * (Math.PI / 2);
      a.heading = _approachAngle(a.heading, bar === 3 ? FRONT_FACE : snap, dt * 14);
    } else {
      a.heading = _approachAngle(a.heading, FRONT_FACE, dt * 8);
    }
  } else {
    const s = FRONT_SLOTS[battleIdx % FRONT_SLOTS.length];
    a.heading = _approachAngle(a.heading, Math.atan2(-(s.z - a.slot.z), s.x - a.slot.x), dt * 5);
  }
  a.group.rotation.y = a.heading;

  // hold the slot (everyone dances in place on the shore arc — pond/tree/rocks
  // are solid, and slots are already resolved onto open grass)
  const [nx, nz] = resolveXZ(_approach(a.group.position.x, a.slot.x, dt * 3), _approach(a.group.position.z, a.slot.z, dt * 3));
  a.group.position.x = nx; a.group.position.z = nz;

  // ON-BEAT accents: jump lands exactly on the pulse; downbeat jumps higher;
  // the battler's last turn-beat is a held FREEZE (no hop, tilted pose)
  const freeze = active && !danceFinale && turnBeat === 7;
  if (freeze) {
    a.group.rotation.x = _approach(a.group.rotation.x, 0.7, dt * 16);
    hopY = 0.04;
  } else {
    a.group.rotation.x = _approach(a.group.rotation.x, active ? Math.sin(beatStep * 0.9) * 0.18 : 0.06, dt * 10);
    hopY = beat * (active ? 0.95 : 0.4) * amp * downbeat;
  }

  // arms (front legs) THROW UP on the beat — crew claps, battler bigger; back
  // legs kick in antiphase. All driven by the same pulse → visibly in time.
  let j = 0;
  for (const hip of a.legs) {
    if (j >= 2) hip.rotation.x = -1.5 + beat * (active ? 1.8 : 1.0) * downbeat + Math.sin(beatStep * 2.1 + j) * 0.15;
    else hip.rotation.x = beat * (j === 0 ? 1 : -1) * (active ? 1.5 : 0.7) * downbeat;
    j++;
  }
  a.head.rotation.x = -0.12 + beat * 0.55 * downbeat;

  // lift the body so the rear-up / freeze tilt never sinks it through the ground
  const gs = a.group.scale.x || 1;
  const lift = Math.sin(Math.max(0, a.group.rotation.z)) * 0.6 * gs
             + Math.abs(Math.sin(a.group.rotation.x)) * 0.35 * gs;
  a.group.position.y = hopY + lift;
}

// Dance stage: an ARC hugging the pond's near-left SHORE (the only open meadow
// band visible above the HUD with this camera). Slots are parametric points just
// outside the pond ellipse (centre 6.0,4.4 / rim ~5.9×4.4) with a standoff, so
// every dancer stands on GRASS — never in the water, the tree, or a rock (slots
// are also passed through resolveXZ when the party starts).
const FRONT_FACE = Math.atan2(-1, 1); // heading that faces the camera (+x,+z)
const FRONT_SLOTS = [135, 160, 185, 210, 235].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 6.0 + 7.2 * Math.cos(a), z: 4.4 + 5.6 * Math.sin(a) };
});

export function makeAnimals(obstacles = []) {
  OBSTACLES = obstacles;
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
        const [sx, sz] = resolveXZ(sl.x, sl.z);      // keep dance slots out of rocks/tree
        a.slot = { x: sx, z: sz };
        a.idx = i;                                   // place in the battle order
        a.state = "gather";
        a.group.visible = true;
        a.group.scale.setScalar(a.baseScale * 1.3); // stand out for the show
      });
    } else {
      anims.forEach((a) => {
        a.group.rotation.z = 0;
        a.group.rotation.x = 0;
        a.group.scale.setScalar(a.baseScale);
        a.state = "leave";
        a.path = { exit: [-14, a.group.position.z] };
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

    // festival: all animals gather to the shore stage, then dance-battle
    if (party) {
      for (const a of anims) {
        a.group.visible = true;
        if (a.state === "dance") {
          dance(a, t, dt);
        } else if (walk(a, a.slot.x, a.slot.z, dt, t)) { // gather → arrive
          a.state = "dance";
          a.heading = FRONT_FACE;
        }
      }
      // animals are solid too: pairwise push-apart so dancers never overlap
      for (let i = 0; i < anims.length; i++) {
        for (let k = i + 1; k < anims.length; k++) {
          const A = anims[i].group.position, B = anims[k].group.position;
          const dx = B.x - A.x, dz = B.z - A.z;
          const d = Math.hypot(dx, dz), min = 2.1;
          if (d < min && d > 1e-4) {
            const push = (min - d) * 0.5, ux = dx / d, uz = dz / d;
            [A.x, A.z] = resolveXZ(A.x - ux * push, A.z - uz * push);
            [B.x, B.z] = resolveXZ(B.x + ux * push, B.z + uz * push);
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

  return { group, update, party: setParty, setBeat };
}
