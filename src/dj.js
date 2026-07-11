// dj.js — the DJ's brain.
//
// Holds the live song as structured state, mutates it every "tick" in
// response to the crowd-mood value, and renders that state into a live
// Strudel program string. The crowd mood is the single input that steers
// evolution:
//
//   mood high   -> crowd loves it: build up, add layers, raise energy
//   mood low    -> crowd cooling: strip back / change direction
//   mood steady & song fully built -> it's a banger: save it, start fresh
//
(function (SDJ) {
  'use strict';

  const Rng = SDJ.Rng;
  const Theory = SDJ.Theory;
  const Names = SDJ.Names;

  // Build stages — each unlocks another layer of the arrangement.
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

  const HIT_SECONDS = 10; // how long the crowd must stay hyped on a full song

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }
  function n2(x) {
    return Math.round(x * 100) / 100;
  }

  function DJEngine() {
    this.song = null;
    this.masterSeed = (Math.random() * 1e9) >>> 0;
    this.songCount = 0;
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
      stage: 0, // start with just the kick
      variation: 0, // bumps drive lateral changes (new melody/groove)
      energy: 0.35, // smoothed crowd energy (0..1)
      moodAvg: 0, // slow-moving average of raw mood (-1..1)
      approval: 20, // the hype meter (0..100)
      hitTimer: 0, // seconds the crowd has held a full song at high approval
      age: 0, // seconds since the song began
    };
    song.cps = song.bpm / 240; // 1 cycle = 1 bar = 4 beats
    this.song = song;
    this._lastSig = null;
    return song;
  };

  // ---- evolution ---------------------------------------------------------

  // Advance the song by `dt` seconds given the current crowd `mood` (-1..1).
  // Returns { changed, events, hit } where `changed` means the Strudel code
  // should be re-evaluated and `hit` means the crowd approved a finished song.
  DJEngine.prototype.tick = function (mood, dt) {
    const s = this.song;
    if (!s) return { changed: false, events: [], hit: false };
    const events = [];
    s.age += dt;

    // Smooth the crowd's energy and a slower approval average.
    const target = (mood + 1) / 2; // 0..1
    s.energy += (target - s.energy) * 0.28;
    s.moodAvg += (mood - s.moodAvg) * 0.15;
    s.approval = clamp(s.approval + mood * 6, 0, 100);

    // --- steer the arrangement ------------------------------------------
    // Crowd is into it: build up (add a layer) or keep it fresh (mutate).
    if (mood > 0.2) {
      const drive = (mood - 0.2) / 0.8; // 0..1
      if (s.stage < MAX_STAGE && Math.random() < 0.15 + drive * 0.4) {
        s.stage += 1;
        events.push('➕ layered in ' + STAGES[s.stage].label);
      } else if (Math.random() < 0.08 + drive * 0.14) {
        s.variation += 1;
        events.push('🔀 rode the energy — switched up the groove');
      }
    }
    // Crowd cooling: strip back a layer, or change direction entirely.
    else if (mood < -0.25) {
      const cool = (-0.25 - mood) / 0.75; // 0..1
      if (Math.random() < 0.1 + cool * 0.3) {
        if (s.stage > 0 && Math.random() < 0.6) {
          const dropped = STAGES[s.stage].label;
          s.stage -= 1;
          events.push('➖ read the room — stripped back ' + dropped);
        } else {
          s.variation += 1;
          events.push('🧊 changed direction to win them back');
        }
      }
    }
    // Neutral: occasional gentle drift so it never feels static.
    else if (Math.random() < 0.1) {
      s.variation += 1;
      events.push('🔀 subtle variation');
    }

    // --- banger detection ------------------------------------------------
    // Fully built + crowd holding approval high => save it and move on.
    const gate = s.moodAvg >= 0.4 && s.stage >= MAX_STAGE - 1;
    if (gate) {
      s.hitTimer += dt;
    } else {
      s.hitTimer = Math.max(0, s.hitTimer - dt * 2);
    }
    const hit = s.hitTimer >= HIT_SECONDS;

    // Only re-render when something musically meaningful changed.
    const sig = this._signature();
    const changed = sig !== this._lastSig;
    if (changed) this._lastSig = sig;

    return { changed, events, hit };
  };

  // A compact fingerprint of everything that affects the rendered code.
  // When it changes, we re-evaluate; small mood jitters don't thrash.
  DJEngine.prototype._signature = function () {
    const s = this.song;
    const bucket = Math.round(s.energy * 4); // 0..4 energy steps
    return [s.seed, s.stage, s.variation, bucket].join(':');
  };

  // ---- rendering: state -> Strudel code ---------------------------------

  DJEngine.prototype.render = function () {
    const s = this.song;
    const bucket = Math.round(s.energy * 4); // 0..4
    const e = s.energy; // 0..1 continuous
    const r = Rng.make((s.seed ^ (s.variation * 2654435761)) >>> 0);

    const key = s.key;
    const scale = s.scaleType;
    const rootSeq = Theory.rootSeq(s.prog);
    const chordSeq = Theory.chordSeq(s.prog);
    const scl = (oct) => '"' + Theory.scaleName(key, oct, scale) + '"';

    const layers = [];
    const has = (i) => s.stage >= i;

    // 0 — kick: four-on-the-floor, with an occasional euclidean push.
    if (has(0)) {
      const kick =
        bucket >= 3 && Rng.chance(r, 0.4)
          ? 's("bd(<5 4>,8)")'
          : 's("bd*4")';
      layers.push(kick + '.gain(' + n2(0.85 + e * 0.1) + ')');
    }

    // 1 — hi-hats: density and brightness track energy.
    if (has(1)) {
      const dens = 8 + bucket * 2; // 8..16
      layers.push(
        's("hh*' + dens + '").gain(' +
          n2(0.18 + e * 0.2) +
          ').pan(sine.range(0.35,0.65))'
      );
      if (bucket >= 3) {
        layers.push('s("~ ~ oh ~").gain(' + n2(0.15 + e * 0.15) + ')');
      }
    }

    // 2 — bass: root-per-bar with a groove that thickens as energy rises.
    if (has(2)) {
      const struct =
        bucket <= 1
          ? '"x ~ ~ ~ x ~ ~ ~"'
          : bucket === 2
          ? '"x ~ ~ x x ~ ~ ~"'
          : bucket === 3
          ? '"x ~ x ~ x ~ x x"'
          : '"x x ~ x x ~ x x"';
      const cut = Math.round(280 + e * 1900);
      layers.push(
        'n(' +
          '"' + rootSeq + '"' +
          ').scale(' +
          scl(2) +
          ').struct(' +
          struct +
          ').sound("sawtooth").lpf(' +
          cut +
          ').gain(' +
          n2(0.7 + e * 0.1) +
          ')'
      );
    }

    // 3 — clap on the backbeat (beats 2 & 4).
    if (has(3)) {
      layers.push(
        's("~ cp ~ cp").gain(' + n2(0.42 + e * 0.12) + ').room(0.25)'
      );
    }

    // 4 — chords: pad-like triads following the progression.
    if (has(4)) {
      const cut = Math.round(600 + e * 2200);
      layers.push(
        'n(' +
          '"' + chordSeq + '"' +
          ').scale(' +
          scl(3) +
          ').sound("square").lpf(' +
          cut +
          ').attack(0.05).release(0.35).gain(0.3).room(' +
          n2(0.25 + (1 - e) * 0.3) +
          ')'
      );
    }

    // 5 — lead melody: a scale-degree cell, sparser when the crowd is flat.
    if (has(5)) {
      const cell = Theory.MELODY_CELLS[s.variation % Theory.MELODY_CELLS.length];
      let lead =
        'n("' +
        cell +
        '").scale(' +
        scl(5) +
        ').sound("triangle").gain(' +
        n2(0.34 + e * 0.14) +
        ').room(0.3)';
      if (e > 0.55) lead += '.delay(0.35).delaytime(0.1875).delayfeedback(0.35)';
      if (e < 0.35) lead += '.degradeBy(0.3)';
      layers.push(lead);
    }

    // 6 — atmosphere: a slow high pad that widens the space.
    if (has(6)) {
      layers.push(
        'n("' +
          rootSeq +
          '").scale(' +
          scl(5) +
          ').sound("sine").slow(2).gain(0.12).lpf(1200).room(0.7)'
      );
    }

    const body = layers.join(',\n  ');
    return 'setcps(' + n2(s.cps) + ')\nstack(\n  ' + body + '\n)';
  };

  // ---- snapshot for UI/viz ----------------------------------------------

  DJEngine.prototype.state = function () {
    const s = this.song;
    return {
      name: s.name,
      key: s.key,
      scaleType: s.scaleType,
      bpm: s.bpm,
      cps: s.cps,
      stage: s.stage,
      maxStage: MAX_STAGE,
      stageLabel: STAGES[s.stage].label,
      stageKeys: STAGES.map((x) => x.key),
      energy: s.energy,
      approval: s.approval,
      hitProgress: clamp(s.hitTimer / HIT_SECONDS, 0, 1),
      age: s.age,
    };
  };

  SDJ.DJEngine = DJEngine;
  SDJ.STAGES = STAGES;
})(window.SDJ = window.SDJ || {});
