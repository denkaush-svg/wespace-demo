/* ============================================================
   Event layer (rev.3): the platform acting WITHOUT the agent.
   Turns existing material (night lead / call / KP reply / availability)
   into time-separated EVENTS: toast + state change + proactive Concierge
   message + "что изменилось" + honest boundary markers + feedback capture.
   Scripted / Wizard-of-Oz — no backend, no telephony. Everything is marked.
   ============================================================ */
(function (WS) {
  const I = WS.icon;
  const S = () => WS.store;
  const D = () => WS.store.data;

  // ---- honest boundary markers (spec rev.3 §6): where the system is in autonomy
  const MARK = {
    detected:  ['warn', 'radar', 'обнаружил'],
    prepared:  ['info', 'doc', 'подготовил (черновик)'],
    awaiting:  ['acc', 'clock', 'ждёт подтверждения'],
    simulated: ['ok', 'check', 'внешнее действие имитировано'],
  };
  function markBadge(kind) {
    const m = MARK[kind]; if (!m) return '';
    return '<span class="mark ' + m[0] + '">' + I(m[1]) + m[2] + '</span>';
  }
  const SIM = '<span class="mark demo">' + WS.icon('sparkle') + ' симуляция события · телефония/отправка не подключены</span>';

  // ---- the day-story events (played by the presenter or as a guided story) ----
  const EVENTS = [
    {
      id: 'ev_night', icon: 'moon', at: '02:14', kind: 'signal',
      title: 'Ночное сообщение — Sarah Mansour',
      sub: 'WhatsApp пришёл в 02:14, пока агент спал',
      thread: 'lead:sarah', tlabel: 'Sarah Mansour · ночной лид', ticon: 'moon',
      say: 'Ночью содержательный ответ не отправляю (правило). Подготовил <b>черновик заявки</b> и <b>A1-ответ</b> «подтверждение получения», поставил лид в очередь «Ожидает агента», запустил SLA. Утром — подтвердить одной кнопкой.',
      mark: 'prepared',
      effects: [{ op: 'addTask', task: { id: 't_ev_night', clientId: 'c_night', title: 'Утром ответить Sarah Mansour', due: 'сегодня', when: 'today', kind: 'touch', scenario: 'G1', why: 'Ночной лид 02:14, черновик A1 готов, ждёт подтверждения' } }],
      changed: ['Черновик заявки и A1-ответа создан', 'Очередь «Ожидает агента»: +1', 'SLA-таймер: ответить до 10:00', 'Руководитель видит непокрытый лид'],
      open: { nav: 'concierge' },
      fb: 'Ночью система подготовила ответ, но не отправила. Как правильно?',
    },
    {
      id: 'ev_kp', icon: 'doc', at: '09:40', kind: 'signal',
      title: 'Вопрос по первому платежу — Анна Петрова',
      sub: 'Анна ответила по сделке: объект подтверждён, платёж — нет',
      thread: 'deal:d_anna', tlabel: 'Анна Петрова · сделка', ticon: 'users',
      say: 'Анна ответила по сделке: <b>Creekline 1208 подтверждён</b>, но <b>смущает первый платёж</b> — просит точный график рассрочки. Определил сделку и объект, подготовил запрос застройщику. Есть неоднозначность в сроке — <b>подсветил, не решаю сам</b>.',
      mark: 'prepared',
      effects: [{ op: 'updateDeal', id: 'd_anna', patch: { tags: ['возражение: первый платёж'], sub: 'Creekline 1208 · ждём график рассрочки 60/40' } }],
      changed: ['Реакция клиента распознана', 'Сделка: подготовлено обновление', 'Готов запрос застройщику по графику (черновик)', 'Неоднозначность срока — помечена для агента'],
      open: { scn: 'G3' },
      fb: 'Система сама поняла реакцию клиента и перестроила сделку. Как разрешите действовать?',
    },
    {
      id: 'ev_avail', icon: 'radar', at: '10:05', kind: 'signal',
      title: 'Вернулась проверка доступности — Bayline',
      sub: 'Асинхронный ответ по объекту с истёкшей проверкой',
      thread: 'object:o_bayline', tlabel: 'Bayline Terraces · доступность', ticon: 'building',
      say: 'Проверка доступности Bayline вернулась: <b>застройщик не ответил</b>. «Нет ответа» <b>не помечаю доступным</b> — увёл в ручную очередь, повтор в тот же день заблокирован. Источник и время — видны.',
      mark: 'simulated',
      effects: [{ op: 'setObject', id: 'o_bayline', patch: { availability: 'stale', queued: true } }],
      changed: ['Статус Bayline: нет ответа → ручная очередь', 'Источник и время зафиксированы', 'Повтор в тот же день заблокирован', 'Из КП объект исключён до подтверждения'],
      open: { nav: 'objects' },
      fb: 'Система отработала асинхронно без агента. Насколько это полезно?',
    },
  ];

  // Special event: incoming call handled by the AI secretary (its own mini-flow).
  const CALL = {
    id: 'ev_call', icon: 'phone', at: '09:12', kind: 'call',
    title: 'Входящий звонок — неизвестный номер',
    sub: 'AI-секретарь может принять и квалифицировать',
  };

  // Deliberate controlled failure (spec rev.3 §5): ambiguous client — system writes nothing.
  const FAIL = {
    id: 'ev_fail', icon: 'warn', at: '11:20', kind: 'fail',
    title: 'Неоднозначная привязка — Елена Крылова',
    sub: 'У клиента две активные сделки — система не решает сама',
    thread: 'general', tlabel: 'Елена Крылова · уточнение', ticon: 'users',
    say: 'Пришла заметка по Елене Крыловой, а у неё <b>две активные сделки</b>. Однозначно привязать не могу — <b>ничего не записываю</b> и спрашиваю вас. Выберите, что сделать.',
    mark: 'awaiting',
  };

  const STORY = ['ev_night', 'ev_call', 'ev_kp', 'ev_avail', 'ev_fail'];

  function evById(id) {
    if (id === 'ev_call') return CALL;
    if (id === 'ev_fail') return FAIL;
    return EVENTS.find((e) => e.id === id);
  }
  function played(id) { return (S().eventsPlayed || []).indexOf(id) >= 0; }
  function markPlayed(id) { const a = S().eventsPlayed || (S().eventsPlayed = []); if (a.indexOf(id) < 0) a.push(id); }

  // ---- play a signal event: state change + proactive Concierge message + "что изменилось"
  function play(id) {
    const e = evById(id); if (!e) return;
    if (e.kind === 'call') return openIncomingCall();
    if (e.kind === 'fail') return openFailure();

    WS.storeApi.applyEffects(e.effects || []);
    (e.changed || []).forEach(() => {});
    WS.storeApi.logEvent({ action: 'Событие: ' + e.title, scenario: null });
    // proactive message lands in the entity thread (unread — agent didn't ask)
    const body = markBadge(e.mark) + '<div style="margin-top:8px">' + e.say + '</div>' + '<div style="margin-top:8px">' + SIM + '</div>';
    WS.engine.pushEvent(e.thread, e.tlabel, e.ticon, WS.engine.aiMsg(I('sparkle') + ' Консьерж · проактивно', body));
    markPlayed(id);
    WS.storeApi.toast('Событие: ' + e.title, 'ok');
    showChanged(e);
  }

  // ---- "что изменилось" card + inline feedback capture
  function showChanged(e) {
    const rows = (e.changed || []).map((c) => '<div class="chg-row">' + I('check') + '<span>' + c + '</span></div>').join('');
    const openBtn = e.open
      ? (e.open.scn
        ? '<button class="btn primary" data-scn="' + e.open.scn + '">' + I('arrowRight') + 'Открыть, что изменилось</button>'
        : '<button class="btn primary" data-nav="' + e.open.nav + '">' + I('arrowRight') + 'Открыть, что изменилось</button>')
      : '';
    const fb = e.fb ? fbBlock(e.id, e.fb) : '';
    WS.ui.openModal('Система сработала без агента · ' + e.at,
      markBadge(e.mark) + '<div class="chg-list" style="margin-top:12px">' + rows + '</div>' + fb,
      '<button class="btn" data-act="closeModal">Закрыть</button>' + openBtn);
  }

  // ---- inline feedback: "как разрешите системе действовать?"
  const FB_LABEL = { auto: 'автоматически', confirm: 'после подтверждения', show: 'только показать', never: 'никогда' };
  function fbBlock(evId, q) {
    const opts = [['auto', 'Автоматически'], ['confirm', 'После подтверждения'], ['show', 'Только показать'], ['never', 'Никогда']];
    return '<div class="fb-box" id="fb_' + evId + '"><div class="fb-q">' + I('target') + q + '</div><div class="fb-opts">' +
      opts.map((o) => '<button class="chip" data-fb="' + evId + '" data-fbval="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Фиксируем для обратной связи — где граница доверия системе.</div></div>';
  }
  // Record the answer WITHOUT closing the card — so «Сыграть день подряд» never breaks
  // on an honest answer, and «Открыть, что изменилось» stays reachable (audit §4.3 / P0-2).
  function recordFb(evId, val) {
    const f = S().feedback || (S().feedback = []);
    f.push({ ev: evId, allow: val });
    WS.storeApi.toast('Записали: ' + (FB_LABEL[val] || val), 'ok');
    const box = document.getElementById('fb_' + evId);
    if (box) box.innerHTML = '<div class="fb-q">' + I('check') + 'Зафиксировано: <b>' + (FB_LABEL[val] || val) + '</b></div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Ответ сохранён для обратной связи. Можно продолжать.</div>';
  }

  // ---- incoming call handled by AI secretary (scripted, honest)
  function openIncomingCall() {
    WS.ui.openModal('Входящий звонок · +971 5• ••• ••34',
      '<div class="call-face"><div class="call-ic">' + I('phone') + '</div><div><div style="font-weight:700">Неизвестный номер</div><div style="font-size:12px;color:var(--mut)">Дубай · не в контактах</div></div></div>' +
      '<p style="margin-top:12px;font-size:13px;color:var(--mut)">Принять самому или передать AI-секретарю — он поздоровается, квалифицирует (цель, бюджет, срок), заполнит поля по ходу разговора и вернёт вам итог.</p>' +
      '<div style="margin-top:10px">' + SIM + '</div>',
      '<button class="btn" data-act="closeModal">Отклонить</button><button class="btn" data-act="callSelf">' + I('phone') + 'Ответить самому</button><button class="btn primary" data-act="callAi">' + I('sparkle') + 'Передать секретарю</button>');
  }
  function callSelf() {
    WS.ui.closeModal();
    WS.storeApi.toast('Звонок принят агентом (демо) — заметку можно продиктовать Консьержу', '');
  }
  // staged transcript that builds qualification fields live
  function callAi() {
    const stages = [
      { who: 'Секретарь', text: 'Здравствуйте! Агентство Harbour Key. Чем могу помочь?' },
      { who: 'Клиент', text: 'Ищу двушку в Dubai Marina под сдачу, бюджет до 2,2 млн, заехать к осени.' },
      { field: 'Цель', v: 'Инвестиция под аренду (2BR)' },
      { field: 'Бюджет', v: 'до 2 200 000 AED' },
      { field: 'Район', v: 'Dubai Marina' },
      { field: 'Срок', v: 'к осени 2026' },
      { who: 'Клиент', text: 'А какой налог на прибыль будет?' },
      { branch: 'Клиент просит юридический/налоговый совет — секретарь не отвечает по существу, помечает вопрос для брокера.' },
      { who: 'Секретарь', text: 'Хороший вопрос — по налогам вас проконсультирует агент, я передам заявку. Спасибо!' },
    ];
    let html = '<div id="callLog" class="call-log"></div><div id="callFields" class="call-fields"></div>';
    WS.ui.openModal('AI-секретарь на линии', markBadge('prepared') + '<div style="margin-top:6px">' + SIM + '</div>' + html,
      '<button class="btn" data-act="closeModal" id="callWait" disabled>Идёт разговор…</button>');
    let i = 0;
    const step = () => {
      const log = document.getElementById('callLog'); const flds = document.getElementById('callFields');
      if (!log) return; // modal closed
      const s = stages[i];
      if (!s) { finishCall(); return; }
      if (s.who) log.insertAdjacentHTML('beforeend', '<div class="cl-row ' + (s.who === 'Клиент' ? 'them' : 'us') + '"><b>' + s.who + ':</b> ' + s.text + '</div>');
      else if (s.field) flds.insertAdjacentHTML('beforeend', '<div class="field"><div class="k">' + s.field + '</div><div class="v">' + s.v + '</div></div>');
      else if (s.branch) log.insertAdjacentHTML('beforeend', '<div class="cl-branch">' + I('warn') + s.branch + '</div>');
      log.scrollTop = log.scrollHeight;
      i++;
      setTimeout(step, s.field ? 380 : 720);
    };
    setTimeout(step, 300);
  }
  function finishCall() {
    WS.storeApi.applyEffects([{ op: 'addTask', task: { id: 't_ev_call', clientId: 'c_lead15', title: 'Перезвонить лиду (2BR Marina, налоговый вопрос)', due: 'сегодня', when: 'today', kind: 'call', scenario: null, why: 'Входящий звонок квалифицирован секретарём; клиент ждёт консультацию по налогам' } }]);
    markPlayed('ev_call');
    WS.storeApi.logEvent({ action: 'Событие: входящий звонок квалифицирован секретарём', scenario: null });
    const e = { at: CALL.at, mark: 'prepared',
      changed: ['Звонок принят и квалифицирован секретарём', 'Заявка-черновик: 2BR Marina, до 2,2 млн, осень', 'Юр/налоговый вопрос помечен для брокера', 'Задача: перезвонить сегодня'],
      open: { nav: 'concierge' }, fb: 'Секретарь сам принял и квалифицировал звонок. Где граница доверия?', id: 'ev_call' };
    showChanged(e);
  }

  // ---- deliberate failure: ambiguous client → system writes nothing, asks agent
  function openFailure() {
    markPlayed('ev_fail');
    WS.ui.openModal('Нужен ваш выбор · система ничего не записала',
      markBadge('awaiting') + '<div style="margin-top:8px">' + FAIL.say + '</div>' +
      '<div class="section-label" style="margin-top:14px">Две активные сделки Елены</div>' +
      '<div class="feed" style="margin-bottom:6px">' +
      '<div class="feed-row"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">JVC · инвестиция</div><div class="m">до 2,1 млн · стадия «в работе»</div></div></div>' +
      '<div class="feed-row"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">Business Bay · перепродажа</div><div class="m">до 2,1 млн · стадия «подбор»</div></div></div>' +
      '</div><div style="font-size:12px;color:var(--faint)">Заметка не будет применена ни к одной, пока вы не выберете. Можно вернуть человеку.</div>' +
      fbBlock('ev_fail', 'Система намеренно не решила за вас. Так правильно?'),
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn" data-act="failHuman">' + I('users') + 'Передать человеку</button>' +
      '<button class="btn" data-act="failPick" data-deal="jvc">Привязать к JVC</button>' +
      '<button class="btn primary" data-act="failPick" data-deal="bb">Привязать к Business Bay</button>');
  }
  function failResolve(which) {
    WS.ui.closeModal();
    if (which === 'human') { WS.storeApi.toast('Возвращено человеку — заметка не применена', ''); return; }
    WS.storeApi.toast('Заметка привязана вручную (' + (which === 'jvc' ? 'JVC' : 'Business Bay') + ') — только после вашего выбора', 'ok');
  }

  // ---- presenter (скрытый пульт ведущего): fire events / play the day / session setup / results
  function openPresenter() {
    const st = S();
    // Role is switched from the top bar (Агент ↔ Руководитель) — no duplicate toggle here (P1).
    const roleLine = '<div class="prov" style="margin-bottom:10px"><span class="badge acc">' + I('users') + 'Роль сессии: ' + (st.role === 'manager' ? 'Руководитель' : 'Агент') + '</span>' +
      '<span class="badge">' + I('clock') + 'сменить роль — переключатель в шапке</span></div>';
    const rows = STORY.map((id) => {
      const e = evById(id); const done = played(id);
      return '<div class="ev-row' + (done ? ' done' : '') + '"><div class="ev-ic">' + I(e.icon) + '</div>' +
        '<div class="ev-t"><div class="t">' + e.title + (done ? ' <span class="mark ok">' + I('check') + 'сыграно</span>' : '') + '</div><div class="m">' + e.at + ' · ' + e.sub + '</div></div>' +
        '<button class="btn sm primary" data-evplay="' + id + '">' + I('play') + (done ? 'Ещё раз' : 'Проиграть') + '</button></div>';
    }).join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Режиссёрский пульт — показывает, что платформа делает <b>сама, без агента</b>. Играйте события по одному или весь день подряд. Это ядро «образа результата».</p>' +
      roleLine +
      '<div class="section-label">Сюжет дня — 5 событий</div>' + rows +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="playDay">' + I('play') + 'Сыграть день подряд</button>' +
      '<button class="btn" data-act="sessionResults">' + I('target') + 'Итоги сессии (фидбэк)</button></div>';
    WS.ui.openModal('Режиссёр · события дня', body, '<button class="btn" data-act="closeModal">Закрыть</button>');
  }

  // play the day as a guided sequence (one event, close, next on user action)
  function playDay() {
    S().dayStep = 0;
    WS.ui.closeModal();
    nextDay();
  }
  function nextDay() {
    const st = S(); const i = st.dayStep || 0;
    if (i >= STORY.length) { sessionResults(); return; }
    st.dayStep = i + 1;
    play(STORY[i]);
    // «что изменилось» modal footer gets a "Дальше по дню" button appended
    setTimeout(() => {
      const mf = document.querySelector('.modal-wrap.show .mf');
      if (mf) mf.insertAdjacentHTML('beforeend', '<button class="btn primary" data-act="nextDay">' + I('arrowRight') + 'Дальше по дню (' + st.dayStep + '/' + STORY.length + ')</button>');
    }, 40);
  }

  // ---- end-of-session structured feedback (5 bets)
  function sessionResults() {
    const f = S().feedback || [];
    const summary = f.length
      ? '<div class="section-label">Ответы по ходу сессии</div>' + f.map((x) => '<div class="chg-row">' + I('check') + '<span>' + x.ev + ' → ' + ({ auto: 'авто', confirm: 'после подтверждения', show: 'только показать', never: 'никогда' }[x.allow] || x.allow) + '</span></div>').join('')
      : '';
    const body =
      '<p style="font-size:13px;color:var(--mut);margin-top:0">Финальный сбор — то, ради чего сессия. Задайте брокеру и зафиксируйте (в демо — на словах/на бумаге):</p>' +
      '<div class="section-label">Распределите 100 баллов между автоматизациями</div>' +
      '<div class="fb-q2">' + ['Ночной перехват лида', 'Приём звонка секретарём', 'Понимание ответа на КП', 'Асинхронная проверка', 'Приоритеты/SLA'].map((t) => '<div class="fb-line"><span>' + t + '</span><span class="fb-pts">___</span></div>').join('') + '</div>' +
      '<div class="section-label" style="margin-top:12px">Четыре вопроса</div>' +
      '<div class="fb-q2">' +
      '<div class="fb-line"><span>2 автоматизации «включил бы завтра»</span><span class="fb-pts">___</span></div>' +
      '<div class="fb-line"><span>1 «не доверю системе»</span><span class="fb-pts">___</span></div>' +
      '<div class="fb-line"><span>1 обязательная интеграция/доступ</span><span class="fb-pts">___</span></div>' +
      '<div class="fb-line"><span>1 результат «за который готов платить»</span><span class="fb-pts">___</span></div>' +
      '</div>' +
      '<div class="section-label" style="margin-top:12px">Пять ставок продукта (галочка = проверено на сессии)</div>' +
      '<div class="prov">' + ['Граница делегирования', 'Готовность дать доступ', 'Покупатель: брокер/руководитель', 'Зарабатывает или экономит', 'Выживает на плохих данных'].map((t) => '<span class="badge">' + I('target') + t + '</span>').join('') + '</div>' +
      summary;
    WS.ui.openModal('Итоги сессии · структурированный фидбэк', body, '<button class="btn primary" data-act="closeModal">Готово</button>');
  }

  // ---- demo import: click → staged recognition → records added → open list with «новое»
  // Wizard-of-Oz: no real file dialog. A prepared file is "parsed" step-by-step, then the
  // recognized records are actually added to data (addObject/addClient) and marked _new,
  // so the broker sees them appear in the list. Reset removes them (not in fixtures).
  const IMPORT = {
    objects: {
      title: 'Импорт объектов · распознавание', file: 'developers_feed.csv · 12 строк',
      stages: ['Читаю файл фида застройщика', 'Распознаю поля: цена, район, площадь, спальни', 'Сверяю с текущим инвентарём (дедупликация)', 'Проверяю статусы Trakheesi / Madmoun', 'Собираю карточки объектов'],
      nav: 'objects', goLabel: 'Открыть объекты',
      done: 'Импортировано 3 объекта · 2 дубля отложены на разбор',
      records: [
        { id: 'o_imp1', name: 'Marina Vista 2210', area: 'Business Bay', br: '2BR', size: 96, price: 2450000, source: 'import', sourceLabel: 'Импорт застройщика', verified: 'expired', checkedAt: 'из фида', trakheesi: 'pending', madmoun: 'na', availability: 'stale', photoKey: 'o_marina', attrs: { view: 'city', floor: 'high', finish: 'new', demand: 'high', prestige: 'high', metro: true }, match: 'Совпадает с 2 активными заявками (инвестиция, Business Bay)' },
        { id: 'o_imp2', name: 'Creek Rise 1804', area: 'Dubai Creek Harbour', br: '1BR', size: 68, price: 1690000, source: 'import', sourceLabel: 'Импорт застройщика', verified: 'expired', checkedAt: 'из фида', trakheesi: 'pending', madmoun: 'na', availability: 'stale', photoKey: 'o_interior', attrs: { view: 'water', floor: 'mid', finish: 'new', demand: 'mid', prestige: 'high', metro: false }, match: 'Близко к цели по доходности (~5%)' },
        { id: 'o_imp3', name: 'JVC Garden 312', area: 'JVC', br: 'Studio', size: 42, price: 780000, source: 'import', sourceLabel: 'Импорт застройщика', verified: 'expired', checkedAt: 'из фида', trakheesi: 'pending', madmoun: 'na', availability: 'stale', photoKey: 'o_palmcourt', attrs: { view: 'garden', floor: 'low', finish: 'standard', demand: 'mid', prestige: 'mid', metro: false }, match: 'Бюджетный вход под аренду' },
      ],
    },
    contacts: {
      title: 'Импорт контактов · распознавание', file: 'leads_export.csv · 8 контактов', tab: 'contacts',
      stages: ['Читаю выгрузку контактов', 'Распознаю имена, телефоны, цель, бюджет', 'Проверяю согласие (PDPL) и реестр отказов (DNCR)', 'Объединяю дубли с текущими карточками', 'Ставлю правовое основание для связи'],
      nav: 'clients', goLabel: 'Открыть контакты',
      done: '8 контактов: 5 с согласием готовы к связи, 2 без — вне отправок, 1 дубль объединён',
      records: [
        { id: 'c_imp1', name: 'Оливия Стоун', goal: 'Инвестиция под аренду', budget: 1800000, consent: true, channel: 'whatsapp', lang: 'EN', areas: ['Dubai Marina'], horizon: '1–3 мес', phone: '+971 5• ••• ••21', note: 'Импортирован из выгрузки портала · согласие подтверждено' },
        { id: 'c_imp2', name: 'Рашид аль-Фаиси', goal: 'Перепродажа off-plan', budget: 3200000, consent: true, channel: 'whatsapp', lang: 'AR', areas: ['Downtown'], horizon: '3–6 мес', phone: '+971 5• ••• ••88', note: 'Импортирован · согласие подтверждено' },
        { id: 'c_imp3', name: 'Марта Ковач', goal: 'Первичное жильё', budget: 1200000, consent: false, channel: 'email', lang: 'EN', areas: ['JVC'], horizon: 'не решено', phone: '+971 5• ••• ••04', note: 'Импортирован БЕЗ согласия — AI-секретарь не набирает и не пишет' },
      ],
    },
  };
  function importRun(kind) {
    const cfg = IMPORT[kind]; if (!cfg) return;
    WS.ui.openModal(cfg.title,
      markBadge('detected') + '<div style="margin-top:6px">' + SIM + '</div>' +
      '<div class="prov" style="margin:8px 0"><span class="badge">' + I('download') + cfg.file + '</span></div>' +
      '<div id="impLog" class="call-log"></div>',
      '<button class="btn" data-act="closeModal" id="impWait" disabled>Распознаю…</button>');
    let i = 0;
    const step = () => {
      const log = document.getElementById('impLog'); if (!log) return; // modal closed
      if (i >= cfg.stages.length) { finishImport(kind); return; }
      log.insertAdjacentHTML('beforeend', '<div class="cl-row us">' + I('check') + ' ' + cfg.stages[i] + '</div>');
      log.scrollTop = log.scrollHeight; i++;
      setTimeout(step, 640);
    };
    setTimeout(step, 320);
  }
  function finishImport(kind) {
    const cfg = IMPORT[kind];
    const op = kind === 'objects' ? 'addObject' : 'addClient';
    WS.storeApi.applyEffects(cfg.records.map((r) => ({ op: op, obj: Object.assign({ _new: true }, r) })));
    // objects: reuse an existing offline photo so imported cards show a real photo (not a synthetic render)
    if (kind === 'objects' && WS.photos) cfg.records.forEach((r) => { if (r.photoKey && WS.photos[r.photoKey]) WS.photos[r.id] = WS.photos[r.photoKey]; });
    WS.storeApi.logEvent({ action: cfg.done, scenario: null });
    const rows = cfg.records.map((r) => '<div class="chg-row">' + I('check') + '<span>' + r.name + ' · ' + (r.area || r.goal || '') + '</span></div>').join('');
    const hint = kind === 'contacts'
      ? '<div class="fb-box" style="margin-top:12px"><div class="fb-q">' + I('sparkle') + 'Заполните психопрофиль контактов</div><div style="font-size:11.5px;color:var(--mut);margin-top:6px">Откройте карточку контакта → «Заполнить профиль»: параметры стиля общения включат персонализацию в мессенджерах и соцсетях (за согласием).</div></div>'
      : '';
    const mb = document.querySelector('.modal-wrap.show .mb');
    if (mb) mb.insertAdjacentHTML('beforeend', '<div style="margin-top:10px">' + markBadge('simulated') + '</div>' +
      '<div class="section-label" style="margin-top:12px">Распознано и добавлено: ' + cfg.records.length + '</div><div class="chg-list">' + rows + '</div>' + hint);
    const mf = document.querySelector('.modal-wrap.show .mf');
    if (mf) mf.innerHTML = '<button class="btn" data-act="closeModal">Закрыть</button>' +
      '<button class="btn primary" data-act="importGo" data-impkind="' + kind + '">' + I('arrowRight') + cfg.goLabel + ' (' + cfg.records.length + ' новых)</button>';
  }
  function importGo(kind) {
    const cfg = IMPORT[kind]; if (!cfg) return;
    if (cfg.tab) S().clientsTab = cfg.tab;
    WS.ui.closeModal();
    WS.router.go(cfg.nav);
    WS.storeApi.toast(cfg.done, 'ok');
  }

  WS.events = { EVENTS, STORY, evById, markBadge, SIM };
  WS.eventEngine = { play, openPresenter, playDay, nextDay, sessionResults, callSelf, callAi, failResolve, recordFb, openIncomingCall, importRun, importGo };
})(window.WS = window.WS || {});
