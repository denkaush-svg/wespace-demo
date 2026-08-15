/* The Concierge going outside the stand, for real.

   Search was denied to everyone, and the `external` flag on a mode only removed
   a sentence from the prompt — the CLI was launched with the same deny list
   either way. Now the flag decides what the model is given, and a figure that
   comes back from out there cannot be passed off as one the code computed: it
   carries the host it came from and as of when.

   Needs the proxy up. Run:  node src/test/live-web.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8000;
const GAP_MS = 12000;

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
  { mode: 'cma', depth: 'think', q: 'какая сейчас средняя цена за квадратный метр в JVC по рынку', web: true },
  { mode: 'qual', depth: 'think', q: 'какая сейчас средняя цена за квадратный метр в JVC по рынку', web: false },
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
    const t0 = Date.now();
    await page.evaluate((turn, first) => {
      if (first) { window.WS.engine.openThread('web', 'Наружу', 'chat'); window.WS.router.go('concierge'); }
      window.WS.store.cgMode = turn.mode;
      window.WS.store.cgDepth = turn.depth;
      window.__seen = (window.WS.engine.lastReply || {});
      window.WS.router.routePrompt(turn.q);
    }, t, i === 0);
    await page.waitForFunction(
      () => window.WS.engine.lastReply && window.WS.engine.lastReply !== window.__seen,
      { timeout: 200000 },
    ).catch(() => {});
    out.push(await page.evaluate(() => {
      const r = window.WS.engine.lastReply || {};
      const blocks = (r.blocks || []).map((b) => ({ t: b.t, src: b.src || 'model', source: b.source || '', asOf: b.asOf || '' }));
      return { kind: r.kind, mode: r.mode, blocks: blocks,
        chat: (document.getElementById('chat').textContent || ''),
        text: (r.text || '').slice(0, 220) };
    }));
    out[out.length - 1].ms = Date.now() - t0;
  }

  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  const [withWeb, without] = out;
  const webBlocks = withWeb.blocks.filter((b) => b.src === 'web');

  ok('a market question in a searching mode comes back with an outside figure',
    webBlocks.length > 0, withWeb.blocks.map((b) => b.t + ':' + b.src).join(' ') + ' · ' + withWeb.text);
  ok('and it names the host it came from',
    webBlocks.every((b) => /\./.test(b.source)), JSON.stringify(webBlocks.map((b) => b.source + (b.asOf ? '@' + b.asOf : ''))));
  ok('the card says outside, not «из данных»',
    withWeb.chat.indexOf('из внешнего источника') >= 0, withWeb.chat.slice(-260, -60));
  // The trap worth naming in Dubai: an asking-price index and a median of
  // closed sales differ by 10–15%.
  ok('the answer distinguishes what kind of price it just quoted',
    /предложен|объявлен|сделк|закрыт|asking/i.test(withWeb.text + ' ' + withWeb.chat), withWeb.text);
  ok('a mode without search does not invent a sourced figure',
    without.blocks.filter((b) => b.src === 'web').length === 0,
    without.blocks.map((b) => b.t + ':' + b.src).join(' ') + ' · ' + without.text);
  ok('no page errors', errs.length === 0, errs.join('; '));

  console.log('---');
  out.forEach((r, i) => console.log(TURNS[i].mode + ' (' + Math.round(r.ms / 1000) + 's) → ' +
    r.blocks.map((b) => b.t + '(' + b.src + (b.source ? ':' + b.source : '') + ')').join(' ') + '\n  ' + r.text.slice(0, 160)));
  process.exit(bad ? 1 : 0);
})();
