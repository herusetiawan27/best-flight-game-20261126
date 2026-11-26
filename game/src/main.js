// Golden Strait Run — main game logic: flight model, ring course,
// landing / crash rules, screens, autopilot (for screenshot mode),
// and the normal requestAnimationFrame loop.
import { W, H, START, LANDING } from './config.js';
import { buildWorld, groundHeightAt, overRunway } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { stepFlight } from './physics.js';
import { clamp, angDiff } from './random.js';
import { parseShotParams, setupShotScene } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;

const shot = parseShotParams();
const seed = shot ? shot.seed : (parseInt(new URLSearchParams(window.location.search).get('seed') || '7', 10) || 7);

class Game {
  constructor() {
    this.world = buildWorld(seed);
    this.renderer = new Renderer(ctx);
    this.audio = new AudioEngine();
    this.input = shot ? null : new Input(canvas);
    this.reset();
    this.mode = 'title'; // title | playing | paused | success | crashed
    this.time = 0;
  }

  reset() {
    const w = this.world;
    for (const r of w.rings) { r.passed = false; r.hit = false; }
    this.plane = {
      x: START.x, y: START.y, z: START.z,
      heading: START.heading, pitch: 0, roll: 0,
      pitchVel: 0, rollVel: 0,
      speed: START.speed, throttle: 0.62,
    };
    this.assist = 1;         // difficulty assist multiplier (physics)
    this.vs = 0;             // vertical speed m/s
    this.currentRing = 0;
    this.phase = 'rings';    // rings | runway | done
    this.score = 0;
    this.elapsed = 0;
    this.flash = 0;
    this.stalled = false;
    this.message = '';
    this.crashReason = '';
    this.finalTime = 0;
    this.ringsHit = 0;
  }

  get target() {
    if (this.phase === 'rings') return this.world.rings[this.currentRing] || null;
    if (this.phase === 'runway') {
      const rw = this.world.runway;
      return { x: rw.x, y: rw.y + 6, z: rw.z - rw.length / 4 };
    }
    return null;
  }

  // --- Flight simulation, one fixed step of dt seconds. ------------------
  step(dt, ctrl) {
    // The arcade flight model lives in physics.js (angular-velocity
    // handling, thrust/drag, turn coordination, stall, auto-level).
    stepFlight(this, dt, ctrl);

    if (this.mode === 'playing') this.elapsed += dt;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);

