# Steering the DJ — Design Spike Report

_Five parallel design spikes on the question: **"one crowd-mood fader isn't enough — how should a user steer the DJ across multiple dimensions ('hyperparameter tuning on the fly')?"** Two lean into rich multi-control, two argue against the premise, one offers a third paradigm. Each ships a written position (`SPIKE.md`) and an openable, dependency-free `mockup.html`. This report synthesises them into a recommendation for review._

---

## 0. The hyperparameter space (shared substrate)

The engine hides ~12 latent "knobs" behind a single mood fader. Every spike is really arguing about *which of these to expose and to whom*:

`energy · density (layer count/texture) · genre · tempo · key+mode (dark↔bright) · harmonic movement (triads↔7ths↔9ths) · swing · tension (build↔drop / filter) · exploration-temperature (how wildly the DJ mutates) · repetition↔variation · space/FX · weirdness` — plus the existing **crowd-mood** (the fitness the hill-climber climbs).

Today only crowd-mood is wired. Everything else is autonomous/seeded.

---

## 1. The five spikes at a glance

| Spike | Stance | Control surface | Who tunes the params | Bandwidth | Preserves "AI DJ" agency |
|---|---|---|---|---|---|
| **A · Console** | lean in, maximal | ~40 faders/knobs, DAW channel-strip | **Human, directly** | Highest | ⚠️ Weakest — human becomes the producer |
| **B · Vibe Pad** | lean in, minimal-latent | 1 XY pad + 2 macros + genre | Human paints a region, DJ fills it | High per-input | ✅ Strong |
| **C · One Fader** | devil's advocate (product) | 2-axis *emotion* pad + rich feedback | **Almost nobody** — human emotes | Low (by design) | ✅✅ Strongest — this is its whole thesis |
| **D · Intent + Cues** | different paradigm | Text intents + one-shot cue deck | Human issues *events*, DJ executes | Bursty/gestural | ✅ Strong |
| **E · Taste-Learner** | devil's advocate (ML) | 👍/👎/skip only | **The machine** tunes itself toward you | Minimal input | ✅ Strong (agency stays with DJ) |

Open the mockups to feel them: `spikes/<slug>/mockup.html` (all dependency-free, no audio needed).

---

## 2. The headline finding — they converged

Despite being briefed to disagree, **three spikes independently invented the same primitive**, and a fourth assumes it:

- **A** → "TARGET-spring + LOCK": a control sets a *centre of gravity* the optimiser is pulled toward; lock to seize it hard.
- **B** → "corner-anchor latent manifold": author 3–5 full *good* engine-state presets; the user navigates the smooth blend; you can never land somewhere broken.
- **E** → "curated macro-arms": 5 named musical *directions* (DEEPER/HARDER/WEIRDER/WARMER/HOLD) the optimiser steps along.
- **D** → "NUDGE targets the climber steers toward" (vs FORCE / SCRIPT).

> **The unit of control should be a curated musical _target/direction_ that _biases_ the existing hill-climber — not a raw parameter that _overrides_ it.**

