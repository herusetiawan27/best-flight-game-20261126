// Golden Strait Run — configuration constants.
export const W = 1280;
export const H = 720;
export const FOCAL = 620;          // perspective focal length (px)
export const RING_COUNT = 12;
export const RING_RADIUS = 30;     // metres
export const RING_SPACING = 210;   // metres between rings along the strait
export const RING_FIRST_Z = -260;  // z of first ring (north is -z)
export const START = { x: 0, y: 62, z: 170, heading: 0, speed: 46 };
export const RUNWAY = {
  // Filled in by world.js once the course is laid out; heading 0 = due north (-z).
  heading: 0,
  length: 260,
  width: 30,
  y: 3,
};
export const FLIGHT = {
  minSpeed: 0,
  maxSpeed: 78,          // m/s at full throttle
  idleSpeed: 14,
  accel: 9,              // m/s^2 toward throttle target
  stallSpeed: 24,        // below this, stall-lite sink kicks in
  gravitySink: 5.2,      // m/s baseline sink at cruise
  pitchResponse: 8.5,    // 1/s exponential rate: pitch eases to its target
  rollResponse: 10,      // 1/s exponential rate: roll eases to its target
  maxPitch: 0.5,
  maxRoll: 0.95,
  turnFactor: 0.55,      // heading change per radian of bank
};
export const LANDING = {
  maxSpeed: 30,          // m/s
  minSink: -6.5,         // m/s (vertical speed must be gentler than this)
  maxAlignDeg: 18,
};
export const COLORS = {
  gold: '#ffd257',
  goldBright: '#fff3b0',
  sea: '#12a5b4',
  seaDeep: '#0b6e8c',
  sand: '#f4dc9a',
  green: '#2e9e5b',
  greenDark: '#1d7a43',
};
