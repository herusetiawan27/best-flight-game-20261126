// Golden Strait Run — ALL tunables live in this one CONFIG object.
// Sections: view, course, runway, flight (physics & handling), landing,
// camera, effects, audio, difficulty, medals, colors. The flat exports
// at the bottom are legacy aliases for the other modules.
export const CONFIG = {
  view: {
    width: 1280,
    height: 720,
    focal: 620,            // perspective focal length (px) at rest
  },
  course: {
    ringCount: 12,
    ringRadius: 30,        // metres (scaled by difficulty)
    ringSpacing: 210,      // metres between rings along the strait
    ringFirstZ: -260,      // z of first ring (north is -z)
    start: { x: 0, y: 62, z: 170, heading: 0, speed: 46 },
  },
  runway: {
    heading: 0,            // due north; world.js places the strip
    length: 260,
    width: 30,
    y: 3,
  },

  // --- Arcade flight model -------------------------------------------------
  // Input never sets rotation directly: it commands an angular velocity
  // target, the angular velocity is damped toward it, and attitude
  // integrates the result. Banking feeds yaw (turn coordination).
  // Speed is thrust vs drag with an energy exchange against pitch.
  flight: {
    idleSpeed: 14,         // m/s at zero throttle
    maxSpeed: 78,          // m/s at full throttle
    accelUp: 7.5,          // m/s^2 spool-up rate toward throttle target
    accelDown: 12,         // m/s^2 drag braking toward throttle target
    energyExchange: 6.0,   // m/s^2 bled climbing / gained diving (gravity)
    maxPitchRate: 1.25,    // rad/s nose up/down at full input
    maxRollRate: 2.1,      // rad/s bank rate at full input
    angularDamp: 9,        // 1/s: angular velocity eases to its target
    autoLevelPitch: 1.7,   // 1/s spring back to level pitch, no input
    autoLevelRoll: 2.4,    // 1/s spring back to wings level, no input
    maxPitch: 0.52,        // rad soft cap on attitude
    maxRoll: 1.0,          // rad soft cap on bank
    turnFactor: 0.55,      // heading rate per radian of bank (coordination)
    turnSpeedRef: 40,      // m/s reference for turn authority scaling
    stallSpeed: 24,        // m/s: below this, lift fades + stall behaviour
    gravitySink: 5.2,      // m/s baseline sink the lift must overcome
    pitchClimb: 1.0,       // coupling: sin(pitch)*speed -> vertical speed
    stallSinkFactor: 0.34, // extra sink per m/s below stall speed
    stallNoseDrop: 0.5,    // rad/s gentle nose-down moment when stalled
    vsResponse: 9,         // 1/s: vertical speed eases to its computed value
    ceiling: 190,          // m soft ceiling
    throttleRate: 0.55,    // throttle change per second at full W/S input
  },
  landing: {
    maxSpeed: 30,          // m/s touchdown limit (scaled by difficulty)
    minSink: -6.5,         // m/s: sink must be gentler than this
    maxAlignDeg: 18,       // heading alignment limit (scaled by difficulty)
    rolloutTime: 1.7,      // s of water-taxi roll-out before the results
    bounceGain: 0.16,      // bounce height per m/s of touchdown sink
    decel: 9,              // m/s^2 roll-out deceleration
    // Rating bands (Perfect / Good / Rough) judged at touchdown:
    perfectSpeed: 24,      // m/s at or below -> speed points full
    perfectSink: -2.8,     // m/s sink at or above -> flare points full
    goodSpeed: 28,
    goodSink: -4.8,
  },
  camera: {
    chaseDist: 21,         // m behind the plane
    chaseHeight: 7.5,      // m above the plane's line
    posLag: 7,             // 1/s chase position spring (lower = lazier)
    attLag: 6,             // 1/s chase attitude spring
    fovKick: 0.16,         // focal shrink at full boost (wider FOV feel)
    fovLag: 3.5,           // 1/s FOV easing
    shakeMax: 5,           // px of shake at full boost
    shakeThrottle: 0.86,   // shake starts above this throttle
    orbitRadius: 27,       // m orbit camera distance
    orbitSpeed: 0.22,      // rad/s orbit sweep
    orbitHeight: 6,        // m above the plane
    cockpitFov: 1.06,      // focal multiplier in cockpit view
  },
  effects: {
    particleMax: 600,      // pooled particle cap
    ringBurstCount: 46,    // sparks per ring pass
    contrailRate: 46,      // particles/s per wingtip at cruise
    contrailMinSpeed: 26,  // m/s before contrails appear
    sprayAlt: 11,          // m above water: spray + ripples below this
    sprayRate: 90,         // particles/s at full spray
    rippleRate: 7,         // ripples/s while skimming / rolling out
    rippleMax: 40,         // pooled ripple cap
    popupLife: 1.25,       // s a "+score" popup floats
    speedLineSpeed: 62,    // m/s where speed lines fade in
    comboWindow: 14,       // s to keep a combo alive between rings
    comboScoreStep: 25,    // bonus points per combo level on a ring
  },
  audio: {
    masterLevel: 0.9,
    engineLevel: 0.06,
    windLevel: 0.11,       // wind noise at full speed
    waterLevel: 0.10,      // water lap noise at the surface
    musicLevel: 0.045,     // ambient pad loop level
    dingBase: 1318,        // Hz, combo 0 ring ding
    dingStepSemis: 2,      // semitones the ding rises per combo level
  },
  // Difficulty: ring size, assist strength (auto-level + damping help),
  // and explicit landing limits. Note Pro tightens alignment and sink,
  // not touchdown speed below the stall — a final flown at the stall
  // speed cannot be landed by anyone.
  difficulty: {
    santai: { label: 'SANTAI', ringScale: 1.35, assist: 1.5, landing: { maxSpeed: 34, minSink: -8.0, maxAlignDeg: 24 } },
    normal: { label: 'NORMAL', ringScale: 1.0, assist: 1.0, landing: { maxSpeed: 30, minSink: -6.5, maxAlignDeg: 18 } },
    pro: { label: 'PRO', ringScale: 0.78, assist: 0.55, landing: { maxSpeed: 27, minSink: -5.5, maxAlignDeg: 13 } },
  },
  medals: {
    goldTime: 80,          // s, with all rings -> Gold
    goldCombo: 5,          // best combo also needed for Gold
    silverTime: 115,       // s
    silverRings: 10,       // rings also needed for Silver
  },
  colors: {
    gold: '#ffd257',
    goldBright: '#fff3b0',
    sea: '#12a5b4',
    seaDeep: '#0b6e8c',
    sand: '#f4dc9a',
    green: '#2e9e5b',
    greenDark: '#1d7a43',
  },
};

// --- Legacy flat aliases (other modules import these) ----------------------
export const W = CONFIG.view.width;
export const H = CONFIG.view.height;
export const FOCAL = CONFIG.view.focal;
export const RING_COUNT = CONFIG.course.ringCount;
export const RING_RADIUS = CONFIG.course.ringRadius;
export const RING_SPACING = CONFIG.course.ringSpacing;
export const RING_FIRST_Z = CONFIG.course.ringFirstZ;
export const START = CONFIG.course.start;
export const RUNWAY = CONFIG.runway;
export const FLIGHT = CONFIG.flight;
export const LANDING = CONFIG.landing;
export const CAMERA = CONFIG.camera;
export const EFFECTS = CONFIG.effects;
export const AUDIO = CONFIG.audio;
export const DIFFICULTY = CONFIG.difficulty;
export const MEDALS = CONFIG.medals;
export const COLORS = CONFIG.colors;
