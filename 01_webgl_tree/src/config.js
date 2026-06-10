// Central palette + tunables. Colours are chosen to read well after the
// toon ramp quantises them, in the muted-pastel register of the reference art.

export const settings = {
  motion: true,
  snap: true,
  outlines: true,
  clouds: false,
  water: false,
  godrays: true,
  rain: false,
  dust: true,
  night: false,
  cycle: true, // continuous day–night cycle (overrides the Night toggle while on)
  grain: false,
  verticalResolution: 720,
  outlineStrength: 0.15,
  timeOfDay: 0.0, // game slider position (0 sunrise → 1 night); set by the UI
  species: "cedar", // game tree species: "cedar" (billboard cedar) | "morph"
  music: true, // gentle procedural ambient background music
};

// Game-mode tunables: the sun + day counter advance on their own, the tree
// grows over `growthDays`, and weather brings random showers.
export const game = {
  dayLengthSeconds: 24, // real seconds for one full day-night cycle (= 1 day)
  startDay: 1,
  growthDays: 30, // tree reaches full size on this day
  // random weather
  rainMinGapSeconds: 30,
  rainMaxGapSeconds: 90,
  rainMinSeconds: 8,
  rainMaxSeconds: 22,
};

export const palette = {
  skyDay: 0xbfe0df,
  skyNight: 0x222d44,
  fogDay: 0xc4e3e0,
  fogNight: 0x5a6a8a,
  sunDay: 0xfff1c4,
  sunNight: 0x9fb6e6,
  ink: 0x222a26, // outline colour
  edgeHighlight: 0xfff3c0,
};

// Toon shading ramp: dark shadow -> mid -> lit -> hot highlight.
// Paler, airier greens (lifted shadow floor) for a softer overall tone.
export const toonRamp = ["#9eb098", "#c2d3a4", "#e2ebb8", "#fdf9dc"];
