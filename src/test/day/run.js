/* A veteran broker's day, put through the live Concierge.

   Forty questions written the way a busy Dubai broker actually types — no
   capitals, mixed Russian and trade English, an instruction and a question in
   one breath, and a good number of references to things this stand does not
   hold (Marina, Jumeirah, Downtown, an object called B42, a request numbered
   15). The wrong premises are the point: a stand that answers them smoothly is
   a stand that will invent things in front of an agency.

   This file COLLECTS; it does not grade. Every automatic verdict I could write
   here would be a regex over Russian prose, and the last time that was tried it
   passed answers that were wrong and failed answers that were right. So it
   records what came back — shape, operations, provenance of every block, which
   head answered — and the reading is done by a person against `expect`/`trap`.

   Needs the proxy up. Run:  node src/test/day/run.js [from] [to]
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..', '..');
const PORT = 8000;
const GAP_MS = 11000;              // the proxy refills six tokens a minute
// Must sit ABOVE the proxy's own ceiling (600s for a web or deep call), or the
// harness gives up first and every record says «did not answer» where the truth
// was «the server would have». Whoever cuts the call has to be the server.
const TIMEOUT_MS = Number(process.env.WESPACE_TEST_TIMEOUT_MS || 640000);
const API = process.env.WESPACE_TEST_API || 'http://127.0.0.1:8791';
// A different question set — re-checking the few a fix was aimed at, without
// spending forty calls to see three answers.
const SET = process.env.WESPACE_DAY_SET || 'queries';
const OUT = path.join(__dirname, SET === 'queries' ? 'results.json' : 'results-' + SET + '.json');

const ALL = JSON.parse(fs.readFileSync(path.join(__dirname, SET + '.json'), 'utf8'));
const from = Number(process.argv[2] || 0);
const to = Number(process.argv[3] || ALL.length);
const QUERIES = ALL.slice(from, to);
const startedAt = new Date().toISOString();

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

(async () => {
  await new Promise((r) => serve.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html?api=' + encodeURIComponent(API),
    { waitUntil: 'load' });
  await page.waitForFunction(() => window.WS && window.WS.live && window.WS.engine, { timeout: 20000 });
  await page.waitForFunction(() => window.WS.live.ready || window.WS.live.lastError, { timeout: 20000 }).catch(() => {});

  const boot = await page.evaluate(() => ({
    ready: window.WS.live.ready === true,
    url: window.WS.live.url || null,
    err: window.WS.live.lastError || null,
  }));
  if (!boot.ready) {
    // Say WHICH address and WHAT it answered. A bare «unavailable» sent the
    // last diagnosis down the wrong path: the proxy was healthy the whole time
    // and the page had simply resolved a different url than the one being
    // curl-ed by hand.
    console.log('живая голова недоступна — прогон бессмыслен · адрес=' + (boot.url || '(нет)') +
      ' · ' + (boot.err || 'причина не записана') + ' · errs=' + JSON.stringify(errs));
    await browser.close(); serve.close(); process.exit(1);
  }

  const out = [];
  let servedBefore = await page.evaluate(() => (window.WS.live && window.WS.live.served) || 0);
  for (let i = 0; i < QUERIES.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, GAP_MS));
    const spec = QUERIES[i];
    process.stdout.write(spec.id + ' · ' + spec.q.slice(0, 48) + ' … ');
    const t0 = Date.now();

    // Each question in its own thread AND against a clean workspace: a write
    // confirmed in one scenario would otherwise change the data the next one
    // reads, and forty questions deep nobody could tell which answers were
    // about the fixtures and which about the wreckage of earlier answers.
    /* The live head's standdown is cleared for the same reason. In front of a
       visitor the window is right: two failures and the head stops being
       retried for 45 seconds. In a run it is measurement poison — one timeout
       and one CLI throw at h01/h05 left the remaining seven scenarios refused
       without a single network call, and the record read as «the planner
       answered nine of twelve» when the model was never asked. Each scenario
       gets its own attempt; a failure is recorded per scenario, not inherited. */
    await page.evaluate((s) => {
      window.WS.storeApi.resetAll && window.WS.storeApi.resetAll();
      window.WS.live.resetForTest && window.WS.live.resetForTest();
      window.WS.engine.openThread('day-' + s.id, 'День · ' + s.id, 'chat');
      window.WS.store.cgMode = s.mode || 'auto';
      window.WS.store.cgDepth = s.depth || 'think';
      window.__seen = (window.WS.engine.lastReply || {});
      window.WS.router.routePrompt(s.q);
    }, spec);

    const answered = await page.waitForFunction(
      () => window.WS.engine.lastReply && window.WS.engine.lastReply !== window.__seen,
      { timeout: TIMEOUT_MS },
    ).then(() => true, () => false);

    const got = await page.evaluate(() => {
      const NUMERIC = { table: true, kv: true, bars: true };
      const r = window.WS.engine.lastReply || {};
      /* Keep the CONTENT, not just the shape. Recording «table, src:data, 6
         rows» said a block was code-computed and nothing about whether the
         query behind it was the right one: a table of the wrong district, or
         the wrong filter, is indistinguishable from a correct one in a summary
         like that. The spec is what the code ran; the rows are what a person
         reads. Both are needed to judge an answer, and neither can be
         reconstructed later. */
      const blocks = (r.blocks || []).map((b) => ({
        t: b.t, src: b.src || null, n: (b.rows || []).length,
        head: b.head || null,
        spec: b.spec || null,
        source: b.source || null, asOf: b.asOf || null,
        rows: (b.rows || []).slice(0, 10),
        text: b.text ? String(b.text).slice(0, 300) : undefined,
      }));
      return {
        kind: r.kind || null,
        mode: r.mode || null,
        depth: r.depth || null,
        // Whole, not clipped: the sentence that invents something is as likely
        // to be the last one as the first, and a truncated record cannot be
        // re-read after the run.
        text: String(r.text || ''),
        speak: r.speak ? String(r.speak) : null,
        blocks: blocks,
        dataBlocks: blocks.filter((b) => b.src === 'data').length,
        webBlocks: blocks.filter((b) => b.src === 'web').length,
        // The one that matters: a value the model typed itself.
        modelNumeric: blocks.filter((b) => NUMERIC[b.t] && b.src !== 'data' && b.src !== 'web').length,
        ops: (r.kind === 'proposal' && Array.isArray(r.ops)) ? r.ops.map((o) => String((o && o.op) || '?')) : [],
        opIds: (r.kind === 'proposal' && Array.isArray(r.ops))
          ? r.ops.map((o) => String((o && (o.id || (o.obj && (o.obj.clientId || o.obj.id)))) || '')).filter(Boolean) : [],
        // The whole operation, not its name. A stage change to the wrong step, a
        // budget in the wrong currency, a task on the wrong contact — all of
        // them are `addTask` / `dealStage` in a list of names.
        opsFull: (r.kind === 'proposal' && Array.isArray(r.ops)) ? r.ops.slice(0, 6) : [],
        lines: (r.lines || []).map((s) => String(s).slice(0, 140)),
        next: (r.next || []).map((n) => String((n && n.label) || '')),
        opens: (r.next || []).filter((n) => n && n.open).map((n) => n.open + (n.id ? ':' + n.id : '')),
        report: r.report ? { title: r.report.title, count: r.report.count } : null,
        served: (window.WS.live && window.WS.live.served) || 0,
        /* WHY a fallback happened. Without it «⚠ офлайн-планировщик» is a bare
           flag, and a timeout at the 150-second ceiling, a CLI that threw, and a
           refusal inside the standdown window are three different defects that
           looked identical in the record — the last run cost an hour to tell
           them apart by hand. */
        liveError: (window.WS.live && window.WS.live.lastError) || null,
      };
    });

    got.ms = Date.now() - t0;
    got.answered = answered;
    /* Which head actually spoke, per scenario — not cumulatively at the end.
       The live head falls back to the offline planner on any failure, so a
       restart or a blip mid-run turns the rest of the day into a measurement of
       the planner's manners, recorded as answered. Checking the total at the
       end cannot say WHICH ones fell back. */
    got.live = got.served > servedBefore;
    servedBefore = got.served;
    out.push(Object.assign({}, spec, { got: got }));
    console.log((answered ? got.kind : 'НЕ ОТВЕТИЛ') + ' · ' + Math.round(got.ms / 1000) + 'с' +
      (got.live ? '' : ' · ⚠ ОФЛАЙН-ПЛАНИРОВЩИК' + (got.liveError ? ' (' + got.liveError + ')' : '')) +
      (got.ops.length ? ' · ops=[' + got.ops.join(',') + ']' : '') +
      (got.blocks.length ? ' · блоков ' + got.blocks.length + ' (данные ' + got.dataBlocks +
        (got.modelNumeric ? ', МОДЕЛЬ ' + got.modelNumeric : '') + ')' : ''));

    // The manifest says what this file IS. A subset run used to overwrite a
    // full one under the same name, and nothing recorded that it was a subset —
    // which is how a forty-question record became a two-question one.
    fs.writeFileSync(OUT, JSON.stringify({
      набор: SET, диапазон: [from, to], всего_в_наборе: ALL.length,
      адрес: API, начат: startedAt, errs: errs, results: out,
    }, null, 1));
  }

  await browser.close();
  serve.close();

  console.log('\n=== собрано ' + out.length + ' · записано в ' + OUT + ' ===');
  const noAnswer = out.filter((r) => !r.got.answered);
  const typed = out.filter((r) => r.got.modelNumeric > 0);
  const fellBack = out.filter((r) => !r.got.live);
  if (noAnswer.length) console.log('БЕЗ ОТВЕТА: ' + noAnswer.map((r) => r.id).join(', '));
  if (typed.length) console.log('ЧИСЛА ОТ МОДЕЛИ: ' + typed.map((r) => r.id).join(', '));
  if (fellBack.length) {
    console.log('ОТВЕТИЛ ПЛАНИРОВЩИК, НЕ МОДЕЛЬ: ' +
      fellBack.map((r) => r.id + (r.got.liveError ? ' (' + r.got.liveError + ')' : '')).join(', '));
  }
  if (errs.length) console.log('ОШИБКИ СТРАНИЦЫ: ' + errs.join('; '));
  /* A warning printed and then exited zero is a warning nobody acts on: the
     command succeeded, so a wrapper, a CI step or a tired person reads it as
     green. Any of these three makes the run's verdict unsafe to trust. */
  process.exit((noAnswer.length || typed.length || fellBack.length || errs.length) ? 1 : 0);
})();
