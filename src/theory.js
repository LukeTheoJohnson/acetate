// theory.js — the small amount of music theory the DJ needs to sound good.
// The DJ works in scale degrees and lets Strudel's `.scale()` map them to
// real pitches, so everything stays in key no matter how it mutates.
(function (SDJ) {
  'use strict';

  const ROOTS = ['C', 'D', 'F', 'G', 'A', 'E'];

  const SCALES = ['minor', 'major', 'dorian', 'phrygian', 'harmonicMinor', 'mixolydian', 'lydian', 'minorPentatonic'];

  // Chord progressions expressed as scale-degree roots (one per bar/cycle).
  // Because they are degrees within the chosen scale, they work in any key.
  const PROGRESSIONS = [
    [0, 5, 3, 4], // i  VI  iv  v   — classic melancholic loop
    [0, 3, 4, 4], // i  iv  v   v
    [0, 6, 5, 4], // i  VII VI  v   — descending, epic
    [0, 4, 5, 3], // i  v   VI  iv
    [0, 0, 3, 5], // pedal then lift
    [5, 4, 0, 0], // VI  v   i   i
    [0, 2, 4, 5], // i  III v   VI  — brighter climb
    [0, 5, 6, 4], // i  VI  VII v
    [3, 4, 0, 5], // iv  v   i   VI
  ];

  // Melodic rhythm templates (scale degrees, `~` = rest). Chosen per variation.
  const MELODY_CELLS = [
    '0 ~ 2 4 ~ 3 5 ~',
    '7 5 4 2 0 ~ 2 ~',
    '0 2 4 5 4 2 0 ~',
    '~ 4 ~ 2 ~ 0 ~ 5',
    '0 ~ ~ 3 5 ~ 7 ~',
    '4 5 7 5 4 2 ~ 0',
    '0 3 5 7 <9 5> 4 2 0',
    '<0 4> 3 2 <5 7> 4 2 0',
    '7 ~ 5 ~ <4 2> ~ 0 ~',
    '0 5 <7 9> 5 4 ~ 2 ~',
    '~ 0 2 <4 5> ~ 7 5 4',
  ];

  // Classic drum machines available via .bank() once the sample map is loaded
  // (best-effort, at init). The DJ swaps between them to transform the kit's
  // whole character — a huge timbral lever for very little code.
  const DRUM_BANKS = ['RolandTR909', 'RolandTR808', 'RolandTR707', 'AkaiLinn'];

  const Theory = {
    ROOTS,
    SCALES,
    PROGRESSIONS,
    MELODY_CELLS,
    DRUM_BANKS,

    // Build a Strudel scale string, e.g. scaleName('C', 3, 'minor') -> "C3:minor"
    scaleName(root, octave, type) {
      return root + octave + ':' + type;
    },

    // A triad (three stacked scale degrees) rooted on degree `d`.
    triad(d) {
      return d + ',' + (d + 2) + ',' + (d + 4);
    },

    // Turn a progression into a per-cycle mininotation sequence of roots.
    // e.g. [0,5,3,4] -> "<0 5 3 4>"
    rootSeq(prog) {
      return '<' + prog.join(' ') + '>';
    },

    // Turn a progression into a per-cycle sequence of triads.
    // e.g. [0,5,3,4] -> "<0,2,4 5,7,9 3,5,7 4,6,8>"
    chordSeq(prog) {
      return '<' + prog.map((d) => Theory.triad(d)).join(' ') + '>';
    },
  };

  SDJ.Theory = Theory;
})(window.SDJ = window.SDJ || {});
