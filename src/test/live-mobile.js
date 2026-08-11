/* The Concierge on a phone, with a live answer in it.

   Live replies are prose several lines long, where the stand used to show
   short prepared cards — so the chat has to be re-checked at phone width
   with real text in it, not with the placeholder it was designed against.

   Run:  node src/test/live-mobile.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(ROOT, '.shots');
const PORT = 8000;                // the proxy answers this origin; 8001 is not on its list
const SIZES = [{ w: 390, h: 844, name: 'iphone' }, { w: 360, h: 800, name: 'android' }];
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

  let bad = 0;
  const ok = (n, c, d) => { console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!c) bad++; };

  for (const s of SIZES) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.setViewport({ width: s.w, height: s.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.WS && window.WS.agent && window.WS.router);
    await wait(1200);

    await page.evaluate(() => {
      window.WS.engine.openThread('mob', 'Телефон', 'chat');
      window.WS.router.go('concierge');
      window.WS.router.routePrompt('что горит сегодня и с чего начать');
    });
    // Both: the reply exists AND it is on screen. Checking only the first
    // measured an empty chat once, when the answer navigated the stand away.
    await page.waitForFunction(
      () => ((window.WS.engine.lastReply || {}).text || '').length > 40
        && document.querySelectorAll('#chat .msg').length > 0,
      { timeout: 90000 },
    ).catch(() => {});
    await wait(400);

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const chat = document.getElementById('chat');
      const msgs = chat ? Array.from(chat.querySelectorAll('.msg')) : [];
      const chips = chat ? Array.from(chat.querySelectorAll('[data-agev],[data-agnext]')) : [];
      const over = (el) => el.getBoundingClientRect().right > window.innerWidth + 1;
      return {
        pageWide: doc.scrollWidth > window.innerWidth + 1,
        scrollWidth: doc.scrollWidth,
        inner: window.innerWidth,
        byModel: window.WS.live.served > 0,
        msgs: msgs.length,
        msgOver: msgs.filter(over).length,
        chips: chips.length,
        chipOver: chips.filter(over).length,
        // A reply is useless if the composer covers it.
        replyBottom: msgs.length ? Math.round(msgs[msgs.length - 1].getBoundingClientRect().bottom) : 0,
        viewH: window.innerHeight,
      };
    });
    await page.screenshot({ path: path.join(SHOTS, 'mobile-' + s.name + '.png') });
    await page.close();

    const tag = s.name + ' ' + s.w + '×' + s.h;
    ok(tag + ' · the page does not scroll sideways', !m.pageWide, m.scrollWidth + ' > ' + m.inner);
    ok(tag + ' · a model answered', m.byModel === true);
    ok(tag + ' · no message runs off the edge', m.msgOver === 0, m.msgOver + '/' + m.msgs);
    ok(tag + ' · no chip runs off the edge', m.chipOver === 0, m.chipOver + '/' + m.chips);
    ok(tag + ' · the reply fits above the fold or scrolls to it', m.replyBottom > 0, 'bottom=' + m.replyBottom);
    ok(tag + ' · no page errors', errs.length === 0, errs.join('; '));
    ok(tag + ' · the answer is still on the Concierge screen', m.msgs > 0, 'messages=' + m.msgs);
    // The proxy refills six tokens a minute; two viewports back to back would
    // measure the throttle instead of the layout.
    await wait(11000);
  }

  await browser.close();
  serve.close();
  console.log('screenshots -> .shots/mobile-*.png');
  process.exit(bad ? 1 : 0);
})();
