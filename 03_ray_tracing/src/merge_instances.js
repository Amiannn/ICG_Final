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

// Build a static Mesh (crossed quads) reproducing an InstancedMesh of billboards.
// The result lives in the same local space as `inst`, so parent it to inst.parent.
export function mergeBillboardsToMesh(inst, { roughness = 0.8, translucent = false } = {}) {
  const count = inst.count;
  const map = inst.material.map ?? null;
  const baseColor = inst.material.color ? inst.material.color.clone() : new THREE.Color(0xffffff);

  // Foliage uses the denser 3-quad asterisk + slightly enlarged quads so the
  // crossed planes overlap into a filled canopy; grass keeps the cheap 2-quad
  // cross at native size.
  const frames = translucent ? FOLIAGE_FRAMES : FRAMES;
  const sizeScale = translucent ? 1.4 : 1.0;

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

    const ssx = sx * sizeScale;
    const ssy = sy * sizeScale;
    for (const f of frames) {
      const quadBase = vi;
      for (const c of CORNERS) {
        const p3 = vi * 3;
        positions[p3 + 0] = _pos.x + c.r * ssx * f.right[0] + c.u * ssy * f.up[0];
        positions[p3 + 1] = _pos.y + c.r * ssx * f.right[1] + c.u * ssy * f.up[1];
        positions[p3 + 2] = _pos.z + c.r * ssx * f.right[2] + c.u * ssy * f.up[2];
        // Shade normal points world-up, NOT along the quad face. This mirrors
        // the real-time billboard material (materials.js flattens the normal to
        // world-up) so foliage is lit evenly by the sky/sun like the ground.
        // The quads stay vertical for silhouette + shadow casting; only the
        // lighting normal is lifted. Without this, sideways-facing normals get
        // almost no light under the overhead sun and the canopy renders black.
        normals[p3 + 0] = 0;
        normals[p3 + 1] = 1;
        normals[p3 + 2] = 0;
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

  // Real leaves are thin translucent slabs: light transmits through the upper
  // canopy to fill the leaves below, which is why foliage reads bright even in
  // shadow. An opaque MeshStandardMaterial can't do this, so a dense path-traced
  // canopy goes near-black. Approximate Habel 2007's leaf translucency with
  // MeshPhysicalMaterial transmission + a green attenuation tint (the path
  // tracer supports both). Non-foliage billboards (if any) stay opaque.
  const matParams = {
    map, // original alpha texture (leaf/blade shape + colour)
    color: 0xffffff, // tint comes from the baked vertex colours
    vertexColors: true,
    alphaTest: 0.5, // cutout silhouette (matches the billboard material)
    transparent: false,
    side: THREE.DoubleSide,
    roughness,
    metalness: 0.0,
  };
  const mat = translucent
    ? new THREE.MeshPhysicalMaterial({
        ...matParams,
        transmission: 0.6, // fraction of light that passes through the leaf
        thickness: 0.4, // slab thickness driving attenuation
        ior: 1.4,
        attenuationColor: new THREE.Color(0x6f9a4e), // transmitted light picks up leaf green
        attenuationDistance: 0.6,
        specularIntensity: 0.4,
      })
    : new THREE.MeshStandardMaterial(matParams);

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
