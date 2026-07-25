// app.js — wires the DJ engine, Strudel audio, the deck rig and the UI.
// The live view is a two-turntable rig: Deck A carries the committed track as a
// spinning record (a coloured ring pressed on per approved part), Deck B carries
// the DJ's pitched change as an acetate, and the crossfader between them blends
// the change in and out (engine.renderAB). Saving is a deliberate "pressing":
// a modal names the record, states which version is banked, and drops it into
// the crate.
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

  // ---- A/B blend + press-modal state -------------------------------------
  let abMix = 1;          // crossfader: 0 = Deck A (committed) only, 1 = full pitch
  let abTimer = 0;        // throttle so dragging the fader doesn't thrash evaluate
  let pressOrigin = null; // 'button' | 'prompt' while the pressing modal is open
  let pressFormat = 'arranged'; // what a press banks: 'arranged' (36-bar track) | 'loop'

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
      // the DJ's suggestion card + tuning (genre pills, density, part mixer) + status
      'sgEmpty', 'sgCard', 'sgKind', 'sgDesc', 'sgActions', 'sgApprove', 'sgSkip',
      'livePartMix', 'liveDensity', 'liveGenrePills',
      'djNow', 'djVerb', 'djMove', 'djFeed',
      // the deck rig: two platters + the A/B crossfader
      'deckRig', 'deckAPlatter', 'deckADisc', 'deckACap', 'deckBPlatter', 'deckBDisc',
      'abWrap', 'abFader', 'abA', 'abB',
      // the pressing modal (the save moment)
      'pressModal', 'pressDisc', 'pressName', 'pressMeta', 'pressVersion',
      'pressConfirm', 'pressCancel', 'pressLoop', 'pressFull', 'pressFormatHint',
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
    // the A/B crossfader: blend the pitched change against the committed track
    if (el.abFader) el.abFader.addEventListener('input', onAbInput);
    if (el.abA) el.abA.addEventListener('click', () => setAbMix(0));
    if (el.abB) el.abB.addEventListener('click', () => setAbMix(1));
    // the pressing modal
    if (el.pressConfirm) el.pressConfirm.addEventListener('click', confirmPress);
    if (el.pressCancel) el.pressCancel.addEventListener('click', cancelPress);
    if (el.pressName) el.pressName.addEventListener('input', renderPressDisc); // live imprint
    if (el.pressFull) el.pressFull.addEventListener('click', () => setPressFormat('arranged'));
    if (el.pressLoop) el.pressLoop.addEventListener('click', () => setPressFormat('loop'));
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
    installAudioTap();
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
    if (el.deckRig) el.deckRig.hidden = false;
    syncDeckButtons();
    clearLog();
    updateLogStat();
    freshTrack('set');
    logEvent('🎧 ' + engine.song.name + ' — cutting a fresh record from the kick up…');
    setStatus('Live. Blend each pitch on the fader, then approve or skip.');
  }

  function stopSet() {
    running = false;
    hideSuggestion();
    el.startBtn.textContent = '▶ Start the set';
    if (el.deckRig) el.deckRig.hidden = true;
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
  // genome and we audition it; Approve keeps it, Skip reverts + bans it. The
  // pitch rides Deck B as an acetate — the crossfader blends it against the
  // committed track on Deck A so you can actually hear the difference. Once the
  // arrangement is full the DJ offers a pressing you can take or wave off.

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
  // the acetate's centre mark per pitch kind (what Deck B's test cut wears)
  const KIND_GLYPHS = { add: '+', drop: '−', reshape: '≈', fx: '✦', double: '≡', fill: '▲', save: '◉' };

  // Lanes that could still be brought in: inactive, not binned for the song,
  // not marked "drop" on the mixer. When this hits zero the track is as full
  // as it can get — treat that as full, or the press prompt never comes.
  function addableLanes() {
    const s = engine.song, g = s.genome, lm = s.laneMood || [];
    let n = 0;
    for (let i = 1; i < g.active.length; i++) {
      if (!g.active[i] && !(s.banned && s.banned['add:' + i]) && !(lm[i] < -0.3)) n++;
    }
    return n;
  }

  // Offer the next thing to judge. A full arrangement (and no snoozed save) gets a
  // press prompt; otherwise a musical change; if nothing's left to change, a press.
  function livePitch() {
    if (!running) return;
    const act = engine.state().activeCount;
    const full = act >= MIN_FULL || (act >= 3 && addableLanes() === 0);
    if (full && (engine.song.vprop || 0) >= saveCooldown) { presentSave(false); return; }
    const p = engine.proposeChange();
    if (!p) { presentSave(true); return; }
    resetAb(); // every fresh pitch auditions at full Deck B
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
      '✓ Approve', '✗ Skip');
    // the code drawer shows the pattern with the pitched lane's lines tinted
    if (el.code) el.code.innerHTML = pitchCodeHtml(code, p.layer, layerMap);
    renderDeckB(p);
    showFader(true);
    if (el.djVerb) el.djVerb.textContent = 'pitching';
    if (el.djMove) el.djMove.textContent = p.desc || 'a change';
    updateUI();
    setDeckSpin();
  }

  // settled=true when the whole vocabulary is exhausted (nothing left to pitch).
  function presentSave(settled) {
    pitching = 'save';
    pitchLayer = -1;
    showSuggestion(PITCH_KINDS.save,
      settled ? 'That’s the whole track — cut it as a dubplate?'
              : 'This is sounding full — cut it as a dubplate?',
      '◉ Cut it', 'Keep going');
    // Deck B shows the finished record, ready for the press
    if (el.deckBDisc) el.deckBDisc.innerHTML = committedDisc();
    showFader(false);
    if (el.djVerb) el.djVerb.textContent = 'holding';
    if (el.djMove) el.djMove.textContent = 'ready when you are';
    updateUI();
    setDeckSpin();
  }

  function showSuggestion(kind, desc, approveLabel, skipLabel) {
    if (el.sgEmpty) el.sgEmpty.hidden = true;
    if (el.sgCard) el.sgCard.hidden = false;
    if (el.sgActions) el.sgActions.hidden = false;
    if (el.sgKind) { el.sgKind.textContent = kind.label; el.sgKind.className = 'sg-kind ' + kind.cls; }
    if (el.sgDesc) el.sgDesc.textContent = desc;
    if (el.sgApprove) el.sgApprove.textContent = approveLabel;
    if (el.sgSkip) el.sgSkip.textContent = skipLabel;
  }

  function hideSuggestion() {
    pitching = false;
    pitchLayer = -1;
    if (el.sgCard) el.sgCard.hidden = true;
    if (el.sgActions) el.sgActions.hidden = true;
    if (el.sgEmpty) el.sgEmpty.hidden = false;
    setDeckSpin();
  }

  // Approve (keep) or skip the pitched change / press prompt.
  function liveDecide(keep) {
    if (!running || !pitching) return;
    if (pitching === 'save') {
      if (keep) {
        openPress('prompt');      // name it, see what's banked, press it
      } else {
        saveCooldown = (engine.song.vprop || 0) + SAVE_SNOOZE; // snooze the prompt
        pushFeed('→', 'kept going', 'declined the press', 'flat');
        livePitch();
      }
      return;
    }
    if (!engine.song.pending) { livePitch(); return; }
    const wasBlended = abMix < 0.999; // the fader sat mid-blend when judged
    const p = keep ? engine.acceptChange() : engine.rejectChange();
    if (SDJ.SetLog) SDJ.SetLog.mark('vote', { v: keep ? 'up' : 'down', desc: p.desc });
    pushFeed(keep ? '✓' : '↩', p.desc, keep ? 'approved' : 'skipped', keep ? 'up' : 'down');
    logEvent((keep ? '✓ kept: ' : '✗ skipped: ') + p.desc);
    // reverted → reflect the committed track; kept mid-blend → play it clean
    if (!keep || wasBlended) evaluateCurrent(false);
    pitching = false;
    livePitch();
  }

  // ---- the A/B crossfader: hear the pitch against the committed track ----
  // Deck A is the committed track, Deck B the pitched change. The fader drives
  // engine.renderAB(mix) — one balanced program with the touched lane at
  // complementary gains — so the change can be blended in and out live.

  function resetAb() {
    abMix = 1;
    if (el.abFader) el.abFader.value = '100';
    reflectAb();
  }

  function reflectAb() {
    if (el.abA) el.abA.classList.toggle('on', abMix <= 0.05);
    if (el.abB) el.abB.classList.toggle('on', abMix >= 0.95);
    if (el.deckAPlatter) el.deckAPlatter.classList.toggle('hot', abMix < 0.5);
    if (el.deckBPlatter) el.deckBPlatter.classList.toggle('hot', abMix >= 0.5);
  }

  function setAbMix(v) {
    abMix = clamp(v, 0, 1);
    if (el.abFader) el.abFader.value = String(Math.round(abMix * 100));
    reflectAb();
    evaluateAb();
  }

  // Drag → blend. Throttled to ~130ms so a fast drag doesn't re-evaluate the
  // audio on every input event.
  function onAbInput() {
    if (!el.abFader) return;
    abMix = (+el.abFader.value || 0) / 100;
    reflectAb();
    if (abTimer) return;
    abTimer = setTimeout(() => { abTimer = 0; evaluateAb(); }, 130);
  }

  function evaluateAb() {
    if (!running || !pitching || pitching === 'save') return;
    if (!engine.song || !engine.song.pending || !engine.renderAB) return;
    play(withRoll(engine.renderAB(abMix)), 'live', engine.song.name);
  }

  function showFader(on) {
    if (el.abWrap) el.abWrap.classList.toggle('off', !on);
  }

  // ---- the records on the platters ---------------------------------------

  // The committed arrangement — what Deck A wears and what a press banks. While
  // a pitch is un-judged the genome holds the proposal, so read the snapshot.
  function committedActive() {
    const s = engine.song;
    if (!s) return null;
    return (s.pending && pitching && pitching !== 'save') ? s.pending.snapshot.active : s.genome.active;
  }

  // The committed genome — what Deck A's disc (and a press) draws its marks
  // from. Same snapshot rule as committedActive().
  function committedGenome() {
    const s = engine.song;
    if (!s) return null;
    return (s.pending && pitching && pitching !== 'save') ? s.pending.snapshot : s.genome;
  }

  function committedDisc(nameOverride) {
    if (!SDJ.Vinyl || !engine.song) return '';
    return SDJ.Vinyl.forLive(engine.song, committedGenome(), nameOverride);
  }

  function renderDeckA() {
    if (!el.deckADisc || !SDJ.Vinyl || !engine.song) return;
    el.deckADisc.innerHTML = committedDisc();
    if (el.deckACap) {
      const n = (committedActive() || []).filter(Boolean).length;
      el.deckACap.textContent = n + ' part' + (n === 1 ? '' : 's') + ' pressed on';
    }
  }

  function renderDeckB(p) {
    if (!el.deckBDisc || !SDJ.Vinyl) return;
    const colour = (p.layer === SDJ.FILL_IDX) ? SDJ.FILL_COLOR
      : ((SDJ.LANE_COLORS && SDJ.LANE_COLORS[p.layer]) || '#c3ccff');
    el.deckBDisc.innerHTML = SDJ.Vinyl.proposal({
      seed: (engine.song.seed + (engine.song.vprop || 0)) >>> 0,
      lane: p.layer,
      kind: p.kind,
      colour: colour,
      // the LIVE genome holds the applied pitch, so a rework's acetate shows
      // the NEW cut — exactly the ring Deck A gains if it's approved
      variant: (engine.song.genome.variant && engine.song.genome.variant[p.layer]) || 0,
      glyph: KIND_GLYPHS[p.kind] || '≈',
    });
  }

  // The platters only turn while their record is actually sounding.
  function setDeckSpin() {
    const liveAudio = nowPlaying.kind === 'live' && running;
    if (el.deckAPlatter) el.deckAPlatter.classList.toggle('spin', liveAudio);
    if (el.deckBPlatter) el.deckBPlatter.classList.toggle('spin', liveAudio && !!pitching);
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
  // the ctx we hand it. We append it ONLY to the audio string, never to
  // render(), so the code panel and crate saves stay clean (and never spawn
  // Strudel's full-screen fallback canvas). Per-layer .color() (added in
  // render) gives each sound its own lane.
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
    if (menuAmbient.on) { stopMenuAmbient(); return; }
    if (remixPlaying) stopRemix();
    else if (previewing >= 0) stopPreview();
    else if (running) stopSet();
    else stopAll();
  }

  function setNowPlaying(kind, name) {
    nowPlaying = { kind: kind || null, name: name || '' };
    refreshTransport();
    setDeckSpin();
  }

  function refreshTransport() {
    if (!el.transport) return;
    if (!nowPlaying.kind) { el.transport.hidden = true; return; }
    el.transport.hidden = false;
    const token = nowPlaying.kind === 'preview' ? 'preview'
      : nowPlaying.kind === 'remix' ? 'remix'
      : nowPlaying.kind === 'menu' ? 'ambient'
      : nowPlaying.kind === 'export' ? 'export'
      : 'live';
    if (el.tpKind) { el.tpKind.textContent = token; el.tpKind.className = 'tp-kind ' + token; }
    if (el.tpName) el.tpName.textContent = nowPlaying.name || '—';
  }

  // ---- the pressing: saving is cutting this track to a record -------------
  // Save never banks silently. The modal shows the record about to be pressed
  // (its accreted colours), lets you imprint a name, and states exactly which
  // version is banked: always the APPROVED track — an un-judged pitch on Deck B
  // is left off (engine.renderCommitted renders from the snapshot).

  function onSaveCurrent() {
    if (!running || !engine.song) {
      setStatus('Start a set first, then press a version you like.');
      return;
    }
    openPress('button');
  }

  function openPress(origin) {
    if (!engine.song) return;
    pressOrigin = origin || 'button';
    const st = engine.state();
    const n = (committedActive() || []).filter(Boolean).length;
    if (el.pressName) el.pressName.value = engine.song.name || '';
    if (el.pressMeta) {
      el.pressMeta.textContent = st.key + ' ' + st.scaleType + ' · ' + st.bpm + ' BPM' +
        (st.genreLabel ? ' · ' + st.genreLabel : '') + ' · ' + n + '/7 parts';
    }
    if (el.pressVersion) {
      el.pressVersion.textContent = (engine.song.pending && pitching && pitching !== 'save')
        ? 'Pressing the approved version — the un-judged pitch on Deck B is left off.'
        : 'Pressing the track exactly as it sounds now.';
    }
    setPressFormat('arranged'); // the shippable default; Loop is one tap away
    renderPressDisc();
    if (el.pressModal) { el.pressModal.hidden = false; el.pressModal.classList.remove('pressed'); }
    if (el.pressName && el.pressName.focus) el.pressName.focus();
  }

  // The label updates as you type — the name is imprinted live.
  function renderPressDisc() {
    if (!el.pressDisc || !SDJ.Vinyl || !engine.song) return;
    const typed = el.pressName && el.pressName.value.trim();
    el.pressDisc.innerHTML = committedDisc(typed || engine.song.name);
  }

  function confirmPress() {
    if (!engine.song) return;
    const typed = el.pressName && el.pressName.value.trim();
    const name = typed || engine.song.name;
    engine.song.name = name;
    const code = (pressFormat === 'arranged' && engine.renderArrangedCommitted)
      ? engine.renderArrangedCommitted()
      : (engine.renderCommitted ? engine.renderCommitted() : engine.render());
    saveToCrate('◉ cut “' + name + '” as a dubplate' +
      (pressFormat === 'arranged' ? ' (arranged)' : ' (loop)'), 'saved', code);
    setStatus('Cut “' + name + '” — it’s in your crate.');
    const fromPrompt = pressOrigin === 'prompt';
    pressOrigin = null;
    if (el.pressModal) {
      el.pressModal.classList.add('pressed'); // the disc drops away into the crate
      setTimeout(() => { if (el.pressModal) el.pressModal.hidden = true; }, 520);
    }
    if (fromPrompt) {
      logEvent('🎧 next up: fresh track');
      freshTrack('next'); // the track's done — roll a fresh one
    } else {
      updateUI();         // keep working; the header wears the new name
    }
  }

  // Loop vs arranged: the raw bar as it plays now, or the 36-bar journey
  // (intro → build → peak → strip → peak → outro) renderArranged builds.
  function setPressFormat(fmt) {
    pressFormat = fmt === 'loop' ? 'loop' : 'arranged';
    if (el.pressFull) el.pressFull.classList.toggle('on', pressFormat === 'arranged');
    if (el.pressLoop) el.pressLoop.classList.toggle('on', pressFormat === 'loop');
    if (el.pressFormatHint) {
      el.pressFormatHint.textContent = pressFormat === 'arranged'
        ? 'a 36-bar journey: intro → build → peak → strip → peak → outro'
        : 'the raw loop, exactly as it plays now';
    }
  }

  function cancelPress() {
    const fromPrompt = pressOrigin === 'prompt';
    pressOrigin = null;
    if (el.pressModal) el.pressModal.hidden = true;
    if (fromPrompt) {
      saveCooldown = (engine.song.vprop || 0) + SAVE_SNOOZE; // snooze the prompt
      pushFeed('→', 'kept going', 'declined the press', 'flat');
      livePitch();
    }
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

  // The record as a vinyl disc — the face a record wears everywhere it can spin
  // (crate rows, the remix platter). The square cover stays for the shelf's
  // sleeves and as a fallback if vinyl.js didn't load.
  function discFor(entry) {
    return SDJ.Vinyl ? SDJ.Vinyl.forEntry(entry) : coverFor(entry);
  }

  function saveToCrate(logMsg, source, codeOverride) {
    const s = engine.song;
    if (!s) return;
    // Bank the COMMITTED genome: an un-judged pitch is Deck B's business, not
    // the record's. (pitching === 'save' means nothing is pending mid-judge.)
    const g = (s.pending && pitching && pitching !== 'save') ? s.pending.snapshot : s.genome;
    const st = engine.state();
    const code = codeOverride
      || (engine.renderCommitted ? engine.renderCommitted() : engine.render());
    const crate = loadCrate();
    // dedupe: don't bank the very same code twice in a row (this stops an
    // unchanged track piling up duplicates).
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
      // approve-rate, not the old crowd-EMA (which never moves in turn-based
      // mode and stamped every record "50% hype"). Null when nothing was judged.
      approval: (s.voteLog && s.voteLog.length)
        ? Math.round((s.voteLog.filter((v) => v.v === 'up').length / s.voteLog.length) * 100)
        : null,
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
        '<li class="crate-empty">No records yet. Go live and press a track — every save cuts a ' +
        'real record with its own colours and label, and it lands here in your vault.</li>';
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
        '<div class="crate-art">' + discFor(entry) + '</div>' +
        '<div class="crate-body">' +
          '<div class="crate-meta"><strong>' + escapeHtml(entry.name || 'Untitled') + '</strong>' +
          '<span>' + escapeHtml((entry.key || '') + ' ' + (entry.scaleType || '')) + ' · ' + entry.bpm + ' BPM' +
          (entry.genreLabel ? ' · ' + escapeHtml(entry.genreLabel) : '') + '</span></div>' +
          '<div class="crate-tags">' +
            (entry.approval != null ? '<span class="crate-hype">' + entry.approval + '% kept</span>' : '') +
            (src ? '<span class="crate-src">' + escapeHtml(src) + '</span>' : '') +
            (when ? '<span class="crate-when">' + when + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="crate-actions">' +
          '<button data-act="' + (playing ? 'stop' : 'play') + '" data-i="' + i + '" title="' + (playing ? 'Stop' : 'Spin it') + '">' + (playing ? '⏹' : '▶') + '</button>' +
          '<button data-act="remix" data-i="' + i + '" title="DJ this record in the Remix lab">🎚</button>' +
          '<button data-act="mp3" data-i="' + i + '" title="Export as MP3">⬇</button>' +
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
        else if (act === 'mp3') exportTrackMp3(i, b);
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
    const name = window.prompt('Re-imprint the label', entry.name || '');
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

  // ---- MP3 export: render a crate record to an audio file ------------------
  // Web Audio can't tap ctx.destination directly and Strudel exposes no master
  // node, so installAudioTap() (called at boot) patches AudioNode.connect once to
  // remember every node feeding the destination. To export we fan those masters
  // into a MediaStreamDestination, play the record once through in REAL TIME,
  // record the stream, then encode it to MP3 with lamejs — loaded on demand, so
  // the core app stays dependency-free and the encoder only loads when you export.
  const audioTap = { masters: new Set(), node: null, busy: false };

  function installAudioTap() {
    if (typeof AudioNode === 'undefined' || AudioNode.prototype.__sdjTap) return;
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest) {
      const ret = orig.apply(this, arguments);
      try {
        if (dest && dest.context && dest === dest.context.destination) {
          audioTap.masters.add(this);
          if (audioTap.node) orig.call(this, audioTap.node); // also feed a live capture
        }
      } catch (e) { /* ignore */ }
      return ret;
    };
    AudioNode.prototype.__sdjTap = orig;
  }

  function exportCps(entry) {
    const m = /setcps\(([0-9.]+)\)/.exec((entry.code || '').split('\n')[0] || '');
    return m ? parseFloat(m[1]) : (entry.cps || 0.5);
  }
  function safeFile(name) {
    return String(name || 'record').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'record';
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Export one crate record as an MP3. Renders in REAL TIME (Strudel has no
  // offline render): an arranged track is its full 36-bar journey, a loop gets
  // 16 bars. btn is the clicked button, disabled while the render runs.
  async function exportTrackMp3(i, btn) {
    const entry = loadCrate()[i];
    if (!entry || !entry.code) return;
    if (audioTap.busy) { setStatus('Already rendering an MP3 — hang on.'); return; }
    if (typeof MediaRecorder === 'undefined') { setStatus('MP3 export needs a browser with MediaRecorder.'); return; }
    audioTap.busy = true;
    if (btn) btn.disabled = true;
    try {
      setStatus('Rendering “' + (entry.name || 'record') + '” to MP3 (real time)…');
      if (!(await ensureAudio())) throw new Error('audio engine unavailable');
      if (running) stopSet();
      if (previewing >= 0) stopPreview();
      if (remixPlaying) stopRemix();
      stopMenuAmbient();
      const ctx = audioTap.masters.size ? [...audioTap.masters][0].context
        : (typeof window.getAudioContext === 'function' ? window.getAudioContext() : null);
      if (!ctx) throw new Error('no audio context to capture');
      const cps = exportCps(entry);
      const bars = /arrange\(/.test(entry.code) ? 36 : 16;
      const seconds = bars / (cps || 0.5) + 1.5; // a tail so reverb rings out
      audioTap.node = ctx.createMediaStreamDestination();
      audioTap.masters.forEach((m) => { try { m.connect(audioTap.node); } catch (e) { /* ignore */ } });
      const chunks = [];
      const rec = new MediaRecorder(audioTap.node.stream,
        MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      rec.start();
      play(entry.code, 'export', entry.name); // real playback, captured by the tap
      await new Promise((r) => setTimeout(r, Math.round(seconds * 1000)));
      stopAll();
      rec.stop();
      await stopped;
      setStatus('Encoding “' + (entry.name || 'record') + '” to MP3…');
      const buffer = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const mp3 = await encodeMp3(buffer);
      downloadBlob(mp3, safeFile(entry.name) + '.mp3');
      logEvent('⬇ exported “' + (entry.name || 'record') + '” to MP3');
      setStatus('Exported “' + (entry.name || 'record') + '” as MP3.');
    } catch (err) {
      console.error('MP3 export failed:', err);
      setStatus('MP3 export failed — ' + (err && err.message ? err.message : err));
    } finally {
      if (audioTap.node) {
        audioTap.masters.forEach((m) => { try { m.disconnect(audioTap.node); } catch (e) { /* ignore */ } });
        audioTap.node = null;
      }
      audioTap.busy = false;
      if (btn) btn.disabled = false;
    }
  }

  let lamePromise = null;
  function loadLame() {
    if (window.lamejs) return Promise.resolve(window.lamejs);
    if (lamePromise) return lamePromise;
    lamePromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      s.onload = () => (window.lamejs ? res(window.lamejs) : rej(new Error('MP3 encoder failed to load')));
      s.onerror = () => rej(new Error('could not load the MP3 encoder (offline?)'));
      document.head.appendChild(s);
    });
    return lamePromise;
  }
  function floatToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i];
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  async function encodeMp3(buffer) {
    const lame = await loadLame();
    const channels = Math.min(2, buffer.numberOfChannels);
    const enc = new lame.Mp3Encoder(channels, buffer.sampleRate, 128);
    const left = floatToInt16(buffer.getChannelData(0));
    const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : null;
    const block = 1152, out = [];
    for (let p = 0; p < left.length; p += block) {
      const l = left.subarray(p, p + block);
      const buf = right ? enc.encodeBuffer(l, right.subarray(p, p + block)) : enc.encodeBuffer(l);
      if (buf.length) out.push(new Uint8Array(buf));
    }
    const tail = enc.flush();
    if (tail.length) out.push(new Uint8Array(tail));
    return new Blob(out, { type: 'audio/mpeg' });
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
    setStatus('Spinning “' + entry.name + '”.');
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

  // Deck B's record shelf: a strip of sleeves — click one to load its disc.
  function renderRemixShelf() {
    if (!el.remixShelf) return;
    const crate = loadCrate();
    const curId = remixRecord ? (remixRecord.id || remixRecord.code) : '';
    el.remixShelf.innerHTML = '';
    if (!crate.length) {
      const empty = document.createElement('div');
      empty.className = 'remix-shelf-empty';
      empty.textContent = 'No dubplates yet — cut some first.';
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
    if (el.remixArt) el.remixArt.innerHTML = discFor(remixRecord); // the disc on the platter
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
      genome: base.genome ? JSON.parse(JSON.stringify(base.genome)) : null, // keep the disc's rings
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
    logEvent('◉ cut the remix “' + entry.name + '” as a dubplate');
    setStatus('Cut the remix as a dubplate.');
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
    const committed = committedActive();
    Array.from(el.stageChips.children).forEach((c, i) => {
      c.classList.toggle('on', !!(committed && committed[i]));
      const isPitch = i === pitchLayer;
      c.classList.toggle('pitching', isPitch);
      if (isPitch && SDJ.LANE_COLORS) c.style.setProperty('--pitch', SDJ.LANE_COLORS[i]);
    });
    renderDeckA(); // Deck A wears the committed record — rings accrete as parts land
  }

  // ---- the DJ's status + a running approve/skip history ------------------

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

  // ---- live code panel (the drawer) --------------------------------------

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
  // One index.html, four views. The engine, audio and crate all live in this
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
    if (name === 'menu') { updateMenu(); maybeStartMenuAmbient(); } else { stopMenuAmbient(); }
    // the signal-bloom menu canvas only animates while the menu is on screen
    if (SDJ.Menu) { if (name === 'menu') SDJ.Menu.enter(); else SDJ.Menu.leave(); }
  }

  function onRoute() {
    showView(currentRoute());
  }

  // ---- menu ambience: a random crate record spins quietly under the menu ----
  // Autoplay policy means audio can't begin until a user gesture, so on the menu
  // we either start straight away (audio already unlocked) or arm a one-shot
  // listener that unlocks + starts on the first click/key. Leaving the menu or
  // starting any real source stops it (see showView / stopPlayback). It never
  // plays over a live set — maybeStart bails if anything else owns the audio.
  const menuAmbient = { on: false, armed: false };

  function ambientProgram(entry) {
    const code = entry.code || '';
    const nl = code.indexOf('\n');
    let cps = 'setcps(' + (entry.cps || 0.5) + ')', body = code;
    if (nl >= 0 && code.slice(0, nl).indexOf('setcps') >= 0) { cps = code.slice(0, nl); body = code.slice(nl + 1); }
    return cps + '\n(' + body.trim() + ').gain(0.3)'; // duck the whole mix down low
  }
  function maybeStartMenuAmbient() {
    if (menuAmbient.on) return;
    if (currentRoute() !== 'menu') return;
    if (running || remixPlaying || previewing >= 0) return; // something already owns the audio
    const crate = loadCrate();
    if (!crate.length) return;
    if (!started) { armMenuAmbient(); return; } // wait for a gesture to unlock audio
    const entry = crate[Math.floor(Math.random() * crate.length)];
    menuAmbient.on = true;
    play(ambientProgram(entry), 'menu', entry.name);
    setStatus('♪ “' + (entry.name || 'a record') + '” drifting under the menu — pick a mode to dive in.');
  }
  function armMenuAmbient() {
    if (menuAmbient.armed) return;
    menuAmbient.armed = true;
    const unlock = async () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      menuAmbient.armed = false;
      if (currentRoute() !== 'menu') return; // navigated away before the gesture resolved
      await ensureAudio();
      maybeStartMenuAmbient();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }
  function stopMenuAmbient() {
    if (!menuAmbient.on) return;
    menuAmbient.on = false;
    stopAll();
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
  // the A/B crossfader (agent-native): blend the pitch against the committed track
  SDJ.ab = {
    set: setAbMix,
    mix: function () { return abMix; },
  };
  // the pressing flow (agent-native): open / confirm / cancel the save moment
  SDJ.press = {
    open: openPress,
    confirm: confirmPress,
    cancel: cancelPress,
    format: setPressFormat, // 'arranged' | 'loop'
    isOpen: function () { return !!(el.pressModal && !el.pressModal.hidden); },
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
  SDJ.exportMp3 = exportTrackMp3; // render a crate record to MP3 (agent-native)
  SDJ.menuAmbient = { start: maybeStartMenuAmbient, stop: stopMenuAmbient, playing: function () { return menuAmbient.on; } };

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
