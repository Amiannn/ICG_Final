import * as THREE from "three";
import { toonMaterial, instancedBillboardMaterial } from "../materials.js";
import { makeFirSprig } from "../textures.js";

// Deterministic RNG so the tree is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A large cedar / fir, BotW-flavoured. The canopy is a stack of distinct
// drooping "skirts" (tiers) with clear vertical gaps between them, so the tree
// reads as layered foliage rather than one solid cone. A thin dark core stops
// sky showing through each skirt; the trunk + branch stubs peek through the
// gaps. `S` scales the whole tree.
export function makeTree(rng = mulberry32(11), S = 1.5) {
  const group = new THREE.Group();

  const CANOPY_BASE = 3.7 * S; // lowest skirt sits higher -> more bare trunk below
  const CANOPY_TOP = 13.2 * S;
  const CANOPY_H = CANOPY_TOP - CANOPY_BASE;
  const BASE_R = 3.2 * S; // widest skirt radius

  // ---- trunk -------------------------------------------------------------
  const barkLight = toonMaterial(0x9c5a3c);
  const barkDark = toonMaterial(0x6f3f2c);

  const TRUNK_H = CANOPY_BASE + 3.4 * S;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * S, 0.82 * S, TRUNK_H, 9), barkLight);
  trunk.position.y = TRUNK_H / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // small, low root knob -- just blends the trunk into the ground (no big disk)
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58 * S, 0), barkDark);
  knob.scale.set(1.1, 0.38, 1.05);
  knob.position.y = 0.1 * S;
  knob.rotation.y = 0.4;
  knob.castShadow = true;
  knob.receiveShadow = true;
  group.add(knob);

  // curved, tapering surface roots: they start low on the trunk, bend sideways
  // (so they're irregular, not radial spokes), and dip into the ground.
  const up = new THREE.Vector3(0, 1, 0);
  const addRoot = (angle, reach, thick, startY, bend, arcH) => {
    const aTip = angle + bend;
    const aCtl = angle + bend * 0.5;
    const startR = (0.34 + (rng() - 0.5) * 0.12) * S;
    const p0 = new THREE.Vector3(Math.cos(angle) * startR, startY, Math.sin(angle) * startR);
    const ctrl = new THREE.Vector3(Math.cos(aCtl) * reach * 0.5, arcH, Math.sin(aCtl) * reach * 0.5);
    const p1 = new THREE.Vector3(Math.cos(aTip) * reach, -0.3 * S, Math.sin(aTip) * reach);
    const SEG = 6;
    let prev = p0.clone();
    const pt = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG;
      const mt = 1 - t;
      pt.set(
        mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x,
        mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y,
        mt * mt * p0.z + 2 * mt * t * ctrl.z + t * t * p1.z,
      );
      dir.copy(pt).sub(prev);
      const len = dir.length();
      const rBot = Math.max(0.03 * S, thick * (1 - (i - 1) / SEG));
      const rTop = Math.max(0.025 * S, thick * (1 - i / SEG));
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len * 1.1, 5), barkDark);
      seg.position.copy(prev).add(pt).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      seg.castShadow = true;
      seg.receiveShadow = true;
      group.add(seg);
      prev.copy(pt);
    }
  };

  const ROOTS = 6;
  for (let i = 0; i < ROOTS; i++) {
    const a = (i / ROOTS) * Math.PI * 2 + rng() * 0.9; // uneven spacing
    const reach = (1.4 + rng() * 0.8) * S; // smaller
    const thick = (0.22 + rng() * 0.1) * S; // thinner
    const startY = (0.4 + rng() * 0.4) * S; // start low on the trunk
    const bend = (rng() - 0.5) * 0.8; // curve sideways
    const arcH = (0.12 + rng() * 0.22) * S; // low arc, stays near the ground
    addRoot(a, reach, thick, startY, bend, arcH);
    if (rng() > 0.5) {
      addRoot(a + 0.3 + rng() * 0.2, (0.8 + rng() * 0.5) * S, (0.12 + rng() * 0.06) * S, (0.25 + rng() * 0.3) * S, (rng() - 0.5) * 1.0, (0.1 + rng() * 0.15) * S);
    }
  }

  // ---- skirts (distinct drooping foliage tiers) --------------------------
  const NUM = 8;
  const shelfR = (f) => BASE_R * Math.pow(1 - f, 0.7) * (0.92 + 0.08 * Math.cos(f * 6.0));

  // branch stubs reaching out under each skirt rim (revealed by the gaps)
  for (let s = 0; s < NUM; s++) {
    const f = s / (NUM - 1);
    const y = CANOPY_BASE + f * CANOPY_H;
    const R = shelfR(f);
    const nb = Math.max(2, Math.round(5 - f * 3));
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + s * 1.1;
      const len = R * 0.7;
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05 * S, 0.1 * S, len, 5),
        barkLight,
      );
      branch.position.set(Math.cos(a) * len * 0.4, y + 0.1 * S, Math.sin(a) * len * 0.4);
      branch.lookAt(Math.cos(a) * R * 2, y - 0.3 * S, Math.sin(a) * R * 2);
      branch.rotateX(Math.PI / 2);
      branch.castShadow = true;
      group.add(branch);
    }
  }

  // ---- thin solid core (prevents sky through a skirt, gives the spine) ----
  // brown like the trunk/branches, so what shows through foliage gaps reads as
  // the woody centre rather than a green column.
  const coreMat = toonMaterial(0x6f4633);
  const corePts = [];
  const CORE_SEG = 16;
  corePts.push(new THREE.Vector2(0.0001, CANOPY_BASE));
  for (let i = 0; i <= CORE_SEG; i++) {
    const f = i / CORE_SEG;
    const y = CANOPY_BASE + f * CANOPY_H;
    // gently scalloped radius so the core echoes the skirts instead of a cone
    const r = Math.max(0.0001, shelfR(f) * (0.22 + 0.05 * Math.cos(f * Math.PI * NUM)));
    corePts.push(new THREE.Vector2(r, y));
  }
  const core = new THREE.Mesh(new THREE.LatheGeometry(corePts, 10), coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ---- foliage sprigs, grouped tightly per skirt -------------------------
  const sprig = makeFirSprig("#a8c46e", "#33502f", 64);
  const foliageMat = instancedBillboardMaterial(sprig, { color: 0xffffff, upright: false });

  const instances = [];
  const colors = [];
  const darkGreen = new THREE.Color(0x33522d);
  const midGreen = new THREE.Color(0x6f9a4e);
  const topWarm = new THREE.Color(0xcfe08a);

  for (let s = 0; s < NUM; s++) {
    const f = s / (NUM - 1);
    const y = CANOPY_BASE + f * CANOPY_H;
    const R = shelfR(f);
    // each skirt droops at the rim; keep the band tight so skirts stay separate
    const skirtDroop = R * 0.34;
    const count = Math.max(12, Math.round(THREE.MathUtils.lerp(66, 16, f)));
    const phase = rng() * Math.PI * 2;

    for (let k = 0; k < count; k++) {
      const ang = phase + (k / count) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      // fill most of the disk; rim droops the most -> defined skirt edge
      const t = Math.sqrt(rng());
      const rr = R * (0.28 + 0.72 * t);
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      // top skirt has R=0 (shelfR(1)=0) -> rr/R is 0/0=NaN; collapse droop to 0
      const droop = R > 0 ? Math.pow(rr / R, 1.4) * skirtDroop : 0;
      const py = y - droop + (rng() - 0.5) * 0.12 * S;

      const size = THREE.MathUtils.lerp(1.05, 0.5, f) * S * (0.85 + rng() * 0.35);
      instances.push({ x, y: py, z, w: size, h: size * 1.25 });

      const c = darkGreen.clone().lerp(midGreen, THREE.MathUtils.clamp(f * 1.3, 0, 1));
      c.lerp(topWarm, Math.max(0, f - 0.5) * 1.5 * (0.4 + 0.6 * (rr / Math.max(R, 0.001))));
      c.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
      colors.push(c);
    }
  }

  // tight crown cluster for a clean point
  for (let k = 0; k < 10; k++) {
    instances.push({
      x: (rng() - 0.5) * 0.4 * S,
      y: CANOPY_TOP - (0.2 + k * 0.12) * S,
      z: (rng() - 0.5) * 0.4 * S,
      w: 0.46 * S,
      h: 0.62 * S,
    });
    colors.push(topWarm.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05));
  }

  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), foliageMat, instances.length);
  leaves.userData.skipNormal = true;
  leaves.castShadow = false;
  leaves.receiveShadow = false;
  leaves.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  instances.forEach((it, i) => {
    pos.set(it.x, it.y, it.z);
    scl.set(it.w, it.h, 1);
    m.compose(pos, q, scl);
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, colors[i]);
  });
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  // Canopy shadow casters. The foliage is camera-facing billboards, which can't
  // cast a sensible shadow (leaves have castShadow = false), so the cast shadow
  // used to be only the trunk. A single cone looked unnatural; instead we add a
  // few invisible blobs that follow the drooping foliage tiers, so the tree
  // casts a soft, organic canopy shadow. They are colour/depth-silent in the
  // main pass, skipped by the normal + path-trace passes, and live in the tree
  // group so the shadow grows with the growth animation.
  const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  for (const f of [0.12, 0.34, 0.56, 0.78, 0.95]) {
    const y = CANOPY_BASE + f * CANOPY_H;
    const r = shelfR(f) * 0.92;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), shadowMat);
    blob.position.y = y;
    blob.scale.set(1, 0.55, 1); // flatten like a skirt
    blob.castShadow = true;
    blob.receiveShadow = false;
    blob.frustumCulled = false;
    blob.userData.skipNormal = true;
    blob.userData.shadowOnly = true; // path-trace hides these
    group.add(blob);
  }

  group.userData.leafCount = instances.length;
  group.userData.height = CANOPY_TOP;
  return group;
}
