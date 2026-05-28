# 02 Ray Tracing on Voxel Tree

This block renders the same voxel tree state used by WebGL.

Input:

```text
../shared/tree_state.json
```

Output:

```text
../outputs/ray_traced/*.png
```

Run:

```bash
python3 render_voxel_tree.py ../shared/tree_state.json ../outputs/ray_traced/sample_tree.png

# higher resolution, slower
python3 render_voxel_tree.py ../shared/tree_state.json ../outputs/ray_traced/sample_tree_hq.png --width 720 --height 480
```

Concept for presentation:

> WebGL mode gives real-time interaction. Ray tracing mode re-renders the same voxel tree state with higher-quality shadows and lighting.
