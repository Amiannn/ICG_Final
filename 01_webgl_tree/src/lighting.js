import * as THREE from "three";
import { palette } from "./config.js";

// Toon lighting rig: one directional "sun" with a soft shadow + a hemisphere
// fill. Supports a continuous DAY–NIGHT CYCLE (setTimeOfDay): the sun arcs from
// sunrise → noon → sunset (so shadows rotate), and sky/fog/sun colours sweep
// through a keyframed gradient (deep night → dawn → day → dusk). A binary
// day/night (setNight) is kept as a fallback; rain overcast layers on top.
export class Lighting {
  constructor(scene) {
    this.scene = scene;

    this.direction = new THREE.Vector3(-0.5, 0.92, 0.4).normalize();
    this.sun = new THREE.DirectionalLight(palette.sunDay, 2.4);
    this.sun.position.copy(this.direction).multiplyScalar(20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -16; c.right = 16; c.top = 16; c.bottom = -16; c.near = 1; c.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xd6efee, 0x6f8a52, 1.3);
    scene.add(this.hemi);

    this._daySky = new THREE.Color(palette.skyDay);
    this._nightSky = new THREE.Color(palette.skyNight);
    this._dayFog = new THREE.Color(palette.fogDay);
    this._nightFog = new THREE.Color(palette.fogNight);
    this._daySun = new THREE.Color(palette.sunDay);
    this._nightSun = new THREE.Color(palette.sunNight);

    this._bg = new THREE.Color();
    this._dir = new THREE.Vector3();
    this._cA = new THREE.Color(); this._cB = new THREE.Color(); this._cC = new THREE.Color();

    this._night = false;
    this._rain = false;
    this._tod = null;       // null = binary day/night; 0..1 = cycle time-of-day
    this.dayness = 1;       // 1 day … 0 night (for wildlife gating)

    // day-night keyframes: t, sky, fog, sun, sunInt, hemiInt, ground
    this._kf = [
      // night kept as a visible MOONLIT blue (not near-black) so the cycle reads
      // as continuous — no black-out at the bottom of the night.
      { t: 0.00, sky: 0x1d2c50, fog: 0x24314e, sun: 0x9aa8d8, si: 0.55, hi: 0.78, g: 0x2b3654 },
      { t: 0.20, sky: 0x44567c, fog: 0x46506e, sun: 0x9aa0d0, si: 0.70, hi: 0.88, g: 0x3a4258 },
      { t: 0.27, sky: 0xef9d6a, fog: 0xf0b487, sun: 0xffae66, si: 1.30, hi: 0.95, g: 0x6e6448 },
      { t: 0.40, sky: 0xa9d6df, fog: 0xc4e3e0, sun: 0xffe9c0, si: 2.10, hi: 1.15, g: 0x6f8a52 },
      { t: 0.50, sky: 0xbfe0df, fog: 0xc4e3e0, sun: 0xfff1c4, si: 2.50, hi: 1.30, g: 0x6f8a52 },
      { t: 0.62, sky: 0xb7dcdb, fog: 0xc4e3e0, sun: 0xffe6b0, si: 2.10, hi: 1.15, g: 0x6f8a52 },
      { t: 0.73, sky: 0xe8845a, fog: 0xeaa885, sun: 0xff8a52, si: 1.20, hi: 0.85, g: 0x6a5840 },
      { t: 0.80, sky: 0x6a5a82, fog: 0x544c68, sun: 0xb094c4, si: 0.7, hi: 0.7, g: 0x40395a },
      { t: 0.88, sky: 0x2e3a5e, fog: 0x303a58, sun: 0x93a0d4, si: 0.58, hi: 0.78, g: 0x2c3658 },
    ].map((k) => ({
      t: k.t, sky: new THREE.Color(k.sky), fog: new THREE.Color(k.fog),
      sun: new THREE.Color(k.sun), si: k.si, hi: k.hi, g: new THREE.Color(k.g),
    }));
  }

  setNight(isNight) { this._night = isNight; this._tod = null; this._apply(); }
  setRain(isRain) { this._rain = isRain; this._apply(); }
  setTimeOfDay(t) { this._tod = ((t % 1) + 1) % 1; this._apply(); }

  // sample the keyframe gradient at cyclic time t → fills out colours/scalars
  _sampleTOD(t, sky, fog, sun, ground) {
    const KF = this._kf;
    let i = 0;
    while (i < KF.length - 1 && t >= KF[i + 1].t) i++;
    let a, b, local;
    if (t < KF[0].t || i >= KF.length - 1) {
      a = KF[KF.length - 1]; b = KF[0];
      const span = 1 - a.t + b.t;
      local = (((t - a.t) % 1) + 1) % 1 / span;
    } else {
      a = KF[i]; b = KF[i + 1];
      local = (t - a.t) / (b.t - a.t);
    }
    sky.copy(a.sky).lerp(b.sky, local);
    fog.copy(a.fog).lerp(b.fog, local);
    sun.copy(a.sun).lerp(b.sun, local);
    ground.copy(a.g).lerp(b.g, local);
    return { si: a.si + (b.si - a.si) * local, hi: a.hi + (b.hi - a.hi) * local };
  }

  _apply() {
    const sky = this._cA, fog = this._cB, sunColor = this._cC, ground = this.hemi.groundColor;
    let sunInt, hemiInt;

    if (this._tod != null) {
      const s = this._sampleTOD(this._tod, sky, fog, sunColor, ground);
      sunInt = s.si; hemiInt = s.hi;
      // sun arc: sunrise(east) → noon(high) → sunset(west); shadows rotate
      const th = (this._tod - 0.25) * Math.PI * 2;
      const elev = Math.sin(th), horiz = Math.cos(th);
      this._dir.set(horiz * 0.8, 0.12 + 0.88 * Math.max(elev, 0), 0.32).normalize();
      this.dayness = THREE.MathUtils.smoothstep(elev, -0.02, 0.32);
    } else {
      const t = this._night ? 1 : 0;
      sky.copy(this._daySky).lerp(this._nightSky, t);
      fog.copy(this._dayFog).lerp(this._nightFog, t);
      sunColor.copy(this._daySun).lerp(this._nightSun, t);
      ground.set(this._night ? 0x2a3450 : 0x6f8a52);
      sunInt = this._night ? 0.8 : 2.4;
      hemiInt = this._night ? 0.6 : 1.3;
      this._dir.copy(this.direction);
      this.dayness = this._night ? 0 : 1;
    }

    if (this._rain) {
      sunInt *= 0.3;
      sunColor.lerp(this._cC.clone().set(0x9fb0c0), 0.7);
      hemiInt *= 0.9;
      sky.lerp(this._cA.clone().set(0xa6bcc0), 0.6);
      fog.lerp(this._cB.clone().set(0xa3b6b8), 0.65);
      this.dayness *= 0.6;
    }

    this.sun.color.copy(sunColor);
    this.sun.intensity = sunInt;
    this.sun.position.copy(this._dir).multiplyScalar(20);
    this.hemi.intensity = hemiInt;
    this.hemi.color.copy(sky); // ambient sky tint follows the sky
    this._bg.copy(sky);
    this.scene.background = this._bg;
    if (this.scene.fog) this.scene.fog.color.copy(fog);
  }
}
