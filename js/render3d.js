// 3D renderer: identical simulation, Three.js scene.
// World -> scene: X = x - 180 (across the river), Y = up, Z = -y (downriver is +Z).
import * as THREE from 'three';
import { LOGICAL_W, riverBounds } from './levels.js';

const HALF = LOGICAL_W / 2;
const SKY = 0x9ed9f3;

const COL = {
  water: 0x2f86c6, grass: 0x6cc04a, grassDark: 0x4f9c37, sand: 0xe8d38a,
  rock: 0x7d8791, log: 0x8b5a2b, logLight: 0xa7713a, logDark: 0x5f3a17,
  hull: 0xa35f2a, hullDark: 0x6e3d15, deck: 0xc98a4b,
  llama: 0xfbf6ee, pink: 0xf2c9b0, scarf: 0xe2453b, ink: 0x241a12,
  carrot: 0xf28c28, leaf: 0x4fae3f, swirl: 0x0d2b52, white: 0xffffff, dark: 0x1a1a1a,
  waterFar: 0x2f86c6,
};

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// Shared materials: never disposed, so level teardown only frees geometry.
const M = {
  grass: mat(COL.grass, { side: THREE.DoubleSide }),
  sand: mat(COL.sand, { side: THREE.DoubleSide }),
  rock: mat(COL.rock),
  log: mat(COL.log),
  logLight: mat(COL.logLight),
  logDark: mat(COL.logDark),
  hull: mat(COL.hull),
  hullDark: mat(COL.hullDark),
  deck: mat(COL.deck),
  llama: mat(COL.llama),
  pink: mat(COL.pink),
  scarf: mat(COL.scarf),
  ink: mat(COL.ink),
  carrot: mat(COL.carrot),
  leaf: mat(COL.leaf),
  swirl: mat(COL.swirl, { side: THREE.DoubleSide }),
  white: mat(COL.white, { side: THREE.DoubleSide }),
  dark: mat(COL.dark),
  foliage: mat(COL.grassDark),
  foliageLight: mat(0x5fb444),
};

// Deterministic jitter, same trick the 2D renderer uses.
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// --- water -------------------------------------------------------------
const WATER_SIZE = 1500, WATER_SEG = 54, FLOW = 34;
const WATER_HALF = WATER_SIZE / 2;

// Waves fade out at the rim of the near sheet so it meets the flat far water
// without a seam.
function rimFade(lx, lz) {
  const d = Math.max(Math.abs(lx), Math.abs(lz)) / WATER_HALF;
  return Math.max(0, Math.min(1, 1 - (d - 0.7) / 0.3));
}

function waveAt(x, z, t) {
  const zf = z + t * FLOW;
  return Math.sin(x * 0.031 + zf * 0.018) * 2.1
       + Math.sin(zf * 0.052 - x * 0.011) * 1.5
       + Math.sin((x + zf) * 0.085 + t * 0.7) * 0.7;
}

// --- camera ------------------------------------------------------------
// Portrait is a tall, narrow window: the camera sits high and well back and
// looks down ~29 degrees, so the river fills the frame with a sliver of sky.
const FOV = 68, CAM_BACK = 150, CAM_UP = 170, LOOK_AHEAD = 150, LOOK_UP = 4;

