import { settings } from "./config.js";

// Mobile "Pixel Bonsai" game HUD. The game controller (modes/game.js) drives
// the clock (day + time-of-day) and pushes it here via setDay() / reflectTime();
// this module owns presentation: toasts, journal, modals, manual slider scrub,
// the graphics settings, and the technical-demo mode switcher.
//
//   onChange(key)  — player changed a graphics flag / resolution / timeOfDay scrub
//   onAction(name) — Water / Fertilize / Bone Meal tap
//   onMode(name)   — picked a mode in Settings (game / realtime / growthmorph / ...)

const gameState = {
  day: 1,
  journal: [],
};

const $ = (sel) => document.querySelector(sel);

// cached time-slider elements (set in initTimeSlider, reused by reflectTime)
let knobEl = null;
let iconEls = [];
const STOPS = [0.0, 0.25, 0.5, 0.78];

export function initUI(onChange, onAction, onMode, onSpecies) {
  initTopButtons();
  initTimeSlider(onChange);
  initActions(onAction);
  initSettingsPanel(onChange);

  // demo shortcut in Settings: fast-forward the game to the full-grown tree
  $("#skip-day30")?.addEventListener("click", () => onAction?.("skipday30"));
  initModeButtons(onMode);
  initSpeciesButtons(onSpecies);
  initNotify();
  initSheetToggle();

  if (!gameState.journal.length) {
    gameState.journal.push({ day: gameState.day, icon: "🌱", text: "A seedling sprouts." });
  }
  renderJournal();
}

// ---- day counter (driven by the game clock) -------------------------------
export function setDay(day) {
  gameState.day = day;
  const el = $("#day-label");
  if (el) el.textContent = `Day ${day}`;
}

// ---- top-right book / settings buttons + modal plumbing -------------------
function openModal(id) {
  $("#" + id).hidden = false;
}
function closeModal(id) {
  $("#" + id).hidden = true;
}

function initTopButtons() {
  $("#btn-settings").addEventListener("click", () => openModal("settings-modal"));
  $("#btn-book").addEventListener("click", () => {
    renderJournal();
    openModal("book-modal");
  });
  document.querySelectorAll(".modal-close").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => {
      if (e.target === m) m.hidden = true;
    })
  );
}

// ---- collapse / expand the time slider + action sheet ---------------------
function initSheetToggle() {
  const cluster = $(".bottom-cluster");
  $("#sheet-handle").addEventListener("click", () => {
    cluster.classList.toggle("collapsed");
  });
}

// ---- day / night time slider ----------------------------------------------
function updateKnobUI(t) {
  if (knobEl) knobEl.style.left = `${t * 100}%`;
  let nearest = 0;
  STOPS.forEach((s, i) => {
    if (Math.abs(s - t) < Math.abs(STOPS[nearest] - t)) nearest = i;
  });
  iconEls.forEach((ic, i) => ic.classList.toggle("active", i === nearest));
}

// Called by the game clock each frame: move the knob to match the clock
// without firing onChange (no feedback loop).
export function reflectTime(t) {
  updateKnobUI(Math.max(0, Math.min(1, t)));
}

function initTimeSlider(onChange) {
  const track = $("#time-track");
  knobEl = $("#time-knob");
  iconEls = [...document.querySelectorAll(".t-icon")];

  function scrub(t) {
    t = Math.max(0, Math.min(1, t));
    settings.timeOfDay = t;
    updateKnobUI(t);
    onChange("timeOfDay");
  }

  const fromClientX = (clientX) => {
    const r = track.getBoundingClientRect();
    return (clientX - r.left) / r.width;
  };

  let dragging = false;
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    knobEl.setPointerCapture?.(e.pointerId);
    scrub(fromClientX(e.clientX));
  });
  window.addEventListener("pointermove", (e) => dragging && scrub(fromClientX(e.clientX)));
  window.addEventListener("pointerup", () => (dragging = false));

  iconEls.forEach((ic) =>
    ic.addEventListener("click", (e) => {
      e.stopPropagation();
      scrub(Number(ic.dataset.t));
    })
  );

  updateKnobUI(settings.timeOfDay ?? 0.0);
}

