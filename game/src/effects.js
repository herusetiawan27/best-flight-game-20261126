// Effects — effects.js
//
// Pooled juice: ring bursts, wingtip contrails, low-altitude spray,
// expanding water ripples, floating "+score" popups. All particles are
// WORLD-space points projected by the renderer, and the whole system is
// driven from the fixed-step simulation, so screenshot mode stays
// deterministic (the effect RNG is a fixed-seed mulberry32, reset with
// the game — never Math.random).
import { EFFECTS } from './config.js';
import { clamp, mulberry32 } from './random.js';
import { groundHeightAt } from './world.js';

export class Effects {
  constructor() {
    this.particles = [];
    for (let i = 0; i < EFFECTS.particleMax; i++) {
      this.particles.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        age: 0, life: 1, size: 2, grow: 0, r: 255, g: 255, b: 255,
        alpha: 0.5, grav: 0, drag: 0,
      });
    }
    this.popups = [];   // { x, y, z, text, sub, age, life }
    this.ripples = [];  // { x, z, age, life, maxR }
    this.rng = mulberry32(0x9e3779b9);
    this._acc = { contrail: 0, spray: 0, ripple: 0 };
  }

  clear() {
    for (const p of this.particles) p.alive = false;
    this.popups.length = 0;
    this.ripples.length = 0;
    this.rng = mulberry32(0x9e3779b9);
    this._acc = { contrail: 0, spray: 0, ripple: 0 };
  }

  spawn(o) {
    for (const p of this.particles) {
      if (!p.alive) { Object.assign(p, { alive: true, age: 0 }, o); return p; }
    }
    return null; // pool exhausted: drop silently
  }

  // Golden spark burst when a ring is threaded.
  burst(x, y, z, count = EFFECTS.ringBurstCount) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const up = (rng() - 0.35) * 9;
      const sp = 6 + rng() * 15;
      const gold = rng() < 0.72;
      this.spawn({
        x, y, z,
        vx: Math.cos(a) * sp, vy: up, vz: Math.sin(a) * sp,
        life: 0.5 + rng() * 0.55, size: 1.6 + rng() * 2.2, grow: -1.2,
        r: 255, g: gold ? 196 + Math.floor(rng() * 40) : 244, b: gold ? 60 : 220,
        alpha: 0.95, grav: -7, drag: 1.6,
      });
    }
  }

  // White water foam burst (touchdown, crash ditch).
  splash(x, y, z, count = 42, power = 1) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const sp = (2 + rng() * 8) * power;
      this.spawn({
        x: x + (rng() - 0.5) * 6, y, z: z + (rng() - 0.5) * 6,
        vx: Math.cos(a) * sp, vy: (3 + rng() * 7) * power, vz: Math.sin(a) * sp,
        life: 0.45 + rng() * 0.5, size: 1.8 + rng() * 2.6, grow: 2.5,
        r: 240, g: 250, b: 252, alpha: 0.85, grav: -16, drag: 0.8,
      });
    }
  }

  popup(x, y, z, text, sub = '') {
    this.popups.push({ x, y, z, text, sub, age: 0, life: EFFECTS.popupLife });
    if (this.popups.length > 6) this.popups.shift();
  }

  ripple(x, z, maxR = 15) {
    if (this.ripples.length >= EFFECTS.rippleMax) this.ripples.shift();
    this.ripples.push({ x, z, age: 0, life: 1.5, maxR });
  }

  // Advance everything by one fixed step; emit continuous effects
  // (contrails, spray, ripples) from the plane's situation.
  update(dt, game) {
    const E = EFFECTS;
    const p = game.plane;
    const rng = this.rng;

    for (const pt of this.particles) {
      if (!pt.alive) continue;
      pt.age += dt;
      if (pt.age >= pt.life) { pt.alive = false; continue; }
      pt.vy += pt.grav * dt;
      if (pt.drag) { const d = Math.max(0, 1 - pt.drag * dt); pt.vx *= d; pt.vy *= d; pt.vz *= d; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      if (pt.y < 0.15 && pt.vy < 0) { pt.y = 0.15; pt.vy = 0; } // settle on the water
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      pp.age += dt;
      if (pp.age >= pp.life) this.popups.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age >= r.life) this.ripples.splice(i, 1);
    }

    const flying = game.mode === 'playing' || game.mode === 'shot';
    const rolling = game.mode === 'landing';
    if (!flying && !rolling) return;

    // --- Wingtip contrails --------------------------------------------------
    if (flying && p.speed > E.contrailMinSpeed && game.phase !== 'done') {
      this._acc.contrail += E.contrailRate * dt * clamp(p.speed / 60, 0.4, 1.3);
      const rx = Math.cos(p.heading), rz = Math.sin(p.heading);
      const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
      while (this._acc.contrail >= 1) {
        this._acc.contrail -= 1;
        for (const s of [-1, 1]) {
          this.spawn({
            x: p.x + rx * s * 13 - fx * 2, y: p.y - 0.4, z: p.z + rz * s * 13 - fz * 2,
            vx: -fx * 4 + (rng() - 0.5) * 1.5, vy: -0.6, vz: -fz * 4 + (rng() - 0.5) * 1.5,
            life: 0.5 + rng() * 0.3, size: 1.5 + rng() * 1.4, grow: 3.2,
            r: 255, g: 252, b: 244, alpha: 0.34, grav: 0, drag: 0.4,
          });
        }
      }
    }

    // --- Spray + ripples while skimming the water ---------------------------
    const ground = groundHeightAt(game.world, p.x, p.z);
    const overWater = ground <= 0.6;
    const heightAboveWater = p.y - Math.max(0, ground);
    if (rolling || (overWater && p.speed > 14 && heightAboveWater < E.sprayAlt)) {
      const strength = rolling ? 1 : clamp(1 - heightAboveWater / E.sprayAlt, 0, 1);
      this._acc.spray += E.sprayRate * strength * dt;
      while (this._acc.spray >= 1) {
        this._acc.spray -= 1;
        const back = 4 + rng() * 7;
        this.spawn({
          x: p.x + (rng() - 0.5) * 9, y: rolling ? p.y - 0.7 : 0.4, z: p.z + (rng() - 0.5) * 9,
          vx: (rng() - 0.5) * 7 - Math.sin(p.heading) * back * 0.4,
          vy: 1.5 + rng() * 3.5 * strength,
          vz: (rng() - 0.5) * 7 + Math.cos(p.heading) * back * 0.4,
          life: 0.35 + rng() * 0.35, size: 1.4 + rng() * 2, grow: 2,
          r: 238, g: 248, b: 250, alpha: 0.7, grav: -13, drag: 0.6,
        });
      }
      if (overWater) {
        this._acc.ripple += E.rippleRate * (rolling ? 1.6 : strength) * dt;
        while (this._acc.ripple >= 1) {
          this._acc.ripple -= 1;
          this.ripple(p.x + (rng() - 0.5) * 8, p.z + (rng() - 0.5) * 8, 10 + rng() * 9);
        }
      }
    }
  }
}
