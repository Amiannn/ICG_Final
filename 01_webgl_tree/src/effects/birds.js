import * as THREE from "three";

// A small flock of birds wheeling across the sky on clear days. Each bird is a
// dark two-triangle "V" that flaps its wings and follows a gentle elliptical
// path, banking into the direction of travel. Kept as flat silhouettes so they
// read cleanly against the sky in the pixel-art style.

const BIRD_MAT = new THREE.MeshBasicMaterial({ color: 0x3a3631, side: THREE.DoubleSide });

function wingGeometry() {
  // a thin triangle extending along +z (the wing), hinged at the body (x≈0)
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0.1, 0, 0, -0.1, 0, 0, -0.02, 0, 0.62], 3),
  );
  g.computeVertexNormals();
  return g;
}

function makeBird(geo) {
  const g = new THREE.Group();
  const L = new THREE.Mesh(geo, BIRD_MAT);
  const R = new THREE.Mesh(geo, BIRD_MAT);
  R.scale.z = -1; // mirror wing to the other side
  g.add(L, R);
  g.userData.LR = [L, R];
  return g;
}

export function makeBirds(count = 8) {
  const group = new THREE.Group();
  const geo = wingGeometry();
  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = makeBird(geo);
    const sc = 1.0 + 0.4 * ((i * 7) % 3) / 2;
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
      // face the direction of travel (tangent of the ellipse, a touch ahead)
      const a2 = a + 0.06;
      b.mesh.lookAt(b.cx + Math.cos(a2) * b.rx, y, b.cz + Math.sin(a2) * b.rz);
      // flap
      const f = Math.sin(t * b.flap + b.phase) * 0.7;
      const [L, R] = b.mesh.userData.LR;
      L.rotation.x = f;
      R.rotation.x = f;
    }
  }
  return { group, update };
}
