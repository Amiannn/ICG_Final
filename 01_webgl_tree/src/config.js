// Central palette + tunables. Colours are chosen to read well after the
// toon ramp quantises them, in the muted-pastel register of the reference art.

export const settings = {
  motion: true,
  snap: true,
  outlines: true,
  clouds: true,
  water: true,
  godrays: true,
  rain: false,
  dust: true,
  night: false,
  cycle: true, // continuous day–night cycle (overrides the Night toggle while on)
  grain: true,
  verticalResolution: 300,
  outlineStrength: 0.0,
};

export const palette = {
  skyDay: 0xbfe0df,
  skyNight: 0x222d44,
  fogDay: 0xc4e3e0,
  fogNight: 0x27324a,
  sunDay: 0xfff1c4,
  sunNight: 0x9fb6e6,
  ink: 0x222a26, // outline colour
  edgeHighlight: 0xfff3c0,
};

// Toon shading ramp: dark shadow -> mid -> lit -> hot highlight.
// Paler, airier greens (lifted shadow floor) for a softer overall tone.
export const toonRamp = ["#8a9c80", "#b2c590", "#d8e2a8", "#fcf8d6"];
