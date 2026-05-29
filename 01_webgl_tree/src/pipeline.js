import * as THREE from "three";
import {
  fullscreenVertex,
  outlineFragment,
  godrayFragment,
  compositeFragment,
} from "./shaders.js";
import { palette } from "./config.js";

// Extra texels rendered beyond the visible frame so the sub-pixel camera shift
// in the composite pass never samples past the edge.
const OVERSCAN = 2;

function makeRT(w, h, withDepth) {
  const opts = {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  };
  const rt = new THREE.WebGLRenderTarget(w, h, opts);
  if (withDepth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

export class Pipeline {
  constructor(renderer, pixelCamera) {
    this.renderer = renderer;
    this.pixel = pixelCamera;

    this.displaySize = new THREE.Vector2(480, 270);
    this.rtSize = new THREE.Vector2(484, 274);

    this.normalRT = makeRT(4, 4, false);
    this.colorRT = makeRT(4, 4, true);
    this.rtA = makeRT(4, 4, false);
    this.rtB = makeRT(4, 4, false);

    this.normalMaterial = new THREE.MeshNormalMaterial();

    this.outline = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: outlineFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tDepth: { value: this.colorRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uStrength: { value: 1 },
        uEnabled: { value: 1 },
        uInk: { value: new THREE.Color(palette.ink) },
        uHighlight: { value: new THREE.Color(palette.edgeHighlight) },
        uLightView: { value: new THREE.Vector3(0, 0, 1) },
      },
    });

    this.godray = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: godrayFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.rtA.texture },
        tDepth: { value: this.colorRT.depthTexture },
        uSunScreen: { value: new THREE.Vector2(0.7, 0.85) },
        uRayColor: { value: new THREE.Color(0xfff4cf) },
        uStrength: { value: 3.6 },
        uDensity: { value: 1.05 },
        uDecay: { value: 0.99 },
        uEnabled: { value: 1 },
      },
    });

    this.composite = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.rtB.texture },
        uRtSize: { value: this.rtSize },
        uDisplaySize: { value: this.displaySize },
        uOverscan: { value: OVERSCAN },
        uSnapTexels: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uRain: { value: 0 },
        uGrain: { value: 1 },
        uNight: { value: 0 },
        uVignette: { value: 0.6 },
      },
    });

    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.outline);
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(displayW, displayH, aspect) {
    this.displaySize.set(displayW, displayH);
    const rtW = displayW + OVERSCAN * 2;
    const rtH = displayH + OVERSCAN * 2;
    this.rtSize.set(rtW, rtH);

    this.normalRT.setSize(rtW, rtH);
    this.colorRT.setSize(rtW, rtH);
    this.rtA.setSize(rtW, rtH);
    this.rtB.setSize(rtW, rtH);

    this.outline.uniforms.uTexel.value.set(1 / rtW, 1 / rtH);

    // Expand the camera frustum by the overscan so the padding shows real
    // scene, keeping texels square.
    const cam = this.pixel.camera;
    const texel = this.pixel.viewHeight / displayH;
    const halfH = this.pixel.viewHeight * 0.5 + OVERSCAN * texel;
    const halfW = (this.pixel.viewHeight * 0.5) * aspect + OVERSCAN * texel;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();

    this.outline.uniforms.uNear.value = cam.near;
    this.outline.uniforms.uFar.value = cam.far;
  }

  // Render the scene's normals into normalRT. Billboards / water flag themselves
  // with userData.skipNormal so the normal pass ignores their alpha-cut quads;
  // their silhouettes still come through via depth.
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
    scene.overrideMaterial = this.normalMaterial;

    this.renderer.setRenderTarget(this.normalRT);
    this.renderer.setClearColor(0x8080ff, 1); // encodes view normal (0,0,1)
    this.renderer.clear();
    this.renderer.render(scene, cam);

    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    hidden.forEach((o) => (o.visible = true));
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene, sun, time, preRender) {
    const cam = this.pixel.camera;
    const r = this.renderer;

    // Optional pre-pass (e.g. water planar reflection) before we read the scene.
    if (preRender) preRender(r, cam);

    // 1. view-space normals
    this._renderNormals(scene, cam);

    // 2. lit colour + depth
    r.setRenderTarget(this.colorRT);
    r.setClearColor(scene.background ? scene.background : 0x000000, 1);
    r.clear();
    r.render(scene, cam);

    // light direction in view space, for the convex-edge highlight
    this.outline.uniforms.uLightView.value
      .copy(sun.position)
      .normalize()
      .transformDirection(cam.matrixWorldInverse);

    // sun screen anchor for god rays
    const anchor = sun.position.clone().normalize().multiplyScalar(60).add(this.pixel.desiredTarget);
    anchor.project(cam);
    this.godray.uniforms.uSunScreen.value.set(anchor.x * 0.5 + 0.5, anchor.y * 0.5 + 0.5);

    // 3. outlines -> rtA
    this._blit(this.outline, this.rtA);

    // 4. god rays -> rtB
    this._blit(this.godray, this.rtB);

    // 5. composite -> screen
    this.composite.uniforms.uSnapTexels.value.copy(this.pixel.snapError);
    this.composite.uniforms.uTime.value = time;
    this.quad.material = this.composite;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.quadScene, this.quadCamera);
  }
}
