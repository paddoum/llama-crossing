// 3D renderer: identical simulation, Three.js scene.
// World -> scene: X = x - 180 (across the river), Y = up, Z = -y (downriver is +Z).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { LOGICAL_W, riverBounds, riverCenter } from './levels.js';
import { WHALE_HP } from './entities.js';

const HALF = LOGICAL_W / 2;
const SKY = 0x1884c6;   // azure: the brand's lightest blue, so the horizon still reads

// Argonaut United palette, read from the app's own tokens (src/style.css):
// navy #021a3b, surface #0e2549, page #153756, tab-bar #153d68,
// azure #1884c6, deep-cyan #058cac, cyan #22bae7, gold #c8980a, magenta #ac2caf.
const COL = {
  navy: 0x021a3b, surface: 0x0e2549, page: 0x153756, tabBar: 0x153d68,
  azure: 0x1884c6, deepCyan: 0x058cac, cyan: 0x22bae7,
  gold: 0xc8980a, magenta: 0xac2caf, white: 0xffffff,

  seaDeep: 0x021a3b, seaShallow: 0x07557a, foam: 0xbfe9f7,
  land: 0x12365c, landHigh: 0x1b4a76,
  // Marron. The reefs used to be two blues a shade off the sea, which read as
  // texture rather than as something to steer around -- a warm hue is the one
  // break the whole scene does not otherwise contain.
  reef: 0x8c5a30, reefLight: 0xbf8749,
  shark: 0x1884c6, sharkBelly: 0xdbeef8,
  whale: 0x3d7ba6, whaleBelly: 0xdceef7,
  hull: 0xa35f2a, hullDark: 0x6e3d15, deck: 0xc98a4b, mast: 0x8a6136,
  wool: 0xf2e6cf, skin: 0xe9d9bc, pink: 0xe8a9a3, ink: 0x2a2420,
  blanketA: 0xc0392b, blanketB: 0x1f6f8b, scarf: 0xe2453b,
  spit: 0xeaffd0, swirl: 0x021a3b, dark: 0x061527,
};

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// Shared materials: never disposed, so level teardown only frees geometry.
const M = {
  land: mat(COL.land, { side: THREE.DoubleSide }),
  landHigh: mat(COL.landHigh, { side: THREE.DoubleSide }),
  // A little emissive so a reef on the shadow side of a wave still reads.
  reef: mat(COL.reef, { emissive: 0x3a2008 }),
  reefLight: mat(COL.reefLight),
  whale: mat(COL.whale),
  whaleBelly: mat(COL.whaleBelly),
  shark: mat(COL.shark, { emissive: 0x0d3a5c }),
  sharkBelly: mat(COL.sharkBelly),
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
  spit: mat(COL.spit),
  swirl: mat(COL.swirl, { side: THREE.DoubleSide }),
  dark: mat(COL.dark),
  buoyPort: mat(COL.magenta),
  buoyStbd: mat(COL.gold),
  buoyMast: mat(COL.white),
  deckPlate: mat(COL.surface),
  deckEdge: mat(COL.tabBar),
};

// Deterministic jitter, same trick the 2D renderer uses.
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// --- water ---------------------------------------------------------------
// The surface is a GPU-displaced sheet that follows the camera, plus a flat
// plane for the far field. Waves are anchored to world space, so nothing
// swims when the sheet moves, and the sheet's amplitude tapers at its rim so
// it meets the far plane invisibly.
const WATER_SIZE = 1800, WATER_SEG = 110, WATER_HALF = WATER_SIZE / 2;

// Wave shape taken from the Argonaut United app's own home-screen ocean
// (src/components/shader/shaders/bluestorm.frag), which adapts afl_ext's
// "Ocean" from Shadertoy (MIT, https://www.shadertoy.com/view/MdXyzX).
//
// The app raymarches a fullscreen ocean with a fixed camera and no geometry;
// that cannot host a boat, sharks and buoys at correct depths, so what is
// reused here is the wave FUNCTION, not the raymarcher: exp(sin(x) - 1)
// summed over octaves, each octave dragging the sample point along its own
// direction. That is what gives sharp crests over broad flat troughs -- and
// flat troughs are exactly what a faceted surface needs, because gentle sine
// swell leaves neighbouring facets shaded almost alike.
const WAVE = {
  scale: 0.040,        // game units -> the app's wave space (base length ~157u)
  amp: 5.4,            // vertical span, matched to what the boat used to ride
  freq: 1.0,
  drag: 0.38,          // DRAG_MULT
  lacunarity: 1.18,
  persistence: 0.8,
  timeFalloff: 1.07,
  speed: 0.6,
  octavesGPU: 8,
  octavesCPU: 6,       // the boat only needs the broad swell
};

const FLOW = 34;

// KEEP IN SYNC with getwaves() in the vertex shader. This copy floats the
// boat, the spit and the foam particles; it runs fewer octaves, which costs a
// little accuracy in the ripples and none in the swell that matters.
function rawWaves(px, pz, t, octaves) {
  const phase = Math.sqrt(px * px + pz * pz) * 0.1;
  let iter = 0, freq = WAVE.freq, tMul = WAVE.speed, weight = 1, sumV = 0, sumW = 0;
  for (let i = 0; i < octaves; i++) {
    const dx = Math.sin(iter), dz = Math.cos(iter);
    const x = (dx * px + dz * pz) * freq + t * tMul + phase;
    const wave = Math.exp(Math.sin(x) - 1);
    const deriv = -wave * Math.cos(x);
    px += dx * deriv * weight * WAVE.drag;
    pz += dz * deriv * weight * WAVE.drag;
    sumV += wave * weight;
    sumW += weight;
    weight *= WAVE.persistence;
    freq *= WAVE.lacunarity;
    tMul *= WAVE.timeFalloff;
    iter += 1232.399963;
  }
  return sumV / sumW;
}

function waveAt(x, z, t) {
  const zf = z + t * FLOW;
  return (rawWaves(x * WAVE.scale, zf * WAVE.scale, t, WAVE.octavesCPU) - 0.5) * WAVE.amp;
}

const WATER_VERT = `
#include <fog_pars_vertex>
uniform float uTime, uFlow, uAmp, uTaperHalf;
varying vec3 vWorld;
varying float vCrest;

// afl_ext's octave: a sharp-crested wave, with the sample point dragged along
// the wave direction so the crests pile up instead of staying sinusoidal.
vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  return vec2(wave, -wave * cos(x));
}

float getwaves(vec2 position) {
  float phase = length(position) * 0.1;
  float iter = 0.0, frequency = ${WAVE.freq.toFixed(2)}, tMul = ${WAVE.speed.toFixed(2)};
  float weight = 1.0, sumV = 0.0, sumW = 0.0;
  for (int i = 0; i < ${WAVE.octavesGPU}; i++) {
    vec2 d = vec2(sin(iter), cos(iter));
    vec2 res = wavedx(position, d, frequency, uTime * tMul + phase);
    position += d * res.y * weight * ${WAVE.drag.toFixed(2)};
    sumV += res.x * weight;
    sumW += weight;
    weight *= ${WAVE.persistence.toFixed(2)};
    frequency *= ${WAVE.lacunarity.toFixed(2)};
    tMul *= ${WAVE.timeFalloff.toFixed(2)};
    iter += 1232.399963;
  }
  return sumV / sumW;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Flatten towards the rim of the sheet so it blends into the far plane.
  float edge = max(abs(position.x), abs(position.y)) / uTaperHalf;
  float amp = uAmp * (1.0 - smoothstep(0.84, 1.0, edge));
  vec2 p = vec2(world.x, world.z + uFlow * uTime) * ${WAVE.scale.toFixed(3)};
  float h = (getwaves(p) - 0.5) * ${WAVE.amp.toFixed(2)};
  world.y += amp * h;
  vWorld = world.xyz;
  vCrest = amp * h;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = `
