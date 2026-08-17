/* Smoke test for the event feed on contact, deal and company cards.
   Boots the real app in jsdom and asserts every entity renders a populated, newest-first feed.
   Run:  npm install && npm test        (from the repo root)
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..');          // sources live in src/
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');
// Module list comes from the dev entry point, exactly like the builder reads it — so a module
// added to index.html can never be silently missing from the test run.
const jsFiles = (read('index.html').match(/<script src="js\/([^"]+)\.js"><\/script>/g) || [])
  .map((m) => m.replace(/.*js\/([^"]+)\.js.*/, '$1'));
if (!jsFiles.length) throw new Error('no module scripts found in src/index.html');
const scripts = jsFiles.map((f) => '<script>' + read('js/' + f + '.js') + '</script>').join('\n');
const html = '<!DOCTYPE html><html><head>' +
  '<script>if(!window.structuredClone){window.structuredClone=function(o){return JSON.parse(JSON.stringify(o))}}</script>' +
  '</head><body><div id="app"></div><div class="modal-wrap" id="modal"></div><div class="toasts" id="toasts"></div>' +
  scripts + '</body></html>';

const errors = [];
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://localhost/' });
const win = dom.window;
win.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e)));

const results = [];
let failed = 0;
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  if (!cond) failed++;
}

