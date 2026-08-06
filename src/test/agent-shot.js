/* Drives the built stand in a real browser: types two requests into the Concierge,
   checks the controls actually render, and saves a screenshot to .shots/.
   Run:  node src/test/agent-shot.js
*/
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const FILE = 'file://' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, '.shots');

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(FILE, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 900));

  await page.evaluate(() => {
    window.WS.engine.openThread('shot', 'Проверка', 'chat');
    window.WS.router.go('concierge');
    window.WS.router.routePrompt('сколько сделок в работе и на какую сумму');
  });
  await new Promise((r) => setTimeout(r, 1700));
  await page.evaluate(() => window.WS.router.routePrompt('запиши по Анне: обсудили график платежей'));
  await new Promise((r) => setTimeout(r, 1700));

  const info = await page.evaluate(() => {
    const c = document.getElementById('chat');
    return {
      evidence: c.querySelectorAll('[data-agev]').length,
      confirm: c.querySelectorAll('[data-agok]').length,
      next: c.querySelectorAll('[data-agnext]').length,
      text: (c.textContent || '').replace(/\s+/g, ' ').slice(0, 320),
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'concierge-live.png') });
  await browser.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  ok('answer carries evidence chips', info.evidence > 0, 'chips=' + info.evidence);
  ok('write request offers a confirm button', info.confirm > 0, 'buttons=' + info.confirm);
  ok('reply offers follow-up chips', info.next > 0, 'chips=' + info.next);
  ok('no page errors', errs.length === 0, errs.join('; '));
  console.log('---\n' + info.text);
  console.log('screenshot -> .shots/concierge-live.png');
  process.exit(bad ? 1 : 0);
})();
