// art.js — an outward-facing "cover" for a proposed change.
//
// Each A&R pitch (an added or reworked layer) gets a small, deterministic piece
// of generative art so the change has a face you can associate with it. The
// image is seeded on the song seed + the layer + its variant, so reworking a
// layer yields visibly different art while the same change always looks the
// same. Pure SVG built from the shared seeded RNG — no assets, no network.
(function (SDJ) {
  'use strict';

  const Rng = SDJ.Rng;

  // A signature hue per arrangement layer (kick..air), so the palette reads as
  // "this is the bass" at a glance. Falls back to a seeded hue if unknown. The
  // table lives once on SDJ.LAYER_HUE (defined in vinyl.js) — read lazily inside
  // cover() because vinyl.js loads AFTER art.js, so it isn't there at eval time.
  const LAYER_HUE_FALLBACK = { 0: 352, 1: 190, 2: 275, 3: 33, 4: 150, 5: 320, 6: 210 };

  function cover(layer, variant, seed) {
    const r = Rng.make(
      (((seed >>> 0) ^ ((layer + 1) * 0x9e3779b1) ^ ((variant + 1) * 0x85ebca77)) >>> 0)
    );
    const LAYER_HUE = SDJ.LAYER_HUE || LAYER_HUE_FALLBACK;
    const hue = LAYER_HUE[layer] != null ? LAYER_HUE[layer] : Rng.int(r, 0, 360);
    const gid = 'g' + layer + '_' + variant + '_' + (seed >>> 0).toString(36);
    const bg1 = 'hsl(' + hue + ', 62%, 15%)';
    const bg2 = 'hsl(' + ((hue + 45) % 360) + ', 72%, 7%)';

    let shapes = '';
    const n = 3 + Rng.int(r, 0, 4);
    for (let i = 0; i < n; i++) {
      const x = Rng.int(r, 8, 92);
      const y = Rng.int(r, 8, 92);
      const sz = Rng.int(r, 10, 40);
      const h2 = (hue + Rng.int(r, -30, 65) + 360) % 360;
      const col = 'hsl(' + h2 + ', 88%, ' + Rng.int(r, 48, 72) + '%)';
      const op = (Rng.int(r, 30, 85) / 100).toFixed(2);
      const kind = Rng.int(r, 0, 2);
      if (kind === 0) {
        shapes += '<circle cx="' + x + '" cy="' + y + '" r="' + (sz / 2).toFixed(1) +
          '" fill="' + col + '" opacity="' + op + '"/>';
      } else if (kind === 1) {
        shapes += '<rect x="' + (x - sz / 2).toFixed(1) + '" y="' + (y - sz / 2).toFixed(1) +
          '" width="' + sz + '" height="' + sz + '" rx="3" fill="' + col + '" opacity="' + op +
          '" transform="rotate(' + Rng.int(r, 0, 90) + ' ' + x + ' ' + y + ')"/>';
      } else {
        shapes += '<line x1="' + x + '" y1="' + y + '" x2="' + Rng.int(r, 8, 92) + '" y2="' +
          Rng.int(r, 8, 92) + '" stroke="' + col + '" stroke-width="' + Rng.int(r, 2, 6) +
          '" opacity="' + op + '" stroke-linecap="round"/>';
      }
    }

    return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + bg1 + '"/><stop offset="1" stop-color="' + bg2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="100" height="100" fill="url(#' + gid + ')"/>' + shapes + '</svg>';
  }

  SDJ.Art = { cover: cover };
})(window.SDJ = window.SDJ || {});