export class Renderer3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(SKY);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 650, 2600);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2600);
    this.camera.position.set(0, CAM_UP, CAM_BACK);

    this.scene.add(new THREE.HemisphereLight(0xdff3ff, 0x4f7a34, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-180, 320, 160);
    this.scene.add(sun);

    this.makeWater();
    this.scene.add(this.farWater, this.water);

    this.boat = makeLlamaBoat();
    this.scene.add(this.boat);

    this.particles = this.makeParticles();
    this.scene.add(this.particles);

    this.menuGroup = buildMenuRiver();
    this.scene.add(this.menuGroup);

    this.levelGroup = null;
    this.session = null;
    this.logMeshes = [];
    this.swirlMeshes = [];
    this.carrotMeshes = [];
    this.lastT = 0;
    this.camLook = new THREE.Vector3(0, 0, -LOOK_AHEAD);

    this.fx = document.getElementById('fx');
    this.progress = document.getElementById('progress');
    this.progressFill = document.getElementById('progress-fill');
    this.progressDot = document.getElementById('progress-dot');
  }

  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  makeWater() {
    const g = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEG, WATER_SEG);
    g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, mat(COL.water));
    const fg = new THREE.PlaneGeometry(26000, 26000);
    fg.rotateX(-Math.PI / 2);
    this.farWater = new THREE.Mesh(fg, mat(COL.waterFar));
    this.farWater.position.y = -1.2;
  }

  updateWater(cx, cz, t) {
    const cell = WATER_SIZE / WATER_SEG;
    // Snap the sheet to its own grid so the waves do not swim with the camera.
    const sx = Math.round(cx / cell) * cell, sz = Math.round(cz / cell) * cell;
    this.water.position.set(sx, 0, sz);
    this.farWater.position.set(cx, -1.2, cz);
    const arr = this.water.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = waveAt(arr[i] + sx, arr[i + 2] + sz, t) * rimFade(arr[i], arr[i + 2]);
    }
    this.water.geometry.attributes.position.needsUpdate = true;
  }

  makeParticles() {
    const MAX = 280;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    const m = new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, map: dotTexture() });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.userData.max = MAX;
    return p;
  }

  updateParticles(session, t) {
    const geo = this.particles.geometry;
    const pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const max = this.particles.userData.max;
    const list = session ? session.particles : [];
    const n = Math.min(list.length, max);
    const water = new THREE.Color(COL.water);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const x = p.x - HALF, z = -p.y;
      pos[i * 3] = x;
      pos[i * 3 + 1] = waveAt(x, z, t) + 2.5;
      pos[i * 3 + 2] = z;
      // PointsMaterial has no per-point alpha, so fade toward the water colour.
      c.set(p.color.startsWith('#') ? p.color : COL.white);
      c.lerp(water, 1 - Math.max(0, Math.min(1, p.life / p.maxLife)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    for (let i = n; i < max; i++) pos[i * 3 + 1] = -9999; // park unused points
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, max);
  }

  // --- level geometry ---------------------------------------------------
  buildLevel(session) {
    this.disposeLevel();
    const level = session.level;
    const g = new THREE.Group();

    g.add(buildBanks(level, -340, level.length + 420));
    g.add(buildProps(level, -300, level.length + 380));
    g.add(buildBeach(level));
    g.add(buildDock(level));

    this.logMeshes = [];
    this.swirlMeshes = [];
    for (const o of session.obstacles) {
      let mesh;
      if (o.type === 'rock') mesh = makeRock(o);
      else if (o.type === 'log') { mesh = makeLog(o); this.logMeshes.push({ o, mesh }); }
      else { mesh = makeWhirlpool(o); this.swirlMeshes.push({ o, mesh }); }
      mesh.position.set(o.x - HALF, mesh.position.y, -o.y);
      g.add(mesh);
    }

    this.carrotMeshes = [];
    for (const c of session.carrots) {
      const mesh = makeCarrot();
      mesh.position.set(c.x - HALF, 6, -c.y);
      this.carrotMeshes.push({ c, mesh });
      g.add(mesh);
    }

    this.scene.add(g);
    this.levelGroup = g;
    this.session = session;
  }

  disposeLevel() {
    if (!this.levelGroup) return;
    this.levelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.levelGroup);
    this.levelGroup = null;
    this.session = null;
  }

  // --- frames -----------------------------------------------------------
  renderSession(session, t) {
    const dt = Math.min(0.05, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (session !== this.session) this.buildLevel(session);

    this.menuGroup.visible = false;
    this.levelGroup.visible = true;
    this.progress.classList.remove('hidden');

    const b = session.boat, level = session.level;
    const bx = b.x - HALF, bz = -b.y;

    // Boat rides the surface: height from the wave, pitch from its slope.
    const h = waveAt(bx, bz, t);
    const slope = (waveAt(bx, bz - 14, t) - waveAt(bx, bz + 14, t)) / 28;
    this.boat.position.set(bx, h + 2, bz);
    this.boat.rotation.set(Math.atan(slope) * 0.8, -b.lean * 0.3, -b.lean * 0.45);
    this.boat.visible = !(b.invuln > 0 && Math.floor(t * 14) % 2 === 0);
    this.boat.userData.row(t, session.status === 'won');

    for (const { o, mesh } of this.logMeshes) mesh.position.x = o.x - HALF;
    for (const { o, mesh } of this.swirlMeshes) {
      mesh.rotation.y = -o.spin;
      mesh.children[0].rotation.y = o.spin * 1.7;
    }
    for (const { c, mesh } of this.carrotMeshes) {
      mesh.visible = !c.taken;
      if (!c.taken) { mesh.rotation.y = t * 1.8; mesh.position.y = 7 + Math.sin(t * 3 + c.x) * 1.6; }
    }

    this.updateParticles(session, t);

    // Chase camera. It tracks the boat laterally, so whatever is near your lane
    // stays on screen; it stops at the dock so the arrival is visible.
    const followY = Math.min(b.y, level.length - 30);
    const centre = riverBounds(level, b.y).center - HALF;
    const camX = bx + (centre - bx) * 0.25;
    const want = new THREE.Vector3(camX, CAM_UP + h * 0.4, -followY + CAM_BACK);
    const k = 1 - Math.exp(-7 * dt);
    this.camera.position.lerp(want, k);
    if (session.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * session.shake * 0.9;
      this.camera.position.y += (Math.random() - 0.5) * session.shake * 0.9;
    }
    this.camLook.lerp(new THREE.Vector3(camX * 0.6, LOOK_UP, -followY - LOOK_AHEAD), k);
    this.camera.lookAt(this.camLook);

    this.updateWater(this.camera.position.x, this.camera.position.z, t);

    // Overlays that render.js used to paint on the canvas.
    const flash = session.flash, pull = session.pull;
    if (flash > 0) { this.fx.style.setProperty('--fx-color', 'rgba(220,30,30,.9)'); this.fx.style.opacity = flash * 0.75; }
    else if (pull > 0) { this.fx.style.setProperty('--fx-color', 'rgba(20,40,120,.9)'); this.fx.style.opacity = pull * 0.5; }
    else this.fx.style.opacity = 0;

    const pct = (session.progress() * 100).toFixed(1) + '%';
    this.progressFill.style.height = pct;
    this.progressDot.style.bottom = pct;

    this.renderer.render(this.scene, this.camera);
  }

  renderBackdrop(t) {
    this.lastT = t;
    if (this.levelGroup) this.levelGroup.visible = false;
    this.menuGroup.visible = true;
    this.progress.classList.add('hidden');
    this.fx.style.opacity = 0;

    const bx = Math.sin(t * 0.35) * 42, bz = 0;
    const h = waveAt(bx, bz, t);
    this.boat.position.set(bx, h + 2, bz);
    this.boat.rotation.set(0, Math.sin(t * 0.35) * 0.25, Math.cos(t * 0.35) * 0.12);
    this.boat.visible = true;
    this.boat.userData.row(t, false);

    const a = t * 0.12;
    this.camera.position.set(Math.sin(a) * 120, 74, CAM_BACK + 26 + Math.cos(a) * 40);
    this.camera.lookAt(0, 10, -120);

    this.updateParticles(null, t);
    this.updateWater(this.camera.position.x, this.camera.position.z, t);
    this.renderer.render(this.scene, this.camera);
  }
}

