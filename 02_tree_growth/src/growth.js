import * as THREE from "three";
import { realtimeMode } from "../../01_webgl_tree/src/modes/realtime.js";
import { toonMaterial } from "../../01_webgl_tree/src/materials.js";

// 02 · Tree Growth (Morphing) — bare twigs → leafy → full cedar, by the lake.
//
// A mode plugin (CONTRIBUTING.md §4). It renders through the real-time cel
// pipeline, so the growing tree keeps the pixel-art look AND reflects in the
// pond. It morphs the *shared* procedural cedar (ctx.tree) every frame and
// restores it on dispose — the fully-grown tree is exactly the scene's cedar.
//
// PROCEDURAL / PARAMETRIC developmental morphing (Prusinkiewicz et al.,
// "Animation of Plant Development", SIGGRAPH'93):
//
//   1. TIMING — logistic (Verhulst) sigmoid growth curve (looped for the demo).
//   2. STAGES — like a real seedling, it first puts out a spray of bare TWIGS
//      (a leafless branch skeleton), THEN leaves bud and fill the crown, while
//      the twigs fade back into the foliage as the canopy takes over.
//   3. ALLOMETRY — girth grows a touch faster than height (girth ∝ height^EXP,
//      EXP<1 keeps the young tree broad), and the crown opens out as it rises.
//
// Endpoint: at G=1 the twigs are gone, the scale is identity, and every leaf is
// its cached original — i.e. exactly the scene cedar.

const SAPLING_HEIGHT = 0.06; // height scale at G=0
const GIRTH_EXP = 0.85;      // girth = heightScale^GIRTH_EXP (<1 ⇒ young tree broad)
const EMERGE_BAND = 0.42;    // soft fill-front width ⇒ leaves fill as a smooth wave

const GROW_S = 15.0;
const HOLD_S = 5.0;
const SHRINK_S = 4.0;
const PERIOD = GROW_S + HOLD_S + SHRINK_S;

const LOGISTIC_R = 8.5;
function sigmoidGrowth(t) {
  const raw = (x) => 1 / (1 + Math.exp(-LOGISTIC_R * (x - 0.5)));
  const r0 = raw(0), r1 = raw(1);
  return (raw(t) - r0) / (r1 - r0);
}
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

// A spray of thin, leafless twigs fanning up + out from the base — the young
// tree's branch skeleton, shown before any leaves appear (built at full-tree
// proportions; scaled with the tree each frame).
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
    const tilt = 0.1 + rng() * 0.5;                 // radians from vertical
    const len = (4.5 + rng() * 4.5) * S * 0.42;     // short, stays within the crown
    const rBot = (0.05 + rng() * 0.05) * S;
    const geo = new THREE.CylinderGeometry(0.01 * S, rBot, len, 5);
    geo.translate(0, len / 2, 0);                   // pivot at the base
    geos.push(geo);
    const tw = new THREE.Mesh(geo, mat);
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    tw.quaternion.setFromUnitVectors(up, dir);
    tw.castShadow = true;
    group.add(tw);
  }
  return { group, mat, geos };
}

