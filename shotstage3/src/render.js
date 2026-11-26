// Pseudo-3D renderer: own perspective projection + painter's algorithm
// on Canvas 2D. Camera chases the plane; the plane itself is drawn as a
// detailed 2D seaplane in the centre of the frame (banking with roll),
// with a glowing instrument panel overlaid at the bottom.
import { W, H, FOCAL } from './config.js';
import { clamp, angDiff } from './random.js';

export class Renderer {
  constructor(ctx) { this.ctx = ctx; this.cam = null; }

  // Build camera basis from plane state. Camera sits behind + above.
  setCamera(plane) {
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
    this.cam = {
      x: plane.x - fwd.x * dist, y: plane.y - fwd.y * dist + height, z: plane.z - fwd.z * dist,
      fwd, right, up, yaw, pitch: plane.pitch * 0.55,
    };
    // Keep camera above the waves visually.
    if (this.cam.y < 4) this.cam.y = 4;
  }

  // World point -> screen {x, y, s(scale), cz} or null if behind camera.
  project(x, y, z) {
    const c = this.cam;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const cx = dx * c.right.x + dy * c.right.y + dz * c.right.z;
    const cy = dx * c.up.x + dy * c.up.y + dz * c.up.z;
    const cz = dx * c.fwd.x + dy * c.fwd.y + dz * c.fwd.z;
    if (cz < 2) return null;
    const s = FOCAL / cz;
    return { x: W / 2 + cx * s, y: H / 2 - cy * s, s, cz };
  }

