import * as THREE from "three";
import { windUniforms, instancedBillboardMaterial } from "../materials.js";
import { makeFirSprig } from "../textures.js";

// Touch interactions that make the diorama feel alive under the finger:
//   • tap the pond  -> a ripple ring spreads from the tap point
//   • tap the cedar -> the tree shudders and sheds a burst of leaves
//
// main.js owns the pointer events and feeds taps in here; the realtime mode
// calls update() once per frame so the shaken tree settles and the loose
// leaves fall (drifting with whatever the scene's wind is doing).

const LEAF_POOL = 42;
const LEAF_LIFE = 14; // hard cap on a leaf's airtime (seconds)

export function makeInteractions(ctx) {
  const raycaster = new THREE.Raycaster();

  // ---- tree shake ----------------------------------------------------------
  let shaken = null; // the tree group currently wobbling
  let shakeStart = 0;
  const shakeAxis = new THREE.Vector2(1, 0);

  // ---- falling leaves ------------------------------------------------------
  // A recycled pool of foliage-sprig billboards (same sprite as the canopy),
  // animated on the CPU: they flutter down, ride the wind, then fade out on
  // the ground by shrinking (per-instance alpha isn't worth a custom shader).
  const leafMat = instancedBillboardMaterial(makeFirSprig("#a8c46e", "#33502f", 64));
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMat, LEAF_POOL);
  leaves.userData.skipNormal = true;
  leaves.frustumCulled = false;
  leaves.castShadow = false;

  const pool = [];
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  // bright top-of-canopy greens, so loose leaves read against the dark skirts
  const midGreen = new THREE.Color(0x8fb45e);
  const topWarm = new THREE.Color(0xcfe08a);
  for (let i = 0; i < LEAF_POOL; i++) {
    pool.push({ on: false, x: 0, y: 0, z: 0, s: 0, born: 0, fall: 0, rest: 0, phase: Math.random() * Math.PI * 2 });
    _s.set(0, 0, 0);
    _m.compose(_p, _q, _s);
    leaves.setMatrixAt(i, _m);
    leaves.setColorAt(i, _c.copy(midGreen).lerp(topWarm, Math.random()));
  }
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

  // Trunk axis + tap radius of the active tree, growth-aware. The cedar
  // carries userData.height; anything else falls back to its bounding box.
  const _box = new THREE.Box3();
  function treeMetrics(tree) {
    const p = tree.getWorldPosition(new THREE.Vector3());
    let h = 0;
    if (tree.userData.height) {
      h = tree.userData.height * tree.scale.y;
    } else {
      _box.setFromObject(tree);
      if (!_box.isEmpty()) h = Math.max(0, _box.max.y - p.y);
    }
    h = Math.max(h, 1.2);
    return { p, h, r: Math.min(3.8, Math.max(1.0, h * 0.27)) };
  }

  function burstLeaves(metrics, time) {
    // a young tree is still bare twigs — nothing to shed until the canopy
    // has actually budded in; after that, more foliage = more loose leaves
    const grown = ctx.growthReveal == null ? 1 : ctx.growthReveal;
    if (grown < 0.3) return;
    let want = Math.round(16 * grown);
    for (const leaf of pool) {
      if (want <= 0) break;
      if (leaf.on) continue;
      want--;
      // spawn at the canopy cone's outer edge (higher up = tighter radius), so
      // the leaves fall against the sky/meadow instead of inside the dark crown
      const f = 0.3 + Math.random() * 0.45;
      const R = Math.max(0.2, metrics.r * Math.pow(1 - f, 0.7) * 1.1);
      const rr = R * (0.8 + 0.3 * Math.random());
      const ang = Math.random() * Math.PI * 2;
      leaf.on = true;
      leaf.x = metrics.p.x + Math.cos(ang) * rr;
      leaf.y = metrics.p.y + metrics.h * f;
      leaf.z = metrics.p.z + Math.sin(ang) * rr;
      leaf.s = 0.4 + Math.random() * 0.3;
      leaf.fall = 1.1 + Math.random() * 0.8;
      leaf.rest = 0;
      leaf.born = time;
    }
  }

  // ---- tap dispatch --------------------------------------------------------
  const _ndc = new THREE.Vector2();
  const _segA = new THREE.Vector3();
  const _segB = new THREE.Vector3();
  const _hit = new THREE.Vector3();

  function tap(ndcX, ndcY, time) {
    raycaster.setFromCamera(_ndc.set(ndcX, ndcY), ctx.pixel.camera);
    const ray = raycaster.ray;

    // 1) the pond first — it is an exact surface test, while the tree below is
    //    a generous cylinder whose footprint overlaps the pond's back shore
    const water = ctx.world.water;
    if (Math.abs(ray.direction.y) > 1e-4) {
      const t = (water.y - ray.origin.y) / ray.direction.y;
      if (t > 0) {
        _hit.copy(ray.origin).addScaledVector(ray.direction, t);
        if (water.containsPoint(_hit.x, _hit.z)) {
          water.addRipple(_hit.x, _hit.z);
          return "water";
        }
      }
    }

    // 2) the tree: distance from the pick ray to the trunk axis (a billboard
    //    canopy has no honest mesh to raycast, so a cylinder test it is)
    const tree = ctx.activeTreeGroup || ctx.tree;
    if (tree && tree.visible) {
      const m = treeMetrics(tree);
      _segA.copy(m.p);
      _segB.set(m.p.x, m.p.y + m.h, m.p.z);
      if (ray.distanceSqToSegment(_segA, _segB) < m.r * m.r) {
        shaken = tree;
        shakeStart = time;
        const a = Math.random() * Math.PI * 2;
        shakeAxis.set(Math.cos(a), Math.sin(a));
        burstLeaves(m, time);
        return "tree";
      }
    }
    return null;
  }

  // ---- per-frame -----------------------------------------------------------
  let lastT = null;
  function update(time) {
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, time - lastT));
    lastT = time;

    // shaken tree: a quick damped wobble around its base
    if (shaken) {
      const age = time - shakeStart;
      const amp = 0.05 * Math.exp(-2.1 * age);
      if (amp < 0.0015 || !shaken.visible) {
        shaken.rotation.x = 0;
        shaken.rotation.z = 0;
        shaken = null;
      } else {
        const rot = Math.sin(age * 17) * amp;
        shaken.rotation.x = shakeAxis.y * rot;
        shaken.rotation.z = shakeAxis.x * rot;
      }
    }

    // leaves: flutter down, drift with the scene's wind, settle and fade
    const windDir = windUniforms.uWindDir.value;
    const windStr = windUniforms.uWindStrength.value;
    let dirty = false;
    for (let i = 0; i < pool.length; i++) {
      const leaf = pool[i];
      if (!leaf.on) continue;
      if (leaf.y > 0.1) {
        leaf.y -= leaf.fall * dt;
        leaf.x += (Math.sin(time * 1.8 + leaf.phase) * 0.5 + windDir.x * windStr * 4.0) * dt;
        leaf.z += (Math.cos(time * 1.4 + leaf.phase) * 0.4 + windDir.y * windStr * 4.0) * dt;
      } else {
        leaf.rest += dt;
      }
      // fade out after settling on the ground, or as airtime runs out (so a
      // leaf never pops mid-air when it hits the lifetime cap)
      const groundFade = leaf.rest > 0.4 ? 1 - (leaf.rest - 0.4) : 1;
      const airFade = Math.min(1, LEAF_LIFE - (time - leaf.born));
      const fade = Math.min(groundFade, airFade);
      const expired = fade <= 0;
      if (expired) {
        leaf.on = false;
        _s.set(0, 0, 0);
      } else {
        _s.set(leaf.s * fade, leaf.s * fade, 1);
      }
      _p.set(leaf.x, leaf.y, leaf.z);
      _m.compose(_p, _q, _s);
      leaves.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) leaves.instanceMatrix.needsUpdate = true;
  }

  return {
    leaves, tap, update,
    debug: () => ({
      leaves: pool.filter((l) => l.on).map((l) => [l.x, l.y, l.z].map((v) => +v.toFixed(2))),
    }),
  };
}
