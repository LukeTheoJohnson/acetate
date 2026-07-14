// app.js — wires the DJ engine, Strudel audio, the crowd panel and the UI.
(function (SDJ) {
  'use strict';

  const TICK_MS = 1000; // evolution cadence
  const CRATE_KEY = 'sdj.crate';
  const CRATE_CAP = 64;

  const engine = new SDJ.DJEngine();
  let started = false; // Strudel initialised
  let running = false; // live set in progress
  let frozen = false;  // evolution held on the current version (still playing)
  let tickTimer = null;
  let lastGoodCode = '';
  let previewing = -1; // crate index auditioning, or -1 (mutually exclusive with a live set)
  let voteActive = false; // an A&R session is in progress
  let voteBeforeCode = '';      // A/B compare: code before the proposed change
  let voteAfterCode = '';       // A/B compare: code with the proposed change applied
  let voteAfterLayerMap = [];   // _lastLayers for the after (proposed) render
  let voteBeforeLayerMap = [];  // _lastLayers for the before (original) render
  let voteShowingProposed = true; // true = B (proposed), false = A (original)
  let nowPlaying = { kind: null, name: '' }; // the single audio source: 'live' | 'preview' | 'vote' | 'remix' | null

  let crateSort = 'new'; // crate page ordering: 'new' | 'hype' | 'name'

  // ---- remix deck state (a saved record looped as a bed + vocal/overlays) --
  let remixRecord = null;   // the crate entry currently loaded on the remix deck
  let remixPlaying = false; // the remix bed is playing
  let vocalsLoaded = false; // the dirt-samples vocal banks loaded with the kit at boot
  const remixFx = { chops: false, topline: false, sweep: false, stutter: false, riser: false };
  let remixWord = 0;        // rotating index into the vocal word bank for variety
  const activeStabs = [];   // vocal one-shots sounding right now (momentary voice pads)
  let remixTransition = 1;  // 0..1 bed transition filter (1 = fully open — no filtering)
  let transitionTimer = 0;  // throttle so dragging the fader doesn't thrash evaluate

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
      // A&R vote spike (turn-based individual review)
      'voteStart', 'voteSave', 'voteTitle', 'voteEmpty', 'voteCard', 'voteArt', 'voteKind',
      'voteDesc', 'voteCode', 'voteControls', 'voteUp', 'voteDown',
      'voteLayers', 'voteHistory', 'voteRoll', 'voteRollWrap',
      'voteDeck', 'ttLabel', 'ttBadge', 'ttHint', 'voteAB',
      // crowd pad + per-part opinion faders + density dial + the DJ's-mind panel
      'pad', 'puck', 'energyVal', 'warmthVal', 'liveOpinion', 'liveDensity', 'liveGenre',
      'djNow', 'djVerb', 'djMove', 'djConf', 'djConfVal', 'djTemp', 'djModes', 'djFeed',
      // set-log controls
      'logExport', 'logClear', 'logStat',
      // app-shell menu
      'menuLiveState', 'menuCrateCount',
      // crate library tools
      'crateSort', 'crateExport', 'crateImport',
      // remix console (2 decks: a vox sampler + the base-track record)
      'remixShelf', 'remixStart', 'remixSave', 'remixEmpty', 'remixStage', 'remixArt',
      'remixPlatter', 'remixName', 'remixMeta', 'remixRack', 'remixVox', 'remixTransition',
      'remixVocalState', 'remixRoll',
    ].forEach((id) => (el[id] = $(id)));

    // The floor now hosts Strudel's own pianoroll (the crowd viz was retired).
    // We keep a 2d context on SDJ so the appended .pianoroll({ ctx }) can find it.
    SDJ._rollCtx = el.roll ? el.roll.getContext('2d') : null;
    SDJ._voteRollCtx = el.voteRoll ? el.voteRoll.getContext('2d') : null;
    SDJ._remixRollCtx = el.remixRoll ? el.remixRoll.getContext('2d') : null;

    el.startBtn.addEventListener('click', onStartStop);
    el.skipBtn.addEventListener('click', onSkip);
    if (el.freezeBtn) el.freezeBtn.addEventListener('click', toggleFreeze);
    if (el.saveBtn) el.saveBtn.addEventListener('click', onSaveCurrent);
    if (el.tpStop) el.tpStop.addEventListener('click', stopPlayback);
    if (el.voteStart) el.voteStart.addEventListener('click', voteStart);
    if (el.voteSave) el.voteSave.addEventListener('click', onVoteSave);
    if (el.voteUp) el.voteUp.addEventListener('click', () => vote(true));
    if (el.voteDown) el.voteDown.addEventListener('click', () => vote(false));
    if (el.voteAB) el.voteAB.addEventListener('click', onVoteAB);
    if (el.logExport) el.logExport.addEventListener('click', onExportLog);
    if (el.logClear) el.logClear.addEventListener('click', onClearLog);
    // crate library tools
    if (el.crateSort) el.crateSort.addEventListener('change', () => { crateSort = el.crateSort.value; renderCrate(); });
    if (el.crateExport) el.crateExport.addEventListener('click', exportCrate);
    if (el.crateImport) el.crateImport.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importCrate(f); e.target.value = ''; });
    // remix console
    if (el.remixStart) el.remixStart.addEventListener('click', onRemixStart);
    if (el.remixSave) el.remixSave.addEventListener('click', onRemixSave);
    if (el.remixTransition) el.remixTransition.addEventListener('input', onTransition);
    window.addEventListener('hashchange', onRoute);
    bindPad();
    buildControls();
    buildRemixRack();
    buildVoiceDeck();
    placePuck();
    renderMind(null);
    renderCrate();
    renderRemixShelf();
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
        vocalsLoaded = true; // vocal banks (yeah/ho/numbers/speech/mouth …) ride in with the kit
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
    if (remixPlaying) stopRemix();                           // live replaces a remix
    if (voteActive) stopVote();                              // live replaces an A&R session
    if (previewing >= 0) { previewing = -1; renderCrate(); } // live replaces any preview
    running = true;
    setFrozen(false);
    sizeRoll(); // make sure the pianoroll canvas is sized before the first draw
    el.startBtn.textContent = '⏸ Stop the set';
    syncDeckButtons();
    engine.newSong();
    resetControls(); // fresh set opens with a neutral opinion on every part
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
    if (engine.song) engine.song.laneMood = laneMoodIn.slice();
    const res = engine.tick(getEnergy(), TICK_MS / 1000, getWarmth(), getIntent());
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
  function sizeRemixRoll() { sizeCanvas(el.remixRoll); }
  function sizeRolls() { sizeRoll(); sizeVoteRoll(); sizeRemixRoll(); }

  function clearRoll() {
    if (SDJ._rollCtx && el.roll) SDJ._rollCtx.clearRect(0, 0, el.roll.width, el.roll.height);
  }
  function clearVoteRoll() {
    if (SDJ._voteRollCtx && el.voteRoll) SDJ._voteRollCtx.clearRect(0, 0, el.voteRoll.width, el.voteRoll.height);
  }
  function clearRemixRoll() {
    if (SDJ._remixRollCtx && el.remixRoll) SDJ._remixRollCtx.clearRect(0, 0, el.remixRoll.width, el.remixRoll.height);
  }
  function withRemixRoll(code) {
    return SDJ._remixRollCtx ? code + rollTail('window.SDJ._remixRollCtx') : code;
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
        // A parse/eval failure REJECTS this promise (the sync try/catch never sees
        // it), so handle both arms: only bank lastGoodCode on success, and surface
        // a failure instead of letting it vanish into a swallowed .catch().
        Promise.resolve(window.evaluate(code)).then(
          () => { lastGoodCode = code; },
          (err) => onEvalError(err, code, kind)
        );
      } catch (err) {
        onEvalError(err, code, kind);
      }
    }
    setNowPlaying(kind, name);
  }

  // A render that fails to evaluate must never fail silently — that's exactly how
  // a malformed layer (e.g. an unbracketed chord) can hide for weeks. Flash the
  // relevant code panel, say so in the status line, and fall back to the last
  // good pattern so the floor keeps playing instead of stalling.
  function onEvalError(err, code, kind) {
    console.error('Strudel eval error:', err, '\n', code);
    flashEvalError(kind);
    if (lastGoodCode && lastGoodCode !== code) {
      try { Promise.resolve(window.evaluate(lastGoodCode)).catch(() => {}); } catch (e) { /* ignore */ }
    }
  }

  function flashEvalError(kind) {
    const panel = kind === 'vote' ? el.voteCode : el.code;
    if (panel) {
      panel.classList.remove('eval-error');
      void panel.offsetWidth; // reflow so the animation restarts on repeat failures
      panel.classList.add('eval-error');
    }
    setStatus('⚠ That render didn’t evaluate — kept the last good pattern.');
  }

  function stopAll() {
    enforceSilence(); // hush now and keep hushing through any in-flight evaluate
    setNowPlaying(null, '');
  }

  // Why hush() alone isn't enough: hush() stops Strudel's scheduler, but
  // evaluate() is async and restarts the scheduler when it resolves. An evaluate
  // in-flight when you stop brings the audio straight back, and hush() can't
  // reach an already-queued async resolution. So we also call evaluate('silence')
  // — the same authoritative code path that starts audio — to replace the active
  // pattern. Both are called every 60ms until a new play() calls cancelSilence().
  let silenceUntil = 0;
  let silenceTimer = null;
  function enforceSilence() {
    silenceUntil = Infinity; // run until cancelSilence(), not a fixed window
    const beat = () => {
      silenceTimer = null;
      if (Date.now() >= silenceUntil) return; // released by cancelSilence()
      if (typeof window.hush === 'function') { try { window.hush(); } catch (e) { /* ignore */ } }
      if (typeof window.evaluate === 'function') {
        try { Promise.resolve(window.evaluate('silence')).catch(() => {}); } catch (e) { /* ignore */ }
      }
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
    if (remixPlaying) stopRemix();
    else if (voteActive) stopVote();
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
      : nowPlaying.kind === 'remix' ? 'remix'
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
    saveToCrate('💾 saved “' + engine.song.name + '” to the crate', 'saved');
    setStatus('Saved “' + engine.song.name + '” to the crate.');
  }

  function syncDeckButtons() {
    if (el.freezeBtn) el.freezeBtn.disabled = !running;
    if (el.saveBtn) el.saveBtn.disabled = !running;
  }

  // ---- A&R session: turn-based individual review -------------------------
  // The DJ pitches one change at a time — a new part, a rework, an FX, a doubled
  // voice or a fill — applies it so you hear it, and shows a card: a generative
  // cover, a plain-English line, and the exact code lines it touched. Keep
  // commits it; kill reverts it and bans that idea for the rest of the song.
  // Runs through the same single-source transport (kind 'vote').

  const VOTE_KINDS = {
    add:     { label: 'new part', cls: 'add' },
    reshape: { label: 'rework',   cls: 'reshape' },
    fx:      { label: 'fx',       cls: 'fx' },
    double:  { label: 'double',   cls: 'double' },
    fill:    { label: 'fill',     cls: 'fill' },
  };

  async function voteStart() {
    if (!(await ensureAudio())) return;
    if (remixPlaying) stopRemix();
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
    if (el.voteDeck) el.voteDeck.hidden = true;
    voteBeforeCode = ''; voteAfterCode = '';
    voteShowingProposed = true;
    clearVoteRoll();
    stopAll();
  }

  function renderVote() {
    play(withVoteRoll(engine.render()), 'vote', engine.song ? engine.song.name : '');
  }

  // Temporarily swap the genome to a snapshot, render clean code, then restore.
  // Produces the "A" (before) code for A/B without mutating state. Covers every
  // genome field the vocabulary touches (fx / double / fill included).
  function renderFromSnapshot(snap) {
    const g = engine.song.genome;
    const saved = {
      active: g.active.slice(), variant: g.variant.slice(), energyIdx: g.energyIdx, bank: g.bank,
      fx: g.fx.slice(), double: g.double.slice(), fill: g.fill,
    };
    g.active = snap.active.slice(); g.variant = snap.variant.slice();
    g.energyIdx = snap.energyIdx; g.bank = snap.bank;
    g.fx = snap.fx.slice(); g.double = snap.double.slice(); g.fill = snap.fill;
    const code = engine.render();
    g.active = saved.active; g.variant = saved.variant; g.energyIdx = saved.energyIdx; g.bank = saved.bank;
    g.fx = saved.fx; g.double = saved.double; g.fill = saved.fill;
    return code;
  }

  function updateTurntable() {
    const proposed = voteShowingProposed;
    if (el.ttLabel) {
      el.ttLabel.textContent = proposed ? 'B' : 'A';
      el.ttLabel.className = 'tt-label' + (proposed ? '' : ' side-a');
    }
    if (el.ttBadge) {
      el.ttBadge.textContent = proposed ? 'proposed' : 'original';
      el.ttBadge.className = 'tt-badge' + (proposed ? '' : ' side-a');
    }
    if (el.ttHint) {
      el.ttHint.textContent = proposed ? 'tap to hear original' : 'tap to hear proposed';
    }
  }

  function onVoteAB() {
    if (!voteActive || !engine.song || !engine.song.pending) return;
    voteShowingProposed = !voteShowingProposed;
    const code = voteShowingProposed ? voteAfterCode : voteBeforeCode;
    const layerMap = voteShowingProposed ? voteAfterLayerMap : voteBeforeLayerMap;
    play(withVoteRoll(code), 'vote', engine.song ? engine.song.name : '');
    if (el.voteCode) {
      el.voteCode.innerHTML = voteCodeHtml(
        code,
        engine.song.pending ? engine.song.pending.layer : -1,
        voteShowingProposed,
        layerMap
      );
    }
    updateTurntable();
  }

  function nextPitch() {
    if (!voteActive) return;
    const p = engine.proposeChange();
    if (!p) { presentSettled(); updateVoteLayers(); return; }
    const afterCode = engine.render(); // single render after mutation is applied
    const afterLayerMap = (engine._lastLayers || []).slice();
    play(withVoteRoll(afterCode), 'vote', engine.song ? engine.song.name : '');
    presentCard(p, afterCode, afterLayerMap);
    updateVoteLayers(); // light the pitched lane's chip alongside the card
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

  function presentCard(p, afterCode, afterLayerMap) {
    // Capture the "before" version by temporarily rendering from the pre-change snapshot.
    let beforeCode = afterCode;
    let beforeLayerMap = afterLayerMap;
    if (engine.song && engine.song.pending) {
      beforeCode = renderFromSnapshot(engine.song.pending.snapshot);
      beforeLayerMap = (engine._lastLayers || []).slice();
      engine._lastLayers = afterLayerMap; // restore to proposed state
    }
    voteAfterCode = afterCode;
    voteAfterLayerMap = afterLayerMap;
    voteBeforeCode = beforeCode;
    voteBeforeLayerMap = beforeLayerMap;
    voteShowingProposed = true;

    if (el.voteEmpty) el.voteEmpty.hidden = true;
    if (el.voteCard) el.voteCard.hidden = false;
    if (el.voteControls) el.voteControls.hidden = false;
    if (el.voteRollWrap) el.voteRollWrap.hidden = false;
    if (el.voteDeck) el.voteDeck.hidden = false;
    sizeVoteRoll(); // the canvas was zero-sized while the wrap was hidden
    const kind = VOTE_KINDS[p.kind] || VOTE_KINDS.reshape;
    if (el.voteKind) {
      el.voteKind.textContent = kind.label;
      el.voteKind.className = 'vc-kind ' + kind.cls;
    }
    // the engine already produces a plain-English line for every kind
    if (el.voteDesc) el.voteDesc.textContent = p.desc ? p.desc.charAt(0).toUpperCase() + p.desc.slice(1) : '—';
    if (el.voteArt && SDJ.Art) {
      const artLayer = Math.min(p.layer, (SDJ.LANE_COLORS || []).length - 1); // fill (7) borrows a lane's art
      el.voteArt.innerHTML = SDJ.Art.cover(artLayer, engine.song.genome.variant[artLayer] || 0, engine.song.seed);
    }
    if (el.voteCode) el.voteCode.innerHTML = voteCodeHtml(afterCode, p.layer, true, afterLayerMap);
    updateTurntable();
  }

  function presentSettled() {
    renderVote();
    if (el.voteCard) el.voteCard.hidden = true;
    if (el.voteControls) el.voteControls.hidden = true;
    if (el.voteRollWrap) el.voteRollWrap.hidden = true;
    if (el.voteDeck) el.voteDeck.hidden = true;
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
    saveToCrate('💾 kept “' + engine.song.name + '” from the A&R session', 'a&r');
    setStatus('Saved “' + engine.song.name + '” to the crate.');
  }

  // Current code with the proposed layer's line(s) highlighted.
  // doHighlight=false when showing the A (original) side — no lines to mark yet.
  // layerMap overrides engine._lastLayers so A and B each use their own map.
  function voteCodeHtml(code, layer, doHighlight, layerMap) {
    const lines = code.split('\n');
    const map = layerMap || engine._lastLayers || [];
    const bodyStart = 2; // line 0 = setcps(...), line 1 = stack(
    const colors = SDJ.LANE_COLORS;
    const layerColor = (colors && layer != null && layer >= 0) ? colors[layer] : null;
    let out = '';
    for (let idx = 0; idx < lines.length; idx++) {
      const k = idx - bodyStart;
      const isLayer = doHighlight !== false && k >= 0 && k < map.length && map[k] === layer;
      const inner = highlight(lines[idx]) || ' ';
      // Apply the layer's pianoroll lane colour inline so the highlight matches the roll.
      const style = (isLayer && layerColor)
        ? ' style="border-left-color:' + layerColor + ';background:' + layerColor + '22"'
        : '';
      out += '<span class="vc-line' + (isLayer ? ' vc-hl' : '') + '"' + style + '>' + inner + '</span>';
    }
    return out;
  }

  function updateVoteLayers() {
    if (!el.voteLayers || !engine.song) return;
    const st = engine.state();
    const pend = engine.song.pending;
    // Chips show the *committed* track; the lane the DJ is currently pitching gets
    // a pulsing tint in its own lane colour (matching the code highlight and the
    // pianoroll lane), so "bring in the chords" visibly points at CHORDS before
    // you keep it. proposeChange() has already mutated the genome, so committed
    // state comes from the pre-pitch snapshot, not the live active array.
    const committed = pend ? pend.snapshot.active : st.activeLayers;
    const pitchLayer = pend ? pend.layer : -1;
    el.voteLayers.innerHTML = '';
    st.stageKeys.forEach((keyName, i) => {
      const c = document.createElement('span');
      const pitching = i === pitchLayer;
      c.className = 'chip' + (committed[i] ? ' on' : '') + (pitching ? ' pitching' : '');
      if (pitching && SDJ.LANE_COLORS) c.style.setProperty('--pitch', SDJ.LANE_COLORS[i]);
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

  // ---- the crate: a reusable record library ------------------------------
  // Saved tracks are full records, not just a code blob: each carries its
  // musical metadata, a genome snapshot (so it can be re-loaded or remixed) and
  // a deterministic cover-art seed. Old entries (bare {name,key,…,code}) still
  // render — every new field is read defensively so the library stays portable.

  function saveCrate(crate) {
    try { localStorage.setItem(CRATE_KEY, JSON.stringify(crate)); } catch (e) { /* quota */ }
  }

  // Cheap stable string hash → a seed for records saved before art seeds existed.
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Cover-art layer for a record: the highest active lane reads as the track's
  // "face" (its fullest sound). Falls back to the kick.
  function pickArtLayer(genome) {
    let hi = 0;
    for (let i = 0; i < genome.active.length; i++) if (genome.active[i]) hi = i;
    return hi;
  }

  // Deterministic SVG cover for a record — from its stored art seed, or (for a
  // migrated pre-art entry) a stable hash of its name so it still gets a face.
  function coverFor(entry) {
    if (!SDJ.Art) return '';
    if (entry.art) return SDJ.Art.cover(entry.art.layer, entry.art.variant, entry.art.seed >>> 0);
    const seed = hashStr(entry.name || 'record');
    return SDJ.Art.cover(seed % 7, (seed >> 4) % 6, seed);
  }

  function saveToCrate(logMsg, source) {
    const s = engine.song;
    if (!s) return;
    const g = s.genome;
    const st = engine.state();
    const code = engine.render();
    const crate = loadCrate();
    // dedupe: don't bank the very same code twice in a row (the loop auto-saves
    // bangers — this stops an unchanged track piling up duplicates).
    if (crate.length && crate[0].code === code) {
      if (logMsg) logEvent('↩ already the newest in the crate — not duplicated');
      return;
    }
    const artLayer = pickArtLayer(g);
    const entry = {
      id: 'rec-' + (s.seed >>> 0).toString(36) + '-' + Date.now().toString(36),
      name: s.name,
      key: s.key,
      scaleType: s.scaleType,
      bpm: s.bpm,
      cps: s.cps,
      genre: st.genre,
      genreLabel: st.genreLabel,
      code: code,
      genome: JSON.parse(JSON.stringify(g)), // snapshot: re-loadable / remixable
      art: { seed: s.seed >>> 0, layer: artLayer, variant: g.variant[artLayer] || 0 },
      approval: Math.round(s.approval),
      source: source || 'saved',
      savedAt: Date.now(),
    };
    crate.unshift(entry);
    if (crate.length > CRATE_CAP) crate.length = CRATE_CAP;
    saveCrate(crate);
    if (logMsg) logEvent(logMsg);
    renderCrate();
    renderRemixShelf();
  }

  // crowd-approved banger — auto-saved from the loop
  function saveBanger() {
    saveToCrate('💾 the crowd went off — saved “' + engine.song.name + '” to the crate', 'banger');
  }

  function loadCrate() {
    try {
      return JSON.parse(localStorage.getItem(CRATE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  // Records in display order. Storage stays newest-first; sort is a view only,
  // so each row keeps its true storage index (`i`) for play/rename/delete.
  function sortedCrate() {
    const crate = loadCrate();
    const rows = crate.map((entry, i) => ({ entry: entry, i: i }));
    if (crateSort === 'hype') rows.sort((a, b) => (b.entry.approval || 0) - (a.entry.approval || 0));
    else if (crateSort === 'name') rows.sort((a, b) => (a.entry.name || '').localeCompare(b.entry.name || ''));
    return rows; // 'new' keeps storage order
  }

  function renderCrate() {
    if (!el.crate) return;
    const rows = sortedCrate();
    el.crate.innerHTML = '';
    if (!rows.length) {
      el.crate.innerHTML =
        '<li class="crate-empty">No records yet. Hold the mood high on a full track to bank a banger, ' +
        'or hit 💾 Save on a version you like — saved tracks become your own library here.</li>';
      return;
    }
    const SRC = { banger: '★ banger', 'a&r': 'a&r', saved: 'saved' };
    rows.forEach(({ entry, i }) => {
      const playing = i === previewing;
      const li = document.createElement('li');
      li.className = 'crate-item' + (playing ? ' playing' : '');
      li.dataset.i = i;
      const when = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString() : '';
      const src = entry.source ? (SRC[entry.source] || entry.source) : '';
      li.innerHTML =
        '<div class="crate-art">' + coverFor(entry) + '</div>' +
        '<div class="crate-body">' +
          '<div class="crate-meta"><strong>' + escapeHtml(entry.name || 'Untitled') + '</strong>' +
          '<span>' + escapeHtml((entry.key || '') + ' ' + (entry.scaleType || '')) + ' · ' + entry.bpm + ' BPM' +
          (entry.genreLabel ? ' · ' + escapeHtml(entry.genreLabel) : '') + '</span></div>' +
          '<div class="crate-tags">' +
            (entry.approval != null ? '<span class="crate-hype">' + entry.approval + '% hype</span>' : '') +
            (src ? '<span class="crate-src">' + escapeHtml(src) + '</span>' : '') +
            (when ? '<span class="crate-when">' + when + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="crate-actions">' +
          '<button data-act="' + (playing ? 'stop' : 'play') + '" data-i="' + i + '" title="' + (playing ? 'Stop' : 'Preview') + '">' + (playing ? '⏹' : '▶') + '</button>' +
          '<button data-act="remix" data-i="' + i + '" title="DJ this record in the Remix lab">🎚</button>' +
          '<button data-act="rename" data-i="' + i + '" title="Rename">✎</button>' +
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
        else if (act === 'remix') sendToRemix(i);
        else if (act === 'rename') renameTrack(i);
        else deleteTrack(i);
      });
    });
  }

  function deleteTrack(i) {
    if (previewing >= 0) stopPreview(); // indices shift; drop any preview first
    const crate = loadCrate();
    crate.splice(i, 1);
    saveCrate(crate);
    renderCrate();
    renderRemixShelf();
  }

  function renameTrack(i) {
    const crate = loadCrate();
    const entry = crate[i];
    if (!entry) return;
    const name = window.prompt('Rename this record', entry.name || '');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    entry.name = trimmed;
    saveCrate(crate);
    renderCrate();
    renderRemixShelf();
    if (remixRecord && remixRecord.id === entry.id) { remixRecord.name = trimmed; renderRemixHeader(); }
  }

  // Portable library: dump the whole crate to a JSON file the user can keep.
  function exportCrate() {
    const crate = loadCrate();
    if (!crate.length) { setStatus('Crate is empty — nothing to export.'); return; }
    const name = 'sdj-crate-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    const blob = new Blob([JSON.stringify(crate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logEvent('⬇ exported the crate — ' + crate.length + ' records → ' + name);
    setStatus('Exported ' + crate.length + ' records.');
  }

  // Merge an exported crate back in (skips codes already present).
  function importCrate(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result));
        if (!Array.isArray(incoming)) throw new Error('not a crate');
        const crate = loadCrate();
        const seen = new Set(crate.map((e) => e.code));
        let added = 0;
        incoming.forEach((e) => {
          if (e && typeof e.code === 'string' && !seen.has(e.code)) { crate.push(e); seen.add(e.code); added++; }
        });
        crate.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (crate.length > CRATE_CAP) crate.length = CRATE_CAP;
        saveCrate(crate);
        renderCrate();
        renderRemixShelf();
        setStatus('Imported ' + added + ' record' + (added === 1 ? '' : 's') + ' into the crate.');
        logEvent('⬆ imported ' + added + ' records into the crate');
      } catch (e) {
        setStatus('Import failed — that file isn’t a crate export.');
      }
    };
    reader.readAsText(file);
  }

  // Load a crate record onto the Remix deck and jump there.
  function sendToRemix(i) {
    const entry = loadCrate()[i];
    if (!entry) return;
    loadRemixRecord(entry);
    location.hash = '#remix';
  }

  // The crate is a standalone player: previewing initialises audio on demand
  // and doesn't need a live set. Live and preview are mutually exclusive —
  // starting a preview stops any running set so nothing plays over the top.
  async function previewTrack(i) {
    const entry = loadCrate()[i];
    if (!entry) return;
    setStatus('Loading sounds…');
    if (!(await ensureAudio())) return;
    if (remixPlaying) stopRemix(); // one source at a time
    if (voteActive) stopVote();
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

  // ---- remix lab: DJ a saved record ------------------------------------
  // A saved record is a loopy hook. The remix deck plays it as a looping BED and
  // layers overlays on top — vocal chops/toplines cut in for variety, plus a
  // filter sweep, a stutter and a riser. Everything is composed as one balanced
  // Strudel string: the record's own `stack(...)` nested as a single pattern arg
  // of a new outer stack, so bed + overlays coexist. Runs through the shared
  // single-source transport as kind 'remix'.

  // Vocals come from dirt-samples banks that load with the drum kit at boot
  // (yeah, ho, numbers, speech, mouth …) — no external TTS. Overlays roll
  // through this set; each entry is a real bank[:index] that s("…") triggers.
  const VOCAL_SAMPLES = ['yeah:1', 'yeah:5', 'yeah:12', 'ho:0', 'ho:3', 'numbers:0', 'numbers:1', 'speech:2', 'mouth:6', 'yeah:20'];
  // Deck A's single-press pads: a DJ-friendly label backed by a real sample.
  const VOX_PADS = [
    { label: 'yeah',  s: 'yeah:1'    },
    { label: 'shout', s: 'yeah:9'    },
    { label: 'hey',   s: 'ho:0'      },
    { label: 'ho',    s: 'ho:3'      },
    { label: 'uh',    s: 'mouth:6'   },
    { label: 'one',   s: 'numbers:0' },
    { label: 'two',   s: 'numbers:1' },
    { label: 'go',    s: 'speech:2'  },
  ];

  // Deck B's latching FX pads (the 'etc' overlays). 'chops' still lives in the
  // engine (composeRemix + the API) but the manual voice pads cover it now.
  const REMIX_OVERLAYS = [
    { key: 'topline', label: 'Vocal topline', hint: 'a chopped, echoing line', vocal: true },
    { key: 'sweep',   label: 'Filter sweep',  hint: 'the hook breathes' },
    { key: 'stutter', label: 'Stutter',       hint: 'glitch beat-repeat' },
    { key: 'riser',   label: 'Riser',         hint: 'noise build for drops' },
  ];

  // Vocals ride in with the drum kit at boot (dirt-samples), so there's nothing
  // to fetch here — just reflect whether the kit loaded. The bed still plays if
  // it didn't; the vocal pads simply stay silent.
  async function ensureVocals() {
    setRemixVocalState(vocalsLoaded ? 'ready' : 'unavailable');
    return vocalsLoaded;
  }

  function setRemixVocalState(state) {
    if (!el.remixVocalState) return;
    const msg = state === 'ready' ? '🎤 vocals ready'
      : state === 'loading' ? '🎤 loading vocals…'
      : state === 'unavailable' ? '🎤 vocals unavailable — bed only'
      : '🎤 vocals load on play';
    el.remixVocalState.textContent = msg;
    el.remixVocalState.className = 'remix-vocal ' + (state || 'idle');
  }

  // Map the transition fader (0..1) to a bed low-pass cutoff. 1 = fully open.
  function transitionFreq() { return Math.round(200 * Math.pow(90, remixTransition)); }

  // One cycle of the loaded record, in ms — how long a one-shot vocal stab lives.
  function cycleMs() { return Math.max(300, 1000 / ((remixRecord && remixRecord.cps) || 0.5)); }

  // Compose the record + deck FX + live vocal stabs into one balanced program.
  function composeRemix() {
    if (!remixRecord) return null;
    const rec = remixRecord;
    const code = rec.code || '';
    const nl = code.indexOf('\n');
    let cpsLine = 'setcps(' + (rec.cps || 0.5) + ')';
    let stackExpr = code;
    if (nl >= 0 && code.slice(0, nl).indexOf('setcps') >= 0) {
      cpsLine = code.slice(0, nl);
      stackExpr = code.slice(nl + 1);
    }
    // the record's whole stack, nested as one pattern, with optional bed-level FX
    let bed = '(' + stackExpr.trim() + ')';
    if (remixFx.sweep) bed += '.lpf(sine.range(500,4500).slow(8))';
    else if (remixTransition < 0.995) bed += '.lpf(' + transitionFreq() + ')'; // transition duck
    if (remixFx.stutter) bed += '.sometimesBy(0.25, x => x.ply("2 4"))';
    bed += '.gain(0.92)';

    const layers = [bed];
    if (remixFx.chops) {
      const w0 = VOCAL_SAMPLES[remixWord % VOCAL_SAMPLES.length];
      const w1 = VOCAL_SAMPLES[(remixWord + 3) % VOCAL_SAMPLES.length];
      layers.push('s("' + w0 + ' ~ ~ ~ ' + w1 + ' ~ ~ ~").gain(0.9).cut(1).room(0.2)');
    }
    if (remixFx.topline) {
      const w = VOCAL_SAMPLES[(remixWord + 5) % VOCAL_SAMPLES.length];
      layers.push('s("' + w + '").slow(4).chop(8).gain(0.7)' +
        '.delay(0.3).delaytime(0.16).delayfeedback(0.35).room(0.4)');
    }
    if (remixFx.riser) {
      layers.push('s("white").gain(0.1).lpf(sine.range(400,9000).slow(8)).hpf(300).room(0.5)');
    }
    // live vocal stabs (Deck A pads) — each a one-shot layer while it's sounding
    activeStabs.forEach((w) => layers.push('s("' + w + '").gain(0.95).room(0.16)'));
    return cpsLine + '\nstack(\n  ' + layers.join(',\n  ') + '\n)';
  }

  function remixEvaluate() {
    const code = composeRemix();
    if (!code) return;
    remixPlaying = true;
    play(withRemixRoll(code), 'remix', remixRecord ? remixRecord.name : '');
  }

  async function onRemixStart() {
    if (!remixRecord) { setStatus('Load a record onto Deck B first.'); return; }
    if (remixPlaying) { stopRemix(); return; }
    setStatus('Loading sounds…');
    if (!(await ensureAudio())) return;
    await ensureVocals();
    if (voteActive) stopVote();     // one source at a time
    if (running) stopSet();
    if (previewing >= 0) stopPreview();
    sizeRemixRoll();
    remixEvaluate();
    updateRemixButtons();
    if (el.remixPlatter) el.remixPlatter.classList.add('spin');
    setStatus('Spinning “' + remixRecord.name + '” — finger the vox pads over the loop.');
  }

  function stopRemix() {
    if (!remixPlaying) return;
    remixPlaying = false;
    activeStabs.length = 0;
    stopAll();
    clearRemixRoll();
    updateRemixButtons();
    if (el.remixPlatter) el.remixPlatter.classList.remove('spin');
    setStatus('Remix stopped.');
  }

  // Fire a vocal one-shot from a Deck A pad: it stabs over the loop on the next
  // cycle, then clears itself. Momentary — press again to hit it again.
  function stab(padOrLabel) {
    // Click handlers pass the pad object; the headless API passes a label string.
    const pad = typeof padOrLabel === 'string'
      ? VOX_PADS.find((p) => p.label === padOrLabel) : padOrLabel;
    if (!pad) return;
    if (!remixRecord) { setStatus('Load a record onto Deck B first.'); return; }
    flashVoicePad(pad.label);
    if (!remixPlaying) { setStatus('Hit ▶ Play bed, then fire the vox pads.'); return; }
    activeStabs.push(pad.s);
    remixEvaluate();
    setTimeout(() => {
      const i = activeStabs.indexOf(pad.s);
      if (i >= 0) { activeStabs.splice(i, 1); if (remixPlaying) remixEvaluate(); }
    }, cycleMs());
  }

  function flashVoicePad(word) {
    if (!el.remixVox) return;
    const pad = el.remixVox.querySelector('.vox-pad[data-word="' + word + '"]');
    if (!pad) return;
    pad.classList.add('hit');
    setTimeout(() => pad.classList.remove('hit'), 140);
  }

  // Drag the transition fader → filter the bed for a drop. Throttled to ~120ms
  // so a fast drag doesn't re-evaluate the audio on every input event.
  function onTransition() {
    if (!el.remixTransition) return;
    remixTransition = (+el.remixTransition.value || 0) / 100;
    if (remixFx.sweep) return;          // sweep owns the filter while it's on
    if (transitionTimer) return;
    transitionTimer = setTimeout(() => {
      transitionTimer = 0;
      if (remixPlaying) remixEvaluate();
    }, 120);
  }

  function toggleRemixFx(key) {
    if (!(key in remixFx)) return;
    remixFx[key] = !remixFx[key];
    // rotate the vocal word bank each time a vocal overlay comes on, for variety
    if (remixFx[key] && (key === 'chops' || key === 'topline')) remixWord = (remixWord + 1) % VOCAL_SAMPLES.length;
    updateRemixButtons();
    if (remixPlaying) remixEvaluate(); // hot-swap the overlay in without a restart
  }

  function buildRemixRack() {
    if (!el.remixRack) return;
    el.remixRack.innerHTML = '';
    REMIX_OVERLAYS.forEach((ov) => {
      const b = document.createElement('button');
      b.className = 'remix-pad' + (ov.vocal ? ' vocal' : '');
      b.dataset.key = ov.key;
      b.innerHTML = '<strong>' + ov.label + '</strong><small>' + ov.hint + '</small>';
      b.addEventListener('click', () => toggleRemixFx(ov.key));
      el.remixRack.appendChild(b);
    });
    updateRemixButtons();
  }

  // Deck A: eight single-press vocal pads (the square set).
  function buildVoiceDeck() {
    if (!el.remixVox) return;
    el.remixVox.innerHTML = '';
    VOX_PADS.forEach((pad) => {
      const b = document.createElement('button');
      b.className = 'vox-pad';
      b.dataset.word = pad.label;
      b.textContent = pad.label;
      b.addEventListener('click', () => stab(pad));
      el.remixVox.appendChild(b);
    });
  }

  function updateRemixButtons() {
    if (el.remixRack) {
      el.remixRack.querySelectorAll('.remix-pad').forEach((b) => {
        b.classList.toggle('on', !!remixFx[b.dataset.key]);
      });
    }
    if (el.remixStart) {
      el.remixStart.textContent = remixPlaying ? '⏹ Stop' : '▶ Play bed';
      el.remixStart.disabled = !remixRecord;
    }
    if (el.remixSave) el.remixSave.disabled = !remixRecord;
  }

  // Deck B's record shelf: a strip of cover art — click one to load it.
  function renderRemixShelf() {
    if (!el.remixShelf) return;
    const crate = loadCrate();
    const curId = remixRecord ? (remixRecord.id || remixRecord.code) : '';
    el.remixShelf.innerHTML = '';
    if (!crate.length) {
      const empty = document.createElement('div');
      empty.className = 'remix-shelf-empty';
      empty.textContent = 'No records yet — save some first.';
      el.remixShelf.appendChild(empty);
      return;
    }
    crate.forEach((entry) => {
      const id = entry.id || entry.code;
      const item = document.createElement('button');
      item.className = 'shelf-item' + (id === curId ? ' sel' : '');
      item.title = (entry.name || 'Untitled') + ' · ' + entry.bpm + ' BPM';
      const art = document.createElement('div');
      art.className = 'shelf-art';
      art.innerHTML = coverFor(entry);
      const nm = document.createElement('div');
      nm.className = 'shelf-name';
      nm.textContent = entry.name || 'Untitled';
      item.appendChild(art);
      item.appendChild(nm);
      item.addEventListener('click', () => loadRemixRecord(entry));
      el.remixShelf.appendChild(item);
    });
  }

  function loadRemixRecord(entry) {
    remixRecord = entry;
    if (remixPlaying) remixEvaluate(); // swap the bed live if already playing
    renderRemixHeader();
    renderRemixShelf();
    updateRemixButtons();
    if (el.remixEmpty) el.remixEmpty.hidden = true;
    if (el.remixStage) el.remixStage.hidden = false;
  }

  function renderRemixHeader() {
    if (!remixRecord) return;
    if (el.remixName) el.remixName.textContent = remixRecord.name || 'Untitled';
    if (el.remixMeta) el.remixMeta.textContent =
      (remixRecord.key || '') + ' ' + (remixRecord.scaleType || '') + ' · ' + remixRecord.bpm + ' BPM' +
      (remixRecord.genreLabel ? ' · ' + remixRecord.genreLabel : '');
    if (el.remixArt && SDJ.Art) el.remixArt.innerHTML = coverFor(remixRecord);
  }

  // Save the current remix (bed + active overlays) as a fresh record.
  function onRemixSave() {
    if (!remixRecord) return;
    const code = composeRemix();
    if (!code) return;
    const base = remixRecord;
    const active = Object.keys(remixFx).filter((k) => remixFx[k]);
    const crate = loadCrate();
    const entry = {
      id: 'rmx-' + Date.now().toString(36),
      name: base.name + ' (remix)',
      key: base.key, scaleType: base.scaleType, bpm: base.bpm, cps: base.cps,
      genre: base.genre, genreLabel: base.genreLabel,
      code: code,
      art: base.art ? { seed: base.art.seed, layer: base.art.layer, variant: (base.art.variant || 0) + 1 } : null,
      approval: base.approval,
      source: 'remix',
      savedAt: Date.now(),
      remixOf: base.id || null,
      overlays: active,
    };
    crate.unshift(entry);
    if (crate.length > CRATE_CAP) crate.length = CRATE_CAP;
    saveCrate(crate);
    renderCrate();
    renderRemixShelf();
    logEvent('💾 saved remix “' + entry.name + '” to the crate');
    setStatus('Saved the remix to the crate.');
  }

  // Called when the #remix view becomes visible.
  function enterRemix() {
    sizeRemixRoll();
    renderRemixShelf();
    if (remixRecord) {
      renderRemixHeader();
      if (el.remixEmpty) el.remixEmpty.hidden = true;
      if (el.remixStage) el.remixStage.hidden = false;
    } else {
      if (el.remixEmpty) el.remixEmpty.hidden = false;
      if (el.remixStage) el.remixStage.hidden = true;
    }
    setRemixVocalState(vocalsLoaded ? 'ready' : (started ? 'unavailable' : 'idle'));
    updateRemixButtons();
  }

  // ---- crowd pad: two emotional axes, never a musical parameter ----------
  // Y = energy (flat..going off) is the reward the DJ climbs; X = warmth
  // (cold..warm) only biases HOW it searches. This is the whole control
  // surface — the DJ still authors every note.

  let energyIn = 0.1; // -1..1, the fitness signal (this is today's "mood")
  let warmthIn = 0;   // -1..1, colours the search
  let intentIn = 0;   // -1..1, density dial (strip <-> pile on)
  const laneMoodIn = [0, 0, 0, 0, 0, 0, 0]; // -1..1 per lane: granular opinion

  function getEnergy() { return energyIn; }
  function getWarmth() { return warmthIn; }
  function getIntent() { return intentIn; }

  // Push the current per-lane opinion + density onto whatever song is live, so a
  // fader move lands immediately (the loops also re-apply this each tick).
  function applyControls() {
    if (engine.song) {
      engine.song.laneMood = laneMoodIn.slice();
      engine.song.intent = intentIn;
    }
  }

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

  // ---- per-part opinion faders + density dial ---------------------------
  // The seven colour-coded faders are the granular feedback surface: each is the
  // crowd's opinion on one part (up = feature it, down = lose it). The density
  // dial biases how busy the whole track gets. Both feed the engine every tick.

  function buildControls() {
    buildOpinionBank(el.liveOpinion, (i, v) => { laneMoodIn[i] = v; applyControls(); });
    if (el.liveDensity) {
      el.liveDensity.addEventListener('input', () => { intentIn = (+el.liveDensity.value) / 100; applyControls(); });
    }
    buildGenreSelect();
  }

  // Populate the genre picker from Theory.GENRES (the leading "surprise me" option
  // lives in the HTML) and wire it. Pinning a genre makes every fresh track come
  // out in that style — next track, and right away if a set is already running.
  function buildGenreSelect() {
    if (!el.liveGenre) return;
    SDJ.Theory.GENRES.forEach((g) => {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.label;
      el.liveGenre.appendChild(o);
    });
    el.liveGenre.value = engine.genrePref || '';
    el.liveGenre.addEventListener('change', () => setGenre(el.liveGenre.value));
  }

  // Pin the genre (''/null = surprise me). Exposed on SDJ so an agent can set the
  // style headlessly. If a set is live, re-skin the current track in place — same
  // arrangement, re-rendered in the new style at the new tempo — so you hear it
  // straight away instead of dropping back to a bare kick.
  function setGenre(id) {
    const reskinned = engine.setGenre(id);
    if (el.liveGenre) el.liveGenre.value = engine.genrePref || '';
    const label = engine.genrePref
      ? ((SDJ.Theory.GENRES.find((g) => g.id === engine.genrePref) || {}).label || 'that style')
      : 'Surprise me';
    if (running && reskinned) {
      setFrozen(false);
      evaluateCurrent(false); // re-render the live arrangement in the new genre + tempo
      updateUI();
      if (SDJ.SetLog) SDJ.SetLog.mark('song', { reason: 'genre', name: engine.song.name });
      logEvent('🎚 re-skinned as ' + engine.song.genre.label + ' · ' + engine.song.bpm + ' bpm');
    } else {
      setStatus(label + ' — takes effect on the next track.');
    }
  }

  // Build a bank of colour-coded per-lane opinion faders into `container`.
  // onChange(i, v) fires with the lane index and a value in -1..1. Reused by the
  // live deck and the A&R session (both steer the same laneMood mechanism).
  function buildOpinionBank(container, onChange) {
    if (!container) return [];
    const stages = SDJ.STAGES || [];
    const colors = SDJ.LANE_COLORS || [];
    container.innerHTML = '';
    const inputs = [];
    stages.forEach((st, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'fader';
      const input = document.createElement('input');
      input.type = 'range'; input.min = '-100'; input.max = '100'; input.value = '0';
      input.className = 'fader-range';
      input.style.accentColor = colors[i] || '#fff';
      input.setAttribute('aria-label', 'opinion on ' + st.key);
      input.addEventListener('input', () => onChange(i, (+input.value) / 100));
      const key = document.createElement('span');
      key.className = 'fader-key'; key.textContent = st.key;
      key.style.color = colors[i] || '#fff';
      wrap.appendChild(input); wrap.appendChild(key);
      container.appendChild(wrap);
      inputs.push(input);
    });
    container._inputs = inputs;
    return inputs;
  }

  // Zero the live faders + dial and the input state (a fresh set).
  function resetControls() {
    for (let i = 0; i < laneMoodIn.length; i++) laneMoodIn[i] = 0;
    intentIn = 0;
    if (el.liveOpinion && el.liveOpinion._inputs) el.liveOpinion._inputs.forEach((inp) => { inp.value = '0'; });
    if (el.liveDensity) el.liveDensity.value = '0';
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

  const VIEWS = ['menu', 'live', 'vote', 'crate', 'remix'];

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
    if (name === 'remix') enterRemix();
    if (name === 'menu') updateMenu();
    // the signal-bloom menu canvas only animates while the menu is on screen
    if (SDJ.Menu) { if (name === 'menu') SDJ.Menu.enter(); else SDJ.Menu.leave(); }
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

  // expose the controls so every action the UI can take is available
  // programmatically (agent-native parity, and the headless test drives them)
  SDJ.setCrowd = setCrowd;
  SDJ.engine = engine; // the live engine, for headless drive + agent-native reads
  SDJ.setDensity = function (v) {
    intentIn = clamp(v, -1, 1);
    if (el.liveDensity) el.liveDensity.value = String(Math.round(intentIn * 100));
    applyControls();
  };
  SDJ.setOpinion = function (i, v) {
    if (i < 0 || i >= laneMoodIn.length) return;
    laneMoodIn[i] = clamp(v, -1, 1);
    if (el.liveOpinion && el.liveOpinion._inputs && el.liveOpinion._inputs[i]) {
      el.liveOpinion._inputs[i].value = String(Math.round(laneMoodIn[i] * 100));
    }
    applyControls();
  };
  SDJ.setGenre = setGenre; // pin the genre for new tracks (agent-native)

  // remix deck, exposed so every action is available headlessly (agent-native)
  SDJ.remix = {
    load: loadRemixRecord,
    toggle: toggleRemixFx,
    stab: stab,
    play: onRemixStart,
    stop: stopRemix,
    compose: composeRemix,
    state: function () { return { record: remixRecord, playing: remixPlaying, fx: Object.assign({}, remixFx), stabs: activeStabs.slice(), transition: remixTransition, vocalsLoaded: vocalsLoaded }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SDJ = window.SDJ || {});
