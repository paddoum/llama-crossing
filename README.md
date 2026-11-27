# Explorer Quest — Crossing

Branded for **Argonaut United**. The identity is read from the app itself
(`/Users/pierre/Documents/PresetLive_Argonauts2026`, `src/style.css`), not invented:

| | |
|---|---|
| Navy (base) | `#021a3b` |
| Surface / page / tab bar | `#0e2549` · `#153756` · `#153d68` |
| Azure · deep cyan · cyan | `#1884c6` · `#058cac` · `#22bae7` |
| Gold · magenta | `#c8980a` · `#ac2caf` |

The wordmark is the app's own `AppLogo`: "Explorer Quest" in condensed uppercase over a star (the star path is copied from `src/assets/star.svg`).

> **Font caveat.** The app sets **din-condensed** from an Adobe Fonts kit (`use.typekit.net/gik8sjj.css`). Typekit kits are licensed to specific domains, so that kit can't be loaded from this game's host. This uses **Barlow Condensed** from Google Fonts — the first fallback the app's own `--font-sans` declares, and a close match. To use the real face, add this game's domain to the kit and swap the `<link>` in `index.html`.

## The sea

The course is open sea, not a canal. Paired buoys stand where the banks used to — magenta to port, gold to starboard — so the channel the boat is *clamped* to is the one the player can actually see; low land sits far out on both beams to give the eye something to measure speed against, which bare water does not. Hazards are **sharks** (spit drives them off) and **whales** (drifting, solid), plus reefs and whirlpools.

Three colours are set for legibility rather than taste, and all three were measured against the rendered sea: the whales are `#3d7ba6` because at their natural `#16426a` they were within a few luminance points of the water and effectively invisible; the sharks carry an emissive lift so they hold their azure in shadow; and the reefs are **marron**, `#8c5a30`, with a warm emissive.

The reefs are the one warm hue in the scene, and deliberately so. At their old `#16436b` they sat 14 luminance points off the water beside them with a red-minus-blue gap of **+6** — the same hue as the sea, so they read as texture rather than as something to steer around. At `#8c5a30` that gap is **+71** (reef +22, water −49): nothing else on screen is warm, so a reef cannot be mistaken for a wave. Measured contrast against the sea: whales +44, sharks +48, reefs +23 luma and +71 hue.


A mobile-first web game: a llama rows from **A** to **B**, dodging rocks, drifting logs and whirlpools, and spitting at the viruses floating in the river. No build step and no image assets -- everything is drawn in code.

Two builds share one simulation:

| | | |
|---|---|---|
| **3D** (default) | `/` | Three.js chase cam, low-poly geometry built in code |
| **2D classic** | `/2d/` | the original canvas renderer, by URL only |

Levels, physics, scoring and saved progress are identical; only the renderer
differs. The title screen no longer links to the 2D build -- it is still
served, and still playable at `/2d/`, but you have to know it is there.

## Play locally

The game uses ES modules, so it needs a static server (any will do):

```bash
python3 devserver.py 8001
```

Then open <http://localhost:8001>. To play on your phone, connect it to the same Wi‑Fi and open `http://<your-Mac-IP>:8001` (find the IP with `ipconfig getifaddr en0`).

`devserver.py` is an ordinary static server that sends `Cache-Control: no-store`. Use it rather than `python3 -m http.server`: ES modules are cached per URL, so a plain server will happily leave the page running a mix of edited and cached files, which looks exactly like a bug.

## Explorer Quest link

The Explorer Quest app (mission 09, the Final Crossing) opens the game as `?session=<run>&return=<app page>`. Every
menu then shows **Back to the Explorer Quest**, which goes to the return address with `?session=<run>&level=<n>`,
`n` being the highest level completed in the saved progress (0 to 6); the app reports it, and level 3 completes the
mission (levels 4 to 6 made easier and worth more points, client, 26 November). The return address must be one of the app's (`pla2026[-dev|-stage].ar-go.co`, or `localhost` /
`127.0.0.1` over http), else it is ignored. Without these parameters, the game plays as before. The code is in
`js/explorer.js`.

## Controls

- **Phone:** drag anywhere to steer (relative drag — the boat moves by how far your finger travels). **Tap** to spit.
- **Desktop:** ← / → or A / D to steer, `Space` to spit, `P` / `Esc` to pause.

