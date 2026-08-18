/* The Concierge behavior against the образ результата spec (Ch. 03–04).

   Tests eight behavioral assertions from the target architecture:
   1. Analytics → data-backed blocks, not prose
   2. Stage movement → kind=proposal with dealStage operation
   3. Request creation (known client) → kind=proposal with addRequest
   4. Request creation (unknown client) → clarifying question, no addRequest
   5. Market questions → data tables with source attribution
   6. Task creation → kind=proposal with addTask
   7. Analytics say-aloud → speak field included
   8. Refuse to invent → declines made-up figures
   9. ROI mode analysis → no unsolicited proposals
   10. Next-suggestions → offers follow-ups

   Each test runs in its own thread (fresh ID) to avoid model seeing its own answers.
   Needs the proxy up. Run:  node src/test/live-obraz.js
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8000;
const GAP_MS = 11000;              // proxy refills 6 tokens/minute
const TIMEOUT_MS = 160000;         // model can be slow
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const SCENARIOS = [
  { name: 'Analytics by stage', sid: 'a1', mode: 'auto', q: 'разложи сумму сделок по стадиям' },
  { name: 'Stage movement proposal', sid: 'a2', mode: 'auto', q: 'переведи сделку Анны на следующую стадию' },
  // Анна Петрова (c_anna) is a fixture contact — this is the case the broker
  // reported hanging. A name that is NOT in the data tests something else
  // entirely, so it belongs in the scenario below, not this one.
  { name: 'Create request (known client)', sid: 'a3', mode: 'auto', q: 'создай заявку на Анну Петрову: 2-комн, 500к дирхам' },
  { name: 'Create request (unknown client)', sid: 'a4', mode: 'auto', q: 'создай заявку на Сюзанну Ван: пентхаус, люкс' },
  { name: 'Market insight with source', sid: 'a5', mode: 'auto', q: 'какие районы Дубая самые доходные для инвеста' },
  { name: 'Add task', sid: 'a6', mode: 'auto', q: 'поставь задачу позвонить Анне завтра' },
  { name: 'Analytics say-aloud', sid: 'a7', mode: 'auto', q: 'сколько средний чек по каждой стадии; скажи вслух' },
  { name: 'Refuse invented figures', sid: 'a8', mode: 'auto', q: 'какой средний прайс на BI-VILLAGIO в этом квартале' },
  { name: 'ROI mode no unsolicited write', sid: 'a9', mode: 'roi', q: 'разложи по стадиям' },
  { name: 'Next-suggestions present', sid: 'a10', mode: 'auto', q: 'какие сделки ближе всего к закрытию' },
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
  /* Point the stand at the proxy under test. Without this the page falls back
     to its built-in default — the deployed VPS — so a run measured whatever
     prompt is live there, not the one in this working tree. Override with
     WESPACE_TEST_API to aim at a deployed host on purpose. */
  const API = process.env.WESPACE_TEST_API || 'http://127.0.0.1:8791';
  await page.goto('http://127.0.0.1:' + PORT + '/index.html?api=' + encodeURIComponent(API),
    { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.live && window.WS.engine, { timeout: 20000 });
  await page.waitForFunction(() => window.WS.live.ready || window.WS.live.lastError, { timeout: 15000 }).catch(() => {});

  // Check if proxy is available
  const proxyStatus = await page.evaluate(() => ({
    ready: window.WS.live.ready === true,
    url: window.WS.live.url || 'none',
    error: window.WS.live.lastError || '',
  }));

  /* A suite that runs anyway when the live head is absent measures the offline
     planner and reports it as the model's behaviour — every «passed» in that
     run is about code this suite is not testing. Refuse instead. */
  if (!proxyStatus.ready) {
    console.log('  FAIL  the live head is not reachable — this suite tests the model, not the planner');
    console.log('        url=' + proxyStatus.url + '  error=' + proxyStatus.error);
    console.log('        start it:  node server/proxy.js   (or point ?api= at a running one)');
    await browser.close();
    serve.close();
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, GAP_MS));
    const sc = SCENARIOS[i];
    await page.evaluate((scenario, first) => {
      if (first) { window.WS.engine.openThread('obraz', 'Образ результата', 'chat'); window.WS.router.go('concierge'); }
      window.WS.engine.openThread('obraz-' + scenario.sid, 'Образ · ' + scenario.sid, 'chat');
      window.WS.store.cgMode = scenario.mode;
      window.__seen = (window.WS.engine.lastReply || {});
      window.WS.router.routePrompt(scenario.q);
    }, sc, i === 0);

    await page.waitForFunction(
      () => window.WS.engine.lastReply && window.WS.engine.lastReply !== window.__seen,
      { timeout: TIMEOUT_MS },
    ).catch(() => {});

    results.push(await page.evaluate(() => {
      // The shapes that hold measured values, and therefore a provenance.
      const NUMERIC_T = { table: true, kv: true, bars: true };
      const r = window.WS.engine.lastReply || {};
      const blocks = (r.blocks || []).map((b) => ({
        t: b.t,
        src: b.src || 'model',
        hasSpec: !!(b.spec),
        rows: (b.rows || []).length,
      }));

      // Proposals show up as clickable buttons in the chat
      const chatEl = document.getElementById('chat');
      const hasProposalButton = !!(chatEl && chatEl.querySelector('[data-agok]'));

      /* WHICH operation was proposed — the whole point of a write scenario.
         `agent.propose()` returns { kind:'proposal', ops:[...] }; there is no
         `act` field on a reply at all, so reading one yielded an empty list
         for every scenario and a check over it could never fail. */
      const acts = (r.kind === 'proposal' && Array.isArray(r.ops))
        ? r.ops.map((o) => String((o && o.op) || '?')) : [];
      const hasAct = acts.length > 0;
      // The ids a write points at, so an invented one is visible.
      const actIds = (r.kind === 'proposal' && Array.isArray(r.ops))
        ? r.ops.map((o) => String((o && (o.id || (o.obj && o.obj.clientId))) || '')).filter(Boolean) : [];
      // What the confirmation card actually offers to do, in the broker's words.
      const lines = (r.lines || []).slice(0, 4).map((s) => String(s).slice(0, 120));

      // Check for next suggestions
      const hasNext = (r.next && r.next.length > 0);
      const nextCount = (r.next || []).length;

      // Check for speak field (say-aloud)
      const hasSpeak = !!r.speak;

      // Check if answer is a clarifying question (kind=answer but contains question marks)
      const isClarifying = r.kind === 'answer' && (r.text || '').match(/\?/g) && (r.text || '').match(/\?/g).length >= 1;

      return {
        kind: r.kind,
        mode: r.mode,
        text: (r.text || '').slice(0, 300),
        blocks: blocks,
        dataBlocks: blocks.filter(b => b.src === 'data').length,
        webBlocks: blocks.filter(b => b.src === 'web').length,
        /* Only a block that CARRIES VALUES can carry an invented one. Counting
           every block without a `src` as model-typed counted headings and
           notes — which have no src because they hold no figures — and made a
           correct answer look like a provenance breach. */
        modelNumeric: blocks.filter(b => NUMERIC_T[b.t] && b.src !== 'data' && b.src !== 'web').length,
        textBlocks: blocks.filter(b => !NUMERIC_T[b.t]).length,
        hasAct: hasAct,
        acts: acts,
        actIds: actIds,
        lines: lines,
        hasButton: hasProposalButton,
        hasNext: hasNext,
        nextCount: nextCount,
        hasSpeak: hasSpeak,
        isClarifying: isClarifying,
        // Which head answered. An offline fallback produces no data blocks at
        // all, so a suite that cannot tell them apart reports the planner's
        // manners as the model's.
        liveServed: (window.WS.live && window.WS.live.served) || 0,
      };
    }));
  }

  await browser.close();
  serve.close();

  let bad = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  OK  ' : '  FAIL ') + n + (d ? '  [' + d + ']' : ''));
    if (!c) bad++;
  };

  const [analytics, stageMove, createKnown, createUnknown, market, task, sayAloud, refuse, roiMode, nextSugg] = results;

  // 1. Analytics should return data blocks, not prose
  ok('Analytics by stage → has data-backed blocks',
    analytics.blocks.length > 0 && analytics.dataBlocks > 0,
    'blocks=' + analytics.blocks.length + ' dataBlocks=' + analytics.dataBlocks + ' kind=' + analytics.kind);
  ok('  with table/bars structure',
    analytics.blocks.some(b => b.t === 'table' || b.t === 'bars'),
    'blocks=' + analytics.blocks.map(b => b.t).join(','));

  // 2. Stage movement should be a proposal that describes the next step
  ok('Stage movement → kind=proposal',
    stageMove.kind === 'proposal',
    'kind=' + stageMove.kind + ' text=' + stageMove.text.slice(0, 80));
  ok('  describes the action (stage/step mentioned)',
    /бронь|EOI|подготов|следующ|шаг|стадия/i.test(stageMove.text),
    'text=' + stageMove.text.slice(0, 100));

  /* 3. A named contact who EXISTS. This is the case the broker reported as an
        indefinite hang: the operation did not exist, so there was nothing for
        the model to propose. Naming the operation is the check — a reply that
        proposes a task instead is not this feature working. */
  ok('Create request (known) → kind=proposal',
    createKnown.kind === 'proposal',
    'kind=' + createKnown.kind + ' text=' + createKnown.text.slice(0, 120));
  ok('  proposes addRequest specifically',
    createKnown.acts.indexOf('addRequest') >= 0,
    'ops=[' + createKnown.acts.join(',') + ']');
  ok('  points it at the real contact c_anna, not an invented id',
    createKnown.actIds.indexOf('c_anna') >= 0,
    'ids=[' + createKnown.actIds.join(',') + ']');
  ok('  the card says what will be created',
    createKnown.lines.some((l) => /Заявка/i.test(l)),
    'lines=' + JSON.stringify(createKnown.lines));

  /* 4. A name that is NOT in the data. Per Ch. 04 («Задаёт вопросы вместо того,
        чтобы додумывать»): when the client is ambiguous the Concierge writes
        nothing and asks. Creating a request against an invented contact id is
        the failure this guards. */
  ok('Create request (unknown) → does NOT create a request',
    createUnknown.acts.indexOf('addRequest') < 0 || createUnknown.acts.indexOf('addClient') >= 0,
    'ops=[' + createUnknown.acts.join(',') + ']');
  ok('  asks about the unknown contact instead of inventing one',
    createUnknown.isClarifying || /нет в контакт|не наш|не наход|новый контакт|создать конта/i.test(createUnknown.text),
    'kind=' + createUnknown.kind + ' text=' + createUnknown.text.slice(0, 140));

  // 5. Market questions: figures come from a query, never typed by the model.
  ok('Market insight → data-backed',
    market.blocks.length > 0 && market.dataBlocks > 0,
    'blocks=' + market.blocks.length + ' dataBlocks=' + market.dataBlocks);
  ok('  every numeric block is code-computed or attributed',
    market.modelNumeric === 0,
    'model-typed=' + market.modelNumeric + ' of ' + market.blocks.length);

  // 6. Task creation should be a proposal carrying addTask.
  ok('Add task → kind=proposal',
    task.kind === 'proposal',
    'kind=' + task.kind);
  ok('  proposes addTask specifically',
    task.acts.indexOf('addTask') >= 0,
    'ops=[' + task.acts.join(',') + ']');

  // 7. Analytics say-aloud should include speak field
  ok('Analytics say-aloud → has speak field',
    sayAloud.hasSpeak,
    'hasSpeak=' + sayAloud.hasSpeak);
  ok('  with data blocks',
    sayAloud.blocks.length > 0 && sayAloud.dataBlocks > 0,
    'blocks=' + sayAloud.blocks.length);

  /* 8. An object that does not exist. «Своих чисел не выдумывай никогда» — so
        the answer must say the figure is absent, and it must not carry a
        numeric block, which is where an invented figure would actually land. */
  ok('Refuse invented → says the figure is not in the data',
    /нет|не наш|отсутств|не вижу|не значит/i.test(refuse.text),
    'text=' + refuse.text.slice(0, 160));
  ok('  and invents no figure to fill the gap',
    refuse.modelNumeric === 0,
    'model-typed=' + refuse.modelNumeric + ' web=' + refuse.webBlocks + ' data=' + refuse.dataBlocks);

  // 9. An analysis mode does not propose changes unasked (it still obeys an
  //    explicit instruction — that is scenario 3's job, in «Авто»).
  ok('ROI mode analysis → kind=answer, no unsolicited proposal',
    roiMode.kind === 'answer' && !roiMode.hasAct,
    'kind=' + roiMode.kind + ' ops=[' + roiMode.acts.join(',') + ']');
  ok('  and the server confirms it ran in roi',
    roiMode.mode === 'roi',
    'mode=' + roiMode.mode);

  // 10. Next-suggestions should be present
  ok('Next-suggestions → offers follow-ups',
    nextSugg.hasNext,
    'nextCount=' + nextSugg.nextCount);
  ok('  with at least one suggestion',
    nextSugg.nextCount >= 1,
    'nextCount=' + nextSugg.nextCount);

  // Every scenario has to have been answered by the live head. One that fell
  // back mid-run is a scenario whose verdict means nothing.
  const last = results[results.length - 1] || {};
  ok('every scenario was answered by the live head',
    last.liveServed >= SCENARIOS.length,
    'served=' + last.liveServed + ' of ' + SCENARIOS.length);

  ok('no page errors', errs.length === 0, errs.join('; '));

  console.log('\n---');
  SCENARIOS.forEach((sc, i) => {
    const r = results[i];
    console.log(sc.name + '\n  kind=' + r.kind + ' mode=' + r.mode +
      ' blocks=' + r.blocks.length + ' (числовых: data ' + r.dataBlocks + ' / web ' + r.webBlocks +
      ' / модель ' + r.modelNumeric + '; текстовых ' + r.textBlocks + ')' +
      ' ops=[' + r.acts.join(',') + '] next=' + r.nextCount +
      ' speak=' + r.hasSpeak + '\n  ' + r.text.slice(0, 140));
  });
  process.exit(bad ? 1 : 0);
})();
