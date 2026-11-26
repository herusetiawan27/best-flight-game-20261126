// World generation: the tropical strait, islands, lighthouse, boats,
// the ring course and the coastal runway. Everything is derived from a
// seeded RNG, so the same seed always produces the same world.
import { RING_COUNT, RING_RADIUS, RING_SPACING, RING_FIRST_Z, RUNWAY } from './config.js';
import { mulberry32, rngRange, rngInt } from './random.js';

// The course weaves gently down the strait. Ring i sits at
// z = RING_FIRST_Z - i*RING_SPACING, x following a smooth S-curve.
export function courseX(z) {
  return Math.sin(z * 0.0016) * 95 + Math.sin(z * 0.00045 + 1.2) * 55;
}

export function buildWorld(seed) {
  const rng = mulberry32(seed);

  // --- Rings -------------------------------------------------------------
  const rings = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const z = RING_FIRST_Z - i * RING_SPACING;
    const x = courseX(z);
    const y = 58 + Math.sin(i * 0.9) * 16 + rngRange(rng, -4, 4);
    // Tangent of the course at this ring -> ring faces along the course.
    // Ahead point is 10 m further north (z-10); heading = atan2(dx, -dz).
    const dx = courseX(z - 10) - courseX(z + 10);
    const heading = Math.atan2(dx, 20);
    rings.push({ i, x, y, z, r: RING_RADIUS, heading, passed: false, hit: false });
  }

  // --- Runway: on the coast island just past the last ring ----------------
  const last = rings[rings.length - 1];
  const runway = {
    x: last.x + 10,
    z: last.z - 330,           // centre of the strip
    heading: RUNWAY.heading,    // due north
    length: RUNWAY.length,
    width: RUNWAY.width,
    y: RUNWAY.y,
  };
  // Approach point: 420 m south of the threshold, on the centreline.
  runway.approach = { x: runway.x, y: 46, z: runway.z + runway.length / 2 + 420 };
  runway.thresholdZ = runway.z + runway.length / 2; // southern (near) end

  // --- Islands ------------------------------------------------------------
  // Hand-placed hero islands (so screenshots always frame well) plus
  // seeded scatter islands further out.
  const islands = [];
  function island(x, z, r, h, opts = {}) {
    const trees = [];
    const n = rngInt(rng, 5, 10);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, d = rng() * r * 0.55;
      trees.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: rngRange(rng, 0.7, 1.4) });
    }
    islands.push({ x, z, r, h, trees, ...opts });
  }
  island(-215, -420, 130, 15);                 // west of ring 1-2
  island(250, -700, 150, 19);
  island(-265, -1080, 165, 22, { lighthouse: true }); // lighthouse island, mid-course
  island(285, -1420, 140, 16);
  island(-240, -1780, 150, 20);
  island(255, -2080, 135, 14);
  island(runway.x, runway.z - 40, 235, 10, { runwayIsland: true }); // finale island
  island(-330, -2620, 120, 12);
  // Seeded scatter, kept clear of the course corridor.
  for (let k = 0; k < 14; k++) {
    const z = rngRange(rng, 260, -2900);
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * rngRange(rng, 330, 620);
    island(x, z, rngRange(rng, 60, 130), rngRange(rng, 7, 20));
  }

  // Lighthouse stands on its island's shore point nearest the strait.
  const lhIsland = islands.find((i) => i.lighthouse);
  const lighthouse = {
    x: lhIsland.x + lhIsland.r * 0.62,
    z: lhIsland.z + 18,
    baseY: lhIsland.h * 0.55,
    height: 46,
  };

  // --- Boats ---------------------------------------------------------------
  const boats = [];
  const boatSpots = [
    { x: 95, z: -560 }, { x: -130, z: -900 }, { x: 120, z: -1300 },
    { x: -95, z: -1660 }, { x: 140, z: -1980 }, { x: -120, z: -2320 },
    { x: 70, z: -180 },
  ];
  for (const s of boatSpots) {
    boats.push({
      x: s.x + rngRange(rng, -18, 18),
      z: s.z + rngRange(rng, -18, 18),
      heading: rngRange(rng, 0, Math.PI * 2),
      sail: rng() < 0.6,
      hue: rngInt(rng, 0, 3),
    });
  }

  // Clouds: soft blobs drifting high above the strait.
  const clouds = [];
  for (let k = 0; k < 16; k++) {
    clouds.push({
      x: rngRange(rng, -700, 700), y: rngRange(rng, 130, 210),
      z: rngRange(rng, 300, -3000), s: rngRange(rng, 40, 110),
    });
  }

  return { seed, rings, runway, islands, lighthouse, boats, clouds };
}

// Ground height at a point: sea level 0, or island height inside an island
// (smooth-ish dome falloff). Used for crash detection.
export function groundHeightAt(world, x, z) {
  const rw = world.runway;
  // On the strip itself the ground is the runway surface.
  if (Math.abs(x - rw.x) <= rw.width / 2 + 3 && Math.abs(z - rw.z) <= rw.length / 2 + 3) {
    return rw.y;
  }
  // The approach corridor south of the runway is flattened headland.
  const inCorridor = Math.abs(x - rw.x) < 100 && z > rw.z - 330 && z < rw.z + 300;
  let g = 0;
  for (const isl of world.islands) {
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < isl.r) {
      const t = 1 - d / isl.r;
      let h = isl.h * (0.35 + 0.65 * t * t) + 1.2;
      if (isl.runwayIsland && inCorridor) h = Math.min(h, rw.y - 0.5);
      if (h > g) g = h;
    }
  }
  return g;
}

// Is (x,z) over the runway strip (with a small margin)?
export function overRunway(world, x, z) {
  const rw = world.runway;
  return Math.abs(x - rw.x) <= rw.width / 2 + 2 &&
         Math.abs(z - rw.z) <= rw.length / 2 + 2;
}
