import * as THREE from "three";
import { toonMaterial } from "../../01_webgl_tree/src/materials.js";

// 02 · Developmental tree morphing — ONE continuous metamorphosis.
//
// growthProgress drives a single per-vertex morph (no shrink-and-swap): the
// thin green seedling stem continuously lengthens, thickens and BROWNS into the
// trunk, while the two cotyledon leaves unfurl and the canopy grows out from the
// stem tip. Matches the botanical reference (sprout → small tree → big tree).
//
// Grounded in the cited literature:
//   • Beier & Neely, "Feature-Based Image Metamorphosis", SIGGRAPH'92 — a
//     warp + cross-dissolve metamorphosis (here the colour cross-dissolves
//     green→brown while the geometry warps stem→trunk).
//   • Morph targets / blend shapes — genuine per-vertex interpolation between
//     the sprout key-shape and the mature key-shape.
//   • Alexa, Cohen-Or & Levin, "As-Rigid-As-Possible Shape Interpolation",
//     SIGGRAPH'00 — kept locally rigid: trunk and each canopy lobe are separate
//     primitives that grow/translate, so nothing stretches unnaturally.

const STEM_TOP = 4.0;        // sprout stem height (base key)
const MATURE_TRUNK_H = 16.0;
const STEM_GREEN = new THREE.Color(0x6f9a4e);
const BARK_BROWN = new THREE.Color(0x7d5638);
const LEAF_LOW = new THREE.Color(0x3d6a33);
const LEAF_HIGH = new THREE.Color(0x93b956);

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };

// mature canopy: stacked rings → a layered conifer cone on the 16-unit trunk
function matureLobes() {
  const rings = [
    { y: 7.5, n: 6, ringR: 2.6, r: 2.5 },
    { y: 10.0, n: 6, ringR: 2.1, r: 2.2 },
    { y: 12.2, n: 5, ringR: 1.5, r: 1.85 },
    { y: 14.0, n: 4, ringR: 0.9, r: 1.55 },
    { y: 15.5, n: 2, ringR: 0.4, r: 1.2 },
    { y: 16.6, n: 1, ringR: 0.0, r: 0.95 }, // tip cap covers the trunk top
  ];
  let s = 7;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + rnd() * 0.7;
      out.push([Math.cos(a) * ring.ringR, ring.y + (rnd() - 0.5) * 0.5, Math.sin(a) * ring.ringR, ring.r * (0.85 + rnd() * 0.3)]);
    }
  }
  return out;
}

function normalsFor(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal.array.slice();
  g.dispose();
  return n;
}

// canopy morph: base = 2 cotyledon leaves + tiny buds clustered at the stem
// tip; target = full layered cone. Lobes 0,1 are the cotyledons (flat leaves).
function buildCanopy() {
  const unit = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const up = unit.attributes.position.array;
  const M = up.length / 3;
  unit.dispose();

  const LOBES = matureLobes();
  const K = LOBES.length;
  const maxY = Math.max(...LOBES.map((l) => l[1]));

  const base = new Float32Array(K * M * 3);
  const mat = new Float32Array(K * M * 3);
  const col = new Float32Array(K * M * 3);
  const c = new THREE.Color();
  let s = 31;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  for (let k = 0; k < K; k++) {
    const [mx, my, mz, mr] = LOBES[k];
    // base (sprout) shape of this lobe
    let bx, by, bz, sx, sy, sz; // base centre + base half-extents
    if (k < 2) {
      // a cotyledon: a flat leaf splayed out from the stem tip
      const sgn = k === 0 ? -1 : 1;
      bx = sgn * 0.7; by = STEM_TOP + 0.15; bz = 0;
      sx = 0.95; sy = 0.16; sz = 0.55; // flattened leaf
    } else {
      // a tiny bud clustered at the stem tip (invisible until it grows)
      bx = (rnd() - 0.5) * 0.35; by = STEM_TOP + (rnd() - 0.5) * 0.3; bz = (rnd() - 0.5) * 0.35;
      sx = sy = sz = 0.04;
    }
    c.copy(LEAF_LOW).lerp(LEAF_HIGH, my / maxY);
    const o = k * M * 3;
    for (let j = 0; j < M; j++) {
      const vx = up[j * 3], vy = up[j * 3 + 1], vz = up[j * 3 + 2];
      const i = o + j * 3;
      base[i] = bx + vx * sx; base[i + 1] = by + vy * sy; base[i + 2] = bz + vz * sz;
      mat[i] = mx + vx * mr; mat[i + 1] = my + vy * mr; mat[i + 2] = mz + vz * mr;
      col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(base, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normalsFor(base), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.morphAttributes.position = [new THREE.BufferAttribute(mat, 3)];
  geo.morphAttributes.normal = [new THREE.BufferAttribute(normalsFor(mat), 3)];
  geo.computeBoundingSphere();
  return geo;
}

// trunk morph: base = thin green seedling stem, target = thick mature trunk
function buildTrunk() {
  const RS = 9, HS = 12;
  const sml = new THREE.CylinderGeometry(0.08, 0.13, STEM_TOP, RS, HS);
  sml.translate(0, STEM_TOP / 2, 0);
  const mat = new THREE.CylinderGeometry(0.6, 1.4, MATURE_TRUNK_H, RS, HS);
  mat.translate(0, MATURE_TRUNK_H / 2, 0);
  sml.morphAttributes.position = [mat.attributes.position];
  sml.morphAttributes.normal = [mat.attributes.normal];
  return sml;
}

// { group, setGrowth(t∈[0,1]), dispose() }
export function makeMorphTree() {
  const group = new THREE.Group();

  const barkMat = toonMaterial(STEM_GREEN.getHex()); // starts green (stem)
  const leafMat = toonMaterial(0xffffff, { vertexColors: true });

  const trunk = new THREE.Mesh(buildTrunk(), barkMat);
  trunk.castShadow = true; trunk.receiveShadow = true; trunk.morphTargetInfluences = [0];
  const canopy = new THREE.Mesh(buildCanopy(), leafMat);
  canopy.castShadow = true; canopy.receiveShadow = true; canopy.morphTargetInfluences = [0];
  group.add(trunk, canopy);

  function setGrowth(t) {
    // one continuous morph: stem → trunk, cotyledons/buds → canopy
    const m = smoother(t);
    trunk.morphTargetInfluences[0] = m;
    canopy.morphTargetInfluences[0] = m;
    // colour cross-dissolve: green seedling stem → brown bark as it thickens
    barkMat.color.copy(STEM_GREEN).lerp(BARK_BROWN, ss(0.06, 0.4, t));
  }
  setGrowth(0);

  function dispose() {
    trunk.geometry.dispose(); canopy.geometry.dispose();
    barkMat.dispose(); leafMat.dispose();
  }

  return { group, setGrowth, dispose };
}
