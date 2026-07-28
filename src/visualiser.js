// visualiser.js — the shared reactive audio visualiser.
//
// One component, two mounts: a full-screen "pure visual" screensaver (the menu's
// Visuals mode) and the compact strip player in the top bar. It reads the REAL
// audio off a shared AnalyserNode (SDJ.getAnalyser, teed off the master bus in
// app.js) so the picture actually follows the music — menu ambience, a live set
// or a remix — and falls back to a gentle synthetic idle when nothing plays.
// The menu's own background canvas (menu.js) also reads through SDJ.Visualiser.read
// so it reacts to the same signal. Classic script, no dependencies, jsdom-safe.
(function (SDJ) {
  'use strict';

  const COOL = '#28c8e0';  // Deck A — cyan
  const WARM = '#ff9b2f';  // Deck B — amber
  const CY = 6;            // idle oscilloscope cycles across the width

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

  function noop() { return { start: function () {}, stop: function () {}, resize: function () {}, destroy: function () {} }; }

  // ---- an instance bound to one canvas + one draw style ('full' | 'strip') ----
  function mount(canvas, opts) {
    opts = opts || {};
    const mode = opts.mode || 'strip';
    if (!canvas || typeof canvas.getContext !== 'function') return noop();
    const ctx = canvas.getContext('2d');
    if (!ctx) return noop(); // jsdom / no 2d context — safe no-op

    let W = 0, H = 0, dpr = 1, raf = 0, on = false, last = 0, t = 0;

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

    function drawFull(a) {
      // motion-blur trail: fade the previous frame toward black for an after-image
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(10, 11, 13, 0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      const bass = a.live ? a.bass : 0.15 + 0.1 * Math.sin(t * 1.6);

      // central bloom, pulsing on the low end
      const cx = W * 0.5, cy = H * 0.5, cr = Math.min(W, H) * (0.16 + bass * 0.12);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      core.addColorStop(0, 'rgba(40,200,224,' + (0.22 + bass * 0.3).toFixed(3) + ')');
      core.addColorStop(0.55, 'rgba(40,200,224,0.08)');
      core.addColorStop(1, 'rgba(40,200,224,0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();

      // spectrum along the floor, cyan→amber left to right
      const bars = 96, baseY = H * 0.82, bw = W / bars, maxH = H * 0.34;
      for (let i = 0; i < bars; i++) {
        let v;
        if (a.live && a.freq) { const fi = ((i / bars) * a.freq.length * 0.6) | 0; v = a.freq[fi] / 255; }
        else v = Math.max(0, 0.4 - Math.abs(i / bars - 0.5)) * (0.5 + 0.5 * Math.sin(t * 2 + i * 0.3));
        const h = Math.max(2, v * maxH), x = i * bw;
        const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
        g.addColorStop(0, i / bars < 0.5 ? COOL : WARM);
        g.addColorStop(1, 'rgba(40,200,224,0.05)');
        ctx.fillStyle = g; ctx.fillRect(x + 1, baseY - h, bw - 2, h);
        ctx.globalAlpha = 0.12; ctx.fillRect(x + 1, baseY + 2, bw - 2, h * 0.4); ctx.globalAlpha = 1;
      }

      // the big oscilloscope trace across the middle
      const midY = H * 0.44, amp = H * 0.16;
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, COOL); grad.addColorStop(0.5, COOL); grad.addColorStop(1, WARM);
      ctx.strokeStyle = grad; ctx.lineWidth = 2.4;
      ctx.shadowColor = 'rgba(40,200,224,0.8)'; ctx.shadowBlur = 16;
      ctx.beginPath();
      const N = Math.max(120, Math.floor(W / 3));
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = u * W, y = midY + sampleWave(a, u) * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(ts) {
      raf = 0;
      const now = ts || (window.performance ? performance.now() : 0);
      let dt = (now - last) / 1000; if (!(dt > 0) || dt > 0.05) dt = 0.016; last = now;
      t += dt;
      if (!W || !H) resize();
      if (W && H) (mode === 'full' ? drawFull : drawStrip)(read());
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