  render(state) {
    const { ctx } = this;
    const { world, plane, time } = state;
    this.setCamera(plane);
    this.drawSky(state);
    this.drawSea(state);

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
    world.rings.forEach((r, idx) => { if (!r.passed) items.push({ d: camZ(r.x, r.z), kind: 'ring', o: r, idx }); });
    for (const cl of world.clouds) items.push({ d: camZ(cl.x, cl.z), kind: 'cloud', o: cl });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.d < -40) continue;
      if (it.kind === 'island') this.drawIsland(it.o);
      else if (it.kind === 'boat') this.drawBoat(it.o);
      else if (it.kind === 'lighthouse') this.drawLighthouse(it.o, time);
      else if (it.kind === 'runway') this.drawRunway(it.o);
      else if (it.kind === 'ring') this.drawRing(it.o, state, it.idx === state.currentRing);
      else if (it.kind === 'cloud') this.drawCloud(it.o);
    }

    this.drawPlane(state);
    this.drawPanel(state);
    this.drawHUD(state);
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
    const sun = this.project(-260, 95, -2600);
    const sx = sun ? sun.x : W * 0.3, sy = sun ? clamp(sun.y, 40, H * 0.55) : H * 0.3;
    const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 190);
    rg.addColorStop(0, 'rgba(255,246,200,0.95)');
    rg.addColorStop(0.18, 'rgba(255,214,110,0.75)');
    rg.addColorStop(1, 'rgba(255,190,80,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(sx, sy, 190, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
  }

  drawSea(state) {
    const { ctx } = this;
    // Sea plane: fill below horizon, then glitter lines + sun path.
    const horizonY = H / 2 - Math.tan(this.cam.pitch) * FOCAL * 0.9;
    const hy = clamp(horizonY, H * 0.2, H * 0.75);
    const g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, '#39c2c9');
    g.addColorStop(0.35, '#1595ad');
    g.addColorStop(1, '#0a5f83');
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, H - hy);
    // Projected latitude lines give a sense of speed over the water.
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1.5;
    const pz = Math.floor(this.cam.z / 60) * 60;
    for (let i = 0; i < 14; i++) {
      const z = pz - i * 60;
      const a = this.project(-900, 0, z), b = this.project(900, 0, z);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    // Sun glitter path.
    ctx.fillStyle = 'rgba(255,220,130,0.10)';
    ctx.beginPath();
    ctx.moveTo(W * 0.22, hy); ctx.lineTo(W * 0.38, hy); ctx.lineTo(W * 0.52, H); ctx.lineTo(W * 0.05, H);
    ctx.closePath(); ctx.fill();
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

  drawIsland(isl) {
    const { ctx } = this;
    const centre = this.project(isl.x, 2, isl.z);
    if (!centre || centre.cz > 3200) return;
    // Sandy beach disc at sea level, then a green dome disc raised by height.
    const beach = this.circlePoints(isl.x, isl.z, isl.r * 1.12, 1.2);
    this.poly(beach, '#f4dc9a');
    const lift = isl.h;
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
    // Palm trees: little trunk + frond star.
    for (const t of isl.trees) {
      const p = this.project(t.x, 3 + lift * 0.35, t.z);
      if (!p || p.s < 0.25) continue;
      const s = p.s * t.s * 14;
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - s); ctx.stroke();
      ctx.strokeStyle = '#1d7a43'; ctx.lineWidth = Math.max(1, s * 0.11);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + Math.cos(a) * s * 0.55, p.y - s + Math.sin(a) * s * 0.3 - s * 0.12); ctx.stroke();
      }
    }
  }

  drawBoat(b) {
    const { ctx } = this;
    const p = this.project(b.x, 0, b.z);
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

  ringPoints(r) {
    // Ring plane: vertical axis Y, horizontal axis perpendicular to course heading.
    const hx = Math.cos(r.heading), hz = Math.sin(r.heading);
    const pts = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const px = r.x + hx * Math.cos(a) * r.r;
      const py = r.y + Math.sin(a) * r.r;
      const pz = r.z + hz * Math.cos(a) * r.r;
      pts.push(this.project(px, py, pz));
    }
    return pts;
  }

  drawRing(r, state, isTarget) {
    const { ctx } = this;
    const pts = this.ringPoints(r);
    if (pts.some((p) => !p)) return;
    const centre = this.project(r.x, r.y, r.z);
    if (!centre || centre.cz > 2600) return;
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

  drawCloud(cl) {
    const { ctx } = this;
    const p = this.project(cl.x, cl.y, cl.z);
    if (!p) return;
    const s = p.s * cl.s;
    if (s < 4) return;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [ox, oy, r] of [[0, 0, 1], [-0.7, 0.12, 0.65], [0.7, 0.12, 0.7], [0.25, -0.18, 0.6]]) {
      ctx.beginPath(); ctx.ellipse(p.x + ox * s, p.y + oy * s * 0.4, s * 0.5 * r, s * 0.2 * r, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // The seaplane, drawn in screen space, banking/pitching with the plane.
  drawPlane(state) {
    const { ctx } = this;
    const { plane } = state;
    const cx = W / 2 + plane.roll * -34;
    const cy = H * 0.56 + plane.pitch * 46;
    const S = 1.0; // plane draw scale
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(plane.roll * 0.75);
    ctx.scale(S, S);
    // Shadow-blob glow under plane (golden rim light).
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 44, 66, 10, 0, 0, Math.PI * 2); ctx.fill();
    // Floats (seaplane pontoons).
    ctx.fillStyle = '#e8ecf1';
    ctx.strokeStyle = '#7c8794'; ctx.lineWidth = 2;
    for (const fx of [-30, 30]) {
      ctx.beginPath();
      ctx.moveTo(fx - 9, 30); ctx.lineTo(fx + 11, 30); ctx.lineTo(fx + 14, 38);
      ctx.lineTo(fx + 6, 43); ctx.lineTo(fx - 8, 41); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#54606c';
      ctx.beginPath(); ctx.moveTo(fx - 2, 12); ctx.lineTo(fx + 2, 31); ctx.stroke();
      ctx.strokeStyle = '#7c8794';
    }
    // Main wing (behind fuselage from chase view).
    const wingGrad = ctx.createLinearGradient(-118, 0, 118, 0);
    wingGrad.addColorStop(0, '#d8433c'); wingGrad.addColorStop(0.5, '#f0564a'); wingGrad.addColorStop(1, '#d8433c');
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.moveTo(-118, 6); ctx.lineTo(-30, -6); ctx.lineTo(30, -6); ctx.lineTo(118, 6);
    ctx.lineTo(104, 16); ctx.lineTo(-104, 16); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8f231d'; ctx.lineWidth = 2; ctx.stroke();
    // Wing tips in gold.
    ctx.fillStyle = '#ffd257';
    ctx.fillRect(-118, 5, 14, 10); ctx.fillRect(104, 5, 14, 10);
    // Tailplane.
    ctx.fillStyle = '#f0564a';
    ctx.beginPath();
    ctx.moveTo(-46, -38); ctx.lineTo(46, -38); ctx.lineTo(38, -30); ctx.lineTo(-38, -30); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8f231d'; ctx.stroke();
    // Fuselage (seen from behind/above): tapered body going up-screen.
    const body = ctx.createLinearGradient(0, -64, 0, 34);
    body.addColorStop(0, '#fdfdfd'); body.addColorStop(0.6, '#eef1f4'); body.addColorStop(1, '#c9d2da');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-11, -66);
    ctx.quadraticCurveTo(-19, -20, -17, 18);
    ctx.quadraticCurveTo(-15, 34, 0, 36);
    ctx.quadraticCurveTo(15, 34, 17, 18);
    ctx.quadraticCurveTo(19, -20, 11, -66);
    ctx.quadraticCurveTo(0, -72, -11, -66);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7c8794'; ctx.lineWidth = 2; ctx.stroke();
    // Red cheatline.
    ctx.fillStyle = '#d8433c';
    ctx.fillRect(-17, 8, 34, 6);
    // Vertical fin.
    ctx.fillStyle = '#ffd257';
    ctx.beginPath();
    ctx.moveTo(-3, -68); ctx.lineTo(0, -92); ctx.lineTo(5, -90); ctx.lineTo(7, -66); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#a87b12'; ctx.stroke();
    // Cockpit canopy.
    ctx.fillStyle = '#274b63';
    ctx.beginPath(); ctx.ellipse(0, -26, 9, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,220,255,0.85)';
    ctx.beginPath(); ctx.ellipse(-3, -32, 4, 9, -0.2, 0, Math.PI * 2); ctx.fill();
    // Propeller arc (top of fuselage, spinning blur) + spinner.
    ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, -70, 30, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(0, -70, 4, 0, Math.PI * 2); ctx.fill();
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

  drawHUD(state) {
    const { ctx } = this;
    const { plane } = state;
    const altFt = Math.round(plane.y * 3.281);
    const spdKt = Math.round(plane.speed * 1.944);
    let hdg = Math.round(((plane.heading * 180 / Math.PI) % 360 + 360) % 360);
    ctx.save();
    // Top-left flight data block.
    ctx.fillStyle = 'rgba(8, 14, 22, 0.66)';
    ctx.beginPath(); ctx.roundRect(14, 12, 300, 108, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,90,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = 'bold 21px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`ALTITUDE  ${altFt} FT`, 28, 44);
    ctx.fillStyle = '#aee6ff';
    ctx.fillText(`SPEED     ${spdKt} KT`, 28, 74);
    ctx.fillStyle = '#d9ffd0';
    ctx.fillText(`HEADING   ${String(hdg).padStart(3, '0')}°`, 28, 104);
    // Top-right: score / timer / rings.
    ctx.fillStyle = 'rgba(8, 14, 22, 0.66)';
    ctx.beginPath(); ctx.roundRect(W - 314, 12, 300, 108, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,90,0.4)'; ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`SCORE  ${state.score}`, W - 296, 44);
    ctx.fillStyle = '#ffffff';
    const t = Math.max(0, state.elapsed);
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0');
    ctx.fillText(`TIME   ${mm}:${ss}`, W - 296, 74);
    ctx.fillStyle = '#ffd257';
    const remaining = state.phase === 'runway' ? 0 : (state.totalRings - state.currentRing);
    ctx.fillText(state.phase === 'runway' ? 'LAND ON RUNWAY!' : `RINGS LEFT  ${remaining}`, W - 296, 104);
    // Target guidance: arrow at screen edge / centre reticle info.
    const target = state.target;
    if (target && state.phase !== 'done') {
      const p = this.project(target.x, target.y, target.z);
      ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
      if (p && p.cz > 0) {
        const dist = Math.round(Math.hypot(target.x - plane.x, target.z - plane.z));
        ctx.fillStyle = 'rgba(8,14,22,0.55)';
        const label = state.phase === 'runway' ? `RUNWAY ${dist} m` : `RING ${state.currentRing + 1} — ${dist} m`;
        const tw = ctx.measureText(label).width + 22;
        ctx.beginPath(); ctx.roundRect(clamp(p.x, 70, W - 70) - tw / 2, clamp(p.y - 66, 128, H - 210), tw, 28, 8); ctx.fill();
        ctx.fillStyle = '#ffd94d';
        ctx.fillText(label, clamp(p.x, 70, W - 70), clamp(p.y - 66, 128, H - 210) + 20);
      } else {
        // Off-screen: arrow pointing toward the target bearing.
        const rel = angDiff(Math.atan2(target.x - plane.x, -(target.z - plane.z)), plane.heading);
        const ax = W / 2 + Math.sin(rel) * 120, ay = 150;
        ctx.save();
        ctx.translate(ax, ay); ctx.rotate(rel);
        ctx.fillStyle = '#ffd94d';
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(11, 10); ctx.lineTo(0, 3); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffd94d';
        ctx.fillText('FOLLOW THE ARROW', W / 2, 196);
      }
    }
    if (state.muted) {
      ctx.fillStyle = '#ffb3b3'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'right';
      ctx.fillText('MUTED (M)', W - 18, H - 148);
    }
    ctx.restore();
  }
}
