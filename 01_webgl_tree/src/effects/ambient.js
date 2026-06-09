// Procedural ambient music — no audio file, all synthesised live with Web Audio.
// A soft, slowly-breathing pad drone (root + fifth) plus occasional gentle bell
// notes drawn from a C-major pentatonic scale, sent through a generated reverb.
// Kept very quiet and sparse for a calm, "healing" background. Created lazily on
// first enable (inside a user gesture) to satisfy the browser autoplay policy.

const SCALE = [0, 2, 4, 7, 9]; // C major pentatonic (C D E G A)
const BASE = 261.63;           // C4
const semis = (n) => Math.pow(2, n / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function makeAmbientMusic() {
  let ctx = null, master = null, noteBus = null;
  let schedulerOn = false, timer = null;

  function makeReverbImpulse(seconds = 2.6, decay = 2.4) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return imp;
  }

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // a soft plate-ish reverb for space
    const reverb = ctx.createConvolver();
    reverb.buffer = makeReverbImpulse();
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.6;
    reverb.connect(reverbGain);
    reverbGain.connect(master);

    // bell notes go dry + into the reverb
    noteBus = ctx.createGain();
    noteBus.gain.value = 1;
    noteBus.connect(master);
    noteBus.connect(reverb);

    // --- pad drone: detuned triangles on C2 / C3 / G3, breathing lowpass ---
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    const padLP = ctx.createBiquadFilter();
    padLP.type = "lowpass";
    padLP.frequency.value = 650;
    padGain.connect(padLP);
    padLP.connect(master);
    padLP.connect(reverb);

    const padFreqs = [BASE * semis(-24), BASE * semis(-24) * 1.004, BASE * semis(-12), BASE * semis(-5)];
    for (const f of padFreqs) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.connect(padGain);
      o.start();
    }
    // slow filter sweep so the pad gently swells
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain);
    lfoGain.connect(padLP.frequency);
    lfo.start();
  }

  // one soft bell note from the scale, with a slow attack + long tail
  function playNote() {
    if (!schedulerOn || !ctx) return;
    const t = ctx.currentTime;
    const oct = pick([0, 12, 12]); // mostly the upper octave
    const f = BASE * semis(pick(SCALE) + oct);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(rnd(0.06, 0.1), t + 0.7); // gentle swell in
    g.gain.exponentialRampToValueAtTime(0.0006, t + 3.4);    // long fade out
    o.connect(g);
    g.connect(noteBus);
    o.start(t);
    o.stop(t + 3.6);

    timer = setTimeout(playNote, rnd(2400, 6000)); // ms until the next note
  }

  // toggle the music on/off with a slow fade
  function set(on, volume = 0.22) {
    if (on) {
      ensure();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      if (!schedulerOn) { schedulerOn = true; timer = setTimeout(playNote, 600); }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2.5);
    } else if (ctx) {
      schedulerOn = false;
      if (timer) { clearTimeout(timer); timer = null; }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
    }
  }

  return { set };
}
