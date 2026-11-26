// Golden Strait Run — main game logic: flight model, ring course,
// landing / crash rules, screens, autopilot (for screenshot mode),
// and the normal requestAnimationFrame loop.
import { W, H, START, LANDING, EFFECTS, DIFFICULTY, MEDALS, RING_RADIUS } from './config.js';
import { buildWorld, groundHeightAt, overRunway } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { stepFlight } from './physics.js';
import { Camera } from './camera.js';
import { Effects } from './effects.js';
import { drawHUD, drawTitle, drawCountdown, drawPause, drawResults, drawCrash, drawTouchControls } from './ui.js';
import { clamp, angDiff } from './random.js';
import { parseShotParams, setupShotScene } from './shots.js';

// Best score persistence (guarded: headless / file contexts may lack it).
const BEST_KEY = 'gsr_best_v1';
function loadBest() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveBest(best) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch (e) { /* ignore */ }
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;

const shot = parseShotParams();
const seed = shot ? shot.seed : (parseInt(new URLSearchParams(window.location.search).get('seed') || '7', 10) || 7);

class Game {
  constructor() {
    this.seedVal = seed;
    this.world = buildWorld(seed);
    this.renderer = new Renderer(ctx);
    this.audio = new AudioEngine();
    this.camera = new Camera();
    this.fx = new Effects();
    this.difficulty = 'normal';
    this.landCfg = null;
    this.best = loadBest();
    this.autoMode = false;
    this._autoLogged = false;
    this.countdownT = 0;
    this.frameDt = 1 / 60;
    this.input = shot ? null : new Input(canvas);
    this.reset();
    this.mode = 'title'; // title | countdown | playing | landing | paused | success | crashed
    this.time = 0;
  }

  // Difficulty: ring size, physics assist and landing strictness, then
  // a fresh world at that ring size. Back to the title screen.
  applyDifficulty(key) {
    const d = DIFFICULTY[key];
    if (!d) return;
    this.difficulty = key;
    this.assist = d.assist;
    this.landCfg = { ...d.landing };
    this.world = buildWorld(this.seedVal, RING_RADIUS * d.ringScale);
    this.reset();
    if (this.mode !== 'shot') this.mode = 'title';
  }

  computeMedal() {
    if (this.ringsHit >= this.world.rings.length &&
        this.finalTime <= MEDALS.goldTime && this.maxStreak >= MEDALS.goldCombo) return 'GOLD';
    if (this.ringsHit >= MEDALS.silverRings && this.finalTime <= MEDALS.silverTime) return 'SILVER';
    return 'BRONZE';
  }

  startGame(withCountdown) {
    this.reset();
    if (withCountdown) { this.mode = 'countdown'; this.countdownT = 2.1; }
    else this.mode = 'playing';
  }

  reset() {
    const w = this.world;
    for (const r of w.rings) { r.passed = false; r.hit = false; r.passAt = -99; }
    this.fx.clear();
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
    // Combo streak: consecutive rings inside the combo window.
    this.streak = 0;
    this.maxStreak = 0;
    this.lastRingAt = -99;
    // Landing roll-out state.
    this.landingT = 0;
    this.bounceV = 0;
    this.rating = '';
    this.medal = '';
    this.newBest = false;
  }

  // Combo currently shown: the streak dies when the window lapses.
  get comboActive() {
    return (this.time - this.lastRingAt <= EFFECTS.comboWindow) ? this.streak : 0;
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
    if (this.mode === 'landing') { this.updateRollout(dt); return; }
    // The arcade flight model lives in physics.js (angular-velocity
    // handling, thrust/drag, turn coordination, stall, auto-level).
    stepFlight(this, dt, ctrl);

    if (this.mode === 'playing') this.elapsed += dt;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.fx.update(dt, this);

    this.checkRings();
    this.checkGround();
  }

