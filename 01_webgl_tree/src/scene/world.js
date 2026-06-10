import * as THREE from "three";
import { toonMaterial } from "../materials.js";
import { makeTree } from "./tree.js";
import { makeGrass, makePatchGrass } from "./grass.js";
import { Water } from "./water.js";
import { makeAnimals } from "./animals.js";
import { makeBirds } from "../effects/birds.js";
import { makeCampfire } from "./campfire.js";

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

  // ground — huge so PT mode (which ignores scene.fog) never sees the edge.
  // Realtime fog (~72 units) hides everything past 72 anyway, so the extra
  // 500×500 expanse costs realtime nothing and gives PT an effectively
  // infinite meadow extending out under the horizon.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mats.grass);
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

  // (the old far-horizon dodecahedron ring was replaced by the displaced
  // mountain-ring terrain below — see makeMountainRing.)

  // mid-distance hills — fill the skyline between the close hills and the far
  // horizon ring so the background behind the cedar isn't empty. Kept at
  // radius ~26-30 from the scene centre: that is OUTSIDE the camera's orbit
  // (eye sits at xz-radius ~18), so the low game camera can never clip into
  // them at any yaw. Inside the fog far plane, so they read as solid hills.
  const midHills = [
    [27, -5, 7.5, 3.4, 5.0],
    [20, -19, 8.5, 3.8, 5.4],
    [-2, -27, 8.0, 3.6, 5.2],
    [-20, -16, 8.5, 3.6, 5.4],
    [-27, 3, 8.0, 3.4, 5.2],
    [-16, 22, 7.5, 3.2, 5.0],
    [8, 28, 8.0, 3.4, 5.2],
    [26, 15, 7.5, 3.2, 5.0],
  ];
  for (const [x, z, w, h, d] of midHills) {
    const hill = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mats.hill);
    hill.position.set(x, h * 0.3, z);
    hill.scale.set(w, h, d);
    hill.rotation.set(0.11, x * 0.17, -0.06);
    hill.castShadow = true;
    hill.receiveShadow = true;
    scene.add(hill);
  }

  // mountain ring — a displaced terrain mesh surrounding the meadow. Flat in
  // the play area (r < ~30, where the grass lives and the camera orbits), then
  // rolling ridges that climb into proper peaks toward the fog line, with the
  // summits blending toward rock. Reads as continuous landscape undulation
  // rather than placed polyhedra.
  scene.add(makeMountainRing());

  // water — a large foreground lake. With the iso/orthographic camera a tall
  // tree's mirror image streaks far toward the camera (along world x−z ≈ const),
  // so the lake must be big and reach forward to actually catch the trunk+canopy
  // reflection. The cedar sits at the lake's back shore. Max reflectance for a
  // clear, legible mirror that morphs together with the tree in Growth mode.
  // A small pond set just IN FRONT of the cedar (toward the camera), with the
  // tree on its back shore. The iso camera makes a tree mirror toward +x/+z
  // along world x−z ≈ const, so the pond sits on that streak; with the grass
  // excluded from the mirror the cedar reflects clearly against the sky.
  // bigger pond, grown toward the camera (+x/+z) so the cedar stays on the
  // back shore rather than ending up in the water. The back edge (toward the
  // tree) stays ~where it was; the lake just reaches further into the foreground.
  const water = new Water({ width: 10, depth: 7.5, y: 0.06, center: new THREE.Vector3(6.0, 0, 4.4) });
  water.material.uniforms.uReflectStrength.value = 0.9;
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

  // big mid-distance boulders — larger faceted rocks dotting the meadow behind
  // the cedar so the middle distance has some mass to read against the hills.
  // kept at radius < ~15 (clear foreground) so they never sit on the camera's
  // ~18-unit orbit and clip the view at any yaw
  const bigRocks = [
    [-10, -6, 1.7], [-13, 5, 1.4], [9, -11, 1.6], [13, 6, 1.3],
    [-6, 10, 1.3], [12, -6, 1.5], [-11, -3, 1.5], [6, 12, 1.2],
  ];
  for (const [x, z, s] of bigRocks) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mats.rock);
    rock.position.set(x, s * 0.45, z);
    rock.scale.set(1.0 + rng2() * 0.4, 0.55 + rng2() * 0.35, 0.85 + rng2() * 0.3);
    rock.rotation.set(rng2() * 0.4, x * 0.7 + rng2(), -0.1 + rng2() * 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // the tree
  const tree = makeTree();
  tree.position.set(2.6, 0, 1.2);
  scene.add(tree);

  // scattered flowers (grouped so they can bloom in with the tree's growth)
  const flowers = new THREE.Group();
  const flowerList = [];
  const blooms = [mats.flowerYellow, mats.flowerPink, mats.flowerWhite];
  const frand = mulberry(99);
  for (let i = 0; i < 95; i++) {
    const x = (frand() - 0.5) * 32;
    const z = (frand() - 0.5) * 32;
    const wb = water.bounds;
    if (x > wb.minX - 0.4 && x < wb.maxX + 0.4 && z > wb.minZ - 0.4 && z < wb.maxZ + 0.4) continue;
    if (x > 1.4 && x < 3.8 && z > 0.0 && z < 2.4) continue; // tree base
    const f = makeFlower(x, z, blooms[i % blooms.length], 0.7 + frand() * 0.5, mats.grass);
    flowers.add(f);
    flowerList.push(f);
  }

  // grass tufts + a few wildflowers clinging to the rock tops and hill slopes,
  // so the boulders + hills aren't bare. Tufts sit on each dome's upper surface.
  const vrng = mulberry(7777);
  const grassSpots = [];
  const domeTufts = (cx, cy, cz, rx, ry, rz, n) => {
    for (let i = 0; i < n; i++) {
      const a = vrng() * Math.PI * 2;
      const rad = Math.sqrt(vrng());
      const dy = Math.sqrt(Math.max(0, 1 - rad * rad));
      grassSpots.push({
        x: cx + Math.cos(a) * rad * rx * 0.9,
        z: cz + Math.sin(a) * rad * rz * 0.9,
        y: cy + dy * ry,
        w: 0.16 + vrng() * 0.12,
        h: 0.22 + vrng() * 0.2,
        t: vrng(),
      });
    }
  };
  for (const [x, z, s] of bigRocks) domeTufts(x, s * 0.45, z, s * 1.1, s * 0.6, s * 0.95, 10);
  for (const [x, z, w, h, d] of hillPlacements) domeTufts(x, h * 0.3, z, w, h, d, 22);
  for (const [x, z, w, h, d] of midHills) domeTufts(x, h * 0.3, z, w, h, d, 16);
  const patchGrass = makePatchGrass(grassSpots);
  patchGrass.userData.noReflect = true;
  scene.add(patchGrass);

  const perch = (cx, cy, cz, rx, ry, rz, n, k) => {
    for (let i = 0; i < n; i++) {
      const a = vrng() * Math.PI * 2;
      const rad = Math.sqrt(vrng()) * 0.7;
      const dy = Math.sqrt(Math.max(0, 1 - rad * rad));
      const f = makeFlower(cx + Math.cos(a) * rad * rx, cz + Math.sin(a) * rad * rz, blooms[(k + i) % blooms.length], 0.6 + vrng() * 0.4, mats.grass);
      f.position.y = cy + dy * ry;
      flowers.add(f);
      flowerList.push(f);
    }
  };
  bigRocks.forEach(([x, z, s], i) => perch(x, s * 0.45, z, s * 1.0, s * 0.55, s * 0.85, 2, i));
  hillPlacements.forEach(([x, z, w, h, d], i) => perch(x, h * 0.3, z, w * 0.8, h, d * 0.8, 3, i));

  scene.add(flowers);

  // grass field (avoid water + tree base)
  const grass = makeGrass({
    count: 32000,
    area: 58,
    exclude: [
      water.bounds,
      { minX: 0.6, maxX: 4.6, minZ: -0.8, maxZ: 3.2 }, // big cedar base
    ],
  });
  grass.userData.noReflect = true; // keep the grass carpet out of the water mirror
  scene.add(grass);
  const grassTotal = grass.count; // full blade count (revealed progressively)

  // solid obstacles the animals must walk AROUND (they may pass through grass,
  // but not the trunk, rocks or campfire). Each is a circle {x, z, r} on the
  // ground; r includes a margin for the animal's body.
  const obstacles = [
    { x: 2.6, z: 1.2, r: 1.9 },   // cedar trunk + roots
    { x: 6.9, z: -0.5, r: 1.2 },  // campfire
    // the pond (ellipse, incl. irregular rim + body margin) — animals never wade
    { x: 6.0, z: 4.4, rx: 6.4, rz: 4.9 },
    ...rockPlacements.map(([x, z, s]) => ({ x, z, r: s * 1.35 + 0.5 })),
    ...bigRocks.map(([x, z, s]) => ({ x, z, r: s * 1.3 + 0.5 })),
  ];

  // wildlife — barnyard animals on the meadow + a flock of birds (shown only on
  // clear sunny days; the main loop hides them at night and in the rain)
  const animals = makeAnimals(obstacles);
  scene.add(animals.group);
  const birds = makeBirds();
  scene.add(birds.group);

  // small campfire just south of the pond's near shore — flame only lights up
  // at night. Positioned to clear the rocks at (5.6, …, 0.6) and (6.8, …, -2.6)
  // and stay outside the tree-base exclusion.
  const campfire = makeCampfire();
  campfire.group.position.set(6.9, 0, -0.5);
  scene.add(campfire.group);

  // Ecosystem grows with the tree: reveal grass blades (by instance count) and
  // bloom in the flowers as growthProgress (frac) rises. frac=1 = full meadow.
  function setGroundReveal(frac) {
    grass.count = Math.max(0, Math.floor(grassTotal * frac));
    for (let i = 0; i < flowerList.length; i++) {
      const th = i / flowerList.length;
      const r = _ss(th - 0.1, th + 0.03, frac);
      flowerList[i].scale.setScalar(r);
      flowerList[i].visible = r > 0.01;
    }
  }

  return { water, tree, grass, ground, animals, birds, flowers, campfire, setGroundReveal };
}

