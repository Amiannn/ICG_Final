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

export function makeBirds(count = 8) {
  const group = new THREE.Group();
  const wingGeo = wingGeometry();
  const bodyGeo = bodyGeometry();
  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = makeBird(wingGeo, bodyGeo);
    const sc = 1.1 + 0.5 * ((i * 7) % 3) / 2;
    b.scale.setScalar(sc);
    group.add(b);
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
    });
  }
  group.userData.noReflect = true;

  function update(t) {
    for (const b of birds) {
      const a = t * b.spd + b.phase;
      const x = b.cx + Math.cos(a) * b.rx;
      const z = b.cz + Math.sin(a) * b.rz;
      const y = b.h + Math.sin(a * 2.0) * 0.7;
      b.mesh.position.set(x, y, z);
      // face direction of travel (tangent of the ellipse, a touch ahead)
      const a2 = a + 0.06;
      b.mesh.lookAt(b.cx + Math.cos(a2) * b.rx, y, b.cz + Math.sin(a2) * b.rz);
      // flap around the shallow gull rest pose
      const f = Math.sin(t * b.flap + b.phase) * 0.55;
      const [L, R] = b.mesh.userData.LR;
      L.rotation.z = REST + f;
      R.rotation.z = -(REST + f);
    }
  }
  return { group, update };
}
