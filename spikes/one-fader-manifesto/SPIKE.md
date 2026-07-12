# Spike C — "One Fader Is the Point"

*The deliberate contrarian. Read this after the others have made you want a mixing console — then decide whether you still do.*

---

## 0. The one-line version

**The brief asks for the wrong thing.** "One scale isn't enough, we need multi-dimensional
input and on-the-fly hyperparameter tuning" is a request to convert an *autonomous AI DJ*
into a *manually-driven synthesiser with an AI-shaped skin*. Every knob you add transfers a
decision from the machine to the human. The product's entire reason to exist is that the
machine makes the decisions and you only nudge it **as the crowd**. Add the knobs and you
haven't enriched the concept — you've deleted it and shipped a worse Ableton with extra
steps.

The single fader is not a v0 limitation waiting for a v1 console. It is the **spine of the
concept**: minimal input, maximal emergent behaviour, and a cause-and-effect a stranger can
read in four seconds — *"I cheered, it built up; I booed, it tore the track apart to win me
back."* You do not fix a spine by bolting ribs onto the outside.

---

## 1. What the app actually is (so we agree on what we'd be destroying)

Look at `src/dj.js` before deciding it needs more inputs. The engine is **not** a sound
generator with a mood parameter. It is an **online hill-climber with exactly one fitness
function**:

> The whole engine is a hill-climber over the space of arrangements with a SINGLE fitness
> function: sustained crowd approval. Everything the DJ does is in service of maximising that
> one scalar. — `dj.js`, top of file

Each ~1s tick it **proposes a mutation, auditions it for ~2.5s, and keeps or reverts it based
on the *change* in approval** (`tick()` → `proposeMutation()` → accept/revert on `delta`).
A rising `temp` makes an unhappy crowd search *wider* instead of freezing. That is a living
autonomous agent visibly *reasoning under uncertainty*. The fader is not "the input to a
music toy" — it is **the reward signal to a live optimiser**. The human is playing the role
of *the environment*, not the operator.

That distinction is the whole product. Hold it in your head for the rest of this document,
because every competing spike quietly forgets it.

---

## 2. What is LOST the moment you add multi-dimensional control

Adding energy / genre / swing / filter / density knobs looks free — "more control is more
power". It is not free. Here is the bill, itemised.

### 2.1 Identity — you stop being the crowd and become the producer
The pitch is *"an AI that DJs to a crowd, and you are the crowd."* A crowd does not turn a
filter-cutoff knob. A crowd **feels**. The instant the UI exposes `energyIdx`, `swing`,
`lpf`, you are no longer *reacting emotionally* — you are *dialling parameters*. The fiction
collapses. There is no crowd any more; there's a user and a rack. The category the product
occupied ("emotive, ambient, watch-it-work") is vacated, and it lands in the most crowded,
most mature category on earth: the DAW. We will lose that fight.

### 2.2 Agency & wow — the machine stops being the one making decisions
The demonstrable magic is **watching a machine make musical decisions and commit to them**.
`proposeMutation()` deciding, on its own, to *drop the layer it thinks the crowd hates* and
audition the room's reaction — that is the moment people lean in. Every knob you hand the
user is a decision you **take away from the DJ**. Give the user the energy fader and the DJ
no longer "pushes the energy up when the crowd's with it" — the user just did it. The AI is
demoted from *agent* to *autocomplete*. The wow was never "I can control the music." The wow
is **"it's doing this by itself, and I only cheered."**

### 2.3 Cognitive load & the paradox of choice
One fader has **zero learning curve**: up = more, down = less, and the room responds. A
console demands the user know what "swing", "resonance" or "layer density" *do* before they
can steer at all. That is the paradox of choice weaponised against your own onboarding: more
inputs → more deliberation → less delight → the "just vibe with it" magic dies under a
cognitive tax the user never asked to pay. The current control has a **skill floor of nil and
a ceiling of the whole arrangement space** — that ratio is the design win. A console inverts
it.

### 2.4 Demo legibility — the four-second story
A good demo tells a story a stranger reads instantly. One fader: *push up → the room lifts →
the DJ builds → I hold it → it locks in a banger.* That is legible from the back of a room
with the sound off. A wall of knobs has **no narrative** — a stranger watching sees someone
fiddling, and cannot tell what the AI contributed versus what the human did. You have made
the AI's contribution **unprovable**, which for an *AI* product is fatal.

### 2.5 The optimiser dies of a fed gradient
This is the technical kill-shot the other spikes don't cost out. The DJ is interesting
*because it searches* — `temp` rises, it roams the arrangement, accept/revert biases the
walk toward what the room liked. **If the user is turning the knobs, there is nothing left to
search.** You've hand-fed the optimiser its answer, so the hill-climb — the actual AI — has
no job. You will have spent your build budget removing the only novel system in the repo.

---

