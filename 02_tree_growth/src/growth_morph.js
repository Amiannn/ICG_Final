import * as THREE from "three";
import { realtimeMode } from "../../01_webgl_tree/src/modes/realtime.js";
import { makeMorphTree } from "./morph_tree.js";

// 02 · Growth (Morph) — TEST mode using strict morph-target morphing.
//
// Separate from the default "Growth" mode (which uses parametric/procedural
// developmental morphing on the real cedar). This one swaps in a dedicated
// morph-target tree (morph_tree.js) whose every vertex is linearly interpolated
// between a sapling key-shape and a mature key-shape — the textbook CG morphing
// the report may need. Driven by a logistic growth schedule; renders through
// the real-time cel pipeline (so it also reflects in the pond). Fully restored
// on dispose, so it never touches the other modes.

const GROW_S = 13.0;
const HOLD_S = 4.0;
const SHRINK_S = 3.0;
const PERIOD = GROW_S + HOLD_S + SHRINK_S;

const LOGISTIC_R = 8.5;
function sigmoidGrowth(t) {
  const raw = (x) => 1 / (1 + Math.exp(-LOGISTIC_R * (x - 0.5)));
  const r0 = raw(0), r1 = raw(1);
  return (raw(t) - r0) / (r1 - r0);
}

export const growthMorphMode = {
  name: "growthmorph",
  label: "Morph",
  manual: null, // debug/scrub override (null = auto-play)

  init(ctx) {
    realtimeMode.init(ctx);

    this.prevTreeVisible = ctx.tree ? ctx.tree.visible : true;
    if (ctx.tree) ctx.tree.visible = false;

    this.morph = makeMorphTree();
    if (ctx.tree) this.morph.group.position.copy(ctx.tree.position);
    else this.morph.group.position.set(2.6, 0, 1.2);
    ctx.scene.add(this.morph.group);

    this.t0 = performance.now() / 1000;
    growthMorphMode.manual = null;
    window.__setGrowth = (v) => { growthMorphMode.manual = v == null ? null : Math.max(0, Math.min(1, v)); };
  },

  render(ctx, time) {
    let G;
    if (this.manual != null) {
      G = this.manual;
    } else {
      const p = (performance.now() / 1000 - this.t0) % PERIOD;
      if (p < GROW_S) G = sigmoidGrowth(p / GROW_S);
      else if (p < GROW_S + HOLD_S) G = 1;
      else G = sigmoidGrowth(1 - (p - GROW_S - HOLD_S) / SHRINK_S);
    }
    if (this.morph) this.morph.setGrowth(G); // morphTargetInfluences = G

    realtimeMode.render(ctx, time);
  },

  dispose(ctx) {
    if (this.morph) {
      ctx.scene.remove(this.morph.group);
      this.morph.dispose();
      this.morph = null;
    }
    if (ctx.tree) ctx.tree.visible = this.prevTreeVisible !== false;
    if (window.__setGrowth) delete window.__setGrowth;
    realtimeMode.dispose(ctx);
  },
};
