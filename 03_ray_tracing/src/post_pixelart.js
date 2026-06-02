import * as THREE from "three";

// 03 · M3 — pixel-art post chain for the path-traced view.
//
// The real-time view gets its look from per-material cel ramps + a depth/normal
// outline pass + a low-res nearest upscale (01/src/pipeline.js + shaders.js).
// The path tracer can't reuse any of that (B2: materials are swapped to flat
// MeshStandardMaterial), so we re-create the same stylisation as a *post-process*
// on the traced output:
//
//   PT linear target ─► cel-quantise + depth/normal outline ─► low-res RT ─► upscale to canvas
//
// The cel + outline + low-res downsample land the frame in the same pixel-art
// register as the real-time view, but the shading underneath carries the path
// tracer's soft shadows, ambient occlusion and GI colour bleed.

const CEL_BANDS = 5; // luminance bands; ~matches the 4-stop toon ramp + a highlight
// Lifted shadow floor (mirrors the real-time toon ramp, whose darkest stop is a
// light grey-green #8a9c80, not black). Without it the lowest band rounds to 0
// and dim, env-only surfaces (the tree's camera-facing side) crush to pure
// black instead of reading as dark green/brown.
const CEL_SHADOW_FLOOR = 0.22;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// PASS 1 — tonemap + cel-quantise the traced colour, then ink depth/normal edges.
const EDGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;   // path tracer target (linear HDR radiance)
  uniform sampler2D tDepth;   // perspective-camera depth prepass
  uniform sampler2D tNormal;  // view-space normal prepass
  uniform vec2 uTexel;        // 1 / low-res target size
  uniform float uNear;
  uniform float uFar;
  uniform float uOutline;     // outline strength (0 = skip the edge work)
  uniform float uBands;
  uniform float uShadowFloor; // darkest cel band (toon shadow colour, never 0)
  uniform vec3 uInk;

  // Narkowicz 2015 ACES filmic approximation: linear HDR -> display [0,1].
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  // perspective depth (NDC) -> positive view-space distance
  float linZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - d * (uFar - uNear));
  }

  vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

  void main() {
    vec3 col = aces(texture2D(tColor, vUv).rgb);

    // Cel ramp: quantise luminance into discrete bands, preserve hue. This is
    // the post-process stand-in for the real-time MeshToonMaterial gradient.
    // Floor the darkest band so dim surfaces read as a dark tint of their own
    // hue (toon shadow) rather than rounding to pure black.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    float q = max(floor(l * uBands + 0.5) / uBands, uShadowFloor);
    col *= q / max(l, 1e-4);

    if (uOutline > 0.001) {
      float zC = linZ(vUv);
      vec3 nC = nrm(vUv);

      vec2 taps[4];
      taps[0] = vec2( uTexel.x, 0.0);
      taps[1] = vec2(-uTexel.x, 0.0);
      taps[2] = vec2(0.0,  uTexel.y);
      taps[3] = vec2(0.0, -uTexel.y);

      float depthEdge = 0.0;
      float normalEdge = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 uv = vUv + taps[i];
        depthEdge = max(depthEdge, linZ(uv) - zC);          // neighbour farther -> silhouette
        normalEdge = max(normalEdge, 1.0 - dot(nC, nrm(uv))); // crease
      }

      // depth edge normalised by distance so the threshold is depth-independent
      float depthLine = smoothstep(0.03, 0.12, depthEdge / max(zC, 1.0));
      float normalLine = smoothstep(0.30, 0.70, normalEdge);
      float edge = clamp(max(depthLine, normalLine) * uOutline, 0.0, 1.0);
      col = mix(col, uInk, edge * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// PASS 2 — final grade to canvas: the same airy lift / desaturation / grain /
// vignette / sRGB encode the real-time composite uses, so both views match.
const COMP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform vec2 uRtSize;
  uniform float uTime;
  uniform float uGrain;
  uniform float uVignette;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;

    // paler / airier tone + slight desaturation (mirrors 01 compositeFragment).
    // Lighter touch than the real-time grade: the path-traced canopy albedo is
    // already softer than the saturated toon greens, so over-washing here left
    // it looking grey-green. Pull both terms back so the green stays lively.
    color = mix(color, vec3(0.95, 0.97, 0.94), 0.07);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 0.94);

    if (uGrain > 0.5) {
      float g = hash(vUv * uRtSize + fract(uTime) * 91.0) - 0.5;
      color += g * 0.045;
    }

    float v = distance(vUv, vec2(0.5));
    color *= 1.0 - smoothstep(0.6, 1.0, v) * uVignette;

    gl_FragColor = vec4(toSRGB(color), 1.0);
  }
