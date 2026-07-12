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
    return { active: g.active.slice(), variant: g.variant.slice(), energyIdx: g.energyIdx, bank: g.bank };
  }
  function restoreGenome(g, snap) {
    g.active = snap.active.slice();
    g.variant = snap.variant.slice();
    g.energyIdx = snap.energyIdx;
    g.bank = snap.bank;
  }

  function DJEngine() {
    this.song = null;
    this.masterSeed = (Math.random() * 1e9) >>> 0;
    this.songCount = 0;
    this.banksLoaded = false; // flipped true by app.js once the kit map loads
  }

  // ---- lifecycle ---------------------------------------------------------

  DJEngine.prototype.newSong = function () {
    this.songCount += 1;
    const seed = (this.masterSeed + this.songCount * 2654435761) >>> 0;
    const rng = Rng.make(seed);

    const song = {
      seed,
      rng,
      name: Names.generate(rng),
      key: Rng.pick(rng, Theory.ROOTS),
      scaleType: Rng.pick(rng, Theory.SCALES),
      prog: Rng.pick(rng, Theory.PROGRESSIONS),
      bpm: Rng.int(rng, 120, 140),
      // the genome the DJ optimises
      genome: {
        active: [true, false, false, false, false, false, false], // open on the kick
        variant: [0, 0, 0, 0, 0, 0, 0],
        energyIdx: 1, // ENERGY_STEPS[1] = 0.4
        bank: Rng.int(rng, 0, BANKS.length - 1), // which drum machine
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
      lastVerdict: null, // { kind, delta, desc } of the last judged mutation
      verdictSeq: 0,     // bumped each judged mutation so the UI can spot new ones
      rev: 0,            // bumped when a curveball changes a song-level musical param
      propCount: 0,      // proposals made (drives the tabu clock)
      tabu: {},          // layer index -> propCount at which it's free again
      aversion: {},      // layer index -> learned dislike (grows on revert, decays on keep)
      flatStreak: 0,     // consecutive flat/rejected verdicts -> boredom -> curveball
      banksLoaded: !!this.banksLoaded, // snapshot so the pure engine test stays kit-free
    };
    song.cps = song.bpm / 240; // 1 cycle = 1 bar = 4 beats
    this.song = song;
    this._lastSig = null;
    return song;
  };

  // ---- the optimiser -----------------------------------------------------

  // Advance by `dt` seconds given the crowd's `mood` (energy, -1..1) and
  // optional `warmth` (-1..1). Returns { changed, events, hit }: `changed` =>
  // re-evaluate the code, `hit` => the crowd approved a finished track.
  DJEngine.prototype.tick = function (mood, dt, warmth) {
    const s = this.song;
    if (!s) return { changed: false, events: [], hit: false };
    const events = [];
    s.age += dt;
    if (typeof warmth === 'number') s.warmth = warmth;

    // Fitness signal: a responsive EMA of the crowd's mood, mapped to 0..100.
    // Warmth gently nudges it, but the energy axis is what the DJ climbs.
    const inst = clamp((mood + 1) * 50 + s.warmth * 6, 0, 100);
    s.approval += (inst - s.approval) * 0.25;

    s.trialTime += dt;

    if (s.trialTime >= TRIAL) {
      // ---- judge the mutation we've been auditioning --------------------
      if (s.pending) {
        const delta = s.approval - s.trialBase;
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
    s.scaleType = Rng.pick(r, Theory.SCALES);
    s.rev += 1;
    return '🎲 shifted the mood — new scale colour';
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
    const inact = tabuFree(s, inactiveIdxs(g));
    const drop = tabuFree(s, droppableIdxs(g));
    let desc = null;
    const warm = s.warmth || 0;
    s.propCount += 1;

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
      // locked in — don't rock the boat; occasionally tease one layer
      if (drop.length && Rng.chance(r, 0.3)) {
        const i = Rng.pick(r, drop);
        reshape(i);
        desc = '🎯 locked in — teasing ' + STAGES[i].label;
      }
      // else hold (no change)
    } else if (s.approval >= WARM) {
      // crowd's with it -> build the track up, in order, toward full.
      // Warmth makes it reach for the next layer more eagerly.
      if (inact.length && Rng.chance(r, clamp(0.72 + warm * 0.15, 0.3, 0.96))) {
        add(inact[0]);
        desc = '➕ brought in ' + STAGES[inact[0]].label;
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
      const t = s.temp;
      const roll = clamp(r() - warm * 0.2, 0, 1);
      if (roll < 0.42) {
        const i = Rng.int(r, 1, MAX_STAGE);
        if (g.active[i]) {
          const preferAdd = warm > 0.25 && inact.length;
          if (preferAdd) {
            const j = Rng.pick(r, inact);
            add(j);
            desc = '➕ warmed it up — brought in ' + STAGES[j].label;
          } else if (drop.length > 1 && !isTabu(s, i)) {
            dropOne(i);
            desc = '➖ dropped ' + STAGES[i].label;
          } else if (inact.length) {
            const j = Rng.pick(r, inact);
            add(j);
            desc = '➕ brought in ' + STAGES[j].label;
          }
        } else if (!isTabu(s, i)) {
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
    ].join(':');
  };

  // ---- rendering: genome -> Strudel code --------------------------------

  DJEngine.prototype.render = function () {
    const s = this.song;
    const g = s.genome;
    const e = ENERGY_STEPS[g.energyIdx]; // 0..1 intensity
    const bucket = Math.round(e * 3);    // 1..3 in practice

    const key = s.key;
    const scale = s.scaleType;
    const rootSeq = Theory.rootSeq(s.prog);
    const chordSeq = Theory.chordSeq(s.prog);
    const scl = (oct) => '"' + Theory.scaleName(key, oct, scale) + '"';

    // Drum machine: only reach for a bank once the kit map has actually loaded,
    // otherwise the default dirt-samples kick/snare/hat play (never silence).
    const useBank = !!this.banksLoaded && BANKS.length;
    const bankName = useBank ? BANKS[g.bank % BANKS.length] : null;
    const kit = (str) => (bankName ? str + '.bank("' + bankName + '")' : str);

    // Each layer's character is seeded on its own variant, so it's stable until
    // that specific layer is reshaped; energy scales its intensity.
    const lrng = (i) =>
      Rng.make((s.seed ^ ((i + 1) * 0x9e3779b1) ^ (g.variant[i] * 0x85ebca77)) >>> 0);

    const layers = [];
    const lineLayers = []; // stage index for each body line — the A&R code map
    const put = (i, code) => { layers.push(code + '.color("' + LANE_COLORS[i] + '")'); lineLayers.push(i); };
    const on = (i) => g.active[i];

    // 0 — kick: four-on-the-floor, euclidean pushes and a little drive up top.
    if (on(0)) {
      const kr = lrng(0);
      let pat = 'bd*4';
      if (bucket >= 2) {
        pat = Rng.pick(kr, ['bd*4', 'bd*4', 'bd(<5 4>,8)', 'bd(3,8) bd', 'bd*2 [~ bd] bd bd']);
      }
      let kick = 's("' + pat + '").gain(' + n2(0.85 + e * 0.1) + ')';
      if (bucket >= 3 && Rng.chance(kr, 0.4)) kick += '.shape(' + n2(0.12 + e * 0.18) + ')';
      put(0, kit(kick));
    }

    // 1 — hi-hats: density tracks energy; the DJ picks a straight, euclidean or
    // noise-shaker voice, so this layer can sound quite different when reshaped.
    if (on(1)) {
      const hr = lrng(1);
      const dens = 8 + bucket * 2; // 10..14
      const voice = Rng.int(hr, 0, 2);
      if (voice === 0) {
        put(1,
          kit('s("hh*' + dens + '").gain(' + n2(0.18 + e * 0.2) + ').pan(sine.range(0.35,0.65))')
        );
      } else if (voice === 1) {
        put(1,
          kit('s("hh(' + (dens - 1) + ',16)").gain(' + n2(0.18 + e * 0.2) + ').pan(perlin.range(0.4,0.6))')
        );
      } else {
        // synth shaker from filtered noise — always available, no samples
        put(1,
          's("white*' + dens + '").decay(0.03).sustain(0).hpf(' + (7000 + bucket * 800) +
            ').gain(' + n2(0.1 + e * 0.12) + ').pan(sine.range(0.4,0.6))'
        );
      }
      if (bucket >= 2 && Rng.chance(hr, 0.55)) {
        put(1, kit('s("~ ~ oh ~").gain(' + n2(0.15 + e * 0.15) + ')')); // open hat accent
      }
    }

    // 2 — bass: root-per-bar; the DJ picks a saw, an enveloped square or an FM
    // voice, and the groove thickens with energy.
    if (on(2)) {
      const br = lrng(2);
      const light = ['x ~ ~ ~ x ~ ~ ~', 'x ~ ~ x x ~ ~ ~'];
      const heavy = ['x ~ x ~ x ~ x x', 'x x ~ x x ~ x x'];
      const struct = bucket <= 1 ? Rng.pick(br, light) : Rng.pick(br, heavy);
      const cut = Math.round(280 + e * 1900);
      let bass = 'n("' + rootSeq + '").scale(' + scl(2) + ').struct("' + struct + '")';
      const voice = Rng.int(br, 0, 2);
      if (voice === 0) {
        bass += '.sound("sawtooth").lpf(' + cut + ').lpq(' + n2(4 + e * 8) + ')';
      } else if (voice === 1) {
        bass += '.sound("square").lpf(' + cut + ').lpenv(' + n2(2 + e * 2) + ').lpattack(0.02)';
      } else {
        bass += '.sound("sine").fm(' + n2(1.5 + e * 4) + ').fmh(' + Rng.int(br, 1, 2) +
          ').lpf(' + Math.round(cut * 1.3) + ')';
      }
      put(2, bass + '.gain(' + n2(0.7 + e * 0.1) + ')');
    }

    // 3 — clap/snare on the backbeat; pattern and a touch of pitch vary.
    if (on(3)) {
      const cr = lrng(3);
      const hit = Rng.chance(cr, 0.5) ? 'cp' : 'sd';
      const pat = Rng.pick(cr, [
        '~ ' + hit + ' ~ ' + hit,
        '~ ' + hit + ' ~ [' + hit + ' ' + hit + ']',
        '~ ' + hit + ' ~ ' + hit + '*2',
      ]);
      let clap = 's("' + pat + '").gain(' + n2(0.42 + e * 0.12) + ').room(' + n2(0.2 + (1 - e) * 0.2) + ')';
      if (Rng.chance(cr, 0.3)) clap += '.speed(' + n2(0.9 + Rng.int(cr, 0, 3) * 0.1) + ')';
      put(3, kit(clap));
    }

    // 4 — chords: pad-like triads. Gentle by default so a fresh chord layer
    // settles rather than slamming. Kept soft on purpose (see below) so it never
    // honks; reshape walks the wave/filter within the pad-safe range.
    if (on(4)) {
      const chr = lrng(4);
      // A proper pad, not a blare. A raw sawtooth triad with a fast attack reads
      // as nasal/"honky", so: soft waveform (triangle/sine only), a slow swell
      // instead of a snap, and a darker filter kept below the ~1.5 kHz honk band.
      // No FM/vowel either — both clang on a stacked triad.
      const wave = Rng.pick(chr, ['triangle', 'sine']);
      const cut = Math.round(700 + e * 800);           // 700..1500, below the honk band
      const atk = n2(0.2 + Rng.int(chr, 0, 3) * 0.12); // 0.2..0.56s swell
      put(4,
        'n("' + chordSeq + '").scale(' + scl(3) + ').sound("' + wave +
          '").lpf(' + cut + ').attack(' + atk + ').release(' + n2(0.5 + (1 - e) * 0.5) +
          ').gain(0.2).room(' + n2(0.4 + (1 - e) * 0.25) + ')'
      );
    }

    // 5 — lead melody: a scale-degree cell; the wave, an FM option, delay and a
    // little crush give each reshape a distinct voice.
    if (on(5)) {
      const lr = lrng(5);
      const cell = Theory.MELODY_CELLS[g.variant[5] % Theory.MELODY_CELLS.length];
      const wave = Rng.pick(lr, ['triangle', 'sawtooth', 'square']);
      let lead = 'n("' + cell + '").scale(' + scl(5) + ').sound("' + wave + '")';
      if (Rng.chance(lr, 0.4)) lead += '.fm(' + n2(1 + e * 3) + ').fmh(' + Rng.int(lr, 1, 3) + ')';
      lead += '.gain(' + n2(0.3 + e * 0.14) + ').room(0.3)';
      if (e > 0.55) lead += '.delay(0.35).delaytime(0.1875).delayfeedback(' + n2(0.3 + e * 0.1) + ')';
      if (e < 0.35) lead += '.degradeBy(0.3)';
      if (Rng.chance(lr, 0.25)) lead += '.crush(' + Rng.int(lr, 6, 12) + ')';
      put(5, lead);
    }

    // 6 — atmosphere: either a slow sine pad or a breathy noise wash that
    // widens the space. Both sit low and open up the top end.
    if (on(6)) {
      const ar = lrng(6);
      if (Rng.chance(ar, 0.5)) {
        const col = Rng.pick(ar, ['pink', 'brown']);
        put(6,
          's("' + col + '").gain(' + n2(0.06 + e * 0.06) + ').lpf(' + Math.round(1200 + e * 2000) +
            ').hpf(300).room(0.8)'
        );
      } else {
        put(6,
          'n("' + rootSeq + '").scale(' + scl(5) +
            ').sound("sine").slow(2).gain(0.12).lpf(1200).room(0.7)'
        );
      }
    }

    const body = layers.join(',\n  ');
    this._lastLayers = lineLayers; // body-line -> stage index, for A&R highlighting
    return 'setcps(' + n2(s.cps) + ')\nstack(\n  ' + body + '\n)';
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
      stage: highestActive(g),
      maxStage: MAX_STAGE,
      stageLabel: STAGES[highestActive(g)].label,
      stageKeys: STAGES.map((x) => x.key),
      activeLayers: g.active.slice(),
      activeCount: act,
      energy: ENERGY_STEPS[g.energyIdx],
      approval: s.approval,
      hitProgress: clamp(s.hitTimer / HIT_SECONDS, 0, 1),
      mode: mode,
      temp: s.temp,
      warmth: s.warmth,
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

    // Hard constraint: a killed *add* keeps that instrument out for the song.
    // Reworks are an endless well — killing one only spaces it out (tabu), never
    // bans it, so the session can't dead-end while any layer is still playable.
    const addable = inactiveIdxs(g).filter((i) => !s.banned['add:' + i]);
    const reshapeable = droppableIdxs(g);
    if (!addable.length && !reshapeable.length) { s.pending = null; return null; }

    // Soft spacing: don't re-pitch a just-touched layer (that's what caused the
    // "rework the clap ×5" spam). Relax it only if it would leave nothing to
    // offer, so there's always a move.
    const free = (i) => (s.vtabu[i] || 0) <= s.vprop;
    let addPool = addable.filter(free);
    let reshapePool = reshapeable.filter(free);
    if (!addPool.length && !reshapePool.length) { addPool = addable; reshapePool = reshapeable; }

    // build the arrangement first, rework once it's fleshed out
    const choice = addPool.length && (!reshapePool.length || Rng.chance(r, 0.6)) ? 'add' : 'reshape';

    let layer, dir, desc, banKey;
    if (choice === 'add') {
      layer = addPool[0]; // bring layers in, in arrangement order
      g.active[layer] = true;
      g.variant[layer] = Rng.int(r, 0, 5);
      dir = 1;
      desc = 'bring in ' + STAGES[layer].label;
      banKey = 'add:' + layer;
    } else {
      layer = Rng.pick(r, reshapePool);
      g.variant[layer] += 1 + Rng.int(r, 0, 2);
      dir = 0;
      desc = 'rework ' + STAGES[layer].label;
      banKey = 'reshape:' + layer;
    }
    s.vtabu[layer] = s.vprop + 2; // hold this layer out of the next couple of pitches
    s.pending = { snapshot: snapshot, desc: desc, layer: layer, dir: dir, kind: choice, banKey: banKey };
    return { desc: desc, layer: layer, dir: dir, kind: choice };
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
    if (p.kind === 'add') {
      s.banned[p.banKey] = true;             // a killed instrument stays out for the song
    } else {
      s.vtabu[p.layer] = (s.vprop || 0) + 3; // a killed rework: try a different idea before this layer again
    }
    s.pending = null;
    (s.voteLog = s.voteLog || []).push({ v: 'down', desc: p.desc });
    return p;
  };

  SDJ.DJEngine = DJEngine;
  SDJ.STAGES = STAGES;
})(window.SDJ = window.SDJ || {});
