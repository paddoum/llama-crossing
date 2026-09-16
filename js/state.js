// Screen state machine + DOM wiring. Owns the current Session while playing.
import { LEVELS } from './levels.js';
import { Session } from './game.js';
import { renderSession, renderBackdrop } from './render.js';
import { loadProgress, saveProgress } from './storage.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['title', 'levels', 'paused', 'complete', 'gameover'];

export class App {
  constructor(view, sfx, input) {
    this.view = view;
    this.sfx = sfx;
    this.input = input;
    this.progress = loadProgress();
    this.sfx.setMuted(this.progress.muted);
    this.state = 'title';
    this.session = null;
    this.levelIndex = 0;
    this.lastHearts = -1;
    this.lastCarrots = -1;
    this.toastTimer = 0;

    this.bind();
    this.updateMuteLabel();
    this.show('title');
  }

  bind() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.sfx.unlock(); this.sfx.tap(); fn(); });
    click('btn-play', () => this.show('levels'));
    click('btn-mute', () => this.toggleMute());
    click('btn-levels-back', () => this.show('title'));
    click('btn-pause', () => this.pause());
    click('btn-resume', () => this.resume());
    click('btn-restart', () => this.startLevel(this.levelIndex));
    click('btn-quit', () => this.show('levels'));
    click('btn-next', () => this.startLevel(Math.min(LEVELS.length - 1, this.levelIndex + 1)));
    click('btn-complete-replay', () => this.startLevel(this.levelIndex));
    click('btn-complete-levels', () => this.show('levels'));
    click('btn-retry', () => this.startLevel(this.levelIndex));
    click('btn-gameover-levels', () => this.show('levels'));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  onKey(key) {
    if (key === 'Escape' || key === 'p' || key === 'P') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if ((key === ' ' || key === 'Enter') && this.state === 'title') this.show('levels');
  }

  onDragStart() {
    if (this.state === 'playing') this.hideToast();
  }
  onDragMove(dx) {
    if (this.state === 'playing') this.session?.dragMove(dx);
  }

  // --- screens ---
  show(name) {
    this.state = name;
    for (const s of SCREENS) $('screen-' + s).classList.toggle('active', s === name);
    $('hud').classList.toggle('hidden', !['playing', 'paused', 'complete', 'gameover'].includes(name));
    if (name === 'levels') this.buildLevelGrid();
    if (name === 'title' || name === 'levels') { this.session = null; this.sfx.stopAmbient(); }
    if (name !== 'playing') this.hideToast();
  }

  buildLevelGrid() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((lvl, i) => {
      const unlocked = i < this.progress.unlocked;
      const stars = this.progress.stars[i] || 0;
      const btn = document.createElement('button');
      btn.className = 'level-card' + (unlocked ? '' : ' locked');
      btn.innerHTML = `<span class="num">${unlocked ? i + 1 : '🔒'}</span><span class="name">${lvl.name}</span><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      if (unlocked) btn.addEventListener('click', () => { this.sfx.unlock(); this.sfx.tap(); this.startLevel(i); });
      grid.appendChild(btn);
    });
  }

  startLevel(i) {
    this.levelIndex = i;
    this.session = new Session(i, this.view, this.sfx);
    this.lastHearts = -1;
    this.lastCarrots = -1;
    this.sfx.unlock();
    this.sfx.startAmbient();
    this.show('playing');
    this.toast(i === 0 ? 'Drag anywhere to steer' : `${i + 1}. ${LEVELS[i].name}`, 2.4);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.show('paused');
    this.sfx.stopAmbient();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.sfx.startAmbient();
    this.show('playing');
  }

  toggleMute() {
    this.progress.muted = !this.progress.muted;
    this.sfx.setMuted(this.progress.muted);
    saveProgress(this.progress);
    this.updateMuteLabel();
  }
  updateMuteLabel() {
    $('btn-mute').textContent = this.progress.muted ? '🔇 Sound off' : '🔊 Sound on';
  }

  toast(text, secs) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    this.toastTimer = secs;
  }
  hideToast() { $('toast').classList.add('hidden'); this.toastTimer = 0; }

  // --- results ---
  finishWon() {
    const s = this.session;
    const stars = s.stars();
    const prev = this.progress.stars[this.levelIndex] || 0;
    this.progress.stars[this.levelIndex] = Math.max(prev, stars);
    const isLast = this.levelIndex === LEVELS.length - 1;
    if (!isLast && this.progress.unlocked < this.levelIndex + 2) this.progress.unlocked = this.levelIndex + 2;
    saveProgress(this.progress);

    $('complete-stars').innerHTML = '★'.repeat(stars) + `<span class="off">${'★'.repeat(3 - stars)}</span>`;
    $('complete-info').textContent = `${s.level.name} · ${s.carrotsGot}/${s.totalCarrots} carrots · ${s.boat.hearts} ♥ left` + (isLast ? '\nYou crossed them all!' : '');
    $('btn-next').classList.toggle('hidden', isLast);
    this.show('complete');
    this.sfx.stopAmbient();
  }

  finishLost() {
    const s = this.session;
    $('gameover-info').textContent = `${Math.round(s.progress() * 100)}% of the way across ${s.level.name}.`;
    this.show('gameover');
    this.sfx.stopAmbient();
  }

  // --- loop hooks ---
  update(dt) {
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.hideToast(); }
    if (this.state !== 'playing' || !this.session) return;
    const s = this.session;
    s.update(dt, this.input.axis());

    if (s.boat.hearts !== this.lastHearts) {
      this.lastHearts = s.boat.hearts;
      $('hearts').textContent = '♥'.repeat(Math.max(0, s.boat.hearts)) + '♡'.repeat(Math.max(0, 3 - s.boat.hearts));
    }
    if (s.carrotsGot !== this.lastCarrots) {
      this.lastCarrots = s.carrotsGot;
      $('carrots').textContent = `🥕 ${s.carrotsGot}`;
    }

    if (s.status === 'won' && s.endTimer > 1.1) this.finishWon();
    else if (s.status === 'lost' && s.endTimer > 1.0) this.finishLost();
  }

  render(ctx, t) {
    if (this.session) renderSession(ctx, this.session, this.view, t);
    else renderBackdrop(ctx, this.view, t);
  }
}
