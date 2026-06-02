import * as THREE from "three";
import { toonMaterial } from "../../01_webgl_tree/src/materials.js";

// 02 · Morph-target tree — TRUE vertex-interpolation morphing (blend shapes).
//
// Textbook computer-graphics shape morphing: two corresponding key shapes (a
// SAPLING and a MATURE tree built with identical vertex counts/topology) are
// stored as a base geometry + a morph target, and the GPU linearly interpolates
// every vertex between them by `morphTargetInfluences` ∈ [0,1]:
//
//     vertex = sapling + influence · (mature − sapling)     (three.js morphAttributes)
//
// growthProgress drives the influence, so every vertex of trunk and canopy
// migrates continuously from sprout to full crown — genuine per-vertex
// metamorphosis, not a parametric scale. Cel-shaded to match the pixel-art look.

// Mature canopy lobes [x, y, z, radius], arranged into a rounded conifer crown.
const LOBES = [
  [ 2.1, 5.2, 0.1, 2.05],
  [-2.1, 5.4, 0.3, 1.95],
  [ 0.2, 5.1, 2.0, 1.95],
  [ 0.0, 5.3, -2.0, 1.9],
  [ 1.4, 7.6, 0.4, 1.8],
  [-1.5, 7.9, -0.3, 1.75],
  [ 0.3, 7.7, 1.5, 1.65],
  [-0.2, 8.0, -1.5, 1.65],
  [ 0.9, 10.0, 0.2, 1.55],
  [-0.9, 10.3, -0.2, 1.45],
  [ 0.15, 11.5, 0.1, 1.35],
  [ 0.0, 12.7, 0.0, 1.1],
  [ 0.0, 13.8, 0.0, 0.78], // tip cap — covers the trunk top with foliage
];
const STEM_TOP_SAP = 1.7;

const LEAF_LOW = new THREE.Color(0x3f6b34);
const LEAF_HIGH = new THREE.Color(0x8fb455);

function normalsFor(posArray) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal.array.slice();
  g.dispose();
  return n;
}

function buildCanopy() {
  const unit = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const up = unit.attributes.position.array;
  const M = up.length / 3;
  unit.dispose();

  const K = LOBES.length;
  const sap = new Float32Array(K * M * 3);
  const mat = new Float32Array(K * M * 3);
  const col = new Float32Array(K * M * 3);
  const c = new THREE.Color();

  let maxY = 0;
  for (const l of LOBES) maxY = Math.max(maxY, l[1]);

  for (let s = 0; s < K; s++) {
    const [mx, my, mz, mr] = LOBES[s];
    const sr = 0.09 + 0.04 * (s / K);
    const sx = mx * 0.04, sy = STEM_TOP_SAP + (my - 5.2) * 0.012, sz = mz * 0.04;
    c.copy(LEAF_LOW).lerp(LEAF_HIGH, my / maxY); // greener/lighter toward the crown
    const o = s * M * 3;
    for (let j = 0; j < M; j++) {
      const vx = up[j * 3], vy = up[j * 3 + 1], vz = up[j * 3 + 2];
      const k = o + j * 3;
      sap[k] = sx + vx * sr; sap[k + 1] = sy + vy * sr; sap[k + 2] = sz + vz * sr;
      mat[k] = mx + vx * mr; mat[k + 1] = my + vy * mr; mat[k + 2] = mz + vz * mr;
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(sap, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normalsFor(sap), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.morphAttributes.position = [new THREE.BufferAttribute(mat, 3)];
  geo.morphAttributes.normal = [new THREE.BufferAttribute(normalsFor(mat), 3)];
  geo.computeBoundingSphere();
  return geo;
}

function buildTrunk() {
  const RS = 9, HS = 10;
  const sap = new THREE.CylinderGeometry(0.05, 0.11, 1.7, RS, HS);
  sap.translate(0, 0.85, 0);
  const mat = new THREE.CylinderGeometry(0.5, 1.15, 13, RS, HS);
  mat.translate(0, 6.5, 0); // top (y=13) sits inside the crown, no bare tip
  sap.morphAttributes.position = [mat.attributes.position];
  sap.morphAttributes.normal = [mat.attributes.normal];
  return sap;
}

// { group, setGrowth(t∈[0,1]), dispose() }
export function makeMorphTree() {
  const group = new THREE.Group();

  const barkMat = toonMaterial(0x7d5638);
  const leafMat = toonMaterial(0xffffff, { vertexColors: true });

  const trunk = new THREE.Mesh(buildTrunk(), barkMat);
  trunk.castShadow = true; trunk.receiveShadow = true;
  trunk.morphTargetInfluences = [0];
  group.add(trunk);

  const canopy = new THREE.Mesh(buildCanopy(), leafMat);
  canopy.castShadow = true; canopy.receiveShadow = true;
  canopy.morphTargetInfluences = [0];
  group.add(canopy);

  function setGrowth(t) {
    const w = THREE.MathUtils.clamp(t, 0, 1);
    trunk.morphTargetInfluences[0] = w;
    canopy.morphTargetInfluences[0] = w;
  }
  setGrowth(0);

  function dispose() {
    trunk.geometry.dispose();
    canopy.geometry.dispose();
    barkMat.dispose();
    leafMat.dispose();
  }

  return { group, setGrowth, dispose };
}
