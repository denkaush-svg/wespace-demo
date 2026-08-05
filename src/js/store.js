/* ============================================================
   State store — clients/deals/objects/tasks/events + persistence.
   Fixtures are never mutated; user changes live in `data`.
   ============================================================ */
(function (WS) {
  const KEY = 'wespace_demo_state';
  const SCHEMA = 8; // bump on any fixtures-shape change so stale localStorage is discarded. 2→3: users[].photo. 3→4: deals[].contacts (multi-contact with rating). 4→5: companies[] requisites. 5→6: objects[] address + commissionPct. 6→7: contactTimeline[] + dealTimeline for every deal + ord sort keys. 7→8: companyTimeline[].
  const clone = (o) => (window.structuredClone ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  const subs = [];
  const store = {
    schema: SCHEMA,
    theme: null,          // null = follow system
    role: 'agent',
    view: 'start',
    tour: { active: false, scenarioId: null, stepIndex: 0 },
    scenarioStatus: {},   // id -> 'not' | 'prog' | 'done'
    data: null,           // working copy of fixtures
    events: [],           // event log (spec §14.2)
    unsaved: 0,
    toasts: [],
    // UI state — defaulted here so every boot path has them defined
    // (not only resetAll); otherwise a fresh load throws on first use.
    objFilter: 'all', objSearch: '', objSort: 'default', objArea: 'all', objBr: 'all', objPrice: 'all',
    shortlist: [], podborClient: 'c_anna', match: null, matchClient: null,
    docSearch: '', docTab: 'all', calType: 'all', calDir: 'all', calObj: 'all', calClient: 'all', calWeek: 0, calDay: -1,
    calcModel: null, finModel: null, finObjId: 'o_creekline',
    clientsTab: 'deals', dealsView: null, navOpen: false, cgRailOpen: true, cgCtx: [], cgMenu: null, cgMode: 'auto', cgDepth: 'think',
    capture: {}, dealFunnel: 'sale_offplan', dealsFilter: {}, savedView: null,
    navHidden: ['tasks'],  // Задачи скрыты из бокового меню по умолчанию (вкл. в Настройках; доступ из Пульса «Все задачи»)
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
      deals: clone(f.deals),
      tasks: clone(f.tasks),
      events: clone(f.events),
      inbox: clone(f.inbox),
      analytics: clone(f.analytics),
      refModel: clone(f.refModel),
      companies: clone(f.companies),
      dealTimeline: clone(f.dealTimeline),
      contactTimeline: clone(f.contactTimeline),
      companyTimeline: clone(f.companyTimeline),
      conflicts: clone(f.conflicts),
      attribution: clone(f.attribution),
      clientSignals: clone(f.clientSignals),
    };
  }
  // Funnel taxonomy is static config, not mutable state — expose it without cloning per reset.
  WS.FUNNELS = WS.fixtures.FUNNELS;

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
    store.eventsPlayed = []; store.feedback = []; store.signals = []; store.dayStep = 0;
    store.clientsTab = 'deals'; store.dealsView = null; store.cgCtx = []; store.cgMenu = null; store.cgMode = 'auto'; store.cgDepth = 'think';
    store.capture = {}; store.dealFunnel = 'sale_offplan'; store.dealsFilter = {}; store.savedView = null;
    store.navOpen = false;
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

  // ---- declarative effects: scenarios mutate shared data on result (spec §18.2)
  function applyEffects(effects) {
    if (!effects || !effects.length) return;
    const d = store.data;
    effects.forEach((e) => {
      if (e.op === 'updateDeal') {
        const dl = d.deals.find((x) => x.id === e.id);
        if (dl) Object.assign(dl, e.patch);
      } else if (e.op === 'dealStage') {
        const dl = d.deals.find((x) => x.id === e.id);
        if (dl) dl.stage = e.stage;
      } else if (e.op === 'updateClient') {
        const c = d.clients.find((x) => x.id === e.id);
        if (c) Object.assign(c, e.patch);
      } else if (e.op === 'setObject') {
        const o = d.objects.find((x) => x.id === e.id);
        if (o) Object.assign(o, e.patch);
      } else if (e.op === 'addObject') {
        if (!d.objects.some((o) => o.id === e.obj.id)) d.objects.unshift(e.obj);
      } else if (e.op === 'addDeal') {
        if (!d.deals.some((x) => x.id === e.obj.id)) d.deals.unshift(e.obj);
      } else if (e.op === 'addClient') {
        if (!d.clients.some((c) => c.id === e.obj.id)) d.clients.unshift(e.obj);
      } else if (e.op === 'addTask') {
        if (!d.tasks.some((t) => t.id === e.task.id)) d.tasks.unshift(e.task);
      } else if (e.op === 'removeTask') {
        d.tasks = d.tasks.filter((t) => t.id !== e.id);
      } else if (e.op === 'clearInbox') {
        d.inbox = d.inbox.filter((i) => i.id !== e.id);
      } else if (e.op === 'analytics') {
        Object.assign(d.analytics, e.patch);
      }
    });
    save();
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
    save(); emit();
  }
  // Event edit (batch 5). Events live in data.events → restored by reset.
  function updateEvent(id, patch) {
    const ev = store.data.events.find((x) => x.id === id);
    if (!ev) return;
    Object.assign(ev, patch);
    save(); emit();
  }

  // Manual kanban move (batch 4). Stage is restored by resetAll/resetScene.
  function setDealStage(id, stage) {
    const dl = store.data.deals.find((x) => x.id === id);
    if (!dl || dl.stage === stage) return;
    dl.stage = stage;
    save(); emit();
  }

  function addTask(task) {
    const t = Object.assign({ status: 'open', when: 'today', kind: 'manual', due: 'сегодня' }, task);
    if (!store.data.tasks.some((x) => x.id === t.id)) store.data.tasks.unshift(t);
    save(); emit();
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
    setTheme, setRole, setView, setScenarioStatus, logEvent, applyEffects, taskAction, addTask, setDealStage, updateEvent, toast, clockLabel, clone,
  };
})(window.WS = window.WS || {});
