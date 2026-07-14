// theory.js — music theory for the DJ engine, tuned for elite modern hip-hop.
// Covers trap, boom bap, drill, R&B and lo-fi. Roots, scales, progressions and
// voicings are all chosen from the palette of working producers, not textbooks.
(function (SDJ) {
  'use strict';

  // All 12 chromatic roots. Flat keys dominate hip-hop: Bb minor, Eb minor and
  // Ab minor are bread-and-butter trap territory; F# / Db add edge.
  const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Scales that actually appear in elite hip-hop production.
  // phrygian dominant gives the dark Spanish/Middle-Eastern colour common in
  // trap and drill. Blues adds soul and grit. Dorian sits in the R&B sweet spot.
  const SCALES = [
    'minor',              // natural minor — the default dark canvas
    'dorian',             // minor with raised 6th — smooth R&B / neo-soul
    'phrygian',           // flat 2nd — sinister, street
    'harmonicMinor',      // raised 7th — dramatic, cinematic
    'minorPentatonic',    // five-note — clean hooks, sample-friendly
    'blues',              // minor pentatonic + flat 5 — grit and soul
    'phrygian dominant',  // flat 2nd + major 3rd — dark flamenco trap
    'mixolydian',         // major with flat 7 — gospel warmth
  ];

  // Hip-hop chord progressions — expressed as scale-degree roots.
  // Modern trap and hip-hop lean on 2–4 chord dark loops; they dwell on tonic
  // and borrow parallel-minor colour to create unease or emotional weight.
  const PROGRESSIONS = [
    [0, 6, 3, 4],   // i – VII – iv – v     classic dark trap
    [0, 6, 5, 3],   // i – VII – VI – iv    descending soul
    [0, 5, 6, 4],   // i – VI – VII – v     emotional minor arc
    [0, 3, 6, 5],   // i – iv – VII – VI    R&B / neo-soul turn
    [0, 5],         // i – VI               2-chord dark drone (trap staple)
    [0, 6],         // i – VII              2-chord sinister loop
    [0, 3],         // i – iv               2-chord melancholic
    [0, 5, 0, 4],   // i – VI – i – v       pedal hook
    [0, 3, 5, 4],   // i – iv – VI – v      classic R&B
    [3, 6, 0, 5],   // iv – VII – i – VI    resolved lift
    [0, 6, 0, 5],   // i – VII – i – VI     rocking tension
    [0, 2, 3, 4],   // i – III – iv – v     modal, brooding
    [5, 3, 0, 6],   // VI – iv – i – VII    reverse dark
    [0, 0, 6, 5],   // i – i – VII – VI     tonic hold then fall
    [0, 4, 5, 3],   // i – v – VI – iv      emotional turn
  ];

  // Melodic cells — hip-hop phrasing: sparse, syncopated, breathe-heavy.
  // [] groups create triplets; <> alternate between two phrases each cycle.
  // Space (rests ~) is a first-class musical element here — silence sells.
  const MELODY_CELLS = [
    '~ ~ 0 ~ ~ 4 ~ ~',              // sparse two-note hook
    '0 ~ ~ ~ 4 ~ ~ 3',              // big space, emotional landing
    '0 ~ 3 ~ 5 ~ 3 0',              // minor pentatonic loop
    '7 ~ ~ 5 4 ~ ~ 2',              // descending pull
    '~ 7 ~ 5 ~ 4 ~ 2',              // falling from the top
    '0 ~ 2 0 ~ 3 ~ 0',              // root-bounce hook
    '~ 3 0 ~ 5 ~ 4 3',              // soulful curve
    '4 ~ 3 ~ 2 ~ 0 ~',              // slow descend
    '0 4 ~ 7 ~ 5 4 ~',              // trap jump
    '~ ~ 4 5 ~ 4 2 ~',              // suspension release
    '[0 2 4] ~ ~ 5 ~ 4 2 ~',        // triplet opener
    '~ 5 ~ 4 [2 3 2] ~ 0 ~',        // triplet ornament
    '0 ~ ~ [2 3] ~ 4 ~ 5',          // slide into phrase
    '0*2 ~ 3 ~ 5 7 ~',              // stutter start
    '~ ~ ~ 0 4 ~ 5 ~',              // late entry hook
    '7 5 4 ~ 2 ~ 0 ~',              // step-down melody
    '0 ~ 4 ~ ~ 3 5 ~',              // trap float
    '<0 7> ~ 3 ~ 5 ~ 4 ~',          // octave alternation hook
    '0 ~ <2 4> ~ 5 ~ 3 ~',          // alternating passing note
    '~ ~ 5 ~ 4 3 ~ 0',              // late resolution
  ];

  // Drum machines — 808 leads because it defines modern hip-hop; 909 for energy.
  const DRUM_BANKS = ['RolandTR808', 'RolandTR909', 'RolandTR707', 'AkaiLinn'];

  // Genre colours — steer BPM range and how every layer is rendered.
  const GENRES = [
    { id: 'trap',    bpmLo: 130, bpmHi: 155, label: 'Trap'     },
    { id: 'boomBap', bpmLo: 85,  bpmHi: 100, label: 'Boom Bap' },
    { id: 'drill',   bpmLo: 138, bpmHi: 148, label: 'Drill'    },
    { id: 'loFi',    bpmLo: 70,  bpmHi: 90,  label: 'Lo-Fi'    },
    { id: 'rb',      bpmLo: 95,  bpmHi: 115, label: 'R&B'      },
  ];

  const Theory = {
    ROOTS,
    SCALES,
    PROGRESSIONS,
    MELODY_CELLS,
    DRUM_BANKS,
    GENRES,

    // Build a Strudel scale string, e.g. "C3:minor"
    scaleName(root, octave, type) {
      return root + octave + ':' + type;
    },

    // Triad rooted on scale degree d: d, d+2, d+4
    triad(d) {
      return d + ',' + (d + 2) + ',' + (d + 4);
    },

    // 7th chord (four stacked scale degrees) — R&B / neo-soul depth
    seventh(d) {
      return d + ',' + (d + 2) + ',' + (d + 4) + ',' + (d + 6);
    },

    // Per-cycle root sequence: [0,5,3,4] -> "<0 5 3 4>"
    rootSeq(prog) {
      return '<' + prog.join(' ') + '>';
    },

    // Per-cycle triad sequence
    chordSeq(prog) {
      return '<' + prog.map((d) => '[' + Theory.triad(d) + ']').join(' ') + '>';
    },

    // Per-cycle 7th-chord sequence
    seventhSeq(prog) {
      return '<' + prog.map((d) => '[' + Theory.seventh(d) + ']').join(' ') + '>';
    },
  };

  SDJ.Theory = Theory;
})(window.SDJ = window.SDJ || {});
