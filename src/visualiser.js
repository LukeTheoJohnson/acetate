// visualiser.js — the shared reactive audio visualiser.
//
// One component, three mounts: the full-screen "pure visual" screensaver (the
// menu's Visuals mode), the compact strip player in the top bar, and a calm
// mini tile on the Live floor. It reads the REAL audio off a shared
// AnalyserNode (SDJ.getAnalyser, teed off the master bus in app.js) so the
// picture actually follows the music — menu ambience, a live set or a remix —
// and falls back to a gentle synthetic idle when nothing plays. The menu's own
// background canvas (menu.js) also reads through SDJ.Visualiser.read so it
// reacts to the same signal. Classic script, no dependencies, jsdom-safe.
//
// 'full' and 'mini' run a slow SCENE SYSTEM — bloom → orbits → ridge → threads
// — each held ~90 s then crossfaded ~8 s into the next, with every parameter
// drifting continuously off the clock (never Math.random in the frame loop) so
// the picture is never the same two minutes apart. When a song is on the lathe
// the palette is built from the approved lanes' colours (SDJ.LANE_COLORS), so
// every part the crowd keeps literally tints the visuals; with no song it
// falls back to the deck pair, cyan/amber.
(function (SDJ) {
  'use strict';

  const COOL = '#28c8e0';  // Deck A — cyan
  const WARM = '#ff9b2f';  // Deck B — amber
  const CY = 6;            // idle oscilloscope cycles across the width
  const TAU = Math.PI * 2;

  // ---- shared audio read: real analyser data + level/bass, synthetic-safe ----
  // Returns { live, freq, wave, level, bass }. `live` is false until something is
  // actually feeding the analyser, so callers can pick an idle animation instead.
  let freqBuf = null, waveBuf = null;
  function read() {
    const an = (typeof SDJ.getAnalyser === 'function') ? SDJ.getAnalyser() : null;
    if (!an || typeof an.getByteFrequencyData !== 'function') {
      return { live: false, freq: null, wave: null, level: 0, bass: 0 };
    }
    const n = an.frequencyBinCount;
    if (!freqBuf || freqBuf.length !== n) { freqBuf = new Uint8Array(n); waveBuf = new Uint8Array(n); }
    an.getByteFrequencyData(freqBuf);
    an.getByteTimeDomainData(waveBuf);
    let sum = 0; for (let i = 0; i < n; i++) sum += freqBuf[i];
    const bn = Math.max(1, n >> 5);
    let bs = 0; for (let i = 0; i < bn; i++) bs += freqBuf[i];
    return { live: sum > 8, freq: freqBuf, wave: waveBuf, level: sum / (n * 255), bass: bs / (bn * 255) };
  }

  // ---- song-aware palette: approved lanes colour the picture ---------------
  // Re-checked ~once a second and cached; a try/catch keeps a mid-mutation
  // engine read from ever killing the frame loop. Colours are pre-parsed to
  // [r,g,b] triples so the scenes never parse hex per frame.
  function hexToRgb(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length < 6) return [40, 200, 224];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const FALLBACK = [hexToRgb(COOL), hexToRgb(WARM)];
  let palCache = FALLBACK, palTime = -1e9;
  function palette() {
    const now = Date.now();
    if (now - palTime < 1000) return palCache;
    palTime = now;
    let cols = null;
    try {
      const st = (SDJ.engine && typeof SDJ.engine.state === 'function') ? SDJ.engine.state() : null;
      const lanes = SDJ.LANE_COLORS;
      if (st && st.activeLayers && lanes) {
        cols = [];
        for (let i = 0; i < st.activeLayers.length; i++) {
          if (st.activeLayers[i] && lanes[i]) cols.push(hexToRgb(lanes[i]));
        }
      }
    } catch (e) { cols = null; }
    palCache = (cols && cols.length) ? cols : FALLBACK;
    return palCache;
  }

  // Continuous colour around the palette ring: u wraps, neighbours blend.
  function palCol(pal, u, alpha) {
    const n = pal.length;
    const p = (u % 1 + 1) % 1 * n;
    const i = p | 0, k = p - i;
    const c1 = pal[i % n], c2 = pal[(i + 1) % n];
    const r = (c1[0] + (c2[0] - c1[0]) * k) | 0;
    const g = (c1[1] + (c2[1] - c1[1]) * k) | 0;
    const b = (c1[2] + (c2[2] - c1[2]) * k) | 0;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }

  function noop() { return { start: function () {}, stop: function () {}, resize: function () {}, destroy: function () {} }; }

  // ---- scene clock: hold ~90 s, crossfade ~8 s, cycle in a fixed order -----
  const HOLD = 90, FADE = 8, PERIOD = HOLD + FADE;

  // ---- an instance bound to one canvas + one draw style --------------------
  // mode: 'full' (screensaver) | 'strip' (top-bar player) | 'mini' (Live tile)
  function mount(canvas, opts) {
    opts = opts || {};
    const mode = opts.mode || 'strip';
    if (!canvas || typeof canvas.getContext !== 'function') return noop();
    const ctx = canvas.getContext('2d');
    if (!ctx) return noop(); // jsdom / no 2d context — safe no-op

    let W = 0, H = 0, dpr = 1, raf = 0, on = false, last = 0, t = 0;
    let dtNow = 0.016; // the current frame's dt, shared with the scene draws

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      if (!W || !H) return; // hidden — size when it becomes visible
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // a soft idle wave so the strip is never a dead flat line between tracks
    function idleWave(u) {
      const k = u * Math.PI * 2 * CY + t * 0.9;
      return (Math.sin(k) + 0.4 * Math.sin(2 * k + 0.6)) / 1.4 * (0.5 + 0.12 * Math.sin(t * 0.8));
    }

    function sampleWave(a, u) {
      if (a.live && a.wave) {
        const wi = Math.min(a.wave.length - 1, (u * (a.wave.length - 1)) | 0);
        return (a.wave[wi] - 128) / 128;
      }
      return idleWave(u) * 0.7;
    }

    function drawStrip(a) {
      ctx.clearRect(0, 0, W, H);
      const mid = H * 0.5, amp = H * 0.42;
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, COOL); grad.addColorStop(1, WARM);
      ctx.strokeStyle = grad; ctx.lineWidth = 1.6;
      ctx.globalAlpha = a.live ? 1 : 0.5;
      ctx.beginPath();
      const N = Math.max(48, Math.floor(W / 3));
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = u * W, y = mid + sampleWave(a, u) * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ================= scene system ('full' + 'mini') ======================
    const sceneMode = mode === 'full' || mode === 'mini';
    const MINI = mode === 'mini';

    // Fixed layouts (orbit phases, radii, sizes) are seeded ONCE per mount —
    // never Math.random in the frame loop; all motion derives from t.
    let rnd = null;
    let orb = null, ORB_N = 0;                 // orbit particle field
    let pulse = 0, ringR = 9, prevBass = 0;    // the travelling bass impulse
    let ridgeData = null, R_COLS = 0, R_ROWS = 0; // spectrum-terrain history
    let ridgeHead = 0, ridgeAcc = 0;
    // Per-scene trail alphas (how fast the after-image fades); mini keeps a
    // gentler, shorter trail so the little tile never smears into mush.
    const TRAIL = MINI ? [0.30, 0.26, 0.34, 0.22] : [0.22, 0.16, 0.28, 0.10];

    if (sceneMode) {
      if (SDJ.Rng && SDJ.Rng.make) rnd = SDJ.Rng.make((MINI ? 0x51ab5 : 0xace7a7e) >>> 0);
      else { let s0 = 42; rnd = function () { s0 = (s0 * 16807) % 2147483647; return s0 / 2147483647; }; }
      ORB_N = MINI ? 34 : 96;
      orb = new Float32Array(ORB_N * 6);
      for (let i = 0; i < ORB_N; i++) {
        const o = i * 6;
        orb[o]     = rnd() * TAU;                                    // phase
        orb[o + 1] = 0.15 + rnd() * 0.85;                            // orbit radius
        orb[o + 2] = 0.5 + rnd() * 0.45;                             // eccentricity
        orb[o + 3] = (0.05 + rnd() * 0.22) * (rnd() < 0.5 ? -1 : 1); // angular speed
        orb[o + 4] = rnd();                                          // palette position
        orb[o + 5] = 0.8 + rnd() * 2.2;                              // base size
      }
      R_COLS = MINI ? 40 : 64;
      R_ROWS = MINI ? 12 : 24;
      ridgeData = new Float32Array(R_COLS * R_ROWS);
    }

    // Scene 0 — bloom: the original picture, kept. Central low-end bloom +
    // spectrum floor + the big oscilloscope, now palette-aware and slowly
    // wandering (centre drifts, hue rotates through the approved lanes).
    function drawBloom(a, pal, w) {
      const bass = a.live ? a.bass : 0.15 + 0.1 * Math.sin(t * 1.6);
      const drift = t * 0.008; // slow hue rotation around the palette ring

      // central bloom, pulsing on the low end, centre wandering off the clock
      const cx = W * (0.5 + 0.06 * Math.sin(t * 0.037));
      const cy = H * (0.46 + 0.05 * Math.sin(t * 0.023 + 1.7));
      const cr = Math.min(W, H) * (0.16 + bass * 0.13 + 0.02 * Math.sin(t * 0.11));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      core.addColorStop(0, palCol(pal, drift, (0.22 + bass * 0.3) * w));
      core.addColorStop(0.55, palCol(pal, drift, 0.08 * w));
      core.addColorStop(1, palCol(pal, drift, 0));
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill();

      // spectrum along the floor, coloured across the palette left to right
      const bars = MINI ? 40 : 96, baseY = H * 0.84, bw = W / bars, maxH = H * 0.32;
      for (let i = 0; i < bars; i++) {
        const uu = i / bars;
        let v;
        if (a.live && a.freq) { const fi = (uu * a.freq.length * 0.6) | 0; v = a.freq[fi] / 255; }
        else v = Math.max(0, 0.4 - Math.abs(uu - 0.5)) * (0.5 + 0.5 * Math.sin(t * 2 + i * 0.3));
        const h = Math.max(2, v * maxH), x = i * bw;
        ctx.fillStyle = palCol(pal, uu * 0.999 + drift, (0.16 + v * 0.5) * w);
        ctx.fillRect(x + 1, baseY - h, bw - 2, h);
        ctx.fillStyle = palCol(pal, uu * 0.999 + drift, 0.05 * w);
        ctx.fillRect(x + 1, baseY + 2, bw - 2, h * 0.35); // soft reflection
      }

      // the big oscilloscope trace across the middle (the one glow pass)
      const midY = H * (0.42 + 0.03 * Math.sin(t * 0.05)), amp = H * 0.16;
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, palCol(pal, drift, 0.9 * w));
      grad.addColorStop(1, palCol(pal, drift + 0.45, 0.9 * w));
      ctx.strokeStyle = grad; ctx.lineWidth = MINI ? 1.4 : 2.4;
      if (!MINI) { ctx.shadowColor = palCol(pal, drift, 0.8 * w); ctx.shadowBlur = 16; }
      ctx.beginPath();
      const N = MINI ? 72 : Math.max(120, Math.floor(W / 3));
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = u * W, y = midY + sampleWave(a, u) * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Scene 1 — orbits: a particle field on slowly precessing elliptical
    // orbits. Counts and sizes breathe with the level; a low-end hit launches
    // a radial impulse ring that pushes particles outward as it passes.
    function drawOrbits(a, pal, w) {
      const level = a.live ? a.level : 0.10 + 0.05 * Math.sin(t * 0.7);
      const bass = a.live ? a.bass : 0;
      if (bass > 0.4 && bass - prevBass > 0.12 && ringR > 0.35) { ringR = 0; pulse = bass; }
      prevBass = bass;
      ringR += dtNow * 1.1;
      pulse *= Math.exp(-dtNow * 0.9);

      const cx = W * 0.5, cy = H * 0.5;
      const R = Math.min(W, H) * (0.44 + 0.03 * Math.sin(t * 0.021));
      const prec = t * 0.05; // the slow precession of every ellipse

      // faint guide ellipses so the field reads as orbits, not static
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {
        const gr = (0.3 + g * 0.3) * R;
        ctx.strokeStyle = palCol(pal, g * 0.33 + t * 0.004, 0.05 * w);
        ctx.beginPath();
        if (ctx.ellipse) ctx.ellipse(cx, cy, gr, gr * 0.72, prec * (g % 2 ? -1 : 1), 0, TAU);
        else ctx.arc(cx, cy, gr, 0, TAU);
        ctx.stroke();
      }

      const shown = Math.min(ORB_N, Math.round(ORB_N * (0.55 + level * 0.8)));
      for (let i = 0; i < shown; i++) {
        const o = i * 6;
        const th = orb[o] + t * orb[o + 3];
        let r = orb[o + 1];
        // the travelling bass ring: a gaussian bump moving out through r
        const dr = r - ringR;
        const push = pulse * Math.exp(-dr * dr * 30) * Math.max(0, 1 - ringR * 0.7);
        r = r * (1 + push * 0.5);
        const ax = Math.cos(th) * r * R, ay = Math.sin(th) * r * R * orb[o + 2];
        const rot = prec * (i % 2 ? 1 : -1) + orb[o] * 0.5;
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const x = cx + ax * ca - ay * sa, y = cy + ax * sa + ay * ca;
        const sz = orb[o + 5] * (0.8 + level * 1.6 + push) * (MINI ? 0.7 : 1);
        ctx.fillStyle = palCol(pal, orb[o + 4] + t * 0.006, (0.25 + level * 0.5 + push * 0.6) * w);
        ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU); ctx.fill();
      }
    }

    // Scene 2 — ridge: a scrolling spectrum terrain. A short history of freq
    // rows recedes upward with perspective, so the music leaves a landscape
    // behind it; the scroll speed itself drifts and rides the level.
    function drawRidge(a, pal, w) {
      const level = a.live ? a.level : 0.12 + 0.04 * Math.sin(t * 0.5);
      const interval = 0.14 - 0.05 * level - 0.03 * (0.5 + 0.5 * Math.sin(t * 0.017));
      ridgeAcc += dtNow;
      if (ridgeAcc >= interval) {
        ridgeAcc = 0;
        ridgeHead = (ridgeHead + 1) % R_ROWS;
        const row = ridgeHead * R_COLS;
        for (let c = 0; c < R_COLS; c++) {
          const uu = c / (R_COLS - 1);
          let v;
          if (a.live && a.freq) { const fi = (uu * a.freq.length * 0.55) | 0; v = a.freq[fi] / 255; }
          else v = (0.3 + 0.7 * Math.max(0, 0.5 - Math.abs(uu - 0.5))) *
                   (0.45 + 0.3 * Math.sin(t * 1.1 + uu * 9) + 0.25 * Math.sin(t * 0.53 + uu * 23));
          ridgeData[row + c] = v < 0 ? 0 : v;
        }
      }
      const frac = ridgeAcc / interval; // smooth scroll between row pushes
      const horizon = H * (0.24 + 0.05 * Math.sin(t * 0.013));
      const baseY = H * 0.9, maxAmp = H * 0.30, drift = t * 0.005;
      for (let j = R_ROWS - 1; j >= 0; j--) { // back (oldest) to front (newest)
        const q = (j + frac) / R_ROWS;        // 0 = front … 1 = back
        const y0 = horizon + (baseY - horizon) * Math.pow(1 - q, 1.55);
        const half = W * 0.5 * (1 - q * 0.55);
        const amp = maxAmp * (1 - q * 0.75) * (0.35 + level * 1.1);
        const row = ((ridgeHead - j + R_ROWS) % R_ROWS) * R_COLS;
        ctx.strokeStyle = palCol(pal, q * 0.8 + drift, (0.06 + (1 - q) * 0.5) * w);
        ctx.lineWidth = MINI ? 1 : 1 + (1 - q) * 1.2;
        ctx.beginPath();
        for (let c = 0; c < R_COLS; c++) {
          const uu = c / (R_COLS - 1);
          const x = W * 0.5 + (uu - 0.5) * 2 * half;
          const y = y0 - ridgeData[row + c] * amp;
          c ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Scene 3 — threads: lissajous/harmonograph curves whose frequency ratio
    // drifts very slowly, so the figure morphs over minutes; the waveform
    // modulates the pen. Glow is additive (a wide soft pass under the bright
    // line) — no shadowBlur here, bloom owns the one blur pass per frame.
    function drawThreads(a, pal, w) {
      const level = a.live ? a.level : 0.1 + 0.05 * Math.sin(t * 0.6);
      const cx = W * 0.5, cy = H * 0.5;
      const R = Math.min(W, H) * 0.36;
      const curves = MINI ? 2 : 3;
      const N = MINI ? 200 : 420;
      const loops = 5 + 2 * Math.sin(t * 0.005);   // pen travel drifts 3..7 turns
      const pen = R * (0.05 + level * 0.35);       // waveform modulation depth
      for (let c = 0; c < curves; c++) {
        const fa = 2 + c + 1.1 * Math.sin(t * 0.006 + c * 2.4);
        const fb = 3 + c * 0.5 + 1.3 * Math.sin(t * 0.0043 + 1.9 + c);
        const pa = t * 0.02 + c * 2.1, pb = t * 0.017 + c * 1.3;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const s = (i / N) * TAU * loops;
          const damp = Math.exp(-s * 0.05); // harmonograph decay, spiralling in
          const wv = sampleWave(a, i / N);
          const x = cx + (Math.sin(fa * s + pa) * R + wv * pen * Math.cos(s)) * damp;
          const y = cy + (Math.sin(fb * s + pb) * R * 0.78 + wv * pen * Math.sin(s)) * damp;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        const hue = c / curves + t * 0.01;
        if (!MINI) { ctx.strokeStyle = palCol(pal, hue, 0.10 * w); ctx.lineWidth = 6; ctx.stroke(); }
        ctx.strokeStyle = palCol(pal, hue, (0.5 + level * 0.4) * w);
        ctx.lineWidth = MINI ? 1 : 1.4;
        ctx.stroke();
      }
    }

    const DRAWS = [drawBloom, drawOrbits, drawRidge, drawThreads];

    // The scene clock: hold ~90 s, then ~8 s crossfade to the next in a fixed
    // cycle. During the fade both scenes draw with complementary weights over
    // one shared trail fade (their trail alphas blended too).
    function drawScenes(a) {
      const idx = Math.floor(t / PERIOD);
      const u = t - idx * PERIOD;
      const cur = idx % DRAWS.length, nxt = (idx + 1) % DRAWS.length;
      const f = u < HOLD ? 0 : (u - HOLD) / FADE;
      const pal = palette();
      ctx.globalCompositeOperation = 'source-over';
      const trail = TRAIL[cur] + (TRAIL[nxt] - TRAIL[cur]) * f;
      ctx.fillStyle = 'rgba(10,11,13,' + trail.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      if (f < 1) DRAWS[cur](a, pal, 1 - f);
      if (f > 0) DRAWS[nxt](a, pal, f);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function frame(ts) {
      raf = 0;
      const now = ts || (window.performance ? performance.now() : 0);
      let dt = (now - last) / 1000; if (!(dt > 0) || dt > 0.05) dt = 0.016; last = now;
      t += dt; dtNow = dt;
      if (!W || !H) resize();
      if (W && H) {
        const a = read();
        if (sceneMode) drawScenes(a); else drawStrip(a);
      }
      if (on && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
    }

    function start() {
      if (on) return;
      on = true; resize();
      last = window.performance ? performance.now() : 0;
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
    }
    function stop() {
      on = false;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
    }

    return { start: start, stop: stop, resize: resize, destroy: stop };
  }

  SDJ.Visualiser = { read: read, mount: mount };
})(window.SDJ = window.SDJ || {});
