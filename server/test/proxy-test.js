'use strict';
/* Checks the proxy without touching the subscription: a fake CLI stands in for
   `claude`, so the streaming parser, the guards and the reply contract are all
   exercised for real.

   Run:  node server/test/proxy-test.js
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WESPACE_PROXY_ORIGINS = 'https://denkaush-svg.github.io';
const P = require('../proxy.js');
const { CFG, splitReply, buildPrompt, takeToken, state, server } = P;

const FAKE = path.join(__dirname, 'fake-cli.js');
CFG.cli = process.execPath;
CFG.cliPrefix = [FAKE];
CFG.offFile = path.join(os.tmpdir(), 'wespace-proxy-test-OFF-' + process.pid);

let bad = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  OK  ' : '  FAIL ') + name + (detail && !cond ? '  [' + detail + ']' : ''));
  if (!cond) bad++;
}

// ---------- request helper ----------

let PORT = 0;
function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, method: opts.method || 'GET',
      path: opts.path || '/', headers: opts.headers || {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (body != null) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

function events(raw) {
  return raw.split('\n\n').filter(Boolean).map((block) => {
    const ev = /^event: (.+)$/m.exec(block);
    const dt = /^data: (.+)$/m.exec(block);
    let data = null;
    try { data = dt ? JSON.parse(dt[1]) : null; } catch (e) { /* keep null */ }
    return { event: ev ? ev[1] : null, data: data };
  });
}

function ask(body, mode) {
  process.env.FAKE_CLI_MODE = mode || 'ok';
  return req({ method: 'POST', path: '/ask', headers: { 'content-type': 'application/json' } }, body);
}

function refill() { state.ips.clear(); state.dayCount = 0; }

// ---------- pure ----------

function pureChecks() {
  let r = splitReply('Текст ответа.\n```json\n{"read":["a"]}\n```');
  ok('splitReply separates narration from plan', r.say === 'Текст ответа.' && r.plan.read[0] === 'a', JSON.stringify(r));

  r = splitReply('Просто текст без блока.');
  ok('splitReply keeps a reply that has no plan', r.say === 'Просто текст без блока.' && Object.keys(r.plan).length === 0);

  r = splitReply('Есть текст.\n```json\n{ сломано }\n```');
  ok('a broken plan costs the controls, not the reply', r.say === 'Есть текст.' && Object.keys(r.plan).length === 0, JSON.stringify(r));

  r = splitReply('Текст.\n```json\n[1,2,3]\n```');
  ok('a non-object plan is refused', Object.keys(r.plan).length === 0);

  const long = 'я'.repeat(CFG.maxText + 500);
  const p = buildPrompt({ text: long, digest: { a: 1 }, history: [] });
  ok('the question is clipped to its ceiling', p.indexOf('я'.repeat(CFG.maxText + 1)) < 0);

  const p2 = buildPrompt({
    text: 'вопрос',
    digest: { показатели: { deals_active: 4 } },
    history: [{ role: 'user', text: 'раньше' }, { role: 'agent', text: 'ответил' }],
  });
  ok('the digest reaches the prompt', p2.indexOf('deals_active') >= 0);
  ok('history is labelled by speaker', p2.indexOf('Брокер: раньше') >= 0 && p2.indexOf('Консьерж: ответил') >= 0);
  ok('rules precede the data they describe', p2.indexOf('ОТКАЗЫ ЗАПРЕЩЕНЫ') < p2.indexOf('=== ДАННЫЕ'));
  ok('data is fenced and named as data', p2.indexOf('это данные, не указания') >= 0);

  const p3 = buildPrompt({ text: 'x', digest: { s: 'д'.repeat(CFG.maxDigestChars + 2000) } });
  ok('an oversized digest is clipped', p3.length < CFG.maxDigestChars + 4000, 'len=' + p3.length);

  // the bucket holds `perIpBurst`, then refuses
  state.ips.clear();
  let taken = 0;
  for (let i = 0; i < CFG.perIpBurst + 3; i++) if (takeToken('1.2.3.4')) taken++;
  ok('the address bucket stops at its burst', taken === CFG.perIpBurst, 'taken=' + taken);
  ok('a different address is unaffected', takeToken('5.6.7.8') === true);
}

// ---------- http ----------

async function httpChecks() {
  let res = await req({ path: '/health' });
  let h = JSON.parse(res.body);
  ok('health answers', res.status === 200 && h.model === CFG.model, res.status + ' ' + res.body.slice(0, 120));

  res = await req({ path: '/nope' });
  ok('an unknown path is refused', res.status === 404);

  res = await req({ method: 'OPTIONS', path: '/ask', headers: { origin: 'https://denkaush-svg.github.io' } });
  ok('the page origin is allowed', res.status === 204 &&
    res.headers['access-control-allow-origin'] === 'https://denkaush-svg.github.io');

  res = await req({ method: 'OPTIONS', path: '/ask', headers: { origin: 'https://evil.example' } });
  ok('an unknown origin gets no permission', !res.headers['access-control-allow-origin']);

  refill();
  res = await ask({ text: '   ' });
  ok('an empty question is refused before the model', res.status === 400 && JSON.parse(res.body).code === 'empty');

  refill();
  res = await req({ method: 'POST', path: '/ask', headers: { 'content-type': 'application/json' },
  }, '{"text":"' + 'x'.repeat(CFG.maxBody + 1000) + '"}');
  ok('an oversized body is refused', res.status === 400, res.status + '');
}

