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

  // ---- A/B switch + press-modal state ------------------------------------
  let abMix = 1;          // A/B switch: 0 = Deck A (committed) only, 1 = full pitch
  let playerVizInst = null; // the top-bar reactive strip player (shared visualiser)
  let visualInst = null;    // the full-screen pure-visual overlay (shared visualiser)
  let pressOrigin = null; // 'button' | 'prompt' while the pressing modal is open
  let pressFormat = 'arranged'; // what a press banks: 'arranged' (36-bar track) | 'loop'

  // ---- remix deck state (a saved record looped as a bed + vocal/overlays) --
  let remixPlaying = false; // the remix deck is live (external transport checks this)
  let vocalsLoaded = false; // dirt-samples banks loaded with the kit at boot

  // The Authentic Deck: a two-deck remix console. One idea — the phrase is the
  // clock; ARM transitions, stems, filters and paddles all snap to a 32-bar line.
  const REMIX_PHRASE_BARS = 32, REMIX_GROUP_BARS = 8;
  const remix = {
    cross: 0,   // 0 = full A, 1 = full B (equal-power)
    nudge: 0,   // ±8% master tempo trim
    decks: {
      a: { rec: null, trim: 1, stems: null, filter: 0 },
      b: { rec: null, trim: 1, stems: null, filter: 0 },
    },
    paddles: { stutter: false, gate: false, echo: false }, // hold-to-fire
    playStart: 0, currentBar: 0, barFrac: 0,               // phrase clock
    armed: null, boundary: 16, autofade: false,            // quantised transition
  };

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
      'abWrap', 'abSwitch',
      // the top-bar live player + the full-screen pure-visual overlay
      'playerViz', 'visualStage', 'visualCanvas',
      // the pressing modal (the save moment)
      'pressModal', 'pressDisc', 'pressName', 'pressMeta', 'pressVersion',
      'pressConfirm', 'pressCancel', 'pressLoop', 'pressFull', 'pressFormatHint',
      // set-log controls
      'logExport', 'logClear', 'logStat',
      // app-shell menu
      'menuLiveState', 'menuCrateCount',
      // crate library tools
      'crateSort', 'crateExport', 'crateImport',
      // remix console — the Authentic Deck (two-deck DJ console)
      'remixShelf', 'remixRoll', 'remixStart', 'remixSave', 'remixTimeline',
      'readBar', 'readPhrase', 'readNext', 'readArmed', 'mixNow', 'droppedMsg',
      'armA', 'armB', 'boundarySelect', 'autofadeCheck',
      'platterA', 'metaA', 'stemStripA', 'filterA', 'filterAVal',
      'platterB', 'metaB', 'stemStripB', 'filterB', 'filterBVal',
      'cross', 'trimA', 'trimAVal', 'trimB', 'trimBVal',
      'swapAdrumsBmelody', 'swapAmelodyBdrums',
      'nudge', 'nudgeVal', 'tempo', 'padStutter', 'padGate', 'padEcho',
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
    // the A/B switch: flip the pitched change on/off against the committed track
    if (el.abSwitch) el.abSwitch.addEventListener('change', onAbSwitch);
    // the full-screen pure-visual overlay closes on a click anywhere
    if (el.visualStage) el.visualStage.addEventListener('click', closeVisuals);
    // the top-bar live player — the shared reactive visualiser as a compact strip
    playerVizInst = SDJ.Visualiser ? SDJ.Visualiser.mount(el.playerViz, { mode: 'strip' }) : null;
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
    // remix console — the Authentic Deck (two-deck DJ console)
    initRemix();
    window.addEventListener('hashchange', onRoute);
    buildControls();
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

  // ---- the A/B switch: hear the pitch against the committed track ----
  // Deck A is the committed track, Deck B the pitched change. The switch flips
  // engine.renderAB(mix) between the two ends — 0 = track only, 1 = full change.
  // It's an on/off flip, not a blend: you either hear the change or you don't.

  function resetAb() {
    abMix = 1;
    reflectAb();
  }

  function reflectAb() {
    if (el.abSwitch) el.abSwitch.checked = abMix >= 0.5;
    if (el.deckAPlatter) el.deckAPlatter.classList.toggle('hot', abMix < 0.5);
    if (el.deckBPlatter) el.deckBPlatter.classList.toggle('hot', abMix >= 0.5);
  }

  function setAbMix(v) {
    abMix = clamp(v, 0, 1);
    reflectAb();
    evaluateAb();
  }

  // Flip → hear it or don't. Snaps to Deck A (0) or Deck B (1), no partial blend.
  function onAbSwitch() {
    if (!el.abSwitch) return;
    setAbMix(el.abSwitch.checked ? 1 : 0);
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
    if (!nowPlaying.kind) { el.transport.hidden = true; if (playerVizInst) playerVizInst.stop(); return; }
    el.transport.hidden = false;
    // the top-bar player's reactive strip runs while something's playing (never
    // on the menu, whose own full-screen canvas owns the picture there)
    if (playerVizInst && currentRoute() !== 'menu') playerVizInst.start();
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
    const loopCode = engine.renderCommitted ? engine.renderCommitted() : engine.render();
    const code = (pressFormat === 'arranged' && engine.renderArrangedCommitted)
      ? engine.renderArrangedCommitted()
      : loopCode;
    saveToCrate('◉ cut “' + name + '” as a dubplate' +
      (pressFormat === 'arranged' ? ' (arranged)' : ' (loop)'), 'saved', code,
      pressFormat === 'arranged' ? loopCode : null);
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

  function saveToCrate(logMsg, source, codeOverride, loopCodeOverride) {
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
      loopCode: loopCodeOverride || null,
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
    ['a', 'b'].forEach((w) => {
      const d = remix.decks[w];
      if (d.rec && (d.rec.id || d.rec.code) === (entry.id || entry.code)) {
        d.rec.name = trimmed;
        const meta = w === 'a' ? el.metaA : el.metaB;
        if (meta) meta.textContent = deckMetaText(d.rec);
      }
    });
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
          if (sharedAnalyser) { try { orig.call(this, sharedAnalyser); } catch (e) { /* ignore */ } }
        }
      } catch (e) { /* ignore */ }
      return ret;
    };
    AudioNode.prototype.__sdjTap = orig;
  }

  // A shared AnalyserNode tees off the master bus so the visualiser can react to
  // the REAL audio (menu ambience, a live set, a remix). It's fed by the same
  // connect() tap that collects the masters (above), plus any masters that already
  // exist when it's first created. Passive — it never routes onward to the
  // destination, so it can't change what you hear. Read via SDJ.Visualiser.read().
  let sharedAnalyser = null;
  function analyserContext() {
    if (audioTap.masters.size) {
      for (const m of audioTap.masters) { if (m && m.context) return m.context; }
    }
    return (typeof window.getAudioContext === 'function') ? window.getAudioContext() : null;
  }
  function getAnalyser() {
    const ctx = analyserContext();
    if (!ctx || typeof ctx.createAnalyser !== 'function') return sharedAnalyser;
    if (!sharedAnalyser || sharedAnalyser.context !== ctx) {
      try {
        sharedAnalyser = ctx.createAnalyser();
        sharedAnalyser.fftSize = 2048;
        sharedAnalyser.smoothingTimeConstant = 0.82;
        audioTap.masters.forEach((m) => { try { m.connect(sharedAnalyser); } catch (e) { /* ignore */ } });
      } catch (e) { sharedAnalyser = null; }
    }
    return sharedAnalyser;
  }
  SDJ.getAnalyser = getAnalyser;

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

  // Load a crate record onto the Remix deck (B) and jump there.
  function sendToRemix(i) {
    const entry = loadCrate()[i];
    if (!entry) return;
    loadRemixDeck('b', entry);
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

  // ---- remix: the Authentic Deck — a two-deck DJ console -----------------
  // The union of three winning design spikes on one chassis, one idea: the
  // phrase is the clock, everything snaps to it. Both decks load a dubplate
  // from the shelf; a 32-bar phrase timeline drives quantised ARM transitions;
  // each deck splits into stems (mute/solo/SWAP) and owns a filter sweep; three
  // hold-to-fire paddles ride the master. Because the app composed every record
  // it can split it for free — muting BASS IS the bass-swap, no fake EQ.
  //
  // It routes through the shared single-source transport (play/stopAll) as kind
  // 'remix', so the pianoroll, transport header and one-source-at-a-time rule
  // all apply. Committed genome → .color() tags → stem groups (see dj.js
  // LANE_COLORS: kick/hats/clap → DRUMS, bass → BASS, chords/lead/air, fill →
  // DRUMS). Same tags render() writes are what we split on.
  const REMIX_COLOUR_GROUP = {
    '#f43f7d': 'DRUMS', '#2ee6d6': 'DRUMS', '#ff9a1f': 'DRUMS', '#c3ccff': 'DRUMS',
    '#a64dff': 'BASS', '#2edb8b': 'CHORDS', '#ff4dd2': 'LEAD', '#4da6ff': 'AIR',
  };
  const REMIX_GROUP_COLOUR = {
    DRUMS: '#2ee6d6', BASS: '#a64dff', CHORDS: '#2edb8b', LEAD: '#ff4dd2', AIR: '#4da6ff', OTHER: '#9d8fc7',
  };
  const REMIX_GROUP_ORDER = ['DRUMS', 'BASS', 'CHORDS', 'LEAD', 'AIR'];

  // clock + ARM/autofade + throttle state
  let remixRaf = 0, remixEvalTimer = 0, remixLastEval = 0, remixDroppedTimer = 0;
  let remixLastTotalBars = 0;
  let autofadeActive = false, autofadeStart = 0, autofadeFrom = 0, autofadeTarget = 0, autofadeDuration = 0;

  const rx2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

  function masterRec() { return remix.decks.a.rec || remix.decks.b.rec || null; }
  function masterCps() {
    const rec = masterRec(); const base = (rec && rec.cps) || 0.5;
    return Math.round(base * (1 + remix.nudge / 100) * 1000) / 1000;
  }
  function remixName() {
    const a = remix.decks.a.rec, b = remix.decks.b.rec;
    if (a && b) return a.name + ' × ' + b.name;
    return (a || b || {}).name || 'Remix';
  }
  function deckMetaText(rec) {
    return (rec.name || 'Untitled') + ' · ' + ((rec.key || '') + ' ' + (rec.scaleType || '')).trim() + ' · ' + (rec.bpm || '?') + ' BPM';
  }

  // Equal-power crossfade × trim, scaled to ~0.95 (2dp) — chained .gain() multiply.
  function deckGain(which) {
    const m = remix.cross;
    const curve = which === 'a' ? Math.cos(m * Math.PI / 2) : Math.sin(m * Math.PI / 2);
    return Math.round(curve * 0.95 * remix.decks[which].trim * 100) / 100;
  }
  function stripCps(code) {
    const nl = code.indexOf('\n');
    if (nl >= 0 && code.slice(0, nl).indexOf('setcps') >= 0) return code.slice(nl + 1);
    return code;
  }
  // centre = open; negative → LP sweep down to ~200 Hz; positive → HP sweep up.
  function applyDeckFilter(bed, filter) {
    if (filter < 0) return bed + '.lpf(' + Math.round(200 * Math.pow(90, 1 + filter)) + ')';
    if (filter > 0) return bed + '.hpf(' + Math.round(200 + filter * 3000) + ')';
    return bed;
  }

  // Split a record's top-level stack(...) into its lane parts, each tagged with
  // its .color() so lanes can be grouped into stems. Depth/quote-aware so a comma
  // or paren inside a mini-notation string never splits a lane.
  function splitStack(code) {
    const nl = code.indexOf('\n');
    let body = code;
    if (nl >= 0 && code.slice(0, nl).indexOf('setcps') >= 0) body = code.slice(nl + 1);
    const open = body.indexOf('stack('); if (open < 0) return null;
    let i = open + 6, depth = 1, inStr = false, q = '', start = i;
    const parts = [];
    for (; i < body.length && depth > 0; i++) {
      const ch = body[i];
      if (inStr) { if (ch === q) inStr = false; continue; }
      if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { parts.push(body.slice(start, i)); break; } }
      else if (ch === ',' && depth === 1) { parts.push(body.slice(start, i)); start = i + 1; }
    }
    return parts.map((p) => {
      const s = p.trim(); if (!s) return null;
      const mc = s.match(/\.color\("(#[0-9a-fA-F]{3,8})"\)/);
      return { code: s, colour: mc ? mc[1].toLowerCase() : null };
    }).filter(Boolean);
  }

  // Build a deck's stem model. Needs ≥2 recognised coloured lanes to be
  // splittable — an arranged/remix pressing (arrange(...) or already-nested) has
  // no top-level coloured stack, so it falls back to a single FULL mute toggle.
  function buildStems(rec) {
    if (!rec || !rec.code) return null;
    const parts = splitStack(rec.loopCode || rec.code);
    if (!parts || !parts.length) return { splittable: false, muted: false };
    const tagged = parts.filter((p) => p.colour && REMIX_COLOUR_GROUP[p.colour]);
    if (tagged.length < 2) return { splittable: false, muted: false };
    const groups = {};
    parts.forEach((p) => {
      const grp = (p.colour && REMIX_COLOUR_GROUP[p.colour]) || 'OTHER';
      (groups[grp] = groups[grp] || []).push(p.code);
    });
    const present = {};
    REMIX_GROUP_ORDER.forEach((g) => { if (groups[g]) present[g] = groups[g]; });
    if (groups.OTHER) present.OTHER = groups.OTHER;
    const muted = {}, solo = {};
    Object.keys(present).forEach((g) => { muted[g] = false; solo[g] = false; });
    return { splittable: true, groups: present, muted: muted, solo: solo };
  }

  // The lane strings a deck should sound right now, honouring mute/solo.
  function audibleLayers(which) {
    const st = remix.decks[which].stems;
    if (!st) return null;
    if (!st.splittable) return st.muted ? null : ['__FULL__'];
    const hasSolo = Object.keys(st.solo).some((g) => st.solo[g]);
    const out = [];
    Object.keys(st.groups).forEach((g) => {
      const on = hasSolo ? st.solo[g] : !st.muted[g];
      if (on) st.groups[g].forEach((layer) => out.push(layer));
    });
    return out.length ? out : null;
  }

  // Compose both decks + filters + gains + hold-to-fire paddles into ONE balanced
  // program. Balanced by construction (the test fuzzes this across control moves).
  function composeRemix() {
    if (!masterRec()) return null;
    const layers = [];
    ['a', 'b'].forEach((which) => {
      const d = remix.decks[which];
      if (!d.rec || !d.rec.code) return;
      const g = deckGain(which);
      if (g <= 0) return;
      const st = d.stems;
      if (!st) return;
      let bed;
      if (!st.splittable) {
        if (st.muted) return;
        bed = '(' + stripCps(String(d.rec.loopCode || d.rec.code)).trim() + ')';
      } else {
        const audible = audibleLayers(which);
        if (!audible || !audible.length) return;
        if (audible[0] === '__FULL__') bed = '(' + stripCps(String(d.rec.loopCode || d.rec.code)).trim() + ')';
        else if (audible.length === 1) bed = '(' + audible[0] + ')';
        else bed = '(stack(\n    ' + audible.join(',\n    ') + '\n  ))';
      }
      bed = applyDeckFilter(bed, d.filter);
      bed += '.gain(' + rx2(g) + ')';
      layers.push(bed);
    });
    if (!layers.length) return null;

    const p = remix.paddles;
    if (p.stutter || p.gate || p.echo) {
      const inner = layers.length === 1 ? layers[0] : 'stack(\n    ' + layers.join(',\n    ') + '\n  )';
      let fx;
      if (p.stutter) fx = inner + '.ply("4")';
      else if (p.gate) fx = inner + '.struct("1 0 1 0 1 0 1 0")';
      else fx = inner + '.delay(0.4).delaytime(0.1875).delayfeedback(0.6).room(0.3)';
      return 'setcps(' + masterCps() + ')\nstack(\n  ' + fx + '\n)';
    }
    return 'setcps(' + masterCps() + ')\nstack(\n  ' + layers.join(',\n  ') + '\n)';
  }

  // ---- transport: through the shared single-source play/stopAll -----------
  function remixDoEval() {
    remixLastEval = Date.now();
    if (!remixPlaying) return;
    const code = composeRemix();
    play(withRemixRoll(code || 'silence'), 'remix', remixName());
  }
  // Throttled to ~150ms so working a fader (or an autofade) can't thrash evaluate.
  function remixRefresh() {
    if (el.cross) el.cross.value = remix.cross; // ARM / autofade can move it
    updateRemixPlatters();
    updateRemixTempo();
    if (!remixPlaying) return;
    clearTimeout(remixEvalTimer);
    const wait = Math.max(0, 150 - (Date.now() - remixLastEval));
    remixEvalTimer = setTimeout(remixDoEval, wait);
  }
  // Paddles are momentary + user-triggered — evaluate immediately, no throttle.
  function remixPaddleRefresh() {
    if (!remixPlaying) return;
    const code = composeRemix();
    if (code) play(withRemixRoll(code), 'remix', remixName());
  }

  async function remixPlay() {
    if (!masterRec()) { setStatus('Pull a sleeve onto a deck first.'); return; }
    if (remixPlaying) return;
    setStatus('Waking the audio engine…');
    if (!(await ensureAudio())) return;
    if (running) stopSet();          // one source at a time
    if (previewing >= 0) stopPreview();
    stopMenuAmbient();
    remixPlaying = true;
    remix.playStart = Date.now();
    remixLastEval = 0;
    sizeRemixRoll();
    remixDoEval();
    startRemixClock();
    updateRemixButtons();
    updateRemixPlatters();
    setStatus('Live. ARM a transition, or work the stems, filters and paddles.');
  }
  function stopRemix() {
    if (!remixPlaying) return;
    remixPlaying = false;
    clearArm();
    autofadeActive = false;
    clearTimeout(remixEvalTimer);
    stopRemixClock();
    stopAll();
    clearRemixRoll();
    updateRemixButtons();
    updateRemixPlatters();
    updateRemixReadouts();
    setStatus('Remix stopped.');
  }

  // ---- phrase clock: one cycle = one bar; 32 bars wrap the phrase ---------
  function barPosition() {
    const elapsed = (Date.now() - remix.playStart) / 1000;
    const barLen = 1 / masterCps();
    const total = elapsed / barLen;
    const wrapped = total % REMIX_PHRASE_BARS;
    remix.currentBar = Math.floor(wrapped);
    remix.barFrac = wrapped - remix.currentBar;
    return total;
  }
  function boundaryIn(interval) {
    const cur = remix.currentBar + remix.barFrac;
    return (Math.floor(cur / interval) + 1) * interval - cur;
  }
  function startRemixClock() {
    stopRemixClock();
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      if (!remixPlaying) return;
      const total = barPosition();
      tickArm(total);
      updateRemixReadouts();
      drawRemixTimeline();
      remixRaf = requestAnimationFrame(tick);
    };
    remixRaf = requestAnimationFrame(tick);
  }
  function stopRemixClock() { if (remixRaf) { cancelAnimationFrame(remixRaf); remixRaf = 0; } }

  // ---- ARM: a quantised transition that fires on the phrase line ----------
  function tickArm(total) {
    if (!remix.armed && !autofadeActive) { remixLastTotalBars = total; return; }
    const b = remix.boundary;
    if (autofadeActive) {
      const t = Math.min(1, (total - autofadeStart) / autofadeDuration);
      const next = autofadeFrom + t * (autofadeTarget - autofadeFrom);
      const changed = Math.abs(next - remix.cross) > 0.005;
      remix.cross = next;
      if (changed) remixRefresh();
      if (t >= 1) { remix.cross = autofadeTarget; autofadeActive = false; flashDropped(); remixRefresh(); }
      remixLastTotalBars = total; return;
    }
    if (Math.floor(total / b) > Math.floor(remixLastTotalBars / b)) {
      const target = remix.armed === 'a' ? 0 : 1;
      if (remix.autofade) {
        autofadeActive = true; autofadeStart = total; autofadeFrom = remix.cross;
        autofadeTarget = target; autofadeDuration = b; clearArm();
        setStatus('Auto-fading to deck ' + (target === 0 ? 'A' : 'B') + ' over ' + b + ' bars…');
      } else {
        remix.cross = target; clearArm(); flashDropped(); remixRefresh();
      }
    }
    remixLastTotalBars = total;
  }
  function flashDropped() {
    if (!el.droppedMsg) return;
    el.droppedMsg.classList.add('show');
    clearTimeout(remixDroppedTimer);
    remixDroppedTimer = setTimeout(() => el.droppedMsg.classList.remove('show'), 1800);
  }
  function clearArm() {
    remix.armed = null;
    if (el.armA) el.armA.classList.remove('armed');
    if (el.armB) el.armB.classList.remove('armed');
  }
  function remixArm(target) {
    if (target == null) { clearArm(); autofadeActive = false; setStatus('ARM cleared.'); updateRemixReadouts(); return; }
    if (autofadeActive) { autofadeActive = false; clearArm(); setStatus('Auto-fade cancelled.'); return; }
    if (remix.armed === target) { clearArm(); setStatus('ARM cleared.'); updateRemixReadouts(); return; }
    remix.armed = target;
    if (remixPlaying) remixLastTotalBars = barPosition();
    if (el.armA) el.armA.classList.toggle('armed', target === 'a');
    if (el.armB) el.armB.classList.toggle('armed', target === 'b');
    setStatus('Armed →' + target.toUpperCase() + ' · will ' + (remix.autofade ? 'fade' : 'drop') + ' on the next ' + remix.boundary + '-bar line.');
    updateRemixReadouts();
  }

  // ---- readouts + canvas phrase timeline ---------------------------------
  function updateRemixReadouts() {
    if (!remixPlaying) {
      if (el.readBar) el.readBar.textContent = '— / ' + REMIX_PHRASE_BARS;
      if (el.readPhrase) el.readPhrase.textContent = '—';
      if (el.readNext) el.readNext.textContent = '— bars';
      if (el.readArmed) el.readArmed.textContent = '—';
      if (el.mixNow) el.mixNow.classList.remove('pulse');
      return;
    }
    const phrase = Math.floor(remix.currentBar / REMIX_GROUP_BARS) + 1;
    const inGroup = (remix.currentBar % REMIX_GROUP_BARS) + 1;
    if (el.readBar) el.readBar.textContent = (remix.currentBar + 1) + ' / ' + REMIX_PHRASE_BARS;
    if (el.readPhrase) el.readPhrase.textContent = 'P' + phrase + ' · bar ' + inGroup + ' of ' + REMIX_GROUP_BARS;
    if (el.readNext) el.readNext.textContent = (Math.ceil(boundaryIn(remix.boundary) * 10) / 10).toFixed(1) + ' bars';
    if (el.readArmed) el.readArmed.textContent = remix.armed ? '→' + remix.armed.toUpperCase() + ' @ ' + remix.boundary + 'b' : (autofadeActive ? 'fading…' : 'none');
    if (el.mixNow) {
      const closest = Math.min(boundaryIn(8), boundaryIn(16));
      el.mixNow.classList.toggle('pulse', closest <= 1 && closest > 0);
    }
  }
  function drawRemixTimeline() {
    const canvas = el.remixTimeline;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.offsetWidth || canvas.width, H = 64;
    if (!W) return;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = '#05030e'; ctx.fillRect(0, 0, W, H);
    const barW = W / REMIX_PHRASE_BARS;
    for (let gp = 0; gp < REMIX_PHRASE_BARS / REMIX_GROUP_BARS; gp++) {
      ctx.fillStyle = gp % 2 === 0 ? 'rgba(122,92,255,0.05)' : 'rgba(34,211,238,0.03)';
      ctx.fillRect(gp * REMIX_GROUP_BARS * barW, 0, REMIX_GROUP_BARS * barW, H);
    }
    ctx.strokeStyle = 'rgba(122,92,255,0.20)'; ctx.lineWidth = 1;
    for (let bar = 1; bar < REMIX_PHRASE_BARS; bar++) {
      if (bar % REMIX_GROUP_BARS === 0) continue;
      const x = bar * barW; ctx.beginPath(); ctx.moveTo(x, H * 0.55); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(122,92,255,0.55)'; ctx.lineWidth = 1.5;
    for (let bar = REMIX_GROUP_BARS; bar < REMIX_PHRASE_BARS; bar += REMIX_GROUP_BARS) {
      const x = bar * barW; ctx.beginPath(); ctx.moveTo(x, H * 0.25); ctx.lineTo(x, H); ctx.stroke();
    }
    if (remixPlaying) {
      const b = remix.boundary, pos = remix.currentBar + remix.barFrac;
      const nextBB = (Math.floor(pos / b) + 1) * b;
      ctx.strokeStyle = remix.armed ? (remix.armed === 'a' ? 'rgba(34,211,238,0.85)' : 'rgba(255,61,129,0.85)') : 'rgba(255,184,48,0.45)';
      ctx.lineWidth = 2;
      for (let bar = b; bar <= REMIX_PHRASE_BARS; bar += b) {
        const xb = (bar % REMIX_PHRASE_BARS) * barW;
        if (xb === 0 && bar !== REMIX_PHRASE_BARS) continue;
        const xbd = bar === REMIX_PHRASE_BARS ? W - 1 : xb;
        ctx.beginPath(); ctx.moveTo(xbd, 0); ctx.lineTo(xbd, H); ctx.stroke();
      }
      const nx = nextBB >= REMIX_PHRASE_BARS ? W - 1 : (nextBB % REMIX_PHRASE_BARS) * barW;
      ctx.strokeStyle = remix.armed ? (remix.armed === 'a' ? '#22d3ee' : '#ff3d81') : '#ffb830';
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
      const playheadX = pos * barW;
      const grad = ctx.createLinearGradient(playheadX - 18, 0, playheadX + 8, 0);
      grad.addColorStop(0, 'rgba(34,211,238,0)'); grad.addColorStop(1, 'rgba(34,211,238,0.18)');
      ctx.fillStyle = grad; ctx.fillRect(playheadX - 18, 0, 26, H);
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, H); ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = 'rgba(157,143,199,0.65)'; ctx.font = '9px "Space Grotesk", monospace'; ctx.textAlign = 'center';
    for (let lbar = 0; lbar < REMIX_PHRASE_BARS; lbar += REMIX_GROUP_BARS) ctx.fillText(String(lbar + 1), lbar * barW + barW / 2, 12);
  }

  // ---- stem strip UI ------------------------------------------------------
  function renderStemStrip(which) {
    const box = which === 'a' ? el.stemStripA : el.stemStripB;
    if (!box) return;
    const st = remix.decks[which].stems;
    if (!st) { box.innerHTML = '<div class="rx-stem-head">Stems</div><div class="rx-stem-note">— pull a sleeve —</div>'; return; }
    let html = '<div class="rx-stem-head">Stems</div>';
    if (!st.splittable) {
      html += '<div class="rx-stem-chip"><span class="rx-stem-label" style="color:var(--rx-muted)">FULL</span>' +
        '<button class="rx-mute' + (st.muted ? ' on' : '') + '" data-deck="' + which + '" data-action="mutefull">MUTE</button></div>' +
        '<div class="rx-stem-note">single track — not splittable</div>';
    } else {
      Object.keys(st.groups).forEach((grp) => {
        const col = REMIX_GROUP_COLOUR[grp] || '#9d8fc7';
        html += '<div class="rx-stem-chip">' +
          '<span class="rx-stem-label" style="color:' + col + '">' + grp + '</span>' +
          '<button class="rx-mute' + (st.muted[grp] ? ' on' : '') + '" data-deck="' + which + '" data-group="' + grp + '" data-action="mute">MUTE</button>' +
          '<button class="rx-solo' + (st.solo[grp] ? ' on' : '') + '" data-deck="' + which + '" data-group="' + grp + '" data-action="solo">SOLO</button></div>';
      });
    }
    box.innerHTML = html;
    box.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.deck, g = btn.dataset.group, action = btn.dataset.action, st2 = remix.decks[d].stems;
        if (!st2) return;
        if (action === 'mutefull') st2.muted = !st2.muted;
        else if (action === 'mute') st2.muted[g] = !st2.muted[g];
        else if (action === 'solo') st2.solo[g] = !st2.solo[g];
        renderStemStrip(d);
        remixRefresh();
      });
    });
  }

  // ---- load a dubplate onto a deck ---------------------------------------
  function loadRemixDeck(which, entry) {
    if (which !== 'a' && which !== 'b') { entry = which; which = 'b'; } // tolerate a 1-arg call
    if (!entry) return;
    remix.decks[which].rec = entry;
    remix.decks[which].stems = buildStems(entry);
    const platter = which === 'a' ? el.platterA : el.platterB;
    if (platter) platter.innerHTML = '<div class="rx-disc">' + discFor(entry) + '</div>';
    const meta = which === 'a' ? el.metaA : el.metaB;
    if (meta) meta.textContent = deckMetaText(entry);
    renderStemStrip(which);
    renderRemixShelf();
    updateRemixButtons();
    if (remixPlaying) remixRefresh(); else { updateRemixPlatters(); updateRemixTempo(); }
    setStatus('“' + (entry.name || 'Untitled') + '” on deck ' + which.toUpperCase() + '.');
  }

  function updateRemixPlatters() {
    ['a', 'b'].forEach((which) => {
      const platter = which === 'a' ? el.platterA : el.platterB;
      if (platter) platter.classList.toggle('spin', remixPlaying && !!remix.decks[which].rec && deckGain(which) > 0);
    });
  }
  function updateRemixTempo() {
    if (!el.tempo) return;
    el.tempo.textContent = masterRec() ? masterCps() + ' cps · ' + Math.round(masterCps() * 240) + ' BPM' : '— cps';
  }

  // The shelf: a strip of sleeves, each with →A / →B load buttons.
  function renderRemixShelf() {
    if (!el.remixShelf) return;
    const crate = loadCrate();
    el.remixShelf.innerHTML = '';
    if (!crate.length) {
      const empty = document.createElement('div');
      empty.className = 'remix-shelf-empty';
      empty.textContent = 'No dubplates yet — cut some in the Live set first.';
      el.remixShelf.appendChild(empty);
      return;
    }
    const a = remix.decks.a.rec, b = remix.decks.b.rec;
    const idOf = (e) => (e ? (e.id || e.code) : '');
    crate.forEach((entry) => {
      const id = idOf(entry);
      const sleeve = document.createElement('div');
      sleeve.className = 'rx-sleeve' + (idOf(a) === id ? ' on-a' : '') + (idOf(b) === id ? ' on-b' : '');
      const art = document.createElement('div');
      art.className = 'shelf-art'; art.innerHTML = discFor(entry); // vinyl disc, matches the decks
      const nm = document.createElement('div');
      nm.className = 'shelf-name'; nm.textContent = entry.name || 'Untitled';
      const load = document.createElement('div');
      load.className = 'rx-sleeve-load';
      ['a', 'b'].forEach((w) => {
        const btn = document.createElement('button');
        btn.dataset.to = w; btn.textContent = '→' + w.toUpperCase();
        btn.title = 'Load “' + (entry.name || 'Untitled') + '” onto deck ' + w.toUpperCase();
        btn.addEventListener('click', () => loadRemixDeck(w, entry));
        load.appendChild(btn);
      });
      sleeve.appendChild(art); sleeve.appendChild(nm); sleeve.appendChild(load);
      el.remixShelf.appendChild(sleeve);
    });
  }

  // ---- SWAP macros: mute complementary stem sets across the two decks ------
  function remixSwap(aMute, bMute) {
    const apply = (which, mute) => {
      const st = remix.decks[which].stems;
      if (!st || !st.splittable) return;
      Object.keys(st.muted).forEach((g) => { st.muted[g] = false; st.solo[g] = false; });
      mute.forEach((g) => { if (st.muted[g] !== undefined) st.muted[g] = true; });
      renderStemStrip(which);
    };
    apply('a', aMute); apply('b', bMute);
    remixRefresh();
  }

  // ---- press the current blend into the crate as a fresh dubplate ---------
  function remixShortName(name) { const n = String(name || 'Untitled'); return n.length > 16 ? n.slice(0, 15) + '…' : n; }
  function remixPress() {
    const rec = masterRec(), code = composeRemix();
    if (!rec || !code) { setStatus('Nothing to cut — pull a sleeve onto a deck first.'); return; }
    const a = remix.decks.a.rec, b = remix.decks.b.rec;
    const name = (a && b) ? remixShortName(a.name) + ' × ' + remixShortName(b.name) : remixShortName(rec.name) + ' (remix)';
    const genome = rec.genome ? JSON.parse(JSON.stringify(rec.genome)) : null;
    let lane = 0;
    if (genome && genome.active) { for (let i = 0; i < genome.active.length; i++) if (genome.active[i]) lane = i; }
    const cps = masterCps();
    const crate = loadCrate();
    if (crate.length && crate[0].code === code) { setStatus('Already cut — the newest dubplate is this exact blend.'); return; }
    const entry = {
      id: 'rmx-' + Date.now().toString(36),
      name: name, key: rec.key, scaleType: rec.scaleType,
      bpm: Math.round(cps * 240), cps: cps,
      genre: rec.genre || null, genreLabel: rec.genreLabel || null,
      code: code, genome: genome,
      art: rec.art ? { seed: rec.art.seed, layer: rec.art.layer, variant: (rec.art.variant || 0) + 1 } : { seed: (Date.now() >>> 0), layer: lane, variant: 0 },
      approval: rec.approval != null ? rec.approval : null,
      source: 'remix', savedAt: Date.now(), remixOf: (a && a.id) || null,
    };
    crate.unshift(entry);
    if (crate.length > CRATE_CAP) crate.length = CRATE_CAP;
    saveCrate(crate);
    renderCrate();
    renderRemixShelf();
    logEvent('◉ cut the remix “' + name + '” as a dubplate');
    setStatus('Cut “' + name + '” into the crate.');
  }

  function updateRemixButtons() {
    const has = !!masterRec();
    if (el.remixStart) { el.remixStart.textContent = remixPlaying ? '⏹ Stop' : '▶ Play'; el.remixStart.disabled = !has; }
    if (el.remixSave) el.remixSave.disabled = !has;
  }

  // Hold-to-fire: paddle FX chain onto the master while the button is held.
  function bindPaddle(btnId, key) {
    const btn = el[btnId]; if (!btn) return;
    const activate = (e) => { if (e && e.preventDefault) e.preventDefault(); if (remix.paddles[key]) return; remix.paddles[key] = true; btn.classList.add('held'); remixPaddleRefresh(); };
    const release = () => { if (!remix.paddles[key]) return; remix.paddles[key] = false; btn.classList.remove('held'); remixPaddleRefresh(); };
    btn.addEventListener('mousedown', activate);
    btn.addEventListener('touchstart', activate, { passive: false });
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
  }

  // Wire every control once at boot.
  function initRemix() {
    if (el.remixStart) el.remixStart.addEventListener('click', () => { if (remixPlaying) stopRemix(); else remixPlay(); });
    if (el.remixSave) el.remixSave.addEventListener('click', remixPress);
    if (el.cross) el.cross.addEventListener('input', (e) => {
      if (autofadeActive || remix.armed) { autofadeActive = false; clearArm(); setStatus('Manual override — ARM cleared.'); }
      remix.cross = parseFloat(e.target.value); remixRefresh();
    });
    if (el.nudge) el.nudge.addEventListener('input', (e) => {
      remix.nudge = parseFloat(e.target.value);
      if (el.nudgeVal) el.nudgeVal.textContent = (remix.nudge >= 0 ? '+' : '') + remix.nudge.toFixed(1) + '%';
      remixRefresh();
    });
    [['trimA', 'a'], ['trimB', 'b']].forEach((pair) => {
      const inp = el[pair[0]]; if (!inp) return;
      inp.addEventListener('input', (e) => { remix.decks[pair[1]].trim = parseFloat(e.target.value); if (el[pair[0] + 'Val']) el[pair[0] + 'Val'].textContent = remix.decks[pair[1]].trim.toFixed(2); remixRefresh(); });
    });
    [['filterA', 'a'], ['filterB', 'b']].forEach((pair) => {
      const inp = el[pair[0]]; if (!inp) return;
      inp.addEventListener('input', (e) => { remix.decks[pair[1]].filter = parseFloat(e.target.value); if (el[pair[0] + 'Val']) el[pair[0] + 'Val'].textContent = remix.decks[pair[1]].filter.toFixed(2); remixRefresh(); });
    });
    ['a', 'b'].forEach((t) => { const btn = el['arm' + t.toUpperCase()]; if (btn) btn.addEventListener('click', () => remixArm(t)); });
    if (el.boundarySelect) el.boundarySelect.addEventListener('change', (e) => { remix.boundary = parseInt(e.target.value, 10) || 16; if (remix.armed) setStatus('Boundary → ' + remix.boundary + ' bars · ARM still active.'); updateRemixReadouts(); });
    if (el.autofadeCheck) el.autofadeCheck.addEventListener('change', (e) => { remix.autofade = e.target.checked; if (autofadeActive) { autofadeActive = false; setStatus('Auto-fade mode changed — current fade cancelled.'); } });
    if (el.swapAdrumsBmelody) el.swapAdrumsBmelody.addEventListener('click', () => { remixSwap(['CHORDS', 'LEAD', 'AIR'], ['DRUMS', 'BASS']); setStatus('Swap: A drums × B melody.'); });
    if (el.swapAmelodyBdrums) el.swapAmelodyBdrums.addEventListener('click', () => { remixSwap(['DRUMS', 'BASS'], ['CHORDS', 'LEAD', 'AIR']); setStatus('Swap: A melody × B drums.'); });
    bindPaddle('padStutter', 'stutter'); bindPaddle('padGate', 'gate'); bindPaddle('padEcho', 'echo');
    updateRemixButtons();
  }

  // ---- headless snapshots (agent-native) ---------------------------------
  function remixDeckSnapshot(which) {
    const d = remix.decks[which];
    if (!d.rec) return null;
    let stems = null;
    if (d.stems) {
      stems = d.stems.splittable
        ? { splittable: true, groups: Object.keys(d.stems.groups), muted: JSON.parse(JSON.stringify(d.stems.muted)), solo: JSON.parse(JSON.stringify(d.stems.solo)) }
        : { splittable: false, muted: !!d.stems.muted };
    }
    return { id: d.rec.id || null, name: d.rec.name || null, gain: deckGain(which), trim: d.trim, filter: d.filter, stems: stems };
  }
  function remixState() {
    return {
      playing: remixPlaying, cross: remix.cross, nudge: remix.nudge,
      masterCps: masterRec() ? masterCps() : null,
      armed: remix.armed, boundary: remix.boundary, autofade: remix.autofade, autofadeActive: autofadeActive,
      currentBar: remix.currentBar, barFrac: remix.barFrac,
      paddles: Object.assign({}, remix.paddles),
      deckA: remixDeckSnapshot('a'), deckB: remixDeckSnapshot('b'),
    };
  }

  // Called when the #remix view becomes visible.
  function enterRemix() {
    sizeRemixRoll();
    renderRemixShelf();
    updateRemixButtons();
    updateRemixTempo();
    updateRemixReadouts();
    updateRemixPlatters();
    drawRemixTimeline();
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
    closeVisuals(); // any navigation drops the full-screen pure-visual overlay
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
    // the top-bar player's strip only runs off the menu, and only while playing
    if (playerVizInst) { if (name !== 'menu' && nowPlaying.kind) playerVizInst.start(); else playerVizInst.stop(); }
  }

  // ---- pure-visual mode: the shared visualiser, full-screen over the menu ----
  // Opened from the menu's "Visuals" channel. Keeps the menu ambience playing and
  // reacts to it; a click anywhere or Esc drops back to the menu. The overlay owns
  // the RAF while it's up, so the menu's background canvas is paused underneath.
  function openVisuals() {
    if (!el.visualStage) return;
    if (!visualInst && SDJ.Visualiser) visualInst = SDJ.Visualiser.mount(el.visualCanvas, { mode: 'full' });
    el.visualStage.hidden = false;
    el.visualStage.setAttribute('aria-hidden', 'false');
    document.body.classList.add('visuals-open');
    if (SDJ.Menu) SDJ.Menu.leave();
    if (visualInst) { visualInst.resize(); visualInst.start(); }
    document.addEventListener('keydown', onVisualsKey);
    // make sure there's something to look at: unlock audio + start the ambience
    ensureAudio().then(() => { maybeStartMenuAmbient(); }).catch(() => {});
  }
  function closeVisuals() {
    if (!el.visualStage || el.visualStage.hidden) return;
    el.visualStage.hidden = true;
    el.visualStage.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('visuals-open');
    if (visualInst) visualInst.stop();
    document.removeEventListener('keydown', onVisualsKey);
    if (currentRoute() === 'menu' && SDJ.Menu) SDJ.Menu.enter();
  }
  function onVisualsKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { closeVisuals(); e.preventDefault(); }
  }
  SDJ.openVisuals = openVisuals;
  SDJ.closeVisuals = closeVisuals;

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

  // remix deck, exposed so every action is available headlessly (agent-native).
  // Any move a DJ can make with the mouse, an agent can make through this.
  SDJ.remix = {
    load: loadRemixDeck,        // (which, entry) — 'a' | 'b'
    play: remixPlay,
    stop: stopRemix,
    cross: function (v) { remix.cross = clamp(+v || 0, 0, 1); if (el.cross) el.cross.value = remix.cross; remixRefresh(); },
    nudge: function (v) { remix.nudge = clamp(+v || 0, -8, 8); if (el.nudge) el.nudge.value = remix.nudge; if (el.nudgeVal) el.nudgeVal.textContent = (remix.nudge >= 0 ? '+' : '') + remix.nudge.toFixed(1) + '%'; remixRefresh(); },
    trim: function (which, v) { if (remix.decks[which]) { remix.decks[which].trim = clamp(+v || 0, 0, 1); if (el[which === 'a' ? 'trimAVal' : 'trimBVal']) el[which === 'a' ? 'trimAVal' : 'trimBVal'].textContent = remix.decks[which].trim.toFixed(2); remixRefresh(); } },
    filter: function (which, v) { if (remix.decks[which]) { remix.decks[which].filter = clamp(+v || 0, -1, 1); if (el[which === 'a' ? 'filterAVal' : 'filterBVal']) el[which === 'a' ? 'filterAVal' : 'filterBVal'].textContent = remix.decks[which].filter.toFixed(2); remixRefresh(); } },
    arm: remixArm,              // ('a' | 'b' | null)
    boundary: function (b) { remix.boundary = parseInt(b, 10) || 16; if (el.boundarySelect) el.boundarySelect.value = String(remix.boundary); updateRemixReadouts(); },
    autofade: function (on) { remix.autofade = !!on; if (el.autofadeCheck) el.autofadeCheck.checked = remix.autofade; },
    mute: function (which, group) { const st = remix.decks[which] && remix.decks[which].stems; if (!st) return; if (!st.splittable) st.muted = !st.muted; else if (st.muted[group] !== undefined) st.muted[group] = !st.muted[group]; renderStemStrip(which); remixRefresh(); },
    solo: function (which, group) { const st = remix.decks[which] && remix.decks[which].stems; if (!st || !st.splittable || st.solo[group] === undefined) return; st.solo[group] = !st.solo[group]; renderStemStrip(which); remixRefresh(); },
    swap: remixSwap,            // (aMuteGroups[], bMuteGroups[])
    paddle: function (key, on) { if (!(key in remix.paddles)) return; remix.paddles[key] = !!on; const btn = el['pad' + key.charAt(0).toUpperCase() + key.slice(1)]; if (btn) btn.classList.toggle('held', !!on); remixPaddleRefresh(); },
    press: remixPress,
    compose: composeRemix,
    state: remixState,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SDJ = window.SDJ || {});