A tap is a press under 260 ms that moved less than 12 px, so steering never fires a spit by accident.

## Scoring

Three hearts per crossing. Reefs, whales, whirlpool cores and sharks each cost
one on contact. Stars: one for finishing, one more for ending with 2+ hearts,
one more for driving off 70%+ of the level's sharks.

Spit drives a **shark** off in one hit. A **whale** takes **three** — it is far
too big to shift with one, and making it cheaper would turn every level into
target practice. The first two hits only rock it and turn it around, and each
one settles it lower in the water, so you can see how close it is to going
under before it does. Whales still do not count toward the third star; that is
sharks only, so clearing a whale buys you a safer lane rather than points.

## Hosting

Upload the folder as-is to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). The `manifest.webmanifest` lets players add it to their home screen as a standalone app.

## Fitting a phone screen

The game is sized to the **visual** viewport, never to the layout viewport.

On a phone these are not the same rectangle. `position: fixed`, `inset: 0`
and `100vh` all resolve against the *large* viewport — the whole screen,
including the strip hidden behind the browser's own toolbar — while
`visualViewport` reports what is actually on show. The 3D build used to cut
its drawing buffer to one and stretch its canvas across the other, so on iOS
the picture was squashed vertically and its bottom third, where the boat
sits, was parked behind Safari's bottom bar. The `v` label and the A→B
progress rail went the same way.

`js/viewport.js` takes one measurement, publishes it as the CSS variables
`--vvw` / `--vvh`, and calls back when it changes (window resize,
orientation, and `visualViewport`'s own resize/scroll as the URL bar slides
away). From there:

- `body` is the stage: `position: relative`, exactly `--vvw` × `--vvh`.
- The canvas and every `.layer`, plus the HUD, the progress rail, the toast
  and the version label, are `position: absolute` inside it — so they are
  centred on what the player can see, not on what the browser reserves.
- `Renderer3D.resize` calls `setSize(w, h, true)`. The CSS box and the
  drawing buffer must describe the same rectangle or the picture is stretched
  to fit; `updateStyle: false` was exactly that bug.
- `menuClearNdc()` measures against the canvas, not `window.innerHeight`.

A short stage — a phone turned sideways, or a browser whose toolbars eat the
height — gets a `max-height: 560px` block that tightens the menus and puts
the level grid on three columns, so every screen still fits (the CC BY credit
line is the first thing to fall off the bottom otherwise, and the model
licences require it to stay visible).

To check this without a phone, fake the divergence in devtools:

```js
Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 700 });
visualViewport.dispatchEvent(new Event('resize'));
```

The stage should become 700 tall while a scratch `position: fixed; inset: 0`
probe still measures the full `innerHeight`.

## Version label / caching

The bottom-left label (e.g. `v8`) comes from `js/version.js`. **Bump it whenever you deploy** — it is how you tell whether a browser is running the latest files or a cached older build.

This matters because the game is served as plain ES modules with no build step: GitHub Pages sends `Cache-Control: max-age=600`, so each `js/*.js` file can be served from the browser cache for up to 10 minutes, and a hard reload does not always evict them. If the label shows an old number, you are looking at a cached build — open the page in a private window (separate cache) or wait out the 10 minutes.

## Structure

```
index.html            3D page (importmap pulls Three.js from a CDN)
2d/index.html         2D page; loads ../js/main2d.js
style.css             shared layout, buttons, HUD, safe-area handling
devserver.py          no-cache static server for development
manifest.webmanifest  PWA manifest · icon.svg

js/main3d.js          3D bootstrap: WebGL sizing, fixed-step loop
js/main2d.js          2D bootstrap: DPR canvas, portrait letterbox, same loop
js/render3d.js        Three.js scene: water, banks, props, dock, llama boat, FX
js/render.js          2D canvas drawing

shared by both builds:
js/state.js           screen state machine, DOM wiring, results & unlocks
js/game.js            Session: one play-through (simulation, spit, hits, scoring)
js/levels.js          level data, seeded RNG, obstacle generator, river shape
js/entities.js        boat / rock / log / whirlpool / virus / spit factories
js/physics.js         collisions, bank clamping, whirlpool pull
js/input.js           pointer drag, tap detection, keyboard
js/audio.js           WebAudio synth SFX (no audio files)
js/storage.js         localStorage progress
js/version.js         build label
js/viewport.js        measures the visible viewport, shared by both builds
```

