// Level definitions + deterministic generator.
// World units: the river is drawn in a 360-unit-wide logical column; y grows toward the far dock (B).
import { makeRock, makeLog, makeWhirlpool, makeCarrot } from './entities.js';

export const LOGICAL_W = 360;
export const START_Y = 80;       // boat spawn
export const MIN_GAP = 58;       // guaranteed passable gap per obstacle row

export const LEVELS = [
  { name: 'Calm Creek',        length: 2400, speed: 110, riverWidth: 260, meanderAmp: 0,  meanderLen: 900,  gap: [170, 240], weights: { rock: 1, log: 0, whirlpool: 0 }, maxPerRow: 1, carrotChance: 0.7, seed: 11 },
  { name: 'Log Jam',           length: 3000, speed: 125, riverWidth: 250, meanderAmp: 18, meanderLen: 1000, gap: [150, 220], weights: { rock: 2, log: 2, whirlpool: 0 }, maxPerRow: 2, carrotChance: 0.65, seed: 22 },
  { name: 'Spinning Shallows', length: 3400, speed: 135, riverWidth: 240, meanderAmp: 30, meanderLen: 900,  gap: [140, 210], weights: { rock: 2, log: 1, whirlpool: 2 }, maxPerRow: 2, carrotChance: 0.6, seed: 33 },
  { name: 'The Narrows',       length: 3800, speed: 145, riverWidth: 200, meanderAmp: 40, meanderLen: 800,  gap: [130, 200], weights: { rock: 3, log: 2, whirlpool: 1 }, maxPerRow: 2, carrotChance: 0.6, seed: 44 },
  { name: 'Rapids',            length: 4400, speed: 165, riverWidth: 225, meanderAmp: 50, meanderLen: 750,  gap: [120, 185], weights: { rock: 3, log: 3, whirlpool: 2 }, maxPerRow: 3, carrotChance: 0.55, seed: 55 },
  { name: 'Final Crossing',    length: 5200, speed: 185, riverWidth: 205, meanderAmp: 60, meanderLen: 700,  gap: [110, 170], weights: { rock: 3, log: 3, whirlpool: 3 }, maxPerRow: 3, carrotChance: 0.5, seed: 66 },
];

// mulberry32 — small, fast, deterministic.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function riverCenter(level, y) {
  if (!level.meanderAmp) return LOGICAL_W / 2;
  return LOGICAL_W / 2 + level.meanderAmp * Math.sin((y / level.meanderLen) * Math.PI * 2);
}

export function riverBounds(level, y) {
  const c = riverCenter(level, y);
  const half = level.riverWidth / 2;
  return { left: c - half, right: c + half, center: c };
}

function weightedList(weights) {
  const out = [];
  for (const [type, w] of Object.entries(weights)) for (let i = 0; i < w; i++) out.push(type);
  return out;
}

const FACTORY = { rock: makeRock, log: makeLog, whirlpool: makeWhirlpool };

export function generateLevel(level) {
  const rng = makeRng(level.seed);
  const obstacles = [];
  const carrots = [];
  const types = weightedList(level.weights);
  const startGap = 380;
  const endGap = 320;

  let y = startGap;
  while (y < level.length - endGap) {
    const b = riverBounds(level, y);
    const n = rng.int(1, level.maxPerRow);
    const row = [];
    for (let i = 0; i < n; i++) {
      const type = rng.pick(types);
      row.push(FACTORY[type](rng, b.left, b.right, y));
    }
    ensurePassable(row, b.left, b.right);
    obstacles.push(...row);

    if (rng.chance(level.carrotChance)) {
      const cy = y + rng.range(55, 105);
      const cb = riverBounds(level, cy);
      carrots.push(makeCarrot(rng.range(cb.left + 22, cb.right - 22), cy));
    }
    y += rng.range(level.gap[0], level.gap[1]);
  }
  return { obstacles, carrots };
}

// Removes overlapping obstacles and guarantees at least one MIN_GAP-wide opening in the row.
function ensurePassable(row, left, right) {
  row.sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length;) {
    if (row[i].x - row[i].ext < row[i - 1].x + row[i - 1].ext + 8) row.splice(i, 1);
    else i++;
  }
  const widestGap = () => {
    const edges = [left, ...row.flatMap((o) => [o.x - o.ext, o.x + o.ext]), right];
    let m = 0;
    for (let i = 0; i < edges.length; i += 2) m = Math.max(m, edges[i + 1] - edges[i]);
    return m;
  };
  while (row.length && widestGap() < MIN_GAP) row.splice(Math.floor(row.length / 2), 1);
}
