import * as THREE from "three";
import { toonMaterial } from "../materials.js";

// Small stone-ringed campfire with crossed logs and a flickering flame.
// Hidden by day; the flame and warm point light fade in with the night factor.
export function makeCampfire() {
  const group = new THREE.Group();
  // PT mode hides anything tagged noReflect — the additive flame cones and the
  // point light have no place in the photoreal showcase (and the cones would
  // become solid orange shapes once their material is swapped to MeshStandard).
  group.userData.noReflect = true;

  // stone ring
  const stoneMat = toonMaterial(0x595958);
  const STONE_N = 7;
  const ringR = 0.55;
  for (let i = 0; i < STONE_N; i++) {
    const a = (i / STONE_N) * Math.PI * 2;
    const s = 0.16 + ((i * 13) % 7) * 0.02;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMat);
    stone.position.set(Math.cos(a) * ringR, s * 0.5, Math.sin(a) * ringR);
    stone.rotation.set(i, i * 0.7, i * 1.3);
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }

  // two crossed logs across the ring
  const logMat = toonMaterial(0x4a2c1a);
  const log1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.05, 6), logMat);
  log1.position.set(0, 0.12, 0);
  log1.rotation.set(0, 0, Math.PI / 2);
  log1.castShadow = true;
  log1.receiveShadow = true;
  group.add(log1);
  const log2 = new THREE.Mesh(log1.geometry, logMat);
  log2.position.set(0, 0.22, 0);
  log2.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  log2.castShadow = true;
  log2.receiveShadow = true;
  group.add(log2);

  // flame — two stacked cones with additive blending, modulated by night factor
  const flameMatOrange = new THREE.MeshBasicMaterial({
    color: 0xff8a3a, transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flameMatYellow = new THREE.MeshBasicMaterial({
    color: 0xffe26a, transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.78, 8), flameMatOrange);
  flameOuter.position.y = 0.5;
  const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), flameMatYellow);
  flameInner.position.y = 0.42;
  group.add(flameOuter, flameInner);

  // a dull ember bed sitting between the logs
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.0, depthWrite: false });
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6), emberMat);
  ember.position.y = 0.14;
  ember.scale.set(1, 0.45, 1);
  group.add(ember);

  // warm point light — gives the surrounding rocks/trunk/pond a real glow.
  // Range/decay are set so the warmth reaches the cedar trunk (~4.6 units away).
  const light = new THREE.PointLight(0xffa552, 0.0, 13.0, 1.0);
  light.position.set(0, 0.7, 0);
  light.castShadow = false;
  group.add(light);

  // keep the glow-shapes out of the depth/normal outline pass
  flameOuter.userData.skipNormal = true;
  flameInner.userData.skipNormal = true;
  ember.userData.skipNormal = true;

  // belt-and-braces: PT's getLights traverse may not honour parent.visible,
  // so explicitly tag the point light + flame meshes so the noReflect filter
  // hides them directly (and skips the wasted material swap on the cones).
  light.userData.noReflect = true;
  flameOuter.userData.noReflect = true;
  flameInner.userData.noReflect = true;
  ember.userData.noReflect = true;

  function update(time, night) {
    const n = Math.max(0, Math.min(1, night));
    const visible = n > 0.01;
    flameOuter.visible = visible;
    flameInner.visible = visible;
    ember.visible = visible;
    light.visible = visible;
    if (!visible) {
      light.intensity = 0;
      return;
    }
    const flicker = 0.85 + 0.15 * Math.sin(time * 17.0) + 0.08 * Math.sin(time * 7.3 + 1.1);
    const f = n * flicker;
    flameMatOrange.opacity = 0.85 * f;
    flameMatYellow.opacity = 0.95 * f;
    emberMat.opacity = 0.70 * n * (0.85 + 0.15 * Math.sin(time * 5.5));
    const sy = 0.92 + 0.12 * Math.sin(time * 10.0);
    flameOuter.scale.set(1, sy, 1);
    flameInner.scale.set(1, sy * 1.05, 1);
    light.intensity = 4.0 * f;
  }

  return { group, update };
}
