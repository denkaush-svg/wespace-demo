/* ============================================================
   Bootstrap + router + global event delegation.
   ============================================================ */
(function (WS) {
  const store = WS.store;
  const api = WS.storeApi;

  // ---- router + navigation history ----
  // A route in this app is a screen plus the one id that screen reads. That pair is the whole of
  // what «где я был» means here, so history is a list of such pairs — no URL layer needed.
  const ROUTE_ID = {
    dealDetail: 'dealId', clientDetail: 'clientId', objectDetail: 'objectId',
    companyDetail: 'companyId', requestDetail: 'requestId', contractDetail: 'contractId',
  };
  function routeNow() {
    const f = ROUTE_ID[store.view];
    return { view: store.view, id: f ? store[f] : null, tab: store.view === 'clients' ? store.clientsTab : null };
  }
  function sameRoute(a, b) { return !!a && !!b && a.view === b.view && a.id === b.id && a.tab === b.tab; }
  // The route being LEFT is the one that was last rendered, not the one the store holds now: card
  // openers write their id before navigating, so reading the store at this point would already
  // return the destination.
  function pushHistory() {
    const from = store.navHere, to = routeNow();
    if (!from || sameRoute(from, to)) return;
    const st = store.navStack || (store.navStack = []);
    // Returning to a screen already in the trail rewinds to it instead of stacking: сделка →
    // клиент → сделка → клиент would otherwise grow a trail nobody can walk back out of.
    const seen = st.findIndex((r) => sameRoute(r, to));
    if (seen >= 0) { st.length = seen; return; }
    if (!sameRoute(st[st.length - 1], from)) st.push(from);
    if (st.length > 24) st.shift();
  }
  WS.router = {
    go(view, opts) {
      opts = opts || {};
      store.navOpen = false;
      WS.ui.closeModal();
      store.view = view;
      if (!opts.replace) pushHistory();
      api.emit();
    },
    peek() { const st = store.navStack || []; return st[st.length - 1] || null; },
    back() {
      const st = store.navStack || [];
      const prev = st.pop();
      if (!prev) return false;
      store.navOpen = false;
      WS.ui.closeModal();
      const f = ROUTE_ID[prev.view];
      if (f) store[f] = prev.id;
      if (prev.tab) store.clientsTab = prev.tab;
      store.view = prev.view;
      api.emit();
      return true;
    },
    // Called by the renderer once a screen is actually on display.
    mark() { store.navHere = routeNow(); },
  };

  // ---- free-text routing ----
  // Shortcuts match the WHOLE phrase, not a fragment of it. The previous substring
  // rules meant a typed question never reached the Concierge at all: "какой объект даёт
  // лучший ROI?" matched /объект/ and opened a selection screen, and anything mentioning
  // доходность opened the calculator. Questions are for the Concierge; these are only
  // the spoken equivalents of the buttons already on screen.
  const PROMPT_SHORTCUTS = {
    'g1': () => WS.engine.startScenario('G1'),
    'g2': () => WS.engine.startScenario('G2'),
    'g3': () => WS.engine.startScenario('G3'),
    'разобрать входящее': () => WS.engine.startScenario('G1'),
    'подобрать объект': () => WS.engine.startScenario('G2'),
    'итоги показа': () => WS.engine.startScenario('G3'),
    'ответить лиду': () => WS.engine.startScenario('S15'),
    'бриф к звонку': () => WS.engine.startScenario('S8'),
    'финмодель': () => WS.router.go('calc'),
    'оценка объекта': () => WS.router.go('valuation'),
  };
  function routePrompt(text) {
    const t = (text || '').toLowerCase().trim().replace(/[.!?…]+$/, '');
    if (!t) return;
    const shortcut = PROMPT_SHORTCUTS[t];
    if (shortcut) return shortcut();
    return WS.engine.freeReply(text);
  }
  WS.router.routePrompt = routePrompt;

  function promptValue(id) { const i = document.getElementById(id); const v = i ? i.value : ''; if (i) i.value = ''; return v; }

  // ---- delegated click handler ----
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-nav],[data-scn],[data-chain],[data-thread],[data-replay],[data-scenereset],[data-role],[data-objfilter],[data-objarea],[data-shortlist],[data-podbor],[data-fin],[data-scen],[data-artopen],[data-taskdone],[data-taskreopen],[data-tasksnooze],[data-taskreassign],[data-taskassign],[data-deal],[data-dealmove],[data-dealstage],[data-event],[data-evplay],[data-fb],[data-mqual],[data-mpsych],[data-caldir],[data-calday],[data-newthread],[data-client],[data-obj],[data-doc],[data-eng],[data-cgctx],[data-cgctxdel],[data-cgmode],[data-cgatt],[data-cgdepth],[data-dfconfirm],[data-conflict],[data-notedel],[data-cnotedel],[data-conotedel],[data-fetype],[data-funnel],[data-savedview],[data-exresolve],[data-analytics],[data-signaltoggle],[data-company],[data-viz],[data-export],[data-contacttype],[data-valobj],[data-promo],[data-dcedit],[data-dcdel],[data-etab],[data-oggal],[data-clubcomm],[data-clubreq],[data-svcreq],[data-dealbudget],[data-dealsrc],[data-objpurpose],[data-teamagent],[data-leadassign],[data-approve],[data-reject],[data-taskpreset],[data-tasksdue],[data-tasksstatus],[data-netchat],[data-netsel],[data-nettype],[data-task],[data-navtoggle],[data-agok],[data-agcancel],[data-agev],[data-agnext],[data-request],[data-reqobj],[data-reqaddobj],[data-commsfilter],[data-contactfilter],[data-group-toggle],[data-gate],[data-contract],[data-agsay],[data-rpopen],[data-rpsave],[data-relstage],[data-cueok],[data-cueno],[data-lotexit],[data-lotunblock],[data-offernew],[data-offeredit],[data-ocok],[data-ocno],[data-reqturn],[data-act]');
    if (!t) return;
    // Typing is not navigating. A click that starts inside an editable field belongs to the field,
    // however many navigable ancestors it happens to sit under.
    if (e.target.closest && e.target.closest('[contenteditable="true"], input, textarea, select')) return;
    const d = t.dataset;

    // An explicit action wins over navigation, always. Elements legitimately carry both — a verb
    // needs the id of the thing it acts on — and every navigation branch below would otherwise have
    // to remember to exempt data-act. Two shipped without it: the contract verbs reopened the card
    // and did nothing else.
    if (d.act) return handleAct(d.act, t);


    if (d.groupToggle) {
      const groupId = d.groupToggle;
      if (!store.cgGroupCollapse) store.cgGroupCollapse = {};
      store.cgGroupCollapse[groupId] = !store.cgGroupCollapse[groupId];
      WS.ui.refreshCgRail();
      return;
    }

    if (d.rpopen) return WS.engine.reportOpen(d.rpopen);
    if (d.rpsave) return WS.engine.reportSave(d.rpsave);
    if (d.nav) { if (d.tab) store.clientsTab = d.tab; return WS.router.go(d.nav); }
    if (d.thread) { store.navOpen = false; WS.ui.closeModal(); return WS.engine.openThread(d.thread, d.tlabel, d.ticon); }
    if (d.chain) { store.navOpen = false; WS.ui.closeModal(); return WS.engine.startChain(d.chain); }
    if (d.scn) { store.navOpen = false; WS.ui.closeModal(); return WS.engine.startScenario(d.scn); }
    if (d.replay) { api.setScenarioStatus(d.replay, 'not'); api.resetScene(d.replay); store.navOpen = false; return WS.engine.startScenario(d.replay); }
    if (d.scenereset) { api.resetScene(d.scenereset); api.toast('Сцена ' + d.scenereset + ' сброшена'); return; }
    if (d.role) { store.view = 'start'; store.navOpen = false; store.navStack = []; return api.setRole(d.role); }
    if (d.teamagent) { store.teamAgent = d.teamagent; return api.emit(); }
    if (d.taskpreset) { const m = { open: ['open', 'all'], today: ['open', 'today'], overdue: ['open', 'overdue'], done: ['done', 'all'], all: ['all', 'all'] }[d.taskpreset]; if (m) { store.tasksStatus = m[0]; store.tasksDue = m[1]; } return api.emit(); }
    if (d.tasksdue) { store.tasksDue = d.tasksdue; return api.emit(); }
    if (d.tasksstatus) { store.tasksStatus = d.tasksstatus; return api.emit(); }
    if (d.commsfilter) { store.commsFilter = d.commsfilter; return WS.ui.refreshCommsTab(t); }
    if (d.netchat) { store.netChat = d.netchat; return api.emit(); }
    if (d.netsel) { store.netSel = d.netsel; return api.emit(); }
    if (d.nettype) { store.netType = d.nettype; return api.emit(); }
    if (d.navtoggle) { store.navHidden = store.navHidden || []; const i = store.navHidden.indexOf(d.navtoggle); if (i >= 0) store.navHidden.splice(i, 1); else store.navHidden.push(d.navtoggle); return api.emit(); }
    if (d.leadassign) { const p = d.leadassign.split('~~'); const arr = store.data.inbox || []; const ix = +p[0]; if (ix >= 0 && ix < arr.length) arr.splice(ix, 1); api.toast('Заявка распределена: ' + (p[1] || 'агенту'), 'ok'); return api.emit(); }
    if (d.approve) { store.apprDone = store.apprDone || []; if (store.apprDone.indexOf(+d.approve) < 0) store.apprDone.push(+d.approve); api.toast('Согласовано — зафиксировано в истории сделки', 'ok'); return api.emit(); }
    if (d.reject) { store.apprDone = store.apprDone || []; if (store.apprDone.indexOf(+d.reject) < 0) store.apprDone.push(+d.reject); api.toast('Отклонено — возвращено агенту'); return api.emit(); }
    if (d.objfilter) { store.objFilter = d.objfilter; return api.emit(); }
    if (d.clubcomm) { store.clubComm = d.clubcomm; return api.emit(); }
    if (d.clubreq) return WS.ui.openClubRequest(d.clubreq);
    if (d.svcreq) return WS.ui.openServiceRequest(+d.svcreq);
    if (d.dealbudget) { store.dealBudget = d.dealbudget; return api.emit(); }
    if (d.dealsrc) { store.dealSrc = d.dealsrc; return api.emit(); }
    if (d.objpurpose) { store.objPurpose = d.objpurpose; return api.emit(); }
    if (d.contacttype) { store.contactType = d.contacttype; return api.emit(); }
    if (d.objarea) { store.objArea = d.objarea; return api.emit(); }
    if (d.shortlist) {
      const i = store.shortlist.indexOf(d.shortlist);
      if (i >= 0) store.shortlist.splice(i, 1); else store.shortlist.push(d.shortlist);
      api.toast(i >= 0 ? 'Убрано из подборки' : 'Добавлено в подборку', 'ok');
      return api.emit();
    }
    if (d.fin) { store.navOpen = false; return WS.ui.openFinance(d.fin); }
    if (d.valobj) { store.navOpen = false; WS.ui.valFromObj(d.valobj); return WS.router.go('valuation'); }
    if (d.promo) { store.navOpen = false; return WS.ui.openPromotion(d.promo); }
    if (d.oggal) { e.stopPropagation(); return WS.ui.objGalleryNav(+d.oggal); }
    if (d.scen) return WS.ui.finScenario(d.scen);
    if (d.podbor) { store.podborClient = d.podbor; return api.emit(); }
    // Выполнение открывает короткую форму итога. Комментарий необязателен: обязательное поле
    // здесь — прямой путь к тому, что задачи перестанут закрывать вовсе.
    if (d.taskdone) return WS.ui.taskDoneForm(d.taskdone);
    if (d.taskreopen) { return api.taskAction(d.taskreopen, 'reopen'); }
    if (d.tasksnooze) { api.taskAction(d.tasksnooze, 'snooze'); return api.toast('Отложено на завтра'); }
    if (d.dealmove) { e.stopPropagation(); return WS.ui.moveDealDir(d.dealmove, d.dir); }
    if (d.etab) { const p = d.etab.split('~'); return WS.ui.setEntityTab(p[0], p[1], p[2], t); }
    if (d.dealstage) return api.setDealStage(d.dealstage, d.stage);
    if (d.gate) return WS.ui.toggleGate(d.gate);
    if (d.contract) return WS.ui.contractCard(d.contract);
    if (d.task) return WS.ui.taskCard(d.task);
    if (d.request) return WS.ui.requestCard(d.request);
    if (d.reqobj) { const p = d.reqobj.split('~'); return WS.ui.reqObjState(p[0], p[1], p[2]); }
    if (d.reqaddobj) { const p = d.reqaddobj.split('~'); return WS.ui.reqAddObjectDo(p[0], p[1]); }
    if (d.deal) return WS.ui.dealCard(d.deal);
    if (d.evplay) { WS.ui.closeModal(); return WS.eventEngine.play(d.evplay); }
    if (d.fb) return WS.eventEngine.recordFb(d.fb, d.fbval);
    if (d.mqual) { const m = store.match || (store.match = {}); m.qual = m.qual || []; const i = m.qual.indexOf(d.mqual); if (i >= 0) m.qual.splice(i, 1); else m.qual.push(d.mqual); return api.emit(); }
    if (d.mpsych) { const m = store.match || (store.match = {}); m.psych = !m.psych; return api.emit(); }
    if (d.caldir) { store.calDir = d.caldir; return api.emit(); }
    if (d.calday) { const n = +d.calday; store.calDay = (store.calDay === n ? -1 : n); return api.emit(); }
    if (d.event) return WS.ui.showCard(d.event);
    if (d.newthread) { WS.ui.closeModal(); return WS.engine.openThread(d.newthread, d.tlabel, d.ticon); }
    if (d.taskreassign) return WS.ui.openReassign(d.taskreassign);
    if (d.taskassign) { api.taskAction(d.taskassign, 'reassign', d.who); WS.ui.closeModal(); return api.toast('Задача переназначена', 'ok'); }
    if (d.artopen) { WS.ui.closeModal(); return WS.ui.openArtifactId(d.artopen); }
    if (d.client) return WS.ui.clientCard(d.client);
    if (d.obj) { WS.ui.setObjOrigin(d.fromreq || null); return WS.ui.objectCard(d.obj); }
    if (d.doc) { WS.ui.openDoc(d.doc); return; }
    if (d.cgctx) { const p = d.cgctx.split('~~'); store.cgCtx = store.cgCtx || []; const ix = store.cgCtx.findIndex((c) => c.label === p[1]); if (ix >= 0) store.cgCtx.splice(ix, 1); else store.cgCtx.push({ icon: p[0], label: p[1] }); return api.emit(); }
    if (d.cgctxdel) { (store.cgCtx || []).splice(+d.cgctxdel, 1); return api.emit(); }
    if (d.cgmode) { store.cgMode = d.cgmode; store.cgMenu = null; return api.emit(); }
    if (d.cgatt) { const p = d.cgatt.split('~~'); store.cgCtx = store.cgCtx || []; store.cgCtx.push({ icon: p[0], label: p[1], att: true }); store.cgMenu = null; return api.emit(); }
    if (d.cgdepth) { store.cgDepth = d.cgdepth; return api.emit(); }
    if (d.dfconfirm) { const p = d.dfconfirm.split(':'); const dl = store.data.deals.find((x) => x.id === p[0]); if (dl) { dl.prov = dl.prov || {}; dl.prov[p[1]] = 'confirmed'; } api.toast('Поле подтверждено', 'ok'); return WS.ui.dealCard(p[0]); }
    // Расхождение живёт и на сделке (сумма), и на заявке (бюджет) — запись выбирается по id,
    // а не по предположению, что это всегда сделка.
    if (d.conflict) {
      const p = d.conflict.split(':');
      const cf = (store.data.conflicts || {})[p[0]];
      const dl = store.data.deals.find((x) => x.id === p[0]);
      const rq = (store.data.requests || []).find((x) => x.id === p[0]);
      if (cf) { cf.chosen = p[1]; const v = cf[p[1] + 'v']; if (v && dl) dl.amount = v; else if (v && rq) rq.budget = v; }
      api.save(); api.toast('Значение выбрано; альтернатива сохранена', 'ok');
      return rq && !dl ? WS.ui.requestCard(p[0]) : WS.ui.dealCard(p[0]);
    }
    if (d.notedel) { const p = d.notedel.split(':'); const arr = (store.data.dealTimeline || {})[p[0]]; if (arr) arr.splice(+p[1], 1); api.save(); api.toast('Заметка удалена'); return WS.ui.dealCard(p[0]); }
    if (d.cnotedel) { const p = d.cnotedel.split(':'); const arr = (store.data.contactTimeline || {})[p[0]]; if (arr) arr.splice(+p[1], 1); api.save(); api.toast('Заметка удалена'); return WS.ui.clientCard(p[0]); }
    if (d.conotedel) { const p = d.conotedel.split(':'); const arr = (store.data.companyTimeline || {})[p[0]]; if (arr) arr.splice(+p[1], 1); api.save(); api.toast('Заметка удалена'); return WS.ui.companyCard(p[0]); }
    if (d.fetype) return WS.ui.setFeedType(d.fetype);
    if (d.agok) return WS.engine.agentConfirm(d.agok);
    if (d.agcancel) return WS.engine.agentCancel(d.agcancel);
    // A chip key is «<id сообщения>:<номер>», not a number. Coercing it with +
    // gave NaN here and every chip in the running stand did nothing at all —
    // the tests called the handlers directly and never saw it.
    if (d.agev != null) return WS.ui.openAgentEvidence(d.agev);
    if (d.agnext != null) return WS.engine.agentNext(d.agnext);
    if (d.agsay != null) return WS.voice.sayReply(d.agsay);
    if (d.dcedit) { const p = d.dcedit.split(':'); return WS.ui.openDealContactForm(p[0], +p[1]); }
    if (d.dcdel) { const p = d.dcdel.split(':'); return WS.ui.removeDealContact(p[0], +p[1]); }
    // Вывод лота из сделки: исход обязателен, поэтому сначала форма, а не немедленное действие.
    if (d.lotexit) { const p = d.lotexit.split(':'); return WS.ui.lotExitForm(p[0], p[1]); }
    if (d.lotunblock) { const p = d.lotunblock.split(':'); return WS.ui.undoLotBlock(p[0], p[1]); }
    // Предложение: новая версия заводится явно, правка отправленной — порождает следующую.
    if (d.offernew) { const p = d.offernew.split(':'); const o = WS.ui.newOffer(p[0], p[1]); return o ? WS.ui.openOfferForm(o.id) : api.toast('Нечего предлагать — выберите объекты'); }
    if (d.offeredit) return WS.ui.editOffer(d.offeredit);
    if (d.reqturn) { const p = d.reqturn.split('~'); WS.ui.setTurn(p[0], p[1], p[2]); return api.emit(); }
    // Итог, написанный моделью, входит в историю только подтверждённым.
    if (d.ocok) { const sc = WS.ui.outcomesFor; WS.ui.confirmOutcome(d.ocok); return api.emit(); }
    if (d.ocno) { WS.ui.rejectOutcome(d.ocno); return api.emit(); }
    // Отношения: стадия правится вручную, повод принимается задачей или отклоняется.
    if (d.relstage) { const p = d.relstage.split(':'); WS.ui.setRelStage(p[0], p[1]); return WS.ui.clientCard(p[0]); }
    if (d.cueok) { WS.ui.acceptCue(d.cueok); return WS.ui.clientCard(d.cueok.split('~')[0]); }
    if (d.cueno) { WS.ui.dismissCue(d.cueno); return WS.ui.clientCard(d.cueno.split('~')[0]); }
    // «Все воронки» — состояние списка, а не воронка: выбранная воронка при этом запоминается,
    // чтобы переход на доску не потерял её. Ровно то, на что жаловался партнёр.
    if (d.funnel) {
      if (d.funnel === 'all') store.dealFunnelAll = true;
      else { store.dealFunnel = d.funnel; store.dealFunnelAll = false; }
      return api.emit();
    }
    if (d.analytics) return WS.ui.openAnalyticsDrill(d.analytics);
    if (d.company) return WS.ui.companyCard(d.company);
    // A saved view only renders on the deals board, so a trigger that also carries data-nav must
    // land there — otherwise the manager's tile sets a filter on a screen that never shows it.
    if (d.savedview) { store.savedView = store.savedView === d.savedview ? null : d.savedview;
      if (d.nav) { store.clientsTab = 'deals'; return WS.router.go(d.nav); }
      return api.emit(); }
    if (d.exresolve) { return WS.ui.resolveException(d.exresolve); }
    if (d.contactfilter) { const p = d.contactfilter.split(':'); store.contactsFilters = store.contactsFilters || {}; store.contactsFilters[p[0]] = p[1]; return api.emit(); }
    if (d.eng) return WS.engine.handle(d.eng, d);


  });

  function handleAct(act, t) {
    switch (act) {
      case 'theme': api.setTheme(store.theme === 'dark' ? 'light' : 'dark'); break;
      case 'notif': api.toast('Уведомления: ' + (store.unsaved || 0) + ' несохранённых подтверждений'); break;
      case 'wallet': WS.ui.openWallet(); break;
      case 'contractDoc': WS.ui.contractDocOpen(t.dataset.kref, t.dataset.docname); break;
      case 'contractAmend': case 'contractInvoice': case 'contractRenew': case 'contractTerminate':
        WS.ui.contractAct(act, t.dataset.kref); break;
      case 'navBack': WS.router.back(); break;
      case 'settings': WS.router.go('settings'); break;
      case 'profile': WS.router.go('profile'); break;
      case 'reset':
        WS.ui.closeModal();
        WS.ui.openModal('Сбросить весь стенд?',
          '<p>Все результаты сценариев, события и изменения вернутся к исходному демонстрационному состоянию. Действие не требует перезагрузки страницы.</p>',
          '<button class="btn" data-act="closeModal">Отмена</button><button class="btn danger" data-act="doReset">' + WS.icon('reset') + 'Сбросить всё</button>');
        break;
      case 'doReset': api.resetAll(); WS.ui.closeModal(); api.toast('Стенд сброшен к исходному состоянию', 'ok'); WS.router.go('start'); break;
      case 'navigator': store.navOpen = !store.navOpen; api.emit(); break;
      case 'sections': WS.ui.openSections(); break;
      case 'help': WS.ui.openHelp(); break;
      case 'importObjects':
        WS.ui.openModal('Импорт объектов',
          '<p>Загрузка объектов из CSV или подключённого фида застройщика. В демо доступен подготовленный набор: параметры, источник каждого поля и дедупликация против текущего инвентаря.</p>' +
          '<div class="prov" style="margin-top:10px"><span class="badge">' + WS.icon('download') + 'developers_feed.csv · 12 строк</span><span class="badge warn">' + WS.icon('warn') + '2 возможных дубля</span><span class="badge demo">' + WS.icon('lock') + 'DEMO</span></div>' +
          '<p style="margin-top:10px;color:var(--mut);font-size:12px">Импортированные объекты получают источник «Импорт застройщика» и статус проверки «требует проверки» до сверки у источника. Одиночный объект можно завести иначе — прислать брошюру/фото Консьержу (сценарий S2), он извлечёт поля и соберёт карточку.</p>',
          '<button class="btn" data-act="closeModal">Отмена</button><button class="btn" data-scn="S2">' + WS.icon('upload') + 'Брошюра → Консьерж (S2)</button><button class="btn primary" data-act="importRun" data-impkind="objects">' + WS.icon('check') + 'Распознать и импортировать</button>');
        break;
      case 'importContacts':
        WS.ui.openModal('Импорт контактов',
          '<p>Загрузка контактов — база, по которой работают инструменты коммуникации агентов (AI-секретарь: исходящие звонки и сообщения, приём входящих). В демо доступен подготовленный набор.</p>' +
          '<div class="section-label" style="margin-top:8px">Источник</div>' +
          '<div class="prov"><span class="badge">' + WS.icon('download') + 'CSV / Excel</span><span class="badge">' + WS.icon('phone') + 'Телефонная книга</span><span class="badge">' + WS.icon('whatsapp') + 'WhatsApp Business</span><span class="badge">' + WS.icon('building') + 'Портал (Property Finder / Bayut)</span><span class="badge demo">' + WS.icon('lock') + 'DEMO</span></div>' +
          '<div class="section-label" style="margin-top:10px">Предпросмотр · leads_export.csv · 8 контактов</div>' +
          '<div class="prov"><span class="badge ok">' + WS.icon('check') + '5 с действующим согласием</span><span class="badge stop">' + WS.icon('lock') + '2 без согласия</span><span class="badge warn">' + WS.icon('warn') + '1 дубль (объединить)</span></div>' +
          '<p style="margin-top:10px;color:var(--mut);font-size:12px">Импорт устанавливает не только карточку, но и <b>правовое основание для контакта</b>: согласие (PDPL) и проверку по реестру отказов (DNCR). Контакты без согласия загружаются в базу, но AI-секретарь их <b>не набирает и не пишет</b> — исходящие только по явному согласию и «тёплому» признаку. Дубли объединяются с существующими карточками.</p>',
          '<button class="btn" data-act="closeModal">Отмена</button><button class="btn primary" data-act="importRun" data-impkind="contacts">' + WS.icon('check') + 'Распознать и импортировать</button>');
        break;
      case 'importRun': WS.eventEngine.importRun(t.dataset.impkind); break;
      case 'importGo': WS.eventEngine.importGo(t.dataset.impkind); break;
      case 'clearShortlist': store.shortlist = []; api.toast('Подборка очищена'); api.emit(); break;
      case 'newTask': WS.ui.openNewTask(); break;
      case 'newThread': WS.ui.openNewThread(); break;
      case 'cgFeature': WS.ui.openCgFeature(t.dataset.feat); break;
      case 'exportDeals': api.toast('Экспорт .xlsx сформирован из фикстур (демо-скачивание)', 'ok'); break;
      case 'auditLog': WS.ui.openAuditLog(); break;
      case 'editDeal': WS.ui.openDealEdit(t.dataset.deal); break;
      case 'saveDeal': WS.ui.saveDealEdit(t.dataset.deal); break;
      case 'editGoal': WS.ui.openGoalEdit(t.dataset.goal); break;
      case 'toggleGoalPin': WS.ui.toggleGoalPin(t.dataset.goal); break;
      case 'saveGoal': WS.ui.saveGoal(t.dataset.goal); break;
      case 'deleteGoal': WS.ui.deleteGoal(t.dataset.goal); break;
      case 'confirmDeleteGoal': WS.ui.confirmDeleteGoal(t.dataset.goal); break;
      case 'addGoal': WS.ui.addGoal(); break;
      case 'createGoal': WS.ui.createGoal(); break;
      case 'addEvent': { const sc = t.dataset.scope || 'deal'; WS.ui.openEventForm(sc, sc === 'contact' ? t.dataset.cid : sc === 'company' ? t.dataset.coid : t.dataset.deal); break; }
      case 'saveEventEntry': WS.ui.saveEventEntry(t.dataset.scope || 'deal', t.dataset.eid); break;
      case 'addDealContact': WS.ui.openDealContactForm(t.dataset.deal, -1); break;
      case 'saveDealContact': WS.ui.saveDealContact(t.dataset.deal, +t.dataset.idx); break;
      case 'saveLotExit': WS.ui.saveLotExit(t.dataset.deal, t.dataset.obj); break;
      case 'finishDeal': WS.ui.finishDealForm(t.dataset.deal); break;
      case 'transferDeal': WS.ui.dealTransferForm(t.dataset.deal); break;
      case 'saveTransfer': WS.ui.saveTransfer(t.dataset.deal); break;
      case 'partnerDeal': WS.ui.dealPartnerForm(t.dataset.deal); break;
      case 'savePartner': WS.ui.savePartner(t.dataset.deal); break;
      case 'saveOffer': WS.ui.saveOffer(t.dataset.offer); break;
      case 'saveTaskDone': WS.ui.saveTaskDone(t.dataset.task); break;
      case 'sendOffer': WS.ui.sendOffer(t.dataset.offer); break;
      case 'saveFinishDeal': WS.ui.saveFinishDeal(t.dataset.deal); break;
      case 'capToggle': { const id = t.dataset.deal; store.capture = store.capture || {}; const cur = (id in store.capture) ? store.capture[id] : true; store.capture[id] = !cur; api.toast('Запись разговоров: ' + (store.capture[id] ? 'включена' : 'выключена'), 'ok'); WS.ui.dealCard(id); break; }
      case 'cgFeatureStub': WS.ui.closeModal(); api.toast('Настройка сохранена (демо)', 'ok'); break;
      case 'cgAttach': store.cgMenu = store.cgMenu === 'attach' ? null : 'attach'; api.emit(); break;
      case 'cgModeMenu': store.cgMenu = store.cgMenu === 'mode' ? null : 'mode'; api.emit(); break;
      case 'cgCtxAdd': store.cgMenu = store.cgMenu === 'ctx' ? null : 'ctx'; api.emit(); break;
      case 'psychForm': WS.ui.openPsychForm(t.dataset.cid); break;
      case 'psychSave': WS.ui.savePsychForm(t.dataset.cid); break;
      case 'dealsView': store.dealsView = t.dataset.v; api.emit(); break;
      case 'netTab': store.netTab = t.dataset.nettab; api.emit(); break;
      case 'netMsg': store.netSel = t.dataset.nettarget; store.netTab = 'contacts'; api.emit(); break;
      case 'toggleMenuSet': store.setMenuOpen = !store.setMenuOpen; api.emit(); break;
      case 'newDeal': WS.ui.openDealForm(t.dataset.cid); break;
      case 'createDeal': WS.ui.createDeal(); break;
      case 'newContact': WS.ui.openContactForm(); break;
      case 'createContact': WS.ui.createContact(); break;
      case 'newObject': WS.ui.openObjectForm(); break;
      case 'createObject': WS.ui.createObject(); break;
      case 'presenter': WS.eventEngine.openPresenter(); break;
      case 'playDay': WS.eventEngine.playDay(); break;
      case 'nextDay': WS.ui.closeModal(); WS.eventEngine.nextDay(); break;
      case 'sessionResults': WS.eventEngine.sessionResults(); break;
      case 'callSelf': WS.eventEngine.callSelf(); break;
      case 'callClient': WS.ui.callClient(t.dataset.cid); break;
      case 'reqAddObject': WS.ui.reqAddObject(t.dataset.req); break;
      case 'reqFormKp': WS.ui.reqFormKp(t.dataset.req); break;
      case 'reqCreateDeal': WS.ui.reqCreateDeal(t.dataset.req); break;
      case 'editRequest': WS.ui.openRequestEdit(t.dataset.req); break;
      case 'saveRequest': WS.ui.saveRequestEdit(t.dataset.req); break;
      case 'openReqKp': WS.ui.openReqKp(t.dataset.req); break;
      case 'openDealKp': WS.ui.openDealKp(t.dataset.deal); break;
      case 'callAi': WS.eventEngine.callAi(); break;
      case 'failHuman': WS.eventEngine.failResolve('human'); break;
      case 'failPick': WS.eventEngine.failResolve(t.dataset.deal); break;
      case 'taskCreate': WS.ui.createTaskFromForm(); break;
      case 'eventSave': WS.ui.saveEvent(t.dataset.ev); break;
      case 'eventCancel': api.updateEvent(t.dataset.ev, { status: 'canceled' }); WS.ui.closeModal(); api.toast('Показ отменён'); break;
      case 'eventRestore': api.updateEvent(t.dataset.ev, { status: 'planned' }); WS.ui.closeModal(); api.toast('Показ восстановлен', 'ok'); break;
      case 'calWeek': store.calWeek = (store.calWeek || 0) + (+t.dataset.d); store.calDay = -1; api.emit(); break;
      case 'calDayClear': store.calDay = -1; api.emit(); break;
      case 'doctab': store.docTab = t.dataset.tab; api.emit(); break;
      case 'docClear': store.docSearch = ''; api.emit(); break;
      case 'contactsSearchClear': store.contactsSearch = ''; api.emit(); break;
      case 'companiesSearchClear': store.companiesSearch = ''; api.emit(); break;
      case 'conciergeSearchClear': store.conciergeSearch = ''; api.emit(); break;
      case 'contactsFiltersToggle': store.contactsFiltersOpen = !store.contactsFiltersOpen; api.emit(); break;
      case 'clearCompaniesFilters': store.companiesSearch = ''; store.companiesFilters = { client: 'all' }; api.emit(); break;
      case 'clearContactsFilters': store.contactsSearch = ''; store.contactsFilters = { priority: 'all', psych: 'all', object: 'all', area: 'all', budget: 'all', state: 'all', consent: 'all' }; api.emit(); break;
      case 'clearDealFilters': store.dealSrc = 'all'; store.dealObjType = 'all'; store.dealReadiness = 'all'; store.dealAgent = 'all'; store.dealStage = 'all'; store.dealBudFrom = ''; store.dealBudTo = ''; store.dealSearch = ''; api.emit(); break;
      case 'closeNav': store.navOpen = false; api.emit(); break;
      case 'closeModal': WS.ui.closeModal(); break;
      case 'endTour': store.tour = { active: false, scenarioId: null, stepIndex: 0 }; api.emit(); break;
      case 'restartScene': WS.engine.restartScene(); break;
      case 'threadBack': WS.engine.closeThread(); break;
      case 'cltab': store.clientsTab = t.dataset.tab; api.emit(); break;
      // Real dictation where the browser has it. Where it does not, the stand
      // says so and shows the voice scenario instead of pretending to listen.
      case 'voice': {
        const box = t.closest ? t.closest('.prompt') : null;
        const input = box ? box.querySelector('input') : null;
        if (WS.voice.canDictate() && input) { WS.voice.dictate(input); break; }
        /* Name the cause. «Недоступна» sent a colleague looking for a broken
           button: Firefox has no SpeechRecognition at all, Safari has it but
           needs the microphone granted to it in System Settings, and Chrome
           has both. Which of the three it is decides what the person does
           next, so the message says it. */
        // A short toast with the one actionable instruction, not a manual.
        // Which browser it is matters: that determines what the person does next.
        api.toast(WS.voice.canDictate()
          ? 'Нажмите микрофон в строке ввода Консьержа'
          : (typeof window !== 'undefined' && /safari/i.test(String(window.navigator && window.navigator.userAgent))
              && !/chrome/i.test(String(window.navigator && window.navigator.userAgent))
              ? 'Safari: разрешите микрофон в Системных настройках → Конфиденциальность → Микрофон'
              : 'Этот браузер не поддерживает диктовку. Откройте в Chrome или Safari'));
        if (store.view === 'start') WS.engine.startScenario('G1');
        break;
      }
      case 'startSend': routePrompt(promptValue('startPrompt')); break;
      case 'cgSend': routePrompt(promptValue('cgPrompt')); break;
      case 'cgDock': store.cgDock = !store.cgDock; WS.ui.renderCgDock(); break;
      case 'cgDockSend': routePrompt(promptValue('cgDockPrompt')); break;
      case 'cgDockOpenFull': store.cgDock = false; WS.ui.renderCgDock(); WS.router.go('concierge'); break;
      case 'cgWorkshop': store.cgWorkshopOpen = !store.cgWorkshopOpen; api.emit(); break;
      case 'cgRailToggle': store.cgRailOpen = !store.cgRailOpen; api.emit(); break;
      case 'newThread': WS.ui.openNewThread(); break;
      case 'finReset': if (store.finModel) { const o = store.data.objects.find((x) => x.id === store.finModel.objectId); store.finModel = Object.assign(api.clone(store.data.refModel), { objectId: o ? o.id : 'o_creekline', price: o ? o.price : store.data.refModel.price, scenario: 'base' }); WS.ui.openFinance(store.finModel.objectId); } break;
      case 'openKp': WS.ui.openKp(); break;
      case 'kpSend': WS.ui.closeModal(); api.toast('КП отправлено клиенту на подпись (A2 · delivered)', 'ok'); break;
      case 'openXls': WS.ui.openXls(); break;
      case 'promoSend': WS.ui.closeModal(); api.toast('Рассылка отправлена профильным партнёрам · отклики появятся во «Входящих»', 'ok'); break;
      case 'clubPost': WS.ui.openClubPost(); break;
      case 'clubPostSend': WS.ui.closeModal(); api.toast('Объект размещён в клубной витрине (демо)', 'ok'); break;
      case 'clubReqSend': WS.ui.closeModal(); api.toast('Заявка отправлена владельцу листинга в клубе (демо)', 'ok'); break;
      case 'svcReqSend': WS.ui.closeModal(); api.toast('Заявка на услугу отправлена · появится во «Входящих» (демо)', 'ok'); break;
      case 'walletTopup': WS.ui.openWalletTopup(); break;
      case 'walletTopupSend': WS.ui.closeModal(); api.toast('Кошелёк пополнен (демо) · баланс обновлён', 'ok'); break;
      case 'anaTab': store.analyticsTab = t.dataset.anatab; api.emit(); break;
      case 'valPdf': api.toast('PDF-презентация для инвестора сформирована из расчёта (демо-скачивание)', 'ok'); break;
      case 'valXls': api.toast('Excel-финмодель сформирована из расчёта (демо-скачивание)', 'ok'); break;
      case 'download': api.toast('Файл сформирован из фикстур (демо-скачивание)', 'ok'); break;
    }
  }

  // ---- Enter key on prompts ----
  document.addEventListener('keydown', (e) => {
    // e.target is document when the key is pressed with nothing focused — it has no closest().
    if (e.key === 'ArrowLeft' && e.altKey && !(e.target.closest && e.target.closest('[contenteditable="true"], input, textarea, select'))) {
      if (WS.router.back()) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'startPrompt') { e.preventDefault(); routePrompt(promptValue('startPrompt')); }
    if (e.key === 'Enter' && e.target.id === 'cgPrompt') { e.preventDefault(); routePrompt(promptValue('cgPrompt')); }
    if (e.key === 'Enter' && e.target.id === 'cgDockPrompt') { e.preventDefault(); routePrompt(promptValue('cgDockPrompt')); }
    // Deal title inline edit: save on Enter, restore on Escape
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('deal-title-text')) {
      e.preventDefault();
      const box = e.target.closest('.deal-title-edit');
      if (box && box.dataset.titledeal) {
        const newTitle = (e.target.textContent || '').trim();
        const d = store.data.deals.find((x) => x.id === box.dataset.titledeal);
        // Enter is a deliberate commit, so the card is redrawn — the title also appears in the hero
        // and in the tab labels, and they would otherwise disagree with the line just edited.
        if (d && newTitle) { d.title = newTitle; api.touch(); WS.ui.dealCard(d.id); }
        else if (d) { e.target.textContent = d.title || 'Сделка'; }
      }
    }
    if (e.key === 'Escape') {
      if (e.target.classList && e.target.classList.contains('deal-title-text')) {
        e.preventDefault(); const box = e.target.closest('.deal-title-edit'); if (box && box.dataset.titledeal) { const d = store.data.deals.find((x) => x.id === box.dataset.titledeal); if (d) { e.target.textContent = d.title || 'Сделка'; } }
      } else { store.navOpen = false; WS.ui.closeModal(); api.emit(); }
    }
    // focus trap: keep Tab within the open modal or navigator drawer (a11y §17)
    if (e.key === 'Tab') {
      const modal = document.querySelector('.modal-wrap.show .modal');
      const overlay = modal || (store.navOpen ? document.getElementById('drawer') : null);
      if (!overlay) return;
      const f = Array.prototype.filter.call(
        overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        (el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---- finance model sliders (delegated; survives modal re-renders) ----
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.dataset && el.dataset.calc && el.closest && el.closest('#finBody')) {
      WS.ui.finSlider(el.dataset.calc, el.value);
    }
    // Reference-list search: filter the listbox this input owns. No re-render — the form is open
    // and a redraw would drop everything already filled in.
    if (el && el.dataset && el.dataset.pick) {
      const sel = document.getElementById(el.dataset.pick);
      if (sel) {
        const q = (el.value || '').trim().toLowerCase();
        let shown = 0;
        Array.prototype.forEach.call(sel.options, (o) => {
          const hit = !q || (o.textContent || '').toLowerCase().indexOf(q) >= 0;
          o.hidden = !hit;
          if (hit) shown++;
        });
        const firstVisible = Array.prototype.filter.call(sel.options, (o) => !o.hidden)[0];
        // Keep the selection HONEST: the first visible row when there is one, and nothing at all
        // when there is not. Leaving a hidden option selected under «ничего не найдено» is how a
        // record gets silently attached to whoever happened to be highlighted before the search.
        const cur = sel.selectedOptions[0];
        if (firstVisible) { if (!cur || cur.hidden) firstVisible.selected = true; }
        else sel.selectedIndex = -1;
        const n = document.getElementById(el.dataset.pick + '_n');
        if (n) n.textContent = q ? (shown ? 'найдено ' + shown : 'ничего не найдено') : shown + ' записей';
      }
      return;
    }
    if (el && el.id === 'docSearch') { store.docSearch = el.value; api.emit(); }
    if (el && el.id === 'netSearchInput') { store.netSearch = el.value; api.emit(); }
    if (el && (el.id === 'dealBudFrom' || el.id === 'dealBudTo')) { store[el.id] = el.value.replace(/[^0-9]/g, ''); api.emit(); }
    if (el && el.id === 'dealSearch') { store.dealSearch = el.value; api.emit(); }
    if (el && el.dataset && el.dataset.val && el.closest && el.closest('#valForm')) WS.ui.valInput(el);
    // matching params — budget inputs re-rank live (focus survives render); yield label updates live
    if (el && (el.id === 'm_min' || el.id === 'm_max') && store.match) { store.match[el.id === 'm_min' ? 'min' : 'max'] = parseInt(el.value, 10) || 0; api.emit(); }
    if (el && el.id === 'm_yield' && store.match) { store.match.yield = parseFloat(el.value); const lab = document.getElementById('av_m_yield'); if (lab) lab.textContent = (Math.round(store.match.yield * 1000) / 10) + '%'; }
  });

  // ---- Deal title inline edit: save on blur ----
  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (el && el.classList && el.classList.contains('deal-title-text')) {
      const box = el.closest('.deal-title-edit');
      if (box && box.dataset.titledeal) {
        const newTitle = (el.textContent || '').trim();
        const d = store.data.deals.find((x) => x.id === box.dataset.titledeal);
        // Blur saves silently: the text on screen IS the confirmation. A toast would redraw too
        // — every emit replaces the node — which is the flash read as the app glitching.
        if (d && newTitle && d.title !== newTitle) { d.title = newTitle; api.touch({ render: false }); }
        else if (d && !newTitle) { el.textContent = d.title || 'Сделка'; }
      }
    }
  }, true);

  // matching selects + yield commit (re-rank on change)
  document.addEventListener('change', (e) => {
    const el = e.target; if (!el || !el.id) return;
    if (el.id === 'm_client') { store.podborClient = el.value; store.match = null; store.matchClient = null; api.emit(); }
    else if (el.id === 'm_area' && store.match) { store.match.area = el.value; api.emit(); }
    else if (el.id === 'm_br' && store.match) { store.match.br = el.value; api.emit(); }
    else if (el.id === 'm_yield' && store.match) { store.match.yield = parseFloat(el.value); api.emit(); }
    else if (el.id === 'calType') { store.calType = el.value; api.emit(); }
    else if (el.id === 'finObj') { store.finObjId = el.value; store.finModel = null; api.emit(); }
    else if (el.id === 'calObj') { store.calObj = el.value; api.emit(); }
    else if (el.id === 'calClient') { store.calClient = el.value; api.emit(); }
    else if (el.dataset && el.dataset.val && el.closest && el.closest('#valForm')) { WS.ui.valInput(el); }
  });

  // ---- scrim closes drawer ----
  document.addEventListener('click', (e) => {
    if (e.target.id === 'scrim') { store.navOpen = false; api.emit(); }
  });

  // close any composer popover (attach / mode / context) on outside click
  document.addEventListener('click', (e) => {
    if (store.cgMenu && e.target.closest && !e.target.closest('.cg-bar')) { store.cgMenu = null; api.emit(); }
  });

  // The composer sits anywhere (Пульс mid-page, home below the tiles, chat dock at the
  // bottom), so flip the popover to whichever side has room and cap it to the viewport.
  function placeCgPop() {
    const pop = document.querySelector('.cg-pop');
    if (!pop) return;
    const box = pop.closest('.prompt');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const vv = window.visualViewport;
    const vh = (vv && vv.height) ? vv.height : window.innerHeight;
    const M = 12;
    const below = vh - r.bottom - M;
    const above = r.top - M;
    const DESIRED = 264;
    const openUp = below < Math.min(DESIRED, above) && above > below;
    const space = Math.max(openUp ? above : below, 150);
    pop.style.maxHeight = Math.min(DESIRED, space) + 'px';
    if (openUp) { pop.style.top = 'auto'; pop.style.bottom = 'calc(100% + 8px)'; }
    else { pop.style.bottom = 'auto'; pop.style.top = 'calc(100% + 8px)'; }
  }
  window.addEventListener('resize', () => { if (store.cgMenu) placeCgPop(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (store.cgMenu) placeCgPop(); });

  // ---- boot (guarded: any failure shows a message instead of a blank screen) ----
  try {
    api.boot();
    // restore persisted Concierge threads (F5) if any, else seed the night-lead thread (P0-6)
    if (store._threads && Object.keys(store._threads).length) WS.engine.importThreads(store._threads);
    else WS.engine.seedThreads();
    api.subscribe(() => WS.ui.render());
    api.subscribe(placeCgPop);
    WS.ui.render();
    // Put the live head in. It works out reachability per question, so a bad
    // second at load costs a retry rather than the session; and every failure
    // falls back to the offline planner, which answers the same questions.
    if (WS.live && WS.live.install) WS.live.install();
  } catch (e) {
    var a = document.getElementById('app');
    if (a) a.innerHTML = '<div style="padding:24px;font:15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#222;line-height:1.5"><b>Стенд не запустился.</b><br><br>' + (e && e.message ? e.message : e) + '<br><br>Пришлите этот текст — починим.</div>';
  }
})(window.WS = window.WS || {});
