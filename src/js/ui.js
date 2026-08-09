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

  // v3 first level (by frequency): Пульс · Консьерж · Заявки · Сделки · Клиенты · Объекты · Оценка
  const NAV = [
    { id: 'start', label: 'Пульс', icon: 'pulse' },
    { id: 'concierge', label: 'Консьерж', icon: 'sparkle' },
    // Заявки → Сделки: the funnel entry sits next to deals (CRM convention: Pipedrive / HubSpot / amoCRM).
    { id: 'requests', label: 'Заявки', icon: 'mail', count: () => ((D().requests || []).length + (D().inbox || []).length) },
    { id: 'clients', tab: 'deals', label: 'Сделки', icon: 'briefcase', count: () => D().deals.length },
    { id: 'tasks', label: 'Задачи', icon: 'checkCircle', count: () => (D().tasks || []).filter((t) => t.status !== 'done').length },
    { id: 'clients', tab: 'contacts', label: 'Клиенты', icon: 'users', count: () => (D().clients || []).length },
    { id: 'objects', label: 'Объекты', icon: 'building', count: () => D().objects.length },
    { id: 'valuation', label: 'Оценка объекта', icon: 'calc' },
  ];
  // "Ещё" group — full v3 framework. Подбор/Доходность are contextual (reached from
  // object/deal cards), so they are not first-level nav items.
  const NAV_MORE = [
    { id: 'partners', label: 'Сеть', icon: 'handshake' },
    { id: 'companies', label: 'Компании', icon: 'building' },
    { id: 'shows', label: 'Календарь', icon: 'calendar' },
    { id: 'promotion', label: 'Продвижение', icon: 'send' },
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
    { id: 'tasks', label: 'Задачи', icon: 'checkCircle', count: () => (D().tasks || []).filter((t) => t.status !== 'done').length },
    { id: 'leads', label: 'Распределение', icon: 'mail', count: () => (D().inbox || []).length },
    { id: 'approvals', label: 'Согласования', icon: 'check', count: () => MGR_APPROVALS.length - (S().apprDone || []).length },
    { id: 'analytics', label: 'Аналитика', icon: 'trend' },
  ];
  const NAV_MGR_MORE = [
    { id: 'clients', tab: 'contacts', label: 'Клиенты', icon: 'users' },
    { id: 'objects', label: 'Объекты', icon: 'building' },
    { id: 'partners', label: 'Сеть', icon: 'handshake' },
    { id: 'companies', label: 'Компании', icon: 'building' },
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
      return '<a class="nav-item' + on + '" data-nav="' + n.id + '"' + tab + ' tabindex="0">' + I(n.icon) + '<span>' + n.label + '</span>' + cnt + '</a>';
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

    return '' +
      '<div class="app">' +
        '<div class="brand"><div class="logo">W</div><div><div class="wm">WE<span>SPACE</span></div></div></div>' +
        '<div class="topbar">' +
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

  // ---------------- DOCKED CONCIERGE CHAT (float over any page) ----------------
  function cgDockWelcome() {
    return '<div class="cgdock-welcome">' + I('sparkle') +
      '<div class="cgdock-w-t">Чат с Консьержем</div>' +
      '<div class="cgdock-w-m">Спросите что угодно, не покидая текущий раздел.</div>' +
      '<div class="qa-row" style="justify-content:center;margin-top:12px">' +
      '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать объект</button>' +
      '<button class="chip" data-scn="S8">' + I('sparkle') + 'Бриф к звонку</button></div></div>';
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
    if (!S().cgDock) { el.className = 'cgdock'; el.innerHTML = ''; return; }
    const t = WS.engine.activeThread();
    const label = t ? t.label : 'Новый диалог';
    el.className = 'cgdock show';
    el.innerHTML =
      '<div class="cgdock-head"><span class="cgdock-title">' + I('sparkle') + 'Консьерж</span>' +
        '<span class="cgdock-sub">' + label + '</span>' +
        '<button class="cgdock-x" data-act="cgDockOpenFull" title="Открыть на весь экран">' + I('layers') + '</button>' +
        '<button class="cgdock-x" data-act="cgDock" title="Свернуть">' + I('x') + '</button></div>' +
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
  function dealCommission(deal) {
    if (!deal) return 0;
    const obj = (D().objects || []).find((o) => o.id === deal.objectId);
    const pct = (obj && obj.commissionPct) || DEFAULT_COMM_PCT;
    return Math.round((deal.amount || 0) * pct / 100);
  }

  function computeMetrics() {
    const A = D().attribution || []; const deals = D().deals || [];
    const leads = A.reduce((s, x) => s + x.leads, 0);
    const won = A.reduce((s, x) => s + x.deals, 0);
    const saleFunnels = ['sale_offplan', 'sale_ready', 'rental_biz', 'referral'];
    const activeSales = deals.filter((d) => d.stage !== 'done' && saleFunnels.indexOf(d.funnel) >= 0);
    const expectedComm = Math.round(activeSales.reduce((s, d) => s + dealCommission(d), 0));
    const closed = deals.filter((d) => d.stage === 'done');
    return { leads, won, conv: leads ? Math.round((won / leads) * 100) : 0, expectedComm, closedCount: closed.length, closedSum: closed.reduce((s, d) => s + d.amount, 0), attribution: A };
  }
  // ---- Named metrics over the real demo state ----
  // The Concierge must answer with numbers that match what is on screen, so it reads THESE and
  // never computes its own. Each entry: a value plus a human label, addressable by a stable key.

  // Opens the records a figure was computed from. This is what makes an answer
  // checkable in the room: the number is not asserted, it is shown with its rows.
  function openAgentEvidence(i) {
    const r = WS.engine.lastReply && WS.engine.lastReply.evidence;
    const e = r && r[i];
    if (!e) return;
    const res = WS.query.run(Object.assign({}, e.query, { aggregate: null }));
    const rows = (res.rows || []).map((x) => {
      const title = x.title || x.name || x.id;
      const sub = [x.stage, x.due, x.area, x.amount ? WS.AED(x.amount) : null].filter(Boolean).join(' · ');
      return '<div class="feed-row"><div class="fi i-acc">' + I('source') + '</div><div class="ft">' +
        '<div class="t">' + escAttr(title) + '</div>' +
        (sub ? '<div class="m">' + escAttr(sub) + '</div>' : '') + '</div></div>';
    }).join('');
    openModal('Откуда это число · ' + escAttr(e.label),
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
    const ACTIVE = [{ field: 'stage', op: 'ne', value: 'done' }];
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
    const closed = deals.filter((d) => d.stage === 'done').length;
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
  // Инсайты — «второй мозг»: агент-отобранные гипотезы/находки по клиентам, объектам и комплаенсу.
  // Каждый инсайт = находка + почему важно + предложенное действие (клик ведёт в сущность).
  // Инсайты = автоматически сгенерированные Консьержем группы задач (рекомендательная система).
  // Один источник для Пульса (краткий блок) и экрана «Задачи» (типизированные AI-группы).
  const INSIGHTS = [
    ['sparkle', 'Анна Петрова — 3 дня без связи', 'High-priority клиент остывает: был активен, интерес к Creekline подтверждён.', 'Связаться', 'data-client="c_anna"'],
    ['trend', 'Bayline 1603 — на 8% ниже компов', 'Сильный аргумент под инвестора: доходность выше среднего по району.', 'Предложить Виктору', 'data-deal="d_viktor"'],
    ['shield', 'Escrow по Creekline — через 4 дня', 'Комплаенс-риск off-plan: нужен receipt до дедлайна DLD.', 'Открыть сделку', 'data-deal="d_anna"'],
    ['star', 'Karim Aziz ценит статус', 'По психопрофилю Palm Court под его предпочтения: престиж + вид.', 'Подобрать объект', 'data-client="c_partner"'],
  ];
  function insightCards() {
    return '<div class="insights">' + INSIGHTS.map((it) => '<div class="insight"><div class="insight-h"><span class="insight-ic">' + I(it[0]) + '</span><div class="insight-t">' + it[1] + '</div></div>' +
      '<div class="insight-w">' + it[2] + '</div>' +
      '<div class="insight-a"><button class="btn sm" ' + it[4] + '>' + I('arrowRight') + it[3] + '</button></div></div>').join('') + '</div>';
  }
  function insightsBlock() {
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0;display:flex;align-items:center;gap:8px">Инсайты <span class="badge demo">' + I('sparkle') + 'второй мозг · демо</span></div>' +
      '<button class="btn sm" data-nav="concierge">' + I('chat') + 'Спросить Консьержа</button></div>' + insightCards();
  }
  function canonMetrics() {
    const m = computeMetrics();
    const mtile = (label, val, sub, act) => '<button class="mtile" ' + act + '><div class="ml">' + label + '</div><div class="mv">' + val + '</div><div class="ms">' + sub + '</div></button>';
    const srcRows = m.attribution.map((a) => { const won = (D().deals || []).filter((x) => x.source === a.source).length; const conv = a.leads ? Math.round((won / a.leads) * 100) : 0; return '<button class="src-row" data-analytics="src:' + a.source + '"><span class="sn">' + a.source + '</span><span class="sc">' + conv + '% · ' + won + '/' + a.leads + '</span><span class="scomm">' + WS.AED(a.commission) + '</span></button>'; }).join('');
    const loss = LOSS_REASONS.map((l) => '<div class="loss-row"><span>' + l.r + '</span><span class="badge">' + l.n + '</span></div>').join('');
    return '<div class="section-label" style="margin-top:24px">Аналитика · канонические метрики <span class="badge demo">' + I('lock') + 'демо</span></div>' +
      '<div class="mtiles">' +
      mtile('Конверсия заявка → сделка', m.conv + '%', m.won + ' из ' + m.leads + ' лидов', 'data-analytics="conv"') +
      mtile('Ожидаемая комиссия', WS.AED(m.expectedComm), 'из активного пайплайна', 'data-analytics="pipeline"') +
      mtile('Закрыто сделок', m.closedCount, m.closedSum ? WS.AED(m.closedSum) : '—', 'data-analytics="closed"') +
      '</div>' +
      '<div class="section-label" style="margin-top:14px">Качество источника</div><div class="src-list">' + srcRows + '</div>' +
      '<div class="section-label" style="margin-top:14px">Причины проигрыша</div><div class="loss-list">' + loss + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:8px">Одинаковый запрос → одинаковые числа. Клик по цифре — до записей. Комиссия платформы не показывается.</div>';
  }
  // Agent Пульс effectiveness strip — the three KPIs the principal asked to surface:
  // conversion request→deal, mean deal cycle, commission per lead.
  function agentKpis() {
    const m = computeMetrics();
    const A = D().attribution || [];
    const totalComm = A.reduce((s, x) => s + (x.commission || 0), 0);
    const commPerLead = m.leads ? Math.round(totalComm / m.leads) : 0;
    const cycle = (D().analytics || {}).avgCycleDays || 0;
    const mtile = (label, val, sub, act) => '<button class="mtile" ' + act + '><div class="ml">' + label + '</div><div class="mv">' + val + '</div><div class="ms">' + sub + '</div></button>';
    return '<div class="section-label" style="margin-top:24px">Эффективность · KPI <span class="badge demo">' + I('lock') + 'демо</span></div>' +
      '<div class="mtiles">' +
      mtile('Конверсия заявка → сделка', m.conv + '%', m.won + ' из ' + m.leads + ' лидов', 'data-analytics="conv"') +
      mtile('Средний цикл сделки', cycle + ' дн.', 'от заявки до закрытия', 'data-nav="analytics"') +
      mtile('Комиссия на лид', WS.AED(commPerLead), 'из ' + m.leads + ' лидов', 'data-analytics="pipeline"') +
      '</div>';
  }
  function openAnalyticsDrill(kind) {
    const deals = D().deals || [];
    let title = 'Записи', rows = '';
    if (kind === 'overdue') {
      const list = (D().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue');
      title = 'Просроченные задачи';
      rows = list.map((t) => { const c = D().clients.find((x) => x.id === t.clientId) || {}; return '<div class="feed-row" data-client="' + t.clientId + '" style="cursor:pointer"><div class="fi i-stop">' + I('warn') + '</div><div class="ft"><div class="t">' + t.title + '</div><div class="m">' + (c.name || '') + ' · ' + t.due + '</div></div>' + I('arrowRight') + '</div>'; }).join('');
    } else {
      let list = deals;
      if (kind === 'closed') { title = 'Закрытые сделки'; list = deals.filter((d) => d.stage === 'done'); }
      else if (kind === 'hot') { title = 'Горячие сделки · SLA < 2 ч'; list = deals.filter((d) => d.hot); }
      else if (kind === 'conv' || kind === 'pipeline') { title = 'Активные сделки'; list = deals.filter((d) => d.stage !== 'done'); }
      else if (kind.indexOf('src:') === 0) { const s = kind.slice(4); title = 'Сделки · источник «' + s + '»'; list = deals.filter((d) => d.source === s); }
      rows = list.map((d) => '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div><div class="ft"><div class="t">' + d.title + '</div><div class="m">' + stageLabel(d.stage) + ' · ' + WS.AED(d.amount) + (d.source ? ' · ' + d.source : '') + '</div></div>' + I('arrowRight') + '</div>').join('');
    }
    openModal(title, rows ? '<div class="card"><div class="feed" style="padding:2px 16px">' + rows + '</div></div>' : '<div class="card pad" style="color:var(--faint)">нет записей</div>', '<button class="btn" data-act="closeModal">Закрыть</button>');
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
  function viewStart() {
    const st = S();
    const a = D().analytics;
    const _active = (D().deals || []).filter((x) => x.stage !== 'done');
    const _dealsActive = _active.length;
    const _pipeline = Math.round(_active.reduce((s2, x) => s2 + (x.amount || 0), 0) / 1e5) / 10;
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
        mgrTiles() +
        canonMetrics() +
        '<div class="section-label" style="margin-top:28px">Команда и исключения</div>' + workQueueManager() +
      '</div>';
    }

    const qa = [
      { t: 'Разобрать голосовое', ic: 'mic', scn: 'G1' },
      { t: 'Подобрать объект', ic: 'building', scn: 'G2' },
      { t: 'Оценить доходность', ic: 'money', nav: 'calc' },
      { t: 'Итог показа', ic: 'voice2', scn: 'G3' },
      { t: 'Холодный лид', ic: 'flame', scn: 'S15' },
      { t: 'Брифинг дня', ic: 'sparkle', scn: 'S8' },
    ].map((q) => '<button class="chip" data-' + (q.scn ? 'scn="' + q.scn : 'nav="' + q.nav) + '">' + I(q.ic) + q.t + '</button>').join('');

    const spark = a.sparks.map((v, i) => '<i class="' + (i === a.sparks.length - 1 ? 'on' : '') + '" style="height:' + (30 + v * 4) + '%"></i>').join('');

    const _overdue = (D().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue').length;
    const tiles = '' +
      tile('flame', 'Горячие клиенты', a.hotClients, '', 'span 4', 'Ждут вашего шага сегодня', '', 'accent', 'data-nav="clients"') +
      tile('warn', 'Просроченные задачи', _overdue, '', 'span 4', 'Пора связаться с клиентом', '', '', 'data-analytics="overdue"') +
      tile('briefcase', 'Сделки в работе', _dealsActive, '', 'span 4', '+1 за сегодня', 'up', '', 'data-nav="clients"') +
      '<button class="tile wide" data-nav="clients"><div class="th">' + I('trend') + 'Воронка сделок</div>' +
        '<div class="val">' + _pipeline.toLocaleString('ru-RU') + '<span class="u">млн AED</span></div>' +
        '<div class="spark">' + spark + '</div>' +
        '<div class="sub">Тренд новых сделок · 7 дней <span class="trend up">' + I('trend') + '</span></div></button>' +
      '<button class="tile wide" data-nav="clients"><div class="th">' + I('target') + 'Отработка лидов</div>' +
        '<div class="val">' + Math.round(a.coverage * 100) + '<span class="u">%</span></div>' +
        '<div class="meter"><i style="width:' + (a.coverage * 100) + '%"></i></div>' +
        '<div class="sub">Связались за неделю: ' + a.weekTouches.done + ' из ' + a.weekTouches.total + ' лидов</div></button>';

    // merged work queue (was a separate "Радар" tab) — role-aware
    const eyebrow = isMgr
      ? 'Обзор команды · штат AI-агентов на смене'
      : 'Консьерж на связи · штат AI-агентов готов';
    const headline = greet + ', ' + firstName + '. ' + ((a.hotClients + a.kpPending) > 0
      ? 'С чего начнём?'
      : 'Срочных дел нет — хороший момент заняться базой.');

    let queueBlock;
    if (isMgr) {
      queueBlock = '<div style="margin-top:28px" class="section-label">' + h('Команда и исключения') + '</div>' + workQueueManager();
    } else {
      queueBlock = pulseMyDay();
    }

    // Пульс (rev.3): первая строка — ввод Консьержа, затем приветствие, событие дня, очередь, аналитика.
    const eventsPlayed = (S().eventsPlayed || []).length;
    const dayHint = '<button class="day-hint" data-act="presenter">' +
      '<div class="dh-ic">' + I('play') + '</div>' +
      '<div class="dh-t"><div class="t">Сюжет дня — что система делает <b>сама, без вас</b></div>' +
      '<div class="m">' + (eventsPlayed ? 'Сыграно событий: ' + eventsPlayed + ' из 5 · продолжить' : 'Ночной лид · входящий звонок · ответ на КП · проверка · развилка') + '</div></div>' +
      I('arrowRight') + '</button>';

    return '<div class="start fadeup">' +
      heroViz('pulse', 'Пульс', headline, { descBig: true }) +
      cgComposer('startPrompt', 'Поручите Консьержу — «подобрать Анне 3 объекта до 2 млн», «подготовить к встрече», «что просрочено»…', 'startSend', 'prompt-lead') +
      '<div class="qa-row" style="margin-top:16px"><button class="chip" data-chain="golden" style="border-color:var(--acc);background:var(--acc);color:#fff">' + I('play') + 'Золотой тур · 10 мин</button>' + qa + '</div>' +
      '<div class="tiles" style="margin-top:20px">' + tiles + '</div>' +
      (isMgr ? '' : agentKpis()) +
      insightsBlock() + (isMgr ? canonMetrics() : '') +
      dayHint +
      queueBlock +
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
      { deal: 'd_anna', kind: 'Escrow receipt', due: 'через 4 дня', warn: true, sub: 'Анна Петрова · Creekline 1208' },
      { deal: 'd_viktor', kind: 'Oqood · регистрация DLD', due: 'через 9 дней', warn: false, sub: 'Виктор Орлов · Bayline 1603' },
      { deal: 'd_rentbiz', kind: 'Title deed', due: 'через 21 день', warn: false, sub: 'Портфель · DIFC Gate' },
    ];
    const rows = items.map((it) => '<div class="feed-row" data-deal="' + it.deal + '" style="cursor:pointer"><div class="fi ' + (it.warn ? 'i-acc' : 'i-info') + '">' + I('doc') + '</div>' +
      '<div class="ft"><div class="t">' + it.kind + '</div><div class="m">' + it.sub + '</div></div>' +
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
  const CG_DEPTH = [
    { k: 'fast', t: 'Быстро', hint: 'Мгновенный ответ без рассуждений' },
    { k: 'think', t: 'Размышление', hint: 'Взвешенный разбор в несколько шагов' },
    { k: 'deep', t: 'Глубоко', hint: 'Многоисточниковое исследование' },
  ];
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
            '<button class="voice" data-act="voice" title="Голосом">' + I('mic') + '</button>' +
            '<button class="send" data-act="' + sendAct + '">' + I('arrowUp') + '</button>' +
          '</div>' +
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
    const row = (m) => '<button class="cg-item mode-row' + (cur === m.k ? ' on' : '') + '" data-cgmode="' + m.k + '">' + I(m.ic) + '<span class="cg-item-tx"><b>' + m.t + '</b><i>' + m.d + '</i></span>' + (cur === m.k ? '<span class="ck">' + I('check') + '</span>' : '') + '</button>';
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
  function conciergeRail(activeTid) {
    const threads = WS.engine.threadList().slice().sort((a, b) => (b.unread || 0) - (a.unread || 0));
    const rows = threads.map((t) => {
      const on = t.id === activeTid ? ' is-active' : '';
      const time = t.updatedAt ? '<span class="th-time">' + t.updatedAt + '</span>' : '';
      const unread = t.unread ? '<span class="th-unread">' + t.unread + '</span>' : '';
      const preview = (t.preview || (t.items.length + ' сообщений')) + (t.preview ? '…' : '');
      return '<button class="cg-rail-row' + on + (t.unread ? ' is-unread' : '') + '" data-thread="' + t.id + '" data-tlabel="' + t.label + '" data-ticon="' + t.icon + '">' +
        '<span class="fi i-acc">' + I(t.icon) + '</span>' +
        '<span class="ft"><span class="t">' + t.label + time + '</span><span class="m">' + preview + '</span></span>' + unread + '</button>';
    }).join('') || '<div class="cg-rail-empty">' + I('chat') + '<div>Пока нет диалогов.<br>Начните справа — тред создастся по сделке, объекту или лиду.</div></div>';
    return '<div class="cg-rail-head"><span class="section-label" style="margin:0">Диалоги · ' + threads.length + '</span>' +
      '<div class="cg-rail-head-btns"><button class="btn sm" data-act="newThread">' + I('plus') + 'Новый</button>' +
      '<button class="cg-rail-collapse" data-act="cgRailToggle" title="Свернуть диалоги">' + I('chevLeft') + '</button></div></div>' +
      '<div class="cg-rail-list">' + rows + '</div>';
  }
  function conciergeHomeMain(st) {
    return '<div class="cg-main-inner">' +
      heroViz('concierge', 'Консьерж', 'Опишите задачу — начнётся новый диалог. Голосом или текстом; вся история — слева.') +
      cgComposer('cgPrompt', 'Опишите задачу или задайте вопрос — начнётся новый диалог…', 'cgSend', 'cg-hero') +
      '<div class="qa-row" style="margin-top:14px"><button class="chip" data-scn="G1">' + I('mic') + 'Разобрать голосовое</button>' +
      '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать объект</button>' +
      '<button class="chip" data-scn="S15">' + I('flame') + 'Холодный лид</button>' +
      '<button class="chip" data-chain="golden">' + I('play') + 'Золотой тур</button></div>' +
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
    const dealOpts = D().deals.map((d) => { const c = D().clients.find((x) => x.id === d.clientId) || {}; return '<button class="btn" data-newthread="deal:' + d.id + '" data-tlabel="' + (c.name || d.title) + ' · сделка" data-ticon="users" style="justify-content:flex-start;width:100%;margin-bottom:6px">' + I('users') + (c.name || d.title) + ' · ' + stageLabel(d.stage) + '</button>'; }).join('');
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
      '<div style="margin-top:6px">Поручите задачу по этой сущности голосом или текстом — или запустите сценарий.</div>' +
      '<div class="qa-row" style="justify-content:center;margin-top:16px">' +
      '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать объект</button>' +
      '<button class="chip" data-scn="S8">' + I('sparkle') + 'Бриф к звонку</button></div></div>';
  }

  // ---------------- CLIENTS & DEALS ----------------
  function viewClients() {
    const st = S();
    const tab = st.clientsTab || 'deals';
    const isMgr = st.role === 'manager';
    const title = tab === 'contacts' ? 'Клиенты' : 'Сделки';
    const desc = tab === 'contacts'
      ? 'Клиентская книга: покупатели, арендаторы и инвесторы. Портфель клиента и все его сделки, KYC и согласие. Партнёры, застройщики и посредники живут в разделе «Сеть».'
      : 'Воронка сделок по стадиям — канбан или таблица; переключатель воронок сверху. Клик по сделке открывает карточку с контактом, объектом и действиями.';
    const actions = tab === 'contacts'
      ? '<button class="btn sm" data-act="importContacts">' + I('download') + 'Импорт</button>' +
        '<button class="btn sm primary" data-act="newContact">' + I('plus') + 'Создать клиента</button>'
      : '<button class="btn sm" data-scn="G1">' + I('mic') + 'Заявка голосом</button>' +
        '<button class="btn sm primary" data-act="newDeal">' + I('plus') + 'Создать сделку</button>';
    let body;
    if (tab === 'contacts') body = contactsPeople();
    else {
      const dview = st.dealsView || (isMgr ? 'table' : 'kanban');
      const vtoggle = '<div class="seg">' +
        '<button class="' + (dview === 'kanban' ? 'on' : '') + '" data-act="dealsView" data-v="kanban">' + I('grid') + 'Канбан</button>' +
        '<button class="' + (dview === 'table' ? 'on' : '') + '" data-act="dealsView" data-v="table">' + I('menu') + 'Таблица</button></div>';
      const funnelSwitch = dview === 'kanban' ? funnelSwitcher() : '';
      body = (isMgr ? dealsFunnel() : '') + '<div class="deals-toolbar">' + vtoggle + funnelSwitch + '</div>' + dealFilterBar() + (dview === 'table' ? dealsTable(isMgr) : kanbanDeals(isMgr));
    }
    return head(title, desc, actions) + body;
  }
  // Контакты = a people registry with TYPES. "Клиент" is one type; a contact may be a
  // partner, an intermediary, or a company contact. Resolves the deals/clients/contacts dilemma.
  const CONTACT_TYPES = [
    { k: 'all', t: 'Все' }, { k: 'client', t: 'Клиенты' }, { k: 'partner', t: 'Партнёры' },
    { k: 'intermediary', t: 'Посредники' }, { k: 'transferred', t: 'Замещение' },
  ];
  function contactsPeople() {
    const cur = S().contactType || 'all';
    const cl = D().clients || [];
    let clients = cl.map((c, i) => ({ id: c.id, name: c.name, role: c.goal, budget: c.budget, c: c, transferred: i >= cl.length - 2 }));
    if (cur === 'transferred') clients = clients.filter((p) => p.transferred);
    const FILTERS = [{ k: 'all', t: 'Все клиенты' }, { k: 'transferred', t: 'Замещение' }];
    const rows = clients.map((p) => {
      const k = kycOf(p.c);
      const deal = (D().deals || []).find((d) => d.clientId === p.id);
      const dealBtn = deal ? '<button class="btn sm ghost" data-deal="' + deal.id + '">' + I('briefcase') + 'Сделка</button>' : '';
      const right = (p.transferred ? '<span class="badge warn">' + I('users') + 'Передан вам</span>' : '') +
        '<span class="badge ' + k.st + '">' + I('shield') + k.label + '</span>' +
        (p.c.consent ? '<span class="badge ok">' + I('check') + 'согласие</span>' : '<span class="badge stop">' + I('lock') + 'нет согласия</span>') + dealBtn;
      return '<div class="feed-row" data-client="' + p.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('users') + '</div>' +
        '<div class="ft"><div class="t">' + priorityChip(p.id) + p.name + '</div>' +
        '<div class="m">' + (p.role || '') + (p.budget ? ' · ' + WS.AED(p.budget) : '') + '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' + right + '</div></div>';
    }).join('');
    const filter = FILTERS.map((ct) => '<button class="chip' + (cur === ct.k ? '' : ' mut') + '" data-contacttype="' + ct.k + '"' +
      (cur === ct.k ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + ct.t + '</button>').join('');
    const note = cur === 'transferred'
      ? '<div class="ws-flag" style="margin:0 0 12px">' + I('users') + ' Клиенты, переданные вам от коллеги на время его отсутствия. Режим замещения включается в Настройках.</div>' : '';
    return '<div class="qa-row" style="margin-bottom:14px">' + filter + '</div>' + note +
      '<div class="card"><div class="section-label" style="padding:12px 16px 4px">' + (cur === 'transferred' ? 'Замещение' : 'Клиенты') + ' · ' + clients.length + '</div>' +
      '<div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>';
  }
  // R7: saved deterministic views — same query → same list. Applied on top of the funnel filter.
  const SAVED_VIEWS = [
    { k: 'nocontact', label: 'Без движения сегодня', pred: (d) => d.stageDays >= 1 && d.stage !== 'done' },
    { k: 'nonext', label: 'Без плана действий', pred: (d) => !d.hot && d.stage === 'new' },
    { k: 'commissions', label: 'Ожидаемые комиссии', pred: (d) => ['sale_offplan', 'sale_ready', 'rental_biz'].indexOf(d.funnel) >= 0 && d.stage !== 'done' },
    { k: 'nodocs', label: 'Без документов', pred: (d) => d.stage === 'new' || d.stage === 'work' },
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
  function funnelSwitcher() {
    const fk = S().dealFunnel || 'sale_offplan';
    const btns = (WS.FUNNELS || []).map((f) => {
      const n = D().deals.filter((d) => (d.funnel || 'sale_offplan') === f.k).length;
      return '<button class="fn-pill' + (f.k === fk ? ' on' : '') + '" data-funnel="' + f.k + '">' + f.label + '<span class="fn-n">' + n + '</span></button>';
    }).join('');
    return '<div class="funnel-switch">' + btns + '</div>';
  }
  // Deal filters (budget / source) — combined with the funnel + saved-view predicate on the board.
  function dealExtraPred(d) {
    const from = parseInt(S().dealBudFrom, 10) || 0, to = parseInt(S().dealBudTo, 10) || 0, src = S().dealSrc || 'all';
    if (src !== 'all' && d.source !== src) return false;
    const a = d.amount || 0;
    if (from && a < from) return false;
    if (to && a > to) return false;
    return true;
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
    const srcChips = chip(src === 'all', 'data-dealsrc="all"', 'Все источники') +
      srcs.map((s) => chip(src === s, 'data-dealsrc="' + s + '"', s)).join('');
    return '<div class="qa-row deal-filters">' + budget + '<span class="df-sep"></span>' + srcChips + '</div>';
  }
  function agentName(id) { const u = D().users; for (const k in u) { if (u[k].id === id) return u[k].name; } const m = TEAM.find((x) => x.id === id); return m ? m.name : (id || '—'); }
  function dealObject(d) { return d.objectId ? D().objects.find((o) => o.id === d.objectId) : null; }
  function dealPhoto(d) { const o = dealObject(d); const src = WS.photos && ((o && WS.photos[o.id]) || WS.photos.o_creekline); return src; }
  function dealHot(d) {
    if (d.hot) return true;
    if ((d.tags || []).some((t) => /просроч|ждёт|горит/i.test(t))) return true;
    return D().tasks.some((t) => t.clientId === d.clientId && t.status !== 'done' && (t.when === 'overdue' || t.when === 'today'));
  }
  // Consolidated funnel for the manager — deals of subordinate agents by stage (item 9).
  function dealsFunnel() {
    const ds = D().deals;
    const byStage = STAGES.map((s) => ({ s: s, list: ds.filter((d) => d.stage === s.k) }));
    const totalVal = ds.reduce((a, d) => a + (d.amount || 0), 0);
    const cells = byStage.map(({ s, list }) => {
      const val = list.reduce((a, d) => a + (d.amount || 0), 0);
      return '<div class="fn-cell"><div class="fn-n">' + list.length + '</div><div class="fn-l">' + s.label + '</div><div class="fn-v">' + (val ? WS.AED(val) : '—') + '</div></div>';
    }).join('');
    const byAgent = {};
    ds.forEach((d) => { const a = d.agent || 'u_none'; (byAgent[a] = byAgent[a] || []).push(d); });
    const agentRows = Object.keys(byAgent).map((a) => {
      const list = byAgent[a]; const val = list.reduce((x, d) => x + (d.amount || 0), 0); const hot = list.filter(dealHot).length;
      return '<div class="wl"><div class="who">' + agentName(a) + '</div><div class="bar"><i style="width:' + Math.min(100, list.length * 25) + '%"></i></div>' +
        '<div class="n">' + list.length + ' сдел. · ' + WS.AED(val) + (hot ? ' · <span style="color:var(--stop)">' + hot + ' ' + I('flame') + '</span>' : '') + '</div></div>';
    }).join('');
    return '<div class="card pad" style="margin-bottom:16px"><div class="section-label">Сводная воронка команды</div>' +
      '<div class="funnel">' + cells + '</div>' +
      '<div class="prov" style="margin:10px 0 4px"><span class="badge acc">' + I('money') + 'Пайплайн: ' + WS.AED(totalVal) + '</span><span class="badge">' + I('briefcase') + ds.length + ' сделок</span><span class="badge">' + I('users') + Object.keys(byAgent).length + ' агента</span></div>' +
      '<div class="section-label" style="margin-top:10px">По агентам</div><div class="workload">' + agentRows + '</div></div>';
  }
  const STAGES = [{ k: 'new', label: 'Новая заявка' }, { k: 'work', label: 'В работе' }, { k: 'docs', label: 'Документы' }, { k: 'done', label: 'Закрыта' }];
  function stageLabel(k) { const s = STAGES.find((x) => x.k === k); return s ? s.label : k; }
  function dealFireBadge() { return '<span class="deal-fire" title="Требует действия">' + I('flame') + '</span>'; }
  function kanbanDeals(isMgr) {
    // R2: board is scoped to the selected funnel; the 4 stage-columns are relabeled as
    // that funnel's milestone projection. Manual move (◀▶) still writes a stage event.
    const fk = S().dealFunnel || 'sale_offplan';
    const funnel = (WS.FUNNELS || []).find((x) => x.k === fk) || (WS.FUNNELS || [])[0];
    const pred = activeViewPred();
    const cols = STAGES.map((sg, si) => {
      const colLabel = (funnel && funnel.cols[si]) || sg.label;
      const ds = D().deals.filter((d) => d.stage === sg.k && (d.funnel || 'sale_offplan') === fk && (!pred || pred(d)) && dealExtraPred(d));
      const cards = ds.map((d) => {
        const c = D().clients.find((x) => x.id === d.clientId) || {};
        const o = dealObject(d);
        const tags = (d.tags || []).map((t) => '<span class="badge">' + t + '</span>').join('');
        const consent = c.consent === false ? '<span class="badge stop">' + I('lock') + 'нет согласия</span>' : '';
        const agent = isMgr ? '<span class="badge info">' + I('users') + agentName(d.agent) + '</span>' : '';
        const canPrev = si > 0, canNext = si < STAGES.length - 1;
        const move = '<div class="dmove">' +
          '<button class="kmv" data-dealmove="' + d.id + '" data-dir="prev" title="Назад по стадии"' + (canPrev ? '' : ' disabled') + '>' + I('chevLeft') + '</button>' +
          '<button class="kmv" data-dealmove="' + d.id + '" data-dir="next" title="Вперёд по стадии"' + (canNext ? '' : ' disabled') + '>' + I('chevRight') + '</button></div>';
        return '<div class="deal' + (dealHot(d) ? ' hot' : '') + '" data-deal="' + d.id + '">' +
          '<div class="deal-thumb" style="background-image:url(' + dealPhoto(d) + ')">' + (dealHot(d) ? dealFireBadge() : '') + '</div>' +
          '<div class="deal-body"><div class="dt">' + (c.name || d.title) + '</div>' +
          '<div class="dm">' + (o ? o.name.split(',')[0] : d.sub) + ' · ' + WS.AED(d.amount || 0) + '</div>' +
          '<div class="dfoot"><div class="dtag">' + tags + consent + agent + '</div>' + move + '</div></div></div>';
      }).join('') || '<div style="font-size:12px;color:var(--faint);padding:8px 6px">пусто</div>';
      return '<div class="kcol"><div class="kh"><span>' + colLabel + '</span><span class="c">' + ds.length + '</span></div>' + cards + '</div>';
    }).join('');
    return '<div class="kanban">' + cols + '</div>';
  }
  // Table view of deals (item 3): sortable-feeling list with object photo + client + amount (+agent for manager)
  function dealsTable(isMgr) {
    const pred = activeViewPred();
    const rows = D().deals.filter((d) => (!pred || pred(d)) && dealExtraPred(d)).map((d) => {
      const c = D().clients.find((x) => x.id === d.clientId) || {}; const o = dealObject(d);
      return '<tr data-deal="' + d.id + '" style="cursor:pointer">' +
        '<td><div class="td-obj"><div class="td-thumb" style="background-image:url(' + dealPhoto(d) + ')"></div>' +
        '<div><div class="td-name">' + (c.name || d.title) + (dealHot(d) ? ' ' + dealFireBadge() : '') + '</div>' +
        '<div class="td-sub">' + (o ? o.name.split(',')[0] : d.sub) + '</div></div></div></td>' +
        '<td><span class="badge acc">' + stageLabel(d.stage) + '</span></td>' +
        '<td class="td-amt">' + WS.AED(d.amount || 0) + '</td>' +
        (isMgr ? '<td>' + agentName(d.agent) + '</td>' : '') +
        '<td class="td-mut">' + (d.updated || '') + '</td></tr>';
    }).join('');
    if (!rows) return '<div class="empty" style="padding:40px 20px">' + I('briefcase') +
      '<div style="font-weight:700;color:var(--ink);margin-bottom:2px">Под этот вид сделок нет</div>' +
      '<div>Сбросьте сохранённый вид или фильтр источника выше.</div></div>';
    return '<div class="card" style="overflow-x:auto"><table class="deals-table"><thead><tr><th>Клиент · объект</th><th>Стадия</th><th>Сумма</th>' +
      (isMgr ? '<th>Агент</th>' : '') + '<th>Обновлено</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function moveDealDir(id, dir) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const i = STAGES.findIndex((s) => s.k === d.stage);
    const ni = dir === 'next' ? i + 1 : i - 1;
    if (ni < 0 || ni >= STAGES.length) return;
    WS.storeApi.setDealStage(id, STAGES[ni].k);
    WS.storeApi.toast('Сделка «' + d.title + '» → ' + STAGES[ni].label, 'ok');
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
      return '<div class="feed-row' + (c._new ? ' is-new' : '') + '" data-client="' + c.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('users') + '</div>' +
        '<div class="ft"><div class="t">' + priorityChip(c.id) + c.name + '</div><div class="m">' + c.goal + ' · ' + (c.budget ? WS.AED(c.budget) : '—') + '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center">' + isNew + '<span class="badge ' + k.st + '">' + I('shield') + k.label + '</span>' + consent + I('arrowRight') + '</div></div>';
    }).join('');
    return '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Контакты · ' + D().clients.length + '</div><div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>' + companiesBlock();
  }
  // R5: Company entity (agency/developer/corp/fund) with KYC STATUS (not a rating).
  function companiesBlock() {
    const cos = D().companies || [];
    const rows = cos.map((co) => {
      const linked = (D().deals || []).filter((d) => d.companyId === co.id).length;
      const kyc = co.kyc === 'verified' ? '<span class="badge ok">' + I('check') + 'KYC пройден</span>' : '<span class="badge warn">' + I('clock') + 'KYC на проверке</span>';
      return '<div class="feed-row" data-company="' + co.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('building') + '</div>' +
        '<div class="ft"><div class="t">' + co.name + '</div><div class="m">' + co.kind + ' · сделок: ' + linked + '</div></div>' + kyc + I('arrowRight') + '</div>';
    }).join('');
    return '<div class="card" style="margin-top:14px"><div class="section-label" style="padding:12px 16px 4px">Компании · ' + cos.length + '</div><div class="feed" style="padding:0 16px 8px">' + rows + '</div></div>';
  }
  // ---- Company card v2: same universal shell (static type → status chip, dx-sec tabs) ----
  function companyTabContent(co, tab) {
    const deals = (D().deals || []).filter((d) => d.companyId === co.id);
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
    const key = dxSec('building', 'Ключевое', '', '<div class="dfields">' +
      dfPair('Тип', co.kind) + dfPair('Условия комиссии', co.commission) + dfPair('Сделок', String(deals.length)) + '</div>' +
      (co.note ? '<div style="margin-top:8px;font-size:12px;color:var(--mut)">' + co.note + '</div>' : ''));
    const contact = dxSec('users', 'Контактное лицо', '', '<div class="dfields">' +
      dfPair(co.contactPerson || 'Контакт', co.contactRole || '—') + dfPair('Телефон', co.phone) +
      dfPair('Email', co.email) + dfPair('Адрес', co.address) + '</div>');
    return '<div class="dx-grid2">' + key + contact + '</div>' +
      '<div style="margin-top:14px">' + companyFeedBlock(co, 5) + '</div>';
  }
  function companyCard(id) {
    const co = (D().companies || []).find((x) => x.id === id); if (!co) return;
    const kyc = co.kyc === 'verified' ? { icon: 'check', label: 'KYC пройден', tone: 'ok' } : { icon: 'clock', label: 'KYC на проверке', tone: 'warn' };
    const chips = [{ icon: 'building', label: co.kind, tone: 'acc' }, kyc];
    if (co.escrow) chips.push({ icon: 'shield', label: 'Эскроу DLD', tone: 'ok' });
    chips.push({ icon: 'lock', label: 'статус, не рейтинг', tone: 'demo' });
    const dealsCount = (D().deals || []).filter((d) => d.companyId === id).length;
    entityCard({
      type: 'company', id: id, title: co.name, status: statusChip(chips),
      tabs: [['overview', 'Обзор'], ['details', 'Реквизиты'], ['deals', 'Сделки · ' + dealsCount], ['history', 'История']],
      render: function (tab) { return companyTabContent(co, tab); },
      concierge: entityConcierge('Спросите Консьержа по компании — «история сделок», «условия комиссии», «собери досье»…', 'company:' + co.id, co.name + ' · компания', 'building'),
      footer: '<button class="btn" data-act="closeModal">Закрыть</button>' +
        '<button class="btn primary" data-thread="company:' + co.id + '" data-tlabel="' + co.name + ' · компания" data-ticon="building">' + I('chat') + 'Чат по компании</button>',
    });
  }

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
      return '<div class="section-label" style="margin-top:16px">Персонализация коммуникации</div>' +
        '<div class="psych-empty">' + I('sparkle') +
        '<div><div style="font-weight:700;color:var(--ink)">Профиль не заполнен</div>' +
        '<div style="font-size:12px;color:var(--mut);margin-top:2px">Параметры стиля общения помогут вести персонализированную коммуникацию в мессенджерах и соцсетях (за согласием клиента).</div></div>' +
        '<button class="btn sm primary" data-act="psychForm" data-cid="' + c.id + '">' + I('plus') + 'Заполнить профиль</button></div>';
    }
    const chip = (ic, t) => t ? '<span class="badge">' + I(ic) + t + '</span>' : '';
    const vals = (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('');
    const tips = commTips(p).map((t) => '<div class="chg-row">' + I('check') + '<span>' + t + '</span></div>').join('');
    return '<div class="section-label" style="margin-top:16px">Психологический профиль · персонализация</div>' +
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
    return c.channel === 'email' ? 'email' : c.channel === 'telegram' ? 'telegram' : c.channel === 'phone' ? 'phone' : 'whatsapp';
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
  // Contact info surfaced explicitly at the top of the client overview — proper vCard, all channels.
  function contactBlock(c) {
    const dealForC = D().deals.find((x) => x.clientId === c.id);
    const dealTid = dealForC ? 'deal:' + dealForC.id : 'general';
    const pref = prefChannel(c);
    const prefLabel = chanMeta(pref)[1];
    const consent = c.consent
      ? '<span class="badge ok">' + I('check') + 'согласие (PDPL)</span>'
      : '<span class="badge stop">' + I('lock') + 'нет согласия</span>';
    const inner = contactVCard(clientContactVals(c), pref) +
      '<div class="cd-foot"><div class="prov"><span class="badge">' + I('flame') + c.lang + '</span>' + consent + '</div>' +
      '<button class="btn sm primary" data-thread="' + dealTid + '" data-tlabel="' + c.name + ' · сделка" data-ticon="users">' + I('chat') + 'Написать · ' + prefLabel + '</button></div>';
    return dxSec('phone', 'Контактные данные', '', inner);
  }
  // Психологический профиль — сводка на основной вкладке (полная версия — во вкладке «Персонализация»).
  function psychSummary(c) {
    const p = c.psych;
    if (!p || !p.filled) {
      return dxSec('sparkle', 'Психологический профиль', '<button class="btn xs" data-act="psychForm" data-cid="' + c.id + '">' + I('plus') + 'Заполнить</button>',
        '<div style="font-size:12.5px;color:var(--mut)">Профиль стиля общения не заполнен — поможет вести персонализированную коммуникацию в мессенджерах и соцсетях.</div>');
    }
    const chips = [p.decision, p.pace, p.risk].filter(Boolean).map((x) => '<span class="badge">' + x + '</span>').join('');
    const vals = (p.values || []).map((v) => '<span class="badge acc">' + I('target') + v + '</span>').join('');
    return dxSec('sparkle', 'Психологический профиль', '<button class="btn xs" data-etab="contact~' + c.id + '~profile">' + I('arrowRight') + 'Подробнее</button>',
      '<div class="prov">' + chips + vals + '</div>' +
      '<div style="font-size:12.5px;color:var(--mut);margin-top:8px">Канал и тон: ' + ((p.channel || '—') + (p.tone ? ' · ' + p.tone : '')) + '</div>');
  }
  // Client-level preference profile: aggregate this client's requests' offered ↔ selected/rejected.
  function clientPrefProfile(c) {
    const all = [];
    (D().requests || []).filter((r) => r.clientId === c.id).forEach((r) => (r.offered || []).forEach((o) => all.push(o)));
    if (!all.length) return '';
    return reqPrefProfile({ offered: all });
  }
  function clientTabContent(c, tab) {
    if (tab === 'profile') {
      return dxSec('sparkle', 'Персонализация коммуникации', '', psychInner(c));
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
      return dxSec('briefcase', 'Сделки контакта · ' + ds.length, '', '<div class="feed">' + dealRows + '</div>') +
        '<div style="margin-top:14px">' + dxSec('doc', 'Документы по сделкам', '', docsRows(docsFor((x) => x.client === c.id), 'по этому контакту документов пока нет')) + '</div>';
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
    const key = dxSec('users', 'Ключевое', '', '<div class="dfields">' +
      dfPair('Цель', c.goal) + dfPair('Бюджет', c.budget ? WS.AED(c.budget) : '—') +
      dfPair('Районы', (c.areas || []).join(', ')) + dfPair('Срок покупки', c.horizon) +
      (c.preferred ? dfPair('Предпочитает', c.preferred) : '') + '</div>' +
      (c.note ? '<div style="margin-top:8px;font-size:12px;color:var(--mut)">' + c.note + '</div>' : ''));
    const sig = dxSec('target', 'Сигналы и приоритет', prio, signalsInner(c));
    const actions = dxSec('sparkle', 'Действия по сделке', '',
      '<div class="qa-row">' +
      '<button class="chip" data-act="newDeal" data-cid="' + c.id + '">' + I('briefcase') + 'Создать сделку</button>' +
      '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать объекты</button>' +
      '<button class="chip" data-nav="calc">' + I('money') + 'Расчёт и КП</button>' +
      '<button class="chip" data-scn="S3">' + I('calendar') + 'Назначить показ</button>' +
      '<button class="chip" data-scn="S6">' + I('handshake') + 'Подключить партнёра</button>' +
      '<button class="chip" data-scn="S8">' + I('sparkle') + 'Бриф к звонку</button>' +
      '</div><div style="font-size:11px;color:var(--faint);margin-top:6px">Те же действия можно поручить Консьержу голосом или текстом.</div>');
    const pref = clientPrefProfile(c);
    return contactBlock(c) + '<div class="dx-grid2" style="margin-top:14px">' + key + sig + '</div>' +
      '<div style="margin-top:14px">' + psychSummary(c) + '</div>' +
      (pref ? '<div style="margin-top:14px">' + pref + '</div>' : '') +
      '<div style="margin-top:14px">' + actions + '</div>' +
      '<div style="margin-top:14px">' + contactFeedBlock(c, 5) + '</div>';
  }
  function clientSpec(id) {
    const c = D().clients.find((x) => x.id === id); if (!c) return null;
    const dealForC = D().deals.find((x) => x.clientId === id);
    const dealTid = dealForC ? 'deal:' + dealForC.id : 'general';
    const k = kycOf(c);
    const dealsCount = D().deals.filter((x) => x.clientId === id).length;
    const cm = chanMeta(prefChannel(c));
    const status = statusChip([
      { icon: 'shield', label: k.label, tone: k.st },
      { icon: c.consent ? 'check' : 'lock', label: c.consent ? 'Согласие есть' : 'Нет согласия', tone: c.consent ? 'ok' : 'stop' },
      { icon: cm[0], label: cm[1] },
      { icon: 'flame', label: c.lang },
    ]);
    return {
      type: 'contact', id: id, title: c.name, status: clientHero(c) + status,
      tabs: [['overview', 'Обзор'], ['profile', 'Персонализация'], ['kyc', 'KYC · документы'], ['deals', 'Сделки · ' + dealsCount], ['history', 'История']],
      render: function (tab) { return clientTabContent(c, tab); },
      concierge: entityConcierge('Спросите Консьержа по контакту — «подбери объекты», «бриф к звонку», «что важно клиенту»…', dealTid, c.name + ' · сделка', 'users'),
      pageActs: '<button class="btn sm primary" data-act="newDeal" data-cid="' + id + '">' + I('briefcase') + 'Создать сделку</button>' +
        '<button class="btn sm" data-scn="G2">' + I('building') + 'Подобрать объекты</button>',
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
  function dealField(label, val, provSt, confirmId) {
    const confirm = provSt === 'ai' && confirmId ? '<button class="mini-confirm" data-dfconfirm="' + confirmId + '" title="Подтвердить значение">' + I('check') + '</button>' : '';
    return '<div class="dfield"><div class="dk">' + label + '</div><div class="dv">' + (val || '—') + ' ' + provBadge(provSt) + confirm + '</div></div>';
  }
  function dealFieldsRows(d) {
    const co = (D().companies || []).find((x) => x.id === d.companyId);
    const p = d.prov || {};
    return dealField('Бюджет', d.amount ? WS.AED(d.amount) : '—', p.budget, d.id + ':budget') +
      dealField('Форма оплаты', d.paymentForm, p.paymentForm, d.id + ':paymentForm') +
      dealField('VAT 5%', d.vat ? 'применяется' : 'не применяется', p.vat) +
      dealField('Источник', d.source, p.source, d.id + ':source') +
      dealField('Тип сделки', d.dealType, p.dealType) +
      dealField('Тип объекта', d.objectType, p.objectType, d.id + ':objectType') +
      dealField('Цель', d.goal, p.goal, d.id + ':goal') +
      dealField('Компания', co ? co.name + ' · ' + co.kind : '—', 'confirmed') +
      dealField('Агент-партнёр', d.partnerAgent ? agentName(d.partnerAgent) : '—', 'confirmed') +
      dealField('Рассматриваемые проекты', (d.consideredProjects || []).join(', ') || '—', 'confirmed');
  }
  function dealFieldsBlock(d) {
    return '<div class="section-label" style="margin-top:16px">Параметры сделки' +
      '<button class="btn xs" data-act="editDeal" data-deal="' + d.id + '">' + I('pencil') + 'Изменить</button></div>' +
      '<div class="dfields">' + dealFieldsRows(d) + '</div>';
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
    const doIt = []; let why = '';
    if (d.stageDays >= 5) { doIt.push('Вернуться к сделке: позвонить, предложить следующий шаг'); why = 'застряла ' + d.stageDays + ' дн. в стадии'; }
    if (d.hot) { doIt.push('Ответить в течение 2 часов (SLA)'); why = why || 'горячий клиент'; }
    if (d.partnerAgent) doIt.push('Согласовать co-broking и сплит с партнёром');
    if (d.stage === 'new') doIt.push('Подобрать 3 объекта и назначить показ');
    if (!doIt.length) doIt.push('Двигать к следующей вехе воронки');
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
    const tags = (e.capture ? '<span class="cap-tag">' + I('mic') + 'запись</span>' : '') +
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
    const rows = feedSortDesc(tl.map((e, i) => ({ e: e, i: i })))
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
    (own[ent.id] || []).forEach((e, i) => out.push(Object.assign({}, e, { _ci: i })));
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
    return '<div class="timeline">' + rows + '</div>' + more;
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
  // ---- Deal contacts (P3): a deal can involve several people, each with a role + influence rating (A/B/C).
  const CONTACT_ROLES = ['Покупатель', 'Со-покупатель', 'Инвестор', 'ЛПР', 'Супруг — со-решение', 'Юрист сделки', 'Референт', 'Представитель'];
  const CONTACT_RATINGS = ['A', 'B', 'C'];
  function dealContacts(d) {
    if (Array.isArray(d.contacts) && d.contacts.length) return d.contacts;
    if (d.clientId) return [{ clientId: d.clientId, role: 'Покупатель', rating: 'A', primary: true }];
    return [];
  }
  function contactDisplayName(ct) {
    if (ct.clientId) { const c = D().clients.find((x) => x.id === ct.clientId); if (c) return c.name; }
    return ct.name || '—';
  }
  function ratingBadge(r) {
    const R = r || 'C';
    return '<span class="c-rate c-rate-' + R.toLowerCase() + '" title="Влияние на решение: ' + R + '">' + R + '</span>';
  }
  function dealContactsInner(d) {
    const list = dealContacts(d);
    const rows = list.map((ct, i) => {
      const c = ct.clientId ? D().clients.find((x) => x.id === ct.clientId) : null;
      const sub = [ct.role, (c && c.goal) || ct.phone].filter(Boolean).join(' · ');
      const star = ct.primary ? '<span class="c-star" title="Основной контакт">' + I('star') + '</span>' : '';
      const main = '<div class="dc-main"' + (ct.clientId ? ' data-client="' + ct.clientId + '" style="cursor:pointer"' : '') + '>' +
        '<div class="fi i-acc">' + I('users') + '</div>' +
        '<div class="ft"><div class="t">' + contactDisplayName(ct) + star + '</div><div class="m">' + (sub || '') + '</div></div></div>';
      const acts = '<div class="dc-acts">' + ratingBadge(ct.rating) +
        '<button class="tl-ic-btn" data-dcedit="' + d.id + ':' + i + '" title="Изменить роль/рейтинг">' + I('pencil') + '</button>' +
        (list.length > 1 ? '<button class="tl-ic-btn" data-dcdel="' + d.id + ':' + i + '" title="Убрать из сделки">' + I('x') + '</button>' : '') + '</div>';
      return '<div class="dc-row">' + main + acts + '</div>';
    }).join('');
    return '<div class="dc-list">' + rows + '</div>';
  }
  function openDealContactForm(dealId, index) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    const list = dealContacts(d);
    const isNew = index == null || index < 0;
    const ct = isNew ? { role: 'Со-покупатель', rating: 'B' } : (list[index] || {});
    const roleSel = '<select id="dc_role">' + CONTACT_ROLES.map((r) => '<option' + (r === ct.role ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>';
    const rateSel = '<select id="dc_rate">' + CONTACT_RATINGS.map((r) => '<option' + (r === (ct.rating || 'B') ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>';
    const nameField = ct.clientId
      ? '<label class="fld"><span>Контакт</span><input type="text" value="' + contactDisplayName(ct).replace(/"/g, '&quot;') + '" disabled></label>'
      : '<label class="fld"><span>Имя</span><input id="dc_name" type="text" value="' + ((ct.name || '').replace(/"/g, '&quot;')) + '" placeholder="Напр.: Пётр Петров"></label>';
    const phoneField = ct.clientId ? '' : '<label class="fld"><span>Телефон</span><input id="dc_phone" type="text" value="' + ((ct.phone || '').replace(/"/g, '&quot;')) + '" placeholder="+971 …"></label>';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Контакт участвует в сделке. Рейтинг A/B/C — влияние на решение.</p>' +
      '<div class="match-grid">' + nameField +
      '<label class="fld"><span>Роль в сделке</span>' + roleSel + '</label>' +
      '<label class="fld"><span>Рейтинг (влияние)</span>' + rateSel + '</label>' + phoneField + '</div>' +
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
    rec.role = g('dc_role') || rec.role || 'Со-покупатель';
    rec.rating = g('dc_rate') || rec.rating || 'B';
    if (!rec.clientId) { rec.name = g('dc_name') || rec.name || 'Без имени'; const ph = g('dc_phone'); if (ph) rec.phone = ph; }
    rec.primary = !!(document.getElementById('dc_primary') || {}).checked;
    if (isNew) d.contacts.push(rec);
    if (rec.primary) d.contacts.forEach((x) => { if (x !== rec) x.primary = false; });
    const prim = d.contacts.find((x) => x.primary) || d.contacts[0];
    if (prim && prim.clientId) d.clientId = prim.clientId; // keep the deal's primary client in sync
    WS.storeApi.toast(isNew ? 'Контакт добавлен к сделке' : 'Контакт обновлён', 'ok');
    dealCard(dealId);
  }
  function removeDealContact(dealId, index) {
    const d = D().deals.find((x) => x.id === dealId); if (!d) return;
    if (!Array.isArray(d.contacts)) d.contacts = dealContacts(d).slice();
    if (d.contacts.length <= 1) { WS.storeApi.toast('Нельзя убрать единственный контакт'); return; }
    const removed = d.contacts.splice(index, 1)[0];
    if (removed && removed.primary && d.contacts.length) d.contacts[0].primary = true;
    const prim = d.contacts.find((x) => x.primary) || d.contacts[0];
    if (prim && prim.clientId) d.clientId = prim.clientId;
    WS.storeApi.toast('Контакт убран из сделки');
    dealCard(dealId);
  }
  // Deal card = the DEAL (not the contact). Contacts are one click away.
  // ---- Deal card v2: tabbed shell + funnel-aware stage stepper + context Concierge ----
  function funnelSteps(d) {
    const f = (WS.FUNNELS || []).find((x) => x.k === d.funnel);
    const cols = (f && f.cols) || ['Новая заявка', 'В работе', 'Документы', 'Закрыта'];
    const order = ['new', 'work', 'docs', 'done'];
    const idx = Math.max(0, order.indexOf(d.stage));
    return { cols: cols, idx: idx, order: order, label: (f && f.label) || stageLabel(d.stage) };
  }
  function dealStepper(d) {
    const s = funnelSteps(d);
    const steps = s.cols.map((c, i) => {
      const cls = i < s.idx ? 'done' : (i === s.idx ? 'cur' : 'todo');
      const inner = i < s.idx ? I('check') : String(i + 1);
      return '<button class="dx-step ' + cls + '" data-dealstage="' + d.id + '" data-stage="' + s.order[i] + '"><span class="d">' + inner + '</span><span class="l">' + c + '</span></button>';
    }).join('');
    return '<div class="dx-stepper">' + steps + '</div>';
  }
  function dealConcierge(d) {
    return '<div class="dx-cbar-lbl">' + I('sparkle') + 'Консьерж знает контекст этой сделки</div>' +
      '<div class="dx-cbar" data-thread="deal:' + d.id + '" data-tlabel="' + d.title + '" data-ticon="briefcase">' +
      '<div class="w">W</div><div class="ph">Поручите Консьержу по сделке — «собрать КП», «что просрочено», «бриф к звонку»…</div>' +
      '<div class="send">' + I('arrowRight') + '</div></div>';
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
    return WS.store.cardTabs[type] || def;
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
    return (spec.status || '') + tabBar +
      '<div class="dx-tabbody" id="dxTabBody">' + spec.render(tab) + '</div>' +
      (spec.concierge ? '<div class="dx-concierge">' + spec.concierge + '</div>' : '');
  }
  function entityCard(spec) {
    openModal(spec.title, entityBody(spec), spec.footer, { wide: true, flexBody: true });
  }
  // Full-page entity view (deal / client) — mirrors viewObjectDetail: back header + actions, then the tabbed body.
  function entityPage(spec, backNav, backTab, backLabel) {
    const back = '<div class="obj-page-head"><button class="btn sm" data-nav="' + backNav + '" data-tab="' + backTab + '">' + I('chevLeft') + backLabel + '</button>' +
      (spec.pageActs ? '<div class="obj-page-acts">' + spec.pageActs + '</div>' : '') + '</div>';
    return back + entityBody(spec);
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
    if (tab === 'params') {
      const req = dealRequestBlock(d);
      return (req ? req + '<div style="height:14px"></div>' : '') +
        dxSec('briefcase', 'Параметры сделки', '<button class="btn xs" data-act="editDeal" data-deal="' + d.id + '">' + I('pencil') + 'Изменить</button>', '<div class="dfields">' + dealFieldsRows(d) + '</div>');
    }
    if (tab === 'contacts') {
      const addBtn = '<button class="btn xs" data-act="addDealContact" data-deal="' + d.id + '">' + I('plus') + 'Добавить</button>';
      const hint = '<div style="font-size:11px;color:var(--faint);margin-top:8px">Рейтинг A/B/C — влияние контакта на решение. Основной помечен звездой.</div>';
      return dxSec('users', 'Контакты сделки · ' + dealContacts(d).length, addBtn, dealContactsInner(d) + hint);
    }
    if (tab === 'docs') {
      return dxSec('doc', 'Документы сделки', '', docsRows(docsFor((x) => x.deal === d.id), 'по этой сделке документов пока нет'));
    }
    if (tab === 'history') {
      const addBtn = '<button class="btn xs" data-act="addEvent" data-scope="deal" data-deal="' + d.id + '">' + I('plus') + 'Событие</button>';
      return dxSec('clock', 'Лента событий', addBtn, dealTimelineInner(d));
    }
    if (tab === 'tasks') {
      const list = (D().tasks || []).filter((t) => t.clientId === d.clientId);
      const rows = list.map(taskRow).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">задач по этой сделке пока нет</div>';
      return dxSec('check', 'Задачи сделки · ' + list.length, '<button class="btn xs" data-act="newTask">' + I('plus') + 'Задача</button>', rows);
    }
    // overview — hero, stepper, status, key params, contacts and objects now live in the header;
    // overview carries the deeper detail: data conflicts and the partner-handoff package.
    const cf = conflictBlock(d);
    const ho = d.partnerAgent ? handoffBlock(d) : '';
    const body = (cf || '') + (ho ? (cf ? '<div style="margin-top:14px">' + ho + '</div>' : ho) : '');
    return body || '<div style="font-size:12.5px;color:var(--mut);padding:10px 2px;line-height:1.5">Ключевое, контакты, объекты и текущий статус — в шапке карточки выше. Здесь появляются расхождения в данных и пакет передачи партнёру, когда они есть.</div>';
  }
  // Hero sections reuse the object-hero family (variant B: photo backdrop + dark scrim) at the top of
  // entity cards — client (name overlaid), deal (linked object), КП (flagship object).
  function clientHero(c) {
    const bg = (WS.photos && WS.photos.o_interior) || '';
    const k = kycOf(c);
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const kycIcon = k.st === 'ok' ? 'check' : (k.st === 'stop' ? 'lock' : 'clock');
    const cm = chanMeta(prefChannel(c));
    const facts = [
      ['clock', c.horizon ? 'Срок: ' + c.horizon : 'Срок не задан'],
      ['money', c.budget ? WS.AED(c.budget) : '—'],
      [kycIcon, k.label],
      [cm[0], cm[1]],
    ];
    const factsHtml = '<div class="chero-facts">' + facts.map((f) => '<div class="chero-fact"><span class="chero-fact-icon">' + I(f[0]) + '</span><span>' + f[1] + '</span></div>').join('') + '</div>';
    return '<div class="chero">' + (bg ? '<img class="chero-img" src="' + bg + '" alt="">' : '') +
      '<div class="chero-scrim"></div>' +
      '<div class="chero-content"><div class="chero-avatar">' + init + '</div>' +
      '<div class="chero-info"><h1 class="chero-name">' + c.name + '</h1>' + factsHtml + '</div></div></div>';
  }
  // ---- Deal header v2: the DEAL reads first — a plain-language sentence, the client (callable),
  // and a "now" summary. The object is demoted to a compact card in the overview (dealLotsBlock).
  function dealActionWord(d) {
    return ({ sale_offplan: 'Покупка', sale_ready: 'Покупка', rent: 'Аренда',
      fitout: 'Fit-out', rental_biz: 'Доходный актив', referral: 'Передача партнёру' })[d.funnel] || 'Сделка';
  }
  // A deal may hold several lots under one contract (Part B). Falls back to the single object.
  function dealLots(d) {
    const ids = (Array.isArray(d.lots) && d.lots.length) ? d.lots : (d.objectId ? [d.objectId] : []);
    return ids.map((id) => D().objects.find((o) => o.id === id)).filter(Boolean);
  }
  function dealLotsLabel(d) {
    const lots = dealLots(d);
    if (!lots.length) return 'объект не выбран';
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
  // Client card (left of the facing pair) — call / write without hunting the contact card.
  function dealClientCard(d) {
    const c = D().clients.find((x) => x.id === d.clientId);
    if (!c) return dxSec('users', 'Клиент · связь', '', '<div style="font-size:12px;color:var(--faint);padding:4px 0">клиент не привязан к сделке</div>');
    const init = (c.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const vals = clientContactVals(c);
    const meta = [c.goal, c.budget ? 'бюджет ' + WS.AED(c.budget) : '', c.horizon ? 'срок ' + c.horizon : ''].filter(Boolean).join(' · ');
    const head = '<div class="dcli-head"><div class="dcli-av">' + init + '</div>' +
      '<div class="dcli-body"><div class="dcli-name" data-client="' + c.id + '" style="cursor:pointer">' + c.name + '</div>' +
      '<div class="dcli-meta">' + meta + '</div></div></div>';
    const chans = '<div class="dcli-chans">' + ['phone', 'whatsapp', 'telegram', 'email'].map((ch) =>
      '<span class="dcli-ch">' + I(chanMeta(ch)[0]) + '<span>' + (vals[ch] || '—') + '</span></span>').join('') + '</div>';
    const acts = '<div class="dcli-acts">' +
      '<button class="btn sm primary" data-act="callClient" data-cid="' + c.id + '">' + I('phone') + 'Позвонить</button>' +
      '<button class="btn sm" data-thread="deal:' + d.id + '" data-tlabel="' + escAttr(c.name) + ' · сделка" data-ticon="users">' + I('whatsapp') + 'Написать</button>' +
      '<button class="btn sm ghost" data-client="' + c.id + '">' + I('users') + 'Карточка</button></div>';
    return dxSec('users', 'Клиент · связь', '', head + chans + acts);
  }
  // "Что сейчас" — calm and structured (not a prose wall, not red-by-default): a laconic
  // status line, then the next step, then the last events. Red is reserved for a real problem
  // (missing consent) — never for "hot" or a few days in a stage.
  function dealNowBlock(d) {
    const s = funnelSteps(d);
    const a = nbaActions(d);
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    const chips = '<div class="dnb-chips">' +
      '<span class="chip on">' + I('trend') + s.cols[s.idx] + '</span>' +
      '<span class="chip">' + I('clock') + (d.stageDays || 0) + ' дн. в стадии</span>' +
      (d.hot ? '<span class="chip">' + I('sparkle') + 'горячий клиент</span>' : '') +
      (c.consent === false ? '<span class="chip stop">' + I('lock') + 'нет согласия</span>' : '') + '</div>';
    const next = '<div class="dnb-row"><div class="dnb-k">Следующий шаг</div>' +
      '<div class="dnb-v">' + a.doIt[0] + (a.why ? ' <span class="dnb-why">· ' + a.why + '</span>' : '') + '</div></div>';
    const tl = (D().dealTimeline || {})[d.id] || [];
    const evs = feedSortDesc(tl.map((e, i) => ({ e: e, i: i }))).slice(0, 3).map((p) =>
      '<div class="dnb-ev"><span class="dnb-ev-dot">' + I('dot') + '</span>' +
      '<div class="dnb-ev-b"><div class="dnb-ev-t">' + p.e.text + '</div>' +
      '<div class="dnb-ev-m">' + p.e.at + ' · ' + p.e.by + '</div></div></div>').join('') ||
      '<div class="dnb-ev-empty">событий пока нет</div>';
    const more = '<button class="btn xs" data-etab="deal~' + d.id + '~history">' + I('arrowRight') + 'вся история</button>';
    return '<div class="dnb"><div class="dnb-cap">' + I('pulse') + 'Что сейчас со сделкой</div>' +
      chips + next +
      '<div class="dnb-row"><div class="dnb-k">Последние события ' + more + '</div><div class="dnb-hist">' + evs + '</div></div></div>';
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
  function dealLotsBlock(d) {
    const lots = dealLots(d);
    const title = lots.length > 1 ? 'Объекты сделки · ' + lots.length + ' лота' : 'Объект сделки';
    return dxSec('building', title, '', lots.map(dealObjectMini).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">объект ещё не выбран</div>');
  }
  // Key params, lifted into the header (right of the facing pair).
  function dealKeyCard(d) {
    const p = d.prov || {};
    const o0 = dealLots(d)[0];
    const comm = o0 && o0.commissionPct ? o0.commissionPct + '% · ' + WS.AED(Math.round((d.amount || 0) * o0.commissionPct / 100)) : '—';
    const cobro = d.partnerAgent ? agentName(d.partnerAgent) + ' · co-broking' : 'нет';
    return dxSec('briefcase', 'Ключевое', '<button class="btn xs" data-act="editDeal" data-deal="' + d.id + '">' + I('pencil') + 'Изменить</button>', '<div class="dfields">' +
      dealField('Бюджет', d.amount ? WS.AED(d.amount) : '—', p.budget, d.id + ':budget') +
      dealField('Форма оплаты', d.paymentForm, p.paymentForm, d.id + ':paymentForm') +
      dealField('Цель', d.goal, p.goal, d.id + ':goal') +
      dealField('Тип сделки', d.dealType, p.dealType) +
      dealField('Комиссия', comm, 'confirmed') +
      dealField('Co-broking', cobro, 'confirmed') + '</div>');
  }
  // Essence status phrase — one short line high on the card, so "what's happening now" is
  // visible without scrolling. Doc-oriented, keyed off the deal stage.
  function dealStatusPhrase(d) {
    return ({
      new: 'квалифицируем клиента и готовим показ объектов.',
      work: 'отправили предложение — ждём решение клиента.',
      docs: 'готовим документы на подписание, ожидаем подписание клиентом.',
      done: 'сделка закрыта, комиссия зафиксирована.',
    })[d.stage] || ('стадия «' + funnelSteps(d).cols[funnelSteps(d).idx] + '».');
  }
  // Header order (client feedback v2): compact hero → narrow stepper → one-line essence status →
  // facing cards (LEFT key params · RIGHT client contacts + objects) → "что сейчас" detail.
  function dealHeader(d) {
    return dealHero(d) +
      '<div class="deal-stepper-compact">' + dealStepperSection(d) + '</div>' +
      '<div class="deal-phrase">' + I('pulse') + '<span><b>Сейчас:</b> ' + dealStatusPhrase(d) + '</span></div>' +
      '<div class="deal-top"><div class="deal-top-cell">' + dealKeyCard(d) + '</div>' +
      '<div class="deal-top-cell">' + dealClientCard(d) + dealLotsBlock(d) + '</div></div>' +
      dealNowBlock(d);
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
    const s = funnelSteps(d);
    const cap = 'Шаг ' + (s.idx + 1) + ' из ' + s.cols.length + ' · ' + s.cols[s.idx];
    return dxSec('trend', 'Этапы сделки', '<span class="dx-step-cap">' + cap + '</span>', dealStepper(d));
  }
  function dealSpec(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return null;
    const c = D().clients.find((x) => x.id === d.clientId) || {};
    return {
      type: 'deal', id: id, title: d.title,
      status: dealHeader(d),
      tabs: [['overview', 'Обзор'], ['params', 'Параметры'], ['contacts', 'Контакты · ' + dealContacts(d).length], ['tasks', 'Задачи · ' + (D().tasks || []).filter((t) => t.clientId === d.clientId).length], ['docs', 'Документы'], ['history', 'История']],
      render: function (tab) { return dealTabContent(d, tab); },
      concierge: entityConcierge('Поручите Консьержу по сделке — «собрать КП», «что просрочено», «бриф к звонку»…', 'deal:' + d.id, d.title, 'briefcase'),
      pageActs: (c.id ? '<button class="btn sm" data-client="' + c.id + '">' + I('users') + 'Открыть контакт</button>' : '') +
        '<button class="btn sm primary" data-thread="deal:' + d.id + '" data-tlabel="' + d.title + '" data-ticon="briefcase">' + I('chat') + 'Чат по сделке</button>',
    };
  }
  function dealCard(id) { S().dealId = id; WS.router.go('dealDetail'); }
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
    return dxSec('mail', 'Заявка', '<button class="btn xs" data-request="' + r.id + '">' + I('arrowRight') + 'Открыть заявку</button>',
      '<div style="font-size:12.5px;color:var(--ink)"><b>' + r.title + '</b></div>' +
      '<div style="font-size:12px;color:var(--mut);margin-top:2px">Показано объектов: ' + shown + ' · сделок в заявке: ' + sibs.length + '</div>' +
      (sibs.length > 1 ? '<div class="section-label" style="margin-top:8px">Сделки этой заявки</div><div class="qa-row" style="margin-top:4px">' + sibChips + '</div>' : ''));
  }
  function requestCard(id) { S().requestId = id; WS.router.go('requestDetail'); }
  function requestAttrs(r) {
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    return dxSec('mail', 'Заявка · ' + r.title, (c.id ? '<button class="btn xs" data-client="' + c.id + '">' + I('users') + 'Клиент</button>' : ''),
      '<div class="dfields">' +
      dfPair('Клиент', c.name || '—') +
      dfPair('Интерес', r.interest) +
      dfPair('Бюджет', r.budget ? WS.AED(r.budget) : '—') +
      dfPair('Форма оплаты', r.paymentForm) +
      dfPair('VAT (НДС 5%)', r.vat ? 'применяется' : 'не применяется') +
      dfPair('Источник', r.source) +
      dfPair('Агент-партнёр', r.partnerAgent ? agentName(r.partnerAgent) : '—') +
      dfPair('Тип сделки', r.dealType) +
      dfPair('Тип объекта', r.objectType) +
      dfPair('Цель', r.goal) +
      dfPair('Районы', (r.areas || []).join(', ')) +
      dfPair('Срок', r.horizon) +
      dfPair('Канал', r.channel || '—') + '</div>' +
      (r.note ? '<div style="margin-top:8px;font-size:12px;color:var(--mut)">' + r.note + '</div>' : ''));
  }
  const REQ_STATE = { selected: ['ok', 'Выбрал клиент', 'check'], rejected: ['stop', 'Отклонён', 'x'], offered: ['', 'Предложен', 'clock'] };
  function reqOfferedRow(r, off) {
    const o = D().objects.find((x) => x.id === off.id); if (!o) return '';
    const st = REQ_STATE[off.state || 'offered'];
    const chip = '<span class="badge ' + st[0] + '">' + I(st[2]) + st[1] + '</span>';
    const btn = (state, label, ic, cls) => '<button class="btn xs' + (off.state === state ? ' ' + cls : '') + '" data-reqobj="' + r.id + '~' + o.id + '~' + state + '">' + I(ic) + label + '</button>';
    const acts = '<div class="reqo-acts">' + btn('selected', 'Выбрал', 'check', 'primary') + btn('rejected', 'Отклонил', 'x', 'danger') + btn('offered', 'В работе', 'clock', 'ghost') + '</div>';
    const reason = off.reason ? '<div class="reqo-reason">' + I('warn') + off.reason + '</div>' : '';
    return '<div class="reqo">' + dealObjectMini(o) + '<div class="reqo-bar">' + chip + acts + '</div>' + reason + '</div>';
  }
  function reqOfferedBlock(r) {
    const off = r.offered || [];
    const rows = off.map((o) => reqOfferedRow(r, o)).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">объекты ещё не подобраны</div>';
    const add = '<button class="btn xs" data-act="reqAddObject" data-req="' + r.id + '">' + I('plus') + 'Добавить объект</button>';
    const selN = off.filter((o) => o.state === 'selected').length;
    const sub = '<div style="font-size:11px;color:var(--faint);margin-top:6px">Отметьте, что выбрал или отклонил клиент — из выбранного собирается КП и создаётся сделка. Выбрано: ' + selN + '.</div>';
    return dxSec('building', 'Подбор объектов · ' + off.length, add, rows + sub);
  }
  function reqKpBlock(r) {
    const sel = (r.offered || []).filter((o) => o.state === 'selected');
    if (!r.kp || !r.kp.formed) {
      return dxSec('doc', 'Коммерческое предложение', '',
        '<div style="font-size:12.5px;color:var(--mut);margin-bottom:8px">КП ещё не собрано. Отметьте выбранные объекты и соберите КП для клиента.</div>' +
        '<button class="btn sm primary" data-act="reqFormKp" data-req="' + r.id + '"' + (sel.length ? '' : ' disabled') + '>' + I('doc') + 'Собрать КП из выбранного (' + sel.length + ')</button>');
    }
    const kpObjs = (r.kp.objectIds || []).map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    const rows = kpObjs.map((o) => '<div class="feed-row"><div class="fi i-acc">' + I('building') + '</div><div class="ft"><div class="t">' + o.name + '</div><div class="m">' + o.area + ' · ' + WS.AED(o.price) + '</div></div></div>').join('');
    return dxSec('doc', 'Коммерческое предложение · ' + r.kp.at, '<span class="badge ok">' + I('check') + 'собрано</span>',
      '<div class="feed">' + rows + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn sm" data-act="openKp">' + I('arrowRight') + 'Открыть КП</button>' +
      '<button class="btn sm" data-act="reqFormKp" data-req="' + r.id + '">' + I('sparkle') + 'Пересобрать</button>' +
      '<button class="btn sm primary" data-act="reqCreateDeal" data-req="' + r.id + '">' + I('briefcase') + 'Создать сделку из выбранного</button></div>');
  }
  function reqPrefProfile(r) {
    const off = r.offered || [];
    const pick = (state) => off.filter((o) => o.state === state).map((o) => D().objects.find((x) => x.id === o.id)).filter(Boolean);
    const sel = pick('selected'), rej = pick('rejected');
    if (!sel.length && !rej.length) return '';
    const uniq = (arr) => arr.filter((v, i) => v && arr.indexOf(v) === i);
    const likeAreas = uniq(sel.map((o) => o.area)), rejAreas = uniq(rej.map((o) => o.area));
    const likeViews = uniq(sel.map((o) => o.attrs && o.attrs.view));
    const like = sel.length ? '<div class="pref-row"><span class="badge ok">' + I('check') + 'Заходит</span><span>' + [likeAreas.join(', '), likeViews.length ? 'вид: ' + likeViews.join(', ') : ''].filter(Boolean).join(' · ') + '</span></div>' : '';
    const rejl = rej.length ? '<div class="pref-row"><span class="badge stop">' + I('x') + 'Не заходит</span><span>' + rejAreas.join(', ') + '</span></div>' : '';
    return dxSec('sparkle', 'Профиль предпочтений', '<span class="badge demo">' + I('lock') + 'из выбора клиента</span>',
      like + rejl + '<div style="font-size:11px;color:var(--faint);margin-top:6px">Складывается из «предложили ↔ выбрал / отклонил» — уточняет, что предлагать клиенту дальше и на что не тратить время.</div>');
  }
  function viewRequestDetail(id) {
    const r = requestById(id);
    const back = '<div class="obj-page-head"><button class="btn sm" data-nav="requests">' + I('chevLeft') + 'Назад к заявкам</button></div>';
    if (!r) return back + '<div style="padding:20px;color:var(--mut)">Заявка не найдена.</div>';
    const deals = dealsOfRequest(r.id);
    const dealRows = deals.map((d) => {
      const s = funnelSteps(d);
      return '<div class="feed-row" data-deal="' + d.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('briefcase') + '</div>' +
        '<div class="ft"><div class="t">' + dealActionWord(d) + ' · ' + dealLotsLabel(d) + '</div>' +
        '<div class="m">' + s.cols[s.idx] + ' · ' + WS.AED(d.amount) + '</div></div>' + I('arrowRight') + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 0">сделок по заявке ещё нет — создайте из выбранных объектов</div>';
    const dealsBlock = dxSec('briefcase', 'Сделки заявки · ' + deals.length, '',
      '<div class="feed">' + dealRows + '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">Один договор = одна сделка. Несколько юнитов под одним договором — лоты внутри сделки.</div>');
    const sp = (hh) => '<div style="margin-top:14px">' + hh + '</div>';
    const pref = reqPrefProfile(r);
    return back + requestAttrs(r) + sp(reqOfferedBlock(r)) + sp(reqKpBlock(r)) + (pref ? sp(pref) : '') + sp(dealsBlock);
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
  function reqCreateDeal(reqId) {
    const r = requestById(reqId); if (!r) return;
    const sel = (r.offered || []).filter((o) => o.state === 'selected').map((o) => o.id);
    if (!sel.length) { WS.storeApi.toast('Сначала отметьте объекты, которые выбрал клиент'); return; }
    const objs = sel.map((oid) => D().objects.find((o) => o.id === oid)).filter(Boolean);
    const c = D().clients.find((x) => x.id === r.clientId) || {};
    const amount = objs.reduce((s, o) => s + (o.price || 0), 0);
    const nid = 'd_' + r.id.replace(/^r_/, '') + '_' + ((D().deals || []).length + 1);
    D().deals.push({ id: nid, clientId: r.clientId, companyId: null,
      title: (c.name || 'Клиент') + ' · ' + (objs[0] ? objs[0].name.split(',')[0] : 'сделка'),
      funnel: 'sale_offplan', stage: 'new', stageDays: 0, amount: amount, hot: false,
      goal: r.goal, dealType: r.dealType, paymentForm: r.paymentForm, source: r.source, objectType: r.objectType, vat: r.vat,
      requestId: r.id, lots: sel, objectId: sel[0], consideredProjects: objs.map((o) => o.name), prov: {} });
    D().dealTimeline = D().dealTimeline || {};
    D().dealTimeline[nid] = [{ ch: 'crm', by: 'Система', at: 'только что', ord: 999, text: 'Сделка создана из заявки «' + r.title + '» · подписан документ о намерениях · лотов: ' + sel.length }];
    WS.storeApi.save(); WS.storeApi.toast('Сделка создана из заявки · лотов: ' + sel.length, 'ok'); dealCard(nid);
  }
  // R3 direct edit + confirm AI fields. Editable structural fields with Dubai enums.
  const DEAL_ENUMS = {
    dealType: ['Продажа · off-plan', 'Продажа · готовое', 'Аренда', 'Fit-out', 'Готовый арендный бизнес', 'Передано партнёру'],
    objectType: ['off-plan', 'готовое', 'офис', 'ритейл', 'вилла', 'склад', 'земля'],
    paymentForm: ['100% оплата', 'Рассрочка от застройщика', 'Ипотека', 'Годовой чек', 'Поэтапно'],
    source: ['Property Finder', 'Bayut', 'Dubizzle', 'Instagram', 'Реферал', 'Клуб', 'Импорт'],
  };
  function openDealEdit(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const sel = (k, label) => '<label class="fld"><span>' + label + '</span><select id="df_' + k + '">' + DEAL_ENUMS[k].map((o) => '<option' + (o === d[k] ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Прямое редактирование первоклассно. Сохранение помечает поля как «подтверждено человеком».</p>' +
      '<div class="match-grid">' +
      '<label class="fld"><span>Бюджет, AED</span><input id="df_amount" type="text" value="' + (d.amount || '') + '"></label>' +
      sel('dealType', 'Тип сделки') + sel('objectType', 'Тип объекта') + sel('paymentForm', 'Форма оплаты') + sel('source', 'Источник') +
      '<label class="fld"><span>Цель</span><input id="df_goal" type="text" value="' + ((d.goal || '').replace(/"/g, '&quot;')) + '"></label>' +
      '</div>' +
      '<label class="pcheck" style="margin-top:10px"><input type="checkbox" id="df_vat"' + (d.vat ? ' checked' : '') + '> Применяется VAT 5%</label>';
    openModal('Параметры сделки · ' + d.title, body,
      '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="saveDeal" data-deal="' + id + '">' + I('check') + 'Сохранить</button>');
  }
  function saveDealEdit(id) {
    const d = D().deals.find((x) => x.id === id); if (!d) return;
    const g = (k) => { const el = document.getElementById('df_' + k); return el ? el.value : d[k]; };
    const amt = parseInt((g('amount') || '').toString().replace(/\D/g, ''), 10);
    d.amount = amt || d.amount;
    ['dealType', 'objectType', 'paymentForm', 'source', 'goal'].forEach((k) => { d[k] = g(k); });
    d.vat = !!(document.getElementById('df_vat') || {}).checked;
    d.prov = Object.assign({}, d.prov, { budget: 'confirmed', paymentForm: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' });
    WS.storeApi.toast('Параметры сделки сохранены и подтверждены', 'ok');
    dealCard(id);
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
  const TIMELINE_KEY = { contact: 'contactTimeline', company: 'companyTimeline', deal: 'dealTimeline' };
  function timelineFor(scope) {
    const data = D(); const key = TIMELINE_KEY[scope];
    if (!key) return null;
    return (data[key] = data[key] || {});
  }
  // Headless core of "add an event to a feed" — no DOM, so the Concierge can drive it too.
  // when: 'now' | { daysAgo: 0..N, h, mi }. Returns the stored entry, or null if the input is
  // not valid (unknown scope / unknown entity / empty text) — never writes a half-formed record.
  let taskSeq = 0;   // ids for tasks the Concierge creates; stable within a session
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
    floor: { high: 'Высокий', mid: 'Средний', low: 'Низкий' },
    finish: { new: 'Свежая отделка', standard: 'Стандартная', 'shell&core': 'Shell & Core', shell: 'Shell & Core' },
    demand: { high: 'Высокий спрос', mid: 'Средний спрос', low: 'Низкий спрос' },
    prestige: { high: 'Премиум', mid: 'Средний', low: 'Эконом' },
  };
  function objAttr(o, k) { const v = o.attrs && o.attrs[k]; if (v == null || v === '') return '—'; const m = OBJ_ATTR[k]; return (m && m[v]) || v; }
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
      ['Этаж', objAttr(o, 'floor')], ['Отделка', objAttr(o, 'finish')], ['Спрос', objAttr(o, 'demand')],
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
  function objMap(o) {
    return '<div class="obj-map">' +
      '<div class="obj-map-canvas"><span class="obj-map-pin">' + I('building') + '</span>' +
      '<span class="obj-map-area">' + o.area + '</span></div>' +
      '<div class="obj-map-foot"><div class="omf-t"><b>' + o.area + '</b><span>' + (o.address || '—') + '</span></div>' +
      '<span class="badge demo">' + I('lock') + 'DEMO карта</span></div>' +
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
        dfPair('Цена за м²', perM2) + dfPair('Этаж', objAttr(o, 'floor')) + dfPair('Отделка', objAttr(o, 'finish')) +
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
    const rows = [
      ['Класс', o.br],
      ['Готовность', o.availability === 'available' ? 'Доступен для показа' : 'Требует проверки'],
      ['Расположение', o.area + ((o.attrs && o.attrs.metro) ? ' · метро рядом' : '')],
      ['Комиссия агенту', o.commissionPct ? o.commissionPct + '%' : '—'],
    ];
    return '<dl class="ohero-meta">' + rows.map((r) => '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl>';
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
  function objSummary(o) {
    const perM2 = o.size ? WS.AED(Math.round(o.price / o.size)) : '—';
    const m = [
      [WS.AED(o.price), 'общая цена', true],
      [perM2, 'цена за м²', false],
      [o.size + ' м²', 'площадь', false],
      [objAttr(o, 'floor'), 'этаж', false],
    ];
    return '<div class="osum">' +
      '<div class="osum-eyebrow">Описание</div>' +
      '<p class="osum-lead">' + (o.match || '—') + '</p>' +
      '<div class="osum-metrics">' + m.map((c) =>
        '<div class="osum-m' + (c[2] ? ' osum-m--hero' : '') + '"><div class="osum-v">' + c[0] + '</div><div class="osum-l">' + c[1] + '</div></div>').join('') +
      '</div></div>';
  }
  function objStatusesInner(o) {
    return '<div class="prov"><span class="badge ' + (o.trakheesi === 'ok' ? 'ok' : 'warn') + '">' + I('shield') + 'Trakheesi ' + (o.trakheesi === 'ok' ? 'получено' : 'в процессе') + '</span>' +
      '<span class="badge ' + (o.madmoun === 'ok' ? 'ok' : '') + '">' + I('qr') + 'Madmoun ' + (o.madmoun === 'ok' ? 'QR есть' : 'n/a') + '</span>' +
      '<span class="badge ' + (o.verified === 'verified' ? 'ok' : 'warn') + '">' + I('check') + 'Проверка · ' + o.checkedAt + (o.verified === 'expired' ? ' (истекла)' : '') + '</span>' +
      '<span class="badge demo">' + I('lock') + 'проверка — имитация (DEMO)</span></div>';
  }
  function viewObjectDetail(id) {
    const o = D().objects.find((x) => x.id === id);
    if (!o) return viewObjects();
    const inSl = inShortlist(o.id);
    const back = '<div class="obj-page-head"><button class="btn sm" data-nav="objects">' + I('chevLeft') + 'Назад к объектам</button>' +
      '<div class="obj-page-acts">' +
      '<button class="btn sm" data-valobj="' + o.id + '">' + I('calc') + 'Оценить</button>' +
      '<button class="btn sm" data-shortlist="' + o.id + '"' + (inSl ? ' style="border-color:var(--acc-line);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + I(inSl ? 'check' : 'star') + (inSl ? 'В подборке' : 'В подборку') + '</button>' +
      '<button class="btn sm primary" data-thread="object:' + o.id + '" data-tlabel="' + o.name + ' · объект" data-ticon="building">' + I('chat') + 'Чат по объекту</button>' +
      '</div></div>';
    const paramsInner = '<div class="obj-meta">' + [
      ['Вид', objAttr(o, 'view')], ['Отделка', objAttr(o, 'finish')], ['Спрос на рынке', objAttr(o, 'demand')],
      ['Престиж', objAttr(o, 'prestige')], ['Метро', (o.attrs && o.attrs.metro) ? 'рядом' : '—'], ['Источник', o.sourceLabel],
    ].map((p) => '<div><div class="omk">' + p[0] + '</div><div class="omv">' + p[1] + '</div></div>').join('') + '</div>';
    const grid = '<div class="odetail-grid">' +
      dxSec('grid', 'Параметры объекта', '', paramsInner) +
      dxSec('compass', 'Расположение на карте', '', objMap(o)) + '</div>';
    const statuses = dxSec('shield', 'Официальные статусы', '', objStatusesInner(o));
    const docs = dxSec('doc', 'Документы по объекту', '', docsRows(docsFor((x) => x.object === o.id), 'по этому объекту документов пока нет'));
    return back + objHero(o) + objSummary(o) + grid + statuses + docs;
  }

  // Deal / client as full-page views (не поп-ап): много информации — нужна страница со скроллом, как у объекта.
  function viewDealDetail(id) {
    const spec = dealSpec(id);
    if (!spec) return viewClients();
    return entityPage(spec, 'clients', 'deals', 'Назад к сделкам');
  }
  function viewClientDetail(id) {
    const spec = clientSpec(id);
    if (!spec) return viewClients();
    return entityPage(spec, 'clients', 'contacts', 'Назад к клиентам');
  }

  // ---------------- ПОДБОР ПОД СДЕЛКУ (matching workspace) ----------------
  const TARGET_YIELD = 0.05; // implied investor target (net)
  function objNetYield(o) {
    const m = Object.assign(WS.storeApi.clone(D().refModel), { objectId: o.id, price: o.price });
    return WS.finance.compute(m).netYield;
  }
  // ---------------- MATCHING (качественный + психологический подбор) ----------------
  const QUAL = [
    { k: 'water', label: 'Вид на воду', test: (o) => o.attrs && o.attrs.view === 'water' },
    { k: 'highfloor', label: 'Высокий этаж', test: (o) => o.attrs && o.attrs.floor === 'high' },
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
      '<div class="section-label" style="margin:12px 0 6px">Психологический мэтч</div><div class="qa-row">' + psychToggle +
        (psychAvail ? '' : '<span class="badge">' + I('lock') + 'заполните профиль в карточке контакта</span>') + '</div>' +
      (psychAvail ? '<div style="font-size:11.5px;color:var(--mut);margin-top:8px">' + I('sparkle') + ' Профиль: <b>' + c.psych.decision + '</b> · важно: ' + (c.psych.values || []).join(', ') + '</div>' : '') +
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
        clientId: t.clientId, objectId: objOfClient(t.clientId),
        title: t.title, sub: who + (cn(t.clientId) ? ' · ' + cn(t.clientId) : '') + (done ? ' · выполнено' : ''),
        open: t.scenario ? { scn: t.scenario } : { client: t.clientId } });
    });
    D().inbox.forEach((i) => {
      push({ id: i.id, type: 'сообщение', when: 'сегодня ' + i.at, dir: 'incoming',
        clientId: i.clientId, objectId: objOfClient(i.clientId),
        title: (cn(i.clientId) || 'Клиент') + ' — входящее', sub: (i.channel || 'сообщение') + ' · ' + (i.text || '').slice(0, 42), open: { nav: 'concierge' } });
    });
    push({ id: 'cm_kp_igor', type: 'сообщение', when: 'вчера', dir: 'outgoing', clientId: 'c_overdue', objectId: objOfClient('c_overdue'), title: 'Отправлено КП — Игорь Лебедев', sub: 'WhatsApp · исходящее', open: { deal: 'd_igor' } });
    push({ id: 'cm_assign_omar', type: 'задача', when: 'сегодня', dir: 'in', clientId: 'c_docs', objectId: objOfClient('c_docs'), title: 'Подготовить документы к сделке Виктора', sub: 'от: Омар Рахман (руководитель)', open: { deal: 'd_viktor' } });
    return acts;
  }
  function activityRow(a) {
    const ic = a.type === 'звонок' ? 'phone' : a.type === 'показ' ? 'calendar' : a.type === 'сообщение' ? 'chat' : 'check';
    const dirLabel = (CAL_DIRS.find((d) => d[0] === a.dir) || [])[1] || a.dir;
    const tone = a.dir === 'incoming' ? 'i-acc' : a.dir === 'outgoing' ? 'i-info' : a.dir === 'agent' || a.dir === 'in' ? 'i-info' : 'i-mut';
    const openBtn = a.open.event ? '<button class="btn sm" data-event="' + a.open.event + '">' + I('pencil') + 'Открыть</button>'
      : a.open.scn ? '<button class="btn sm primary" data-scn="' + a.open.scn + '">' + I('arrowRight') + 'Действие</button>'
      : a.open.deal ? '<button class="btn sm" data-deal="' + a.open.deal + '">' + I('eye') + 'Сделка</button>'
      : a.open.client ? '<button class="btn sm" data-client="' + a.open.client + '">' + I('eye') + 'К записи</button>'
      : '<button class="btn sm" data-nav="' + (a.open.nav || 'concierge') + '">' + I('arrowRight') + 'Открыть</button>';
    return '<div class="radar-row" data-actrow="' + a.id + '"><div class="sev"></div><div class="icon-tile ' + tone + '">' + I(ic) + '</div>' +
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
      { open: 'doc:formI',   title: 'Соглашение брокеров (Form I)',       status: 'draft',    deal: 'd_karim',  client: 'c_partner',                        sub: 'co-broking · S6' },
      { open: 's13_pkg',     title: 'Клубный пакет (адресная рассылка)',  status: 'ready',                                          object: 'o_palmcourt', sub: 'эксклюзив клуба · S13' },
    ];
  }
  const DOC_ST = { ready: ['ok', 'check', 'готов'], draft: ['warn', 'clock', 'черновик'], external: ['info', 'link', 'внешний шаг'], phase: ['', 'clock', 'Фаза 3'] };
  function docClientName(d) { const c = D().clients.find((x) => x.id === d.client); return c ? c.name : ''; }
  // entity links of a document — shows it belongs to distinct sets (сделка/объект/контакт)
  // yet is the SAME registry record reused across scenarios.
  function docLinks(d) {
    const chips = [];
    if (d.deal) { const dl = D().deals.find((x) => x.id === d.deal); chips.push('<span class="badge">' + I('briefcase') + 'сделка: ' + (dl ? dl.title : d.deal) + '</span>'); }
    if (d.object) { const o = D().objects.find((x) => x.id === d.object); chips.push('<span class="badge">' + I('building') + 'объект: ' + (o ? o.name.split(',')[0] : d.object) + '</span>'); }
    if (d.client) { const c = D().clients.find((x) => x.id === d.client); chips.push('<span class="badge">' + I('users') + 'контакт: ' + (c ? c.name : d.client) + '</span>'); }
    return chips.length ? '<div class="prov" style="margin-top:4px">' + chips.join('') + '</div>' : '';
  }
  function docRow(d, withWho) {
    const s = DOC_ST[d.status] || DOC_ST.ready;
    const who = withWho && docClientName(d) ? docClientName(d) + ' · ' : '';
    const links = withWho ? docLinks(d) : ''; // show entity links only in the central Documents view
    return '<div class="feed-row"><div class="fi i-acc">' + I('doc') + '</div><div class="ft"><div class="t">' + d.title + '</div><div class="m">' + who + (d.sub || '') + '</div>' + links + '</div>' +
      '<span class="badge ' + s[0] + '">' + I(s[1]) + s[2] + '</span>' +
      '<button class="btn sm" data-artopen="' + d.open + '" style="margin-left:8px">' + I('eye') + 'Открыть</button></div>';
  }
  function docsFor(pred) { return docRegistry().filter(pred); }
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
      { h: 'Психологический профиль (сигналы стиля)' },
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
      { k: 'Эксклюзив', v: 'Palm Court 704 (клуб)' }, { k: 'Совпадений', v: '4 активные заявки' },
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
      { h: 'Подготовлено (без отправки)' }, { k: 'Черновик заявки', v: 'создан' }, { k: 'Ответ A1', v: 'шаблон подтверждения получения' },
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
      { k: 'Расчёт', v: 'короткий, допущения видны' }, { k: 'Итог', v: 'создана заявка + следующее касание' },
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
        data.deals.push({ id: newId, clientId: i.clientId, objectId: i.ex === 'unknown_object' ? null : 'o_creekline', agent: 'u_marina', amount: c.budget || 1500000, hot: true, stage: 'new', title: (c.name || 'Новый лид'), sub: 'Квалифицировано из исключения', tags: ['из инбокса'], updated: 'сейчас', funnel: 'sale_offplan', dealType: 'Продажа · off-plan', objectType: 'off-plan', goal: c.goal || 'Инвестиция', paymentForm: 'Рассрочка от застройщика', vat: false, source: 'Импорт', partnerAgent: null, companyId: null, consideredProjects: [], stageDays: 0, prov: { budget: 'ai', source: 'ai', goal: 'ai', objectType: 'ai', paymentForm: 'ai' } });
      }
      data.inbox = data.inbox.filter((x) => x.id !== id);
      WS.storeApi.toast('Квалифицировано → создана сделка в канбане (стадия «Новая заявка»)', 'ok');
      WS.store.clientsTab = 'deals'; WS.store.dealFunnel = 'sale_offplan';
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
  // Пульс разгружен: вместо полной очереди — только «Мой день» (сегодня/просрочено) + вход на экран «Задачи».
  function pulseMyDay() {
    const all = D().tasks || [];
    const open = all.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.when === 'overdue');
    const today = open.filter((t) => t.when === 'today');
    const top = overdue.concat(today).slice(0, 3).map(taskRow).join('') ||
      '<div class="empty" style="padding:16px">' + I('checkCircle') + '<div style="font-weight:700;color:var(--ink)">На сегодня всё разобрано</div></div>';
    const od = overdue.length ? ' · <span style="color:var(--stop);font-weight:700">просрочено ' + overdue.length + '</span>' : '';
    return '<div class="wq-head" style="margin-top:28px"><div class="section-label" style="margin:0">Мой день · сегодня ' + today.length + od + '</div>' +
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
    const chip = (attr, k, l, cur) => '<button class="chip' + (cur === k ? '' : ' mut') + '" data-' + attr + '="' + k + '"' + (cur === k ? ' style="border-color:var(--acc);background:var(--acc-soft);color:var(--acc-ink)"' : '') + '>' + l + '</button>';
    const statusChips = [['open', 'Открытые'], ['done', 'Выполнено'], ['all', 'Все']].map(([k, l]) => chip('tasksstatus', k, l, statusF)).join('');
    const dueChips = [['all', 'Все сроки'], ['overdue', 'Просрочено'], ['today', 'Сегодня'], ['later', 'Позже']].map(([k, l]) => chip('tasksdue', k, l, dueF)).join('');
    const rows = list.map(taskRow).join('') || ('<div class="empty" style="padding:32px 20px">' + I('checkCircle') +
      '<div style="font-weight:700;color:var(--ink);margin-bottom:2px">' + (all.length ? 'Под фильтры задач нет' : 'Все задачи разобраны') + '</div>' +
      '<div>' + (all.length ? 'Измените статус или срок выше, чтобы увидеть остальные.' : 'Новые появятся из сделок и рекомендаций Консьержа.') + '</div></div>');
    return head('Задачи', 'Все задачи по сделкам и клиентам: бэклог, сроки, приоритет. «Мой день» (сегодня/просрочено) остаётся в Пульсе — здесь полный список с фильтрами. Инсайты — автоматически сгенерированные Консьержем группы задач из рекомендательной системы.',
      '<button class="btn sm primary" data-act="newTask">' + I('plus') + 'Новая задача</button>') +
      tasksInsights() +
      (isMgr ? tasksHeatmap() : '') +
      '<div class="qa-row" style="margin:16px 0 4px">' + statusChips + '<span class="df-sep"></span>' + dueChips + '</div>' +
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
    const key = dxSec('checkCircle', 'Суть задачи', '', '<div class="dfields">' +
      dfPair('Что сделать', t.title) + dfPair('Клиент', c.name || '—') + dfPair('Тип', kindLabel) +
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
  function openNewTask() {
    const clientOpts = D().clients.map((c) => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    const kindOpts = [['manual', 'Ручная задача'], ['call', 'Звонок'], ['touch', 'Касание'], ['doc', 'Документ'], ['kp', 'КП']]
      .map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
    const teamOpts = TEAM.map((m) => '<option value="' + m.id + '"' + (m.id === 'u_marina' ? ' selected' : '') + '>' + m.name + (m.id === 'u_marina' ? ' (я)' : '') + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Обычная задача. Можно оставить на себя или назначить другому сотруднику — он увидит её у себя.</p>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Что сделать</span><input id="ntTitle" type="text" placeholder="Например: перезвонить по КП"></label>' +
      '<label class="fld"><span>Клиент</span><select id="ntClient">' + clientOpts + '</select></label>' +
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
    WS.storeApi.addTask({
      id: 'tm_' + Math.round(performance.now()),
      clientId: g('ntClient') || 'c_anna',
      title: title, kind: g('ntKind') || 'manual', assignee: assignee,
      when: when, due: when === 'tomorrow' ? 'завтра' : 'сегодня',
      why: assignedOut ? 'Назначено от: Марина Волкова' : 'Задача добавлена вручную',
    });
    closeModal();
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
    const stageOpts = STAGES.map((s) => '<option value="' + s.k + '">' + s.label + '</option>').join('');
    const body = '<p style="font-size:12.5px;color:var(--mut);margin-top:0">Создать сделку вручную — из формы, приложенной заявки или PDF (в демо — форма). Это структурированный экран, а не диалог с Консьержем.</p>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Клиент</span><select id="nd_client">' + clientOpts + '</select></label>' +
      '<label class="fld"><span>Объект</span><select id="nd_object">' + objOpts + '</select></label>' +
      '<label class="fld"><span>Сумма, AED</span><input id="nd_amount" type="number" step="50000"></label>' +
      '<label class="fld"><span>Стадия</span><select id="nd_stage">' + stageOpts + '</select></label>' +
      '</div>' +
      '<div class="prov" style="margin-top:10px"><span class="badge">' + I('upload') + 'Приложить заявку (PDF) — демо</span><span class="badge demo">' + I('lock') + 'ручное создание</span></div>';
    openModal('Создать сделку', body, '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="createDeal">' + I('check') + 'Создать сделку</button>');
  }
  function createDeal() {
    const cid = _g('nd_client'); const c = D().clients.find((x) => x.id === cid) || {};
    const id = 'dm_' + Math.round(performance.now());
    WS.storeApi.applyEffects([{ op: 'addDeal', obj: { _new: true, id: id, clientId: cid, objectId: _g('nd_object'), agent: 'u_marina', amount: parseInt(_g('nd_amount'), 10) || 0, hot: false, stage: _g('nd_stage') || 'new', title: c.name || 'Сделка', sub: 'создано вручную', tags: ['ручное'], updated: 'сейчас' } }]);
    closeModal(); WS.storeApi.toast('Сделка создана', 'ok'); S().clientsTab = 'deals'; WS.router.go('clients');
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
    const active = list.filter((d) => d.stage !== 'done').length;
    const meta = TEAM_META[id] || { focus: '—', load: 50, conv: 30, sla: 90 };
    return { list: list, val: val, active: active, deals: list.length, meta: meta };
  }
  function mgrTiles() {
    const active = D().deals.filter((d) => d.stage !== 'done');
    const pipeline = Math.round(active.reduce((s, d) => s + (d.amount || 0), 0) / 1e5) / 10;
    const closed = D().deals.filter((d) => d.stage === 'done').length;
    const unassigned = (D().inbox || []).length;
    const slaBreaches = Object.keys(TEAM_META).filter((k) => TEAM_META[k].load > 100 || TEAM_META[k].sla < 80).length;
    return '<div class="tiles" style="margin-top:20px">' +
      tile('briefcase', 'Пайплайн команды', pipeline.toLocaleString('ru-RU'), 'млн AED', '', 'Активные сделки всех агентов', 'up', 'accent', 'data-nav="clients"') +
      tile('target', 'План месяца', closed + ' / 12', 'сделок', '', 'Закрыто из цели отдела', '', '', 'data-nav="analytics"') +
      tile('warn', 'Нарушения SLA', slaBreaches, '', '', 'Агенты вне норматива', '', '', 'data-nav="team"') +
      tile('mail', 'Нераспределённые', unassigned, '', '', 'Заявки ждут агента', '', '', 'data-nav="leads"') +
      tile('check', 'На согласовании', MGR_APPROVALS.length - (S().apprDone || []).length, '', '', 'КП, скидки, co-broking', '', '', 'data-nav="approvals"') +
      tile('users', 'Агентов на смене', Object.keys(TEAM_META).length, '', '', 'Вся команда активна', '', '', 'data-nav="team"') +
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
    'Клиенты': { img: 'o_palmcourt' },
    'Заявки': { img: 'o_marina' },
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
  function heroViz(kind, title, desc, opts) {
    opts = opts || {};
    const img = (WS.photos && (kind === 'pulse' ? WS.photos.viz_pulse : WS.photos.viz_concierge)) || '';
    const bg = img ? ' style="background-image:url(' + img + ')"' : '';
    return '<div class="wh wh--photo"' + bg + '><div class="wh__c">' +
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
      '<div class="section-label">Психологический профиль</div>' +
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
        body += '<div class="scn' + active + '" data-scnrow="' + s.id + '">' +
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
  // ---------------- "ЕЩЁ" SECTIONS (v3 framework) ----------------
  // Заявки — incoming requests from all channels (night leads, voice, exceptions).
  function viewRequests() {
    const chanI = { whatsapp: 'whatsapp', email: 'mail', voice: 'mic', call: 'chat' };
    const exLabel = { qualify: ['Квалифицировать', 'warn'], duplicate: ['Возможный дубль', 'warn'], unknown_object: ['Объект вне инвентаря', 'warn'], delivery_fail: ['Ошибка доставки', 'stop'] };
    const rows = (D().inbox || []).map((it) => {
      const c = (D().clients || []).find((x) => x.id === it.clientId);
      const who = c ? c.name : 'Новый контакт';
      const ex = exLabel[it.ex] || ['Входящее', ''];
      const scn = it.scenario || (it.ex === 'qualify' ? 'S15' : null);
      const act = scn ? '<button class="btn sm" data-scn="' + scn + '">' + I('play') + 'Разобрать</button>'
        : '<button class="btn sm" data-nav="concierge">' + I('sparkle') + 'Разобрать</button>';
      return '<div class="feed-row"><div class="fi i-acc">' + I(chanI[it.channel] || 'chat') + '</div>' +
        '<div class="ft"><div class="t">' + who + ' · <span style="color:var(--mut);font-weight:500">' + it.at + '</span></div>' +
        '<div class="m">' + it.text + '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center"><span class="badge ' + ex[1] + '">' + I('warn') + ex[0] + '</span>' + act + '</div></div>';
    }).join('');
    const reqRows = (D().requests || []).map((r) => {
      const rc = D().clients.find((x) => x.id === r.clientId) || {};
      const dn = dealsOfRequest(r.id).length;
      return '<div class="feed-row" data-request="' + r.id + '" style="cursor:pointer"><div class="fi i-acc">' + I('mail') + '</div>' +
        '<div class="ft"><div class="t">' + (rc.name || '—') + ' · ' + r.title + '</div>' +
        '<div class="m">' + (r.budget ? WS.AED(r.budget) : '—') + ' · сделок: ' + dn + ' · предложено объектов: ' + ((r.offered || []).length) + '</div></div>' + I('arrowRight') + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--faint);padding:6px 16px">активных заявок нет</div>';
    return head('Заявки', 'Два потока: активные заявки клиентов (клик по строке — карточка заявки со сделками и показанными объектами) и входящие обращения из каналов, которые ещё нужно разобрать. «Разобрать» запускает Консьержа — разобранная заявка становится сделкой.',
      '<button class="btn sm" data-scn="G1">' + I('mic') + 'Заявка голосом (G1)</button>') +
      '<div class="card"><div class="section-label" style="padding:12px 16px 4px">Активные заявки клиентов · ' + ((D().requests || []).length) + '</div><div class="feed" style="padding:0 16px 8px">' + reqRows + '</div></div>' +
      '<div class="card" style="margin-top:14px"><div class="section-label" style="padding:12px 16px 4px">Входящие · нужно разобрать · ' + (D().inbox || []).length + '</div><div class="feed" style="padding:0 16px 8px">' + (rows || '<div style="font-size:12px;color:var(--faint);padding:6px 16px">входящих обращений нет — всё разобрано</div>') + '</div></div>';
  }
  // Компании — legal entities (developers, funds, corporates, agencies).
  function viewCompanies() {
    return head('Компании', 'Юрлица: застройщики, фонды, корпоративные клиенты, агентства. KYC-статус (не рейтинг) и связанные сделки. Клик по строке — карточка компании.',
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
    { name: 'Whitewill', focus: 'Off-plan · Downtown, Business Bay', deals: 3, split: '50 / 50', status: 'active' },
    { name: 'Metropolitan Premium', focus: 'Готовое жильё · Palm, Marina', deals: 2, split: '50 / 50', status: 'active' },
    { name: 'STONE · застройщик', focus: 'Собственные проекты · эксклюзив', deals: 1, split: 'по проекту', status: 'active' },
    { name: 'Кирилл · частный брокер', focus: 'Клубные покупатели', deals: 1, split: '50 / 50', status: 'pending' },
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
      '<div class="kpi"><div class="kv">' + (D().deals || []).filter((d) => d.stage === 'done').length + '</div><div class="kk">Закрыто · демо</div></div>' +
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
    const active = deals.filter((d) => d.stage !== 'done').length;
    const closed = deals.filter((d) => d.stage === 'done').length;
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
      '<div class="kpi"><div class="kv">214 000</div><div class="kk">Комиссия · квартал, AED</div></div>' +
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
    return header + profileContact + kpis + priv + about + objectsCard + svcAcc + links;
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
      rowc('bell', 'Требуют действий сегодня', 'Горячие клиенты, просроченные касания, новые заявки', sw(true)) +
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
    const CHANNELS = [
      ['handshake', 'Партнёрская сеть', recips + ' партнёра · co-broking', true],
      ['building', 'Property Finder', 'листинг · ~2 400 просмотров/нед', true],
      ['grid', 'Bayut', 'листинг · ~1 800 просмотров/нед', false],
      ['star', 'Соцсети (Instagram)', 'пост + сторис · ~5 000 охват', false],
      ['star', 'Клубная рассылка', 'инвесторы клуба · закрытый пул', true],
      ['mail', 'Email-дайджест', 'база клиентов · 320 контактов', false],
    ];
    const channelRows = CHANNELS.map((c) => '<label class="feed-row" style="cursor:pointer"><input type="checkbox" ' + (c[3] ? 'checked' : '') + ' style="margin:0 10px 0 0;accent-color:var(--acc)"><div class="fi i-mut">' + I(c[0]) + '</div><div class="ft"><div class="t">' + c[1] + '</div><div class="m">' + c[2] + '</div></div></label>').join('');
    const focus =
      '<div class="promo-focus">' +
      '<div class="pf-cell"><div class="pf-v">~9 200</div><div class="pf-l">охват · контактов</div></div>' +
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
      '<div class="match promo-note">' + I('sparkle') + '<span>Рассылка ' + recips + ' партнёрам. Отклики придут в «Заявки» и Пульс · баланс кошелька <b>8 500 AED</b>.</span></div>';
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
            '<div style="font-size:11px;color:var(--faint);margin-top:8px">Оплата — из кошелька платформы. Отклики придут в «Заявки» и Пульс.</div></div>' +
          '<div class="card pad" style="margin-top:16px"><div class="section-label">Что получат партнёры</div><div class="chg-list" style="margin-top:8px">' + perks + '</div></div>' +
        '</aside>' +
      '</div>';
  }

  // ---------------- MAIN RENDER ----------------
  function viewFor(id) {
    switch (id) {
      case 'start': return viewStart();
      case 'concierge': return viewConcierge();
      case 'clients': return wrap(viewClients());
      case 'objects': return wrap(viewObjects());
      case 'objectDetail': return wrap(viewObjectDetail(S().objectId));
      case 'dealDetail': return wrap(viewDealDetail(S().dealId));
      case 'clientDetail': return wrap(viewClientDetail(S().clientId));
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

  function render() {
    const app = document.getElementById('app');
    const st = S();
    // preserve focus in prompt inputs across renders
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const caret = active && active.selectionStart;

    app.innerHTML = shell();
    ensureOverlays(); // modal/toasts live outside #app — never wiped by this render (P0-1)
    document.getElementById('main').innerHTML = viewFor(st.view);
    document.getElementById('drawer').innerHTML = drawer();

    if (st.view === 'concierge') mountConcierge();
    if (st.view === 'objects') bindObjects();
    if (st.view === 'finance') renderFinance();
    // Hide the floating Concierge launcher (W) on the Concierge screen itself — it's redundant there.
    const _fab = document.querySelector('.fab-w'); if (_fab) _fab.style.display = (st.view === 'concierge') ? 'none' : '';
    renderToasts();

    if (st.navOpen) { document.getElementById('drawer').classList.add('show'); document.getElementById('scrim').classList.add('show'); }
    if (st.incompatible) { showIncompatible(); st.incompatible = false; }

    if (focusId) { const elx = document.getElementById(focusId); if (elx) { elx.focus(); try { elx.setSelectionRange(caret, caret); } catch (e) {} } }
    // docked chat lives outside #app (survives re-render); keep the engine pointed at it while open
    if (st.cgDock) { const m = document.getElementById('cgdockmsgs'); if (m) WS.engine.mount(m, renderDockMsgs); }
  }

  function showIncompatible() {
    openModal('Несовместимая версия данных',
      '<p>Сохранённое состояние стенда относится к другой версии схемы. Рекомендуется безопасный сброс к исходным данным.</p>',
      '<button class="btn" data-act="closeModal">Оставить как есть</button><button class="btn primary" data-act="reset">Безопасный сброс</button>');
  }

  WS.ui = { render, openModal, closeModal, openSections, openHelp, renderToasts, drawer, mountConcierge, cgContextMenu,
    openArtifact, openArtifactId, openKp, openXls, openDoc, openFinance, finSlider, finScenario, clientCard, objectCard,
    openReassign, openNewTask, createTaskFromForm, dealCard, taskCard, moveDealDir, showCard, saveEvent, openNewThread,
    openPsychForm, savePsychForm, openDealForm, createDeal, openContactForm, createContact, openObjectForm, createObject, openCgFeature,
    openDealEdit, saveDealEdit, openEventForm, setFeedType, saveEventEntry,
    // headless seams for the Concierge — no DOM, safe to drive programmatically
    addEventEntry, metricsSnapshot, feedOwner, userById, dealCommission, openAgentEvidence, openDealContactForm, saveDealContact, removeDealContact, setEntityTab, entityCard, openAnalyticsDrill, resolveException, companyCard, openAuditLog,
    openWallet, renderCgDock, valInput, valFromObj, openPromotion, objGalleryNav, openClubPost, openClubRequest, openServiceRequest, openWalletTopup, callClient, requestCard, reqObjState, reqAddObject, reqAddObjectDo, reqFormKp, reqCreateDeal };
})(window.WS = window.WS || {});
