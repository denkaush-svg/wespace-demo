/* ============================================================
   State store — clients/deals/objects/tasks/events + persistence.
   Fixtures are never mutated; user changes live in `data`.
   ============================================================ */
(function (WS) {
  const KEY = 'wespace_demo_state';
  const SCHEMA = 26; // bump on any fixtures-shape change so stale localStorage is discarded. 2→3: users[].photo. 3→4: deals[].contacts (multi-contact with rating). 4→5: companies[] requisites. 5→6: objects[] address + commissionPct. 6→7: contactTimeline[] + dealTimeline for every deal + ord sort keys. 7→8: companyTimeline[]. 8→9: roster[] + dead analytics counters removed. 9→10: requests[] (заявка → сделки → лоты) + deals[].requestId + deals[].lots. 10→11: requests[] brief attributes + offered[] (selection state) + kp. 11→12: requestTimeline enriched (recent events 09–13 мая) — force re-seed so stale snapshots without them are discarded. 12→13: deals[].createdAt (creation date for each deal). 13→14: companies[].people[] (roles, decision-makers, communication channels). 14→15: users[agent].goals[] (configurable goals with metrics and progress tracking). 15→16: funnels by service (sale/rent/manage/exclusive/cross/consult) with per-funnel stage lists; deals[].readiness/saleKind/side; terminal stage split into won/lost. 16→17: objects[].attrs.floor as a storey number + floors/floorBand, objects[].usp, AREAS[] market snapshot per district. 17→18: DIFC office objects (o_difc_a/o_difc_b) + AREAS[DIFC]; d_rentbiz lots point at one development; r_viktor.offered/kp rebuilt. 18→19: o_jvcpark (the JVC listing Anna rejected, instead of the unit she already owns); d_karim/d_fitout/k_jvc lose object ids copied from unrelated records. 19→20: seven pre-sale records became requests (r_igor/r_karim/r_lease/r_fitout/r_manage/r_exclusive/r_consult) + r_won as the parent of the closed purchase; requests[].funnel; conflicts keyed by request. 20→21: r_sarah_apr + r_villa + d_sarah_apr — a lost deal and a lost request, so the conversion rates measure something. 21→22: o_bbloft + five request/deal pairs so every service has a live example (rent/manage/exclusive/cross/consult); client goal fields no longer carry deal state. 22→23: market[] (районы Дубая с происхождением цифр) — срез рынка, из которого Консьерж отвечает. 23→24: tasks[].dealId / tasks[].requestId — область задачи (сделка → заявка → контакт); без неё у двух сделок одного клиента был общий список задач. 24→25: волна 3 — settings (пороги отношений и поводов), cueState (решение агента по поводу касания), clients[].birthday/ctype, clients[].relStage/relStageOver (ручная правка стадии отношений), deals[].lotState (пер-лотовое состояние), deals[].convertedAt, offers[] (версии коммерческих предложений), tasks[].outcome, участники сделки на новом словаре ролей и влияния плюс канал и компания. 25→26: волна 4 — inbox[].stage (четыре стадии разбора входящего обращения) и задача по сделке на доске; без подъёма сохранённый снимок оставлял все обращения в «Новом» и прятал стадию «Не вышли на связь».
  const clone = (o) => (window.structuredClone ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  const subs = [];
  const store = {
    schema: SCHEMA,
    theme: null,          // null = follow system
    role: 'agent',
    view: 'concierge',
    tour: { active: false, scenarioId: null, stepIndex: 0 },
    scenarioStatus: {},   // id -> 'not' | 'prog' | 'done'
    data: null,           // working copy of fixtures
    dataRevision: 0,      // bumped by every write; a proposal built against an older one is stale
    events: [],           // event log (spec §14.2)
    unsaved: 0,
    toasts: [],
    // UI state — defaulted here so every boot path has them defined
    // (not only resetAll); otherwise a fresh load throws on first use.
    objFilter: 'all', objSearch: '', objSort: 'default', objArea: 'all', objBr: 'all', objPrice: 'all',
    shortlist: [], podborClient: 'c_anna', match: null, matchClient: null,
    docSearch: '', docTab: 'all', calType: 'all', calDir: 'all', calObj: 'all', calClient: 'all', calWeek: 0, calDay: -1,
    contactsSearch: '', companiesSearch: '', conciergeSearch: '',
    contactsFilters: { priority: 'all', psych: 'all', object: 'all', area: 'all', budget: 'all', state: 'all', consent: 'all' },
    dealObjType: 'all', dealReadiness: 'all', dealAgent: 'all', dealStage: 'all', dealFunnelAll: true, dealArchivedOnly: false,
    companiesFilters: { client: 'all' },
    calcModel: null, finModel: null, finObjId: 'o_creekline',
    clientsTab: 'deals', dealsView: null, navOpen: false, cgRailOpen: false, cgCtx: [], cgMenu: null, cgMode: 'auto', cgDepth: 'think',
    // Chat and documents are two settings because they are two decisions: the
    // broker reads the chat, the client reads the document. `auto` on the
    // document means «follow whoever it is for», which is the usual answer.
    cgLang: 'ru', cgDocLang: 'auto',
    capture: {}, dealFunnel: 'sale', contractId: null, dealsFilter: {}, savedView: null,
    // Where the user came from. A card opened from another card has to return to it, and the
    // hard-coded «Назад к сделкам» on every card could only ever return to a list.
    navStack: [], navHere: null,
    navHidden: ['tasks'],  // Задачи скрыты из бокового меню по умолчанию (вкл. в Настройках; доступ из Пульса «Все задачи»)
    cgGroupCollapse: {},   // group collapse state: groupId -> boolean (true = collapsed)
    // event layer (rev.3)
    eventsPlayed: [], feedback: [], signals: [], dayStep: 0,
  };

  function freshData() {
    const f = WS.fixtures;
    return {
      tenant: clone(f.tenant),
      users: clone(f.users),
      clients: clone(f.clients),
      objects: clone(f.objects),
      market: clone(f.market),
      deals: clone(f.deals),
      requests: clone(f.requests),
      tasks: clone(f.tasks),
      events: clone(f.events),
      inbox: clone(f.inbox),
      analytics: clone(f.analytics),
      roster: clone(f.roster),
      refModel: clone(f.refModel),
      companies: clone(f.companies),
      dealTimeline: clone(f.dealTimeline),
      requestTimeline: clone(f.requestTimeline),
      contactTimeline: clone(f.contactTimeline),
      companyTimeline: clone(f.companyTimeline),
      conflicts: clone(f.conflicts),
      attribution: clone(f.attribution),
      clientSignals: clone(f.clientSignals),
      contracts: clone(f.contracts),
      settings: clone(f.settings),
      // Решение агента по поводу касания. Сам повод выводится из данных при каждом чтении —
      // здесь остаётся только то, чего из данных не выведешь: что человек с ним сделал.
      cueState: {},
      // Коммерческие предложения по заявке и по сделке — версиями. Снимок, на котором заведена
      // сделка, живёт отдельно (deals[].kpSnapshot) и остаётся неизменяемым.
      offers: [],
      /* Итоги, написанные моделью и ещё не подтверждённые. Живут ОТДЕЛЬНО от лент: пока
         итог не подтверждён, он не должен попадаться никому, кто читает историю ради вывода. */
      outcomes: clone(f.outcomes || []),
    };
  }
  // Funnel taxonomy is static config, not mutable state — expose it without cloning per reset.
  WS.FUNNELS = WS.fixtures.FUNNELS;
  // Срез рынка по районам — такая же статическая конфигурация, как воронки: он не редактируется
  // из интерфейса и не должен клонироваться на каждый сброс сцены.
  WS.AREAS = WS.fixtures.AREAS;
  // Стадии двух уровней — тоже статическая конфигурация: они не редактируются из интерфейса.
  WS.REQ_STAGES = WS.fixtures.REQ_STAGES;
  WS.REQ_STAGE_LABELS = WS.fixtures.REQ_STAGE_LABELS;
  WS.REQ_SIDE = WS.fixtures.REQ_SIDE;
  WS.INBOX_STAGES = WS.fixtures.INBOX_STAGES;
  WS.INBOX_STAGE_LABELS = WS.fixtures.INBOX_STAGE_LABELS;
  WS.DEAL_STEPS = WS.fixtures.DEAL_STEPS;
  WS.REG_LABELS = WS.fixtures.REG_LABELS;
  WS.contractKindFor = WS.fixtures.contractKindFor;

  function initStatuses() {
    const st = {};
    WS.scenarioList.forEach((s) => { st[s.id] = 'not'; });
    return st;
  }

  // ---- demo clock (spec §6.1): fixed base, ticks minutes only for realism
  function clockLabel() {
    const n = WS.fixtures.DEMO_NOW;
    const mm = String(n.mi).padStart(2, '0');
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    return { time: n.h + ':' + mm, date: n.d + ' ' + months[n.mo - 1] };
  }

  // ---- pub/sub
  function subscribe(fn) { subs.push(fn); }
  function emit() { subs.forEach((fn) => fn(store)); }

  // ---- persistence
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        schema: SCHEMA, theme: store.theme, role: store.role,
        scenarioStatus: store.scenarioStatus, data: store.data,
        events: store.events, unsaved: store.unsaved,
        shortlist: store.shortlist, podborClient: store.podborClient, docTab: store.docTab,
        // event layer + Concierge threads survive F5 (audit P0-6)
        eventsPlayed: store.eventsPlayed, feedback: store.feedback, dayStep: store.dayStep,
        threads: (WS.engine && WS.engine.exportThreads) ? WS.engine.exportThreads() : null,
      }));
    } catch (e) { /* ignore quota / private mode */ }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    let p;
    try { p = JSON.parse(raw); } catch (e) { return 'corrupt'; }
    if (!p || p.schema !== SCHEMA) return 'incompatible';
    store.theme = p.theme || null;
    store.role = p.role || 'agent';
    store.scenarioStatus = p.scenarioStatus || initStatuses();
    store.data = p.data || freshData();
    store.events = p.events || [];
    store.unsaved = p.unsaved || 0;
    store.shortlist = p.shortlist || [];
    store.podborClient = p.podborClient || 'c_anna';
    store.docTab = p.docTab || 'all';
    store.eventsPlayed = p.eventsPlayed || [];
    store.feedback = p.feedback || [];
    store.dayStep = p.dayStep || 0;
    store._threads = p.threads || null; // imported by engine on boot (see main.js)
    return true;
  }

  // ---- lifecycle
  function boot() {
    const res = load();
    if (res !== true) {
      store.data = freshData();
      store.scenarioStatus = initStatuses();
      store.events = [];
      store.incompatible = (res === 'incompatible' || res === 'corrupt');
    }
    // resolve theme
    if (store.theme) document.documentElement.setAttribute('data-theme', store.theme);
    return store;
  }

  function resetAll() {
    store.data = freshData();
    store.scenarioStatus = initStatuses();
    store.role = 'agent';
    store.events = [];
    store.unsaved = 0;
    store.tour = { active: false, scenarioId: null, stepIndex: 0 };
    store.calcModel = null; store.finModel = null; store.finObjId = 'o_creekline';
    store.objFilter = 'all';
    store.objSearch = ''; store.objSort = 'default'; store.objArea = 'all'; store.objBr = 'all'; store.objPrice = 'all';
    store.shortlist = []; store.podborClient = 'c_anna'; store.match = null; store.matchClient = null;
    store.docSearch = ''; store.docTab = 'all'; store.calType = 'all'; store.calDir = 'all'; store.calObj = 'all'; store.calClient = 'all'; store.calWeek = 0; store.calDay = -1;
    store.contactsSearch = ''; store.companiesSearch = ''; store.conciergeSearch = '';
    store.contactsFilters = { priority: 'all', psych: 'all', object: 'all' };
    store.cgGroupCollapse = {};
    store.companiesFilters = { client: 'all' };
    store.eventsPlayed = []; store.feedback = []; store.signals = []; store.dayStep = 0;
    store.clientsTab = 'deals'; store.dealsView = null; store.cgCtx = []; store.cgMenu = null; store.cgMode = 'auto'; store.cgDepth = 'think';
    store.cgLang = 'ru'; store.cgDocLang = 'auto';
    store.dealArchivedOnly = false; store.capture = {}; store.dealFunnel = 'sale'; store.dealsFilter = {}; store.savedView = null;
    store.navOpen = false;
    store.navStack = []; store.navHere = null;
    store.incompatible = false;
    // UI-state added this cycle — return to defaults on reset so the stand starts clean.
    store.navHidden = ['tasks']; store.setMenuOpen = false;
    store.netTab = 'contacts'; store.netSel = null; store.netSearch = ''; store.netType = 'all'; store.teamAgent = null;
    store.tasksDue = 'all'; store.tasksStatus = 'open';
    store.dealBudFrom = ''; store.dealBudTo = ''; store.dealSrc = 'all'; store.apprDone = [];
    if (WS.engine) WS.engine.reset && WS.engine.reset();
    save(); emit();
  }

  // Deterministic scene reset (spec §5.3 "вернуть только затронутые сценой данные").
  // Derives the touched entities from the scenario's declarative effects and
  // restores them to fixture baseline; removes scene-created entities.
  function sceneEffects(id) {
    const s = WS.scenarioById(id);
    if (!s || !s.flow) return [];
    let eff = [];
    s.flow.forEach((step) => {
      if (step.type === 'result' && step.effects) eff = eff.concat(step.effects);
      // panels carry their effects in a nested result (S2/S4/S10/S9)
      if (step.type === 'panel' && step.result && step.result.effects) eff = eff.concat(step.result.effects);
      // A3 per-field effects (G3): partial-reject wiring
      if (step.type === 'preview' && step.fieldEffects) {
        Object.keys(step.fieldEffects).forEach((k) => { eff = eff.concat(step.fieldEffects[k]); });
      }
    });
    return eff;
  }
  function fx(coll, id) { return (WS.fixtures[coll] || []).find((x) => x.id === id); }
  function restoreEntity(coll, id) {
    const src = fx(coll, id); if (!src) return;
    const arr = store.data[coll];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr[i] = clone(src); else arr.push(clone(src));
  }
  function resetScene(id) {
    // if this scene is the one currently running, abort its live session + tour first
    if (WS.engine && WS.engine.endSessionForScene) WS.engine.endSessionForScene(id);
    if (store.tour && store.tour.scenarioId === id) store.tour = { active: false, scenarioId: null, stepIndex: 0 };
    sceneEffects(id).forEach((e) => {
      if (e.op === 'updateDeal' || e.op === 'dealStage') restoreEntity('deals', e.id);
      else if (e.op === 'updateRequest') restoreEntity('requests', e.id);
      else if (e.op === 'updateClient') restoreEntity('clients', e.id);
      else if (e.op === 'setObject') restoreEntity('objects', e.id);
      else if (e.op === 'addTask') store.data.tasks = store.data.tasks.filter((t) => t.id !== e.task.id);
      else if (e.op === 'removeTask') restoreEntity('tasks', e.id);
      else if (e.op === 'clearInbox') restoreEntity('inbox', e.id);
    });
    store.scenarioStatus[id] = 'not';
    store.events = store.events.filter((e) => e.scenario !== id);
    save(); emit();
  }

  // ---- mutations
  function setTheme(t) { store.theme = t; if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); save(); emit(); }
  function setRole(r) { store.role = r; save(); emit(); }
  function setView(v) { store.view = v; emit(); }
  function setScenarioStatus(id, s) { store.scenarioStatus[id] = s; save(); emit(); }

  /* Договор рождается на подписании — и привязан к СМЕНЕ СТАДИИ, а не к нажатию кнопки.
     Стадию двигают доска, Консьерж, сценарии и слой записи; если повесить создание на одну
     из этих дверей, остальные три дадут сделку на подписании без договора. Операция
     идемпотентна: второй договор по той же сделке не появляется. */
  const CONTRACT_FROM = ['sign', 'reg', 'exec', 'won'];
  function afterDealStage(rec) {
    if (!rec || CONTRACT_FROM.indexOf(rec.stage) < 0) return;
    if (WS.ui && WS.ui.ensureContract) WS.ui.ensureContract(rec.id);
  }

  // ---- declarative effects: scenarios mutate shared data on result (spec §18.2)
  function applyEffects(effects) {
    if (!effects || !effects.length) return;
    const d = store.data;
    effects.forEach((e) => {
      if (e.op === 'updateDeal') {
        const dl = d.deals.find((x) => x.id === e.id);
        if (dl) { Object.assign(dl, e.patch); if (e.patch && e.patch.stage) afterDealStage(dl); }
      } else if (e.op === 'dealStage') {
        const dl = d.deals.find((x) => x.id === e.id);
        if (dl) { dl.stage = e.stage; afterDealStage(dl); }
      } else if (e.op === 'updateRequest') {
        // Пресейл живёт на заявке, а не на сделке: сценарии, которые раньше двигали стадию
        // сделки на «в работе», записывают факт сюда. Стадии здесь нет намеренно — она
        // вычисляется из фактов (см. reqStage), и присвоить её нечем.
        const r = (d.requests || []).find((x) => x.id === e.id);
        if (r) Object.assign(r, e.patch);
      } else if (e.op === 'updateClient') {
        const c = d.clients.find((x) => x.id === e.id);
        if (c) Object.assign(c, e.patch);
      } else if (e.op === 'setObject') {
        const o = d.objects.find((x) => x.id === e.id);
        if (o) Object.assign(o, e.patch);
      } else if (e.op === 'addObject') {
        if (!d.objects.some((o) => o.id === e.obj.id)) d.objects.unshift(e.obj);
      } else if (e.op === 'addRequest') {
        if (!d.requests.some((x) => x.id === e.obj.id)) d.requests.unshift(e.obj);
      } else if (e.op === 'addDeal') {
        if (!d.deals.some((x) => x.id === e.obj.id)) d.deals.unshift(e.obj);
      } else if (e.op === 'addClient') {
        if (!d.clients.some((c) => c.id === e.obj.id)) d.clients.unshift(e.obj);
      } else if (e.op === 'addTask') {
        if (!d.tasks.some((t) => t.id === e.task.id)) d.tasks.unshift(stripBadScope(e.task));
      } else if (e.op === 'removeTask') {
        d.tasks = d.tasks.filter((t) => t.id !== e.id);
      } else if (e.op === 'clearInbox') {
        d.inbox = d.inbox.filter((i) => i.id !== e.id);
      } else if (e.op === 'analytics') {
        Object.assign(d.analytics, e.patch);
      }
    });
    store.dataRevision++;
    save();
  }

  // ============================================================
  //  The one way anything writes to the data.
  //  Scenario effects above are authored by us and trusted; everything that
  //  comes from a conversation goes through here instead, where each operation
  //  is checked BEFORE any of them is applied. A batch is all-or-nothing, so a
  //  half-understood instruction cannot leave the deal half-changed.
  // ============================================================

  // Writable surface, tiered by consequence rather than by convenience.
  //   safe    — applies straight away and is obvious on sight (wording, tags, notes)
  //   guarded — needs an explicit confirmation (money, stage, ownership, status)
  //   absent  — not writable here at all: identity fields, provenance, and consent,
  //             which is a legal fact recorded from the client, not ours to grant
  // Ids for records a conversation creates; stable within a session.
  let addSeq = 0;

  const WRITABLE = {
    deals: {
      safe: ['tags', 'sub', 'title', 'updated', 'note', 'nextStep', 'consideredProjects'],
      guarded: ['stage', 'amount', 'hot', 'funnel', 'dealType', 'objectType', 'readiness', 'saleKind', 'side', 'goal', 'paymentForm',
        'vat', 'source', 'agent', 'partnerAgent', 'companyId', 'stageDays', 'contacts'],
    },
    clients: {
      safe: ['note', 'goal', 'areas', 'horizon', 'viewed'],
      guarded: ['budget', 'tag', 'channel', 'lang', 'name', 'phone', 'psych'],
    },
    objects: {
      safe: ['match'],
      guarded: ['price', 'verified', 'checkedAt', 'source', 'sourceLabel', 'commissionPct',
        'size', 'br', 'area', 'name', 'address', 'purpose'],
    },
    tasks: {
      safe: ['title', 'due', 'kind', 'assignee'],
      // Область задачи — структурное поле: от неё зависит, в какой карточке задача видна.
      guarded: ['status', 'when', 'dealId', 'requestId', 'contractId'],
    },
    // У заявки нет строки «стадия»: она вычисляется из фактов. Поэтому guarded здесь — это
    // то, из чего стадия следует (что предложено, что выбрано, собрано ли КП) плюс деньги.
    requests: {
      safe: ['note', 'title', 'nextContact', 'temperature', 'horizon', 'bedrooms', 'goal', 'areas'],
      guarded: ['budget', 'leadStatus', 'assignee', 'offered', 'kp', 'interest', 'paymentForm',
        'dealType', 'objectType', 'funding', 'vat', 'source', 'partnerAgent'],
    },
  };

  /* What a record cannot exist without, and — separately — what it needs to be
     worth having.

     `required` is the floor, checked before anything is written. `addClient {}`
     used to pass the dry run and file a contact whose card read as its own
     internal id: the layer checked that a record was an object and never that
     it was a record OF anybody. Same class of failure as an invented figure —
     a shape validated and a meaning not.

     It is one field per collection, two where a record has to belong to
     somebody and say what it is about. Past that it stops being a floor and
     becomes a questionnaire, and a questionnaire is where the conversation
     ends — which is why `key` below does NOT block anything.

     `key` is what the request card already calls «Ключевые условия» (ui.js
     `reqKeyCard`). The record is created without them; the preview names the
     ones still empty, so the broker confirming a new card sees what it is
     missing then rather than finding out a week later. The list lives here and
     not in the Concierge so that there is one of it, and it is the card's. */
  const RECORD_FIELDS = {
    clients: { required: ['name'], key: ['phone', 'channel'] },
    // Финансирование и НДС из «Ключевых условий» намеренно не здесь: они
    // относятся к сделке, которую структурируют, а не к заявке, которую заводят.
    requests: {
      required: ['clientId', 'title'],
      key: ['budget', 'areas', 'dealType', 'paymentForm', 'goal', 'horizon'],
    },
    tasks: { required: ['title'], key: ['due'] },
  };
  // Пусто — это и не заполнено, и пробелы, и пустой список. «Районы: []» —
  // это отсутствие районов, а не значение.
  function blank(v) {
    if (v == null) return true;
    if (typeof v === 'string') return !v.trim();
    if (Array.isArray(v)) return !v.length;
    return false;
  }

  const OP_SPEC = {
    updateDeal: { coll: 'deals', kind: 'patch' },
    updateRequest: { coll: 'requests', kind: 'patch' },
    updateClient: { coll: 'clients', kind: 'patch' },
    updateObject: { coll: 'objects', kind: 'patch' },
    setObject: { coll: 'objects', kind: 'patch' },   // alias: scenario effects use this name
    updateTask: { coll: 'tasks', kind: 'patch' },
    dealStage: { coll: 'deals', kind: 'stage' },
    addTask: { coll: 'tasks', kind: 'add' },
    // Conversation-created entities. A new request or contact needs explicit
    // confirmation — tier:'guarded' — so the broker sees what will land in the
    // workspace before it does, not after.
    addRequest: { coll: 'requests', kind: 'add', tier: 'guarded' },
    addClient: { coll: 'clients', kind: 'add', tier: 'guarded' },
    removeTask: { coll: 'tasks', kind: 'remove' },
    // Feed writes live in ui.js, where the ordering rules for a timeline are.
    // Routed through here anyway so a conversation has exactly one way to write,
    // and a batch that mixes a note with a stage change is still all-or-nothing.
    addEvent: { coll: null, kind: 'event' },
  };

  function fail(code, message, extra) {
    return Object.assign({ ok: false, code: code, error: message }, extra || {});
  }

  // Which fields are references, and to what. A write that names an entity must
  // name one that exists — for the same reason ids in a proposal have to come
  // from the data rather than from a sentence.
  const REFS = {
    clientId: 'clients', companyId: 'companies', objectId: 'objects',
    dealId: 'deals', requestId: 'requests', contractId: 'contracts', assignee: 'users', agent: 'users',
  };
  /* `coming` holds what EARLIER operations in the same batch will create.

     Without it, the one flow the Concierge is told to use could never run: a
     new client and their first request arrive together — «Владимира Петренко в
     контактах нет — заведу и его, и заявку» — and the request names a contact
     that does not exist yet, because the operation creating it is one line
     above in the same all-or-nothing batch. The layer refused, and the person
     was told «нет такой записи» about a record they had just asked for.

     A batch applies whole or not at all, so a reference forward inside it is
     as safe as one to a record already stored. A reference to something no
     operation creates is still refused. */
  /* Ссылка может указывать на существующую запись и всё равно быть неверной: задача
     с клиентом одного человека и сделкой другого пройдёт проверку ссылок и осядет
     в двух карточках по-разному — в сделке видна, у клиента нет. Область задачи и есть
     то, ради чего вводились эти поля, поэтому согласованность проверяется здесь. */
  function scopeError(rec, at) {
    const d = store.data || {};
    const owner = (coll, id) => {
      const x = (d[coll] || []).find((y) => y.id === id);
      return x ? x.clientId : undefined;
    };
    if (!rec || !rec.clientId) return null;
    const pairs = [['dealId', 'deals'], ['requestId', 'requests']];
    for (let i = 0; i < pairs.length; i++) {
      const [field, coll] = pairs[i];
      if (!rec[field]) continue;
      const own = owner(coll, rec[field]);
      if (own && own !== rec.clientId) {
        return fail('bad_scope', at + field + ' указывает на запись другого клиента', { field: field, collection: coll });
      }
    }
    return null;
  }
  function refError(rec, at, coming) {
    const d = store.data || {};
    const keys = Object.keys(rec || {});
    for (let i = 0; i < keys.length; i++) {
      const f = keys[i];
      const coll = REFS[f];
      const val = rec[f];
      if (!coll || val == null || val === '') continue;
      // `users` is a map in this store, everything else is a list.
      const exists = coll === 'users'
        ? !!(d.users && d.users[val]) || (d.roster || []).some((u) => u.id === val)
        : (d[coll] || []).some((x) => x.id === val) ||
          !!(coming && coming[coll] && coming[coll].indexOf(val) >= 0);
      if (!exists) {
        return fail('bad_ref', at + 'нет такой записи: ' + f + ' = ' + val, { field: f, collection: coll });
      }
    }
    return null;
  }

  /* What a person is actually being asked to confirm. The preview used to list
     the field names alone — «deals d_anna: amount» — so a figure the model
     picked was written into the workspace by someone who never saw it. The
     whole write layer exists so a change passes through a human; showing the
     name of the field and not its value made that passage ceremonial.

     And it is read in Russian, on a phone, by a broker: the internals of the
     store are not the vocabulary to confirm a change in. */
  const COLL_RU = { deals: 'Сделка', clients: 'Контакт', objects: 'Объект', tasks: 'Задача', requests: 'Заявка' };
  const FIELD_RU = {
    amount: 'сумма', stage: 'стадия', hot: 'горячая', funnel: 'воронка', dealType: 'тип сделки',
    objectType: 'тип объекта', goal: 'цель', paymentForm: 'форма оплаты', vat: 'НДС', source: 'источник',
    agent: 'ответственный', partnerAgent: 'агент партнёра', companyId: 'компания', stageDays: 'дней на стадии',
    contacts: 'контакты', clientId: 'контакт', tags: 'теги', sub: 'подпись', title: 'название', updated: 'обновлено',
    note: 'заметка', nextStep: 'следующий шаг', consideredProjects: 'проекты в работе',
    areas: 'районы', horizon: 'срок сделки', viewed: 'просмотрено', budget: 'бюджет', tag: 'метка',
    channel: 'канал', lang: 'язык', name: 'имя', phone: 'телефон', psych: 'психотип',
    match: 'соответствие', price: 'цена', verified: 'проверен', checkedAt: 'проверен',
    sourceLabel: 'подпись источника', commissionPct: 'комиссия, %', size: 'площадь', br: 'спален',
    area: 'район', address: 'адрес', purpose: 'назначение',
    due: 'срок', kind: 'тип', assignee: 'исполнитель', status: 'статус', when: 'когда',
    bedrooms: 'спален', nextContact: 'следующий контакт', leadStatus: 'статус лида',
    temperature: 'температура', funding: 'финансирование',
  };
  const EVENT_RU = { note: 'Заметка', call: 'Звонок', meet: 'Встреча', msg: 'Сообщение', task: 'Задача' };
  const fieldRu = (f) => FIELD_RU[f] || f;
  const stageRu = (k) => ((WS.ui && WS.ui.stageLabel) ? (WS.ui.stageLabel(k) || k) : k);
  // The record as a person knows it, falling back to the id when it has no name.
  function recordRu(coll, rec) {
    const who = rec && (rec.name || rec.title || rec.sub);
    return (COLL_RU[coll] || coll) + ' ' + (who ? '«' + String(who).slice(0, 40) + '»' : (rec && rec.id) || '');
  }

  function shown(v) {
    if (v === undefined || v === null || v === '') return '—';
    if (typeof v === 'number') return isFinite(v) ? v.toLocaleString('ru-RU') : String(v);
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
    const s = String(v);
    return s.length > 40 ? s.slice(0, 39) + '…' : s;
  }

  // Returns either a failure, or a plan entry: { ok, tier, summary, run }.
  function planOp(o, i, coming) {
    const at = 'операция ' + (i + 1) + ': ';
    if (!o || !o.op) return fail('bad_op', at + 'не указана операция');
    const spec = OP_SPEC[o.op];
    if (!spec) return fail('unknown_op', at + 'неизвестная операция «' + o.op + '»', { available: Object.keys(OP_SPEC) });

    if (spec.kind === 'event') {
      const txt = String(o.text == null ? '' : o.text).trim();
      if (!txt) return fail('bad_value', at + 'пустой текст события');
      const owner = (WS.ui && WS.ui.feedOwner) ? WS.ui.feedOwner(o.scope, o.id) : null;
      if (!owner) return fail('not_found', at + 'нет сущности ' + o.scope + ' ' + o.id);
      /* «событие в contact c_docs» is the store talking to itself. The line is
         read by a broker deciding whether to confirm — it has to name the
         person and say what will be written, like every other line does. */
      const who = owner.name || owner.title || o.id;
      return {
        ok: true, tier: 'safe',
        summary: EVENT_RU[o.type || 'note'] + ' · «' + String(who).slice(0, 40) + '» · ' + shown(txt),
        run: () => { WS.ui.addEventEntry(o.scope, o.id, { type: o.type, text: txt, when: o.when, due: o.due, dueWhen: o.dueWhen }); },
      };
    }

    const coll = store.data[spec.coll];
    if (!Array.isArray(coll)) return fail('no_collection', at + 'нет коллекции ' + spec.coll);

    if (spec.kind === 'add') {
      const src = o.task || o.obj || o.record;
      if (!src || typeof src !== 'object') return fail('bad_record', at + 'нет записи');
      const fields = RECORD_FIELDS[spec.coll] || {};
      const need = (fields.required || []).filter((f) => blank(src[f]));
      if (need.length) {
        return fail('missing_field', at + 'без этого запись не завести: ' + need.map(fieldRu).join(', '),
          { fields: need, collection: spec.coll });
      }
      // A record may point at a contact, a deal or an object. Pointing it at an
      // id that does not exist created a task hanging off nothing — it renders,
      // it just belongs to no one.
      const badRef = refError(src, at, coming);
      if (badRef) return badRef;
      const badScope = scopeError(src, at);
      if (badScope) return badScope;
      // The id is ours to assign, not the caller's to invent. Demanding one
      // meant every «поставь задачу на завтра» came back as «нет записи или её
      // id» — the model was following the contract it was given and the layer
      // refused it anyway.
      const rec = Object.assign({}, src);
      if (!rec.id) rec.id = 't_ag' + (++addSeq) + '_' + spec.coll;
      if (coll.some((x) => x.id === rec.id)) return fail('duplicate', at + 'запись ' + rec.id + ' уже есть');
      // Show the entity by a name a person recognises, not by its internal id.
      const label = rec.name || rec.title || (rec.task && rec.task.title) || rec.id;
      const addTier = spec.tier || 'safe';
      // Said on the card that asks to confirm the record, and said per record:
      // a batch that opens a contact and their first request has two of these,
      // and one merged list would not say which gap belongs to which card.
      const gaps = (fields.key || []).filter((f) => blank(rec[f]));
      return {
        ok: true, tier: addTier,
        summary: (COLL_RU[spec.coll] || spec.coll) + ' · «' + String(label).slice(0, 60) + '»',
        missing: gaps.length
          ? (COLL_RU[spec.coll] || spec.coll) + ' «' + String(label).slice(0, 40) + '» — не заполнены: ' +
            gaps.map(fieldRu).join(', ')
          : null,
        // What a later operation in this batch may point at.
        creates: { coll: spec.coll, id: rec.id },
        run: () => { coll.unshift(rec); },
      };
    }
    if (spec.kind === 'remove') {
      const idx = coll.findIndex((x) => x.id === o.id);
      if (idx < 0) return fail('not_found', at + 'нет записи ' + o.id + ' в ' + spec.coll);
      return { ok: true, tier: 'guarded', summary: o.op + ' ' + o.id, run: () => { coll.splice(idx, 1); } };
    }

    const rec = coll.find((x) => x.id === o.id);
    if (!rec) return fail('not_found', at + 'нет записи ' + o.id + ' в ' + spec.coll, { collection: spec.coll, id: o.id });

    // Шаг принадлежит договору, а не разговору. Проверка стоит на ОБОИХ путях записи: своя
    // операция `dealStage` и поле `stage` внутри `updateDeal` — иначе достаточно назвать её
    // патчем, чтобы поставить сделку на шаг, которого в её договоре нет, и доска потеряет карточку.
    function stageRefusal(stage) {
      const kind = WS.contractKindFor ? WS.contractKindFor(rec.funnel || 'sale', rec.readiness) : '';
      const allowed = (WS.DEAL_STEPS || {})[kind] || [];
      if (!allowed.length || allowed.indexOf(stage) >= 0) return null;
      const label = ((WS.fixtures.CONTRACT_KINDS || {})[kind] || {}).label || kind;
      return fail('bad_value', at + 'в договоре «' + label + '» нет такого шага',
        { stage: stage, available: allowed });
    }
    if (spec.kind === 'stage') {
      if (!o.stage) return fail('bad_value', at + 'не указана стадия');
      const bad = stageRefusal(o.stage);
      if (bad) return bad;
      return { ok: true, tier: 'guarded',
        summary: recordRu(spec.coll, rec) + ' · стадия: ' + stageRu(rec.stage) + ' → ' + stageRu(o.stage),
        run: () => { rec.stage = o.stage; afterDealStage(rec); } };
    }

    const patch = o.patch;
    if (!patch || typeof patch !== 'object') return fail('bad_patch', at + 'нет полей для изменения');
    const keys = Object.keys(patch);
    if (!keys.length) return fail('bad_patch', at + 'пустой набор полей');
    if (spec.coll === 'deals' && patch.stage) {
      const bad = stageRefusal(patch.stage);
      if (bad) return bad;
    }
    const badPatchRef = refError(patch, at, coming);
    if (badPatchRef) return badPatchRef;
    // Область проверяется и на изменении, не только на создании: `dealId` и `requestId`
    // изменяемы через этот слой, поэтому задачу можно было перевесить на сделку другого
    // клиента вторым вызовом — создание защищено, обход шёл мимо. Проверяется результат
    // слияния, а не патч: клиент чаще всего лежит в записи, а в патче только ссылка.
    const badPatchScope = scopeError(Object.assign({}, rec, patch), at);
    if (badPatchScope) return badPatchScope;
    const rules = WRITABLE[spec.coll] || { safe: [], guarded: [] };
    let tier = 'safe';
    for (let k = 0; k < keys.length; k++) {
      const f = keys[k];
      if (rules.safe.indexOf(f) >= 0) continue;
      if (rules.guarded.indexOf(f) >= 0) { tier = 'guarded'; continue; }
      return fail('field_not_writable', at + 'поле «' + f + '» нельзя изменить через этот слой',
        { field: f, collection: spec.coll, writable: rules.safe.concat(rules.guarded) });
    }
    return {
      ok: true, tier: tier,
      summary: recordRu(spec.coll, rec) + ' · ' +
        keys.map((f) => fieldRu(f) + ': ' + shown(rec[f]) + ' → ' + shown(patch[f])).join('; '),
      run: () => { Object.assign(rec, patch); if (spec.coll === 'deals' && patch.stage) afterDealStage(rec); },
    };
  }

  // apply(ops, { confirmed, expectedRevision, silent })
  //   → { ok:true, tier, revision, applied[] }  |  { ok:false, code, error, ... }
  function apply(ops, opts) {
    opts = opts || {};
    if (!Array.isArray(ops) || !ops.length) return fail('empty', 'нечего применять');
    if (opts.expectedRevision != null && opts.expectedRevision !== store.dataRevision) {
      return fail('stale', 'данные изменились с момента предложения', { revision: store.dataRevision, expected: opts.expectedRevision });
    }
    const plan = [];
    const coming = {};
    let tier = 'safe';
    for (let i = 0; i < ops.length; i++) {
      const p = planOp(ops[i], i, coming);
      if (!p.ok) return p;                       // nothing has been touched yet
      if (p.tier === 'guarded') tier = 'guarded';
      if (p.creates) (coming[p.creates.coll] || (coming[p.creates.coll] = [])).push(p.creates.id);
      plan.push(p);
    }
    if (tier === 'guarded' && !opts.confirmed) {
      return fail('needs_confirmation', 'изменение требует подтверждения',
        { tier: tier, pending: plan.map((p) => p.summary), revision: store.dataRevision });
    }
    plan.forEach((p) => p.run());
    store.dataRevision++;
    save();
    if (opts.silent !== true) emit();
    return { ok: true, tier: tier, revision: store.dataRevision, applied: plan.map((p) => p.summary) };
  }

  // Dry run: what would happen, without happening. Used to render the diff a
  // person confirms, so the preview and the write cannot disagree.
  function preview(ops) {
    if (!Array.isArray(ops) || !ops.length) return fail('empty', 'нечего применять');
    const plan = [];
    const coming = {};
    let tier = 'safe';
    for (let i = 0; i < ops.length; i++) {
      const p = planOp(ops[i], i, coming);
      if (!p.ok) return p;
      if (p.tier === 'guarded') tier = 'guarded';
      if (p.creates) (coming[p.creates.coll] || (coming[p.creates.coll] = [])).push(p.creates.id);
      plan.push(p);
    }
    return { ok: true, tier: tier, revision: store.dataRevision, pending: plan.map((p) => p.summary),
      // Only a record being CREATED carries these. Changing one field is not an
      // occasion to lecture about the others.
      missing: plan.map((p) => p.missing).filter(Boolean) };
  }

  // ---- task queue mutations (Radar → work queue, batch 2)
  // Tasks live in data.tasks (cloned from fixtures), so resetAll/resetScene restore them.
  // Missing status is treated as 'open'.
  function taskAction(id, action, payload) {
    const t = store.data.tasks.find((x) => x.id === id);
    if (!t) return;
    if (action === 'done') { t.status = 'done'; t.when = 'done'; }
    else if (action === 'reopen') { t.status = 'open'; if (t.when === 'done') t.when = 'today'; }
    else if (action === 'snooze') { t.status = 'open'; t.when = 'tomorrow'; t.due = payload || 'завтра'; t.snoozed = true; }
    else if (action === 'reassign') { t.assignee = payload; t.status = 'open'; }
    store.dataRevision++; save(); emit();
  }
  // Event edit (batch 5). Events live in data.events → restored by reset.
  function updateEvent(id, patch) {
    const ev = store.data.events.find((x) => x.id === id);
    if (!ev) return;
    Object.assign(ev, patch);
    store.dataRevision++; save(); emit();
  }

  // Manual kanban move (batch 4). Stage is restored by resetAll/resetScene.
  function setDealStage(id, stage) {
    const dl = store.data.deals.find((x) => x.id === id);
    if (!dl || dl.stage === stage) return;
    dl.stage = stage;
    afterDealStage(dl);
    store.dataRevision++; save(); emit();
  }

  // A hand edit is a data change like any other. Writing through save() alone left dataRevision
  // untouched, so a Concierge proposal built before the edit still matched `expectedRevision` and
  // stayed confirmable — the stale-proposal guard silently stopped guarding.
  //  saves without redrawing — for a write made while a person is typing in the
  // surface, where a re-render would replace the node under their cursor.
  function touch(opts) { store.dataRevision++; save(); if (!opts || opts.render !== false) emit(); }

  // Прямой путь создания — им пользуются интерфейс, сценарии и события, минуя слой предпросмотра.
  // Отказать здесь нельзя: сценарий не умеет обработать отказ и молча потеряет задачу. Поэтому
  // противоречащая ссылка снимается, а задача остаётся: у неё станет областью шире, чем задумано,
  // но она не будет врать в двух карточках одновременно.
  function stripBadScope(t) {
    const owner = (coll, id) => { const x = (store.data[coll] || []).find((y) => y.id === id); return x ? x.clientId : undefined; };
    if (!t.clientId) return t;
    if (t.dealId && owner('deals', t.dealId) !== undefined && owner('deals', t.dealId) !== t.clientId) delete t.dealId;
    if (t.requestId && owner('requests', t.requestId) !== undefined && owner('requests', t.requestId) !== t.clientId) delete t.requestId;
    return t;
  }
  function addTask(task) {
    const t = stripBadScope(Object.assign({ status: 'open', when: 'today', kind: 'manual', due: 'сегодня' }, task));
    if (!store.data.tasks.some((x) => x.id === t.id)) store.data.tasks.unshift(t);
    store.dataRevision++; save(); emit();
  }

  function logEvent(ev) {
    const c = clockLabel();
    store.events.unshift(Object.assign({
      id: 'ev_' + (store.events.length + 1) + '_' + Math.round(performance.now()),
      time: c.time, user: store.data.users[store.role].name,
    }, ev));
    save();
  }

  function toast(msg, kind) {
    const t = { id: Date.now() + '_' + Math.round(performance.now() % 1000), msg, kind: kind || '' };
    store.toasts.push(t);
    emit();
    setTimeout(() => { store.toasts = store.toasts.filter((x) => x.id !== t.id); emit(); }, 3200);
  }

  WS.store = store;
  WS.storeApi = {
    boot, subscribe, emit, save, resetAll, resetScene,
    setTheme, setRole, setView, setScenarioStatus, logEvent, applyEffects, apply, preview, taskAction, addTask, setDealStage, touch, updateEvent, toast, clockLabel, clone,
  };
})(window.WS = window.WS || {});
