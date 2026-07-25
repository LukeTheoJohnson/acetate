// vinyl.js — the record itself. Every track in this app is a physical-feeling
// disc: while the DJ builds a track, each approved change presses a mark onto
// the live record, and saving "presses" it — from then on the marks and the
// name on the label are stuck. One deterministic SVG builder drives every
// surface (the live decks, the press modal, the crate, the remix platter) so a
// record wears the same face everywhere it appears.
//
// The core idea: a pitch's acetate on Deck B is a MOSTLY BLANK disc carrying
// only the one mark the change would press — the visual suggestion matches the
// audio suggestion. Approve it and deltaMark's exact markup lands on Deck A
// (both decks draw marks from the same helpers, so nothing is redrawn
// differently). Every lane owns a home groove (a fixed radius) and a signature
// pattern that loosely draws what the part does: four heavy blocks for the
// kick, fine ticks for the hats, a weighted core for the bass, two backbeat
// arcs for the clap, a stacked voicing for the chords, a dotted melody for the
// lead, a soft wide band for the atmosphere, one rising arc for a fill.
// Deepenings mark the record too — sparkle rails for FX, a thin twin ring for
// a double — and a rework re-cuts the lane's ring at a new angle (variant).
(function (SDJ) {
  'use strict';

  const Rng = SDJ.Rng;

  // Label hue per "face" layer — only legacy crate entries (saved before the
  // genome rode along) still take their hue from this; it mirrors art.js
  // LAYER_HUE so those old records keep the identity of their square covers.
  const LAYER_HUE = { 0: 352, 1: 190, 2: 275, 3: 33, 4: 150, 5: 320, 6: 210 };

  // Label hue per lane (matches LANE_COLORS in dj.js; 7 = the fill pseudo-lane)
  // — an acetate's label is tinted to the lane its pitch touches.
  const LANE_HUE = { 0: 341, 1: 175, 2: 270, 3: 33, 4: 152, 5: 315, 6: 210, 7: 228 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Cheap stable string hash — a seed for records saved before art seeds existed.
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // A lane's home groove. Fixed per lane (not per accretion order), so the same
  // part always sits at the same radius on every disc it appears on.
  function radiusFor(lane) { return 41 + (lane == null ? 0 : lane) * 6.2; }

  function circ(rad, colour, w, o, extra) {
    return '<circle cx="100" cy="100" r="' + rad.toFixed(1) + '" fill="none" stroke="' + colour +
      '" stroke-width="' + w + '" opacity="' + o.toFixed(2) + '"' + (extra || '') + '/>';
  }

  // One ring in a lane's signature pattern at its home groove. The lane's
  // variant (which cut of the part is playing) angles the pattern and nudges
  // its geometry, so a rework visibly re-cuts the groove. mode 'ghost' draws
  // it faint (used inside a drop mark to show what's coming off).
  function laneRing(lane, colour, mode, variant) {
    const v = (variant || 0) >>> 0;
    const rad = radiusFor(lane);
    const c = 2 * Math.PI * rad;
    const dim = mode === 'ghost' ? 0.35 : 1;
    // dash patterns anchor at 12 o'clock; each re-cut swings them to a new angle
    const rot = ' transform="rotate(' + (-90 + (v * 43) % 360) + ' 100 100)"';
    const ring = function (w, o, extra, rr) {
      return circ(rr == null ? rad : rr, colour, w, Math.min(1, o * dim), extra);
    };
    // n dashes round the groove, each filling `on` of its slot
    const seg = function (n, on) {
      return ' stroke-dasharray="' + (c / n * on).toFixed(1) + ' ' + (c / n * (1 - on)).toFixed(1) + '"' + rot;
    };
    switch (lane) {
      case 0: // kick — four heavy blocks on the floor
        return ring(3.6, 0.85, seg(4, 0.62));
      case 1: // hats — a run of fine ticks
        return ring(1.9, 0.85, seg(24, 0.42));
      case 2: // bass — a solid core whose sub weight swells with the cut
        return ring(5.5 + (v % 3), 0.2) + ring(2.7, 0.9);
      case 3: // clap — two backbeat arcs
        return ring(3.1, 0.85, seg(2, 0.3) + ' stroke-linecap="round"');
      case 4: { // chords — a stacked voicing whose spread follows the cut
        const gap = 1.7 + (v % 3) * 0.35;
        return ring(1.2, 0.75, '', rad - gap) + ring(1.6, 0.9) + ring(1.2, 0.75, '', rad + gap);
      }
      case 5: // lead — a melody of dots
        return ring(2.7, 0.9, ' stroke-dasharray="0.01 ' + (c / 14).toFixed(1) + '" stroke-linecap="round"' + rot);
      case 6: // air — a soft band that widens with the cut
        return ring(4.8 + (v % 3) * 0.7, 0.34);
      case 7: // fill — one rising arc, a burst rather than a loop
        return ring(2.8, 0.9, seg(1, 0.3) + ' stroke-linecap="round"');
      default:
        return ring(2.6, 0.85);
    }
  }

  // Deepening marks, shared verbatim between the acetate and the pressed
  // record: FX press sparkle rails either side of the groove, a double presses
  // a thin twin just outside it.
  function fxRails(lane, colour) {
    const rad = radiusFor(lane);
    const rail = function (rr) { return circ(rr, colour, 0.9, 0.55, ' stroke-dasharray="1 3.5"'); };
    return rail(rad - 3.4) + rail(rad + 3.4);
  }
  function twinRing(lane, colour) {
    return circ(radiusFor(lane) + 3, colour, 1.3, 0.65);
  }

  // The one mark a pitched change would press — the acetate carries ONLY this,
  // and approving stamps this exact markup onto the committed record.
  function deltaMark(lane, colour, kind, variant) {
    if (kind === 'fx') return fxRails(lane, colour);
    if (kind === 'double') return twinRing(lane, colour);
    if (kind === 'drop') {
      // the ring coming off, faint, with a dashed cut through its groove
      return laneRing(lane, colour, 'ghost', variant) +
        circ(radiusFor(lane), 'rgba(255,255,255,0.8)', 1.1, 0.8, ' stroke-dasharray="2.5 4.5"');
    }
    // add, reshape, fill: the lane's ring exactly as it will sit on the record
    return laneRing(lane, colour, 'press', variant);
  }

  // Everything a genome has pressed into its record: each active lane's ring
  // (at its current cut), rails where FX landed, twins where doubles landed,
  // the fill's arc. Deck A, the press modal and the crate all draw from this.
  function genomeRings(g) {
    if (!g || !g.active) return '';
    const lanes = SDJ.LANE_COLORS || [];
    let out = '';
    for (let i = 0; i < g.active.length; i++) {
      if (!g.active[i]) continue;
      const col = lanes[i] || '#888';
      out += laneRing(i, col, 'press', g.variant && g.variant[i]);
      if (g.fx && g.fx[i]) out += fxRails(i, col);
      if (g.double && g.double[i]) out += twinRing(i, col);
    }
    if (g.fill > 0) out += laneRing(7, SDJ.FILL_COLOR || '#c3ccff', 'press', 0);
    return out;
  }

  // Build one record as an SVG string (viewBox 0 0 200 200, scales to its box).
  // opts:
  //   seed   — drives the label decoration (deterministic)
  //   hue    — label colour; defaults to a seeded hue
  //   name   — imprinted on a curved arc around the label
  //   sub    — small line under the spindle (key · bpm)
  //   marks  — the pressed marks (markup from genomeRings / deltaMark)
  //   rings  — legacy: an array of colour strings, drawn as successive lanes
  //   glyph  — big centre mark (used by proposal acetates: + − ≈ ✦ ≡ ▲)
  //   ghost  — true renders a translucent acetate (an unpressed test cut)
  //   colour — the acetate's accent colour (its dashed rim)
  function disc(opts) {
    const seed = ((opts.seed == null ? 1 : opts.seed) >>> 0) || 1;
    const r = Rng.make((seed ^ 0x51ab3d) >>> 0);
    const hue = opts.hue != null ? opts.hue : Rng.int(r, 0, 359);
    const ghost = !!opts.ghost;
    const name = esc(String(opts.name || '').slice(0, 22).toUpperCase());
    let marks = opts.marks || '';
    (opts.rings || []).forEach(function (col, k) { marks += laneRing(k, col, 'press', 0); });
    const uid = 'vin' + seed.toString(36) + (marks.length % 97) + (ghost ? 'g' : '') + name.length;

    // faint pressing grooves so the disc reads as vinyl, not a flat circle
    let grooves = '';
    for (let i = 0; i < 9; i++) {
      const rad = 40 + i * 6.4;
      grooves += '<circle cx="100" cy="100" r="' + rad.toFixed(1) +
        '" fill="none" stroke="rgba(255,255,255,' + (0.025 + Rng.int(r, 0, 3) * 0.01).toFixed(3) +
        ')" stroke-width="1"/>';
    }

    // label face + a little seeded decoration so no two labels read identical
    const lab1 = 'hsl(' + hue + ',70%,' + (ghost ? 32 : 48) + '%)';
    const lab2 = 'hsl(' + ((hue + 40) % 360) + ',75%,' + (ghost ? 15 : 24) + '%)';
    let dots = '';
    const nMarks = 2 + Rng.int(r, 0, 2);
    for (let i = 0; i < nMarks; i++) {
      const a = Rng.int(r, 0, 359) * Math.PI / 180;
      const rr = 12 + Rng.int(r, 0, 14);
      dots += '<circle cx="' + (100 + Math.cos(a) * rr).toFixed(1) +
        '" cy="' + (100 + Math.sin(a) * rr).toFixed(1) +
        '" r="' + (1.5 + Rng.int(r, 0, 3)) + '" fill="rgba(255,255,255,0.26)"/>';
    }

    const nameFill = ghost ? 'rgba(240,240,255,0.9)' : 'rgba(8,8,16,0.85)';
    const glyph = opts.glyph
      ? '<text x="100" y="107" text-anchor="middle" font-size="20" font-weight="700" ' +
        'fill="rgba(255,255,255,0.92)">' + esc(opts.glyph) + '</text>'
      : '';
    const sub = opts.sub
      ? '<text x="100" y="121" text-anchor="middle" font-size="6.5" letter-spacing="1" ' +
        'fill="rgba(255,255,255,0.68)">' + esc(opts.sub) + '</text>'
      : '';

    const rim = ghost && opts.colour
      ? ' stroke="' + opts.colour + '" stroke-width="2" stroke-dasharray="5 7"'
      : ' stroke="#1c1c2c" stroke-width="1"';

    return '<svg viewBox="0 0 200 200" width="100%" height="100%" role="img" aria-label="' + name + '">' +
      '<defs>' +
        '<radialGradient id="' + uid + 'l" cx="0.38" cy="0.32" r="0.9">' +
          '<stop offset="0" stop-color="' + lab1 + '"/><stop offset="1" stop-color="' + lab2 + '"/>' +
        '</radialGradient>' +
        '<path id="' + uid + 't" d="M 72,100 A 28,28 0 0 1 128,100" fill="none"/>' +
      '</defs>' +
      '<circle cx="100" cy="100" r="97" fill="' + (ghost ? 'rgba(14,14,22,0.72)' : '#0b0b13') + '"' + rim + '/>' +
      grooves + marks +
      '<circle cx="100" cy="100" r="34" fill="url(#' + uid + 'l)"/>' +
      dots +
      (name
        ? '<text font-size="8.2" font-weight="700" letter-spacing="1.4" fill="' + nameFill + '">' +
          '<textPath href="#' + uid + 't" startOffset="50%" text-anchor="middle">' + name + '</textPath></text>'
        : '') +
      glyph + sub +
      '<circle cx="100" cy="100" r="4" fill="#07070d" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>' +
      '<ellipse cx="66" cy="58" rx="46" ry="20" fill="rgba(255,255,255,0.05)" transform="rotate(-32 66 58)"/>' +
    '</svg>';
  }

  // A saved crate entry as a pressed record. Marks come from the saved genome
  // (everything that was on when it was pressed); a migrated pre-genome entry
  // still gets a stable seeded set so old libraries keep a face.
  function forEntry(entry) {
    const e = entry || {};
    const seed = e.art ? (e.art.seed >>> 0) : hashStr(e.name || 'record');
    let marks = '';
    let hue;
    if (e.genome && e.genome.active) {
      marks = genomeRings(e.genome);
      hue = seed % 360; // same rule as the live disc — pressing doesn't change the face
    } else {
      const lanes = SDJ.LANE_COLORS || [];
      const r = Rng.make(seed);
      for (let i = 0; i < 7; i++) {
        if (Rng.int(r, 0, 99) < 55) marks += laneRing(i, lanes[i] || '#888', 'press', 0);
      }
      if (!marks) marks = laneRing(0, lanes[0] || '#888', 'press', 0) + laneRing(2, lanes[2] || '#888', 'press', 0);
      const face = e.art ? e.art.layer : seed % 7;
      hue = LAYER_HUE[face] != null ? LAYER_HUE[face] : seed % 360;
    }
    return disc({
      seed: seed,
      hue: hue,
      name: e.name || 'UNTITLED',
      sub: ((e.key || '') + ' · ' + (e.bpm || '?') + ' BPM').trim(),
      marks: marks,
    });
  }

  // The live, in-progress record, drawn from the committed genome: marks
  // accrete as changes are approved, so the disc visibly fills up as the track
  // builds — and this exact look is what gets pressed when the track is saved.
  // The label hue is fixed by the song's seed, so approving a change never
  // re-faces the record — it only adds the change's mark.
  function forLive(song, genome, nameOverride) {
    if (!song) return disc({ seed: 1, name: '' });
    const g = genome || song.genome;
    return disc({
      seed: song.seed >>> 0,
      hue: (song.seed >>> 0) % 360,
      name: nameOverride || song.name,
      sub: song.key + ' · ' + song.bpm + ' BPM',
      marks: genomeRings(g),
    });
  }

  // A pitched change as an acetate test cut on Deck B: a mostly blank,
  // translucent disc carrying ONLY the change's mark — one small visual
  // suggestion to match the audio one. The mark is deltaMark's exact markup,
  // so approving presses precisely what was auditioned onto Deck A.
  function proposal(o) {
    const opts = o || {};
    return disc({
      seed: opts.seed == null ? 7 : opts.seed,
      hue: opts.lane != null && LANE_HUE[opts.lane] != null ? LANE_HUE[opts.lane] : 260,
      ghost: true,
      colour: opts.colour,
      name: opts.name || 'TEST CUT',
      glyph: opts.glyph,
      marks: opts.colour != null && opts.lane != null
        ? deltaMark(opts.lane, opts.colour, opts.kind, opts.variant)
        : '',
    });
  }

  SDJ.Vinyl = { disc: disc, forEntry: forEntry, forLive: forLive, proposal: proposal };
})(window.SDJ = window.SDJ || {});
