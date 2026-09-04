/* Acceptance tests for the Concierge's "waiting" state under REAL time — the one
   thing the fast smoke suite deliberately avoids (see src/test/smoke.js's
   "Waiting for the Concierge" block, which stubs around freeReply's own
   delay(60)+delay(500) setup specifically to stay fast). These three checks need
   several real seconds each, so they live apart and are NOT part of `npm test`.
   Run directly:  node src/test/live-ux.js
   Proposed (not added) package.json script: "live:ux": "node src/test/live-ux.js"

   All three probe engine.js's freeReply() ticking mechanism:
     const beat = setInterval(() => { if (!same()) return; tick++; draw(); }, 2200);
   `same()` is `() => engine.activeThreadId === threadId` — the ticker is gated on
   the thread that was busy still being the ON-SCREEN one. Switch away, and the
   entire tick — including the elapsed-seconds note — freezes for that thread,
   which is exactly the behaviour acceptance criterion "the timer keeps updating
   the card of the ORIGINAL thread even after the user switches to a different
   thread" asks to fix.
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..');
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');
const jsFiles = (read('index.html').match(/<script src="js\/([^"]+)\.js"><\/script>/g) || [])
  .map((m) => m.replace(/.*js\/([^"]+)\.js.*/, '$1'));
if (!jsFiles.length) throw new Error('no module scripts found in src/index.html');
const scripts = jsFiles.map((f) => '<script>' + read('js/' + f + '.js') + '</script>').join('\n');
const html = '<!DOCTYPE html><html><head>' +
  '<script>if(!window.structuredClone){window.structuredClone=function(o){return JSON.parse(JSON.stringify(o))}}</script>' +
  '</head><body><div id="app"></div><div class="modal-wrap" id="modal"></div><div class="toasts" id="toasts"></div>' +
  scripts + '</body></html>';

const errors = [];
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://localhost/' });
const win = dom.window;
win.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e)));

const results = [];
let failed = 0;
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  if (!cond) failed++;
  console.log((cond ? '  ok  ' : '  ✗   ') + name + (detail && !cond ? '  [' + detail + ']' : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(async () => {
  const WS = win.WS;
  const doc = win.document;
  check('app boots (WS.ui present)', WS && WS.ui, WS ? 'ui=' + !!WS.ui : 'no WS');
  check('no window errors on boot', errors.length === 0, errors.join('; '));
  if (!WS || !WS.ui) return report();

  const eng = WS.engine;
  if (!(eng && typeof eng.openThread === 'function' && WS.agent && typeof WS.agent.setAsyncHead === 'function')) {
    check('live-ux · concierge composer is reachable for testing', false);
    return report();
  }

  const cgSendBtn = () => doc.querySelector('[data-act="cgSend"]');
  const type = (v) => { const el = doc.getElementById('cgPrompt'); if (el) el.value = v; };
  const clickSend = () => { const b = cgSendBtn(); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  // The note is rendered as `<em class="note">... · N с</em>` (engine.js note()/secs());
  // read the trailing digits after the middle dot, not any digit in the sentence
  // (the sentence itself often starts with a data count, e.g. "10 сделок — ...").
  const secsOf = (html) => { const m = /·\s*(\d+)\s*с/.exec(html || ''); return m ? +m[1] : null; };
  const storedHtml = (threadId) => {
    const t = (WS.engine.threadList() || []).find((x) => x.id === threadId);
    const items = t && t.items;
    return items && items.length ? items[items.length - 1].html : '';
  };

  // ---- A: the elapsed-seconds note is a real clock, not a decoration, while the
  //         thread stays on screen ----
  {
    eng.openThread('probe:liveA', 'Live · A', 'sparkle');
    WS.router.go('concierge');
    let settle;
    WS.agent.setAsyncHead(() => new Promise((res) => { settle = res; }));
    type('долгий вопрос А'); clickSend();
    await wait(3000); // > one 2200ms beat tick past freeReply's own ~560ms setup
    const chat = doc.getElementById('chat');
    const shown = chat ? (chat.textContent || '') : '';
    const secs = secsOf(chat ? chat.innerHTML : '');
    check('live-ux · after ~3s on screen the card shows a real elapsed time (>= 2 с), not "0 с"',
      secs !== null && secs >= 2, 'card note seconds=' + secs + '; text=' + shown.slice(0, 160));
    settle({ kind: 'answer', text: 'готово А', evidence: [], next: [] });
    await wait(400); // > freeReply's 180ms post-reply flash
    const shownAfter = (doc.getElementById('chat') || {}).textContent || '';
    check('live-ux · the waiting card is gone once the call resolves (replaced by the reply)',
      shownAfter.indexOf('готово А') >= 0 && !/Разбираю запрос/.test(shownAfter),
      shownAfter.slice(0, 160));
    eng.closeThread('probe:liveA');
    WS.agent.setAsyncHead(null);
  }

  // ---- B: switching to a different thread mid-wait must not freeze the
  //         original thread's timer (today's beat: `if (!same()) return;`) ----
  {
    eng.openThread('probe:liveB', 'Live · B', 'sparkle');
    WS.router.go('concierge');
    let settle;
    WS.agent.setAsyncHead(() => new Promise((res) => { settle = res; }));
    type('долгий вопрос Б'); clickSend();
    await wait(3000); // one tick while B is the active, on-screen thread
    const secsA = secsOf(storedHtml('probe:liveB'));
    check('live-ux · setup: thread B shows a real elapsed time while active',
      secsA !== null && secsA >= 2, 'secsA=' + secsA);

    // Switch away — B keeps its pending call, but is no longer on screen.
    eng.openThread('probe:liveC', 'Live · C (другой)', 'sparkle');
    WS.router.go('concierge');
    await wait(3000); // another beat period elapses while B is off-screen

    const secsB = secsOf(storedHtml('probe:liveB'));
    check('live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen',
      secsA !== null && secsB !== null && secsB > secsA,
      'secsA=' + secsA + ' secsB=' + secsB + ' (today the beat bails out via `if (!same()) return`, so secsB stays == secsA)');

    // The final reply still has to land in B, not in whatever is on screen now (C).
    settle({ kind: 'answer', text: 'готово Б', evidence: [], next: [] });
    await wait(400);
    const bFinal = storedHtml('probe:liveB');
    const cFinal = storedHtml('probe:liveC');
    check('live-ux · the reply is written back into the ORIGINAL (now background) thread',
      bFinal.indexOf('готово Б') >= 0 && cFinal.indexOf('готово Б') < 0,
      'B has reply=' + (bFinal.indexOf('готово Б') >= 0) + '; C has reply=' + (cFinal.indexOf('готово Б') >= 0));

    eng.closeThread('probe:liveB'); eng.closeThread('probe:liveC');
    WS.agent.setAsyncHead(null);
  }

  check('no window errors after run', errors.length === 0, errors.join('; '));
  report();
}, 800);

function report() {
  const bad = results.filter((r) => !r.ok);
  console.log('\nchecks: ' + results.length + '  passed: ' + (results.length - bad.length) + '  FAILED: ' + bad.length);
  if (bad.length) {
    console.log('\n--- failures ---');
    bad.forEach((r) => console.log('  ✗ ' + r.name + (r.detail ? '  [' + r.detail + ']' : '')));
  }
  process.exit(bad.length ? 1 : 0);
}
