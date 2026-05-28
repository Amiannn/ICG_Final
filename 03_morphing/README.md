# 03 Morphing / Deformation

This block transforms one shared voxel tree state into another.

The first target is season morphing because it is stable and easy to integrate.

Run:

```bash
python3 morph_tree_state.py ../shared/tree_state.json ../shared/tree_state_autumn.json --season autumn --t 1.0
```

The output can be used by both WebGL and ray tracing.