## 3. Point-by-point rebuttal of the other four directions

Steelman first, in good faith. Then the knock-down.

### 3.1 The maximal mixing console
**Steelman.** Power users want direct control; a console is the honest, maximal expression of
"multi-dimensional input"; every element becomes addressable; it's the most *capable* build.

**Knock-down.** Capability is not the axis this product competes on — **autonomy** is. A
console is a strictly *worse* DAW (fewer features, browser-bound, no MIDI, no automation)
sold to people who, if they wanted a DAW, already have one that's free and better. It maxes
the one dimension where we can only ever lose and zeroes the dimension where we're unique.
And it's self-defeating even on its own terms: the user turning every knob **is** the DJ, so
the "AI DJ" is now a decorative label on a manual mixer. You spent the most effort to build
the least defensible thing.

### 3.2 The 2D vibe-pad (energy × genre, or similar)
**Steelman.** It's still emotional, still low-load, "one gesture", spatial and playful — it
*feels* like steering a vibe, not programming a synth. Arguably the smallest honest step past
one fader.

**Knock-down.** This is the *closest to right* and therefore the most dangerous, because it
smuggles in the fatal move under a friendly UI. The failure is **the second axis's semantics.**
If axis Y is *"genre"* or *"filter"* or *"swing"*, you're back to programming — you've handed
the user a parameter dressed up as a vibe. A vibe-pad is only safe if **both axes are crowd
*emotions*, not track *parameters*.** Get that wrong and it's the console with rounded
corners. (My counter-proposal below is a vibe-pad that gets it right — see §4 — which is why
I'll happily steal the *pad geometry* while rejecting the usual *pad semantics*.)

### 3.3 Intent / cue steering ("build a drop", "bring it down", "take it techno")
**Steelman.** High-level, still delegates the *how* to the DJ, feels like talking to a DJ
over the booth — arguably *more* autonomous, not less, because you state intent and it
executes.

**Knock-down.** Two problems. First, **it makes the human the composer** — "build a drop
now" is an arrangement instruction, and the DJ's arrangement autonomy (the entire
`proposeMutation` brain) is reduced to a command-executor. The room used to *emergently* reach
a drop because approval was high and the hill-climb pushed energy; now the user just ordered
one. You've replaced *emergence* with *remote control*. Second, it's **a UX lie about
capability**: discrete cues imply the DJ understands "techno" vs "house" as concepts — it
doesn't; it's a genome hill-climber. You either fake that (brittle, unravels on the second
try) or build a whole intent-classification layer that isn't the product. Cues feel
autonomous and are the opposite.

### 3.4 The taste-learner (model the individual user's preferences over time)
**Steelman.** Personalised, sticky, "it learns *you*", compounding value, the most obviously
"AI" of the lot.

**Knock-down.** It **already exists** — and rebuilding it as a separate system is redundant.
`approval` is a live EMA of your taste *right now*, and accept/revert is already a
per-session preference learner over the arrangement space. A longer-horizon "taste model" adds
**opacity and lag**: it starts pre-loading what it *thinks* you want, which (a) **breaks the
legible cause-and-effect** — now you can't tell if it built up because you cheered or because
"it remembered you like build-ups", killing the demo's readability from §2.4 — and (b)
introduces a cold-start and a creepy "it's profiling me" note into a product whose charm is
*in-the-moment* responsiveness. It optimises retention metrics at the cost of the live magic
that would earn the retention in the first place.

**Common thread across all four:** each one moves a decision from the DJ to the human, or
adds a subsystem that obscures the clean `cheer → it responds` loop. They differ only in how
politely they do it.

---

## 4. Counter-proposal — the *minimal* enrichment that respects the concept

Concede the honest half of the brief: **one scalar can be too thin.** With the fader pinned,
`proposeMutation` itself notes there's "no fitness gradient — every shape scores equally
badly," so the DJ can only *roam*, not *climb*. Fair. The fix is **not more inputs — it's one
richer input and a far more expressive DJ.** Two moves:

### Move 1 — a 2-axis *crowd emotion* pad (the ONLY control change)

Replace the 1D fader with a **2D pad whose axes are both crowd *feelings*, never track
parameters.** This is the line-in-the-sand version of the vibe-pad:

| Axis | Feeling (what the *crowd* is doing) | NOT (what it must never be) |
|------|--------------------------------------|------------------------------|
| **X — Energy** | flat ⟷ going off | ~~tempo / density / gain knob~~ |
| **Y — Warmth** | hostile/cold ⟷ loving/warm | ~~genre / filter / swing knob~~ |

Both axes are things **a crowd emits**, so the fiction survives — you are still *the room*,
now expressing *how much* and *how kindly*. It is one gesture, still emotional, still
zero-jargon.

**Mapping onto existing engine state (small, surgical):**

