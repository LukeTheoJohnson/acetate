# SPIKE A — "THE CONSOLE" (lean in, maximal)

> Give the user a producer's mixing desk. Every meaningful hyperparameter gets its own
> labelled, legible control, grouped like a real console channel strip + master section.
> The optimiser keeps running *underneath* — the user sets ranges, targets and locks; the
> DJ explores *within* them. Complexity is the feature.

---

## (a) Thesis & the arc it encourages

The current app hides a rich instrument behind a single mood fader. That fader is a
**thermostat**, not an instrument: you can say "warmer/colder" and hope the autonomous
hill-climber stumbles onto what you meant. The Console rejects that. It says: the human in
front of a live rig does not want to *hint*, they want to **reach out and move the thing**
— open the filter on the drop, swing the hats, throw the lead into a wash of reverb, kick
the genre from lofi to techno — and *hear it happen now*.

The power fantasy is **total, legible, direct control**. You are riding a live board. Your
hands know where the low-pass lives because it is always in the same place. The joy is
*haptic and spatial*: muscle memory over a fixed surface, not hunting through a menu or
divining what two abstract knobs will do this time.

**The arc it encourages** is the arc of a real DJ set, performed *by the user*:

- **Intro** — strip to kick + air, filter down, high space. You *build the tension* by
  hand, layer by layer, because you have per-layer mutes and a master filter.
- **Build** — bring in bass, hats, clap; push energy; close the reverb; nudge harmonic
  movement from triads toward 7ths so the pads get lush. You feel the room lift.
- **Drop** — slam the master filter open, energy to max, tension to "drop", weirdness off,
  swing tight. The whole desk lights up.
- **Breakdown / mutate** — crank exploration-temperature and repetition→variation, sit
  back, and let the optimiser *roam widely within the box you've drawn* while you watch the
  code panel rewrite itself. Then grab the wheel again.

Crucially the DJ never stops working. The Console does not turn the AI off; it turns the AI
into your **session player** — you conduct ranges and accents, it fills in the notes and
keeps climbing crowd approval inside your constraints. Manual expression *and* autonomous
groove, at the same time. That is the ceiling the other spikes cannot reach.

---

## (b) The full control layout

A dark DAW/console surface. Three horizontal zones, top to bottom, mirroring a real desk:
**MASTER SECTION** (global feel), **CHANNEL STRIP** (per-layer), **TRANSPORT & AI** (the
autopilot governor). Every control shows its label, its live value, and — where it maps to
a genome field the AI also touches — a small **LOCK** pip (the user pins it) and a faint
**ghost** indicator showing where the optimiser currently sits within the allowed range.

Legend for how a control couples to the engine:

- **HARD** — control writes the field directly; the AI may not touch that field while set.
- **TARGET/BIAS** — control sets a *centre of gravity*; the AI still mutates around it,
  pulled back toward the target (a soft spring). Unlocked = pure AI. Locked pip = becomes HARD.
- **RANGE** — control is a dual-handle min/max; the AI may only mutate the field inside it.

### Zone 1 — MASTER SECTION (global, always visible)

| # | Control | Type | Range | Default | Couple |
|---|---------|------|-------|---------|--------|
| M1 | **GENRE** | selector (house · techno · dnb · lofi · trance) | 5 presets | house | HARD (re-seeds tempo/groove/scale envelope, see §c) |
| M2 | **TEMPO (BPM)** | fader | 60–180 | 126 | RANGE→HARD when locked; writes `bpm`/`cps` |
| M3 | **KEY** | dial (12 roots) | C…B | seeded | HARD; writes `song.key` |
| M4 | **MODE (dark↔bright)** | fader | phrygian→…→lydian (ordered by brightness) | minor | HARD; writes `song.scaleType` |
| M5 | **ENERGY / INTENSITY** | big fader | 0–100% | 40% | TARGET; biases `energyIdx` |
| M6 | **DENSITY (layers)** | fader | 1–7 active | 3 | TARGET; biases how many layers AI keeps on |
| M7 | **HARMONIC MOVEMENT** | fader | triads → 7ths → 9ths | triads | HARD; writes chord-richness param |
| M8 | **GROOVE / SWING** | knob | 0–66% | 0 | HARD; writes global swing |
| M9 | **TENSION (build↔drop)** | fader | −100 (build) … +100 (drop) | 0 | HARD; master filter openness + FX ducking |
| M10 | **SPACE / FX SEND** | dual knob (reverb, delay) | 0–100% each | rev 25 / dly 20 | HARD; master wet |
| M11 | **WEIRDNESS** | knob | 0–100% | 5% | TARGET; biases glitch/degrade/crush |
| M12 | **REPETITION↔VARIATION** | fader | hypnotic … evolving | mid | governs AI mutation *rate* (see Zone 3) |

