# Spike B — The Vibe Pad

**Stance: lean in, minimalist-latent.** Give the human a *vibe* to steer, not a
console to pilot. Collapse the whole hyperparameter zoo into a low-dimensional
latent space they navigate with their whole hand: one big 2D pad, two macro
knobs, one genre selector. Every point in that pad is a full, curated,
intentional engine state — reached by smoothly interpolating between four
hand-designed corner presets.

---

## (a) Thesis, and the arc it encourages

A DJ set is not a spreadsheet. When you watch a good selector work a room, they
are not turning twelve independent knobs — they are moving one imaginary point
through a space of *feels*: "take it deeper", "lift it", "let it breathe",
"slam it". The skill is knowing where the good regions are and gliding between
them. That is a **2D navigation problem with two seasoning controls**, not a
12-fader mixing-desk problem.

So the interface should *be* that. The user's whole hand rests on a pad. Left is
sparse and calm; right is dense and intense. Down is dark and underground; up is
bright and euphoric. The four corners are four fully-realised club moods. Drag
between them and the sound morphs continuously — never a dead zone, never a
"broken" combination, because every reachable point is a weighted blend of
states we *chose to sound good*.

**The arc this encourages** is the arc of a real set: start low-left (Deep
Room), walk the dot up and right through the night as the room warms, twist
**Tension** to coil a build, then fling the dot into the top-right (Peak Time)
and release Tension for the drop. Bring it back down to breathe. The pad makes
the *narrative of a set* the primary gesture. That is the whole pitch: maximise
**expressiveness per unit of input**, and keep the user in **flow** instead of
in a settings menu.

The pad steers a *vibe*; the hill-climber still sweats the details underneath.
You paint the region, the DJ finds the best track inside it.

---

## (b) The exact axes + macros, and why these

**Pad X — sparse/calm ↔ dense/intense.** This is the single most legible dial of
"how hard is the room going". It fuses *density* (layer count/texture) with
*energy/intensity*. These two co-move in real music — a peak-time track is both
busy and loud; a deep intro is both sparse and gentle — so binding them to one
axis is honest, not lossy. It gives the axis an unmistakable physical meaning:
push right, more is happening.

**Pad Y — dark/underground ↔ bright/euphoric.** The other axis every listener
feels instantly. It fuses *key/mode* (dark modes ↔ bright modes), *filter
openness/brightness*, and *harmonic movement* (brooding triads ↔ lush 9ths). Up
= lift, light, hands-in-the-air. Down = basement, hypnotic, menacing. Together
X and Y span the plane clubbers actually talk in: *how much* and *how bright*.

**Macro 1 — Chaos** (= exploration-temperature). Not a coordinate but a
*seasoning*: how wildly the DJ mutates around wherever you've parked the dot. Low
Chaos = the DJ settles and locks a groove; high Chaos = restless, keeps trying
new shapes. This exposes the engine's most characterful hidden gene (`temp`)
directly to the user without cluttering the spatial metaphor.

**Macro 2 — Tension** (= build ↔ drop). A *temporal* control the pad can't
express, because the pad is a position and tension is a *direction*. Tension
coils and releases: turn it up and energy + filter openness ramp toward a drop
while space tightens (brooding build); snap it back and the room exhales. This
is the one gesture a static position genuinely cannot encode, so it earns its
own knob.

**Genre selector** (house/techno/dnb/lofi/trance). A discrete choice, not a
continuous one — genre changes the *rules of the room* (tempo band, swing feel,
scale palette), so it belongs as a mode switch that nudges the interpolated
vector, not as another axis. (Locked context already says the DJ picks a genre
per track; here the human can override it.)

**Why stop at four controls.** Two axes give a *plane* (∞ points, 2 DOF of
smooth gesture); two macros add the two things a plane can't hold (restlessness,
and time-direction); genre picks the ruleset. That is enough bandwidth to author
a whole set and little enough to hold in one hand. More would trade flow for
fiddle. (See critique in (f).)

---

## (c) Corner anchor presets + interpolation

Four corners, each a **full engine-state vector**. Fields are normalised
targets (0..1 unless noted) that the mapping layer resolves onto the genome and
`render()`.

