// Headless integration test for the app wiring (Strudel audio stubbed).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e && e.constructor && e.constructor.name, e && e.message, e && e.stack); process.exit(2); });

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
// no-op rAF: viz scheduling is exercised, painting is not needed here
window.requestAnimationFrame = () => 0;
window.cancelAnimationFrame = () => {};
if (!window.performance) window.performance = { now: () => Date.now() };

// ---- stub Strudel + canvas ----
const evalCalls = [];
window.initStrudel = () => Promise.resolve();
window.evaluate = (code) => { evalCalls.push(code); };
let hushCalls = 0;
window.hush = () => { hushCalls++; };
const gradient = { addColorStop() {} };
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, {
    get: (t, p) => (p === 'createLinearGradient' ? () => gradient : () => {}),
    set: () => true,
  });

// pre-seed a saved track so renderCrate() builds crate DOM at boot
window.localStorage.setItem('sdj.crate', JSON.stringify([
  { name: 'Test Banger', key: 'C', scaleType: 'minor', bpm: 128, code: 'setcps(0.5)\nstack(s("bd*4"))', approval: 88, savedAt: Date.now() },
]));

// ---- load app modules in the window context ----
for (const f of ['rng', 'theory', 'names', 'dj', 'viz', 'log', 'art', 'vinyl', 'app']) {
  try {
    window.eval(fs.readFileSync(path.join(root, 'src', f + '.js'), 'utf8'));
  } catch (e) {
    console.error('LOAD ERROR in ' + f + '.js:', e && e.message);
    process.exit(3);
  }
}

const doc = window.document;
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
}

function balanced(str) {
  let par = 0, inStr = false, q = 0;
  for (const c of str) {
    if (c === '"') { inStr = !inStr; q++; continue; }
    if (inStr) continue;
    if (c === '(') par++; if (c === ')') par--;
  }
  return par === 0 && q % 2 === 0;
}