### Zone 2 — CHANNEL STRIP (one channel per layer × 7: kick, hats, bass, clap, chords, lead, air)

Each channel is a vertical strip, left→right in arrangement order. Per channel:

| Control | Type | Range | Default | Couple |
|---------|------|-------|---------|--------|
| **MUTE / ON** | toggle | on/off | kick on, rest off | HARD; writes `active[i]` (kick mute disabled) |
| **VARIANT** | stepper ◀▶ | 0…n | 0 | HARD; writes `variant[i]` (was the AI's "reshape") |
| **GAIN** | mini-fader | 0–100% | per-layer | HARD; per-layer gain trim |
| **LOCK** | pip | on/off | off | freezes this channel from *all* AI mutation |
| **AI focus** | pip | on/off | off | when on, AI is *biased to mutate this layer* |

### Zone 3 — TRANSPORT & AI GOVERNOR (the autopilot desk)

| # | Control | Type | Range | Default | Couple |
|---|---------|------|-------|---------|--------|
| A1 | **AUTOPILOT** | 3-way: OFF · ASSIST · AUTO | — | ASSIST | master switch for the hill-climber |
| A2 | **EXPLORATION TEMP** | fader | 0–100% | (AI-driven) | RANGE cap on `temp`; overrides the auto rise |
| A3 | **CROWD MOOD** | the original vertical fader | −1…1 | 0 | fitness the AI climbs (unchanged) |
| A4 | **HOLD / COMMIT** | button | — | — | freeze current genome as a banger candidate |
| A5 | **PANIC (reseed layer)** | button | — | — | reroll variants of all *unlocked* layers |

Everything else on the current app (code panel, event log, viz, crate) stays. The Console
is the input surface that replaces the lone fader.

---

## (c) Hyperparameter → engine mapping table

`g` = `song.genome` (`active[7]`, `variant[7]`, `energyIdx`). Song-level fields:
`song.key`, `song.scaleType`, `song.prog`, `song.bpm`, `song.cps`. New fields the Console
introduces are marked **[new]** and are read by an extended `render()`.

| Control | Writes (engine field) | How the optimiser responds | How render() responds | Range / default |
|---------|----------------------|----------------------------|-----------------------|-----------------|
| **M1 Genre** | `song.genreProfile` **[new]** → sets seeded envelopes for tempo, swing, scale set, sample palette, default density | On genre change, AI *keeps its climb* but its mutation menu is re-weighted (dnb favours breaks/energy; lofi favours degrade + low density). Non-locked targets snap to the genre's defaults. | render() switches drum/sample choices, default BPM window, characteristic patterns per genre | 5 presets / house |
| **M2 Tempo** | `song.bpm`, `song.cps` | RANGE: AI won't push energy in a way that implies tempo it can't reach; locked = untouched | `setcps(bpm/240)` | 60–180 / 126 |
| **M3 Key** | `song.key` | never a mutation target (was already fixed) — now user-driven | `scaleName(key,…)` | 12 roots / seeded |
| **M4 Mode** | `song.scaleType` (index into a *brightness-ordered* scale list) | not mutated; user owns it | `.scale("<key><oct>:<type>")` | phrygian→lydian / minor |
| **M5 Energy** | `energyIdx` via TARGET spring | AI still bumps `energyIdx` ±1, but proposals are biased toward the target bucket; reverts if crowd disagrees | drives all the existing `e`-scaled gains/cutoffs/densities | 0–100% / 40% |
| **M6 Density** | `densityTarget` **[new]** (desired `activeCount`) | add/drop proposals are gated: below target AI prefers *add*, above target prefers *drop*. Kick always on | more/fewer layers in the `stack(...)` | 1–7 / 3 |
| **M7 Harmonic movement** | `song.chordExtension` **[new]** (0=triad,1=7th,2=9th) | not mutated; user owns richness | `Theory.triad()`→extended stacks; chord + bass layers add the extra degree | triad/7th/9th / triad |
| **M8 Groove/Swing** | `song.swing` **[new]** | not mutated | wrap patterns in `.swingBy(swing,4)` (or `.swing`) on hats/clap/lead | 0–66% / 0 |
| **M9 Tension** | `song.tension` **[new]** (−1…1) | AI reads it as a secondary objective: at high +tension it holds/builds rather than roams | master `.lpf` sweep on the whole stack + risers; −tension = filtered-down "build", +tension = "drop" open | −1…1 / 0 |
| **M10 Space/FX** | `song.wetRoom`, `song.wetDelay` **[new]** | not mutated | append `.room()/.delay()` sends on melodic layers; master shimmer | 0–100% each / 25,20 |
| **M11 Weirdness** | `weirdTarget` **[new]** | biases AI toward `.degradeBy/.crush/.gap` mutations when high; toward clean when low | inject `.degradeBy()/.crush()` scaled by weirdTarget | 0–100% / 5% |
| **M12 Repetition↔Variation** | `song.mutationRate` **[new]** | *directly scales TRIAL window / proposal frequency*: hypnotic = long TRIAL, rare mutations; evolving = short TRIAL, frequent | no direct render change (affects churn) | 0–1 / 0.5 |
| **Ch. Mute** | `g.active[i]` | HARD: locked-out of add/drop proposals for that i | layer present/absent | per layer |
| **Ch. Variant** | `g.variant[i]` | HARD when user steps it; AI's "reshape" now = user's ◀▶ | that layer's seeded character | 0…n / 0 |
| **Ch. Gain** | `g.gainTrim[i]` **[new]** | not mutated | multiplies that layer's `.gain()` | 0–100% |
| **Ch. LOCK** | `g.locked[i]` **[new]** | i is removed from *every* mutation menu | unchanged | off |
| **Ch. AI focus** | `g.focus[i]` **[new]** | proposal picker weights toward i | unchanged | off |
| **A1 Autopilot** | `song.autopilot` **[new]** (0/1/2) | OFF: `tick()` proposes nothing (pure manual). ASSIST: proposes only within unlocked/targeted dims. AUTO: today's behaviour, full roam | — | ASSIST |
| **A2 Exploration temp** | caps `song.temp` | overrides the auto `tempTarget` rise with a user ceiling | wider/narrower mutations | 0–100% |
| **A3 Crowd mood** | `approval` EMA (unchanged) | the fitness climbed | — | −1…1 / 0 |

The load-bearing move: **most controls that the AI used to own become TARGET/RANGE
springs, not hard overrides.** So moving Energy to 70% does not *set* `energyIdx=3` and
freeze it — it pulls the optimiser's random walk toward bucket 3 and lets it still find the
*exact* value the crowd likes around there. Locking converts spring → hard clamp.

---

## (d) How manual controls and the hill-climber coexist

Three coupling modes, chosen per dimension so the pairing feels *right* rather than uniform:

1. **HARD (identity + aesthetics the user should own outright):** genre, key, mode, tempo,
   swing, harmonic movement, FX sends, tension, per-channel mute/variant/gain. The AI is
   forbidden from mutating these fields. Rationale: these are *decisions*, not *searches* —
   a DJ who picks D-minor techno at 130 does not want the AI second-guessing the key.

2. **TARGET / BIAS (spring):** energy, density, weirdness. The control sets a centre of
   gravity `x*`. Each tick, after the normal proposal, the engine adds a soft pull:
   `field += k*(x* − field)` folded into the mutation probabilities (below target → prefer
   the mutation that moves toward it). The AI still *searches around* the target and still
   obeys accept/revert on crowd approval — so the user says "roughly this much energy" and
   the AI finds the *sweet spot* near it. This is the best of both: intent + discovery.

3. **RANGE / GOVERNOR (box):** exploration-temperature (cap), tempo (min/max), and the
   Autopilot 3-way + per-channel LOCK/FOCUS. These draw the *box* the search runs in.

**The tick() contract, revised (pseudo):**

```
tick(mood, dt):
  approval = ema(mood)                     # A3, unchanged fitness
  if autopilot == OFF: propose nothing     # pure manual desk
  else:
    dims = allDims - lockedDims            # LOCK removes a dim from the menu
    pick a dim, weighted by FOCUS pips and TARGET error (bigger gap = likelier)
    if dim is TARGET: bias proposal toward x*   (spring)
    if dim is RANGE:  clamp proposal to [min,max]
    audition ~TRIAL(scaled by mutationRate) ; accept/revert on Δapproval  # unchanged core
  render() reads genome + all [new] song fields
```

The genius of the existing engine is that **accept/revert already arbitrates conflicts**:
if the user's TARGET pulls somewhere the crowd hates, the crowd's approval drop reverts it
— the human and the AI negotiate through the *same* fitness signal. We keep that intact and
just constrain *where* the AI is allowed to look. Manual moves are applied instantly
(no audition — the human is the authority for HARD dims); AI moves keep their audition.

Ghost indicators on TARGET/RANGE controls show *where the AI currently sits* inside the
box, so the desk is honest about who's driving each fader right now.

---

## (e) Frictions/tradeoffs I accept — and why the minimalists are wrong

**Accepted frictions:**

- **Surface area.** ~40 controls. First contact is busier than one fader. I accept this:
  spatial permanence *is* the learnability strategy. A mixing desk has hundreds of
  identical strips and pros read it instantly *because* everything has a fixed home. You
  learn a console once; you re-learn "what do these 2 abstract knobs do today?" every session.
- **Build/maintenance cost.** ~9 new engine fields and an extended `render()`. Accepted —
  it is honest wiring, not speculative abstraction, and each field is independently testable.
- **Analysis paralysis risk for newcomers.** Mitigated by AUTOPILOT=ASSIST as the default:
  a beginner can still just ride the mood fader and the AI drives the rest; the desk is
  *available*, not *mandatory*. The floor is as low as the single-fader app; the ceiling is
  vastly higher.

**Hard critique of the "collapse to 2 knobs" camp.** Two macro knobs (say "energy" and
"vibe") feel elegant in a screenshot and *lie* in use. A macro knob is a fixed blend the
designer baked; the moment the user wants "more energy but *keep* it dark and hypnotic",
the macro has already coupled brightness and variation into "energy" and there is no way
out. You have traded **legibility for compression** and handed authorship back to the
designer. The user cannot form muscle memory over a knob whose meaning is a moving average
of six things. It demos well and ceilings hard.

**Hard critique of the "keep one fader" camp.** One fader is not control, it is *voting*.
You nudge mood and *pray* the hill-climber infers intent from a scalar. Watch the engine:
with the fader low there is "no fitness gradient… the DJ must roam" — i.e. the user's only
tool produces **undirected flailing** by design. You cannot say "open the filter", "go
techno", "bring the bass in *now*". For an instrument whose whole pitch is *performing a
live set*, shipping a single vote is shipping a spectator seat. Minimalism here optimises
the wrong metric — first-5-seconds simplicity — at the cost of the entire expressive reason
the app exists.

Both camps are really arguing that users are fragile. The Console argues the opposite: give
them the board, default the autopilot on, and let the ambitious ones *reach in*.

---

## (f) Risks

- **Render complexity / valid Strudel.** More fields → more string concatenation → more
  chances to unbalance parens/quotes. Mitigation: keep `render()`'s per-layer builders pure
  and unit-test balance across the (now larger) state space, per CLAUDE.md.
- **Control/AI thrash.** A TARGET fighting the crowd could oscillate. Mitigation: springs
  are soft (`k` small), and `mutationRate`/TRIAL rate-limit churn; ghost indicators expose it.
- **Cognitive overload → abandonment.** Mitigation: progressive disclosure — Master section
  always visible, Channel strip collapsible, ASSIST default hides the governor's teeth.
- **Genre re-seed jarring.** Switching genre mid-track could lurch. Mitigation: genre change
  crossfades defaults over a bar rather than snapping.
- **Touch/mobile.** ~40 controls is desktop-first. Accepted for a "live rig" stance; a
  reduced mobile layout is future work, not this spike's fight.

---

## (g) If we steal ONE idea from this spike, steal…

**The TARGET-spring + LOCK duality: every AI-owned dimension becomes a control the user can
either *nudge* (soft spring — set a centre of gravity and let the optimiser discover the
sweet spot around it) or *seize* (LOCK — hard clamp, AI hands off).** It is the whole
argument in one mechanic: it makes human and AI share the *same* fitness signal instead of
fighting over the wheel, it scales from one dimension to forty without changing the model,
and it turns "manual vs autonomous" from a toggle into a *continuum the user dials per
knob*. Even a two-knob or one-fader design becomes dramatically better the moment its
controls are springs-with-locks instead of hard overrides.
