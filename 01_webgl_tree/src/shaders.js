// All post-processing GLSL lives here as exported strings. Every pass is a
// full-screen triangle/quad sampling the previous stage's render target.

export const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ----------------------------------------------------------------------------
// PASS 1 - Outlines + edge highlights
//
// Standard depth/normal edge detection with a 4-tap (up/down/left/right)
// kernel so outlines come out a single texel thick. The depth texture drives
// object silhouettes; the normal texture drives interior creases. Convex edges
// (facing the light) get a warm highlight, concave edges stay as dark ink.
// ----------------------------------------------------------------------------
export const outlineFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 uTexel;        // 1 / render-target size
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  uniform int uEnabled;
  uniform vec3 uInk;
  uniform vec3 uHighlight;
  uniform vec3 uLightView;    // light direction in view space

  // ortho eye-space z (negative in front of camera); larger |z| = farther
  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return d * (uNear - uFar) - uNear;
  }

  vec3 normalAt(vec2 uv) {
    return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;

    if (uEnabled == 1) {
      float zC = viewZ(vUv);
      vec3 nC = normalAt(vUv);

      vec2 taps[4];
      taps[0] = vec2( uTexel.x, 0.0);
      taps[1] = vec2(-uTexel.x, 0.0);
      taps[2] = vec2(0.0,  uTexel.y);
      taps[3] = vec2(0.0, -uTexel.y);

      float depthEdge = 0.0;   // how much nearer we are than neighbours
      float normalEdge = 0.0;  // crease strength
      float convex = 0.0;      // neighbours bending away from us

      for (int i = 0; i < 4; i++) {
        vec2 uv = vUv + taps[i];
        float zN = viewZ(uv);
        vec3 nN = normalAt(uv);

        // neighbour farther than us -> we sit on the near side of a silhouette
        depthEdge = max(depthEdge, (zC - zN));
        float nd = 1.0 - dot(nC, nN);
        normalEdge = max(normalEdge, nd);

        // convexity heuristic: a normal discontinuity where the neighbour also
        // recedes in depth is an outward-facing (convex) edge.
        convex = max(convex, nd * smoothstep(0.0, 0.4, zC - zN));
      }

      // depthEdge is in world units; scale by distance so it is resolution and
      // depth independent-ish.
      float depthLine = smoothstep(0.06, 0.18, depthEdge);
      float normalLine = smoothstep(0.30, 0.70, normalEdge);
      float edge = clamp(max(depthLine, normalLine) * uStrength, 0.0, 1.0);

      // Dark ink on the outline.
      color = mix(color, uInk, edge * 0.8);

      // Warm highlight on convex edges, biased toward the ones facing the light.
      float faceLight = 0.45 + 0.55 * clamp(dot(normalize(nC), normalize(uLightView)), 0.0, 1.0);
      float hi = smoothstep(0.22, 0.7, convex) * faceLight;
      color = mix(color, uHighlight, hi * 0.8 * uStrength);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ----------------------------------------------------------------------------
// PASS 2 - Volumetric god rays (screen-space crepuscular scattering)
//
// The article raymarches the light-space depth map. Without a scriptable
// pipeline we approximate the same look in screen space: march from each pixel
// toward the sun's projected anchor, accumulating wherever the ray passes
// through sky (gaps in trees/hills), then add that as warm scattered light.
// A depth fade softens hard intersections with the world.
// ----------------------------------------------------------------------------
export const godrayFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uSunScreen;   // sun anchor in uv space
  uniform vec3 uRayColor;
  uniform float uStrength;
  uniform float uDensity;
  uniform float uDecay;
  uniform int uEnabled;

  const int SAMPLES = 48;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;

    if (uEnabled == 1) {
      vec2 dir = (uSunScreen - vUv) * uDensity / float(SAMPLES);
      // jittered start to break up banding into soft noise
      float jitter = hash(vUv * 1024.0);
      vec2 p = vUv + dir * jitter;
      float accum = 0.0;
      float w = 1.0;
      float wsum = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        p += dir;
        // sky (no geometry) reads as cleared depth ~1.0 -> light gets through;
        // anything the ray hits (tree, rocks) occludes -> shafts get shadowed
        float d = texture2D(tDepth, clamp(p, 0.0, 1.0)).x;
        float sky = step(0.999, d);
        accum += sky * w;
        wsum += w;
        w *= uDecay;
      }
      accum /= max(wsum, 0.001);

      // Break the smooth glow into distinct shafts: modulate by irregular bands
      // running perpendicular to the light direction (layered sines + a little
      // drift), so open sky still reads as god rays crossing the scene.
      vec2 toSun = normalize(uSunScreen - vUv);
      vec2 perp = vec2(-toSun.y, toSun.x);
      float s = dot(vUv, perp);
      float along = dot(vUv, toSun);
      float bands =
        0.5 + 0.5 * sin(s * 42.0 + along * 6.0)
            * (0.55 + 0.45 * sin(s * 15.0 - along * 3.0));
      bands = pow(clamp(bands, 0.0, 1.0), 1.4); // sharpen into shafts
      bands = mix(0.25, 1.0, bands);            // dim valleys, keep glow

      // shafts reach well across the frame, brightest near the sun
      float falloff = smoothstep(1.9, 0.05, distance(vUv, uSunScreen));
      color += uRayColor * accum * bands * uStrength * falloff;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ----------------------------------------------------------------------------
// PASS 3 - Final composite to screen
//
// * Sub-pixel shift: samples the low-res result offset by the camera's snap
//   error (in texels), so the pixelated image slides smoothly sub-block.
// * Overscan: the low-res target is a few texels larger than what we show, so
//   the shift never reveals the border.
// * 2D screen effects: animated rain streaks, film grain, vignette, and a
//   night-time colour grade -- the cheap 2D touches that "sell" the look.
// ----------------------------------------------------------------------------
export const compositeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform vec2 uRtSize;       // full render-target size (incl. overscan)
  uniform vec2 uDisplaySize;  // visible low-res size
  uniform float uOverscan;    // texels of padding per side
  uniform vec2 uSnapTexels;   // sub-pixel shift, in texels
  uniform float uTime;
  uniform float uRain;
  uniform float uGrain;
  uniform float uNight;
  uniform float uVignette;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // The scene is rendered into linear render targets; we encode to sRGB here on
  // the way to the canvas (three skips this for our custom full-screen passes).
  vec3 linearToSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // map visible screen uv into the overscanned low-res target (in texels)
  vec2 vuvToPx(vec2 uv) {
    return vec2(uOverscan, uOverscan) + uv * uDisplaySize;
  }

  // One layer of falling rain: thin, slightly wind-slanted streaks. Each screen
  // column carries short drops that fall and wrap, with per-column random speed,
  // phase and brightness, so it reads as natural rainfall rather than a static
  // grid of dashes.
  float rainLayer(vec2 uv, float cols, float speed, float slant, float density) {
    uv.x += uv.y * slant;                       // wind shear
    float x = uv.x * cols;
    float ci = floor(x);
    float cf = fract(x) - 0.5;
    float r = hash(vec2(ci, 17.0));
    if (r > density) return 0.0;                // gaps between active columns
    float r2 = hash(vec2(ci, 41.0));
    float line = smoothstep(0.10, 0.015, abs(cf));           // thin vertical line
    float spd = speed * (0.75 + 0.5 * r2);
    float pos = fract(uv.y * 2.4 + uTime * spd + r * 31.0);  // drops fall + wrap
    float streak = smoothstep(0.0, 0.03, pos) * smoothstep(0.22, 0.03, pos);
    return line * streak * (0.5 + 0.45 * r2);
  }

  void main() {
    vec2 px = vuvToPx(vUv);
    // shift the sampled image by +snap error to cancel the camera's texel snap,
    // restoring smooth sub-pixel motion
    vec2 sampleUv = (px + uSnapTexels) / uRtSize;
    vec3 color = texture2D(tColor, sampleUv).rgb;

    // overall paler / airier tone: lift toward soft off-white + slight desaturation
    color = mix(color, vec3(0.96, 0.97, 0.95), 0.18);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 0.86);

    // night grade: cool tint + a GENTLE darken. uNight is continuous (0..1) so it
    // fades smoothly through the cycle (1 = full night, 0 = day). Kept mild so the
    // bottom of the night reads as a moonlit blue, never a black-out.
    if (uNight > 0.001) {
      vec3 cool = color * vec3(0.66, 0.72, 0.96);
      color = mix(color, cool, 0.5 * clamp(uNight, 0.0, 1.0));
    }

    // overcast grade when raining: greyer, cooler, a touch dimmer (no sunshine)
    if (uRain > 0.5) {
      float lo = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(lo), 0.28);
      color *= vec3(0.88, 0.92, 0.98) * 0.95;
    }

    // rain: gentle, sparse, thin streaks (two faint depth layers) — an
    // atmospheric drizzle rather than a heavy downpour.
    if (uRain > 0.5) {
      float r = rainLayer(vUv, 58.0, 0.8, 0.13, 0.34);
      r += rainLayer(vUv + vec2(0.37, 0.0), 104.0, 1.05, 0.10, 0.26) * 0.5;
      color += vec3(0.72, 0.78, 0.86) * r * 0.22;
    }

    // film grain (kept subtle at night so it doesn't look like TV static)
    if (uGrain > 0.5) {
      float g = hash(vUv * uRtSize + fract(uTime) * 91.0) - 0.5;
      color += g * 0.045 * (uNight > 0.5 ? 0.55 : 1.0);
    }

    // vignette
    float v = distance(vUv, vec2(0.5));
    color *= 1.0 - smoothstep(0.6, 1.0, v) * uVignette;

    gl_FragColor = vec4(linearToSRGB(color), 1.0);
  }
`;
