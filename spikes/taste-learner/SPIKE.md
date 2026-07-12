# SPIKE E — "Teach, Don't Tune"

**A devil's-advocate ML spike for Strudel Auto-DJ.**
Stance: the human should *demonstrate* taste, not *dial* it. The machine tunes its own
hyperparameters toward the listener. One of five spikes, deliberately contrarian.

---

## (a) Thesis & the arc

Every other spike in this set hands the human a control surface — a console of a dozen
sliders, a vibe-pad, an intent box. **This is backwards.** We are building on top of an
engine (`src/dj.js`) that is *already an online optimiser*: each tick it proposes a
mutation, auditions it for ~2.5 s, and keeps or reverts it on the **change in crowd
approval**, with a temperature that widens the search when approval is low. It is a
hill-climber. It optimises. **The correct upgrade is not to bolt manual knobs onto an
optimiser — it is to widen what the optimiser optimises, and to reduce the human to a
minimal preference signal.**

The insight everyone else is skating past: **nobody knows what "0.6 swing" sounds like,
but everyone knows whether the current bar slaps.** Taste is dense, high-dimensional, and
mostly tacit. You cannot introspect it onto twelve sliders in real time on a dancefloor.
But you *can* react. A thumbs-up is a cheap, honest, low-latency sample of the true
preference function. Give the optimiser enough of those and it will localise your taste
far more accurately than you could ever hand-place a dozen faders — because it is fitting
the actual manifold, not your lossy verbal model of it.

**The arc — a set that personalises over time:**

1. **Minute 0 (cold-start).** The DJ opens on a broad, safe prior (four curated
   directions, roughly uniform). It plays confidently, not timidly.
2. **Minutes 1–5 (learning).** Every up/down/skip nudges a weight. Exploration is high
   but *structured* — it varies **one direction-group at a time**, so credit is
   assignable. You feel it start to "get" you.
3. **Minutes 5–20 (converging).** Exploration decays. The bandit exploits the arm your
   thumbs keep rewarding. Tracks trend toward *your* pocket: your tempo band, your
   weirdness tolerance, your harmonic appetite.
4. **The banger crate becomes a memory.** Saved tracks are offline preference data. Next
   session the prior is *warm-started* from them — the DJ remembers you. That is the
   payoff no slider console can offer: **a system that is strictly better the longer, and
   the more often, you listen.**

This is the honest realisation of "hyperparameter tuning on the fly." Tuning
hyperparameters is a job for an *optimiser*, not a human hand. We already have the
optimiser. Let it do its job.

---

## (b) The algorithm

### Parameter space — two tiers, and this is the whole game

The tempting move is to let a bandit roam the **raw continuous hyperparameter vector**
(energy · density · genre · tempo · key+mode · harmonic-movement · swing · tension ·
temperature · repetition↔variation · space/FX · weirdness). **Do not do this.** Twelve
continuous dims is a wide, sample-hungry space; a fickle human emits maybe **20–60 usable
labels per set**. You will never fill it. Continuous bandits + sparse noisy reward =
guaranteed non-convergence, and the user watches the DJ flail.

So we **quantise the search into a macro-arm bandit**:

