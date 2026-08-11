/* Checks the voice half against the LIVE model, in a real browser.

   Two things can only be seen here. Whether the model actually returns a
   spoken form for a shaped answer — the smoke test proves the wiring, not the
   habit — and whether the listen button appears and speaks in a browser that
   has speech at all. The speaking itself is intercepted: a headless Chrome has
   no voices, and waiting for audio proves nothing anyway.

   Needs the proxy up. Run:  node src/test/live-voice.js
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

  // Intercept the browser's own speech before the stand boots: a headless
  // Chrome has the API and no voices, so the utterances are collected instead
  // of played.
  await page.evaluateOnNewDocument(() => {
    window.__spoken = [];
    // `speechSynthesis` is a read-only accessor on window: plain assignment is
    // silently ignored and the real, voiceless engine keeps the calls.
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancels: 0,
        cancel() { this.cancels += 1; },
        speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); if (u.onend) setTimeout(u.onend, 5); },
        getVoices() { return []; },
      },
    });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });

  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.WS && window.WS.agent && window.WS.router && window.WS.voice,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => window.WS.live && (window.WS.live.ready || window.WS.live.lastError),
    { timeout: 15000 },
  ).catch(() => {});
  const ready = await page.evaluate(() => ({ ready: window.WS.live.ready, url: window.WS.live.url }));

  // A comparison — the case where the answer is a table and reading the screen
  // aloud would be useless.
  const Q = 'сравни районы по доходности и скажи, где лучше брать под аренду';
  await page.evaluate((q) => {
    window.WS.engine.openThread('voice', 'Голос', 'chat');
    window.WS.router.go('concierge');
    window.WS.router.routePrompt(q);
  }, Q);

  await page.waitForFunction(
    () => document.getElementById('chat').querySelectorAll('[data-agsay],[data-agev]').length > 0,
    { timeout: 90000 },
  ).catch(() => {});

  const info = await page.evaluate(() => {
    const r = window.WS.engine.lastReply || {};
    return {
      kind: r.kind,
      text: r.text || '',
      speak: r.speak || '',
      blocks: (r.blocks || []).length,
      button: !!document.getElementById('chat').querySelector('[data-agsay]'),
      canSpeak: window.WS.voice.canSpeak(),
    };
  });

  await page.evaluate(() => {
    const b = document.getElementById('chat').querySelector('[data-agsay]');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const said = await page.evaluate(() => ({
    pieces: window.__spoken.length,
    text: window.__spoken.map((u) => u.text).join(' '),
    lang: (window.__spoken[0] || {}).lang,
  }));

  await page.screenshot({ path: path.join(SHOTS, 'concierge-live-voice.png') });
  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };
  ok('the proxy is reachable from the page', ready.ready === true, ready.url);
  ok('the browser can speak at all', info.canSpeak === true);
  ok('a shaped answer came back', info.kind === 'answer' && info.blocks > 0, 'blocks=' + info.blocks);
  ok('the model wrote a spoken form for it', !!info.speak, info.speak.slice(0, 120));
  ok('the spoken form is not the screen read out', info.speak !== info.text && info.speak.length < info.text.length + 200);
  ok('the answer offers to be read out', info.button === true);
  ok('pressing it speaks that answer', said.pieces > 0 && said.text.indexOf(info.speak.slice(0, 25)) >= 0,
    said.text.slice(0, 120));
  ok('in Russian', said.lang === 'ru-RU', said.lang);
  ok('no page errors', errs.length === 0, errs.join('; '));
  console.log('---\non screen: ' + info.text.slice(0, 160));
  console.log('out loud : ' + info.speak.slice(0, 160));
  console.log('screenshot -> .shots/concierge-live-voice.png');
  process.exit(bad ? 1 : 0);
})();
