/* Layout check for the per-message slots.
   Messages are now wrapped in a .msg-slot so a streamed reply can be repainted on its
   own. The slot must not become the flex item, or every message would left-align and
   the agent's own messages would stop reading as theirs. jsdom does no layout, so this
   has to run in a real browser.
   Run:  node src/test/chat-layout.js
*/
const path = require('path');
const puppeteer = require('puppeteer');

const FILE = 'file://' + path.join(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(FILE, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 900));

  const res = await page.evaluate(() => {
    const WS = window.WS;
    WS.engine.openThread('layout:probe', 'Проверка вёрстки', 'chat');
    WS.router.go('concierge');
    WS.engine.pushText('me', 'текст', 'сообщение агента');
    WS.engine.pushMsg('<div class="msg ai"><div class="who">Консьерж</div><div class="bubble">ответ</div></div>');
    const chat = document.getElementById('chat');
    if (!chat) return { error: 'no #chat' };
    const me = chat.querySelector('.msg.me');
    const ai = chat.querySelector('.msg.ai');
    if (!me || !ai) return { error: 'messages not rendered' };
    const cb = chat.getBoundingClientRect();
    const mb = me.getBoundingClientRect();
    const ab = ai.getBoundingClientRect();
    const slot = chat.querySelector('.msg-slot');
    return {
      slots: chat.querySelectorAll('[data-mid]').length,
      slotBoxless: slot ? getComputedStyle(slot).display : null,
      chatRight: Math.round(cb.right), chatLeft: Math.round(cb.left),
      meRight: Math.round(mb.right), meLeft: Math.round(mb.left),
      aiLeft: Math.round(ab.left),
      meWidth: Math.round(mb.width), chatWidth: Math.round(cb.width),
      overflow: Math.max(0, Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth)),
    };
  });

  await browser.close();

  const out = [];
  let bad = 0;
  const ok = (name, cond, detail) => { out.push((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : '')); if (!cond) bad++; };

  if (res.error) { console.log('FAILED: ' + res.error); process.exit(1); }

  ok('two message slots rendered', res.slots === 2, 'slots=' + res.slots);
  ok('slot has no box of its own', res.slotBoxless === 'contents', 'display=' + res.slotBoxless);
  // The agent's own message hugs the right edge; the Concierge's hugs the left.
  ok('agent message is right-aligned', Math.abs(res.chatRight - res.meRight) <= 24,
    'chatRight=' + res.chatRight + ' meRight=' + res.meRight);
  ok('agent message is not full width', res.meWidth < res.chatWidth * 0.95,
    'me=' + res.meWidth + ' chat=' + res.chatWidth);
  ok('concierge message is left-aligned', Math.abs(res.aiLeft - res.chatLeft) <= 24,
    'chatLeft=' + res.chatLeft + ' aiLeft=' + res.aiLeft);
  ok('no page errors', errors.length === 0, errors.join('; '));

  console.log('chat layout — ' + (bad ? 'FAILED ' + bad : 'all clear'));
  out.forEach((l) => console.log(l));
  console.log('  horizontal overflow at 1440px: ' + res.overflow + 'px');
  process.exit(bad ? 1 : 0);
})();
