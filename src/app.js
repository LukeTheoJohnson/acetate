// app.js — wires the DJ engine, Strudel audio, the crowd panel and the UI.
(function (SDJ) {
  'use strict';

  const TICK_MS = 1000; // evolution cadence
  const CRATE_KEY = 'sdj.crate';
  const CRATE_CAP = 40;

  const engine = new SDJ.DJEngine();
  let viz = null;
  let started = false; // Strudel initialised
  let running = false; // live set in progress
  let paused = false; // previewing a saved track
  let tickTimer = null;
  let lastGoodCode = '';

  // ---- element handles (filled on DOMContentLoaded) ----------------------
  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function boot() {
    [
      'startBtn', 'skipBtn', 'mood', 'moodVal', 'moodLabel', 'code', 'log',
      'trackName', 'trackMeta', 'stageChips', 'energyBar', 'approvalBar',
      'hitBar', 'hitWrap', 'crowd', 'crate', 'previewBanner', 'previewName',
      'returnBtn', 'status',
    ].forEach((id) => (el[id] = $(id)));

    viz = new SDJ.Viz(el.crowd, () =>
      engine.song ? engine.state() : { cps: 0.5, energy: 0.35, approval: 20 }
    );

    el.startBtn.addEventListener('click', onStartStop);
    el.skipBtn.addEventListener('click', onSkip);
    el.mood.addEventListener('input', onMood);
    el.returnBtn.addEventListener('click', returnToLive);
    onMood();
    renderCrate();
    viz.start(); // idle crowd sways before the set begins
    setStatus('Press “Start the set” to bring the DJ up. Audio needs a click to begin.');
  }

  // ---- transport ---------------------------------------------------------

  function onStartStop() {
    if (!running) startSet();
    else stopSet();
  }

  async function startSet() {
    if (!started) {
      if (typeof window.initStrudel !== 'function') {
        setStatus('⚠ Strudel failed to load (are you online?). Try a hard refresh.');
        return;
      }
      try {
        await window.initStrudel();
      } catch (err) {
        console.error(err);
      }
      if (typeof window.samples === 'function') {
        setStatus('Loading sounds…');
        try {
          // @strudel/web ships no default drum samples — load a kit so the
          // drum layers (bd sd hh ho cp) actually sound.
          await window.samples('https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/strudel.json');
        } catch (e) {
          console.error('sample load failed:', e);
        }
      }
      started = true;
      viz.start();
    }
    running = true;
    paused = false;
    el.startBtn.textContent = '⏸ Stop the set';
    el.previewBanner.hidden = true;
    engine.newSong();
    evaluateCurrent(true);
    updateUI();
    clearLog();
    logEvent('🎧 ' + engine.song.name + ' — building from the kick up…');
    tickTimer = setInterval(loop, TICK_MS);
    setStatus('Live. Drag the crowd mood to steer the set.');
  }

  function stopSet() {
    running = false;
    el.startBtn.textContent = '▶ Start the set';
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    if (typeof window.hush === 'function') window.hush();
    setStatus('Stopped. Press start to bring the DJ back up.');
  }

  function onSkip() {
    if (!running) return;
    logEvent('⏭ crowd wanted something new — fresh track');
    engine.newSong();
    evaluateCurrent(true);
    updateUI();
    logEvent('🎧 ' + engine.song.name);
  }

  // ---- the evolution loop ------------------------------------------------

  function loop() {
    if (!running || paused) return;
    const mood = getMood();
    const res = engine.tick(mood, TICK_MS / 1000);
    for (const e of res.events) logEvent(e);
    if (res.changed) evaluateCurrent(false);
    updateUI();

    if (res.hit) {
      saveBanger();
      engine.newSong();
      evaluateCurrent(true);
      logEvent('🎧 next up: ' + engine.song.name);
    }
  }

  function evaluateCurrent(isNew) {
    const code = engine.render();
    showCode(code, !isNew);
    if (typeof window.evaluate !== 'function') return;
    try {
      window.evaluate(code);
      lastGoodCode = code;
    } catch (err) {
      console.error('Strudel eval error:', err, '\n', code);
      if (lastGoodCode) {
        try { window.evaluate(lastGoodCode); } catch (e) { /* ignore */ }
      }
    }
  }

  // ---- saving bangers ----------------------------------------------------

  function saveBanger() {
    const s = engine.song;
    const entry = {
      name: s.name,
      key: s.key,
      scaleType: s.scaleType,
      bpm: s.bpm,
      code: engine.render(),
      approval: Math.round(s.approval),
      savedAt: Date.now(),
    };
    const crate = loadCrate();
    crate.unshift(entry);
    if (crate.length > CRATE_CAP) crate.length = CRATE_CAP;
    localStorage.setItem(CRATE_KEY, JSON.stringify(crate));
    logEvent('💾 the crowd went off — saved “' + s.name + '” to the crate');
    renderCrate();
  }

  function loadCrate() {
    try {
      return JSON.parse(localStorage.getItem(CRATE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function renderCrate() {
    const crate = loadCrate();
    el.crate.innerHTML = '';
    if (!crate.length) {
      el.crate.innerHTML =
        '<li class="crate-empty">No saved tracks yet. Hold the mood high on a full track to bank a banger.</li>';
      return;
    }
    crate.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'crate-item';
      li.innerHTML =
        '<div class="crate-meta"><strong>' +
        escapeHtml(entry.name) +
        '</strong><span>' +
        entry.key + ' ' + entry.scaleType + ' · ' + entry.bpm + ' BPM</span></div>' +
        '<div class="crate-actions">' +
        '<button data-act="play" data-i="' + i + '" title="Preview">▶</button>' +
        '<button data-act="del" data-i="' + i + '" title="Delete">✕</button>' +
        '</div>';
      el.crate.appendChild(li);
    });
    el.crate.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        if (b.dataset.act === 'play') previewTrack(i);
        else deleteTrack(i);
      });
    });
  }

  function deleteTrack(i) {
    const crate = loadCrate();
    crate.splice(i, 1);
    localStorage.setItem(CRATE_KEY, JSON.stringify(crate));
    renderCrate();
  }

  function previewTrack(i) {
    const entry = loadCrate()[i];
    if (!entry) return;
    if (!started) {
      setStatus('Start the set once to unlock audio, then preview saved tracks.');
      return;
    }
    paused = true;
    showCode(entry.code, false);
    if (typeof window.evaluate === 'function') {
      try { window.evaluate(entry.code); } catch (e) { console.error(e); }
    }
    el.previewName.textContent = entry.name;
    el.previewBanner.hidden = false;
    setStatus('Previewing a saved track. The live set is paused.');
  }

  function returnToLive() {
    paused = false;
    el.previewBanner.hidden = true;
    if (engine.song) evaluateCurrent(true);
    setStatus('Back to the live set.');
  }

  // ---- crowd mood --------------------------------------------------------

  function getMood() {
    return (+el.mood.value) / 100; // -1 .. 1
  }
  function onMood() {
    const m = getMood();
    el.moodVal.textContent = (m >= 0 ? '+' : '') + Math.round(m * 100);
    let label = 'Feeling it';
    if (m > 0.6) label = '🔥 Going off';
    else if (m > 0.2) label = '🙌 Into it';
    else if (m > -0.2) label = '😐 On the fence';
    else if (m > -0.6) label = '🥱 Losing them';
    else label = '🧊 Clearing the floor';
    el.moodLabel.textContent = label;
    const hue = 210 - ((m + 1) / 2) * 170;
    el.mood.style.setProperty('--mood-hue', hue);
  }

  // ---- UI updates --------------------------------------------------------

  function updateUI() {
    if (!engine.song) return;
    const st = engine.state();
    el.trackName.textContent = st.name;
    el.trackMeta.textContent =
      st.key + ' ' + st.scaleType + ' · ' + st.bpm + ' BPM · building ' +
      st.stageLabel;
    if (el.stageChips.childElementCount !== st.stageKeys.length) {
      el.stageChips.innerHTML = '';
      st.stageKeys.forEach((k) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.textContent = k;
        el.stageChips.appendChild(c);
      });
    }
    Array.from(el.stageChips.children).forEach((c, i) => {
      c.classList.toggle('on', i <= st.stage);
    });
    el.energyBar.style.width = Math.round(st.energy * 100) + '%';
    el.approvalBar.style.width = Math.round(st.approval) + '%';
    el.hitBar.style.width = Math.round(st.hitProgress * 100) + '%';
    el.hitWrap.classList.toggle('armed', st.hitProgress > 0.05);
  }

  // ---- live code panel ---------------------------------------------------

  function showCode(code, flash) {
    el.code.innerHTML = highlight(code);
    if (flash) {
      el.code.classList.remove('flash');
      void el.code.offsetWidth; // reflow to restart the animation
      el.code.classList.add('flash');
    }
  }

  // Single-pass tokeniser so string contents (which contain < > for
  // mini-notation) are never re-scanned for numbers or function names.
  function highlight(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    const isWord = (c) =>
      (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
    const isWordNum = (c) => isWord(c) || (c >= '0' && c <= '9');
    while (i < n) {
      const ch = code[i];
      if (ch === '"') {
        let j = i + 1;
        while (j < n && code[j] !== '"') j++;
        out += '<span class="str">' + escapeHtml(code.slice(i, j + 1)) + '</span>';
        i = j + 1;
      } else if (isWord(ch)) {
        let j = i;
        while (j < n && isWordNum(code[j])) j++;
        const word = code.slice(i, j);
        let k = j;
        while (k < n && code[k] === ' ') k++;
        out += code[k] === '(' ? '<span class="fn">' + word + '</span>' : word;
        i = j;
      } else if (ch >= '0' && ch <= '9') {
        let j = i;
        while (j < n && (code[j] === '.' || (code[j] >= '0' && code[j] <= '9'))) j++;
        out += '<span class="num">' + code.slice(i, j) + '</span>';
        i = j;
      } else {
        out += escapeHtml(ch);
        i++;
      }
    }
    return out;
  }

  // ---- event log ---------------------------------------------------------

  function logEvent(text) {
    const li = document.createElement('li');
    li.textContent = text;
    el.log.prepend(li);
    while (el.log.childElementCount > 40) el.log.lastChild.remove();
  }
  function clearLog() {
    el.log.innerHTML = '';
  }

  // ---- helpers -----------------------------------------------------------

  function setStatus(t) {
    el.status.textContent = t;
  }
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SDJ = window.SDJ || {});
