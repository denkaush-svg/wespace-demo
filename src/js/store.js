/* ============================================================
   State store — clients/deals/objects/tasks/events + persistence.
   Fixtures are never mutated; user changes live in `data`.
   ============================================================ */
(function (WS) {
  const KEY = 'wespace_demo_state';
  const SCHEMA = 13; // bump on any fixtures-shape change so stale localStorage is discarded. 2→3: users[].photo. 3→4: deals[].contacts (multi-contact with rating). 4→5: companies[] requisites. 5→6: objects[] address + commissionPct. 6→7: contactTimeline[] + dealTimeline for every deal + ord sort keys. 7→8: companyTimeline[]. 8→9: roster[] + dead analytics counters removed. 9→10: requests[] (заявка → сделки → лоты) + deals[].requestId + deals[].lots. 10→11: requests[] brief attributes + offered[] (selection state) + kp. 11→12: requestTimeline enriched (recent events 09–13 мая) — force re-seed so stale snapshots without them are discarded. 12→13: market[] (районы Дубая с происхождением цифр).
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
    dataRevision: 0,      // bumped by every write; a proposal built against an older one is stale
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
  const WRITABLE = {
    deals: {
      safe: ['tags', 'sub', 'title', 'updated', 'note', 'nextStep', 'consideredProjects'],
      guarded: ['stage', 'amount', 'hot', 'funnel', 'dealType', 'objectType', 'goal', 'paymentForm',
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
      guarded: ['status', 'when'],
    },
  };

  const OP_SPEC = {
    updateDeal: { coll: 'deals', kind: 'patch' },
    updateClient: { coll: 'clients', kind: 'patch' },
    updateObject: { coll: 'objects', kind: 'patch' },
    setObject: { coll: 'objects', kind: 'patch' },   // alias: scenario effects use this name
    updateTask: { coll: 'tasks', kind: 'patch' },
    dealStage: { coll: 'deals', kind: 'stage' },
    addTask: { coll: 'tasks', kind: 'add' },
    removeTask: { coll: 'tasks', kind: 'remove' },
    // Feed writes live in ui.js, where the ordering rules for a timeline are.
    // Routed through here anyway so a conversation has exactly one way to write,
    // and a batch that mixes a note with a stage change is still all-or-nothing.
    addEvent: { coll: null, kind: 'event' },
  };

  function fail(code, message, extra) {
    return Object.assign({ ok: false, code: code, error: message }, extra || {});
  }

  // Returns either a failure, or a plan entry: { ok, tier, summary, run }.
  function planOp(o, i) {
    const at = 'операция ' + (i + 1) + ': ';
    if (!o || !o.op) return fail('bad_op', at + 'не указана операция');
    const spec = OP_SPEC[o.op];
    if (!spec) return fail('unknown_op', at + 'неизвестная операция «' + o.op + '»', { available: Object.keys(OP_SPEC) });

    if (spec.kind === 'event') {
      const txt = String(o.text == null ? '' : o.text).trim();
      if (!txt) return fail('bad_value', at + 'пустой текст события');
      if (!WS.ui || !WS.ui.feedOwner || !WS.ui.feedOwner(o.scope, o.id)) {
        return fail('not_found', at + 'нет сущности ' + o.scope + ' ' + o.id);
      }
      return {
        ok: true, tier: 'safe', summary: 'событие в ' + o.scope + ' ' + o.id,
        run: () => { WS.ui.addEventEntry(o.scope, o.id, { type: o.type, text: txt, when: o.when, due: o.due, dueWhen: o.dueWhen }); },
      };
    }

    const coll = store.data[spec.coll];
    if (!Array.isArray(coll)) return fail('no_collection', at + 'нет коллекции ' + spec.coll);

    if (spec.kind === 'add') {
      const rec = o.task || o.obj || o.record;
      if (!rec || !rec.id) return fail('bad_record', at + 'нет записи или её id');
      if (coll.some((x) => x.id === rec.id)) return fail('duplicate', at + 'запись ' + rec.id + ' уже есть');
      return { ok: true, tier: 'safe', summary: o.op + ' ' + rec.id, run: () => { coll.unshift(rec); } };
    }
    if (spec.kind === 'remove') {
      const idx = coll.findIndex((x) => x.id === o.id);
      if (idx < 0) return fail('not_found', at + 'нет записи ' + o.id + ' в ' + spec.coll);
      return { ok: true, tier: 'guarded', summary: o.op + ' ' + o.id, run: () => { coll.splice(idx, 1); } };
    }

    const rec = coll.find((x) => x.id === o.id);
    if (!rec) return fail('not_found', at + 'нет записи ' + o.id + ' в ' + spec.coll, { collection: spec.coll, id: o.id });

    if (spec.kind === 'stage') {
      if (!o.stage) return fail('bad_value', at + 'не указана стадия');
      return { ok: true, tier: 'guarded', summary: 'стадия ' + o.id + ' → ' + o.stage, run: () => { rec.stage = o.stage; } };
    }

    const patch = o.patch;
    if (!patch || typeof patch !== 'object') return fail('bad_patch', at + 'нет полей для изменения');
    const keys = Object.keys(patch);
    if (!keys.length) return fail('bad_patch', at + 'пустой набор полей');
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
      summary: spec.coll + ' ' + o.id + ': ' + keys.join(', '),
      run: () => { Object.assign(rec, patch); },
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
    let tier = 'safe';
    for (let i = 0; i < ops.length; i++) {
      const p = planOp(ops[i], i);
      if (!p.ok) return p;                       // nothing has been touched yet
      if (p.tier === 'guarded') tier = 'guarded';
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
    let tier = 'safe';
    for (let i = 0; i < ops.length; i++) {
      const p = planOp(ops[i], i);
      if (!p.ok) return p;
      if (p.tier === 'guarded') tier = 'guarded';
      plan.push(p);
    }
    return { ok: true, tier: tier, revision: store.dataRevision, pending: plan.map((p) => p.summary) };
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
    store.dataRevision++; save(); emit();
  }

  function addTask(task) {
    const t = Object.assign({ status: 'open', when: 'today', kind: 'manual', due: 'сегодня' }, task);
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
    setTheme, setRole, setView, setScenarioStatus, logEvent, applyEffects, apply, preview, taskAction, addTask, setDealStage, updateEvent, toast, clockLabel, clone,
  };
})(window.WS = window.WS || {});
