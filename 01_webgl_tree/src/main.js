import * as THREE from "three";
import { settings, palette } from "./config.js";
import { PixelCamera } from "./camera.js";
import { Lighting } from "./lighting.js";
import { buildWorld } from "./scene/world.js";
import { DustParticles } from "./effects/particles.js";
import { Pipeline } from "./pipeline.js";
import { initUI, tickFps } from "./ui.js";
import { realtimeMode } from "./modes/realtime.js";
import { growthMode } from "../../02_tree_growth/src/growth.js";
import { growthMorphMode } from "../../02_tree_growth/src/growth_morph.js";
import { raytraceMode } from "../../03_ray_tracing/src/raytrace_mode.js";

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
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

// Shared context passed to every mode plugin (see CONTRIBUTING.md §5).
const ctx = {
  renderer,
  scene,
  camera: pixel,
  pixel,
  sun: lighting.sun,
  lighting,
  tree: world.tree,
  world,
  dust,
  pipeline,
  settings,
};

const modes = { realtime: realtimeMode, growth: growthMode, growthmorph: growthMorphMode, raytrace: raytraceMode };
let currentMode = realtimeMode;
currentMode.init(ctx);

initUI(onSettingChange, switchMode);
applyAllSettings();

window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(render);

function render() {
  const time = clock.getElapsedTime();
  currentMode.render(ctx, time);
  tickFps();
}

function switchMode(name) {
  const next = modes[name];
  if (!next || next === currentMode) return;
  currentMode.dispose(ctx);
  currentMode = next;
  resize();
  next.init(ctx);
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
  } else if (key === "rain") {
    lighting.setRain(settings.rain); // rain ⇒ overcast (no sun)
  }
  applyDynamicSettings();
}

function applyDynamicSettings() {
  pipeline.outline.uniforms.uEnabled.value = settings.outlines ? 1 : 0;
  pipeline.outline.uniforms.uStrength.value = settings.outlineStrength;
  // no sun shafts in the rain (overcast)
  pipeline.godray.uniforms.uEnabled.value = settings.godrays && !settings.rain ? 1 : 0;
  dust.points.visible = settings.dust;
  pipeline.composite.uniforms.uRain.value = settings.rain ? 1 : 0;
  pipeline.composite.uniforms.uGrain.value = settings.grain ? 1 : 0;
  pipeline.composite.uniforms.uNight.value = settings.night ? 1 : 0;
}

function applyAllSettings() {
  lighting.setNight(settings.night);
  lighting.setRain(settings.rain);
  applyDynamicSettings();
}