#include <fog_pars_fragment>
uniform vec3 uSunDir, uSunCol, uSkyCol, uSkyTop, uSkyLow, uGroundCol, uShallow, uDeep, uFoam, uCamPos;
uniform float uTime, uMeanderAmp, uMeanderLen, uHalfWidth, uShore, uFacet, uSkyFloor, uCell;
varying vec3 vWorld;
varying float vCrest;

// One value per grid cell of the water sheet. Hashing the facet NORMAL looks
// equivalent and is not: these waves have broad flat troughs, so every facet
// down there shares a normal, draws the same number, and the whole trough
// comes out one colour. The waves displace vertically only, so world XZ still
// lines up with the mesh grid and quantising it gives a stable per-cell value.
float cellNoise(vec2 worldXZ) {
  vec2 id = floor(worldXZ / uCell);
  return fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
}

// What a reflected ray sees. The app looks its reflection up in the real
// screen-space sky; there is no such buffer here, so this is the same idea
// built procedurally: a gradient, a sun with a halo, and a glowing band along
// the horizon. Without this the water only ever mixes toward one flat colour,
// which is why it had no reflections to speak of.
vec3 skySample(vec3 dir) {
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uSkyLow, uSkyTop, pow(up, 0.55));
  float s = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * pow(s, 600.0) * 3.0;            // tight core: the glint
  col += uSunCol * pow(s, 60.0) * 0.18;            // halo around it
  col += uSunCol * exp(-abs(dir.y) * 16.0) * 0.10; // band along the horizon
  return col;
}

