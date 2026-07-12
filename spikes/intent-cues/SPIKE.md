# Spike D — Talk to the DJ + Cue Deck

**Stance:** performing a set is *event-based*, not *parameter-based*. The control
surface should be **natural-language intents** (a text box, voice-ready) plus a
**cue deck** of discrete, punchy performance buttons — not a wall of continuous
faders.

---

## (a) Thesis & the performance arc it encourages

Nobody stood behind decks thinks *"set the low-pass to 0.62 and hold it there."*
They think **"drop it,"** **"bring the bass back,"** **"go darker,"** **"double it
up,"** **"let it ride."** Live performance is a sequence of *timed musical events*,
each landing on a beat, each a gesture the crowd can feel. A continuous knob is the
wrong mental model for that: it demands constant attention, asks the operator to
choose a *precise value* nobody can hear as a number, and it has **no concept of
timing** — you cannot "quantise a fader to the next bar." A drop is not a value;
it's an *event*.

So the surface is two complementary halves, both event-shaped:

1. **Intents** — short typed (or spoken) commands parsed *deterministically* into
   engine **moves**. "darker", "more space", "take it to techno", "let it breathe."
   Language is the highest-bandwidth, lowest-attention controller humans own: one
   phrase can move several hyperparameters at once and carries its own vocabulary
   for *nuance* ("a bit darker" vs "way darker") that a single fader throw cannot.
2. **Cue deck** — a grid of discrete one-shot buttons modelled on a real DJ
   controller: **Build 8 · Drop · Half-time · Double-time · Filter Sweep ·
   Reload · Strip Back · Full Send · Darker · Brighter · Let It Ride · More Space.**
   Each fires a *musical gesture*, immediate or **quantised to the next bar/phrase**.

**The arc this encourages** is the shape of an actual set, because the controls are
the verbs of a set:

> *intro (kick + hats) → **"bring the bass"** → **Build 8** (tension ramps over 8
> bars) → **Drop** (strip to kick on the downbeat, then full re-entry) → ride the
> groove → **"darker, more space"** to move the emotional register → **Reload** to
> rewind a phrase that hit → **Full Send** for the peak → **Let It Ride** to lock
> it and bank the banger.*

You *perform* the arc by naming it, one gesture at a time, each landing in time.
The fader camp can only *approximate* this arc by riding a knob and hoping the
autonomous engine reads the ramp as intent — indirection where we want authorship.

---

## (b) Intent vocabulary (command → synonyms → engine move)

Parser is **plain keyword/synonym matching** — no LLM, no network. It lowercases
the input, strips punctuation, scans for known **trigger tokens** (and multi-word
phrases first), and reads optional **intensity modifiers** ("a bit / slightly" →
×0.5, "way / much / really" → ×1.5, "af / as hell" → ×2). First match wins per
axis; multiple axes can fire from one sentence ("darker and more space" → two
moves). Unknown input logs *"didn't catch that — try: darker, drop it, more
space…"* and changes nothing (fail-safe).

