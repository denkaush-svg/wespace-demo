/* Asks the live Concierge for a report, then opens the file it produced at
   phone width. A broker forwards this document to a client, so it is checked
   as a document — not as a string that came back from a model.

   Needs the proxy up. Run:  node src/test/live-report.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(ROOT, '.shots');
const PORT = 8000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const serve = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('no');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.agent && window.WS.router);
  await wait(1200);

  await page.evaluate(() => {
    window.WS.engine.openThread('rp', 'Отчёт', 'chat');
    window.WS.router.go('concierge');
    window.WS.router.routePrompt('собери отчёт по рынку Дубая для инвестора — куда заходить и почему');
  });
  await page.waitForFunction(
    () => document.querySelector('#chat [data-rpsave], #chat [data-agev]'),
    { timeout: 120000 },
  ).catch(() => {});
  await wait(600);

  const info = await page.evaluate(() => {
    const r = window.WS.engine.lastReply || {};
    const rep = r.report ? window.WS.report.get(r.report.id) : null;
    return {
      served: window.WS.live.served,
      hasReport: !!r.report,
      name: r.report && r.report.name,
      count: r.report && r.report.count,
      lead: r.text || '',
      html: rep ? rep.html : '',
      offered: document.querySelectorAll('#chat [data-rpsave]').length,
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'report-offer.png') });

  // The file is opened as a file, on a phone, because that is how a client
  // will meet it — not as a string that came back from a model.
  let mobile = null;
  if (info.html) {
    const file = path.join(SHOTS, 'report.html');
    fs.writeFileSync(file, info.html, 'utf8');
    const doc = await browser.newPage();
    const docErrs = [];
    doc.on('pageerror', (e) => docErrs.push(String(e)));
    await doc.setViewport({ width: 390, height: 1400, isMobile: true, deviceScaleFactor: 2 });
    await doc.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await wait(700);
    mobile = await doc.evaluate(() => {
      const V = window.innerWidth;
      // A wide table is meant to scroll inside its own box; that is a choice,
      // not an overflow. Only what escapes the page counts.
      const scrollable = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
        return false;
      };
      const escaped = Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > V + 1 && !scrollable(el));
      return {
        sideways: document.documentElement.scrollWidth > V + 1,
        wide: escaped.length,
        who: escaped.slice(0, 4).map((el) => el.tagName.toLowerCase() + '.' + (el.className || '')),
        headings: document.querySelectorAll('h2').length,
        tables: document.querySelectorAll('table').length,
        bars: document.querySelectorAll('.bar').length,
      };
    });
    mobile.errs = docErrs;
    await doc.screenshot({ path: path.join(SHOTS, 'report-mobile.png') });
    await doc.close();
  }
  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  ok('a model answered', info.served > 0);
  ok('asking for a report produces a file', info.hasReport === true, info.lead.slice(0, 90));
  ok('the file is offered in the chat', info.offered === 1);
  ok('the report has substance', info.count >= 3 && info.html.length > 2000,
    'blocks=' + info.count + ' bytes=' + info.html.length);
  ok('demo figures are labelled inside the file', /демонстрационные/.test(info.html));
  ok('no page errors', errs.length === 0, errs.join('; '));
  if (mobile) {
    ok('the file does not scroll sideways on a phone', !mobile.sideways);
    ok('nothing in it escapes the page', mobile.wide === 0, 'over=' + mobile.wide + ' ' + (mobile.who || []).join(', '));
    ok('it kept its structure', mobile.headings > 0 && (mobile.tables + mobile.bars) > 0,
      'h2=' + mobile.headings + ' tables=' + mobile.tables + ' bars=' + mobile.bars);
    ok('the file opens without errors', mobile.errs.length === 0, mobile.errs.join('; '));
  } else { ok('the file could be opened', false, 'no report produced'); }
  console.log('---\nfile: ' + info.name + '\nlead: ' + info.lead.slice(0, 200));
  console.log('saved -> .shots/report.html');
  process.exit(bad ? 1 : 0);
})();
