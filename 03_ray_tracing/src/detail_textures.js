import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural detail textures (albedo + normal) for the path-traced view.
//
// The biggest "this isn't real" tell in the photoreal render is that the ground
// and trunk are flat untextured plastic. Path tracing can't invent surface
// detail, so we bake some: a tiling grass albedo+normal for the ground and a
// vertical-streak bark albedo+normal for the trunk/branches. Under the low
// golden key the normal maps catch micro-relief, which reads as real surface.
//
// Canvas-based value-noise fBm (no assets, deterministic). Generated once when
// the path-trace mode initialises and disposed on exit.
// ---------------------------------------------------------------------------

function ihash(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 69069);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = ihash(xi, yi, seed);
  const b = ihash(xi + 1, yi, seed);
  const c = ihash(xi, yi + 1, seed);
  const d = ihash(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// fractal Brownian motion; fx/fy let us stretch the noise (vertical bark streaks)
function fbm(x, y, seed, octaves, fx, fy) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * fx * f, y * fy * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Build a CanvasTexture pair (albedo + normal) from per-pixel callbacks.
// `shade(u,v)` -> [r,g,b] in 0..1; `height(u,v)` -> 0..1 for the normal map.
function bakePair(size, shade, height, normalStrength) {
  const albCanvas = document.createElement("canvas");
  albCanvas.width = albCanvas.height = size;
  const nrmCanvas = document.createElement("canvas");
  nrmCanvas.width = nrmCanvas.height = size;
  const aCtx = albCanvas.getContext("2d");
  const nCtx = nrmCanvas.getContext("2d");
  const aImg = aCtx.createImageData(size, size);
  const nImg = nCtx.createImageData(size, size);

  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const c = shade(u, v);
      const i = (y * size + x) * 4;
      aImg.data[i] = clamp01(c[0]) * 255;
      aImg.data[i + 1] = clamp01(c[1]) * 255;
      aImg.data[i + 2] = clamp01(c[2]) * 255;
      aImg.data[i + 3] = 255;
      h[y * size + x] = height(u, v);
    }
  }
  // height -> tangent-space normal via finite differences (wrapping)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = h[y * size + ((x - 1 + size) % size)];
      const hr = h[y * size + ((x + 1) % size)];
      const hd = h[((y - 1 + size) % size) * size + x];
      const hu = h[((y + 1) % size) * size + x];
      let nx = -(hr - hl) * normalStrength;
      let ny = -(hu - hd) * normalStrength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      nImg.data[i] = (nx * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);

  const map = new THREE.CanvasTexture(albCanvas);
  const normalMap = new THREE.CanvasTexture(nrmCanvas);
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  return { map, normalMap };
}

// Grass: patchy greens with occasional dry/golden tufts; fine high-freq relief.
export function makeGrassTextures(size = 384, seed = 7) {
  const dark = [0.18, 0.30, 0.13];
  const light = [0.42, 0.56, 0.24];
  const dry = [0.58, 0.52, 0.26];
  return bakePair(
    size,
    (u, v) => {
      const patch = fbm(u, v, seed, 5, 6, 6);
      const blade = fbm(u, v, seed + 5, 4, 60, 60);
      const t = clamp01(patch * 0.65 + blade * 0.45);
      let c = [lerp(dark[0], light[0], t), lerp(dark[1], light[1], t), lerp(dark[2], light[2], t)];
      const d = fbm(u, v, seed + 9, 3, 4, 4);
      if (d > 0.62) {
        const k = (d - 0.62) * 2.4;
        c = [lerp(c[0], dry[0], k), lerp(c[1], dry[1], k), lerp(c[2], dry[2], k)];
      }
      return c;
    },
    (u, v) => fbm(u, v, seed + 5, 5, 60, 60) * 0.7 + fbm(u, v, seed, 4, 12, 12) * 0.3,
    2.5,
  );
}

// Bark: vertical streaks (high X freq, low Y freq) in warm browns; ridged relief.
export function makeBarkTextures(size = 384, seed = 23) {
  const darkB = [0.20, 0.12, 0.07];
  const lightB = [0.50, 0.33, 0.19];
  return bakePair(
    size,
    (u, v) => {
      const streak = fbm(u, v, seed, 5, 9, 1.2);
      const fine = fbm(u, v, seed + 3, 3, 40, 6);
      const t = clamp01(streak * 0.72 + fine * 0.32);
      return [lerp(darkB[0], lightB[0], t), lerp(darkB[1], lightB[1], t), lerp(darkB[2], lightB[2], t)];
    },
    (u, v) => fbm(u, v, seed, 5, 9, 1.2) * 0.8 + fbm(u, v, seed + 3, 3, 40, 6) * 0.2,
    4.0,
  );
}

export function disposeTextures(pair) {
  if (!pair) return;
  pair.map?.dispose?.();
  pair.normalMap?.dispose?.();
}
