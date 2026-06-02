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

// [type, spawnX, spawnZ, scale, wanderRadius, walkSpeed] — clear of pond/tree.
const PLACEMENTS = [
  ["cow", -5.0, 3.6, 1.6, 1.7, 0.16],
  ["sheep", -3.0, 5.6, 1.5, 1.3, 0.26],
  ["sheep", -1.4, 7.0, 1.45, 1.2, 0.24],
  ["dog", -6.2, 1.4, 1.4, 2.0, 0.5],
  ["cow", 7.6, -2.2, 1.55, 1.4, 0.15],
  ["sheep", 3.6, 8.0, 1.45, 1.1, 0.22],
];

export function makeAnimals() {
  const group = new THREE.Group();
  const anims = [];
  PLACEMENTS.forEach(([type, x, z, sc, wr, spd], i) => {
    const a = BUILDERS[type]();
    a.group.scale.setScalar(sc);
    group.add(a.group);
    anims.push({
      ...a,
      sx: x, sz: z,
      wr: wr, wrz: wr * 0.7,
      spd: spd,
      phase: i * 1.9,
      stride: 7 + (i % 3),     // leg cadence
      strideAmp: type === "dog" ? 0.7 : 0.5,
    });
  });
  group.userData.noReflect = true; // keep barnyard out of the small pond mirror

  function update(t) {
    for (const a of anims) {
      const ang = t * a.spd + a.phase;
      // wander along a gentle ellipse around the spawn point
      const x = a.sx + Math.cos(ang) * a.wr;
      const z = a.sz + Math.sin(ang) * a.wrz;
      // velocity (tangent) → heading: local +x (the head) faces travel direction
      const vx = -Math.sin(ang) * a.wr;
      const vz = Math.cos(ang) * a.wrz;
      a.group.rotation.y = Math.atan2(-vz, vx);

      // trot: diagonal leg pairs swing in antiphase; body hops gently
      const swing = Math.sin(t * a.stride + a.phase) * a.strideAmp;
      for (const hip of a.legs) hip.rotation.x = swing * hip.userData.gait;
      const bob = Math.abs(Math.sin(t * a.stride + a.phase)) * 0.04;
      a.group.position.set(x, bob, z);

      // head bobs as it walks / grazes
      a.head.rotation.x = 0.12 + 0.12 * Math.sin(t * a.stride * 0.5 + a.phase);
    }
  }
  return { group, update };
}
