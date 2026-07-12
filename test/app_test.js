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

  // boot ran on load. Crate should be rendered from seeded storage.
  check('crate rendered from storage', doc.querySelectorAll('#crate .crate-item').length === 1);
  check('crate has play + delete buttons', doc.querySelectorAll('#crate .crate-item button').length === 2);

  // start the set
  doc.getElementById('startBtn').click();
  await sleep(80); // let async startSet resolve

  check('evaluate called on start', evalCalls.length >= 1);
  check('first evaluated code is balanced', evalCalls.length && balanced(evalCalls[0]), evalCalls[0]);
  check('track name populated', doc.getElementById('trackName').textContent !== '—');
  check('code panel populated', doc.getElementById('code').textContent.includes('stack'));
  check('code highlighted with spans', doc.getElementById('code').innerHTML.includes('<span class="fn"'));
  check('stage chips rendered', doc.querySelectorAll('#stageChips .chip').length === 7);

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

  // ---- A&R DOM flow: start a session, kill a change, get re-pitched ----
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

  // ---- highlight escapes mini-notation < > ----
  engine.song.stage = 6; engine.song.variation = 6;
  const sample = engine.render();
  check('render contains mini-notation <>', sample.includes('<'));

  // ---- global stop really stops (header ⏹) ----
  const hushBefore = hushCalls;
  doc.getElementById('tpStop').click();
  await sleep(20);
  check('global stop hushes and clears the transport',
    hushCalls > hushBefore && doc.getElementById('transport').hidden);

  // report
  let pass = 0;
  for (const r of results) {
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