const crateLen = () => JSON.parse(window.localStorage.getItem('sdj.crate') || '[]').length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(100); // let DOMContentLoaded fire so boot() runs

  // boot ran on load. Crate should be rendered from seeded storage. The seeded
  // entry uses the OLD record shape (no genome/art/id) — so this also proves the
  // library migrates old entries. Actions are keyed off data-act (not a fixed
  // button count) so the richer action set (play/remix/rename/del) stays valid.
  check('crate rendered from storage', doc.querySelectorAll('#crate .crate-item').length === 1);
  check('crate item has play + delete controls',
    !!doc.querySelector('#crate .crate-item [data-act="play"]') &&
    !!doc.querySelector('#crate .crate-item [data-act="del"]'));
  check('migrated (art-less) record still gets a vinyl face',
    doc.querySelector('#crate .crate-art svg') != null);

  // start the set — seed the engine first so the whole run is deterministic
  window.SDJ.engine.masterSeed = 0xC0FFEE;
  doc.getElementById('startBtn').click();
  await sleep(80); // let async startSet resolve

  check('evaluate called on start', evalCalls.length >= 1);
  check('first evaluated code is balanced', evalCalls.length && balanced(evalCalls[0]), evalCalls[0]);
  check('track name populated', doc.getElementById('trackName').textContent !== '—');
  check('code panel populated', doc.getElementById('code').textContent.includes('stack'));
  check('code highlighted with spans', doc.getElementById('code').innerHTML.includes('<span class="fn"'));
  check('stage chips rendered', doc.querySelectorAll('#stageChips .chip').length === 7);
  // part mixer: the seven faders are replaced by a 3-state row (drop/auto/feature) per part
  check('part mixer renders a 3-state row per part',
    doc.querySelectorAll('#livePartMix .pm-row').length === 7 &&
    doc.querySelectorAll('#livePartMix .pm-row:first-child .pm-btn').length === 3);

  // unified transport + the deck rig
  check('transport shows now playing on start',
    !doc.getElementById('transport').hidden && doc.getElementById('tpName').textContent.length > 0);
  check('suggestion card shown after start',
    !doc.getElementById('sgCard').hidden && doc.getElementById('sgDesc').textContent.length > 0);
  check('the deck rig is up while live', !doc.getElementById('deckRig').hidden);
  check('deck A wears the committed record (vinyl svg)',
    doc.getElementById('deckADisc').innerHTML.includes('<svg'));
  check('a pitch puts an acetate on deck B',
    doc.getElementById('deckBDisc').innerHTML.includes('<svg'));

  // ---- the pressing flow: saving is a deliberate record-cut, not a silent bank
  const crateBefore = crateLen();
  doc.getElementById('saveBtn').click();
  check('save opens the pressing modal (nothing banked yet)',
    !doc.getElementById('pressModal').hidden && crateLen() === crateBefore);
  check('the press modal shows the disc + which version is banked',
    doc.getElementById('pressDisc').innerHTML.includes('<svg') &&
    doc.getElementById('pressVersion').textContent.includes('approved'));
  doc.getElementById('pressName').value = 'Test Pressing';
  doc.getElementById('pressName').dispatchEvent(new window.Event('input')); // live imprint
  check('typing re-imprints the label on the disc',
    doc.getElementById('pressDisc').innerHTML.toUpperCase().includes('TEST PRESSING'));
  check('the press modal defaults to the arranged-track format',
    doc.getElementById('pressFull').classList.contains('on'));
  doc.getElementById('pressLoop').click(); // bank the raw loop this time
  doc.getElementById('pressConfirm').click();
  check('confirming the press banks a crate entry', crateLen() === crateBefore + 1,
    `before=${crateBefore} after=${crateLen()}`);
  const pressed = JSON.parse(window.localStorage.getItem('sdj.crate'))[0];
  check('the pressed record carries the typed name', pressed.name === 'Test Pressing');
  check('the pressed record banks the committed genome (no un-judged pitch)',
    !!pressed.genome && balanced(pressed.code));
  check('loop format banks the raw loop',
    pressed.code.includes('stack(') && !pressed.code.includes('arrange('));

  // guitar-hero pianoroll: attached to the live audio, kept out of the code panel
  check('live audio carries the pianoroll', evalCalls.some((c) => c.includes('.pianoroll(')));
  check('code panel omits the pianoroll', !doc.getElementById('code').innerHTML.includes('pianoroll'));

  // ---- genre pills: pin the style for new tracks (empty = surprise me) ----
  check('genre pills list every genre + surprise',
    doc.querySelectorAll('#liveGenrePills .pill').length === window.SDJ.Theory.GENRES.length + 1);
  const seedBefore = window.SDJ.engine.song.seed;
  window.SDJ.setGenre('drill');
  check('pinning a genre re-skins the live track in place (same song, new style + tempo)',
    window.SDJ.engine.song.genre.id === 'drill'
    && window.SDJ.engine.song.seed === seedBefore
    && window.SDJ.engine.song.bpm >= 138 && window.SDJ.engine.song.bpm <= 148
    && doc.querySelector('#liveGenrePills .pill.on').dataset.genre === 'drill');
  window.SDJ.setGenre('');
  check('clearing the genre returns to surprise mode',
    window.SDJ.engine.genrePref === null
    && doc.querySelector('#liveGenrePills .pill.on').dataset.genre === '');

  // ---- remix lab: a saved record as a bed + vocal/overlay layers ----
  // The bed (the record's own stack) nests inside a new outer stack; every
  // overlay appends a layer. Compose must stay balanced across all overlays.
  const remixRec = JSON.parse(window.localStorage.getItem('sdj.crate'))[1]; // the old-shape seed entry
  window.SDJ.remix.load(remixRec);
  ['chops', 'topline', 'sweep', 'stutter', 'riser'].forEach((k) => window.SDJ.remix.toggle(k));
  const remixCode = window.SDJ.remix.compose();
  check('remix composes balanced Strudel with all overlays',
    !!remixCode && balanced(remixCode) && remixCode.indexOf('stack(') >= 0, remixCode);
  check('remix nests the record as a bed', remixCode.indexOf(remixRec.code.split('\n')[1]) >= 0);
  check('the remix platter wears the record as a disc',
    doc.getElementById('remixArt').innerHTML.includes('<svg'));

  // ---- turn-based live flow: approve commits + re-pitches, skip re-pitches ----
  const partsBefore = window.SDJ.engine.state().activeCount;
  const evalsBefore = evalCalls.length;
  window.SDJ.live.approve();      // commit the current suggestion
  await sleep(20);
  check('approving re-pitches a fresh suggestion',
    window.SDJ.live.pitching() !== false && !doc.getElementById('sgCard').hidden);
  check('approving can grow the arrangement', window.SDJ.engine.state().activeCount >= partsBefore);
  check('a decision logs a DJ move', doc.querySelectorAll('#log li').length >= 1);
  check('the pitch history records the call', doc.querySelectorAll('#djFeed li').length >= 1);
  window.SDJ.live.skip();         // skip re-pitches without committing
  await sleep(20);
  check('skipping re-pitches without dead-ending', !doc.getElementById('sgCard').hidden);
  check('live audio stayed balanced', evalCalls.slice(evalsBefore).every(balanced));

  // ---- the A/B crossfader: blend the pitch against the committed track ----
  const eng = window.SDJ.engine;
  check('a fresh pitch is pending for the fader', !!eng.song.pending);
  if (eng.song.pending) {
    const a = eng.renderAB(0), mid = eng.renderAB(0.5), b = eng.renderAB(1);
    check('renderAB stays balanced across the fader',
      balanced(a) && balanced(mid) && balanced(b), mid);
    check('mid-fader carries the touched lane at half gain', mid.includes('.gain(0.5)'), mid);
    check('the fader ends are audibly different programs', a !== b);
  }
  doc.getElementById('abFader').value = '40';
  doc.getElementById('abFader').dispatchEvent(new window.Event('input'));
  await sleep(200); // past the fader throttle
  const blended = evalCalls[evalCalls.length - 1];
  check('dragging the fader auditions a blended program',
    blended.includes('.gain(0.4)') || blended.includes('.gain(0.6)'), blended);
  check('blended programs stay balanced', balanced(blended));

  // the part mixer biases the DJ: marking an active part "drop" makes the DJ pitch
  // removing it (proposeChange now reads laneMood).
  const be = new window.SDJ.DJEngine();
  be.newSong(); be.voteReset();
  be.song.genome.active = [true, true, true, false, false, false, false]; // kick/hats/bass on
  be.song.laneMood = [0, 0, -1, 0, 0, 0, 0];                              // mark bass (lane 2) drop
  let sawDrop = false;
  for (let k = 0; k < 30; k++) {
    const p = be.proposeChange();
    if (p && p.kind === 'drop' && p.layer === 2) { sawDrop = true; break; }
    be.acceptChange();
  }
  check('marking a part "drop" makes the DJ pitch removing it', sawDrop);

  // renderCommitted always renders the approved version, whatever's pending
  const ce = new window.SDJ.DJEngine();
  ce.newSong(); ce.voteReset();
  const committedBare = ce.renderCommitted();
  ce.proposeChange(); // applies a pitch to the genome
  check('renderCommitted leaves an un-judged pitch off',
    ce.renderCommitted() === committedBare && ce.render() !== committedBare);

  // ---- audit fixes: seeded 808s, slides, arrangement, energy, swing, deepen --
  const xe = new window.SDJ.DJEngine();
  xe.masterSeed = 1234; xe.genrePref = 'drill'; xe.newSong();
  check('drill opens with the 808 seeded in', xe.song.genome.active[2] === true);
  check('the drill 808 slides (patterned pitch envelope)', xe.render().includes('.penv('));
  const arr = xe.renderArranged();
  check('arranged render is a balanced multi-section journey',
    balanced(arr) && arr.includes('arrange(') && arr.split('stack(').length - 1 === 6,
    arr.slice(0, 100));

  const ye = new window.SDJ.DJEngine();
  ye.masterSeed = 1234; ye.genrePref = 'trap'; ye.newSong();
  ye.song.genome.active = [true, true, false, false, false, false, false];
  const eThin = ye.state().energy;
  ye.song.genome.active = [true, true, true, true, true, false, false];
  check('energy ramps as the arrangement fills', ye.state().energy > eThin,
    eThin + ' -> ' + ye.state().energy);
  ye.song.genome.active = [true, true, true, true, true, true, true];
  const leadLine = ye.render().split('\n').find((l) => l.includes('#ff4dd2'));
  check('the lead is always low-passed', !!leadLine && leadLine.includes('.lpf('), leadLine);

  // ---- lead variety: draw from a deep pool, not the same ~6 cells ----
  // Regression guard for the reachability bug: a fresh add seeds variant 0..5,
  // and the lead used to index MELODY_CELLS by variant directly — so only the
  // first six of 30+ cells were ever heard, identically across every song. The
  // lead now picks from the whole library through its lane RNG (seeded per
  // song), so distinct cells surface across songs even at low variant.
  const me = new window.SDJ.DJEngine();
  const leadCells = new Set();
  let leadBal = true;
  for (let sng = 0; sng < 30; sng++) {
    me.masterSeed = 1000 + sng * 7; me.genrePref = 'trap'; me.newSong();
    me.song.genome.active = [true, false, false, false, false, true, false]; // kick + lead
    me.song.genome.variant[5] = sng % 6; // realistic: a fresh add seeds variant 0..5
    const code = me.render();
    if (!balanced(code)) leadBal = false;
    const line = code.split('\n').find((l) => l.includes('#ff4dd2'));
    const m = line && line.match(/n\("([^"]*)"\)\.scale/);
    if (m) leadCells.add(m[1]);
  }
  check('the lead melody draws from a deep, varied pool (not the same ~6)',
    leadCells.size >= 12, 'distinct lead cells=' + leadCells.size);
  check('every lead-variant render stays balanced', leadBal);

  // expanded harmony + bass vocabulary
  check('voicings expand the harmonic vocabulary (quartal/shell/etc.)',
    window.SDJ.Theory.VOICINGS.length >= 6 &&
    window.SDJ.Theory.voicingSeq([0, 5], 'quartal').includes('[0,3,6]'));
  check('walking bass steps toward the next chord',
    window.SDJ.Theory.walkingSeq([0, 5, 3, 4]).indexOf('<[0 1]') === 0,
    window.SDJ.Theory.walkingSeq([0, 5, 3, 4]));

  const we = new window.SDJ.DJEngine();
  we.masterSeed = 1234; we.genrePref = 'loFi'; we.newSong();
  we.song.genome.active = [true, true, true, true, false, false, false];
  check('lo-fi drums swing', we.render().includes('.swingBy('));
  check('swung render stays balanced', balanced(we.render()));

  const ze = new window.SDJ.DJEngine();
  ze.masterSeed = 1234; ze.newSong(); ze.voteReset();
  ze.song.genome.active = [true, true, true, true, false, false, false];
  let sawDeep = false;
  for (let k = 0; k < 60; k++) {
    const pz = ze.proposeChange();
    if (!pz) break;
    if (pz.kind === 'fx' || pz.kind === 'double' || pz.kind === 'fill') { sawDeep = true; break; }
    ze.acceptChange();
  }
  check('deepening moves unlock at 4 parts', sawDeep);

  // ---- engine-level banger detection (pure, deterministic) ----
  const engine = new window.SDJ.DJEngine();
  engine.newSong();
  let hit = false, ticks = 0, maxStage = 0;
  while (!hit && ticks < 400) {
    const res = engine.tick(1.0, 1.0); // full hype, 1s steps
    hit = res.hit;
    maxStage = Math.max(maxStage, engine.state().stage);
    ticks++;
  }
  check('banger detected under sustained hype', hit, `after ${ticks}s, reached stage ${maxStage}`);
  check('song fully built before banger', maxStage === engine.state().maxStage || maxStage >= 5, `maxStage=${maxStage}`);
  check('layers carry lane colours for the roll', engine.render().includes('.color('));

  // ---- A&R vote mode: turn-based, killed ideas never return ----
  const ve = new window.SDJ.DJEngine();
  ve.newSong();
  ve.voteReset();
  const p1 = ve.proposeChange();
  check('proposeChange offers a change', !!(p1 && p1.desc && p1.layer != null), JSON.stringify(p1));
  ve.render(); // populates _lastLayers (body-line -> stage index)
  check('first pitch maps to a code line', ve._lastLayers.indexOf(p1.layer) >= 0,
    'layer=' + p1.layer + ' map=' + JSON.stringify(ve._lastLayers));
  const killed = p1.layer;
  ve.rejectChange();
  check('killed add is reverted', ve.song.genome.active[killed] === false || p1.kind === 'reshape');
  let recurred = false;
  for (let k = 0; k < 40; k++) {
    const pk = ve.proposeChange();
    if (!pk) break;
    if (pk.kind === 'add' && pk.layer === killed) { recurred = true; break; }
    ve.acceptChange();
  }
  check('killed idea is never pitched again', !recurred);
  check('accepted changes build the track', window.SDJ.STAGES && ve.state().activeCount >= 2,
    'active=' + ve.state().activeCount);
  // cover art is a deterministic SVG for the change
  const svg = window.SDJ.Art.cover(2, 3, 12345);
  check('cover art renders an svg', typeof svg === 'string' && svg.indexOf('<svg') === 0);
  // the vinyl builder is deterministic too, and balanced markup
  const v1 = window.SDJ.Vinyl.disc({ seed: 42, name: 'Spin Test', rings: ['#f43f7d', '#2ee6d6'] });
  const v2 = window.SDJ.Vinyl.disc({ seed: 42, name: 'Spin Test', rings: ['#f43f7d', '#2ee6d6'] });
  check('vinyl discs are deterministic svg', v1 === v2 && v1.indexOf('<svg') === 0 && v1.includes('SPIN TEST'));

  // A&R must not dead-end: killing *reworks* only spaces them out (a killed *add*
  // stays out), so while any layer is playable the DJ always has a next pitch.
  const de = new window.SDJ.DJEngine();
  de.newSong();
  de.voteReset();
  for (let k = 0; k < 3; k++) { const pp = de.proposeChange(); if (!pp) break; de.acceptChange(); }
  let deadEnded = false;
  for (let k = 0; k < 40; k++) { const pp = de.proposeChange(); if (!pp) { deadEnded = true; break; } de.rejectChange(); }
  check('A&R never dead-ends while a layer is playable', !deadEnded);

  // ---- save-when-full: approve until the arrangement fills, then the DJ offers a
  // pressing you can decline (keep iterating) or take (opens the modal, banks) ----
  let guard = 0, cardOk = true;
  while (window.SDJ.live.pitching() !== 'save' && guard < 80) {
    if (!doc.getElementById('sgDesc').textContent.length) { cardOk = false; break; }
    window.SDJ.live.approve();  // keep approving to fill the arrangement
    await sleep(6);
    guard++;
    if (doc.getElementById('sgCard').hidden) break;
  }
  check('every suggestion card stays valid (desc present)', cardOk);
  check('a full arrangement triggers a press prompt',
    window.SDJ.live.pitching() === 'save' && doc.getElementById('sgKind').classList.contains('k-save'),
    'pitching=' + window.SDJ.live.pitching());
  const cratePreDecline = crateLen();
  window.SDJ.live.skip(); // decline the press — keep iterating, bank nothing
  await sleep(10);
  check('declining the press banks nothing', crateLen() === cratePreDecline);
  // drive back to a press prompt and take it
  guard = 0;
  while (window.SDJ.live.pitching() !== 'save' && guard < 40) { window.SDJ.live.approve(); await sleep(6); guard++; }
  const cratePreSave = crateLen();
  if (window.SDJ.live.pitching() === 'save') { window.SDJ.live.approve(); await sleep(10); }
  check('accepting the prompt opens the press modal (nothing banked yet)',
    !doc.getElementById('pressModal').hidden && crateLen() === cratePreSave);
  doc.getElementById('pressConfirm').click();
  await sleep(10);
  check('pressing the record banks it and rolls a fresh track',
    crateLen() === cratePreSave + 1 && window.SDJ.live.pitching() !== 'save');
  const pressedFull = JSON.parse(window.localStorage.getItem('sdj.crate'))[0];
  check('the prompt press defaults to an arranged 36-bar track',
    pressedFull.code.includes('arrange(') && balanced(pressedFull.code));
  check('records carry an approve-rate, not the dead hype stat',
    typeof pressedFull.approval === 'number' && pressedFull.approval >= 0 && pressedFull.approval <= 100);
  check('live evaluations stayed balanced', evalCalls.every(balanced));

  // ---- highlight escapes mini-notation < > ----
  engine.song.stage = 6; engine.song.variation = 6;
  const sample = engine.render();
  check('render contains mini-notation <>', sample.includes('<'));

  // ---- global stop really stops (header ⏹) ----
  const hushBefore = hushCalls;
  const evalBefore = evalCalls.length;
  doc.getElementById('tpStop').click();
  await sleep(20);
  const silenceEvals = evalCalls.slice(evalBefore).filter((c) => c === 'silence');
  check('global stop hushes and clears the transport',
    hushCalls > hushBefore && doc.getElementById('transport').hidden);
  check('global stop evaluates silence to override in-flight audio', silenceEvals.length > 0);

  // ---- remix console: a 2-deck DJ setup — vox pads stab one-shots over the bed ----
  // The vox deck is a square of single-press pads; the shelf is the record picker.
  // Firing a pad is a no-op until the bed plays; once it does, the stab nests as a
  // one-shot vocal layer and the program stays balanced. Runs at the very end so
  // starting the bed doesn't disturb the live-set assertions above.
  const rc = JSON.parse(window.localStorage.getItem('sdj.crate'))[0];
  window.SDJ.remix.load(rc);
  check('vox deck renders 8 one-shot pads', doc.querySelectorAll('#remixVox .vox-pad').length === 8);
  check('record shelf renders sleeve tiles', doc.querySelectorAll('#remixShelf .shelf-item').length >= 1);
  window.SDJ.remix.stab('yeah');
  check('a vox pad is a no-op until the bed plays', window.SDJ.remix.state().stabs.length === 0);
  await window.SDJ.remix.play(); // audio already unlocked earlier — starts the bed
  await sleep(20);
  window.SDJ.remix.stab('yeah');
  const stabCode = window.SDJ.remix.compose();
  const firedStabs = window.SDJ.remix.state().stabs;
  check('a fired vox pad adds a balanced one-shot vocal layer',
    firedStabs.length === 1 && balanced(stabCode) && stabCode.indexOf('s("' + firedStabs[0] + '")') >= 0,
    stabCode);
  window.SDJ.remix.stop();
  check('stopping the remix clears the stabs', window.SDJ.remix.state().stabs.length === 0);

  // report
  let pass = 0;
  for (const r of results) {
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
