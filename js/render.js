// All canvas drawing. World → screen: sx = wx, sy = H - (wy - camY).
import { LOGICAL_W, riverBounds } from './levels.js';

const C = {
  waterTop: '#3a9ad9', waterBot: '#2578b8', wave: 'rgba(255,255,255,0.20)',
  grass: '#6cc04a', grassDark: '#4f9c37', sand: '#e8d38a', sandDark: '#cbb36a',
  rock: '#7d8791', rockLight: '#a9b2ba', rockDark: '#5b636b',
  log: '#8b5a2b', logLight: '#a7713a', logDark: '#5f3a17',
  hull: '#a35f2a', hullDark: '#6e3d15', deck: '#c98a4b',
  llama: '#fbf6ee', pink: '#f2c9b0', scarf: '#e2453b',
  carrot: '#f28c28', carrotLeaf: '#4fae3f',
};

const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

export function renderSession(ctx, s, view, t) {
  const { W, H } = view;
  const camY = s.camY;
  const toY = (wy) => H - (wy - camY);

  ctx.save();
  if (s.shake > 0) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);

  drawWater(ctx, W, H, camY, t, s.level.speed);
  drawBanks(ctx, s.level, W, H, camY, toY);
  drawShores(ctx, s.level, W, H, camY, toY);

  // Whirlpools sit under everything else
  for (const o of s.obstacles) if (o.type === 'whirlpool' && inView(o.y, camY, H, 80)) drawWhirlpool(ctx, o.x, toY(o.y), o, t);
  for (const c of s.carrots) if (!c.taken && inView(c.y, camY, H, 40)) drawCarrot(ctx, c.x, toY(c.y), t);
  for (const o of s.obstacles) {
    if (!inView(o.y, camY, H, 80)) continue;
    if (o.type === 'rock') drawRock(ctx, o.x, toY(o.y), o, t);
    else if (o.type === 'log') drawLog(ctx, o.x, toY(o.y), o);
  }

  // Particles
  for (const p of s.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, toY(p.y), p.r * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const b = s.boat;
  const bob = Math.sin(t * 4) * 1.2;
  const flashing = b.invuln > 0 && Math.floor(t * 14) % 2 === 0;
  drawLlamaBoat(ctx, b.x, toY(b.y) + bob, b.lean + Math.sin(t * 3) * 0.05, t, flashing, s.status === 'won');

  ctx.restore();

  // Whirlpool pull vignette (blue) and hit flash (red)
  if (s.pull > 0) vignette(ctx, W, H, `rgba(20,40,120,${(s.pull * 0.45).toFixed(3)})`);
  if (s.flash > 0) vignette(ctx, W, H, `rgba(220,30,30,${(s.flash * 0.55).toFixed(3)})`);

  drawProgress(ctx, W, H, s.progress());
}

function inView(wy, camY, H, pad) {
  return wy > camY - pad && wy < camY + H + pad;
}