    this.checkRings();
    this.checkGround();
  }

  checkRings() {
    if (this.phase !== 'rings') return;
    const ring = this.world.rings[this.currentRing];
    if (!ring) { this.phase = 'runway'; return; }
    const p = this.plane;
    const prevZ = this._prevZ !== undefined ? this._prevZ : p.z;
    // Ring plane crossing: heading mostly north, so test z crossing plus
    // 3D proximity as a forgiving fallback.
    const dx = p.x - ring.x, dy = p.y - ring.y, dz = p.z - ring.z;
    const dist3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const crossed = (prevZ - ring.z) * (p.z - ring.z) <= 0 && prevZ !== p.z;
    const lateral = Math.sqrt(dx * dx + dy * dy);
    if ((crossed && lateral < ring.r) || dist3 < ring.r * 0.8) {
      ring.passed = true; ring.hit = true;
      const bonus = Math.round(60 * Math.max(0, 1 - lateral / ring.r));
      this.score += 100 + bonus;
      this.ringsHit++;
      this.flash = 1;
      this.message = `RING ${this.currentRing + 1}  +${100 + bonus}`;
      this.audio.chime();
      this.advanceRing();
    } else if (p.z < ring.z - 46 || dist3 > 700) {
      // Flew well past it: missed, move on (only current ring counts).
      ring.passed = true; ring.hit = false;
      this.audio.miss();
      this.advanceRing();
    }
    this._prevZ = p.z;
  }

  advanceRing() {
    this.currentRing++;
    this._prevZ = undefined;
    if (this.currentRing >= this.world.rings.length) this.phase = 'runway';
  }

  checkGround() {
    if (this.mode !== 'playing' && this.mode !== 'shot') return;
    const p = this.plane;
    const rw = this.world.runway;
    const ground = groundHeightAt(this.world, p.x, p.z);
    const onRunway = overRunway(this.world, p.x, p.z);

    if (onRunway && p.y <= rw.y + 2.2) {
      // Touchdown judgement.
      const alignDeg = Math.abs(((p.heading * 180 / Math.PI) % 360 + 360) % 360);
      const align = Math.min(alignDeg, 360 - alignDeg);
      const gentle = this.vs >= LANDING.minSink;
      if (p.speed <= LANDING.maxSpeed && gentle && align <= LANDING.maxAlignDeg) {
        this.mode = this.mode === 'shot' ? this.mode : 'success';
        this.phase = 'done';
        this.finalTime = this.elapsed;
        const timeBonus = Math.max(0, 600 - Math.round(this.elapsed * 2));
        const landBonus = 300 + Math.round((LANDING.maxSpeed - p.speed) * 8);
        this.score += landBonus + timeBonus;
        this.audio.success();
        this.audio.setEngine(0, 0);
      } else {
        const why = p.speed > LANDING.maxSpeed ? 'Too fast on touchdown!'
          : !gentle ? 'Hard landing — slammed the runway!'
          : 'Not aligned with the runway!';
        this.doCrash(why);
      }
      return;
    }
    if (p.y <= ground + 0.9) {
      if (ground <= 0.5) this.doCrash('Ditched in the sea! Slow down and land on the runway.');
      else this.doCrash('Hit the terrain! Watch your altitude over the islands.');
    }
  }

  doCrash(reason) {
    if (this.mode === 'shot') return; // shot mode never ends on a crash
    this.mode = 'crashed';
    this.crashReason = reason;
    this.audio.crash();
    this.audio.setEngine(0, 0);
  }

  // --- Controls from keyboard/mouse ---------------------------------------
  readControls(now) {
    const inp = this.input;
    const c = { pitch: 0, roll: 0, throttle: 0 };
    if (inp.down('ArrowUp')) c.pitch += 1;       // nose up
    if (inp.down('ArrowDown')) c.pitch -= 1;     // nose down
    if (inp.down('ArrowLeft') || inp.down('a')) c.roll -= 1;
    if (inp.down('ArrowRight') || inp.down('d')) c.roll += 1;
    if (inp.down('w')) c.throttle += 1;
    if (inp.down('s')) c.throttle -= 1;
    if (inp.mouseActive(now)) {
      const mx = (inp.mouseX - 0.5) * 2;   // -1..1
      const my = (inp.mouseY - 0.5) * 2;
      c.roll = clamp(c.roll + mx * 0.9, -1, 1);
      c.pitch = clamp(c.pitch - my * 0.8, -1, 1);
    }
    return c;
  }

  // --- Autopilot (deterministic, used by screenshot mode + debug key T) ---
  // The physics model turns input into angular velocity, so the pilot
  // commands ATTITUDE ERRORS: desired attitude minus current attitude,
  // scaled — the damped angular model then converges on the desire.
  autopilot() {
    const p = this.plane;
    let t = this.target;
    const c = { pitch: 0, roll: 0, throttle: 0 };
    if (!t) return c;
    if (this.phase === 'runway') {
      // Fly a real final: aim at the threshold until over the strip,
      // then aim down the strip and settle onto it.
      const rw = this.world.runway;
      t = p.z > rw.z + rw.length / 2
        ? { x: rw.x, y: rw.y + 2, z: rw.z + rw.length / 2 }
        : { x: rw.x, y: rw.y + 1, z: rw.z - rw.length / 2 };
    }
    const dx = t.x - p.x, dz = t.z - p.z;
    const desiredHeading = Math.atan2(dx, -dz);
    const hErr = angDiff(desiredHeading, p.heading);
    const desiredRoll = clamp(hErr * 1.5, -0.62, 0.62);
    c.roll = clamp((desiredRoll - p.roll) * 3.2, -1, 1);
    const dist = Math.hypot(dx, dz);
    let targetY = t.y;
    let pitchGain = 0.020;
    if (this.phase === 'runway') {
      const rw = this.world.runway;
      pitchGain = 0.030;
      targetY = t.y + clamp(dist * 0.07, 0, 32);
      if (p.z < rw.z + rw.length / 2) targetY = rw.y + 0.3; // over the strip: settle on it
    }
    const yErr = targetY - p.y;
    const desiredPitch = clamp(yErr * pitchGain - this.vs * 0.014, -0.5, 0.55);
    c.pitch = clamp((desiredPitch - p.pitch) * 3.4, -1, 1);
    const targetThrottle = this.phase === 'runway' ? (dist < 300 ? 0.20 : 0.42) : 0.62;
    c.throttle = clamp((targetThrottle - p.throttle) * 3, -1, 1);
    return c;
  }

  renderState() {
    return {
      world: this.world, plane: this.plane, time: this.time,
      score: this.score, elapsed: this.elapsed, flash: this.flash,
      currentRing: this.currentRing, totalRings: this.world.rings.length,
      phase: this.phase, vs: this.vs, stalled: this.stalled,
      target: this.target, muted: this.audio.muted,
      gearNote: this.phase === 'runway' ? 'READY TO LAND' : 'FLOATS DOWN',
    };
  }

  render() { this.renderer.render(this.renderState()); }

  // --- Overlay screens ------------------------------------------------------
  overlayTitle() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 20, 36, 0.42)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd94d';
    ctx.strokeStyle = '#7a4d00'; ctx.lineWidth = 3;
    ctx.font = 'bold 74px Georgia, serif';
    ctx.strokeText('GOLDEN STRAIT RUN', W / 2, 168);
    ctx.fillText('GOLDEN STRAIT RUN', W / 2, 168);
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Georgia, serif';
    ctx.fillText('A golden-hour seaplane flight through the glowing rings of the strait', W / 2, 208);
    ctx.font = 'bold 27px monospace';
    ctx.fillStyle = (Math.floor(this.time * 1.6) % 2 === 0) ? '#ffe9a8' : '#ffffff';
    ctx.fillText('CLICK OR PRESS ENTER TO FLY', W / 2, 292);
    ctx.font = '19px monospace';
    ctx.fillStyle = '#dff2ff';
    const lines = [
      'ARROW KEYS / A D — pitch & roll        W / S — throttle',
      'MOUSE — steer toward the pointer',
      'Fly through all 12 golden rings, then land gently',
      'on the coastal runway: slow, low, aligned, soft sink.',
      'R — restart      P — pause      M — mute',
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 348 + i * 30));
    ctx.restore();
  }

  overlayCenter(title, sub, lines, accent) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 14, 24, 0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = 'bold 58px Georgia, serif';
    ctx.fillText(title, W / 2, 250);
    ctx.fillStyle = '#ffffff';
    ctx.font = '23px monospace';
    ctx.fillText(sub, W / 2, 296);
    ctx.font = '21px monospace';
    ctx.fillStyle = '#dff2ff';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 348 + i * 32));
    ctx.restore();
  }

  drawScreen() {
    this.render();
    if (this.mode === 'title') this.overlayTitle();
    else if (this.mode === 'paused') this.overlayCenter('PAUSED', 'Press P to resume', ['Take a breath — the strait waits.'], '#aee6ff');
    else if (this.mode === 'success') {
      const mm = String(Math.floor(this.finalTime / 60)).padStart(2, '0');
      const ss = String(Math.floor(this.finalTime % 60)).padStart(2, '0');
      this.overlayCenter('PERFECT LANDING!', 'You greased it onto the coastal runway.', [
        `FINAL SCORE   ${this.score}`,
        `RINGS  ${this.ringsHit} / ${this.world.rings.length}      TIME  ${mm}:${ss}`,
        'Press R to fly again',
      ], '#8fd18a');
    } else if (this.mode === 'crashed') {
      this.overlayCenter('CRASHED', this.crashReason, [
        `SCORE   ${this.score}      RINGS  ${this.ringsHit} / ${this.world.rings.length}`,
        'Press R to try again',
      ], '#ff7b6b');
    }
  }
}

