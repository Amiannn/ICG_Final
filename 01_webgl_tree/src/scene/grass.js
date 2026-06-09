import * as THREE from "three";
import { instancedBillboardMaterial } from "../materials.js";
import { makeGrassTuft } from "../textures.js";

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Smooth-ish value noise so grass tone varies in organic clumps, like the
// reference (darker dense patches vs lighter open ground).
function clumpNoise(x, z) {
  const n =
    Math.sin(x * 0.45) * Math.cos(z * 0.5) +
    0.5 * Math.sin(x * 0.9 + 1.3) * Math.cos(z * 1.1 - 0.7) +
    0.25 * Math.sin(x * 1.9 - 2.1) * Math.cos(z * 2.0 + 0.4);
  return THREE.MathUtils.clamp(0.5 + n * 0.4, 0, 1);
}

// A dense field of upright grass tufts. Per-instance colour from clumpNoise
// makes darker clumps and lighter clearings; evenly lit so tufts blend into the
// ground rather than popping out.
export function makeGrass({ count = 6000, area = 26, exclude = [] } = {}) {
  const rng = rand(1337);
  const tex = makeGrassTuft("#cbe592", "#5f8746", 64);
  const mat = instancedBillboardMaterial(tex, { color: 0xffffff, upright: true });

  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  mesh.userData.skipNormal = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  const dark = new THREE.Color(0x4f7340);
  const light = new THREE.Color(0xb6d488);

  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 8) {
    guard++;
    const x = (rng() - 0.5) * area;
    const z = (rng() - 0.5) * area;

    // circular field with a wavy organic edge (no square boundary)
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const edgeR = area * 0.5 * (0.9 + 0.1 * Math.sin(ang * 3.0 + 0.6) + 0.05 * Math.sin(ang * 7.0));
    if (r > edgeR) continue;
    // feather the outer ring: fewer tufts near the edge
    if (r > edgeR * 0.8 && rng() < (r - edgeR * 0.8) / (edgeR * 0.2)) continue;

    let blocked = false;
    for (const e of exclude) {
      if (x > e.minX && x < e.maxX && z > e.minZ && z < e.maxZ) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const clump = clumpNoise(x, z);
    // bias placement toward clumps so dense patches read as darker masses
    if (rng() > 0.35 + clump * 0.65) continue;

    const h = 0.26 + rng() * 0.26 + clump * 0.12;
    const w = 0.2 + rng() * 0.14;
    pos.set(x, h * 0.5, z);
    scl.set(w, h, 1);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(placed, m);

    // darker in clumps, lighter in the open, with a little per-tuft jitter
    col.copy(dark).lerp(light, THREE.MathUtils.clamp(1.0 - clump + (rng() - 0.5) * 0.25, 0, 1));
    mesh.setColorAt(placed, col);

    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// Grass tufts placed at explicit world positions — used to dress the tops of
// rocks + hill slopes so they aren't bare. Each spot: { x, y, z, w, h, t },
// where y is the SURFACE height (base of the tuft) and t∈[0,1] tints it.
export function makePatchGrass(spots) {
  const tex = makeGrassTuft("#cbe592", "#5f8746", 64);
  const mat = instancedBillboardMaterial(tex, { color: 0xffffff, upright: true });

  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, spots.length);
  mesh.userData.skipNormal = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const dark = new THREE.Color(0x4f7340);
  const light = new THREE.Color(0xb6d488);

  spots.forEach((sp, i) => {
    pos.set(sp.x, sp.y + sp.h * 0.5, sp.z);
    scl.set(sp.w, sp.h, 1);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    col.copy(dark).lerp(light, sp.t ?? 0.5);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
