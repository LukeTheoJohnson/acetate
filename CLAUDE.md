# CLAUDE.md — Acetate

Guidance for working in this repo. Keep it current when architecture changes.

## What this is

A **static, build-free browser app** called **Acetate**: an AI DJ that cuts tracks live in Strudel code,
steered turn-by-turn from a two-turntable deck rig. Every track is a record being cut —
approved parts press coloured rings onto the disc, saving "presses" it into the crate.
No backend, no framework, no bundler. Strudel is loaded from a CDN and exposes
`initStrudel`, `evaluate`, `hush` (plus all pattern functions) as globals.

**Naming/vocabulary (renamed 2026-07):** the project is **Acetate**. UI copy calls the
save verb **cut** and a saved record a **dubplate** (a one-off acetate cut); the render
engine (`dj.js`) is conceptually the **lathe**. Code and the `SDJ.*` API keep their
existing identifiers — `press`/`pressModal`/`openPress`/`renderCommitted`/`render` and the
`sdj.crate` storage key are unchanged (implementation names, not UI copy). Don't rename
them to chase the vocabulary.

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
`index.html`: `rng → theory → names → dj → curate → viz → log → art → vinyl →
visualiser → menu → app`. No ES modules (keeps it serverless-simple and robust on
Windows).

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
  - `setCuration(cur)` — stores pre-resolved direction-box constraints
    (`{ scaleFilter, tempo }`); `newSong()` intersects the genre's scale palette with
    the filter and biases the BPM pick ('slow'/'fast' = bottom/top third, a number is
    used directly, clamped 60–200).
  Nine genres (Theory.GENRES): trap, boom bap, drill, lo-fi, R&B + rock, metal, house,
  synthwave (2026-07). Rock/metal open with the bass riff seeded in (like the trap/drill
  808 rule), skip `.bank()` (the default dirt kit reads more acoustic), and stab `'power'`
  voicings; house is four-on-the-floor with offbeat open hats; synthwave favours the pad
  voice. `swingBy` stays boomBap/loFi only.
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
  bottom-right of the Live stage) with the **direction box** above it, the
  compact set history, the `localStorage` crate and the remix console. The Live verdict
  buttons read **"Press it" / "Bin it"**; the old on-screen "DJ moves" event log is gone
  (`logEvent` is a `console.debug` shim — `SDJ.SetLog` recording + the ⬇ Log export
  survive; keep them, they're the diagnostic tuning loop). Agent-native surface:
  `SDJ.live.*`, `SDJ.ab.*`, `SDJ.press.*`, `SDJ.remix.*`, `SDJ.curate.*`,
  `SDJ.setGenre/setDensity/setOpinion`.
- `src/curate.js` — the direction box's parser: free text → deterministic directives
  (`SDJ.Curate.parse`): lane bans/features ("no hihats", "more bass"), mood → a
  `MOOD_SCALES` palette the app intersects with the genre's own, tempo, density, genre
  words (lexicon built live from `Theory.GENRES`). Directives act on the record
  **immediately** (reworked 2026-07-28 — steer-only felt dead): a ban drops an active
  lane from the committed track now and overrules a pending pitch on it (the DJ
  re-pitches); a feature brings an absent lane straight in; both also keep steering
  future pitches via `s.banned['add:i']` + the part-mixer opinions. The chips are a
  receipt of what happened ("no hi-hats — dropped", "slower — now 138 bpm") — don't
  route feedback through `setStatus`, `#status` is `sr-only` (visually hidden). The
  seed is never touched. Curation ban keys are tracked separately so clearing the box
  lifts only them; directives re-stamp every fresh track (after `resetControls()`).
  `SDJ.curate = { set, clear, state }`.
- `src/visualiser.js` — the shared reactive visualiser, now an **evolving scene
  system**: four scenes (bloom, orbits, ridge terrain, lissajous threads) held ~90 s
  each with ~8 s crossfades, parameters drifting from `t` + audio (level/bass); no
  `Math.random` in the frame loop (resume-safe drift from `t`, one-off layouts via
  `SDJ.Rng`). Three mounts: 'full' (the Visuals overlay), 'strip' (top-bar player,
  unchanged), 'mini' (the calm Live-floor tile in the set-history sidebar). While a
  set is live the palette comes from the active lanes' `LANE_COLORS` — approved parts
  literally colour the picture.
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