function vignette(ctx, W, H, color) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export function drawWater(ctx, W, H, camY, t, speed = 100) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.waterTop);
  g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Wave marks drift downstream (toward A) on their own, so the current stays
  // visible even when the camera is pinned at the pier.
  const flow = 45 + speed * 0.35;
  const drift = t * flow;
  ctx.strokeStyle = C.wave;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const spacing = 28;
  const k0 = Math.floor((camY + drift) / spacing) - 1;
  const k1 = Math.ceil((camY + H + drift) / spacing) + 1;
  for (let k = k0; k <= k1; k++) {
    const wy = k * spacing - drift;          // world y of this mark right now
    const sy = H - (wy - camY);
    const phase = k * 0.37 + t * 1.6;
    const len = 26 + hash(k) * 30;
    const x0 = (hash(k * 1.7) * (W + 80)) - 40 + Math.sin(t * 0.7 + k) * 6;
    ctx.beginPath();
    for (let x = x0; x <= x0 + len; x += 6) {
      const y = sy + Math.sin(x * 0.12 + phase) * 2.2;
      x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawBanks(ctx, level, W, H, camY, toY) {
  const step = 18;
  const y0 = camY - 40, y1 = camY + H + 40;
  const pts = [];
  for (let wy = y0; wy <= y1; wy += step) pts.push({ wy, ...riverBounds(level, wy) });

  // Left bank
  ctx.beginPath();
  ctx.moveTo(-10, toY(y0));
  for (const p of pts) ctx.lineTo(p.left, toY(p.wy));
  ctx.lineTo(-10, toY(y1));
  ctx.closePath();
  ctx.fillStyle = C.grass; ctx.fill();
  // Right bank
  ctx.beginPath();
  ctx.moveTo(W + 10, toY(y0));
  for (const p of pts) ctx.lineTo(p.right, toY(p.wy));
  ctx.lineTo(W + 10, toY(y1));
  ctx.closePath();
  ctx.fillStyle = C.grass; ctx.fill();

  // Sandy edges
  ctx.lineWidth = 7; ctx.strokeStyle = C.sand; ctx.lineJoin = 'round';
  ctx.beginPath(); for (const p of pts) ctx.lineTo(p.left, toY(p.wy)); ctx.stroke();
  ctx.beginPath(); for (const p of pts) ctx.lineTo(p.right, toY(p.wy)); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); for (const p of pts) ctx.lineTo(p.left + 5, toY(p.wy)); ctx.stroke();
  ctx.beginPath(); for (const p of pts) ctx.lineTo(p.right - 5, toY(p.wy)); ctx.stroke();

  // Bushes & trees — deterministic per world y
  const dec = 70;
  for (let wy = Math.floor(y0 / dec) * dec; wy <= y1; wy += dec) {
    const b = riverBounds(level, wy);
    const sy = toY(wy);
    const h1 = hash(wy), h2 = hash(wy + 0.5);
    if (b.left > 24) drawBush(ctx, b.left - 16 - h1 * Math.max(0, b.left - 30), sy + h2 * 30, 8 + h1 * 7, h2 > 0.6);
    if (W - b.right > 24) drawBush(ctx, b.right + 16 + h2 * Math.max(0, W - b.right - 30), sy + h1 * 30, 8 + h2 * 7, h1 > 0.6);
  }
}

function drawBush(ctx, x, y, r, tree) {
  if (tree) {
    ctx.fillStyle = C.logDark; ctx.fillRect(x - 2, y, 4, r);
    ctx.fillStyle = C.grassDark; ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5fb444'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.5, r * 0.6, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = C.grassDark;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.arc(x + r * 0.8, y + r * 0.2, r * 0.8, 0, Math.PI * 2); ctx.fill();
  }
}

function drawShores(ctx, level, W, H, camY, toY) {
  // Start beach (A) below y = 0
  if (camY < 60) {
    const y = toY(0);
    const b = riverBounds(level, 0);
    ctx.fillStyle = C.sand;
    ctx.fillRect(b.left - 8, y, b.right - b.left + 16, H);
    ctx.fillStyle = C.sandDark;
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(b.left + 10 + hash(i) * (b.right - b.left - 20), y + 10 + hash(i + 9) * 40, 1.5, 0, Math.PI * 2); ctx.fill(); }
    // Water lapping edge
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    for (let x = b.left - 8; x <= b.right + 8; x += 4) { const yy = y + Math.sin(x * 0.2) * 2; x === b.left - 8 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
    ctx.lineTo(b.right + 8, y + 6); ctx.lineTo(b.left - 8, y + 6); ctx.closePath(); ctx.fill();
    drawFlag(ctx, b.left + 22, y + 26, 'A');
  }
  // Dock (B) at y = length
  if (camY + H > level.length - 60) {
    const y = toY(level.length);
    const b = riverBounds(level, level.length);
    const dockH = 46;
    ctx.fillStyle = C.logDark; ctx.fillRect(b.left - 10, y - dockH, b.right - b.left + 20, dockH);
    ctx.fillStyle = C.log;
    for (let x = b.left - 8; x < b.right + 8; x += 14) ctx.fillRect(x, y - dockH + 3, 11, dockH - 6);
    // posts
    ctx.fillStyle = C.logDark;
    for (const px of [b.left + 4, b.center, b.right - 4]) { ctx.beginPath(); ctx.arc(px, y - 2, 4.5, 0, Math.PI * 2); ctx.fill(); }
    // finish line
    for (let x = b.left, i = 0; x < b.right; x += 12, i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#222';
      ctx.fillRect(x, y - 2, 12, 5);
    }
    drawFlag(ctx, b.center, y - dockH - 8, 'B');
    // Grass beyond the dock
    ctx.fillStyle = C.grass; ctx.fillRect(-10, 0, W + 20, Math.max(0, y - dockH - 30));
  }
}

function drawFlag(ctx, x, y, letter) {
  ctx.fillStyle = '#eee'; ctx.fillRect(x - 1.5, y - 34, 3, 36);
  ctx.fillStyle = C.scarf;
  ctx.beginPath(); ctx.moveTo(x + 1, y - 34); ctx.lineTo(x + 26, y - 26); ctx.lineTo(x + 1, y - 17); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, x + 11, y - 25.5);
}

