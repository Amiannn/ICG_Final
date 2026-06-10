import * as THREE from "three";
import { settings, palette } from "./config.js";
import { PixelCamera } from "./camera.js";
import { Lighting } from "./lighting.js";
import { buildWorld } from "./scene/world.js";
import { DustParticles } from "./effects/particles.js";
import { makeRainSound } from "./effects/rainsound.js";
import { makeAmbientMusic } from "./effects/ambient.js";
import { makeWatering } from "./effects/watering.js";
import { makeRainSplash } from "./effects/rainsplash.js";
import { Pipeline } from "./pipeline.js";
import { initUI, tickFps } from "./ui.js";
import { realtimeMode } from "./modes/realtime.js";
import { gameMode } from "./modes/game.js";
import { growthMode } from "../../02_tree_growth/src/growth.js";
import { growthMorphMode } from "../../02_tree_growth/src/growth_morph.js";
// Ray tracing has been retired to ../../legacy/03_ray_tracing for this version.

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.skyDay);
scene.fog = new THREE.Fog(palette.fogDay, 32, 72);

const pixel = new PixelCamera();
const lighting = new Lighting(scene);
const world = buildWorld(scene);
const dust = new DustParticles();
scene.add(dust.points);
const pipeline = new Pipeline(renderer, pixel);
const rainSound = makeRainSound();
const music = makeAmbientMusic();
const rainSplash = makeRainSplash();
scene.add(rainSplash.mesh);
const watering = makeWatering();
scene.add(watering.group); // droplets + local ground ripples

// Audio can only start after a user gesture (browser autoplay policy), so kick
// the ambient music off on the first interaction if it's enabled.
function startAudioOnce() {
  if (settings.music) music.set(true);
  window.removeEventListener("pointerdown", startAudioOnce);
  window.removeEventListener("keydown", startAudioOnce);
}
window.addEventListener("pointerdown", startAudioOnce);
window.addEventListener("keydown", startAudioOnce);

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
  rainSplash,
  rainSound,
  watering,
  pipeline,
  settings,
  tod: null, // game mode drives this; null = use each mode's own time-of-day
};

// One place to switch rain on/off with all its effects (lighting overcast,
// ambience, pond ripples, ground splash, screen streaks). Game weather + the
// Rain toggle both go through here.
ctx.setRain = (on) => {
  settings.rain = on;
  lighting.setRain(on);
  rainSound.set(on);
  applyDynamicSettings();
};

const modes = { game: gameMode, realtime: realtimeMode, growth: growthMode, growthmorph: growthMorphMode };
let currentMode = gameMode;
currentMode.init(ctx);

initUI(onSettingChange, onAction, switchMode, onSpecies);
applyAllSettings();

// Dev hook: `?mode=growthmorph` (or realtime/growth) jumps straight into that
// mode on load — handy for headless-screenshot scripts and quick deep links.
const _qMode = new URLSearchParams(location.search).get("mode");
if (_qMode && modes[_qMode] && modes[_qMode] !== currentMode) switchMode(_qMode);
window.__mode = switchMode;

// debug/scrub hook: freeze the cycle and set a specific time-of-day (0..1)
window.__tod = (t) => {
  settings.cycle = false;
  lighting.setTimeOfDay(t);
  pipeline.composite.uniforms.uNight.value = 1 - lighting.dayness;
};

window.addEventListener("resize", resize);
// also re-fit whenever the canvas box itself changes (mobile URL bar, CSS, …)
new ResizeObserver(resize).observe(canvas);
resize();

// Horizontal mouse-drag yaw. Click + drag left/right on the canvas to orbit
// the camera around the cedar; vertical motion is intentionally ignored.
canvas.style.cursor = "grab";
let dragging = false;
let lastX = 0;
const YAW_SENSITIVITY = 0.005; // rad per pixel of horizontal motion
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  pixel.setYaw(pixel.yaw - dx * YAW_SENSITIVITY);
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
  canvas.style.cursor = "grab";
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", endDrag);

// Mouse-wheel zoom. The camera is orthographic, so zooming = scaling the
// visible world height; resize() re-derives the frustum + render targets.
const ZOOM_MIN = 14, ZOOM_MAX = 46;
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012); // smooth exponential zoom
    pixel.viewHeight = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pixel.viewHeight * factor));
    resize();
  },
  { passive: false },
);

const clock = new THREE.Clock();
renderer.setAnimationLoop(render);

// Slow, ambient auto-orbit around the tree (paused while the user is dragging;
// dragging just re-anchors it, so it carries on from wherever you let go).
const AUTO_ORBIT_RATE = 0.022; // rad/s ≈ one lap every ~4.8 minutes
let prevTime = 0;

function render() {
  const time = clock.getElapsedTime();
  const dt = Math.min(0.1, Math.max(0, time - prevTime));
  prevTime = time;

  if (settings.motion && !dragging) pixel.setYaw(pixel.yaw + AUTO_ORBIT_RATE * dt);

  currentMode.render(ctx, time);
  watering.setTime(time); // animate the Water-action sprinkle burst
  music.setDayness(lighting.dayness); // daytime track: full by day, fades at night
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
  // size to the phone stage (the canvas box), not the whole window
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);

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
  } else if (key === "timeOfDay") {
    if (currentMode.scrubTime) currentMode.scrubTime(settings.timeOfDay); // game slider
  } else if (key === "music") {
    music.set(settings.music);
    return;
  } else if (key === "night") {
    if (!settings.cycle) lighting.setNight(settings.night); // cycle overrides the static toggle
  } else if (key === "rain") {
    ctx.setRain(settings.rain);
    return; // setRain already calls applyDynamicSettings
  } else if (key === "cycle") {
    if (!settings.cycle) lighting.setNight(settings.night); // turning the cycle off restores static day/night
  }
  applyDynamicSettings();
}

// Water / Fertilize / Bone Meal taps from the HUD → the active mode.
function onAction(name) {
  if (currentMode.action) currentMode.action(name);
}

// Tree species picked in Settings → the active mode (game).
function onSpecies(name) {
  if (currentMode.setSpecies) currentMode.setSpecies(name);
}

function applyDynamicSettings() {
  pipeline.outline.uniforms.uEnabled.value = settings.outlines ? 1 : 0;
  pipeline.outline.uniforms.uStrength.value = settings.outlineStrength;
  // no sun shafts in the rain (overcast)
  pipeline.godray.uniforms.uEnabled.value = settings.godrays && !settings.rain ? 1 : 0;
  // rain mutes the dust automatically — motes would read as static in a downpour
  dust.points.visible = settings.dust && !settings.rain;
  // rain impact: pond ripples + splash rings on the ground
  world.water.material.uniforms.uRain.value = settings.rain ? 1 : 0;
  rainSplash.setRain(settings.rain);
  pipeline.composite.uniforms.uRain.value = settings.rain ? 1 : 0;
  pipeline.composite.uniforms.uGrain.value = settings.grain ? 1 : 0;
  pipeline.composite.uniforms.uNight.value = settings.night ? 1 : 0;
}

function applyAllSettings() {
  lighting.setNight(settings.night);
  lighting.setRain(settings.rain);
  applyDynamicSettings();
}
