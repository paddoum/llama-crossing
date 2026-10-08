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
  wool: 0xf2e6cf, skin: 0xe9d9bc, pink: 0xe8a9a3, ink: 0x2a2420,
  blanketA: 0xc0392b, blanketB: 0x1f6f8b, scarf: 0xe2453b,
  virus: 0xe0479e, virusDark: 0x9c2a68, virusCore: 0xffd3ec, spit: 0xeaffd0,
  swirl: 0x0d2b52, white: 0xffffff, dark: 0x1a1a1a,
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
  wool: mat(COL.wool, { flatShading: true }),
  skin: mat(COL.skin, { flatShading: false }),
  pink: mat(COL.pink, { flatShading: false }),
  blanketA: mat(COL.blanketA, { side: THREE.DoubleSide, flatShading: false }),
  blanketB: mat(COL.blanketB, { side: THREE.DoubleSide, flatShading: false }),
  white: mat(COL.white, { side: THREE.DoubleSide }),
  scarf: mat(COL.scarf),
  ink: mat(COL.ink),
  virus: mat(COL.virus),
  virusDark: mat(COL.virusDark),
  virusCore: mat(COL.virusCore),
  spit: mat(COL.spit),
  swirl: mat(COL.swirl, { side: THREE.DoubleSide }),
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
    // preserveDrawingBuffer keeps the last frame readable by gl.readPixels after
    // it is drawn, which is the only dependable way to check what the 3D build
    // actually put on screen (see "Verifying the 3D build" in the README).
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
    });
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
    this.virusMeshes = [];
    this.spitPool = [];
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

  // Spit is pooled: a handful of blobs reused for the whole run.
  updateSpits(session, t) {
    const list = session.spits;
    while (this.spitPool.length < list.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(6.5, 7, 5), M.spit);
      m.visible = false;
      this.scene.add(m);
      this.spitPool.push(m);
    }
    this.spitPool.forEach((m, i) => {
      const s = list[i];
      m.visible = !!s;
      if (!s) return;
      const x = s.x - HALF, z = -s.y;
      m.position.set(x, waveAt(x, z, t) + 16, z);
      const k = 0.6 + 0.4 * (s.life / s.maxLife);
      m.scale.set(k, k, k * 1.4);
    });
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

    this.virusMeshes = [];
    const proto = makeVirus();
    for (const v of session.viruses) {
      const mesh = proto.clone();
      mesh.position.set(v.x - HALF, 11, -v.y);
      this.virusMeshes.push({ v, mesh });
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
    for (const { v, mesh } of this.virusMeshes) {
      mesh.visible = !v.dead;
      if (v.dead) continue;
      mesh.position.x = v.x - HALF;
      mesh.position.y = 11 + Math.sin(t * 2.4 + v.phase) * 2.2;
      mesh.rotation.set(v.spin * 0.6, v.spin, v.spin * 0.3);
    }
    this.updateSpits(session, t);

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
    this.camera.position.set(Math.sin(a) * 90, 96, 150 + Math.cos(a) * 34);
    this.camera.lookAt(0, 14, -40);

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

function makeVirus() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 0), M.virus);
  g.add(core);
  const spikeGeo = new THREE.ConeGeometry(2.4, 8, 4);
  const knobGeo = new THREE.SphereGeometry(2.6, 5, 4);
  // Spikes on the icosahedron's own vertex directions, so they sit on the hull.
  const dirs = [];
  const pos = core.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    if (!dirs.some((d) => d.dot(v) > 0.9)) dirs.push(v);
  }
  for (const d of dirs) {
    const spike = new THREE.Mesh(spikeGeo, M.virusDark);
    spike.position.copy(d).multiplyScalar(13);
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    g.add(spike);
    const knob = new THREE.Mesh(knobGeo, M.virusDark);
    knob.position.copy(d).multiplyScalar(18);
    g.add(knob);
  }
  for (const [a, b, c] of [[-4, -3, 8], [5, 4, 8], [0, 6, 8.5]]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2.4, 5, 4), M.virusCore);
    dot.position.set(a, b, c);
    g.add(dot);
  }
  return g;
}

