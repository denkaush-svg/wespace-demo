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
  // `where` is a conjunction, so «not terminal» is two conditions rather than one negated value.
  const ACTIVE = [{ field: 'stage', op: 'ne', value: 'won' }, { field: 'stage', op: 'ne', value: 'lost' }];

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

  /* `anchor` is what makes a figure in an answer attributable to a reading.

     The chips under a reply are captioned «откуда это число», and until now the
     model chose which ones appeared: it named the readings it claimed to have
     leaned on and the code re-read them. That proved the figure on the chip was
     real and proved nothing about the sentence above it — «8 сделок в работе»
     over a chip reading 12 is two numbers disagreeing under a caption that says
     they are the same one.

     The code finds them instead, by looking for the reading's own value in the
     narration. A value alone is a coincidence waiting to happen — every count in
     this stand is a small number, and «2» is as likely to be a bedroom count as
     a deal count. So a match also requires the words the figure is counting,
     written beside it: every pattern here has to appear within a couple of dozen
     characters of the number, inside its own sentence. That is what separates
     «2 горячие заявки» from «2 горячие сделки», and what keeps «проверен 12 мая»
     from being read as a count of objects because the clause began «Объект».
     The window itself is in live.js, where the matching runs. */
  const READINGS = {
    deals_active: { label: ['сделка в работе', 'сделки в работе', 'сделок в работе'], anchor: [/сделк|сделок/], q: { from: 'deals', where: ACTIVE, aggregate: { fn: 'count' } } },
    deals_active_sum: { label: 'на сумму', money: true, anchor: [/сделк|сделок|сумм|портфел|объём|объем/], q: { from: 'deals', where: ACTIVE, aggregate: { fn: 'sum', field: 'amount' } } },
    deals_hot: { label: ['горячая сделка', 'горячие сделки', 'горячих сделок'], anchor: [/горяч/, /сделк|сделок/], q: { from: 'deals', where: [{ field: 'hot', op: 'truthy' }], aggregate: { fn: 'count' } } },
    deals_closed: { label: ['закрытая сделка', 'закрытые сделки', 'закрытых сделок'], anchor: [/закрыт|выигр|успешн/, /сделк|сделок/], q: { from: 'deals', where: [{ field: 'stage', op: 'eq', value: 'won' }], aggregate: { fn: 'count' } } },
    tasks_open: { label: ['открытая задача', 'открытые задачи', 'открытых задач'], anchor: [/задач/], q: { from: 'tasks', where: [{ field: 'status', op: 'ne', value: 'done' }], aggregate: { fn: 'count' } } },
    tasks_overdue: { label: ['просроченная задача', 'просроченные задачи', 'просроченных задач'], anchor: [/просроч/, /задач/], q: { from: 'tasks', where: [{ field: 'when', op: 'eq', value: 'overdue' }], aggregate: { fn: 'count' } } },
    clients_total: { label: ['контакт', 'контакта', 'контактов'], anchor: [/контакт|клиент/], q: { from: 'clients', aggregate: { fn: 'count' } } },
    clients_no_consent: { label: ['контакт без согласия', 'контакта без согласия', 'контактов без согласия'], anchor: [/соглас/, /контакт|клиент/], q: { from: 'clients', where: [{ field: 'consent', op: 'falsy' }], aggregate: { fn: 'count' } } },
    objects_total: { label: ['объект', 'объекта', 'объектов'], anchor: [/объект|лот/], q: { from: 'objects', aggregate: { fn: 'count' } } },
    companies_total: { label: ['компания', 'компании', 'компаний'], anchor: [/компан|застройщик/], q: { from: 'companies', aggregate: { fn: 'count' } } },
    // Заявка — верх воронки стенда. Без этих чтений цифру по лидам можно было
    // назвать, но нельзя было открыть: «откуда это число» не имело источника.
    requests_total: { label: ['заявка', 'заявки', 'заявок'], anchor: [/заявк|заявок/], q: { from: 'requests', aggregate: { fn: 'count' } } },
    requests_hot: { label: ['горячая заявка', 'горячие заявки', 'горячих заявок'], anchor: [/горяч/, /заявк|заявок/], q: { from: 'requests', where: [{ field: 'temperature', op: 'eq', value: 'hot' }], aggregate: { fn: 'count' } } },
    requests_budget_sum: { label: 'бюджета в заявках', money: true, anchor: [/бюджет/, /заявк|заявок/], q: { from: 'requests', aggregate: { fn: 'sum', field: 'budget' } } },
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
  /* Whom a sentence is about. Two people share a surname in this workspace —
     Виктор Орлов and Сергей Орлов — and taking the FIRST name part that matched
     meant «есть только Сергей Орлов» offered a way into Виктор's card: the
     surname matched him first because he is earlier in the list.

     So the parts are counted rather than raced. «Сергею Орлову» matches two of
     one name and one of the other, and the given name is exactly what a person
     uses to tell them apart. A bare «Орлов» matches one of each, nobody wins,
     and nothing is claimed — the same rule `dealOf` already follows one screen
     down: several candidates are not guessed between. */
  function findEntity(text) {
    const t = lc(text);
    const d = WS.store.data;
    const best = (list, kind) => {
      let top = null;
      let tie = false;
      (list || []).forEach((x) => {
        let hits = 0;
        String(x.name || '').split(/\s+/).forEach((w) => {
          const s = stem(w);
          if (s.length >= 3 && t.indexOf(s) >= 0) hits++;
        });
        if (!hits) return;
        if (!top || hits > top.hits) { top = { kind: kind, id: x.id, name: x.name, hits: hits }; tie = false; }
        else if (hits === top.hits) tie = true;
      });
      return (top && !tie) ? { kind: top.kind, id: top.id, name: top.name } : null;
    };
    return best(d.clients, 'contact') || best(d.companies, 'company') || null;
  }
  function dealsOf(clientId) {
    return (WS.store.data.deals || []).filter((x) => x.clientId === clientId);
  }
  // Одна живая сделка — берём её. Несколько — не угадываем: раньше бралась первая в массиве,
  // и «переведи сделку Анны дальше» двигало ту, которую агент не имел в виду.
  function dealOf(clientId) {
    const live = dealsOf(clientId).filter((x) => x.stage !== 'won' && x.stage !== 'lost');
    if (live.length === 1) return live[0];
    if (!live.length) { const all = dealsOf(clientId); return all.length === 1 ? all[0] : null; }
    return null;
  }
  // Уточнение имеет смысл, только если названное можно узнать. Раньше Консьерж спрашивал,
  // о какой сделке речь, и на ответ отвечал тем же вопросом: названия сделок он не разбирал.
  function dealByText(clientId, t) {
    const live = dealsOf(clientId).filter((x) => x.stage !== 'won' && x.stage !== 'lost');
    const low = String(t || '').toLowerCase();
    const words = (s) => String(s || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 3);
    const hit = live.filter((d) => {
      if (low.indexOf(String(d.id).toLowerCase()) >= 0) return true;
      const o = (WS.store.data.objects || []).find((x) => x.id === d.objectId);
      const pool = words(d.title).concat(words(d.sub)).concat(words(o && o.name)).concat(words(o && o.project));
      return pool.some((w) => low.indexOf(w) >= 0);
    });
    return hit.length === 1 ? hit[0] : null;
  }
  function dealChoiceText(clientId) {
    const live = dealsOf(clientId).filter((x) => x.stage !== 'won' && x.stage !== 'lost');
    if (live.length < 2) return '';
    return ' У клиента открыто ' + live.length + ' сделки: ' + live.map((d) => '«' + (d.title || d.id) + '»').join(', ') + '. Назовите, о какой речь.';
  }

  // ---------- proposals ----------
  // A proposal is a dry run held against the revision it was built at. If the
  // data moves underneath it, confirming is refused rather than silently
  // applied to a world the person never saw.
  const proposals = {};
  let propSeq = 0;

  function propose(ops, meta) {
    const dry = WS.storeApi.preview(ops);
    // The refusal travels with WHAT was refused. Without the field and the
    // collection, an unfinished instruction can only be reported, not resumed.
    if (!dry.ok) {
      return { kind: 'error', text: dry.error, code: dry.code, next: suggestions(),
        fields: dry.fields || null, collection: dry.collection || null };
    }
    propSeq++;
    const id = 'pr' + propSeq;
    const p = {
      kind: 'proposal', id: id, tier: dry.tier, ops: ops, revision: WS.store.dataRevision,
      subject: (meta && meta.subject) || null,
      askedIn: (meta && meta.askedIn) || '',
      title: (meta && meta.title) || 'Изменение',
      lines: (meta && meta.lines) || dry.pending,
      // Which key conditions a record being created still lacks. Computed by the
      // write layer from the record itself, never written here or by the model.
      missing: dry.missing || [],
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

  // Spoken stage names → keys. Ordered longest-intent first: «подготовк» must win over «работ»,
  // and «проигр» over «закрыт», or a lost deal gets filed as a win.
  const STAGES = [[/подготовк/, 'prep'], [/брон/, 'book'], [/подписан|оплат/, 'sign'],
    [/регистрац/, 'reg'], [/выполнен/, 'exec'], [/проигр|отказ/, 'lost'], [/успех|закрыт|заверш|выигр/, 'won']];
  // Слова пресейла сделке не принадлежат: подбор, КП, показ и переговоры — состояния заявки,
  // и стадия заявки не присваивается, а вычисляется. Их ловим отдельно, чтобы ответить по делу.
  const PRESALE_WORDS = /подбор|кп|предложен|показ|встреч|осмотр|переговор/i;
  const WHEN = [[/послезавтра/, ['послезавтра', 'tomorrow']], [/завтра/, ['завтра', 'tomorrow']], [/сегодня/, ['сегодня', 'today']]];

  /* ---------- follow-ups ----------

     The chips under an answer used to be written by whoever answered: the live
     model made up its own, three at a time, and nothing checked them. A model
     that had just been told a district is not in our data would still offer
     «показать динамику по Марине» as the next step — the chip is a sentence
     dropped straight back into the composer, so a made-up one is a question
     built to fail on the turn after.

     The catalogue below is the whole vocabulary, and every entry carries the
     reading that has to be non-empty for it to be offered. A chip that appears
     has an answer waiting behind it, which is the only property worth having
     here. It is not a big list on purpose: three chips is what fits under a
     reply on a phone, and a menu is not a suggestion. */
  const FOLLOW_UPS = [
    { need: 'deals_active', label: 'Сколько сделок в работе', ask: 'сколько сделок в работе и на какую сумму' },
    { need: 'tasks_overdue', label: 'Просроченные задачи', ask: 'какие задачи просрочены и по кому' },
    { need: 'requests_hot', label: 'Горячие заявки', ask: 'какие заявки горячие и что по ним дальше' },
    { need: 'deals_hot', label: 'Горячие сделки', ask: 'какие сделки горячие и что мешает их закрыть' },
    { need: 'clients_no_consent', label: 'Контакты без согласия', ask: 'кто из контактов без согласия на переписку' },
    { need: 'requests_total', label: 'Что в заявках', ask: 'что сейчас в заявках и на какой они стадии' },
    { need: 'objects_total', label: 'Что есть в объектах', ask: 'какие объекты у нас есть и в каких районах' },
  ];

  /* ctx: { text, quoted, limit }
       text   — the answer just given; someone named in it gets a way into their card
       quoted — readings the answer already spoke about, so a chip does not
                offer back the question that has just been answered
       limit  — how many chips fit; three under a reply, more only for a test */
  function followUps(ctx) {
    const c = ctx || {};
    const cap = c.limit > 0 ? c.limit : 3;
    const said = {};
    (Array.isArray(c.quoted) ? c.quoted : []).forEach((k) => { said[k] = true; });
    const out = [];

    const ent = c.text ? findEntity(c.text) : null;
    if (ent) out.push({ label: 'Открыть ' + ent.name, open: ent.kind, id: ent.id });

    for (let i = 0; i < FOLLOW_UPS.length && out.length < cap; i++) {
      const f = FOLLOW_UPS[i];
      if (said[f.need]) continue;
      const r = read(f.need);
      if (!r || !(Number(r.value) > 0)) continue;
      out.push({ label: f.label, ask: f.ask });
    }
    /* Everything preconditioned away — an empty workspace, or an answer that
       covered the lot. A reply with no way forward reads as a dead end, so the
       inventory question is the floor: it is answerable whatever the data. */
    if (!out.length) out.push({ label: 'Что у нас есть', ask: 'что вообще есть в данных' });
    return out.slice(0, cap);
  }

  // Kept as the name the rest of this file calls it by: a follow-up with no
  // answer in front of it and nothing to exclude.
  function suggestions() { return followUps({}); }

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
      // Offering back the question just answered is the chip equivalent of not
      // listening, so what this reply covered is excluded from what it suggests.
      next: followUps({ quoted: got.map((r) => r.key) }),
    };
  }

  /* The catch-all: the question named something this stand does not hold.

     It used to open with the funnel — «Сейчас по вашей воронке: 8 сделок,
     20 228 000 AED, 1 просроченная задача» — in answer to «собери аналитику по
     Dubai Jumeirah». Nobody asked for that, and three evidence chips under it
     dressed an unrelated dump as the answer. The rule the whole stand runs on
     is that a figure is offered because it was asked for.

     So: say what is missing, and — when the question named a district — say
     which districts there ARE, because that is the one thing that makes the
     next question answerable. */
  function orient(text) {
    const know = inventory();
    const t = lc(text || '');
    /* Which districts this stand can actually speak about — read from the
       market slice, not from AREAS. AREAS holds the four with the full picture
       (they also carry inventory); the slice covers nine, five of them
       illustrative. Naming only the four told a broker that Palm Jumeirah and
       Downtown are absent when a row for each is right there, which is the same
       class of mistake as inventing one. */
    const res = WS.query.run({ from: 'market' });
    const areas = (res && Array.isArray(res.rows) ? res.rows : [])
      .map((m) => m.район || m.area || m.name).filter(Boolean);
    const askedArea = areas.length &&
      /район|аналитик|рынок|цен|доходн|аренд|jumeirah|palm|downtown|marina|jlt|jbr|arjan|hills/i.test(t);
    const lines = askedArea
      ? ['Этого района в нашем срезе рынка нет. Есть: ' + areas.join(', ') + '.',
         'Могу разобрать любой — цену за метр, доходность, срок экспозиции.']
      : ['Такого у нас в данных нет. Что есть: ' + know.join(', ') + '.',
         'Скажите, что из этого посмотреть.'];
    return {
      kind: 'answer',
      text: lines.join(' '),
      // No chips: nothing was measured to answer THIS question, and a chip is a
      // claim that a figure came from a query behind it.
      evidence: [],
      next: suggestions(),
    };
  }

  /* Finishes an instruction this conversation already holds.

     This is the turn that used to read «связь с моделью прервалась, повторите
     поручение целиком» — the Concierge asking for a name and then, one line
     later, not knowing what the name was for. It does not need the model: the
     operation is parked whole, one field short, and the broker just said the
     field.

     Only when exactly one thing is missing. Two would mean deciding which of
     them the answer is, and that is a guess about a record. */
  function fillPending(pend, value) {
    const ops = JSON.parse(JSON.stringify(pend.ops || []));
    const field = pend.need[0];
    for (let i = 0; i < ops.length; i++) {
      const rec = ops[i].task || ops[i].obj || ops[i].record;
      if (!rec || typeof rec !== 'object') continue;
      if (rec[field] == null || String(rec[field]).trim() === '') { rec[field] = value; return ops; }
    }
    return null;
  }

  function deterministicHead(text) {
    const t = lc(text).trim();
    const ent = findEntity(t);

    // Before anything else: the conversation is waiting on one value, and this
    // turn looks like a value. Nothing else it could reasonably be.
    const pend = (WS.engine && WS.engine.pendingAction) ? WS.engine.pendingAction() : null;
    if (pend && (pend.need || []).length === 1 && looksLikeAValue(text)) {
      const ops = fillPending(pend, String(text).trim());
      const p = ops && propose(ops, { title: 'Новая запись' });
      if (p && p.kind === 'proposal') {
        if (WS.engine.clearPendingAction) WS.engine.clearPendingAction();
        return p;
      }
    }

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
      const deal = ent && ent.kind === 'contact' ? (dealOf(ent.id) || dealByText(ent.id, t)) : null;
      if (!st && PRESALE_WORDS.test(t)) {
        return { kind: 'answer', text: 'Это стадия заявки, а не сделки, и она не выставляется вручную: заявка сама встаёт на подбор, показ или переговоры, когда появляется факт. Отметьте на заявке предложенный объект или добавьте событие — стадия сдвинется сама.', evidence: [], next: suggestions() };
      }
      if (!deal || !st) {
        const pick = ent && ent.kind === 'contact' ? dealChoiceText(ent.id) : '';
        return { kind: 'answer', text: 'Понял про шаг сделки, но не хватает деталей: по какой сделке и на какой шаг. Шаги: подготовка, бронирование, подписание, регистрация, закрыта.' + pick, evidence: [], next: suggestions() };
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
        else if (ent.kind === 'contact') {
          const live = dealsOf(ent.id).filter((x) => x.stage !== 'won' && x.stage !== 'lost');
          if (live.length > 1) bits.push('открытых сделок — ' + live.length + ': ' + live.map((d) => '«' + (d.title || d.id) + '»').join(', '));
        }
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

    /* The turn is an ANSWER to a question we asked, not a new question.

       The Concierge asked for a name; the broker typed «Петя Вольный»; and this
       head — which holds no conversation state — read two words it did not
       recognise and replied with a catalogue of what data exists. To the person
       that is the assistant forgetting its own question one line later, which
       is worse than any wrong answer.

       This head cannot carry out the instruction that was pending (only the
       live one can), but it can avoid pretending the turn was a query, and say
       what to do to get back on track. */
    if (answersAQuestion(text)) {
      return {
        kind: 'answer',
        text: 'Записал: ' + String(text).trim().slice(0, 60) + '. Только я потерял нить — ' +
          'связь с моделью прервалась, и продолжить начатое я сейчас не могу. ' +
          'Повторите поручение целиком одной фразой, вместе с этим ответом.',
        evidence: [],
        next: suggestions(),
      };
    }

    return orient(t);
  }

  /* Does this turn look like a reply to something we just asked, rather than a
     question of its own? Two signals, and both must hold: the previous reply
     from the Concierge ended in a question, and this turn is too short and too
     unlike a query to be one. Names, numbers, «да», a channel — the shapes an
     answer takes. */
  /* The shape half: a name, a number, «да», a channel — short, and not built
     like a query. Split out because a parked instruction is its own evidence
     that something was asked, and a better one: it survives the reply object
     being replaced, which `lastReply` does not. */
  function looksLikeAValue(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s || s.length > 60 || s.split(/\s+/).length > 5) return false;
    return !/[?]|как|что|сколько|почему|когда|где|кто|покажи|дай|собери|сравни/i.test(s);
  }
  function answersAQuestion(text) {
    if (!looksLikeAValue(text)) return false;
    const prev = (WS.engine && WS.engine.lastReply) || null;
    const asked = prev && typeof prev.text === 'string' && /\?\s*$/.test(prev.text.trim());
    return !!asked;
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
        // The error travels too: a refusal issued during the stand-down window
        // must not be counted as fresh evidence that the service is down.
        if (WS.live && WS.live.noteFailure) WS.live.noteFailure(String(e && e.message || e), e);
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
      { name: 'query', description: 'Посчитать по нашим данным: коллекция, условия, агрегат. Возвращает число и записи, из которых оно получено.', input: { from: 'string', where: 'array', aggregate: 'object' } },
      { name: 'metrics', description: 'Именованные показатели, те же, что на экранах.', input: {} },
      { name: 'findEntity', description: 'Найти контакт или компанию по упоминанию имени в тексте.', input: { text: 'string' } },
      { name: 'propose', description: 'Предложить изменения. Ничего не пишет — возвращает предпросмотр для подтверждения человеком.', input: { ops: 'array' } },
      { name: 'draft', description: 'Собрать черновик сообщения или документа для канала, который в демо не подключён.', input: { kind: 'string', to: 'string' } },
      { name: 'navigate', description: 'Открыть экран или карточку.', input: { view: 'string', id: 'string' } },
    ];
  }

  WS.agent = {
    ask, askAsync, confirm, setHead, setAsyncHead, hasAsyncHead, openThread, toolSchema, pendingProposal,
    tools: { read, metrics, findEntity, propose, query: (s) => WS.query.run(s), inventory, plural, followUps },
    get head() { return head; },
    READINGS,
  };
})(window.WS = window.WS || {});