This is the load-bearing conclusion of the whole exercise. It resolves the central tension (bandwidth vs. the AI's agency): the human paints intent, the crowd's approval still arbitrates, the DJ still does the note-level searching and can still surprise you. It also means **the spikes are not mutually exclusive** — A/B/D/E are different *control surfaces over one shared substrate*: "a target vector the optimiser orbits." Pick the surface(s); the plumbing underneath is common.

The lone exception is **A's hard-override mode**, which is the one design that genuinely takes authorship from the DJ — and it's exactly what **C** says is fatal.

---

## 3. The real decision (this is yours to make)

Two forks the spikes can't decide for you:

**Fork 1 — identity: conductor or producer?**
C's argument is the sharpest in the set and deserves a straight answer: the product's magic is *"an autonomous AI DJ, and you are the crowd."* Every hard knob you add moves a decision from the machine to the human and edges the product toward "a worse browser DAW." Do you want the user to feel like:
- a **crowd / conductor** — expresses intent & emotion, the DJ authors the music (B, C, D, E); or
- a **producer** — reaches in and sets values directly (A).

My read: **conductor.** It's the only positioning where this app is differentiated; "browser DAW" is a fight against Ableton you can't win. That rules out A's *hard* mode but keeps A's *spring* idea.

**Fork 2 — what are you optimising for right now: the 20-second demo, or the 20-minute set?**
- **Demo-wow / low floor:** C and E win. C ("watch it think") is nearly free and the most legible from across a room. E gets better the longer it runs — bad for a 20-sec clip, great for retention.
- **Expressive ceiling / performance:** B and D win. A pad you play like a Kaoss pad, plus a **Drop** button, *is* a performance.

These aren't exclusive either — see the layered plan.

---

## 4. Each spike's strongest point and fatal flaw

- **A · Console** — _Strong:_ spatial permanence = real learnability; the TARGET-spring/LOCK duality is the report's best single mechanic. _Fatal:_ hard-override turns the AI into "a decorative label on a manual mixer" (C); ~40 controls is desktop-only and demo-hostile. **Steal:** spring-with-lock coupling (nudge vs seize, _per dimension_).
- **B · Vibe Pad** — _Strong:_ best bandwidth-per-input and flow; curated corners mean every point sounds intentional; composes perfectly with the shared substrate. _Fatal:_ bilinear blend can smear to grey mush in the centre; bundled axes hide some real states. **Steal:** the curated-anchor interpolated manifold.
- **C · One Fader** — _Strong:_ the identity argument, and the insight that the brief confuses _"I can't say enough"_ with _"I can't **see** enough"_ — the DJ's reasoning already flows out of `tick()` and the UI barely shows it. _Fatal:_ concedes one scalar is genuinely too thin, so "keep one fader" alone doesn't satisfy the brief; its own answer is really "a 2-axis pad + feedback." **Steal:** the glass-box **"DJ's mind"** feedback panel (near-free, pure upside — _everyone_ should build this).
- **D · Intent + Cues** — _Strong:_ a set is a sequence of _timed events_; no continuous control can produce a **Drop** (strip-to-kick-then-slam-back is inherently event-shaped); scripted gestures the DJ then treats as a learned anchor is a genuine human+AI synergy. _Fatal:_ deterministic keyword parsing is brittle on the second phrasing; discrete cues imply the DJ "understands" concepts it doesn't. **Steal:** the quantised **Drop** as a discrete, beat-gridded event.
- **E · Taste-Learner** — _Strong:_ the honest realisation of "hyperparameter tuning on the fly" — the machine tunes, the human supplies preference; ~40 lines on top of an engine that's _already_ a hill-climber; rigorous about its own failure modes and how to _measure_ learning. _Fatal:_ latency-to-delight (bad for demos), opacity, and the ever-present bland-mean collapse. **Steal:** the macro-arm bandit as an optional "learn-me / auto-pilot" steering layer.

---

## 5. Recommendation — a layered synthesis, not a winner

Because everything writes one shared "target vector the optimiser orbits," build in layers and stop wherever the value tops out:

**Layer 0 — Foundation (build regardless of which surface you pick).**
1. **Refactor the engine so control = a _target vector_ the hill-climber is biased toward** (A's spring / B's anchor / E's arm all reduce to this). Keep accept/revert on crowd approval as the arbiter, so the human and DJ negotiate through one signal.
2. **The glass-box "DJ's mind" panel** (C) — surface `pending.desc`, `temp`, `mode`, `hitProgress`, and the keep/revert verdict + approval delta. Nearly free, biggest lift to "wow," makes the AI's contribution _provable_.
3. Keep the **editable code panel** (already decided) as the ultimate power-user escape hatch — it's the real "console," so you don't need A's knobs for the 1% who want total control.

**Layer 1 — Primary surface: the Vibe Pad (B).** 2 axes (sparse↔dense, dark↔bright) + 2 macros (**Chaos** = exploration-temperature, **Tension** = build↔drop) + genre selector. Best bandwidth/flow/agency balance. Keep the axes as close to _feel_ as possible to respect C's identity line.

**Layer 2 — Punctuation: a minimal cue deck (D).** At least **Drop**, plus Build 8 / Strip / Full Send. Events the pad structurally cannot express. Quantised to the bar.

**Layer 3 — Optional "Auto-pilot / Learn me" (E).** A toggle that drives the _same_ target vector from 👍/👎 + passive dwell. Composes cleanly because it writes the same substrate; ship it later, behind a switch, for the "it gets better the longer you listen" story.

**What I'd _not_ build:** A's full hard-override console. Take its spring-and-lock _mechanic_ into Layer 0; leave the 40-knob surface. It's the one direction that costs the product its identity for a fight it can't win.

**Sharpest open risk to decide with eyes open:** if Fork 1 lands on "producer," this recommendation is wrong and A becomes right — so answer Fork 1 first.

---

## 6. Suggested next step

If you're happy with the layered synthesis: I'd build **Layer 0 + Layer 1** first (target-vector refactor, DJ's-mind panel, Vibe Pad), which is a complete, shippable, demoable upgrade, then add the Drop cue and the learn-me toggle. Tell me which layers you want, or which single spike to pursue instead, and I'll implement it against the existing engine (keeping it dependency-free, valid/balanced Strudel, and the 7-layer test green).
