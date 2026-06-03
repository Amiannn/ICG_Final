import * as THREE from "three";

// 03 · M4 — bake instanced billboards into static path-traceable geometry.
//
// three-gpu-pathtracer can't render InstancedMesh (B1), so the real-time view's
// 18k-style grass and the tree's billboard-sprig canopy vanish in path-trace
// mode — the trunk traces but the foliage disappears.
//
// Billboards face the camera at render time, which has no meaning for a path
// tracer (rays come from everywhere). We instead bake each instance into a pair
// of *crossed* quads (two perpendicular vertical planes) carrying the original
// sprig/tuft alpha texture. Crossed quads read as a volumetric clump from any
// angle and cast believable dappled shadows — the standard trick for turning
// billboard foliage into ray-traceable geometry.
//
// Per-instance tint (InstancedMesh.instanceColor) is baked into a vertex-colour
// attribute, and the original alpha texture drives an alphaTest cutout so the
// leaf/blade silhouette survives.

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _col = new THREE.Color();

// Local crossed-quad frames: quad A spans world X/Y, quad B spans world Z/Y.
// Both stay vertical so foliage hangs naturally. `normal` is the geometric
// facing of each quad; it is NOT used as the shading normal (we force that to
// world-up below, mirroring the real-time billboard lighting) — kept here only
// to document the quad orientation.
const FRAMES = [
  { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  { right: [0, 0, 1], up: [0, 1, 0], normal: [1, 0, 0] },
];
// Denser frame set for tree foliage: 3 vertical quads in an asterisk (0/60/120°
// around world-up) instead of 2. Two crossed quads leave wide wedge gaps that
// an oblique/iso camera sees straight through to the dark canopy interior;
// three quads close those wedges so the canopy reads as a filled mass from any
// horizontal angle. Grass keeps the cheaper 2-quad set.
const C60 = Math.cos(Math.PI / 3);
const S60 = Math.sin(Math.PI / 3);
const FOLIAGE_FRAMES = [
  { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  { right: [C60, 0, S60], up: [0, 1, 0], normal: [0, 0, 1] },
  { right: [-C60, 0, S60], up: [0, 1, 0], normal: [0, 0, 1] },
];
// quad corners as (rightSign, upSign) with matching uv
const CORNERS = [
  { r: -0.5, u: -0.5, uv: [0, 0] },
  { r: 0.5, u: -0.5, uv: [1, 0] },
  { r: 0.5, u: 0.5, uv: [1, 1] },
  { r: -0.5, u: 0.5, uv: [0, 1] },
];

// Lift the dark baked foliage greens toward a brighter leaf green. The canopy's
// vertex-colour gradient bottoms out at a near-black green (tree.js darkGreen
// 0x33522d); under real GI that base reads too dark, so we nudge every foliage
// colour toward this lush green to match the real-time view's brightness.
const _LIFT = new THREE.Color(0x9ccc6a);
const FOLIAGE_LIFT = 0.1; // gentle: keep tree.js's dark-base -> warm-crown gradient

// Foliage shading-normal blend: lean the per-card normal outward from the trunk
// axis (radial) while keeping a strong up component, so the canopy shades as a
// rounded 3D form (bright sun-side, dark shadow-side) instead of a flat mass.
const NORMAL_UP = 0.7;
const NORMAL_RADIAL = 0.72;

// Build a static Mesh (crossed quads) reproducing an InstancedMesh of billboards.
// The result lives in the same local space as `inst`, so parent it to inst.parent.
//
//   foliage   – tree canopy treatment: 3-quad asterisk, radial form normals,
//               lifted greens + emissive translucency floor. Else grass: 2-quad
//               cross, world-up normals, plain.
//   cutout    – keep the alpha texture as an alphaTest silhouette (leafy gaps).
//               When false the quads are SOLID (no see-through). The canopy is
//               built as TWO layers: a solid inner filler (cutout:false) so gaps
//               never reveal black, and a leafy outer shell (cutout:true) for the
//               sprig silhouette + tier separation. Grass is a single cutout pass.
//   sizeScale – quad size multiplier (lets the inner filler sit just inside the
//               outer leaves).
export function mergeBillboardsToMesh(
  inst,
  { roughness = 0.8, foliage = false, cutout = !foliage, sizeScale } = {},
) {
  const count = inst.count;
  const map = inst.material.map ?? null;
  const baseColor = inst.material.color ? inst.material.color.clone() : new THREE.Color(0xffffff);

  // Foliage uses the denser 3-quad asterisk; grass keeps the cheap 2-quad cross.
  const frames = foliage ? FOLIAGE_FRAMES : FRAMES;
  if (sizeScale == null) sizeScale = foliage ? 1.4 : 1.0;

  const vertsPerInst = frames.length * 4;
  const trisPerInst = frames.length * 2;
  const positions = new Float32Array(count * vertsPerInst * 3);
  const normals = new Float32Array(count * vertsPerInst * 3);
  const uvs = new Float32Array(count * vertsPerInst * 2);
  const colors = new Float32Array(count * vertsPerInst * 3);
  const indices = new Uint32Array(count * trisPerInst * 3);

  let vi = 0; // vertex cursor
  let ii = 0; // index cursor
  let skipped = 0; // degenerate (non-finite) instances dropped

  for (let i = 0; i < count; i++) {
    inst.getMatrixAt(i, _mat);
    _pos.setFromMatrixPosition(_mat);
    const sx = _vecLen(_mat.elements, 0); // length of basis column 0
    const sy = _vecLen(_mat.elements, 4); // length of basis column 1

    // Fail soft at this boundary: a single NaN/Inf instance matrix would
    // poison the whole baked geometry and make the path tracer's
    // computeBoundingSphere() return a NaN radius. Drop it and warn instead.
    if (!_isFinite3(_pos) || !Number.isFinite(sx) || !Number.isFinite(sy)) {
      skipped++;
      continue;
    }

    if (inst.instanceColor) _col.fromArray(inst.instanceColor.array, i * 3);
    else _col.set(0xffffff);
    _col.multiply(baseColor);
    if (foliage) _col.lerp(_LIFT, FOLIAGE_LIFT);

    // Per-instance shading normal. Grass stays world-up (flat ground lighting).
    // Foliage gets a normal that leans OUTWARD from the trunk axis (radial) +
    // up, so the canopy shades like a rounded 3D form: the sun-facing side reads
    // bright and the shadow side reads dark, instead of every card sharing the
    // same world-up normal and rendering as one flat green mass. The instance
    // position is in the tree group's local space, centred on the trunk, so the
    // radial direction is just normalize(x, 0, z).
    let nx = 0,
      ny = 1,
      nz = 0;
    if (foliage) {
      const rl = Math.hypot(_pos.x, _pos.z);
      if (rl > 1e-3) {
        nx = (_pos.x / rl) * NORMAL_RADIAL;
        ny = NORMAL_UP;
        nz = (_pos.z / rl) * NORMAL_RADIAL;
        const ln = Math.hypot(nx, ny, nz) || 1;
        nx /= ln;
        ny /= ln;
        nz /= ln;
      }
    }

    const ssx = sx * sizeScale;
    const ssy = sy * sizeScale;
    for (const f of frames) {
      const quadBase = vi;
      for (const c of CORNERS) {
        const p3 = vi * 3;
        positions[p3 + 0] = _pos.x + c.r * ssx * f.right[0] + c.u * ssy * f.up[0];
        positions[p3 + 1] = _pos.y + c.r * ssx * f.right[1] + c.u * ssy * f.up[1];
        positions[p3 + 2] = _pos.z + c.r * ssx * f.right[2] + c.u * ssy * f.up[2];
        // Shade normal (per-instance, computed above) — radial-outward+up for
        // foliage form shading, world-up for flat grass. NOT the quad face
        // normal; the quads stay vertical only for silhouette + shadow casting.
        normals[p3 + 0] = nx;
        normals[p3 + 1] = ny;
        normals[p3 + 2] = nz;
        colors[p3 + 0] = _col.r;
        colors[p3 + 1] = _col.g;
        colors[p3 + 2] = _col.b;
        uvs[vi * 2 + 0] = c.uv[0];
        uvs[vi * 2 + 1] = c.uv[1];
        vi++;
      }
      indices[ii++] = quadBase + 0;
      indices[ii++] = quadBase + 1;
      indices[ii++] = quadBase + 2;
      indices[ii++] = quadBase + 0;
      indices[ii++] = quadBase + 2;
      indices[ii++] = quadBase + 3;
    }
  }

  if (skipped > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `mergeBillboardsToMesh: skipped ${skipped}/${count} instances with non-finite transforms`,
    );
  }

  // Trim to the vertices/indices actually written (skipped instances leave
  // unused tail slots in the preallocated buffers).
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions.subarray(0, vi * 3), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals.subarray(0, vi * 3), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs.subarray(0, vi * 2), 2));
  geo.setAttribute("color", new THREE.BufferAttribute(colors.subarray(0, vi * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(indices.subarray(0, ii), 1));

  // The path tracer renders true GI, so foliage can't lean on the real-time toon
  // ramp's lifted shadow floor to stay bright. Material choices (see PLAN §9.2):
  //
  //   • cutout layer keeps the sprig alpha as an alphaTest silhouette so the leaf
  //     shapes + gaps survive (the "leafy / tier separation" look). On its own a
  //     cutout canopy reads near-black: under real GI camera rays thread through
  //     the sparse feathery gaps and hit the dark self-shadowed interior + brown
  //     core. The inner SOLID filler layer (cutout:false) backs it so those gaps
  //     reveal soft shadowed green instead of black.
  //
  //   • Translucency. Real leaves transmit light and read bright even in shadow.
  //     MeshPhysicalMaterial transmission was tried but compounded Beer-Lambert
  //     absorption across the overlapping cards into an even darker canopy.
  //     Instead we approximate Habel 2007's real-time leaf translucency the way
  //     that paper does — as an ADDITIVE self-illumination term (a low emissive
  //     floor). The path tracer adds emission at the surface un-modulated by
  //     albedo (get_surface_record: emission = emissiveIntensity * emissive), so
  //     stacked cards can't absorb it away. It's kept LOW so it only lifts the
  //     deepest shadows out of black without flattening the radial form shading.
  //     roughness 1.0 keeps leaves diffuse so the bluish sky env can't cast a
  //     purple specular sheen on the dark greens.
  //
  // Grass is a single cutout pass: it sits flat on the ground, is lit fine, and
  // seeing the ground through blade gaps is correct.
  const matOpts = {
    color: 0xffffff, // tint comes from the baked vertex colours
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: foliage ? 1.0 : roughness,
    metalness: 0.0,
  };
  if (cutout) {
    matOpts.map = map; // alpha texture (leaf/blade shape + colour)
    matOpts.alphaTest = 0.5; // cutout silhouette (matches the billboard material)
    matOpts.transparent = false;
  }
  if (foliage) {
    matOpts.emissive = new THREE.Color(0x3c6b28); // Habel-style translucency floor
    matOpts.emissiveIntensity = 0.3;
  }
  const mat = new THREE.MeshStandardMaterial(matOpts);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function _vecLen(e, col) {
  const x = e[col],
    y = e[col + 1],
    z = e[col + 2];
  return Math.sqrt(x * x + y * y + z * z);
}

function _isFinite3(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
