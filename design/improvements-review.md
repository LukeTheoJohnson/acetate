# Acetate — Improvements Review

A curated audit of the whole app, grouped by feature area. Every item is a **small-to-medium, localised fix — no rewrites**. Line numbers verified against the working tree on the `integrate/features` branch (2026-07-30).

**How to use this:** each item has an ID (`E-1`, `A-3`, …), a location, the problem, the proposed fix, and `Impact / Effort`. Skim **§0 Top priorities** and the **§7 batch plan** first, then tell me which batches to green-light. Nothing here is implemented yet.

Legend — Impact: **High** (correctness / data-loss / a11y blocker) · **Med** · **Low** (polish). Effort: **S** (≤20 lines, one file) · **M** (a helper or a few sites).

---

## §0 Top priorities (do these first)

The clear wins where a small change removes a real risk or a visible defect.

| # | Item | Why it's first | I/E |
|---|------|----------------|-----|
| S-4 | `saveCrate` swallows quota errors silently (`app.js:756`) | A full crate reports "saved" while the press is **lost** — silent data loss. | High / M |
| S-5 | `loadCrate` doesn't validate/repair corrupt storage (`app.js:836`) | A non-array or bad JSON blob makes the crate read empty **forever** until overwritten. | High / S |
| T-1 | Test omits `menu.js` from the load list (`app_test.js:37`) | Test load order silently diverges from `index.html`; a `SDJ.Menu.*` regression passes CI. | High / S |
| T-8 | `@strudel/web@latest` is unpinned + render-blocking (`index.html:13`) | A CDN publish can break the live app with zero code change — has bitten before. | High / S |
| CSS-1 | No global `:focus-visible` (only 1 rule in the whole sheet, `styles.css:457`) | Keyboard users can't see focus anywhere. One rule fixes it app-wide. | High / S |
| CSS-2 | No `prefers-reduced-motion` (confirmed zero) | Many infinite animations + full-screen visualiser; a real accessibility/comfort issue. | High / M |
| A-1 | Press modal has no `role=dialog` / focus-trap / Esc (`app.js:666`) | Keyboard + SR users can't tell they're in a modal or escape it. | Med / M |
| E-1 | `bucket = Math.round(e*3)` unclamped (`dj.js:685`) | One lowered energy step → `pool[-1]` → `undefined` → throw. Clamp is one line. | Med / S |
| V-1 | `viz.js` shipped but never instantiated (`index.html:341`) | Dead ~210-line fetch+parse every load. Delete one `<script>` tag. | Med / S |
| A-9 | Crate actions keyed by cached positional index (`app.js:869,885`) | A background crate mutation makes a click delete/rename the **wrong** record. | Med / M |

---

## §1 Engine & musical quality — `src/dj.js`, `src/theory.js`

### Correctness / robustness
- **E-1 — Clamp the energy bucket.** `dj.js:685` (also hats `827`, bass `903`). `bucket = Math.round(e*3)` can reach 0 if any energy step drops below ~0.17; `kickPool[bucket-1]` then indexes `[-1]`. Fix: `const bucket = clamp(Math.round(e*3), 1, 3)` once. **Med / S**
- **E-2 — `MELODIC_DOUBLE` hardcodes lane indices 2/4/5.** `dj.js:63-70`. If `STAGES` order ever changes, a double silently transposes the wrong lane (the exact bug the comment warns of). Fix: derive the set from `STAGES` keys (`bass/chords/lead`) or add a boot assertion. **Med / S**
- **E-3 — House lead `degradeBy` is unclamped.** `dj.js:1061`. `0.3 + (0.55 - e)` is safe today but has no ceiling; a future lower energy step drives it toward 1.0 = silent lead. Fix: wrap in `clamp(…, 0, 0.7)`. **Low / S**
- **E-4 — `FILL_NAMES[0]` sentinel leaks `""`.** `dj.js:67,1396`. Unreachable today, but `'dropped in ' + FILL_NAMES[g.fill]` yields `"dropped in "` if `g.fill` is ever 0. Fix: guard or drop the sentinel. **Low / S**

