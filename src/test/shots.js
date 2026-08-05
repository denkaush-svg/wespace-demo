/* Visual check of the event feed in a real browser (Chromium via puppeteer).
   Captures the contact card (overview + history) and a previously-empty deal card,
   at a laptop viewport and a narrow one, and reports any console errors.
   Run:  npm install && npm run shots [-- <path-or-url>]
*/
const path = require('path');
const D = path.join(__dirname, '..');          // sources live in src/
const puppeteer = require('puppeteer');

// Default target is the built artifact at the repo root.
const TARGET = process.argv[2] || path.join(D, '..', 'index.html');
const OUT = path.join(D, '..', '.shots');
require('fs').mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'narrow', width: 1100, height: 800 },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  let shots = 0;

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(vp.name + ' console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push(vp.name + ' pageerror: ' + e.message));
    const url = /^https?:\/\//.test(TARGET) ? TARGET : 'file:///' + TARGET.replace(/\\/g, '/');
    await page.goto(url, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 900));

    // Contact card — overview (feed preview) then history (full ribbon)
    await page.evaluate(() => window.WS.ui.clientCard('c_anna'));
    await new Promise((r) => setTimeout(r, 400));
    const ovRows = await page.evaluate(() => document.querySelectorAll('.tl-row').length);
    await page.screenshot({ path: OUT + '/' + vp.name + '-contact-overview.png', fullPage: true }); shots++;

    await page.evaluate(() => window.WS.ui.setEntityTab('contact', 'c_anna', 'history'));
    await new Promise((r) => setTimeout(r, 400));
    const hiRows = await page.evaluate(() => document.querySelectorAll('.tl-row').length);
    const srcTags = await page.evaluate(() => document.querySelectorAll('.tl-src').length);
    await page.screenshot({ path: OUT + '/' + vp.name + '-contact-history.png', fullPage: true }); shots++;

    // A deal that had NO timeline before the fix
    await page.evaluate(() => window.WS.ui.dealCard('d_lease'));
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => window.WS.ui.setEntityTab('deal', 'd_lease', 'history'));
    await new Promise((r) => setTimeout(r, 400));
    const dealRows = await page.evaluate(() => document.querySelectorAll('.tl-row').length);
    await page.screenshot({ path: OUT + '/' + vp.name + '-deal-lease-history.png', fullPage: true }); shots++;

    // Event form
    await page.evaluate(() => window.WS.ui.openEventForm('contact', 'c_anna'));
    await new Promise((r) => setTimeout(r, 400));
    const chips = await page.evaluate(() => document.querySelectorAll('[data-fetype]').length);
    await page.screenshot({ path: OUT + '/' + vp.name + '-event-form.png', fullPage: false }); shots++;

    // Overflow guard: no horizontal scroll introduced
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    console.log(vp.name + ': contactOverviewRows=' + ovRows + ' contactHistoryRows=' + hiRows +
      ' dealSrcTags=' + srcTags + ' dealLeaseRows=' + dealRows + ' formChips=' + chips + ' hOverflow=' + overflow + 'px');
    await page.close();
  }

  await browser.close();
  console.log('screenshots: ' + shots + ' -> ' + OUT);
  if (errors.length) { console.log('\nBROWSER ERRORS:'); errors.forEach((e) => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('no browser errors');
})();