| # | Intent | Synonyms / triggers | Engine move |
|---|--------|---------------------|-------------|
| 1 | **darker** | dark, moodier, evil, dirty, minor, menacing | mode → toward `phrygian`/`minor`; `filterBias −`; `energyIdx` unchanged; nudge `tensionTarget +` |
| 2 | **brighter** | bright, happier, uplifting, major, euphoric | mode → toward `major`/`mixolydian`; `filterBias +`; `air` layer favoured |
| 3 | **harder / bigger** | harder, bigger, heavier, more energy, pump it | `energyIdx +1`; `density +`; `swing → 0` |
| 4 | **softer / chill** | softer, chill, relax, mellow, calm, bring it down | `energyIdx −1`; `density −`; favour `chords`/`air` |
| 5 | **bring the bass** | more bass, bass back, low end, drop the bass in | force `active[bass]=on`; `filterBias +` on bass |
| 6 | **more space / dubbier** | more space, spacious, dub, echo, roomy, ambient | `spaceFX +` (room/delay); favour `air`; `density −` |
| 7 | **tighter / dry** | tighter, dry, focus, less reverb, clean | `spaceFX −`; `density +`; trims `air` |
| 8 | **more movement** | more movement, evolve, keep changing, surprise me, less repetitive | `temp +0.3` (widen the hill-climber's search); `variationBias +` |
| 9 | **lock it / let it ride** | lock it, let it ride, hold, keep it, ride | `temp → TEMP_MIN`; freeze mutations (`hold=true`); pushes toward banger lock |
| 10 | **groovier / swing** | groovier, swing it, shuffle, bouncy | `swing → 0.15..0.3` |
| 11 | **straighten** | straighten, four-four, machine, quantised feel | `swing → 0` |
| 12 | **go techno / house / dnb / lofi / trance** | *genre names + slang* (banging→techno, deep→house, jungle/liquid→dnb, sleepy→lofi, hands up/epic→trance) | set `genreTarget`; the DJ re-skins tempo band + drum feel + preferred layers over the next phrase |
| 13 | **faster / slower** | faster, speed up / slower, slow down, half the speed | `bpmTarget ±` within the genre's band (quantised glide, not a jump) |
| 14 | **build it up** | build, build it, ramp, take it up | schedules the **Build 8** gesture (see cue deck) |
| 15 | **drop it** | drop, drop it, here it comes, break it down then drop | schedules the **Drop** gesture (build → break → full re-entry) |
| 16 | **strip it back** | strip, strip back, take it down, just the drums | drop upper layers to kick(+hats); `energyIdx −` |
| 17 | **full send** | full send, everything, max it, all in | all layers on; `energyIdx → max`; `spaceFX` peak flourish |
| 18 | **reload / rewind** | reload, rewind, pull it back, spin back, again | re-fire the last-liked phrase from the top on the next downbeat |

(≥12 requirement comfortably exceeded — 18 intents, several fold onto cues.)

---

## (c) The cue deck (button → gesture → timing)

Discrete, gestural, timed. **Immediate** cues fire on the audio's next safe
boundary (feel-instant); **quantised** cues schedule against the bar/phrase grid so
they land *musically*, exactly like a hardware controller's quantise.

| Cue button | Gesture | Timing |
|------------|---------|--------|
| **Build 8** | Over the next 8 bars: ramp `energyIdx` up, climb `filterBias`, thin then thicken hats, rising `tension`. Arms a natural drop point. | **Quantised** — starts next bar, runs 8 bars |
| **Drop** | On the next downbeat: hard **strip to kick** for 1 bar (the break), then **full re-entry** at peak energy with all previously-active layers. The money moment. | **Quantised** — lands on next phrase downbeat |
| **Half-time** | Halve the perceived tempo feel (kick/clap to half-time pattern), `bpm` untouched. | **Quantised** — next bar |
| **Double-time** | Double-time feel (busier kick/hats, DnB-ish), `bpm` untouched. | **Quantised** — next bar |
| **Filter Sweep** | One-shot rising `filterBias` sweep over 2 bars, then settle. | **Quantised** — next bar |
| **Reload / Rewind** | Re-fire the last-liked phrase from its downbeat (the "spin-back"). | **Quantised** — next downbeat |
| **Strip Back** | Cut to kick (+hats), `energyIdx −`. Instant tension-reset. | **Immediate** (next safe boundary) |
| **Full Send** | All layers on, `energyIdx → max`, FX flourish. Peak. | **Immediate** |
| **Darker** | mode → minor/phrygian, `filterBias −`. | **Immediate** |
| **Brighter** | mode → major/mixolydian, `filterBias +`. | **Immediate** |
| **Let It Ride** | Freeze mutations, `temp → min`; hold current shape (drives toward banger lock). | **Immediate** |
| **More Space** | `spaceFX +`, favour `air`, thin density. | **Immediate** |

Buttons that map 1:1 onto intents (Darker/Brighter/Strip/Full Send/Let It
Ride/More Space) are deliberately **the same move** — the cue deck is the muscle
memory, the text box is the same vocabulary spoken. One mental model, two surfaces.

---

## (d) Mapping table — intents/cues → engine fields, and how the optimiser responds

The engine already exposes the perfect seam: `proposeMutation` **proposes a
change**, auditions it, keeps/reverts on approval. Intents/cues don't fight that —
they **inject moves into the same channel** and/or **bias what the climber proposes
next**. Three interaction modes:

- **NUDGE** — move a *target* the climber optimises around (e.g. `genreTarget`,
  `bpmTarget`, `filterBias`, `swing`, `tensionTarget`). The hill-climber keeps
  running and *steers toward* the new target on its own accepts/reverts. Low
  override, high autonomy.
- **FORCE** — apply an immediate genome edit (e.g. `active[bass]=on`, `energyIdx`
  step, mode swap) as a *pre-approved mutation*: it's applied now and **exempt from
  the revert judge for one trial window** (the operator asked for it — don't let a
  momentarily-dipping crowd undo an intentional gesture). After the grace window it
  re-enters normal optimisation.
- **SCRIPT** — a multi-bar scheduled gesture (Build/Drop/Sweep/Reload) that
  **temporarily suspends** free mutation, runs a fixed timeline, then hands control
  back (see §e).

New latent fields this spike adds to song state (all optional, default-neutral, so
the autonomous engine is unchanged when untouched):

| Field | Range | Set by | Optimiser response |
|-------|-------|--------|--------------------|
| `modeTarget` | scale name | darker/brighter, Darker/Brighter | render() reads it; climber leaves it fixed until re-nudged |
| `filterBias` | −1..+1 | darker/brighter, sweep, bass | added into every layer's `lpf` cutoff in render() |
| `energyIdx` | 0..4 (existing) | harder/softer, Strip/Full Send, Build/Drop | existing accept/revert applies once out of grace |
| `active[]` (existing) | bool×7 | bring-bass, Strip, Full Send | FORCE edit, grace window |
| `swing` | 0..0.3 | groovier/straighten | render() adds a swing to hats/clap |
| `spaceFX` | 0..1 | more-space/tighter, More Space | scales room/delay in render() |
| `density` | −1..+1 | harder/softer, space/tight | scales hat/step counts, degrade |
| `genreTarget` | enum | go-techno/house/… | re-skins tempo band + drum feel over a phrase (NUDGE) |
| `bpmTarget` | int | faster/slower, genre | glides `bpm`→target, quantised (NUDGE) |
| `tensionTarget` | 0..1 | build, darker | Build/Drop gestures read it |
| `temp` (existing) | 0..1 | more-movement (+), Let-It-Ride (→min) | *directly* widens/narrows the existing search |
| `hold` | bool | Let It Ride | when true, `proposeMutation` returns no-op |

**Crucial:** none of these replace the fitness signal. The crowd's *reaction* still
governs accept/revert. Intents set **where** the DJ points; the crowd still decides
**how far** it gets. Authorship + autonomy, not one or the other.

---

## (e) How scripted gestures (Build/Drop) coexist with the hill-climber

A scripted gesture is a **timeline that borrows the render loop for a fixed span**:

1. **Arm** — cue schedules the gesture to *start on the next bar/phrase boundary*
   (quantise). Until then the climber runs normally.
2. **Run** — while active, `proposeMutation` is **suspended** (the gesture owns the
   genome). Each tick advances the gesture's own step function (bar 1 of 8: nudge
   energy; bar 8: arm drop; drop-bar: strip; re-entry-bar: full). The event log
   narrates it ("⏱ Build 8 — bar 3/8").