`state.js` is renderer-agnostic: it takes an object exposing `renderSession(session, t)` and `renderBackdrop(t)`, which is the whole seam between the two builds.

## Model credits

All from Sketchfab under **CC BY 4.0**; the credit is shown on the title screen as the licence requires, so don't remove it.

| Asset | Model | Author |
|---|---|---|
| Boat | Stylized Low Poly Rowboat with Paddles | [Muyaya Concept](https://sketchfab.com/muyayaconcept) |
| Buoy | Red Marine Navigation Buoy (Game Ready) | [Muyaya Concept](https://sketchfab.com/muyayaconcept) |
| Shark | Stylized Shark | [kasperromer](https://sketchfab.com/kasperromer) |
| Whale | Low poly animated Cartoon Whale | [Blue Colossus Studio](https://sketchfab.com/BlueColossus) |

### Sea life

The shark and whale are **rigged and animated**, so they can't be instanced — each one is a `SkeletonUtils.clone()` with its own `AnimationMixer`, wound to a different point in the loop. Headings were read off the rigs rather than guessed: the shark's jaw bones sit at **+Z**, the whale's tail fins at **+Z**, so the two face opposite ways and are yawed accordingly. The whale also yaws 180° with its drift so it always swims forwards.

Three things are set by measurement, and are worth keeping if you touch this:

- **Only creatures within `ANIMATE_WITHIN` of the boat are posed.** Skinning 26 skeletons a frame was the single biggest cost; distant ones hold their last frame, which no one can see.
- **Buoys are spaced at 185, not 115.** The modelled buoy is ~1,300 triangles against the stand-in's ~200, and at the tighter spacing a long course spent 100k triangles on distant scenery.
- **The buoy's texture is discarded** in favour of flat brand colours. It ships as a *red* buoy, and tinting a red texture magenta just produces mud (measured `#550707`); port magenta and starboard gold only read as themselves with the map removed.

Frame cost with all of it in: 136k triangles, 91 draw calls, 60 fps (p99 27.7 ms).

## The boat model

`assets/rowboat.glb` — **"Stylized Low Poly Rowboat with Paddles" by [Muyaya Concept](https://sketchfab.com/3d-models/stylized-low-poly-rowboat-with-paddles-f2c35c716f32474e96cce3625073e6b8), licensed [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).** CC BY requires attribution wherever the work is used, so the credit is shown on the title screen as well as here — don't remove it.

It needed no conversion: 928 triangles, 152 KB, and the hull and both oars are separate nodes. It is modelled Y-up with the bow at **+X**, so it gets a quarter turn to point down-river.

### Working the oars

The llama model has no skeleton, so its forelegs are bent in the **vertex shader**: vertices below the shoulder and forward of it rotate about the shoulder, weighted by `smoothstep` so the leg bends instead of shearing off at a seam, and shortened at the same time — the leg is about twice as long as the reach to the oar. Normals are rotated by the same amount, or the raised legs would stay lit as though still hanging.

The angle isn't animated by hand: each frame `reachForOar()` takes the oar handles' current position, converts it into the llama's local space and solves the rotation and shortening that put the hooves there. So the arms follow the stroke exactly rather than being a sine wave tuned to match it.

Two quirks of the model are worth knowing. Its oarlocks are on opposite sides, so the oar yaw has to **mirror per side** (`* side`) or the blades scissor instead of pulling together. And its two oars are posed at slightly different pitches, which no single symmetric arm pose can hold — the arms aim at the midpoint between the handles and split the difference (mean gap ~2.4 units on a 60-unit boat). Trying to level the oars instead turns one of them upside down: the mirrored node transform inverts the angle relationship.

The llama is seated by dropping it until the gunwale crosses *above* its legs — the body sits at the rim and the legs carry on down through the hull to finish below the waterline, where the opaque water hides them. `LLAMA_MODEL_Y` and `BOAT_Y` move together: raise one without the other and the llama either sinks out of sight or stands on top of the boat.

The boat takes its height from the wave sampled at **both ends of the hull** (`HULL_HALF`), not just under its middle. With a hull this long against these wavelengths, a single centre sample lets the bow and stern dip under the surface and the boat visibly ships water.

Each oar hangs off a pivot at its oarlock (`OARLOCK`) so it can row — `Object3D.attach()` moves it there while preserving its world transform, which keeps the pivots aligned with the boat's own axes rather than the exporter's nested ones. Note that **GLTFLoader sanitises node names** (`paddle.001` becomes `paddle001`), so the oars are matched on a name prefix and each one's side is taken from where it actually sits.

### Importing an STL instead

`tools/stl_to_glb.py` converts a printable STL into a web-ready GLB — it drops a base plate, splits the mesh so parts can take separate colours (STL carries no materials), decimates by vertex clustering, and reorients to the game's axes:

```bash
python3 tools/stl_to_glb.py boat.stl assets/boat.glb
```

It took an earlier 15.6 MB / 327,648-triangle sailboat down to 0.22 MB / 9,630 triangles.

## The llama model

`assets/llama-rig.glb` is the llama: one rigged mesh with both of its Mixamo
clips on it. It is fetched in the background, so a slow connection -- or a
missing file -- never blocks the game; the code-built stand-in sails the boat
until it arrives. See **The crew llama** below for how it is built and seated.

It ships at **2.16 MB**: a 1024 JPEG skin (0.27 MB) and 1.68 MB of skinned
geometry, with the two clips only 0.17 MB between them. The texture was
2048 and 3.45 MB of that file on its own; at the size the llama is actually
drawn, 1024 is indistinguishable. Geometry is now the bulk, so decimating the
mesh is the thing to try if it needs to be smaller still.

`assets/llama-anthro.glb` is the unrigged source the rig was made from. The
game never loads it -- it is kept because `tools/mixamo_to_glb.py` takes the
skin from it, Mixamo's own FBX having left the texture behind.

The 2D build still draws its llama in code -- a GLB has nothing to render on a 2D canvas.

## Water

The surface is a custom `ShaderMaterial` in `js/render3d.js`, flat-shaded so the sea is faceted like the rest of the scene.

**The wave function comes from the Argonaut United app's own home screen** (`src/components/shader/shaders/bluestorm.frag`), which adapts [afl_ext's "Ocean"](https://www.shadertoy.com/view/MdXyzX) (MIT). The app raymarches a fullscreen ocean with a fixed camera and no geometry -- that cannot host a boat, sharks and buoys at correct depths, so what is reused here is the wave *function*, not the raymarcher: `exp(sin(x) - 1)` summed over octaves, each octave dragging the sample point along its own direction.

That shape is the whole point. It gives **sharp crests over broad flat troughs**, and flat troughs are what a faceted surface needs -- with gentle sine swell, neighbouring facets tilt so little they shade almost identically and the faceting is invisible. Measured as facet-edge contrast (p90) when shading switches smooth to flat:

| Wave shape | smooth | faceted |
|---|---|---|
| Four sines | 62 | 62 (within noise) |
| Gerstner | 62 | 102 |
| `exp(sin(x)-1)` octaves, as the app | 29 | 65 |

The app's **sky-reflection floor** is reused too: fresnel alone leaves head-on water nearly reflection-free and flat, so the reflection is lifted to a minimum fraction (`uSkyFloor`).

### Reflections

Each facet reflects a procedurally sampled sky (`skySample`) — gradient, sun core, halo, horizon band — rather than mixing toward one flat colour, which is what makes the sun break up across the water as a glitter path. The app does the same thing by looking its reflection up in the real screen-space sky; there is no such buffer here.

Two values are load-bearing and easy to get wrong:

- **The water's sun is not the scene's sun.** The scene light sits behind the camera, which lights the boat and llama well but reflects its glint *away* from the viewer — no amount of shader work makes a glint appear from there. `uSunDir` therefore points ahead and up, so the glitter path falls between the boat and the horizon. Stylised, not physical.
- **The specular exponent must stay tight** (140). Widening it to make glints easier to hit turns whole facets white — measured, that pushed the water's median luminance from 72 to 144 and covered the sea in pale sheets. Sparkle comes from a tight exponent over many facets, not a broad one.

### Flat patches in the troughs

Two things cause unicolour blobs, and the obvious suspect is the lesser one:

- **The rim taper.** The sheet flattens towards its edge so it can meet the far plane without a seam. Starting that at 0.55 of the half-width flattened the water from ~495 units out — well inside the visible course — so mid-distance water went smooth and plain. It starts at 0.84 now; verified no seam appears at the handover (largest row-to-row step 7, in line with ordinary wave variation).
- **Where the per-cell tint comes from.** Hashing the *facet normal* seems equivalent to hashing position and is not: these waves have broad flat troughs, so every facet down there shares a normal, draws the same number, and the trough comes out one colour. `cellNoise` quantises world XZ instead — which lines up exactly with the mesh, because the waves displace vertically only. The tint is also applied **additively as well as multiplicatively**: ±14% of a near-black trough is ±2 luminance, i.e. invisible.

Together those took flat unicolour blocks from 27% to 14% of the near-water band.

There is deliberately **no foam**: whitecaps and the channel-edge foam were both carried over from the river, and on open water with buoys marking the course there is no shore for either to belong to.

Rejected on purpose, from the references: screen-space reflection (Tardif calls it "really expensive" for little gain on turbulent water -- his scene is ~0.9 ms on an RTX 2080), depth-buffer shorelines and refraction (Azur Games say mobile titles avoid exactly this), normal and flow maps (they measured 4-6 fps back from dropping normal maps alone), and tessellation (absent from WebGL2).

### Facet size is coupled to the hull

`WATER_SEG` sets the facet size and is **not** a free visual knob: coarser triangles interpolate across the troughs, so the rendered surface sits higher than the wave field the boat floats on. After changing it, re-check with the analytic float test -- compare the hull floor against `__r3d.waveAt()` sampled along the hull. Do **not** trust a pixel probe here: "is there blue inside the hull" reads water seen *past* the bow and stern as flooding, and returns the same number however high the boat sits. That mistake once left the boat hovering 4.7 units above the sea.

`WAVE` in `js/render3d.js` is the single definition of the wave set: the GLSL is generated from it and the JS `waveAt()` mirrors it (fewer octaves -- the boat only needs the broad swell).

## The arrival

Crossing the finish line hands the frame over to `Renderer3D`'s cheer, in
`render3d.js`. Timings live in the `CHEER` block:

1. **0.45s** — the oars freeze where the stroke left them and the boat coasts.
2. **0.45 → 1.40s** — the llama arcs out of the crew seat onto the dock
   planks, unwinding the half turn that had it facing the bow, which lands it
   looking straight down the lens.
3. **1.40s** — 170 cotillons go off, the groove starts, 110 more cotillons at
   **2.20s**, and the llama bounces on the spot until the results screen
   arrives at **3.5s**.

Two things are measured rather than assumed, because the sculpted llama and
the code-built stand-in it falls back to are different shapes: how far the
hooves hang below the model's own origin (which is what stands it on the
planks) and its height (which is what the camera frames). `startCheer` poses
it at the origin, takes a `Box3`, and reads both off that.

The llama is **reparented** out of `boat.userData.crew` into `cheerGroup`,
which sits at the scene root with an identity transform — so its position is
world space and the boat can keep bobbing on the swell underneath without
dragging it along. `endCheer` puts it back, and `disposeLevel` and
`renderBackdrop` both call it, so a replay starts with a crewed boat. `rig()`
takes a `crewFree` flag for the interval, so nothing reaches for an oar that
is no longer being held.

The camera has two framings. While the view is clear it sits `CHEER_CAM_BACK`
units out, level with the llama. When the results panel appears it re-solves
against `menuClearNdc()` — backing off far enough to fit the strip the panel
leaves free, and aiming at the middle of it — which is the same solve
`frameMenuBoat` does for the boat on the title screen. `#screen-complete` also
carries a lighter dim than the other overlays so the llama still reads behind
it.

`state.js` asks the renderer how long to wait (`renderer.winDelay`), so the 2D
build keeps its old 1.1s and is untouched by any of this.

### The feet

Two bugs put the hooves in the wrong place, both found by measuring rather
than by looking.

**The shader was bending them.** `armWeight` asked "below the shoulder and
forward of it", which is the right question for a llama with its forelegs
hanging down — but this one sits with them tucked at the chest, so the test
also caught the front of the hind hooves. Of the 4291 vertices it moved, 1939
were in the bottom quarter of the model. At rowing angles that is invisible;
once the dance drives `uArm` a full radian the hooves swing with it. The
model leaves a clean dead band between the hooves and the forelegs — at glTF
y −0.76..−0.57 almost nothing is weighted — so `ARM.lowY` cuts the weight off
inside it. The bottom band now measures 0 moved vertices, mean weight 0.000.

**The squash was lifting them.** Scale pivots on the model's origin, which
sits mid-body, so squashing it on the landing also pulled the hooves up off
the planks. The dance now drops the body by exactly what the legs lose
(`c.feet * sq`). Leaning at full tilt on the touchdown drove the downhill
hoof 0.7 units through the planks, so the sway is scaled by how airborne it
is. Measured over a full loop: hooves travel 16.19..24.13 against a deck at
16.40 — they plant within 0.2 and clear it by 7.7.

### Berthing the boat

The pier used to be laid 2 units past the finish line, and the boat moored
*inside* it: the line is crossed by the hull's **middle**, so by the time the
boat stops its bow is 30 units further on — measured 27.8 units deep into the
deck box, with a mooring post through the hull for good measure.

So the pier is now positioned off the bow rather than off the line.
`BOW_REACH` (30) is how far the bow reaches past the boat's origin and
`DOCK_BERTH` (8) is the open water left in front of it, which puts the deck's
near face 38 units past the line. Everything else hangs off that face, so none
of it can drift back into the hull: the posts stand 1 unit inside it, the deck
runs 34 deep from it, the flagpole stands 6 short of the deck's back edge, and
the harbour apron starts exactly where the deck ends. Measured after the move:
8.4 units of water between bow and deck, 5.4 between bow and the nearest post.

Pushing the pier back lengthened the leap from 34 units to 60, so `CHEER.hop`
went 0.70 → 0.95s and the arc 30 → 34 — a flatter, longer jump at roughly the
same speed rather than a floatier one. The llama still lands where it should:
over three seconds of dancing its hooves stay between 40.4 and 54.5 units past
the line, inside planks that run 39 to 71, and plant to within 0.14 of the
deck.

### Cotillons

An `InstancedMesh` of 300 unlit quads with per-instance colour, a third of
them long and thin so they read as streamers. Sizes are deliberately small
(~1.3–2.4 units, streamers 0.7 × 5–8.5): the arrival camera sits ~120 units
out, so anything above about 2.5 units fills the sky with playing cards.
Gravity is lightened to 120 and vertical speed is damped, because paper
floats — at full gravity they are gone before the results screen.

### Something to dance to

`Sfx.startDance()` in `js/audio.js` plays a 126 BPM groove under the dance,
synthesised like everything else in that file — kick, hat, clap, a triangle
bass walking I–V–vi–IV, and a square riff on C major pentatonic (which sits
on all four chords, so it never has to be transposed). It is the same tempo
the llama is driven at: `up = |sin(ph)|` touches down on every eighth, so the
kick on the beat lands on every other hop.

There is no knowing in advance how long it has to play — the results screen
goes up over a dance that keeps going — so bars are written onto the WebAudio
clock a few at a time by a `setTimeout` pump. The lookahead is 1.5 s against a
350 ms tick: generous on purpose, because a backgrounded tab throttles
`setTimeout` to one second and a shorter lookahead would drop bars. All of it
goes through its own gain node, so `stopDance()` can ramp that bus to zero and
silence the lookahead already on the clock instead of waiting it out. Measured
on quit: dead within 300 ms, silent after 400.

Verified by tapping `sfx.master` with an `AnalyserNode` and peak-picking the
RMS. Onsets came out at 0.24 / 0.47 / 0.24 / 0.24 s — the eighth-and-quarter
grid of 126 BPM — peaking at 0.28 with no clipping.

## The crew llama

`assets/llama-rig.glb` is one rigged llama carrying three body clips --
`paddle` while it crosses, and two dances, one picked at random each time it
lands -- plus `prop`, which moves the paddle the paddling clip came with. The arrival only changes which clip is playing, so the llama that gets
out of the boat is the same one that rowed it. Any clip whose name starts with
`dance` joins the pool, so adding a third is a re-export and nothing else:

```bash
blender --background --python tools/mixamo_to_glb.py -- assets/llama-anthro.glb assets/llama-rig.glb --clip paddle="Paddling (4).fbx" --clip dance-freeze="Breakdance Freeze Var 2.fbx" --clip dance-hiphop="Hip Hop Dancing.fbx" --texture 1024 --jpeg
```

Every clip is asked where its own floor and its own heading are, because two
dances off the same rig agree about neither: their headings came out -166
and -1 degrees. `groundLift` and `clipHeading` measure each one at load, so
a new dance needs no hand-tuning.

Four things that bite in that pipeline, all of them fixed in the script or at
load and all of them found by watching the llama end up somewhere absurd:

- **Do not apply Mixamo's scale.** Applying it rescales the armature's rest
  pose but *not* the bone-location channels inside the clips, which stay in
  centimetres. The rig then reads its own animation a hundredfold and the
  llama is flung 1,500 units into the sky. The game scales the whole rig by
  one number instead, which works because the mesh and its skeleton sit under
  the same node.
- **Do not measure a skinned model with `Box3.setFromObject`.** It derives its
  bounds from the bones, which at load time no clip has posed. It reported
  this model as 1.5 units tall at y 69; acting on that put the llama 2,109
  units under the sea. `loadCrew` unions the *geometry* bounding boxes, which
  is what the converter centred.
- **Neither clip stands on the rig's origin.** The paddling one is a seated
  pose whose feet hang 0.86 model-units up. `groundLift` steps each clip
  through and records where its feet actually get to, and the llama is dropped
  by that much when it plays. Measured on the dock: lowest hoof 16.41 against
  a deck at 16.40.
- **`setEffectiveWeight(0)` zeroes an action's base weight**, and `fadeIn`
  ramps a fade factor *against* that base — so it stays at zero and the llama
  arrives on the dock in its bind T-pose. Both actions keep a base weight of
  1; `stop()` and `play()` choose which one runs.

The llama sits facing **back down the river**, the way anyone rowing a boat
does, which is also the side the chase camera is on -- so you watch its face
rather than its tail. `CREW.yaw` is the seat and `CREW.dockYaw` is where the
arrival turns it to; they are separate on purpose, and the hop takes the short
way round between them rather than a fixed half turn.

### Looking at you

A dance choreographed for a stage spends a lot of it with its back to the
camera. On top of whatever the clip is doing, `lookAtCamera` turns the llama
towards the lens through three bones -- upper spine, neck, head -- each taking
a share of the correction up to its own ceiling, so the turn is spread instead
of the head swivelling like an owl's. Which way a bone "faces" is read off the
bind pose, where the whole model faces -Z; a Mixamo bone's own axes run along
the bone and say nothing about facing.

Measured as degrees the snout is off the camera, averaged over 2.5s of each
dance: the breakdance freeze 3, the hip hop 34. A third clip, a Brooklyn
uprock, was dropped from the pool rather than bent further: it turns its back
by design and sat near 50 degrees, and the clamps stop short of wringing a
neck.

### The paddle

The paddling animation **brings its own paddle**. It arrives in the FBX as a
plain mesh with a clip of its own -- not skinned, not parented to a hand --
keyed in the same space as the body, blade dipping below the character's floor
plane where water would be. Nothing in the game has to place it: `prop` plays
on the same `AnimationMixer` as `paddle`, so one clock drives both and they
cannot drift apart. The boat's own two oars stay shipped and out of sight.

The converter carries any such prop through, and a few things about that are
worth knowing:

- **It arrives as a node with one mesh per material** -- ash, grip and blade
  here -- so it is the node that is matched and the whole subtree that moves.
- **It is left out of the body measurement.** A paddle carried overhead
  reaches higher than the llama does, and measuring the two together scales
  the model down to fit the paddle into the boat: counted in, this body came
  out 1.87 tall against its true 1.70.
- **Its keys are not moved when the rig is stood on the origin.** That
  centring only ever applies to the rest pose, because a clip keys the
  armature object's own location and overwrites it the moment it plays. Shift
  the prop to match and you pull the two apart -- which put this paddle 0.85
  up, a good arm's length above the hands holding it.
- **Materials keep their colour.** A prop can be plain painted material with
  no texture at all, and a loader that keeps only the map leaves a white
  paddle.
- **It is hidden, not stowed, when the llama climbs out.** Only the rowing
  clip animates it, so left visible it hangs in the air over an empty boat
  through the whole dance. The reference to it is held directly rather than
  looked up through the crew group, because the arrival lifts the llama out of
  that group at exactly the moment the paddle most needs hiding.

Measured in the game: the paddle holds 45.5 units against a 46-unit llama, the
hands stay within 1.3 of the shaft on average (the clip has them slide and
briefly release through the side changes, by design), the blade crosses from
29 units one side of the boat to 31 the other, and at the catch it comes down
to 0.2 above the water -- which sits at y 0.

#### Fitting an oar to a rig that has none

Mixamo gives you a body and nothing to hold, so `fitOar` stays as the fallback
for a clip that brings no prop. It threads one of the boat's oars through both
hands each frame: butt end in the upper hand, shaft down through the lower one,
blade reaching past it. Which hand is on the grip is read from the clip and
only decided while one is clearly above the other -- through the catch and the
recovery they sit level to within a unit, and reading the answer off that noise
flips the paddle end over end several times a second.

Changing sides is cross-faded rather than eased: the two ends share a line, so
the new shaft direction is the exact opposite of the old one, and easing one
vector towards its own opposite shrinks it to nothing and then snaps. Only the
swap is blended; every other frame tracks the hands exactly.

That path also has to watch its units. The boat's oar node carries a lopsided
scale of its own, about 0.27 across the blade against 2.13 along it, so a
length measured off the world bounding box is in different units from an offset
applied inside the oar -- mixing the two sent the blade swinging several
body-lengths wide. It is measured in the oar's own frame and converted once.

The old shader that bent the sculpted llama's forelegs around an oar is gone,
along with the hand-made dance — the rig does both now.

## Rigging the llama elsewhere (Mixamo)

This is how the crew llama above was rigged, and it is what to do with any
other model you want to put in the boat. `tools/glb_to_fbx.py` produces an
upload-ready FBX (Blender required, no add-ons):

```
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/glb_to_fbx.py -- assets/llama-anthro.glb llama-mixamo.fbx
```

Add `--tpose` for a model whose arms are not already out to the sides: it
throws a temporary armature at the mesh, binds it with automatic weights,
swings the arm chain onto the x axis and bakes the result. The sculpted llama
that used to crew the boat needed it -- it stood with its forelegs tucked
against its chest, hands almost touching, which gives an auto-rigger nothing
to separate and gets you a rigged snowman.

It does three things Mixamo needs:

- **Welds the mesh.** The source is triangle soup — every triangle carries
  its own copies of its corners — so it imports as **11,609 disconnected
  shells with 53,501 of 73,879 edges non-manifold**. The auto-rigger walks a
  connected surface to find limbs, and would have nothing to walk. After
  welding at 1e-4: **1 shell, 39 non-manifold edges of 47,133**, 54,069
  vertices down to 15,708, all 31,419 faces intact.
- **Scales to 1.7 m**, which keeps the auto-rigger's marker placement sane.
- **Embeds the texture** and exports binary FBX 7400, Y-up / −Z-forward.

The stance is in its favour: from 2% to 20% of its height the mesh has
exactly two islands, at x ±0.17 and well apart, so it reads as a biped
standing on two legs — which is the shape the auto-rigger expects. Exports
are gitignored; rebuild rather than commit them.

If a rigged FBX comes back, wiring it up is the `AnimationMixer` path the
sharks and whales already use, and the shader foreleg bend stops being
needed.

## Verifying the 3D build

Screenshot tools are unreliable against a WebGL canvas -- they routinely capture a stale frame, which looks exactly like a rendering bug (a missing boat, a river in the wrong place). To check what is really on screen, read the framebuffer instead:

```js
const gl = __r3d.renderer.getContext();
const px = new Uint8Array(4);
gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
```

`__app` and `__r3d` are exposed on `window` for this. The renderer sets `preserveDrawingBuffer: true` so the read is valid after the frame is drawn.

## Tuning the 3D camera

The constants at the top of `js/render3d.js` (`FOV`, `CAM_BACK`, `CAM_UP`, `LOOK_AHEAD`) set the framing. Portrait is a tall, narrow window, so the camera sits high and well back and looks down ~29°; a shallower angle spends most of the screen on sky. The camera tracks the boat laterally on purpose, so whatever is near your lane stays on screen even though the far bank does not.

## Tuning levels

Edit the `LEVELS` array in `js/levels.js`. Each level is data: `length`, `speed`, `riverWidth`, meander (`meanderAmp`, `meanderLen`), obstacle row `gap`, type `weights`, `maxPerRow`, `virusChance`, and a `seed`. Changing the seed gives a different but still deterministic layout; the generator always leaves at least one 58‑unit gap per row so every level is passable.