### Pitch-flow / banned-lane logic
- **E-5 — A banned `drop:i` leaves that lane with no pitchable move.** `dj.js:1344-1348`. A kept-but-disliked lane is excluded from reshape/FX/double *and* can't be dropped again → session stalls to "nothing to pitch" early. Fix: when `drop:i` is banned, re-admit the lane to reshape/FX candidacy. **Med / S**
- **E-6 — A "feature" can't un-ban a previously binned add.** `dj.js:1338,1404`. Once `add:i` is banned, the turn flow never re-adds it even if the user raises that lane's mixer. The live opinion path and the turn path disagree. Fix: override the add-ban when `likes(i)`. **Med / S**
- **E-7 — `vprop` increments before the empty-candidates guard.** `dj.js:1315` vs `1373`. A null turn still advances the clock, so `vtabu` spacing quietly expires on turns that produced no pitch. Fix: move `s.vprop += 1` below `if (!cands.length) return null`. **Low / S**
- **E-8 — `vtabu` keyed only by lane collides across kinds.** `dj.js:1398,1422`. A rejected *reshape* spaces out *all* moves on that lane, not just reworks. Fix: key by `kind+layer`, or update the comment to match the broad behaviour. **Low / S**

### Musical variety / genre authenticity
- **E-9 — Half of all leads are single one-bar cells that loop forever.** `dj.js:1033`. `Rng.chance(lr,0.5)` picks a static cell 50% of the time. Fix: bias toward two-bar phrases (`~0.65`) or wrap single cells in a `<cell variant>` alternation. **Med / S**
- **E-10 — One chord voicing for the whole track.** `dj.js:978`. Real productions move voicings per degree. Fix: occasionally build the seq by picking a voicing per progression degree (still deterministic via `chr`). **Med / M**
- **E-11 — `effEnergyIdx` has no top tier.** `dj.js:142`. A full 6–7-lane track plays at the same floor as 5 lanes — the climax never intensifies. Fix: add an `act>=6 ? 4` tier. **Med / S**
- **E-12 — Signature glide/swing pools are tiny (3 each).** `dj.js:896,1053`. Any two drill tracks in a set likely share the same 808 slide — genre reads as a stamp. Fix: expand each glide pool to 5–6 entries. **Low / S**
- **E-13 — Atmosphere drone ignores energy.** `dj.js:1080`. The only lane frozen at `gain(0.1)/lpf(1000)` regardless of build intensity. Fix: scale by `e` like its siblings. **Low / S**
- **E-14 — Metal snare never intensifies.** `dj.js:936-953`. Metal kick goes to double-time 16ths but the snare stays a plain 2&4 — kick/snare intensity mismatch. Fix: add a metal high-bucket snare option (double-time/blast feel). **Med / S**
- **E-15 — House low-energy kick pool is a duplicate.** `dj.js:762`. `'bd*4'` and `'bd bd bd bd'` render identically → zero variety at bucket 1. Fix: give bucket-1 a genuine variant or drop the dupe. **Low / S**
- **E-16 — `walkingSeq` always steps up on a repeated tonic.** `theory.js:236`. `[0,0,6,5]` walks `0→1` twice, mechanically. Fix: alternate the passing tone on `next===root`. **Low / S**
- **E-17 — Boom-bap leads lifted to octave 6.** `dj.js:1029`. Classic boom-bap toplines are mid-register; oct 6 reads as trap/synthwave. Fix: drop `boomBap` from the oct-6 lift set. **Low / S**
- **E-18 — Pentatonic scales get over-stretched voicings.** `theory.js:217-221` × `dj.js:976`. `spread`/`ninth` reach degree `d+9`/`d+8`; on a 5-note scale that's ~1.8 octaves, so boom-bap/lo-fi chords blow out. Fix: cap extension degrees for pentatonic scales, or restrict those voicings to 7-note genres. **Med / M**

### Determinism
- **E-19 — `setGenre` consumes the optimiser's RNG stream.** `dj.js:253`. Switching genre live re-picks bpm/scale from `s.rng`, desyncing every later pick vs a set that didn't switch. Fix: derive `setGenre`'s picks from a dedicated sub-RNG (`Rng.make(seed ^ …)`). **Med / S**

### API clarity / dead-weight
- **E-20 — Inconsistent turn-flow return shapes.** `dj.js:1400,1410,1428`. `proposeChange` returns rich `{desc,layer,dir,kind}`; `acceptChange`/`rejectChange` leak the internal pending snapshot; `steerStep` returns `{desc}` only. Fix: return a uniform `{desc,layer,kind,dir}` (omit internals) from all. **Low / S**
- **E-21 — `state().voteLog` may be `undefined` pre-vote.** `dj.js:1297`. The press-modal approval rate reads it before any vote. Fix: init `s.voteLog = []` in `newSong()`. **Low / S**
- **E-22 — `state().genre` masks an uninitialised song as `'trap'`.** `dj.js:1261`. Fix: return `null`/`'unknown'` when no song, so agents can detect it. **Low / S**
- **E-23 — De-duplicate helpers.** `dj.js:557-628` (four near-identical add-from-`inact` sites) and `443,468` (`droppableIdxs(g).concat(kick)` twice). Fix: `addLane(i, prefix)` and `activeIdxsInclKick(g)` helpers. **Low / M**