3. **Hand-back** — at the end, the climber resumes **from the resulting genome as
   its new baseline**, and critically **reads the crowd's approval during the
   gesture as a strong signal**: if the Drop spiked approval, the post-drop shape
   becomes a high-fitness anchor the climber protects (raises the bar for accepting
   anything that moves away from it). So the DJ doesn't just execute your drop — it
   *learns your drop worked* and optimises around it. If the crowd hated it, the
   climber's temperature is already high and it roams to recover, exactly as today.

This is the killer synergy: the human supplies **structure and timing** (the thing
optimisers are worst at — long-horizon musical form), the machine supplies
**local refinement** (the thing humans find tedious — endlessly tweaking one hat
pattern). Neither camp of faders gets this: a knob has no notion of an 8-bar
scripted build that then becomes a learned anchor.

---

## (f) Frictions accepted + hard critique of the rivals

**Frictions I accept:**

- **Discoverability** — a blank text box hides its vocabulary. *Mitigation:* the
  cue deck **is** the visible vocabulary (every core move has a button), plus
  placeholder hints and a "didn't catch that → try…" fallback. The buttons teach
  the words.
- **No sub-bar micro-riding** — you can't smoothly ride a filter by 3% with a cue.
  *I claim that's a feature:* live performers gesture, they don't micro-dose. If a
  slow *evolving* sweep is wanted, that's a **scripted gesture** (Filter Sweep),
  not a hand on a knob.