// ---------------------------------------------------------------------------
const game = new Game();

if (shot) {
  // Deterministic screenshot mode: no input, no audio, fixed steps.
  document.body.classList.add('shot');
  game.mode = 'shot';
  setupShotScene(game, shot.scene);
  game._prevZ = game.plane.z;
  const dt = 1 / 60;
  for (let i = 0; i < shot.steps; i++) {
    game.step(dt, game.autopilot());
    if (game.phase === 'runway' && shot.scene !== 'approach') { /* keep flying */ }
  }
  game.render();
  if (shot.scene === 'title') game.overlayTitle();
  window.__shotReady = true;
} else {
  // Normal interactive loop.
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 120;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    const inp = game.input;
    // One-shot keys.
    if (inp.takePressed('Enter') || inp.takePressed('__click')) {
      game.audio.start();
      if (game.mode === 'title') game.mode = 'playing';
      else if (game.mode === 'success' || game.mode === 'crashed') { game.reset(); game.mode = 'playing'; }
    }
    if (inp.takePressed('r') || inp.takePressed('R')) {
      game.audio.start();
      game.reset(); game.mode = 'playing';
    }
    if (inp.takePressed('p') || inp.takePressed('P')) {
      if (game.mode === 'playing') game.mode = 'paused';
      else if (game.mode === 'paused') game.mode = 'playing';
    }
    if (inp.takePressed('m') || inp.takePressed('M')) game.audio.toggleMute();
    inp.clearPressed();

    if (game.mode === 'playing') {
      acc += dt;
      const ctrl = game.readControls(now);
      while (acc >= STEP) { game.step(STEP, ctrl); acc -= STEP; }
      game.audio.setEngine(game.plane.throttle, game.plane.speed / 78);
    } else {
      // Title / end screens: gentle idle drift so the scene stays alive.
      game.time += dt;
      if (game.mode === 'title') {
        game.plane.x = Math.sin(game.time * 0.11) * 14;
        game.plane.y = START.y + Math.sin(game.time * 0.5) * 2.5;
        game.plane.roll = Math.sin(game.time * 0.3) * 0.08;
      }
    }
    game.drawScreen();
  }
  requestAnimationFrame(frame);
}