// ---- action sheet: Water / Fertilize / Bone Meal --------------------------
const ACTION_INFO = {
  water: { icon: "💧", text: "Watered the bonsai." },
  fertilize: { icon: "🌱", text: "Fertilized — a growth spurt!" },
  bonemeal: { icon: "🦴", text: "Bone meal feeds the roots." },
};

function initActions(onAction) {
  document.querySelectorAll(".action").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.action;
      btn.classList.remove("pulse");
      void btn.offsetWidth; // restart animation
      btn.classList.add("pulse");

      const info = ACTION_INFO[name];
      logEvent(info.icon, info.text);
      showNotify(info.icon, info.text);
      onAction?.(name);
    });
  });
}

// ---- journal + notification pill ------------------------------------------
function logEvent(icon, text) {
  gameState.journal.unshift({ day: gameState.day, icon, text });
  if (gameState.journal.length > 40) gameState.journal.pop();
}

// Fired by game systems (e.g. weather) to log + flash a notification.
export function notifyEvent(icon, text) {
  logEvent(icon, text);
  showNotify(icon, text);
}

let notifyTimer = null;
function initNotify() {
  $("#notify").addEventListener("click", () => {
    renderJournal();
    openModal("book-modal");
  });
}

function showNotify(icon, text) {
  const pill = $("#notify");
  $("#notify-icon").textContent = icon;
  $("#notify-text").textContent = text;
  pill.classList.remove("hidden");
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => pill.classList.add("hidden"), 3200);
}

function renderJournal() {
  const ul = $("#journal");
  ul.innerHTML = "";
  if (!gameState.journal.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing has happened yet.";
    ul.appendChild(li);
    return;
  }
  for (const e of gameState.journal) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="j-day">Day ${e.day}</span>${e.icon} ${e.text}`;
    ul.appendChild(li);
  }
}

// ---- settings modal: graphics dev controls --------------------------------
function initSettingsPanel(onChange) {
  document.querySelectorAll(".opt[data-flag]").forEach((btn) => {
    const flag = btn.dataset.flag;
    btn.classList.toggle("active", !!settings[flag]);
    btn.addEventListener("click", () => {
      settings[flag] = !settings[flag];
      btn.classList.toggle("active", settings[flag]);
      onChange(flag);
    });
  });

  const res = $("#resolution");
  const resValue = $("#resolution-value");
  res.value = String(settings.verticalResolution);
  resValue.textContent = `${settings.verticalResolution} px`;
  res.addEventListener("input", () => {
    settings.verticalResolution = Number(res.value);
    resValue.textContent = `${settings.verticalResolution} px`;
    onChange("verticalResolution");
  });

  const os = $("#outline-strength");
  const osValue = $("#outline-strength-value");
  os.value = String(settings.outlineStrength);
  osValue.textContent = settings.outlineStrength.toFixed(2);
  os.addEventListener("input", () => {
    settings.outlineStrength = Number(os.value);
    osValue.textContent = settings.outlineStrength.toFixed(2);
    onChange("outlineStrength");
  });
}

// ---- technical-demo mode switcher (inside Settings) -----------------------
function initModeButtons(onMode) {
  const btns = [...document.querySelectorAll(".mode-opt")];
  btns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === "game");
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      onMode?.(btn.dataset.mode);
    });
  });
}

// ---- tree species selector (inside Settings) ------------------------------
function initSpeciesButtons(onSpecies) {
  const btns = [...document.querySelectorAll(".species-opt")];
  btns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.species === settings.species);
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      settings.species = btn.dataset.species;
      onSpecies?.(btn.dataset.species);
    });
  });
}

// ---- fps readout (shown in the settings panel) ----------------------------
let frames = 0;
let last = performance.now();

export function tickFps() {
  frames++;
  const now = performance.now();
  if (now - last >= 500) {
    const fps = Math.round((frames * 1000) / (now - last));
    const el = $("#fps");
    if (el) el.textContent = `${fps} fps`;
    frames = 0;
    last = now;
  }
}