function drawRock(ctx, x, y, o, t) {
  // foam ring
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 20;
  ctx.beginPath(); ctx.arc(x, y, o.r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // body
  ctx.fillStyle = C.rock;
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + o.seed * 6;
    const rr = o.r * (0.82 + hash(o.seed * 100 + i) * 0.28);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.rockDark; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.rockLight;
  ctx.beginPath(); ctx.ellipse(x - o.r * 0.25, y - o.r * 0.3, o.r * 0.42, o.r * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
}

function drawLog(ctx, x, y, o) {
  const w = o.hl, r = o.r;
  ctx.fillStyle = 'rgba(0,40,80,0.25)';
  ctx.beginPath(); ctx.roundRect(x - w - r, y - r + 3, (w + r) * 2, r * 2, r); ctx.fill();
  ctx.fillStyle = C.log;
  ctx.beginPath(); ctx.roundRect(x - w - r, y - r, (w + r) * 2, r * 2, r); ctx.fill();
  ctx.strokeStyle = C.logDark; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.logLight;
  ctx.beginPath(); ctx.roundRect(x - w, y - r + 3, w * 2, 3, 1.5); ctx.fill();
  // bark lines
  ctx.strokeStyle = 'rgba(60,30,10,0.35)'; ctx.lineWidth = 1.5;
  for (let i = -w + 10; i < w; i += 14) { ctx.beginPath(); ctx.moveTo(x + i, y - r + 4); ctx.lineTo(x + i + 4, y + r - 4); ctx.stroke(); }
  // end rings
  for (const side of [-1, 1]) {
    ctx.fillStyle = C.logLight; ctx.beginPath(); ctx.arc(x + side * w, y, r - 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.logDark; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + side * w, y, r - 5, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawWhirlpool(ctx, x, y, o, t) {
  const R = o.R * 0.78;
  const g = ctx.createRadialGradient(x, y, 2, x, y, R);
  g.addColorStop(0, 'rgba(10,30,80,0.9)');
  g.addColorStop(0.5, 'rgba(20,60,130,0.55)');
  g.addColorStop(1, 'rgba(58,154,217,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let k = 0; k <= 22; k++) {
      const f = k / 22;
      const a = -o.spin - arm * (Math.PI * 2 / 3) - f * 4.2;
      const rr = 4 + f * (R - 6);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.9;
      k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#081a40';
  ctx.beginPath(); ctx.arc(x, y, o.r * 0.55, 0, Math.PI * 2); ctx.fill();
}

function drawCarrot(ctx, x, y, t) {
  y += Math.sin(t * 3 + x) * 1.5;
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.35);
  ctx.fillStyle = 'rgba(0,40,80,0.2)'; ctx.beginPath(); ctx.ellipse(1, 4, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.carrot;
  ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(160,80,10,0.5)'; ctx.lineWidth = 1.2;
  for (const yy of [-1, 4]) { ctx.beginPath(); ctx.moveTo(-3, yy); ctx.lineTo(3, yy); ctx.stroke(); }
  ctx.fillStyle = C.carrotLeaf;
  for (const a of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.ellipse(Math.sin(a) * 4, -10, 2.2, 6, a, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export function drawLlamaBoat(ctx, x, y, lean, t, flashing, celebrating = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean * 0.32);
  if (flashing) ctx.globalAlpha = 0.4;

  // shadow
  ctx.fillStyle = 'rgba(0,40,80,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 4, 16, 26, 0, 0, Math.PI * 2); ctx.fill();

  // oars
  const sw = celebrating ? Math.sin(t * 14) : Math.sin(t * 7);
  ctx.strokeStyle = C.logDark; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const ex = s * (23 + sw * 3), ey = 8 - sw * 7;
    ctx.beginPath(); ctx.moveTo(s * 11, 1); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = C.log; ctx.beginPath(); ctx.ellipse(ex + s * 2, ey + 1, 4, 7, s * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  // hull (bow points up = toward B)
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.quadraticCurveTo(16, -10, 14, 12);
    ctx.quadraticCurveTo(13, 25, 0, 26);
    ctx.quadraticCurveTo(-13, 25, -14, 12);
    ctx.quadraticCurveTo(-16, -10, 0, -27);
    ctx.closePath();
  };
  hull(); ctx.fillStyle = C.hull; ctx.fill();
  ctx.strokeStyle = C.hullDark; ctx.lineWidth = 2.2; ctx.stroke();
  ctx.save(); ctx.scale(0.72, 0.76); ctx.translate(0, 1); hull(); ctx.fillStyle = C.deck; ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(90,50,20,0.45)'; ctx.lineWidth = 1.2;
  for (const yy of [-8, 0, 8, 15]) { ctx.beginPath(); ctx.moveTo(-8, yy); ctx.lineTo(8, yy); ctx.stroke(); }

  // llama (drawn slightly larger than the deck so it reads at phone size)
  const hop = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
  ctx.translate(0, -hop + 2);
  ctx.scale(1.25, 1.25);
  ctx.fillStyle = C.llama;
  ctx.beginPath(); ctx.ellipse(0, 7, 9.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();       // body
  ctx.fillStyle = C.scarf; ctx.beginPath(); ctx.roundRect(-7, 5, 14, 5, 2); ctx.fill(); // blanket
  ctx.fillStyle = '#ffd75e'; ctx.fillRect(-7, 7, 14, 1.2);
  ctx.fillStyle = C.llama;
  ctx.beginPath(); ctx.roundRect(-3.6, -13, 7.2, 20, 3.5); ctx.fill();               // neck
  ctx.beginPath(); ctx.ellipse(0, -15, 6.3, 5.3, 0, 0, Math.PI * 2); ctx.fill();     // head
  // ears
  for (const s of [-1, 1]) {
    ctx.fillStyle = C.llama;
    ctx.beginPath(); ctx.moveTo(s * 3.5, -18); ctx.lineTo(s * 6.5, -25); ctx.lineTo(s * 1.2, -19.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.pink;
    ctx.beginPath(); ctx.moveTo(s * 3.8, -19); ctx.lineTo(s * 5.6, -23.2); ctx.lineTo(s * 2.4, -19.8); ctx.closePath(); ctx.fill();
  }
  // snout + eyes
  ctx.fillStyle = C.pink; ctx.beginPath(); ctx.ellipse(0, -18.5, 3.4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(-2.6, -15.5, 1.1, 0, Math.PI * 2); ctx.arc(2.6, -15.5, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(-1, -19, 0.6, 0, Math.PI * 2); ctx.arc(1, -19, 0.6, 0, Math.PI * 2); ctx.fill();
  // scarf
  ctx.fillStyle = C.scarf; ctx.beginPath(); ctx.roundRect(-4.6, -6, 9.2, 3.2, 1.6); ctx.fill();
  ctx.beginPath(); ctx.roundRect(2, -4.5, 3, 7, 1.2); ctx.fill();

  ctx.restore();
}

function drawProgress(ctx, W, H, p) {
  const x = W - 13, top = 78, bottom = H - 34;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(10,30,50,0.45)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 4;
  const y = bottom - (bottom - top) * p;
  ctx.beginPath(); ctx.moveTo(x, bottom); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('B', x, top - 10); ctx.fillText('A', x, bottom + 11);
  ctx.fillStyle = C.llama; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.hullDark; ctx.lineWidth = 1.5; ctx.stroke();
}

// Title/menu backdrop: drifting water and a bobbing llama.
export function renderBackdrop(ctx, view, t) {
  const { W, H } = view;
  drawWater(ctx, W, H, t * 60, t);
  const level = { riverWidth: 260, meanderAmp: 20, meanderLen: 800 };
  const camY = t * 60;
  const toY = (wy) => H - (wy - camY);
  drawBanks(ctx, level, W, H, camY, toY);
  drawLlamaBoat(ctx, W / 2 + Math.sin(t * 0.8) * 30, H * 0.78 + Math.sin(t * 3) * 2, Math.cos(t * 0.8) * 0.4, t, false);
}
