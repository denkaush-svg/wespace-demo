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
  const note = (k) => { if (WS.quality) WS.quality.note(k); };

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
    requests_total: { label: ['запрос', 'запроса', 'запросов'], anchor: [/заявк|заявок/], q: { from: 'requests', aggregate: { fn: 'count' } } },
    requests_hot: { label: ['горячий запрос', 'горячих запроса', 'горячих запросов'], anchor: [/горяч/, /заявк|заявок/], q: { from: 'requests', where: [{ field: 'temperature', op: 'eq', value: 'hot' }], aggregate: { fn: 'count' } } },
    requests_budget_sum: { label: 'бюджета в запросах', money: true, anchor: [/бюджет/, /заявк|заявок/], q: { from: 'requests', aggregate: { fn: 'sum', field: 'budget' } } },
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
  /* Область задачи, поставленной Консьержем, берётся из треда, в котором его позвали:
     «поставь задачу» внутри сделки принадлежит ЭТОЙ сделке, а не просто её клиенту.
     Прежде ставилась только ссылка на контакт, и у клиента с тремя сделками задача оседала
     без области — тот же дефект, что чинила первая волна, только с другого входа.
     Тред — единственное, что об этом знает; разбор текста об этом не знает ничего. */
  function threadScope() {
    const id = String((WS.engine && WS.engine.activeThreadId && WS.engine.activeThreadId()) || '');
    const d = WS.store.data || {};
    const at = (pfx, coll) => (id.indexOf(pfx) === 0
      ? (d[coll] || []).find((y) => y.id === id.slice(pfx.length))
      : null);
    const deal = at('deal:', 'deals');
    if (deal) return { dealId: deal.id, clientId: deal.clientId };
    const req = at('request:', 'requests');
    if (req) return { requestId: req.id, clientId: req.clientId };
    const c = at('contact:', 'clients');
    if (c) return { clientId: c.id };
    // Тред молчит — смотрим на экран. Поручение, отданное со сделки, принадлежит ей, даже если
    // разговор начали круглой кнопкой, а не из карточки.
    const scr = (WS.ui && WS.ui.screenContext) ? WS.ui.screenContext() : null;
    const rec = scr && scr.запись;
    if (rec && rec.тип === 'сделка') {
      const dl = (d.deals || []).find((x) => x.id === rec.id);
      if (dl) return { dealId: dl.id, clientId: dl.clientId };
    }
    if (rec && rec.тип === 'запрос') {
      const rq = (d.requests || []).find((x) => x.id === rec.id);
      if (rq) return { requestId: rq.id, clientId: rq.clientId };
    }
    if (rec && rec.тип === 'контакт') return { clientId: rec.id };
    return null;
  }
  /* «А по этой сделке что?» — вопрос без подлежащего, и раньше он им и оставался: планировщик
     искал имя в тексте, не находил и отвечал общей сводкой по рабочему месту. Подлежащее стоит
     на экране. Ответ собирается ИЗ ПОЛЕЙ ЗАПИСИ — ни одного числа сверх того, что в ней есть. */
  /* `\b` в JS определён только по латинице: `\bэт` не совпадает НИКОГДА — и пробел, и «э» оба
     не словесные символы, границы между ними нет. Первая версия этого правила молча не
     срабатывала ни разу, поэтому граница слова выписана явно. */
  const DEMONSTRATIVE = /(^|[^а-яёa-z])(эт(?:ой|у|ому|ом|от|а|о|и)|здесь|тут|текущ\w*|по ней|по нему)(?![а-яё])/i;
  /* Вопрос про МНОЖЕСТВО, а не про открытую запись. Читается в двух местах — при разборе
     области вопроса и при уточнении, — поэтому живёт одним определением: два списка слов
     разъехались бы на первой же правке. */
  /* Разделено надвое. MANY — слова, которыми спрашивают ПРО МНОЖЕСТВО: «сколько», «все»,
     «список», «воронка». GLOBAL — они же плюс глаголы показа. Глагол сам по себе множества не
     означает: «покажи сводку сделки», стоя на сделке, — вопрос про неё, а отвечал он счётчиком
     «8 сделок в работе, 20 228 000 AED». Одно определение, потому что два разъедутся. */
  const MANY = new RegExp(['сколько|скольк|всего|все\\s|всех|список|перечисл|в работе|по всем|у меня|воронк|конверси',
    /* Формы, которые бывают только множественными. Именительный («сделки», «заявки») сюда не
       входит: он же — родительный единственного, и «саммари сделки» им бы отбилось. */
    'сделок|сделкам|сделками|сделках|заявок|заявкам|заявками|заявках',
    'запросов|запросам|запросами|запросах|объектов|объектам|объектами|объектах',
    'контактов|контактам|клиентов|клиентам|компаний|компаниям|задачам|задачах',
    /* «Задач» — только множественное; «задача», «задаче», «задачу» — нет, поэтому справа
       выписана граница. «Задачи» не берём по той же причине, что и «сделки»: это и родительный
       единственного тоже. */
    'задач(?![а-яё])',
    /* «Какие» перед названием коллекции — вопрос про множество: «какие сделки активны» отвечалось
       справкой по открытой сделке, потому что «сделки» содержит корень записи. Само по себе
       «какие» множества не означает — «какие риски по сделке» остаётся вопросом про неё. */
    'каки(е|х|ми)\\s+(сделк|задач|объект|заяв|запрос|контакт|клиент|компани)'].join('|'), 'i');
  const GLOBAL = new RegExp(MANY.source + '|покажи|показать|дай |выведи', 'i');
  // Слово, которым называют саму открытую запись. «Сделай саммари СДЕЛКИ», стоя на сделке, —
  // это вопрос про неё, даже когда указательного слова нет вовсе.
  const KIND_WORD = { 'сделка': /сделк|сдело/i, 'запрос': /заяв|запрос/i, 'контакт': /контакт|клиент/i,
    'компания': /компан/i, 'объект': /объект|лот/i };
  /* Слова, которыми спрашивают про ОТКРЫТУЮ запись, не называя её. Брокер стоит на сделке и
     пишет «саммари», «что дальше», «какой бюджет», «кто клиент»: подлежащего в этих фразах нет
     вовсе. Прежнее правило требовало указательного слова («по этой») или слова-названия вида
     записи («сделки») — и всё перечисленное падало в «Не понял вопрос. Вы стоите на записи
     …, уточните, что по ней нужно». То есть Консьерж переспрашивал ровно про то, что у него
     перед глазами, — это и создаёт впечатление, что он не понимает, где находится.
     «Объекта» здесь нет намеренно: «какой этаж у объекта», заданное со сделки, — вопрос про
     объект, и отвечать на него сводкой по сделке значит выдать левую информацию. */
  const ASK_BRIEF = /саммари|сводк|резюме|кратк|коротко|в двух словах|о ч[её]м|суть|справк|бриф|расскажи|что по |что там|статус|состояни/i;
  const ASK_NEXT = /что дальше|дальше по|следующ|что делать|какой шаг|на каком шаг|когда касани|когда звон/i;
  const ASK_BLOCK = /мешает|блокир|застрял|тормоз|почему не|что не так|какие риск/i;
  /* Только те поля, которые запись действительно несёт (см. screenContext): спрашивают про
     бюджет, клиента, шаг и срок. Комиссии в записи нет — и её здесь нет тоже, иначе вопрос
     «какая комиссия по активным сделкам» сузился бы до открытой сделки. */
  const ASK_FIELD = /бюджет|сумм|стоимост|кто клиент|клиент|заказчик|шаг|стади|срок|дедлайн|касани/i;
  const CARD_ASK = new RegExp([ASK_BRIEF, ASK_NEXT, ASK_BLOCK, ASK_FIELD]
    .map((r) => r.source).join('|'), 'i');
  /* Вопрос, заданный из-под карточки, — вопрос про эту карточку.
     Раньше «сделай саммари сделки» уходило в общую аналитику и возвращалось сводкой по всему
     рабочему месту: «8 сделок в работе, 20 228 000 AED». Формально это ответ, по сути — левая
     информация вместо ответа на заданный вопрос. Правило: если на экране открыта запись и
     брокер не назвал ДРУГОГО человека, вопрос считается заданным про неё. */
  function screenScoped(text) {
    const scr = (WS.ui && WS.ui.screenContext) ? WS.ui.screenContext() : null;
    const rec = scr && scr.запись;
    if (!rec) return null;
    const t = lc(text || '');
    const named = findEntity(text);
    /* Назвали кого-то вслух — значит, спрашивают не про открытую запись. Сверяем со ВСЕМИ
       именами, которые эта запись законно покрывает: её клиентом и её собственным названием.
       Прежняя проверка смотрела только на клиента, и на карточке компании вопрос «что по
       компании N» возвращал сводку по открытой компании, а не по названной. */
    const own = [rec.клиент, (rec.тип === 'контакт' || rec.тип === 'компания') ? rec.название : null]
      .filter(Boolean).map(lc);
    if (named && named.name && own.indexOf(lc(named.name)) < 0) return null;
    // Указательное слово перевешивает всё: «сколько задач по этой сделке» — про неё.
    if (DEMONSTRATIVE.test(t)) return rec;
    /* Слово, которым спрашивают про запись, перевешивает глагол показа, но не перевешивает
       множество: «покажи сводку сделки» — про открытую сделку, «сколько сделок» — про все. */
    if (CARD_ASK.test(t)) return MANY.test(t) ? null : rec;
    // «Сколько сделок в работе», «покажи все сделки» — вопрос про множество.
    if (GLOBAL.test(t)) return null;
    /* MANY здесь не проверяется намеренно: GLOBAL включает MANY целиком и стоит строкой выше,
       так что до этой строки вопрос про множество не доходит. Вторая проверка выглядела бы
       защитой, которая не срабатывает ни разу. */
    const kw = KIND_WORD[rec.тип];
    return (kw && kw.test(t)) ? rec : null;
  }
  /* Ответ про открытую запись.

     Раньше он был перечнем полей с припиской «Спросите конкретнее — что собрать, что
     просрочено, что дальше»: та же просьба переспросить, только другими словами. Спросили
     справку — отдаётся справка, ТА ЖЕ, что стоит на карточке; спросили, что дальше, —
     называется шаг, срок и кто ведёт; спросили, что мешает, — называется причина.

     Ни одного числа сверх того, что уже посчитано для экрана: справку и следующий шаг даёт
     `WS.ui`, а не отдельный расчёт здесь, — иначе ответ и карточка разошлись бы на первой же
     правке одной из сторон, и брокер получил бы два разных положения дел по одной сделке. */
  function screenAnswer(text) {
    const rec = screenScoped(text);
    if (!rec) return null;
    const t = lc(text || '');
    const ui = WS.ui || {};
    const say = (s) => ({ kind: 'answer', text: s, evidence: [], next: suggestions() });
    const money = (v) => (WS.AED ? WS.AED(v) : String(v));
    const named = 'сделке «' + rec.название + '»';

    if (rec.тип === 'сделка') {
      const brief = (ui.dealBrief ? ui.dealBrief(rec.id) : []) || [];
      /* Отсутствие строки «Мешает:» — это отсутствие СРАБОТАВШЕЙ проверки, и ничего больше.
         Прежний ответ выводил из него три положительных факта — «касание не просрочено, задаток
         внесён, расхождений по полям нет», — и на сделке, где задатка нет в записи вовсе,
         утверждал, что он внесён. Теперь называется, что именно проверяется, и что не сработало
         ничего: это правда о проверке, а не сочинённая правда о сделке. И у закрытой сделки
         помехи не отслеживаются вообще — там отсутствие строки не значит даже этого. */
      if (ASK_BLOCK.test(t)) {
        const stop = brief.filter((x) => /^Мешает:/.test(x))[0];
        if (stop) return say('По ' + named + ' ' + stop.charAt(0).toLowerCase() + stop.slice(1));
        /* Исход читается из записи, а не угадывается по словам справки. Прежняя проверка искала
           «закрыт» в тексте — а это слово туда пишется только для выигранной сделки, и
           проигранная отвечала «проверяются пять причин, не сработала ни одна», хотя для
           закрытой сделки не выполняется ни одна из пяти: весь блок помех для неё пропускается. */
        const deal = (WS.store.data.deals || []).find((x) => x.id === rec.id);
        if (deal && ui.dealClosed && ui.dealClosed(deal)) {
          return say('Сделка «' + rec.название + '» ' +
            (ui.dealWon && ui.dealWon(deal) ? 'закрыта успешно' : 'проиграна и закрыта') +
            ' — помехи по ней не отслеживаются.');
        }
        return say('По ' + named + ' помех не отмечено. Проверяются пять причин — просроченное ' +
          'просроченный контакт, невнесённый задаток, расхождение по полям, незакрытый шаг договора и ' +
          'просроченные задачи, — не сработала ни одна. Ближайшее дело — ' + nextPhrase(ui, rec) + '.');
      }
      if (ASK_NEXT.test(t)) {
        const nx = ui.dealNext ? ui.dealNext(rec.id) : null;
        if (nx && nx.action) {
          return say('Дальше по ' + named + ': ' + nx.action +
            (nx.due ? ', срок — ' + nx.due : '') + (nx.owner ? ', ведёт ' + nx.owner : '') + '.' +
            (nx.why ? ' Почему сейчас: ' + nx.why + '.' : ''));
        }
      }
      if (ASK_FIELD.test(t) && !ASK_BRIEF.test(t)) {
        if (/бюджет|сумм|стоимост/.test(t) && rec.сумма) return say('Сумма по ' + named + ' — ' + money(rec.сумма) + '.');
        if (/клиент|заказчик/.test(t) && rec.клиент) return say('Клиент по ' + named + ' — ' + rec.клиент + '.');
        if (/шаг|стади/.test(t) && rec.шаг) return say('Сделка «' + rec.название + '» на шаге «' + rec.шаг + '».');
        if (/срок|дедлайн|касани/.test(t) && rec.срок_следующего_шага) {
          return say('Следующий контакт по ' + named + ' — ' + rec.срок_следующего_шага + '.');
        }
      }
      if (brief.length) return say('Сделка «' + rec.название + '». ' + brief.join(' '));
    }

    if (rec.тип === 'запрос') {
      const now = ui.reqNow ? ui.reqNow(rec.id) : null;
      if (now) {
        const head = 'Запрос «' + rec.название + '»' + (rec.клиент ? ', клиент — ' + rec.клиент : '') + '.';
        if (ASK_NEXT.test(t)) return say('Дальше по запросу «' + rec.название + '»: ' + now.дальше + '.');
        if (ASK_FIELD.test(t) && !ASK_BRIEF.test(t)) {
          if (/бюджет|сумм|стоимост/.test(t) && rec.бюджет) return say('Бюджет по запросу «' + rec.название + '» — ' + money(rec.бюджет) + '.');
          if (/клиент|заказчик/.test(t) && rec.клиент) return say('Клиент по запросу «' + rec.название + '» — ' + rec.клиент + '.');
          if (/стади|шаг/.test(t) && rec.стадия) return say('Запрос «' + rec.название + '» на стадии «' + rec.стадия + '».');
          if (/срок|дедлайн|касани/.test(t) && rec.срок) return say('Срок по запросу «' + rec.название + '» — ' + rec.срок + '.');
        }
        return say(head + ' Сейчас: ' + now.сейчас +
          (rec.бюджет ? ' Бюджет — ' + money(rec.бюджет) + '.' : '') +
          (rec.срок ? ' Срок — ' + rec.срок + '.' : '') + ' Дальше: ' + now.дальше + '.');
      }
    }

    // Остальные виды записей: то, что о записи известно, без просьбы переспросить.
    const bits = ['Открыт' + (rec.тип === 'компания' ? 'а ' : ' ') + rec.тип + ' «' + rec.название + '»'];
    if (rec.клиент) bits.push('клиент — ' + rec.клиент);
    if (rec.шаг) bits.push('шаг «' + rec.шаг + '»');
    if (rec.стадия) bits.push('стадия «' + rec.стадия + '»');
    if (rec.сумма) bits.push('сумма ' + money(rec.сумма));
    if (rec.бюджет) bits.push('бюджет ' + money(rec.бюджет));
    if (rec.срок_следующего_шага) bits.push('следующий контакт ' + rec.срок_следующего_шага);
    if (rec.срок) bits.push('срок ' + rec.срок);
    if ((rec.объекты || []).length) bits.push('объект: ' + rec.объекты.join(', '));
    return say(bits.join(', ') + '.');
  }
  function nextPhrase(ui, rec) {
    const nx = ui.dealNext ? ui.dealNext(rec.id) : null;
    if (!nx || !nx.action) return 'работа по сделке идёт по плану';
    return nx.action.charAt(0).toLowerCase() + nx.action.slice(1) + (nx.due ? ' (' + nx.due + ')' : '');
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
    /* «Какие» не было в списке — при том что стенд САМ предлагает «какие задачи просрочены и
       по кому», «какие запросы горячие», «какие объекты у нас есть». Подсказка, на которую
       отвечают «такого у нас в данных нет», и следом перечисляют ровно то, о чём спросили, —
       это замкнутый круг: система советует спросить то, чего не понимает. */
    ask: /сколько|скольк|какая|какой|каких|какие|какими|каков|сумма|итог|статус|состояни|что\s+(по|с|у|просроч|горит|дальше|мешает)|покажи|дай/,
  };

  const METRIC_HINTS = [
    [/просроч/, ['tasks_overdue', 'tasks_open']],
    [/задач/, ['tasks_open', 'tasks_overdue']],
    /* Порядок здесь значим так же, как в стадиях: длиннее намерение — раньше строка. «Горячий»
       само по себе читалось как горячая сделка, и на «какие запросы горячие и что по ним дальше»
       — подсказку самого стенда — приходил ответ про сделки. Это не менее точный ответ, это
       ответ на другой вопрос. Названная коллекция уточняет признак, а не наоборот. */
    [/горяч[а-яё]*\s+(запрос|заяв|лид)|(запрос|заяв|лид)[а-яё]*\s+горяч/, ['requests_hot', 'requests_total']],
    [/горяч/, ['deals_hot', 'deals_active']],
    [/закрыт/, ['deals_closed', 'deals_active']],
    [/соглас/, ['clients_no_consent', 'clients_total']],
    [/контакт|клиент/, ['clients_total', 'clients_no_consent']],
    [/объект/, ['objects_total']],
    [/компан/, ['companies_total']],
    [/заяв|лид/, ['requests_total', 'requests_hot']],
    [/сделк|сдело|работе|активн|пайплайн|сумм/, ['deals_active', 'deals_active_sum']],
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
    { need: 'requests_hot', label: 'Горячие запросы', ask: 'какие запросы горячие и что по ним дальше' },
    { need: 'deals_hot', label: 'Горячие сделки', ask: 'какие сделки горячие и что мешает их закрыть' },
    { need: 'clients_no_consent', label: 'Контакты без согласия', ask: 'кто из контактов без согласия на переписку' },
    { need: 'requests_total', label: 'Что в запросах', ask: 'что сейчас в запросах и на какой они стадии' },
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
    /* Когда открыта карточка, «не понял» не должно превращаться в инвентарь рабочего места:
       брокер стоит на конкретной сделке, и общий список коллекций к его вопросу отношения не
       имеет. Уточняем — про ЭТУ запись, называя её по имени. */
    const scrRec = (!GLOBAL.test(t) && WS.ui && WS.ui.screenContext)
      ? (WS.ui.screenContext().запись || null) : null;
    const lines = askedArea
      ? ['Этого района в нашем срезе рынка нет. Есть: ' + areas.join(', ') + '.',
         'Могу разобрать любой — цену за метр, доходность, срок экспозиции.']
      : scrRec
        ? ['Не понял вопрос. Вы стоите на записи «' + scrRec.название + '» — уточните, что по ней нужно:',
           'что по этой сделке, что мешает закрыть эту сделку, что дальше по сделке, бриф к звонку.']
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
    if (pend && (pend.need || []).length === 1 && looksLikeAValue(text, pend.need[0])) {
      const ops = fillPending(pend, String(text).trim());
      const p = ops && propose(ops, { title: 'Новая запись' });
      if (p && p.kind === 'proposal') {
        if (WS.engine.clearPendingAction) WS.engine.clearPendingAction();
        note('act_resumed');
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
      const sc = threadScope();
      if (ent && ent.kind === 'contact') task.clientId = ent.id;
      else if (sc && sc.clientId) task.clientId = sc.clientId;
      // Область ставится только когда клиент задачи и клиент треда совпадают: если в сделке
      // Виктора попросили задачу «по Анне», названный человек главнее треда, а чужая сделка
      // к нему не прицепляется — слой записи такую пару всё равно отклонит.
      if (sc && task.clientId === sc.clientId) {
        if (sc.dealId) task.dealId = sc.dealId;
        if (sc.requestId) task.requestId = sc.requestId;
      }
      return propose([{ op: 'addTask', task: task }],
        { subject: ent ? ent.id : null, title: 'Новая задача', lines: ['Задача: «' + title + '», срок — ' + w[0]] });
    }

    // stage change
    if (RE.stage.test(t)) {
      const st = (STAGES.find((x) => x[0].test(t)) || [])[1];
      const deal = ent && ent.kind === 'contact' ? (dealOf(ent.id) || dealByText(ent.id, t)) : null;
      if (!st && PRESALE_WORDS.test(t)) {
        return { kind: 'answer', text: 'Это стадия запроса, а не сделки, и она не выставляется вручную: запрос сам встаёт на подбор, показ или переговоры, когда появляется факт. Отметьте в запросе предложенный объект или добавьте событие — стадия сдвинется сама.', evidence: [], next: suggestions() };
      }
      if (!deal || !st) {
        const pick = ent && ent.kind === 'contact' ? dealChoiceText(ent.id) : '';
        return { kind: 'answer', text: 'Понял про шаг сделки, но не хватает деталей: по какой сделке и на какой шаг. Шаги: подготовка, бронирование, подписание, регистрация, закрыта.' + pick, evidence: [], next: suggestions() };
      }
      return propose([{ op: 'dealStage', id: deal.id, stage: st }],
        { subject: deal.id, title: 'Смена стадии', lines: ['Сделка ' + (deal.title || deal.id) + ': ' + deal.stage + ' → ' + st] });
    }

    /* Вопрос об открытой записи разбирается ДО общей аналитики — и до неё же уходит любой
        вопрос, заданный из-под карточки. Иначе «сделай саммари сделки» матчится словом «сделк»
        и возвращается счётчиком всех сделок рабочего места. */
    {
      const scr = screenAnswer(text);
      if (scr) return scr;
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
      /* Счётчик — ответ на вопрос «сколько». Когда открыта карточка, ответить счётчиком на
         вопрос о свойстве («какой этаж у объекта» → «12 объектов») значит выдать левую
         информацию вместо ответа; лучше уточнить. Вне карточки поведение прежнее. */
      const QUANTITY = /сколько|скольк|количеств|сумм|итог|всего|объ[её]м|покажи|дай|список|выведи|статус|состояни|каки(е|х|ми)|что\s|чего\s/i;
      const onCard = !!((WS.ui && WS.ui.screenContext) ? WS.ui.screenContext().запись : null);
      const hit = (onCard && !QUANTITY.test(t)) ? null : METRIC_HINTS.find((h) => h[0].test(t));
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
  /* How long an answer may be depends on what was asked for. A name is two
     words. «Суть запроса одной строкой» is a line by definition — the prompt
     asks for exactly that — and a cap tuned for names threw «2BR в Business Bay
     до 1,8 млн» away as too long: the answer in full, to the question just
     asked. The broker got the inventory of the workspace instead, measured on a
     live run, because the turn had fallen back to the planner.

     A question is never a value, whatever the field. That half does not move. */
  const VALUE_WORDS = { title: 12, note: 12, goal: 12 };
  function looksLikeAValue(text, field) {
    const s = String(text == null ? '' : text).trim();
    const words = VALUE_WORDS[field] || 5;
    if (!s || s.length > (words > 5 ? 120 : 60) || s.split(/\s+/).length > words) return false;
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
      // Falling through to the planner IS the degradation this whole file is
      // built to make invisible to a visitor — and therefore the one most worth
      // counting, because nothing else about the answer will say it happened.
      note('fallback');
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
