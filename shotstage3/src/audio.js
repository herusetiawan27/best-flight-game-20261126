// Tiny WebAudio synth: engine hum, ring chime, success arpeggio, crash thud.
// No external files. Everything is guarded so the game plays silently if
// WebAudio is unavailable. Audio only starts on a user gesture.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.engineOsc = c.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const osc2 = c.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 28;
      this.engineFilter = c.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineGain = c.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(this.engineFilter);
      osc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(c.destination);
      this.engineOsc.start();
      osc2.start();
      this._osc2 = osc2;
    } catch (e) { this.ctx = null; }
  }
  setEngine(throttle, speedNorm) {
    if (!this.ctx || !this.engineOsc) return;
    try {
      const t = this.ctx.currentTime;
      const f = 48 + throttle * 55 + speedNorm * 22;
      this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
      if (this._osc2) this._osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      this.engineFilter.frequency.setTargetAtTime(240 + throttle * 520, t, 0.1);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.015 + throttle * 0.05, t, 0.1);
    } catch (e) { /* ignore */ }
  }
  tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    try {
      const c = this.ctx, t0 = c.currentTime + when;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* ignore */ }
  }
  chime() { this.tone(1318, 0.35, 'sine', 0.14); this.tone(1760, 0.5, 'sine', 0.12, 0.07); this.tone(2637, 0.6, 'triangle', 0.07, 0.12); }
  miss() { this.tone(220, 0.25, 'triangle', 0.06, 0, 160); }
  success() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.13, i * 0.11)); }
  crash() {
    if (!this.ctx || this.muted) return;
    try {
      const c = this.ctx, t0 = c.currentTime;
      const len = c.sampleRate * 0.4;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const g = c.createGain(); g.gain.setValueAtTime(0.35, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0);
    } catch (e) { /* ignore */ }
    this.tone(70, 0.5, 'sine', 0.3, 0, 34);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.engineGain) {
      try { this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.03, this.ctx.currentTime, 0.05); } catch (e) {}
    }
    return this.muted;
  }
}
