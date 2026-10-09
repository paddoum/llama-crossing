// 3D renderer: identical simulation, Three.js scene.
// World -> scene: X = x - 180 (across the river), Y = up, Z = -y (downriver is +Z).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LOGICAL_W, riverBounds } from './levels.js';

const HALF = LOGICAL_W / 2;
const SKY = 0x9ed9f3;

const COL = {
  water: 0x2f86c6, grass: 0x6cc04a, grassDark: 0x4f9c37, sand: 0xe8d38a,
  rock: 0x7d8791, log: 0x8b5a2b, logLight: 0xa7713a, logDark: 0x5f3a17,
  hull: 0xa35f2a, hullDark: 0x6e3d15, deck: 0xc98a4b, mast: 0x8a6136,
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
  mast: mat(COL.mast),
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

// --- water ---------------------------------------------------------------
// The surface is a GPU-displaced sheet that follows the camera, plus a flat
// plane for the far field. Waves are anchored to world space, so nothing
// swims when the sheet moves, and the sheet's amplitude tapers at its rim so
// it meets the far plane invisibly.
const WATER_SIZE = 1800, WATER_SEG = 100, WATER_HALF = WATER_SIZE / 2;
const FLOW = 34;

// Four directional sines. KEEP IN SYNC with wave() in the vertex shader below:
// the boat, the spit and the foam particles all ride on this JS copy.
const WAVES = [
  { a: 2.10, kx: 0.031, kz: 0.018, w: 0.35 },
  { a: 1.50, kx: -0.011, kz: 0.052, w: 0.21 },
  { a: 0.70, kx: 0.085, kz: 0.085, w: 0.70 },
  { a: 0.35, kx: 0.170, kz: -0.120, w: 1.30 },
];

function waveAt(x, z, t) {
  const q = z + t * FLOW;
  let h = 0;
  for (const { a, kx, kz, w } of WAVES) h += a * Math.sin(kx * x + kz * q + t * w);
  return h;
}

const WAVE_GLSL = WAVES.map(({ a, kx, kz, w }) =>
  `  ph = ${kx.toFixed(3)} * q.x + ${kz.toFixed(3)} * q.y + uTime * ${w.toFixed(2)};
  h += ${a.toFixed(2)} * sin(ph);
  g += ${a.toFixed(2)} * cos(ph) * vec2(${kx.toFixed(3)}, ${kz.toFixed(3)});`).join('\n');

const WATER_VERT = `
#include <fog_pars_vertex>
uniform float uTime, uFlow, uAmp, uTaperHalf;
varying vec3 vWorld;
varying vec3 vWNormal;
varying float vCrest;

float wave(vec2 p, out vec2 g) {
  vec2 q = vec2(p.x, p.y + uFlow * uTime);
  float h = 0.0, ph;
  g = vec2(0.0);
${WAVE_GLSL}
  return h;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Flatten towards the rim of the sheet so it blends into the far plane.
  float edge = max(abs(position.x), abs(position.y)) / uTaperHalf;
  float amp = uAmp * (1.0 - smoothstep(0.55, 1.0, edge));
  vec2 g;
  float h = wave(world.xz, g);
  world.y += amp * h;
  vWorld = world.xyz;
  vCrest = amp * h;
  vWNormal = normalize(vec3(-amp * g.x, 1.0, -amp * g.y));
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = `
#include <fog_pars_fragment>
uniform vec3 uSunDir, uSunCol, uSkyCol, uGroundCol, uShallow, uDeep, uFoam, uCamPos;
uniform float uTime, uMeanderAmp, uMeanderLen, uHalfWidth, uShore;
varying vec3 vWorld;
varying vec3 vWNormal;
varying float vCrest;

void main() {
  vec3 N = normalize(vWNormal);
  vec3 V = normalize(uCamPos - vWorld);

  vec3 ambient = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 base = mix(uDeep, uShallow, smoothstep(-2.0, 2.2, vCrest));
  vec3 col = base * (ambient * 0.78 + uSunCol * diff * 0.45);

  // Sun glitter on the slopes facing the light.
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), 110.0) * 1.6;

  // Grazing angles pick up the sky, which is what reads as "wet".
  col = mix(col, uSkyCol, pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.5);

  // Foam on the crests.
  col = mix(col, uFoam, smoothstep(1.6, 3.0, vCrest) * 0.55);

  // Foam along both banks, following the level's meander.
  float centre = uMeanderAmp * sin((-vWorld.z) / uMeanderLen * 6.2831853);
  float edge = abs(abs(vWorld.x - centre) - uHalfWidth);
  float wobble = sin(vWorld.z * 0.21 + uTime * 1.7) * 2.6 + sin(vWorld.z * 0.07 - uTime * 0.9) * 2.0;
  col = mix(col, uFoam, (1.0 - smoothstep(0.0, 15.0, edge + wobble)) * uShore);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeWaterMaterial({ amp, shore }) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uFlow: { value: FLOW },
        uAmp: { value: amp },
        uTaperHalf: { value: WATER_HALF },
        uShore: { value: shore },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(-180, 320, 160).normalize() },
        uSunCol: { value: new THREE.Color(0xffffff) },
        uSkyCol: { value: new THREE.Color(0xdff3ff) },
        uGroundCol: { value: new THREE.Color(0x3f6a8a) },
        uShallow: { value: new THREE.Color(0x4fa3d8) },
        uDeep: { value: new THREE.Color(0x1f5f92) },
        uFoam: { value: new THREE.Color(0xeaf6ff) },
        uMeanderAmp: { value: 0 },
        uMeanderLen: { value: 900 },
        uHalfWidth: { value: 130 },
      },
    ]),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
}

