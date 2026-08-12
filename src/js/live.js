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
      // Срок следующего шага, дни на стадии и задаток — то, из чего
      // складывается ответ «что мешает закрыть». Без них Консьерж знал сумму
      // и стадию, но не знал, где сделка стоит.
      сделки: take(d.deals, (x) => ({
        id: x.id, название: x.title, сумма: x.amount,
        стадия: (WS.ui.stageLabel ? WS.ui.stageLabel(x.stage) : x.stage), стадия_код: x.stage,
        воронка: x.dealType || x.funnel, ответственный: x.agent,
        контакт: x.clientId, компания: x.companyId, объект: x.objectId, лоты: x.lots || null,
        заявка: x.requestId || null, горячая: !!x.hot,
        срок_шага: x.nextDue || null, дней_на_стадии: x.stageDays,
        задаток: x.deposit ? { вид: x.deposit.kind, сумма: x.deposit.amount, оплачен: !!x.deposit.paid, возвратный: !!x.deposit.refundable } : null,
      })),
      // Названия и цены брались из полей title/rate, которых у объектов нет —
      // модель получала безымянные строки и отвечала про район вместо дома.
      объекты: take(d.objects, (o) => ({
        id: o.id, название: o.name, район: o.area, цена: o.price, площадь: o.size,
        спален: o.br, комиссия_процент: o.commissionPct, доступность: o.availability,
        тип: o.segment, проект: o.project, застройщик: o.developer, сдача: o.handover,
      })),
      // Заявка стала главной сущностью стенда: под ней живут предложенные
      // объекты, выбор клиента и КП. Раньше сюда уходил только бюджет, а
      // статус читался из поля status, которого больше нет, — Консьерж не
      // видел ни воронку лида, ни то, что клиенту уже отправили.
      заявки: take(d.requests, (r) => ({
        id: r.id, что: r.title || r.goal, контакт: r.clientId, канал: r.channel, создана: r.createdAt,
        статус: r.leadStatus, температура: r.temperature, ответственный: r.assignee,
        следующий_контакт: r.nextContact, бюджет: r.budget, районы: r.areas,
        спален: r.bedrooms, срок: r.horizon, оплата: r.paymentForm, финансирование: r.funding,
        предложено: (r.offered || []).map((x) => ({ объект: x.id, состояние: x.state, причина: x.reason || null })),
        кп: r.kp && r.kp.formed ? { когда: r.kp.at, объекты: r.kp.objectIds } : null,
        заметка: r.note,
      })),
      задачи: take(d.tasks, (t) => ({ id: t.id, что: t.title, срок: t.due, когда: t.when, статус: t.status })),
      // Каждая строка несёт своё происхождение, чтобы модель не выдала
      // иллюстративную величину за опубликованную.
      рынок_дубая: take(d.market, (m) => m),
      инвентарь: WS.agent.tools.inventory(),
      ревизия: WS.store.dataRevision,
    };
  }

  // What a follow-up needs from the turn before it. Scraping the markup gave
  // the model back its own table as a run-on line — «Район Цена/м² Доходность
  // Arjan 11 600 8,1% JVC 13 800 7,6%» — so «а если бюджет 1,5 млн» meant
  // re-deriving a comparison it had just made. The reply objects are still
  // held by the chat, so the last answer is handed back in its own shape.
  function shapeOf(r) {
    if (!r || !Array.isArray(r.blocks)) return null;
    const out = [];
    r.blocks.slice(0, 3).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.t === 'table') {
        out.push({ t: 'table', head: (b.head || []).slice(0, 5), rows: (b.rows || []).slice(0, 6).map((row) => (row || []).slice(0, 5)) });
      } else if (b.t === 'bars') {
        out.push({ t: 'bars', rows: (b.rows || []).slice(0, 6).map((x) => ({ label: x && x.label, value: x && x.value, suffix: x && x.suffix })) });
      } else if (b.t === 'kv') {
        out.push({ t: 'kv', rows: (b.rows || []).slice(0, 6) });
      } else if (b.text) {
        out.push({ t: b.t, text: String(b.text).slice(0, 200) });
      }
    });
    return out.length ? out : null;
  }

  function history() {
    // `WS.engine.threads` is not exported and `activeThreadId` is a function, so
    // the obvious spelling silently produced an empty history and every
    // follow-up reached the model with no memory of the conversation.
    const th = (WS.engine && WS.engine.activeThread) ? WS.engine.activeThread() : null;
    const items = (th && th.items) || [];
    const taken = items.slice(-8);
    // Only the newest answer keeps its shape: it is the one a follow-up points
    // at, and carrying every table back would cost more prompt than it earns.
    let lastAgent = -1;
    taken.forEach((m, i) => { if (!/class="msg me|class="msg user/.test(m.html || '')) lastAgent = i; });

    return taken
      .map((m, i) => {
        // Three voices, not two. A client's message carries `msg user`, and
        // calling it «agent» handed the model the client's words as its own.
        const role = /class="msg me/.test(m.html || '') ? 'user'
          : (/class="msg user/.test(m.html || '') ? 'client' : 'agent');
        const entry = {
          role: role,
          text: String(m.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
        };
        if (role === 'agent' && i === lastAgent && WS.engine && WS.engine.replyFor) {
          const shape = shapeOf(WS.engine.replyFor(m.id));
          if (shape) { entry.blocks = shape; entry.text = entry.text.slice(0, 300); }
        }
        return entry;
      })
      .filter((m) => m.text || (m.blocks && m.blocks.length));
  }

  // Which conversation this is. Threads are per deal, per object, per lead, and
  // the model was answering every one of them as if it were the general chat.
  function scope() {
    const th = (WS.engine && WS.engine.activeThread) ? WS.engine.activeThread() : null;
    if (!th) return null;
    return { id: th.id, о_чём: th.label || th.id, реплик: (th.items || []).length };
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

  // A screen the model wants shown becomes a chip, not a jump. Navigating the
  // moment it answers throws the reply off a phone screen entirely — the
  // person was still reading it.
  const VIEW_RU = { start: 'Пульс', concierge: 'Консьерж', clients: 'Контакты', companies: 'Компании',
    objects: 'Объекты', requests: 'Заявки', leads: 'Лиды', tasks: 'Задачи', shows: 'Показы',
    docs: 'Документы', analytics: 'Аналитика', finance: 'Финансы', calc: 'Финмодель',
    valuation: 'Оценка объекта', club: 'Клуб', partners: 'Партнёры', team: 'Команда',
    services: 'Услуги', approvals: 'Согласования', promotion: 'Продвижение',
    profile: 'Профиль', settings: 'Настройки' };

  function openChip(open) {
    if (!open || !open.view) return null;
    const v = String(open.view);
    const id = open.id ? String(open.id) : '';
    const d = (WS.store && WS.store.data) || {};
    const named = (list) => ((list || []).find((x) => x.id === id) || {});
    if (v === 'contact' && id) return { label: 'Открыть ' + (named(d.clients).name || 'контакт'), open: 'contact', id: id };
    if (v === 'company' && id) return { label: 'Открыть ' + (named(d.companies).name || 'компанию'), open: 'company', id: id };
    if (v === 'deal' && id) return { label: 'Открыть сделку', open: 'deal', id: id };
    if (v === 'request' && id) return { label: 'Открыть заявку', open: 'request', id: id };
    if (VIEW_RU[v]) return { label: 'Открыть «' + VIEW_RU[v] + '»', open: v, id: '' };
    return null;
  }

  // Only shapes the renderer knows survive. Anything else is dropped rather
  // than passed through, so the model cannot widen the vocabulary at runtime.
  // The type alone is not enough: {t:'list',items:{}} passed the old check and
  // then threw on .slice() while the chat was mid-render, stranding the card.
  // Every shape declares which of its fields must be arrays.
  const BLOCK_ARRAYS = { p: [], h: [], note: [], list: ['items'], kv: ['rows'], table: ['rows'], bars: ['rows'] };
  function normBlocks(list) {
    if (!Array.isArray(list)) return null;
    const out = list.filter((b) => {
      if (!b || typeof b !== 'object') return false;
      const need = BLOCK_ARRAYS[String(b.t)];
      if (!need) return false;
      if (!need.every((f) => Array.isArray(b[f]))) return false;
      if (b.head != null && !Array.isArray(b.head)) return false;
      return true;
    }).slice(0, 10);
    return out.length ? out : null;
  }

  // A report is the same shapes, assembled into a file instead of a bubble.
  function normReport(r) {
    if (!r || typeof r !== 'object') return null;
    const blocks = normBlocks(r.blocks);
    if (!blocks) return null;
    return {
      title: String(r.title || 'Аналитическая записка').slice(0, 120),
      subtitle: r.subtitle ? String(r.subtitle).slice(0, 200) : '',
      blocks: blocks,
    };
  }

  // What the answer sounds like out loud — one or two sentences the model
  // writes separately, because reading a table aloud is not an answer.
  function normSay(v) {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return s ? s.slice(0, 400) : null;
  }

  function toReply(say, plan) {
    const text = String(say || '').trim();
    const blocks = normBlocks(plan.blocks);
    const report = normReport(plan.report);
    const evidence = evidenceFor(plan.read);
    let next = normNext(plan.next);
    const chip = openChip(plan.open);
    if (chip) next = [chip].concat(next || []).slice(0, 3);

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
    if (!text && !blocks && !report) return null;
    const made = report ? WS.report.create(report) : null;
    return {
      kind: 'answer', text: text, blocks: blocks, evidence: evidence, next: next,
      speak: normSay(plan.say_aloud),
      report: made ? { id: made.id, title: made.title, name: made.name, count: report.blocks.length } : null,
    };
  }

  // ---------- transport ----------

  async function stream(text, onText) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, digest: digest(), history: history(), scope: scope() }),
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

  // A probe already in flight is awaited, not answered with its stale verdict.
  // Returning `cfg.ready` here meant the first question typed right after load
  // raced the boot probe and silently fell back to the offline planner.
  let pending = null;
  function probe() {
    if (pending) return pending;
    const clear = () => { pending = null; };
    pending = doProbe().then((r) => { clear(); return r; }, (e) => { clear(); throw e; });
    return pending;
  }

  async function doProbe() {
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
    ask, probe, install, digest, history, scope, shapeOf, toReply, normNext, normBlocks, normReport, normSay, evidenceFor, noteFailure, disable,
    get ready() { return cfg.ready; },
    get url() { return cfg.url; },
    get misses() { return cfg.misses; },
    get served() { return cfg.served; },
    get lastError() { return cfg.lastError; },
  };
})(window.WS = window.WS || {});