```
X (energy, -1..1)  → drives `approval` exactly as the fader does today.
                     It is the fitness signal. Nothing about the hill-climb changes.
                     (In dj.js terms: this is today's `mood`.)

Y (warmth, -1..1)  → biases HOW the DJ searches, not WHAT the user builds:
   warm  → lower `temp` floor + accept/revert leans additive & tonal
           (favour add()/bump() over drops; prefer chords/lead/air layers)
   cold  → raise `temp` + bias toward stripping and harder, sparser shapes
           (favour drop()/energy swings; percussive over melodic)
```

Crucially, **Y never sets a parameter directly.** It shapes the DJ's *disposition* — its
temperature and the shape of the mutations it *chooses to propose*. The DJ still decides
every note. The user has expressed a *mood*, and watched the agent *interpret* it. That is
the concept intact, with genuinely more expressive range. Two emotional axes is the **entire**
budget.

### Move 2 — make the DJ *legibly reason* (this is the real upgrade)

The brief mistakes **"I can't say enough"** for the actual problem, which is **"I can't see
enough."** Right now `tick()` already returns `events` and `state()` already exposes `mode`,
`temp`, `approval`, `hitProgress` — the DJ's entire thought process is *right there* and the
UI barely shows it. **The highest-leverage change in this whole exercise is surfacing the
reasoning that already exists,** turning a black box you nudge into a **glass box you watch
think.** Concretely, a live "DJ's mind" panel showing:

- **Current move** — what it's auditioning right now (`pending.desc`).
- **Confidence / temperature** — how sure vs how much it's gambling (`temp`, inverted).
- **Verdict feed** — *why* it kept or reverted, with the approval delta that decided it.
- **Read of the room** — its current `mode`: *searching / building / locked in*.
- **Banger meter** — `hitProgress` toward locking the set in.

`mockup.html` in this folder demonstrates exactly this. **The wow doesn't come from more
knobs. It comes from watching the machine *want* something and work for it.** Richer output,
not richer input, is where the product's untapped magic actually lives — and it costs almost
nothing because the data is already flowing out of `tick()`.

---

## 5. "The line" — the maximum control you can add before the concept dies

A single rule draws it:

> **You may add inputs the user expresses AS THE CROWD (emotions). You may never add inputs
> that set a musical PARAMETER (energy step, genre, swing, filter, layer, tempo). The DJ must
> remain the sole author of every musical decision.**

Applied:

| Addition | Verdict | Why |
|---|---|---|
| 2nd axis = crowd **warmth/affection** | ✅ **at the line** | still an emotion; biases the *search*, not the score |
| 3rd emotional axis (e.g. "patience") | ⚠️ **over the line in practice** | past 2 axes, load & ambiguity swamp the emergence you're buying |
| Energy / density / tempo knob | ❌ **dead** | user now arranges; DJ demoted to autocomplete (§2.2) |
| Genre selector | ❌ **dead** | a parameter wearing a costume; and the DJ can't truly "understand" genre |
| Intent cues ("drop now") | ❌ **dead** | user becomes composer; emergence → remote control (§3.3) |
| Persistent taste model | ❌ **dead** | breaks the legible in-the-moment loop (§3.4) |
| **Richer reasoning / feedback output** | ✅✅ **build ALL of it** | it's *output*, not control — pure upside, no fiction cost |

**Two emotional input axes, and unlimited feedback output.** Cross either boundary and the
autonomous-AI-DJ is gone; you're left maintaining a browser DAW nobody chose over the one
they already have.

---

## 6. If we steal ONE idea from this spike, steal…

> **The "DJ's mind" panel — surface the reasoning the engine already produces
> (`events`, `pending.desc`, `temp`, `mode`, `hitProgress`) as a live glass-box feed, so the
> user *watches the AI decide* instead of deciding for it.**

It is nearly free (the data already leaves `tick()`), it's the single biggest lift to the
"wow" and the demo, and — unlike every knob — it makes the AI's contribution **visible and
provable** rather than erasing it. If the other spikes ship a console, at least bolt this on,
because it's the only thing that will keep anyone believing there's an AI in there at all.

---

## 7. TL;DR for the synthesiser of these spikes

- The premise is a category error: knobs convert *autonomous DJ* → *manual synth with AI
  branding*, and we lose on identity, agency, wow, load, and legibility.
- Every competing direction moves a decision from the machine to the human, or clouds the
  clean `cheer → it responds` loop.
- Concede one point only: one scalar can be thin. Answer with **one richer emotional input
  (2-axis energy × warmth, both crowd feelings)** and a **much more expressive, legibly-
  reasoning DJ** — *not* more controls.
- **The line: two emotional axes in, unlimited feedback out. Never a musical parameter.**
- Steal the **glass-box "DJ's mind" panel** — richer *output* is the real upgrade the brief
  was groping for and mislabelled as richer *input*.
