# Tree-Growth Morphing — Technique & Academic Basis

This documents the technique behind the **Growth** mode
([`02_tree_growth/src/growth.js`](../02_tree_growth/src/growth.js)) so it can be
described accurately in the report.

## What technique is this, exactly?

The growth animation is **parametric / procedural developmental morphing**: a
single growth parameter `g ∈ [0, 1]` (`growthProgress`) continuously drives the
generative parameters of the procedural cedar, so its *shape* changes
continuously from sapling to mature tree. This is the standard paradigm for
animating **plant development** in computer graphics.

It is honest to call this a *continuous morph* (the shape interpolates
continuously), and it is a recognised CG animation technique — but it is **not**
the same as *shape-interpolation morphing* (a.k.a. morph targets / blend shapes
/ image metamorphosis), where two corresponding key shapes are interpolated
vertex-by-vertex. See "Two senses of morphing" below.

## The three pillars (each with a citation)

`g` drives three coupled, literature-grounded behaviours:

1. **Timing — a sigmoidal (logistic) growth curve.**
   Organism size over time follows an S-curve: slow start → rapid juvenile
   growth → deceleration to a mature asymptote. The logistic and Gompertz
   functions are the standard sigmoidal growth models in forest biometrics.
   - *Zeide, B. (1993). "Analysis of growth equations." Forest Science 39(3):594–616.*

2. **Allometry — McMahon elastic self-similarity.**
   A tree is not a uniformly-scaled copy of itself at every age: trunk girth
   grows faster than height (diameter ∝ height^(3/2)), so a sapling is slender
   and a mature tree is stout. We scale height and girth **anisotropically**
   (`girth = heightScale^1.2`) rather than applying a uniform zoom.
   - *McMahon, T. A. (1973). "Size and Shape in Biology." Science 179(4079):1201–1204.*

3. **Developmental sequence — timed-L-system foliage emergence.**
   Foliage does not all appear at once; a fill front sweeps the canopy (here
   top→bottom) so tiers leaf out in order. This follows the continuous-time
   developmental-animation paradigm for plants.
   - *Prusinkiewicz, P., Hammel, M., & Mjolsness, E. (1993). "Animation of Plant
     Development." SIGGRAPH '93.*
   - *Prusinkiewicz, P., & Lindenmayer, A. (1990). "The Algorithmic Beauty of
     Plants." Springer-Verlag.*

## Pipeline (per frame)

```
g = logistic(t)                                  # Zeide 1993
heightScale = lerp(SAPLING_HEIGHT, 1, g)
girthScale  = heightScale ^ 1.2                  # McMahon 1973  (anisotropic)
tree.scale  = (girthScale, heightScale, girthScale)

for each foliage instance i at normalized height u_i:        # Prusinkiewicz 1993
    fill   = g * (1 + BAND)
    emerge = smoothstep((u_i - (1 - fill)) / BAND)           # top→bottom front
    instance_scale_i = emerge * heightScale
```

At `g = 1` the scale is identity and every foliage instance is its cached
original, so the fully-grown tree is **exactly** the production cedar.

## Two senses of "morphing"

| Sense | What it is | This project |
| --- | --- | --- |
| **Parametric / procedural morph** (developmental animation) | continuously interpolate the *parameters* of a generative model | ✅ used here (Growth mode) |
| **Shape-interpolation morph** (morph targets / blend shapes; image metamorphosis) | interpolate *corresponding vertices/pixels* between two key shapes | ✗ not used (a separate technique — *Beier & Neely, "Feature-Based Image Metamorphosis," SIGGRAPH '92*; three.js `morphAttributes`) |

If a strict shape-interpolation morph is required, the cedar's solid parts
(trunk, core) can additionally be driven by three.js morph targets
(`BufferGeometry.morphAttributes`) between a sapling key-geometry and the mature
key-geometry — genuine per-vertex blend-shape interpolation — while the canopy
keeps the developmental emergence above.
