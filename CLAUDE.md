# CLAUDE.md — Strudel Auto-DJ

Guidance for working in this repo. Keep it current when architecture changes.

## What this is

A **static, build-free browser app**: an AI DJ that builds tracks live in Strudel code,
steered by a crowd-mood fader. No backend, no framework, no bundler. Strudel is loaded
from a CDN and exposes `initStrudel`, `evaluate`, `hush` (plus all pattern functions) as
globals.

## Run & test

```bash
python serve.py 8124           # dev server with caching DISABLED — prefer this
python -m http.server 8123     # plain server; browsers cache src/*.js (stale JS!)
npm install && npm test        # jsdom wiring test; app itself needs no deps
```

**Cache gotcha:** `python -m http.server` sends no `Cache-Control`, so browsers
heuristically cache `src/*.js` and keep serving *old* code after edits — you refresh
and hear the previous build. Use `python serve.py` (sends `no-store`), or keep DevTools
open with Network → "Disable cache" ticked. A fresh port also gives a clean cache.

The app must be served over HTTP for module/audio behaviour. Audio only starts after a
user click (browser policy) — that's why there's a Start button.

## Architecture

Plain classic scripts sharing a `window.SDJ` namespace, loaded in dependency order in
`index.html`: `rng → theory → names → dj → viz → app`. No ES modules (keeps it
serverless-simple and robust on Windows).

- `src/dj.js` — **the brain**. `DJEngine` holds the track as state and exposes:
  - `newSong()` — fresh seeded track (key/scale/tempo/progression, stage 0 = just kick).
  - `tick(mood, dt)` — one evolution step; returns `{changed, events, hit}`.
    `mood` ∈ [-1,1] drives build-up / strip-back / mutate; `hit` = crowd approved a full
    track (save it and move on).
  - `render()` — compile state → an idiomatic Strudel `stack(...)` string.
  - `state()` — snapshot for the UI/viz.
- `src/app.js` — Strudel init, the 1s evolution loop, the mood fader, the live code panel
  (with a single-pass syntax highlighter), the event log, and the `localStorage` crate.
- `src/viz.js` — canvas crowd + beat clock synced to tempo.
- `src/theory.js`, `src/names.js`, `src/rng.js` — supporting data/helpers.

Data flow: `mood fader → engine.tick → (if changed) engine.render → window.evaluate →
audio`; the same rendered string is shown in the code panel.

## Conventions

- **British/NZ English** everywhere (colour, visualise, behaviour) — prose, comments, UI.
- Generated Strudel must be **valid and balanced**; `render()` builds strings by
  concatenation — keep parens/quotes balanced (the test checks this across all stages).
- Keep it dependency-free at runtime. `jsdom` is dev-only (test).
- The highlighter tokenises in one pass so mini-notation `< >` inside strings is never
  re-scanned — don't "simplify" it back to chained regex replaces.
- CRLF line endings on disk here: prefer whole-file `Write` or single-line edits;
  multi-line `Edit` matches can miss on `\r\n`.

## Gotchas

- Don't pass a custom `prebake` to `initStrudel()` unless you also reload the default
  sounds — it overrides the default sample bank and can silence the drums.
- The viz beat clock is visual only (not audio-locked); fine by design.
- `render()` re-evaluates only when the engine's `_signature()` changes (stage /
  variation / energy bucket), so small fader moves don't thrash the audio.