// --- geometry builders ---------------------------------------------------

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function meshFrom(verts, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

// Banks follow the level's meander: a sand lip at the water line, grass beyond.
function buildBanks(level, yFrom, yTo, step = 26) {
  const sand = [], grass = [];
  const OUT = 900;
  let prev = null;
  for (let y = yFrom; y <= yTo; y += step) {
    const b = riverBounds(level, y);
    const cur = { z: -y, L: b.left - HALF, R: b.right - HALF };
    if (prev) {
      quad(sand,
        [prev.L, 0.4, prev.z], [prev.L - 16, 5, prev.z], [cur.L - 16, 5, cur.z], [cur.L, 0.4, cur.z]);
      quad(grass,
        [prev.L - 16, 5, prev.z], [prev.L - OUT, 9, prev.z], [cur.L - OUT, 9, cur.z], [cur.L - 16, 5, cur.z]);
      quad(sand,
        [prev.R, 0.4, prev.z], [cur.R, 0.4, cur.z], [cur.R + 16, 5, cur.z], [prev.R + 16, 5, prev.z]);
      quad(grass,
        [prev.R + 16, 5, prev.z], [cur.R + 16, 5, cur.z], [cur.R + OUT, 9, cur.z], [prev.R + OUT, 9, prev.z]);
    }
    prev = cur;
  }
  const g = new THREE.Group();
  g.add(meshFrom(sand, M.sand));
  g.add(meshFrom(grass, M.grass));
  return g;
}

// Trees and bushes, instanced and placed from the same hash as the 2D art.
function buildProps(level, yFrom, yTo, step = 46) {
  const slots = [];
  for (let y = yFrom; y <= yTo; y += step) {
    const b = riverBounds(level, y);
    for (const side of [-1, 1]) {
      const h1 = hash(y * (side > 0 ? 1.7 : 2.3));
      if (h1 < 0.22) continue;
      const edge = side < 0 ? b.left - HALF - 16 : b.right - HALF + 16;
      const out = 24 + h1 * 330;
      slots.push({
        x: edge + side * out,
        z: -(y + hash(y + side) * step),
        s: 7 + hash(y * 3.1 + side) * 9,
        tree: hash(y * 5.7 + side) > 0.45,
      });
    }
  }
  const group = new THREE.Group();
  const trees = slots.filter((s) => s.tree), bushes = slots.filter((s) => !s.tree);

  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.6, 1, 5), M.logDark, trees.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), M.foliage, trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    trees.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 8 + s.s * 0.5, s.z), q, new THREE.Vector3(1, s.s, 1));
      trunk.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(s.x, 8 + s.s * 1.6, s.z), q, new THREE.Vector3(s.s * 0.95, s.s * 2.1, s.s * 0.95));
      crown.setMatrixAt(i, m);
    });
    group.add(trunk, crown);
  }
  if (bushes.length) {
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M.foliageLight, bushes.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    bushes.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 8 + s.s * 0.35, s.z), q, new THREE.Vector3(s.s * 0.8, s.s * 0.6, s.s * 0.8));
      bush.setMatrixAt(i, m);
    });
    group.add(bush);
  }
  return group;
}