`;

// PHOTOREAL — report hero-shot path. Bypass the whole pixel-art register
// (cel bands, outline ink, low-res nearest upscale, airy desaturation wash) and
// show the path tracer's raw radiance at full resolution: just ACES filmic
// tonemap + sRGB encode. This is the "what does the GI actually look like"
// reference image for the report's three-way comparison (PLAN item 9).
const PHOTOREAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    gl_FragColor = vec4(toSRGB(aces(texture2D(tColor, vUv).rgb)), 1.0);
  }
`;

function lowResRT(w, h, withDepth) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  if (withDepth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

export class PixelArtPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = new THREE.Vector2(1, 1);

    this.normalRT = lowResRT(4, 4, true);
    this.edgeRT = lowResRT(4, 4, false);

    this.normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

    this.edge = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: EDGE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: this.normalRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 },
        uFar: { value: 200 },
        uOutline: { value: 0 },
        uBands: { value: CEL_BANDS },
        uShadowFloor: { value: CEL_SHADOW_FLOOR },
        uInk: { value: new THREE.Color(0x222a26) },
      },
    });

    this.comp = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMP_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.edgeRT.texture },
        uRtSize: { value: this.size },
        uTime: { value: 0 },
        uGrain: { value: 1 },
        uVignette: { value: 0.6 },
      },
    });

    this.photoreal = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PHOTOREAL_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { tColor: { value: null } },
    });

    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edge);
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    this.normalRT.setSize(w, h);
    this.edgeRT.setSize(w, h);
    this.edge.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  // View-space normals + depth of the (standard-material) scene at low res, so
  // the outline pass has silhouette + crease info. Mirrors Pipeline._renderNormals.
  _renderNormals(scene, cam) {
    const hidden = [];
    scene.traverse((o) => {
      if (o.userData.skipNormal && o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;

    this.renderer.setRenderTarget(this.normalRT);
    this.renderer.setClearColor(0x8080ff, 1); // view normal (0,0,1)
    this.renderer.clear();
    this.renderer.render(scene, cam);

    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    hidden.forEach((o) => (o.visible = true));
  }

  // colorTex: path tracer target texture. outline: effective strength (0 skips).
  render({ colorTex, scene, camera, outline, grain, time }) {
    const r = this.renderer;
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();

    this.edge.uniforms.tColor.value = colorTex;
    this.edge.uniforms.uOutline.value = outline;
    this.edge.uniforms.uNear.value = camera.near;
    this.edge.uniforms.uFar.value = camera.far;
    this.comp.uniforms.uGrain.value = grain ? 1 : 0;
    this.comp.uniforms.uTime.value = time;

    if (outline > 0.001) this._renderNormals(scene, camera);

    // 1. cel + outline into the low-res target (this is the pixelation step)
    this._blit(this.edge, this.edgeRT);

    // 2. grade + nearest-upscale to the canvas
    this.quad.material = this.comp;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.quadScene, this.quadCamera);

    r.setClearColor(prevClear, prevAlpha);
  }

  // Photoreal hero-shot path: blit the traced radiance straight to the canvas
  // at full resolution through ACES + sRGB only (no cel/outline/pixelation).
  renderPhotoreal(colorTex) {
    const r = this.renderer;
    this.photoreal.uniforms.tColor.value = colorTex;
    this.quad.material = this.photoreal;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.normalRT.depthTexture?.dispose?.();
    this.normalRT.dispose();
    this.edgeRT.dispose();
    this.normalMat.dispose();
    this.edge.dispose();
    this.comp.dispose();
    this.photoreal.dispose();
    this.quad.geometry.dispose();
  }
}
