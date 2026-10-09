# Llama Crossing

A mobile-first web game: a llama sails from shore **A** to dock **B**, dodging rocks, drifting logs and whirlpools, and spitting at the viruses floating in the river. No build step and no image assets -- everything is drawn in code.

Two builds share one simulation:

| | | |
|---|---|---|
| **3D** (default) | `/` | Three.js chase cam, low-poly geometry built in code |
| **2D classic** | `/2d/` | the original canvas renderer |

Levels, physics, scoring and saved progress are identical; only the renderer differs.

## Play locally

The game uses ES modules, so it needs a static server (any will do):

```bash
python3 devserver.py 8001
```

Then open <http://localhost:8001>. To play on your phone, connect it to the same Wi‑Fi and open `http://<your-Mac-IP>:8001` (find the IP with `ipconfig getifaddr en0`).

`devserver.py` is an ordinary static server that sends `Cache-Control: no-store`. Use it rather than `python3 -m http.server`: ES modules are cached per URL, so a plain server will happily leave the page running a mix of edited and cached files, which looks exactly like a bug.

## Controls

- **Phone:** drag anywhere to steer (relative drag — the boat moves by how far your finger travels). **Tap** to spit.
- **Desktop:** ← / → or A / D to steer, `Space` to spit, `P` / `Esc` to pause.

A tap is a press under 260 ms that moved less than 12 px, so steering never fires a spit by accident.

## Scoring

Three hearts per crossing. Rocks, logs, whirlpool cores and virus contact each cost one. Stars: one for finishing, one more for ending with 2+ hearts, one more for zapping 70%+ of the level's viruses.

## Hosting

Upload the folder as-is to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). The `manifest.webmanifest` lets players add it to their home screen as a standalone app.

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
```

`state.js` is renderer-agnostic: it takes an object exposing `renderSession(session, t)` and `renderBackdrop(t)`, which is the whole seam between the two builds.

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

`assets/llama.glb` is a sculpted llama (single mesh, 31k triangles, one baked colour texture). It is fetched in the background: the code-built llama sails the boat until the model arrives, so a slow connection -- or a missing file -- never blocks the game. `js/render3d.js` swaps it into the boat's `crew` group on load.

The supplied file was 4.9 MB, 2.9 MB of which was a 2048x2048 JPEG for a llama about 150 px tall on screen. The texture is repacked at 1024 and the file is **2.26 MB**, now dominated by geometry rather than the image. If it needs to be smaller, the mesh is the thing to decimate.

Two things to know when swapping in a different model: it is modelled standing and facing **+Z**, so it is given a half turn to face the bow (−Z), and its legs drop through the hull and end below the waterline, where the opaque water hides them. `LLAMA_MODEL_SCALE` and `LLAMA_MODEL_Y` seat it.

The 2D build still draws its llama in code -- a GLB has nothing to render on a 2D canvas.

## Water

The surface is a custom `ShaderMaterial` in `js/render3d.js`. Four directional sine waves are summed in the vertex shader and the normal comes from their analytic gradient, so there is no CPU work per frame and no vertex buffer upload. The waves are anchored to world space, so the sheet can follow the camera without the surface swimming, and its amplitude tapers at the rim to meet the flat far-field plane invisibly.

The fragment shader adds a depth-tinted base, sun glitter, a sky-coloured fresnel at grazing angles (what reads as "wet"), foam on the crests, and foam along both banks computed from the level's own meander — the same `meanderAmp` / `meanderLen` / `riverWidth` the gameplay uses, passed in as uniforms. It uses three's own fog and colour-space chunks so it matches the rest of the scene exactly.

`WAVES` in `js/render3d.js` is the single definition of the wave set: it generates the GLSL **and** the JS `waveAt()` that floats the boat, the spit and the foam particles. Edit it in one place and both stay in sync.

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