---

## §2 Vinyl & visuals — `src/vinyl.js`, `src/visualiser.js`, `src/menu.js`, `src/art.js`, `src/viz.js`

### Dead code / determinism (project convention violations)
- **V-1 — Remove the `viz.js` script tag.** `index.html:341`. `SDJ.Viz` is never instantiated anywhere — a retired crowd canvas still fetched + parsed every load. Fix: delete the `<script>` (keep the file archived). **Med / S**
- **V-2 — `menu.js` seeds its spectrum with `Math.random()` at module load.** `menu.js:30-34`. Menu idle shape differs every load, breaking the project's "seed one-off layouts via `SDJ.Rng`" rule that `visualiser.js` follows. Fix: seed via `SDJ.Rng.make(fixedSeed)`. **Low / S**
- **V-3 — `menu.js` calls `Math.random()` inside the frame loop.** `menu.js:73,89`. The exact "no Math.random in the frame loop" anti-pattern the visualiser was written to avoid. Fix: replace with a cheap `t`-driven hash (`sin(i*12.9898 + t*0.7)`). **Low / S**
- **V-4 — `palette()` cache keyed on `Date.now()`.** `visualiser.js:57`. The one wall-clock seam in an otherwise `t`-driven loop. Fix: pass instance `t` in and throttle on it. **Low / S**

### Performance (animation loops)
- **V-5 — Full-screen scene has no backing-store cap.** `visualiser.js:106,220`. On a 4K display the Visuals overlay fills ~3840×2160×4 of `lighter`-blended gradients every frame with no FPS floor. Fix: cap `full`-mode longest edge (~1600px) independent of DPR, and/or skip a frame when `dt > 33ms`. **Med / M**
- **V-6 — Per-frame gradient + string churn.** `visualiser.js:191,206-214`. `createRadialGradient`/`createLinearGradient` rebuilt every frame; `palCol` builds 192 strings/frame in the 96-bar floor loop. Fix: cache gradients per `(W, palette)` and precompute the palette-string array per refresh. **Med / M**
- **V-7 — `read()` sums the full FFT array once per caller per frame.** `visualiser.js:40`. Up to 4 callers (strip/mini/full + menu) each re-sum the same analyser. Fix: memoise `read()` on a frame token so N callers share one computation. **Med / M**
- **V-8 — `palCol` does `toFixed(3)` on every call.** `visualiser.js:86`. The hottest function; thousands of calls/s. Fix: use `ctx.globalAlpha` + solid `rgb()`, or `(a*1000|0)/1000`. **Low / M**

### rAF / resize / teardown hygiene
- **V-9 — Visualiser mounts aren't wired to window resize.** `app.js:146`, `visualiser.js:106`. Resizing the window or reflowing the sidebar leaves the canvas at its old backing-store size → stretched/blurry until a hide/show. Fix: add the three instances to the resize handler (or a `ResizeObserver` per canvas). **Med / S**
- **V-10 — `getByteTimeDomainData` is given a half-size buffer.** `visualiser.js:37`. `waveBuf` is sized to `frequencyBinCount` (= fftSize/2) but used for time-domain data → half-resolution waveform. Fix: size `waveBuf` to `fftSize`. **Med / S**
- **V-11 — Skip draw when the tab is hidden.** `visualiser.js:376`. `frame()` still does a full `read()` + draw when backgrounded. Fix: short-circuit on `document.visibilityState === 'hidden'`. **Low / S**

### Visual fidelity & robustness
- **V-12 — `uid` collision surface is weak.** `vinyl.js:162`. `uid` uses `marks.length % 97` + name length; Deck A and the press modal for the same song can collide → duplicate SVG `<defs>` ids on one page. Fix: fold `hashStr(marks)` into `uid` instead of the length mod. **Med / S**
- **V-13 — `sub` label (`key · bpm`) isn't length-clamped.** `vinyl.js:191`. Unlike `name` (`.slice(0,22)`), a long scale name spills past the label onto the grooves. Fix: `.slice(0,18)`. **Low / S**
- **V-14 — High lane rings crowd the rim.** `vinyl.js:50`. `radiusFor(lane)=41+lane*6.2`; lane 7 + twin/halo grazes the r≈97 edge. Fix: compress the slope slightly or add an outer clamp. **Low / S**
- **V-15 — Reworks visually repeat every 3 variants.** `vinyl.js:81-91`. Bass halo/air/chord widths use `v % 3`. Fix: spread via a hash (`(v*2654435761>>>0)%5`). **Low / S**
- **V-16 — Idle strip ignores the song palette.** `visualiser.js:132`. `drawStrip` always uses fixed COOL→WARM even during a live set. Fix: build the gradient from the live palette when present. **Low / S**
- **V-17 — `palCol` NaN on an empty palette.** `visualiser.js:78`. Guarded upstream today, but the public-ish helper is itself unguarded. Fix: `if (!n) return <fallback>` at the top. **Low / S**

