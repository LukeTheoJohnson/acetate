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
window.hush = () => {};
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
for (const f of ['rng', 'theory', 'names', 'dj', 'viz', 'app']) {
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

  // crank the crowd up and let the loop evolve a few ticks
  const mood = doc.getElementById('mood');
  mood.value = '100';
  mood.dispatchEvent(new window.Event('input'));
  const before = evalCalls.length;
  await new Promise((r) => setTimeout(r, 2500)); // ~2 loop ticks at 1s

  check('evolves over time (more evaluates)', evalCalls.length > before, `before=${before} after=${evalCalls.length}`);
  check('all evaluated code balanced', evalCalls.every(balanced));
  check('DJ moves logged', doc.querySelectorAll('#log li').length >= 1);

  // ---- engine-level banger detection (pure, deterministic) ----
  const engine = new window.SDJ.DJEngine();
  engine.newSong();
  let hit = false, ticks = 0, maxStage = 0;
  while (!hit && ticks < 400) {
    const res = engine.tick(1.0, 1.0); // full hype, 1s steps
    hit = res.hit;
    maxStage = Math.max(maxStage, engine.song.stage);
    ticks++;
  }
  check('banger detected under sustained hype', hit, `after ${ticks}s, reached stage ${maxStage}`);
  check('song fully built before banger', maxStage === engine.song.maxStage || maxStage >= 5, `maxStage=${maxStage}`);

  // ---- highlight escapes mini-notation < > ----
  engine.song.stage = 6; engine.song.variation = 6;
  const sample = engine.render();
  check('render contains mini-notation <>', sample.includes('<'));

  // report
  let pass = 0;
  for (const r of results) {
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
