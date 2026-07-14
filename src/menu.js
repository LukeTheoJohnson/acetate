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

  // ---- FFT-style spectrum: a few drifting partials, not noise --------------
  const NBINS = 72;
  const bins = new Float32Array(NBINS);   // smoothed magnitudes
  const peaks = new Float32Array(NBINS);  // slow-falling peak-hold caps
  const NPART = 6;
  const parts = [];
  for (let i = 0; i < NPART; i++) {
    parts.push({
      pos: Math.random(),                 // 0..1 position across the spectrum
      vel: (Math.random() * 2 - 1) * 0.03,
      width: 0.03 + Math.random() * 0.06,
      amp: 0.4 + Math.random() * 0.7,
      ph: Math.random() * Math.PI * 2,
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
    v += 0.025 * Math.random();                // noise floor
    return v;
  }

  // Oscilloscope sample at u (0..1 across the width): a fundamental with a few
  // decaying harmonics + a slow vibrato/AM envelope, coupled to the beat, with a
  // touch of noise so it isn't a sterile sine. Returns roughly -1..1.
  function scope(u) {
    const k = u * Math.PI * 2 * CYCLES + t * 0.9;
    let y = Math.sin(k) + 0.5 * Math.sin(2 * k + 0.6) + 0.33 * Math.sin(3 * k + 1.2) + 0.16 * Math.sin(5 * k);
    y /= 1.99;
    const env = 0.72 + 0.28 * Math.sin(t * 0.9 + u * Math.PI * 3);
    return (y + (Math.random() - 0.5) * 0.02) * env * (0.78 + 0.22 * beat);
  }

  function step(dt) {
    t += dt;
    // advance the beat clock and decay the pulse
    beatPhase += dt * 2;
    if (beatPhase >= 1) { beatPhase -= 1; beat = 0.6; }
    beat = Math.max(0, beat - dt * 3);
    // drift the partials slowly, bouncing inside 0..1
    for (let p = 0; p < parts.length; p++) {
      const pt = parts[p];
      pt.pos += pt.vel * dt * 7;
      if (pt.pos < 0) { pt.pos = 0; pt.vel = -pt.vel; }
      if (pt.pos > 1) { pt.pos = 1; pt.vel = -pt.vel; }
    }
    // spectrum: gentle attack, slow release + falling peak-hold caps
    for (let i = 0; i < NBINS; i++) {
      const target = spectrumTarget(i);
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
    ctx.fillStyle = 'rgba(6, 4, 13, 0.26)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';

    // hot radial core, left third (the "bloom")
    const cx = W * 0.34, cy = H * 0.52, cr = Math.min(W, H) * (0.13 + beat * 0.015);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    core.addColorStop(0, 'rgba(255,61,129,' + (0.28 + beat * 0.1).toFixed(3) + ')');
    core.addColorStop(0.5, 'rgba(122,92,255,0.12)');
    core.addColorStop(1, 'rgba(122,92,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();

    // spectrum along the floor
    const baseY = H * 0.9, bw = W / NBINS, maxH = H * 0.22;
    for (let i = 0; i < NBINS; i++) {
      const x = i * bw;
      const h = Math.max(2, bins[i] * maxH);
      const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
      g.addColorStop(0, 'rgba(34,211,238,0.85)');
      g.addColorStop(1, 'rgba(122,92,255,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, baseY - h, bw - 2, h);
      // peak-hold cap
      const ph = Math.max(2, peaks[i] * maxH);
      ctx.fillStyle = 'rgba(255,61,129,0.5)';
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
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.5, '#7a5cff');
    grad.addColorStop(1, '#ff3d81');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = 'rgba(122,92,255,0.9)';
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
      ctx.fillStyle = 'rgba(255,61,129,' + (0.05 + (i % 4) * 0.03).toFixed(3) + ')';
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
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (active) resize(); });
    wired = true;
  }

  function enter() {
    if (!ensure()) return;
    active = true;
    wire();
    refreshChannels();
    select(sel);
    resize();
    lastTs = window.performance ? performance.now() : Date.now();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function leave() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  SDJ.Menu = { enter: enter, leave: leave, resize: resize, select: select };
})(window.SDJ = window.SDJ || {});
