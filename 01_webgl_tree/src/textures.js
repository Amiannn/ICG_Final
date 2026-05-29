import * as THREE from "three";

// A 1-row data texture used as a toon gradient ramp. NearestFilter keeps the
// hard bands that define the cel-shaded look.
export function makeToonRamp(hexColors) {
  const data = new Uint8Array(hexColors.length * 4);
  hexColors.forEach((hex, i) => {
    const c = new THREE.Color(hex);
    data[i * 4 + 0] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, hexColors.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Smooth tiling value-noise texture (used for cloud shadows scrolling over the
// world). Built from a few octaves of hashed lattice noise.
export function makeCloudTexture(size = 256) {
  const data = new Uint8Array(size * size);

  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const valueNoise = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const wrap = (v) => ((v % period) + period) % period;
    const a = hash(wrap(xi), wrap(yi));
    const b = hash(wrap(xi + 1), wrap(yi));
    const c = hash(wrap(xi), wrap(yi + 1));
    const d = hash(wrap(xi + 1), wrap(yi + 1));
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, xf),
      THREE.MathUtils.lerp(c, d, xf),
      yf,
    );
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.6;
      let freq = 4;
      let v = 0;
      for (let o = 0; o < 4; o++) {
        v += valueNoise((x / size) * freq, (y / size) * freq, freq) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// A small soft round sprite used for grass/leaf billboards and flowers.
// Returns a CanvasTexture with a vertical light->dark gradient so quads read as
// little tufts even when evenly lit.
export function makeBlobTexture(top = "#dff0c0", bottom = "#9bbd72", size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;

  // Rounded blade/tuft silhouette.
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.05);
  ctx.quadraticCurveTo(size * 0.95, size * 0.4, size * 0.78, size * 0.95);
  ctx.lineTo(size * 0.22, size * 0.95);
  ctx.quadraticCurveTo(size * 0.05, size * 0.4, size * 0.5, size * 0.05);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// A small multi-blade grass tuft sprite (a few pointed blades fanning out),
// closer to the reference's little grass clumps than a single rounded blob.
export function makeGrassTuft(top = "#cfe89a", bottom = "#6f9450", size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;

  const baseY = size * 0.96;
  const blades = [
    { x: 0.5, tipY: 0.04, w: 0.1, lean: 0.0 },
    { x: 0.3, tipY: 0.22, w: 0.085, lean: -0.12 },
    { x: 0.7, tipY: 0.2, w: 0.085, lean: 0.12 },
    { x: 0.16, tipY: 0.42, w: 0.07, lean: -0.18 },
    { x: 0.84, tipY: 0.4, w: 0.07, lean: 0.18 },
  ];
  for (const b of blades) {
    const bx = b.x * size;
    const tx = (b.x + b.lean) * size;
    const ty = b.tipY * size;
    const hw = b.w * size;
    ctx.beginPath();
    ctx.moveTo(bx - hw, baseY);
    ctx.quadraticCurveTo((bx + tx) / 2 - hw * 0.3, (baseY + ty) / 2, tx, ty);
    ctx.quadraticCurveTo((bx + tx) / 2 + hw * 0.3, (baseY + ty) / 2, bx + hw, baseY);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// A drooping fir/cedar sprig sprite: stacked needle rows narrowing to a point
// at the bottom, with a light-to-dark vertical gradient. Billboards built from
// this read as soft, downward-drooping conifer foliage tiers.
export function makeFirSprig(top = "#9fc06a", bottom = "#3f5e38", size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const lerp = (a, b, t) => a + (b - a) * t;
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const cy = lerp(0.1, 0.9, t) * size;
    const halfW = lerp(0.46, 0.05, t) * size; // wide at top, point at bottom
    const droop = lerp(0.06, 0.16, t) * size; // lower rows droop more
    // shade darker toward the bottom of the sprig
    const shade = i / rows;
    ctx.fillStyle = mixHex(top, bottom, shade);

    // a downward chevron (two needle lobes meeting below the centre)
    ctx.beginPath();
    ctx.moveTo(size * 0.5, cy - droop * 0.4);
    ctx.quadraticCurveTo(size * 0.5 - halfW * 0.6, cy, size * 0.5 - halfW, cy + droop);
    ctx.lineTo(size * 0.5, cy + droop * 1.5);
    ctx.lineTo(size * 0.5 + halfW, cy + droop);
    ctx.quadraticCurveTo(size * 0.5 + halfW * 0.6, cy, size * 0.5, cy - droop * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function mixHex(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  ca.lerp(cb, t);
  return `#${ca.getHexString()}`;
}

// Procedural "wave lines" texture for the water surface. Like the article
// describes, colour channels pack different aspects: R = horizontal wave line
// mask, G = a slower large swell, B = sparkle noise. Sampled + scrolled in the
// water shader to animate crests.
export function makeWaterTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // crisp horizontal bands
      const band = Math.sin(v * Math.PI * 18 + Math.sin(u * Math.PI * 4) * 0.8);
      const lines = band > 0.72 ? 1 : 0;
      // broad swell
      const swell = 0.5 + 0.5 * Math.sin(v * Math.PI * 4 + u * Math.PI * 2);
      // sparkle
      const sparkle = hash(Math.floor(u * 90), Math.floor(v * 90)) > 0.93 ? 1 : 0;
      const i = (y * size + x) * 4;
      data[i + 0] = lines * 255;
      data[i + 1] = Math.round(swell * 255);
      data[i + 2] = sparkle * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
