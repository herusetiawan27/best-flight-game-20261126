// Camera — camera.js
//
// Three modes, cycled with C:
//  - chase   : spring-lagged follow behind/above the plane (position and
//              attitude ease toward the ideal pose, so the plane breathes
//              inside the frame instead of being bolted to it). The FOV
//              widens (focal shrinks) as the throttle opens, and a small
//              shake fades in at boost throttle.
//  - cockpit : camera in the pilot's seat; the plane sprite is hidden and
//              the renderer draws a cockpit frame + larger instruments.
//  - orbit   : slow circling side view around the still-flyable plane.
//
// In screenshot mode update() is called with snap=true: the camera jumps
// straight to the ideal chase pose so shot framing stays deterministic.
import { CAMERA, FOCAL } from './config.js';
import { clamp, angDiff } from './random.js';

function basisFromFwd(f) {
  // right = normalize(cross(fwd, worldUp)); up = cross(right, fwd).
  // cross(fwd, (0,1,0)) = (-fwd.z, 0, fwd.x) — matches render.js basis.
  const rx = -f.z, ry = 0, rz = f.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const right = { x: rx / rl, y: ry / rl, z: rz / rl };
  const up = {
    x: right.y * f.z - right.z * f.y,
    y: right.z * f.x - right.x * f.z,
    z: right.x * f.y - right.y * f.x,
  };
  return { right, up };
}

export class Camera {
  constructor() {
    this.mode = 'chase'; // chase | cockpit | orbit
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.boost = 0;      // smoothed FOV-kick amount 0..1
    this.focal = FOCAL;
    this.shakeX = 0; this.shakeY = 0;
    this.ready = false;
    this.view = null;
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : this.mode === 'cockpit' ? 'orbit' : 'chase';
    this.ready = false; // re-snap on mode change to avoid a swoop
    return this.mode;
  }

  update(plane, dt, time, snap) {
    const C = CAMERA;
    let fwd, pos;

    if (this.mode === 'cockpit') {
      const cp = Math.cos(plane.pitch * 0.85), sp = Math.sin(plane.pitch * 0.85);
      fwd = { x: Math.sin(plane.heading) * cp, y: sp, z: -Math.cos(plane.heading) * cp };
      pos = { x: plane.x, y: plane.y + 1.6, z: plane.z };
      this.focal = FOCAL * C.cockpitFov;
      this.shakeX = 0; this.shakeY = 0;
    } else if (this.mode === 'orbit') {
      const a = time * C.orbitSpeed;
      pos = {
        x: plane.x + Math.sin(a) * C.orbitRadius,
        y: plane.y + C.orbitHeight,
        z: plane.z + Math.cos(a) * C.orbitRadius,
      };
      const dx = plane.x - pos.x, dy = (plane.y + 1) - pos.y, dz = plane.z - pos.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      fwd = { x: dx / l, y: dy / l, z: dz / l };
      this.focal = FOCAL;
      this.shakeX = 0; this.shakeY = 0;
    } else {
      // --- chase ------------------------------------------------------------
      const desiredYaw = plane.heading;
      const desiredPitch = plane.pitch * 0.55;
      if (snap || !this.ready || dt <= 0) {
        this.yaw = desiredYaw; this.pitch = desiredPitch;
      } else {
        const k = 1 - Math.exp(-C.attLag * dt);
        this.yaw += angDiff(desiredYaw, this.yaw) * k;
        this.pitch += (desiredPitch - this.pitch) * k;
      }
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      fwd = { x: Math.sin(this.yaw) * cp, y: sp, z: -Math.cos(this.yaw) * cp };
      const ideal = {
        x: plane.x - fwd.x * C.chaseDist,
        y: plane.y - fwd.y * C.chaseDist + C.chaseHeight,
        z: plane.z - fwd.z * C.chaseDist,
      };
      if (snap || !this.ready || dt <= 0) {
        pos = ideal;
      } else {
        const k = 1 - Math.exp(-C.posLag * dt);
        pos = {
          x: this.x + (ideal.x - this.x) * k,
          y: this.y + (ideal.y - this.y) * k,
          z: this.z + (ideal.z - this.z) * k,
        };
      }
      // FOV kick from throttle + boost shake (time-based, so a given
      // sim time always shakes the same way; shot throttles stay low).
      const boostTarget = clamp((plane.throttle - 0.55) / 0.45, 0, 1);
      if (snap || dt <= 0) this.boost = boostTarget;
      else this.boost += (boostTarget - this.boost) * (1 - Math.exp(-C.fovLag * dt));
      this.focal = FOCAL * (1 - C.fovKick * this.boost);
      const sh = clamp((plane.throttle - C.shakeThrottle) / (1 - C.shakeThrottle), 0, 1) * C.shakeMax;
      this.shakeX = sh * (Math.sin(time * 47.3) * 0.6 + Math.sin(time * 31.7 + 1.3) * 0.4);
      this.shakeY = sh * (Math.sin(time * 39.1 + 0.7) * 0.6 + Math.sin(time * 53.9 + 2.1) * 0.4);
    }

    if (pos.y < 4) pos.y = 4; // keep the camera above the waves visually
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.ready = true;
    const { right, up } = basisFromFwd(fwd);
    this.view = {
      x: pos.x, y: pos.y, z: pos.z, fwd, right, up,
      focal: this.focal, shakeX: this.shakeX, shakeY: this.shakeY,
      mode: this.mode, yaw: this.yaw, pitch: this.pitch,
    };
    return this.view;
  }
}