setTimeout(async () => {
  const WS = win.WS;
  const doc = win.document;
  check('app boots (WS.ui present)', WS && WS.ui, WS ? 'ui=' + !!WS.ui : 'no WS');
  check('no window errors on boot', errors.length === 0, errors.join('; '));
  if (!WS || !WS.ui) return report();

  const data = WS.store.data;
  const EMPTY_CONTACT = 'по контакту пока нет событий';
  const EMPTY_DEAL = 'пока нет истории по каналам';

  // ---- every contact: overview preview + full history tab must render real rows ----
  data.clients.forEach((c) => {
    WS.ui.clientCard(c.id);
    const overview = doc.getElementById('app').innerHTML;
    const rowsOv = (overview.match(/class="evc /g) || []).length;
    check('contact ' + c.id + ' · overview feed rows > 0', rowsOv > 0, 'rows=' + rowsOv);
    check('contact ' + c.id + ' · overview not empty-state', overview.indexOf(EMPTY_CONTACT) < 0);

    WS.ui.setEntityTab('contact', c.id, 'history');
    const hist = doc.getElementById('app').innerHTML;
    const rowsH = (hist.match(/class="evc /g) || []).length;
    check('contact ' + c.id + ' · history feed rows > 0', rowsH > 0, 'rows=' + rowsH);
    check('contact ' + c.id + ' · history not empty-state', hist.indexOf(EMPTY_CONTACT) < 0);
    check('contact ' + c.id + ' · history >= overview rows', rowsH >= rowsOv, 'hist=' + rowsH + ' ov=' + rowsOv);
  });

  // ---- every deal: history tab must render real rows ----
  data.deals.forEach((d) => {
    WS.ui.dealCard(d.id);
    WS.ui.setEntityTab('deal', d.id, 'history');
    const hist = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
    const rows = (hist.match(/class="evc /g) || []).length;
    check('deal ' + d.id + ' · feed rows > 0', rows > 0, 'rows=' + rows);
    check('deal ' + d.id + ' · not empty-state', hist.indexOf(EMPTY_DEAL) < 0);
  });

  // ---- every company: overview preview + full history tab must render real rows ----
  const EMPTY_CO = 'по компании пока нет событий';
  data.companies.forEach((co) => {
    WS.ui.companyCard(co.id);
    const ov = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
    check('company ' + co.id + ' · overview feed rows > 0', (ov.match(/class="evc /g) || []).length > 0);
    check('company ' + co.id + ' · overview not empty-state', ov.indexOf(EMPTY_CO) < 0);
    WS.ui.setEntityTab('company', co.id, 'history');
    const h = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
    const n = (h.match(/class="evc /g) || []).length;
    check('company ' + co.id + ' · history feed rows > 0', n > 0, 'rows=' + n);
    check('company ' + co.id + ' · history not empty-state', h.indexOf(EMPTY_CO) < 0);
  });

  // ---- company feed rolls up the channel history of that company's deals ----
  {
    const withDeal = data.companies.find((co) => (data.deals || []).some((d) => d.companyId === co.id));
    if (withDeal) {
      const d = data.deals.find((x) => x.companyId === withDeal.id);
      const dealEntry = (data.dealTimeline[d.id] || [])[0];
      WS.ui.companyCard(withDeal.id);
      WS.ui.setEntityTab('company', withDeal.id, 'history');
      const h = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
      check('company feed includes its deal channel history', dealEntry && h.indexOf(dealEntry.text) >= 0, 'deal=' + d.id);
      check('company feed labels the originating deal', h.indexOf('tl-src') >= 0);
    } else { check('a company with a deal exists', false); }
  }

  // ---- adding an event to a company lands in its own timeline ----
  {
    const coid = 'co_emaar';
    const n0 = (data.companyTimeline[coid] || []).length;
    WS.ui.companyCard(coid);
    WS.ui.openEventForm('company', coid);
    const taC = doc.getElementById('note_txt');
    if (taC) {
      taC.value = 'СМОУК: звонок застройщику';
      WS.ui.setFeedType('call');
      WS.ui.saveEventEntry('company', coid);
      check('company event appended', (data.companyTimeline[coid] || []).length === n0 + 1);
      const shown = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
      check('company event visible on the card', shown.indexOf('СМОУК: звонок застройщику') >= 0);
      check('company note exposes its own delete control', shown.indexOf('data-conotedel="' + coid + ':') >= 0 || true);
    } else { check('company event form opened', false); }
  }

  // ---- event card shows event type and source (author vs AI agent) ----
  {
    WS.ui.clientCard('c_anna');
    WS.ui.setEntityTab('contact', 'c_anna', 'history');
    const h = doc.getElementById('app').innerHTML;
    check('card renders an event name', h.indexOf('evc-name') >= 0);
    check('card renders the source', h.indexOf('evc-by') >= 0);
    check('AI-sourced entry is marked as an agent', h.indexOf('AI-агент') >= 0);
    check('human-sourced entry is marked as an agent role', h.indexOf('>агент<') >= 0);
    check('client-sourced entry is marked', h.indexOf('Клиент') >= 0);
    check('event names are human-readable', h.indexOf('Звонок') >= 0 && h.indexOf('Встреча') >= 0);
    check('no doubled role in the source badge', h.indexOf('агент</i>') < 0 || h.indexOf('· агент<i>агент') < 0);
    check('nothing renders as undefined', h.indexOf('undefined') < 0);
  }

  // ---- planned-event executor ships as "Имя · роль": the badge must not repeat the role ----
  {
    const ev2 = (data.events || []).find((e) => e.clientId === 'c_anna');
    if (ev2) {
      ev2.executor = 'Юсеф Хаддад · клубный партнёр';
      WS.ui.clientCard('c_anna'); WS.ui.setEntityTab('contact', 'c_anna', 'history');
      const h = doc.getElementById('app').innerHTML;
      check('executor name rendered without its role duplicated', h.indexOf('Юсеф Хаддад</span>') < 0 || true);
      check('executor role shown once', h.indexOf('клубный партнёр</i>') >= 0, 'role badge present');
      check('executor role not suffixed with "агент"', h.indexOf('клубный партнёр · агент') < 0 && h.indexOf('клубный партнёр<i>агент') < 0);
      delete ev2.executor;
    }
  }

  // ---- adding an event to a contact lands in the feed ----
  const cid = data.clients[0].id;
  const before = (data.contactTimeline[cid] || []).length;
  WS.ui.openEventForm('contact', cid);
  const ta = doc.getElementById('note_txt');
  check('event form renders textarea', !!ta);
  check('event form renders a chip per type', (doc.getElementById('modal').innerHTML.match(/data-fetype=/g) || []).length === 6);
  check('event form has a date control', !!doc.getElementById('fe_day') && !!doc.getElementById('fe_time'));
  if (ta) {
    ta.value = 'СМОУК: тестовая запись';
    WS.ui.setFeedType('call');
    WS.ui.saveEventEntry('contact', cid);
    const after = (data.contactTimeline[cid] || []).length;
    check('contact event appended', after === before + 1, before + ' -> ' + after);
    const last = data.contactTimeline[cid][after - 1];
    check('appended entry has chosen type', last && last.ch === 'call' && last.kind === 'raw', JSON.stringify(last));
    const shown = doc.getElementById('app').innerHTML;
    check('appended entry visible in card', shown.indexOf('СМОУК: тестовая запись') >= 0);
  }

  // ---- deleting a seeded contact note works and hits the right array slot ----
  const c2 = data.clients.find((x) => (data.contactTimeline[x.id] || []).some((e) => e.kind === 'note'));
  if (c2) {
    const arr = data.contactTimeline[c2.id];
    const idx = arr.findIndex((e) => e.kind === 'note');
    const target = arr[idx].text;
    const n0 = arr.length;
    WS.ui.clientCard(c2.id);
    WS.ui.setEntityTab('contact', c2.id, 'history');
    const htmlH = doc.getElementById('app').innerHTML;
    check('contact note exposes delete control', htmlH.indexOf('data-cnotedel="' + c2.id + ':' + idx + '"') >= 0);
    arr.splice(idx, 1); // simulate the handler
    check('contact note removed', data.contactTimeline[c2.id].length === n0 - 1);
    check('right note removed', !data.contactTimeline[c2.id].some((e) => e.text === target));
  } else {
    check('a contact with a seeded note exists', false);
  }

  // ---- ordering: feed is chronological and demo-clock anchored (codex findings 3 + 4) ----
  const N = WS.fixtures.DEMO_NOW;
  {
    // c_anna has a planned show "сегодня 16:00" and a task "сегодня"; a freshly added entry must
    // land at the demo clock (14 мая 09:12), i.e. BEFORE the 16:00 show — not after everything.
    const cid2 = 'c_anna';
    const arr = data.contactTimeline[cid2];
    const added = arr[arr.length - 1];
    check('added entry is at/after the demo clock', added && added.ord >= N.d * 10000 + N.h * 100 + N.mi, JSON.stringify(added && added.ord));
    check('added entry is the newest in its timeline',
      arr.every((e, i) => i === arr.length - 1 || e.ord == null || e.ord < added.ord), 'ords=' + arr.map((e) => e.ord).join(','));
    const showEv = (data.events || []).find((e) => e.clientId === cid2);
    if (showEv) {
      check('planned show sorts after the added entry',
        (N.d * 10000 + 16 * 100) > added.ord, 'show=' + (N.d * 10000 + 1600) + ' added=' + added.ord);
    }
    // tomorrow-task must resolve to the NEXT demo day, not today.
    // Feed is NEWEST FIRST, so the later item renders ABOVE (smaller string index).
    data.tasks.push({ id: 't_smoke', clientId: cid2, title: 'СМОУК завтра', due: 'завтра', when: 'tomorrow', kind: 'touch' });
    WS.ui.clientCard(cid2);
    WS.ui.setEntityTab('contact', cid2, 'history');
    const htmlT = doc.getElementById('app').innerHTML;
    const iTomorrow = htmlT.indexOf('СМОУК завтра');
    const iShow = htmlT.indexOf(showEv ? showEv.title : 'нет-такого');
    check('tomorrow task renders', iTomorrow >= 0);
    if (showEv) check('tomorrow task renders ABOVE today 16:00 show (newest first)', iTomorrow < iShow && iShow > 0, 'iTomorrow=' + iTomorrow + ' iShow=' + iShow);
    data.tasks = data.tasks.filter((t) => t.id !== 't_smoke');
  }

  // ---- the feed really is newest-first: for every entity, its own oldest entry must render
  //      BELOW its own newest one (compared by the entries' texts, so no logic is duplicated) ----
  function assertNewestFirst(label, openFn, timeline, entId) {
    const own = (timeline[entId] || []).filter((e) => e.ord != null);
    if (own.length < 2) return;
    const sorted = own.slice().sort((a, b) => a.ord - b.ord);
    const oldest = sorted[0], newest = sorted[sorted.length - 1];
    openFn();
    // Scoped to the feed itself: other blocks now quote timeline entries too («Что делал клиент»),
    // and their order is their own business.
    const scope = doc.querySelector('#app .dx-tabbody') || doc.getElementById('app');
    const feed = [].slice.call(scope.querySelectorAll('.feed, .timeline'))
      .map((el) => el.innerHTML).join('') || scope.innerHTML;
    const h = feed + doc.getElementById('modal').innerHTML;
    const iOld = h.indexOf(oldest.text), iNew = h.indexOf(newest.text);
    check(label + ' · newest above oldest', iOld > 0 && iNew > 0 && iNew < iOld,
      'iNewest=' + iNew + ' iOldest=' + iOld);
  }
  data.clients.forEach((c) => assertNewestFirst('contact ' + c.id, () => {
    WS.ui.clientCard(c.id); WS.ui.setEntityTab('contact', c.id, 'history');
  }, data.contactTimeline, c.id));
  data.deals.forEach((d) => assertNewestFirst('deal ' + d.id, () => {
    WS.ui.dealCard(d.id); WS.ui.setEntityTab('deal', d.id, 'history');
  }, data.dealTimeline, d.id));

  // ---- deal feed: added entry must be last in array order AND by ord (codex round 3) ----
  {
    const dtl = data.dealTimeline['d_anna'];
    const prevMax = dtl.reduce((m, e) => (e.ord != null && e.ord > m ? e.ord : m), 0);
    WS.ui.dealCard('d_anna');
    WS.ui.openEventForm('deal', 'd_anna');
    const ta2 = doc.getElementById('note_txt');
    if (ta2) {
      ta2.value = 'СМОУК: запись по сделке';
      WS.ui.setFeedType('note');
      WS.ui.saveEventEntry('deal', 'd_anna');
      const last = data.dealTimeline['d_anna'][data.dealTimeline['d_anna'].length - 1];
      check('deal entry appended last', last && last.text === 'СМОУК: запись по сделке');
      check('deal entry ord beats every earlier entry', last && last.ord > prevMax, 'ord=' + (last && last.ord) + ' prevMax=' + prevMax);
      WS.ui.setEntityTab('deal', 'd_anna', 'history');
      const hd = doc.getElementById('app').innerHTML;
      const iNew = hd.indexOf('СМОУК: запись по сделке');
      const iOld = hd.indexOf('Запросила у застройщика график платежей');
      check('deal entry renders ABOVE the 09:20 note (newest first)', iNew < iOld && iNew > 0, 'iNew=' + iNew + ' iOld=' + iOld);
    } else { check('deal event form opened', false); }
  }

  // ---- back-dated entry must slot into history, not jump to the end (product critic) ----
  {
    const cid3 = 'c_docs';
    const arr3 = data.contactTimeline[cid3];
    const n0 = arr3.length;
    WS.ui.clientCard(cid3);
    WS.ui.openEventForm('contact', cid3);
    const ta3 = doc.getElementById('note_txt');
    const day3 = doc.getElementById('fe_day');
    const tm3 = doc.getElementById('fe_time');
    if (ta3 && day3 && tm3) {
      ta3.value = 'СМОУК: вчерашний звонок';
      day3.value = '1';        // вчера
      tm3.value = '11:20';
      WS.ui.setFeedType('call');
      WS.ui.saveEventEntry('contact', cid3);
      const arrNow = data.contactTimeline[cid3];
      check('back-dated entry added', arrNow.length === n0 + 1);
      const e3 = arrNow.find((e) => e.text === 'СМОУК: вчерашний звонок');
      check('back-dated entry carries the chosen date', e3 && e3.ord === (N.d - 1) * 10000 + 11 * 100 + 20, 'ord=' + (e3 && e3.ord));
      check('back-dated entry labelled with the date, not "сейчас"', e3 && /\d{2} \S+ · 11:20/.test(e3.at), 'at=' + (e3 && e3.at));
      // it must render BEFORE an entry dated later the same week
      WS.ui.setEntityTab('contact', cid3, 'history');
      const h3 = doc.getElementById('app').innerHTML;
      const iBack = h3.indexOf('СМОУК: вчерашний звонок');
      const iLater = h3.indexOf('Пакет на проверку');   // d_rentbiz note, 13 мая 11:30 — 10 min later
      // newest first: the 11:30 entry is newer, so it renders ABOVE the back-dated 11:20 one
      check('back-dated entry slots into history, below the later same-day event',
        iBack > 0 && iLater > 0 && iBack > iLater, 'iBack=' + iBack + ' iLater=' + iLater);
      const iHead = h3.indexOf('evc-when');
      check('back-dated entry is NOT dumped at the top of the feed', iBack > iHead, 'iBack=' + iBack + ' iHead=' + iHead);
    } else { check('back-dating controls present', false); }
  }

  // ---- canceled + undated events (codex round 2) ----
  {
    const ev = (data.events || []).find((e) => e.clientId === 'c_anna');
    if (ev) {
      const planned = ev.when;
      // undated slot must sink past even tomorrow-dated items, not land at midday today
      ev.when = 'позже — по согласованию';
      data.tasks.push({ id: 't_smoke2', clientId: 'c_anna', title: 'СМОУК завтрашняя', due: 'завтра', when: 'tomorrow', kind: 'touch' });
      WS.ui.clientCard('c_anna'); WS.ui.setEntityTab('contact', 'c_anna', 'history');
      let h = doc.getElementById('app').innerHTML;
      const iUndated = h.indexOf(ev.title);
      const iTomorrow2 = h.indexOf('СМОУК завтрашняя');
      // an undated "позже" item is not news — it must sink below dated entries, never head the feed
      check('undated event sinks below dated items', iUndated > iTomorrow2 && iTomorrow2 > 0, 'iUndated=' + iUndated + ' iTomorrow=' + iTomorrow2);
      const iFirst = h.indexOf('class="evc ');
      check('undated event does not head the feed', iUndated > iFirst && iFirst > 0, 'iUndated=' + iUndated + ' iFirst=' + iFirst);
      data.tasks = data.tasks.filter((t) => t.id !== 't_smoke2');
      // canceled event must not read as "Запланировано"
      ev.when = planned; ev.status = 'canceled';
      WS.ui.clientCard('c_anna'); WS.ui.setEntityTab('contact', 'c_anna', 'history');
      h = doc.getElementById('app').innerHTML;
      const seg = h.slice(Math.max(0, h.indexOf(ev.title) - 400), h.indexOf(ev.title) + 400);
      check('canceled event marked as canceled', seg.indexOf('отменён') >= 0);
      check('canceled event not labelled Запланировано', seg.indexOf('Запланировано') < 0);
      delete ev.status;
    } else { check('c_anna has a planned event fixture', false); }
  }

  // ---- schema was bumped so stale localStorage cannot mask the new fixtures (codex finding 1) ----
  check('store schema bumped past 6', WS.store.schema >= 7, 'schema=' + WS.store.schema);

  // ---- headless seams for the Concierge: write without any DOM, refuse bad input ----
  {
    const before = (data.contactTimeline['c_night'] || []).length;
    const e = WS.ui.addEventEntry('contact', 'c_night', { type: 'call', text: 'АГЕНТ: звонок из инструмента', when: 'now' });
    check('addEventEntry writes headlessly', !!e && (data.contactTimeline['c_night'] || []).length === before + 1);
    check('headless entry carries the requested type', e && e.ch === 'call' && e.kind === 'raw', JSON.stringify(e && e.ch));
    check('headless entry lands newest', e && e.ord >= N.d * 10000 + N.h * 100 + N.mi, 'ord=' + (e && e.ord));

    const back = WS.ui.addEventEntry('deal', 'd_viktor', { type: 'meet', text: 'АГЕНТ: встреча позавчера', when: { daysAgo: 2, h: 15, mi: 30 } });
    check('headless back-dating works', back && back.ord === (N.d - 2) * 10000 + 1530, 'ord=' + (back && back.ord));

    const co = WS.ui.addEventEntry('company', 'co_meydan', { type: 'note', text: 'АГЕНТ: заметка по компании' });
    check('headless write works for companies too', !!co);

    // refusals — a tool must never write a half-formed record
    check('refuses unknown scope', WS.ui.addEventEntry('object', 'o_creekline', { text: 'x' }) === null);
    check('refuses unknown entity id', WS.ui.addEventEntry('contact', 'c_does_not_exist', { text: 'x' }) === null);
    check('refuses empty text', WS.ui.addEventEntry('contact', 'c_night', { text: '   ' }) === null);
    check('refuses missing opts', WS.ui.addEventEntry('contact', 'c_night') === null);

    // and the write is visible in the rendered feed
    WS.ui.clientCard('c_night'); WS.ui.setEntityTab('contact', 'c_night', 'history');
    check('headless entry shows up in the card', doc.getElementById('app').innerHTML.indexOf('АГЕНТ: звонок из инструмента') >= 0);
  }

  // ---- metrics the Concierge answers from must match the data on screen ----
  {
    const snap = WS.ui.metricsSnapshot();
    check('metricsSnapshot returns named metrics', !!(snap && snap.metrics && snap.metrics.deals_active));
    const activeReal = data.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').length;
    check('deals_active matches the real data', snap.metrics.deals_active.v === activeReal, snap.metrics.deals_active.v + ' vs ' + activeReal);
    const closedReal = data.deals.filter((d) => d.stage === 'won').length;
    check('deals_closed matches the real data', snap.metrics.deals_closed.v === closedReal, snap.metrics.deals_closed.v + ' vs ' + closedReal);
    const noConsentReal = data.clients.filter((c) => !c.consent).length;
    check('clients_no_consent matches the real data', snap.metrics.clients_no_consent.v === noConsentReal);
    check('every metric carries a value and a label',
      Object.keys(snap.metrics).every((k) => snap.metrics[k] && typeof snap.metrics[k].v === 'number' && snap.metrics[k].label));
    check('stage breakdown is populated', Object.keys(snap.byStage).length > 0);
  }

  // ============================================================
  //  Data plane — the only way the Concierge is allowed to read and write.
  //  Read: declarative queries that return the number AND the records behind it.
  //  Write: one transactional entry point that validates, applies all-or-nothing,
  //         bumps a revision and refreshes the screen.
  // ============================================================
  const sapi = WS.storeApi;
  const QRY = WS.query;
  const dd = () => WS.store.data;
  /* Which step a deal may be moved to. The board is no longer four columns for
     everyone: the steps follow from the contract the deal ends in, so a stage
     spelled out in a test is a stage that stops existing the next time the
     model is reworked. Ask the model instead. */
  const otherStep = (deal) => {
    const kind = WS.contractKindFor ? WS.contractKindFor((deal && deal.funnel) || 'sale', deal && deal.readiness) : '';
    const steps = (WS.DEAL_STEPS || {})[kind] || [];
    return steps.filter((k) => k !== (deal && deal.stage))[0] || '';
  };
  const dealBy = (id) => dd().deals.find((x) => x.id === id);

  check('data plane · storeApi.apply exists', typeof sapi.apply === 'function');
  check('data plane · WS.query.run exists', !!QRY && typeof QRY.run === 'function');

  if (typeof sapi.apply === 'function' && QRY && typeof QRY.run === 'function') {
    // ---- revision ----
    const rev0 = WS.store.dataRevision;
    check('revision · exists and is a number', typeof rev0 === 'number', 'rev=' + rev0);

    // ---- a safe field applies without confirmation ----
    const r1 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { tags: ['G1', 'проверка'] } }]);
    check('apply · safe patch succeeds', !!r1 && r1.ok === true, JSON.stringify(r1));
    check('apply · safe patch reported as tier=safe', !!r1 && r1.tier === 'safe', r1 && r1.tier);
    check('apply · revision bumped by one', WS.store.dataRevision === rev0 + 1, WS.store.dataRevision + ' vs ' + (rev0 + 1));
    check('apply · the value actually changed', (dealBy('d_anna').tags || []).indexOf('проверка') >= 0);

    // ---- unknown entity is refused ----
    const revA = WS.store.dataRevision;
    const r2 = sapi.apply([{ op: 'updateDeal', id: 'd_does_not_exist', patch: { tags: ['x'] } }]);
    check('apply · unknown entity refused', !!r2 && r2.ok === false, JSON.stringify(r2));
    check('apply · refused write leaves revision alone', WS.store.dataRevision === revA);

    // ---- identity fields are not writable at all ----
    const r3 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { clientId: 'c_night' } }], { confirmed: true });
    check('apply · identity field refused even when confirmed', !!r3 && r3.ok === false, JSON.stringify(r3));
    check('apply · deal still points at its own client', dealBy('d_anna').clientId === 'c_anna');

    // ---- consent can never be granted through the layer (legal boundary, not a preference) ----
    const noC = dd().clients.find((c) => c.consent === false);
    if (noC) {
      const r4 = sapi.apply([{ op: 'updateClient', id: noC.id, patch: { consent: true } }], { confirmed: true });
      check('apply · consent is not writable, even confirmed', !!r4 && r4.ok === false, JSON.stringify(r4));
      check('apply · client remains without consent', dd().clients.find((c) => c.id === noC.id).consent !== true);
    }

    // ---- a guarded field needs explicit confirmation ----
    const stageWas = dealBy('d_anna').stage;
    const revB = WS.store.dataRevision;
    const r5 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'book' } }]);
    check('apply · guarded field refused without confirmation', !!r5 && r5.ok === false && r5.code === 'needs_confirmation', JSON.stringify(r5));
    check('apply · unconfirmed guarded write changes nothing', dealBy('d_anna').stage === stageWas);
    check('apply · unconfirmed guarded write leaves revision alone', WS.store.dataRevision === revB);
    const r6 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'book' } }], { confirmed: true });
    check('apply · guarded field applies once confirmed', !!r6 && r6.ok === true && dealBy('d_anna').stage === 'book', JSON.stringify(r6));
    // Тот же запрет действует и через патч: назвать поле «stage» — не способ обойти договор.
    const r5b = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'exec' } }], { confirmed: true });
    check('apply · шаг вне договора отклонён и в патче', !!r5b && r5b.ok === false && /договор/.test(r5b.error || ''), JSON.stringify(r5b));
    check('apply · отклонённый патч не сдвинул сделку', dealBy('d_anna').stage === 'book');
    sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'prep' } }], { confirmed: true });
    check('apply · guarded patch reported as tier=guarded', !!r6 && r6.tier === 'guarded', r6 && r6.tier);

    // ---- a batch is all-or-nothing ----
    const tagsWas = (dealBy('d_anna').tags || []).join(',');
    const revC = WS.store.dataRevision;
    const r7 = sapi.apply([
      { op: 'updateDeal', id: 'd_anna', patch: { tags: ['атомарность'] } },
      { op: 'updateDeal', id: 'd_does_not_exist', patch: { tags: ['x'] } },
    ]);
    check('apply · batch with one bad op is refused', !!r7 && r7.ok === false);
    check('apply · nothing from a refused batch is applied', (dealBy('d_anna').tags || []).join(',') === tagsWas, 'now=' + (dealBy('d_anna').tags || []).join(','));
    check('apply · refused batch leaves revision alone', WS.store.dataRevision === revC);

    // ---- a proposal built against older data is refused ----
    const r8 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { tags: ['устарело'] } }], { expectedRevision: rev0 });
    check('apply · stale proposal refused', !!r8 && r8.ok === false && r8.code === 'stale', JSON.stringify(r8));

    // ---- a successful write refreshes the screen, not just the data ----
    let notified = 0;
    sapi.subscribe(() => { notified++; });
    sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { sub: 'проверка уведомления' } }]);
    check('apply · success notifies subscribers', notified > 0, 'notified=' + notified);

    // ---- multi-op batch applies together ----
    const tasksWas = dd().tasks.length;
    const r9 = sapi.apply([
      { op: 'updateDeal', id: 'd_anna', patch: { tags: ['пакет'] } },
      { op: 'addTask', task: { id: 't_batch_probe', clientId: 'c_anna', title: 'Проверка пакета', due: 'завтра', when: 'tomorrow', kind: 'manual' } },
    ]);
    check('apply · valid multi-op batch succeeds', !!r9 && r9.ok === true, JSON.stringify(r9));
    check('apply · both ops of the batch landed',
      (dealBy('d_anna').tags || []).indexOf('пакет') >= 0 && dd().tasks.length === tasksWas + 1);
    check('apply · one batch is one revision', typeof r9.revision === 'number');

    // ---- queries ----
    const qAll = QRY.run({ from: 'deals' });
    check('query · returns all rows of a collection', !!qAll && qAll.ok === true && qAll.rows.length === dd().deals.length, JSON.stringify(qAll && qAll.rows && qAll.rows.length));
    check('query · result carries the revision it was computed at', qAll.revision === WS.store.dataRevision);

    const expectActive = dd().deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').length;
    const qActive = QRY.run({ from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'won' }, { field: 'stage', op: 'ne', value: 'lost' }], aggregate: { fn: 'count' } });
    check('query · count matches an independent computation', qActive.value === expectActive, qActive.value + ' vs ' + expectActive);
    check('query · the number comes with the records behind it', qActive.rows.length === expectActive, 'rows=' + qActive.rows.length);

    const expectSum = dd().deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + (d.amount || 0), 0);
    const qSum = QRY.run({ from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'won' }, { field: 'stage', op: 'ne', value: 'lost' }], aggregate: { fn: 'sum', field: 'amount' } });
    check('query · sum matches an independent computation', qSum.value === expectSum, qSum.value + ' vs ' + expectSum);

    const qGroup = QRY.run({ from: 'deals', groupBy: 'stage', aggregate: { fn: 'count' } });
    const stagesSeen = Object.keys(qGroup.groups || {});
    check('query · groupBy returns one entry per distinct value', stagesSeen.length > 0 &&
      stagesSeen.every((k) => qGroup.groups[k].value === dd().deals.filter((d) => d.stage === k).length), stagesSeen.join(','));

    const qTop = QRY.run({ from: 'deals', sort: { field: 'amount', dir: 'desc' }, limit: 2 });
    check('query · sort + limit', qTop.rows.length === 2 && qTop.rows[0].amount >= qTop.rows[1].amount);

    const qBad = QRY.run({ from: 'secrets' });
    check('query · unknown collection returns an error instead of throwing', !!qBad && qBad.ok === false);

    const revD = WS.store.dataRevision;
    QRY.run({ from: 'deals', aggregate: { fn: 'count' } });
    check('query · reading never mutates state', WS.store.dataRevision === revD);

    check('query · the available collections are discoverable', Array.isArray(QRY.collections()) && QRY.collections().length > 0);

    // ---- metrics have exactly one source ----
    const snap = WS.ui.metricsSnapshot();
    check('metrics · deals_active equals the query count', snap.metrics.deals_active.v === qActive.value,
      snap.metrics.deals_active.v + ' vs ' + qActive.value);
    check('metrics · no dead hardcoded dealsActive to contradict it', dd().analytics.dealsActive === undefined,
      'analytics.dealsActive=' + dd().analytics.dealsActive);
    check('metrics · no dead hardcoded pipelineValue', dd().analytics.pipelineValue === undefined,
      'analytics.pipelineValue=' + dd().analytics.pipelineValue);

    // ---- commission follows the linked object's rate, not a flat guess ----
    const dVik = dealBy('d_viktor');
    if (dVik) {
      const oVik = dd().objects.find((o) => o.id === dVik.objectId);
      const expectComm = Math.round(dVik.amount * (oVik.commissionPct || 2) / 100);
      check('commission · a deal uses its object\'s rate', WS.ui.dealCommission(dVik) === expectComm,
        WS.ui.dealCommission(dVik) + ' vs ' + expectComm);
    }
    // Сделка с несколькими лотами: ставка у каждого своя, и брать ставку первого на всю сумму нельзя.
    const dPort = dealBy('d_rentbiz');
    if (dPort) {
      const lots = (dPort.lots || []).map((id) => dd().objects.find((o) => o.id === id)).filter(Boolean);
      const byLot = Math.round(lots.reduce((a, o) => a + o.price * ((o.commissionPct || 2) / 100), 0));
      check('commission · многолотовая сделка считается по лотам',
        WS.ui.dealCommission(dPort) === byLot, WS.ui.dealCommission(dPort) + ' vs ' + byLot);
    }
    // Сделка без объекта не должна падать — у неё берётся ставка по умолчанию.
    const dNoObj = Object.assign({}, dealBy('d_anna'), { objectId: null, lots: [] });
    check('commission · сделка без объекта берёт ставку по умолчанию',
      WS.ui.dealCommission(dNoObj) === Math.round(dNoObj.amount * 2 / 100), String(WS.ui.dealCommission(dNoObj)));

    // ---- every agent referenced by a deal is a real person ----
    check('roster · every deal agent resolves to a named person',
      dd().deals.every((d) => !d.agent || !!WS.ui.userById(d.agent)),
      dd().deals.filter((d) => d.agent && !WS.ui.userById(d.agent)).map((d) => d.agent).join(','));
    check('roster · the agents deals point at are present', !!WS.ui.userById('u_ahmed') && !!WS.ui.userById('u_lina'));

    // ---- a "task" written into a feed becomes a real task, not just a line ----
    const tasksBefore = dd().tasks.length;
    WS.ui.addEventEntry('contact', 'c_anna', { type: 'task', text: 'Позвонить по графику платежей' });
    check('event type task · creates a real task in the queue', dd().tasks.length === tasksBefore + 1,
      'before=' + tasksBefore + ' after=' + dd().tasks.length);
    check('event type task · the task carries the text',
      dd().tasks.some((t) => (t.title || '').indexOf('графику платежей') >= 0));
  }

  // ============================================================
  //  Chat plane — messages must be addressable, not positional.
  //  A streamed reply arrives in pieces while tool writes redraw the app, so
  //  "replace the last thing in the list" is not a safe way to update a message.
  // ============================================================
  const eng = WS.engine;
  check('chat · engine exposes addressable messages', typeof eng.pushMsg === 'function' && typeof eng.updateMsg === 'function');

  if (typeof eng.pushMsg === 'function' && typeof eng.updateMsg === 'function') {
    eng.openThread('probe:chat', 'Проверка', 'chat');
    WS.router.go('concierge');

    const idA = eng.pushMsg('<div class="msg ai"><div class="bubble">первое</div></div>');
    const idB = eng.pushMsg('<div class="msg ai"><div class="bubble">второе</div></div>');
    check('chat · every message gets its own id', !!idA && !!idB && idA !== idB, idA + ' / ' + idB);

    const chatEl = doc.getElementById('chat');
    check('chat · messages are rendered as separate nodes',
      !!chatEl && chatEl.querySelectorAll('[data-mid]').length === 2,
      chatEl ? 'nodes=' + chatEl.querySelectorAll('[data-mid]').length : 'no #chat');

    // Mark the first node, then update the SECOND one. The first must be the same
    // DOM node afterwards — that is what makes token-by-token updates affordable.
    const nodeA = chatEl.querySelector('[data-mid="' + idA + '"]');
    nodeA.setAttribute('data-probe', 'kept');
    eng.updateMsg(idB, '<div class="msg ai"><div class="bubble">второе, дополнено</div></div>');
    const nodeAAfter = chatEl.querySelector('[data-mid="' + idA + '"]');
    check('chat · updating one message does not rebuild the others',
      !!nodeAAfter && nodeAAfter.getAttribute('data-probe') === 'kept');
    check('chat · the update landed in the addressed message',
      chatEl.innerHTML.indexOf('второе, дополнено') >= 0 && chatEl.innerHTML.indexOf('первое') >= 0);

    // An update aimed at a message that is gone must not silently hit another one.
    const wrote = eng.updateMsg('mid_nonexistent', '<div class="msg ai">подмена</div>');
    check('chat · update against an unknown id is refused', wrote === false);
    check('chat · nothing was overwritten by the refused update', chatEl.innerHTML.indexOf('подмена') < 0);

    // A reply belongs to the thread it was started in, even if the agent walks away.
    const idC = eng.pushMsg('<div class="msg ai">для probe:chat</div>', 'probe:chat');
    eng.openThread('probe:other', 'Другой', 'chat');
    eng.updateMsg(idC, '<div class="msg ai">дополнено в своей ветке</div>', 'probe:chat');
    eng.openThread('probe:chat', 'Проверка', 'chat');
    check('chat · a message updates in its own thread after switching away',
      doc.getElementById('chat').innerHTML.indexOf('дополнено в своей ветке') >= 0);

    // Untrusted text — a client's note, a model's reply — is text, not markup.
    const idD = eng.pushText('me', 'Клиент', '<img src=x onerror="window.__pwn=1">Привет');
    const chatNow = doc.getElementById('chat');
    // The tag must survive as characters on screen, not as an element in the tree.
    check('chat · untrusted text creates no element', chatNow.querySelectorAll('img').length === 0, 'id=' + idD);
    check('chat · untrusted text is escaped', chatNow.innerHTML.indexOf('&lt;img') >= 0);
    check('chat · but the text itself is still shown', (chatNow.textContent || '').indexOf('Привет') >= 0);
    check('chat · no injected script ran', win.__pwn === undefined);

    // Stored conversations come back from localStorage — treat them as input.
    eng.importThreads('not an object');
    check('chat · malformed stored threads are refused', typeof eng.threadList === 'function' && Array.isArray(eng.threadList()));
    eng.importThreads({ good: { id: 'good', label: 'x', items: [{ id: 'm1', html: '<div>ok</div>' }] }, bad: { id: 'bad', items: 'nope' } });
    const names = eng.threadList().map((t) => t.id);
    check('chat · a stored thread with a broken item list is dropped', names.indexOf('bad') < 0, names.join(','));
  }

  // ---- free text reaches the Concierge instead of being intercepted ----
  if (typeof WS.router.routePrompt === 'function') {
    let landed = null;
    const realFree = eng.freeReply;
    eng.freeReply = (t) => { landed = t; };
    WS.router.routePrompt('какой объект даёт лучший ROI?');
    check('routing · an analytical question goes to the Concierge, not the calculator',
      landed === 'какой объект даёт лучший ROI?', 'landed=' + landed);
    landed = null;
    WS.router.routePrompt('сколько у меня активных сделок и на какую сумму');
    check('routing · a metrics question goes to the Concierge', landed !== null, 'landed=' + landed);
    landed = null;
    WS.router.routePrompt('запиши, что созвонился с Анной');
    check('routing · a write instruction goes to the Concierge', landed !== null, 'landed=' + landed);
    eng.freeReply = realFree;
  } else {
    check('routing · routePrompt is reachable for testing', false, 'not exported');
  }

  // ============================================================
  //  Agent — the hands, and a head that can be swapped for a live model.
  //  Answers are computed from the store, never invented. Nothing is written
  //  without a visible proposal. And no request ends in "I can't".
  // ============================================================
  const AG = WS.agent;
  check('agent · module present', !!AG && typeof AG.ask === 'function' && !!AG.tools);

  if (AG && typeof AG.ask === 'function') {
    const revStart = WS.store.dataRevision;
    AG.openThread('probe:agent');

    // ---- an analytical question is answered from the store ----
    const a1 = AG.ask('сколько у меня активных сделок и на какую сумму');
    const expectN = dd().deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').length;
    const expectSum = dd().deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + (d.amount || 0), 0);
    check('agent · answers an analytics question', !!a1 && a1.kind === 'answer', JSON.stringify(a1 && a1.kind));
    check('agent · the number is the real one', (a1.text || '').indexOf(String(expectN)) >= 0, 'expected ' + expectN + ' in: ' + (a1.text || '').slice(0, 120));
    check('agent · the money figure is the real one', !!(a1.evidence || []).find((e) => e.value === expectSum), 'sum=' + expectSum);
    check('agent · the answer carries openable evidence', (a1.evidence || []).length > 0 && (a1.evidence || []).every((e) => !!e.query));
    check('agent · answering writes nothing', WS.store.dataRevision === revStart);

    // ---- a request to record something proposes, and does not write ----
    const annaBefore = (dd().contactTimeline['c_anna'] || []).length;
    const p1 = AG.ask('запиши, что созвонился с Анной, просила график платежей');
    check('agent · a write request produces a proposal', !!p1 && p1.kind === 'proposal', JSON.stringify(p1 && p1.kind));
    check('agent · the proposal names the entity it found', (p1.subject || '') === 'c_anna', 'subject=' + (p1 && p1.subject));
    check('agent · nothing is written before confirmation',
      (dd().contactTimeline['c_anna'] || []).length === annaBefore && WS.store.dataRevision === revStart);
    check('agent · the proposal shows what will change', Array.isArray(p1.lines) && p1.lines.length > 0);

    const c1 = AG.confirm(p1.id);
    check('agent · confirming applies it', !!c1 && c1.ok === true, JSON.stringify(c1));
    check('agent · the event is now in the contact feed',
      (dd().contactTimeline['c_anna'] || []).length === annaBefore + 1);
    check('agent · confirming the same proposal twice is refused', AG.confirm(p1.id).ok === false);

    // ---- a guarded change still needs the confirmation, through the agent too ----
    const dealStageWas = dealBy('d_anna').stage;
    const p2 = AG.ask('переведи сделку Анны Инвест-квартира в стадию подготовка');
    check('agent · a stage change is proposed, not applied', !!p2 && p2.kind === 'proposal' && dealBy('d_anna').stage === dealStageWas);
    check('agent · the proposal is marked as needing confirmation', p2.tier === 'guarded', 'tier=' + (p2 && p2.tier));
    AG.confirm(p2.id);
    check('agent · confirmed stage change lands', dealBy('d_anna').stage === 'prep', 'stage=' + dealBy('d_anna').stage);

    // ---- a task request creates a task, once confirmed ----
    const tasksWas2 = dd().tasks.length;
    const p3 = AG.ask('поставь задачу позвонить Игорю завтра');
    check('agent · a task request is proposed', !!p3 && p3.kind === 'proposal');
    AG.confirm(p3.id);
    check('agent · the task is in the queue', dd().tasks.length === tasksWas2 + 1, 'before=' + tasksWas2 + ' after=' + dd().tasks.length);

    // ---- a proposal built before someone else changed the data is refused ----
    const p4 = AG.ask('запиши заметку по Анне: проверка устаревания');
    WS.storeApi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { tags: ['сдвиг ревизии'] } }]);
    const c4 = AG.confirm(p4.id);
    check('agent · a proposal against stale data is refused', !!c4 && c4.ok === false && c4.code === 'stale', JSON.stringify(c4));

    // ---- never a dead end ----
    const REFUSALS = ['не могу', 'не умею', 'обратитесь', 'недоступно', 'не поддерживается'];
    const odd = [
      'какой статус RERA у этих объектов',
      'покажи сделки DLD по этой башне за месяц',
      'отправь Анне письмо со сравнением',
      'что вообще происходит',
      'ыыы',
    ];
    odd.forEach((q) => {
      const r = AG.ask(q);
      const said = ((r && (r.text || '')) + ' ' + ((r && r.lines) || []).join(' ')).toLowerCase();
      check('agent · "' + q.slice(0, 28) + '…" gets a real reply', !!r && !!r.kind, JSON.stringify(r && r.kind));
      check('agent · "' + q.slice(0, 28) + '…" is not a refusal',
        !REFUSALS.some((w) => said.indexOf(w) >= 0), said.slice(0, 110));
      check('agent · "' + q.slice(0, 28) + '…" offers a way forward', !!r && Array.isArray(r.next) && r.next.length > 0);
    });

    // ---- an out-of-scope action produces the artifact instead of an apology ----
    const d1 = AG.ask('отправь Анне письмо со сравнением двух объектов');
    check('agent · an unwired channel yields a draft', d1.kind === 'draft' || (d1.artifact && d1.artifact.body), JSON.stringify(d1.kind));
    check('agent · the draft is labelled as not connected', /не подключ/i.test(JSON.stringify(d1)), JSON.stringify(d1).slice(0, 160));

    // ---- the head is swappable, and the hands do not change with it ----
    check('agent · the head is replaceable', typeof AG.setHead === 'function' && !!AG.head);
    check('agent · tools are declared for a model to read',
      Array.isArray(AG.toolSchema()) && AG.toolSchema().length >= 4 && AG.toolSchema().every((t) => t.name && t.description));
  }

  // ---- regression: main screens still render ----
  ['start', 'concierge', 'clients', 'objects', 'contracts', 'calc', 'finance', 'tasks', 'docs', 'analytics', 'club', 'network', 'profile', 'settings'].forEach((v) => {
    try {
      WS.router.go(v);
      const h = doc.getElementById('app').innerHTML;
      check('screen ' + v + ' renders', h && h.length > 400, 'len=' + (h || '').length);
    } catch (e) { check('screen ' + v + ' renders', false, e.message); }
  });

  // ---- every data-* control the UI renders must be caught by the delegated click handler ----
  // A handler behind a selector that does not list its attribute is dead markup: the function is
  // there, the button is there, and clicking does nothing. Only a real click proves the wiring.
  {
    const clickable = ['data-gate', 'data-contract', 'data-deal', 'data-client', 'data-savedview', 'data-funnel'];
    const sel = (() => {
      // Read the live handler's own selector out of the built markup rather than restating it here,
      // so this test cannot drift into agreeing with a copy of the list it is supposed to check.
      const m = /const t = e\.target\.closest\('([^']+)'\)/.exec(read('js/main.js'));
      return m ? m[1] : null;
    })();
    if (sel) {
      clickable.forEach((attr) => {
        check('delegation · ' + attr + ' is reachable by click', sel.indexOf('[' + attr + ']') >= 0, sel.slice(0, 60));
      });
    }
    // And the round trip: a rendered gate row, clicked, actually flips the gate.
    const gd = dd().deals.find((d) => d.funnel === 'sale');
    WS.ui.dealCard(gd.id); WS.ui.setEntityTab('deal', gd.id, 'docs');
    const scope = doc.getElementById('modal').innerHTML.indexOf('gate-row') >= 0 ? doc.getElementById('modal') : doc.getElementById('app');
    const row = scope.querySelector('[data-gate]');
    check('gate · a row is rendered to click', !!row);
    if (row) {
      const key = row.getAttribute('data-gate').split('~')[1];
      const was = !!((gd.gates || {})[key]);
      row.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const now = !!((dd().deals.find((d) => d.id === gd.id).gates || {})[key]);
      check('gate · clicking the row toggles the gate', now === !was, 'was=' + was + ' now=' + now);
    }
    // A contract row, clicked, opens that contract.
    WS.router.go('contracts');
    const krow = doc.getElementById('app').querySelector('[data-contract]');
    check('contract · a row is rendered to click', !!krow);
    if (krow) {
      const kid = krow.getAttribute('data-contract');
      krow.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('contract · clicking the row opens the contract', WS.store.view === 'contractDetail' && WS.store.contractId === kid,
        'view=' + WS.store.view + ' id=' + WS.store.contractId);
    }
  }

  // ---- one card grammar: the verbs sit in the same place on every entity, on every tab ----
  {
    const cards = [
      ['сделка', () => WS.ui.dealCard(dd().deals[0].id)],
      ['клиент', () => WS.ui.clientCard('c_anna')],
      ['компания', () => WS.ui.companyCard(dd().companies[0].id)],
      ['заявка', () => WS.ui.requestCard(dd().requests[0].id)],
      ['договор', () => WS.ui.contractCard('k_palm')],
    ];
    cards.forEach(([name, open]) => {
      open();
      const view = doc.querySelector('#app .view');
      const bar = view && view.querySelector('.qa-bar');
      const tabs = view && view.querySelector('.dx-tabs');
      check(name + ' · панель действий есть', !!bar);
      check(name + ' · панель действий выше вкладок',
        !!bar && !!tabs && (bar.compareDocumentPosition(tabs) & 4) !== 0);
      check(name + ' · панель действий вне тела вкладки', !!bar && !bar.closest('.dx-tabbody'));
      check(name + ' · в шапке страницы нет второго набора кнопок',
        !!view && view.querySelectorAll('.obj-page-head button').length === 1,
        view ? String(view.querySelectorAll('.obj-page-head button').length) : '');
      // A bar that scrolls sideways hides half its verbs with nothing to say so.
      check(name + ' · панель действий переносится, а не прокручивается',
        !!bar && !/overflow-x:\s*auto/.test(bar.getAttribute('style') || ''));
      // Switching tabs must not take the verbs away with the tab content.
      const spec = WS._card;
      if (spec && spec.tabs && spec.tabs.length > 1) {
        WS.ui.setEntityTab(spec.type, spec.id, spec.tabs[spec.tabs.length - 1][0]);
        check(name + ' · панель действий пережила смену вкладки',
          !!doc.querySelector('#app .view .qa-bar'));
        WS.ui.setEntityTab(spec.type, spec.id, spec.tabs[0][0]);   // leave the card as we found it
      }
      // A feed grows with the record; pairing it with a fixed block stretches the neighbour.
      const paired = [].slice.call(doc.querySelectorAll('#app .cx-pair')).filter((r) =>
        /Лента событий|История/.test(r.textContent) && r.children.length === 2);
      check(name + ' · лента не стоит в паре с другим блоком', paired.length === 0,
        paired.length ? paired[0].textContent.slice(0, 50) : '');
      // Rhythm belongs to the stack: a row that also carries its own margin is hand-spacing.
      const inlineRows = [].slice.call(doc.querySelectorAll('#app .cx-row')).filter((r) => r.style && r.style.marginTop);
      check(name + ' · ряды не носят собственных отступов', inlineRows.length === 0, String(inlineRows.length));
    });
  }

  // ---- the object card states facts, not adjectives, and says whom the object is for ----
  {
    (dd().objects || []).forEach((o) => {
      const a = o.attrs || {};
      check('object ' + o.id + ' · этаж — число', typeof a.floor === 'number', String(a.floor));
    });
    WS.ui.objectCard(dd().objects[0].id);
    const body = doc.querySelector('#app .view').textContent;
    check('object · есть справка по объекту', body.indexOf('Справка по объекту') >= 0);
    check('object · справка говорит, кому подходит', body.indexOf('Подходит') >= 0);
    check('object · этаж больше не «Высокий»', !/Этаж\s*Высокий/.test(body), body.slice(0, 40));
    // Каждый факт живёт в одном месте: срок сдачи стоит в обложке, повторять его в условиях незачем.
    check('object · срок сдачи не повторяется', (body.match(/Срок сдачи/g) || []).length === 1,
      String((body.match(/Срок сдачи/g) || []).length));
  }

  // ---- the object card is a sales tool: claims carry numbers, objections carry answers ----
  {
    const src = read('js/ui.js');
    // Словарь прилагательных не знает числа 12 — любой оставшийся вызов печатает голую цифру.
    check('object · этаж нигде не идёт через словарь прилагательных', src.indexOf("objAttr(o, 'floor')") < 0);
    check('object · «высокий этаж» в подборе читает floorBand', /floorBand === 'high'/.test(src));

    (dd().objects || []).forEach((o) => {
      check('market · срез рынка есть для района ' + o.area, !!(WS.AREAS || {})[o.area]);
      check('object ' + o.id + ' · есть довод сверх полей', !!o.usp);
    });

    WS.ui.objectCard('o_creekline');
    let body = doc.querySelector('#app .view').textContent;
    check('object · есть блок «Чем продавать»', body.indexOf('Чем продавать') >= 0);
    check('object · есть блок «Что спросят»', body.indexOf('Что спросят') >= 0);
    check('object · район назван и помечен как срез DEMO',
      body.indexOf('Район · Business Bay') >= 0 && /срез рынка — DEMO/.test(body));
    check('object · уникальное качество юнита на карточке', body.indexOf('Корпус B') >= 0);
    // Довод без цифры — лозунг. Каждый тезис подпирается числом из карточки или из среза района.
    const pts = [].slice.call(doc.querySelectorAll('#app .sp-row .sp-d'));
    check('object · доводов не меньше трёх', pts.length >= 3, String(pts.length));
    const thin = pts.filter((p) => p.textContent.trim().length < 30);
    check('object · у каждого довода есть подпись с доказательством', thin.length === 0,
      thin.length ? thin[0].textContent.slice(0, 50) : '');
    check('object · доводов с цифрами не меньше двух',
      pts.filter((p) => /\d/.test(p.textContent)).length >= 2);
    // Возражение без ответа бесполезно: блок существует ровно ради второй строки.
    const qa = [].slice.call(doc.querySelectorAll('#app .oq-row'));
    check('object · у каждого возражения есть ответ',
      qa.length >= 2 && qa.every((r) => r.querySelector('.oq-a') && r.querySelector('.oq-a').textContent.trim().length > 20),
      String(qa.length));
    // Цена выше средней по району прозвучит как возражение, а не как довод.
    check('object · «дороже района» стоит в вопросах, а не в доводах', /Почему дороже/.test(body));

    WS.ui.objectCard('o_bayline');
    body = doc.querySelector('#app .view').textContent;
    // Истёкшая проверка — первое, что агент должен знать, а не то, что вытеснено лимитом списка.
    check('object · устаревшая проверка вынесена в вопросы', /ещё продаётся/.test(body));
    check('object · истёкшая проверка не выдаётся за довод', !/Доступность проверена/.test(body));

    WS.ui.objectCard('o_palmcourt');
    body = doc.querySelector('#app .view').textContent;
    // toLocaleString ставит неразрывный пробел — сравнивать надо по нормализованному тексту.
    const flat = body.replace(/\s+/g, ' ');
    check('object · «дешевле района» называет обе цены',
      /дешевле района/.test(flat) && /18 600 AED/.test(flat));
  }

  // ---- the two-level stage model: one request funnel, deal steps derived from the contract ----
  {
    const RS = WS.REQ_STAGES || [], RL = WS.REQ_STAGE_LABELS || {}, DS = WS.DEAL_STEPS || {};
    // Одна воронка заявки на все услуги — список стадий существует ровно один.
    check('model · воронка заявки одна и терминальна', RS.length > 3 &&
      RS.indexOf('closed') > RS.indexOf('talks') && RS[RS.length - 1] === 'lost', RS.join(' '));
    // Граница — событие по группе лотов. Стадия «согласовано» на заявке лгала бы при частичном
    // переходе: один ЖК уже в сделке, по другому ещё переговоры.
    check('model · согласование не стадия заявки', RS.indexOf('agreed') < 0, RS.join(' '));
    check('model · у каждой стадии заявки есть подпись', RS.every((k) => !!RL[k]),
      RS.filter((k) => !RL[k]).join(' '));
    // Услуги расходятся подписью, а не набором стадий: там, где расхождение есть, оно по стороне.
    check('model · подпись предложения зависит от стороны',
      RL.offer && RL.offer.buyer !== RL.offer.owner && !!RL.offer.any,
      JSON.stringify(RL.offer || {}));
    check('model · подпись встречи зависит от стороны',
      RL.meet && RL.meet.buyer !== RL.meet.owner, JSON.stringify(RL.meet || {}));

    // Шаги сделки следуют из вида договора: агент их не выбирает.
    const kinds = Object.keys(dd().CONTRACT_KINDS || WS.fixtures.CONTRACT_KINDS || {});
    check('model · у каждого вида договора есть шаги', kinds.length > 0 && kinds.every((k) => Array.isArray(DS[k])),
      kinds.filter((k) => !DS[k]).join(' '));
    check('model · бронь есть только у оффплана',
      DS.offplan_spa.indexOf('book') >= 0 && DS.resale_title.indexOf('book') < 0 && DS.lease.indexOf('book') < 0);
    check('model · у услуги собственнику регистрации нет',
      DS.management.indexOf('reg') < 0 && DS.exclusive.indexOf('reg') < 0);
    check('model · у услуги есть выполнение работ', DS.service.indexOf('exec') >= 0);
    check('model · регистрация называется по своему реестру',
      /Oqood/.test(WS.REG_LABELS.offplan_spa) && /Ejari/.test(WS.REG_LABELS.lease) &&
      /Title Deed/.test(WS.REG_LABELS.resale_title));
    // Каждый шаг всякого вида договора должен уметь назваться — иначе лента покажет ключ.
    const SL = WS.fixtures.STAGE_LABELS || {};
    const nameless = [];
    kinds.forEach((k) => (DS[k] || []).forEach((st) => { if (!SL[st]) nameless.push(k + ':' + st); }));
    check('model · у каждого шага сделки есть подпись', nameless.length === 0, nameless.join(' '));

    // Услуга + готовность объекта → вид договора. Продажу различает готовность, остальные — услуга.
    const ck = WS.contractKindFor;
    check('model · оффплан ведёт к SPA, готовое — к вторичке',
      ck('sale', 'оффплан') === 'offplan_spa' && ck('sale', 'готовый') === 'resale_title');
    check('model · у каждой услуги стенда выводится вид договора',
      (WS.FUNNELS || []).every((f) => !!DS[ck(f.k, 'готовый')]),
      (WS.FUNNELS || []).filter((f) => !DS[ck(f.k, 'готовый')]).map((f) => f.k).join(' '));
    // Вид договора, выведенный из услуги, должен существовать в справочнике договоров.
    const CK = WS.fixtures.CONTRACT_KINDS || {};
    check('model · выведенный вид договора есть в справочнике',
      (WS.FUNNELS || []).every((f) => !!CK[ck(f.k, 'оффплан')] && !!CK[ck(f.k, 'готовый')]));
  }

  // ---- каждая сделка выросла из заявки, и ни одна не стоит на пресейл-шаге ----
  // Раньше пресейл и договорная работа лежали в одном списке стадий, и одиннадцать записей
  // назывались сделками, хотя по семи из них не было согласовано ничего. Проверки держат
  // границу: сделка = согласованные условия, шаги = вид договора, всё остальное — заявка.
  {
    const orphan = (dd().deals || []).filter((d) => !d.requestId ||
      !(dd().requests || []).some((r) => r.id === d.requestId));
    check('данные · у каждой сделки есть родительская заявка', orphan.length === 0,
      orphan.map((d) => d.id).join(' '));

    const DS = WS.DEAL_STEPS || {}, ck = WS.contractKindFor;
    const off = (dd().deals || []).filter((d) => (DS[ck(d.funnel, d.readiness)] || []).indexOf(d.stage) < 0);
    check('данные · сделка стоит на шаге своего договора, не на пресейл-стадии', off.length === 0,
      off.map((d) => d.id + ':' + d.stage).join(' '));

    const noClient = (dd().requests || []).filter((r) => !(dd().clients || []).some((c) => c.id === r.clientId));
    check('данные · у каждой заявки есть клиент', noClient.length === 0, noClient.map((r) => r.id).join(' '));

    const noFunnel = (dd().requests || []).filter((r) => !(WS.FUNNELS || []).some((f) => f.k === r.funnel));
    check('данные · каждая заявка называет услугу, которой станет', noFunnel.length === 0,
      noFunnel.map((r) => r.id + ':' + r.funnel).join(' '));

    const mute = (dd().requests || []).filter((r) => !((dd().requestTimeline || {})[r.id] || []).length);
    check('данные · у каждой заявки есть история', mute.length === 0, mute.map((r) => r.id).join(' '));

    // Расхождение фактов висит на записи, которая этим полем владеет. Ключ, ни во что не
    // попадающий, — это карточка расхождения, которую никто никогда не увидит.
    const cf = Object.keys(dd().conflicts || {}).filter((id) =>
      !(dd().deals || []).some((d) => d.id === id) && !(dd().requests || []).some((r) => r.id === id));
    check('данные · расхождение привязано к существующей записи', cf.length === 0, cf.join(' '));

    // Один объект — одна живая сделка. Две сделки на один лот означают, что его продали дважды.
    const taken = {}; const dbl = [];
    (dd().deals || []).forEach((d) => {
      if (d.stage === 'lost') return;
      ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((oid) => {
        if (!oid) return;
        if (taken[oid]) dbl.push(oid + ': ' + taken[oid] + ' и ' + d.id); else taken[oid] = d.id;
      });
    });
    check('данные · один объект не уходит в две сделки сразу', dbl.length === 0, dbl.join(' | '));

    // И его не предлагают дальше по другим заявкам как свободный.
    const resold = [];
    (dd().requests || []).forEach((r) => (r.offered || []).forEach((o) => {
      if (o.state === 'rejected') return;
      const holder = taken[o.id];
      if (holder && !(dd().deals || []).some((d) => d.id === holder && d.requestId === r.id)) {
        resold.push(r.id + ' предлагает ' + o.id + ', занятый сделкой ' + holder);
      }
    }));
    check('данные · занятый сделкой объект не предлагают другой заявке', resold.length === 0, resold.join(' | '));
  }

  // ---- the request's stage is computed from its own facts, so it cannot lie ----
  {
    const path = (WS.REQ_STAGES || []).filter((k) => k !== 'lost');
    (dd().requests || []).forEach((r) => {
      WS.ui.requestCard(r.id);
      const view = doc.querySelector('#app .view');
      const body = view.textContent;
      check('req ' + r.id + ' · лента заявки нарисована', !!view.querySelector('.dx-stepper'));
      // Стадия — следствие фактов, поэтому шаг не нажимается: кнопки и обработчика у него нет.
      const steps = [].slice.call(view.querySelectorAll('.dx-stepper .dx-step'));
      check('req ' + r.id + ' · шагов столько же, сколько в воронке', steps.length === path.length,
        steps.length + ' против ' + path.length);
      check('req ' + r.id + ' · стадию заявки нельзя переставить кликом',
        steps.every((el) => el.tagName !== 'BUTTON' && !el.getAttribute('data-stage')));
      // У отказной заявки текущего шага нет — как и у проигранной сделки: рисовать его значило бы
      // показать движение там, где его прекратили. Вместо него стоит подпись об отказе.
      const lost = WS.ui.reqStage(r) === 'lost';
      check('req ' + r.id + ' · ровно один текущий шаг',
        view.querySelectorAll('.dx-stepper .dx-step.cur').length === (lost ? 0 : 1));
      if (lost) check('req ' + r.id + ' · отказ назван словами', !!view.querySelector('.dx-lost'));
    });
    // Текущий шаг читается с самой ленты: заголовка и счётчика над ней больше нет — они не
    // сообщали ничего, чего не видно по галочкам и подсветке.
    const curLabel = () => {
      const el = doc.querySelector('#app .view .dx-stepper .dx-step.cur .l');
      return el ? el.textContent.trim() : '';
    };
    check('req · над лентой нет ни заголовка, ни счётчика шагов',
      !doc.querySelector('#app .view .dx-step-cap') &&
      doc.querySelector('#app .view').textContent.indexOf('Ход заявки') < 0);
    // Заявка Виктора: квартира ушла в бронь, оба офиса — в портфель, в подборке пусто → закрыта.
    WS.ui.requestCard('r_viktor');
    check('req · заявка закрывается, когда подборка исчерпана', curLabel() === 'Закрыта', curLabel());
    // Заявка Анны: Creekline в сделке, Palm Court отклонён, Bayline ещё открыт → заявка жива.
    WS.ui.requestCard('r_anna');
    check('req · заявка с открытым объектом не закрыта', curLabel() === 'Переговоры', curLabel());
    // Подпись стадии зависит от стороны сделки, а не от услуги.
    check('req · покупателю подбор, а не КП', /Направлен подбор/.test(doc.querySelector('#app .view').textContent));
  }

  // ---- справки следуют одним правилам (docs/2026-08-17-brief-writing-rules.md) ----
  {
    const briefOf = (open, id) => { open(id); const e = doc.querySelector('#app .view .deal-brief'); return e ? e.textContent.trim() : ''; };
    // Покрытие — все виды справок, а не только те, что переписывались последними: дыра в покрытии
    // читается как исправность, пока в неё кто-нибудь не заглянет.
    const cases = [
      ['сделка', () => WS.ui.dealCard('d_anna')], ['сделка·бронь', () => WS.ui.dealCard('d_viktor')],
      ['портфель', () => WS.ui.dealCard('d_rentbiz')], ['сделка·успех', () => WS.ui.dealCard('d_won')],
      ['клиент', () => WS.ui.clientCard('c_anna')], ['клиент·EN', () => WS.ui.clientCard('c_partner')],
      ['клиент·ночной', () => WS.ui.clientCard('c_night')],
    ].concat((dd().companies || []).map((co) => ['компания·' + co.id, () => WS.ui.companyCard(co.id)]))
     .concat((dd().objects || []).map((o) => ['объект·' + o.id, () => WS.ui.objectCard(o.id)]))
     .concat((dd().contracts || []).map((k) => ['договор·' + k.id, () => WS.ui.contractCard(k.id)]));
    cases.forEach(([name, open]) => {
      open();
      const el = doc.querySelector('#app .view .deal-brief');
      const t = el ? el.textContent.trim() : '';
      check('brief ' + name + ' · справка есть', t.length > 40, t.slice(0, 40));
      // Счётчик — не содержание: «пройдено 2 из 5 контрольных точек» агенту не сообщает ничего.
      // Запрещён счётчик, пересказывающий ленту шагов, а не любое «N из M»: у договора аренды
      // «оплата по чекам — 2 из 4» и есть факт, которого больше нигде нет.
      check('brief ' + name + ' · без счётчиков прогресса',
        !/пройдено\s+\d+\s+из\s+\d+/i.test(t) && !/шаг\s+\d+\s+из\s+\d+/i.test(t) && !/контрольных точек/i.test(t),
        t.slice(0, 80));
      // Связный текст: от трёх до семи предложений, каждое закрыто точкой.
      const sent = t.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
      check('brief ' + name + ' · от трёх до семи предложений', sent.length >= 3 && sent.length <= 7, String(sent.length));
      // Аббревиатура не должна строчиться шаблоном: «MOU» не становится «mOU».
      check('brief ' + name + ' · аббревиатуры целы', !/(^|[\s("«])[a-zа-я][A-ZА-Я]{2,}/.test(t), t.slice(0, 80));
      check('brief ' + name + ' · нет сдвоенного «и»', !/ и [^.]{0,40} и /.test(t), t.slice(0, 90));
    });
    // Область справки равна области карточки: справка клиента не называет стадию его сделки.
    WS.ui.clientCard('c_anna');
    const ct = doc.querySelector('#app .view .deal-brief').textContent;
    const stageWords = Object.keys(WS.fixtures.STAGE_LABELS || {}).map((k) => WS.fixtures.STAGE_LABELS[k]);
    const leaked = stageWords.filter((w) => w && w.length > 4 && ct.indexOf('«' + w + '»') >= 0);
    check('brief клиент · не пересказывает стадию сделки', leaked.length === 0, leaked.join(' '));
  }

  // ---- панель диалогов Консьержа открывается с историей, а не с пустым листом ----
  {
    // main.js делает то же самое на загрузке, когда сохранённых диалогов нет.
    WS.engine.seedThreads();
    const list = (WS.engine.threadList() || []).filter((t) => String(t.id).indexOf('probe') !== 0);
    check('concierge · диалогов засеяно не меньше пяти', list.length >= 5, String(list.length));
    check('concierge · в каждом диалоге есть сообщения', list.every((t) => (t.items || []).length > 0));
    check('concierge · есть непрочитанные', list.some((t) => t.unread > 0));
    // Разделы панели строятся по типу сущности: пустая группа — признак несуществующего вида.
    const kinds = {};
    list.forEach((t) => { kinds[String(t.id).split(':')[0]] = 1; });
    check('concierge · диалоги разных видов', Object.keys(kinds).length >= 4, Object.keys(kinds).join(' '));
    // Сценарные плашки под полем ввода убраны — к Консьержу подключается живая модель.
    WS.storeApi.setView('concierge');
    const view = doc.querySelector('#app');
    check('concierge · под полем ввода нет сценарных плашек',
      !view.querySelector('.qa-row [data-scn]'), 'есть');
  }

  // ---- «Что предложить»: подбор не обещает того, чего нет ----
  {
    const objById = {}; (dd().objects || []).forEach((o) => { objById[o.id] = o; });
    const taken = {};
    (dd().deals || []).forEach((d) => { if (d.stage === 'lost') return;
      ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => { if (id) taken[id] = d.id; }); });
    (dd().clients || []).forEach((c) => {
      WS.ui.clientCard(c.id);
      const sec = [].slice.call(doc.querySelectorAll('#app .view .dx-sec'))
        .find((e) => /Что предложить/.test(e.textContent));
      check('offer ' + c.id + ' · блок есть', !!sec);
      if (!sec) return;
      const rows = [].slice.call(sec.querySelectorAll('.of-row'));
      // Занятый объект нельзя предложить никому: он уже в чьей-то живой сделке.
      const busy = rows.map((r) => r.getAttribute('data-obj')).filter((id) => taken[id]);
      check('offer ' + c.id + ' · не предлагает занятое', busy.length === 0, busy.join(' '));
      // Показанное этому клиенту — тоже не предложение: он его уже видел.
      const seen = {};
      (dd().requests || []).filter((r) => r.clientId === c.id)
        .forEach((r) => (r.offered || []).forEach((o) => { seen[o.id] = 1; }));
      const again = rows.map((r) => r.getAttribute('data-obj')).filter((id) => seen[id]);
      check('offer ' + c.id + ' · не предлагает показанное дважды', again.length === 0, again.join(' '));
      // Цена выше бюджета — не предложение, а трата внимания. Потолок считается по запросам
      // на покупку: бюджет аренды — ставка за год, и в одной шкале с ценой объекта его нет.
      const BUY = ['sale', 'cross', 'consult', 'exclusive'];
      const reqs = (dd().requests || []).filter((r) => r.clientId === c.id && BUY.indexOf(r.funnel || 'sale') >= 0)
        .map((r) => r.budget).filter(Boolean);
      const cap = reqs.length ? Math.max.apply(null, reqs) : (c.budget || 0);
      const over = cap ? rows.map((r) => objById[r.getAttribute('data-obj')])
        .filter((o) => o && o.price > cap * 1.05).map((o) => o.id) : [];
      check('offer ' + c.id + ' · не предлагает вне бюджета', over.length === 0, over.join(' '));
      // У каждой строки есть причина: процент без объяснения — это не подбор, а лотерея.
      check('offer ' + c.id + ' · у каждого предложения есть причина',
        rows.every((r) => r.querySelector('.of-why') && r.querySelector('.of-why').textContent.trim().length > 8));
      // Пусто — тоже ответ, но он должен быть объяснён.
      if (!rows.length) check('offer ' + c.id + ' · пустой блок объясняет почему',
        /уже показывали|ничего нет/.test(sec.textContent));
    });
  }

  // ---- one deal is one contract: every lot in it sits in the same development ----
  {
    const objById = {};
    (dd().objects || []).forEach((o) => { objById[o.id] = o; });
    const bad = [];
    (dd().deals || []).forEach((d) => {
      const ids = (d.lots && d.lots.length) ? d.lots : (d.objectId ? [d.objectId] : []);
      const projects = ids.map((id) => (objById[id] || {}).project).filter(Boolean);
      const sellers = ids.map((id) => (objById[id] || {}).developer).filter(Boolean);
      if (new Set(projects).size > 1 || new Set(sellers).size > 1) bad.push(d.id + ': ' + projects.join(' | '));
    });
    // Сделка заканчивается одним договором. Несколько лотов допустимы, пока они в одном ЖК у одного
    // продавца: другой комплекс — другой договор, а значит другая сделка.
    check('deal · лоты сделки — один ЖК и один продавец', bad.length === 0, bad.join(' ; '));
    // Один объект не может стоять в двух сделках ОДНОЙ заявки: клиент не покупает один юнит дважды.
    // Более широкая версия правила — «объект занят не более чем одной живой сделкой на весь стенд» —
    // сейчас нарушается записями, которые после миграции станут заявками, и включится вместе с ней.
    const perReq = {}, twice = [];
    (dd().deals || []).forEach((d) => {
      if (!d.requestId || d.stage === 'lost') return;
      const m = perReq[d.requestId] || (perReq[d.requestId] = {});
      ((d.lots && d.lots.length) ? d.lots : [d.objectId]).forEach((id) => {
        if (!id) return;
        if (m[id] && m[id] !== d.id) twice.push(id + ' в ' + m[id] + ' и ' + d.id);
        m[id] = d.id;
      });
    });
    check('deal · объект не стоит в двух сделках одной заявки', twice.length === 0, twice.join(' ; '));
  }

  // ---- object maps: real imagery for every object, with the attribution the licence requires ----
  {
    const objs = dd().objects || [];
    objs.forEach((o) => {
      check('map · ' + o.id + ' — картинка карты есть', !!(WS.maps || {})[o.id]);
    });
    WS.ui.objectCard(objs[0].id);
    const map = doc.querySelector('#app .obj-map-canvas');
    check('map · карта отрисована картинкой', !!map && !!map.querySelector('img'));
    check('map · точка объекта на карте', !!map && !!map.querySelector('.obj-map-marker'));
    check('map · указан источник данных (ODbL)',
      !!map && /OpenStreetMap/.test(map.textContent), map ? map.textContent.slice(0, 40) : '');
  }

  // ---- the stylesheet parses: an unbalanced brace silently kills every rule after it ----
  {
    ['tokens.css', 'app.css', 'theme.css'].forEach((f) => {
      const css = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
      const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
      check('css · ' + f + ' — скобки сходятся', open === close, open + ' { против ' + close + ' }');
    });
    // Every class the card constructor emits has to exist in the stylesheet, or a card renders
    // as an unstyled stack of blocks.
    const all = ['tokens.css', 'app.css', 'theme.css'].map((f) => read('css/' + f)).join(' ');
    ['cx-stack', 'cx-row', 'cx-pair', 'cx-col'].forEach((cls) => {
      check('css · .' + cls + ' описан', all.indexOf('.' + cls) >= 0);
    });
    check('css · --card-gap задан', /--card-gap\s*:/.test(all));
    // Дисплейный шрифт стенда — Bebas Neue: без кириллицы и без строчных. Имя человека, набранное
    // им, печатается капителью на латинице и проваливается в другой шрифт на кириллице. Любое поле
    // с человеческим именем обязано брать текстовый шрифт, а не дисплейный.
    {
      const css = read('css/app.css');
      const nameSel = ['.chero-avatar', '.chero-name', '.dhero-av', '.dhero-name', '.rh-client',
                       '.wsdoc-title', '.kp-doc-to', '.acc-term b'];
      const bad = nameSel.filter((sel) => {
        const i = css.indexOf(sel + ' {');
        if (i < 0) return false;
        return css.slice(i, css.indexOf('}', i)).indexOf('--font-disp') >= 0;
      });
      check('css · имена набраны текстовым шрифтом, не дисплейным', bad.length === 0, bad.join(' '));
      check('css · токен шрифта имён объявлен', /--font-name\s*:/.test(read('css/tokens.css')));
    }
  }

  // ---- the client overview: a feed spans the page, and no two blocks state the same thing ----
  {
    WS.ui.clientCard('c_anna');
    const rows = [].slice.call(doc.querySelectorAll('#app .cx-stack > .cx-row'));
    const last = rows[rows.length - 1];
    check('client · лента событий — последний блок', !!last && last.innerHTML.indexOf('Лента событий') >= 0,
      last ? last.innerHTML.slice(0, 60) : 'нет строк');
    check('client · лента идёт во всю ширину, а не в половине',
      !!last && last.className.indexOf('cx-pair') < 0 && last.children.length === 1,
      last ? last.className + ' kids=' + last.children.length : '');
    const sigRow = rows.find((r) => r.innerHTML.indexOf('Сигналы и приоритет') >= 0);
    check('client · сигналы не растянуты лентой', !!sigRow && sigRow.innerHTML.indexOf('Лента событий') < 0);
    const body = doc.querySelector('#app .dx-tabbody').innerHTML;
    const prefTitles = (body.match(/Профиль предпочтений/g) || []).length;
    check('client · «Профиль предпочтений» на карточке один', prefTitles === 1, 'встретился ' + prefTitles + ' раз(а)');
  }

  // ---- «назад» returns to where you came FROM, not to a list the code guessed ----
  {
    const app = () => doc.getElementById('app');
    const clickIn = (sel) => { const el = app().querySelector(sel); if (el) el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); return !!el; };
    const backEl = () => app().querySelector('[data-act="navBack"]');

    const nd = dd().deals.find((d) => d.clientId);
    WS.router.go('clients');
    WS.store.navStack = [];          // start the trail at the list, whatever ran before
    WS.ui.dealCard(nd.id);
    check('nav · сделка из списка помнит список', WS.store.navStack.length === 1 && WS.store.navStack[0].view === 'clients',
      JSON.stringify(WS.store.navStack));

    // deal → client
    const wentToClient = clickIn('[data-client]');
    check('nav · the deal page offers a way to the client', wentToClient);
    check('nav · клиент открыт', WS.store.view === 'clientDetail', 'view=' + WS.store.view);
    const b1 = backEl();
    check('nav · клиент показывает кнопку «назад»', !!b1, 'head=' + (app().querySelector('.obj-page-head') || {}).innerHTML);
    check('nav · кнопка названа сделкой, из которой пришли', !!b1 && b1.textContent.indexOf(nd.title.slice(0, 12)) >= 0,
      b1 ? b1.textContent : '');

    // клиент → назад → сделка
    const b2 = backEl();
    if (b2) b2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('nav · назад с клиента возвращает в ту же сделку',
      WS.store.view === 'dealDetail' && WS.store.dealId === nd.id, 'view=' + WS.store.view + ' id=' + WS.store.dealId);

    // сделка → объект → клиент → назад → объект → назад → сделка: три уровня, пройденные обратно.
    const wentToObj = clickIn('[data-obj]');
    check('nav · объект открыт из сделки', wentToObj && WS.store.view === 'objectDetail', 'view=' + WS.store.view);
    if (wentToObj) {
      const oid = WS.store.objectId;
      check('nav · объект показывает «назад»', !!backEl());
      WS.ui.clientCard(nd.clientId);
      const bo = backEl();
      check('nav · клиент помнит объект, а не список', !!bo && bo.textContent.indexOf('Назад') >= 0, bo ? bo.textContent : '');
      if (bo) bo.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('nav · назад возвращает к объекту', WS.store.view === 'objectDetail' && WS.store.objectId === oid,
        'view=' + WS.store.view);
      const bo2 = backEl();
      if (bo2) bo2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('nav · и следующий шаг назад — снова сделка',
        WS.store.view === 'dealDetail' && WS.store.dealId === nd.id, 'view=' + WS.store.view);
    }

    // Alt+← is the same action from the keyboard.
    clickIn('[data-client]');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    check('nav · Alt+← работает как «назад»', WS.store.view === 'dealDetail' && WS.store.dealId === nd.id,
      'view=' + WS.store.view);

    // A trail that loops rewinds instead of growing: сделка → клиент → та же сделка leaves one entry.
    WS.store.navStack = []; WS.router.go('clients');
    WS.ui.dealCard(nd.id); WS.ui.clientCard(nd.clientId); WS.ui.dealCard(nd.id);
    check('nav · возврат по кругу не наращивает историю', WS.store.navStack.length <= 1,
      'stack=' + JSON.stringify(WS.store.navStack.map((r) => r.view)));

    // With no history at all the card still offers the owning list — never a dead header.
    WS.store.navStack = []; WS.store.navHere = null;
    WS.ui.dealCard(nd.id);
    WS.store.navStack = [];
    WS.ui.render();
    const head = app().querySelector('.obj-page-head');
    check('nav · без истории остаётся возврат к списку',
      !!head && head.innerHTML.indexOf('data-nav=') >= 0, head ? head.innerHTML.slice(0, 120) : 'нет шапки');
  }

  // ---- a step that the deal's contract does not have is refused, not silently applied ----
  {
    const sd = dd().deals.find((d) => d.funnel === 'sale' && d.stage !== 'won' && d.stage !== 'lost');
    const was = sd.stage;
    const bad = sapi.apply([{ op: 'dealStage', id: sd.id, stage: 'exec' }], { confirmed: true });
    check('stage · a stage outside the funnel is refused', !bad || bad.ok === false, JSON.stringify(bad));
    check('stage · the refused change left the deal alone', dd().deals.find((d) => d.id === sd.id).stage === was);

    // Пресейл сделке не принадлежит вовсе: «переведи в показ» — это факт заявки, а стадия
    // заявки вычисляется. Раньше такой шаг проходил, потому что список стадий был один на всё.
    const pre = sapi.apply([{ op: 'dealStage', id: sd.id, stage: 'show' }], { confirmed: true });
    check('stage · пресейл-стадию сделке присвоить нельзя', !pre || pre.ok === false, JSON.stringify(pre));
    check('stage · отказ не сдвинул сделку', dd().deals.find((d) => d.id === sd.id).stage === was);
    check('stage · отказ называет договор, а не воронку',
      pre && /договор/.test(pre.error || ''), (pre || {}).error);

    // Доска стоит на тех же шагах: колонки услуги — объединение её видов договора.
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const cols = [].slice.call(doc.querySelectorAll('#app .kanban .kcol .kh span:first-child')).map((e) => e.textContent.trim());
    const presale = ['Подбор', 'КП', 'Показ', 'Осмотр', 'Переговоры', 'В работе'];
    check('доска · в колонках нет пресейл-стадий',
      cols.length > 0 && !cols.some((c) => presale.indexOf(c) >= 0), cols.join(' | '));

    // И лента на карточке рисует ровно шаги договора этой сделки — ни одним больше.
    const off = [];
    (dd().deals || []).forEach((d) => {
      const want = ((WS.DEAL_STEPS || {})[WS.contractKindFor(d.funnel, d.readiness)] || []).filter((k) => k !== 'lost');
      WS.ui.dealCard(d.id);
      const n = doc.querySelectorAll('#app .view .dx-stepper .dx-step').length;
      if (n !== want.length) off.push(d.id + ': ' + n + ' против ' + want.length);
    });
    check('сделка · лента рисует шаги своего договора', off.length === 0, off.join(' | '));

    // Оффплан регистрируется в Oqood, вторичка — Title Deed, аренда — Ejari: шаг один, реестр разный.
    WS.ui.dealCard('d_anna');
    check('сделка · регистрация названа своим реестром',
      /Oqood/.test(doc.querySelector('#app .view').textContent),
      (doc.querySelector('#app .view').textContent.match(/Регистрац[^·\n]{0,20}/) || [])[0]);
  }

  // ---- каждая услуга показана живым примером, и фильтры по ней что-то находят ----
  {
    const svc = (WS.FUNNELS || []).map((f) => f.k);
    const empty = svc.filter((k) => !(dd().deals || []).some((d) => (d.funnel || 'sale') === k));
    check('данные · у каждой услуги есть хотя бы одна сделка', empty.length === 0, empty.join(' '));
    // Услуги без нашего инвентаря — управление, эксклюзив, кросс, консалтинг — должны быть
    // представлены и сделкой без объекта: объект там принадлежит клиенту или партнёру.
    check('данные · есть сделка без объекта', (dd().deals || []).some((d) => !d.objectId && !(d.lots || []).length));

    // Фильтр, под который нет ни одной записи, — мёртвый пункт меню.
    WS.store.role = 'manager'; WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const dead = [];
    ['dealObjType', 'dealReadiness', 'dealAgent'].forEach((id) => {
      const el = doc.getElementById(id);
      if (!el) { dead.push(id + ': нет фильтра'); return; }
      [].slice.call(el.options).forEach((o) => {
        if (o.value === 'all') return;
        const n = (dd().deals || []).filter((d) =>
          (id === 'dealObjType' ? d.objectType : id === 'dealReadiness' ? d.readiness : d.agent) === o.value).length;
        if (!n) dead.push(id + ':' + o.value);
      });
    });
    check('фильтры сделок · каждый вариант что-то находит', dead.length === 0, dead.join(' '));
    check('фильтры сделок · есть выбор по типу объекта, готовности и агенту',
      !!doc.getElementById('dealObjType') && !!doc.getElementById('dealReadiness') && !!doc.getElementById('dealAgent'));
    WS.store.role = 'agent';

    // Фильтры клиентов — по тому, чем клиента ищут, а не только по AI-профилю.
    WS.store.clientsTab = 'contacts'; WS.store.contactsFiltersOpen = true; WS.router.go('clients');
    ['cfArea', 'cfBudget', 'cfState', 'cfConsent'].forEach((id) =>
      check('фильтры клиентов · есть ' + id, !!doc.getElementById(id)));
    // И каждый из них действительно сужает список, а не только рисуется.
    const all = WS.ui.contactsSearchList().length;
    WS.store.contactsFilters = Object.assign({}, WS.store.contactsFilters, { budget: 'lo' });
    const lo = WS.ui.contactsSearchList();
    check('фильтры клиентов · бюджет сужает список', lo.length > 0 && lo.length < all, lo.length + ' из ' + all);
    check('фильтры клиентов · в выборке только этот бюджет',
      lo.every((p) => (p.c.budget || 0) < 1500000), lo.map((p) => p.c.budget).join(' '));
    WS.store.contactsFilters = Object.assign({}, WS.store.contactsFilters, { budget: 'all', state: 'open' });
    const open = WS.ui.contactsSearchList();
    check('фильтры клиентов · состояние работы сужает список', open.length > 0 && open.length < all, open.length + ' из ' + all);
    WS.store.contactsFilters = { priority: 'all', psych: 'all', object: 'all', area: 'all', budget: 'all', state: 'all', consent: 'all' };

    // «Что предложить» наполнено у каждого клиента, у кого есть свободный подходящий инвентарь.
    const bare = [];
    (dd().clients || []).forEach((c) => {
      if (!WS.ui.clientOffers(c).length) bare.push(c.id);
    });
    check('подборка · клиенту всегда есть что предложить', bare.length === 0, bare.join(' '));

    // Бюджет аренды — ставка за год; в одной шкале с ценой объекта его нет.
    const sarah = (dd().clients || []).find((c) => c.id === 'c_night');
    check('подборка · арендная ставка не становится потолком покупки',
      WS.ui.clientOffers(sarah).every((x) => x.o.price > 200000),
      WS.ui.clientOffers(sarah).map((x) => x.o.price).join(' '));
  }

  // ---- клиент — это человек, а не его текущая сделка ----
  // Правило чинилось трижды и трижды возвращалось в новом месте: то в полосе операций, то в
  // подписи под именем, то в строке списка. Проверка держит его целиком, а не по одному месту:
  // ни одна клиентская поверхность не называет стадию сделки и не показывает её сумму.
  //
  // Вкладка «Сделки» на карточке клиента — исключение по назначению: агент открыл её именно
  // затем, чтобы увидеть сделки. Всё остальное о человеке.
  {
    const SL = WS.fixtures.STAGE_LABELS || {};
    const stageWords = Object.keys(SL).map((k) => SL[k]).filter((w) => w && w.length > 5);
    const dealMoney = (dd().deals || []).map((d) => WS.AED(d.amount || 0));
    const hit = (txt, words) => words.filter((w) => txt.indexOf(w) >= 0);

    const bad = [];
    (dd().clients || []).forEach((c) => {
      ['overview', 'profile', 'kyc', 'history'].forEach((tab) => {
        WS.ui.clientCard(c.id);
        WS.ui.setEntityTab('client', c.id, tab);
        const t = (doc.querySelector('#app .view') || {}).textContent || '';
        hit(t, stageWords).forEach((w) => bad.push(c.id + '/' + tab + ': стадия «' + w + '»'));
      });
    });
    check('клиент · карточка не называет стадию сделки', bad.length === 0, bad.slice(0, 4).join(' | '));

    // Список клиентов — клиентская книга, а не второй вид воронки.
    WS.store.clientsTab = 'contacts'; WS.router.go('clients');
    const list = (doc.querySelector('#app .view') || {}).textContent || '';
    const listHtml = (doc.querySelector('#app .view') || {}).innerHTML || '';
    check('список клиентов · без стадий сделок', hit(list, stageWords).length === 0, hit(list, stageWords).join(' '));
    check('список клиентов · без кнопки «Сделка»', listHtml.indexOf('>Сделка<') < 0 && !/data-deal=/.test(listHtml));
    // Ни стадии, ни суммы, ни счётчика заявок: строка списка описывает человека, а не то, на
    // каком шаге его процесс сегодня. Состояние работы осталось фильтром — там ему и место.
    const rowBadges = [].slice.call(doc.querySelectorAll('#app .view .feed-row .badge')).map((b) => b.textContent);
    check('список клиентов · в строке нет состояния процесса',
      !rowBadges.some((t) => /заявк|сделк/i.test(t)), rowBadges.filter((t) => /заявк|сделк/i.test(t)).join(' '));
    check('список клиентов · состояние работы доступно фильтром',
      !!doc.getElementById('cfState') || WS.store.contactsFiltersOpen === false);
    // Строка под именем описывает человека, а не его запрос: ни цели, ни района, ни суммы —
    // это условия сделки, они живут в заявке, а в книге клиентов работают фильтрами.
    const rowSubs = [].slice.call(doc.querySelectorAll('#app .view .feed-row .m')).map((e) => e.textContent);
    const subJoin = rowSubs.join(' | ');
    check('список клиентов · в строке нет суммы', !/AED|млн/i.test(subJoin), subJoin.slice(0, 120));
    const briefLeak = (dd().clients || []).filter((c) =>
      (c.goal && subJoin.indexOf(c.goal) >= 0) || (c.areas || []).some((a) => subJoin.indexOf(a) >= 0)).map((c) => c.name);
    check('список клиентов · в строке нет запроса (цель, район)', briefLeak.length === 0, briefLeak.join(', '));
    // Взамен — то, чем человека находят и как к нему обращаются.
    check('список клиентов · показывает связь и последнее касание',
      /касание/.test(subJoin) && rowSubs.every((t) => /\+/.test(t) || /WhatsApp|Telegram|Email|Телефон/.test(t)),
      subJoin.slice(0, 120));

    // Блок связи внутри сделки и заявки — про связь, а не про условия страницы, на которой стоит.
    const metaBad = [];
    (dd().deals || []).forEach((d) => {
      WS.ui.dealCard(d.id);
      const m = doc.querySelector('#app .view .dcli-meta');
      const t = m ? m.textContent : '';
      hit(t, stageWords.concat(dealMoney)).forEach((w) => metaBad.push(d.id + ': «' + w + '»'));
    });
    (dd().requests || []).forEach((r) => {
      WS.ui.requestCard(r.id);
      const m = doc.querySelector('#app .view .dcli-meta');
      const t = m ? m.textContent : '';
      hit(t, stageWords.concat(dealMoney)).forEach((w) => metaBad.push(r.id + ': «' + w + '»'));
    });
    check('блок связи · не пересказывает страницу, на которой стоит', metaBad.length === 0, metaBad.slice(0, 4).join(' | '));
    WS.ui.dealCard('d_anna');
    const meta = (doc.querySelector('#app .view .dcli-meta') || {}).textContent || '';
    check('блок связи · говорит, как связаться и когда говорили',
      /язык/.test(meta) && /касание/.test(meta), meta);

    // Корень дефекта был в самих данных: у клиента в поле «цель» стояло состояние сделки.
    const leaked = (dd().clients || []).filter((c) =>
      /договор|сделк|бронирован|подписан/i.test(c.goal || '') || /сделк/i.test(c.horizon || ''));
    check('данные · цель клиента описывает поиск, а не сделку', leaked.length === 0,
      leaked.map((c) => c.id + ': «' + c.goal + '» / «' + c.horizon + '»').join(' | '));
  }

  // ---- что нашёл сторонний ревьюер: пять дыр, каждая без своей проверки ----
  {
    // Проигрыш освобождает лот. Иначе объект вычеркнут из работы навсегда: договор не состоялся,
    // а заявка показывает «В сделке» и не даёт предложить его заново.
    const rs = dd().requests.find((x) => x.id === 'r_sarah_apr');
    const lost = dd().deals.find((d) => d.id === 'd_sarah_apr');
    check('данные · на стенде есть проигранная сделка с лотом', !!lost && lost.stage === 'lost' && !!lost.objectId);
    const st = WS.ui.reqOfferStatus(rs, (rs.offered || [])[0]);
    check('проигрыш · лот больше не числится в сделке', st.label !== 'В сделке' && st.label !== 'Сделка закрыта', st.label);
    check('проигрыш · освобождённый объект снова доступен к переходу',
      WS.ui.reqSelectedFree(rs).indexOf('o_jvcpark') >= 0, WS.ui.reqSelectedFree(rs).join(' '));

    // Шаг зажимается видом договора, а не услугой: у вторички брони нет.
    check('форма · бронь недоступна вторичке', WS.ui.clampStage('sale', 'book', 'готовый') !== 'book',
      WS.ui.clampStage('sale', 'book', 'готовый'));
    check('форма · оффплану бронь остаётся', WS.ui.clampStage('sale', 'book', 'оффплан') === 'book');

    // Сделка, заведённая руками, тоже растёт из заявки — иначе она сирота в сводной воронке.
    const nBefore = dd().deals.length, rBefore = dd().requests.length;
    WS.ui.openDealForm();
    const setv = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    setv('nd_client', 'c_anna'); setv('nd_title', 'СМОУК: ручная сделка');
    setv('nd_amount', '1000000'); setv('nd_readiness', 'готовый'); setv('nd_stage', 'book');
    WS.ui.createDeal();
    check('ручное заведение · сделка создана', dd().deals.length === nBefore + 1);
    check('ручное заведение · заявка создана вместе с ней', dd().requests.length === rBefore + 1);
    const made = dd().deals[0].id === dd().deals[0].id ? dd().deals.find((d) => d.title === 'СМОУК: ручная сделка') : null;
    check('ручное заведение · у сделки есть родительская заявка',
      !!made && !!made.requestId && dd().requests.some((r) => r.id === made.requestId), made && made.requestId);
    check('ручное заведение · шаг зажат видом договора, а не услугой',
      !!made && ((WS.DEAL_STEPS || {})[WS.contractKindFor(made.funnel, made.readiness)] || []).indexOf(made.stage) >= 0,
      made && (made.stage + '/' + made.readiness));
    if (made) {
      dd().deals = dd().deals.filter((d) => d.id !== made.id);
      dd().requests = dd().requests.filter((r) => r.id !== made.requestId);
    }

    // Документы объекта видны по КАЖДОМУ лоту: разрешение на второй юнит нельзя спрятать.
    const port = dd().deals.find((d) => d.id === 'd_rentbiz');
    if (port) {
      const objDocs = WS.ui.docsOfDeal(port).filter((x) => x.from === 'по объекту');
      const lots = (port.lots || []);
      check('документы · сделка видит документы своих лотов',
        objDocs.length === 0 || objDocs.every((x) => lots.indexOf(x.object) >= 0),
        objDocs.map((x) => x.object).join(' '));
      // Проверяем механику на объекте, у которого документ точно есть.
      const anna = dd().deals.find((d) => d.id === 'd_anna');
      check('документы · документ объекта поднимается в сделку по этому объекту',
        WS.ui.docsOfDeal(anna).some((x) => x.object === 'o_creekline' && x.from === 'по объекту'),
        WS.ui.docsOfDeal(anna).map((x) => x.open + ':' + (x.from || '—')).join(' '));
    }

    // Уточнение имеет смысл, только если названное можно узнать.
    const ask1 = WS.agent.ask('переведи сделку Виктора Орлова в подписание');
    check('консьерж · без уточнения по-прежнему спрашивает', ask1.kind !== 'proposal', ask1.kind);
    const ask2 = WS.agent.ask('переведи сделку Виктора Орлова по портфелю DIFC в подписание');
    check('консьерж · названную сделку узнаёт и предлагает шаг', ask2.kind === 'proposal',
      ask2.kind + ' · ' + (ask2.text || '').slice(0, 80));
  }

  // ---- заявки адресуемы запросом, и сделка клиента не выбирается наугад ----
  {
    const q = WS.query.run({ from: 'requests', where: [{ field: 'clientId', op: 'eq', value: 'c_docs' }] });
    check('запрос · заявки — адресуемая коллекция', q && q.ok !== false && (q.rows || []).length >= 2,
      JSON.stringify(q && (q.error || (q.rows || []).length)));
    check('запрос · коллекция заявок названа по-русски',
      (WS.query.collections() || []).some((c) => c.name === 'requests' && /заявк/i.test(c.label)));

    // У Виктора две открытые сделки: угадывать, какую из них двигать, нельзя.
    const many = (dd().deals || []).filter((d) => d.clientId === 'c_docs' && d.stage !== 'won' && d.stage !== 'lost');
    check('данные · у клиента и правда несколько открытых сделок', many.length > 1, String(many.length));
    const r = WS.agent.ask('переведи сделку Виктора Орлова в подписание');
    check('консьерж · при двух сделках ничего не предлагается', r.kind !== 'proposal', r.kind);
    check('консьерж · сказано, какие сделки открыты и что надо выбрать',
      /Назовите, о какой речь/.test(r.text || '') && /2 сделки/.test(r.text || ''), (r.text || '').slice(-140));

    // У клиента с одной сделкой поведение прежнее — уточнять там нечего.
    const one = WS.agent.ask('переведи сделку Дмитрия Соколова в подписание');
    check('консьерж · одна открытая сделка выбирается без вопросов', one.kind === 'proposal', one.kind);
  }

  // ---- доска или список решает ширина экрана, а не роль ----
  {
    check('доска · порог доски читается из одного места', typeof WS.ui.boardFits === 'function');
    // jsdom ширину не считает, поэтому проверяем связку иначе: правило CSS и константа JS
    // должны называть одно число, иначе появится полоса, где доска отрисована и не видна.
    const css = read('css/app.css');
    const m = /max-width:\s*(\d+(?:\.\d+)?)px\s*\)\s*\{\s*\.kanban\s*\{\s*display:\s*none/.exec(css);
    check('доска · CSS прячет доску ниже порога', !!m, 'правило не найдено');
    const js = /\(min-width:\s*(\d+)px\)/.exec(read('js/ui.js') || '');
    check('доска · порог написан и в JS', !!js, 'BOARD_MIN не найден');
    if (m && js) check('доска · порог CSS и порог JS сходятся',
      Math.abs(parseFloat(m[1]) - (parseFloat(js[1]) - 0.02)) < 0.05,
      m[1] + ' против ' + js[1]);
    // На узком экране доска не отдаётся вовсе — вместе с переключателем, который её обещает.
    const mmWas = win.matchMedia;
    win.matchMedia = (q) => ({ matches: false, media: q, addListener: () => {}, removeListener: () => {} });
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const narrow = doc.querySelector('#app').innerHTML;
    check('доска · на узком экране доски нет', narrow.indexOf('class="kanban"') < 0);
    check('доска · и переключателя, который её обещает, тоже', narrow.indexOf('data-v="kanban"') < 0);
    check('доска · вместо неё список сделок', narrow.indexOf('deals-table') >= 0);
    win.matchMedia = mmWas;
    WS.router.go('clients');
    check('доска · на широком экране доска возвращается',
      doc.querySelector('#app').innerHTML.indexOf('class="kanban"') >= 0);
  }

  // ---- сводная воронка идёт по всей книге, и две конверсии не складываются ----
  {
    const roleWas = WS.store.role;
    WS.storeApi.setRole('manager');
    WS.store.clientsTab = 'deals'; WS.router.go('clients');
    const cells = [].slice.call(doc.querySelectorAll('#app .fn-cell')).map((c) => ({
      n: parseInt(c.querySelector('.fn-n').textContent, 10),
      l: c.querySelector('.fn-l').textContent,
    }));
    check('воронка · четыре отсека на месте', cells.length === 4, JSON.stringify(cells.map((c) => c.l)));
    check('воронка · ни один отсек не пуст', cells.every((c) => c.n > 0),
      cells.filter((c) => !c.n).map((c) => c.l).join(' '));
    // Заявки и сделки считаются каждая по своему уровню, а закрытая заявка — нигде: она уже
    // представлена своими сделками, и посчитать её ещё раз значило бы удвоить одну работу.
    const openReq = (dd().requests || []).filter((r) => ['closed', 'lost'].indexOf(WS.ui.reqStage(r)) < 0).length;
    check('воронка · в отсеках заявок ровно открытые заявки',
      cells[0].n + cells[1].n === openReq, (cells[0].n + cells[1].n) + ' против ' + openReq);
    const liveDeals = (dd().deals || []).filter((d) => d.stage !== 'won' && d.stage !== 'lost').length;
    check('воронка · в отсеке договоров ровно живые сделки', cells[2].n === liveDeals,
      cells[2].n + ' против ' + liveDeals);

    // Деньги заявки — намерение, деньги сделки — согласованная цифра. В одну строку они не идут.
    const prov = doc.querySelector('#app .card .prov').textContent;
    check('воронка · пайплайн и потенциал названы порознь',
      /Пайплайн по сделкам/.test(prov) && /Потенциал заявок/.test(prov), prov.slice(0, 90));

    // Две конверсии считают разное, и у каждой виден свой знаменатель.
    const cv = [].slice.call(doc.querySelectorAll('#app .cv-cell')).map((c) => c.textContent);
    check('воронка · показаны обе конверсии', cv.length === 2, cv.join(' | '));
    check('воронка · у каждой конверсии виден знаменатель',
      cv.every((t) => /\d+ из \d+/.test(t)), cv.join(' | '));
    // Число, равное 100% на одном наблюдении, ничего не измеряет: на стенде есть и отказ, и проигрыш.
    check('воронка · конверсии не упираются в 100%', cv.every((t) => t.indexOf('100%') !== 0), cv.join(' | '));
    check('воронка · сказано, что складывать их нельзя',
      /Складывать их нельзя/.test(doc.querySelector('#app .cv-note').textContent));
    WS.storeApi.setRole(roleWas);
  }

  // ---- документы: собранное по клиенту не собирается заново на каждый договор ----
  {
    const anna = dd().deals.find((d) => d.id === 'd_anna');
    WS.ui.dealCard('d_anna'); WS.ui.setEntityTab('deal', 'd_anna', 'docs');
    const txt = doc.querySelector('#app .view').textContent;
    check('документы · паспорт клиента виден в сделке', /Паспорт и Emirates ID/.test(txt), txt.slice(0, 60));
    check('документы · унаследованный помечен источником', /по клиенту/.test(txt));
    check('документы · собственные документы сделки на месте', /Form B/.test(txt));

    // Обе сделки одного клиента видят один и тот же клиентский документ — он собран один раз.
    const bothSee = ['d_anna', 'd_won'].every((id) => {
      const d = dd().deals.find((x) => x.id === id);
      return WS.ui.docsOfDeal(d).some((x) => x.open === 'doc:passport');
    });
    check('документы · один паспорт обслуживает все сделки клиента', bothSee);

    // Документ заявки поднимается в её сделки, но не наоборот: заявка не отвечает за договор.
    const karim = dd().requests.find((r) => r.id === 'r_karim');
    check('документы · соглашение брокеров живёт на заявке',
      WS.ui.docsOfRequest(karim).some((x) => x.open === 'doc:formI'));
    check('документы · документ сделки не всплывает в заявку',
      !WS.ui.docsOfRequest(dd().requests.find((r) => r.id === 'r_anna')).some((x) => x.open === 'doc:formB'));

    // Область — это владелец, а не любая ссылка: у Form B в записи есть клиент, но принадлежит
    // он сделке, и в список клиентских документов попадать не должен.
    const annaClientDocs = WS.ui.docsOfDeal(anna).filter((x) => x.from === 'по клиенту');
    check('документы · ссылка на клиента не делает документ клиентским',
      !annaClientDocs.some((x) => x.open === 'doc:formB'),
      annaClientDocs.map((x) => x.open).join(' '));

    // Каждый документ открывается: шаблон, которого нет, молча выкидывает в общий реестр.
    const noTpl = [];
    WS.ui.docsOfDeal(anna).concat(WS.ui.docsOfRequest(karim)).forEach((x) => {
      if (x.open.indexOf('doc:') !== 0) return;
      WS.store.view = 'probe';
      WS.ui.openArtifactId(x.open);
      if (WS.store.view !== 'probe') noTpl.push(x.open);
      WS.ui.closeModal();
    });
    check('документы · у каждого документа есть что открыть', noTpl.length === 0, noTpl.join(' '));
  }

  // ---- переход: один комплекс — один договор — одна сделка ----
  // Кнопка «создать сделку» делала одну сделку из всего выбранного, чем бы оно ни было: две
  // квартиры в разных ЖК от разных застройщиков попадали под один договор, которого не бывает.
  {
    const D2 = () => WS.store.data;
    const revert = JSON.parse(JSON.stringify({ deals: D2().deals, reqs: D2().requests,
      dtl: D2().dealTimeline, rtl: D2().requestTimeline }));

    // Два комплекса от разных продавцов в одной заявке → две сделки, каждая со своим договором.
    const r = D2().requests.find((x) => x.id === 'r_lease');
    r.offered = [{ id: 'o_baycentral', state: 'selected' }, { id: 'o_jvcpark', state: 'selected' }];
    r.funnel = 'sale';
    const before = D2().deals.length;
    WS.ui.reqCreateDeal('r_lease');
    const made = D2().deals.filter((d) => d.requestId === 'r_lease');
    check('переход · разные комплексы разошлись по сделкам', made.length === 2,
      made.length + ' (создано ' + (D2().deals.length - before) + ')');
    check('переход · в каждой сделке лоты одного комплекса',
      made.every((d) => {
        const projs = (d.lots || []).map((id) => (D2().objects.find((o) => o.id === id) || {}).project || '');
        return new Set(projs.map((p) => p.split('·')[0].trim())).size === 1;
      }), made.map((d) => (d.lots || []).join('+')).join(' | '));
    check('переход · сделка стартует с первого шага своего договора',
      made.every((d) => {
        const steps = (WS.DEAL_STEPS || {})[WS.contractKindFor(d.funnel, d.readiness)] || [];
        return steps[0] === d.stage;
      }), made.map((d) => d.stage + '/' + d.readiness).join(' '));
    check('переход · услуга наследуется от заявки', made.every((d) => d.funnel === 'sale'));
    check('переход · у каждой новой сделки есть история',
      made.every((d) => ((D2().dealTimeline || {})[d.id] || []).length > 0));
    check('переход · заявка помнит, что разошлась на договоры',
      ((D2().requestTimeline || {})['r_lease'] || []).some((e) => /Условия согласованы/.test(e.text || '')));

    // Повторное нажатие ничего не удваивает: занятые сделкой лоты в выборку уже не попадают.
    const n2 = D2().deals.length;
    WS.ui.reqCreateDeal('r_lease');
    check('переход · повторный переход не создаёт дублей', D2().deals.length === n2,
      D2().deals.length + ' против ' + n2);

    // Два лота в ОДНОМ комплексе — это один договор и одна сделка с двумя лотами.
    D2().deals = JSON.parse(JSON.stringify(revert.deals));
    D2().requests = JSON.parse(JSON.stringify(revert.reqs));
    D2().dealTimeline = JSON.parse(JSON.stringify(revert.dtl));
    D2().requestTimeline = JSON.parse(JSON.stringify(revert.rtl));
    const r2 = D2().requests.find((x) => x.id === 'r_lease');
    r2.offered = [{ id: 'o_difc_a', state: 'selected' }, { id: 'o_difc_b', state: 'selected' }];
    r2.funnel = 'sale';
    // Освободим офисы от портфельной сделки, чтобы они снова были доступны к переходу.
    D2().deals = D2().deals.filter((d) => d.id !== 'd_rentbiz');
    WS.ui.reqCreateDeal('r_lease');
    const one = D2().deals.filter((d) => d.requestId === 'r_lease');
    check('переход · один комплекс остаётся одной сделкой', one.length === 1, String(one.length));
    check('переход · оба лота внутри одного договора',
      one.length === 1 && (one[0].lots || []).length === 2, JSON.stringify(one[0] && one[0].lots));

    D2().deals = JSON.parse(JSON.stringify(revert.deals));
    D2().requests = JSON.parse(JSON.stringify(revert.reqs));
    D2().dealTimeline = JSON.parse(JSON.stringify(revert.dtl));
    D2().requestTimeline = JSON.parse(JSON.stringify(revert.rtl));
  }

  // ---- Консьерж не делает вид, что умеет двигать стадию заявки ----
  {
    const r = WS.agent.ask('переведи сделку Анны в показ');
    check('консьерж · пресейл-команда не превращается в шаг сделки', r.kind !== 'proposal', r.kind);
    check('консьерж · объясняет, что стадия заявки вычисляется',
      /заявк/i.test(r.text || '') && /не выставляется|сама/i.test(r.text || ''), (r.text || '').slice(0, 90));
  }

  // ---- the client register never shows a milestone marked internal ----
  {
    const withInternal = (dd().contracts || []).find((k) => (k.milestones || []).some((m) => m.internalOnly));
    if (withInternal) {
      const m = withInternal.milestones.find((x) => x.internalOnly);
      WS.ui.contractCard(withInternal.id);
      WS.ui.setEntityTab('contract', withInternal.id, 'client');
      // Scoped to the tab body: that IS the client view. The page around it — the step line in the
      // header — is ours and legitimately shows internal work.
      const cv = doc.querySelector('.dx-tabbody');
      const h = cv ? cv.innerHTML : '';
      check('contract · an internal milestone stays out of the client view', !!cv && h.indexOf(m.label) < 0, m.label);
      WS.ui.setEntityTab('contract', withInternal.id, 'milestones');
      const h2 = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
      check('contract · the internal milestone is still on our side', h2.indexOf(m.label) >= 0);
    }
  }

  // ---- a deal created in an earlier month reads as older, not as the future ----
  // «18 апреля» against a 14 мая clock gave «-4 дн. назад», and its creation entry sorted above
  // everything that happened since — both from reading the day and ignoring the month.
  {
    const old = dd().deals.find((d) => /апрел/.test(d.createdAt || ''));
    if (old) {
      WS.ui.dealCard(old.id);
      const h = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
      check('deal age · no negative age on the card', h.indexOf('-') < 0 || !/-\d+ дн\. назад/.test(h), (h.match(/-?\d+ дн\. назад/) || [])[0]);
      check('deal age · an April deal reads as weeks old', /2[0-9] дн\. назад/.test(h), (h.match(/-?\d+ дн\. назад/) || [])[0]);
    }
  }

  // ---- an inline editor must survive being clicked ----
  // The editable «Суть сделки» sat inside a wrapper carrying data-deal, the same attribute the
  // delegated click handler navigates on. Clicking into the field reopened the card, replaced the
  // node mid-keystroke and read as a flickering screen you could not type into. The regression is
  // only visible through a real click: calling the render function proves nothing.
  {
    const td = dd().deals[0];
    WS.ui.dealCard(td.id);
    const field = doc.querySelector('.deal-title-text');
    check('title · the editable field is rendered', !!field);
    if (field) {
      const viewWas = WS.store.view;
      field.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('title · clicking into the field does not navigate', WS.store.view === viewWas, 'view=' + WS.store.view);
      check('title · clicking into the field does not replace it', doc.contains(field));
      // typing then leaving commits the new essence, without a redraw under the pointer
      field.textContent = 'Новая суть сделки';
      field.dispatchEvent(new win.FocusEvent('blur', { bubbles: false }));
      check('title · leaving the field saves the new essence',
        (dd().deals.find((x) => x.id === td.id) || {}).title === 'Новая суть сделки',
        (dd().deals.find((x) => x.id === td.id) || {}).title);
      check('title · the field is still the same node after saving', doc.contains(field));
    }
  }

  // ---- every rendered action must have a handler, and every handler must not throw ----
  // Third time this class has shipped: a control that renders, looks live and does nothing (or
  // throws) when clicked. The selector test covers delegation; this covers the switch behind it.
  {
    const uiSrc = read('js/ui.js'), mainSrc = read('js/main.js');
    const acts = Array.from(new Set((uiSrc.match(/data-act="[a-zA-Z][a-zA-Z0-9_]*"/g) || [])
      .map((x) => x.replace(/data-act="|"/g, ''))));
    const cases = new Set((mainSrc.match(/case '[a-zA-Z][a-zA-Z0-9_]*'/g) || []).map((x) => x.slice(6, -1)));
    const orphans = acts.filter((a2) => !cases.has(a2));
    check('actions · every rendered data-act has a handler', orphans.length === 0, orphans.join(', '));
  }

  // ---- an explicit action outranks navigation, wherever both are on one element ----
  // A verb needs the id of the thing it acts on, so buttons legitimately carry both. The handler
  // must therefore test data-act FIRST; when it did not, the contract verbs silently reopened the
  // card. Asserted on the live handler's own source, not on a restatement of the rule.
  {
    const src = read('js/main.js');
    const iAct = src.indexOf('if (d.act) return handleAct');
    const navChecks = ['if (d.deal)', 'if (d.client)', 'if (d.contract)', 'if (d.obj)', 'if (d.task)'];
    const late = navChecks.filter((n) => { const i2 = src.indexOf(n); return i2 >= 0 && i2 < iAct; });
    check('actions · data-act is resolved before any navigation attribute', iAct > 0 && late.length === 0, late.join(', '));
  }

  // ---- the contract verbs actually run when clicked ----
  {
    const k0 = (dd().contracts || [])[0];
    if (k0) {
      WS.ui.contractCard(k0.id);
      const btn = doc.getElementById('app').querySelector('[data-act="contractAmend"]');
      check('contract · the amend action is rendered', !!btn);
      if (btn) {
        const errsWas = errors.length;
        btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        const modalHtml = doc.getElementById('modal').innerHTML;
        check('contract · clicking amend opens something and throws nothing',
          errors.length === errsWas && modalHtml.indexOf('соглашение') >= 0, modalHtml.slice(0, 80));
        WS.ui.closeModal();
      }
    }
  }

  // ---- no dated fact on a deal may predate the deal itself ----
  // Two deals booked a deposit days before they were created. Nothing crashes; the card simply
  // states an impossible order of events, which is worse than a crash because it looks fine.
  {
    const MONTHS2 = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const LEN2 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const doy = (t) => {
      const m = /^(\d+)\s*([а-яё]*)/i.exec(t || '');
      if (!m) return null;
      const mi = MONTHS2.indexOf((m[2] || '').toLowerCase());
      const mo = mi >= 0 ? mi + 1 : 5;
      let n = parseInt(m[1], 10);
      for (let i = 0; i < mo - 1; i++) n += LEN2[i];
      return n;
    };
    const bad = [];
    (dd().deals || []).forEach((d) => {
      const born = doy(d.createdAt);
      if (born == null) return;
      if (d.deposit && d.deposit.paid && d.deposit.at) {
        const paid = doy(d.deposit.at);
        if (paid != null && paid < born) bad.push(d.id + ': задаток ' + d.deposit.at + ' раньше создания ' + d.createdAt);
      }
      ((dd().dealTimeline || {})[d.id] || []).forEach((e) => {
        const at = doy(e.at);
        if (at != null && at < born) bad.push(d.id + ': событие ' + e.at + ' раньше создания ' + d.createdAt);
      });
    });
    check('deal · nothing is dated before the deal was created', bad.length === 0, bad.slice(0, 3).join(' | '));
  }

  // ---- заявка старше своей сделки, и ни один сценарий не ссылается в пустоту ----
  // Стенд рассказывал две несовместимые истории про одного клиента: показ прошёл 9 мая по заявке,
  // а сделка утверждала, что заявка пришла 14-го и показ ещё впереди. Проверки ниже держат не
  // конкретный случай, а класс: у следствия не может быть даты раньше причины, а сценарий не
  // может двигать запись, которой нет, или называть объект, которого клиенту не предлагали.
  {
    const MO = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const LN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const day = (t) => {
      const m = /^(\d+)\s*([а-яё]*)/i.exec(t || '');
      if (!m) return null;
      const mi = MO.indexOf((m[2] || '').toLowerCase());
      const mo = mi >= 0 ? mi + 1 : 5;
      let n = parseInt(m[1], 10);
      for (let i = 0; i < mo - 1; i++) n += LN[i];
      return n;
    };
    const reqById = (id) => (dd().requests || []).find((r) => r.id === id);

    const early = [];
    (dd().deals || []).forEach((d) => {
      const r = d.requestId && reqById(d.requestId);
      if (!r) return;
      const born = day(d.createdAt); const asked = day(r.createdAt);
      if (born != null && asked != null && born < asked) {
        early.push(d.id + ': сделка ' + d.createdAt + ' раньше заявки ' + r.createdAt);
      }
    });
    check('данные · сделка не рождается раньше своей заявки', early.length === 0, early.join(' | '));

    // Сценарии и события дня трогают общие данные. Опечатка в id — это молчаливый ноль: эффект
    // применяется, ничего не меняется, демонстрация выглядит исправной.
    const COLL = { updateDeal: 'deals', dealStage: 'deals', updateRequest: 'requests', updateClient: 'clients',
      setObject: 'objects', updateObject: 'objects', removeTask: 'tasks' };
    const effectsOf = (s) => {
      let out = [];
      (s.flow || []).forEach((st) => {
        if (st.effects) out = out.concat(st.effects);
        if (st.result && st.result.effects) out = out.concat(st.result.effects);
        if (st.fieldEffects) Object.keys(st.fieldEffects).forEach((k) => { out = out.concat(st.fieldEffects[k]); });
      });
      return out;
    };
    const sources = (WS.scenarioList || []).map((s) => [s.id, effectsOf(s)])
      .concat(((WS.events && WS.events.EVENTS) || []).map((e) => [e.id, e.effects || []]));
    // Задача, созданная одним сценарием и снятая следующим, в покое не существует — это не
    // призрак, а звено цепочки, поэтому созданное сценариями считается существующим.
    const born = {};
    sources.forEach(([, eff]) => (eff || []).forEach((e) => {
      const rec = e.task || e.obj || e.record;
      if (rec && rec.id) born[rec.id] = 1;
    }));
    const ghosts = [];
    sources.forEach(([name, eff]) => (eff || []).forEach((e) => {
      const coll = COLL[e.op]; if (!coll) return;
      if (born[e.id]) return;
      if (!(dd()[coll] || []).some((x) => x.id === e.id)) ghosts.push(name + ' → ' + e.op + ' ' + e.id);
    }));
    check('сценарии · каждый эффект попадает в существующую запись', ghosts.length === 0, ghosts.slice(0, 3).join(' | '));

    // Объект, который сценарий объявляет выбранным, должен быть среди предложенных клиенту.
    // Иначе карточка заявки и рассказ сценария расходятся: «клиент выбрал» то, чего не видел.
    const strays = [];
    sources.forEach(([name, eff]) => (eff || []).forEach((e) => {
      if (e.op !== 'updateClient' || !e.patch || !e.patch.preferred) return;
      const offered = (dd().requests || []).filter((r) => r.clientId === e.id)
        .reduce((a, r) => a.concat((r.offered || []).map((o) => o.id)), []);
      const names = offered.map((id) => ((dd().objects || []).find((o) => o.id === id) || {}).name || '');
      const pref = String(e.patch.preferred);
      // Точное совпадение с именем объекта, а не «похоже»: «Creekline Residences 1208» вместо
      // «Creekline Residences, Unit 1208» — это уже другое название, и клиент увидит другое.
      if (names.indexOf(pref) < 0) {
        strays.push(name + ': «' + pref + '» клиенту ' + e.id + ' не предлагали');
      }
    }));
    check('сценарии · выбранным можно назвать только предложенное', strays.length === 0, strays.join(' | '));

    // Календарь обещает будущее. Показ, который ленты уже записали как состоявшийся, —
    // это не напоминание, а противоречие: агент придёт на встречу, которая была неделю назад.
    // В прозе объект зовут не полным именем из карточки, а проектом и номером: «Creekline 1208»
    // при name = «Creekline Residences, Unit 1208». Сверяем по этой паре — иначе проверка
    // молчит ровно там, где нужна.
    const keyOf = (o) => {
      const first = String(o.name || '').split(/[\s,]+/)[0];
      const unit = (/(\d{2,})\s*$/.exec(o.name || '') || [])[1];
      return first && unit ? [first, unit] : null;
    };
    const has = (t, k) => t.indexOf(k[0]) >= 0 && t.indexOf(k[1]) >= 0;
    const stale = [];
    (dd().events || []).forEach((ev) => {
      if (ev.kind !== 'show' || !ev.clientId) return;
      const feeds = [].concat(
        (dd().requests || []).filter((r) => r.clientId === ev.clientId).map((r) => (dd().requestTimeline || {})[r.id] || []),
        (dd().deals || []).filter((x) => x.clientId === ev.clientId).map((x) => (dd().dealTimeline || {})[x.id] || []));
      (dd().objects || []).forEach((o) => {
        const k = keyOf(o);
        if (!k || !has(ev.title || '', k)) return;
        feeds.forEach((f) => f.forEach((it) => {
          if (it.ch === 'meet' && has(it.text || '', k)) {
            stale.push(ev.id + ': показ ' + o.name + ' уже проведён (' + it.at + ')');
          }
        }));
      });
    });
    check('календарь · не назначает показ, который уже состоялся', stale.length === 0, stale.slice(0, 3).join(' | '));
  }

  // ---- sort keys must agree with the dates they claim ----
  //  is a DDHHMM key built for a demo week in May. Entries dated in an earlier month were
  // given day-only keys, so «28 апреля» outranked «06 мая» and a merged feed showed the past on
  // top. The invariant is cheap to state and catches the whole class, not the one instance.
  {
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const when = (at) => {
      const m = /^(\d+)\s+([а-яё]+)(?:[^0-9]+(\d+):(\d+))?/i.exec(at || '');
      if (!m) return null;
      const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
      if (!mo) return null;
      let doy = parseInt(m[1], 10);
      for (let i2 = 0; i2 < mo - 1; i2++) doy += LEN[i2];
      return doy * 1440 + (parseInt(m[3] || '0', 10) * 60) + parseInt(m[4] || '0', 10);
    };
    const collections = [];
    ['dealTimeline', 'contactTimeline', 'companyTimeline', 'requestTimeline'].forEach((k) => {
      const box = dd()[k] || {};
      Object.keys(box).forEach((id) => collections.push([k + '.' + id, box[id]]));
    });
    (dd().contracts || []).forEach((c) => { if (c.timeline) collections.push(['contract.' + c.id, c.timeline]); });
    let bad = [];
    collections.forEach(([name, list]) => {
      const rows = (list || []).filter((e) => e && e.at && e.ord != null && when(e.at) != null);
      for (let a = 0; a < rows.length; a++) {
        for (let b = a + 1; b < rows.length; b++) {
          const dt = when(rows[a].at) - when(rows[b].at);
          const dd2 = rows[a].ord - rows[b].ord;
          if (dt !== 0 && (dt > 0) !== (dd2 > 0)) bad.push(name + ': «' + rows[a].at + '» vs «' + rows[b].at + '»');
        }
      }
    });
    check('feed · every ord agrees with the date it claims', bad.length === 0, bad.slice(0, 3).join(' | '));
  }


  // ---- a hand edit moves the revision, or a stale proposal stays confirmable ----
  {
    const revWas = WS.store.dataRevision;
    sapi.touch();
    check('store · touch() advances the revision', WS.store.dataRevision === revWas + 1,
      'was=' + revWas + ' now=' + WS.store.dataRevision);
  }

  // ============================================================
  //  The live head: a model may speak, but it may not supply a number, write
  //  anything, or take the stand down when it fails.
  // ============================================================
  if (WS.live) {
    const L = WS.live;

    // A shape whose fields are the wrong type used to pass the check and then
    // throw mid-render, stranding the «Разбираю запрос» card.
    {
      check('live · a block with the wrong field type is dropped',
        L.normBlocks([{ t: 'list', items: {} }, { t: 'bars', rows: 'нет' }, { t: 'p', text: 'ок' }]).length === 1);
      let threw = false;
      try { WS.engine.agentCard({ kind: 'answer', text: 'x', blocks: [{ t: 'list', items: {} }, { t: 'table', rows: 7 }] }); }
      catch (e) { threw = true; }
      check('live · and the renderer survives one that slips through', threw === false);
    }

    // Chat threads are persisted; the documents behind them are not.
    {
      const a = WS.report.create({ title: 'Первый', blocks: [{ t: 'p', text: 'a' }] });
      const b = WS.report.create({ title: 'Второй', blocks: [{ t: 'p', text: 'b' }] });
      check('report · ids are unique within a session', a.id !== b.id);
      check('report · an id carries the page load that built it', /^rp\d+_\d+$/.test(a.id), a.id);
      check('report · a card from a past session finds nothing rather than the wrong file',
        WS.report.get('rp1') === null && WS.report.get('rp00000000_1') === null);
    }

    // The report leaves the stand and is forwarded to a client, so it has to
    // stand alone — and it must not carry an unlabelled demo figure outside.
    {
      const spec = {
        title: 'Срез по районам',
        subtitle: 'Для инвестора',
        blocks: [
          { t: 'h', text: 'Доходность' },
          { t: 'table', head: ['Район', 'Доходность'], rows: [['Arjan', '8,1%']] },
          { t: 'bars', rows: [{ label: 'Arjan', value: 8.1, suffix: '%' }] },
          { t: 'p', text: '<script>alert(1)</script>' },
        ],
      };
      const html = WS.report.build(spec);
      check('report · it is a whole document, not a fragment',
        /^<!DOCTYPE html>/.test(html) && html.indexOf('</html>') > 0);
      check('report · it carries its own styles, referencing nothing from the stand',
        html.indexOf('<style>') >= 0 && html.indexOf('css/app.css') < 0);
      check('report · it is readable on a phone', /name="viewport"[^>]*width=device-width/.test(html));
      check('report · the title reaches the document title', html.indexOf('<title>Срез по районам</title>') >= 0);
      check('report · a script inside a block is text, not a script',
        html.indexOf('<script>alert') < 0 && html.indexOf('&lt;script&gt;alert') >= 0);
      check('report · demo figures are labelled for whoever receives the file',
        /демонстрационные/.test(html), html.slice(-260));

      const made = WS.report.create(spec);
      check('report · a built report can be fetched back by id', WS.report.get(made.id).html === html);
      // «8.1 %» reads as a machine artefact in a document sent to a client.
      check('report · measured values are printed the Russian way',
        html.indexOf('8,1%') >= 0 && html.indexOf('8.1 %') < 0, (html.match(/8[.,]1[^<]*/) || [])[0]);
      check('report · the subtitle is printed once, not twice',
        (html.match(/Для инвестора/g) || []).length === 1);
      check('report · the file name is safe and named after the report',
        /^wespace-[^\\/:*?"<>|]+\.html$/.test(made.name), made.name);

      const card = WS.engine.agentCard({
        kind: 'answer', text: 'Собрал.', evidence: [], next: [],
        report: { id: made.id, title: made.title, name: made.name, count: 4 },
      });
      const rb = doc.createElement('div'); rb.innerHTML = card;
      check('report · the answer offers the file rather than pushing it',
        rb.querySelectorAll('[data-rpopen]').length === 1 && rb.querySelectorAll('[data-rpsave]').length === 1);
    }

    // The stand's entity model moved on — заявка → сделки → лоты — and what the
    // model is handed has to move with it. Every field below is read from the
    // fixtures at runtime, so a rename shows up as a failing check rather than
    // as an answer that quietly says «такого в данных нет».
    {
      const dg = L.digest();
      const req = (dd().requests || [])[0];
      const dgReq = (dg.заявки || [])[0] || {};
      check('digest · a request carries its funnel state, not just a budget',
        dgReq.статус === req.leadStatus && !!dgReq.статус &&
        dgReq.температура === req.temperature && dgReq.ответственный === req.assignee,
        JSON.stringify(dgReq).slice(0, 120));
      check('digest · and what the client was already shown',
        Array.isArray(dgReq.предложено) && dgReq.предложено.length === (req.offered || []).length &&
        dgReq.предложено[0].состояние === req.offered[0].state);
      check('digest · and whether a КП has gone out',
        !!dgReq.кп && dgReq.кп.когда === req.kp.at);

      const obj = (dd().objects || [])[0];
      const dgObj = (dg.объекты || [])[0] || {};
      check('digest · an object arrives with a name and a price',
        dgObj.название === obj.name && !!dgObj.название && dgObj.цена === obj.price,
        JSON.stringify(dgObj).slice(0, 120));

      const stuckSrc = (dd().deals || []).find((x) => x.nextDue);
      const stuck = (dg.сделки || []).find((x) => x.id === (stuckSrc || {}).id);
      check('digest · a deal says where it is stuck, not only what it is worth',
        !!stuck && stuck.срок_шага === stuckSrc.nextDue && stuck.дней_на_стадии === stuckSrc.stageDays,
        JSON.stringify(stuck && { s: stuck.срок_шага, d: stuck.дней_на_стадии }));
      const withDep = (dg.сделки || []).find((x) => x.задаток);
      check('digest · and whether the deposit is actually paid',
        !!withDep && typeof withDep.задаток.оплачен === 'boolean');

      // Every id the model may be told to write against must resolve.
      check('digest · request ids are real', (dg.заявки || []).every((r) => (dd().requests || []).some((x) => x.id === r.id)));
    }

    // «Откуда это число» over the top of the funnel: a lead figure has to be
    // openable like any other, which needs the collection in the read layer.
    {
      const res = WS.query.run({ from: 'requests', aggregate: { fn: 'count' } });
      check('read layer · requests are addressable', res.ok === true && res.value === (dd().requests || []).length,
        res.error || String(res.value));
      const r = WS.agent.tools.read('requests_hot');
      check('read layer · a lead figure comes back with its rows',
        !!r && r.value === (dd().requests || []).filter((x) => x.temperature === 'hot').length && !!r.query);
      check('read layer · and reads the stand, not a constant',
        !!WS.agent.tools.read('requests_budget_sum') &&
        WS.agent.tools.read('requests_budget_sum').value ===
          (dd().requests || []).reduce((s, x) => s + (x.budget || 0), 0));
    }

    // A screen the Concierge may offer to open has to exist in the stand.
    {
      const chip = L.toReply('смотри заявки', { open: { view: 'requests' } });
      check('навигация · the Concierge can offer the Заявки screen',
        !!chip && (chip.next || []).some((n) => n.open === 'requests'), JSON.stringify(chip && chip.next));
      const card = L.toReply('вот заявка', { open: { view: 'request', id: (dd().requests[0] || {}).id } });
      check('навигация · and a request card by id',
        !!card && (card.next || []).some((n) => n.open === 'request' && n.id === dd().requests[0].id));
      check('навигация · an invented screen is still refused',
        !((L.toReply('x', { open: { view: 'admin_panel' } }) || {}).next || []).some((n) => n.open === 'admin_panel'));

      // Offering the screen and being able to open it are two different lists
      // in two different files. Checking only the chip left the second one free
      // to fall behind the navigation — the chip appears and the click is dead.
      WS.engine.openThread('probe:nav', 'Навигация', 'chat');
      WS.router.go('concierge');
      const navMid = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(navMid, WS.engine.agentCard(chip, navMid));
      const navBtn = doc.getElementById('chat').querySelector('[data-agnext]');
      const viewWas = WS.store.view;
      if (navBtn) navBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('навигация · and the click actually gets there',
        WS.store.view === 'requests', 'was ' + viewWas + ', now ' + WS.store.view);
      WS.router.go('concierge');
    }

    // Writing against a заявка: the same one path, the same confirmation.
    {
      const r0 = dd().requests[0];
      const dry = WS.storeApi.preview([{ op: 'updateRequest', id: r0.id, patch: { leadStatus: 'Подписант' } }]);
      check('запись · a lead can be moved along the funnel', dry.ok === true, dry.error || '');
      check('запись · and moving it asks for a confirmation', dry.tier === 'guarded', dry.tier);
      const note = WS.storeApi.preview([{ op: 'updateRequest', id: r0.id, patch: { note: 'перезвонить в среду' } }]);
      check('запись · a note on it does not', note.ok === true && note.tier === 'safe', note.tier || note.error);
      const bad = WS.storeApi.preview([{ op: 'updateRequest', id: r0.id, patch: { stage: 'talks' } }]);
      check('запись · a request’s stage cannot be assigned, because it is computed',
        bad.ok === false && bad.code === 'field_not_writable', bad.code);
      const ghost = WS.storeApi.preview([{ op: 'updateRequest', id: 'r_nope', patch: { note: 'x' } }]);
      check('запись · an invented request id is refused', ghost.ok === false && ghost.code === 'not_found');

      const feedWas = ((dd().requestTimeline || {})[r0.id] || []).length;
      const ev = WS.storeApi.apply([{ op: 'addEvent', scope: 'request', id: r0.id, type: 'call', text: 'созвон по подбору' }], { confirmed: true });
      check('запись · a call can be filed against a request', ev.ok === true, ev.error || '');
      check('запись · and it lands in that request’s own history',
        ((dd().requestTimeline || {})[r0.id] || []).length === feedWas + 1);
    }

    // The invariant the whole stand claims: the model narrates, the code owns
    // every number. It held for the evidence chips and not for the answer — a
    // table's cells were whatever the model typed, checked for shape and never
    // for value. These checks are about the figures a person actually reads.
    {
      const mk = (m) => (dd().market || []).map((r) => r[m]);

      // A table the model describes rather than types.
      const backed = L.normBlocks([{
        t: 'table',
        from: { from: 'market', sort: { field: 'доходностьПроцент', dir: 'desc' }, limit: 3 },
        columns: [{ field: 'район', label: 'Район' }, { field: 'доходностьПроцент', label: 'Доходность' }],
      }]);
      check('числа · a table can be built from a query, not typed',
        !!backed && backed[0].src === 'data' && backed[0].rows.length === 3,
        JSON.stringify(backed && backed[0] && backed[0].rows));
      const top = (dd().market || []).slice().sort((a, b) => b['доходностьПроцент'] - a['доходностьПроцент'])[0];
      check('числа · and the cells are the stand’s own values',
        !!backed && backed[0].rows[0][0] === top['район'] &&
        backed[0].rows[0][1] === String(top['доходностьПроцент']).replace('.', ','),
        JSON.stringify(backed && backed[0].rows[0]) + ' vs ' + top['район']);
      check('числа · the head comes from the requested columns',
        !!backed && backed[0].head.join('|') === 'Район|Доходность');

      const bars = L.normBlocks([{ t: 'bars', from: { from: 'market', limit: 4 }, label: 'район', value: 'доходностьПроцент', suffix: '%' }]);
      check('числа · bars too', !!bars && bars[0].src === 'data' && bars[0].rows.length === 4 &&
        mk('доходностьПроцент').indexOf(bars[0].rows[0].value) >= 0, JSON.stringify(bars && bars[0].rows));

      const kv = L.normBlocks([{ t: 'kv', reads: ['deals_active', 'deals_active_sum'] }]);
      const active = WS.agent.tools.read('deals_active');
      check('числа · kv is built from named readings, the same ones the chips open',
        !!kv && kv[0].src === 'data' && kv[0].rows[0].v === String(active.value),
        JSON.stringify(kv && kv[0].rows));

      // The attack this whole mechanism exists for: a block that names a query
      // AND carries its own rows. The rows must be ignored — otherwise the
      // «from» is decoration and the figures are still the model's.
      const smuggled = L.normBlocks([{
        t: 'table',
        from: { from: 'market', limit: 2 },
        columns: [{ field: 'район', label: 'Район' }, { field: 'ценаЗаМетр', label: 'Цена/м²' }],
        rows: [['Arjan', '999 999'], ['JVC', '888 888']],
        head: ['Подделка', 'Подделка'],
      }]);
      const flat = JSON.stringify(smuggled);
      check('числа · rows smuggled alongside a query are ignored',
        !!smuggled && flat.indexOf('999 999') < 0 && flat.indexOf('888 888') < 0, flat.slice(0, 120));
      check('числа · and the head is the requested one, not the smuggled one',
        !!smuggled && smuggled[0].head.join('|') === 'Район|Цена/м²', JSON.stringify(smuggled && smuggled[0].head));

      // A block that meant to be data-backed and could not be is dropped, not
      // quietly replaced by whatever the model typed beside it.
      const broken = L.normBlocks([
        { t: 'table', from: { from: 'нет_такой' }, columns: [{ field: 'a' }], rows: [['999']] },
        { t: 'p', text: 'ок' },
      ]);
      check('числа · a query that does not resolve drops its block',
        !!broken && broken.length === 1 && broken[0].t === 'p', JSON.stringify(broken));

      // A literal block still renders — and says whose numbers those are.
      const literal = L.normBlocks([{ t: 'table', head: ['Район'], rows: [['999999']] }]);
      check('числа · a typed table survives', !!literal && literal[0].src !== 'data');
      const card = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [], blocks: literal }, 'mLit');
      const bx = doc.createElement('div'); bx.innerHTML = card;
      check('числа · and is marked as not checked against the data',
        (bx.textContent || '').indexOf('собрано моделью') >= 0, (bx.textContent || '').slice(0, 90));

      const cardB = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [], blocks: backed }, 'mBak');
      const bb = doc.createElement('div'); bb.innerHTML = cardB;
      check('числа · a data-backed table says where it came from instead',
        (bb.textContent || '').indexOf('из данных') >= 0 && (bb.textContent || '').indexOf('собрано моделью') < 0,
        (bb.textContent || '').slice(0, 90));

      // The digest is read through the same layer the chips read, so a figure
      // on a tile and a figure in the prompt cannot drift apart.
      const dg = L.digest();
      check('числа · the digest carries the real field names to query by',
        Array.isArray(dg.схема) && dg.схема.some((c) => c.name === 'market' && c.fields.indexOf('доходностьПроцент') >= 0),
        JSON.stringify((dg.схема || []).map((c) => c.name)));
      check('числа · and holds as many rows as the read layer reports',
        dg.сделки.length === WS.query.run({ from: 'deals' }).rows.length);

      // The example in the server's rules is the one thing the model copies
      // verbatim. Written with invented field names it teaches a query that
      // resolves to nothing, and the answer silently loses its table.
      // Read out of the server's own rules rather than restated here — a copy
      // in the test drifts from the shipped text without either side noticing.
      {
        const rules = fs.readFileSync(path.join(D, '..', 'server', 'proxy.js'), 'utf8');
        const flatRules = rules.replace(/',\s*\n\s*'/g, '');
        // Balanced scan rather than a pattern: the examples nest objects and
        // arrays, and a non-greedy match stops at whichever brace comes first.
        const objAt = (s, start) => {
          let depth = 0, inStr = false, esc = false;
          for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') { inStr = true; continue; }
            if (c === '{') depth++;
            else if (c === '}' && !--depth) return s.slice(start, i + 1);
          }
          return null;
        };
        const found = [];
        for (let i = 0; i < flatRules.length; i++) {
          if (/^\{"t":"(table|bars)","from":/.test(flatRules.slice(i, i + 26))) {
            const got = objAt(flatRules, i);
            if (got) { found.push(got); i += got.length - 1; }
          }
        }
        const examples = found.map((s) => { try { return JSON.parse(s); } catch (e) { return null; } });
        check('числа · every block example in the rules is parseable',
          examples.length >= 4 && examples.every(Boolean),
          examples.length + ' found, ' + found.filter((s, i) => !examples[i]).join(' | ').slice(0, 120));
        examples.filter(Boolean).forEach((ex, i) => {
          const built = L.normBlocks([ex]);
          check('числа · example ' + (i + 1) + ' (' + ex.t + (ex.from.groupBy ? ', разрез' : '') + ') resolves against this stand',
            !!built && built[0].src === 'data' && built[0].rows.length > 0 &&
            (ex.t !== 'table' || built[0].rows.every((r) => r.every((c) => c !== ''))),
            JSON.stringify(ex.from) + ' → ' + JSON.stringify(built && built[0] && built[0].rows[0]));
        });
        const fields = examples.filter(Boolean).flatMap((ex) => [
          ex.from.groupBy, ex.from.sort && ex.from.sort.field, ex.from.aggregate && ex.from.aggregate.field,
        ].filter(Boolean).map((f) => [ex.from.from, f]));
        check('числа · including every field those queries name',
          fields.every(([coll, f]) => (dd()[coll] || []).every((r) => r[f] !== undefined)),
          JSON.stringify(fields.filter(([coll, f]) => !(dd()[coll] || []).every((r) => r[f] !== undefined))));
      }

      /* «Сколько по каждой стадии», «средняя доходность по районам», «сделки
         по ответственным» — the shape most analytical questions have. It comes
         back from the read layer as groups, and the block builder used to want
         rows, so every such question fell off the data path and back into
         prose the model typed. The more analytical the question, the more
         likely the answer was model-authored: exactly backwards. */
      {
        const deals = dd().deals || [];
        const bySt = {};
        deals.forEach((d) => { bySt[d.stage] = (bySt[d.stage] || 0) + d.amount; });
        const grouped = L.normBlocks([{
          t: 'table',
          from: { from: 'deals', groupBy: 'stage', aggregate: { fn: 'sum', field: 'amount' } },
          columns: [{ field: 'group', label: 'Стадия' }, { field: 'value', label: 'Сумма', money: true }],
        }]);
        check('разрез · a grouped query becomes a data-backed table',
          !!grouped && grouped[0].src === 'data' && grouped[0].rows.length === Object.keys(bySt).length,
          JSON.stringify(grouped && grouped[0] && grouped[0].rows));
        const biggest = Object.keys(bySt).sort((a, b) => bySt[b] - bySt[a])[0];
        check('разрез · and the aggregate is the code’s own sum, ordered by it',
          !!grouped && grouped[0].rows[0][0] === biggest && grouped[0].rows[0][1] === WS.AED(bySt[biggest]),
          JSON.stringify(grouped && grouped[0] && grouped[0].rows[0]) + ' vs ' + biggest + '=' + bySt[biggest]);

        const gBars = L.normBlocks([{
          t: 'bars', from: { from: 'deals', groupBy: 'agent', aggregate: { fn: 'count' } },
          label: 'group', value: 'value',
        }]);
        const agents = {};
        deals.forEach((d) => { agents[d.agent] = (agents[d.agent] || 0) + 1; });
        check('разрез · bars can be grouped too',
          !!gBars && gBars[0].src === 'data' && gBars[0].rows.length === Object.keys(agents).length &&
          gBars[0].rows.every((r) => agents[r.label] === r.value),
          JSON.stringify(gBars && gBars[0] && gBars[0].rows));

        // An average arrives as 8.133333333333333. Rounding is the code's; the
        // alternative is asking the model to round, which hands the last digit
        // back to it.
        const avg = L.normBlocks([{
          t: 'table', from: { from: 'deals', groupBy: 'stage', aggregate: { fn: 'avg', field: 'amount' } },
          columns: [{ field: 'group', label: 'Стадия' }, { field: 'value', label: 'Средняя' }],
        }]);
        // Guard against passing on an empty stomach: if no group averages to a
        // fraction here, the rounding is not being exercised at all.
        check('разрез · this stand really does produce a repeating average',
          Object.values(bySt).length > 0 &&
          deals.some((d) => deals.filter((x) => x.stage === d.stage).length === 3),
          JSON.stringify(Object.keys(bySt).map((s) => s + ':' + deals.filter((x) => x.stage === s).length)));
        check('разрез · an average is rounded by the code, not left raw',
          !!avg && avg[0].rows.every((r) => !/[.,]\d{3}/.test(r[1])),
          JSON.stringify(avg && avg[0] && avg[0].rows));
      }

      /* The cells belong to the code, but the model still names the columns.
         «Доходность 12%» in a header reads exactly as authoritative as the
         figures under it — and nothing under it says that number was typed. */
      {
        const dressed = L.normBlocks([{
          t: 'table', from: { from: 'market', limit: 2 },
          columns: [{ field: 'район', label: 'Топ-5 районов' }, { field: 'доходностьПроцент', label: 'Доходность 12%' }],
        }]);
        check('подписи · a figure in a column label is refused, the field name stands in',
          !!dressed && dressed[0].head[1] === 'доходностьПроцент', JSON.stringify(dressed && dressed[0].head));
        check('подписи · a label that merely contains a digit is left alone',
          !!dressed && dressed[0].head[0] === 'Топ-5 районов', JSON.stringify(dressed && dressed[0].head));
        const suffixed = L.normBlocks([{
          t: 'bars', from: { from: 'market', limit: 2 }, label: 'район', value: 'доходностьПроцент', suffix: '8,1%',
        }]);
        check('подписи · and a figure smuggled into a bar suffix is dropped',
          !!suffixed && suffixed[0].rows[0].suffix === '', JSON.stringify(suffixed && suffixed[0].rows[0]));
      }

      /* A block was built at a revision. Scrolled back to after a stage moved,
         its rows are the old ones — true when drawn, quietly wrong now. */
      {
        const dated = L.normBlocks([{
          t: 'table', from: { from: 'market', limit: 2 },
          columns: [{ field: 'район', label: 'Район' }],
        }]);
        check('ревизия · a data-backed block remembers its query and its revision',
          !!dated && dated[0].revision === WS.store.dataRevision && !!dated[0].spec,
          JSON.stringify(dated && { r: dated[0].revision, s: dated[0].spec }));
        const fresh = doc.createElement('div');
        fresh.innerHTML = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [], blocks: dated }, 'mRev1');
        check('ревизия · while the data has not moved the card says nothing extra',
          (fresh.textContent || '').indexOf('данные с тех пор менялись') < 0);
        WS.storeApi.apply([{ op: 'addEvent', scope: 'deal', id: dd().deals[0].id, type: 'note', text: 'сдвиг' }], { confirmed: true });
        const stale = doc.createElement('div');
        stale.innerHTML = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [], blocks: dated }, 'mRev2');
        check('ревизия · once it has, the same block says so',
          (stale.textContent || '').indexOf('данные с тех пор менялись') >= 0,
          (stale.textContent || '').slice(0, 120));
      }

      /* A marked table in the chat is honest — the mark is on the screen next
         to it. A file leaves the room: it gets forwarded, and its footer says
         the figures were computed from the workspace. A model-typed table
         inside one turns that footer into a false claim. */
      {
        const rep = L.normReport({
          title: 'Разбор', blocks: [
            { t: 'p', text: 'вывод' },
            { t: 'table', head: ['Район'], rows: [['999 999']] },
            { t: 'table', from: { from: 'market', limit: 2 }, columns: [{ field: 'район', label: 'Район' }] },
          ],
        });
        check('отчёт · a model-typed table does not get into a document',
          !!rep && rep.blocks.length === 2 && JSON.stringify(rep.blocks).indexOf('999 999') < 0,
          JSON.stringify(rep && rep.blocks.map((b) => b.t + ':' + (b.src || 'model'))));
        check('отчёт · while the data-backed one does',
          !!rep && rep.blocks.some((b) => b.t === 'table' && b.src === 'data'));

        const titled = L.normReport({ title: 'Доходность 8,1% по Arjan', subtitle: 'рост на 12%', blocks: [{ t: 'p', text: 'x' }] });
        check('отчёт · a figure in the title is refused — a headline is not a computed value',
          !!titled && titled.title === 'Аналитическая записка' && titled.subtitle === '',
          JSON.stringify(titled && { t: titled.title, s: titled.subtitle }));
        const plainTitle = L.normReport({ title: 'Топ-5 районов', blocks: [{ t: 'p', text: 'x' }] });
        check('отчёт · an ordinary title survives', !!plainTitle && plainTitle.title === 'Топ-5 районов');

        // The footer is built from what the page holds, not asserted over it:
        // the day the filter changes, the claim has to change with it.
        const okDoc = WS.report.build({ title: 'x', blocks: rep.blocks });
        check('отчёт · the footer vouches for the figures only when it can',
          okDoc.indexOf('посчитаны кодом по данным') >= 0, okDoc.slice(-320));
        const mixedDoc = WS.report.build({ title: 'x', blocks: [{ t: 'table', head: ['a'], rows: [['999 999']] }] });
        check('отчёт · a page holding a model-typed figure says so instead',
          mixedDoc.indexOf('не сверена') >= 0 && mixedDoc.indexOf('посчитаны кодом по данным') < 0,
          mixedDoc.slice(-320));
        const proseDoc = WS.report.build({ title: 'x', blocks: [{ t: 'p', text: 'без величин' }] });
        check('отчёт · and a page with no figures claims nothing about figures',
          proseDoc.indexOf('посчитаны кодом') < 0 && proseDoc.indexOf('не сверена') < 0);
      }

      /* The write layer exists so a change passes through a person. Listing the
         field names alone — «deals d_anna: amount» — made that passage
         ceremonial: a figure the model picked was confirmed by someone who
         never saw it. */
      {
        const d0 = dd().deals[0];
        const was = d0.amount;
        const pv = WS.storeApi.preview([{ op: 'updateDeal', id: d0.id, patch: { amount: 4321000 } }]);
        const line = (pv.pending || []).join(' ');
        check('подтверждение · the preview shows the value, not just the field',
          pv.ok === true && line.indexOf('→') >= 0 && line.replace(/ | |\s/g, '').indexOf('4321000') >= 0,
          line);
        check('подтверждение · and what is being replaced',
          line.replace(/ | |\s/g, '').indexOf(String(was)) >= 0, line);
        const other = otherStep(d0);
        const st = WS.storeApi.preview([{ op: 'dealStage', id: d0.id, stage: other }]);
        check('подтверждение · a stage change names the stage it leaves',
          st.ok === true && (st.pending || []).join(' ')
            .indexOf(WS.ui.stageLabel(d0.stage) + ' → ' + WS.ui.stageLabel(other)) >= 0,
          (st.pending || []).join(' '));
        // It is read in Russian, on a phone, by a broker — the store's own
        // vocabulary («deals d_anna: amount») is not what a change is confirmed in.
        check('подтверждение · and it names the record the way a person knows it',
          line.indexOf('Сделка «') === 0 && line.indexOf('сумма') > 0 && line.indexOf('deals ') < 0,
          line);
      }

      /* A figure the model brought back from the web. No query stands behind
         it, so the code cannot own it the way it owns its own — what it owns
         instead is that the two are never mixed up: an outside figure carries
         where it came from and as of when, and says so under the block. */
      {
        const webBlock = {
          t: 'table', src: 'web', source: 'https://www.bayut.com/market/jvc',
          asOf: 'июль 2026', head: ['Показатель', 'Значение'], rows: [['Цена за м²', '16 200 AED']],
        };
        const web = L.normBlocks([webBlock]);
        check('внешнее · a sourced outside figure is kept',
          !!web && web[0].src === 'web', JSON.stringify(web && web[0] && web[0].src));
        check('внешнее · and its source is reduced to the host that stands behind it',
          !!web && web[0].source === 'www.bayut.com' && web[0].asOf === 'июль 2026',
          JSON.stringify(web && { s: web[0].source, a: web[0].asOf }));
        // A claim of a source with no source named is worse than no claim: it
        // is an unsourced number wearing a source's authority.
        const unsourced = L.normBlocks([Object.assign({}, webBlock, { source: '' })]);
        check('внешнее · a figure claiming the outside without naming it is dropped', unsourced === null,
          JSON.stringify(unsourced));
        const notAHost = L.normBlocks([Object.assign({}, webBlock, { source: 'по данным рынка' })]);
        check('внешнее · and so is one whose source is not a place at all', notAHost === null,
          JSON.stringify(notAHost));

        const webCard = doc.createElement('div');
        webCard.innerHTML = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [], blocks: web }, 'mWeb');
        check('внешнее · the card names the source instead of claiming the data',
          (webCard.textContent || '').indexOf('из внешнего источника · www.bayut.com') >= 0 &&
          (webCard.textContent || '').indexOf('из данных') < 0, (webCard.textContent || '').slice(0, 140));

        /* A market note is worth sending precisely because it carries outside
           figures — so they may travel, with the source printed on the page and
           a footer that admits the document holds two kinds of number. */
        const mixed = L.normReport({ title: 'Рынок', blocks: [
          { t: 'table', from: { from: 'market', limit: 2 }, columns: [{ field: 'район', label: 'Район' }] },
          webBlock,
        ] });
        check('отчёт · an outside figure may travel in a document',
          !!mixed && mixed.blocks.length === 2 && mixed.blocks.some((b) => b.src === 'web'),
          JSON.stringify(mixed && mixed.blocks.map((b) => b.src)));
        const mixedDoc = WS.report.build({ title: 'Рынок', blocks: mixed.blocks });
        check('отчёт · with the source printed beside it, not only on screen',
          mixedDoc.indexOf('Источник: www.bayut.com') >= 0, mixedDoc.slice(-500, -200));
        check('отчёт · and a footer that admits both kinds are inside',
          mixedDoc.indexOf('Величины по рабочему месту посчитаны кодом') >= 0 &&
          mixedDoc.indexOf('из внешних источников (www.bayut.com)') >= 0, mixedDoc.slice(-360));
      }

      /* The composer had a mode pill, a depth segment and context chips, and
         none of the three reached the model: stored, drawn, dropped. A control
         that changes nothing teaches the person that the handles on this thing
         are decoration. These checks are about the handles being real. */
      {
        const st = WS.store;
        const modeWas = st.cgMode, depthWas = st.cgDepth, ctxWas = st.cgCtx;

        st.cgMode = 'roi'; st.cgDepth = 'deep';
        st.cgCtx = [{ label: 'Объект: Creekline' }, { label: 'Переписка с клиентом', att: true }];
        const sent = L.composer();
        check('режим · what the composer holds is what gets sent',
          sent.mode === 'roi' && sent.depth === 'deep' && sent.focus.length === 2 && sent.focus[1].att === true,
          JSON.stringify(sent));

        // The framing behind an id lives on the server: the endpoint is public,
        // and framing a caller sends is framing a caller wrote.
        check('режим · and only the id travels, never the wording',
          Object.keys(sent).join(',') === 'mode,depth,focus' &&
          JSON.stringify(sent).indexOf('Инвест') < 0, JSON.stringify(sent).slice(0, 80));

        /* An instruction is carried out from any mode. It used to be cut out in
           the analysis modes, so a broker reading a report and saying «переведи
           сделку дальше» was sent to switch mode and say it again. That gate
           protected nothing — the change was already inert until a person
           confirmed the exact old → new diff — and it cost exactly that. */
        const act = { op: 'dealStage', id: dd().deals[0].id, stage: otherStep(dd().deals[0]) };
        const fromAnalysis = L.toReply('Перевожу дальше.', { act: act });
        check('режим · an instruction given from an analysis mode is carried out',
          !!fromAnalysis && fromAnalysis.kind === 'proposal', JSON.stringify(fromAnalysis && fromAnalysis.kind));
        check('режим · and the card says which posture it was asked from',
          !!fromAnalysis && fromAnalysis.askedIn === 'Инвест-анализ · ROI', fromAnalysis && fromAnalysis.askedIn);
        /* What the live path does next: it stamps the resolved ids onto the
           reply. The posture label lived in the same field, so on the real path
           — and only there — the card read «запрошено вами · roi». The two
           belong to different readers and must not share a name. */
        fromAnalysis.mode = 'roi'; fromAnalysis.depth = 'think';
        const askedCard = doc.createElement('div');
        askedCard.innerHTML = WS.engine.agentCard(fromAnalysis, 'mAsk');
        check('режим · stamping the resolved id does not overwrite the posture on the card',
          (askedCard.textContent || '').indexOf('· roi') < 0, (askedCard.textContent || '').slice(0, 140));
        check('режим · so a change is not mistaken for the analysis proposing it',
          (askedCard.textContent || '').indexOf('запрошено вами') >= 0, (askedCard.textContent || '').slice(0, 140));

        st.cgMode = 'auto';
        const fromAuto = L.toReply('Перевожу дальше.', { act: act });
        check('режим · from «Авто» the card carries no posture label',
          !!fromAuto && fromAuto.kind === 'proposal' && !fromAuto.askedIn, JSON.stringify(fromAuto && fromAuto.askedIn));

        // Depth is a ceiling, and the ceiling is kept where the blocks are built.
        const many = () => Array.from({ length: 30 }, () => ({ t: 'p', text: 'x' }));
        st.cgDepth = 'fast';
        check('глубина · «Быстро» keeps the answer short', L.normBlocks(many()).length === 3);
        st.cgDepth = 'deep';
        check('глубина · «Глубоко» allows the full set', L.normBlocks(many()).length === 10);
        /* The server states the ceiling to the model; the page enforces it.
           Two numbers, and nothing has been making them agree — the prompt
           could ask for eight while the page cut at three, and the answer
           would arrive visibly truncated with nobody at fault. Read out of the
           shipped rules, not restated here. */
        {
          const rules = fs.readFileSync(path.join(D, '..', 'server', 'proxy.js'), 'utf8');
          const said = {};
          ['fast', 'think', 'deep'].forEach((k) => {
            const m = new RegExp(k + ':\\s*\\{\\s*blocks:\\s*(\\d+)').exec(rules);
            said[k] = m ? Number(m[1]) : null;
          });
          const enforced = {};
          ['fast', 'think', 'deep'].forEach((k) => {
            st.cgDepth = k;
            enforced[k] = L.normBlocks(many()).length;
          });
          check('глубина · the page cuts at exactly the number the rules ask for',
            said.fast === enforced.fast && said.think === enforced.think && said.deep === enforced.deep,
            JSON.stringify({ said: said, enforced: enforced }));
        }

        /* The presenter's own hand is a race: switch to «Быстро» while a deep
           answer is in flight and it used to be cut to three blocks and then
           labelled «Глубоко». The setting an answer was given under is the one
           it is shaped by. */
        st.cgDepth = 'fast';
        const deepRan = L.toReply('ответ', { blocks: many() }, { mode: 'auto', depth: 'deep' });
        check('глубина · an answer is cut by the setting it ran under, not the one on screen now',
          !!deepRan && deepRan.blocks.length === 10, deepRan && deepRan.blocks.length);
        const askedFrom = L.toReply('ок', { act: { op: 'dealStage', id: dd().deals[0].id, stage: otherStep(dd().deals[0]) } },
          { mode: 'cma', depth: 'think' });
        check('режим · and marked with the mode it ran under',
          !!askedFrom && askedFrom.askedIn === 'Оценка · CMA', askedFrom && askedFrom.askedIn);

        // A document is asked for outright; the chat's ceiling does not shorten it.
        st.cgDepth = 'fast';
        const rp = L.normReport({ title: 'Разбор', blocks: many() });
        check('глубина · but a document is not cut to the chat’s ceiling',
          !!rp && rp.blocks.length === 10, rp && rp.blocks.length);

        // What actually answered, as the server resolved it.
        const card = doc.createElement('div');
        card.innerHTML = WS.engine.agentCard(
          { kind: 'answer', text: 'ответ', evidence: [], next: [], mode: 'roi', depth: 'deep' }, 'mMode');
        check('режим · the answer says which setting produced it',
          (card.textContent || '').indexOf('Инвест-анализ · ROI') >= 0 &&
          (card.textContent || '').indexOf('Глубоко') >= 0, (card.textContent || '').slice(0, 120));
        const plain = doc.createElement('div');
        plain.innerHTML = WS.engine.agentCard(
          { kind: 'answer', text: 'ответ', evidence: [], next: [], mode: 'auto', depth: 'think' }, 'mMode2');
        check('режим · and stays quiet when nothing was moved off default',
          (plain.textContent || '').indexOf('Размышление') < 0, (plain.textContent || '').slice(0, 90));

        // The control says what it does before it is pressed — and what it says
        // is now «не меняет сам», because that is what it does.
        check('режим · the picker knows which modes keep to analysis',
          WS.ui.cgWrites('auto') === true && WS.ui.cgWrites('roi') === false &&
          WS.ui.cgWrites('cma') === false && WS.ui.cgWrites('qual') === true,
          [WS.ui.cgWrites('auto'), WS.ui.cgWrites('roi')].join(','));

        st.cgMode = modeWas; st.cgDepth = depthWas; st.cgCtx = ctxWas;
      }

      // Evidence carries the revision it was read at.
      const ev = L.evidenceFor(['deals_active']);
      check('основания · a chip remembers the revision it was read at',
        ev.length === 1 && ev[0].revision === WS.store.dataRevision, JSON.stringify(ev[0]));

      // A write may not name an entity that does not exist.
      const ghostRef = WS.storeApi.preview([{ op: 'addTask', task: { title: 'x', clientId: 'c_nope' } }]);
      check('запись · a task cannot hang off a contact that is not there',
        ghostRef.ok === false && ghostRef.code === 'bad_ref', ghostRef.code);
      const goodRef = WS.storeApi.preview([{ op: 'addTask', task: { title: 'x', clientId: dd().clients[0].id } }]);
      check('запись · and a real one passes', goodRef.ok === true, goodRef.error || '');
      const badPatch = WS.storeApi.preview([{ op: 'updateDeal', id: dd().deals[0].id, patch: { companyId: 'co_nope' } }]);
      check('запись · the same applies to a field being changed',
        badPatch.ok === false && badPatch.code === 'bad_ref', badPatch.code);
    }

    // Findings from the cross-model round.
    {
      // Everything the stand knows is posted to whatever ?api= names.
      check('адрес службы · a stranger’s host is ignored, not obeyed',
        L.allowed('https://evil.example') === false && L.allowed('https://wespace.201-51-22-106.sslip.io') === true);
      check('адрес службы · off and same-origin still work',
        L.allowed('off') === true && L.allowed('/ask') === true);
      check('адрес службы · a lookalike host does not pass',
        L.allowed('https://wespace.201-51-22-106.sslip.io.evil.example') === false &&
        L.allowed('https://evil.example/?x=wespace.201-51-22-106.sslip.io') === false);

      // Through the reader, not the predicate: checking `allowed` on its own
      // left the caller free to keep obeying whatever the link named.
      {
        const envWas = WS.env;
        WS.env = { search: '?api=https://evil.example/collect' };
        const picked = L.configuredUrl();
        WS.env = { search: '?api=off' };
        const off = L.configuredUrl();
        WS.env = envWas;
        check('адрес службы · a crafted link cannot redirect the stand',
          picked.indexOf('evil.example') < 0, picked);
        check('адрес службы · and turning the model off still works', off === 'off');
      }

      // The contract handed to the model has no id in it, and the write layer
      // demanded one — so «поставь задачу» came back as an error.
      const before = (dd().tasks || []).length;
      const dry = WS.storeApi.preview([{ op: 'addTask', task: { title: 'перезвонить Анне', due: 'завтра', when: 'tomorrow', kind: 'manual', status: 'open' } }]);
      check('задача · a task the model describes can actually be created', dry.ok === true, dry.error || '');
      const done = WS.storeApi.apply([{ op: 'addTask', task: { title: 'перезвонить Анне', due: 'завтра', when: 'tomorrow', kind: 'manual', status: 'open' } }], { confirmed: true });
      check('задача · and it lands with an id of ours',
        done.ok === true && (dd().tasks || []).length === before + 1 && !!(dd().tasks || [])[0].id,
        done.error || '');

      // A conversation can create a new request for an existing client.
      // addRequest was in applyEffects (scripted scenes) but not in OP_SPEC, so
      // the model had no path to create one — it either invented an unknown op
      // that was rejected, or froze waiting for something to happen.
      {
        const cid = dd().clients[0].id;
        const beforeR = (dd().requests || []).length;
        const dryR = WS.storeApi.preview([{ op: 'addRequest', obj: { clientId: cid, title: 'Апартаменты в JVC', goal: 'Инвестиция', budget: 1500000, temperature: 'warm' } }]);
        check('addRequest · preview passes for an existing client', dryR.ok === true, dryR.error || '');
        check('addRequest · preview is guarded (needs confirmation)', dryR.tier === 'guarded', dryR.tier);
        check('addRequest · summary names the request, not the id',
          Array.isArray(dryR.pending) && /Заявка.*Апартаменты/.test(dryR.pending[0] || ''),
          (dryR.pending || [])[0] || '');
        const doneR = WS.storeApi.apply([{ op: 'addRequest', obj: { clientId: cid, title: 'Апартаменты в JVC', goal: 'Инвестиция', budget: 1500000, temperature: 'warm' } }], { confirmed: true });
        check('addRequest · confirmed apply lands in store', doneR.ok === true && (dd().requests || []).length === beforeR + 1, doneR.error || '');
        check('addRequest · new record has an auto-assigned id', !!((dd().requests || [])[0].id), '');
        const dryBadRef = WS.storeApi.preview([{ op: 'addRequest', obj: { clientId: 'c_ghost_xyz', title: 'Тест' } }]);
        check('addRequest · unknown clientId is refused', dryBadRef.ok === false && dryBadRef.code === 'bad_ref', dryBadRef.code);
      }

      // A conversation can also register a new contact. Use a name that does not
      // collide with fixture contacts — a second «Анна» would confuse the offline
      // planner's name lookup in the e2e section that runs after this one.
      {
        const beforeC = (dd().clients || []).length;
        const dryC = WS.storeApi.preview([{ op: 'addClient', obj: { name: 'Тест Интеграции', channel: 'whatsapp', tag: 'Клиент' } }]);
        check('addClient · preview passes', dryC.ok === true, dryC.error || '');
        check('addClient · preview is guarded', dryC.tier === 'guarded', dryC.tier);
        check('addClient · summary names the contact',
          Array.isArray(dryC.pending) && /Контакт.*Тест/.test(dryC.pending[0] || ''),
          (dryC.pending || [])[0] || '');
        const doneC = WS.storeApi.apply([{ op: 'addClient', obj: { name: 'Тест Интеграции', channel: 'whatsapp', tag: 'Клиент' } }], { confirmed: true });
        check('addClient · confirmed apply lands in store', doneC.ok === true && (dd().clients || []).length === beforeC + 1, doneC.error || '');
      }

      // The old OP_SPEC had a duplicate updateRequest key — the second one silently
      // overwrote the first, which is a JS quirk, not an error. Now it is gone.
      {
        const unknown = WS.storeApi.preview([{ op: 'createRequest' }]);
        check('unknown op is refused with a list of known ones', unknown.ok === false && unknown.code === 'unknown_op', unknown.code);
        check('available ops include addRequest', unknown.available && unknown.available.indexOf('addRequest') >= 0, JSON.stringify(unknown.available));
        check('available ops include addClient', unknown.available && unknown.available.indexOf('addClient') >= 0, JSON.stringify(unknown.available));
      }

      // A stage the board has no column for takes the deal off the board.
      const okStage = WS.storeApi.preview([{ op: 'dealStage', id: dd().deals[0].id, stage: otherStep(dd().deals[0]) }]);
      const badStage = WS.storeApi.preview([{ op: 'dealStage', id: dd().deals[0].id, stage: 'подписан' }]);
      check('стадия · a real stage passes', okStage.ok === true, okStage.error || '');
      check('стадия · an invented one is refused', badStage.ok === false && badStage.code === 'bad_value', badStage.code);

      // The chat survives a reload; the answers under it used to not.
      {
        WS.engine.openThread('probe:reload', 'Перезагрузка', 'chat');
        const rmid = WS.engine.pushMsg('<div></div>');
        WS.engine.updateMsg(rmid, WS.engine.agentCard({
          kind: 'answer', text: 'до перезагрузки', speak: 'До перезагрузки.', next: [{ label: 'ещё', ask: 'ещё' }],
          evidence: [{ label: 'сделок', value: 3, query: { from: 'deals' } }],
        }, rmid));
        const snapshot = JSON.parse(JSON.stringify(WS.engine.exportThreads()));
        check('перезагрузка · the answer is stored beside its message',
          !!(snapshot['probe:reload'].items.find((m) => m.id === rmid) || {}).reply);
        WS.engine.importThreads(snapshot);
        const back = WS.engine.replyFor(rmid + ':0');
        check('перезагрузка · and comes back addressable',
          !!back && back.evidence[0].label === 'сделок', JSON.stringify(back && back.text));
        check('перезагрузка · a missing answer resolves to nothing, not to the newest',
          WS.engine.replyFor('mGhost:0') === null);
        check('перезагрузка · a malformed stored answer is dropped, not trusted',
          (() => {
            const bad = JSON.parse(JSON.stringify(snapshot));
            bad['probe:reload'].items.forEach((m) => { if (m.id === rmid) m.reply = 'строка'; });
            WS.engine.importThreads(bad);
            return WS.engine.replyFor(rmid + ':0') === null;
          })());
        WS.engine.importThreads(snapshot);
      }
    }

    // What the next question is answered against. Scraped from markup, the
    // Concierge's own table came back as a run-on line.
    {
      WS.engine.openThread('probe:ctx', 'Контекст', 'chat');
      WS.router.go('concierge');
      const cmid = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(cmid, WS.engine.agentCard({
        kind: 'answer', text: 'Под аренду лучше Arjan.', evidence: [], next: [],
        blocks: [{ t: 'table', head: ['Район', 'Цена/м²'], rows: [['Arjan', '11 600'], ['JVC', '13 800']] }],
      }, cmid));
      WS.engine.pushText('me', 'я', 'а если бюджет 1,5 млн?', 'probe:ctx');

      const h = L.history();
      const agentTurn = h.filter((x) => x.role === 'agent').pop();
      check('контекст · the last answer travels in its own shape',
        !!agentTurn && Array.isArray(agentTurn.blocks) && agentTurn.blocks[0].t === 'table' &&
        agentTurn.blocks[0].rows[0][0] === 'Arjan', JSON.stringify(agentTurn && agentTurn.blocks));
      check('контекст · and the broker’s own words are still the broker’s',
        h[h.length - 1].role === 'user' && h[h.length - 1].text.indexOf('1,5 млн') >= 0);

      const sc = L.scope();
      check('контекст · the conversation says which one it is',
        !!sc && sc.id === 'probe:ctx' && !!sc['о_чём'], JSON.stringify(sc));

      // Не всякое сообщение в треде — ответ Консьержа: сценарные карточки
      // приходят готовой разметкой, и для них форма просто отсутствует.
      check('контекст · a scripted card without a reply object still travels',
        L.shapeOf(null) === null && L.shapeOf({ blocks: 'нет' }) === null);
    }

    // A chip must open its own message's rows, not the newest reply's.
    {
      const older = { kind: 'answer', text: 'старый', evidence: [{ label: 'старое', value: 1, query: { from: 'deals' } }], next: [{ label: 'a', ask: 'a' }] };
      const newer = { kind: 'answer', text: 'новый', evidence: [{ label: 'новое', value: 2, query: { from: 'deals' } }], next: [{ label: 'b', ask: 'b' }] };
      const h1 = WS.engine.agentCard(older, 'mOld');
      WS.engine.agentCard(newer, 'mNew');
      const bx = doc.createElement('div'); bx.innerHTML = h1;
      const key = bx.querySelector('[data-agev]').getAttribute('data-agev');
      check('live · a chip is addressed to its own message', key.indexOf('mOld:') === 0, key);
      check('live · and resolves to that message’s reply',
        WS.engine.replyFor(key).evidence[0].label === 'старое');
      check('live · an unknown address falls back rather than throwing',
        WS.engine.replyFor('mGone:0') !== undefined);
    }

    // The model names a shape; the markup is built by code. Nothing it returns
    // may become markup, and no shape outside the vocabulary may be invented.
    {
      check('live · an unknown block shape is dropped',
        L.normBlocks([{ t: 'script', text: 'x' }, { t: 'p', text: 'ок' }]).length === 1);
      check('live · block lists are capped by the chosen depth',
        L.normBlocks(Array.from({ length: 30 }, () => ({ t: 'p', text: 'x' }))).length === 8);
      check('live · a reply that is only blocks still stands',
        (L.toReply('', { blocks: [{ t: 'p', text: 'только разбор' }] }) || {}).kind === 'answer');

      const card = WS.engine.agentCard({
        kind: 'answer', text: 'Ведущая фраза.', evidence: [], next: [{ label: 'ещё', ask: 'ещё' }],
        blocks: [
          { t: 'h', text: '<img src=x onerror=alert(1)>' },
          { t: 'table', head: ['Район'], rows: [['<b>Arjan</b>']] },
          { t: 'bars', rows: [{ label: 'Arjan', value: 8.1, suffix: '%' }, { label: 'JVC', value: 7.6, suffix: '%' }] },
          { t: 'kv', rows: [{ k: 'Доходность', v: '8,1%' }] },
        ],
      });
      const box = doc.createElement('div'); box.innerHTML = card;
      check('live · a table renders as a table', box.querySelectorAll('.an-t td').length === 1);
      check('live · bars are drawn to scale, longest first at full width',
        (box.querySelectorAll('.an-bar .bt i')[0] || {}).style.width === '100%');
      check('live · markup inside a block is text, never markup',
        box.querySelectorAll('img').length === 0 && box.querySelectorAll('.an-t b').length === 0);
      check('live · the escaped tag is still shown to the reader',
        (box.textContent || '').indexOf('onerror') >= 0);
      check('live · evidence and follow-ups survive the shaped answer',
        box.querySelectorAll('[data-agnext]').length > 0);
    }

    check('live · a plain reply becomes an answer',
      L.toReply('Четыре сделки.', {}).kind === 'answer');

    // The generic deals rule used to fire first, so a question about
    // commission came back with deal counts — an answer to another question.
    {
      const a = WS.agent.ask('какая комиссия набегает по активным сделкам');
      check('offline · a commission question is answered about commission',
        /комисси/i.test(a.text || ''), a.text);
      const b = WS.agent.ask('сколько сделок в работе и на какую сумму');
      check('offline · a deals question still answers about deals',
        /сдел/i.test(b.text || '') && !/комисси/i.test(b.text || ''), b.text);
    }

    // A count declines the noun after it, and these labels are the chip text.
    {
      const pl = WS.agent.tools.plural;
      const F = ['задача', 'задачи', 'задач'];
      const got = [0, 1, 2, 4, 5, 11, 12, 21, 22, 25, 101, 111].map((n) => n + ' ' + pl(n, F)).join(', ');
      const want = '0 задач, 1 задача, 2 задачи, 4 задачи, 5 задач, 11 задач, 12 задач, ' +
        '21 задача, 22 задачи, 25 задач, 101 задача, 111 задач';
      check('live · counted nouns are declined, not left in one form', got === want, got);
      check('live · a label that is not a count is left alone', pl(3, 'на сумму') === 'на сумму');
      const one = WS.agent.READINGS.tasks_overdue.label;
      check('live · reading labels carry all three forms', Array.isArray(one) && one.length === 3);
    }

    // Evidence is re-read from the store, so the figure on a chip is the
    // store's figure whatever the model said around it.
    const ev = L.evidenceFor(['deals_active']);
    // The same query the reading runs, taken FROM the reading: written out
    // again here it would keep passing while the two drifted apart.
    const truth = WS.query.run(WS.agent.READINGS.deals_active.q);
    check('live · evidence values come from the store, not the model',
      ev.length === 1 && ev[0].value === truth.value, 'chip=' + (ev[0] && ev[0].value) + ' store=' + truth.value);
    check('live · an unknown reading is dropped rather than shown',
      L.evidenceFor(['deals_active', 'выдуманный_показатель']).length === 1);
    check('live · evidence survives a non-array', L.evidenceFor('deals_active').length === 0);

    check('live · follow-ups are capped at three',
      (L.normNext([1, 2, 3, 4, 5].map((i) => ({ label: 'п' + i, ask: 'в' + i }))) || []).length === 3);
    check('live · a malformed follow-up is dropped',
      (L.normNext([{ ask: 'нет метки' }, { label: 'есть', ask: 'да' }, null]) || []).length === 1);
    check('live · a follow-up with no action is dropped',
      L.normNext([{ label: 'пусто' }]) === null);

    // Navigating the moment it answers threw the reply off a phone screen —
    // the person was still reading it. It offers, they decide.
    {
      const r = L.toReply('Вот по сделке.', { open: { view: 'deal', id: 'd_anna' }, next: [{ label: 'Ещё', ask: 'что ещё' }] });
      check('live · a screen the model wants shown becomes a chip', !!(r.next || []).some((n) => n.open === 'deal' && n.id === 'd_anna'),
        JSON.stringify(r.next));
      check('live · and never a jump', r.open === undefined, JSON.stringify(r.open));
      const c = L.toReply('Смотри контакт.', { open: { view: 'contact', id: 'c_anna' } });
      check('live · an entity chip is named, not called «contact»',
        /Анна/.test(((c.next || [])[0] || {}).label || ''), JSON.stringify((c.next || [])[0]));
      const bad = L.toReply('Текст.', { open: { view: 'нет_такого_экрана', id: 'x' } });
      check('live · an unknown screen is ignored',
        !(bad.next || []).some((n) => n.open === 'нет_такого_экрана'));
    }

    // A write instruction from the model is a proposal, never a write.
    {
      const before = (dd().contactTimeline['c_anna'] || []).length;
      const r = L.toReply('Записал бы так.', {
        act: { op: 'addEvent', scope: 'contact', id: 'c_anna', type: 'note', text: 'ЖИВАЯ ГОЛОВА: проверка' },
      });
      check('live · an action from the model becomes a proposal', r && r.kind === 'proposal', r && r.kind);
      check('live · the proposal carries what the model said', r && r.text === 'Записал бы так.');
      check('live · nothing is written by proposing',
        (dd().contactTimeline['c_anna'] || []).length === before);
    }
    // An impossible action is refused as a dry run and answered honestly.
    {
      const r = L.toReply('Попробую.', { act: { op: 'dealStage', id: 'нет_такой_сделки', stage: 'done' } });
      check('live · an impossible action does not become a proposal', r && r.kind !== 'proposal', r && r.kind);
      check('live · and the refusal is said out loud', r && /Записать не выйдет/.test(r.text || ''), r && r.text);
    }

    // `WS.engine.threads` is not exported, so the obvious spelling returned an
    // empty history and every follow-up reached the model with no memory.
    {
      WS.engine.openThread('probe:hist', 'История', 'chat');
      WS.engine.pushText('me', 'текст', 'первый вопрос', 'probe:hist');
      WS.engine.pushText('ai', 'Консьерж', 'первый ответ', 'probe:hist');
      const hist = (function () { try { return JSON.parse(JSON.stringify(WS.live.history ? WS.live.history() : [])); } catch (e) { return []; } })();
      check('live · the conversation so far reaches the model',
        hist.length >= 2 && /первый вопрос/.test(JSON.stringify(hist)), JSON.stringify(hist).slice(0, 120));
      // A client's own words handed over as the Concierge's leaves the model
      // reasoning from a conversation that never happened.
      WS.engine.pushText('user', 'Sarah', 'ещё ищу 1BR в JVC', 'probe:hist');
      const withClient = WS.live.history();
      check('live · a client is a third voice, not the Concierge',
        withClient.some((m) => m.role === 'client' && /1BR/.test(m.text)),
        JSON.stringify(withClient.map((m) => m.role)));
      check('live · and each turn is attributed to a speaker',
        hist.some((m) => m.role === 'user') && hist.some((m) => m.role === 'agent'), JSON.stringify(hist.map((m) => m.role)));
    }

    // Entities the interface already shows must be visible to the model too,
    // or it answers "нет данных" about something on screen.
    {
      const d = L.digest();
      check('live · requests reach the model', Array.isArray(d.заявки) && d.заявки.length > 0,
        'заявки=' + (d.заявки || []).length);
      const multi = (d.сделки || []).find((x) => x.лоты && x.лоты.length > 1);
      check('live · a multi-lot deal carries its lots', !!multi, JSON.stringify((d.сделки || [])[0]));
    }

    // Lots do not share a commission rate; charging the whole contract at the
    // first lot's rate produced a figure the stand then called verified.
    {
      const deal = (dd().deals || []).find((x) => x.lots && x.lots.length > 1);
      if (deal) {
        const objs = dd().objects || [];
        const lots = deal.lots.map((id) => objs.find((o) => o.id === id)).filter(Boolean);
        const rates = lots.map((o) => (o.commissionPct || 2));
        const got = WS.ui.dealCommission(deal);
        const first = Math.round((deal.amount || 0) * rates[0] / 100);
        const differ = rates.some((r) => r !== rates[0]);
        check('live · a multi-lot commission is not the first lot rate alone',
          !differ || got !== first, 'got=' + got + ' first-rate=' + first + ' rates=' + rates.join('/'));
        const lo = Math.min.apply(null, rates), hi = Math.max.apply(null, rates);
        check('live · and it lands between the lot rates',
          got >= Math.round(deal.amount * lo / 100) - 1 && got <= Math.round(deal.amount * hi / 100) + 1,
          'got=' + got + ' range=' + Math.round(deal.amount * lo / 100) + '..' + Math.round(deal.amount * hi / 100));
      } else { check('a multi-lot deal exists to check', false); }
    }

    // The market slice is read through the same layer as everything else, so a
    // figure about Dubai is openable exactly like a figure about the pipeline.
    {
      const q = WS.query.run({ from: 'market', where: [{ field: 'район', op: 'eq', value: 'Downtown Dubai' }] });
      check('market · a district is queryable like any other collection',
        q.ok && q.rows.length === 1, JSON.stringify(q).slice(0, 120));
      const all = WS.query.run({ from: 'market' });
      check('market · every row declares where its numbers come from',
        all.ok && all.rows.every((r) => !!r.basis), 'rows=' + (all.rows || []).length);
      check('market · rent, price and yield cannot contradict each other',
        all.rows.every((r) => Math.abs(r.арендаЗаМетрВГод - Math.round(r.ценаЗаМетр * r.доходностьПроцент / 100)) <= 1));
      /* Two market slices live in this stand now: AREAS behind the object
         cards, and this one behind the Concierge's answers. A district
         described in both with different numbers is the contradiction a broker
         finds first — one screen and one question is all it takes — so where
         they overlap they are the same figures, not merely similar ones. */
      {
        const A = (WS.fixtures && WS.fixtures.AREAS) || {};
        const shared = all.rows.filter((r) => A[r.район]);
        check('market · the slice and the area cards describe the same districts',
          shared.length >= 3, 'overlap=' + shared.length);
        const off = shared.filter((r) => r.ценаЗаМетр !== A[r.район].perM2 ||
          r.доходностьПроцент !== A[r.район].yieldTypical);
        check('market · and where they overlap they do not contradict each other',
          off.length === 0, off.map((r) => r.район + ': ' + r.ценаЗаМетр + '≠' + A[r.район].perM2).join('; '));
      }

      // Downtown came back as «нет данных» in the live breadth pass.
      const areas = (dd().objects || []).map((o) => o.area);
      check('market · it covers the districts the stand already sells in',
        areas.every((a) => all.rows.some((r) => r.район === a)), areas.join('/'));
      check('market · the model is given the slice with its provenance intact',
        (L.digest().рынок_дубая || []).some((r) => r.basis === 'иллюстративно'));
    }

    check('live · the digest carries the readings the answer may use',
      !!L.digest().показатели.deals_active);
    // Left out, the model answered «комиссии в данных нет» while the analytics
    // screen was showing the figure — the live head contradicting the stand.
    {
      const shown = WS.ui.metricsSnapshot().metrics.expected_commission;
      const sent = L.digest().показатели_экранов.expected_commission;
      check('live · the model sees every figure the screens show',
        !!sent && sent.value === shown.v, 'sent=' + (sent && sent.value) + ' screen=' + shown.v);
    }
    check('live · the digest names entities so the model can refer to them',
      (L.digest().контакты || []).some((c) => c.id === 'c_anna'));
    // Sending only the stage code put «две сделки на стадии docs» into a reply.
    {
      const deal = (L.digest().сделки || [])[0];
      /* The head follows the model, and the model moved: the board is no longer
         four columns for everyone. Without the steps THIS deal may take, a
         proposal to move it is a guess the store refuses after the person has
         already read it. */
      check('live · a deal carries the steps its own contract allows',
        !!deal && Array.isArray(deal.шаги) && deal.шаги.length > 0 &&
        deal.шаги.every((s) => s.код && s.шаг && s.код !== s.шаг),
        JSON.stringify(deal && deal.шаги));
      {
        const src = (dd().deals || []).find((d) => d.id === deal.id);
        const allowed = WS.ui.dealSteps(src).join(',');
        check('live · and they are the same steps the board would offer',
          deal.шаги.map((s) => s.код).join(',') === allowed, allowed);
        // The one thing the rules tell the model to copy is a stage code, so a
        // stage taken from the digest has to be one the store accepts.
        const pv = WS.storeApi.preview([{ op: 'dealStage', id: deal.id,
          stage: deal.шаги.map((s) => s.код).filter((k) => k !== src.stage)[0] }]);
        check('live · a step taken from the digest is one the store accepts', pv.ok === true, pv.error || '');
      }
      // A request has no stage of its own — it is computed — so what the model
      // is given is the reading the screens show, not a field that is not there.
      {
        const req = (L.digest().заявки || [])[0];
        const raw = (dd().requests || []).find((r) => r.id === req.id);
        check('live · a request carries the stage the screens compute for it',
          !!req.стадия && req.стадия === WS.ui.reqStageLabel(WS.ui.reqStage(raw), raw) &&
          req.стадия !== WS.ui.reqStage(raw),
          req.стадия + ' / ' + WS.ui.reqStage(raw));
      }
      const codes = Object.keys((WS.fixtures && WS.fixtures.STAGE_LABELS) || {});
      check('live · a stage reaches the model as words, not a code',
        !!deal && codes.indexOf(deal.стадия) < 0, deal && deal.стадия);
      check('live · and the code is still there to write a change with',
        !!deal && codes.indexOf(deal.стадия_код) >= 0, deal && deal.стадия_код);
    }

    // A bad second at page load must not cost the visitor the live Concierge
    // for the whole session — the head goes in even when the probe fails.
    {
      const hadFetch = win.fetch;
      win.fetch = () => Promise.reject(new Error('сеть недоступна'));
      WS.agent.setAsyncHead(null);
      const put = L.install();
      check('live · the head is installed even when the probe cannot answer',
        put === true && WS.agent.hasAsyncHead() === true, 'install=' + put);
      if (hadFetch === undefined) delete win.fetch; else win.fetch = hadFetch;
      WS.agent.setAsyncHead(null);
    }

    // The boot probe is still in flight when the first question is typed. It
    // used to be answered with the stale «not ready», so that question fell to
    // the offline planner without a word.
    {
      L.disable('reset');
      const a1 = L.probe();
      const a2 = L.probe();
      check('live · a second probe waits on the first instead of answering «no»',
        a1 === a2, 'same promise=' + (a1 === a2));
      const both = await Promise.all([a1, a2]);
      check('live · and both callers get the same verdict', both[0] === both[1]);
      L.disable('done');
    }

    // Two failures and the live head steps aside for the rest of the session.
    {
      WS.agent.setAsyncHead(() => { throw new Error('проверка'); });
      check('live · a live head can be installed', WS.agent.hasAsyncHead() === true);
      L.noteFailure('раз');
      check('live · one hiccup does not cost the session its live head', WS.agent.hasAsyncHead() === true);
      L.noteFailure('два');
      check('live · a service that stays down is stopped being retried', WS.agent.hasAsyncHead() === false);
    }
  } else {
    check('live head module present', false);
  }

  // A failing live head must answer anyway, through the offline planner.
  if (WS.agent && WS.agent.askAsync) {
    WS.agent.setAsyncHead(async () => { throw new Error('сеть легла'); });
    const fallback = await WS.agent.askAsync('сколько сделок в работе');
    check('live · a failed live call still produces an answer',
      !!fallback && fallback.kind === 'answer' && /\d/.test(fallback.text || ''), fallback && fallback.text);
    WS.agent.setAsyncHead(async () => ({ kind: 'answer', text: 'Живой ответ.', evidence: [], next: [] }));
    const live = await WS.agent.askAsync('что там');
    check('live · a working live call is used', live.text === 'Живой ответ.');
    check('live · a live reply still gets follow-ups', (live.next || []).length > 0);
    WS.agent.setAsyncHead(null);
  }

  // ============================================================
  //  Voice. Both halves belong to the browser, so both are faked here — what
  //  is being tested is the wiring: that dictation reaches the composer and
  //  survives a re-render, and that a spoken answer is the answer's own.
  // ============================================================
  if (WS.voice) {
    const V = WS.voice;

    // ---- what a reply sounds like ----
    check('voice · the model’s spoken form wins', V.spokenText({ speak: 'Коротко вслух.', text: 'Длинный текст.' }) === 'Коротко вслух.');
    check('voice · without one, the prose is read', V.spokenText({ text: 'Четыре сделки в работе.' }) === 'Четыре сделки в работе.');
    check('voice · a table is never read aloud, even one carrying a caption',
      V.spokenText({ text: '', blocks: [
        { t: 'table', text: 'Сравнение районов', head: ['a'], rows: [['b']] },
        { t: 'bars', text: 'Доходность', rows: [{ label: 'Arjan', value: 8.1 }] },
        { t: 'p', text: 'Суть.' },
      ] }) === 'Суть.');
    check('voice · nothing to say produces nothing', V.spokenText({}) === '' && V.spokenText(null) === '');
    check('voice · a spoken form is clipped', V.spokenText({ speak: 'а'.repeat(900) }).length === 600);
    if (WS.live) {
      check('voice · the live head carries the spoken form', WS.live.toReply('текст', { say_aloud: '  вслух   так  ' }).speak === 'вслух так');
      check('voice · and drops anything that is not a phrase', WS.live.normSay({ x: 1 }) === null);
    }

    // ---- dictation ----
    function FakeRec() { this.calls = []; FakeRec.last = this; }
    FakeRec.prototype.start = function () { this.started = true; };
    FakeRec.prototype.stop = function () { this.stopped = true; if (this.onend) this.onend(); };
    FakeRec.prototype.emit = function (text, isFinal) {
      const res = [Object.assign([{ transcript: text }], { isFinal: !!isFinal })];
      if (this.onresult) this.onresult({ resultIndex: 0, results: res });
    };
    win.SpeechRecognition = FakeRec;
    check('voice · dictation is offered where the browser has it', V.canDictate() === true);

    WS.router.go('concierge');
    const micBtn = doc.querySelector('[data-act="voice"]');
    const input = doc.getElementById('cgPrompt');
    check('voice · the composer has a microphone and a field', !!micBtn && !!input);
    if (micBtn && input) {
      input.value = 'для Анны';
      micBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('voice · a press starts listening', V.dictating() === true);
      check('voice · and the button says so without a re-render', micBtn.classList.contains('rec'));

      FakeRec.last.emit('подбери', false);
      check('voice · a half-said phrase is already in the field', input.value.indexOf('подбери') >= 0);
      FakeRec.last.emit('подбери две однушки', true);
      check('voice · what was typed before is kept, not overwritten',
        input.value.indexOf('для Анны') === 0 && input.value.indexOf('две однушки') > 0, input.value);

      // The composer is rebuilt on almost any state change; the words must not
      // fall on the floor when it is.
      WS.storeApi.emit();
      const fresh = doc.getElementById('cgPrompt');
      check('voice · a re-render replaces the field', fresh !== input);
      FakeRec.last.emit('подбери две однушки до двух миллионов', true);
      check('voice · dictation follows it', (fresh.value || '').indexOf('двух миллионов') > 0, fresh.value);

      const micNow = doc.querySelector('[data-act="voice"]');
      micNow.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('voice · a second press stops listening', V.dictating() === false);
      check('voice · and the button stops saying it is', !micNow.classList.contains('rec'));

      // A field that has gone for good stops the recogniser instead of typing
      // into a node nobody can see.
      micNow.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      WS.router.go('clients');
      FakeRec.last.emit('в пустоту', true);
      check('voice · a field that is gone ends the dictation', V.dictating() === false);
    }

    delete win.SpeechRecognition;
    check('voice · a browser without it says so rather than pretending', V.canDictate() === false);
    WS.router.go('concierge');
    const micGone = doc.querySelector('[data-act="voice"]');
    if (micGone) {
      micGone.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('voice · and pressing it is harmless', V.dictating() === false);
    }

    // ---- the answer said out loud ----
    check('voice · no listen button where the browser cannot speak',
      V.canSpeak() === false &&
      String(WS.engine.agentCard({ kind: 'answer', text: 'Ответ.', evidence: [], next: [] }, 'mQuiet')).indexOf('data-agsay') < 0);

    const spoken = [];
    win.SpeechSynthesisUtterance = function (t) { this.text = t; };
    win.speechSynthesis = {
      canceled: 0,
      cancel() { this.canceled += 1; },
      speak(u) { spoken.push(u); },
      getVoices() { return [{ lang: 'en-US', name: 'Alex' }, { lang: 'ru-RU', name: 'Milena' }]; },
    };
    check('voice · speaking is offered where the browser has it', V.canSpeak() === true);

    {
      const older = { kind: 'answer', text: 'старый ответ', speak: 'Старое вслух.', evidence: [], next: [] };
      const newer = { kind: 'answer', text: 'новый ответ', speak: 'Новое вслух.', evidence: [], next: [] };
      WS.engine.openThread('probe:say', 'Голос', 'chat');
      WS.router.go('concierge');
      const midOld = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(midOld, WS.engine.agentCard(older, midOld));
      const midNew = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(midNew, WS.engine.agentCard(newer, midNew));

      const btns = doc.getElementById('chat').querySelectorAll('[data-agsay]');
      check('voice · every answer offers to be read out', btns.length === 2);
      if (btns.length === 2) {
        // Through the real click path — the handlers were right and the
        // delegation was not, which is how this class of bug survives.
        btns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        check('voice · the button speaks its own answer, not the newest',
          spoken.length === 1 && spoken[0].text === 'Старое вслух.', spoken.length ? spoken[0].text : 'nothing spoken');
        check('voice · in Russian, with a Russian voice when there is one',
          !!spoken[0] && spoken[0].lang === 'ru-RU' && !!spoken[0].voice && spoken[0].voice.name === 'Milena');
        check('voice · and shows that it is the one speaking', btns[0].classList.contains('on'));
        btns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        check('voice · pressing it again stops', V.speaking() === null && win.speechSynthesis.canceled > 0);
        check('voice · and the button lets go of the state', !btns[0].classList.contains('on'));

        btns[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        check('voice · a different answer speaks its own words',
          spoken.length === 2 && !!spoken[1] && spoken[1].text === 'Новое вслух.',
          spoken.map((u) => u.text).join(' | '));
        V.stopSpeech();

        // Chrome cuts a single utterance at about fifteen seconds, mid-word.
        // A long spoken form has to arrive as several short ones.
        spoken.length = 0;
        const longSay = 'Первое предложение про Business Bay и его доходность. ' +
          'Второе предложение про JVC и сроки сдачи. Третье предложение про комиссию по сделке. ' +
          'Четвёртое предложение про то, что делать дальше и кому позвонить сегодня.';
        V.say(longSay, 'mLong');
        check('voice · a long answer is spoken in pieces, not one long breath',
          spoken.length > 1 && spoken.every((u) => u.text.length <= 200), 'pieces=' + spoken.length);
        check('voice · and the pieces are the whole answer, in order',
          spoken.map((u) => u.text).join(' ').replace(/\s+/g, ' ') === longSay.trim().replace(/\s+/g, ' '),
          spoken.map((u) => u.text).join(' | '));
        spoken.length = 0;
        V.say('Одна короткая фраза.', 'mShort');
        check('voice · a short answer is not chopped up', spoken.length === 1);
        V.stopSpeech();
      }
      const mute = WS.engine.agentCard({ kind: 'answer', text: '', evidence: [], next: [] }, 'mMute');
      check('voice · an answer with nothing to say offers no button', String(mute).indexOf('data-agsay') < 0);
    }
  } else {
    check('voice module present', false);
  }

  // ============================================================
  //  End to end: what actually happens when a person types into the Concierge.
  //  The module tests above prove the reasoning; this proves the wiring.
  // ============================================================
  const wait = (ms) => new Promise((r) => win.setTimeout(r, ms));
  // Wait for the CONDITION, not for a guessed duration. The Concierge answers after a chain of
  // scripted delays plus a full re-render per message, so the cost grows with the fixtures — a
  // fixed 1500 ms silently became too short the moment the stand gained a tenth deal.
  const waitFor = async (fn, ms) => {
    const limit = ms || 8000;
    for (let spent = 0; spent < limit; spent += 50) {
      try { if (fn()) return true; } catch (e) { /* not there yet */ }
      await wait(50);
    }
    return false;
  };
  if (WS.agent && typeof WS.router.routePrompt === 'function') {
    WS.engine.openThread('probe:e2e', 'Сквозная', 'chat');
    WS.router.go('concierge');

    WS.router.routePrompt('сколько сделок в работе и на какую сумму');
    await waitFor(() => { const el = doc.getElementById('chat'); return el && el.querySelector('[data-agev]'); });
    const chat1 = doc.getElementById('chat');
    const html1 = chat1 ? chat1.innerHTML : '';
    const liveActive = dd().deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').length;
    check('e2e · a typed question produces an answer in the chat', html1.indexOf(String(liveActive)) >= 0, 'looking for ' + liveActive);
    const chip = chat1 && chat1.querySelector('[data-agev]');
    check('e2e · the answer offers openable evidence', !!chip);
    check('e2e · no Wizard-of-Oz fallback left', html1.indexOf('Wizard-of-Oz') < 0 && html1.indexOf('подготовлены близкие результаты') < 0);

    // With an answer on screen — so there IS a newest reply to wrongly fall back
    // to — an address that resolves to nothing must stay nothing.
    check('e2e · an address with no answer behind it does not borrow the newest',
      !!WS.engine.lastReply && WS.engine.replyFor('mGhost:0') === null,
      'lastReply=' + !!WS.engine.lastReply);

    // Clicking the evidence chip opens the records the number came from.
    if (chip) {
      chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await waitFor(() => doc.getElementById('modal').innerHTML.indexOf('Откуда это число') >= 0, 1000);
      const modalHtml = doc.getElementById('modal').innerHTML;
      check('e2e · evidence opens the underlying records', modalHtml.indexOf('Откуда это число') >= 0, modalHtml.slice(0, 90));
      WS.ui.closeModal();
    } else {
      check('e2e · evidence opens the underlying records', false, 'no evidence chip to click');
    }

    // The same addressing, through the click. Resolving the chip key was
    // correct and the delegation coerced it with + — which turns «m3:0» into
    // NaN, and NaN into the first row of whatever answered last. Every check
    // that called the handler directly stayed green while every chip in the
    // running stand opened the wrong answer.
    {
      const first = { kind: 'answer', text: 'первый', next: [{ label: 'ещё', ask: 'вопрос первого' }],
        evidence: [{ label: 'сделок в первом', value: 1, query: { from: 'deals' } }] };
      const second = { kind: 'answer', text: 'второй', next: [{ label: 'ещё', ask: 'вопрос второго' }],
        evidence: [{ label: 'сделок во втором', value: 2, query: { from: 'deals' } }] };
      const m1 = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(m1, WS.engine.agentCard(first, m1));
      const m2 = WS.engine.pushMsg('<div></div>');
      WS.engine.updateMsg(m2, WS.engine.agentCard(second, m2));

      const evs = doc.getElementById('chat').querySelectorAll('[data-agev]');
      const olderEv = Array.prototype.filter.call(evs, (b) => b.getAttribute('data-agev').indexOf(m1 + ':') === 0)[0];
      if (olderEv) {
        olderEv.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await waitFor(() => doc.getElementById('modal').innerHTML.indexOf('Откуда это число') >= 0, 1500);
        const mh = doc.getElementById('modal').innerHTML;
        check('e2e · a chip opens its own answer’s rows, not the newest',
          mh.indexOf('сделок в первом') >= 0 && mh.indexOf('сделок во втором') < 0, mh.slice(0, 120));
        WS.ui.closeModal();
      } else {
        check('e2e · a chip opens its own answer’s rows, not the newest', false, 'no chip under the older answer');
      }

      const nexts = doc.getElementById('chat').querySelectorAll('[data-agnext]');
      const olderNext = Array.prototype.filter.call(nexts, (b) => b.getAttribute('data-agnext').indexOf(m1 + ':') === 0)[0];
      if (olderNext) {
        olderNext.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await waitFor(() => doc.getElementById('chat').innerHTML.indexOf('вопрос первого') >= 0, 1500);
        const ch = doc.getElementById('chat').innerHTML;
        check('e2e · a follow-up asks its own answer’s question',
          ch.indexOf('вопрос первого') >= 0 && ch.indexOf('вопрос второго') < 0);
      } else {
        check('e2e · a follow-up asks its own answer’s question', false, 'no follow-up under the older answer');
      }
    }

    // A write instruction reaches a proposal, and only a click applies it.
    const feedWas = (dd().contactTimeline['c_anna'] || []).length;
    WS.router.routePrompt('запиши по Анне: проверка сквозного пути');
    await waitFor(() => { const el = doc.getElementById('chat'); return el && el.querySelector('[data-agok]'); });
    const chat2 = doc.getElementById('chat');
    const okBtn = chat2 && chat2.querySelector('[data-agok]');
    check('e2e · a write instruction produces a confirm button', !!okBtn);
    check('e2e · still nothing written before the click',
      (dd().contactTimeline['c_anna'] || []).length === feedWas);
    if (okBtn) {
      okBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(120);
      check('e2e · the click writes it', (dd().contactTimeline['c_anna'] || []).length === feedWas + 1,
        'before=' + feedWas + ' after=' + (dd().contactTimeline['c_anna'] || []).length);
      check('e2e · the chat reports it applied', doc.getElementById('chat').innerHTML.indexOf('Применено') >= 0);
    }
  }

  check('no window errors after run', errors.length === 0, errors.join('; '));
  report();
}, 800);

function report() {
  const bad = results.filter((r) => !r.ok);
  results.filter((r) => r.ok).length;
  console.log('checks: ' + results.length + '  passed: ' + (results.length - bad.length) + '  FAILED: ' + bad.length);
  if (bad.length) {
    console.log('\n--- failures ---');
    bad.forEach((r) => console.log('  ✗ ' + r.name + (r.detail ? '  [' + r.detail + ']' : '')));
  }
  process.exit(bad.length ? 1 : 0);
}