- **Parse ambiguity** — deterministic matching mis-hears edge phrasings.
  *Mitigation:* fail-safe (unknown = no-op + hint), and cues cover the critical
  moves so language is never the *only* path to a drop.

**Critique of the console (many faders / MIDI-style):** fiddly and **timing-blind**.
It forces the operator to translate a musical wish ("make it darker") into several
simultaneous fader positions, in real time, with no beat-grid — the one thing that
matters live. It maximises attention cost and precision demands while offering *no*
concept of a discrete musical event: **there is no "drop" fader.** It optimises for
studio tweaking, not performance.

**Critique of the vibe-pad (2-D mood pad / continuous field):** vague and
**eventless**. Dragging around an "energy × darkness" plane gives you a fuzzy blend
but can never express *"strip to the kick for one bar then slam everything back on
the downbeat."* It has no vocabulary for structure, no quantise, no timing — it's a
smear where a set needs punctuation. It also can't be *spoken*, so it's not
voice-ready and can't carry nuance ("a bit deeper, but keep it bright on top").

Both continuous camps share the same original sin: **they model a set as a point in
parameter space, when a set is a sequence of timed events.** You cannot
*continuously interpolate* your way to a drop.

---

## (g) Risks

- **Ambiguous / unknown parses** — "sick" (approval? sickly-dark?), "bring it back"
  (reload? bass? energy?). *Mitigate:* curated synonym lists, phrase-before-word
  matching, intensity modifiers, and a visible "interpreted as → …" echo so the
  operator sees the mapping and re-phrases. Fail-safe on miss.
- **Mistimed cues** — a Drop armed just after a downbeat waits ~a full phrase and
  feels laggy. *Mitigate:* show a "next drop point" countdown/indicator; allow a
  "now" modifier to fire on the nearest bar instead of the phrase; keep Strip/Full
  Send immediate for instant recovery.
- **Gesture vs crowd conflict** — the operator scripts a Build while the crowd is
  bleeding out. *Mitigate:* the grace window is *bounded*; after it, the climber's
  rising temperature reasserts and roams to recover. The human can't drive the set
  off a cliff for long.
- **Over-triggering** — mashing cues faster than gestures resolve. *Mitigate:*
  queue depth 1 per axis; a new Build replaces a pending Build; log shows the queue.

---

## (h) If we steal ONE idea from this spike, steal…

> **The quantised, one-shot DROP button — a discrete musical *event*, landed on the
> beat-grid, that the hill-climber then treats as a learned high-fitness anchor.**

Even a fader-first UI should have this one button, because there is *no continuous
control that can produce a drop* — strip-to-kick-then-slam-back is inherently
event-shaped and beat-timed. It's the single most-felt moment in electronic music
and the clearest proof that *some* controls must be gestures, not values. Ship the
Drop and the whole "sets are events" argument arrives with it.
