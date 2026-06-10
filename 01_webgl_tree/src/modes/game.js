import { realtimeMode } from "./realtime.js";
import { makeMorphTree } from "../../../02_tree_growth/src/morph_tree.js";
import { makeCedarGrowth } from "../../../02_tree_growth/src/cedar_growth.js";
import { game } from "../config.js";
import { setDay, reflectTime, notifyEvent, setWaterCount, setFertCount } from "../ui.js";

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
      ctx.activeTreeGroup = morph.group; // poking interactions target this tree
      return {
        setGrowth: (g) => morph.setGrowth(g),
        dispose: () => {
          ctx.scene.remove(morph.group);
          morph.dispose();
          if (ctx.tree) ctx.tree.visible = true;
          ctx.activeTreeGroup = ctx.tree;
        },
      };
    }
    // default: the real cedar, grown in place
    if (ctx.tree) ctx.tree.visible = true;
    ctx.activeTreeGroup = ctx.tree;
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

    // Day-30 night festival (fireworks + dancing animals), starts automatically.
    this.festival = false;
    this.festivalTimer = 0;
    this._festivalDone = false;

    // debug: jump to a time of day d (frac defaults to evening), force the show
    window.__gameDay = (d, frac = 0.8) => {
      this.dayFloat = (d - game.startDay) + Math.max(0, Math.min(0.999, frac));
      this.lastDayInt = Math.floor(this.dayFloat);
      setDay(game.startDay + this.lastDayInt);
    };
    window.__festival = () => this._startFestival(true);
    window.__festMusic = () => (this.music ? { paused: this.music.paused, t: +this.music.currentTime.toFixed(2) } : null);

    // festival music — plays ONLY while the animals dance on the night of Day 30
    // (the player's track at public/festival_music.mp3).
    this.music = new Audio(import.meta.env.BASE_URL + "festival_music.mp3");
    this.music.loop = false; // the track plays ONCE — its ending closes the show
    this.music.volume = 0.8;
    // the moment the track truly finishes, the dancers strike their end pose —
    // event-driven, so no frame-loop or duration-metadata quirk can miss it
    this.music.addEventListener("ended", () => {
      if (this.festival && !this._posed) {
        this._posed = true;
        this.ctx?.world.animals?.endPose?.();
      }
    });
    // unlock the audio element on the first user tap so it can auto-play at Day 30
    this._prime = () => {
      if (this.music) this.music.play().then(() => { this.music.pause(); this.music.currentTime = 0; }).catch(() => {});
      window.removeEventListener("pointerdown", this._prime);
      this._prime = null;
    };
    window.addEventListener("pointerdown", this._prime);

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
      ctx.world.animals.onPoop = () => {
        notifyEvent("💩", "A visitor left droppings — tap to collect!");
      };
    }

    // water is a resource: start with one charge, refill by tapping the pond
    this.water = 1;
    setWaterCount(this.water);
    // fertiliser too: collect animal droppings to restock
    this.fert = 1;
    setFertCount(this.fert);

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

    // freeze the clock during the festival so it stays Day-30 night (no bleed
    // into Day 31, no fireworks on Day 31); the clock resumes when it ends.
    if (!this.festival) this.dayFloat += dt / game.dayLengthSeconds;

    const dayInt = Math.floor(this.dayFloat);
    if (dayInt > this.lastDayInt) {
      this.lastDayInt = dayInt;
      setDay(game.startDay + dayInt);
    }

    // Day 30, EVENING ONLY: the festival starts automatically once the day's
    // fraction reaches nightfall (s ≥ 0.78). Checking the clock fraction — not
    // lighting darkness — means dawn (also dark) can never set it off, so Day 30
    // keeps its normal morning/noon/afternoon before the show.
    const dayFrac = this.dayFloat - Math.floor(this.dayFloat);
    if (!this.festival && !this._festivalDone && this._dayNumber() >= 30 && dayFrac >= 0.78 && !ctx.settings.rain) {
      this._festivalDone = true;
      this._startFestival();
    }
    if (this.festival) {
      this.festivalT += dt;
      this.festivalTimer -= dt; // hard safety ceiling only (audio-failure case)

      // The show's timeline FOLLOWS THE MUSIC: as the track reaches its final
      // bars everyone snaps into a held HERO POSE — the song ends on the pose —
      // and after a few seconds of admiring it under the last fading shells,
      // the show closes and the dancers disperse. If the audio never started
      // (blocked autoplay), the elapsed-time clock stands in for the track.
      const m = this.music;
      const dur = m && isFinite(m.duration) && m.duration > 1 ? m.duration : 25.3;
      const tm = m && m.currentTime > 0.2 ? m.currentTime : this.festivalT;
      // pose on the final bars — OR the instant the element reports it has
      // actually ENDED (VBR mp3s can report a duration longer than the real
      // stream, in which case currentTime never reaches duration−1.5; checking
      // m.ended makes "music over → strike the pose" unconditional)
      if (!this._posed && (tm >= dur - 1.5 || (m && m.ended))) {
        this._posed = true;
        ctx.world.animals?.endPose?.();
      }
      if (this._posed) {
        this._poseHold += dt;
        if (this._poseHold >= 5.0 || this.festivalTimer <= 0) this._endFestival();
      } else if (this.festivalTimer <= 0) {
        this._endFestival();
      }

      // ease the camera back to the default framing for the show, so the front-
      // row stage faces the screen (out-pulls the slow ambient auto-orbit)
      const yaw = ctx.pixel.yaw;
      ctx.pixel.setYaw(yaw + (0.85 - yaw) * Math.min(1, dt * 1.5));
    }

    this._weather(ctx, dt);
    this._apply(ctx);

    // fireworks + festival lighting: each burst flashes a point light over the
    // dancing animals and a warm glow across the screen.
    const fw = ctx.fireworks;
    if (fw) {
      fw.update(dt, time);
      const f = fw.flash;
      if (ctx.festivalLight) {
        ctx.festivalLight.intensity = (fw.active ? 0.35 : 0) + f * 1.1;
        ctx.festivalLight.color.copy(fw.flashColor);
        ctx.festivalLight.visible = ctx.festivalLight.intensity > 0.02;
      }
      if (ctx.pipeline.composite.uniforms.uFlash) {
        ctx.pipeline.composite.uniforms.uFlash.value.copy(fw.flashColor).multiplyScalar(Math.min(0.07, f * 0.045));
      }
    }
    if (this.festival) this._updateBeat(dt); // drive the dancers from the music beat

    reflectTime(this.dayFloat - Math.floor(this.dayFloat));
    realtimeMode.render(ctx, time);
  },

  // push the current clock state onto the world (sun, growth, ecosystem)
  _apply(ctx) {
    let s = this.dayFloat - Math.floor(this.dayFloat); // 0..1 within the day
    if (this.festival) s = 0.8; // hold a dramatic night for the whole fireworks show
    ctx.tod = (0.25 + s) % 1; // slider s (sunrise→…→night) → lighting tod (dawn≈0.25)

    const dayIndex = game.startDay - 1 + this.dayFloat;
    const growth = Math.min(1, Math.max(0, dayIndex / (game.growthDays - 1)));
    if (this.grower) this.grower.setGrowth(growth);
    ctx.growthReveal = growth; // wildlife still walk/fly in as the tree grows
    ctx.groundReveal = 1; // grass + flowers stay full-grown from day 1
  },

  _weather(ctx, dt) {
    // keep the Day-30 finale night clear so the festival always happens
    if (this._dayNumber() >= 30) {
      this.raining = false; this.waterPulse = 0;
      if (this.lastRain) { ctx.setRain?.(false); this.lastRain = false; }
      return;
    }
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
      if (this.water <= 0) {
        notifyEvent("🚱", "Out of water — tap the pond!");
        return false; // vetoed: the UI skips its pulse/toast
      }
      this.water -= 1;
      setWaterCount(this.water);
      // sprinkle the tree as it currently stands (height/spread follow growth)
      const dayIndex = game.startDay - 1 + this.dayFloat;
      const g = Math.min(1, Math.max(0, dayIndex / (game.growthDays - 1)));
      const top = 3.5 + 17 * g;
      const radius = 1.6 + 3.2 * g;
      this.ctx.watering?.trigger(this.ctx.tree?.position, top, radius);
      this.dayFloat += 0.5; // a drink = half a day's growth
    } else if (name === "fertilize") {
      if (this.fert <= 0) {
        notifyEvent("🚫", "No fertilizer — collect animal droppings!");
        return false;
      }
      this.fert -= 1;
      setFertCount(this.fert);
      this.dayFloat += 1;
    } else if (name === "bonemeal") this.dayFloat += 2;
    else if (name === "skipday30") {
      // demo shortcut: jump straight to the fully-grown tree (mid-morning)
      const target = game.growthDays - game.startDay + 0.45;
      if (this.dayFloat < target) {
        this.dayFloat = target;
        notifyEvent("⏩", "Time flies — Day 30!");
      }
    }
  },

  // tap the pond → scoop a charge of water
  collectWater() {
    this.water += 1;
    setWaterCount(this.water);
    notifyEvent("💧", "Fetched water from the pond! (+1)");
  },

  // tap a dropping → a charge of fertiliser
  collectFertilizer() {
    this.fert += 1;
    setFertCount(this.fert);
    notifyEvent("💩", "Droppings collected — +1 fertilizer!");
  },

  // fixed close-up framing (the camera does NOT pull back as the tree grows —
  // zoom out with the wheel to see the full cedar). The Day-30 festival pulls
  // back on its own (eased by the main loop) so the front-row dance stage, the
  // fireworks and the full cedar all fit in frame, then returns to the close-up.
  viewBase() {
    return this.festival ? 34 : 20;
  },

  // ---- Day-30 night festival --------------------------------------------
  _dayNumber() { return game.startDay + Math.floor(this.dayFloat); },

  _startFestival(force) {
    if (this.festival || !this.ctx) return;
    if (force) { // debug: jump to the night of Day 30
      this.dayFloat = Math.max(this.dayFloat, (30 - game.startDay) + 0.8);
      this.lastDayInt = Math.floor(this.dayFloat);
      setDay(game.startDay + this.lastDayInt);
    }
    this.festival = true;
    this.ctx.festivalActive = true; // main.js ducks the ambient under the show
    this.festivalT = 0;       // elapsed show time (audio-fallback clock)
    this.festivalTimer = 45;  // hard safety ceiling — music length drives the real end
    this._posed = false;
    this._poseHold = 0;
    // barrage sized to the track: the finale lands on its last bars, and the
    // final shells fade out right over the held end pose
    this.ctx.fireworks?.start(24);
    this.ctx.world.animals?.party(true);
    if (this.music) {
      this.music.loop = false; // re-assert: the show must end with the song
      this.music.currentTime = 0;
      this.music.play().catch(() => {});
    }
    notifyEvent("🎆", "Day 30 — the festival begins!");
  },

  // Beat from the music's PLAYBACK TIME on the track's measured grid — comb-
  // filter analysis of festival_music.mp3 gives 115.25 BPM with the first beat
  // at 0.228s (the 75/153 candidates are its ⅔/×4⁄3 aliases). Driving the dance
  // from audio.currentTime keeps every count phase-locked to what you HEAR, and
  // the exact beat index is passed along so the choreography can never drift.
  // The music plays through a plain <audio> element, so it is never muted.
  _updateBeat() {
    const BPM = 115.25, OFFSET = 0.228; // measured from festival_music.mp3
    let pulse = 0, step = 0;
    if (this.music && !this.music.paused) {
      const phase = (this.music.currentTime - OFFSET) * (BPM / 60);
      step = Math.max(0, Math.floor(phase));
      const frac = phase - Math.floor(phase);  // 0..1 within the beat
      pulse = Math.max(0, 1 - frac * 3.0);      // sharp hit ON the beat, quick decay
    }
    // the track's last ~7 seconds: everyone all-out until the end pose
    const m = this.music;
    const dur = m && isFinite(m.duration) && m.duration > 1 ? m.duration : 25.3;
    const tm = m && m.currentTime > 0.2 ? m.currentTime : this.festivalT || 0;
    const finale = tm >= dur - 7;
    this.ctx.world.animals?.setBeat?.(0.85, pulse, step, finale);
  },

  _endFestival() {
    this.festival = false;
    if (this.ctx) this.ctx.festivalActive = false;
    this.ctx?.world.animals?.party(false);
    this.ctx?.fireworks?.stop();
    if (this.music) this.music.pause();
  },

  // ---- teardown ----------------------------------------------------------
  dispose(ctx) {
    if (this.grower) {
      this.grower.dispose();
      this.grower = null;
    }
    if (this.festival) this._endFestival();
    if (this.music) { this.music.pause(); this.music.currentTime = 0; this.music = null; }
    if (this._prime) { window.removeEventListener("pointerdown", this._prime); this._prime = null; }
    if (ctx.festivalLight) { ctx.festivalLight.visible = false; ctx.festivalLight.intensity = 0; }
    if (ctx.pipeline.composite.uniforms.uFlash) ctx.pipeline.composite.uniforms.uFlash.value.setRGB(0, 0, 0);
    delete window.__festival;
    delete window.__gameDay;
    if (ctx.world.animals) ctx.world.animals.onVisit = null;
    if (this.lastRain) ctx.setRain?.(false);
    ctx.tod = null;
    ctx.growthReveal = null;
    ctx.groundReveal = null;
    this.ctx = null;
    realtimeMode.dispose(ctx);
  },
};