void main() {
  // Flat shading, the low-poly way: the normal comes from the derivatives of
  // the world position, so it is constant across each triangle. With the
  // app's sharp-crested waves the facets genuinely tilt against each other,
  // which is what makes the sea read as faceted rather than smooth.
  vec3 flatN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (flatN.y < 0.0) flatN = -flatN;
  vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), flatN, uFacet));
  vec3 V = normalize(uCamPos - vWorld);

  vec3 ambient = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);
  float diff = max(dot(N, uSunDir), 0.0);
  // Wider than the wave's own range, so deep troughs keep a gradient instead
  // of clamping flat onto uDeep.
  vec3 base = mix(uDeep, uShallow, smoothstep(-3.0, 3.0, vCrest));
  float cellV = cellNoise(vWorld.xz) - 0.5;
  base *= 1.0 + cellV * 0.28;
  base += vec3(0.010, 0.018, 0.028) * cellV * 2.0;

  vec3 col = base * (ambient * 0.78 + uSunCol * diff * 0.45);
  // Broad highlight. Tighter than this and a faceted surface almost never
  // satisfies it, so the sparkle vanished.
  vec3 Hv = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, Hv), 0.0), 140.0) * 0.55;

  // Reflect the sky properly: each facet looks in its own direction, so the
  // sun and the horizon band break up across the water instead of the whole
  // surface drifting toward one colour. The app lifts this to a floor because
  // fresnel alone leaves head-on water flat; same here.
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float skyAmount = uSkyFloor + (1.0 - uSkyFloor) * fres;
  col = mix(col, skySample(R), skyAmount * 0.45);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeWaterMaterial({ amp, shore, facet = 1 }) {
  return new THREE.ShaderMaterial({
    fog: true,
    // dFdx/dFdy for the flat normal.
    extensions: { derivatives: true },
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uFlow: { value: FLOW },
        uAmp: { value: amp },
        uTaperHalf: { value: WATER_HALF },
        uShore: { value: shore },
        uFacet: { value: facet },
        uSkyFloor: { value: 0.12 },
        uCell: { value: WATER_SIZE / WATER_SEG },
        uCamPos: { value: new THREE.Vector3() },
        // Deliberately NOT the scene's sun. That one sits behind the camera,
        // which lights the boat and the llama nicely but reflects its glint
        // away from the viewer. The water gets its own direction, ahead and
        // up, so the glitter path falls between the boat and the horizon
        // where it can actually be seen. Stylised, not physical.
        uSunDir: { value: new THREE.Vector3(-150, 280, -300).normalize() },
        uSunCol: { value: new THREE.Color(0xffffff) },
        uSkyCol: { value: new THREE.Color(SKY) },
        uSkyTop: { value: new THREE.Color(0x05203c) },
        uSkyLow: { value: new THREE.Color(0x15557f) },
        uGroundCol: { value: new THREE.Color(0x02122a) },
        uShallow: { value: new THREE.Color(COL.seaShallow) },
        uDeep: { value: new THREE.Color(COL.seaDeep) },
        uFoam: { value: new THREE.Color(COL.foam) },
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
// Where the camera settles for the arrival: in close, looking level at the
// llama rather than down at the water from the chase height.
const CHEER_CAM_BACK = 118;

// Menu backdrop. The boat has to fit the strip of screen the menu buttons
// leave free, which varies with the screen and the window, so the camera
// distance is derived from that strip rather than fixed.
const MENU_BOAT_H = 74, MENU_BOAT_MID = 29;

// Sculpted llama. It is modelled standing and facing +Z, so it gets a half
// turn to face the bow; the legs drop through the hull and finish below the
// waterline, where the opaque water hides them.

// The crew: one rigged llama carrying both of its Mixamo clips, built by
// tools/mixamo_to_glb.py. It paddles across and dances on the dock, so the
// arrival only has to change which clip is playing. Its origin is between its
// hooves and it stands 1.7 units tall, both guaranteed by the converter.
const CREW = {
  url: 'assets/llama-rig.glb',
  paddle: /paddle/i,
  dance: /dance/i,
  height: 46,        // scaled to this, in world units, to match the boat
  seatY: 3.0,        // where the hooves want to be, above the crew group
  // glTF export turns Blender +Y into -Z, so the model arrives already facing
  // the bow: no turn, unlike the sculpted llama this replaced. Unwinding half
  // a turn at the dock then points it at the camera, which is what the arrival
  // already does.
  yaw: 0,
  blend: 0.35,       // crossfade between the two clips
};
// Seated: dropped so the gunwale crosses above the legs, which puts the body
// in the boat rather than standing over it. The legs run on through the hull
// and finish under the waterline, where the opaque water hides them.

// The llama is one static mesh with no skeleton, so the forelegs are bent in
// the vertex shader: vertices below the shoulder and forward of it rotate
// about the shoulder, weighted so it bends rather than shearing off. They
// also shorten, because the leg is twice as long as the reach to the oar.
// lowY/lowFade cut the weight off below the forelegs. Without it the test
// "below the shoulder and forward of it" also catches the front of the hind
// hooves -- measured, 1939 of the 4291 moved vertices were down there -- and
// they swung with the oar. Invisible at rowing angles, obvious once the
// dance drives uArm a full radian. The model leaves a clean dead band at
// y -0.76..-0.57 between the hooves and the forelegs; the cut sits in it.

// Sculpted rowboat. Modelled Y-up with the bow at +X, so it gets a quarter
// turn to point down-river. The oars are separate nodes, so they can row.
// Sea life from Sketchfab (CC BY -- see the credits in the README and on the
// title screen). Orientation was read off the rigs: the shark's jaw bones sit
// at +Z, the whale's tail fins at +Z, so their headings differ by 180 degrees.
const SEA_LIFE = {
  shark: { url: 'assets/shark.glb', scale: 3.4, yaw: Math.PI / 2, clip: /swim$/i },
  whale: { url: 'assets/whale.glb', perUnit: 2.33, yaw: -Math.PI / 2, clip: /swimming/i },
  buoy: { url: 'assets/buoy.glb', scale: 2.0 },
};

const ANIMATE_WITHIN = 900;

// Scratch for holdOar, which runs every frame.
const _oarA = new THREE.Vector3(), _oarB = new THREE.Vector3();
const _oarMid = new THREE.Vector3(), _oarDir = new THREE.Vector3();
const _oarMat = new THREE.Matrix4(), _oarQ = new THREE.Quaternion();   // only pose creatures this close to the boat

// --- the arrival --------------------------------------------------------
// At the finish line the llama climbs out onto the dock, turns to face the
// camera and a cannon of cotillons goes off over its head. Seconds from the
// moment the bow crosses the line.
const CHEER = {
  settle: 0.45,   // oars stowed, the boat coasts the last of it
  hop: 0.95,      // the arc out of the boat and onto the planks
  second: 0.80,   // a second, smaller pop after the first
  total: 3.5,     // when state.js is allowed to put the results screen up
};
// Top of the dock planks (buildDock). How far the llama's hooves sit below
// its own origin is measured at the time, because the sculpted model and the
// code-built stand-in it falls back to are different shapes.
const DECK_TOP = 16.4;

// Where the pier sits, as distances past the finish line. The line is crossed
// by the boat's *middle*, so when it stops its bow is already BOW_REACH past
// it -- lay the deck any closer than that and the boat moors inside the pier,
// which is what it used to do, 28 units deep, mooring posts through the hull.
const BOW_REACH = 30;           // bow, measured ahead of the boat's origin
const DOCK_BERTH = 8;           // clear water left between the bow and the deck
const DOCK_FACE = BOW_REACH + DOCK_BERTH;      // the deck's near face
const DOCK_DEPTH = 34;
const DOCK_MID = DOCK_FACE + DOCK_DEPTH / 2;
const DOCK_LAND = DOCK_FACE + 10;              // where the llama puts its hooves


// Cotillons. Flat scraps on ballistic arcs that tumble as they fall --
// a third of them long and thin, which reads as streamers.
const CONFETTI_MAX = 300;
const CONFETTI_COLS = [COL.cyan, COL.gold, COL.magenta, COL.azure, COL.white, COL.deepCyan];

const BOAT_URL = 'assets/rowboat.glb';
// The hull is shallow next to the wave amplitude, and the boat takes its
// height from a single wave sample at its centre, so the ends can dip. It
// rides high enough that the floor stays dry; the camera looks down, so the
// gap under the hull is hidden by the hull itself.
const BOAT_SCALE = 5.7, BOAT_Y = -0.6, HULL_HALF = 29;
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

    this.scene.add(new THREE.HemisphereLight(0xcdeaff, 0x0a2744, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-180, 320, 160);
    this.scene.add(sun);

    this.makeWater();
    this.scene.add(this.farWater, this.water);

    this.boat = makeLlamaBoat();
    this.scene.add(this.boat);

    this.particles = this.makeParticles();
    this.scene.add(this.particles);

    // The arrival: the llama is reparented here when it leaves the boat, so
    // this group's transform stays identity and its position is world space.
    this.cheerGroup = new THREE.Group();
    this.scene.add(this.cheerGroup);
    this.cheer = null;
    this.cheerHome = null;
    this.confetti = this.makeConfetti();
    this.scene.add(this.confetti);
    // How long state.js should hold off the results screen (see App.update).
    this.winDelay = CHEER.total;

    this.menuGroup = buildMenuSea(this);
    this.scene.add(this.menuGroup);

    this.levelGroup = null;
    this.session = null;
    this.whaleMeshes = [];
    this.swirlMeshes = [];
    this.sharkMeshes = [];
    this.spitPool = [];
    this.lastT = 0;
    this.camLook = new THREE.Vector3(0, 0, -LOOK_AHEAD);
    this.menuLook = new THREE.Vector3(0, 12, -120);
    this.menuTip = new THREE.Vector3();

    this.loadCrew();
    this.loadBoat();
    this.loadSeaLife();

    this.waveAt = waveAt;   // exposed for the float/dryness checks

    this.fx = document.getElementById('fx');
    this.progress = document.getElementById('progress');
    this.progressFill = document.getElementById('progress-fill');
    this.progressDot = document.getElementById('progress-dot');
  }

  // Background-loaded: the built-in stand-in rows until this arrives, so a
  // slow connection or a missing file never blocks the game.
  loadCrew() {
    new GLTFLoader().load(CREW.url, (gltf) => {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // Lambert to sit in the same light as everything else, keeping the map.
        o.material = new THREE.MeshLambertMaterial({ map: o.material.map });
        o.frustumCulled = false;      // skinned bounds go stale as it moves
      });
      const pick = (re) => gltf.animations.find((a) => re.test(a.name));
      const paddle = pick(CREW.paddle), dance = pick(CREW.dance);
      if (!paddle || !dance) {
        console.warn('crew model is missing a clip; keeping the built-in llama.',
          gltf.animations.map((a) => a.name));
        return;
      }
      // Measure the GEOMETRY, not the object. Box3.setFromObject on a skinned
      // mesh derives its bounds from the bones, which at load time have not
      // been posed by any clip: it reported this model as 1.5 units tall at
      // y 69, and acting on that put the llama 2109 units under the sea.
      // The bind-pose geometry is what the converter centred, so trust that.
      const box = new THREE.Box3();
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox);
      });
      this.crewModel = {
        gltf, paddle, dance,
        height: box.max.y - box.min.y,
        offset: new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2),
      };
      this.seatCrew();
    }, undefined, (err) => console.warn('crew model failed to load; keeping the built-in llama.', err));
  }

  // Takes one of the boat's two oars out of its oarlock and gives it to the
  // llama. Both loads race, so this is called from each and does nothing until
  // the other has landed.
  giveOar() {
    if (!this.oars || !this.crewModel || this.crewHands) return;
    const crew = this.boat.userData.crew.children[0];
    if (!crew) return;
    let mesh = null;
    crew.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const left = mesh.skeleton.bones.find((b) => /LeftHand$/.test(b.name));
    const right = mesh.skeleton.bones.find((b) => /RightHand$/.test(b.name));
    if (!left || !right) return;

    // One oar, not two: the clip is a two-handed paddle stroke.
    const [keep, ...rest] = this.oars;
    for (const { pivot } of rest) pivot.visible = false;
    const oar = keep.oar;
    this.boatModel.attach(oar);                 // out of the oarlock pivot
    keep.pivot.visible = false;

    // Which way the oar lies in its own space, and how long it is, so the
    // shaft can be aimed down the line between the two hands.
    const box = new THREE.Box3().setFromObject(oar);
    const size = box.getSize(new THREE.Vector3());
    const longest = size.x > size.y && size.x > size.z ? 'x' : (size.y > size.z ? 'y' : 'z');
    const axis = new THREE.Vector3(longest === 'x' ? 1 : 0, longest === 'y' ? 1 : 0, longest === 'z' ? 1 : 0);
    // The oar's own middle, so it pivots about the hands rather than an end.
    const centre = box.getCenter(new THREE.Vector3());
    oar.updateWorldMatrix(true, false);
    this.crewHands = {
      oar, left, right, axis,
      centre: oar.worldToLocal(centre.clone()),
      length: Math.max(size.x, size.y, size.z),
    };
    this.holdOar();
  }

  // Lays the oar along the line between the llama's hands, every frame, so it
  // tracks whatever the clip is doing without any of it being hand-keyed.
  holdOar() {
    const h = this.crewHands;
    if (!h) return;
    const parent = h.oar.parent;
    parent.updateWorldMatrix(true, false);
    const a = h.left.getWorldPosition(_oarA);
    const b = h.right.getWorldPosition(_oarB);
    const mid = _oarMid.copy(a).add(b).multiplyScalar(0.5);
    const dir = _oarDir.copy(b).sub(a);
    if (dir.lengthSq() < 1e-8) return;          // hands together: leave it be
    // Into the oar's parent frame: the midpoint as a point, the shaft
    // direction as a direction, which must not pick up the translation.
    parent.worldToLocal(mid);
    _oarMat.copy(parent.matrixWorld).invert();
    _oarQ.setFromRotationMatrix(_oarMat);
    dir.applyQuaternion(_oarQ).normalize();
    h.oar.quaternion.setFromUnitVectors(h.axis, dir);
    h.oar.position.set(0, 0, 0);
    h.oar.position.copy(mid).sub(_oarA.copy(h.centre).applyQuaternion(h.oar.quaternion));
  }

  // The lowest its feet get over one run of a clip, in the model's own units.
  // Measured by stepping the mixer rather than assumed, because Mixamo clips
  // do not agree with each other about where the floor is.
  groundLift(model, mixer, action, others) {
    let mesh = null;
    model.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (!mesh) return 0;
    const feet = mesh.skeleton.bones.filter((b) => /Foot$|ToeBase$/.test(b.name));
    if (!feet.length) return 0;
    for (const a of others) a.stop();
    action.reset().setEffectiveWeight(1).play();
    const v = new THREE.Vector3();
    let lo = Infinity;
    const dur = action.getClip().duration;
    for (let i = 0; i <= 24; i++) {
      mixer.setTime((i / 24) * dur);
      model.updateWorldMatrix(true, true);
      for (const b of feet) { b.getWorldPosition(v); model.worldToLocal(v); lo = Math.min(lo, v.y); }
    }
    return Number.isFinite(lo) ? lo : 0;
  }

  // Puts the rigged llama in the boat with the paddling clip running. Called
  // again after the arrival, so the next crossing starts with a crewed boat.
  seatCrew() {
    const d = this.crewModel;
    if (!d) return null;
    const inner = cloneSkinned(d.gltf.scene);
    inner.position.sub(d.offset);            // hooves on the group's origin
    const model = new THREE.Group();
    model.add(inner);
    model.scale.setScalar(CREW.height / d.height);
    model.rotation.y = CREW.yaw;
    model.position.y = CREW.seatY;
    const crew = this.boat.userData.crew;
    crew.clear();
    crew.add(model);

    const mixer = new THREE.AnimationMixer(inner);
    const paddle = mixer.clipAction(d.paddle);
    const dance = mixer.clipAction(d.dance);
    model.userData.mixer = mixer;
    model.userData.paddle = paddle;
    model.userData.dance = dance;

    // Neither clip stands the llama on the rig's origin -- the paddling one is
    // a seated pose whose feet hang 25 units up -- so each clip is asked where
    // its own feet are and the model is dropped by that much when it plays.
    model.userData.lift = {
      paddle: this.groundLift(model, mixer, paddle, [dance]),
      dance: this.groundLift(model, mixer, dance, [paddle]),
    };
    // Both actions keep a base weight of 1: setEffectiveWeight(0) zeroes the
    // base, and fadeIn then ramps a fade factor against it and stays at zero,
    // which puts the llama on the dock in its bind T-pose. Use stop/play to
    // pick which one runs and let the crossfade do the rest.
    dance.setEffectiveWeight(1).stop();
    paddle.reset().setEffectiveWeight(1).play();
    mixer.setTime(0);
    model.position.y = CREW.seatY - model.userData.lift.paddle * model.scale.x;
    this.crewMixer = mixer;
    this.crewHands = null;
    this.giveOar();
    // It is rigged now, so the swell only has to rock the whole body.
    // (position.y is owned by the clip offset above, so liven leaves it alone.)
    this.boat.userData.liven = (t, celebrating) => {
      model.rotation.z = Math.sin(t * 0.9) * 0.03 + (celebrating ? Math.sin(t * 9) * 0.05 : 0);
    };
    return model;
  }

  // the sculpted one arrives.
  // Sharks and whales are rigged and animated, so they are cloned per instance
  // with their own mixer rather than instanced -- skinning rules instancing
  // out. The code-built shapes stand in until these land, and the scene is
  // rebuilt once they do.
  loadSeaLife() {
    const loader = new GLTFLoader();
    this.mixers = [];
    for (const [kind, cfg] of Object.entries(SEA_LIFE)) {
      loader.load(cfg.url, (gltf) => {

        if (kind === 'buoy') {
          // One static mesh: keep geometry and material so it can be instanced.
          let mesh = null;
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
          if (mesh) {
            const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
            geo.scale(cfg.scale, cfg.scale, cfg.scale);
            this.buoyModel = { geo, material: mesh.material };
          }
        } else {
          if (kind === 'shark') {
            gltf.scene.traverse((o) => {
              if (!o.isMesh || !/body|jaw/i.test(o.material.name || '')) return;
              o.material = o.material.clone();
              o.material.color = new THREE.Color(COL.shark);
              o.material.emissive = new THREE.Color(0x0d3a5c);
            });
          }
          this[`${kind}Model`] = { gltf, cfg };
        }
        this.rebuildScene();
      }, undefined, (err) => console.warn(`${kind} model failed to load; keeping the built-in one.`, err));
    }
  }

  // Drop the built scenery so the next frame rebuilds it with whatever has
  // arrived. Cheap: it only happens as each model finishes downloading.
  rebuildScene() {
    this.disposeLevel();
    if (this.menuGroup) {
      this.scene.remove(this.menuGroup);
      this.menuGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.menuGroup = buildMenuSea(this);
    this.scene.add(this.menuGroup);
  }

  // One animated clone, wound to its own point in the loop.
  spawnSwimmer(kind, offset) {
    const entry = this[`${kind}Model`];
    if (!entry) return null;
    const obj = cloneSkinned(entry.gltf.scene);
    const clip = entry.gltf.animations.find((a) => entry.cfg.clip.test(a.name)) || entry.gltf.animations[0];
    if (clip) {
      const mixer = new THREE.AnimationMixer(obj);
      mixer.clipAction(clip).play();
      mixer.setTime(offset % clip.duration);
      this.mixers.push({ mixer, obj });
    }
    return obj;
  }

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

      // crewFree: the llama has climbed out, so nothing reaches for an oar
      // and nothing writes to its transform -- the arrival owns it now.
      boat.userData.rig = (t, celebrating, lean = 0, crewFree = false) => {
        const rate = celebrating ? 9 : 4.4;
        const sweep = Math.sin(t * rate), dip = Math.cos(t * rate);
        // Once the rigged llama is aboard it holds the oar itself and the
        // oarlock sweep is off: a hand-animated oar next to an animated
        // paddler just reads as two things rowing out of time.
        if (!this.crewHands) {
          for (const { pivot, side } of oars) {
            // The oarlocks are on opposite sides, so the yaw has to mirror for
            // the blades to sweep together instead of scissoring.
            pivot.rotation.y = sweep * 0.52 * side;
            pivot.rotation.x = dip * 0.30;        // blades lift on the recovery
          }
        } else if (!crewFree) {
          this.holdOar();
        }
        // crewFree means the llama has climbed out: the oar stops tracking its
        // hands and stays where the last stroke left it, lying in the boat.
        model.rotation.z = -lean * 0.12;
        if (crewFree) return;
        boat.userData.crew.position.y = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
        boat.userData.liven(t, celebrating);
      };
      this.boatModel = model;
      this.oars = oars;
      this.giveOar();          // in case the crew got here first
    }, undefined, (err) => {
      console.warn('Boat model failed to load; keeping the built-in one.', err);
    });
  }


  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    // updateStyle: true. The CSS box and the drawing buffer have to describe
    // the same rectangle or the picture is stretched to fit -- which is what
    // happened on iOS, where the canvas stretched across the layout viewport
    // while the buffer was cut to the visible one.
    this.renderer.setSize(w, h, true);
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

    this.farWaterMat = makeWaterMaterial({ amp: 0, shore: 0, facet: 0 });
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

  // --- cotillons ---------------------------------------------------------
  makeConfetti() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, m, CONFETTI_MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFETTI_MAX * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.confettiParts = [];
    this.confettiDummy = new THREE.Object3D();
    this.confettiCol = new THREE.Color();
    return mesh;
  }

  // One pop. Fired up and out of a point, with enough spread to clear the
  // llama's head before gravity takes over.
  spawnConfetti(at, count, power = 1) {
    const parts = this.confettiParts;
    for (let i = 0; i < count && parts.length < CONFETTI_MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const lift = (0.45 + Math.random() * 0.55) * 185 * power;
      const out = (0.2 + Math.random() * 0.8) * 125 * power;
      const streamer = Math.random() < 0.34;
      parts.push({
        // Spread the muzzle wide: fired from one point they read as a blob.
        x: at.x + (Math.random() - 0.5) * 26,
        y: at.y + 30 + Math.random() * 16,
        z: at.z + (Math.random() - 0.5) * 26,
        vx: Math.cos(a) * out,
        vy: lift,
        vz: Math.sin(a) * out,
        rx: Math.random() * Math.PI, ry: Math.random() * Math.PI, rz: Math.random() * Math.PI,
        sx: (Math.random() - 0.5) * 13, sy: (Math.random() - 0.5) * 13, sz: (Math.random() - 0.5) * 13,
        // Scraps of paper, not playing cards: the camera sits ~120 units out
        // for the arrival, so anything over ~2.5 units fills the sky.
        w: streamer ? 0.7 : 1.3 + Math.random() * 1.1,
        h: streamer ? 5 + Math.random() * 3.5 : 1.3 + Math.random() * 1.1,
        life: 2.6 + Math.random() * 1.8,
        col: CONFETTI_COLS[(Math.random() * CONFETTI_COLS.length) | 0],
      });
    }
  }

  updateConfetti(dt) {
    const parts = this.confettiParts;
    if (!parts.length) {
      if (this.confetti.visible) { this.confetti.visible = false; this.confetti.count = 0; }
      return;
    }
    const d = this.confettiDummy, c = this.confettiCol;
    const drag = Math.pow(0.52, dt);     // scraps shed sideways speed fast
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy -= 120 * dt;                  // gravity, lightened: paper floats
      p.vx *= drag; p.vz *= drag;
      p.vy *= Math.pow(0.80, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
      if (n >= CONFETTI_MAX) continue;
      const fade = Math.min(1, p.life / 0.5);   // shrink out rather than pop
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx, p.ry, p.rz);
      d.scale.set(p.w * fade, p.h * fade, 1);
      d.updateMatrix();
      this.confetti.setMatrixAt(n, d.matrix);
      this.confetti.setColorAt(n, c.setHex(p.col));
      n++;
    }
    this.confetti.count = n;
    this.confetti.visible = n > 0;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  // --- the arrival ---------------------------------------------------------
  // Lifts the llama out of the crew seat into world space. The boat keeps
  // bobbing on the swell underneath; the llama no longer rides it.
  startCheer(session, t) {
    const level = session.level;
    const b = riverBounds(level, level.length);
    const spot = new THREE.Vector3(b.center - HALF, DECK_TOP, -level.length - DOCK_LAND);
    const crew = this.boat.userData.crew;
    const llama = crew.children[0] || null;
    const from = new THREE.Vector3();
    let home = 0, height = 46;

    if (llama) {
      this.boat.updateWorldMatrix(true, true);
      llama.getWorldPosition(from);
      this.cheerHome = { parent: crew, position: llama.position.clone(), rotation: llama.rotation.clone() };
      this.cheerGroup.add(llama);        // three drops it from the crew group

      // Both llamas ride the boat turned to face the bow, so a half turn off
      // whatever that resting yaw is points either of them at the camera.
      home = this.cheerHome.rotation.y;
      // Measure the facing pose at the origin: how far the hooves hang below
      // the model's own origin is what puts them on the planks, and the
      // height is what the camera has to frame.
      llama.position.set(0, 0, 0);
      llama.rotation.set(0, home - Math.PI, 0);
      llama.updateWorldMatrix(true, true);
      // Same trap as in loadCrew: a skinned model's Box3 follows its bones,
      // so the dock spot comes from what the model is known to be instead.
      height = CREW.height;
      spot.y = DECK_TOP;
      llama.position.copy(from);
      llama.rotation.copy(this.cheerHome.rotation);
    }
    this.cheer = {
      t0: t, llama, from, spot, home, height, popped: 0,
      sfx: session.sfx,            // endCheer has no session to ask for it
      scale: llama ? llama.scale.x : 1,
      feet: spot.y - DECK_TOP,     // origin to hooves: the squash pivots here
    };

    // The rigged llama is the same llama that rowed, so the arrival only has
    // to cross-fade it from paddling to dancing. Its origin is between its
    // hooves, so it plants on the deck with no squash pivot to correct for.
    const u = llama && llama.userData;
    if (u && u.mixer) {
      u.paddle.fadeOut(CREW.blend);
      u.dance.reset().setEffectiveWeight(1).fadeIn(CREW.blend).play();
      this.cheer.mixer = u.mixer;
      this.cheer.feet = 0;
      // Same correction as the seat, with the dance clip's own floor.
      this.cheer.spot.y = DECK_TOP - (u.lift ? u.lift.dance : 0) * llama.scale.x;
    }
  }

  updateCheer(session, t, dt) {
    const c = this.cheer;
    const e = t - c.t0;
    if (c.mixer) c.mixer.update(dt);     // the clip is the dance now
    const landed = CHEER.settle + CHEER.hop;
    const llama = c.llama;

    if (llama) {
      const hop = Math.min(1, Math.max(0, (e - CHEER.settle) / CHEER.hop));
      const k = hop * hop * (3 - 2 * hop);
      llama.position.lerpVectors(c.from, c.spot, k);
      llama.position.y += Math.sin(Math.PI * hop) * 34;   // the arc of the jump
      // The model is built facing +Z and rides the boat turned a half turn to
      // face the bow, so unwinding that turn is exactly facing the camera.
      llama.rotation.set(0, c.home - Math.PI * k, 0);
      // Landed: pin it to the spot and let the clip do the rest.
      if (hop >= 1) llama.position.copy(c.spot);
    }

    if (c.popped < 1 && e >= landed) {
      this.spawnConfetti(c.spot, 170, 1);
      c.popped = 1;
      if (session.sfx && session.sfx.pop) session.sfx.pop();
      // The first touchdown is the downbeat: start the groove on it.
      if (session.sfx && session.sfx.startDance) session.sfx.startDance();
    } else if (c.popped < 2 && e >= landed + CHEER.second) {
      this.spawnConfetti(c.spot, 110, 0.82);
      c.popped = 2;
      if (session.sfx && session.sfx.pop) session.sfx.pop();
    }
  }


  // Puts the llama back in its seat. Called whenever a level goes away, so a
  // replay starts with a crewed boat rather than an empty one.
  endCheer() {
    const c = this.cheer;
    if (c && c.sfx && c.sfx.stopDance) c.sfx.stopDance();
    if (c && c.llama && this.cheerHome) {
      this.cheerHome.parent.add(c.llama);
      c.llama.position.copy(this.cheerHome.position);
      c.llama.rotation.copy(this.cheerHome.rotation);
      c.llama.scale.setScalar(c.scale);
      const u = c.llama.userData;
      if (u && u.mixer) {
        u.dance.fadeOut(CREW.blend);
        u.paddle.reset().setEffectiveWeight(1).fadeIn(CREW.blend).play();
        c.llama.position.y = CREW.seatY - (u.lift ? u.lift.paddle : 0) * c.llama.scale.x;
      }
    }
    this.cheer = null;
    this.cheerHome = null;
    if (this.confettiParts) this.confettiParts.length = 0;
    if (this.confetti) { this.confetti.count = 0; this.confetti.visible = false; }
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

  updateSharks(session, t) {
    // Modelled sharks: each is its own object, so they are placed directly.
    if (this.sharkSwimmers && this.sharkSwimmers.length) {
      for (const { v, holder } of this.sharkSwimmers) {
        holder.visible = !v.dead;
        if (v.dead) continue;
        holder.position.set(v.x - HALF, 1.2 + Math.sin(t * 2.1 + v.phase) * 1.1, -v.y);
        holder.rotation.y = SEA_LIFE.shark.yaw + Math.sin(t * 0.9 + v.phase) * 0.45;
        holder.rotation.z = Math.sin(t * 1.3 + v.phase) * 0.1;
      }
      return;
    }
    if (!this.sharkMeshes.length) return;
    const m = this._m4 || (this._m4 = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const e = this._e || (this._e = new THREE.Euler());
    const p = this._v3 || (this._v3 = new THREE.Vector3());
    const one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
    const zero = this._zero || (this._zero = new THREE.Vector3(0, 0, 0));
    session.sharks.forEach((v, i) => {
      if (v.dead) {
        m.compose(p.set(0, -9999, 0), q.identity(), zero);
      } else {
        // Nosing left and right across the channel, with a little roll.
        e.set(Math.sin(t * 1.6 + v.phase) * 0.08, Math.sin(t * 0.9 + v.phase) * 0.5, Math.sin(t * 1.3 + v.phase) * 0.12);
        m.compose(p.set(v.x - HALF, 1.5 + Math.sin(t * 2.1 + v.phase) * 1.2, -v.y), q.setFromEuler(e), one);
      }
      for (const mesh of this.sharkMeshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of this.sharkMeshes) mesh.instanceMatrix.needsUpdate = true;
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

    g.add(buildIslands(level, -340, level.length + 420));
    g.add(buildBuoys(level, -120, level.length - 40, 185, this));
    g.add(buildStart(level));
    g.add(buildDock(level));

    this.whaleMeshes = [];
    this.swirlMeshes = [];
    for (const o of session.obstacles) {
      let mesh;
      if (o.type === 'rock') mesh = makeRock(o);
      else if (o.type === 'whale') {
        const swimmer = this.spawnSwimmer('whale', o.y * 0.013);
        if (swimmer) {
          mesh = new THREE.Group();
          swimmer.scale.setScalar(o.hl * SEA_LIFE.whale.perUnit);
          swimmer.rotation.y = SEA_LIFE.whale.yaw;
          mesh.add(swimmer);
          mesh.position.y = -o.r * 0.8;   // down into the water, back showing
        } else {
          mesh = makeWhale(o);
        }
        this.whaleMeshes.push({ o, mesh, baseY: mesh.position.y });
      }
      else { mesh = makeWhirlpool(o); this.swirlMeshes.push({ o, mesh }); }
      mesh.position.set(o.x - HALF, mesh.position.y, -o.y);
      g.add(mesh);
    }

    this.sharkSwimmers = [];
    this.sharkMeshes = [];
    if (this.sharkModel) {
      session.sharks.forEach((v, i) => {
        const swimmer = this.spawnSwimmer('shark', i * 0.37);
        if (!swimmer) return;
        swimmer.scale.setScalar(SEA_LIFE.shark.scale);
        const holder = new THREE.Group();
        holder.add(swimmer);
        this.sharkSwimmers.push({ v, holder });
        g.add(holder);
      });
    } else if (session.sharks.length) {
      this.sharkMeshes = buildSharks(session.sharks.length);
      for (const m of this.sharkMeshes) g.add(m);
    }

    this.scene.add(g);
    this.levelGroup = g;
    this.session = session;
    this.setRiverShape(level);
  }

  disposeLevel() {
    this.endCheer();
    this.mixers = [];
    this.sharkSwimmers = [];
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
    // The invulnerability flicker is suppressed on arrival -- blinking through
    // the celebration looks like a bug.
    this.boat.visible = session.status === 'won' || !(b.invuln > 0 && Math.floor(t * 14) % 2 === 0);

    if (session.status === 'won' && !this.cheer) this.startCheer(session, t);
    if (this.cheer) {
      // Oars held where the stroke left them, crew seat empty.
      this.boat.userData.rig(this.cheer.t0, false, 0, true);
      this.updateCheer(session, t, dt);
    } else {
      this.boat.userData.rig(t, false, b.lean);
      // While it is rowing the crew mixer is ticked here; during the arrival
      // updateCheer ticks the same mixer, so only one of the two ever runs.
      if (this.crewMixer) this.crewMixer.update(dt);
    }

    for (const { o, mesh, baseY } of this.whaleMeshes) {
      mesh.visible = !o.dead;
      if (o.dead) continue;
      mesh.position.x = o.x - HALF;
      mesh.rotation.y = o.vx < 0 ? Math.PI : 0;   // flukes trail the direction of travel
      // Each hit that lands settles it lower in the water, so you can see how
      // close it is to going under; a fresh one rolls as it turns away.
      mesh.position.y = baseY - (WHALE_HP - o.hp) * o.r * 0.6;
      mesh.rotation.z = o.hurt > 0 ? Math.sin(o.hurt * 36) * 0.22 * (o.hurt / 0.45) : 0;
    }
    for (const { o, mesh } of this.swirlMeshes) {
      mesh.rotation.y = -o.spin;
      mesh.children[0].rotation.y = o.spin * 1.7;
    }
    this.updateSharks(session, t);
    this.updateSpits(session, t);
    this.updateMixers(dt);

    this.updateParticles(session, t);
    this.updateConfetti(dt);

    // Chase camera. It tracks the boat laterally, so whatever is near your lane
    // stays on screen; it stops at the dock so the arrival is visible.
    const followY = Math.min(b.y, level.length - 30);
    const centre = riverBounds(level, b.y).center - HALF;
    const camX = bx + (centre - bx) * 0.25;
    const want = new THREE.Vector3(camX, CAM_UP + h * 0.4, -followY + CAM_BACK);
    let cheerCam = null;
    if (this.cheer) {
      // Drop in close and level off: the llama is the subject now, and from
      // the chase height it would be a speck at the foot of the frame.
      const spot = this.cheer.spot;
      cheerCam = this.cheerCam();
      want.set(spot.x, spot.y + 30, spot.z + cheerCam.dist);
    }
    const k = 1 - Math.exp(-7 * dt);
    this.camera.position.lerp(want, k);
    if (session.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * session.shake * 0.9;
      this.camera.position.y += (Math.random() - 0.5) * session.shake * 0.9;
    }
    const lookAt = cheerCam
      ? new THREE.Vector3(this.cheer.spot.x, cheerCam.lookY, this.cheer.spot.z)
      : new THREE.Vector3(camX * 0.6, LOOK_UP, -followY - LOOK_AHEAD);
    this.camLook.lerp(lookAt, k);
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

  // How to hold the camera during the arrival. While the view is clear the
  // llama is centred and close. Once the results panel slides up it has to
  // move into the strip the panel leaves free -- which means backing off far
  // enough to fit that strip as well as aiming at it, the same solve
  // frameMenuBoat does for the boat on the title screen.
  cheerCam() {
    const spot = this.cheer.spot;
    const tanHalf = Math.tan((this.camera.fov / 2) * Math.PI / 180);
    if (!document.querySelector('.screen.active.dim')) {
      return { dist: CHEER_CAM_BACK, lookY: spot.y + 4 };
    }
    const clear = this.menuClearNdc();
    const band = Math.max(0.24, clear + 1);
    const wantHeight = Math.min(band * 0.60, 0.36);
    const dist = Math.max(CHEER_CAM_BACK, Math.min(640, this.cheer.height / (wantHeight * tanHalf)));
    const targetNdc = (clear - 1) / 2;                    // middle of the strip
    return { dist, lookY: spot.y - targetNdc * dist * tanHalf };
  }

  // How far down the screen the active menu's controls reach, in NDC.
  menuClearNdc() {
    const screen = document.querySelector('.screen.active');
    if (!screen) return 0.1;
    let bottom = 0;
    for (const el of screen.children) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    // Against the stage, not the layout viewport: on a phone they differ by
    // the toolbar, and that error would push the boat off the bottom.
    const stage = this.renderer.domElement.clientHeight || window.innerHeight;
    if (!bottom || !stage) return 0.1;
    return 1 - 2 * (bottom / stage);
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

  // Skinning is the expensive part, and a course holds dozens of creatures.
  // Only the ones near the boat are posed; the rest hold their last frame,
  // which is invisible at that distance.
  updateMixers(dt) {
    if (!this.mixers) return;
    const z = this.boat.position.z;
    for (const { mixer, obj } of this.mixers) {
      obj.updateWorldMatrix(true, false);
      if (Math.abs(obj.matrixWorld.elements[14] - z) < ANIMATE_WITHIN) mixer.update(dt);
    }
  }

  renderBackdrop(t) {
    const dt = Math.min(0.05, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.cheer) this.endCheer();
    this.updateConfetti(dt);
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

// A few islands far out on both beams, instead of a continuous coastline.
// They are there so the eye has something to measure speed against, which
// bare water does not give you; everything is welded into one mesh.
function buildIslands(level, yFrom, yTo, step = 850) {
  const w = Welder();
  const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg);
  for (let y = yFrom; y <= yTo; y += step) {
    for (const side of [-1, 1]) {
      const seed = y * 0.013 + (side > 0 ? 3.7 : 9.1);
      const h = hash(seed);
      if (h < 0.3) continue;                        // leave gaps between them
      const cx = riverCenter(level, y) - HALF + side * (540 + h * 780);
      const cz = -(y + hash(seed + 5.3) * step * 0.7);
      const r = 95 + h * 150;
      const height = 20 + hash(seed + 1.9) * 52;
      w.add(cone(r, height, 7), [cx, height * 0.5 - 6, cz]);
      // a smaller peak alongside, so the silhouette is not a plain cone
      const r2 = r * (0.4 + hash(seed + 2.7) * 0.25);
      w.add(cone(r2, height * 1.45, 6), [cx + r * 0.42, height * 0.72 - 6, cz + r * 0.3]);
    }
  }
  return w.empty() ? new THREE.Group() : w.mesh(M.land);
}

// One buoy, built once and instanced: float, topmark and a short mast.
function buoyGeometry() {
  const w = Welder();
  w.add(new THREE.CylinderGeometry(5.5, 4, 13, 7), [0, 2, 0]);
  w.add(new THREE.ConeGeometry(5.5, 9, 7), [0, 12, 0]);
  w.add(new THREE.CylinderGeometry(0.9, 0.9, 13, 5), [0, 22, 0]);
  w.add(new THREE.SphereGeometry(3, 7, 5), [0, 29, 0]);
  return w.geo();
}

// The buoys are the course: they stand where the banks used to, so the channel
// the boat is clamped to is the one the player can see.
// The modelled buoy is ~1,300 triangles against the stand-in's ~200, so they
// are spaced further apart: at 115 a long course spent 100k triangles on
// scenery that is mostly distant.
function buildBuoys(level, yFrom, yTo, step = 185, renderer = null) {
  const slots = [];
  for (let y = yFrom; y <= yTo; y += step) {
    const b = riverBounds(level, y);
    slots.push({ x: b.left - HALF - 6, z: -y, side: -1 });
    slots.push({ x: b.right - HALF + 6, z: -y, side: 1 });
  }
  const model = renderer && renderer.buoyModel;
  const geo = model ? model.geo : buoyGeometry();
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const mine = slots.filter((p) => p.side === side);
    if (!mine.length) continue;
    // Port magenta, starboard gold. The model is a red buoy, so its material
    // is tinted per side rather than used as it comes.
    const material = side < 0 ? M.buoyPort : M.buoyStbd;
    const mesh = new THREE.InstancedMesh(geo, material, mine.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    mine.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, model ? 0 : -3, p.z), q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  return g;
}

// Pontoon the crossing starts from.
function buildStart(level) {
  const b = riverBounds(level, 0);
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(b.right - b.left + 70, 9, 120), M.deckPlate);
  deck.position.set(b.center - HALF, 5, 62);
  g.add(deck);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(b.right - b.left + 78, 3, 128), M.deckEdge);
  edge.position.set(b.center - HALF, 10, 62);
  g.add(edge);
  return g;
}

function buildDock(level) {
  const y = level.length, z = -y;
  const b = riverBounds(level, y);
  const w = b.right - b.left, cx = b.center - HALF;
  const g = new THREE.Group();

  const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 44, 8, DOCK_DEPTH), M.deckPlate);
  deck.position.set(cx, 11, z - DOCK_MID);
  g.add(deck);

  const planks = Welder();
  const plankGeo = new THREE.BoxGeometry(11, 2, DOCK_DEPTH - 2);
  for (let x = -(w + 44) / 2 + 6; x < (w + 44) / 2; x += 15) planks.add(plankGeo, [cx + x, 15.4, z - DOCK_MID]);
  g.add(planks.mesh(M.deckEdge));

  // Mooring posts stand at the deck's face, half out in front of it -- which
  // is also what stops the bow, so they have to sit beyond the bow's reach.
  for (const px of [b.left - HALF + 6, cx, b.right - HALF - 6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 22, 6), M.dark);
    post.position.set(px, 2, z - DOCK_FACE - 1);
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
  // finish flag
  const poleZ = z - DOCK_FACE - DOCK_DEPTH + 6;     // standing at the back of the deck
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 54, 6), M.buoyMast);
  pole.position.set(cx, 42, poleZ);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(30, 17), mat(COL.cyan, { side: THREE.DoubleSide }));
  flag.position.set(cx + 16, 60, poleZ);
  g.add(flag);
  // Harbour apron, starting exactly where the deck ends.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(w + 900, 12, 420), M.landHigh);
  apron.position.set(cx, 6, z - DOCK_FACE - DOCK_DEPTH - 210);
  g.add(apron);
  return g;
}

