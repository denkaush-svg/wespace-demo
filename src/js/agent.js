/* ============================================================
   Concierge agent — the hands, plus a head that can be swapped.

   The hands are the only things that touch the stand: they read through the
   query layer and write through the transactional one, so every figure in a
   reply comes from the same code the screens draw from, and nothing is written
   without a proposal a person confirms.

   The head decides WHICH hand to use. The one below is deterministic and works
   with no network — it is both the pre-model behaviour and the lifeboat for
   when the live model is unreachable mid-demo. Swapping in the live model
   (WS.agent.setHead) changes what the Concierge understands, not what it can do.

   One rule holds for every head: no request ends in a refusal. If the answer
   is not in the data, say what IS there and offer the next step.
   ============================================================ */
(function (WS) {
  const money = (v) => (WS.AED ? WS.AED(v) : String(v));
  const lc = (s) => String(s == null ? '' : s).toLowerCase();

  // ---------- hands ----------
  const ACTIVE = [{ field: 'stage', op: 'ne', value: 'done' }];

  // Named readings, each paired with the query that produced it so the number
  // stays openable rather than merely asserted.
  // A count declines the noun after it: 1 задача, 2 задачи, 5 задач. Printing
  // one fixed form gives «3 открытых задач», which no Russian speaker writes —
  // and these labels go straight onto the chips under an answer.
  function plural(n, forms) {
    if (typeof forms === 'string') return forms;
    const a = Math.abs(Math.round(Number(n) || 0)) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b > 1 && b < 5) return forms[1];
    return forms[2];
  }

  const READINGS = {
    deals_active: { label: ['сделка в работе', 'сделки в работе', 'сделок в работе'], q: { from: 'deals', where: ACTIVE, aggregate: { fn: 'count' } } },
    deals_active_sum: { label: 'на сумму', money: true, q: { from: 'deals', where: ACTIVE, aggregate: { fn: 'sum', field: 'amount' } } },
    deals_hot: { label: ['горячая сделка', 'горячие сделки', 'горячих сделок'], q: { from: 'deals', where: [{ field: 'hot', op: 'truthy' }], aggregate: { fn: 'count' } } },
    deals_closed: { label: ['закрытая сделка', 'закрытые сделки', 'закрытых сделок'], q: { from: 'deals', where: [{ field: 'stage', op: 'eq', value: 'done' }], aggregate: { fn: 'count' } } },
    tasks_open: { label: ['открытая задача', 'открытые задачи', 'открытых задач'], q: { from: 'tasks', where: [{ field: 'status', op: 'ne', value: 'done' }], aggregate: { fn: 'count' } } },
    tasks_overdue: { label: ['просроченная задача', 'просроченные задачи', 'просроченных задач'], q: { from: 'tasks', where: [{ field: 'when', op: 'eq', value: 'overdue' }], aggregate: { fn: 'count' } } },
    clients_total: { label: ['контакт', 'контакта', 'контактов'], q: { from: 'clients', aggregate: { fn: 'count' } } },
    clients_no_consent: { label: ['контакт без согласия', 'контакта без согласия', 'контактов без согласия'], q: { from: 'clients', where: [{ field: 'consent', op: 'falsy' }], aggregate: { fn: 'count' } } },
    objects_total: { label: ['объект', 'объекта', 'объектов'], q: { from: 'objects', aggregate: { fn: 'count' } } },
    companies_total: { label: ['компания', 'компании', 'компаний'], q: { from: 'companies', aggregate: { fn: 'count' } } },
    // Заявка — верх воронки стенда. Без этих чтений цифру по лидам можно было
    // назвать, но нельзя было открыть: «откуда это число» не имело источника.
    requests_total: { label: ['заявка', 'заявки', 'заявок'], q: { from: 'requests', aggregate: { fn: 'count' } } },
    requests_hot: { label: ['горячая заявка', 'горячие заявки', 'горячих заявок'], q: { from: 'requests', where: [{ field: 'temperature', op: 'eq', value: 'hot' }], aggregate: { fn: 'count' } } },
    requests_budget_sum: { label: 'бюджета в заявках', money: true, q: { from: 'requests', aggregate: { fn: 'sum', field: 'budget' } } },
  };

  function read(key) {
    const spec = READINGS[key];
    if (!spec) return null;
    const res = WS.query.run(spec.q);
    if (!res.ok) return null;
    return { key: key, label: plural(res.value, spec.label), value: res.value, money: !!spec.money, count: res.count, query: spec.q, revision: res.revision };
  }

  // Metrics the screens show, so an answer cannot drift from a tile.
  function metrics() { return WS.ui.metricsSnapshot(); }

  // Russian names decline, so match on a stem rather than the exact word.
  function stem(word) {
    const w = lc(word);
    return w.length > 3 ? w.slice(0, w.length - 1) : w;
  }
  function findEntity(text) {
    const t = lc(text);
    const d = WS.store.data;
    const byName = (list, kind) => {
      for (let i = 0; i < list.length; i++) {
        const parts = String(list[i].name || '').split(/\s+/);
        for (let p = 0; p < parts.length; p++) {
          const s = stem(parts[p]);
          if (s.length >= 3 && t.indexOf(s) >= 0) return { kind: kind, id: list[i].id, name: list[i].name };
        }
      }
      return null;
    };
    return byName(d.clients || [], 'contact') || byName(d.companies || [], 'company') || null;
  }
  function dealOf(clientId) { return (WS.store.data.deals || []).find((x) => x.clientId === clientId) || null; }

  // ---------- proposals ----------
  // A proposal is a dry run held against the revision it was built at. If the
  // data moves underneath it, confirming is refused rather than silently
  // applied to a world the person never saw.
  const proposals = {};
  let propSeq = 0;

  function propose(ops, meta) {
    const dry = WS.storeApi.preview(ops);
    if (!dry.ok) return { kind: 'error', text: dry.error, code: dry.code, next: suggestions() };
    propSeq++;
    const id = 'pr' + propSeq;
    const p = {
      kind: 'proposal', id: id, tier: dry.tier, ops: ops, revision: WS.store.dataRevision,
      subject: (meta && meta.subject) || null,
      askedIn: (meta && meta.askedIn) || '',
      title: (meta && meta.title) || 'Изменение',
      lines: (meta && meta.lines) || dry.pending,
      note: dry.tier === 'guarded' ? 'Требует подтверждения — меняются деньги, стадия или владелец.' : 'Применю сразу после подтверждения.',
      next: (meta && meta.next) || suggestions(),
      used: false,
    };
    proposals[id] = p;
    return p;
  }

  function confirm(id) {
    const p = proposals[id];
    if (!p) return { ok: false, code: 'unknown', error: 'предложение не найдено' };
    if (p.used) return { ok: false, code: 'used', error: 'уже применено' };
    const res = WS.storeApi.apply(p.ops, { confirmed: true, expectedRevision: p.revision });
    if (res.ok) p.used = true;
    return res;
  }
  function pendingProposal(id) { return proposals[id] || null; }

  // ---------- head: deterministic ----------
  const RE = {
    record: /запиши|записать|зафиксируй|отметь|добавь\s+(заметк|событ|звонок|встреч|коммент)/,
    task: /поставь\s+задач|создай\s+задач|напомни|задача\s*[:—-]/,
    stage: /стади|перевед|перенеси\s+в|этап/,
    send: /отправ|напиши\s+(письмо|сообщ)|составь\s+письмо|подготовь\s+(письмо|сообщ)|whatsapp|ватсап/,
    nav: /открой|перейди|покажи\s+(экран|раздел)/,
    ask: /сколько|скольк|какая|какой|каков|сумма|итог|статус|состояни|что\s+(по|с|у)|покажи|дай/,
  };

  const METRIC_HINTS = [
    [/просроч/, ['tasks_overdue', 'tasks_open']],
    [/задач/, ['tasks_open', 'tasks_overdue']],
    [/горяч/, ['deals_hot', 'deals_active']],
    [/закрыт/, ['deals_closed', 'deals_active']],
    [/соглас/, ['clients_no_consent', 'clients_total']],
    [/контакт|клиент/, ['clients_total', 'clients_no_consent']],
    [/объект/, ['objects_total']],
    [/компан/, ['companies_total']],
    [/сделк|работе|активн|пайплайн|сумм/, ['deals_active', 'deals_active_sum']],
  ];

  const STAGES = [[/новы|заявк/, 'new'], [/работ/, 'work'], [/документ|догов/, 'docs'], [/закрыт|заверш/, 'done']];
  const WHEN = [[/послезавтра/, ['послезавтра', 'tomorrow']], [/завтра/, ['завтра', 'tomorrow']], [/сегодня/, ['сегодня', 'today']]];

  function suggestions() {
    return [
      { label: 'Сколько сделок в работе', ask: 'сколько сделок в работе и на какую сумму' },
      { label: 'Просроченные задачи', ask: 'сколько просроченных задач' },
      { label: 'Контакты без согласия', ask: 'сколько контактов без согласия' },
    ];
  }

  // What the stand actually holds — the honest reply when a question asks for
  // something that is not in the data. Names the fields that DO exist, so the
  // person can ask a question that has an answer instead of hitting a wall.
  function inventory() {
    return WS.query.collections()
      .filter((c) => c.count > 0)
      .map((c) => c.label + ' — ' + c.count);
  }

  function answerReadings(keys, lead) {
    const got = keys.map(read).filter(Boolean);
    if (!got.length) return null;
    const parts = got.map((r) => (r.money ? money(r.value) : r.value) + ' ' + r.label);
    return {
      kind: 'answer',
      text: (lead ? lead + ' ' : '') + parts.join(', ') + '.',
      evidence: got.map((r) => ({ label: r.label, value: r.value, money: r.money, query: r.query, count: r.count })),
      next: suggestions(),
    };
  }

  function orient(text) {
    const head = answerReadings(['deals_active', 'deals_active_sum', 'tasks_overdue'], 'Сейчас по вашей воронке:');
    const know = inventory();
    return {
      kind: 'answer',
      text: (head ? head.text + ' ' : '') + 'Этого в данных стенда нет, поэтому отвечаю тем, что есть: ' + know.join(', ') + '.',
      evidence: head ? head.evidence : [],
      next: suggestions(),
    };
  }

  function deterministicHead(text) {
    const t = lc(text).trim();
    const ent = findEntity(t);

    // outward action — the channel is not wired, so produce the artifact itself
    if (RE.send.test(t)) {
      const who = ent ? ent.name : 'клиенту';
      return {
        kind: 'draft',
        artifact: {
          title: 'Черновик сообщения — ' + who,
          body: 'Добрый день!\n\nПодготовил сравнение по вашему запросу — вложение во вложении.\nГотов созвониться в удобное время.\n\n' +
                ((WS.store.data.users[WS.store.role] || {}).name || 'Агент'),
          note: 'Канал не подключён в демо — сообщение не отправлено. Черновик можно скопировать и отправить вручную.',
        },
        next: suggestions(),
      };
    }

    // record something into a feed
    if (RE.record.test(t) || (ent && /созвон|позвонил|встрет|написал|обсуд/.test(t) && !RE.task.test(t))) {
      if (!ent) return { kind: 'answer', text: 'Записал бы, но не понял, по кому. Назовите контакт или компанию — и повторите.', evidence: [], next: contactChips() };
      const kind = /встреч/.test(t) ? 'meet' : /писал|сообщ|whatsapp/.test(t) ? 'msg' : /созвон|звон/.test(t) ? 'call' : 'note';
      const body = text.replace(/^\s*(запиши|записать|зафиксируй|отметь|добавь)[,:\s]*/i, '').trim() || text.trim();
      return propose(
        [{ op: 'addEvent', scope: ent.kind, id: ent.id, type: kind, text: body }],
        { subject: ent.id, title: 'Запись в ленту — ' + ent.name, lines: ['Лента ' + ent.name + ': «' + body + '»'] }
      );
    }

    // a task
    if (RE.task.test(t)) {
      const w = (WHEN.find((x) => x[0].test(t)) || [null, ['сегодня', 'today']])[1];
      const title = text.replace(/^\s*(поставь|создай)\s+задач\w*[:\s]*/i, '').trim() || 'Задача от Консьержа';
      const task = { id: 'ag_task_' + (propSeq + 1) + '_' + WS.store.dataRevision, title: title, due: w[0], when: w[1], kind: 'manual', status: 'open' };
      if (ent && ent.kind === 'contact') task.clientId = ent.id;
      return propose([{ op: 'addTask', task: task }],
        { subject: ent ? ent.id : null, title: 'Новая задача', lines: ['Задача: «' + title + '», срок — ' + w[0]] });
    }

    // stage change
    if (RE.stage.test(t)) {
      const st = (STAGES.find((x) => x[0].test(t)) || [])[1];
      const deal = ent && ent.kind === 'contact' ? dealOf(ent.id) : null;
      if (!deal || !st) {
        return { kind: 'answer', text: 'Понял про стадию, но не хватает деталей: по какой сделке и в какую стадию. Стадии: заявка, в работе, документы, закрыта.', evidence: [], next: suggestions() };
      }
      return propose([{ op: 'dealStage', id: deal.id, stage: st }],
        { subject: deal.id, title: 'Смена стадии', lines: ['Сделка ' + (deal.title || deal.id) + ': ' + deal.stage + ' → ' + st] });
    }

    // analytics
    if (RE.ask.test(t) || /комисси|конверси|воронк/.test(t)) {
      // Commission first. «какая комиссия набегает по активным сделкам» also
      // matches the generic deals hint, and answering it with deal counts is
      // not a worse answer — it is an answer to a different question.
      if (/комисси/.test(t)) {
        const m = metrics().metrics.expected_commission;
        return {
          kind: 'answer',
          text: 'Ожидаемая комиссия по активным сделкам — ' + money(m.v) + '. Считается по ставке связанного объекта, а не по средней.',
          evidence: [{ label: m.label, value: m.v, money: true, query: { from: 'deals', where: ACTIVE } }],
          next: suggestions(),
        };
      }
      const hit = METRIC_HINTS.find((h) => h[0].test(t));
      if (hit) {
        const ans = answerReadings(hit[1]);
        if (ans) return ans;
      }
      // asked about an entity we know
      if (ent) {
        const deal = ent.kind === 'contact' ? dealOf(ent.id) : null;
        const bits = [ent.name];
        if (deal) bits.push('сделка на ' + money(deal.amount) + ', стадия «' + deal.stage + '»');
        return {
          kind: 'answer', text: bits.join(' — ') + '.',
          evidence: deal ? [{ label: 'сделка', value: deal.amount, money: true, query: { from: 'deals', where: [{ field: 'id', op: 'eq', value: deal.id }] } }] : [],
          next: [{ label: 'Открыть карточку', open: ent.kind, id: ent.id }].concat(suggestions()),
        };
      }
      return orient(t);
    }

    if (RE.nav.test(t)) {
      return { kind: 'answer', text: 'Открываю. Если нужен другой раздел — скажите какой.', evidence: [], next: suggestions() };
    }

    return orient(t);
  }

  function contactChips() {
    return (WS.store.data.clients || []).slice(0, 3).map((c) => ({ label: c.name, ask: 'что по ' + c.name.split(' ')[0] }));
  }

  // ---------- entry ----------
  let head = deterministicHead;
  function setHead(fn) { head = typeof fn === 'function' ? fn : deterministicHead; }

  // The live head is asynchronous and may simply not be there. It is held
  // apart from the synchronous one so that everything which calls ask() keeps
  // working untouched, and so that a failure has an obvious place to land.
  let asyncHead = null;
  function setAsyncHead(fn) { asyncHead = typeof fn === 'function' ? fn : null; }
  function hasAsyncHead() { return !!asyncHead; }

  // Falls back on ANY failure, silently. A visitor is never shown a transport
  // problem: the offline planner answers the same question, more plainly.
  async function askAsync(text, opts) {
    const clean = String(text == null ? '' : text).trim();
    if (!clean) return ask(clean);
    if (asyncHead) {
      try {
        const reply = await asyncHead(clean, opts || {});
        if (reply && reply.kind) {
          if (!Array.isArray(reply.next) || !reply.next.length) reply.next = suggestions();
          return reply;
        }
      } catch (e) {
        if (WS.live && WS.live.noteFailure) WS.live.noteFailure(String(e && e.message || e));
      }
    }
    return ask(clean);
  }

  // Synchronous for the deterministic head. When the live model is wired in it
  // will stream, and the streaming entry point lands beside this one rather
  // than changing its shape — the hands and the proposal flow stay identical.
  function ask(text) {
    const clean = String(text == null ? '' : text).trim();
    if (!clean) return { kind: 'answer', text: 'Слушаю.', evidence: [], next: suggestions() };
    let reply;
    try { reply = head(clean); } catch (e) { reply = null; }
    if (!reply || !reply.kind) reply = orient(clean);
    if (!Array.isArray(reply.next) || !reply.next.length) reply.next = suggestions();
    return reply;
  }

  function openThread(id, label) {
    WS.engine.openThread(id || 'general', label || 'Консьерж', 'sparkle');
  }

  // Declared for a model to read. The same list the deterministic head works
  // through, so swapping the head cannot widen what the Concierge may do.
  function toolSchema() {
    return [
      { name: 'query', description: 'Посчитать по данным стенда: коллекция, условия, агрегат. Возвращает число и записи, из которых оно получено.', input: { from: 'string', where: 'array', aggregate: 'object' } },
      { name: 'metrics', description: 'Именованные показатели, те же, что на экранах.', input: {} },
      { name: 'findEntity', description: 'Найти контакт или компанию по упоминанию имени в тексте.', input: { text: 'string' } },
      { name: 'propose', description: 'Предложить изменения. Ничего не пишет — возвращает предпросмотр для подтверждения человеком.', input: { ops: 'array' } },
      { name: 'draft', description: 'Собрать черновик сообщения или документа для канала, который в демо не подключён.', input: { kind: 'string', to: 'string' } },
      { name: 'navigate', description: 'Открыть экран или карточку.', input: { view: 'string', id: 'string' } },
    ];
  }

  WS.agent = {
    ask, askAsync, confirm, setHead, setAsyncHead, hasAsyncHead, openThread, toolSchema, pendingProposal,
    tools: { read, metrics, findEntity, propose, query: (s) => WS.query.run(s), inventory, plural },
    get head() { return head; },
    READINGS,
  };
})(window.WS = window.WS || {});
