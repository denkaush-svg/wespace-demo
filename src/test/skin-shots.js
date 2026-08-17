/* Side-by-side renders of the stand in its current skin and in the WEWALL skin.
   Same screens, same viewport, same data — only the stylesheet differs, so the
   pair is an honest read on whether the landing language survives contact with
   a dense product UI.
   Run:  node src/test/skin-shots.js
*/
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.shots', 'skin');
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { tag: 'now', file: path.join(ROOT, 'index.html') },
  { tag: 'ww', file: path.join(ROOT, 'index-wewall.html') },
];

const SCREENS = [
  { name: 'pulse', run: async (p) => { await p.evaluate(() => window.WS.router.go('start')); } },
  { name: 'deals', run: async (p) => { await p.evaluate(() => window.WS.router.go('clients')); } },
  { name: 'clients', run: async (p) => { await p.evaluate(() => { window.WS.store.clientsTab = 'contacts'; window.WS.router.go('clients'); }); } },
  { name: 'objects', run: async (p) => { await p.evaluate(() => window.WS.router.go('objects')); } },
  { name: 'concierge', run: async (p) => { await p.evaluate(() => window.WS.router.go('concierge')); } },
  { name: 'deal-card', run: async (p) => { await p.evaluate(() => window.WS.ui.dealCard('d_viktor')); } },
  { name: 'analytics', run: async (p) => { await p.evaluate(() => window.WS.router.go('analytics')); } },
  { name: 'valuation', run: async (p) => { await p.evaluate(() => window.WS.router.go('valuation')); } },
];

const VP = { width: 1440, height: 950 };

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const errors = [];

  for (const t of TARGETS) {
    const page = await browser.newPage();
    await page.setViewport({ ...VP, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(t.tag + ' pageerror: ' + e.message));
    await page.goto('file:///' + t.file.replace(/\\/g, '/'), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1200));

    for (const s of SCREENS) {
      await s.run(page);
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: path.join(OUT, s.name + '--' + t.tag + '.png'), fullPage: false });
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(t.tag + ': screens=' + SCREENS.length + ' hOverflow=' + overflow + 'px');
    await page.close();
  }

  await browser.close();
  console.log('-> ' + OUT);
  if (errors.length) { errors.forEach((e) => console.log('  x ' + e)); process.exit(1); }
  console.log('no browser errors');
})();
