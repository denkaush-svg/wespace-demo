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

  /* ---- C: switching threads inside freeReply's own ~560 ms of staging must not
           swallow the question. The two setup delays used to end the turn and
           return if the broker had walked to another conversation by then: the
           question was already in the history, the network call never fired,
           and no waiting card and no error ever appeared. A probe caught it as
           `calls=0 has_question=true has_wait=false`. Only a real-time test can
           see it — the whole window is those two delays. ---- */
  {
    eng.openThread('probe:liveD', 'Live · D (уходим сразу)', 'sparkle');
    WS.router.go('concierge');
    let calls = 0; let settle;
    WS.agent.setAsyncHead(() => { calls++; return new Promise((res) => { settle = res; }); });
    type('вопрос, заданный перед уходом'); clickSend();
    // Away inside the staging window, well before the 560 ms are up.
    await wait(80);
    eng.openThread('probe:liveE', 'Live · E', 'sparkle');
    WS.router.go('concierge');
    await wait(1200); // past freeReply's delay(60)+delay(500)

    const dHtml = storedHtml('probe:liveD');
    const dAll = ((WS.engine.threadList() || []).find((x) => x.id === 'probe:liveD') || {}).items || [];
    const dText = dAll.map((m) => m.html).join(' ');
    check('live-ux · a question asked just before switching threads still reaches the network',
      calls === 1, 'calls=' + calls);
    check('live-ux · and the question it belongs to is not left standing alone in its thread',
      dText.indexOf('заданный перед уходом') >= 0 && /Разбираю запрос|Смотрю рабочее место/.test(dHtml),
      'last card=' + dHtml.slice(0, 160));
    check('live-ux · and that thread reads as busy, so a second question is refused',
      WS.engine.threadList().length > 0 && dAll.length >= 2, 'items=' + dAll.length);

    if (settle) settle({ kind: 'answer', text: 'готово Д', evidence: [], next: [] });
    await wait(400);
    check('live-ux · the answer lands back in the thread the question was asked in',
      storedHtml('probe:liveD').indexOf('готово Д') >= 0, storedHtml('probe:liveD').slice(0, 160));
    eng.closeThread('probe:liveD'); eng.closeThread('probe:liveE');
    WS.agent.setAsyncHead(null);
  }

  /* ---- D: the wait has to end even when nobody ends it. `askAsync` resolves or
           falls back to the offline planner; it does not time out. A stream that
           simply stops — dropped socket, restarted proxy, phone changing network
           — left the await pending for the life of the page: the turn stayed
           `running` and its thread refused every further question forever. The
           real ceiling is 135 s (just above the proxy's 120 s silence limit);
           it is settable so it can be observed in under two. ---- */
  {
    eng.openThread('probe:liveF', 'Live · F (сторож)', 'sparkle');
    WS.router.go('concierge');
    const was = eng.watchdogMs;
    eng.watchdogMs = 900;
    let seenSignal = null;
    WS.agent.setAsyncHead((t, opts) => { seenSignal = opts && opts.signal; return new Promise(() => {}); });
    type('вопрос, на который никто не ответит'); clickSend();
    await wait(2400); // past the 560 ms staging + the 900 ms watchdog
    const fHtml = storedHtml('probe:liveF');
    check('live-ux · a stream that never ends is closed by the client watchdog',
      WS.engine.inFlight === false, 'inFlight=' + WS.engine.inFlight);
    check('live-ux · and the request behind it is actually aborted, not just forgotten',
      !!seenSignal && seenSignal.aborted === true, 'aborted=' + (seenSignal && seenSignal.aborted));
    check('live-ux · and the card says so and offers to send the question again',
      /не пришёл/i.test(fHtml) && /Повторить/.test(fHtml) && fHtml.indexOf('никто не ответит') >= 0,
      fHtml.slice(0, 200));
    check('live-ux · the default ceiling sits above the proxy\'s own silence limit (120 с)',
      was > 120000, 'watchdogMs=' + was);
    eng.watchdogMs = was;
    eng.closeThread('probe:liveF');
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