- **Macro-arms (K = 5).** Each arm is a *curated direction* — a coherent, hand-designed
  vector-delta over the hyperparameters, i.e. a musical intent, not a coordinate:

  | Arm | Direction | Moves in hyperparameter space |
  |----|-----------|-------------------------------|
  | `DEEPER`   | hypnotic, stripped, low weirdness | −density, −weirdness, +repetition, +space |
  | `HARDER`   | peak-time energy | +energy, +tempo, +tension, +density |
  | `WEIRDER`  | leftfield, exploratory | +weirdness, +harmonic-movement, +variation |
  | `WARMER`   | musical, melodic, consonant | +chords/lead, −tension, +harmonic-movement |
  | `HOLD`     | exploit — refine current pocket | small variant reshapes only (this is the greedy arm) |

  Curated arms give us **built-in credit assignment** (a thumbs-up lands on the *arm*, not
  on a raw scalar we'd have to disentangle) and a small enough action set that 30-odd
  labels genuinely move the posterior.

- **Within an arm**, the existing per-layer/variant/energy hill-climber does the
  fine-grained work. The bandit chooses the *direction*; `proposeMutation` executes the
  *step*. Clean separation: **bandit = strategy (which way to push the vector), existing
  engine = tactics (how to voice it).**

### Reward signal from the human

We fuse an **explicit** and a **passive** channel into one scalar reward per audition
window:

- **Explicit (strong):** 👍 = +1, 👎 = −1, ⏭ skip = −0.6 (skip is a soft "not this").
- **Passive (weak, always-on):** *dwell* — approval sustained above baseline across the
  window = +0.3; *early skip / mood-fader collapse* = −0.3. This is the reward the
  existing engine already computes as `approval − trialBase`; we reuse it, we don't
  reinvent it.
- **Fused reward** `r = clamp(explicit + 0.5·passive, −1, 1)`, defaulting to the passive
  channel when the human says nothing. **The human is never obliged to click** — silence
  is a (weak) datapoint, not a stall.

### Update rule — name it

**Discounted-reward ε-greedy bandit with optimistic init, over the K macro-arms.**
Per-arm value estimate `Q[a]`, updated on the played arm only:

```
Q[a] ← Q[a] + α · (r − Q[a])          # exponentially-weighted, α ≈ 0.15
```

Selection: with prob. ε explore a non-greedy arm (weighted toward least-recently-tried —
structured, not uniform); else play `argmax Q`. `Q` is initialised **optimistically**
(all arms start attractive) so the DJ *tries everything once* before it commits — the
cheapest, most robust cold-start trick there is.

**Why a bandit and not CMA-ES?** CMA-ES-lite (an evolutionary strategy fitting a Gaussian
over the continuous vector) is the *seductive* choice and I want to argue against my own
richer option honestly: CMA-ES needs a **population** of evaluations per generation to
estimate a covariance. On a live floor you get **one** audition at a time and the reward
is *non-stationary* (taste drifts mid-set) — exactly the regime where CMA-ES's covariance
estimate goes stale and it either collapses variance too early (over-exploits) or thrashes.
A discounted bandit over curated arms degrades gracefully under sparse, drifting,
one-at-a-time feedback. **Bandit for the live signal; keep CMA-ES-lite in the back pocket
as an *offline* refiner over the crate (§d cold-start) where you *do* have a population.**

### Exploration schedule

Decaying ε with a **non-stationarity floor**, so it keeps a pulse for taste-drift:

```
ε(t) = max(ε_min, ε_0 · exp(−t / τ))     ε_0 = 0.5, ε_min = 0.12, τ ≈ 12 audition windows
```

Plus a **surprise trigger**: if the fused reward drops sharply for N consecutive windows
(taste changed, or the floor turned), *bump ε back up* — the same "unhappy ⇒ search wider"
instinct the engine's temperature already encodes. We are generalising that existing
temperature from arrangement-only to the whole arm space.

---

## (c) The human's MINIMAL input surface

Three affordances. That is the entire control rig:

- **👍 / 👎** — "more like this / less like this." One tap. No target, no number.
- **⏭ Skip** — "not this, move on." A soft negative that also forces a fresh direction.
- **(passive) the mood fader we already have** — but demoted from *the controller* to
  *one weak reward channel*. You can ignore it entirely and the DJ still learns from your
  taps and your dwell.

That's it. Compare with a twelve-slider console: the input surface here is **~3 bits per
decision** vs. the console's demand that you continuously hold and update a dozen
continuous quantities you have no felt sense for. The cognitive load asymptotes to *react
when moved, otherwise dance*.

Optional: a single ambient readout — "learning your taste ██████░░░░ 61%" — so the human
*sees* it converging. (The mockup makes this concrete.) No knobs. A progress bar, not a
mixing desk.

---

## (d) The hard problems, each with a concrete mitigation

I am championing this stance, which obliges me to name where it bleeds. Six real ones:

1. **Credit assignment — which knob earned the thumbs-up?**
   *Mitigation:* **curated macro-arms + one-change-at-a-time.** By construction the reward
   attaches to a *direction*, not a raw scalar, and we only vary one arm-group per window,
   so `argmax Q` is honestly attributable. This is the entire reason we refuse the raw
   continuous space.

2. **Exploration vs exploitation on a live dancefloor — you can't A/B in front of a
   crowd.**
   *Mitigation:* **structured, musically-safe exploration.** Explore steps are curated
   arms (all of which sound *intentional*, none sound broken) and are **short** (one
   audition window) with the existing **instant revert** on a reward drop. The floor never
   hears a randomised parameter-soup A/B; it hears a DJ trying a direction and pulling back
   if it dies. Decaying ε means exploration is front-loaded when the floor is most
   forgiving (warm-up), rarest at peak.

3. **Cold-start.**
   *Mitigation:* **optimistic initialisation** (try each arm once) + **warm-start from the
   crate.** Saved bangers are labelled positives; on session start we run a cheap offline
   pass — count which arm-directions each saved track sits closest to, seed `Q` from that.
   New user with an empty crate falls back to a broad, safe uniform prior and a slightly
   longer explore phase.

4. **Reward sparsity / noise from a fickle human.**
   *Mitigation:* **always-on passive channel** (dwell/skip) so *silence still teaches*,
   `α`-smoothing so one grumpy tap doesn't nuke an arm, and **reward fusion** so the
   explicit and passive signals cross-validate. Sparse *explicit* labels are fine when the
   *passive* channel is dense.

5. **Non-stationarity — taste drifts within a set.**
   *Mitigation:* **discounted value estimates** (exponential `α`, so old preference decays)
   + the **ε floor** + the **surprise re-trigger**. A bandit that forgets is a *feature*
   here: the DJ tracks where your head is *now*, not where it was at minute two.

6. **Evaluation — is it learning *me*, or regressing to a bland mean?**
   *Mitigation:* the metric + within-session test in §(e). This is the scariest failure
   mode (§g) and it gets its own measurement, not a hand-wave.

---

## (e) How I'd EVALUATE "it's learning me"

**Primary metric — Preference Alignment Gain (PAG).**
Instrument a rolling mean of the fused reward over the last *W* audition windows,
`R̄_W`. Learning ⇔ **`R̄_W` trends up while ε decays** — reward improves *because the DJ is
choosing better arms*, not because it's playing safe. Report the slope of `R̄_W` over the
set and the **final-third mean minus first-third mean** (`ΔR = R̄_late − R̄_early`). `ΔR > 0`
with shrinking ε is the signature of genuine convergence.

**Guard against the bland mean — Arm Entropy `H(π)`.**
Track the entropy of the arm-selection distribution. **Healthy convergence = falling
`H(π)` toward a *non-uniform, non-degenerate* peak** (it commits to *an* arm, and different
users commit to *different* arms). Two failure signatures to alarm on:
- `H(π) → 0` on the **same** arm for **every** user ⇒ bland-mean collapse (§g).
- `H(π)` stays maximal ⇒ not learning at all (reward too noisy / arms not separable).

**Within-session test — the hold-out probe (the honest one).**
Periodically (every ~8 windows) **inject one deliberately off-preference arm** — the arm
the model currently rates *worst*. If the model has learned, the human's reward on that
probe should be **reliably lower** than on the exploited arm. Formally: over the session,
`mean(r | exploited arm) − mean(r | probe arm) > 0` with the gap *widening* as the set
progresses. This is a live, self-administered discrimination test: **can the model's
ranking predict the human's reaction on unseen choices?** If the gap never opens, the DJ
is *not* modelling this listener — it's along for the ride. (Cost: a handful of
deliberately-worse windows per set. Cheap insurance against fooling ourselves.)

