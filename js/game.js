// One play-through of a level: entities, simulation, scoring.
import { LEVELS, START_Y, generateLevel, riverBounds } from './levels.js';
import { makeBoat } from './entities.js';
import { updateLog, boatHits, applyWhirlpool, clampToBanks, dist } from './physics.js';

const STEER_RATE = 11;     // how quickly boat.x follows targetX
const KEY_SPEED = 300;     // units/s for keyboard steering
const HIT_INVULN = 1.6;

export class Session {
  constructor(levelIndex, view, sfx) {
    this.levelIndex = levelIndex;
    this.level = LEVELS[levelIndex];
    this.view = view;
    this.sfx = sfx;

    const data = generateLevel(this.level);
    this.obstacles = data.obstacles;
    this.carrots = data.carrots;
    this.totalCarrots = this.carrots.length;

    const start = riverBounds(this.level, START_Y);
    this.boat = makeBoat(start.center, START_Y);
    this.time = 0;
    this.carrotsGot = 0;
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
    this.pull = 0;          // whirlpool pull FX 0..1
    this.status = 'playing'; // playing | won | lost
    this.endTimer = 0;
    this.camY = this.boat.y - view.H * 0.3;
  }

  // --- input ---
  dragMove(dx) {
    if (this.status !== 'playing') return;
    this.boat.targetX += dx;
  }

  // --- simulation ---
  update(dt, axis) {
    const { boat, level } = this;
    this.time += dt;

    if (this.status !== 'playing') {
      this.endTimer += dt;
      this.updateParticles(dt);
      this.decayFx(dt);
      return;
    }

    if (axis) boat.targetX += axis * KEY_SPEED * dt;

    // Forward motion
    const speed = level.speed * boat.speedMul;
    boat.y += speed * dt;

    // Steering (smooth follow, with lean for the art)
    const prevX = boat.x;
    boat.x += (boat.targetX - boat.x) * Math.min(1, STEER_RATE * dt);
    boat.vx = (boat.x - prevX) / dt;
    boat.lean += (Math.max(-1, Math.min(1, boat.vx / 220)) - boat.lean) * Math.min(1, 9 * dt);

    // Banks
    const scraping = clampToBanks(boat, level);
    if (scraping && !boat.scraping) this.sfx.scrape();
    boat.scraping = scraping;
    if (scraping) {
      boat.speedMul += (0.55 - boat.speedMul) * Math.min(1, 6 * dt);
      if (Math.random() < 0.5) this.spawnParticle(boat.x + (boat.x < riverBounds(level, boat.y).center ? -boat.r : boat.r), boat.y, 20, 0.5, '#e8d38a');
    } else {
      boat.speedMul += (1 - boat.speedMul) * Math.min(1, 3 * dt);
    }

    // Obstacles near the boat
    if (boat.invuln > 0) boat.invuln -= dt;
    this.pull = 0;
    const near = 220;
    for (const o of this.obstacles) {
      if (Math.abs(o.y - boat.y) > near) continue;
      if (o.type === 'log') updateLog(o, dt, level);
      if (o.type === 'whirlpool') {
        o.spin += dt * 3;
        this.pull = Math.max(this.pull, applyWhirlpool(boat, o, dt));
      }
      if (boat.invuln <= 0 && boatHits(boat, o)) this.takeHit(o);
    }

    // Carrots
    for (const c of this.carrots) {
      if (c.taken || Math.abs(c.y - boat.y) > 60) continue;
      if (dist(boat.x, boat.y, c.x, c.y) < boat.r + c.r + 2) {
        c.taken = true;
        this.carrotsGot++;
        this.sfx.pickup();
        for (let i = 0; i < 8; i++) this.spawnParticle(c.x, c.y, 80, 0.5, '#ffb347');
      }
    }

    // Wake
    if (Math.random() < 0.8) this.spawnParticle(boat.x + (Math.random() - 0.5) * 10, boat.y - 22, 25, 0.9, 'rgba(255,255,255,0.8)', -1);

    // Win
    if (boat.y >= level.length) {
      boat.y = level.length;
      this.status = 'won';
      this.sfx.win();
      for (let i = 0; i < 24; i++) this.spawnParticle(boat.x, boat.y + 10, 120, 1.2, i % 2 ? '#ffd75e' : '#ffffff');
    }

    this.updateParticles(dt);
    this.decayFx(dt);
    this.camY = boat.y - this.view.H * 0.3;
  }

  takeHit(o) {
    const { boat } = this;
    boat.hearts--;
    boat.invuln = HIT_INVULN;
    this.shake = 9;
    this.flash = 1;
    this.sfx.hit();
    const dx = boat.x - o.x;
    const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
    boat.targetX = boat.x + dir * 46;
    boat.speedMul = 0.35;
    for (let i = 0; i < 16; i++) this.spawnParticle(boat.x, boat.y, 110, 0.7, 'rgba(255,255,255,0.9)');
    if (boat.hearts <= 0) {
      this.status = 'lost';
      this.sfx.lose();
    }
  }

  spawnParticle(x, y, speed, life, color, dirY = 0) {
    const a = dirY ? -Math.PI / 2 + (Math.random() - 0.5) * 0.6 : Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, color, r: 2 + Math.random() * 3 });
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  decayFx(dt) {
    this.shake = Math.max(0, this.shake - 30 * dt);
    this.flash = Math.max(0, this.flash - 1.8 * dt);
  }

  // 1 star for finishing, +1 for 2+ hearts, +1 for 70%+ carrots
  stars() {
    let s = 1;
    if (this.boat.hearts >= 2) s++;
    if (this.totalCarrots === 0 || this.carrotsGot / this.totalCarrots >= 0.7) s++;
    return s;
  }

  progress() {
    return Math.max(0, Math.min(1, (this.boat.y - START_Y) / (this.level.length - START_Y)));
  }
}
