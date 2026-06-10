import { realtimeMode } from "./realtime.js";
import { makeMorphTree } from "../../../02_tree_growth/src/morph_tree.js";
import { makeCedarGrowth } from "../../../02_tree_growth/src/cedar_growth.js";
import { game } from "../config.js";
import { setDay, reflectTime, notifyEvent } from "../ui.js";

// Game mode — the "Pixel Bonsai" experience.
//
// Wraps the real-time cel pipeline and layers a game clock on top:
//   • day counter advances on its own (game.dayLengthSeconds per day),
//   • the chosen tree species grows from sprout (Day 1) to full (Day growthDays),
//   • the sun sweeps a full day-night cycle (drives ctx.tod → lighting),
//   • random weather brings showers (ripples + splash + sound),
//   • Water / Fertilize / Bone Meal nudge growth + trigger feedback.
//
// Tree species (player-selectable, settings.species):
//   • "cedar" — the real billboard cedar, grown procedurally (cedar_growth.js)
//   • "morph" — a morph-target sprout→cone (morph_tree.js), textbook CG morphing

const rand = (a, b) => a + Math.random() * (b - a);

export const gameMode = {
  name: "game",
  label: "Game",

  // build a { setGrowth, dispose } grower for the requested species
  _buildTree(ctx, species) {
    if (species === "morph") {
      if (ctx.tree) ctx.tree.visible = false;
      const morph = makeMorphTree();
      morph.group.position.copy(ctx.tree ? ctx.tree.position : { x: 2.6, y: 0, z: 1.2 });
      ctx.scene.add(morph.group);
      return {
        setGrowth: (g) => morph.setGrowth(g),
        dispose: () => {
          ctx.scene.remove(morph.group);
          morph.dispose();
          if (ctx.tree) ctx.tree.visible = true;
        },
      };
    }
    // default: the real cedar, grown in place
    if (ctx.tree) ctx.tree.visible = true;
    const cedar = makeCedarGrowth(ctx.tree, ctx.scene);
    return { setGrowth: (g) => cedar.setGrowth(g), dispose: () => cedar.dispose() };
  },

  // ---- lifecycle ---------------------------------------------------------
  init(ctx) {
    realtimeMode.init(ctx);
    this.ctx = ctx;

    // game drives the sun itself (don't also run realtime's 30s auto-cycle)
    ctx.settings.cycle = false;

    this.species = ctx.settings.species || "cedar";
    this.grower = this._buildTree(ctx, this.species);

    // clock: dayFloat is total elapsed in-game days (fractional). Start a
    // little into the morning so the game opens in bright daylight.
    this.dayFloat = 0.2;
    this.lastDayInt = 0;
    this.lastTime = null;

    // weather: alternating dry spells / showers
    this.raining = false;
    this.weatherTimer = rand(game.rainMinGapSeconds, game.rainMaxGapSeconds);
    this.lastRain = null;

    // toast + journal whenever a wild visitor strolls in
    const VISIT = {
      cow: ["🐄", "A cow wandered over!"],
      sheep: ["🐑", "A little sheep visited!"],
      dog: ["🐶", "A dog trotted by!"],
    };
    if (ctx.world.animals) {
      ctx.world.animals.onVisit = (type) => {
        const [icon, text] = VISIT[type] || ["🐾", "A visitor arrived!"];
        notifyEvent(icon, text);
      };
    }

    setDay(game.startDay);
    this._apply(ctx);
  },

  // swap the tree species at runtime (from the UI)
  setSpecies(name) {
    if (name === this.species || !this.ctx) return;
    this.ctx.settings.species = name;
    this.grower.dispose();
    this.species = name;
    this.grower = this._buildTree(this.ctx, name);
    this._apply(this.ctx);
  },

  // ---- per-frame ---------------------------------------------------------
  render(ctx, time) {
    const dt = this.lastTime == null ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;

    this.dayFloat += dt / game.dayLengthSeconds;

    const dayInt = Math.floor(this.dayFloat);
    if (dayInt > this.lastDayInt) {
      this.lastDayInt = dayInt;
      setDay(game.startDay + dayInt);
    }

    this._weather(ctx, dt);
    this._apply(ctx);

    reflectTime(this.dayFloat - Math.floor(this.dayFloat));
    realtimeMode.render(ctx, time);
  },

  // push the current clock state onto the world (sun, growth, ecosystem)
  _apply(ctx) {
    const s = this.dayFloat - Math.floor(this.dayFloat); // 0..1 within the day
    ctx.tod = (0.25 + s) % 1; // slider s (sunrise→…→night) → lighting tod (dawn≈0.25)

    const dayIndex = game.startDay - 1 + this.dayFloat;
    const growth = Math.min(1, Math.max(0, dayIndex / (game.growthDays - 1)));
    if (this.grower) this.grower.setGrowth(growth);
    ctx.growthReveal = growth; // wildlife still walk/fly in as the tree grows
    ctx.groundReveal = 1; // grass + flowers stay full-grown from day 1
  },

  _weather(ctx, dt) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.raining = !this.raining;
      this.weatherTimer = this.raining
        ? rand(game.rainMinSeconds, game.rainMaxSeconds)
        : rand(game.rainMinGapSeconds, game.rainMaxGapSeconds);
      if (this.raining) notifyEvent("🌧️", "It started raining.");
    }
    if (this.raining !== this.lastRain) {
      ctx.setRain?.(this.raining);
      this.lastRain = this.raining;
    }
  },

  // ---- player input (forwarded from the UI by main.js) -------------------
  scrubTime(s) {
    this.dayFloat = Math.floor(this.dayFloat) + Math.max(0, Math.min(0.999, s));
  },

  action(name) {
    if (name === "water") {
      // sprinkle the tree as it currently stands (height/spread follow growth)
      const dayIndex = game.startDay - 1 + this.dayFloat;
      const g = Math.min(1, Math.max(0, dayIndex / (game.growthDays - 1)));
      const top = 3.5 + 17 * g;
      const radius = 1.6 + 3.2 * g;
      this.ctx.watering?.trigger(this.ctx.tree?.position, top, radius);
      this.dayFloat += 1; // a drink = one day's growth
    } else if (name === "fertilize") this.dayFloat += 1;
    else if (name === "bonemeal") this.dayFloat += 2;
  },

  // ---- teardown ----------------------------------------------------------
  dispose(ctx) {
    if (this.grower) {
      this.grower.dispose();
      this.grower = null;
    }
    if (ctx.world.animals) ctx.world.animals.onVisit = null;
    if (this.lastRain) ctx.setRain?.(false);
    ctx.tod = null;
    ctx.growthReveal = null;
    ctx.groundReveal = null;
    this.ctx = null;
    realtimeMode.dispose(ctx);
  },
};