**Offline, across sessions:** replay the crate as a held-out preference set and measure
pairwise ranking accuracy (does `Q` rank saved-banger directions above skipped ones?).

---

## (f) Frictions accepted + hard critique of the manual-control camps

**Frictions I accept, openly:**
- **Latency to delight.** A slider is *instant*; a bandit takes a minute or three of
  labels to localise you. I am trading first-30-seconds control for a better *rest of the
  night*. For a set — a thing that lasts — that's the right trade. For a 20-second demo it
  is not, and I won't pretend otherwise.
- **Opacity.** "Why did it do that?" is harder to answer than with a labelled slider. I
  mitigate with the visible learning readout and the arm names, but I don't eliminate it.
- **Loss of a hard override.** If you want *exactly* 128 BPM in D-minor, a bandit is the
  wrong tool. (Mitigation: keep one escape hatch — a pin. See §g.)

**Critique of the console camp (a dozen sliders):**
It mistakes *legibility* for *usability*. Twelve labelled knobs look controllable and are
cognitively ruinous — you cannot hold twelve continuous intentions while listening and
reacting. Worse, **the labels lie**: "swing 0.6," "tension 0.4," "weirdness 0.7" are
numbers with no stable perceptual referent. You'll fiddle, chase your tail, and end up
where the optimiser would have taken you in a third the taps — except now *you* did the
gradient descent, by hand, badly. **A console asks the human to be the optimiser for a
machine that already is one.**

