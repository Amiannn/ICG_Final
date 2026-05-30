import { settings } from "./config.js";

// Wires the control panel to the settings object. `onChange(key)` is called
// whenever a flag/slider changes so the main loop can react (e.g. resize on
// resolution change, swap day/night). `onModeChange(name)` is called when the
// user clicks a top-level mode button (Real-time / Growth / Path Trace).
export function initUI(onChange, onModeChange) {
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.mode;
      document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b === btn));
      onModeChange?.(name);
    });
  });

  document.querySelectorAll(".toggle").forEach((btn) => {
    const flag = btn.dataset.flag;
    btn.classList.toggle("active", !!settings[flag]);
    btn.addEventListener("click", () => {
      settings[flag] = !settings[flag];
      btn.classList.toggle("active", settings[flag]);
      onChange(flag);
    });
  });

  const res = document.querySelector("#resolution");
  const resValue = document.querySelector("#resolution-value");
  res.value = String(settings.verticalResolution);
  resValue.textContent = `${settings.verticalResolution} px`;
  res.addEventListener("input", () => {
    settings.verticalResolution = Number(res.value);
    resValue.textContent = `${settings.verticalResolution} px`;
    onChange("verticalResolution");
  });

  const os = document.querySelector("#outline-strength");
  const osValue = document.querySelector("#outline-strength-value");
  os.value = String(settings.outlineStrength);
  osValue.textContent = settings.outlineStrength.toFixed(2);
  os.addEventListener("input", () => {
    settings.outlineStrength = Number(os.value);
    osValue.textContent = settings.outlineStrength.toFixed(2);
    onChange("outlineStrength");
  });

  // collapse / show panel
  const ui = document.querySelector("#ui");
  const show = document.querySelector("#ui-show");
  document.querySelector("#toggle-ui-collapse").addEventListener("click", () => {
    ui.style.display = "none";
    show.hidden = false;
  });
  show.addEventListener("click", () => {
    ui.style.display = "";
    show.hidden = true;
  });
}

let frames = 0;
let last = performance.now();
const fpsEl = document.querySelector("#fps");

export function tickFps() {
  frames++;
  const now = performance.now();
  if (now - last >= 500) {
    const fps = Math.round((frames * 1000) / (now - last));
    if (fpsEl) fpsEl.textContent = `${fps} fps`;
    frames = 0;
    last = now;
  }
}
