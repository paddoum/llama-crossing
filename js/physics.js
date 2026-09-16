import { riverBounds } from './levels.js';

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Distance from point to a horizontal capsule's core segment.
export function distToLog(px, py, log) {
  const cx = Math.max(log.x - log.hl, Math.min(log.x + log.hl, px));
  return Math.hypot(px - cx, py - log.y);
}

export function updateLog(log, dt, level) {
  log.x += log.vx * dt;
  const b = riverBounds(level, log.y);
  if (log.x - log.ext < b.left) { log.x = b.left + log.ext; log.vx = Math.abs(log.vx); }
  else if (log.x + log.ext > b.right) { log.x = b.right - log.ext; log.vx = -Math.abs(log.vx); }
}

export function boatHits(boat, o) {
  switch (o.type) {
    case 'rock': return dist(boat.x, boat.y, o.x, o.y) < boat.r + o.r - 4;
    case 'log': return distToLog(boat.x, boat.y, o) < boat.r + o.r - 3;
    case 'whirlpool': return dist(boat.x, boat.y, o.x, o.y) < o.r + boat.r * 0.35;
  }
  return false;
}

// Pull the boat toward the whirlpool center; returns pull strength 0..1 for FX.
export function applyWhirlpool(boat, o, dt) {
  const dx = o.x - boat.x, dy = o.y - boat.y;
  const d = Math.hypot(dx, dy);
  if (d >= o.R || d < 0.01) return 0;
  const k = 1 - d / o.R;
  const f = k * k * 260 * dt;
  boat.x += (dx / d) * f;
  boat.y += (dy / d) * f * 0.5;
  boat.targetX += (dx / d) * f * 0.6;
  return k;
}

// Keeps the boat inside the banks. Returns true when scraping a bank.
export function clampToBanks(boat, level) {
  const b = riverBounds(level, boat.y);
  const pad = boat.r + 2;
  if (boat.x < b.left + pad) {
    boat.x = b.left + pad;
    if (boat.targetX < boat.x) boat.targetX = boat.x;
    return true;
  }
  if (boat.x > b.right - pad) {
    boat.x = b.right - pad;
    if (boat.targetX > boat.x) boat.targetX = boat.x;
    return true;
  }
  return false;
}