### Shared constants / de-dup
- **V-18 — `LAYER_HUE` copy-pasted across `vinyl.js` and `art.js`.** `vinyl.js:27`, `art.js:15`. Palette changes must be edited twice. Fix: hoist a single `SDJ.LAYER_HUE`/`SDJ.LANE_HUE` (e.g. in `theory.js`). **Low / S**
- **V-19 — Groove spacing uses two near-equal magic constants.** `vinyl.js:50` (`41 + lane*6.2`) vs `166` (`40 + i*6.4`); lane rings drift ~1.2px off the etched grooves by lane 6. Fix: derive both from one `GROOVE0`/`GROOVE_STEP` pair. **Low / S**

---

## §3 App shell, state & storage — `src/app.js`

### Storage robustness (highest value)
- **S-4 — Surface quota failures.** `app.js:756`. `saveCrate` swallows the exception (`/* quota */`) so a failed press still reports success. Fix: return a boolean; on failure show a chip ("crate full — export & prune") and skip the "saved" confirmation. **High / M**
- **S-5 — Validate + repair corrupt crate storage.** `app.js:836`. `loadCrate` returns `[]` on bad JSON but never clears it, and a valid-but-non-array value slips through to `.map`. Fix: check `Array.isArray`, and `removeItem` on parse failure. **High / S**
- **S-6 — Cache the parsed crate.** `app.js:846-856`. A single `renderCrate` calls `loadCrate()` (full `JSON.parse`) multiple times (sort → render → remix shelf). Fix: cache in a module var, invalidate on `saveCrate`. **Low / M**
- **S-7 — Sanitise imported entries.** `app.js:1115`. `importCrate` only checks `typeof code === 'string'`; a malformed `genome`/`bpm` can crash `renderCrate` or inject unescaped markup. Fix: coerce `bpm` to number, validate `genome` shape (or drop it), cap string lengths, ensure an `id`. **Med / M**

### XSS / escaping
- **S-8 — `entry.bpm` and `when` are interpolated unescaped.** `app.js:876,881`. Every other crate field goes through `escapeHtml`; these two don't, and `importCrate` accepts arbitrary JSON. Fix: `Number(entry.bpm)||'?'`, and treat all imported values as untrusted. **Med / S**
- **S-9 — `escapeHtml` throws on non-strings and misses `'`.** `app.js:2368`. A corrupt numeric field breaks the whole render. Fix: `String(s ?? '')` at entry; add `.replace(/'/g,'&#39;')`. **Low / S**

### Timers / listeners / races
- **S-10 — `enforceSilence` can start overlapping hush loops.** `app.js:601`. Two rapid stops run two 60ms beat chains; `cancelSilence` clears only the last timer. Fix: `clearTimeout(silenceTimer)` at the top, or early-return if already active. **Med / S**
- **S-11 — Delegate the crate click handler.** `app.js:893`. Every render re-binds a listener to every button. Fix: one delegated listener on `el.crate` reading `data-act`/`data-id` from `event.target.closest('button')`. **Low / M**
- **S-12 — rAF-coalesce `sizeRolls` on resize.** `app.js:146`. Reallocates two canvas backing stores on every resize event. Fix: wrap in a single `requestAnimationFrame`. **Low / S**
- **S-13 — `drawRemixTimeline` reallocates the canvas every frame.** `app.js:1492`. `canvas.width = W` 60×/s even when unchanged forces a full clear + realloc. Fix: only reassign on change, else `clearRect`. **Low / S**
- **S-14 — `bindPaddle` can leave a stuck paddle.** `app.js:1690`. Press-drag-off-then-release outside the button can leave `held` set (no window-level release). Fix: one document `mouseup`/`touchend` that releases any held paddle. **Low / S**

