import { riverBounds } from './levels.js';

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Distance from point to a horizontal capsule's core segment.
export function distToWhale(px, py, whale) {
  const cx = Math.max(whale.x - whale.hl, Math.min(whale.x + whale.hl, px));
  return Math.hypot(px - cx, py - whale.y);
}

export function updateWhale(whale, dt, level) {
  whale.x += whale.vx * dt;
  const b = riverBounds(level, whale.y);
  if (whale.x - whale.ext < b.left) { whale.x = b.left + whale.ext; whale.vx = Math.abs(whale.vx); }
  else if (whale.x + whale.ext > b.right) { whale.x = b.right - whale.ext; whale.vx = -Math.abs(whale.vx); }
}

export function boatHits(boat, o) {
  switch (o.type) {
    case 'rock': return dist(boat.x, boat.y, o.x, o.y) < boat.r + o.r - 4;
    case 'whale': return distToWhale(boat.x, boat.y, o) < boat.r + o.r - 3;
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
