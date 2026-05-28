# Pixel Bonsai Team Project

Clean implementation folder for the final presentation.

## Project Idea

Pixel Bonsai is a 3D voxel tree that grows, changes season, and can be rendered in two ways:

1. **WebGL mode**: real-time interaction, growth, camera, season controls.
2. **Ray tracing mode**: render the same voxel tree state with higher-quality lighting.
3. **Morphing mode**: generate smooth transitions between growth / season / shape states.

This matches the PPT direction: the tree is not just next to ray tracing. The same voxel tree is the target of both renderers.

## Folder Split

```text
pixel_bonsai_team_project/
├── 01_webgl_tree/      # real-time WebGL tree app
├── 02_ray_tracing/     # ray tracing on the same voxel tree
├── 03_morphing/        # growth / season / shape transition tools
├── shared/             # shared tree state contract
├── outputs/            # generated outputs
└── docs/               # workflow and presentation notes
```

## Quick Start

Open the WebGL demo:

```text
01_webgl_tree/index.html
```

Render the shared voxel tree with ray tracing:

```bash
cd 02_ray_tracing
python3 render_voxel_tree.py ../shared/tree_state.json ../outputs/ray_traced/sample_tree.png
```

Generate morphed tree states:

```bash
cd 03_morphing
python3 morph_tree_state.py ../shared/tree_state.json ../shared/tree_state_autumn.json --season autumn --t 1.0
```
