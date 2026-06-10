import * as THREE from "three";

// Butterflies that tour the wildflowers sipping nectar. Each one is two tiny
// flapping wing quads on a speck of a body. They flutter (wavy, bobbing flight)
// from bloom to bloom, hover-sip for a moment with slow wingbeats, then move on.
// Daytime + clear weather only (like the birds); they shrink away otherwise.

const WING_COLORS = [0xf2a541, 0xf6e7c1, 0xe98fb4, 0x9fd2f2, 0xf2d042, 0xe9eef2];

function makeButterfly(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const wingGeo = new THREE.PlaneGeometry(0.22, 0.16);
  wingGeo.translate(0.11, 0, 0); // hinge at the body
  const L = new THREE.Mesh(wingGeo, mat);
  const R = new THREE.Mesh(wingGeo, mat);
  L.rotation.z = Math.PI; // mirror to the left
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.14), new THREE.MeshBasicMaterial({ color: 0x3a3026 }));
  g.add(L, R, body);
  g.userData.wings = [L, R];
  return g;
}

export function makeButterflies(flowerSpots, count = 7) {
  const group = new THREE.Group();
  group.userData.noReflect = true;
  const flock = [];
  const spots = flowerSpots.length ? flowerSpots : [{ x: 0, y: 0.4, z: 6 }];
  const pick = () => spots[(Math.random() * spots.length) | 0];

  for (let i = 0; i < count; i++) {
    const b = makeButterfly(WING_COLORS[i % WING_COLORS.length]);
    const from = pick();
    b.position.set(from.x, from.y + 0.5, from.z);
    group.add(b);
    flock.push({
      mesh: b,
      target: pick(),
      state: "fly",       // fly → sip → fly …
      sipT: 0,
      phase: i * 1.7,
      flap: 14 + (i % 3) * 3,
      speed: 1.1 + (i % 3) * 0.25,
      scale: 0,           // eased presence (0 hidden … 1 out)
    });
  }

  let lastT = null;

  function update(t, active = true) {
    const dt = lastT == null ? 0 : Math.min(0.08, Math.max(0, t - lastT));
    lastT = t;

    for (const b of flock) {
      // presence: flutter out in clear daylight, shrink away at night / in rain
      b.scale += ((active ? 1 : 0) - b.scale) * Math.min(1, dt * 2.5);
      b.mesh.visible = b.scale > 0.02;
      if (!b.mesh.visible) continue;
      b.mesh.scale.setScalar(b.scale);

      const p = b.mesh.position;
      if (b.state === "sip") {
        b.sipT -= dt;
        // hover at the bloom: gentle bob, slow lazy wingbeats
        p.y += Math.sin(t * 6 + b.phase) * 0.0035;
        flapWings(b, t, 4.5);
        if (b.sipT <= 0) { b.target = pick(); b.state = "fly"; }
        continue;
      }

      // flutter toward the target bloom (hover point just above it)
      const tx = b.target.x, ty = b.target.y + 0.32, tz = b.target.z;
      const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.12) {
        b.state = "sip";
        b.sipT = 1.4 + Math.random() * 2.2;
        continue;
      }
      const step = Math.min(d, b.speed * dt);
      // wavy, bobbing path — butterflies never fly straight
      p.x += (dx / d) * step + Math.sin(t * 3.1 + b.phase) * dt * 0.5;
      p.z += (dz / d) * step + Math.cos(t * 2.6 + b.phase) * dt * 0.5;
      p.y += (dy / d) * step + Math.sin(t * 7 + b.phase) * dt * 0.9;
      b.mesh.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2; // face travel
      flapWings(b, t, b.flap);
    }
  }

  function flapWings(b, t, rate) {
    const a = 0.25 + Math.abs(Math.sin(t * rate + b.phase)) * 1.0;
    const [L, R] = b.mesh.userData.wings;
    L.rotation.y = a;
    R.rotation.y = -a;
  }

  return { group, update };
}