// Reef, not a river rock: same jagged lump, sea colours.
function makeRock(o) {
  const g = new THREE.IcosahedronGeometry(o.r * 1.15, 0);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const j = hash(o.seed * 90 + i);
    p[i] *= 0.75 + j * 0.5; p[i + 1] *= 0.6 + j * 0.4; p[i + 2] *= 0.75 + j * 0.5;
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.reef);
  m.position.y = -o.r * 0.25;
  return m;
}

// Whale: a long back at the surface with a dorsal fin and flukes. It lies
// across the channel and swims the way it is drifting (see the yaw in
// renderSession), so the flukes always trail.
function makeWhale(o) {
  const g = new THREE.Group();
  const dark = Welder();
  dark.add(new THREE.SphereGeometry(1, 12, 9), [0, 0, 0], [o.hl, o.r * 1.05, o.r * 1.25]);
  dark.add(new THREE.SphereGeometry(o.r * 0.85, 9, 7), [o.hl * 0.82, 0, 0], [1.25, 0.85, 0.95]);
  dark.add(new THREE.ConeGeometry(o.r * 0.42, o.r * 1.1, 5), [-o.hl * 0.18, o.r * 0.95, 0], null, [0, 0, -0.25]);
  for (const side of [-1, 1]) {
    dark.add(new THREE.ConeGeometry(o.r * 0.5, o.hl * 0.42, 4),
      [-o.hl * 1.02, o.r * 0.1, side * o.hl * 0.17], [1, 1, 0.35], [0, side * 0.5, Math.PI / 2]);
  }
  g.add(dark.mesh(M.whale));
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), M.whaleBelly);
  belly.scale.set(o.hl * 0.86, o.r * 0.6, o.r * 0.95);
  belly.position.y = -o.r * 0.55;
  g.add(belly);
  g.position.y = 1.5;
  return g;
}

