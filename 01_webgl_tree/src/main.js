import * as THREE from "three";
import { settings, palette } from "./config.js";
import { cloudUniforms } from "./materials.js";
import { PixelCamera } from "./camera.js";
import { Lighting } from "./lighting.js";
import { buildWorld } from "./scene/world.js";
import { DustParticles } from "./effects/particles.js";
import { Pipeline } from "./pipeline.js";
import { initUI, tickFps } from "./ui.js";

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.skyDay);
scene.fog = new THREE.Fog(palette.fogDay, 22, 46);

const pixel = new PixelCamera();
const lighting = new Lighting(scene);
const world = buildWorld(scene);
const dust = new DustParticles();
scene.add(dust.points);
const pipeline = new Pipeline(renderer, pixel);

initUI(onSettingChange);
applyAllSettings();

window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(render);

function render() {
  const time = clock.getElapsedTime();

  if (settings.motion) pixel.drift(time);
  pixel.snapEnabled = settings.snap;
  pixel.resolutionY = settings.verticalResolution;
  pixel.update();

  // scrolling cloud shadows
  cloudUniforms.uCloudTime.value = time * 0.015;
  cloudUniforms.uCloudStrength.value = settings.clouds ? 1 : 0;

  // sun aims at scene centre regardless of camera drift
  lighting.sun.target.position.set(0, 0, 0);
  lighting.sun.target.updateMatrixWorld();

  world.water.setTime(time);
  world.water.material.uniforms.uReflectEnabled.value = settings.water ? 1 : 0;
  dust.setTime(time);

  pipeline.render(scene, lighting.sun, time, (r, cam) => {
    world.water.updateReflection(r, cam, scene);
  });

  tickFps();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, true);

  const aspect = w / h;
  const displayH = settings.verticalResolution;
  const displayW = Math.max(1, Math.round(displayH * aspect));

  pixel.resolutionY = displayH;
  pixel.setAspect(aspect);
  pipeline.setSize(displayW, displayH, aspect);

  // reflection target matches the overscanned render-target resolution
  world.water.setReflectionSize(displayW + 4, displayH + 4);
}

function onSettingChange(key) {
  if (key === "verticalResolution") {
    resize();
  } else if (key === "night") {
    lighting.setNight(settings.night);
  }
  applyDynamicSettings();
}

function applyDynamicSettings() {
  pipeline.outline.uniforms.uEnabled.value = settings.outlines ? 1 : 0;
  pipeline.outline.uniforms.uStrength.value = settings.outlineStrength;
  pipeline.godray.uniforms.uEnabled.value = settings.godrays ? 1 : 0;
  dust.points.visible = settings.dust;
  pipeline.composite.uniforms.uRain.value = settings.rain ? 1 : 0;
  pipeline.composite.uniforms.uGrain.value = settings.grain ? 1 : 0;
  pipeline.composite.uniforms.uNight.value = settings.night ? 1 : 0;
}

function applyAllSettings() {
  lighting.setNight(settings.night);
  applyDynamicSettings();
}
