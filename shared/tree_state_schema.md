# Shared Tree State Schema

This folder is the contract between the three collaboration blocks.

`tree_state.json` describes one voxel tree state:

- `voxelSize`: cube size used by all renderers.
- `age`: normalized growth state, `0.0` sapling to `1.0` mature.
- `season`: current visual state.
- `light`: shared lighting direction for WebGL and ray tracing comparison.
- `voxels[]`: each cube with `position`, `color`, and semantic `part`.

The important project idea is: **WebGL mode and Ray tracing mode should render this same tree state.**
