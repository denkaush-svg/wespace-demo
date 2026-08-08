/* ============================================================
   The live head.

   Everything here is transport. The model gets the question, a digest this
   file assembles from the stand's own query layer, and the list of names and
   ids it may refer to — and it gets nothing else. It answers with narration
   plus a small plan; the plan is turned back into the same reply shape the
   offline planner produces, so the chat, the evidence chips and the
   confirmation flow do not know or care which head spoke.

   Numbers never come back from the model. It narrates using figures the code
   handed it, and names which readings it leaned on; the chips under the reply
   are then re-read here, from the store, at the current revision. A model that
   invents a figure cannot get it onto a chip.

   Any failure — unreachable, throttled, switched off, malformed — falls back
   to the offline planner without saying so. A visitor gets a plainer
   Concierge, never a broken one.
   ============================================================ */
(function (WS) {
  const DEFAULT_URL = 'https://wespace.201-51-22-106.sslip.io';

  const cfg = { url: '', ready: false, checking: false, lastError: null, misses: 0, served: 0 };
  const GIVE_UP_AFTER = 2;

  // ?api=… for a demo against another host, ?api=off to force the planner.
  function configuredUrl() {
    let q = '';
    try { q = (WS.env && WS.env.search) || (typeof location !== 'undefined' ? location.search : ''); } catch (e) { q = ''; }
    const m = /[?&]api=([^&]*)/.exec(q || '');
    if (m) return decodeURIComponent(m[1]);
    return DEFAULT_URL;
  }

  // ---------- what the model is allowed to see ----------

  // Readings come from the query layer, so a figure in the prompt and a figure
  // on a tile are the same figure by construction.
  function readings() {
    const out = {};
    Object.keys(WS.agent.READINGS).forEach((k) => {
      const r = WS.agent.tools.read(k);
      if (r) out[k] = { label: r.label, value: r.value, деньги: !!r.money };
    });
    return out;
  }

  // The figures the screens draw. Without these the model answered "комиссии в
  // данных нет" while the analytics screen was showing exactly that number —
  // the live head contradicting the stand is worse than it saying less.
  function screenMetrics() {
    const out = {};
    const m = (WS.ui.metricsSnapshot ? (WS.ui.metricsSnapshot().metrics || {}) : {});
    Object.keys(m).forEach((k) => { out[k] = { label: m[k].label, value: m[k].v }; });
    return out;
  }

  function digest() {
    const d = (WS.store && WS.store.data) || {};
    const take = (list, fn) => (list || []).map(fn);
    return {
      показатели: readings(),
      показатели_экранов: screenMetrics(),
      контакты: take(d.clients, (c) => ({ id: c.id, имя: c.name, метка: c.tag, бюджет: c.budget })),
      компании: take(d.companies, (c) => ({ id: c.id, имя: c.name })),
      // Both the label and the code: the label is what a reply should say out
      // loud, the code is what a stage change has to be written with. Sending
      // only the code got «две сделки на стадии docs» into an answer.
      сделки: take(d.deals, (x) => ({
        id: x.id, название: x.title, сумма: x.amount,
        стадия: (WS.ui.stageLabel ? WS.ui.stageLabel(x.stage) : x.stage), стадия_код: x.stage,
        контакт: x.clientId, компания: x.companyId, объект: x.objectId, горячая: !!x.hot,
      })),
      объекты: take(d.objects, (o) => ({ id: o.id, название: o.title, район: o.area, ставка: o.rate, комиссия_процент: o.commissionPct })),
      задачи: take(d.tasks, (t) => ({ id: t.id, что: t.title, срок: t.due, когда: t.when, статус: t.status })),
      инвентарь: WS.agent.tools.inventory(),
      ревизия: WS.store.dataRevision,
    };
  }

  function history() {
    const th = WS.engine && WS.engine.threads && WS.engine.threads[WS.engine.activeThreadId];
    const items = (th && th.items) || [];
    return items.slice(-8)
      .map((m) => ({
        role: /class="msg me/.test(m.html || '') ? 'user' : 'agent',
        text: String(m.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      }))
      .filter((m) => m.text);
  }

  // ---------- what comes back ----------

  function normNext(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (let i = 0; i < list.length && out.length < 3; i++) {
      const n = list[i];
      if (!n || typeof n !== 'object') continue;
      const label = String(n.label || '').slice(0, 40);
      if (!label) continue;
      if (n.ask) out.push({ label: label, ask: String(n.ask).slice(0, 200) });
      else if (n.open && n.id) out.push({ label: label, open: String(n.open), id: String(n.id) });
    }
    return out.length ? out : null;
  }

  // Chips are re-read here rather than taken from the model, so a figure it
  // invented has nowhere to land.
  function evidenceFor(keys) {
    if (!Array.isArray(keys)) return [];
    return keys.map((k) => WS.agent.tools.read(String(k))).filter(Boolean)
      .map((r) => ({ label: r.label, value: r.value, money: r.money, query: r.query, count: r.count }));
  }

  function toReply(say, plan) {
    const text = String(say || '').trim();
    const evidence = evidenceFor(plan.read);
    const next = normNext(plan.next);

    if (plan.act) {
      const ops = Array.isArray(plan.act) ? plan.act : [plan.act];
      const p = WS.agent.tools.propose(ops, { title: 'Изменение по просьбе', next: next });
      if (p && p.kind === 'proposal') { p.text = text; return p; }
      // The store refused the dry run — say so plainly instead of pretending.
      return {
        kind: 'answer',
        text: text + (p && p.text ? ' Записать не выйдет: ' + p.text : ''),
        evidence: evidence, next: next,
      };
    }
    if (!text) return null;
    return { kind: 'answer', text: text, evidence: evidence, next: next, open: plan.open || null };
  }

  // ---------- transport ----------

  async function stream(text, onText) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, digest: digest(), history: history() }),
    });
    if (!res.ok || !res.body) throw new Error('http ' + res.status);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let raw = '';
    let done = null;

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const dt = /^data: (.+)$/m.exec(block);
        if (!ev || !dt) continue;
        let data = null;
        try { data = JSON.parse(dt[1]); } catch (e) { continue; }
        if (ev[1] === 'delta' && data && typeof data.t === 'string') {
          raw += data.t;
          // The plan rides at the end of the same text; show only what precedes it.
          if (onText) onText(raw.split('```')[0].trim());
        } else if (ev[1] === 'done') {
          done = data;
        } else if (ev[1] === 'error') {
          throw new Error(String((data && data.error) || 'model'));
        }
      }
    }
    if (!done) throw new Error('stream ended without a reply');
    return done;
  }

  async function ask(text, opts) {
    // Readiness is decided here, not once at boot. A hiccup in the second the
    // page loads used to cost the visitor the live Concierge for the whole
    // session; now it costs one retry. Repeated failure still gives up, via
    // noteFailure below.
    if (!cfg.ready) await probe();
    if (!cfg.ready) throw new Error(cfg.lastError || 'offline');
    const done = await stream(text, opts && opts.onText);
    const reply = toReply(done.say, done.plan || {});
    if (!reply) throw new Error('empty reply');
    cfg.misses = 0;
    cfg.served += 1;      // lets a test tell which head actually spoke
    return reply;
  }

  // ---------- availability ----------

  async function probe() {
    if (cfg.checking) return cfg.ready;
    cfg.checking = true;
    cfg.url = configuredUrl();
    if (!cfg.url || cfg.url === 'off' || typeof fetch !== 'function') {
      cfg.ready = false; cfg.checking = false; return false;
    }
    try {
      const res = await fetch(cfg.url.replace(/\/+$/, '') + '/health', { method: 'GET' });
      const h = await res.json();
      cfg.ready = !!(h && h.ok);
      cfg.lastError = cfg.ready ? null : 'health: off';
    } catch (e) {
      cfg.ready = false;
      cfg.lastError = String(e.message || e);
    }
    cfg.checking = false;
    return cfg.ready;
  }

  // The head goes in whether or not the first probe answered: it decides
  // readiness per call, and a failing call falls back on its own. Installing
  // only on a successful probe made one unlucky second at load permanent.
  function install() {
    cfg.url = configuredUrl();
    if (!cfg.url || cfg.url === 'off' || typeof fetch !== 'function') return false;
    if (WS.agent && WS.agent.setAsyncHead) WS.agent.setAsyncHead(ask);
    probe().catch(() => {});     // warm it up; the verdict is not binding
    return true;
  }

  // One hiccup should not cost the session its live head, and a service that
  // is genuinely down should not be retried on every message the visitor types.
  function noteFailure(why) {
    cfg.lastError = why || 'error';
    cfg.misses += 1;
    if (cfg.misses >= GIVE_UP_AFTER) disable(why);
  }
  function disable(why) {
    cfg.ready = false;
    cfg.lastError = why || 'disabled';
    if (WS.agent && WS.agent.setAsyncHead) WS.agent.setAsyncHead(null);
  }

  WS.live = {
    ask, probe, install, digest, toReply, normNext, evidenceFor, noteFailure, disable,
    get ready() { return cfg.ready; },
    get url() { return cfg.url; },
    get misses() { return cfg.misses; },
    get served() { return cfg.served; },
    get lastError() { return cfg.lastError; },
  };
})(window.WS = window.WS || {});
