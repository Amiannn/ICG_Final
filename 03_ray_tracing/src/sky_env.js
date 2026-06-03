import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural sky+sun environment (equirectangular HDR DataTexture) for the
// path-traced view. Replaces the old flat sky→ground gradient, which lit the
// whole scene a uniform green and gave nothing interesting to reflect.
//
// This bakes a proper outdoor sky: a blue zenith fading to a warm pale horizon,
// a bright warm SUN DISK at the real sun direction, and a muted earthy lower
// hemisphere. The path tracer importance-samples this env, so the sun disk acts
// as the scene's key light (sharp soft shadows + warm directional shading), the
// blue sky fills shadows cool, and glossy surfaces / the pond reflect a real
// sky with a sun glint — the cues that read as "real ray tracing".
//
// Direction convention matches three's equirect sampling
// (u = atan2(z,x)/2π + .5, v = asin(y)/π + .5) so the baked sun lands exactly
// where reflections expect it.
// ---------------------------------------------------------------------------

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function makeSkyEnv(sunDir, opts = {}) {
  const W = opts.width ?? 1024;
  const H = opts.height ?? 512;

  const zenith = opts.zenith ?? [0.16, 0.33, 0.62]; // deep sky blue
  const horizon = opts.horizon ?? [0.70, 0.78, 0.82]; // pale, faintly warm
  const ground = opts.ground ?? [0.20, 0.21, 0.17]; // muted earthy bounce
  const sunColor = opts.sunColor ?? [1.0, 0.92, 0.75]; // warm sun
  const sunIntensity = opts.sunIntensity ?? 26.0; // disk radiance (key light)
  const skyIntensity = opts.skyIntensity ?? 1.0;
  const sunAngularDeg = opts.sunAngularDeg ?? 2.4; // disk radius (shadow softness)

  const sd = sunDir.clone().normalize();
  const cosSun = Math.cos((sunAngularDeg * Math.PI) / 180);

  const data = new Float32Array(W * H * 4);

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = (v - 0.5) * Math.PI; // -π/2 .. π/2
    const cl = Math.cos(lat);
    const sy = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const phi = (u - 0.5) * 2 * Math.PI;
      const dx = cl * Math.cos(phi);
      const dz = cl * Math.sin(phi);
      const dy = sy;

      let r, g, b;
      if (dy >= 0.0) {
        // sky hemisphere: horizon -> zenith gradient (curved so the horizon band
        // stays thin and the dome reads blue)
        const t = Math.pow(dy, 0.45);
        const c = lerp3(horizon, zenith, t);
        r = c[0] * skyIntensity;
        g = c[1] * skyIntensity;
        b = c[2] * skyIntensity;
      } else {
        // ground hemisphere: muted, slightly darkening downward
        const t = Math.min(1, -dy * 1.5);
        const c = lerp3(ground, [ground[0] * 0.6, ground[1] * 0.6, ground[2] * 0.6], t);
        r = c[0];
        g = c[1];
        b = c[2];
      }

      // sun: bright disk + warm glow halo
      const cd = dx * sd.x + dy * sd.y + dz * sd.z; // cos angle to sun
      if (cd > cosSun) {
        r += sunColor[0] * sunIntensity;
        g += sunColor[1] * sunIntensity;
        b += sunColor[2] * sunIntensity;
      } else if (cd > 0.0) {
        const glow = Math.pow(cd, 350.0) * 4.0 + Math.pow(cd, 8.0) * 0.25;
        r += sunColor[0] * glow;
        g += sunColor[1] * glow;
        b += sunColor[2] * glow;
      }

      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1.0;
    }
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
