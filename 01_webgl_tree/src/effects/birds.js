import * as THREE from "three";

// A small flock of birds wheeling across the sky on clear days. Each bird is a
// dark gull silhouette — a little body + two swept, tapered wings that rest in
// a shallow "M" and flap — following a gentle elliptical path and banking into
// its direction of travel. Flat dark shapes read cleanly against the sky.

const BIRD_MAT = new THREE.MeshBasicMaterial({ color: 0x33312e, side: THREE.DoubleSide });

// right wing: a swept, tapered quad in the local x–z plane (extends +x)
function wingGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    0.0, 0, 0.08,   // root front
    0.0, 0, -0.08,  // root back
    0.62, 0, -0.2,  // tip (swept back)
    0.54, 0, 0.02,  // tip front
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function bodyGeometry() {
  const g = new THREE.IcosahedronGeometry(0.12, 0);
  g.scale(0.8, 0.7, 2.4); // a slim body along the travel axis
  return g;
}

const REST = 0.32; // wings rest slightly raised → shallow gull "M"

function makeBird(wingGeo, bodyGeo) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, BIRD_MAT);
  const L = new THREE.Mesh(wingGeo, BIRD_MAT);
  const R = new THREE.Mesh(wingGeo, BIRD_MAT);
  R.scale.x = -1; // mirror to the left side
  g.add(body, L, R);
  g.userData.LR = [L, R];
  return g;
}

const _ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smoother = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10); };

const ENTRY_DIST = 26;   // how far off-screen an absent bird waits
const ENTER_RATE = 0.2;  // linear presence rate (eased) ≈5s for a graceful glide-in

export function makeBirds(count = 8) {
  const group = new THREE.Group();
  const wingGeo = wingGeometry();
  const bodyGeo = bodyGeometry();
  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = makeBird(wingGeo, bodyGeo);
    const sc = 0.5 + 0.22 * ((i * 7) % 3) / 2; // smaller gulls (≈0.5–0.72)
    b.scale.setScalar(sc);
    group.add(b);
    // each bird glides in from a different off-screen bearing (golden-angle spread)
    const bearing = i * 2.39996;
    birds.push({
      mesh: b,
      cx: -3 + (i % 3) * 4,
      cz: -3 + ((i * 5) % 6),
      rx: 6 + (i % 3) * 2.6,
      rz: 4 + (i % 2) * 2.2,
      h: 16.5 + (i % 4) * 1.7,
      spd: 0.16 + 0.05 * (i % 3),
      phase: i * 1.27,
      flap: 6.5 + (i % 3) * 1.5,
      ex: Math.cos(bearing), ez: Math.sin(bearing),
      baseScale: sc,
      threshold: 0.25 + 0.7 * (i / (count - 1)), // flock fills in as the tree grows
      l: 0,                                       // linear presence (eased into p)
    });
  }
  group.userData.noReflect = true;

  let lastT = null;

  // active = clear daylight (else they glide back off-screen); frac = growth reveal
  function update(t, active = true, frac = 1) {
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    for (const b of birds) {
      const target = active ? _ss(b.threshold - 0.16, b.threshold + 0.02, frac) : 0;
      b.l += Math.max(-ENTER_RATE * dt, Math.min(ENTER_RATE * dt, target - b.l));
      const p = smoother(b.l);
      b.mesh.visible = p > 0.003;
      if (!b.mesh.visible) continue;

      const off = (1 - p) * ENTRY_DIST;          // slide in from off-screen
      const a = t * b.spd + b.phase;
      const x = b.cx + Math.cos(a) * b.rx + b.ex * off;
      const z = b.cz + Math.sin(a) * b.rz + b.ez * off;
      const y = b.h + Math.sin(a * 2.0) * 0.7;
      b.mesh.position.set(x, y, z);
      // face direction of travel (tangent of the ellipse, a touch ahead)
      const a2 = a + 0.06;
      b.mesh.lookAt(b.cx + Math.cos(a2) * b.rx + b.ex * off, y, b.cz + Math.sin(a2) * b.rz + b.ez * off);
      // flap around the shallow gull rest pose
      const f = Math.sin(t * b.flap + b.phase) * 0.55;
      const [L, R] = b.mesh.userData.LR;
      L.rotation.z = REST + f;
      R.rotation.z = -(REST + f);
      b.mesh.scale.setScalar(b.baseScale); // constant size — no pop-in
    }
  }

  return { group, update };
}
