/* The composer's handles, against the live model.

   The mode pill, the depth segment and the context chips were stored, drawn
   and dropped — the model never saw one of them. A control that changes
   nothing is worse than no control: it teaches the person that the handles on
   this thing are decoration.

   The unit checks prove the wiring. This proves the behaviour: the same
   request answered under two modes, and the same question at two depths.

   Needs the proxy up. Run:  node src/test/live-modes.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8000;
const GAP_MS = 11000;              // the proxy refills six tokens a minute

const serve = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('no');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});

const TURNS = [
  { mode: 'roi', depth: 'think', q: 'переведи сделку Анны на следующую стадию' },
  { mode: 'auto', depth: 'think', q: 'переведи сделку Анны на следующую стадию' },
  { mode: 'auto', depth: 'fast', q: 'разложи сумму сделок по стадиям' },
  { mode: 'auto', depth: 'deep', q: 'разложи сумму сделок по стадиям' },
];

(async () => {
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.live && window.WS.engine, { timeout: 20000 });
  await page.waitForFunction(() => window.WS.live.ready || window.WS.live.lastError, { timeout: 15000 }).catch(() => {});

  const out = [];
  for (let i = 0; i < TURNS.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, GAP_MS));
    const t = TURNS[i];
    await page.evaluate((turn, first) => {
      if (first) { window.WS.engine.openThread('mod', 'Режимы', 'chat'); window.WS.router.go('concierge'); }
      window.WS.store.cgMode = turn.mode;
      window.WS.store.cgDepth = turn.depth;
      window.__seen = (window.WS.engine.lastReply || {});
      window.WS.router.routePrompt(turn.q);
    }, t, i === 0);
    await page.waitForFunction(
      () => window.WS.engine.lastReply && window.WS.engine.lastReply !== window.__seen,
      { timeout: 160000 },
    ).catch(() => {});
    out.push(await page.evaluate(() => {
      const r = window.WS.engine.lastReply || {};
      return { kind: r.kind, mode: r.mode, depth: r.depth, blocks: (r.blocks || []).length,
        askedIn: r.askedIn || '',
        badge: (document.getElementById('chat').textContent || '').indexOf('запрошено вами') >= 0,
        text: (r.text || '').slice(0, 150) };
    }));
  }

  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  const [ro, rw, fast, deep] = out;

  // The instruction is carried out from the analysis mode too — nobody is sent
  // to switch a setting and say it again.
  ok('an instruction given from an analysis mode is carried out',
    ro.kind === 'proposal', ro.kind + ' · ' + ro.text);
  ok('and nobody is told to switch mode and repeat it',
    !/переключ/i.test(ro.text), ro.text);
  ok('the card says which posture it was asked from',
    ro.askedIn === 'Инвест-анализ · ROI' && ro.badge === true, ro.askedIn + ' badge=' + ro.badge);
  ok('the same request in a working mode is also a proposal',
    rw.kind === 'proposal', rw.kind + ' · ' + rw.text);
  ok('and from «Авто» it carries no posture label', !rw.askedIn, rw.askedIn);
  ok('the answer reports the mode the server resolved',
    ro.mode === 'roi' && rw.mode === 'auto', ro.mode + ' / ' + rw.mode);
  ok('«Быстро» keeps the answer short', fast.blocks > 0 && fast.blocks <= 3, 'blocks=' + fast.blocks);
  ok('«Глубоко» returns a fuller one', deep.blocks > fast.blocks,
    'fast=' + fast.blocks + ' deep=' + deep.blocks);
  ok('and each carries the depth it ran at',
    fast.depth === 'fast' && deep.depth === 'deep', fast.depth + ' / ' + deep.depth);
  ok('no page errors', errs.length === 0, errs.join('; '));

  console.log('---');
  out.forEach((r, i) => console.log(TURNS[i].mode + '/' + TURNS[i].depth + ' → ' + r.kind +
    ' · блоков ' + r.blocks + ' · ' + r.text.slice(0, 90)));
  process.exit(bad ? 1 : 0);
})();
