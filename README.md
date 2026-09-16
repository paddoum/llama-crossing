# Llama Crossing

A mobile-first web game: a llama rows a boat from shore **A** to dock **B**, dodging rocks, drifting logs and whirlpools while grabbing carrots. Vanilla HTML/Canvas, no build step, no dependencies, no image assets (everything is drawn in code).

## Play locally

The game uses ES modules, so it needs a static server (any will do):

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open <http://localhost:8000>. To play on your phone, connect it to the same Wi‑Fi and open `http://<your-Mac-IP>:8000` (find the IP with `ipconfig getifaddr en0`).

## Controls

- **Phone:** drag anywhere on the screen to steer (relative drag — the boat moves by how far your finger travels).
- **Desktop:** ← / → or A / D to steer, `P` / `Esc` to pause.

## Hosting

Upload the folder as-is to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). The `manifest.webmanifest` lets players add it to their home screen as a standalone app.

## Structure

```
index.html            page shell, HUD and menu screens
style.css             layout, buttons, safe-area handling
manifest.webmanifest  PWA manifest · icon.svg
js/main.js            canvas sizing (DPR + portrait letterbox), fixed-step game loop
js/state.js           screen state machine, DOM wiring, results & unlocks
js/game.js            Session: one play-through (simulation, hits, scoring)
js/levels.js          level data, seeded RNG, obstacle generator, river shape
js/entities.js        boat / rock / log / whirlpool / carrot factories
js/physics.js         collisions, bank clamping, whirlpool pull
js/render.js          all drawing (water, banks, dock, llama boat, hazards, FX)
js/input.js           pointer drag + keyboard
js/audio.js           WebAudio synth SFX (no audio files)
js/storage.js         localStorage progress
```

## Tuning levels

Edit the `LEVELS` array in `js/levels.js`. Each level is data: `length`, `speed`, `riverWidth`, meander (`meanderAmp`, `meanderLen`), obstacle row `gap`, type `weights`, `maxPerRow`, `carrotChance`, and a `seed`. Changing the seed gives a different but still deterministic layout; the generator always leaves at least one 58‑unit gap per row so every level is passable.