**Critique of the vibe-pad camp (an XY / 2-D mood pad):**
Better — it's low-dimensional and gestural, and I respect it. But it still asks the human
to *author* a point in a space whose axes the designer chose and named, and it collapses a
rich preference into 2 continuous dims *the human must consciously drive*. My up/down does
strictly less work for strictly more coverage: the pad needs you to know *where* you want
to be; my buttons only need you to know if you like *where you are*. Knowing "do I like
this?" is universal; knowing "I want to be at (0.3, −0.7) in vibe-space" is not. **The pad
is a nicer console. It's still a console.**

**Critique of the intent camp (type/say what you want):**
Highest ceiling, highest cost. Natural-language intent ("make it more like Berlin
after-hours") is expressive but **high-latency, high-friction, and un-gradient-able** —
you can't do smooth online preference descent on sentences, and parsing them needs a model
the "no backend, static, CDN-only" brief forbids. Intent is a great *seed*; it's a poor
*steering wheel*. Fold it in as an optional cold-start prior (map a phrase → an arm-mix),
then hand steering back to the buttons.

**The through-line:** all three manual camps put the human *inside* the optimisation loop
as the tuner. My spike puts the human *outside* it as the objective. That is the correct
place for a person to stand relative to an optimiser.

---

## (g) Risks / failure modes

- **Bland-mean collapse (the big one).** If the reward is too noisy or the arms too
  similar, `argmax Q` drifts to the *safest* arm for *everyone* — the DJ becomes
  inoffensive wallpaper, "learning" nothing person-specific. *Guards:* the Arm-Entropy
  alarm and the hold-out probe (§e); curated arms designed to be **perceptually distinct**
  so reward *can* separate them; per-genre context so "safe" isn't global.
- **Over-exploitation / echo chamber.** Converges too hard, never surprises you, the set
  goes monotonous. *Guard:* the ε floor + the `WEIRDER` arm kept permanently in the action
  set + the surprise-retrigger. Never let ε hit zero.
- **Annoying exploration.** Explore steps that land as jarring on a peak-time floor.
  *Guard:* curated (never-broken-sounding) arms, short windows, instant revert, and
  **explore-budget gated by approval** — explore more when they're forgiving, almost never
  when they're peaking.
- **Reward gaming / feedback pathology.** Human learns the DJ reacts to thumbs and
  over-clicks, distorting the signal. *Guard:* fuse with passive dwell (harder to game than
  buttons) and cap per-window explicit weight.
- **No hard override.** Occasionally the human *does* know exactly what they want. *Guard
  (the one escape hatch I'll allow):* a single **"pin"** — long-press an arm to lock the
  DJ into that direction until unpinned. One override, not twelve knobs. Preserves the
  "outside the loop" philosophy while admitting humans sometimes have a specific ask.

---

## (h) If we steal ONE idea from this spike, steal…

**The macro-arm bandit as the *steering layer* — replace the raw mood fader's role as
"controller" with a tiny ε-greedy bandit over 5 curated musical directions, fed by 👍/👎
and passive dwell.** It is a ~40-line addition on top of the optimiser that already exists
in `dj.js` (`Q[5]`, an `argmax`, an `α`-update, a decaying ε), it needs no backend, and it
converts the app's core promise — "hyperparameter tuning on the fly" — from *the human
doing the tuning* into *the machine tuning toward the human*. Everything else here (CMA-ES
offline, the probe metric, crate warm-start) is gravy on that one bone.

---

*British/NZ spellings used throughout (optimise, behaviour, colour, minimise). No runtime
dependencies introduced; this spike is a position + a self-contained mockup, and touches
no file outside `spikes/taste-learner/`.*
