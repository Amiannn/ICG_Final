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
// Tree foliage is NOT baked as a few big crossed quads. At this tree's sprig
// scale that read as a stack of hard flat rectangular slabs — a boxy green
// tower, not leaves. Instead each sprig instance explodes into a PUFF of many
// small leaf cards, scattered in position + azimuth + size, so the canopy reads
// as a soft leafy clump from any angle (and the dense overlap fills the volume,
// so see-through gaps land on other lit cards rather than the dark interior).
const FOLIAGE_PUFF = 16; // small SOLID cards per sprig instance — denser fill so the canopy reads as a lush conifer for the photoreal hero (was 8/sparse for the pixel-art look)
const PUFF_CARD = 0.46; // each card's size relative to the sprig (smaller + more of them = finer foliage, not slabs)
const PUFF_SPREAD = 0.72; // positional jitter of cards across the sprig footprint
const PUFF_TILT = 0.7; // max random tilt of a card off vertical (radians-ish)

// Deterministic hash → pseudo-random in [0,1); keeps the bake reproducible
// (no Math.random) so re-entering path-trace mode gives the same canopy.
function _hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}

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

// Build a static Mesh reproducing an InstancedMesh of billboards. The result
// lives in the same local space as `inst`, so parent it to inst.parent.
//
//   foliage – tree canopy: each sprig explodes into a PUFF of FOLIAGE_PUFF small
//             scattered cards, with radial form normals + lifted greens + an
//             emissive translucency floor. Reads as a soft leafy clump instead
//             of big flat slabs. Built as two passes (see raytrace_mode):
//             solid backing (no see-through-to-black) + cutout leaf detail.
//   solid   – when true the cards are opaque (no alpha cutout); when false they
//             carry the sprig alpha as an alphaTest silhouette (leaf shapes/gaps).
//   else      grass: a cheap 2-quad cross at native size, world-up normals.
//   sizeScale – overall size multiplier for the cards.
export function mergeBillboardsToMesh(
  inst,
  { roughness = 0.8, foliage = false, solid = false, sizeScale } = {},
) {
  const count = inst.count;
  const map = inst.material.map ?? null;
  const baseColor = inst.material.color ? inst.material.color.clone() : new THREE.Color(0xffffff);

  const cardsPerInst = foliage ? FOLIAGE_PUFF : FRAMES.length;
  if (sizeScale == null) sizeScale = foliage ? 1.35 : 1.0;

  const vertsPerInst = cardsPerInst * 4;
  const trisPerInst = cardsPerInst * 2;
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
    for (let k = 0; k < cardsPerInst; k++) {
      // Card frame: grass uses the fixed crossed-quad frames; foliage scatters a
      // small leaf card at a hashed position / azimuth / tilt / size to build a
      // soft puff.
      let rx, ry, rz, ux, uy, uz, ox, oy, oz, scaleX, scaleY;
      if (foliage) {
        const seed = i * 32.17 + k * 5.31;
        const az = (k / FOLIAGE_PUFF) * Math.PI * 2 + (_hash(seed + 0.1) - 0.5) * 1.6;
        const tilt = (_hash(seed + 0.2) - 0.5) * PUFF_TILT;
        rx = Math.cos(az);
        ry = 0;
        rz = Math.sin(az);
        // up = world-up tilted outward so cards aren't all dead vertical
        ux = tilt * rx;
        uy = 1;
        uz = tilt * rz;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul;
        uy /= ul;
        uz /= ul;
        ox = (_hash(seed + 0.3) - 0.5) * PUFF_SPREAD * ssx;
        oy = (_hash(seed + 0.4) - 0.5) * PUFF_SPREAD * ssy;
        oz = (_hash(seed + 0.5) - 0.5) * PUFF_SPREAD * ssx;
        const cs = PUFF_CARD * (0.6 + 0.8 * _hash(seed + 0.6));
        scaleX = ssx * cs;
        scaleY = ssy * cs;
      } else {
        const f = FRAMES[k];
        rx = f.right[0];
        ry = f.right[1];
        rz = f.right[2];
        ux = f.up[0];
        uy = f.up[1];
        uz = f.up[2];
        ox = oy = oz = 0;
        scaleX = ssx;
        scaleY = ssy;
      }

      const quadBase = vi;
      for (const c of CORNERS) {
        const p3 = vi * 3;
        positions[p3 + 0] = _pos.x + ox + c.r * scaleX * rx + c.u * scaleY * ux;
        positions[p3 + 1] = _pos.y + oy + c.r * scaleX * ry + c.u * scaleY * uy;
        positions[p3 + 2] = _pos.z + oz + c.r * scaleX * rz + c.u * scaleY * uz;
        // Shade normal (per-instance, computed above) — radial-outward+up for
        // foliage form shading, world-up for flat grass.
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

  // Both foliage and grass keep the alpha texture as an alphaTest cutout so the
  // leaf/blade silhouette survives (the leafy look). The path tracer renders true
  // GI, so foliage can't lean on the real-time toon ramp's lifted shadow floor:
  //
  //   • Translucency. Real leaves transmit light and read bright even in shadow.
  //     MeshPhysicalMaterial transmission was tried but compounded Beer-Lambert
  //     absorption across the overlapping cards into a darker canopy. Instead we
  //     approximate Habel 2007's real-time leaf translucency the way that paper
  //     does — as an ADDITIVE self-illumination term (a low emissive floor). The
  //     path tracer adds emission at the surface un-modulated by albedo
  //     (get_surface_record: emission = emissiveIntensity * emissive), so stacked
  //     cards can't absorb it away. Kept LOW so it only lifts the deepest shadows
  //     and any see-through-to-interior out of black, without flattening the
  //     radial form shading. roughness 1.0 keeps leaves diffuse so the bluish sky
  //     env can't cast a purple specular sheen on the dark greens.
  const matOpts = {
    color: 0xffffff, // tint comes from the baked vertex colours
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: foliage ? 1.0 : roughness,
    metalness: 0.0,
  };
  // SOLID cards carry no alpha cutout. A cutout sprig texture is feathery, so no
  // density of cutout cards ever fully covers — rays thread the gaps to the dark
  // interior and the canopy reads black. The solid backing puff gives a filled,
  // bright body; the cutout leaf puff then adds leaf silhouette + gaps on top of
  // it (those gaps land on the solid green backing, never black). Because both
  // are tiny scattered tilted cards, the silhouette stays irregular and leafy
  // rather than a boxy slab.
  if (!solid) {
    matOpts.map = map; // alpha cutout (leaf/blade shape)
    matOpts.alphaTest = 0.5;
    matOpts.transparent = false;
  }
  if (foliage) {
    // Habel-style translucency floor: lifts the shadow-side solid cards to a soft
    // green (the real-time toon ramp's lifted shadow) so the open canopy reads
    // green, not black, from any side; form shading adds the lit highlight on top.
    matOpts.emissive = new THREE.Color(0x44782f);
    matOpts.emissiveIntensity = 0.22; // lower now that a real golden key + sky fill light the canopy — let form shading read
  }
  const mat = new THREE.MeshStandardMaterial(matOpts);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Exclude billboards from the outline pass's normal/depth prepass, exactly as
  // the real-time view does (the source InstancedMeshes set skipNormal). The
  // many small tilted puff cards otherwise produce a scratchy mess of ink edges;
  // the outline should only ink the solid geometry (trunk, rocks, silhouette).
  mesh.userData.skipNormal = true;
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