// --- camera ------------------------------------------------------------
// Portrait is a tall, narrow window: the camera sits high and well back and
// looks down ~29 degrees, so the river fills the frame with a sliver of sky.
const FOV = 68, CAM_BACK = 150, CAM_UP = 170, LOOK_AHEAD = 150, LOOK_UP = 4;

// Menu backdrop. The boat has to fit the strip of screen the menu buttons
// leave free, which varies with the screen and the window, so the camera
// distance is derived from that strip rather than fixed.
const MENU_BOAT_H = 74, MENU_BOAT_MID = 29;

// Sculpted llama. It is modelled standing and facing +Z, so it gets a half
// turn to face the bow; the legs drop through the hull and finish below the
// waterline, where the opaque water hides them.
const LLAMA_URL = 'assets/llama.glb';
// Seated: dropped so the gunwale crosses above the legs, which puts the body
// in the boat rather than standing over it. The legs run on through the hull
// and finish under the waterline, where the opaque water hides them.
const LLAMA_MODEL_SCALE = 24, LLAMA_MODEL_Y = 16.4;

// The llama is one static mesh with no skeleton, so the forelegs are bent in
// the vertex shader: vertices below the shoulder and forward of it rotate
// about the shoulder, weighted so it bends rather than shearing off. They
// also shorten, because the leg is twice as long as the reach to the oar.
const ARM = { shoulderY: -0.18, shoulderZ: 0.08, falloff: 0.30, restY: -0.90, restZ: 0.09 };

