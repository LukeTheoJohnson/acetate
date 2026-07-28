import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://localhost:8124/design/live-cassette.html');
await page.waitForTimeout(500);

// Full page at device resolution for maximum detail
await page.screenshot({ path: 'design/live-cassette-hires.png', fullPage: false, scale: 'device' });

// Also crop just the console sidebar
const consoleEl = await page.$('.console-panel');
if (consoleEl) {
  await consoleEl.screenshot({ path: 'design/cassette-console-crop.png' });
}

// Crop the floor section
const floorEl = await page.$('.floor-body');
if (floorEl) {
  await floorEl.screenshot({ path: 'design/cassette-floor-crop.png' });
}

await browser.close();
console.log('Screenshots saved.');
