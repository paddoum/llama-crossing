// Bootstrap: DPR-aware canvas, portrait play column, fixed-step loop.
import { LOGICAL_W } from './levels.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { App } from './state.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Logical view: always LOGICAL_W wide; height follows the play column's aspect.
const view = { W: LOGICAL_W, H: 640, scale: 1, offsetX: 0, dpr: 1 };

let lastW = 0, lastH = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = window.innerWidth, h = window.innerHeight;
  lastW = w; lastH = h;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  // On wide screens (desktop/landscape) keep a portrait column, letterboxed.
  const column = Math.min(w, h * 0.62);
  view.dpr = dpr;
  view.offsetX = (w - column) / 2;
  view.scale = (column / LOGICAL_W) * dpr;
  view.H = (h / column) * LOGICAL_W;
  input.pixelsPerUnit = column / LOGICAL_W;
}

const sfx = new Sfx();
const input = new Input(canvas, {
  onFirstInteract: () => sfx.unlock(),
  onDragStart: () => app.onDragStart(),
  onDragMove: (dx) => app.onDragMove(dx),
  onKey: (k) => app.onKey(k),
});
const app = new App(view, sfx, input);
window.__app = app; // handy for debugging in devtools

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 50));
resize();

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let elapsed = 0;

function frame(now) {
  // Schedule first so a thrown error in one frame can't kill the loop.
  requestAnimationFrame(frame);
  // Some environments (in-app browsers, emulated viewports) change size without firing resize.
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) resize();
  // A hidden/zero-size viewport (e.g. a pane still opening) gives a non-finite view.H.
  if (!(view.H > 0) || !(view.scale > 0)) { last = now; return; }
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // tab was hidden; don't fast-forward
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    app.update(STEP);
    elapsed += STEP;
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;

  // Letterbox
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0f2436';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX * view.dpr, 0);
  ctx.beginPath(); ctx.rect(0, 0, view.W, view.H); ctx.clip();
  app.render(ctx, elapsed);
  ctx.restore();
}
requestAnimationFrame(frame);
