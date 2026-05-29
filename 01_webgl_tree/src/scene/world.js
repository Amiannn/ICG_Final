import * as THREE from "three";
import { toonMaterial } from "../materials.js";
import { makeTree } from "./tree.js";
import { makeGrass } from "./grass.js";
import { Water } from "./water.js";

// Builds the whole diorama and returns handles the main loop needs.
export function buildWorld(scene) {
  const mats = {
    grass: toonMaterial(0x91b066),
    hill: toonMaterial(0x86a55f),
    rock: toonMaterial(0xa8aa9a),
    flowerYellow: toonMaterial(0xf6d65a),
    flowerPink: toonMaterial(0xef9ab4),
    flowerWhite: toonMaterial(0xf2ead2),
  };

  // ground (large plane; the far edge dissolves into fog so no disc rim shows)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mats.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // distant hills (low-poly dodecahedrons, scaled flat-ish)
  const hillPlacements = [
    [-9, -8, 6, 1.6, 2.2],
    [-2, -10, 5, 1.2, 1.8],
    [7, -8.5, 7, 1.5, 2.0],
    [11, -3, 5.5, 1.3, 1.7],
  ];
  for (const [x, z, w, h, d] of hillPlacements) {
    const hill = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mats.hill);
    hill.position.set(x, h * 0.3, z);
    hill.scale.set(w, h, d);
    hill.rotation.set(0.1, x * 0.2, -0.08);
    hill.castShadow = true;
    hill.receiveShadow = true;
    scene.add(hill);
  }

  // water
  const water = new Water({ width: 7.5, depth: 5.2, y: 0.06, center: new THREE.Vector3(-4.5, 0, -2.2) });
  scene.add(water.mesh);

  // faceted rocks scattered around and ringing the scene (like the reference)
  const rockPlacements = [
    [-1.0, 3.2, 0.55], [-7.6, -1.4, 0.7], [-4.6, 1.0, 0.4], [2.4, -3.0, 0.6],
    [5.6, 0.6, 0.75], [4.8, 3.4, 0.5], [-2.2, 5.2, 0.6], [1.0, 6.0, 0.7],
    [-6.5, 3.8, 0.55], [6.8, -2.6, 0.65], [-3.4, -5.2, 0.7], [3.6, 5.6, 0.45],
    [7.4, 2.8, 0.5], [-8.2, 1.6, 0.6], [0.4, -6.2, 0.55], [-5.6, -3.4, 0.5],
  ];
  const rng2 = mulberry(404);
  for (const [x, z, s] of rockPlacements) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mats.rock);
    rock.position.set(x, s * 0.4, z);
    rock.scale.set(1.1 + rng2() * 0.3, 0.5 + rng2() * 0.3, 0.85 + rng2() * 0.25);
    rock.rotation.set(rng2() * 0.4, x * 0.7 + rng2(), -0.1 + rng2() * 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // the tree
  const tree = makeTree();
  tree.position.set(2.6, 0, 1.2);
  scene.add(tree);

  // scattered flowers
  const blooms = [mats.flowerYellow, mats.flowerPink, mats.flowerWhite];
  const frand = mulberry(99);
  for (let i = 0; i < 60; i++) {
    const x = (frand() - 0.5) * 22;
    const z = (frand() - 0.5) * 22;
    const wb = water.bounds;
    if (x > wb.minX - 0.4 && x < wb.maxX + 0.4 && z > wb.minZ - 0.4 && z < wb.maxZ + 0.4) continue;
    if (x > 1.4 && x < 3.8 && z > 0.0 && z < 2.4) continue; // tree base
    addFlower(scene, x, z, blooms[i % blooms.length], 0.7 + frand() * 0.5, mats.grass);
  }

  // grass field (avoid water + tree base)
  const grass = makeGrass({
    count: 18000,
    area: 44,
    exclude: [
      water.bounds,
      { minX: 0.6, maxX: 4.6, minZ: -0.8, maxZ: 3.2 }, // big cedar base
    ],
  });
  scene.add(grass);

  return { water, tree, grass, ground };
}

function addFlower(scene, x, z, bloomMat, scale, stemMat) {
  const stemH = 0.36 * scale;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, stemH, 4), stemMat);
  stem.position.set(x, stemH * 0.5, z);
  scene.add(stem);
  const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * scale, 0), bloomMat);
  bloom.position.set(x, stemH + 0.06 * scale, z);
  bloom.castShadow = true;
  scene.add(bloom);
}

function mulberry(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
