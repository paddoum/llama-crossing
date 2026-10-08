// 3D bootstrap: WebGL renderer, resize, fixed-step loop. Same screens and
// simulation as the 2D build -- only the renderer differs.
import { LOGICAL_W } from './levels.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { App } from './state.js';
import { VERSION } from './version.js';
import { Renderer3D } from './render3d.js';

document.getElementById('version').textContent = 'v' + VERSION + ' · 3D';

const canvas = document.getElementById('game');
const view = { W: LOGICAL_W, H: 640 };

const renderer = new Renderer3D(canvas);
const sfx = new Sfx();
const input = new Input(canvas, {
  onFirstInteract: () => sfx.unlock(),
  onDragStart: () => app.onDragStart(),
  onDragMove: (dx) => app.onDragMove(dx),
  onKey: (k) => app.onKey(k),
});
const app = new App(view, sfx, input, renderer);
window.__app = app; // handy for debugging in devtools
window.__r3d = renderer;

let lastW = 0, lastH = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  lastW = w; lastH = h;
  renderer.resize(w, h, dpr);
  // Session.cameraFor still wants a view height; the 3D camera ignores its result.
  view.H = (h / w) * LOGICAL_W;
  // Drag feel: a full-width swipe should carry the boat across the river.
  input.pixelsPerUnit = w / LOGICAL_W;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 50));
resize();

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) resize();
  if (!(lastW > 0 && lastH > 0)) { last = now; return; }

  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    app.update(STEP);
    elapsed += STEP;
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;

  app.render(elapsed);
}
requestAnimationFrame(frame);
