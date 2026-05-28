# Collaboration Workflow

## Block 1: WebGL Tree

Owner works in `01_webgl_tree/`.

Main responsibilities:

- real-time tree growth
- camera and UI controls
- exporting or syncing current tree state to `shared/tree_state.json`

## Block 2: Ray Tracing

Owner works in `02_ray_tracing/`.

Main responsibility:

- read `shared/tree_state.json`
- ray trace the same voxel tree
- output high-quality image to `outputs/ray_traced/`

## Block 3: Morphing

Owner works in `03_morphing/`.

Main responsibility:

- take one tree state and create another smooth state
- season morph: color / density / atmosphere
- growth morph: age and visible voxels
- shape morph: branch/voxel displacement if time allows

## Integration Rule

Do not build three separate demos. Each block should either read from or write to `shared/tree_state.json`.