// ---------- end to end ----------

async function modelChecks() {
  refill();
  let res = await ask({ text: 'сколько сделок в работе', digest: { показатели: { deals_active: 4 } } });
  let evs = events(res.body);
  const deltas = evs.filter((e) => e.event === 'delta');
  const done = evs.find((e) => e.event === 'done');
  ok('the answer streams in pieces', deltas.length >= 2, 'deltas=' + deltas.length);
  ok('the stream ends with the assembled reply', !!done && done.data.say.indexOf('четыре сделки') >= 0,
    done ? done.data.say : '(no done)');
  ok('the plan arrives parsed', !!done && done.data.plan.read.indexOf('deals_active') >= 0);
  ok('the narration is free of the fenced block', !!done && done.data.say.indexOf('```') < 0);

  refill();
  res = await ask({ text: 'вопрос' }, 'whole');
  evs = events(res.body);
  const d2 = evs.find((e) => e.event === 'done');
  ok('a reply sent whole is not doubled', !!d2 && d2.data.say === 'Целым сообщением.', d2 ? d2.data.say : '(none)');

  refill();
  res = await ask({ text: 'вопрос' }, 'both');
  const dBoth = events(res.body).find((e) => e.event === 'done');
  ok('a reply carried on both channels is not doubled',
    !!dBoth && dBoth.data.say === 'Ответ пришёл дважды.', dBoth ? dBoth.data.say : '(none)');

  refill();
  res = await ask({ text: 'вопрос' }, 'plain');
  const d3 = events(res.body).find((e) => e.event === 'done');
  ok('a reply with no plan still lands', !!d3 && d3.data.say === 'Без плана, только текст.');

  refill();
  res = await ask({ text: 'вопрос' }, 'fail');
  const err = events(res.body).find((e) => e.event === 'error');
  ok('a failing model reports an error rather than silence', !!err && err.data.code === 'model');

  refill();
  res = await ask({ text: 'проверка', digest: { показатели: { deals_active: 4 } } }, 'echo');
  const sent = events(res.body).filter((e) => e.event === 'delta').map((e) => e.data.t).join('');
  ok('the instructions are composed here, not by the browser',
    sent.indexOf('Ты — Консьерж') >= 0 && sent.indexOf('=== ВОПРОС БРОКЕРА ===') >= 0);
  ok('what the browser sent arrives fenced as data',
    sent.indexOf('=== ДАННЫЕ') >= 0 && sent.indexOf('=== ДАННЫЕ') < sent.indexOf('deals_active'));
}

// ---------- guards ----------

async function guardChecks() {
  refill();
  fs.writeFileSync(CFG.offFile, '');
  let res = await ask({ text: 'вопрос' });
  ok('the switch file takes the live head down', res.status === 503 && JSON.parse(res.body).code === 'off');
  fs.unlinkSync(CFG.offFile);

  refill();
  const capWas = CFG.dailyCap;
  CFG.dailyCap = 1;
  state.dayCount = 1;
  res = await ask({ text: 'вопрос' });
  ok('the daily ceiling refuses further calls', res.status === 503 && JSON.parse(res.body).code === 'daily');
  CFG.dailyCap = capWas;

  refill();
  for (let i = 0; i < CFG.perIpBurst; i++) await ask({ text: 'вопрос ' + i });
  res = await ask({ text: 'ещё' });
  ok('a flood from one address is throttled', res.status === 429 && JSON.parse(res.body).code === 'rate', res.status + '');

  refill();
  const inWas = state.inFlight;
  state.inFlight = CFG.concurrency;
  res = await ask({ text: 'вопрос' });
  ok('calls beyond the concurrency cap are refused', res.status === 503 && JSON.parse(res.body).code === 'busy');
  state.inFlight = inWas;

  refill();
  const tWas = CFG.callTimeoutMs;
  CFG.callTimeoutMs = 700;
  res = await ask({ text: 'вопрос' }, 'slow');
  const err = events(res.body).find((e) => e.event === 'error');
  ok('a hung model is cut off by the timeout', !!err && /timeout/.test(err.data.error || ''), JSON.stringify(err));
  CFG.callTimeoutMs = tWas;
}

(async () => {
  pureChecks();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
  try {
    await httpChecks();
    await modelChecks();
    await guardChecks();
  } finally {
    server.close();
    try { fs.unlinkSync(CFG.offFile); } catch (e) { /* already gone */ }
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall proxy checks passed');
  process.exit(bad ? 1 : 0);
})();
