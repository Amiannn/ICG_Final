# Pixel Bonsai

A cozy little **3D pixel-art tree-tending game**, rendered in real time with Three.js.
You raise a tree from a Day-1 sprout into a towering cedar over 30 days — **watering**
it, **fertilising** with droppings the visiting animals leave behind, and **roasting
bone meal** over the campfire at night. Animals wander in to graze and gaze up at the
tree, fireflies drift through the dusk, and the sun arcs through a full **day–night
cycle**. It plays in a phone-shaped portrait UI, and the whole scene is drawn through
a low-resolution, cel-shaded, outlined pipeline for a clean pixel-art look.

Under the hood it's also a small graphics showcase: the same scene can be viewed in
several **technical modes** — staged tree growth and textbook morph-target morphing —
reachable from the in-game Settings panel. (A photoreal GPU path-tracer mode has been
retired to [`legacy/`](legacy/) for this version.)

The rendering style is inspired by David Holland's write-up on 3D pixel art
rendering (<https://www.davidhol.land/articles/3d-pixel-art-rendering/>); every
technique here is an independent Three.js implementation.

![Pixel Bonsai — day](docs/screenshots/day.png)

## The game

The default experience is a self-running little garden in a phone-portrait HUD:

- **Grow a tree, day by day.** A day counter advances on its own; the tree
  continuously morphs from a sprout (Day 1) to its full form (Day 30). The camera
  stays in a fixed close-up — drag to orbit, pinch / wheel to zoom.
- **Three ways to tend it.** Each resource is *earned* from the world and plays its
  own animation on the tree:
  - 💧 **Water** — tap the **pond** to scoop a charge, then Water to sprinkle the
    canopy. *(+½ day of growth)*
  - 🟫 **Fertilize** — grazing animals leave **droppings** behind; tap them to
    collect fertiliser. *(+1 day)*
  - 🦴 **Bone Meal** — at **night**, tap an animal to lead it into the **campfire**;
    it roasts down into bone meal. *(+2 days)*
- **Animals visit.** Cows, sheep and a dog wander **in from off-screen** now and
  then (not a standing herd) — they graze, walk over to **gaze up at the tree**,
  linger for a morning or a night, then leave.
- **Time of day.** A day/night slider scrubs sunrise → noon → sunset → night; left
  alone, the sun cycles on its own and the lighting grades smoothly. Nights stay a
  clear moonlit blue, with **fireflies** and a glowing **campfire**.
- **Weather.** Showers roll in at random — rain streaks, **pond ripples**, **ground
  splash rings**, and procedural rain ambience.
- **Atmosphere.** Gentle **day / night ambient music**, wind that sways the grass
  and foliage, flowery hillsides, and a Day-30 night **festival** (fireworks + the
  animals dance) to cap the run.
- **Journal.** The book button logs events (rain, an animal visiting, your actions).

The slider/sheet collapse with the grabber to reveal the full scene; the gear opens
**Settings** (graphics options, resolution, tree species, sound, and the technical
modes).

## Demo

| Moonlit night — fireflies & campfire | Animals graze by the tree |
| --- | --- |
| ![night](docs/screenshots/demo_night.png) | ![wildlife](docs/screenshots/demo_wildlife.png) |

**Raise the tree, day by day** — a Day-4 sprout → the crown fills in → the full cedar:

| Day 4 | Day 13 | Day 27 |
| --- | --- | --- |
| ![growth 1](docs/screenshots/demo_growth_1.png) | ![growth 2](docs/screenshots/demo_growth_2.png) | ![growth 3](docs/screenshots/demo_growth_3.png) |

## Quick start

```bash
cd 01_webgl_tree
npm install
npm run dev        # open http://localhost:3000 (already runs with --host for your LAN)
```

Open the LAN URL on a phone for the full-screen portrait experience (pinch to zoom,
drag to orbit). Build a static bundle with `npm run build` (output in
`01_webgl_tree/dist/`).

## Modes

The game is the default mode. Open **Settings → Mode** to switch (or deep-link with
`?mode=realtime` / `growth` / `growthmorph`):

- **Game** — the tree-tending game described above (real-time pipeline + game clock).
- **Real-time** — the full living scene with no game layer: day–night cycle, weather,
  wind, wildlife.
- **Growth** — the cedar develops from a twig sprout into the full tree (a looping,
  parametric developmental morph). Grass, flowers, animals and birds fill in as it grows.
- **Morph** — a textbook morph-target version of the growth (every vertex is
  interpolated between a sapling and a mature key-shape).

## What's in the renderer

The whole scene is drawn into a small render target (default 720px tall) and
upscaled with nearest-neighbour sampling, so everything reads as crisp pixels.

**Pixel-art pipeline**
- **Low-res pipeline** — color + depth + view-normal targets, post passes, then a
  nearest upscale to the canvas.
- **Pixel-perfect camera** — snaps to a view-aligned texel grid; the final image
  is shifted back by the sub-pixel snap error, so panning stays smooth. The game
  keeps a fixed close-up framing (it does **not** zoom out as the tree grows); drag
  to orbit (yaw), pinch / wheel to zoom.
- **Cel shading + cloud shadows** — toon gradient ramp; a scrolling noise texture
  can be injected into every material as soft cloud shadows.
- **Outlines** — depth/normal edge detection for single-pixel outlines.
- **Planar-reflection water**, **volumetric god rays**, **dust motes** (which turn
  into glowing **fireflies** at night), plus 2D film grain and vignette.

**Atmosphere & life**
- **Day–night cycle** — a keyframed sky/fog/sun gradient with an arcing sun (so
  shadows rotate). Deep night stays a visible *moonlit blue* rather than black, with
  fireflies and a campfire glow; god rays fade out at night and in rain. In Game mode
  the cycle is driven by the game clock / time slider.
- **Weather** — rain as gentle, sparse, wind-slanted streaks with an overcast grade
  and procedural rain ambience. Raindrops **ripple the pond** (perturbing the
  reflection) and pop **splash rings** across the ground and water.
- **Terrain & flora** — a mountain-ring backdrop, an enlarged pond, and grassy,
  flowery hillsides — carpet grass covers the slopes (sides included) with scattered
  blue flowers.
- **Wind** — a shared uniform sways the grass and foliage billboards across the
  whole scene (gustier while it rains).
- **Wildlife** — low-poly cows, sheep and a dog walk *in from off-screen*, graze,
  admire the tree and leave droppings; a small flock of birds glides overhead.

**Game layer** ([`01_webgl_tree/src/modes/game.js`](01_webgl_tree/src/modes/game.js))
- A clock advances the day counter and feeds a continuous growth value to the chosen
  tree; the time-of-day, random weather and the three resources (Water / Fertilize /
  Bone Meal) all hook into the existing lighting, rain, particle and growth systems.
  Each action fires its own on-tree effect, and the day-30 festival closes the show.

**Tree growth** ([`02_tree_growth`](02_tree_growth/))
- **Parametric developmental morph** of the *same* cedar: bare twigs first, then
  leaves bud and fill the crown as a smooth wave while it opens out — ending exactly
  as the scene's tree. Reused by the Game's "cedar" species via
  [`cedar_growth.js`](02_tree_growth/src/cedar_growth.js).
- **Morph-target tree** ([`morph_tree.js`](02_tree_growth/src/morph_tree.js)) — a
  dedicated sprout↔mature mesh whose every vertex is linearly interpolated (the
  "morph" species / Morph mode).

**Path tracing** — *retired to [`legacy/03_ray_tracing`](legacy/03_ray_tracing/) for
this version.* A photoreal GPU path tracer (three-gpu-pathtracer + three-mesh-bvh) of
the same tree; kept for reference but not wired into the current build.

## Project structure

This is a team project. The real-time WebGL tree is the shared subject; the two
other folders build on the same tree for different goals. For team development
conventions (mode plugin contract, shared `ctx`, tree API, git/ownership rules)
see [`CONTRIBUTING.md`](CONTRIBUTING.md).

```text
ICG_Final/
├── 01_webgl_tree/    # real-time WebGL Pixel Bonsai (Three.js + Vite) — the game + base
│                     #   mobile game UI, day-night, weather, wind, wildlife, campfire
├── 02_tree_growth/   # growth morphing: twig sprout -> full cedar (+ morph-target tree)
├── legacy/
│   └── 03_ray_tracing/   # retired photoreal path-traced showcase (not in this build)
└── docs/             # screenshots, slides and notes
```

The cedar (trunk, root system, layered foliage skirts) is generated procedurally
in [`01_webgl_tree/src/scene/tree.js`](01_webgl_tree/src/scene/tree.js) and is
parameterised by a single scale factor — the basis for the growth animation.
