// Plain-object entities. `ext` is the horizontal half-extent used by the level generator.

export function makeBoat(x, y) {
  return {
    x, y,
    targetX: x,
    vx: 0,
    lean: 0,
    r: 13,
    hearts: 3,
    invuln: 0,
    speedMul: 1,
    scraping: false,
  };
}

export function makeRock(rng, left, right, y) {
  const r = rng.range(13, 22);
  return { type: 'rock', x: rng.range(left + r, right - r), y, r, ext: r, seed: rng.next() };
}

export function makeLog(rng, left, right, y) {
  const hl = rng.range(26, 48);
  const r = 9;
  return {
    type: 'log', x: rng.range(left + hl + r, right - hl - r), y, hl, r, ext: hl + r,
    vx: rng.pick([-1, 1]) * rng.range(28, 62),
    seed: rng.next(),
  };
}

export function makeWhirlpool(rng, left, right, y) {
  const R = 58;  // pull radius
  const r = 13;  // deadly core
  return { type: 'whirlpool', x: rng.range(left + 30, right - 30), y, r, R, ext: 22, spin: rng.next() * 6 };
}

export function makeCarrot(x, y) {
  return { type: 'carrot', x, y, r: 11, taken: false };
}
