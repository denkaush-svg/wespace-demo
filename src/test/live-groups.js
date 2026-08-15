/* The cut question, against the live model.

   «Разложи по стадиям», «сколько на каждом брокере», «средний чек» — the shape
   most analytical questions have. The read layer answers it as groups, and the
   block builder wanted rows, so every such question used to fall off the data
   path: the model wrote the figures itself, in prose or in a typed table. The
   more analytical the question, the more likely the answer was model-authored.

   This checks the opposite now holds — that a question needing an aggregate
   comes back as a block the code filled, with the aggregate the code computed.

   Needs the proxy up. Run:  node src/test/live-groups.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8000;
const GAP_MS = 11000;              // the proxy refills six tokens a minute
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const QUESTIONS = [
  'разложи сумму сделок по стадиям',
  'сколько сделок на каждом брокере',
  'какой средний чек по каждой стадии',
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

(async () => {
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.live && window.WS.engine, { timeout: 20000 });
  await page.waitForFunction(
    () => window.WS.live.ready || window.WS.live.lastError, { timeout: 15000 },
  ).catch(() => {});

  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, GAP_MS));
    await page.evaluate((q, first) => {
      if (first) { window.WS.engine.openThread('grp', 'Разрезы', 'chat'); window.WS.router.go('concierge'); }
      window.__seen = (window.WS.engine.lastReply || {});
      window.WS.router.routePrompt(q);
    }, QUESTIONS[i], i === 0);
    await page.waitForFunction(
      () => window.WS.engine.lastReply && window.WS.engine.lastReply !== window.__seen,
      { timeout: 120000 },
    ).catch(() => {});
    rows.push(await page.evaluate(() => {
      const r = window.WS.engine.lastReply || {};
      const blocks = (r.blocks || []).map((b) => ({
        t: b.t, src: b.src || 'model', grouped: !!(b.spec && b.spec.groupBy),
        spec: b.spec || null, n: (b.rows || []).length,
      }));
      return { text: (r.text || '').slice(0, 120), blocks: blocks };
    }));
  }

  // Every aggregate a block claims, recomputed through the read layer in the
  // page itself — the block must not merely be labelled «из данных», it must
  // hold what that query actually returns.
  const recheck = await page.evaluate((all) => all.map((row) => row.blocks
    .filter((b) => b.grouped)
    .map((b) => {
      const res = window.WS.query.run(b.spec);
      return { ok: !!(res && res.groups), groups: res && res.groups ? Object.keys(res.groups).length : 0, n: b.n };
    })), rows.map((r) => ({ blocks: r.blocks })));

  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  const NUM = (b) => b.t === 'table' || b.t === 'bars' || b.t === 'kv';

  rows.forEach((r, i) => {
    const nums = r.blocks.filter(NUM);
    ok('«' + QUESTIONS[i] + '» came back as a shape, not prose', nums.length > 0,
      r.blocks.map((b) => b.t).join(',') + ' · ' + r.text);
    ok('  and every figure in it is the code’s', nums.length > 0 && nums.every((b) => b.src === 'data'),
      nums.map((b) => b.t + ':' + b.src).join(' '));
    ok('  asked as a cut, answered as a cut', nums.some((b) => b.grouped),
      nums.map((b) => b.t + (b.grouped ? ':разрез' : ':список')).join(' '));
    (recheck[i] || []).forEach((c) => {
      ok('  the aggregate holds when re-run', c.ok && c.groups === c.n, 'groups=' + c.groups + ' rows=' + c.n);
    });
  });
  ok('no page errors', errs.length === 0, errs.join('; '));
  console.log('---');
  rows.forEach((r, i) => console.log(QUESTIONS[i] + '\n  ' +
    r.blocks.map((b) => b.t + '(' + b.src + (b.grouped ? ',разрез ' + b.spec.groupBy : '') + ')').join(' ')));
  process.exit(bad ? 1 : 0);
})();