### Correctness (stable identity)
- **A-9 — Key crate actions by stable `id`, not cached position.** `app.js:869,885,897`. Rows carry the storage index at render time; a background mutation (import, remix-press unshift) makes a later click hit the wrong record. Fix: resolve `crate.findIndex(id)` at click time. Covers `previewTrack`/`sendToRemix`/`exportTrackMp3`/`renameTrack`/`deleteTrack`. **Med / M**
- **S-15 — `freshTrack` doesn't reset `curLiveApplied`.** `app.js:242`. After a new track, the first mood/tempo edit can be treated as "unchanged" and skipped. Fix: reset `curLiveApplied = { mood:null, tempo:null }`. **Med / S**
- **S-16 — `splitStack` colour regex is over-strict.** `app.js:1255`. Only matches `.color("#…")` (double quotes, no spaces); any render drift un-tags every lane and breaks stem-splitting silently. Fix: allow single/double quotes + inner whitespace; warn when a `.color(` fails to match. **Low / S**

### Error handling
- **S-17 — `ensureAudio` returns `true` even when `initStrudel()` threw.** `app.js:162`. The transport then shows "live" with silence. Fix: on failure set a status and `return false` (leave `started=false`). **Med / S**
- **S-18 — MP3 export on a silent capture throws a generic error.** `app.js:1058`. Fix: `if (!chunks.length) throw new Error('captured no audio — the record was silent')`. **Low / S**

### Agent-native surface
- **S-19 — Live loop isn't fully drivable headlessly.** `app.js:2381`. `SDJ.live.approve/skip` exist but `startSet`/`stopSet` aren't on `SDJ`, so an agent can't start a set (mirroring `SDJ.remix.play/stop`). Fix: expose `SDJ.live.start`/`SDJ.live.stop`. **Med / S**
- **S-20 — Agent methods return no success signal.** `app.js:2380-2397`. `approve`/`skip`/`press.*`/`ab.set`/`setGenre` return `undefined`, so a caller can't tell a no-op (`!running`, unknown genre, not pitching) from a real action. Fix: return a boolean/summary from each; validate `setGenre(id)` against `Theory.GENRES`. **Med / M**

### Dead code / magic values
- **S-21 — De-duplicate the `setcps` split.** `app.js:1006,1223,1240,2313`. Four near-identical blocks parse the first line; the `exportCps` regex (`[0-9.]`) even misses spaced/exponent args. Fix: one `splitCps(code) → {cps, body}` helper. **Low / M**
- **S-22 — Hoist scattered magic numbers.** `app.js` throttles/delays/caps (`150`, `60`, `520`, `1800`, `40`, `0.95`, `0.3`). CLAUDE.md says "~130ms" but code uses 150 (doc drift). Fix: named consts near the top. **Low / S**
- **S-23 — Derive the lane count.** `app.js:674,2104` hardcode `'/7 parts'`. Fix: `(SDJ.STAGES||[]).length`. **Low / S**
- **S-24 — `remixPress` re-implements `pickArtLayer`.** `app.js:1659`. Fix: call `pickArtLayer(genome)`. **Low / S**

### Accessibility (modal + controls)
- **A-1 — Press modal: `role=dialog` + focus-trap + Esc.** `app.js:666`, `index.html:314`. No dialog semantics, Tab escapes behind it, no Esc-to-cancel. Fix: add `role="dialog" aria-modal aria-labelledby`; trap Tab; Esc → cancel. **Med / M**
- **A-2 — Restore focus on modal close.** `app.js:684`. Focus lands on `<body>` after confirm/cancel. Fix: capture `activeElement` in `openPress`, restore it on close. **Low / S**
- **A-3 — Crate icon buttons need `aria-label`.** `app.js:885`. `▶ 🎚 ⬇ ✎ ✕` have only `title` (not reliably announced). Fix: add `aria-label` to each. **Med / S**
- **A-4 — Remix MUTE/SOLO/ARM need `aria-pressed`.** `app.js:1548,1723`. State is conveyed only by a CSS class. Fix: set `aria-pressed` on toggle. **Low / S**
- **A-5 — Disable the A/B switch on stop/save.** `app.js:403`. When the fader is CSS-hidden the checkbox stays keyboard-operable (a dead control). Fix: `el.abSwitch.disabled = !on` inside `showFader`. **Low / S**

---

## §4 Curation parser & directives — `src/curate.js` + wiring in `src/app.js`

