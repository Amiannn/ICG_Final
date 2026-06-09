import * as THREE from "three";
import { toonMaterial } from "../../01_webgl_tree/src/materials.js";

// Reusable growth controller for the SHARED procedural cedar (ctx.tree).
//
// Same developmental morphing the "Growth" mode uses (growth.js), but packaged
// as a plain `{ setGrowth(g), dispose() }` driver so the Game mode can grow the
// real billboard cedar continuously from the day clock. Endpoint G=1 restores
// the scene cedar exactly; dispose() puts everything back.
//
//   • allometric scale (girth ∝ height^EXP, EXP<1 keeps the sapling broad)
//   • per-leaf emergence: each leaf buds at its own birth time (centre→up→out)
//   • bare-twig skeleton leads early, then fades as the canopy fills in

const SAPLING_HEIGHT = 0.06;
const GIRTH_EXP = 0.85;
const EMERGE_BAND = 0.42;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a spray of thin leafless twigs fanning up + out from the base
function makeTwigs() {
  const S = 1.5;
  const group = new THREE.Group();
  const mat = toonMaterial(0x5a4233);
  mat.transparent = true;
  const rng = mulberry32(23);
  const up = new THREE.Vector3(0, 1, 0);
  const geos = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rng() * 0.7;
    const tilt = 0.1 + rng() * 0.5;
    const len = (4.5 + rng() * 4.5) * S * 0.42;
    const rBot = (0.05 + rng() * 0.05) * S;
    const geo = new THREE.CylinderGeometry(0.01 * S, rBot, len, 5);
    geo.translate(0, len / 2, 0);
    geos.push(geo);
    const tw = new THREE.Mesh(geo, mat);
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    tw.quaternion.setFromUnitVectors(up, dir);
    tw.castShadow = true;
    group.add(tw);
  }
  return { group, mat, geos };
}

export function makeCedarGrowth(tree, scene) {
  let leaves = null;
  if (tree) tree.traverse((o) => { if (!leaves && o.isInstancedMesh) leaves = o; });

  let orig, pos, scaleX, scaleY, birth, _m, _q, _p, _s;
  if (leaves) {
    const n = leaves.count;
    orig = new Float32Array(leaves.instanceMatrix.array);
    pos = new Array(n);
    scaleX = new Float32Array(n);
    scaleY = new Float32Array(n);
    const rad = new Float32Array(n);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity, maxR = 1e-4;
    for (let i = 0; i < n; i++) {
      leaves.getMatrixAt(i, m); m.decompose(p, q, s);
      pos[i] = p.clone(); scaleX[i] = s.x; scaleY[i] = s.y;
      const r = Math.hypot(p.x, p.z); rad[i] = r; if (r > maxR) maxR = r;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(1e-4, maxY - minY);
    birth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (pos[i].y - minY) / span;
      const r = rad[i] / maxR;
      const wobble = Math.sin((i + 1) * 12.9898) * 0.05;
      birth[i] = clamp01(0.46 * r + 0.32 * u + wobble - 0.05);
    }
    _m = new THREE.Matrix4(); _q = new THREE.Quaternion(); _p = new THREE.Vector3(); _s = new THREE.Vector3();
  }

  const twigs = makeTwigs();
  if (tree) twigs.group.position.copy(tree.position);
  scene.add(twigs.group);

  function setGrowth(G) {
    G = clamp01(G);
    const heightScale = THREE.MathUtils.lerp(SAPLING_HEIGHT, 1.0, G);
    const girthScale = Math.pow(heightScale, GIRTH_EXP);
    if (tree) tree.scale.set(girthScale, heightScale, girthScale);

    const twigGrow = smooth01(clamp01(G / 0.28));
    const twigFactor = THREE.MathUtils.lerp(2.0, 1.0, twigGrow);
    const opacity = 1 - smooth01(clamp01((G - 0.26) / 0.22));
    twigs.group.scale.set(girthScale * twigFactor, heightScale * twigFactor, girthScale * twigFactor);
    twigs.mat.opacity = opacity;
    twigs.group.visible = opacity > 0.02;

    if (leaves) {
      const fill = G * (1 + EMERGE_BAND);
      const spread = 0.5 + 0.5 * smooth01(G);
      _q.identity();
      for (let i = 0; i < leaves.count; i++) {
        const emerge = smooth01((fill - birth[i]) / EMERGE_BAND);
        _p.set(pos[i].x * spread, pos[i].y, pos[i].z * spread);
        _s.set(scaleX[i] * emerge, scaleY[i] * emerge, 1);
        _m.compose(_p, _q, _s);
        leaves.setMatrixAt(i, _m);
      }
      leaves.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    if (tree) tree.scale.set(1, 1, 1);
    if (leaves && orig) {
      leaves.instanceMatrix.array.set(orig);
      leaves.instanceMatrix.needsUpdate = true;
    }
    scene.remove(twigs.group);
    twigs.geos.forEach((g) => g.dispose());
    twigs.mat.dispose();
  }

  return { setGrowth, dispose };
}
