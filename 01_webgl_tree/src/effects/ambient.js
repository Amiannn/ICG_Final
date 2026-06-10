// Ambient background music — plays public/audio/ambiance_music.m4a on a loop.
// The track suits daytime, so its volume follows the day-night cycle: full in
// daylight, fading out as night falls (and dipping in rain, since lighting
// reports a lower "dayness" under an overcast sky — the rain ambience takes
// over). Started lazily inside a user gesture to satisfy the autoplay policy.

export function makeAmbientMusic() {
  let el = null;
  let enabled = false;
  let baseVol = 0.8;
  let dayness = 1;

  function ensure() {
    if (el) return;
    el = new Audio("./audio/ambiance_music.m4a");
    el.loop = true;
    el.volume = 0;
    el.preload = "auto";
  }

  // toggle the music on/off (Settings → Sound → Music)
  function set(on, volume = 0.8) {
    enabled = on;
    baseVol = volume;
    if (on) {
      ensure();
      el.play().catch(() => {}); // ignored if the gesture hasn't happened yet
    }
  }

  // called every frame with lighting.dayness (1 day … 0 night, lower in rain);
  // eases the volume toward the daytime-scaled target so changes never pop.
  function setDayness(d) {
    dayness = Math.max(0, Math.min(1, d));
    if (!el) return;
    const target = enabled ? baseVol * dayness : 0;
    el.volume += (target - el.volume) * 0.04;
    // fully faded out and switched off → stop pulling the stream
    if (!enabled && el.volume < 0.001 && !el.paused) el.pause();
    else if (enabled && el.paused) el.play().catch(() => {});
  }

  return { set, setDayness };
}