- **C-1 — `less`/`drop` are treated as hard bans.** `curate.js:23`. "less bass" removes the lane entirely (user asked to *reduce*); "drop the bass" (a build-up request) bans it — opposite intent. Fix: keep `no/without/kill` as bans; route `less` to a soft de-emphasis (opinion −0.5); reconsider `drop`. **Med / M**
- **C-2 — Bare BPM numbers are ignored.** `curate.js:71,133`. "140" or "at 140" (no "bpm") yields no tempo directive. Fix: fallback `/^\d{2,3}$/` in range 60–200 (after the `808` lane check, which already precedes it). **Med / S**
- **C-3 — Out-of-range BPM is rejected with no receipt.** `curate.js:133`. "50bpm"/"220bpm" produce no chip at all. Fix: clamp instead of reject (`min(200, max(60, n))`) and always emit the chip. **Med / S**
- **C-4 — Add common synonyms.** `curate.js:26-39`. Missing "aggressive/hard/energetic/epic/sad", "chill" as a *mood* (only tempo today), "strip it back", "fuller", "up/down". Fix: extend the three lexicons (NZ spelling). **Med / S**
- **C-5 — "high hat" / "open hat" miss the fold.** `curate.js:68`. `/hi[\s-]?hats?/` catches "hi-hat" but not "high hat". Fix: `/hi(?:gh)?[\s-]?hats?/` and map open/closed hats to lane 1. **Low / S**
- **C-6 — "r and b" never pins R&B.** `curate.js:56,72`. `and` is a clause splitter, so "r" and "b" land in separate clauses. Fix: special-case single-letter adjacency, or don't split `and` between single letters. **Low / M**
- **C-7 — Curation draws from the shared song RNG.** `app.js:2004,2042`. Featuring a lane / re-picking a mood scale advances `s.rng`, so two identical sessions diverge based on *when* the user typed. Fix: draw from a curation-scoped seeded RNG (off `s.seed` + lane). (Same class as **E-19**.) **Med / M**
- **C-8 — Density & genre chips carry no receipt note.** `app.js:2073`. Only ban/feature/mood/tempo get the "— what happened" note; the design says chips are a receipt. Fix: add `notes.density`/`notes.genre`. **Low / S**
- **C-9 — Ban chip ignores the verb used.** `curate.js:112`. "kill the bass" always receipts as "no bass". Fix: echo the matched negator. **Low / S**
- **C-10 — Kick-ban sets the ban key but skips the opinion.** `app.js:1980-1997`. Asymmetric handling for the un-droppable kick. Fix: either don't set `banned['add:0']` or set the opinion too. **Low / S**
- **C-11 — The "no directions recognised" hint is sr-only.** `app.js:2087`, `index.html:30`. That guidance is exactly what a mistyping *sighted* user needs, but it's routed through the visually-hidden `#status`. Fix: surface unrecognised-input as a transient chip / input-border state. (Confirm intent.) **Med / S**
- **C-12 — Memoise `genreLexicon()`.** `curate.js:52`. Rebuilt on every keystroke though the genre set is static. Fix: build once, cache. **Low / S**

---

## §5 Accessibility, CSS & HTML — `styles.css`, `index.html`

### Accessibility (highest value)
- **CSS-1 — Global `:focus-visible`.** Only one focus-visible rule exists (`styles.css:457`); several rules `outline:none` without replacement. Fix: `:focus-visible { outline: 2px solid var(--cool); outline-offset: 2px; }` + a range-input variant. **High / S**
- **CSS-2 — `prefers-reduced-motion`.** Confirmed absent. Many infinite animations (`spin`, `chip-pitch`, `eq`, platters, `feedflash`) + canvas loops. Fix: a reduce block that neutralises animation/transition durations, and gate the JS canvas loops (ties to **V-3/V-11**). **High / M**
- **CSS-3 — `color-scheme: dark`.** `:root` doesn't declare it, so `<select>` popups / range thumbs / scrollbars render in light UA chrome. Fix: `:root { color-scheme: dark; }`. **Med / S**
- **CSS-4 — `.btn:disabled` styling.** No disabled treatment exists, so disabled buttons (`#saveBtn`, `#remixStart`, `#remixSave`) look enabled. Fix: `.btn:disabled { opacity:.45; cursor:not-allowed; }`. **Med / S**
- **CSS-5 — Muted text contrast.** `styles.css:8` `--muted:#8a9099` on `--panel` ≈ 4.0:1 at 9–11px; `--sr-muted:#555a63` ≈ 2.3:1 (fails AA). Fix: lighten `--muted`, reserve `--sr-muted` for non-text. **High / S**
- **CSS-6 — Tiny type floor.** 8–8.5px labels at `styles.css:568,616,652,789,842`. Fix: floor at ~10px / `clamp()`. **Med / S**
- **CSS-7 — Touch targets.** Crate action buttons are 28×28px (`styles.css:359`); "small" buttons under 44px. Fix: `@media (pointer:coarse)` bump to ≥40px. **Med / S**
- **HTML-1 — `role="menu"`/`menuitem` misused for nav.** `index.html:41-46`. Implies app-menu keyboard semantics that aren't implemented. Fix: `<nav aria-label>` + plain links, drop the roles. **Med / S**
- **HTML-2 — Hide decorative emoji from AT.** `index.html:160,177,188,204`. `🗃`, `🎚`, `</>` are read verbatim. Fix: wrap glyphs in `<span aria-hidden="true">`. **Low / S**
- **HTML-3 — `role="radiogroup"` without radio children.** `index.html:116,323`. `.press-format` children are plain buttons. Fix: `role="radio"` + `aria-checked`, or drop the group role for `aria-pressed` toggles. **Med / S**
- **HTML-4 — `#tpStop` (⏹) has no `aria-label`.** `index.html:27`. Fix: `aria-label="Stop playback"`. **Med / S**

