// menu.js — the signal-bloom main menu: a live audio viz + a video-game
// channel select. Loaded as a classic script (before app.js); app.js drives it
// via SDJ.Menu.enter()/leave() as the #menu view comes and goes, so the canvas
// only animates while the menu is on screen.
//
// Two upgrades over the design spike:
//   • the wave reads like a REAL signal — a time-domain oscilloscope trace
//     (fundamental + decaying harmonics + vibrato, motion-blurred) over an
//     FFT-style spectrum built from a few drifting spectral "partials" with a
//     bass tilt and peak-hold caps. Not random sine noise.
//   • the menu is a GAME: one channel is selected at a time with a cursor +
//     glow; ↑/↓ (or W/S) move, ↵/→ enter, number keys 1–4 jump straight in.
(function (SDJ) {
  'use strict';

  let cv = null, ctx = null;
  let W = 0, H = 0, dpr = 1;
  let active = false, raf = 0, wired = false, lastTs = 0;
  let t = 0;
  let aud = null; // shared audio read (real analyser data) while the ambience plays

  // ---- FFT-style spectrum: a few drifting partials, not noise --------------
  const NBINS = 72;
  const bins = new Float32Array(NBINS);   // smoothed magnitudes
  const peaks = new Float32Array(NBINS);  // slow-falling peak-hold caps
  const NPART = 6;
  const parts = [];
  // Seed the partial layout once, deterministically (mirrors how visualiser.js
  // seeds its one-off layouts) — never Math.random, so the menu is resume-safe
  // and reads identically every load.
  const seedRng = (SDJ.Rng && SDJ.Rng.make)
    ? SDJ.Rng.make(0x5eed11fe >>> 0)
    : (function () { let s = 1234567; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let i = 0; i < NPART; i++) {
    parts.push({
      pos: seedRng(),                       // 0..1 position across the spectrum
      vel: (seedRng() * 2 - 1) * 0.03,
      width: 0.03 + seedRng() * 0.06,
      amp: 0.4 + seedRng() * 0.7,
      ph: seedRng() * Math.PI * 2,
    });
  }

  // ---- beat clock: a ~2 Hz pulse so the whole viz breathes musically -------
  let beatPhase = 0, beat = 0;

  const CYCLES = 6; // oscilloscope wave cycles across the screen

  function ensure() {
    if (ctx) return true;
    cv = document.getElementById('menuViz');
    if (!cv) return false;
    ctx = cv.getContext('2d');
    return !!ctx;
  }

  function resize() {
    if (!ensure()) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    if (!W || !H) return; // hidden — size when it becomes visible
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Target magnitude for spectrum bin i (0..NBINS-1): bass tilt + partial bumps
  // + a beat-driven low-end lift + a faint noise floor. Reads like music energy.
  function spectrumTarget(i) {
    const x = i / (NBINS - 1);                 // 0 = low freq (left), 1 = high
    let v = Math.pow(1 - x, 1.7) * 0.45;       // bass tilt
    for (let p = 0; p < parts.length; p++) {
      const pt = parts[p];
      const d = x - pt.pos;
      const bump = pt.amp * Math.exp(-(d * d) / (2 * pt.width * pt.width));
      v += bump * (0.6 + 0.4 * Math.sin(t * 3 + pt.ph));
    }
    v += beat * Math.exp(-x * 6) * 0.3;        // kick lifts the low end (gently)
    // deterministic, allocation-free noise floor (resume-safe; drifts off t)
    v += 0.025 * (Math.sin(i * 12.9898 + t * 0.7) * 0.5 + 0.5);
    return v;
  }

  // Oscilloscope sample at u (0..1 across the width): a fundamental with a few
  // decaying harmonics + a slow vibrato/AM envelope, coupled to the beat, with a
  // touch of noise so it isn't a sterile sine. Returns roughly -1..1.
  function scope(u) {
    if (aud && aud.live && aud.wave) {
      const w = aud.wave, wi = Math.min(w.length - 1, (u * (w.length - 1)) | 0);
      return ((w[wi] - 128) / 128) * (0.85 + 0.3 * beat);
    }
    const k = u * Math.PI * 2 * CYCLES + t * 0.9;
    let y = Math.sin(k) + 0.5 * Math.sin(2 * k + 0.6) + 0.33 * Math.sin(3 * k + 1.2) + 0.16 * Math.sin(5 * k);
    y /= 1.99;
    const env = 0.72 + 0.28 * Math.sin(t * 0.9 + u * Math.PI * 3);
    // deterministic dither (resume-safe): a cheap t-driven hash, centred on 0
    const dither = (Math.sin(u * 78.233 + t * 11.3) * 0.5) * 0.02;
    return (y + dither) * env * (0.78 + 0.22 * beat);
  }

  // Map an FFT frame onto the NBINS display bins — the lower ~55% of the spectrum,
  // where the music's energy sits — taking the peak per bin so transients read.
  function realTarget(i) {
    const f = aud.freq;
    const lo = Math.floor((i / NBINS) * f.length * 0.55);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / NBINS) * f.length * 0.55));
    let m = 0;
    for (let k = lo; k < hi; k++) if (f[k] > m) m = f[k];
    return (m / 255) * 1.1;
  }

  function step(dt) {
    t += dt;
    // real audio read (analyser) while the menu ambience is actually playing
    aud = (SDJ.Visualiser && SDJ.Visualiser.read) ? SDJ.Visualiser.read() : null;
    // advance the beat clock and decay the pulse; a live low-end drives it harder
    beatPhase += dt * 2;
    if (beatPhase >= 1) { beatPhase -= 1; beat = 0.6; }
    beat = Math.max(0, beat - dt * 3);
    if (aud && aud.live) beat = Math.max(beat, aud.bass * 0.9);
    // drift the partials slowly, bouncing inside 0..1
    for (let p = 0; p < parts.length; p++) {
      const pt = parts[p];
      pt.pos += pt.vel * dt * 7;
      if (pt.pos < 0) { pt.pos = 0; pt.vel = -pt.vel; }
      if (pt.pos > 1) { pt.pos = 1; pt.vel = -pt.vel; }
    }
    // spectrum: real FFT when playing, synthetic partials otherwise; gentle
    // attack, slow release + falling peak-hold caps either way
    const live = aud && aud.live && aud.freq;
    for (let i = 0; i < NBINS; i++) {
      const target = live ? realTarget(i) : spectrumTarget(i);
      const a = target > bins[i] ? 0.32 : 0.1;
      bins[i] += (target - bins[i]) * a;
      peaks[i] = Math.max(peaks[i] - dt * 0.6, bins[i]);
    }
  }

  function draw() {
    if (!ctx || !W || !H) return;

    // motion-blur: fade the previous frame toward the background instead of a
    // hard clear — gives the scope + particles a real oscilloscope after-image.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(23, 25, 29, 0.26)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';

    // hot radial core, left third (the "bloom")
    const cx = W * 0.34, cy = H * 0.52, cr = Math.min(W, H) * (0.13 + beat * 0.015);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    core.addColorStop(0, 'rgba(40,200,224,' + (0.28 + beat * 0.1).toFixed(3) + ')');
    core.addColorStop(0.5, 'rgba(40,200,224,0.12)');
    core.addColorStop(1, 'rgba(40,200,224,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();

    // spectrum along the floor
    const baseY = H * 0.9, bw = W / NBINS, maxH = H * 0.22;
    for (let i = 0; i < NBINS; i++) {
      const x = i * bw;
      const h = Math.max(2, bins[i] * maxH);
      const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
      g.addColorStop(0, 'rgba(40,200,224,0.85)');
      g.addColorStop(1, 'rgba(40,200,224,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, baseY - h, bw - 2, h);
      // peak-hold cap
      const ph = Math.max(2, peaks[i] * maxH);
      ctx.fillStyle = 'rgba(255,155,47,0.5)';
      ctx.fillRect(x + 1, baseY - ph - 2, bw - 2, 2);
      // mirrored shimmer
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, baseY + 2, bw - 2, h * 0.35);
      ctx.globalAlpha = 1;
    }

    // the oscilloscope trace — a real time-domain waveform across the middle
    const midY = H * 0.46, amp = H * 0.10;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#28c8e0');
    grad.addColorStop(0.5, '#28c8e0');
    grad.addColorStop(1, '#ff9b2f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = 'rgba(40,200,224,0.9)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    const N = Math.max(64, Math.floor(W / 3));
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = u * W;
      const y = midY + scope(u) * amp;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // drifting particles
    for (let i = 0; i < 34; i++) {
      const px = (i * 97.3 + t * (12 + (i % 5) * 6)) % W;
      const py = (i * 53.7 + Math.sin(t + i) * 24) % H;
      ctx.fillStyle = 'rgba(40,200,224,' + (0.05 + (i % 4) * 0.03).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py, 1 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(ts) {
    raf = 0;
    const now = ts || (window.performance ? performance.now() : Date.now());
    let dt = (now - lastTs) / 1000;
    if (!(dt > 0) || dt > 0.05) dt = 0.016;
    lastTs = now;
    step(dt);
    draw();
    if (active) raf = requestAnimationFrame(loop);
  }

  // ---- video-game channel select ------------------------------------------
  let channels = [];
  let sel = 0;

  function refreshChannels() {
    channels = Array.prototype.slice.call(document.querySelectorAll('#menuChannels .channel'));
    if (sel >= channels.length) sel = 0;
  }

  function select(i) {
    if (!channels.length) return;
    sel = (i + channels.length) % channels.length;
    for (let k = 0; k < channels.length; k++) channels[k].classList.toggle('sel', k === sel);
  }

  function activate() {
    const c = channels[sel];
    if (!c) return;
    // a channel can trigger an action (pure-visual mode) instead of a hash route
    if (c.getAttribute('data-action') === 'visuals') {
      if (SDJ.openVisuals) SDJ.openVisuals();
      return;
    }
    const href = c.getAttribute('href');
    if (href) location.hash = href;
  }

  function onKey(e) {
    if (!active) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') { select(sel + 1); e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') { select(sel - 1); e.preventDefault(); }
    else if (k === 'Enter' || k === 'ArrowRight') { activate(); e.preventDefault(); }
    else if (k >= '1' && k <= '9') {
      const idx = (+k) - 1;
      if (idx < channels.length) { select(idx); activate(); e.preventDefault(); }
    }
  }

  function wire() {
    if (wired) return;
    refreshChannels();
    channels.forEach((c, k) => {
      c.addEventListener('mouseenter', () => select(k));
      c.addEventListener('focus', () => select(k));
      // channels that trigger an action (not a hash route) fire it on click
      if (c.getAttribute('data-action')) {
        c.addEventListener('click', (e) => { e.preventDefault(); select(k); activate(); });
      }
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (active) resize(); });
    wired = true;
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function enter() {
    if (!ensure()) return;
    active = true;
    wire();
    refreshChannels();
    select(sel);
    resize();
    lastTs = window.performance ? performance.now() : Date.now();
    // Respect reduced-motion: paint one calm static frame, skip the rAF loop.
    if (prefersReducedMotion()) { step(0.016); draw(); return; }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function leave() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  SDJ.Menu = { enter: enter, leave: leave, resize: resize, select: select };
})(window.SDJ = window.SDJ || {});
