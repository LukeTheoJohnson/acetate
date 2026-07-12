// app.js — wires the DJ engine, Strudel audio, the crowd panel and the UI.
(function (SDJ) {
  'use strict';

  const TICK_MS = 1000; // evolution cadence
  const CRATE_KEY = 'sdj.crate';
  const CRATE_CAP = 40;

  const engine = new SDJ.DJEngine();
  let started = false; // Strudel initialised
  let running = false; // live set in progress
  let frozen = false;  // evolution held on the current version (still playing)
  let tickTimer = null;
  let lastGoodCode = '';
  let previewing = -1; // crate index auditioning, or -1 (mutually exclusive with a live set)
  let voteActive = false; // an A&R vote session is in progress
  let nowPlaying = { kind: null, name: '' }; // the single audio source: 'live' | 'preview' | 'vote' | null

  // ---- element handles (filled on DOMContentLoaded) ----------------------
  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function boot() {
    [
      'startBtn', 'skipBtn', 'code', 'log',
      'trackName', 'trackMeta', 'stageChips', 'energyBar', 'approvalBar',
      'hitBar', 'hitWrap', 'roll', 'crate', 'status',
      // deck production controls + unified transport
      'freezeBtn', 'saveBtn', 'transport', 'tpKind', 'tpName', 'tpStop',
      // A&R vote spike
      'voteStart', 'voteSave', 'voteTitle', 'voteEmpty', 'voteCard', 'voteArt', 'voteKind',
      'voteDesc', 'voteCode', 'voteControls', 'voteUp', 'voteDown',
      'voteLayers', 'voteHistory', 'voteRoll', 'voteRollWrap',
      // crowd pad + the DJ's-mind panel
      'pad', 'puck', 'energyVal', 'warmthVal',
      'djNow', 'djVerb', 'djMove', 'djConf', 'djConfVal', 'djTemp', 'djModes', 'djFeed',
      // set-log controls
      'logExport', 'logClear', 'logStat',
      // app-shell menu
      'menuLiveState', 'menuCrateCount',
    ].forEach((id) => (el[id] = $(id)));

    // The floor now hosts Strudel's own pianoroll (the crowd viz was retired).
    // We keep a 2d context on SDJ so the appended .pianoroll({ ctx }) can find it.
    SDJ._rollCtx = el.roll ? el.roll.getContext('2d') : null;
    SDJ._voteRollCtx = el.voteRoll ? el.voteRoll.getContext('2d') : null;

    el.startBtn.addEventListener('click', onStartStop);
    el.skipBtn.addEventListener('click', onSkip);
    if (el.freezeBtn) el.freezeBtn.addEventListener('click', toggleFreeze);
    if (el.saveBtn) el.saveBtn.addEventListener('click', onSaveCurrent);
    if (el.tpStop) el.tpStop.addEventListener('click', stopPlayback);
    if (el.voteStart) el.voteStart.addEventListener('click', voteStart);
    if (el.voteSave) el.voteSave.addEventListener('click', onVoteSave);
    if (el.voteUp) el.voteUp.addEventListener('click', () => vote(true));
    if (el.voteDown) el.voteDown.addEventListener('click', () => vote(false));
    if (el.logExport) el.logExport.addEventListener('click', onExportLog);
    if (el.logClear) el.logClear.addEventListener('click', onClearLog);
    window.addEventListener('hashchange', onRoute);
    bindPad();
    placePuck();
    renderMind(null);
    renderCrate();
    syncDeckButtons();
    onRoute(); // show the view named in the URL hash (defaults to the menu)
    window.addEventListener('resize', sizeRolls);
    sizeRolls();
    setStatus('Press “Start the set” to bring the DJ up. Audio needs a click to begin.');
  }

  // ---- transport ---------------------------------------------------------

  function onStartStop() {
    if (!running) startSet();
    else stopSet();
  }

  // One-time Strudel init + sample loading. Both the live set and the crate's
  // preview playback need audio, so it lives here and either entry point awaits
  // it — that's what lets the crate work as a standalone player. Returns false
  // if Strudel isn't available (nothing to play).
  async function ensureAudio() {
    if (started) return true;
    if (typeof window.initStrudel !== 'function') {
      setStatus('⚠ Strudel failed to load (are you online?). Try a hard refresh.');
      return false;
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
        // drum layers (bd sd hh oh cp) actually sound.
        await window.samples('https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/strudel.json');
      } catch (e) {
        console.error('sample load failed:', e);
      }
      // Best-effort: classic drum machines (808/909/707/Linn) so the DJ can
      // swap the whole kit's character via .bank(). If this fails the default
      // dirt kit above still plays — tracks are never left silent.
      try {
        await window.samples('https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json');
        engine.banksLoaded = true;
      } catch (e) {
        console.warn('drum-machine banks unavailable — using the default kit:', e);
      }
    }
    started = true;
    return true;
  }

  async function startSet() {
    if (!(await ensureAudio())) return;
    if (voteActive) stopVote();                              // live replaces an A&R session
    if (previewing >= 0) { previewing = -1; renderCrate(); } // live replaces any preview
    running = true;
    setFrozen(false);
    sizeRoll(); // make sure the pianoroll canvas is sized before the first draw
    el.startBtn.textContent = '⏸ Stop the set';
    syncDeckButtons();
    engine.newSong();
    resetMind();
    loggedVerdictSeq = 0;
    if (SDJ.SetLog) {
      SDJ.SetLog.mark('set', {
        name: engine.song.name, key: engine.song.key,
        scale: engine.song.scaleType, bpm: engine.song.bpm,
        banks: !!engine.banksLoaded,
      });
    }
    evaluateCurrent(true);
    updateUI();
    clearLog();
    updateLogStat();
    logEvent('🎧 ' + engine.song.name + ' — building from the kick up…');
    tickTimer = setInterval(loop, TICK_MS);
    setStatus('Live. Drag the pad — up for energy, sideways for warmth.');
  }

  function stopSet() {
    running = false;
    setFrozen(false);
    el.startBtn.textContent = '▶ Start the set';
    syncDeckButtons();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    stopAll(); // hush + clear the transport
    clearRoll(); // wipe the roll so a later preview/session doesn't scroll stale notes
    if (SDJ.SetLog) SDJ.SetLog.mark('stop');
    setStatus('Stopped. Press start to bring the DJ back up.');
  }

  function onSkip() {
    if (!running) return;
    setFrozen(false);
    logEvent('⏭ crowd wanted something new — fresh track');
    engine.newSong();
    resetMind();
    loggedVerdictSeq = 0;
    if (SDJ.SetLog) SDJ.SetLog.mark('song', { reason: 'skip', name: engine.song.name });
    evaluateCurrent(true);
    updateUI();
    logEvent('🎧 ' + engine.song.name);
  }

  // ---- the evolution loop ------------------------------------------------

  function loop() {
    if (!running || frozen) return;
    const res = engine.tick(getEnergy(), TICK_MS / 1000, getWarmth());
    for (const e of res.events) logEvent(e);
    if (res.changed) evaluateCurrent(false);
    updateUI();
    recordTick(res);

    if (res.hit) {
      if (SDJ.SetLog) SDJ.SetLog.mark('song', { reason: 'banger', name: engine.song.name, approval: Math.round(engine.song.approval) });
      pushFeed('★', 'banked a banger — moving on', 'reset', 'up');
      saveBanger();
      engine.newSong();
      resetMind();
      loggedVerdictSeq = 0;
      if (SDJ.SetLog) SDJ.SetLog.mark('song', { reason: 'next', name: engine.song.name });
      evaluateCurrent(true);
      logEvent('🎧 next up: ' + engine.song.name);
    }
  }

  function evaluateCurrent(isNew) {
    const code = engine.render();
    showCode(code, !isNew);          // the panel shows the clean pattern…
    play(withRoll(code), 'live', engine.song ? engine.song.name : ''); // …the speakers get the roll
  }

  // ---- the pianoroll: Strudel's own guitar-hero scroller -----------------
  // .pianoroll() is a Pattern method in the @strudel/web bundle; it draws into
  // the ctx we hand it. We append it ONLY to the audio string (the live deck AND
  // the A&R audition), never to render(), so the code panel, crate saves and the
  // A&R code map stay clean (and never spawn Strudel's full-screen fallback
  // canvas). Per-layer .color() (added in render) gives each sound its own lane.
  function rollTail(ctxRef) {
    return '.pianoroll({ ctx: ' + ctxRef + ', cycles: 4, playhead: 0.5, labels: 0 })';
  }
  function withRoll(code) {       // the live deck's floor
    return SDJ._rollCtx ? code + rollTail('window.SDJ._rollCtx') : code;
  }
  function withVoteRoll(code) {   // the A&R pitch audition
    return SDJ._voteRollCtx ? code + rollTail('window.SDJ._voteRollCtx') : code;
  }

  // Keep a canvas' backing store matched to its box (× dpr) so the roll is crisp.
  // A canvas is display:none — thus zero-sized — while its view/card is hidden,
  // so these run on boot, on resize, and whenever the owner becomes visible.
  function sizeCanvas(c) {
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return; // not visible yet — size it when it becomes visible
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  function sizeRoll() { sizeCanvas(el.roll); }
  function sizeVoteRoll() { sizeCanvas(el.voteRoll); }
  function sizeRolls() { sizeRoll(); sizeVoteRoll(); }

  function clearRoll() {
    if (SDJ._rollCtx && el.roll) SDJ._rollCtx.clearRect(0, 0, el.roll.width, el.roll.height);
  }
  function clearVoteRoll() {
    if (SDJ._voteRollCtx && el.voteRoll) SDJ._voteRollCtx.clearRect(0, 0, el.voteRoll.width, el.voteRoll.height);
  }

  // ---- playback transport: exactly one source at a time ------------------
  // Every note that reaches the speakers goes through play(). Switching between
  // the live set and a crate preview hard-stops the previous source first, so
  // the two can never stack; a same-source update just hot-swaps the pattern.
  // nowPlaying is the single source of truth the header transport renders.

  function play(code, kind, name) {
    if (typeof window.evaluate === 'function') {
      cancelSilence(); // a new source releases any stop-enforcement window
      if (nowPlaying.kind && nowPlaying.kind !== kind && typeof window.hush === 'function') {
        try { window.hush(); } catch (e) { /* ignore */ }
      }
      try {
        // evaluate() is async and restarts the scheduler when it settles — a stop
        // that lands mid-evaluate is exactly what enforceSilence() guards against.
        Promise.resolve(window.evaluate(code)).catch(() => {});
        lastGoodCode = code;
      } catch (err) {
        console.error('Strudel eval error:', err, '\n', code);
        if (lastGoodCode) {
          try { window.evaluate(lastGoodCode); } catch (e) { /* ignore */ }
        }
      }
    }
    setNowPlaying(kind, name);
  }

  function stopAll() {
    enforceSilence(); // hush now and keep hushing through any in-flight evaluate
    setNowPlaying(null, '');
  }

  // Why one hush() isn't enough: hush() stops Strudel's scheduler, but evaluate()
  // is async and restarts the scheduler the moment it resolves via setPattern(…,
  // autostart). An evaluate still in flight when you stop therefore brings the
  // audio straight back — that's the "stop didn't stop" bug. So we don't hush
  // once: we hush now and keep re-hushing across a window that outlasts any
  // pending evaluate. A new play() calls cancelSilence() to release the window at
  // once, so we never fight audio we actually want.
  let silenceUntil = 0;
  let silenceTimer = null;
  function enforceSilence() {
    silenceUntil = Date.now() + 700;
    const beat = () => {
      silenceTimer = null;
      if (Date.now() >= silenceUntil) return; // released by a new play()
      if (typeof window.hush === 'function') { try { window.hush(); } catch (e) { /* ignore */ } }
      silenceTimer = setTimeout(beat, 60);
    };
    beat();
  }
  function cancelSilence() {
    silenceUntil = 0;
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  // Global stop — from the header transport. Stops whatever is playing.
  function stopPlayback() {
    if (voteActive) stopVote();
    else if (previewing >= 0) stopPreview();
    else if (running) stopSet();
    else stopAll();
  }

  function setNowPlaying(kind, name) {
    nowPlaying = { kind: kind || null, name: name || '' };
    refreshTransport();
  }

  function refreshTransport() {
    if (!el.transport) return;
    if (!nowPlaying.kind) { el.transport.hidden = true; return; }
    el.transport.hidden = false;
    // 'frozen' is a display state of the live source, not a separate source
    const token = nowPlaying.kind === 'preview' ? 'preview'
      : nowPlaying.kind === 'vote' ? 'vote'
      : frozen ? 'frozen' : 'live';
    if (el.tpKind) { el.tpKind.textContent = token === 'vote' ? 'a&r' : token; el.tpKind.className = 'tp-kind ' + token; }
    if (el.tpName) el.tpName.textContent = nowPlaying.name || '—';
    el.transport.classList.toggle('frozen', token === 'frozen');
  }

  // ---- production controls: freeze evolution, save the current version ----

  function setFrozen(v) {
    frozen = !!v;
    if (el.freezeBtn) {
      el.freezeBtn.textContent = frozen ? '▶ Resume' : '⏸ Freeze';
      el.freezeBtn.classList.toggle('active', frozen);
    }
    refreshTransport();
  }

  function toggleFreeze() {
    if (!running) return;
    setFrozen(!frozen);
    if (SDJ.SetLog) SDJ.SetLog.mark(frozen ? 'freeze' : 'resume');
    setStatus(frozen
      ? 'Frozen — evolution held, this version keeps looping. Save it or resume.'
      : 'Live again — the DJ is evolving.');
  }

  function onSaveCurrent() {
    if (!running || !engine.song) {
      setStatus('Start a set first, then save a version you like.');
      return;
    }
    saveToCrate('💾 saved “' + engine.song.name + '” to the crate');
    setStatus('Saved “' + engine.song.name + '” to the crate.');
  }

  function syncDeckButtons() {
    if (el.freezeBtn) el.freezeBtn.disabled = !running;
    if (el.saveBtn) el.saveBtn.disabled = !running;
  }

  // ---- A&R vote spike: the DJ pitches one change, you keep or kill it -----
  // A different interaction entirely — no mood fader. The engine proposes one
  // change (an add or a rework), applies it so you hear it, and shows a card:
  // a generative cover, a plain-English line, and the exact code lines it
  // touched. Keep commits it; kill reverts it and bans the idea for the rest
  // of the song. Runs through the same single-source transport (kind 'vote').

  async function voteStart() {
    if (!(await ensureAudio())) return;
    if (running) stopSet();
    if (previewing >= 0) stopPreview();
    voteActive = true;
    engine.newSong();
    engine.voteReset();
    if (el.voteSave) el.voteSave.disabled = false;
    if (el.voteHistory) el.voteHistory.innerHTML = '';
    if (el.voteTitle) el.voteTitle.textContent = engine.song.name;
    renderVote(); // play the bare track (just the kick) to open the session
    updateVoteLayers();
    if (SDJ.SetLog) SDJ.SetLog.mark('vote-start', { name: engine.song.name });
    nextPitch(); // propose + present the first change
    setStatus('A&R session — keep or kill each change the DJ pitches.');
  }

  function stopVote() {
    voteActive = false;
    if (engine.song) engine.song.pending = null;
    if (el.voteSave) el.voteSave.disabled = true;
    if (el.voteCard) el.voteCard.hidden = true;
    if (el.voteControls) el.voteControls.hidden = true;
    if (el.voteEmpty) el.voteEmpty.hidden = false;
    if (el.voteRollWrap) el.voteRollWrap.hidden = true;
    clearVoteRoll();
    stopAll();
  }

  function renderVote() {
    play(withVoteRoll(engine.render()), 'vote', engine.song ? engine.song.name : '');
  }

  function nextPitch() {
    if (!voteActive) return;
    const p = engine.proposeChange();
    if (!p) { presentSettled(); return; }
    renderVote(); // audition the applied change
    presentCard(p);
  }

  function vote(keep) {
    if (!voteActive || !engine.song || !engine.song.pending) return;
    const p = keep ? engine.acceptChange() : engine.rejectChange();
    addVoteHistory(keep, p.desc);
    if (SDJ.SetLog) SDJ.SetLog.mark('vote', { v: keep ? 'up' : 'down', desc: p.desc });
    if (!keep) renderVote(); // reverted — reflect it before the next pitch
    updateVoteLayers();
    nextPitch();
  }

  function presentCard(p) {
    if (el.voteEmpty) el.voteEmpty.hidden = true;
    if (el.voteCard) el.voteCard.hidden = false;
    if (el.voteControls) el.voteControls.hidden = false;
    if (el.voteRollWrap) el.voteRollWrap.hidden = false;
    sizeVoteRoll(); // the canvas was zero-sized while the wrap was hidden
    const add = p.kind === 'add';
    if (el.voteKind) {
      el.voteKind.textContent = add ? 'new addition' : 'rework';
      el.voteKind.className = 'vc-kind ' + (add ? 'add' : 'reshape');
    }
    if (el.voteDesc) el.voteDesc.textContent = (add ? 'Bring in ' : 'Rework ') + stageLabel(p.layer);
    if (el.voteArt && SDJ.Art) {
      el.voteArt.innerHTML = SDJ.Art.cover(p.layer, engine.song.genome.variant[p.layer], engine.song.seed);
    }
    if (el.voteCode) el.voteCode.innerHTML = voteCodeHtml(engine.render(), p.layer);
  }

  function presentSettled() {
    renderVote();
    if (el.voteCard) el.voteCard.hidden = true;
    if (el.voteControls) el.voteControls.hidden = true;
    if (el.voteRollWrap) el.voteRollWrap.hidden = true;
    clearVoteRoll();
    if (el.voteEmpty) {
      el.voteEmpty.hidden = false;
      el.voteEmpty.innerHTML =
        'That’s the track — nothing left to pitch. <b>Keep version</b> to save it, or start a fresh session.';
    }
    setStatus('The track’s settled — keep it or start again.');
  }

  function onVoteSave() {
    if (!voteActive || !engine.song) return;
    saveToCrate('💾 kept “' + engine.song.name + '” from the A&R session');
    setStatus('Saved “' + engine.song.name + '” to the crate.');
  }

  function stageLabel(i) {
    return SDJ.STAGES && SDJ.STAGES[i] ? SDJ.STAGES[i].label : 'a layer';
  }

  // Current code with the proposed layer's line(s) highlighted. engine._lastLayers
  // maps each stack body line back to its stage index (set by render()).
  function voteCodeHtml(code, layer) {
    const lines = code.split('\n');
    const map = engine._lastLayers || [];
    const bodyStart = 2; // line 0 = setcps(...), line 1 = stack(
    let out = '';
    for (let idx = 0; idx < lines.length; idx++) {
      const k = idx - bodyStart;
      const isLayer = k >= 0 && k < map.length && map[k] === layer;
      const inner = highlight(lines[idx]) || ' ';
      out += '<span class="vc-line' + (isLayer ? ' vc-hl' : '') + '">' + inner + '</span>';
    }
    return out;
  }

  function updateVoteLayers() {
    if (!el.voteLayers || !engine.song) return;
    const st = engine.state();
    el.voteLayers.innerHTML = '';
    st.stageKeys.forEach((keyName, i) => {
      const c = document.createElement('span');
      c.className = 'chip' + (st.activeLayers[i] ? ' on' : '');
      c.textContent = keyName;
      el.voteLayers.appendChild(c);
    });
  }

  function addVoteHistory(keep, desc) {
    if (!el.voteHistory) return;
    const li = document.createElement('li');
    li.className = 'vh-row ' + (keep ? 'up' : 'down');
    li.innerHTML =
      '<span class="vh-glyph">' + (keep ? '👍' : '👎') + '</span>' +
      '<span class="vh-desc">' + escapeHtml(desc) + '</span>';
    el.voteHistory.prepend(li);
    while (el.voteHistory.childElementCount > 40) el.voteHistory.lastChild.remove();
  }

  // ---- saving bangers ----------------------------------------------------

  function saveToCrate(logMsg) {
    const s = engine.song;
    if (!s) return;
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
    if (logMsg) logEvent(logMsg);
    renderCrate();
  }

  // crowd-approved banger — auto-saved from the loop
  function saveBanger() {
    saveToCrate('💾 the crowd went off — saved “' + engine.song.name + '” to the crate');
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
      const playing = i === previewing;
      const li = document.createElement('li');
      li.className = 'crate-item' + (playing ? ' playing' : '');
      li.innerHTML =
        '<div class="crate-meta"><strong>' +
        escapeHtml(entry.name) +
        '</strong><span>' +
        entry.key + ' ' + entry.scaleType + ' · ' + entry.bpm + ' BPM' +
        (entry.approval != null ? ' · ' + entry.approval + '% hype' : '') + '</span></div>' +
        '<div class="crate-actions">' +
        '<button data-act="' + (playing ? 'stop' : 'play') + '" data-i="' + i + '" title="' +
        (playing ? 'Stop' : 'Preview') + '">' + (playing ? '⏹' : '▶') + '</button>' +
        '<button data-act="del" data-i="' + i + '" title="Delete">✕</button>' +
        '</div>';
      el.crate.appendChild(li);
    });
    el.crate.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        const act = b.dataset.act;
        if (act === 'play') previewTrack(i);
        else if (act === 'stop') stopPreview();
        else deleteTrack(i);
      });
    });
  }

  function deleteTrack(i) {
    if (previewing >= 0) stopPreview(); // indices shift; drop any preview first
    const crate = loadCrate();
    crate.splice(i, 1);
    localStorage.setItem(CRATE_KEY, JSON.stringify(crate));
    renderCrate();
  }

  // The crate is a standalone player: previewing initialises audio on demand
  // and doesn't need a live set. Live and preview are mutually exclusive —
  // starting a preview stops any running set so nothing plays over the top.
  async function previewTrack(i) {
    const entry = loadCrate()[i];
    if (!entry) return;
    setStatus('Loading sounds…');
    if (!(await ensureAudio())) return;
    if (voteActive) stopVote(); // one source at a time
    if (running) stopSet();
    previewing = i;
    play(entry.code, 'preview', entry.name);
    renderCrate();
    setStatus('Previewing “' + entry.name + '”.');
  }

  // Stop the crate preview and go silent (the transport/global stop routes here).
  function stopPreview() {
    if (previewing < 0) return;
    previewing = -1;
    stopAll();
    renderCrate();
    setStatus('Stopped.');
  }

  // ---- crowd pad: two emotional axes, never a musical parameter ----------
  // Y = energy (flat..going off) is the reward the DJ climbs; X = warmth
  // (cold..warm) only biases HOW it searches. This is the whole control
  // surface — the DJ still authors every note.

  let energyIn = 0.1; // -1..1, the fitness signal (this is today's "mood")
  let warmthIn = 0;   // -1..1, colours the search

  function getEnergy() { return energyIn; }
  function getWarmth() { return warmthIn; }

  // Set the crowd programmatically. The pad drag calls this too, and it's
  // exposed on SDJ so any action the pad can take is available without the UI.
  function setCrowd(energy, warmth) {
    energyIn = clamp(energy, -1, 1);
    warmthIn = clamp(warmth, -1, 1);
    placePuck();
  }

  function placePuck() {
    if (!el.puck) return;
    el.puck.style.left = ((warmthIn + 1) / 2) * 100 + '%';
    el.puck.style.top = (1 - (energyIn + 1) / 2) * 100 + '%';
    el.energyVal.textContent = (energyIn >= 0 ? '+' : '') + Math.round(energyIn * 100);
    el.warmthVal.textContent = (warmthIn >= 0 ? '+' : '') + Math.round(warmthIn * 100);
    const glow = 0.3 + ((energyIn + 1) / 2) * 0.5;
    el.puck.style.boxShadow =
      '0 0 0 2px rgba(255,255,255,0.25), 0 0 22px 6px rgba(255,77,141,' + glow.toFixed(2) + ')';
  }

  function bindPad() {
    if (!el.pad) return;
    let dragging = false;
    const fromEvent = (ev) => {
      const r = el.pad.getBoundingClientRect();
      const p = ev.touches ? ev.touches[0] : ev;
      const x = clamp((p.clientX - r.left) / r.width, 0, 1);
      const y = clamp((p.clientY - r.top) / r.height, 0, 1);
      setCrowd(1 - y * 2, x * 2 - 1); // up = energy, right = warmth
    };
    el.pad.addEventListener('mousedown', (e) => { dragging = true; fromEvent(e); });
    window.addEventListener('mousemove', (e) => { if (dragging) fromEvent(e); });
    window.addEventListener('mouseup', () => { dragging = false; });
    el.pad.addEventListener('touchstart', (e) => { dragging = true; fromEvent(e); e.preventDefault(); }, { passive: false });
    el.pad.addEventListener('touchmove', (e) => { if (dragging) { fromEvent(e); e.preventDefault(); } }, { passive: false });
    window.addEventListener('touchend', () => { dragging = false; });
    // keyboard nudges for accessibility (the pad is focusable)
    el.pad.addEventListener('keydown', (e) => {
      const step = 0.1;
      if (e.key === 'ArrowUp') setCrowd(energyIn + step, warmthIn);
      else if (e.key === 'ArrowDown') setCrowd(energyIn - step, warmthIn);
      else if (e.key === 'ArrowRight') setCrowd(energyIn, warmthIn + step);
      else if (e.key === 'ArrowLeft') setCrowd(energyIn, warmthIn - step);
      else return;
      e.preventDefault();
    });
  }

  // ---- UI updates --------------------------------------------------------

  function updateUI() {
    if (!engine.song) return;
    const st = engine.state();
    el.trackName.textContent = st.name;
    el.trackMeta.textContent =
      st.key + ' ' + st.scaleType + ' · ' + st.bpm + ' BPM · ' +
      st.activeCount + '/7 · ' + st.mode;
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
      c.classList.toggle('on', !!(st.activeLayers && st.activeLayers[i]));
    });
    el.energyBar.style.width = Math.round(st.energy * 100) + '%';
    el.approvalBar.style.width = Math.round(st.approval) + '%';
    el.hitBar.style.width = Math.round(st.hitProgress * 100) + '%';
    el.hitWrap.classList.toggle('armed', st.hitProgress > 0.05);
    renderMind(st);
  }

  // ---- the DJ's mind: surface the reasoning the engine already produces ---
  // The wow isn't more knobs — it's watching the machine want something and
  // work for it. All of this data already flows out of tick()/state().

  let lastVerdictSeq = 0;

  function resetMind() {
    lastVerdictSeq = 0;
    if (el.djFeed) el.djFeed.innerHTML = '';
    renderMind(null);
  }

  function renderMind(st) {
    if (!el.djNow) return;
    if (!st) {
      el.djVerb.textContent = 'warming up';
      el.djMove.textContent = 'reading the room…';
      el.djNow.classList.remove('settled');
      el.djConf.style.width = '0%';
      el.djConfVal.textContent = '—';
      el.djTemp.textContent = 'temp 0.40';
      el.djModes.querySelectorAll('.mchip').forEach((c) => c.classList.remove('on'));
      return;
    }
    // current move — auditioning vs holding
    const move = st.move;
    const settled = st.mode === 'locked in' || !move || /locked in|teasing|held/.test(move);
    el.djNow.classList.toggle('settled', settled);
    el.djVerb.textContent = settled ? 'holding' : 'auditioning';
    el.djMove.textContent = move || 'holding the groove';

    // confidence = inverse of exploration temperature
    const conf = Math.round((1 - st.temp) * 100);
    el.djConf.style.width = conf + '%';
    el.djConfVal.textContent = conf + '%';
    el.djTemp.textContent = 'temp ' + st.temp.toFixed(2);

    // read of the room
    el.djModes.querySelectorAll('.mchip').forEach((c) =>
      c.classList.toggle('on', c.dataset.m === st.mode)
    );

    // reasoning feed — one row per newly-judged mutation, with the delta
    if (st.verdictSeq > lastVerdictSeq && st.lastVerdict) {
      lastVerdictSeq = st.verdictSeq;
      const v = st.lastVerdict;
      const d = Math.round(v.delta);
      const glyph = v.kind === 'kept' ? '✓' : v.kind === 'reverted' ? '↩' : '~';
      const tone = v.kind === 'kept' ? 'up' : v.kind === 'reverted' ? 'down' : 'flat';
      pushFeed(glyph, v.desc, (d >= 0 ? '+' : '') + d + ' approval', tone);
    }
  }

  function pushFeed(glyph, msg, why, tone) {
    if (!el.djFeed) return;
    const li = document.createElement('li');
    li.className = 'feed-row fresh ' + (tone || '');
    li.innerHTML =
      '<span class="fglyph">' + glyph + '</span>' +
      '<span class="fmsg">' + escapeHtml(msg) + '</span>' +
      '<span class="fwhy">' + escapeHtml(why || '') + '</span>';
    el.djFeed.prepend(li);
    while (el.djFeed.childElementCount > 40) el.djFeed.lastChild.remove();
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

  // ---- set log: structured, exportable trace for diagnosis ---------------
  // One compact row per evolution tick. The verdict (kept/reverted/gambled) is
  // attached only to the tick it was actually judged on, so revert-rate and
  // move-repetition read cleanly. Everything is guarded so a missing log.js
  // never breaks the app.

  let loggedVerdictSeq = 0;

  function recordTick(res) {
    if (!SDJ.SetLog || !engine.song) return;
    const st = engine.state();
    const g = engine.song.genome;
    const newV = st.verdictSeq > loggedVerdictSeq && !!st.lastVerdict;
    if (newV) loggedVerdictSeq = st.verdictSeq;
    SDJ.SetLog.record({
      song: st.name,
      e: Math.round(getEnergy() * 100) / 100,
      w: Math.round(getWarmth() * 100) / 100,
      ap: Math.round(st.approval),
      tmp: Math.round(st.temp * 100) / 100,
      md: st.mode,
      fs: st.flatStreak,
      av: st.aversion,
      act: g.active.map((a) => (a ? 1 : 0)).join(''),
      vr: g.variant.slice(),
      en: g.energyIdx,
      bk: g.bank,
      pr: engine.song.prog.join(' '),
      sc: st.scaleType,
      mv: st.move || null,
      vk: newV ? st.lastVerdict.kind : null,
      vd: newV ? Math.round(st.lastVerdict.delta * 10) / 10 : null,
      ch: !!res.changed,
    });
    updateLogStat();
  }

  function updateLogStat() {
    if (!el.logStat || !SDJ.SetLog) return;
    const s = SDJ.SetLog.stats();
    el.logStat.textContent = s.ticks
      ? s.ticks + 't · ' + s.modePct.searching + '% search · ' + s.revertRate + '% revert · ' + s.uniqueStates + ' states'
      : '—';
  }

  function onExportLog() {
    if (!SDJ.SetLog || !SDJ.SetLog.count()) {
      setStatus('Nothing logged yet — start a set and let it run first.');
      return;
    }
    const name = 'sdj-setlog-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    SDJ.SetLog.download(name);
    const s = SDJ.SetLog.stats();
    logEvent('⬇ exported set log — ' + s.ticks + ' ticks, ' + s.songs + ' songs → ' + name);
    console.log('[set log summary]', s);
  }

  function onClearLog() {
    if (SDJ.SetLog) SDJ.SetLog.clear();
    loggedVerdictSeq = 0;
    updateLogStat();
    logEvent('🧹 cleared the set log');
  }

  // ---- app shell: hash-routed views (menu / live / crate) ----------------
  // One index.html, three views. The engine, audio and crate all live in this
  // module, so state persists as you move between the menu, the live deck and
  // the crate — navigating is just showing a different section.

  const VIEWS = ['menu', 'live', 'vote', 'crate'];

  function currentRoute() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    return VIEWS.indexOf(h) >= 0 ? h : 'menu';
  }

  function showView(name) {
    document.querySelectorAll('[data-view]').forEach((v) => {
      v.hidden = v.getAttribute('data-view') !== name;
    });
    document.querySelectorAll('.topnav [data-nav]').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-nav') === name);
    });
    // navigation never stops audio — the header transport is the single stop.
    if (name === 'live') sizeRoll(); // the canvas was zero-sized while hidden
    if (name === 'vote') sizeVoteRoll();
    if (name === 'crate') renderCrate();
    if (name === 'menu') updateMenu();
  }

  function onRoute() {
    showView(currentRoute());
  }

  function updateMenu() {
    if (el.menuCrateCount) {
      const n = loadCrate().length;
      el.menuCrateCount.textContent = n ? n + ' saved' : 'empty';
    }
    if (el.menuLiveState) el.menuLiveState.textContent = running ? 'live now' : 'idle';
  }

  // ---- helpers -----------------------------------------------------------

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }
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

  // expose the crowd control so the pad's action is available programmatically
  // (agent-native parity, and the headless test drives the set through it)
  SDJ.setCrowd = setCrowd;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SDJ = window.SDJ || {});
