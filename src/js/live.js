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
  // The parameter picks from a list rather than accepting a URL: everything the
  // stand knows — contacts, deals, the conversation, the question being typed —
  // is posted to whatever it names, so a crafted link was a way to point a
  // visitor's stand at somebody else's server and read all of it.
  const ALLOWED_HOSTS = ['wespace.201-51-22-106.sslip.io', 'localhost', '127.0.0.1'];
  function allowed(url) {
    const u = String(url || '');
    if (u === 'off') return true;
    if (/^\//.test(u)) return true;                       // same origin, no host to check
    const m = /^https?:\/\/([^/:?#]+)/i.exec(u);
    return !!m && ALLOWED_HOSTS.indexOf(m[1].toLowerCase()) >= 0;
  }
  function configuredUrl() {
    let q = '';
    try { q = (WS.env && WS.env.search) || (typeof location !== 'undefined' ? location.search : ''); } catch (e) { q = ''; }
    const m = /[?&]api=([^&]*)/.exec(q || '');
    if (!m) return DEFAULT_URL;
    const asked = decodeURIComponent(m[1]);
    // An unknown host is ignored rather than obeyed. Falling back to the
    // default keeps the demo working; obeying it would be the whole bug.
    return allowed(asked) ? asked : DEFAULT_URL;
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
    // Read through the query layer, not around it. Reaching into the store
    // directly made «one read path» an aspiration: the figures a person sees on
    // a tile and the figures the model is handed came from two different
    // places, and only one of them was governed.
    const rows = (name) => {
      const res = WS.query.run({ from: name });
      return (res && res.ok !== false && Array.isArray(res.rows)) ? res.rows : (d[name] || []);
    };
    const take = (name, fn) => rows(name).map(fn);
    return {
      показатели: readings(),
      показатели_экранов: screenMetrics(),
      контакты: take('clients', (c) => ({ id: c.id, имя: c.name, метка: c.tag, бюджет: c.budget })),
      компании: take('companies', (c) => ({ id: c.id, имя: c.name })),
      // Both the label and the code: the label is what a reply should say out
      // loud, the code is what a stage change has to be written with. Sending
      // only the code got «две сделки на стадии docs» into an answer.
      // Срок следующего шага, дни на стадии и задаток — то, из чего
      // складывается ответ «что мешает закрыть». Без них Консьерж знал сумму
      // и стадию, но не знал, где сделка стоит.
      сделки: take('deals', (x) => ({
        id: x.id, название: x.title, сумма: x.amount,
        стадия: (WS.ui.stageLabel ? WS.ui.stageLabel(x.stage) : x.stage), стадия_код: x.stage,
        воронка: x.dealType || x.funnel, ответственный: x.agent,
        // Which steps this deal may actually be moved to. The board is no
        // longer four columns for everyone — the steps follow from the contract
        // the deal ends in, so without them a proposal to move it is a guess,
        // and the store refuses the guess after the person has read it.
        шаги: (WS.ui.dealSteps ? WS.ui.dealSteps(x) : []).map((k) => ({ код: k, шаг: WS.ui.stageLabel(k) })),
        контакт: x.clientId, компания: x.companyId, объект: x.objectId, лоты: x.lots || null,
        заявка: x.requestId || null, горячая: !!x.hot,
        срок_шага: x.nextDue || null, дней_на_стадии: x.stageDays,
        задаток: x.deposit ? { вид: x.deposit.kind, сумма: x.deposit.amount, оплачен: !!x.deposit.paid, возвратный: !!x.deposit.refundable } : null,
      })),
      // Названия и цены брались из полей title/rate, которых у объектов нет —
      // модель получала безымянные строки и отвечала про район вместо дома.
      объекты: take('objects', (o) => ({
        id: o.id, название: o.name, район: o.area, цена: o.price, площадь: o.size,
        спален: o.br, комиссия_процент: o.commissionPct, доступность: o.availability,
        тип: o.segment, проект: o.project, застройщик: o.developer, сдача: o.handover,
      })),
      // Заявка стала главной сущностью стенда: под ней живут предложенные
      // объекты, выбор клиента и КП. Раньше сюда уходил только бюджет, а
      // статус читался из поля status, которого больше нет, — Консьерж не
      // видел ни воронку лида, ни то, что клиенту уже отправили.
      заявки: take('requests', (r) => ({
        id: r.id, что: r.title || r.goal, контакт: r.clientId, канал: r.channel, создана: r.createdAt,
        // The request has no stage of its own: it is computed from what has
        // been offered, chosen and sent. Sending the facts without the reading
        // the screens show meant the model described a funnel position the
        // broker could not see anywhere.
        стадия: WS.ui.reqStageLabel ? WS.ui.reqStageLabel(WS.ui.reqStage(r), r) : null,
        статус: r.leadStatus, температура: r.temperature, ответственный: r.assignee,
        следующий_контакт: r.nextContact, бюджет: r.budget, районы: r.areas,
        спален: r.bedrooms, срок: r.horizon, оплата: r.paymentForm, финансирование: r.funding,
        предложено: (r.offered || []).map((x) => ({ объект: x.id, состояние: x.state, причина: x.reason || null })),
        кп: r.kp && r.kp.formed ? { когда: r.kp.at, объекты: r.kp.objectIds } : null,
        заметка: r.note,
      })),
      задачи: take('tasks', (t) => ({ id: t.id, что: t.title, срок: t.due, когда: t.when, статус: t.status })),
      // Каждая строка несёт своё происхождение, чтобы модель не выдала
      // иллюстративную величину за опубликованную.
      рынок_дубая: take('market', (m) => m),
      инвентарь: WS.agent.tools.inventory(),
      // Настоящие имена полей — чтобы модель могла описать запрос, из которого
      // код построит таблицу. В остальном она читает русские ключи выше.
      схема: WS.query.collections(),
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
      // The revision travels with the figure. Without it the chip re-ran the
      // query at whatever the data had become, and an answer could disagree
      // with its own evidence without either side saying so.
      .map((r) => ({ label: r.label, value: r.value, money: r.money, query: r.query, count: r.count, revision: r.revision }));
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
  // The shapes that carry measured values, and therefore carry a provenance.
  const NUMERIC = { kv: true, table: true, bars: true };

  /* ---------- blocks built from data, not from the model's text ----------

     The stand is built on «the model narrates, the code owns every number», and
     that held for the evidence chips and not for the answer itself: a table's
     cells were whatever the model typed, validated for shape and never for
     value. An invented figure could not reach a chip, but it could reach the
     row a person actually reads.

     So a block may now name the query its rows come from instead of carrying
     them. The model describes the shape — collection, filter, columns — and the
     code runs it and fills every cell. A figure in such a block cannot be
     invented, because the model never wrote it.

     A block that still carries its own rows is rendered, and marked. Marking is
     honest and it makes the right path visibly the better one.                */

  // An average comes back as 8.133333333333333. Rounding belongs to the code:
  // asking the model to round would hand the last digit back to it.
  function fmtNum(v) {
    return String(Math.round(v * 100) / 100).replace('.', ',');
  }

  function fmtCell(v, money) {
    if (v == null) return '';
    if (money && isFinite(Number(v))) return WS.AED(Number(v));
    if (typeof v === 'number') return fmtNum(v);
    return String(v);
  }

  /* A quantity dressed as a label. The cells of a data-backed block belong to
     the code, but the model still names the columns — and «Доходность 12%» in a
     header reads exactly as authoritative as the figures under it. Words that
     merely contain digits («Топ-5», «2026 год») are left alone; a measured
     value is not. */
  const FIGURE = /\d[.,]\d|\d[\s ]\d{3}|\d{5}|\d\s?(%|₽|\$|AED|дирх|м²|м2|млн|млрд|тыс)/i;
  function hasFigure(s) { return FIGURE.test(String(s == null ? '' : s)); }

  /* Runs the query behind a block. A grouped query answers «по стадиям», «по
     районам», «по ответственным» — the shape most analytical questions have —
     and it comes back as groups, not rows. Flattening it here is what keeps
     such an answer on the data path instead of pushing it back into prose. */
  function runSpec(spec) {
    if (!spec || typeof spec !== 'object') return null;
    let res = null;
    try { res = WS.query.run(spec); } catch (e) { return null; }
    if (!res || res.ok === false) return null;
    if (res.groups) {
      const rows = Object.keys(res.groups)
        .map((k) => ({ group: k, value: res.groups[k].value }))
        .sort((a, b) => Number(b.value) - Number(a.value));
      return rows.length ? { rows: rows, count: res.count, revision: res.revision } : null;
    }
    if (!Array.isArray(res.rows)) return null;
    return res;
  }

  function fillTable(b) {
    const cols = (Array.isArray(b.columns) ? b.columns : []).filter((c) => c && c.field).slice(0, 5);
    if (!cols.length) return null;
    const res = runSpec(b.from);
    if (!res) return null;
    const rows = res.rows.slice(0, 8).map((r) => cols.map((c) => fmtCell(r[c.field], c.money)));
    if (!rows.length) return null;
    const head = cols.map((c) => (c.label && !hasFigure(c.label) ? String(c.label) : String(c.field)));
    return { t: 'table', head: head, rows: rows, src: 'data', count: res.count,
      spec: b.from, revision: res.revision };
  }

  function fillBars(b) {
    if (!b.label || !b.value) return null;
    const res = runSpec(b.from);
    if (!res) return null;
    const suffix = b.suffix && !hasFigure(b.suffix) ? String(b.suffix).slice(0, 8) : '';
    const rows = res.rows.slice(0, 6)
      .filter((r) => isFinite(Number(r[b.value])))
      .map((r) => ({ label: String(r[b.label]), value: Number(r[b.value]), suffix: suffix }));
    if (!rows.length) return null;
    return { t: 'bars', rows: rows, src: 'data', count: res.count,
      spec: b.from, revision: res.revision };
  }

  // A kv block over named readings: the same figures the tiles and the chips
  // show, by construction the same numbers.
  function fillKv(b) {
    const keys = (Array.isArray(b.reads) ? b.reads : []).slice(0, 8);
    if (!keys.length) return null;
    const rows = keys.map((k) => WS.agent.tools.read(String(k))).filter(Boolean)
      .map((r) => ({ k: r.label, v: r.money ? WS.AED(r.value) : String(r.value) }));
    if (!rows.length) return null;
    return { t: 'kv', rows: rows, src: 'data', revision: (WS.store && WS.store.dataRevision) };
  }

  /* A figure the model brought back from the web. The code cannot own it — no
     query stands behind it — so what it owns instead is that such a figure is
     never mixed in with its own: it carries where it came from and as of when,
     and it says so under the block. A claim of a source with no source named
     is worse than no claim, so it is refused. */
  const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
  function fromWeb(b) {
    if (b.src !== 'web') return null;
    const src = String(b.source || '').trim().replace(/^https?:\/\//i, '').split('/')[0].slice(0, 60);
    if (!src || !DOMAIN.test(src)) return null;
    const out = Object.assign({}, b, { src: 'web', source: src });
    out.asOf = b.asOf ? String(b.asOf).slice(0, 40) : '';
    return out;
  }

  function resolve(b) {
    const t = String(b.t);
    if (t === 'table' && b.from) return fillTable(b);
    if (t === 'bars' && b.from) return fillBars(b);
    if (t === 'kv' && Array.isArray(b.reads)) return fillKv(b);
    return null;
  }

  function normBlocks(list, cap) {
    if (!Array.isArray(list)) return null;
    const limit = cap > 0 ? cap : blockCap();
    const out = [];
    list.forEach((b) => {
      if (out.length >= limit) return;
      if (!b || typeof b !== 'object') return;
      const t = String(b.t);
      if (!BLOCK_ARRAYS[t]) return;
      // Preferred: the block names its data and the code builds it.
      const built = resolve(b);
      if (built) { out.push(built); return; }
      // A block that meant to be data-backed and could not be is dropped rather
      // than quietly falling back to whatever the model typed alongside it.
      if (b.from || Array.isArray(b.reads)) return;
      if (!BLOCK_ARRAYS[t].every((f) => Array.isArray(b[f]))) return;
      if (b.head != null && !Array.isArray(b.head)) return;
      const web = fromWeb(b);
      if (web) { out.push(web); return; }
      // Claimed to come from outside and did not say from where: dropped. The
      // attribution IS the provenance for such a figure — without it the block
      // is an unsourced number wearing a source's authority.
      if (b.src === 'web') return;
      out.push(b);
    });
    return out.length ? out : null;
  }

  /* A report is the same shapes, assembled into a file instead of a bubble —
     and that difference is the whole reason the rules here are stricter. A
     marked table in the chat is honest: the mark is on the screen next to it,
     and whoever asked the question is looking at both. The file leaves the
     room. It gets forwarded, and its footer says the figures were computed
     from the workspace — so a model-typed table inside it turns that footer
     into a false claim. Numbers in a document come from a query or not at all. */
  function normReport(r) {
    if (!r || typeof r !== 'object') return null;
    // A document is asked for outright, so the depth ceiling — which shapes the
    // reply in the chat — does not shorten it.
    const all = normBlocks(r.blocks, 10);
    if (!all) return null;
    // A sourced external figure may travel in a document — that is what makes a
    // market note worth sending — but it goes with its source attached, and the
    // footer says the document holds both kinds.
    const blocks = all.filter((b) => !NUMERIC[String(b.t)] || b.src === 'data' || b.src === 'web');
    if (!blocks.length) return null;
    const title = String(r.title || '').slice(0, 120);
    const subtitle = r.subtitle ? String(r.subtitle).slice(0, 200) : '';
    return {
      title: (title && !hasFigure(title)) ? title : 'Аналитическая записка',
      subtitle: hasFigure(subtitle) ? '' : subtitle,
      blocks: blocks,
    };
  }

  // What the answer sounds like out loud — one or two sentences the model
  // writes separately, because reading a table aloud is not an answer.
  function normSay(v) {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return s ? s.slice(0, 400) : null;
  }

  /* `ran` is what the server actually answered under. Reading the composer
     instead was a race with the presenter's own hand: switch to «Быстро» while
     a deep answer is in flight and it was cut to three blocks and then labelled
     «Глубоко». The setting an answer was given under is the setting it is
     shaped and marked by. */
  function toReply(say, plan, ran) {
    const text = String(say || '').trim();
    const blocks = normBlocks(plan.blocks, ran && DEPTH_BLOCKS[ran.depth]);
    const report = normReport(plan.report);
    const evidence = evidenceFor(plan.read);
    let next = normNext(plan.next);
    const chip = openChip(plan.open);
    if (chip) next = [chip].concat(next || []).slice(0, 3);

    if (plan.act) {
      const ops = Array.isArray(plan.act) ? plan.act : [plan.act];
      // Which posture the change was asked from. An analysis mode does not
      // propose changes on its own, but when the broker instructs one it is
      // carried out — and the card says it came from there, so a change made
      // while reading a report is not mistaken for the report's own doing.
      const p = WS.agent.tools.propose(ops, { title: 'Изменение по просьбе', next: next, askedIn: askedMode(ran && ran.mode) });
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

  /* What the person set in the composer. The mode pill, the depth segment and
     the context chips were stored, drawn and dropped — the model never saw any
     of them. Only the ids and the pinned labels go over: the framing behind an
     id belongs to the server, because the endpoint is public and framing a
     caller sends is framing a caller wrote. */
  function composer() {
    const s = WS.store || {};
    const focus = (Array.isArray(s.cgCtx) ? s.cgCtx : []).slice(0, 8)
      .map((c) => ({ label: String(c && c.label || '').slice(0, 80), att: !!(c && c.att) }))
      .filter((c) => c.label);
    return { mode: String(s.cgMode || 'auto'), depth: String(s.cgDepth || 'think'), focus: focus };
  }

  // How many blocks the chosen depth allows. The server asks for it in words;
  // the ceiling is kept here, where the blocks are actually built.
  const DEPTH_BLOCKS = { fast: 3, think: 8, deep: 10 };
  function blockCap() {
    return DEPTH_BLOCKS[String((WS.store || {}).cgDepth || 'think')] || 8;
  }

  /* The mode a change was asked from, for the card to say so. It used to be a
     gate: three modes had `act` cut out on the server and refused again here,
     so a broker reading an analysis and saying «переведи сделку дальше» was
     told to switch mode and ask again. That gate protected nothing — every
     write already waits for a person to confirm the exact old → new diff — and
     it made someone repeat an instruction they had already given.

     A mode holds the AGENT back from proposing changes unasked. It does not
     overrule the person. */
  function askedMode(ran) {
    const k = String(ran || (WS.store || {}).cgMode || 'auto');
    return k && k !== 'auto' && WS.ui && WS.ui.cgModeLabel ? WS.ui.cgModeLabel(k) : '';
  }

  // ---------- transport ----------

  async function stream(text, onText, onStage) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ text: text, digest: digest(), history: history(), scope: scope() },
        composer())),
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
        } else if (ev[1] === 'stage') {
          // Something happened server-side that the arriving text does not show.
          if (onStage && data && data.k) onStage(String(data.k));
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
    const done = await stream(text, opts && opts.onText, opts && opts.onStage);
    // What actually answered, as the server resolved it — not what the page
    // hoped it had asked for. An id it does not know falls back over there.
    const ran = { mode: done.mode || null, depth: done.depth || null };
    const reply = toReply(done.say, done.plan || {}, ran);
    if (!reply) throw new Error('empty reply');
    reply.mode = ran.mode;
    reply.depth = ran.depth;
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
    ask, probe, install, digest, history, scope, shapeOf, allowed, configuredUrl, toReply, normNext, normBlocks, normReport, normSay, evidenceFor, noteFailure, disable, composer,
    get ready() { return cfg.ready; },
    get url() { return cfg.url; },
    get misses() { return cfg.misses; },
    get served() { return cfg.served; },
    get lastError() { return cfg.lastError; },
  };
})(window.WS = window.WS || {});
