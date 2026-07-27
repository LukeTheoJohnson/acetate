// theory.js — music theory for the DJ engine, tuned for elite modern hip-hop.
// Covers trap, boom bap, drill, R&B and lo-fi. Roots, scales, progressions and
// voicings are all chosen from the palette of working producers, not textbooks.
(function (SDJ) {
  'use strict';

  // All 12 chromatic roots. Flat keys dominate hip-hop: Bb minor, Eb minor and
  // Ab minor are bread-and-butter trap territory; F# / Db add edge.
  const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // The full mode palette the engine can draw on — dark through bright. Genres
  // pull a genre-appropriate SUBSET of these (see GENRE_SCALES / GENRES[].scales),
  // so the mood widens across the set while each genre keeps its own character.
  // Every name here must be a valid tonal scale name — Strudel resolves scales
  // through tonal, which uses SPACE-separated names ("minor pentatonic"), NOT
  // camelCase. A camelCase name resolves to nothing and the whole n(...) layer
  // renders SILENT (zero events) while still showing in the code — no error.
  const SCALES = [
    'minor',              // natural minor — the default dark canvas
    'dorian',             // minor with raised 6th — smooth R&B / neo-soul
    'phrygian',           // flat 2nd — sinister, street
    'harmonic minor',     // raised 7th — dramatic, cinematic
    'melodic minor',      // raised 6th & 7th — jazzy minor lift
    'minor pentatonic',   // five-note — clean hooks, sample-friendly
    'blues',              // minor pentatonic + flat 5 — grit and soul
    'phrygian dominant',  // flat 2nd + major 3rd — dark flamenco trap
    'mixolydian',         // major with flat 7 — gospel warmth
    'major',              // bright, open — soul / pop-leaning hooks
    'major pentatonic',   // bright five-note — clean, singable
    'lydian',             // raised 4th — dreamy, floating
  ];

  // Per-genre mood palette — the subset of SCALES a genre draws on. This is how a
  // genre keeps dictating the mood (trap/drill stay dark, R&B/lo-fi stay warm)
  // while still giving every track a genuinely different colour within that lane.
  // Order is loosely most- to least-characteristic; the pick is uniform.
  const GENRE_SCALES = {
    trap:    ['minor', 'phrygian', 'phrygian dominant', 'harmonic minor', 'minor pentatonic'],
    drill:   ['phrygian', 'phrygian dominant', 'harmonic minor', 'minor'],
    boomBap: ['dorian', 'minor pentatonic', 'blues', 'mixolydian', 'minor'],
    loFi:    ['dorian', 'minor pentatonic', 'mixolydian', 'major', 'major pentatonic', 'minor'],
    rb:      ['dorian', 'mixolydian', 'major', 'minor pentatonic', 'melodic minor'],
  };

  // Hip-hop chord progressions — expressed as scale-degree roots. Read as minor
  // in a dark scale and as bright/major in a major-family scale (same degrees,
  // different colour), so the mood palette above does the heavy lifting.
  // Modern trap leans on 2–4 chord loops that dwell on the tonic; the brighter
  // turns near the end give major/mixolydian tracks somewhere warm to go.
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
    [0, 4, 5, 4],   // I – V – vi – V       bright pop lift (in major)
    [0, 3, 4, 0],   // I – IV – V – I       resolved cadence
    [0, 4, 3, 4],   // I – V – IV – V       gospel / rock vamp
    [0, 2, 4, 5],   // i – III – v – VI     modal climb
    [0, 5, 4, 3],   // i – VI – v – iv      long fall
    [0, 6, 4, 5],   // i – VII – v – VI     suspended lift
    [3, 4, 0, 0],   // iv – v – i – i       plagal-style resolve
  ];

  // Melodic cells — hip-hop phrasing: sparse, syncopated, breathe-heavy.
  // [] groups create triplets; <> alternate between two phrases each cycle.
  // Space (rests ~) is a first-class musical element here — silence sells.
  // The back half leans brighter/more rhythmic so major-family tracks get hooks
  // that don't all read as the same dark two-note motif.
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
    '0 ~ 2 4 ~ 5 4 ~',              // ascending bright hook
    '~ 0 2 4 ~ 5 ~ 7',              // rising run to the octave
    '7 ~ 5 4 ~ 2 0 ~',              // bright top-down
    '0 2 4 ~ 5 4 2 0',              // wave up and back
    '~ 4 ~ 7 ~ 5 ~ 4',              // upper-register float
    '0 ~ ~ 5 ~ 7 5 4',              // leap then fall
    '0 ~ 4 2 ~ 5 ~ 3',              // zigzag contour
    '~ ~ 7 5 ~ 4 ~ 0',              // high entry, long fall
    '4 ~ 5 7 ~ 5 4 ~',              // climb to the peak
    '0 3 ~ 2 ~ 4 ~ 5',              // stepwise rise
    '<0 4> ~ <5 7> ~ 4 ~ 2 ~',      // alternating bright cells
    '2 ~ 0 ~ 4 ~ 5 7',              // pickup into a leap
    // — ornamented & rhythmic cells: grace notes, trills, triplet turns —
    '0 ~ [0 2] ~ 4 ~ [5 4] ~',      // grace-note pairs
    '~ [4 5] ~ 7 ~ [5 4] 2 ~',      // ornamented upper line
    '0*2 ~ 4*2 ~ 5 ~ 4',           // stutter accents
    '~ 0 ~ 2 ~ [3 4 5] ~ ~',        // triplet run up
    '7 ~ [7 5] 4 ~ [4 2] 0 ~',      // descending with grace notes
    '0 ~ 4 ~ [7 5 4] ~ 2 ~',        // triplet turn mid-phrase
    '~ ~ 0 [2 3] 4 ~ 5 ~',          // pickup ornament into the hook
    '4 [5 4] 2 ~ 0 ~ ~ 0',          // trill-head, settle on the root
    '<0 4 7> ~ 5 ~ 4 ~ 2 ~',        // three-way degree rotation
    '0 ~ 2 ~ 4 ~ [5 7] ~',          // clean rise into an octave lift
    '~ 5 [4 5] ~ 7 ~ 4 ~',          // hovering ornament up high
    '0 [2 0] ~ 4 [5 4] ~ 2 ~',      // call-heavy grace phrase
  ];

  // Two-bar phrases — a CALL and its RESPONSE. Rendered as "<[call] [resp]>" so
  // the lead alternates them each cycle: a question that answers itself instead
  // of one motif looping forever. Each half is a full 8-step bar; calls open and
  // leave space, responses resolve back toward the tonic. This is the main lever
  // that stops every lead reading as the same two-note hook.
  const MELODY_PHRASES = [
    ['~ ~ 0 ~ 2 ~ 4 ~', '5 ~ 4 ~ 2 ~ 0 ~'],       // rise, then resolve home
    ['0 ~ ~ 4 ~ 5 ~ ~', '~ 7 ~ 5 4 ~ 2 ~'],       // leap up, fall back
    ['0 2 4 ~ ~ ~ ~ ~', '~ ~ 4 2 ~ 3 ~ 0'],       // statement, echoed answer
    ['~ 4 ~ 5 ~ 7 ~ ~', '7 ~ 5 ~ 4 ~ 2 0'],       // climb, then cascade down
    ['0 ~ 3 ~ 5 ~ 3 ~', '4 ~ 2 ~ 0 ~ ~ ~'],       // pentatonic call, soft land
    ['[0 2 4] ~ 5 ~ 4 ~', '~ 2 ~ 4 3 ~ 0 ~'],     // triplet call, winding reply
    ['7 ~ ~ 5 ~ ~ 4 ~', '2 ~ 0 ~ ~ 0 ~ ~'],       // high hold, resolve to root
    ['0 ~ 4 ~ 7 ~ 5 ~', '4 ~ 5 ~ 4 2 ~ 0'],       // arpeggio up, melodic down
    ['~ ~ 5 4 ~ 2 ~ 0', '0 ~ 2 ~ 3 ~ 4 ~'],       // fall, answered rising
    ['0 0 ~ 2 ~ 4 ~ ~', '~ 5 4 ~ 2 ~ 0 ~'],       // stutter start, graceful fall
    ['4 ~ 3 ~ 4 ~ 5 ~', '7 ~ 5 ~ 4 ~ 3 ~'],       // hover, lift then settle
    ['<0 7> ~ 4 ~ 5 ~ ~', '~ 4 ~ 2 ~ 3 ~ 0'],     // octave call, resolving reply
    ['0 ~ 2 [3 4] ~ 5 ~', '5 4 ~ 2 ~ 0 ~ ~'],     // slide up, tumble down
    ['~ 5 ~ 7 ~ 5 4 ~', '2 ~ 4 ~ 2 ~ 0 ~'],       // upper float, gentle descent
    ['0 ~ ~ ~ 4 ~ 5 7', '~ 5 ~ 4 ~ 2 0 ~'],       // sparse leap, run home
    ['0 2 3 ~ 4 ~ 2 ~', '3 ~ 2 ~ 0 ~ ~ 0'],       // stepwise wander, cadence
  ];

  // Drum machines — 808 leads because it defines modern hip-hop; 909 for energy.
  const DRUM_BANKS = ['RolandTR808', 'RolandTR909', 'RolandTR707', 'AkaiLinn'];

  // Genre colours — steer BPM range, the mood palette (scales), and how every
  // layer is rendered.
  const GENRES = [
    { id: 'trap',    bpmLo: 130, bpmHi: 155, label: 'Trap',     scales: GENRE_SCALES.trap    },
    { id: 'boomBap', bpmLo: 85,  bpmHi: 100, label: 'Boom Bap', scales: GENRE_SCALES.boomBap },
    { id: 'drill',   bpmLo: 138, bpmHi: 148, label: 'Drill',    scales: GENRE_SCALES.drill   },
    { id: 'loFi',    bpmLo: 70,  bpmHi: 90,  label: 'Lo-Fi',    scales: GENRE_SCALES.loFi    },
    { id: 'rb',      bpmLo: 95,  bpmHi: 115, label: 'R&B',      scales: GENRE_SCALES.rb      },
  ];

  const Theory = {
    ROOTS,
    SCALES,
    GENRE_SCALES,
    PROGRESSIONS,
    MELODY_CELLS,
    MELODY_PHRASES,
    DRUM_BANKS,
    GENRES,

    // The mood palette for a genre — the subset of SCALES it draws on. Falls back
    // to the full palette for a genre with no declared mood set (or no genre).
    scalesFor(genre) {
      return (genre && genre.scales && genre.scales.length) ? genre.scales : SCALES;
    },

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

    // Chord voicings in scale-degree space, beyond the plain triad. Quartal
    // (stacked fourths) and shell (3rd + 7th, no 5th) are the neo-soul / modern
    // colours; sixth and ninth add extension depth; sus4 and spread open it up.
    // All stay inside the scale, so they never fight the mood palette.
    VOICINGS: ['triad', 'seventh', 'sixth', 'ninth', 'quartal', 'shell', 'sus4', 'spread'],
    voicing(kind, d) {
      switch (kind) {
        case 'seventh': return [d, d + 2, d + 4, d + 6];
        case 'sixth':   return [d, d + 2, d + 4, d + 5];
        case 'ninth':   return [d, d + 2, d + 4, d + 6, d + 8];
        case 'quartal': return [d, d + 3, d + 6];        // stacked fourths
        case 'shell':   return [d, d + 2, d + 6];        // 3rd + 7th, drop the 5th
        case 'sus4':    return [d, d + 3, d + 4];        // suspended 4th
        case 'spread':  return [d, d + 4, d + 9];        // open: root, 5th, 9th up top
        default:        return [d, d + 2, d + 4];        // triad
      }
    },

    // Per-cycle chord sequence in a named voicing, e.g. voicingSeq([0,5],'ninth')
    voicingSeq(prog, kind) {
      return '<' + prog.map((d) => '[' + Theory.voicing(kind, d).join(',') + ']').join(' ') + '>';
    },

    // A walking bassline for the progression: each chord's root, then a single
    // scale-step toward the next chord's root — the classic "walk into the one".
    // Stepwise motion keeps it valid in any scale (no octave-size assumptions),
    // and two notes per chord give the low end forward momentum.
    walkingSeq(prog) {
      const out = [];
      for (let i = 0; i < prog.length; i++) {
        const root = prog[i];
        const next = prog[(i + 1) % prog.length];
        const step = next > root ? 1 : next < root ? -1 : 1;
        out.push('[' + root + ' ' + (root + step) + ']');
      }
      return '<' + out.join(' ') + '>';
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
