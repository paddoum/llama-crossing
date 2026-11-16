// Tiny WebAudio synth: no audio files, everything is oscillators + filtered noise.

// The llama's dance is driven at the same tempo over in render3d.js. It
// touches down on every eighth, so the kick on the beat lands on every other
// hop -- which is what makes the groove read as the thing it is dancing to.
const DANCE_BPM = 126;

export class Sfx {
  constructor(muted = false) {
    this.ctx = null;
    this.master = null;
    this.muted = muted;
    this.ambient = null;
    this.dance = null;
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

  tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0, dest = null } = {}) {
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
    osc.connect(g).connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, gain = 0.3, cutoff = 800, delay = 0, type = 'lowpass', dest = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest || this.master);
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
  spit() {
    this.noise(0.09, 0.22, 2600);
    this.tone(520, 0.07, { type: 'sawtooth', gain: 0.06, slide: 240 });
  }
  pop() {
    this.tone(760, 0.07, { type: 'square', gain: 0.10, slide: 420 });
    this.noise(0.12, 0.18, 1800, 0.03);
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

  // --- the dance on the dock ----------------------------------------------
  // A little groove for the llama to dance to. The results screen goes up over
  // the top of a dance that keeps going, so there is no knowing in advance how
  // long this has to play: bars are written onto the WebAudio clock a few at a
  // time, far enough ahead to survive a backgrounded tab throttling setTimeout
  // to one second. Everything goes through its own bus, so stopping can silence
  // the lookahead that is already scheduled instead of waiting it out.
  startDance() {
    if (!this.ctx || this.dance) return;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.8;
    bus.connect(this.master);
    const bar = (60 / DANCE_BPM) * 4;
    this.dance = { bus, next: this.ctx.currentTime + 0.04, n: 0, timer: 0 };

    const pump = () => {
      if (!this.dance) return;
      while (this.dance.next < this.ctx.currentTime + 1.5) {
        this.danceBar(this.dance.next, this.dance.n++);
        this.dance.next += bar;
      }
      this.dance.timer = setTimeout(pump, 350);
    };
    pump();
  }

  stopDance() {
    const d = this.dance;
    if (!d) return;
    this.dance = null;
    clearTimeout(d.timer);
    const t = this.ctx.currentTime;
    d.bus.gain.setValueAtTime(d.bus.gain.value, t);
    d.bus.gain.linearRampToValueAtTime(0, t + 0.06);
    setTimeout(() => { try { d.bus.disconnect(); } catch {} }, 2000);
  }

  // One bar, written at absolute time `at`. `n` counts bars from the first.
  danceBar(at, n) {
    const step = (60 / DANCE_BPM) / 4;              // a sixteenth
    const now = this.ctx.currentTime;
    const dest = this.dance.bus;
    const d = (s) => Math.max(0, at - now + s * step);

    // I - V - vi - IV, a bar each, in the key the win jingle leaves off in.
    const root = [65.41, 98.00, 110.00, 87.31][n % 4];      // C2 G2 A2 F2
    // C major pentatonic sits happily on all four chords, so the riff on top
    // never has to be transposed to follow them.
    const P = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
    const RIFF = n % 4 === 2
      ? [[0, 5], [2, 4], [5, 3], [8, 2], [11, 3], [12, 1], [14, 2]]
      : [[0, 4], [3, 3], [6, 2], [10, 3], [12, 4], [14, 5]];

    for (let s = 0; s < 16; s += 4) {               // four on the floor
      this.tone(118, 0.13, { type: 'sine', gain: 0.30, slide: -76, delay: d(s), dest });
      this.noise(0.02, 0.10, 2600, d(s), 'lowpass', dest);
    }
    for (let s = 2; s < 16; s += 4) this.noise(0.035, 0.07, 7000, d(s), 'highpass', dest);
    for (const s of [4, 12]) this.noise(0.10, 0.20, 1500, d(s), 'bandpass', dest);

    for (const [s, mul] of [[0, 1], [6, 1], [8, 1], [11, 1.5], [14, 1]]) {
      this.tone(root * mul, step * 2.6, { type: 'triangle', gain: 0.16, delay: d(s), dest });
    }
    for (const [s, i] of RIFF) {
      this.tone(P[i], step * 1.7, { type: 'square', gain: 0.055, delay: d(s), dest });
    }
  }
}
