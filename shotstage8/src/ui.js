// UI — ui.js: HUD, overlay screens and touch controls. Everything here
// draws in screen space AFTER the world render (main.js calls these
// from drawScreen). The instrument panel itself stays in render.js.
import { W, H, DIFFICULTY } from './config.js';
import { clamp, angDiff } from './random.js';

function fmtTime(t) {
  const mm = String(Math.floor(Math.max(0, t) / 60)).padStart(2, '0');
  const ss = String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

// --- HUD ---------------------------------------------------------------------
export function drawHUD(ctx, state, project) {
  const { plane } = state;
  const altFt = Math.round(plane.y * 3.281);
  const spdKt = Math.round(plane.speed * 1.944);
  const hdg = Math.round(((plane.heading * 180 / Math.PI) % 360 + 360) % 360);
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
  ctx.fillText(`TIME   ${fmtTime(state.elapsed)}`, W - 296, 74);
  ctx.fillStyle = '#ffd257';
  const remaining = state.phase === 'runway' ? 0 : (state.totalRings - state.currentRing);
  ctx.fillText(state.phase === 'runway' ? 'LAND ON RUNWAY!' : `RINGS LEFT  ${remaining}`, W - 296, 104);
  // Combo streak, under the score block.
  if (state.combo >= 2) {
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffd94d';
    ctx.fillText(`COMBO ×${state.combo}`, W - 296, 148);
  }
  // Ring progress pips, top centre.
  const n = state.totalRings;
  const gap = 21, r0 = 6;
  const x0 = W / 2 - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * gap, y = 24;
    ctx.beginPath(); ctx.arc(x, y, r0, 0, Math.PI * 2);
    if (i < state.currentRing) { ctx.fillStyle = '#ffd94d'; ctx.fill(); }
    else if (i === state.currentRing && state.phase === 'rings') {
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255, 217, 77, 0.35)'; ctx.fill();
    } else { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // Mini-compass under the pips: heading ticks + gold target bearing.
  const ccx = W / 2, ccy = 58, cr = 19;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.55)';
  ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,90,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
  for (const [deg, ch] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const a = (deg * Math.PI / 180) - plane.heading;
    const x = ccx + Math.sin(a) * (cr - 6), y = ccy - Math.cos(a) * (cr - 6) + 3.5;
    ctx.fillStyle = deg === 0 ? '#ff8a75' : '#cfe8ff';
    ctx.fillText(ch, x, y);
  }
  if (state.target && state.phase !== 'done') {
    const tb = Math.atan2(state.target.x - plane.x, -(state.target.z - plane.z));
    const a = tb - plane.heading;
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath(); ctx.arc(ccx + Math.sin(a) * (cr + 1), ccy - Math.cos(a) * (cr + 1), 3, 0, Math.PI * 2); ctx.fill();
  }
  // Target guidance label / off-screen arrow.
  const target = state.target;
  if (target && state.phase !== 'done') {
    const p = project(target.x, target.y, target.z);
    ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
    if (p && p.cz > 0) {
      const dist = Math.round(Math.hypot(target.x - plane.x, target.z - plane.z));
      ctx.fillStyle = 'rgba(8,14,22,0.55)';
      const label = state.phase === 'runway' ? `RUNWAY ${dist} m` : `RING ${state.currentRing + 1} — ${dist} m`;
      const tw = ctx.measureText(label).width + 22;
      const lx = clamp(p.x, 70, W - 70), ly = clamp(p.y - 66, 128, H - 210);
      ctx.beginPath(); ctx.roundRect(lx - tw / 2, ly, tw, 28, 8); ctx.fill();
      ctx.fillStyle = '#ffd94d';
      ctx.fillText(label, lx, ly + 20);
    } else {
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
  // Camera mode + mute indicators.
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(207, 232, 255, 0.8)';
  ctx.fillText(`CAM ${(state.camMode || 'chase').toUpperCase()} (C)`, 16, H - 148);
  if (state.muted) {
    ctx.fillStyle = '#ffb3b3'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'right';
    ctx.fillText('MUTED (M)', W - 18, H - 148);
  }
  ctx.restore();
}

// --- Overlay screens -----------------------------------------------------------
function veil(ctx, alpha = 0.5) {
  ctx.fillStyle = `rgba(8, 15, 26, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

export function drawTitle(ctx, view) {
  ctx.save();
  veil(ctx, 0.42);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.strokeStyle = '#7a4d00'; ctx.lineWidth = 3;
  ctx.font = 'bold 74px Georgia, serif';
  ctx.strokeText('GOLDEN STRAIT RUN', W / 2, 150);
  ctx.fillText('GOLDEN STRAIT RUN', W / 2, 150);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px Georgia, serif';
  ctx.fillText('A golden-hour seaplane flight through the glowing rings of the strait', W / 2, 190);
  // Difficulty selector (keys 1/2/3, or tap a name).
  ctx.font = 'bold 21px monospace';
  const keys = Object.keys(DIFFICULTY);
  const labels = keys.map((k, i) => `${i + 1} ${DIFFICULTY[k].label}`);
  const widths = labels.map((l) => ctx.measureText(l).width + 34);
  const totalW = widths.reduce((a, b) => a + b, 0) + (keys.length - 1) * 14;
  let dx = W / 2 - totalW / 2;
  const dy = 226;
  keys.forEach((k, i) => {
    const w = widths[i];
    const sel = view.difficulty === k;
    ctx.fillStyle = sel ? 'rgba(255, 210, 90, 0.92)' : 'rgba(10, 20, 36, 0.72)';
    ctx.beginPath(); ctx.roundRect(dx, dy, w, 38, 9); ctx.fill();
    ctx.strokeStyle = sel ? '#fff3b0' : 'rgba(255,210,90,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = sel ? '#23180a' : '#dff2ff';
    ctx.fillText(labels[i], dx + w / 2, dy + 26);
    dx += w + 14;
  });
  if (view.best) {
    ctx.font = '19px monospace';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`BEST  ${view.best.score}   ·   ${fmtTime(view.best.time)}   ·   ${view.best.medal || ''} ${view.best.rating || ''}`, W / 2, 300);
  }
  ctx.font = 'bold 27px monospace';
  ctx.fillStyle = (Math.floor(view.time * 1.6) % 2 === 0) ? '#ffe9a8' : '#ffffff';
  ctx.fillText('CLICK OR PRESS ENTER TO FLY', W / 2, view.best ? 344 : 330);
  ctx.font = '19px monospace';
  ctx.fillStyle = '#dff2ff';
  const lines = [
    'ARROW KEYS / A D — pitch & roll        W / S — throttle',
    'MOUSE — steer toward the pointer       C — camera (chase / cockpit / orbit)',
    'Fly through all 12 golden rings, then land gently',
    'on the coastal runway: slow, low, aligned, soft sink.',
    'Chain rings for COMBO bonuses — the ding climbs as you streak.',
    'R — restart      P — pause      M — mute      T — autopilot demo',
    'Touch: left thumb = stick, right thumb = throttle',
  ];
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 396 + i * 29));
  ctx.restore();
}

export function drawCountdown(ctx, n) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 150px Georgia, serif';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(90, 50, 0, 0.8)';
  ctx.strokeText(String(n), W / 2, H / 2 - 30);
  ctx.fillStyle = '#ffd94d';
  ctx.fillText(String(n), W / 2, H / 2 - 30);
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('GET READY…', W / 2, H / 2 + 26);
  ctx.restore();
}

export function drawPause(ctx, view) {
  ctx.save();
  veil(ctx, 0.6);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aee6ff';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.fillText('PAUSED', W / 2, 240);
  ctx.font = '21px monospace';
  ctx.fillStyle = '#dff2ff';
  const lines = [
    'P — resume        R — restart',
    `C — camera: ${(view.camMode || 'chase').toUpperCase()}`,
    `M — sound: ${view.muted ? 'OFF' : 'ON'}`,
    '',
    'Take a breath — the strait waits.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 310 + i * 34));
  ctx.restore();
}

const MEDAL_COLORS = { GOLD: '#ffd94d', SILVER: '#dfe7ee', BRONZE: '#e09a5a' };

export function drawResults(ctx, state) {
  ctx.save();
  veil(ctx, 0.62);
  ctx.textAlign = 'center';
  const rating = state.rating || 'GOOD';
  ctx.fillStyle = rating === 'PERFECT' ? '#8fd18a' : rating === 'GOOD' ? '#ffe9a8' : '#ffb37a';
  ctx.font = 'bold 56px Georgia, serif';
  ctx.fillText(`${rating} LANDING!`, W / 2, 218);
  if (state.medal) {
    ctx.font = 'bold 30px monospace';
    ctx.fillStyle = MEDAL_COLORS[state.medal] || '#ffffff';
    ctx.fillText(`★ ${state.medal} MEDAL ★`, W / 2, 268);
  }
  ctx.font = '23px monospace';
  ctx.fillStyle = '#ffffff';
  const lines = [
    `FINAL SCORE   ${state.score}`,
    `RINGS  ${state.ringsHit} / ${state.totalRings}      TIME  ${fmtTime(state.finalTime)}`,
    `BEST COMBO  ×${Math.max(1, state.maxStreak)}`,
  ];
  if (state.best) {
    lines.push(state.newBest ? 'NEW BEST SCORE!' :
      `BEST  ${state.best.score}   ·   ${fmtTime(state.best.time)}`);
  }
  lines.push('', 'Press R or click — COBA LAGI!');
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 322 + i * 33));
  ctx.restore();
}

export function drawCrash(ctx, state) {
  ctx.save();
  veil(ctx, 0.62);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff7b6b';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.fillText('CRASHED', W / 2, 240);
  ctx.fillStyle = '#ffffff';
  ctx.font = '23px monospace';
  ctx.fillText(state.crashReason, W / 2, 292);
  ctx.font = '21px monospace';
  ctx.fillStyle = '#dff2ff';
  ctx.fillText(`SCORE   ${state.score}      RINGS  ${state.ringsHit} / ${state.totalRings}`, W / 2, 348);
  ctx.fillText('Press R or click to try again', W / 2, 388);
  ctx.restore();
}

// --- Touch controls -------------------------------------------------------------
// Left virtual joystick + right throttle slider, drawn only when a
// touch has been seen (state.touch.active).
export function drawTouchControls(ctx, state) {
  const t = state.touch;
  if (!t || !t.active) return;
  ctx.save();
  // Joystick (base follows the thumb's start point).
  const bx = t.joyBaseX * W, by = t.joyBaseY * H;
  ctx.fillStyle = 'rgba(10, 20, 36, 0.35)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(bx, by, 56, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const kx = bx + t.joyX * 34, ky = by + t.joyY * 34;
  ctx.fillStyle = 'rgba(255, 210, 90, 0.75)';
  ctx.beginPath(); ctx.arc(kx, ky, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(8, 14, 22, 0.8)';
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('STICK', bx, by + 76);
  // Throttle slider on the right edge.
  const sx = W - 58, y0 = H * 0.30, y1 = H * 0.78;
  ctx.fillStyle = 'rgba(10, 20, 36, 0.35)';
  ctx.beginPath(); ctx.roundRect(sx - 16, y0, 32, y1 - y0, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.stroke();
  const ty = y1 - state.plane.throttle * (y1 - y0);
  ctx.fillStyle = '#ffd257';
  ctx.beginPath(); ctx.roundRect(sx - 22, ty - 13, 44, 26, 8); ctx.fill();
  ctx.fillStyle = 'rgba(8, 14, 22, 0.85)';
  ctx.fillText('THR', sx, y0 - 12);
  ctx.restore();
}