### HTML structure
- **HTML-5 — Four `<main>` landmarks (one per view).** `index.html:34,51,174,200`. Invalid — should be one `<main>`. Fix: one persistent `<main>`, switch `<section role="region" aria-label>` inside. **Med / M**
- **HTML-6 — Nav hashes point at non-existent ids.** `index.html:18-21` link `#menu/#live/#crate/#remix` but no element has those ids (JS intercepts; broken for no-JS/AT). Fix: use `<button>`s for the JS-driven view switch, or add matching ids. **Med / M**
- **HTML-7 — Placeholder says "hihats", chips say "hi-hats".** `index.html:164`. Copy inconsistency. Fix: standardise on "hi-hats". **Low / S**

### CSS quality / performance
- **CSS-8 — Consolidate the three scoped palettes.** `styles.css:461,523,690`. `#28c8e0` is re-declared as `--cool`/`--m-cyan`/`--m-violet`/`--rx-cyan`/`--rx-violet`/`--sr-a`; editing the brand cyan touches 6+ sites. Fix: point scoped vars at root tokens (`--m-cyan: var(--cool)`). **Med / M**
- **CSS-9 — "violet" tokens are actually cyan.** `styles.css:462,523` set `--m-violet`/`--rx-violet` to `#28c8e0` while real purple is hardcoded elsewhere (`#a64dff`). Fix: add a real `--violet` token, rename, replace hardcoded purples. **Low / M**
- **CSS-10 — Tokenise near-black surfaces.** `#0c0c16`, `#0b0916`, `#0a0a14`, `#07070f`… scattered raw. Fix: `--surface-0/-1/-2`. **Med / M**
- **CSS-11 — `transition: all` on animated elements.** `styles.css:116,576,586`. Transitions layout props, risking jank. Fix: enumerate (`color, background, box-shadow, opacity`). **Low / S**
- **CSS-12 — Infinite `box-shadow` animation.** `styles.css:129` (`chip-pitch`). Repaints every frame forever alongside the canvases. Fix: animate `opacity` of a pseudo-element glow. **Med / M**
- **CSS-13 — `backdrop-filter` has no fallback/prefix.** `styles.css:39,296`. Fix: `@supports not (...)` solid fallback + `-webkit-` prefix. **Low / S**
- **CSS-14 — Remove dead CSS.** `styles.css:41-48` (`.brand/.logo/.tagline`), `384-393` (`.tp-eq` + `@keyframes eq`), `173-180` partial `.xfade*` (superseded by `.abswitch`). Confirm via grep, then delete. **Low / M**
- **CSS-15 — `--topbar-h` variable.** `styles.css:61,464,505,522` hardcode `calc(100% - 62px)` 4×; a wrapped topbar mis-sizes those views. Fix: a `--topbar-h` custom property (or flex-fill body). **Med / M**
- **CSS-16 — Modernise `.sr-only`.** `styles.css:419`. Deprecated `clip: rect(...)`. Fix: add `clip-path: inset(50%)`. **Low / S**
- **CSS-17 — Responsive sidebar.** `styles.css:273` hard 235px; only one breakpoint (980px) for a dense multi-panel UI. Fix: `clamp()` the sidebar + an intermediate ~700px breakpoint. **Med / M**

---

## §6 Tests, tooling & load order — `test/app_test.js`, `index.html`

