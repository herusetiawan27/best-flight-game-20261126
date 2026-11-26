// Pseudo-3D renderer: own perspective projection + painter's algorithm
// on Canvas 2D. Camera chases the plane; the plane itself is drawn as a
// detailed 2D seaplane in the centre of the frame (banking with roll),
// with a glowing instrument panel overlaid at the bottom.
import { W, H, FOCAL, EFFECTS } from './config.js';
import { clamp, angDiff } from './random.js';

// World anchor of the low sun (drives the sky disc; the sea's golden
// path is baked into the sea layer at the sun's usual screen spot).
const SUN = { x: -260, y: 95, z: -2600 };

// Screen column of the sun in chase view (ahead-left): the baked
// golden reflection path on the water sits under it.
const SUN_PATH_X = W * 0.43;

// Deterministic 0..1 hash of a screen-space water cell. The sea's
// flecks live on this fixed screen grid: their positions NEVER depend
// on the camera, the plane, or the world — only the twinkle alpha
// reads the clock.
function cellHash(ix, iy, salt) {
  const h = Math.sin(ix * 127.1 + iy * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export class Renderer {
  constructor(ctx) { this.ctx = ctx; this.cam = null; }

  // Fallback view if no camera module state is supplied: the original
  // locked chase pose. Normally main.js passes state.camView from
  // camera.js (lagged chase / cockpit / orbit).
  legacyView(plane) {
    const yaw = plane.heading;
    const cp = Math.cos(plane.pitch * 0.55), sp = Math.sin(plane.pitch * 0.55);
    const fwd = { x: Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
    const right = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    const dist = 21, height = 7.5;
    const cam = {
      x: plane.x - fwd.x * dist, y: plane.y - fwd.y * dist + height, z: plane.z - fwd.z * dist,
      fwd, right, up, focal: FOCAL, shakeX: 0, shakeY: 0, mode: 'chase',
    };
    if (cam.y < 4) cam.y = 4;
    return cam;
  }

  // World point -> screen {x, y, s(scale), cz} or null if behind camera.
  project(x, y, z) {
    const c = this.cam;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const cx = dx * c.right.x + dy * c.right.y + dz * c.right.z;
    const cy = dx * c.up.x + dy * c.up.y + dz * c.up.z;
    const cz = dx * c.fwd.x + dy * c.fwd.y + dz * c.fwd.z;
    if (cz < 2) return null;
    const s = c.focal / cz;
    return { x: W / 2 + cx * s + (c.shakeX || 0), y: H / 2 - cy * s + (c.shakeY || 0), s, cz };
  }

  render(state) {
    const { ctx } = this;
    const { world, plane, time } = state;
    this.cam = state.camView || this.legacyView(plane);
    this.drawSky(state);
    this.drawSea(state);
    this.drawGlitter(state);

    // --- Painter's algorithm: collect drawables, sort far -> near. ---
    const items = [];
    const camZ = (x, z) => {
      const dx = x - this.cam.x, dz = z - this.cam.z;
      return dx * this.cam.fwd.x + dz * this.cam.fwd.z;
    };
    for (const isl of world.islands) items.push({ d: camZ(isl.x, isl.z), kind: 'island', o: isl });
    for (const b of world.boats) items.push({ d: camZ(b.x, b.z), kind: 'boat', o: b });
    items.push({ d: camZ(world.lighthouse.x, world.lighthouse.z), kind: 'lighthouse', o: world.lighthouse });
    items.push({ d: camZ(world.runway.x, world.runway.z), kind: 'runway', o: world.runway });
    world.rings.forEach((r, idx) => {
      // Passed rings stay in the draw list briefly for the pulse-out.
      if (!r.passed || state.time - (r.passAt ?? -99) < 0.55) {
        items.push({ d: camZ(r.x, r.z), kind: 'ring', o: r, idx });
      }
    });
    for (const cl of world.clouds) items.push({ d: camZ(cl.x, cl.z), kind: 'cloud', o: cl });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.d < -40) continue;
      if (it.kind === 'island') this.drawIsland(it.o);
      else if (it.kind === 'boat') this.drawBoat(it.o, time);
      else if (it.kind === 'lighthouse') this.drawLighthouse(it.o, time);
      else if (it.kind === 'runway') this.drawRunway(it.o);
      else if (it.kind === 'ring') this.drawRing(it.o, state, it.idx === state.currentRing);
      else if (it.kind === 'cloud') this.drawCloud(it.o, time);
    }
    this.drawBirds(state);
    this.drawFog(state);

    if (state.fx) {
      this.drawRipples(state);
      this.drawParticles(state);
    }

    if (state.camMode === 'cockpit') {
      this.drawCockpit(state);
    } else {
      this.drawPlane(state);
      this.drawPanel(state);
    }
    this.drawSpeedLines(state);
    if (state.fx) this.drawPopups(state);
    if (state.flash > 0) { // golden flash on ring pass
      ctx.fillStyle = `rgba(255, 210, 90, ${state.flash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawSky(state) {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
    g.addColorStop(0, '#2a6db0');
    g.addColorStop(0.45, '#7fb6d9');
    g.addColorStop(0.75, '#f7c873');
    g.addColorStop(1, '#ffdf9e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Low golden-hour sun, ahead-left of the course start direction.
    const sun = this.project(SUN.x, SUN.y, SUN.z);
    const sx = sun ? sun.x : W * 0.3, sy = sun ? clamp(sun.y, 40, H * 0.55) : H * 0.3;
    const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 250);
    rg.addColorStop(0, 'rgba(255,246,200,0.95)');
    rg.addColorStop(0.18, 'rgba(255,214,110,0.75)');
    rg.addColorStop(1, 'rgba(255,190,80,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(sx, sy, 250, 0, Math.PI * 2); ctx.fill();
    // Horizontal flare streak through the disc.
    const flare = ctx.createLinearGradient(sx - 190, 0, sx + 190, 0);
    flare.addColorStop(0, 'rgba(255,230,160,0)');
    flare.addColorStop(0.5, 'rgba(255,236,180,0.5)');
    flare.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = flare;
    ctx.fillRect(sx - 190, sy - 3, 380, 6);
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath(); ctx.arc(sx, sy, 40, 0, Math.PI * 2); ctx.fill();
  }

  drawSea(state) {
    // THE WATER LAYER IS FULLY DECOUPLED FROM THE CAMERA (user
    // diagnosis, in engine terms: the sea must sit at a fixed
    // SEA_LEVEL, never inherit pitch/roll, never follow the camera
    // on Y). Everything the water shows — gradient, haze, the golden
    // sun path and the glitter flecks — is painted ONCE into an
    // offscreen canvas as a pure function of SCREEN position and
    // blitted. The horizon is locked to row H*0.5 for every flight
    // state: climb, dive, bank, high or low, the layer is
    // pixel-identical. The only per-frame water drawing is
    // drawGlitter's twinkle, whose fleck POSITIONS sit on the same
    // fixed screen grid (only their alpha breathes with sim time).
    // World OBJECTS — islands, boats, rings, runway — still project
    // through the camera as before; only the water surface is locked.
    const { ctx } = this;
    if (!this._seaLayer) this._seaLayer = this._paintSeaLayer();
    ctx.drawImage(this._seaLayer, 0, 0);
  }

  _paintSeaLayer() {
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    const ctx = layer.getContext('2d');
    const hy = H * 0.5;
    // Haze band: a pale blend straddling the horizon line, so distant
    // objects melt into the waterline instead of crossing a hard edge.
    const haze = ctx.createLinearGradient(0, hy - 46, 0, hy + 12);
    haze.addColorStop(0, 'rgba(255, 226, 160, 0)');
    haze.addColorStop(1, 'rgba(186, 233, 233, 0.55)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy - 46, W, 58);
    // Sea body: gradient anchored to fixed screen rows.
    const g = ctx.createLinearGradient(0, H * 0.42, 0, H);
    g.addColorStop(0, '#3ec6cd');
    g.addColorStop(0.3, '#1b9db4');
    g.addColorStop(0.65, '#0e7497');
    g.addColorStop(1, '#0a5f83');
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, H - hy);
    this._paintSunPath(ctx, hy);
    this._paintFlecks(ctx, hy);
    return layer;
  }

  // Golden sun-reflection path, baked in: a soft column of warm light
  // under the sun's screen spot, brightest at the horizon and fading
  // with depth, broken by short horizontal shimmer streaks. Pure
  // screen space — it cannot slide with the camera.
  _paintSunPath(ctx, hy) {
    const halfW = 185;
    const col = ctx.createLinearGradient(SUN_PATH_X - halfW, 0, SUN_PATH_X + halfW, 0);
    col.addColorStop(0, 'rgba(255, 196, 92, 0)');
    col.addColorStop(0.5, 'rgba(255, 205, 105, 1)');
    col.addColorStop(1, 'rgba(255, 196, 92, 0)');
    // Vertical falloff in bands (painted once, so bands cost nothing
    // per frame).
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const y0 = hy + (H - hy) * (i / bands);
      const y1 = hy + (H - hy) * ((i + 1) / bands);
      ctx.save();
      ctx.globalAlpha = 0.30 * Math.pow(1 - i / bands, 1.4) + 0.015;
      ctx.fillStyle = col;
      ctx.fillRect(SUN_PATH_X - halfW, y0, halfW * 2, y1 - y0 + 1);
      ctx.restore();
    }
    // Broken shimmer streaks inside the column.
    for (let i = 0; i < 130; i++) {
      const h1 = cellHash(i, 7, 11), h2 = cellHash(i, 13, 12), h3 = cellHash(i, 21, 13);
      const depthT = h2;
      const y = hy + 3 + depthT * (H - hy - 8);
      const spread = halfW * (0.35 + depthT * 0.75);
      const x = SUN_PATH_X + (h1 - 0.5) * 2 * spread;
      const len = (5 + h3 * 26) * (0.5 + depthT);
      ctx.fillStyle = `rgba(255, 224, 150, ${((0.10 + h3 * 0.22) * (1 - depthT * 0.55)).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(x, y, len, Math.max(0.6, len * 0.16), 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Static glitter flecks on the fixed screen grid: denser and larger
  // toward the bottom of the frame (near water), gold-tinted inside
  // the sun path, pale elsewhere. Baked once; never moves.
  _paintFlecks(ctx, hy) {
    const cellW = 44, cellH = 26;
    const rows = Math.ceil((H - hy) / cellH), cols = Math.ceil(W / cellW);
    for (let iy = 0; iy < rows; iy++) {
      const depthT = iy / Math.max(1, rows - 1);
      for (let ix = 0; ix < cols; ix++) {
        if (cellHash(ix, iy, 1) > 0.28 + depthT * 0.42) continue;
        const fx = ix * cellW + 5 + cellHash(ix, iy, 2) * (cellW - 10);
        const fy = hy + iy * cellH + 4 + cellHash(ix, iy, 3) * (cellH - 8);
        const rx = (1 + depthT * 3.2) * (0.6 + cellHash(ix, iy, 6) * 0.9);
        const inPath = Math.abs(fx - SUN_PATH_X) < 185 * (0.4 + depthT * 0.7);
        const a = inPath ? 0.16 + cellHash(ix, iy, 8) * 0.20 : 0.05 + cellHash(ix, iy, 8) * 0.11;
        ctx.fillStyle = inPath ? `rgba(255, 220, 140, ${a.toFixed(3)})` : `rgba(235, 252, 255, ${a.toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(fx, fy, rx, Math.max(0.5, rx * 0.30), 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Per-frame water life: a sparse TWINKLE over the same fixed screen
  // grid as the baked flecks. Positions and sizes are pure functions
  // of the screen cell; only the alpha oscillates with sim time. This
  // function reads NOTHING from the camera or the plane — pitch,
  // roll, altitude and position cannot move a single fleck. (The old
  // world-space glitter projected y=0 cells through the camera, so
  // the whole field slid with camera pitch and compressed with
  // camera altitude: the sea visibly followed the plane on Y.)
  drawGlitter(state) {
    const { ctx } = this;
    const hy = H * 0.5;
    const cellW = 44, cellH = 26;
    const rows = Math.ceil((H - hy) / cellH), cols = Math.ceil(W / cellW);
    ctx.save();
    for (let iy = 0; iy < rows; iy++) {
      const depthT = iy / Math.max(1, rows - 1);
      for (let ix = 0; ix < cols; ix++) {
        if (cellHash(ix, iy, 4) < 0.80) continue; // sparse subset twinkles
        const phase = cellHash(ix, iy, 5) * 6.283;
        const s = Math.sin(state.time * 1.5 + phase);
        const a = s > 0 ? Math.pow(s, 3) * 0.5 : 0;
        if (a < 0.02) continue;
        const fx = ix * cellW + 5 + cellHash(ix, iy, 2) * (cellW - 10);
        const fy = hy + iy * cellH + 4 + cellHash(ix, iy, 3) * (cellH - 8);
        const rx = (1.4 + depthT * 3.4) * (0.6 + cellHash(ix, iy, 6) * 0.9);
        const inPath = Math.abs(fx - SUN_PATH_X) < 185 * (0.4 + depthT * 0.7);
        ctx.fillStyle = inPath ? `rgba(255, 226, 150, ${a.toFixed(3)})` : `rgba(240, 253, 255, ${a.toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(fx, fy, rx, Math.max(0.5, rx * 0.30), 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  poly(points, fill, stroke, lw = 2) {
    const { ctx } = this;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (!p) return false;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    return true;
  }

  circlePoints(cx, cz, r, yBase, n = 26) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(this.project(cx + Math.cos(a) * r, yBase, cz + Math.sin(a) * r));
    }
    return pts;
  }

  // Distance haze: a soft golden band across the horizon rows, drawn
  // over the world so far objects melt into the evening light.
  drawFog(state) {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, H * 0.36, 0, H * 0.60);
    g.addColorStop(0, 'rgba(255, 216, 150, 0)');
    g.addColorStop(0.55, 'rgba(255, 216, 150, 0.13)');
    g.addColorStop(1, 'rgba(255, 216, 150, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.36, W, H * 0.24);
  }

  // Bird flocks circling thermals: positions are a pure function of
  // sim time, drawn as tiny flapping silhouettes.
  drawBirds(state) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(28, 38, 48, 0.75)';
    ctx.lineCap = 'round';
    for (const f of state.world.birds || []) {
      for (let k = 0; k < f.count; k++) {
        const a = state.time * f.speed + f.phase + k * 0.55;
        const bx = f.x + Math.cos(a) * f.radius + (k % 3) * 7 - 7;
        const bz = f.z + Math.sin(a) * f.radius;
        const by = f.y + Math.sin(state.time * 0.7 + k * 1.7) * 2.5 + (k % 2) * 3;
        const p = this.project(bx, by, bz);
        if (!p) continue;
        const w = clamp(p.s * 1.15, 1.6, 6.5);
        const flap = Math.sin(state.time * 8 + k * 1.3) * w * 0.55;
        ctx.lineWidth = Math.max(1, w * 0.22);
        ctx.beginPath();
        ctx.moveTo(p.x - w, p.y - flap);
        ctx.quadraticCurveTo(p.x - w * 0.4, p.y + Math.abs(flap) * 0.3, p.x, p.y);
        ctx.quadraticCurveTo(p.x + w * 0.4, p.y + Math.abs(flap) * 0.3, p.x + w, p.y - flap);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawIsland(isl) {
    const { ctx } = this;
    const centre = this.project(isl.x, 2, isl.z);
    if (!centre || centre.cz > 3200) return;
    const lift = isl.h;
    if (isl.cliff) {
      // Rocky cliff islet: grey shore, stacked rock strata, scrub top.
      this.poly(this.circlePoints(isl.x, isl.z, isl.r * 1.05, 1.0), '#8d8577');
      const bands = ['#7a7268', '#8a8175', '#6b6259'];
      for (let i = 0; i < 3; i++) {
        const rr = isl.r * (0.92 - i * 0.16);
        const yy = 1.2 + lift * (0.22 + i * 0.20);
        this.poly(this.circlePoints(isl.x, isl.z, rr, yy), bands[i]);
      }
      this.poly(this.circlePoints(isl.x, isl.z, isl.r * 0.44, 1.2 + lift * 0.82), '#5d7a4a');
    } else {
      // Sandy beach disc at sea level, then a green dome disc raised by height.
      const beach = this.circlePoints(isl.x, isl.z, isl.r * 1.12, 1.2);
      this.poly(beach, '#f4dc9a');
      const green = this.circlePoints(isl.x, isl.z, isl.r, 1.2 + lift * 0.35);
      // Side skirt between beach and top gives the island body.
      if (beach.every(Boolean) && green.every(Boolean)) {
        ctx.fillStyle = '#c9a86a';
        ctx.beginPath();
        ctx.moveTo(beach[0].x, beach[0].y);
        for (const p of beach) ctx.lineTo(p.x, p.y);
        ctx.closePath(); ctx.fill();
        this.poly(green, '#2e9e5b');
        // Darker green inner patch.
        const inner = this.circlePoints(isl.x, isl.z, isl.r * 0.6, 1.6 + lift * 0.35);
        this.poly(inner, '#23804a');
      }
    }
    // Palm trees: little trunk + frond star (sparser on the cliffs).
    isl.trees.forEach((t, ti) => {
      if (isl.cliff && ti % 2) return;
      const p = this.project(t.x, 3 + lift * (isl.cliff ? 0.8 : 0.35), t.z);
      if (!p || p.s < 0.25) return;
      const s = p.s * t.s * 14;
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - s); ctx.stroke();
      ctx.strokeStyle = '#1d7a43'; ctx.lineWidth = Math.max(1, s * 0.11);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + Math.cos(a) * s * 0.55, p.y - s + Math.sin(a) * s * 0.3 - s * 0.12); ctx.stroke();
      }
    });
  }

  drawBoat(b, time = 0) {
    const { ctx } = this;
    const bobY = Math.sin(time * 1.25 + (b.bobPhase || 0)) * 0.35;
    const p = this.project(b.x, bobY, b.z);
    if (!p || p.s < 0.2) return;
    const s = p.s * 9;
    const hullColors = ['#e4572e', '#f2f2f2', '#2e86e4', '#ffd257'];
    const col = hullColors[b.hue % hullColors.length];
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; // wake
    ctx.beginPath(); ctx.ellipse(p.x, p.y + s * 0.24, s * 1.15, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; // hull
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x + s * 0.65, p.y + s * 0.42);
    ctx.lineTo(p.x - s * 0.65, p.y + s * 0.42); ctx.closePath(); ctx.fill();
    if (b.sail) {
      ctx.strokeStyle = '#5a4632'; ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - s * 1.7); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s * 1.7); ctx.lineTo(p.x, p.y - s * 0.15); ctx.lineTo(p.x + s * 0.85, p.y - s * 0.15);
      ctx.closePath(); ctx.fill();
    }
  }

  drawLighthouse(lh, time) {
    const { ctx } = this;
    const base = this.project(lh.x, lh.baseY, lh.z);
    if (!base || base.s < 0.15) return;
    const top = this.project(lh.x, lh.baseY + lh.height, lh.z);
    if (!top) return;
    const wBase = base.s * 7.5, wTop = top.s * 4.2;
    // Tapered tower with red/white bands.
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands, t1 = (i + 1) / bands;
      const y0 = base.y + (top.y - base.y) * t0, y1 = base.y + (top.y - base.y) * t1;
      const w0 = wBase + (wTop - wBase) * t0, w1 = wBase + (wTop - wBase) * t1;
      const x0 = base.x + (top.x - base.x) * t0, x1 = base.x + (top.x - base.x) * t1;
      ctx.fillStyle = i % 2 === 0 ? '#e63946' : '#f7f3e8';
      ctx.beginPath();
      ctx.moveTo(x0 - w0 / 2, y0); ctx.lineTo(x0 + w0 / 2, y0);
      ctx.lineTo(x1 + w1 / 2, y1); ctx.lineTo(x1 - w1 / 2, y1);
      ctx.closePath(); ctx.fill();
    }
    // Lamp room + rotating glow.
    ctx.fillStyle = '#263238';
    ctx.fillRect(top.x - wTop * 0.6, top.y - top.s * 5, wTop * 1.2, top.s * 5);
    const pulse = 0.65 + 0.35 * Math.sin(time * 2.2);
    const rg = ctx.createRadialGradient(top.x, top.y - top.s * 2.5, 1, top.x, top.y - top.s * 2.5, top.s * 26 * pulse);
    rg.addColorStop(0, 'rgba(255,244,170,0.85)');
    rg.addColorStop(1, 'rgba(255,244,170,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(top.x, top.y - top.s * 2.5, top.s * 26 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff6b0';
    ctx.beginPath(); ctx.arc(top.x, top.y - top.s * 2.5, Math.max(1.5, top.s * 1.6), 0, Math.PI * 2); ctx.fill();
  }

  drawRunway(rw) {
    const { ctx } = this;
    const hl = rw.length / 2, hw = rw.width / 2;
    const corners = [
      this.project(rw.x - hw, rw.y, rw.z - hl), this.project(rw.x + hw, rw.y, rw.z - hl),
      this.project(rw.x + hw, rw.y, rw.z + hl), this.project(rw.x - hw, rw.y, rw.z + hl),
    ];
    if (corners.some((c) => !c)) {
      // Partially behind camera: draw only if centre is visible and near.
      const c = this.project(rw.x, rw.y, rw.z);
      if (!c) return;
    } else {
      this.poly(corners, '#3c4147', '#f4dc9a', 3);
      // Centreline dashes.
      for (let i = -4; i <= 4; i++) {
        const z0 = rw.z + i * 26 - 8, z1 = rw.z + i * 26 + 8;
        const a = this.project(rw.x, rw.y + 0.2, z0), b = this.project(rw.x, rw.y + 0.2, z1);
        if (a && b) {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, a.s * 1.1);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      // Threshold bars at both ends.
      for (const endZ of [rw.z - hl + 8, rw.z + hl - 8]) {
        const a = this.project(rw.x - hw * 0.8, rw.y + 0.2, endZ), b = this.project(rw.x + hw * 0.8, rw.y + 0.2, endZ);
        if (a && b) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, a.s * 2.2); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      // Edge lights.
      for (let i = -5; i <= 5; i++) {
        for (const sx of [-1, 1]) {
          const p = this.project(rw.x + sx * (hw + 2), rw.y + 0.6, rw.z + i * (rw.length / 10));
          if (p) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.s * 0.9), 0, Math.PI * 2); ctx.fill(); }
        }
      }
      // Big "09" style marking near threshold (simple bars numeral substitute: two chevrons).
      const ch1 = this.project(rw.x, rw.y + 0.2, rw.z + hl - 34);
      if (ch1) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.max(8, ch1.s * 13)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('27', ch1.x, ch1.y);
      }
    }
  }

  ringPoints(r, scale = 1) {
    // Ring plane: vertical axis Y, horizontal axis perpendicular to course heading.
    const hx = Math.cos(r.heading), hz = Math.sin(r.heading);
    const pts = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const px = r.x + hx * Math.cos(a) * r.r * scale;
      const py = r.y + Math.sin(a) * r.r * scale;
      const pz = r.z + hz * Math.cos(a) * r.r * scale;
      pts.push(this.project(px, py, pz));
    }
    return pts;
  }

  drawRing(r, state, isTarget) {
    const { ctx } = this;
    const centre = this.project(r.x, r.y, r.z);
    if (!centre || centre.cz > 2600) return;
    if (r.passed) {
      // Pulse-out: the ring you just threaded blooms and fades.
      const age = state.time - (r.passAt ?? state.time);
      if (age > 0.55) return;
      const pts = this.ringPoints(r, 1 + age * 2.4);
      if (pts.some((p) => !p)) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 0.55);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 214, 90, 0.9)';
      ctx.lineWidth = Math.max(1.5, centre.s * 2.2);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
      return;
    }
    const pts = this.ringPoints(r);
    if (pts.some((p) => !p)) return;
    const pulse = isTarget ? 1 + 0.06 * Math.sin(state.time * 6) : 1;
    ctx.save();
    ctx.lineJoin = 'round';
    // Outer glow.
    ctx.strokeStyle = isTarget ? 'rgba(255,190,40,0.35)' : 'rgba(255,190,40,0.16)';
    ctx.lineWidth = Math.max(2, centre.s * 3.4 * pulse);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    // Bright core.
    ctx.strokeStyle = isTarget ? '#ffd94d' : 'rgba(255,205,80,0.75)';
    ctx.lineWidth = Math.max(1.2, centre.s * 1.5 * pulse);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
    if (isTarget) {
      // Guiding marker: bouncing golden chevron above the ring.
      const bob = Math.sin(state.time * 4) * centre.s * 3;
      const m = this.project(r.x, r.y + r.r + 10, r.z);
      if (m) {
        ctx.fillStyle = '#ffdf4d';
        ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y + bob + centre.s * 5);
        ctx.lineTo(m.x - centre.s * 4, m.y + bob - centre.s * 3);
        ctx.lineTo(m.x + centre.s * 4, m.y + bob - centre.s * 3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }

  // ---- Effects layer (world-space, from effects.js) ----------------------
  drawRipples(state) {
    const { ctx } = this;
    ctx.save();
    for (const r of state.fx.ripples) {
      const c = this.project(r.x, 0.4, r.z);
      if (!c) continue;
      const t = r.age / r.life;
      const rx = Math.min(240, r.maxR * t * c.s);
      if (rx < 2) continue;
      ctx.strokeStyle = `rgba(230, 250, 252, ${(1 - t) * 0.42})`;
      ctx.lineWidth = Math.max(1, 2.2 * (1 - t));
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, rx * 0.30, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles(state) {
    const { ctx } = this;
    ctx.save();
    for (const pt of state.fx.particles) {
      if (!pt.alive) continue;
      const p = this.project(pt.x, pt.y, pt.z);
      if (!p) continue;
      const t = pt.age / pt.life;
      const size = clamp(pt.size * (1 + pt.grow * pt.age), 0.3, 12) * p.s * 0.10;
      if (size < 0.5) continue;
      ctx.fillStyle = `rgba(${pt.r},${pt.g},${pt.b},${(pt.alpha * (1 - t)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.min(size, 9), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawPopups(state) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    for (const pp of state.fx.popups) {
      const p = this.project(pp.x, pp.y, pp.z);
      if (!p) continue;
      const t = pp.age / pp.life;
      const alpha = t < 0.1 ? t / 0.1 : t > 0.62 ? Math.max(0, 1 - (t - 0.62) / 0.38) : 1;
      const y = p.y - pp.age * 54;
      const fs = clamp(p.s * 1.15, 16, 37);
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${fs}px monospace`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20, 30, 10, 0.65)';
      ctx.strokeText(pp.text, p.x, y);
      ctx.fillStyle = '#fff3b0';
      ctx.fillText(pp.text, p.x, y);
      if (pp.sub) {
        ctx.font = `bold ${Math.round(fs * 0.62)}px monospace`;
        ctx.lineWidth = 3;
        ctx.strokeText(pp.sub, p.x, y + fs * 0.78);
        ctx.fillStyle = '#ffd257';
        ctx.fillText(pp.sub, p.x, y + fs * 0.78);
      }
    }
    ctx.restore();
  }

  // Streaks at the frame edges that fade in at high speed.
  drawSpeedLines(state) {
    const sp = state.plane.speed;
    const t = clamp((sp - EFFECTS.speedLineSpeed) / (78 - EFFECTS.speedLineSpeed), 0, 1);
    if (t <= 0 || state.camMode === 'cockpit') return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    const tick = Math.floor(state.time * 9);
    for (let i = 0; i < 14; i++) {
      const h1 = Math.sin(i * 127.1 + tick * 311.7) * 43758.5453;
      const fy = (h1 - Math.floor(h1));
      const h2 = Math.sin(i * 269.5 + tick * 183.3) * 28001.8384;
      const fl = (h2 - Math.floor(h2));
      const y = 60 + fy * (H - 200);
      const len = (50 + fl * 120) * t;
      const left = i % 2 === 0;
      const x0 = left ? 6 : W - 6;
      const x1 = left ? 6 + len : W - 6 - len;
      ctx.globalAlpha = (0.05 + fl * 0.13) * t;
      ctx.lineWidth = 1.6 + fl * 1.6;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.restore();
  }

  drawCloud(cl, time = 0) {
    const { ctx } = this;
    // Clouds drift slowly east, wrapped around the strait.
    const driftX = ((cl.x + time * 1.1 + 900) % 1800) - 900;
    const p = this.project(driftX, cl.y, cl.z);
    if (!p) return;
    const s = p.s * cl.s;
    if (s < 4) return;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [ox, oy, r] of [[0, 0, 1], [-0.7, 0.12, 0.65], [0.7, 0.12, 0.7], [0.25, -0.18, 0.6]]) {
      ctx.beginPath(); ctx.ellipse(p.x + ox * s, p.y + oy * s * 0.4, s * 0.5 * r, s * 0.2 * r, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // The seaplane, drawn in screen space, banking/pitching with the
  // plane. TOTAL REDESIGN (revision round 3): a sleek aerobatic
  // seaplane in deep teal + white with orange accents — a rounded,
  // volumetric fuselage, a big glossy canopy, a mid wing with rounded
  // orange-tipped panels, streamlined floats, a sunburst tail fin and
  // a blurred prop disc at the nose. Golden-hour light comes from
  // ahead-left: left surfaces run bright, right surfaces fall into
  // deep teal shade. Revision round 4: drawn at the original scale
  // again (round 3's +30% read as too big) with a distinctly slimmer
  // rear — a narrower, shorter tail cone, a smaller tailplane and a
  // smaller fin, so the back of the plane looks light and tapered.
  drawPlane(state) {
    const { ctx } = this;
    const { plane } = state;
    const cx = W / 2 + plane.roll * -36;
    const cy = H * 0.565 + plane.pitch * 56;
    ctx.save();
    ctx.translate(cx, cy);

    // --- Soft shadow on the water below the plane (not banked with
    // it). Higher altitude -> smaller, fainter shadow, plus a warm
    // shimmer of reflected sunset under the fuselage. ---
    const altT = clamp((plane.y - 6) / 130, 0, 1); // 0 = low, 1 = high
    const shScale = 1.18 - altT * 0.48;
    const shAlpha = 0.30 - altT * 0.18;
    ctx.fillStyle = `rgba(3, 38, 44, ${shAlpha * 0.55})`;
    ctx.beginPath(); ctx.ellipse(0, 66, 106 * shScale, 16 * shScale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(3, 38, 44, ${shAlpha})`;
    ctx.beginPath(); ctx.ellipse(0, 65, 76 * shScale, 10.5 * shScale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 205, 110, 0.10)';
    ctx.beginPath(); ctx.ellipse(0, 63, 33 * shScale, 5.5 * shScale, 0, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(plane.roll * 0.75);

    // --- Twin floats on splayed struts, with a spreader bar. ---
    ctx.strokeStyle = '#22444a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-31, 37); ctx.lineTo(31, 37); ctx.stroke(); // spreader bar
    for (const fx of [-31, 31]) {
      ctx.strokeStyle = '#22444a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx * 0.34, 15); ctx.lineTo(fx - 2, 31); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx * 0.30, 24); ctx.lineTo(fx + 4, 32); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,245,240,0.65)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(fx * 0.34, 15); ctx.lineTo(fx - 2, 31); ctx.stroke();
      // Float body: a streamlined pontoon, white deck shading into a
      // deep teal keel, with an orange stripe along the waterline.
      const floatPath = () => {
        ctx.beginPath();
        ctx.moveTo(fx - 11.5, 33);
        ctx.quadraticCurveTo(fx - 3.5, 29.8, fx + 5.5, 30.8);
        ctx.quadraticCurveTo(fx + 12.5, 31.8, fx + 13, 36);
        ctx.quadraticCurveTo(fx + 12.5, 41, fx + 5.5, 42.2);
        ctx.lineTo(fx - 5.5, 42.6);
        ctx.quadraticCurveTo(fx - 11.5, 41.8, fx - 12.2, 37);
        ctx.quadraticCurveTo(fx - 12.4, 34.6, fx - 11.5, 33);
        ctx.closePath();
      };
      const fg = ctx.createLinearGradient(0, 29, 0, 44);
      fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.45, '#b9e6de');
      fg.addColorStop(0.8, '#2a9d8f'); fg.addColorStop(1, '#0b5a54');
      floatPath(); ctx.fillStyle = fg; ctx.fill();
      ctx.save(); floatPath(); ctx.clip();
      ctx.fillStyle = '#ff7a1a'; ctx.fillRect(fx - 12.5, 35.5, 25.5, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(fx - 12.5, 31, 25.5, 1.6);
      ctx.restore();
      floatPath(); ctx.strokeStyle = '#0a3f3c'; ctx.lineWidth = 1.8; ctx.stroke();
    }

    // --- Wing struts: lower fuselage up to the wing underside. ---
    for (const sx of [-1, 1]) {
      ctx.strokeStyle = '#07332f'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx * 11, 19); ctx.lineTo(sx * 52, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx * 10.5, 23); ctx.lineTo(sx * 60, 6); ctx.stroke();
      ctx.strokeStyle = 'rgba(190, 240, 230, 0.4)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(sx * 11, 18); ctx.lineTo(sx * 52, 2); ctx.stroke();
    }

    // --- Main wing: two panels with rounded tips. The left panel is
    // sunlit teal, the right falls into deep shade; both carry a white
    // leading edge, an orange tip cap and a glowing nav light. ---
    const wingPanel = (sx, c0, c1) => {
      const g = ctx.createLinearGradient(0, 0, sx * 118, 0);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(sx * 2, -6);
        ctx.lineTo(sx * 94, -14);
        ctx.quadraticCurveTo(sx * 114, -15.5, sx * 117, -7.5); // rounded tip
        ctx.quadraticCurveTo(sx * 115, 0.5, sx * 96, 2.5);
        ctx.lineTo(sx * 2, 8);
        ctx.closePath();
      };
      path(); ctx.fillStyle = g; ctx.fill();
      // Orange tip cap.
      ctx.save(); path(); ctx.clip();
      const tg = ctx.createLinearGradient(sx * 92, 0, sx * 118, 0);
      tg.addColorStop(0, '#ffa53d'); tg.addColorStop(1, '#ff7a1a');
      ctx.fillStyle = tg; ctx.fillRect(sx > 0 ? 92 : -118, -17, 26, 22);
      ctx.restore();
      path(); ctx.strokeStyle = '#063f3c'; ctx.lineWidth = 2; ctx.stroke();
      // White leading-edge sheen.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(sx * 4, -4.4); ctx.lineTo(sx * 94, -12.4);
      ctx.quadraticCurveTo(sx * 110, -13.6, sx * 114, -8.6); ctx.stroke();
      // Flap + aileron separation lines.
      ctx.strokeStyle = 'rgba(4, 45, 42, 0.5)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(sx * 84, -11.6); ctx.lineTo(sx * 81, 1.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx * 33, -6.2); ctx.lineTo(sx * 32, 7.4); ctx.stroke();
    };
    wingPanel(-1, '#3ecfb9', '#0d7a70');
    wingPanel(1, '#0d7a70', '#053f3b');
    // Nav lights: red on the left tip, green on the right, soft glow.
    for (const [sx, col, glow] of [[-1, '#ff5040', 'rgba(255, 64, 48, 0.45)'], [1, '#3dff8e', 'rgba(50, 255, 140, 0.45)']]) {
      const nx = sx * 116, ny = -7;
      const rg = ctx.createRadialGradient(nx, ny, 0.5, nx, ny, 10);
      rg.addColorStop(0, glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(nx, ny, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(nx, ny, 2.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(nx, ny, 1.1, 0, Math.PI * 2); ctx.fill();
    }

    // --- Tailplane: same treatment, smaller (round 4: span cut from
    // ±47 to ±34 so the rear reads light), orange tips. ---
    for (const sx of [-1, 1]) {
      const g = ctx.createLinearGradient(0, 0, sx * 34, 0);
      g.addColorStop(0, sx < 0 ? '#35c4b1' : '#0d7a70');
      g.addColorStop(1, sx < 0 ? '#0d7a70' : '#053f3b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx * 2, -43); ctx.lineTo(sx * 28, -45.5);
      ctx.quadraticCurveTo(sx * 34, -45, sx * 33, -40.5);
      ctx.quadraticCurveTo(sx * 32, -36.5, sx * 26, -35.5);
      ctx.lineTo(sx * 2, -33.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(sx * 28, -45.5); ctx.quadraticCurveTo(sx * 34, -45, sx * 33, -40.5);
      ctx.quadraticCurveTo(sx * 32, -36.5, sx * 26, -35.5); ctx.lineTo(sx * 24.5, -44.8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#063f3c'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx * 2, -43); ctx.lineTo(sx * 28, -45.5);
      ctx.quadraticCurveTo(sx * 34, -45, sx * 33, -40.5);
      ctx.quadraticCurveTo(sx * 32, -36.5, sx * 26, -35.5);
      ctx.lineTo(sx * 2, -33.5);
      ctx.closePath(); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(4, 45, 42, 0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-27, -39.5); ctx.lineTo(27, -39.5); ctx.stroke(); // elevator line

    // --- Fuselage: a rounded, volumetric body — white sunlit deck
    // flowing into teal flanks and a deep teal tail cone, with a warm
    // highlight on the left and shade creeping up the right. Round 4:
    // the tail cone below the wing tapers in sooner and ends higher
    // (y 35.5 instead of 42.5, tip ±9 instead of ±12.5), so the rear
    // of the plane looks light instead of bulky. ---
    const fuselagePath = () => {
      ctx.beginPath();
      ctx.moveTo(-9, -84);
      ctx.quadraticCurveTo(-15.5, -54, -17.5, -18);
      ctx.quadraticCurveTo(-18, 10, -9, 27);
      ctx.quadraticCurveTo(-5.5, 34.5, 0, 35.5);
      ctx.quadraticCurveTo(5.5, 34.5, 9, 27);
      ctx.quadraticCurveTo(18, 10, 17.5, -18);
      ctx.quadraticCurveTo(15.5, -54, 9, -84);
      ctx.quadraticCurveTo(0, -90.5, -9, -84);
      ctx.closePath();
    };
    const bodyGrad = ctx.createLinearGradient(0, -88, 0, 44);
    bodyGrad.addColorStop(0, '#ffffff');
    bodyGrad.addColorStop(0.34, '#e9f6f2');
    bodyGrad.addColorStop(0.62, '#63bdae');
    bodyGrad.addColorStop(0.85, '#0d7a70');
    bodyGrad.addColorStop(1, '#07332f');
    fuselagePath(); ctx.fillStyle = bodyGrad; ctx.fill();
    ctx.save();
    fuselagePath(); ctx.clip();
    // Warm sun-side highlight on the left flank.
    const warm = ctx.createLinearGradient(-19, 0, 3, 0);
    warm.addColorStop(0, 'rgba(255, 224, 160, 0.50)'); warm.addColorStop(1, 'rgba(255, 224, 160, 0)');
    ctx.fillStyle = warm; ctx.fillRect(-19, -90, 23, 134);
    // Cool deep shade on the right flank.
    const cool = ctx.createLinearGradient(4, 0, 19, 0);
    cool.addColorStop(0, 'rgba(3, 35, 45, 0)'); cool.addColorStop(1, 'rgba(3, 35, 45, 0.38)');
    ctx.fillStyle = cool; ctx.fillRect(4, -90, 15, 134);
    // A bright spine highlight down the deck.
    const spine = ctx.createLinearGradient(-5, 0, 5, 0);
    spine.addColorStop(0, 'rgba(255,255,255,0)');
    spine.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    spine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spine; ctx.fillRect(-5, -90, 10, 100);
    // Sweeping orange cheatline along the body.
    const cheat = ctx.createLinearGradient(-19, 0, 19, 0);
    cheat.addColorStop(0, '#ffa53d'); cheat.addColorStop(0.55, '#ff7a1a'); cheat.addColorStop(1, '#e85d04');
    ctx.fillStyle = cheat;
    ctx.beginPath();
    ctx.moveTo(-19, 1); ctx.quadraticCurveTo(0, 8, 19, -1);
    ctx.lineTo(19, 7); ctx.quadraticCurveTo(0, 16, -19, 9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(-19, 9.5); ctx.quadraticCurveTo(0, 16.5, 19, 7.5);
    ctx.lineTo(19, 9.5); ctx.quadraticCurveTo(0, 18.5, -19, 11.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    fuselagePath(); ctx.strokeStyle = '#0a4a45'; ctx.lineWidth = 2; ctx.stroke();
    // Panel lines across the body.
    ctx.strokeStyle = 'rgba(6, 60, 56, 0.30)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-17.5, -12); ctx.quadraticCurveTo(0, -9.5, 17.5, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10.8, 22.5); ctx.quadraticCurveTo(0, 24.5, 10.8, 22.5); ctx.stroke();
    // Exhaust stubs low on each flank.
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#22333a';
      ctx.beginPath();
      ctx.moveTo(sx * 12, 10); ctx.lineTo(sx * 17.2, 12); ctx.lineTo(sx * 16.4, 16.5); ctx.lineTo(sx * 11.5, 14.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(sx > 0 ? 12 : -17.2, 10, 5.2, 1.3);
    }
    // Tail light at the very bottom of the cone.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(0, 33.8, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, 33.8, 1.4, 0, Math.PI * 2); ctx.fill();

    // --- Vertical fin: white, with a bold orange sunburst and a teal
    // tip; rudder hinge line; antenna wire to a mast over the canopy.
    // Round 4: smaller — top at -85 instead of -96, narrower chord. ---
    const finPath = () => {
      ctx.beginPath();
      ctx.moveTo(-4, -59);
      ctx.quadraticCurveTo(-3.5, -73, 0.5, -85);
      ctx.lineTo(5, -82.5);
      ctx.quadraticCurveTo(7, -69, 6, -60);
      ctx.closePath();
    };
    const finGrad = ctx.createLinearGradient(0, -85, 0, -59);
    finGrad.addColorStop(0, '#ffffff'); finGrad.addColorStop(1, '#cfe8e2');
    finPath(); ctx.fillStyle = finGrad; ctx.fill();
    ctx.save();
    finPath(); ctx.clip();
    // Sunburst: three orange rays fanning from the fin's base.
    ctx.fillStyle = '#ff7a1a';
    for (const [x0, x1] of [[-5, -1], [0.5, 3], [5, 8.5]]) {
      ctx.beginPath();
      ctx.moveTo(-2, -57); ctx.lineTo(x0, -86); ctx.lineTo(x1, -86); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#0d7a70'; ctx.fillRect(-5, -86, 13, 4); // teal tip cap
    ctx.restore();
    finPath(); ctx.strokeStyle = '#0a4a45'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.strokeStyle = 'rgba(6, 60, 56, 0.5)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(3.4, -81); ctx.lineTo(4.8, -62); ctx.stroke(); // rudder hinge
    ctx.strokeStyle = 'rgba(20, 35, 40, 0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0.8, -83.5); ctx.lineTo(-1.5, -50); ctx.stroke(); // antenna wire
    ctx.strokeStyle = '#22444a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-1.5, -50); ctx.lineTo(-1.5, -44); ctx.stroke(); // mast

    // --- Cockpit canopy: a big glossy bubble of blue-teal glass with
    // a strong sun glint, framed in deep teal. ---
    ctx.fillStyle = '#06222b';
    ctx.beginPath(); ctx.ellipse(0, -31, 13, 23.5, 0, 0, Math.PI * 2); ctx.fill();
    const glass = ctx.createLinearGradient(0, -53, 0, -9);
    glass.addColorStop(0, '#d9fbff'); glass.addColorStop(0.4, '#39a7c9'); glass.addColorStop(1, '#0a3d5c');
    ctx.fillStyle = glass;
    ctx.beginPath(); ctx.ellipse(0, -31, 11.2, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.ellipse(-4.2, -39.5, 3.2, 9.5, -0.28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(4.2, -21, 1.7, 4.6, 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(6, 30, 40, 0.45)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -50.5); ctx.lineTo(0, -12); ctx.stroke();
    ctx.strokeStyle = '#06222b'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(0, -31, 13, 23.5, 0, 0, Math.PI * 2); ctx.stroke();
    // Orange brow stripe on the deck between canopy and prop.
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(-7.5, -60); ctx.quadraticCurveTo(0, -57.5, 7.5, -60);
    ctx.lineTo(7, -55); ctx.quadraticCurveTo(0, -52.5, -7, -55);
    ctx.closePath(); ctx.fill();

    // --- Propeller at the nose: a translucent blurred disc, three
    // blade streaks with orange tips sweeping with sim time, and a
    // glossy orange spinner. ---
    ctx.save();
    ctx.translate(0, -90); ctx.scale(1, 7 / 34);
    const disc = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    disc.addColorStop(0, 'rgba(20, 30, 34, 0.08)');
    disc.addColorStop(0.72, 'rgba(20, 30, 34, 0.05)');
    disc.addColorStop(0.95, 'rgba(20, 30, 34, 0.30)');
    disc.addColorStop(1, 'rgba(20, 30, 34, 0)');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const propA = state.time * 26;
    for (let k = 0; k < 3; k++) {
      const a = propA + (k * Math.PI * 2) / 3;
      const bx = Math.cos(a) * 31, by = -90 + Math.sin(a) * 5.9;
      ctx.strokeStyle = 'rgba(15, 22, 26, 0.52)'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -90); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(15, 22, 26, 0.36)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(0, -90, 33, 6.4, 0, 0, Math.PI * 2); ctx.stroke();
    const spinner = ctx.createLinearGradient(-5, -94, 5, -86);
    spinner.addColorStop(0, '#ffc46b'); spinner.addColorStop(0.55, '#ff7a1a'); spinner.addColorStop(1, '#d64f04');
    ctx.fillStyle = spinner;
    ctx.beginPath(); ctx.ellipse(0, -90, 5.8, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8f3403'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.ellipse(-1.8, -91.8, 1.7, 1.1, -0.4, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }


  // Cockpit view: the plane sprite is replaced by a windshield frame,
  // a dashboard hump and the instrument panel drawn larger.
  drawCockpit(state) {
    const { ctx } = this;
    ctx.save();
    // Dashboard hump across the bottom.
    const dash = ctx.createLinearGradient(0, H - 210, 0, H);
    dash.addColorStop(0, '#131c26'); dash.addColorStop(1, '#05090f');
    ctx.fillStyle = dash;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - 118);
    ctx.quadraticCurveTo(W * 0.5, H - 178, W, H - 118);
    ctx.lineTo(W, H);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 210, 90, 0.35)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - 118);
    ctx.quadraticCurveTo(W * 0.5, H - 178, W, H - 118);
    ctx.stroke();
    // Windshield pillars + top frame.
    ctx.fillStyle = '#0a1119';
    ctx.beginPath(); // left pillar
    ctx.moveTo(0, 0); ctx.lineTo(120, 0); ctx.lineTo(64, H - 130); ctx.lineTo(0, H - 90);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); // right pillar
    ctx.moveTo(W, 0); ctx.lineTo(W - 120, 0); ctx.lineTo(W - 64, H - 130); ctx.lineTo(W, H - 90);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(0, 0, W, 34); // top bar
    // Centre post hint + compass ball on the dash.
    ctx.fillStyle = '#ffd257';
    ctx.beginPath(); ctx.arc(W / 2, H - 158, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a1119';
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, H - 155);
    ctx.restore();
    // Instruments, larger: scale the standard panel up around its base.
    ctx.save();
    ctx.translate(W / 2, H);
    ctx.scale(1.3, 1.3);
    ctx.translate(-W / 2, -H);
    this.drawPanel(state);
    ctx.restore();
  }

  // ---- Instrument panel + HUD -------------------------------------------
  drawPanel(state) {
    const { ctx } = this;
    const pw = 560, ph = 128, px = (W - pw) / 2, py = H - ph - 8;
    ctx.save();
    // Panel body.
    ctx.fillStyle = 'rgba(10, 16, 24, 0.88)';
    ctx.strokeStyle = 'rgba(255, 210, 90, 0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,210,90,0.10)';
    ctx.fillRect(px + 8, py + 6, pw - 16, 3);
    const cy = py + ph / 2 + 6;
    this.gaugeHorizon(px + 92, cy, 46, state);
    this.gaugeDial(px + 218, cy, 46, {
      label: 'ALTIMETER', unit: 'FT', value: state.plane.y * 3.281, max: 600,
      ticks: [0, 100, 200, 300, 400, 500, 600], needle: '#ffd257',
    });
    this.gaugeDial(px + 344, cy, 46, {
      label: 'AIRSPEED', unit: 'KT', value: state.plane.speed * 1.944, max: 160,
      ticks: [0, 40, 80, 120, 160], needle: '#7fe3ff', redFrom: 135,
    });
    // Right block: throttle + vertical speed + stall warning.
    ctx.fillStyle = '#cfe8ff';
    ctx.font = 'bold 15px monospace'; ctx.textAlign = 'left';
    ctx.fillText('THR', px + 424, cy - 34);
    ctx.fillStyle = '#1d2b3a'; ctx.fillRect(px + 424, cy - 26, 108, 13);
    ctx.fillStyle = '#ffd257'; ctx.fillRect(px + 424, cy - 26, 108 * clamp(state.plane.throttle, 0, 1), 13);
    ctx.strokeStyle = '#5b7186'; ctx.lineWidth = 1; ctx.strokeRect(px + 424, cy - 26, 108, 13);
    ctx.fillStyle = '#cfe8ff';
    ctx.fillText(`VS ${state.vs >= 0 ? '+' : ''}${Math.round(state.vs * 196.85)} FPM`, px + 424, cy + 8);
    if (state.stalled) {
      ctx.fillStyle = (Math.floor(state.time * 4) % 2 === 0) ? '#ff5252' : '#ffb3b3';
      ctx.font = 'bold 17px monospace';
      ctx.fillText('STALL', px + 424, cy + 36);
    } else {
      ctx.fillStyle = '#8fd18a'; ctx.font = 'bold 15px monospace';
      ctx.fillText(state.gearNote || 'FLOATS DOWN', px + 424, cy + 36);
    }
    ctx.restore();
  }

  gaugeHorizon(cx, cy, r, state) {
    const { ctx } = this;
    const { plane } = state;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-plane.roll);
    const pitchPx = clamp(plane.pitch, -0.5, 0.5) * r * 1.5;
    ctx.translate(0, pitchPx);
    ctx.fillStyle = '#2f9be8'; ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 1.6);
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-r * 1.6, 0, r * 3.2, r * 1.6);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-r * 1.6, 0); ctx.lineTo(r * 1.6, 0); ctx.stroke();
    // Pitch ladder.
    ctx.font = `${Math.round(r * 0.26)}px monospace`; ctx.textAlign = 'center';
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * (r / 28);
      const wdt = deg % 20 === 0 ? r * 0.55 : r * 0.36;
      ctx.beginPath(); ctx.moveTo(-wdt, y); ctx.lineTo(wdt, y); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(Math.abs(deg)), -wdt - r * 0.22, y + 3);
      ctx.fillText(String(Math.abs(deg)), wdt + r * 0.22, y + 3);
    }
    ctx.restore();
    // Fixed aircraft symbol + bezel.
    ctx.strokeStyle = '#ffd257'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx - r * 0.18, cy); ctx.lineTo(cx, cy + r * 0.14);
    ctx.lineTo(cx + r * 0.18, cy); ctx.lineTo(cx + r * 0.55, cy);
    ctx.stroke();
    ctx.fillStyle = '#ffd257';
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d7e6f2'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // Roll pointer.
    const ra = -plane.roll;
    ctx.fillStyle = '#ffd257';
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(ra) * (r - 8), cy - Math.cos(ra) * (r - 8));
    ctx.lineTo(cx + Math.sin(ra - 0.16) * (r - 1), cy - Math.cos(ra - 0.16) * (r - 1));
    ctx.lineTo(cx + Math.sin(ra + 0.16) * (r - 1), cy - Math.cos(ra + 0.16) * (r - 1));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#cfe8ff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE', cx, cy + r + 14);
  }

  gaugeDial(cx, cy, r, cfg) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#0d1622';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d7e6f2'; ctx.lineWidth = 3; ctx.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270 degree sweep
    if (cfg.redFrom !== undefined) {
      ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, r - 5, a0 + (a1 - a0) * (cfg.redFrom / cfg.max), a1); ctx.stroke();
    }
    ctx.fillStyle = '#eaf4fc'; ctx.font = `${Math.round(r * 0.24)}px monospace`; ctx.textAlign = 'center';
    for (const t of cfg.ticks) {
      const a = a0 + (a1 - a0) * (t / cfg.max);
      const x1 = cx + Math.cos(a) * (r - 7), y1 = cy + Math.sin(a) * (r - 7);
      const x2 = cx + Math.cos(a) * (r - 14), y2 = cy + Math.sin(a) * (r - 14);
      ctx.strokeStyle = '#eaf4fc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillText(String(t), cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24) + 4);
    }
    const v = clamp(cfg.value, 0, cfg.max);
    const a = a0 + (a1 - a0) * (v / cfg.max);
    ctx.strokeStyle = cfg.needle; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7);
    ctx.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); ctx.stroke();
    ctx.fillStyle = '#d7e6f2';
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#cfe8ff';
    ctx.fillText(cfg.label, cx, cy + r * 0.52);
    ctx.font = '10px monospace';
    ctx.fillText(`${Math.round(cfg.value)} ${cfg.unit}`, cx, cy + r * 0.74);
    ctx.restore();
    ctx.fillStyle = '#cfe8ff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(cfg.label, cx, cy + r + 14);
  }
}
