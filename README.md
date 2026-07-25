# Strudel Auto-DJ 🎧

An AI DJ that **writes and evolves tracks live in [Strudel](https://strudel.cc) code**
while you play the crowd. It authors every note; you only supply *taste*. Every track is
a **record being cut**: each part you approve presses a coloured groove-ring onto the disc
spinning on Deck A, and when you save, the colours and the name are stuck — the record
drops into your crate for keeps.

**[▶ Play it live](https://luketheojohnson.github.io/strudel-auto-dj/)** &nbsp;·&nbsp;
No backend · no framework · no bundler · no build step &nbsp;·&nbsp; MIT-licensed

Strudel is loaded from a CDN and the whole thing is a handful of plain scripts sharing one
`window.SDJ` namespace.

![The Live set — two turntables and a crossfader on the left, the console on the right, the roll and set history below](screenshots/02-live.png)

---

## Three ways to play

The app is one page with four hash-routed views (**Menu · Live · Crate · Remix**). Audio is
a single source at a time, with one **⏹ stop** in the header that halts whatever's playing.
On the menu, a random record from your crate drifts underneath at low volume once you click
in — the place is never silent.

![The menu hub — Live Set, Crate, Remix](screenshots/01-menu.png)

### 🎛 Live Set — two decks, one verdict at a time

Turn-based, and physical. The DJ **cuts one change at a time onto Deck B** as an acetate
test pressing — a translucent disc in the touched part's colour, wearing the kind of change
(`+` new part, `−` drop, `≈` rework, `✦` effect, `≡` double, `▲` fill). The committed track
spins on **Deck A**, its record filling with a coloured ring per approved part.

The bit that matters: the **crossfader** between the decks drives `engine.renderAB(mix)` —
one balanced Strudel program that carries *both* versions of the touched lane at
complementary gains. Slide it and you literally hear the change blend in and out against
the current track before you judge it. **✓ Approve** presses the change onto the record;
**✗ Skip** bins it (a skipped instrument stays out for the song).

The **console** on the right biases what gets pitched next — genre pills, a density dial,
and a per-part channel strip (drop / auto / feature). Below, **the roll** (Strudel's own
[`.pianoroll()`](https://strudel.cc/learn/visual-feedback/)) scrolls the notes with each
layer on its own coloured lane, next to a compact set history. The live code still exists —
tucked into a `</>` drawer, with the pitched lane's lines tinted.

### ◉ Pressing — saving is cutting a record

When the arrangement is full (or you hit **◉ Press record** any time), the pressing modal
opens: the disc spins with its accreted colours, you **imprint the name on the label**
(it updates live as you type), and the modal states exactly **which version is banked** —
always the *approved* track; an un-judged pitch on Deck B is left off
(`engine.renderCommitted()`). Pick a format — **Arranged track** (the default: a 36-bar
journey, intro → build → peak → kickless strip → peak → outro, with snare builds at the
section turns) or **Loop** (the raw bar as it plays) — confirm, and the record drops into
the crate wearing its approve-rate. From the save prompt, the DJ then rolls a fresh track.

![The pressing modal — the disc with its stuck colours, the name imprinted on the label, and which version is being banked](screenshots/03-press.png)

### 🗃 The Crate — your pressed records

A standalone player and your vault. Every saved track is a full record — vinyl face,
genome snapshot, cover seed, metadata — persisted in `localStorage` and portable via
Export/Import JSON. Spin (the disc rotates while previewing), re-imprint the label, send
to Remix, **export to MP3** (⬇ — a real-time render captured and encoded in-browser), or
delete. Because every track is seeded, a record's code is fully reproducible.

![The crate — pressed records with their coloured rings, key, tempo and hype](screenshots/04-crate.png)

### 🎚 Remix — DJ your own records

Pull a **sleeve** from the shelf and its **disc drops onto the platter**. The record loops
as a bed while you fire one-shot vocal stabs from the vox pads, latch FX overlays
(topline / sweep / stutter / riser), ride the transition fader, and press the result as a
new record.

![The remix console — vox pads on Deck A, the record spinning on Deck B](screenshots/05-remix.png)

---

## Run it

Static site, **no build step** — just serve the folder over HTTP (audio and ES features
want a real origin, not `file://`):

```bash
python serve.py 8124        # preferred: sends Cache-Control: no-store
# then open http://localhost:8124
```

> **Why `serve.py` and not `python -m http.server`?** The stdlib server sends no
> cache headers, so browsers heuristically cache `src/*.js` and keep serving *old* code
> after you edit — you refresh and hear the previous build. `serve.py` disables caching.
> If you use the plain server, keep DevTools open with **Network → Disable cache** ticked.

Click **▶ Start the set** (a click is required to unlock browser audio). First load pulls
the Strudel engine + a drum kit from the CDN, so you need to be online the first time.

### Deploy (GitHub Pages)

Because it's a build-free static site, GitHub Pages serves it as-is. One-time setup:
**Settings → Pages → Source: Deploy from a branch → `master` → `/ (root)` → Save**. Every
push then publishes to `https://<user>.github.io/<repo>/`. No workflow, no build.

---

## How the DJ thinks

The engine (`src/dj.js`) keeps the track as a **genome** — which layers are on, each
layer's variant, per-lane FX/double flags, a fill, an energy gene and a drum-machine gene.
The Live set drives it turn-based: `proposeChange()` applies one weighted mutation for you
to judge, `acceptChange()` keeps it, `rejectChange()` reverts it and bans the idea for the
song (killed *reworks* are only spaced out, so the session never dead-ends). The console's
genre/density/part-mixer state biases the candidate weights.

The engine also keeps the sound genre-honest as it builds: trap and drill open with the
808 already seeded (drill's slides via a patterned pitch envelope), lo-fi and boom bap
drums swing, the lead is always filtered, and **energy ramps with the part count** — a
fuller arrangement plays hotter, unlocking busier hats, open-hat accents and lead delay.

Three renders matter:

- `renderAB(mix)` — the committed and proposed versions of the touched lane in one
  balanced `stack(...)`, at gains `(1-mix)` / `mix` (chained `.gain()` multiplies in
  Strudel). This is what the crossfader evaluates.
- `renderCommitted()` — the approved track only, rendered from the pre-pitch snapshot.
  This is what a save banks, always.
- `renderArranged()` — the committed genome as a 36-bar `arrange(...)` journey; the
  pressing modal's "Arranged track" format. This is the shippable render.

The original crowd-fader optimiser (`tick()` — hill-climbing on approval with tabu +
simulated annealing) still lives in the engine and stays test-covered.

---

## Architecture

Plain classic scripts sharing a `window.SDJ` namespace, loaded in dependency order in
`index.html` (`rng → theory → names → dj → viz → log → art → vinyl → menu → app`). No ES
modules — it keeps the thing serverless-simple and robust on Windows.

```
index.html        the four views + the pressing modal + loads Strudel and the modules
serve.py          tiny dev server that disables caching (no stale JS)
styles.css        dark neon club theme: deck rig, console, press modal, crate, remix
src/rng.js        seeded PRNG + helpers (reproducible tracks)
src/theory.js     scales, keys, chord progressions, drum banks
src/names.js      track-title generator
src/dj.js         the brain: genome, proposeChange/accept/reject, renderAB/renderCommitted
src/viz.js        the original dancing-crowd canvas (retired; kept, dormant)
src/log.js        structured, exportable set-log for diagnosing the engine
src/art.js        deterministic generative square covers (the remix shelf's sleeves)
src/vinyl.js      the record itself: deterministic SVG discs, acetates, live labels
src/menu.js       the signal-bloom menu canvas
src/app.js        wiring: decks + crossfader, pressing flow, transport, crate, remix
test/app_test.js  headless jsdom integration test (Strudel audio stubbed, seeded engine)
```

Data flow (Live): `approve/skip → engine genome → render/renderAB → evaluate → audio`,
with the same rendered string driving the code drawer and the pianoroll, and
`SDJ.Vinyl.forLive(...)` drawing the committed genome as the record on Deck A.

Everything the UI can do is also exposed headlessly for agents and tests:
`SDJ.live.approve/skip`, `SDJ.ab.set(mix)`, `SDJ.press.open/confirm/cancel`,
`SDJ.setGenre/setDensity/setOpinion`, `SDJ.remix.*`, `SDJ.exportMp3(i)` and
`SDJ.menuAmbient.start/stop`.

---

## Tests

The app needs no dependencies to run; the suite uses `jsdom` to exercise the wiring end to
end (boot → start → pitch/judge → A/B blending → pressing → crate → remix → export) with
Strudel's audio globals stubbed and the engine seeded so runs are deterministic:

```bash
npm install   # installs jsdom (dev-only)
npm test      # 88 checks
```

---

## Tuning

Most of the "feel" lives in `src/dj.js`:

- `STAGES` — the arrangement layers and the order they build in.
- `proposeChange()` — the candidate moves and their weights (what the DJ pitches).
- `renderAB()` / `renderCommitted()` / `renderArranged()` — the deck blend, the save
  semantics, and the section plan of the arranged track.
- `effEnergyIdx()` — how energy ramps with the build (the floor per part count).
- `MIN_FULL` (in `app.js`) — how full a track must be before the press prompt appears.
- `render()` — the actual Strudel each layer emits (sounds, filters, effects, lane colours).

The **⬇ Log** button in the set history exports the full set trace as JSON — handy for
tuning the engine from real sessions.

---

## Notes / limits

- Drums use a kit loaded from the CDN by `initStrudel()`; the synth layers
  (`sawtooth`/`square`/`triangle`/`sine`) always play, so a track is never silent.
- Generated Strudel is built by string concatenation and is kept **valid and balanced** —
  the test checks paren/quote balance across every render, including mid-fader blends.
- The pianoroll is Strudel's own visualiser (already in the `@strudel/web` bundle) — no
  extra dependency. It's appended only to the *audio* string, never to the saved/shown code.
- Vinyl discs are pure deterministic SVG (`src/vinyl.js`) — same seed, same record,
  everywhere it appears. No assets, no network.
- MP3 export renders the track in real time and encodes it in-browser (lamejs, fetched
  on demand) — so a save is as long as the track, and the encoder loads once per session.
- The screenshots above are captured headless via Playwright (throwaway script, not
  committed).

---

## Licence

This project's own source is **MIT** — see [LICENSE](LICENSE). It loads the
[Strudel](https://strudel.cc) live-coding engine at runtime from a CDN; Strudel is not
bundled or modified here and remains under its own licence (AGPL-3.0).