  // Touchdown roll-out: the plane floats on the strip, bounces softly,
  // throws spray, and decelerates to taxi speed before the results.
  updateRollout(dt) {
    const p = this.plane;
    const rw = this.world.runway;
    this.time += dt;
    this.landingT += dt;
    p.throttle = Math.max(0, p.throttle - dt * 1.4);
    p.speed = Math.max(0, p.speed - LANDING.decel * dt);
    p.pitch += (0 - p.pitch) * Math.min(1, dt * 5);
    p.roll += (0 - p.roll) * Math.min(1, dt * 5);
    p.pitchVel = 0; p.rollVel = 0;
    // Bounce: springy float contact, damped.
    const groundY = rw.y + 1.1;
    this.bounceV -= 26 * dt;
    p.y += this.bounceV * dt;
    if (p.y <= groundY) {
      p.y = groundY;
      this.bounceV = Math.abs(this.bounceV) > 0.9 ? -this.bounceV * 0.38 : 0;
      if (this.bounceV !== 0) this.fx.splash(p.x, rw.y + 0.3, p.z, 10, 0.5);
    }
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    p.x += fx * p.speed * dt;
    p.z += fz * p.speed * dt;
    this.vs = 0;
    this.fx.update(dt, this);
    if (this.landingT >= LANDING.rolloutTime) {
      this.mode = 'success';
      this.medal = this.computeMedal();
      if (!this.best || this.score > this.best.score) {
        this.best = {
          score: this.score, time: Math.round(this.finalTime * 10) / 10,
          medal: this.medal, rating: this.rating, difficulty: this.difficulty,
        };
        this.newBest = true;
        saveBest(this.best);
      }
      this.audio.success();
      this.audio.setEngine(0, 0);
    }
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
      ring.passAt = this.time;
      // Combo streak: chained rings inside the window raise the ding
      // pitch and pay a growing bonus.
      this.streak = (this.time - this.lastRingAt <= EFFECTS.comboWindow) ? this.streak + 1 : 1;
      this.lastRingAt = this.time;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      const centreBonus = Math.round(60 * Math.max(0, 1 - lateral / ring.r));
      const comboBonus = EFFECTS.comboScoreStep * (this.streak - 1);
      const points = 100 + centreBonus + comboBonus;
      this.score += points;
      this.ringsHit++;
      this.flash = 1;
      this.message = `RING ${this.currentRing + 1}  +${points}`;
      this.fx.burst(ring.x, ring.y, ring.z);
      this.fx.popup(ring.x, ring.y + ring.r * 0.55, ring.z,
        `+${points}`, this.streak >= 2 ? `COMBO ×${this.streak}` : '');
      this.audio.ding(this.streak - 1);
      this.advanceRing();
    } else if (p.z < ring.z - 46 || dist3 > 700) {
      // Flew well past it: missed, move on (only current ring counts).
      ring.passed = true; ring.hit = false;
      ring.passAt = this.time;
      this.streak = 0;
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

  // Difficulty-scaled landing limits (set by applyDifficulty; defaults
  // are the raw LANDING config).
  landLimits() {
    return this.landCfg || {
      maxSpeed: LANDING.maxSpeed, minSink: LANDING.minSink, maxAlignDeg: LANDING.maxAlignDeg,
    };
  }

  // A touchdown inside the hard limits: rate it, score it, and either
  // start the roll-out (interactive) or finish at once (shot mode).
  touchdown(align) {
    const p = this.plane;
    const L = LANDING;
    const tdSpeed = p.speed, tdSink = this.vs;
    this.rating =
      (tdSpeed <= L.perfectSpeed && tdSink >= L.perfectSink && align <= 8) ? 'PERFECT' :
      (tdSpeed <= L.goodSpeed && tdSink >= L.goodSink && align <= L.maxAlignDeg) ? 'GOOD' : 'ROUGH';
    this.phase = 'done';
    this.finalTime = this.elapsed;
    const timeBonus = Math.max(0, 600 - Math.round(this.elapsed * 2));
    const landBonus = 300 + Math.round((L.maxSpeed - tdSpeed) * 8);
    const ratingBonus = this.rating === 'PERFECT' ? 150 : this.rating === 'GOOD' ? 75 : 0;
    this.score += landBonus + timeBonus + ratingBonus;
    this.fx.splash(p.x, this.world.runway.y + 0.4, p.z, 46, 1);
    this.fx.popup(p.x, p.y + 9, p.z, this.rating === 'PERFECT' ? 'PERFECT LANDING!' : `${this.rating} LANDING`, `+${landBonus + ratingBonus}`);
    this.audio.splash();
    if (this.mode === 'shot') {
      this.audio.success();
      return; // shot mode: no roll-out, the frame is the deliverable
    }
    this.mode = 'landing';
    this.landingT = 0;
    this.bounceV = clamp(-tdSink, 0, 6.5) * LANDING.bounceGain * 2.2;
    this.audio.setEngine(0.1, 0);
  }

  checkGround() {
    if (this.mode !== 'playing' && this.mode !== 'shot') return;
    if (this.phase === 'done') return;
    const p = this.plane;
    const rw = this.world.runway;
    const ground = groundHeightAt(this.world, p.x, p.z);
    const onRunway = overRunway(this.world, p.x, p.z);
    const lim = this.landLimits();

    if (onRunway && p.y <= rw.y + 2.2) {
      // Touchdown judgement.
      const alignDeg = Math.abs(((p.heading * 180 / Math.PI) % 360 + 360) % 360);
      const align = Math.min(alignDeg, 360 - alignDeg);
      const gentle = this.vs >= lim.minSink;
      if (p.speed <= lim.maxSpeed && gentle && align <= lim.maxAlignDeg) {
        this.touchdown(align);
      } else {
        const why = p.speed > lim.maxSpeed ? 'Too fast on touchdown!'
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
    this.fx.splash(this.plane.x, Math.max(0.5, this.plane.y - 2), this.plane.z, 50, 1.2);
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
    if (inp.touch && inp.touch.active) {
      c.roll = clamp(c.roll + inp.touch.joyX, -1, 1);
      c.pitch = clamp(c.pitch - inp.touch.joyY, -1, 1);
      if (inp.touch.throttleActive) this.plane.throttle = inp.touch.throttle;
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
    let targetThrottle = 0.62;
    if (this.phase === 'runway') {
      // On final, settle a few m/s under the (difficulty-scaled)
      // touchdown speed limit.
      const lim = this.landLimits();
      const vFinal = clamp(lim.maxSpeed - 3, 25, 27);
      const thrFinal = clamp((vFinal - 14) / (78 - 14), 0.05, 0.4);
      targetThrottle = dist < 300 ? thrFinal : 0.42;
    }
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
      camMode: this.camera.mode,
      fx: this.fx, combo: this.comboActive, maxStreak: this.maxStreak,
      rating: this.rating, medal: this.medal,
      ringsHit: this.ringsHit, finalTime: this.finalTime,
      crashReason: this.crashReason, newBest: this.newBest,
      difficulty: this.difficulty || 'normal',
      best: this.best || null,
      countdown: this.countdown || 0,
      touch: this.input ? this.input.touch : null,
      gearNote: this.phase === 'runway' ? 'READY TO LAND' : 'FLOATS DOWN',
    };
  }

  render() {
    const snap = this.mode === 'shot';
    const st = this.renderState();
    st.camView = this.camera.update(this.plane, snap ? 0 : this.frameDt, this.time, snap);
    this._st = st;
    this.renderer.render(st);
  }

  // --- One-shot keys / clicks, consumed once per frame ----------------------
  processPressed() {
    const inp = this.input;
    if (inp.takePressed('Enter') || inp.takePressed('__click')) {
      this.audio.start();
      if (this.mode === 'title') {
        // Tapping a difficulty pill selects it instead of starting.
        if (inp.clickY > 0.29 && inp.clickY < 0.39 && inp.clickX > 0.24 && inp.clickX < 0.76) {
          const keys = Object.keys(DIFFICULTY);
          const idx = Math.min(2, Math.max(0, Math.floor((inp.clickX - 0.24) / (0.52 / 3))));
          this.applyDifficulty(keys[idx]);
        } else {
          this.startGame(true);
        }
      } else if (this.mode === 'success' || this.mode === 'crashed') {
        this.reset(); this.mode = 'playing';
      } else if (this.mode === 'paused') {
        this.mode = 'playing';
      }
    }
    if (inp.takePressed('1')) this.applyDifficulty('santai');
    if (inp.takePressed('2')) this.applyDifficulty('normal');
    if (inp.takePressed('3')) this.applyDifficulty('pro');
    if (inp.takePressed('r')) {
      this.audio.start();
      this.reset(); this.mode = 'playing';
    }
    if (inp.takePressed('p')) {
      if (this.mode === 'playing') this.mode = 'paused';
      else if (this.mode === 'paused') this.mode = 'playing';
    }
    if (inp.takePressed('m')) this.audio.toggleMute();
    if (inp.takePressed('c')) this.camera.cycle();
    if (inp.takePressed('t')) {
      // Debug/demo: hand the controls to the autopilot and log the result.
      this.autoMode = !this.autoMode;
      this._autoLogged = false;
      if (this.autoMode && this.mode === 'title') this.startGame(true);
      else if (this.autoMode && (this.mode === 'success' || this.mode === 'crashed')) {
        this.reset(); this.mode = 'playing';
      }
      console.log(`[GSR] autopilot demo ${this.autoMode ? 'ON' : 'OFF'} (difficulty ${this.difficulty})`);
    }
    inp.clearPressed();
  }

  drawScreen() {
    this.render();
    const st = this._st;
    const project = (x, y, z) => this.renderer.project(x, y, z);
    drawHUD(ctx, st, project);
    if (this.mode === 'title') {
      drawTitle(ctx, { time: this.time, difficulty: this.difficulty, best: this.best });
    } else if (this.mode === 'countdown') {
      drawCountdown(ctx, Math.max(1, Math.ceil(this.countdownT / 0.7)));
    } else if (this.mode === 'paused') {
      drawPause(ctx, { camMode: this.camera.mode, muted: this.audio.muted });
    } else if (this.mode === 'success') {
      drawResults(ctx, st);
    } else if (this.mode === 'crashed') {
      drawCrash(ctx, st);
    }
    if ((this.mode === 'playing' || this.mode === 'countdown' || this.mode === 'landing') &&
        st.touch && st.touch.active) {
      drawTouchControls(ctx, st);
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
  drawHUD(ctx, game._st, (x, y, z) => game.renderer.project(x, y, z));
  if (shot.scene === 'title') {
    drawTitle(ctx, { time: game.time, difficulty: 'normal', best: null });
  }
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
    game.frameDt = dt;

    game.processPressed();

    // Debug autopilot: report the finished run once.
    if (game.autoMode && !game._autoLogged &&
        (game.mode === 'success' || game.mode === 'crashed')) {
      game._autoLogged = true;
      console.log('[GSR autopilot] result:', JSON.stringify({
        rings: `${game.ringsHit}/${game.world.rings.length}`,
        landed: game.mode === 'success',
        score: game.score,
        timeSec: Math.round(game.finalTime || game.elapsed),
        rating: game.rating || null, medal: game.medal || null,
        crashReason: game.crashReason || null,
      }));
    }

    if (game.mode === 'playing' || game.mode === 'landing') {
      acc += dt;
      const ctrl = game.autoMode ? game.autopilot() : game.readControls(now);
      while (acc >= STEP) { game.step(STEP, ctrl); acc -= STEP; }
      game.audio.setEngine(game.plane.throttle, game.plane.speed / 78);
      const gH = groundHeightAt(game.world, game.plane.x, game.plane.z);
      const prox = gH <= 0.6 ? clamp(1 - Math.max(0, game.plane.y - gH) / 26, 0, 1) : 0;
      game.audio.setWater(prox * clamp(game.plane.speed / 30, 0.25, 1));
    } else if (game.mode === 'countdown') {
      game.countdownT -= dt;
      acc += dt;
      const glide = { pitch: 0, roll: 0, throttle: 0 };
      while (acc >= STEP) { game.step(STEP, glide); acc -= STEP; }
      if (game.countdownT <= 0) game.mode = 'playing';
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
