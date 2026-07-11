// viz.js — the "watch the crowd" panel.
//
// A canvas animation of a dancing crowd whose energy, colour and motion
// track the DJ's live state. Beat timing is a lightweight clock synced to
// the song's cps (it isn't sample-accurate to the audio, but it reads as
// on-beat and costs nothing).
(function (SDJ) {
  'use strict';

  function Viz(canvas, getState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getState = getState;
    this.dancers = [];
    this.phase = 0; // beat phase accumulator
    this.lastBeat = 0; // ms of last beat, for the pulse ring
    this.lastT = 0;
    this.w = 0;
    this.h = 0;
    this.running = false;
  }

  Viz.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this._frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  Viz.prototype.stop = function () {
    this.running = false;
  };

  Viz.prototype._resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW === this.w && cssH === this.h) return;
    this.w = cssW;
    this.h = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._buildCrowd();
  };

  Viz.prototype._buildCrowd = function () {
    const rows = 4;
    const perRow = Math.max(4, Math.floor(this.w / 46));
    this.dancers = [];
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < perRow; i++) {
        // stagger alternate rows; nearer rows (higher row index) sit lower/larger
        const jitter = ((i * 37 + row * 91) % 20) / 20 - 0.5;
        const x = ((i + (row % 2) * 0.5 + 0.5) / perRow) * this.w + jitter * 10;
        const depth = row / (rows - 1); // 0 back .. 1 front
        const y = this.h * (0.5 + depth * 0.42);
        this.dancers.push({
          x,
          y,
          scale: 0.6 + depth * 0.7,
          off: (i * 0.7 + row * 1.3) % (Math.PI * 2),
          hueShift: jitter * 30,
        });
      }
    }
  };

  Viz.prototype._frame = function (t) {
    this._resize();
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    const st = this.getState();
    const ctx = this.ctx;

    // advance the beat clock
    const beatsPerSec = (st.cps || 0.5) * 4;
    const prevPhase = this.phase;
    this.phase += dt * beatsPerSec;
    if (Math.floor(this.phase) !== Math.floor(prevPhase)) this.lastBeat = t;
    const beatFrac = this.phase - Math.floor(this.phase); // 0..1 within a beat
    const beatPulse = Math.pow(1 - beatFrac, 2); // 1 on the beat, decaying

    const energy = st.energy != null ? st.energy : 0.4;
    const approval = (st.approval != null ? st.approval : 20) / 100;

    // ---- backdrop -------------------------------------------------------
    const hue = 210 - energy * 170; // cool blue -> hot orange
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, 'hsl(' + (hue + 20) + ', 45%, ' + (6 + energy * 6) + '%)');
    g.addColorStop(1, 'hsl(' + hue + ', 55%, ' + (3 + energy * 3) + '%)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // strobe flash on the beat when the room is hot
    if (energy > 0.6) {
      ctx.fillStyle = 'rgba(255,255,255,' + beatPulse * (energy - 0.6) * 0.5 + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // sweeping DJ light beams from the top
    this._beams(ctx, t, hue, energy);

    // ---- crowd ----------------------------------------------------------
    const amp = 6 + energy * 26; // bounce height
    for (const d of this.dancers) {
      const bob = Math.abs(Math.sin(this.phase * Math.PI + d.off));
      const yOff = -bob * amp * d.scale;
      const armRaise = energy * (0.4 + 0.6 * bob); // arms up when hyped
      this._dancer(ctx, d, yOff, armRaise, hue + d.hueShift, energy);
    }

    // ---- floor pulse ring on each beat ---------------------------------
    const sinceBeat = (t - this.lastBeat) / 1000;
    const ringLife = 0.5;
    if (sinceBeat < ringLife && energy > 0.15) {
      const p = sinceBeat / ringLife;
      ctx.strokeStyle =
        'hsla(' + hue + ', 90%, 65%, ' + (1 - p) * 0.5 * energy + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.w / 2, this.h * 0.92, p * this.w * 0.7, p * this.h * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ---- hype confetti when the crowd is close to a banger --------------
    if (approval > 0.7) this._confetti(ctx, t, approval, hue);
  };

  Viz.prototype._beams = function (ctx, t, hue, energy) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const sway = Math.sin(t / 1400 + i * 2.1) * this.w * 0.3;
      const x = this.w * (0.25 + i * 0.25) + sway;
      const grd = ctx.createLinearGradient(this.w / 2, 0, x, this.h);
      grd.addColorStop(0, 'hsla(' + (hue + i * 40) + ', 90%, 60%, ' + (0.06 + energy * 0.12) + ')');
      grd.addColorStop(1, 'hsla(' + (hue + i * 40) + ', 90%, 60%, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(this.w / 2 - 12, 0);
      ctx.lineTo(this.w / 2 + 12, 0);
      ctx.lineTo(x + 60, this.h);
      ctx.lineTo(x - 60, this.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  Viz.prototype._dancer = function (ctx, d, yOff, armRaise, hue, energy) {
    const x = d.x;
    const y = d.y + yOff;
    const s = d.scale;
    const bodyH = 20 * s;
    const bodyW = 7 * s;
    const headR = 5 * s;
    const light = 45 + energy * 25;
    ctx.fillStyle = 'hsl(' + hue + ', 70%, ' + light + '%)';
    ctx.strokeStyle = 'hsl(' + hue + ', 70%, ' + light + '%)';
    ctx.lineWidth = 2.4 * s;
    ctx.lineCap = 'round';

    // body
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - bodyH);
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.arc(x, y - bodyH - headR, headR, 0, Math.PI * 2);
    ctx.fill();
    // arms — raise angle grows with energy
    const a = (Math.PI / 2) * (0.2 + armRaise);
    const armLen = 10 * s;
    const shoulderY = y - bodyH * 0.72;
    ctx.beginPath();
    ctx.moveTo(x, shoulderY);
    ctx.lineTo(x - Math.cos(a) * armLen, shoulderY - Math.sin(a) * armLen);
    ctx.moveTo(x, shoulderY);
    ctx.lineTo(x + Math.cos(a) * armLen, shoulderY - Math.sin(a) * armLen);
    ctx.stroke();
    // legs
    const legLen = 9 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - legLen * 0.5, y + legLen);
    ctx.moveTo(x, y);
    ctx.lineTo(x + legLen * 0.5, y + legLen);
    ctx.stroke();
  };

  Viz.prototype._confetti = function (ctx, t, approval, hue) {
    const n = Math.floor((approval - 0.7) * 60);
    for (let i = 0; i < n; i++) {
      const seed = i * 928371;
      const x = ((seed % 1000) / 1000) * this.w;
      const speed = 40 + (seed % 60);
      const y = ((t / 1000) * speed + (seed % this.h)) % this.h;
      ctx.fillStyle = 'hsl(' + ((hue + i * 47) % 360) + ', 90%, 65%)';
      ctx.fillRect(x, y, 3, 6);
    }
  };

  SDJ.Viz = Viz;
})(window.SDJ = window.SDJ || {});
