import { realtimeMode } from "./realtime.js";

// Placeholder until 02_tree_growth ships its real plugin. This just replays
// the real-time pipeline with a sin-wave scale animation on the tree so the
// button does *something* visible. 02 will replace this module by exporting
// the same `mode` shape from 02_tree_growth/src/growth.js (see CONTRIBUTING).

const MIN_SCALE = 0.18;
const MAX_SCALE = 1.0;
const PERIOD_S = 8.0;

export const growthMode = {
  name: "growth",
  label: "Growth",

  init(ctx) {
    this._t0 = performance.now() / 1000;
    realtimeMode.init(ctx);
  },

  render(ctx, time) {
    const elapsed = performance.now() / 1000 - this._t0;
    // Ease back and forth between sapling and full cedar.
    const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * elapsed) / PERIOD_S);
    const s = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * phase;
    ctx.tree.scale.set(s, s, s);

    realtimeMode.render(ctx, time);
  },

  dispose(ctx) {
    ctx.tree.scale.set(1, 1, 1);
    realtimeMode.dispose(ctx);
  },
};
