import * as THREE from "three";
import { realtimeMode } from "../../01_webgl_tree/src/modes/realtime.js";

// 02 · Tree Growth (Morphing) — sapling → full cedar, by the lake.
//
// A mode plugin (CONTRIBUTING.md §4). It renders through the real-time cel
// pipeline, so the growing tree keeps the pixel-art look AND reflects live in
// the pond. It morphs the *shared* procedural cedar (ctx.tree) every frame and
// restores it on dispose.
//
// This is PROCEDURAL / PARAMETRIC morphing (timed-L-system developmental
// animation; Prusinkiewicz, Hammel & Mjolsness, "Animation of Plant
// Development", SIGGRAPH'93) — continuous interpolation of generative
// parameters, grounded in three pieces of plant literature:
//
//   1. TIMING — logistic (Verhulst) sigmoid growth curve: slow start → rapid
//      juvenile growth → deceleration to the mature asymptote (the standard
//      sigmoidal growth model in forest biometrics).
//   2. ALLOMETRY — McMahon elastic self-similarity: girth grows faster than
//      height (girth ∝ height^EXP), so the sapling is slender and the mature
//      tree stout. Applied as anisotropic scaling, not a uniform zoom.
//   3. BASIPETAL FOLIAGE — a fill front sweeps the canopy top→bottom (crown
//      leafs out first, then fills downward), driven by per-instance height.
//
// Endpoint guarantee: at G=1 the scale is identity and every leaf instance is
// the cached original, so the fully-grown tree is exactly the current cedar.

const SAPLING_HEIGHT = 0.045; // height scale at G=0 (a tiny seedling)
const GIRTH_EXP = 1.2;        // girth = heightScale^GIRTH_EXP (slender → stout)
const EMERGE_BAND = 0.28;     // foliage fill-front softness (normalized height)

// Looping demo timeline (s): grow slowly → hold mature → reverse → repeat.
const GROW_S = 14.0;
const HOLD_S = 5.0;
const SHRINK_S = 3.5;
const PERIOD = GROW_S + HOLD_S + SHRINK_S;

const LOGISTIC_R = 8.5;
function sigmoidGrowth(t) {
  const raw = (x) => 1 / (1 + Math.exp(-LOGISTIC_R * (x - 0.5)));
  const r0 = raw(0), r1 = raw(1);
  return (raw(t) - r0) / (r1 - r0);
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

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
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        lv.getMatrixAt(i, m); m.decompose(p, q, s);
        this.pos[i] = p.clone(); this.scaleX[i] = s.x; this.scaleY[i] = s.y;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      this.minY = minY; this.maxY = maxY;
      this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    }

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

    // (2) allometric anisotropic scaling
    const heightScale = THREE.MathUtils.lerp(SAPLING_HEIGHT, 1.0, G);
    const girthScale = Math.pow(heightScale, GIRTH_EXP);
    if (this.tree) this.tree.scale.set(girthScale, heightScale, girthScale);

    // (3) basipetal (top→bottom) foliage emergence + shrink leaves with the tree
    const lv = this.leaves;
    if (lv) {
      const span = Math.max(1e-4, this.maxY - this.minY);
      const fill = G * (1 + EMERGE_BAND);   // crown first; base full at G=1
      const m = this._m, q = this._q, pos = this._p, scl = this._s;
      q.identity();
      for (let i = 0; i < lv.count; i++) {
        const u = (this.pos[i].y - this.minY) / span;     // 0 base … 1 crown
        const emerge = smooth01((u - (1 - fill)) / EMERGE_BAND);
        const leafScale = emerge * heightScale;           // billboard size ∝ tree size
        pos.copy(this.pos[i]);
        scl.set(this.scaleX[i] * leafScale, this.scaleY[i] * leafScale, 1);
        m.compose(pos, q, scl);
        lv.setMatrixAt(i, m);
      }
      lv.instanceMatrix.needsUpdate = true;
    }

    realtimeMode.render(ctx, time);
  },

  dispose(ctx) {
    if (this.tree) this.tree.scale.set(1, 1, 1);
    if (this.leaves && this.orig) {
      this.leaves.instanceMatrix.array.set(this.orig);
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    if (window.__setGrowth) delete window.__setGrowth;
    realtimeMode.dispose(ctx);
  },
};
