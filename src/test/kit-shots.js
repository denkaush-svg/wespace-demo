/* Renders of the component showcase at desktop, tablet and phone widths,
   plus the hover state of ProjectCard (the one component the stand lacks).
   Run:  node src/test/kit-shots.js
*/
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.shots', 'kit');
fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file:///' + path.join(ROOT, 'kit-wewall.html').replace(/\\/g, '/');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 834, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const errors = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(vp.name + ': ' + e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 700));

    await page.screenshot({ path: path.join(OUT, vp.name + '-full.png'), fullPage: true });

    if (vp.name === 'desktop') {
      const card = await page.$('.pcard .media');
      await card.hover();
      await new Promise((r) => setTimeout(r, 600));
      const box = await page.$('.pcard');
      await box.screenshot({ path: path.join(OUT, 'projectcard-hover.png') });
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(vp.name + ' (' + vp.width + 'px): hOverflow=' + overflow + 'px');
    await page.close();
  }

  await browser.close();
  console.log('-> ' + OUT);
  if (errors.length) { errors.forEach((e) => console.log('  x ' + e)); process.exit(1); }
  console.log('no browser errors');
})();