export const growthMode = {
  name: "growth",
  label: "Growth",
  manual: null, // debug/scrub override (null = auto-play)

  init(ctx) {
    realtimeMode.init(ctx);

    const tree = ctx.tree;
    this.tree = tree;
    this.leaves = null;
    if (tree) tree.traverse((o) => { if (!this.leaves && o.isInstancedMesh) this.leaves = o; });

    const lv = this.leaves;
    if (lv) {
      const n = lv.count;
      this.orig = new Float32Array(lv.instanceMatrix.array); // exact restore
      this.pos = new Array(n);
      this.scaleX = new Float32Array(n);
      this.scaleY = new Float32Array(n);
      this.rad = new Float32Array(n); // horizontal distance from the trunk axis
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      let minY = Infinity, maxY = -Infinity, maxR = 1e-4;
      for (let i = 0; i < n; i++) {
        lv.getMatrixAt(i, m); m.decompose(p, q, s);
        this.pos[i] = p.clone(); this.scaleX[i] = s.x; this.scaleY[i] = s.y;
        const r = Math.hypot(p.x, p.z); this.rad[i] = r; if (r > maxR) maxR = r;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      this.minY = minY; this.maxY = maxY; this.maxR = maxR;

      // Per-leaf BIRTH in [0,1]: when G reaches it (within a soft band) the leaf
      // buds and scales 0 → full. Ordered purely by POSITION (centre → up → out,
      // with only a whisper of variation) so the canopy fills as a SMOOTH coherent
      // wave — a natural morph, not random twinkling. The small head-start (−0.05)
      // leaves a sprinkling already budding on the twigs at G≈0.
      const span = Math.max(1e-4, maxY - minY);
      this.birth = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = (this.pos[i].y - minY) / span;
        const rad = this.rad[i] / maxR;
        const wobble = Math.sin((i + 1) * 12.9898) * 0.05; // tiny, keeps the wave organic
        this.birth[i] = clamp01(0.46 * rad + 0.32 * u + wobble - 0.05);
      }

      this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    }

    // bare-twig skeleton for the early stage
    this.twigs = makeTwigs();
    if (tree) this.twigs.group.position.copy(tree.position);
    ctx.scene.add(this.twigs.group);

    this.t0 = performance.now() / 1000;
    growthMode.manual = null;
    window.__setGrowth = (v) => { growthMode.manual = v == null ? null : clamp01(v); };
  },

  render(ctx, time) {
    // developmental progress G (manual scrub, or auto logistic on a loop)
    let G;
    if (this.manual != null) {
      G = this.manual;
    } else {
      const p = (performance.now() / 1000 - this.t0) % PERIOD;
      if (p < GROW_S) G = sigmoidGrowth(p / GROW_S);
      else if (p < GROW_S + HOLD_S) G = 1;
      else G = sigmoidGrowth(1 - (p - GROW_S - HOLD_S) / SHRINK_S);
    }

    // (3) allometric anisotropic scaling
    const heightScale = THREE.MathUtils.lerp(SAPLING_HEIGHT, 1.0, G);
    const girthScale = Math.pow(heightScale, GIRTH_EXP);
    if (this.tree) this.tree.scale.set(girthScale, heightScale, girthScale);

    // (2a) bare twigs lead: enlarged early so the spray reads as a leafless
    //      sapling, settling to the tree's proportions, then fading as leaves win
    if (this.twigs) {
      const twigGrow = smooth01(clamp01(G / 0.28));
      const twigFactor = THREE.MathUtils.lerp(2.0, 1.0, twigGrow);
      const opacity = 1 - smooth01(clamp01((G - 0.26) / 0.22)); // fade over G[0.26,0.48]
      this.twigs.group.scale.set(girthScale * twigFactor, heightScale * twigFactor, girthScale * twigFactor);
      this.twigs.mat.opacity = opacity;
      this.twigs.group.visible = opacity > 0.02;
    }

    // (2b) leaves MULTIPLY: each buds at its own birth time and scales 0 → full —
    //      a sprinkling sits on the twigs from the start, then the crown fills in
    //      (sparse → dense) and opens OUT. This is a developmental morph: the leaf
    //      count and crown shape change, so it does not read as a uniform zoom.
    const lv = this.leaves;
    if (lv) {
      const fill = G * (1 + EMERGE_BAND);
      const spread = 0.5 + 0.5 * smooth01(G);            // crown opens OUT to both sides
      const m = this._m, q = this._q, pos = this._p, scl = this._s;
      q.identity();
      for (let i = 0; i < lv.count; i++) {
        const emerge = smooth01((fill - this.birth[i]) / EMERGE_BAND); // this leaf buds 0 → 1
        const leafScale = emerge;
        pos.set(this.pos[i].x * spread, this.pos[i].y, this.pos[i].z * spread);
        scl.set(this.scaleX[i] * leafScale, this.scaleY[i] * leafScale, 1);
        m.compose(pos, q, scl);
        lv.setMatrixAt(i, m);
      }
      lv.instanceMatrix.needsUpdate = true;
    }

    ctx.growthReveal = G; // grass / flowers / animals / birds fill in with the tree
    realtimeMode.render(ctx, time);
  },

  dispose(ctx) {
    if (this.tree) this.tree.scale.set(1, 1, 1);
    if (this.leaves && this.orig) {
      this.leaves.instanceMatrix.array.set(this.orig);
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    if (this.twigs) {
      ctx.scene.remove(this.twigs.group);
      this.twigs.geos.forEach((g) => g.dispose());
      this.twigs.mat.dispose();
      this.twigs = null;
    }
    if (window.__setGrowth) delete window.__setGrowth;
    realtimeMode.dispose(ctx);
  },
};
