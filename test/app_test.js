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
for (const f of ['rng', 'theory', 'names', 'dj', 'viz', 'log', 'art', 'app']) {
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
  check('migrated (art-less) record still gets a cover',
    doc.querySelector('#crate .crate-art svg') != null);

  // start the set
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

  // unified transport + production controls
  check('transport shows now playing on start',
    !doc.getElementById('transport').hidden && doc.getElementById('tpName').textContent.length > 0);
  check('freeze enabled while running', !doc.getElementById('freezeBtn').disabled);
  const crateBefore = JSON.parse(window.localStorage.getItem('sdj.crate') || '[]').length;
  doc.getElementById('saveBtn').click();
  const crateAfter = JSON.parse(window.localStorage.getItem('sdj.crate') || '[]').length;
  check('save current adds a crate entry', crateAfter === crateBefore + 1, `before=${crateBefore} after=${crateAfter}`);

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
  const remixRec = JSON.parse(window.localStorage.getItem('sdj.crate'))[0];
  window.SDJ.remix.load(remixRec);
  ['chops', 'topline', 'sweep', 'stutter', 'riser'].forEach((k) => window.SDJ.remix.toggle(k));
  const remixCode = window.SDJ.remix.compose();
  check('remix composes balanced Strudel with all overlays',
    !!remixCode && balanced(remixCode) && remixCode.indexOf('stack(') >= 0, remixCode);
  check('remix nests the record as a bed', remixCode.indexOf(remixRec.code.split('\n')[1]) >= 0);

  // crank the crowd up (pad energy to max) and let the loop evolve a few ticks
  check('crowd pad rendered', !!doc.getElementById('pad'));
  window.SDJ.setCrowd(1, 0); // full energy, neutral warmth
  const before = evalCalls.length;
  await new Promise((r) => setTimeout(r, 2500)); // ~2 loop ticks at 1s

  check('evolves over time (more evaluates)', evalCalls.length > before, `before=${before} after=${evalCalls.length}`);
  check('all evaluated code balanced', evalCalls.every(balanced));
  check('DJ moves logged', doc.querySelectorAll('#log li').length >= 1);
  check('set log captured ticks', !!(window.SDJ.SetLog && window.SDJ.SetLog.count() > 0),
    'count=' + (window.SDJ.SetLog ? window.SDJ.SetLog.count() : 'none'));
  check('set log stats compute', !!(window.SDJ.SetLog && window.SDJ.SetLog.stats().ticks >= 1));

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

  // A&R must not dead-end: killing *reworks* only spaces them out (a killed *add*
  // stays out), so while any layer is playable the DJ always has a next pitch.
  const de = new window.SDJ.DJEngine();
  de.newSong();
  de.voteReset();
  for (let k = 0; k < 3; k++) { const pp = de.proposeChange(); if (!pp) break; de.acceptChange(); }
  let deadEnded = false;
  for (let k = 0; k < 40; k++) { const pp = de.proposeChange(); if (!pp) { deadEnded = true; break; } de.rejectChange(); }
  check('A&R never dead-ends while a layer is playable', !deadEnded);

  // ---- A&R DOM flow: turn-based individual review — kill a change, get re-pitched ----
  const voteEvalStart = evalCalls.length;
  doc.getElementById('voteStart').click();
  await sleep(60); // audio already unlocked earlier, so the session opens right away
  check('A&R card shown after start',
    !doc.getElementById('voteCard').hidden && doc.getElementById('voteDesc').textContent.length > 0);
  // the A&R audition carries the pianoroll too, but its code map stays clean
  check('A&R audio carries the pianoroll',
    evalCalls.slice(voteEvalStart).some((c) => c.includes('.pianoroll(')));
  check('A&R code panel omits the pianoroll',
    !doc.getElementById('voteCode').innerHTML.includes('pianoroll'));
  check('A&R cover art rendered', doc.getElementById('voteArt').innerHTML.indexOf('<svg') === 0);
  check('A&R code highlights the touched line', doc.getElementById('voteCode').innerHTML.includes('vc-hl'));
  const histBefore = doc.querySelectorAll('#voteHistory li').length;
  doc.getElementById('voteDown').click();
  await sleep(20);
  check('kill logs a decision and re-pitches',
    doc.querySelectorAll('#voteHistory li').length === histBefore + 1 && !doc.getElementById('voteCard').hidden);

  // walk several accepts so the DJ pitches the fuller vocabulary (FX / double /
  // fill) and confirm every card stays valid (desc + cover art) — fill maps to a
  // pseudo-lane, so this guards the card against the new move kinds.
  let cardOk = true, kinds = 0;
  for (let k = 0; k < 14; k++) {
    doc.getElementById('voteUp').click();
    await sleep(10);
    if (doc.getElementById('voteCard').hidden) break; // settled — fine
    kinds++;
    if (!doc.getElementById('voteDesc').textContent.length ||
        doc.getElementById('voteArt').innerHTML.indexOf('<svg') !== 0) { cardOk = false; break; }
  }
  check('A&R cards stay valid across the fuller vocabulary', cardOk, `pitches=${kinds}`);
  check('A&R evaluations stayed balanced', evalCalls.every(balanced));

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
  check('record shelf renders cover tiles', doc.querySelectorAll('#remixShelf .shelf-item').length >= 1);
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