// Sculpted rowboat. Modelled Y-up with the bow at +X, so it gets a quarter
// turn to point down-river. The oars are separate nodes, so they can row.
const BOAT_URL = 'assets/rowboat.glb';
// The hull is shallow next to the wave amplitude, and the boat takes its
// height from a single wave sample at its centre, so the ends can dip. It
// rides high enough that the floor stays dry; the camera looks down, so the
// gap under the hull is hidden by the hull itself.
const BOAT_SCALE = 5.7, BOAT_Y = 0.8, HULL_HALF = 29;
const OARLOCK = { x: -1.2, y: 1.95, z: 1.87 };  // where an oar crosses the gunwale

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
    this.menuLook = new THREE.Vector3(0, 12, -120);
    this.menuTip = new THREE.Vector3();

    this.loadLlama();
    this.loadBoat();

    this.fx = document.getElementById('fx');
    this.progress = document.getElementById('progress');
    this.progressFill = document.getElementById('progress-fill');
    this.progressDot = document.getElementById('progress-dot');
  }

  // Loaded in the background: the built-in llama rows until this arrives, so
  // a slow connection or a missing file never blocks the game.
  loadLlama() {
    new GLTFLoader().load(LLAMA_URL, (gltf) => {
      const model = gltf.scene;
      this.armUniforms = { uArm: { value: 0 }, uReach: { value: 1 } };
      model.traverse((o) => {
        if (!o.isMesh) return;
        // Lambert to match the rest of the scene's lighting, keeping the map.
        o.material = new THREE.MeshLambertMaterial({ map: o.material.map, side: THREE.DoubleSide });
        o.material.onBeforeCompile = (shader) => {
          shader.uniforms.uArm = this.armUniforms.uArm;
          shader.uniforms.uReach = this.armUniforms.uReach;
          shader.vertexShader = `
            uniform float uArm;
            uniform float uReach;
            float armWeight(vec3 p) {
              return smoothstep(${ARM.shoulderY.toFixed(3)}, ${(ARM.shoulderY - ARM.falloff).toFixed(3)}, p.y)
                   * smoothstep(-0.02, 0.06, p.z);
            }
            vec3 armBend(vec3 p, float w) {
              vec3 pivot = vec3(p.x, ${ARM.shoulderY.toFixed(3)}, ${ARM.shoulderZ.toFixed(3)});
              vec3 rel = p - pivot;
              float a = uArm * w;
              float c = cos(a), s = sin(a);
              vec3 rot = vec3(rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
              return pivot + rot * (1.0 - (1.0 - uReach) * w);
            }
            vec3 armRotate(vec3 v, float w) {
              float a = uArm * w;
              float c = cos(a), s = sin(a);
              return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
            }
          ` + shader.vertexShader;
          shader.vertexShader = shader.vertexShader
            .replace('#include <beginnormal_vertex>',
              '#include <beginnormal_vertex>\n  objectNormal = armRotate(objectNormal, armWeight(position));')
            .replace('#include <begin_vertex>',
              '#include <begin_vertex>\n  transformed = armBend(transformed, armWeight(position));');
        };
        o.frustumCulled = false;
      });
      model.rotation.y = Math.PI;                 // modelled facing +Z, bow is -Z
      model.scale.setScalar(LLAMA_MODEL_SCALE);
      model.position.y = LLAMA_MODEL_Y;
      const crew = this.boat.userData.crew;
      crew.clear();
      crew.add(model);
      // No rig in the model, so it just leans with the swell.
      this.boat.userData.liven = (t, celebrating) => {
        model.rotation.z = Math.sin(t * 0.9) * 0.03 + (celebrating ? Math.sin(t * 9) * 0.05 : 0);
        model.rotation.y = Math.PI + Math.sin(t * 0.45) * 0.07;
      };
      this.llamaModel = model;
    }, undefined, (err) => {
      console.warn('Llama model failed to load; keeping the built-in one.', err);
    });
  }

  // Same background-load pattern as the llama: the code-built boat rows until
  // the sculpted one arrives.
  loadBoat() {
    new GLTFLoader().load(BOAT_URL, (gltf) => {
      const model = new THREE.Group();
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshLambertMaterial({ map: o.material.map, side: THREE.DoubleSide });
        o.frustumCulled = false;
      });
      model.add(gltf.scene);
      model.updateMatrixWorld(true);   // still at identity, so world == model space

      // Hang each oar off a pivot at its oarlock. GLTFLoader sanitises node
      // names (paddle.001 -> paddle001), so match on a prefix and take each
      // oar's side from where it actually sits rather than from its name.
      const oarNodes = [];
      gltf.scene.traverse((o) => { if (!o.isMesh && /^paddle/i.test(o.name)) oarNodes.push(o); });
      const oars = [];
      for (const oar of oarNodes) {
        const centre = new THREE.Box3().setFromObject(oar).getCenter(new THREE.Vector3());
        const side = centre.z >= 0 ? 1 : -1;
        const pivot = new THREE.Group();
        pivot.position.set(OARLOCK.x, OARLOCK.y, OARLOCK.z * side);
        model.add(pivot);
        model.updateMatrixWorld(true);
        pivot.attach(oar);             // keeps the world transform
        oars.push({ pivot, side, oar });
      }

      // The handles the llama holds. The model poses its two oars at slightly
      // different pitches, so the arms aim at the midpoint between them and
      // split the difference rather than gripping one and missing the other.
      model.updateMatrixWorld(true);
      const held = oars.map(({ oar }) => oarTip(oar)).filter(Boolean);
      if (oars.length !== 2) console.warn(`Expected 2 oars, rigged ${oars.length}.`);

      model.scale.setScalar(BOAT_SCALE);
      model.rotation.y = Math.PI / 2;   // bow is +X in the model
      model.position.y = BOAT_Y;

      const boat = this.boat;
      const builtIn = boat.userData.builtIn;
      boat.remove(builtIn);
      // Shared materials stay; only the stand-in's own geometry is freed.
      builtIn.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      boat.add(model);

      boat.userData.rig = (t, celebrating, lean = 0) => {
        const rate = celebrating ? 9 : 4.4;
        const sweep = Math.sin(t * rate), dip = Math.cos(t * rate);
        for (const { pivot, side } of oars) {
          // The oarlocks are on opposite sides, so the yaw has to mirror for
          // the blades to sweep together instead of scissoring.
          pivot.rotation.y = sweep * 0.52 * side;
          pivot.rotation.x = dip * 0.30;          // blades lift on the recovery
        }
        if (held.length) this.reachForOar(held);
        model.rotation.z = -lean * 0.12;
        boat.userData.crew.position.y = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
        boat.userData.liven(t, celebrating);
      };
      this.boatModel = model;
    }, undefined, (err) => {
      console.warn('Boat model failed to load; keeping the built-in one.', err);
    });
  }

  // Points the llama's forelegs at the oar handle. The model has no skeleton,
  // so the shader bends the legs about the shoulder: this works out the angle
  // and how far to shorten them, which is all that bend takes.
  reachForOar(held) {
    const llama = this.boat.userData.crew.children[0];
    if (!this.armUniforms || !llama) return;
    this.boat.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const h of held) p.add(h.obj.localToWorld(h.local.clone()));
    p.multiplyScalar(1 / held.length);
    llama.worldToLocal(p);
    const relY = p.y - ARM.shoulderY, relZ = p.z - ARM.shoulderZ;
    const restY = ARM.restY - ARM.shoulderY, restZ = ARM.restZ - ARM.shoulderZ;
    const angle = Math.atan2(relZ, relY) - Math.atan2(restZ, restY);
    const reach = Math.hypot(relY, relZ) / Math.hypot(restY, restZ);
    this.armUniforms.uArm.value = angle;
    this.armUniforms.uReach.value = Math.max(0.25, Math.min(1, reach));
  }

  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  makeWater() {
    // The sheet is built in the XY plane so the vertex shader can read
    // position.xy as its own local grid, then laid flat by the model matrix.
    const g = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEG, WATER_SEG);
    this.waterMat = makeWaterMaterial({ amp: 1, shore: 0.8 });
    this.water = new THREE.Mesh(g, this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.frustumCulled = false;

    this.farWaterMat = makeWaterMaterial({ amp: 0, shore: 0 });
    this.farWater = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000), this.farWaterMat);
    this.farWater.rotation.x = -Math.PI / 2;
    this.farWater.frustumCulled = false;
  }

  updateWater(cx, cz, t) {
    const cell = WATER_SIZE / WATER_SEG;
    // Snap the sheet to its own grid; the waves are world-anchored either way,
    // but snapping keeps the silhouette of the triangles steady.
    this.water.position.set(Math.round(cx / cell) * cell, 0, Math.round(cz / cell) * cell);
    this.farWater.position.set(cx, -1.2, cz);
    for (const m of [this.waterMat, this.farWaterMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uCamPos.value.copy(this.camera.position);
    }
  }

  // Shore foam has to follow the level's own meander.
  setRiverShape(level) {
    const u = this.waterMat.uniforms;
    u.uMeanderAmp.value = level.meanderAmp || 0;
    u.uMeanderLen.value = level.meanderLen || 900;
    u.uHalfWidth.value = level.riverWidth / 2;
    u.uFlow.value = FLOW + (level.speed || 110) * 0.22;
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

  updateViruses(session, t) {
    if (!this.virusMeshes.length) return;
    const m = this._m4 || (this._m4 = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const e = this._e || (this._e = new THREE.Euler());
    const p = this._v3 || (this._v3 = new THREE.Vector3());
    const one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
    const zero = this._zero || (this._zero = new THREE.Vector3(0, 0, 0));
    session.viruses.forEach((v, i) => {
      if (v.dead) {
        m.compose(p.set(0, -9999, 0), q.identity(), zero);
      } else {
        e.set(v.spin * 0.6, v.spin, v.spin * 0.3);
        m.compose(p.set(v.x - HALF, 11 + Math.sin(t * 2.4 + v.phase) * 2.2, -v.y), q.setFromEuler(e), one);
      }
      for (const mesh of this.virusMeshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of this.virusMeshes) mesh.instanceMatrix.needsUpdate = true;
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

    this.virusMeshes = session.viruses.length ? buildViruses(session.viruses.length) : [];
    for (const m of this.virusMeshes) g.add(m);

    this.scene.add(g);
    this.levelGroup = g;
    this.session = session;
    this.setRiverShape(level);
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

    // Boat rides the surface. Sample at the actual ends of the hull, not just
    // under its middle: with a hull this long against these wavelengths, a
    // single centre sample lets the bow and stern dip under and ship water.
    const hBow = waveAt(bx, bz - HULL_HALF, t);
    const hStern = waveAt(bx, bz + HULL_HALF, t);
    const h = Math.max(waveAt(bx, bz, t), (hBow + hStern) / 2);
    const slope = (hBow - hStern) / (HULL_HALF * 2);
    this.boat.position.set(bx, h + 2, bz);
    this.boat.rotation.set(Math.atan(slope) * 0.8, -b.lean * 0.3, -b.lean * 0.45);
    this.boat.visible = !(b.invuln > 0 && Math.floor(t * 14) % 2 === 0);
    this.boat.userData.rig(t, session.status === 'won', b.lean);

    for (const { o, mesh } of this.logMeshes) mesh.position.x = o.x - HALF;
    for (const { o, mesh } of this.swirlMeshes) {
      mesh.rotation.y = -o.spin;
      mesh.children[0].rotation.y = o.spin * 1.7;
    }
    this.updateViruses(session, t);
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

  // How far down the screen the active menu's controls reach, in NDC.
  menuClearNdc() {
    const screen = document.querySelector('.screen.active');
    if (!screen) return 0.1;
    let bottom = 0;
    for (const el of screen.children) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    if (!bottom) return 0.1;
    return 1 - 2 * (bottom / window.innerHeight);
  }

  // Frames the whole boat inside the strip left free below the menu buttons,
  // solved against the real projection so it holds at any window shape.
  frameMenuBoat(t) {
    const clear = this.menuClearNdc();
    const band = Math.max(0.24, clear + 1);
    const tanHalf = Math.tan((this.camera.fov / 2) * Math.PI / 180);
    // Fill most of the strip, then back off far enough to actually fit.
    const wantHeight = Math.min(band * 0.72, 0.40);
    const dist = Math.max(240, Math.min(900, MENU_BOAT_H / (wantHeight * tanHalf)));

    const a = t * 0.12;
    const b = this.boat.position;
    // Sit high relative to the distance. The boat has to end up low in frame,
    // so the camera has to look down to get there -- at a shallower angle it
    // ends up aiming at the horizon and the menu fills with empty sky.
    this.camera.position.set(
      b.x * 0.5 + Math.sin(a) * dist * 0.16,
      dist * 0.95,
      b.z + dist + Math.cos(a) * dist * 0.1,
    );

    const targetY = (clear - 1) / 2;                 // middle of the free strip
    const targetX = Math.sin(t * 0.3) * 0.18;
    for (let i = 0; i < 3; i++) {
      this.camera.lookAt(this.menuLook);
      this.camera.updateMatrixWorld(true);
      this.menuTip.set(b.x, b.y + MENU_BOAT_MID, b.z).project(this.camera);
      const gain = tanHalf * this.camera.position.distanceTo(this.menuLook);
      this.menuLook.y += (this.menuTip.y - targetY) * gain;
      this.menuLook.x += (this.menuTip.x - targetX) * gain * this.camera.aspect;
    }
    this.camera.lookAt(this.menuLook);
  }

  renderBackdrop(t) {
    this.lastT = t;
    this.setRiverShape(MENU_RIVER);
    if (this.levelGroup) this.levelGroup.visible = false;
    this.menuGroup.visible = true;
    this.progress.classList.add('hidden');
    this.fx.style.opacity = 0;

    const bx = Math.sin(t * 0.35) * 34, bz = 0;
    const h = waveAt(bx, bz, t);
    this.boat.position.set(bx, h + 2, bz);
    this.boat.rotation.set(0, Math.sin(t * 0.35) * 0.25, Math.cos(t * 0.35) * 0.12);
    this.boat.visible = true;
    this.boat.userData.rig(t, false, Math.sin(t * 0.35) * 0.3);

    this.frameMenuBoat(t);

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

  const planks = Welder();
  const plankGeo = new THREE.BoxGeometry(11, 2, 32);
  for (let x = -(w + 44) / 2 + 6; x < (w + 44) / 2; x += 15) planks.add(plankGeo, [cx + x, 15.4, z - 19]);
  g.add(planks.mesh(M.logLight));
  for (const px of [b.left - HALF + 6, cx, b.right - HALF - 6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 22, 6), M.logDark);
    post.position.set(px, 2, z - 3);
    g.add(post);
  }
  // finish line
  const pale = Welder(), ink = Welder();
  const segGeo = new THREE.BoxGeometry(13, 1.2, 7);
  for (let x = b.left - HALF, i = 0; x < b.right - HALF; x += 13, i++) {
    (i % 2 ? pale : ink).add(segGeo, [x + 6.5, 1.2, z + 2]);
  }
  if (!pale.empty()) g.add(pale.mesh(M.white));
  if (!ink.empty()) g.add(ink.mesh(M.dark));
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

// All of a level's viruses in three instanced draw calls. Each one is a
// welded core, a welded set of spikes and knobs, and the pale surface dots.
function buildViruses(count) {
  const coreGeo = new THREE.IcosahedronGeometry(11, 0);
  const spikeGeo = new THREE.ConeGeometry(2.4, 8, 4);
  const knobGeo = new THREE.SphereGeometry(2.6, 5, 4);

  // Spikes point along the hull's own vertex directions so they sit flush.
  const dirs = [];
  const pos = coreGeo.attributes.position;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pos.count; i += 3) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    if (!dirs.some((d) => d.dot(v) > 0.9)) dirs.push(v);
  }
  const spikes = Welder();
  for (const d of dirs) {
    const q = new THREE.Quaternion().setFromUnitVectors(up, d);
    spikes.add(spikeGeo, d.clone().multiplyScalar(13).toArray(), null, null, q);
    spikes.add(knobGeo, d.clone().multiplyScalar(18).toArray());
  }
  const dots = Welder();
  for (const [a, b, c] of [[-4, -3, 8], [5, 4, 8], [0, 6, 8.5]]) {
    dots.add(new THREE.SphereGeometry(2.4, 5, 4), [a, b, c]);
  }

  const meshes = [
    new THREE.InstancedMesh(coreGeo, M.virus, count),
    new THREE.InstancedMesh(weld([{ geo: spikes.geo(), m: new THREE.Matrix4() }]), M.virusDark, count),
    new THREE.InstancedMesh(dots.geo(), M.virusCore, count),
  ];
  for (const m of meshes) { m.frustumCulled = false; m.count = count; }
  return meshes;
}

// The inboard end of an oar -- the handle -- in that oar's own space.
function oarTip(oar) {
  let obj = null, best = null;
  oar.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      o.localToWorld(p);
      if (!best || Math.abs(p.x) < Math.abs(best.x)) { best = p.clone(); obj = o; }
    }
  });
  return obj ? { obj, local: obj.worldToLocal(best.clone()) } : null;
}

// Welds many small parts into one geometry. The llama is built from ~150 wool
// puffs; without this it would cost ~150 draw calls a frame on a phone.
function weld(parts) {
  let total = 0;
  const prepped = parts.map(({ geo, m }) => {
    const c = geo.clone().applyMatrix4(m);
    const g = c.index ? c.toNonIndexed() : c;
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
    add(geo, pos, scale, rot, quat) {
      tmp.position.set(...(pos || [0, 0, 0]));
      tmp.scale.set(...(scale || [1, 1, 1]));
      if (quat) tmp.quaternion.copy(quat);
      else tmp.rotation.set(...(rot || [0, 0, 0]));
      tmp.updateMatrix();
      parts.push({ geo, m: tmp.matrix.clone() });
      return this;
    },
    geo() { return weld(parts); },
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

// Llama in a rowing boat. userData.rig(t, celebrating, lean) works the oars.
function makeLlamaBoat() {
  const g = new THREE.Group();
  // Everything drawn in code lives here, so the sculpted boat can replace it
  // wholesale once it downloads.
  const builtIn = new THREE.Group();
  g.add(builtIn);
  g.userData.builtIn = builtIn;

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
  builtIn.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 36), M.deck);
  deck.position.y = 6.6;
  builtIn.add(deck);

  // Oars on the stand-in, to match the sculpted rowboat it hands over to.
  const oars = [];
  for (const side of [-1, 1]) {
    const oar = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 5), M.logDark);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = side * 15;
    oar.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 6), M.log);
    blade.position.set(side * 30, 0, 0);
    oar.add(blade);
    oar.position.set(0, 8, 2);
    builtIn.add(oar);
    oars.push({ oar, side });
  }

  // Whoever is rowing sits in this group, so the sculpted model can replace
  // the built-in llama once it has downloaded without disturbing the boat.
  const crew = new THREE.Group();
  crew.position.set(0, 0, 7);
  g.add(crew);
  const { group: llama, animate: liven } = makeLlama();
  llama.scale.setScalar(9.5);
  llama.rotation.y = Math.PI / 2;
  llama.position.y = -3.4;
  crew.add(llama);
  g.userData.crew = crew;
  g.userData.liven = liven;

  g.userData.rig = (t, celebrating, lean = 0) => {
    const sw = Math.sin(t * (celebrating ? 9 : 4.4));
    for (const { oar, side } of oars) {
      oar.rotation.x = sw * 0.5;
      oar.rotation.z = side * sw * 0.12;
    }
    crew.position.y = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
    g.userData.liven(t, celebrating);
  };
  return g;
}

// Straight stretch of river shown behind the menus.
const MENU_RIVER = { riverWidth: 260, meanderAmp: 22, meanderLen: 760, speed: 110 };

function buildMenuRiver() {
  const level = MENU_RIVER;
  const g = new THREE.Group();
  g.add(buildBanks(level, -700, 1500));
  g.add(buildProps(level, -680, 1480));
  return g;
}
