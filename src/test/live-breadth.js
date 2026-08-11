/* Breadth pass: asks the live Concierge the sort of thing a broker actually
   types, and checks that none of it ends in a wall.

   The stand's whole promise is that no question gets "I can't do that here".
   One good answer proves the wiring; this proves the promise.

   Paced to the proxy's own per-address limit, so it measures the Concierge
   rather than the throttle. Run:  node src/test/live-breadth.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8000;
const GAP_MS = 11000;             // the proxy refills 6 tokens a minute
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const QUESTIONS = [
  'сколько у меня сейчас в работе и на какую сумму',
  'что горит сегодня',
  'кто из клиентов давно без касания',
  'какая комиссия набегает по активным сделкам',
  'что показать клиенту с бюджетом до трёх миллионов',
  'посчитай доходность по объекту в Dubai Creek Harbour',
  'какие риски по сделке Виктора',
  'подготовь письмо Игорю по его КП',
  'что вообще происходит с моей воронкой на этой неделе',
  'сколько стоит квадратный метр в Downtown',
];

// If any of these turn up, the Concierge has hit a wall instead of answering.
const WALLS = [
  /не могу/i, /не умею/i, /недоступн/i, /обратитесь/i, /обратись/i,
  /в демо.{0,20}(нет|не работает|недоступ)/i, /я лишь/i, /у меня нет доступа/i,
  /как языковая модель/i, /извините, но/i,
];

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
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.agent && window.WS.router);
  // Readiness is settled per question now, so a cold probe is not a verdict.
  await wait(1200);

  await page.evaluate(() => { window.WS.engine.openThread('breadth', 'Широта', 'chat'); window.WS.router.go('concierge'); });

  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const seen = await page.evaluate(() => (window.WS.engine.lastReply || {}).text || '');
    const servedBefore = await page.evaluate(() => window.WS.live.served);
    await page.evaluate((text) => window.WS.router.routePrompt(text), q);
    await page.waitForFunction(
      (prev) => { const r = window.WS.engine.lastReply || {}; return (r.text || '') && (r.text !== prev); },
      { timeout: 90000 }, seen,
    ).catch(() => {});
    const r = await page.evaluate(() => {
      const x = window.WS.engine.lastReply || {};
      return { kind: x.kind, text: x.text || '', ev: (x.evidence || []).length, next: (x.next || []).length,
        served: window.WS.live.served, misses: window.WS.live.misses, head: window.WS.agent.hasAsyncHead() };
    });
    rows.push({ q, ...r, byModel: r.served > servedBefore });
    if (i < QUESTIONS.length - 1) await wait(GAP_MS);
  }
  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };

  rows.forEach((r, i) => {
    const wall = WALLS.find((re) => re.test(r.text));
    ok((i + 1) + '. ' + r.q, !!r.text && !wall && r.next > 0 && r.byModel,
      (wall ? 'СТЕНА: ' + wall + ' — ' : '') + (r.byModel ? '' : 'ОТКАТ НА ПЛАНИРОВЩИК — ') +
      r.kind + ' · ' + r.text.slice(0, 90));
  });
  ok('the live head lasted the whole pass', rows.length && rows[rows.length - 1].head === true,
    'misses=' + (rows.length ? rows[rows.length - 1].misses : '?'));
  ok('no page errors', errs.length === 0, errs.join('; '));

  console.log('\n--- replies ---');
  rows.forEach((r, i) => console.log('\n' + (i + 1) + '. ' + r.q + '\n   → ' + r.text.replace(/\s+/g, ' ').slice(0, 300)));
  process.exit(bad ? 1 : 0);
})();
