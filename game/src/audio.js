// WebAudio synth — audio.js. No external files: engine loop (pitch tied
// to throttle), wind noise (tied to speed), water lap (near the surface),
// a relaxed ambient pad loop, combo-pitched ring dings, splash, success
// arpeggio and a crash thud. Everything routes through one master gain,
// so M (mute) silences the whole mix. Audio starts on a user gesture;
// every call is guarded so the game plays silently without WebAudio.
import { AUDIO } from './config.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineOsc = null; this.engineOsc2 = null;
    this.engineGain = null; this.engineFilter = null;
    this.windGain = null; this.windFilter = null;
    this.waterGain = null;
    this.padOscs = []; this.padGain = null;
    this._chordIdx = 0; this._nextChordAt = 0;
  }

  _noiseBuffer(c, seconds = 2) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.masterLevel;
      this.master.connect(c.destination);

      // --- Engine: two detuned oscillators through a lowpass. -------------
      this.engineOsc = c.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
      this.engineOsc2 = c.createOscillator(); this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 28;
      this.engineFilter = c.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 320;
      this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start(); this.engineOsc2.start();

      // --- Wind: looped noise through a bandpass. --------------------------
      const windSrc = c.createBufferSource(); windSrc.buffer = this._noiseBuffer(c); windSrc.loop = true;
      this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 480; this.windFilter.Q.value = 0.6;
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
      windSrc.start();

      // --- Water lap: looped noise through a lowpass, gain set by height. --
      const waterSrc = c.createBufferSource(); waterSrc.buffer = this._noiseBuffer(c, 3); waterSrc.loop = true; waterSrc.playbackRate.value = 0.5;
      const waterFilter = c.createBiquadFilter(); waterFilter.type = 'lowpass'; waterFilter.frequency.value = 260;
      this.waterGain = c.createGain(); this.waterGain.gain.value = 0;
      waterSrc.connect(waterFilter); waterFilter.connect(this.waterGain); this.waterGain.connect(this.master);
      waterSrc.start();

      // --- Ambient pad: three soft triangles gliding between chords. -------
      this.padGain = c.createGain(); this.padGain.gain.value = 0;
      const padFilter = c.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
      this.padGain.connect(padFilter); padFilter.connect(this.master);
      const chord = CHORDS[0];
      for (let i = 0; i < 3; i++) {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = chord[i];
        o.detune.value = (i - 1) * 4;
        o.connect(this.padGain); o.start();
        this.padOscs.push(o);
      }
      this.padGain.gain.setTargetAtTime(AUDIO.musicLevel, c.currentTime, 2.5);
      this._nextChordAt = c.currentTime + 4;
    } catch (e) { this.ctx = null; }
  }

  // Called every frame while playing: engine + wind follow the plane,
  // and the pad chord progression advances on its own clock.
  setEngine(throttle, speedNorm) {
    if (!this.ctx || !this.engineOsc) return;
    try {
      const t = this.ctx.currentTime;
      const f = 48 + throttle * 55 + speedNorm * 22;
      this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
      this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      this.engineFilter.frequency.setTargetAtTime(240 + throttle * 520, t, 0.1);
      this.engineGain.gain.setTargetAtTime(AUDIO.engineLevel * (0.25 + throttle), t, 0.1);
      if (this.windGain) {
        this.windGain.gain.setTargetAtTime(AUDIO.windLevel * speedNorm * speedNorm, t, 0.15);
        this.windFilter.frequency.setTargetAtTime(380 + speedNorm * 640, t, 0.2);
      }
      if (t >= this._nextChordAt && this.padOscs.length) {
        this._chordIdx = (this._chordIdx + 1) % CHORDS.length;
        const chord = CHORDS[this._chordIdx];
        this.padOscs.forEach((o, i) => o.frequency.linearRampToValueAtTime(chord[i], t + 1.6));
        this._nextChordAt = t + 4;
      }
    } catch (e) { /* ignore */ }
  }

  // Water lap loudness: 0..1 proximity to the surface over water.
  setWater(proximity) {
    if (!this.ctx || !this.waterGain) return;
    try {
      this.waterGain.gain.setTargetAtTime(AUDIO.waterLevel * proximity, this.ctx.currentTime, 0.25);
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
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  // Ring ding: the base note climbs by dingStepSemis per combo level,
  // so a hot streak literally sounds higher and brighter.
  ding(combo = 0) {
    const base = AUDIO.dingBase * Math.pow(2, (combo * AUDIO.dingStepSemis) / 12);
    this.tone(base, 0.32, 'sine', 0.15);
    this.tone(base * 1.5, 0.46, 'sine', 0.12, 0.06);
    this.tone(base * 2, 0.55, 'triangle', 0.07, 0.11);
  }
  chime() { this.ding(0); } // legacy alias
  miss() { this.tone(220, 0.25, 'triangle', 0.06, 0, 160); }
  success() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.13, i * 0.11)); }
  splash() {
    if (!this.ctx || this.muted) return;
    try {
      const c = this.ctx, t0 = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this._noiseBuffer(c, 0.6);
      const f = c.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t0);
      f.frequency.exponentialRampToValueAtTime(180, t0 + 0.55);
      const g = c.createGain();
      g.gain.setValueAtTime(0.30, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t0);
    } catch (e) { /* ignore */ }
  }
  crash() {
    if (!this.ctx || this.muted) return;
    try {
      const c = this.ctx, t0 = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this._noiseBuffer(c, 0.45);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const g = c.createGain(); g.gain.setValueAtTime(0.35, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t0);
    } catch (e) { /* ignore */ }
    this.tone(70, 0.5, 'sine', 0.3, 0, 34);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      try { this.master.gain.setTargetAtTime(this.muted ? 0 : AUDIO.masterLevel, this.ctx.currentTime, 0.04); } catch (e) {}
    }
    return this.muted;
  }
}

// Am — F — C — G, low and warm (Hz).
const CHORDS = [
  [110.0, 164.8, 261.6],
  [87.3, 174.6, 220.0],
  [98.0, 196.0, 261.6],
  [98.0, 146.8, 246.9],
];
