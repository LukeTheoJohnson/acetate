// dj.js — the DJ's brain, as an online optimiser.
//
// The whole engine is a hill-climber over the space of arrangements with a
// SINGLE fitness function: sustained crowd approval. Everything the DJ does is
// in service of maximising that one scalar.
//
// The track is a *genome* (which layers are on, each layer's variant, an energy
// gene and a drum-machine gene). Every trial window the DJ:
//   1. proposes a mutation (add/drop a layer, reshape one, swap the kit, swing
//      the energy, or — when it's been going nowhere — throw a curveball),
//   2. auditions it for a few seconds,
//   3. judges it purely by the change in approval:
//        approval rose  -> accept (keep the mutation),
//        approval fell  -> revert (undo it) — but sometimes gamble and keep it,
//        flat           -> keep exploring.
//
// Two mechanisms stop it getting stuck in a rut (the classic hill-climber trap
// of dropping a layer, adding it back, dropping it again forever):
//   • a TABU list — a just-toggled layer is off-limits for a few proposals, so
//     it can't oscillate on the same element,
//   • simulated-annealing acceptance — while the crowd's cold, the DJ will
//     occasionally keep a move that *lowered* approval to climb out of a local
//     rut, and after a run of flat/rejected moves it throws a curveball (new
//     progression, new kit, new scale colour) for genuine novelty.
//
// A "temperature" rises as approval falls, so a crowd that stays unhappy makes
// the DJ search *harder and wider* instead of shrinking to silence. A happy
// crowd cools it down and the DJ locks the track in — and once it's a full
// track held at high approval, it's a banger: save it and start a fresh song.
//
// The crowd steers on TWO emotional axes (never a musical parameter):
//   • energy (mood)  — the reward the DJ climbs. This is the fitness signal.
//   • warmth         — colours HOW the DJ searches: warm builds & softens,
//                      cold strips & hardens. The DJ still writes every note.
//
(function (SDJ) {
  'use strict';

  const Rng = SDJ.Rng;
  const Theory = SDJ.Theory;
  const Names = SDJ.Names;

  // Arrangement layers. Index 0 (kick) is the floor and never gets dropped.
  const STAGES = [
    { key: 'kick', label: 'the kick' },
    { key: 'hats', label: 'the hi-hats' },
    { key: 'bass', label: 'a bassline' },
    { key: 'clap', label: 'the clap' },
    { key: 'chords', label: 'the chords' },
    { key: 'lead', label: 'a lead melody' },
    { key: 'air', label: 'the atmosphere' },
  ];
  const MAX_STAGE = STAGES.length - 1;

  // Signature colour per layer. Drives the pianoroll's coloured lanes (each
  // sound gets its own hue) and tints the matching code line. Hues mirror the
  // A&R cover art (art.js LAYER_HUE) so a layer reads the same everywhere.
  const LANE_COLORS = ['#f43f7d', '#2ee6d6', '#a64dff', '#ff9a1f', '#2edb8b', '#ff4dd2', '#4da6ff'];

  // Complexity vocabulary beyond the 7 on/off lanes: per-lane FX flags, a
  // per-lane second voice ("double"), and one song-level fill/riser. These let
  // a track get genuinely dense instead of capping at seven elements.
  const FX_BITS = [1, 2, 4, 8];
  const FX_NAMES = { 1: 'delay', 2: 'crush', 4: 'wash', 8: 'width' };
  const FILL_IDX = 7;                        // pseudo-lane for the fill line (maps a code line for A&R)
  const FILL_COLOR = '#c3ccff';
  const FILL_NAMES = ['', 'a riser', 'a snare build', 'an impact'];
  // Lanes whose double is an octave shadow (pure n() melodic voices); the rest
  // get a timing-ghost so we never transpose a sample bank by mistake.
  const MELODIC_DOUBLE = { 2: true, 4: true, 5: true };

  const HIT_SECONDS = 10;     // held approval on a full track before it's banked
  const TRIAL = 2.5;         // seconds the DJ auditions a mutation before judging
  const ACCEPT = 6;          // approval rise (0..100) that counts as a win
  const REJECT = 6;          // approval drop that counts as a rejection
  const WARM = 50;           // at/above this the crowd is with it -> build up
  const LOCK_APPROVAL = 68;  // at/above this on a full track -> lock in
  const MIN_FULL = 6;        // active layers that make a track "full"
  const TEMP_MIN = 0.1;
  const ENERGY_STEPS = [0.25, 0.4, 0.55, 0.7, 0.85];
  const TABU_LIFE = 3;       // proposals a just-toggled layer stays off-limits
  const BORED = 5;           // flat/rejected moves in a row before a curveball
  const BANKS = Theory.DRUM_BANKS;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }
  function n2(x) {
    return Math.round(x * 100) / 100;
  }
  function weightedPick(r, arr) {
    let total = 0;
    for (const c of arr) total += c.w;
    let x = r() * total;
    for (const c of arr) { x -= c.w; if (x <= 0) return c; }
    return arr[arr.length - 1];
  }

  // ---- genome helpers ----------------------------------------------------

  function activeCount(g) {
    let c = 0;
    for (let i = 0; i < g.active.length; i++) if (g.active[i]) c++;
    return c;
  }
  function highestActive(g) {
    let h = 0;
    for (let i = 0; i < g.active.length; i++) if (g.active[i]) h = i;
    return h;
  }
  function inactiveIdxs(g) {
    const r = [];
    for (let i = 1; i < g.active.length; i++) if (!g.active[i]) r.push(i);
    return r;
  }
  function droppableIdxs(g) {
    const r = []; // active layers that aren't the kick
    for (let i = 1; i < g.active.length; i++) if (g.active[i]) r.push(i);
    return r;
  }
  function cloneGenome(g) {
    return {
      active: g.active.slice(), variant: g.variant.slice(),
      energyIdx: g.energyIdx, bank: g.bank,
      fx: g.fx.slice(), double: g.double.slice(), fill: g.fill,
    };
  }
  function restoreGenome(g, snap) {
    g.active = snap.active.slice();
    g.variant = snap.variant.slice();
    g.energyIdx = snap.energyIdx;
    g.bank = snap.bank;
    g.fx = snap.fx.slice();
    g.double = snap.double.slice();
    g.fill = snap.fill;
  }

  // Turn-based sets never pitch energy moves, so intensity ramps with the
  // build instead: a fuller arrangement plays hotter. This is a FLOOR on the
  // energy gene — deepen moves and curveballs can still push it higher, and a
  // stripped-back arrangement falls back to the gene's own level.
  function effEnergyIdx(g) {
    const act = activeCount(g);
    const floor = act >= 5 ? 3 : act >= 3 ? 2 : 0;
    return Math.max(g.energyIdx, floor);
  }

  function DJEngine() {
    this.song = null;
    this.masterSeed = (Math.random() * 1e9) >>> 0;
    this.songCount = 0;
    this.banksLoaded = false; // flipped true by app.js once the kit map loads
    this.genrePref = null;    // null = surprise me; else a Theory.GENRES id to force
  }

  // ---- lifecycle ---------------------------------------------------------

  DJEngine.prototype.newSong = function () {
    this.songCount += 1;
    const seed = (this.masterSeed + this.songCount * 2654435761) >>> 0;
    const rng = Rng.make(seed);

    // Pick genre first so BPM range is genre-correct. Honour a pinned genre if
    // the user chose one; otherwise surprise them.
    const genre = (this.genrePref && Theory.GENRES.find((x) => x.id === this.genrePref))
      || Rng.pick(rng, Theory.GENRES);

    const song = {
      seed,
      rng,
      name: Names.generate(rng),
      key: Rng.pick(rng, Theory.ROOTS),
      scaleType: Rng.pick(rng, Theory.scalesFor(genre)), // mood palette is genre-appropriate
      prog: Rng.pick(rng, Theory.PROGRESSIONS),
      genre: genre,
      bpm: Rng.int(rng, genre.bpmLo, genre.bpmHi),
      // the genome the DJ optimises
      genome: {
        active: [true, false, false, false, false, false, false], // open on the kick
        variant: [0, 0, 0, 0, 0, 0, 0],
        energyIdx: 1, // ENERGY_STEPS[1] = 0.4
        bank: Rng.int(rng, 0, BANKS.length - 1), // which drum machine
        fx: [0, 0, 0, 0, 0, 0, 0],           // per-lane FX bitmask (FX_BITS)
        double: [false, false, false, false, false, false, false], // per-lane second voice
        fill: 0,                             // song-level fill/riser (0 = none, 1..3)
      },
      // optimiser state
      approval: 50,      // fitness: smoothed crowd approval (0..100), starts neutral
      temp: 0.4,         // exploration temperature (0..1)
      trialBase: 50,     // approval when the current mutation was proposed
      trialTime: TRIAL,  // pre-armed so the first tick makes the opening move
      pending: null,     // the mutation under audition (snapshot for revert)
      lastAdded: 0,      // most recently added layer (the likely culprit when disliked)
      hitTimer: 0,       // seconds a full track has been held at high approval
      age: 0,
      warmth: 0,         // crowd warmth (-1..1): biases HOW the DJ searches
      intent: 0,         // density dial (-1..1): strip <-> hold <-> build <-> pile-on
      laneMood: [0, 0, 0, 0, 0, 0, 0], // per-lane opinion (-1..1): granular feedback,
                         // NOT genome — the human's taste per component, never reverted.
                         // >0 protect & feature the lane; <0 strip & drop it.
      lastVerdict: null, // { kind, delta, desc } of the last judged mutation
      verdictSeq: 0,     // bumped each judged mutation so the UI can spot new ones
      rev: 0,            // bumped when a curveball changes a song-level musical param
      propCount: 0,      // proposals made (drives the tabu clock)
      tabu: {},          // layer index -> propCount at which it's free again
      aversion: {},      // layer index -> learned dislike (grows on revert, decays on keep)
      flatStreak: 0,     // consecutive flat/rejected verdicts -> boredom -> curveball
      banksLoaded: !!this.banksLoaded, // snapshot so the pure engine test stays kit-free
    };
    // Trap and drill are nothing without their 808, and rock and metal are
    // nothing without the riff — those genres open with
    // the low end already in, so a skipped pitch can never ship a bass-less track.
    if (genre.id === 'trap' || genre.id === 'drill' || genre.id === 'rock' || genre.id === 'metal') {
      song.genome.active[2] = true;
      song.genome.variant[2] = Rng.int(rng, 0, 5);
    }
    song.cps = song.bpm / 240; // 1 cycle = 1 bar = 4 beats
    this.song = song;
    this._lastSig = null;
    return song;
  };

  // Pin the genre for future tracks and, if one is live, re-skin it in place:
  // keep the arrangement (which layers are on) but re-render every layer in the
  // new style at a genre-appropriate tempo. id '' / null = surprise me (only
  // affects the next fresh track). Returns true if the live track was re-skinned.
  DJEngine.prototype.setGenre = function (id) {
    this.genrePref = id || null;
    if (!this.genrePref) return false;
    const genre = Theory.GENRES.find((x) => x.id === this.genrePref);
    if (!genre || !this.song) return false;
    const s = this.song;
    if (s.genre && s.genre.id === genre.id) return false; // already this genre
    s.genre = genre;
    s.bpm = Rng.int(s.rng, genre.bpmLo, genre.bpmHi);
    s.cps = s.bpm / 240;
    // shift the mood into the new genre's palette when the current colour doesn't
    // belong there (keeps a compatible scale, re-picks an incompatible one).
    const pal = Theory.scalesFor(genre);
    if (pal.indexOf(s.scaleType) < 0) s.scaleType = Rng.pick(s.rng, pal);
    s.rev += 1; // a song-level musical change → shows up in _signature()
    return true;
  };

  // ---- the optimiser -----------------------------------------------------

  // Advance by `dt` seconds given the crowd's `mood` (energy, -1..1) and
  // optional `warmth` (-1..1). Returns { changed, events, hit }: `changed` =>
  // re-evaluate the code, `hit` => the crowd approved a finished track.
  DJEngine.prototype.tick = function (mood, dt, warmth, intent) {
    const s = this.song;
    if (!s) return { changed: false, events: [], hit: false };
    const events = [];
    s.age += dt;
    if (typeof warmth === 'number') s.warmth = warmth;
    if (typeof intent === 'number') s.intent = intent;

    // Fitness signal: a responsive EMA of the crowd's mood, mapped to 0..100.
    // Warmth gently nudges it, but the energy axis is what the DJ climbs.
    const inst = clamp((mood + 1) * 50 + s.warmth * 6, 0, 100);
    s.approval += (inst - s.approval) * 0.25;

    s.trialTime += dt;

    if (s.trialTime >= TRIAL) {
      // ---- judge the mutation we've been auditioning --------------------
      if (s.pending) {
        const delta = s.approval - s.trialBase;
      if (s.pending.opinion) {
        // the human's explicit per-lane steer — kept as-is, never reverted or
        // punished by the crowd-approval judge.
        if (s.pending.desc) { s.lastVerdict = { kind: 'kept', delta: delta, desc: s.pending.desc }; s.verdictSeq += 1; }
        s.flatStreak = 0;
      } else {
        const moves = layerMoves(s.pending.snapshot, s.genome);
        const good = delta >= ACCEPT; // approval clearly rose
        const bad = delta <= -REJECT; // approval clearly fell
        let kind = 'flat';
        if (good) {
          kind = 'kept';
        } else if (bad) {
          // Normally revert. But while the crowd's cold, occasionally *keep* a
          // worse move (probability scales with temperature) to climb out of a
          // rut instead of bouncing straight back to where we were.
          kind = s.approval < WARM && Rng.chance(s.rng, s.temp * 0.45) ? 'gambled' : 'reverted';
        }

        // Learn which layers this crowd wants ON, from the DIRECTION of each
        // change against how approval moved. Adding a layer that cooled the room
        // AND dropping a layer that warmed it both say "they dislike it on", so
        // aversion grows either way and its tabu stretches. That's what breaks
        // the add-it / drop-it / add-it loop: after a couple of rejections the
        // DJ parks that layer and builds the track around it instead.
        if (good || bad) {
          for (let k = 0; k < moves.length; k++) {
            const m = moves[k];
            const dislikedOn = (m.dir > 0 && bad) || (m.dir < 0 && good) || (m.dir === 0 && bad);
            const likedOn = (m.dir > 0 && good) || (m.dir < 0 && bad) || (m.dir === 0 && good);
            if (dislikedOn) {
              s.aversion[m.i] = (s.aversion[m.i] || 0) + 1;
              s.tabu[m.i] = s.propCount + TABU_LIFE * (1 + s.aversion[m.i]);
            } else if (likedOn && s.aversion[m.i]) {
              s.aversion[m.i] = Math.max(0, s.aversion[m.i] - 1);
            }
          }
        }

        if (kind === 'reverted') {
          restoreGenome(s.genome, s.pending.snapshot);
          events.push('↩ crowd cooled on that — undid it');
        } else if (kind === 'gambled') {
          events.push('🎲 rolled with it anyway — chasing a new direction');
        } else if (kind === 'kept' && s.pending.desc) {
          events.push('✅ crowd leaned in — kept it');
        }

        // Boredom builds on flat/reverted moves and resets when something lands.
        s.flatStreak = kind === 'kept' || kind === 'gambled' ? 0 : s.flatStreak + 1;
        if (s.pending.desc) {
          s.lastVerdict = { kind: kind, delta: delta, desc: s.pending.desc };
          s.verdictSeq += 1;
        }
      } // end non-opinion judge
      }

      // ---- temperature tracks approval: unhappy => explore harder -------
      let tempTarget = clamp(1 - (s.approval - 40) / 50, TEMP_MIN, 1);
      // Warmth colours the search: a cold crowd makes the DJ gamble wider
      // (raise the floor); a warm crowd settles it a touch (lower the ceiling).
      tempTarget = clamp(
        tempTarget + Math.max(0, -s.warmth) * 0.15 - Math.max(0, s.warmth) * 0.1,
        TEMP_MIN,
        1
      );
      s.temp += (tempTarget - s.temp) * 0.4;

      // ---- propose the next mutation (never stall) ----------------------
      const mut = proposeMutation(s, this.banksLoaded);
      s.pending = mut;
      s.trialBase = s.approval;
      s.trialTime = 0;
      if (mut.desc) events.push(mut.desc);
    }

    // ---- banger detection: full track held at high approval -------------
    const full = activeCount(s.genome) >= MIN_FULL;
    const gate = s.approval >= LOCK_APPROVAL && full;
    s.hitTimer = gate ? s.hitTimer + dt : Math.max(0, s.hitTimer - dt * 2);
    const hit = s.hitTimer >= HIT_SECONDS;

    // Re-render only when the genome actually changed.
    const sig = this._signature();
    const changed = sig !== this._lastSig;
    if (changed) this._lastSig = sig;

    return { changed, events, hit };
  };

  // A stable signature for a mutation, so the tabu list can spot an immediate
  // repeat and steer around it.
  function tabuFree(s, arr) {
    const free = arr.filter((i) => !((s.tabu[i] || 0) > s.propCount));
    return free.length ? free : arr; // never stall — fall back to the full set
  }
  function isTabu(s, i) {
    return (s.tabu[i] || 0) > s.propCount;
  }
  function markTabu(s, i) {
    s.tabu[i] = s.propCount + TABU_LIFE;
  }

  // Which layers a mutation changed, and in which direction: +1 turned on,
  // -1 turned off, 0 reshaped. Diffed from the pre-mutation snapshot, so the
  // judge can learn which layers the crowd actually wants on.
  function layerMoves(snap, g) {
    const out = [];
    for (let i = 0; i < g.active.length; i++) {
      if (snap.active[i] !== g.active[i]) out.push({ i: i, dir: g.active[i] ? 1 : -1 });
      else if (snap.variant[i] !== g.variant[i]) out.push({ i: i, dir: 0 });
    }
    return out;
  }

  // A curveball: a deliberately big, genuinely-different move for when the DJ
  // has been going nowhere. It changes the song's *character*, not just which
  // layers are on, so the search escapes whatever rut it circled into.
  function curveball(s, banksLoaded) {
    const g = s.genome;
    const r = s.rng;
    const roll = Rng.int(r, 0, 3);
    if (roll === 0) {
      s.prog = Rng.pick(r, Theory.PROGRESSIONS);
      s.rev += 1;
      return '🎲 flipped the chord progression';
    }
    if (roll === 1 && banksLoaded && BANKS.length > 1) {
      g.bank = (g.bank + 1 + Rng.int(r, 0, BANKS.length - 2)) % BANKS.length;
      return '🎲 grabbed a different drum machine — ' + BANKS[g.bank];
    }
    if (roll === 2) {
      // reshape two layers at once for a real shift in feel
      const d = droppableIdxs(g);
      if (d.length) g.variant[Rng.pick(r, d)] += 1 + Rng.int(r, 0, 3);
      if (d.length > 1) g.variant[Rng.pick(r, d)] += 1 + Rng.int(r, 0, 3);
      return '🎲 reworked the groove from the ground up';
    }
    s.scaleType = Rng.pick(r, Theory.scalesFor(s.genre));
    s.rev += 1;
    return '🎲 shifted the mood — new scale colour';
  }

  // Deepen the arrangement without adding a lane: an FX flag, a doubled voice,
  // or a fill. This is where "more complexity" comes from once the seven lanes
  // are mostly in — the track thickens instead of capping out. Returns a desc
  // (or null if there's genuinely nothing left to deepen).
  function deepen(s) {
    const g = s.genome, r = s.rng;
    const act = droppableIdxs(g).concat(g.active[0] ? [0] : []);
    const roll = Rng.int(r, 0, 3);
    if (roll === 0) {
      const opts = act.filter((i) => FX_BITS.some((b) => !(g.fx[i] & b)));
      if (opts.length) {
        const i = Rng.pick(r, opts);
        const bit = Rng.pick(r, FX_BITS.filter((b) => !(g.fx[i] & b)));
        g.fx[i] |= bit;
        return '✨ ' + FX_NAMES[bit] + ' on ' + STAGES[i].label;
      }
    }
    if (roll <= 1) {
      const opts = act.filter((i) => !g.double[i]);
      if (opts.length) { const i = Rng.pick(r, opts); g.double[i] = true; return '➿ doubled ' + STAGES[i].label; }
    }
    if (g.fill === 0) { g.fill = Rng.int(r, 1, 3); return '🎆 dropped in ' + FILL_NAMES[g.fill]; }
    if (act.length) { const i = Rng.pick(r, act); g.variant[i] += 1 + Rng.int(r, 0, 2); return '🔀 reshaped ' + STAGES[i].label; }
    return null;
  }

  // Strip complexity: pull the fill, undo a double, clear an FX — the "less"
  // end of the density dial (and how a cold crowd hardens). Returns null when
  // there's nothing left to strip, so the caller can drop a whole lane instead.
  function simplify(s) {
    const g = s.genome, r = s.rng;
    const act = droppableIdxs(g).concat(g.active[0] ? [0] : []);
    if (g.fill > 0) { g.fill = 0; return '🧹 pulled the fill'; }
    const dbl = act.filter((i) => g.double[i]);
    if (dbl.length) { const i = Rng.pick(r, dbl); g.double[i] = false; return '➖ undoubled ' + STAGES[i].label; }
    const fxd = act.filter((i) => g.fx[i]);
    if (fxd.length) { const i = Rng.pick(r, fxd); g.fx[i] = 0; return '➖ stripped FX off ' + STAGES[i].label; }
    return null;
  }

  // Per-lane opinion resolver — the granular feedback the human sets on the seven
  // coloured sliders, at component grain (this is the mechanism that replaces the
  // A&R whole-track pass/fail). Applies the single strongest directive:
  //   inactive + liked      -> bring the lane in (you asked for it)
  //   active + disliked     -> ease it off: undouble, strip FX, then drop
  //   active + liked (thin) -> feature it: double, add FX, or rework toward it
  // Returns a desc, or null when no lane holds a strong opinion (DJ decides).
  function steerByOpinion(s) {
    const g = s.genome, r = s.rng, lm = s.laneMood || [];
    const STRONG = 0.4;
    let best, bestV;

    // 1) bring in a liked lane that's currently out
    best = -1; bestV = STRONG;
    for (let i = 1; i < g.active.length; i++) {
      if (!g.active[i] && lm[i] >= bestV) { best = i; bestV = lm[i]; }
    }
    if (best >= 0) {
      g.active[best] = true; g.variant[best] = Rng.int(r, 0, 5); s.lastAdded = best; markTabu(s, best);
      return '➕ you called for ' + STAGES[best].label + ' — brought it in';
    }

    // 2) ease off the most-disliked active lane (peel complexity, then drop)
    best = -1; bestV = -STRONG;
    for (let i = 1; i < g.active.length; i++) {
      if (g.active[i] && lm[i] <= bestV) { best = i; bestV = lm[i]; }
    }
    if (best >= 0) {
      if (g.double[best]) { g.double[best] = false; return '➖ easing off ' + STAGES[best].label + ' — undoubled'; }
      if (g.fx[best]) { g.fx[best] = 0; return '➖ easing off ' + STAGES[best].label + ' — stripped FX'; }
      if (droppableIdxs(g).length > 1) { g.active[best] = false; markTabu(s, best); return '➖ you cooled on ' + STAGES[best].label + ' — dropped it'; }
    }

    // 3) feature the most-liked active lane that still has headroom
    best = -1; bestV = STRONG;
    for (let i = 0; i < g.active.length; i++) {
      if (g.active[i] && lm[i] >= bestV) { best = i; bestV = lm[i]; }
    }
    if (best >= 0) {
      const freeFx = FX_BITS.filter((b) => !(g.fx[best] & b));
      if (!g.double[best] && Rng.chance(r, 0.5)) { g.double[best] = true; return '✨ featuring ' + STAGES[best].label + ' — doubled it'; }
      if (freeFx.length) { const b = Rng.pick(r, freeFx); g.fx[best] |= b; return '✨ featuring ' + STAGES[best].label + ' — ' + FX_NAMES[b]; }
      g.variant[best] += 1 + Rng.int(r, 0, 2); return '🔀 reworking ' + STAGES[best].label + ' toward what you want';
    }

    return null;
  }

  // Choose and apply one mutation, returning { snapshot, desc } so it can be
  // reverted if the crowd rejects it. Behaviour is banded by approval:
  //   high + full -> locked: hold, at most a tiny flourish
  //   warm        -> build toward a full track
  //   cool/cold   -> explore: roam the arrangement to win them back
  // Crowd warmth (s.warmth, -1..1) tilts the search: warm favours adding &
  // reshaping (build & soften), cold favours stripping & harder energy swings.
  // A tabu list stops it oscillating on one layer; boredom triggers a curveball.
  function proposeMutation(s, banksLoaded) {
    const g = s.genome;
    const r = s.rng;
    const snapshot = cloneGenome(g);
    const act = activeCount(g);
    const likedLane = (i) => s.laneMood && s.laneMood[i] > 0.3;     // protected from drops
    const dislikedLane = (i) => s.laneMood && s.laneMood[i] < -0.3; // kept out of adds
    const inact = tabuFree(s, inactiveIdxs(g)).filter((i) => !dislikedLane(i));
    const drop = tabuFree(s, droppableIdxs(g)).filter((i) => !likedLane(i));
    let desc = null;
    const warm = s.warmth || 0;
    const intent = s.intent || 0; // density dial: <0 strip, >0 pile on
    s.propCount += 1;

    // Per-lane opinion takes priority: granular human feedback steers which
    // component the DJ works on before its own autonomous search kicks in.
    if (s.laneMood && s.laneMood.some((v) => Math.abs(v) >= 0.4) && Rng.chance(r, 0.7)) {
      const od = steerByOpinion(s);
      if (od) return { snapshot, desc: od, opinion: true };
    }

    // reshape by a random jump (not a fixed +1) so a reworked layer actually
    // sounds different rather than nudging one step through a list.
    const reshape = (i) => { g.variant[i] += 1 + Rng.int(r, 0, 2); };
    const add = (i) => {
      g.active[i] = true;
      g.variant[i] = Rng.int(r, 0, 5);
      s.lastAdded = i;
      markTabu(s, i);
    };
    const dropOne = (i) => { g.active[i] = false; markTabu(s, i); };

    if (s.approval >= LOCK_APPROVAL && act >= MIN_FULL) {
      // locked in — don't rock the boat; tease a layer, or thicken if the dial
      // is asking for more.
      if (intent > 0.3 && Rng.chance(r, 0.25)) {
        desc = deepen(s);
      } else if (drop.length && Rng.chance(r, 0.3)) {
        const i = Rng.pick(r, drop);
        reshape(i);
        desc = '🎯 locked in — teasing ' + STAGES[i].label;
      }
      // else hold (no change)
    } else if (s.approval >= WARM) {
      // crowd's with it -> build the track up, in order, toward full. Warmth and
      // a positive density dial make it reach for the next layer more eagerly;
      // once the arrangement is fleshed out it thickens (FX/double/fill) instead.
      const eager = clamp(0.72 + warm * 0.15 + intent * 0.18, 0.3, 0.97);
      if (inact.length && Rng.chance(r, eager)) {
        add(inact[0]);
        desc = '➕ brought in ' + STAGES[inact[0]].label;
      } else if (act >= 4 && Rng.chance(r, clamp(0.35 + intent * 0.4, 0.12, 0.9))) {
        desc = deepen(s);
      } else if (drop.length && Rng.chance(r, 0.5)) {
        const i = Rng.pick(r, drop);
        reshape(i);
        desc = '🔀 reshaped ' + STAGES[i].label;
      } else {
        g.energyIdx = clamp(g.energyIdx + 1, 0, ENERGY_STEPS.length - 1);
        desc = '🔊 pushed the energy up';
      }
    } else {
      // crowd cool/cold -> explore. With the fader pinned low there's no
      // fitness gradient (every shape scores equally badly), so the DJ can't
      // climb — it must *roam* the whole arrangement audibly. If it's been
      // going flat for a while, throw a curveball for real novelty. Otherwise
      // toggle/reshape layers (tabu keeps it off whatever it just touched),
      // swap the kit, or swing the energy. As soon as the crowd gives any
      // signal the accept/revert judge re-biases the walk toward what they
      // liked. Warmth tilts the roam: warm leans to adding, cold to stripping.
      if (s.flatStreak >= BORED) {
        s.flatStreak = 0;
        return { snapshot, desc: curveball(s, banksLoaded) };
      }
      // density dial pulled low (or a cold crowd) -> shed complexity first
      if ((intent < -0.2 || warm < -0.35) && Rng.chance(r, clamp(0.45 - intent * 0.4, 0.15, 0.9))) {
        const d = simplify(s);
        if (d) return { snapshot, desc: d };
      }
      const t = s.temp;
      const roll = clamp(r() - warm * 0.2 - intent * 0.2, 0, 1);
      if (roll < 0.42) {
        const i = Rng.int(r, 1, MAX_STAGE);
        if (g.active[i]) {
          const preferAdd = warm > 0.25 && inact.length;
          if (preferAdd) {
            const j = Rng.pick(r, inact);
            add(j);
            desc = '➕ warmed it up — brought in ' + STAGES[j].label;
          } else if (drop.length > 1 && !isTabu(s, i) && !likedLane(i)) {
            dropOne(i);
            desc = '➖ dropped ' + STAGES[i].label;
          } else if (inact.length) {
            const j = Rng.pick(r, inact);
            add(j);
            desc = '➕ brought in ' + STAGES[j].label;
          }
        } else if (!isTabu(s, i) && !dislikedLane(i)) {
          add(i);
          desc = '➕ tried ' + STAGES[i].label;
        }
      } else if (roll < 0.62 && drop.length) {
        const i = Rng.pick(r, drop);
        reshape(i);
        desc = '🔀 reworked ' + STAGES[i].label;
      } else if (roll < 0.78 && banksLoaded && BANKS.length > 1) {
        g.bank = (g.bank + 1 + Rng.int(r, 0, BANKS.length - 2)) % BANKS.length;
        desc = '🥁 switched the kit to ' + BANKS[g.bank];
      } else {
        let dir = g.energyIdx > 2 ? -1 : 1;
        if (warm > 0.3) dir = 1;                         // warm: keep pushing up
        else if (warm < -0.3 && g.energyIdx > 0) dir = -1; // cold: strip it back
        const step = t > 0.7 ? 2 : 1;
        g.energyIdx = clamp(g.energyIdx + dir * step, 0, ENERGY_STEPS.length - 1);
        desc = dir > 0 ? '🔊 threw the energy up' : '🔉 pulled the energy back';
      }
    }

    return { snapshot, desc };
  }

  // Fingerprint of everything that affects the rendered code. Per-layer variant,
  // the kit, and the song revision (progression/scale curveballs) are included,
  // so every kind of mutation re-renders while leaving untouched layers stable.
  DJEngine.prototype._signature = function () {
    const g = this.song.genome;
    return [
      this.song.seed,
      this.song.rev,
      g.active.map((a) => (a ? 1 : 0)).join(''),
      g.variant.join('.'),
      g.energyIdx,
      g.bank,
      (this.song.laneMood || []).map((x) => Math.round(x * 8)).join('.'), // opinion tint re-renders (quantised)
      g.fx.join('.'),
      g.double.map((d) => (d ? 1 : 0)).join(''),
      g.fill,
    ].join(':');
  };

  // ---- rendering: genome -> Strudel code --------------------------------
  //
  // Every layer is genre-aware: trap/drill get 808 bass, half-time snares and
  // hi-hat rolls; boom bap gets bouncy kick patterns and walking bass; R&B and
  // lo-fi get 7th-chord pads and lush atmospheres; rock and metal ride driven
  // riffs and power chords; house pumps four-on-the-floor with an offbeat open
  // hat; synthwave glows in pads and plucks. Bucket (1..3) tracks energy.

  DJEngine.prototype.render = function () {
    const s = this.song;
    const g = s.genome;
    const e = ENERGY_STEPS[effEnergyIdx(g)]; // 0..1 intensity (part-count floor applied)
    const bucket = Math.round(e * 3);    // 1..3 in practice
    const gid = s.genre ? s.genre.id : 'trap';

    const key = s.key;
    const scale = s.scaleType;
    const rootSeq = Theory.rootSeq(s.prog);
    const seventhSeq = Theory.seventhSeq(s.prog);
    const scl = (oct) => '"' + Theory.scaleName(key, oct, scale) + '"';

    // Drum machine: only reach for a bank once the kit map has actually loaded,
    // otherwise the default dirt-samples kick/snare/hat play (never silence).
    // Rock and metal bypass the machines entirely — the default dirt kit reads
    // more acoustic than the 808/909 banks ever will.
    const useBank = !!this.banksLoaded && BANKS.length && gid !== 'rock' && gid !== 'metal';
    const bankName = useBank ? BANKS[g.bank % BANKS.length] : null;
    const kit = (str) => (bankName ? str + '.bank("' + bankName + '")' : str);

    // Boom bap and lo-fi live on swing — straight-quantised drums kill them.
    // Applied to the hats and the backbeat only; the kick stays on the grid so
    // the low end keeps its anchor.
    const swung = gid === 'boomBap' || gid === 'loFi';
    const swing = (str) => (swung ? str + '.swingBy(1/6,8)' : str);

    // Each layer's character is seeded on its own variant, so it's stable until
    // that specific layer is reshaped; energy scales its intensity.
    const lrng = (i) =>
      Rng.make((s.seed ^ ((i + 1) * 0x9e3779b1) ^ (g.variant[i] * 0x85ebca77)) >>> 0);

    const layers = [];
    const lineLayers = []; // stage index for each body line — the A&R code map

    // Complexity chains appended to a lane's base code: FX flags, a second voice
    // (octave shadow for melodic lanes, timing ghost for sample lanes), and the
    // mixer trim. Chained .gain() multiplies in Strudel, so level scales the lane
    // without touching its own gain maths. All kept paren/quote-balanced.
    const fxChain = (mask) => {
      let f = '';
      if (mask & 1) f += '.delay(0.4).delaytime(0.1875).delayfeedback(' + n2(0.26 + e * 0.14) + ')';
      if (mask & 2) f += '.crush(' + (4 + bucket * 2) + ')';
      if (mask & 4) f += '.room(' + n2(0.4 + (1 - e) * 0.3) + ')';
      if (mask & 8) f += '.pan(sine.range(0.2,0.8).slow(4))';
      return f;
    };
    const doubleChain = (i) => (MELODIC_DOUBLE[i]
      ? '.superimpose(x => x.add(12).gain(' + n2(0.4 + e * 0.1) + '))'
      : '.superimpose(x => x.late(0.02).gain(' + n2(0.35 + e * 0.1) + '))');
    const applyLane = (i, code) => {
      let c = code + fxChain(g.fx[i] || 0);
      if (g.double[i]) c += doubleChain(i);
      // per-lane opinion tints prominence: a liked lane sits a touch forward, a
      // cooled one drops back before the optimiser strips it. Steering (below) is
      // the main effect; this is just the audible cue. Chained .gain() multiplies.
      const op = (s.laneMood && s.laneMood[i]) || 0;
      if (op) c += '.gain(' + n2(clamp(1 + op * 0.35, 0.5, 1.4)) + ')';
      return c;
    };
    const put = (i, code) => { layers.push(applyLane(i, code) + '.color("' + LANE_COLORS[i] + '")'); lineLayers.push(i); };
    const on = (i) => g.active[i];

    // 0 — kick: hip-hop syncopation first, not four-on-the-floor.
    // Trap and drill kick patterns are spare and punchy; boom bap/lo-fi bounce.
    if (on(0)) {
      const kr = lrng(0);
      // Pattern pools indexed by bucket (1..3). Euclidean notation gives organic feel.
      const trapKick = [
        ['bd ~ ~ ~ ~ ~ ~ ~', 'bd ~ ~ ~ bd ~ ~ ~', 'bd(3,8)', 'bd ~ ~ bd ~ ~ ~ ~'],
        ['bd ~ ~ ~ bd ~ bd ~', 'bd ~ bd ~ ~ ~ bd ~', 'bd ~ ~ bd ~ ~ bd ~', 'bd ~ ~ ~ bd ~ ~ bd'],
        ['bd ~ bd bd ~ bd ~ bd', 'bd bd ~ bd ~ ~ bd ~', 'bd ~ bd ~ bd ~ bd bd', 'bd ~ bd ~ bd bd ~ bd'],
      ];
      const boomKick = [
        ['bd ~ ~ ~ bd ~ ~ ~', 'bd ~ bd ~ ~ ~ ~ ~'],
        ['bd ~ ~ bd ~ ~ bd ~', 'bd ~ bd ~ ~ bd ~ ~'],
        ['bd ~ bd bd ~ ~ bd ~', 'bd bd ~ ~ bd ~ bd ~'],
      ];
      // Beyond hip-hop: house pumps four-on-the-floor (with pickup variants),
      // rock drives 1-and-3 with pushes, metal bursts into double-kick 16ths,
      // synthwave holds a steady 80s machine pulse.
      const houseKick = [
        ['bd*4', 'bd bd bd bd'],
        ['bd*4', 'bd bd bd bd', 'bd bd bd [bd bd]'],
        ['bd*4', 'bd bd bd [bd bd]', '[bd bd] bd bd bd'],
      ];
      const rockKick = [
        ['bd ~ ~ ~ bd ~ ~ ~', 'bd ~ ~ ~ bd ~ ~ bd'],
        ['bd ~ ~ bd bd ~ ~ ~', 'bd ~ ~ ~ bd ~ bd ~'],
        ['bd ~ ~ bd bd ~ bd ~', 'bd ~ bd bd bd ~ ~ bd'],
      ];
      const metalKick = [
        ['bd*4', 'bd ~ bd ~ bd ~ bd ~'],
        ['bd bd ~ bd bd ~ bd ~', 'bd ~ [bd bd] ~ bd ~ [bd bd] ~'],
        ['[bd bd] [bd bd] [bd bd] [bd bd]', 'bd*8', '[bd bd] bd [bd bd] bd [bd bd] bd [bd bd] bd'],
      ];
      const waveKick = [
        ['bd ~ ~ ~ bd ~ ~ ~'],
        ['bd ~ ~ ~ bd ~ ~ ~', 'bd ~ bd ~ bd ~ bd ~'],
        ['bd ~ bd ~ bd ~ bd ~', 'bd ~ ~ bd bd ~ bd ~'],
      ];
      const kickPool = (gid === 'boomBap' || gid === 'loFi') ? boomKick
        : gid === 'house' ? houseKick
        : gid === 'rock' ? rockKick
        : gid === 'metal' ? metalKick
        : gid === 'synthwave' ? waveKick
        : trapKick;
      const pool = kickPool[bucket - 1] || kickPool[1];
      const pat = Rng.pick(kr, pool);
      let kick = 's("' + pat + '").gain(' + n2(0.88 + e * 0.09) + ')';
      if (bucket >= 3 && Rng.chance(kr, 0.4)) kick += '.shape(' + n2(0.1 + e * 0.18) + ')';
      put(0, kit(kick));
    }

    // 1 — hi-hats: trap rolls (16th streams, euclidean patterns), open hat
    // accents on off-beats. Boom bap and lo-fi stay sparser and breathier.
    if (on(1)) {
      const hr = lrng(1);
      const trapHats = [
        'hh*8',
        'hh*16',
        'hh*12',
        'hh(11,16)',
        'hh(13,16)',
        'hh ~ [hh hh] ~ hh ~ [hh hh hh] ~',
        'hh ~ hh hh ~ hh ~ hh',
        '[hh hh] ~ hh ~ [hh hh] ~ hh ~',
      ];
      const boomHats = ['hh*8', 'hh(9,16)', 'hh ~ hh hh ~ hh hh ~', 'hh ~ hh ~ hh ~ hh ~'];
      const loFiHats = ['hh*8', 'hh ~ hh ~ hh ~ hh ~', 'hh hh ~ hh hh ~ hh ~'];
      // House rides the OFFBEAT open hat — that lift is the genre's signature.
      // Rock and metal drive straight 8ths (16ths once it heats up); synthwave
      // keeps a steady machine tick.
      const houseHats = ['~ oh ~ oh', 'hh oh hh oh', '[hh hh] oh [hh hh] oh', '~ oh ~ [oh oh]', 'hh*8'];
      const rockHats = ['hh*8', 'hh ~ hh ~ hh ~ hh ~', 'hh*16', '[hh hh] [hh hh] [hh hh] [hh hh]'];
      const metalHats = ['hh*8', 'hh ~ hh ~ hh ~ hh ~', 'hh*16', 'hh(13,16)'];
      const waveHats = ['hh*8', 'hh ~ hh ~ hh ~ hh ~'];
      let hatPool;
      if (gid === 'boomBap') hatPool = boomHats;
      else if (gid === 'loFi') hatPool = loFiHats;
      else if (gid === 'house') hatPool = houseHats;
      else if (gid === 'rock') hatPool = rockHats;
      else if (gid === 'metal') hatPool = metalHats;
      else if (gid === 'synthwave') hatPool = waveHats;
      else hatPool = trapHats;
      // low energy keeps it simple
      const actualPool = bucket <= 1 ? hatPool.slice(0, 2) : hatPool;
      const pat = Rng.pick(hr, actualPool);
      put(1, kit(swing('s("' + pat + '").gain(' + n2(0.20 + e * 0.18) + ').pan(sine.range(0.35,0.65))')));
      // open hi-hat accent on off-beats (house already carries its own oh)
      if (bucket >= 2 && gid !== 'house' && Rng.chance(hr, 0.55)) {
        const ohPat = Rng.pick(hr, ['~ oh ~ ~', '~ ~ oh ~', '~ oh ~ oh']);
        put(1, kit(swing('s("' + ohPat + '").gain(' + n2(0.16 + e * 0.14) + ')')));
      }
    }

    // 2 — bass: 808-style sub for trap/drill (long sine with FM, deep lpf);
    // melodic walking bass for boom bap, R&B and lo-fi.
    if (on(2)) {
      const br = lrng(2);
      const isTrap = gid === 'trap' || gid === 'drill';
      const isRiff = gid === 'rock' || gid === 'metal';
      let bass;
      if (isRiff) {
        // Driven sawtooth riff — the guitar-adjacent low end rock and metal
        // ride on. Metal chugs relentless 8th/16th palm-mutes; rock leaves
        // gaps to push against. .shape() supplies the drive, and the low-pass
        // keeps it an amp cabinet rather than a razor.
        const riffStructs = gid === 'metal'
          ? ['x x x x x x x x', 'x x x x x x [x x] x', '[x x] x x x [x x] x x x']
          : ['x ~ x x ~ x x ~', 'x x ~ x x ~ x x', 'x ~ x ~ x x ~ x'];
        bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + Rng.pick(br, riffStructs) + '")' +
          '.sound("sawtooth").shape(' + n2(0.3 + e * 0.2) + ')' +
          '.lpf(' + Math.round(400 + e * 500) + ').lpq(' + n2(2 + e * 4) + ')' +
          '.gain(' + n2(0.74 + e * 0.1) + ')';
      } else if (gid === 'house') {
        // Rolling offbeat bass — the pump between the four-on-the-floor kicks.
        const offStructs = ['~ x ~ x ~ x ~ x', '~ x ~ x ~ x ~ [x x]', '~ x ~ [x x] ~ x ~ x'];
        bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + Rng.pick(br, offStructs) + '")' +
          '.sound("' + Rng.pick(br, ['square', 'sawtooth']) + '")' +
          '.decay(' + n2(0.18 + e * 0.1) + ').release(0.05)' +
          '.lpf(' + Math.round(300 + e * 700) + ').lpq(' + n2(3 + e * 5) + ')' +
          '.gain(' + n2(0.74 + e * 0.08) + ')';
      } else if (gid === 'synthwave') {
        // Plucky root 8ths — the sequenced anchor under the neon pads.
        const plkStructs = ['x x x x x x x x', 'x ~ x x x ~ x x', 'x x x ~ x x x ~'];
        bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + Rng.pick(br, plkStructs) + '")' +
          '.sound("' + Rng.pick(br, ['sawtooth', 'square']) + '")' +
          '.attack(0.005).decay(' + n2(0.12 + e * 0.08) + ').release(0.06)' +
          '.lpf(' + Math.round(500 + e * 900) + ')' +
          '.gain(' + n2(0.72 + e * 0.1) + ')';
      } else if (isTrap) {
        // 808 character: sine with light FM for upper harmonics, long release,
        // very low filter. Pattern is sparse — the 808 holds the note.
        const structs808 = [
          'x ~ ~ ~ ~ ~ ~ ~',
          'x ~ ~ ~ x ~ ~ ~',
          'x ~ ~ x ~ ~ ~ ~',
          'x ~ x ~ ~ ~ x ~',
          'x ~ ~ ~ ~ ~ x ~',
          'x ~ ~ x ~ ~ x ~',
          'x ~ x ~ x ~ ~ ~',
          'x ~ ~ ~ x ~ x ~',
          'x ~ x x ~ ~ ~ ~',
        ];
        const struct = Rng.pick(br, structs808);
        bass = 'n("' + rootSeq + '").scale(' + scl(2) + ')' +
          '.struct("' + struct + '")' +
          '.sound("sine").fm(' + n2(0.3 + e * 1.0) + ').fmh(' + Rng.int(br, 1, 2) + ')' +
          '.attack(0.01).release(' + n2(0.8 + e * 1.0) + ')' +
          '.lpf(' + Math.round(160 + e * 220) + ').gain(' + n2(0.88 + e * 0.08) + ')';
        // The drill signature: 808s that slide between hits. A patterned pitch
        // envelope glides into some notes and sits on others — always for
        // drill, sometimes for trap.
        if (gid === 'drill' || Rng.chance(br, 0.35)) {
          const glide = Rng.pick(br, ['<0 -5 0 -3>', '<0 0 -7 0>', '<-3 0 0 -5>']);
          bass += '.penv("' + glide + '").pattack(' + n2(0.1 + e * 0.08) + ')';
        }
      } else {
        // Melodic bassline: saw/square/sine with rhythmic structure.
        const light = ['x ~ ~ ~ x ~ ~ ~', 'x ~ ~ x x ~ ~ ~'];
        const heavy = ['x ~ x ~ x ~ x x', 'x x ~ x x ~ x x', 'x ~ x ~ ~ ~ x ~'];
        const struct = bucket <= 1 ? Rng.pick(br, light) : Rng.pick(br, heavy);
        const cut = Math.round(280 + e * 1900);
        const voice = Rng.int(br, 0, 3);
        if (voice === 0) {
          bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + struct + '")' +
            '.sound("sawtooth").lpf(' + cut + ').lpq(' + n2(4 + e * 8) + ')' +
            '.gain(' + n2(0.7 + e * 0.1) + ')';
        } else if (voice === 1) {
          bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + struct + '")' +
            '.sound("square").lpf(' + cut + ').lpenv(' + n2(2 + e * 2) + ').lpattack(0.02)' +
            '.gain(' + n2(0.7 + e * 0.1) + ')';
        } else if (voice === 2) {
          bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + struct + '")' +
            '.sound("sine").fm(' + n2(1.5 + e * 4) + ').fmh(' + Rng.int(br, 1, 2) + ')' +
            '.lpf(' + Math.round(cut * 1.3) + ').gain(' + n2(0.7 + e * 0.1) + ')';
        } else {
          // walking bass — roots that step toward the next chord; the melodic
          // spine of boom bap, R&B and soul. No struct: the walk carries its
          // own two-notes-per-bar rhythm.
          bass = 'n("' + Theory.walkingSeq(s.prog) + '").scale(' + scl(2) + ')' +
            '.sound("' + Rng.pick(br, ['sawtooth', 'square']) + '").lpf(' + Math.round(cut * 1.1) + ')' +
            '.lpq(' + n2(3 + e * 5) + ').gain(' + n2(0.68 + e * 0.1) + ')';
        }
      }
      put(2, bass);
    }

    // 3 — snare/clap: trap and drill use half-time (beat 3 only — four 1-beat
    // elements, snare on the third); boom bap uses the standard 2-and-4 backbeat.
    if (on(3)) {
      const cr = lrng(3);
      // Rock, metal and synthwave demand a true snare on the backbeat — a clap
      // reads too dancey there. House keeps the classic cp/sd roll.
      const wantSd = gid === 'rock' || gid === 'metal' || gid === 'synthwave';
      const hit = wantSd ? 'sd' : Rng.chance(cr, 0.5) ? 'cp' : 'sd';
      let pat;
      if (gid === 'trap' || gid === 'drill') {
        // Half-time: snare on beat 3 = 4 elements, each one beat, third is the hit
        pat = Rng.pick(cr, [
          '~ ~ ' + hit + ' ~',
          '~ ~ [' + hit + ' ' + hit + '] ~',
          '~ ~ ' + hit + ' [~ ' + hit + ']',
        ]);
      } else {
        // Standard backbeat: beats 2 and 4
        pat = Rng.pick(cr, [
          '~ ' + hit + ' ~ ' + hit,
          '~ ' + hit + ' ~ [' + hit + ' ' + hit + ']',
          '~ ' + hit + ' ~ ' + hit + '*2',
        ]);
      }
      let clap = 's("' + pat + '").gain(' + n2(0.45 + e * 0.12) + ').room(' + n2(0.22 + (1 - e) * 0.2) + ')';
      if (Rng.chance(cr, 0.3)) clap += '.speed(' + n2(0.9 + Rng.int(cr, 0, 3) * 0.1) + ')';
      put(3, kit(swing(clap)));
    }

    // 4 — chords: three voices per variant roll:
    //   0 = piano stab (trap signature — short attack, quick decay),
    //   1 = lush pad (R&B / lo-fi — slow swell),
    //   2 = plucked square (boom bap / soul — sharp envelope).
    // R&B and lo-fi favour 7th-chord voicings for that neo-soul depth.
    if (on(4)) {
      const chr = lrng(4);
      // Voicing depth: R&B / lo-fi reach for extensions and quartal/shell
      // colours; boom bap sits in sixths and stacked fourths; trap/drill keep
      // stabs tighter (triad / sus / shell) but still vary. Every voicing stays
      // inside the scale, so the mood palette keeps dictating the colour.
      // Rock and metal stack power chords — root, fifth, octave — the wall.
      const voicingsFor = (gid === 'rock' || gid === 'metal')
        ? ['power', 'sus4', 'triad']
        : (gid === 'rb' || gid === 'loFi')
        ? ['seventh', 'ninth', 'sixth', 'quartal', 'shell']
        : gid === 'boomBap'
        ? ['sixth', 'seventh', 'quartal', 'triad', 'spread']
        : ['triad', 'sus4', 'shell', 'seventh', 'quartal'];
      const seq = Theory.voicingSeq(s.prog, Rng.pick(chr, voicingsFor));
      let voice = Rng.int(chr, 0, 2);
      // Rock/metal always hit the driven stab, house lives on the piano stab,
      // and synthwave leans hard into the lush pad.
      if (gid === 'rock' || gid === 'metal' || gid === 'house') voice = 0;
      else if (gid === 'synthwave' && voice !== 1 && Rng.chance(chr, 0.75)) voice = 1;
      let chord;
      if (voice === 0) {
        // Piano stab: hard transient, short tail — punchy trap chord hit
        // rock/metal strum the stab across the bar; house rides the offbeat
        const stabPat = (gid === 'rock' || gid === 'metal')
          ? Rng.pick(chr, ['x ~ x ~', 'x x ~ x', 'x ~ [x x] ~', 'x ~ x x'])
          : gid === 'house'
          ? Rng.pick(chr, ['~ x ~ x', '~ x ~ [x x]', '~ [~ x] ~ x'])
          : Rng.pick(chr, ['x ~ ~ ~', 'x ~ x ~', 'x ~ ~ x', 'x x ~ ~', 'x ~ x x', '~ x ~ x']);
        chord = 'n("' + seq + '").scale(' + scl(3) + ')' +
          '.struct("' + stabPat + '")' +
          '.sound("sawtooth").lpf(' + Math.round(gid === 'house' ? 1200 + e * 900 : 1800 + e * 1200) + ')' +
          '.attack(0.005).decay(' + n2(0.12 + e * 0.15) + ').release(0.08)' +
          '.gain(' + n2(0.28 + e * 0.12) + ').room(0.22)';
        // a touch of drive turns the stab into a power-chord strum
        if (gid === 'rock' || gid === 'metal') chord += '.shape(' + n2(0.15 + e * 0.15) + ')';
      } else if (voice === 1) {
        // Lush pad: slow swell, triangle or sine — R&B / lo-fi / atmospheric
        const wave = Rng.pick(chr, ['triangle', 'sine']);
        const cut = Math.round(700 + e * 800);
        const atk = n2(0.2 + Rng.int(chr, 0, 3) * 0.12);
        chord = 'n("' + seq + '").scale(' + scl(3) + ')' +
          '.sound("' + wave + '").lpf(' + cut + ')' +
          '.attack(' + atk + ').release(' + n2(0.5 + (1 - e) * 0.5) + ')' +
          '.gain(' + n2(0.2 + e * 0.12) + ').room(' + n2(0.45 + (1 - e) * 0.25) + ')';
      } else {
        // Plucked / muted square: sharp envelope, slightly shaped — boom bap soul
        chord = 'n("' + seq + '").scale(' + scl(3) + ')' +
          '.sound("square").lpf(' + Math.round(1200 + e * 1500) + ')' +
          '.attack(0.01).decay(' + n2(0.2 + e * 0.3) + ').release(0.15)' +
          '.shape(' + n2(0.1 + e * 0.1) + ')' +
          '.gain(' + n2(0.22 + e * 0.1) + ').room(0.35)';
      }
      put(4, chord);
    }

    // 5 — lead melody: a phrase generator, not a single looping cell. The cell/
    // phrase is drawn from the WHOLE library via lrng(5) (seeded on the lane's
    // variant), so every one of the ~45 cells + 16 call/response phrases is
    // reachable — the old code indexed MELODY_CELLS by variant directly, and a
    // fresh add only ever seeds variant 0..5, so just the first six cells were
    // ever heard. Register lifts to octave 6 when it's bright/energetic; half
    // the time it plays a two-bar call-and-response instead of one motif.
    if (on(5)) {
      const lr = lrng(5);
      const bright = gid === 'rb' || gid === 'loFi' || gid === 'boomBap' || gid === 'synthwave';
      const oct = ((e > 0.6 && Rng.chance(lr, 0.5)) || (bright && Rng.chance(lr, gid === 'synthwave' ? 0.6 : 0.3))) ? 6 : 5;
      // phrase vs single cell: a call-and-response answers itself each cycle
      let seq;
      if (Theory.MELODY_PHRASES && Theory.MELODY_PHRASES.length && Rng.chance(lr, 0.5)) {
        const ph = Rng.pick(lr, Theory.MELODY_PHRASES);
        seq = '<[' + ph[0] + '] [' + ph[1] + ']>';
      } else {
        seq = Rng.pick(lr, Theory.MELODY_CELLS);
      }
      // rock and metal want the saw's bite; everyone else rolls the wave
      const wave = (gid === 'rock' || gid === 'metal')
        ? 'sawtooth'
        : Rng.pick(lr, ['triangle', 'sawtooth', 'square']);
      let lead = 'n("' + seq + '").scale(' + scl(oct) + ').sound("' + wave + '")';
      if (Rng.chance(lr, 0.4)) lead += '.fm(' + n2(1 + e * 3) + ').fmh(' + Rng.int(lr, 1, 3) + ')';
      // always filtered — an unfiltered sawtooth up here is piercing
      lead += '.lpf(' + Math.round(1500 + e * 2800) + ')';
      lead += '.gain(' + n2(0.3 + e * 0.14) + ').room(0.3)';
      // a touch of drive keeps the rock/metal lead singing over the riff
      if (gid === 'rock' || gid === 'metal') lead += '.shape(' + n2(0.1 + e * 0.12) + ')';
      // genre phrasing colour: drill slides between notes, boom bap / lo-fi
      // leads swing behind the beat, trap leans on a dotted-8th delay echo.
      if (gid === 'drill' && Rng.chance(lr, 0.6)) {
        lead += '.penv("' + Rng.pick(lr, ['<0 -2 0 -1>', '<0 0 -2 0>', '<-1 0 -2 0>']) + '").pattack(0.06)';
      }
      if (bright && (gid === 'boomBap' || gid === 'loFi')) lead += '.swingBy(1/6,8)';
      if (e > 0.55 || gid === 'synthwave') { // synthwave always carries the echo
        const dt = (gid === 'trap' || gid === 'drill') ? '0.125' : '0.1875';
        lead += '.delay(0.35).delaytime(' + dt + ').delayfeedback(' + n2(0.3 + e * 0.1) + ')';
      }
      // house keeps its leads sparse — the groove is the star, not the topline
      if (gid === 'house' && e < 0.55) lead += '.degradeBy(' + n2(0.3 + (0.55 - e)) + ')';
      else if (e < 0.35) lead += '.degradeBy(0.3)';
      if (Rng.chance(lr, 0.25)) lead += '.crush(' + Rng.int(lr, 6, 12) + ')';
      put(5, lead);
    }

    // 6 — atmosphere: three voices that open up the space:
    //   0 = filtered noise wash (pink or brown) — airy, wide,
    //   1 = slow sine sub drone on the root — deep, rooted,
    //   2 = detuned triangle chord pad — choir shimmer.
    if (on(6)) {
      const ar = lrng(6);
      const atmoVoice = Rng.int(ar, 0, 2);
      if (atmoVoice === 0) {
        const col = Rng.pick(ar, ['pink', 'brown']);
        put(6,
          's("' + col + '").gain(' + n2(0.06 + e * 0.06) + ')' +
          '.lpf(' + Math.round(1200 + e * 2000) + ').hpf(300).room(0.8)'
        );
      } else if (atmoVoice === 1) {
        put(6,
          'n("' + rootSeq + '").scale(' + scl(5) + ')' +
          '.sound("sine").slow(2).gain(0.1).lpf(1000).room(0.7)'
        );
      } else {
        // Choir shimmer: triangle 7th chord, slow swell, high room
        put(6,
          'n("' + seventhSeq + '").scale(' + scl(4) + ')' +
          '.sound("triangle").lpf(' + Math.round(900 + e * 1100) + ')' +
          '.attack(' + n2(0.4 + e * 0.3) + ').release(' + n2(0.8 + (1 - e) * 0.4) + ')' +
          '.gain(' + n2(0.09 + e * 0.07) + ').room(0.75)'
        );
      }
    }

    // Song-level fill/riser — its own body line (pseudo-lane FILL_IDX), so the
    // A&R map can highlight it like any other change.
    if (g.fill > 0) {
      let fill;
      if (g.fill === 1) {
        fill = 's("white").gain(' + n2(0.05 + e * 0.1) + ').lpf(sine.range(400,9000).slow(4)).hpf(300).room(0.5)';
      } else if (g.fill === 2) {
        fill = 's("~ ~ [sd sd] [sd*4]").gain(' + n2(0.24 + e * 0.18) + ').room(0.3)';
      } else {
        fill = 's("~ ~ ~ cp").gain(' + n2(0.32 + e * 0.14) + ').room(0.6).speed(0.85)';
      }
      layers.push(fill + '.color("' + FILL_COLOR + '")');
      lineLayers.push(FILL_IDX);
    }

    const body = layers.join(',\n  ');
    this._lastLayers = lineLayers; // body-line -> stage index, for A&R highlighting
    this._lastLines = layers.slice(); // the body lines themselves — renderAB() recombines them
    return 'setcps(' + n2(s.cps) + ')\nstack(\n  ' + body + '\n)';
  };

  // ---- A/B rendering: hear a pitched change against the committed track --
  //
  // The pitch on Deck B is a diff on one lane. renderAB(mix) builds ONE
  // balanced program carrying BOTH versions of the touched lane — the
  // committed lines scaled by (1-mix), the proposed lines by mix — so the
  // crossfader can blend the change in and out live. Chained .gain()
  // multiplies in Strudel, so the wrapper scales a lane without touching its
  // own gain maths. Untouched lanes render identically in both versions and
  // are included once; mix=1 is exactly the proposed render.

  DJEngine.prototype.renderAB = function (mix) {
    const s = this.song;
    const m = clamp(typeof mix === 'number' ? mix : 1, 0, 1);
    if (!s || !s.pending || !s.pending.snapshot || s.pending.layer == null || m >= 0.999) {
      return this.render();
    }
    const lane = s.pending.layer;
    const proposed = cloneGenome(s.genome);
    restoreGenome(s.genome, s.pending.snapshot);
    this.render();
    const aLines = (this._lastLines || []).slice();
    const aMap = (this._lastLayers || []).slice();
    restoreGenome(s.genome, proposed);
    const code = this.render(); // leaves the line maps on the proposed state
    const bLines = (this._lastLines || []).slice();
    const bMap = (this._lastLayers || []).slice();
    const out = [];
    for (let i = 0; i < bLines.length; i++) {
      if (bMap[i] === lane) {
        if (m > 0.001) out.push(bLines[i] + '.gain(' + n2(m) + ')');
      } else {
        out.push(bLines[i]);
      }
    }
    for (let i = 0; i < aLines.length; i++) {
      if (aMap[i] === lane) out.push(aLines[i] + '.gain(' + n2(1 - m) + ')');
    }
    if (!out.length) return code;
    return code.slice(0, code.indexOf('stack(')) + 'stack(\n  ' + out.join(',\n  ') + '\n)';
  };

  // The committed track — the version a save banks. While a pitch is un-judged
  // the genome momentarily holds the proposal; render from the snapshot instead
  // so "what you press" is always "what you approved".
  DJEngine.prototype.renderCommitted = function () {
    const s = this.song;
    if (!s) return '';
    if (!s.pending || !s.pending.snapshot) return this.render();
    const proposed = cloneGenome(s.genome);
    restoreGenome(s.genome, s.pending.snapshot);
    const code = this.render();
    restoreGenome(s.genome, proposed);
    this.render(); // restore the line maps to the live (proposed) state
    return code;
  };

  // ---- arrangement: the genome as a full track, not a loop ---------------
  //
  // arrange([bars, section], ...) plays each section for its bar count and
  // loops the whole journey (1 cycle = 1 bar). Sections are lane-subsets of
  // one full render: thin intro → building weight → the full peak → a
  // kickless strip → peak again → a thin outro, 36 bars in all. A snare
  // build is masked onto the final bar of the build and strip sections so
  // the transitions announce themselves. This is the "shippable" render —
  // the pressing modal offers it alongside the raw loop.

  DJEngine.prototype.renderArranged = function () {
    const s = this.song;
    if (!s) return '';
    const cpsLine = 'setcps(' + n2(s.cps) + ')';
    this.render(); // stash the full genome's lines + lane map
    const lines = (this._lastLines || []).slice();
    const map = (this._lastLayers || []).slice();
    const has = {};
    map.forEach((l) => { has[l] = true; });

    // the lines whose lane is in `set` — never empty (the kick is always on,
    // and a set that misses every lane falls back to the whole body)
    const pick = (set) => {
      const out = [];
      for (let i = 0; i < lines.length; i++) if (set.indexOf(map[i]) >= 0) out.push(lines[i]);
      return out.length ? out : lines.slice();
    };
    // a snare build masked onto the section's final bar
    const fillLine = (bars) => {
      let m = '';
      for (let i = 0; i < bars; i++) m += (i ? ' ' : '') + (i === bars - 1 ? '1' : '0');
      return 's("~ ~ [sd sd] [sd*4]").gain(0.32).room(0.3).mask("<' + m + '>")';
    };
    const sect = (arr) => 'stack(\n    ' + arr.join(',\n    ') + '\n  )';

    const intro = pick([0, 1, 6]);                    // kick, hats, air
    const build = pick([0, 1, 2, 3, 6]);              // + bass and the backbeat
    const peak = lines.slice();                       // everything
    // kickless breakdown: the melodic lanes carry it; a drums-only genome
    // strips to kick+hats instead so the section still moves
    const hasMelodic = [2, 4, 5, 6].some((l) => has[l]);
    const strip = pick(hasMelodic ? [1, 2, 4, 5, 6] : [0, 1]);
    const outro = pick([0, 2, 6]);                    // kick, bass, air

    const plan = [
      [4, sect(intro)],
      [8, sect(build.concat([fillLine(8)]))],
      [8, sect(peak)],
      [4, sect(strip.concat([fillLine(4)]))],
      [8, sect(peak)],
      [4, sect(outro)],
    ];
    return cpsLine + '\narrange(\n  ' +
      plan.map((p) => '[' + p[0] + ', ' + p[1] + ']').join(',\n  ') + '\n)';
  };

  // The arranged render of the COMMITTED track (see renderCommitted) — what
  // "press as arranged track" banks.
  DJEngine.prototype.renderArrangedCommitted = function () {
    const s = this.song;
    if (!s) return '';
    if (!s.pending || !s.pending.snapshot) return this.renderArranged();
    const proposed = cloneGenome(s.genome);
    restoreGenome(s.genome, s.pending.snapshot);
    const code = this.renderArranged();
    restoreGenome(s.genome, proposed);
    this.render(); // restore the line maps to the live (proposed) state
    return code;
  };

  // ---- snapshot for UI/viz ----------------------------------------------

  DJEngine.prototype.state = function () {
    const s = this.song;
    const g = s.genome;
    const act = activeCount(g);
    const mode =
      s.approval >= LOCK_APPROVAL && act >= MIN_FULL
        ? 'locked in'
        : s.approval >= WARM
        ? 'building'
        : 'searching';
    return {
      name: s.name,
      key: s.key,
      scaleType: s.scaleType,
      bpm: s.bpm,
      cps: s.cps,
      genre: s.genre ? s.genre.id : 'trap',
      genreLabel: s.genre ? s.genre.label : 'Trap',
      stage: highestActive(g),
      maxStage: MAX_STAGE,
      stageLabel: STAGES[highestActive(g)].label,
      stageKeys: STAGES.map((x) => x.key),
      activeLayers: g.active.slice(),
      activeCount: act,
      energy: ENERGY_STEPS[effEnergyIdx(g)],
      approval: s.approval,
      hitProgress: clamp(s.hitTimer / HIT_SECONDS, 0, 1),
      mode: mode,
      temp: s.temp,
      warmth: s.warmth,
      intent: s.intent,
      laneMood: (s.laneMood || []).slice(),
      fx: g.fx.slice(),
      double: g.double.slice(),
      fill: g.fill,
      move: s.pending ? s.pending.desc : null,
      lastVerdict: s.lastVerdict,
      verdictSeq: s.verdictSeq,
      flatStreak: s.flatStreak,
      aversion: Object.assign({}, s.aversion),
      bank: s.banksLoaded ? BANKS[g.bank % BANKS.length] : null,
      age: s.age,
    };
  };

  // ---- interactive "A&R" mode: the human is the fitness function ---------
  // A turn-based variant of the same optimiser. Instead of inferring approval
  // from a mood fader, the human upvotes (keep) or downvotes (revert) each
  // proposed change. Downvotes go into a per-song ban set, so a killed idea is
  // never pitched again. Reuses the same genome, render and STAGES; only the
  // add/reshape moves are offered here since each maps cleanly to a code line.

  DJEngine.prototype.voteReset = function () {
    const s = this.song;
    if (!s) return;
    s.banned = {};    // "add:i" the user killed — that instrument stays out for the song
    s.vtabu = {};     // layer -> proposal count until which it won't be re-pitched (spacing)
    s.vprop = 0;      // proposals made this session (drives the tabu spacing)
    s.pending = null;
    s.voteLog = [];
  };

  // Propose (and apply) one change for the human to judge. Returns
  // { desc, layer, dir, kind } or null when there's nothing left to pitch.
  DJEngine.prototype.proposeChange = function () {
    const s = this.song;
    const g = s.genome;
    const r = s.rng;
    if (!s.banned) s.banned = {};
    if (!s.vtabu) s.vtabu = {};
    s.vprop = (s.vprop || 0) + 1;
    const snapshot = cloneGenome(g);
    const intent = s.intent || 0;      // density dial (0 until the UI sets it)
    const lm = s.laneMood || [];       // part-mixer opinion: <0 drop, >0 feature
    const likes = (i) => (lm[i] || 0) > 0.3;
    const dislikes = (i) => (lm[i] || 0) < -0.3;
    const act = activeCount(g);

    // Build the candidate moves. Adds bring the skeleton in first; once three
    // lanes are down, the deeper moves unlock — rework, FX, a doubled voice, or
    // a fill — so a session keeps finding fresh things to pitch instead of
    // capping out at a handful of instruments. A killed idea is banned (never
    // re-pitched); a killed *rework* is only spaced out, and rework is never
    // banned, so the session can't dead-end while any lane is still playable.
    const activeLanes = [];
    for (let i = 0; i < g.active.length; i++) if (g.active[i]) activeLanes.push(i);
    const more = 1 + Math.max(0, intent) * 0.8, less = 1 + Math.max(0, -intent) * 0.8;
    const cands = [];

    // adds — skip a part you've marked "drop"; strongly favour one you "feature".
    // The bassline is the arrangement's spine, so it's weighted well ahead of
    // the decorative lanes (trap/drill open with it already seeded in).
    inactiveIdxs(g).forEach((i) => {
      if (s.banned['add:' + i] || dislikes(i)) return;
      const spine = i === 2 ? 2.5 : 1;
      cands.push({ kind: 'add', layer: i, dir: 1, w: 3 * more * spine * (likes(i) ? 2.5 : 1), banKey: 'add:' + i, desc: 'bring in ' + STAGES[i].label });
    });
    const addCands = cands.length; // how many lanes could still come in
    // drops — a part you marked "drop" gets pitched for removal (never the kick).
    droppableIdxs(g).forEach((i) => {
      if (dislikes(i) && !s.banned['drop:' + i]) {
        cands.push({ kind: 'drop', layer: i, dir: -1, w: 3.5, banKey: 'drop:' + i, desc: 'drop ' + STAGES[i].label });
      }
    });
    droppableIdxs(g).forEach((i) => {
      cands.push({ kind: 'reshape', layer: i, dir: 0, w: 1 * less * (likes(i) ? 2 : 1), banKey: 'reshape:' + i, desc: 'rework ' + STAGES[i].label });
    });
    // Skeleton first: thicken (FX / doubled voices / a fill) once the core is
    // down — four parts, or sooner if every remaining lane has been binned.
    // (Gating this on a FULL arrangement meant real sessions, saved at 3–5
    // parts, never carried a single effect, double or fill.)
    if (act >= 4 || addCands === 0) {
      activeLanes.forEach((i) => {
        if (dislikes(i)) return;           // don't deepen a part you want gone
        const feat = likes(i) ? 2.5 : 1;   // feature a part → thicken it up first
        FX_BITS.forEach((b) => {
          if (!(g.fx[i] & b) && !s.banned['fx:' + i + ':' + b]) {
            cands.push({ kind: 'fx', layer: i, bit: b, dir: 0, w: 1.3 * more * feat, banKey: 'fx:' + i + ':' + b, desc: 'add ' + FX_NAMES[b] + ' to ' + STAGES[i].label });
          }
        });
        if (!g.double[i] && !s.banned['double:' + i]) {
          cands.push({ kind: 'double', layer: i, dir: 0, w: 1.1 * more * feat, banKey: 'double:' + i, desc: 'double up ' + STAGES[i].label });
        }
      });
      if (g.fill === 0 && !s.banned['fill']) {
        cands.push({ kind: 'fill', layer: FILL_IDX, dir: 1, w: 0.9 * more, banKey: 'fill', desc: 'drop in a fill' });
      }
    }
    if (!cands.length) { s.pending = null; return null; }

    // Soft spacing: prefer candidates whose lane wasn't just touched; relax only
    // if that would leave nothing, so there's always a move.
    const free = (c) => (s.vtabu[c.layer] || 0) <= s.vprop;
    let pool = cands.filter(free);
    if (!pool.length) pool = cands;

    const pick = weightedPick(r, pool);

    if (pick.kind === 'add') {
      g.active[pick.layer] = true;
      g.variant[pick.layer] = Rng.int(r, 0, 5);
    } else if (pick.kind === 'drop') {
      g.active[pick.layer] = false;
    } else if (pick.kind === 'reshape') {
      g.variant[pick.layer] += 1 + Rng.int(r, 0, 2);
    } else if (pick.kind === 'fx') {
      g.fx[pick.layer] |= pick.bit;
    } else if (pick.kind === 'double') {
      g.double[pick.layer] = true;
    } else if (pick.kind === 'fill') {
      g.fill = Rng.int(r, 1, 3);
      pick.desc = 'drop in ' + FILL_NAMES[g.fill];
    }
    s.vtabu[pick.layer] = s.vprop + 2; // hold this lane out of the next couple of pitches
    s.pending = { snapshot: snapshot, desc: pick.desc, layer: pick.layer, dir: pick.dir, kind: pick.kind, banKey: pick.banKey };
    return { desc: pick.desc, layer: pick.layer, dir: pick.dir, kind: pick.kind };
  };

  // Keep the pitched change (it's already applied). Returns the change.
  DJEngine.prototype.acceptChange = function () {
    const s = this.song;
    if (!s.pending) return null;
    const p = s.pending;
    s.pending = null;
    (s.voteLog = s.voteLog || []).push({ v: 'up', desc: p.desc });
    return p;
  };

  // Kill the pitched change: revert the genome and ban this idea for the song.
  DJEngine.prototype.rejectChange = function () {
    const s = this.song;
    if (!s.pending) return null;
    const p = s.pending;
    restoreGenome(s.genome, p.snapshot);
    if (!s.banned) s.banned = {};
    if (!s.vtabu) s.vtabu = {};
    if (p.kind === 'reshape') {
      s.vtabu[p.layer] = (s.vprop || 0) + 3; // a killed rework: try a different idea before this lane again
    } else {
      s.banned[p.banKey] = true;             // a killed add / FX / double / fill stays out for the song
    }
    s.pending = null;
    (s.voteLog = s.voteLog || []).push({ v: 'down', desc: p.desc });
    return p;
  };

  // ---- A&R, redesigned: opinion at component grain, not whole-track pass/fail
  // The keep/kill card is gone; the human's seven per-lane sliders (s.laneMood)
  // are the feedback. Each step the DJ acts on the strongest opinion; with no
  // strong opinion it makes a small neutral move so the track keeps breathing.
  // Returns { desc } — A&R never reverts, so there's no snapshot to keep.
  DJEngine.prototype.steerStep = function () {
    const s = this.song;
    if (!s) return null;
    let desc = steerByOpinion(s);
    if (!desc) {
      const g = s.genome, r = s.rng;
      const inact = inactiveIdxs(g).filter((i) => !(s.laneMood && s.laneMood[i] < -0.3));
      if (inact.length && activeCount(g) < 4) {
        // still thin — reliably build the skeleton so the session always moves
        const i = inact[0];
        g.active[i] = true; g.variant[i] = Rng.int(r, 0, 5); s.lastAdded = i;
        desc = '➕ building — brought in ' + STAGES[i].label;
      } else {
        const d = droppableIdxs(g);
        if (d.length) { const i = Rng.pick(r, d); g.variant[i] += 1 + Rng.int(r, 0, 2); desc = '🔀 idling — reworked ' + STAGES[i].label; }
        else desc = 'holding on the kick';
      }
    }
    s.pending = null;
    return { desc: desc };
  };

  SDJ.DJEngine = DJEngine;
  SDJ.STAGES = STAGES;
  SDJ.LANE_COLORS = LANE_COLORS;
  SDJ.FILL_IDX = FILL_IDX;
  SDJ.FILL_COLOR = FILL_COLOR;
  SDJ.FILL_NAMES = FILL_NAMES;
  SDJ.FX_BITS = FX_BITS;
  SDJ.FX_NAMES = FX_NAMES;
})(window.SDJ = window.SDJ || {});