// Welds many small parts into one geometry. The llama is built from ~150 wool
// puffs; without this it would cost ~150 draw calls a frame on a phone.
function weld(parts) {
  let total = 0;
  const prepped = parts.map(({ geo, m }) => {
    const g = geo.clone().applyMatrix4(m).toNonIndexed();
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of prepped) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count * 3 / 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// Collects transformed geometry for one material, then welds it.
function Welder() {
  const parts = [];
  const tmp = new THREE.Object3D();
  return {
    add(geo, pos, scale, rot) {
      tmp.position.set(...(pos || [0, 0, 0]));
      tmp.scale.set(...(scale || [1, 1, 1]));
      tmp.rotation.set(...(rot || [0, 0, 0]));
      tmp.updateMatrix();
      parts.push({ geo, m: tmp.matrix.clone() });
      return this;
    },
    mesh(material) { return new THREE.Mesh(weld(parts), material); },
    empty() { return parts.length === 0; },
  };
}

// Llama ported from the standalone model, seated in the boat (no legs: the
// hull hides them) and scaled to the river's units. Faces +X locally, so the
// group is yawed a quarter turn to look over the bow.
function makeLlama() {
  const g = new THREE.Group();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const puff = (r) => new THREE.IcosahedronGeometry(r, 0);
  const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

  // Body: one sphere wrapped in wool puffs, all welded together.
  const BC = [0, 2.0, 0], BR = [1.45, 0.8, 0.78];
  const bodyW = Welder();
  bodyW.add(sph(1, 20, 14), BC, BR);
  for (let i = 0; i < 80; i++) {
    const th = rnd() * Math.PI * 0.72, ph = rnd() * Math.PI * 2;
    const x = Math.cos(ph) * Math.sin(th), z = Math.sin(ph) * Math.sin(th), y = Math.cos(th);
    if (Math.abs(x) < 0.62 && y > 0.35) continue;
    bodyW.add(puff(0.18 + rnd() * 0.13),
      [BC[0] + x * BR[0] * 0.93, BC[1] + y * BR[1] * 0.93, BC[2] + z * BR[2] * 0.93],
      null, [rnd() * 3, rnd() * 3, 0]);
  }
  for (let i = 0; i < 16; i++) {
    const ph = rnd() * Math.PI * 2;
    bodyW.add(puff(0.24), [Math.cos(ph) * 0.8, 1.45, Math.sin(ph) * 0.45]);
  }
  g.add(bodyW.mesh(M.wool));

  // Saddle blanket
  const blanket = new THREE.Mesh(new THREE.SphereGeometry(1.08, 24, 10, 0, Math.PI * 2, 0, 1.15), M.blanketA);
  blanket.position.set(...BC); blanket.scale.set(0.6, 0.9, 0.88);
  g.add(blanket);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.11, 24, 4, 0, Math.PI * 2, 0.98, 0.14), M.blanketB);
  stripe.position.set(...BC); stripe.scale.set(0.6, 0.9, 0.88);
  g.add(stripe);

  // Tail
  const tail = new THREE.Group();
  tail.position.set(-1.45, 2.15, 0);
  const tailW = Welder();
  for (let i = 0; i < 6; i++) tailW.add(puff(0.18 + rnd() * 0.08), [-0.1 - i * 0.05, -i * 0.1, (rnd() - 0.5) * 0.15]);
  tail.add(tailW.mesh(M.wool));
  g.add(tail);

  // Neck
  const neck = new THREE.Group();
  neck.position.set(1.05, 2.25, 0);
  neck.rotation.z = -0.16;
  const neckW = Welder();
  neckW.add(new THREE.CylinderGeometry(0.3, 0.42, 1.7, 12), [0, 0.8, 0]);
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, h = rnd() * 1.55, r = 0.4 - h * 0.07;
    neckW.add(puff(0.18 + rnd() * 0.08), [Math.cos(a) * r, h + 0.05, Math.sin(a) * r]);
  }
  neck.add(neckW.mesh(M.wool));
  g.add(neck);

  // Head
  const head = new THREE.Group();
  head.position.set(0.12, 1.72, 0);
  neck.add(head);
  const skullW = Welder();
  skullW.add(sph(1, 16, 12), [0, 0, 0], [0.5, 0.42, 0.4]);
  skullW.add(sph(1, 14, 10), [0.42, -0.12, 0], [0.34, 0.25, 0.27]);
  head.add(skullW.mesh(M.skin));
  const jaw = new THREE.Mesh(sph(1, 12, 8), M.skin);
  jaw.position.set(0.36, -0.27, 0); jaw.scale.set(0.24, 0.12, 0.2);
  head.add(jaw);
  const nostrils = Welder();
  nostrils.add(sph(0.035, 6, 5), [0.74, -0.06, 0.09]);
  nostrils.add(sph(0.035, 6, 5), [0.74, -0.06, -0.09]);
  head.add(nostrils.mesh(M.ink));
  const headW = Welder();
  for (let i = 0; i < 9; i++) headW.add(puff(0.12 + rnd() * 0.05), [-0.12 + rnd() * 0.25, 0.36 + rnd() * 0.08, (rnd() - 0.5) * 0.35]);
  head.add(headW.mesh(M.wool));

  const eyes = [], ears = [];
  for (const sgn of [1, -1]) {
    const eye = new THREE.Mesh(sph(0.075, 8, 6), M.ink);
    eye.position.set(0.27, 0.1, 0.29 * sgn);
    head.add(eye);
    eyes.push(eye);
    const glint = new THREE.Mesh(sph(0.022, 5, 4), M.white);
    glint.position.set(0.33, 0.13, 0.3 * sgn);
    head.add(glint);

    const ear = new THREE.Group();
    ear.position.set(-0.08, 0.34, 0.2 * sgn);
    ear.rotation.set(0.25 * sgn, 0, -0.15);
    head.add(ear);
    ear.add(meshAt(new THREE.ConeGeometry(0.11, 0.5, 8), M.skin, [0, 0.25, 0]));
    ear.add(meshAt(new THREE.ConeGeometry(0.06, 0.36, 7), M.pink, [0.05, 0.22, 0]));
    ears.push(ear);
  }

  // Idle life: chewing, a slow look around, tail, blinks and ear twitches.
  let blinkAt = 2, twitchAt = 3, twitchEar = 0;
  const animate = (t, celebrating) => {
    const sp = celebrating ? 2.2 : 1;
    jaw.position.y = -0.27 + Math.sin(t * 7) * 0.025;
    jaw.rotation.y = Math.sin(t * 3.5) * 0.12;
    neck.rotation.z = -0.16 + Math.sin(t * 0.8 * sp) * 0.05;
    head.rotation.y = Math.sin(t * 0.45 * sp) * 0.25;
    tail.rotation.y = Math.sin(t * 2.2 * sp) * 0.25;
    if (t > blinkAt) {
      const k = Math.min(1, (t - blinkAt) / 0.15);
      for (const e of eyes) e.scale.y = Math.abs(1 - 2 * k) || 0.1;
      if (k >= 1) { blinkAt = t + 2 + Math.random() * 3; for (const e of eyes) e.scale.y = 1; }
    }
    if (t > twitchAt) {
      const k = (t - twitchAt) / 0.35;
      ears[twitchEar].rotation.z = -0.15 - Math.sin(Math.min(k, 1) * Math.PI) * 0.5;
      if (k >= 1) { twitchAt = t + 1.5 + Math.random() * 3; twitchEar = Math.random() < 0.5 ? 0 : 1; }
    }
  };
  return { group: g, animate };
}

function meshAt(geo, material, pos) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  return m;
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

  // Llama, seated: scaled to river units and yawed so it faces the bow (-Z).
  const LLAMA_SCALE = 9.5;
  const { group: llama, animate: liven } = makeLlama();
  llama.scale.setScalar(LLAMA_SCALE);
  llama.rotation.y = Math.PI / 2;
  llama.position.set(0, -3.4, 3);
  g.add(llama);

  g.userData.row = (t, celebrating) => {
    const sw = Math.sin(t * (celebrating ? 14 : 7));
    for (const { oar, s } of oars) {
      oar.rotation.x = sw * 0.5;
      oar.rotation.z = s * sw * 0.12;
    }
    llama.position.y = -3.4 + (celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0);
    liven(t, celebrating);
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