| field | SW **Deep Room**<br>(sparse·dark) | SE **Warehouse**<br>(dense·dark) | NW **Dub Chamber**<br>(sparse·bright) | NE **Peak Time**<br>(dense·bright) |
|---|---|---|---|---|
| energy | 0.30 | 0.82 | 0.34 | 0.90 |
| density | 0.28 | 0.90 | 0.34 | 0.92 |
| brightness | 0.20 | 0.28 | 0.78 | 0.88 |
| harmony (triad→9th) | 0.15 | 0.10 | 0.55 | 0.80 |
| swing | 0.55 | 0.20 | 0.62 | 0.30 |
| space (dry→washed) | 0.45 | 0.25 | 0.92 | 0.60 |
| repetition (hypno→evolve) | 0.85 | 0.70 | 0.40 | 0.30 |
| tempo (BPM) | 124 | 134 | 122 | 130 |
| layerBias[kick..air] | `1,.5,.95,.2,.55,.25,.7` | `1,.95,.95,.9,.35,.3,.4` | `1,.55,.5,.3,.8,.6,.95` | `1,.9,.85,.8,.9,.9,.75` |

`layerBias` is a per-layer keep-probability *shape* — it says "in this mood, the
bass and air matter, the clap doesn't". It's what makes each corner's *texture*
identifiable, not just its loudness.

**Interpolation = bilinear blend.** For pad position (x,y) with corners at the
unit square, every scalar field is
`lerp(lerp(SW,SE,x), lerp(NW,NE,x), y)`, and `layerBias` is the same blend
component-wise. Because all four corners were authored to sound good and the
blend is convex, **every interior point is a plausible mood** — no cliffs, no
"invalid" combinations. This is the core bet: taste lives in the corners and the
map, so interpolation can be dumb and still always land somewhere musical.

---

## (d) MAPPING TABLE — pad/macro → genome/engine fields → optimiser & render response

| control | abstract field(s) | concrete genome / engine target | render() response | optimiser response |
|---|---|---|---|---|
| **Pad X** (sparse↔dense) | density, energy | `activeCount` target (2..7) via top-N of `layerBias`; `energyIdx` = round(energy·4) | more/fewer layers in the `stack`; `e` scales every layer's gain/cutoff/density | sets the *target layer count*; DJ's add/drop mutations climb toward it |
| **Pad Y** (dark↔bright) | brightness, harmony, mode | target `scaleType` (phrygian…major), `lpfHint` (300..3500 Hz), `harmonyMode` (triads/7ths/9ths) | scale string + filter-cutoff bias per layer; chord voicing width | biases which *variants* score well; DJ reshapes toward the mode's palette |
| **layerBias** (per corner) | which layers belong | ordered keep-probabilities → concrete `active[7]` set | which layers appear at all | shapes *which* add/drop the DJ prefers, so texture matches the mood |
| **Chaos knob** | exploration-temperature | `temperatureTarget` = 0.12 + chaos·0.85 | (indirect — via how often layers churn) | overrides `temp`'s auto-drift: raises mutation width + widens accept band so the DJ roams |
| **Tension knob** | build↔drop | +energy, +brightness, −space as it rises | opens filters, pushes gain, tightens reverb toward a drop | shifts the target upward over time; low tension = target sits low (brooding) |
| **Genre** | ruleset | `tempoBPM` (e.g. dnb→174, lofi→84), swing/scale/harmony nudges | `setcps`, groove feel, palette | re-centres the whole target vector; DJ re-optimises inside the new rules |

The mockup emits exactly this `engineTarget` object live as you drag, so the
contract is concrete, not hand-wavy. Sample outputs (verified by running the
mapping):

- **Deep Room** → 3 layers (kick/bass/air), phrygian, energyIdx 1, lpf 540, repetition 0.95 — a dark hypnotic intro.
- **Warehouse** → 7 layers, harmonicMinor, energyIdx 3, tight swing — a pounding basement track.
- **Peak Time + Tension 0.8** → 7 layers, major, 9th chords, energyIdx 4, lpf 3500 — Tension visibly forced the euphoric drop.
- **Centre + Chaos 0.9 + dnb** → 5 layers, dorian, tempo 174, temperatureTarget 0.89 — restless liquid roller.

---

## (e) How the pad and the hill-climber coexist

**The pad sets a target region; the DJ orbits it.** This is the crucial design
choice and it keeps the engine's soul intact.

Today the fader *is* the fitness. In this spike, the pad instead defines a
**target engine-state vector** `T`, and the optimiser's job becomes: find the
best-scoring track *near* `T`. Concretely:

1. **The pad writes `T`** (activeCount target, energyIdx, scale, temperature,
   etc.) each frame it moves.
2. **Fitness gets a soft anchor term.** Approval is now `crowdApproval −
   λ·distance(genome, T)`. The DJ still hill-climbs, but the landscape is tilted
   so the peak sits inside the region you painted. Move the pad and the peak
   moves; the DJ chases it.
3. **The pad sets *bounds*, the DJ fills in *taste*.** X says "about five
   layers"; the DJ decides *which* five and which variants score best. Y says
   "bright dorian-ish"; the DJ picks the melodic cells. Chaos widens or narrows
   how far it strays from `T`.