function buildBeach(level) {
  const b = riverBounds(level, 0);
  const g = new THREE.Mesh(new THREE.BoxGeometry(b.right - b.left + 60, 6, 240), M.sand);
  g.position.set(b.center - HALF, 2, 122);
  return g;
}

function buildDock(level) {
  const y = level.length, z = -y;
  const b = riverBounds(level, y);
  const w = b.right - b.left, cx = b.center - HALF;
  const g = new THREE.Group();

  const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 44, 8, 34), M.log);
  deck.position.set(cx, 11, z - 19);
  g.add(deck);

  for (let x = -(w + 44) / 2 + 6; x < (w + 44) / 2; x += 15) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(11, 2, 32), M.logLight);
    plank.position.set(cx + x, 15.4, z - 19);
    g.add(plank);
  }
  for (const px of [b.left - HALF + 6, cx, b.right - HALF - 6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 22, 6), M.logDark);
    post.position.set(px, 2, z - 3);
    g.add(post);
  }
  // finish line
  for (let x = b.left - HALF, i = 0; x < b.right - HALF; x += 13, i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(13, 1.2, 7), i % 2 ? M.white : M.dark);
    seg.position.set(x + 6.5, 1.2, z + 2);
    g.add(seg);
  }
  // B flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 54, 6), M.white);
  pole.position.set(cx, 42, z - 30);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(30, 17), M.scarf);
  flag.position.set(cx + 16, 60, z - 30);
  g.add(flag);
  // grass apron so the far shore reads as land behind the dock
  const apron = new THREE.Mesh(new THREE.BoxGeometry(w + 1200, 10, 500), M.grass);
  apron.position.set(cx, 5, z - 286);
  g.add(apron);
  return g;
}

function makeRock(o) {
  const g = new THREE.IcosahedronGeometry(o.r * 1.15, 0);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const j = hash(o.seed * 90 + i);
    p[i] *= 0.75 + j * 0.5; p[i + 1] *= 0.6 + j * 0.4; p[i + 2] *= 0.75 + j * 0.5;
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.rock);
  m.position.y = -o.r * 0.25;
  return m;
}

