/* ============================================================
   Fixture repository — initial demo snapshot (spec §6, §12).
   Never mutated directly; the store deep-clones this.
   ============================================================ */
(function (WS) {
  // Fixed demo day. "today / tomorrow / overdue" resolve from this clock,
  // not from the device date (spec §6.1).
  const DEMO_NOW = { y: 2026, mo: 5, d: 14, h: 9, mi: 12 }; // 14 May 2026, 09:12

  const tenant = { name: 'Harbour Key Realty LLC', city: 'Dubai', plan: 'Demo tenant' };

  const users = {
    agent:   { id: 'u_marina', name: 'Марина Волкова', role: 'Агент', init: 'МВ', photo: 'avatar_marina',
      // Closed book for the demo period, per horizon. `attribution` is agency-wide and carries no
      // agent split, so a personal goal must read the agent's own figures, not a slice of it.
      closedPeriod: { month: { commission: 186000, deals: 2 }, quarter: { commission: 430000, deals: 5 } },
      goals: [
        { id: 'g_commission', metric: 'commission', target: 1200000, period: 'quarter', label: 'Заработать 1,2 млн комиссии за квартал', pinned: true },
        { id: 'g_pipeline', metric: 'pipeline', target: 5000000, period: 'month', label: 'Держать 5 млн в активных сделках', pinned: true },
        { id: 'g_deals', metric: 'deals', target: 14, period: 'quarter', label: 'Закрыть 14 сделок за квартал', pinned: false },
      ]
    },
    manager: { id: 'u_omar',   name: 'Омар Рахман',    role: 'Руководитель', init: 'ОР',
      goals: [
        { id: 'g_team_commission', metric: 'commission', target: 3500000, period: 'quarter', label: 'План отдела по комиссии за квартал', pinned: true },
        { id: 'g_team_deals', metric: 'deals', target: 18, period: 'quarter', label: 'Закрыть 18 сделок командой', pinned: true },
        { id: 'g_team_pipeline', metric: 'pipeline', target: 15000000, period: 'month', label: 'Пайплайн отдела 15 млн', pinned: false },
      ]
    },
    partner: { id: 'u_yusef',  name: 'Юсеф Хаддад',     role: 'Клубный партнёр', init: 'ЮХ' },
  };

  // Everyone a record can point at. `users` above is only the three switchable
  // roles; deals are also assigned to colleagues, and every one of those ids has
  // to resolve to a name — otherwise a question about the team hits a blank.
  const roster = [
    users.agent, users.manager, users.partner,
    { id: 'u_ahmed', name: 'Ахмед Саид',  role: 'Агент', init: 'АС' },
    { id: 'u_lina',  name: 'Лина Хаддад', role: 'Агент', init: 'ЛХ' },
  ];

  const clients = [
    {
      id: 'c_anna', name: 'Анна Петрова', tag: 'main', lang: 'RU', channel: 'whatsapp',
      consent: true, goal: 'Инвестиционная квартира', budget: 2000000,
      areas: ['Business Bay', 'Dubai Creek Harbour', 'JVC'], horizon: '1–3 месяца',
      note: 'Действующее согласие на сообщения. Активная история G1→G2→G3.',
      phone: '+971 55 0•• ••34 (DEMO)', viewed: [],
      // Психопрофиль = наблюдаемые сигналы стиля (не клиническая оценка); за согласием + человек в контуре.
      psych: { filled: true, decision: 'Аналитик — решает по цифрам и фактам', values: ['Доходность', 'Безопасность сделки'],
        pace: 'Размеренный — сравнивает варианты', risk: 'Умеренно осторожный',
        channel: 'WhatsApp, текст; голос — по договорённости', tone: 'По делу, с расчётами; без давления',
        triggers: ['График первого платежа', 'Подтверждённая доходность'], bestTime: 'Будни, вечер',
        source: 'выведено из переписки G1–G3 (сигналы стиля)' },
    },
    { id: 'c_lead15', name: 'Дмитрий Соколов', tag: 's15', lang: 'RU', channel: 'whatsapp', consent: true,
      goal: 'Инвестиционная квартира до 1,5 млн', budget: 1500000, areas: ['Дубай — район не указан'], horizon: 'не указан',
      note: 'Новый неквалифицированный лид. «Ищу инвестиционную квартиру в Дубае до 1,5 млн».', phone: '+971 52 •••• ••11 (DEMO)' },
    { id: 'c_night', name: 'Sarah Mansour', tag: 's14', lang: 'EN', channel: 'whatsapp', consent: true,
      goal: 'Квартира 1BR под аренду', budget: 1300000, areas: ['JVC', 'Business Bay'], horizon: '2–4 месяца',
      note: 'Ночное входящее в 02:14. Ожидает агента.', phone: '+971 50 •••• ••77 (DEMO)' },
    { id: 'c_overdue', name: 'Игорь Лебедев', tag: 's5', lang: 'RU', channel: 'whatsapp', consent: true,
      goal: 'Апартаменты под перепродажу', budget: 2400000, areas: ['Business Bay'], horizon: '1–2 месяца',
      note: 'Просроченное касание (обещали КП 12 мая).', phone: '+971 55 •••• ••02 (DEMO)',
      psych: { filled: true, decision: 'Статусный — важны престиж и «первым узнать»', values: ['Статус/престиж', 'Скорость'],
        pace: 'Быстрый — решает на эмоциях и эксклюзиве', risk: 'Готов к риску ради выгоды',
        channel: 'WhatsApp + звонок; любит голосовые', tone: 'Коротко, с эксклюзивом и срочностью',
        triggers: ['Эксклюзив/закрытый доступ', 'Ограниченность предложения'], bestTime: 'Утро',
        source: 'выведено из истории касаний (сигналы стиля)' } },
    { id: 'c_noconsent', name: 'Марат Ибрагимов', tag: 's13', lang: 'RU', channel: 'whatsapp', consent: false,
      goal: 'Квартира у воды', budget: 1800000, areas: ['Dubai Creek Harbour'], horizon: '3–6 месяцев',
      note: 'Нет действующего согласия — исключается из адресных отправок.', phone: '+971 54 •••• ••90 (DEMO)' },
    { id: 'c_ambig', name: 'Елена Крылова', tag: 'g3', lang: 'RU', channel: 'whatsapp', consent: true,
      goal: 'Две похожие активные сделки', budget: 2100000, areas: ['JVC', 'Business Bay'], horizon: '1–3 месяца',
      note: 'Две активные сделки — неоднозначная привязка заметки в G3.', phone: '+971 56 •••• ••45 (DEMO)' },
    { id: 'c_docs', name: 'Виктор Орлов', tag: 's4', lang: 'RU', channel: 'email', consent: true,
      goal: 'Готовится договор бронирования', budget: 1950000, areas: ['Dubai Creek Harbour'], horizon: 'сделка идёт',
      note: 'Документ в подготовке (S4).', phone: '+971 55 •••• ••28 (DEMO)' },
    { id: 'c_partner', name: 'Karim Aziz', tag: 's6', lang: 'EN', channel: 'whatsapp', consent: true,
      goal: 'Нужен внешний партнёр по объекту', budget: 2600000, areas: ['Downtown'], horizon: '1–2 месяца',
      note: 'Требуется подключение клубного партнёра (S6).', phone: '+971 50 •••• ••63 (DEMO)' },
    { id: 'c_owner', name: 'Сергей Орлов', tag: 'own', lang: 'RU', channel: 'email', consent: true,
      goal: 'Реализовать офисный блок в DIFC', budget: 12000000, areas: ['DIFC'], horizon: '3–6 месяцев',
      note: 'Управляющий портфелем Altura Capital. Собственник со стороны продажи — отдаёт блок на эксклюзив.',
      phone: '+971 4 401 9900 (DEMO)' },
  ];

  // `attrs` = качественные признаки для подбора и психо-мэтча (view/floor/finish/demand/prestige/metro)
  const objects = [
    { id: 'o_creekline', name: 'Creekline Residences, Unit 1208', source: 'agency',
      sourceLabel: 'Инвентарь агентства', area: 'Business Bay', price: 1820000, size: 82, br: '1BR',
      address: 'Business Bay, Creekline Residences, Tower B, Unit 1208', commissionPct: 2,
      availability: 'available', verified: 'verified', checkedAt: '12 мая 2026',
      trakheesi: 'ok', madmoun: 'ok',
      attrs: { view: 'city', floor: 'high', finish: 'new', demand: 'high', prestige: 'high', metro: true },
      match: 'Business Bay, в бюджете, проверенная доступность, инвестиционный профиль.',
      segment: 'off-plan', developer: 'Emaar Properties', project: 'Creekline Residences · Tower B',
      handover: 'Q4 2026', paymentPlan: '10% бронь · 40% в стройку · 50% на сдаче',
      serviceCharge: '16 AED/фт²·год', escrow: 'Escrow DLD · ADCB', occupancy: null },
    { id: 'o_palmcourt', name: 'Palm Court Residence, Unit 704', source: 'club',
      sourceLabel: 'Клубный эксклюзив', area: 'JVC', price: 1690000, size: 95, br: '1BR+',
      address: 'JVC, Palm Court Residence, District 12, Unit 704', commissionPct: 3,
      availability: 'available', verified: 'verified', checkedAt: '13 мая 2026',
      trakheesi: 'ok', madmoun: 'na',
      attrs: { view: 'garden', floor: 'mid', finish: 'new', demand: 'mid', prestige: 'mid', metro: false },
      match: 'JVC, ниже бюджета, клубный эксклюзив, высокая доходность аренды.',
      segment: 'готовое · вторичка', developer: 'Nakheel', project: 'Palm Court Residence · District 12',
      handover: null, paymentPlan: null, serviceCharge: '14 AED/фт²·год', escrow: null, occupancy: 'Свободна (vacant)' },
    { id: 'o_bayline', name: 'Bayline Terraces, Unit 1603', source: 'import',
      sourceLabel: 'Импорт застройщика', area: 'Dubai Creek Harbour', price: 1950000, size: 88, br: '1BR',
      address: 'Dubai Creek Harbour, Bayline Terraces, Unit 1603', commissionPct: 2.5,
      availability: 'stale', verified: 'expired', checkedAt: '2 апр 2026',
      trakheesi: 'pending', madmoun: 'na',
      attrs: { view: 'water', floor: 'high', finish: 'standard', demand: 'mid', prestige: 'high', metro: false },
      match: 'Dubai Creek Harbour, у верхней границы бюджета. Проверка доступности устарела.',
      segment: 'off-plan', developer: 'Emaar Properties', project: 'Bayline Terraces · Dubai Creek Harbour',
      handover: 'Q2 2027', paymentPlan: '20% бронь · 40% в стройку · 40% post-handover (2 года)',
      serviceCharge: '18 AED/фт²·год', escrow: 'Escrow DLD · Mashreq', occupancy: null },
  ];

  // Reference financial model (spec §12.2) — single source of truth for
  // screen, PDF and Excel. finance.js recomputes from these assumptions.
  const refModel = {
    objectId: 'o_creekline',
    price: 1820000,
    addCosts: 72800,
    rentY1: 125000,
    opexY1: 25000,
    rentGrowth: 0.03,       // 3% / year
    netFlows: [100000, 103750, 107612.50, 111590.88, 115688.60],
    exitNet: 2100000,       // net exit price end of year 5
    discount: 0.08,         // 8%
    expected: {
      grossYield: '6,87%',
      netYield: '5,28%',
      npv: '−35 849,18 AED',
      irr: '7,54%',
      roi5: '39,40%',
    },
  };

  // Deals — kanban across pipeline stages.
  // objectId — сделка по конкретному объекту (для фото/«живости»); agent — владелец
  // (для экранов руководителя); amount — сумма; hot — требует действия сейчас.
  // stage (new/work/docs/done) stays the engine spine. CRM gap v3 adds: funnel (R2),
  // structural fields + per-field provenance prov{field:'ai'|'confirmed'} (R3/A1),
  // stageDays (R12), companyId (R5), source for attribution (R9). Dubai taxonomy (§4).
  const deals = [
    { id: 'd_anna', clientId: 'c_anna', objectId: 'o_creekline', agent: 'u_marina', amount: 2000000, hot: true, stage: 'show',
      title: 'Инвест-квартира до 2 млн AED', sub: 'Инвест. квартира · до 2,0 млн AED', tags: ['G1'], updated: 'сегодня', createdAt: '14 мая',
      funnel: 'sale', dealType: 'Продажа', objectType: 'апартаменты', readiness: 'оффплан', saleKind: 'первичка', side: 'покупатель', goal: 'Инвестиция под аренду',
      paymentForm: 'Рассрочка от застройщика', vat: false, source: 'Instagram', partnerAgent: null, companyId: null,
      consideredProjects: ['Creekline Residences', 'Palm Court Residence'], stageDays: 0, requestId: 'r_anna',
      nextDue: 'сегодня 16:00', deposit: { kind: 'EOI', amount: 100000, paid: false, refundable: true },
      contacts: [
        { clientId: 'c_anna', role: 'Покупатель', rating: 'A', primary: true },
        { name: 'Пётр Петров', role: 'Супруг — со-решение', rating: 'B', phone: '+971 55 210 6642' },
      ],
      gates: { kyc: true },
      prov: { budget: 'confirmed', source: 'ai', paymentForm: 'ai', objectType: 'confirmed', goal: 'ai' } },
    { id: 'd_igor', clientId: 'c_overdue', objectId: 'o_bayline', agent: 'u_ahmed', amount: 2400000, hot: true, stage: 'work',
      title: 'Перепродажа Bayline Terraces', sub: 'Перепродажа · 2,4 млн AED', tags: ['касание просрочено'], updated: '2 дня назад', createdAt: '10 мая',
      funnel: 'sale', dealType: 'Продажа', objectType: 'апартаменты', readiness: 'готовый', saleKind: 'вторичка', side: 'покупатель', goal: 'Перепродажа',
      paymentForm: '100% оплата', vat: false, source: 'Реферал', partnerAgent: null, companyId: null,
      consideredProjects: ['Bayline Terraces'], stageDays: 6,
      nextDue: 'просрочено (касание)', deposit: { kind: 'EOI', amount: 50000, paid: true, at: '8 мая', refundable: true },
      gates: { kyc: true },
      prov: { budget: 'confirmed', source: 'confirmed', paymentForm: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_viktor', clientId: 'c_docs', objectId: 'o_bayline', agent: 'u_marina', amount: 1950000, hot: false, stage: 'book',
      title: 'Бронирование Bayline 1603', sub: 'Договор бронирования', tags: ['документ'], updated: 'вчера', createdAt: '10 мая',
      funnel: 'sale', dealType: 'Продажа', objectType: 'апартаменты', readiness: 'оффплан', saleKind: 'первичка', side: 'покупатель', goal: 'Инвестиция',
      paymentForm: 'Ипотека', vat: false, source: 'Property Finder', partnerAgent: null, companyId: 'co_emaar',
      consideredProjects: ['Bayline Terraces'], stageDays: 3, requestId: 'r_viktor',
      nextDue: '12 мая', deposit: { kind: 'Бронирование (booking)', amount: 97500, paid: true, at: '6 мая', refundable: false },
      gates: { kyc: true, escrow: true, spa: true },
      prov: { budget: 'confirmed', source: 'confirmed', paymentForm: 'ai', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_karim', clientId: 'c_partner', objectId: 'o_palmcourt', agent: 'u_lina', amount: 2600000, hot: false, stage: 'req',
      title: 'Резиденция в Downtown через партнёра', sub: 'Downtown · нужен партнёр', tags: ['партнёр'], updated: 'сегодня', createdAt: '14 мая',
      funnel: 'cross', dealType: 'Кросс-продажи', objectType: 'апартаменты', readiness: 'готовый', saleKind: '', side: 'покупатель', goal: 'Покупка резиденции',
      paymentForm: '100% оплата', vat: true, source: 'Клуб', partnerAgent: 'u_yusef', companyId: 'co_altura',
      consideredProjects: ['Downtown Views II'], stageDays: 1,
      contacts: [
        { clientId: 'c_partner', role: 'Инвестор', rating: 'A', primary: true },
        { name: 'Rana Said', role: 'ЛПР — фонд Altura', rating: 'A', phone: '+971 4 512 8890' },
        { name: 'Omar Khalil', role: 'Юрист сделки', rating: 'C', phone: '+971 50 771 2003' },
      ],
      prov: { budget: 'ai', source: 'confirmed', paymentForm: 'confirmed', objectType: 'confirmed', goal: 'ai' } },
    { id: 'd_lease', clientId: 'c_night', objectId: 'o_palmcourt', agent: 'u_marina', amount: 95000, hot: false, stage: 'pick',
      title: 'Аренда 1BR в JVC', sub: 'Аренда 1BR · JVC', tags: ['ночной лид'], updated: 'сегодня', createdAt: '14 мая',
      funnel: 'rent', dealType: 'Аренда', objectType: 'апартаменты', readiness: 'готовый', saleKind: '', side: 'арендатор', goal: 'Аренда под проживание',
      paymentForm: 'Годовой чек', vat: false, source: 'Bayut', partnerAgent: null, companyId: null,
      consideredProjects: ['Palm Court Residence'], stageDays: 0,
      gates: { kyc: true },
      prov: { budget: 'ai', source: 'ai', objectType: 'ai', goal: 'ai' } },
    { id: 'd_fitout', clientId: 'c_ambig', objectId: 'o_creekline', agent: 'u_lina', amount: 320000, hot: false, stage: 'kp',
      title: 'Fit-out офиса в Business Bay', sub: 'Fit-out офиса · Business Bay', tags: ['fit-out'], updated: '3 дня назад', createdAt: '09 мая',
      funnel: 'cross', dealType: 'Кросс-продажи', objectType: 'офис', readiness: 'готовый', saleKind: '', side: 'собственник', goal: 'Отделка под аренду',
      paymentForm: 'Поэтапно', vat: true, source: 'Реферал', partnerAgent: null, companyId: 'co_meydan',
      consideredProjects: [], stageDays: 4,
      prov: { budget: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_rentbiz', clientId: 'c_docs', objectId: 'o_bayline', agent: 'u_omar', amount: 4200000, hot: false, stage: 'prep',
      title: 'Готовый арендный бизнес в DIFC', sub: 'Готовый арендный бизнес · DIFC', tags: ['портфель'], updated: 'вчера', createdAt: '11 мая',
      funnel: 'sale', dealType: 'Продажа', objectType: 'ГАБ', readiness: 'готовый', saleKind: 'вторичка', side: 'покупатель', goal: 'Доходный актив',
      paymentForm: '100% оплата', vat: true, source: 'Клуб', partnerAgent: null, companyId: 'co_altura',
      consideredProjects: ['DIFC Gate District'], stageDays: 2, requestId: 'r_viktor', lots: ['o_bayline', 'o_creekline'],
      gates: { kyc: true, title: true, leases: true },
      prov: { budget: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_won', clientId: 'c_anna', objectId: 'o_palmcourt', agent: 'u_marina', amount: 1750000, hot: false, stage: 'won',
      title: 'Покупка Palm Court 704', sub: 'Продажа · первичка · закрыта', tags: ['успех'], updated: '6 мая', createdAt: '18 апреля',
      funnel: 'sale', dealType: 'Продажа', objectType: 'апартаменты', readiness: 'оффплан', saleKind: 'первичка', side: 'покупатель', goal: 'Инвестиция под аренду',
      paymentForm: 'Рассрочка от застройщика', vat: false, source: 'Instagram', partnerAgent: null, companyId: 'co_emaar',
      consideredProjects: ['Palm Court Residence'], stageDays: 8,
      gates: { kyc: true, escrow: true, spa: true, oqood: true, dld4: true },
      prov: { budget: 'confirmed', source: 'confirmed', paymentForm: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_manage', clientId: 'c_ambig', objectId: null, agent: 'u_lina', amount: 480000, hot: false, stage: 'visit',
      title: 'Офис в Business Bay в управление', sub: 'Управление арендой · годовой чек', tags: ['управление'], updated: 'вчера', createdAt: '12 мая',
      funnel: 'manage', dealType: 'Управление арендой', objectType: 'офис', readiness: 'готовый', saleKind: '', side: 'собственник', goal: 'Сдать после отделки',
      paymentForm: 'Процент от аренды', vat: true, source: 'Реферал', partnerAgent: null, companyId: 'co_meydan',
      consideredProjects: [], stageDays: 2,
      prov: { budget: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_exclusive', clientId: 'c_owner', objectId: null, agent: 'u_omar', amount: 12000000, hot: false, stage: 'kp',
      title: 'Эксклюзив на офисный блок в DIFC', sub: 'Мандат на реализацию · DIFC', tags: ['мандат'], updated: '2 дня назад', createdAt: '09 мая',
      funnel: 'exclusive', dealType: 'Эксклюзив', objectType: 'офис', readiness: 'готовый', saleKind: '', side: 'собственник', goal: 'Реализовать блок',
      paymentForm: 'Комиссия с реализации', vat: true, source: 'Клуб', partnerAgent: null, companyId: 'co_altura',
      consideredProjects: [], stageDays: 3,
      gates: { kyc: true, mandate: false },
      prov: { budget: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
    { id: 'd_consult', clientId: 'c_docs', objectId: null, agent: 'u_marina', amount: 45000, hot: false, stage: 'talks',
      title: 'Юридическая проверка портфеля DIFC', sub: 'Консалтинг · разовый гонорар', tags: ['консалтинг'], updated: 'вчера', createdAt: '12 мая',
      funnel: 'consult', dealType: 'Консалтинг', objectType: 'офис', readiness: 'готовый', saleKind: '', side: 'покупатель', goal: 'Проверить документы перед покупкой',
      paymentForm: '100% предоплата', vat: true, source: 'Реферал', partnerAgent: null, companyId: 'co_altura',
      consideredProjects: [], stageDays: 1,
      prov: { budget: 'confirmed', source: 'confirmed', objectType: 'confirmed', goal: 'confirmed' } },
  ];

  // Requests (Part B / V2) — the client inquiry that GROUPS deals. One request → many deals
  // (one contract = one deal); several units under one contract stay as lots inside a deal.
  // A request is the working funnel head: brief attributes + offered objects (each with a client
  // selection state) + an optional КП. Client picks → deals are created from the selected objects.
  const requests = [
    { id: 'r_anna', clientId: 'c_anna', title: 'Инвест-квартира до 2 млн', createdAt: '06 мая', channel: 'whatsapp',
      interest: 'Покупка', paymentForm: 'Рассрочка от застройщика', vat: false, source: 'Входящий звонок', partnerAgent: null,
      dealType: 'Продажа · off-plan', objectType: 'Квартира', bedrooms: '1–2 BR', goal: 'Инвестиция под аренду', budget: 2000000,
      areas: ['Business Bay', 'Dubai Creek Harbour', 'JVC'], horizon: '1–3 месяца',
      assignee: 'u_marina', leadStatus: 'Квалифицирован', temperature: 'hot', nextContact: 'сегодня, 16:00', funding: 'Подтв. средств ✓ · рассрочка застройщика',
      offered: [
        { id: 'o_creekline', state: 'selected' },
        { id: 'o_palmcourt', state: 'rejected', reason: 'JVC не подошёл — хочет ближе к центру' },
        { id: 'o_bayline', state: 'offered' },
      ],
      kp: { formed: true, at: '08 мая', objectIds: ['o_creekline', 'o_bayline'] },
      note: 'Голосовое из WhatsApp; предложено 3 объекта, клиент выбрал Creekline.' },
    { id: 'r_viktor', clientId: 'c_docs', title: 'Квартира Bayline + портфель DIFC', createdAt: '04 мая', channel: 'email',
      interest: 'Покупка', paymentForm: '100% оплата', vat: true, source: 'Реферал', partnerAgent: null,
      dealType: 'Инвестиция · портфель', objectType: 'Квартира + портфель', bedrooms: '1BR + офисы', goal: 'Инвестиция', budget: 6150000,
      areas: ['Dubai Creek Harbour', 'DIFC'], horizon: 'сделка идёт',
      assignee: 'u_marina', leadStatus: 'В переговорах', temperature: 'warm', nextContact: '12 мая, 11:00', funding: 'Cash 100% · подтв. средств ✓',
      offered: [
        { id: 'o_bayline', state: 'selected' },
        { id: 'o_creekline', state: 'selected' },
      ],
      kp: { formed: true, at: '05 мая', objectIds: ['o_bayline', 'o_creekline'] },
      note: 'Одна заявка → две сделки: бронирование Bayline (свой договор) и портфель DIFC на 2 лота (свой договор).' },
  ];

  // Funnels (R2) — each is the same 4-column board; columns = milestone projection of that funnel.
  // Layer 1 of the agreed model (docs/2026-08-14-deal-funnels-preview.md): a funnel is the SERVICE
  // we sell, never the product we sell it on. Object type, readiness and the kind of transfer are
  // CARD FIELDS — they light the gates of layer 2 instead of multiplying boards, which is exactly
  // what the previous six funnels did (off-plan / готовое / ГАБ were three boards for one service).
  //
  // Stage keys are one shared vocabulary; each funnel picks its own subset in its own order, so a
  // deal that changes service keeps any stage the new funnel also has.
  const STAGE_LABELS = {
    work: 'В работе',
    pick: 'Направлен подбор',
    kp: 'Направлено КП',
    req: 'Заявка партнёру',
    show: 'Показ',
    visit: 'Встреча / осмотр',
    talks: 'Переговоры',
    prep: 'Подготовка к сделке',
    book: 'Бронь (EOI)',
    sign: 'Подписание / оплата',
    reg: 'Регистрация',
    exec: 'Выполнение работ',
    won: 'Успех',
    lost: 'Проигрыш',
  };
  // `won` and `lost` are terminal in every funnel and always sit last, in that order — the board
  // and the stage stepper both rely on it.
  const FUNNELS = [
    { k: 'sale', label: 'Продажа', side: 'покупатель', contract: 'sale',
      stages: ['work', 'pick', 'show', 'talks', 'prep', 'book', 'sign', 'reg', 'won', 'lost'] },
    { k: 'rent', label: 'Аренда', side: 'арендатор', contract: 'lease',
      stages: ['work', 'pick', 'show', 'talks', 'prep', 'sign', 'reg', 'won', 'lost'] },
    { k: 'manage', label: 'Управление арендой', side: 'собственник', contract: 'management',
      stages: ['work', 'kp', 'visit', 'talks', 'prep', 'sign', 'won', 'lost'] },
    { k: 'exclusive', label: 'Эксклюзив', side: 'собственник', contract: 'exclusive',
      stages: ['work', 'kp', 'talks', 'prep', 'sign', 'won', 'lost'] },
    { k: 'cross', label: 'Кросс-продажи', side: '', contract: 'service',
      stages: ['work', 'req', 'kp', 'talks', 'prep', 'sign', 'won', 'lost'] },
    { k: 'consult', label: 'Консалтинг', side: '', contract: 'service',
      stages: ['work', 'kp', 'talks', 'prep', 'sign', 'exec', 'won', 'lost'] },
  ];

  // Companies (R5, A10) — entity above contacts/deals; carries KYC STATUS (not a rating).
  const companies = [
    { id: 'co_emaar', name: 'Emaar Properties', kind: 'Застройщик', kyc: 'verified', note: 'Крупный застройщик, эскроу-счета DLD.',
      trn: '100 4567 8901 0003', license: 'DLD · застройщик', address: 'Downtown Dubai, Emaar Square, Building 3', contactPerson: 'Fatima Al Nuaimi', contactRole: 'Broker Relations Director', phone: '+971 4 367 3333', email: 'brokers@emaar.ae', commission: '2–4% off-plan · выплата от застройщика · эскроу DLD', escrow: true,
      people: [
        { name: 'Fatima Al Nuaimi', role: 'Директор по работе с брокерами', decision: 'ЛПР', phone: '+971 4 367 3333', email: 'fatima@emaar.ae', channel: 'email', primary: true, note: 'Согласование аллокации и условия co-broking' },
        { name: 'Mohammed Al Mazrouei', role: 'Менеджер проектов', decision: 'влияет', phone: '+971 50 123 4456', email: 'mohamm@emaar.ae', channel: 'whatsapp', note: 'Сроки поставки, изменения в плане' },
        { name: 'Layla Al Mansouri', role: 'Юрист проекта', decision: 'исполнитель', phone: '+971 4 367 3400', email: 'layla.mansouri@emaar.ae', channel: 'email', note: 'Документооборот, контракты' },
        { name: 'Rashid Al Ketbi', role: 'Финансовый контроллер', decision: 'влияет', phone: '+971 50 234 5678', email: 'rashid.ketbi@emaar.ae', channel: 'email', note: 'Условия оплаты и комиссии' },
      ] },
    { id: 'co_altura', name: 'Altura Capital', kind: 'Фонд', kyc: 'verified', note: 'Инвестфонд, портфельные сделки.',
      trn: '100 7789 2210 0007', license: 'DIFC · инвестиционный фонд', address: 'DIFC, Gate Village 4', contactPerson: 'Сергей Орлов', contactRole: 'Portfolio Manager', phone: '+971 4 401 9900', email: 's.orlov@altura.capital', commission: 'по договору · портфельные закрытия', escrow: false,
      people: [
        { name: 'Сергей Орлов', role: 'Менеджер портфеля', decision: 'ЛПР', phone: '+971 4 401 9900', email: 's.orlov@altura.capital', channel: 'email', primary: true, note: 'Утверждение сделок, условия инвестиций' },
        { name: 'Natasha Volkova', role: 'Аналитик инвестиций', decision: 'влияет', phone: '+971 50 345 6789', email: 'n.volkova@altura.capital', channel: 'whatsapp', note: 'Оценка доходности, финмодели' },
        { name: 'Dr. Omar Al Shami', role: 'Генеральный партнёр', decision: 'ЛПР', phone: '+971 4 401 9901', email: 'o.alshami@altura.capital', channel: 'email', note: 'Стратегические решения, мегасделки' },
      ] },
    { id: 'co_meydan', name: 'Meydan Group', kind: 'Корпоративный клиент', kyc: 'pending', note: 'Корпоративный арендатор, проверка KYC идёт.',
      trn: '—', license: 'DED · трейд-лицензия', address: 'Meydan, Nad Al Sheba', contactPerson: 'Ahmed Rashid', contactRole: 'Procurement Lead', phone: '+971 4 381 3700', email: 'procurement@meydan.ae', commission: 'аренда · годовой чек', escrow: false,
      people: [
        { name: 'Ahmed Rashid', role: 'Начальник закупок', decision: 'ЛПР', phone: '+971 4 381 3700', email: 'ahmed.rashid@meydan.ae', channel: 'whatsapp', primary: true, note: 'Согласование аренды, переговоры' },
        { name: 'Khalil Al Shami', role: 'Операционный директор', decision: 'ЛПР', phone: '+971 50 456 7890', email: 'khalil@meydan.ae', channel: 'email', note: 'Утверждение бюджетов, сроков' },
        { name: 'Fatima Al Dhaheri', role: 'Администратор объектов', decision: 'исполнитель', phone: '+971 4 381 3800', email: 'fatima.dhaheri@meydan.ae', channel: 'whatsapp', note: 'Обслуживание, коммунальные платежи' },
      ] },
    { id: 'co_harbour', name: 'Harbour Key Realty', kind: 'Агентство', kyc: 'verified', note: 'Наше агентство.',
      trn: '100 2231 4456 0001', license: 'RERA ORN 28114', address: 'Business Bay, Bay Square, Building 10', contactPerson: 'Марина Волкова', contactRole: 'Managing Broker', phone: '+971 50 118 2244', email: 'marina@harbourkey.ae', commission: 'co-broking 50 / 50', escrow: false,
      people: [
        { name: 'Марина Волкова', role: 'Управляющий брокер', decision: 'ЛПР', phone: '+971 50 118 2244', email: 'marina@harbourkey.ae', channel: 'whatsapp', primary: true, note: 'Основной контакт, координация сделок' },
        { name: 'Омар Рахман', role: 'Старший агент', decision: 'влияет', phone: '+971 50 447 2210', email: 'omar@harbourkey.ae', channel: 'whatsapp', note: 'Крупные сделки, переговоры' },
        { name: 'Лина Хассан', role: 'Операционный менеджер', decision: 'исполнитель', phone: '+971 50 556 7890', email: 'lina@harbourkey.ae', channel: 'email', note: 'Документооборот, отчётность' },
      ] },
  ];

  // Per-deal timeline (R4) — channel history. kind:'raw' immutable source event; 'note' editable;
  // 'ai' agent-written. capture:true = call/message recording (consent-gated, A7).
  // `ord` = sort key DDHHMM (demo week is 11–17 мая, "сегодня" = 14 мая). Ordering metadata only:
  // the deal card renders in array order; the contact feed merges channels and sorts on `ord`.
  const dealTimeline = {
    d_anna: [
      { at: '14 мая · 09:05', ord: 140905, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Голосовое: ищу инвест-квартиру до 2 млн, Business Bay.', capture: true },
      { at: '14 мая · 09:12', ord: 140912, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Извлечены параметры заявки, создана сделка (уверенность 0,86).' },
      { at: '14 мая · 09:20', ord: 140920, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Просила график первого платежа — приоритет доходность.' },
      { at: '14 мая · 09:25', ord: 140925, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Назначить показ Creekline 1208 на сегодня 16:00, подтвердить с клиентом.' },
      { at: '14 мая · 09:30', ord: 140930, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Показ добавлен в календарь на 16:00; клиент подтвердил в WhatsApp.' },
    ],
    d_igor: [
      { at: '10 мая · 11:00', ord: 101100, ch: 'call', kind: 'raw', by: 'Агент', text: 'Звонок 4:12 — обсудили перепродажу Bayline.', capture: true },
      { at: '12 мая', ord: 120000, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Обещано КП 12 мая — не отправлено. Касание просрочено.' },
    ],
    d_viktor: [
      { at: '10 мая · 10:30', ord: 101030, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча в офисе Emaar — подписан лист бронирования Bayline Terraces.', capture: true },
      { at: '11 мая · 14:00', ord: 111400, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'Направлен MOU (договор о намерениях) на согласование клиенту.' },
      { at: '12 мая · 11:20', ord: 121120, ch: 'call', kind: 'raw', by: 'Клиент', text: 'Звонок 4:30 — MOU согласован, подаёмся на ипотеку в Emirates NBD.', capture: true },
      { at: '13 мая · 09:45', ord: 130945, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Банк запросил подтверждение дохода — поставлена задача агенту собрать пакет.' },
      { at: '13 мая · 15:30', ord: 131530, ch: 'email', kind: 'raw', by: 'Агент', text: 'Отправлен черновик договора бронирования.', capture: true },
      { at: '13 мая · 16:10', ord: 131610, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Ждём подтверждение ипотеки от банка.' },
    ],
    d_karim: [
      { at: '14 мая · 08:40', ord: 140840, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Нужен объект в Downtown, бюджет до 2,6 млн.', capture: true },
      { at: '14 мая · 09:00', ord: 140900, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Своего инвентаря нет — предложено подключить клубного партнёра.' },
    ],
    d_lease: [
      { at: '14 мая · 02:14', ord: 140214, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Ночное сообщение: ищу 1BR в JVC под аренду, бюджет до 95 тыс. в год.', capture: true },
      { at: '14 мая · 07:30', ord: 140730, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Ночная заявка квалифицирована: аренда 1BR, JVC, годовой чек. Заведена сделка.' },
      { at: '14 мая · 08:05', ord: 140805, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Клиент пишет по-английски — отвечать на английском.' },
    ],
    d_fitout: [
      { at: '09 мая · 12:20', ord: 91220, ch: 'call', kind: 'raw', by: 'Агент', text: 'Звонок 6:40 — отделка офиса 210 м² под сдачу в аренду.', capture: true },
      { at: '10 мая · 10:15', ord: 101015, ch: 'email', kind: 'raw', by: 'Агент', text: 'Отправлена смета fit-out по трём подрядчикам.' },
      { at: '11 мая · 17:40', ord: 111740, ch: 'note', kind: 'note', by: 'Лина Хассан', text: 'Просит поэтапную оплату — согласовать с Meydan.' },
    ],
    d_won: [
      { at: '18 апреля · 11:00', ord: 181100, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча — выбрана студия Palm Court 704, рассрочка 60/40.', capture: true },
      { at: '28 апреля · 16:20', ord: 281620, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'SPA подписан, первый платёж на escrow подтверждён застройщиком.' },
      { at: '06 мая · 12:40', ord: 61240, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Регистрация Oqood прошла, пошлина DLD уплачена — сделка закрыта успехом, открыт договор.' },
    ],
    d_manage: [
      { at: '12 мая · 10:20', ord: 121020, ch: 'call', kind: 'raw', by: 'Лина Хассан', text: 'Звонок 5:30 — после отделки офис уходит в аренду, просят вести объект.', capture: true },
      { at: '12 мая · 15:40', ord: 121540, ch: 'email', kind: 'raw', by: 'Лина Хассан', text: 'Отправлено КП на управление: ставка, отчётность, контроль оплат.' },
      { at: '13 мая · 11:05', ord: 131105, ch: 'note', kind: 'note', by: 'Лина Хассан', text: 'Осмотр назначен — уточнить границы полномочий по доверенности.' },
    ],
    d_exclusive: [
      { at: '09 мая · 14:15', ord: 91415, ch: 'meet', kind: 'raw', by: 'Омар Рахман', text: 'Встреча в DIFC — фонд готов отдать блок на эксклюзив.', capture: true },
      { at: '10 мая · 09:50', ord: 100950, ch: 'email', kind: 'raw', by: 'Омар Рахман', text: 'Отправлены условия мандата: срок, маркетинг, партнёрская сеть.' },
      { at: '12 мая · 16:30', ord: 121630, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Для рекламы блока понадобится Trakheesi — разрешение ещё не запрошено.' },
    ],
    d_consult: [
      { at: '12 мая · 09:30', ord: 120930, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Звонок 3:40 — просят проверить договоры аренды по портфелю до сделки.', capture: true },
      { at: '12 мая · 18:00', ord: 121800, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'Отправлено КП на юридическую проверку: объём, срок, гонорар.' },
      { at: '13 мая · 12:45', ord: 131245, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Согласовать объём: только договоры аренды или ещё долги по service charge.' },
    ],
    d_rentbiz: [
      { at: '11 мая · 09:50', ord: 110950, ch: 'email', kind: 'raw', by: 'Клиент', text: 'Запрос по готовому арендному бизнесу в DIFC — интересует доходность.', capture: true },
      { at: '12 мая · 14:05', ord: 121405, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Собрана финмодель по DIFC Gate District: доходность и срок окупаемости.' },
      { at: '13 мая · 11:30', ord: 131130, ch: 'note', kind: 'note', by: 'Омар Рахман', text: 'Пакет на проверку — ждём подтверждение действующих арендных договоров.' },
    ],
  };

  // Per-company timeline — company-level events (соглашения, комиссия, KYC, встречи с представителем).
  // Deal-level channel history is merged in at render time, same as for contacts.
  const companyTimeline = {
    co_emaar: [
      { at: '02 мая · 11:00', ord: 21100, ch: 'crm', kind: 'raw', by: 'Система', text: 'Компания заведена: застройщик, эскроу-счета DLD.' },
      { at: '05 мая · 15:20', ord: 51520, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча с Fatima Al Nuaimi — аллокация в Bayline Terraces.', person: 0 },
      { at: '07 мая · 10:40', ord: 71040, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'Получен прайс-лист и график платежей по проекту.' },
      { at: '11 мая · 09:30', ord: 110930, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Комиссия 4% подтверждена на квартал — фиксируем в сделках.', person: 3 },
    ],
    co_altura: [
      { at: '04 мая · 13:15', ord: 41315, ch: 'crm', kind: 'raw', by: 'Система', text: 'Компания заведена: инвестфонд DIFC, портфельные сделки.' },
      { at: '09 мая · 16:00', ord: 91600, ch: 'call', kind: 'raw', by: 'Лина Хассан', text: 'Звонок 12:30 — мандат фонда на доходные активы в DIFC.', capture: true, person: 0 },
      { at: '12 мая · 11:45', ord: 121145, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Два запроса фонда сведены в один портфель — предложено вести как пакет.' },
    ],
    co_meydan: [
      { at: '06 мая · 09:50', ord: 60950, ch: 'crm', kind: 'raw', by: 'Система', text: 'Компания заведена: корпоративный арендатор.' },
      { at: '06 мая · 10:05', ord: 61005, ch: 'crm', kind: 'raw', by: 'Система', text: 'KYC на проверке: TRN не предоставлен.' },
      { at: '10 мая · 14:30', ord: 101430, ch: 'meet', kind: 'raw', by: 'Лина Хассан', text: 'Встреча с Ahmed Rashid — требования к отделке офиса.' },
    ],
    co_harbour: [
      { at: '01 мая · 09:00', ord: 10900, ch: 'crm', kind: 'raw', by: 'Система', text: 'Наше агентство: RERA ORN 28114, тенант демо-стенда.' },
      { at: '08 мая · 18:20', ord: 81820, ch: 'note', kind: 'note', by: 'Омар Рахман', text: 'Со-брокинг 50/50 — базовые условия для партнёрских сделок.' },
    ],
  };

  // Per-contact timeline — the contact-level event feed (создание, согласие, звонки, встречи, заметки).
  // Deal-level channel history is NOT duplicated here: the contact feed merges `dealTimeline` of the
  // contact's deals at render time. Same entry shape as dealTimeline; `ch: 'meet'|'crm'` are contact-only.
  const contactTimeline = {
    c_anna: [
      { at: '06 мая · 18:40', ord: 61840, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт создан из Instagram Direct.' },
      { at: '07 мая · 10:15', ord: 71015, ch: 'crm', kind: 'raw', by: 'Система', text: 'Получено согласие на переписку (PDPL).' },
      { at: '08 мая · 19:05', ord: 81905, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Первичный разговор 8:30 — цель инвестиция, горизонт 1–3 месяца.', capture: true },
      { at: '11 мая · 12:00', ord: 111200, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча в офисе — разобрали подборку по Business Bay.' },
      { at: '13 мая · 20:10', ord: 132010, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Считать доходность в AED — в долларах путается.' },
    ],
    c_lead15: [
      { at: '14 мая · 07:50', ord: 140750, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Ищу инвестиционную квартиру в Дубае до 1,5 млн.', capture: true },
      { at: '14 мая · 07:52', ord: 140752, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Лид не квалифицирован: не указаны район и срок. Поставлена задача уточнить.' },
    ],
    c_night: [
      { at: '13 мая · 22:05', ord: 132205, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт создан из заявки на Bayut.' },
      { at: '14 мая · 07:28', ord: 140728, ch: 'crm', kind: 'raw', by: 'Система', text: 'Согласие на переписку получено при первом контакте.' },
    ],
    c_overdue: [
      { at: '03 мая · 16:20', ord: 31620, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт создан по реферальной рекомендации.' },
      { at: '05 мая · 11:40', ord: 51140, ch: 'call', kind: 'raw', by: 'Ахмед Салех', text: 'Знакомство 5:10 — интересует перепродажа, важен эксклюзивный доступ.', capture: true },
      { at: '08 мая · 09:15', ord: 80915, ch: 'meet', kind: 'raw', by: 'Ахмед Салех', text: 'Встреча в Business Bay — смотрели Bayline Terraces.' },
      { at: '14 мая · 08:00', ord: 140800, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Касание просрочено на 2 дня — сделка поднята руководителю.' },
    ],
    c_noconsent: [
      { at: '09 мая · 13:30', ord: 91330, ch: 'crm', kind: 'raw', by: 'Марина Волкова', text: 'Контакт заведён вручную после звонка на общий номер.' },
      { at: '09 мая · 13:35', ord: 91335, ch: 'crm', kind: 'raw', by: 'Система', text: 'Согласие не оформлено — контакт исключён из адресных отправок.' },
      { at: '12 мая · 10:00', ord: 121000, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Звонок 2:05 — просил варианты у воды; согласие всё ещё не подписано.', capture: true },
    ],
    c_ambig: [
      { at: '07 мая · 15:10', ord: 71510, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт создан по реферальной рекомендации.' },
      { at: '08 мая · 11:25', ord: 81125, ch: 'meet', kind: 'raw', by: 'Лина Хассан', text: 'Осмотр помещения в Business Bay — 210 м², под сдачу.' },
      { at: '13 мая · 09:40', ord: 130940, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Заметка из переписки не привязалась однозначно — подтвердите сделку.' },
    ],
    c_docs: [
      { at: '04 мая · 10:05', ord: 41005, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт создан из заявки на Property Finder.' },
      { at: '06 мая · 14:50', ord: 61450, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Звонок 7:20 — ипотека, нужно предодобрение банка.', capture: true },
      { at: '09 мая · 16:30', ord: 91630, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча — подписан лист бронирования по Bayline Terraces.' },
      { at: '11 мая · 15:00', ord: 111500, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Предпочитает email; звонки после 18:00. По-русски, документы — на английском.' },
    ],
    c_owner: [
      { at: '08 мая · 16:40', ord: 81640, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт заведён из клубного канала: собственник со стороны продажи.' },
      { at: '09 мая · 09:20', ord: 90920, ch: 'crm', kind: 'raw', by: 'Система', text: 'Согласие на переписку получено при первом контакте.' },
      { at: '13 мая · 10:15', ord: 131015, ch: 'note', kind: 'note', by: 'Омар Рахман', text: 'Готов к эксклюзиву на 6 месяцев, но хочет право отзыва мандата — обсудить с юристом.' },
    ],
    c_partner: [
      { at: '12 мая · 10:30', ord: 121030, ch: 'crm', kind: 'raw', by: 'Система', text: 'Контакт пришёл из клубного канала.' },
      { at: '13 мая · 18:15', ord: 131815, ch: 'meet', kind: 'raw', by: 'Лина Хассан', text: 'Встреча с представителем фонда Altura — обсудили Downtown.' },
    ],
  };


  // Contract kinds and their milestone spines. `client` is the wording a client may be shown; a
  // milestone with `internalOnly` never leaves our side however the cabinet is built.
  const CONTRACT_KINDS = {
    offplan_spa: { label: 'Купля-продажа · оффплан (SPA)', icon: 'building' },
    resale_title: { label: 'Купля-продажа · вторичка', icon: 'building' },
    lease: { label: 'Аренда жилая (Ejari)', icon: 'doc' },
    lease_comm: { label: 'Аренда коммерческая', icon: 'doc' },
    management: { label: 'Управление объектом', icon: 'briefcase' },
    exclusive: { label: 'Эксклюзивный мандат', icon: 'star' },
    service: { label: 'Услуга партнёра', icon: 'handshake' },
  };
  const contracts = [
    {
      id: 'k_palm', dealId: 'd_won', clientId: 'c_anna', companyId: 'co_emaar', objectId: 'o_palmcourt',
      kind: 'offplan_spa', number: 'SPA-2026-0418', signedAt: '28 апреля', status: 'active',
      amount: 1750000, nextDue: 'платёж 25% — до 20 июня',
      milestones: [
        { k: 'active', label: 'Договор активен', client: 'Договор подписан и вступил в силу', at: '28 апреля', state: 'done' },
        { k: 'pay10', label: 'Платёж 10% на escrow', client: 'Первый платёж принят застройщиком', at: '28 апреля', state: 'done' },
        { k: 'oqood', label: 'Регистрация Oqood', client: 'Сделка зарегистрирована в реестре DLD', at: '06 мая', state: 'done' },
        { k: 'pay25', label: 'Платёж 25% по графику', client: 'Ожидается платёж по графику — этап 2 из 4', at: 'до 20 июня', state: 'now' },
        { k: 'built', label: 'Объект построен', client: 'Строительство завершено', at: 'IV квартал 2027', state: 'wait' },
        { k: 'keys', label: 'Ключи переданы, snag list закрыт', client: 'Приёмка объекта и передача ключей', at: '—', state: 'wait' },
        { k: 'title', label: 'Title Deed получен', client: 'Право собственности оформлено', at: '—', state: 'wait' },
      ],
      commission: { total: 70000, payer: 'застройщик', vat: false, split: null,
        entries: [
          { k: 'accrued', label: 'Начислено', amount: 70000, at: '06 мая', state: 'done' },
          { k: 'invoiced', label: 'Выставлен счёт', amount: 70000, at: '07 мая', state: 'done' },
          { k: 'paid', label: 'Оплачено', amount: 35000, at: '13 мая · первый транш', state: 'now' },
        ] },
      timeline: [
        { at: '28 апреля · 16:20', ord: 281620, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'SPA подписан, escrow подтверждён.' },
        { at: '06 мая · 12:40', ord: 61240, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Oqood зарегистрирован — договор переведён на график платежей.' },
        { at: '13 мая · 10:05', ord: 131005, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Застройщик заплатил половину комиссии; остаток обещан после платежа 25%.' },
      ],
    },
    {
      id: 'k_jvc', dealId: null, clientId: 'c_night', companyId: null, objectId: 'o_creekline',
      kind: 'lease', number: 'EJARI-2026-1180', signedAt: '02 марта', status: 'active',
      amount: 95000, nextDue: 'уведомление о продлении — до 02 декабря',
      milestones: [
        { k: 'active', label: 'Договор активен', client: 'Договор аренды зарегистрирован в Ejari', at: '02 марта', state: 'done' },
        { k: 'cheques', label: 'Оплата по чекам — 2 из 4', client: 'Оплата по графику: принято 2 платежа из 4', at: '02 июня — следующий', state: 'now' },
        { k: 'renewal', label: 'Уведомление за 90 дней', client: 'Подготовка к продлению договора', at: 'до 02 декабря', state: 'wait' },
        { k: 'closed', label: 'Продлён либо выезд и возврат депозита', client: 'Продление или завершение аренды', at: '—', state: 'wait' },
      ],
      commission: { total: 4750, payer: 'арендатор', vat: true, split: null,
        entries: [
          { k: 'accrued', label: 'Начислено', amount: 4750, at: '02 марта', state: 'done' },
          { k: 'invoiced', label: 'Выставлен счёт', amount: 4750, at: '02 марта', state: 'done' },
          { k: 'paid', label: 'Оплачено', amount: 4750, at: '05 марта', state: 'done' },
        ] },
      timeline: [
        { at: '02 марта · 14:00', ord: 21400, ch: 'crm', kind: 'raw', by: 'Система', text: 'Договор аренды зарегистрирован в Ejari, депозит принят.' },
        { at: '02 мая · 09:30', ord: 20930, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Второй чек проведён; следующий — 02 июня, поставлено напоминание.' },
      ],
    },
    {
      id: 'k_meydan', dealId: null, clientId: 'c_ambig', companyId: 'co_meydan', objectId: null,
      kind: 'management', number: 'MGMT-2026-0221', signedAt: '21 февраля', status: 'active',
      amount: 520000, nextDue: 'отчёт собственнику — до 31 мая',
      milestones: [
        { k: 'active', label: 'Договор управления активен', client: 'Объект принят в управление', at: '21 февраля', state: 'done' },
        { k: 'tenant', label: 'Арендатор найден', client: 'Найден арендатор, условия согласованы', at: '19 марта', state: 'done' },
        { k: 'movein', label: 'Заселение', client: 'Арендатор заселён', at: '01 апреля', state: 'done' },
        { k: 'payments', label: 'Контроль оплат от арендатора', client: 'Платежи поступают по графику', at: 'ежемесячно', state: 'now' },
        { k: 'report', label: 'Отчётность собственнику', client: 'Отчёт по объекту за период', at: 'до 31 мая', state: 'now' },
      ],
      commission: { total: 26000, payer: 'собственник', vat: true, split: null,
        entries: [
          { k: 'accrued', label: 'Начислено за период', amount: 26000, at: '30 апреля', state: 'done' },
          { k: 'invoiced', label: 'Выставлен счёт', amount: 26000, at: '05 мая', state: 'now' },
          { k: 'paid', label: 'Оплачено', amount: 0, at: '—', state: 'wait' },
        ] },
      timeline: [
        { at: '21 февраля · 11:20', ord: 211120, ch: 'crm', kind: 'raw', by: 'Система', text: 'Договор управления подписан, доверенность оформлена.' },
        { at: '19 марта · 15:45', ord: 191545, ch: 'meet', kind: 'raw', by: 'Лина Хассан', text: 'Арендатор найден, условия согласованы с собственником.' },
        { at: '12 мая · 09:10', ord: 120910, ch: 'note', kind: 'note', by: 'Лина Хассан', text: 'Счёт за апрель выставлен, оплата ещё не поступила — проследить.' },
      ],
    },
  ];

  // A3 fact-conflict — visible, not a silent overwrite.
  const conflicts = {
    d_karim: { field: 'Бюджет', a: '≈ 2,0 млн (первое сообщение)', b: 'до 2,6 млн (уточнение)', av: 2000000, bv: 2600000, chosen: 'b', note: 'Взято последнее уточнение; исходное значение сохранено.' },
  };

  // Attribution (R9) — source → conversion + broker commission. Platform margin is NOT shown (§compliance).
  const attribution = [
    { source: 'Instagram', leads: 22, deals: 3, commission: 210000 },
    { source: 'Реферал', leads: 9, deals: 3, commission: 320000 },
    { source: 'Property Finder', leads: 18, deals: 2, commission: 140000 },
    { source: 'Клуб', leads: 6, deals: 2, commission: 260000 },
    { source: 'Bayut', leads: 15, deals: 1, commission: 40000 },
  ];

  // Signals (R5) — inspectable, replace an opaque rating. Agent priority is independent of AI.
  const clientSignals = {
    c_anna: { priority: 'A', signals: [{ ok: true, t: 'Бюджет подтверждён (2,0 млн)' }, { ok: true, t: 'Финансирование: рассрочка застройщика' }, { ok: true, t: 'Отвечает в течение часа' }, { ok: false, t: 'Показ ещё не проведён' }, { ok: true, t: 'ЛПР — сама клиент' }] },
    c_overdue: { priority: 'B', signals: [{ ok: true, t: 'Бюджет 2,4 млн' }, { ok: false, t: 'Не отвечает 2 дня' }, { ok: false, t: 'Блокер: ждёт КП (просрочено)' }] },
    c_partner: { priority: 'A', signals: [{ ok: false, t: 'Бюджет уточняется (конфликт 2,0 / 2,6)' }, { ok: true, t: 'ЛПР — фонд Altura' }, { ok: true, t: 'Оплата: кэш' }] },
    c_night: { priority: 'C', signals: [{ ok: false, t: 'Бюджет со слов (~1,3 млн)' }, { ok: true, t: 'Согласие получено' }, { ok: false, t: 'Ночной лид, ждёт ответа' }] },
  };

  // Personal tasks / touches (resolve relative to demo clock).
  const tasks = [
    { id: 't_anna_touch', clientId: 'c_anna', title: 'Следующее касание — Анна Петрова', due: 'сегодня', when: 'today', kind: 'touch' },
    { id: 't_igor_kp', clientId: 'c_overdue', title: 'КП для Игоря Лебедева', due: 'просрочено', when: 'overdue', kind: 'kp' },
    { id: 't_viktor_doc', clientId: 'c_docs', title: 'Проверить черновик договора', due: 'завтра', when: 'tomorrow', kind: 'doc' },
  ];

  // Upcoming events.
  const events = [
    { id: 'e_show', clientId: 'c_anna', title: 'Показ Creekline 1208 — Анна', when: 'сегодня 16:00', kind: 'show' },
    { id: 'e_call_karim', clientId: 'c_partner', title: 'Звонок Karim Aziz', when: 'завтра 11:30', kind: 'call' },
  ];

  // Night inbox (S14) + overdue signals for the start screen feed.
  // Exception inbox (R6) — «Разобрать» becomes an exception queue. ex = exception type
  // (qualify / duplicate / noconsent / unknown_object / delivery_fail).
  const inbox = [
    { id: 'in_night', clientId: 'c_night', channel: 'whatsapp', at: '02:14', text: 'Hi, still looking for a 1BR investment unit in JVC, budget ~1.3M. Can you help?', kind: 'night', ex: 'qualify' },
    { id: 'in_anna_vn', clientId: 'c_anna', channel: 'whatsapp', at: '09:05', text: 'Голосовое сообщение · 0:24', kind: 'voice', scenario: 'G1', ex: 'qualify' },
    { id: 'in_dup', clientId: null, channel: 'email', at: '08:30', text: 'Новый запрос от «M. Ibragimov» — похоже на существующий контакт Марат Ибрагимов.', kind: 'exception', ex: 'duplicate' },
    { id: 'in_unknownobj', clientId: null, channel: 'whatsapp', at: '09:02', text: 'Спрашивают по объекту, которого нет в инвентаре («Marina Vista, 32 этаж»).', kind: 'exception', ex: 'unknown_object' },
    { id: 'in_faildeliver', clientId: 'c_overdue', channel: 'email', at: '09:08', text: 'КП Игорю Лебедеву не доставлено — адрес отклонил письмо (bounce).', kind: 'exception', ex: 'delivery_fail' },
  ];

  // Analytics for the start screen tiles.
  // Deliberately holds no counter that is derivable from deals: `dealsActive` and
  // `pipelineValue` used to live here, were never read (the screen recomputes them),
  // and only sat waiting to contradict the real figure in an answer.
  const analytics = {
    hotClients: 3,
    kpPending: 1,
    savedHours: 14.5,
    weekTouches: { done: 11, total: 14 },
    sparks: [4, 6, 5, 8, 7, 9, 12], // deals/day trend
    coverage: 0.86,     // lead coverage
    avgCycleDays: 34,   // mean days from request to close (demo KPI)
  };

  // Request-level channel history (pre-deal correspondence). Anchored to the request; the merged
  // client comms view unions this with the client's deal timelines + contact timeline.
  const requestTimeline = {
    r_anna: [
      { at: '06 мая · 10:12', ord: 60012, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Входящее: ищу инвест-квартиру до 2 млн, Business Bay или Creek Harbour.', capture: true },
      { at: '06 мая · 11:40', ord: 61140, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Созвон 8:20 — уточнила срок 1–3 мес, приоритет доходность под аренду.', capture: true },
      { at: '07 мая · 09:15', ord: 70915, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Подобрала 3 объекта (Creekline, Palm Court, Bayline) — отправлю на выбор.' },
      { at: '07 мая · 16:20', ord: 71620, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'Отправлено 3 объекта на выбор с расчётом доходности и графиком платежей.' },
      { at: '08 мая · 12:30', ord: 81230, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Понравился Creekline 1208; JVC не подходит — далеко от центра.', capture: true },
      { at: '08 мая · 13:10', ord: 81310, ch: 'whatsapp', kind: 'raw', by: 'Марина Волкова', text: 'Готова показать Creekline вживую — предложила слот на сегодня 16:00.' },
      { at: '09 мая · 15:30', ord: 91530, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Провела показ Creekline 1208 — клиенту понравился вид на канал, забрал расчёт рассрочки на изучение.', capture: true },
      { at: '11 мая · 12:10', ord: 111210, ch: 'whatsapp', kind: 'raw', by: 'Клиент', text: 'Сравнил Creekline и Bayline — беру Creekline, пришлите точный график рассрочки 60/40.', capture: true },
      { at: '13 мая · 17:45', ord: 131745, ch: 'call', kind: 'raw', by: 'Марина Волкова', text: 'Созвон 6:10 — подтвердили рассрочку 60/40, клиент готов бронировать на этой неделе.', capture: true },
    ],
    r_viktor: [
      { at: '04 мая · 14:05', ord: 41405, ch: 'email', kind: 'raw', by: 'Клиент', text: 'Реферал: интересует квартира Bayline и портфель офисов в DIFC.', capture: true },
      { at: '05 мая · 12:30', ord: 51230, ch: 'meet', kind: 'raw', by: 'Марина Волкова', text: 'Встреча в офисе — согласовали 1BR + офисный портфель, 100% оплата.', capture: true },
      { at: '05 мая · 15:40', ord: 51540, ch: 'system', kind: 'ai', by: 'Консьерж', text: 'Собран портфель DIFC (2 лота) + бронирование Bayline — предложено вести двумя сделками.' },
      { at: '06 мая · 10:20', ord: 61020, ch: 'email', kind: 'raw', by: 'Марина Волкова', text: 'Отправлено КП: доходность по Bayline и портфелю DIFC, комиссии и условия.' },
      { at: '07 мая · 12:15', ord: 71215, ch: 'call', kind: 'raw', by: 'Клиент', text: 'Звонок 5:40 — подтвердил Bayline, по портфелю DIFC берёт паузу на неделю.', capture: true },
      { at: '08 мая · 09:30', ord: 80930, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Банк запросил подтверждение дохода по ипотеке — собрать пакет к четвергу.' },
      { at: '09 мая · 11:20', ord: 91120, ch: 'email', kind: 'raw', by: 'Клиент', text: 'Прислал пакет по доходам к запросу банка — по бронированию Bayline.', capture: true },
      { at: '10 мая · 16:05', ord: 101605, ch: 'note', kind: 'note', by: 'Марина Волкова', text: 'Bayline перевела в сделку (бронь + MOU); по портфелю DIFC клиент пока думает — заявку держим открытой.' },
    ],
  };

  WS.fixtures = {
    version: 1,
    DEMO_NOW, tenant, users, roster, clients, objects, refModel,
    deals, requests, tasks, events, inbox, analytics,
    FUNNELS, STAGE_LABELS, contracts, CONTRACT_KINDS, companies, dealTimeline, requestTimeline, contactTimeline, companyTimeline, conflicts, attribution, clientSignals,
  };
})(window.WS = window.WS || {});
