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
  }

  setNight(isNight) {
    const t = isNight ? 1 : 0;
    this.sun.color.copy(this._tmp.copy(this._daySun).lerp(this._nightSun, t));
    this.sun.intensity = isNight ? 0.8 : 2.4;
    this.hemi.intensity = isNight ? 0.6 : 1.3;
    this.hemi.groundColor.set(isNight ? 0x2a3450 : 0x6f8a52);

    const sky = this._tmp.copy(this._daySky).lerp(this._nightSky, t).clone();
    const fog = this._daySky.clone().copy(this._dayFog).lerp(this._nightFog, t).clone();
    this.scene.background = sky;
    if (this.scene.fog) this.scene.fog.color.copy(fog);
  }
}