function makeWhirlpool(o) {
  const g = new THREE.Group();
  const funnel = new THREE.Mesh(new THREE.ConeGeometry(o.R * 0.62, 34, 12, 1, true), M.swirl);
  funnel.position.y = -15;
  g.add(funnel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(o.R * 0.6, 1.8, 4, 20), mat(COL.cyan, { side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  g.add(ring);
  g.position.y = 1;
  return g;
}

// All of a level's sharks in three instanced draw calls: body, pale belly and
// the fins. They sit at the surface so the dorsal fin reads from behind.
function buildSharks(count) {
  const body = Welder();
  const b = new THREE.SphereGeometry(1, 12, 9);
  body.add(b, [0, 0, 0], [17, 6, 7.5]);
  body.add(new THREE.ConeGeometry(5.5, 13, 7), [18, 0, 0], null, [0, 0, -Math.PI / 2]);   // snout

  const belly = Welder();
  belly.add(new THREE.SphereGeometry(1, 10, 7), [0, -2.4, 0], [14.5, 3.4, 6]);

  const fins = Welder();
  fins.add(new THREE.ConeGeometry(4.6, 11, 4), [-1, 7, 0], [1, 1, 0.35], [0, 0, -0.3]);    // dorsal
  for (const side of [-1, 1]) {
    fins.add(new THREE.ConeGeometry(3.6, 9, 4), [4, -2, side * 5], [1, 1, 0.3], [0, 0, side * 0.5]);
  }
  fins.add(new THREE.ConeGeometry(5.5, 12, 4), [-18, 2.5, 0], [1, 1, 0.3], [0, 0, 1.1]);   // tail
  fins.add(new THREE.ConeGeometry(4.2, 9, 4), [-18, -2.5, 0], [1, 1, 0.3], [0, 0, 2.1]);

  const meshes = [
    new THREE.InstancedMesh(body.geo(), M.shark, count),
    new THREE.InstancedMesh(belly.geo(), M.sharkBelly, count),
    new THREE.InstancedMesh(fins.geo(), M.shark, count),
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
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 5), M.mast);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = side * 15;
    oar.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 6), M.deck);
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

  g.userData.rig = (t, celebrating, lean = 0, crewFree = false) => {
    const sw = Math.sin(t * (celebrating ? 9 : 4.4));
    for (const { oar, side } of oars) {
      oar.rotation.x = sw * 0.5;
      oar.rotation.z = side * sw * 0.12;
    }
    if (crewFree) return;
    crew.position.y = celebrating ? Math.abs(Math.sin(t * 10)) * 4 : 0;
    g.userData.liven(t, celebrating);
  };
  return g;
}

// Stretch of open sea shown behind the menus.
const MENU_RIVER = { riverWidth: 260, meanderAmp: 22, meanderLen: 760, speed: 110 };

function buildMenuSea(renderer = null) {
  const level = MENU_RIVER;
  const g = new THREE.Group();
  g.add(buildIslands(level, -700, 1500));
  g.add(buildBuoys(level, -600, 1400, 185, renderer));
  return g;
}
