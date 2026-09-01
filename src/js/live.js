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
  // Every silent drop below is counted. Guarded because a counter must never
  // be the reason an answer fails to render.
  const note = (k) => { if (WS.quality) WS.quality.note(k); };

  // Long enough that a dead service is not hammered, short enough that a
  // restart is invisible to whoever is being shown the stand.
  const cfg = { url: '', ready: false, checking: false, lastError: null, misses: 0, served: 0,
    downUntil: 0, cooldownMs: 45000 };
  const GIVE_UP_AFTER = 2;
  // Long enough that a network handover has settled, short enough that the
  // waiting card does not become a wait.
  const RETRY_PAUSE_MS = 1200;

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
      /* Consent is a legal fact recorded from the person, and it decides
         whether they may be written to at all. It was in the data and not in
         the digest, so the Concierge could compose an outreach list with
         somebody on it who had refused — cheerfully, and with no way to know. */
      /* And the language they read in — for the same reason, one step further
         on. It was on the card, on screen, in the search index, and not here:
         the Concierge composed for a client without knowing which language
         reaches them. */
      контакты: take('clients', (c) => ({ id: c.id, имя: c.name, метка: c.tag, бюджет: c.budget,
        согласие_на_переписку: c.consent !== false, язык: c.lang || null })),
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
        /* Участники сделки. Сводка отдавала клиента, компанию и лоты — и молчала о том, кто ещё
           за столом: расширенный справочник ролей остался бы невидимым ровно для того, кто
           должен им пользоваться. Без этого Консьерж не может ни выбрать адресата, ни объяснить,
           почему пишет юристу, а не покупателю. */
        участники: (WS.ui.dealParticipants ? WS.ui.dealParticipants(x) : []),
        заявка: x.requestId || null, горячая: !!x.hot,
        срок_шага: x.nextDue || null, дней_на_стадии: x.stageDays,
        задаток: x.deposit ? { вид: x.deposit.kind, сумма: x.deposit.amount, оплачен: !!x.deposit.paid, возвратный: !!x.deposit.refundable } : null,
      })),
      // Названия и цены брались из полей title/rate, которых у объектов нет —
      // модель получала безымянные строки и отвечала про район вместо дома.
      /* Whether a figure on this card is still trustworthy. `verified:'expired'`
         with a checking date six weeks old is the difference between quoting a
         price and quoting a rumour — and the object under Viktor's live booking
         is exactly that. Sending the price without its verification let the
         Concierge propose a booking on data the stand itself marks as stale. */
      объекты: take('objects', (o) => ({
        id: o.id, название: o.name, район: o.area, цена: o.price, площадь: o.size,
        спален: o.br, комиссия_процент: o.commissionPct, доступность: o.availability,
        проверка: o.verified, проверено_когда: o.checkedAt,
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
        /* Where the client said two different things and the stand kept both.
           «Бюджет ≈ 2,0 млн (первое сообщение)» against «до 2,6 млн
           (уточнение)» — the newer one is used, and the older one is preserved
           precisely so nobody presents the figure as settled. Without it in the
           digest the Concierge stated 2,6 as fact, which is the opposite of
           what keeping the conflict is for. */
        расхождение: (d.conflicts && d.conflicts[r.id]) ? {
          поле: d.conflicts[r.id].field,
          было: d.conflicts[r.id].a, стало: d.conflicts[r.id].b,
          взято: d.conflicts[r.id].chosen === 'b' ? 'уточнение' : 'первое',
        } : null,
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
      // Брокер называет суммы и в долларах, и в дирхамах. Курс здесь —
      // константа (привязка с 1997), а не котировка, поэтому пересчёт по нему
      // не выдумывание числа. С основанием, чтобы ответ мог его назвать.
      курс: (WS.fixtures && WS.fixtures.FX)
        ? { за_доллар_AED: WS.fixtures.FX.perAED, основание: WS.fixtures.FX.basis } : null,
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

  /* What this conversation is waiting on. Sent as data like everything else, so
     the model finishes the instruction it already sent instead of re-deriving it
     from a transcript — and so a one-word answer stops being a turn with no
     subject. The keys are Russian for the same reason the digest's are. */
  function pendingAction() {
    const p = (WS.engine && WS.engine.pendingAction) ? WS.engine.pendingAction() : null;
    if (!p || !Array.isArray(p.need) || !p.need.length) return null;
    return { операция: p.ops, ждём: p.need };
  }

  // Which SCREEN this was asked from. A thread says what the conversation is
  // about; the screen says what the broker is looking at while typing, and
  // «а по этой сделке?» has no subject without it.
  function screen() {
    return (WS.ui && WS.ui.screenContext) ? WS.ui.screenContext() : null;
  }

  // Which conversation this is. Threads are per deal, per object, per lead, and
  // the model was answering every one of them as if it were the general chat.
  function scope() {
    const th = (WS.engine && WS.engine.activeThread) ? WS.engine.activeThread() : null;
    if (!th) return null;
    /* Что открыто на экране — ВНУТРИ описания разговора, а не только отдельным полем.
       Развёрнутый сервер собирает из области разговора ровно две вещи — «о_чём» и «id», —
       поэтому контекст экрана, уехавший отдельным полем, до модели просто не доходил: она
       по-прежнему отвечала общей сводкой на вопрос, заданный из-под конкретной сделки. */
    const sc = (WS.ui && WS.ui.screenContext) ? WS.ui.screenContext() : null;
    const rec = sc && sc.запись;
    /* И правило чтения — вместе с ним. Описания экрана мало: модель видела, на чём стоит
       брокер, и всё равно переспрашивала «вы имеете в виду эту сделку?», потому что в вопросе
       без подлежащего подлежащего действительно нет. Правило принадлежит серверному промпту —
       пока ветка прокси занята, оно едет в том единственном поле, которое сервер собирает. */
    const about = rec
      ? [sc.экран + ' «' + rec.название + '»', rec.клиент ? 'клиент ' + rec.клиент : null,
         rec.шаг ? 'шаг ' + rec.шаг : (rec.стадия ? 'стадия ' + rec.стадия : null),
         'вопрос без явного подлежащего задан про эту запись — отвечайте сразу, не переспрашивая']
        .filter(Boolean).join(', ')
      : (th.label || th.id);
    return { id: th.id, о_чём: about, экран: sc ? sc.экран : null, реплик: (th.items || []).length };
  }

  // ---------- what comes back ----------

  // Chips are re-read here rather than taken from the model, so a figure it
  // invented has nowhere to land.
  function evidenceFor(keys) {
    if (!Array.isArray(keys)) return [];
    return keys.map((k) => WS.agent.tools.read(String(k))).filter(Boolean)
      // The revision travels with the figure. Without it the chip re-ran the
      // query at whatever the data had become, and an answer could disagree
      // with its own evidence without either side saying so.
      .map((r) => ({ key: r.key, label: r.label, value: r.value, money: r.money, query: r.query, count: r.count, revision: r.revision }));
  }

  /* ---------- which chips an answer has earned ----------

     Re-reading the keys the model named kept a made-up FIGURE off a chip; it did
     nothing about a made-up CLAIM. «Опираюсь на deals_active» under a sentence
     quoting some other number is a caption pointing at the wrong query, and the
     caption is «откуда это число».

     So the keys are found here instead of taken. A reading earns its chip when
     its own value is written in the narration and the words it counts are in the
     same sentence — the value alone is a coincidence in a stand where most
     counts are single digits. A figure the model invented matches no reading and
     brings no chip, which is the honest outcome and also the visible one: an
     answer full of numbers and bare of chips is a reply worth re-reading. */

  // Group separators as the stand's own formatter prints them (ru-RU uses a
  // non-breaking space), and a decimal tail so «8,1%» is read as 8.1 rather
  // than as an 8 sitting next to a 1.
  const NUM = /\d[\d    ]*(?:[.,]\d+)?/g;
  const SEP = /[    ]/g;
  /* Digits that are plainly not a count of anything: a date and a clock. Both
     are everywhere in this trade — «проверен 12 мая», «срок сегодня в 16:00» —
     and a «12» of that kind, in a clause that also happens to say «объект», is
     how a chip reading «12 объектов» lands under an answer that never counted
     them. Measured on the recorded run, not imagined: that exact chip appeared. */
  const MONTH = /^[\s ]*(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/i;
  /* How close the words have to be. A count is written against the thing it
     counts — «8 сделок», «объекты — 12», «на сумму 20 228 000» — so the anchor
     is looked for beside the figure rather than anywhere in the sentence. The
     whole sentence proved far too generous: one clause naming an object and the
     next carrying a date was enough to caption a chip. */
  const NEAR = 24;

  // Where the figure's own sentence starts and ends, so a window never reaches
  // across a full stop into a clause about something else.
  const STOP = /[.!?…;\n]/;
  function sentenceBounds(s, at) {
    let from = 0;
    let to = s.length;
    for (let i = at; i >= 0; i--) { if (STOP.test(s[i])) { from = i + 1; break; } }
    for (let i = at; i < s.length; i++) { if (STOP.test(s[i])) { to = i; break; } }
    return [from, to];
  }

  const EVIDENCE_CAP = 4;

  function evidenceFrom(text) {
    const s = String(text == null ? '' : text);
    if (!/\d/.test(s)) return [];
    // Read once per key, not once per figure: a reading is a query, and an
    // answer carrying a dozen numbers would otherwise re-run all thirteen of
    // them a dozen times over.
    const vals = {};
    Object.keys(WS.agent.READINGS).forEach((k) => {
      const spec = WS.agent.READINGS[k];
      // A reading with nothing to anchor it cannot be told apart from a
      // coincidence, so it is never claimed rather than claimed on a guess.
      if (!Array.isArray(spec.anchor) || !spec.anchor.length) return;
      const r = WS.agent.tools.read(k);
      if (r) vals[k] = Number(r.value);
    });

    const seen = {};
    const found = [];
    let m;
    NUM.lastIndex = 0;
    while ((m = NUM.exec(s)) && found.length < EVIDENCE_CAP) {
      const raw = m[0];
      const at = m.index;
      const after = s.slice(at + raw.length);
      if (MONTH.test(after)) continue;                      // a date, not a count
      if (s[at - 1] === ':' || after[0] === ':') continue;   // a clock, not a count
      const v = Number(raw.replace(SEP, '').replace(',', '.'));
      if (!isFinite(v)) continue;

      const bounds = sentenceBounds(s, at);
      const win = s.slice(Math.max(bounds[0], at - NEAR),
        Math.min(bounds[1], at + raw.length + NEAR)).toLowerCase();
      Object.keys(vals).forEach((k) => {
        if (seen[k] || vals[k] !== v || found.length >= EVIDENCE_CAP) return;
        if (!WS.agent.READINGS[k].anchor.every((re) => re.test(win))) return;
        seen[k] = true;
        found.push(k);
      });
    }
    return evidenceFor(found);
  }

  // A screen the model wants shown becomes a chip, not a jump. Navigating the
  // moment it answers throws the reply off a phone screen entirely — the
  // person was still reading it.
  const VIEW_RU = { start: 'Пульс', concierge: 'Консьерж', clients: 'Контакты', companies: 'Компании',
    objects: 'Объекты', requests: 'Входящие', leads: 'Лиды', tasks: 'Задачи', shows: 'Показы',
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
      // Not a degradation: the depth ceiling doing exactly its job.
      if (out.length >= limit) return;
      if (!b || typeof b !== 'object') { note('block_shape'); return; }
      const t = String(b.t);
      if (!BLOCK_ARRAYS[t]) { note('block_shape'); return; }
      // Preferred: the block names its data and the code builds it.
      const built = resolve(b);
      if (built) { out.push(built); return; }
      // A block that meant to be data-backed and could not be is dropped rather
      // than quietly falling back to whatever the model typed alongside it.
      if (b.from || Array.isArray(b.reads)) { note('block_no_data'); return; }
      if (!BLOCK_ARRAYS[t].every((f) => Array.isArray(b[f]))) { note('block_shape'); return; }
      if (b.head != null && !Array.isArray(b.head)) { note('block_shape'); return; }
      const web = fromWeb(b);
      if (web) { out.push(web); return; }
      // Claimed to come from outside and did not say from where: dropped. The
      // attribution IS the provenance for such a figure — without it the block
      // is an unsourced number wearing a source's authority.
      if (b.src === 'web') { note('block_unsourced'); return; }
      // Shown, and marked on screen — but counted, because «сколько таблиц
      // Консьерж набрал сам» is the measure of how far the answer is from the
      // rule the whole stand is built on.
      if (NUMERIC[t]) note('model_numeric');
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
    // A figure the model typed is allowed in the chat, where the mark sits
    // beside it, and never in a file that leaves the room saying its numbers
    // came from the workspace. Counted: a document quietly losing its table is
    // the difference between a записка and a записка with a hole in it.
    for (let i = blocks.length; i < all.length; i++) note('report_numeric_dropped');
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
    /* Checked against what the SERVER ordered, not against a recomputation
       here: the page and the prompt could disagree, and the one the model was
       actually told is the only one it can be held to.

       A file in a language nobody asked for is not a document with a defect —
       it is the wrong document, and it is the one artefact here that leaves the
       room unaccompanied. So it is refused rather than marked, and said out
       loud: silently dropping it would leave a broker who asked for a КП
       looking at a reply that says it was assembled. */
    const want = ran && ran.doc;
    const wrote = plan.report ? langOf(reportProse(plan.report)) : null;
    const wrongLang = (want && wrote && wrote !== want) ? wrote : null;
    if (wrongLang) note('report_wrong_lang');
    const report = wrongLang ? null : normReport(plan.report);
    /* Neither of these comes from the model any more. It said which readings it
       leaned on and wrote its own follow-up chips; both were invention with a
       control's authority, and both are things the code can work out from the
       answer it is holding. What the model still sends under those names has
       already been dropped at the proxy — this is where they stopped being read. */
    const evidence = evidenceFrom(text);
    let next = WS.agent.tools.followUps({ text: text, quoted: evidence.map((e) => e.key) });
    const chip = openChip(plan.open);
    // The card the model asked to open leads; a catalogue chip pointing at the
    // same record would be the same button printed twice.
    if (chip) {
      next = [chip].concat(next.filter((n) => !(n.open === chip.open && n.id === chip.id))).slice(0, 3);
    }

    if (plan.act) {
      const ops = Array.isArray(plan.act) ? plan.act : [plan.act];
      // Which posture the change was asked from. An analysis mode does not
      // propose changes on its own, but when the broker instructs one it is
      // carried out — and the card says it came from there, so a change made
      // while reading a report is not mistaken for the report's own doing.
      const p = WS.agent.tools.propose(ops, { title: 'Изменение по просьбе', next: next, askedIn: askedMode(ran && ran.mode) });
      if (p && p.kind === 'proposal') {
        // Whatever was outstanding in this conversation has just been carried
        // out; leaving it parked would have the Concierge waiting on an answer
        // to a question that is already behind it.
        if (WS.engine.clearPendingAction) WS.engine.clearPendingAction();
        p.text = text;
        return p;
      }
      /* Refused for a field that is not there yet. That is not news to the
         broker — the model is asking for it in the same breath — so the reply
         stays the question, and the operation is parked to be finished with the
         answer. Reporting a store error here would make the Concierge look as
         if its own question had failed. */
      if (p && p.code === 'missing_field' && Array.isArray(p.fields) && p.fields.length) {
        WS.engine.setPendingAction({ ops: ops, need: p.fields, collection: p.collection || null });
        note('act_parked');
        return { kind: 'answer', text: text, evidence: evidence, next: next };
      }
      note('act_refused');
      // Any other refusal — say so plainly instead of pretending.
      return {
        kind: 'answer',
        text: text + (p && p.text ? ' Записать не выйдет: ' + p.text : ''),
        evidence: evidence, next: next,
      };
    }
    if (!text && !blocks && !report && !wrongLang) return null;
    const made = report ? WS.report.create(report) : null;
    return {
      kind: 'answer',
      text: text + (wrongLang
        ? ' Документ собрался на ' + (LANG_RU[wrongLang] || 'другом языке') +
          ', а нужен на ' + (LANG_RU[want] || want) + ' — не отдаю его. Попросите ещё раз.'
        : ''),
      blocks: blocks, evidence: evidence, next: next,
      speak: normSay(plan.say_aloud),
      /* A document in a language other than the conversation's is marked with
         it, and with whose account it is on. Only then: the mark exists so the
         broker notices a КП going out in English before they forward it, and a
         label on every Russian note would be the noise that hides it. */
      report: made ? {
        id: made.id, title: made.title, name: made.name, count: report.blocks.length,
        lang: (want && ran && ran.chat && want !== ran.chat) ? want : null,
        why: (ran && ran.docWhy) || null,
      } : null,
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

  /* ---------- which language this answer is written in ----------

     Everything else about a document was computed and this was not, so the
     model computed it: asked for a КП inside a conversation held entirely in
     Russian, it produced one in German. Not a lapse — a gap. The prompt bound
     the language of the CHAT reply and told it of the file only that the file
     goes to the client without them. Given a recipient and no language, «не
     по-русски» is a defensible reading, and after that the choice is a toss.

     The rule is a ladder, and every rung is a fact somebody put in the
     workspace rather than a preference of ours:

       asked   — the person typed the language into the request. Theirs.
       setting — they set it for their documents. Also theirs.
       contact — the recipient's card says what they read.
       market  — a named client with no language: English, the working language
                 of the trade here. Guessing the broker's own would send a
                 Russian КП to somebody who never asked for one.
       broker  — nobody was named, so the document is a note to self, and it is
                 written in the language the conversation is in.                */

  function langCode(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase().slice(0, 2);
    return (s === 'ru' || s === 'en' || s === 'ar') ? s : null;
  }

  // Said out loud in the request: it decides this document and does not outlive
  // it — which is what makes it safe to obey without a control anywhere.
  const ASKED = [
    [/по-?англ|на англ|in english/i, 'en'],
    [/по-?русск|на русск|in russian/i, 'ru'],
    [/по-?арабск|на арабск|in arabic/i, 'ar'],
  ];
  function askedLang(text) {
    const s = String(text == null ? '' : text);
    for (let i = 0; i < ASKED.length; i++) if (ASKED[i][0].test(s)) return ASKED[i][1];
    return null;
  }

  const CYR = /[Ѐ-ӿ]/;
  function chatLang(text) {
    const set = langCode((WS.store || {}).cgLang);
    if (set) return set;
    // «Авто» can only honestly mean the language of the question: somebody
    // typing in Russian is not asking to be answered in English.
    return CYR.test(String(text == null ? '' : text)) ? 'ru' : 'en';
  }

  function langs(text) {
    const chat = chatLang(text);
    const asked = askedLang(text);
    if (asked) return { chat: chat, doc: asked, why: 'asked', who: '' };
    const set = langCode((WS.store || {}).cgDocLang);
    if (set) return { chat: chat, doc: set, why: 'setting', who: '' };
    const ent = WS.agent.tools.findEntity(String(text == null ? '' : text));
    if (ent && ent.kind === 'contact') {
      const c = ((WS.store.data || {}).clients || []).filter((x) => x.id === ent.id)[0];
      const code = c && langCode(c.lang);
      return { chat: chat, doc: code || 'en', why: code ? 'contact' : 'market', who: ent.name };
    }
    return { chat: chat, doc: chat, why: 'broker', who: '' };
  }

  /* ---------- and what came back ----------

     A rule in a prompt is a request; this is the measurement. Scripts settle it
     outright — Cyrillic, Arabic — and for the Latin ones, which look identical
     from a distance, function words do: `der die und für` against `the of and
     for`. Cheap, deterministic, and it names the language it found, so the
     refusal can say what the document actually came back in.

     It abstains rather than guesses. Under forty letters there is nothing to
     read, and a Latin document with no function words at all — a page of names
     and prices — is not evidence of anything.                                */
  const SCRIPTS = { ru: /[Ѐ-ӿ]/g, ar: /[؀-ۿ]/g, la: /[a-z]/gi };
  const WORDS = {
    en: /\b(the|of|and|to|in|for|with|is|are|this|from|we|you)\b/gi,
    de: /\b(der|die|das|und|für|mit|von|ist|nicht|ein|eine|den|dem|auf|sich|wir)\b/gi,
    fr: /\b(le|la|les|des|et|pour|avec|est|dans|une|du|sur|nous|vous)\b/gi,
    es: /\b(el|los|las|de|y|para|con|es|en|una|del|por|nuestro)\b/gi,
  };
  const LANG_MIN_LETTERS = 40;
  const LANG_MIN_WORDS = 2;
  function langOf(text) {
    const s = String(text == null ? '' : text);
    const n = (re) => (s.match(re) || []).length;
    const ru = n(SCRIPTS.ru), ar = n(SCRIPTS.ar), la = n(SCRIPTS.la);
    const letters = ru + ar + la;
    if (letters < LANG_MIN_LETTERS) return null;
    // A share, not a count: a Russian document names «Business Bay» and a
    // Dubai document in any language is full of Latin proper nouns.
    if (ru / letters > 0.3) return 'ru';
    if (ar / letters > 0.3) return 'ar';
    if (la / letters < 0.6) return null;
    const en = n(WORDS.en);
    let other = null, top = 0;
    ['de', 'fr', 'es'].forEach((k) => { const c = n(WORDS[k]); if (c > top) { top = c; other = k; } });
    if (top >= LANG_MIN_WORDS && top > en) return other;
    return en >= LANG_MIN_WORDS ? 'en' : null;
  }
  const LANG_RU = { ru: 'русском', en: 'английском', ar: 'арабском', de: 'немецком', fr: 'французском', es: 'испанском' };

  /* Only what the MODEL wrote. The cells of a data-backed table are ours, and
     they are Russian whatever language the document is in — measure those and
     every English document reads as Russian and is refused, which is a guard
     firing on the correct answer. */
  const PROSE = { p: true, h: true, note: true };
  function reportProse(r) {
    if (!r || typeof r !== 'object') return '';
    const out = [String(r.title || ''), String(r.subtitle || '')];
    (Array.isArray(r.blocks) ? r.blocks : []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (PROSE[String(b.t)] && b.text) out.push(String(b.text));
      if (String(b.t) === 'list' && Array.isArray(b.items)) out.push(b.items.join(' '));
    });
    return out.join(' ');
  }

  // ---------- transport ----------

  async function stream(text, onText, onStage) {
    let res;
    try {
      res = await fetchAsk(text);
    } catch (e) {
      /* Nothing was accepted on the other side. That is not a guess: the
         proxy's `daily_used` rises on every ACCEPTED request, before the model
         runs, and it matched `served` exactly across the run that lost four
         answers — so those four never arrived. Marked here, and only here,
         because everything thrown below this line happens after the server has
         the call. */
      e.reached = false;
      throw e;
    }
    if (!res.ok || !res.body) throw new Error('http ' + res.status);
    return readStream(res, onText, onStage);
  }

  function fetchAsk(text) {
    return fetch(cfg.url.replace(/\/+$/, '') + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ text: text, digest: digest(), history: history(), scope: scope(),
        // На что смотрит агент прямо сейчас. Без этого «а по этой сделке что?» приходило без
        // подлежащего: тред у модели был, экрана — нет, и она честно отвечала, что не поняла.
        screen: screen(), pending: pendingAction(), lang: langs(text) }, composer())),
    });
  }

  // Everything past the response headers: the server has the call from here on,
  // so a failure below is never retried.
  async function readStream(res, onText, onStage) {
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
    /* Refused by US, because the window is still open — not new evidence that
       the service is down. Marked so `noteFailure` does not count it: counting
       it re-armed the window on every question, so under any traffic at all the
       head never came back and the whole session ran on the offline planner.
       That is the bug this window exists to prevent, reached the long way. */
    if (cfg.downUntil > Date.now()) {
      const e = new Error(cfg.lastError || 'cooldown');
      e.cooldown = true;
      throw e;
    }
    if (cfg.downUntil) {
      // The window has passed: forgive the earlier failures and look again.
      cfg.downUntil = 0;
      cfg.misses = 0;
    }
    if (!cfg.ready) await probe();
    if (!cfg.ready) throw new Error(cfg.lastError || 'offline');
    /* One more attempt when the request never left, and never otherwise.

       Diagnosed rather than guessed: the answer this run lost went to
       `net::ERR_NETWORK_CHANGED` — Chrome dropping an in-flight request because
       the machine's network changed under it. On the phone this stand is shown
       on, that is Wi-Fi handing over to LTE, and it costs a visitor the live
       Concierge for that question with nothing on screen to say so.

       Safe only because nothing was accepted on the other side, which the
       proxy's counters establish rather than assume. A failure after the server
       has the call is left alone: the model may already have run, and the
       shared five-hour window is exactly what all these guards protect. */
    let done;
    try {
      done = await stream(text, opts && opts.onText, opts && opts.onStage);
    } catch (e) {
      if (e && e.reached === false) {
        note('retry_no_reach');
        // A moment for a handover to settle. Retrying into the same dead second
        // is not a second attempt, it is the same one twice.
        await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        done = await stream(text, opts && opts.onText, opts && opts.onStage);
      } else {
        throw e;
      }
    }
    // What actually answered, as the server resolved it — not what the page
    // hoped it had asked for. An id it does not know falls back over there.
    const ran = { mode: done.mode || null, depth: done.depth || null,
      doc: done.doc || null, chat: done.chat || null, docWhy: done.docWhy || null };
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

  /* One hiccup should not cost the session its live head, and a service that is
     genuinely down should not be retried on every message the visitor types.

     But «giving up» used to mean uninstalling the head, and nothing ever put it
     back: two failures — a restart during a deploy, a minute of bad wifi at an
     agency — and every remaining question in that session was answered by the
     offline planner, silently, until the page was reloaded. On a demo that is
     the whole meeting. So being down is now a WINDOW, not a verdict: the head
     stays installed, calls during the window fail instantly and cost nothing,
     and the first question after it re-probes and comes back. */
  /* Which of the four things went wrong, because they are four different
     repairs and the record used to hold one line for all of them.

     `Failed to fetch` is the browser's word for everything that happened before
     a response existed — an expired certificate, a refused connection, a socket
     the pool reused after it had quietly died. Twelve hard scenarios lost four
     answers to the offline planner under exactly that string, and it named
     nothing. What told them apart in the end was arithmetic on the server's own
     counters, which is not a thing anyone should have to do twice. */
  function reasonFor(why, err) {
    const s = String(why == null ? '' : why);
    if (/^http \d/.test(s)) return 'fallback_http';              // the server answered, and refused
    if (/stream ended/i.test(s)) return 'fallback_cut';          // it answered and stopped mid-reply
    if (/^offline$|^health/i.test(s)) return 'fallback_offline'; // the probe said no before we asked
    // fetch itself rejected: nothing was ever accepted on the other side.
    if (err && (err.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(s))) {
      return 'fallback_no_reach';
    }
    return 'fallback_model';
  }

  function noteFailure(why, err) {
    // Our own refusal during the window: not new evidence the service is down,
    // and counting it would inflate whichever reason armed the window.
    if (err && err.cooldown) return;
    note(reasonFor(why, err));
    // Already in standdown: the clock is already running; count the miss but
    // do not call disable() again — calling it would re-arm the window from
    // NOW, extending it by exactly one cooldownMs per question asked during it.
    // That is the bug a twelve-scenario hard-run caught: ten of twelve went to
    // the offline planner because every rejected question extended the window.
    cfg.lastError = why || 'error';
    cfg.misses += 1;
    if (cfg.misses >= GIVE_UP_AFTER && cfg.downUntil < Date.now()) disable(why);
  }
  function disable(why) {
    cfg.ready = false;
    cfg.lastError = why || 'disabled';
    // Start the clock from NOW when the head first fails; do NOT extend it
    // while traffic is going through the window — that would keep the window
    // open forever under any load, which is the bug a twelve-scenario run found.
    // But DO arm it again when we are called after the window has already
    // expired (e.g. a fresh standdown after a long quiet period).
    if (cfg.downUntil < Date.now()) cfg.downUntil = Date.now() + cfg.cooldownMs;
  }

  WS.live = {
    ask, probe, install, digest, history, scope, pendingAction, shapeOf, allowed, configuredUrl, toReply, normBlocks, normReport, normSay, evidenceFor, evidenceFrom, noteFailure, disable, composer, langs, langOf, reportProse,
    get ready() { return cfg.ready; },
    get url() { return cfg.url; },
    get misses() { return cfg.misses; },
    // How long the head stays out after giving up. Configurable because a
    // deployment may want a different window — and because a test cannot wait
    // three quarters of a minute to prove the recovery works.
    get cooldownMs() { return cfg.cooldownMs; },
    set cooldownMs(v) { cfg.cooldownMs = Number(v) || 0; },
    get downFor() { return Math.max(0, cfg.downUntil - Date.now()); },
    // For tests only: fully resets standdown state without touching the head.
    resetForTest() { cfg.downUntil = 0; cfg.misses = 0; cfg.lastError = null; },
    get served() { return cfg.served; },
    get lastError() { return cfg.lastError; },
  };
})(window.WS = window.WS || {});
