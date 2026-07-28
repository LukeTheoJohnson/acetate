// curate.js — the direction box's parser: free text → deterministic directives.
// "no hihats, darker, slower, more bass" becomes bans / features / mood / tempo /
// density / genre that steer WHAT the DJ pitches next. No AI, no network — just
// a small keyword lexicon — and steer-only: nothing here ever touches a seed.
(function (SDJ) {
  'use strict';

  const has = Object.prototype.hasOwnProperty;

  // Lane lexicon — indices match SDJ.STAGES (kick hats bass clap chords lead air).
  const LANE_WORDS = {
    kick: 0, kicks: 0, drum: 0, drums: 0,
    hat: 1, hats: 1, hihat: 1, hihats: 1,
    bass: 2, bassline: 2, '808': 2, '808s': 2, sub: 2, subs: 2,
    clap: 3, claps: 3, snare: 3, snares: 3, backbeat: 3,
    chord: 4, chords: 4, keys: 4, pad: 4, pads: 4, harmony: 4,
    lead: 5, melody: 5, hook: 5, riff: 5,
    air: 6, atmosphere: 6, ambience: 6, atmos: 6,
  };
  // short display names for the chips ("no hi-hats", "more bass")
  const LANE_NAMES = ['kick', 'hi-hats', 'bass', 'clap', 'chords', 'lead', 'air'];

  const NEGATE = { no: 1, less: 1, drop: 1, without: 1, kill: 1 };
  const EMPHASISE = { more: 1, feature: 1, focus: 1, focuson: 1, heavy: 1 };

  const MOOD_WORDS = {
    dark: 'dark', darker: 'dark', moody: 'dark', sinister: 'dark',
    brooding: 'dark', menacing: 'dark',
    bright: 'bright', brighter: 'bright', happy: 'bright', sunny: 'bright',
    uplifting: 'bright', warm: 'bright', hopeful: 'bright',
  };
  const TEMPO_WORDS = {
    fast: 'fast', faster: 'fast', quick: 'fast', quicker: 'fast',
    slow: 'slow', slower: 'slow', chill: 'slow', laidback: 'slow',
  };
  const DENSITY_WORDS = {
    minimal: -1, sparse: -1, stripped: -1, simple: -1,
    busy: 1, dense: 1, full: 1, layered: 1,
  };

  // Scale palettes per mood — the app intersects these with the genre's own
  // palette (Theory.scalesFor). Every name here exists in Theory.SCALES, in the
  // space-separated tonal form (a camelCase name renders SILENT — see theory.js).
  const MOOD_SCALES = {
    dark: ['minor', 'phrygian', 'phrygian dominant', 'harmonic minor', 'melodic minor', 'minor pentatonic', 'blues'],
    bright: ['major', 'major pentatonic', 'mixolydian', 'lydian', 'dorian'],
  };

  // Genre lexicon built live from Theory.GENRES (ids + labels squashed to bare
  // alphanumerics), so whatever genres this build ships are all typeable —
  // "boom bap", "lo-fi" and "r&b" all land after the punctuation strip.
  function genreLexicon() {
    const map = Object.create(null);
    const gs = (SDJ.Theory && SDJ.Theory.GENRES) || [];
    gs.forEach((g) => {
      map[String(g.id).toLowerCase().replace(/[^a-z0-9]/g, '')] = g;
      map[String(g.label).toLowerCase().replace(/[^a-z0-9]/g, '')] = g;
    });
    return map;
  }

  // Normalise and split: lowercase, fold the hi-hat spellings, squash the
  // multi-word phrases the lexicon knows, glue "140 bpm" into one token, drop
  // punctuation (digits survive), then split into clauses on commas/connectives
  // and each clause into word tokens.
  function tokenise(text) {
    let t = String(text || '').toLowerCase();
    t = t.replace(/hi[\s-]?hats?/g, 'hihats');
    t = t.replace(/laid[\s-]?back/g, 'laidback');
    t = t.replace(/focus\s+on/g, 'focuson');
    t = t.replace(/(\d)\s*bpm/g, '$1bpm');
    t = t.replace(/[,;.!?]|\band\b|\bthen\b|\bbut\b/g, '|');
    t = t.replace(/[^a-z0-9|\s]/g, ' ');
    return t.split('|')
      .map((c) => c.split(/\s+/).filter(Boolean))
      .filter((c) => c.length);
  }

  // parse(text) → { bans, features, mood, tempo, density, genre, chips }.
  // bans/features are lane indices; mood is 'dark'|'bright'|null; tempo is
  // 'fast'|'slow'|a bpm number|null; density is -1|1|null; genre is a
  // Theory.GENRES id|null. chips lists every understood directive as
  // { label, kind } — unmatched words produce nothing at all.
  function parse(text) {
    const out = { bans: [], features: [], mood: null, tempo: null, density: null, genre: null, chips: [] };
    const genres = genreLexicon();
    const chip = (label, kind, lane) => out.chips.push(
      lane == null ? { label: label, kind: kind } : { label: label, kind: kind, lane: lane });

    tokenise(text).forEach((toks) => {
      let pending = null; // 'ban' | 'feature', carried until a lane word lands
      for (let k = 0; k < toks.length; k++) {
        const tok = toks[k];

        // a two-word genre ("boom bap", "r b") joins back across the split
        const join = k + 1 < toks.length ? genres[tok + toks[k + 1]] : null;
        if (join && pending !== 'ban') {
          if (!out.genre) { out.genre = join.id; chip(join.label, 'genre'); }
          k += 1;
          pending = null;
          continue;
        }
        if (has.call(NEGATE, tok)) { pending = 'ban'; continue; }
        if (has.call(EMPHASISE, tok)) { if (pending !== 'ban') pending = 'feature'; continue; }
        if (has.call(LANE_WORDS, tok)) {
          const lane = LANE_WORDS[tok];
          if (pending === 'ban') {
            if (out.bans.indexOf(lane) < 0) {
              out.bans.push(lane);
              const fi = out.features.indexOf(lane);
              if (fi >= 0) out.features.splice(fi, 1); // a ban outranks a feature
              chip('no ' + LANE_NAMES[lane], 'ban', lane);
            }
          } else if (pending === 'feature') {
            if (out.features.indexOf(lane) < 0 && out.bans.indexOf(lane) < 0) {
              out.features.push(lane);
              chip('more ' + LANE_NAMES[lane], 'feature', lane);
            }
          }
          pending = null; // a bare lane mention is not a directive
          continue;
        }
        if (has.call(MOOD_WORDS, tok)) {
          const m = MOOD_WORDS[tok];
          if (out.mood !== m) { out.mood = m; chip(m === 'dark' ? 'darker' : 'brighter', 'mood'); }
          continue;
        }
        if (has.call(TEMPO_WORDS, tok)) {
          const tw = TEMPO_WORDS[tok];
          if (out.tempo !== tw) { out.tempo = tw; chip(tw === 'fast' ? 'faster' : 'slower', 'tempo'); }
          continue;
        }
        const bpm = /^(\d{2,3})bpm$/.exec(tok);
        if (bpm) {
          const n = parseInt(bpm[1], 10);
          if (n >= 60 && n <= 200 && out.tempo !== n) { out.tempo = n; chip(n + ' bpm', 'tempo'); }
          continue;
        }
        if (has.call(DENSITY_WORDS, tok)) {
          const dv = DENSITY_WORDS[tok];
          if (out.density !== dv) { out.density = dv; chip(dv < 0 ? 'minimal' : 'busy', 'density'); }
          continue;
        }
        if (genres[tok] && pending !== 'ban') {
          if (!out.genre) { out.genre = genres[tok].id; chip(genres[tok].label, 'genre'); }
          continue;
        }
        // an unknown word produces nothing — and leaves a pending modifier
        // alone, so "no more of those hats" still lands on the hats
      }
    });
    return out;
  }

  SDJ.Curate = { parse: parse, MOOD_SCALES: MOOD_SCALES };
})(window.SDJ = window.SDJ || {});
