// One-off: recapture the five README screenshots against the Serato reskin.
// Drives the app via its agent-native SDJ.* API. Run with the dev server up:
//   python serve.py 8124   (in another shell)
//   node capture-shots.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:8124';
const VW = { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VW, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a batch of crate records in-page (engine drives the genome), then persist
// them to localStorage so boot() renders the crate and the remix shelf.
async function seedCrate() {
  await page.evaluate(() => {
    const specs = [
      [0xC0FFEE, 'drill', 'Neon Melt'],
      [0x5EED, 'house', 'Graphite'],
      [0xBEEF, 'techno', 'Amber Room'],
      [0x1337, 'loFi', 'Dubplate 03'],
    ];
    const recs = specs.map(([seed, genre, name]) => {
      const e = new window.SDJ.DJEngine();
      e.masterSeed = seed; e.genrePref = genre; e.newSong();
      for (let i = 0; i < 24 && e.song.genome.active.filter(Boolean).length < 5; i++) {
        if (!e.proposeChange()) break; e.acceptChange();
      }
      return {
        id: 'shot-' + seed.toString(16), name,
        key: e.song.key, scaleType: e.song.scaleType, bpm: e.song.bpm, cps: e.song.cps,
        code: e.render(), genome: JSON.parse(JSON.stringify(e.song.genome)),
        art: { seed: seed % 97, layer: 0, variant: seed % 5 },
        approval: 72 + (seed % 26), savedAt: Date.now() - (seed % 100000),
      };
    });
    window.localStorage.setItem('sdj.crate', JSON.stringify(recs));
  });
}

async function shot(name) {
  await page.screenshot({ path: `screenshots/${name}.png` });
  console.log('shot', name);
}

// 0) boot once, seed the crate, reload so the library + shelf are populated
await page.goto(BASE + '/#crate', { waitUntil: 'load' });
await wait(400);
await seedCrate();

// 1) MENU
await page.goto(BASE + '/#menu', { waitUntil: 'load' });
await wait(900);
await shot('01-menu');

// 2) LIVE — start a deterministic drill set and build it up
await page.goto(BASE + '/#live', { waitUntil: 'load' });
await wait(500);
await page.evaluate(() => { window.SDJ.engine.masterSeed = 0xC0FFEE; });
await page.click('#startBtn').catch(() => {});
await wait(1600); // let initStrudel + first render settle
await page.evaluate(() => { try { window.SDJ.setGenre('drill'); } catch (e) {} });
await page.evaluate(async () => {
  for (let i = 0; i < 8; i++) {
    const st = window.SDJ.engine.state();
    if (st.activeCount >= 5 || window.SDJ.live.pitching() === 'save') break;
    window.SDJ.live.approve();
    await new Promise((r) => setTimeout(r, 180));
  }
});
await wait(500);
await shot('02-live');

// 3) PRESS — open the pressing modal on the built track
await page.evaluate(() => {
  try {
    if (window.SDJ.live.pitching() === 'save') window.SDJ.live.skip();
    window.SDJ.press.open();
    const n = document.getElementById('pressName');
    if (n) { n.value = 'Neon Melt'; n.dispatchEvent(new Event('input')); }
  } catch (e) {}
});
await wait(500);
await shot('03-press');
await page.evaluate(() => { try { window.SDJ.press.cancel(); } catch (e) {} });

// 4) CRATE — the seeded library
await page.goto(BASE + '/#crate', { waitUntil: 'load' });
await wait(700);
await shot('04-crate');

// 5) REMIX — load two sleeves onto the decks, blend, arm
await page.goto(BASE + '/#remix', { waitUntil: 'load' });
await wait(500);
await page.evaluate(() => {
  const crate = JSON.parse(window.localStorage.getItem('sdj.crate') || '[]');
  if (crate[0]) window.SDJ.remix.load('a', crate[0]);
  if (crate[1]) window.SDJ.remix.load('b', crate[1]);
  window.SDJ.remix.cross(0.5);
  window.SDJ.remix.filter('a', -0.4);
  window.SDJ.remix.arm('b');
});
await wait(700);
await shot('05-remix');

await browser.close();
console.log('done');
