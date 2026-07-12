// log.js — a structured, exportable trace of a live DJ set, for diagnosis.
//
// The app feeds one compact row per evolution tick (crowd input, approval,
// temperature, mode, the exact genome, the move on offer and each keep/revert/
// gamble verdict) plus tagged boundary rows (set start, song change, banger,
// stop). stats() distils it into "is it stuck?" metrics — how much time it
// spends unable to climb, how often it reverts, and how many genome states it
// actually revisits — and download() saves the lot as JSON to hand back for
// analysis. Dependency-free; safe to omit (app.js guards every call).
(function (SDJ) {
  'use strict';

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function SetLog() {
    this.rows = [];
    this.t0 = 0;       // set lazily on the first row after a clear
    this.cap = 50000;  // ~14h at 1/s; guards runaway memory
  }

  SetLog.prototype.clear = function () {
    this.rows = [];
    this.t0 = 0;
  };

  SetLog.prototype.count = function () {
    return this.rows.length;
  };

  SetLog.prototype._stamp = function (row) {
    const t = nowMs();
    if (!this.t0) this.t0 = t;
    row.t = Math.round((t - this.t0) / 100) / 10; // seconds, 1 dp
    this.rows.push(row);
    if (this.rows.length > this.cap) this.rows.shift();
    return row;
  };

  // One evolution tick. `row` is a plain object built by the app.
  SetLog.prototype.record = function (row) {
    return this._stamp(row);
  };

  // A boundary marker: set start, song change, banger, stop.
  SetLog.prototype.mark = function (type, data) {
    const row = { tag: type };
    if (data) for (const k in data) row[k] = data[k];
    return this._stamp(row);
  };

  // Distil the trace into stuck-detecting metrics.
  SetLog.prototype.stats = function () {
    const mode = { searching: 0, building: 0, 'locked in': 0 };
    const vk = { kept: 0, reverted: 0, gambled: 0, flat: 0 };
    const stateCount = {};
    const moveCount = {};
    const banks = {}, progs = {}, scales = {};
    let ticks = 0, sets = 0, songs = 0, bangers = 0, below = 0, curveballs = 0;
    let searchStreak = 0, longestSearch = 0, lastT = 0;

    for (const r of this.rows) {
      if (r.tag) {
        if (r.tag === 'set') sets++;
        else if (r.tag === 'song') { songs++; if (r.reason === 'banger') bangers++; }
        continue;
      }
      ticks++;
      lastT = r.t;
      if (r.md in mode) mode[r.md]++;
      if (r.md === 'searching') { below++; searchStreak++; if (searchStreak > longestSearch) longestSearch = searchStreak; }
      else searchStreak = 0;
      if (r.vk && Object.prototype.hasOwnProperty.call(vk, r.vk)) vk[r.vk]++;
      const key = r.act + '|' + (r.vr || []).join('.') + '|' + r.en + '|' + r.bk + '|' + r.pr + '|' + r.sc;
      stateCount[key] = (stateCount[key] || 0) + 1;
      if (r.mv) {
        moveCount[r.mv] = (moveCount[r.mv] || 0) + 1;
        if (r.mv.indexOf('🎲') === 0) curveballs++; // 🎲 curveball
      }
      if (r.bk != null) banks[r.bk] = 1;
      if (r.pr) progs[r.pr] = 1;
      if (r.sc) scales[r.sc] = 1;
    }

    const uniqueStates = Object.keys(stateCount).length;
    const judged = vk.kept + vk.reverted + vk.gambled + vk.flat;
    const modePct = {};
    for (const k in mode) modePct[k] = ticks ? Math.round((mode[k] / ticks) * 100) : 0;
    const topMoves = Object.keys(moveCount)
      .map((k) => ({ move: k, n: moveCount[k] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
    const worstState = Object.keys(stateCount)
      .map((k) => ({ state: k, n: stateCount[k] }))
      .sort((a, b) => b.n - a.n)[0] || null;

    return {
      ticks,
      seconds: lastT,
      sets,
      songs,
      bangers,
      modePct,
      verdicts: vk,
      revertRate: judged ? Math.round((vk.reverted / judged) * 100) : 0,
      acceptRate: judged ? Math.round((vk.kept / judged) * 100) : 0,
      gambleRate: judged ? Math.round((vk.gambled / judged) * 100) : 0,
      uniqueStates,
      stateRevisits: ticks - uniqueStates,
      repetitionPct: ticks ? Math.round(((ticks - uniqueStates) / ticks) * 100) : 0,
      longestSearchingStreak: longestSearch,
      pctBelowWarm: ticks ? Math.round((below / ticks) * 100) : 0,
      curveballs,
      distinctBanks: Object.keys(banks).length,
      distinctProgs: Object.keys(progs).length,
      distinctScales: Object.keys(scales).length,
      topMoves,
      mostRepeatedState: worstState,
    };
  };

  SetLog.prototype.toJSON = function () {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        stats: this.stats(),
        rows: this.rows,
      },
      null,
      0
    );
  };

  // Trigger a browser download of the trace. Browser-only; no-op elsewhere.
  SetLog.prototype.download = function (name) {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
    const blob = new Blob([this.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'sdj-setlog-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
    return true;
  };

  SDJ.SetLog = new SetLog();
})(window.SDJ = window.SDJ || {});
