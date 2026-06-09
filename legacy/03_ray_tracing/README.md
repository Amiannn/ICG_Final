# 03 · Ray Tracing (Lighting)

**Goal:** render the same bonsai with ray-traced lighting — soft shadows, light
bounce, and contact shadows the real-time cel pipeline can't do — as a
higher-quality companion to the WebGL view.

This builds on the scene in `../01_webgl_tree`.

## What to render

The same procedural tree + ground + rocks + pond. The tree builder is
[`../01_webgl_tree/src/scene/tree.js`](../01_webgl_tree/src/scene/tree.js); the
world is assembled in
[`../01_webgl_tree/src/scene/world.js`](../01_webgl_tree/src/scene/world.js).
Keep the same sun direction and palette so the two renders are comparable.

## Two viable paths

- **In-browser path tracer (recommended):** keep the existing Three.js scene and
  drop in `three-gpu-pathtracer`. You get soft directional shadows, GI, and a
  toggle to switch between the real-time view and the path-traced view of the
  identical scene graph. Least duplication of work.
- **Offline ray tracer:** export the scene (geometry + materials + camera + sun)
  to a simple format and render it in a standalone tracer (your own, or e.g. a
  Python/POV-style renderer). Save stills to `../docs/` for the report.

## Suggested steps

1. Decide on a path (above). For the in-browser route, reuse the camera and sun
   from `../01_webgl_tree/src/lighting.js` so framing matches.
2. Get a single still of the cedar with ray-traced soft shadows + one bounce.
3. Add a comparison shot (real-time vs ray-traced) for the presentation.
4. Optional: keep the pixel-art feel by quantising/pixelating the ray-traced
   output to match the WebGL look.

## Deliverable

At least one ray-traced still of the same scene (plus a real-time/ray-traced
comparison). Put code here and reference assets from `01_webgl_tree`.
