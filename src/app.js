// app.js — wires the DJ engine, Strudel audio, the crowd panel and the UI.
(function (SDJ) {
  'use strict';

  const CRATE_KEY = 'sdj.crate';
  const CRATE_CAP = 64;
  const MIN_FULL = 6;   // active layers that make a track "full" — the DJ then offers a save
  const SAVE_SNOOZE = 4; // pitches to wait before re-offering a save you declined

  const engine = new SDJ.DJEngine();
  let started = false; // Strudel initialised
  let running = false; // live set in progress
  let pitching = false; // a suggestion is on the card awaiting approve / skip
  let saveCooldown = 0; // engine vprop count until which the save prompt stays snoozed
  let lastGoodCode = '';
  let previewing = -1; // crate index auditioning, or -1 (mutually exclusive with a live set)
  let nowPlaying = { kind: null, name: '' }; // the single audio source: 'live' | 'preview' | 'remix' | null

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
      'trackName', 'trackMeta', 'stageChips', 'roll', 'crate', 'status',
      // deck production controls + unified transport
      'saveBtn', 'transport', 'tpKind', 'tpName', 'tpStop',
      // the DJ's suggestion card + tuning (genre pills, density, part mixer) + calls panel
      'sgEmpty', 'sgCard', 'sgKind', 'sgDesc', 'sgCode', 'sgActions', 'sgApprove', 'sgSkip',
      'livePartMix', 'liveDensity', 'liveGenrePills',
      'djNow', 'djVerb', 'djMove', 'djFeed',
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
    SDJ._remixRollCtx = el.remixRoll ? el.remixRoll.getContext('2d') : null;

    el.startBtn.addEventListener('click', onStartStop);
    el.skipBtn.addEventListener('click', onSkip);
    if (el.saveBtn) el.saveBtn.addEventListener('click', onSaveCurrent);
    if (el.tpStop) el.tpStop.addEventListener('click', stopPlayback);
    if (el.sgApprove) el.sgApprove.addEventListener('click', () => liveDecide(true));
    if (el.sgSkip) el.sgSkip.addEventListener('click', () => liveDecide(false));
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
    buildControls();
    buildRemixRack();
    buildVoiceDeck();
    resetMind();
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
    if (previewing >= 0) { previewing = -1; renderCrate(); } // live replaces any preview
    running = true;
    sizeRoll(); // make sure the pianoroll canvas is sized before the first draw
    el.startBtn.textContent = '⏸ Stop the set';
    syncDeckButtons();
    clearLog();
    updateLogStat();
    freshTrack('set');
    logEvent('🎧 ' + engine.song.name + ' — building from the kick up…');
    setStatus('Live. Approve or skip each change the DJ pitches.');
  }

  function stopSet() {
    running = false;
    hideSuggestion();
    el.startBtn.textContent = '▶ Start the set';
    syncDeckButtons();
    stopAll(); // hush + clear the transport
    clearRoll(); // wipe the roll so a later preview/session doesn't scroll stale notes
    if (SDJ.SetLog) SDJ.SetLog.mark('stop');
    setStatus('Stopped. Press start to bring the DJ back up.');
  }

  function onSkip() {
    if (!running) return;
    logEvent('⏭ fresh track');
    freshTrack('skip');
    logEvent('🎧 ' + engine.song.name);
  }

  // Start a brand-new track: reset the board, play the bare kick, pitch the first
  // change. Shared by Start, New, and moving on after a save.
  function freshTrack(reason) {
    engine.newSong();
    engine.voteReset();      // clear the per-song ban / tabu the pitcher uses
    resetControls();         // neutral board — parts on auto, density held
    resetMind();
    saveCooldown = 0;
    if (SDJ.SetLog) {
      SDJ.SetLog.mark(reason === 'set' ? 'set' : 'song', {
        reason: reason, name: engine.song.name, key: engine.song.key,
        scale: engine.song.scaleType, bpm: engine.song.bpm, banks: !!engine.banksLoaded,
      });
    }
    evaluateCurrent(true);   // play the bare track (just the kick)
    updateUI();
    livePitch();             // present the first suggestion
  }

  // ---- turn-based suggestions: the DJ pitches, you approve or skip ---------
  // Nothing commits without you. proposeChange() applies a candidate to the
  // genome and we audition it; Approve keeps it, Skip reverts + bans it. Once the
  // arrangement is full the DJ offers a save you can take or wave off. The tuning
  // controls (genre / density / part mixer) bias what gets pitched next.

  let pitchLayer = -1; // the lane the current suggestion touches (lights its chip)

  const PITCH_KINDS = {
    add:     { label: 'new part',    cls: 'k-add' },
    drop:    { label: 'drop a part', cls: 'k-drop' },
    reshape: { label: 'rework',      cls: 'k-reshape' },
    fx:      { label: 'effect',      cls: 'k-fx' },
    double:  { label: 'thicken',     cls: 'k-double' },
    fill:    { label: 'fill',        cls: 'k-fill' },
    save:    { label: 'ready?',      cls: 'k-save' },
  };

  // Offer the next thing to judge. A full arrangement (and no snoozed save) gets a
  // save prompt; otherwise a musical change; if nothing's left to change, a save.
  function livePitch() {
    if (!running) return;
    const full = engine.state().activeCount >= MIN_FULL;
    if (full && (engine.song.vprop || 0) >= saveCooldown) { presentSave(false); return; }
    const p = engine.proposeChange();
    if (!p) { presentSave(true); return; }
    const code = engine.render();
    const layerMap = (engine._lastLayers || []).slice();
    play(withRoll(code), 'live', engine.song.name); // audition the proposed version
    presentCard(p, code, layerMap);
  }

  function presentCard(p, code, layerMap) {
    pitching = true;
    pitchLayer = p.layer;
    const kind = PITCH_KINDS[p.kind] || PITCH_KINDS.reshape;
    showSuggestion(kind, p.desc ? p.desc.charAt(0).toUpperCase() + p.desc.slice(1) : '—',
      pitchCodeHtml(code, p.layer, layerMap), '✓ Approve', '✗ Skip');
    if (el.djVerb) el.djVerb.textContent = 'pitching';
    if (el.djMove) el.djMove.textContent = p.desc || 'a change';
    updateUI();
  }

  // settled=true when the whole vocabulary is exhausted (nothing left to pitch).
  function presentSave(settled) {
    pitching = 'save';
    pitchLayer = -1;
    showSuggestion(PITCH_KINDS.save,
      settled ? 'That’s the whole track — save it to the crate?'
              : 'This is sounding full — save it to the crate?',
      '', '💾 Save it', 'Keep going');
    if (el.djVerb) el.djVerb.textContent = 'holding';
    if (el.djMove) el.djMove.textContent = 'ready when you are';
    updateUI();
  }

  function showSuggestion(kind, desc, codeHtml, approveLabel, skipLabel) {
    if (el.sgEmpty) el.sgEmpty.hidden = true;
    if (el.sgCard) el.sgCard.hidden = false;
    if (el.sgActions) el.sgActions.hidden = false;
    if (el.sgKind) { el.sgKind.textContent = kind.label; el.sgKind.className = 'sg-kind ' + kind.cls; }
    if (el.sgDesc) el.sgDesc.textContent = desc;
    if (el.sgCode) { el.sgCode.innerHTML = codeHtml; el.sgCode.hidden = !codeHtml; }
    if (el.sgApprove) el.sgApprove.textContent = approveLabel;
    if (el.sgSkip) el.sgSkip.textContent = skipLabel;
  }

  function hideSuggestion() {
    pitching = false;
    pitchLayer = -1;
    if (el.sgCard) el.sgCard.hidden = true;
    if (el.sgActions) el.sgActions.hidden = true;
    if (el.sgEmpty) el.sgEmpty.hidden = false;
  }

  // Approve (keep) or skip the pitched change / save prompt.
  function liveDecide(keep) {
    if (!running || !pitching) return;
    if (pitching === 'save') {
      if (keep) {
        onSaveCurrent();          // bank the track…
        logEvent('🎧 next up: fresh track');
        freshTrack('next');       // …and roll a fresh one (the track's done)
      } else {
        saveCooldown = (engine.song.vprop || 0) + SAVE_SNOOZE; // snooze the prompt
        pushFeed('→', 'kept going', 'declined the save', 'flat');
        livePitch();
      }
      return;
    }
    if (!engine.song.pending) { livePitch(); return; }
    const p = keep ? engine.acceptChange() : engine.rejectChange();
    if (SDJ.SetLog) SDJ.SetLog.mark('vote', { v: keep ? 'up' : 'down', desc: p.desc });
    pushFeed(keep ? '✓' : '↩', p.desc, keep ? 'approved' : 'skipped', keep ? 'up' : 'down');
    logEvent((keep ? '✓ kept: ' : '✗ skipped: ') + p.desc);
    if (!keep) evaluateCurrent(false); // reverted — reflect the committed track
    pitching = false;
    livePitch();
  }

  // Current code with the pitched layer's line(s) highlighted in its lane colour.
  function pitchCodeHtml(code, layer, layerMap) {
    const lines = code.split('\n');
    const map = layerMap || engine._lastLayers || [];
    const bodyStart = 2; // line 0 = setcps(...), line 1 = stack(
    const colors = SDJ.LANE_COLORS;
    const layerColor = (colors && layer != null && layer >= 0) ? colors[layer] : null;
    let out = '';
    for (let idx = 0; idx < lines.length; idx++) {
      const k = idx - bodyStart;
      const isLayer = k >= 0 && k < map.length && map[k] === layer;
      const inner = highlight(lines[idx]) || ' ';
      const style = (isLayer && layerColor)
        ? ' style="border-left-color:' + layerColor + ';background:' + layerColor + '22"'
        : '';
      out += '<span class="sg-line' + (isLayer ? ' sg-hl' : '') + '"' + style + '>' + inner + '</span>';
    }
    return out;
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
  function sizeRemixRoll() { sizeCanvas(el.remixRoll); }
  function sizeRolls() { sizeRoll(); sizeRemixRoll(); }

  function clearRoll() {
    if (SDJ._rollCtx && el.roll) SDJ._rollCtx.clearRect(0, 0, el.roll.width, el.roll.height);
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
    const panel = el.code;
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
    const token = nowPlaying.kind === 'preview' ? 'preview'
      : nowPlaying.kind === 'remix' ? 'remix'
      : 'live';
    if (el.tpKind) { el.tpKind.textContent = token; el.tpKind.className = 'tp-kind ' + token; }
    if (el.tpName) el.tpName.textContent = nowPlaying.name || '—';
  }

  // ---- production controls: save the current track -----------------------

  function onSaveCurrent() {
    if (!running || !engine.song) {
      setStatus('Start a set first, then save a track you like.');
      return;
    }
    saveToCrate('💾 saved “' + engine.song.name + '” to the crate', 'saved');
    setStatus('Saved “' + engine.song.name + '” to the crate.');
  }

  function syncDeckButtons() {
    if (el.saveBtn) el.saveBtn.disabled = !running;
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
    if (running) stopSet();         // one source at a time
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

  // ---- tuning that biases the DJ's next suggestion ----------------------
  // Neither of these changes the audio on its own — they steer what the DJ
  // pitches next: the part mixer sets a per-lane opinion (drop / auto / feature)
  // and the density dial sets how busy the arrangement should get.

  let intentIn = 0;   // -1..1, density dial (strip <-> pile on)
  const laneMoodIn = [0, 0, 0, 0, 0, 0, 0]; // -1..1 per lane: drop / auto / feature

  // Push the current per-lane opinion + density onto the live song so the next
  // proposeChange() reads them.
  function applyControls() {
    if (engine.song) {
      engine.song.laneMood = laneMoodIn.slice();
      engine.song.intent = intentIn;
    }
  }

  // ---- tuning controls: part mixer + density dial + genre pills ----------

  function buildControls() {
    buildPartMix(el.livePartMix, (i, v) => { laneMoodIn[i] = v; applyControls(); });
    if (el.liveDensity) {
      el.liveDensity.addEventListener('input', () => { intentIn = (+el.liveDensity.value) / 100; applyControls(); });
    }
    buildGenrePills();
  }

  // Populate the genre picker from Theory.GENRES (the leading "surprise me" option
  // lives in the HTML) and wire it. Pinning a genre makes every fresh track come
  // out in that style — next track, and right away if a set is already running.
  function buildGenrePills() {
    if (!el.liveGenrePills) return;
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.genre = id;
      b.textContent = label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => setGenre(id));
      el.liveGenrePills.appendChild(b);
    };
    mk('', '🎲 Surprise me');
    SDJ.Theory.GENRES.forEach((g) => mk(g.id, g.label));
    reflectGenre();
  }

  // Light the pill matching the pinned genre ('' = surprise me). Called on build
  // and whenever setGenre runs, so a headless SDJ.setGenre() lights the right one.
  function reflectGenre() {
    if (!el.liveGenrePills) return;
    const cur = engine.genrePref || '';
    el.liveGenrePills.querySelectorAll('.pill').forEach((b) => {
      const on = b.dataset.genre === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // Pin the genre (''/null = surprise me). Exposed on SDJ so an agent can set the
  // style headlessly. If a set is live, re-skin the current track in place — same
  // arrangement, re-rendered in the new style at the new tempo — so you hear it
  // straight away instead of dropping back to a bare kick.
  function setGenre(id) {
    const reskinned = engine.setGenre(id);
    reflectGenre();
    const label = engine.genrePref
      ? ((SDJ.Theory.GENRES.find((g) => g.id === engine.genrePref) || {}).label || 'that style')
      : 'Surprise me';
    if (running && reskinned) {
      // drop any un-judged pitch, re-render the committed arrangement in the new
      // style, then pitch fresh so the suggestion matches the new genre.
      if (pitching && pitching !== 'save' && engine.song.pending) engine.rejectChange();
      evaluateCurrent(false);
      updateUI();
      if (SDJ.SetLog) SDJ.SetLog.mark('song', { reason: 'genre', name: engine.song.name });
      logEvent('🎚 re-skinned as ' + engine.song.genre.label + ' · ' + engine.song.bpm + ' bpm');
      livePitch();
    } else {
      setStatus(label + ' — takes effect on the next track.');
    }
  }

  // Build the part mixer: one row per arrangement lane, each a 3-state segmented
  // control — drop (−1) / auto (0, the DJ decides) / feature (+1). Replaces the
  // seven fiddly faders with an explicit, legible choice. onChange(i, v) fires
  // with the lane index and value in {-1, 0, 1}. Each row exposes set(v) so the
  // headless SDJ.setOpinion() and resetControls() can drive the visual too.
  function buildPartMix(container, onChange) {
    if (!container) return;
    const stages = SDJ.STAGES || [];
    const colors = SDJ.LANE_COLORS || [];
    container.innerHTML = '';
    container._rows = [];
    stages.forEach((st, i) => {
      const row = document.createElement('div');
      row.className = 'pm-row';
      const key = document.createElement('span');
      key.className = 'pm-key'; key.textContent = st.key;
      key.style.color = colors[i] || '#fff';
      const seg = document.createElement('div');
      seg.className = 'pm-seg';
      const defs = [
        { v: -1, label: 'drop', title: 'drop ' + st.label },
        { v: 0, label: 'auto', title: 'let the DJ decide' },
        { v: 1, label: 'feature', title: 'feature ' + st.label },
      ];
      const set = (v) => btns.forEach((b, k) => b.classList.toggle('on', defs[k].v === v));
      const btns = defs.map((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pm-btn';
        b.textContent = d.label;
        b.title = d.title;
        b.style.setProperty('--pm', colors[i] || '#fff');
        b.addEventListener('click', () => { set(d.v); onChange(i, d.v); });
        seg.appendChild(b);
        return b;
      });
      set(0); // default: auto (the DJ decides)
      row.appendChild(key); row.appendChild(seg);
      container.appendChild(row);
      container._rows.push({ set: set });
    });
  }

  // Zero the live faders + dial and the input state (a fresh set).
  function resetControls() {
    for (let i = 0; i < laneMoodIn.length; i++) laneMoodIn[i] = 0;
    intentIn = 0;
    if (el.livePartMix && el.livePartMix._rows) el.livePartMix._rows.forEach((r) => r.set(0));
    if (el.liveDensity) el.liveDensity.value = '0';
  }

  // ---- UI updates --------------------------------------------------------

  function updateUI() {
    if (!engine.song) return;
    const st = engine.state();
    el.trackName.textContent = st.name;
    el.trackMeta.textContent =
      st.key + ' ' + st.scaleType + ' · ' + st.bpm + ' BPM · ' + st.activeCount + '/7 parts';
    if (el.stageChips.childElementCount !== st.stageKeys.length) {
      el.stageChips.innerHTML = '';
      st.stageKeys.forEach((k) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.textContent = k;
        el.stageChips.appendChild(c);
      });
    }
    // Chips show the COMMITTED arrangement — when a suggestion is applied but not
    // yet judged, that comes from the pre-pitch snapshot; the pitched lane pulses.
    const pend = engine.song.pending;
    const committed = (pend && pitching && pitching !== 'save') ? pend.snapshot.active : st.activeLayers;
    Array.from(el.stageChips.children).forEach((c, i) => {
      c.classList.toggle('on', !!(committed && committed[i]));
      const isPitch = i === pitchLayer;
      c.classList.toggle('pitching', isPitch);
      if (isPitch && SDJ.LANE_COLORS) c.style.setProperty('--pitch', SDJ.LANE_COLORS[i]);
    });
  }

  // ---- the DJ's calls: current status + a running approve/skip history ----

  function resetMind() {
    if (el.djFeed) el.djFeed.innerHTML = '';
    if (el.djVerb) el.djVerb.textContent = 'warming up';
    if (el.djMove) el.djMove.textContent = 'press start to begin…';
    if (el.djNow) el.djNow.classList.remove('settled');
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
    updateLogStat();
    logEvent('🧹 cleared the set log');
  }

  // ---- app shell: hash-routed views (menu / live / crate) ----------------
  // One index.html, three views. The engine, audio and crate all live in this
  // module, so state persists as you move between the menu, the live deck and
  // the crate — navigating is just showing a different section.

  const VIEWS = ['menu', 'live', 'crate', 'remix'];

  function currentRoute() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    return VIEWS.indexOf(h) >= 0 ? h : 'menu';
  }

  function showView(name) {
    document.body.dataset.view = name; // CSS hides the top bar on the full-screen menu
    document.querySelectorAll('[data-view]').forEach((v) => {
      v.hidden = v.getAttribute('data-view') !== name;
    });
    document.querySelectorAll('.topnav [data-nav]').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-nav') === name);
    });
    // navigation never stops audio — the header transport is the single stop.
    if (name === 'live') sizeRoll(); // the canvas was zero-sized while hidden
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
  SDJ.engine = engine; // the live engine, for headless drive + agent-native reads
  // the live turn-based flow: approve / skip the current pitch (agent-native)
  SDJ.live = {
    approve: function () { liveDecide(true); },
    skip: function () { liveDecide(false); },
    pitching: function () { return pitching; },
  };
  SDJ.setDensity = function (v) {
    intentIn = clamp(v, -1, 1);
    if (el.liveDensity) el.liveDensity.value = String(Math.round(intentIn * 100));
    applyControls();
  };
  SDJ.setOpinion = function (i, v) {
    if (i < 0 || i >= laneMoodIn.length) return;
    laneMoodIn[i] = clamp(v, -1, 1);
    // snap the mixer display to the nearest of drop / auto / feature
    if (el.livePartMix && el.livePartMix._rows && el.livePartMix._rows[i]) {
      const snap = laneMoodIn[i] > 0.33 ? 1 : laneMoodIn[i] < -0.33 ? -1 : 0;
      el.livePartMix._rows[i].set(snap);
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
