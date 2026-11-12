// 3D bootstrap: WebGL renderer, resize, fixed-step loop. Same screens and
// simulation as the 2D build -- only the renderer differs.
import { LOGICAL_W } from './levels.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { App } from './state.js';
import { VERSION } from './version.js';
import { Renderer3D } from './render3d.js';
import { watchViewport } from './viewport.js';

document.getElementById('version').textContent = 'v' + VERSION + ' · 3D';

const canvas = document.getElementById('game');
const view = { W: LOGICAL_W, H: 640 };

const renderer = new Renderer3D(canvas);
const sfx = new Sfx();
const input = new Input(canvas, {
  onFirstInteract: () => sfx.unlock(),
  onDragStart: () => app.onDragStart(),
  onDragMove: (dx) => app.onDragMove(dx),
  onTap: () => app.onTap(),
  onKey: (k) => app.onKey(k),
});
const app = new App(view, sfx, input, renderer);
window.__app = app; // handy for debugging in devtools
window.__r3d = renderer;

// Size everything to the slice of screen the player can actually see, not to
// the layout viewport -- on a phone the two differ by the height of the
// browser's toolbar, which is exactly where the boat sits.
let lastW = 0, lastH = 0;
function resize(w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  lastW = w; lastH = h;
  renderer.resize(w, h, dpr);
  // Session.cameraFor still wants a view height; the 3D camera ignores its result.
  view.H = (h / w) * LOGICAL_W;
  // Drag feel: a full-width swipe should carry the boat across the river.
  input.pixelsPerUnit = w / LOGICAL_W;
}

const viewport = watchViewport(resize);
resize(viewport.width(), viewport.height());

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);
  // In-app browsers and emulated viewports resize without firing any event.
  if (viewport.width() !== lastW || viewport.height() !== lastH) viewport.update();
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
