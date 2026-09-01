/* ============================================================
   UI layer — shell, screens, navigator, modals, toasts.
   Full render is idempotent; the Concierge chat is rebuilt from
   engine.session().items so a full re-render never loses it.
   ============================================================ */
(function (WS) {
  const I = WS.icon;
  const S = () => WS.store;
  const D = () => WS.store.data;
  const h = (s) => s; // passthrough for readability
  // Escape user-derived values placed into HTML attributes (search text, custom task titles).
  const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // v3 first level (by frequency): Пульс · Консьерж · Входящие · Сделки · Клиенты · Объекты · Оценка
  const NAV = [
    // Консьерж стоит первым, потому что он и есть вход: приложение открывается им, а не сводкой.
    // Порядок пунктов — это заявление о том, чем система является: рабочее место с ИИ сбоку
    // и ИИ, под которым лежит рабочее место, — разные продукты, и мы делаем второй.
    { id: 'concierge', label: 'Консьерж', icon: 'sparkle' },
    { id: 'start', label: 'Пульс', icon: 'pulse' },
    // «Входящие», а не «Заявки»: у агента раздел — разбор того, что пришло, и дальше работа идёт
    // в «Сделках» одним путём. Слово «заявка» остаётся руководителю и внутри данных: у агента оно
    // означало то же, что «сделка», и именно на этом разошлись с партнёром.
    { id: 'requests', label: 'Входящие', icon: 'mail', count: () => ((D().requests || []).length + (D().inbox || []).length) },
    { id: 'clients', tab: 'deals', label: 'Сделки', icon: 'briefcase', count: () => D().deals.length },
    // Сопровождение стоит рядом со сделками, потому что это и есть передача: сделка кончается
    // подписанием, а дальше живёт договор — и живёт месяцами.
    { id: 'contracts', label: 'Сопровождение', icon: 'doc', count: () => (D().contracts || []).filter((k) => k.status !== 'closed').length },
    { id: 'tasks', label: 'Задачи', icon: 'checkCircle', count: () => (D().tasks || []).filter((t) => t.status !== 'done').length },
    // «Контакты», а не «Клиенты»: роль — это то, кем человек оказался в конкретной сделке, а не
    // то, чем он является. Сегодня покупатель, через год собственник, между делом агент-партнёр.
    // Компании живут здесь же одним списком; их карточка остаётся отдельной — у юрлица есть KYC
    // и контактные лица, которым в строке человека места нет.
    { id: 'clients', tab: 'contacts', label: 'Контакты', icon: 'users', count: () => (D().clients || []).length + (D().companies || []).length },
    { id: 'objects', label: 'Объекты', icon: 'building', count: () => D().objects.length },
    { id: 'valuation', label: 'Оценка объекта', icon: 'calc' },
  ];
  // "Ещё" group — full v3 framework. Подбор/Доходность are contextual (reached from
  // object/deal cards), so they are not first-level nav items.
  const NAV_MORE = [
    { id: 'partners', label: 'Сеть', icon: 'handshake' },
    { id: 'shows', label: 'Календарь', icon: 'calendar' },
    { id: 'promotion', label: 'Продвижение', icon: 'radar' },
    { id: 'analytics', label: 'Аналитика', icon: 'trend' },
    { id: 'services', label: 'Услуги', icon: 'grid' },
    { id: 'club', label: 'Клуб', icon: 'star' },
    { id: 'docs', label: 'Документы', icon: 'doc' },
  ];
  // Manager IA (P7): a SEPARATE first-level nav for role=manager — oversight, not the agent's execution set.
  const NAV_MGR = [
    { id: 'start', label: 'Пульс команды', icon: 'pulse' },
    { id: 'concierge', label: 'Консьерж', icon: 'sparkle' },
    { id: 'team', label: 'Команда', icon: 'users' },
    { id: 'clients', tab: 'deals', label: 'Сделки', icon: 'briefcase', count: () => D().deals.length },
    { id: 'contracts', label: 'Сопровождение', icon: 'doc', count: () => (D().contracts || []).filter((k) => k.status !== 'closed').length },
    { id: 'tasks', label: 'Задачи', icon: 'checkCircle', count: () => (D().tasks || []).filter((t) => t.status !== 'done').length },
    { id: 'leads', label: 'Распределение', icon: 'mail', count: () => (D().inbox || []).length },
    { id: 'approvals', label: 'Согласования', icon: 'check', count: () => MGR_APPROVALS.length - (S().apprDone || []).length },
    { id: 'analytics', label: 'Аналитика', icon: 'trend' },
  ];
  const NAV_MGR_MORE = [
    { id: 'clients', tab: 'contacts', label: 'Контакты', icon: 'users' },
    { id: 'objects', label: 'Объекты', icon: 'building' },
    { id: 'partners', label: 'Сеть', icon: 'handshake' },
    { id: 'valuation', label: 'Оценка объекта', icon: 'calc' },
    { id: 'docs', label: 'Документы', icon: 'doc' },
  ];
  const MOB_TABS = ['start', 'concierge', 'clients', 'objects'];

  // ---------------- SHELL ----------------
  // avatar: photo (WS.photos[u.photo]) if present, else initials
  function avatarAttrs(u) {
    const src = u && u.photo && WS.photos && WS.photos[u.photo];
    // Render the portrait as a real <img> (not a CSS background) — most robust across browsers:
    // sidesteps url() parsing, <button> background quirks, and privacy/force-colors background suppression.
    if (src) return { cls: ' has-photo', style: 'padding:0;overflow:hidden', inner: '<img src="' + src + '" alt="" draggable="false" style="width:100%;height:100%;display:block;object-fit:cover;object-position:center;border-radius:50%">' };
    return { cls: '', style: '', inner: (u && u.init) || '' };
  }
  function shell() {
    const st = S();
    // Build stamp — makes file freshness visible so a stale file:// cache is obvious at a glance.
    try { document.title = 'WESPACE · сборка ' + ((typeof window !== 'undefined' && window.WS_BUILD) || 'DEV'); } catch (e) {}
    const _av = avatarAttrs(D().users[st.role]);
    const clk = WS.storeApi.clockLabel();
    const themeIcon = (st.theme === 'dark') ? 'sun' : 'moon';
    const navActive = (n) => {
      if (st.view !== n.id) return false;
      if (n.id === 'clients') return (st.clientsTab || 'deals') === (n.tab || 'deals');
      return true;
    };
    const navBtn = (n) => {
      const on = navActive(n) ? ' on' : '';
      const cnt = n.count ? '<span class="count">' + n.count() + '</span>' : '';
      const tab = n.tab ? ' data-tab="' + n.tab + '"' : '';
      return '<a class="nav-item' + on + '" data-nav="' + n.id + '"' + tab + ' tabindex="0" title="' + escAttr(n.label) + '">' +
        I(n.icon) + '<span class="nav-lbl">' + n.label + '</span>' + cnt + '</a>';
    };
    const _nav = st.role === 'manager' ? NAV_MGR : NAV;
    const _navMore = st.role === 'manager' ? NAV_MGR_MORE : NAV_MORE;
    const _hidden = st.navHidden || [];
    const _navKey = (n) => n.id + (n.tab ? ':' + n.tab : '');
    const _vis = (arr) => arr.filter((n) => _hidden.indexOf(_navKey(n)) < 0);
    const navItems = _vis(_nav).map(navBtn).join('') +
      '<div class="nav-group-label">Ещё</div>' + _vis(_navMore).map(navBtn).join('');

    const roleSwitch =
      '<div class="role-switch" role="tablist" aria-label="Роль">' +
      '<button class="' + (st.role === 'agent' ? 'on' : '') + '" data-role="agent"><span class="av">' + D().users.agent.init + '</span><span class="txt">Агент</span></button>' +
      '<button class="' + (st.role === 'manager' ? 'on' : '') + '" data-role="manager"><span class="av">' + D().users.manager.init + '</span><span class="txt">Руководитель</span></button>' +
      '</div>';

    const unsavedDot = st.unsaved ? '<span class="badge-dot"></span>' : '';

    const railed = !!st.navRail;
    return '' +
      '<div class="app' + (railed ? ' nav-railed' : '') + '">' +
        '<div class="brand"><div class="logo">W</div><div><div class="wm">WE<span>SPACE</span></div></div></div>' +
        '<div class="topbar">' +
          '<button class="tb-icon nav-rail-t" data-act="navRail" title="' +
          (railed ? 'Развернуть меню' : 'Свернуть меню до значков') + '" aria-label="Свернуть меню">' +
          I(railed ? 'chevRight' : 'chevLeft') + '</button>' +
          '<div class="tb-tenant"><span class="dot"></span><span class="txt">Демо-тенант · Dubai</span></div>' +
          '<span class="tb-build" title="Версия сборки. Если цифра старая — обновите: Ctrl+Shift+R">v' + ((typeof window !== 'undefined' && window.WS_BUILD) || 'DEV') + '</span>' +
          '<div class="tb-spacer"></div>' +
          roleSwitch +
          '<div class="tb-clock">' + I('clock') + '<span><span class="lbl">Демо-часы</span> ' + clk.time + ' · ' + clk.date + '</span></div>' +
          '<button class="tb-btn wallet-chip" data-act="wallet" title="Кошелёк">' + I('wallet') + '<span class="txt">Кошелёк · 8 500 AED</span></button>' +
          '<button class="tb-icon" data-act="notif" title="Уведомления">' + I('bell') + unsavedDot + '</button>' +
          '<button class="tb-icon" data-act="theme" title="Тема">' + I(themeIcon) + '</button>' +
          '<button class="tb-icon" data-act="settings" title="Настройки">' + I('gear') + '</button>' +
          '<button class="tb-btn" data-act="reset" title="Сброс демо-данных">' + I('reset') + '<span class="txt">Сброс</span></button>' +
          '<button class="tb-avatar' + _av.cls + '" data-act="profile" title="Профиль"' + (_av.style ? ' style="' + _av.style + '"' : '') + '>' + _av.inner + '</button>' +
        '</div>' +
        '<nav class="nav">' + navItems +
          '<div class="nav-foot"><div class="demo-mode">' + (st.tour.active ? '<span class="pill">Демо-тур</span> активен' : '<span class="pill">Свободный режим</span>') + '</div></div>' +
        '</nav>' +
        '<main class="main" id="main"></main>' +
        '<div class="tabbar">' + MOB_TABS.map((id) => { const n = NAV.find((x) => x.id === id); return '<button data-nav="' + id + '" class="' + (st.view === id ? 'on' : '') + '" aria-label="' + n.label + '">' + I(n.icon) + n.label.split(' ')[0] + '</button>'; }).join('') +
          '<button data-act="sections" class="' + (['objects', 'calc', 'shows', 'docs'].includes(st.view) ? 'on' : '') + '" aria-label="Все разделы">' + I('menu') + 'Ещё</button>' +
          '<button data-act="navigator" aria-label="Навигатор демо">' + I('compass') + 'Демо</button></div>' +
      '</div>' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="drawer" id="drawer"></aside>';
    // NB: #modal and #toasts live OUTSIDE #app (static in body) so a full render()
    // never wipes an open modal / live toast (audit P0-1). ensureOverlays() guarantees them.
  }
  // Modal + toasts persist across re-renders — created once, outside the render tree.
  function ensureOverlays() {
    if (!document.getElementById('modal')) {
      const m = document.createElement('div'); m.className = 'modal-wrap'; m.id = 'modal'; document.body.appendChild(m);
    }
    if (!document.getElementById('toasts')) {
      const t = document.createElement('div'); t.className = 'toasts'; t.id = 'toasts'; document.body.appendChild(t);
    }
    if (!document.getElementById('cgdock')) {
      const d = document.createElement('div'); d.className = 'cgdock'; d.id = 'cgdock'; document.body.appendChild(d);
    }
  }

  // ---------------- ЧТО СЕЙЧАС ОТКРЫТО НА ЭКРАНЕ ----------------
  const VIEW_NAMES = {
    start: 'Пульс', concierge: 'Консьерж', clients: 'Сделки', companies: 'Контакты · компании',
    objects: 'Объекты', requests: 'Входящие', contracts: 'Сопровождение', tasks: 'Задачи',
    calc: 'Расчёт', finance: 'Финансы', shows: 'Показы', docs: 'Документы', analytics: 'Аналитика',
    valuation: 'Оценка объекта', partners: 'Сеть', services: 'Услуги', club: 'Клуб',
    promotion: 'Продвижение', profile: 'Профиль', settings: 'Настройки', team: 'Команда',
    leads: 'Распределение лидов', approvals: 'Согласования',
    dealDetail: 'Карточка сделки', requestDetail: 'Карточка запроса',
    clientDetail: 'Карточка контакта', companyDetail: 'Карточка компании',
    objectDetail: 'Карточка объекта', contractDetail: 'Карточка договора',
  };
  // Ключевые факты записи, а не вся запись: Консьерж и так читает рабочее место целиком, здесь
  // важно ровно одно — на что смотрит агент, когда говорит «эта сделка».
  function screenContext() {
    const st = S();
    const out = { вид: st.view, экран: VIEW_NAMES[st.view] || st.view };
    if (st.view === 'dealDetail') {
      const d = (D().deals || []).find((x) => x.id === st.dealId);
      if (d) {
        const c = (D().clients || []).find((x) => x.id === d.clientId) || {};
        const f = funnelSteps(d);
        out.запись = { тип: 'сделка', id: d.id, название: d.title || 'сделка', клиент: c.name || null,
          шаг: f.cols[f.idx] || null, сумма: d.amount || null, срок_следующего_шага: d.nextDue || null,
          объекты: dealLots(d).map((o) => o.name) };
      }
    } else if (st.view === 'requestDetail') {
      const r = requestById(st.requestId);
      if (r) {
        const c = (D().clients || []).find((x) => x.id === r.clientId) || {};
        out.запись = { тип: 'запрос', id: r.id, название: r.title || 'запрос', клиент: c.name || null,
          стадия: reqStageLabel(reqStage(r), r), бюджет: r.budget || null, срок: r.horizon || null };
      }
    } else if (st.view === 'clientDetail') {
      const c = (D().clients || []).find((x) => x.id === st.clientId);
      if (c) out.запись = { тип: 'контакт', id: c.id, название: c.name, канал: c.channel || null };
    } else if (st.view === 'companyDetail') {
      const co = (D().companies || []).find((x) => x.id === st.companyId);
      if (co) out.запись = { тип: 'компания', id: co.id, название: co.name };
    } else if (st.view === 'objectDetail') {
      const o = (D().objects || []).find((x) => x.id === st.objectId);
      if (o) out.запись = { тип: 'объект', id: o.id, название: o.name, район: o.area || null, цена: o.price || null };
    } else if (st.view === 'clients') {
      out.вкладка = st.clientsTab === 'contacts' ? 'Контакты' : 'Сделки';
    }
    return out;
  }
  // Одной строкой — для шапки дока: агент должен ВИДЕТЬ, что Консьерж смотрит туда же.
  function screenContextLabel() {
    const c = screenContext();
    const r = c.запись;
    return r ? (c.экран + ' · ' + r.название) : (c.экран + (c.вкладка ? ' · ' + c.вкладка : ''));
  }

  // ---------------- DOCKED CONCIERGE CHAT (float over any page) ----------------
  function cgDockWelcome() {
    return '<div class="cgdock-welcome">' + I('sparkle') +
      '<div class="cgdock-w-t">Чат с Консьержем</div>' +
      '<div class="cgdock-w-m">Спросите что угодно, не покидая текущий раздел.</div></div>';
  }
  function renderDockMsgs() {
    const c = document.getElementById('cgdockmsgs'); if (!c) return;
    const t = WS.engine.activeThread();
    syncMessages(c, t, cgDockWelcome());
    if (t && t.items.length) WS.engine.markSeen(t.id);
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
  }
  function renderCgDock() {
    const el = document.getElementById('cgdock'); if (!el) return;
    // Закладка на краю едет вместе с кромкой панели — она же ручка, которой панель задвигают.
    // Класс на body, потому что закладка живёт вне #app и переживает перерисовку.
    if (document.body) document.body.classList.toggle('cg-open', !!S().cgDock);
    /* На карточке сделки или заявки панель ложится РОВНО на правую, рабочую колонку: партнёр
       просил, чтобы правая часть превращалась в диалог, а левая со справкой и условиями
       оставалась на виду. Ширина берётся замером самой колонки, а не подобранной константой —
       константа разъехалась бы с раскладкой при первой же её правке. */
    const col = document.querySelector('#app .dcard-main');
    const box = col ? col.getBoundingClientRect() : null;
    if (box && box.left > 0 && window.innerWidth > 900) {
      document.documentElement.style.setProperty('--cg-w', Math.round(window.innerWidth - box.left) + 'px');
    } else {
      document.documentElement.style.removeProperty('--cg-w');
    }
    if (!S().cgDock) { el.className = 'cgdock'; el.innerHTML = ''; return; }
    const t = WS.engine.activeThread();
    const label = t ? t.label : 'Новый диалог';
    el.className = 'cgdock show';
    el.innerHTML =
      '<div class="cgdock-head"><span class="cgdock-title">' + I('sparkle') + 'Консьерж</span>' +
        '<span class="cgdock-sub">' + label + '</span>' +
        '<button class="cgdock-x" data-act="cgDockOpenFull" title="Открыть на весь экран">' + I('layers') + '</button>' +
        '<button class="cgdock-x" data-act="cgDock" title="Свернуть">' + I('x') + '</button></div>' +
      // Видно, что Консьерж смотрит на тот же экран: без этой строки «а по этой сделке что?»
      // выглядит как вопрос в пустоту, даже когда контекст на самом деле передан.
      '<div class="cgdock-where">' + I('layers') + '<span>Контекст: ' + escAttr(screenContextLabel()) + '</span></div>' +
      '<div class="cgdock-msgs" id="cgdockmsgs"></div>' +
      '<div class="cgdock-foot">' + cgComposer('cgDockPrompt', 'Спросите Консьержа…', 'cgDockSend') + '</div>';
    WS.engine.mount(document.getElementById('cgdockmsgs'), function () { renderDockMsgs(); });
    renderDockMsgs();
  }

  // ---------------- START SCREEN ----------------
  // ---- R1: canonical (deterministic) analytics + digest + drill-down ----
  // Same inputs → same numbers. Broker commission only; platform margin never shown (§compliance).
  const LOSS_REASONS = [
    { r: 'Цена выше рынка', n: 4 }, { r: 'Выбрали у конкурента', n: 3 },
    { r: 'Долго решается', n: 2 }, { r: 'Финансирование не одобрено', n: 2 }, { r: 'Не прошёл проверку KYC', n: 1 },
  ];
  // Anyone a record points at, by id — the three switchable roles plus colleagues.
  function userById(id) {
    if (!id) return null;
    const data = D();
    const inRoster = (data.roster || []).find((u) => u.id === id);
    if (inRoster) return inRoster;
    const roles = data.users || {};
    return Object.keys(roles).map((k) => roles[k]).find((u) => u && u.id === id) || null;
  }

  // The commission on a deal, one definition, used by the screens and by any answer.
  // It follows the rate on the linked object, because that is the rate shown on the
  // object card; a flat guess here is exactly the discrepancy a broker spots first.
  const DEFAULT_COMM_PCT = 2;
  // Комиссия сделки. У сделки с несколькими лотами ставка у каждого своя, а брать ставку первого
  // и умножать на всю сумму — это ровно та ошибка, которую брокер замечает первой. Считаем по лотам,
  // и только если их цены не складываются в сумму сделки, возвращаемся к ставке ведущего объекта.
  /* Комиссия считается ПО ЛОТАМ и по их собственным ставкам — прежде ставка первого лота
     применялась ко всей сумме сделки, то есть один объект назначал процент всем остальным.
     Вышедший из сделки лот в расчёт не входит: это и есть пересчёт при частичном отказе.
     Один лот или ни одного — база остаётся суммой сделки: она могла быть выторгована ниже
     прайса, и подменять её ценой объекта значило бы считать не ту сделку. */
  function dealCommission(deal) {
    if (!deal) return 0;
    const objs = D().objects || [];
    const all = (deal.lots && deal.lots.length) ? deal.lots.map((id) => objs.find((o) => o.id === id)).filter(Boolean) : [];
    if (all.length > 1) {
      const live = all.filter((o) => !lotIsOut(lotState(deal, o.id)));
      return Math.round(live.reduce((a, o) => a + (o.price || 0) * (lotCommissionPct(deal, o) / 100), 0));
    }
    const obj = objs.find((o) => o.id === deal.objectId) || all[0];
    const pct = obj ? lotCommissionPct(deal, obj) : DEFAULT_COMM_PCT;
    return Math.round((deal.amount || 0) * pct / 100);
  }

  function computeMetrics() {
    const A = D().attribution || []; const deals = D().deals || [];
    const leads = A.reduce((s, x) => s + x.leads, 0);
    const won = A.reduce((s, x) => s + x.deals, 0);
    // Every funnel earns a commission now — the old list named four product boards, which is the
    // very distinction the service axis removed.
    const activeSales = deals.filter((d) => !dealClosed(d) && !dealArchived(d));
    const expectedComm = Math.round(activeSales.reduce((s, d) => s + dealCommission(d), 0));
    const closed = deals.filter(dealWon);
    return { leads, won, conv: leads ? Math.round((won / leads) * 100) : 0, expectedComm, closedCount: closed.length, closedSum: closed.reduce((s, d) => s + d.amount, 0), attribution: A };
  }

  // ---- Goal progress computation — per metric from demo data ----
  // ---- Personal / team goals ----------------------------------------------------------------
  // Progress is DERIVED from the demo's own records, never stored: a counter nothing updates would
  // drift away from the board the moment a scenario moves a deal.
  //
  // Scope: an agent's goal counts that agent's own book; the manager's goals count the department,
  // so the same component serves «моя цель» and «план отдела».
  const GOAL_METRICS = {
    commission: { label: 'Комиссия', unit: 'money', hint: 'закрытые сделки периода' },
    deals: { label: 'Закрытые сделки', unit: 'count', word: ['сделка', 'сделки', 'сделок'], hint: 'стадия «закрыта»' },
    pipeline: { label: 'Сумма сделок в работе', unit: 'money', hint: 'сколько денег сейчас в работе' },
    shows: { label: 'Показы', unit: 'count', word: ['показ', 'показа', 'показов'], hint: 'встречи на объектах' },
    leads: { label: 'Клиенты в работе', unit: 'count', word: ['клиент', 'клиента', 'клиентов'], hint: 'закреплены за вами' },
  };
  // May in the demo week; a quarter is Apr–Jun, so a quarterly goal is 44 days in on 14 May.
  const DAYS_IN_MONTH = 31;
  const QUARTER_ELAPSED_BEFORE_MAY = 30;  // Q2 runs Apr–Jun, so on 14 May only April has elapsed
  const DAYS_IN_QUARTER = 91;
  function goalOwnerId(scope) {
    const u = D().users[scope === 'team' ? 'manager' : S().role];
    return u ? u.id : null;
  }
  function goalDeals(scope) {
    const all = D().deals || [];
    if (scope === 'team') return all;
    const me = goalOwnerId(scope);
    return all.filter((d) => d.agent === me);   // d.agent holds a user id (u_marina), not a role name
  }
  // The closed book for the period. For the whole department it is `attribution` (the agency's
  // book by source); for one agent it is that agent's own `closedPeriod` — `attribution` carries no
  // agent split, so slicing it per person would have reported the agency's history as Marina's.
  // Either way, a deal that closes DURING the demo is added on top, so the figure moves on screen.
  function closedBook(scope, period) {
    const deals = goalDeals(scope);
    const live = deals.filter(dealWon);
    /* `live` — сделки, закрытые В СТЕНДЕ, у них есть записи. `carried` — итог периода,
       перенесённый в профиль до начала стенда: строк за ним нет вовсе. Оба слагаемых уезжают
       наружу, потому что «из чего сложилось» обязано назвать и то, чего показать нельзя, —
       иначе список молча не сойдётся с числом над ним. */
    if (scope === 'team') {
      const attr = D().attribution || [];
      const carried = { commission: Math.round(attr.reduce((s2, x) => s2 + (x.commission || 0), 0)),
        deals: attr.reduce((s2, x) => s2 + (x.deals || 0), 0), what: 'книга агентства по источникам' };
      return {
        commission: Math.round(carried.commission + live.reduce((s2, d) => s2 + dealCommission(d), 0)),
        deals: carried.deals + live.length, live: live, carried: carried,
      };
    }
    const own = ((D().users[S().role] || {}).closedPeriod || {})[period === 'quarter' ? 'quarter' : 'month'] || { commission: 0, deals: 0 };
    return {
      commission: Math.round(own.commission + live.reduce((s2, d) => s2 + dealCommission(d), 0)),
      deals: own.deals + live.length, live: live,
      carried: { commission: own.commission, deals: own.deals, what: 'закрыто до начала стенда' },
    };
  }
  function goalFact(goal, scope) {
    const deals = goalDeals(scope);
    if (goal.metric === 'commission') return closedBook(scope, goal.period).commission;
    if (goal.metric === 'deals') return closedBook(scope, goal.period).deals;
    if (goal.metric === 'pipeline') return Math.round(deals.filter((d) => !dealClosed(d) && !dealArchived(d)).reduce((s2, d) => s2 + (d.amount || 0), 0));
    if (goal.metric === 'shows') {
      // Events carry no owner, so a show counts as mine when its client is on one of my deals — and
      // only once it has actually happened: a viewing booked for 16:00 is not a показ at 9:12.
      const mine = {}; deals.forEach((d) => { mine[d.clientId] = true; });
      return (D().events || []).filter((e) => e.kind === 'show' && e.status !== 'canceled' &&
        ordFromWhen(e.when, UNDATED_ORD) <= NOW_ORD && (scope === 'team' || mine[e.clientId])).length;
    }
    if (goal.metric === 'leads') {
      if (scope === 'team') return (D().clients || []).length;
      const mine = {}; deals.forEach((d) => { mine[d.clientId] = true; });
      return (D().clients || []).filter((c) => mine[c.id]).length;
    }
    return 0;
  }
  function goalValue(metric, n) {
    const m = GOAL_METRICS[metric] || {};
    if (m.unit === 'money') return WS.AED(n);
    return n + (m.word ? ' ' + plural(n, m.word[0], m.word[1], m.word[2]) : '');
  }
  function computeGoalProgress(goal, scope) {
    const fact = goalFact(goal, scope);
    const target = goal.target || 0;
    const pct = target ? Math.round((fact / target) * 100) : 0;
    const now = WS.fixtures.DEMO_NOW;
    const elapsed = goal.period === 'quarter' ? (QUARTER_ELAPSED_BEFORE_MAY + now.d) : now.d;
    const span = goal.period === 'quarter' ? DAYS_IN_QUARTER : DAYS_IN_MONTH;
    const projected = elapsed > 0 ? Math.round(fact / elapsed * span) : 0;
    const share = target ? Math.round(projected / target * 100) : 0;
    // Days by which the current rate beats (or misses) the finish line.
    const daysAhead = (fact && target) ? Math.round(span - (target / (fact / elapsed))) : 0;
    let pace;
    // Pace only means something for a metric that ACCUMULATES over the period. Pipeline is a stock —
    // how much sits in work right now — so projecting it forward by a daily rate is nonsense.
    const cumulative = goal.metric !== 'pipeline' && goal.metric !== 'leads';
    if (!cumulative) pace = fact >= target ? 'план по загрузке держится' : 'до нормы не хватает ' + goalValue(goal.metric, target - fact);
    else if (!target) pace = 'цель не задана';
    else if (fact >= target) pace = 'цель закрыта';
    else if (share >= 100) pace = 'идёте с опережением — на ' + Math.max(1, daysAhead) + ' ' + plural(Math.max(1, daysAhead), 'день', 'дня', 'дней') + ' раньше срока';
    else pace = 'при текущем темпе — ' + share + '% к концу ' + (goal.period === 'quarter' ? 'квартала' : 'месяца');
    /* «Отстаём или нет» для запаса и для накопления считается по-разному. Темп имеет смысл
       только там, где число НАКАПЛИВАЕТСЯ за период; для запаса («держать 5 млн в активных
       сделках») проекция по дневному темпу — та самая бессмыслица, о которой сказано выше.
       На ней экран и показывал галочку рядом со словами «до нормы не хватает 1 022 000»:
       галочка бралась из проекции, а текст — из факта. Для запаса отставание — это просто
       «сейчас меньше нормы». */
    const behind = cumulative ? (share < 100 && fact < target) : (fact < target);
    return { fact: fact, target: target, pct: pct, remaining: Math.max(0, target - fact), pace: pace, behind: behind };
  }
  function goalsOf(roleKey) { const u = D().users[roleKey]; return (u && u.goals) || []; }
  /* ---- Цель полосой над рабочей областью --------------------------------------------------
     На каждом из семи листов партнёра сверху стоит одна и та же полоса: «Цель до <дата>» ·
     «Заработать <сумма>» · выполнено · осталось · двухцветный прогресс. Она не украшение —
     это единственный элемент, который виден из любого раздела Пульса, и мерило всему
     остальному. У нас на её месте стояли две плитки в общем потоке, и цель читалась как
     ещё один блок среди прочих. Числа считаются по сделкам стенда, как и раньше. */
  const MONTH_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTH_LAST = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function goalDeadline(goal) {
    const now = WS.fixtures.DEMO_NOW;
    // Квартал заканчивается своим последним месяцем, месяц — собой. Даты рисуются, а не берутся
    // из макета: «до 31.12.2026» в стенде, где сегодня 14 мая, было бы чужим числом.
    const mo = goal.period === 'quarter' ? Math.ceil(now.mo / 3) * 3 : now.mo;
    return MONTH_LAST[mo - 1] + ' ' + MONTH_RU[mo - 1] + ' ' + now.y;
  }
  function goalBandRow(goal, scope) {
    const p = computeGoalProgress(goal, scope);
    const pct = Math.max(0, Math.min(100, p.pct));
    /* Цель — самое крупное число на экране, и до сих пор оно никуда не вело: брокер видел
       «выполнено 482 500» и не мог посмотреть, из каких сделок это сложилось. Строка стала
       кнопкой к тем самым записям — по тому же разбору, по которому цифра и считалась. */
    return '<button class="pgoal-row' + (p.behind ? ' is-behind' : '') +
      '" data-act="goalDrill" data-goal="' + goal.id + '" title="Показать, из чего сложилось число">' +
      '<div class="pgoal-cells">' +
        '<div class="pgoal-cell"><div class="pgoal-k">Цель до ' + goalDeadline(goal) + '</div>' +
          '<div class="pgoal-v">Выполнено ' + goalValue(goal.metric, p.fact) + '</div></div>' +
        '<div class="pgoal-cell"><div class="pgoal-k">' + escAttr(goal.label) + '</div>' +
          '<div class="pgoal-v">Осталось ' + goalValue(goal.metric, p.remaining) + '</div></div>' +
      '</div>' +
      '<div class="pgoal-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="pgoal-foot"><span class="pgoal-pct">' + p.pct + '%</span>' +
        I(p.behind ? 'warn' : 'check') + '<span>' + p.pace + '</span>' +
        '<span class="pgoal-drill">' + I('arrowRight') + 'из чего сложилось</span></div>' +
      '</button>';
  }
  /* Записи, из которых сложилось число цели. Берутся тем же разбором, что и само число
     (`goalFact` / `closedBook`), — иначе список и цифра разойдутся на первой же правке одной
     из сторон, и брокер увидит на экране одно, а в раскрытии другое. */
  function goalDrill(goalId) {
    const scope = S().role === 'manager' ? 'team' : 'me';
    const goal = goalsOf(S().role).find((g) => g.id === goalId);
    if (!goal) return;
    const p = computeGoalProgress(goal, scope);
    let rows = '', note = '', carried = '';
    if (goal.metric === 'commission' || goal.metric === 'deals') {
      const book = closedBook(scope, goal.period);
      rows = (book.live || []).map((d) => feedRow('briefcase', 'i-ok', escAttr(d.title),
        stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + ' · комиссия ' + WS.AED(Math.round(dealCommission(d))),
        '<span data-deal="' + d.id + '" style="cursor:pointer">' + I('arrowRight') + '</span>')).join('');
      note = 'Закрытые сделки ' + (goal.period === 'quarter' ? 'за квартал' : 'за месяц') +
        '. Комиссия по каждой — по ставке связанного объекта.';
      const c = book.carried || {};
      const cv = goal.metric === 'commission' ? c.commission : c.deals;
      if (cv) {
        carried = '<div class="prov" style="margin-bottom:10px"><span class="badge warn">' + I('lock') +
          'Плюс ' + goalValue(goal.metric, cv) + ' — ' + escAttr(c.what || 'перенесённый итог') +
          ': строк за ними в стенде нет</span></div>';
      }
    } else if (goal.metric === 'pipeline') {
      const list = goalDeals(scope).filter((d) => !dealClosed(d) && !dealArchived(d));
      rows = list.map((d) => feedRow('briefcase', 'i-acc', escAttr(d.title),
        stageLabel(d.stage) + ' · ' + WS.AED(d.amount),
        '<span data-deal="' + d.id + '" style="cursor:pointer">' + I('arrowRight') + '</span>')).join('');
      note = 'Сделки в работе прямо сейчас. Это остаток, а не накопление: темп к нему не применяется.';
    } else if (goal.metric === 'shows') {
      /* Тот же отбор, что и в `goalFact`, включая границу по времени: показ, назначенный на
         сегодня 16:00, в девять утра ещё не состоялся и в число не идёт. Без этой границы
         список был бы длиннее числа над ним — расхождение, ради которого раскрытие и
         существует, только с обратным знаком. */
      const mine = {}; goalDeals(scope).forEach((d) => { mine[d.clientId] = true; });
      const list = (D().events || []).filter((e) => e.kind === 'show' && e.status !== 'canceled' &&
        ordFromWhen(e.when, UNDATED_ORD) <= NOW_ORD &&
        (scope === 'team' || mine[e.clientId]));
      rows = list.map((e) => { const c = (D().clients || []).find((x) => x.id === e.clientId) || {};
        return feedRow('calendar', 'i-acc', escAttr(e.title || 'Показ'),
          [c.name, e.when].filter(Boolean).join(' · '), ''); }).join('');
      note = 'Показы по вашим клиентам. В счёт идут состоявшиеся: назначенный на сегодня 16:00 ещё не считается.';
    } else if (goal.metric === 'leads') {
      const mine = {}; goalDeals(scope).forEach((d) => { mine[d.clientId] = true; });
      const list = (D().clients || []).filter((c) => scope === 'team' || mine[c.id]);
      rows = list.map((c) => feedRow('users', 'i-acc', escAttr(c.name),
        [CONTACT_KIND_LABEL[c.contactKind], c.budget ? WS.AED(c.budget) : null].filter(Boolean).join(' · '),
        '<span data-client="' + c.id + '" style="cursor:pointer">' + I('arrowRight') + '</span>')).join('');
      note = 'Контакты, по которым у вас есть сделка.';
    }
    openModal('Из чего сложилось · ' + escAttr(goal.label),
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">' + escAttr(note) +
      ' Выполнено ' + goalValue(goal.metric, p.fact) + ' из ' + goalValue(goal.metric, goal.target) + '.</p>' +
      carried +
      (rows ? '<div class="card"><div class="feed" style="padding:2px 16px">' + rows + '</div></div>'
            : '<div class="card pad" style="color:var(--faint)">записей за период в стенде нет</div>'),
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  function pulseMyGoals() {
    const goals = goalsOf(S().role);
    const pinned = goals.filter((g) => g.pinned);
    // Шаг между разделами Пульса один — 20 пикселей. Было 18 · 24 · 20 подряд, три разных
    // зазора между четырьмя соседями: глаз читает это как случайность, а не как ритм.
    const head = '<div class="wq-head" style="margin:20px 0 0"><div class="section-label" style="margin:0">' +
      (S().role === 'manager' ? 'План отдела' : 'Мои цели') + '</div>' +
      '<button class="btn sm" data-nav="profile">' + I('target') + 'Настроить цели</button></div>';
    if (!pinned.length) {
      const why = goals.length
        ? 'Ни одна цель не закреплена на Пульсе. Откройте профиль и отметьте те, за которыми хотите следить каждый день.'
        : 'Цели ещё не заданы. Поставьте одну — комиссия за месяц, число сделок, показы — и Пульс будет считать прогресс сам, по вашим сделкам.';
      return head + '<div class="card" style="padding:16px"><div style="font-size:12.5px;color:var(--mut);max-width:62ch">' + why + '</div>' +
        '<button class="btn sm primary" data-act="addGoal" style="margin-top:10px">' + I('plus') + 'Поставить цель</button></div>';
    }
    const scope = S().role === 'manager' ? 'team' : 'me';
    return head + '<div class="pgoal">' + pinned.map((g) => goalBandRow(g, scope)).join('') + '</div>';
  }
  // ---- Named metrics over the real demo state ----
  // The Concierge must answer with numbers that match what is on screen, so it reads THESE and
  // never computes its own. Each entry: a value plus a human label, addressable by a stable key.

  // Opens the records a figure was computed from. This is what makes an answer
  // checkable in the room: the number is not asserted, it is shown with its rows.
  function openAgentEvidence(key) {
    // Addressed to its own message: a chip under an older answer opens that
    // answer's rows, not whatever replied most recently.
    const reply = WS.engine.replyFor ? WS.engine.replyFor(key) : WS.engine.lastReply;
    // Silence read as a dead button. If the answer behind the chip is gone,
    // that is what the person is told.
    if (!reply) return WS.storeApi.toast('Этот ответ из прошлой сессии — спросите ещё раз, соберу заново');
    const r = reply.evidence;
    const e = r && r[Number(String(key || '').split(':').pop())];
    if (!e) return;
    const res = WS.query.run(Object.assign({}, e.query, { aggregate: null }));
    const rows = (res.rows || []).map((x) => {
      const title = x.title || x.name || x.id;
      const sub = [x.stage, x.due, x.area, x.amount ? WS.AED(x.amount) : null].filter(Boolean).join(' · ');
      return '<div class="feed-row"><div class="fi i-acc">' + I('source') + '</div><div class="ft">' +
        '<div class="t">' + escAttr(title) + '</div>' +
        (sub ? '<div class="m">' + escAttr(sub) + '</div>' : '') + '</div></div>';
    }).join('');
    // The answer was written at one revision and these rows are read at
    // another. Usually the same; when not, that is worth a line rather than a
    // silent difference between an answer and its own evidence.
    const moved = e.revision != null && e.revision !== res.revision
      ? '<div class="prov" style="margin-bottom:10px"><span class="badge warn">' + I('warn') +
        'Данные изменились после ответа: было на ревизии ' + e.revision + ', показано на ' + res.revision + '</span></div>'
      : '';
    openModal('Откуда это число · ' + escAttr(e.label),
      moved +
      '<div class="card pad" style="margin-bottom:10px"><span class="badge acc">' + I('calc') +
      (e.money ? WS.AED(e.value) : e.value) + ' ' + escAttr(e.label) + '</span>' +
      '<div style="margin-top:6px;font-size:12px;color:var(--mut)">Посчитано из ' + (res.rows || []).length +
      ' записей коллекции «' + escAttr(res.from || '') + '» на ревизии ' + res.revision + '.</div></div>' +
      (rows ? '<div class="card"><div class="feed" style="padding:2px 16px">' + rows + '</div></div>'
            : '<div class="card pad" style="color:var(--faint)">нет записей</div>'),
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }

  function metricsSnapshot() {
    const data = D();
    const deals = data.deals || [], tasks = data.tasks || [], clients = data.clients || [];
    const m = computeMetrics();
    // Goes through the query layer rather than filtering here, so the headline number
    // and the records a person can open behind it are produced by the same code path.
    const ACTIVE = [{ field: 'stage', op: 'ne', value: 'won' }, { field: 'stage', op: 'ne', value: 'lost' }];
    const qActive = WS.query.run({ from: 'deals', where: ACTIVE, aggregate: { fn: 'count' } });
    const qActiveSum = WS.query.run({ from: 'deals', where: ACTIVE, aggregate: { fn: 'sum', field: 'amount' } });
    const active = qActive.rows;
    const sum = (list) => list.reduce((s, d) => s + (d.amount || 0), 0);
    const byStage = {};
    active.forEach((d) => {
      const k = stageLabel(d.stage);
      (byStage[k] = byStage[k] || { count: 0, sum: 0 }).count++;
      byStage[k].sum += d.amount || 0;
    });
    const bySource = {};
    deals.forEach((d) => { if (d.source) bySource[d.source] = (bySource[d.source] || 0) + 1; });
    const out = {
      deals_active: { v: qActive.value, label: 'активных сделок' },
      deals_active_sum: { v: qActiveSum.value, money: true, label: 'сумма активных сделок' },
      deals_closed: { v: m.closedCount, label: 'закрытых сделок' },
      deals_closed_sum: { v: m.closedSum, money: true, label: 'сумма закрытых сделок' },
      deals_hot: { v: deals.filter((d) => d.hot).length, label: 'горячих сделок (SLA < 2 ч)' },
      deals_stuck: { v: active.filter((d) => (d.stageDays || 0) >= 5).length, label: 'сделок застряло в стадии 5+ дней' },
      expected_commission: { v: m.expectedComm, money: true, label: 'ожидаемая комиссия по активным' },
      conversion: { v: m.conv, pct: true, label: 'конверсия лид → сделка' },
      leads: { v: m.leads, label: 'лидов' },
      tasks_open: { v: tasks.filter((t) => t.status !== 'done').length, label: 'открытых задач' },
      tasks_overdue: { v: tasks.filter((t) => t.status !== 'done' && t.when === 'overdue').length, label: 'просроченных задач' },
      clients_total: { v: clients.length, label: 'контактов' },
      clients_no_consent: { v: clients.filter((c) => !c.consent).length, label: 'контактов без согласия на переписку' },
      companies_total: { v: (data.companies || []).length, label: 'компаний' },
    };
    return { metrics: out, byStage: byStage, bySource: bySource };
  }
  function digestBlock() {
    const tasks = D().tasks || []; const events = D().events || []; const deals = D().deals || [];
    const overdue = tasks.filter((t) => t.status !== 'done' && t.when === 'overdue').length;
    const shows = events.filter((e) => e.kind === 'show').length;
    const closed = deals.filter(dealWon).length;
    const hot = deals.filter((d) => d.hot).length;
    const row = (ic, tone, label, val, act) => '<button class="digest-row" ' + act + '><span class="di ' + tone + '">' + I(ic) + '</span><span class="dl">' + label + '</span><span class="dvv">' + val + '</span>' + I('arrowRight') + '</button>';
    return '<div class="section-label" style="margin-top:24px">Дайджест дня <span class="badge demo">' + I('lock') + 'демо</span></div>' +
      '<div class="digest">' +
      row('calendar', 'i-acc', 'Показы сегодня и завтра', shows, 'data-nav="shows"') +
      row('warn', 'i-stop', 'Просроченные задачи', overdue, 'data-analytics="overdue"') +
      row('check', 'i-ok', 'Закрытые сделки', closed, 'data-analytics="closed"') +
      row('flame', 'i-acc', 'Горячие · SLA < 2 ч', hot, 'data-analytics="hot"') +
      '</div>';
  }
  /* ==== Инсайты — то, что может стоить денег, а не то, где их заработать ==================

     Здесь стояли четыре строки текста под значком «собрано AI». Ни одна не сходилась с
     данными стенда. «Анна Петрова — 3 дня без связи» — при звонке Анне сегодня в 16:00 и двух
     её задачах на сегодня, которые видно двумя разделами выше. «Bayline 1603 — на 8% ниже
     компов» — отклонение 4%, и считалось оно к тому же не по своему сегменту. «Escrow по
     Creekline — через 4 дня» — по этой сделке договора нет вовсе, а ближайший платёж по
     единственному off-plan договору — 20 июня. «Karim Aziz · Palm Court под его предпочтения»
     — Palm Court продан Анне (`d_won`), стоит в JVC при районе Karim «Downtown» и стоит
     1,69 млн при его бюджете 2,6 млн. То есть раздел предлагал брокеру проданный юнит — ровно
     та ошибка, от которой разборы возможностей защищены проверкой занятости.

     Наблюдения считаются из тех же данных, что и всё остальное, и отвечают на другой вопрос,
     чем «Перспективные сделки». Там — где заработать. Здесь — что сгорит, если не тронуть:
     недоставленное письмо, срок в договоре, непроверенная доступность, цена выше среза. */
  /* Месяц читается по трём буквам: даты в стенде написаны и полностью («13 мая 2026»),
     и сокращённо («2 апр 2026»). Словарь берётся в момент вызова, а не при загрузке файла:
     RU_MONTHS объявлен ниже по файлу, и обращение к нему на верхнем уровне — обращение к
     ещё не созданной константе (стенд падал на загрузке ровно на этом). */
  function insDayOf(text) {
    const m = /(\d{1,2})\s+([а-яё]{3,})/i.exec(String(text || ''));
    if (!m) return null;
    const p = m[2].toLowerCase().slice(0, 3);
    const mi = RU_MONTHS.map((x) => x.slice(0, 3)).indexOf(p);
    if (mi < 0) return null;
    return dayOfYear(parseInt(m[1], 10), mi + 1);
  }
  function insDaysSince(text) {
    const d = insDayOf(text); if (d == null) return null;
    const now = demoNow();
    return dayOfYear(now.d, now.mo) - d;
  }
  /* Индекс района берётся из СВОЕГО сегмента: офис против индекса квартир — это не отклонение,
     а разные рынки. Прежняя строка сравнивала именно так и потому давала «−23%» на офисе. */
  function insIndexFor(o) {
    const want = oppTypeOf(o) === 'office' ? 'офисы' : 'квартиры';
    return oppMarket().find((m) => m.район === o.area && m.сегмент === want) || null;
  }
  function insDeviation(o) {
    const m = insIndexFor(o);
    if (!m || !o.size || !m.ценаЗаМетр) return null;
    const per = Math.round(o.price / o.size);
    return { per: per, idx: m.ценаЗаМетр, area: m.район, pct: Math.round((per / m.ценаЗаМетр - 1) * 100) };
  }
  /* ==== Срок согласия ====================================================================
     Согласие на связь было true/false без даты: стенд честно блокировал отправку без
     согласия и при этом не знал, что согласие протухает. Разбор критиков назвал это, и по
     коду подтвердилось — поля не было вовсе. Теперь у согласия есть дата выдачи и срок, и
     истёкшее согласие блокирует ровно так же, как отсутствующее: закон смотрит на срок, а
     не на галочку.

     Дни считаются грубо — год за 365 дней. Точности тут взяться неоткуда: даты в стенде
     написаны словами, а разница нужна с точностью до «через сколько», не до часа. */
  function consentUntilDay(c) {
    const m = /(\d{1,2})\s+([а-яё]{3,})\s*(\d{4})?/i.exec(String((c && c.consentUntil) || ''));
    if (!m) return null;
    const mi = RU_MONTHS.map((x) => x.slice(0, 3)).indexOf(m[2].toLowerCase().slice(0, 3));
    if (mi < 0) return null;
    const now = demoNow();
    const y = m[3] ? parseInt(m[3], 10) : now.y;
    return (y - now.y) * 365 + dayOfYear(parseInt(m[1], 10), mi + 1);
  }
  function consentDaysLeft(c) {
    const d = consentUntilDay(c); if (d == null) return null;
    const now = demoNow();
    return d - dayOfYear(now.d, now.mo);
  }
  /* Четыре состояния, и «нет согласия» отличается от «срок истёк» намеренно: агенту, читающему
     первое, кажется, что человек отказался, — а он согласие давал, просто год назад. */
  function consentState(c) {
    if (!c || c.consent !== true) return { state: 'none', days: null };
    const days = consentDaysLeft(c);
    if (days == null) return { state: 'ok', days: null };       // срок не записан — не выдумываем
    if (days < 0) return { state: 'expired', days: days };
    if (days <= 30) return { state: 'soon', days: days };
    return { state: 'ok', days: days };
  }
  /* Та же строка без ведущего существительного — для мест, где рядом уже стоит подпись
     «Согласие»: «Согласие: согласие от 14 мая…» тратит слово, которое человек прочтёт. */
  function consentLineShort(c) {
    const st = consentState(c);
    if (st.state === 'none') return 'не получено — адресные отправки заблокированы';
    if (st.state === 'expired') return 'истекло ' + escAttr(c.consentUntil) + ' — отправки заблокированы';
    if (st.state === 'soon') return 'до ' + escAttr(c.consentUntil) + ' — истекает через ' + oppDays(st.days);
    return 'от ' + escAttr(c.consentAt || '—') + ', действует до ' + escAttr(c.consentUntil || '—');
  }
  function consentLine(c) {
    const st = consentState(c);
    if (st.state === 'none') return 'согласия на связь нет — адресные отправки заблокированы';
    if (st.state === 'expired') return 'срок согласия истёк ' + escAttr(c.consentUntil) + ' — отправки заблокированы';
    if (st.state === 'soon') return 'согласие до ' + escAttr(c.consentUntil) + ' — истекает через ' + oppDays(st.days);
    return 'согласие от ' + escAttr(c.consentAt || '—') + ', действует до ' + escAttr(c.consentUntil || '—');
  }
  /* ==== Требует внимания — это ЗАДАЧИ, а не инсайты ======================================
     Пять карточек стояли в «Инсайтах»: недоставленное письмо, срок отчёта, непроверенная
     доступность, истекающее согласие, цена выше среза. Принципал назвал их тем, что они
     есть: «это просто задача на агенте, которую нужно сделать». Инсайт — другой жанр:
     результат аналитики о рынке, гипотеза применимости, без адресата.

     Поэтому они уезжают в «Мои дела» отдельной группой срочного, а «Инсайты» наполняются
     заново. Функция та же — сменилось только имя и место. */
  function pulseAlerts() {
    const out = [];
    // 1. Отправленное не дошло. Клиент считает, что мы молчим, — и это худший вид молчания.
    (D().inbox || []).filter((i) => i.stage === 'rejected').forEach((i) => {
      const c = i.clientId ? oppClient(i.clientId) : null;
      const hot = c && (D().requests || []).find((r) => r.clientId === c.id && r.temperature === 'hot');
      const late = c && (D().tasks || []).find((t) => t.clientId === c.id && t.when === 'overdue' && t.status !== 'done');
      out.push(['warn', c ? 'Переотправить письмо ' + cDat(c) + ' — адрес его отклонил'
        : 'Разобрать недоставленное письмо во «Входящих»',
        String(i.text || 'Отправка отклонена адресом.') +
        (hot ? ' У клиента горячая заявка «' + hot.title + '».' : '') +
        (late ? ' И просроченная задача: «' + late.title + '».' : '') +
        ' Для клиента это выглядит как молчание с нашей стороны.',
        c ? 'Открыть контакт' : 'Открыть входящие',
        c ? 'data-client="' + c.id + '"' : 'data-nav="requests"']);
    });
    /* 2. Согласия на связь нет. Это стояло в «Перспективных сделках» под названием
          «Возможность заперта согласием» — фраза сломана дважды. «Возможность» ничего не
          делает и не может быть заперта; а «заперта согласием» говорит обратное истине:
          запирает не согласие, а его отсутствие. И по сути это не сделка: предложить клиенту
          сейчас нечего, сначала надо получить право писать. Место такому — здесь. */
    (D().clients || []).filter((c) => c.consent === false && c.budget).forEach((c) => {
      const area = (c.areas || [])[0] || '';
      // Допуск 10%: объект на четыре процента дороже бюджета — предмет разговора, а не отказ.
      const fit = (D().objects || []).filter((o) => o.area === area &&
        o.availability === 'available' && (o.price || 0) <= c.budget * 1.1);
      out.push(['lock', 'Взять согласие на связь у ' + cGen(c),
        'Бюджет ' + WS.AED(c.budget) + ' и район ' + (area || 'не назван') + ' известны, а писать нельзя: ' +
        'согласия нет. Это не отказ — согласие просто не получено, и до него любая адресная ' +
        'отправка незаконна. ' +
        (fit.length
          ? 'В бюджете с допуском 10% ждут ' + fit.length + ' ' +
            plural(fit.length, 'объект', 'объекта', 'объектов') + '.'
          : 'Подходящего в бюджете с допуском 10% сейчас нет.'),
        'Открыть контакт', 'data-client="' + c.id + '"']);
    });
    // 3. Ближайший срок по договору. Единственный срок, который назначили не мы.
    const due = (D().contracts || []).filter((k) => k.status === 'active' && k.nextDue)
      .map((k) => ({ k: k, d: insDayOf(k.nextDue) })).filter((x) => x.d != null)
      .map((x) => Object.assign(x, { left: x.d - dayOfYear(demoNow().d, demoNow().mo) }))
      .filter((x) => x.left >= 0).sort((a, b) => a.left - b.left)[0];
    if (due) {
      const k = due.k;
      const what = String(k.nextDue).split('—')[0].trim();
      const c = oppClient(k.clientId);
      out.push(['clock',
        k.kind === 'management' && c
          ? 'Собрать отчёт ' + cDat(c) + ' — срок через ' + oppDays(due.left)
          : 'Успеть к сроку по договору ' + k.number + ' — ' + what + ' через ' + oppDays(due.left),
        contractKind(k).label + ' ' + k.number +
        (k.amount ? ' · ' + WS.AED(k.amount) + ' в год' : '') + (c ? ' · ' + c.name : '') +
        '. Срок назван в самом договоре — передоговариваться о нём не с кем.',
        /* У наблюдения про срок теперь есть не «посмотреть», а «сделать»: отчёт, ради
           которого этот срок и назван, собирается тут же. */
        k.kind === 'management' ? 'Собрать отчёт' : 'Открыть договор',
        k.kind === 'management'
          ? 'data-act="ownerReport" data-contract="' + k.id + '"'
          : 'data-contract="' + k.id + '"']);
    }
    // 4. Доступность не подтверждали дольше всех. Хуже, если по объекту уже идёт сделка.
    const stale = (D().objects || []).map((o) => ({ o: o, age: insDaysSince(o.checkedAt) }))
      .filter((x) => x.age != null).sort((a, b) => b.age - a.age)[0];
    if (stale && stale.age >= 14) {
      const o = stale.o;
      const inDeal = (D().deals || []).find((d) => !dealClosed(d) && !dealArchived(d) &&
        (d.objectId === o.id || (d.lots || []).indexOf(o.id) >= 0));
      out.push(['shield', 'Перепроверить доступность ' + oppShort(o) + ' — ' + oppDays(stale.age) + ' без проверки',
        'Проверено ' + o.checkedAt + (o.availability === 'stale' ? ', статус «под вопросом»' : '') + '. ' +
        (inDeal ? 'По объекту уже идёт сделка «' + inDeal.title + '» — если он ушёл, это узнается на подписании.'
          : 'Предложение по неподтверждённому объекту разваливается на первом звонке владельцу.'),
        inDeal ? 'Открыть сделку' : 'Открыть объект',
        inDeal ? 'data-deal="' + inDeal.id + '"' : 'data-obj="' + o.id + '"']);
    }
    /* 5. Согласие, у которого кончается срок. Пока оно живо, всё работает; в день, когда оно
          кончится, клиент молча выпадет из любой рассылки, и причину будут искать в воронке. */
    const soon = (D().clients || []).map((c) => ({ c: c, st: consentState(c) }))
      .filter((x) => x.st.state === 'soon' || x.st.state === 'expired')
      .sort((a, b) => (a.st.days || 0) - (b.st.days || 0))[0];
    if (soon) {
      const c = soon.c, expired = soon.st.state === 'expired';
      out.push(['lock', 'Взять новое согласие у ' + cGen(c) +
        (expired ? ' — срок истёк' : ' — истекает через ' + oppDays(soon.st.days)),
        'Согласие от ' + (c.consentAt || '—') + ', действует до ' + (c.consentUntil || '—') + '. ' +
        (expired
          ? 'Адресные отправки этому клиенту уже заблокированы — и это не отказ, а истёкший срок.'
          : 'После этой даты он молча выпадет из любой адресной отправки, и причину будут искать в воронке.'),
        'Открыть контакт', 'data-client="' + c.id + '"']);
    }
    // 6. Цена выше среза своего сегмента — до того, как её отправили клиенту.
    const over = (D().objects || []).filter((o) => o.availability === 'available')
      .map((o) => ({ o: o, dv: insDeviation(o) })).filter((x) => x.dv && x.dv.pct >= 5)
      .sort((a, b) => b.dv.pct - a.dv.pct)[0];
    if (over) {
      const o = over.o, dv = over.dv;
      out.push(['trend', 'Приготовить ответ по цене ' + oppShort(o) + ' — на ' + dv.pct + '% выше среза',
        WS.AED(dv.per) + ' за м² против ' + WS.AED(dv.idx) + ' по срезу ' + dv.area +
        '. Разницу спросят на первом же сравнении — ответ лучше иметь до отправки, а не после.',
        'Открыть объект', 'data-obj="' + o.id + '"']);
    }
    return out;
  }
  function alertCards() {
    const list = pulseAlerts();
    if (!list.length) return '';
    return '<div class="wq-head" style="margin-top:24px"><div class="section-label" style="margin:0">' +
      'Требует внимания · ' + list.length + '</div></div>' +
      '<div class="insights">' + list.map((it) => '<div class="insight"><div class="insight-h"><span class="insight-ic">' + I(it[0]) + '</span><div class="insight-t">' + escAttr(it[1]) + '</div></div>' +
      '<div class="insight-w">' + escAttr(it[2]) + '</div>' +
      '<div class="insight-a"><button class="btn sm" ' + it[4] + '>' + I('arrowRight') + it[3] + '</button></div></div>').join('') + '</div>';
  }

  /* ==== Инсайты — знание о рынке, а не работа с клиентом =================================
     Определение принципала: инсайт — это результат аналитики, проведённой вне работы с
     конкретным клиентом, плюс гипотеза, кому и в каком разговоре это пригодится. У инсайта
     НЕТ адресата — у него есть применимость.

     Отсюда анатомия карточки. Заголовок — изменение с НАЗВАННЫМ деятелем: действуют
     регулятор, банк, застройщик, районы, наши объекты; не действуют «рассрочка», «волна»,
     «подписание». Отсылка со ссылкой обязательна — без неё карточка неотличима от
     правдоподобного текста, на чём мы уже обожглись. «Что мы видим у себя» СЧИТАЕТСЯ по
     нашей базе и пересчитывается каждый раз: это единственное, чего не даст ни один внешний
     источник, и ради чего инсайт вообще стоит в CRM, а не в новостях.

     Если применимость ничего не нашла — карточки нет. Инсайт не устаревает по календарю,
     он перестаёт быть применимым.

     Отношение к перспективным сделкам одностороннее: как только у гипотезы появляется один
     адресат и одно предложение, она порождает перспективную сделку. Обратно — никогда. */
  const VISA_THRESHOLD = 2000000;
  const MARKET_YIELD_AVG = 6.58;          // средняя по рынку, H1 2026
  function insClients() { return D().clients || []; }
  const INSIGHTS = [
    { id: 'ins_visa_rule',
      title: 'DLD считает визовый порог по оценке объекта, а не по оплаченной доле',
      kind: 'факт',
      src: 'С 20 февраля 2026 право на десятилетнюю визу определяет оценка Земельного департамента, а не доля, которую покупатель успел оплатить. До этого требовалось внести не меньше половины цены.',
      url: 'https://www.visahq.news/2026-05-12/ae/property-route-to-uae-golden-visa-clarified-as-aed-2-million-threshold-survives-april-rule-changes/',
      until: 'до следующего циркуляра DLD',
      move: 'Тем, кто покупает в рассрочку или с ипотекой, виза доступна сразу после регистрации — раньше её ждали годами платежей.',
      see() {
        const near = insClients().filter((c) => c.visaGoal && c.budget &&
          c.budget < VISA_THRESHOLD && c.budget >= VISA_THRESHOLD * 0.9);
        const over = insClients().filter((c) => c.visaGoal && (c.budget || 0) >= VISA_THRESHOLD);
        if (!near.length && !over.length) return null;
        return near.map((c) => c.name + ': ' + WS.AED(c.budget) + ' — до порога не хватает ' +
            WS.AED(VISA_THRESHOLD - c.budget)).concat(
          over.length ? [over.length + ' ' + plural(over.length, 'клиент стоит', 'клиента стоят', 'клиентов стоят') +
            ' выше порога и, возможно, ' + plural(over.length, 'не знает', 'не знают', 'не знают') +
            ', что путь стал короче'] : []).join('. ') + '.';
      } },

    { id: 'ins_visa_stock',
      /* Заголовок с числом обязан СЧИТАТЬСЯ. Написанный руками, он расходится с расчётом
         в первый же день, когда данные изменятся: «Пять районов из шести» стояло над строкой
         «7 из 9». Поэтому заголовок здесь — функция. */
      title() {
        const all = (D().objects || []).filter((o) => o.availability === 'available');
        const pass = all.filter((o) => (o.price || 0) >= VISA_THRESHOLD);
        const flats = pass.filter((o) => oppTypeOf(o) !== 'office');
        return flats.length
          ? 'Визовый порог из нашего инвентаря проходят ' + pass.length + ' ' +
            plural(pass.length, 'объект', 'объекта', 'объектов') + ', из них ' + flats.length + ' — квартиры'
          : 'Визовый порог из нашего инвентаря проходят только офисы';
      },
      kind: 'наш срез',
      src: 'Порог для десятилетней визы — 2 млн дирхам оценки; допускается сложить до трёх объектов.',
      url: 'https://www.visahq.news/2026-05-12/ae/property-route-to-uae-golden-visa-clarified-as-aed-2-million-threshold-survives-april-rule-changes/',
      until: 'пока не изменится инвентарь',
      move: 'Клиенту, которому важна виза, придётся комбинировать объекты или искать вне инвентаря. Это же — довод завести квартиры чуть выше порога.',
      see() {
        const all = (D().objects || []).filter((o) => o.availability === 'available');
        const pass = all.filter((o) => (o.price || 0) >= VISA_THRESHOLD);
        const flats = pass.filter((o) => oppTypeOf(o) !== 'office');
        if (!all.length) return null;
        const top = all.filter((o) => oppTypeOf(o) !== 'office').sort((a, b) => (b.price || 0) - (a.price || 0))[0];
        return pass.length + ' из ' + all.length + ' свободных объектов дороже порога, и ' +
          (flats.length ? flats.length + ' из них — квартиры' : 'все они офисы') +
          (top ? '. Самая дорогая квартира — ' + oppShort(top) + ', ' + WS.AED(top.price) +
            ' (не хватает ' + WS.AED(VISA_THRESHOLD - top.price) + ')' : '') + '.';
      } },

    { id: 'ins_bb_supply',
      title: 'Аналитики относят Business Bay к районам плотной сдачи в 2026 году',
      kind: 'гипотеза',
      src: 'В 2026 году в Дубае к сдаче около 120 тысяч юнитов; прогнозы по ценам расходятся от +3–5% до +16%, а фактически апрель дал −1,76% к марту при +6,09% за год. Кластеры сдачи называют по районам, Business Bay среди них.',
      url: 'https://www.propertyfinder.ae/blog/dubai-sale-property-price-forecast/',
      until: 'до конца 2026 года',
      move: 'В районах плотной сдачи у покупателя появляется выбор. Довод «цена уйдёт вверх, не тяните» там слабее — и на него нужен ответ заранее.',
      see() {
        const objs = (D().objects || []).filter((o) => o.area === 'Business Bay');
        const cls = insClients().filter((c) => (c.areas || []).indexOf('Business Bay') >= 0);
        if (!objs.length && !cls.length) return null;
        return 'В Business Bay у нас ' + objs.length + ' ' +
          plural(objs.length, 'объект', 'объекта', 'объектов') + ' и ' + cls.length + ' ' +
          plural(cls.length, 'клиент', 'клиента', 'клиентов') + ': ' +
          cls.map((c) => c.name).join(', ') + '.';
      } },

    { id: 'ins_yield_gap',
      title() {
        const rows = oppMarket();
        const below = rows.filter((m) => m.доходностьПроцент < MARKET_YIELD_AVG).length;
        return below + ' ' + plural(below, 'район', 'района', 'районов') + ' из ' + rows.length +
          ' в нашем срезе дают доходность ниже средней по рынку';
      },
      kind: 'наш срез',
      src: 'Средняя доходность по Дубаю в первом полугодии 2026 — около ' + MARKET_YIELD_AVG + '%.',
      url: 'https://www.bhomes.com/en/blog/definitive-guides/will-property-prices-rise-or-fall-in-2026-best-case-base-case-and-worst-case-forecasts-dubai-market',
      until: 'до следующего среза',
      move: 'Инвестору, для которого доходность и есть цель, наш инвентарь стоит подавать через рост и ликвидность, а не через поток. Либо расширять географию.',
      see() {
        const rows = oppMarket();
        if (!rows.length) return null;
        const below = rows.filter((m) => m.доходностьПроцент < MARKET_YIELD_AVG);
        const above = rows.filter((m) => m.доходностьПроцент >= MARKET_YIELD_AVG);
        const best = rows.slice().sort((a, b) => b.доходностьПроцент - a.доходностьПроцент)[0];
        const eyes = insClients().filter((c) => c.interest === 'invest').length;
        return below.length + ' из ' + rows.length + ' районов ниже рынка' +
          (above.length ? '; выше — ' + above.map((m) => m.район).join(', ') : '; выше нет ни одного') +
          '. Лучший в срезе — ' + best.район + ', ' + best.доходностьПроцент + '%' +
          (insClients().some((c) => (c.areas || []).indexOf(best.район) >= 0) ? '' : ', и туда не смотрит ни один клиент') +
          '. Инвесторов в базе — ' + eyes + '.';
      } },

    { id: 'ins_ltv',
      title: 'Центробанк ограничивает кредит нерезиденту 65%, строящееся — половиной',
      kind: 'факт',
      src: 'Потолки кредита задаёт Центробанк ОАЭ: резидент-экспат до 80% на жильё дешевле 5 млн, нерезидент — 50–65%; строящееся большинство банков кредитует не более чем наполовину.',
      url: 'https://www.engelvoelkers.com/ae/en/resources/dubai-mortgage-for-non-residents',
      until: 'до изменения правил Центробанка',
      move: 'Спрашивать про финансирование ДО подборки: клиент с наличными смотрит объекты вдвое дешевле того, что ему доступно с кредитом.',
      see() {
        const cash = insClients().filter((c) => c.residency === 'non-resident' && c.payment === 'cash' && c.budget);
        if (!cash.length) return null;
        return cash.map((c) => c.name + ': ' + WS.AED(c.budget) + ' своими — с плечом потолок около ' +
          WS.AED(c.budget * 2)).join('; ') + '.';
      } },

    { id: 'ins_three_brokers',
      title: 'Собственник может подписать Form A максимум с тремя агентствами',
      kind: 'факт',
      src: 'Собственник может выставить объект не более чем через три зарегистрированных агентства, и у каждого должен быть подписанный Form A. Реклама без действующего разрешения — штраф до 50 тысяч дирхам за нарушение.',
      url: 'https://joinoliva.com/en/learn/blog/dubai-real-estate-brokerage-regulations-2026',
      until: 'до следующего циркуляра RERA',
      move: 'В разговоре с собственником это довод в пользу эксклюзива: право продавать — ограниченный ресурс, а не формальность.',
      see() {
        const mandates = (D().deals || []).filter((d) => /мандат|эксклюзив/i.test(String(d.title) + ' ' + String(d.sub || '')));
        const owners = insClients().filter((c) => c.ctype === 'owner');
        if (!mandates.length && !owners.length) return null;
        return 'У нас ' + mandates.length + ' ' + plural(mandates.length, 'мандат', 'мандата', 'мандатов') +
          ' и ' + owners.length + ' ' + plural(owners.length, 'собственник', 'собственника', 'собственников') +
          ' в работе: ' + owners.map((c) => c.name).join(', ') + '.';
      } },

    { id: 'ins_form_f',
      title: 'RERA принимает Form F в электронном виде с января 2026',
      kind: 'факт',
      src: 'Договор между покупателем и продавцом подписывается электронно через смарт-сервисы Земельного департамента.',
      url: 'https://nexconsultants.com/dubai-real-estate-laws-latest-dld-rera-updates/',
      until: 'до следующего циркуляра RERA',
      move: 'Снимает возражение «это долго и муторно»: между «договорились» и «зарегистрировали» стало меньше шагов и поездок.',
      see() {
        const live = (D().deals || []).filter((d) => !dealClosed(d) && !dealArchived(d) &&
          ['prep', 'book', 'sign'].indexOf(d.stage) >= 0);
        if (!live.length) return null;
        return live.length + ' ' + plural(live.length, 'сделка идёт', 'сделки идут', 'сделок идут') +
          ' на стадиях до регистрации — их всех это касается.';
      } },

    { id: 'ins_escrow',
      title: 'Застройщик снимает деньги с эскроу только по подтверждённым вехам',
      kind: 'факт',
      src: 'Правила эскроу ужесточены: доступ застройщика к деньгам покупателя привязан к проверенным вехам строительства, за задержку сдачи предусмотрены договорные санкции.',
      url: 'https://www.kaizenams.com/dubais-off-plan-buyer-protections-in-2026-what-the-tightened-escrow-rules-mean-for-residents-buying-new-homes/',
      until: 'до изменения правил эскроу',
      move: 'Готовый ответ на «а вдруг не достроят»: деньги не уходят застройщику разом, и это можно показать по графику.',
      see() {
        const off = (D().objects || []).filter((o) => o.segment === 'off-plan' && o.handover);
        if (!off.length) return null;
        return off.length + ' ' + plural(off.length, 'наш объект', 'наших объекта', 'наших объектов') +
          ' строятся: ' + off.map((o) => oppShort(o) + ' — сдача ' + o.handover).join('; ') + '.';
      } },
  ];
  function pulseInsights() {
    return INSIGHTS.map((x) => {
      let see = null, title = x.title;
      try { see = x.see(); } catch (e) { see = null; }
      try { if (typeof title === 'function') title = title.call(x); } catch (e) { title = ''; }
      return (see && title) ? Object.assign({}, x, { seen: see, title: title }) : null;
    }).filter(Boolean);
  }
  function insightCards() {
    const list = pulseInsights();
    if (!list.length) {
      return '<div class="card" style="padding:16px;font-size:12.5px;color:var(--mut)">Инсайтов сейчас нет: ни одна гипотеза не нашла применения в базе. Как только появится клиент или объект, к которому она относится, карточка встанет сюда.</div>';
    }
    return '<div class="ins-list">' + list.map((x) =>
      '<article class="ins"><header class="ins-h">' +
      '<span class="ins-kind">' + escAttr(x.kind) + '</span>' +
      '<span class="ins-until">' + escAttr(x.until) + '</span></header>' +
      '<h4 class="ins-t">' + escAttr(x.title) + '</h4>' +
      '<div class="ins-row"><span class="opp-lbl">' + I('radar') + 'Откуда</span>' +
      '<p>' + escAttr(x.src) + ' <a href="' + escAttr(x.url) + '" target="_blank" rel="noopener">источник' + I('arrowRight') + '</a></p></div>' +
      '<div class="ins-row is-ours"><span class="opp-lbl">' + I('users') + 'У нас</span>' +
      '<p>' + escAttr(x.seen) + '</p></div>' +
      '<div class="ins-row"><span class="opp-lbl">' + I('target') + 'Ход</span>' +
      '<p>' + escAttr(x.move) + '</p></div>' +
      '</article>').join('') + '</div>';
  }
  function insightsBlock() {
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0;display:flex;align-items:center;gap:8px">Инсайты <span class="badge ai-b">' + I('sparkle') + 'собрано AI</span></div>' +
      '<button class="btn sm" data-nav="concierge">' + I('chat') + 'Спросить Консьержа</button></div>' + insightCards();
  }
  // Качество источника — одна лента для «канонических метрик» руководителя и вкладки «Заявки»
  // на Пульсе агента. Две копии этой таблицы разошлись бы при первой же правке формулы.
  function srcQualityList() {
    const rows = computeMetrics().attribution.map((a) => {
      // Конверсия считает ВЫИГРАННЫЕ сделки. Раньше сюда шли все, включая проигранные, и
      // проигрыш поднимал показатель, названный конверсией.
      const won = (D().deals || []).filter((x) => x.source === a.source && dealWon(x)).length;
      const conv = a.leads ? Math.round((won / a.leads) * 100) : 0;
      return '<button class="src-row" data-analytics="src:' + a.source + '"><span class="sn">' + a.source + '</span><span class="sc">' + conv + '% · ' + won + '/' + a.leads + '</span><span class="scomm">' + WS.AED(a.commission) + '</span></button>';
    }).join('');
    return '<div class="src-list">' + rows + '</div>';
  }
  function canonMetrics() {
    const m = computeMetrics();
    const mtile = (label, val, sub, act) => '<button class="mtile" ' + act + '><div class="ml">' + label + '</div><div class="mv">' + val + '</div><div class="ms">' + sub + '</div></button>';
    const loss = LOSS_REASONS.map((l) => '<div class="loss-row"><span>' + l.r + '</span><span class="badge">' + l.n + '</span></div>').join('');
    return '<div class="section-label" style="margin-top:24px">Аналитика · канонические метрики <span class="badge demo">' + I('lock') + 'демо</span></div>' +
      '<div class="mtiles">' +
      /* На одном экране стояло «12 закрытых сделок» (плитка отдела), «11 из 70 лидов»
         (конверсия) и «Закрыто сделок 1» — три разных счёта одного и того же, а внизу блока
         обещание «одинаковый запрос → одинаковые числа». Числа при этом верны каждое: книга
         квартала перенесена в стенд итогом, и записей за ней нет; в самом стенде закрыта
         одна сделка. Противоречия нет там, где у числа названа его область, — и вот она. */
      mtile('Конверсия заявка → сделка', m.conv + '%', m.won + ' из ' + m.leads + ' лидов · книга квартала', 'data-analytics="conv"') +
      mtile('Ожидаемая комиссия', WS.AED(m.expectedComm), 'из сделок в работе', 'data-analytics="pipeline"') +
      mtile('Закрыто в самом стенде', m.closedCount, (m.closedSum ? WS.AED(m.closedSum) : '—') +
        ' · за квартал по книге — ' + m.won, 'data-analytics="closed"') +
      '</div>' +
      '<div class="section-label" style="margin-top:14px">Качество источника</div>' + srcQualityList() +
      '<div class="section-label" style="margin-top:14px">Причины проигрыша</div><div class="loss-list">' + loss + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:8px">Одинаковый запрос → одинаковые числа. Клик по цифре — до записей. Комиссия платформы не показывается.</div>';
  }
  /* Срок сделки от заведения до закрытия — по её же записям. «updated» у закрытой сделки и
     есть дата закрытия: «29 апреля» читается как дата, «вчера» — как вчера. */
  function dealCycleDays(d) {
    const c = createdOn(d); if (!c) return null;
    const now = demoNow();
    const today = dayOfYear(now.d, now.mo);
    const u = insDayOf(d.updated);
    const end = u != null ? u : (/вчера/i.test(String(d.updated || '')) ? today - 1 : today);
    return Math.max(0, end - dayOfYear(c.day, c.mo));
  }
  function openAnalyticsDrill(kind) {
    const deals = D().deals || [];
    let title = 'Записи', rows = '', note = '', cycle = false;
    if (kind === 'overdue') {
      const list = (D().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue');
      title = 'Просроченные задачи';
      rows = list.map((t) => { const c = D().clients.find((x) => x.id === t.clientId) || {}; return '<div class="feed-row" data-client="' + t.clientId + '" style="cursor:pointer"><div class="fi i-stop">' + I('warn') + '</div><div class="ft"><div class="t">' + t.title + '</div><div class="m">' + (c.name || '') + ' · ' + t.due + '</div></div>' + I('arrowRight') + '</div>'; }).join('');
    } else {
      let list = deals;
      if (kind === 'closed') { title = 'Успешные сделки'; list = deals.filter(dealWon); }
      else if (kind === 'hot') { title = 'Горячие сделки · SLA < 2 ч'; list = deals.filter((d) => d.hot); }
      else if (kind === 'conv' || kind === 'pipeline') { title = 'Активные сделки'; list = deals.filter((d) => !dealClosed(d) && !dealArchived(d)); }
      else if (kind === 'lost') { title = 'Проигранные сделки'; list = deals.filter((d) => d.stage === 'lost'); }
      else if (kind === 'cycle') { title = 'Из чего считается средний цикл'; list = deals.filter(dealClosed); cycle = true; }
      else if (kind.indexOf('src:') === 0) { const s = kind.slice(4); title = 'Сделки · источник «' + s + '»'; list = deals.filter((d) => d.source === s); }
      rows = list.map((d) => {
        const dc = cycle ? dealCycleDays(d) : null;
        const m2 = stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + (d.source ? ' · ' + d.source : '') +
          (dc != null ? ' · ' + oppDays(dc) + ' от заведения до закрытия' : '');
        return '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + d.title + '</div><div class="m">' + m2 + '</div></div>' + I('arrowRight') + '</div>';
      }).join('');
      /* Число на плитке — среднее по книге квартала, а строк за ним в стенде нет: закрытых
         сделок здесь две, и их собственный средний срок другой. Раскрытие обязано это
         сказать, иначе оно объясняет цифру записями, из которых она не считалась. */
      if (cycle) {
        const own = list.map(dealCycleDays).filter((x) => x != null);
        const mean = own.length ? Math.round(own.reduce((a2, b2) => a2 + b2, 0) / own.length) : null;
        const book = (D().analytics || {}).avgCycleDays;
        note = '<div class="prov" style="margin-bottom:10px"><span class="badge warn">' + I('lock') +
          book + ' ' + plural(book, 'день', 'дня', 'дней') + ' — среднее по книге квартала: строк за ним в стенде нет' +
          (mean != null ? '. В самом стенде закрыто ' + list.length + ' ' +
            plural(list.length, 'сделка', 'сделки', 'сделок') + ', их средний срок — ' + oppDays(mean) : '') +
          '</span></div>';
      }
    }
    openModal(title, note + (rows ? '<div class="card"><div class="feed" style="padding:2px 16px">' + rows + '</div></div>' : '<div class="card pad" style="color:var(--faint)">нет записей</div>'), '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  // R10: immutable audit journal (separate from export/portability).
  function openAuditLog() {
    const data = D(); const src = (WS.fixtures.dealTimeline || {}); const entries = [];
    Object.keys(src).forEach((did) => { const d = (data.deals || []).find((x) => x.id === did) || {}; (src[did] || []).forEach((e) => entries.push({ at: e.at, who: e.by, what: e.text, deal: d.title || did })); });
    const rows = entries.map((e) => '<div class="feed-row"><div class="fi i-mut">' + I('lock') + '</div><div class="ft"><div class="t">' + e.what + '</div><div class="m">' + e.at + ' · ' + e.who + ' · ' + e.deal + '</div></div></div>').join('') || '<div style="color:var(--faint);padding:12px">журнал пуст</div>';
    openModal('Аудит-журнал',
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Экспорт — портируемость (.xlsx); аудит — отдельный неизменяемый журнал. Записи не редактируются и не удаляются.</p>' +
      '<div class="card"><div class="feed" style="padding:2px 16px">' + rows + '</div></div><div class="prov" style="margin-top:8px"><span class="badge demo">' + I('lock') + 'append-only · демо</span></div>',
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  // Personal "next best action" feed — what the Concierge recommends doing now (formal, action-first).
  function nbaFeed() {
    const items = [
      { ic: 'doc', t: 'Согласовать предложение', why: 'Ожидает решения клиента, сроки сжимаются', nav: 'clients' },
      { ic: 'calendar', t: 'Пригласить на встречу', why: 'Клиент проявил интерес, окно свободно в 14:00', nav: 'shows' },
      { ic: 'building', t: 'Отправить подборку объектов', why: 'Критерии уточнены, пять вариантов подготовлены', nav: 'calc' },
      { ic: 'money', t: 'Произвести оценку доходности', why: 'Нужна для переговоров, данные собраны', nav: 'finance' },
      { ic: 'phone', t: 'Возобновить переговоры', why: 'Нет контакта неделю, ранее клиент был активен', nav: 'clients' },
      { ic: 'users', t: 'Обновить контактные данные', why: 'Номер телефона неактуален, требуется перезвонить', nav: 'clients' },
    ];
    const rows = items.map((a) => '<button class="nba-row" data-nav="' + a.nav + '">' +
      '<span class="nba-i">' + I(a.ic) + '</span>' +
      '<span class="nba-tx"><span class="nba-t">' + a.t + '</span><span class="nba-w">' + a.why + '</span></span>' +
      I('arrowRight') + '</button>').join('');
    return '<div class="section-label" style="margin-top:22px">Рекомендуемые действия <span class="badge acc">' + I('sparkle') + 'Консьерж</span></div>' +
      '<div class="nba-feed">' + rows + '</div>';
  }
  // ---- Пульс агента: разделы по схеме партнёра ---------------------------------------------
  // Взято РАСПОЛОЖЕНИЕ СОДЕРЖАНИЯ — цели сверху, «Мои дела», «Перспективные сделки», аналитика
  // пятью темами. Рисунок остался наш: плитки, ленты и сегменты, которые мы выверяли три волны.
  // Ни одно число не перенесено из макета — всё считается по данным стенда.
  function pulseHead(title, right) {
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0">' + title + '</div>' +
      (right || '') + '</div>';
  }
  // ---- Пульс: разделы блоками, каждый сворачивается --------------------------------------------
  // Схема партнёра держит разделы левым списком. Список забирает четверть ширины и оставляет
  // рабочую область в одном экране на семь тем. Взято его РАЗБИЕНИЕ, а не рисунок: те же разделы
  // стоят блоками сверху вниз, каждый сворачивается, и свёрнутый занимает одну строку.
  // Свёрнуто через <details> — раскрывается без скрипта, как и левая колонка карточки сделки.
  /* Раскрытый раздел — это выбор пользователя, и он обязан пережить уход в карточку и
     возврат. Раньше `<details>` перерисовывался с нуля, и «Аналитика», открытая минуту
     назад, встречала закрытой. Состояние хранится по ключу раздела; умолчание остаётся
     умолчанием только до первого касания. */
  /* ==== Разделы Пульса — корешки, а не лента ==============================================
     Четыре раздела стояли друг под другом свёртками: чтобы дойти до аналитики, надо было
     проехать четыре с половиной тысячи пикселей мимо двенадцати возможностей. Принципал
     сказал переключать их вкладками — и это отменяет прежнее решение «блоками, а не левым
     списком»: тогда разделов было семь и левый список съедал четверть ширины, сейчас их
     четыре и они помещаются в узкий столбец.

     На корешке стоит ЧИСЛО. Пасечник не читает улей целиком — он вынимает одну рамку; но
     выбрать рамку вслепую нельзя, поэтому на каждой написано, что внутри. Красная точка —
     есть просроченное или горящее: она решает, какую рамку вынуть первой.

     У «Аналитики» числа нет намеренно: там нечего считать штуками, и «4» рядом с ней
     означало бы четыре чего-то, чего не существует. */
  const PULSE_SECTIONS = ['day', 'prospects', 'insights', 'analytics'];
  function pulseSection() {
    const k = S().pulseSection;
    return PULSE_SECTIONS.indexOf(k) >= 0 ? k : 'day';
  }
  function pulseNav(items) {
    return '<nav class="psec-nav" aria-label="Разделы Пульса">' + items.map((it) =>
      '<button class="psec-tab' + (pulseSection() === it.key ? ' on' : '') +
      '" data-act="pulseSection" data-section="' + it.key + '"' +
      (pulseSection() === it.key ? ' aria-current="page"' : '') + '>' +
      I(it.icon) + '<span class="psec-t">' + escAttr(it.title) + '</span>' +
      (it.count != null ? '<span class="psec-n">' + it.count + '</span>' : '') +
      (it.urgent ? '<span class="psec-dot" title="есть срочное"></span>' : '') +
      '</button>').join('') + '</nav>';
  }
  function pulseSectionBody(items) {
    const cur = items.find((x) => x.key === pulseSection()) || items[0];
    return '<section class="psec-body">' +
      '<header class="psec-h"><h2>' + escAttr(cur.title) + '</h2>' +
      (cur.sub ? '<span class="psec-sub">' + cur.sub + '</span>' : '') + '</header>' +
      cur.body() + '</section>';
  }
  function pulseBlock(key, title, sub, body, openByDefault) {
    const kept = (S().pulseOpen || {})[key];
    const isOpen = kept === undefined ? openByDefault : kept;
    return '<details class="pblock"' + (isOpen ? ' open' : '') + ' data-pblock="' + key + '">' +
      '<summary><span class="pb-t">' + title + '</span>' +
      (sub ? '<span class="pb-m">' + sub + '</span>' : '') + I('chevDown') + '</summary>' +
      '<div class="pb-body">' + body + '</div></details>';
  }

  // ---- «Мои дела» — ежедневник ------------------------------------------------------------------
  // Партнёр описал состав строки дословно: дата · кликабельное название сделки или заявки ·
  // контакт · описание события · тип. Всё сюда стекается из карточек — задачи и записи календаря.
  // Тип дела — не просто подпись, а свой цвет: агент читает столбец боковым зрением и должен
  // отличать звонок от встречи, не вчитываясь. Третий элемент — класс окраски.
  const DAY_KIND = {
    touch: ['Коммуникация', 'chat', 'k-msg'], call: ['Звонок', 'phone', 'k-call'], kp: ['Задача', 'doc', 'k-task'],
    doc: ['Задача', 'doc', 'k-task'], task: ['Задача', 'check', 'k-task'], show: ['Встреча', 'calendar', 'k-meet'],
    meet: ['Встреча', 'calendar', 'k-meet'], visit: ['Встреча', 'calendar', 'k-meet'], mail: ['Коммуникация', 'mail', 'k-msg'],
  };
  const DAY_WHEN_ORD = { overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4 };
  /* Срок события записан словами и временем — «сегодня 16:00», «завтра 11:30». Разбор срока
     знал только голые ключи, поэтому ВСЯКОЕ датированное событие падало в «потом»: звонок,
     назначенный на сегодня на четыре часа дня, не попадал в фильтр «На сегодня» и был виден
     только во «Всех». Для ежедневника это не мелочь — это ровно то, ради чего его открывают. */
  function dayBucket(w) {
    const t = String(w || '').toLowerCase().trim();
    if (DAY_WHEN_ORD[t] != null) return t;
    if (/^сегодня/.test(t)) return 'today';
    if (/^завтра/.test(t)) return 'tomorrow';
    if (/^(вчера|позавчера)/.test(t) || /просроч/.test(t)) return 'overdue';
    if (/^(послезавтра|на этой неделе)/.test(t)) return 'week';
    return 'later';
  }
  // Время внутри срока — для порядка в ленте дня. Нет времени — событие идёт после тех, у кого оно есть.
  function dayTime(w) {
    const m = /(\d{1,2}):(\d{2})/.exec(String(w || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  /* ==== Строка утра ======================================================================
     Первое, что видит брокер, открыв стенд, — не приборная панель, а одно предложение: кто
     ждёт ответа и сколько именно. Обращение, оставшееся без ответа, — единственный случай,
     где счёт идёт на часы: лид уходит не к тому, кто лучше, а к тому, кто раньше.

     Если ждущих нет — строки НЕТ ВОВСЕ. Зелёное «всё в порядке» занимает то же место и
     обесценивает случай, когда строка появится по делу. */
  function inboxWaitMin(it) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String((it && it.at) || '').trim());
    if (!m) return null;
    const now = demoNow();
    let d = (now.h * 60 + now.mi) - (parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
    // Написали вечером, читаем утром: отрицательная разница — это прошлая ночь, а не будущее.
    if (d < 0) d += 24 * 60;
    return d;
  }
  function waitLabel(min) {
    if (min == null) return '';
    if (min < 60) return min + ' ' + plural(min, 'минуту', 'минуты', 'минут');
    const h = Math.floor(min / 60), r = min % 60;
    return h + ' ' + plural(h, 'час', 'часа', 'часов') +
      (r ? ' ' + r + ' ' + plural(r, 'минуту', 'минуты', 'минут') : '');
  }
  // Неотвеченные, самый давний первым. Обращение без разобранного времени не притворяется
  // свежим — оно уходит в конец и показывает не длительность, а момент.
  function inboxWaiting() {
    return (D().inbox || []).filter((i) => i.stage === 'unreached')
      .map((i) => ({ it: i, wait: inboxWaitMin(i) }))
      .sort((a, b) => (b.wait == null ? -1 : b.wait) - (a.wait == null ? -1 : a.wait));
  }
  function pulseMorningRow() {
    const q = inboxWaiting();
    if (!q.length) return '';
    const top = q[0], it = top.it;
    const c = it.clientId ? oppClient(it.clientId) : null;
    const who = c ? c.name : 'Обращение без карточки контакта';
    const meta = [chanMeta(it.channel)[1] + ', ' + escAttr(it.at),
      c && c.budget ? WS.AED(c.budget) : null,
      c && (c.areas || []).length ? escAttr((c.areas || [])[0]) : null].filter(Boolean).join(' · ');
    const how = top.wait != null
      ? 'ждёт ответа ' + waitLabel(top.wait)
      : 'ждёт ответа с ' + escAttr(it.at);
    const rest = q.length - 1;
    return '<div class="morn-wrap">' +
      '<button class="morn" ' + (c ? 'data-act="answerInbox" data-inbox="' + it.id + '"' : 'data-nav="requests"') +
      ' title="Собрать ответ клиенту">' +
      '<span class="morn-ic">' + I('clock') + '</span>' +
      '<span class="morn-t"><b>' + escAttr(who) + ' — ' + how + '</b>' +
      '<span class="morn-m">' + meta + '</span></span>' +
      '<span class="morn-go">' + (c ? 'Собрать ответ' : 'Открыть входящие') + I('arrowRight') + '</span></button>' +
      (rest > 0
        ? '<button class="morn-more" data-nav="requests">и ещё ' + rest + ' без ответа</button>'
        : '') +
      '</div>';
  }
  /* ==== Окно «Ответ клиенту» =============================================================
     Второй шаг утра. Между «вижу, что человек ждёт» и «человек получил ответ» лежала дыра,
     которую брокер проходил вне стенда: открывал WhatsApp и писал с нуля.

     Три правила этого окна:
     1. Язык ответа — язык клиента, и это видно словами. Сегодня это лежало заметкой в
        заявке («клиент пишет по-английски»); заметку читает человек, а правило исполняет
        система.
     2. Согласие показывается с датой и сроком, а не галочкой. Истёкшее блокирует так же,
        как отсутствующее, и говорит об этом иначе — человек не отказывался.
     3. Клиенту — факты, брокеру — предупреждение. Отклонение цены от индекса района в
        письмо не идёт: это довод для разговора, а не строка в предложении. Оно стоит рядом
        с объектом с пометкой, что видно только своим. */
  function replyPicks(c) {
    if (!c) return [];
    return oppFreeObjects([]).filter((o) => (c.areas || []).indexOf(o.area) >= 0 &&
      (o.price || 0) <= (c.budget || 0) * 1.05 && oppTypeFit(c, o))
      .sort((a, b) => oppComm(b) - oppComm(a)).slice(0, 2);
  }
  /* Сумма в письме набрана на языке письма. «1 300 000 AED» внутри английского текста —
     мелочь, которую клиент не назовёт, но заметит: это чужая типографика в своём письме. */
  function aedIn(n, en) {
    return en ? 'AED ' + Number(n || 0).toLocaleString('en-US') : WS.AED(n);
  }
  function replyDraft(c, it, picks, withObjects) {
    const en = String((c && c.lang) || 'RU').toUpperCase() === 'EN';
    const first = String((c && c.name) || '').split(' ')[0];
    const money = (o) => aedIn(o.price, en) + ' (' + aedIn(Math.round(o.price / o.size), en) + (en ? ' per m²)' : ' за м²)');
    const line = (o) => '— ' + o.name + ' · ' + o.br + ' · ' + o.size + (en ? ' m² · ' : ' м² · ') + money(o);
    if (en) {
      const body = [
        'Good morning, ' + first + '.',
        'Apologies for the delay — your message came in at ' + it.at + ', and I am on it now.',
      ];
      if (withObjects && picks.length) {
        body.push('Two options in ' + ((c.areas || [])[0] || 'the area') + ' within ' + aedIn(c.budget, true) + ':');
        picks.forEach((o) => body.push(line(o)));
        body.push('Both are available as of today. Would 11:00 or 15:00 tomorrow suit you for a viewing?');
      } else {
        body.push('Could you confirm the area and the timeline? I will put a shortlist together today.');
      }
      body.push('Marina, WESPACE');
      return body.join('\n');
    }
    const body = [
      'Доброе утро, ' + first + '.',
      'Извините за паузу — ваше сообщение пришло в ' + it.at + ', беру в работу сейчас.',
    ];
    if (withObjects && picks.length) {
      body.push('Два варианта в ' + ((c.areas || [])[0] || 'вашем районе') + ' в бюджете ' + WS.AED(c.budget) + ':');
      picks.forEach((o) => body.push(line(o)));
      body.push('Оба свободны на сегодня. Удобно посмотреть завтра в 11:00 или в 15:00?');
    } else {
      body.push('Подтвердите, пожалуйста, район и сроки — соберу подборку сегодня же.');
    }
    body.push('Марина, WESPACE');
    return body.join('\n');
  }
  function openReplyDraft(inboxId, textOnly) {
    const it = (D().inbox || []).find((x) => x.id === inboxId);
    if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null;
    const st = consentState(c);
    const wait = inboxWaitMin(it);
    const en = String((c && c.lang) || 'RU').toUpperCase() === 'EN';
    const picks = textOnly ? [] : replyPicks(c);
    const left =
      '<div class="rw-side">' +
      '<div class="rw-lbl">' + I('chat') + 'Что написал клиент</div>' +
      '<div class="rw-quote">«' + escAttr(it.text || '') + '»<span>' +
      chanMeta(it.channel)[1] + ', ' + escAttr(it.at) +
      (wait != null ? ' · без ответа ' + waitLabel(wait) : '') + '</span></div>' +
      (c
        ? '<div class="rw-lbl" style="margin-top:14px">' + I('users') + 'Карточка клиента</div>' +
          '<div class="opp-b"><span class="k">Бюджет</span><span class="v">' +
          (c.budget ? WS.AED(c.budget) : 'не назван') + '</span></div>' +
          '<div class="opp-b"><span class="k">Районы</span><span class="v">' +
          ((c.areas || []).join(', ') || 'не названы') + '</span></div>' +
          '<div class="opp-b"><span class="k">Интерес</span><span class="v">' +
          (CONTACT_INTEREST_LABEL[c.interest] || '—') + '</span></div>' +
          '<div class="opp-b"><span class="k">Согласие</span><span class="v' +
          (st.state === 'none' || st.state === 'expired' ? ' rw-stop' : '') + '">' +
          consentLineShort(c) + '</span></div>'
        : '<div class="rw-quote" style="margin-top:14px">Карточки контакта нет — сначала заведите контакт.<span>без карточки отправка невозможна</span></div>') +
      '</div>';
    /* Без действующего согласия окно НЕ показывает черновик. Показать текст, который нельзя
       отправить, значит предложить его скопировать в мессенджер — то есть обойти правило
       руками, ровно то, ради чего правило и существует. */
    const blocked = !c || st.state === 'none' || st.state === 'expired';
    const right = blocked
      ? '<div class="rw-main"><div class="rw-blocked">' + I('lock') +
        /* Заголовок называет состояние, подпись говорит, что с этим делать. Повторять
           заголовок другими словами — значит потратить строку, которую человек прочтёт. */
        '<div><b>' + (st.state === 'expired' ? 'Срок согласия истёк' : 'Согласия на связь нет') + '</b>' +
        '<span>' + (!c
          ? 'У обращения нет карточки контакта — заведите контакт, и ответ соберётся.'
          : st.state === 'expired'
            ? 'Согласие от ' + escAttr(c.consentAt || '—') + ' действовало до ' + escAttr(c.consentUntil || '—') +
              '. Это не отказ — истёк срок, и его нужно переполучить.'
            : 'Адресные отправки заблокированы. Сначала — согласие, ответ идёт следом и уже законно.') +
        '</span></div></div></div>'
      : '<div class="rw-main">' +
        '<div class="rw-lang">' + I('globe') + 'язык ответа: ' + (en ? 'английский' : 'русский') +
        ' — так пишет клиент</div>' +
        '<textarea id="replyText" class="rw-text" rows="11">' +
        escAttr(replyDraft(c, it, picks, !textOnly)) + '</textarea>' +
        (picks.length
          ? '<div class="rw-lbl" style="margin-top:12px">' + I('eye') + 'Видно только вам</div>' +
            picks.map((o) => {
              const dv = insDeviation(o);
              const note = !dv ? 'индекса по этому сегменту в срезе нет'
                : dv.pct >= 5 ? 'на ' + dv.pct + '% выше среза ' + dv.area + ' — спросят на первом сравнении'
                : dv.pct <= -5 ? 'на ' + Math.abs(dv.pct) + '% ниже среза ' + dv.area + ' — сильный довод'
                : 'в коридоре среза ' + dv.area;
              return '<div class="opp-b"><span class="k">' + escAttr(o.name) + '</span><span class="v">' +
                note + '</span></div>';
            }).join('')
          : '') +
        '<div class="rw-prov">' + I('radar') + 'черновик собран из карточки клиента и свободного инвентаря · ' +
        'согласие проверено · отправка имитируется (DEMO)</div>' +
        '</div>';
    const foot = blocked
      ? (c ? '<button class="btn primary" data-client="' + c.id + '">' + I('users') + 'Открыть контакт</button>' : '') +
        '<button class="btn" data-act="closeModal">Закрыть</button>'
      : '<button class="btn primary" data-act="sendReply" data-inbox="' + it.id + '">' + I('send') + 'Отправить</button>' +
        '<button class="btn" data-act="openSelection" data-inbox="' + it.id + '">' +
        I('layers') + 'Показать подборку</button>' +
        '<button class="btn" data-act="replyTextOnly" data-inbox="' + it.id + '">' +
        I('doc') + (textOnly ? 'Вернуть объекты' : 'Только текст, без объектов') + '</button>' +
        '<button class="btn" data-act="closeModal">Закрыть</button>';
    openModal('Ответ клиенту', '<div class="rw">' + left + right + '</div>', foot, { wide: true });
  }
  function sendReply(inboxId) {
    const it = (D().inbox || []).find((x) => x.id === inboxId); if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null;
    // Та же проверка, что и у любой другой адресной отправки в стенде — не своя, отдельная.
    const audit = WS.audience.calculateAudience([{ id: it.id, clientId: it.clientId, channel: it.channel }]);
    if (!c || audit.excluded.length) {
      WS.storeApi.toast(((audit.excluded[0] || {}).reason || 'нет карточки контакта') + ' — отправка невозможна', 'warn');
      return;
    }
    const el = document.getElementById('replyText');
    const text = el ? String(el.value || '').trim() : '';
    if (!text) { WS.storeApi.toast('Пустой ответ отправить нельзя', 'warn'); return; }
    /* Ответ снимает обращение со стадии «не вышли на связь». Ставим «квалифицирована», а не
       «новое»: в сообщении уже названы бюджет, район и тип — квалифицировать нечего, и
       откатывать обращение в начало разбора значит терять то, что клиент уже сказал. */
    it.stage = 'qualified';
    const req = (D().requests || []).find((r) => r.clientId === c.id && reqStage(r) !== 'closed');
    const trace = req
      ? addEventEntry('request', req.id, { type: 'msg', text: 'Ответ отправлен — ' + c.name + '. Отправка имитируется (DEMO).' })
      : addEventEntry('contact', c.id, { type: 'msg', text: 'Ответ отправлен. Отправка имитируется (DEMO).' });
    if (trace) trace.moved = 'reply';
    WS.storeApi.touch();
    closeModal();
    WS.storeApi.toast('Ответ отправлен — ' + c.name, 'ok');
  }
  /* ==== Подборка как документ ============================================================
     Третий шаг утра. До сих пор «что предложить» существовало как строка в карточке
     возможности и как две строки внутри письма. То, что реально уходит клиенту — страница с
     фотографией, картой, ценой метра и планом оплаты, — собиралось руками в мессенджере.

     Документ показывает СВОЮ основу. Срез рынка в стенде иллюстративный, так помечено в самих
     данных, — и в документе, который клиент понесёт сравнивать, это обязано стоять словами.
     Иначе цифра «на 10% ниже среза» читается как биржевая котировка.

     Отклонение от индекса здесь ПОКАЗЫВАЕТСЯ, в отличие от письма: письмо клиент читает с
     телефона за минуту, документ — сидя, и там сравнение уместно. В письме оно звучало бы как
     оценка чужого товара, здесь — как основание выбора. */
  function selectionFact(k, v) {
    return '<div class="sel-f"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }
  function selectionCard(o, c) {
    const dv = insDeviation(o);
    /* Фотография — ТОЛЬКО своя. Подстановка общей давала две одинаковые картинки на двух
       разных юнитах и выдавала чужой кадр за этот объект: в документе, который клиент понесёт
       на просмотр, это ровно тот сочинённый факт, которого мы избегаем везде. Где своего
       снимка нет — карта во всю ширину: она у каждого объекта настоящая. */
    const ph = (WS.photos && WS.photos[o.id]) || '';
    const mp = (WS.maps && WS.maps[o.id]) || '';
    const perM = o.size ? Math.round(o.price / o.size) : 0;
    const dvLine = dv
      ? WS.AED(dv.per) + ' за м² · ' + (dv.pct === 0 ? 'вровень со срезом ' + dv.area
        : (dv.pct > 0 ? 'на ' + dv.pct + '% выше' : 'на ' + Math.abs(dv.pct) + '% ниже') + ' среза ' + dv.area)
      : (perM ? WS.AED(perM) + ' за м² · индекса по этому сегменту в срезе нет' : '—');
    const ready = o.segment === 'off-plan'
      ? 'строится, сдача ' + (o.handover || 'срок не назван')
      : (o.occupancy || 'готовое');
    return '<article class="sel-card">' +
      '<div class="sel-media' + (ph ? '' : ' sel-media--map') + '">' +
      (ph ? '<div class="sel-photo" style="background-image:url(' + ph + ')"></div>' : '') +
      (mp ? '<div class="sel-map" style="background-image:url(' + mp + ')"><span class="sel-pin"></span></div>' : '') +
      '</div>' +
      '<div class="sel-body"><h4>' + escAttr(o.name) + '</h4>' +
      '<div class="sel-sub">' + escAttr(o.area) + ' · ' + escAttr(o.br) + ' · ' + o.size + ' м²</div>' +
      selectionFact('Цена', '<b>' + WS.AED(o.price) + '</b>') +
      selectionFact('Цена метра', dvLine) +
      selectionFact('Готовность', escAttr(ready)) +
      (o.paymentPlan ? selectionFact('План оплаты', escAttr(o.paymentPlan)) : '') +
      (o.serviceCharge ? selectionFact('Обслуживание', escAttr(o.serviceCharge)) : '') +
      (o.match ? '<p class="sel-why">' + escAttr(o.match) + '</p>' : '') +
      '</div></article>';
  }
  /* «Что это значит» — три строки прямым текстом. Клиент, получивший две карточки без вывода,
     сравнивает их сам и обычно выбирает дешевле; строка вывода — это то, за что платят
     брокеру. Каждая строка выводится из чисел выше, а не написана заранее. */
  function selectionMeaning(objs, c) {
    const out = [];
    const dv = objs.map((o) => ({ o: o, d: insDeviation(o) })).filter((x) => x.d);
    if (dv.length >= 2) {
      const lo = dv.slice().sort((a, b) => a.d.pct - b.d.pct)[0];
      const hi = dv.slice().sort((a, b) => b.d.pct - a.d.pct)[0];
      if (lo.o !== hi.o) {
        out.push(lo.o.name + ' дешевле среза района на ' + Math.abs(lo.d.pct) + '%, ' +
          hi.o.name + ' — ' + (hi.d.pct >= 0 ? 'дороже на ' + hi.d.pct + '%' : 'дешевле на ' + Math.abs(hi.d.pct) + '%') +
          '. Разница в цене метра — ' + WS.AED(Math.abs(hi.d.per - lo.d.per)) + '.');
      }
    }
    objs.forEach((o) => {
      const lost = (D().deals || []).find((d) => d.stage === 'lost' && (d.objectId === o.id || (d.lots || []).indexOf(o.id) >= 0));
      if (lost) out.push(o.name + ' — тот объект, вокруг которого шла сделка «' + lost.title + '»; она не состоялась, объект снова свободен.');
    });
    if (c && c.budget) {
      const buy = objs.filter((o) => (o.price || 0) <= c.budget);
      if (buy.length) out.push('Бюджет ' + WS.AED(c.budget) + ' покрывает ' +
        (buy.length === objs.length ? 'оба варианта' : buy.map((o) => o.name).join(', ')) + ' на покупку.');
    }
    return out;
  }
  function selectionObjects(c) { return replyPicks(c); }
  function openSelection(inboxId) {
    const it = (D().inbox || []).find((x) => x.id === inboxId); if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null; if (!c) return;
    const objs = selectionObjects(c);
    /* Состав подборки ЗАПОМИНАЕТСЯ. Иначе перепроверка при отправке ничего не проверяет:
       список пересобирается заново, ушедший объект молча выпадает, и клиент получает не ту
       подборку, которую брокер прочитал. Тихая подмена хуже отказа — про отказ он узнает. */
    WS._sel = { inbox: it.id, ids: objs.map((o) => o.id) };
    const asOf = (oppMarket()[0] || {});
    const head = '<div class="sel-head"><div class="sel-for">Подборка для ' + escAttr(c.name) + '</div>' +
      '<div class="sel-req">' + (c.goal ? escAttr(c.goal) + ' · ' : '') +
      (c.budget ? 'бюджет ' + WS.AED(c.budget) : 'бюджет не назван') + ' · ' +
      ((c.areas || []).join(', ') || 'район не назван') + '</div></div>';
    /* Пустая подборка не притворяется подборкой. Если под запрос нет ни одного свободного
       объекта, документ говорит, чего именно не хватает, — так же, как это делает разбор
       доходности, когда в районе нет инвентаря. */
    const body = objs.length
      ? '<div class="sel-grid">' + objs.map((o) => selectionCard(o, c)).join('') + '</div>' +
        (selectionMeaning(objs, c).length
          ? '<div class="sel-mean"><div class="opp-lbl">' + I('target') + 'Что это значит</div>' +
            selectionMeaning(objs, c).map((t) => '<p>' + escAttr(t) + '</p>').join('') + '</div>'
          : '') +
        '<div class="sel-prov">' + I('radar') + 'Срез рынка ' + escAttr(asOf.asOf || '—') +
        ', ' + escAttr(asOf.basis || 'иллюстративно') + '. Доступность подтверждена на дату проверки объекта.</div>'
      : '<div class="sel-empty">' + I('warn') +
        '<div><b>Свободных объектов под этот запрос сейчас нет</b><span>Бюджет ' +
        (c.budget ? WS.AED(c.budget) : 'не назван') + ', районы ' + ((c.areas || []).join(', ') || 'не названы') +
        '. Собирать через партнёров или расширять район — придумывать варианты документ не будет.</span></div></div>';
    const foot = (objs.length
        ? '<button class="btn primary" data-act="sendSelection" data-inbox="' + it.id + '">' +
          I('send') + 'Отправить клиенту</button>'
        : '') +
      '<button class="btn" data-act="answerInbox" data-inbox="' + it.id + '">' + I('chevLeft') + 'Назад к письму</button>' +
      '<button class="btn" data-act="closeModal">Закрыть</button>';
    openModal('Подборка · то, что уйдёт клиенту', head + body, foot, { wide: true });
  }
  function sendSelection(inboxId) {
    const it = (D().inbox || []).find((x) => x.id === inboxId); if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null;
    const audit = WS.audience.calculateAudience([{ id: it.id, clientId: it.clientId, channel: it.channel }]);
    if (!c || audit.excluded.length) {
      WS.storeApi.toast(((audit.excluded[0] || {}).reason || 'нет карточки контакта') + ' — отправка невозможна', 'warn');
      return;
    }
    /* Доступность перепроверяется В МОМЕНТ ОТПРАВКИ, а не берётся из момента сборки. Между
       тем, как брокер собрал подборку, и тем, как он нажал «отправить», объект мог уйти —
       и письмо с занятым юнитом разваливается на первом же звонке владельцу. */
    /* Сверяем то, что брокер ВИДЕЛ, а не то, что подобралось бы сейчас. */
    const shown = (WS._sel && WS._sel.inbox === inboxId) ? WS._sel.ids : null;
    const objs = shown ? shown.map(oppObject).filter(Boolean) : selectionObjects(c);
    const gone = objs.filter((o) => o.availability !== 'available' || oppObjectBusy(o.id));
    if (!objs.length || gone.length) {
      WS.storeApi.toast(gone.length
        ? gone.map((o) => o.name).join(', ') + ' — объект уже занят, подборка пересобрана'
        : 'Свободных объектов под запрос нет — отправлять нечего', 'warn');
      openSelection(inboxId);
      return;
    }
    it.stage = 'qualified';
    const req = (D().requests || []).find((r) => r.clientId === c.id && reqStage(r) !== 'closed');
    const what = 'Отправлена подборка: ' + objs.map((o) => o.name).join(', ') + '. Отправка имитируется (DEMO).';
    const trace = req ? addEventEntry('request', req.id, { type: 'msg', text: what })
      : addEventEntry('contact', c.id, { type: 'msg', text: what });
    if (trace) trace.moved = 'selection';
    WS.storeApi.touch();
    WS.storeApi.toast('Подборка отправлена — ' + c.name, 'ok');
    // Подборка ушла — следующий шаг утра сам открывается, а не ищется в меню.
    openShowForm(inboxId);
  }
  function pulseDayItems() {
    const out = [];
    (D().tasks || []).forEach((t) => {
      if (t.status === 'done') return;
      out.push({ when: dayBucket(t.when || t.due), due: t.due || '—', at: dayTime(t.due || t.when),
        title: t.title || 'Задача', kind: t.kind || 'task', clientId: t.clientId, dealId: t.dealId,
        requestId: t.requestId, objectId: t.objectId || null });
    });
    (D().events || []).forEach((e) => {
      if (e.status === 'canceled') return;
      const w = e.when || e.at;
      if (!w) return;
      out.push({ when: dayBucket(w), due: w, at: dayTime(w), title: e.title || e.text || 'Событие',
        kind: e.kind || 'meet', clientId: e.clientId, dealId: e.dealId, requestId: e.requestId,
        objectId: e.objectId || null, evId: e.id, hasOutcome: showHasOutcome(e) });
    });
    return out.sort((a, b) => {
      const d = (DAY_WHEN_ORD[a.when] == null ? 9 : DAY_WHEN_ORD[a.when]) -
        (DAY_WHEN_ORD[b.when] == null ? 9 : DAY_WHEN_ORD[b.when]);
      if (d) return d;
      // Внутри одного срока — по времени; без времени идёт последним, а не первым.
      return (a.at == null ? 1e9 : a.at) - (b.at == null ? 1e9 : b.at);
    });
  }
  const DAY_FILTERS = [['today', 'На сегодня'], ['tomorrow', 'На завтра'], ['overdue', 'Просроченные'], ['all', 'Все']];
  /* ==== Вид «Днём» ======================================================================
     Таблица отвечает на вопрос «что у меня есть», лента дня — на вопрос «куда я сейчас еду».
     Это разные вопросы, и партнёрская таблица остаётся видом по умолчанию: её состав и
     порядок колонок он задал сам.

     Оценка дороги между точками — именно ОЦЕНКА и подписана словом. Настоящей маршрутизации
     у стенда нет: он знает район и адрес, но не пробки. Выдавать прикидку по району за расчёт
     значит обещать точность, которой неоткуда взяться. */
  const DAY_HOP_SAME = 10, DAY_HOP_OTHER = 35;
  /* Ездят только между делами, где нужно быть лично. Первая версия считала дорогу между
     двумя звонками и между звонком и задачей — то есть между делами, которые делаются с
     одного места. Оценка дороги там, где никто никуда не едет, обесценивает её там, где едут. */
  const DAY_ONSITE = { show: true, meet: true, visit: true };
  function dayOnsite(it) { return !!DAY_ONSITE[it && it.kind]; }
  function dayHop(a, b) {
    if (!a || !b) return null;
    return (a === b) ? DAY_HOP_SAME : DAY_HOP_OTHER;
  }
  function dayPlaceOf(it) {
    const o = it.objectId ? oppObject(it.objectId) : null;
    if (o) return { area: o.area, addr: o.address || o.name, map: (WS.maps || {})[o.id] || '' };
    const d = it.dealId ? (D().deals || []).find((x) => x.id === it.dealId) : null;
    const o2 = d && d.objectId ? oppObject(d.objectId) : null;
    if (o2) return { area: o2.area, addr: o2.address || o2.name, map: (WS.maps || {})[o2.id] || '' };
    return null;
  }
  function pulseDayLine(list) {
    if (!list.length) {
      return '<div class="empty" style="padding:22px">' + I('checkCircle') +
        '<div style="font-weight:700;color:var(--ink)">На этот срок дел нет</div></div>';
    }
    let prev = null;
    const rows = list.map((it) => {
      const c = it.clientId ? oppClient(it.clientId) : null;
      const pl = dayPlaceOf(it);
      const k = DAY_KIND[it.kind] || ['Задача', 'check', 'k-task'];
      const onsite = dayOnsite(it);
      const hop = (onsite && prev && pl && prev.area) ? dayHop(prev.area, pl.area) : null;
      if (onsite && pl) prev = pl;
      const gap = hop != null
        ? '<div class="dl-hop">' + I('chevDown') + 'дорога ≈ ' + hop + ' мин · оценка по району</div>'
        : '';
      return gap + '<div class="dl-row' + (it.when === 'overdue' ? ' is-late' : '') + '">' +
        '<div class="dl-when">' + escAttr(it.due) + '</div>' +
        '<div class="dl-body"><div class="dl-t">' + escAttr(it.title) + '</div>' +
        '<div class="dl-m"><span class="pd-kind ' + k[2] + '">' + I(k[1]) + k[0] + '</span>' +
        (c ? '<button class="lnk" data-client="' + c.id + '">' + escAttr(c.name) + '</button>' : '') +
        (pl ? '<span class="dl-ad">' + escAttr(pl.addr) + '</span>' : '') + '</div></div>' +
        (it.kind === 'show' && it.evId
          ? '<div class="dl-act">' + (it.hasOutcome
            ? '<span class="rel-tag">итог записан</span>'
            : '<button class="btn xs" data-act="showOutcome" data-ev="' + it.evId + '">' +
              I('mic') + 'Итог голосом</button>') + '</div>'
          : '') +
        (pl && pl.map
          ? '<div class="dl-map" style="background-image:url(' + pl.map + ')"><span class="sel-pin"></span></div>'
          : '') + '</div>';
    }).join('');
    return '<div class="dayline">' + rows + '</div>';
  }
  /* ==== Назначение показа ===============================================================
     Четвёртый шаг утра. Подборка ушла — дальше брокер зовёт смотреть, и до сих пор это
     происходило в мессенджере и в голове. Слоты предлагаются готовыми: набирать время руками
     в девять утра между двумя звонками никто не станет.

     Два объекта — два показа подряд, второй через полтора часа: столько занимает один показ
     с дорогой внутри района. Это допущение, и оно названо в самом окне. */
  const SHOW_SLOTS = [['сегодня 12:00', 'Сегодня, 12:00'], ['сегодня 14:30', 'Сегодня, 14:30'],
    ['завтра 11:00', 'Завтра, 11:00'], ['завтра 15:00', 'Завтра, 15:00']];
  const SHOW_GAP_MIN = 90;
  function showShift(when, minutes) {
    const m = /^(\S+)\s+(\d{1,2}):(\d{2})$/.exec(String(when || ''));
    if (!m) return when;
    const t = parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + minutes;
    return m[1] + ' ' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  function openShowForm(inboxId) {
    const it = (D().inbox || []).find((x) => x.id === inboxId); if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null; if (!c) return;
    const ids = (WS._sel && WS._sel.inbox === inboxId) ? WS._sel.ids : selectionObjects(c).map((o) => o.id);
    const objs = ids.map(oppObject).filter(Boolean);
    if (!objs.length) { WS.storeApi.toast('Показывать нечего — в подборке нет объектов', 'warn'); return; }
    const slots = SHOW_SLOTS.map((s, i) =>
      '<button class="chip' + (i === 0 ? ' on' : '') + '" data-showslot="' + escAttr(s[0]) + '">' +
      I('calendar') + s[1] + '</button>').join('');
    const rows = objs.map((o, i) => '<div class="opp-b"><span class="k">' + escAttr(o.name) +
      '</span><span class="v">' + escAttr(o.area) + ' · ' + escAttr(o.address || '') + '</span></div>').join('');
    openModal('Назначить показ · ' + escAttr(c.name),
      '<div class="rw-lbl">' + I('calendar') + 'Когда</div><div class="qa-row" style="margin-bottom:14px">' + slots + '</div>' +
      '<div class="rw-lbl">' + I('building') + 'Что показываем</div>' + rows +
      '<div class="rw-prov">' + I('radar') + 'Два показа подряд, второй через ' + SHOW_GAP_MIN +
      ' минут — допущение стенда: столько занимает один показ с дорогой внутри района.</div>',
      '<button class="btn primary" data-act="createShow" data-inbox="' + it.id + '">' +
      I('check') + 'Назначить</button><button class="btn" data-act="closeModal">Закрыть</button>',
      { wide: false });
    WS._showSlot = SHOW_SLOTS[0][0];
  }
  function createShow(inboxId) {
    const it = (D().inbox || []).find((x) => x.id === inboxId); if (!it) return;
    const c = it.clientId ? oppClient(it.clientId) : null; if (!c) return;
    const ids = (WS._sel && WS._sel.inbox === inboxId) ? WS._sel.ids : selectionObjects(c).map((o) => o.id);
    const objs = ids.map(oppObject).filter(Boolean);
    const slot = WS._showSlot || SHOW_SLOTS[0][0];
    const req = (D().requests || []).find((r) => r.clientId === c.id && reqStage(r) !== 'closed');
    (D().events || (D().events = [])).push.apply(D().events, objs.map((o, i) => ({
      id: 'e_show_' + o.id + '_' + ((D().events || []).length + i),
      clientId: c.id, requestId: req ? req.id : null, objectId: o.id,
      title: 'Показ · ' + o.name, when: showShift(slot, i * SHOW_GAP_MIN), kind: 'show',
    })));
    const trace = req && addEventEntry('request', req.id, { type: 'meet',
      text: 'Назначен показ: ' + objs.map((o) => o.name).join(', ') + ' — ' + slot + '.' });
    // Один след — один сдвиг, сколько бы объектов ни вошло в этот показ: строка считает
    // состояния, а не объекты, и «два показа» здесь были бы двойным счётом одного действия.
    if (trace) trace.moved = 'show';
    /* Открываем ленту дня: показ назначен ради того, чтобы он встал в маршрут, и брокер
       должен увидеть это сразу, а не искать переключатель вида. */
    S().dayView = 'line';
    S().pulseDay = /^завтра/.test(slot) ? 'tomorrow' : 'today';
    WS.storeApi.touch();
    closeModal();
    WS.storeApi.toast(objs.length + ' ' + plural(objs.length, 'показ назначен', 'показа назначено', 'показов назначено') +
      ' — ' + slot, 'ok');
  }
  /* ==== Итог показа ======================================================================
     Пятый шаг утра, и самый дешёвый: механизм уже был целиком — черновик итога, приёмка,
     отклонение со следом, голосовой ввод. Не хватало только привязки к показу.

     Записывается НЕ разговор, а заметка брокера — он диктует сам, в машине, после просмотра.
     Разница не юридическая казуистика: запись клиента требует его согласия, надиктованная
     заметка — нет, и окно говорит это словами, чтобы вопрос не возникал.

     Итог остаётся ЧЕРНОВИКОМ до подтверждения и до тех пор не участвует в выводах. Следующий
     шаг выводится не из надиктованного текста, а из записей — клиента и объекта: угадывать
     намерение по фразе значит выдавать догадку за вывод. Если вывести не из чего — строки
     следующего шага нет вовсе. */
  function showNextStep(ev) {
    const c = ev && ev.clientId ? oppClient(ev.clientId) : null;
    const o = ev && ev.objectId ? oppObject(ev.objectId) : null;
    if (!c || !o) return '';
    if (c.interest === 'rent' && (c.budget || 0) >= (o.price || 0)) {
      return 'Следующий шаг: расчёт покупки против аренды — бюджет ' + WS.AED(c.budget) +
        ' покрывает цену объекта.';
    }
    const dv = insDeviation(o);
    if (dv && dv.pct >= 5) {
      return 'Следующий шаг: подготовить ответ про цену — объект на ' + dv.pct + '% выше среза ' + dv.area + '.';
    }
    return '';
  }
  function showOutcomeScope(ev) {
    const req = (D().requests || []).find((r) => r.id === ev.requestId) ||
      (D().requests || []).find((r) => r.clientId === ev.clientId && reqStage(r) !== 'closed');
    if (req) return { scope: 'request', id: req.id };
    return ev.clientId ? { scope: 'contact', id: ev.clientId } : null;
  }
  function showHasOutcome(ev) {
    const sc = showOutcomeScope(ev); if (!sc) return false;
    return outcomesFor(sc.scope, sc.id).some((x) => x.factId === ev.id);
  }
  function openShowOutcome(evId) {
    const ev = (D().events || []).find((x) => x.id === evId); if (!ev) return;
    const o = ev.objectId ? oppObject(ev.objectId) : null;
    const next = showNextStep(ev);
    const canDictate = !!(WS.voice && WS.voice.canDictate && WS.voice.canDictate());
    openModal('Итог показа · ' + escAttr(o ? o.name : ev.title),
      '<div class="rw-lbl">' + I('mic') + 'Надиктуйте одной фразой</div>' +
      '<textarea id="ocText" class="rw-text" rows="4" placeholder="Что сказал клиент и что он решил"></textarea>' +
      (canDictate
        ? '<div class="qa-row" style="margin-top:8px"><button class="btn sm" data-act="ocDictate">' +
          I('mic') + 'Говорить</button></div>'
        : '<div class="rw-prov" style="margin-top:8px">' + I('mic') +
          'Диктовка недоступна в этом браузере — напечатайте, механизм тот же.</div>') +
      (next ? '<div class="rw-lbl" style="margin-top:14px">' + I('arrowRight') + 'Следующий шаг</div>' +
        '<div class="rw-quote">' + escAttr(next) + '<span>выведено из карточки клиента и объекта, а не из надиктованного</span></div>' : '') +
      '<div class="rw-prov">' + I('lock') + 'Это заметка брокера, а не запись разговора. ' +
      'Итог остаётся черновиком и не участвует в выводах, пока вы его не подтвердите.</div>',
      '<button class="btn primary" data-act="saveShowOutcome" data-ev="' + ev.id + '">' +
      I('check') + 'Записать итог</button><button class="btn" data-act="closeModal">Закрыть</button>');
  }
  function saveShowOutcome(evId) {
    const ev = (D().events || []).find((x) => x.id === evId); if (!ev) return;
    const el = document.getElementById('ocText');
    const said = el ? String(el.value || '').trim() : '';
    if (!said) { WS.storeApi.toast('Пустой итог записывать нечего', 'warn'); return; }
    const sc = showOutcomeScope(ev);
    if (!sc) { WS.storeApi.toast('Не к чему привязать итог — нет заявки и контакта', 'warn'); return; }
    const next = showNextStep(ev);
    const rec = addOutcomeDraft(sc.scope, sc.id, {
      text: said + (next ? ' ' + next : ''),
      by: (D().users[S().role] || {}).name || 'Агент',
      factId: ev.id,
    });
    if (!rec) { WS.storeApi.toast('Итог записать не удалось', 'warn'); return; }
    closeModal();
    WS.storeApi.toast('Итог записан черновиком — подтвердите в карточке', 'ok');
  }
  /* ==== Отчёт собственнику ===============================================================
     Вторая нить того же утра — сторона СОБСТВЕННИКА. До сих пор всё утро шло со стороны
     покупателя: обращение, ответ, подборка, показ. Но половина работы брокера — это те, чьи
     объекты он ведёт, и в стенде эта сторона уже есть: мандат, эксклюзив, договор управления,
     оценка объекта и посчитанный срок отчёта.

     Отчёт СОБИРАЕТСЯ из записей договора, а не пишется заново: вехи с датами, график платежей,
     документы, срез района. Ничего не придумывается — если строки нет, её нет и в отчёте.
     Просроченный платёж не прячется: он и есть то, ради чего отчёт читают.

     В тот же разговор ложится второй объект — тем же разбором, который уже стоит в
     «Перспективных сделках»: повод есть сам собой, придумывать его не нужно. */
  function ownerSecondObject(c) {
    if (!c || !c.budget) return null;
    return oppFreeObjects([]).filter((o) => (c.areas || []).indexOf(o.area) >= 0 &&
      (o.price || 0) <= c.budget && oppTypeFit(c, o))
      .sort((a, b) => oppComm(b) - oppComm(a))[0] || null;
  }
  function ownerReportRows(k) {
    const done = (k.milestones || []).filter((m) => m.state === 'done');
    const now = (k.milestones || []).filter((m) => m.state === 'now');
    return { done: done, now: now };
  }
  function openOwnerReport(contractId) {
    const k = (D().contracts || []).find((x) => x.id === contractId); if (!k) return;
    const c = oppClient(k.clientId);
    const ms = ownerReportRows(k);
    const paid = (k.schedule || []).filter((x) => x.state === 'paid');
    const late = (k.schedule || []).filter((x) => x.state === 'overdue');
    const due = (k.schedule || []).filter((x) => x.state === 'due');
    const sum = (list) => list.reduce((a, x) => a + (x.amount || 0), 0);
    const m = c ? oppMarketNear((c.areas || [])[0]) : null;
    const second = ownerSecondObject(c);
    const period = (k.signedAt || '—') + ' — ' + String(k.nextDue || '').split('—').pop().trim();
    const head = '<div class="sel-head"><div class="sel-for">Отчёт собственнику · ' +
      escAttr(c ? c.name : 'собственник') + '</div>' +
      '<div class="sel-req">' + escAttr(contractKind(k).label) + ' ' + escAttr(k.number) +
      ' · ' + WS.AED(k.amount) + ' в год · период ' + escAttr(period) + '</div></div>';
    const didRows = ms.done.map((x) => '<div class="opp-b"><span class="k">' + escAttr(x.at) +
      '</span><span class="v">' + escAttr(x.client || x.label) + '</span></div>').join('') +
      ms.now.map((x) => '<div class="opp-b"><span class="k">' + escAttr(x.at) +
        '</span><span class="v">' + escAttr(x.client || x.label) + ' · в работе</span></div>').join('');
    /* Просроченное называется первым и словом «просрочен». Отчёт, который упоминает долг
       последней строкой мелким шрифтом, читается как попытка его не заметить. */
    const money = (late.length
        ? '<div class="opp-b"><span class="k rw-stop">Просрочено</span><span class="v rw-stop">' +
          late.map((x) => escAttr(x.label) + ' · ' + WS.AED(x.amount)).join('; ') + '</span></div>'
        : '') +
      (due.length ? '<div class="opp-b"><span class="k">К оплате</span><span class="v">' +
        due.map((x) => escAttr(x.label) + ' · ' + WS.AED(x.amount) + ' до ' + escAttr(x.due)).join('; ') +
        '</span></div>' : '') +
      (paid.length ? '<div class="opp-b"><span class="k">Оплачено за период</span><span class="v">' +
        WS.AED(sum(paid)) + ' · ' + paid.length + ' ' + plural(paid.length, 'платёж', 'платежа', 'платежей') +
        '</span></div>' : '');
    const market = m
      ? '<div class="opp-b"><span class="k">' + escAttr(m.район) + '</span><span class="v">аренда ' +
        WS.AED(m.арендаЗаМетрВГод) + ' за м² в год · доходность ' + m.доходностьПроцент + '% · ' +
        (m.изменениеЗаГодПроцент >= 0 ? '+' : '') + m.изменениеЗаГодПроцент + '% за год</span></div>'
      : '<div class="opp-b"><span class="k">Рынок</span><span class="v">среза по району собственника в данных нет</span></div>';
    const offer = second
      ? '<div class="sel-mean"><div class="opp-lbl">' + I('target') + 'В тот же разговор</div>' +
        '<p>' + escAttr(second.name) + ' · ' + WS.AED(second.price) + ' · ' + escAttr(second.area) +
        ' — свободен и укладывается в бюджет собственника ' + WS.AED(c.budget) +
        '. Под то же управление, что и первый объект.</p>' +
        '<p class="sel-why">Ожидаемое вознаграждение — ' + WS.AED(oppComm(second)) + ' (' + escAttr(oppCommNote(second)) + ').</p></div>'
      : '';
    openModal('Отчёт собственнику',
      head +
      '<div class="opp-lbl">' + I('check') + 'Что сделано за период</div>' + (didRows || '<div class="opp-b"><span class="v">записей за период нет</span></div>') +
      '<div class="opp-lbl" style="margin-top:14px">' + I('wallet') + 'Деньги по договору</div>' + (money || '<div class="opp-b"><span class="v">графика платежей нет</span></div>') +
      '<div class="opp-lbl" style="margin-top:14px">' + I('trend') + 'Рынок района за период</div>' + market +
      offer +
      '<div class="sel-prov">' + I('radar') + 'Собрано из вех и графика договора ' + escAttr(k.number) +
      '. Срез рынка ' + escAttr((oppMarket()[0] || {}).asOf || '—') + ', ' +
      escAttr((oppMarket()[0] || {}).basis || 'иллюстративно') + '.</div>',
      '<button class="btn primary" data-act="sendOwnerReport" data-contract="' + k.id + '">' +
      I('send') + 'Отправить отчёт</button>' +
      '<button class="btn" data-act="closeModal">Закрыть</button>', { wide: true });
  }
  function sendOwnerReport(contractId) {
    const k = (D().contracts || []).find((x) => x.id === contractId); if (!k) return;
    const c = oppClient(k.clientId);
    const audit = WS.audience.calculateAudience([{ id: k.id, clientId: k.clientId, channel: (c || {}).channel }]);
    if (!c || audit.excluded.length) {
      WS.storeApi.toast(((audit.excluded[0] || {}).reason || 'нет карточки собственника') + ' — отправка невозможна', 'warn');
      return;
    }
    const second = ownerSecondObject(c);
    const trace = addEventEntry('contact', c.id, { type: 'msg',
      text: 'Отправлен отчёт собственнику по договору ' + k.number +
        (second ? '; в отчёт вложено предложение по ' + second.name : '') + '. Отправка имитируется (DEMO).' });
    if (trace) trace.moved = 'report';
    WS.storeApi.touch();
    closeModal();
    WS.storeApi.toast('Отчёт отправлен — ' + c.name, 'ok');
  }
  /* ==== «Сегодня сдвинуто» ===============================================================
     Последний шаг утра. В нём не закрылась ни одна сделка — полоса цели не двинулась, и
     рисовать там движение нельзя. Но утро, в котором ответили ждущему клиенту, отправили
     подборку, назначили показ, записали его итог и отчитались собственнику, — это рабочее
     утро, и единственная честная его мера стоит здесь.

     Считаются СОСТОЯНИЯ, а не нажатия: «отправлено», «назначено», «записан». Отправленный и
     тут же переписанный ответ — один ответ, а не два, потому что след в ленте один. Каждая
     строка привязана к записи, которую можно открыть и прочитать.

     Пока ничего не сдвинуто — строки нет. Зелёное «вы молодец» на пустом утре обесценивает
     её же на полном. */
  const MOVED_WORDS = {
    reply: ['ответ отправлен', 'ответа отправлено', 'ответов отправлено'],
    selection: ['подборка отправлена', 'подборки отправлено', 'подборок отправлено'],
    show: ['показ назначен', 'показа назначено', 'показов назначено'],
    outcome: ['итог показа записан', 'итога показа записано', 'итогов показа записано'],
    report: ['отчёт собственнику отправлен', 'отчёта собственнику отправлено', 'отчётов собственнику отправлено'],
  };
  const MOVED_ORDER = ['reply', 'selection', 'show', 'outcome', 'report'];
  function movedCounts() {
    const n = { reply: 0, selection: 0, show: 0, outcome: 0, report: 0 };
    ['contactTimeline', 'requestTimeline', 'dealTimeline', 'companyTimeline'].forEach((key) => {
      const bag = D()[key] || {};
      Object.keys(bag).forEach((id) => {
        (bag[id] || []).forEach((e) => { if (e && e.moved && n[e.moved] != null) n[e.moved] += 1; });
      });
    });
    // Итоги считаются по самим черновикам: запись итога — это черновик, а не строка в ленте.
    n.outcome = (D().outcomes || []).filter((x) => x.factId &&
      (D().events || []).some((e) => e.id === x.factId && e.kind === 'show')).length;
    return n;
  }
  function pulseMoved() {
    const n = movedCounts();
    const parts = MOVED_ORDER.filter((k) => n[k] > 0)
      .map((k) => n[k] + ' ' + plural(n[k], MOVED_WORDS[k][0], MOVED_WORDS[k][1], MOVED_WORDS[k][2]));
    if (!parts.length) return '';
    return '<div class="moved">' + I('checkCircle') + '<span><b>Сегодня сдвинуто:</b> ' +
      parts.join(' · ') + '</span></div>';
  }
  function pulseDay() {
    const f = S().pulseDay || 'today';
    const all = pulseDayItems();
    const list = f === 'all' ? all : all.filter((x) => x.when === f);
    const chips = DAY_FILTERS.map((c) => {
      const n = c[0] === 'all' ? all.length : all.filter((x) => x.when === c[0]).length;
      return '<button class="chip' + (f === c[0] ? '' : ' mut') + '" data-dayfilter="' + c[0] + '">' +
        c[1] + '<span class="ch-n">' + n + '</span></button>';
    }).join('');
    const rows = list.map((it) => {
      // Название сделки или заявки — кликабельное: из ежедневника попадают в работу одним касанием.
      const d = it.dealId ? (D().deals || []).find((x) => x.id === it.dealId) : null;
      const r = !d && it.requestId ? requestById(it.requestId) : null;
      const what = d ? '<button class="lnk" data-deal="' + d.id + '">' + escAttr(d.title) + '</button>'
        : r ? '<button class="lnk" data-request="' + r.id + '">' + escAttr(r.title) + '</button>'
        : '<span style="color:var(--faint)">без сделки</span>';
      const c = it.clientId ? (D().clients || []).find((x) => x.id === it.clientId) : null;
      const who = c ? '<button class="lnk" data-client="' + c.id + '">' + escAttr(c.name) + '</button>' +
        /* Номер был текстом: агент видел его и не мог набрать. Но в стенде номера намеренно
           замаскированы («+971 55 0•• ••34 (DEMO)»), и ссылка «позвонить» на такой номер
           набрала бы не того: из маски вычищается «+97155034». Поэтому набирается только
           ПОЛНЫЙ номер, а замаскированный остаётся тем, что он есть, — подписью. */
        (c.phone ? (/^[+\d][\d\s()+-]*$/.test(c.phone)
          ? '<a class="pd-ph" href="tel:' + escAttr(String(c.phone).replace(/[^\d+]/g, '')) +
            '" title="Позвонить">' + I('phone') + escAttr(c.phone) + '</a>'
          : '<span class="pd-ph is-masked" title="В стенде номер скрыт — звонок из карточки контакта">' +
            I('phone') + escAttr(c.phone) + '</span>') : '') : '—';
      const k = DAY_KIND[it.kind] || ['Задача', 'check', 'k-task'];
      // Срочность — полосой слева на всю строку, а не только цветом даты: список читается
      // сверху вниз одним движением, «что горит» видно раньше, чем прочитано хоть одно слово.
      const urg = it.when === 'overdue' ? ' pd-over' : (it.when === 'today' ? ' pd-today' : '');
      /* Подписи полей стоят в разметке, а не только в шапке таблицы: на узком экране шапки
         нет — строка разворачивается карточкой, и каждое значение обязано назвать себя само.
         Порядок полей не меняется: состав и очередь колонок задал партнёр. */
      return '<tr class="pd-r' + urg + '">' +
        '<td class="pd-due"><span class="pd-dot"></span>' + escAttr(it.due) +
        (it.when === 'overdue' ? '<div class="pd-late">просрочено</div>' : '') + '</td>' +
        '<td data-l="Сделка или заявка">' + what + '</td>' +
        '<td data-l="Контакт">' + who + '</td>' +
        '<td class="pd-what" data-l="Событие">' + escAttr(it.title) + '</td>' +
        '<td class="pd-type" data-l="Тип"><span class="pd-kind ' + k[2] + '">' + I(k[1]) + k[0] + '</span></td></tr>';
    }).join('');
    const body = rows
      ? '<div class="pd-wrap"><table class="pd-table"><thead><tr>' +
        '<th>Дата</th><th>Сделка или заявка</th><th>Контакт</th><th>Событие</th><th>Тип</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty" style="padding:22px">' + I('checkCircle') +
        '<div style="font-weight:700;color:var(--ink)">На этот срок дел нет</div></div>';
    const line = S().dayView === 'line';
    const views = '<button class="chip' + (line ? '' : ' on') + '" data-act="dayTable">' + I('grid') + 'Таблицей</button>' +
      '<button class="chip' + (line ? ' on' : '') + '" data-act="dayLine">' + I('clock') + 'Днём</button>';
    return '<div class="qa-row pd-bar">' + chips +
      '<span class="df-sep"></span><span class="pd-n">' + list.length + ' ' +
      plural(list.length, 'дело', 'дела', 'дел') + '</span>' +
      '<button class="btn sm" data-nav="tasks" style="margin-left:auto">' + I('arrowRight') + 'Все задачи</button></div>' +
      '<div class="qa-row pd-bar">' + views + '</div>' +
      (line ? pulseDayLine(list) : body);
  }

  /* ==== «Перспективные сделки» — ВОЗМОЖНОСТИ, а не дела внутри сделок ========================

     Здесь стояла карточка УЖЕ ОТКРЫТОЙ сделки с ближайшим действием по ней: «Согласовать
     следующий шаг с клиентом» по сделке, которая и так в работе. То есть «Мои дела», сказанные
     другими словами, — и принципал сказал об этом прямо: в этом разделе должны быть
     ВОЗМОЖНОСТИ. Кому. Почему возможность вообще есть. На основании каких данных мы так
     решили. Что предложить. Что сделать первым.

     Возможность рождается ПРАВИЛОМ. Правил восемь, и каждое смотрит на свой срез: договоры
     аренды, договоры off-plan, срез рынка, инвентарь, сроки сдачи, комплаенс, совпадение
     бюджета, отчётность по управлению. Разные основания дают разные поводы — в этом и смысл
     раздела: восемь одинаковых карточек означали бы одно правило, переписанное восемь раз.

     Всё, что правило кладёт в карточку, либо посчитано, либо прочитано из записи: карточку
     читают перед звонком, и сочинённый факт здесь дороже, чем отсутствующий. Где числа взять
     не из чего — в карточке стоит не число, а условие, при котором оно появится.

     Объект «занимается» первой же возможностью, которая его назвала: иначе один и тот же юнит
     уходит в предложение двум клиентам сразу, и брокер узнаёт об этом от них. Порядок правил
     в списке и есть приоритет. */

  // Ставка агентства по аренде — процент от годовой. Называется в самой карточке: она не
  // выводится из записи, и выдавать её за посчитанную нельзя.
  const LEASE_FEE_PCT = 5;
  function oppMarket() { const r = WS.query.run({ from: 'market' }); return (r && r.rows) || []; }
  function oppMarketOf(area) { return oppMarket().find((m) => m.район === area) || null; }
  function oppClient(id) { return (D().clients || []).find((x) => x.id === id) || null; }
  function oppObject(id) { return (D().objects || []).find((x) => x.id === id) || null; }
  function oppComm(o) {
    if (!o) return 0;
    const pct = o.commissionPct != null ? o.commissionPct : DEFAULT_COMM_PCT;
    return Math.round((o.price || 0) * pct / 100);
  }
  function oppCommNote(o) {
    const pct = o && o.commissionPct != null ? o.commissionPct : DEFAULT_COMM_PCT;
    return pct + '% от ' + WS.AED(o ? o.price : 0);
  }
  /* Занят ли объект — предлагать его второму клиенту нельзя.

     Прежняя проверка смотрела только на `objectId` НЕзакрытых сделок, и мимо неё проходили
     две вещи сразу. Проданный юнит: объект выигранной сделки числился свободным, потому что
     сделка закрыта, — и возможность могла предложить его ещё раз (в данных это `o_palmcourt`
     из `d_won`). И дополнительные лоты: сделка с несколькими объектами держит их в `lots`, а
     не в `objectId`, — так `o_difc_b` внутри активной `d_rentbiz` тоже считался свободным.

     Проигранная сделка объект НЕ держит: он вернулся в рынок, и целое правило построено
     ровно на этом. Поэтому исключение по исходу, а не по «закрыта или нет». */
  function oppObjectBusy(id) {
    return (D().deals || []).some((d) => {
      if (d.stage === 'lost' || dealArchived(d)) return false;
      return d.objectId === id || (d.lots || []).indexOf(id) >= 0;
    });
  }
  function oppHasLiveDeal(clientId) {
    return (D().deals || []).some((d) => d.clientId === clientId && !dealClosed(d) && !dealArchived(d));
  }
  function oppFreeObjects(claimed) {
    return (D().objects || []).filter((o) => o.availability === 'available' &&
      !oppObjectBusy(o.id) && claimed.indexOf(o.id) < 0);
  }
  function oppDays(n) { return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
  /* Инвестору в квартиры нельзя предлагать офис. Отдельного поля типа у объекта нет, поэтому
     тип читается из названия и спальности — там он и написан («Office 1204», «Офис»,
     «Block 3»). Клиент, который тип не назвал, принимает любой: пустой список означает
     «не сказано», а не «ничего не подходит». */
  function oppTypeOf(o) {
    return /офис|office|block|блок/i.test((o.name || '') + ' ' + (o.br || '')) ? 'office' : 'apart';
  }
  function oppTypeFit(c, o) {
    const want = c.objTypes || [];
    if (!want.length) return true;
    const t = oppTypeOf(o);
    return want.indexOf(t) >= 0 || (t === 'office' && want.indexOf('gab') >= 0);
  }
  /* Правило предпочитает клиента, которому в этом обходе ещё ничего не предложено: день
     брокера шире, когда восемь поводов лежат на шести клиентах, а не на двух. */
  function oppPrefer(list, used) {
    const fresh = list.filter((c) => used.indexOf(c.id) < 0);
    return (fresh.length ? fresh : list)[0] || null;
  }
  /* Имя в заголовке стоит в падеже, которого требует глагол: «Показать Сергею Орлову», а не
     «Показать Сергей Орлов». Формы записаны у клиента явно — склонять русские фамилии
     алгоритмом значит гадать: «Орлов» и «Крылова» склоняются по-разному, а «Sarah Mansour»
     не склоняется вовсе. Нет формы — берём именительный: заголовок станет корявым, но
     не сломается, а проверка укажет, у кого её не заполнили. */
  /* В заголовке объект называется так, как его называет брокер вслух: «Park Terrace JVC 903»,
     а не «Park Terrace JVC, Unit 903». Запятая и слово «Unit» нужны в карточке объекта и в
     письме клиенту; в строке, которую читают за секунду, они съедают шесть знаков из
     семидесяти и ничего не добавляют. */
  function oppShort(o) {
    // Сокращается ТОЛЬКО «Unit»: «Park Terrace JVC, Unit 903» → «Park Terrace JVC 903»,
    // номер читается сам. «Block 3» и «Tower B» — имена, а не номера: без слова «Block»
    // остаётся «DIFC Gate Avenue 3», где тройка не значит ничего.
    return String((o && o.name) || '').replace(/,\s*Unit\s+/i, ' ');
  }
  function cDat(c) { return (c && (c.nameDat || c.name)) || ''; }
  function cGen(c) { return (c && (c.nameGen || c.name)) || ''; }
  function oppRoleWord(c) {
    return [CONTACT_KIND_LABEL[c.contactKind], CONTACT_INTEREST_LABEL[c.interest]].filter(Boolean).join(' · ');
  }
  /* Верхний край горизонта в месяцах: «1–3 месяца» → 3, «3–6 месяцев» → 6. Ноль означает
     «не назван», а не «сегодня»: правило, которое считает молчание срочностью, врёт. */
  function oppHorizonMax(c) {
    const n = String((c && c.horizon) || '').match(/\d+/g);
    return n ? Math.max.apply(null, n.map(Number)) : 0;
  }
  /* Район у клиента и район в срезе рынка написаны по-разному: «Downtown» против
     «Downtown Dubai». Сначала точное совпадение, и только потом приближение — иначе
     «Dubai Creek Harbour» рискует притянуть «Dubai Marina». */
  function oppMarketNear(area) {
    if (!area) return null;
    return oppMarketOf(area) ||
      oppMarket().find((m) => String(m.район).indexOf(area) === 0 || area.indexOf(String(m.район)) === 0) || null;
  }
  // Что клиенту уже показывали — по всем его заявкам, включая закрытые: повторное предложение
  // того же объекта читается как «нас не слушали».
  function oppOfferedIds(clientId) {
    const out = [];
    (D().requests || []).filter((r) => r.clientId === clientId)
      .forEach((r) => (r.offered || []).forEach((o) => { if (out.indexOf(o.id) < 0) out.push(o.id); }));
    return out;
  }
  // Цена через N месяцев при том же годовом темпе. Линейно и без притворства: срез
  // иллюстративный, и вторая цифра после запятой была бы обещанием точности, которой нет.
  function oppPriceIn(price, growthPct, months) {
    return Math.round((price || 0) * (1 + (growthPct || 0) / 100 * months / 12));
  }
  function oppMonths(n) { return n + ' ' + plural(n, 'месяц', 'месяца', 'месяцев'); }

  const PROSPECT_RULES = [
    /* 1. Договор аренды у окна уведомления. Решение о продлении принимает арендатор, и
          принимает его ДО даты уведомления — после неё выбор сужается до остатков рынка. */
    { key: 'lease_window', label: 'Договор аренды у окна продления', icon: 'doc',
      find(claimed, used) {
        return (D().contracts || []).filter((k) => k.kind === 'lease' && k.status === 'active')
          .map((k) => {
            const c = oppClient(k.clientId); if (!c) return null;
            const m = oppMarketOf((c.areas || [])[0]);
            return {
              clientId: c.id, client: c.name, role: oppRoleWord(c),
              why: 'Договор подходит к окну уведомления о продлении. До этой даты решение принимает ' +
                'арендатор и решает его спокойно; после неё выбор сужается до того, что осталось на рынке.',
              basis: [['Договор', k.number + ' · ' + WS.AED(k.amount) + ' в год · подписан ' + k.signedAt],
                ['Ближайший срок', k.nextDue || '—'],
                m ? ['Рынок · ' + m.район, 'аренда ' + WS.AED(m.арендаЗаМетрВГод) + ' за м² в год, ' +
                  '+' + m.изменениеЗаГодПроцент + '% за год, ' + oppDays(m.дней_на_рынке) + ' экспозиции'] : null,
              ].filter(Boolean),
              offer: 'Продление на новый срок — либо переезд в тот же бюджет, но с меньшей ценой метра',
              act: 'Позвонить до окна уведомления и спросить о планах на следующий срок',
              value: Math.round((k.amount || 0) * LEASE_FEE_PCT / 100),
              valueNote: LEASE_FEE_PCT + '% годовой аренды · ставка агентства',
              title: 'Спросить ' + cGen(c) + ' о планах на новый срок аренды',
            ask: 'сравни продление и переезд для ' + c.name + ' по бюджету текущей аренды',
            };
          }).filter(Boolean);
      } },

    /* 2. Клиент, прошедший полный цикл off-plan и платящий по графику. Второй юнит у того же
          застройщика идёт по знакомой рассрочке и без нового KYC — самая короткая сделка,
          какая бывает. */
    { key: 'repeat_offplan', label: 'Второй юнит после закрытой сделки', icon: 'handshake',
      find(claimed, used) {
        const out = [];
        (D().contracts || []).filter((k) => k.kind === 'offplan_spa' && k.status === 'active').forEach((k) => {
          const c = oppClient(k.clientId); if (!c) return;
          const won = (D().deals || []).filter((d) => d.clientId === c.id && dealWon(d))[0];
          if (!won) return;
          const bought = oppObject(k.objectId);
          const dev = bought && bought.developer;
          const co = (D().companies || []).find((x) => x.name === dev);
          /* Купленный объект из выбора исключён явно: без этого правило предлагало клиенту
             ровно тот юнит, который он у нас же и купил. Дальше — по близости: сначала тот же
             застройщик, потом тот же район, потом любой свободный в бюджете. Знакомый
             застройщик короче всего, но «нет второго юнита у Nakheel» не повод молчать. */
          const fit = oppFreeObjects(claimed).filter((o) => o.id !== k.objectId && oppTypeFit(c, o) &&
            (!c.budget || Math.abs((o.price || 0) - c.budget) <= c.budget * 0.35));
          const pick = fit.filter((o) => o.developer === dev)[0] ||
            fit.filter((o) => bought && o.area === bought.area)[0] ||
            fit.slice().sort((a, b) => oppComm(b) - oppComm(a))[0];
          if (!pick) return;
          claimed.push(pick.id);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            /* Про «того же застройщика» говорим, только если он действительно тот же: у
               клиента справка перед звонком, и обещание знакомой рассрочки, которой нет,
               вскроется в первую минуту разговора. */
            why: 'Клиент уже прошёл с нами полный цикл off-plan и платит по графику. Второй объект ' +
              (pick.developer === dev
                ? 'у того же застройщика идёт по знакомой рассрочке и без нового KYC'
                : 'идёт быстрее: клиент знает наш порядок, документы и людей — объяснять с нуля нечего') +
              ' — и в тот же разговор укладывается просьба о рекомендации.',
            basis: [['Закрытая сделка', won.title + ' · ' + WS.AED(won.amount)],
              ['Договор', k.number + ' активен · ' + (k.nextDue || '—')],
              co ? ['Застройщик', co.name + ' · ' + co.commission]
                : ['Застройщик юнита', (pick.developer || '—') +
                  (pick.developer === dev ? ' — тот же, что и в закрытой сделке' : '')],
              ['Свободный юнит', pick.name + ' · ' + WS.AED(pick.price) + ' · ' + (pick.occupancy || pick.segment || '')],
            ],
            offer: pick.name + ' — ' + pick.size + ' м², ' + pick.br + ', ' + pick.area,
            act: 'Позвонить сразу после ближайшего платежа и предложить смотреть второй юнит',
            value: oppComm(pick), valueNote: oppCommNote(pick),
            title: 'Предложить ' + cDat(c) + ' второй юнит — ' + oppShort(pick),
            ask: 'подготовь сравнение второго юнита ' + pick.name + ' для ' + c.name,
            objId: pick.id,
          });
        });
        return out;
      } },

    /* 3. Разрыв доходности между районами. Инвестор ищет там, где доходность ниже, чем в
          другом районе того же сегмента, — и разница на его бюджете считается в деньгах. */
    { key: 'yield_gap', label: 'Разрыв доходности между районами', icon: 'trend',
      find(claimed, used) {
        const rows = oppMarket().filter((m) => m.сегмент === 'квартиры');
        const best = rows.slice().sort((a, b) => b.доходностьПроцент - a.доходностьПроцент)[0];
        if (!best) return [];
        return (D().clients || []).filter((c) => c.interest === 'invest' && c.consent !== false && !oppHasLiveDeal(c.id))
          .map((c) => {
            const mine = (c.areas || []).map(oppMarketOf).filter(Boolean);
            if (!mine.length) return null;
            const cur = mine.slice().sort((a, b) => b.доходностьПроцент - a.доходностьПроцент)[0];
            const gap = Math.round((best.доходностьПроцент - cur.доходностьПроцент) * 10) / 10;
            if (gap < 0.5) return null;
            const stock = (D().objects || []).filter((o) => o.area === best.район && o.availability === 'available');
            const perYear = c.budget ? Math.round(c.budget * gap / 100) : 0;
            return {
              clientId: c.id, client: c.name, role: oppRoleWord(c),
              why: 'Клиент ищет там, где доходность ' + cur.доходностьПроцент + '%. В ' + best.район +
                ' — ' + best.доходностьПроцент + '% при росте +' + best.изменениеЗаГодПроцент +
                '% за год' + (perYear ? '. На его бюджете разница — ' + WS.AED(perYear) + ' в год' : '') + '.',
              basis: [['Срез рынка · ' + best.asOf, cur.район + ' — ' + cur.доходностьПроцент + '% · ' +
                  best.район + ' — ' + best.доходностьПроцент + '%'],
                ['Экспозиция', best.район + ' — ' + oppDays(best.дней_на_рынке) + ', ' +
                  cur.район + ' — ' + oppDays(cur.дней_на_рынке)],
                ['Бюджет клиента', c.budget ? WS.AED(c.budget) : 'не назван'],
                ['В нашем инвентаре', stock.length
                  ? stock.length + ' ' + plural(stock.length, 'объект', 'объекта', 'объектов') + ' в ' + best.район
                  : 'объектов в ' + best.район + ' нет — запрашивать у партнёров'],
              ],
              offer: stock.length
                ? 'Подборка в ' + best.район + ' в том же бюджете — ' + stock.map((o) => o.name).join(', ')
                : 'Подборка в ' + best.район + ' в том же бюджете — собрать через партнёров и застройщиков',
              act: stock.length
                ? 'Собрать подборку и отправить сравнение доходности двух районов'
                : 'Запросить у партнёров подборку в ' + best.район + ' и приложить сравнение доходности',
              value: c.budget ? Math.round(c.budget * DEFAULT_COMM_PCT / 100) : 0,
              valueNote: DEFAULT_COMM_PCT + '% от бюджета ' + (c.budget ? WS.AED(c.budget) : ''),
              title: 'Собрать ' + cDat(c) + ' подборку в ' + best.район,
              ask: 'сравни доходность ' + cur.район + ' и ' + best.район + ' для ' + c.name,
            };
          }).filter(Boolean);
      } },

    /* 4. Окно до сдачи. Пока корпус строится, объект продаётся по плану застройщика с
          рассрочкой; после сдачи он уходит на вторичный рынок и рассрочка исчезает вместе с
          ним. Окно закрывается вместе со стройкой, и это единственный срок, который нельзя
          передоговорить. */
    { key: 'handover_window', label: 'Окно до сдачи корпуса', icon: 'clock',
      find(claimed, used) {
        const out = [];
        oppFreeObjects(claimed).filter((o) => o.segment === 'off-plan' && o.handover).forEach((o) => {
          const m = oppMarketOf(o.area);
          const c = oppPrefer((D().clients || []).filter((x) => x.consent !== false &&
            (x.areas || []).indexOf(o.area) >= 0 && x.budget >= (o.price || 0) && oppTypeFit(x, o) &&
            (x.interest === 'invest' || x.interest === 'live'))
            .sort((a, b) => a.budget - b.budget), used);
          if (!c) return;
          claimed.push(o.id);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'До сдачи (' + o.handover + ') объект продаётся по плану застройщика с рассрочкой. ' +
              'После сдачи он уходит на вторичный рынок, и рассрочка исчезает вместе с ним — ' +
              'это тот срок, который нельзя передоговорить.',
            basis: [['Объект', o.name + ' · ' + WS.AED(o.price) + ' · ' + o.size + ' м², ' + o.br],
              ['Сдача', o.handover + ' · застройщик ' + (o.developer || '—')],
              o.paymentPlan ? ['План оплаты', o.paymentPlan] : null,
              m ? ['Рынок · ' + m.район, WS.AED(m.ценаЗаМетр) + ' за м², доля off-plan ' +
                m.доля_офф_плана + '%, +' + m.изменениеЗаГодПроцент + '% за год'] : null,
              ['Бюджет клиента', c.budget ? WS.AED(c.budget) : 'не назван'],
            ].filter(Boolean),
            offer: o.name + ' — рассрочка застройщика до сдачи ' + o.handover,
            act: 'Показать план оплаты и назначить просмотр макета корпуса',
            value: oppComm(o), valueNote: oppCommNote(o),
            title: 'Показать ' + cDat(c) + ' рассрочку по ' + oppShort(o),
            ask: 'собери расчёт рассрочки по ' + o.name + ' для ' + c.name,
            objId: o.id,
          });
        });
        return out;
      } },

    /* 5. Бюджет совпал с целым объектом. Крупный собственник и свободный блок: цена метра ниже
          районной, объект занят арендаторами — доход идёт с первого дня. Совпадение видно
          только если сопоставлять бюджеты с инвентарём, а не ждать заявки. */
    { key: 'block_match', label: 'Бюджет совпал с целым объектом', icon: 'layers',
      find(claimed, used) {
        const out = [];
        (D().clients || []).filter((c) => c.budget >= 5000000).forEach((c) => {
          const pick = oppFreeObjects(claimed).filter((o) => (o.price || 0) <= c.budget &&
            (o.price || 0) >= c.budget * 0.6 && (c.areas || []).indexOf(o.area) >= 0 && oppTypeFit(c, o))
            .sort((a, b) => oppComm(b) - oppComm(a))[0];
          if (!pick) return;
          claimed.push(pick.id);
          const m = oppMarketOf(pick.area);
          const perM = pick.size ? Math.round(pick.price / pick.size) : 0;
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Бюджет клиента и цена свободного объекта сходятся, район совпадает — а ни заявки, ' +
              'ни сделки по этой паре нет. Объект просто не показывали.',
            basis: [['Бюджет клиента', WS.AED(c.budget) + ' · ' + pick.area +
                (c.horizon ? ' · горизонт ' + c.horizon : '')],
              ['Объект', pick.name + ' · ' + WS.AED(pick.price) + ' · ' + pick.size + ' м²'],
              (m && perM) ? ['Цена метра', WS.AED(perM) + ' против ' + WS.AED(m.ценаЗаМетр) +
                ' по срезу ' + m.район + ' (' + (perM < m.ценаЗаМетр ? '−' : '+') +
                Math.abs(Math.round((perM / m.ценаЗаМетр - 1) * 100)) + '%)'] : null,
              pick.occupancy ? ['Заполненность', pick.occupancy] : null,
              pick.usp ? ['Чем интересен', pick.usp] : null,
            ].filter(Boolean),
            offer: pick.name + ' целиком — ' + pick.size + ' м², ' + (pick.segment || ''),
            act: 'Назначить осмотр и запросить рент-ролл по действующим арендаторам',
            value: oppComm(pick), valueNote: oppCommNote(pick),
            title: 'Показать ' + cDat(c) + ' ' + oppShort(pick) + ' целиком',
            ask: 'собери расчёт доходности по ' + pick.name + ' для ' + c.name,
            objId: pick.id,
          });
        });
        return out;
      } },

    /* 6. Объект проигранной сделки снова свободен. Причина ухода могла быть в чём угодно, но
          если объект вернулся в рынок, разговор возобновляется с фактом, а не с извинением. */
    { key: 'lost_return', label: 'Объект проигранной сделки снова свободен', icon: 'replay',
      find(claimed, used) {
        const out = [];
        (D().deals || []).filter((d) => d.stage === 'lost' && d.objectId).forEach((d) => {
          const o = oppObject(d.objectId);
          if (!o || o.availability !== 'available' || oppObjectBusy(o.id) || claimed.indexOf(o.id) >= 0) return;
          const c = oppClient(d.clientId); if (!c) return;
          claimed.push(o.id);
          const m = oppMarketOf(o.area);
          const buy = (c.budget || 0) >= (o.price || 0);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Сделка была проиграна, а объект, вокруг которого она шла, снова свободен и в рынке. ' +
              'Возвращаться есть с чем: разговор начинается с факта, а не с извинения.' +
              (buy ? ' Бюджет клиента покрывает покупку — не только аренду.' : ''),
            basis: [['Проигранная сделка', d.title + ' · ' + WS.AED(d.amount)],
              ['Объект сейчас', o.name + ' · ' + (o.occupancy || 'свободен') + ' · ' + WS.AED(o.price)],
              m ? ['Рынок · ' + m.район, '+' + m.изменениеЗаГодПроцент + '% за год, ' +
                oppDays(m.дней_на_рынке) + ' экспозиции, доходность ' + m.доходностьПроцент + '%'] : null,
              ['Бюджет клиента', c.budget ? WS.AED(c.budget) + (buy ? ' — покрывает цену объекта' : '') : 'не назван'],
            ].filter(Boolean),
            offer: buy ? o.name + ' — на покупку, а не в аренду: бюджет закрывает цену' : o.name + ' — снова доступен',
            act: 'Позвонить и сказать, что объект вернулся в рынок; предложить пересмотр',
            value: buy ? oppComm(o) : Math.round((d.amount || 0) * LEASE_FEE_PCT / 100),
            valueNote: buy ? oppCommNote(o) : LEASE_FEE_PCT + '% годовой аренды · ставка агентства',
            title: 'Показать ' + cDat(c) + ' ' + oppShort(o) + ' снова' + (buy ? ' — теперь на покупку' : ''),
            ask: 'сравни аренду и покупку ' + o.name + ' для ' + c.name,
            objId: o.id,
          });
        });
        return out;
      } },

    /* 7. Отчёт собственнику как готовый повод. Разговор всё равно состоится в назначенный срок
          — второй объект ложится в него без отдельного звонка. */
    { key: 'management_upsell', label: 'Второй объект в разговор об отчёте', icon: 'briefcase',
      find(claimed, used) {
        const out = [];
        (D().contracts || []).filter((k) => k.kind === 'management' && k.status === 'active').forEach((k) => {
          const c = oppClient(k.clientId); if (!c || !c.budget) return;
          const pick = oppFreeObjects(claimed).filter((o) => (c.areas || []).indexOf(o.area) >= 0 &&
            (o.price || 0) <= c.budget && oppTypeFit(c, o)).sort((a, b) => oppComm(b) - oppComm(a))[0];
          if (!pick) return;
          claimed.push(pick.id);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Разговор с собственником всё равно состоится в назначенный срок — отчёт по ' +
              'управлению готовим мы. Второй объект ложится в него без отдельного звонка и без ' +
              'повода, который надо придумывать.',
            basis: [['Договор управления', k.number + ' · ' + WS.AED(k.amount) + ' в год'],
              ['Ближайший срок', k.nextDue || '—'],
              ['Свободный объект', pick.name + ' · ' + WS.AED(pick.price) + ' · ' + (pick.occupancy || pick.segment || '')],
              ['Бюджет клиента', WS.AED(c.budget) + ' — цена объекта укладывается'],
            ],
            offer: pick.name + ' — и сразу под то же управление, что и первый объект',
            act: 'Приложить к отчёту одностраничный расчёт по второму объекту',
            value: oppComm(pick), valueNote: oppCommNote(pick),
            title: 'Вложить ' + oppShort(pick) + ' в отчёт ' + cDat(c),
            ask: 'посчитай доходность ' + pick.name + ' под управлением для ' + c.name,
            objId: pick.id,
          });
        });
        return out;
      } },

    /* 8. Входящее, на которое никто не ответил. Разбор не по клиентской базе, а по каналу
          входящих: сообщение уже содержит бюджет, район и тип — квалифицировать нечего,
          а счёт идёт на часы. Ночное обращение теряется тише всех: утром лента длиннее. */
    { key: 'inbox_unreached', label: 'Входящее без ответа', icon: 'mail',
      find(claimed, used) {
        const out = [];
        (D().inbox || []).filter((i) => i.stage === 'unreached' && i.clientId).forEach((i) => {
          const c = oppClient(i.clientId); if (!c) return;
          const pick = oppFreeObjects(claimed).filter((o) => (c.areas || []).indexOf(o.area) >= 0 &&
            (o.price || 0) <= (c.budget || 0) * 1.05 && oppTypeFit(c, o))
            .sort((a, b) => oppComm(b) - oppComm(a))[0];
          const m = oppMarketNear((c.areas || [])[0]);
          if (pick) claimed.push(pick.id);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            tone: 'stop',
            why: 'Обращение пришло в ' + i.at + ' и осталось без ответа. В нём уже названы бюджет, ' +
              'район и тип — квалифицировать нечего, лид готов. Такие теряются не потому, что не ' +
              'подошли, а потому, что к утру лента длиннее.',
            basis: [['Входящее', chanMeta(i.channel)[1] + ' · ' + i.at + ' · без ответа'],
              ['Что написано', '«' + String(i.text || '').slice(0, 120) + '»'],
              ['Карточка клиента', (c.budget ? WS.AED(c.budget) : 'бюджет не назван') + ' · ' +
                ((c.areas || []).join(', ') || 'район не назван')],
              pick ? ['Подходит сейчас', pick.name + ' · ' + WS.AED(pick.price) + ' · ' + pick.size + ' м², ' + pick.br]
                : ['Подходит сейчас', 'в бюджете и районе свободного нет — запрашивать у партнёров'],
              m ? ['Рынок · ' + m.район, oppDays(m.дней_на_рынке) + ' экспозиции — время на ответ есть, но немного'] : null,
            ].filter(Boolean),
            offer: pick ? pick.name + ' — ' + pick.size + ' м², ' + pick.br + ', ' + pick.area
              : 'Ответ в том же канале и подборка от партнёров под названный бюджет',
            act: 'Ответить в том же канале первым делом с утра — и сразу вариантом, а не вопросом',
            value: pick ? oppComm(pick) : Math.round((c.budget || 0) * DEFAULT_COMM_PCT / 100),
            valueNote: pick ? oppCommNote(pick) : DEFAULT_COMM_PCT + '% от названного бюджета',
            title: 'Ответить ' + cDat(c) + ' и сразу дать вариант',
            ask: 'собери ответ на ночное обращение ' + c.name + ' с двумя вариантами',
            objId: pick ? pick.id : null,
          });
        });
        return out;
      } },

    /* 9. Отказ, у которого записана причина. Разбор по истории показов: клиент своими словами
           сказал, что именно не подошло, — и это единственный вид данных, где мотив написан, а
           не выведен. Возможность есть, если в инвентаре стоит свободный объект, который под
           эту причину подходит и которого клиенту не показывали. */
    { key: 'rejected_reason', label: 'Показывали не то — причина названа', icon: 'eye',
      find(claimed, used) {
        const out = [];
        (D().requests || []).forEach((r) => {
          const bad = (r.offered || []).find((o) => o.state === 'rejected' && o.reason);
          if (!bad) return;
          const c = oppClient(r.clientId); if (!c) return;
          const rejected = oppObject(bad.id);
          const seen = oppOfferedIds(c.id);
          /* Район отклонённого объекта исключается целиком: клиент отказался не от юнита, а от
             места. Предложить второй адрес на той же улице — это не услышать сказанное. */
          /* Свободный объект здесь не условие, а исход. Когда в инвентаре вне отклонённого
             района подходящего нет — это и есть содержание возможности: клиенту показывали
             ровно то, что он назвал в начале, а он с тех пор сказал другое. Так же устроен
             разбор доходности: «объектов в районе нет — запрашивать у партнёров» — это
             первый шаг, а не повод промолчать. */
          const pick = oppFreeObjects(claimed).filter((o) => seen.indexOf(o.id) < 0 &&
            (!rejected || o.area !== rejected.area) &&
            (o.price || 0) <= (c.budget || 0) * 1.05 && oppTypeFit(c, o))
            .sort((a, b) => oppComm(b) - oppComm(a))[0];
          if (pick) claimed.push(pick.id);
          const shown = (r.offered || []).length;
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Клиент назвал причину отказа своими словами, и она про место, а не про цену. ' +
              'Значит устарел сам список районов в заявке: подбирать надо под сказанное, а не ' +
              'под то, что он перечислил до просмотра.',
            basis: [['Заявка', r.title + ' · ' + r.leadStatus],
              ['Сказано дословно', '«' + bad.reason + '»'],
              ['Показано по заявке', shown + ' ' + plural(shown, 'вариант', 'варианта', 'вариантов') +
                (rejected ? ' · отклонён ' + rejected.name : '')],
              ['Районы в заявке', ((c.areas || []).join(', ') || 'не названы') +
                (rejected ? ' — включая ' + rejected.area + ', от которого клиент отказался' : '')],
              pick ? ['Не показывали', pick.name + ' · ' + pick.area + ' · ' + WS.AED(pick.price)]
                : ['В инвентаре под причину', 'свободного вне ' + (rejected ? rejected.area : 'отклонённого района') +
                  ' в бюджете сейчас нет — собирать через партнёров'],
            ],
            offer: pick
              ? pick.name + ' — ' + pick.area + ', ' + pick.size + ' м², ' + pick.br
              : 'Подборка под сказанное — и заново записанный список районов в заявке',
            act: pick
              ? 'Отправить один вариант и сослаться на его же формулировку, а не на новую подборку'
              : 'Переспросить про район словами клиента, переписать заявку и запросить подборку у партнёров',
            value: pick ? oppComm(pick) : Math.round((c.budget || 0) * DEFAULT_COMM_PCT / 100),
            valueNote: pick ? oppCommNote(pick) : DEFAULT_COMM_PCT + '% от бюджета ' + WS.AED(c.budget || 0),
            title: pick
              ? 'Показать ' + cDat(c) + ' ' + oppShort(pick) + ' — вне отклонённого района'
              : 'Переписать заявку ' + cGen(c) + ': список районов устарел',
            ask: 'подбери вариант для ' + c.name + ' с учётом отказа: ' + bad.reason,
            objId: pick ? pick.id : null,
          });
        });
        return out;
      } },

    /* 10. Бюджет догоняет рынок. Разбор во времени, а не в сравнении: район растёт, горизонт
           клиента длинный, и к концу этого горизонта часть сегодняшнего выбора выходит из
           бюджета. Возможность заводится, только если выходит РЕАЛЬНО — иначе это не срочность,
           а её имитация, и брокер это увидит с первого же звонка. */
    { key: 'price_window', label: 'Бюджет догоняет рынок', icon: 'trend',
      find(claimed, used) {
        const out = [];
        (D().clients || []).filter((c) => c.consent !== false && c.budget && oppHorizonMax(c) >= 4).forEach((c) => {
          const area = (c.areas || []).find((a) => { const m = oppMarketNear(a); return m && m.изменениеЗаГодПроцент >= 9; });
          const m = oppMarketNear(area); if (!m) return;
          const months = oppHorizonMax(c);
          const stock = (D().objects || []).filter((o) => o.area === area && o.availability === 'available' &&
            !oppObjectBusy(o.id) && oppTypeFit(c, o) && (o.price || 0) <= c.budget);
          const later = stock.filter((o) => oppPriceIn(o.price, m.изменениеЗаГодПроцент, months) <= c.budget);
          if (!stock.length || later.length >= stock.length) return;
          const leaving = stock.filter((o) => later.indexOf(o) < 0)
            .sort((a, b) => (b.price || 0) - (a.price || 0))[0];
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Горизонт клиента — ' + oppMonths(months) + ', а ' + m.район + ' растёт на +' +
              m.изменениеЗаГодПроцент + '% в год. К концу этого горизонта из ' + stock.length + ' ' +
              plural(stock.length, 'подходящего объекта', 'подходящих объектов', 'подходящих объектов') +
              ' в бюджет ' + plural(later.length, 'уложится', 'уложатся', 'уложатся') + ' ' + later.length +
              '. Ждать здесь — это не «подумать», а платить за раздумье.',
            basis: [['Срез рынка · ' + m.район, WS.AED(m.ценаЗаМетр) + ' за м² · +' +
                m.изменениеЗаГодПроцент + '% за год · ' + m.asOf],
              ['Горизонт клиента', c.horizon + ' · бюджет ' + WS.AED(c.budget)],
              ['В бюджете сейчас', stock.length + ' ' + plural(stock.length, 'объект', 'объекта', 'объектов') +
                ' · через ' + oppMonths(months) + ' — ' + later.length],
              leaving ? ['Выходит из бюджета первым', leaving.name + ' · ' + WS.AED(leaving.price) +
                ' → ' + WS.AED(oppPriceIn(leaving.price, m.изменениеЗаГодПроцент, months)) +
                ' при том же темпе'] : null,
            ].filter(Boolean),
            offer: leaving
              ? leaving.name + ' — зафиксировать цену сейчас, пока она в бюджете'
              : 'Зафиксировать вход в ' + m.район + ' по сегодняшней цене',
            act: 'Показать расчёт «сегодня против конца горизонта» и предложить бронь по текущей цене',
            /* Если объект, выходящий из бюджета, уже назван другой возможностью, это ОДНА
               сделка, а не две. Тогда разбор не заводит вторую карточку, а отдаёт свой срок
               доводом в ту, что этот объект предлагает: `mergeObj` говорит, к какой. */
            mergeObj: leaving ? leaving.id : null,
            mergeLabel: 'Срок по бюджету',
            mergeFact: leaving
              ? 'через ' + oppMonths(months) + ' при +' + m.изменениеЗаГодПроцент + '% в год — ' +
                WS.AED(oppPriceIn(leaving.price, m.изменениеЗаГодПроцент, months)) +
                ', выше бюджета ' + WS.AED(c.budget)
              : '',
            value: Math.round(c.budget * DEFAULT_COMM_PCT / 100),
            valueNote: DEFAULT_COMM_PCT + '% от бюджета ' + WS.AED(c.budget),
            title: 'Показать ' + cDat(c) + ' расчёт «сегодня против конца горизонта»',
            ask: 'посчитай, как меняется выбор для ' + c.name + ' за ' + oppMonths(months) + ' при росте ' +
              m.изменениеЗаГодПроцент + '%',
          });
        });
        return out;
      } },

    /* 11. Спрос есть, инвентаря нет. Разбор на стыке двух списков: район назван клиентом, а
           в нашем инвентаре по нему ноль объектов. Это не «предложить нечего» — это co-broking:
           у партнёра, чей профиль и есть этот район, объекты найдутся, а половина комиссии
           наша. Молчание здесь стоит ровно одного письма. */
    { key: 'cobroking_gap', label: 'Спрос там, где у нас нет инвентаря', icon: 'handshake',
      find(claimed, used) {
        const partners = (typeof PARTNERS !== 'undefined' ? PARTNERS : []).filter((p) => p.status === 'active');
        const out = [];
        (D().clients || []).filter((c) => c.consent !== false && c.budget).forEach((c) => {
          const area = (c.areas || []).find((a) => {
            const m = oppMarketNear(a);
            return m && !(D().objects || []).some((o) => o.area === a || o.area === m.район);
          });
          if (!area) return;
          const m = oppMarketNear(area);
          const p = partners.find((x) => String(x.focus || '').indexOf(area) >= 0) || partners[0];
          if (!p) return;
          const half = String(p.split || '').indexOf('50') >= 0;
          const full = Math.round(c.budget * DEFAULT_COMM_PCT / 100);
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Район назван клиентом, а в нашем инвентаре по нему нет ни одного объекта. Это не ' +
              '«вариантов нет» — это co-broking: у партнёра, чей профиль и есть ' + area + ', ' +
              'объекты найдутся' + (half ? ', и половина комиссии наша' : '') + '. Запрос стоит одного письма.',
            basis: [['Что просит клиент', WS.AED(c.budget) + ' · ' + area +
                (c.horizon ? ' · горизонт ' + c.horizon : '')],
              ['В нашем инвентаре', 'объектов в ' + area + ' — ни одного из ' + (D().objects || []).length],
              m ? ['Срез рынка · ' + m.район, WS.AED(m.ценаЗаМетр) + ' за м² · доходность ' +
                m.доходностьПроцент + '% · ' + oppDays(m.дней_на_рынке) + ' экспозиции'] : null,
              ['Партнёр по профилю', p.name + ' · ' + p.focus + ' · сплит ' + p.split],
            ].filter(Boolean),
            offer: 'Подборка от ' + p.name + ' в ' + area + ' под названный бюджет — по сплиту ' + p.split,
            act: 'Отправить партнёру запрос с бюджетом и требованиями, ответ ждать в сутки',
            value: half ? Math.round(full / 2) : full,
            valueNote: half
              ? 'половина от ' + DEFAULT_COMM_PCT + '% · сплит ' + p.split
              : DEFAULT_COMM_PCT + '% от бюджета · сплит по договорённости',
            title: 'Запросить у ' + p.name + ' подборку в ' + area + ' для ' + cGen(c),
            ask: 'составь запрос партнёру ' + p.name + ' по ' + area + ' для ' + c.name,
          });
        });
        return out;
      } },

    /* 12. Повод в календаре и самый конверсионный канал. Разбор двух наборов, которые обычно
           не встречаются: дата в карточке клиента и статистика источников. Поздравление само по
           себе не сделка; сделкой его делает то, что рекомендация закрывается чаще любого
           платного размещения, — и число этому есть. */
    { key: 'referral_window', label: 'Повод в календаре и канал рекомендаций', icon: 'star',
      find(claimed, used) {
        const now = demoNow();
        const src = (D().attribution || []).slice();
        const ref = src.find((a) => /рефер|рекоменд/i.test(a.source));
        if (!ref || !ref.deals) return [];
        const worst = src.filter((a) => a !== ref && a.leads)
          .sort((a, b) => (a.deals / a.leads) - (b.deals / b.leads))[0];
        const out = [];
        (D().clients || []).filter((c) => c.consent !== false && c.birthday).forEach((c) => {
          const m = /^(\d+)\s*([а-яё]+)/i.exec(c.birthday); if (!m) return;
          const mi = RU_MONTHS.indexOf(m[2].toLowerCase()); if (mi < 0) return;
          const days = dayOfYear(parseInt(m[1], 10), mi + 1) - dayOfYear(now.d, now.mo);
          if (days < 0 || days > 30) return;
          const won = (D().deals || []).filter((d) => d.clientId === c.id && dealWon(d))[0];
          if (!won) return;
          out.push({
            clientId: c.id, client: c.name, role: oppRoleWord(c),
            why: 'Через ' + oppDays(days) + ' у клиента день рождения — повод, который не надо ' +
              'придумывать. Он уже закрыл с нами сделку, а рекомендация закрывается чаще любого ' +
              'другого источника: просить о ней в этот разговор уместно, в холодный — нет.',
            basis: [['Дата', c.birthday + ' · через ' + oppDays(days)],
              ['Закрытая сделка', won.title + ' · ' + WS.AED(won.amount)],
              ['Канал «' + ref.source + '»', ref.leads + ' ' + plural(ref.leads, 'лид', 'лида', 'лидов') +
                ' → ' + ref.deals + ' ' + plural(ref.deals, 'сделка', 'сделки', 'сделок') +
                ' · ' + WS.AED(ref.commission) + ' комиссии'],
              worst ? ['Для сравнения · ' + worst.source, worst.leads + ' ' +
                plural(worst.leads, 'лид', 'лида', 'лидов') + ' → ' + worst.deals + ' ' +
                plural(worst.deals, 'сделка', 'сделки', 'сделок')] : null,
            ].filter(Boolean),
            offer: 'Поздравление и просьба об одном знакомстве — не «порекомендуйте нас», а одно имя',
            act: 'Позвонить ' + c.birthday + ' голосом; шаблонное сообщение этот повод тратит впустую',
            value: Math.round(ref.commission / ref.deals),
            valueNote: 'средняя комиссия сделки из канала «' + ref.source + '»',
            title: 'Позвонить ' + cDat(c) + ' ' + c.birthday + ' и попросить об одном знакомстве',
            ask: 'подготовь разговор с ' + c.name + ' ко дню рождения с просьбой о знакомстве',
          });
        });
        return out;
      } },
  ];

  /* Список возможностей. Правила идут по порядку, объект достаётся первому назвавшему.
     Сортировка — по ожидаемому вознаграждению; возможности без числа (их значение считается
     только после оценки) уходят в конец, а не притворяются нулевыми. */
  /* Какие разборы дали повод в последнем обходе — включая те, что влились доводом в чужую
     карточку и своей строкой не встали. Молчащий разбор иначе не отличить от слитого. */
  let prospRulesFired = [];
  function pulseProspectList() {
    const claimed = [];   // объекты, уже названные возможностью: один юнит — одному клиенту
    const used = [];      // клиенты, которым в этом обходе уже есть что предложить
    const out = [];
    const fired = [];
    PROSPECT_RULES.forEach((r) => {
      let found = [];
      try { found = r.find(claimed, used) || []; } catch (e) { found = []; }
      if (found.length && fired.indexOf(r.key) < 0) fired.push(r.key);
      found.forEach((p, i) => {
        if (used.indexOf(p.clientId) < 0) used.push(p.clientId);
        out.push(Object.assign({
          id: 'p_' + r.key + '_' + i, rule: r.key, ruleLabel: r.label, icon: r.icon,
        }, p));
      });
    });
    prospRulesFired = fired;
    /* Разбор может не заводить новую возможность, а усиливать чужую. Срок по объекту, который
       другая карточка уже предлагает, — это не вторая сделка, а довод в первой: складывать их
       вознаграждения значит обещать те деньги дважды, а показывать двумя карточками — заставить
       брокера самого догадаться, что речь про один и тот же юнит. Такой разбор вливается
       строкой в основание той карточки и своей не встаёт. */
    const byObj = {};
    out.forEach((p) => { if (p.objId) byObj[p.objId] = p; });
    const kept = [];
    out.forEach((p) => {
      const host = p.mergeObj && p.mergeFact && byObj[p.mergeObj];
      if (host && host !== p) {
        host.basis = (host.basis || []).concat([[p.mergeLabel || p.ruleLabel, p.mergeFact]]);
        host.merged = (host.merged || []).concat([p.rule]);
        return;
      }
      kept.push(p);
    });
    return kept.sort((a, b) => (b.value || 0) - (a.value || 0));
  }
  function prospectRulesFired() { pulseProspectList(); return prospRulesFired.slice(); }
  /* Карточка возможности. Пять вопросов в одном и том же порядке на всех карточках: кому ·
     почему это возможность · на чём основано · что предложить · что сделать первым. Порядок
     не украшение: брокер читает карточку перед звонком и должен находить нужное на том же
     месте, не перечитывая целиком.

     «На чём основано» — не серые чипы через точку, а таблица «признак → значение». Чипы
     читаются как украшение, а это единственная часть карточки, которую агент будет
     проверять глазами, прежде чем повторить клиенту. */
  function prospectCard(p, foot) {
    const val = p.value
      ? '<div class="opp-val"><b>' + WS.AED(p.value) + '</b><span>' + escAttr(p.valueNote || '') + '</span></div>'
      : '<div class="opp-val none"><b>—</b><span>' + escAttr(p.valueNote || 'считается после оценки') + '</span></div>';
    const basis = (p.basis || []).map((b) =>
      '<div class="opp-b"><span class="k">' + escAttr(b[0]) + '</span><span class="v">' + escAttr(b[1]) + '</span></div>').join('');
    /* Заголовок называет СДЕЛКУ, а не критерий, по которому она нашлась. «Бюджет совпал с
       целым объектом» — это рубрика; агенту нужна новость: «Показать Сергею Орлову блок DIFC
       целиком». Глагол — про НАШЕ действие, а не про исход: «Показать», а не «Продать», —
       заголовок не обещает того, чего мы не контролируем. Название разбора остаётся, но
       становится подписью-ярлыком: аргумент перестаёт быть оглавлением.

       Порядок частей — как в судебном акте: сначала резолютивная часть (что предложить и
       первый шаг), мотивировочная ниже и под свёрткой. Её читает тот, кто сомневается, а не
       каждый, кто пробегает список. В свёрнутом виде видна ОДНА самая сильная строка: закрытая
       дверь без единого доказательства оставляет число неподтверждённым. */
    const strongest = (p.basis || [])[0];
    return '<article class="opp' + (p.tone ? ' t-' + p.tone : '') + '">' +
      '<header class="opp-h"><span class="opp-ic">' + I(p.icon) + '</span>' +
      '<div class="opp-kind"><div class="opp-title">' + escAttr(p.title || p.ruleLabel) + '</div>' +
      '<div class="opp-who">' + escAttr(p.client) + (p.role ? ' · ' + escAttr(p.role) : '') + '</div>' +
      '<div class="opp-rule">разбор: ' + escAttr(p.ruleLabel) + '</div></div>' +
      val + '</header>' +
      '<div class="opp-plan">' +
      /* Названный объект — ссылка на его карточку. Брокер читает «Creek Rise, Unit 2703 ·
         1 880 000» и первым делом хочет посмотреть сам юнит; до сих пор это был просто текст,
         и путь к объекту шёл через «Объекты» и поиск по названию. */
      '<div class="opp-line"><span class="opp-lbl">' + I('target') + 'Что предложить</span>' +
      (p.objId
        ? '<button class="opp-t opp-link" data-obj="' + p.objId + '" title="Открыть карточку объекта">' +
          escAttr(p.offer) + I('arrowRight') + '</button>'
        : '<span class="opp-t">' + escAttr(p.offer) + '</span>') + '</div>' +
      '<div class="opp-line"><span class="opp-lbl">' + I('arrowRight') + 'Первый шаг</span>' +
      '<span class="opp-t">' + escAttr(p.act) + '</span></div></div>' +
      '<details class="opp-basis"><summary>' + I('radar') +
      '<span>На чём основано · ' + (p.basis || []).length + ' ' +
      plural((p.basis || []).length, 'признак', 'признака', 'признаков') + '</span>' +
      (strongest ? '<i>' + escAttr(strongest[1]) + '</i>' : '') + I('chevDown') + '</summary>' +
      '<p class="opp-why">' + escAttr(p.why) + '</p>' + basis + '</details>' +
      '<footer class="opp-f"><button class="btn sm primary" data-client="' + p.clientId + '">' +
      I('users') + 'Открыть контакт</button>' +
      '<button class="btn sm" data-cgask="' + escAttr(p.ask || p.act) + '">' + I('sparkle') + 'Поручить Консьержу</button>' +
      (foot || '') + '</footer></article>';
  }
  /* Два вида одного и того же. Сетка — потому что возможностей много и их сравнивают между
     собой: сколько их и какая крупнее, видно только когда они рядом. Колода — потому что их
     разбирают по одной, и смахивание партнёр просил отдельно; оно осталось целиком. */
  function pulseProspects() {
    const list = pulseProspectList();
    if (!list.length) {
      return '<div class="card" style="padding:16px;font-size:12.5px;color:var(--mut)">Возможностей сейчас нет: ни один из двенадцати разборов не нашёл повода. Как только появится — договор подойдёт к сроку, объект освободится, срез рынка разойдётся с районом клиента, — она встанет сюда.</div>';
    }
    /* Счёт и сумма стоят в подписи раздела и повторять их в сорока пикселях ниже незачем:
       один и тот же факт, набранный дважды, читается как два разных. */
    const head = '<div class="qa-row opp-bar">' +
      '<button class="chip' + (S().prospDeck ? '' : ' on') + '" data-act="prospGrid">' + I('grid') + 'Сеткой</button>' +
      '<button class="chip' + (S().prospDeck ? ' on' : '') + '" data-act="prospDeck">' + I('layers') + 'Колодой</button>' +
      '</div>';
    if (!S().prospDeck) {
      /* Тринадцать карточек — четыре тысячи пикселей: «Инсайты» и «Аналитика» уезжали за
         край видимого, и раздел, который читают каждый день, хоронил под собой два
         следующих. Показываются шесть крупнейших, остальные — по требованию, и требование
         называет их число: тихо обрезанный список читается как «это всё».
         Раскрытие сделано <details>, а не кнопкой со скриптом: раздел обязан открываться
         и там, где скрипты не выполняются. */
      const HEAD_N = 6;
      const top = list.slice(0, HEAD_N), rest = list.slice(HEAD_N);
      return head + '<div class="opps pulse-prospects">' + top.map((p) => prospectCard(p)).join('') + '</div>' +
        (rest.length
          ? '<details class="opp-more"><summary>' + I('chevDown') + 'Показать остальные ' + rest.length + ' ' +
            plural(rest.length, 'возможность', 'возможности', 'возможностей') + '</summary>' +
            '<div class="opps pulse-prospects">' + rest.map((p) => prospectCard(p)).join('') + '</div></details>'
          : '');
    }
    const i = Math.min(Math.max(S().prospIdx || 0, 0), list.length - 1);
    const p = list[i];
    // Колода: под верхней карточкой видно, что за ней есть ещё.
    const deck = list.length > 1 ? ' has-deck' : '';
    const nav = '<span class="opp-nav">' +
      '<button class="pcard-nav" data-prosp="prev"' + (i > 0 ? '' : ' disabled') + ' aria-label="Предыдущая">' + I('chevLeft') + '</button>' +
      '<span class="pc-count">' + (i + 1) + ' из ' + list.length + '</span>' +
      '<button class="pcard-nav" data-prosp="next"' + (i < list.length - 1 ? '' : ' disabled') + ' aria-label="Следующая">' + I('chevRight') + '</button></span>';
    return head +
      '<div class="qa-row" style="margin-bottom:10px"><span class="pc-hint">' + I('sparkle') +
      'смахните карточку или листайте стрелками</span></div>' +
      '<div class="pcard-row"><div class="pcard pulse-prospects' + deck + '" data-prospcard="' + p.id + '">' +
      prospectCard(p, nav) + '</div></div>';
  }

  /* Смахнуть карточку — как в колоде. Сделано на pointer-событиях, а не на touch: стенд
     показывают с ноутбука, и жест мышью обязан работать ровно так же, как пальцем. Порог в
     64 пикселя отделяет намеренный жест от дрожи руки; ниже порога карточка возвращается. */
  const SWIPE_MIN = 64;
  function bindProspSwipe() {
    const card = document.querySelector('.pcard[data-prospcard]');
    if (!card || !card.setPointerCapture) return;
    const total = pulseProspectList().length;
    let x0 = null, dx = 0;
    card.addEventListener('pointerdown', (e) => {
      // Кнопки внутри карточки остаются кнопками: перетаскивание начинается с полотна.
      if (e.target.closest && e.target.closest('button, a, input')) return;
      x0 = e.clientX; dx = 0;
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* курсор мог уйти с окна */ }
      card.classList.remove('swipe-out');
      card.classList.add('dragging');
    });
    card.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 30) + 'deg)';
      card.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 520));
    });
    const release = () => {
      if (x0 == null) return;
      const moved = dx;
      x0 = null;
      card.classList.remove('dragging');
      card.classList.add('swipe-out');
      const i = S().prospIdx || 0;
      const go = moved <= -SWIPE_MIN ? Math.min(i + 1, total - 1)
        : (moved >= SWIPE_MIN ? Math.max(i - 1, 0) : i);
      if (go === i) { card.style.transform = ''; card.style.opacity = ''; return; }
      card.style.transform = 'translateX(' + (moved < 0 ? -560 : 560) + 'px) rotate(' + (moved / 22) + 'deg)';
      card.style.opacity = '0';
      S().prospIdx = go;
      // Не `touch()`: он поднимает ревизию данных, и подготовленное Консьержем предложение
      // после простого перелистывания отклонялось бы как «данные изменились с момента предложения».
      setTimeout(() => WS.storeApi.emit(), 170);
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
  }

  // ---- Саммари ------------------------------------------------------------------------------------
  // Блок «Саммари AI» стоит на четырёх листах из семи и там самый ценный элемент. Он собирается
  // ИЗ ПОСЧИТАННЫХ ЧИСЕЛ и называет своё основание: правдоподобный абзац без опоры на данные —
  // это то, ради чего систему потом перестанут открывать.
  function pulseSummary(lines) {
    if (!lines.length) return '';
    return '<div class="pai"><div class="pai-h">' + I('sparkle') + 'Саммари · <span class="badge ai-b">собрано моделью</span></div>' +
      lines.map((t) => '<div class="pai-l">' + t + '</div>').join('') + '</div>';
  }
  const PULSE_TABS = [
    ['deals', 'Сделки', 'briefcase'],
    ['requests', 'Заявки', 'mail'],
    ['clients', 'Клиенты', 'users'],
    ['partners', 'Партнёры', 'handshake'],
    ['cost', 'Стоимость', 'money'],
  ];
  function pulseTabDeals() {
    const all = D().deals || [];
    const live = all.filter((d) => !dealClosed(d) && !dealArchived(d));
    const won = all.filter(dealWon);
    const lost = all.filter((d) => d.stage === 'lost');
    const a = D().analytics;
    const pipeline = Math.round(live.reduce((s, d) => s + (d.amount || 0), 0) / 1e5) / 10;
    const spark = a.sparks.map((v, i) => '<i class="' + (i === a.sparks.length - 1 ? 'on' : '') + '" style="height:' + (30 + v * 4) + '%"></i>').join('');
    return '<div class="tiles dash">' +
      tile('briefcase', 'Сделки в работе', live.length, '', 'span 4', 'по всем воронкам', '', 'accent', 'data-analytics="pipeline"') +
      tile('check', 'Закрыто успешно', won.length, '', 'span 4', won.length ? WS.AED(won.reduce((s, d) => s + (d.amount || 0), 0)) : '—', '', '', 'data-analytics="closed"') +
      /* Четыре плитки ряда открывают окно с записями, а эти две уводили на другой экран — и
         открывали его сверху, мимо обещанного: подпись «причины — в аналитике отдела» не
         показывала причин. Одинаковые на вид плитки обязаны вести себя одинаково, и «показать
         записи» — то, ради чего на цифру и нажимают. */
      tile('warn', 'Проиграно', lost.length, '', 'span 4', 'причина и сумма по каждой', '', '', 'data-analytics="lost"') +
      tile('clock', 'Средний цикл сделки', a.avgCycleDays || 0, ' дн.', 'span 6',
        'книга квартала · в стенде закрыто ' + (won.length + lost.length), '', '', 'data-analytics="cycle"') +
      tile('money', 'Ожидаемая комиссия', WS.AED(computeMetrics().expectedComm), '', 'span 6', 'из сделок в работе', '', '', 'data-analytics="pipeline"') +
      /* Плитка называлась «Воронка сделок», а показывала сумму тех же восьми сделок, что
         сосчитаны плиткой «Сделки в работе» двумя строками выше: два имени у одной величины
         на одной панели. Подпись при этом говорила про тренд за неделю — то есть про
         столбики, а не про число над ними. Теперь и число, и столбики названы каждый своим. */
      '<button class="tile wide" data-analytics="pipeline"><div class="th">' + I('trend') + 'Сумма сделок в работе</div>' +
        '<div class="val">' + pipeline.toLocaleString('ru-RU') + '<span class="u">млн AED</span></div>' +
        '<div class="spark">' + spark + '</div>' +
        '<div class="sub">те же ' + live.length + ' ' + plural(live.length, 'сделка', 'сделки', 'сделок') +
        ' · столбики — новые сделки за 7 дней <span class="trend up">' + I('trend') + '</span></div></button>' +
      '</div>' + pulseSummary(dealsSummaryLines(live, won, lost, a));
  }
  // Строки саммари собираются из тех же чисел, что стоят на плитках. Ни одного утверждения,
  // которого нельзя проверить по записям на этом же экране.
  function dealsSummaryLines(live, won, lost, a) {
    const out = [];
    const sum = live.reduce((x, d) => x + (d.amount || 0), 0);
    if (live.length) {
      out.push('В работе ' + live.length + ' ' + plural(live.length, 'сделка', 'сделки', 'сделок') +
        ' на ' + WS.AED(sum) + '. Ожидаемая комиссия по ним — ' + WS.AED(computeMetrics().expectedComm) + '.');
    }
    // Оценка «что закроется» строится по шагу договора, а не по вере: считаем те, что уже прошли
    // согласование условий. Основание названо прямо — иначе это гадание с видом отчёта.
    const near = live.filter((d) => dealTermsAgreed(d));
    if (near.length) {
      out.push('Ближе всего к закрытию ' + near.length + ' — они уже прошли согласование условий. ' +
        'При среднем цикле ' + (a.avgCycleDays || 0) + ' ' + plural(a.avgCycleDays || 0, 'день', 'дня', 'дней') +
        ' это ориентир на месяц, а не обещание.');
    } else if (live.length) {
      out.push('Согласование условий не прошла ни одна из активных сделок — до закрытия в этом месяце дойти неоткуда.');
    }
    if (lost.length) {
      const why = LOSS_REASONS[0];
      out.push('Проиграно ' + lost.length + '. Самая частая причина по отделу — «' + why.r + '» (' + why.n + ').');
    }
    const noNext = live.filter((d) => !dealHasNextStep(d));
    if (noNext.length) out.push('Без назначенного следующего шага ' + noNext.length + ' — это то, что теряется само.');
    return out;
  }
  function pulseTabRequests() {
    const m = computeMetrics();
    const a = D().analytics;
    // «В работе» — это стадия заявки, а не «в подборке нет выбранного объекта»: по второму
    // признаку проигранные услуги без инвентаря считались живыми, а живая заявка с одним
    // выбранным объектом и открытым остатком — закрытой.
    const open = (D().requests || []).filter((r) => ['closed', 'lost'].indexOf(reqStage(r)) < 0);
    // «Брак» стоит на листе партнёра отдельной строкой: это доля входящих, с которыми работать
    // нельзя — спам и непрофильное. Считается по разбору входящих, а не оценивается.
    const scrapped = (D().inbox || []).filter((it) => (it.stage || 'new') === 'rejected').length;
    const inboxN = (D().inbox || []).length;
    return '<div class="tiles dash">' +
      /* У каждого основания названа его область. На одной панели стояли «из 17 всего» и
         «11 из 70 лидов»: первое — заявки самого стенда, второе — книга квартала по
         источникам. Без подписи это читается как два счёта одного и того же, и вопрос
         «а где ещё 53?» задаёт первый же, кто смотрит внимательно. */
      tile('mail', 'Заявок в работе', open.length, '', 'span 4',
        'из ' + (D().requests || []).length + ' в стенде', '', 'accent', 'data-nav="requests"') +
      tile('target', 'Конверсия заявка → сделка', m.conv, '%', 'span 4',
        m.won + ' из ' + m.leads + ' лидов · книга квартала', '', '', 'data-analytics="conv"') +
      tile('x', 'Брак во входящих', scrapped, '', 'span 4',
        inboxN ? 'из ' + inboxN + ' обращений в разборе' : 'разбирать пока нечего', '', '', 'data-nav="requests"') +
      tile('flame', 'Горячие клиенты', a.hotClients, '', 'span 4', 'ждут вашего шага сегодня', '', '', 'data-analytics="hot"') +
      '<button class="tile wide" data-nav="leads"><div class="th">' + I('target') + 'Отработка лидов</div>' +
        '<div class="val">' + Math.round(a.coverage * 100) + '<span class="u">%</span></div>' +
        '<div class="meter"><i style="width:' + (a.coverage * 100) + '%"></i></div>' +
        '<div class="sub">Связались за неделю: ' + a.weekTouches.done + ' из ' + a.weekTouches.total + ' лидов</div></button>' +
      '</div>' +
      '<div class="section-label" style="margin-top:16px">Качество источника</div>' + srcQualityList() +
      pulseSummary(requestsSummaryLines(m, a, open));
  }
  function requestsSummaryLines(m, a, open) {
    const out = [];
    const all = (D().requests || []);
    out.push('Заявок всего ' + all.length + ', в работе ' + open.length + '. Конверсия в сделку ' + m.conv +
      '% — ' + m.won + ' из ' + m.leads + ' лидов по атрибуции.');
    const best = (m.attribution || []).slice().sort((x, y) => (y.deals / (y.leads || 1)) - (x.deals / (x.leads || 1)))[0];
    if (best && best.leads) {
      out.push('Лучший источник — ' + best.source + ': ' + Math.round((best.deals / best.leads) * 100) +
        '% доходят до сделки при ' + best.leads + ' лидах.');
    }
    const lostReq = all.filter((r) => reqStage(r) === 'lost').length;
    if (lostReq) out.push('Закрыто отказом ' + lostReq + ' ' + plural(lostReq, 'заявка', 'заявки', 'заявок') + '.');
    out.push('Отработка лидов за неделю — ' + a.weekTouches.done + ' из ' + a.weekTouches.total +
      '. Непрокоснувшиеся остаются в «Входящих» на стадии «Не вышли на связь».');
    return out;
  }
  function pulseTabClients() {
    const cl = D().clients || [];
    const byType = (t) => cl.filter((c) => c.ctype === t).length;
    const silent = cl.filter((c) => !lastTouchOf(c.id)).length;
    return '<div class="tiles dash">' +
      tile('users', 'Клиентов в базе', cl.length, '', 'span 4', 'закреплены за вами', '', 'accent', 'data-nav="clients" data-tab="contacts"') +
      tile('trend', 'Инвесторы', byType('investor'), '', 'span 4', 'покупают ради доходности', '', '', 'data-nav="clients" data-tab="contacts"') +
      tile('home', 'Для себя', byType('enduser'), '', 'span 4', 'покупают для проживания', '', '', 'data-nav="clients" data-tab="contacts"') +
      tile('building', 'Собственники', byType('owner'), '', 'span 6', 'сдают или продают свой объект', '', '', 'data-nav="clients" data-tab="contacts"') +
      tile('clock', 'Без единого касания', silent, '', 'span 6', silent ? 'ни одного контакта в истории' : 'все хотя бы раз на связи', '', '', 'data-nav="clients" data-tab="contacts"') +
      '</div>' + pulseSummary(clientsSummaryLines(cl, silent));
  }
  function clientsSummaryLines(cl, silent) {
    const out = [];
    const repeat = cl.filter((c) => (D().deals || []).filter((d) => d.clientId === c.id).length > 1).length;
    out.push('В книге ' + cl.length + ' ' + plural(cl.length, 'контакт', 'контакта', 'контактов') +
      '. Повторных — ' + repeat + ': у них больше одной сделки.');
    const won = cl.filter((c) => hasWonDeal(c.id)).length;
    out.push('С закрытой успехом сделкой ' + won + '. Это та часть базы, к которой возвращаются, а не ищут заново.');
    if (silent) out.push('Без единого касания ' + silent + ' — с них не начиналась работа вовсе; они первыми выпадают из выборок на рассылку.');
    const noConsent = cl.filter((c) => !c.consent).length;
    if (noConsent) out.push('Без согласия на связь ' + noConsent + ' — они исключаются из любой адресной отправки автоматически.');
    return out;
  }
  function pulseTabPartners() {
    const mutual = NET_AGENTS.filter((x) => x.mutual);
    const co = (D().deals || []).filter((d) => d.partnerAgent);
    const coComm = Math.round(co.reduce((s, d) => s + dealCommission(d), 0));
    return '<div class="tiles dash">' +
      tile('handshake', 'Взаимные партнёры', mutual.length, '', 'span 4', 'из ' + NET_AGENTS.length + ' контрагентов в сети', '', 'accent', 'data-nav="partners"') +
      tile('briefcase', 'Сделки в со-брокеридже', co.length, '', 'span 4', co.length ? 'делим комиссию с партнёром' : 'пока ни одной', '', '', 'data-nav="clients" data-tab="deals"') +
      tile('money', 'Комиссия по клубным сделкам', WS.AED(coComm), '', 'span 4', 'до раздела с партнёром', '', '', 'data-analytics="pipeline"') +
      '</div>' +
      '<div class="card" style="padding:14px 16px;margin-top:14px;font-size:12.5px;color:var(--mut)">' +
      'Раздел комиссии с партнёром в демо не считается: сплит согласуется в переписке по каждой сделке отдельно, единого поля под него ещё нет.' +
      '</div>' + pulseSummary(partnersSummaryLines(mutual, co, coComm));
  }
  function partnersSummaryLines(mutual, co, coComm) {
    const out = [];
    const agencies = [];
    NET_AGENTS.forEach((x) => { if (agencies.indexOf(x.agency) < 0) agencies.push(x.agency); });
    out.push('В сети ' + NET_AGENTS.length + ' ' + plural(NET_AGENTS.length, 'контрагент', 'контрагента', 'контрагентов') +
      ' из ' + agencies.length + ' ' + plural(agencies.length, 'агентства', 'агентств', 'агентств') +
      '; взаимных — ' + mutual.length + '.');
    if (co.length) {
      out.push('Сделок в со-брокеридже ' + co.length + ' на ' + WS.AED(coComm) +
        ' комиссии до раздела. Все они пришли по каналу «Клуб».');
    } else {
      out.push('Ни одной сделки в со-брокеридже пока нет — партнёрская сеть используется как справочник, а не как канал.');
    }
    const strong = NET_AGENTS.slice().sort((x, y) => y.deals - x.deals)[0];
    if (strong) out.push('Самый нагруженный партнёр — ' + strong.name + ' (' + strong.agency + '), ' + strong.deals + ' сделок в профиле.');
    return out;
  }
  // Формула партнёра дословно: стоимость лида = маркетинговый бюджет / число лидов; стоимость
  // сделки = расходы / число новых сделок. Расходы в стенде ЕСТЬ — операционная смета месяца.
  // Считаем по ней и говорим, что в неё входит: цифра без состава — этоцифра, которой не верят.
  function marketingSpend() {
    // Из сметы берутся ТОЛЬКО строки привлечения. Тариф CRM и клубный взнос — не маркетинг,
    // и складывать их в стоимость лида значит завышать её на ровном месте.
    const mk = EXPENSES.filter((e) => /листинг|продвижен|реклам/i.test(e[0]));
    return { items: mk, total: mk.reduce((x, e) => x + e[2], 0), all: EXPENSES.reduce((x, e) => x + e[2], 0) };
  }
  function pulseTabCost() {
    const m = computeMetrics();
    const sp = marketingSpend();
    const commPerLead = m.leads ? Math.round((D().attribution || []).reduce((s2, x) => s2 + (x.commission || 0), 0) / m.leads) : 0;
    const cpl = m.leads ? Math.round(sp.total / m.leads) : 0;
    /* Обе доли обязаны считаться по ОДНОЙ совокупности. Стоимость лида делилась на 70 лидов
       книги квартала, а стоимость сделки — на 10 сделок самого стенда: два отношения из разных
       населений, поставленные рядом как одна модель себестоимости, — и итоговая строка внизу
       их же и сравнивала. Совпало это только потому, что чисел оказалось 10 и 11. */
    const bookDeals = m.won;
    const cpd = bookDeals ? Math.round(sp.all / bookDeals) : 0;
    const rows = sp.items.map((e) => '<div class="feed-row"><div class="fi i-mut">' + I(e[3]) + '</div>' +
      '<div class="ft"><div class="t">' + e[0] + '</div><div class="m">' + e[1] + '</div></div>' +
      '<div class="td-amt">' + WS.AED(e[2]) + '</div></div>').join('');
    return '<div class="tiles dash">' +
      tile('money', 'Стоимость лида', WS.AED(cpl), '', 'span 4',
        'бюджет привлечения ' + WS.AED(sp.total) + ' / ' + m.leads + ' лидов · книга квартала', '', 'accent', 'data-analytics="conv"') +
      tile('briefcase', 'Стоимость сделки', WS.AED(cpd), '', 'span 4',
        'вся смета ' + WS.AED(sp.all) + ' / ' + bookDeals + ' закрытых сделок · книга квартала', '', '', 'data-analytics="pipeline"') +
      tile('trend', 'Комиссия на лид', WS.AED(commPerLead), '', 'span 4',
        'выручка на тот же лид · книга квартала', '', '', 'data-analytics="conv"') +
      '</div>' +
      '<div class="card" style="margin-top:14px"><div class="section-label" style="padding:12px 16px 4px">Из чего собран бюджет привлечения</div>' +
      '<div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>' +
      pulseSummary(costSummaryLines(sp, m, cpl, cpd, commPerLead));
  }
  function costSummaryLines(sp, m, cpl, cpd, commPerLead) {
    const out = [];
    out.push('Лид обходится в ' + WS.AED(cpl) + ', приносит ' + WS.AED(commPerLead) + ' комиссии — ' +
      (commPerLead > cpl ? 'привлечение окупается ' + Math.round(commPerLead / Math.max(cpl, 1)) + 'x.'
        : 'привлечение пока не окупается.'));
    out.push('В стоимость сделки взята вся операционная смета месяца — ' + WS.AED(sp.all) +
      '. ФОТ и офис в стенде не заведены, поэтому реальная цифра будет выше этой.');
    const worst = (m.attribution || []).slice().sort((x, y) => (x.deals / (x.leads || 1)) - (y.deals / (y.leads || 1)))[0];
    if (worst && worst.leads) {
      out.push('Дешевле всего сократить расход на «' + worst.source + '»: ' + worst.leads +
        ' лидов дали ' + worst.deals + ' сделок — худшая отдача из источников.');
    }
    return out;
  }
  function pulseAnalytics() {
    const tab = S().pulseTab || 'deals';
    const btns = PULSE_TABS.map((t) => '<button class="seg-b' + (t[0] === tab ? ' on' : '') + '" data-pulsetab="' + t[0] + '">' +
      I(t[2]) + '<span>' + t[1] + '</span></button>').join('');
    let body = '';
    if (tab === 'requests') body = pulseTabRequests();
    else if (tab === 'clients') body = pulseTabClients();
    else if (tab === 'partners') body = pulseTabPartners();
    else if (tab === 'cost') body = pulseTabCost();
    else body = pulseTabDeals();
    return '<div class="pulse-tabs"><div class="seg">' + btns + '</div></div>' +
      '<div class="pulse-panel">' + body + '</div>';
  }

  function viewStart() {
    const st = S();
    const a = D().analytics;
    const hour = WS.fixtures.DEMO_NOW.h;
    const greet = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    const isMgr = st.role === 'manager';
    const firstName = (D().users[st.role].name || '').split(' ')[0];

    // P7: manager gets a distinct "Пульс команды" — team KPIs, funnel, SLA & exceptions — not the agent tiles.
    if (isMgr) {
      const mgrQa = [
        { t: 'Распределить заявки', ic: 'mail', nav: 'leads' },
        { t: 'Согласования', ic: 'check', nav: 'approvals' },
        { t: 'Команда', ic: 'users', nav: 'team' },
        { t: 'Аналитика', ic: 'trend', nav: 'analytics' },
      ].map((q) => '<button class="chip" data-nav="' + q.nav + '">' + I(q.ic) + q.t + '</button>').join('');
      return '<div class="start fadeup">' +
        heroViz('pulse', 'Пульс команды', greet + ', ' + firstName + '. Обзор отдела на смене — план, SLA, распределение и согласования.', { descBig: true }) +
        cgComposer('startPrompt', 'Спросите Консьержа по команде — «кто перегружен», «что нарушает SLA», «сводка за неделю»…', 'startSend', 'prompt-lead') +
        '<div class="qa-row" style="margin-top:16px">' + mgrQa + '</div>' +
        pulseMyGoals() +
        mgrTiles() +
        canonMetrics() +
        '<div class="section-label" style="margin-top:28px">Команда и исключения</div>' + workQueueManager() +
      '</div>';
    }

    const headline = greet + ', ' + firstName + '. ' + ((a.hotClients + a.kpPending) > 0
      ? 'С чего начнём?'
      : 'Срочных дел нет — хороший момент заняться базой.');

    // Пульс (rev.4): порядок разделов по схеме партнёра — цели, «Мои дела», перспективные сделки,
    // аналитика пятью темами. Кнопка «Работать через AI-консьержа» из его схемы не повторена:
    // строка Консьержа уже стоит первой на экране, вторая была бы тем же самым дважды.
    const eventsPlayed = (S().eventsPlayed || []).length;
    const dayHint = '<button class="day-hint" data-act="presenter">' +
      '<div class="dh-ic">' + I('play') + '</div>' +
      '<div class="dh-t"><div class="t">Сюжет дня — что система делает <b>сама, без вас</b></div>' +
      '<div class="m">' + (eventsPlayed ? 'Сыграно событий: ' + eventsPlayed + ' из 5 · продолжить' : 'Ночной лид · входящий звонок · ответ на КП · проверка · развилка') + '</div></div>' +
      I('arrowRight') + '</button>';

    // Разделы партнёра — блоками, а не левым списком: список забирает четверть ширины и
    // оставляет одну рабочую область на семь тем. Свёрнутый блок занимает одну строку.
    const day = pulseDayItems();
    const overdueN = day.filter((x) => x.when === 'overdue').length;
    const todayN = day.filter((x) => x.when === 'today').length;
    const insN = pulseInsights().length;
    const prosp = pulseProspectList();
    /* Сумма по всем карточкам была бы неправдой. У одного клиента поводов несколько, а
       покупка у него одна: «второй юнит», «показывали не то» и «повод в календаре» — это
       три версии одной и той же сделки, и сложенные вместе они давали 930 317 там, где
       столько заработать нельзя. Считается лучшая возможность на клиента, и подпись прямо
       говорит, что это значит, — иначе рядом с «ожидаемой комиссией» из аналитики стоит
       второе число про те же деньги. */
    const prospBest = {};
    prosp.forEach((p) => {
      if (!(p.clientId in prospBest) || prospBest[p.clientId] < (p.value || 0)) prospBest[p.clientId] = p.value || 0;
    });
    const prospClients = Object.keys(prospBest).length;
    const prospSum = Object.keys(prospBest).reduce((a, k) => a + prospBest[k], 0);
    /* Раскладка Пульса. Было: шапка 262 + строка утра 61 + цели 264 — и только с 637-го
       пикселя начинались вкладки, при высоте окна 840. Три четверти первого экрана уходило
       на подводку, а содержимое раздела начиналось за краем видимого.

       Стало — «боковая колонка и содержимое», один из самых старых оконных паттернов: всё,
       что должно быть видно всегда, уходит в узкую колонку слева, а не ложится сверху
       поперёк экрана. В колонке — корешки разделов и под ними цели: место под четырьмя
       корешками всё равно пустовало. Цели остаются на виду с любого раздела, как и просил
       партнёр, но перестают резать экран пополам.

       Строка утра уезжает в «Мои дела» первым блоком: срочное — это дело, а не подводка.
       Сигнал наверху не теряется — на корешке «Мои дела» стоит красная точка. */
    return '<div class="start fadeup">' +
      heroViz('pulse', 'Пульс', headline, { descBig: true, slim: true }) +
      pulseMoved() +
      (() => {
        const items = [
          { key: 'day', title: 'Мои дела', icon: 'check',
            count: todayN + pulseAlerts().length + inboxWaiting().length,
            urgent: overdueN > 0 || pulseAlerts().length > 0 || inboxWaiting().length > 0,
            sub: 'сегодня ' + todayN + (overdueN ? ' · просрочено ' + overdueN : '') + (pulseAlerts().length ? ' · требует внимания ' + pulseAlerts().length : ''),
            body: () => pulseMorningRow() + pulseDay() + alertCards() + pulseNoNextStep() },
          { key: 'prospects', title: 'Перспективные сделки', icon: 'target',
            count: prosp.length,
            sub: prosp.length ? prosp.length + ' ' + plural(prosp.length, 'возможность', 'возможности', 'возможностей') +
              ' у ' + prospClients + ' ' + plural(prospClients, 'клиента', 'клиентов', 'клиентов') +
              ' · ' + WS.AED(prospSum) + ', если по одной сделке на каждого' : '',
            body: () => pulseProspects() },
          { key: 'insights', title: 'Инсайты', icon: 'radar',
            count: insN,
            sub: insN + ' ' + plural(insN, 'инсайт', 'инсайта', 'инсайтов'),
            body: () => dayHint + insightCards() },
          { key: 'analytics', title: 'Аналитика', icon: 'trend',
            count: null,
            sub: 'конверсия ' + computeMetrics().conv + '% · ожидаемая комиссия ' + WS.AED(computeMetrics().expectedComm),
            body: () => pulseAnalytics() },
        ];
        return '<div class="psec">' +
          '<div class="psec-side">' + pulseNav(items) + pulseMyGoals() + '</div>' +
          pulseSectionBody(items) + '</div>';
      })() +
    '</div>';
  }

  function tile(ic, label, val, unit, span, sub, trend, extra, act) {
    const tr = trend ? '<span class="trend ' + trend + '">' + I('trend') + '</span>' : '';
    const inner = '<div class="th">' + I(ic) + label + '</div>' +
      '<div class="val">' + val + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div>' +
      '<div class="sub">' + tr + sub + '</div>';
    return act
      ? '<button class="tile ' + (extra || '') + '" ' + act + '>' + inner + '</button>'
      : '<div class="tile ' + (extra || '') + '">' + inner + '</div>';
  }
  function feedRow(ic, tone, t, m, action) {
    return '<div class="feed-row"><div class="fi ' + tone + '">' + I(ic) + '</div>' +
      '<div class="ft"><div class="t">' + t + '</div><div class="m">' + m + '</div></div><div class="fa">' + (action || '') + '</div></div>';
  }
  // Сроки по документам в Пульсе — комплаенс-видимость off-plan (Документы не на первом уровне,
  // поэтому дедлайны escrow/Oqood/title deed всплывают здесь; клик открывает сделку).
  function docDeadlines() {
    const items = [
      { deal: 'd_anna', kind: 'Escrow receipt', due: 'через 4 дня', warn: true, sub: 'Анна Петрова · Creekline 1208', tip: 'Escrow — эскроу-счёт застройщика: платежи по off-plan идут на защищённый счёт и раскрываются по этапам строительства' },
      { deal: 'd_viktor', kind: 'Oqood · регистрация DLD', due: 'через 9 дней', warn: false, sub: 'Виктор Орлов · Bayline 1603', tip: 'Oqood — предварительная регистрация off-plan сделки в Земельном департаменте Дубая (DLD), до выдачи Title Deed' },
      { deal: 'd_rentbiz', kind: 'Title deed', due: 'через 21 день', warn: false, sub: 'Портфель · DIFC Gate', tip: 'Title Deed — свидетельство о праве собственности, выдаётся DLD при передаче готового объекта' },
    ];
    const rows = items.map((it) => '<div class="feed-row" data-deal="' + it.deal + '" style="cursor:pointer"><div class="fi ' + (it.warn ? 'i-acc' : 'i-info') + '">' + I('doc') + '</div>' +
      '<div class="ft"><div class="t"' + (it.tip ? ' title="' + it.tip + '"' : '') + '>' + it.kind + '</div><div class="m">' + it.sub + '</div></div>' +
      '<div class="fa"><span class="badge ' + (it.warn ? 'warn' : '') + '">' + I('clock') + it.due + '</span></div></div>').join('');
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0">Сроки по документам · off-plan</div>' +
      '<button class="btn sm" data-nav="docs">' + I('doc') + 'Документы</button></div>' +
      '<div class="card"><div class="feed" style="padding:4px 16px 8px">' + rows + '</div></div>';
  }

  // ---------------- CONCIERGE ----------------
  // Concierge agent modes — a "mode" is a reasoning posture (what it reasons about,
  // which sources it pulls, what it returns), NOT a dumb filter.
  const CG_MODES = [
    { k: 'auto', ic: 'sparkle', t: 'Авто', d: 'Консьерж сам определит задачу по запросу' },
    { k: 'roi', ic: 'money', t: 'Инвест-анализ · ROI', d: 'Доходность, payment plan, прирост капитала, сценарии выхода' },
    { k: 'dd', ic: 'shield', t: 'Due-diligence off-plan', d: 'Застройщик, escrow, риск переноса handover, RERA/DLD' },
    { k: 'qual', ic: 'users', t: 'Квалификация из чата', d: 'Из переписки — реальный бюджет, финансирование, срочность' },
    { k: 'cobroking', ic: 'star', t: 'Co-broking · клуб', d: 'Кто держит объект или покупателя в сети + структура сплита' },
    { k: 'cma', ic: 'trend', t: 'Оценка · CMA', d: 'Цена объекта против живых и закрытых компов' },
    { k: 'match', ic: 'target', t: 'Матчмейкинг', d: 'Ранк инвентаря под клиента с обоснованием «почему этот»' },
  ];
  const CG_SOON = [
    { ic: 'grid', t: 'Портфель инвестора', d: 'Следующая покупка, что балансирует активы клиента' },
    { ic: 'play', t: 'Симуляция сделки', d: 'Путь offer → MOU → DLD → handover, где ломается' },
    { ic: 'chat', t: 'Обратный бриф', d: 'Агент сам задаёт уточняющие вопросы, чтобы сузить' },
    { ic: 'trend', t: 'Что изменилось', d: 'Новые запуски и движения цен с прошлого раза' },
    { ic: 'bell', t: 'Watch · стоящий агент', d: 'Пинг, когда появится подходящий объект' },
  ];
  /* Depth is a ceiling, not a promise: it cannot buy the model more thinking
     from a printing CLI, so what it honestly changes is how much is asked for
     and how long the answer may take. The hints used to promise reasoning
     steps and multi-source research, neither of which happened. */
  const CG_DEPTH = [
    { k: 'fast', t: 'Быстро', hint: 'Коротко: две-три фразы, до трёх блоков' },
    { k: 'think', t: 'Размышление', hint: 'Разбор по существу, до восьми блоков' },
    { k: 'deep', t: 'Глубоко', hint: 'Полный разбор с оговорками; отвечает дольше' },
  ];
  /* Which modes keep to analysis and do not offer changes unasked. Told, not
     enforced: the tag used to say «только чтение», and the modes it marked cut
     the change out entirely — so a broker who instructed one from an analysis
     was sent to switch mode and repeat himself. The change was already inert
     until confirmed, so the gate bought nothing and cost that. */
  const CG_READ_ONLY = { roi: true, dd: true, cma: true };
  // Which modes may look outside the stand. Not a decoration: the proxy launches
  // the model with search available only for these, and a figure that comes back
  // from there is marked with its source instead of being passed off as ours.
  const CG_EXTERNAL = { auto: true, roi: true, dd: true, cma: true };
  const cgModeLabel = (k) => (CG_MODES.find((m) => m.k === k) || {}).t || '';
  const cgDepthLabel = (k) => (CG_DEPTH.find((d) => d.k === k) || {}).t || '';
  const cgWrites = (k) => !CG_READ_ONLY[k];
  // Agent workshop — square tiles on the Concierge home. Turn the concierge into YOUR
  // customized agent: build sub-agents, recurring loops, schedules, triggers, sources.
  const CG_WORKSHOP = [
    { k: 'create-agent', ic: 'sparkle', t: 'Создать агента', d: 'Свой под-агент: роль, доступы, тон' },
    { k: 'loop', ic: 'replay', t: 'Автосценарий · луп', d: 'Рутина, которую агент ведёт сам по кругу' },
    { k: 'schedule', ic: 'calendar', t: 'По расписанию', d: 'Задача в заданное время дня или недели' },
    { k: 'trigger', ic: 'bell', t: 'Триггер-автоответ', d: 'Реакция на событие: лид, звонок, цена' },
    { k: 'connect', ic: 'download', t: 'Подключить источник', d: 'WhatsApp, PF/Bayut, фид застройщика' },
    { k: 'playbook', ic: 'star', t: 'Шаблоны и плейбуки', d: 'Сохранённые промпты и сценарии' },
  ];
  const CG_FEATURE_DOC = {
    'create-agent': ['Создать агента', 'Соберите под-агента под конкретную задачу — роль, доступ к источникам и тон общения. Примеры: «Агент по холодным лидам» звонит и квалифицирует; «Аналитик ROI» считает доходность по каждому объекту; «Ночной секретарь» отвечает на входящие 24/7.'],
    'loop': ['Автосценарий · луп', 'Повторяющийся сценарий, который агент выполняет сам по кругу. Примеры: каждое утро — дайджест горящих сделок и просрочек; каждый вечер — обзвон новых лидов; раз в неделю — отчёт по воронке.'],
    'schedule': ['По расписанию', 'Запуск задачи в заданное время. Примеры: в 9:00 — сводка дня; за час до встречи — бриф по клиенту и объекту; в пятницу в 18:00 — недельный отчёт.'],
    'trigger': ['Триггер-автоответ', 'Автоматическая реакция на событие. Примеры: ночной лид → квалифицировать и ответить; входящий звонок → зафиксировать и завести карточку; цена по объекту клиента упала → уведомить.'],
    'connect': ['Подключить источник', 'Источники, на которых работает агент: WhatsApp Business, Property Finder / Bayut, фид застройщика, открытые данные Dubai Pulse. Данные обновляются, дубликаты объединяются.'],
    'playbook': ['Шаблоны и плейбуки', 'Библиотека сохранённых промптов и сценариев: КП, подборка объектов, бриф к встрече, ответ на возражение. Запуск в один клик, редактируются под вас.'],
  };
  function openCgFeature(k) {
    const d = CG_FEATURE_DOC[k];
    if (!d) return;
    openModal(d[0],
      '<p style="margin-top:0">' + d[1] + '</p>' +
      '<div class="prov" style="margin-top:10px"><span class="badge demo">' + I('lock') + 'DEMO</span><span class="badge">' + I('sparkle') + 'Настраивается под вас</span></div>',
      '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn primary" data-act="cgFeatureStub">' + I('check') + 'Настроить</button>');
  }
  // Shared Concierge composer box (tall search field with tools inside) — used by both
  // the Concierge dock and the Пульс lead prompt. Composer state (mode/depth/context)
  // is global, so the two surfaces stay in sync.
  function cgComposer(inputId, placeholder, sendAct, extraCls) {
    const st = S();
    const mode = CG_MODES.find((m) => m.k === (st.cgMode || 'auto')) || CG_MODES[0];
    const depth = st.cgDepth || 'think';
    const ctx = st.cgCtx || [];
    const chips = ctx.map((c, i) => '<span class="cg-chip' + (c.att ? ' att' : '') + '">' + I(c.icon || 'sparkle') + '<span>' + c.label + '</span><button class="x" data-cgctxdel="' + i + '" aria-label="Убрать">' + I('x') + '</button></span>').join('');
    const chipRow = chips ? '<div class="cg-chips">' + chips + '</div>' : '';
    const pop = (kind, html) => st.cgMenu === kind ? '<div class="cg-pop">' + html + '</div>' : '';
    const cv = '<span class="cv">▾</span>';
    const depthSeg = CG_DEPTH.map((x) => '<button class="cg-seg-btn' + (depth === x.k ? ' on' : '') + '" data-cgdepth="' + x.k + '" title="' + x.hint + '">' + x.t + '</button>').join('');
    // Asked at render time: voice.js loads after this file, so a value captured
    // at definition would always be «no».
    const voiceOff = !(WS.voice && WS.voice.canDictate && WS.voice.canDictate());
    return '<div class="prompt composer' + (extraCls ? ' ' + extraCls : '') + '">' +
        chipRow +
        '<div class="prompt-top">' +
          '<span class="ico">' + I('sparkle') + '</span>' +
          '<input id="' + inputId + '" placeholder="' + placeholder + '" autocomplete="off">' +
        '</div>' +
        '<div class="cg-bar">' +
          '<div class="cg-tool-wrap"><button class="cg-tool' + (st.cgMenu === 'attach' ? ' on' : '') + '" data-act="cgAttach" aria-label="Прикрепить материал">' + I('upload') + '<span class="lb">Прикрепить</span></button>' + pop('attach', cgAttachMenu()) + '</div>' +
          '<div class="cg-tool-wrap"><button class="cg-tool mode' + (st.cgMenu === 'mode' ? ' on' : '') + '" data-act="cgModeMenu">' + I(mode.ic) + '<span class="lb">' + mode.t + '</span>' + cv + '</button>' + pop('mode', cgModeMenu()) + '</div>' +
          '<div class="cg-tool-wrap"><button class="cg-tool' + (st.cgMenu === 'ctx' ? ' on' : '') + (ctx.length ? ' has' : '') + '" data-act="cgCtxAdd">' + I('grid') + '<span class="lb">Контекст' + (ctx.length ? ' · ' + ctx.length : '') + '</span>' + cv + '</button>' + pop('ctx', cgContextMenu()) + '</div>' +
          '<div class="cg-actions">' +
            '<div class="cg-seg" role="group" aria-label="Глубина ответа">' + depthSeg + '</div>' +
            /* Dictation is the browser's own, and not every browser has it:
               Firefox has no SpeechRecognition at all, and Safari needs the
               microphone granted to it in System Settings. A button that looks
               live and answers a press with nothing reads as broken software —
               which is exactly how it was reported. So the control says what
               it can do before it is pressed. */
            '<button class="voice' + (voiceOff ? ' off' : '') + '" data-act="voice" title="' +
              (voiceOff ? 'Этот браузер не умеет распознавать речь — наберите текстом или откройте в Chrome' : 'Голосом') +
              '">' + I('mic') + '</button>' +
            '<button class="send" data-act="' + sendAct + '">' + I('arrowUp') + '</button>' +
          '</div>' +
        '</div>' +
        /* On the phone the hands are the scarce thing, not the screen. The mic
           in the bar is a 32px target reachable only with a second hand, so the
           phone gets the control the posture actually calls for: one round
           button, thumb-sized, under everything else. Same data-act, so the
           same handler and the same recording state paint it. */
        '<div class="ptt-row">' +
          '<button class="ptt' + (voiceOff ? ' off' : '') + '" data-act="voice" aria-label="Диктовать Консьержу">' + I('mic') + '</button>' +
          '<span class="ptt-hint">' + (voiceOff ? 'Диктовка недоступна в этом браузере' : 'Нажмите и говорите') + '</span>' +
          /* A label, not a button: pressing it focuses the input, and the input
             being focused is what opens the text row. No state, no handler —
             the same reason the row closes again by itself. */
          '<label class="ptt-kb" for="' + inputId + '">' + I('pencil') + '<span>Набрать текстом</span></label>' +
        '</div>' +
      '</div>';
  }
  function dockPrompt() {
    return '<div class="dock">' +
      cgComposer('cgPrompt', 'Уточнить или поручить ещё…', 'cgSend') +
    '</div>';
  }
  // Mode picker — labeled pill "◆ <mode> ▾" opens this. Each row shows a one-line
  // description so it reads as an intelligent posture, not a filter.
  function cgModeMenu() {
    const cur = S().cgMode || 'auto';
    const row = (m) => '<button class="cg-item mode-row' + (cur === m.k ? ' on' : '') + '" data-cgmode="' + m.k + '">' + I(m.ic) +
      '<span class="cg-item-tx"><b>' + m.t +
      (CG_READ_ONLY[m.k] ? '<span class="cg-ro">не меняет сам</span>' : '') +
      (CG_EXTERNAL[m.k] ? '<span class="cg-ro web">' + I('globe') + 'ищет в сети</span>' : '') +
      '</b><i>' + m.d + '</i></span>' +
      (cur === m.k ? '<span class="ck">' + I('check') + '</span>' : '') + '</button>';
    const soon = (m) => '<div class="cg-item mode-row soon">' + I(m.ic) + '<span class="cg-item-tx"><b>' + m.t + '</b><i>' + m.d + '</i></span><span class="cg-soon">скоро</span></div>';
    return '<div class="cg-pop-inner">' +
      '<div class="cg-sec">Режим Консьержа</div>' + CG_MODES.map(row).join('') +
      '<div class="cg-sec">В разработке</div>' + CG_SOON.map(soon).join('') +
      '</div>';
  }
  // Attach — give the agent raw material to reason over.
  function cgAttachMenu() {
    const it = (ic, lab) => '<button class="cg-item" data-cgatt="' + ic + '~~' + lab + '">' + I(ic) + '<span class="cg-item-tx"><b>' + lab + '</b></span></button>';
    return '<div class="cg-pop-inner">' +
      '<div class="cg-sec">Прикрепить материал</div>' +
      it('whatsapp', 'Переписка с клиентом') +
      it('doc', 'Payment plan · PDF') +
      it('building', 'План этажа / брошюра') +
      it('trend', 'Объявление конкурента') +
      it('lock', 'Паспорт / Emirates ID · KYC') +
      it('mic', 'Голосовое клиента') +
      '</div>';
  }
  // Context — scope + narrowing + sources (multi-select chips). Mode moved to its own pill.
  function cgContextMenu() {
    const D_ = D();
    const sel = new Set((S().cgCtx || []).map((c) => c.label));
    const item = (ic, lab) => '<button class="cg-item' + (sel.has(lab) ? ' on' : '') + '" data-cgctx="' + ic + '~~' + lab + '">' + I(ic) + '<span class="cg-item-tx"><b>' + lab + '</b></span>' + (sel.has(lab) ? '<span class="ck">' + I('check') + '</span>' : '') + '</button>';
    const objs = D_.objects.slice(0, 4).map((o) => item('building', 'Объект: ' + o.name.split(',')[0])).join('');
    const cls = D_.deals.map((d) => { const c = D_.clients.find((x) => x.id === d.clientId) || {}; return item('users', 'Клиент: ' + (c.name || d.title)); }).join('');
    return '<div class="cg-pop-inner">' +
      '<div class="cg-sec">Область поиска</div>' + objs + cls + item('target', 'Район: Business Bay') + item('target', 'Район: JVC') + item('target', 'Район: Dubai Creek Harbour') +
      '<div class="cg-sec">Уточнить</div>' + item('money', 'Бюджет до 2 млн AED') + item('building', '1BR') + item('building', '2BR') + item('money', 'ROI > 5%') + item('calendar', 'Off-plan') + item('check', 'Готовые') +
      '<div class="cg-sec">Источники · коннекторы</div>' + item('download', 'Инвентарь агентства') + item('star', 'Клубные эксклюзивы') + item('building', 'Off-plan застройщиков') + item('lock', 'Портал PF/Bayut · по запросу') + item('doc', 'Открытые данные Dubai Pulse') +
      '</div>';
  }
  // Concierge — 2 columns: dialogs rail (navigation + history) | main (composer hero / active thread).
  function viewConcierge() {
    const st = S();
    const tid = WS.engine.activeThreadId();
    const railOpen = st.cgRailOpen !== false;
    return '<div class="cg2' + (railOpen ? '' : ' cg2--railhidden') + '">' +
      '<aside class="cg2-rail">' + conciergeRail(tid) + '</aside>' +
      '<section class="cg2-main">' +
        '<button class="cg-rail-show" data-act="cgRailToggle" title="Показать диалоги">' + I('chevRight') + 'Диалоги</button>' +
        (tid ? conciergeThreadMain(st) : conciergeHomeMain(st)) +
      '</section>' +
    '</div>';
  }
  function conciergeThreads() {
    const q = (S().conciergeSearch || '').toLowerCase().trim();
    return (WS.engine.threadList() || []).slice()
      .sort((a, b) => (b.unread || 0) - (a.unread || 0))
      .filter((t) => matchConciergeThread(t, q));
  }
  // Determine which group a thread belongs to based on its id namespace
  function getThreadGroup(threadId) {
    if (threadId.startsWith('deal:')) return 'byDeal';
    if (threadId.startsWith('request:')) return 'byRequest';
    if (threadId.startsWith('contact:') || threadId.startsWith('lead:')) return 'byContact';
    if (threadId.startsWith('object:')) return 'byObject';
    if (threadId.startsWith('company:')) return 'byCompany';
    return 'general';
  }
  // Human-readable group names
  const THREAD_GROUPS = {
    byContact: { label: 'По клиентам', icon: 'users' },
    byDeal: { label: 'По сделкам', icon: 'briefcase' },
    byRequest: { label: 'По запросам', icon: 'mail' },
    byObject: { label: 'По объектам', icon: 'building' },
    byCompany: { label: 'По компаниям', icon: 'building' },
    general: { label: 'Общее', icon: 'sparkle' },
  };
  function conciergeRail(activeTid) {
    const q = S().conciergeSearch || '';
    const threads = conciergeThreads();
    const isSearch = q.length > 0;

    const searchBox_ = searchBox('conciergeSearch', 'Поиск по диалогам…', q, 'cg-rail-search');

    // Group threads and build structure
    const groups = {};
    ['byContact', 'byRequest', 'byDeal', 'byObject', 'byCompany', 'general'].forEach((g) => {
      groups[g] = { threads: [], unread: 0 };
    });

    threads.forEach((t) => {
      const group = getThreadGroup(t.id);
      groups[group].threads.push(t);
      groups[group].unread += (t.unread || 0);
    });

    // Render groups
    const collapse = S().cgGroupCollapse || {};
    const renderedGroups = [];

    Object.keys(groups).forEach((groupId) => {
      const group = groups[groupId];
      if (!group.threads.length) return;

      const groupInfo = THREAD_GROUPS[groupId];
      const isCollapsed = collapse[groupId] && !isSearch;
      const activeInGroup = group.threads.some((t) => t.id === activeTid);
      const shouldExpand = activeInGroup || isSearch;
      const actuallyCollapsed = isCollapsed && !shouldExpand;

      let html = '<div class="cg-rail-group">' +
        '<button class="cg-group-head' + (actuallyCollapsed ? ' is-collapsed' : '') + '" data-group-toggle="' + groupId + '">' +
        '<span class="cg-group-expand">' + I(actuallyCollapsed ? 'chevRight' : 'chevDown') + '</span>' +
        '<span class="cg-group-label">' + groupInfo.label + '</span>' +
        '<span class="cg-group-count">' + group.threads.length;
      if (group.unread) html += ' · <span class="unread-badge">' + group.unread + '</span>';
      html += '</span></button>';

      if (!actuallyCollapsed) {
        group.threads.forEach((t) => {
          const on = t.id === activeTid ? ' is-active' : '';
          const time = t.updatedAt ? '<span class="th-time">' + t.updatedAt + '</span>' : '';
          const unread = t.unread ? '<span class="th-unread">' + t.unread + '</span>' : '';
          const preview = (t.preview || (t.items.length + ' сообщений')) + (t.preview ? '…' : '');

          // A deal thread and a client thread are a different perimeter but the same person. The
          // deal row therefore carries the deal's own essence — the thread label already opens with
          // the client's name, so repeating it would say nothing — plus a marker when that client
          // ALSO has a client-level dialogue, which is the jump the client asked to make easy.
          let sub = '';
          if (groupId === 'byDeal') {
            const deal = D().deals.find((d) => d.id === t.id.slice(5));
            if (deal) {
              const essence = (deal.title && deal.title !== (D().clients.find((c) => c.id === deal.clientId) || {}).name) ? deal.title : (deal.sub || '');
              const alsoClient = threads.some((x) => x.id === 'contact:' + deal.clientId);
              sub = '<span class="cg-sub">' + (essence ? escAttr(essence) : '') +
                (alsoClient ? '<span class="cg-link" title="У этого клиента есть и диалог по клиенту">' + I('users') + 'есть диалог по клиенту</span>' : '') + '</span>';
            }
          }

          html += '<button class="cg-rail-row' + on + (t.unread ? ' is-unread' : '') + '" data-thread="' + t.id + '" data-tlabel="' + escAttr(t.label) + '" data-ticon="' + t.icon + '">' +
            '<span class="fi i-acc">' + I(t.icon) + '</span>' +
            '<span class="ft"><span class="t">' + t.label + time + '</span>' + sub + '<span class="m">' + preview + '</span></span>' + unread + '</button>';
        });
      }

      html += '</div>';
      renderedGroups.push(html);
    });

    const rows = renderedGroups.join('') || '<div class="cg-rail-empty">' + I('chat') + '<div>' + (q ? 'По запросу ничего не найдено' : 'Пока нет диалогов.<br>Начните справа — тред создастся по сделке, объекту или лиду.') + '</div></div>';

    return '<div class="cg-rail-head"><span class="section-label cg-rail-count" style="margin:0">Диалоги · ' + threads.length + '</span>' +
      '<div class="cg-rail-head-btns"><button class="btn sm" data-act="newThread">' + I('plus') + 'Новый</button>' +
      '<button class="cg-rail-collapse" data-act="cgRailToggle" title="Свернуть диалоги">' + I('chevLeft') + '</button></div></div>' +
      searchBox_ + '<div class="cg-rail-list">' + rows + '</div>';
  }
  // A keystroke in the rail search repaints the rail list only. A full store emit would remount the
  // chat (see render() -> mountConcierge) and jump the transcript on every character.
  function refreshCgRail() {
    const list = document.querySelector('.cg-rail-list'); if (!list) return;
    const active = WS.engine.activeThreadId();
    const html = conciergeRail(active);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    list.innerHTML = (tmp.querySelector('.cg-rail-list') || { innerHTML: '' }).innerHTML;
    const cnt = document.querySelector('.cg-rail-count');
    if (cnt) cnt.textContent = 'Диалоги · ' + conciergeThreads().length;
  }
  /* Первый экран агента — Консьерж, и он открывается пустым: приветствие, строка, подсказки.
     Список диалогов скрыт, как у любой привычной нейросети, и разворачивается кнопкой.

     Возражение к пустому экрану очевидное: систему открывают, чтобы увидеть систему, а строка
     ввода на белом поле читается как «здесь ничего нет». Отвечают на него подсказки — но не
     выдуманные, а собранные из ЭТИХ данных: они и снимают пустоту, и с первой секунды
     показывают, что Консьерж знает рабочее место, а не отвечает вообще. */
  function conciergeStarters() {
    const out = [];
    const overdue = (D().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue');
    if (overdue.length) out.push(['clock', 'Что просрочено', 'что просрочено']);
    // Клиент, которому уже отобрали объекты, — на нём КП собирается одним поручением.
    const withSel = (D().requests || []).find((r) => (r.offered || []).some((o) => o.state === 'selected'));
    if (withSel) {
      const c = (D().clients || []).find((x) => x.id === withSel.clientId);
      if (c) out.push(['doc', 'Собрать КП по ' + c.name.split(' ')[0], 'собери КП по ' + c.name]);
    }
    const live = (D().deals || []).filter((d) => !dealClosed(d) && !dealArchived(d));
    if (live.length) out.push(['money', 'Сколько сейчас в работе', 'сколько денег в работе по моим сделкам']);
    const silent = (D().clients || []).find((c) => !lastTouchOf(c.id));
    out.push(['users', silent ? 'Кто давно молчит' : 'Кого стоит коснуться', 'кто из клиентов давно не выходил на связь']);
    return out.slice(0, 4).map((s) =>
      '<button class="cg-start" data-cgask="' + escAttr(s[2]) + '">' + I(s[0]) + '<span>' + s[1] + '</span></button>').join('');
  }
  function conciergeHomeMain(st) {
    const me = (D().users[S().role] || {}).name || '';
    const hi = 'Чем помочь' + (me ? ', ' + me.split(' ')[0] : '') + '?';
    const starters = conciergeStarters();
    return '<div class="cg-main-inner cg-home">' +
      '<div class="cg-greet"><div class="cg-greet-w">W</div>' +
      '<h1 class="cg-greet-t">' + hi + '</h1>' +
      '<p class="cg-greet-m">Напишите задачу словами — «собери КП», «подготовь к звонку», «что просрочено». Консьерж видит ваши сделки, клиентов и объекты, поэтому спрашивать «по какому клиенту» не нужно.</p></div>' +
      cgComposer('cgPrompt', 'Опишите задачу или задайте вопрос…', 'cgSend', 'cg-hero') +
      (starters ? '<div class="cg-starters">' + starters + '</div>' : '') +
      conciergeWorkshop(st) +
    '</div>';
  }
  // Workshop demoted to a collapsible strip so the Concierge itself stays the focus.
  function conciergeWorkshop(st) {
    const open = st.cgWorkshopOpen;
    const head = '<button class="cg-shop-head" data-act="cgWorkshop"><span class="section-label" style="margin:0">Мастерская агента</span>' +
      '<span class="cg-shop-sub">Под-агенты, автосценарии, расписания, триггеры</span>' + I(open ? 'chevUp' : 'chevDown') + '</button>';
    if (!open) return '<div class="cg-shop">' + head + '</div>';
    const cards = CG_WORKSHOP.map((c) => '<button class="cg-card" data-act="cgFeature" data-feat="' + c.k + '">' +
      '<span class="cg-card-ic">' + I(c.ic) + '</span><span class="cg-card-t">' + c.t + '</span><span class="cg-card-d">' + c.d + '</span></button>').join('');
    return '<div class="cg-shop open">' + head + '<div class="cg-cards">' + cards + '</div></div>';
  }
  function conciergeThreadMain(st) {
    const t = WS.engine.activeThread() || { label: 'Диалог', icon: 'chat' };
    const tour = st.tour.active ? tourBar() : '';
    const bar = '<div class="thread-bar"><span class="thread-label">' + I(t.icon) + t.label + '</span>' +
      '<button class="btn sm ghost" data-act="newThread" style="margin-left:auto">' + I('plus') + 'Новый</button></div>';
    return '<div class="cg-shell">' + bar + tour + '<div class="concierge cg-thread"><div class="chat" id="chat"></div>' + dockPrompt() + '</div></div>';
  }
  // "Новый диалог" — pick the entity the conversation is about.
  function openNewThread() {
    const dealOpts = D().deals.map((d) => { const c = D().clients.find((x) => x.id === d.clientId) || {}; return '<button class="btn" data-newthread="deal:' + d.id + '" data-tlabel="' + escAttr(c.name || d.title) + ' · сделка" data-ticon="users" style="justify-content:flex-start;width:100%;margin-bottom:6px">' + I('users') + (c.name || d.title) + ' · ' + stageLabel(d.stage) + '</button>'; }).join('');
    const objOpts = D().objects.map((o) => '<button class="btn" data-newthread="object:' + o.id + '" data-tlabel="' + o.name + ' · объект" data-ticon="building" style="justify-content:flex-start;width:100%;margin-bottom:6px">' + I('building') + o.name + '</button>').join('');
    const leadOpts = '<button class="btn" data-newthread="lead:sarah" data-tlabel="Sarah Mansour · ночной лид" data-ticon="moon" style="justify-content:flex-start;width:100%;margin-bottom:6px">' + I('moon') + 'Sarah Mansour · ночной лид</button>' +
      '<button class="btn" data-newthread="general" data-tlabel="Общий" data-ticon="sparkle" style="justify-content:flex-start;width:100%">' + I('sparkle') + 'Общий диалог</button>';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">О чём диалог? Выберите сущность — тред будет привязан к ней и виден из её карточки.</p>' +
      '<div class="section-label">Сделки</div>' + dealOpts +
      '<div class="section-label" style="margin-top:10px">Объекты</div>' + objOpts +
      '<div class="section-label" style="margin-top:10px">Лиды и общее</div>' + leadOpts;
    openModal('Новый диалог', body, '<button class="btn" data-act="closeModal">Отмена</button>');
  }
  function tourBar() {
    const st = S();
    const scn = WS.scenarioById(st.tour.scenarioId);
    if (!scn) return '';
    const total = (scn.flow || []).length;
    const dots = Array.from({ length: total }, (_, i) => '<i class="' + (i <= st.tour.stepIndex ? 'on' : '') + '"></i>').join('');
    const chain = st.tour.chainId ? WS.chainById(st.tour.chainId) : null;
    const chainTag = chain
      ? '<span class="chain-tag">' + I('star') + chain.title + ' · сценарий ' + (st.tour.chainIndex + 1) + ' из ' + st.tour.chainLen + '</span>'
      : '';
    const coach = st.tour.coach
      ? '<div class="tour-coach">' + I('target') + '<span>' + st.tour.coach + '</span></div>' : '';
    return '<div class="tour-wrap"><div class="tour-bar"><span class="code">' + scn.code + '</span>' +
      '<div class="tour-title">' + chainTag + '<div class="t">' + scn.title + '</div></div>' +
      '<div class="prog"><span>Шаг ' + Math.min(st.tour.stepIndex + 1, total) + '/' + total + '</span><div class="steps-dots">' + dots + '</div>' +
      '<button class="tb-btn sm" data-act="restartScene" title="Перезапустить сцену">' + I('replay') + '<span class="txt">Сцена заново</span></button>' +
      '<button class="tb-icon x" data-act="endTour" title="Выйти в свободный режим">' + I('x') + '</button></div></div>' + coach + '</div>';
  }
  // Keep the concierge pinned to the newest message: the scroller is an ancestor of #chat (#main),
  // not #chat itself — so a full re-render on send resets it to the top. Scroll it back to the bottom.
  function scrollConciergeBottom() {
    const c = document.getElementById('chat'); if (!c) return;
    let el = c.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) { el.scrollTop = el.scrollHeight; return; }
      el = el.parentElement;
    }
    const main = document.getElementById('main'); if (main) main.scrollTop = main.scrollHeight;
  }
  // Paints messages by id instead of rebuilding the thread. A streamed reply updates one
  // message many times a second; re-parsing every message on each chunk would be wasteful
  // and would drop scroll position, focus and node identity along the way.
  // Slots are `display: contents` so the message itself stays the flex item and keeps its
  // alignment — see .msg-slot in app.css.
  function syncMessages(container, thread, emptyHtml) {
    const list = (thread && thread.items) || [];
    if (!list.length) { container.innerHTML = emptyHtml; return; }
    const first = container.firstElementChild;
    if (!first || !first.hasAttribute('data-mid')) container.innerHTML = '';
    const wanted = {};
    list.forEach((m) => {
      wanted[m.id] = true;
      let node = container.querySelector('[data-mid="' + m.id + '"]');
      if (!node) {
        node = document.createElement('div');
        node.className = 'msg-slot';
        node.setAttribute('data-mid', m.id);
        node.innerHTML = m.html;
        node.setAttribute('data-h', m.html);
        container.appendChild(node);
      } else if (node.getAttribute('data-h') !== m.html) {
        node.innerHTML = m.html;
        node.setAttribute('data-h', m.html);
      }
    });
    Array.prototype.slice.call(container.querySelectorAll('[data-mid]')).forEach((n) => {
      if (!wanted[n.getAttribute('data-mid')]) n.parentNode.removeChild(n);
    });
  }

  function mountConcierge() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const renderItems = () => { const c = document.getElementById('chat'); if (!c) return; const t = WS.engine.activeThread(); syncMessages(c, t, conciergeThreadEmpty()); if (t) WS.engine.markSeen(t.id); requestAnimationFrame(scrollConciergeBottom); };
    WS.engine.mount(chat, renderItems);
    renderItems();
  }
  function conciergeThreadEmpty() {
    return '<div class="empty">' + I('sparkle') + '<div style="font-weight:700;color:var(--ink)">Начните диалог</div>' +
      '<div style="margin-top:6px">Поручите задачу по этой сущности голосом или текстом.</div></div>';
  }

  // ---------------- CLIENTS & DEALS ----------------
  function viewClients() {
    const st = S();
    const tab = st.clientsTab || 'deals';
    const isMgr = st.role === 'manager';
    const title = tab === 'contacts' ? 'Контакты' : 'Сделки';
    // Пояснение над списком сделок снято: экран объясняет себя переключателем, стадиями и
    // колонками, а абзац занимал первый экран у того, кто открывает раздел десять раз в день.
    const desc = tab === 'contacts'
      ? 'Своя книга: все, с кем уже идёт работа, — люди и компании одним списком. Тип контакта, интерес и способ связи фильтруются; строка компании ведёт на её карточку с KYC и контактными лицами. Найти того, кого у нас ещё нет, — в разделе «Сеть».'
      : '';
    const actions = tab === 'contacts'
      ? '<button class="btn sm" data-act="importContacts">' + I('download') + 'Импорт</button>' +
        '<button class="btn sm primary" data-act="newContact">' + I('plus') + 'Создать контакт</button>'
      : '<button class="btn sm" data-scn="G1">' + I('mic') + 'Запрос голосом</button>' +
        '<button class="btn sm primary" data-act="newDeal">' + I('plus') + 'Создать сделку</button>';
    let body;
    if (tab === 'contacts') body = contactsPeople();
    else {
      // Доска шириной в девять колонок на телефоне не доска, а горизонтальная лента, по которой
      // невозможно вести работу. Ширина решает, а не роль: на узком экране остаётся список — он
      // и есть та же воронка, просто читаемая. Сохранённый выбор доски узкий экран не переубеждает.
      const dview = boardFits() ? (st.dealsView || (isMgr ? 'table' : 'kanban')) : 'table';
      const vtoggle = boardFits() ? '<div class="seg">' +
        '<button class="' + (dview === 'kanban' ? 'on' : '') + '" data-act="dealsView" data-v="kanban">' + I('grid') + 'Канбан</button>' +
        '<button class="' + (dview === 'table' ? 'on' : '') + '" data-act="dealsView" data-v="table">' + I('menu') + 'Таблица</button></div>' : '';
      const funnelSwitch = funnelSwitcher(dview !== 'kanban');
      body = (isMgr ? dealsFunnel() : '') + '<div class="deals-toolbar">' + vtoggle + funnelSwitch + '</div>' + dealFilterBar() + (dview === 'table' ? dealsTable(isMgr) : kanbanDeals(isMgr));
    }
    return head(title, desc, actions) + body;
  }
  // Порог доски написан один раз и читается обоими: CSS прячет её тем же условием, каким JS
  // решает не отдавать. Два порога, разъехавшиеся на пиксель, дают полосу, где доска отрисована
  // и невидима.
  const BOARD_MIN = '(min-width: 900px)';
  function boardFits() {
    const w = (typeof window !== 'undefined') && window;
    if (!w || !w.matchMedia) return true;
    return w.matchMedia(BOARD_MIN).matches;
  }
  // ---- Search and filter helpers ----
  // One search field for every list — same affordance, same shape, wherever a broker looks for
  // something. `extraCls` lets a host (the Concierge rail) tighten the spacing without a second
  // component.
  function searchBox(inputId, placeholder, value, extraCls) {
    const v = value || '';
    return '<div class="prompt obj-search ' + (extraCls || '') + '"><span class="ico">' + I('search') + '</span>' +
      '<input id="' + inputId + '" type="search" placeholder="' + escAttr(placeholder) + '" value="' + escAttr(v) + '" autocomplete="off">' +
      (v ? '<button class="voice" data-act="' + inputId + 'Clear" title="Очистить">' + I('x') + '</button>' : '') + '</div>';
  }
  // Filter helpers
  function matchContactsFilters(c) {
    const st = S().contactsFilters || {};
    // Тип контакта отбирает по ЛЮБОЙ роли, в которой человек выступал, а не только по основной:
    // покупатель по своей сделке и собственник по чужой — один человек, и искать его будут
    // и так, и так.
    if (st.kind && st.kind !== 'all' && contactRoles(c).indexOf(st.kind) < 0) return false;
    if (st.interest && st.interest !== 'all' && c.interest !== st.interest) return false;
    if (st.objType && st.objType !== 'all' && (c.objTypes || []).indexOf(st.objType) < 0) return false;
    if (st.success && st.success !== 'all') {
      const won = hasWonDeal(c.id);
      if (st.success === 'yes' ? !won : won) return false;
    }
    // «Мессенджер» в списке — способ связи, а не приложение: WhatsApp и Telegram оба.
    if (st.channel && st.channel !== 'all') {
      const ch = prefChannel(c);
      const okCh = st.channel === 'whatsapp' ? (ch === 'whatsapp' || ch === 'telegram') : ch === st.channel;
      if (!okCh) return false;
    }
    // Priority filter
    if (st.priority && st.priority !== 'all') {
      const sig = (D().clientSignals || {})[c.id];
      if (st.priority === 'none' ? sig && sig.priority : !sig || sig.priority !== st.priority) return false;
    }
    // Portrait filters
    if (st.psych && st.psych !== 'all') {
      if (st.psych === 'empty') { if (c.psych && c.psych.filled) return false; }
      else {
        const val = st.psych.split(':')[0];
        const sub = st.psych.split(':')[1];
        const p = c.psych || {};
        if (val === 'decision' && p.decision !== sub) return false;
        if (val === 'risk' && p.risk !== sub) return false;
        if (val === 'values') { if (!p.values || p.values.indexOf(sub) < 0) return false; }
      }
    }
    // Район поиска — первое, чем агент сужает книгу: клиент помнится районом, а не портретом.
    if (st.area && st.area !== 'all') {
      const areas = (c.areas || []).concat(
        (D().requests || []).filter((r) => r.clientId === c.id).reduce((a, r) => a.concat(r.areas || []), []));
      if (areas.indexOf(st.area) < 0) return false;
    }
    // Бюджет — вилка, а не точное число: клиента ищут «примерно до двух миллионов».
    if (st.budget && st.budget !== 'all') {
      const b = c.budget || 0;
      const band = st.budget === 'lo' ? (b > 0 && b < 1500000)
        : st.budget === 'mid' ? (b >= 1500000 && b < 3000000)
        : (b >= 3000000);
      if (!band) return false;
    }
    // Состояние работы: открытая заявка, всё закрыто, или человек, с которым мы ещё не начали.
    if (st.state && st.state !== 'all') {
      const rs = (D().requests || []).filter((r) => r.clientId === c.id);
      const open = rs.filter((r) => ['closed', 'lost'].indexOf(reqStage(r)) < 0).length;
      if (st.state === 'open' && !open) return false;
      if (st.state === 'done' && (open || !rs.length)) return false;
      if (st.state === 'none' && rs.length) return false;
    }
    // Согласие на связь: без него адресная отправка заблокирована, и это первый фильтр перед
    // любой рассылкой — иначе агент соберёт список, по которому нельзя написать.
    if (st.consent && st.consent !== 'all') {
      if (st.consent === 'yes' ? c.consent !== true : c.consent === true) return false;
    }
    // Object filter
    if (st.object && st.object !== 'all') {
      const hasObj = (D().deals || []).some((d) => d.clientId === c.id &&
                       (d.objectId === st.object || (d.lots || []).indexOf(st.object) >= 0)) ||
                     (D().requests || []).some((r) => r.clientId === c.id &&
                       (r.offered || []).some((o) => (o && o.id ? o.id : o) === st.object));
      if (!hasObj) return false;
    }
    return true;
  }

  function matchCompaniesFilters(co) {
    const st = S().companiesFilters || {};
    if (st.client && st.client !== 'all') {
      const hasCo = (D().deals || []).some((d) => d.companyId === co.id && d.clientId === st.client);
      if (!hasCo) return false;
    }
    return true;
  }

  // Match threads by label + preview text for Concierge
  function matchConciergeThread(t, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const label = (t.label || '').toLowerCase();
    const preview = (t.preview || '').toLowerCase();
    return label.indexOf(q) >= 0 || preview.indexOf(q) >= 0;
  }

  // Контакты = a people registry with TYPES. "Клиент" is one type; a contact may be a
  // partner, an intermediary, or a company contact. Resolves the deals/clients/contacts dilemma.
  const CONTACT_TYPES = [
    { k: 'all', t: 'Все' }, { k: 'client', t: 'Клиенты' }, { k: 'partner', t: 'Партнёры' },
    { k: 'intermediary', t: 'Посредники' }, { k: 'transferred', t: 'Замещение' },
  ];
  // Три словаря из второго пула замечаний. Тип контакта — ОСНОВНАЯ роль; человек может быть
  // покупателем по одной сделке и партнёром по другой, поэтому фильтр отбирает и по ролям,
  // которые видны в сделках, а не только по записанному основному типу.
  const CONTACT_KINDS = [['buyer', 'покупатель'], ['company', 'компания'], ['tenant', 'арендатор'],
    ['partner', 'агент-партнёр'], ['developer', 'девелопер'], ['owner', 'собственник']];
  const CONTACT_INTERESTS = [['invest', 'инвестиции'], ['live', 'проживание'], ['rent', 'аренда'],
    ['office', 'размещение компании'], ['develop', 'девелопмент']];
  const OBJ_INTERESTS = [['office', 'офисы'], ['retail', 'ритейл'], ['apart', 'апартаменты'],
    ['warehouse', 'склады'], ['land', 'земельный участок'], ['gab', 'ГАБ']];
  const CONTACT_KIND_LABEL = {}; CONTACT_KINDS.forEach((x) => { CONTACT_KIND_LABEL[x[0]] = x[1]; });
  const CONTACT_INTEREST_LABEL = {}; CONTACT_INTERESTS.forEach((x) => { CONTACT_INTEREST_LABEL[x[0]] = x[1]; });
  const OBJ_INTEREST_LABEL = {}; OBJ_INTERESTS.forEach((x) => { OBJ_INTEREST_LABEL[x[0]] = x[1]; });
  // Преобразование текста типа объекта из заявки в ключ словаря OBJ_INTERESTS.
  // Это единственное место, где живёт соответствие текста ключу.
  function objectTypeToKey(textType) {
    const t = String(textType || '').toLowerCase();
    if (/квартир|апартамент|villa|вилла|резидениция|дом/i.test(textType)) return 'apart';
    if (/офис|office|блок|block/i.test(textType)) return 'office';
    if (/ритейл|retail|магазин/i.test(textType)) return 'retail';
    if (/склад|warehouse|хранилище/i.test(textType)) return 'warehouse';
    if (/земл|land|участок/i.test(textType)) return 'land';
    if (/габ|gab/i.test(textType)) return 'gab';
    return 'apart';  // безопасное умолчание
  }
  // Заполнение интереса контакта к типам объектов из его заявок.
  // Правило: если интерес уже установлен (ручное значение), не меняется.
  // Если интерес пуст, заполняется из всех уникальных типов заявок.
  function fillContactObjTypesFromRequests(c) {
    if (c.objTypes && c.objTypes.length > 0) return false;  // ручное значение не менять
    const reqs = (D().requests || []).filter((r) => r.clientId === c.id);
    if (!reqs.length) return false;  // нет заявок — нечего заполнять
    const types = new Set();
    reqs.forEach((r) => {
      if (r.objectType) types.add(objectTypeToKey(r.objectType));
    });
    if (types.size > 0) {
      c.objTypes = Array.from(types);
      return true;
    }
    return false;
  }
  // Тип компании из её собственного словаря («Застройщик», «Фонд», «Агентство») сводится
  // к тому же перечню: иначе один фильтр отбирал бы по двум разным наборам значений.
  function companyKind(co) { return /застройщик|девелопер/i.test(co.kind || '') ? 'developer' : 'company'; }
  // «Есть успешная сделка» — не поле, а вычисление: хранимый признак разошёлся бы с фактами
  // в первый же раз, когда сделку закрыли.
  function hasWonDeal(id) { return (D().deals || []).some((d) => (d.clientId === id || d.companyId === id) && dealWon(d)); }
  // Роли, в которых человек уже выступал: основной тип плюс то, чем он оказался в сделках.
  function contactRoles(c) {
    const out = [c.contactKind].filter(Boolean);
    // Сторона клиента хранится словом («покупатель», «собственник», «арендатор»), а не ключом.
    // Сравнение с ключом не совпадало никогда, и собственник получал роль покупателя.
    const SIDE_ROLE = { 'покупатель': 'buyer', 'собственник': 'owner', 'арендатор': 'tenant' };
    (D().deals || []).forEach((d) => {
      if (d.clientId !== c.id) return;
      const k = SIDE_ROLE[String(d.side || '').toLowerCase()] ||
        ((d.funnel || '').indexOf('rent') >= 0 ? 'tenant' : 'buyer');
      if (out.indexOf(k) < 0) out.push(k);
    });
    if (c.companyId && out.indexOf('company') < 0) out.push('company');
    return out;
  }
  // Text a broker would actually type into a contact search: the person, how to reach them, what
  // they want, where, and the company they sit behind.
  function contactHaystack(c) {
    const deals = (D().deals || []).filter((d) => d.clientId === c.id);
    const cos = deals.map((d) => (D().companies || []).find((x) => x.id === d.companyId)).filter(Boolean);
    return [c.name, c.phone, c.goal, c.horizon, c.lang, (c.areas || []).join(' '),
      clientContactVals(c).email, deals.map((d) => d.title).join(' '), cos.map((x) => x.name).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
  }
  // Компания — контакт того же списка: покупателем бывает и человек, и юрлицо, а искать их
  // брокер идёт в одно место. Объединён СПИСОК, не карточки: у юрлица есть KYC и контактные лица,
  // которых в строке человека негде показать, поэтому строка компании ведёт на карточку компании.
  function companyHaystack(co) {
    return [co.name, co.kind, co.phone, co.email, co.address, co.contactPerson].filter(Boolean).join(' ').toLowerCase();
  }
  function contactsSearchList() {
    const cur = S().contactType || 'all';
    const q = (S().contactsSearch || '').trim().toLowerCase();
    const cl = D().clients || [];
    let list = cl.map((c, i) => ({ id: c.id, name: c.name, c: c, transferred: i >= cl.length - 2 }));
    // Замещение — про переданных клиентов, компании в него не попадают.
    if (cur !== 'transferred') {
      list = list.concat((D().companies || []).map((co) => ({ id: co.id, name: co.name, co: co })));
    } else {
      list = list.filter((p) => p.transferred);
    }
    if (q) list = list.filter((p) => (p.co ? companyHaystack(p.co) : contactHaystack(p.c)).indexOf(q) >= 0);
    return list.filter((p) => (p.co ? matchCompanyFilters(p.co) : matchContactsFilters(p.c)));
  }
  // Компания, за которой стоит человек: связь живёт на сделке, а не на контакте, — один и тот же
  // человек может покупать себе и от лица работодателя.
  function contactCompany(c) {
    const d = (D().deals || []).find((x) => x.clientId === c.id && x.companyId);
    return d ? (D().companies || []).find((x) => x.id === d.companyId) : null;
  }
  // Строка списка клиентов. Кнопка «Сделка» и стадия отсюда убраны: список клиентов — это
  // клиентская книга, а не второй вид воронки. Сделки агент смотрит в сделках; здесь ему нужно
  // найти человека и понять, как с ним связаться.
  function contactRow(p) {
    const c = p.c;
    const k = kycOf(c);
    const last = lastTouchOf(p.id);
    // Под именем — только то, чем человека находят и с чем к нему обращаются: телефон, язык,
    // основной канал, когда говорили в последний раз. Что он ищет, в каком районе и на какую
    // сумму — это запрос, а не свойство человека: оно живёт в заявке, а в книге клиентов
    // работает фильтрами. Стадия, сумма и счётчик заявок убраны отсюда по той же причине.
    // Компания в строке — прямая просьба партнёра: имя, телефон, компания, способ связи.
    const co = contactCompany(c);
    const sub = [c.phone || '', co ? co.name : '', chanMeta(prefChannel(c))[1],
      last ? 'касание ' + last : ''].filter(Boolean).join(' · ');
    const kindB = c.contactKind ? '<span class="badge">' + CONTACT_KIND_LABEL[c.contactKind] + '</span>' : '';
    const right = (p.transferred ? '<span class="badge warn">' + I('users') + 'Передан вам</span>' : '') + kindB +
      '<span class="badge ' + k.st + '">' + I('shield') + k.label + '</span>' +
      (c.consent ? '<span class="badge ok">' + I('check') + 'согласие</span>' : '<span class="badge stop">' + I('lock') + 'нет согласия</span>');
    return '<div class="feed-row" data-client="' + p.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('users') + '</div>' +
      '<div class="ft"><div class="t">' + priorityChip(p.id) + p.name + '</div>' +
      '<div class="m">' + sub + '</div></div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' + right + '</div></div>';
  }
  function contactCompanyRow(p) {
    const co = p.co;
    const deals = (D().deals || []).filter((d) => d.companyId === co.id);
    const sub = [co.phone || '', co.kind || '', deals.length ? 'сделок ' + deals.length : ''].filter(Boolean).join(' · ');
    const kyc = co.kyc === 'verified' ? '<span class="badge ok">' + I('shield') + 'KYC пройден</span>'
      : '<span class="badge warn">' + I('shield') + 'KYC не подтверждён</span>';
    return '<div class="feed-row" data-company="' + co.id + '" style="cursor:pointer"><div class="fi i-mut">' + I('building') + '</div>' +
      '<div class="ft"><div class="t">' + escAttr(co.name) + '</div><div class="m">' + escAttr(sub) + '</div></div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' +
      '<span class="badge">' + CONTACT_KIND_LABEL[companyKind(co)] + '</span>' + kyc + '</div></div>';
  }
  // У компании нет портрета, бюджета и района — фильтры, к ней неприменимые, её не выкидывают,
  // а те, что применимы (тип, успешные сделки), работают на общих основаниях.
  function matchCompanyFilters(co) {
    const st = S().contactsFilters || {};
    if (st.kind && st.kind !== 'all' && companyKind(co) !== st.kind) return false;
    if (st.success && st.success !== 'all') {
      const won = hasWonDeal(co.id);
      if (st.success === 'yes' ? !won : won) return false;
    }
    // Интерес, тип объекта, канал связи, портрет, бюджет, район и приоритет — свойства человека.
    // Компания под такой фильтр не подходит по определению, а не «не подошла».
    const personOnly = ['interest', 'objType', 'channel', 'psych', 'budget', 'area', 'priority', 'state'];
    if (personOnly.some((k) => st[k] && st[k] !== 'all')) return false;
    if (st.consent && st.consent !== 'all') return false;
    return true;
  }
  const CONTACT_FILTER_KEYS = ['priority', 'psych', 'object', 'area', 'budget', 'state', 'consent',
    'kind', 'interest', 'objType', 'success', 'channel'];
  const CHANNEL_PICK_LABEL = { whatsapp: 'мессенджер', phone: 'звонок', email: 'e-mail' };
  // Одной строкой — то, по чему собрана выборка. Это и подпись свёрнутого списка, и то,
  // что уходит Консьержу контекстом: пересказывать выборку словами значит дать ему
  // возможность понять её иначе, чем понял агент.
  // Каждый включённый фильтр обязан попасть в подпись. Подпись называет выборку и агенту,
  // и модели: фильтр, который в неё не попал, превращает суженный список в «Всю книгу»,
  // и отправка уходит не тем, кого агент отобрал.
  const CONTACT_FILTER_WORD = {
    kind: (v) => CONTACT_KIND_LABEL[v] || v,
    interest: (v) => CONTACT_INTEREST_LABEL[v] || v,
    objType: (v) => OBJ_INTEREST_LABEL[v] || v,
    success: (v) => (v === 'yes' ? 'с успешной сделкой' : 'без успешных сделок'),
    channel: (v) => CHANNEL_PICK_LABEL[v] || v,
    consent: (v) => (v === 'yes' ? 'с согласием' : 'без согласия'),
    priority: (v) => 'приоритет ' + v,
    area: (v) => v,
    budget: (v) => ({ lo: 'до 1,5 млн', mid: '1,5–3 млн', hi: 'от 3 млн' })[v] || v,
    state: (v) => ({ open: 'есть открытый запрос', done: 'всё закрыто', none: 'заявок ещё не было' })[v] || v,
    psych: (v) => (v === 'empty' ? 'портрет не заполнен' : String(v).split(':').pop()),
    object: (v) => { const o = (D().objects || []).find((x) => x.id === v); return o ? 'смотрел ' + o.name.split(',')[0] : v; },
  };
  function contactsSelectionLabel() {
    const f = S().contactsFilters || {};
    const parts = CONTACT_FILTER_KEYS
      .filter((k) => f[k] && f[k] !== 'all')
      .map((k) => (CONTACT_FILTER_WORD[k] ? CONTACT_FILTER_WORD[k](f[k]) : k + ': ' + f[k]));
    const q = (S().contactsSearch || '').trim();
    if (q) parts.push('«' + q + '»');
    if (S().contactType === 'transferred') parts.unshift('переданные вам');
    return parts.length ? parts.join(' · ') : 'Вся книга';
  }
  // Массовая отправка по книге — ровно тот случай, где нарушение стоит денег (PDPL в ОАЭ,
  // 152-ФЗ в России). Поэтому «сколько получат» и «сколько исключено» считаются ДО отправки
  // и показываются числом, а не оговоркой мелким шрифтом.
  function contactsReach() {
    const list = contactsSearchList();
    const people = list.filter((p) => !p.co);
    const noConsent = people.filter((p) => !p.c.consent).length;
    return { total: list.length, companies: list.length - people.length, people: people.length,
      noConsent: noConsent, reachable: people.length - noConsent };
  }
  // Строка выборки остаётся НАД списком: она говорит, по чему собрана выдача, и повторяет
  // то же, что ушло Консьержу контекстом. Список под ней больше не сворачивается — диалог
  // открывается доком поверх экрана, и выдача видна во время разговора.
  function contactsChatPanel() {
    if (!S().contactsChat) return '';
    const r = contactsReach();
    const consent = r.noConsent
      ? '<span class="badge stop">' + I('lock') + r.noConsent + ' без согласия — исключены</span>'
      : '<span class="badge ok">' + I('check') + 'у всех есть согласие</span>';
    return '<div class="contacts-sel"><span class="cs-t">' + I('sparkle') + escAttr(contactsSelectionLabel()) + '</span>' +
      '<span class="badge">' + I('users') + r.reachable + ' из ' + r.people + '</span>' + consent +
      (r.companies ? '<span class="badge">' + I('building') + r.companies + ' компаний</span>' : '') +
      '<button class="btn xs ghost" data-act="contactsChatClose">' + I('x') + 'Снять выборку</button></div>' +
      '<div class="ws-flag" style="margin:10px 0 4px">' + I('phone') +
      ' Обзвон Консьерж готовит скриптом для агента: холодный автообзвон запрещён (первое дубайское интервью — «звонить нельзя, писать можно»), и мы его не делаем.</div>';
  }
  // Открытие диалога — состояние экрана, а не переход: маршрут не меняется, «назад» по-прежнему
  // ведёт туда, откуда пришли в книгу, а не в чат.
  function openContactsChat() {
    const r = contactsReach();
    S().contactsChat = true;
    S().cgCtx = [{ icon: 'users', label: contactsSelectionLabel() + ' · ' + r.reachable + ' контактов' }];
    WS.engine.bindThread('contacts:selection', 'Выборка · ' + contactsSelectionLabel(), 'users');
    S().cgDock = true;
    WS.storeApi.emit();
    renderCgDock();
  }
  function closeContactsChat() { S().contactsChat = false; S().cgCtx = []; S().cgDock = false; WS.storeApi.emit(); renderCgDock(); }
  function contactsFilterCount() {
    const f = S().contactsFilters || {};
    return CONTACT_FILTER_KEYS.filter((k) => f[k] && f[k] !== 'all').length;
  }
  // "Nothing found" must say what was searched and offer the way back out.
  function listEmptyState(q, hasFilters, clearAct) {
    const what = q ? 'по запросу «' + escAttr(q) + '»' : 'под выбранные фильтры';
    return '<div class="empty" style="padding:24px 16px">' + I('search') +
      '<div style="font-weight:700;color:var(--ink)">Ничего не нашлось ' + what + '</div>' +
      '<div style="margin-top:4px">Попробуйте короче или другими словами' + (hasFilters ? ', либо снимите фильтры' : '') + '.</div>' +
      '<div class="qa-row" style="justify-content:center;margin-top:12px"><button class="chip" data-act="' + clearAct + '">' + I('x') + 'Сбросить</button></div></div>';
  }
  function contactsListInner() {
    const list = contactsSearchList();
    if (!list.length) return listEmptyState((S().contactsSearch || '').trim(), contactsFilterCount() > 0, 'clearContactsFilters');
    return '<div class="feed" style="padding:0 16px 8px">' + list.map((p) => (p.co ? contactCompanyRow(p) : contactRow(p))).join('') + '</div>';
  }
  function contactsCountLabel() {
    return ((S().contactType === 'transferred') ? 'Замещение' : 'Контакты') + ' · ' + contactsSearchList().length;
  }
  function contactsPeople() {
    const cur = S().contactType || 'all';
    const q = S().contactsSearch || '';
    const f = S().contactsFilters || {};
    const open = !!S().contactsFiltersOpen;
    const n = contactsFilterCount();

    const FILTERS = [{ k: 'all', t: 'Все контакты' }, { k: 'transferred', t: 'Замещение' }];
    const on = ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"';
    const typeChips = FILTERS.map((ct) => '<button class="chip' + (cur === ct.k ? '' : ' mut') + '" data-contacttype="' + ct.k + '"' +
      (cur === ct.k ? on : '') + '>' + ct.t + '</button>').join('');
    const prio = ['all', 'A', 'B', 'C'].map((k) => '<button class="chip' + ((f.priority || 'all') === k ? '' : ' mut') +
      '" data-contactfilter="priority:' + k + '"' + ((f.priority || 'all') === k ? on : '') + '>' +
      (k === 'all' ? 'Любой приоритет' : 'Приоритет ' + k) + '</button>').join('');

    // Portrait and object filters sit behind a disclosure so the default view stays calm; the toggle
    // carries the count, so an applied filter is never invisible.
    const toggle = '<button class="chip' + (n ? '' : ' mut') + '" data-act="contactsFiltersToggle"' + (n ? on : '') + '>' +
      I('menu') + 'Фильтры' + (n ? ' · ' + n : '') + I(open ? 'chevUp' : 'chevDown') + '</button>';
    const clear = (n || q) ? '<button class="view-clear" data-act="clearContactsFilters">' + I('x') + 'сбросить</button>' : '';
    const cgBtn = '<button class="chip" data-act="contactsChatOpen">' + I('sparkle') + 'Поручить Консьержу выборку</button>';
    // Диалог занимает экран целиком: список и фильтры сворачиваются в одну строку над ним,
    // и она же — путь назад. Это тот же механизм, что в карточке сделки.
    const selBar = contactsChatPanel();

    let panel = '';
    if (open) {
      const psychOpts = [['all', 'Любой портрет'], ['empty', 'портрет не заполнен']]
        .concat(PSYCH_OPTS.decision.map((d) => ['decision:' + d, d]))
        .concat(PSYCH_OPTS.risk.map((r) => ['risk:' + r, r]))
        .concat(PSYCH_OPTS.values.map((v) => ['values:' + v, 'важно: ' + v]));
      const objOpts = [['all', 'Любой объект']].concat((D().objects || []).map((o) => [o.id, o.name.split(',')[0]]));
      // Районы собираются из данных, а не пишутся списком: район, которого нет ни у кого, —
      // это пункт меню, который всегда даёт пустой экран.
      const areaSet = [];
      (D().clients || []).forEach((c) => (c.areas || []).forEach((a) => { if (areaSet.indexOf(a) < 0) areaSet.push(a); }));
      (D().requests || []).forEach((r) => (r.areas || []).forEach((a) => { if (areaSet.indexOf(a) < 0) areaSet.push(a); }));
      const areaOpts = [['all', 'Любой район']].concat(areaSet.sort().map((a) => [a, a]));
      const budgetOpts = [['all', 'Любой бюджет'], ['lo', 'до 1,5 млн'], ['mid', '1,5–3 млн'], ['hi', 'от 3 млн']];
      const stateOpts = [['all', 'Любое состояние'], ['open', 'есть открытый запрос'],
        ['done', 'всё закрыто'], ['none', 'заявок ещё не было']];
      const consentOpts = [['all', 'Согласие — неважно'], ['yes', 'есть согласие на связь'], ['no', 'нет согласия']];
      const kindOpts = [['all', 'Любой тип контакта']].concat(CONTACT_KINDS);
      const interestOpts = [['all', 'Любой интерес']].concat(CONTACT_INTERESTS);
      const objTypeOpts = [['all', 'Любой тип объекта']].concat(OBJ_INTERESTS);
      const successOpts = [['all', 'Успешные сделки — неважно'], ['yes', 'есть закрытая успехом'], ['no', 'успешных ещё нет']];
      // «Мессенджер» — это WhatsApp и Telegram вместе: агент выбирает способ, а не приложение.
      const channelOpts = [['all', 'Любой способ связи'], ['whatsapp', 'мессенджер'], ['phone', 'звонок'], ['email', 'e-mail']];
      panel = '<div class="list-filters">' +
        '<label class="lf-fld"><span>Тип контакта</span>' + miniSel('cfKind', f.kind || 'all', kindOpts) + '</label>' +
        '<label class="lf-fld"><span>Интерес сделок</span>' + miniSel('cfInterest', f.interest || 'all', interestOpts) + '</label>' +
        '<label class="lf-fld"><span>Интерес к типу объектов</span>' + miniSel('cfObjType', f.objType || 'all', objTypeOpts) + '</label>' +
        '<label class="lf-fld"><span>Успешные сделки</span>' + miniSel('cfSuccess', f.success || 'all', successOpts) + '</label>' +
        '<label class="lf-fld"><span>Предпочитаемый способ связи</span>' + miniSel('cfChannel', f.channel || 'all', channelOpts) + '</label>' +
        '<label class="lf-fld"><span>Район поиска</span>' + miniSel('cfArea', f.area || 'all', areaOpts) + '</label>' +
        '<label class="lf-fld"><span>Бюджет</span>' + miniSel('cfBudget', f.budget || 'all', budgetOpts) + '</label>' +
        '<label class="lf-fld"><span>Состояние работы</span>' + miniSel('cfState', f.state || 'all', stateOpts) + '</label>' +
        '<label class="lf-fld"><span>Связь</span>' + miniSel('cfConsent', f.consent || 'all', consentOpts) + '</label>' +
        '<label class="lf-fld"><span>Портрет клиента</span>' + miniSel('cfPsych', f.psych || 'all', psychOpts) + '</label>' +
        '<label class="lf-fld"><span>Смотрел объект</span>' + miniSel('cfObject', f.object || 'all', objOpts) + '</label>' +
        '<div class="lf-hint">Фильтры складываются с поиском. Поиск по клиенту идёт строкой — имя, телефон, цель, район, компания.</div></div>';
    }

    const note = cur === 'transferred'
      ? '<div class="ws-flag" style="margin:0 0 12px">' + I('users') + ' Клиенты, переданные вам от коллеги на время его отсутствия. Режим замещения включается в Настройках.</div>' : '';

    return selBar + '<div class="qa-row" style="margin-bottom:12px">' + typeChips + '</div>' + note +
      searchBox('contactsSearch', 'Поиск: имя, телефон, email, цель, район, компания…', q) +
      '<div class="qa-row" style="margin:10px 0 0;align-items:center">' + prio + '<span class="df-sep"></span>' + toggle + clear + cgBtn + '</div>' + panel +
      '<div class="card" style="margin-top:12px"><div class="section-label contacts-count" style="padding:12px 16px 4px">' + contactsCountLabel() + '</div>' +
      '<div class="contacts-list">' + contactsListInner() + '</div></div>';
  }
  function refreshContacts() {
    const box = document.querySelector('.contacts-list'); if (!box) return;
    box.innerHTML = contactsListInner();
    const cnt = document.querySelector('.contacts-count');
    if (cnt) cnt.textContent = contactsCountLabel();
  }
  // R7: saved deterministic views — same query → same list. Applied on top of the funnel filter.
  const SAVED_VIEWS = [
    { k: 'nocontact', label: 'Без движения сегодня', pred: (d) => d.stageDays >= 1 && !dealClosed(d) },
    { k: 'nonext', label: 'Без плана действий', pred: (d) => !dealClosed(d) && !d.nextDue },
    { k: 'commissions', label: 'Ожидаемые комиссии', pred: (d) => !dealClosed(d) && (d.amount || 0) > 0 },
    // «Без документов» = договор ещё не подписан: подготовка и бронь. Дальше документ есть
    // по определению шага, и вид, который ловил бы там пустоту, ловил бы ошибку данных, а не работу.
    { k: 'nodocs', label: 'Без документов', pred: (d) => ['prep', 'book'].indexOf(d.stage) >= 0 },
    { k: 'stuck', label: 'Застряли в стадии', pred: (d) => d.stageDays >= 5 },
  ];
  function activeViewPred() { const v = SAVED_VIEWS.find((x) => x.k === S().savedView); return v ? v.pred : null; }
  function savedViewsBar() {
    const cur = S().savedView;
    const pills = SAVED_VIEWS.map((v) => { const n = (D().deals || []).filter(v.pred).length; return '<button class="view-pill' + (v.k === cur ? ' on' : '') + '" data-savedview="' + v.k + '">' + v.label + '<span class="vp-n">' + n + '</span></button>'; }).join('');
    return '<div class="views-bar"><span class="vb-label">' + I('menu') + 'Виды:</span>' + pills +
      (cur ? '<button class="view-clear" data-savedview="' + cur + '">' + I('x') + 'сбросить</button>' : '') +
      '<span class="vb-hint">Консьерж может создать вид: «покажи сделки без документов»</span></div>';
  }
  // R2: funnel switcher — each funnel is the same 4-column board, columns relabeled as its milestones.
  // Переключатель воронок живёт в обоих видах. Раньше он рисовался только на доске, и переход
  // в список выглядел как потеря выбора — партнёр записал это дефектом, и он прав.
  // Разница между видами одна: у доски колонки берутся из воронки, поэтому «все» там невозможны;
  // в списке «Все воронки» — состояние по умолчанию, иначе на телефоне, где список единственный
  // вид, агент по умолчанию видел бы только продажи и не понимал, куда делось остальное.
  function funnelSwitcher(forList) {
    const fk = S().dealFunnel || 'sale';
    const all = forList && S().dealFunnelAll !== false;
    const pill = (on, attr, label, n) => '<button class="fn-pill' + (on ? ' on' : '') + '" ' + attr + '>' + label +
      (n == null ? '' : '<span class="fn-n">' + n + '</span>') + '</button>';
    const btns = (WS.FUNNELS || []).map((f) => {
      const n = D().deals.filter((d) => (d.funnel || 'sale') === f.k).length;
      return pill(!all && f.k === fk, 'data-funnel="' + f.k + '"', f.label, n);
    }).join('');
    const allPill = forList ? pill(all, 'data-funnel="all"', 'Все воронки', (D().deals || []).length) : '';
    return '<div class="funnel-switch">' + allPill + btns + '</div>';
  }
  // Воронка списка: выбранная, либо ничего, если стоит «все».
  function listFunnel() { return S().dealFunnelAll === false ? (S().dealFunnel || 'sale') : null; }
  // Deal filters (budget / source) — combined with the funnel + saved-view predicate on the board.
  // Всё, по чему агент ищет сделку вслух: имя клиента, название, суть, объект и его проект.
  // Лоты входят наравне с основным объектом — многолотовую сделку ищут по любому из них.
  function dealSearchHay(d) {
    const c = D().clients.find((x) => x.id === d.clientId);
    const ids = (d.lots && d.lots.length ? d.lots : [d.objectId]).filter(Boolean);
    const objs = ids.map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    return [d.title, d.sub, d.goal, c && c.name]
      .concat(objs.map((o) => o.name)).concat(objs.map((o) => o.project))
      .filter(Boolean).join(' ').toLowerCase();
  }
  function dealExtraPred(d) {
    // Архив — это «не участвует в работе»: с доски, из списка и из сумм такая сделка уходит.
    // Иначе пометка была бы косметикой, а партнёр просил убрать запись с глаз, а не покрасить её.
    if (dealArchived(d) !== !!S().dealArchivedOnly) return false;
    const from = parseInt(S().dealBudFrom, 10) || 0, to = parseInt(S().dealBudTo, 10) || 0, src = S().dealSrc || 'all';
    const q = (S().dealSearch || '').trim().toLowerCase();
    if (q && dealSearchHay(d).indexOf(q) < 0) return false;
    if (src !== 'all' && d.source !== src) return false;
    if ((S().dealObjType || 'all') !== 'all' && d.objectType !== S().dealObjType) return false;
    if ((S().dealReadiness || 'all') !== 'all' && d.readiness !== S().dealReadiness) return false;
    if ((S().dealAgent || 'all') !== 'all' && d.agent !== S().dealAgent) return false;
    const a = d.amount || 0;
    if (from && a < from) return false;
    if (to && a > to) return false;
    return true;
  }
  function dealFilterCount() {
    return ['dealSrc', 'dealObjType', 'dealReadiness', 'dealAgent', 'dealStage']
      .filter((k) => S()[k] && S()[k] !== 'all').length + ((S().dealBudFrom || S().dealBudTo) ? 1 : 0)
      + ((S().dealSearch || '').trim() ? 1 : 0);
  }
  function dealFilterBar() {
    const src = S().dealSrc || 'all';
    const chip = (on, attr, l) => '<button class="chip' + (on ? '' : ' mut') + '" ' + attr + (on ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + l + '</button>';
    // Бюджет — поля «от»/«до» (числа вводятся, а не выбираются из готовых диапазонов).
    const budget = '<span class="deal-bud"><span class="deal-bud-lbl">Бюджет, AED</span>' +
      '<input id="dealBudFrom" class="mini-input" type="text" inputmode="numeric" value="' + (S().dealBudFrom || '') + '" placeholder="от">' +
      '<span class="deal-bud-dash">—</span>' +
      '<input id="dealBudTo" class="mini-input" type="text" inputmode="numeric" value="' + (S().dealBudTo || '') + '" placeholder="до"></span>';
    const srcs = Array.from(new Set((D().deals || []).map((d) => d.source).filter(Boolean)));
    // Значения собираются из самих сделок: пункт, под который нет ни одной, — мёртвый выбор.
    const uniq = (f) => Array.from(new Set((D().deals || []).map(f).filter(Boolean)));
    const selOf = (id, cur, opts) => '<label class="lf-fld lf-inline"><span>' + opts[0][2] + '</span>' +
      miniSel(id, cur, opts.map((o) => [o[0], o[1]])) + '</label>';
    const objTypes = [['all', 'Любой тип', 'Тип объекта']].concat(uniq((d) => d.objectType).sort().map((t) => [t, t, '']));
    const readiness = [['all', 'Любая', 'Готовность']].concat(uniq((d) => d.readiness).sort().map((t) => [t, t, '']));
    const agents = [['all', 'Все агенты', 'Агент']].concat(uniq((d) => d.agent).map((a) => [a, agentName(a), '']));
    // Источники были чипами в первом ряду — самый шумный элемент экрана при десятке источников.
    const sources = [['all', 'Все источники', 'Источник']].concat(srcs.sort().map((x) => [x, x, '']));
    // Стадии — той воронки, которую сейчас смотрят: пункт под чужую воронку это мёртвый выбор.
    const stagePath = (WS.DEAL_STEPS && WS.DEAL_STEPS[WS.contractKindFor(S().dealFunnel || 'sale')]) || [];
    const stages = [['all', 'Любая стадия', 'Стадия']].concat(stagePath.map((k) => [k, stageLabel(k)])
      .concat([['won', stageLabel('won')], ['lost', stageLabel('lost')]]).map((x) => [x[0], x[1], '']));
    const isMgr = S().role === 'manager';
    // Поиска по сделкам не было вовсе — а он первое, чем агент пользуется, когда сделок больше экрана.
    const search = '<div class="prompt obj-search" style="flex:1 1 220px;min-width:180px"><span class="ico">' + I('search') + '</span>' +
      '<input id="dealSearch" placeholder="Поиск: клиент, сделка, объект…" autocomplete="off" value="' + escAttr(S().dealSearch || '') + '"></div>';
    return '<div class="qa-row deal-filters">' + search + budget + '</div>' +
      '<div class="qa-row deal-filters deal-filters-2">' +
      selOf('dealStage', S().dealStage || 'all', stages) +
      selOf('dealSrc', S().dealSrc || 'all', sources) +
      selOf('dealObjType', S().dealObjType || 'all', objTypes) +
      selOf('dealReadiness', S().dealReadiness || 'all', readiness) +
      (isMgr ? selOf('dealAgent', S().dealAgent || 'all', agents) : '') +
      // Переключатель архива — единственный путь обратно к убранной сделке. Без него архив
      // означал бы «спрятать навсегда», а «Вернуть из архива» было бы недостижимой кнопкой.
      archiveToggle() +
      (dealFilterCount() ? '<button class="view-clear" data-act="clearDealFilters">' + I('x') + 'сбросить · ' + dealFilterCount() + '</button>' : '') +
      '</div>';
  }
  function archiveToggle() {
    const n = (D().deals || []).filter(dealArchived).length;
    const on = !!S().dealArchivedOnly;
    if (!n && !on) return '';                          // пустого архива в панели фильтров нет
    return '<button class="chip' + (on ? '' : ' mut') + '" data-act="dealsArchive"' +
      (on ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') +
      '>' + I('lock') + 'Архив · ' + n + '</button>';
  }
  function agentName(id) { const u = D().users; for (const k in u) { if (u[k].id === id) return u[k].name; } const m = TEAM.find((x) => x.id === id); return m ? m.name : (id || '—'); }
  function dealObject(d) { return d.objectId ? D().objects.find((o) => o.id === d.objectId) : null; }
  function dealPhoto(d) { const o = dealObject(d); const src = WS.photos && ((o && WS.photos[o.id]) || WS.photos.o_creekline); return src; }
  function dealHot(d) {
    if (d.hot) return true;
    if ((d.tags || []).some((t) => /просроч|ждёт|горит/i.test(t))) return true;
    return tasksOfDeal(d).some((t) => t.status !== 'done' && (t.when === 'overdue' || t.when === 'today'));
  }
  // ============================================================================================
  // Сводная воронка руководителя идёт по всей книге, а не по одним сделкам: половина работы
  // живёт в заявках, и после разделения двух уровней первые два отсека остались бы пустыми —
  // руководитель видел бы «ноль в первом контакте» при десяти заявках в работе.
  //
  // Отсеки заявок считаются по вычисленной стадии заявки, отсеки сделок — по шагу договора.
  // Закрытая заявка не считается нигде: она уже представлена своими сделками, и учесть её ещё
  // раз значило бы посчитать одну сделку дважды.
  // ============================================================================================
  const BOOK_BANDS = [
    { k: 'intake', of: 'request', label: 'Заявки в работе', stages: ['new', 'qual'],
      gate: 'Запрос снят, критерии известны' },
    { k: 'engage', of: 'request', label: 'Предложение и переговоры', stages: ['offer', 'meet', 'talks'],
      gate: 'Предложение отправлено, условия обсуждаются' },
    { k: 'papers', of: 'deal', label: 'Договор и деньги', stages: ['prep', 'book', 'sign', 'reg', 'exec'],
      gate: 'Подписание, оплата, регистрация' },
    { k: 'result', of: 'deal', label: 'Исход', stages: ['won', 'lost'], gate: 'Успех или проигрыш' },
  ];
  function bandOf(stage) {
    const b = BOOK_BANDS.find((x) => x.stages.indexOf(stage) >= 0);
    return b ? b.k : 'intake';
  }
  // Consolidated funnel for the manager — the whole team's book, grouped into control cut-offs.
  function dealsFunnel() {
    const ds = D().deals;
    // Pipeline is what is still in play. A won deal sitting inside it reports finished business as
    // forecast — the exact confusion the won/lost split exists to remove.
    const rs = D().requests || [];
    const live = ds.filter((d) => !dealClosed(d) && !dealArchived(d));
    const totalVal = live.reduce((a, d) => a + (d.amount || 0), 0);
    // Бюджет заявки — намерение клиента, сумма сделки — согласованная цифра. Складывать их в
    // один пайплайн значит выдать надежду за прогноз, поэтому потенциал стоит отдельной строкой.
    const openReqs = rs.filter((r) => ['closed', 'lost'].indexOf(reqStage(r)) < 0);
    const potential = openReqs.reduce((a, r) => a + (r.budget || 0), 0);
    const cells = BOOK_BANDS.map((b) => {
      const isReq = b.of === 'request';
      const list = isReq ? rs.filter((r) => b.stages.indexOf(reqStage(r)) >= 0)
                         : ds.filter((d) => b.stages.indexOf(d.stage) >= 0);
      const val = list.reduce((a, x) => a + (isReq ? (x.budget || 0) : (x.amount || 0)), 0);
      // Внутри отсека разбивка по стадиям остаётся — она просто не заслуживает своих коробок.
      const inner = b.k === 'result'
        ? [list.filter(dealWon).length ? list.filter(dealWon).length + ' успех' : '',
           list.filter((d) => d.stage === 'lost').length ? list.filter((d) => d.stage === 'lost').length + ' проигрыш' : '',
           rs.filter((r) => reqStage(r) === 'lost').length ? rs.filter((r) => reqStage(r) === 'lost').length + ' отказ по заявке' : ''
          ].filter(Boolean).join(' · ')
        : b.stages.map((k) => ({ k: k, n: isReq ? list.filter((r) => reqStage(r) === k).length : list.filter((d) => d.stage === k).length }))
            .filter((x) => x.n)
            .map((x) => (isReq ? reqStageLabel(x.k, list.find((r) => reqStage(r) === x.k)) : stageLabel(x.k)) + ' ' + x.n).join(' · ');
      return '<div class="fn-cell' + (b.k === 'result' ? ' fn-cell-end' : '') + '">' +
        '<div class="fn-n">' + list.length + '</div>' +
        '<div class="fn-l">' + b.label + '</div>' +
        '<div class="fn-v">' + (val ? WS.AED(val) + (isReq ? ' · бюджет' : '') : '—') + '</div>' +
        '<div class="fn-in">' + (inner || 'пусто') + '</div>' +
        '<div class="fn-gate">' + b.gate + '</div></div>';
    }).join('');
    const byAgent = {};
    ds.forEach((d) => { const a = d.agent || 'u_none'; (byAgent[a] = byAgent[a] || []).push(d); });
    const agentRows = Object.keys(byAgent).map((a) => {
      const list = byAgent[a]; const val = list.reduce((x, d) => x + (d.amount || 0), 0); const hot = list.filter(dealHot).length;
      return '<div class="wl"><div class="who">' + agentName(a) + '</div><div class="bar"><i style="width:' + Math.min(100, list.length * 25) + '%"></i></div>' +
        '<div class="n">' + list.length + ' сдел. · ' + WS.AED(val) + (hot ? ' · <span style="color:var(--stop)">' + hot + ' ' + I('flame') + '</span>' : '') + '</div></div>';
    }).join('');
    return '<div class="card pad" style="margin-bottom:16px"><div class="section-label">Сводная воронка команды</div>' +
      '<div class="funnel funnel-bands">' + cells + '</div>' +
      '<div class="prov" style="margin:10px 0 4px"><span class="badge acc">' + I('money') + 'Сделки в работе: ' + WS.AED(totalVal) + '</span>' +
      '<span class="badge">' + I('mail') + 'Потенциал заявок: ' + WS.AED(potential) + '</span>' +
      '<span class="badge">' + I('briefcase') + live.length + ' ' + plural(live.length, 'активная сделка', 'активные сделки', 'активных сделок') + '</span>' +
      '<span class="badge">' + I('users') + Object.keys(byAgent).length + ' ' + plural(Object.keys(byAgent).length, 'агент', 'агента', 'агентов') + '</span></div>' +
      conversionRow() +
      '<div class="section-label" style="margin-top:10px">По агентам</div><div class="workload">' + agentRows + '</div></div>';
  }
  // ============================================================================================
  // Две конверсии, и это ДВЕ РАЗНЫЕ величины. «Заявка → сделка» считается по заявкам: одна
  // заявка даёт одно наблюдение, даже если из неё вышло три договора, — иначе клиент, купивший
  // два лота в разных ЖК, поднимал бы конверсию вдвое, ничего не изменив в работе агента.
  // «Сделка → успех» считается по сделкам: наблюдений столько, сколько договоров.
  // Одним числом их не показать, поэтому и стоят рядом с явными знаменателями.
  // ============================================================================================
  function conversionRow() {
    const rs = D().requests || [], ds = D().deals || [];
    const settled = rs.filter((r) => ['closed', 'lost'].indexOf(reqStage(r)) >= 0);
    const converted = settled.filter((r) => ds.some((d) => d.requestId === r.id));
    const closedDeals = ds.filter(dealClosed);
    const wonDeals = closedDeals.filter(dealWon);
    const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
    const cell = (label, a, b, unit) =>
      '<div class="cv-cell"><div class="cv-n">' + pct(a, b) + '</div>' +
      '<div class="cv-l">' + label + '</div>' +
      '<div class="cv-d">' + a + ' из ' + b + ' ' + unit + '</div></div>';
    return '<div class="cv-row">' +
      cell('Заявка → сделка', converted.length, settled.length, plural(settled.length, 'завершённой заявки', 'завершённых заявок', 'завершённых заявок')) +
      cell('Сделка → успех', wonDeals.length, closedDeals.length, plural(closedDeals.length, 'закрытой сделки', 'закрытых сделок', 'закрытых сделок')) +
      '<div class="cv-note">' + I('sparkle') + 'Считаются по-разному: заявка даёт одно наблюдение, сколько бы договоров из неё ни вышло; сделка — своё. Складывать их нельзя.</div></div>';
  }
  // Stages live in fixtures next to the funnels that order them. STAGES is the canonical SPINE —
  // every stage any funnel uses, in the order work → … → won → lost. It is what cross-funnel views
  // (the manager's consolidated funnel, the stage breakdown) group by; a single funnel's board uses
  // its own subset instead.
  const STAGE_LABELS = (WS.fixtures && WS.fixtures.STAGE_LABELS) || {};
  const STAGES = Object.keys(STAGE_LABELS).map((k) => ({ k: k, label: STAGE_LABELS[k] }));
  function stageLabel(k) { return STAGE_LABELS[k] || k; }
  function inboxStageLabel(k) { return (WS.INBOX_STAGE_LABELS || {})[k] || k; }
  function funnelOf(d) {
    return (WS.FUNNELS || []).find((x) => x.k === (d && d.funnel)) || (WS.FUNNELS || [])[0] || { k: '', label: '', stages: [] };
  }
  // Шаги сделки следуют из вида договора, которым она заканчивается, а не из воронки услуги:
  // в воронке пресейл и договорная работа лежали одним списком, и сделка могла встать на «показ».
  function dealSteps(d) {
    const ck = WS.contractKindFor;
    return (WS.DEAL_STEPS || {})[ck ? ck((d && d.funnel) || 'sale', d && d.readiness) : ''] || [];
  }
  // Колонки доски для услуги, у которой видов договора два (продажа: оффплан и вторичка), —
  // объединение их шагов в порядке общего хребта. «Бронирование» стоит, пока в воронке есть хоть
  // одна оффплан-сделка, и пустует, когда их нет; прятать колонку по составу доски значило бы
  // менять её ширину при каждом переносе карточки.
  function stepsForFunnel(fk) {
    const DS = WS.DEAL_STEPS || {}, ck = WS.contractKindFor;
    if (!ck) return [];
    const seen = {};
    [DS[ck(fk, 'оффплан')] || [], DS[ck(fk, 'готовый')] || []].forEach((a) => a.forEach((k) => { seen[k] = 1; }));
    return STAGES.map((s) => s.k).filter((k) => seen[k]);
  }
  // The path a deal walks. «Проигрыш» is an exit, not a step, so it is off the path: the stepper
  // draws a route, and a route with a dead end drawn as its last milestone reads as the goal.
  function funnelPath(d) { return dealSteps(d).filter((k) => k !== 'lost'); }
  // Terminal state. `closed` = off the board either way; `won` = business we actually earned on.
  // Every money figure must use `dealWon`, every «в работе» figure `!dealClosed` — a lost deal
  // counted as closed revenue is the single most expensive mistake this split can make.
  function dealClosed(d) { return !!d && (d.stage === 'won' || d.stage === 'lost'); }
  function dealWon(d) { return !!d && d.stage === 'won'; }
  function dealFireBadge() { return '<span class="deal-fire" title="Требует действия">' + I('flame') + '</span>'; }
  // ============================================================================================
  // Доска сделок — четыре укрупнённых отсека вместо десяти колонок. Десять колонок не помещаются
  // ни на один экран, и доска превращалась в горизонтальную ленту, по которой нельзя вести работу.
  //
  // Первые два отсека держат ЗАПРОСЫ (подбор, показ, переговоры), последние два — СДЕЛКИ
  // (шаги договора и исход). Это и есть тот самый сквозной путь: до согласования условий работа
  // идёт по запросу, после — по сделке, и на доске это один ряд слева направо, а не два раздела.
  //
  // Стадии «Приняли» и «Квалифицировали» сюда НЕ попадают: они живут во «Входящих» и разбираются
  // там. Отсек — это участок пути, а не свалка всего, что похоже.
  // ============================================================================================
  // Отсек объявляет стадии отдельно для запроса и для сделки: последний держит и то, и другое —
  // запрос, проигранный до сделки, это тоже исход, и потерять его значило бы показывать воронку,
  // из которой часть работы просто исчезает.
  const DEAL_BANDS = [
    /* Квалифицированная заявка — это уже работа: бюджет назван, район назван, подбирать можно.
       Прежде она на доску не попадала «потому что разбирается во Входящих», и первый отсек
       стоял пустым, хотя пять заявок из семнадцати были именно здесь. Двойного счёта тут нет:
       у квалифицированной заявки сделки ещё нет, считать нечего дважды. Не разобранное —
       стадия `new` — по-прежнему живёт во «Входящих» и на доску не идёт. */
    { k: 'qual', label: 'Квалифицированы', request: ['qual'], deal: [],
      gate: 'Бюджет и район названы' },
    { k: 'pick', label: 'Подбор и показы', request: ['offer', 'meet'], deal: [],
      gate: 'Клиент увидел варианты' },
    { k: 'talks', label: 'Переговоры', request: ['talks'], deal: [],
      gate: 'Условия обсуждаются' },
    { k: 'papers', label: 'Договор и деньги', request: [], deal: ['prep', 'book', 'sign', 'reg', 'exec'],
      gate: 'Подписание, оплата, регистрация' },
    { k: 'result', label: 'Исход', request: ['lost'], deal: ['won', 'lost'],
      gate: 'Успех или проигрыш' },
  ];
  // Стадии, которые на доску не попадают намеренно: `new` разбирается во «Входящих» — это ещё
  // не работа, а разбор поступившего; `closed` уже представлена своими сделками — посчитать её
  // ещё раз значило бы посчитать дважды.
  const BAND_OFF_BOARD = ['new', 'closed'];
  // Неизвестная стадия НЕ попадает в первый отсек: прежде такая запись молча считалась входящей.
  // Она не считается нигде и попадает в список нарушителей — показать, что стадия не разложилась,
  // честнее, чем приписать её к чужому рубежу.
  function dealBandOf(stage, of) {
    const b = DEAL_BANDS.find((x) => (x[of] || []).indexOf(stage) >= 0);
    return b ? b.k : null;
  }
  // Записи, чья стадия не легла ни в один отсек. Пусто — норма; непусто — данные разошлись со словарём.
  function bandOutliers() {
    const out = [];
    (D().requests || []).forEach((r) => {
      const st = reqStage(r);
      if (BAND_OFF_BOARD.indexOf(st) >= 0) return;
      if (!dealBandOf(st, 'request')) out.push({ kind: 'запрос', id: r.id, title: r.title, stage: st });
    });
    (D().deals || []).forEach((d) => {
      if (!dealBandOf(d.stage, 'deal')) out.push({ kind: 'сделка', id: d.id, title: d.title, stage: d.stage });
    });
    return out;
  }
  function kanbanDeals(isMgr) {
    const fk = S().dealFunnel || 'sale';
    const pred = activeViewPred();
    const path = stepsForFunnel(fk).filter((k) => k !== 'lost');
    const reqCard = (r) => {
      const c = D().clients.find((x) => x.id === r.clientId) || {};
      const n = (r.offered || []).length;
      return '<div class="deal deal-pre" data-request="' + r.id + '">' +
        '<div class="deal-body"><div class="dt">' + (c.name || r.title) + '</div>' +
        '<div class="dm">' + r.title + (r.budget ? ' · до ' + WS.AED(r.budget) : '') + '</div>' +
        '<div class="dfoot"><div class="dtag"><span class="badge">' + I('mail') + 'запрос</span>' +
        (n ? '<span class="badge">предложено ' + n + '</span>' : '') + '</div></div></div></div>';
    };
    const cols = DEAL_BANDS.map((b) => {
      const rs = (D().requests || []).filter((r) => (r.funnel || 'sale') === fk && (b.request || []).indexOf(reqStage(r)) >= 0);
      const ds = D().deals.filter((d) => (b.deal || []).indexOf(d.stage) >= 0 && (d.funnel || 'sale') === fk &&
        (!pred || pred(d)) && dealExtraPred(d));
      const n = rs.length + ds.length;
      let cards = rs.map(reqCard).join('') + ds.map((d) => dealBandCard(d, isMgr, path)).join('');
      if (!cards) cards = '<div style="font-size:12px;color:var(--faint);padding:8px 6px">пусто</div>';
      const term = b.k === 'result' ? ' kcol-won' : '';
      return '<div class="kcol kcol-band' + term + '"><div class="kh"><span>' + b.label + '</span><span class="c">' + n + '</span></div>' +
        '<div class="kh-gate">' + b.gate + '</div>' + cards + '</div>';
    }).join('');
    // Граница между пресейлом и договором рисуется явно: это тот самый переход «условия согласованы»,
    // из-за которого весь спор и шёл. Невидимая граница читается как «всё это одно и то же».
    const outs = bandOutliers();
    const warn = outs.length ? '<div class="kanban-hint kanban-warn">' + I('warn') + 'Не разложились по отсекам: ' +
      outs.map((o) => o.kind + ' «' + o.title + '» (стадия ' + o.stage + ')').join(', ') + '</div>' : '';
    return warn + '<div class="kanban kanban-bands">' + cols + '</div>';
  }
  // Карточка сделки в отсеке. Внутри отсека стадия не пропадает — она подписью на карточке:
  // отсек говорит, на каком участке пути сделка, подпись — на каком именно шаге внутри участка.
  function dealBandCard(d, isMgr, path) {
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const o = dealObject(d);
    const tags = (d.tags || []).map((t) => '<span class="badge">' + t + '</span>').join('');
    const consent = c.consent === false ? '<span class="badge stop">' + I('lock') + 'нет согласия</span>' : '';
    const agent = isMgr ? '<span class="badge info">' + I('users') + agentName(d.agent) + '</span>' : '';
    const pi = path.indexOf(d.stage);
    const canPrev = pi > 0, canNext = pi >= 0 && pi < path.length - 1;
    const move = '<div class="dmove">' +
      '<button class="kmv" data-dealmove="' + d.id + '" data-dir="prev" title="Назад по стадии"' + (canPrev ? '' : ' disabled') + '>' + I('chevLeft') + '</button>' +
      '<button class="kmv" data-dealmove="' + d.id + '" data-dir="next" title="Вперёд по стадии"' + (canNext ? '' : ' disabled') + '>' + I('chevRight') + '</button></div>';
    // Ближайшая задача со сроком — то единственное, что отвечает на вопрос «трогать ли эту
    // карточку сегодня». Просроченная выше сегодняшней: этим и занимается nextTaskOfDeal.
    // Сделке без открытой задачи строка не рисуется вовсе — пустая строка или прочерк сообщали бы,
    // что задача есть, просто её не видно.
    const nt = nextTaskOfDeal(d);
    const taskRow = nt ? '<div class="dtask"><span class="dtask-t' + (nt.when === 'overdue' ? ' over' : '') + '" title="' + escAttr(nt.title) + '">' + nt.title + '</span>' +
      '<span class="dtask-when">' + nt.due + '</span></div>' : '';
    // Звонок — отдельно от задачи: он нужен и у сделки, где задачи нет, а звонить всё равно надо.
    // Номер на доске не печатается: её показывают на встречах и снимают скриншотами, а это
    // персональные данные (PDPL в ОАЭ, 152-ФЗ в России). Кнопка набирает, номер не светит.
    const callBtn = c.id ? '<button class="kmv kcall" data-act="callClient" data-cid="' + c.id + '" title="Позвонить клиенту">' + I('phone') + '</button>' : '';
    return '<div class="deal' + (dealHot(d) ? ' hot' : '') + '" data-deal="' + d.id + '">' +
      '<div class="deal-thumb" style="background-image:url(' + dealPhoto(d) + ')">' + (dealHot(d) ? dealFireBadge() : '') + '</div>' +
      '<div class="deal-body"><div class="dt">' + (c.name || d.title) + '</div>' +
      '<div class="dm">' + (o ? o.name.split(',')[0] : d.sub) + ' · ' + WS.AED(d.amount || 0) + '</div>' +
      taskRow +
      '<div class="dfoot"><div class="dtag"><span class="badge acc">' + stageLabel(d.stage) + '</span>' + tags + consent + agent + '</div>' +
      '<div class="dmove">' + callBtn + move.replace('<div class="dmove">', '').replace('</div>', '') + '</div></div></div></div>';
  }
  // Table view of deals (item 3): sortable-feeling list with object photo + client + amount (+agent for manager)
  // Ближайшая задача сделки — открытая, самая срочная. Просроченная идёт впереди сегодняшней:
  // именно она и есть повод открыть строку.
  const TASK_WHEN_ORD = { overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4 };
  function nextTaskOfDeal(d) {
    const open = tasksOfDeal(d).filter((t) => t.status !== 'done');
    if (!open.length) return null;
    return open.slice().sort((a, b) =>
      (TASK_WHEN_ORD[a.when] == null ? 9 : TASK_WHEN_ORD[a.when]) -
      (TASK_WHEN_ORD[b.when] == null ? 9 : TASK_WHEN_ORD[b.when]))[0];
  }
  // Список сортируется по стадии: сделки одного этапа стоят рядом, и таблица читается как воронка,
  // а не как случайный порядок записей. Внутри стадии — горячие выше.
  function dealStageOrd(d) {
    const path = funnelPath(d);
    const i = path.indexOf(d.stage);
    return i < 0 ? path.length + (d.stage === 'lost' ? 1 : 0) : i;
  }
  function dealsTable(isMgr) {
    const pred = activeViewPred();
    const fk = listFunnel();
    const stageF = S().dealStage || 'all';
    const list = D().deals
      .filter((d) => (!pred || pred(d)) && dealExtraPred(d))
      .filter((d) => !fk || (d.funnel || 'sale') === fk)
      .filter((d) => stageF === 'all' || d.stage === stageF)
      .slice()
      .sort((a, b) => (dealStageOrd(a) - dealStageOrd(b)) || (dealHot(b) ? 1 : 0) - (dealHot(a) ? 1 : 0));
    const rows = list.map((d) => {
      const c = D().clients.find((x) => x.id === d.clientId) || {}; const o = dealObject(d);
      const nt = nextTaskOfDeal(d);
      const over = nt && nt.when === 'overdue';
      return '<tr data-deal="' + d.id + '" style="cursor:pointer">' +
        '<td><div class="td-obj"><div class="td-thumb" style="background-image:url(' + dealPhoto(d) + ')"></div>' +
        '<div><div class="td-name">' + (c.name || d.title) + (dealHot(d) ? ' ' + dealFireBadge() : '') + '</div>' +
        '<div class="td-sub">' + (o ? o.name.split(',')[0] : d.sub) + '</div></div></div></td>' +
        '<td><span class="badge acc">' + stageLabel(d.stage) + '</span></td>' +
        '<td class="td-next">' + (nt ? '<div class="td-next-t' + (over ? ' over' : '') + '">' + nt.title + '</div>' +
          '<div class="td-sub">' + (nt.due || '') + '</div>' : '<span class="td-mut">нет задачи</span>') + '</td>' +
        '<td class="td-mut">' + (d.nextDue || d.updated || '') + '</td>' +
        '<td>' + agentName(d.agent) + '</td>' +
        '<td class="td-amt">' + WS.AED(d.amount || 0) + '</td></tr>';
    }).join('');
    if (!rows) return '<div class="empty" style="padding:40px 20px">' + I('briefcase') +
      '<div style="font-weight:700;color:var(--ink);margin-bottom:2px">Под этот вид сделок нет</div>' +
      '<div>Сбросьте сохранённый вид, стадию или фильтр выше.</div></div>';
    return '<div class="card" style="overflow-x:auto"><table class="deals-table"><thead><tr>' +
      '<th>Клиент · объект</th><th>Стадия</th><th>Ближайшая задача</th><th>Срок</th>' +
      '<th>' + (isMgr ? 'Агент' : 'Ответственный') + '</th><th>Сумма</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function moveDealDir(id, dir) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const path = funnelPath(d);
    // A lost deal is not on the path. Stepping it back reopens it onto the last working stage,
    // which is what «вернуть в работу» means; stepping it forward does nothing.
    let i = path.indexOf(d.stage);
    if (i < 0) i = d.stage === 'lost' ? path.length - 1 : 0;
    const ni = dir === 'next' ? i + 1 : i - 1;
    if (ni < 0 || ni >= path.length) return;
    WS.storeApi.setDealStage(id, path[ni]);
    WS.storeApi.toast('Сделка «' + d.title + '» → ' + stageLabel(path[ni]), 'ok');
  }
  // demo KYC state per contact (physical person screening)
  function kycOf(c) {
    if (c.id === 'c_anna') return { st: 'ok', label: 'KYC пройден' };
    if (c.consent === false) return { st: 'stop', label: 'KYC не начат' };
    return { st: 'warn', label: 'KYC в процессе' };
  }
  function signalsBlock(c) {
    const s = (D().clientSignals || {})[c.id];
    if (!s) return '';
    const rows = s.signals.map((x) => '<div class="chg-row' + (x.ok ? '' : ' off') + '">' + I(x.ok ? 'check' : 'warn') + '<span>' + x.t + '</span></div>').join('');
    return '<div class="section-label" style="margin-top:16px">Сигналы и приоритет <span class="prio prio-' + s.priority + '">' + s.priority + '</span></div>' +
      '<div class="chg-list">' + rows + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Видимые сигналы вместо непрозрачной оценки. Приоритет — агента, независим от AI.</div>';
  }
  function priorityChip(cid) {
    const s = (D().clientSignals || {})[cid];
    if (!s) return '';
    return '<span class="prio prio-' + s.priority + '" title="Приоритет агента (независим от AI)">' + s.priority + '</span>';
  }
  function contactsList() {
    const rows = D().clients.map((c) => {
      const k = kycOf(c);
      const consent = c.consent ? '<span class="badge ok">' + I('check') + 'согласие</span>' : '<span class="badge stop">' + I('lock') + 'нет согласия</span>';
      const isNew = c._new ? '<span class="badge acc">' + I('sparkle') + 'новое</span>' : '';
      const last = lastTouchOf(c.id);
      return '<div class="feed-row' + (c._new ? ' is-new' : '') + '" data-client="' + c.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('users') + '</div>' +
        '<div class="ft"><div class="t">' + priorityChip(c.id) + c.name + '</div><div class="m">' +
        [c.goal, (c.areas || []).slice(0, 2).join(' · '), c.budget ? 'до ' + WS.AED(c.budget) : '', last ? 'касание ' + last : ''].filter(Boolean).join(' · ') + '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center">' + isNew + '<span class="badge ' + k.st + '">' + I('shield') + k.label + '</span>' + consent + I('arrowRight') + '</div></div>';
    }).join('');
    return '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Контакты · ' + D().clients.length + '</div><div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>' + companiesBlock();
  }
  // R5: Company entity (agency/developer/corp/fund) with KYC STATUS (not a rating).
  function companyHaystack(co) {
    const people = (co.people || []).map((x) => x.name + ' ' + x.role).join(' ');
    return [co.name, co.kind, co.license, co.trn, co.address, co.commission, people].filter(Boolean).join(' ').toLowerCase();
  }
  function companiesSearchList() {
    const q = (S().companiesSearch || '').trim().toLowerCase();
    let cos = D().companies || [];
    if (q) cos = cos.filter((co) => companyHaystack(co).indexOf(q) >= 0);
    return cos.filter((co) => matchCompaniesFilters(co));
  }
  function companyRow(co) {
    const linked = (D().deals || []).filter((d) => d.companyId === co.id).length;
    const people = (co.people || []).length;
    const kyc = co.kyc === 'verified' ? '<span class="badge ok">' + I('check') + 'KYC пройден</span>' : '<span class="badge warn">' + I('clock') + 'KYC на проверке</span>';
    const meta = co.kind + ' · сделок: ' + linked + (people ? ' · ' + people + ' ' + plural(people, 'контакт', 'контакта', 'контактов') : '');
    return '<div class="feed-row" data-company="' + co.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('building') + '</div>' +
      '<div class="ft"><div class="t">' + co.name + '</div><div class="m">' + meta + '</div></div>' + kyc + I('arrowRight') + '</div>';
  }
  function companiesListInner() {
    const cos = companiesSearchList();
    if (!cos.length) return listEmptyState((S().companiesSearch || '').trim(), (S().companiesFilters || {}).client !== 'all', 'clearCompaniesFilters');
    return '<div class="feed" style="padding:0 16px 8px">' + cos.map(companyRow).join('') + '</div>';
  }
  function companiesBlock() {
    const q = S().companiesSearch || '';
    const f = S().companiesFilters || {};
    // Only clients that actually reach a company through a deal — an option that filters to nothing
    // is a dead control.
    const linkedClients = (D().clients || []).filter((c) => (D().deals || []).some((d) => d.clientId === c.id && d.companyId));
    const clientOpts = [['all', 'Любой клиент']].concat(linkedClients.map((c) => [c.id, c.name]));
    const clear = (q || (f.client && f.client !== 'all')) ? '<button class="view-clear" data-act="clearCompaniesFilters">' + I('x') + 'сбросить</button>' : '';
    const bar = '<div class="qa-row" style="margin:10px 0 0;align-items:center">' +
      '<label class="lf-fld inline"><span>Связана с клиентом</span>' + miniSel('cofClient', f.client || 'all', clientOpts) + '</label>' + clear + '</div>';
    return searchBox('companiesSearch', 'Поиск: название, тип, лицензия, контактное лицо…', q) + bar +
      '<div class="card" style="margin-top:12px"><div class="section-label companies-count" style="padding:12px 16px 4px">Компании · ' + companiesSearchList().length + '</div>' +
      '<div class="companies-list">' + companiesListInner() + '</div></div>';
  }
  function refreshCompanies() {
    const box = document.querySelector('.companies-list'); if (!box) return;
    box.innerHTML = companiesListInner();
    const cnt = document.querySelector('.companies-count');
    if (cnt) cnt.textContent = 'Компании · ' + companiesSearchList().length;
  }
  // ---- Company card v2: same universal shell (static type → status chip, dx-sec tabs) ----
  // Handover brief on the company card — the counterpart of clientBriefSentences: who this legal
  // entity is · how much of our book runs through it · whom we actually talk to · on what terms ·
  // what to watch. Clauses drop out when their data is absent, and no name lands in a slot that
  // would require Russian declension.
  function companyBriefSentences(co) {
    const out = [];
    const deals = (D().deals || []).filter((d) => d.companyId === co.id);
    const people = co.people || [];

    // 1. Who this is.
    let who = co.name + ' — ' + lowerFirst(co.kind || 'контрагент');
    if (co.license) who += ', ' + co.license;
    out.push(who + '.' + (co.note ? ' ' + co.note : ''));

    // 2. How much of our book runs through it.
    if (deals.length) {
      const total = deals.reduce((s, d) => s + (d.amount || 0), 0);
      const open = deals.filter((d) => !dealClosed(d));
      let vol = 'Через компанию ' + plural(deals.length, 'идёт', 'идут', 'идёт') + ' ' + deals.length + ' ' + plural(deals.length, 'сделка', 'сделки', 'сделок') +
        ' на ' + WS.AED(total);
      if (open.length) {
        const stages = joinRu(Array.from(new Set(open.map((d) => '«' + funnelSteps(d).cols[funnelSteps(d).idx] + '»'))));
        vol += '; в работе ' + open.length + ' — ' + plural(open.length, 'стадия', 'стадии', 'стадии') + ' ' + stages;
      }
      out.push(vol + '.');
    } else {
      out.push('Сделок через компанию пока не было — контрагент заведён, история пустая.');
    }

    // 3. Whom we actually talk to.
    if (people.length) {
      const primary = people.find((p) => p.primary) || people[0];
      const lpr = people.filter((p) => p.decision === 'ЛПР' && p !== primary);
      let line = 'Основной контакт — ' + primary.name + ', ' + lowerFirst(primary.role);
      if (lpr.length) line += '; решение принимает ' + joinRu(lpr.map((p) => p.name + ' (' + lowerFirst(p.role) + ')'));
      const rest = people.length - 1 - lpr.length;
      if (rest > 0) line += '; ещё ' + rest + ' ' + plural(rest, 'человек', 'человека', 'человек') + ' в контуре';
      out.push(line + '.');
    }

    // 4. On what terms.
    const terms = [];
    if (co.commission) terms.push('комиссия — ' + lowerFirst(co.commission));
    if (co.escrow) terms.push('расчёты через эскроу-счета DLD');
    if (terms.length) out.push(capFirst(joinRu(terms)) + '.');

    // 5. What to watch.
    const watch = [];
    if (co.kyc !== 'verified') watch.push('KYC ещё на проверке — до его завершения договор не подписываем');
    if (!co.escrow && /застройщик/i.test(co.kind || '')) watch.push('эскроу-счёт не подтверждён');
    if (!co.trn || co.trn === '—') watch.push('нет TRN — счёт с VAT не выставить');
    if (watch.length) out.push('Внимание: ' + joinRu(watch) + '.');

    return out;
  }
  function companyOps(co) {
    const deals = (D().deals || []).filter((d) => d.companyId === co.id);
    const activeDeal = deals.find((d) => !dealClosed(d));
    const total = deals.reduce((s, d) => s + (d.amount || 0), 0);
    const primary = (co.people || []).find((p) => p.primary) || (co.people || [])[0];
    return opsStrip([
      ['building', 'Тип', co.kind],
      deals.length ? ['briefcase', 'Сделок в работе', String(deals.length)] : null,
      total ? ['money', 'Суммарный объём', WS.AED(total)] : null,
      primary ? ['users', 'Основной контакт', primary.name] : null,
    ], null);
  }
  function companyTabContent(co, tab) {
    const deals = (D().deals || []).filter((d) => d.companyId === co.id);
    if (tab === 'people') {
      const people = co.people || [];
      if (!people.length) {
        return dxSec('users', 'Люди компании', '',
          '<div style="font-size:12.5px;color:var(--mut);padding:6px 0">Контактные лица не заведены. Добавьте их, чтобы вести переписку с тем, кто отвечает за свою часть сделки.</div>');
      }
      const rows = people.map((p, i) => {
        const dec = ({ 'ЛПР': ['ok', 'target'], 'влияет': ['warn', 'star'] })[p.decision] || ['', 'check'];
        const decision = '<span class="badge ' + dec[0] + '">' + I(dec[1]) + (p.decision || 'исполнитель') + '</span>';
        const ch = chanMeta(p.channel || 'email');
        const val = personChannelValue(p);
        const star = p.primary ? '<span class="c-star" title="Основной контакт">' + I('star') + '</span>' : '';
        const sub = [p.role, val].filter(Boolean).join(' · ');
        const main = '<div class="dc-main"><div class="fi i-acc">' + I(ch[0]) + '</div>' +
          '<div class="ft"><div class="t">' + p.name + star + '</div><div class="m">' + sub + '</div>' +
          (p.note ? '<div class="m" style="color:var(--faint)">' + p.note + '</div>' : '') + '</div></div>';
        const acts = '<div class="dc-acts">' + decision +
          '<button class="btn sm" data-thread="company:' + co.id + ':' + i + '" data-tlabel="' + escAttr(p.name + ' · ' + co.name) + '" data-ticon="building">' + I('chat') + 'Написать</button></div>';
        return '<div class="dc-row">' + main + acts + '</div>';
      }).join('');
      const hint = '<div style="font-size:11px;color:var(--faint);margin-top:8px">ЛПР принимает решение, «влияет» — согласует свою часть, «исполнитель» — ведёт операционные шаги. Переписка ведётся с каждым отдельно и попадает в историю компании.</div>';
      return dxSec('users', 'Люди компании · ' + people.length, '', '<div class="dc-list">' + rows + '</div>' + hint);
    }
    if (tab === 'details') {
      const escrow = co.escrow ? '<span class="badge ok">' + I('shield') + 'Эскроу DLD</span>' : '';
      const kyc = co.kyc === 'verified' ? '<span class="badge ok">' + I('check') + 'KYC пройден</span>' : '<span class="badge warn">' + I('clock') + 'KYC на проверке</span>';
      return dxSec('building', 'Реквизиты', '', '<div class="dfields">' +
        dfPair('Тип', co.kind) + dfPair('TRN', co.trn) + dfPair('Лицензия', co.license) +
        dfPair('Адрес', co.address) + dfPair('Условия комиссии', co.commission) + '</div>' +
        '<div class="prov" style="margin-top:8px">' + kyc + escrow + '<span class="badge demo">' + I('lock') + 'реквизиты — демо-данные</span></div>');
    }
    if (tab === 'deals') {
      const rows = deals.map((d) => '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + d.title + '</div><div class="m">' + stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + '</div></div>' + I('arrowRight') + '</div>').join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">связанных сделок нет</div>';
      return dxSec('briefcase', 'Связанные сделки · ' + deals.length, '', '<div class="feed">' + rows + '</div>');
    }
    if (tab === 'history') return companyFeedBlock(co);
    // overview
    return cxStack([
      [dxSec('sparkle', 'Справка Консьержа', '', '<p class="deal-brief">' + companyBriefSentences(co).join(' ') + '</p>'),
       dxSec('building', 'Реквизиты', '', '<div class="dfields">' +
         dfPair('Тип', co.kind) +
         dfPair('Лицензия / ORN', co.license || '—') +
         dfPair('TRN', co.trn || '—') +
         dfPair('Эскроу', co.escrow ? 'Эскроу-счета DLD' : 'нет') +
         dfPair('Условия комиссии', co.commission) +
         dfPair('Сделок', String(deals.length)) + '</div>' +
         (co.note ? '<div style="margin-top:8px;font-size:12px;color:var(--mut)">' + co.note + '</div>' : ''))],
      companyFeedBlock(co, 5),
    ]);
  }
  // Same band as the client hero — the markup contract is `.chero > img + scrim + content(avatar,
  // info(name, facts))`; anything else lands unstyled on a dark gradient and reads as broken.
  // A person's reachable value depends on the channel they prefer: messengers ride the phone number,
  // mail rides the address. `p[p.channel]` silently produced an email under a WhatsApp icon.
  function personChannelValue(p) {
    const ch = p.channel || 'email';
    if (ch === 'email') return p.email || p.phone || '';
    return p.phone || p.email || '';
  }
  function companyHero(co) {
    const bg = (WS.photos && (WS.photos.o_marina || WS.photos.o_interior)) || '';
    const init = (co.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const people = (co.people || []).length;
    const verified = co.kyc === 'verified';
    const facts = [
      ['building', co.kind || 'Компания'],
      ['shield', co.license || 'лицензия не указана'],
      [verified ? 'check' : 'clock', verified ? 'KYC пройден' : 'KYC на проверке'],
      ['users', people ? people + ' ' + plural(people, 'контактное лицо', 'контактных лица', 'контактных лиц') : 'контактов нет'],
    ];
    const factsHtml = '<div class="chero-facts">' + facts.map((f) => '<div class="chero-fact"><span class="chero-fact-icon">' + I(f[0]) + '</span><span>' + f[1] + '</span></div>').join('') + '</div>';
    return '<div class="chero">' + (bg ? '<img class="chero-img" src="' + bg + '" alt="">' : '') +
      '<div class="chero-scrim"></div>' +
      '<div class="chero-content"><div class="chero-avatar">' + init + '</div>' +
      '<div class="chero-info"><h1 class="chero-name">' + co.name + '</h1>' + factsHtml + '</div></div></div>';
  }
  function companySpec(id) {
    const co = (D().companies || []).find((x) => x.id === id); if (!co) return null;
    const kyc = co.kyc === 'verified' ? { icon: 'check', label: 'KYC пройден', tone: 'ok' } : { icon: 'clock', label: 'KYC на проверке', tone: 'warn' };
    const dealsCount = (D().deals || []).filter((d) => d.companyId === id).length;
    const peopleCount = (co.people || []).length;
    const status = statusChip([kyc]);
    return {
      type: 'company', id: id, title: co.name,
      hero: companyHero(co) + status,
      acts: entityActionBar([
        ['chat', 'Чат по компании', 'data-thread="company:' + co.id + '" data-tlabel="' + escAttr(co.name) + '" data-ticon="building"', 'primary'],
        ['pencil', 'Записать событие', 'data-act="addEvent" data-scope="company" data-coid="' + co.id + '"', ''],
        ['clock', 'Поставить задачу', 'data-act="newTask"', ''],
      ]),
      state: companyOps(co),
      tabs: [['overview', 'Обзор'], ['people', 'Люди · ' + peopleCount], ['details', 'Реквизиты'], ['deals', 'Сделки · ' + dealsCount], ['history', 'История']],
      render: function (tab) { return companyTabContent(co, tab); },
      concierge: entityConcierge('Спросите Консьержа по компании — «история сделок», «условия комиссии», «собери досье»…', 'company:' + co.id, co.name + ' · компания', 'building'),
    };
  }
  function companyCard(id) { S().companyId = id; WS.router.go('companyDetail'); }

  // ---------------- PSYCH PROFILE (персонализация коммуникации) ----------------
  const PSYCH_OPTS = {
    decision: ['Аналитик — цифры и факты', 'Интуит — эмоции и образ', 'Прагматик — выгода и сроки', 'Статусный — престиж'],
    pace: ['Быстрый', 'Размеренный'],
    risk: ['Осторожный', 'Умеренно осторожный', 'Готов к риску'],
    channel: ['WhatsApp, текст', 'WhatsApp + звонок', 'Telegram', 'Email', 'Голосовые'],
    bestTime: ['Утро', 'День', 'Вечер', 'Будни, вечер', 'Выходные'],
    values: ['Доходность', 'Статус/престиж', 'Безопасность сделки', 'Скорость', 'Комфорт'],
  };
  // communication tips derived from the profile — how to talk in social / messengers
  function commTips(p) {
    const t = []; const d = p.decision || ''; const v = p.values || [];
    if (/Аналитик/.test(d)) t.push('Давать цифры, расчёты и источники; без давления');
    if (/Интуит/.test(d)) t.push('Показывать образ жизни: фото, видео, эмоцию, истории');
    if (/Прагматик/.test(d)) t.push('Сразу к выгоде, срокам и следующему шагу');
    if (/Статусный/.test(d)) t.push('Подчёркивать эксклюзив, закрытый доступ, престиж');
    if (v.indexOf('Скорость') >= 0) t.push('Отвечать быстро, короткими сообщениями');
    if (v.indexOf('Безопасность сделки') >= 0) t.push('Акцент на проверки, escrow, гарантии');
    if (!t.length) t.push('Нейтральный деловой тон, факты и следующий шаг');
    return t;
  }
  function psychBlock(c) {
    const p = c.psych;
    if (!p || !p.filled) {
      return '<div class="section-label" style="margin-top:16px">Портрет клиента</div>' +
        '<div class="psych-empty">' + I('sparkle') +
        '<div><div style="font-weight:700;color:var(--ink)">Профиль не заполнен</div>' +
        '<div style="font-size:12px;color:var(--mut);margin-top:2px">Параметры стиля общения помогут вести персонализированную коммуникацию в мессенджерах и соцсетях (за согласием клиента).</div></div>' +
        '<button class="btn sm primary" data-act="psychForm" data-cid="' + c.id + '">' + I('plus') + 'Заполнить профиль</button></div>';
    }
    const chip = (ic, t) => t ? '<span class="badge">' + I(ic) + t + '</span>' : '';
    const vals = (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('');
    const tips = commTips(p).map((t) => '<div class="chg-row">' + I('check') + '<span>' + t + '</span></div>').join('');
    return '<div class="section-label" style="margin-top:16px">Портрет клиента</div>' +
      '<div class="prov" style="margin-bottom:8px">' + chip('users', p.decision) + chip('flame', p.pace) + chip('shield', p.risk) + '</div>' +
      '<div class="prov" style="margin-bottom:8px">' + vals + '</div>' +
      row('Канал и тон', (p.channel || '') + (p.tone ? ' · ' + p.tone : '')) +
      row('Триггеры', (p.triggers || []).join(', ') || '—') +
      row('Лучшее время', p.bestTime || '—') +
      '<div class="section-label" style="margin-top:10px">Как общаться (соцсети / мессенджеры)</div><div class="chg-list">' + tips + '</div>' +
      '<div class="prov" style="margin-top:8px"><span class="badge demo">' + I('lock') + (p.source || 'сигналы стиля') + ' · за согласием (PDPL), человек в контуре</span>' +
      '<button class="btn sm" data-act="psychForm" data-cid="' + c.id + '">' + I('pencil') + 'Изменить</button></div>';
  }
  function openPsychForm(id) {
    const c = D().clients.find((x) => x.id === id); if (!c) return;
    const p = c.psych || {};
    const sel = (key, label, opts, cur) => '<label class="fld"><span>' + label + '</span><select id="ps_' + key + '">' + opts.map((o) => '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    const valChecks = PSYCH_OPTS.values.map((v) => '<label class="pcheck"><input type="checkbox" value="' + v + '"' + (((p.values || []).indexOf(v) >= 0) ? ' checked' : '') + '> ' + v + '</label>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Наблюдаемые сигналы стиля — помогают персонализировать коммуникацию. Не клиническая оценка; используется за согласием (PDPL) и при человеке в контуре.</p>' +
      '<div class="match-grid">' +
        sel('decision', 'Тип решения', PSYCH_OPTS.decision, p.decision) +
        sel('pace', 'Темп', PSYCH_OPTS.pace, p.pace) +
        sel('risk', 'Отношение к риску', PSYCH_OPTS.risk, p.risk) +
        sel('channel', 'Предпочитаемый канал', PSYCH_OPTS.channel, p.channel) +
        sel('bestTime', 'Лучшее время', PSYCH_OPTS.bestTime, p.bestTime) +
      '</div>' +
      '<div class="section-label" style="margin-top:10px">Что важно клиенту</div><div class="pchecks">' + valChecks + '</div>' +
      '<label class="fld" style="margin-top:10px"><span>Тон общения</span><input id="ps_tone" type="text" value="' + ((p.tone || '').replace(/"/g, '&quot;')) + '" placeholder="Напр.: коротко, с конкретикой, без давления"></label>';
    openModal('Профиль клиента · ' + c.name, body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="psychSave" data-cid="' + id + '">' + I('check') + 'Сохранить профиль</button>');
  }
  function savePsychForm(id) {
    const c = D().clients.find((x) => x.id === id); if (!c) return;
    const g = (k) => { const el = document.getElementById('ps_' + k); return el ? el.value : ''; };
    const vals = Array.prototype.map.call(document.querySelectorAll('.pchecks input:checked'), (el) => el.value);
    const psych = Object.assign({}, c.psych || {}, {
      filled: true, decision: g('decision'), pace: g('pace'), risk: g('risk'), channel: g('channel'), bestTime: g('bestTime'), tone: g('tone'),
      values: vals, source: (c.psych && c.psych.source) || 'заполнено вручную', triggers: (c.psych && c.psych.triggers) || [],
    });
    WS.storeApi.applyEffects([{ op: 'updateClient', id: id, patch: { psych: psych } }]);
    WS.storeApi.toast('Профиль сохранён — персонализация активна', 'ok');
    clientCard(id); // re-render the card with the profile reflected
  }

  // ---- Contact card v2: same universal shell (static type → status chip, dx-sec tabs) ----
  function signalsInner(c) {
    const s = (D().clientSignals || {})[c.id];
    if (!s) return '<div style="font-size:12px;color:var(--faint)">сигналов по контакту пока нет</div>';
    const rows = s.signals.map((x) => '<div class="chg-row' + (x.ok ? '' : ' off') + '">' + I(x.ok ? 'check' : 'warn') + '<span>' + x.t + '</span></div>').join('');
    return '<div class="chg-list">' + rows + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Видимые сигналы вместо непрозрачной оценки. Приоритет — агента, независим от AI.</div>';
  }
  function psychInner(c) {
    const p = c.psych;
    if (!p || !p.filled) {
      return '<div class="psych-empty">' + I('sparkle') +
        '<div><div style="font-weight:700;color:var(--ink)">Профиль не заполнен</div>' +
        '<div style="font-size:12px;color:var(--mut);margin-top:2px">Параметры стиля общения помогут вести персонализированную коммуникацию в мессенджерах и соцсетях (за согласием клиента).</div></div>' +
        '<button class="btn sm primary" data-act="psychForm" data-cid="' + c.id + '">' + I('plus') + 'Заполнить профиль</button></div>';
    }
    const chip = (ic, t) => t ? '<span class="badge">' + I(ic) + t + '</span>' : '';
    const vals = (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('');
    const tips = commTips(p).map((t) => '<div class="chg-row">' + I('check') + '<span>' + t + '</span></div>').join('');
    return '<div class="prov" style="margin-bottom:8px">' + chip('users', p.decision) + chip('flame', p.pace) + chip('shield', p.risk) + '</div>' +
      '<div class="prov" style="margin-bottom:8px">' + vals + '</div>' +
      '<div class="dfields">' + dfPair('Канал и тон', (p.channel || '') + (p.tone ? ' · ' + p.tone : '')) +
      dfPair('Триггеры', (p.triggers || []).join(', ') || '—') + dfPair('Лучшее время', p.bestTime || '—') + '</div>' +
      '<div class="section-label" style="margin-top:10px">Как общаться (соцсети / мессенджеры)</div><div class="chg-list">' + tips + '</div>' +
      '<div class="prov" style="margin-top:8px"><span class="badge demo">' + I('lock') + (p.source || 'сигналы стиля') + ' · за согласием (PDPL), человек в контуре</span>' +
      '<button class="btn sm" data-act="psychForm" data-cid="' + c.id + '">' + I('pencil') + 'Изменить</button></div>';
  }
  // Communication channels — Telegram + WhatsApp основные, плюс Instagram, Email, телефон.
  /* Один словарь каналов на всё: контакт, участник сделки, лента событий. Порталы площадок
     (Property Finder, Bayut) каналом связи не считаются — это источник обращения, а не способ
     связаться с человеком, и они живут в поле источника заявки. */
  const CHANNELS = ['whatsapp', 'telegram', 'email', 'call'];
  function chanMeta(ch) {
    return ({
      phone: ['phone', 'Телефон'],
      whatsapp: ['whatsapp', 'WhatsApp'],
      telegram: ['send', 'Telegram'],
      instagram: ['instagram', 'Instagram'],
      email: ['mail', 'Email'],
      call: ['phone', 'Телефон'],
    })[ch] || ['whatsapp', 'WhatsApp'];
  }
  function prefChannel(c) {
    const ch = c.channel;
    if (ch === 'email') return 'email';
    if (ch === 'telegram') return 'telegram';
    if (ch === 'phone' || ch === 'call') return 'phone';
    return 'whatsapp';
  }
  const CONTACT_ORDER = ['phone', 'whatsapp', 'telegram', 'instagram', 'email'];
  // vCard-style rows: канал + реальное значение, основной подсвечен. Один рендер для клиента и пользователя.
  function contactVCard(vals, pref) {
    return '<div class="cd-list">' + CONTACT_ORDER.map((ch) => {
      const m = chanMeta(ch);
      const on = ch === pref;
      return '<div class="cd-row' + (on ? ' on' : '') + '"><span class="cd-ic">' + I(m[0]) + '</span>' +
        '<span class="cd-label">' + m[1] + '</span><span class="cd-val">' + (vals[ch] || '—') + '</span>' +
        (on ? '<span class="cd-primary">' + I('check') + 'основной</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function clientContactVals(c) {
    const base = (c.id || '').replace(/^c_/, '') || 'client';
    return { phone: c.phone || '—', whatsapp: c.phone || '—', telegram: '@' + base + '_dxb', instagram: '@' + base + '.dubai', email: base + '@client.ae' };
  }
  const USER_CONTACTS = {
    agent: { phone: '+971 50 123 4417', whatsapp: '+971 50 123 4417', telegram: '@marina_dxb', instagram: '@marina.dubai.realty', email: 'marina@harbourkey.ae' },
    manager: { phone: '+971 50 447 2210', whatsapp: '+971 50 447 2210', telegram: '@omar_hk', instagram: '@omar.harbourkey', email: 'omar@harbourkey.ae' },
  };
  // Contact info surfaced explicitly at the top of the client overview — compact row of preferred + filled channels.
  function contactBlock(c) {
    const pref = prefChannel(c);
    const vals = clientContactVals(c);
    // Preferred channel first, then the ones that actually hold a value — an empty channel used to
    // take a full row saying «—», which is how five contacts filled the whole fold.
    const shown = [pref].concat(CONTACT_ORDER.filter((ch) => ch !== pref && vals[ch] && vals[ch] !== '—'));
    const channels = shown.map((ch) => {
      const m = chanMeta(ch);
      const isPref = ch === pref;
      return '<div class="cd-row' + (isPref ? ' on' : '') + '" title="' + escAttr(m[1]) + '"><span class="cd-ic">' + I(m[0]) + '</span>' +
        '<span class="cd-val">' + (vals[ch] || '—') + '</span>' +
        (isPref ? '<span class="cd-primary">' + I('check') + 'основной</span>' : '') + '</div>';
    }).join('');
    // Language, consent and «Написать» are all stated elsewhere on this screen — in the hero, in the
    // status chips and in the action bar. What only this block holds are the numbers themselves.
    return dxSec('phone', 'Контактные данные', '', '<div class="cd-list">' + channels + '</div>');
  }
  // Client portrait — the summary shown on the overview tab; the full version lives on its own tab.
  function psychSummary(c) {
    const p = c.psych;
    if (!p || !p.filled) {
      return dxSec('sparkle', 'Портрет клиента', '<button class="btn xs" data-act="psychForm" data-cid="' + c.id + '">' + I('plus') + 'Заполнить</button>',
        '<div style="font-size:12.5px;color:var(--mut)">Профиль стиля общения не заполнен — поможет вести персонализированную коммуникацию в мессенджерах и соцсетях.</div>');
    }
    const flat = (t) => String(t || '').replace(/;\s*/g, ', ').trim();
    const line = (ic, k, v) => v ? '<div class="pt-row"><span class="pt-ic">' + I(ic) + '</span>' +
      '<span class="pt-k">' + k + '</span><span class="pt-v">' + v + '</span></div>' : '';
    const vals = (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('');
    const tips = commTips(p).slice(0, 2).map((t) => '<div class="chg-row">' + I('check') + '<span>' + t + '</span></div>').join('');
    return dxSec('sparkle', 'Портрет клиента', '<button class="btn xs" data-etab="contact~' + c.id + '~profile">' + I('arrowRight') + 'Подробнее</button>',
      '<div class="pt-list">' +
        line('target', 'Решение', p.decision) +
        line('clock', 'Темп', p.pace) +
        line('shield', 'Риск', p.risk) +
        line('chat', 'Канал', flat(p.channel)) +
        line('pencil', 'Тон', flat(p.tone)) +
      '</div>' +
      (vals ? '<div class="prov pt-vals">' + vals + '</div>' : '') +
      (tips ? '<div class="chg-list pt-tips">' + tips + '</div>' : ''));
  }
  // Client-level preference profile: aggregate this client's requests' offered ↔ selected/rejected.
  function clientPrefProfile(c) {
    const all = [];
    (D().requests || []).filter((r) => r.clientId === c.id).forEach((r) => (r.offered || []).forEach((o) => all.push(o)));
    if (!all.length) return '';
    return prefProfileInner({ offered: all });
  }
  // Справка Консьержа — human handover brief for the next agent picking up this client.
  // Handover brief on the client card — what one agent tells another before picking this client up.
  // Every clause is built from the client's own records and disappears when the data is absent, so a
  // bare new contact yields two honest sentences instead of a skeleton of dashes. Phrases are shaped
  // to avoid Russian case agreement: a name never lands in a slot that would require declension.
  // How long this person has been ours, counted from the oldest thing in their history.
  function clientSince(c) {
    const feed = contactFeedEntries(c).filter((e) => !(e.ord > NOW_ORD));
    const first = feed.length ? feed[feed.length - 1] : null;
    if (!first || !first.at) return null;
    const at = String(first.at).split('·')[0].trim();
    const days = (function () {
      const m = /^(\d+)\s*([а-яё]*)/i.exec(at);
      if (!m) return null;
      const mi = RU_MONTHS.indexOf((m[2] || '').toLowerCase());
      const mo = mi >= 0 ? mi + 1 : demoNow().mo;
      return dayOfYear(demoNow().d, demoNow().mo) - dayOfYear(parseInt(m[1], 10), mo);
    })();
    return { at: at, days: days };
  }
  // What we have actually shown this client, across every deal and request — the thing no single
  // card row can say. Services, property types and how the choosing has gone so far.
  function clientDirections(c) {
    const deals = (D().deals || []).filter((d) => d.clientId === c.id);
    const reqs = (D().requests || []).filter((r) => r.clientId === c.id);
    const services = Array.from(new Set(deals.map((d) => lowerFirst(d.dealType || '')).filter(Boolean)));
    const types = Array.from(new Set(deals.map((d) => d.objectType).filter(Boolean)));
    const ready = Array.from(new Set(deals.map((d) => d.readiness).filter(Boolean)));
    let offered = 0, picked = 0, rejected = 0;
    reqs.forEach((r) => (r.offered || []).forEach((o) => {
      offered++;
      if (o && o.state === 'selected') picked++;
      if (o && o.state === 'rejected') rejected++;
    }));
    return { services: services, types: types, ready: ready, offered: offered, picked: picked, rejected: rejected, deals: deals, reqs: reqs };
  }
  const SERVICE_DAT = {
    'продажа': 'продаже', 'аренда': 'аренде', 'управление арендой': 'управлению арендой',
    'эксклюзив': 'эксклюзиву', 'кросс-продажи': 'кросс-продажам', 'консалтинг': 'консалтингу',
  };
  const TYPE_GEN = {
    'апартаменты': 'апартаментов', 'вилла': 'вилл', 'офис': 'офисов', 'ритейл': 'ритейла',
    'склад': 'складов', 'ГАБ': 'ГАБ', 'земля': 'земли',
  };
  function datService(t) { return SERVICE_DAT[String(t || '').toLowerCase()] || t; }
  function genType(t) { return TYPE_GEN[t] || t; }
  // A placeholder is not an area. «Дубай — район не указан» is the absence of an answer, and
  // «Смотрит Дубай — район не указан» states it as a preference.
  function realAreas(c) { return (c.areas || []).filter((a) => !/не указан/i.test(a)); }
  function afterDash(t) {
    const i = String(t || '').indexOf('—');
    return i >= 0 ? String(t).slice(i + 1).trim() : String(t || '').trim();
  }
  // The client brief. Five sentences at most, and none of them restates a field the card already
  // shows: it answers «кто это, что мы ему возили, как он решает и как с ним говорить».
  function clientBriefSentences(c) {
    const out = [];
    const dir = clientDirections(c);
    const active = dir.deals.filter((d) => !dealClosed(d));
    const won = dir.deals.filter(dealWon);
    const since = clientSince(c);

    // 1. Since when, and through what door.
    let intro = c.name;
    if (since && since.days != null && since.days > 0) intro += ' с нами ' + since.days + ' ' + plural(since.days, 'день', 'дня', 'дней') + ', с ' + since.at;
    else if (since) intro += ' заведён' + (since.at ? ' ' + since.at : '');
    else intro += ' — только что в базе';
    const src = (dir.deals[0] || {}).source || (dir.reqs[0] || {}).source;
    if (src) intro += '; источник — ' + src;
    out.push(intro + '.');

    // 2. What we have been doing with them — the history, not the current row.
    // 2. What we have done together — one clause, not a column of counts.
    if (dir.deals.length || dir.offered) {
      const n = dir.deals.length;
      let line = 'За это время — ' + (n === 1 ? 'одна сделка' : n + ' ' + plural(n, 'сделка', 'сделки', 'сделок'));
      if (dir.services.length) line += ' по ' + joinRu(dir.services.map(datService));
      // Одна услуга — можно назвать, что именно; несколько — перечисление типов начинает
      // приписывать каждый тип каждой услуге, чего в данных нет.
      if (dir.services.length === 1 && dir.types.length) line += ' ' + joinRu(dir.types.map(genType));

      if (won.length) line += ', ' + (won.length === 1 ? 'одна доведена' : won.length + ' доведены') + ' до конца';
      if (dir.offered) {
        line += '; из ' + dir.offered + ' ' + plural(dir.offered, 'показанного объекта', 'показанных объектов', 'показанных объектов');
        line += dir.picked ? ' ' + plural(dir.picked, 'выбран', 'выбрано', 'выбрано') + ' ' + dir.picked : ' пока ничего не выбрано';
        if (dir.rejected) line += ', ' + plural(dir.rejected, 'отклонён', 'отклонено', 'отклонено') + ' ' + dir.rejected;
      }
      out.push(line + '.');
    } else {
      out.push('Работа ещё не начиналась — ни заявок, ни сделок, только контакт в базе.');
    }

    // 3. Where they stand today, and what they habitually look at.
    const today = [];
    const areas = realAreas(c);
    if (areas.length) today.push('Смотрит ' + joinRu(areas));
    // Что человек ищет сейчас — это его свойство. Стадия его сделки — свойство сделки, и у неё
    // есть своя карточка: называть её здесь значит говорить за соседний экран.
    const openReq = (D().requests || []).filter((r) => r.clientId === c.id);
    const wants = [];
    openReq.forEach((r) => {
      if (r.goal) wants.push(lowerFirst(r.goal));
      if (r.budget) wants.push('до ' + WS.AED(r.budget));
      if (r.horizon) wants.push(/\d|мес|нед|дн/i.test(r.horizon) ? 'срок ' + r.horizon : lowerFirst(r.horizon));
    });
    if (wants.length) today.push('ищет: ' + wants.slice(0, 3).join(', '));
    else if (active.length) today.push('в работе ' + active.length + ' ' + plural(active.length, 'направление', 'направления', 'направлений'));
    else if (dir.deals.length) today.push('сейчас ничего не ищет');
    if (today.length) out.push(capFirst(today.join('; ')) + '.');

    // 3. How this person decides. Interpretation, not a dump of the portrait fields.
    const p = c.psych;
    if (p && p.filled) {
      const how = [];
      if (p.decision) how.push(afterDash(p.decision));
      if (p.pace) how.push(lowerFirst(afterDash(p.pace)));
      if ((p.values || []).length) how.push('ценит ' + joinRu(p.values.map(lowerFirst)));
      if ((p.triggers || []).length) how.push('решение держится на двух вещах: ' + joinRu(p.triggers.map(lowerFirst)));
      if (how.length) out.push(capFirst(how.join(', ')) + '.');
      // How to reach them, as an instruction — «писать туда, звонить тогда» — rather than three
      // labelled fields read out in a row.
      const flat = (t) => String(t || '').replace(/;\s*/g, ', ').trim();
      const talk = [];
      if (p.channel) talk.push('Писать — ' + flat(p.channel).split(',')[0].trim());
      if (p.tone) talk.push('тон — ' + lowerFirst(flat(p.tone)));
      if (p.bestTime) talk.push('звонить — ' + lowerFirst(flat(p.bestTime)));
      if (talk.length) out.push(talk.join('; ') + '.');
    } else if (active.length || dir.offered) {
      out.push('Портрет не заполнен — стиль общения приходится угадывать по переписке.');
    }

    // 4. The one thing that would go wrong if nobody looked.
    const watch = [];
    if (c.consent === false) watch.push('нет согласия на связь — адресные отправки заблокированы');
    const k = kycOf(c);
    if (k.st === 'stop') watch.push('KYC не начат');
    const overdue = (D().tasks || []).filter((t) => t.clientId === c.id && t.status !== 'done' && t.when === 'overdue').length;
    if (overdue) watch.push(overdue + ' ' + plural(overdue, 'просроченная задача', 'просроченные задачи', 'просроченных задач'));
    if (watch.length) out.push('Держать в голове: ' + joinRu(watch) + '.');
    return out;
  }
  function conciergeClientHandover(c) {
    const p = c.psych;
    const tag = (p && p.filled) ? 'портрет + история' : 'по данным карточки';
    return dxSec('sparkle', 'Справка Консьержа', '<span class="badge ai-b">' + I('sparkle') + tag + '</span>',
      '<p class="deal-brief">' + clientBriefSentences(c).join(' ') + '</p>');
  }
  // Client-level lead ops (derived): owner from the active deal, lifecycle stage, next contact from tasks.
  // Actions on the PERSON. Deal-level verbs stay on the deal, which knows which deal it is.
  function clientActions(c) {
    return [
      ['briefcase', 'Создать сделку', 'data-act="newDeal" data-cid="' + c.id + '"', 'primary'],
      ['building', 'Подобрать объекты', 'data-scn="G2"', ''],
      ['chat', 'Написать', 'data-thread="contact:' + c.id + '" data-tlabel="' + escAttr(c.name) + '" data-ticon="users"', ''],
      ['clock', 'Запланировать касание', 'data-act="newTask"', ''],
      ['pencil', 'Записать заметку', 'data-act="addEvent" data-scope="contact" data-cid="' + c.id + '"', ''],
      // Was data-scn="S8" — a scripted demo run hard-wired to Анна's deal, which ran unchanged
      // whichever client's card you opened. A bar that claims to act on THIS card must.
      ['sparkle', 'Бриф к звонку', 'data-thread="contact:' + c.id + '" data-tlabel="' + escAttr(c.name) + ' · бриф" data-ticon="sparkle"', ''],
      !(c.psych && c.psych.filled) ? ['users', 'Заполнить портрет', 'data-act="psychForm" data-cid="' + c.id + '"', ''] : null,
    ];
  }
  // Полоса операций на карточке КЛИЕНТА говорит о человеке и о работе с ним: кто ведёт, когда
  // следующее касание, как он решает. Стадия и сумма текущей сделки отсюда убраны намеренно —
  // это свойство сделки, у неё своя карточка, и клиент к одной своей сделке не сводится.
  function clientOps(c) {
    const reqs = (D().requests || []).filter((r) => r.clientId === c.id);
    const owner = reqs.length ? agentName(reqs[0].assignee) : 'не назначен';
    const nextTask = (D().tasks || []).filter((t) => t.clientId === c.id && t.status !== 'done')
      .sort((a, b) => (a.when === 'overdue' ? -1 : b.when === 'overdue' ? 1 : 0))[0];
    const nextC = nextTask ? ((nextTask.when === 'overdue' ? 'просрочено · ' : '') + nextTask.due) : null;
    const p = c.psych || {};
    const overdue = (D().tasks || []).some((t) => t.clientId === c.id && t.status !== 'done' && t.when === 'overdue');
    return opsStrip([
      ['users', 'Ответственный', owner],
      ['target', 'Приоритет', ((D().clientSignals || {})[c.id] || {}).priority || '—'],
      p.decision ? ['sparkle', 'Решение', p.decision] : ['sparkle', 'Портрет', 'не заполнен'],
      nextC ? ['clock', 'Следующий контакт', nextC] : null,
    ], overdue ? 'hot' : undefined);
  }
  function clientTabContent(c, tab) {
    // Убедиться, что objTypes инициализированы перед выводом карточки
    initContactObjTypes();
    if (tab === 'profile') {
      return dxSec('sparkle', 'Портрет клиента', '', psychInner(c));
    }
    // Отношения: стадия, портфель и одна лента, где рядом стоят «через 12 дней платёж
    // по графику» и «через неделю день рождения».
    if (tab === 'relations') {
      return relStageBlock(c) +
        '<div style="margin-top:14px">' + clientPortfolio(c) + '</div>' +
        '<div style="margin-top:14px">' + relationsBlock(c) + '</div>';
    }
    if (tab === 'kyc') {
      const k = kycOf(c);
      const kycInner = '<div class="prov">' +
        '<span class="badge ' + k.st + '">' + I('shield') + k.label + '</span>' +
        '<span class="badge ' + (c.consent ? 'ok' : 'stop') + '">' + I(c.consent ? 'check' : 'lock') + 'PDPL согласие ' + (c.consent ? 'есть' : 'нет') + '</span>' +
        '<span class="badge ok">' + I('check') + 'DNCR: не в реестре</span>' +
        '<span class="badge ' + (k.st === 'ok' ? 'ok' : 'warn') + '">' + I('shield') + 'AML-скрининг ' + (k.st === 'ok' ? 'чисто' : 'ожидает') + '</span>' +
        '<span class="badge demo">' + I('lock') + 'проверки — имитация (DEMO)</span></div>';
      const docList = [['Паспорт', c.id === 'c_anna' ? 'ok' : 'warn'], ['Emirates ID', c.id === 'c_anna' ? 'ok' : 'warn'],
        ['Подтверждение средств (PoF)', c.id === 'c_anna' ? 'ok' : 'no']];
      const idDocs = docList.map((d) => '<div class="dfield"><div class="dk">' + d[0] + '</div><div class="dv">' +
        (d[1] === 'ok' ? '<span class="badge ok">' + I('check') + 'загружен</span>' : d[1] === 'warn' ? '<span class="badge warn">' + I('clock') + 'ожидается</span>' : '<span class="badge">' + I('plus') + 'нет</span>') + '</div></div>').join('');
      return dxSec('shield', 'KYC и проверки', '', kycInner) +
        '<div style="margin-top:14px">' + dxSec('doc', 'Удостоверяющие документы', '', '<div class="dfields">' + idDocs + '</div>') + '</div>';
    }
    if (tab === 'deals') {
      const ds = D().deals.filter((x) => x.clientId === c.id);
      const dealRows = ds.map((d) => '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + d.title + '</div><div class="m">' + stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + '</div></div>' + I('arrowRight') + '</div>').join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">связанных сделок нет</div>';
      // A client's contracts belong on the client too: after a purchase the relationship IS the
      // contract, and it is what a repeat deal grows out of.
      const kRows = contractsOfClient(c.id).map(contractRow).join('');
      return dxSec('briefcase', 'Сделки контакта · ' + ds.length, '', '<div class="feed">' + dealRows + '</div>') +
        (kRows ? '<div style="margin-top:14px">' + dxSec('doc', 'Договоры контакта', '', '<div class="feed">' + kRows + '</div>') + '</div>' : '') +
        '<div style="margin-top:14px">' + dxSec('doc', 'Документы клиента', '', docsRows(docsFor((x) => x.client === c.id), 'по этому контакту документов пока нет')) + '</div>';
    }
    if (tab === 'history') {
      // Session action log (what the demo operator did) stays available under the event feed —
      // it is a different thing from the contact's own history and must not masquerade as it.
      const acts = S().events.slice(0, 8).map((e) => '<div class="feed-row"><div class="fi i-mut">' + I('dot') + '</div><div class="ft"><div class="t">' + escAttr(e.action) + '</div><div class="m">' + escAttr(e.time) + ' · ' + escAttr(e.user) + '</div></div></div>').join('');
      return contactFeedBlock(c) +
        (acts ? '<div style="margin-top:14px">' + dxSec('clock', 'Журнал действий в сессии', '', '<div class="feed">' + acts + '</div>') + '</div>' : '');
    }
    // overview
    const s = (D().clientSignals || {})[c.id];
    const prio = s ? '<span class="prio prio-' + s.priority + '">' + s.priority + '</span>' : '';
    // What this client wants ACROSS everything we have run for them — derived from their own deal
    // and request history, not copied from whichever деal happens to be first in the array. «Цель»
    // was exactly that copy: a parameter of one заявка, printed as a property of the person.
    const dir = clientDirections(c);
    const rejectedNames = (function () {
      const names = [];
      (D().requests || []).filter((r) => r.clientId === c.id).forEach((r) => (r.offered || []).forEach((o) => {
        if (o && o.state === 'rejected') {
          const ob = (D().objects || []).find((x) => x.id === (o.id || o));
          if (ob) names.push(ob.name.split(',')[0]);
        }
      }));
      return names;
    })();
    const key = dxSec('target', 'Профиль предпочтений', '', '<div class="dfields cols2">' +
      dfPair('Интерес контакта к типам', (c.objTypes || []).length > 0 ? (c.objTypes || []).map((k) => OBJ_INTEREST_LABEL[k] || k).join(', ') : '(не указан)') +
      (c.interest ? dfPair('Интерес сделки', CONTACT_INTEREST_LABEL[c.interest] || c.interest) : '') +
      (dir.types.length ? dfPair('Типы объектов', joinRu(dir.types)) : '') +
      (dir.ready.length ? dfPair('Готовность', joinRu(dir.ready)) : '') +
      (dir.services.length ? dfPair('Интересуют услуги', joinRu(dir.services)) : '') +
      dfPair('Районы интереса', (c.areas || []).join(', ')) +
      (c.lang ? dfPair('Язык', c.lang) : '') +
      (rejectedNames.length ? dfPair('Отклонял', joinRu(rejectedNames)) : '') +
      (c.preferred ? dfPair('Предпочитает', c.preferred) : '') + '</div>' +
      (c.note ? '<div style="margin-top:8px;font-size:12px;color:var(--mut)">' + c.note + '</div>' : '') +
      (clientPrefProfile(c) ? '<div class="pref-observed">' + clientPrefProfile(c) + '</div>' : ''));
    const sig = dxSec('target', 'Сигналы и приоритет', prio, '<div class="sig-wide">' + signalsInner(c) + '</div>');
    const offer = clientOfferBlock(c);
    // Deal-level actions («подобрать объекты», «расчёт и КП», «назначить показ») belong to a deal
    // and already live on the deal card and in the page header; on the client they invited an agent
    // to act on a transaction from a screen that does not know which transaction.

    const actions = '';   // the bar under the hero carries them now — see clientActions()
    // Two-column rows are for blocks of comparable weight. A feed is not one of them: it grows with
    // the client's history and drags whatever sits beside it to the same height.
    return cxStack([
      [conciergeClientHandover(c), contactBlock(c)],
      [key, psychSummary(c)],
      [offer, sig],
      contactFeedBlock(c, 5),
    ]);
  }
  // Критерии подбора, выведенные из заявок клиента: бюджет — самый крупный из запрошенных,
  // районы — все, которые он называл. Руками агент выставил бы то же самое.
  function clientMatchModel(c) {
    const reqs = (D().requests || []).filter((r) => r.clientId === c.id);
    const m = initMatch(c);
    // Потолок берётся только из запросов на покупку. Бюджет аренды — это ставка за год, и
    // сравнивать её с ценой объекта нельзя: у клиента, который снимает за 95 тысяч и покупает
    // за полтора миллиона, потолком становилось 95 тысяч, и подобрать было нечего.
    const buyFunnels = ['sale', 'cross', 'consult', 'exclusive'];
    const budgets = reqs.filter((r) => buyFunnels.indexOf(r.funnel || 'sale') >= 0)
      .map((r) => r.budget).filter(Boolean);
    if (budgets.length) m.max = Math.max.apply(null, budgets);
    else if (c.budget) m.max = c.budget;
    const areas = [];
    reqs.forEach((r) => (r.areas || []).forEach((a) => { if (areas.indexOf(a) < 0) areas.push(a); }));
    (c.areas || []).forEach((a) => { if (areas.indexOf(a) < 0) areas.push(a); });
    m.psych = !!(c.psych && c.psych.filled);
    // Что человек вообще ищет — жильё или коммерцию. Предлагать инвестору в квартиры офисный блок
    // значит показать, что подбор считает проценты, но не читает запрос.
    const kinds = reqs.map((r) => (r.objectType || '') + ' ' + (r.goal || '') + ' ' + (r.dealType || ''))
      .concat((D().deals || []).filter((d) => d.clientId === c.id).map((d) => d.objectType || ''))
      .concat([(c.types || []).join(' '), c.goal || '']).join(' ');
    return { m: m, areas: areas, commercial: /офис|габ|коммерч|fit-?out/i.test(kinds) };
  }
  // Объекты, которые этому человеку уже показывали, — в любой его заявке и в любом состоянии.
  function clientSeenObjects(c) {
    const seen = {};
    (D().requests || []).filter((r) => r.clientId === c.id)
      .forEach((r) => (r.offered || []).forEach((o) => { seen[o.id] = o.state || 'offered'; }));
    (D().deals || []).filter((d) => d.clientId === c.id)
      .forEach((d) => ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => { if (id) seen[id] = 'deal'; }));
    return seen;
  }
  // Объект, который уже стоит в чьей-то живой сделке, предлагать нельзя никому: он занят, и
  // предложить его — значит пообещать то, чего нет.
  function objectsInLiveDeals() {
    const taken = {};
    (D().deals || []).forEach((d) => {
      if (d.stage === 'lost') return;
      ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => { if (id) taken[id] = d.id; });
    });
    return taken;
  }
  function clientOffers(c) {
    const mm = clientMatchModel(c);
    const seen = clientSeenObjects(c);
    const taken = objectsInLiveDeals();
    return (D().objects || [])
      // Жёсткие отсечки — то, что не обсуждается: чужой класс объекта и цена выше бюджета.
      // Всё остальное решает счёт.
      .filter((o) => !seen[o.id] && !taken[o.id])
      .filter((o) => /офис|габ/i.test(o.br || '') === !!mm.commercial)
      .filter((o) => !mm.m.max || o.price <= mm.m.max * 1.05)
      .map((o) => {
        // Район не сужает выборку жёстко: объект вне названных районов может выиграть по остальному,
        // и тогда агенту важнее увидеть его, чем не увидеть.
        const inArea = !mm.areas.length || mm.areas.indexOf(o.area) >= 0;
        const r = matchScore(o, Object.assign({}, mm.m, { area: 'all' }), c);
        return { o: o, pct: r.pct - (inArea ? 0 : 12), good: r.good, bad: r.bad, inArea: inArea };
      })
      // Порог отсекает совсем чужое, но не оставляет блок пустым при живом инвентаре: слабое
      // совпадение полезнее пустого экрана — агент сам решит, звонить с ним или нет, а помечено
      // оно честно. Пусто здесь означает ровно одно: свободного подходящего инвентаря нет.
      .filter((x) => x.pct >= 40)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3);
  }
  function clientOfferBlock(c) {
    const list = clientOffers(c);
    const seenN = Object.keys(clientSeenObjects(c)).length;
    if (!list.length) {
      const why = seenN
        ? 'Всё, что подходит под запрос, клиенту уже показывали. Новое появится, когда пополнится инвентарь или изменятся критерии.'
        : 'Под этот запрос в инвентаре пока ничего нет — уточните бюджет или район, либо запросите объект у клубного партнёра.';
      return dxSec('building', 'Что предложить', '', '<div class="cm-empty">' + I('search') + why + '</div>');
    }
    const rows = list.map((x) => {
      const o = x.o;
      const weak = x.pct < 55 ? '<span class="badge">' + I('warn') + 'слабое совпадение</span>' : '';
      const why = x.good.slice(0, 3).join(', ') || 'подходит по основным критериям';
      // Оговорки называются вслух: район не тот, что просили, или проверка доступности устарела.
      // Подбор, который молчит о своих натяжках, агент перестаёт читать после первой осечки.
      const notes = [];
      if (!x.inArea) notes.push('не тот район, что просил клиент');
      if (o.verified !== 'verified') notes.push('проверка доступности устарела');
      if (x.bad.length) notes.push(x.bad[0]);
      const warn = notes.length ? '<div class="of-warn">' + I('warn') + notes[0] + '</div>' : '';
      return '<div class="of-row" data-obj="' + o.id + '">' +
        '<span class="of-pct' + (x.pct >= 75 ? ' hi' : '') + '">' + x.pct + '%</span>' +
        '<div class="of-b"><div class="of-t">' + o.name + '</div>' +
        '<div class="of-m">' + o.area + ' · ' + WS.AED(o.price) + ' · ' + o.br + ' ' + weak + '</div>' +
        '<div class="of-why">' + capFirst(why) + '</div>' + warn + '</div>' +
        '<button class="btn xs" data-shortlist="' + o.id + '">' + I('star') + 'В подборку</button></div>';
    }).join('');
    return dxSec('building', 'Что предложить', '<span class="badge ai-b">' + I('sparkle') + 'собрано AI</span>',
      '<div class="of-list">' + rows + '</div>' +
      '<div class="of-foot">' + I('sparkle') + 'Отобрано по бюджету, районам и профилю решений; уже показанное исключено.</div>');
  }
  // ---------------- ОТНОШЕНИЯ С КЛИЕНТОМ (волна 3) ----------------
  /* Отношения — состояние контакта, а не сущность: у них нет ни своих часов, ни условия конца,
     ни отдельного хозяина (клиент пожизненно закреплён за агентом). Поэтому стадия ВЫВОДИТСЯ
     из фактов при каждом чтении и не хранится второй копией: сохранённое значение расходится
     с данными ровно так же, как расходилась «ближайшая задача», угаданная по клиенту.
     Хранится только ручная правка — вместе с тем выводом, поверх которого её поставили. */
  /* Подпись `active` — «Активный», а НЕ «В работе», как записано в §1.1 решений: этими словами
     уже называется стадия сделки, и одна фраза о двух разных вещах на одном экране — это то,
     от чего мы весь август уходим. Ключ значения не меняется. */
  const REL_STAGES = [
    { k: 'new', label: 'Новый', tone: '' },
    { k: 'active', label: 'Активный', tone: 'ok' },
    { k: 'dormant', label: 'Спящий', tone: 'warn' },
    { k: 'lost', label: 'Потерян', tone: 'stop' },
  ];
  const relLabel = (k) => (REL_STAGES.find((x) => x.k === k) || {}).label || k;
  const relTone = (k) => (REL_STAGES.find((x) => x.k === k) || {}).tone || '';
  // Пороги — рабочие числа, вынесенные в данные: их придётся калибровать на живых клиентах,
  // и выдумывать точное значение оснований нет.
  function settingOf(k, dflt) { const s = D().settings || {}; return s[k] == null ? dflt : s[k]; }
  const REQ_OPEN = ['new', 'qual', 'offer', 'meet', 'talks'];
  function requestsOfClient(id) { return (D().requests || []).filter((r) => r.clientId === id); }
  function dealsOfClient(id) { return (D().deals || []).filter((d) => d.clientId === id); }
  // Был ли хоть один успех. Не стадия, а факт биографии: пара «спящий + был успех» — это
  // не потерянный лид, а клиент, о котором забыли, и она и есть цель удержания.
  function clientHasWon(id) {
    return dealsOfClient(id).some((d) => d.stage === 'won') || contractsOfClient(id).length > 0;
  }
  // «13 мая» → день года. Даты в стенде написаны словами, а не отметками времени.
  function dayNumOf(s) {
    const m = /(\d{1,2})\s+([а-яё]+)/i.exec(String(s || ''));
    if (!m) return null;
    const mi = RU_MONTHS.indexOf(m[2].toLowerCase());
    if (mi < 0) return null;
    return dayOfYear(parseInt(m[1], 10), mi + 1);
  }
  function todayNum() { const n = demoNow(); return dayOfYear(n.d, n.mo); }
  // Сколько дней молчим — по всем лентам клиента разом.
  function lastTouchDays(cid) {
    const n = dayNumOf(lastTouchOf(cid));
    if (n == null) return null;
    const days = todayNum() - n;
    return days >= 0 ? days : null;
  }
  function relStageDerived(c) {
    const id = c.id;
    const reqs = requestsOfClient(id);
    const deals = dealsOfClient(id);
    const liveContract = contractsOfClient(id).some((k) => k.status !== 'closed');
    if (!reqs.length && !deals.length && !contractsOfClient(id).length) return 'new';
    const openReq = reqs.some((r) => REQ_OPEN.indexOf(reqStage(r)) >= 0);
    const liveDeal = deals.some((d) => d.stage !== 'won' && d.stage !== 'lost');
    if (openReq || liveDeal || liveContract) return 'active';
    // Открытой работы нет. Отказ без единого успеха — «потерян»; иначе решает тишина.
    const refused = reqs.some((r) => reqStage(r) === 'lost') || deals.some((d) => d.stage === 'lost');
    if (refused && !clientHasWon(id)) return 'lost';
    // Работа закрыта, но разговор идёт — это ещё не «спящий»: порог и есть та граница,
    // на которой контакт перестаёт быть живым.
    const silent = lastTouchDays(id);
    return (silent == null || silent >= settingOf('dormantDays', 90)) ? 'dormant' : 'active';
  }
  /* Ручное значение побеждает вывод — но не навсегда. Оно держится, пока вывод не изменился:
     иначе пометка, поставленная в мае, будет утверждать «потерян» и через год после покупки. */
  function relStageOf(c) {
    const derived = relStageDerived(c);
    const manual = (c.relStage && c.relStageOver === derived) ? c.relStage : null;
    return { k: manual || derived, derived: derived, manual: !!manual };
  }
  function setRelStage(id, k) {
    const c = D().clients.find((x) => x.id === id); if (!c) return;
    if (!k || k === 'auto') { delete c.relStage; delete c.relStageOver; }
    else { c.relStage = k; c.relStageOver = relStageDerived(c); }
    WS.storeApi.touch();
  }

  /* ---- Движок поводов касания (§2.1 решений) ----
     Повод ВЫВОДИТСЯ из данных, а хранится только решение агента по нему. Иначе пришлось бы
     писать коллекцию во время отрисовки и следить, чтобы повторный запуск не порождал второй
     повод той же причины — «правило одного повода» и идемпотентность здесь выполняются сами.
     `why` обязателен: повод без основания не показывается. */
  const CUE_REASONS = {
    birthday: 'день рождения', deal_anniversary: 'годовщина сделки', handover: 'передача ключей',
    lease_90d: 'до конца аренды 90 дней', silence: 'молчим', match_object: 'объект под профиль',
    rent_index: 'сдвиг индекса аренды', new_launch: 'старт продаж в его районе',
    payment_due: 'платёж по графику', milestone_near: 'веха договора близко',
  };
  const cueKey = (cid, reason) => cid + '~' + reason;
  function cueDecision(cid, reason) { return (D().cueState || {})[cueKey(cid, reason)] || null; }
  // Отклонённый повод той же причины не повторяется 30 дней — иначе к концу недели
  // у клиента шесть одинаковых напоминаний.
  function cueSuppressed(cid, reason) {
    const st = cueDecision(cid, reason);
    if (!st) return false;
    if (st.state === 'accepted' || st.state === 'done') return true;
    if (st.state !== 'dismissed') return false;
    const at = st.at == null ? null : st.at;
    return at == null || (todayNum() - at) < settingOf('cueSilenceDays', 30);
  }
  function cuesFor(cid) {
    const c = D().clients.find((x) => x.id === cid);
    if (!c) return [];
    const out = [];
    const add = (reason, title, why, dueAt, payload) => {
      if (!why || cueSuppressed(cid, reason)) return;
      out.push({ key: cueKey(cid, reason), contactId: cid, reason: reason, title: title, why: why,
        dueAt: dueAt || '', payload: payload || {}, source: CUE_SOURCE[reason] || 'state' });
    };
    // Время
    if (c.birthday) {
      const n = dayNumOf(c.birthday), t = todayNum();
      if (n != null && n - t >= 0 && n - t <= 14) add('birthday', 'Поздравить с днём рождения', c.birthday + ' — через ' + (n - t) + ' ' + plural(n - t, 'день', 'дня', 'дней'), c.birthday);
    }
    contractsOfClient(cid).forEach((k) => {
      const sd = dayNumOf(k.signedAt), t = todayNum();
      if (sd != null && Math.abs(t - sd) <= 30) {
        add('deal_anniversary', 'Написать к годовщине покупки', 'договор подписан ' + k.signedAt, k.signedAt, { contractId: k.id });
      }
      const due = (k.schedule || []).find((s) => s.state === 'overdue') || (k.schedule || []).find((s) => s.state === 'due');
      if (due) add('payment_due', 'Напомнить о платеже: ' + due.label, 'по графику договора — ' + due.due, due.due, { contractId: k.id });
      const near = (k.milestones || []).find((m) => m.state === 'now' && !m.internalOnly);
      if (near) add('milestone_near', near.label, 'веха договора ' + (k.number || '') + ' — ' + near.at, near.at, { contractId: k.id, milestoneKey: near.k });
      const ren = k.kind === 'lease' && (k.milestones || []).find((m) => m.k === 'renewal');
      if (ren) add('lease_90d', 'Начать разговор о продлении', 'аренда заканчивается: ' + ren.at, ren.at, { contractId: k.id });
    });
    // Состояние
    const silent = lastTouchDays(cid);
    if (silent != null && silent >= settingOf('silenceDays', 30) && relStageOf(c).k !== 'lost') {
      add('silence', 'Возобновить разговор', 'молчим ' + silent + ' ' + plural(silent, 'день', 'дня', 'дней'), '');
    }
    // Событие: появился объект под профиль. Только то, чего он ещё не видел.
    const seen = {};
    requestsOfClient(cid).forEach((r) => (r.offered || []).forEach((o) => { seen[o.id] = 1; }));
    const areas = c.areas || [];
    const match = (D().objects || []).find((o) => !seen[o.id] && areas.indexOf(o.area) >= 0 &&
      c.budget && o.price && o.price <= c.budget * 1.05);
    if (match) add('match_object', 'Показать новый объект: ' + match.name, match.area + ' · ' + WS.AED(match.price) + ' — в его районах и в бюджете', '', { objectId: match.id });
    return out;
  }
  const CUE_SOURCE = { birthday: 'time', deal_anniversary: 'time', lease_90d: 'time', silence: 'time',
    match_object: 'event', rent_index: 'event', new_launch: 'event', handover: 'event',
    payment_due: 'state', milestone_near: 'state' };
  function cueDecide(key, state) {
    const cs = D().cueState || (D().cueState = {});
    cs[key] = { state: state, at: todayNum() };
    WS.storeApi.touch();
  }
  // Принять повод — значит создать задачу. Повод сам по себе ничего не двигает.
  function acceptCue(key) {
    const cid = String(key).split('~')[0];
    const cue = cuesFor(cid).find((x) => x.key === key);
    if (!cue) return;
    WS.storeApi.addTask({ id: 'tk_cue_' + key.replace(/[^a-z0-9_]/gi, '_'), title: cue.title,
      clientId: cid, kind: 'touch', due: cue.dueAt || 'сегодня', when: 'today',
      // Повод, пришедший от договора, оставляет ссылку на него: иначе задача «напомнить
      // о платеже» висит на человеке и не находится там, где платёж живёт.
      contractId: (cue.payload && cue.payload.contractId) || undefined });
    cueDecide(key, 'accepted');
    WS.storeApi.toast('Повод принят — задача поставлена', 'ok');
  }
  function dismissCue(key) { cueDecide(key, 'dismissed'); WS.storeApi.toast('Повод отклонён — не повторится ' + settingOf('cueSilenceDays', 30) + ' дней'); }

  /* ---- Лента «Отношения» (§4.3 решений): один список, два источника, две секции.
     Брокер видит одну работу и не переключает режимы. Система различает источники и считает
     их отдельно: срок обязательства пропустить нельзя, повод касания — можно. */
  function relationsAhead(c) {
    const rows = [];
    contractsOfClient(c.id).forEach((k) => {
      const kind = contractKind(k).label;
      (k.schedule || []).filter((s) => s.state === 'due' || s.state === 'overdue').forEach((s) => {
        rows.push({ ord: dayNumOf(s.due), kind: 'duty', icon: 'money', tone: s.state === 'overdue' ? 'stop' : '',
          title: s.label + ' · ' + WS.AED(s.amount), meta: kind + ' · срок ' + s.due, tag: 'обязательство', to: 'data-contract="' + k.id + '"' });
      });
      (k.milestones || []).filter((m) => m.state === 'now' && !m.internalOnly).forEach((m) => {
        rows.push({ ord: dayNumOf(m.at), kind: 'duty', icon: 'flag', tone: '',
          title: m.label, meta: kind + ' · ' + m.at, tag: 'обязательство', to: 'data-contract="' + k.id + '"' });
      });
    });
    cuesFor(c.id).forEach((q) => {
      rows.push({ ord: dayNumOf(q.dueAt), kind: 'cue', icon: 'sparkle', tone: 'acc',
        title: q.title, meta: q.why, tag: 'повод', key: q.key });
    });
    // Без разобранной даты запись не новость: она уходит в конец, а не возглавляет список.
    return rows.sort((a, b) => (a.ord == null ? 1e9 : a.ord) - (b.ord == null ? 1e9 : b.ord));
  }
  function relationsPast(c) {
    const rows = [];
    contractsOfClient(c.id).forEach((k) => {
      const kind = contractKind(k).label;
      (k.milestones || []).filter((m) => m.state === 'done').forEach((m) => {
        rows.push({ ord: dayNumOf(m.at), icon: 'check', title: m.label, meta: kind + ' · ' + m.at, tag: 'веха пройдена', to: 'data-contract="' + k.id + '"' });
      });
      (k.schedule || []).filter((s) => s.state === 'paid').forEach((s) => {
        rows.push({ ord: dayNumOf(s.due), icon: 'money', title: s.label + ' · ' + WS.AED(s.amount), meta: kind + ' · оплачен ' + s.due, tag: 'платёж', to: 'data-contract="' + k.id + '"' });
      });
    });
    (D().tasks || []).filter((t) => t.clientId === c.id && t.status === 'done').forEach((t) => {
      rows.push({ ord: dayNumOf(t.due), icon: 'checkCircle', title: t.title, meta: 'задача выполнена' + (t.outcome ? ' · ' + t.outcome : ''), tag: 'касание' });
    });
    return rows.sort((a, b) => (b.ord == null ? -1 : b.ord) - (a.ord == null ? -1 : a.ord));
  }
  function relRow(r) {
    const acts = r.key
      ? '<div class="rel-acts"><button class="btn xs primary" data-cueok="' + r.key + '">' + I('check') + 'Принять</button>' +
        '<button class="tl-ic-btn" data-cueno="' + r.key + '" title="Отклонить повод">' + I('x') + '</button></div>'
      : '';
    const nav = r.to ? ' ' + r.to + ' style="cursor:pointer"' : '';
    return '<div class="rel-row"' + nav + '><div class="fi i-' + (r.tone === 'stop' ? 'hot' : r.tone === 'acc' ? 'acc' : 'mut') + '">' + I(r.icon) + '</div>' +
      '<div class="ft"><div class="t">' + escAttr(r.title) + '</div><div class="m">' + escAttr(r.meta) + '</div></div>' +
      '<span class="rel-tag' + (r.tone === 'stop' ? ' stop' : '') + '">' + r.tag + '</span>' + acts + '</div>';
  }
  function relationsBlock(c) {
    const ahead = relationsAhead(c), past = relationsPast(c);
    const aheadHtml = ahead.length ? ahead.map(relRow).join('')
      : '<div style="font-size:12px;color:var(--faint);padding:6px 0">впереди ничего не запланировано</div>';
    const pastHtml = past.length ? past.slice(0, 12).map(relRow).join('')
      : '<div style="font-size:12px;color:var(--faint);padding:6px 0">пока ничего не завершено</div>';
    const why = '<div class="rel-why">' + I('sparkle') +
      '<span>Обязательства приходят из договоров, поводы — из профиля и состояния. Срок обязательства пропустить нельзя, повод касания — можно.</span></div>';
    return dxSec('clock', 'Впереди · ' + ahead.length, '', why + '<div class="rel-list">' + aheadHtml + '</div>') +
      '<div style="margin-top:14px">' + dxSec('check', 'Было · ' + past.length, '', '<div class="rel-list">' + pastHtml + '</div>') + '</div>';
  }
  /* Портфель: все заявки, сделки и договоры человека одним списком. Общего прогресса
     у них нет и рисовать его нечем — у каждой строки своя стадия и свой срок. */
  function clientPortfolio(c) {
    const rows = [];
    requestsOfClient(c.id).forEach((r) => rows.push('<div class="feed-row" data-request="' + r.id + '" style="cursor:pointer">' +
      '<div class="fi i-mut">' + I('mail') + '</div><div class="ft"><div class="t">' + escAttr(r.title || 'Запрос') + '</div>' +
      '<div class="m">запрос · ' + reqStageLabel(reqStage(r), r) + (r.budget ? ' · ' + WS.AED(r.budget) : '') + '</div></div>' + I('arrowRight') + '</div>'));
    dealsOfClient(c.id).forEach((d) => rows.push('<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer">' +
      '<div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + escAttr(d.title) + '</div>' +
      '<div class="m">сделка · ' + stageLabel(d.stage) + (d.amount ? ' · ' + WS.AED(d.amount) : '') + '</div></div>' + I('arrowRight') + '</div>'));
    contractsOfClient(c.id).forEach((k) => rows.push('<div class="feed-row" data-contract="' + k.id + '" style="cursor:pointer">' +
      '<div class="fi i-ok">' + I(contractKind(k).icon) + '</div><div class="ft"><div class="t">' + contractKind(k).label + ' · ' + (k.number || '') + '</div>' +
      '<div class="m">договор · ' + (k.status === 'closed' ? 'закрыт' : 'действует') + (k.nextDue ? ' · ' + k.nextDue : '') + '</div></div>' + I('arrowRight') + '</div>'));
    const inner = rows.length ? rows.join('') : '<div style="font-size:12px;color:var(--faint);padding:6px 0">работы по этому контакту ещё не было</div>';
    return dxSec('grid', 'Портфель · ' + rows.length, '', '<div class="feed">' + inner + '</div>');
  }
  // Стадия отношений с переключателем: вывод виден рядом с ручным значением, чтобы правка
  // не выглядела единственной правдой.
  function relStageBlock(c) {
    const st = relStageOf(c);
    const pills = REL_STAGES.map((s) => '<button class="rel-pill' + (s.k === st.k ? ' on' : '') + '" data-relstage="' + c.id + ':' + s.k + '">' + s.label + '</button>').join('') +
      (st.manual ? '<button class="rel-pill" data-relstage="' + c.id + ':auto" title="Вернуть автоматический вывод">' + I('sparkle') + 'авто</button>' : '');
    const note = st.manual
      ? 'Поставлено вручную поверх вывода «' + relLabel(st.derived) + '». Держится, пока вывод не изменится.'
      : 'Выведено из фактов: заявки, сделки, договоры и дата последнего касания.';
    const won = clientHasWon(c.id)
      ? '<span class="badge ok">' + I('star') + 'Был успех</span>'
      : '<span class="badge">' + I('dot') + 'Успехов ещё не было</span>';
    return dxSec('users', 'Отношения', won, '<div class="rel-pills">' + pills + '</div>' +
      '<div class="rel-why">' + I('sparkle') + '<span>' + note + '</span></div>');
  }

  function clientSpec(id) {
    const c = D().clients.find((x) => x.id === id); if (!c) return null;
    // Разговор на карточке контакта принадлежит контакту. Прежде тред брался у первой
    // найденной сделки клиента: у Анны их три, и работа по человеку молча оседала
    // в случайной из них. Тот же дефект, что был у ближайшей задачи и у карточки задачи.
    const clientTid = 'contact:' + id;
    const k = kycOf(c);
    const dealsCount = D().deals.filter((x) => x.clientId === id).length;
    // KYC, the preferred channel and the language now live in the compact hero — repeating them as
    // chips right underneath was the same fact stated twice. Only the consent flag, which the hero
    // does not carry and which gates every outbound touch, stays.
    const status = statusChip([
      { icon: c.consent ? 'check' : 'lock', label: c.consent ? 'Согласие на связь есть' : 'Нет согласия на связь', tone: c.consent ? 'ok' : 'stop' },
    ]);
    return {
      type: 'contact', id: id, title: c.name,
      hero: clientHero(c) + status,
      acts: entityActionBar(clientActions(c)),
      state: clientOps(c),
      tabs: [['overview', 'Обзор'], ['relations', 'Отношения'], ['profile', 'Портрет клиента'], ['kyc', 'KYC · документы'], ['deals', 'Сделки · ' + dealsCount], ['history', 'История']],
      render: function (tab) { return clientTabContent(c, tab); },
      concierge: entityConcierge('Спросите Консьержа по контакту — «подбери объекты», «бриф к звонку», «что важно клиенту»…', clientTid, c.name, 'users'),
    };
  }
  function clientCard(id) { S().clientId = id; WS.router.go('clientDetail'); }
  function row(k, v) { return '<div class="field"><div class="k">' + k + '</div><div class="v">' + (v || '—') + '</div></div>'; }

  // ---- CRM gap v3: deal-card blocks (R3 fields+provenance/A1, R4 timeline, A3 conflict, A6 handoff, A7 privacy) ----
  // Provenance badge (A1): AI-suggested field vs human-confirmed. Deterministic fields carry no badge (A4).
  function provBadge(st) {
    // Only flag what needs attention: an AI-suggested value awaiting confirmation. Confirmed and
    // deterministic fields carry no marker, so the value column stays clean and aligned.
    if (st === 'ai') return '<span class="prov-i" title="Предложено AI — подтвердите">' + I('sparkle') + '</span>';
    return '';
  }
  /* Условие сделки правится ПРЯМО В ПОЛЕ — так же, как суть сделки в шапке: одно нажатие,
     Enter сохраняет, Esc отменяет. Модального окна здесь нет намеренно, это и была претензия.

     Что делает правку неочевидной: у каждого поля есть провенанс — откуда факт взялся (из письма
     клиента, из документа, от Консьержа). Молча затереть подтверждённое документом значение
     значит потерять след, поэтому прежнее значение сохраняется в `d.was[поле]`, а само поле
     помечается «изменено вручную» с прежним значением в подсказке.

     Числовые поля отдельно: на экране стоит «2 400 000 AED», а в данных лежит число, которое
     складывают в комиссии и в пайплайне. Записать туда строку с пробелами и валютой — сломать
     все суммы разом, поэтому у числового поля своя разборка ввода. */
  const DFIELD_NUM = { amount: 1 };
  /* Поле карточки и поле данных названы по-разному: на экране «Бюджет», в записи `amount`,
     а происхождение факта лежит под ключом `budget`. Без этой таблицы ручная правка бюджета
     помечала бы происхождение несуществующего поля, и значок «предложено AI» оставался бы
     висеть на цифре, которую человек уже заменил своей. */
  const DFIELD_PROV = { amount: 'budget' };
  /* Часть полей — это словари, а не свободный текст: по «готовности» выбирается вид договора,
     а из вида договора следуют шаги сделки. Опечатка здесь не косметическая — «офплан» вместо
     «оффплан» переводит сделку во вторичку, у которой нет брони, и сделка оказывается на шаге,
     которого нет в её пути. Поэтому свободный ввод в такие поля не принимается. */
  const DFIELD_ENUM = { readiness: 'readiness', objectType: 'objectType', saleKind: 'saleKind', side: 'side' };
  function dfieldAllowed(fieldKey) {
    const k = DFIELD_ENUM[fieldKey];
    return k ? (DEAL_ENUMS[k] || []).filter(Boolean) : null;
  }
  function dealField(label, val, provSt, confirmId, dealId, fieldKey) {
    const confirm = provSt === 'ai' && confirmId ? '<button class="mini-confirm" data-dfconfirm="' + confirmId + '" title="Подтвердить значение">' + I('check') + '</button>' : '';
    const d = dealId ? D().deals.find((x) => x.id === dealId) : null;
    const was = (d && d.was && d.was[fieldKey] != null) ? d.was[fieldKey] : null;
    const wasTag = was != null ? '<span class="dv-was" title="Изменено вручную. Прежнее значение: ' +
      escAttr(DFIELD_NUM[fieldKey] ? WS.AED(was) : String(was)) + '">изменено вручную</span>' : '';
    // Значение приходит из того, что человек напечатал в поле, и уходит в разметку. Без
    // экранирования набранная разметка исполнилась бы при следующей отрисовке.
    const shown = escAttr(val == null || val === '' ? '—' : String(val));
    if (!dealId || !fieldKey) {
      return '<div class="dfield"><div class="dk">' + label + '</div><div class="dv">' + shown + ' ' + provBadge(provSt) + confirm + '</div></div>';
    }
    const allowed = dfieldAllowed(fieldKey);
    const hint = allowed ? 'Допустимые значения: ' + allowed.join(', ') + '. Enter — сохранить, Esc — отменить'
      : 'Кликните, чтобы изменить. Enter — сохранить, Esc — отменить';
    return '<div class="dfield editable"><div class="dk">' + label + '</div>' +
      '<div class="dv"><span class="dv-edit" contenteditable="true" role="textbox" ' +
      'data-dfedit="' + dealId + '~' + fieldKey + '" ' +
      'aria-label="' + escAttr(label) + ' — нажмите, чтобы изменить" ' +
      'title="' + escAttr(hint) + '">' + shown + '</span> ' +
      provBadge(provSt) + confirm + wasTag + '</div></div>';
  }
  // Разбор введённого: у числового поля из «2 400 000 AED» достаётся число, всё остальное — текст
  // как есть. Пустой ввод и «—» означают «не заполнено», а не строку из одного тире.
  function dfieldParse(fieldKey, raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || s === '—') return DFIELD_NUM[fieldKey] ? 0 : '';
    if (!DFIELD_NUM[fieldKey]) return s;
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? null : n;                       // null = ввод не разобран, правку не применяем
  }
  function saveDealField(dealId, fieldKey, raw, opts) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return false;
    const next = dfieldParse(fieldKey, raw);
    if (next === null) {                              // число не разобрано — молча не портим данные
      WS.storeApi.toast('Не понял значение — оставил прежнее');
      dealCard(dealId);
      return false;
    }
    // Словарное поле принимает только своё значение. Отказ громкий и называет допустимые:
    // молча оставить прежнее значило бы, что человек уверен, будто правка применилась.
    const allowed = dfieldAllowed(fieldKey);
    if (allowed && String(next) !== '' && allowed.indexOf(String(next)) < 0) {
      WS.storeApi.toast('«' + next + '» — не из этого списка. Допустимо: ' + allowed.join(', '));
      dealCard(dealId);
      return false;
    }
    const prev = d[fieldKey];
    if (String(prev == null ? '' : prev) === String(next)) return false;
    d.was = d.was || {};
    if (d.was[fieldKey] == null) d.was[fieldKey] = prev;   // первый оригинал, а не предыдущая правка
    d[fieldKey] = next;
    d.prov = d.prov || {};
    d.prov[DFIELD_PROV[fieldKey] || fieldKey] = 'manual';
    // Уход из поля не перерисовывает приложение: отрисовка заменяет узел, по которому человек
    // только что кликнул, и его клик пропадает — кнопка выглядит мёртвой. То же правило уже
    // действует для правки названия сделки, здесь оно повторено намеренно.
    WS.storeApi.touch(opts && opts.render === false ? { render: false } : undefined);
    WS.storeApi.toast('Значение изменено — прежнее сохранено', 'ok');
    return true;
  }
  // Params tab shows only what the header «Ключевое» doesn't (no Бюджет/Форма оплаты/Цель/Тип —
  // those are up top). Источник is inherited from the заявка, labelled as such.
  // Граница «условия согласованы»: до неё работа идёт про подбор — объекты, предложения,
  // сравнение; после — про оформление: гейты, документы, договор. Один и тот же набор вкладок
  // на обоих участках означает, что половина из них всегда пустая, и это единственная сильная
  // мысль макета партнёра. Считается по шагам ЭТОГО вида договора, а не по общему списку:
  // у оффплана есть бронь, у перепродажи её нет.
  function dealTermsAgreed(d) {
    if (!d) return false;
    if (dealClosed(d)) return true;
    const steps = (WS.DEAL_STEPS || {})[WS.contractKindFor(d.funnel, d.readiness)] || ['prep'];
    const i = steps.indexOf(d.stage);
    return i > 0;                       // 0 — «Подготовка к сделке», это ещё подбор
  }
  function dealParamsExtra(d) {
    const co = (D().companies || []).find((x) => x.id === d.companyId);
    const p = d.prov || {};
    // Тип объекта, готовность и источник стоят в левой колонке и правятся там; здесь их нет,
    // иначе одно значение живёт на экране в двух местах и правится в одном.
    return (d.saleKind ? dealField('Вид сделки', d.saleKind, p.saleKind, d.id + ':saleKind') : '') +
      dealField('Сторона клиента', d.side, p.side, d.id + ':side') +
      dealField('VAT 5%', d.vat ? 'применяется' : 'не применяется', p.vat) +
      dealField('Компания', co ? '<span data-company="' + co.id + '" style="cursor:pointer;border-bottom:1px solid var(--acc-line)">' + co.name + '</span> · ' + co.kind : '—', 'confirmed') +
      dealField('Агент-партнёр', d.partnerAgent ? agentName(d.partnerAgent) : '—', 'confirmed') +
      dealField('Рассматриваемые проекты', (d.consideredProjects || []).join(', ') || '—', 'confirmed');
  }
  function conflictBlock(d) {
    const cf = (D().conflicts || {})[d.id];
    if (!cf) return '';
    const opt = (key, val) => '<button class="cc-opt' + (cf.chosen === key ? ' on' : '') + '" data-conflict="' + d.id + ':' + key + '">' + val + (cf.chosen === key ? ' ' + I('check') : '') + '</button>';
    return '<div class="conflict-card"><div class="cc-h">' + I('warn') + 'Расхождение · ' + cf.field + '</div>' +
      '<div class="cc-opts">' + opt('a', cf.a) + '<span class="cc-vs">против</span>' + opt('b', cf.b) + '</div>' +
      '<div class="cc-note">' + cf.note + ' Замена видна — оба значения сохранены.</div></div>';
  }
  function handoffBlock(d) {
    if (!d.partnerAgent) return '';
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    return '<div class="section-label" style="margin-top:16px">Пакет передачи партнёру' +
      '<span class="badge ai-b" style="margin-left:6px">' + I('sparkle') + 'собрано AI</span></div>' +
      '<div class="handoff">' +
      '<div class="hf-row">' + I('users') + '<span>' + (c.name || d.title) + ' · ' + d.goal + ' · ' + WS.AED(d.amount) + '</span></div>' +
      '<div class="hf-row">' + I('handshake') + '<span>Партнёр: ' + agentName(d.partnerAgent) + '</span></div>' +
      '<div class="hf-row">' + I('check') + '<span>История, обещания и документы приложены; следующий шаг — подтвердить объект.</span></div></div>';
  }
  // Next-best-action rules — shared by the overview NBA block and the deal-header "now" summary.
  function nbaActions(d) {
    /* Закрытая сделка не «застряла», и двигать её некуда. Без этой развилки сюда доезжали won
       и lost, и на карточке успешно закрытой сделки в «Запланировано» стояло «Вернуться к
       сделке: позвонить, предложить следующий шаг · застряла 8 дн. в стадии» — совет открыть
       заново то, что закончено, и упрёк за срок, который перестал идти в день закрытия.
       Правило живёт здесь, а не у каждого читателя: следующий шаг отсюда берут и карточка, и
       колода предложений в Пульсе, и заявка, и Консьерж — четыре места разошлись бы. */
    if (dealClosed(d)) {
      return dealWon(d)
        ? { doIt: ['Запросить отзыв и рекомендации у клиента'], why: 'сделка закрыта успешно, работа по ней завершена' }
        : { doIt: ['Разобрать причину проигрыша и вернуть клиента в работу'], why: 'сделка проиграна и закрыта' };
    }
    const doIt = []; let why = '';
    if (d.stageDays >= 5) { doIt.push('Вернуться к сделке: позвонить, предложить следующий шаг'); why = 'застряла ' + d.stageDays + ' дн. в стадии'; }
    if (d.hot) { doIt.push('Ответить в течение 2 часов (SLA)'); why = why || 'горячий клиент'; }
    if (d.partnerAgent) doIt.push('Согласовать co-broking и сплит с партнёром');
    // Concrete operational step by stage — not a vague goal like «двигать к вехе».
    doIt.push(({ new: 'Назначить показ объектов клиенту', work: 'Согласовать оффер и условия с клиентом',
      docs: 'Подписать договор с клиентом', done: 'Запросить отзыв и рекомендации у клиента' })[d.stage] || 'Согласовать следующий шаг с клиентом');
    return { doIt: doIt, why: why };
  }
  function chIcon(ch) {
    return ({ whatsapp: 'whatsapp', call: 'phone', email: 'mail', note: 'pencil', system: 'sparkle',
      meet: 'calendar', crm: 'clock', task: 'checkCircle', doc: 'doc' })[ch] || 'dot';
  }
  // Event name = what happened, shown as the card headline. `e.t` overrides for derived entries.
  const EV_TITLE = { call: 'Звонок', meet: 'Встреча', whatsapp: 'Сообщение · WhatsApp', email: 'Письмо',
    note: 'Заметка', task: 'Задача', crm: 'Событие CRM', system: 'Разбор Консьержа', doc: 'Документ' };
  function evTitle(e) { return e.t || EV_TITLE[e.ch] || 'Событие'; }
  // Source of the event: who put it there — a person, the AI agent, the client, or the system.
  function evSource(e) {
    const by = e.by || '—';
    if (e.kind === 'ai' || by === 'Консьерж') return { cls: 'ai', icon: 'sparkle', name: by, role: 'AI-агент' };
    if (by === 'Клиент') return { cls: 'client', icon: 'users', name: 'Клиент', role: 'входящее' };
    if (by === 'Система') return { cls: 'sys', icon: 'shield', name: 'Система', role: 'CRM' };
    // `_role` carries a role the caller already knows (executor strings ship as "Имя · роль").
    // A generic "Агент" is its own role — don't render "Агент · агент".
    const role = e._role != null ? e._role : (by.toLowerCase() === 'агент' ? '' : 'агент');
    return { cls: 'human', icon: 'users', name: by, role: role };
  }
  // One event card shared by every feed (deal, contact, company).
  // `del` = the full data-attribute of the delete control, empty when the entry is not a removable note.
  // `e.src` = originating entity label, shown when a feed merges entries from elsewhere.
  function tlRow(e, del) {
    const s = evSource(e);
    // The "immutable" lock belongs to real channel material only — a task or a planned viewing is
    // pulled from elsewhere in the demo, so marking it as untouchable channel raw would be a lie.
    const lock = (e.kind === 'raw' && !e._d) ? '<span class="tl-lock" title="Сырьё канала — неизменяемо">' + I('lock') + '</span>' : '';
    const edit = del ? '<button class="tl-ic-btn" ' + del + ' title="Удалить заметку">' + I('x') + '</button>' : '';
    // The lock sits with the timestamp; the tag row carries only real labels, so it never
    // renders as a lone stray icon under the text.
    // On a company feed the counterpart matters as much as the channel: «с кем именно говорили»
    // is the difference between a conversation with the ЛПР and one with an operations manager.
    const who = e._person ? '<span class="tl-src">' + I('users') + escAttr(e._person) + '</span>' : '';
    const tags = (e.capture ? '<span class="cap-tag">' + I('mic') + 'запись</span>' : '') + who +
      (e.src ? '<span class="tl-src">' + I('briefcase') + escAttr(e.src) + '</span>' : '');
    return '<div class="evc ' + e.kind + '">' +
      '<div class="evc-top"><span class="evc-ic ' + s.cls + '">' + I(chIcon(e.ch)) + '</span>' +
      '<span class="evc-name">' + escAttr(evTitle(e)) + '</span>' +
      '<span class="evc-by ' + s.cls + '">' + I(s.icon) + escAttr(s.name) + (s.role ? '<i>' + s.role + '</i>' : '') + '</span>' +
      '<span class="evc-when">' + escAttr(e.at) + lock + '</span>' + edit + '</div>' +
      '<div class="evc-text">' + escAttr(e.text) + '</div>' +
      (tags ? '<div class="evc-tags">' + tags + '</div>' : '') + '</div>';
  }
  // Newest first — a broker opens a card to see what just happened, not how it started.
  // Sort is applied to a (entry, originalIndex) pair so index-addressed note deletion stays correct.
  function feedSortDesc(pairs) {
    return pairs.sort((a, b) => ((b.e.ord == null ? 0 : b.e.ord) - (a.e.ord == null ? 0 : a.e.ord)) || (b.i - a.i));
  }
  function dealTimelineInner(d) {
    const tl = (D().dealTimeline || {})[d.id] || [];
    const cap = S().capture || {};
    const on = (d.id in cap) ? cap[d.id] : true;
    const born = dealCreationEntry(d);
    const pairs = tl.map((e, i) => ({ e: e, i: i }));
    if (born) pairs.push({ e: born, i: -1 });   // i = -1: synthetic, never a deletable note
    const rows = feedSortDesc(pairs)
      .map((p) => tlRow(p.e, p.e.kind === 'note' ? 'data-notedel="' + d.id + ':' + p.i + '"' : ''))
      .join('') || '<div style="font-size:12px;color:var(--faint);padding:8px 0">пока нет истории по каналам</div>';
    const privacy = '<div class="cap-toggle"><span>' + I('lock') + 'Запись разговоров по сделке (A7)</span>' +
      '<button class="switch' + (on ? ' on' : '') + '" data-act="capToggle" data-deal="' + d.id + '" role="switch" aria-checked="' + on + '"><i></i></button></div>';
    return privacy + '<div class="timeline">' + rows + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:4px">Сырьё канала (звонок/письмо/сообщение) не меняется. Заметки правятся и удаляются. Внешняя отправка — имитируется.</div>';
  }
  function dealTimelineBlock(d) {
    return '<div class="section-label" style="margin-top:16px">Лента событий' +
      '<button class="btn xs" data-act="addEvent" data-scope="deal" data-deal="' + d.id + '">' + I('plus') + 'Событие</button></div>' + dealTimelineInner(d);
  }

  // ---- Contact event feed — the chronological ribbon of everything that happened with a contact.
  // Sources: contact-level history, the channel history of the contact's deals, tasks and planned
  // meetings. `ord` (DDHHMM, demo week 11–17 мая) is the single sort key; entries without one sink
  // to the bottom as "just added".
  // Everything is anchored to the demo clock, never to the wall clock, so ordering is stable.
  const NOW = (WS.fixtures && WS.fixtures.DEMO_NOW) || { d: 14, h: 9, mi: 12 };
  const ORD = (d, h, mi) => d * 10000 + h * 100 + mi;
  const NOW_ORD = ORD(NOW.d, NOW.h, NOW.mi);
  // Undated ("позже — по согласованию") is not news: with a newest-first feed it must sink to the
  // bottom, never head the ribbon and never push a real event out of the overview preview.
  const UNDATED_ORD = 0;
  const DAY_WORD = { 'сегодня': NOW.d, 'завтра': NOW.d + 1, 'вчера': NOW.d - 1, 'просрочено': NOW.d - 1 };
  // Task `when` is an internal enum, not a Russian phrase — map it explicitly.
  const TASK_ORD = { overdue: ORD(NOW.d - 1, 10, 0), today: ORD(NOW.d, 10, 0), tomorrow: ORD(NOW.d + 1, 10, 0) };
  // Demo dates are written as words ("сегодня 16:00"), not timestamps — resolve them against the demo day.
  function ordFromWhen(w, fallback) {
    const s = String(w || '');
    const day = Object.keys(DAY_WORD).find((k) => s.indexOf(k) >= 0);
    const tm = s.match(/(\d{1,2}):(\d{2})/);
    if (!day && !tm) return fallback;
    return ORD(day ? DAY_WORD[day] : NOW.d, tm ? +tm[1] : 12, tm ? +tm[2] : 0);
  }
  // Deal label for a contact feed: deal titles repeat the client name, so fall back to the subtitle.
  function dealFeedLabel(d, c) {
    return (d.title && c && d.title !== c.name) ? d.title : (d.sub || d.title || 'сделка');
  }
  // One builder for contact and company: own history + the channel history of the related deals,
  // plus (contacts only) tasks and planned meetings. `_ci` = index into the entity's OWN timeline,
  // the only editable source — it survives merge+sort so note deletion always hits the right entry.
  function entityFeedEntries(kind, ent) {
    const data = D();
    const out = [];
    const isContact = kind === 'contact';
    const own = isContact ? (data.contactTimeline || {}) : (data.companyTimeline || {});
    const roster = (!isContact && ent.people) || [];
    (own[ent.id] || []).forEach((e, i) => {
      const per = (e.person != null && roster[e.person]) ? roster[e.person] : null;
      out.push(Object.assign({}, e, { _ci: i }, per ? { _person: per.name + ' · ' + lowerFirst(per.role) } : {}));
    });
    const deals = (data.deals || []).filter((d) => isContact ? d.clientId === ent.id : d.companyId === ent.id);
    deals.forEach((d) => {
      const lbl = isContact ? dealFeedLabel(d, ent) : (d.title || d.sub || 'сделка');
      ((data.dealTimeline || {})[d.id] || []).forEach((e) => out.push(Object.assign({}, e, { src: lbl })));
    });
    if (isContact) {
      // Tasks and planned meetings — the feed is where "что было и что предстоит" meet.
      (data.tasks || []).filter((t) => t.clientId === ent.id).forEach((t) => {
        out.push({ at: 'срок: ' + t.due, ord: TASK_ORD[t.when] != null ? TASK_ORD[t.when] : ordFromWhen(t.due, TASK_ORD.today),
          ch: 'task', kind: 'raw', _d: true, by: 'Консьерж', t: 'Задача', text: t.title + (t.status === 'done' ? ' — выполнена' : '') });
      });
      (data.events || []).filter((ev) => ev.clientId === ent.id).forEach((ev) => {
        const off = ev.status === 'canceled';
        const what = ev.kind === 'call' ? 'Звонок' : 'Показ';
        // Executor is stored as "Имя · роль" — split it so the source badge doesn't repeat the role.
        const ex = String(ev.executor || 'Марина Волкова · агент').split(' · ');
        // "позже — по согласованию" carries no date: it is not news, so it sits at the end.
        out.push({ at: ev.when, ord: ordFromWhen(ev.when, UNDATED_ORD),
          ch: ev.kind === 'call' ? 'call' : 'meet', kind: 'raw', _d: true, by: ex[0], _role: ex[1] || 'агент',
          t: what + (off ? ' · отменён' : ' · запланирован'),
          text: ev.title + (off ? ' — отменён' : '') });
      });
    }
    return feedSortDesc(out.map((e, i) => ({ e: e, i: i }))).map((p) => p.e);
  }
  function entityFeedInner(kind, ent, limit) {
    const list = entityFeedEntries(kind, ent);
    const total = list.length;
    // Newest first, so the preview is simply the head of the list.
    const shown = (limit && total > limit) ? list.slice(0, limit) : list;
    const delAttr = kind === 'contact' ? 'data-cnotedel' : 'data-conotedel';
    const rows = shown.map((e) => tlRow(e, (e.kind === 'note' && e._ci != null) ? delAttr + '="' + ent.id + ':' + e._ci + '"' : ''))
      .join('') || '<div style="font-size:12px;color:var(--faint);padding:8px 0">' + (kind === 'contact' ? 'по контакту пока нет событий' : 'по компании пока нет событий') + '</div>';
    const more = (limit && total > limit)
      ? '<button class="btn xs" data-etab="' + kind + '~' + ent.id + '~history" style="margin-top:8px">' + I('clock') + 'Вся лента · ' + total + '</button>' : '';
    // Черновики итогов по этому контакту — над лентой и только на полной истории: в превью
    // они вытеснили бы настоящие события, которых там и так три строки.
    const drafts = limit ? '' : outcomesBlock(kind === 'contact' ? 'contact' : 'company', ent.id);
    return '<div class="timeline">' + drafts + rows + '</div>' + more;
  }
  function contactFeedEntries(c) { return entityFeedEntries('contact', c); }
  function contactFeedInner(c, limit) { return entityFeedInner('contact', c, limit); }
  // limit set -> compact preview for the overview tab; unset -> the full ribbon on the history tab.
  function entityFeedBlock(kind, ent, limit) {
    const idAttr = kind === 'contact' ? 'data-cid="' : 'data-coid="';
    const addBtn = '<button class="btn xs" data-act="addEvent" data-scope="' + kind + '" ' + idAttr + ent.id + '">' + I('plus') + 'Событие</button>';
    const foot = limit ? '' :
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Новое сверху. Звонки, встречи, сообщения по каналам и заметки — одной лентой. Сырьё канала неизменяемо; заметки правятся и удаляются.</div>';
    return dxSec('clock', limit ? 'Лента событий · последние' : 'Лента событий', addBtn, entityFeedInner(kind, ent, limit) + foot);
  }
  function contactFeedBlock(c, limit) { return entityFeedBlock('contact', c, limit); }
  function companyFeedBlock(co, limit) { return entityFeedBlock('company', co, limit); }
  // ---- Comms history. The request shows ONLY its own history (drill into a deal for the deal's own).
  // A deal shows its full LINEAGE — this deal + the заявка it grew from + contact notes — but NOT
  // sibling deals (merging two deals into one is noise). ----
  function commsFilterVal() { return (WS.store && WS.store.commsFilter) || 'all'; }
  function commsFilterChips(chips) {
    const active = commsFilterVal();
    return '<div class="comms-filter">' + chips.map((ch) =>
      '<button class="chip' + (ch[0] === active ? ' on' : '') + '" data-commsfilter="' + ch[0] + '">' + I(ch[2]) + ch[1] + '</button>').join('') + '</div>';
  }
  function commsFeedRows(list) {
    const rows = list.map((e) => tlRow(e, '')).join('') ||
      '<div style="font-size:12px;color:var(--faint);padding:8px 0">по выбранному фильтру событий нет</div>';
    return '<div class="timeline">' + rows + '</div>';
  }
  const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function demoNow() { return (WS.fixtures && WS.fixtures.DEMO_NOW) || { d: 14, mo: 5 }; }
  function dayOfYear(day, mo) { let n = day; for (let i = 0; i < (mo || 1) - 1; i++) n += MONTH_DAYS[i]; return n; }
  // «18 апреля» → { day: 18, mo: 4 }. A date with no month named is read as the demo month.
  function createdOn(d) {
    if (!d || !d.createdAt) return null;
    const m = /^(\d+)\s*([а-яё]*)/i.exec(d.createdAt);
    if (!m) return null;
    const mi = RU_MONTHS.indexOf((m[2] || '').toLowerCase());
    return { day: parseInt(m[1], 10), mo: mi >= 0 ? mi + 1 : demoNow().mo };
  }
  function createdAgoLabel(d) {
    const c = createdOn(d); if (!c) return null;
    const now = demoNow();
    const diff = dayOfYear(now.d, now.mo) - dayOfYear(c.day, c.mo);
    if (diff <= 0) return 'сегодня';
    if (diff === 1) return '1 дн. назад';
    return diff + ' дн. назад';
  }
  // The deal's birth is a real event, but it lives on the deal record rather than in the timeline
  // fixtures — so it is synthesised at render time and sorts to the bottom (oldest) of the ribbon.
  function dealCreationEntry(d) {
    if (!d.createdAt) return null;
    const c = createdOn(d);
    // Sort key is relative to the demo month, so an earlier month goes negative and stays oldest
    // instead of being read as a day of the current one.
    const rel = c ? (dayOfYear(c.day, c.mo) - dayOfYear(1, demoNow().mo) + 1) : 1;
    return {
      at: d.createdAt, ord: c ? ORD(rel, 0, 1) : 1,
      ch: 'crm', kind: 'ai', by: 'Консьерж', t: 'Сделка заведена',
      text: 'Сделка заведена в системе' + (d.requestId ? ' из запроса' : '') + '.',
    };
  }
  function dealLineageEntries(d) {
    const data = D();
    const out = [];
    const born = dealCreationEntry(d);
    if (born) out.push(Object.assign({}, born, { src: 'Сделка', _origin: { type: 'deal', id: d.id } }));
    ((data.dealTimeline || {})[d.id] || []).forEach((e) => out.push(Object.assign({}, e, { src: 'Сделка', _origin: { type: 'deal', id: d.id } })));
    if (d.requestId) {
      const r = requestById(d.requestId);
      if (r) ((data.requestTimeline || {})[r.id] || []).forEach((e) => out.push(Object.assign({}, e, { src: 'Запрос · ' + r.title, _origin: { type: 'request', id: r.id } })));
    }
    ((data.contactTimeline || {})[d.clientId] || []).forEach((e) => out.push(Object.assign({}, e, { src: 'Контакт', _origin: { type: 'contact', id: d.clientId } })));
    return feedSortDesc(out.map((e, i) => ({ e: e, i: i }))).map((p) => p.e);
  }
  // Request История — own timeline only.
  function requestHistoryTab(r) {
    const addBtn = '<button class="btn xs" data-act="addEvent" data-scope="request" data-req="' + r.id + '">' + I('plus') + 'Событие</button>';
    return dxSec('clock', 'История коммуникаций', addBtn, requestTimelineInner(r));
  }
  // Deal История — full lineage by default; filter to just the сделка or just the заявка.
  function dealHistoryTab(d) {
    const filter = commsFilterVal();
    const chips = commsFilterChips([['all', 'Вся история', 'clock'], ['deal', 'Сделка', 'briefcase'], ['request', 'Запрос', 'mail']]);
    const addBtn = '<button class="btn xs" data-act="addEvent" data-scope="deal" data-deal="' + d.id + '">' + I('plus') + 'Событие</button>';
    let inner;
    if (filter === 'deal') inner = dealTimelineInner(d);
    else if (filter === 'request') inner = commsFeedRows(dealLineageEntries(d).filter((e) => e._origin.type === 'request'));
    else inner = commsFeedRows(dealLineageEntries(d));
    return dxSec('clock', 'История коммуникаций', addBtn, chips + inner);
  }
  // Re-render only the active tab body (no full-page emit) so the filter click doesn't jump to top.
  // Resolve the spec from the active tab in the clicked element's scope (page vs modal), not the
  // global WS._card — which can be stale after a modal closes (mirrors setEntityTab).
  function refreshCommsTab(srcEl) {
    const scope = srcEl ? (srcEl.closest('#modal') || document.getElementById('main') || document) : (document.getElementById('main') || document);
    const el = scope.querySelector('.dx-tabbody'); if (!el) return;
    const onTab = scope.querySelector('.dx-tab.on') || scope.querySelector('.dx-tab');
    const etab = onTab && onTab.getAttribute('data-etab'); if (!etab) return;
    const p = etab.split('~');
    const spec = (WS._cardByType && WS._cardByType[p[0]]) || WS._card;
    if (!spec || spec.type !== p[0] || String(spec.id) !== String(p[1])) return;
    el.innerHTML = spec.render(p[2]);
  }
  // ---- Deal contacts (P3): a deal can involve several people, each with a role + influence rating (A/B/C).
  /* Справочник ролей участника — двенадцать ролей в трёх группах. Прежние восемь описывали
     только сторону клиента, а партнёр просил роли, которые пересекают стол. Группа нужна
     не для порядка в списке, а для правила: основным контактом сделки может быть только тот,
     чьё решение мы ведём, — менеджер девелопера основным быть не может. */
  const ROLE_GROUPS = [
    { k: 'client', label: 'Сторона клиента', roles: ['Клиент', 'Со-покупатель', 'Инвестор', 'Супруг', 'Представитель по доверенности', 'Юрист клиента', 'Финансист клиента', 'Референт'] },
    { k: 'other', label: 'Другая сторона', roles: ['Собственник', 'Менеджер девелопера'] },
    { k: 'broker', label: 'Посредники', roles: ['Агент-партнёр', 'Ипотечный брокер'] },
  ];
  const CONTACT_ROLES = ROLE_GROUPS.reduce((a, g) => a.concat(g.roles), []);
  /* Таблица перехода со старого справочника. Строка «ЛПР» уходит из ролей совсем: это мера
     влияния, а не роль, и держать её в обоих словарях значит позволить участнику быть
     «ЛПР по роли и исполнителем по влиянию». Партнёрское «Клиент-ЛПР» раскладывается
     ровно на эту пару. Переход читается и на старых данных, а не только на новых. */
  const ROLE_WAS = { 'Покупатель': 'Клиент', 'ЛПР': 'Клиент', 'Супруг — со-решение': 'Супруг',
    'Юрист сделки': 'Юрист клиента', 'Представитель': 'Представитель по доверенности' };
  function roleOf(ct) { const r = ct && ct.role; return ROLE_WAS[r] || r || 'Клиент'; }
  function roleGroupOf(ct) {
    const r = roleOf(ct);
    const g = ROLE_GROUPS.find((x) => x.roles.indexOf(r) >= 0);
    return g ? g.k : 'client';
  }
  // Влияние — тот же словарь, что уже используется у контактов компаний. Буквенная шкала
  // уходит: «A» ничего не говорит человеку, открывшему карточку впервые.
  const INFLUENCE = [{ k: 'lpr', label: 'ЛПР' }, { k: 'infl', label: 'влияет' }, { k: 'exec', label: 'исполнитель' }];
  const INFL_WAS = { A: 'lpr', B: 'infl', C: 'exec', 'ЛПР': 'lpr', 'влияет': 'infl', 'исполнитель': 'exec' };
  function influenceOf(ct) {
    const raw = ct && (ct.influence || ct.rating);
    // Роль «ЛПР» из старого справочника несла влияние в себе — при переносе оно не теряется.
    if (!raw && ct && ct.role === 'ЛПР') return 'lpr';
    return INFL_WAS[raw] || (INFLUENCE.some((x) => x.k === raw) ? raw : 'infl');
  }
  const inflLabel = (k) => (INFLUENCE.find((x) => x.k === k) || INFLUENCE[1]).label;
  // Область задачи — первое попадание: есть сделка → задача сделки; иначе заявка → задача заявки;
  // иначе задача по контакту. Клиентская задача законна: касания и поздравления не относятся
  // ни к какой сделке, и требовать привязку значило бы запретить половину работы по удержанию.
  function tasksOfDeal(d) { return (D().tasks || []).filter((t) => t.dealId === d.id); }
  // Задача с обеими ссылками разрешается в сделку — значит в заявке её быть не должно,
  // иначе подпись говорит «сделка», а список заявки показывает ту же строку у себя.
  function tasksOfRequest(r) { return (D().tasks || []).filter((t) => !t.dealId && t.requestId === r.id); }
  function taskScopeLabel(t) {
    if (t.dealId) { const d = D().deals.find((x) => x.id === t.dealId); return d ? 'сделка · ' + d.title : 'сделка'; }
    if (t.requestId) { const r = (D().requests || []).find((x) => x.id === t.requestId); return r ? 'запрос · ' + r.title : 'запрос'; }
    return 'клиент';
  }
  function dealContacts(d) {
    if (Array.isArray(d.contacts) && d.contacts.length) return d.contacts;
    if (d.clientId) return [{ clientId: d.clientId, role: 'Клиент', influence: 'lpr', primary: true }];
    return [];
  }
  function contactDisplayName(ct) {
    if (ct.clientId) { const c = D().clients.find((x) => x.id === ct.clientId); if (c) return c.name; }
    return ct.name || '—';
  }
  // Канал участника: свой, если задан, иначе тот, которым мы связываемся с этим контактом.
  function partChannel(ct) {
    if (ct.channel) return ct.channel;
    const c = ct.clientId ? D().clients.find((x) => x.id === ct.clientId) : null;
    return (c && c.channel) || null;
  }
  // Значок влияния стал подписью-пилюлей: слово в круг 22 на 22 не помещается. Класс берётся
  // из КЛЮЧА, а не из отображаемого текста, — иначе смена подписи сломает вёрстку.
  function inflPill(k) {
    const v = INFLUENCE.find((x) => x.k === k) || INFLUENCE[1];
    return '<span class="c-infl c-infl-' + v.k + '" title="Влияние на решение">' + v.label + '</span>';
  }
  function dealContactsInner(d) {
    const list = dealContacts(d);
    const rows = list.map((ct, i) => {
      const c = ct.clientId ? D().clients.find((x) => x.id === ct.clientId) : null;
      const co = ct.companyId ? (D().companies || []).find((x) => x.id === ct.companyId) : null;
      const ch = partChannel(ct);
      const chan = ch ? '<span class="dc-ch" title="Предпочитаемый канал: ' + chanMeta(ch)[1] + '">' + I(chanMeta(ch)[0]) + '</span>' : '';
      const from = co ? '<span class="dc-co" data-company="' + co.id + '" style="cursor:pointer">' + co.name + '</span>' : '';
      const sub = [roleOf(ct), from, (c && c.goal) || ct.phone].filter(Boolean).join(' · ');
      const star = ct.primary ? '<span class="c-star" title="Основной контакт">' + I('star') + '</span>' : '';
      const main = '<div class="dc-main"' + (ct.clientId ? ' data-client="' + ct.clientId + '" style="cursor:pointer"' : '') + '>' +
        '<div class="fi i-acc">' + I('users') + '</div>' +
        '<div class="ft"><div class="t">' + contactDisplayName(ct) + star + '</div><div class="m">' + (sub || '') + '</div></div></div>';
      const acts = '<div class="dc-acts">' + chan + inflPill(influenceOf(ct)) +
        '<button class="tl-ic-btn" data-dcedit="' + d.id + ':' + i + '" title="Изменить роль и влияние">' + I('pencil') + '</button>' +
        (list.length > 1 ? '<button class="tl-ic-btn" data-dcdel="' + d.id + ':' + i + '" title="Убрать из сделки">' + I('x') + '</button>' : '') + '</div>';
      return '<div class="dc-row">' + main + acts + '</div>';
    }).join('');
    return '<div class="dc-list">' + rows + '</div>';
  }
  // Участники сделки так, как их читает Консьерж: имя, роль словом, влияние, канал, компания
  // и пометка основного. Одна форма для экрана и для модели — иначе они разойдутся.
  function dealParticipants(d) {
    return dealContacts(d).map((ct) => ({
      имя: contactDisplayName(ct), контакт: ct.clientId || null, роль: roleOf(ct),
      сторона: ({ client: 'клиент', other: 'другая сторона', broker: 'посредник' })[roleGroupOf(ct)],
      влияние: inflLabel(influenceOf(ct)), канал: partChannel(ct) || null,
      компания: ct.companyId || null, основной: !!ct.primary,
    }));
  }
  function openDealContactForm(dealId, index) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const list = dealContacts(d);
    const isNew = index == null || index < 0;
    const ct = isNew ? { role: 'Со-покупатель', influence: 'infl' } : (list[index] || {});
    const cur = roleOf(ct);
    // Группы в списке — не украшение: они говорят, чью сторону человек представляет,
    // а от этого зависит, может ли он быть основным контактом сделки.
    const roleSel = '<select id="dc_role">' + ROLE_GROUPS.map((g) => '<optgroup label="' + g.label + '">' +
      g.roles.map((r) => '<option' + (r === cur ? ' selected' : '') + '>' + r + '</option>').join('') + '</optgroup>').join('') + '</select>';
    const inf = influenceOf(ct);
    const rateSel = '<select id="dc_rate">' + INFLUENCE.map((v) => '<option value="' + v.k + '"' + (v.k === inf ? ' selected' : '') + '>' + v.label + '</option>').join('') + '</select>';
    const chSel = '<select id="dc_chan"><option value="">по контакту</option>' +
      CHANNELS.map((c) => '<option value="' + c + '"' + (c === ct.channel ? ' selected' : '') + '>' + chanMeta(c)[1] + '</option>').join('') + '</select>';
    const coSel = '<select id="dc_co"><option value="">—</option>' +
      (D().companies || []).map((c) => '<option value="' + c.id + '"' + (c.id === ct.companyId ? ' selected' : '') + '>' + escAttr(c.name) + '</option>').join('') + '</select>';
    const nameField = ct.clientId
      ? '<label class="fld"><span>Контакт</span><input type="text" value="' + contactDisplayName(ct).replace(/"/g, '&quot;') + '" disabled></label>'
      : '<label class="fld"><span>Имя</span><input id="dc_name" type="text" value="' + ((ct.name || '').replace(/"/g, '&quot;')) + '" placeholder="Напр.: Пётр Петров"></label>';
    const phoneField = ct.clientId ? '' : '<label class="fld"><span>Телефон</span><input id="dc_phone" type="text" value="' + ((ct.phone || '').replace(/"/g, '&quot;')) + '" placeholder="+971 …"></label>';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Участник сделки. Роль говорит, чью сторону он представляет; влияние — как он решает. Основным может быть только участник со стороны клиента: основной — тот, чьё решение мы ведём.</p>' +
      '<div class="match-grid">' + nameField +
      '<label class="fld"><span>Роль в сделке</span>' + roleSel + '</label>' +
      '<label class="fld"><span>Влияние на решение</span>' + rateSel + '</label>' +
      '<label class="fld"><span>Предпочитаемый канал</span>' + chSel + '</label>' +
      '<label class="fld"><span>От какой компании</span>' + coSel + '</label>' + phoneField + '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="dc_primary"' + (ct.primary ? ' checked' : '') + '> Основной контакт сделки</label>';
    openModal((isNew ? 'Добавить контакт' : 'Контакт · ' + contactDisplayName(ct)) + ' · ' + d.title, body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveDealContact" data-deal="' + dealId + '" data-idx="' + (isNew ? -1 : index) + '">' + I('check') + 'Сохранить</button>');
  }
  function saveDealContact(dealId, index) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    if (!Array.isArray(d.contacts)) d.contacts = dealContacts(d).slice();
    const isNew = index == null || index < 0;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const rec = isNew ? {} : (d.contacts[index] || {});
    rec.role = g('dc_role') || roleOf(rec);
    rec.influence = g('dc_rate') || influenceOf(rec);
    delete rec.rating;                                  // буквенная шкала уходит вместе с правкой
    rec.channel = g('dc_chan') || undefined;
    rec.companyId = g('dc_co') || undefined;
    if (!rec.clientId) { rec.name = g('dc_name') || rec.name || 'Без имени'; const ph = g('dc_phone'); if (ph) rec.phone = ph; }
    /* Основным может быть только участник со стороны клиента. Прежде код синхронизировал
       клиента сделки, лишь если у участника была ссылка на контакт, и молча оставлял
       в шапке прежнего: менеджер девелопера получал звёздочку, а сделка — чужое имя. */
    const wantsPrimary = !!(document.getElementById('dc_primary') || {}).checked;
    rec.primary = wantsPrimary && roleGroupOf(rec) === 'client';
    if (wantsPrimary && !rec.primary) WS.storeApi.toast('Основным может быть только участник со стороны клиента');
    if (isNew) d.contacts.push(rec);
    if (rec.primary) d.contacts.forEach((x) => { if (x !== rec) x.primary = false; });
    if (!d.contacts.some((x) => x.primary)) {
      const back = d.contacts.find((x) => roleGroupOf(x) === 'client');
      if (back) back.primary = true;                    // сделка без основного контакта не бывает
    }
    const prim = d.contacts.find((x) => x.primary) || d.contacts[0];
    if (prim && prim.clientId) d.clientId = prim.clientId; // keep the deal's primary client in sync
    // Правка участника пережила только перерисовку карточки: без save() она исчезала на F5.
    WS.storeApi.save();
    WS.storeApi.toast(isNew ? 'Контакт добавлен к сделке' : 'Контакт обновлён', 'ok');
    dealCard(dealId);
  }
  function removeDealContact(dealId, index) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    if (!Array.isArray(d.contacts)) d.contacts = dealContacts(d).slice();
    if (d.contacts.length <= 1) { WS.storeApi.toast('Нельзя убрать единственный контакт'); return; }
    const removed = d.contacts.splice(index, 1)[0];
    // Замена основного ищется среди стороны клиента, а не берётся первой попавшейся строкой:
    // иначе после открепления покупателя основным становится юрист застройщика.
    if (removed && removed.primary && d.contacts.length) {
      const back = d.contacts.find((x) => roleGroupOf(x) === 'client') || d.contacts[0];
      back.primary = true;
    }
    const prim = d.contacts.find((x) => x.primary) || d.contacts[0];
    if (prim && prim.clientId) d.clientId = prim.clientId;
    WS.storeApi.save();
    WS.storeApi.toast('Контакт убран из сделки');
    dealCard(dealId);
  }
  // Deal card = the DEAL (not the contact). Contacts are one click away.
  // ---- Deal card v2: tabbed shell + funnel-aware stage stepper + context Concierge ----
  // Шаг регистрации называется по своему реестру: у оффплана Oqood, у вторички Title Deed,
  // у аренды Ejari. Общее «Регистрация» не говорит агенту, куда именно он идёт и с чем.
  function stepLabelFor(d, k) {
    if (k !== 'reg') return stageLabel(k);
    const ck = WS.contractKindFor;
    return (WS.REG_LABELS || {})[ck ? ck((d && d.funnel) || 'sale', d && d.readiness) : ''] || stageLabel(k);
  }
  function funnelSteps(d) {
    const f = funnelOf(d);
    const order = funnelPath(d);
    const idx = Math.max(0, order.indexOf(d.stage));
    return { cols: order.map((k) => stepLabelFor(d, k)), idx: idx, order: order, label: f.label || stageLabel(d.stage), lost: d.stage === 'lost' };
  }
  function dealStepper(d) {
    const s = funnelSteps(d);
    // A lost deal has no current step on the path — showing one would claim progress it does not
    // have. The route is drawn as history, and the exit is stated once, plainly.
    const steps = s.cols.map((c, i) => {
      const cls = s.lost ? 'todo' : (i < s.idx ? 'done' : (i === s.idx ? 'cur' : 'todo'));
      const inner = (!s.lost && i < s.idx) ? I('check') : String(i + 1);
      return '<button class="dx-step ' + cls + '" data-dealstage="' + d.id + '" data-stage="' + s.order[i] + '"><span class="d">' + inner + '</span><span class="l">' + c + '</span></button>';
    }).join('');
    const lostChip = s.lost ? '<div class="dx-lost">' + I('x') + 'Сделка проиграна</div>' : '';
    return '<div class="dx-stepper' + (s.cols.length > 7 ? ' long' : '') + '">' + steps + '</div>' + lostChip;
  }
  // ============================================================================================
  // Сквозной путь сделки — то, ради чего затевалась перекладка карточки.
  //
  // Партнёр читает работу как одну линию от первого контакта до подписания и не понимает, почему
  // она разорвана на два раздела. Мы читаем её как две сущности, потому что посреди жизни меняется
  // кратность: до перехода запись связана с N объектами подборки, после — с одним договором.
  //
  // Оба правы, и это решается не спором, а рисунком: на экране одна линия, в данных две таблицы.
  // Пресейл идёт ПРОЙДЕННЫМ узлом ленты — он неинтерактивен, потому что стадия запроса
  // вычисляется из фактов, а не выставляется рукой; шаги договора кликабельны, как и были.
  // Граница «условия согласованы» больше не отдельный элемент со своим шрифтом и своей
  // пунктирной вертикалью: она названа словами в строке под лентой, вместе с датой перехода
  // и сроком на текущем шаге. Один язык на всю ленту — тот же, что у заявки.
  // ============================================================================================
  function dealThroughPath(d) {
    const r = d.requestId ? requestById(d.requestId) : null;
    const pre = r ? ['new', 'qual', 'offer', 'meet', 'talks'].map((k) => reqStageLabel(k, r)) : [];
    const s = funnelSteps(d);
    const own = s.cols.map((c, i) => {
      const cls = s.lost ? 'todo' : (i < s.idx ? 'done' : (i === s.idx ? 'cur' : 'todo'));
      const inner = (!s.lost && i < s.idx) ? I('check') : String(i + 1);
      return '<button class="dx-step ' + cls + '" data-dealstage="' + d.id + '" data-stage="' + s.order[i] + '">' +
        '<span class="d">' + inner + '</span><span class="l">' + c + '</span></button>';
    }).join('');
    // Пройденный пресейл — ОДНА плашка, а не пять шагов, и на любой ширине. Пятью шагами лента
    // становилась одиннадцатью элементами в горизонтальной прокрутке: шаги договора, ради которых
    // карточку открывают, сжимались до 62 пикселей и подписи в 10.5. Суть сохранена — участок
    // виден пройденным, граница нарисована, стадии запроса перечислены в подсказке.
    const preSum = pre.length ? '<span class="dx-step done dx-pre" title="' + escAttr('Пресейл: ' + pre.join(' → ')) + '">' +
      '<span class="d">' + I('check') + '</span><span class="l">Пресейл · ' + pre.length + '</span></span>' : '';
    const lost = s.lost ? '<div class="dx-lost">' + I('x') + 'Сделка проиграна</div>' : '';
    return '<div class="dx-path' + (s.cols.length > 7 ? ' long' : '') + '">' + preSum + own + '</div>' + lost;
  }
  // Строка под лентой — то, что раньше висело справа своим шрифтом и своей вертикалью: где
  // проходит граница пресейла, когда запрос стал сделкой и сколько сделка стоит на текущем шаге.
  function dealPathWhy(d) {
    const out = [];
    // Дата конверсии, когда она записана, главнее даты создания: «стала сделкой» — это
    // момент согласования условий, а не момент заведения карточки.
    const when = d.convertedAt || d.createdAt;
    const ago = createdAgoLabel(d);
    if (d.requestId) {
      out.push('Пресейл прошёл в запросе; здесь условия согласованы' +
        (when ? ' — запрос стал сделкой ' + when + (ago ? ' (' + ago + ')' : '') : '') + '.');
    } else if (when) {
      out.push('Сделка заведена ' + when + (ago ? ' (' + ago + ')' : '') + '.');
    }
    if (d.stageDays != null) {
      out.push('На текущем шаге ' + d.stageDays + ' ' + plural(d.stageDays, 'день', 'дня', 'дней') + '.');
    }
    out.push('Шаги договора нажимаются — отметьте, куда сделка перешла.');
    return out.join(' ');
  }
  // Та же секция, что у заявки: лента в карточке, под ней одна поясняющая строка. Ради этого
  // и переделывалось — партнёр читает две карточки одной работы и видит два разных экрана.
  function dealPathSection(d) {
    return '<div class="dx-sec dx-sec-bare">' + dealThroughPath(d) +
      '<div class="req-stage-why">' + I('sparkle') + '<span>' + dealPathWhy(d) + '</span></div></div>';
  }
  function dealConcierge(d) {
    return '<div class="dx-cbar-lbl">' + I('sparkle') + 'Консьерж знает контекст этой сделки</div>' +
      '<div class="dx-cbar" data-thread="deal:' + d.id + '" data-tlabel="' + escAttr(d.title) + '" data-ticon="briefcase">' +
      '<div class="w">W</div><div class="ph">Поручите Консьержу по сделке — «собрать КП», «что просрочено», «бриф к звонку»…</div>' +
      '<div class="send">' + I('arrowRight') + '</div></div>';
  }
  function pickerField(id, label, optionsHtml, placeholder, cls) {
    const n = (optionsHtml.match(/<option/g) || []).length;
    // A listbox with rows does not auto-select its first option the way a collapsed select does,
    // so without this the form submits with no client and no object at all.
    const withSel = /selected/.test(optionsHtml) ? optionsHtml : optionsHtml.replace('<option', '<option selected', 1);
    return '<label class="fld fld-pick' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' +
      '<input class="pick-q" type="search" data-pick="' + id + '" placeholder="' + escAttr(placeholder || 'Начните вводить название…') + '" autocomplete="off">' +
      '<select id="' + id + '" size="' + Math.min(6, Math.max(3, n)) + '">' + withSel + '</select>' +
      '<span class="pick-n" id="' + id + '_n">' + n + ' ' + plural(n, 'запись', 'записи', 'записей') + '</span></label>';
  }
  // Rows of a card body. A string is a full-width row; a two-element array is a facing pair that
  // degrades to full width when one half is missing.
  function cxCol(blocks) {
    const html = (blocks || []).filter(Boolean).join('');
    return html ? '<div class="cx-col">' + html + '</div>' : '';
  }
  function cxStack(rows) {
    const html = (rows || []).map((r) => {
      if (!r) return '';
      if (typeof r === 'string') return r.trim() ? '<div class="cx-row">' + r + '</div>' : '';
      const a = (r[0] || '').trim(), b = (r[1] || '').trim();
      if (!a && !b) return '';
      if (!a || !b) return '<div class="cx-row">' + (a || b) + '</div>';
      return '<div class="cx-row cx-pair">' + a + b + '</div>';
    }).join('');
    return '<div class="cx-stack">' + html + '</div>';
  }
  /* `mode === 'icons'` — тот же ряд, но значками: он встаёт в свободную правую половину
     обложки и не занимает собственной полосы во всю ширину. Слово при этом остаётся в
     разметке — и в подсказке при наведении, и для экранного диктора; прячет его CSS, а не
     эта функция. Кнопка, у которой слова нет вовсе, не опознаётся ни человеком, ни проверкой. */
  function entityActionBar(items, mode) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    const icons = mode === 'icons';
    const lbl = (a) => icons ? ' title="' + escAttr(a[1]) + '" aria-label="' + escAttr(a[1]) + '"' : '';
    const act = (a, cls) => '<button class="qa-act' + cls + '" ' + a[2] + lbl(a) + '>' +
      I(a[0]) + '<span>' + a[1] + '</span></button>';
    const open = '<div class="qa-bar' + (icons ? ' qa-icons' : '') + '" role="group" aria-label="Действия">';
    const primary = list.filter((a) => a[3] === 'primary');
    const secondary = list.filter((a) => a[3] === 'secondary');
    const other = list.filter((a) => a[3] !== 'primary' && a[3] !== 'secondary');
    // If no primary/secondary specified, show all flat (backward compat for contract, etc.).
    if (primary.length === 0 && secondary.length === 0) {
      return open + list.map((a) => act(a, a[3] ? ' ' + a[3] : '')).join('') + '</div>';
    }
    // Primary/secondary specified: show primary + non-classified in bar, secondary in dropdown
    let html = open +
      primary.map((a) => act(a, ' primary')).join('') +
      other.map((a) => act(a, a[3] ? ' ' + a[3] : '')).join('');
    if (secondary.length) {
      html += '<div class="qa-more"><button class="qa-act secondary" data-act="toggleQaMore"' +
        (icons ? ' title="Ещё действия" aria-label="Ещё действия"' : '') + '>' +
        I('menu') + '<span>Ещё</span></button><div class="qa-more-menu">' +
        secondary.map((a) => '<button class="qa-more-item" ' + a[2] + '>' +
          I(a[0]) + '<span>' + a[1] + '</span></button>').join('') +
        '</div></div>';
    }
    html += '</div>';
    return html;
  }
  function dxSec(icon, title, rightHtml, inner) {
    return '<div class="dx-sec"><div class="dx-sec-h"><span class="ic">' + I(icon) + '</span>' + title +
      (rightHtml ? '<span class="r">' + rightHtml + '</span>' : '') + '</div>' + inner + '</div>';
  }
  // ---- Universal entity-card shell: ONE component for deal / object / contact / company ----
  function cardTab(type, id, tabs) {
    const def = tabs[0][0];
    WS.store.cardTabs = WS.store.cardTabs || {};
    WS.store.cardOpen = WS.store.cardOpen || {};
    const key = type + ':' + id;
    if (WS.store.cardOpen[type] !== key) { WS.store.cardOpen[type] = key; WS.store.cardTabs[type] = def; }
    const cur = WS.store.cardTabs[type] || def;
    // Состав вкладок у сделки зависит от стадии: запомненная вкладка может исчезнуть, пока
    // карточка открыта, и тогда экран остался бы пустым, а не вернулся к первой.
    return tabs.some((t) => t[0] === cur) ? cur : def;
  }
  function statusChip(items) {
    return '<div class="prov dx-statusbar">' + items.map((it) =>
      '<span class="badge ' + (it.tone || '') + '">' + (it.icon ? I(it.icon) : '') + it.label + '</span>').join('') + '</div>';
  }
  function entityConcierge(ph, thread, tlabel, ticon) {
    return '<div class="dx-cbar-lbl">' + I('sparkle') + 'Консьерж знает контекст</div>' +
      '<div class="dx-cbar" data-thread="' + thread + '" data-tlabel="' + tlabel + '" data-ticon="' + ticon + '">' +
      '<div class="w">W</div><div class="ph">' + ph + '</div><div class="send">' + I('arrowRight') + '</div></div>';
  }
  // Shared tabbed body — rendered either inside a modal (entityCard) or a full-page view (entityPage).
  function entityBody(spec) {
    const tab = cardTab(spec.type, spec.id, spec.tabs);
    const tabBar = '<div class="dx-tabs">' + spec.tabs.map((t) =>
      '<button class="dx-tab' + (t[0] === tab ? ' on' : '') + '" data-etab="' + spec.type + '~' + spec.id + '~' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    // Key the spec by type so a task/company MODAL opened over a deal/client PAGE doesn't clobber
    // the page's tabs (both render an .dx-tabbody). setEntityTab resolves spec by the clicked tab's type.
    WS._cardByType = WS._cardByType || {};
    WS._cardByType[spec.type] = spec;
    WS._card = spec;
    return (spec.hero || spec.status || '') + (spec.acts || '') + (spec.state || '') + tabBar +
      '<div class="dx-tabbody" id="dxTabBody">' + spec.render(tab) + '</div>' +
      (spec.concierge ? '<div class="dx-concierge">' + spec.concierge + '</div>' : '');
  }
  function entityCard(spec) {
    openModal(spec.title, entityBody(spec), spec.footer, { wide: true, flexBody: true });
  }
  // What to call a screen in a «назад» button. Names beat screen types: «Назад · Анна Петрова»
  // tells you what you will see; «Назад к клиентам» is where the code came from, not the user.
  function routeName(r) {
    if (!r) return '';
    const short = (t) => { t = String(t || ''); return t.length > 30 ? t.slice(0, 29).trim() + '…' : t; };
    const by = (arr, id) => (arr || []).find((x) => x.id === id) || null;
    let x = null;
    switch (r.view) {
      case 'dealDetail': x = by(D().deals, r.id); return short(x ? x.title : 'сделка');
      case 'clientDetail': x = by(D().clients, r.id); return short(x ? x.name : 'клиент');
      case 'objectDetail': x = by(D().objects, r.id); return short(x ? x.name : 'объект');
      case 'companyDetail': x = by(D().companies, r.id); return short(x ? x.name : 'компания');
      case 'requestDetail': x = by(D().requests, r.id); return short(x ? x.title : 'запрос');
      case 'contractDetail': x = by(D().contracts, r.id); return short(x ? 'договор ' + x.number : 'договор');
      case 'clients': return r.tab === 'contacts' ? 'Контакты' : 'Сделки';
      default: break;
    }
    const nav = NAV.concat(NAV_MORE, NAV_MGR, NAV_MGR_MORE).find((n) => n.id === r.view);
    return nav ? nav.label : r.view;
  }
  // The back button of any card: the previous screen when there is one, the owning list otherwise.
  function backBtn(fallbackNav, fallbackTab, fallbackLabel) {
    const prev = WS.router && WS.router.peek ? WS.router.peek() : null;
    if (!prev) return '<button class="btn sm" data-nav="' + fallbackNav + '" data-tab="' + (fallbackTab || '') + '">' + I('chevLeft') + fallbackLabel + '</button>';
    return '<button class="btn sm" data-act="navBack" title="Назад (Alt+←)">' + I('chevLeft') + 'Назад · ' + escAttr(routeName(prev)) + '</button>';
  }
  /* Возврат и путь одной мелкой строкой — внутри обложки, а не двумя полосами над карточкой.
     Полоса «Назад · Сделки» и полоса «К запросу · Анна Петрова» занимали по 46 пикселей высоты
     каждая и несли по одному слову. Строка несёт те же слова и стоит над названием сделки,
     в обложке, где до этого пустовало место. Кнопка та же и по разметке: `data-act="navBack"`
     и `data-nav` читаются теми же обработчиками — путь назад не изменился, изменился его вид. */
  function backLink(fallbackNav, fallbackTab, fallbackLabel) {
    const prev = WS.router && WS.router.peek ? WS.router.peek() : null;
    if (!prev) return '<button class="dcard-back" data-nav="' + fallbackNav + '" data-tab="' + (fallbackTab || '') + '">' +
      I('chevLeft') + escAttr(fallbackLabel) + '</button>';
    return '<button class="dcard-back" data-act="navBack" title="Назад (Alt+←)">' +
      I('chevLeft') + 'Назад · ' + escAttr(routeName(prev)) + '</button>';
  }
  // Путь к родительской заявке — звено той же строки, а не отдельная полоса над карточкой.
  function parentReqLink(r) {
    if (!r) return '';
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    return '<button class="dcard-back" data-request="' + r.id + '">' + I('chevLeft') +
      'К запросу · ' + escAttr(c.name || r.title) + '</button>';
  }
  function cardNavRow(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="dcard-navrow">' + list.join('<span class="dcard-navsep">·</span>') + '</div>';
  }
  // Full-page entity view. The header is the way back and nothing else: the verbs live in the
  // action bar inside entityBody, which is the one place a card keeps them.
  function entityPage(spec, backNav, backTab, backLabel) {
    return '<div class="obj-page-head">' + backBtn(backNav, backTab, backLabel) + '</div>' + entityBody(spec);
  }
  function setEntityTab(type, id, tab, srcEl) {
    WS.store.cardTabs = WS.store.cardTabs || {};
    WS.store.cardTabs[type] = tab;
    const spec = (WS._cardByType && WS._cardByType[type]) || WS._card;
    if (!spec || spec.type !== type || String(spec.id) !== String(id)) return;
    // Scope to the container of the clicked tab: modal overlay when in a pop-up, else the page (#main).
    const scope = srcEl ? (srcEl.closest('#modal') || document.getElementById('main') || document) : document;
    const el = scope.querySelector('.dx-tabbody');
    // swap content, then re-trigger a quick fade so the tab change reads as a state change
    if (el) { el.innerHTML = spec.render(tab); el.classList.remove('tab-anim'); void el.offsetWidth; el.classList.add('tab-anim'); }
    scope.querySelectorAll('.dx-tab').forEach((bt) => bt.classList.toggle('on', bt.getAttribute('data-etab') === type + '~' + id + '~' + tab));
  }
  function dfPair(k, v) { return '<div class="dfield"><div class="dk">' + k + '</div><div class="dv">' + (v || '—') + '</div></div>'; }
  // Tab content — every tab wrapped in the same dx-sec card treatment for consistent hierarchy.
  function dealTabContent(d, tab) {
    // Подбор — предложения по объектам и их сравнение. Сами объекты сделки остались над
    // вкладками: это предмет сделки, а не подробность о ней.
    if (tab === 'offers') {
      const off = dealOffersBlock(d);
      return off || dxSec('layers', 'Подбор', '',
        '<div style="font-size:12.5px;color:var(--mut)">Предложений по этой сделке ещё нет. Объекты сделки — выше, над вкладками.</div>');
    }
    if (tab === 'contacts') {
      const addBtn = '<button class="btn xs" data-act="addDealContact" data-deal="' + d.id + '">' + I('plus') + 'Добавить</button>';
      const hint = '<div style="font-size:11px;color:var(--faint);margin-top:8px">Рейтинг A/B/C — влияние контакта на решение. Основной помечен звездой.</div>';
      return dxSec('users', 'Участники сделки · ' + dealContacts(d).length, addBtn, dealContactsInner(d) + hint);
    }
    if (tab === 'docs') {
      const kpN = dealKpObjects(d).length;
      const kpBtn = kpN ? '<button class="btn xs" data-act="openDealKp" data-deal="' + d.id + '">' + I('doc') + 'КП сделки · ' + kpN + '</button>' : '';
      return cxStack([
        gatesBlock(d),
        kpN ? dxSec('doc', 'Коммерческое предложение', kpBtn, '<div class="gate-foot" style="margin-top:0">Собрано по ' + kpN + ' ' + plural(kpN, 'объекту', 'объектам', 'объектам') + '.</div>') : '',
        dxSec('doc', 'Документы сделки', '', docsRows(docsOfDeal(d), 'по этой сделке документов пока нет')),
      ]);
    }
    if (tab === 'history') return dealHistoryTab(d);
    if (tab === 'tasks') {
      const list = tasksOfDeal(d);
      const rows = list.map(taskRow).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">задач по этой сделке пока нет</div>';
      return dxSec('check', 'Задачи сделки · ' + list.length, '<button class="btn xs" data-act="newTask">' + I('plus') + 'Задача</button>', rows);
    }
    // params (default) — deal-specific structural fields (key terms are already up in «Ключевое»),
    // the parent заявка, plus data conflicts / partner handoff (was the near-empty «Обзор» tab).
    const req = dealRequestBlock(d);
    const kk = contractsOfDeal(d.id);
    const kblock = kk.length ? dxSec('doc', 'Договор по сделке', '', kk.map(contractRow).join('') +
      '<div class="gate-foot">Сделка закрыта на подписании. Всё, что идёт дальше — платежи, регистрация, продления — ведётся договором.</div>') : '';
    const cf = conflictBlock(d);
    const ho = d.partnerAgent ? handoffBlock(d) : '';
    return cxStack([
      req,
      kblock,
      dxSec('briefcase', 'Параметры сделки', '<button class="btn xs" data-act="editDeal" data-deal="' + d.id + '">' + I('pencil') + 'Изменить</button>', '<div class="dfields cols2">' + dealParamsExtra(d) + '</div>'),
      cf,
      ho,
    ]);
  }
  // Hero sections reuse the object-hero family (variant B: photo backdrop + dark scrim) at the top of
  // entity cards — client (name overlaid), deal (linked object), КП (flagship object).
  function clientHero(c) {
    const bg = (WS.photos && WS.photos.o_interior) || '';
    const k = kycOf(c);
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const kycIcon = k.st === 'ok' ? 'check' : (k.st === 'stop' ? 'lock' : 'clock');
    const cm = chanMeta(prefChannel(c));
    const since = clientSince(c);
    const nDeals = (D().deals || []).filter((x) => x.clientId === c.id).length;
    const rel = relStageOf(c);
    const facts = [
      // Стадия отношений стоит первой: она отвечает на «что у нас с этим человеком вообще»,
      // а всё остальное в обложке — подробности.
      ['users', relLabel(rel.k) + (clientHasWon(c.id) ? ' · был успех' : '')],
      since ? ['calendar', 'в работе с ' + since.at] : null,
      nDeals ? ['briefcase', nDeals + ' ' + plural(nDeals, 'сделка', 'сделки', 'сделок')] : null,
      [kycIcon, k.label],
      [cm[0], cm[1]],
    ].filter(Boolean);
    const factsHtml = '<div class="chero-facts">' + facts.map((f) => '<div class="chero-fact"><span class="chero-fact-icon">' + I(f[0]) + '</span><span>' + f[1] + '</span></div>').join('') + '</div>';
    return '<div class="chero">' + (bg ? '<img class="chero-img" src="' + bg + '" alt="">' : '') +
      '<div class="chero-scrim"></div>' +
      '<div class="chero-content"><div class="chero-avatar">' + init + '</div>' +
      '<div class="chero-info"><h1 class="chero-name">' + c.name + '</h1>' + factsHtml + '</div></div></div>';
  }
  // ---- Deal header v2: the DEAL reads first — a plain-language sentence, the client (callable),
  // and a "now" summary. The object is demoted to a compact card in the overview (dealLotsBlock).
  function dealActionWord(d) {
    return ({ sale: 'Покупка', rent: 'Аренда', manage: 'Управление', exclusive: 'Эксклюзив',
      cross: 'Партнёрская услуга', consult: 'Консалтинг' })[d.funnel] || 'Сделка';
  }
  // A deal may hold several lots under one contract (Part B). Falls back to the single object.
  function dealLots(d) {
    const ids = (Array.isArray(d.lots) && d.lots.length) ? d.lots : (d.objectId ? [d.objectId] : []);
    return ids.map((id) => D().objects.find((o) => o.id === id)).filter(Boolean);
  }
  function dealLotsLabel(d) {
    const lots = dealLots(d);
    // On an owner-side service the object is the client's own asset and never comes out of our
    // inventory, so «объект не выбран» reported a gap that does not exist.
    if (!lots.length) return (d.funnel === 'manage' || d.funnel === 'exclusive') ? 'объект клиента' : 'объект не выбран';
    if (lots.length === 1) return lots[0].name;
    return lots.length + ' лота · ' + lots[0].name.split(',')[0] + ' +' + (lots.length - 1);
  }
  // Small hero — same photo-backdrop family as the client/object heroes (.chero/.ohero),
  // but compact. Client-first: avatar + name over the object photo, deal formulation below.
  function dealHero(d) {
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const o0 = dealLots(d)[0];
    const bg = (o0 && WS.photos && WS.photos[o0.id]) || (WS.photos && WS.photos.o_interior) || '';
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const sub = [dealActionWord(d) + ' · ' + dealLotsLabel(d), d.amount ? WS.AED(d.amount) : null].filter(Boolean).join(' · ');
    return '<div class="dhero">' + (bg ? '<img class="dhero-img" src="' + bg + '" alt="">' : '') +
      '<div class="dhero-scrim"></div>' +
      '<div class="dhero-content"><div class="dhero-av">' + init + '</div>' +
      '<div class="dhero-info"><div class="dhero-name">' + (c.name || 'Без клиента') + '</div>' +
      '<div class="dhero-sub">' + sub + '</div></div></div></div>';
  }
  // The deal's essence, editable in place: one tab stop, a real textbox role, and a label that
  // says what the line is — a bare bold sentence under the hero reads as decoration, not a field.
  function dealTitleEdit(d) {
    // NOT data-deal: the delegated click handler navigates on that attribute, so clicking into the
    // field re-opened the card, re-rendered it and took the focus away mid-keystroke.
    return '<div class="deal-title-edit" data-titledeal="' + d.id + '">' +
      '<span class="deal-title-lbl">' + I('pencil') + 'Суть сделки</span>' +
      '<span class="deal-title-text" contenteditable="true" role="textbox" aria-label="Суть сделки — нажмите, чтобы изменить" ' +
      'title="Кликните, чтобы изменить. Enter — сохранить, Esc — отменить">' + escAttr(d.title || 'Сделка') + '</span></div>';
  }
  // Подпись под именем в блоке связи. Ровно то, чего нет на странице, где этот блок стоит:
  // на каком языке говорить, каким каналом и когда с человеком связывались в последний раз.
  // Условия и стадия сюда не попадают — они и есть содержание самой страницы.
  function contactMeta(c) {
    const last = lastTouchOf(c.id);
    return [c.lang ? 'язык ' + c.lang : '', chanMeta(prefChannel(c))[1],
      last ? 'последнее касание — ' + last : ''].filter(Boolean).join(' · ');
  }
  // Последнее касание по всем лентам клиента — заявкам, сделкам и его собственной.
  function lastTouchOf(cid) {
    let best = null;
    const take = (list) => (list || []).forEach((e) => {
      if (e && e.ord != null && (!best || e.ord > best.ord)) best = e;
    });
    take((D().contactTimeline || {})[cid]);
    (D().requests || []).filter((r) => r.clientId === cid).forEach((r) => take((D().requestTimeline || {})[r.id]));
    (D().deals || []).filter((d) => d.clientId === cid).forEach((d) => take((D().dealTimeline || {})[d.id]));
    return best ? String(best.at || '').split('·')[0].trim() : '';
  }
  // Client card (left of the facing pair) — call / write without hunting the contact card.
  function dealClientCard(d, threadId) {
    const c = D().clients.find((x) => x.id === d.clientId);
    if (!c) return dxSec('users', 'Клиент · связь', '', '<div style="font-size:12px;color:var(--faint);padding:4px 0">клиент не привязан к сделке</div>');
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const vals = clientContactVals(c);
    const head = '<div class="dcli-head"><div class="dcli-av">' + init + '</div>' +
      '<div class="dcli-body"><div class="dcli-name" data-client="' + c.id + '" style="cursor:pointer">' + c.name + '</div>' +
      '<div class="dcli-meta">' + contactMeta(c) + '</div></div></div>';
    const chans = '<div class="dcli-chans">' + ['phone', 'whatsapp', 'telegram', 'email'].map((ch) =>
      '<span class="dcli-ch">' + I(chanMeta(ch)[0]) + '<span>' + (vals[ch] || '—') + '</span></span>').join('') + '</div>';
    const acts = '<div class="dcli-acts">' +
      '<button class="btn sm primary" data-act="callClient" data-cid="' + c.id + '">' + I('phone') + 'Позвонить</button>' +
      '<button class="btn sm" data-thread="' + (threadId || ('deal:' + d.id)) + '" data-tlabel="' + escAttr(c.name) + '" data-ticon="users">' + I('whatsapp') + 'Написать</button></div>';
    return dxSec('users', 'Клиент · связь', '', head + chans + acts);
  }
  // ---- Shared "now" cards (deal + request use the SAME treatment so related process cards don't
  // diverge). The old flat grey "Что сейчас" block is split into distinct titled surface cards with
  // an emphasized action — so it reads as hierarchy, not one grey area of same-size text. ----
  // "Следующий шаг" callout: owner + due sit in the header, the action itself is emphasized.
  // Карточка «Запланировано» с выделенным первым делом. Ближайший шаг — не отдельная секция,
  // а верхняя строка того же списка: две карточки об одном и том же и были тем дублем, из-за
  // которого на сделке подряд стояли «Следующий шаг» и «Запланировано».
  function plannedCard(next, rowsHtml) {
    const n = next || {};
    const head = n.action ? '<div class="plev-next' + (n.over ? ' over' : '') + '">' +
      '<div class="pn-h"><span class="pn-tag">' + I('target') + 'следующий шаг</span>' +
      (n.due ? '<span class="pn-due' + (n.over ? ' over' : '') + '">' + I('clock') + n.due + '</span>' : '') +
      (n.owner ? '<span class="pn-owner">' + I('users') + n.owner + '</span>' : '') + '</div>' +
      '<div class="pn-act">' + n.action + '</div>' +
      (n.why ? '<div class="pn-why">' + n.why + '</div>' : '') + '</div>' : '';
    if (!head && !rowsHtml) return '';
    return dxSec('clock', 'Запланировано', '', '<div class="plev-list">' + head + (rowsHtml || '') + '</div>');
  }
  function nowEvLine(p) {
    return '<div class="dnb-ev"><span class="dnb-ev-dot">' + I('dot') + '</span>' +
      '<div class="dnb-ev-b"><div class="dnb-ev-t">' + p.e.text + '</div>' +
      '<div class="dnb-ev-m">' + p.e.at + ' · ' + p.e.by + '</div></div></div>';
  }
  // "Последние события" card: the few most-recent events that fit, then a jump to the full history.
  /* «Вся история» раскрывается ЗДЕСЬ ЖЕ, в правой части карточки, а не переключает вкладку в
     самом низу: у вкладки внизу и у карточки сверху разные глаза, и, нажав «вся история», агент
     терял из виду то, ради чего её открыл. Правая часть — единственное место карточки, которое
     меняется: в неё же выезжает разговор с Консьержем. */
  function recentEventsCard(tl, moreEtab, limit) {
    const evs = feedSortDesc((tl || []).map((e, i) => ({ e: e, i: i }))).slice(0, limit || 4).map(nowEvLine).join('') ||
      '<div class="dnb-ev-empty">событий пока нет</div>';
    const more = '<button class="btn xs" data-rightpane="history">' + I('arrowRight') + 'вся история</button>';
    return dxSec('clock', 'Последние события', more, '<div class="dnb-hist">' + evs + '</div>');
  }
  // Правая часть в режиме истории: заголовок с возвратом и лента со своей прокруткой.
  function rightHistoryPane(inner, backLabel) {
    const back = '<button class="btn sm" data-rightpane="off">' + I('chevLeft') + backLabel + '</button>';
    return dxSec('clock', 'Вся история', back, '<div class="rp-scroll">' + inner + '</div>');
  }
  // Status/context chips lifted out of the old grey block to sit right under the «Сейчас» line.
  // What an agent opens a deal to do. Ordered by how often it is the reason for opening it.
  function dealActions(d) {
    // Primary row: the three most-frequent actions. All others behind «Ещё».
    // Чат по сделке is removed — the composer line at the bottom is the same entrance.
    // Открыть контакт is removed — the client's name in the left column is already clickable.
    return [
      ['doc', 'Собрать КП', 'data-act="openDealKp" data-deal="' + d.id + '"', 'primary'],
      ['calendar', 'Назначить показ', 'data-act="addEvent" data-scope="deal" data-deal="' + d.id + '"', 'primary'],
      ['pencil', 'Записать событие', 'data-act="addEvent" data-scope="deal" data-deal="' + d.id + '"', 'primary'],
      ['clock', 'Поставить задачу', 'data-act="newTask"', 'secondary'],
      ['gear', 'Параметры сделки', 'data-act="editDeal" data-deal="' + d.id + '"', 'secondary'],
      // Завершение — отдельное действие с двумя исходами, а не «поставить последний шаг»:
      // успех означает полученное вознаграждение, а не подписанный договор.
      dealClosed(d) ? null : ['check', 'Завершить сделку', 'data-act="finishDeal" data-deal="' + d.id + '"', 'secondary'],
      dealClosed(d) ? null : ['handshake', 'Передать сделку', 'data-act="transferDeal" data-deal="' + d.id + '"', 'secondary'],
      dealClosed(d) ? null : ['users', 'Привлечь партнёра', 'data-act="partnerDeal" data-deal="' + d.id + '"', 'secondary'],
      ['layers', 'Дубль условий', 'data-act="duplicateDeal" data-deal="' + d.id + '"', 'secondary'],
      // Удаления нет намеренно: удалённая сделка уносит основание комиссии. Архив убирает из
      // работы и возвращается одним нажатием.
      dealArchived(d)
        ? ['replay', 'Вернуть из архива', 'data-act="unarchiveDeal" data-deal="' + d.id + '"', 'secondary']
        : ['lock', 'В архив', 'data-act="archiveDeal" data-deal="' + d.id + '"', 'secondary'],
    ];
  }
  /* ---- Архив вместо удаления, и дубль сделки (§3.5 разбора, пункт 31) ------------------------
     Партнёр просил «удалить сделку». Удаления не будет: система обещает прослеживаемость, а
     ошибочно удалённая сделка уносит с собой события, документы и основание комиссии — то есть
     ровно то, чем потом доказывают, что вознаграждение заработано. Архив закрывает его задачу
     («убрать с глаз ошибочно заведённое») и не закрывает историю: запись остаётся, помечена,
     из работы уходит, и её можно вернуть.

     Архив — не стадия. Стадия отвечает «где сделка в процессе», архив — «участвует ли она в
     работе вообще». Заведённая по ошибке сделка не «проиграна»: проигрыш это исход переговоров,
     и смешав их, мы испортили бы конверсию, которую сами же и считаем. */
  function dealArchived(d) { return !!d && !!d.archived; }
  function archiveDeal(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return false;
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Сделка уйдёт из работы: с доски, из списка, из воронки и из сумм. История, документы и события останутся — вернуть можно в любой момент. Удаления в системе нет намеренно: удалённая сделка уносит с собой основание комиссии.</p>' +
      '<label class="fld wide"><span>Почему в архив</span><input id="ar_why" type="text" placeholder="Напр.: заведена по ошибке, дубль"></label>';
    openModal('В архив · ' + escAttr(d.title || d.id), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="saveArchive" data-deal="' + dealId + '">' + I('check') + 'В архив</button>');
    return true;
  }
  function saveArchive(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const el = document.getElementById('ar_why');
    const why = el ? el.value.trim() : '';
    d.archived = true;
    d.archivedWhy = why || undefined;
    addEventEntry('deal', dealId, { type: 'note', text: 'Сделка убрана в архив' + (why ? ': ' + why : '') + '. История сохранена.' });
    WS.storeApi.touch(); closeModal();
    WS.storeApi.toast('В архиве — из работы убрана, история цела', 'ok');
    dealCard(dealId);
  }
  function unarchiveDeal(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    d.archived = false; delete d.archivedWhy;
    addEventEntry('deal', dealId, { type: 'note', text: 'Сделка возвращена из архива в работу.' });
    WS.storeApi.touch();
    WS.storeApi.toast('Возвращена в работу', 'ok');
    dealCard(dealId);
  }
  /* Дубль — это НЕ копия записи. Копируются условия и участники, то есть то, что переспрашивать
     у клиента заново глупо; история, документы, задачи, предложения и деньги не копируются —
     они принадлежат той сделке, в которой произошли. Скопировав их, мы получили бы вторую запись
     о тех же событиях и удвоили бы пайплайн. */
  function duplicateDeal(dealId) {
    const src = D().deals.find((x) => x.id === dealId); if (!src) return null;
    const id = 'd_copy_' + nextCopySeq();
    const copy = {
      id: id, clientId: src.clientId, requestId: src.requestId,
      title: (src.title || 'Сделка') + ' · копия',
      funnel: src.funnel, readiness: src.readiness, saleKind: src.saleKind, side: src.side,
      objectType: src.objectType, paymentForm: src.paymentForm, goal: src.goal, source: src.source,
      amount: src.amount, agent: src.agent, companyId: src.companyId, vat: src.vat,
      contacts: JSON.parse(JSON.stringify(dealContacts(src))),
      lots: [], objectId: null,                       // объект выбирается заново: он и есть предмет второй сделки
      stage: ((WS.DEAL_STEPS || {})[WS.contractKindFor(src.funnel, src.readiness)] || ['prep'])[0],
      stageDays: 0, createdAt: src.createdAt, prov: {},
    };
    D().deals.unshift(copy);
    addEventEntry('deal', id, { type: 'note', text: 'Сделка заведена копией условий сделки «' + (src.title || src.id) + '». История и документы не копировались — они принадлежат исходной.' });
    WS.storeApi.touch();
    WS.storeApi.toast('Копия условий создана — выберите объект', 'ok');
    dealCard(id);
    return copy;
  }
  // Порядковый номер вместо часов: Date.now() в этом стенде запрещён — он ломает повторяемость
  // прогона, а нужен здесь только неповторяющийся хвост идентификатора.
  let _copySeq = 0;
  function nextCopySeq() { _copySeq += 1; return String((D().deals || []).length) + '_' + _copySeq; }

  /* ---- Передать против привлечь (§3.1 решений) ----
     Сейчас это смешано в одном поле, а операции разные. ПЕРЕДАТЬ — меняется ответственный,
     открытые задачи переназначаются, в ленте остаётся след, прежний ответственный сохраняет
     доступ на чтение: он отвечал перед клиентом и должен видеть, чем кончилось. ПРИВЛЕЧЬ —
     ответственный не меняется, это со-брокеридж. Разница названа словами, а не оттенком. */
  function dealTransferForm(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const who = TEAM.filter((m) => m.id !== d.agent);
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Передача меняет ответственного и переназначает открытые задачи. Прежний ответственный сохранит доступ на чтение — он отвечал перед клиентом. Если нужно разделить вознаграждение, а не передать сделку, это «Привлечь партнёра».</p>' +
      '<div class="match-grid"><label class="fld"><span>Кому передаём</span><select id="tr_to">' +
      who.map((m) => '<option value="' + m.id + '">' + escAttr(m.name) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Причина</span><input id="tr_why" type="text" placeholder="Напр.: ухожу в отпуск с 20 мая"></label></div>';
    openModal('Передать сделку · ' + escAttr(d.title || d.id), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="saveTransfer" data-deal="' + dealId + '">' + I('check') + 'Передать</button>');
  }
  function saveTransfer(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const to = g('tr_to'), why = g('tr_why');
    if (!to || to === d.agent) { WS.storeApi.toast('Выберите, кому передаёте'); return; }
    const from = d.agent;
    d.agent = to;
    // Прежний ответственный остаётся свидетелем: карточку и историю видит, менять не может.
    d.witness = (d.witness || []).concat(from ? [from] : []);
    (D().tasks || []).forEach((t) => { if (t.dealId === dealId && t.status !== 'done') t.assignee = to; });
    addEventEntry('deal', dealId, { type: 'note', text: 'Сделка передана: ' + agentName(from) + ' → ' + agentName(to) + (why ? '. Причина: ' + why : '') + '.' });
    WS.storeApi.touch(); closeModal();
    WS.storeApi.toast('Сделка передана — ' + agentName(to), 'ok');
    dealCard(dealId);
  }
  function dealPartnerForm(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const who = TEAM.filter((m) => m.id !== d.agent);
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Привлечение партнёра не меняет ответственного: это со-брокеридж. Ответственным по сделке остаётесь вы.</p>' +
      '<div class="match-grid"><label class="fld"><span>Агент-партнёр</span><select id="pa_who">' +
      who.map((m) => '<option value="' + m.id + '"' + (m.id === d.partnerAgent ? ' selected' : '') + '>' + escAttr(m.name) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Условия разделения</span><input id="pa_split" type="text" value="' + escAttr(d.split || '50 / 50') + '"></label></div>';
    openModal('Привлечь партнёра · ' + escAttr(d.title || d.id), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="savePartner" data-deal="' + dealId + '">' + I('check') + 'Привлечь</button>');
  }
  function savePartner(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const who = g('pa_who'); if (!who) return;
    d.partnerAgent = who;
    d.split = g('pa_split') || '50 / 50';
    addEventEntry('deal', dealId, { type: 'note', text: 'Привлечён партнёр: ' + agentName(who) + ' · разделение ' + d.split + '. Ответственный не менялся.' });
    WS.storeApi.touch(); closeModal();
    WS.storeApi.toast('Партнёр привлечён — ' + agentName(who), 'ok');
    dealCard(dealId);
  }
  function dealChipRow(d) {
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const createdDaysAgo = createdAgoLabel(d);
    return '<div class="dnb-chips">' +
      '<span class="chip">' + I('clock') + (d.stageDays || 0) + ' дн. в стадии</span>' +
      (d.hot ? '<span class="chip">' + I('sparkle') + 'горячий клиент</span>' : '') +
      (c.consent === false ? '<span class="chip stop">' + I('lock') + 'нет согласия</span>' : '') +
      (d.createdAt && createdDaysAgo ? '<span class="chip">' + I('calendar') + 'создана ' + d.createdAt + ' · ' + createdDaysAgo + '</span>' : '') + '</div>';
  }
  function dealNextStep(d) {
    const a = nbaActions(d);
    /* Срок закрытой сделки не наследуется. `nextDue` остаётся тем, что стоял в работе, и
       «запросить отзыв» получало дедлайн «сегодня 16:00» от касания, которого больше нет —
       вместе с признаком просрочки по нему же. Поле не чистится в данных намеренно: оно часть
       истории сделки. Не наследует его тот, кто рисует следующий шаг. */
    const closed = dealClosed(d);
    return { owner: agentName(d.agent), due: closed ? '' : (d.nextDue || ''),
      over: !closed && /просроч/i.test(d.nextDue || ''),
      action: a.doIt[0], why: a.why || '' };
  }
  // Planned events block: open tasks and calendar events with dates. Overdue first, marked visibly.
  // Past events live in dealRecentCard, not duplicated here.
  function dealPlannedEventsCard(d) {
    const tasks = (D().tasks || []).filter((t) => t.dealId === d.id && t.status !== 'done');
    const events = (D().events || []).filter((e) => e.dealId === d.id && e.status !== 'canceled');
    const items = [];
    // Collect all events and tasks with due dates.
    // Порядок внутри «когда» задаёт словарь срочности, а не строка даты: «14 мая» и «6 июня»
    // сравненные как текст встают наоборот, потому что «1» меньше «6».
    const WHEN_ORD = { overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4 };
    tasks.forEach((t) => {
      if (t.due) items.push({ type: 'task', label: t.title || t.text || 'Задача', due: t.due,
        overdue: t.when === 'overdue', ord: WHEN_ORD[t.when] == null ? 9 : WHEN_ORD[t.when] });
    });
    // Запись календаря несёт `title` и `when` — не `text`/`at`, как запись ленты. Чтение по
    // чужой форме молча выбрасывало КАЖДОЕ событие, и блок показывал только задачи.
    events.forEach((e) => {
      const when = e.when || e.at;
      if (!when) return;
      items.push({ type: 'event', label: e.title || e.text || 'Событие', due: when,
        overdue: /просроч/i.test(String(when)),
        ord: (WHEN_ORD[when] == null ? 5 : WHEN_ORD[when]) });
    });
    items.sort((a, b) => a.ord - b.ord);
    const html = items.map((it) => {
      const icon = it.type === 'task' ? 'checkCircle' : 'calendar';
      const overClass = it.overdue ? ' over' : '';
      return '<div class="plev-row' + overClass + '">' +
        '<span class="plev-icon">' + I(icon) + '</span>' +
        '<div class="plev-info"><div>' + escAttr(it.label) + '</div>' +
        '<div class="plev-date">' + (it.due || '—') + (it.overdue ? ' · просрочено' : '') + '</div></div></div>';
    }).join('');
    return plannedCard(dealNextStep(d), html);
  }
  // Entries the client authored, across the deal, its заявка and the contact — the client's own
  // moves, separated from ours. `by` is the author of a timeline entry; inbound raw channel capture
  // counts too, since a voice message in WhatsApp is the client doing something.
  function clientMoves(d) {
    return dealLineageEntries(d).filter((e) => {
      if (/просроч/i.test(e.text || '')) return false;
      return /клиент/i.test(e.by || '') || (e.kind === 'raw' && /клиент/i.test(e.by || ''));
    });
  }
  function dealClientMovesCard(d) {
    const list = clientMoves(d).filter((e) => !(e.ord > NOW_ORD)).slice(0, 4);
    const inner = list.length
      ? '<div class="cm-list">' + list.map((e) => '<div class="cm-row">' +
          '<span class="cm-ic">' + I(chanMeta(e.ch === 'note' ? 'phone' : (e.ch || 'phone'))[0]) + '</span>' +
          '<div class="cm-b"><div class="cm-t">' + (e.text || '') + '</div>' +
          '<div class="cm-m">' + (e.at || '') + (e.src ? ' · ' + e.src : '') + '</div></div></div>').join('') + '</div>'
      : '<div class="cm-empty">' + I('clock') + 'Клиент пока ничего не делал сам — вся активность на нашей стороне. Это тоже сигнал: он либо не вовлечён, либо ждёт от нас ответа.</div>';
    return dxSec('users', 'Что делал клиент', list.length ? '<span class="badge">' + list.length + ' из ' + clientMoves(d).length + '</span>' : '',
      inner);
  }
  function dealRecentCard(d) {
    return recentEventsCard((D().dealTimeline || {})[d.id] || [], 'deal~' + d.id + '~history');
  }
  // Compact object card — the demoted hero. Opens the full object on click.
  function dealObjectMini(o) {
    if (!o) return '';
    const ph = (WS.photos && WS.photos[o.id]) || '';
    const avail = o.availability === 'available'
      ? '<span class="badge ok">' + I('check') + 'доступен</span>'
      : '<span class="badge warn">' + I('clock') + 'проверить</span>';
    return '<div class="obj-mini" data-obj="' + o.id + '">' +
      (ph ? '<div class="obj-mini-ph" style="background-image:url(' + ph + ')"></div>' : '<div class="obj-mini-ph">' + I('building') + '</div>') +
      '<div class="obj-mini-b"><div class="obj-mini-n">' + o.name + '</div>' +
      '<div class="obj-mini-m">' + o.area + ' · ' + WS.AED(o.price) + ' · ' + o.br + '</div>' +
      '<div class="obj-mini-badges">' + avail + '<span class="badge">' + I('money') + 'комиссия ' + (o.commissionPct || '—') + '%</span></div></div>' +
      I('arrowRight') + '</div>';
  }
  /* ---- Пер-лотовое состояние (§2.3 решений) ----
     Массив лотов формы НЕ меняет: его читают около десяти мест кода и восемь проверок,
     и смена формы без переходника дала бы не ошибку, а тихие пустые выборки. Состояние
     заводится отдельной картой на сделке, ключом по объекту. Отсутствие записи — это
     не «пусто», а «как у сделки»: лот без своей записи наследует шаг и ставку объекта. */
  const LOT_EXITS = [
    { k: 'returned', label: 'Вернуть в подбор', done: 'возвращён в подбор' },
    { k: 'rejected', label: 'Отклонить', done: 'отклонён клиентом' },
    { k: 'replaced', label: 'Заменить', done: 'заменён другим объектом' },
    { k: 'blocked', label: 'Заблокировать', done: 'заблокирован' },
  ];
  const exitLabel = (k) => (LOT_EXITS.find((x) => x.k === k) || {}).done || k;
  function lotState(d, objId) { return ((d && d.lotState) || {})[objId] || null; }
  // Заблокированный лот остаётся в сделке — он помечен как непредлагаемый, а не выведен.
  function lotIsOut(st) { return !!(st && st.exit && st.exit !== 'blocked'); }
  // Лоты, которые считаются: вышедшие из сделки в сумму и комиссию не входят.
  function dealLiveLots(d) { return dealLots(d).filter((o) => !lotIsOut(lotState(d, o.id))); }
  function lotCommissionPct(d, o) {
    const st = lotState(d, o.id);
    return (st && st.commissionPct != null) ? st.commissionPct : (o.commissionPct || DEFAULT_COMM_PCT);
  }
  /* Сумма сделки, собранная из лотов, пересчитывается по оставшимся. Введённая вручную —
     не трогается: молча переписать число, которое агент ввёл сам, хуже, чем показать,
     что оно разошлось с суммой лотов. */
  function lotsSum(d) { return dealLiveLots(d).reduce((a, o) => a + (o.price || 0), 0); }
  /* Собрана ли сумма из лотов — решается ОДИН раз и запоминается. Если спрашивать заново
     после каждого вывода, второй лот сравнивался бы уже с пересчитанной суммой, не сходился
     бы с полным списком, и сделка молча переставала бы считаться собранной из лотов. */
  function amountFromLots(d) {
    if (d.amountFromLots != null) return !!d.amountFromLots;
    const all = dealLots(d).reduce((a, o) => a + (o.price || 0), 0);
    return all > 0 && Math.abs(all - (d.amount || 0)) <= 1;
  }
  function lotsMismatch(d) {
    const s = lotsSum(d);
    return (s && d.amount && Math.abs(s - d.amount) > 1) ? { lots: s, deal: d.amount } : null;
  }
  function lotExitForm(dealId, objId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const o = (D().objects || []).find((x) => x.id === objId) || {};
    const opts = LOT_EXITS.map((e) => '<option value="' + e.k + '">' + e.label + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Исход обязателен: причины разные, и последствия у них разные — автоматически вернуть лот в подбор нельзя. Договор при этом не пересобирается: вехи и график согласованы с другой стороной.</p>' +
      '<div class="match-grid"><label class="fld"><span>Что происходит с лотом</span><select id="lot_exit">' + opts + '</select></label>' +
      '<label class="fld"><span>Причина</span><input id="lot_why" type="text" placeholder="Напр.: клиент выбрал другой этаж"></label></div>';
    openModal('Вывести из сделки · ' + (o.name || objId), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="saveLotExit" data-deal="' + dealId + '" data-obj="' + objId + '">' + I('check') + 'Применить</button>');
  }
  function saveLotExit(dealId, objId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const exit = g('lot_exit') || 'returned';
    const why = g('lot_why');
    const fromLots = amountFromLots(d);
    if (d.amountFromLots == null) d.amountFromLots = fromLots;
    if (!d.lotState) d.lotState = {};
    d.lotState[objId] = Object.assign({}, d.lotState[objId], { exit: exit, exitReason: why, exitAt: WS.storeApi.clockLabel().date });
    if (exit === 'returned' || exit === 'rejected') {
      // Лот выходит из подборки заявки в то состояние, которое назвал агент: возврат — снова
      // доступен и ход наш; отказ — помечен отказом клиента.
      const r = d.requestId ? requestById(d.requestId) : null;
      const off = r && (r.offered || []).find((x) => x.id === objId);
      if (off) { off.state = exit === 'rejected' ? 'rejected' : 'offered'; if (exit === 'returned') off.turn = 'us'; }
    }
    if (fromLots) d.amount = lotsSum(d);
    // Договор автоматически не пересобирается — он помечается как требующий пересмотра.
    contractsOfDeal(d.id).forEach((k) => { k.review = 'вышел лот: ' + ((D().objects || []).find((x) => x.id === objId) || {}).name; });
    addEventEntry('deal', d.id, { type: 'note', text: 'Лот ' + (((D().objects || []).find((x) => x.id === objId) || {}).name || objId) + ' — ' + exitLabel(exit) + (why ? ': ' + why : '') + '.' });
    WS.storeApi.touch();
    closeModal();
    if (!dealLiveLots(d).length) WS.storeApi.toast('Лотов не осталось. Сделку можно закрыть проигрышем — или поставить другой лот', 'warn');
    else WS.storeApi.toast('Лот ' + exitLabel(exit), 'ok');
    dealCard(dealId);
  }
  function undoLotBlock(dealId, objId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d || !d.lotState || !d.lotState[objId]) return;
    delete d.lotState[objId].exit; delete d.lotState[objId].exitReason; delete d.lotState[objId].exitAt;
    WS.storeApi.touch(); WS.storeApi.toast('Блокировка снята', 'ok'); dealCard(dealId);
  }
  // Строка лота: своя регистрация, свой срок, своя ставка — и кнопка вывода из сделки.
  function lotRow(d, o) {
    const st = lotState(d, o.id) || {};
    const out = lotIsOut(st);
    const reg = st.regNo ? '<span class="badge ok">' + I('shield') + (st.regNo) + (st.regAt ? ' · ' + st.regAt : '') + '</span>' : '';
    const pct = lotCommissionPct(d, o);
    const own = (st.commissionPct != null) ? ' (своя)' : '';
    const mark = out ? '<span class="badge stop">' + I('x') + exitLabel(st.exit) + '</span>'
      : (st.exit === 'blocked' ? '<span class="badge warn">' + I('lock') + 'заблокирован' + (st.exitReason ? ' · ' + escAttr(st.exitReason) : '') + '</span>' : '');
    const act = out ? ''
      : (st.exit === 'blocked'
        ? '<button class="btn xs" data-lotunblock="' + d.id + ':' + o.id + '">' + I('check') + 'Снять блокировку</button>'
        : '<button class="btn xs" data-lotexit="' + d.id + ':' + o.id + '">' + I('x') + 'Вывести из сделки</button>');
    return '<div class="lot-row' + (out ? ' lot-out' : '') + '">' + dealObjectMini(o) +
      '<div class="lot-meta"><span class="badge">' + I('money') + 'комиссия ' + pct + '%' + own + ' · ' + WS.AED(Math.round((o.price || 0) * pct / 100)) + '</span>' +
      reg + mark + act + '</div></div>';
  }
  function dealLotsBlock(d) {
    const lots = dealLots(d);
    const live = dealLiveLots(d);
    const title = lots.length > 1 ? 'Объекты сделки · ' + live.length + ' ' + plural(live.length, 'лот', 'лота', 'лотов') : 'Объект сделки';
    const mism = lotsMismatch(d);
    // Расхождение показывается, а не исправляется молча: сумма могла быть введена рукой.
    const warn = mism ? '<div class="rel-why">' + I('warn') + '<span>Сумма лотов ' + WS.AED(mism.lots) +
      ' расходится с суммой сделки ' + WS.AED(mism.deal) + '. Введённое вручную число мы не переписываем.</span></div>' : '';
    const body = lots.length ? warn + lots.map((o) => lotRow(d, o)).join('')
      : '<div style="font-size:12px;color:var(--faint);padding:6px 0">объект ещё не выбран</div>';
    return dxSec('building', title, '', body);
  }
  // EOI / booking deposit — amount, paid?, date, refundable (Codex IA review: a P0 for a live deal).
  function depositLabel(d) {
    const x = d.deposit; if (!x) return null;
    return x.kind + ' · ' + WS.AED(x.amount) + ' · ' + (x.paid ? 'внесён' + (x.at ? ' ' + x.at : '') : 'не внесён') + ' · ' + (x.refundable ? 'возвратный' : 'невозвратный');
  }
  // Key params, lifted into the header (right of the facing pair).
  function dealKeyCard(d) {
    const p = d.prov || {};
    const o0 = dealLots(d)[0];
    // Who pays us: on a primary sale the developer, on a resale the buyer, on a lease the tenant,
    // on an owner-side service the owner, on a partner service the partner.
    const commPayer = d.funnel === 'sale' ? (d.saleKind === 'первичка' ? 'застройщик' : 'покупатель')
      : d.funnel === 'rent' ? 'арендатор'
      : (d.funnel === 'manage' || d.funnel === 'exclusive') ? 'собственник'
      : d.funnel === 'cross' ? 'партнёр' : 'по договору';
    // Итог остаётся в шапке, но раскрывается построчно: с несколькими лотами одного процента
    // не существует, и «5%» в шапке было бы ставкой первого объекта, выданной за общую.
    const live = dealLiveLots(d);
    const commSum = dealCommission(d);
    const comm = commSum
      ? (live.length > 1
        ? WS.AED(commSum) + ' · по лотам: ' + live.map((o) => lotCommissionPct(d, o) + '%').join(' · ') + ' · платит ' + commPayer
        : (o0 ? lotCommissionPct(d, o0) + '% · ' + WS.AED(commSum) + ' · платит ' + commPayer : WS.AED(commSum)))
      : '—';
    const cobro = d.partnerAgent ? agentName(d.partnerAgent) + ' · co-broking' : 'нет';
    const dep = depositLabel(d);
    return dxSec('briefcase', 'Ключевое', '<button class="btn xs" data-act="editDeal" data-deal="' + d.id + '">' + I('pencil') + 'Изменить</button>', '<div class="dfields">' +
      dealField('Бюджет', d.amount ? WS.AED(d.amount) : '—', p.budget, d.id + ':budget') +
      dealField('Форма оплаты', d.paymentForm, p.paymentForm, d.id + ':paymentForm') +
      (dep ? dealField('Задаток / EOI', dep, 'confirmed') : '') +
      dealField('Цель', d.goal, p.goal, d.id + ':goal') +
      dealField('Комиссия', comm, 'confirmed') +
      dealField('Co-broking', cobro, 'confirmed') + '</div>');
  }
  // Handover brief — what one agent tells another when passing a deal over. Four movements, each
  // a sentence assembled from the deal's own records: where we stand · what is already settled ·
  // what is holding it up · whose move it is. Every clause is dropped when its data is absent, so a
  // brand-new deal yields two honest sentences instead of a skeleton full of dashes.
  // Родительская заявка объясняет, зачем сделка существует: что человек искал и на каких условиях.
  // Без этой строки карточка отвечает «как идёт», но не отвечает «о чём это».
  function dealRequestSummary(d) {
    const r = d.requestId ? requestById(d.requestId) : null;
    if (!r) return '';
    const parts = [];
    if (r.goal) parts.push(lowerFirst(r.goal));
    if (r.budget) parts.push('бюджет ' + WS.AED(r.budget));
    // Районы уже перечислены между собой — вкладывать один joinRu в другой значит получить «A и B и C».
    if ((r.areas || []).length) parts.push(r.areas.slice(0, 3).join(' · '));
    if (r.horizon) parts.push(/\d|мес|нед|дн/i.test(r.horizon) ? 'срок ' + r.horizon : lowerFirst(r.horizon));
    if (!parts.length) return '';
    return 'Запрос' + (r.createdAt ? ' от ' + r.createdAt : '') + ': ' + parts.join(', ') + '.';
  }
  // Что сделал клиент сам — последняя его запись в ленте сделки, заявки или контакта. Агенту важно
  // не только, что сделали мы, но и шевелится ли человек на той стороне.
  function dealLastClientMove(d) {
    const list = clientMoves(d).filter((e) => !(e.ord > NOW_ORD))
      .slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
    return list[list.length - 1] || null;
  }
  function dealBriefSentences(d) {
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const out = [];
    const lots = dealLots(d);
    const what = lots.length === 1 ? lots[0].name.split(',')[0]
      : (lots.length > 1 ? lots.length + ' ' + plural(lots.length, 'лот', 'лота', 'лотов') + ' в ' + (lots[0].project || lots[0].area) : (d.objectType || 'объект'));

    // 1. Предмет: что продаём, кому и кто ведёт. Имя стоит после тире, в именительном: подставить
    // его в «для …» шаблон не может — падежа он не знает.
    out.push((d.dealType || 'Сделка') + ': ' + what + '.' +
      (c.name ? ' Клиент — ' + c.name + (d.agent ? ', ведёт ' + agentName(d.agent) : '') + '.' : ''));

    // 2. Запрос, из которого сделка выросла.
    const req = dealRequestSummary(d);
    if (req) out.push(req);

    // 3. Последний существенный факт — деньги, бумага или выбор. Один, самый поздний по смыслу.
    const dep = d.deposit;
    const drafts = docsFor((x) => x.deal === d.id && x.status === 'draft');
    if (dealClosed(d) && dealWon(d)) out.push('Сделка успешно закрыта, комиссия зафиксирована.');
    else if (dep && dep.paid) out.push('Внесено: ' + depKind(dep) + ' — ' + WS.AED(dep.amount) + (dep.at ? ', ' + dep.at : '') + '.');
    // Если документ уже у клиента, он и есть последний факт — фраза про полученный расчёт лишняя.
    else if (dealKpObjects(d).length && !drafts.length) out.push('Клиент получил расчёт и условия сделки.');
    else if (lots.length && !drafts.length) out.push('Объект выбран, готовим документы.');

    // 4. Чего ждём и что сделал клиент.
    if (!dealClosed(d)) {
      // Срок присоединяется к ожиданию: два отдельных предложения об одном и том же удлиняют справку,
      // не добавляя смысла.
      const dueTxt = (!/просроч/i.test(d.nextDue || '') && d.nextDue) ? d.nextDue : '';
      if (drafts.length) out.push(drafts[0].title.split('—')[0].trim() + ' у клиента — ждём подписания' +
        (dueTxt ? ', следующее касание ' + dueTxt : '') + '.');
      const mv = dealLastClientMove(d);
      if (mv && mv.at) {
        // Реплика клиента приводится как есть, но без служебного префикса и без своей точки:
        // предложение уже заканчивается нашей.
        const txt = (mv.text || '')
          .replace(/^(Голосовое|Входящее|Исходящее|Сообщение|Заметка)\s*:\s*/i, '')
          .replace(/^(Звонок|Созвон)\s*[\d:]+\s*[—-]\s*/i, '')
          .replace(/[.\s]+$/, '');
        if (txt) out.push('Последнее от клиента, ' + mv.at.split('·')[0].trim() + ': ' + lowerFirstWord(txt) + '.');
      }
      if (!drafts.length && dueTxt) out.push('Следующее касание — ' + dueTxt + '.');
    }

    // 5. Что мешает — одна причина, самая дорогая. Счётчики сюда не попадают.
    if (!dealClosed(d)) {
      const cf = (D().conflicts || {})[d.id];
      const nextGate = gatesFor(d).filter((k) => !gateDone(d, k))[0];
      const overdue = tasksOfDeal(d).filter((t) => t.status !== 'done' && t.when === 'overdue').length;
      let block = '';
      if (c.consent === false) block = 'от клиента нет согласия на связь — адресные отправки заблокированы';
      else if (/просроч/i.test(d.nextDue || '')) block = 'касание просрочено';
      else if (dep && !dep.paid) block = 'не внесён задаток — ' + depKind(dep) + ', ' + WS.AED(dep.amount);
      else if (cf) block = 'по полю «' + cf.field + '» расходятся два источника, нужно подтверждение клиента';
      else if (nextGate && GATES[nextGate]) block = 'не закрыт шаг «' + GATES[nextGate].label + '»';
      else if (overdue) block = overdue + ' ' + plural(overdue, 'задача просрочена', 'задачи просрочены', 'задач просрочены');
      if (block) out.push('Мешает: ' + block + '.');
    }
    return out;
  }

  // Deposit kind reads as a label ("EOI", "Бронирование (booking)") — lowercasing it mangles the
  // acronym, so only the first letter of a word-form is dropped.
  function depKind(dep) {
    const k = dep.kind || 'задаток';
    return /^[A-ZА-Я]{2,}$/.test(k.split(' ')[0]) ? k : lowerFirst(k);
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  // Строчить первую букву аббревиатуры нельзя: «MOU согласован» превращалось в «mOU согласован».
  function lowerFirstWord(s) {
    if (!s) return s;
    const w = String(s).split(/\s/)[0].replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    if (w.length >= 2 && w === w.toUpperCase()) return s;
    return lowerFirst(s);
  }
  // Russian enumeration: «a, b и c» — a bare " · " list would read as a table, not as a sentence.
  function joinRu(list) {
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' и ' + list[list.length - 1];
  }
  /* Справка, следующий шаг и «сейчас» — те же, что стоят на карточке, и потому доступны
     Консьержу. Собирать их у него заново значило бы завести второй источник: экран и ответ
     разошлись бы на первой же правке одного из них, и брокер получил бы два разных положения
     дел по одной сделке. */
  function dealBrief(id) {
    const d = D().deals.find((x) => x.id === id);
    return d ? dealBriefSentences(d) : [];
  }
  function dealNext(id) {
    const d = D().deals.find((x) => x.id === id);
    return d ? dealNextStep(d) : null;
  }
  function reqNow(id) {
    const r = requestById(id);
    return r ? { сейчас: reqStatusPhrase(r), дальше: reqNextAction(r) } : null;
  }
  function dealStatusBrief(d) {
    return dxSec('sparkle', 'Справка по сделке', '<span class="badge ai-b">' + I('sparkle') + 'собрано AI</span>',
      '<p class="deal-brief">' + dealBriefSentences(d).join(' ') + '</p>');
  }
  // Header order (client feedback v2): compact hero → inline-editable title → narrow stepper → one-line essence status →
  // facing cards (LEFT key params · RIGHT client contacts + objects) → "что сейчас" detail.
  function dealHero2(d) { return dealHero(d) + dealTitleEdit(d); }
  function dealState(d) {
    return '<div class="deal-stepper-compact">' + dealStepperSection(d) + '</div>' +
      dealChipRow(d) +
      cxStack([
        [cxCol([dealStatusBrief(d), dealKeyCard(d), dealPlannedEventsCard(d)]),
         cxCol([dealClientCard(d), dealRecentCard(d)])],
        dealLotsBlock(d),
      ]);
  }
  function kpHero(flag) {
    if (!flag) return '<div class="kp-hero-empty">' + I('briefcase') + 'Не выбрано основное предложение</div>';
    return '<div class="kp-hero-modal">' + objHero(flag) +
      '<div class="kp-hero-tag"><span class="badge acc">' + I('star') + 'Флагман пакета</span></div>' +
      objSummary(flag) + '</div>';
  }
  // Deal-stage workflow lifted onto its own surface card so it reads as a distinct step-line,
  // not grey-on-grey. The whole path lives in the accent family (see .dx-step CSS).
  function dealStepperSection(d) {
    return '<div class="dx-sec dx-sec-bare">' + dealStepper(d) + '</div>';
  }
  // «Участники» и условия сделки стоят в левой колонке — вкладки, повторявшей их, больше нет:
  // один и тот же список дважды на одном экране читался как две разные записи.
  function dealTabsFor(d) {
    const pick = ['offers', 'Подбор'];
    const forms = ['docs', 'Оформление'];
    // Меняется не состав, а что стоит первым и открыто по умолчанию: до согласования условий
    // работа идёт про подбор, после — про оформление, и открывать карточку каждый раз на том,
    // чем сегодня не занимаются, — это лишний клик на каждом открытии.
    const lead = dealTermsAgreed(d) ? [forms, pick] : [pick, forms];
    return lead.concat([
      ['params', 'Сделка'],
      ['tasks', 'Задачи · ' + tasksOfDeal(d).length],
      ['history', 'История'],
    ]);
  }
  function dealSpec(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return null;
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    return {
      type: 'deal', id: id, title: d.title,
      hero: dealHero2(d),
      acts: entityActionBar(dealActions(d)),
      state: dealState(d),
      tabs: dealTabsFor(d),
      render: function (tab) { return dealTabContent(d, tab); },
      concierge: entityConcierge('Поручите Консьержу по сделке — «собрать КП», «что просрочено», «бриф к звонку»…', 'deal:' + d.id, escAttr(d.title), 'briefcase'),
    };
  }
  function dealCard(id) { S().dealId = id; S().rightPane = null; WS.router.go('dealDetail'); }
  // Call affordance on the deal card — the client is reachable without opening the contact card.
  function callClient(id) {
    const c = D().clients.find((x) => x.id === id); if (!c) return;
    WS.storeApi.toast('Набираю: ' + c.name + ' · ' + (c.phone || '—'), 'ok');
  }
  // ---- Part B / V2: Заявка (client request) groups deals — 1 заявка → M сделок; lots live inside a deal ----
  function requestById(id) { return (D().requests || []).find((r) => r.id === id); }
  function dealsOfRequest(id) { return (D().deals || []).filter((d) => d.requestId === id); }
  // The "Заявка" block on a deal: which request it belongs to + its sibling deals.
  function dealRequestBlock(d) {
    if (!d.requestId) return '';
    const r = requestById(d.requestId); if (!r) return '';
    const sibs = dealsOfRequest(r.id);
    const shown = (r.offered || []).length;
    const sibChips = sibs.map((s) => '<button class="chip' + (s.id === d.id ? ' on' : '') + '" data-deal="' + s.id + '">' +
      I('briefcase') + dealActionWord(s) + ' · ' + dealLotsLabel(s) + '</button>').join('');
    return dxSec('mail', 'Запрос клиента', '<button class="btn xs" data-request="' + r.id + '">' + I('arrowRight') + 'Открыть запрос</button>',
      '<div style="font-size:12.5px;color:var(--ink)"><b>' + r.title + '</b></div>' +
      '<div style="font-size:12px;color:var(--mut);margin-top:2px">Показано объектов: ' + shown + ' · сделок по запросу: ' + sibs.length + '</div>' +
      (sibs.length > 1 ? '<div class="section-label" style="margin-top:8px">Сделки по этому запросу</div><div class="qa-row" style="margin-top:4px">' + sibChips + '</div>' : ''));
  }
  function requestCard(id) { S().requestId = id; S().rightPane = null; WS.router.go('requestDetail'); }
  // Lead-ops strip (Codex IA review): who owns the lead, its status/temperature, the next contact —
  // the operational facts a broker needs before the brief attributes. Shared by request + client.
  function opsTempChip(t) {
    const m = ({ hot: ['Горячий', 'ro-hot'], warm: ['Тёплый', 'ro-warm'], cold: ['Холодный', 'ro-cold'] })[t];
    return m ? '<span class="ro-item ' + m[1] + '">' + I('flame') + m[0] + '</span>' : '';
  }
  function opsLine(items, temperature) {
    return '<div class="ro-line">' + opsTempChip(temperature) +
      items.filter(Boolean).map((it) => '<span class="ro-item">' + I(it[0]) + it[1] + ': <b>' + it[2] + '</b></span>').join('') + '</div>';
  }
  function opsStrip(items, temperature) {
    return '<div class="req-ops">' + opsLine(items, temperature) + '</div>';
  }
  // ============================================================================================
  // Request = a PROCESS card. Same entityPage frame + header zones as the deal (spec 2026-08-10):
  // hero → status-chip + counters → «Сейчас» phrase → facing pair (LEFT key conditions ·
  // RIGHT client contact + Объекты подбора) → «что сейчас». No linear stepper — requests loop,
  // reject, or spawn several deals, so the status is an honest STATE label.
  // ============================================================================================
  function reqActionWord(r) {
    const t = (r.dealType || '') + ' ' + (r.interest || '');
    if (/аренд/i.test(t)) return 'Аренда';
    if (/fit|отдел/i.test(t)) return 'Fit-out';
    if (/портфел|инвест/i.test(t)) return 'Инвестиция';
    return 'Покупка';
  }
  function reqPhotoBg(r) {
    const o0 = (r.offered || []).map((o) => D().objects.find((x) => x.id === o.id)).filter(Boolean)[0];
    return (o0 && WS.photos && WS.photos[o0.id]) || (WS.photos && WS.photos.o_interior) || '';
  }
  function requestHero(r) {
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const obj = [r.objectType, r.bedrooms].filter(Boolean).join(' · ') || r.interest || '';
    const sub = [reqActionWord(r) + (obj ? ' · ' + obj : ''), r.budget ? WS.AED(r.budget) : null].filter(Boolean).join(' · ');
    const bg = reqPhotoBg(r);
    return '<div class="dhero">' + (bg ? '<img class="dhero-img" src="' + bg + '" alt="">' : '') +
      '<div class="dhero-scrim"></div>' +
      '<div class="dhero-content"><div class="dhero-av">' + init + '</div>' +
      '<div class="dhero-info"><div class="dhero-name">' + (c.name || 'Клиент') + '</div>' +
      '<div class="dhero-sub">' + sub + '</div></div></div></div>';
  }
  function reqStatusState(r) {
    const off = r.offered || [];
    const sel = off.filter((o) => o.state === 'selected').length;
    const rej = off.filter((o) => o.state === 'rejected').length;
    const deals = dealsOfRequest(r.id);
    if (deals.length && deals.every(dealClosed)) return { label: deals.every(dealWon) ? 'Успех' : 'Закрыта', tone: deals.every(dealWon) ? 'ok' : '', icon: deals.every(dealWon) ? 'check' : 'x' };
    if (deals.length) return { label: 'В работе', tone: 'acc', icon: 'briefcase' };
    if (r.kp && r.kp.formed) return { label: 'КП собрано', tone: 'info', icon: 'doc' };
    if (sel) return { label: 'Клиент выбрал', tone: 'warn', icon: 'target' };
    if (off.length && rej === off.length) return { label: 'Новый подбор', tone: 'warn', icon: 'replay' };
    if (off.length) return { label: 'На подборе', tone: '', icon: 'building' };
    return { label: 'Новая', tone: '', icon: 'sparkle' };
  }
  function reqStatusChip(r) {
    const off = r.offered || [];
    const sel = off.filter((o) => o.state === 'selected').length;
    const rej = off.filter((o) => o.state === 'rejected').length;
    const st = reqStatusState(r);
    const items = [{ label: st.label, tone: st.tone || 'acc', icon: st.icon }];
    if (off.length) {
      items.push({ label: 'Показано ' + off.length });
      if (sel) items.push({ label: 'Выбрано ' + sel, tone: 'ok' });
      if (rej) items.push({ label: 'Отклонено ' + rej, tone: 'stop' });
    }
    if (r.leadStatus) items.push({ label: r.leadStatus, icon: 'target' });
    const tm = ({ hot: ['Горячий', 'stop'], warm: ['Тёплый', 'warn'], cold: ['Холодный', ''] })[r.temperature];
    if (tm) items.push({ label: tm[0], tone: tm[1], icon: 'flame' });
    return statusChip(items);
  }
  function reqStatusPhrase(r) {
    const off = r.offered || [];
    const sel = off.filter((o) => o.state === 'selected').length;
    const deals = dealsOfRequest(r.id);
    if (deals.length && deals.every(dealWon)) return 'сделка закрыта успешно — комиссия начислена, ведём договор.';
    if (deals.length && deals.every(dealClosed)) return 'сделка проиграна — запрос закрыт.';
    if (deals.length) return 'ведём сделку — согласуем условия и готовим документы.';
    if (r.kp && r.kp.formed) return 'КП собрано — ждём решение клиента.';
    if (sel) return 'клиент выбрал ' + sel + ' из ' + off.length + ' — собираем КП.';
    if (off.length) return 'объекты подобраны — ждём реакцию клиента.';
    return 'подбираем объекты под запрос.';
  }
  function reqNextAction(r) {
    const off = r.offered || [];
    const sel = off.filter((o) => o.state === 'selected').length;
    const deals = dealsOfRequest(r.id);
    if (deals.length) {
      if (deals.every(dealWon)) return 'Запросить отзыв и рекомендации у клиента';
      if (deals.every(dealClosed)) return 'Разобрать причину проигрыша и вернуть клиента в работу';
      const fd = deals.slice().sort((a, b) => dealStageIdx(b) - dealStageIdx(a))[0];
      return nbaActions(fd).doIt[0]; // mirror the deal's concrete operational step
    }
    if (r.kp && r.kp.formed) return 'Создать сделку из выбранного';
    if (sel) return 'Собрать КП из выбранного (' + sel + ')';
    if (off.length) return 'Уточнить решение клиента по подборке';
    return 'Подобрать объекты под запрос';
  }
  // Facing LEFT — key request conditions (mirror the deal's «Ключевое»).
  function reqKeyCard(r) {
    const pay = [r.paymentForm, (r.vat ? 'НДС 5%' : 'без НДС')].filter(Boolean).join(' · ');
    const edit = '<button class="btn xs" data-act="editRequest" data-req="' + r.id + '">' + I('pencil') + 'Изменить</button>';
    return dxSec('briefcase', 'Ключевые условия', edit, '<div class="dfields">' +
      dfPair('Бюджет', r.budget ? WS.AED(r.budget) : '—') +
      dfPair('Форма оплаты', pay) +
      (r.funding ? dfPair('Финансирование', r.funding) : '') +
      dfPair('Тип сделки', r.dealType) +
      dfPair('Районы', (r.areas || []).join(' · ')) +
      dfPair('Цель', r.goal) +
      dfPair('Срок сделки', r.horizon) + '</div>');
  }
  // Facing RIGHT (top) — client contact card (mirror dealClientCard: call / write / open).
  function reqClientCard(r) {
    const c = D().clients.find((x) => x.id === r.clientId);
    if (!c) return dxSec('users', 'Клиент · связь', '', '<div style="font-size:12px;color:var(--faint);padding:4px 0">клиент не привязан</div>');
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const vals = clientContactVals(c);
    const meta = contactMeta(c);
    // Тред заявки, а не первой попавшейся сделки клиента: у клиента их может быть несколько,
    // и «первая найденная» — это молча выбранный не тот разговор.
    const tid = 'request:' + r.id;
    const head = '<div class="dcli-head"><div class="dcli-av">' + init + '</div>' +
      '<div class="dcli-body"><div class="dcli-name" data-client="' + c.id + '" style="cursor:pointer">' + c.name + '</div>' +
      '<div class="dcli-meta">' + meta + '</div></div></div>';
    const chans = '<div class="dcli-chans">' + ['phone', 'whatsapp', 'telegram', 'email'].map((ch) =>
      '<span class="dcli-ch">' + I(chanMeta(ch)[0]) + '<span>' + (vals[ch] || '—') + '</span></span>').join('') + '</div>';
    const acts = '<div class="dcli-acts">' +
      '<button class="btn sm primary" data-act="callClient" data-cid="' + c.id + '">' + I('phone') + 'Позвонить</button>' +
      '<button class="btn sm" data-thread="' + tid + '" data-tlabel="' + escAttr(c.name) + ' · запрос" data-ticon="mail">' + I('whatsapp') + 'Написать</button></div>';
    return dxSec('users', 'Клиент · связь', '', head + chans + acts);
  }
  // Status of one offered object: whether it became a deal (the final state), else the client's
  // pick/reject/in-work state. So the broker sees at a glance what each object turned into.
  function reqOfferStatus(r, off) {
    const dealObjIds = {};
    dealsOfRequest(r.id).forEach((d) => {
      // Проигранная сделка лот отпускает: договор не состоялся, объект снова свободен и его
      // можно предложить заново. Держать его занятым значит вычеркнуть объект из работы навсегда.
      if (d.stage === 'lost') return;
      const done = dealWon(d);
      (d.lots && d.lots.length ? d.lots : [d.objectId]).forEach((oid) => { if (oid) dealObjIds[oid] = done ? 'done' : 'active'; });
    });
    if (dealObjIds[off.id]) return dealObjIds[off.id] === 'done' ? { label: 'Сделка закрыта', tone: 'ok', icon: 'check' } : { label: 'В сделке', tone: 'acc', icon: 'briefcase' };
    if (off.state === 'selected') return { label: 'Акцептован, работаем', tone: 'ok', icon: 'check' };
    if (off.state === 'rejected') return { label: 'Отказ', tone: 'stop', icon: 'x' };
    // Решение клиента и «чей ход» — два разных поля. Первое не переосмысливается: от него
    // зависят сбор КП, вычисляемая стадия заявки, право создать сделку и профиль предпочтений.
    // Подпись собирается из пары, по словарю партнёра.
    return turnOf(r, off) === 'us'
      ? { label: 'За нами — подготовить ответ', tone: 'acc', icon: 'clock' }
      : { label: 'Ждём обратную связь', tone: '', icon: 'clock' };
  }
  /* Чей ход. Выводится по умолчанию, правится вручную; ручная правка держится, ПОКА не произойдёт
     следующее переключающее событие, — иначе поставленная пометка застынет навсегда и будет врать.
     При отказе и при выборе ход ничей: там подпись говорит сама за себя. */
  function turnDerived(r) {
    const tl = (D().requestTimeline || {})[r.id] || [];
    const last = tl.reduce((m, e) => ((e.ord != null && (!m || e.ord > m.ord)) ? e : m), null);
    // Ход переключается на нас, когда по заявке появляется входящая запись от клиента,
    // и на клиента — в момент отправки подборки или предложения.
    return (last && (last.by === 'Клиент' || last.dir === 'in')) ? 'us' : 'client';
  }
  function turnOf(r, off) {
    if (!off || off.state === 'rejected' || off.state === 'selected') return null;
    const derived = turnDerived(r);
    return (off.turn && off.turnOver === derived) ? off.turn : derived;
  }
  function setTurn(reqId, objId, v) {
    const r = requestById(reqId); if (!r) return;
    const off = (r.offered || []).find((x) => x.id === objId); if (!off) return;
    if (!v || v === 'auto') { delete off.turn; delete off.turnOver; }
    else { off.turn = v; off.turnOver = turnDerived(r); }
    WS.storeApi.touch();
  }
  // Full-width подбор with the status model + INLINE decision editing (pick / in-work / reject right
  // in the tile — no separate edit page). Under it the КП scenario: отметить выбранное → собрать КП
  // с доходностью/стоимостью/условиями → создать сделку.
  function reqOffersStatusBlock(r) {
    const off = r.offered || [];
    const rows = off.map((o) => {
      const obj = D().objects.find((x) => x.id === o.id); if (!obj) return '';
      const st = reqOfferStatus(r, o);
      const locked = st.label === 'В сделке' || st.label === 'Сделка закрыта';
      const ph = (WS.photos && WS.photos[obj.id]) || '';
      const reason = (o.state === 'rejected' && o.reason) ? '<div class="reqo-reason">' + I('warn') + o.reason + '</div>' : '';
      // Переключатель хода стоит рядом с решением клиента и не подменяет его: это второе поле.
      const turn = turnOf(r, o);
      const turnSeg = (locked || !turn) ? '' : '<div class="obj-seg obj-seg-turn">' +
        [['client', 'Ход клиента', 'users'], ['us', 'Ход наш', 'briefcase']].map((v) =>
          '<button class="obj-seg-b' + (turn === v[0] ? ' on' : '') + '" data-reqturn="' + r.id + '~' + obj.id + '~' + v[0] + '">' + I(v[2] || 'dot') + v[1] + '</button>').join('') + '</div>';
      const seg = locked ? '' : '<div class="obj-seg">' +
        [['selected', 'Выбран', 'check'], ['offered', 'В работе', 'clock'], ['rejected', 'Отклонён', 'x']].map((s) =>
          '<button class="obj-seg-b' + (o.state === s[0] ? ' on' : '') + '" data-reqobj="' + r.id + '~' + obj.id + '~' + s[0] + '">' + I(s[2]) + s[1] + '</button>').join('') + '</div>';
      return '<div class="obj-mini" data-obj="' + obj.id + '" data-fromreq="' + r.id + '">' +
        (ph ? '<div class="obj-mini-ph" style="background-image:url(' + ph + ')"></div>' : '<div class="obj-mini-ph">' + I('building') + '</div>') +
        '<div class="obj-mini-b' + (seg ? ' obj-mini-b-row' : '') + '"><div class="obj-mini-info"><div class="obj-mini-n">' + obj.name + '</div>' +
        '<div class="obj-mini-m">' + obj.area + ' · ' + WS.AED(obj.price) + ' · ' + obj.br + '</div>' +
        '<div class="obj-mini-badges"><span class="badge ' + st.tone + '">' + I(st.icon) + st.label + '</span>' +
        '<span class="badge">' + I('money') + 'комиссия ' + (obj.commissionPct || '—') + '%</span></div>' + reason + '</div>' + seg + turnSeg + '</div>' +
        I('arrowRight') + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">объекты ещё не подобраны</div>';
    const add = '<button class="btn xs" data-act="reqAddObject" data-req="' + r.id + '">' + I('plus') + 'Добавить</button>';
    return dxSec('building', 'Объекты подбора · ' + off.length, add, rows + reqKpActions(r));
  }
  // КП scenario, right in the objects block: собрать / открыть / пересобрать / создать сделку.
  // Selected objects not yet consumed by a deal — the actionable set for «Создать сделку» (a request
  // can spawn several deals, so we key off free-selected, not "any deal exists").
  function reqSelectedFree(r) {
    const inDeal = {};
    dealsOfRequest(r.id).forEach((d) => {
      if (d.stage === 'lost') return;   // см. reqOfferStatus: проигрыш освобождает лот
      (d.lots && d.lots.length ? d.lots : [d.objectId]).forEach((oid) => { if (oid) inDeal[oid] = 1; });
    });
    return (r.offered || []).filter((o) => o.state === 'selected' && !inDeal[o.id]).map((o) => o.id);
  }
  function reqKpActions(r) {
    const sel = (r.offered || []).filter((o) => o.state === 'selected').length;
    const selFree = reqSelectedFree(r).length;
    const formed = !!(r.kp && r.kp.formed);
    const btns = [];
    if (formed) {
      btns.push('<button class="btn sm" data-act="openReqKp" data-req="' + r.id + '">' + I('doc') + 'Открыть КП · ' + (r.kp.objectIds || []).length + '</button>');
      btns.push('<button class="btn sm" data-act="reqFormKp" data-req="' + r.id + '"' + (sel ? '' : ' disabled') + '>' + I('sparkle') + 'Пересобрать · ' + sel + '</button>');
      if (selFree) btns.push('<button class="btn sm primary" data-act="reqCreateDeal" data-req="' + r.id + '">' + I('briefcase') + 'Создать сделку · ' + selFree + '</button>');
    } else {
      btns.push('<button class="btn sm primary" data-act="reqFormKp" data-req="' + r.id + '"' + (sel ? '' : ' disabled') + '>' + I('doc') + 'Собрать КП из выбранного · ' + sel + '</button>');
    }
    return '<div class="reqo-kp"><div class="reqo-kp-hint">' + I('sparkle') +
      'Отметьте выбранные объекты — КП собирается с доходностью, стоимостью и условиями, из него создаётся сделка.</div>' +
      '<div class="reqo-kp-acts">' + btns.join('') + '</div></div>';
  }
  // Заявка собирает ту же карточку из своих фактов: ближайший шаг плюс её задачи со сроком.
  function reqPlannedCard(r) {
    const me = (D().users && D().users.agent) ? D().users.agent.name : '—';
    const owner = r.assignee ? agentName(r.assignee) : me;
    const rows = tasksOfRequest(r).filter((t) => t.status !== 'done' && t.due).map((t) =>
      '<div class="plev-row' + (t.when === 'overdue' ? ' over' : '') + '">' +
      '<span class="plev-icon">' + I('checkCircle') + '</span>' +
      '<div class="plev-info"><div>' + escAttr(t.title || t.text || 'Задача') + '</div>' +
      '<div class="plev-date">' + (t.due || '—') + (t.when === 'overdue' ? ' · просрочено' : '') + '</div></div></div>').join('');
    return plannedCard({ owner: owner, due: r.nextContact || '', over: false,
      action: reqNextAction(r), why: '' }, rows);
  }
  function reqRecentCard(r) {
    // 3 (not 4) events on the request so the right column bottom lands level with «Следующий шаг».
    return recentEventsCard((D().requestTimeline || {})[r.id] || [], 'request~' + r.id + '~history', 3);
  }
  // Профиль предпочтений + сделки заявки — раньше жили во вкладке «Обзор» (дублировала шапку, роль
  // неясна). Теперь в основной части под объектами.
  function reqDealsBlock(r) {
    const deals = dealsOfRequest(r.id);
    const dealRows = deals.map((d) => {
      const s = funnelSteps(d);
      return '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div>' +
        '<div class="ft"><div class="t">' + dealActionWord(d) + ' · ' + dealLotsLabel(d) + '</div>' +
        '<div class="m">' + s.cols[s.idx] + ' · ' + WS.AED(d.amount) + '</div></div>' + I('arrowRight') + '</div>';
    }).join('');
    return dxSec('briefcase', 'Сделки по запросу · ' + deals.length, '', '<div class="feed">' + dealRows + '</div>');
  }
  // Returns a cxStack ROW (a pair when both blocks exist), for the caller to place in its stack.
  function reqSecondaryRow(r) {
    const parts = [reqPrefProfile(r), dealsOfRequest(r.id).length ? reqDealsBlock(r) : ''].filter(Boolean);
    return parts.length === 2 ? parts : (parts[0] || '');
  }
  function requestHero2(r) {
    return requestHero(r) + '<div style="margin:12px 0 2px">' + reqStatusChip(r) + '</div>';
  }
  // The заявка had no action bar at all — its verbs were scattered through the blocks, so «что
  // можно сделать» had a different answer here than on every other card.
  function requestActions(r) {
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    const sel = (r.offered || []).filter((o) => o.state === 'selected').length;
    return [
      ['plus', 'Добавить объект', 'data-act="reqAddObject" data-req="' + r.id + '"', 'primary'],
      sel ? ['doc', 'Собрать КП · ' + sel, 'data-act="reqFormKp" data-req="' + r.id + '"', ''] : null,
      sel ? ['briefcase', 'Создать сделку', 'data-act="reqCreateDeal" data-req="' + r.id + '"', ''] : null,
      c.id ? ['chat', 'Написать клиенту', 'data-thread="request:' + r.id + '" data-tlabel="' + escAttr(r.title) + '" data-ticon="mail"', ''] : null,
      ['pencil', 'Изменить запрос', 'data-act="editRequest" data-req="' + r.id + '"', ''],
      c.id ? ['users', 'Открыть контакт', 'data-client="' + c.id + '"', ''] : null,
    ];
  }
  // ============================================================================================
  // Стадия заявки ВЫЧИСЛЯЕТСЯ из её собственных фактов, а не проставляется руками.
  //
  // Именно проставленная руками стадия и дала дефект, ради которого затевалась вся модель: сделка
  // Анны стояла на «Показе», хотя показ прошёл неделей раньше внутри заявки. У вычисленной стадии
  // соврать не выйдет — у каждой есть объективное условие входа, и оно проверяется по данным.
  //
  // Агент двигает не стадию, а границу: он отмечает объекты, по которым условия согласованы.
  // Всё остальное на этой ленте — следствие того, что уже произошло.
  // ============================================================================================
  function reqSideKey(r) {
    const t = (r.dealType || '') + ' ' + (r.interest || '') + ' ' + (r.goal || '');
    if (r.partnerAgent || /партнёр|партнер|co-brok/i.test(t)) return 'partner';
    if (/эксклюзив|управлен|собственник|сдать|реализовать|листинг/i.test(t)) return 'owner';
    return 'buyer';
  }
  // Подпись стадии — строка либо словарь по стороне сделки: у покупателя «направлен подбор»,
  // у собственника «направлено КП». Стадия одна, слово разное.
  function reqStageLabel(k, r) {
    const v = (WS.REQ_STAGE_LABELS || {})[k];
    if (!v) return k;
    if (typeof v === 'string') return v;
    return v[reqSideKey(r)] || v.any || k;
  }
  function reqStage(r) {
    if (/отказ|проигр|потерян/i.test(r.leadStatus || '')) return 'lost';
    const off = r.offered || [];
    const deals = dealsOfRequest(r.id);
    const inDeal = {};
    deals.forEach((d) => ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => { if (id) inDeal[id] = 1; }));
    // Заявка закрыта, когда в подборке не осталось объектов в работе: каждый либо ушёл в сделку,
    // либо отклонён клиентом. Пока хоть один открыт — заявка живёт, даже если сделки уже идут.
    const open = off.filter((o) => o.state !== 'rejected' && !inDeal[o.id]);
    // Заявка закрыта, когда из неё вышли сделки и открытого больше нет. Требование «был хотя бы
    // один предложенный объект» держало услуги без инвентаря — управление, эксклюзив, консалтинг —
    // вечно в переговорах: предлагать там нечего, договор при этом подписан.
    if (deals.length && !open.length) return 'closed';
    if (deals.length || (r.kp && r.kp.formed && off.some((o) => o.state === 'selected'))) return 'talks';
    const tl = (D().requestTimeline || {})[r.id] || [];
    if (tl.some((e) => e.ch === 'meet')) return 'meet';
    if (off.length || (r.kp && r.kp.formed)) return 'offer';
    if (r.budget && (r.areas || []).length) return 'qual';
    return 'new';
  }
  function reqStagePath() { return (WS.REQ_STAGES || []).filter((k) => k !== 'lost'); }
  function reqStepper(r) {
    const cur = reqStage(r), path = reqStagePath(), lost = cur === 'lost';
    const idx = lost ? -1 : path.indexOf(cur);
    // Шаги нарисованы, но не нажимаются: стадия — следствие фактов, и «переставить» её нельзя.
    const steps = path.map((k, i) => {
      const cls = lost ? 'todo' : (i < idx ? 'done' : (i === idx ? 'cur' : 'todo'));
      const inner = (!lost && i < idx) ? I('check') : String(i + 1);
      return '<div class="dx-step ' + cls + '"><span class="d">' + inner + '</span><span class="l">' + reqStageLabel(k, r) + '</span></div>';
    }).join('');
    return '<div class="dx-stepper' + (path.length > 7 ? ' long' : '') + '">' + steps + '</div>' +
      (lost ? '<div class="dx-lost">' + I('x') + 'Клиент отказался</div>' : '');
  }
  function reqStepperSection(r) {
    // Одна строка объяснения остаётся: шаги нарисованы, но не нажимаются, и без подсказки это
    // читается как сломанный элемент, а не как осознанное решение.
    const why = '<div class="req-stage-why">' + I('sparkle') +
      '<span>Стадия выводится из фактов запроса. Агент отмечает объекты, по которым согласованы условия, — остальное следует само.</span></div>';
    return '<div class="dx-sec dx-sec-bare">' + reqStepper(r) + why + '</div>';
  }
  // Левая колонка заявки — то же, что у сделки: справка о клиенте и условия, которые не двигаются,
  // пока прокручивается работа.
  function reqAside(r) {
    return reqClientCard(r) + reqKeyCard(r);
  }
  // Правая — работа: что дальше, запланированное и последнее в ряд, подбор, расхождения.
  function reqWork(r) {
    if (S().rightPane === 'history') {
      return rightHistoryPane(requestTimelineInner(r), 'Назад к работе по запросу');
    }
    const planned = reqPlannedCard(r);
    const recent = reqRecentCard(r);
    const pair = (planned || recent) ? '<div class="dcard-pair">' + (planned || '') + (recent || '') + '</div>' : '';
    /* Расхождение по бюджету — свойство заявки: бюджет называет клиент, и пока стороны не
       сошлись, сделки нет. И это ровно то решение, которого ждут от агента, — поэтому оно
       стоит в той же первой карточке, что и черновики итогов, а не отдельной плашкой ниже. */
    const pend = needsYouCard('request', r.id, conflictBlock(r));
    return pend + pair + cxStack([
      reqOffersStatusBlock(r),
      reqSecondaryRow(r),
    ]);
  }
  function requestState(r) {
    return reqStepperSection(r) +
      '<div class="deal-phrase">' + I('pulse') + '<span><b>Сейчас:</b> ' + reqStatusPhrase(r) + '</span></div>' +
      cxStack([
        [cxCol([reqKeyCard(r), reqPlannedCard(r)]), cxCol([reqClientCard(r), reqRecentCard(r)])],
        conflictBlock(r),
        reqOffersStatusBlock(r),
        reqSecondaryRow(r),
      ]);
  }
  function requestTimelineInner(r) {
    const tl = (D().requestTimeline || {})[r.id] || [];
    const rows = feedSortDesc(tl.map((e, i) => ({ e: e, i: i })))
      .map((p) => tlRow(p.e, '')).join('') ||
      '<div style="font-size:12px;color:var(--faint);padding:8px 0">по запросу пока нет истории</div>';
    return '<div class="timeline">' + rows + '</div>';
  }
  function requestTabContent(r, tab) {
    if (tab === 'tasks') {
      const list = tasksOfRequest(r);
      const rows = list.map(taskRow).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">задач по запросу пока нет</div>';
      return dxSec('check', 'Задачи по запросу · ' + list.length, '<button class="btn xs" data-act="newTask">' + I('plus') + 'Задача</button>', rows);
    }
    if (tab === 'history') return requestHistoryTab(r);
    // docs — КП + документооборот КП→MOU→SPA→DLD (объекты, профиль, сделки — в основной части)
    const rDeals = dealsOfRequest(r.id);
    const sidx = rDeals.length ? Math.max.apply(null, rDeals.map(docIdx)) : -1;
    return cxStack([reqKpBlock(r), docChainBlock(sidx, !!(r.kp && r.kp.formed), ''),
      dxSec('doc', 'Документы запроса', '', docsRows(docsOfRequest(r), 'по этому запросу документов пока нет'))]);
  }
  function requestSpec(id) {
    const r = requestById(id); if (!r) return null;
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    const tid = 'request:' + r.id;
    return {
      type: 'request', id: id, title: 'Запрос · ' + r.title,
      hero: requestHero2(r),
      acts: entityActionBar(requestActions(r)),
      state: requestState(r),
      tabs: [['docs', 'Документы'], ['tasks', 'Задачи · ' + tasksOfRequest(r).length], ['history', 'История']],
      render: function (tab) { return requestTabContent(r, tab); },
      concierge: entityConcierge('Поручите Консьержу по запросу — «собрать КП», «подобрать объекты», «бриф к звонку»…', 'request:' + r.id, r.title, 'mail'),
    };
  }
  // Net yield for the КП preview — reuses the finance model; guarded so a compute miss never breaks render.
  function reqKpNetYield(o) {
    try { const y = objNetYield(o); return (typeof y === 'number' && isFinite(y)) ? y : null; } catch (e) { return null; }
  }
  function reqKpBlock(r) {
    const sel = (r.offered || []).filter((o) => o.state === 'selected');
    if (!r.kp || !r.kp.formed) {
      return dxSec('doc', 'Коммерческое предложение', '',
        '<div style="font-size:12.5px;color:var(--mut);margin-bottom:8px">КП ещё не собрано. Отметьте выбранные объекты в подборе и соберите КП — с доходностью, стоимостью и условиями.</div>' +
        '<button class="btn sm primary" data-act="reqFormKp" data-req="' + r.id + '"' + (sel.length ? '' : ' disabled') + '>' + I('doc') + 'Собрать КП из выбранного (' + sel.length + ')</button>');
    }
    const kpObjs = (r.kp.objectIds || []).map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    const rows = kpObjs.map((o) => {
      const ny = reqKpNetYield(o);
      const m = [o.area, WS.AED(o.price), (ny != null ? 'доходность ' + (ny * 100).toFixed(1) + '%' : null), (o.commissionPct ? 'комиссия ' + o.commissionPct + '%' : null)].filter(Boolean).join(' · ');
      return '<div class="feed-row"><div class="fi i-acc">' + I('building') + '</div><div class="ft"><div class="t">' + o.name + '</div><div class="m">' + m + '</div></div></div>';
    }).join('');
    return dxSec('doc', 'Коммерческое предложение · ' + r.kp.at, '<span class="badge ok">' + I('check') + 'собрано</span>',
      '<div class="feed">' + rows + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn sm" data-act="openReqKp" data-req="' + r.id + '">' + I('arrowRight') + 'Открыть КП</button>' +
      '<button class="btn sm" data-act="reqFormKp" data-req="' + r.id + '">' + I('sparkle') + 'Пересобрать</button>' +
      '<button class="btn sm primary" data-act="reqCreateDeal" data-req="' + r.id + '">' + I('briefcase') + 'Создать сделку из выбранного</button></div>');
  }
  function prefProfileInner(r) {
    const off = r.offered || [];
    const pick = (state) => off.filter((o) => o.state === state).map((o) => D().objects.find((x) => x.id === o.id)).filter(Boolean);
    const sel = pick('selected'), rej = pick('rejected');
    if (!sel.length && !rej.length) return '';
    const uniq = (arr) => arr.filter((v, i) => v && arr.indexOf(v) === i);
    const likeAreas = uniq(sel.map((o) => o.area)), rejAreas = uniq(rej.map((o) => o.area));
    const likeViews = uniq(sel.map((o) => o.attrs && o.attrs.view));
    const like = sel.length ? '<div class="pref-row"><span class="badge ok">' + I('check') + 'Заходит</span><span>' + [likeAreas.join(', '), likeViews.length ? 'вид: ' + likeViews.join(', ') : ''].filter(Boolean).join(' · ') + '</span></div>' : '';
    const rejl = rej.length ? '<div class="pref-row"><span class="badge stop">' + I('x') + 'Не заходит</span><span>' + rejAreas.join(', ') + '</span></div>' : '';
    return like + rejl + '<div style="font-size:11px;color:var(--faint);margin-top:6px">Складывается из «предложили ↔ выбрал / отклонил» — уточняет, что предлагать клиенту дальше и на что не тратить время.</div>';
  }
  function reqPrefProfile(r) {
    const inner = prefProfileInner(r);
    return inner ? dxSec('sparkle', 'Профиль предпочтений', '<span class="badge demo">' + I('lock') + 'из выбора клиента</span>', inner) : '';
  }
  function viewRequestDetail(id) {
    const spec = requestSpec(id);
    const r = requestById(id);
    if (!spec || !r) return '<div class="obj-page-head">' + backBtn('requests', '', 'Назад ко входящим') + '</div>' +
      '<div style="padding:20px;color:var(--mut)">Запрос не найден.</div>';
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    // Тот же каркас, что у сделки: обложка · заголовок · лента шагов · неподвижная левая колонка ·
    // рабочая область · вкладки · строка ввода внизу.
    const o0 = (r.offered || []).map((o) => D().objects.find((x) => x.id === o.id)).filter(Boolean)[0];
    const bg = (WS.photos && ((o0 && WS.photos[o0.id]) || WS.photos.o_creekline)) || '';
    const sub = [escAttr(c.name || '—'), r.budget ? WS.AED(r.budget) : null, r.horizon]
      .filter(Boolean).join(' · ');
    const aside = '<details class="dcard-aside-m"><summary>' + I('menu') + 'Клиент и условия запроса</summary>' +
      '<div class="dcard-aside-m-b">' + reqAside(r) + '</div></details>';
    const title = '<div class="dcard-title"><span class="deal-title-text">' + escAttr(r.title) + '</span></div>' +
      '<div class="dcard-sub">' + sub + '</div>';
    const nav = cardNavRow([backLink('requests', '', 'Назад ко входящим')]);
    return '<div class="dcard">' +
      '<div class="dcard-top">' + coverBand(bg, nav + title, entityActionBar(requestActions(r), 'icons')) +
      '<div class="dcard-pathrow">' + reqStepperSection(r) + '</div></div>' +
      '<div class="dcard-cols">' +
      '<aside class="dcard-aside">' + reqAside(r) + '</aside>' + aside +
      '<div class="dcard-main">' +
      '<div class="deal-phrase">' + I('pulse') + '<span><b>Сейчас:</b> ' + reqStatusPhrase(r) + '</span></div>' +
      reqWork(r) + dealTabsBlock(spec) + '</div>' +
      '</div>' +
      cardComposer('Записать заметку или поручить Консьержу по запросу «' + (r.title || 'запрос') +
        '» — «собрать КП», «подобрать объекты»…') +
      '</div>';
  }
  // ---- Request funnel actions (A1): client-selection state, add object, form КП, create deal ----
  function reqObjState(reqId, objId, state) {
    const r = requestById(reqId); if (!r) return;
    const off = (r.offered || []).find((o) => o.id === objId); if (!off) return;
    off.state = state;
    if (state !== 'rejected') delete off.reason;
    WS.storeApi.save(); WS.storeApi.emit();
  }
  function reqAddObject(reqId) {
    const r = requestById(reqId); if (!r) return;
    const have = {}; (r.offered || []).forEach((o) => { have[o.id] = 1; });
    const avail = (D().objects || []).filter((o) => !have[o.id]);
    const rows = avail.map((o) => '<div class="feed-row"><div class="fi i-acc">' + I('building') + '</div><div class="ft"><div class="t">' + o.name + '</div><div class="m">' + o.area + ' · ' + WS.AED(o.price) + ' · ' + o.br + '</div></div>' +
      '<button class="btn sm primary" data-reqaddobj="' + r.id + '~' + o.id + '">' + I('plus') + 'Добавить</button></div>').join('') || '<div style="padding:8px;color:var(--faint)">все объекты уже в подборе</div>';
    openModal('Добавить объект в подбор', '<div class="feed">' + rows + '</div>', '<button class="btn" data-act="closeModal">Готово</button>');
  }
  function reqAddObjectDo(reqId, objId) {
    const r = requestById(reqId); if (!r) return;
    r.offered = r.offered || [];
    if (!r.offered.some((o) => o.id === objId)) r.offered.push({ id: objId, state: 'offered' });
    WS.storeApi.save(); closeModal(); WS.storeApi.toast('Объект добавлен в подбор', 'ok'); WS.storeApi.emit();
  }
  function reqFormKp(reqId) {
    const r = requestById(reqId); if (!r) return;
    const sel = (r.offered || []).filter((o) => o.state === 'selected').map((o) => o.id);
    if (!sel.length) { WS.storeApi.toast('Отметьте объекты, которые выбрал клиент — из них соберётся КП'); return; }
    r.kp = { formed: true, at: 'сегодня', objectIds: sel };
    WS.storeApi.save(); WS.storeApi.toast('КП собрано из выбранного (' + sel.length + ')', 'ok'); WS.storeApi.emit();
  }
  // Одна сделка заканчивается одним договором. Несколько лотов в одном комплексе одного продавца
  // проходят одним договором и остаются лотами внутри сделки; другой комплекс — другой договор,
  // другой такт подписания и другая сделка. Ключ группы — комплекс и продавец: башня или корпус
  // («Creekline Residences · Tower B») договор не делит, поэтому в ключ идёт часть до разделителя.
  // Продавец, а не застройщик: во вторичке договор подписывает собственник, в аренде —
  // арендодатель, и два юнита одного комплекса от разных собственников идут двумя договорами.
  // Пока у объекта не заполнен `seller`, ключом остаётся застройщик — на оффплане это он и есть.
  function contractGroupKey(o) {
    const dev = String(o.project || o.name || '').split('·')[0].trim();
    return dev + ' | ' + (o.seller || o.developer || '—');
  }
  function groupName(o) { return String(o.project || o.name || '').split('·')[0].trim(); }
  function objReadiness(o) { return /off-?plan|оффплан/i.test(o.segment || '') ? 'оффплан' : 'готовый'; }
  function reqCreateDeal(reqId) {
    const r = requestById(reqId); if (!r) return;
    const sel = reqSelectedFree(r);
    if (!sel.length) { WS.storeApi.toast('Сначала отметьте объекты, которые выбрал клиент'); return; }
    const objs = sel.map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    if (!objs.length) { WS.storeApi.toast('Выбранные объекты не найдены в инвентаре'); return; }
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    const fk = r.funnel || 'sale';

    const groups = [];
    objs.forEach((o) => {
      const k = contractGroupKey(o);
      let g = groups.find((x) => x.k === k);
      if (!g) { g = { k: k, name: groupName(o), objs: [] }; groups.push(g); }
      g.objs.push(o);
    });

    // Всё собирается до записи: половина созданных сделок хуже, чем ни одной, — заявка
    // осталась бы с частью лотов в договорной работе и без следа, почему остальные не ушли.
    const taken = {};
    (D().deals || []).forEach((d) => { taken[d.id] = 1; });
    const drafts = groups.map((g, gi) => {
      const lots = g.objs.map((o) => o.id);
      const readiness = objReadiness(g.objs[0]);
      const steps = (WS.DEAL_STEPS || {})[WS.contractKindFor(fk, readiness)] || ['prep'];
      const base = 'd_' + r.id.replace(/^r_/, '') + (groups.length > 1 ? '_' + (gi + 1) : '');
      let nid = base, n = 1;
      while (taken[nid]) nid = base + '_' + (++n);
      taken[nid] = 1;
      // Снимок КП, из которого выросла сделка: объекты и условия заморожены на момент создания,
      // чтобы позднейшие правки заявки не переписывали исторический документ.
      const kpSnapshot = { objectIds: lots.slice(), at: 'сегодня', version: 1,
        terms: { paymentForm: r.paymentForm, vat: r.vat, horizon: r.horizon, funding: r.funding } };
      return {
        deal: { id: nid, clientId: r.clientId, companyId: null,
          title: (c.name || 'Клиент') + ' · ' + g.name,
          sub: g.name + (lots.length > 1 ? ' · лотов: ' + lots.length : ''),
          funnel: fk, readiness: readiness, side: r.side || null,
          stage: steps[0], stageDays: 0, amount: g.objs.reduce((s, o) => s + (o.price || 0), 0), hot: false,
          createdAt: 'сегодня', updated: 'только что', tags: [],
          // Дата конверсии запроса в сделку. Без неё «сколько идёт от лида до сделки» считать
          // нечем: createdAt отвечает на «когда завели», а не на «когда согласовали условия».
          convertedAt: WS.storeApi.clockLabel().date,
          goal: r.goal, dealType: r.dealType, paymentForm: r.paymentForm, source: r.source,
          objectType: r.objectType, vat: r.vat, horizon: r.horizon, funding: r.funding,
          requestId: r.id, lots: lots, objectId: lots[0],
          consideredProjects: [g.name], kpSnapshot: kpSnapshot, prov: {} },
        entry: { ch: 'crm', by: 'Система', at: 'только что', ord: 999,
          text: 'Условия согласованы по «' + g.name + '» — сделка создана из запроса «' + r.title + '»' +
            (lots.length > 1 ? ' · лотов в одном договоре: ' + lots.length : '') },
      };
    });

    D().dealTimeline = D().dealTimeline || {};
    drafts.forEach((d) => { D().deals.push(d.deal); D().dealTimeline[d.deal.id] = [d.entry]; });
    // Переход — событие заявки: именно она разошлась на договоры, и её история должна это помнить.
    D().requestTimeline = D().requestTimeline || {};
    (D().requestTimeline[r.id] = D().requestTimeline[r.id] || []).push({
      ch: 'system', kind: 'ai', by: 'Консьерж', at: 'только что', ord: 999,
      text: drafts.length === 1
        ? 'Условия согласованы по «' + groups[0].name + '» — заведена сделка.'
        : 'Условия согласованы по ' + drafts.length + ' комплексам — заведено сделок: ' + drafts.length +
          ' (' + groups.map((g) => g.name).join(', ') + '), по одному договору на каждый.',
    });
    WS.storeApi.save();
    if (drafts.length === 1) {
      WS.storeApi.toast('Сделка создана' + (drafts[0].deal.lots.length > 1 ? ' · лотов в договоре: ' + drafts[0].deal.lots.length : ''), 'ok');
      dealCard(drafts[0].deal.id);
    } else {
      WS.storeApi.toast('Комплексов разных — ' + drafts.length + ', значит и договоров столько же: сделок создано ' + drafts.length, 'ok');
      requestCard(r.id);
    }
  }
  // ---- Request Ключевые условия edit (D) + КП document (E) + parent-request breadcrumb (F) ----
  const REQ_ENUMS = {
    dealType: ['Продажа · off-plan', 'Продажа · готовое', 'Аренда', 'Fit-out', 'Инвестиция · портфель', 'Готовый арендный бизнес'],
    paymentForm: ['100% оплата', 'Рассрочка от застройщика', 'Ипотека', 'Годовой чек', 'Поэтапно'],
  };
  function openRequestEdit(id) {
    const r = requestById(id); if (!r) return;
    const sel = (k, label, opts) => '<label class="fld"><span>' + label + '</span><select id="rf_' + k + '">' +
      opts.map((o) => '<option' + (o === r[k] ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Ключевые условия запроса. Сохранение обновляет карточку, подбор и КП.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Бюджет, AED</span><input id="rf_budget" type="text" value="' + (r.budget || '') + '"></label>' +
      sel('dealType', 'Тип сделки', REQ_ENUMS.dealType) + sel('paymentForm', 'Форма оплаты', REQ_ENUMS.paymentForm) +
      '<label class="fld"><span>Районы (через запятую)</span><input id="rf_areas" type="text" value="' + escAttr((r.areas || []).join(', ')) + '"></label>' +
      '<label class="fld"><span>Цель</span><input id="rf_goal" type="text" value="' + escAttr(r.goal || '') + '"></label>' +
      '<label class="fld"><span>Срок сделки</span><input id="rf_horizon" type="text" value="' + escAttr(r.horizon || '') + '"></label>' +
      '<label class="fld"><span>Финансирование</span><input id="rf_funding" type="text" value="' + escAttr(r.funding || '') + '"></label>' +
      '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="rf_vat"' + (r.vat ? ' checked' : '') + '> Применяется НДС 5%</label>';
    openModal('Ключевые условия · ' + r.title, body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveRequest" data-req="' + id + '">' + I('check') + 'Сохранить</button>');
  }
  function saveRequestEdit(id) {
    const r = requestById(id); if (!r) return;
    const g = (k) => { const el = document.getElementById('rf_' + k); return el ? el.value : r[k]; };
    const amt = parseInt((g('budget') || '').toString().replace(/\D/g, ''), 10);
    r.budget = amt || r.budget;
    r.dealType = g('dealType'); r.paymentForm = g('paymentForm');
    r.areas = (g('areas') || '').split(',').map((s) => s.trim()).filter(Boolean);
    r.goal = g('goal'); r.horizon = g('horizon'); r.funding = g('funding');
    r.vat = !!(document.getElementById('rf_vat') || {}).checked;
    WS.storeApi.save(); closeModal(); WS.storeApi.toast('Ключевые условия обновлены', 'ok'); WS.storeApi.emit();
  }
  // КП as a client-facing document — objects with cost + net yield + commission, then the terms.
  // Shared by the live request КП and the deal's frozen snapshot.
  function kpDocBody(cliName, subtitle, objs, terms, note) {
    const rows = objs.map((o) => {
      const ny = reqKpNetYield(o);
      return '<tr><td>' + o.name + '</td><td>' + o.area + '</td><td class="num">' + WS.AED(o.price) + '</td>' +
        '<td class="num">' + (ny != null ? (ny * 100).toFixed(1) + '%' : '—') + '</td>' +
        '<td class="num">' + (o.commissionPct ? o.commissionPct + '%' : '—') + '</td></tr>';
    }).join('');
    const total = objs.reduce((s, o) => s + (o.price || 0), 0);
    return '<div class="kp-doc">' +
      '<div class="kp-doc-head"><div><div class="kp-doc-to">Коммерческое предложение</div>' +
      '<div class="kp-doc-cli">' + cliName + ' · ' + subtitle + '</div></div>' +
      '<span class="badge demo">' + I('lock') + 'DEMO</span></div>' +
      (note ? '<div class="kp-doc-note">' + I('lock') + note + '</div>' : '') +
      '<div class="kp-tblwrap"><table class="kp-tbl"><thead><tr><th>Объект</th><th>Район</th><th class="num">Стоимость</th><th class="num">Доходность</th><th class="num">Комиссия</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="2">Итого · ' + objs.length + ' об.</td><td class="num">' + WS.AED(total) + '</td><td class="num">—</td><td class="num">—</td></tr></tfoot></table></div>' +
      '<div class="kp-doc-terms"><div class="kp-doc-terms-h">Условия</div>' +
      '<div>Форма оплаты: <b>' + (terms.paymentForm || '—') + '</b> · НДС: <b>' + (terms.vat ? '5%' : 'не облагается') + '</b> · Срок: <b>' + (terms.horizon || '—') + '</b></div>' +
      (terms.funding ? '<div>Финансирование: <b>' + terms.funding + '</b></div>' : '') + '</div></div>';
  }
  function openReqKp(id) {
    const r = requestById(id); if (!r) return;
    const ids = (r.kp && r.kp.objectIds && r.kp.objectIds.length) ? r.kp.objectIds : (r.offered || []).filter((o) => o.state === 'selected').map((o) => o.id);
    const objs = ids.map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    if (!objs.length) { WS.storeApi.toast('Отметьте выбранные объекты — из них соберётся КП'); return; }
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    openModal('КП · ' + r.title, kpDocBody(c.name || 'Клиент', r.title, objs, r, null),
      '<button class="btn" data-act="closeModal">Закрыть</button>' +
      '<button class="btn primary" data-act="reqCreateDeal" data-req="' + r.id + '">' + I('briefcase') + 'Создать сделку из выбранного</button>');
  }
  // The КП objects a deal carries — its own frozen snapshot, else (pre-baked demo deals) its request's КП.
  function dealKpObjects(d) {
    const ids = (d.kpSnapshot && d.kpSnapshot.objectIds) ||
      (d.requestId && requestById(d.requestId) && requestById(d.requestId).kp ? requestById(d.requestId).kp.objectIds : null) || [];
    return ids.map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
  }
  /* ---- Коммерческие предложения: версии, а не правки (§2.4 и §7.7 решений) ----
     Снимок КП, зафиксированный при создании сделки, остаётся неизменяемым — это то основание,
     на котором сделка заведена, и переписывать его нельзя. Правка предложения СОЗДАЁТ новую
     версию: так история переговоров остаётся читаемой, и видно, на что клиент отвечал. */
  function offersOf(scope, id) {
    const key = scope === 'deal' ? 'dealId' : 'requestId';
    return (D().offers || []).filter((x) => x[key] === id).sort((a, b) => b.version - a.version);
  }
  function offerTerms(src) {
    return { paymentForm: src.paymentForm || null, vat: !!src.vat, horizon: src.horizon || null, funding: src.funding || null };
  }
  function newOffer(scope, id) {
    const isDeal = scope === 'deal';
    const src = isDeal ? D().deals.find((x) => x.id === id) : requestById(id);
    if (!src) return null;
    const prev = offersOf(scope, id)[0];
    const objectIds = prev ? prev.objectIds.slice()
      : (isDeal ? dealLiveLots(src).map((o) => o.id)
        : (src.offered || []).filter((o) => o.state === 'selected').map((o) => o.id));
    const o = {
      id: 'of_' + id + '_' + ((prev ? prev.version : 0) + 1),
      dealId: isDeal ? id : null, requestId: isDeal ? (src.requestId || null) : id,
      version: (prev ? prev.version : 0) + 1, objectIds: objectIds,
      terms: prev ? Object.assign({}, prev.terms) : offerTerms(src),
      body: prev ? prev.body : 'Предлагаем к рассмотрению объекты ниже. Условия — в таблице; готовы обсудить график платежей.',
      state: 'draft', sentTo: null, sentAt: null,
    };
    (D().offers || (D().offers = [])).unshift(o);
    return o;
  }
  function offerById(id) { return (D().offers || []).find((x) => x.id === id) || null; }
  // Правка ОТПРАВЛЕННОЙ версии не меняет её, а порождает следующую: иначе исчезнет то,
  // на что клиент отвечал.
  function editOffer(offerId) {
    const o = offerById(offerId); if (!o) return;
    const target = o.state === 'sent' ? newOffer(o.dealId ? 'deal' : 'request', o.dealId || o.requestId) : o;
    if (o.state === 'sent' && target) { target.body = o.body; target.objectIds = o.objectIds.slice(); target.terms = Object.assign({}, o.terms); }
    openOfferForm((target || o).id, o.state === 'sent');
  }
  function openOfferForm(offerId, forked) {
    const o = offerById(offerId); if (!o) return;
    const objs = (o.objectIds || []).map((id) => (D().objects || []).find((x) => x.id === id)).filter(Boolean);
    const who = o.dealId ? D().deals.find((x) => x.id === o.dealId) : requestById(o.requestId);
    const c = who ? D().clients.find((x) => x.id === who.clientId) : null;
    const note = forked ? 'Отправленная версия не меняется — это версия ' + o.version + ', её копия. Предыдущая осталась в истории.' : null;
    const body = kpDocBody((c && c.name) || 'Клиент', 'версия ' + o.version + ' · черновик', objs, o.terms || {}, note) +
      '<label class="fld" style="margin-top:10px"><span>Текст предложения</span>' +
      '<textarea id="of_body" rows="3">' + escAttr(o.body || '') + '</textarea></label>';
    // Отправка адресуется участнику, а не «клиенту вообще»: у сделки их несколько,
    // и юристу пишут не то же, что покупателю.
    const parts = who && o.dealId ? dealContacts(who) : (c ? [{ clientId: c.id, role: 'Клиент' }] : []);
    const to = '<label class="fld"><span>Кому отправить</span><select id="of_to">' +
      parts.map((p, i) => '<option value="' + i + '">' + escAttr(contactDisplayName(p)) + ' · ' + roleOf(p) + '</option>').join('') + '</select></label>';
    openModal('Предложение · версия ' + o.version, body + to,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn" data-act="saveOffer" data-offer="' + o.id + '">' + I('check') + 'Сохранить черновик</button>' +
      '<button class="btn primary" data-act="sendOffer" data-offer="' + o.id + '">' + I('send') + 'Отправить клиенту</button>');
  }
  function readOfferForm(o) {
    const el = document.getElementById('of_body');
    if (el) o.body = el.value.trim();
  }
  function saveOffer(offerId) {
    const o = offerById(offerId); if (!o) return;
    readOfferForm(o); WS.storeApi.touch(); closeModal();
    WS.storeApi.toast('Черновик версии ' + o.version + ' сохранён', 'ok');
  }
  function sendOffer(offerId) {
    const o = offerById(offerId); if (!o) return;
    readOfferForm(o);
    const who = o.dealId ? D().deals.find((x) => x.id === o.dealId) : requestById(o.requestId);
    const parts = who && o.dealId ? dealContacts(who) : [];
    const sel = document.getElementById('of_to');
    const p = parts[sel ? +sel.value : 0] || (who ? { clientId: who.clientId } : {});
    /* Отправка блокируется без согласия — тем же правилом, что и любая адресная рассылка.
       У участника без своей карточки контакта собственного согласия нет: он появился в сделке
       через клиента, и его согласием мы считаем клиентское. Пропускать такого адресата
       «потому что записи нет» значило бы обойти правило именем в свободном поле. */
    const dealClient = who ? D().clients.find((x) => x.id === who.clientId) : null;
    const audit = WS.audience.calculateAudience([p], { dealClients: dealClient ? [dealClient] : [] });
    /* Причину называем ту, что вернул модуль. Одна общая подпись «нет согласия» говорила бы,
       что человек отказался, — а он мог просто быть с другой стороны стола или иметь роль,
       которой нет в справочнике. Разные причины — разные действия у агента. */
    if (audit.excluded.length > 0) {
      WS.storeApi.toast((audit.excluded[0].reason || 'нет согласия') + ' — отправка невозможна', 'warn');
      return;
    }
    o.state = 'sent';
    o.sentTo = contactDisplayName(p);
    o.sentAt = WS.storeApi.clockLabel().date;
    if (who && o.dealId) addEventEntry('deal', who.id, { type: 'msg', text: 'Отправлено предложение, версия ' + o.version + ' — ' + o.sentTo + '. Отправка имитируется (DEMO).' });
    WS.storeApi.touch(); closeModal();
    WS.storeApi.toast('Версия ' + o.version + ' отправлена — ' + o.sentTo + ' (имитация)', 'ok');
    if (o.dealId) dealCard(o.dealId);
  }
  function dealOffersBlock(d) {
    const list = offersOf('deal', d.id);
    const add = '<button class="btn xs" data-offernew="deal:' + d.id + '">' + I('plus') + 'Новая версия</button>';
    const rows = list.map((o) => {
      const sent = o.state === 'sent';
      return '<div class="rel-row"><div class="fi i-' + (sent ? 'ok' : 'mut') + '">' + I('doc') + '</div>' +
        '<div class="ft"><div class="t">Версия ' + o.version + ' · ' + (o.objectIds || []).length + ' ' + plural((o.objectIds || []).length, 'объект', 'объекта', 'объектов') + '</div>' +
        '<div class="m">' + (sent ? 'отправлена ' + o.sentAt + ' · ' + escAttr(o.sentTo || '') : 'черновик') + '</div></div>' +
        '<div class="rel-acts"><button class="btn xs" data-offeredit="' + o.id + '">' + I('pencil') + (sent ? 'Новая версия из этой' : 'Открыть') + '</button></div></div>';
    }).join('');
    const empty = '<div style="font-size:12px;color:var(--faint);padding:6px 0">предложений по сделке ещё нет</div>';
    const why = '<div class="rel-why">' + I('lock') + '<span>Снимок КП, на котором заведена сделка, не меняется — он открывается кнопкой «Собрать КП». Правка отправленной версии создаёт следующую.</span></div>';
    return dxSec('doc', 'Предложения · ' + list.length, add, why + '<div class="rel-list">' + (rows || empty) + '</div>');
  }
  function openDealKp(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const objs = dealKpObjects(d);
    if (!objs.length) { WS.storeApi.toast('У сделки нет зафиксированного КП'); return; }
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const at = (d.kpSnapshot && d.kpSnapshot.at) || (d.requestId && requestById(d.requestId) && requestById(d.requestId).kp ? requestById(d.requestId).kp.at : 'при создании сделки');
    // Terms frozen in the snapshot; pre-baked demo deals (no snapshot) fall back to their live fields.
    const terms = (d.kpSnapshot && d.kpSnapshot.terms) || d;
    openModal('КП сделки · ' + escAttr(d.title),
      kpDocBody(c.name || 'Клиент', 'КП сделки · зафиксировано ' + at, objs, terms,
        'Снимок КП на момент создания сделки — неизменяемый. Живое КП правится в запросе.'),
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  // ---- Layer 2: gates ----------------------------------------------------------------
  // A gate is a condition for moving on or getting paid. It lives in the card, never as a column:
  // the whole point of the service axis is that Dubai's procedure does not multiply boards. Which
  // gates a deal has is decided by its FIELDS — (готовность) × (вид сделки) × (тип оплаты) — so a
  // resale grows Form F and trustee while an off-plan grows escrow and Oqood, on the same board.
  //
  // Depth is wave 1: a gate is a manual checklist item an agent ticks. Wave 2 attaches the document
  // and the deadline, wave 3 pulls the status from DLD/Ejari. Pretending otherwise here would be
  // demoing an integration we do not have.
  const GATE_STEPS = [['prep', 'Подготовка к сделке'], ['sign', 'Подписание / оплата'], ['reg', 'Регистрация'], ['exec', 'Выполнение работ']];
  const GATES = {
    kyc: { label: 'KYC и источник средств', at: 'prep', hint: 'Личность и UBO, санкции и PEP, источник средств, доверенность. Обязательно в ОАЭ до сделки.' },
    title: { label: 'Проверка титула и доверенности', at: 'prep', hint: 'Кто собственник, есть ли обременения, действует ли POA.' },
    charges: { label: 'Долги по service charge', at: 'prep', hint: 'Справка об отсутствии задолженности по взносам на содержание.' },
    leases: { label: 'Проверка договоров аренды', at: 'prep', hint: 'Действующие договоры и их условия — у ГАБ покупают денежный поток.' },
    deposit10: { label: 'Депозит-чек 10%', at: 'prep', hint: 'Практика вторички; фактический процент — по договору.' },
    formf: { label: 'Form F (MOU)', at: 'prep', hint: 'Договор о намерениях вторички на портале DLD: покупатель, продавец, агент.' },
    assignment_noc: { label: 'NOC на переуступку', at: 'prep', hint: 'Согласие застройщика; порог оплаты задаёт SPA.' },
    preapproval: { label: 'Предодобрение банка', at: 'prep', hint: 'Первый шаг ипотеки покупателя.' },
    valuation: { label: 'Оценка объекта', at: 'prep', hint: 'Оценка банком или DLD — для ипотеки и для дарения.' },
    fol: { label: 'Final Offer Letter', at: 'prep', hint: 'Финальное письмо-оффер банка покупателя.' },
    escrow: { label: 'Платёж на escrow', at: 'sign', hint: 'Деньги переведены на защищённый счёт проекта.' },
    spa: { label: 'SPA', at: 'sign', hint: 'Договор купли-продажи с застройщиком.' },
    rentdep: { label: 'Депозит по аренде', at: 'sign', hint: '5% без мебели, 10% с мебелью — рыночная практика; по договору.' },
    fitout_ok: { label: 'Согласование отделки', at: 'sign', hint: 'Одобрение проекта собственником, УК или муниципалитетом.' },
    mgmt: { label: 'Договор управления', at: 'sign', hint: 'Право вести объект и контролировать оплаты; объём полномочий — по доверенности.' },
    mandate: { label: 'Эксклюзивный мандат', at: 'sign', hint: 'Договор с собственником на реализацию объекта.' },
    trakheesi: { label: 'Trakheesi', at: 'sign', hint: 'Разрешение на рекламу листинга.' },
    partner_ok: { label: 'Подтверждение партнёра', at: 'sign', hint: 'Партнёр подтвердил оказание услуги — от этого зависит вознаграждение.' },
    oqood: { label: 'Oqood', at: 'reg', hint: 'Регистрация в промежуточном реестре DLD, в короткий срок после SPA.' },
    noc: { label: 'NOC застройщика', at: 'reg', hint: 'Согласие на перевод и отсутствие долгов по service charge.' },
    mortgage_release: { label: 'Снятие залога продавца', at: 'reg', hint: 'Банк продавца снимает залог перед переводом права.' },
    trustee: { label: 'Trustee-перевод', at: 'reg', hint: 'Переоформление права в офисе регистрационного trustee DLD.' },
    dld4: { label: 'Пошлина DLD 4%', at: 'reg', hint: 'Госпошлина за перевод плюс сборы trustee. Плательщик — по договору.' },
    titledeed: { label: 'Title Deed', at: 'reg', hint: 'Итоговый документ о праве собственности.' },
    ejari: { label: 'Ejari', at: 'reg', hint: 'Регистрация аренды в реестре DLD.' },
    service_ok: { label: 'Приёмка работ клиентом', at: 'exec', hint: 'Отчёт принят, документы подписаны.' },
  };
  const COMMERCIAL_TYPES = ['офис', 'ритейл', 'склад', 'ГАБ'];
  function gatesFor(d) {
    if (!d) return [];
    const out = ['kyc']; // every deal, every funnel — the UAE requirement is not funnel-specific
    const kind = d.saleKind || '', pay = d.paymentForm || '';
    if (d.funnel === 'sale') {
      if (kind === 'вторичка') out.push('title', 'deposit10', 'formf', 'noc', 'mortgage_release', 'trustee', 'titledeed');
      else if (kind === 'переуступка') out.push('assignment_noc', 'oqood');
      else out.push('escrow', 'spa', 'oqood'); // первичка and anything off-plan
      if (d.objectType === 'ГАБ') out.push('leases', 'charges');
      if (d.objectType === 'земля') out.push('charges');
      out.push('dld4');
      if (/ипотек/i.test(pay)) out.push('preapproval', 'valuation', 'fol');
    } else if (d.funnel === 'rent') {
      out.push('rentdep', 'ejari');
      if (COMMERCIAL_TYPES.indexOf(d.objectType) >= 0) out.push('fitout_ok');
    } else if (d.funnel === 'manage') out.push('mgmt', 'charges');
    else if (d.funnel === 'exclusive') out.push('mandate', 'trakheesi');
    else if (d.funnel === 'cross') out.push('partner_ok');
    else if (d.funnel === 'consult') out.push('service_ok');
    return out.filter((k, i) => GATES[k] && out.indexOf(k) === i);
  }
  function gateDone(d, k) { return !!(d.gates && d.gates[k]); }
  function gateProgress(d) {
    const list = gatesFor(d);
    return { done: list.filter((k) => gateDone(d, k)).length, total: list.length };
  }
  function gatesBlock(d) {
    const list = gatesFor(d);
    if (!list.length) return '';
    const pr = gateProgress(d);
    // Grouped by the stage the gate belongs to, so the block reads as the road ahead rather than a
    // flat list of Dubai acronyms. A group with nothing in it for this deal is not drawn.
    const groups = GATE_STEPS.map(([at, label]) => {
      const rows = list.filter((k) => GATES[k].at === at).map((k) => {
        const g = GATES[k], on = gateDone(d, k);
        return '<button class="gate-row' + (on ? ' on' : '') + '" data-gate="' + d.id + '~' + k + '" title="Отметить вручную">' +
          '<span class="gate-box">' + (on ? I('check') : '') + '</span>' +
          '<span class="gate-t"><span class="gate-l">' + g.label + '</span>' +
          '<span class="gate-h">' + g.hint + '</span></span></button>';
      }).join('');
      return rows ? '<div class="gate-group"><div class="gate-gh">' + label + '</div>' + rows + '</div>' : '';
    }).join('');
    const meter = '<span class="badge' + (pr.done === pr.total ? ' ok' : ' acc') + '">' + pr.done + ' из ' + pr.total + '</span>';
    return dxSec('check', 'Контрольные точки', meter,
      '<div class="gates">' + groups + '</div>' +
      '<div class="gate-foot">Набор собран по полям карточки: ' +
      [d.dealType, d.readiness, d.saleKind, d.objectType].filter(Boolean).join(' · ') +
      '. Отмечается вручную — подключение к реестрам DLD и Ejari идёт следующей волной.</div>');
  }
  function toggleGate(key) {
    const parts = String(key || '').split('~');
    const d = D().deals.find((x) => x.id === parts[0]);
    if (!d || !GATES[parts[1]]) return;
    d.gates = Object.assign({}, d.gates);
    d.gates[parts[1]] = !d.gates[parts[1]];
    WS.storeApi.touch();
    WS.storeApi.toast('«' + GATES[parts[1]].label + '» — ' + (d.gates[parts[1]] ? 'отмечено' : 'снята отметка'), 'ok');
    setEntityTab('deal', d.id, 'docs');
  }
  // Document pipeline of a REQUEST: КП → MOU → SPA → DLD. Kept for the заявка card, where there is
  // no deal yet to derive gates from; on a deal it is replaced by the gate block above.
  // Position along the deal's own funnel — used to order deals by how far along they are.
  function dealStageIdx(d) { const i = funnelPath(d).indexOf(d && d.stage); return i < 0 ? 0 : i; }
  // The КП→MOU→SPA→DLD strip has four steps and the funnels now have six to nine, so the position
  // is projected onto those four rather than read as an index. Replaced wholesale by the gate layer.
  function docIdx(d) {
    const path = funnelPath(d);
    if (!path.length) return 0;
    return Math.min(3, Math.round((dealStageIdx(d) / Math.max(1, path.length - 1)) * 3));
  }
  function docChainStatuses(sidx, hasKp) {
    const defs = [['КП', 'Коммерческое предложение', 'Собрано'], ['MOU', 'Договор о намерениях', 'Подписан'],
      ['SPA', 'Договор купли-продажи', 'Подписан'], ['DLD', 'Регистрация в Земельном департаменте', 'Зарегистрирован']];
    return defs.map((def, i) => {
      let state;
      if (i === 0) state = hasKp ? 'done' : (sidx >= 0 ? 'active' : 'wait');
      else if (i === 3) state = sidx >= 3 ? 'done' : 'wait';
      else state = sidx > i ? 'done' : (sidx >= i ? 'active' : 'wait');
      return { k: def[0], s: def[1],
        label: state === 'done' ? def[2] : (state === 'active' ? 'В работе' : 'Ожидает'),
        tone: state === 'done' ? 'ok' : (state === 'active' ? 'acc' : ''),
        icon: state === 'done' ? 'check' : (state === 'active' ? 'clock' : 'dot'), state: state };
    });
  }
  function docChainBlock(sidx, hasKp, right) {
    const rows = docChainStatuses(sidx, hasKp).map((it) => '<div class="docchain-row ' + it.state + '">' +
      '<span class="docchain-ic">' + I(it.icon) + '</span>' +
      '<div class="docchain-b"><div class="docchain-k">' + it.k + '</div><div class="docchain-s">' + it.s + '</div></div>' +
      '<span class="badge ' + it.tone + '">' + it.label + '</span></div>').join('');
    return dxSec('doc', 'Документооборот · КП → MOU → SPA → DLD', right || '', '<div class="docchain">' + rows + '</div>');
  }
  // Which заявка a deal/object breadcrumbs back to. An object can be offered in several requests, so
  // first-match would send you to the wrong one — prefer the request we actually navigated in FROM
  // (set on the подбор tile click); fall back to the offering request only when it's unambiguous.
  let objOriginReq = null;
  function setObjOrigin(reqId) { objOriginReq = reqId || null; }
  function objBackRequest(objId) {
    if (objOriginReq) { const r = requestById(objOriginReq); if (r && (r.offered || []).some((o) => o.id === objId)) return r; }
    const hits = (D().requests || []).filter((r) => (r.offered || []).some((o) => o.id === objId));
    return hits.length === 1 ? hits[0] : null;
  }
  function parentReqCrumb(r) {
    if (!r) return '';
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    return '<div class="page-crumb"><button class="btn sm ghost" data-request="' + r.id + '">' + I('chevLeft') + 'К запросу · ' + (c.name || r.title) + '</button></div>';
  }
  // R3 direct edit + confirm AI fields. Editable structural fields with Dubai enums.
  // Every id a deal's owner can hold — TEAM plus whoever already owns one (u_omar runs the DIFC
  // portfolio but is not on the agent roster). Without him the edit form reassigned his deal.
  function dealAgentOptions(current) {
    const ids = TEAM.map((a) => a.id);
    (D().deals || []).forEach((d) => { if (d.agent && ids.indexOf(d.agent) < 0) ids.push(d.agent); });
    if (current && ids.indexOf(current) < 0) ids.push(current);
    return ids.map((id) => '<option value="' + id + '"' + (id === current ? ' selected' : '') + '>' + agentName(id) + '</option>').join('');
  }
  // «Тип сделки» IS the funnel; they were two fields that could disagree, and only one of them
  // drove the board and the gates. Editing the type now moves the deal, and a stage the new funnel
  // does not have is pulled back to one it does rather than leaving the deal on no board at all.
  const FUNNEL_BY_TYPE = {
    'Продажа': 'sale', 'Аренда': 'rent', 'Управление арендой': 'manage',
    'Эксклюзив': 'exclusive', 'Кросс-продажи': 'cross', 'Консалтинг': 'consult',
  };
  function funnelForType(t) { return FUNNEL_BY_TYPE[t] || 'sale'; }
  // Зажимать по услуге мало: у продажи два вида договора, и «Бронь (EOI)» с готовностью
  // «готовый» давало вторичную сделку на шаге, которого в её договоре нет, — колонка доски и
  // лента карточки после этого расходились.
  function clampStage(funnelKey, stage, readiness) {
    const ck = WS.contractKindFor;
    const list = (readiness && ck) ? ((WS.DEAL_STEPS || {})[ck(funnelKey, readiness)] || []) : stepsForFunnel(funnelKey);
    if (!list.length) return stage;
    return list.indexOf(stage) >= 0 ? stage : list[0];
  }
  const DEAL_ENUMS = {
    dealType: ['Продажа', 'Аренда', 'Управление арендой', 'Эксклюзив', 'Кросс-продажи', 'Консалтинг'],
    // Readiness and the kind of transfer used to be smuggled into «тип объекта» («off-plan» sat in
    // the same list as «офис»). They are separate questions, and it is their PAIR that decides which
    // gates a deal has to pass — so they are separate fields.
    objectType: ['апартаменты', 'вилла', 'офис', 'ритейл', 'склад', 'ГАБ', 'земля'],
    readiness: ['оффплан', 'готовый'],
    saleKind: ['', 'первичка', 'вторичка', 'переуступка', 'дарение', 'наследование'],
    side: ['покупатель', 'арендатор', 'собственник'],
    paymentForm: ['100% оплата', 'Рассрочка от застройщика', 'Ипотека', 'Годовой чек', 'Поэтапно'],
    source: ['Property Finder', 'Bayut', 'Dubizzle', 'Instagram', 'Реферал', 'Клуб', 'Импорт'],
  };
  function openDealEdit(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const sel = (k, label) => '<label class="fld"><span>' + label + '</span><select id="df_' + k + '">' + DEAL_ENUMS[k].map((o) => '<option' + (o === d[k] ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    const companyOpts = (D().companies || []).map((co) => '<option value="' + co.id + '"' + (co.id === d.companyId ? ' selected' : '') + '>' + co.name + '</option>').join('');
    const agentOpts = dealAgentOptions(d.agent);
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Прямое редактирование первоклассно. Сохранение помечает поля как «подтверждено человеком».</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Бюджет, AED</span><input id="df_amount" type="text" value="' + (d.amount || '') + '"></label>' +
      sel('dealType', 'Тип сделки') + sel('side', 'Сторона клиента') +
      sel('objectType', 'Тип объекта') + sel('readiness', 'Готовность') + sel('saleKind', 'Вид сделки') +
      sel('paymentForm', 'Форма оплаты') + sel('source', 'Источник') +
      '<label class="fld"><span>Цель</span><input id="df_goal" type="text" value="' + ((d.goal || '').replace(/"/g, '&quot;')) + '"></label>' +
      pickerField('df_company', 'Компания', '<option value="">— без компании</option>' + companyOpts, 'Поиск по названию компании…') +
      '<label class="fld"><span>Ответственный агент</span><select id="df_agent">' + agentOpts + '</select></label>' +
      '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="df_vat"' + (d.vat ? ' checked' : '') + '> Применяется VAT 5%</label>';
    openModal('Параметры сделки · ' + escAttr(d.title), body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveDeal" data-deal="' + id + '">' + I('check') + 'Сохранить</button>', { wide: true });
  }
  function saveDealEdit(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const g = (k) => { const el = document.getElementById('df_' + k); return el ? el.value : d[k]; };
    const amt = parseInt((g('amount') || '').toString().replace(/\D/g, ''), 10);
    d.amount = amt || d.amount;
    ['dealType', 'objectType', 'readiness', 'saleKind', 'side', 'paymentForm', 'source', 'goal', 'company', 'agent'].forEach((k) => {
      const val = g(k);
      if (k === 'company') d.companyId = val || null;
      else if (k === 'agent') d.agent = val;
      else d[k] = val;
    });
    // The service decides the board and the gate set, so it has to follow the field the agent
    // actually edited. Leaving d.funnel behind kept a re-typed lease on the sale board.
    const nf = funnelForType(d.dealType);
    if (nf !== d.funnel) { d.funnel = nf; d.stage = clampStage(nf, d.stage); }
    d.vat = !!(document.getElementById('df_vat') || {}).checked;
    d.prov = Object.assign({}, d.prov, { budget: 'confirmed', paymentForm: 'confirmed', source: 'confirmed', objectType: 'confirmed', readiness: 'confirmed', saleKind: 'confirmed', side: 'confirmed', goal: 'confirmed' });
    WS.storeApi.touch();
    WS.storeApi.toast('Параметры сделки сохранены и подтверждены', 'ok');
    dealCard(id);
  }

  // ---- Goals edit (profile) ----
  function openGoalEdit(goalId) {
    const u = D().users[S().role];
    const goals = (u && u.goals) || [];
    const g = goals.find((x) => x.id === goalId);
    if (!g) return;
    const metricOpts = ['commission', 'deals', 'pipeline', 'shows', 'leads']
      .map((m) => '<option value="' + m + '"' + (m === g.metric ? ' selected' : '') + '>' + ({ commission: 'Заработанная комиссия', deals: 'Закрытые сделки', pipeline: 'Сумма пайплайна', shows: 'Проведённые показы', leads: 'Новые клиенты' })[m] + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Цель на период. Прогресс считается автоматически из данных демо. Выводить на Пульс — показывает только закреплённые цели.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Цель</span><input id="gf_label" type="text" value="' + ((g.label || '').replace(/"/g, '&quot;')) + '"></label>' +
      '<label class="fld"><span>Метрика</span><select id="gf_metric">' + metricOpts + '</select></label>' +
      '<label class="fld"><span>Целевое значение</span><input id="gf_target" type="number" value="' + (g.target || '') + '"></label>' +
      '<label class="fld"><span>Период</span><select id="gf_period"><option value="month"' + (g.period === 'month' ? ' selected' : '') + '>Месяц</option><option value="quarter"' + (g.period === 'quarter' ? ' selected' : '') + '>Квартал</option></select></label>' +
      '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="gf_pinned"' + (g.pinned ? ' checked' : '') + '> Показывать в Пульсе</label>';
    openModal('Редактировать цель · ' + escAttr(g.label), body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveGoal" data-goal="' + goalId + '">' + I('check') + 'Сохранить</button>');
  }
  function saveGoal(goalId) {
    const u = D().users[S().role];
    const goals = (u && u.goals) || [];
    const g = goals.find((x) => x.id === goalId);
    if (!g) return;
    const gv = (k) => { const el = document.getElementById('gf_' + k); return el ? el.value : g[k]; };
    const target = parseInt(gv('target'), 10);
    if (!gv('label').trim() || !target) { WS.storeApi.toast('Укажите цель и значение', 'warn'); return; }
    g.label = gv('label');
    g.metric = gv('metric');
    g.target = target;
    g.period = gv('period');
    g.pinned = !!(document.getElementById('gf_pinned') || {}).checked;
    closeModal();
    WS.storeApi.toast('Цель сохранена', 'ok');
    WS.storeApi.save(); WS.storeApi.emit();
  }
  function deleteGoal(goalId) {
    const u = D().users[S().role];
    const goals = (u && u.goals) || [];
    const ix = goals.findIndex((x) => x.id === goalId);
    if (ix >= 0) {
      const g = goals[ix];
      openModal('Удалить цель', '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Удалить цель «' + escAttr(g.label) + '»? Действие необратимо.</p>',
        '<button class="btn" data-act="closeModal">Отмена</button><button class="btn danger" data-act="confirmDeleteGoal" data-goal="' + goalId + '">' + I('x') + 'Удалить</button>');
    }
  }
  function confirmDeleteGoal(goalId) {
    const u = D().users[S().role];
    const goals = (u && u.goals) || [];
    const ix = goals.findIndex((x) => x.id === goalId);
    if (ix >= 0) {
      goals.splice(ix, 1);
      closeModal();
      WS.storeApi.toast('Цель удалена', 'ok');
      WS.storeApi.save(); WS.storeApi.emit();
    }
  }
  function addGoal() {
    const u = D().users[S().role];
    if (!u.goals) u.goals = [];
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Добавить новую цель на период. Прогресс считается автоматически.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Цель</span><input id="gf_label" type="text" placeholder="Например: Заработать 300 тыс. комиссии в мае"></label>' +
      '<label class="fld"><span>Метрика</span><select id="gf_metric"><option value="commission">Заработанная комиссия</option><option value="deals">Закрытые сделки</option><option value="pipeline">Сумма пайплайна</option><option value="shows">Проведённые показы</option><option value="leads">Новые клиенты</option></select></label>' +
      '<label class="fld"><span>Целевое значение</span><input id="gf_target" type="number" placeholder="Например: 300000"></label>' +
      '<label class="fld"><span>Период</span><select id="gf_period"><option value="month">Месяц</option><option value="quarter">Квартал</option></select></label>' +
      '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="gf_pinned" checked> Показывать в Пульсе</label>';
    openModal('Добавить цель', body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="createGoal">' + I('plus') + 'Создать</button>');
  }
  function createGoal() {
    const u = D().users[S().role];
    if (!u.goals) u.goals = [];
    const gv = (k) => { const el = document.getElementById('gf_' + k); return el ? el.value : ''; };
    const label = gv('label').trim();
    const target = parseInt(gv('target'), 10);
    if (!label || !target) { WS.storeApi.toast('Укажите цель и значение', 'warn'); return; }
    u.goals.push({
      id: 'g_' + Math.round(performance.now()),
      metric: gv('metric'),
      target: target,
      period: gv('period'),
      label: label,
      pinned: !!(document.getElementById('gf_pinned') || {}).checked,
    });
    closeModal();
    WS.storeApi.toast('Цель добавлена', 'ok');
    WS.storeApi.save(); WS.storeApi.emit();
  }
  // Pin / unpin decides what the Pulse carries — the client asked to configure exactly that.
  function toggleGoalPin(goalId) {
    const u = D().users[S().role];
    const g = ((u && u.goals) || []).find((x) => x.id === goalId);
    if (!g) return;
    g.pinned = !g.pinned;
    WS.storeApi.toast(g.pinned ? 'Цель выведена на Пульс' : 'Цель убрана с Пульса', 'ok');
    WS.storeApi.save(); WS.storeApi.emit();
  }
  // Event types an agent can log by hand (IA §6.2 «Примечания / События»).
  // ch = channel icon bucket; kind 'note' stays editable, logged facts are immutable like channel raw.
  const FEED_TYPES = [
    ['note', 'Примечание', 'note', 'note', 'Напр.: перезвонить после 18:00, интересует вид на воду'],
    ['call', 'Звонок', 'call', 'raw', 'Напр.: звонок 6:10 — согласовали график платежей'],
    ['meet', 'Встреча', 'meet', 'raw', 'Напр.: встреча в офисе — показали две планировки'],
    ['msg', 'Сообщение', 'whatsapp', 'raw', 'Напр.: WhatsApp — прислал требования по планировке'],
    ['mail', 'Письмо', 'email', 'raw', 'Напр.: отправлено КП с тремя объектами'],
    ['task', 'Задача', 'task', 'raw', 'Напр.: подготовить КП к четвергу'],
  ];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  // An event is usually logged after the fact — «вчера созвонились» must land on yesterday,
  // not on the moment the agent typed it. Offsets are relative to the demo day.
  const FEED_WHEN = [['now', 'Сейчас'], ['0', 'Сегодня'], ['1', 'Вчера'], ['2', 'Позавчера'], ['3', '3 дня назад']];
  function feedTypeChips(sel) {
    return '<div class="qa-row" id="fe_types">' + FEED_TYPES.map((t) =>
      '<button type="button" class="chip' + (t[0] === sel ? ' on' : '') + '" data-fetype="' + t[0] + '">' + I(chIcon(t[2])) + t[1] + '</button>').join('') + '</div>';
  }
  // scope: 'deal' | 'contact' | 'company'. One form — the entry lands in that entity's own timeline.
  function feedOwner(scope, id) {
    const data = D();
    if (scope === 'contact') return (data.clients || []).find((x) => x.id === id);
    if (scope === 'company') return (data.companies || []).find((x) => x.id === id);
    if (scope === 'request') return (data.requests || []).find((x) => x.id === id);
    return (data.deals || []).find((x) => x.id === id);
  }
  function openEventForm(scope, id) {
    const ent = feedOwner(scope, id);
    if (!ent) return;
    const title = ent.name || ent.title;
    S().feedType = 'note';
    const hhmm = String(NOW.h).padStart(2, '0') + ':' + String(NOW.mi).padStart(2, '0');
    openModal('Событие · ' + title,
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Примечание правится и удаляется. Звонок, встреча, сообщение и задача записываются как факт — как сырьё канала.</p>' +
      '<label class="fld"><span>Тип события</span></label>' + feedTypeChips('note') +
      '<div class="form-grid" style="margin-top:10px">' +
      '<label class="fld"><span>Когда</span><select id="fe_day">' +
      FEED_WHEN.map((w) => '<option value="' + w[0] + '">' + w[1] + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Время</span><input id="fe_time" type="time" value="' + hhmm + '"></label></div>' +
      '<label class="fld" style="margin-top:10px"><span>Описание</span><textarea id="note_txt" rows="3" placeholder="' + escAttr(FEED_TYPES[0][4]) + '"></textarea></label>',
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveEventEntry" data-scope="' + scope + '" data-eid="' + escAttr(id) + '">' + I('check') + 'Добавить</button>');
  }
  // Chip selection lives in store state so the modal survives a re-render.
  function setFeedType(t) {
    S().feedType = t;
    const box = document.getElementById('fe_types');
    if (box) box.querySelectorAll('[data-fetype]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-fetype') === t));
    const ta = document.getElementById('note_txt');
    const spec = FEED_TYPES.find((x) => x[0] === t);
    if (ta && spec) ta.setAttribute('placeholder', spec[4]);
  }
  // Which timeline a scope writes into. One place, so callers can't disagree.
  // The request grew its own timeline and the card renders it, but the headless
  // write path did not know the scope existed — so a note the Concierge was
  // asked to file against a заявка was refused as an unknown entity.
  const TIMELINE_KEY = { contact: 'contactTimeline', company: 'companyTimeline', deal: 'dealTimeline', request: 'requestTimeline' };
  function timelineFor(scope) {
    const data = D(); const key = TIMELINE_KEY[scope];
    if (!key) return null;
    return (data[key] = data[key] || {});
  }
  // Headless core of "add an event to a feed" — no DOM, so the Concierge can drive it too.
  // when: 'now' | { daysAgo: 0..N, h, mi }. Returns the stored entry, or null if the input is
  // not valid (unknown scope / unknown entity / empty text) — never writes a half-formed record.
  let taskSeq = 0;   // ids for tasks the Concierge creates; stable within a session
  /* ---- Факт контакта и итог контакта (§2.2 и §7.1 решений) ----
     Факт — «позвонили, написали, встретились» — наблюдаемое событие: пишется сразу, модель
     здесь не ошибается. Итог — «о чём договорились» — модель додумывает, и её догадка иначе
     ляжет в историю как факт, на который потом обопрётся другой ответ.

     Поэтому машинный итог НЕ кладётся в ленту. Он живёт отдельным списком и попадает в ленту
     только подтверждённым. Это не придирка к форме: правило «неподтверждённый итог не участвует
     ни в одном выводе» иначе пришлось бы помнить в тринадцати местах, которые читают ленту, —
     а так оно выполняется само, потому что читать нечего.

     Итог, который набрал человек, сразу подтверждён: подтверждать нечего, это первоисточник. */
  /* ---- Итог при закрытии задачи (§3.2 решений) ----
     Форма из двух полей: что вышло и следующий шаг. Закрыть БЕЗ комментария можно — обязательное
     поле здесь прямой путь к тому, что агент перестанет закрывать задачи вовсе, и мы потеряем
     и комментарий, и сам факт закрытия. Комментарий пишется в ленту как итог в состоянии
     «подтверждён»: его написал человек, а не модель, и подтверждать нечего. */
  function taskDoneForm(taskId) {
    const t = (D().tasks || []).find((x) => x.id === taskId); if (!t) return;
    const next = t.dealId ? 'Согласовать следующий шаг по сделке' : (t.requestId ? 'Вернуться к подбору' : 'Назначить следующее касание');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Закрыть можно и без комментария — тогда останется только факт выполнения. Что напишете здесь, ляжет в ленту как итог от вас.</p>' +
      '<div class="match-grid"><label class="fld"><span>Что вышло</span><input id="td_out" type="text" placeholder="Напр.: договорились о брони до пятницы"></label>' +
      '<label class="fld"><span>Следующий шаг</span><input id="td_next" type="text" value="' + escAttr(next) + '"></label></div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="td_mk" checked> Поставить следующий шаг задачей</label>';
    openModal('Выполнить · ' + escAttr(t.title), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="saveTaskDone" data-task="' + taskId + '">' + I('check') + 'Выполнить</button>');
  }
  function saveTaskDone(taskId) {
    const t = (D().tasks || []).find((x) => x.id === taskId); if (!t) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const out = g('td_out'), next = g('td_next');
    const mk = !!(document.getElementById('td_mk') || {}).checked;
    t.outcome = out || undefined;
    WS.storeApi.taskAction(taskId, 'done');
    const scope = t.dealId ? ['deal', t.dealId] : (t.requestId ? ['request', t.requestId] : (t.clientId ? ['contact', t.clientId] : null));
    if (out && scope) {
      const e = addEventEntry(scope[0], scope[1], { type: 'note', text: 'Итог: ' + out });
      if (e) { e.role = 'outcome'; e.state = 'confirmed'; }
    }
    if (mk && next) {
      WS.storeApi.addTask({ id: 'tk_next_' + taskId, title: next, clientId: t.clientId,
        dealId: t.dealId, requestId: t.requestId, contractId: t.contractId, due: 'завтра', when: 'tomorrow', kind: 'manual' });
    }
    closeModal();
    WS.storeApi.toast('Задача выполнена' + (out ? ' · итог записан' : ''), 'ok');
  }

  function outcomesFor(scope, id) {
    return (D().outcomes || []).filter((x) => x.scope === scope && x.entityId === id);
  }
  function addOutcomeDraft(scope, id, opts) {
    const o = opts || {};
    const txt = String(o.text == null ? '' : o.text).trim();
    if (!txt || !feedOwner(scope, id)) return null;
    const rec = { id: 'oc_' + scope + '_' + id + '_' + ((D().outcomes || []).length + 1),
      scope: scope, entityId: id, factId: o.factId || null, text: txt,
      by: o.by || 'Консьерж', at: 'сейчас', ord: NOW_ORD + 1, state: 'draft' };
    (D().outcomes || (D().outcomes = [])).push(rec);
    WS.storeApi.touch();
    return rec;
  }
  function confirmOutcome(oid) {
    const rec = (D().outcomes || []).find((x) => x.id === oid); if (!rec) return;
    D().outcomes = (D().outcomes || []).filter((x) => x !== rec);
    const e = addEventEntry(rec.scope, rec.entityId, { type: 'note', text: rec.text, by: rec.by });
    if (e) { e.role = 'outcome'; e.state = 'confirmed'; e.factId = rec.factId; }
    WS.storeApi.touch();
    WS.storeApi.toast('Итог подтверждён — теперь он участвует в выводах', 'ok');
  }
  function rejectOutcome(oid) {
    const rec = (D().outcomes || []).find((x) => x.id === oid); if (!rec) return;
    // Отклонённый черновик остаётся со следом отклонения: иначе непонятно, почему Консьерж
    // больше не предлагает то, что предлагал вчера.
    rec.state = 'rejected';
    WS.storeApi.touch();
    WS.storeApi.toast('Итог отклонён — след остался в ленте');
  }
  function outcomeRow(rec) {
    const acts = rec.state === 'draft'
      ? '<div class="rel-acts"><button class="btn xs primary" data-ocok="' + rec.id + '">' + I('check') + 'Подтвердить</button>' +
        '<button class="tl-ic-btn" data-ocno="' + rec.id + '" title="Отклонить итог">' + I('x') + '</button></div>'
      : '<span class="rel-tag stop">отклонён</span>';
    return '<div class="evc ai oc-' + rec.state + '">' +
      '<div class="evc-top"><span class="evc-ic ai">' + I('sparkle') + '</span>' +
      '<span class="evc-name">Итог разговора · ' + (rec.state === 'draft' ? 'черновик' : 'отклонён') + '</span>' +
      '<span class="evc-by ai">' + I('sparkle') + escAttr(rec.by) + '<i>AI-агент</i></span>' +
      '<span class="evc-when">' + escAttr(rec.at) + '</span></div>' +
      '<div class="evc-text">' + escAttr(rec.text) + '</div>' +
      '<div class="evc-tags"><span class="tl-src">' + I('lock') + 'не участвует в выводах, пока не подтверждён</span>' + acts + '</div></div>';
  }
  function outcomesBlock(scope, id) {
    const list = outcomesFor(scope, id);
    return list.length ? list.map(outcomeRow).join('') : '';
  }
  function addEventEntry(scope, id, opts) {
    const o = opts || {};
    const txt = String(o.text == null ? '' : o.text).trim();
    if (!txt) return null;
    const bag = timelineFor(scope);
    if (!bag) return null;
    const owner = feedOwner(scope, id);
    if (!owner) return null;                         // refuse to write against an unknown id
    // An unrecognised type is a mistake on the caller's side. Quietly filing it as a note
    // would hide that from whoever asked, so refuse instead.
    const spec = o.type ? FEED_TYPES.find((x) => x[0] === o.type) : FEED_TYPES[0];
    if (!spec) return null;
    const who = o.by || (D().users[WS.store.role] || {}).name || 'Агент';
    const list = (bag[id] = bag[id] || []);
    const when = o.when || 'now';
    let at, ord;
    if (when === 'now') {
      // Every feed sorts on `ord` (newest first), so a "сейчас" entry has to out-rank the newest
      // entry already in this timeline to land at the very top.
      at = 'сейчас';
      ord = list.reduce((m, e) => (e.ord != null && e.ord > m ? e.ord : m), NOW_ORD) + 1;
    } else {
      const h = when.h != null ? +when.h : NOW.h;
      const mi = when.mi != null ? +when.mi : NOW.mi;
      const day = Math.max(1, NOW.d - (parseInt(when.daysAgo, 10) || 0));
      at = String(day).padStart(2, '0') + ' ' + MONTHS_GEN[NOW.mo - 1] + ' · ' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
      ord = ORD(day, h, mi);
    }
    // Keep the stored array chronological even for back-dated entries: rendering sorts anyway, but
    // an ordered array keeps the audit trail readable and `_ci` addressing intuitive.
    const entry = { at: at, ord: ord, ch: spec[2], kind: spec[3], by: who, text: txt };
    let pos = list.length;
    while (pos > 0 && list[pos - 1].ord != null && list[pos - 1].ord > ord) pos--;
    list.splice(pos, 0, entry);
    WS.store.dataRevision++;
    WS.storeApi.save(); // direct data mutation — persist it, F5 must not drop the entry
    // A task is a commitment, not a line in a feed. Recording only the feed entry would
    // let an answer claim the task exists while Задачи stays empty — the kind of gap a
    // person discovers after the meeting, not during it.
    if (spec[0] === 'task') {
      entry.taskId = 't_cg_' + (++taskSeq);
      WS.storeApi.addTask({
        id: entry.taskId,
        clientId: scope === 'contact' ? id : (owner.clientId || null),
        // Область задачи — та же, в чью ленту пишем. Без неё у двух сделок одного клиента
        // оказывался общий список задач, и «ближайшая задача по сделке» лгала.
        dealId: scope === 'deal' ? id : null,
        requestId: scope === 'request' ? id : null,
        title: txt,
        due: o.due || 'сегодня',
        when: o.dueWhen || 'today',
        kind: 'manual',
      });
    }
    return entry;
  }
  // DOM adapter: reads the modal's fields and delegates. Behaviour is unchanged.
  function saveEventEntry(scope, id) {
    const el = document.getElementById('note_txt'); const txt = el ? el.value.trim() : '';
    const t = S().feedType || 'note';
    const spec = FEED_TYPES.find((x) => x[0] === t) || FEED_TYPES[0];
    if (!txt) { closeModal(); return; }
    const dayEl = document.getElementById('fe_day');
    const timeEl = document.getElementById('fe_time');
    const dayVal = dayEl ? dayEl.value : 'now';
    let when = 'now';
    if (dayVal !== 'now') {
      const tm = (timeEl && timeEl.value ? timeEl.value : '').match(/^(\d{1,2}):(\d{2})$/);
      when = { daysAgo: parseInt(dayVal, 10) || 0, h: tm ? +tm[1] : NOW.h, mi: tm ? +tm[2] : NOW.mi };
    }
    if (!addEventEntry(scope, id, { type: t, text: txt, when: when })) { closeModal(); return; }
    WS.storeApi.toast(spec[1] + ' добавлено в ленту', 'ok');
    if (scope === 'contact') clientCard(id);
    else if (scope === 'company') companyCard(id);
    else dealCard(id);
  }

  // ---------------- OBJECTS & CLUB ----------------
  // Single source of truth for object filtering — scales to large inventories via
  // dropdown selects + ranges (no chip-per-value), reused by view + live refresh.
  const PRICE_BUCKETS = [['all', 'Любая цена'], ['lo', 'до 1,7 млн'], ['mid', '1,7–2,2 млн'], ['hi', 'от 2,2 млн']];
  function inPriceBucket(p, b) {
    return b === 'all' || (b === 'lo' && p < 1700000) || (b === 'mid' && p >= 1700000 && p <= 2200000) || (b === 'hi' && p > 2200000);
  }
  // Listing intent (demo classification, no persisted field): purchase vs rental inventory.
  const OBJ_PURPOSE = { o_creekline: 'sale', o_palmcourt: 'sale', o_bayline: 'rent' };
  function objPurpose(o) { return OBJ_PURPOSE[o.id] || 'sale'; }
  function filteredObjects() {
    const st = S(); const filt = st.objFilter || 'all'; const area = st.objArea || 'all';
    const q = (st.objSearch || '').toLowerCase(); const sort = st.objSort || 'default';
    const br = st.objBr || 'all'; const price = st.objPrice || 'all'; const purpose = st.objPurpose || 'all';
    let objs = D().objects.filter((o) => (filt === 'all' || o.source === filt) && (area === 'all' || o.area === area) &&
      (br === 'all' || o.br === br) && inPriceBucket(o.price, price) && (purpose === 'all' || objPurpose(o) === purpose) &&
      (!q || o.name.toLowerCase().includes(q) || o.area.toLowerCase().includes(q)));
    if (sort === 'price_asc') objs = objs.slice().sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') objs = objs.slice().sort((a, b) => b.price - a.price);
    else if (sort === 'yield') objs = objs.slice().sort((a, b) => objNetYield(b) - objNetYield(a));
    else if (sort === 'fresh') objs = objs.slice().sort((a, b) => (a.verified === 'verified' ? 0 : 1) - (b.verified === 'verified' ? 0 : 1));
    return objs;
  }
  function miniSel(id, cur, opts) {
    return '<select id="' + id + '" class="mini-sel">' + opts.map(([v, l]) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  }
  function viewObjects() {
    const st = S();
    const filt = st.objFilter || 'all';
    const srcChips = [['all', 'Все', 'grid'], ['agency', 'Агентство', 'briefcase'], ['club', 'Клуб', 'star'], ['import', 'Импорт', 'download']]
      .map(([k, l, ic]) => '<button class="chip ' + (filt === k ? 'mut' : '') + '" data-objfilter="' + k + '"' + (filt === k ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + I(ic) + l + '</button>').join('');
    // dropdown filters scale to thousands of objects (no chip-per-value)
    const areaOpts = [['all', 'Любой район']].concat(Array.from(new Set(D().objects.map((o) => o.area))).map((a) => [a, a]));
    const brOpts = [['all', 'Любой тип']].concat(Array.from(new Set(D().objects.map((o) => o.br))).map((b) => [b, b]));
    const areaSel = miniSel('objArea', st.objArea || 'all', areaOpts);
    const brSel = miniSel('objBr', st.objBr || 'all', brOpts);
    const priceSel = miniSel('objPrice', st.objPrice || 'all', PRICE_BUCKETS);
    const sortSel = miniSel('objSort', st.objSort || 'default', [['default', 'по умолчанию'], ['price_asc', 'цена ↑'], ['price_desc', 'цена ↓'], ['yield', 'доходность ↓'], ['fresh', 'свежесть проверки']]);
    const objs = filteredObjects();
    const cards = objs.map(objRow).join('') || '<div class="empty">' + I('search') + '<div>Под фильтры ничего не найдено — ослабьте условия</div></div>';
    const slCount = (st.shortlist || []).length;
    const slBtn = slCount ? '<button class="btn sm" data-nav="calc">' + I('star') + 'В подборке: ' + slCount + '</button>' : '';
    return head('Объекты и клуб', 'Собственный инвентарь, клубные эксклюзивы и импорт. Фильтры (район, тип, цена) — выпадающими списками, чтобы масштабироваться на тысячи объектов; поиск и сортировка рядом. «В подборку» добавляет объект в подбор под клиента.',
      slBtn + '<button class="btn sm" data-act="importObjects" title="Загрузить объекты из CSV/фида">' + I('download') + 'Импорт</button>' +
      '<button class="btn sm primary" data-act="newObject">' + I('plus') + 'Создать объект</button>') +
      '<div class="obj-toolbar"><div class="prompt obj-search"><span class="ico">' + I('search') + '</span><input id="objSearch" placeholder="Поиск по названию или району…" autocomplete="off" value="' + (st.objSearch || '') + '"></div>' + areaSel + brSel + priceSel + sortSel + '</div>' +
      '<div class="qa-row" style="margin-bottom:16px;align-items:center">' +
      '<div class="seg">' + [['all', 'Все'], ['sale', 'Покупка'], ['rent', 'Аренда']].map(([k, l]) => '<button class="' + ((st.objPurpose || 'all') === k ? 'on' : '') + '" data-objpurpose="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<span class="df-sep"></span>' + srcChips + '</div>' +
      '<div class="obj-count section-label" style="margin-bottom:8px">Найдено: ' + objs.length + ' из ' + D().objects.length + '</div>' +
      '<div class="obj-list">' + cards + '</div>';
  }
  // List search + filter controls repaint their own subtree, the way bindObjects/refreshObjects do.
  function bindListSearch() {
    const wire = (id, key, refresh) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', (e) => { S()[key] = e.target.value; refresh(); });
    };
    wire('contactsSearch', 'contactsSearch', refreshContacts);
    wire('companiesSearch', 'companiesSearch', refreshCompanies);
    wire('conciergeSearch', 'conciergeSearch', refreshCgRail);
    const sel = (id, apply) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', (e) => apply(e.target.value));
    };
    // Каждый фильтр списка клиентов пишет в своё поле — по одной строке на измерение, чтобы
    // добавленный фильтр без обработчика (селект, который ничего не делает) было видно сразу.
    [['cfPsych', 'psych'], ['cfObject', 'object'], ['cfArea', 'area'],
     ['cfBudget', 'budget'], ['cfState', 'state'], ['cfConsent', 'consent'],
     ['cfKind', 'kind'], ['cfInterest', 'interest'], ['cfObjType', 'objType'],
     ['cfSuccess', 'success'], ['cfChannel', 'channel']].forEach((p) =>
      sel(p[0], (v) => { const patch = {}; patch[p[1]] = v; S().contactsFilters = Object.assign({}, S().contactsFilters, patch); WS.storeApi.emit(); }));
    ['dealObjType', 'dealReadiness', 'dealAgent', 'dealSrc', 'dealStage'].forEach((k) =>
      sel(k, (v) => { S()[k] = v; WS.storeApi.emit(); }));
    sel('cofClient', (v) => { S().companiesFilters = Object.assign({}, S().companiesFilters, { client: v }); WS.storeApi.emit(); });
  }
  function bindObjects() {
    const s = document.getElementById('objSearch');
    if (s) s.addEventListener('input', (e) => { S().objSearch = e.target.value; refreshObjects(); });
    [['objArea', 'objArea'], ['objBr', 'objBr'], ['objPrice', 'objPrice'], ['objSort', 'objSort']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', (e) => { S()[key] = e.target.value; refreshObjects(); });
    });
  }
  function refreshObjects() {
    const grid = document.querySelector('.obj-list'); if (!grid) return;
    const objs = filteredObjects();
    grid.innerHTML = objs.map(objRow).join('') || '<div class="empty">' + I('search') + '<div>Под фильтры ничего не найдено — ослабьте условия</div></div>';
    const cnt = document.querySelector('.obj-count');
    if (cnt) cnt.textContent = 'Найдено: ' + objs.length + ' из ' + D().objects.length;
  }
  // offline "photo" placeholder — architectural render look, per-area palette
  function photoStyle(o) {
    const pal = {
      'Business Bay': ['#2b4a6b', '#5c86b0'], 'JVC': ['#6b4a2b', '#c79a5c'],
      'Dubai Creek Harbour': ['#7a3f52', '#d98a6a'], 'Downtown': ['#3f3a6b', '#8a7ad0'],
    };
    const g = pal[o.area] || ['#3a4550', '#7d8a97'];
    return 'background:linear-gradient(155deg,' + g[0] + ',' + g[1] + ')';
  }
  // offline building silhouette (skyline with lit windows) over the sky gradient
  function buildingSvg(o) {
    const seeds = { o_creekline: 0, o_palmcourt: 1, o_bayline: 2 };
    const layouts = [
      [[10, 34, 0.88], [48, 26, 0.58], [78, 42, 0.98]],
      [[6, 42, 0.7], [52, 30, 0.98], [88, 26, 0.52]],
      [[12, 28, 0.92], [44, 46, 0.64], [94, 24, 0.82]],
    ];
    const s = seeds[o.id] != null ? seeds[o.id] : 0;
    const towers = layouts[s % layouts.length];
    const W = 140, H = 90;
    let body = '';
    towers.forEach((t) => {
      const x = t[0], w = t[1], h = Math.round(H * t[2]), y = H - h;
      body += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2" fill="rgba(18,14,10,0.46)"/>';
      for (let wy = y + 6; wy < H - 4; wy += 8) {
        for (let wx = x + 4; wx < x + w - 3; wx += 7) {
          const lit = (wx * 3 + wy) % 5 < 2;
          body += '<rect x="' + wx + '" y="' + wy + '" width="3" height="4" rx="0.6" fill="' + (lit ? 'rgba(255,212,150,.6)' : 'rgba(255,255,255,.14)') + '"/>';
        }
      }
    });
    return '<svg class="skyline" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' + body + '</svg>';
  }
  function objCard(o) {
    const vb = o.verified === 'verified'
      ? '<span class="badge ok">' + I('check') + 'Проверено · ' + o.checkedAt + '</span>'
      : '<span class="badge warn">' + I('warn') + 'Проверка истекла · ' + o.checkedAt + '</span>';
    const tk = o.trakheesi === 'ok' ? '<span class="badge ok">' + I('shield') + 'Trakheesi' + '</span>' : '<span class="badge warn">' + I('clock') + 'Trakheesi в процессе</span>';
    const md = o.madmoun === 'ok' ? '<span class="badge ok">' + I('qr') + 'Madmoun QR' + '</span>' : '<span class="badge">' + I('qr') + 'Madmoun n/a</span>';
    const src = '<span class="badge acc">' + I(o.source === 'club' ? 'star' : o.source === 'import' ? 'download' : 'briefcase') + o.sourceLabel + '</span>';
    const queued = o.queued ? '<span class="badge warn">' + I('clock') + 'В ручной очереди (S9)</span>' : '';
    const isNew = o._new ? '<span class="badge acc">' + I('sparkle') + 'новое · импорт</span>' : '';
    // always a real photo: object's own, else a sensible real default (never a synthetic render)
    const photoSrc = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
    const photo = photoSrc ? '<img class="ophoto" src="' + photoSrc + '" alt="" loading="lazy">' : buildingSvg(o);
    return '<div class="obj-card' + (o._new ? ' is-new' : '') + '" data-obj="' + o.id + '"><div class="obj-photo gen" style="' + photoStyle(o) + '">' + photo +
      '<span class="demo-wm badge demo">' + I('lock') + 'DEMO фото</span>' +
      '<span class="photo-cap">' + o.area + '</span><span class="price">' + WS.AED(o.price) + '</span></div>' +
      '<div class="obj-body"><div class="ot">' + o.name + '</div><div class="om">' + o.area + ' · ' + o.br + ' · ' + o.size + ' м²</div>' +
      '<div class="obadges">' + isNew + src + vb + tk + md + queued + '</div>' +
      '<div class="match">' + I('target') + '<span>' + o.match + '</span></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" data-fin="' + o.id + '">' + I('money') + 'Доходность</button>' +
      (inShortlist(o.id) ? '<button class="btn sm" data-shortlist="' + o.id + '" style="border-color:var(--acc-line);background:var(--acc-soft);color:var(--acc-ink)">' + I('check') + 'В подборке</button>'
        : '<button class="btn sm" data-shortlist="' + o.id + '">' + I('star') + 'В подборку</button>') + '</div></div></div>';
  }
  // Wide "row" object layout (old-CRM style): large & scannable — big title, big
  // stat line (price · per m² · area), source tag, description, field grid, statuses, actions, large photo.
  function objRow(o) {
    const vb = o.verified === 'verified'
      ? '<span class="badge ok">' + I('check') + 'Проверено · ' + o.checkedAt + '</span>'
      : '<span class="badge warn">' + I('warn') + 'Проверка истекла · ' + o.checkedAt + '</span>';
    const tk = o.trakheesi === 'ok' ? '<span class="badge ok">' + I('shield') + 'Trakheesi</span>' : '<span class="badge warn">' + I('clock') + 'Trakheesi в процессе</span>';
    const md = o.madmoun === 'ok' ? '<span class="badge ok">' + I('qr') + 'Madmoun QR</span>' : '<span class="badge">' + I('qr') + 'Madmoun n/a</span>';
    const src = '<span class="badge acc">' + I(o.source === 'club' ? 'star' : o.source === 'import' ? 'download' : 'briefcase') + o.sourceLabel + '</span>';
    const perM2 = WS.AED(Math.round(o.price / o.size)) + '/м²';
    const photoSrc = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
    const photo = photoSrc ? '<img class="ophoto" src="' + photoSrc + '" alt="" loading="lazy">' : buildingSvg(o);
    const pubBtn = o.verified === 'verified'
      ? '<button class="btn sm ghost" data-obj="' + o.id + '">' + I('eye') + 'Опубликован на сайте</button>'
      : '<button class="btn sm" data-scn="S9">' + I('replay') + 'Проверить доступность (S9)</button>';
    const inSl = inShortlist(o.id);
    const ofield = (k, v) => '<div class="ofield"><div class="ofk">' + k + '</div><div class="ofv">' + v + '</div></div>';
    return '<div class="obj-row' + (o._new ? ' is-new' : '') + '" data-obj="' + o.id + '">' +
      '<div class="obj-row__main">' +
        '<div class="obj-row__head"><div class="obj-row__title">' + o.name + '<span class="obj-class">' + o.br + '</span></div>' + pubBtn + '</div>' +
        '<div class="obj-row__stats">' +
          '<div class="ost"><span class="osv">' + WS.AED(o.price) + '</span><span class="osl">цена</span></div>' +
          '<div class="ost"><span class="osv">' + perM2 + '</span><span class="osl">за м²</span></div>' +
          '<div class="ost"><span class="osv">' + o.size + ' м²</span><span class="osl">площадь</span></div>' +
        '</div>' +
        '<div class="obj-row__tags">' + src + '</div>' +
        '<div class="obj-row__desc">' + o.match + '</div>' +
        '<div class="obj-row__fields">' + ofield('Район', o.area) + ofield('Тип', o.br + ' · ' + o.size + ' м²') + ofield('Метро', o.attrs && o.attrs.metro ? 'рядом' : '—') + '</div>' +
        '<div class="obj-row__badges">' + vb + tk + md + '</div>' +
        '<div class="obj-row__acts">' +
          '<button class="btn sm" data-fin="' + o.id + '">' + I('money') + 'Доходность</button>' +
          '<button class="btn sm" data-valobj="' + o.id + '">' + I('calc') + 'Оценить</button>' +
          '<button class="btn sm" data-promo="' + o.id + '">' + I('trend') + 'Продвижение</button>' +
          (inSl ? '<button class="btn sm" data-shortlist="' + o.id + '" style="border-color:var(--acc-line);background:var(--acc-soft);color:var(--acc-ink)">' + I('check') + 'В подборке</button>'
                : '<button class="btn sm" data-shortlist="' + o.id + '">' + I('star') + 'В подборку</button>') +
          '<button class="btn sm" data-obj="' + o.id + '">' + I('doc') + 'Документы</button>' +
          '<button class="btn sm" data-thread="object:' + o.id + '" data-tlabel="' + o.name + ' · объект" data-ticon="building">' + I('chat') + 'Чат по объекту</button>' +
        '</div>' +
      '</div>' +
      '<div class="obj-row__media obj-photo gen" style="' + photoStyle(o) + '">' + photo +
        '<span class="demo-wm badge demo">' + I('lock') + 'DEMO фото</span>' +
        '<span class="photo-cap">' + o.area + '</span></div>' +
    '</div>';
  }
  function inShortlist(id) { return (S().shortlist || []).indexOf(id) >= 0; }
  // ---- Object card v3: rich presentation (photo gallery hero, price anchor, full meta) — parity with old grey CRM ----
  const OBJ_ATTR = {
    view: { city: 'Город', water: 'Вид на воду', garden: 'Сад', park: 'Парк' },
    finish: { new: 'Свежая отделка', standard: 'Стандартная', 'shell&core': 'Shell & Core', shell: 'Shell & Core' },
    demand: { high: 'Высокий спрос', mid: 'Средний спрос', low: 'Низкий спрос' },
    prestige: { high: 'Премиум', mid: 'Средний', low: 'Эконом' },
  };
  function objAttr(o, k) { const v = o.attrs && o.attrs[k]; if (v == null || v === '') return '—'; const m = OBJ_ATTR[k]; return (m && m[v]) || v; }
  // «Этаж: высокий» is an adjective in the place of a fact. The storey is a number; the band it
  // falls into is kept separately, for filtering, and stated as a hint rather than as the value.
  const VIEW_PHRASE = { city: 'на город', water: 'на воду', garden: 'в сад', park: 'на парк' };
  function objFloor(o) {
    const a = o.attrs || {};
    if (typeof a.floor !== 'number') return '—';
    return a.floor + (a.floors ? ' из ' + a.floors : '') + ' эт.';
  }
  const SQFT = 10.7639;              // м² → фт², чтобы читать service charge в тех же единицах, в каких он продаётся
  function ru(n) { return String(n).replace('.', ','); }
  function objIsOff(o) { return /off-plan|оффплан/i.test(o.segment || ''); }
  function objPerM2(o) { return o.size ? Math.round(o.price / o.size) : null; }
  function objMarket(o) { return (WS.AREAS || {})[o.area] || null; }
  // Отклонение цены объекта от средней по району, в процентах. Знак несёт смысл: минус — аргумент,
  // плюс — возражение, которое всё равно прозвучит, поэтому ответ на него готовится заранее.
  function objPriceGap(o) {
    const m = objMarket(o), pm = objPerM2(o);
    if (!m || !pm || !m.perM2) return null;
    return Math.round((pm / m.perM2 - 1) * 100);
  }
  // Service charge продаётся за фт² в год — клиент спрашивает, сколько это в год деньгами.
  function objServiceYear(o) {
    const m = /([\d.,]+)\s*AED\/\s*фт/.exec(o.serviceCharge || '');
    if (!m || !o.size) return null;
    return Math.round(parseFloat(m[1].replace(',', '.')) * o.size * SQFT);
  }
  // Net yield, guarded: the finance model can miss, and a card must not fall over because of it.
  function objYieldPct(o) {
    try { const y = objNetYield(o); return (typeof y === 'number' && isFinite(y)) ? Math.round(y * 1000) / 10 : null; }
    catch (e) { return null; }
  }
  // ============================================================================================
  // Справка по объекту — the one block that says what the rows cannot: what this thing IS as an
  // offer, whom it suits and for what, and where it is weak. Same voice as the client brief:
  // connected sentences built from the object's own fields, nothing invented.
  // ============================================================================================
  function objBriefParts(o) {
    const a = o.attrs || {};
    const out = [];
    const off = objIsOff(o);

    // 1. What it is, in one line: type, size, where, which floor, what you see out of the window.
    let one = (o.br || 'объект') + ' ' + (o.size ? o.size + ' м² ' : '') + 'в районе ' + o.area;
    if (typeof a.floor === 'number') one += ', ' + a.floor + '-й этаж';
    const view = VIEW_PHRASE[(o.attrs || {}).view];
    if (view) one += ', вид ' + view;
    out.push(one + '.');

    // 2. How it is sold — the thing that decides whether a buyer can even consider it.
    const terms = [];
    if (off) {
      terms.push('оффплан' + (o.developer ? ' от ' + o.developer : ''));
      if (o.handover) terms.push('сдача ' + o.handover);
      if (o.paymentPlan) terms.push('рассрочка ' + o.paymentPlan.replace(/\s*·\s*/g, ' / '));
    } else {
      terms.push('готовый' + (o.occupancy ? ', заселение — ' + lowerFirst(o.occupancy) : ''));
      if (o.serviceCharge) terms.push('service charge ' + o.serviceCharge);
    }
    // «и» binds two things of a kind; a status and a service charge are not that, so a ready
    // object lists them, while an off-plan's terms genuinely read as one enumeration.
    if (terms.length) out.push(capFirst(off ? joinRu(terms) : terms.join('; ')) + '.');

    // 3. Комиссия — единственная цифра из денег, которой нет в полосе метрик над справкой.
    const y = objYieldPct(o);
    if (o.commissionPct) out.push('Комиссия агенту ' + ru(o.commissionPct) + '% — ' + WS.AED(Math.round(o.price * o.commissionPct / 100)) + '.');

    // 4. Whom it suits — read off demand, prestige, yield and the payment terms.
    const fit = [];
    if (off) fit.push('инвестору, который готов ждать сдачи ради цены входа');
    if (y && y >= 5) fit.push('покупателю под аренду');
    if (a.prestige === 'high') fit.push('клиенту, которому важен адрес');
    // «Въезжает сразу» верно только для свободного объекта: сданный занят арендатором до конца срока.
    if (!off && a.finish === 'new' && /vacant|свободн/i.test(o.occupancy || '')) fit.push('тому, кто въезжает сразу');
    if (!off && /сдан|аренд/i.test(o.occupancy || '')) fit.push('покупателю с горизонтом от двух лет — объект занят до конца договора');
    

    // 5. And where it does not fit. A brief that only sells is not a brief.
    const against = [];
    if (off) against.push('тем, кому нужен доход сейчас');
    if (a.metro === false) against.push('тем, кто ездит на метро');
    if (a.demand === 'mid' || a.demand === 'low') against.push('тем, кто рассчитывает на быструю перепродажу');
    return { text: out, fit: fit, against: against };
  }
  function objBriefSentences(o) {
    const b = objBriefParts(o);
    return b.text.concat(b.fit.length ? ['Подходит ' + joinRu(b.fit) + '.'] : [],
                         b.against.length ? ['Не подойдёт ' + joinRu(b.against) + '.'] : []);
  }
  function objBriefBlock(o) {
    const b = objBriefParts(o);
    const verdict = (b.fit.length || b.against.length)
      ? '<div class="chg-list obj-fit">' +
        (b.fit.length ? '<div class="chg-row">' + I('check') + '<span><b>Подходит</b> ' + joinRu(b.fit) + '</span></div>' : '') +
        (b.against.length ? '<div class="chg-row off">' + I('warn') + '<span><b>Не подойдёт</b> ' + joinRu(b.against) + '</span></div>' : '') +
        '</div>' : '';
    return dxSec('sparkle', 'Справка по объекту', '<span class="badge ai-b">' + I('sparkle') + 'собрано AI</span>',
      '<p class="deal-brief">' + b.text.join(' ') + '</p>' + verdict);
  }
  // ============================================================================================
  // Чем продавать. Не список свойств — список утверждений, каждое с цифрой под ним: тезис агент
  // произносит вслух, подпись — то, чем он его подтверждает, если клиент переспросит. Порядок —
  // от того, что уникально для этого юнита, к общему по району.
  // ============================================================================================
  function objSellPoints(o) {
    const a = o.attrs || {}, mk = objMarket(o), off = objIsOff(o);
    const pm = objPerM2(o), gap = objPriceGap(o), y = objYieldPct(o);
    const out = [];
    if (o.usp) out.push(['star', 'Чего нет у соседних юнитов', o.usp]);
    if (gap != null && gap <= -2) out.push(['money', 'На ' + Math.abs(gap) + '% дешевле района',
      WS.AED(pm) + ' за м² против средней по ' + o.area + ' — ' + WS.AED(mk.perM2) + ' за 12 месяцев.']);
    if (mk && y != null && y >= mk.yieldTypical) out.push(['wallet', 'Доходность выше типичной по району',
      ru(y) + '% против ' + ru(mk.yieldTypical) + '% по ' + o.area + '. Считано по одной модели, цифры сравнимы.']);
    if (mk && mk.priceYoY >= 8) out.push(['trend', 'Район прибавил ' + mk.priceYoY + '% за год',
      'Аренда за тот же период +' + mk.rentYoY + '%. ' + mk.driver]);
    if (off && o.paymentPlan) out.push(['calc', 'Вход рассрочкой, а не всей суммой',
      o.paymentPlan.replace(/\s*·\s*/g, ' · ') + (o.handover ? '. Ключи ' + o.handover + '.' : '.')]);
    if (o.escrow) out.push(['shield', 'Деньги идут на эскроу, не застройщику',
      o.escrow + '. Это первый ответ на «а если стройка встанет».']);
    if (!off && /vacant|свободн/i.test(o.occupancy || '')) out.push(['clock', 'Доход с первого месяца',
      'Юнит свободен — заезд арендатора не ждёт окончания чужого договора.']);
    if (a.metro) out.push(['compass', 'Метро в пешей доступности',
      'Район остаётся в выборке у арендатора без машины — это расширяет круг желающих при пересдаче.']);
    if (mk && mk.dom <= 40) out.push(['handshake', 'Из района выходят быстро',
      'Средний срок экспозиции ' + mk.dom + ' дней. Аргумент для того, кто боится «застрять в бетоне».']);
    return out.slice(0, 5);
  }
  // ============================================================================================
  // Что спросят. Возражение — это не риск объекта, а реплика, которая прозвучит в разговоре;
  // ценность блока в том, что ответ уже посчитан и его не надо придумывать на трубке.
  // ============================================================================================
  function objObjections(o) {
    const a = o.attrs || {}, mk = objMarket(o), off = objIsOff(o);
    const pm = objPerM2(o), gap = objPriceGap(o), y = objYieldPct(o);
    const out = [];
    if (o.verified !== 'verified' || o.trakheesi !== 'ok') out.push(['Он вообще ещё продаётся?',
      'Честно: проверка доступности от ' + o.checkedAt + ' устарела' + (o.trakheesi !== 'ok' ? ', Trakheesi ещё в процессе — до его получения объект нельзя публиковать как листинг' : '') +
      '. Сверьте с застройщиком до показа, это одна задача.']);
    if (off) out.push(['Плачу сейчас — получаю когда?',
      (o.handover ? 'Ключи ' + o.handover + '. ' : '') + 'До сдачи платежи идут частями по графику' +
      (o.escrow ? ', и не застройщику, а на эскроу-счёт: ' + o.escrow.replace(/^Escrow\s*/i, '') + '. Со счёта деньги уходят по мере готовности стройки' : '') + '.']);
    if (gap != null && gap >= 2) out.push(['Почему дороже, чем в среднем по району?',
      WS.AED(pm) + ' против ' + WS.AED(mk.perM2) + ' за м², это +' + gap + '%. Разница — ' +
      (typeof a.floor === 'number' ? a.floor + '-й этаж' : 'этаж') + (VIEW_PHRASE[a.view] ? ' и вид ' + VIEW_PHRASE[a.view] : '') +
      '. Сравнивать надо с юнитами того же уровня, а не со всем районом — средняя считает и первые этажи во двор.']);
    if (gap != null && gap <= -2) out.push(['Дешевле рынка — что с ним не так?',
      'Ничего: ' + (o.source === 'club' ? 'это клубный эксклюзив, цена не поднималась в торге между агентами' :
        off ? 'это цена входа на этапе строительства, не готового жилья' : 'объект свободен, и собственник считает простой') +
      (o.verified === 'verified' ? '. Доступность проверена ' + o.checkedAt : '') + '.']);
    if (a.metro === false) out.push(['Как сюда добираться без метро?',
      'Метро рядом нет — район автомобильный, и арендатор здесь такой же. ' + (mk ? mk.tenant : '') +
      ' Для сдачи это скорее плюс: текучка ниже.']);
    const sc = objServiceYear(o);
    if (sc) out.push(['Сколько стоит содержание?',
      o.serviceCharge + ' — при ' + o.size + ' м² это около ' + WS.AED(sc) + ' в год. В расчёте доходности заложен опекс ' +
      WS.AED((D().refModel || {}).opexY1 || 0) + ', service charge внутри него.']);
    if (mk && mk.dom >= 50) out.push(['А если передумаю — быстро выйду?',
      'Средний срок экспозиции по ' + o.area + ' — ' + mk.dom + ' дней, дольше, чем в Business Bay. ' + mk.risk]);
    return out.slice(0, 5);
  }
  // Район отдельным блоком под картой: карта отвечает «где», этот блок — «что с этим местом
  // происходит», то есть на чём держится цена через три года.
  function objAreaBlock(o) {
    const mk = objMarket(o);
    if (!mk) return '';
    const chips = [
      [WS.AED(mk.perM2), 'средняя за м²'],
      ['+' + mk.priceYoY + '%', 'цена за год'],
      ['+' + mk.rentYoY + '%', 'аренда за год'],
      [mk.dom + ' дн.', 'срок экспозиции'],
    ].map((c) => '<div class="mkt-c"><div class="mkt-v">' + c[0] + '</div><div class="mkt-l">' + c[1] + '</div></div>').join('');
    const rows = [
      ['users', 'Кто здесь снимает', mk.tenant],
      ['trend', 'Что двигает район', mk.driver],
      ['warn', 'На что смотреть', mk.risk],
    ].map((r) => '<div class="mkt-r' + (r[0] === 'warn' ? ' off' : '') + '">' + I(r[0]) +
      '<div><b>' + r[1] + '</b><span>' + r[2] + '</span></div></div>').join('');
    return dxSec('trend', 'Район · ' + o.area, '<span class="badge demo">' + I('lock') + 'срез рынка — DEMO</span>',
      '<div class="mkt-chips">' + chips + '</div><div class="mkt-rows">' + rows + '</div>');
  }
  function objSellBlock(o) {
    const pts = objSellPoints(o);
    if (!pts.length) return '';
    return dxSec('target', 'Чем продавать', '<span class="badge">' + pts.length + '</span>',
      '<div class="sp-list">' + pts.map((p) => '<div class="sp-row"><span class="sp-ic">' + I(p[0]) + '</span>' +
        '<div><div class="sp-t">' + p[1] + '</div><div class="sp-d">' + p[2] + '</div></div></div>').join('') + '</div>');
  }
  function objObjectionBlock(o) {
    const qs = objObjections(o);
    if (!qs.length) return '';
    return dxSec('help', 'Что спросят и что ответить', '<span class="badge">' + qs.length + '</span>',
      '<div class="oq-list">' + qs.map((q) => '<div class="oq-row"><div class="oq-q">' + I('chat') + q[0] + '</div>' +
        '<div class="oq-a">' + q[1] + '</div></div>').join('') + '</div>');
  }
  function objCommission(o) {
    if (!o.commissionPct) return '';
    return '<span class="obj-comm">' + I('money') + 'Комиссия ' + o.commissionPct + '% · ' + WS.AED(Math.round(o.price * o.commissionPct / 100)) + '</span>';
  }
  function objPublish(o) {
    const pub = o.verified === 'verified';
    return '<span class="obj-pub">' + I(pub ? 'eye' : 'replay') + (pub ? 'Опубликован на сайте' : 'Требует проверки доступности') + '</span>';
  }
  function objPriceAnchor(o) {
    const perM2 = o.size ? WS.AED(Math.round(o.price / o.size)) : '—';
    return '<div class="obj-priceanchor"><div class="pa-price">' + WS.AED(o.price) + '<span class="pa-m2">' + perM2 + ' / м²</span></div>' + objCommission(o) + objPublish(o) + '</div>';
  }
  function objPhotos(o) { const P = WS.photos || {}; return [P[o.id], P.o_interior, P.o_marina].filter(Boolean); }
  let _objGal = null;
  function objGallery(o) {
    const ph = objPhotos(o);
    if (!ph.length) return '';
    _objGal = { srcs: ph, idx: 0 };
    const nav = ph.length > 1
      ? '<button class="og-nav prev" data-oggal="-1" aria-label="Предыдущее фото">' + I('chevLeft') + '</button>' +
        '<button class="og-nav next" data-oggal="1" aria-label="Следующее фото">' + I('chevRight') + '</button>' +
        '<span class="og-count"><b id="ogIdx">1</b>/' + ph.length + '</span>'
      : '';
    // Label overlay: object type & area (top-left, parity with old CRM)
    const label = '<span class="og-label">' + o.br + ' · ' + o.area + '</span>';
    return '<div class="obj-gallery">' + label + '<img id="ogHero" class="og-hero" src="' + ph[0] + '" alt="">' + nav +
      '<span class="og-cap">' + I('lock') + 'DEMO фото · ' + o.area + '</span></div>';
  }
  function objGalleryNav(dir) {
    if (!_objGal || _objGal.srcs.length < 2) return;
    const hero = document.getElementById('ogHero'); if (!hero) return;
    let idx = _objGal.idx + dir;
    if (idx < 0) idx = _objGal.srcs.length - 1; if (idx >= _objGal.srcs.length) idx = 0;
    _objGal.idx = idx; hero.src = _objGal.srcs[idx];
    const ic = document.getElementById('ogIdx'); if (ic) ic.textContent = String(idx + 1);
  }
  function objMeta(o) {
    const pairs = [
      ['Район', o.area], ['Адрес', o.address], ['Вид', objAttr(o, 'view')],
      ['Этаж', objFloor(o)], ['Отделка', objAttr(o, 'finish')], ['Спрос', objAttr(o, 'demand')],
      ['Престиж', objAttr(o, 'prestige')], ['Метро', (o.attrs && o.attrs.metro) ? 'рядом' : '—'],
      ['Готовность', o.availability === 'available' ? 'Доступен для показа' : 'Требует проверки'], ['Источник', o.sourceLabel],
    ];
    return '<div class="obj-meta">' + pairs.map((p) => '<div><div class="omk">' + p[0] + '</div><div class="omv">' + (p[1] || '—') + '</div></div>').join('') + '</div>';
  }
  function objActRow(o) {
    const inSl = inShortlist(o.id);
    return '<div class="obj-actrow">' +
      '<button class="btn sm" data-valobj="' + o.id + '">' + I('calc') + 'Оценить</button>' +
      '<button class="btn sm" data-promo="' + o.id + '">' + I('send') + 'Продвигать</button>' +
      '<button class="btn sm" data-shortlist="' + o.id + '"' + (inSl ? ' style="border-color:var(--acc-line);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + I(inSl ? 'check' : 'star') + (inSl ? 'В подборке' : 'В подборку') + '</button>' +
      '</div>';
  }
  // Offline DEMO map — shows where the object sits (old CRM «Показать на карте»). No network/API on file://.
  // Real OpenStreetMap imagery around the object's coordinates; the marker is dead centre of the
  // frame by construction (see maps.js), so it needs no per-object offset. Falls back to the flat
  // panel if an object has no map baked in.
  function objMap(o) {
    const img = (WS.maps || {})[o.id];
    const canvas = img
      ? '<div class="obj-map-canvas has-img"><img src="' + img + '" alt="Карта: ' + escAttr(o.area) + '" loading="lazy">' +
        '<span class="obj-map-marker"></span>' +
        '<span class="obj-map-area">' + o.area + '</span>' +
        '<span class="obj-map-credit">© OpenStreetMap</span></div>'
      : '<div class="obj-map-canvas"><span class="obj-map-pin">' + I('building') + '</span>' +
        '<span class="obj-map-area">' + o.area + '</span></div>';
    return '<div class="obj-map">' + canvas +
      '<div class="obj-map-foot"><div class="omf-t"><b>' + o.area + '</b><span>' + (o.address || '—') + '</span></div>' +
      '<span class="badge demo">' + I('lock') + 'точка — район, DEMO</span></div>' +
      '</div>';
  }
  // Downloadable materials — distinct from the Документы tab (matches old CRM «КП · Сторис · Финмодель»).
  function objMaterials(o) {
    return dxSec('download', 'Материалы объекта', '',
      '<div class="obj-actrow">' +
      '<button class="btn sm" data-act="openKp">' + I('doc') + 'КП · PDF</button>' +
      '<button class="btn sm" data-promo="' + o.id + '">' + I('star') + 'Сторис · креативы</button>' +
      '<button class="btn sm" data-act="openXls">' + I('calc') + 'Финмодель · Excel</button>' +
      '</div>');
  }
  function objectTabContent(o, tab) {
    const perM2 = o.size ? WS.AED(Math.round(o.price / o.size)) : '—';
    if (tab === 'specs') {
      return dxSec('building', 'Характеристики', '', '<div class="dfields">' +
        dfPair('Район', o.area) + dfPair('Адрес', o.address) + dfPair('Класс', o.br) + dfPair('Площадь', o.size + ' м²') +
        dfPair('Цена за м²', perM2) + dfPair('Этаж', objFloor(o)) + dfPair('Отделка', objAttr(o, 'finish')) +
        dfPair('Вид', objAttr(o, 'view')) + dfPair('Спрос на рынке', objAttr(o, 'demand')) + dfPair('Престиж', objAttr(o, 'prestige')) +
        dfPair('Метро', (o.attrs && o.attrs.metro) ? 'рядом' : '—') + dfPair('Источник', o.sourceLabel) +
        dfPair('Доступность', o.availability === 'available' ? 'Доступен' : 'Требует проверки') + '</div>');
    }
    if (tab === 'status') {
      return dxSec('shield', 'Официальные статусы', '',
        '<div class="prov"><span class="badge ' + (o.trakheesi === 'ok' ? 'ok' : 'warn') + '">' + I('shield') + 'Trakheesi ' + (o.trakheesi === 'ok' ? 'получено' : 'в процессе') + '</span>' +
        '<span class="badge ' + (o.madmoun === 'ok' ? 'ok' : '') + '">' + I('qr') + 'Madmoun ' + (o.madmoun === 'ok' ? 'QR есть' : 'n/a') + '</span>' +
        '<span class="badge ' + (o.verified === 'verified' ? 'ok' : 'warn') + '">' + I('check') + 'Проверка · ' + o.checkedAt + (o.verified === 'expired' ? ' (истекла)' : '') + '</span>' +
        '<span class="badge demo">' + I('lock') + 'проверка — имитация (DEMO)</span></div>');
    }
    if (tab === 'docs') {
      return dxSec('doc', 'Документы по объекту', '', docsRows(docsFor((x) => x.object === o.id), 'по этому объекту документов пока нет'));
    }
    // Two-column overview layout: left info column, right media column (parity with old CRM)
    const context = '<div class="obj-overview-context">' + o.br + ' · ' + o.area + '</div>';
    const priceBlock = '<div class="obj-overview-price">' +
      '<div><div class="obj-overview-price-label">Цена</div><div class="obj-overview-price-val">' + WS.AED(o.price) + '</div></div>' +
      '<div><div class="obj-overview-price-label">За м²</div><div class="obj-overview-price-val">' + perM2 + '</div></div>' +
      '<div><div class="obj-overview-price-label">Площадь</div><div class="obj-overview-price-val">' + o.size + ' м²</div></div>' +
      '</div>';
    const commHtml = objCommission(o);
    const pubHtml = objPublish(o);
    const desc = dxSec('sparkle', 'Описание', '', '<div style="font-size:13px;color:var(--ink);line-height:1.5">' + (o.match || '—') + '</div>');
    const meta = dxSec('grid', 'Параметры объекта', '', objMeta(o));
    const acts = objActRow(o);

    const leftCol = context + priceBlock +
      (commHtml ? '<div style="margin-bottom:10px">' + commHtml + '</div>' : '') +
      (pubHtml ? '<div style="margin-bottom:14px">' + pubHtml + '</div>' : '') +
      desc + meta + acts + objMaterials(o);

    const rightCol = '<div class="obj-overview-right">' + objGallery(o) + objMap(o) + '</div>';

    return '<div class="obj-overview-grid"><div>' + leftCol + '</div>' + rightCol + '</div>';
  }
  // Object detail opens as a FULL PAGE in the working area (not a modal) — room for the rich two-column layout + map.
  function objectCard(id) { S().objectId = id; WS.router.go('objectDetail'); }
  // Object detail = HERO pattern (parity with old CRM realty-detail): full-width photo on top with
  // overlaid title/address/key-params/materials, then description → big metrics → params+map → statuses → docs.
  function objHeroParams(o) {
    const isOff = /off-plan/i.test(o.segment || '');
    const rows = [
      ['Класс', o.br],
      ['Сегмент', o.segment || (isOff ? 'off-plan' : 'готовое')],
      [isOff ? 'Срок сдачи' : 'Заселение', isOff ? (o.handover || '—') : (o.occupancy || 'Готов к заселению')],
      ['Комиссия агенту', o.commissionPct ? o.commissionPct + '%' : '—'],
    ];
    return '<dl class="ohero-meta">' + rows.map((r) => '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl>';
  }
  // Deal-context block: the off-plan vs ready/secondary split decides which fields matter
  // (developer, handover, payment plan, escrow for off-plan; occupancy for ready). From the Codex IA review.
  function objDealContext(o) {
    const isOff = /off-plan/i.test(o.segment || '');
    const rows = [];
    if (o.developer) rows.push(['Застройщик', o.developer]);
    if (o.project) rows.push(['Проект · корпус', o.project]);
    if (isOff) {
      if (o.paymentPlan) rows.push(['План оплаты', o.paymentPlan]);
      if (o.escrow) rows.push(['Escrow (DLD)', o.escrow]);
    } else if (o.occupancy) {
      rows.push(['Заселение', o.occupancy]);
    }
    if (o.serviceCharge) rows.push(['Service charge', o.serviceCharge]);
    if (!rows.length) return '';
    const seg = o.segment || (isOff ? 'off-plan' : 'готовое');
    return dxSec('briefcase', 'Условия сделки · ' + seg, '', '<div class="dfields">' + rows.map((r) => dfPair(r[0], r[1])).join('') + '</div>');
  }
  function objHero(o) {
    const ph = objPhotos(o);
    const bg = ph[0] || '';
    _objGal = { srcs: ph, idx: 0 };
    const nav = ph.length > 1
      ? '<button class="og-nav prev" data-oggal="-1" aria-label="Предыдущее фото">' + I('chevLeft') + '</button>' +
        '<button class="og-nav next" data-oggal="1" aria-label="Следующее фото">' + I('chevRight') + '</button>' +
        '<span class="og-count"><b id="ogIdx">1</b>/' + ph.length + '</span>'
      : '';
    const actions = '<div class="ohero-actions">' +
      '<button class="btn sm primary" data-act="openKp">' + I('doc') + 'Скачать КП</button>' +
      '<button class="btn sm" data-fin="' + o.id + '">' + I('money') + 'Доходность</button>' +
      '<button class="btn sm" data-promo="' + o.id + '">' + I('star') + 'Скачать креативы</button>' +
      '<button class="btn sm" data-act="openXls">' + I('calc') + 'Финмодель · Excel</button>' +
      '</div>';
    const info = '<div class="ohero-info">' +
      '<h1 class="ohero-title">' + o.name + '</h1>' +
      '<div class="ohero-addr">' + I('building') + (o.address || o.area) + '</div>' +
      objHeroParams(o) + '</div>';
    return '<div class="ohero">' +
      '<img id="ogHero" class="ohero-img" src="' + bg + '" alt="">' +
      '<div class="ohero-scrim"></div>' +
      '<span class="ohero-src">' + I(o.source === 'club' ? 'star' : o.source === 'import' ? 'download' : 'briefcase') + o.sourceLabel + '</span>' +
      info + actions + nav +
      '<span class="ohero-cap">' + I('lock') + 'DEMO фото · ' + o.area + '</span>' +
      '</div>';
  }
  // Summary band under the hero: lead description + key metrics on an accent-tinted card,
  // with the price emphasized — gives the block presence instead of bare numbers on the page bg.
  function objSummary(o, opts) {
    const perM2 = o.size ? WS.AED(Math.round(o.price / o.size)) : '—';
    const y = objYieldPct(o);
    const m = [
      [WS.AED(o.price), 'общая цена', true],
      [perM2, 'цена за м²', false],
      [o.size + ' м²', 'площадь', false],
      [y ? String(y).replace('.', ',') + '%' : objFloor(o), y ? 'доходность (расчёт)' : 'этаж', false],
    ];
    const lead = (opts && opts.lead === false) ? '' :
      '<div class="osum-eyebrow">Описание</div><p class="osum-lead">' + (o.match || '—') + '</p>';
    return '<div class="osum' + (lead ? '' : ' osum-bare') + '">' + lead +
      '<div class="osum-metrics">' + m.map((c) =>
        '<div class="osum-m' + (c[2] ? ' osum-m--hero' : '') + '"><div class="osum-v">' + c[0] + '</div><div class="osum-l">' + c[1] + '</div></div>').join('') +
      '</div></div>';
  }
  function objStatusesInner(o) {
    return '<div class="prov"><span class="badge ' + (o.trakheesi === 'ok' ? 'ok' : 'warn') + '" title="Trakheesi — разрешение DLD на публикацию объявления о недвижимости в Дубае">' + I('shield') + 'Trakheesi ' + (o.trakheesi === 'ok' ? 'получено' : 'в процессе') + '</span>' +
      '<span class="badge ' + (o.madmoun === 'ok' ? 'ok' : '') + '" title="Madmoun — QR-верификация листинга: подтверждает легальность объявления">' + I('qr') + 'Madmoun ' + (o.madmoun === 'ok' ? 'QR есть' : 'n/a') + '</span>' +
      '<span class="badge ' + (o.verified === 'verified' ? 'ok' : 'warn') + '" title="Проверка актуальности объекта — дата последней сверки инвентаря">' + I('check') + 'Проверка · ' + o.checkedAt + (o.verified === 'expired' ? ' (истекла)' : '') + '</span>' +
      '<span class="badge demo">' + I('lock') + 'проверка — имитация (DEMO)</span></div>';
  }
  function viewObjectDetail(id) {
    const o = D().objects.find((x) => x.id === id);
    if (!o) return viewObjects();
    const inSl = inShortlist(o.id);
    const back = '<div class="obj-page-head">' + backBtn('objects', '', 'Назад к объектам') + '</div>';
    const acts = entityActionBar([
      ['chat', 'Чат по объекту', 'data-thread="object:' + o.id + '" data-tlabel="' + escAttr(o.name) + ' · объект" data-ticon="building"', 'primary'],
      ['calc', 'Оценить', 'data-valobj="' + o.id + '"', ''],
      [inSl ? 'check' : 'star', inSl ? 'В подборке' : 'В подборку', 'data-shortlist="' + o.id + '"', inSl ? 'on' : ''],
      ['pencil', 'Записать событие', 'data-act="addEvent" data-scope="object" data-obj="' + o.id + '"', ''],
    ]);
    // Источник и сегмент уже сказаны в обложке; здесь только то, чего там нет.
    const paramsInner = '<div class="obj-meta">' + [
      ['Этаж', objFloor(o)], ['Вид из окон', objAttr(o, 'view')],
      ['Отделка', objAttr(o, 'finish')], ['Метро', (o.attrs && o.attrs.metro) ? 'рядом' : 'нет рядом'],
      ['Спрос на рынке', objAttr(o, 'demand')], ['Престиж адреса', objAttr(o, 'prestige')],
    ].map((p) => '<div><div class="omk">' + p[0] + '</div><div class="omv">' + p[1] + '</div></div>').join('') + '</div>';
    const statuses = dxSec('shield', 'Официальные статусы', '', objStatusesInner(o));
    const docs = dxSec('doc', 'Документы по объекту', '', docsRows(docsFor((x) => x.object === o.id), 'по этому объекту документов пока нет'));
    const ctx = objDealContext(o);
    return parentReqCrumb(objBackRequest(o.id)) + back + objHero(o) + acts + objSummary(o, { lead: false }) + cxStack([
      // Слева — чем это продают, справа — где это и что с этим местом. Пары подобраны так, чтобы
      // ответ стоял рядом со строкой, к которой он относится: «сколько стоит содержание» — против
      // service charge в условиях сделки.
      [cxCol([objBriefBlock(o), objSellBlock(o)]),
       cxCol([dxSec('compass', 'Расположение на карте', '', objMap(o)), objAreaBlock(o)])],
      [objObjectionBlock(o), ctx],
      [dxSec('grid', 'Параметры объекта', '', paramsInner), statuses],
      docs,
    ]);
  }

  // Deal / client as full-page views (не поп-ап): много информации — нужна страница со скроллом, как у объекта.
  // ---- Карточка сделки: полоса сверху · слева справка и участники · справа работа · ввод снизу ----
  // Порядок блоков — по частоте обращения, а не по важности «вообще».
  function dealTopBand(d, navHtml) {
    const sub = [dealActionWord(d) + ' · ' + dealLotsLabel(d), d.goal, d.amount ? WS.AED(d.amount) : null]
      .filter(Boolean).join(' · ');
    // Обложка карточки — та же, что у объекта сделки: сделка узнаётся по объекту раньше,
    // чем прочитан её заголовок.
    const lot = dealLots(d)[0];
    const bg = (WS.photos && ((lot && WS.photos[lot.id]) || WS.photos.o_creekline)) || '';
    // Название и суть живут ВНУТРИ обложки. Пустая полоса картинки занимала высоту заголовка и
    // не несла ни слова — на карточке, которую открывают ради работы, это чистая потеря экрана.
    const title = '<div class="dcard-title deal-title-edit" data-titledeal="' + d.id + '">' +
      '<span class="deal-title-text" contenteditable="true" role="textbox" aria-label="Название сделки — нажмите, чтобы изменить" ' +
      'title="Кликните, чтобы изменить. Enter — сохранить, Esc — отменить">' + escAttr(d.title || 'Сделка') + '</span></div>' +
      '<div class="dcard-sub">' + sub + '</div>';
    return '<div class="dcard-top">' +
      coverBand(bg, (navHtml || '') + title, entityActionBar(dealActions(d), 'icons')) +
      '<div class="dcard-pathrow">' + dealPathSection(d) + '</div></div>';
  }
  /* Обложка карточки — она же первый экран: картинка объекта и поверх неё название и суть.
     Одна на сделку и на заявку, чтобы они не разъезжались снова. Без картинки полоса остаётся
     той же по составу — меняется только фон, а не раскладка. */
  function coverBand(bg, inner, acts) {
    const style = bg
      ? ' style="background-image:linear-gradient(90deg,var(--surface) 10%,var(--wh-fade1) 58%,var(--wh-fade2) 100%),url(' + bg + ')"'
      : '';
    return '<div class="dcard-cover' + (bg ? '' : ' no-img') + '"' + style + '>' +
      '<div class="dcard-hero-b">' + inner + '</div>' +
      (acts ? '<div class="dcard-acts">' + acts + '</div>' : '') + '</div>';
  }
  // Левая колонка: справка, условия запроса без заголовка, участники. Комиссии здесь нет — она
  // у объектов, потому что ставка принадлежит объекту, а не сделке.
  function dealAside(d) {
    const p = d.prov || {};
    const params = '<div class="dcard-params">' +
      dealField('Бюджет', d.amount ? WS.AED(d.amount) : '—', p.budget, d.id + ':budget', d.id, 'amount') +
      dealField('Форма оплаты', d.paymentForm, p.paymentForm, d.id + ':paymentForm', d.id, 'paymentForm') +
      dealField('Тип объекта', d.objectType, p.objectType, d.id + ':objectType', d.id, 'objectType') +
      dealField('Готовность', d.readiness, 'confirmed', '', d.id, 'readiness') +
      dealField('Цель', d.goal, p.goal, d.id + ':goal', d.id, 'goal') +
      dealField('Источник (из запроса)', d.source, p.source, d.id + ':source', d.id, 'source') + '</div>';
    return dealStatusBrief(d) + dealClientCard(d, 'deal:' + d.id) +
      '<div class="dcard-terms"><div class="dcard-terms-h">' + I('doc') + 'Условия сделки</div>' + params + '</div>';
  }
  function dealPeopleCard(d) {
    const addBtn = '<button class="btn xs" data-act="addDealContact" data-deal="' + d.id + '">' + I('plus') + 'Добавить</button>';
    return dxSec('users', 'Участники · ' + dealContacts(d).length, addBtn, dealContactsInner(d));
  }
  /* ---- «Требует вашего решения» -----------------------------------------------------------
     Раньше это называлось «Итоги на подтверждение» и стояло третьим блоком: имя описывало один
     частный случай — черновик итога звонка, — а на деле это единственное место на карточке, где
     от агента что-то ТРЕБУЕТСЯ лично: подтвердить, поправить, выбрать. Поэтому и имя общее, и
     место первое: это руководство к действию, а не запись о прошлом.

     Черновик стоит здесь, а не в истории: он не часть истории, пока его не подтвердили. В ленту
     он попадает ровно в тот момент, когда становится правдой. */
  function needsYouCard(scope, id, extraHtml) {
    /* Требует решения только НЕразобранное: подтверждённый и отклонённый черновик решения уже
       не ждут, и счётчик, который их считает, обещает работу, которой нет. Разобранное с карточки
       не исчезает — иначе непонятно, почему Консьерж больше не предлагает вчерашнее, — но уходит
       в свёрнутый след под ними и в счёт не входит. */
    const all = outcomesFor(scope, id);
    const pending = all.filter((x) => x.state === 'draft');
    const settled = all.filter((x) => x.state !== 'draft');
    const rows = [];
    if (pending.length) rows.push('<div class="timeline">' + pending.map(outcomeRow).join('') + '</div>');
    if (extraHtml) rows.push(extraHtml);
    if (settled.length) {
      rows.push('<details class="ny-done"><summary>Уже разобрано · ' + settled.length + '</summary>' +
        '<div class="timeline">' + settled.map(outcomeRow).join('') + '</div></details>');
    }
    if (!rows.length) return '';
    const n = pending.length + (extraHtml ? 1 : 0);
    return dxSec('sparkle', 'Требует вашего решения · ' + n,
      '<span class="ny-hint">' + I('lock') + 'до подтверждения не идёт в выводы</span>',
      '<div class="ny-body">' + rows.join('') + '</div>');
  }
  // Значения, предложенные моделью и ещё не подтверждённые: сами поля правятся слева, здесь —
  // только счёт и путь к ним, чтобы карточка не держала одно значение в двух местах.
  function aiFieldsPending(d) {
    const p = d.prov || {};
    const n = Object.keys(p).filter((k) => p[k] === 'ai').length;
    if (!n) return '';
    return '<div class="ny-row"><span class="ny-ic">' + I('sparkle') + '</span>' +
      '<div><div class="ny-t">' + n + ' ' + plural(n, 'значение предложено', 'значения предложены', 'значений предложено') +
      ' моделью</div>' +
      '<div class="ny-m">Условия сделки слева — подтвердите галочкой или впишите своё.</div></div></div>';
  }
  // Правая колонка — рабочая область: что дальше, объекты, что было.
  function dealWork(d) {
    if (S().rightPane === 'history') {
      return rightHistoryPane(commsFeedRows(dealLineageEntries(d)), 'Назад к работе по сделке');
    }
    // То, что требует агента лично, стоит ПЕРВЫМ: это руководство к действию, и держать его
    // третьим блоком означало, что до него доходят последним.
    const pend = needsYouCard('deal', d.id, aiFieldsPending(d));
    // Запланированное и последнее — две стороны одного вопроса «что происходит», и на макете
    // партнёра они стоят в ряд. В столбик «последнее» уезжало под сгиб на каждой сделке.
    const planned = dealPlannedEventsCard(d);
    const recent = dealRecentCard(d);
    const pair = (planned || recent)
      ? '<div class="dcard-pair">' + (planned || '') + (recent || '') + '</div>' : '';
    return pend + pair + dealLotsBlock(d) + dealPeopleCard(d);
  }
  // Одна строка ввода внизу — она же вход в Консьержа. Отдельной кнопки «Работать через Консьержа»
  // нет: она была дублем этой же строки, и именно её партнёр критикует, не заметив, что нарисовал сам.
  //
  // Строка НЕ уводит в раздел Консьержа: `data-thread` делал именно это — открывал тред и уходил
  // на другой экран, так что от сделки не оставалось ничего. Диалог открывается здесь же, над
  // рабочей областью, и рабочая область остаётся на месте: объекты, запланированное, история
  // видны под ним, левая колонка с фактами и участниками не двигается вовсе.
  /* Строка внизу карточки — НАСТОЯЩЕЕ поле ввода. Раньше это была картинка поля: она выглядела
     как строка, в которую можно писать, а по клику открывала панель Консьержа — ровно то, на что
     партнёр и жаловался («как будто можно писать, а на самом деле нельзя»). Убрать её было бы
     проще, но она есть на каждом листе его макета и она же — единственный вход в диалог,
     не уводящий с карточки. Поэтому строка осталась, а врать перестала: текст уходит в панель
     поверх экрана, и панель открывается привязанной к этой записи. */
  function cardComposer(placeholder) {
    return '<div class="dcard-composer"><div class="dx-cbar live">' +
      '<div class="w">W</div>' +
      '<input class="ph-in" id="cardPrompt" type="text" autocomplete="off" placeholder="' + escAttr(placeholder) + '">' +
      '<button class="send" data-act="cardSend" aria-label="Отправить Консьержу">' + I('arrowRight') + '</button>' +
      '</div></div>';
  }
  // Отправка из панели: тот же экран — та же запись. Иначе панель, открытая на прошлой
  // сделке, продолжала бы принимать поручения по ней с карточки другой.
  function sendFromDock(text) {
    bindDockToScreen();
    WS.router.routePrompt(text);
  }
  /* Отправка из карточки: панель открывается привязанной к записи, экран под ней не
     перестраивается. Привязка делается ВСЕГДА, а не только при закрытой панели: панель,
     открытая на прошлой сделке, оставалась привязанной к ней, и поручение, написанное из
     карточки другой сделки, доставалось прошлой — вместе с задачей, которую оно создаёт. */
  function sendFromCard() {
    const el = document.getElementById('cardPrompt');
    const v = el ? String(el.value || '').trim() : '';
    if (el) el.value = '';
    bindDockToScreen();
    if (!S().cgDock) { S().cgDock = true; renderCgDock(); }
    if (v) WS.router.routePrompt(v);
  }
  function dealComposer(d) {
    return cardComposer('Записать заметку или поручить Консьержу по сделке «' + (d.title || 'сделка') +
      '» — «собрать КП», «что просрочено», «бриф к звонку»…');
  }
  // Диалог внутри карточки. Занимает собственную высоту и прокручивается внутри себя, а не
  // выталкивает работу за экран: макет партнёра отдавал Консьержу всю правую колонку, и объекты
  // с событиями исчезали — он просил «не выходить из сделки», а нарисовал экран без сделки.
  // Диалог по сделке живёт в общем доке над страницей. Отдельной панели внутри карточки нет:
  // она раздвигала работу и была третьей реализацией одного и того же чата.
  function dealChatPanel() { return ''; }
  // Открыть/закрыть диалог — это состояние экрана, а не переход. Маршрут не меняется, история
  // навигации не растёт, кнопка «назад» по-прежнему ведёт к списку сделок, а не к чату.
  function openDealChat(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    WS.engine.bindThread('deal:' + dealId, (c.name ? c.name + ' · ' : '') + (d.title || 'сделка'), 'briefcase');
    S().dealChat = null;
    S().cgDock = true;
    renderCgDock();
  }
  function closeDealChat() { S().dealChat = null; S().cgDock = false; renderCgDock(); }
  // Док, открытый круглой кнопкой, привязывается к записи, на которой стоит агент. Раньше он
  // открывался в общем треде с любого экрана, и вопрос «а по этой сделке?» приходил без подлежащего.
  /* Префикс треда — тот же, что читает разбор области поручения: контакт живёт под
     `contact:`, и заведение его же под `client:` дало бы контакту две несвязанные истории,
     а новый тред перестал бы опознаваться как контекст контакта. */
  const CTX_THREAD = { 'сделка': ['deal:', 'briefcase'], 'запрос': ['request:', 'mail'],
    'контакт': ['contact:', 'users'], 'компания': ['company:', 'building'], 'объект': ['object:', 'building'] };
  function bindDockToScreen() {
    const rec = screenContext().запись;
    const map = rec && CTX_THREAD[rec.тип];
    if (!map) return false;
    WS.engine.bindThread(map[0] + rec.id, (rec.клиент ? rec.клиент + ' · ' : '') + rec.название, map[1]);
    return true;
  }
  function toggleCgDock() {
    const st = S();
    if (st.cgDock) { st.cgDock = false; renderCgDock(); return; }
    bindDockToScreen();
    st.cgDock = true;
    renderCgDock();
  }
  function viewDealDetail(id) {
    const spec = dealSpec(id);
    if (!spec) return viewClients();
    const d = D().deals.find((x) => x.id === id);
    const crumb = (d && d.requestId) ? parentReqLink(requestById(d.requestId)) : '';
    // Узкий экран: левая колонка сворачивается в раскрываемую справку под названием, правая
    // встаёт стопкой. Свернули в <details>, а не во вкладки: он раскрывается без скрипта,
    // и ни один блок не пропадает — меняется только способ до него добраться.
    const aside = '<details class="dcard-aside-m"><summary>' + I('menu') + 'Справка и условия сделки</summary>' +
      '<div class="dcard-aside-m-b">' + dealAside(d) + '</div></details>';
    return '<div class="dcard">' +
      dealTopBand(d, cardNavRow([backLink('clients', 'deals', 'Назад к сделкам'), crumb])) +
      '<div class="dcard-cols">' +
      '<aside class="dcard-aside">' + dealAside(d) + '</aside>' +
      aside +
      '<div class="dcard-main">' + dealChatPanel(d) + dealWork(d) + dealTabsBlock(spec) + '</div>' +
      '</div>' + dealComposer(d) + '</div>';
  }
  // Вкладки карточки (параметры, контакты, задачи, документы, история) остаются как были —
  // они и есть «вся глубина», к которой обращаются реже, чем к рабочей области выше.
  function dealTabsBlock(spec) {
    const tab = cardTab(spec.type, spec.id, spec.tabs);
    WS._cardByType = WS._cardByType || {};
    WS._cardByType[spec.type] = spec;
    WS._card = spec;
    const tabBar = '<div class="dx-tabs">' + spec.tabs.map((t) =>
      '<button class="dx-tab' + (t[0] === tab ? ' on' : '') + '" data-etab="' + spec.type + '~' + spec.id + '~' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    return tabBar + '<div class="dx-tabbody" id="dxTabBody">' + spec.render(tab) + '</div>';
  }
  function viewClientDetail(id) {
    const spec = clientSpec(id);
    if (!spec) return viewClients();
    return entityPage(spec, 'clients', 'contacts', 'Назад к клиентам');
  }
  function viewCompanyDetail(id) {
    const spec = companySpec(id);
    if (!spec) return viewCompanies();
    return entityPage(spec, 'clients', 'contacts', 'Назад к контактам');
  }

  // ---------------- ПОДБОР ПОД СДЕЛКУ (matching workspace) ----------------
  const TARGET_YIELD = 0.05; // implied investor target (net)
  function objNetYield(o) {
    const m = Object.assign(WS.storeApi.clone(D().refModel), { objectId: o.id, price: o.price });
    return WS.finance.compute(m).netYield;
  }
  // ---------------- MATCHING (quality criteria + client-portrait fit) ----------------
  const QUAL = [
    { k: 'water', label: 'Вид на воду', test: (o) => o.attrs && o.attrs.view === 'water' },
    { k: 'highfloor', label: 'Высокий этаж', test: (o) => o.attrs && o.attrs.floorBand === 'high' },
    { k: 'newfinish', label: 'Свежая отделка', test: (o) => o.attrs && o.attrs.finish === 'new' },
    { k: 'demand', label: 'Высокий спрос', test: (o) => o.attrs && o.attrs.demand === 'high' },
    { k: 'metro', label: 'Рядом метро', test: (o) => o.attrs && o.attrs.metro },
    { k: 'verified', label: 'Только проверенные', test: (o) => o.verified === 'verified' },
  ];
  function qualById(k) { return QUAL.find((q) => q.k === k); }
  function initMatch(c) { return { area: 'all', br: 'all', min: 0, max: (c && c.budget) || 2500000, yield: 0.05, qual: [], psych: !!(c && c.psych && c.psych.filled) }; }
  // psychological fit: nudge score by the client's declared values / decision style
  function psychFit(o, psych) {
    let s = 0; const reasons = []; const vals = psych.values || []; const at = o.attrs || {}; const ny = objNetYield(o);
    if (vals.indexOf('Статус/престиж') >= 0 && at.prestige === 'high') { s += 6; reasons.push('престиж — под «статус»'); }
    if (vals.indexOf('Доходность') >= 0 && ny >= 0.05) { s += 6; reasons.push('доходность — под ценность'); }
    if (vals.indexOf('Безопасность сделки') >= 0 && o.verified === 'verified') { s += 5; reasons.push('проверен — под «безопасность»'); }
    if (vals.indexOf('Комфорт') >= 0 && at.view && at.view !== 'none') { s += 4; reasons.push('вид/комфорт'); }
    if (/Статусный/.test(psych.decision || '') && at.prestige === 'high') { s += 3; }
    if (/Аналитик/.test(psych.decision || '') && o.verified === 'verified') { s += 2; }
    return { score: Math.min(15, s), reasons: reasons.slice(0, 2) };
  }
  function matchScore(o, m, c) {
    let score = 0, max = 0; const good = [], bad = [];
    max += 25;
    if (o.price >= m.min && o.price <= m.max) { score += 25; good.push('в бюджете'); }
    else if (o.price < m.min) { score += 22; good.push('ниже бюджета'); }
    else if (o.price <= m.max * 1.05) { score += 13; bad.push('чуть выше бюджета'); }
    else bad.push('вне бюджета');
    max += 22; const ny = objNetYield(o);
    if (ny >= m.yield) { score += 22; good.push('доходность ' + WS.finance.pct(ny)); }
    else { score += Math.round(22 * Math.max(0, ny) / Math.max(0.001, m.yield)); bad.push('доходность ниже цели'); }
    max += 14; if (m.area === 'all' || o.area === m.area) { score += 14; if (m.area !== 'all') good.push(o.area); } else bad.push('другой район');
    max += 8; if (m.br === 'all' || o.br === m.br) { score += 8; } else bad.push('другой тип');
    (m.qual || []).forEach((k) => { const q = qualById(k); if (!q) return; max += 6; if (q.test(o)) { score += 6; good.push(q.label); } else bad.push('нет: ' + q.label); });
    if (m.psych && c && c.psych && c.psych.filled) { const pf = psychFit(o, c.psych); max += 15; score += pf.score; pf.reasons.forEach((r) => good.push(r)); }
    return { pct: Math.round(100 * score / Math.max(1, max)), good, bad };
  }
  function viewCalc() {
    const cid = S().podborClient || 'c_anna';
    const c = D().clients.find((x) => x.id === cid) || D().clients[0];
    if (S().matchClient !== cid || !S().match) { S().match = initMatch(c); S().matchClient = cid; }
    const m = S().match;
    // client select scales to hundreds of contacts (native searchable select, not chips)
    const clientOpts = D().clients.map((x) => '<option value="' + x.id + '"' + (x.id === cid ? ' selected' : '') + '>' + x.name + '</option>').join('');
    const areaOpts = [['all', 'Любой район']].concat(Array.from(new Set(D().objects.map((o) => o.area))).map((a) => [a, a]));
    const brOpts = [['all', 'Любой тип']].concat(Array.from(new Set(D().objects.map((o) => o.br))).map((b) => [b, b]));
    const qualChips = QUAL.map((q) => { const on = (m.qual || []).indexOf(q.k) >= 0; return '<button class="chip ' + (on ? '' : 'mut') + '"' + (on ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + ' data-mqual="' + q.k + '">' + I('check') + q.label + '</button>'; }).join('');
    const psychAvail = !!(c.psych && c.psych.filled);
    const psychToggle = '<button class="chip ' + (m.psych ? '' : 'mut') + '"' + (m.psych ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + ' data-mpsych="1"' + (psychAvail ? '' : ' disabled') + '>' + I('sparkle') + 'Учитывать психопрофиль</button>';
    const panel = '<div class="card pad match-panel" style="margin-bottom:16px">' +
      '<div class="section-label" style="margin-bottom:6px">Клиент подбора</div>' +
      '<select id="m_client" class="mini-sel" style="width:100%;margin-bottom:12px">' + clientOpts + '</select>' +
      '<div class="match-grid">' +
        '<label class="fld"><span>Район</span>' + miniSel('m_area', m.area, areaOpts) + '</label>' +
        '<label class="fld"><span>Тип</span>' + miniSel('m_br', m.br, brOpts) + '</label>' +
        '<label class="fld"><span>Бюджет от, AED</span><input id="m_min" type="number" step="50000" value="' + m.min + '"></label>' +
        '<label class="fld"><span>Бюджет до, AED</span><input id="m_max" type="number" step="50000" value="' + m.max + '"></label>' +
      '</div>' +
      '<div class="arow" style="margin-top:10px"><div class="alabel"><label>Целевая доходность</label></div>' +
        '<div class="actl"><input type="range" id="m_yield" min="0.03" max="0.08" step="0.005" value="' + m.yield + '"><span class="av" id="av_m_yield">' + (Math.round(m.yield * 1000) / 10) + '%</span></div></div>' +
      '<div class="section-label" style="margin:12px 0 6px">Качественные критерии</div><div class="qa-row">' + qualChips + '</div>' +
      '<div class="section-label" style="margin:12px 0 6px">Мэтч по портрету клиента</div><div class="qa-row">' + psychToggle +
        (psychAvail ? '' : '<span class="badge">' + I('lock') + 'заполните портрет в карточке контакта</span>') + '</div>' +
      (psychAvail ? '<div style="font-size:11.5px;color:var(--mut);margin-top:8px">' + I('sparkle') + ' Портрет: <b>' + c.psych.decision + '</b> · важно: ' + (c.psych.values || []).join(', ') + '</div>' : '') +
      '</div>';
    const sl = S().shortlist || [];
    let base = sl.length ? D().objects.filter((o) => sl.indexOf(o.id) >= 0) : D().objects.slice();
    base = base.filter((o) => (m.area === 'all' || o.area === m.area) && (m.br === 'all' || o.br === m.br) && o.price <= m.max * 1.15);
    const scored = base.map((o) => ({ o: o, s: matchScore(o, m, c) })).sort((a, b) => b.s.pct - a.s.pct);
    const rows = scored.length ? scored.map(({ o, s }) => {
      const pthumb = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
      const thumb = pthumb ? '<div class="pod-thumb" style="background-image:url(' + pthumb + ')"></div>' : '<div class="pod-thumb" style="' + photoStyle(o) + '"></div>';
      const tone = s.pct >= 75 ? 'ok' : s.pct >= 50 ? 'warn' : '';
      const good = s.good.slice(0, 3).map((g) => '<span class="badge ok">' + I('check') + g + '</span>').join('');
      const bad = s.bad.slice(0, 2).map((g) => '<span class="badge">' + I('warn') + g + '</span>').join('');
      const src = '<span class="badge acc">' + I(o.source === 'club' ? 'star' : o.source === 'import' ? 'download' : 'briefcase') + o.sourceLabel + '</span>';
      return '<div class="pod-row">' + thumb +
        '<div class="pod-main"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div class="ot" style="font-weight:700;color:var(--ink)">' + o.name + '</div><span class="match-score ' + tone + '">' + I('target') + 'Мэтч ' + s.pct + '</span></div>' +
        '<div style="font-size:12px;color:var(--mut);margin:2px 0 6px">' + o.area + ' · ' + o.br + ' · ' + WS.AED(o.price) + '</div>' +
        '<div class="prov">' + src + good + bad + '</div></div>' +
        '<div class="pod-act"><button class="btn sm primary" data-fin="' + o.id + '">' + I('money') + 'Доходность</button>' +
        (inShortlist(o.id) ? '<button class="btn sm" data-shortlist="' + o.id + '" style="border-color:var(--acc-line);background:var(--acc-soft);color:var(--acc-ink)">' + I('check') + 'В подборке</button>' : '<button class="btn sm" data-shortlist="' + o.id + '">' + I('star') + 'В подборку</button>') +
        '<button class="btn sm" data-obj="' + o.id + '">' + I('eye') + 'Карточка</button></div></div>';
    }).join('') : '<div class="empty">' + I('search') + '<div>Под параметры ничего не найдено — ослабьте фильтры</div></div>';
    const slInfo = sl.length ? 'Собрать КП из подборки (' + sl.length + ')' : 'Собрать КП';
    const clearSl = sl.length ? '<button class="btn sm ghost" data-act="clearShortlist">' + I('x') + 'Очистить подборку</button>' : '';
    const listLabel = (sl.length ? 'Подборка · ' : 'Ранжировано по соответствию · ') + scored.length + (sl.length ? '' : ' из ' + D().objects.length);
    return head('Подборы и расчёты', 'Подбор под клиента: выберите клиента → задайте параметры (район, бюджет, тип, доходность, качественные критерии, психопрофиль) → объекты ранжируются по соответствию с объяснением «почему» → «В подборку» → «Доходность» → «Собрать КП».',
      clearSl + '<button class="btn sm primary" data-act="openKp">' + I('doc') + slInfo + '</button>') + panel +
      '<div class="section-label">' + listLabel + '</div>' + rows;
  }

  // ---------------- ФИНМОДЕЛЬ ОБЪЕКТА (popup «Доходность») ----------------
  function openFinance(objId) {
    const o = D().objects.find((x) => x.id === objId) || D().objects[0];
    const fm = S().finModel;
    if (!fm || fm.objectId !== objId) {
      S().finModel = Object.assign(WS.storeApi.clone(D().refModel), { objectId: objId, price: o.price, exitNet: Math.round(o.price * D().refModel.exitNet / D().refModel.price), scenario: 'base' });
    }
    const pc = D().clients.find((x) => x.id === (S().podborClient || 'c_anna')) || {};
    openModal('Доходность · ' + o.name,
      '<div class="prov" style="margin-bottom:10px"><span class="badge acc">' + I('users') + 'под сделку: ' + (pc.name || 'Анна Петрова') + '</span><span class="badge">' + I('target') + 'цель ~' + Math.round(TARGET_YIELD * 100) + '%</span></div><div id="finBody"></div>',
      '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn sm" data-act="openXls">' + I('download') + 'Excel</button><button class="btn primary" data-act="openKp">' + I('doc') + 'Собрать КП</button>');
    renderFinance();
  }
  function applyScenario(name) {
    const m = S().finModel; if (!m) return;
    m.scenario = name;
    if (name === 'cons') { m.rentGrowth = 0.01; m.exitNet = Math.round(m.price * 1.0); }
    else if (name === 'opt') { m.rentGrowth = 0.05; m.exitNet = Math.round(m.price * 1.25); }
    else if (name === 'base') { m.rentGrowth = 0.03; m.exitNet = Math.round(m.price * D().refModel.exitNet / D().refModel.price); }
  }
  function renderFinance() {
    const box = document.getElementById('finBody'); if (!box) return;
    const m = S().finModel;
    const scn = (id, l) => '<button class="seg-b ' + ((m.scenario || 'base') === id ? 'on' : '') + '" data-scen="' + id + '">' + l + '</button>';
    box.innerHTML =
      '<div class="seg" style="margin-bottom:12px">' + scn('cons', 'Консервативный') + scn('base', 'Базовый') + scn('opt', 'Оптимистичный') + (m.scenario === 'custom' ? '<button class="seg-b on">Свой</button>' : '') + '</div>' +
      '<div id="finMatch"></div><div id="finKpis" style="margin-top:12px"></div>' +
      '<div class="section-label" style="margin-top:16px">Сценарий инвестора — меняйте</div>' +
      slider('rentY1', 'Аренда, год 1', m.rentY1, 90000, 160000, 1000, WS.finance.aed, 'Годовой доход от аренды') +
      slider('rentGrowth', 'Рост аренды', m.rentGrowth, 0, 0.08, 0.005, (x) => (x * 100).toFixed(1) + '%', 'Ежегодная индексация') +
      slider('exitNet', 'Цена выхода', m.exitNet, 1500000, 3000000, 10000, WS.finance.aed, 'Чистая цена продажи в конце 5-го года') +
      '<div class="section-label" style="margin-top:16px">Рынок и модель — зафиксировано</div>' +
      lockedRow('Цена входа', WS.finance.aed(m.price), 'из объекта (рынок)', 'листинг') +
      lockedRow('Доп. затраты', WS.finance.aed(m.addCosts), 'DLD 4% + сборы', 'регуляторика') +
      lockedRow('Service charge / opex', WS.finance.aed(m.opexY1), 'обслуживание, год 1', 'RERA / модель') +
      lockedRow('Ставка дисконта', (m.discount * 100).toFixed(1) + '%', 'порог доходности', 'модель') +
      '<div class="prov" style="margin-top:12px"><span class="badge demo">' + I('lock') + 'При эталонных входных совпадает со спец. §12.2</span></div>' +
      '<div style="margin-top:8px"><button class="btn sm ghost" data-act="finReset">' + I('reset') + 'К базовому сценарию</button></div>';
    recomputeFinance();
  }
  function recomputeFinance() {
    const m = S().finModel; if (!m) return; const r = WS.finance.compute(m);
    const fit = r.netYield >= TARGET_YIELD;
    const kpi = (v, k, neg) => '<div class="kpi"><div class="kv' + (neg ? ' neg' : '') + '">' + v + '</div><div class="kk">' + k + '</div></div>';
    const km = document.getElementById('finKpis');
    if (km) km.innerHTML = '<div class="fin-kpis">' + kpi(r.fmt.netYield, 'Чистая доходность') + kpi(r.fmt.roi5, 'ROI 5 лет') + kpi(r.fmt.irr, 'IRR') + '</div>' +
      '<div class="fin-kpis" style="margin-top:10px">' + kpi(r.fmt.grossYield, 'Валовая дох.') + kpi(r.fmt.npv, 'NPV', r.npv < 0) + kpi(r.fmt.invested, 'Инвестиции') + '</div>';
    const mm = document.getElementById('finMatch');
    if (mm) mm.innerHTML = '<div class="match" style="' + (fit ? '' : 'background:var(--warn-soft);border-color:var(--warn-line)') + '">' + I(fit ? 'checkCircle' : 'warn') +
      '<span><b>' + (fit ? 'Подходит под клиента' : 'Ниже целевой доходности') + '</b> — чистая доходность ' + r.fmt.netYield + ' против цели ~' + Math.round(TARGET_YIELD * 100) + '%.</span></div>';
  }
  function finSlider(key, val) {
    const m = S().finModel; if (!m) return;
    m[key] = parseFloat(val); m.scenario = 'custom';
    const av = document.getElementById('av_' + key);
    if (av) { const fmt = key === 'rentGrowth' ? (x) => (x * 100).toFixed(1) + '%' : WS.finance.aed; av.textContent = fmt(m[key]); }
    recomputeFinance();
  }
  function finScenario(name) { applyScenario(name); renderFinance(); }
  // Dedicated «Расчёт доходности» section (item 7) — the finance model as a full page.
  function viewFinance() {
    const objId = S().finObjId || 'o_creekline';
    const o = D().objects.find((x) => x.id === objId) || D().objects[0];
    if (!S().finModel || S().finModel.objectId !== o.id) S().finModel = Object.assign(WS.storeApi.clone(D().refModel), { objectId: o.id, price: o.price, exitNet: Math.round(o.price * D().refModel.exitNet / D().refModel.price), scenario: 'base' });
    const objOpts = D().objects.map((x) => '<option value="' + x.id + '"' + (x.id === o.id ? ' selected' : '') + '>' + x.name.split(',')[0] + ' · ' + WS.AED(x.price) + '</option>').join('');
    const ph = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
    return head('Расчёт доходности', 'Полная финмодель по объекту: сценарии инвестора (аренда, рост, цена выхода — меняются) и зафиксированные рыночные допущения. Пересчёт мгновенный; экспорт в КП и Excel. Новый объект добавляется в «Объекты» (создать/импорт), затем считается здесь.',
      '<button class="btn sm" data-act="openXls">' + I('download') + 'Excel</button><button class="btn sm primary" data-act="openKp">' + I('doc') + 'Собрать КП</button>') +
      '<div class="fin-obj-bar"><div class="fin-obj-ph" style="background-image:url(' + ph + ')"></div>' +
      '<label class="fld" style="flex:1"><span>Объект расчёта</span><select id="finObj" class="mini-sel" style="width:100%">' + objOpts + '</select></label></div>' +
      '<div id="finBody"></div>';
  }
  function lockedRow(label, val, hint, src) {
    return '<div class="arow locked"><div class="alabel"><label>' + I('lock') + ' ' + label + '</label>' + (hint ? '<div class="ahint">' + hint + '</div>' : '') + '</div>' +
      '<div class="lockval">' + val + '<div class="lsrc">' + src + '</div></div></div>';
  }
  function slider(key, label, val, min, max, step, fmt, hint) {
    return '<div class="arow"><div class="alabel"><label>' + label + '</label>' + (hint ? '<div class="ahint">' + hint + '</div>' : '') + '</div>' +
      '<div class="actl"><input type="range" data-calc="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="av" id="av_' + key + '">' + fmt(val) + '</span></div></div>';
  }

  // ---------------- SHOWS & PARTNERS ----------------
  const EV_SLOTS = ['сегодня 10:00', 'сегодня 14:00', 'сегодня 16:00', 'завтра 11:30', 'завтра 15:00', 'позже — по согласованию'];
  const EV_EXEC = ['Марина Волкова · агент', 'Юсеф Хаддад · клубный партнёр', 'Ахмед Салех · агент'];
  function evDay(when) { return (when || '').indexOf('сегодня') === 0 ? 'today' : (when || '').indexOf('завтра') === 0 ? 'tomorrow' : 'later'; }
  function eventRow(e) {
    const c = D().clients.find((x) => x.id === e.clientId) || {};
    const ic = e.kind === 'call' ? 'phone' : 'calendar';
    const canceled = e.status === 'canceled';
    const badge = canceled ? '<span class="badge stop">' + I('x') + 'отменён</span>'
      : e.status === 'done' ? '<span class="badge ok">' + I('check') + 'проведён</span>' : '';
    return '<div class="radar-row' + (canceled ? ' is-done' : '') + '" data-event="' + e.id + '" style="cursor:pointer"><div class="sev low"></div><div class="icon-tile i-info">' + I(ic) + '</div>' +
      '<div class="rt"><div class="t">' + e.title + ' ' + badge + '</div><div class="why">' + e.when + ' · ' + (c.name || '') + (e.executor ? ' · ' + e.executor.split(' · ')[0] : '') + '</div></div>' +
      '<div class="ra"><button class="btn sm" data-event="' + e.id + '">' + I('pencil') + 'Изменить</button></div></div>';
  }
  // ---- Календарь активностей: показы/звонки + задачи + входящие/исходящие, по дням ----
  // dir taxonomy (фильтр по агентам/направлению):
  //  me = что сделал я · agent = что сделал агент · out = что я назначил ·
  //  in = что назначил мне · incoming = входящее от клиента · outgoing = исходящее клиенту
  const CAL_DIRS = [['all', 'Все'], ['me', 'Сделал я'], ['agent', 'Сделал агент'], ['out', 'Я назначил'], ['in', 'Назначено мне'], ['incoming', 'Входящие'], ['outgoing', 'Исходящие']];
  const CAL_TYPES = [['all', 'Все типы'], ['показ', 'Показы'], ['звонок', 'Звонки'], ['задача', 'Задачи'], ['сообщение', 'Сообщения']];
  function calDayOf(w) { w = w || ''; return /просроч/.test(w) ? 'overdue' : /вчера|ранее/.test(w) ? 'past' : /сегодня/.test(w) ? 'today' : /завтра/.test(w) ? 'tomorrow' : 'later'; }
  // day index within the demo week (Mon..Sun = 0..6; demo «сегодня» = Чт 14 мая = 3)
  function calDayIdx(w) { w = w || ''; return /просроч/.test(w) ? 1 : /вчера|ранее/.test(w) ? 2 : /сегодня/.test(w) ? 3 : /завтра/.test(w) ? 4 : 5; }
  function objOfClient(cid) { const d = D().deals.find((x) => x.clientId === cid); return d ? d.objectId : null; }
  // Объект берётся у области задачи, а не у первой сделки клиента: задача второй сделки
  // рисовалась в календаре с объектом первой. У заявки объект не один, у поздравления его нет —
  // в обоих случаях пусто, и это честнее, чем приписать первый попавшийся. Единственное следствие:
  // такая задача не показывается в фильтре по конкретному объекту, где ей и не место.
  function objOfDeal(id) { const d = D().deals.find((x) => x.id === id); return d ? d.objectId : null; }
  function objOfTask(t) { return t.dealId ? objOfDeal(t.dealId) : null; }
  function calendarActivities() {
    const acts = [];
    const cn = (id) => { const c = D().clients.find((x) => x.id === id); return c ? c.name : ''; };
    const tn = (id) => { const m = TEAM.find((x) => x.id === id); return m ? m.name : id; };
    const meName = D().users.agent.name;
    const push = (a) => { a.dayIdx = calDayIdx(a.when); acts.push(a); };
    D().events.forEach((e) => {
      const done = e.status === 'done'; const exec = e.executor || '';
      const isTeam = exec && exec.indexOf(meName) < 0;
      push({ id: e.id, type: e.kind === 'call' ? 'звонок' : 'показ', when: e.when,
        dir: done ? (isTeam ? 'agent' : 'me') : (isTeam ? 'out' : 'me'),
        clientId: e.clientId, objectId: objOfClient(e.clientId),
        title: e.title, sub: (exec ? exec.split(' · ')[0] : 'я') + (cn(e.clientId) ? ' · ' + cn(e.clientId) : ''),
        open: { event: e.id } });
    });
    D().tasks.forEach((t) => {
      const done = t.status === 'done';
      const dir = t.assignedBy ? 'in' : t.assignee ? (done ? 'agent' : 'out') : 'me';
      const who = t.assignedBy ? 'от: ' + tn(t.assignedBy) : t.assignee ? 'назначено: ' + tn(t.assignee) : 'моя';
      push({ id: t.id, type: 'задача', when: t.due, dir: dir,
        clientId: t.clientId, objectId: objOfTask(t),
        title: t.title, sub: who + (cn(t.clientId) ? ' · ' + cn(t.clientId) : '') + (done ? ' · выполнено' : ''),
        open: t.scenario ? { scn: t.scenario } : { client: t.clientId } });
    });
    D().inbox.forEach((i) => {
      push({ id: i.id, type: 'сообщение', when: 'сегодня ' + i.at, dir: 'incoming',
        clientId: i.clientId, objectId: objOfClient(i.clientId),
        title: (cn(i.clientId) || 'Клиент') + ' — входящее', sub: (i.channel || 'сообщение') + ' · ' + (i.text || '').slice(0, 42), open: { nav: 'concierge' } });
    });
    // Объект берётся у того, что строка открывает. У заявки объект не один — пусто; у задачи по сделке
    // Виктора это объект именно её, а не первой сделки клиента, у которого их две.
    push({ id: 'cm_kp_igor', type: 'сообщение', when: 'вчера', dir: 'outgoing', clientId: 'c_overdue', objectId: null, title: 'Обещано КП — Игорь Лебедев', sub: 'WhatsApp · исходящее', open: { request: 'r_igor' } });
    push({ id: 'cm_assign_omar', type: 'задача', when: 'сегодня', dir: 'in', clientId: 'c_docs', objectId: objOfDeal('d_viktor'), title: 'Подготовить документы к сделке Виктора', sub: 'от: Омар Рахман (руководитель)', open: { deal: 'd_viktor' } });
    return acts;
  }
  function activityRow(a) {
    const ic = a.type === 'звонок' ? 'phone' : a.type === 'показ' ? 'calendar' : a.type === 'сообщение' ? 'chat' : 'check';
    const dirLabel = (CAL_DIRS.find((d) => d[0] === a.dir) || [])[1] || a.dir;
    const tone = a.dir === 'incoming' ? 'i-acc' : a.dir === 'outgoing' ? 'i-info' : a.dir === 'agent' || a.dir === 'in' ? 'i-info' : 'i-mut';
    const openBtn = a.open.event ? '<button class="btn sm" data-event="' + a.open.event + '">' + I('pencil') + 'Открыть</button>'
      : a.open.scn ? '<button class="btn sm primary" data-scn="' + a.open.scn + '">' + I('arrowRight') + 'Действие</button>'
      : a.open.deal ? '<button class="btn sm" data-deal="' + a.open.deal + '">' + I('eye') + 'Сделка</button>'
      : a.open.request ? '<button class="btn sm" data-request="' + a.open.request + '">' + I('eye') + 'Запрос</button>'
      : a.open.client ? '<button class="btn sm" data-client="' + a.open.client + '">' + I('eye') + 'К записи</button>'
      : '<button class="btn sm" data-nav="' + (a.open.nav || 'concierge') + '">' + I('arrowRight') + 'Открыть</button>';
    return '<div class="radar-row"><div class="sev"></div><div class="icon-tile ' + tone + '">' + I(ic) + '</div>' +
      '<div class="rt"><div class="t">' + a.title + ' <span class="badge">' + a.type + '</span> <span class="badge">' + dirLabel + '</span></div>' +
      '<div class="why">' + a.when + ' · ' + a.sub + '</div></div><div class="ra">' + openBtn + '</div></div>';
  }
  const CAL_WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const CAL_DATES = [11, 12, 13, 14, 15, 16, 17];
  function viewShows() {
    const st = S();
    const type = st.calType || 'all', dir = st.calDir || 'all', fObj = st.calObj || 'all', fClient = st.calClient || 'all';
    const week = st.calWeek || 0, day = (st.calDay == null ? -1 : st.calDay);
    let acts = calendarActivities().filter((a) =>
      (type === 'all' || a.type === type) && (dir === 'all' || a.dir === dir) &&
      (fObj === 'all' || a.objectId === fObj) && (fClient === 'all' || a.clientId === fClient));
    // filter controls
    const typeSel = miniSel('calType', type, CAL_TYPES);
    const objSel = miniSel('calObj', fObj, [['all', 'Все объекты']].concat(D().objects.map((o) => [o.id, o.name.split(',')[0]])));
    const clientSel = miniSel('calClient', fClient, [['all', 'Все клиенты']].concat(D().clients.map((c) => [c.id, c.name])));
    const dirChips = CAL_DIRS.map(([k, l]) => '<button class="chip ' + (dir === k ? '' : 'mut') + '"' + (dir === k ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + ' data-caldir="' + k + '">' + l + '</button>').join('');
    // week strip (mail-client style): clickable days with event dots
    const weekActs = week === 0 ? acts : [];
    const cells = CAL_WD.map((wd, i) => {
      const list = weekActs.filter((a) => a.dayIdx === i);
      const dots = list.slice(0, 4).map((a) => '<i class="cal-dot ' + (a.dir === 'incoming' ? 'in' : a.dir === 'outgoing' ? 'out' : a.type === 'показ' ? 'show' : '') + '"></i>').join('');
      const isToday = i === 3 && week === 0;
      return '<button class="cal-day' + (isToday ? ' today' : '') + (day === i ? ' sel' : '') + '" data-calday="' + i + '">' +
        '<div class="cal-dow">' + wd + '</div><div class="cal-date">' + CAL_DATES[i] + '</div>' +
        '<div class="cal-dots">' + dots + '</div>' + (list.length ? '<div class="cal-cnt">' + list.length + '</div>' : '') + '</button>';
    }).join('');
    const weekBar = '<div class="cal-weekbar"><button class="btn sm" data-act="calWeek" data-d="-1" title="Прошлая неделя">' + I('chevLeft') + '</button>' +
      '<div class="cal-wlabel">' + (week === 0 ? 'Эта неделя · 11–17 мая 2026' : week < 0 ? 'Прошлая неделя' : 'Следующая неделя') + '</div>' +
      '<button class="btn sm" data-act="calWeek" data-d="1" title="Следующая неделя">' + I('chevRight') + '</button>' +
      (day >= 0 ? '<button class="btn sm ghost" data-act="calDayClear">' + I('x') + 'весь список</button>' : '') + '</div>';
    const grid = '<div class="cal-grid">' + cells + '</div>';
    // agenda: day-filtered if a day is picked, else grouped by relative day
    let agenda = '';
    if (week !== 0) {
      agenda = '<div class="empty">' + I('calendar') + '<div style="font-weight:700;color:var(--ink)">На этой неделе событий нет</div><div style="margin-top:4px">Демо-данные — на неделе 11–17 мая.</div></div>';
    } else if (day >= 0) {
      const shown = acts.filter((a) => a.dayIdx === day);
      agenda = '<div class="section-label" style="margin-top:8px">' + CAL_WD[day] + ' ' + CAL_DATES[day] + ' мая · ' + shown.length + '</div>' +
        (shown.length ? shown.map(activityRow).join('') : '<div class="empty">' + I('calendar') + '<div>В этот день ничего</div></div>');
    } else {
      [['overdue', 'Просрочено'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['later', 'Позже'], ['past', 'Ранее']].forEach(([k, label]) => {
        const list = acts.filter((a) => calDayOf(a.when) === k);
        if (list.length) agenda += '<div class="section-label" style="margin-top:12px">' + label + ' · ' + list.length + '</div>' + list.map(activityRow).join('');
      });
      if (!agenda) agenda = '<div class="empty">' + I('calendar') + '<div>Под фильтр активностей нет</div></div>';
    }
    return head('Календарь', 'Встречи, показы, звонки, задачи и коммуникации. Неделя кликабельна — выберите день; фильтры по типу, направлению, объекту и клиенту.',
      '<button class="btn sm primary" data-scn="S3">' + I('calendar') + 'Назначить показ (S3)</button>') +
      '<div class="obj-toolbar">' + typeSel + objSel + clientSel + '</div>' +
      '<div class="qa-row" style="margin-bottom:12px">' + dirChips + '</div>' +
      weekBar + grid +
      '<div class="section-label">Повестка · ' + (day >= 0 ? weekActs.filter((a) => a.dayIdx === day).length : weekActs.length) + '</div>' + agenda +
      '<div class="card pad" style="margin-top:16px"><div class="section-label">Партнёры клуба (co-broking)</div>' +
      '<div style="font-size:12.5px;color:var(--mut);margin-bottom:10px">Партнёр подключается к конкретной сделке: обезличенный бриф → принятие → «команда карточки» со scoped-доступом.</div>' +
      '<button class="btn sm" data-scn="S6">' + I('handshake') + 'Подключить партнёра (S6)</button></div>';
  }
  function showCard(id) {
    const e = D().events.find((x) => x.id === id); if (!e) return;
    const c = D().clients.find((x) => x.id === e.clientId) || {};
    const exec = e.executor || EV_EXEC[1];
    const access = e.access || 'Ключи у консьержа здания, доступ по QR (DEMO)';
    const slotOpts = EV_SLOTS.map((s) => '<option value="' + s + '"' + (s === e.when ? ' selected' : '') + '>' + s + '</option>').join('');
    const execOpts = EV_EXEC.map((s) => '<option value="' + s + '"' + (s === exec ? ' selected' : '') + '>' + s + '</option>').join('');
    const canceled = e.status === 'canceled';
    const statusBadge = canceled ? '<span class="badge stop">' + I('x') + 'показ отменён</span>'
      : e.status === 'done' ? '<span class="badge ok">' + I('check') + 'проведён</span>'
      : '<span class="badge ok">' + I('check') + 'исполнитель принял</span>';
    const body = '<div class="prov" style="margin-bottom:12px">' + statusBadge + '<span class="badge">' + I('users') + (c.name || '') + '</span></div>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Слот</span><select id="evSlot">' + slotOpts + '</select></label>' +
      '<label class="fld"><span>Исполнитель</span><select id="evExec">' + execOpts + '</select></label>' +
      '<label class="fld"><span>Условия доступа</span><input id="evAccess" type="text" value="' + access.replace(/"/g, '&quot;') + '"></label>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:8px">Отчёт после показа возвращается в сделку клиента (сценарий S3).</div>';
    const footer = '<button class="btn" data-act="closeModal">Закрыть</button>' +
      (canceled
        ? '<button class="btn" data-act="eventRestore" data-ev="' + id + '">' + I('reset') + 'Восстановить</button>'
        : '<button class="btn danger" data-act="eventCancel" data-ev="' + id + '">' + I('x') + 'Отменить показ</button>') +
      '<button class="btn" data-artopen="s3_report">' + I('doc') + 'Отчёт (S3)</button>' +
      '<button class="btn primary" data-act="eventSave" data-ev="' + id + '">' + I('check') + 'Сохранить</button>';
    openModal('Показ · ' + e.title.replace('Показ ', '').replace('Звонок ', ''), body, footer);
  }
  function saveEvent(id) {
    const g = (x) => { const el = document.getElementById(x); return el ? el.value : ''; };
    WS.storeApi.updateEvent(id, { when: g('evSlot'), executor: g('evExec'), access: g('evAccess'), status: 'planned' });
    closeModal();
    WS.storeApi.toast('Показ обновлён', 'ok');
  }

  // ---------------- DOCUMENTS ----------------
  // Central document registry — one source of truth. Each filled document knows
  // which entities it belongs to, so deal/object/contact cards drill into "its" docs.
  // `open` = id understood by openArtifactId (artifact id or "doc:kind").
  function docRegistry() {
    return [
      { open: 'kp',          title: 'Коммерческое предложение',           status: 'ready',    deal: 'd_anna',   client: 'c_anna',    object: 'o_creekline', sub: 'подбор · G2' },
      { open: 'dossier',     title: 'Клиентское досье (off-plan)',        status: 'ready',    deal: 'd_anna',   client: 'c_anna',    object: 'o_creekline', sub: 'проверка проекта · S7' },
      { open: 'doc:formB',   title: 'Form B — договор с покупателем',     status: 'ready',    deal: 'd_anna',   client: 'c_anna',                           sub: 'RERA · представление клиента' },
      { open: 'doc:formF',   title: 'Form F — MOU (купля-продажа)',       status: 'draft',    deal: 'd_anna',   client: 'c_anna',    object: 'o_creekline', sub: 'RERA · сделка сторон' },
      { open: 'doc:formA',   title: 'Form A — договор с собственником',   status: 'ready',                                          object: 'o_creekline', sub: 'RERA · листинг объекта' },
      { open: 'doc:booking', title: 'Договор бронирования',               status: 'draft',    deal: 'd_viktor', client: 'c_docs',    object: 'o_bayline',   sub: 'бронь · S4' },
      { open: 'doc:oqood',   title: 'Форма Oqood (регистрация off-plan)', status: 'external', deal: 'd_viktor', client: 'c_docs',    object: 'o_bayline',   sub: 'DLD · внешний шаг' },
      { open: 'doc:formI',   title: 'Соглашение брокеров (Form I)',       status: 'draft',    request: 'r_karim', client: 'c_partner',                      sub: 'co-broking · S6' },
      { open: 's13_pkg',     title: 'Клубный пакет (адресная рассылка)',  status: 'ready',                                          object: 'o_palmcourt', sub: 'эксклюзив клуба · S13' },
      // Документы клиента. Собираются один раз — под заявку — и действуют по всем её сделкам:
      // паспорт не переподписывают на каждый договор, и требовать его дважды значит не помнить.
      { open: 'doc:passport', title: 'Паспорт и Emirates ID',               status: 'ready',    client: 'c_anna',    scope: 'client',       sub: 'KYC · удостоверение личности' },
      { open: 'doc:funds',    title: 'Подтверждение источника средств',     status: 'ready',    client: 'c_anna',    scope: 'client',       sub: 'AML · выписка банка' },
      { open: 'doc:passport', title: 'Паспорт и Emirates ID',               status: 'ready',    client: 'c_docs',    scope: 'client',       sub: 'KYC · удостоверение личности' },
      { open: 'doc:funds',    title: 'Подтверждение источника средств',     status: 'draft',    client: 'c_docs',    scope: 'client',       sub: 'AML · запрошено банком' },
    ];
  }
  const DOC_ST = { ready: ['ok', 'check', 'готов'], draft: ['warn', 'clock', 'черновик'], external: ['info', 'link', 'внешний шаг'], phase: ['', 'clock', 'Фаза 3'] };
  function docClientName(d) { const c = D().clients.find((x) => x.id === d.client); return c ? c.name : ''; }
  // entity links of a document — shows it belongs to distinct sets (сделка/объект/контакт)
  // yet is the SAME registry record reused across scenarios.
  function docLinks(d) {
    const chips = [];
    if (d.deal) { const dl = D().deals.find((x) => x.id === d.deal); chips.push('<span class="badge">' + I('briefcase') + 'сделка: ' + (dl ? dl.title : d.deal) + '</span>'); }
    if (d.request) { const rq = (D().requests || []).find((x) => x.id === d.request); chips.push('<span class="badge">' + I('mail') + 'запрос: ' + (rq ? rq.title : d.request) + '</span>'); }
    if (d.object) { const o = D().objects.find((x) => x.id === d.object); chips.push('<span class="badge">' + I('building') + 'объект: ' + (o ? o.name.split(',')[0] : d.object) + '</span>'); }
    if (d.client) { const c = D().clients.find((x) => x.id === d.client); chips.push('<span class="badge">' + I('users') + 'контакт: ' + (c ? c.name : d.client) + '</span>'); }
    return chips.length ? '<div class="prov" style="margin-top:4px">' + chips.join('') + '</div>' : '';
  }
  function docRow(d, withWho) {
    const s = DOC_ST[d.status] || DOC_ST.ready;
    const who = withWho && docClientName(d) ? docClientName(d) + ' · ' : '';
    const links = withWho ? docLinks(d) : ''; // show entity links only in the central Documents view
    // Унаследованный документ помечен источником: иначе он читается как собранный здесь, и агент
    // не понимает, почему правка на этой карточке не обновила его в соседней.
    const from = d.from ? '<span class="badge doc-from">' + I('arrowRight') + d.from + '</span>' : '';
    return '<div class="feed-row"><div class="fi i-acc">' + I('doc') + '</div><div class="ft"><div class="t">' + d.title + from + '</div><div class="m">' + who + (d.sub || '') + '</div>' + links + '</div>' +
      '<span class="badge ' + s[0] + '">' + I(s[1]) + s[2] + '</span>' +
      '<button class="btn sm" data-artopen="' + d.open + '" style="margin-left:8px">' + I('eye') + 'Открыть</button></div>';
  }
  function docsFor(pred) { return docRegistry().filter(pred); }
  // ============================================================================================
  // Четыре области документа: объект, клиент, заявка, сделка. Область — это владелец, а не
  // ссылка: у документа сделки в записи стоит и клиент, но принадлежит он сделке.
  //
  // Наследование идёт вниз по тому же пути, по которому шла работа: клиентские документы видны
  // в каждой заявке и в каждой сделке этого клиента, документы заявки — во всех сделках, из неё
  // выросших. Это и есть требование «переиспользовать собранное по клиенту»: агент не собирает
  // паспорт заново на второй договор, а видит, что он уже есть.
  // ============================================================================================
  function docScope(x) {
    return x.scope || (x.deal ? 'deal' : x.request ? 'request' : x.object ? 'object' : x.client ? 'client' : 'other');
  }
  const SCOPE_FROM = { client: 'по клиенту', request: 'из запроса', object: 'по объекту' };
  // Документы сделки: свои плюс унаследованные — от заявки, из которой она выросла, и от клиента.
  function docsOfDeal(d) {
    if (!d) return [];
    // Документы объекта — по КАЖДОМУ лоту: Trakheesi и Form A нужны на каждый юнит, который
    // уходит по этому договору, и показать их только по головному объекту значит спрятать
    // отсутствие разрешения по второму.
    const lots = {};
    ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => { if (id) lots[id] = 1; });
    return docRegistry().filter((x) => {
      const sc = docScope(x);
      if (sc === 'deal') return x.deal === d.id;
      if (sc === 'request') return !!d.requestId && x.request === d.requestId;
      if (sc === 'client') return x.client === d.clientId;
      if (sc === 'object') return !!lots[x.object];
      return false;
    }).map((x) => Object.assign({}, x, { from: SCOPE_FROM[docScope(x)] || '' }));
  }
  // Документы заявки: свои плюс клиентские. Документы её сделок сюда не поднимаются — заявка
  // не отвечает за договорную работу, и подтянуть их значило бы показать чужой этап как свой.
  function docsOfRequest(r) {
    if (!r) return [];
    return docRegistry().filter((x) => {
      const sc = docScope(x);
      if (sc === 'request') return x.request === r.id;
      if (sc === 'client') return x.client === r.clientId;
      return false;
    }).map((x) => Object.assign({}, x, { from: SCOPE_FROM[docScope(x)] || '' }));
  }
  // A drill-down "Документы …" block for an entity card (deal/object/contact).
  function docsRows(list, emptyHint) {
    return list.length ? list.map((d) => docRow(d, false)).join('')
      : '<div style="font-size:12px;color:var(--faint);padding:6px 0">' + (emptyHint || 'документов по этой записи пока нет') + '</div>';
  }
  function docsBlock(label, list, emptyHint) {
    return '<div class="section-label" style="margin-top:16px">' + label + ' · ' + list.length + '</div>' + docsRows(list, emptyHint);
  }

  function viewDocs() {
    // Dubai / RERA standard forms + deal documents used across scenarios
    const templates = [
      ['Коммерческое предложение (КП)', 'КП по подбору · G2', 'kp', 'ready'],
      ['Клиентское досье (off-plan)', 'Проверка проекта · S7', 'dossier', 'ready'],
      ['Договор бронирования', 'Reservation / бронь · S4', 'booking', 'draft'],
      ['Form A — договор с собственником', 'RERA · листинг объекта', 'formA', 'ready'],
      ['Form B — договор с покупателем', 'RERA · представление клиента', 'formB', 'ready'],
      ['Form F — MOU (купля-продажа)', 'RERA · сделка сторон', 'formF', 'draft'],
      ['Form I — соглашение брокеров (A2A)', 'RERA · co-broking · S6', 'formI', 'ready'],
      ['Форма Oqood (регистрация off-plan)', 'DLD · внешний шаг', 'oqood', 'external'],
      ['Договор аренды + Ejari', 'аренда · Фаза 3', 'ejari', 'phase'],
    ];
    const stMap = DOC_ST;
    // deal documents = filled instances tied to a deal/object/contact (from the registry)
    const dealDocs = docRegistry();
    const st = S();
    const q = (st.docSearch || '').toLowerCase().trim();
    const tab = st.docTab || 'all';
    const matchT = (arr) => q ? arr.filter((r) => r.join(' ').toLowerCase().indexOf(q) >= 0) : arr;
    const matchD = (arr) => q ? arr.filter((d) => (d.title + ' ' + (d.sub || '') + ' ' + docClientName(d)).toLowerCase().indexOf(q) >= 0) : arr;

    const tplRow = ([t, sub, k, s]) => {
      const [cls, ic, lbl] = stMap[s];
      return '<div class="feed-row"><div class="fi i-mut">' + I('doc') + '</div><div class="ft"><div class="t">' + t + '</div><div class="m">' + sub + '</div></div>' +
        '<span class="badge ' + cls + '">' + I(ic) + lbl + '</span>' +
        '<button class="btn sm" data-doc="' + k + '" style="margin-left:8px">' + I('eye') + 'Открыть</button></div>';
    };
    const tplList = matchT(templates);
    const dealList = matchD(dealDocs);
    const seg = '<div class="seg" style="margin-bottom:12px">' +
      ['all::Все', 'deals::Документы сделок', 'templates::Шаблоны', 'storage::Файлы'].map((o) => { const [k, l] = o.split('::'); return '<button class="' + (tab === k ? 'on' : '') + '" data-act="doctab" data-tab="' + k + '">' + l + '</button>'; }).join('') + '</div>';
    const searchBox = '<div class="prompt obj-search" style="margin-bottom:12px"><span class="ico">' + I('search') + '</span>' +
      '<input id="docSearch" type="text" placeholder="Поиск по документам, клиенту, форме…" value="' + (st.docSearch || '').replace(/"/g, '&quot;') + '" autocomplete="off">' +
      (q ? '<button class="voice" data-act="docClear" title="Очистить">' + I('x') + '</button>' : '') + '</div>';
    const dealsSection = (tab === 'all' || tab === 'deals')
      ? '<div class="card" style="margin-bottom:14px"><div class="section-label" style="padding:12px 16px 4px">Документы сделок · ' + dealList.length + '</div>' +
        '<div class="feed" style="padding:0 16px 8px">' + (dealList.length ? dealList.map((d) => docRow(d, true)).join('') : '<div style="font-size:12px;color:var(--faint);padding:8px 0">ничего не найдено</div>') + '</div></div>' : '';
    const tplSection = (tab === 'all' || tab === 'templates')
      ? '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Библиотека шаблонов · ' + tplList.length + '</div>' +
        '<div class="feed" style="padding:0 16px 8px">' + (tplList.length ? tplList.map(tplRow).join('') : '<div style="font-size:12px;color:var(--faint);padding:8px 0">ничего не найдено</div>') + '</div></div>' : '';
    // Хранилище файлов — загруженные файлы, сгруппированные по сущности (сделка · объект · личные).
    const fIco = { pdf: 'doc', img: 'eye', xls: 'grid', zip: 'layers' };
    const storageFolders = [
      ['Сделка · Анна Петрова', [['Form F — MOU.pdf', 'pdf', '240 КБ', '14 мая'], ['Паспорт покупателя.jpg', 'img', '1,2 МБ', '12 мая'], ['Payment plan.xlsx', 'xls', '88 КБ', '12 мая']]],
      ['Объект · Creekline 1208', [['Планировка 1BR.pdf', 'pdf', '610 КБ', '2 мая'], ['Фотогалерея.zip', 'zip', '24 МБ', '2 мая'], ['Trakheesi permit.pdf', 'pdf', '120 КБ', '5 мая']]],
      ['Личные', [['RERA BRN сертификат.pdf', 'pdf', '180 КБ', '1 апр'], ['Подпись.png', 'img', '40 КБ', '1 апр']]],
    ];
    const storageSection = (tab === 'storage' || (tab === 'all' && !q))
      ? '<div class="card" style="margin-bottom:14px"><div class="section-label" style="padding:12px 16px 4px">Хранилище файлов</div><div style="padding:0 16px 12px">' +
        storageFolders.map((f) => '<div class="store-folder"><div class="store-fhead">' + I('layers') + '<span>' + f[0] + '</span><span class="store-count">' + f[1].length + '</span></div>' +
          f[1].map((x) => '<div class="feed-row"><div class="fi i-mut">' + I(fIco[x[1]] || 'doc') + '</div><div class="ft"><div class="t">' + x[0] + '</div><div class="m">' + x[2] + ' · ' + x[3] + '</div></div><button class="btn sm" data-act="cgFeatureStub" title="Скачать">' + I('download') + '</button></div>').join('') +
        '</div>').join('') +
        '<button class="btn sm" data-act="cgFeatureStub" style="margin-top:10px">' + I('upload') + 'Загрузить файл</button></div></div>' : '';
    return head('Документы', 'Два слоя: документы конкретных сделок (заполненные экземпляры) и библиотека шаблонов (RERA A/B/F/I, Oqood, КП, досье, аренда). Каждый документ привязан к своим сущностям — <b>сделка · объект · контакт</b> — это раздельные множества вокруг записи, не смешанные; при этом один документ переиспользуется в разных сценариях (виден в карточке каждой связанной сущности). Поиск по названию, клиенту или форме.',
      '<button class="btn sm primary" data-scn="S4">' + I('plus') + 'Подготовить документ (S4)</button>') +
      searchBox + seg +
      '<div class="fin"><div>' + dealsSection + tplSection + storageSection + '</div>' +
      docViewer() + '</div>';
  }
  function openDoc(kind) {
    if (kind === 'kp') return openKp();
    if (kind === 'dossier') return openDossier();
    const meta = {
      booking: ['Договор бронирования', [['Клиент', 'Виктор Орлов'], ['Объект', 'Bayline Terraces 1603'], ['Цена', '1 950 000 AED'], ['Депозит (5%)', '97 500 AED'], ['Дата заезда', '— (обязательное)']]],
      formA: ['Form A — договор с собственником (RERA)', [['Собственник', 'DEMO Owner'], ['Объект', 'Creekline 1208'], ['Тип', 'Эксклюзив на продажу'], ['Комиссия', '2%'], ['Trakheesi', 'требуется до публикации']]],
      formB: ['Form B — договор с покупателем (RERA)', [['Клиент', 'Анна Петрова'], ['Услуга', 'Подбор и представление'], ['Бюджет', 'до 2 000 000 AED'], ['Комиссия', '2%']]],
      formF: ['Form F — MOU купли-продажи (RERA)', [['Продавец', 'DEMO Owner'], ['Покупатель', 'Анна Петрова'], ['Объект', 'Creekline 1208'], ['Цена', '1 820 000 AED'], ['Депозит', '10%'], ['Статус', 'черновик — подписи сторон']]],
      formI: ['Form I — соглашение брокеров A2A (RERA)', [['Брокер 1', 'Harbour Key Realty'], ['Брокер 2', 'клубный партнёр'], ['Объект', 'Downtown'], ['Сплит комиссии', '50 / 50'], ['Раскрытие контакта', 'после принятия']]],
      oqood: ['Форма Oqood — регистрация off-plan (DLD)', [['Объект', 'Bayline Terraces 1603'], ['Застройщик', 'DEMO Developer'], ['Статус', 'внешний шаг — очередь DLD'], ['Требуется', 'подпись сторон, оплата DLD 4%']]],
      passport: ['Паспорт и Emirates ID', [['Область', 'Документ клиента — действует по всем его запросам и сделкам'], ['Проверка', 'KYC пройден'], ['Срок действия', 'до 08.2029'], ['Где используется', 'Form B, договор бронирования, регистрация']]],
      funds: ['Подтверждение источника средств', [['Область', 'Документ клиента — действует по всем его запросам и сделкам'], ['Основание', 'AML / требование банка'], ['Форма', 'выписка + справка о происхождении средств'], ['Где используется', 'эскроу, ипотечная заявка, регистрация']]],
      ejari: ['Договор аренды + Ejari (Фаза 3)', [['Объект', '—'], ['Статус', 'вне MVP — включается с арендой (Фаза 3)']]],
    };
    const m = meta[kind]; if (!m) { WS.router.go('docs'); return; }
    const body = wsDocHead('Шаблон документа', m[0], 'RERA / DLD · WeSpace') +
      wsRows(m[1].map((f) => ({ k: f[0], v: f[1] }))) +
      wsDocFoot('Шаблон · источники подтверждаются при заполнении · BRN DEMO-0000');
    openModal(m[0] + ' · шаблон', body, '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn primary" data-scn="S4">' + I('doc') + 'Заполнить (S4)</button>');
  }
  function openDossier() {
    const body = wsDocHead('Клиентское досье', 'Проверка проекта (off-plan)', 'Разделение по достоверности источников · S7') +
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Досье делит сведения на три группы:</p>' +
      '<div class="field stack"><div class="k"><span class="badge ok">' + I('check') + 'Подтверждено официально</span></div><div class="v">Застройщик, статус проекта, escrow (при доступе к DLD)</div></div>' +
      '<div class="field stack"><div class="k"><span class="badge warn">' + I('warn') + 'Со слов застройщика</span></div><div class="v">Сроки сдачи, планировки, доходность из брошюры</div></div>' +
      '<div class="field stack"><div class="k"><span class="badge stop">' + I('lock') + 'Требует проверки</span></div><div class="v">Недоступные источники → ручная задача</div></div>' +
      '<div class="ws-flag" style="background:var(--surface-2);border-color:var(--line);color:var(--mut)">' + I('lock') + ' Не является юридическим заключением.</div>' +
      wsDocFoot('Клиентское досье · WeSpace · S7');
    openModal('Клиентское досье (off-plan)', body, '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn primary" data-scn="S7">' + I('play') + 'Собрать досье (S7)</button>');
  }
  // ---------------- SCENARIO RESULT ARTIFACTS (openable documents) ----------------
  const ART = {
    s8_brief: { title: 'Переговорный бриф · Анна Петрова', rows: [
      { h: 'Цель разговора' }, { k: 'Цель', v: 'Согласовать объект и снять возражение по первому платежу' },
      { h: 'История и обещания' }, { k: 'Отправлено', v: 'КП с 3 объектами (сегодня)' }, { k: 'Обещание', v: 'Уточнённый график платежей' },
      { h: 'Сравнение объектов' }, { k: 'Creekline 1208', v: 'ROI 39,40% · net 5,28%' }, { k: 'Palm Court 704', v: 'ниже бюджета · net 5,67% (предпочитает)' },
      { h: 'Аргументы (с источниками)' }, { k: 'Доходность', v: 'финмодель по объекту · допущения видны' }, { k: 'Клуб', v: 'Palm Court — эксклюзив клуба' },
      { h: 'Факты ↔ гипотезы' }, { k: 'Факт', v: 'бюджет до 2 млн, срок 1–3 мес' }, { k: 'Гипотеза', v: 'чувствителен к первому платежу (не подтверждено)' },
      { h: 'Портрет клиента (сигналы стиля)' },
      { k: 'Тип решения', v: 'Аналитик — цифры и факты' }, { k: 'Что важно', v: 'доходность, безопасность сделки' },
      { k: 'Тон', v: 'по делу, с расчётами, без давления' }, { k: 'Триггеры', v: 'график первого платежа, подтверждённая доходность' },
      { k: 'Как вести', v: 'дать цифры и источники; для мессенджеров — короткие сообщения с конкретикой' },
      { k: 'Провенанс', v: 'сигналы стиля из переписки · за согласием (PDPL), человек в контуре' },
      { h: 'Структура и следующий шаг' }, { k: 'Структура', v: 'возражение → график → закрытие на показ' }, { k: 'Следующий шаг', v: 'после звонка — зафиксировать итог (G3)' },
    ] },
    s3_report: { title: 'Отчёт о показе · Creekline 1208', rows: [
      { k: 'Клиент', v: 'Анна Петрова' }, { k: 'Объект', v: 'Creekline 1208' }, { k: 'Слот', v: 'сегодня 16:00' },
      { k: 'Исполнитель', v: 'Юсеф Хаддад · клубный партнёр' }, { k: 'Итог', v: 'клиент пришёл, объект понравился' },
      { h: 'Материалы' }, { k: 'Фото', v: '6 снимков (DEMO)' }, { k: 'Геопозиция', v: 'зафиксирована (опционально)' },
      { k: 'Передано в сделку', v: 'да — обновление в G3' },
    ] },
    s10_pkg: { title: 'Публикационный пакет · Marina Heights', rows: [
      { h: 'Контент' }, { k: 'Описание', v: '3 варианта под каналы' }, { k: 'Креативы', v: 'обложка + карусель (DEMO)' },
      { h: 'Обязательные проверки' }, { k: 'Trakheesi', v: 'в процессе' }, { k: 'Madmoun QR', v: 'ОТСУТСТВУЕТ — публикация заблокирована' },
      { k: 'Статус', v: 'внутренний пакет готов; публикация — после получения QR (ручная задача)' },
    ] },
    s13_pkg: { title: 'Клубный пакет · адресная рассылка', rows: [
      { k: 'Эксклюзив', v: 'Palm Court 704 (клуб)' }, { k: 'Совпадений', v: '4 активных запроса' },
      { k: 'Получатели', v: '3 клиента с действующим согласием' }, { k: 'Исключён', v: 'Марат Ибрагимов (нет согласия)' },
      { h: 'Персональные черновики' }, { k: 'Формат', v: 'адресный, обоснован совпадением; массовой рассылки нет' },
    ] },
    s2_card: { title: 'Карточка объекта · Marina Heights (DEMO)', rows: [
      { k: 'Проект', v: 'Marina Heights' }, { k: 'Район', v: 'Business Bay' }, { k: 'Площадь', v: '82 м²' },
      { k: 'Цена', v: '1 820 000 AED (разрешён конфликт вручную)' },
      { h: 'Статус проверки' }, { k: 'Состояние', v: 'AGENT_CONFIRMED' }, { k: 'Не', v: 'SOURCE_VERIFIED — нужна проверка источника' },
      { k: 'Задача', v: 'проверить источник до публикации' },
    ] },
    s14_draft: { title: 'Ночной лид · черновик A1', rows: [
      { k: 'Лид', v: 'Sarah Mansour' }, { k: 'Время', v: '02:14' }, { k: 'Запрос', v: '1BR под аренду, ~1,3 млн, JVC' },
      { h: 'Подготовлено (без отправки)' }, { k: 'Черновик запроса', v: 'создан' }, { k: 'Ответ A1', v: 'шаблон подтверждения получения' },
      { k: 'Очередь', v: '«Ожидает агента» · SLA виден руководителю' }, { k: 'Утром', v: 'подтвердить в один шаг → G1' },
    ] },
    s9_avail: { title: 'Проверка доступности · результат', rows: [
      { k: 'Bayline 1603', v: 'НЕТ ОТВЕТА → ручная очередь (не «доступен»)' }, { k: 'Palm Court 704', v: 'доступен · клуб · сегодня 09:20' },
      { k: 'Creekline 1208', v: 'доступен · агентство · сегодня 09:20' },
      { h: 'Правила' }, { k: 'Повтор', v: 'в тот же день заблокирован' }, { k: 'Источник и время', v: 'видны у каждого результата' },
    ] },
    s15_proposal: { title: 'Ответ холодному лиду', rows: [
      { k: 'Запрос', v: 'инвест. квартира до 1,5 млн' }, { h: 'Три варианта (3 источника)' },
      { k: 'Доступность', v: 'неподтверждённая — помечена, сомнительный → S9' },
      { k: 'Расчёт', v: 'короткий, допущения видны' }, { k: 'Итог', v: 'создан запрос + следующее касание' },
    ] },
    s6_handover: { title: 'Передача партнёру · история', rows: [
      { k: 'Партнёр', v: 'клубный партнёр (принял)' }, { k: 'Формат', v: 'совместный показ' },
      { k: 'Доступ', v: 'ссылка со scoped-доступом (TTL, отзыв) — команда карточки' },
      { k: 'Контакт клиента', v: 'раскрыт только после принятия (PDPL / A2A)' }, { k: 'Результат', v: 'вернётся в сделку' },
    ] },
  };
  function openArtifactId(id) {
    if (id === 'kp') return openKp();
    if (id === 'xls') return openXls();
    if (id === 's8_brief') return openBriefS8();
    if (id === 'dossier') return openDossier();
    if (id.indexOf('client:') === 0) return clientCard(id.slice(7));
    if (id.indexOf('request:') === 0) return requestCard(id.slice(8));
    if (id.indexOf('object:') === 0) return objectCard(id.slice(7));
    if (id.indexOf('doc:') === 0) return openDoc(id.slice(4));
    if (id.indexOf('nav:') === 0) { WS.router.go(id.slice(4)); return; }
    const a = ART[id]; if (!a) { WS.storeApi.toast('Результат: ' + id); return; }
    const body = wsDocHead('Документ', a.title, 'WeSpace · демонстрационный артефакт') + wsRows(a.rows) +
      wsDocFoot('Источники и статусы указаны рядом с данными · WeSpace · BRN DEMO-0000');
    openModal(a.title, body, '<button class="btn primary" data-act="closeModal">Закрыть</button>');
  }

  function docViewer() {
    return '<div class="doc-viewer"><div class="doc-page">' +
      '<div style="font-weight:800;font-size:14px">Harbour Key Realty LLC</div>' +
      '<div style="color:#8a7e6e;font-size:9px;letter-spacing:.1em;text-transform:uppercase">Договор бронирования · DEMO</div>' +
      '<div style="height:1px;background:#e2dacb;margin:12px 0"></div>' +
      '<div style="line-height:1.8"><b>Клиент:</b> Виктор Орлов<br><b>Объект:</b> Bayline Terraces, 1603<br><b>Цена:</b> 1 950 000 AED<br><b>Депозит:</b> 97 500 AED<br><b style="color:#b7791f">Дата заезда: ______ (не заполнено)</b></div>' +
      '<div style="margin-top:14px;padding:8px;background:#f9e4de;border:1px solid #eec0b4;border-radius:6px;font-size:9px;color:#b3341f">Экспорт заблокирован: обязательное поле не заполнено.</div>' +
      '<div style="position:absolute;bottom:20px;left:26px;right:26px;font-size:8px;color:#9a8f7c;border-top:1px solid #ece5d7;padding-top:6px">Паспорт документа: v1 · источники подтверждены · BRN DEMO-0000 · QR DEMO</div>' +
      '</div></div>';
  }

  // ---------------- WORK QUEUE (merged into "Рабочий день", S5) ----------------
  const TEAM = [
    { id: 'u_marina', name: 'Марина Волкова' },
    { id: 'u_ahmed', name: 'Ахмед Салех' },
    { id: 'u_lina', name: 'Лина Хассан' },
  ];
  function taskRow(t) {
    const kindIcon = { touch: 'flame', call: 'phone', doc: 'doc', manual: 'handshake', kp: 'doc' };
    const sevFor = (when) => when === 'overdue' ? 'high' : when === 'today' ? '' : 'low';
    const toneFor = (sev, kind) => sev === 'high' ? 'stop' : kind === 'call' ? 'acc' : kind === 'doc' || kind === 'manual' ? 'info' : 'warn';
    const c = D().clients.find((x) => x.id === t.clientId) || {};
    const done = t.status === 'done';
    const sev = done ? '' : sevFor(t.when);
    const ic = done ? 'check' : (kindIcon[t.kind] || 'target');
    const asg = t.assignee ? (TEAM.find((m) => m.id === t.assignee) || {}).name : null;
    const tags = (t.snoozed && !done ? '<span class="badge low">' + I('clock') + 'отложено</span>' : '') +
      (asg ? '<span class="badge info">' + I('users') + asg + '</span>' : '');
    const base = t.why ? (t.why + ' · срок: ' + t.due) : ('Срок: ' + t.due);
    const meta = '<div class="why">' + base + (tags ? ' ' + tags : '') + '</div>';
    let actions;
    if (done) {
      actions = '<button class="btn sm" data-taskreopen="' + t.id + '">' + I('reset') + 'Вернуть</button>';
    } else {
      const primary = t.scenario
        ? '<button class="btn sm primary" data-scn="' + t.scenario + '">' + I('arrowRight') + 'Действие</button>'
        : '<button class="btn sm" data-task="' + t.id + '">' + I('eye') + 'Открыть</button>';
      actions = primary +
        '<button class="btn sm" data-taskdone="' + t.id + '" title="Отметить выполненной">' + I('check') + 'Выполнить</button>' +
        '<button class="btn sm ghost" data-tasksnooze="' + t.id + '" title="Отложить на завтра">' + I('clock') + '</button>' +
        '<button class="btn sm ghost" data-taskreassign="' + t.id + '" title="Переназначить">' + I('users') + '</button>';
    }
    return '<div class="radar-row' + (done ? ' is-done' : '') + '"><div class="sev ' + sev + '"></div><div class="icon-tile i-' + toneFor(sev, t.kind) + '">' + I(ic) + '</div>' +
      '<div class="rt"><div class="t">' + t.title + '</div>' + meta + '</div><div class="ra">' + actions + '</div></div>';
  }
  // Async inbox rows (voice / night) that still need triage — sit atop the task queue.
  function inboxQueueRows() {
    let rows = '';
    if (D().inbox.some((i) => i.id === 'in_anna_vn')) {
      rows += '<div class="radar-row"><div class="sev"></div><div class="icon-tile i-acc">' + I('mic') + '</div>' +
        '<div class="rt"><div class="t">Голосовое от Анны Петровой</div><div class="why">WhatsApp · 09:05 · инвестиция до 2 млн — ожидает разбора</div></div>' +
        '<div class="ra"><button class="btn sm primary" data-scn="G1">' + I('play') + 'Разобрать</button></div></div>';
    }
    D().inbox.filter((i) => i.kind === 'night').forEach((i) => {
      const c = D().clients.find((x) => x.id === i.clientId) || {};
      rows += '<div class="radar-row"><div class="sev"></div><div class="icon-tile i-beta">' + I('moon') + '</div>' +
        '<div class="rt"><div class="t">' + (c.name || 'Ночной лид') + ' — ночной лид</div><div class="why">Пришёл в ' + i.at + ', ожидает ответа агента (S14)</div></div>' +
        '<div class="ra"><button class="btn sm primary" data-scn="S14">' + I('arrowRight') + 'Действие</button></div></div>';
    });
    // R6: exception queue — AI-flagged items needing triage (dup / no-consent / unknown object / delivery fail)
    D().inbox.filter((i) => i.kind === 'exception').forEach((i) => {
      const m = EX_META[i.ex] || { ic: 'warn', label: 'Исключение', act: 'Разобрать', tone: 'i-beta' };
      rows += '<div class="radar-row"><div class="sev"></div><div class="icon-tile ' + m.tone + '">' + I(m.ic) + '</div>' +
        '<div class="rt"><div class="t">' + m.label + '</div><div class="why">' + i.channel + ' · ' + i.at + ' · ' + i.text + '</div></div>' +
        '<div class="ra"><button class="btn sm primary" data-exresolve="' + i.id + '">' + I('check') + m.act + '</button></div></div>';
    });
    return rows;
  }
  // R6 exception types + resolution. AI qualifies (tier 2) → «Преобразовать» creates a kanban deal.
  const EX_META = {
    qualify: { ic: 'flame', label: 'Требует квалификации', act: 'Квалифицировать', tone: 'i-acc' },
    duplicate: { ic: 'users', label: 'Возможный дубль контакта', act: 'Объединить', tone: 'i-beta' },
    noconsent: { ic: 'lock', label: 'Лид без согласия', act: 'Запросить согласие', tone: 'i-stop' },
    unknown_object: { ic: 'building', label: 'Неизвестный объект', act: 'Уточнить', tone: 'i-beta' },
    delivery_fail: { ic: 'warn', label: 'Сбой доставки', act: 'Повторить', tone: 'i-stop' },
  };
  function resolveException(id) {
    const data = D(); const i = (data.inbox || []).find((x) => x.id === id); if (!i) return;
    if (i.ex === 'qualify' || i.ex === 'unknown_object') {
      const c = data.clients.find((x) => x.id === i.clientId) || {};
      const newId = 'd_ex_' + id;
      if (!data.deals.find((d) => d.id === newId)) {
        data.deals.push({ id: newId, clientId: i.clientId, objectId: i.ex === 'unknown_object' ? null : 'o_creekline', agent: 'u_marina', amount: c.budget || 1500000, hot: true, stage: 'work', title: (c.name || 'Новый лид'), sub: 'Квалифицировано из исключения', tags: ['из инбокса'], updated: 'сейчас', funnel: 'sale', dealType: 'Продажа', objectType: 'апартаменты', readiness: 'оффплан', saleKind: 'первичка', side: 'покупатель', goal: c.goal || 'Инвестиция', paymentForm: 'Рассрочка от застройщика', vat: false, source: 'Импорт', partnerAgent: null, companyId: null, consideredProjects: [], stageDays: 0, prov: { budget: 'ai', source: 'ai', goal: 'ai', objectType: 'ai', paymentForm: 'ai' } });
      }
      data.inbox = data.inbox.filter((x) => x.id !== id);
      WS.storeApi.toast('Квалифицировано → создана сделка в канбане (стадия «В работе»)', 'ok');
      WS.store.clientsTab = 'deals'; WS.store.dealFunnel = 'sale';
      WS.router.go('clients');
      return;
    }
    const msg = { duplicate: 'Контакты объединены — с доказательствами (A2)', noconsent: 'Запрошено согласие (PDPL); адресные отправки заблокированы', delivery_fail: 'Повторная отправка — имитировано' }[i.ex] || 'Обработано';
    data.inbox = data.inbox.filter((x) => x.id !== id);
    WS.storeApi.toast(msg, 'ok'); WS.storeApi.emit();
  }
  // Agent's personal live queue (inner HTML — embedded into "Рабочий день").
  function workQueueAgent() {
    const all = D().tasks;
    const open = all.filter((t) => t.status !== 'done');
    const done = all.filter((t) => t.status === 'done');
    const inbox = inboxQueueRows();
    let rows = inbox + open.map(taskRow).join('');

    if (!rows) rows = '<div class="empty">' + I('checkCircle') + '<div style="font-weight:700;color:var(--ink)">Очередь пуста — всё разобрано</div><div style="margin-top:6px">Запустите сценарий из навигатора или добавьте задачу вручную.</div></div>';

    const doneBlock = done.length
      ? '<div class="section-label" style="margin-top:20px">Выполнено сегодня · ' + done.length + '</div>' + done.map(taskRow).join('')
      : '';
    return rows + doneBlock;
  }
  // Пульс разгружен: вместо полной очереди — только «Мои дела» (сегодня/просрочено) + вход на экран «Задачи».
  /* ---- Сделки без следующего шага (§3.3 решений) ----
     Требование партнёра «сделок без запланированных событий быть не должно» превращается
     не в предупреждение, а в РАЗБИРАЕМЫЙ СПИСОК: предупреждение без списка бесполезно —
     агент видит, что что-то не так, и не знает, где именно. */
  function dealHasNextStep(d) {
    // Клиентская задача следующим шагом сделки не считается: «поздравить с днём рождения»
    // сделку не двигает, и засчитывать её значило бы прятать настоящую дыру.
    const task = (D().tasks || []).some((t) => t.dealId === d.id && t.status !== 'done' && t.when !== 'overdue');
    if (task) return true;
    return (D().events || []).some((e) => e.dealId === d.id && e.status !== 'canceled');
  }
  function dealsWithoutNextStep(agentId) {
    return (D().deals || []).filter((d) => !dealClosed(d) && (!agentId || d.agent === agentId) && !dealHasNextStep(d));
  }
  function pulseNoNextStep() {
    const mgr = S().role === 'manager';
    const list = dealsWithoutNextStep(mgr ? null : (D().users[S().role] || {}).id);
    if (!list.length) return '';                       // пустой список блок не рисует
    const rows = list.map((d) => {
      const c = D().clients.find((x) => x.id === d.clientId) || {};
      const who = mgr && d.agent ? ' · ' + agentName(d.agent) : '';
      return '<div class="rel-row" data-deal="' + d.id + '" style="cursor:pointer">' +
        '<div class="fi i-hot">' + I('warn') + '</div>' +
        '<div class="ft"><div class="t">' + escAttr(d.title) + '</div>' +
        '<div class="m">' + (c.name || '—') + ' · ' + stageLabel(d.stage) + who + '</div></div>' + I('arrowRight') + '</div>';
    }).join('');
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0">Без следующего шага · ' + list.length + '</div></div>' +
      '<div class="card" style="padding:4px 16px"><div class="rel-list">' + rows + '</div></div>';
  }
  function pulseMyDay() {
    const all = D().tasks || [];
    const open = all.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.when === 'overdue');
    const today = open.filter((t) => t.when === 'today');
    const top = overdue.concat(today).slice(0, 3).map(taskRow).join('') ||
      '<div class="empty" style="padding:16px">' + I('checkCircle') + '<div style="font-weight:700;color:var(--ink)">На сегодня всё разобрано</div></div>';
    // «Просрочено» открывает сами записи: отдельная плитка с этим разбором ушла во вкладки аналитики,
    // и без этой ссылки список просроченных стал бы недостижим с Пульса.
    const od = overdue.length ? ' · <button class="lnk-stop" data-analytics="overdue">просрочено ' + overdue.length + '</button>' : '';
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0">Мои дела · сегодня ' + today.length + od + '</div>' +
      '<button class="btn sm" data-nav="tasks">' + I('arrowRight') + 'Все задачи</button></div>' + top;
  }

  // ---- Экран «Задачи» ----
  function tasksInsights() {
    return '<div class="section-label" style="margin:4px 0 8px;display:flex;align-items:center;gap:8px">Инсайты · группы задач <span class="badge ai-b">' + I('sparkle') + 'AI-сгенерировано</span></div>' + insightCards();
  }
  function taskDueBucket(t) { if (t.status === 'done' || t.when === 'done') return 'done'; return t.when === 'overdue' ? 'overdue' : t.when === 'today' ? 'today' : 'later'; }
  function tasksHeatmap() {
    const all = D().tasks || [];
    const byAgent = {};
    all.forEach((t) => { const a = t.assignee || 'u_marina'; const b = byAgent[a] = byAgent[a] || { overdue: 0, today: 0, later: 0, done: 0 }; b[t.status === 'done' ? 'done' : taskDueBucket(t)]++; });
    const cols = [['overdue', 'Просрочено', 'stop'], ['today', 'Сегодня', 'acc'], ['later', 'Позже', 'mut'], ['done', 'Выполнено', 'ok']];
    const rows = TEAM.map((m) => {
      const b = byAgent[m.id] || { overdue: 0, today: 0, later: 0, done: 0 };
      return '<tr><td class="td-name">' + m.name + '</td>' + cols.map((c) => '<td><span class="hm-cell hm-' + c[2] + (b[c[0]] ? '' : ' hm-empty') + '">' + b[c[0]] + '</span></td>').join('') + '</tr>';
    }).join('');
    return '<div class="card" style="overflow-x:auto;margin-bottom:16px"><div class="section-label" style="padding:12px 16px 4px">Нагрузка команды · задачи</div>' +
      '<table class="deals-table"><thead><tr><th>Агент</th>' + cols.map((c) => '<th>' + c[1] + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function viewTasks() {
    const st = S();
    const isMgr = st.role === 'manager';
    const dueF = st.tasksDue || 'all';
    const statusF = st.tasksStatus || 'open';
    const all = D().tasks || [];
    const list = all.filter((t) => {
      if (statusF === 'open' && t.status === 'done') return false;
      if (statusF === 'done' && t.status !== 'done') return false;
      if (dueF !== 'all' && taskDueBucket(t) !== dueF) return false;
      return true;
    });
    // One row of clear one-click presets (was status ×3 + due ×4 = 7 chips across two axes).
    // "Позже"/"Все сроки" fold into Открытые/Все — a broker rarely isolates the later-backlog alone.
    const PRESETS = [['open', 'Открытые', 'open', 'all'], ['today', 'Сегодня', 'open', 'today'], ['overdue', 'Просрочено', 'open', 'overdue'], ['done', 'Выполнено', 'done', 'all'], ['all', 'Все', 'all', 'all']];
    const curPreset = (PRESETS.find((pr) => pr[2] === statusF && pr[3] === dueF) || [])[0];
    const presetChips = PRESETS.map((pr) => '<button class="chip' + (curPreset === pr[0] ? '' : ' mut') + '" data-taskpreset="' + pr[0] + '"' + (curPreset === pr[0] ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + pr[1] + '</button>').join('');
    const rows = list.map(taskRow).join('') || ('<div class="empty" style="padding:32px 20px">' + I('checkCircle') +
      '<div style="font-weight:700;color:var(--ink);margin-bottom:2px">' + (all.length ? 'Под фильтры задач нет' : 'Все задачи разобраны') + '</div>' +
      '<div>' + (all.length ? 'Измените статус или срок выше, чтобы увидеть остальные.' : 'Новые появятся из сделок и рекомендаций Консьержа.') + '</div></div>');
    return head('Задачи', 'Все задачи по сделкам и клиентам: бэклог, сроки, приоритет. «Мои дела» (сегодня/просрочено) остаются в Пульсе — здесь полный список с фильтрами. Инсайты — автоматически сгенерированные Консьержем группы задач из рекомендательной системы.',
      '<button class="btn sm primary" data-act="newTask">' + I('plus') + 'Новая задача</button>') +
      tasksInsights() +
      (isMgr ? tasksHeatmap() : '') +
      '<div class="qa-row" style="margin:16px 0 4px">' + presetChips + '</div>' +
      '<div class="card"><div class="feed" style="padding:8px 16px">' + rows + '</div></div>';
  }
  // Task card (pop-up): суть · документы · история + чат по задаче с Консьержем.
  function taskTabContent(t, tab) {
    const c = D().clients.find((x) => x.id === t.clientId) || {};
    const asg = t.assignee ? (TEAM.find((m) => m.id === t.assignee) || {}).name : 'Марина Волкова';
    const kindLabel = ({ manual: 'Ручная', call: 'Звонок', touch: 'Касание', doc: 'Документ', kp: 'КП' })[t.kind] || t.kind || 'Задача';
    if (tab === 'docs') {
      return dxSec('doc', 'Документы задачи', '', docsRows(docsFor((x) => x.client === t.clientId), 'по этой задаче документов пока нет'));
    }
    if (tab === 'history') {
      const ev = [['plus', 'Задача создана', t.due + ' · ' + asg]];
      if (t.assignee && t.assignee !== 'u_marina') ev.push(['users', 'Назначена исполнителю', asg]);
      ev.push(t.status === 'done' ? ['check', 'Выполнена', 'сегодня'] : ['clock', 'В работе', t.when === 'overdue' ? 'просрочено' : 'срок ' + t.due]);
      const rows = ev.map((e) => '<div class="feed-row"><div class="fi i-mut">' + I(e[0]) + '</div><div class="ft"><div class="t">' + e[1] + '</div><div class="m">' + e[2] + '</div></div></div>').join('');
      return dxSec('clock', 'История задачи', '', '<div class="feed">' + rows + '</div>');
    }
    // essence (суть задачи)
    // Сделку брали как первую сделку клиента — у клиента с тремя сделками показывалась случайная.
    // Теперь у задачи есть область, и угадывать не нужно: нет ссылки — нет строки.
    const taskDeal = t.dealId ? (D().deals || []).find((d) => d.id === t.dealId) : null;
    const prio = t.when === 'overdue' ? 'высокий' : t.when === 'today' ? 'средний' : 'обычный';
    const key = dxSec('checkCircle', 'Суть задачи', '', '<div class="dfields">' +
      dfPair('Что сделать', t.title) + dfPair('Клиент', c.name || '—') +
      dfPair('Область', taskScopeLabel(t)) +
      (taskDeal ? dfPair('Сделка', dealActionWord(taskDeal) + ' · ' + WS.AED(taskDeal.amount)) : '') +
      dfPair('Тип', kindLabel) + dfPair('Приоритет', prio) +
      dfPair('Срок', t.due) + dfPair('Исполнитель', asg) + dfPair('Статус', t.status === 'done' ? 'выполнено' : (t.when === 'overdue' ? 'просрочено' : 'в работе')) + '</div>' +
      (t.why ? '<div style="margin-top:8px;font-size:12.5px;color:var(--mut)">' + t.why + '</div>' : ''));
    const act = dxSec('sparkle', 'Действия', '', '<div class="qa-row">' +
      (t.status !== 'done' ? '<button class="chip" data-taskdone="' + t.id + '">' + I('check') + 'Выполнить</button>' : '<button class="chip" data-taskreopen="' + t.id + '">' + I('reset') + 'Вернуть</button>') +
      '<button class="chip" data-tasksnooze="' + t.id + '">' + I('clock') + 'Отложить</button>' +
      '<button class="chip" data-taskreassign="' + t.id + '">' + I('users') + 'Переназначить</button>' +
      (c.id ? '<button class="chip" data-client="' + c.id + '">' + I('eye') + 'К клиенту</button>' : '') + '</div>');
    return key + '<div style="margin-top:14px">' + act + '</div>';
  }
  function taskCard(id) {
    const t = (D().tasks || []).find((x) => x.id === id); if (!t) return;
    const c = D().clients.find((x) => x.id === t.clientId) || {};
    const asg = t.assignee ? (TEAM.find((m) => m.id === t.assignee) || {}).name : 'Марина Волкова';
    const stTone = t.status === 'done' ? 'ok' : (t.when === 'overdue' ? 'stop' : 'acc');
    const status = '<div class="prov dx-statusbar">' +
      '<span class="badge ' + stTone + '">' + I(t.status === 'done' ? 'check' : 'clock') + (t.status === 'done' ? 'выполнено' : (t.when === 'overdue' ? 'просрочено' : 'в работе')) + '</span>' +
      '<span class="badge">' + I('calendar') + t.due + '</span>' +
      '<span class="badge">' + I('users') + asg + '</span>' +
      (c.name ? '<span class="badge">' + I('users') + c.name + '</span>' : '') + '</div>';
    entityCard({
      type: 'task', id: id, title: t.title, status: status,
      tabs: [['essence', 'Суть задачи'], ['docs', 'Документы'], ['history', 'История']],
      render: function (tab) { return taskTabContent(t, tab); },
      concierge: entityConcierge('Поручите Консьержу по задаче — «подготовь материалы», «напомни завтра», «составь ответ клиенту»…', 'task:' + id, escAttr(t.title), 'checkCircle'),
      footer: '<button class="btn" data-act="closeModal">Закрыть</button>' +
        (t.status !== 'done' ? '<button class="btn" data-taskdone="' + id + '">' + I('check') + 'Выполнить</button>' : '') +
        '<button class="btn primary" data-thread="task:' + id + '" data-tlabel="' + escAttr(t.title) + '" data-ticon="checkCircle">' + I('chat') + 'Чат по задаче</button>',
    });
  }
  function openReassign(id) {
    const t = D().tasks.find((x) => x.id === id); if (!t) return;
    const opts = TEAM.map((m) => '<button class="btn" data-taskassign="' + id + '" data-who="' + m.id + '" style="justify-content:flex-start;width:100%;margin-bottom:6px">' + I('users') + m.name + '</button>').join('');
    openModal('Переназначить задачу', '<p style="margin-bottom:12px">«' + t.title + '» — выберите исполнителя:</p>' + opts,
      '<button class="btn" data-act="closeModal">Отмена</button>');
  }
  // Область новой задачи берётся с того экрана, откуда её ставят: из карточки сделки — по сделке,
  // из карточки заявки — по заявке, отовсюду ещё — по клиенту. Спрашивать об этом отдельным полем
  // значит спрашивать о том, что уже видно.
  function newTaskScope() {
    const st = S();
    if (st.view === 'dealDetail' && st.dealId) {
      const d = D().deals.find((x) => x.id === st.dealId);
      if (d) return { dealId: d.id, clientId: d.clientId, label: 'по сделке · ' + d.title };
    }
    if (st.view === 'requestDetail' && st.requestId) {
      const r = (D().requests || []).find((x) => x.id === st.requestId);
      if (r) return { requestId: r.id, clientId: r.clientId, label: 'по запросу · ' + r.title };
    }
    return null;
  }
  function openNewTask() {
    const sc = newTaskScope();
    S().taskScopeDraft = sc;
    const clientOpts = D().clients.map((c) => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    const kindOpts = [['manual', 'Ручная задача'], ['call', 'Звонок'], ['touch', 'Касание'], ['doc', 'Документ'], ['kp', 'КП']]
      .map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
    const teamOpts = TEAM.map((m) => '<option value="' + m.id + '"' + (m.id === 'u_marina' ? ' selected' : '') + '>' + m.name + (m.id === 'u_marina' ? ' (я)' : '') + '</option>').join('');
    const scopeLine = sc
      ? '<div class="note" style="margin:0 0 10px">' + I('briefcase') + ' Задача ' + escAttr(sc.label) +
        ' — она не появится в других сделках этого клиента.</div>'
      : '';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Обычная задача. Можно оставить на себя или назначить другому сотруднику — он увидит её у себя.</p>' + scopeLine +
      '<div class="form-grid">' +
      '<label class="fld"><span>Что сделать</span><input id="ntTitle" type="text" placeholder="Например: перезвонить по КП"></label>' +
      pickerField('ntClient', 'Клиент', clientOpts, 'Поиск по имени клиента…') +
      '<label class="fld"><span>Исполнитель</span><select id="ntAssignee">' + teamOpts + '</select></label>' +
      '<label class="fld"><span>Тип</span><select id="ntKind">' + kindOpts + '</select></label>' +
      '<label class="fld"><span>Срок</span><select id="ntWhen"><option value="today">сегодня</option><option value="tomorrow">завтра</option></select></label>' +
      '</div>';
    openModal('Новая задача', body, '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="taskCreate">' + I('check') + 'Создать</button>');
  }
  function createTaskFromForm() {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const title = (g('ntTitle') || '').trim();
    if (!title) { WS.storeApi.toast('Укажите, что нужно сделать', 'warn'); return; }
    const when = g('ntWhen') || 'today';
    const assignee = g('ntAssignee') || 'u_marina';
    const assignedOut = assignee && assignee !== 'u_marina';
    // Область наследуется с экрана, но клиента в форме можно поменять. Если поменяли на другого —
    // область снимается: задача, привязанная к сделке чужого человека, врала бы в обеих карточках.
    const draft = S().taskScopeDraft || null;
    const picked = g('ntClient') || (draft && draft.clientId) || 'c_anna';
    const sc = (draft && draft.clientId && draft.clientId !== picked) ? null : draft;
    WS.storeApi.addTask({
      id: 'tm_' + Math.round(performance.now()),
      clientId: picked,
      dealId: (sc && sc.dealId) || null,
      requestId: (sc && sc.requestId) || null,
      title: title, kind: g('ntKind') || 'manual', assignee: assignee,
      when: when, due: when === 'tomorrow' ? 'завтра' : 'сегодня',
      why: assignedOut ? 'Назначено от: Марина Волкова' : 'Задача добавлена вручную',
    });
    closeModal();   // он же снимает черновик области
    WS.storeApi.toast(assignedOut ? 'Задача назначена: ' + (TEAM.find((m) => m.id === assignee) || {}).name : 'Задача добавлена в очередь', 'ok');
  }

  // ---------------- MANUAL CREATION (item 10): forms, not the voice scenario ----------------
  const _g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  function openContactForm() {
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Ручное создание карточки контакта. Психопрофиль заполняется отдельно в карточке. Или загрузите пачкой — «Импорт».</p>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Имя</span><input id="nc_name" placeholder="Имя клиента"></label>' +
      '<label class="fld"><span>Телефон</span><input id="nc_phone" placeholder="+971 5• ••• ••••"></label>' +
      '<label class="fld"><span>Цель</span><input id="nc_goal" placeholder="Инвестиция / жильё"></label>' +
      '<label class="fld"><span>Бюджет, AED</span><input id="nc_budget" type="number" step="50000"></label>' +
      '<label class="fld"><span>Канал</span><select id="nc_channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>' +
      '<label class="fld"><span>Согласие (PDPL)</span><select id="nc_consent"><option value="1">есть</option><option value="0">нет</option></select></label>' +
      '</div>';
    openModal('Создать контакт', body, '<button class="btn" data-act="closeModal">Отмена</button><button class="btn" data-act="importContacts">' + I('download') + 'Импортом</button><button class="btn primary" data-act="createContact">' + I('check') + 'Создать</button>');
  }
  function createContact() {
    const name = (_g('nc_name') || '').trim(); if (!name) { WS.storeApi.toast('Укажите имя', 'warn'); return; }
    const id = 'cm_' + Math.round(performance.now());
    WS.storeApi.applyEffects([{ op: 'addClient', obj: { _new: true, id: id, name: name, phone: _g('nc_phone'), goal: _g('nc_goal') || '—', budget: parseInt(_g('nc_budget'), 10) || 0, channel: _g('nc_channel'), consent: _g('nc_consent') === '1', lang: 'RU', areas: [], horizon: '—', note: 'Создан вручную' } }]);
    closeModal(); WS.storeApi.toast('Контакт создан', 'ok'); S().clientsTab = 'contacts'; WS.router.go('clients');
  }
  function openObjectForm() {
    const areaOpts = Array.from(new Set(D().objects.map((o) => o.area))).map((a) => '<option>' + a + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Ручное добавление объекта. Или пачкой — «Импорт объектов». Доходность считается в разделе «Расчёт доходности».</p>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Название</span><input id="no_name" placeholder="Проект, юнит"></label>' +
      '<label class="fld"><span>Район</span><select id="no_area">' + areaOpts + '</select></label>' +
      '<label class="fld"><span>Тип</span><select id="no_br"><option>Studio</option><option>1BR</option><option>1BR+</option><option>2BR</option></select></label>' +
      '<label class="fld"><span>Площадь, м²</span><input id="no_size" type="number"></label>' +
      '<label class="fld"><span>Цена, AED</span><input id="no_price" type="number" step="50000"></label>' +
      '<label class="fld"><span>Источник</span><select id="no_source"><option value="agency">Агентство</option><option value="club">Клуб</option><option value="import">Импорт</option></select></label>' +
      '</div>';
    openModal('Создать объект', body, '<button class="btn" data-act="closeModal">Отмена</button><button class="btn" data-act="importObjects">' + I('download') + 'Импортом</button><button class="btn primary" data-act="createObject">' + I('check') + 'Создать</button>');
  }
  function createObject() {
    const name = (_g('no_name') || '').trim(); if (!name) { WS.storeApi.toast('Укажите название', 'warn'); return; }
    const price = parseInt(_g('no_price'), 10) || 0;
    if (!price) { WS.storeApi.toast('Укажите цену объекта', 'warn'); return; } // price is required — else finance yields ∞ (Codex #4)
    const src = _g('no_source'); const srcLabel = { agency: 'Инвентарь агентства', club: 'Клубный эксклюзив', import: 'Импорт застройщика' }[src];
    const id = 'om_' + Math.round(performance.now());
    WS.storeApi.applyEffects([{ op: 'addObject', obj: { _new: true, id: id, name: name, area: _g('no_area'), br: _g('no_br'), size: parseInt(_g('no_size'), 10) || 0, price: price, source: src, sourceLabel: srcLabel, verified: 'expired', checkedAt: 'создан вручную', trakheesi: 'pending', madmoun: 'na', availability: 'stale', attrs: { view: 'city', floor: 'mid', finish: 'new', demand: 'mid', prestige: 'mid', metro: false }, match: 'Добавлен вручную — требует проверки' } }]);
    if (WS.photos) WS.photos[id] = WS.photos.o_marina;
    closeModal(); WS.storeApi.toast('Объект создан', 'ok'); WS.router.go('objects');
  }
  function openDealForm(prefClient) {
    const clientOpts = D().clients.map((c) => '<option value="' + c.id + '"' + (c.id === prefClient ? ' selected' : '') + '>' + c.name + '</option>').join('');
    const objOpts = D().objects.map((o) => '<option value="' + o.id + '">' + o.name.split(',')[0] + '</option>').join('');
    // Stage options follow the funnel the form is currently on. Offering every stage of every
    // funnel would let an agent file a lease deal at «Бронь (EOI)», which that funnel does not have.
    // Stage options belong to ONE funnel — the board the agent is standing on — and «Тип сделки»
    // is preselected to the same service, so the two cannot start out disagreeing. createDeal
    // clamps anyway, because the type select is still free to change afterwards.
    const curFunnel = (WS.FUNNELS || []).find((x) => x.k === (S().dealFunnel || 'sale')) || (WS.FUNNELS || [])[0] || { k: 'sale' };
    const stageOpts = stepsForFunnel(curFunnel.k).filter((k) => k !== 'lost')
      .map((k) => '<option value="' + k + '">' + stageLabel(k) + '</option>').join('');
    const companyOpts = (D().companies || []).map((co) => '<option value="' + co.id + '">' + co.name + '</option>').join('');
    const agentOpts = dealAgentOptions(null);
    const curType = (DEAL_ENUMS.dealType.find((t) => funnelForType(t) === curFunnel.k)) || DEAL_ENUMS.dealType[0];
    const dealTypeOpts = DEAL_ENUMS.dealType.map((dt) => '<option value="' + dt + '"' + (dt === curType ? ' selected' : '') + '>' + dt + '</option>').join('');
    const objectTypeOpts = DEAL_ENUMS.objectType.map((ot) => '<option value="' + ot + '">' + ot + '</option>').join('');
    const paymentFormOpts = DEAL_ENUMS.paymentForm.map((pf) => '<option value="' + pf + '">' + pf + '</option>').join('');
    const sourceOpts = DEAL_ENUMS.source.map((s) => '<option value="' + s + '">' + s + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Создать сделку вручную — из формы, приложенного запроса или PDF (в демо — форма). Это структурированный экран, а не диалог с Консьержем.</p>' +
      '<div class="section-label">Кто и что</div><div class="match-grid">' +
      '<label class="fld wide"><span>Суть сделки</span><input id="nd_title" type="text" placeholder="Напр.: Инвест-квартира в Business Bay"></label>' +
      pickerField('nd_client', 'Клиент', clientOpts, 'Поиск по имени клиента…') +
      pickerField('nd_object', 'Объект', objOpts, 'Поиск по названию объекта…') +
      '<label class="fld"><span>Сумма, AED</span><input id="nd_amount" type="number" step="50000"></label>' +
      '<label class="fld"><span>Стадия</span><select id="nd_stage">' + stageOpts + '</select></label>' +
      '</div><div class="section-label">Условия</div><div class="match-grid">' +
      '<label class="fld"><span>Тип сделки</span><select id="nd_dealType">' + dealTypeOpts + '</select></label>' +
      '<label class="fld"><span>Тип объекта</span><select id="nd_objectType">' + objectTypeOpts + '</select></label>' +
      '<label class="fld"><span>Готовность</span><select id="nd_readiness">' + DEAL_ENUMS.readiness.map((r) => '<option value="' + r + '">' + r + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Вид сделки</span><select id="nd_saleKind">' + DEAL_ENUMS.saleKind.map((r) => '<option value="' + r + '">' + (r || '—') + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Сторона клиента</span><select id="nd_side">' + DEAL_ENUMS.side.map((r) => '<option value="' + r + '">' + r + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Форма оплаты</span><select id="nd_paymentForm">' + paymentFormOpts + '</select></label>' +
      '<label class="fld"><span>Источник</span><select id="nd_source">' + sourceOpts + '</select></label>' +
      '<label class="fld"><span>Цель</span><input id="nd_goal" type="text"></label>' +
      '<label class="pcheck wide"><input type="checkbox" id="nd_vat"> Применяется VAT 5%</label>' +
      '</div><div class="section-label">Ответственность</div><div class="match-grid">' +
      pickerField('nd_company', 'Компания', '<option value="">— без компании</option>' + companyOpts, 'Поиск по названию компании…') +
      '<label class="fld"><span>Ответственный агент</span><select id="nd_agent">' + agentOpts + '</select></label>' +
      '</div>' +
      '<div class="prov" style="margin-top:10px"><span class="badge">' + I('upload') + 'Приложить запрос (PDF) — демо</span><span class="badge demo">' + I('lock') + 'ручное создание</span></div>';
    openModal('Создать сделку', body, '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="createDeal">' + I('check') + 'Создать сделку</button>', { wide: true });
  }
  function createDeal() {
    const cid = _g('nd_client'); const c = D().clients.find((x) => x.id === cid) || {};
    const dealType = _g('nd_dealType') || 'Продажа';
    const funnel = funnelForType(dealType);
    // The stage list came from the board in view; the funnel comes from the chosen service. If the
    // agent changed the service after opening the form, the stage is pulled into the new funnel
    // instead of filing the deal where no column can draw it.
    const readiness = _g('nd_readiness') || 'готовый';
    const stage = clampStage(funnel, _g('nd_stage') || 'prep', readiness);
    // The essence is what the deal is called everywhere afterwards; fall back to the client's name
    // only when the agent left it blank, which is what the card used to do unconditionally.
    const title = (_g('nd_title') || '').trim() || c.name || 'Сделка';
    const id = 'dm_' + Math.round(performance.now());
    const createdAt = (function() {
      const now = (WS.fixtures && WS.fixtures.DEMO_NOW) || { d: 14, mo: 5 };
      const months = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      return now.d + ' ' + months[now.mo];
    })();
    // У сделки всегда есть заявка, из которой она выросла, — даже когда её заводят руками.
    // Ручное заведение это перенос уже идущей работы: запрос клиента был, просто не записан.
    // Заводим его тем же движением, иначе у сделки нет ни истории запроса, ни места, где живут
    // клиентские документы, и она выпадает из сводной воронки как сирота.
    const rid = 'rm_' + id.slice(3);
    const objForDeal = _g('nd_object');
    const amount = parseInt(_g('nd_amount'), 10) || 0;
    WS.storeApi.applyEffects([
      { op: 'addRequest', obj: { id: rid, clientId: cid, title: title, createdAt: createdAt, channel: 'crm',
        funnel: funnel, interest: dealType, paymentForm: _g('nd_paymentForm') || '100% оплата',
        vat: !!(document.getElementById('nd_vat') || {}).checked, source: _g('nd_source') || 'Импорт', partnerAgent: null,
        dealType: dealType, objectType: _g('nd_objectType') || 'апартаменты', bedrooms: '', goal: _g('nd_goal') || '',
        budget: amount, areas: [], horizon: null, assignee: _g('nd_agent') || 'u_marina',
        leadStatus: 'Условия согласованы', temperature: 'warm', nextContact: '—', funding: '',
        offered: objForDeal ? [{ id: objForDeal, state: 'selected' }] : [], kp: { formed: false },
        note: 'Запрос заведён вместе со сделкой при ручном переносе: запрос клиента был, в системе его не было.' } },
      { op: 'addDeal', obj: { _new: true, id: id, clientId: cid, objectId: objForDeal, agent: _g('nd_agent') || 'u_marina', amount: amount, hot: false, stage: stage, title: title, sub: 'создано вручную', tags: ['ручное'], updated: 'сейчас', createdAt: createdAt, requestId: rid, funnel: funnel, dealType: dealType, objectType: _g('nd_objectType') || 'апартаменты', readiness: readiness, saleKind: _g('nd_saleKind') || '', side: _g('nd_side') || 'покупатель', paymentForm: _g('nd_paymentForm') || '100% оплата', source: _g('nd_source') || 'Импорт', goal: _g('nd_goal') || '', vat: !!(document.getElementById('nd_vat') || {}).checked, companyId: _g('nd_company') || null, prov: { budget: 'confirmed', paymentForm: 'confirmed', objectType: 'confirmed', readiness: 'confirmed', saleKind: 'confirmed', side: 'confirmed', goal: 'confirmed', source: 'confirmed' } } },
    ]);
    D().requestTimeline = D().requestTimeline || {};
    D().requestTimeline[rid] = [{ ch: 'crm', kind: 'raw', by: 'Система', at: createdAt, ord: 999,
      text: 'Перенос: сделка и её запрос заведены вручную, условия уже согласованы.' }];
    closeModal(); WS.storeApi.toast('Сделка создана вместе с запросом', 'ok'); S().clientsTab = 'deals'; WS.router.go('clients');
  }

  // Manager's team view (inner HTML — embedded into "Рабочий день").
  function workQueueManager() {
    const workload = [['Марина Волкова', 82, false], ['Ахмед Салех', 61, false], ['Лина Хассан', 108, true]]
      .map(([who, pct, over]) => '<div class="wl"><div class="who">' + who + '</div><div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.min(pct, 100) + '%"></i></div><div class="n">' + pct + '%</div></div>').join('');
    const signals = [
      ['high', 'warn', 'Нарушение SLA — ночной лид', 'Sarah Mansour ждёт 7 ч, норма 4 ч.'],
      ['', 'doc', '2 согласования ждут', 'КП Игоря и договор Виктора.'],
      ['', 'target', '3 заявки без ответа', 'Нет назначенного агента более 24 ч.'],
    ].map(([sev, ic, t, why]) => '<div class="radar-row"><div class="sev ' + sev + '"></div><div class="icon-tile i-' + (sev === 'high' ? 'stop' : 'info') + '">' + I(ic) + '</div>' +
      '<div class="rt"><div class="t">' + t + '</div><div class="why">' + why + '</div></div><div class="ra"><button class="btn sm" data-nav="clients">Разобрать</button></div></div>').join('');
    return dealsFunnel() +
      '<div class="card pad" style="margin-bottom:16px"><div class="section-label">Загрузка команды (SLA)</div><div class="workload">' + workload + '</div></div>' +
      '<div class="section-label">Сигналы и исключения</div>' + signals;
  }

  // ================= MANAGER IA (P7) — a separate oversight surface for role=manager =================
  const TEAM_META = {
    u_marina: { focus: 'Off-plan · Downtown', load: 82, conv: 34, sla: 96 },
    u_ahmed: { focus: 'Готовое · Marina', load: 61, conv: 41, sla: 88 },
    u_lina: { focus: 'Аренда · JVC', load: 108, conv: 22, sla: 74 },
  };
  const MGR_APPROVALS = [
    { ic: 'doc', t: 'КП · Игорь Лебедев', who: 'u_marina', sub: 'Bayline 1603 · 3,2 млн AED · скидка 2%', when: '20 мин назад', tone: '' },
    { ic: 'money', t: 'Скидка 4% сверх лимита', who: 'u_ahmed', sub: 'Palm Court · Виктор · лимит агента 3%', when: '1 ч назад', tone: 'warn' },
    { ic: 'handshake', t: 'Co-broking сплит 50/50', who: 'u_lina', sub: 'Whitewill · Creekline · подтвердить условия', when: '2 ч назад', tone: '' },
    { ic: 'doc', t: 'Договор бронирования', who: 'u_marina', sub: 'Sarah Mansour · Marina · Form F', when: 'сегодня', tone: '' },
  ];
  function mgrInitials(n) { return (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  function teamAgentStats(id) {
    const list = D().deals.filter((d) => d.agent === id);
    const val = list.reduce((s, d) => s + (d.amount || 0), 0);
    const active = list.filter((d) => !dealClosed(d)).length;
    const meta = TEAM_META[id] || { focus: '—', load: 50, conv: 30, sla: 90 };
    return { list: list, val: val, active: active, deals: list.length, meta: meta };
  }
  // A head of brokerage opens the morning on money against plan, who will miss it, what is stuck and
  // who is drowning. «Агентов на смене · вся команда активна» was a constant that decided nothing;
  // «План месяца · N / 12» hard-coded the plan. Both are gone.
  function mgrTiles() {
    const deals = D().deals || [];
    const active = deals.filter((d) => !dealClosed(d));
    const pipeline = Math.round(active.reduce((s, d) => s + (d.amount || 0), 0) / 1e5) / 10;
    // Closed business for the period lives in `attribution` — the same book the goals read, so the
    // Пульс cannot contradict «План отдела» two blocks below it.
    const attr = D().attribution || [];
    const earned = attr.reduce((s, x) => s + (x.commission || 0), 0) +
      Math.round(deals.filter(dealWon).reduce((s, d) => s + dealCommission(d), 0));
    const closedN = attr.reduce((s, x) => s + (x.deals || 0), 0) + deals.filter(dealWon).length;
    const unassigned = (D().inbox || []).length;
    const atRisk = Object.keys(TEAM_META).filter((k) => TEAM_META[k].load > 100 || TEAM_META[k].sla < 80).length;
    const avgSla = Math.round(Object.keys(TEAM_META).reduce((s, k) => s + TEAM_META[k].sla, 0) / Object.keys(TEAM_META).length);
    const stuckPred = (SAVED_VIEWS.find((v) => v.k === 'stuck') || {}).pred || (() => false);
    const stuck = deals.filter(stuckPred);
    const stuckSum = Math.round(stuck.reduce((s, d) => s + (d.amount || 0), 0) / 1e5) / 10;
    return '<div class="tiles" style="margin-top:20px">' +
      /* Число складывается из книги квартала и того, что закрылось в стенде. Подпись называет
         обе части: иначе оно спорит с «Закрыто в самом стенде» тремя строками ниже. */
      tile('money', 'Комиссия отдела за квартал', WS.AED(earned), '', '',
        closedN + ' ' + plural(closedN, 'закрытая сделка', 'закрытые сделки', 'закрытых сделок') +
        ' · ' + deals.filter(dealWon).length + ' в стенде', 'up', 'accent', 'data-nav="analytics"') +
      /* «Пайплайн» ушёл: на одном экране он же назывался «активными сделками» и «сделками в
         работе». Одно понятие — одно слово, и русское, раз оно есть. */
      tile('briefcase', 'Сделки команды в работе', pipeline.toLocaleString('ru-RU'), 'млн AED', '', 'Сделок в работе — ' + active.length, 'up', '', 'data-nav="clients"') +
      tile('clock', 'Застряли в стадии', stuck.length, '', '', stuckSum ? stuckSum.toLocaleString('ru-RU') + ' млн AED без движения 5+ дней' : 'всё движется', '', stuck.length ? 'accent' : '', 'data-savedview="stuck" data-nav="clients"') +
      tile('flame', 'Риск невыполнения', atRisk, '', '', atRisk ? 'Агенты вне норматива — перегрузка или SLA' : 'Все агенты в норме', '', atRisk > 0 ? 'accent' : '', 'data-nav="team"') +
      tile('warn', 'SLA отдела', avgSla + '%', '', '', 'Реакция на лид · норма 85%', '', avgSla < 85 ? 'accent' : '', 'data-nav="team"') +
      tile('mail', 'Нераспределённые заявки', unassigned, '', '', unassigned ? 'Ждут агента — назначить' : 'Все заявки распределены', '', unassigned > 0 ? 'accent' : '', 'data-nav="leads"') +
      tile('check', 'На согласовании', MGR_APPROVALS.length - (S().apprDone || []).length, '', '', 'КП, скидки, co-broking', '', '', 'data-nav="approvals"') +
      '</div>';
  }
  function viewTeam() {
    const sel = S().teamAgent || TEAM[0].id;
    const cards = TEAM.map((m) => {
      const st = teamAgentStats(m.id);
      const over = st.meta.load > 100;
      const slaLow = st.meta.sla < 80;
      const badge = over ? '<span class="badge stop">' + I('warn') + 'перегрузка</span>'
        : slaLow ? '<span class="badge warn">' + I('warn') + 'SLA</span>'
          : '<span class="badge ok">' + I('check') + 'в норме</span>';
      return '<button class="team-card' + (m.id === sel ? ' on' : '') + '" data-teamagent="' + m.id + '">' +
        '<div class="tc-head"><span class="tc-av">' + mgrInitials(m.name) + '</span>' +
        '<div class="tc-id"><div class="tc-name">' + m.name + '</div><div class="tc-focus">' + st.meta.focus + '</div></div>' + badge + '</div>' +
        '<div class="tc-load"><div class="tc-load-bar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.min(100, st.meta.load) + '%"></i></div><span class="tc-load-n">' + st.meta.load + '%</span></div>' +
        '<div class="tc-stats">' +
        '<div><b>' + st.active + '</b><span>сделок</span></div>' +
        '<div><b>' + WS.AED(st.val) + '</b><span>пайплайн</span></div>' +
        '<div><b>' + st.meta.conv + '%</b><span>конверсия</span></div>' +
        '<div><b>' + st.meta.sla + '%</b><span>SLA</span></div>' +
        '</div></button>';
    }).join('');
    const m = TEAM.find((x) => x.id === sel) || TEAM[0];
    const st2 = teamAgentStats(sel);
    const dealRows = st2.list.map((d) => {
      const c = D().clients.find((x) => x.id === d.clientId) || {};
      return '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div>' +
        '<div class="ft"><div class="t">' + d.title + '</div><div class="m">' + stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + (c.name ? ' · ' + c.name : '') + '</div></div>' + I('arrowRight') + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">активных сделок нет</div>';
    const drill = dxSec('users', 'Книга агента · ' + m.name,
      '<button class="btn xs" data-act="cgFeatureStub">' + I('users') + 'Перераспределить нагрузку</button>',
      '<div class="feed">' + dealRows + '</div>');
    return head('Команда', 'Ростер отдела: загрузка, активные сделки, конверсия и SLA каждого агента. Перегрузка и нарушения SLA подсвечены. Клик по карточке — книга сделок агента ниже.',
      '<button class="btn sm" data-act="cgFeatureStub">' + I('sparkle') + 'Сводка Консьержа</button>') +
      '<div class="team-grid">' + cards + '</div>' +
      '<div style="margin-top:16px">' + drill + '</div>';
  }
  function viewLeadsDistribution() {
    const suggest = ['u_ahmed', 'u_marina', 'u_lina'];
    const chanI = { whatsapp: 'whatsapp', email: 'mail', voice: 'mic', call: 'chat' };
    const inbox = D().inbox || [];
    const rows = inbox.map((it, i) => {
      const c = (D().clients || []).find((x) => x.id === it.clientId);
      const who = c ? c.name : 'Новый контакт';
      const sug = TEAM.find((x) => x.id === suggest[i % suggest.length]) || TEAM[0];
      const btns = TEAM.map((x) => '<button class="btn xs' + (x.id === sug.id ? ' primary' : '') + '" data-leadassign="' + i + '~~' + escAttr(x.name.split(' ')[0]) + '" title="Назначить: ' + escAttr(x.name) + '">' + mgrInitials(x.name) + '</button>').join('');
      return '<div class="lead-row"><div class="fi i-acc">' + I(chanI[it.channel] || 'chat') + '</div>' +
        '<div class="lead-main"><div class="t">' + who + ' · <span class="lead-wait">' + I('clock') + (it.at || 'сейчас') + '</span></div>' +
        '<div class="m">' + it.text + '</div></div>' +
        '<div class="lead-assign"><span class="lead-sug">' + I('sparkle') + 'AI: ' + sug.name.split(' ')[0] + '</span><div class="lead-btns">' + btns + '</div></div></div>';
    }).join('') || '<div style="font-size:12px;color:var(--faint);padding:10px 16px">все заявки распределены</div>';
    return head('Распределение заявок', 'Входящие лиды без назначенного агента. Консьерж предлагает исполнителя по фокусу и загрузке — назначайте в один клик. Время ожидания видно против норматива SLA.',
      '<button class="btn sm" data-act="cgFeatureStub">' + I('sparkle') + 'Автораспределение</button>') +
      '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Ожидают распределения · ' + inbox.length + '</div><div class="lead-list">' + rows + '</div></div>';
  }
  function mgrAgentPerf() {
    const rows = TEAM.map((m) => {
      const st = teamAgentStats(m.id);
      const over = st.meta.load > 100;
      return '<tr>' +
        '<td class="td-name">' + m.name + '</td>' +
        '<td>' + st.active + '</td>' +
        '<td class="td-amt">' + WS.AED(st.val) + '</td>' +
        '<td>' + st.meta.conv + '%</td>' +
        '<td><span class="badge ' + (st.meta.sla < 80 ? 'warn' : 'ok') + '">' + st.meta.sla + '%</span></td>' +
        '<td><span class="badge ' + (over ? 'stop' : '') + '">' + st.meta.load + '%</span></td>' +
        '</tr>';
    }).join('');
    return '<div class="card" style="overflow-x:auto;margin-bottom:16px"><div class="section-label" style="padding:12px 16px 4px">Перформанс по агентам</div>' +
      '<table class="deals-table"><thead><tr><th>Агент</th><th>Активных</th><th>Пайплайн</th><th>Конверсия</th><th>SLA</th><th>Загрузка</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function viewApprovals() {
    const done = S().apprDone || [];
    const items = MGR_APPROVALS.map((a, i) => ({ a: a, i: i })).filter((x) => done.indexOf(x.i) < 0);
    const rows = items.map(({ a, i }) => {
      const warn = a.tone === 'warn' ? ' <span class="badge warn">' + I('warn') + 'сверх лимита</span>' : '';
      return '<div class="appr-row"><div class="fi i-' + (a.tone === 'warn' ? 'stop' : 'info') + '">' + I(a.ic) + '</div>' +
        '<div class="appr-main"><div class="t">' + a.t + warn + '</div>' +
        '<div class="m">' + a.sub + ' · ' + agentName(a.who) + ' · ' + a.when + '</div></div>' +
        '<div class="appr-acts"><button class="btn sm" data-reject="' + i + '">' + I('x') + 'Отклонить</button>' +
        '<button class="btn sm primary" data-approve="' + i + '">' + I('check') + 'Одобрить</button></div></div>';
    }).join('') || '<div class="empty" style="padding:24px">' + I('checkCircle') + '<div style="font-weight:700;color:var(--ink)">Очередь пуста — всё согласовано</div></div>';
    return head('Согласования', 'Очередь одобрений от агентов: коммерческие предложения, скидки сверх лимита, co-broking сплиты, договоры. Одобрение фиксируется в истории сделки; отклонение возвращается агенту.', '') +
      '<div class="card"><div class="section-label" style="padding:12px 16px 4px">В очереди · ' + items.length + '</div><div class="appr-list">' + rows + '</div></div>';
  }

  // Section hero headers (as in the old CRM): big display title + "о чём раздел" +
  // a property photo bleeding in from the right under a white left→right gradient.
  const HERO = {
    'Оценка объекта': { img: 'o_interior', chips: ['ROI · Project IRR · NPV', 'Финмодель в Excel', 'PDF-презентация инвестору'] },
    'Объекты и клуб': { img: 'o_creekline' },
    'Сделки': { img: 'o_bayline' },
    'Контакты': { img: 'o_palmcourt' },
    'Входящие': { img: 'o_marina' },
    'Сопровождение': { img: 'o_bayline' },
    'Компании': { img: 'o_creekline' },
    'Аналитика': { img: 'viz_pulse' },
    'Сеть': { img: 'o_bayline' },
    'Услуги': { img: 'o_interior' },
    'Клуб': { img: 'o_palmcourt' },
    'Календарь': { img: 'o_marina' },
    'Документы': { img: 'o_interior' },
    'Настройки': { img: 'o_creekline' },
  };
  // Every section gets a photo hero band (old-CRM style). Unmapped titles fall back to a default photo.
  function head(title, desc, actions) {
    const h = HERO[title] || {};
    const img = (WS.photos && (WS.photos[h.img] || WS.photos.o_creekline)) || '';
    const chips = h.chips ? '<div class="wh__chips">' + h.chips.map((c) => '<span class="wh__chip">' + c + '</span>').join('') + '</div>' : '';
    const bg = img ? ' style="background-image:linear-gradient(90deg,var(--surface) 0%,var(--wh-fade1) 46%,var(--wh-fade2) 100%),url(' + img + ')"' : '';
    return '<div class="wh"' + bg + '><div class="wh__c">' +
      '<h1 class="wh__t">' + title + '</h1><div class="wh__p">' + desc + '</div>' + chips +
      (actions ? '<div class="head-actions" style="margin-top:12px">' + actions + '</div>' : '') +
      '</div></div>';
  }
  // Standalone hero band for surfaces that don't go through head() (Пульс, Консьерж-домой).
  function heroBand(title, desc, imgKey, opts) {
    opts = opts || {};
    const img = (WS.photos && (WS.photos[imgKey] || WS.photos.o_creekline)) || '';
    const bg = img ? ' style="background-image:linear-gradient(90deg,var(--surface) 0%,var(--wh-fade1) 46%,var(--wh-fade2) 100%),url(' + img + ')"' : '';
    return '<div class="wh"' + bg + '><div class="wh__c">' +
      (opts.eyebrow ? '<div class="wh__eye">' + opts.eyebrow + '</div>' : '') +
      '<h1 class="wh__t">' + title + '</h1>' +
      '<div class="wh__p"' + (opts.descBig ? ' style="font-size:15px;color:var(--ink);font-weight:600;max-width:600px"' : '') + '>' + desc + '</div>' +
      '</div></div>';
  }
  // Themed vector hero visuals (offline, on-brand) for the two work surfaces.
  /* Шапка умеет быть узкой. На Пульсе она не самостоятельная страница-обложка, а строка
     заголовка: под ней сразу начинается работа, и 262 пикселя картинки — это четверть
     первого экрана, отданная приветствию. На остальных экранах она прежняя. */
  function heroViz(kind, title, desc, opts) {
    opts = opts || {};
    const img = (WS.photos && (kind === 'pulse' ? WS.photos.viz_pulse : WS.photos.viz_concierge)) || '';
    const bg = img ? ' style="background-image:url(' + img + ')"' : '';
    return '<div class="wh wh--photo' + (opts.slim ? ' wh--slim' : '') + '"' + bg + '><div class="wh__c">' +
      '<h1 class="wh__t">' + title + '</h1>' +
      '<div class="wh__p"' + (opts.descBig ? ' style="font-size:15px;font-weight:600;color:var(--ink);max-width:520px"' : '') + '>' + desc + '</div>' +
      '</div></div>';
  }
  // Пульс — «пульт управления / ситуационный центр»: ЭКГ-пульс + мониторы с мини-графиками.
  function pulseVizSVG() {
    return '<svg viewBox="0 0 640 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><pattern id="wsdots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1.6" cy="1.6" r="1.6" fill="#E4E4E4"/></pattern></defs>' +
      '<rect width="640" height="300" fill="#F3F3F3"/><rect width="640" height="300" fill="url(#wsdots)"/>' +
      '<rect x="392" y="40" width="150" height="92" rx="10" fill="#fff" stroke="#E3E3E3"/>' +
      '<rect x="408" y="56" width="58" height="7" rx="3.5" fill="#EAEAEA"/>' +
      '<g><rect x="408" y="104" width="12" height="14" rx="2" fill="#F17E3D"/><rect x="426" y="92" width="12" height="26" rx="2" fill="#F17E3D"/><rect x="444" y="98" width="12" height="20" rx="2" fill="#F17E3D"/><rect x="462" y="84" width="12" height="34" rx="2" fill="#111"/><rect x="480" y="100" width="12" height="18" rx="2" fill="#F17E3D"/><rect x="498" y="90" width="12" height="28" rx="2" fill="#F17E3D"/></g>' +
      '<rect x="470" y="158" width="150" height="98" rx="10" fill="#fff" stroke="#E3E3E3"/>' +
      '<path d="M484 210 L512 210 L520 196 L528 226 L538 176 L548 224 L556 204 L606 204" fill="none" stroke="#F17E3D" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M0 172 L120 172 L134 160 L146 202 L162 96 L178 216 L190 162 L316 162 L330 150 L342 192 L356 84 L372 206 L384 150 L640 150" fill="none" stroke="#F17E3D" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="356" cy="84" r="7" fill="#F17E3D"/><circle cx="356" cy="84" r="15" fill="none" stroke="#F17E3D" stroke-opacity=".3" stroke-width="2.5"/>' +
      '</svg>';
  }
  // Консьерж — здание перетекает вправо в цифровую матрицу с оранжевым AI-ядром.
  function conciergeVizSVG() {
    let win = '';
    for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) win += '<rect x="' + (74 + c * 20) + '" y="' + (86 + r * 22) + '" width="10" height="12" rx="1.5" fill="#B9BEC4"/>';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) win += '<rect x="' + (170 + c * 20) + '" y="' + (134 + r * 22) + '" width="10" height="12" rx="1.5" fill="#C7CBD0"/>';
    let matrix = '', lines = '';
    const nodes = [];
    for (let i = 0; i < 22; i++) {
      const gx = 300 + (i % 6) * 54 + ((i * 37) % 22);
      const gy = 56 + Math.floor(i / 6) * 50 + ((i * 53) % 20);
      nodes.push([gx, gy]);
      const rr = 2 + (i % 3);
      matrix += '<circle cx="' + gx + '" cy="' + gy + '" r="' + rr + '" fill="' + ((i % 4 === 0) ? '#F17E3D' : '#C4C9CF') + '"/>';
    }
    for (let i = 0; i < nodes.length - 1; i += 2) lines += '<line x1="' + nodes[i][0] + '" y1="' + nodes[i][1] + '" x2="' + nodes[i + 1][0] + '" y2="' + nodes[i + 1][1] + '" stroke="#DADFE4" stroke-width="1"/>';
    return '<svg viewBox="0 0 640 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect width="640" height="300" fill="#F3F3F3"/>' +
      '<g>' + lines + '</g>' + matrix +
      '<g fill="none" stroke="#AEB4BB" stroke-width="1.4"><rect x="66" y="74" width="92" height="182" rx="3"/><rect x="162" y="122" width="70" height="134" rx="3"/></g>' + win +
      '<line x1="232" y1="150" x2="438" y2="150" stroke="#F17E3D" stroke-opacity=".4" stroke-width="1.5" stroke-dasharray="3 4"/>' +
      '<circle cx="472" cy="150" r="34" fill="#FFF4F0"/><circle cx="472" cy="150" r="34" fill="none" stroke="#F17E3D" stroke-opacity=".35" stroke-width="2"/>' +
      '<circle cx="472" cy="150" r="22" fill="none" stroke="#F17E3D" stroke-opacity=".55" stroke-width="2"/><circle cx="472" cy="150" r="11" fill="#F17E3D"/>' +
      '</svg>';
  }

  // ---------------- ARTIFACTS ----------------
  function openArtifact(kind) {
    if (kind === 'kp') return openKp();
    if (kind === 'xls') return openXls();
    if (kind === 'doc') { WS.router.go('docs'); return; }
  }
  // ---- branded WeSpace document component (КП / бриф / договоры) ----
  function wsDocHead(kicker, title, sub) {
    return '<div class="wsdoc"><div class="wsdoc-head">' +
      '<div class="wsdoc-brand"><span class="wm">WE<span>SPACE</span></span><span class="wsdoc-kick">' + kicker + '</span></div>' +
      '<div class="wsdoc-title">' + title + '</div>' + (sub ? '<div class="wsdoc-sub">' + sub + '</div>' : '') +
      '</div><div class="wsdoc-body">';
  }
  function wsDocFoot(note) { return '</div><div class="wsdoc-foot">' + (note || 'Демонстрационный документ · WeSpace · источники указаны рядом с данными · BRN DEMO-0000') + '</div></div>'; }
  function barChart(items) {
    const max = Math.max.apply(null, items.map((i) => i.value)) || 1;
    return '<div class="ws-chart">' + items.map((i) => {
      const pct = Math.max(4, Math.round(100 * i.value / max));
      return '<div class="ws-bar-row"><div class="ws-bar-l">' + i.label + '</div><div class="ws-bar-t"><i class="' + (i.hot ? 'hot' : '') + '" style="width:' + pct + '%"></i></div><div class="ws-bar-v">' + i.fmt + '</div></div>';
    }).join('') + '</div>';
  }
  function wsRows(pairs) { return pairs.map((p) => p.h ? '<div class="section-label">' + p.h + '</div>' : '<div class="field"><div class="k">' + p.k + '</div><div class="v">' + p.v + '</div></div>').join(''); }

  // Rich negotiation brief (S8) — beautiful, client-specific, with charts + psych profile.
  function openBriefS8() {
    const c = D().clients.find((x) => x.id === 'c_anna') || {};
    const creek = D().objects.find((o) => o.id === 'o_creekline'); const palm = D().objects.find((o) => o.id === 'o_palmcourt');
    const nyC = creek ? objNetYield(creek) : 0; const nyP = palm ? objNetYield(palm) : 0;
    const p = c.psych || {};
    const body = wsDocHead('Переговорный бриф', 'К звонку · ' + c.name, 'Цель: согласовать объект и снять возражение по первому платежу') +
      '<div class="section-label">Сравнение объектов · чистая доходность</div>' +
      barChart([{ label: 'Creekline 1208', value: nyC, fmt: WS.finance.pct(nyC), hot: nyC >= 0.05 }, { label: 'Palm Court 704', value: nyP, fmt: WS.finance.pct(nyP), hot: nyP >= 0.05 }]) +
      '<div class="section-label">Портрет клиента</div>' +
      '<div class="prov">' + (p.decision ? '<span class="badge">' + I('users') + p.decision + '</span>' : '') + (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('') + '</div>' +
      '<div class="ws-flag" style="margin-top:8px">' + I('sparkle') + ' <b>Как вести разговор:</b> ' + (p.tone || 'по делу, с расчётами') + '. Триггеры: ' + ((p.triggers || []).join(', ') || '—') + '.</div>' +
      '<div class="section-label">Аргументы (с источниками)</div>' +
      wsRows([{ k: 'Доходность', v: 'финмодель по объекту · допущения видны' }, { k: 'Клуб', v: 'Palm Court — эксклюзив клуба' }]) +
      '<div class="section-label">Факты ↔ гипотезы</div>' +
      wsRows([{ k: 'Факт', v: 'бюджет до 2 млн, срок 1–3 мес' }, { k: 'Гипотеза', v: 'чувствителен к первому платежу (не подтверждено)' }]) +
      '<div class="section-label">Структура и следующий шаг</div>' +
      wsRows([{ k: 'Структура', v: 'возражение → график → закрытие на показ' }, { k: 'Следующий шаг', v: 'после звонка — зафиксировать итог (G3)' }]) +
      wsDocFoot('Бриф под конкретного клиента · сигналы стиля за согласием (PDPL) · WeSpace');
    openModal('Переговорный бриф · ' + c.name, body,
      '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn" data-client="c_anna">' + I('users') + 'Профиль клиента</button><button class="btn primary" data-scn="G3">' + I('arrowRight') + 'После звонка — зафиксировать (G3)</button>');
  }

  function openKp() {
    // build from the broker's shortlist if any, else all matched
    const sl = S().shortlist || [];
    const base = sl.length ? D().objects.filter((o) => sl.indexOf(o.id) >= 0) : D().objects;
    // §11.2 safe branch: an object with expired verification is NOT sent in the package
    const objs = base.filter((o) => o.verified !== 'expired');
    const excluded = base.filter((o) => o.verified === 'expired');
    const client = (D().clients.find((x) => x.id === (S().podborClient || 'c_anna')) || {});
    // flagship metrics must be computed for the flagship object itself (Codex #1), not the currently-open finModel
    const flag = objs[0];
    const r = WS.finance.compute(flag ? Object.assign(WS.storeApi.clone(D().refModel), { objectId: flag.id, price: flag.price, exitNet: Math.round(flag.price * D().refModel.exitNet / D().refModel.price) }) : (S().finModel || D().refModel));
    const objCards = objs.slice(1).map((o) => {
      const ny = objNetYield(o); const ph = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
      return '<div class="ws-obj"><div class="ws-obj-ph" style="background-image:url(' + ph + ')"></div>' +
        '<div style="flex:1"><div class="ws-obj-n">' + o.name + '</div><div class="ws-obj-m">' + o.area + ' · ' + o.br + ' · ' + o.size + ' м²</div>' +
        '<div class="prov" style="margin-top:5px"><span class="badge acc">' + I('money') + WS.AED(o.price) + '</span><span class="badge ok">' + I('trend') + 'чистая ' + WS.finance.pct(ny) + '</span></div></div></div>';
    }).join('');
    const chart = objs.length ? '<div class="section-label">Сравнение доходности · чистая</div>' + barChart(objs.map((o) => ({ label: o.name.split(',')[0], value: objNetYield(o), fmt: WS.finance.pct(objNetYield(o)), hot: objNetYield(o) >= 0.05 }))) : '';
    const excl = excluded.length ? '<div class="ws-flag" style="background:var(--warn-soft);border-color:var(--warn-line);color:#8a6a1f">' + I('warn') + ' Исключён из пакета до проверки доступности (S9): ' + excluded.map((o) => o.name).join(', ') + '.</div>' : '';
    const body = kpHero(flag) +
      wsDocHead('Коммерческое предложение', 'Подбор для ' + (client.name || 'клиента'), 'Инвестиционные объекты · ' + objs.length + ' вариант(а)') +
      (objs.length > 1 ? '<div class="section-label">Ещё в подборке · ' + (objs.length - 1) + '</div>' + objCards : '') +
      chart +
      '<div class="ws-flag"><b>Флагман:</b> ' + (flag ? flag.name.split(',')[0] : '—') + ' — ROI ' + r.fmt.roi5 + ' за 5 лет, IRR ' + r.fmt.irr + '.</div>' + excl +
      wsDocFoot('Расчёт демонстрационный. Доступность подтверждается отдельно. WeSpace · BRN DEMO-0000.');
    openModal('Коммерческое предложение · ' + (client.name || ''), body,
      '<div style="font-size:11.5px;color:var(--mut);width:100%;margin-bottom:2px">' + I('target') + ' Готово к отправке — проверьте и отправьте клиенту на подпись.</div>' +
      '<button class="btn" data-act="closeModal">Закрыть</button>' +
      '<button class="btn" data-act="download">' + I('download') + 'Скачать PDF</button>' +
      '<button class="btn primary" data-act="kpSend">' + I('arrowUp') + 'Отправить клиенту на подпись</button>', { wide: true });
  }
  function openXls() {
    const m = S().finModel || D().refModel; const r = WS.finance.compute(m);
    const body = '<table class="cashflow" style="width:100%">' +
      '<tr><td style="text-align:left">Цена объекта</td><td>' + WS.finance.aed(m.price) + '</td></tr>' +
      '<tr><td style="text-align:left">Доп. затраты</td><td>' + WS.finance.aed(m.addCosts) + '</td></tr>' +
      '<tr><td style="text-align:left">Инвестиции</td><td>' + r.fmt.invested + '</td></tr>' +
      '<tr><td style="text-align:left">Валовая доходность</td><td>' + r.fmt.grossYield + '</td></tr>' +
      '<tr><td style="text-align:left">Чистая доходность</td><td>' + r.fmt.netYield + '</td></tr>' +
      '<tr><td style="text-align:left">NPV (' + (m.discount * 100).toLocaleString('ru-RU') + '%)</td><td>' + r.fmt.npv + '</td></tr>' +
      '<tr><td style="text-align:left">IRR</td><td>' + r.fmt.irr + '</td></tr>' +
      '<tr><td style="text-align:left">ROI 5 лет</td><td>' + r.fmt.roi5 + '</td></tr></table>' +
      '<div class="prov" style="margin-top:12px"><span class="badge demo">' + I('lock') + 'Значения из финмодели — совпадают с экраном и PDF</span></div>';
    openModal('Excel-расчёт · предпросмотр', body, '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn primary" data-act="download">' + I('download') + 'Скачать .xlsx</button>');
  }

  /* __SCREENS__ */

  // ---------------- NAVIGATOR DRAWER ----------------
  function drawer() {
    const st = S();
    const groups = [
      { key: 'golden', label: 'Ключевые цепочки', icon: 'star' },
      { key: 'support', label: 'Поддерживающие сценарии', icon: 'layers' },
      { key: 'beta', label: 'Beta', icon: 'flame' },
    ];
    let body = '';
    groups.forEach((g) => {
      const items = WS.scenarioList.filter((s) => s.group === g.key);
      body += '<div class="grp">' + I(g.icon) + g.label + '</div>';
      items.forEach((s) => {
        const status = st.scenarioStatus[s.id] || 'not';
        const stLabel = status === 'done' ? 'Пройден' : status === 'prog' ? 'В процессе' : 'Не начат';
        const stCls = status === 'done' ? 'ok' : status === 'prog' ? 'warn' : '';
        const active = (st.tour.active && st.tour.scenarioId === s.id) ? ' active' : '';
        const betaTag = s.beta ? '<span class="badge beta">' + I('flame') + 'beta</span>' : '';
        body += '<div class="scn' + active + '">' +
          '<div class="sh"><span class="code">' + s.code + '</span>' + betaTag +
          '<span class="st"><span class="badge ' + stCls + '"><span class="scn-status ' + status + '"></span>' + stLabel + '</span></span></div>' +
          '<div class="name">' + s.title + '</div><div class="val">' + s.value + '</div>' +
          '<div class="meta"><span>' + I('clock') + ' ' + s.durationMinutes + ' мин</span><span>' + I('layers') + ' ' + (s.affects || []).join(', ') + '</span></div>' +
          '<div class="run">' +
            '<button class="btn sm primary" data-scn="' + s.id + '">' + I('play') + (status === 'not' ? 'Запустить' : 'Продолжить') + '</button>' +
            '<button class="btn sm" data-replay="' + s.id + '">' + I('replay') + 'Заново</button>' +
            (status !== 'not' ? '<button class="btn sm ghost" data-scenereset="' + s.id + '">Сбросить сцену</button>' : '') +
          '</div></div>';
      });
    });
    const chainCard = '<div class="scn" style="border-color:var(--acc-line);background:linear-gradient(150deg,var(--acc-soft),var(--surface))">' +
      '<div class="sh"><span class="code">ТУР</span><span class="st"><span class="badge acc">' + I('clock') + '~10 мин</span></span></div>' +
      '<div class="name">Золотой тур — единым маршрутом</div><div class="val">G1 → G2 → G3 → S5 одной непрерывной сессией, с подсказкой следующего действия.</div>' +
      '<div class="run"><button class="btn sm primary" data-chain="golden">' + I('play') + 'Запустить тур</button></div></div>';
    return '<div class="dh"><div class="icon-tile i-acc">' + I('compass') + '</div><h3>Навигатор демо</h3>' +
      '<button class="tb-icon x" data-act="closeNav">' + I('x') + '</button></div>' +
      '<div class="db">' + chainCard +
      '<div style="font-size:12px;color:var(--mut);margin:14px 0 4px">Или запустите любой сценарий независимо:</div>' + body +
      '<div style="margin-top:18px"><button class="btn danger" data-act="reset" style="width:100%">' + I('reset') + 'Сбросить весь стенд к исходному состоянию</button></div></div>';
  }

  // ---------------- MODAL / TOASTS ----------------
  let lastFocus = null;
  function openModal(title, body, footer, opts) {
    const m = document.getElementById('modal');
    lastFocus = document.activeElement;
    const _mcls = 'modal fadeup' + (opts && opts.wide ? ' modal--wide' : '') + (opts && opts.flexBody ? ' modal--flexbody' : '');
    m.innerHTML = '<div class="mscrim" data-act="closeModal"></div><div class="' + _mcls + '" role="dialog" aria-modal="true" aria-label="' + title.replace(/"/g, '') + '">' +
      '<div class="mh"><div class="icon-tile i-acc">' + I('layers') + '</div><h3>' + title + '</h3>' +
      '<button class="tb-icon x" data-act="closeModal" aria-label="Закрыть" style="margin-left:auto">' + I('x') + '</button></div>' +
      '<div class="mb">' + body + '</div>' + (footer ? '<div class="mf">' + footer + '</div>' : '') + '</div>';
    m.classList.add('show');
    // move focus into the dialog (first primary action, else first button)
    const f = m.querySelector('.mf .btn.primary') || m.querySelector('.mb .btn') || m.querySelector('.mf .btn') || m.querySelector('button');
    if (f) setTimeout(() => f.focus(), 0);
  }
  function closeModal() {
    S().taskScopeDraft = null;   // черновик области принадлежит открытой форме и с ней же умирает
    const m = document.getElementById('modal');
    if (m && m.classList.contains('show')) {
      m.classList.remove('show');
      setTimeout(() => { if (!m.classList.contains('show')) m.innerHTML = ''; }, 200);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} lastFocus = null; }
    } else if (m) { m.innerHTML = ''; }
  }

  function openHelp() {
    const step = (n, t) => '<div class="field"><div class="k" style="width:26px"><span class="badge acc" style="width:22px;justify-content:center">' + n + '</span></div><div class="v">' + t + '</div></div>';
    const body =
      '<p style="font-size:13px;color:var(--mut);margin-top:0">Демо-стенд WESPACE: 16 сценариев на подготовленных дубайских данных, без backend. Ниже — как вести показ агенту.</p>' +
      '<div class="section-label" style="margin-top:8px">Провести показ</div>' +
      step('1', 'На старте нажмите <b>«Золотой тур · 10 мин»</b> — пройдёт G1→G2→G3→S5 одной сессией с подсказкой следующего действия (пульсирует нужная кнопка).') +
      step('2', 'Любой из 16 сценариев — из <b>«Навигатор демо»</b> (справа вверху). Панели S2/S9 показывают безопасные отказы.') +
      step('3', 'Ошиблись кликом — в туре кнопка <b>«Сцена заново»</b> перезапустит только текущую сцену.') +
      '<div class="section-label" style="margin-top:14px">Сброс в 1 клик</div>' +
      '<div class="prov"><span class="badge">' + I('reset') + '<b>«Сброс»</b> вверху → «Сбросить всё» — вернёт стенд в исходное (без перезагрузки)</span>' +
      '<span class="badge">' + I('replay') + 'у сценария в навигаторе «Заново» — только его данные</span></div>' +
      '<div class="section-label" style="margin-top:14px">Управление</div>' +
      '<div class="prov"><span class="badge">' + I('users') + 'Агент ↔ Руководитель (шапка)</span><span class="badge">' + I('moon') + 'Свет / тьма</span>' +
      '<span class="badge">' + I('chat') + 'Консьерж — диалоги по сущностям; из карточки сделки/объекта «Чат по …»</span>' +
      '<span class="badge">' + I('clock') + 'Демо-часы фиксированы (14 мая) — «сегодня/завтра» считаются от них</span></div>' +
      '<div style="margin-top:12px;font-size:11.5px;color:var(--faint)">Состояние сохраняется в браузере и переживает перезагрузку. Полный сброс — только кнопкой «Сброс». Подробнее: ИНСТРУКЦИЯ.md в папке стенда.</div>';
    openModal('Как показывать демо', body, '<button class="btn primary" data-act="closeModal">Понятно</button>');
  }

  // Mobile: reach all sections from a bottom sheet (spec §15.2 full nav).
  function openSections() {
    const items = NAV.map((n) => '<button class="btn" style="width:100%;justify-content:flex-start;height:46px" data-nav="' + n.id + '">' + I(n.icon) + n.label + '</button>').join('');
    openModal('Разделы', '<div style="display:flex;flex-direction:column;gap:8px">' + items + '</div>',
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }

  function renderToasts() {
    const t = document.getElementById('toasts'); if (!t) return;
    t.innerHTML = S().toasts.map((x) => '<div class="toast ' + (x.kind || '') + '">' + I(x.kind === 'ok' ? 'checkCircle' : x.kind === 'stop' ? 'warn' : 'sparkle') + x.msg + '</div>').join('');
  }

  // ---------------- TOP-BAR: wallet / settings / profile ----------------
  function openWallet() {
    const ops = [
      { t: 'Комиссия · сделка Анна Петрова', d: '14 мая', v: '+36 400 AED', k: 'in' },
      { t: 'Комиссия · co-broking Whitewill', d: '12 мая', v: '+18 000 AED', k: 'in' },
      { t: 'Подписка WESPACE · май', d: '1 мая', v: '−1 200 AED', k: 'out' },
      { t: 'Продвижение объекта · Property Finder', d: '8 мая', v: '−900 AED', k: 'out' },
      { t: 'Вывод на банковский счёт', d: '5 мая', v: '−40 000 AED', k: 'out' },
    ];
    const rows = ops.map((o) => '<div class="feed-row"><div class="fi ' + (o.k === 'in' ? 'i-ok' : 'i-stop') + '">' + I(o.k === 'in' ? 'download' : 'upload') + '</div>' +
      '<div class="ft"><div class="t">' + o.t + '</div><div class="m">' + o.d + '</div></div>' +
      '<div class="td-amt" style="color:' + (o.k === 'in' ? 'var(--ok)' : 'var(--stop)') + '">' + o.v + '</div></div>').join('');
    const body = '<div class="fin-kpis" style="margin-bottom:14px">' +
      '<div class="kpi"><div class="kv">8 500</div><div class="kk">Баланс, AED</div></div>' +
      '<div class="kpi"><div class="kv" style="color:var(--ok)">+54 400</div><div class="kk">Доходы за месяц</div></div>' +
      '<div class="kpi"><div class="kv neg">−42 100</div><div class="kk">Расходы за месяц</div></div></div>' +
      '<div class="cap-toggle" style="margin-bottom:14px"><span>' + I('star') + '<span><b style="color:var(--ink)">Бонусы клуба · 1 250 AED</b><div style="font-size:11.5px;color:var(--mut);font-weight:400">Начисляются за co-broking и активность · тратятся на продвижение и подписку</div></span></span><button class="btn sm" data-act="cgFeatureStub">' + I('send') + 'Потратить</button></div>' +
      '<div class="section-label">Операции</div><div class="feed">' + rows + '</div>' +
      '<div class="section-label" style="margin-top:14px">Способы вывода</div><div class="feed">' +
      '<div class="feed-row"><div class="fi i-mut">' + I('wallet') + '</div><div class="ft"><div class="t">Emirates NBD · •••• 4417</div><div class="m">IBAN подтверждён · основной</div></div><span class="badge ok">' + I('check') + 'по умолчанию</span></div>' +
      '<div class="feed-row"><div class="fi i-mut">' + I('wallet') + '</div><div class="ft"><div class="t">Wise · мультивалютный</div><div class="m">для co-broking выплат</div></div><button class="btn sm" data-act="cgFeatureStub">Выбрать</button></div>' +
      '</div>' +
      '<div class="cap-toggle" style="margin-top:14px"><span>' + I('star') + '<span><b style="color:var(--ink)">Подписка WESPACE · Pro</b><div style="font-size:11.5px;color:var(--mut);font-weight:400">1 200 AED / мес · продление 1 июня · безлимит Консьержа, приоритет заявок</div></span></span><button class="btn sm" data-act="cgFeatureStub">' + I('gear') + 'Управлять</button></div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:12px">Комиссия платформы в операциях не показывается. ' + '<span class="badge demo">' + I('lock') + 'DEMO</span></div>';
    openModal('Кошелёк', body,
      '<button class="btn" data-act="closeModal">Закрыть</button><button class="btn" data-act="cgFeatureStub">' + I('upload') + 'Вывести</button><button class="btn primary" data-act="walletTopup">' + I('download') + 'Пополнить</button>');
  }
  function openWalletTopup() {
    openModal('Пополнить кошелёк',
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Средства идут на продвижение объектов и подписку WESPACE. Демо — реального списания нет.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Сумма, AED</span><input id="wt_amt" type="number" value="1000" min="100" step="100"></label>' +
      '<label class="fld"><span>Способ пополнения</span><select id="wt_m"><option>Карта Visa / Mastercard</option><option>Банковский перевод</option><option>Crypto · USDT</option></select></label>' +
      '</div>' +
      '<div class="match" style="margin-top:12px">' + I('sparkle') + '<span>Баланс после пополнения обновится в кошельке. Бонусы клуба начисляются автоматически.</span></div>',
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="walletTopupSend">' + I('check') + 'Пополнить</button>');
  }
  // Доска входящих по четырём стадиям разбора. Карточка обязана нести то же действие, что несла
  // строка списка: «Разобрать» — это единственное, ради чего раздел открывают, и доска без него
  // была бы витриной. Стрелки двигают обращение по стадиям так же, как на доске сделок.
  const INBOX_EX_LABEL = {
    qualify: ['Квалифицировать', 'warn'], duplicate: ['Возможный дубль', 'warn'],
    unknown_object: ['Объект вне инвентаря', 'warn'], delivery_fail: ['Ошибка доставки', 'stop'],
    noconsent: ['Нет согласия', 'warn'],
  };
  function inboxTriageBtn(it) {
    const scn = it.scenario || (it.ex === 'qualify' ? 'S15' : null);
    return scn ? '<button class="btn xs" data-scn="' + scn + '">' + I('play') + 'Разобрать</button>'
      : '<button class="btn xs" data-nav="concierge">' + I('sparkle') + 'Разобрать</button>';
  }
  // Что лежит в колонке разбора. Обращение и заявка — две разные записи, но для агента это одна
  // доска: обращение разобрали -> появилась заявка -> пошёл подбор -> заявка ушла в «Сделки».
  // Пока «Квалифицирована» набиралась только из обращений, она была вечно пустой: разбор
  // заводит ЗАЯВКУ, а не переставляет обращение, — и колонка читалась как поломка.
  function inboxColumnItems(stage) {
    const inbox = (D().inbox || []).filter((it) => (it.stage || 'new') === stage);
    if (stage === 'qualified') {
      // Заведена, работа по объектам ещё не началась. Как только появилась сделка — запись
      // живёт в «Сделках», и на доске разбора ей делать нечего.
      return { inbox: inbox, reqs: (D().requests || []).filter((r) =>
        !dealsOfRequest(r.id).length && ['closed', 'lost'].indexOf(reqStage(r)) < 0) };
    }
    if (stage === 'rejected') {
      // Отказ — и по обращению (спам, не наш запрос), и по заявке, из которой ничего не вышло.
      return { inbox: inbox, reqs: (D().requests || []).filter((r) =>
        !dealsOfRequest(r.id).length && reqStage(r) === 'lost') };
    }
    return { inbox: inbox, reqs: [] };
  }
  function inboxReqCard(r) {
    const rc = D().clients.find((x) => x.id === r.clientId) || {};
    return '<div class="deal" data-request="' + r.id + '" style="cursor:pointer">' +
      '<div class="deal-body"><div class="dt">' + escAttr(rc.name || '—') + '</div>' +
      '<div class="dm" style="font-size:11px">' + I('mail') + ' заявка · ' + escAttr(r.createdAt || '') + '</div>' +
      '<div class="dm in-txt" title="' + escAttr(r.title) + '">' + escAttr(r.title) + '</div>' +
      '<div class="dfoot"><div class="dtag"><span class="badge">' +
      (r.budget ? WS.AED(r.budget) : 'бюджет не назван') + '</span>' +
      '<span class="badge">' + ((r.offered || []).length) + ' объектов</span></div></div>' +
      '<div class="in-act"><button class="btn xs" data-request="' + r.id + '">' + I('arrowRight') + 'Открыть заявку</button></div></div></div>';
  }
  function inboxKanban() {
    const chanI = { whatsapp: 'whatsapp', email: 'mail', voice: 'mic', call: 'chat' };
    const stages = WS.INBOX_STAGES || [];
    const inboxCard = (it) => {
      const c = (D().clients || []).find((x) => x.id === it.clientId);
      const who = c ? c.name : 'Новый контакт';
      const ex = INBOX_EX_LABEL[it.ex] || ['Входящее', ''];
      const si = stages.indexOf(it.stage || 'new');
      // Обращение не режется в JS: обрезанная строка врёт о том, что написал клиент.
      // Ограничение по высоте держит CSS, а полный текст остаётся в подсказке.
      const move = '<div class="dmove">' +
        '<button class="kmv" data-instage="' + it.id + '~prev" title="Назад по стадии"' + (si > 0 ? '' : ' disabled') + '>' + I('chevLeft') + '</button>' +
        '<button class="kmv" data-instage="' + it.id + '~next" title="Вперёд по стадии"' + (si >= 0 && si < stages.length - 1 ? '' : ' disabled') + '>' + I('chevRight') + '</button></div>';
      return '<div class="deal">' +
        '<div class="deal-body"><div class="dt">' + who + '</div>' +
        '<div class="dm" style="font-size:11px">' + I(chanI[it.channel] || 'chat') + ' ' + it.at + '</div>' +
        '<div class="dm in-txt" title="' + escAttr(it.text) + '">' + it.text + '</div>' +
        '<div class="dfoot"><div class="dtag"><span class="badge ' + ex[1] + '">' + I('warn') + ex[0] + '</span></div>' + move + '</div>' +
        '<div class="in-act">' + inboxTriageBtn(it) + '</div></div></div>';
    };
    const cols = (WS.INBOX_STAGES || []).map((stage) => {
      const g = inboxColumnItems(stage);
      const n = g.inbox.length + g.reqs.length;
      let cards = g.inbox.map(inboxCard).join('') + g.reqs.map(inboxReqCard).join('');
      if (!cards) cards = '<div style="font-size:12px;color:var(--faint);padding:8px 6px">пусто</div>';
      return '<div class="kcol"><div class="kh"><span>' + inboxStageLabel(stage) + '</span><span class="c">' + n + '</span></div>' +
        cards + '</div>';
    }).join('');
    return '<div class="kanban">' + cols + '</div>';
  }
  // Сдвиг обращения по стадиям разбора. Крайние положения не «заворачиваются»: из «Отказа»
  // вперёд идти некуда, и стрелка там выключена, а не молча ничего не делает.
  function moveInboxStage(id, dir) {
    const it = (D().inbox || []).find((x) => x.id === id); if (!it) return;
    const stages = WS.INBOX_STAGES || [];
    const i = stages.indexOf(it.stage || 'new');
    const next = i + (dir === 'prev' ? -1 : 1);
    if (i < 0 || next < 0 || next >= stages.length) return;
    it.stage = stages[next];
    WS.storeApi.touch();
    WS.storeApi.toast('Обращение · ' + inboxStageLabel(it.stage), 'ok');
  }

  // ---------------- "ЕЩЁ" SECTIONS (v3 framework) ----------------
  // Заявки — incoming requests from all channels (night leads, voice, exceptions).
  function viewRequests() {
    const chanI = { whatsapp: 'whatsapp', email: 'mail', voice: 'mic', call: 'chat' };
    // Раздел — ТОЛЬКО разбор входящего, как и просил партнёр. Отдельного списка «разобрано,
    // ждут подбора» здесь больше нет: заведённые заявки стоят в своей колонке той же доски,
    // а как только по заявке пошла сделка, работа идёт в «Сделках» одним сквозным путём.
    // Пояснение над разделом снято: доска объясняет себя названиями колонок.
    const narrow = (WS.INBOX_STAGES || []).map((stage) => {
      const g = inboxColumnItems(stage);
      const n = g.inbox.length + g.reqs.length;
      const body = (g.inbox.map((it) => {
        const c = (D().clients || []).find((x) => x.id === it.clientId);
        const ex = INBOX_EX_LABEL[it.ex] || ['Входящее', ''];
        return '<div class="feed-row"><div class="fi i-acc">' + I(chanI[it.channel] || 'chat') + '</div>' +
          '<div class="ft"><div class="t">' + (c ? c.name : 'Новый контакт') + ' · <span style="color:var(--mut);font-weight:500">' + it.at + '</span></div>' +
          '<div class="m">' + it.text + '</div></div>' +
          '<div style="display:flex;gap:6px;align-items:center"><span class="badge ' + ex[1] + '">' + I('warn') + ex[0] + '</span>' +
          inboxTriageBtn(it) + '</div></div>';
      }).join('') + g.reqs.map((r) => {
        const rc = D().clients.find((x) => x.id === r.clientId) || {};
        return '<div class="feed-row" data-request="' + r.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('mail') + '</div>' +
          '<div class="ft"><div class="t">' + escAttr(rc.name || '—') + ' · ' + escAttr(r.title) + '</div>' +
          '<div class="m">' + (r.budget ? WS.AED(r.budget) : 'бюджет не назван') + ' · предложено объектов: ' + ((r.offered || []).length) + '</div></div>' + I('arrowRight') + '</div>';
      }).join('')) || '<div style="font-size:12px;color:var(--faint);padding:6px 16px">пусто</div>';
      return '<div class="card" style="margin-top:12px"><div class="section-label" style="padding:12px 16px 4px">' +
        inboxStageLabel(stage) + ' · ' + n + '</div><div class="feed" style="padding:0 16px 8px">' + body + '</div></div>';
    }).join('');
    return head('Входящие', '',
      '<button class="btn sm" data-scn="G1">' + I('mic') + 'Запрос голосом (G1)</button>') +
      (boardFits() ? inboxKanban() : narrow);
  }
  // Компании — legal entities (developers, funds, corporates, agencies).
  // Компании — legal entities (developers, funds, corporates, agencies). The list, its search and
  // its filter live in companiesBlock() so the same block serves this screen and the contacts one.
  function viewCompanies() {
    return head('Компании', 'Юрлица: застройщики, фонды, корпоративные клиенты, агентства. KYC-статус (не рейтинг), контактные лица с ролями и связанные сделки. Клик по строке — карточка компании.',
      '<button class="btn sm primary" data-act="newContact">' + I('plus') + 'Добавить компанию</button>') + companiesBlock();
  }
  // Аналитика — team funnel + canonical metrics (reuses manager blocks).
  const EXPENSES = [
    ['Листинги · Property Finder / Bayut', 'подписка · май', 1800, 'building'],
    ['Продвижение · рассылки партнёрам', '4 кампании', 240, 'send'],
    ['Реклама · соцсети', 'Instagram · таргет', 950, 'star'],
    ['CRM WESPACE · тариф Pro', 'месяц', 1200, 'grid'],
    ['Клубный взнос', 'квартал / 3', 700, 'shield'],
  ];
  function expensesBlock() {
    const total = EXPENSES.reduce((s, e) => s + e[2], 0);
    const income = 54400;
    const rows = EXPENSES.map((e) => '<div class="feed-row"><div class="fi i-mut">' + I(e[3]) + '</div><div class="ft"><div class="t">' + e[0] + '</div><div class="m">' + e[1] + '</div></div><div class="td-amt" style="color:var(--stop)">−' + WS.AED(e[2]) + '</div></div>').join('');
    const kpis = '<div class="fin-kpis" style="margin-bottom:14px">' +
      '<div class="kpi"><div class="kv neg">' + WS.AED(total) + '</div><div class="kk">Расходы · месяц, AED</div></div>' +
      '<div class="kpi"><div class="kv">' + Math.round(total / income * 100) + '%</div><div class="kk">Доля от дохода</div></div>' +
      '<div class="kpi"><div class="kv" style="color:var(--ok)">' + WS.AED(income - total) + '</div><div class="kk">Чистыми · месяц</div></div></div>';
    return kpis + '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Операционные расходы · ' + WS.AED(total) + '</div><div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:10px;display:flex;align-items:center;gap:6px">' + I('lock') + 'Комиссия платформы в расходах не показывается · демо-данные</div>';
  }
  function viewAnalytics() {
    const tab = S().analyticsTab || 'overview';
    const tabBar = '<div class="seg" style="margin-bottom:16px">' +
      '<button class="' + (tab === 'overview' ? 'on' : '') + '" data-act="anaTab" data-anatab="overview">' + I('trend') + 'Воронка и метрики</button>' +
      '<button class="' + (tab === 'expenses' ? 'on' : '') + '" data-act="anaTab" data-anatab="expenses">' + I('wallet') + 'Расходы</button></div>';
    const body = tab === 'expenses' ? expensesBlock() : ((S().role === 'manager' ? mgrAgentPerf() : '') + dealsFunnel() + canonMetrics());
    return head('Аналитика', 'Воронка команды, канонические метрики (одинаковый запрос → одинаковые числа) и операционные расходы — отдельной вкладкой. Комиссия платформы не показывается.') +
      tabBar + body;
  }
  // Партнёры — co-broking network.
  const PARTNERS = [
    { id: 'p_whitewill', name: 'Whitewill', focus: 'Off-plan · Downtown, Business Bay', deals: 3, split: '50 / 50', status: 'active', channel: 'email', consent: true },
    { id: 'p_metro', name: 'Metropolitan Premium', focus: 'Готовое жильё · Palm, Marina', deals: 2, split: '50 / 50', status: 'active', channel: 'email', consent: true },
    { id: 'p_stone', name: 'STONE · застройщик', focus: 'Собственные проекты · эксклюзив', deals: 1, split: 'по проекту', status: 'active', channel: 'email', consent: true },
    { id: 'p_kirill', name: 'Кирилл · частный брокер', focus: 'Клубные покупатели', deals: 1, split: '50 / 50', status: 'pending', channel: 'email', consent: false },
  ];
  // Профессиональная сеть за пределами co-broking: посредники, представители застройщиков, ипотека.
  const NETWORK_INTER = [
    { name: 'Рашид аль-Мактум', focus: 'Посредник · доступ к закрытым лотам застройщиков' },
    { name: 'Ольга Верещагина', focus: 'Посредник · русскоязычные инвесторы' },
    { name: 'Huspy', focus: 'Ипотечный брокер · финансирование покупателей' },
  ];
  const PARTNER_ROLE = ['Партнёр-агент', 'Партнёр-агент', 'Застройщик', 'Частный брокер'];
  const PARTNER_ACCESS = ['Просмотр + редактирование', 'Просмотр', 'По проекту', 'Просмотр'];
  const PARTNER_CHAT = ['na_maxim', 'na_sara', 'na_dmitry', 'na_kirill'];
  function networkMyPartners() {
    const cards = PARTNERS.map((p, i) => '<div class="card pad" style="margin-bottom:10px"><div style="display:flex;align-items:flex-start;gap:12px">' +
      '<div class="icon-tile i-acc">' + I('star') + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-weight:700;color:var(--ink);font-size:15px">' + p.name + ' <span class="badge">' + PARTNER_ROLE[i] + '</span></div>' +
      '<div style="font-size:12.5px;color:var(--mut);margin-top:3px">' + p.focus + '</div>' +
      '<div class="prov" style="margin-top:9px"><span class="badge">' + I('briefcase') + 'Co-broking: ' + p.deals + '</span><span class="badge">' + I('money') + 'Сплит ' + p.split + '</span>' +
      '<span class="badge acc">' + I('lock') + 'Доступ: ' + PARTNER_ACCESS[i] + '</span>' +
      (p.status === 'active' ? '<span class="badge ok">' + I('check') + 'активный</span>' : '<span class="badge warn">' + I('clock') + 'на согласовании</span>') + '</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;flex:none"><button class="btn sm primary" data-act="netMsg" data-nettarget="' + PARTNER_CHAT[i] + '">' + I('chat') + 'Написать</button>' +
      '<button class="btn sm" data-act="cgFeatureStub">' + I('lock') + 'Доступ</button></div></div></div>').join('');
    const invites = [
      ['Layla Ahmadi', 'CRE Partners', 'входящее · co-broking по складам', true],
      ['Omar Haddad', 'Prime Commercial', 'исходящее · вы пригласили', false],
    ].map((r) => '<div class="feed-row"><div class="fi i-info">' + I('handshake') + '</div><div class="ft"><div class="t">' + r[0] + ' · ' + r[1] + '</div><div class="m">' + r[2] + '</div></div>' +
      (r[3] ? '<div style="display:flex;gap:6px"><button class="btn sm primary" data-act="cgFeatureStub">' + I('check') + 'Принять</button><button class="btn sm" data-act="cgFeatureStub">' + I('x') + '</button></div>' : '<span class="badge warn">' + I('clock') + 'ожидает</span>') + '</div>').join('');
    return '<div class="match" style="margin-bottom:14px">' + I('sparkle') + '<span>Права доступа определяют, что партнёр видит в ваших сделках/воронках — как в co-broking-команде (модель из старого CRM).</span></div>' +
      '<div class="section-label" style="margin-bottom:10px">Мои партнёры · ' + PARTNERS.length + '</div>' + cards +
      '<div class="wq-head" style="margin:16px 0 10px"><div class="section-label" style="margin:0">Приглашение к партнёрству</div>' +
      '<button class="btn sm primary" data-act="cgFeatureStub">' + I('plus') + 'Пригласить</button></div>' +
      '<div class="card"><div class="feed" style="padding:8px 16px">' + invites + '</div></div>';
  }
  const NET_COMPETENCY = [
    { name: 'Марина Волкова (я)', v: [['Жильё', 55], ['Офисы', 25], ['Ритейл', 12], ['Склады', 8]] },
    { name: 'Whitewill', v: [['Жильё', 70], ['Офисы', 20], ['Ритейл', 10], ['Склады', 0]] },
    { name: 'Ахмед Салех', v: [['Жильё', 30], ['Офисы', 45], ['Ритейл', 20], ['Склады', 5]] },
    { name: 'Лина Хассан', v: [['Жильё', 20], ['Офисы', 15], ['Ритейл', 25], ['Склады', 40]] },
  ];
  function networkExchange() {
    const cards = NET_COMPETENCY.map((a) => {
      const top = a.v.slice().sort((x, y) => y[1] - x[1])[0][0];
      const bars = a.v.map((k) => '<div class="cx-bar"><span class="cx-k">' + k[0] + '</span><div class="cx-track"><i style="width:' + k[1] + '%"></i></div><span class="cx-n">' + k[1] + '%</span></div>').join('');
      return '<div class="card pad" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><span style="font-weight:700;color:var(--ink);font-size:14px">' + a.name + '</span><span class="badge acc">' + I('target') + 'Силён: ' + top + '</span></div>' + bars + '</div>';
    }).join('');
    const feed = [
      ['building', 'Мой лот → в сеть', 'Creekline 1208 · 1BR · 1,82 млн — ищу покупателя-инвестора', 'Опубликовать'],
      ['target', 'Потребность партнёра', 'Whitewill: покупатель на офис в Business Bay до 4 млн', 'Есть объект'],
      ['trend', 'AI-матч', 'Ваш Bayline 1603 подходит под запрос Ольги (инвестор · доходность)', 'Предложить'],
    ].map((r) => '<div class="feed-row"><div class="fi i-acc">' + I(r[0]) + '</div><div class="ft"><div class="t">' + r[1] + '</div><div class="m">' + r[2] + '</div></div><button class="btn sm" data-act="cgFeatureStub">' + r[3] + '</button></div>').join('');
    return '<div class="match" style="margin-bottom:14px">' + I('sparkle') + '<span>Компетенции считаются из истории сделок (кто силён в складах/офисах/жилье). Растёт по мере сделок в WESPACE — это заготовка графа привлечения.</span></div>' +
      '<div class="section-label" style="margin-bottom:10px">Компетенции сети</div>' + cards +
      '<div class="section-label" style="margin:16px 0 10px">Обмен · лоты и потребности</div><div class="card"><div class="feed" style="padding:8px 16px">' + feed + '</div></div>';
  }
  const NET_TYPE_LABEL = { residential: 'Жильё', offices: 'Офисы', retail: 'Ритейл', warehouse: 'Склады', land: 'Земля' };
  const NET_TYPES = [['all', 'Все'], ['residential', 'Жильё'], ['offices', 'Офисы'], ['retail', 'Ритейл'], ['warehouse', 'Склады']];
  const NET_AGENTS = [
    { id: 'na_maxim', name: 'Максим Орлов', agency: 'Whitewill', region: 'Downtown · Business Bay', spec: ['residential', 'offices'], top: 'residential', deals: 42, mutual: true },
    { id: 'na_sara', name: 'Sara Khan', agency: 'Metropolitan Premium', region: 'Palm · Marina', spec: ['residential'], top: 'residential', deals: 31, mutual: true },
    { id: 'na_dmitry', name: 'Дмитрий Соколов', agency: 'STONE Development', region: 'off-plan · эксклюзив', spec: ['offices', 'retail'], top: 'offices', deals: 18, mutual: false },
    { id: 'na_kirill', name: 'Кирилл Ветров', agency: 'Частный брокер', region: 'Клубные покупатели', spec: ['residential'], top: 'residential', deals: 12, mutual: true },
    { id: 'na_layla', name: 'Layla Ahmadi', agency: 'CRE Partners', region: 'JVC · Industrial', spec: ['warehouse', 'retail'], top: 'warehouse', deals: 27, mutual: false },
    { id: 'na_omar', name: 'Omar Haddad', agency: 'Prime Commercial', region: 'Business Bay · DIFC', spec: ['offices'], top: 'offices', deals: 22, mutual: false },
    { id: 'na_rashid', name: 'Рашид аль-Мактум', agency: 'Посредник · доступ к лотам', region: 'Закрытые лоты застройщиков', spec: ['residential', 'offices'], top: 'residential', deals: 9, mutual: true },
  ];
  const NET_MSGS = {
    na_maxim: [
      { me: false, t: 'Есть покупатель-инвестор на офис в Business Bay до 4 млн', at: '09:20' },
      { me: true, t: 'Есть Bayline 1603 — 3,2 млн, доходность выше компов. Скинуть КП?', at: '09:22' },
      { me: false, t: 'Да, и по сплиту — 50/50 как обычно?', at: '09:23' },
    ],
    na_rashid: [{ me: false, t: 'Есть 2BR в Burj Vista, отдаю в сеть', at: '08:40' }, { me: true, t: 'Забираю, скину параметры клиента', at: '08:46' }],
    na_kirill: [{ me: false, t: 'Клубный покупатель ищет Palm, бюджет 12 млн', at: 'вчера' }],
  };
  function netAgentRows(agents, sel) {
    return agents.map((a) => '<button class="net-chat' + (a.id === sel ? ' on' : '') + '" data-netsel="' + a.id + '"><span class="net-av">' + mgrInitials(a.name) + '</span>' +
      '<span class="ft"><span class="t">' + a.name + (a.mutual ? '' : ' <span class="badge" style="padding:1px 6px;font-size:10px">новый</span>') + '</span><span class="m">' + a.agency + ' · ' + NET_TYPE_LABEL[a.top] + '</span></span></button>').join('');
  }
  function netContactPane(a) {
    const msgs = (NET_MSGS[a.id] || []).map((m) => '<div class="nm-row ' + (m.me ? 'me' : 'them') + '"><div class="nm-b">' + m.t + '<span class="nm-t">' + m.at + '</span></div></div>').join('') ||
      '<div style="font-size:12px;color:var(--faint);text-align:center;padding:24px">Начните диалог с ' + a.name.split(' ')[0] + '</div>';
    const specBadges = a.spec.map((s) => '<span class="badge">' + NET_TYPE_LABEL[s] + '</span>').join('');
    return '<section class="net-msgr-main">' +
      '<div class="net-msgr-head"><span class="net-av">' + mgrInitials(a.name) + '</span><div style="flex:1;min-width:0"><b>' + a.name + '</b><div style="font-size:11.5px;color:var(--mut)">' + a.agency + ' · ' + a.region + '</div></div>' +
      (a.mutual ? '<span class="badge ok">' + I('check') + 'взаимный</span>' : '<button class="btn sm" data-act="cgFeatureStub">' + I('plus') + 'В партнёры</button>') + '</div>' +
      '<div class="net-contact-meta"><span class="badge acc">' + I('target') + 'Силён: ' + NET_TYPE_LABEL[a.top] + '</span>' + specBadges + '<span class="badge">' + I('briefcase') + a.deals + ' сделок</span></div>' +
      '<div class="net-msgr-msgs">' + msgs + '</div>' +
      '<div class="net-cg"><span class="net-cg-lbl">' + I('sparkle') + 'Консьерж:</span><button class="chip" data-act="cgFeatureStub">' + I('doc') + 'Черновик</button><button class="chip" data-act="cgFeatureStub">' + I('handshake') + 'Условия co-broking</button></div>' +
      '<div class="net-msgr-foot"><input class="net-input" placeholder="Сообщение…"><button class="btn primary" data-act="cgFeatureStub">' + I('send') + '</button></div>' +
      '</section>';
  }
  // Пространство контрагентов — соцсеть рынка: поиск по агентствам/типам + профиль и чат справа.
  function networkContacts() {
    const q = (S().netSearch || '').toLowerCase();
    const type = S().netType || 'all';
    const agents = NET_AGENTS.filter((a) => (type === 'all' || a.spec.indexOf(type) >= 0) && (!q || (a.name + ' ' + a.agency + ' ' + a.region).toLowerCase().indexOf(q) >= 0));
    const sel = S().netSel;
    const selA = agents.find((a) => a.id === sel);
    const typeChips = NET_TYPES.map((tt) => '<button class="chip' + (type === tt[0] ? '' : ' mut') + '" data-nettype="' + tt[0] + '"' + (type === tt[0] ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + tt[1] + '</button>').join('');
    const list = agents.length ? netAgentRows(agents, sel) : '<div style="font-size:12px;color:var(--faint);padding:12px">Никого не найдено — измените критерии.</div>';
    const left = '<aside class="net-msgr-list">' +
      '<div class="net-search">' + I('search') + '<input id="netSearchInput" data-netsearch value="' + escAttr(S().netSearch || '') + '" placeholder="Поиск: имя, агентство, район…"></div>' +
      '<div class="qa-row" style="margin:10px 0 8px">' + typeChips + '</div>' +
      '<div class="section-label" style="margin:0 0 6px">Найдено · ' + agents.length + '</div>' + list + '</aside>';
    const right = selA ? netContactPane(selA)
      : '<section class="net-msgr-main net-empty">' + I('users') + '<div style="font-weight:700;color:var(--ink);margin-top:8px">Выберите контрагента</div><div style="font-size:12.5px;color:var(--mut);margin-top:4px;max-width:300px">Слева — поиск по сети разных агентств. Клик по контакту откроет профиль и чат справа.</div></section>';
    return '<div class="match" style="margin-bottom:14px">' + I('sparkle') + '<span>Пространство контрагентов: находите брокеров разных агентств по типу недвижимости и региону — как соцсеть рынка. Клик по контакту открывает профиль и чат справа.</span></div>' +
      '<div class="net-msgr">' + left + right + '</div>';
  }
  function viewPartners() {
    const tab = S().netTab || 'contacts';
    const segBtn = (k, l, ic) => '<button class="' + (tab === k ? 'on' : '') + '" data-act="netTab" data-nettab="' + k + '">' + I(ic) + l + '</button>';
    const tabBar = '<div class="seg" style="margin-bottom:16px">' + segBtn('contacts', 'Контрагенты', 'users') + segBtn('partners', 'Мои партнёры', 'handshake') + segBtn('exchange', 'Обмен', 'trend') + '</div>';
    const body = tab === 'partners' ? networkMyPartners() : tab === 'exchange' ? networkExchange() : networkContacts();
    return head('Сеть', 'Соцсеть рынка недвижимости: пространство контрагентов из разных агентств (поиск по типу и региону), мои партнёры с правами доступа, обмен лотами и компетенциями. Клик по контакту — профиль и чат справа.',
      '<button class="btn sm primary" data-act="cgFeatureStub">' + I('plus') + 'Пригласить в сеть</button>') +
      tabBar + body;
  }
  // Услуги — broker services catalogue with commission terms (public profile).
  const SERVICES = [
    { t: 'Брокеридж в коммерческой недвижимости', d: 'Подбор офисов, ритейла и складов под инвесторов и бизнес — аренда и продажа. Полное сопровождение сделки с юридической стороны.', terms: [['100%', 'сдача в аренду'], ['0%', 'поиск объекта'], ['от 3%', 'продажа объекта'], ['по запросу', 'фин. оценка']] },
    { t: 'Управление недвижимостью', d: 'Сдача в аренду, контроль оплат и состояние объектов клиентов.', terms: [['8% / мес', 'управление']] },
    { t: 'Консалтинг девелоперов', d: 'Эксклюзивное сопровождение застройщиков — от участка до последнего лота.', terms: [['по проекту', 'консалтинг']] },
  ];
  const PORTFOLIO = [
    ['Business Bay · офис 480 м²', 'Сдан за 3 недели', 'аренда · корпоративный клиент'],
    ['Palm Jumeirah · вилла', 'Продажа 12,5 млн AED', 'off-plan · частный инвестор'],
    ['JVC · пакет 6 юнитов', 'Пакетная сделка + управление', 'инвестиционный портфель'],
  ];
  const REVIEWS = [
    ['Анна Петрова', 'Инвестор', 'Помогла собрать доходную сделку и всё проверила — вышли на 5,3% чистыми, без сюрпризов.'],
    ['Karim Aziz', 'Партнёр · co-broking', 'Быстрый отклик, честный сплит 50/50, документы всегда в порядке.'],
    ['STONE', 'Застройщик', 'Приводит проверенных клубных покупателей на ранние аллокации. Работаем эксклюзивно.'],
  ];
  function viewServices() {
    const cards = SERVICES.map((s, i) => {
      const terms = s.terms.map((tt) => '<div style="display:flex;flex-direction:column;gap:3px;min-width:120px"><span style="font-family:var(--font-disp);font-weight:800;font-size:20px;line-height:1;color:var(--ink);letter-spacing:-.01em">' + tt[0] + '</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700">' + tt[1] + '</span></div>').join('');
      return '<div class="card pad" style="margin-bottom:12px"><div style="font-family:var(--font-disp);font-weight:800;font-size:20px;letter-spacing:-.01em;color:var(--ink)">' + s.t + '</div>' +
        '<div style="font-size:13px;color:var(--mut);margin:7px 0 15px;max-width:70ch;line-height:1.5">' + s.d + '</div>' +
        '<div style="display:flex;gap:28px;flex-wrap:wrap;padding-top:13px;border-top:1px solid var(--line)">' + terms + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn sm primary" data-svcreq="' + i + '">' + I('send') + 'Заказать услугу</button><button class="btn sm" data-act="openKp">' + I('doc') + 'Пример КП</button></div></div>';
    }).join('');
    const stat = '<div class="fin-kpis" style="margin-bottom:14px">' +
      '<div class="kpi"><div class="kv">' + (D().objects || []).length + '</div><div class="kk">Объектов в работе</div></div>' +
      '<div class="kpi"><div class="kv">' + (D().deals || []).filter(dealWon).length + '</div><div class="kk">Закрыто · демо</div></div>' +
      '<div class="kpi"><div class="kv">2–3%</div><div class="kk">Типовая комиссия</div></div></div>';
    const portfolio = '<div class="card" style="margin:16px 0 12px"><div class="section-label" style="padding:12px 16px 4px">Портфолио · кейсы</div><div class="feed" style="padding:0 16px 8px">' +
      PORTFOLIO.map((c) => '<div class="feed-row"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + c[0] + '</div><div class="m">' + c[2] + '</div></div><span class="badge ok" style="white-space:nowrap">' + I('check') + c[1] + '</span></div>').join('') + '</div></div>';
    const reviews = '<div class="card pad"><div class="section-label" style="margin:0 0 4px">Отзывы</div>' +
      REVIEWS.map((r) => '<div class="rev"><div class="rev-h"><b>' + r[0] + '</b><span>' + r[1] + '</span><span class="rev-stars">★★★★★</span></div><p class="rev-t">' + r[2] + '</p></div>').join('') + '</div>';
    return head('Услуги', 'Каталог услуг брокера с условиями комиссии — публичная витрина. Заказ услуги, пример КП, портфолио и отзывы клиентов.',
      '<button class="btn sm primary" data-act="cgFeatureStub">' + I('plus') + 'Добавить услугу</button>') + stat + cards + portfolio + reviews;
  }
  function openServiceRequest(idx) {
    const s = SERVICES[idx] || SERVICES[0];
    openModal('Заявка на услугу · ' + s.t,
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Заявка уйдёт брокеру и появится в «Заявках». Демо — реальной отправки нет.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Услуга</span><select id="sr_svc">' + SERVICES.map((x, i) => '<option' + (i === idx ? ' selected' : '') + '>' + x.t + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Как к вам обращаться</span><input id="sr_name" type="text" placeholder="Имя"></label>' +
      '<label class="fld"><span>Контакт</span><input id="sr_contact" type="text" placeholder="WhatsApp / телефон / email"></label>' +
      '<label class="fld"><span>Объект / бюджет</span><input id="sr_budget" type="text" placeholder="напр. офис 300 м², Business Bay"></label>' +
      '</div>' +
      '<label class="fld" style="margin-top:10px"><span>Комментарий</span><textarea id="sr_msg" rows="2" placeholder="Кратко о задаче и сроках"></textarea></label>',
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="svcReqSend">' + I('send') + 'Отправить заявку</button>');
  }

  // ---------------- ПРОФИЛЬ (портал брокера — публичная витрина + приватные метрики) ----------------
  function viewProfile() {
    const u = D().users[S().role];
    const isMgr = S().role === 'manager';
    const role = isMgr ? 'Руководитель отдела · Harbour Key Realty' : 'Брокер · коммерческая недвижимость';
    const deals = D().deals || [];
    const active = deals.filter((d) => !dealClosed(d)).length;
    const closed = deals.filter(dealWon).length;
    const badges = '<span class="badge ok">' + I('shield') + 'RERA · BRN 41857</span>' +
      '<span class="badge acc">' + I('star') + 'Клуб · co-broking</span>' +
      '<span class="badge">' + I('check') + 'KYC подтверждён</span>';
    const _pa = avatarAttrs(u);
    const header = '<div class="card pad" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div class="tb-avatar' + _pa.cls + '" style="width:64px;height:64px;font-size:23px' + (_pa.style ? ';' + _pa.style : '') + '">' + _pa.inner + '</div>' +
      '<div style="flex:1;min-width:200px"><div style="font-family:var(--font-disp);font-weight:800;font-size:26px;letter-spacing:-.01em;color:var(--ink);line-height:1.05">' + u.name + '</div>' +
      '<div style="font-size:13px;color:var(--mut);margin:5px 0 9px">' + role + '</div>' +
      '<div class="prov">' + badges + '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="settings">' + I('gear') + 'Настройки</button>' +
      '<button class="btn sm primary" data-act="cgFeatureStub">' + I('pencil') + 'Редактировать</button></div></div></div>';
    const kpis = '<div class="fin-kpis" style="margin-bottom:14px">' +
      '<div class="kpi"><div class="kv">' + active + '</div><div class="kk">Активные сделки</div></div>' +
      '<div class="kpi"><div class="kv">' + closed + '</div><div class="kk">Закрыто · демо</div></div>' +
      '<div class="kpi"><div class="kv">4,8</div><div class="kk">Объём сделок, млн AED</div></div>' +
      '<div class="kpi"><div class="kv">7 мин</div><div class="kk">Среднее время ответа</div></div></div>';
    const about = '<div class="card pad" style="margin-bottom:14px"><div class="section-label" style="margin:0 0 10px">О брокере</div><div class="dfields">' +
      '<div class="dfield"><div class="dk">Специализация</div><div class="dv">Off-plan · готовое · аренда · коммерция</div></div>' +
      '<div class="dfield"><div class="dk">Рынок</div><div class="dv">Dubai · ОАЭ</div></div>' +
      '<div class="dfield"><div class="dk">Языки</div><div class="dv">Русский · English · العربية</div></div>' +
      '<div class="dfield"><div class="dk">Опыт</div><div class="dv">с 2019 года</div></div>' +
      '<div class="dfield"><div class="dk">RERA BRN</div><div class="dv">41857</div></div>' +
      '<div class="dfield"><div class="dk">Компания</div><div class="dv">Harbour Key Realty</div></div>' +
      '</div></div>';
    // Private metrics — visible only to the broker (not on the public витрина).
    const priv = '<div class="card pad" style="margin-bottom:14px"><div class="section-label" style="margin:0 0 10px;display:flex;align-items:center;gap:8px">Личная статистика <span class="badge demo">' + I('lock') + 'только вам</span></div>' +
      '<div class="fin-kpis">' +
      '<div class="kpi"><div class="kv">' + WS.AED(goalFact({ metric: 'commission' }, S().role === 'manager' ? 'team' : 'me')) + '</div><div class="kk">Комиссия · квартал</div></div>' +
      '<div class="kpi"><div class="kv">34%</div><div class="kk">Конверсия лид → сделка</div></div>' +
      '<div class="kpi"><div class="kv">1,7</div><div class="kk">Средний чек, млн AED</div></div>' +
      '<div class="kpi"><div class="kv">28%</div><div class="kk">Повторные клиенты</div></div></div></div>';
    const myObjs = (D().objects || []).filter((o) => o.source === 'agency');
    const objRows = myObjs.map((o) => '<div class="feed-row" data-obj="' + o.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('building') + '</div><div class="ft"><div class="t">' + o.name + '</div><div class="m">' + o.area + ' · ' + o.br + ' · ' + WS.AED(o.price) + '</div></div>' + I('arrowRight') + '</div>').join('') || '<div style="font-size:12px;color:var(--faint);padding:8px 0">своих объектов пока нет</div>';
    const objectsCard = '<div class="card" style="margin-bottom:14px"><div class="section-label" style="padding:12px 16px 4px;display:flex;align-items:center">Мои объекты · ' + myObjs.length + '<button class="btn xs" style="margin-left:auto" data-nav="objects">' + I('arrowRight') + 'Все объекты</button></div><div class="feed" style="padding:0 16px 8px">' + objRows + '</div></div>';
    const svcAcc = '<div class="card pad" style="margin-bottom:14px"><div class="section-label" style="margin:0 0 6px">Мои услуги</div>' +
      SERVICES.map((s) => '<details class="acc"><summary>' + s.t + '</summary><div class="acc-body">' + s.d +
        '<div class="acc-terms">' + s.terms.map((tt) => '<div class="acc-term"><b>' + tt[0] + '</b><span>' + tt[1] + '</span></div>').join('') + '</div></div></details>').join('') +
      '</div>';
    const links = '<div class="prof-grid">' +
      '<button class="card pad prof-link" data-nav="services"><span class="icon-tile i-acc">' + I('grid') + '</span><span class="prof-lt"><b>Мои услуги</b><span class="prof-sub">Каталог с условиями комиссии</span></span>' + I('chevRight') + '</button>' +
      '<button class="card pad prof-link" data-nav="club"><span class="icon-tile i-acc">' + I('star') + '</span><span class="prof-lt"><b>Клубный статус</b><span class="prof-sub">Co-broking · эксклюзивы клуба</span></span>' + I('chevRight') + '</button>' +
      '<button class="card pad prof-link" data-act="wallet"><span class="icon-tile i-acc">' + I('wallet') + '</span><span class="prof-lt"><b>Кошелёк</b><span class="prof-sub">Баланс 8 500 AED · операции</span></span>' + I('chevRight') + '</button>' +
      '<button class="card pad prof-link" data-nav="partners"><span class="icon-tile i-acc">' + I('handshake') + '</span><span class="prof-lt"><b>Моя сеть</b><span class="prof-sub">Партнёры и посредники</span></span>' + I('chevRight') + '</button>' +
      '</div>';
    const profileContact = '<div class="card pad" style="margin-bottom:14px"><div class="section-label" style="margin:0 0 10px">Контактные данные</div>' +
      contactVCard(USER_CONTACTS[S().role] || USER_CONTACTS.agent, 'whatsapp') + '</div>';
    // Goals are configured here and surfaced on the Pulse; the row renderer is shared with
    // pulseMyGoals so the two screens can never drift apart.
    const goals = (u && u.goals) || [];
    const scope = S().role === 'manager' ? 'team' : 'me';
    const goalsRows = goals.map((g) => {
      const p = computeGoalProgress(g, scope);
      const m = GOAL_METRICS[g.metric] || { label: g.metric };
      const bar = Math.max(2, Math.min(100, p.pct));
      const pin = '<button class="btn xs' + (g.pinned ? ' primary' : '') + '" data-act="toggleGoalPin" data-goal="' + g.id + '" title="' +
        (g.pinned ? 'Убрать с Пульса' : 'Показывать на Пульсе') + '">' + I(g.pinned ? 'check' : 'plus') + 'На Пульсе</button>';
      return '<div class="goal-row">' +
        '<div class="goal-head"><span class="goal-label">' + escAttr(g.label) + '</span>' +
        '<span class="goal-num">' + goalValue(g.metric, p.fact) + ' <i>из ' + goalValue(g.metric, p.target) + '</i></span></div>' +
        '<div class="meter goal-meter' + (p.behind ? ' is-behind' : '') + '"><i style="width:' + bar + '%"></i></div>' +
        '<div class="goal-foot"><span class="goal-pct">' + p.pct + '%</span>' +
        '<span>' + m.label + ' · ' + (g.period === 'quarter' ? 'квартал' : 'месяц') + '</span>' +
        '<span class="goal-acts">' + pin +
        '<button class="btn xs" data-act="editGoal" data-goal="' + g.id + '">' + I('pencil') + 'Изменить</button>' +
        '<button class="btn xs" data-act="deleteGoal" data-goal="' + g.id + '" title="Удалить цель">' + I('x') + '</button></span></div></div>';
    }).join('');
    const goalsEmpty = '<div style="font-size:12.5px;color:var(--mut);max-width:64ch">Целей пока нет. Поставьте первую — комиссия за месяц, число закрытых сделок, показы или новые клиенты. Прогресс Пульс посчитает сам, по вашим сделкам, и покажет темп против календаря.</div>';
    const goalsCard = '<div class="card pad" style="margin-bottom:14px">' +
      '<div class="wq-head" style="margin:0 0 12px"><div class="section-label" style="margin:0">' + (scope === 'team' ? 'Цели отдела' : 'Мои цели') + '</div>' +
      '<button class="btn sm primary" data-act="addGoal">' + I('plus') + 'Добавить цель</button></div>' +
      (goals.length ? goalsRows : goalsEmpty) + '</div>';
    return header + profileContact + kpis + priv + about + goalsCard + objectsCard + svcAcc + links;
  }

  // ---------------- КЛУБНЫЕ (портал закрытого клуба брокеров и инвесторов) ----------------
  function viewClub() {
    const fmtM = (n) => (n / 1000000).toFixed(2).replace('.', ',') + ' млн AED';
    // Showcase = full inventory offered to club members (genuine club exclusives sorted first).
    const exList = (D().objects || []).slice().sort((a, b) => (b.source === 'club' ? 1 : 0) - (a.source === 'club' ? 1 : 0));
    const commF = S().clubComm || 'all';
    const commChips = [['all', 'Все', 'grid'], ['3', '≥ 3%', 'money'], ['4', '≥ 4%', 'money'], ['5', '≥ 5%', 'money']]
      .map(([k, l, ic]) => '<button class="chip' + (commF === k ? ' mut' : '') + '" data-clubcomm="' + k + '"' + (commF === k ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + I(ic) + l + '</button>').join('');
    const exFiltered = commF === 'all' ? exList : exList.filter((o) => (o.commissionPct || 0) >= parseFloat(commF));
    const exRows = exFiltered.map((o) =>
      '<div class="feed-row"><div class="fi i-acc">' + I('star') + '</div>' +
      '<div class="ft"><div class="t">' + o.name + '</div><div class="m">' + (o.sourceLabel || 'Клубный эксклюзив') + ' · ' + o.area + ' · ' + fmtM(o.price) + '</div></div>' +
      '<span class="badge acc" style="white-space:nowrap">' + I('money') + (o.commissionPct || '—') + '%</span>' +
      '<button class="btn sm" data-clubreq="' + o.id + '">' + I('send') + 'Заявка</button>' +
      '<button class="btn sm" data-obj="' + o.id + '">' + I('eye') + 'Открыть</button></div>').join('') ||
      '<div class="empty" style="padding:22px 6px">' + I('search') + '<div>Под фильтр по комиссии ничего нет</div></div>';
    const benefits = [
      ['star', 'Ранний доступ к off-plan', 'Клубные аллокации застройщиков до открытых продаж'],
      ['handshake', 'Закрытое co-broking', 'Сплит-сделки с проверенными участниками клуба'],
      ['users', 'Пул клубных покупателей', 'Инвесторы клуба с подтверждённым бюджетом'],
      ['calendar', 'Клубные события', 'Превью-показы и закрытые презентации проектов'],
    ].map((b) => '<div class="card pad club-benefit"><span class="icon-tile i-acc">' + I(b[0]) + '</span><span class="prof-lt"><b>' + b[1] + '</b><span class="prof-sub">' + b[2] + '</span></span></div>').join('');
    const clubPartners = PARTNERS.filter((p) => p.name === 'STONE · застройщик' || p.name === 'Кирилл · частный брокер');
    const partnerRows = clubPartners.map((p) => '<div class="feed-row"><div class="fi i-acc">' + I('handshake') + '</div>' +
      '<div class="ft"><div class="t">' + p.name + '</div><div class="m">' + p.focus + ' · сплит ' + p.split + '</div></div>' +
      '<button class="btn sm" data-nav="partners">' + I('arrowRight') + 'В сеть</button></div>').join('');
    const events = [
      ['22 мая', 'Закрытый показ · Palm Court Residence', 'превью для участников клуба'],
      ['28 мая', 'Презентация STONE · Business Bay', 'клубные аллокации, ранний вход'],
      ['3 июня', 'Клубный нетворкинг брокеров', 'co-broking-сессия'],
    ].map((e) => '<div class="feed-row"><div class="fi i-mut">' + I('calendar') + '</div><div class="ft"><div class="t">' + e[1] + '</div><div class="m">' + e[2] + '</div></div><span class="badge">' + e[0] + '</span></div>').join('');
    return head('Клуб', 'Закрытый клуб брокеров и инвесторов: эксклюзивные аллокации застройщиков, клубное co-broking, пул проверенных покупателей и клубные события. Доступ по приглашению. Отличается от фильтра «клубные» в разделе «Объекты» — здесь про членство, статус и события, а не листинги.',
      '<button class="btn sm" data-act="clubPost">' + I('plus') + 'Разместить в клубе</button>' +
      '<button class="btn sm primary" data-act="cgFeatureStub">' + I('users') + 'Пригласить в клуб</button>') +
      '<div class="section-label" style="margin-bottom:10px">Привилегии участника</div><div class="prof-grid" style="margin-bottom:16px">' + benefits + '</div>' +
      '<div class="card" style="margin-bottom:14px"><div class="section-label" style="padding:12px 16px 4px">Объекты в клубе · ' + exFiltered.length + '</div>' +
      '<div class="qa-row" style="padding:2px 16px 8px">' + commChips + '</div>' +
      '<div class="feed" style="padding:0 16px 8px">' + exRows + '</div></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="section-label" style="padding:12px 16px 4px">Клубное co-broking · ' + clubPartners.length + '</div><div class="feed" style="padding:0 16px 8px">' + partnerRows + '</div></div>' +
      '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Клубные события</div><div class="feed" style="padding:0 16px 8px">' + events + '</div></div>';
  }

  // Club actions: post an object to the closed club showcase / request a club listing.
  function openClubPost() {
    const own = (D().objects || []).filter((o) => o.source !== 'club');
    const opts = own.map((o) => '<option value="' + o.id + '">' + o.name + ' · ' + o.area + '</option>').join('') || '<option>нет своих объектов</option>';
    openModal('Разместить объект в клубе',
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Объект попадёт в закрытую витрину клуба: ранний доступ участникам и клубное co-broking. Данные — демо.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Объект</span><select id="cp_obj">' + opts + '</select></label>' +
      '<label class="fld"><span>Комиссия партнёру, %</span><input id="cp_comm" type="number" value="3" min="0" step="0.5"></label>' +
      '<label class="fld"><span>Тип доступа</span><select id="cp_access"><option>Эксклюзив клуба</option><option>Co-broking 50 / 50</option><option>Только превью</option></select></label>' +
      '<label class="fld"><span>Срок в клубе</span><select id="cp_term"><option>2 недели</option><option>1 месяц</option><option>До продажи</option></select></label>' +
      '</div>' +
      '<label class="fld" style="margin-top:10px"><span>Комментарий для участников</span><textarea id="cp_note" rows="2" placeholder="Напр.: ранний вход до открытых продаж, аллокация 5 юнитов"></textarea></label>',
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="clubPostSend">' + I('check') + 'Разместить</button>');
  }
  function openClubRequest(objId) {
    const o = (D().objects || []).find((x) => x.id === objId) || {};
    openModal('Заявка на клубный объект',
      '<div class="prov" style="margin-bottom:10px"><span class="badge acc">' + I('star') + (o.name || 'Объект') + '</span><span class="badge">' + I('money') + 'комиссия ' + (o.commissionPct || '—') + '%</span></div>' +
      '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Заявка уйдёт владельцу листинга в клубе. Демо — реальной отправки нет.</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Интерес</span><select id="cr_type"><option>Есть клиент под объект</option><option>Запрос аллокации</option><option>Co-broking</option><option>Запрос деталей</option></select></label>' +
      '<label class="fld"><span>Бюджет клиента, AED</span><input id="cr_budget" type="text" placeholder="напр. 1 900 000"></label>' +
      '</div>' +
      '<label class="fld" style="margin-top:10px"><span>Сообщение</span><textarea id="cr_msg" rows="2" placeholder="Кратко о клиенте и сроках"></textarea></label>',
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="clubReqSend">' + I('send') + 'Отправить заявку</button>');
  }

  // ---------------- НАСТРОЙКИ (страница-портал: аккаунт, каналы, стиль Консьержа, шаблоны, команда, безопасность) ----------------
  function viewSettings() {
    const u = D().users[S().role];
    const role = S().role === 'manager' ? 'Руководитель отдела · Harbour Key Realty' : 'Брокер · коммерческая недвижимость';
    const _sa = avatarAttrs(u);
    const sw = (on) => '<button class="switch' + (on ? ' on' : '') + '" data-act="cgFeatureStub"><i></i></button>';
    const rowc = (ic, t, d, ctl) => '<div class="cap-toggle" style="margin-bottom:8px"><span>' + I(ic) + '<span><b style="color:var(--ink)">' + t + '</b><div style="font-size:11.5px;color:var(--mut);font-weight:400">' + d + '</div></span></span>' + ctl + '</div>';
    const seg = (opts, sel) => '<div class="seg" style="display:inline-flex">' + opts.map((o) => '<button class="' + (o === sel ? 'on' : '') + '" data-act="cgFeatureStub">' + o + '</button>').join('') + '</div>';
    const card = (title, inner) => '<div class="card pad" style="margin-bottom:14px"><div class="section-label" style="margin:0 0 12px">' + title + '</div>' + inner + '</div>';

    const account = card('Аккаунт',
      '<div class="cap-toggle" style="margin:0"><span><span class="tb-avatar' + _sa.cls + '" style="width:44px;height:44px;font-size:16px' + (_sa.style ? ';' + _sa.style : '') + '">' + _sa.inner + '</span>' +
      '<span><b style="color:var(--ink)">' + u.name + '</b><div class="prof-sub">' + role + ' · ' + u.role + '</div></span></span>' +
      '<button class="btn sm" data-nav="profile">' + I('arrowRight') + 'Открыть профиль</button></div>');

    const chan = (ic, label, value, ph, on) => '<div class="set-chan"><span class="set-chan-ic">' + I(ic) + '</span>' +
      '<div class="set-chan-body"><label class="set-chan-label">' + label + '</label>' +
      '<input class="set-input" type="text" value="' + value + '" placeholder="' + ph + '"></div>' + sw(on) + '</div>';
    const channels = card('Каналы связи',
      chan('whatsapp', 'WhatsApp Business', '+971 50 123 4417', 'номер телефона', true) +
      chan('mail', 'Почта', 'marina@harbourkey.ae', 'email для заявок и КП', true) +
      chan('chat', 'Telegram', '@marina_dxb', '@username', true) +
      chan('star', 'Instagram', '@marina.dubai.realty', '@username', false) +
      chan('link', 'Property Finder / Bayut', 'HK-4417', 'ID агента в портале', true) +
      '<div style="font-size:11.5px;color:var(--mut);margin:8px 0 2px">Значения редактируемы — так задаются параметры канала; тумблер включает/выключает канал.</div>' +
      '<button class="btn sm" data-act="cgFeatureStub">' + I('plus') + 'Подключить канал</button>');

    const cgStyle = card('Стиль общения с Консьержем',
      '<div class="settings-row"><div class="dk">Тон</div>' + seg(['Деловой', 'Дружелюбный', 'Краткий'], 'Деловой') + '</div>' +
      '<div class="settings-row"><div class="dk">Длина ответов</div>' + seg(['Кратко', 'Обычно', 'Подробно'], 'Обычно') + '</div>' +
      '<div class="settings-row"><div class="dk">Язык общения</div>' + seg(['Русский', 'English', 'Авто'], 'Русский') + '</div>' +
      '<div class="settings-row"><div class="dk">Стартовый режим Консьержа</div>' + seg(['Авто', 'Инвест-анализ', 'Подбор'], 'Авто') + '</div>' +
      '<div style="font-size:11.5px;color:var(--mut);margin:-2px 0 4px;line-height:1.5">С какого режима Консьерж начинает новый диалог — режим можно сменить прямо в чате перед запросом. <b style="color:var(--ink)">Авто</b> — определит задачу сам по формулировке · <b style="color:var(--ink)">Инвест-анализ</b> — доходность, payment plan, ROI и сценарии выхода · <b style="color:var(--ink)">Подбор</b> — матчинг объектов под клиента с обоснованием «почему этот».</div>' +
      '<div style="margin-top:6px">' +
      rowc('mic', 'Голосовой ввод', 'Диктовка задач и заявок Консьержу', sw(true)) +
      rowc('check', 'Автоподтверждение действий', 'Отправка КП и рассылок без отдельного подтверждения', sw(false)) +
      rowc('sparkle', 'Проактивные подсказки', 'Консьерж сам предлагает следующий шаг по сделке', sw(true)) + '</div>');

    const tplRows = [
      ['Коммерческое предложение (КП)', 'активен'], ['Клиентское досье (off-plan)', 'активен'],
      ['Form A / B / F / I (RERA)', 'активны'], ['Договор бронирования', 'черновик'], ['Договор аренды + Ejari', 'активен'],
    ].map((t) => '<div class="feed-row"><div class="fi i-mut">' + I('doc') + '</div><div class="ft"><div class="t">' + t[0] + '</div><div class="m">' + t[1] + '</div></div><button class="btn sm" data-act="cgFeatureStub">' + I('pencil') + 'Изменить</button></div>').join('');
    const tpl = card('Шаблоны документов',
      '<div class="feed">' + tplRows + '</div>' +
      '<div style="font-size:11.5px;color:var(--mut);margin-top:8px">Здесь настраиваются шаблоны для генерации. Библиотека документов и заполненные экземпляры сделок — в разделе <a data-nav="docs" style="color:var(--acc-ink);cursor:pointer;font-weight:600">Документы</a>.</div>');

    const notif = card('Уведомления',
      rowc('bell', 'Требуют действий сегодня', 'Горячие клиенты, просроченные касания, новые запросы', sw(true)) +
      rowc('doc', 'Сроки по документам', 'Escrow / Oqood / title deed — напоминания заранее', sw(true)) +
      rowc('flame', 'Ночные лиды', 'Входящие вне рабочих часов — сводка утром', sw(true)));

    const team = card('Команда и замещение',
      rowc('users', 'Замещение коллег', 'Показывать клиентов и сделки, переданные мне другим агентом', sw(true)) +
      rowc('handshake', 'Видимость в сети', 'Партнёры видят мой профиль для co-broking', sw(true)));

    const security = card('Безопасность',
      rowc('shield', 'Двухфакторная защита', 'Подтверждение входа кодом для доступа к сделкам', sw(false)) +
      rowc('lock', 'Журнал доступа', 'Кто открывал сделки и документы', sw(true)));

    const menuItems = (S().role === 'manager' ? NAV_MGR.concat(NAV_MGR_MORE) : NAV.concat(NAV_MORE));
    const menuOpen = S().setMenuOpen;
    const hiddenCount = (S().navHidden || []).length;
    const menuToggles = menuItems.map((n) => {
      const key = n.id + (n.tab ? ':' + n.tab : '');
      const on = (S().navHidden || []).indexOf(key) < 0;
      return '<div class="cap-toggle" style="margin-bottom:6px"><span>' + I(n.icon) + '<b style="color:var(--ink)">' + n.label + '</b></span>' +
        '<button class="switch' + (on ? ' on' : '') + '" data-navtoggle="' + key + '" role="switch" aria-checked="' + on + '"><i></i></button></div>';
    }).join('');
    const menu = '<div class="card pad" style="margin-bottom:14px">' +
      '<button class="set-collapse-h" data-act="toggleMenuSet">' + I('menu') +
      '<span class="scl-t">Боковое меню</span>' +
      '<span class="scl-sub">' + (hiddenCount ? 'скрыто: ' + hiddenCount : 'все разделы включены') + '</span>' +
      '<span class="scl-chev' + (menuOpen ? ' open' : '') + '">' + I('chevDown') + '</span></button>' +
      (menuOpen ? '<div style="margin-top:12px"><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Включайте и выключайте разделы под свою работу.</div>' +
        menuToggles +
        '<div style="font-size:11.5px;color:var(--faint);margin-top:8px">Выключенные разделы скрываются из меню. Настройки всегда доступны из шапки (⚙).</div></div>' : '') +
      '</div>';

    return head('Настройки', 'Аккаунт, каналы связи, боковое меню, стиль общения с Консьержем, шаблоны документов, уведомления, команда и безопасность.') +
      account + menu + channels + cgStyle + tpl + notif + team + security;
  }

  // Оценка объекта — comparative market analysis (CMA), restored from the old CRM.
  // ---------------- ОЦЕНКА ОБЪЕКТА (свободный калькулятор — раздел первого уровня, по образцу старого CRM) ----------------
  const VAL_TYPES = [['apartment', 'Квартира'], ['apartments', 'Апартаменты'], ['office', 'Офис / ритейл']];
  const VAL_FITOUT = [['ready', 'С отделкой', 0], ['whitebox', 'White box', 1300], ['shellcore', 'Shell & core', 2800], ['furnished', 'С отделкой и мебелью', 4500]];
  function valDefaults() { return { type: 'apartment', area: 82, ppm: 22000, payment: 'cash', rentY1: 125000, ready: 'ready', fitout: 'ready' }; }
  function valModel(v) {
    const area = +v.area || 0, ppm = +v.ppm || 0;
    const price = Math.round(area * ppm);
    const fr = VAL_FITOUT.find((f) => f[0] === v.fitout);
    const fitCost = Math.round(area * (fr ? fr[2] : 0));
    const dld = Math.round(price * 0.04);
    const fees = Math.round(price * 0.02);
    const appr = v.ready === 'construction' ? 0.06 : 0.04;
    return {
      m: { price: price, addCosts: dld + fees + fitCost, rentY1: +v.rentY1 || 0, opexY1: Math.round(area * 18), rentGrowth: 0.03, exitNet: Math.round(price * Math.pow(1 + appr, 5)), discount: 0.08 },
      price: price, dld: dld, fitCost: fitCost,
    };
  }
  function valResultsHTML(v) {
    const mm = valModel(v);
    if (!mm.price || !mm.m.rentY1) return '<div class="empty">' + I('calc') + '<div>Введите площадь, цену за м² и прогноз аренды — модель посчитается автоматически.</div></div>';
    const r = WS.finance.compute(mm.m);
    const ok = r.npv >= 0 && r.netYield >= 0.05;
    const kh = (h) => h ? '<div style="font-size:10.5px;color:var(--mut);margin-top:2px">' + h + '</div>' : '';
    const kpi = (val, k, h, neg) => '<div class="kpi"><div class="kv' + (neg ? ' neg' : '') + '">' + val + '</div><div class="kk">' + k + '</div>' + kh(h) + '</div>';
    return '<div class="fin-kpis">' +
        kpi(r.fmt.roi5, 'ROI (5 лет)', 'доход к полной стоимости') +
        kpi(r.fmt.irr, 'Project IRR', 'с учётом выхода') +
        kpi(r.fmt.npv, 'NPV', 'дисконт 8%', r.npv < 0) +
      '</div><div class="fin-kpis" style="margin-top:10px">' +
        kpi(r.fmt.grossYield, 'Валовая доходность', '') +
        kpi(r.fmt.netYield, 'Чистая доходность', '') +
        kpi(r.fmt.invested, 'Инвестиции всего', 'цена + DLD + отделка') +
      '</div>' +
      '<div class="match" style="margin-top:14px' + (ok ? '' : ';background:var(--warn-soft);border-color:var(--warn-line)') + '">' + I(ok ? 'checkCircle' : 'warn') +
        '<span><b>' + (ok ? 'Объект инвестиционно привлекателен' : 'Требует более выгодного входа') + '</b> — ' +
        (ok ? 'NPV положительный, чистая доходность выше порога — есть основа для переговоров с инвестором.' : 'При текущих параметрах NPV или доходность ниже порога — торгуйтесь по цене входа или пересмотрите допущения.') + '</span></div>' +
      '<div class="prov" style="margin-top:12px"><span class="badge">' + I('source') + 'Цена входа ' + WS.AED(mm.price) + ' · DLD 4% ' + WS.AED(mm.dld) + ' · отделка ' + WS.AED(mm.fitCost) + '</span><span class="badge demo">' + I('lock') + 'DEMO-расчёт</span></div>' +
      '<div class="obj-row__acts" style="margin-top:14px">' +
        '<button class="btn sm primary" data-act="valPdf">' + I('doc') + 'PDF-презентация инвестору</button>' +
        '<button class="btn sm" data-act="valXls">' + I('download') + 'Excel-финмодель</button></div>';
  }
  function viewValuation() {
    const v = (S().valIn = S().valIn || valDefaults());
    const sel = (key, opts) => '<select data-val="' + key + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (v[key] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    const num = (key) => '<input type="number" inputmode="decimal" data-val="' + key + '" value="' + (v[key] != null ? v[key] : '') + '">';
    const form = '<div class="card pad" id="valForm" style="margin-bottom:16px">' +
      '<div class="section-label" style="margin-bottom:8px">Параметры объекта</div>' +
      '<div class="match-grid">' +
        '<label class="fld"><span>Тип недвижимости</span>' + sel('type', VAL_TYPES) + '</label>' +
        '<label class="fld"><span>Площадь, м²</span>' + num('area') + '</label>' +
        '<label class="fld"><span>Цена за м², AED</span>' + num('ppm') + '</label>' +
        '<label class="fld"><span>Прогноз аренды, AED/год</span>' + num('rentY1') + '</label>' +
        '<label class="fld"><span>Условия оплаты</span>' + sel('payment', [['cash', '100% оплата'], ['installment', 'Рассрочка застройщика']]) + '</label>' +
        '<label class="fld"><span>Готовность</span>' + sel('ready', [['ready', 'Готов'], ['construction', 'На стадии строительства']]) + '</label>' +
        '<label class="fld"><span>Отделка</span>' + sel('fitout', VAL_FITOUT.map((f) => [f[0], f[1]])) + '</label>' +
      '</div></div>';
    return head('Оценка объекта', 'Свободный калькулятор: введите параметры любого объекта — своего из инвентаря или гипотетического — и получите доходность (ROI · Project IRR · NPV) и вывод об инвестиционной привлекательности. Кнопка «Оценить» в карточке объекта подставляет параметры автоматически.', '') +
      form +
      '<div class="card pad"><div class="section-label" style="margin-bottom:10px">Результат</div><div id="valResults">' + valResultsHTML(v) + '</div></div>';
  }
  function valInput(el) {
    const v = (S().valIn = S().valIn || valDefaults());
    const key = el.dataset.val; if (!key) return;
    v[key] = (['area', 'ppm', 'rentY1'].indexOf(key) >= 0) ? (parseFloat(el.value) || 0) : el.value;
    const box = document.getElementById('valResults');
    if (box) box.innerHTML = valResultsHTML(v);
  }
  function valFromObj(id) {
    const o = D().objects.find((x) => x.id === id); if (!o) return;
    const v = (S().valIn = S().valIn || valDefaults());
    v.area = o.size; v.ppm = Math.round(o.price / o.size);
    v.type = /офис|office|псн|ритейл/i.test((o.br || '') + ' ' + (o.name || '')) ? 'office' : 'apartment';
    v.rentY1 = Math.round(o.price * 0.065);
    if (WS.storeApi && WS.storeApi.toast) WS.storeApi.toast('Параметры «' + o.name + '» подставлены в оценку', 'ok');
  }

  // ---------------- ПРОДВИЖЕНИЕ ОБЪЕКТА (действие из карточки: AI-рассылка партнёрам сети) ----------------
  function openPromotion(objId) {
    const o = (D().objects.find((x) => x.id === objId)) || D().objects[0];
    const ph = WS.photos && (WS.photos[o.id] || WS.photos.o_creekline);
    const perMsg = 15, recips = (typeof PARTNERS !== 'undefined' ? PARTNERS : []).length || 4;
    const cost = perMsg * recips;
    const msg = 'Эксклюзив · ' + o.area + ': ' + o.name + ', ' + o.br + ', ' + o.size + ' м². ' + WS.AED(o.price) + ' (' + WS.AED(Math.round(o.price / o.size)) + '/м²). Проверенная доступность, комиссия по договорённости. Детали и бронь — в ответ.';
    const creatives = [ph, WS.photos && WS.photos.o_interior, WS.photos && WS.photos.o_marina].filter(Boolean).slice(0, 3)
      .map((src) => '<div style="width:92px;height:66px;border-radius:8px;border:1px solid var(--line);background:#eee url(' + src + ') center/cover"></div>').join('');
    const recipRows = (typeof PARTNERS !== 'undefined' ? PARTNERS : []).map((p) => '<label class="feed-row" style="cursor:pointer"><input type="checkbox" checked style="margin:0 10px 0 0;accent-color:var(--acc)"><div class="ft"><div class="t">' + p.name + '</div><div class="m">' + p.focus + '</div></div></label>').join('');
    const clubMembers = D().clients.filter(c => c.ctype === 'investor');
    const auditClub = WS.audience.calculateAudience(clubMembers);
    const contactsWithConsent = D().clients.filter(c => c.consent !== false).length;
    const CHANNELS = [
      ['handshake', 'Партнёрская сеть', recips + ' партнёра · co-broking', true],
      ['building', 'Property Finder', 'листинг · ~2 400 просмотров/нед', true],
      ['grid', 'Bayut', 'листинг · ~1 800 просмотров/нед', false],
      ['star', 'Соцсети (Instagram)', 'пост + сторис · ~5 000 охват', false],
      ['star', 'Клубная рассылка', 'инвесторы клуба · закрытый пул', true],
      ['mail', 'Email-дайджест', 'база клиентов · ' + contactsWithConsent + ' контактов', false],
    ];
    const channelRows = CHANNELS.map((c) => '<label class="feed-row" style="cursor:pointer"><input type="checkbox" ' + (c[3] ? 'checked' : '') + ' style="margin:0 10px 0 0;accent-color:var(--acc)"><div class="fi i-mut">' + I(c[0]) + '</div><div class="ft"><div class="t">' + c[1] + '</div><div class="m">' + c[2] + '</div></div></label>').join('');
    const focus =
      '<div class="promo-focus">' +
      '<div class="pf-cell"><div class="pf-v">' + contactsWithConsent + '</div><div class="pf-l">контактов клуба · инвесторы</div></div>' +
      '<div class="pf-cell"><div class="pf-v">' + auditClub.excluded.length + ' исключены</div><div class="pf-l">без согласия</div></div>' +
      '<div class="pf-cell"><div class="pf-v">12–18</div><div class="pf-l">откликов за 7 дней</div></div>' +
      '<div class="pf-cell pf-cell--cost"><div class="pf-v">' + WS.AED(cost) + '</div><div class="pf-l">стоимость рассылки · ' + WS.AED(perMsg) + '/сообщение</div></div>' +
      '</div>';
    const strip =
      '<div class="promo-strip">' +
      (ph ? '<div class="promo-strip-img" style="background-image:url(' + ph + ')"></div>' : '') +
      '<div class="promo-strip-info">' +
      '<div class="promo-strip-name">' + o.name + '</div>' +
      '<div class="promo-strip-sub">' + I('building') + o.area + ' · ' + o.br + ' · ' + o.size + ' м² · <b>' + WS.AED(o.price) + '</b></div>' +
      '</div>' +
      '<span class="badge ok promo-strip-src">' + I('check') + o.sourceLabel + '</span>' +
      '</div>';
    const body =
      strip +
      focus +
      '<div class="promo-grid">' +
        '<div class="promo-col">' +
          dxSec('doc', 'Сообщение для рассылки', '<span style="font-size:11px;color:var(--mut);font-weight:500">Консьерж · можно править</span>', '<textarea id="promoMsg" class="promo-msg">' + msg + '</textarea>') +
          dxSec('star', 'Креативы для соцсетей', '', '<div class="promo-creatives">' + creatives + '<button class="btn sm ghost" data-act="cgFeatureStub">' + I('plus') + 'Свой креатив</button></div>') +
          dxSec('users', 'Получатели в партнёрской сети', '', '<div class="feed">' + recipRows + '</div>') +
        '</div>' +
        '<div class="promo-col">' +
          dxSec('send', 'Каналы продвижения', '', '<div class="feed">' + channelRows + '</div>') +
        '</div>' +
      '</div>' +
      '<div class="match promo-note">' + I('sparkle') + '<span>Рассылка ' + recips + ' партнёрам. Отклики придут во «Входящие» и Пульс · баланс кошелька <b>8 500 AED</b>.</span></div>';
    openModal('Продвижение объекта', body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="promoSend">' + I('send') + 'Отправить рассылку · ' + WS.AED(cost) + '</button>',
      { wide: true });
  }

  // ---------------- ПРОДВИЖЕНИЕ ПРОЕКТОВ (раздел главного меню — клубный сервис) ----------------
  // Full club-service page (ported from old CRM «Продвижение объекта»): explains the service,
  // then routes each object to the existing openPromotion() composer modal.
  function viewPromotion() {
    const own = D().objects.filter((o) => o.source === 'agency');
    const objs = own.length >= 2 ? own : D().objects;
    const list = objs.map((o) => {
      const perM2 = WS.AED(Math.round(o.price / o.size)) + '/м²';
      return '<div class="feed-row"><div class="fi i-acc">' + I('building') + '</div>' +
        '<div class="ft"><div class="t">' + o.name + '</div><div class="m">' + o.area + ' · ' + o.br + ' · ' + o.size + ' м² · ' + WS.AED(o.price) + ' · ' + perM2 + '</div></div>' +
        '<button class="btn sm primary" data-promo="' + o.id + '">' + I('send') + 'Продвигать</button></div>';
    }).join('');
    const steps = [
      ['Выбираете объект', 'Информация подставляется автоматически, текст рассылки генерирует Консьерж.'],
      ['Проверяете материалы', 'Партнёры получают рабочие материалы для клиентов и креативы для соцсетей.'],
      ['Получаете активных партнёров', 'Только контакты тех, кто реально разместил креатив у себя в соцсетях и мессенджерах.'],
    ].map((s, i) => '<div class="ps"><span class="n">' + (i + 1) + '</span><div><b>' + s[0] + '</b><p>' + s[1] + '</p></div></div>').join('');
    const perks = [
      'Короткое сообщение с объектом, ценой и комиссией — в мессенджер и на платформу WESPACE.',
      'Готовое коммерческое предложение в PDF.',
      'Креативы для Stories и соцсетей.',
      'Вознаграждение за продвижение вашего объекта.',
    ].map((t) => '<div class="chg-row">' + I('check') + '<span>' + t + '</span></div>').join('');
    const recips = (typeof PARTNERS !== 'undefined' ? PARTNERS : []).length || 4;
    const params = '<div class="dfields">' +
      dfPair('Профильных партнёров', recips + ' в сети') +
      dfPair('Цена сообщения', WS.AED(15)) +
      dfPair('Стоимость рассылки', WS.AED(15 * recips)) +
      dfPair('Баланс кошелька', '8 500 AED') + '</div>';
    return head('Продвижение проектов', 'Продвигайте объекты через партнёрскую сеть и социальные каналы брокерского клуба WESPACE — совместное закрытие сделок с партнёрами, рассылка по клубу в 3 клика.', '') +
      '<div class="promo-page">' +
        '<div class="promo-main">' +
          '<div class="card pad"><span class="promo-eyebrow">' + I('star') + 'Брокерский клуб WESPACE</span>' +
            '<div class="section-label" style="margin-top:10px">Как работает продвижение</div><div class="promo-steps">' + steps + '</div></div>' +
          '<div class="card pad" style="margin-top:16px"><div class="section-label">Выберите объект для продвижения · ' + objs.length + '</div><div class="feed" style="margin-top:6px">' + list + '</div></div>' +
        '</div>' +
        '<aside class="promo-side">' +
          '<div class="card pad"><div class="section-label">Параметры рассылки</div>' + params +
            '<div style="font-size:11px;color:var(--faint);margin-top:8px">Оплата — из кошелька платформы. Отклики придут во «Входящие» и Пульс.</div></div>' +
          '<div class="card pad" style="margin-top:16px"><div class="section-label">Что получат партнёры</div><div class="chg-list" style="margin-top:8px">' + perks + '</div></div>' +
        '</aside>' +
      '</div>';
  }


  // ---- Contracts: the process that runs after a deal is won -----------------------------------
  // Decision of 14 August: сопровождение is not a stage of the board but an object of its own. An
  // off-plan contract lives three to five years on a payment schedule; a stage cannot hold that,
  // and a deal left open for it reports work that is already done as pipeline.
  //
  // Every milestone carries two wordings. `label` is ours; `client` is what a client would read.
  // They are authored together deliberately: the client register is meant to reach a client cabinet
  // later, and writing it after the fact means re-deciding every milestone's disclosure at once.
  function contractsAll() { return D().contracts || []; }
  function contractById(id) { return contractsAll().find((k) => k.id === id) || null; }
  function contractsOfDeal(id) { return contractsAll().filter((k) => k.dealId === id); }
  function contractsOfClient(id) { return contractsAll().filter((k) => k.clientId === id); }
  function contractKind(k) { return ((WS.fixtures && WS.fixtures.CONTRACT_KINDS) || {})[k && k.kind] || { label: 'Договор', icon: 'doc' }; }
  function contractStep(k) {
    const ms = (k && k.milestones) || [];
    const cur = ms.filter((m) => m.state === 'now');
    return { cur: cur, done: ms.filter((m) => m.state === 'done').length, total: ms.length };
  }
  // Money on a contract is a state, not a number: a developer pays in tranches, and the difference
  // between «начислено» and «оплачено» is what tells an agent whether to chase anyone.
  function commissionState(k) {
    const c = (k && k.commission) || { entries: [] };
    const paid = (c.entries || []).filter((e) => e.k === 'paid');
    const got = paid.reduce((sum, e) => sum + (e.state === 'wait' ? 0 : (e.amount || 0)), 0);
    const total = c.total || 0;
    const label = !total ? '—' : (got >= total ? 'получена' : (got > 0 ? 'получена частично' : ((c.entries || []).some((e) => e.k === 'invoiced' && e.state !== 'wait') ? 'счёт выставлен' : 'начислена')));
    return { total: total, got: got, label: label, tone: got >= total && total ? 'ok' : (got > 0 ? 'acc' : ''), payer: c.payer || 'по договору', vat: !!c.vat };
  }
  /* Договор требует внимания, когда просрочена веха или платёж. Это не оттенок строки,
     а группа списка: «требуют внимания» — то, ради чего раздел открывают. */
  function contractOverdue(k) {
    return (k.schedule || []).some((s) => s.state === 'overdue') ||
      (k.milestones || []).some((m) => m.state === 'overdue');
  }
  function contractGroup(k) {
    if (k.status === 'closed') return 'closed';
    return (contractOverdue(k) || k.review) ? 'attention' : 'active';
  }
  function contractRow(k) {
    const c = D().clients.find((x) => x.id === k.clientId) || {};
    const st = contractStep(k), money = commissionState(k);
    const now = st.cur.length ? st.cur.map((m) => m.label).join(' · ') : 'все вехи пройдены';
    const obj = (D().objects || []).find((o) => o.id === k.objectId);
    const dl = k.dealId ? D().deals.find((x) => x.id === k.dealId) : null;
    // Строка списка называет всё, по чему договор ищут: клиент · объект · вид · ближайшая
    // веха со сроком · сумма · ответственный. Прежде объекта, суммы и ответственного не было.
    const meta = [obj ? obj.name.split(',')[0] : null, now + ' · веха ' + Math.min(st.done + 1, st.total) + ' из ' + st.total,
      k.nextDue || null, k.amount ? WS.AED(k.amount) : null, dl && dl.agent ? agentName(dl.agent) : null].filter(Boolean).join(' · ');
    const flag = k.review ? '<span class="badge warn">' + I('warn') + 'требует пересмотра</span>' : '';
    return '<div class="feed-row" data-contract="' + k.id + '" style="cursor:pointer">' +
      '<div class="fi i-acc">' + I(contractKind(k).icon) + '</div>' +
      '<div class="ft"><div class="t">' + contractKind(k).label + ' · ' + (c.name || '—') + '</div>' +
      '<div class="m">' + meta + '</div></div>' + flag +
      '<span class="badge ' + money.tone + '">' + I('money') + 'Комиссия · ' + money.label + '</span>' +
      I('arrowRight') + '</div>';
  }
  // Задачи по договору. Ссылка на договор — четвёртый вид привязки задачи рядом с тремя
  // существующими: сопровождение живёт месяцами, и дела по нему принадлежат договору,
  // а не сделке, которая закрылась вознаграждением.
  function tasksOfContract(id) { return (D().tasks || []).filter((t) => t.contractId === id); }
  /* ---- Рождение договора и завершение сделки (§2.5 решений) ----
     Это два разных момента, и их нельзя складывать в одну кнопку. Договор рождается
     на шаге «Подписание»; сделка закрывается тогда, когда получено вознаграждение.
     Создание привязано к СМЕНЕ СТАДИИ, а не к нажатию кнопки, поэтому доска, Консьерж
     и кнопка дают один и тот же результат. */
  const CONTRACT_TEMPLATES = {
    offplan_spa: {
      ms: [['active', 'Договор активен', 'Договор подписан и вступил в силу'], ['pay10', 'Первый платёж на escrow', 'Первый платёж принят застройщиком'],
        ['oqood', 'Регистрация Oqood', 'Сделка зарегистрирована в реестре DLD'], ['built', 'Объект построен', 'Строительство завершено'],
        ['keys', 'Ключи переданы, snag list закрыт', 'Приёмка объекта и передача ключей'], ['title', 'Title Deed получен', 'Право собственности оформлено']],
      pay: [['Первый платёж', 10], ['Второй платёж', 25], ['Третий платёж', 40], ['Финальный платёж', 25]],
    },
    resale_title: {
      ms: [['active', 'Договор активен', 'Договор подписан'], ['noc', 'NOC получен', 'Согласие застройщика получено'],
        ['trustee', 'Встреча в trustee-офисе', 'Переоформление в офисе регистратора'], ['title', 'Title Deed переоформлен', 'Право собственности переоформлено']],
      pay: [['Задаток 10%', 10], ['Остаток на переоформлении', 90]],
    },
    lease: { ms: [['active', 'Договор активен', 'Договор аренды зарегистрирован в Ejari'], ['cheques', 'Оплата по чекам', 'Оплата по графику'],
      ['renewal', 'Уведомление за 90 дней', 'Подготовка к продлению договора'], ['closed', 'Продлён либо выезд', 'Продление или завершение аренды']],
      pay: [['Чек 1 · квартал', 25], ['Чек 2 · квартал', 25], ['Чек 3 · квартал', 25], ['Чек 4 · квартал', 25]] },
    lease_comm: { ms: [['active', 'Договор активен', 'Договор аренды подписан'], ['fitout', 'Отделка и приёмка помещения', 'Помещение принято'],
      ['cheques', 'Оплата по чекам', 'Оплата по графику']], pay: [['Чек 1 · полугодие', 50], ['Чек 2 · полугодие', 50]] },
    management: { ms: [['active', 'Договор управления активен', 'Объект принят в управление'], ['tenant', 'Арендатор найден', 'Найден арендатор'],
      ['payments', 'Контроль оплат от арендатора', 'Платежи поступают по графику'], ['report', 'Отчётность собственнику', 'Отчёт по объекту за период']], pay: [] },
    exclusive: { ms: [['active', 'Мандат активен', 'Эксклюзивный мандат подписан'], ['listing', 'Объект выставлен', 'Объявление опубликовано'],
      ['offers', 'Сбор предложений', 'Предложения от покупателей'], ['closed', 'Мандат исполнен либо истёк', 'Итог мандата']], pay: [] },
    service: { ms: [['active', 'Соглашение активно', 'Соглашение подписано'], ['done', 'Услуга оказана', 'Работа завершена']], pay: [] },
  };
  function contractFromDeal(d) {
    const kind = WS.contractKindFor ? WS.contractKindFor(d.funnel || 'sale', d.readiness) : 'service';
    const tpl = CONTRACT_TEMPLATES[kind] || CONTRACT_TEMPLATES.service;
    const at = WS.storeApi.clockLabel().date;
    const lots = dealLiveLots(d);
    const comm = dealCommission(d);
    /* Всё, чего шаблон знать не может, остаётся пустым и подсвечивается как незаполненное:
       номер договора, точные даты платежей. Подставить сюда правдоподобное значит выдать
       догадку за факт ровно там, где потом будут сверять с реестром. */
    return {
      id: 'k_' + d.id, dealId: d.id, clientId: d.clientId, companyId: d.companyId || null,
      objectId: lots.length === 1 ? lots[0].id : (d.objectId || null),
      lots: lots.map((o) => o.id),
      kind: kind, number: '', signedAt: at, status: 'active', amount: d.amount || 0,
      nextDue: (tpl.pay[0] ? tpl.pay[0][0] + ' — дата не назначена' : 'дата не назначена'),
      milestones: tpl.ms.map((m, i) => ({ k: m[0], label: m[1], client: m[2], at: i === 0 ? at : '—', state: i === 0 ? 'done' : (i === 1 ? 'now' : 'wait') })),
      schedule: tpl.pay.map((p, i) => ({ label: p[0] + ' · ' + p[1] + '%', pct: p[1],
        amount: Math.round((d.amount || 0) * p[1] / 100), due: '—', state: i === 0 ? 'due' : 'wait' })),
      documents: [{ name: contractKind({ kind: kind }).label, at: at, state: 'ok' }],
      commission: { total: comm, payer: 'по договору', vat: !!d.vat, split: d.partnerAgent ? 'co-broking' : null,
        entries: [{ k: 'accrued', label: 'Начислено', amount: comm, at: at, state: 'done' }] },
      timeline: [{ at: at, ord: NOW_ORD, ch: 'crm', kind: 'raw', by: 'Система', text: 'Договор создан из сделки «' + (d.title || d.id) + '».' }],
      fromDeal: true,
    };
  }
  // Одна операция, повторно ничего не создающая: если договор с этой сделкой уже есть,
  // второй не появляется — ни с доски, ни из Консьержа, ни кнопкой.
  function ensureContract(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return null;
    const have = contractsOfDeal(dealId)[0];
    if (have) return have;
    const k = contractFromDeal(d);
    (D().contracts || (D().contracts = [])).unshift(k);
    return k;
  }
  function finishDealForm(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Успех — это полученное вознаграждение, а не подписанный договор: договор рождается раньше, на подписании. Проигрыш освобождает все лоты сделки.</p>' +
      '<div class="match-grid"><label class="fld"><span>Исход</span><select id="fin_out">' +
      '<option value="won">Успех — вознаграждение получено</option><option value="lost">Проигрыш</option></select></label>' +
      '<label class="fld"><span>Причина или комментарий</span><input id="fin_why" type="text" placeholder="Напр.: комиссия пришла двумя траншами"></label></div>';
    openModal('Завершить сделку · ' + (d.title || d.id), body,
      '<button class="btn" data-act="closeModal">Отмена</button>' +
      '<button class="btn primary" data-act="saveFinishDeal" data-deal="' + dealId + '">' + I('check') + 'Завершить</button>');
  }
  function saveFinishDeal(dealId) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const out = g('fin_out') === 'lost' ? 'lost' : 'won';
    const why = g('fin_why');
    d.stage = out;
    if (out === 'won') {
      // Услуга может не иметь шага подписания — тогда договор рождается здесь.
      ensureContract(dealId);
    } else {
      // Проигрыш освобождает все лоты по тому же правилу, что и частичный отказ.
      if (!d.lotState) d.lotState = {};
      dealLiveLots(d).forEach((o) => {
        d.lotState[o.id] = Object.assign({}, d.lotState[o.id], { exit: 'returned', exitReason: why || 'сделка проиграна', exitAt: WS.storeApi.clockLabel().date });
      });
    }
    addEventEntry('deal', d.id, { type: 'note', text: (out === 'won' ? 'Сделка завершена успехом' : 'Сделка проиграна') + (why ? ': ' + why : '') + '.' });
    WS.storeApi.touch();
    closeModal();
    WS.storeApi.toast(out === 'won' ? 'Сделка закрыта успехом' : 'Сделка закрыта проигрышем', out === 'won' ? 'ok' : '');
    dealCard(dealId);
  }
  function viewContracts() {
    const list = contractsAll();
    const active = list.filter((k) => k.status !== 'closed');
    const due = active.filter((k) => k.nextDue).length;
    const owed = active.reduce((sum, k) => { const m = commissionState(k); return sum + Math.max(0, m.total - m.got); }, 0);
    // Группировка по состоянию: сначала то, что горит, потом остальное.
    const GROUPS = [['attention', 'Требуют внимания'], ['active', 'Действующие'], ['closed', 'Закрытые']];
    const rows = GROUPS.map((g) => {
      const part = list.filter((k) => contractGroup(k) === g[0]);
      if (!part.length) return '';
      return '<div class="section-label" style="margin-top:10px">' + g[1] + ' · ' + part.length + '</div>' +
        part.map(contractRow).join('');
    }).join('') ||
      '<div style="font-size:12px;color:var(--faint);padding:10px 0">договоров пока нет — они открываются после успешной сделки</div>';
    return heroBand('Сопровождение', 'Что идёт после подписания: платежи по графику, регистрация права, продления — и работа с самим клиентом, пока он клиент. Сделка закрывается вознаграждением, договор живёт дальше.', 'o_bayline') +
      '<div class="tiles" style="margin-top:20px">' +
      tile('doc', 'Действующих договоров', active.length, '', '', 'Открыты после успешных сделок', '', 'accent', 'data-nav="contracts"') +
      tile('money', 'Комиссия к получению', WS.AED(owed), '', '', owed ? 'Начислено, но ещё не поступило' : 'Всё получено', '', owed ? 'accent' : '', 'data-nav="contracts"') +
      tile('clock', 'Со сроком на контроле', due, '', '', 'Платежи, продления, отчётность', '', '', 'data-nav="contracts"') +
      '</div>' +
      '<div class="card" style="margin-top:16px"><div class="section-label" style="padding:14px 16px 0">Договоры · ' + list.length + '</div>' +
      '<div class="feed" style="padding:2px 16px 10px">' + rows + '</div></div>';
  }
  function contractMilestones(k, forClient) {
    // `internalOnly` is a promise the model makes: such a milestone never reaches the client side,
    // however the cabinet is eventually built. Honouring it only in a comment is worse than not
    // making the promise — the preview would be showing what it claims it never shows.
    const src = (k.milestones || []).filter((m) => !(forClient && m.internalOnly));
    const rows = src.map((m, i) => {
      const cls = m.state === 'done' ? 'done' : (m.state === 'now' ? 'now' : 'wait');
      const icon = m.state === 'done' ? 'check' : (m.state === 'now' ? 'clock' : 'dot');
      const text = forClient ? (m.client || m.label) : m.label;
      return '<div class="ms-row ' + cls + '"><span class="ms-i">' + I(icon) + '</span>' +
        '<span class="ms-t"><span class="ms-l">' + text + '</span>' +
        '<span class="ms-a">' + (m.at || '—') + '</span></span></div>';
    }).join('');
    const hidden = (k.milestones || []).length - src.length;
    return '<div class="ms-list">' + rows + '</div>' +
      (forClient && hidden ? '<div class="gate-foot">Скрыто от клиента: ' + hidden + ' ' +
        plural(hidden, 'внутренняя веха', 'внутренние вехи', 'внутренних вех') + '.</div>' : '');
  }
  function contractMoney(k) {
    const m = commissionState(k);
    const rows = ((k.commission || {}).entries || []).map((e) => {
      const cls = e.state === 'done' ? 'done' : (e.state === 'now' ? 'now' : 'wait');
      return '<div class="ms-row ' + cls + '"><span class="ms-i">' + I(e.state === 'done' ? 'check' : (e.state === 'now' ? 'clock' : 'dot')) + '</span>' +
        '<span class="ms-t"><span class="ms-l">' + e.label + ' · ' + WS.AED(e.amount || 0) + '</span>' +
        '<span class="ms-a">' + (e.at || '—') + '</span></span></div>';
    }).join('');
    return '<div class="dfields">' +
      dfPair('Комиссия по договору', WS.AED(m.total)) +
      dfPair('Получено', WS.AED(m.got) + (m.got && m.got < m.total ? ' · частично' : '')) +
      dfPair('Плательщик', m.payer) +
      dfPair('VAT', m.vat ? '5% применяется' : 'не применяется') +
      ((k.commission || {}).split ? dfPair('Co-broking', k.commission.split) : '') +
      '</div><div style="height:12px"></div><div class="ms-list">' + rows + '</div>' +
      '<div class="gate-foot">Выплата отстаёт от передачи и часто приходит частями — поэтому комиссия ведётся статусом, а не одним числом в сделке.</div>';
  }

  // ---- Contract as a PROCESS card, built on the deal's frame ------------------------------------
  // A contract has stages exactly as a deal does — they are just measured in months rather than
  // days — so it gets the same reading order: hero → what it is → step line → chips → facing pair
  // (brief + schedule on the left, client + latest events on the right). Anything less made it a
  // list of milestones wearing a card, which is what it was.
  function contractHero(k) {
    const c = D().clients.find((x) => x.id === k.clientId) || {};
    const o = (D().objects || []).find((x) => x.id === k.objectId);
    const bg = (o && WS.photos && WS.photos[o.id]) || (WS.photos && WS.photos.o_interior) || '';
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const sub = [contractKind(k).label, o ? o.name.split(',')[0] : null, k.amount ? WS.AED(k.amount) : null].filter(Boolean).join(' · ');
    return '<div class="dhero">' + (bg ? '<img class="dhero-img" src="' + bg + '" alt="">' : '') +
      '<div class="dhero-scrim"></div>' +
      '<div class="dhero-content"><div class="dhero-av">' + init + '</div>' +
      '<div class="dhero-info"><div class="dhero-name">' + (c.name || 'Без клиента') + '</div>' +
      '<div class="dhero-sub">' + sub + '</div></div></div></div>';
  }
  function contractStepperSection(k) {
    const ms = k.milestones || [];
    const idx = Math.max(0, ms.findIndex((m) => m.state === 'now'));
    const steps = ms.map((m, i) => {
      const cls = m.state === 'done' ? 'done' : (m.state === 'now' ? 'cur' : 'todo');
      return '<button class="dx-step ' + cls + '" title="' + escAttr(m.at || '') + '"><span class="d">' +
        (m.state === 'done' ? I('check') : String(i + 1)) + '</span><span class="l">' + m.label + '</span></button>';
    }).join('');
    const cap = 'Веха ' + (idx + 1) + ' из ' + ms.length + ' · ' + ((ms[idx] || {}).label || '—');
    return dxSec('trend', 'Ход договора', '<span class="dx-step-cap">' + cap + '</span>',
      '<div class="dx-stepper' + (ms.length > 5 ? ' long' : '') + '">' + steps + '</div>');
  }
  function contractChipRow(k) {
    const age = createdAgoLabel({ createdAt: k.signedAt });
    const money = commissionState(k);
    return '<div class="dnb-chips">' +
      '<span class="chip">' + I('calendar') + 'подписан ' + k.signedAt + (age ? ' · ' + age : '') + '</span>' +
      (k.nextDue ? '<span class="chip">' + I('clock') + k.nextDue + '</span>' : '') +
      '<span class="chip">' + I('money') + 'комиссия ' + money.label + '</span>' +
      (k.status === 'closed' ? '<span class="chip">' + I('check') + 'закрыт</span>' : '') + '</div>';
  }
  // The schedule is what the contract IS for an off-plan purchase or a lease. Rendering it as one
  // milestone («платежи по графику») hid the four dates the money actually moves on.
  function contractSchedule(k) {
    const rows = (k.schedule || []).map((x) => {
      const cls = x.state === 'paid' ? 'done' : (x.state === 'wait' ? 'wait' : 'now');
      const tone = x.state === 'paid' ? 'ok' : (x.state === 'overdue' ? 'stop' : (x.state === 'due' ? 'acc' : ''));
      const word = x.state === 'paid' ? 'оплачен' : (x.state === 'overdue' ? 'просрочен' : (x.state === 'due' ? 'ближайший' : 'ожидается'));
      return '<div class="ms-row ' + cls + '"><span class="ms-i">' + I(x.state === 'paid' ? 'check' : (x.state === 'due' ? 'clock' : 'dot')) + '</span>' +
        '<span class="ms-t"><span class="ms-l">' + x.label + ' · ' + WS.AED(x.amount || 0) + '</span>' +
        '<span class="ms-a">' + (x.due || '—') + '</span></span>' +
        '<span class="badge ' + tone + '">' + word + '</span></div>';
    }).join('');
    if (!rows) return '';
    const paid = (k.schedule || []).filter((x) => x.state === 'paid').reduce((a, x) => a + (x.amount || 0), 0);
    const total = (k.schedule || []).reduce((a, x) => a + (x.amount || 0), 0);
    return dxSec('money', 'График по договору',
      '<span class="badge' + (paid >= total ? ' ok' : ' acc') + '">' + WS.AED(paid) + ' из ' + WS.AED(total) + '</span>',
      '<div class="ms-list">' + rows + '</div>');
  }
  function contractDocs(k) {
    const rows = (k.documents || []).map((x) => {
      const on = x.state === 'ok';
      return '<div class="ms-row ' + (on ? 'done' : 'wait') + '"><span class="ms-i">' + I(on ? 'doc' : 'dot') + '</span>' +
        '<span class="ms-t"><span class="ms-l">' + x.name + '</span><span class="ms-a">' + (x.at || '—') + '</span></span>' +
        (on ? '<button class="btn xs" data-act="contractDoc" data-kref="' + k.id + '" data-docname="' + escAttr(x.name) + '">' + I('download') + 'Открыть</button>'
            : '<span class="badge">ожидается</span>') + '</div>';
    }).join('');
    return dxSec('doc', 'Документы договора', '', rows || '<div style="font-size:12px;color:var(--faint);padding:6px 0">документов по договору пока нет</div>');
  }
  // Latest events, mirroring dealRecentCard — a contract card with no recent activity reads as dead.
  function contractRecentCard(k) {
    const rows = (k.timeline || []).slice(0, 3).map((e) => tlRow(e)).join('') ||
      '<div style="font-size:12px;color:var(--faint);padding:6px 0">событий пока нет</div>';
    return dxSec('clock', 'Последние события',
      '<button class="btn xs" data-etab="contract~' + k.id + '~history">' + I('arrowRight') + 'вся история</button>',
      '<div class="feed">' + rows + '</div>');
  }
  // The contract brief: where this contract stands, what moves next and whether the money arrived.
  function contractBriefSentences(k) {
    const c = D().clients.find((x) => x.id === k.clientId) || {};
    const st = contractStep(k), money = commissionState(k);
    const out = [];
    const age = createdAgoLabel({ createdAt: k.signedAt });
    // The client's name never lands after a preposition: «с Анна Петрова» is what a template
    // produces, and there is no reliable way to decline an arbitrary name.
    out.push(contractKind(k).label + ', номер ' + k.number + '. Клиент — ' + (c.name || 'не указан') +
      '; подписан ' + k.signedAt + (age ? ', ' + age : '') + '.');
    const now = st.cur.map((m) => lowerFirst(m.label));
    out.push(now.length
      ? 'Сейчас: ' + now.join('; ') + '.'
      : 'Все вехи пройдены — договор можно закрывать.');
    const late = (k.schedule || []).find((x) => x.state === 'overdue');
    const due = (k.schedule || []).find((x) => x.state === 'due');
    if (late) out.push('Просрочен платёж: ' + lowerFirst(late.label) + ' на ' + WS.AED(late.amount) + ', срок был ' + late.due + '.');
    else if (due) out.push('Ближайший платёж — ' + lowerFirst(due.label) + ' на ' + WS.AED(due.amount) + ', срок ' + due.due + '.');
    if (money.total) {
      out.push(money.got >= money.total
        ? 'Комиссия ' + WS.AED(money.total) + ' получена полностью, платил ' + money.payer + '.'
        : 'Из комиссии ' + WS.AED(money.total) + ' получено ' + WS.AED(money.got) + '; платит ' + money.payer + '.');
    }
    const waitingDocs = (k.documents || []).filter((x) => x.state !== 'ok').length;
    if (waitingDocs) out.push('Не хватает ' + waitingDocs + ' ' + plural(waitingDocs, 'документа', 'документов', 'документов') + '.');
    return out;
  }
  function contractStatusBrief(k) {
    return dxSec('sparkle', 'Справка по договору', '<span class="badge ai-b">' + I('sparkle') + 'собрано AI</span>',
      '<p class="deal-brief">' + contractBriefSentences(k).join(' ') + '</p>');
  }
  function contractClientCard(k) {
    const c = D().clients.find((x) => x.id === k.clientId);
    if (!c) return '';
    // Explicit thread: passing the contract through as a deal produced «deal:k_palm», a thread id
    // for a deal that does not exist.
    return dealClientCard({ clientId: c.id, id: k.id }, 'contract:' + k.id);
  }
  function contractHero2(k) {
    return contractHero(k) +
      '<div class="deal-title-edit"><span class="deal-title-lbl">' + I('doc') + 'Договор</span>' +
      '<span class="deal-title-text is-static">' + contractKind(k).label + ' · ' + k.number + '</span></div>';
  }
  function contractState(k) {
    return '<div class="deal-stepper-compact">' + contractStepperSection(k) + '</div>' +
      contractChipRow(k) +
      cxStack([[cxCol([contractStatusBrief(k), contractSchedule(k)]),
                cxCol([contractClientCard(k), contractRecentCard(k)])]]);
  }
  // Things you do TO a contract, as opposed to reading it: amend it, invoice against it, renew or
  // terminate it. They live in the same bar as every other card's actions.
  // The id travels as data-kref, NOT data-contract: the latter is the navigation attribute a
  // contract ROW carries, and the delegated handler reaches it first — the button would silently
  // reopen the card instead of running the verb.
  function contractActions(k) {
    const money = commissionState(k);
    const acts = [
      ['pencil', 'Доп. соглашение', 'data-act="contractAmend" data-kref="' + k.id + '"', ''],
      money.got < money.total ? ['money', 'Выставить счёт', 'data-act="contractInvoice" data-kref="' + k.id + '"', 'primary'] : null,
      k.kind === 'lease' || k.kind === 'lease_comm' ? ['replay', 'Продлить', 'data-act="contractRenew" data-kref="' + k.id + '"', ''] : null,
      ['x', 'Расторжение', 'data-act="contractTerminate" data-kref="' + k.id + '"', 'danger'],
      ['chat', 'Чат по договору', 'data-thread="contract:' + k.id + '" data-tlabel="' + escAttr(contractKind(k).label) + '" data-ticon="doc"', ''],
      k.clientId ? ['users', 'Открыть клиента', 'data-client="' + k.clientId + '"', ''] : null,
      k.dealId ? ['briefcase', 'Исходная сделка', 'data-deal="' + k.dealId + '"', ''] : null,
    ].filter(Boolean);
    return acts;
  }
  // A demo has to be honest about what it does not do: these open a described intent, not a stub
  // that silently succeeds.
  function contractDocOpen(id, name) {
    const k = contractById(id); if (!k) return;
    openModal('Документ · ' + escAttr(name),
      '<p style="font-size:13px;line-height:1.5;margin-top:0">Документ по договору ' + escAttr(k.number) +
      '. В рабочей системе здесь открывается файл из хранилища тенанта; в демо файлов нет.</p>' +
      '<div class="prov" style="margin-top:12px"><span class="badge demo">' + I('lock') + 'демо — файла нет</span></div>',
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  function contractAct(kind, id) {
    const k = contractById(id); if (!k) return;
    const M = {
      contractAmend: ['Дополнительное соглашение', 'Меняем условия действующего договора: сумму, график платежей, срок или состав услуг. Прежняя редакция сохраняется в истории договора, новая уходит на подпись сторонам.'],
      contractInvoice: ['Счёт на комиссию', 'Выставляем счёт на невыплаченный остаток комиссии по этому договору. Плательщик — ' + commissionState(k).payer + '. Статус в блоке «Комиссия» перейдёт в «счёт выставлен».'],
      contractRenew: ['Продление договора', 'Запускаем продление: уведомление об изменении условий за 90 дней, проверка по индексу RERA и перерегистрация Ejari.'],
      contractTerminate: ['Расторжение договора', 'Расторжение прекращает обязательства сторон и закрывает договор. Начисленная, но не полученная комиссия останется задолженностью и не спишется автоматически.'],
    }[kind] || ['Действие по договору', ''];
    openModal(M[0] + ' · ' + escAttr(k.number),
      '<p style="font-size:13px;line-height:1.5;margin-top:0">' + M[1] + '</p>' +
      '<div class="prov" style="margin-top:12px"><span class="badge demo">' + I('lock') + 'демо — действие описано, но не выполняется</span></div>',
      '<button class="btn" data-act="closeModal">Закрыть</button>');
  }
  function contractTabContent(k, tab) {
    if (tab === 'docs') return contractDocs(k);
    /* Задачи по договору. Сопровождение живёт месяцами, и дела по нему принадлежат договору,
       а не сделке: сделка закрылась вознаграждением и своих задач больше не порождает. */
    if (tab === 'tasks') {
      const list = tasksOfContract(k.id);
      const add = '<button class="btn xs" data-act="newTask">' + I('plus') + 'Задача</button>';
      const rows = list.map(taskRow).join('') ||
        '<div style="font-size:12px;color:var(--faint);padding:6px 0">задач по договору нет. Они появляются из поводов касания и вручную</div>';
      return dxSec('checkCircle', 'Задачи по договору · ' + list.length, add, '<div class="feed">' + rows + '</div>');
    }
    if (tab === 'money') return dxSec('money', 'Комиссия', '<span class="badge ' + commissionState(k).tone + '">' + commissionState(k).label + '</span>', contractMoney(k));
    if (tab === 'client') {
      return dxSec('users', 'Что видит клиент', '<span class="badge demo">' + I('lock') + 'предпросмотр</span>',
        '<div class="gate-foot" style="margin-top:0;margin-bottom:12px">Так этот договор читается со стороны клиента. Личного кабинета ещё нет — здесь показано, что в него пойдёт: клиент видит, где находится его проект, не звоня агенту.</div>' +
        contractMilestones(k, true));
    }
    if (tab === 'history') {
      const rows = (k.timeline || []).map((e) => tlRow(e)).join('') ||
        '<div style="font-size:12px;color:var(--faint);padding:6px 0">по договору пока нет событий</div>';
      return dxSec('clock', 'История договора', '', '<div class="feed">' + rows + '</div>');
    }
    const c = D().clients.find((x) => x.id === k.clientId) || {};
    const co = (D().companies || []).find((x) => x.id === k.companyId);
    const o = (D().objects || []).find((x) => x.id === k.objectId);
    const d = (D().deals || []).find((x) => x.id === k.dealId);
    // The step line is up in the header now, so the tab carries the dated detail behind it.
    return cxStack([
      dxSec('doc', 'Вехи договора', '<span class="badge acc">' + contractStep(k).done + ' из ' + contractStep(k).total + '</span>', contractMilestones(k, false)),
      dxSec('briefcase', 'Реквизиты договора', '', '<div class="dfields cols2">' +
        dfPair('Номер', k.number) + dfPair('Подписан', k.signedAt) +
        dfPair('Клиент', c.name || '—') + (co ? dfPair('Компания', co.name) : '') +
        (o ? dfPair('Объект', o.name) : '') + dfPair('Сумма договора', WS.AED(k.amount || 0)) +
        (k.nextDue ? dfPair('Ближайший срок', k.nextDue) : '') +
        (d ? dfPair('Из сделки', '<a href="#" data-deal="' + d.id + '">' + d.title + '</a>') : dfPair('Из сделки', 'закрыта до демо-периода')) +
        '</div>'),
    ]);
  }
  function contractSpec(id) {
    const k = contractById(id); if (!k) return null;
    const c = D().clients.find((x) => x.id === k.clientId) || {};
    const money = commissionState(k);
    return {
      type: 'contract', id: id, title: contractKind(k).label + ' · ' + (c.name || ''),
      hero: contractHero2(k),
      acts: entityActionBar(contractActions(k)),
      state: contractState(k),
      tabs: [['milestones', 'Вехи'], ['money', 'Комиссия'], ['tasks', 'Задачи · ' + tasksOfContract(id).filter((t) => t.status !== 'done').length], ['docs', 'Документы · ' + (k.documents || []).length], ['client', 'Что видит клиент'], ['history', 'История']],
      render: (tab) => contractTabContent(k, tab),
      concierge: entityConcierge('Поручите Консьержу по договору — «что просрочено», «когда следующий платёж», «письмо клиенту о статусе»…', 'contract:' + k.id, escAttr(contractKind(k).label), 'doc'),
    };
  }
  function viewContractDetail(id) {
    const spec = contractSpec(id);
    if (!spec) return viewContracts();
    return entityPage(spec, 'contracts', '', 'Назад к договорам');
  }
  function contractCard(id) {
    const spec = contractSpec(id); if (!spec) return;
    S().contractId = id; WS.router.go('contractDetail');
  }

  // ---------------- MAIN RENDER ----------------
  function viewFor(id) {
    switch (id) {
      case 'start': return viewStart();
      case 'concierge': return viewConcierge();
      case 'clients': return wrap(viewClients());
      case 'objects': return wrap(viewObjects());
      case 'contracts': return wrap(viewContracts());
      case 'contractDetail': return wrap(viewContractDetail(S().contractId));
      case 'objectDetail': return wrap(viewObjectDetail(S().objectId));
      case 'dealDetail': return wrap(viewDealDetail(S().dealId));
      case 'clientDetail': return wrap(viewClientDetail(S().clientId));
      case 'companyDetail': return wrap(viewCompanyDetail(S().companyId));
      case 'tasks': return wrap(viewTasks());
      case 'team': return S().role === 'manager' ? wrap(viewTeam()) : viewStart();
      case 'leads': return S().role === 'manager' ? wrap(viewLeadsDistribution()) : wrap(viewRequests());
      case 'approvals': return S().role === 'manager' ? wrap(viewApprovals()) : viewStart();
      case 'calc': return wrap(viewCalc());
      case 'finance': return wrap(viewFinance());
      case 'shows': return wrap(viewShows());
      case 'docs': return wrap(viewDocs());
      case 'requests': return wrap(viewRequests());
      case 'requestDetail': return wrap(viewRequestDetail(S().requestId));
      case 'companies': return wrap(viewCompanies());
      case 'analytics': return wrap(viewAnalytics());
      case 'valuation': return wrap(viewValuation());
      case 'partners': return wrap(viewPartners());
      case 'services': return wrap(viewServices());
      case 'profile': return wrap(viewProfile());
      case 'club': return wrap(viewClub());
      case 'promotion': return wrap(viewPromotion());
      case 'settings': return wrap(viewSettings());
      case 'radar': return viewStart(); // merged into "Рабочий день"; alias kept for S5 + legacy links
      default: return viewStart();
    }
  }

  function wrap(inner) { return '<div class="view fadeup">' + inner + '</div>'; }

  // Один и тот же экран с той же открытой записью — не переход, а обновление: прокрутка
  // сохраняется. Другая запись или другой раздел — начинаем сверху, как и раньше.
  // Место, куда вернуться после «назад». Применяется один раз, ближайшей перерисовкой.
  function restoreScroll(y) { WS._restoreY = y || null; }
  function renderKey(st) {
    return [st.view, st.dealId, st.requestId, st.clientId, st.companyId, st.objectId, st.contractId].join('|');
  }
  // Инициализация интереса контактов к типам объектов из заявок.
  // Вызывается один раз при первом рендере.
  function initContactObjTypes() {
    if (WS._contactObjTypesInited) return;
    const d = D();
    if (!d || !d.clients) return;
    WS._contactObjTypesInited = true;
    d.clients.forEach((c) => fillContactObjTypesFromRequests(c));
  }
  function render() {
    const app = document.getElementById('app');
    const st = S();
    // Инициализация интереса контактов — один раз при загрузке
    initContactObjTypes();
    // preserve focus in prompt inputs across renders
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const caret = active && active.selectionStart;
    const key = renderKey(st);
    const sameScreen = WS._renderKey === key;
    const doc0 = document.scrollingElement || document.documentElement;
    const mainEl0 = document.getElementById('main');
    const keepY = sameScreen ? (doc0 ? doc0.scrollTop : 0) : 0;
    const keepMainY = sameScreen && mainEl0 ? mainEl0.scrollTop : 0;
    WS._renderKey = key;

    app.innerHTML = shell();
    ensureOverlays(); // modal/toasts live outside #app — never wiped by this render (P0-1)
    document.getElementById('main').innerHTML = viewFor(st.view);
    document.getElementById('drawer').innerHTML = drawer();

    // Полноэкранный Консьерж — единственное место, где лента живёт ВНУТРИ страницы.
    // С любого другого экрана разговор идёт в доке поверх него, и экран не перестраивается.
    if (st.view === 'concierge') mountConcierge();
    if (st.view === 'objects') bindObjects();
    if (st.view === 'start') bindProspSwipe();
    bindListSearch();
    if (st.view === 'finance') renderFinance();
    // Hide the floating Concierge launcher (W) on the Concierge screen itself — it's redundant there.
    // На самом экране Консьержа закладка не нужна — она вела бы туда, где уже стоишь.
    const _tab = document.querySelector('.cg-tab'); if (_tab) _tab.style.display = (st.view === 'concierge') ? 'none' : '';
    renderToasts();

    if (st.navOpen) { document.getElementById('drawer').classList.add('show'); document.getElementById('scrim').classList.add('show'); }
    if (st.incompatible) { showIncompatible(); st.incompatible = false; }

    if (focusId) { const elx = document.getElementById(focusId); if (elx) { elx.focus(); try { elx.setSelectionRange(caret, caret); } catch (e) {} } }
    // Возврат «назад» просит вернуть место, с которого ушли, — оно сильнее обычного правила
    // «другой экран открывается сверху».
    const back = WS._restoreY; WS._restoreY = null;
    if (back) {
      const scb = document.scrollingElement || document.documentElement;
      const mb = document.getElementById('main');
      requestAnimationFrame(() => {
        if (scb && back.doc) scb.scrollTop = back.doc;
        if (mb && back.main) mb.scrollTop = back.main;
      });
    }
    if (keepY || keepMainY) {
      const sc = document.scrollingElement || document.documentElement;
      if (sc && keepY) sc.scrollTop = keepY;
      const mainEl = document.getElementById('main');
      if (mainEl && keepMainY) mainEl.scrollTop = keepMainY;
    }
    // docked chat lives outside #app (survives re-render); keep the engine pointed at it while open
    if (st.cgDock) { const m = document.getElementById('cgdockmsgs'); if (m) WS.engine.mount(m, renderDockMsgs); }
    if (WS.router && WS.router.mark) WS.router.mark();
  }

  function showIncompatible() {
    openModal('Несовместимая версия данных',
      '<p>Сохранённое состояние стенда относится к другой версии схемы. Рекомендуется безопасный сброс к исходным данным.</p>',
      '<button class="btn" data-act="closeModal">Оставить как есть</button><button class="btn primary" data-act="reset">Безопасный сброс</button>');
  }

  WS.ui = { render, stageLabel, STAGE_CODES: STAGES.map((x) => x.k), cgModeLabel, cgDepthLabel, cgWrites,
    openModal, closeModal, openSections, openHelp, renderToasts, drawer, mountConcierge, cgContextMenu,
    docsOfDeal, docsOfRequest, docScope, tasksOfDeal, tasksOfRequest, taskScopeLabel, DEAL_BANDS, dealBandOf, bandOutliers, reqStage, reqStageLabel, dealSteps, boardFits, reqOfferStatus, reqSelectedFree, clampStage, clientOffers, clientSeenObjects, contactsSearchList,
    openArtifact, openArtifactId, openKp, openXls, openDoc, openFinance, finSlider, finScenario, clientCard, objectCard,
    openReassign, openNewTask, createTaskFromForm, dealCard, taskCard, moveDealDir, showCard, saveEvent, openNewThread,
    openPsychForm, savePsychForm, openDealForm, createDeal, openContactForm, createContact, openObjectForm, createObject, openCgFeature,
    openDealEdit, saveDealEdit, saveDealField, dealChatPanel, openDealChat, closeDealChat,
    cDat, cGen, oppShort, pulseAlerts, consentDaysLeft, consentLine, consentLineShort, consentState, movedCounts, pulseSection, PULSE_SECTIONS, pulseMoved, openOwnerReport, sendOwnerReport, ownerSecondObject, dayBucket, dayOnsite, dayTime, pulseDayItems, openReplyDraft, openSelection, openShowForm, createShow, openShowOutcome, saveShowOutcome, showNextStep, showHasOutcome, selectionMeaning, selectionObjects, sendSelection, replyDraft, replyPicks, sendReply, dealBrief, dealNext, dealWon, goalDrill, inboxWaiting, inboxWaitMin, oppObjectBusy, prospectRulesFired, pulseInsights, restoreScroll, reqNow, screenContext, screenContextLabel, toggleCgDock, sendFromCard, sendFromDock, prospectCard, moveInboxStage, inboxKanban, inboxStageLabel, nextTaskOfDeal, dealArchived, dealClosed, dealTermsAgreed, dealTabsFor, pulseProspects, pulseProspectList, pulseDayItems, marketingSpend, contactRoles, reqStage, contactsReach, contactsSelectionLabel, openContactsChat, closeContactsChat, contactsSearchList, archiveToggle, archiveDeal, saveArchive, unarchiveDeal, duplicateDeal, BOARD_MIN, dfieldAllowed, dealLots, dfieldParse, dealPlannedEventsCard, toggleGate, contractCard, contractAct, contractDocOpen, openGoalEdit, saveGoal, toggleGoalPin, deleteGoal, confirmDeleteGoal, addGoal, createGoal, openEventForm, setFeedType, saveEventEntry,
    // headless seams for the Concierge — no DOM, safe to drive programmatically
    addEventEntry, clientSpec, calendarActivities, threadGroup: getThreadGroup,
    outcomesFor, addOutcomeDraft, confirmOutcome, rejectOutcome,
    taskDoneForm, saveTaskDone,
    REL_STAGES, relStageOf, relStageDerived, setRelStage, clientHasWon, lastTouchDays,
    cuesFor, acceptCue, dismissCue, cueDecision, relationsAhead, relationsPast,
    ROLE_GROUPS, CONTACT_ROLES, INFLUENCE, CHANNELS, roleOf, roleGroupOf, influenceOf, dealParticipants, dealContacts,
    LOT_EXITS, lotState, lotIsOut, dealLiveLots, lotCommissionPct, lotsMismatch, lotExitForm, saveLotExit, undoLotBlock,
    contractFromDeal, ensureContract, finishDealForm, saveFinishDeal, contractsOfDeal,
    contractGroup, contractOverdue, tasksOfContract,
    turnOf, turnDerived, setTurn, reqOfferStatus,
    dealHasNextStep, dealsWithoutNextStep, pulseNoNextStep,
    dealTransferForm, saveTransfer, dealPartnerForm, savePartner,
    offersOf, newOffer, offerById, editOffer, openOfferForm, saveOffer, sendOffer, metricsSnapshot, feedOwner, userById, dealCommission, computeGoalProgress, openAgentEvidence, openDealContactForm, saveDealContact, removeDealContact, setEntityTab, entityCard, openAnalyticsDrill, resolveException, companyCard, openAuditLog,
    openWallet, renderCgDock, valInput, valFromObj, openPromotion, objGalleryNav, openClubPost, openClubRequest, openServiceRequest, openWalletTopup, callClient, requestCard, reqObjState, reqAddObject, reqAddObjectDo, reqFormKp, reqCreateDeal, openRequestEdit, saveRequestEdit, openReqKp, openDealKp, setObjOrigin, refreshCommsTab, refreshCgRail, routeName, backBtn, fillContactObjTypesFromRequests };
  WS.partners = PARTNERS;
  // Инициализация интереса контактов при загрузке модуля ui.js (синхронно, без задержки)
  // Это гарантирует, что контакты заполнены до вычисления Пульса (pulseProspectList)
  try { initContactObjTypes(); } catch (e) {}
})(window.WS = window.WS || {});