4. **Crowd mood is folded into Chaos + a small approval bias.** We don't lose the
   crowd — a cold crowd raises effective temperature (roam harder) exactly as
   today, but now *within* the vibe the user chose.

**Does the DJ drift the dot?** Optionally, as a "ghost": while locked-in and
happy, the engine may nudge the dot a few percent to show where it *wants* to
sit (a faint second dot), which the user can grab or ignore. The user's hand
always wins — grabbing the pad reasserts `T` instantly. This gives the "the DJ
is alive" feeling without ever wresting control away.

Net: the hill-climber is untouched in spirit (still online, still audition-and-
revert, still temperature-driven). We only changed *what it optimises toward*
from "one scalar" to "distance to a rich target the human paints with one hand".

---

## (f) Frictions I accept, and a hard critique of the alternatives

**Frictions I accept:**
- The pad can't reach *every* combination (only the convex hull of four
  corners). Deliberate: unreachable = the ugly regions. If we want a fifth mood,
  we author a fifth anchor, not a fifth axis.
- Two things share each axis (density+energy; brightness+harmony). A power user
  might want them split. I claim 95% of steering wants them *coupled*, and the
  macros/genre catch the rest.
- The taste is front-loaded into corner authoring. If a corner sounds bad, a
  whole quadrant sounds bad. That's a feature: it concentrates the tuning effort
  where it pays off and makes the space *auditable* (four presets to get right,
  not twelve interacting sliders).

**Against the maximal console (Spike: many sliders).** Twelve live sliders is a
mixing desk handed to someone who came to *dance*. It fails three ways:
1. **No flow.** You can't glide a narrative with twelve fingers; you poke one
   slider, evaluate, poke another. The gesture is *bureaucratic*, not musical.
2. **Choice paralysis + invalid combos.** Most of a 12-D cube sounds *bad*
   (9th-chord glitch-crushed lofi at 174 BPM). The console makes the user
   personally responsible for avoiding every landmine; the pad simply never
   contains one.
3. **It buries the taste.** A console says "here are all the parameters, you
   figure out the good regions". But *finding the good regions is the whole
   product*. The console abdicates the one thing worth doing.

**Against the single fader (today).** One fader is honest and elegant but
starved for bandwidth:
1. **One scalar can't author a set.** "More mood" can't say *darker but
   sparser*, or *bright build then drop* — the two independent things every DJ
   does. You get a volume knob on vibe, not a steering wheel.
2. **It offloads all authorship to the optimiser.** With one input the human is a
   spectator nudging fitness; the DJ makes every real decision. That's a demo,
   not an instrument. The pad restores *expressive agency* — your hand's
   position *is* the arrangement's mood — while keeping the optimiser doing the
   grunt work.

The Vibe Pad is the deliberate middle: **more bandwidth than a fader, radically
more flow than a console.** Two continuous DOF you can play like a Kaoss pad,
plus exactly the two extras a position can't express.

---

## (g) Risks

- **Hidden dimensions you can't reach.** Bundling density+energy and
  brightness+harmony means some real states (very dense *but* very dark *and*
  bright-topped) are off-limits. *Mitigation:* choose corners to span the moods
  people actually ask for; add anchors, not axes, if a gap is felt.
- **Interpolation blandness / mush in the middle.** Bilinear blends can smear
  four vivid corners into a grey centre. *Mitigation:* author corners with
  contrast, and consider ease/gamma curves on the blend (pull toward the nearest
  corner) so the centre still commits to a character rather than averaging to
  porridge. The centre sample above (dorian, 5 layers) is still distinctly a
  *thing*, which is the bar.
- **Target vs. autonomy tension.** If λ (the anchor weight) is too high the DJ
  feels leashed and dead; too low and the pad feels ignored. *Mitigation:* make
  λ itself fall out of Chaos — low Chaos = tight leash, high Chaos = loose.
- **Genre nudges fighting the pad.** A big tempo jump (dnb 174) over a "calm"
  pad point can feel contradictory. *Mitigation:* keep genre to tempo + palette,
  let the pad own intensity.
- **Discoverability of the corners.** Users may not realise the corners are
  distinct moods. *Mitigation:* label the corners on the pad (done in mockup),
  and let the ghost-dot demonstrate good regions.

---

## (h) If we steal ONE idea from this spike, steal…

**The corner-anchor latent space: author 3–5 full "sounds-good" engine-state
presets and let the user navigate the smooth blend between them, instead of
exposing raw parameters.** It's orthogonal to how many axes/knobs the final UI
ships — even a one-fader or few-slider design becomes dramatically better if what
the controls move through is a *curated interpolated manifold of good states*
rather than the raw hyperparameter cube. The taste lives in the anchors; the
controls just walk you between them, and you can never land somewhere broken.