- **T-1 — Add `'menu'` to the test load list.** `app_test.js:37`. It's the only script missing vs `index.html:346`, so the test's load order diverges and a `SDJ.Menu.*` boot reference would pass CI. **High / S**
- **T-8 — Pin `@strudel/web` + `defer`.** `index.html:13`. Unpinned `@latest` render-blocking script — a CDN change silently breaks renders. Fix: pin `@x.y.z` and `defer`. **High / S**
- **T-2 — Cover `SetLog.stats()`.** `log.js:56-123`, tested only as `count() >= 1`. The whole diagnostic distillation (mode %, accept/revert rates, dedup, `topMoves`, `mostRepeatedState`) is untested. Fix: push known rows, assert the derived stats. **High / M**
- **T-3 — Cover the `SetLog` ring-buffer + export.** `log.js:39`. The `cap` eviction and `toJSON()`/`download()` round-trip (the point of the ⬇ Log) are untested. Fix: push `cap+10`, assert `count()===cap` + a JSON round-trip. **Med / S**
- **T-4 — Genre-balance loop covers only the newest 4.** `app_test.js:546` runs `rock/metal/house/synthwave`. Fix: extend to all nine `Theory.GENRES` for the loop/mid-fader/arranged triad. **Med / S**
- **T-5 — Assert `MOOD_SCALES ⊆ Theory.SCALES`.** `curate.js:44`. Only a comment enforces it; a scale rename would silently mute mood curation. Fix: a membership test. **Med / S**
- **T-6 — Test parser edges.** `app_test.js:429`. No coverage for empty/whitespace input, BPM clamping/boundaries (59/60/200/201), or conflicting-directive precedence ("no bass, more bass" both orders). These are the bug-prone branches (**C-2/C-3/C-9**). Fix: add focused `Cur.parse` checks. **Med / S**
- **T-7 — Curation determinism + immediacy.** `app_test.js:493`. The seed-only check can't catch the `s.rng` leak (**C-7**); `applyCurationLive` mood/tempo-in-place is unverified. Fix: assert two identically-seeded engines render identically after the same feature; assert mid-set "darker, slower" changes `scaleType`/`bpm` in place. **Med / M**
- **T-9 — Harden `balanced()`.** `app_test.js:52`. Ignores single-quoted strings, so a paren inside `s('bd(3,8)')` would false-fail. Fix: handle single quotes symmetrically. **Med / S**
- **T-10 — Replace fixed `sleep()` with poll-until.** `app_test.js:66,88,…`. ~20 wall-clock sleeps are the dominant flake source. Fix: `await until(() => cond, timeout)` helper. **Med / M**
- **T-11 — Relax exact chip-count asserts.** `app_test.js:432,436,449`. `=== 1`/`=== 4` break when additive receipt chips (**C-8**) are legitimately added. Fix: assert specific chips by kind rather than totals. **Low / S**
- **T-12 — Assert `LANE_NAMES.length === SDJ.STAGES.length`.** `curate.js:10`. Nothing enforces the lane-index coupling; an 8th lane would leave curation blind. **Low / S**

---

## §7 Suggested batch plan (PR-sized groupings)

Each batch is independently shippable and test-covered. Recommended order:

1. **Data-safety & load-order** *(highest ROI, mostly S)* — S-4, S-5, S-7, S-8, S-9, T-1, T-8. *Removes silent data-loss + CDN/test fragility.*
2. **Accessibility pass 1** — CSS-1, CSS-3, CSS-4, CSS-5, A-3, A-4, HTML-4, HTML-2. *One stylesheet block + a handful of labels; big a11y jump.*
3. **Motion & perf** — CSS-2, V-1, V-3, V-9, V-10, V-11, S-12, S-13. *Reduced-motion + drop dead `viz.js` + resize/teardown hygiene.*
4. **Engine robustness** — E-1, E-2, E-3, E-5, E-6, E-7, E-19. *Clamps + banned-lane reconciliation + RNG isolation.*
5. **Musical variety** — E-9, E-10, E-11, E-12, E-14, E-18. *The audible authenticity wins (audition after).*
6. **Curation parser** — C-1, C-2, C-3, C-4, C-5, C-8, C-11 + tests T-5, T-6. *Natural-language robustness + receipts.*
7. **Modal a11y & agent surface** — A-1, A-2, A-5, S-19, S-20. *Focus-trap + headless-drivable live loop.*
8. **Identity & state correctness** — A-9, S-10, S-15, S-16, S-11. *Stable-id crate actions + silence-loop + curLiveApplied.*
9. **Cleanup & tokens** *(low-risk, do anytime)* — S-21/22/23/24, V-18/19, CSS-8/9/10/14/16, E-23, C-12.
10. **Test hardening** — T-2, T-3, T-4, T-7, T-9, T-10, T-11, T-12.

**Deferred / needs a layout call before touching code:** HTML-5 (single `<main>`), HTML-6 (nav as buttons), CSS-15 (`--topbar-h`), CSS-17 (responsive sidebar), CSS-12 (box-shadow → pseudo-element) — these are structural and per your convention I'll confirm the layout intent first.

---

*Total: ~80 items. All localised; no rewrites. Findings verified against source on `integrate/features`.*
