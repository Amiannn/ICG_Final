// Procedural rain ambience — no audio file. A looping noise buffer is shaped by
// band-pass + low-pass filters into the soft "shhh" of rainfall, faded in/out
// with the Rain toggle. Created lazily on first enable (inside the user's click,
// satisfying the browser autoplay policy).
export function makeRainSound() {
  let ctx = null, gain = null, started = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    // 2s of slightly-smoothed noise, looped
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      prev = 0.96 * prev + 0.04 * w;       // a little low-frequency body
      d[i] = (w * 0.35 + prev * 0.65) * 0.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3200;
    gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(bp); bp.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    src.start();
    started = true;
  }

  // toggle rain ambience on/off with a short fade
  function set(on, volume = 0.16) {
    if (on) {
      ensure();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.6);
    } else if (ctx && started) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    }
  }

  return { set };
}
