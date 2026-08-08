/* Drives the built stand in a real browser against the LIVE proxy.
   Serves the file over http (the proxy answers the page's origin, and a
   file:// page has none), types a question, and checks that a model actually
   spoke — not the offline planner wearing its coat.

   Needs the proxy up. Run:  node src/test/live-shot.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(ROOT, '.shots');
const PORT = 8000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const serve = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('no');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });

  // Reaching into the stand before it has booted throws inside the browser and
  // takes the run down with no checks reported — wait for it to exist first.
  await page.waitForFunction(
    () => window.WS && window.WS.agent && window.WS.router && window.WS.engine,
    { timeout: 20000 },
  );
  // The probe runs on boot. Wait for its verdict — either way it sets one.
  await page.waitForFunction(
    () => window.WS && window.WS.live && (window.WS.live.ready || window.WS.live.lastError),
    { timeout: 15000 },
  ).catch(() => {});
  const ready = await page.evaluate(() => ({ ready: window.WS.live.ready, url: window.WS.live.url, err: window.WS.live.lastError }));

  const Q = 'какие сделки ближе всего к закрытию и что мешает';
  await page.evaluate((q) => {
    window.WS.engine.openThread('live', 'Живая проверка', 'chat');
    window.WS.router.go('concierge');
    window.__det = window.WS.agent.ask(q).text || '';
    window.WS.router.routePrompt(q);
  }, Q);

  await page.waitForFunction(
    () => document.getElementById('chat').querySelectorAll('[data-agev],[data-agok]').length > 0,
    { timeout: 90000 },
  ).catch(() => {});

  const info = await page.evaluate(() => {
    const c = document.getElementById('chat');
    const r = window.WS.engine.lastReply || {};
    return {
      det: window.__det,
      live: r.text || '',
      kind: r.kind,
      evidence: c.querySelectorAll('[data-agev]').length,
      next: c.querySelectorAll('[data-agnext]').length,
      misses: window.WS.live.misses,
      hasHead: window.WS.agent.hasAsyncHead(),
    };
  });

  // ---- the write path, driven by the live model ----
  // A question proves the model can read. This proves that when it decides to
  // change something, the change still waits for a person's click.
  const feedBefore = await page.evaluate(() =>
    ((window.WS.store.data.contactTimeline['c_anna'] || []).length));

  await page.evaluate(() =>
    window.WS.router.routePrompt('запиши по Анне Ковалёвой: созвонились, обсудили график платежей'));
  await page.waitForFunction(
    () => document.getElementById('chat').querySelector('[data-agok]'),
    { timeout: 90000 },
  ).catch(() => {});

  const proposed = await page.evaluate(() => ({
    button: !!document.getElementById('chat').querySelector('[data-agok]'),
    kind: (window.WS.engine.lastReply || {}).kind,
    said: (window.WS.engine.lastReply || {}).text || '',
    feed: (window.WS.store.data.contactTimeline['c_anna'] || []).length,
  }));

  await page.evaluate(() => {
    const b = document.getElementById('chat').querySelector('[data-agok]');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const applied = await page.evaluate(() => ({
    feed: (window.WS.store.data.contactTimeline['c_anna'] || []).length,
    text: (document.getElementById('chat').textContent || '').indexOf('Применено') >= 0,
  }));
  await page.screenshot({ path: path.join(SHOTS, 'concierge-live-model.png') });
  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  ok('the proxy is reachable from the page', ready.ready === true, ready.url + ' ' + (ready.err || ''));
  ok('a model answered, not the offline planner', !!info.live && info.live !== info.det, info.live.slice(0, 110));
  ok('the live head survived the exchange', info.hasHead === true && info.misses === 0, 'misses=' + info.misses);
  ok('the answer carries evidence or an action', info.evidence + (info.kind === 'proposal' ? 1 : 0) > 0,
    'chips=' + info.evidence + ' kind=' + info.kind);
  ok('the reply offers follow-ups', info.next > 0, 'chips=' + info.next);
  ok('a write instruction reaches a proposal', proposed.button && proposed.kind === 'proposal',
    'kind=' + proposed.kind + ' said=' + proposed.said.slice(0, 70));
  ok('nothing is written before the click', proposed.feed === feedBefore,
    'before=' + feedBefore + ' at-proposal=' + proposed.feed);
  ok('the click writes it', applied.feed === feedBefore + 1,
    'before=' + feedBefore + ' after=' + applied.feed);
  ok('the chat says it applied', applied.text === true);
  ok('no page errors', errs.length === 0, errs.join('; '));
  console.log('---\noffline would say: ' + info.det.slice(0, 120));
  console.log('the model said:     ' + info.live.slice(0, 200));
  console.log('screenshot -> .shots/concierge-live-model.png');
  process.exit(bad ? 1 : 0);
})();