const _ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// A flower as a self-contained group rooted at (x,0,z) so it can scale-bloom
// from the ground.
function makeFlower(x, z, bloomMat, scale, stemMat) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const stemH = 0.36 * scale;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, stemH, 4), stemMat);
  stem.position.set(0, stemH * 0.5, 0);
  g.add(stem);
  const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * scale, 0), bloomMat);
  bloom.position.set(0, stemH + 0.06 * scale, 0);
  bloom.castShadow = true;
  g.add(bloom);
  return g;
}

// A ring of rolling terrain: a plane whose vertices are displaced by layered
// sine "noise", flat inside r≈30 (meadow + camera orbit), swelling into ridges
// and peaks (up to ~13 units) toward the fog line. Vertex colours blend the
// hill green toward rock grey on the high summits; smooth normals let the toon
// ramp band it like natural slopes.
function makeMountainRing() {
  const SIZE = 150, SEG = 110;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grassC = new THREE.Color(0x86a55f);
  const rockC = new THREE.Color(0xa8aa9a);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    // layered, smooth pseudo-noise in [-1, 1]
    const n =
      (Math.sin(x * 0.1 + 1.7) * Math.cos(z * 0.085 - 0.6) +
        0.5 * Math.sin(x * 0.21 - 0.9) * Math.cos(z * 0.17 + 1.2) +
        0.25 * Math.sin(x * 0.43 + 0.4) * Math.cos(z * 0.37 - 1.1)) / 1.75;
    const swell = 2.6 * _ss(28, 40, r); // gentle base rise out of the meadow
    const peaks = 11 * _ss(31, 54, r) * (0.5 + 0.5 * n); // ridges → summits
    // sit 0.12 below the flat ground plane so the coplanar centre never
    // z-fights with it — only the risen slopes break the surface
    const h = swell + peaks - 0.12;
    pos.setY(i, h);

    c.copy(grassC).lerp(rockC, _ss(6.5, 12.5, h)); // high ground turns rocky
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, toonMaterial(0xffffff, { vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
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