function makeLog(o) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.hl * 2, 8), M.log);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.92, o.r * 0.92, 1.4, 8), M.logLight);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = s * (o.hl + 0.7);
    g.add(cap);
  }
  g.position.y = 1.5;
  return g;
}

function makeWhirlpool(o) {
  const g = new THREE.Group();
  const funnel = new THREE.Mesh(new THREE.ConeGeometry(o.R * 0.62, 34, 12, 1, true), M.swirl);
  funnel.position.y = -15;
  g.add(funnel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(o.R * 0.6, 1.8, 4, 20), M.white);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  g.add(ring);
  g.position.y = 1;
  return g;
}

function makeCarrot() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(5.5, 17, 7), M.carrot);
  body.rotation.x = Math.PI;
  g.add(body);
  for (const a of [-0.5, 0, 0.5]) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.8, 7, 4), M.leaf);
    leaf.position.set(Math.sin(a) * 2.4, 11, Math.cos(a) * 1.2);
    leaf.rotation.z = a * 0.6;
    g.add(leaf);
  }
  return g;
}

// Llama in a rowing boat. userData.row(t, celebrating) animates the oars.
function makeLlamaBoat() {
  const g = new THREE.Group();

  // Hull: the 2D silhouette, extruded. Bow points downriver (-Z).
  const shape = new THREE.Shape();
  shape.moveTo(0, 27);
  shape.quadraticCurveTo(16, 10, 14, -12);
  shape.quadraticCurveTo(13, -25, 0, -26);
  shape.quadraticCurveTo(-13, -25, -14, -12);
  shape.quadraticCurveTo(-16, 10, 0, 27);
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 13, bevelEnabled: true, bevelSize: 1.6, bevelThickness: 1.6, bevelSegments: 1, curveSegments: 6 });
  hullGeo.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, M.hull);
  hull.position.y = 6;
  g.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 36), M.deck);
  deck.position.y = 6.6;
  g.add(deck);

  // Oars
  const oars = [];
  for (const s of [-1, 1]) {
    const oar = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 5), M.logDark);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = s * 15;
    oar.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 6), M.log);
    blade.position.set(s * 30, 0, 0);
    oar.add(blade);
    oar.position.set(0, 8, 2);
    g.add(oar);
    oars.push({ oar, s });
  }

  // Llama
  const llama = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(9, 8, 6), M.llama);
  body.scale.set(1, 0.85, 1.15);
  body.position.y = 13;
  llama.add(body);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(15, 5, 13), M.scarf);
  blanket.position.y = 12;
  llama.add(blanket);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 20, 7), M.llama);
  neck.position.set(0, 26, -1.5);
  neck.rotation.x = -0.12;
  llama.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(5.6, 8, 6), M.llama);
  head.scale.set(1, 0.95, 1.25);
  head.position.set(0, 37, -3);
  llama.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(3, 7, 5), M.pink);
  snout.scale.set(1, 0.8, 1.1);
  snout.position.set(0, 35.5, -8.5);
  llama.add(snout);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(1.9, 7, 5), M.llama);
    ear.position.set(s * 3.2, 43, -2);
    ear.rotation.z = s * 0.3;
    llama.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 5), M.ink);
    eye.position.set(s * 3.1, 38.5, -7);
    llama.add(eye);
  }
  const scarf = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 4, 8), M.scarf);
  scarf.position.set(0, 22, -2);
  llama.add(scarf);
  g.add(llama);

  g.userData.row = (t, celebrating) => {
    const sw = Math.sin(t * (celebrating ? 14 : 7));
    for (const { oar, s } of oars) {
      oar.rotation.x = sw * 0.5;
      oar.rotation.z = s * sw * 0.12;
    }
    llama.position.y = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
  };
  return g;
}

// Straight stretch of river shown behind the menus.
function buildMenuRiver() {
  const level = { riverWidth: 260, meanderAmp: 22, meanderLen: 760 };
  const g = new THREE.Group();
  g.add(buildBanks(level, -700, 1500));
  g.add(buildProps(level, -680, 1480));
  return g;
}
