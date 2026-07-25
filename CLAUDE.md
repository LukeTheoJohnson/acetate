# CLAUDE.md — Strudel Auto-DJ

Guidance for working in this repo. Keep it current when architecture changes.

## What this is

A **static, build-free browser app**: an AI DJ that builds tracks live in Strudel code,
steered turn-by-turn from a two-turntable deck rig. Every track is a record being cut —
approved parts press coloured rings onto the disc, saving "presses" it into the crate.
No backend, no framework, no bundler. Strudel is loaded from a CDN and exposes
`initStrudel`, `evaluate`, `hush` (plus all pattern functions) as globals.

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
`index.html`: `rng → theory → names → dj → viz → log → art → vinyl → menu → app`. No ES
modules (keeps it serverless-simple and robust on Windows).

- `src/dj.js` — **the brain**. `DJEngine` holds the track as a genome and exposes:
  - `newSong()` — fresh seeded track (key/scale/tempo/progression, stage 0 = just kick).
  - `proposeChange()` / `acceptChange()` / `rejectChange()` — the turn-based flow the
    Live set runs on. A rejected add/FX/double/fill is banned for the song; a rejected
    rework is only spaced out (so pitching never dead-ends).
  - `render()` — compile the genome → an idiomatic Strudel `stack(...)` string. Also
    stashes `_lastLines`/`_lastLayers` (body lines + their lane indices).
  - `renderAB(mix)` — ONE balanced program carrying both versions of the pitched lane at
    complementary gains (chained `.gain()` multiplies) — what the crossfader evaluates.
  - `renderCommitted()` — the approved track only, rendered from the pre-pitch snapshot —
    what a save banks, always.
  - `renderArranged()` / `renderArrangedCommitted()` — the genome as a 36-bar
    `arrange([bars, stack(...)], …)` journey (intro → build → peak → kickless strip →
    peak → outro), with snare builds `.mask()`-ed onto section-final bars. The pressing
    modal's "Arranged track" format (the default) banks this.
  - `tick(mood, dt)` — the original crowd-fader optimiser; still engine-resident and
    test-covered, no longer driven by the UI.
  - `state()` — snapshot for the UI.
- `src/vinyl.js` — **the record itself**: deterministic SVG discs (grooves, name
  imprinted on the label via textPath). Every lane owns a **home groove** (fixed radius,
  `radiusFor`) and a signature ring pattern that loosely draws the part (`laneRing`):
  kick = four heavy blocks, hats = fine ticks, bass = solid core + sub halo, clap = two
  backbeat arcs, chords = stacked voicing, lead = dotted melody, air = soft wide band,
  fill = one rising arc; a lane's `variant` angles/nudges the pattern, so a rework
  visibly re-cuts the groove. Deck A / press modal / crate marks all derive from the
  committed genome via `genomeRings` (active lanes + `fxRails` where FX landed +
  `twinRing` where doubles landed + the fill arc). Deck B's acetate (`proposal`) is a
  MOSTLY BLANK translucent disc carrying only `deltaMark` — the one mark the pitch
  would press (add/reshape/fill = the lane ring, fx = rails, double = twin, drop =
  ghost ring + dashed cut), so the visual suggestion matches the audio one and
  approving stamps the exact same markup onto Deck A (shared helpers, same radius).
  The live label hue is fixed per song seed (approvals never re-face the record) and
  carries into the crate for genome-bearing entries; `LAYER_HUE` faces only legacy
  entries. Same seed → same disc everywhere.
- `src/app.js` — Strudel init, the deck rig (Deck A committed record / Deck B acetate /
  A/B crossfader), the pressing modal, the live code panel (single-pass highlighter,
  bottom-right of the Live stage), the
  compact set history, the `localStorage` crate and the remix console. Agent-native
  surface: `SDJ.live.*`, `SDJ.ab.*`, `SDJ.press.*`, `SDJ.remix.*`, `SDJ.setGenre/
  setDensity/setOpinion`.
- `src/art.js` — square generative covers; now the remix shelf's sleeves + fallback.
- `src/viz.js` — the retired crowd canvas (dormant); `src/menu.js` — the menu bloom.
- `src/theory.js`, `src/names.js`, `src/rng.js`, `src/log.js` — supporting data/helpers.

Data flow (Live): `approve/skip → engine genome → render / renderAB(mix) →
window.evaluate → audio`; the same string drives the code panel + pianoroll, and
`Vinyl.forLive` redraws Deck A's record from the committed genome.

Save semantics: the pressing modal (openPress/confirmPress in app.js) always banks the
COMMITTED version — an un-judged pitch is left off, and the modal says so. Format is
"Arranged track" (default) or "Loop"; a record's `approval` field is the approve-rate
from the session's voteLog (the old crowd-EMA never moves in turn-based mode).

Musical-quality guards (from the 2026-07-23 shippability audit):
- Energy ramps with part count via `effEnergyIdx()` (a floor: 3 parts → idx 2, 5 → 3);
  without it, turn-based sets froze at 0.4 and silently disabled hat variety, open-hat
  accents, lead delay and kick shape.
- Trap/drill open with the 808 seeded in (`newSong`), and the bass add is weighted 2.5×
  elsewhere — a skipped pitch can't ship a bass-less drill track.
- Drill 808s always slide (`.penv("<…>").pattack(…)`); lo-fi/boom-bap hats + backbeat
  swing (`.swingBy(1/6,8)`); the lead is always `.lpf()`-ed. All probed against the real
  @strudel/web CDN bundle — `penv`, `pattack`, `swingBy`, `arrange`, `mask` all exist.
- FX/doubles/fills unlock at 4 parts (or when no lanes are addable), not MIN_FULL.

## Conventions

- **British/NZ English** everywhere (colour, visualise, behaviour) — prose, comments, UI.
- Generated Strudel must be **valid and balanced**; `render()`/`renderAB()` build strings
  by concatenation — keep parens/quotes balanced (the test checks this across renders and
  mid-fader blends).
- Keep it dependency-free at runtime. `jsdom` is dev-only (test).
- The highlighter tokenises in one pass so mini-notation `< >` inside strings is never
  re-scanned — don't "simplify" it back to chained regex replaces.
- CRLF line endings on disk here: prefer whole-file `Write` or single-line edits;
  multi-line `Edit` matches can miss on `\r\n`.
- The test seeds `engine.masterSeed` before starting so runs are deterministic — keep it
  that way; unseeded runs made save-prompt timing flaky.

## Gotchas

- Don't pass a custom `prebake` to `initStrudel()` unless you also reload the default
  sounds — it overrides the default sample bank and can silence the drums.
- `render()` re-evaluates only when the engine's `_signature()` changes; the crossfader
  and remix faders throttle their own evaluates (~130ms) instead.
- The save prompt treats a track as full at `MIN_FULL` parts **or** when no more lanes
  are addable (skipped adds are banned per-song) — without the second clause a session
  with a few skipped adds could never reach the press prompt.
- Vinyl SVG ids are seeded per-disc (`uid`) so multiple discs on one page don't collide.
