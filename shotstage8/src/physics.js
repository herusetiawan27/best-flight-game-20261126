// Arcade flight model — physics.js
//
// The feel contract (from the overhaul spec):
//  - Input NEVER sets rotation. It commands an angular-velocity target;
//    the angular velocity is damped toward that target, and the attitude
//    integrates the velocity. Result: the nose answers at once but
//    settles like it has mass — no more "on rails".
//  - With no input, the angular-velocity target becomes a spring back
//    to level flight (gentle auto-level, scaled by difficulty assist).
//  - Banking rolls the heading around automatically (turn coordination):
//    heading rate follows sin(roll), scaled by speed authority.
//  - Speed is thrust vs drag: the throttle sets a target speed, spool-up
//    is slower than drag braking, and pitch exchanges speed for height
//    (climb bleeds speed, dive gains it — light gravity).
//  - Below the stall speed lift fades, sink grows mushy and a gentle
//    nose-down moment pitches the plane toward flying speed again.
//
// stepFlight(game, dt, ctrl) advances game.plane by one fixed step and
// maintains game.vs / game.stalled. ctrl = { pitch, roll, throttle }
// with pitch/roll as intent in -1..1 and throttle as a -1..1 rate.
import { FLIGHT } from './config.js';
import { clamp } from './random.js';

export function stepFlight(game, dt, ctrl) {
  const p = game.plane;
  const F = FLIGHT;
  const assist = game.assist || 1;

  // --- Throttle ------------------------------------------------------------
  p.throttle = clamp(p.throttle + ctrl.throttle * F.throttleRate * dt, 0, 1);

  // --- Angular velocity model ----------------------------------------------
  const pitchIn = clamp(ctrl.pitch, -1, 1);
  const rollIn = clamp(ctrl.roll, -1, 1);
  const stalled = p.speed < F.stallSpeed;
  const stallFactor = stalled ? clamp((F.stallSpeed - p.speed) / F.stallSpeed, 0, 1) : 0;

  let pitchVelTarget;
  if (pitchIn !== 0) {
    pitchVelTarget = pitchIn * F.maxPitchRate;
  } else {
    // No input: spring the attitude back to level.
    pitchVelTarget = -p.pitch * F.autoLevelPitch * assist;
  }
  // Stall: a gentle nose-down moment (never fights a deliberate pull-up).
  if (stalled && pitchIn <= 0) pitchVelTarget -= F.stallNoseDrop * stallFactor;

  let rollVelTarget;
  if (rollIn !== 0) {
    rollVelTarget = rollIn * F.maxRollRate;
  } else {
    rollVelTarget = -p.roll * F.autoLevelRoll * assist;
  }

  const kAng = 1 - Math.exp(-F.angularDamp * (0.7 + 0.3 * assist) * dt);
  p.pitchVel += (pitchVelTarget - p.pitchVel) * kAng;
  p.rollVel += (rollVelTarget - p.rollVel) * kAng;
  p.pitch += p.pitchVel * dt;
  p.roll += p.rollVel * dt;
  // Soft attitude caps: kill the outward velocity at the cap.
  if (p.pitch > F.maxPitch) { p.pitch = F.maxPitch; if (p.pitchVel > 0) p.pitchVel = 0; }
  if (p.pitch < -F.maxPitch) { p.pitch = -F.maxPitch; if (p.pitchVel < 0) p.pitchVel = 0; }
  if (p.roll > F.maxRoll) { p.roll = F.maxRoll; if (p.rollVel > 0) p.rollVel = 0; }
  if (p.roll < -F.maxRoll) { p.roll = -F.maxRoll; if (p.rollVel < 0) p.rollVel = 0; }

  // --- Speed: thrust vs drag + energy exchange ------------------------------
  const targetSpeed = F.idleSpeed + p.throttle * (F.maxSpeed - F.idleSpeed);
  const rate = targetSpeed > p.speed ? F.accelUp : F.accelDown;
  p.speed += clamp(targetSpeed - p.speed, -rate * dt, rate * dt);
  p.speed -= Math.sin(p.pitch) * F.energyExchange * dt; // climb bleeds, dive gains
  p.speed = clamp(p.speed, 6, F.maxSpeed + 6);

  // --- Turn coordination: bank -> yaw ---------------------------------------
  p.heading += Math.sin(p.roll) * F.turnFactor * (p.speed / F.turnSpeedRef) * dt;

  // --- Vertical: lift vs gravity, stall behaviour ----------------------------
  const lift = clamp((p.speed - 10) / (F.stallSpeed - 10), 0, 1) * F.gravitySink;
  let vsTarget = Math.sin(p.pitch) * p.speed * F.pitchClimb + lift - F.gravitySink;
  if (stalled) vsTarget -= (F.stallSpeed - p.speed) * F.stallSinkFactor;
  const kVs = 1 - Math.exp(-F.vsResponse * dt);
  game.vs += (vsTarget - game.vs) * kVs;
  game.stalled = stalled;

  // --- Integrate position -----------------------------------------------------
  const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
  p.x += fx * Math.cos(p.pitch) * p.speed * dt;
  p.z += fz * Math.cos(p.pitch) * p.speed * dt;
  p.y += game.vs * dt;
  if (p.y > F.ceiling) p.y = F.ceiling;
}
