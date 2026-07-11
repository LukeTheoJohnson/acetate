# Strudel Auto-DJ 🎧

An AI DJ that **builds tracks live in [Strudel](https://strudel.cc) code** while you
play the crowd. Drag the **crowd-mood fader** up when the room is loving it and down
when you're losing them — the DJ reads the room and evolves the track in response,
rewriting its own Strudel program in real time. Hold the crowd high on a fully built
track and it locks in a **banger**, saves it to the crate, and starts a fresh one.

Inspired by watching live-coded generative sets: the code *is* the instrument, and here
the audience is part of the feedback loop.

![layout: deck (live code) · mood fader · dancing crowd + crate]

---

## Run it

The app is a static site with **no build step**. Strudel is loaded from a CDN, so you
just need to serve the folder over HTTP (audio + ES features want a real origin, not
`file://`):

```bash
# any static server works; using Python since it's already on your machine
python -m http.server 8123
# then open http://localhost:8123
```

Click **▶ Start the set** (a click is required to unlock browser audio), then drag the
mood fader and watch the code — and the crowd — react.

> First load pulls the Strudel engine from unpkg, so you need to be online the first time.

---

## How it works

```
crowd-mood fader ──▶ DJ engine (state machine) ──▶ Strudel code ──▶ live audio
        │                     │                          │
        └── you steer ────────┘                          └── shown + highlighted live
                              │
                     crowd panel (canvas)  ◀── energy / beat / approval
```

- **DJ engine** (`src/dj.js`) — holds the current track as structured state (key, scale,
  tempo, a chord progression and a stack of layers) and mutates it on every ~1s tick:
  - **mood up** → build up: layer in hats → bass → clap → chords → lead → atmosphere, and
    raise energy (denser hats, brighter filters, delay/reverb).
  - **mood down** → read the room: strip a layer back or change direction.
  - **mood steady on a full track** → the crowd approves: save it and start fresh.
- **Rendering** — the state is compiled to an idiomatic Strudel program (`stack(...)` of
  `s(...)` / `n(...).scale(...)` layers) and hot-swapped via Strudel's `evaluate()`. The
  code you see is exactly what's playing.
- **Crowd panel** (`src/viz.js`) — a canvas crowd that dances to a beat clock synced to
  the track tempo; colour and motion track energy, confetti flies near a banger.
- **The crate** — saved tracks persist in `localStorage`. Preview or delete any of them;
  previewing pauses the live set until you hit *back to live set*.

Everything the DJ generates is seeded (`src/rng.js`), so a saved track's code is
reproducible.

## Controls

| Control | What it does |
|---|---|
| **Crowd mood fader** | Your feedback, `-100`…`+100`. Steers building vs. stripping back. |
| **▶ Start / ⏸ Stop the set** | Bring the DJ up / silence it (`hush`). |
| **⏭ New track** | Skip: abandon the current track and start a fresh one. |
| **Crate ▶ / ✕** | Preview or delete a saved banger. |

## Project layout

```
index.html      layout + loads Strudel and the modules
styles.css      dark neon club theme
src/rng.js      seeded PRNG + helpers
src/theory.js   scales, keys, chord progressions
src/names.js    track-title generator
src/dj.js       the DJ brain: state, mood-driven evolution, code generation
src/viz.js      the dancing-crowd canvas
src/app.js      wiring: Strudel init, evolution loop, UI, the crate
test/app_test.js  headless jsdom integration test (Strudel audio stubbed)
```

## Tests

The app needs no dependencies to run; the test suite uses `jsdom` to exercise the wiring
(boot → start → live evaluation → evolution → banger detection) with Strudel's audio
globals stubbed:

```bash
npm install   # installs jsdom (dev-only)
npm test
```

## Tuning

Most of the "feel" lives in `src/dj.js`:

- `STAGES` — the arrangement layers and the order they build in.
- `tick()` — the probabilities that translate mood into build/strip/mutate decisions.
- `HIT_SECONDS` and the `gate` in `tick()` — how long the crowd must stay hyped on a full
  track before it counts as a banger.
- `render()` — the actual Strudel each layer emits (sounds, filters, effects).

## Notes / limits

- Drum sounds (`bd hh oh cp`) rely on Strudel's default sample bank loaded by
  `initStrudel()`; the synth layers (`sawtooth`/`square`/`triangle`/`sine`) always play.
  To use your own kit, load samples in `startSet()` before the first `evaluate`.
- Beat timing in the visualiser is a lightweight clock synced to tempo — it reads as
  on-beat but isn't sample-accurate to the audio.
