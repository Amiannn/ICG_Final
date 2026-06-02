import * as THREE from "three";
import { palette } from "./config.js";

// Toon lighting rig: one directional "sun" with a soft shadow, plus a
// hemisphere fill so shadowed areas keep colour. Day/night just lerps the sun
// colour/intensity, ambient, and the sky/fog tint.
export class Lighting {
  constructor(scene) {
    this.scene = scene;

    this.direction = new THREE.Vector3(-0.5, 0.92, 0.4).normalize();
    this.sun = new THREE.DirectionalLight(palette.sunDay, 2.4);
    this.sun.position.copy(this.direction).multiplyScalar(20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -16;
    c.right = 16;
    c.top = 16;
    c.bottom = -16;
    c.near = 1;
    c.far = 60;
    // soft, slightly biased shadow to avoid acne + flicker on the slow sun
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xd6efee, 0x6f8a52, 1.3);
    scene.add(this.hemi);

    this._dayFog = new THREE.Color(palette.fogDay);
    this._nightFog = new THREE.Color(palette.fogNight);
    this._daySky = new THREE.Color(palette.skyDay);
    this._nightSky = new THREE.Color(palette.skyNight);
    this._daySun = new THREE.Color(palette.sunDay);
    this._nightSun = new THREE.Color(palette.sunNight);
    this._tmp = new THREE.Color();

    this._night = false;
    this._rain = false; // overcast when raining: no direct sun
  }

  setNight(isNight) {
    this._night = isNight;
    this._apply();
  }

  setRain(isRain) {
    this._rain = isRain;
    this._apply();
  }

  // Resolve the lighting from the current weather. Rain ⇒ overcast: the direct
  // sun is dimmed to a soft grey, and the sky/fog turn cool and flat — there is
  // no sunshine in a downpour.
  _apply() {
    const t = this._night ? 1 : 0;
    const sunColor = this._daySun.clone().lerp(this._nightSun, t);
    let sunInt = this._night ? 0.8 : 2.4;
    let hemiInt = this._night ? 0.6 : 1.3;
    const groundCol = new THREE.Color(this._night ? 0x2a3450 : 0x6f8a52);
    const sky = this._daySky.clone().lerp(this._nightSky, t);
    const fog = this._dayFog.clone().lerp(this._nightFog, t);

    if (this._rain) {
      sunInt *= 0.3; // almost no direct sun under cloud cover
      sunColor.lerp(new THREE.Color(0x9fb0c0), 0.7); // cool, desaturated
      hemiInt *= 0.9; // flat overcast fill
      const overcastSky = new THREE.Color(this._night ? 0x1b2333 : 0xa6bcc0);
      const overcastFog = new THREE.Color(this._night ? 0x222b3c : 0xa3b6b8);
      sky.lerp(overcastSky, 0.82);
      fog.lerp(overcastFog, 0.85);
    }

    this.sun.color.copy(sunColor);
    this.sun.intensity = sunInt;
    this.hemi.intensity = hemiInt;
    this.hemi.groundColor.copy(groundCol);
    this.scene.background = sky;
    if (this.scene.fog) this.scene.fog.color.copy(fog);
  }
}
