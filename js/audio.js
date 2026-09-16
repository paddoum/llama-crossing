// Tiny WebAudio synth: no audio files, everything is oscillators + filtered noise.
export class Sfx {
  constructor(muted = false) {
    this.ctx = null;
    this.master = null;
    this.muted = muted;
    this.ambient = null;
  }

  // Must be called from a user gesture (iOS). Safe to call repeatedly.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, gain = 0.3, cutoff = 800, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  noiseBuffer(seconds) {
    const n = Math.ceil(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // --- game sounds ---
  pickup() {
    this.tone(880, 0.08, { type: 'square', gain: 0.10 });
    this.tone(1320, 0.14, { type: 'square', gain: 0.10, delay: 0.07 });
  }
  hit() {
    this.noise(0.28, 0.5, 700);
    this.tone(170, 0.3, { type: 'sawtooth', gain: 0.18, slide: -110 });
  }
  splash() { this.noise(0.14, 0.12, 1400); }
  scrape() { this.noise(0.1, 0.06, 500); }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.18, delay: i * 0.12 }));
    this.tone(1318, 0.5, { type: 'triangle', gain: 0.16, delay: 0.5 });
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', gain: 0.16, delay: i * 0.16 }));
  }
  tap() { this.tone(600, 0.05, { type: 'square', gain: 0.06 }); }

  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.07;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.ambient = src;
  }
  stopAmbient() {
    if (this.ambient) { try { this.ambient.stop(); } catch {} this.ambient = null; }
  }
}
