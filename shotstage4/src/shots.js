// Deterministic screenshot mode.
//
// When the URL contains ?shot=<scene>&seed=<n>, main.js builds the world
// from the seed, applies the scene setup below, runs a FIXED-STEP
// simulation (dt = 1/60) driven by the autopilot for a scene-specific
// number of steps, renders exactly one frame and sets
// window.__shotReady = true. No input, no audio, no randomness beyond
// the seeded world — same seed + scene always yields the same frame.
//
// Step counts per scene (at 60 steps/second of sim time):
//   cover    : 100 steps (~1.7 s) — plane settles onto the course,
//              first golden ring large ahead, islands either side.
//   rings    : 240 steps (~4.0 s) — plane placed mid-strait before the
//              run, autopilot lines up on the ring sequence; several
//              rings visible ahead with the lighthouse island in frame.
//   approach : 430 steps (~7.2 s) — plane placed on final, intercepting
//              the runway centreline, descending gently; by the last frame
//              the strip is fully ahead of it, big and unmissable.
//   title    :  90 steps (~1.5 s) — like cover, then the title overlay
//              is rendered over the live scene.
import { START } from './config.js';

export const SHOT_SCENES = {
  cover: { steps: 100 },
  rings: { steps: 240 },
  approach: { steps: 430 },
  title: { steps: 90 },
};

export function parseShotParams() {
  const q = new URLSearchParams(window.location.search);
  const scene = q.get('shot');
  if (!scene || !(scene in SHOT_SCENES)) return null;
  const seedRaw = parseInt(q.get('seed') || '1', 10);
  const seed = Number.isFinite(seedRaw) ? seedRaw : 1;
  return { scene, seed, steps: SHOT_SCENES[scene].steps };
}

// Adjust the freshly-created game state for the scene, before stepping.
// `game` exposes: plane, currentRing, phase, world.
export function setupShotScene(game, scene) {
  const { plane, world } = game;
  if (scene === 'rings') {
    // Start just south of ring 4, on the course line, so rings 4..8 and
    // the lighthouse island (west of ring ~4) are all ahead in frame.
    const r = world.rings[4];
    plane.x = r.x - 6;
    plane.z = r.z + 300;
    plane.y = r.y + 14;
    plane.heading = r.heading;
    plane.speed = 48;
    plane.throttle = 0.62;
    game.currentRing = 4;
    for (let i = 0; i < 4; i++) { world.rings[i].passed = true; world.rings[i].hit = true; }
    game.score = 480;
    game.elapsed = 38;
  } else if (scene === 'approach') {
    // On final: south of the runway, low and slowing, autopilot flies the
    // descent to the threshold. The plane starts ~90 m east of the
    // centreline so the strip reads ahead beside the nose (not hidden
    // behind the fuselage) while the autopilot corrects back onto it.
    const ap = world.runway.approach;
    plane.x = ap.x + 90;
    plane.z = ap.z + 60;
    plane.y = ap.y + 8;
    plane.heading = 0;
    plane.speed = 34;
    plane.throttle = 0.34;
    game.currentRing = world.rings.length;
    for (const r of world.rings) { r.passed = true; r.hit = true; }
    game.phase = 'runway';
    game.score = 1180;
    game.elapsed = 96;
  } else {
    // cover / title: default start from config.
    plane.x = START.x; plane.y = START.y; plane.z = START.z;
    plane.heading = START.heading; plane.speed = START.speed;
    plane.throttle = 0.66;
  }
}
