# 02 · Tree Growth (Morphing)

**Goal:** make the bonsai grow from a small sapling into the full cedar, with a
smooth morph you can scrub or play back (and ideally tie to the season).

This builds directly on the WebGL tree in `../01_webgl_tree`.

## Where to hook in

The cedar is generated procedurally in
[`../01_webgl_tree/src/scene/tree.js`](../01_webgl_tree/src/scene/tree.js):

```js
export function makeTree(rng = mulberry32(11), S = 1.5) { ... }
```

`S` is a single scale factor already baked through the trunk, root system,
canopy height/radius, and foliage sprite sizes. The canopy is also driven by a
few clear parameters (`CANOPY_BASE`, `CANOPY_TOP`, `BASE_R`, number of skirts,
per-skirt sprig count). These are the dials a growth system animates.

## Suggested approach

1. Add a growth parameter `g ∈ [0, 1]` and make the tree's shape a function of
   it: small `g` → short trunk, few short skirts, small canopy; large `g` →
   the full tree. Interpolate trunk height, `CANOPY_TOP`, `BASE_R`, skirt count,
   and sprig sizes from `g`.
2. Two ways to morph:
   - **Rebuild** the tree per growth step (simple; fine if not every frame), or
   - **Animate** instance matrices/scales of the existing foliage so sprigs
     emerge and skirts unfurl (smoother, no rebuild hitch).
3. Expose `g` as a slider in the existing control panel
   (`../01_webgl_tree/src/ui.js`) and/or auto-play growth over time in the
   render loop (`../01_webgl_tree/src/main.js`).
4. Optional: blend foliage colour toward autumn tones as a separate `season`
   parameter, reusing the per-instance colour path already in `tree.js`.

## Deliverable

A `g`-driven (and/or time-driven) growth animation of the same cedar, controlled
from the WebGL app. Drop notes/code here and import from `01_webgl_tree` as
needed.
