// Ambient background music — two looping tracks cross-faded by the day-night
// cycle: ambiance_music.m4a carries the day, ambiance_night.m4a takes over at
// night, blending through dusk/dawn (and dipping in rain, since lighting
// reports a lower "dayness" under an overcast sky — the rain ambience helps
// cover the dip). Started lazily inside a user gesture (autoplay policy).

export function makeAmbientMusic() {
  let day = null, night = null;
  let enabled = false;
  let baseVol = 0.8;

  function ensure() {
    if (day) return;
    day = new Audio("./audio/ambiance_music.m4a");
    night = new Audio("./audio/ambiance_night.m4a");
    for (const el of [day, night]) {
      el.loop = true;
      el.volume = 0;
      el.preload = "auto";
    }
  }

  // toggle the music on/off (Settings → Sound → Music)
  function set(on, volume = 0.8) {
    enabled = on;
    baseVol = volume;
    if (on) {
      ensure();
      day.play().catch(() => {}); // ignored until the first user gesture
      night.play().catch(() => {});
    }
  }

  // called every frame with lighting.dayness (1 day … 0 night, lower in rain);
  // eases each track toward its share of the cross-fade so changes never pop.
  function setDayness(d) {
    if (!day) return;
    d = Math.max(0, Math.min(1, d));
    const dayTarget = enabled ? baseVol * d : 0;
    const nightTarget = enabled ? baseVol * (1 - d) : 0;
    day.volume += (dayTarget - day.volume) * 0.04;
    night.volume += (nightTarget - night.volume) * 0.04;

    for (const el of [day, night]) {
      if (!enabled && el.volume < 0.001 && !el.paused) el.pause();
      else if (enabled && el.paused) el.play().catch(() => {});
    }
  }

  return { set, setDayness };
}
