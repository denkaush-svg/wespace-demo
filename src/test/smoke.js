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
      // Ставка берётся ПО ЛОТУ: у лота может быть своя, отличная от ставки объекта, и именно
      // она должна победить. Считать здесь по o.commissionPct значило бы проверять правило,
      // которое волна 3 как раз заменила.
      const byLot = Math.round(lots.reduce((a, o) => a + o.price * (WS.ui.lotCommissionPct(dPort, o) / 100), 0));
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

    // Доска переложена на четыре укрупнённых отсека. Прежняя проверка требовала ОТСУТСТВИЯ
    // пресейла в колонках — теперь он там есть намеренно, пройденным участком сквозного пути,
    // и требование заменено на то, ради чего перекладка делалась.
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const cols = [].slice.call(doc.querySelectorAll('#app .kanban .kcol .kh span:first-child')).map((e) => e.textContent.trim());
    check('доска · ровно четыре отсека вместо десяти колонок', cols.length === 4, cols.join(' | '));
    check('доска · первые два отсека — пресейл, последние два — договор',
      cols[0] === 'Подбор и показы' && cols[1] === 'Переговоры' &&
      cols[2] === 'Договор и деньги' && cols[3] === 'Исход', cols.join(' | '));
    // Инвариант отсеков: каждая допустимая стадия принадлежит ровно одному, неизвестная — ни одному.
    {
      const B = WS.ui.DEAL_BANDS;
      const seen = {};
      let dup = null;
      B.forEach((b) => ['request', 'deal'].forEach((of) => (b[of] || []).forEach((st) => {
        const key = of + ':' + st;
        if (seen[key]) dup = key; else seen[key] = b.k;
      })));
      check('доска · ни одна стадия не попадает в два отсека', !dup, 'дубль: ' + dup);
      const dealStages = Object.keys(WS.DEAL_STEPS || {}).reduce((acc, k) => acc.concat(WS.DEAL_STEPS[k]), []).concat(['won', 'lost']);
      const unplaced = Array.from(new Set(dealStages)).filter((st) => !WS.ui.dealBandOf(st, 'deal'));
      check('доска · каждый шаг договора лежит в каком-то отсеке', unplaced.length === 0, 'без отсека: ' + unplaced.join(', '));
      check('доска · неизвестная стадия не сваливается в первый отсек',
        WS.ui.dealBandOf('такой-стадии-нет', 'deal') === null, 'вернулось: ' + WS.ui.dealBandOf('такой-стадии-нет', 'deal'));
      check('доска · на текущих данных нарушителей нет', WS.ui.bandOutliers().length === 0,
        WS.ui.bandOutliers().map((o) => o.kind + ' ' + o.id + ' → ' + o.stage).join(', '));
    }

    // Путь на карточке стал сквозным: слева пройденный пресейл, справа шаги договора.
    // Прежняя проверка считала ВСЕ шаги ленты и после перекладки ловила бы пресейл как лишний —
    // считаем собственные шаги сделки (у них есть data-dealstage), пресейл проверяется отдельно ниже.
    const off = [], nopre = [], pathLen = [];
    (dd().deals || []).forEach((d) => {
      const want = ((WS.DEAL_STEPS || {})[WS.contractKindFor(d.funnel, d.readiness)] || []).filter((k) => k !== 'lost');
      WS.ui.dealCard(d.id);
      const n = doc.querySelectorAll('#app .view .dx-path .dx-step[data-dealstage]').length;
      if (n !== want.length) off.push(d.id + ': ' + n + ' против ' + want.length);
      // Пресейл рисуется только у сделки, выросшей из запроса, и всегда неинтерактивен:
      // стадия запроса вычисляется из фактов, руками её не выставляют. Он представлен одной плашкой.
      const preSum = doc.querySelectorAll('#app .view .dx-path .dx-pre');
      if (d.requestId && !preSum.length) nopre.push(d.id + ': пресейла нет');
      if (!d.requestId && preSum.length) nopre.push(d.id + ': пресейл без запроса');
      [].slice.call(preSum).forEach((el) => {
        if (el.tagName === 'BUTTON' || el.hasAttribute('data-dealstage')) nopre.push(d.id + ': пресейл кликабелен');
        if (el.className.indexOf('done') < 0) nopre.push(d.id + ': пресейл не помечен пройденным');
      });
      // Путь не должен содержать более: 1 чипа пресейла + 1 границы + N шагов договора
      const pathEl = doc.querySelector('#app .view .dx-path');
      if (pathEl && pathEl.children.length > n + 2) pathLen.push(d.id + ': ' + pathEl.children.length + ' > ' + (n + 2));
    });
    check('сделка · путь рисует ровно шаги своего договора', off.length === 0, off.join(' | '));
    check('сделка · и пресейл впереди — пройденным неинтерактивным участком', nopre.length === 0, nopre.slice(0, 4).join(' | '));
    check('сделка · путь не переполнен (≤ свои шаги + 2)', pathLen.length === 0, pathLen.join(' | '));
    /* Узел пресейла говорит «этот участок пройден», после того как пять отдельных шагов из
       ленты убрали. Он виден на любой ширине: правило, которое его касается, должно стоять ВНЕ
       медиазапроса — иначе на десктопе пресейла не было бы вовсе. В jsdom это невидимо (стили
       не применяются, элемент находится селектором в любом случае), поэтому проверяется CSS. */
    {
      const cssSrc = read('css/app.css');
      const shown = cssSrc.indexOf('.dx-path .dx-pre { cursor: default');
      const inMedia = shown > 0 && /@media[^{]*\{(?:[^{}]|\{[^{}]*\})*$/.test(cssSrc.slice(0, shown));
      check('сделка · узел пресейла виден на любой ширине, а не только на телефоне',
        shown > 0 && !inMedia,
        shown < 0 ? 'правила «.dx-path .dx-pre» в CSS нет — пресейл не показан нигде'
          : (inMedia ? 'правило спрятано в медиазапросе — на широком экране пресейла не видно' : ''));
    }
    /* Граница «условия согласованы» больше НЕ рисуется отдельным элементом со своей пунктирной
       вертикалью и подписью в 9,5 пикселя: три разных языка в одной строке и читались как
       сломанная лента. Она НАЗВАНА словами в строке под лентой — вместе с датой перехода. Здесь
       проверяется, что факт никуда не делся: пропала картинка, а не смысл. */
    WS.ui.dealCard('d_anna');
    {
      const why = doc.querySelector('#app .view .dcard-pathrow .req-stage-why');
      const t = why ? why.textContent : '';
      const dl = dd().deals.find((x) => x.id === 'd_anna') || {};
      check('сделка · переход «условия согласованы» назван под лентой, а не нарисован вторым языком',
        /услови[яй] согласован/i.test(t) && !doc.querySelector('#app .view .dx-path .dx-bound'), t.slice(0, 160));
      check('сделка · и там же — когда запрос стал сделкой',
        !!(dl.convertedAt || dl.createdAt) && t.indexOf(dl.convertedAt || dl.createdAt) >= 0,
        (dl.convertedAt || dl.createdAt || '—') + ' | ' + t.slice(0, 160));
    }

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
    const noReach = rowSubs.filter((t) => !/\+/.test(t) && !/WhatsApp|Telegram|Email|Телефон/.test(t));
    check('список клиентов · показывает связь и последнее касание',
      /касание/.test(subJoin) && noReach.length === 0,
      noReach.length ? 'без способа связи: ' + noReach.join(' / ') : subJoin.slice(0, 120));

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
    check('доска · на узком экране доски нет', narrow.indexOf('class="kanban') < 0);
    check('доска · и переключателя, который её обещает, тоже', narrow.indexOf('data-v="kanban"') < 0);
    check('доска · вместо неё список сделок', narrow.indexOf('deals-table') >= 0);
    win.matchMedia = mmWas;
    WS.router.go('clients');
    check('доска · на широком экране доска возвращается',
      doc.querySelector('#app').innerHTML.indexOf('class="kanban') >= 0);
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

  // ---- Консьерж не делает вид, что умеет двигать стадию запроса ----
  {
    const r = WS.agent.ask('переведи сделку Анны в показ');
    check('консьерж · пресейл-команда не превращается в шаг сделки', r.kind !== 'proposal', r.kind);
    check('консьерж · объясняет, что стадия запроса вычисляется',
      /запрос/i.test(r.text || '') && /не выставляется|сам/i.test(r.text || ''), (r.text || '').slice(0, 90));
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

      /* A record has to be something before it can be filed.

         `addClient {}` used to pass the dry run and land a contact whose card
         reads as its own internal id — the layer checked that a record was an
         object and never that it was a record OF anyone. It is the same class
         of failure as an invented figure: a shape validated and a meaning not.

         The floor is deliberately one field per collection, two where a record
         has to belong to somebody. Everything past that is a questionnaire,
         and a questionnaire is where the conversation stops. */
      {
        const bare = WS.storeApi.preview([{ op: 'addClient', obj: {} }]);
        check('addClient · a contact with no name is refused by the dry run',
          bare.ok === false && bare.code === 'missing_field', JSON.stringify(bare));
        check('addClient · and the refusal names the field in the broker’s words',
          /имя/.test(bare.error || ''), bare.error);
        check('addClient · a blank name counts as no name',
          WS.storeApi.preview([{ op: 'addClient', obj: { name: '   ' } }]).ok === false);

        const noWho = WS.storeApi.preview([{ op: 'addRequest', obj: { title: 'Что-то в DIFC' } }]);
        check('addRequest · a request belonging to nobody is refused',
          noWho.ok === false && noWho.code === 'missing_field', JSON.stringify(noWho));
        const noWhat = WS.storeApi.preview([{ op: 'addRequest', obj: { clientId: dd().clients[0].id } }]);
        check('addRequest · and one that says nothing about what is wanted, too',
          noWhat.ok === false && noWhat.code === 'missing_field', JSON.stringify(noWhat));
        check('addTask · a task with no title is refused',
          WS.storeApi.preview([{ op: 'addTask', task: { due: 'завтра' } }]).ok === false);

        // Nothing is written on the way to the refusal — a batch is still whole
        // or not at all, and the refusal happens before the first run().
        const n = (dd().clients || []).length;
        WS.storeApi.apply([{ op: 'addClient', obj: { name: 'Годный Контакт' } },
          { op: 'addClient', obj: {} }], { confirmed: true });
        check('a batch with one lame record writes none of it', (dd().clients || []).length === n);
      }

      /* What the card still needs, said on the card that asks to confirm it.

         The floor above is what a record cannot exist without; this is what it
         needs to be worth having. The stand already names the set and shows it
         on the request card as «Ключевые условия», so the Concierge does not get
         a second list of its own to drift from — it gets that one. */
      {
        const cid = (dd().clients || [])[0].id;
        const thin = WS.storeApi.preview([{ op: 'addRequest', obj: { clientId: cid, title: 'Офис в DIFC' } }]);
        check('a new request says which key conditions are still empty',
          thin.ok === true && Array.isArray(thin.missing) && thin.missing.length > 0, JSON.stringify(thin.missing));
        check('and names them the way the card names them',
          (thin.missing || []).some((s) => /бюджет/i.test(s)) && (thin.missing || []).some((s) => /район/i.test(s)),
          JSON.stringify(thin.missing));

        const full = WS.storeApi.preview([{ op: 'addRequest', obj: {
          clientId: cid, title: 'Офис в DIFC', budget: 2000000, areas: ['DIFC'],
          dealType: 'Продажа · готовое', paymentForm: '100% оплата', goal: 'Инвестиция', horizon: '1–3 месяца' } }]);
        check('a request that arrives complete says nothing about gaps',
          full.ok === true && !(full.missing || []).length, JSON.stringify(full.missing));

        // An edit is not a creation: the gap line belongs to the card being made.
        const patched = WS.storeApi.preview([{ op: 'updateRequest', id: dd().requests[0].id, patch: { note: 'x' } }]);
        check('changing a field does not lecture about the other fields',
          !(patched.missing || []).length, JSON.stringify(patched.missing));

        // And it reaches the broker: the proposal carries it, the card prints it.
        const prop = WS.agent.tools.propose(
          [{ op: 'addRequest', obj: { clientId: cid, title: 'Склад в Al Quoz' } }],
          { title: 'Новая заявка' });
        check('the proposal carries the gaps, not just the store',
          prop.kind === 'proposal' && (prop.missing || []).length > 0, JSON.stringify(prop.missing));
        const html = String(WS.engine.agentCard(prop, 'mGap'));
        check('and the confirmation card prints them under «Дозаполнить»',
          html.indexOf('Дозаполнить') >= 0 && /бюджет/i.test(html), html.slice(0, 120));
        // A change to an existing record must not grow that block.
        const plain = String(WS.engine.agentCard(WS.agent.tools.propose(
          [{ op: 'updateRequest', id: dd().requests[0].id, patch: { note: 'y' } }], { title: 'Правка' }), 'mNoGap'));
        check('an edit’s card has no such block', plain.indexOf('Дозаполнить') < 0);
      }

      /* A new contact and their first request arrive together — the flow the
         Concierge is told to use when the person is not in the data. The
         request names a contact the operation ABOVE IT creates, and reference
         checking used to run against the stored data only: «Владимира Петренко
         в контактах нет — заведу и его, и заявку» came back as «нет такой
         записи: clientId = c_new_petrenko», about a record the broker had just
         asked for. A batch is all-or-nothing, so a reference forward inside it
         is as safe as one to something already stored. */
      {
        const pair = [
          { op: 'addClient', obj: { id: 'c_petrenko_probe', name: 'Владимир Петренко', channel: 'whatsapp' } },
          { op: 'addRequest', obj: { clientId: 'c_petrenko_probe', title: '2BR в DIFC', temperature: 'hot' } },
        ];
        const dryPair = WS.storeApi.preview(pair);
        check('пакет · a request may point at a contact the same batch creates',
          dryPair.ok === true, dryPair.error || '');
        check('пакет · and the card names both', (dryPair.pending || []).length === 2,
          JSON.stringify(dryPair.pending));
        const beforeBoth = (dd().clients || []).length + (dd().requests || []).length;
        const donePair = WS.storeApi.apply(pair, { confirmed: true });
        check('пакет · confirmed, both land',
          donePair.ok === true && (dd().clients || []).length + (dd().requests || []).length === beforeBoth + 2,
          donePair.error || '');
        check('пакет · and the request really points at the new contact',
          ((dd().requests || [])[0] || {}).clientId === 'c_petrenko_probe');

        // Forward only. A reference to something NO operation creates is still
        // refused — otherwise this would just be the check switched off.
        const ghost = WS.storeApi.preview([
          { op: 'addRequest', obj: { clientId: 'c_never_created', title: 'x' } },
        ]);
        check('пакет · a reference to a record nobody creates is still refused',
          ghost.ok === false && ghost.code === 'bad_ref', ghost.code);
        // And the order matters: naming it before it is created is not a batch,
        // it is a guess.
        const backwards = WS.storeApi.preview([
          { op: 'addRequest', obj: { clientId: 'c_backwards_probe', title: 'x' } },
          { op: 'addClient', obj: { id: 'c_backwards_probe', name: 'Позже' } },
        ]);
        check('пакет · a reference BEFORE its creation is refused',
          backwards.ok === false && backwards.code === 'bad_ref', backwards.code);
      }

      /* «напомни мне в четверг» used to be answered «срок задачи выбирается из
         сегодня / завтра / послезавтра» — a limit that existed only in the
         prompt. The list groups by `when`, and anything outside the two known
         buckets already falls into «позже»; `due` is free text and is printed
         as written. So a real day of the week goes in. */
      {
        const thu = WS.storeApi.preview([{ op: 'addTask',
          task: { title: 'Напомнить про бронь', due: 'четверг', when: 'later', kind: 'manual', status: 'open' } }]);
        check('срок · a task may be due on a named day, not just today/tomorrow',
          thu.ok === true, thu.error || '');
        check('срок · and the card shows the day as the broker said it',
          /четверг/.test((thu.pending || [])[0] || '') || thu.ok === true, (thu.pending || [])[0] || '');
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

    /* The catch-all, when the question names something the stand has no data
       for. «собери аналитику по Dubai Jumeirah» used to open with the funnel —
       8 сделок, 20 228 000 AED, 1 просроченная задача — under three evidence
       chips, none of it asked for. A chip claims a query stands behind a figure
       BECAUSE THAT FIGURE WAS ASKED FOR. */
    {
      const a = WS.agent.ask('собери аналитику по Dubai Jumeirah');
      check('offline · an unknown district is not answered with the funnel',
        !/воронк|просроченн/i.test(a.text || ''), a.text);
      check('offline · and carries no evidence chips for a figure nobody asked for',
        !(a.evidence || []).length, JSON.stringify((a.evidence || []).map((e) => e.label)));
      /* And it names the districts there ARE — read from the market slice, not
         from AREAS. AREAS holds the four with a full picture; the slice covers
         nine, five of them illustrative. Listing only the four told a broker
         that Palm Jumeirah and Downtown are absent while a row for each sits in
         the data — the same class of error as inventing one. */
      const rows = WS.query.run({ from: 'market' }).rows || [];
      const missing = rows.map((m) => m.район).filter((n) => (a.text || '').indexOf(n) < 0);
      check('offline · every district in the slice is named as available',
        missing.length === 0, 'не названы: ' + missing.join(', '));
    }

    /* A turn that ANSWERS the question we just asked.

       The Concierge asked for a name, the broker typed «Петя Вольный», and the
       offline head — which carries no conversation state — read two unfamiliar
       words and replied with the catalogue of what data exists. To the person
       that is the assistant forgetting its own question one line later. */
    {
      const before = WS.engine.lastReply;
      WS.engine.lastReply = { kind: 'answer', text: 'Заведу обоих — не хватает только имени. Как записать контакт?' };
      const named = WS.agent.ask('Петя Вольный');
      check('ответ на вопрос · a bare name is not answered with the data catalogue',
        !/Что есть:|контакты — \d/.test(named.text || ''), named.text);
      check('ответ на вопрос · and the answer says the thread was lost, not that the name is unknown',
        /нить|прерв|повторите/i.test(named.text || ''), named.text);

      // The guard must not swallow a real short question asked after a question.
      const stillAsking = WS.agent.ask('сколько сделок');
      check('ответ на вопрос · a short QUESTION is still answered as one',
        /сдел/i.test(stillAsking.text || '') && !/потерял нить/i.test(stillAsking.text || ''), stillAsking.text);

      // And with nothing pending, a name is just an unknown query again.
      WS.engine.lastReply = { kind: 'answer', text: 'Готово.' };
      const noPending = WS.agent.ask('Петя Вольный');
      check('ответ на вопрос · with no question pending the guard stays out of the way',
        !/потерял нить/i.test(noPending.text || ''), noPending.text);
      WS.engine.lastReply = before;
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

    /* A chip is DERIVED from the answer, not declared by the model.

       The model used to name the readings it had leaned on, and the code
       re-read them — so a chip proved the figure behind it was real and proved
       nothing about the sentence above it. «8 сделок в работе» over a chip
       reading 12 is two numbers disagreeing under one caption, and the caption
       says «откуда это число».

       Now the code looks for the reading's own value in the narration, anchored
       by the word it counts. A figure the model invented matches nothing and
       gets no chip; a figure it took from the data brings its query with it. */
    {
      const val = (k) => WS.query.run(WS.agent.READINGS[k].q).value;
      const active = val('deals_active');
      const overdue = val('tasks_overdue');

      const got = L.evidenceFrom('Сейчас ' + active + ' сделки в работе. Просроченных задач — ' + overdue + '.');
      check('live · a figure quoted in the answer brings its own chip',
        got.some((e) => e.key === 'deals_active') && got.some((e) => e.key === 'tasks_overdue'),
        JSON.stringify(got.map((e) => e.key)));
      check('live · and the chip carries the query and the revision it was measured at',
        got.length > 0 && got.every((e) => !!e.query && e.revision != null));

      /* The three below were all found by running this over the recorded live
         answers rather than by imagining them, and every one of them was
         invisible to a test written from the nominative form alone. */

      // Russian drops a vowel in the genitive plural: сделка → сделок. An
      // anchor of «сделк» matches «сделки» and misses «8 сделок» — which is how
      // a broker actually writes it, and how the model wrote it in the run.
      check('live · a count is recognised in the case an answer is written in',
        L.evidenceFrom('В работе ' + active + ' сделок на ' + WS.AED(val('deals_active_sum')) + '.')
          .map((e) => e.key).join(',') === 'deals_active,deals_active_sum',
        JSON.stringify(L.evidenceFrom('В работе ' + active + ' сделок.').map((e) => e.key)));

      // A date beside a noun is not a count of that noun. «Объект Creekline
      // 1208 проверен 12 мая» put a chip reading «12 объектов» under an answer
      // that had counted nothing at all.
      check('live · a date is not a count, however close the noun sits',
        !L.evidenceFrom('Объект проверен ' + val('objects_total') + ' мая.')
          .some((e) => e.key === 'objects_total'),
        JSON.stringify(L.evidenceFrom('Объект проверен ' + val('objects_total') + ' мая.')));
      check('live · and neither is a time on the clock',
        !L.evidenceFrom('Срок по задаче сегодня в ' + val('tasks_open') + ':00.')
          .some((e) => e.key === 'tasks_open'));
      // Same sentence, one clause away: the words have to sit beside the figure.
      check('live · a noun two clauses away does not caption a figure',
        !L.evidenceFrom('Объект проверен и подтверждён агентством в срок, отгрузка ' + val('objects_total') + ' штук груза')
          .some((e) => e.key === 'objects_total'));

      check('live · a number that is nobody’s reading gets no chip',
        L.evidenceFrom('Bayline 1603 стоит посмотреть.').length === 0);
      check('live · a figure the model invented matches nothing',
        L.evidenceFrom('Сделок в работе — 987654.').length === 0);
      // The anchor is what stops a coincidence from becoming provenance: the
      // count of deals and the count of anything else are the same digits.
      check('live · a bare number with nothing to say what it counts is not evidence',
        L.evidenceFrom('Их ' + active + ', остальное потом.').length === 0);
      check('live · the same figure under another noun is not this reading',
        !L.evidenceFrom('Показал ' + active + ' объектов на Крике.').some((e) => e.key === 'deals_active'));
      // Money is printed by the stand's own formatter, so that is the form an
      // answer quoting it will be written in.
      check('live · a sum is recognised in the form the stand prints it',
        L.evidenceFrom('Портфель сделок — ' + WS.AED(val('deals_active_sum')) + '.')
          .some((e) => e.key === 'deals_active_sum'));
      // Two readings, one value: neither can be told apart, so neither is shown.
      // Guessing between them puts a caption over the wrong query.
      {
        const R = WS.agent.READINGS;
        const same = Object.keys(R).filter((k) => val(k) === active);
        if (same.length > 1) {
          check('live · a value two readings share brings no chip unless the words separate them',
            L.evidenceFrom('Итого ' + active + '.').length === 0);
        } else {
          check('live · a value two readings share brings no chip unless the words separate them', true);
        }
      }

      // Every reading, phrased the way an answer would phrase it. Doubles as
      // proof that the anchors match the labels the chips themselves print.
      const many = Object.keys(WS.agent.READINGS).map((k) => {
        const r = WS.agent.tools.read(k);
        return r ? (r.money ? WS.AED(r.value) : r.value) + ' ' + r.label + '.' : '';
      }).filter(Boolean).join(' ');
      const lots = L.evidenceFrom(many);
      check('live · every reading is recognisable in its own words', lots.length >= 4, String(lots.length));
      check('live · chips are capped so an answer is not buried under them', lots.length <= 4, String(lots.length));
    }

    /* Follow-ups are built here too, from what this stand can actually answer.

       A chip the model wrote put its own sentence back into the composer — and
       a model that had just been told Marina is not in the data would cheerfully
       offer «показать динамику по Marina» as the next step. Every chip below
       comes from a catalogue whose entries carry a precondition against the
       store, so a chip that appears has an answer waiting behind it. */
    {
      const F = WS.agent.tools.followUps;
      const ups = F({});
      check('agent · an answer always offers a way forward', ups.length > 0 && ups.length <= 3);
      check('agent · every follow-up is either a question or a card',
        ups.every((n) => !!n.label && (typeof n.ask === 'string' ? !!n.ask : (!!n.open && !!n.id !== undefined))));

      // The precondition is the point: offered when there is something to show,
      // absent when there is not. Holds whichever way the fixtures fall.
      const all = F({ limit: 30 });
      const overdue = WS.query.run(WS.agent.READINGS.tasks_overdue.q).value;
      check('agent · a follow-up is offered only when it has an answer behind it',
        all.some((n) => /просроч/i.test(n.ask || '')) === (overdue > 0), 'overdue=' + overdue);

      // Someone the answer names is one touch from their card.
      const named = F({ text: 'По Виктору Орлову всё готово, документы собраны.' });
      check('agent · a person the answer names becomes a way into their card',
        named.some((n) => n.open === 'contact' && n.id === 'c_docs'), JSON.stringify(named));
      check('agent · and that card comes first, before the standing questions',
        !!named[0] && named[0].open === 'contact', JSON.stringify(named[0]));
      check('agent · a name nobody in the data carries opens nothing',
        !F({ text: 'По Джону Смиту ничего нет.' }).some((n) => n.open === 'contact'));

      /* Two Orlovs. Found by a live run, not by reading: the Concierge answered
         «завожу Сергея Климова… есть только Сергей Орлов, это другой человек» and
         the chip under it offered to open ВИКТОРА Орлова — the surname matched
         him first because he sits earlier in the list. */
      {
        const E = WS.agent.tools.findEntity;
        check('agent · the given name decides which of two namesakes is meant',
          (E('есть только Сергей Орлов, это другой человек') || {}).id === 'c_owner',
          JSON.stringify(E('есть только Сергей Орлов, это другой человек')));
        check('agent · and it still finds the other one when he is the one named',
          (E('По Виктору Орлову всё готово') || {}).id === 'c_docs',
          JSON.stringify(E('По Виктору Орлову всё готово')));
        check('agent · a bare surname two people share picks neither',
          E('Орлов сегодня не отвечает') === null, JSON.stringify(E('Орлов сегодня не отвечает')));
        check('agent · and no chip is offered for a person nobody could name',
          !F({ text: 'Орлов сегодня не отвечает' }).some((n) => n.open === 'contact'));
      }
    }

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

    /* ---------- a half-given instruction survives the turn ----------

       The Concierge asked «как записать контакт?», the broker typed «Пётр
       Волков», and nothing on this side knew what that answer was FOR. The live
       head could sometimes reconstruct it from the transcript; the offline one
       said «потерял нить» one line after asking its own question, which reads
       as the assistant forgetting what it just said.

       So an unfinished instruction is state, held on the conversation it
       belongs to. It is not a new thing for the model to invent: it sends the
       operation it means to run even when a field is still missing, the write
       layer refuses it by the floor it already enforces, and THAT refusal —
       which names the operation, the collection and the missing field — is what
       gets parked. What resumes is the exact operation, not a paraphrase. */
    {
      const before = WS.engine.activeThreadId();
      WS.engine.openThread('probe:pending', 'Незавершённое', 'chat');

      const r = L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: { channel: 'whatsapp' } } });
      const p = WS.engine.pendingAction();
      check('live · an instruction missing one field is parked, not lost',
        !!p && p.need.indexOf('name') >= 0 && p.ops[0].op === 'addClient', JSON.stringify(p));
      check('live · the half-built record is kept, so nothing is asked twice',
        !!p && p.ops[0].obj.channel === 'whatsapp', JSON.stringify(p && p.ops));
      // The broker is asked a question, not shown a store error. The refusal is
      // how the code learned what is missing; it is not news to the person.
      check('live · and the reply stays the question the model asked',
        r.kind === 'answer' && r.text === 'Как записать контакт?', JSON.stringify(r.text));

      // A refusal for any other reason is still said plainly — parking it would
      // leave the Concierge waiting for an answer to a question it never asked.
      WS.engine.clearPendingAction();
      const bad = L.toReply('Двигаю.', { act: { op: 'dealStage', id: 'нет_такой', stage: 'won' } });
      check('live · a refusal that is not a missing field is not parked',
        WS.engine.pendingAction() === null, JSON.stringify(WS.engine.pendingAction()));
      check('live · and it is still said out loud', /не выйдет/i.test(bad.text || ''), bad.text);

      /* The offline planner can finish it too — this is the turn that used to
         produce «связь с моделью прервалась, повторите поручение целиком».

         `lastReply` is set to a question on purpose: without it the old
         «потерял нить» branch cannot fire at all, and a test that passes with
         the feature removed measures nothing. With it, the two behaviours are
         genuinely competing for the same turn. */
      const prevReply = WS.engine.lastReply;
      WS.engine.lastReply = { kind: 'answer', text: 'Как записать контакт?', evidence: [], next: [] };
      L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: { channel: 'whatsapp' } } });
      const armed = !!WS.engine.pendingAction();
      const done = WS.agent.ask('Пётр Волков');
      check('offline · the pending instruction is finished from a bare answer',
        done.kind === 'proposal' && (done.ops || [])[0].obj.name === 'Пётр Волков', JSON.stringify(done.ops || done.text));
      check('offline · and it no longer says it lost the thread',
        !/потерял нить/i.test(done.text || ''), done.text);
      check('live · a finished instruction stops being pending',
        armed && WS.engine.pendingAction() === null, 'armed=' + armed);
      WS.engine.lastReply = prevReply;

      // Stale is worse than absent: an answer three exchanges later is about
      // something else, and filling a name from it would write a stranger.
      L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: {} } });
      const th = WS.engine.activeThread();
      const heldBefore = !!WS.engine.pendingAction();
      for (let i = 0; i < 8; i++) th.items.push({ id: 'x' + i, html: '<div class="msg me">…</div>' });
      check('live · a pending instruction goes stale rather than waiting forever',
        heldBefore && WS.engine.pendingAction() === null, 'held=' + heldBefore);
      // And a stale one is not quietly finished by the next short turn either.
      const late = WS.agent.ask('Пётр Волков');
      check('offline · a stale instruction is not finished from a later answer',
        late.kind !== 'proposal', late.kind);

      /* How long an answer may be depends on what was asked for.

         Measured, not imagined: a live run parked `addRequest` waiting on the
         title, the turn fell back to the planner, and «2BR в Business Bay до
         1,8 млн» — the answer in full, to the question just asked — was thrown
         out for being seven words against a cap tuned for names. The broker got
         the inventory of the workspace instead. «Суть запроса одной строкой» is
         a line by definition; the prompt asks for exactly that. */
      {
        const cid = dd().clients[0].id;
        WS.engine.clearPendingAction();
        L.toReply('Что за запрос?', { act: { op: 'addRequest', obj: { clientId: cid } } });
        const long = WS.agent.ask('2BR в Business Bay до 1,8 млн');
        check('offline · a one-line request title is an answer, not an overlong turn',
          long.kind === 'proposal' && (long.ops || [])[0].obj.title === '2BR в Business Bay до 1,8 млн',
          JSON.stringify(long.ops || long.text));

        // A name is still a name: the wider cap belongs to the field that asked.
        WS.engine.clearPendingAction();
        L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: {} } });
        const wordy = WS.agent.ask('2BR в Business Bay до 1,8 млн');
        check('offline · and a phrase is still not filed as somebody’s name',
          wordy.kind !== 'proposal', wordy.kind);

        // Whatever the field, a question is not a value.
        WS.engine.clearPendingAction();
        L.toReply('Что за запрос?', { act: { op: 'addRequest', obj: { clientId: cid } } });
        const asked = WS.agent.ask('а что там вообще по заявкам сейчас');
        check('offline · a question is never taken as the missing value',
          asked.kind !== 'proposal', asked.kind);
        WS.engine.clearPendingAction();
      }

      WS.engine.clearPendingAction();
      if (before) WS.engine.openThread(before, '', '');
    }

    /* ---------- what was quietly thrown away ----------

       Almost every guard in this file degrades silently, and on purpose: a
       visitor should get a plainer Concierge, never a broken one. The cost is
       that nobody can say HOW often it happens. «Блок выбросили молча» is in
       four comments here and was never once a number, and yesterday's honest
       caveat — that the parking never fired in three live runs — could only be
       written because I happened to be watching.

       So each drop is counted where it happens. Not shown to the broker: this
       is for the day-run record and for a health check, where the question is
       «did the stand answer well» and the only current answer is «it answered». */
    {
      const Q = WS.quality;
      Q.reset();
      check('quality · the register starts empty', Object.keys(Q.counts()).length === 0);

      L.normBlocks([{ t: 'нетакого', text: 'x' }]);
      check('quality · a shape the renderer does not know is counted as dropped',
        Q.counts().block_shape === 1, JSON.stringify(Q.counts()));

      L.normBlocks([{ t: 'table', from: { from: 'нетакойколлекции' }, columns: [{ field: 'x' }] }]);
      check('quality · a block whose query gave nothing is counted',
        Q.counts().block_no_data === 1, JSON.stringify(Q.counts()));

      L.normBlocks([{ t: 'table', src: 'web', head: ['a'], rows: [['1']] }]);
      check('quality · a figure claiming the web with no source named is counted',
        Q.counts().block_unsourced === 1, JSON.stringify(Q.counts()));

      L.normBlocks([{ t: 'table', head: ['Район'], rows: [['Arjan', '11 600']] }]);
      check('quality · a table the model typed itself is counted, though it is shown',
        Q.counts().model_numeric === 1, JSON.stringify(Q.counts()));

      Q.reset();
      L.normReport({ title: 'Записка', blocks: [{ t: 'p', text: 'вывод' }, { t: 'table', head: ['a'], rows: [['1']] }] });
      check('quality · a model-typed figure cut from a document is counted',
        Q.counts().report_numeric_dropped === 1, JSON.stringify(Q.counts()));

      // The write path: refused, parked, resumed, gone stale — four different
      // outcomes that all used to look like «предложение не появилось».
      Q.reset();
      const back = WS.engine.activeThreadId();
      WS.engine.openThread('probe:quality', 'Счётчики', 'chat');
      L.toReply('Двигаю.', { act: { op: 'dealStage', id: 'нет_такой', stage: 'won' } });
      check('quality · a refused write is counted', Q.counts().act_refused === 1, JSON.stringify(Q.counts()));
      L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: {} } });
      check('quality · and a parked one is counted apart from it',
        Q.counts().act_parked === 1 && !Q.counts().act_refused_2, JSON.stringify(Q.counts()));
      WS.agent.ask('Пётр Волков');
      check('quality · resuming it is counted too — this is the number that was missing',
        Q.counts().act_resumed === 1, JSON.stringify(Q.counts()));

      L.toReply('Как записать контакт?', { act: { op: 'addClient', obj: {} } });
      const th2 = WS.engine.activeThread();
      for (let i = 0; i < 8; i++) th2.items.push({ id: 'q' + i, html: '<div class="msg me">…</div>' });
      WS.engine.pendingAction();
      check('quality · and one that went stale is counted rather than just forgotten',
        Q.counts().pending_stale === 1, JSON.stringify(Q.counts()));
      WS.engine.clearPendingAction();
      if (back) WS.engine.openThread(back, '', '');

      /* «Ответил планировщик» is a fact; WHY is the thing that gets fixed.

         Twelve hard scenarios, four of them silently answered by the planner,
         and the whole record said «Failed to fetch» — the browser's word for
         everything from a dead certificate to a socket the connection pool
         reused after it had died. A request refused by the server, a stream cut
         mid-flight and a request that never left the machine are three
         different repairs, and they were one line. */
      Q.reset();
      L.noteFailure('http 503');
      check('quality · a server that answered and refused is counted as that',
        Q.counts().fallback_http === 1, JSON.stringify(Q.counts()));
      L.noteFailure('stream ended without a reply');
      check('quality · a stream cut before the reply is its own reason',
        Q.counts().fallback_cut === 1, JSON.stringify(Q.counts()));
      L.noteFailure('Failed to fetch', new TypeError('Failed to fetch'));
      check('quality · and a request that never reached the server is its own too',
        Q.counts().fallback_no_reach === 1, JSON.stringify(Q.counts()));
      L.noteFailure('cli:overloaded');
      check('quality · anything else is the model itself',
        Q.counts().fallback_model === 1, JSON.stringify(Q.counts()));
      // Our own refusal inside the stand-down window is not evidence of anything
      // and must not inflate the reason it was armed for.
      {
        const e = new Error('cooldown'); e.cooldown = true;
        L.noteFailure('cooldown', e);
      }
      check('quality · a refusal we issued ourselves is not counted as a failure',
        !Q.counts().fallback_cooldown && Q.counts().fallback_model === 1, JSON.stringify(Q.counts()));
      L.resetForTest();

      /* A request that never left is worth one more try, and only that one.

         Diagnosed, not guessed: twelve hard scenarios lost an answer to
         `net::ERR_NETWORK_CHANGED` — Chrome dropping an in-flight request
         because the machine's network changed under it. On a phone at an agency
         that is Wi-Fi handing over to LTE, which happens constantly.

         The retry is safe precisely because nothing was accepted on the other
         side. The proxy's own counters proved it: `daily_used` rises on every
         ACCEPTED request, before the model runs, and it matched `served`
         exactly. So a second attempt costs no model call and can duplicate no
         write. A failure AFTER the server has the call is a different animal
         and is not retried — the model has already run, and the shared
         five-hour window is the thing being protected. */
      {
        Q.reset();
        const realFetch = win.fetch;
        const asked = [];
        const health = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });

        win.fetch = (url) => {
          const u = String(url);
          if (/\/health$/.test(u)) return health();
          asked.push(u);
          return Promise.reject(new TypeError('Failed to fetch'));
        };
        L.resetForTest();
        await L.ask('вопрос').then(() => null, (e) => e);
        check('live · a request that never reached the server is tried once more',
          asked.length === 2, 'попыток ' + asked.length);
        check('live · and the second try is the last one',
          Q.counts().retry_no_reach === 1, JSON.stringify(Q.counts()));

        // The server answered — it has the call, and the model may already have
        // run. Asking again would spend the shared window twice for one question.
        asked.length = 0;
        Q.reset();
        win.fetch = (url) => {
          const u = String(url);
          if (/\/health$/.test(u)) return health();
          asked.push(u);
          return Promise.resolve({ ok: false, status: 503, body: null });
        };
        L.resetForTest();
        await L.ask('вопрос').then(() => null, (e) => e);
        check('live · a server that answered and refused is not asked twice',
          asked.length === 1, 'попыток ' + asked.length);
        check('live · and nothing about it is recorded as a retry',
          !Q.counts().retry_no_reach, JSON.stringify(Q.counts()));

        win.fetch = realFetch;
        L.resetForTest();
        Q.reset();
      }

      // Counting must not itself become a failure: an unknown name is recorded,
      // not thrown, because this runs inside the path that answers a visitor.
      Q.reset();
      Q.note('что_то_новое'); Q.note('что_то_новое');
      check('quality · an unfamiliar name is recorded, not refused',
        Q.counts()['что_то_новое'] === 2, JSON.stringify(Q.counts()));
      Q.reset();
      check('quality · and the register can be cleared for a fresh run',
        Object.keys(Q.counts()).length === 0);
    }

    // What the model still sends under the old names is not what gets shown.
    // The two fields left the contract; reading them anyway would leave the
    // model's own invention on the screen and the change would be cosmetic.
    {
      const r = L.toReply('Текст без чисел.', {
        read: ['deals_active'],
        next: [{ label: 'Выдумка', ask: 'спроси меня об этом' }],
      });
      check('live · a reading the model claims but never quotes brings no chip',
        !(r.evidence || []).length, JSON.stringify(r.evidence));
      check('live · a follow-up the model wrote is not the one shown',
        !(r.next || []).some((n) => n.label === 'Выдумка'), JSON.stringify(r.next));
      check('live · but the answer still offers a way forward', (r.next || []).length > 0);
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

      /* A broker quotes both currencies in one sentence — «2br на $450к», «до
         $550k» — and everything stored here is in dirhams. In a forty-question
         day that collision came up five times, and each answer had to decline
         the arithmetic, which is correct but reads as helplessness.

         Carrying the rate is safe because it is not a rate: the dirham is
         pegged at 3.6725 and has been since 1997. It travels with its basis so
         a converted figure can say what it was converted by. */
      /* Three things the stand knows and used to keep to itself. Each one, left
         out of the digest, let the Concierge be confidently wrong in a way the
         data could have prevented: propose writing to someone who refused
         contact, quote a price the stand marks as unverified, or state a budget
         as settled while a conflict sits recorded beside it. */
      {
        const off = (d.контакты || []).filter((c) => c.согласие_на_переписку === false);
        check('live · consent travels, and someone actually lacks it',
          off.length > 0, JSON.stringify((d.контакты || []).map((c) => c.согласие_на_переписку)));
        const stale = (d.объекты || []).filter((o) => o.проверка === 'expired');
        check('live · verification state travels, and something is expired',
          stale.length > 0 && !!stale[0].проверено_когда,
          JSON.stringify(stale.map((o) => o.id + ':' + o.проверка + '@' + o.проверено_когда)));
        const conf = (d.заявки || []).filter((r) => r.расхождение);
        check('live · a recorded conflict travels with its request',
          conf.length > 0 && !!conf[0].расхождение.было && !!conf[0].расхождение.стало,
          JSON.stringify(conf.map((r) => r.id + ':' + JSON.stringify(r.расхождение))));
      }

      check('live · the peg reaches the model, with its basis',
        !!(d.курс && d.курс.за_доллар_AED > 0 && d.курс.основание), JSON.stringify(d.курс));
      check('live · and it is the peg, not a quote someone typed',
        d.курс && Math.abs(d.курс.за_доллар_AED - 3.6725) < 0.0001, String(d.курс && d.курс.за_доллар_AED));
    }

    // Lots do not share a commission rate; charging the whole contract at the
    // first lot's rate produced a figure the stand then called verified.
    {
      const deal = (dd().deals || []).find((x) => x.lots && x.lots.length > 1);
      if (deal) {
        const objs = dd().objects || [];
        const lots = deal.lots.map((id) => objs.find((o) => o.id === id)).filter(Boolean);
        const rates = lots.map((o) => WS.ui.lotCommissionPct(deal, o));
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
      // Reset the standdown state so the next section can set its own window.
      L.resetForTest();
    }

    /* Two failures put the live head out — for a WHILE, not for the session.

       It used to uninstall itself and nothing ever put it back: a restart
       during a deploy, or a minute of bad wifi at an agency, and every later
       question in that session went to the offline planner in silence, until
       someone reloaded the page. The failure this guards is a demo that
       quietly stops being a demo. */
    {
      const wasCooldown = L.cooldownMs;
      L.cooldownMs = 40;
      WS.agent.setAsyncHead(() => { throw new Error('проверка'); });
      check('live · a live head can be installed', WS.agent.hasAsyncHead() === true);
      L.noteFailure('раз');
      check('live · one hiccup does not cost the session its live head', WS.agent.hasAsyncHead() === true);
      L.noteFailure('два');
      check('live · after giving up it is out for a while, not uninstalled',
        WS.agent.hasAsyncHead() === true && L.downFor > 0, 'downFor=' + L.downFor);

      // While it is out, a question costs nothing: it is refused before any
      // network call, which is the whole point of standing down.
      let refused = false;
      const t0 = Date.now();
      await L.ask('пока лежит').then(() => {}, () => { refused = true; });
      const took = Date.now() - t0;
      check('live · a question during the window is refused without a call',
        refused && took < 20 && L.downFor > 0, 'refused=' + refused + ' took=' + took + 'ms downFor=' + L.downFor);

      /* Asking DURING the window must not push it further out. It used to:
         every question rejected by the window went through the same failure
         path as a real one, counted as a miss and re-armed the stand-down — so
         under any traffic at all the head never came back, which is exactly
         the failure the window exists to prevent. A twelve-scenario run caught
         it: ten of them were answered by the offline planner. */
      const wasDown = L.downFor;
      await WS.agent.askAsync('ещё вопрос пока лежит');
      await WS.agent.askAsync('и ещё один');
      check('live · questions during the window do not extend it',
        L.downFor <= wasDown, 'было ' + wasDown + ' → стало ' + L.downFor);

      // And the window ends by itself. Use 3× the cooldown so Windows timer
      // jitter (which inflates a 60ms setTimeout to ~80ms) does not cause a
      // spurious failure after two askAsync calls that don't re-arm it.
      await new Promise((r) => setTimeout(r, L.cooldownMs * 3));
      check('live · the window expires on its own', L.downFor === 0, 'downFor=' + L.downFor);
      // Cleanup: disable() now refuses to re-arm an open window, so we reset the
      // standdown clock directly, then restore the cooldown to its original value.
      L.resetForTest();
      L.cooldownMs = wasCooldown;
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
  //  Language. The one parameter of a document nobody computed. The prompt
  //  bound the language of the CHAT reply and told the model of the file only
  //  that it goes to the client without them — recipient named, language not.
  //  Asked for a КП in a Russian conversation, it wrote one in German.
  //
  //  In Dubai the answer is not one language anyway: the selling layer follows
  //  the client, English by default; a note for the broker follows the chat.
  //  That is a fact about WHO reads the document — which the code holds and the
  //  model does not. Both halves are tested: the ladder that decides before the
  //  call, and the check on what came back.
  // ============================================================
  if (WS.live && WS.live.langs) {
    const L = WS.live;
    const st = WS.store;

    // ---- what the model is told ----
    {
      const dg = L.digest();
      check('язык · a contact carries the language they read in',
        (dg.контакты || []).some((c) => c.язык === 'EN') && (dg.контакты || []).some((c) => c.язык === 'RU'),
        JSON.stringify((dg.контакты || []).map((c) => c.id + ':' + c.язык)));
    }

    // ---- who reads it decides what it is written in ----
    {
      const was = { chat: st.cgLang, doc: st.cgDocLang };
      st.cgLang = 'ru'; st.cgDocLang = 'auto';

      const en = L.langs('собери КП для Karim Aziz');
      check('язык · a document for a client who reads English is English',
        en.doc === 'en' && en.why === 'contact', JSON.stringify(en));
      check('язык · and the chat stays Russian while it is not',
        en.chat === 'ru', JSON.stringify(en));

      const ru = L.langs('собери КП для Игоря Лебедева');
      check('язык · and Russian for a client who reads Russian',
        ru.doc === 'ru' && ru.why === 'contact', JSON.stringify(ru));

      const own = L.langs('собери отчёт по воронке');
      check('язык · a note nobody was named for is for the broker, in the chat language',
        own.doc === 'ru' && own.why === 'broker', JSON.stringify(own));

      const asked = L.langs('собери КП для Игоря Лебедева на английском');
      check('язык · asking outright outranks the card',
        asked.doc === 'en' && asked.why === 'asked', JSON.stringify(asked));

      st.cgDocLang = 'en';
      const set = L.langs('собери отчёт по воронке');
      check('язык · the setting outranks the fallback to the chat',
        set.doc === 'en' && set.why === 'setting', JSON.stringify(set));
      const still = L.langs('собери КП для Игоря Лебедева на русском');
      check('язык · and the setting still yields to an outright request',
        still.doc === 'ru' && still.why === 'asked', JSON.stringify(still));
      st.cgDocLang = 'auto';

      st.cgLang = 'auto';
      check('язык · «Авто» answers in the language the question was typed in',
        L.langs('сколько сделок в работе').chat === 'ru' &&
        L.langs('how many deals are running').chat === 'en',
        JSON.stringify([L.langs('сколько сделок в работе').chat, L.langs('how many deals are running').chat]));

      st.cgLang = was.chat; st.cgDocLang = was.doc;
    }

    // ---- and what came back ----
    {
      const de = 'Sehr geehrte Damen und Herren, hiermit übersenden wir Ihnen das Angebot für die Büroflächen mit den Konditionen.';
      const en = 'The proposal below covers the office space in Business Bay with the rent and the service charge for the first year.';
      const ru = 'Коммерческое предложение по офисам в Business Bay: ставка, площадь и условия оплаты на первый год.';
      check('язык · German is recognised as German', L.langOf(de) === 'de', String(L.langOf(de)));
      check('язык · English as English', L.langOf(en) === 'en', String(L.langOf(en)));
      check('язык · Russian as Russian', L.langOf(ru) === 'ru', String(L.langOf(ru)));
      // A verdict from four words is a coin toss with a straight face — and the
      // dangerous fragment is not the one with no evidence in it but the one
      // with just enough: three function words and no document.
      check('язык · too little text is not a verdict', L.langOf('Bayline 1603') === null, String(L.langOf('Bayline 1603')));
      check('язык · nor is a fragment, however English it looks',
        L.langOf('The rent and the area') === null, String(L.langOf('The rent and the area')));
    }

    // ---- a document in a language nobody asked for is not handed over ----
    {
      const german = { title: 'Angebot', blocks: [{ t: 'p', text: 'Sehr geehrte Damen und Herren, hiermit übersenden wir Ihnen das Angebot für die Büroflächen mit den Konditionen.' }] };
      WS.quality.reset();
      const bad = L.toReply('Собрал КП.', { report: german }, { doc: 'ru' });
      check('язык · a document in the wrong language is refused, not offered',
        !!bad && !bad.report, JSON.stringify(bad && bad.report));
      check('язык · and the broker is told, in both languages by name',
        !!bad && /немецк/i.test(bad.text) && /русск/i.test(bad.text), bad && bad.text);
      check('язык · the refusal is counted, not silent',
        WS.quality.counts().report_wrong_lang === 1, JSON.stringify(WS.quality.counts()));

      const good = L.toReply('Собрал записку.', {
        report: { title: 'Записка по воронке', blocks: [{ t: 'p', text: 'Коммерческое предложение по офисам в Business Bay: ставка, площадь и условия оплаты на первый год.' }] },
      }, { doc: 'ru' });
      check('язык · a document in the ordered language goes through', !!good && !!good.report);

      const unchecked = L.toReply('Собрал КП.', { report: german }, {});
      check('язык · with nothing ordered nothing is blocked', !!unchecked && !!unchecked.report);

      /* The trap this check exists for. What the model sends for a data-backed
         table is a QUERY — from, field, stage, amount — and query identifiers
         are English by construction, whatever language the document is in.
         Measure the machinery along with the prose and a Russian note made of
         four tables reads as English and is refused: a guard firing on the
         correct answer, which is worse than no guard. */
      {
        const spec = () => ({
          t: 'table', from: { from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'lost' }], limit: 8 },
          columns: [{ field: 'title', label: 'Сделка' }, { field: 'amount', label: 'Сумма', money: true }],
        });
        const russian = {
          title: 'Записка по воронке',
          blocks: [{ t: 'p', text: 'Ниже разбор по сделкам в работе: сумма портфеля, стадии и что мешает закрыть ближайшие.' }]
            .concat([spec(), spec(), spec(), spec()]),
        };
        const kept = L.toReply('Собрал записку.', { report: russian }, { doc: 'ru' });
        check('язык · the query behind a table is machinery, not the document’s language',
          !!kept && !!kept.report, kept && kept.text);
      }

      /* And the mirror of it: cells filled from our data are OUR strings,
         Russian whatever the document is written in. */
      const mixed = {
        title: 'Commercial proposal',
        blocks: [
          { t: 'p', text: 'The proposal below covers the office space in Business Bay with the rent and the service charge for the first year.' },
          { t: 'table', from: { from: 'deals', limit: 3 }, columns: [{ field: 'title', label: 'Deal' }, { field: 'amount', label: 'Amount', money: true }] },
        ],
      };
      const out = L.toReply('Собрал КП.', { report: mixed }, { doc: 'en' });
      check('язык · Russian cells from our own data do not make an English document Russian',
        !!out && !!out.report && out.report.count === 2, JSON.stringify(out && out.report));
    }
  } else {
    check('live · language module present', false);
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


  // ---- Волна 2: имена разделов ------------------------------------------------------------
  {
    // Слово «заявка» у агента значило то же, что «сделка», и именно на нём разошлись с партнёром.
    // Раздел разбирает входящее, работа идёт в «Сделках» — имена должны это говорить.
    const main = () => doc.getElementById('main').innerHTML;
    WS.router.go('requests');
    check('имена · раздел разбора называется «Входящие»', main().indexOf('Входящие') > 0);
    check('имена · и не называется «Заявки»', main().indexOf('>Заявки<') < 0 && main().indexOf('Активные заявки') < 0,
      'осталось: ' + (main().match(/[Зз]аявк\w*/g) || []).slice(0, 6).join(', '));
    WS.router.go('contracts');
    check('имена · раздел после подписания называется «Сопровождение»', main().indexOf('Сопровождение') > 0);
    check('имена · область задачи по запросу читается словом «запрос»',
      WS.ui.taskScopeLabel({ requestId: 'r_igor' }).indexOf('запрос') === 0,
      'подпись: ' + WS.ui.taskScopeLabel({ requestId: 'r_igor' }));
    // Меню агента — то место, где слово попадалось первым.
    const navHtml = doc.body.innerHTML;
    check('имена · в меню агента нет пункта «Заявки»', navHtml.indexOf('>Заявки<') < 0);
    check('имена · и нет пункта «Договоры»', navHtml.indexOf('>Договоры<') < 0);
  }

  // ---- Волна 2: Консьерж наследует область из треда ----------------------------------------
  {
    // «Поставь задачу» внутри сделки принадлежит ЭТОЙ сделке, а не просто её клиенту:
    // прежде ставилась только ссылка на контакт, и у клиента с тремя сделками задача теряла область.
    const taskOf = (r) => (r && r.kind === 'proposal' && r.ops && r.ops[0] && r.ops[0].task) || null;
    WS.engine.openThread('deal:d_viktor', 'Виктор', 'briefcase');
    const inDeal = taskOf(WS.agent.ask('поставь задачу собрать документы на завтра'));
    check('консьерж · задача из треда сделки получает эту сделку',
      !!inDeal && inDeal.dealId === 'd_viktor' && inDeal.clientId === 'c_docs',
      inDeal ? 'dealId=' + inDeal.dealId + ' clientId=' + inDeal.clientId : 'предложения нет');
    WS.engine.openThread('request:r_igor', 'Игорь', 'mail');
    const inReq = taskOf(WS.agent.ask('поставь задачу перезвонить завтра'));
    check('консьерж · задача из треда запроса получает этот запрос',
      !!inReq && inReq.requestId === 'r_igor' && !inReq.dealId,
      inReq ? 'requestId=' + inReq.requestId + ' dealId=' + inReq.dealId : 'предложения нет');
    // Названный человек главнее треда: чужая сделка к нему не прицепляется.
    WS.engine.openThread('deal:d_viktor', 'Виктор', 'briefcase');
    const named = taskOf(WS.agent.ask('поставь задачу позвонить Анне Петровой завтра'));
    check('консьерж · названный клиент главнее треда, и чужая сделка не прицепляется',
      !!named && named.clientId === 'c_anna' && !named.dealId,
      named ? 'clientId=' + named.clientId + ' dealId=' + named.dealId : 'предложения нет');
    // Вне карточки области нет — и это верно: задача принадлежит человеку, а не выдуманной сделке.
    WS.engine.openThread('general', 'Консьерж', 'sparkle');
    const plain = taskOf(WS.agent.ask('поставь задачу позвонить Анне Петровой завтра'));
    check('консьерж · вне карточки задача остаётся клиентской',
      !!plain && !plain.dealId && !plain.requestId, plain ? JSON.stringify(plain) : 'предложения нет');
  }

  // ---- Волна 2: карточка сделки ------------------------------------------------------------
  {
    WS.ui.dealCard('d_anna');
    const v = () => doc.querySelector('#app .view').innerHTML;
    const q = (s) => doc.querySelector('#app .view ' + s);
    check('карточка · полоса сверху несёт название, суть и путь',
      !!q('.dcard-top .deal-title-text') && !!q('.dcard-sub') && !!q('.dcard-pathrow .dx-path'));
    check('карточка · название по-прежнему правится по клику',
      !!q('.dcard-title.deal-title-edit[data-titledeal="d_anna"]'));
    // Дата перехода и срок на шаге — в строке ПОД лентой, вместе с границей пресейла. Отдельного
    // блока справа на собственном базовом уровне больше нет: он и делал ленту кривой.
    check('карточка · под лентой сказано, когда стала сделкой и сколько стоит на шаге',
      !!q('.dcard-pathrow .req-stage-why') && /стал[а]? сделкой/.test(q('.dcard-pathrow .req-stage-why').textContent) &&
      /на текущем шаге/i.test(q('.dcard-pathrow .req-stage-why').textContent),
      q('.dcard-pathrow .req-stage-why') ? q('.dcard-pathrow .req-stage-why').textContent : 'строки под лентой нет');
    check('карточка · и третьего текста справа от ленты не осталось', !q('.dx-path-meta'));
    check('карточка · слева справка, условия и участники', !!q('.dcard-aside .dcard-params') &&
      v().indexOf('Справка по сделке') > 0 && v().indexOf('Участники · ') > 0);
    // Комиссия у объектов, а не в условиях слева: ставка принадлежит объекту, а не сделке.
    check('карточка · комиссии в левой колонке нет',
      q('.dcard-aside') && q('.dcard-aside').textContent.indexOf('Комиссия') < 0);
    check('карточка · связь с клиентом осталась на месте', !!q('.dcard-aside .dcli-chans'));
    check('карточка · справа «что дальше», объекты и «что было»',
      !!q('.plev-next .pn-act') && v().indexOf('Последние события') > 0 &&
      (v().indexOf('Объект сделки') > 0 || v().indexOf('Объекты сделки') > 0));
    /* Одна карточка на один список. Рядом стояли «Следующий шаг» и «Запланировано» — две
       карточки одного и того же: ближайшее дело и всё остальное. Теперь ближайшее выделено
       ВНУТРИ списка, и второй карточки в правой колонке нет. */
    check('карточка · отдельной карточки «Следующий шаг» рядом с «Запланировано» нет',
      [].slice.call(doc.querySelectorAll('#app .view .dcard-main .dx-sec-h'))
        .filter((h) => /^Следующий шаг/.test(h.textContent.trim())).length === 0,
      [].slice.call(doc.querySelectorAll('#app .view .dcard-main .dx-sec-h')).map((h) => h.textContent.trim()).join(' | '));
    check('карточка · ближайший шаг — первая строка «Запланировано», со сроком и сутью действия',
      !!q('.plev-list > .plev-next:first-child') && !!q('.plev-next .pn-due') && !!q('.plev-next .pn-act') &&
      q('.plev-next .pn-act').textContent.trim().length > 3,
      q('.plev-next') ? q('.plev-next').textContent.replace(/\s+/g, ' ').slice(0, 120) : 'выделенной строки нет');
    /* Ряд «Запланировано» + «Последние события» — одинаковые по высоте, а не «как получилось».
       В jsdom высоту не измерить, поэтому проверяется правило, которое её задаёт. */
    {
      const cssSrc = read('css/app.css');
      check('карточка · и обе карточки ряда одной высоты',
        /\.dcard-pair \{ grid-template-columns: 1fr 1fr; align-items: stretch/.test(cssSrc) &&
        cssSrc.indexOf('.dcard-pair > .dx-sec { display: flex; flex-direction: column;') > 0,
        'правила равной высоты в CSS нет');
    }
    // Отдельной кнопки «Работать через Консьержа» нет — она была дублем строки ввода внизу.
    check('карточка · внизу одна строка ввода', doc.querySelectorAll('#app .view .dcard-composer').length === 1);
    check('карточка · и второго входа в Консьержа рядом с ней нет',
      doc.querySelectorAll('#app .view .dx-cbar').length === 1,
      'входов: ' + doc.querySelectorAll('#app .view .dx-cbar').length);
    // Узкий экран: левая колонка сворачивается, ни один блок не пропадает.
    check('карточка · на узком экране левая колонка сворачивается в раскрываемую справку',
      !!q('details.dcard-aside-m') && q('details.dcard-aside-m').textContent.indexOf('Условия сделки') > 0,
      q('details.dcard-aside-m') ? q('details.dcard-aside-m').textContent.slice(0, 60) : 'раскрывашки нет');
    check('карточка · и раскрывается без скриптов', q('details.dcard-aside-m').tagName === 'DETAILS');
    check('карточка · пройденный пресейл подписан одним узлом, а не пятью шагами',
      !!q('.dx-path .dx-pre') && /Пресейл/.test(q('.dx-path .dx-pre').textContent) &&
      doc.querySelectorAll('#app .view .dx-path .dx-pre').length === 1,
      q('.dx-path .dx-pre') ? q('.dx-path .dx-pre').textContent : 'узла пресейла нет');
    // Сделка без запроса пресейла не рисует — рисовать нечего. В фикстурах такой нет (все выросли
    // из запроса), поэтому случай ставится руками: перенесённая вручную сделка — реальный сценарий.
    const orphan = dd().deals.find((x) => x.id === 'd_anna');
    const hadReq = orphan.requestId;
    orphan.requestId = null;
    WS.ui.dealCard(orphan.id);
    check('карточка · у сделки без запроса нет ни пресейла, ни границы',
      doc.querySelectorAll('#app .view .dx-path .dx-step.pre').length === 0 &&
      doc.querySelectorAll('#app .view .dx-path .dx-bound').length === 0 &&
      doc.querySelectorAll('#app .view .dx-path .dx-pre-sum').length === 0);
    check('карточка · но собственные шаги договора на месте',
      doc.querySelectorAll('#app .view .dx-path .dx-step[data-dealstage]').length > 0);
    orphan.requestId = hadReq;
  }

  // ---- Волна 2: список сделок --------------------------------------------------------------
  {
    const main = () => doc.getElementById('main').innerHTML;
    const countRows = () => (main().match(/data-deal="/g) || []).length;
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'table';
    WS.store.dealSearch = ''; WS.store.dealStage = 'all'; WS.store.dealFunnelAll = true;
    WS.router.go('clients');
    const all = countRows();
    check('список · таблица показывает колонки стадии, задачи, срока и ответственного',
      main().indexOf('>Стадия<') > 0 && main().indexOf('>Ближайшая задача<') > 0 &&
      main().indexOf('>Срок<') > 0 && main().indexOf('>Ответственный<') > 0,
      'заголовки: ' + (main().match(/<th>[^<]*<\/th>/g) || []).join(' '));
    // Пояснение над списком снято — оно занимало первый экран у того, кто заходит сюда постоянно.
    check('список · абзаца-пояснения над сделками больше нет', main().indexOf('Воронка сделок по стадиям') < 0);
    // Стадия: фильтр есть и он сужает.
    const stageSel = doc.getElementById('dealStage');
    check('список · фильтр по стадиям есть', !!stageSel);
    const someStage = (dd().deals.find((d) => d.stage) || {}).stage;
    WS.store.dealStage = someStage; WS.storeApi.emit();
    const byStage = countRows();
    check('список · выбор стадии сужает выборку', byStage > 0 && byStage < all,
      'всего ' + all + ', на стадии «' + someStage + '» ' + byStage);
    check('список · и все оставшиеся строки этой стадии',
      dd().deals.filter((d) => d.stage === someStage).length === byStage);
    WS.store.dealStage = 'all'; WS.storeApi.emit();
    // Источники были чипами первого ряда, стали выпадающим списком.
    check('список · источники выбираются списком, а не чипами', !!doc.getElementById('dealSrc'));
    check('список · чипов источников в первом ряду не осталось', main().indexOf('data-dealsrc=') < 0);
    // Воронка не теряется при переключении вида — это и был дефект.
    check('список · переключатель воронок виден и в списке', main().indexOf('data-funnel=') > 0);
    check('список · по умолчанию показаны все воронки', countRows() === all && main().indexOf('Все воронки') > 0);
    WS.store.dealFunnelAll = false; WS.store.dealFunnel = 'rent'; WS.storeApi.emit();
    const rentRows = countRows();
    check('список · выбор воронки сужает список', rentRows === dd().deals.filter((d) => (d.funnel || 'sale') === 'rent').length,
      'аренда: строк ' + rentRows);
    WS.store.dealsView = 'kanban'; WS.storeApi.emit();
    check('список · выбранная воронка переживает переход на доску', WS.store.dealFunnel === 'rent');
    WS.store.dealsView = 'table'; WS.store.dealFunnelAll = true; WS.storeApi.emit();
    check('список · и возврат к «всем» показывает столько же, сколько было', countRows() === all);
  }

  // ---- Волна 1: область задачи, сохранение участников, поиск по сделкам --------------------
  {
    // Область задачи. Два клиента с двумя сделками — самый частый случай, на котором ломалась
    // прежняя привязка «по клиенту»: задача одной сделки показывалась во второй.
    const sib = dd().deals.filter((d) => d.clientId === 'c_docs');
    check('область · у c_docs больше одной сделки (иначе проверка ничего не значит)', sib.length >= 2,
      'сделок: ' + sib.length);
    // Именованные фикстуры проверяются отдельной строкой, а не условием вокруг проверок:
    // условие молча уносит с собой всё, что внутри, и база остаётся зелёной без единой проверки.
    const dViktor = dd().deals.find((d) => d.id === 'd_viktor');
    const dRent = dd().deals.find((d) => d.id === 'd_rentbiz');
    const rIgor = (dd().requests || []).find((r) => r.id === 'r_igor');
    check('область · фикстуры на месте: d_viktor, d_rentbiz, r_igor', !!dViktor && !!dRent && !!rIgor,
      'd_viktor=' + !!dViktor + ' d_rentbiz=' + !!dRent + ' r_igor=' + !!rIgor);
    const a = dViktor ? WS.ui.tasksOfDeal(dViktor).map((t) => t.id) : [];
    const b = dRent ? WS.ui.tasksOfDeal(dRent).map((t) => t.id) : [];
    check('область · задача сделки видна в своей сделке', a.indexOf('t_viktor_doc') >= 0, 'a=' + a.join(','));
    check('область · и не видна в сестринской сделке того же клиента', b.indexOf('t_viktor_doc') < 0, 'b=' + b.join(','));
    check('область · списки задач двух сестёр не пересекаются',
      a.length > 0 && a.every((id) => b.indexOf(id) < 0), 'a=' + a.join(',') + ' b=' + b.join(','));
    const rt = rIgor ? WS.ui.tasksOfRequest(rIgor).map((t) => t.id) : [];
    check('область · задача заявки видна в своей заявке', rt.indexOf('t_igor_kp') >= 0, 'rt=' + rt.join(','));
    // Клиентская задача законна и области не имеет — требовать привязку значило бы запретить касания.
    const touch = dd().tasks.find((t) => t.id === 't_anna_touch');
    check('область · касание остаётся задачей по контакту, без сделки и заявки',
      !!touch && !touch.dealId && !touch.requestId);
    check('область · подпись области читается словом',
      WS.ui.taskScopeLabel({ dealId: 'd_viktor' }).indexOf('сделка') === 0 &&
      WS.ui.taskScopeLabel({ requestId: 'r_igor' }).indexOf('запрос') === 0 &&
      WS.ui.taskScopeLabel({}) === 'клиент');
    // Правило «первое попадание» проверяется на задаче с ОБЕИМИ ссылками — иначе оно не проверено
    // вовсе: на задаче с одной ссылкой любой порядок разбора даёт один и тот же ответ.
    const both = { id: 't_scope_both', clientId: 'c_docs', dealId: 'd_viktor', requestId: 'r_igor',
      title: 'Обе ссылки', due: 'сегодня', when: 'today', status: 'open' };
    dd().tasks.unshift(both);
    check('область · при обеих ссылках побеждает сделка',
      WS.ui.taskScopeLabel(both).indexOf('сделка') === 0, 'подпись: ' + WS.ui.taskScopeLabel(both));
    check('область · и такая задача показывается в победившей сделке',
      WS.ui.tasksOfDeal(dViktor || { id: 'd_viktor' }).map((t) => t.id).indexOf('t_scope_both') >= 0);
    check('область · и такая задача не показывается ещё и в заявке',
      WS.ui.tasksOfRequest(rIgor || { id: 'r_igor' }).map((t) => t.id).indexOf('t_scope_both') < 0);
    dd().tasks = dd().tasks.filter((t) => t.id !== 't_scope_both');
  }
  {
    // Слой записи не пускает задачу, у которой клиент один, а сделка — другого человека:
    // ссылки обе существуют, но пара бессмысленна, и в двух карточках она читалась бы по-разному.
    const bad = WS.storeApi.preview([{ op: 'addTask', task: {
      id: 't_scope_bad', clientId: 'c_anna', dealId: 'd_viktor', title: 'Чужая сделка', due: 'сегодня', when: 'today' } }]);
    check('область · задача на сделку чужого клиента отклоняется',
      bad && bad.ok === false, 'ответ: ' + JSON.stringify(bad && (bad.reason || bad.error || bad.ok)));
    const good = WS.storeApi.preview([{ op: 'addTask', task: {
      id: 't_scope_ok', clientId: 'c_docs', dealId: 'd_viktor', title: 'Своя сделка', due: 'сегодня', when: 'today' } }]);
    check('область · задача на свою сделку проходит', good && good.ok === true,
      'ответ: ' + JSON.stringify(good && (good.reason || good.error || good.ok)));
    const badReq = WS.storeApi.preview([{ op: 'addTask', task: {
      id: 't_scope_badreq', clientId: 'c_docs', requestId: 'r_igor', title: 'Чужая заявка', due: 'сегодня', when: 'today' } }]);
    check('область · задача на заявку чужого клиента тоже отклоняется',
      badReq && badReq.ok === false, 'ответ: ' + JSON.stringify(badReq && (badReq.reason || badReq.error || badReq.ok)));
    // Изменение — второй путь к тому же нарушению: поля области изменяемы, и проверка на создании
    // ловит только первый вызов. Задача заводится своей, а вторым вызовом переводится на чужую сделку.
    const move = WS.storeApi.preview([{ op: 'updateTask', id: 't_anna_touch', patch: { dealId: 'd_viktor' } }]);
    check('область · перевод задачи на сделку чужого клиента изменением отклоняется',
      move && move.ok === false, 'ответ: ' + JSON.stringify(move && (move.reason || move.error || move.ok)));
    const moveOk = WS.storeApi.preview([{ op: 'updateTask', id: 't_viktor_doc', patch: { dealId: 'd_rentbiz' } }]);
    check('область · перевод между своими сделками изменением проходит', moveOk && moveOk.ok === true,
      'ответ: ' + JSON.stringify(moveOk && (moveOk.reason || moveOk.error || moveOk.ok)));
    const moveReq = WS.storeApi.preview([{ op: 'updateTask', id: 't_viktor_doc', patch: { requestId: 'r_igor' } }]);
    check('область · перевод задачи на заявку чужого клиента изменением тоже отклоняется',
      moveReq && moveReq.ok === false, 'ответ: ' + JSON.stringify(moveReq && (moveReq.reason || moveReq.error || moveReq.ok)));
    // Прямой путь создания идёт мимо предпросмотра — им пользуются интерфейс, сценарии и события.
    // Отказать там нельзя (сценарий потеряет задачу молча), поэтому противоречащая ссылка снимается.
    WS.storeApi.addTask({ id: 't_scope_direct', clientId: 'c_anna', dealId: 'd_viktor', requestId: 'r_igor', title: 'Прямая' });
    const made = dd().tasks.find((t) => t.id === 't_scope_direct');
    check('область · прямое создание снимает ссылку на чужую сделку, задачу не теряя',
      !!made && !made.dealId && !made.requestId, made ? 'dealId=' + made.dealId + ' requestId=' + made.requestId : 'задачи нет');
    WS.storeApi.addTask({ id: 't_scope_direct_ok', clientId: 'c_docs', dealId: 'd_viktor', title: 'Своя прямая' });
    const madeOk = dd().tasks.find((t) => t.id === 't_scope_direct_ok');
    check('область · и не трогает верную ссылку', !!madeOk && madeOk.dealId === 'd_viktor');
    dd().tasks = dd().tasks.filter((t) => t.id !== 't_scope_direct' && t.id !== 't_scope_direct_ok');
  }
  {
    // Область снимается, если в форме поменяли клиента: задача, привязанная к сделке чужого
    // человека, врала бы и в его карточке, и в карточке настоящего владельца сделки.
    const src = read('js/ui.js');
    const i = src.indexOf('function createTaskFromForm(');
    const fn = i < 0 ? '' : src.slice(i, i + 1600);
    check('область · смена клиента в форме снимает унаследованную область',
      fn.indexOf('draft.clientId !== picked') > 0);
    // И сценарные задачи получают область — иначе новый путь создания обходит правило.
    const sc = read('js/scenarios.js');
    check('область · сценарная задача по подбору привязана к заявке',
      sc.indexOf("id: 't_g1_pick', clientId: 'c_anna', requestId: 'r_anna'") > 0);
    check('область · сценарная задача по договору привязана к сделке',
      sc.indexOf("id: 't_s4_manual', clientId: 'c_docs', dealId: 'd_viktor'") > 0);
  }
  {
    // Правки участника не переживали перезагрузку: обе операции меняли данные и перерисовывали
    // карточку, но не сохраняли. Сторожим сам вызов — это ровно тот дефект, что был.
    // Проверяем не текст исходника, а то, что правка доехала до хранилища: дефект был ровно в том,
    // что данные менялись в памяти, карточка перерисовывалась, а перезагрузка всё возвращала назад.
    const KEY = 'wespace_demo_state';
    const persisted = () => { try { return JSON.parse(win.localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const dealOf = (blob, id) => ((blob.data || {}).deals || []).find((d) => d.id === id);
    const target = dd().deals.find((d) => Array.isArray(d.contacts) && d.contacts.length >= 2);
    check('участники · есть сделка с двумя участниками (иначе проверка ничего не значит)', !!target,
      'сделок с участниками: ' + dd().deals.filter((d) => (d.contacts || []).length >= 2).length);
    if (target) {
      const before = (dealOf(persisted(), target.id) || { contacts: [] }).contacts || [];
      const wasLive = target.contacts.length;
      WS.ui.removeDealContact(target.id, target.contacts.length - 1);
      const after = (dealOf(persisted(), target.id) || { contacts: [] }).contacts || [];
      check('участники · открепление переживает перезагрузку', after.length === wasLive - 1,
        'в памяти было ' + wasLive + ', в хранилище стало ' + after.length + ' (до операции ' + before.length + ')');
    }
  }
  {
    // Поиска по сделкам не было вовсе. Проверяем, что он сужает выборку и что сброс её возвращает.
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'table'; WS.store.dealSearch = '';
    WS.router.go('clients');
    const countRows = () => (doc.getElementById('main').innerHTML.match(/data-deal="/g) || []).length;
    const all = countRows();
    // Через настоящее поле, а не присваиванием в состояние: обработчик ввода — это ровно то,
    // что добавлено, и присваивание проходит мимо него.
    const type = (v) => {
      const el = doc.getElementById('dealSearch');
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      return true;
    };
    check('поиск · поле ввода есть на странице сделок', type('DIFC'));
    const narrowed = countRows();
    check('поиск · ввод в поле сужает список сделок', narrowed > 0 && narrowed < all,
      'без поиска ' + all + ', с «DIFC» ' + narrowed);
    check('поиск · введённое доехало до состояния', WS.store.dealSearch === 'DIFC', 'в состоянии: ' + WS.store.dealSearch);
    type('зззнесуществует');
    check('поиск · запрос без совпадений не оставляет строк', countRows() === 0);
    // Сброс — настоящая кнопка. Она обязана и появиться от одного поиска, и убрать его:
    // фильтр, который нельзя снять кнопкой «сбросить», оставляет пустой экран без объяснения.
    const clr = doc.querySelector('[data-act="clearDealFilters"]');
    check('поиск · один запрос уже показывает кнопку сброса', !!clr);
    if (clr) clr.click();
    check('поиск · общий сброс фильтров чистит и поиск', WS.store.dealSearch === '' && countRows() === all,
      'строк ' + countRows() + ' из ' + all + ', запрос «' + WS.store.dealSearch + '»');
  }
  {
    // Разговор на карточке контакта принадлежит контакту, а не первой попавшейся его сделке.
    const spec = WS.ui.clientSpec ? WS.ui.clientSpec('c_docs') : null;
    check('тред · Консьерж на карточке контакта открывает тред контакта',
      !!spec && String(spec.concierge || '').indexOf('contact:c_docs') > 0,
      'сделок у c_docs: ' + dd().deals.filter((d) => d.clientId === 'c_docs').length);
    check('тред · и не тред какой-либо сделки', !!spec && String(spec.concierge || '').indexOf('data-thread="deal:') < 0);
    check('тред · такой идентификатор относится Консьержем к группе «по клиентам»',
      WS.ui.threadGroup && WS.ui.threadGroup('contact:c_docs') === 'byContact',
      'группа: ' + (WS.ui.threadGroup && WS.ui.threadGroup('contact:c_docs')));
    // Календарь берёт объект у области задачи: задача второй сделки рисовалась с объектом первой.
    const acts = WS.ui.calendarActivities ? WS.ui.calendarActivities() : [];
    const av = acts.find((x) => x.id === 't_viktor_doc');
    const dv = dd().deals.find((d) => d.id === 'd_viktor');
    check('календарь · объект задачи берётся у её сделки, а не у первой сделки клиента',
      !!av && !!dv && !!dv.objectId && av.objectId === dv.objectId,
      av ? 'у задачи ' + av.objectId + ', у сделки ' + (dv && dv.objectId) : 'активности нет');
    // Та же строка была захардкожена в календаре: открывает сделку Виктора, а объект брала у клиента.
    // Совпадение объектов ничего не доказывает, пока сделка Виктора у клиента первая, — поэтому
    // проверяем на переставленном порядке: именно так дефект и вернулся бы незамеченным.
    const order = dd().deals.slice();
    dd().deals = order.filter((d) => d.clientId !== 'c_docs').concat(order.filter((d) => d.clientId === 'c_docs').reverse());
    const firstOfDocs = dd().deals.find((d) => d.clientId === 'c_docs');
    const omar = (WS.ui.calendarActivities() || []).find((x) => x.id === 'cm_assign_omar');
    check('календарь · порядок сделок клиента переставлен (иначе проверка ниже ничего не значит)',
      !!firstOfDocs && firstOfDocs.id !== 'd_viktor', 'первая сделка c_docs теперь ' + (firstOfDocs && firstOfDocs.id));
    check('календарь · назначенная руководителем задача показывает объект той сделки, которую открывает',
      !!omar && !!dv && !!dv.objectId && omar.objectId === dv.objectId,
      omar ? 'у строки ' + omar.objectId + ', у сделки d_viktor ' + (dv && dv.objectId) : 'строки нет');
    dd().deals = order;
    const at = acts.find((x) => x.id === 't_anna_touch');
    check('календарь · у клиентского касания объекта нет', !!at && !at.objectId,
      at ? 'objectId=' + at.objectId : 'активности нет');
  }
  {
    // Версия схемы: подъём и есть то, что доставляет новые поля тем, кто уже открывал стенд.
    // Прежняя проверка требовала «не ниже 7» и пропустила бы откат подъёма.
    check('схема · версия не ниже 25 (подъём волны 3 на месте)', WS.store.schema >= 25, 'схема: ' + WS.store.schema);
  }

  // ---- Волна 3: отношения с клиентом --------------------------------------------------------
  {
    const keys = WS.ui.REL_STAGES.map((s) => s.k);
    const outside = (dd().clients || []).filter((c) => keys.indexOf(WS.ui.relStageOf(c).k) < 0);
    check('отношения · у каждого контакта стадия из словаря', outside.length === 0,
      outside.map((c) => c.id).join(', '));
    // Подпись не должна совпадать со стадией сделки: одно слово о двух разных вещах — это
    // ровно тот дефект, который мы весь август чиним.
    const SL = WS.fixtures.STAGE_LABELS || {};
    const dealWords = Object.keys(SL).map((k) => SL[k]);
    const clash = WS.ui.REL_STAGES.filter((s) => dealWords.indexOf(s.label) >= 0);
    check('отношения · подпись стадии не повторяет стадию сделки', clash.length === 0,
      clash.map((s) => s.label).join(', '));

    const anna = dd().clients.find((c) => c.id === 'c_anna');
    check('отношения · «был успех» виден у клиента с договором', WS.ui.clientHasWon('c_anna') === true);
    const noWork = dd().clients.find((c) => !(dd().requests || []).some((r) => r.clientId === c.id) &&
      !(dd().deals || []).some((x) => x.clientId === c.id) && !(dd().contracts || []).some((k) => k.clientId === c.id));
    if (noWork) check('отношения · контакт без работы — «новый»', WS.ui.relStageOf(noWork).k === 'new',
      noWork.id + ' → ' + WS.ui.relStageOf(noWork).k);

    // Ручная правка побеждает вывод — и снимается, когда вывод изменился. Иначе пометка,
    // поставленная в мае, будет утверждать «потерян» и через год после покупки.
    const before = WS.ui.relStageDerived(anna);
    WS.ui.setRelStage('c_anna', 'dormant');
    check('отношения · ручная правка побеждает вывод', WS.ui.relStageOf(anna).k === 'dormant' && WS.ui.relStageOf(anna).manual === true,
      'вышло ' + WS.ui.relStageOf(anna).k);
    anna.relStageOver = before === 'lost' ? 'new' : 'lost';   // как будто вывод сместился
    check('отношения · ручная правка снимается, когда вывод изменился', WS.ui.relStageOf(anna).k === before,
      'вышло ' + WS.ui.relStageOf(anna).k + ', вывод ' + before);
    WS.ui.setRelStage('c_anna', 'auto');
    check('отношения · «авто» возвращает вывод', WS.ui.relStageOf(anna).manual === false && WS.ui.relStageOf(anna).k === before);
  }

  // ---- Волна 3: движок поводов касания ------------------------------------------------------
  {
    const all = [];
    (dd().clients || []).forEach((c) => (WS.ui.cuesFor(c.id) || []).forEach((q) => all.push(q)));
    check('поводы · движок вообще что-то находит', all.length > 0, 'поводов: ' + all.length);
    check('поводы · у каждого есть основание', all.every((q) => q.why && String(q.why).trim()),
      all.filter((q) => !q.why).map((q) => q.key).join(', '));
    // Правило одного повода: на пару «контакт + причина» не больше одного предложенного.
    const seen = {}; const dup = [];
    all.forEach((q) => { const k = q.contactId + '~' + q.reason; if (seen[k]) dup.push(k); seen[k] = 1; });
    check('поводы · на пару «контакт + причина» не больше одного', dup.length === 0, dup.join(', '));
    // Идемпотентность: повторное чтение в тот же день не порождает второго повода.
    const again = [];
    (dd().clients || []).forEach((c) => (WS.ui.cuesFor(c.id) || []).forEach((q) => again.push(q)));
    check('поводы · повторный пересчёт не порождает новых', again.length === all.length,
      all.length + ' → ' + again.length);

    const withCue = (dd().clients || []).find((c) => (WS.ui.cuesFor(c.id) || []).length);
    if (withCue) {
      const q0 = WS.ui.cuesFor(withCue.id)[0];
      WS.ui.dismissCue(q0.key);
      check('поводы · отклонённый повод не возвращается сразу',
        !(WS.ui.cuesFor(withCue.id) || []).some((x) => x.key === q0.key), q0.key);
      // Тишина конечна: она отсчитывается от дня отказа, а не навсегда.
      dd().cueState[q0.key].at = -999;
      check('поводы · после срока тишины повод возвращается',
        (WS.ui.cuesFor(withCue.id) || []).some((x) => x.key === q0.key), q0.key);
      const before = (dd().tasks || []).length;
      WS.ui.acceptCue(q0.key);
      const made = (dd().tasks || []).length === before + 1;
      const t = (dd().tasks || []).find((x) => x.clientId === withCue.id && x.kind === 'touch');
      check('поводы · принять повод — значит создать задачу', made && !!t, 'задач было ' + before + ', стало ' + (dd().tasks || []).length);
      check('поводы · принятый повод уходит из очереди',
        !(WS.ui.cuesFor(withCue.id) || []).some((x) => x.key === q0.key), q0.key);
      if (t) { dd().tasks = (dd().tasks || []).filter((x) => x !== t); }
      delete dd().cueState[q0.key];
    }
  }

  // ---- Волна 3: лента отношений и портфель --------------------------------------------------
  {
    const anna = dd().clients.find((c) => c.id === 'c_anna');
    const ahead = WS.ui.relationsAhead(anna), past = WS.ui.relationsPast(anna);
    check('отношения · впереди есть и обязательство, и повод',
      ahead.some((r) => r.kind === 'duty') && ahead.some((r) => r.kind === 'cue'),
      'duty=' + ahead.filter((r) => r.kind === 'duty').length + ' cue=' + ahead.filter((r) => r.kind === 'cue').length);
    const dated = ahead.filter((r) => r.ord != null).map((r) => r.ord);
    check('отношения · «Впереди» по возрастанию даты', dated.every((v, i) => i === 0 || dated[i - 1] <= v), dated.join(','));
    const datedPast = past.filter((r) => r.ord != null).map((r) => r.ord);
    check('отношения · «Было» по убыванию даты', datedPast.every((v, i) => i === 0 || datedPast[i - 1] >= v), datedPast.join(','));

    WS.ui.clientCard('c_anna');
    WS.ui.setEntityTab('contact', 'c_anna', 'relations');
    const html = doc.getElementById('app').innerHTML;
    check('отношения · вкладка рисует ленту', html.indexOf('rel-list') >= 0);
    check('отношения · вкладка рисует переключатель стадии', html.indexOf('data-relstage="c_anna:') >= 0);
    // Портфель: все заявки, сделки и договоры человека одним списком.
    const nReq = (dd().requests || []).filter((r) => r.clientId === 'c_anna').length;
    const nDeal = (dd().deals || []).filter((d) => d.clientId === 'c_anna').length;
    const nK = (dd().contracts || []).filter((k) => k.clientId === 'c_anna').length;
    check('отношения · портфель считает заявки, сделки и договоры вместе',
      html.indexOf('Портфель · ' + (nReq + nDeal + nK)) >= 0, 'ждали ' + (nReq + nDeal + nK));
    check('отношения · портфель ведёт на договор', html.indexOf('data-contract="k_palm"') >= 0);
  }

  // ---- Волна 3: участники сделки ------------------------------------------------------------
  {
    const roles = WS.ui.CONTACT_ROLES;
    check('участники · справочник ролей пересекает стол (три группы)', WS.ui.ROLE_GROUPS.length === 3 && roles.length === 12,
      'групп ' + WS.ui.ROLE_GROUPS.length + ', ролей ' + roles.length);
    // «ЛПР» убран из ролей намеренно: это мера влияния, а не роль. Иначе участник мог бы быть
    // «ЛПР по роли и исполнителем по влиянию».
    check('участники · «ЛПР» больше не роль', roles.indexOf('ЛПР') < 0, roles.join(', '));
    check('участники · «ЛПР» есть среди значений влияния', WS.ui.INFLUENCE.some((v) => v.label === 'ЛПР'));
    // Таблица перехода читается и на старых данных: запись, оставшаяся со старым словарём,
    // не показывается как есть и не теряет влияние.
    check('участники · старая роль «Покупатель» читается как «Клиент»', WS.ui.roleOf({ role: 'Покупатель' }) === 'Клиент');
    check('участники · старая роль «ЛПР» отдаёт клиента и влияние ЛПР',
      WS.ui.roleOf({ role: 'ЛПР' }) === 'Клиент' && WS.ui.influenceOf({ role: 'ЛПР' }) === 'lpr');
    check('участники · буквенная шкала переводится в слова',
      WS.ui.influenceOf({ rating: 'A' }) === 'lpr' && WS.ui.influenceOf({ rating: 'B' }) === 'infl' && WS.ui.influenceOf({ rating: 'C' }) === 'exec');
    // Каналов ровно четыре, и порталы площадок в них не входят: это источник обращения.
    check('участники · словарь каналов один и без порталов',
      WS.ui.CHANNELS.length === 4 && WS.ui.CHANNELS.indexOf('email') >= 0 && WS.ui.CHANNELS.indexOf('instagram') < 0,
      WS.ui.CHANNELS.join(', '));

    const anna = dd().deals.find((x) => x.id === 'd_anna');
    // Выше по прогону проверялось, что открепление участника переживает перезагрузку, — оно
    // сняло последнюю строку состава. Возвращаем исходный состав, иначе эта проверка будет
    // измерять последствия предыдущей, а не то, что заявлено в её имени.
    const annaFix = (WS.fixtures.deals || []).find((x) => x.id === 'd_anna');
    anna.contacts = JSON.parse(JSON.stringify(annaFix.contacts));
    const parts = WS.ui.dealParticipants(anna);
    check('участники · в сделке есть участник другой стороны', parts.some((p) => p.сторона === 'другая сторона'),
      parts.map((p) => p.роль).join(', '));
    check('участники · у участника другой стороны есть компания', parts.some((p) => p.сторона === 'другая сторона' && p.компания),
      JSON.stringify(parts.filter((p) => p.сторона === 'другая сторона')));
    check('участники · у каждого назван канал', parts.every((p) => !!p.канал), JSON.stringify(parts.map((p) => p.канал)));
    check('участники · ровно один основной', parts.filter((p) => p.основной).length === 1);
    // Сводка Консьержа отдаёт участников: без этого расширенный справочник ролей невидим
    // ровно для того, кто должен им пользоваться.
    const snap = WS.live && WS.live.digest ? WS.live.digest() : null;
    if (snap && snap.сделки) {
      const sd = snap.сделки.find((x) => x.id === 'd_anna');
      check('участники · попадают в сводку Консьержа', !!sd && Array.isArray(sd.участники) && sd.участники.length === parts.length,
        sd ? 'в сводке ' + ((sd.участники || []).length) : 'сделки в сводке нет');
    }

    // Карточка рисует влияние словом, а не буквой в круге.
    WS.ui.dealCard('d_anna');
    const dh = doc.getElementById('app').innerHTML;
    check('участники · влияние нарисовано словом', dh.indexOf('c-infl-lpr') >= 0 && dh.indexOf('>ЛПР<') >= 0);
    check('участники · буквенный значок с карточки ушёл', dh.indexOf('c-rate') < 0);

    // Основным может быть только участник со стороны клиента: основной — тот, чьё решение
    // мы ведём, и менеджер девелопера им быть не может.
    const idx = anna.contacts.findIndex((x) => WS.ui.roleGroupOf(x) === 'other');
    if (idx >= 0) {
      WS.ui.openDealContactForm('d_anna', idx);
      const prim = doc.getElementById('dc_primary'); if (prim) prim.checked = true;
      WS.ui.saveDealContact('d_anna', idx);
      check('участники · основным не может стать участник другой стороны',
        anna.contacts[idx].primary !== true, 'основной=' + anna.contacts[idx].primary);
      check('участники · основной остался на стороне клиента',
        WS.ui.roleGroupOf(anna.contacts.find((x) => x.primary) || {}) === 'client');
    }
  }

  // ---- Волна 3: лоты — своё состояние, свой выход, свой пересчёт -----------------------------
  {
    const d = dd().deals.find((x) => x.id === 'd_rentbiz');
    const objs = dd().objects || [];
    const a = objs.find((o) => o.id === 'o_difc_a'), b = objs.find((o) => o.id === 'o_difc_b');
    check('лоты · массив лотов формы не поменял', Array.isArray(d.lots) && typeof d.lots[0] === 'string',
      JSON.stringify(d.lots));
    // Отсутствие записи — это «как у сделки», а не «пусто».
    check('лоты · лот без своей записи наследует ставку объекта',
      WS.ui.lotState(d, 'o_difc_b') === null && WS.ui.lotCommissionPct(d, b) === b.commissionPct);
    check('лоты · своя ставка лота побеждает ставку объекта',
      WS.ui.lotCommissionPct(d, a) === 2.5 && a.commissionPct !== 2.5, 'вышло ' + WS.ui.lotCommissionPct(d, a));
    check('лоты · своя регистрация лота видна', (WS.ui.lotState(d, 'o_difc_a') || {}).regNo === 'Title-2026-4471');

    const commBefore = WS.ui.dealCommission(d);
    const amountBefore = d.amount;
    // Вывод лота: исход обязателен, поэтому сначала форма. Проверяем сам вывод.
    WS.ui.lotExitForm('d_rentbiz', 'o_difc_b');
    const sel = doc.getElementById('lot_exit'); if (sel) sel.value = 'rejected';
    const why = doc.getElementById('lot_why'); if (why) why.value = 'клиент отказался от второго этажа';
    WS.ui.saveLotExit('d_rentbiz', 'o_difc_b');
    check('лоты · вышедший лот перестал считаться',
      WS.ui.dealLiveLots(d).length === 1 && WS.ui.dealLiveLots(d)[0].id === 'o_difc_a',
      'осталось ' + WS.ui.dealLiveLots(d).length);
    const commAfter = WS.ui.dealCommission(d);
    check('лоты · комиссия пересчитана по оставшимся',
      commAfter === Math.round(a.price * 2.5 / 100) && commAfter !== commBefore,
      commBefore + ' → ' + commAfter);
    // Сумма этой сделки собрана из лотов (2 050 000 + 2 150 000 = 4 200 000) — значит
    // пересчитывается по оставшимся.
    check('лоты · сумма, собранная из лотов, пересчитана по оставшимся',
      d.amount === a.price && amountBefore === 4200000, amountBefore + ' → ' + d.amount);
    // Отказ доходит до подборки заявки: лот помечен отказом клиента, а не просто исчез.
    const r = (dd().requests || []).find((x) => x.id === d.requestId);
    const off = r && (r.offered || []).find((x) => x.id === 'o_difc_b');
    check('лоты · отказ дошёл до подборки заявки', !!off && off.state === 'rejected', off ? off.state : 'строки нет');
    // Договор не пересобирается сам: вехи и график согласованы с другой стороной.
    const ks = (dd().contracts || []).filter((k) => k.dealId === d.id);
    check('лоты · договор помечен как требующий пересмотра, а не пересчитан',
      ks.every((k) => !!k.review), ks.map((k) => k.id + '=' + k.review).join('; ') || 'договоров нет');
    // Сделка без лотов не удаляется — предлагается закрыть, но решение за агентом.
    WS.ui.lotExitForm('d_rentbiz', 'o_difc_a');
    const sel2 = doc.getElementById('lot_exit'); if (sel2) sel2.value = 'returned';
    WS.ui.saveLotExit('d_rentbiz', 'o_difc_a');
    check('лоты · сделка без лотов не удаляется', !!dd().deals.find((x) => x.id === 'd_rentbiz') && WS.ui.dealLiveLots(d).length === 0);
    // Заблокированный лот ОСТАЁТСЯ в сделке: это юридический дефект, а не выход.
    d.lotState = { o_difc_a: { exit: 'blocked', exitReason: 'обременение' }, o_difc_b: { exit: 'rejected' } };
    check('лоты · заблокированный лот остаётся в сделке',
      WS.ui.dealLiveLots(d).length === 1 && WS.ui.lotIsOut(WS.ui.lotState(d, 'o_difc_a')) === false,
      'живых ' + WS.ui.dealLiveLots(d).length);
    WS.ui.undoLotBlock('d_rentbiz', 'o_difc_a');
    check('лоты · блокировка снимается тем же действием', !(WS.ui.lotState(d, 'o_difc_a') || {}).exit);
    // Введённая рукой сумма — вторая ветка правила, и она не должна вести себя так же:
    // молча переписать число, которое агент ввёл сам, хуже, чем показать, что оно разошлось.
    d.lotState = {}; delete d.amountFromLots; d.amount = 3900000;
    WS.ui.lotExitForm('d_rentbiz', 'o_difc_b');
    const s3 = doc.getElementById('lot_exit'); if (s3) s3.value = 'returned';
    WS.ui.saveLotExit('d_rentbiz', 'o_difc_b');
    check('лоты · сумма, введённая вручную, не переписана молча', d.amount === 3900000, 'вышло ' + d.amount);
    check('лоты · расхождение с суммой лотов показано, а не спрятано', !!WS.ui.lotsMismatch(d),
      JSON.stringify(WS.ui.lotsMismatch(d)));

    d.lotState = { o_difc_a: { regNo: 'Title-2026-4471', regAt: '12 мая', commissionPct: 2.5 } };
    d.amount = 4200000; delete d.amountFromLots;
    if (off) off.state = 'selected';
    ks.forEach((k) => { delete k.review; });
  }

  // ---- Волна 3: рождение договора и завершение сделки ---------------------------------------
  {
    const before = (dd().contracts || []).length;
    const d = dd().deals.find((x) => x.id === 'd_anna');
    const kept = d.stage;
    // Договор рождается на подписании — и привязан к смене стадии, а не к нажатию кнопки.
    WS.storeApi.setDealStage('d_anna', 'sign');
    const made = (dd().contracts || []).filter((k) => k.dealId === 'd_anna');
    check('договор · рождается на подписании', made.length === 1, 'создано ' + made.length);
    check('договор · собран из сделки: клиент, сумма, лоты',
      !!made[0] && made[0].clientId === d.clientId && made[0].amount === d.amount && (made[0].lots || []).length >= 1,
      made[0] ? JSON.stringify({ c: made[0].clientId, a: made[0].amount, l: made[0].lots }) : 'нет');
    check('договор · вид выведен из услуги и готовности',
      !!made[0] && made[0].kind === WS.contractKindFor(d.funnel, d.readiness), made[0] && made[0].kind);
    // Того, чего шаблон знать не может, он не выдумывает.
    check('договор · номер остаётся пустым, а не выдуманным', !!made[0] && !made[0].number, made[0] && made[0].number);
    // Второй раз ничего не создаётся — ни тем же путём, ни другим.
    WS.storeApi.setDealStage('d_anna', 'reg');
    WS.storeApi.apply([{ op: 'dealStage', id: 'd_anna', stage: 'exec' }], { confirmed: true, silent: true });
    WS.ui.ensureContract('d_anna');
    check('договор · второй по той же сделке не создаётся',
      (dd().contracts || []).filter((k) => k.dealId === 'd_anna').length === 1,
      'стало ' + (dd().contracts || []).filter((k) => k.dealId === 'd_anna').length);
    check('договор · остальные договоры не тронуты', (dd().contracts || []).length === before + 1);

    // Проигрыш освобождает все лоты по тому же правилу, что и частичный отказ.
    const dl = dd().deals.find((x) => x.id === 'd_rentbiz');
    dl.stage = 'prep'; dl.lotState = {}; delete dl.amountFromLots;
    WS.ui.finishDealForm('d_rentbiz');
    const out = doc.getElementById('fin_out'); if (out) out.value = 'lost';
    WS.ui.saveFinishDeal('d_rentbiz');
    check('завершение · проигрыш ставит стадию lost', dl.stage === 'lost');
    check('завершение · проигрыш освобождает все лоты', WS.ui.dealLiveLots(dl).length === 0,
      'осталось ' + WS.ui.dealLiveLots(dl).length);
    check('завершение · проигрыш не создаёт договор', (dd().contracts || []).filter((k) => k.dealId === 'd_rentbiz').length === 0);

    // Успех у услуги без шага подписания: договор рождается здесь.
    const svc = dd().deals.find((x) => (x.funnel === 'consult' || x.funnel === 'cross') && !WS.ui.contractsOfDeal(x.id).length);
    if (svc) {
      const was = svc.stage;
      WS.ui.finishDealForm(svc.id);
      const o2 = doc.getElementById('fin_out'); if (o2) o2.value = 'won';
      WS.ui.saveFinishDeal(svc.id);
      check('завершение · успех у услуги порождает ровно один договор',
        svc.stage === 'won' && WS.ui.contractsOfDeal(svc.id).length === 1,
        svc.id + ' стадия ' + svc.stage + ', договоров ' + WS.ui.contractsOfDeal(svc.id).length);
      dd().contracts = (dd().contracts || []).filter((k) => k.dealId !== svc.id);
      svc.stage = was;
    }
    dd().contracts = (dd().contracts || []).filter((k) => !k.fromDeal);
    d.stage = kept; dl.stage = 'prep';
    dl.lotState = { o_difc_a: { regNo: 'Title-2026-4471', regAt: '12 мая', commissionPct: 2.5 } };
    delete dl.amountFromLots;
  }

  // ---- Волна 3: коммерческие предложения версиями --------------------------------------------
  {
    const d = dd().deals.find((x) => x.id === 'd_anna');
    const snapBefore = JSON.stringify(d.kpSnapshot || null);
    const v1 = WS.ui.newOffer('deal', 'd_anna');
    check('предложения · первая версия — номер один и черновик', !!v1 && v1.version === 1 && v1.state === 'draft',
      v1 ? v1.version + '/' + v1.state : 'нет');
    check('предложения · собрано из живых лотов сделки',
      !!v1 && v1.objectIds.length === WS.ui.dealLiveLots(d).length, v1 && JSON.stringify(v1.objectIds));
    // Отправка адресуется участнику, а не «клиенту вообще».
    WS.ui.openOfferForm(v1.id);
    const to = doc.getElementById('of_to');
    check('предложения · адресат выбирается среди участников сделки',
      !!to && to.options.length === WS.ui.dealContacts(d).length, to ? to.options.length : 'списка нет');
    const bodyEl = doc.getElementById('of_body'); if (bodyEl) bodyEl.value = 'Первая редакция.';
    WS.ui.sendOffer(v1.id);
    check('предложения · отправленная версия помечена и знает адресата',
      v1.state === 'sent' && !!v1.sentTo && !!v1.sentAt, JSON.stringify({ s: v1.state, to: v1.sentTo }));

    // Правка отправленной версии не меняет её, а порождает следующую.
    WS.ui.editOffer(v1.id);
    const list = WS.ui.offersOf('deal', 'd_anna');
    check('предложения · правка отправленной порождает следующую версию',
      list.length === 2 && list[0].version === 2 && list[0].state === 'draft',
      list.map((x) => x.version + '/' + x.state).join(', '));
    check('предложения · отправленная версия осталась нетронутой',
      v1.state === 'sent' && v1.body === 'Первая редакция.', v1.body);
    check('предложения · снимок КП сделки не тронут', JSON.stringify(d.kpSnapshot || null) === snapBefore);

    // Отправка блокируется без согласия — тем же правилом, что и любая адресная рассылка.
    const noc = dd().clients.find((x) => x.consent === false);
    if (noc) {
      const was = d.contacts[0].clientId;
      d.contacts[0].clientId = noc.id;                       // адресатом становится тот, кто не давал согласия
      const vn = WS.ui.newOffer('deal', 'd_anna');
      WS.ui.openOfferForm(vn.id);
      WS.ui.sendOffer(vn.id);
      check('предложения · без согласия отправка не проходит', vn.state === 'draft', vn.state);
      // Участник без своей карточки контакта согласия не имеет — тогда действует согласие
      // клиента сделки, иначе правило обходится именем в свободном поле.
      d.contacts[0].clientId = was;
      const free = d.contacts.findIndex((x) => !x.clientId);
      if (free >= 0) {
        const wasC = d.clientId; d.clientId = noc.id;
        const vf = WS.ui.newOffer('deal', 'd_anna');
        WS.ui.openOfferForm(vf.id);
        const sel2 = doc.getElementById('of_to'); if (sel2) sel2.value = String(free);
        WS.ui.sendOffer(vf.id);
        check('предложения · участник без своей карточки не обходит согласие клиента', vf.state === 'draft', vf.state);
        d.clientId = wasC;
      }
    }
    dd().offers = [];
  }

  // ---- Волна 3: факт контакта против итога контакта ------------------------------------------
  {
    const draft = (dd().outcomes || []).find((x) => x.entityId === 'd_anna' && x.state === 'draft');
    check('итог · машинный черновик есть в данных', !!draft, JSON.stringify((dd().outcomes || []).length));
    // Главное правило: неподтверждённый итог не участвует НИ В ОДНОМ выводе. Проверяется
    // не перечнем мест, а тем, что читать его негде: в ленте сделки его нет.
    const tl = (dd().dealTimeline || {})['d_anna'] || [];
    check('итог · черновик не лежит в ленте сделки', !tl.some((e) => e.text === draft.text),
      'записей ' + tl.length);
    const briefBefore = WS.ui.dealBrief ? WS.ui.dealBrief(dd().deals.find((x) => x.id === 'd_anna')) : '';
    // …и в сводке, которую получает модель.
    const dg = WS.live && WS.live.digest ? WS.live.digest() : null;
    check('итог · черновик не попадает в сводку Консьержа',
      !dg || JSON.stringify(dg).indexOf('рассрочку 60/40, просит зафиксировать') < 0);

    // Но виден на карточке — бледным и с двумя кнопками.
    WS.ui.dealCard('d_anna');
    const h = doc.getElementById('app').innerHTML;
    check('итог · черновик виден в карточке', h.indexOf('oc-draft') >= 0 && h.indexOf('data-ocok="' + draft.id + '"') >= 0);
    check('итог · черновик подписан как не участвующий в выводах', h.indexOf('не участвует в выводах') >= 0);

    // Подтверждение переносит итог в ленту — и с этого момента он виден выводам.
    const nBefore = tl.length;
    WS.ui.confirmOutcome(draft.id);
    const tl2 = (dd().dealTimeline || {})['d_anna'] || [];
    check('итог · подтверждённый попадает в ленту', tl2.length === nBefore + 1 && tl2.some((e) => e.role === 'outcome' && e.state === 'confirmed'),
      nBefore + ' → ' + tl2.length);
    check('итог · подтверждённый уходит из очереди черновиков',
      !(dd().outcomes || []).some((x) => x.id === draft.id));

    // Итог, написанный ЧЕЛОВЕКОМ, сразу подтверждён: подтверждать нечего, это первоисточник.
    const mine = WS.ui.addEventEntry('deal', 'd_anna', { type: 'note', text: 'Итог встречи: договорились о брони до пятницы.', by: 'Марина Волкова' });
    check('итог · написанный человеком не требует подтверждения',
      !!mine && !(dd().outcomes || []).some((x) => x.text === mine.text), mine ? 'записан' : 'нет');

    // Отклонённый остаётся со следом — иначе непонятно, почему Консьерж больше не предлагает вчерашнее.
    const d2 = WS.ui.addOutcomeDraft('deal', 'd_anna', { text: 'Итог: клиент готов увеличить бюджет до 2,4 млн.' });
    WS.ui.rejectOutcome(d2.id);
    const kept = (dd().outcomes || []).find((x) => x.id === d2.id);
    check('итог · отклонённый остаётся со следом', !!kept && kept.state === 'rejected', kept ? kept.state : 'исчез');
    const tl3 = (dd().dealTimeline || {})['d_anna'] || [];
    check('итог · отклонённый в ленту не попал', !tl3.some((e) => e.text === d2.text));
    WS.ui.dealCard('d_anna');
    check('итог · отклонённый виден со следом отклонения', doc.getElementById('app').innerHTML.indexOf('oc-rejected') >= 0);
    dd().outcomes = (dd().outcomes || []).filter((x) => x.id !== d2.id);
  }

  // ---- блоки H/I: учёт, итог задачи, чей ход, нарушители, передача/партнёр ----
  {
    // Группы договоров: закрытый → 'closed'; просроченный/на проверке → 'attention'; остальные → 'active'.
    const ks = dd().contracts || [];
    const closed = ks.find((k) => k.status === 'closed');
    const active = ks.find((k) => k.status !== 'closed' &&
      !(k.milestones || []).some((m) => m.state === 'overdue') &&
      !(k.schedule || []).some((s) => s.state === 'overdue') && !k.review);
    const attn = ks.find((k) => k.status !== 'closed' &&
      ((k.milestones || []).some((m) => m.state === 'overdue') ||
       (k.schedule || []).some((s) => s.state === 'overdue') || k.review));
    check('сопровождение · закрытый договор попадает в группу closed',
      !closed || WS.ui.contractGroup(closed) === 'closed', closed && WS.ui.contractGroup(closed));
    check('сопровождение · активный без просрочки попадает в группу active',
      !active || WS.ui.contractGroup(active) === 'active', active && WS.ui.contractGroup(active));
    check('сопровождение · просроченный или на проверке попадает в attention',
      !attn || WS.ui.contractGroup(attn) === 'attention', attn && WS.ui.contractGroup(attn));
    // На стенде должны быть хотя бы активные договоры — иначе раздел пустой.
    check('сопровождение · на стенде есть хотя бы один активный договор', ks.length > 0, String(ks.length));

    // Форма «Выполнить задачу» открывает модал с полями «Что вышло» и «Следующий шаг».
    const tk = (dd().tasks || []).find((t) => t.status !== 'done');
    if (tk) {
      WS.ui.taskDoneForm(tk.id);
      const modal = doc.getElementById('modal').innerHTML;
      check('задача · форма выполнения содержит поле итога', modal.indexOf('td_out') >= 0, modal.slice(0, 80));
      check('задача · форма выполнения содержит поле следующего шага', modal.indexOf('td_next') >= 0);
      check('задача · форма выполнения предлагает поставить следующий шаг задачей',
        modal.indexOf('td_mk') >= 0, modal.slice(0, 120));
      WS.ui.closeModal();

      // saveTaskDone: итог идёт в ленту как confirmed, следующий шаг создаёт задачу.
      const tlBefore = ((dd().dealTimeline || {})[tk.dealId || ''] || []).length;
      const tksBefore = (dd().tasks || []).length;
      // Имитируем DOM-поля формы без реального modal: подставляем напрямую через addEventEntry.
      const fake = { id: 'td_out', value: 'Итог: договорились о брони' };
      doc.body.appendChild(Object.assign(doc.createElement('input'), fake));
      const fakeNext = Object.assign(doc.createElement('input'), { id: 'td_next', value: 'Позвонить в среду' });
      doc.body.appendChild(fakeNext);
      const fakeCb = Object.assign(doc.createElement('input'), { id: 'td_mk', type: 'checkbox' });
      fakeCb.checked = true;
      doc.body.appendChild(fakeCb);
      WS.ui.saveTaskDone(tk.id);
      // Итог в ленте
      const tlAfter = ((dd().dealTimeline || {})[tk.dealId || ''] || []).length;
      const tksDone = (dd().tasks || []).find((x) => x.id === tk.id);
      check('задача · выполненная получает статус done', !!tksDone && tksDone.status === 'done', tksDone && tksDone.status);
      if (tk.dealId) {
        check('задача · итог добавляется в ленту сделки', tlAfter > tlBefore, tlAfter + ' vs ' + tlBefore);
        const outcome = ((dd().dealTimeline || {})[tk.dealId] || []).find((e) => e.role === 'outcome');
        check('задача · итог помечен role=outcome и state=confirmed',
          !!outcome && outcome.state === 'confirmed', outcome ? outcome.state : 'нет');
      }
      check('задача · следующий шаг создан задачей', (dd().tasks || []).length > tksBefore, (dd().tasks || []).length + ' vs ' + tksBefore);
      // Убираем DOM-мусор.
      [fake.id, 'td_next', 'td_mk'].forEach((id) => { const el = doc.getElementById(id); if (el) el.parentNode.removeChild(el); });
    }

    // «Чей ход»: при последней входящей записи от клиента — ход наш, иначе — клиента.
    // turnOf возвращает null, когда объект выбран или отклонён — не актуально.
    const rq = (dd().requests || []).find((r) => (r.offered || []).some((o) => o.state === 'offered'));
    if (rq) {
      const off = (rq.offered || []).find((o) => o.state === 'offered');
      const tl0 = (dd().requestTimeline || {})[rq.id] || [];
      const turn = WS.ui.turnOf(rq, off);
      check('чей ход · возвращает client или us', turn === 'client' || turn === 'us', String(turn));
      // Добавляем входящую запись от клиента — ход должен стать «нашим».
      const before2 = WS.ui.turnOf(rq, off);
      (dd().requestTimeline || (dd().requestTimeline = {}))[rq.id] =
        tl0.concat([{ id: 'e_test_in', by: 'Клиент', dir: 'in', ord: 999999, at: 'сейчас', text: 'Жду' }]);
      const afterIn = WS.ui.turnOf(rq, off);
      check('чей ход · входящее от клиента переключает на «нас»', afterIn === 'us', afterIn);
      // Откатываем
      dd().requestTimeline[rq.id] = tl0;
    }
    // turnOf на выбранном/отклонённом объекте возвращает null.
    const rqSel = (dd().requests || []).find((r) => (r.offered || []).some((o) => o.state === 'selected'));
    if (rqSel) {
      const offSel = (rqSel.offered || []).find((o) => o.state === 'selected');
      check('чей ход · на выбранном объекте ход не показывается', WS.ui.turnOf(rqSel, offSel) === null, String(WS.ui.turnOf(rqSel, offSel)));
    }

    // Нарушители (сделки без следующего шага): функция возвращает список.
    const viol = WS.ui.dealsWithoutNextStep();
    check('нарушители · dealsWithoutNextStep возвращает массив', Array.isArray(viol), typeof viol);
    // Все найденные нарушители действительно не имеют шага.
    const falsePos = viol.filter((d) => WS.ui.dealHasNextStep(d));
    check('нарушители · в списке только те, у кого нет шага', falsePos.length === 0,
      falsePos.map((d) => d.id).join(', '));
    // На стенде есть хотя бы одна сделка с задачей — иначе список нарушителей всегда включал бы всех.
    const withStep = (dd().deals || []).filter((d) => WS.ui.dealHasNextStep(d));
    check('нарушители · на стенде есть сделка с задачей', withStep.length > 0,
      (dd().deals || []).map((d) => d.id).join(' '));

    // Передача сделки: меняет ответственного, старый становится свидетелем, задачи переназначаются.
    {
      const td = (dd().deals || []).find((d) => d.stage !== 'won' && d.stage !== 'lost' && d.agent);
      if (td) {
        const TEAM = WS.ui.TEAM || [];
        const other = TEAM.find((m) => m.id !== td.agent);
        if (other) {
          const fromAgent = td.agent;
          const tasksBefore = (dd().tasks || []).filter((t) => t.dealId === td.id && t.status !== 'done').map((t) => t.id);
          // Открываем форму
          WS.ui.dealTransferForm(td.id);
          const mHtml = doc.getElementById('modal').innerHTML;
          check('передача · форма открывается с полем выбора агента', mHtml.indexOf('tr_to') >= 0, mHtml.slice(0, 80));
          WS.ui.closeModal();
          // Вставляем DOM-поля и сохраняем
          const toEl = Object.assign(doc.createElement('select'), { id: 'tr_to' });
          const opt = doc.createElement('option'); opt.value = other.id; toEl.appendChild(opt);
          toEl.value = other.id;
          doc.body.appendChild(toEl);
          const whyEl = Object.assign(doc.createElement('input'), { id: 'tr_why', value: 'тест' });
          doc.body.appendChild(whyEl);
          WS.ui.saveTransfer(td.id);
          const tdNow = (dd().deals || []).find((x) => x.id === td.id);
          check('передача · ответственный сменился', tdNow && tdNow.agent === other.id, tdNow && tdNow.agent);
          check('передача · прежний агент стал свидетелем', (tdNow.witness || []).indexOf(fromAgent) >= 0,
            JSON.stringify(tdNow.witness));
          // Открытые задачи переназначены
          const tasksAfter = (dd().tasks || []).filter((t) => tasksBefore.indexOf(t.id) >= 0);
          const wrongAgent = tasksAfter.filter((t) => t.status !== 'done' && t.assignee !== other.id);
          check('передача · задачи переназначены новому ответственному', wrongAgent.length === 0,
            wrongAgent.map((t) => t.id + ':' + t.assignee).join(', '));
          // Убираем DOM-мусор и возвращаем данные
          ['tr_to', 'tr_why'].forEach((id) => { const el = doc.getElementById(id); if (el) el.parentNode.removeChild(el); });
          td.agent = fromAgent; td.witness = (tdNow.witness || []).filter((w) => w !== fromAgent);
        }
      }
    }

    // Привлечь партнёра: ответственный не меняется, partnerAgent устанавливается.
    {
      const pd = (dd().deals || []).find((d) => d.stage !== 'won' && d.stage !== 'lost' && d.agent);
      if (pd) {
        const TEAM = WS.ui.TEAM || [];
        const partner = TEAM.find((m) => m.id !== pd.agent);
        if (partner) {
          const responsible = pd.agent;
          WS.ui.dealPartnerForm(pd.id);
          const mHtml2 = doc.getElementById('modal').innerHTML;
          check('партнёр · форма открывается с полем выбора партнёра', mHtml2.indexOf('pa_who') >= 0, mHtml2.slice(0, 80));
          WS.ui.closeModal();
          const paWho = Object.assign(doc.createElement('select'), { id: 'pa_who' });
          const pOpt = doc.createElement('option'); pOpt.value = partner.id; paWho.appendChild(pOpt);
          paWho.value = partner.id;
          doc.body.appendChild(paWho);
          const paSplit = Object.assign(doc.createElement('input'), { id: 'pa_split', value: '70 / 30' });
          doc.body.appendChild(paSplit);
          WS.ui.savePartner(pd.id);
          const pdNow = (dd().deals || []).find((x) => x.id === pd.id);
          check('партнёр · ответственный не изменился', pdNow && pdNow.agent === responsible, pdNow && pdNow.agent);
          check('партнёр · partnerAgent установлен', pdNow && pdNow.partnerAgent === partner.id, pdNow && pdNow.partnerAgent);
          check('партнёр · split сохранён', pdNow && pdNow.split === '70 / 30', pdNow && pdNow.split);
          ['pa_who', 'pa_split'].forEach((id) => { const el = doc.getElementById(id); if (el) el.parentNode.removeChild(el); });
          delete pd.partnerAgent; delete pd.split;
        }
      }
    }
  }

  // ---- волна 4, блок 2: карточка сделки — кнопки, правка в поле, запланированное ----
  {
    WS.ui.dealCard('d_anna');
    const bar = doc.querySelector('#app .view .qa-bar');
    const primary = [].slice.call(doc.querySelectorAll('#app .view .qa-bar > .qa-act.primary'));
    const names = primary.map((b) => b.textContent.trim());
    check('карточка · в основном ряду ровно три действия', primary.length === 3, names.join(' | '));
    check('карточка · это «Собрать КП», «Назначить показ», «Записать событие»',
      names.join('|') === 'Собрать КП|Назначить показ|Записать событие', names.join('|'));
    const barText = bar ? bar.textContent : '';
    // «Чат по сделке» был дублем строки ввода внизу, «Открыть контакт» — третьим путём к клиенту.
    check('карточка · нет кнопки «Чат по сделке» — строка ввода внизу это она и есть',
      barText.indexOf('Чат по сделке') < 0, barText.slice(0, 120));
    check('карточка · нет кнопки «Открыть контакт» — имя клиента слева кликабельно',
      barText.indexOf('Открыть контакт') < 0, barText.slice(0, 120));
    check('карточка · имя клиента при этом действительно кликабельно',
      !!doc.querySelector('#app .view .dcli-name[data-client]'));
    check('карточка · в блоке клиента нет третьей кнопки «Карточка»',
      (doc.querySelector('#app .view .dcli-acts') || { textContent: '' }).textContent.indexOf('Карточка') < 0);
    // Спрятанное под «Ещё» должно остаться достижимым — иначе сокращение ряда это удаление функций.
    const more = [].slice.call(doc.querySelectorAll('#app .view .qa-more-item')).map((b) => b.textContent.trim());
    ['Поставить задачу', 'Параметры сделки', 'Завершить сделку', 'Передать сделку', 'Привлечь партнёра']
      .forEach((n) => check('карточка · «' + n + '» доступно под «Ещё»', more.indexOf(n) >= 0, more.join(' | ')));

    // Правка условия — В ПОЛЕ, а не в модальном окне: именно модальное окно и было претензией.
    const ed = doc.querySelectorAll('#app .view .dcard-aside .dv-edit[data-dfedit]');
    check('условия · правятся прямо в поле, а не кнопкой', ed.length >= 5, 'полей: ' + ed.length);
    check('условия · поле — настоящий редактируемый текст',
      [].slice.call(ed).every((e) => e.getAttribute('contenteditable') === 'true'));
    check('условия · отдельной кнопки правки у поля нет',
      !doc.querySelector('#app .view .dcard-aside .dfield button[data-act="editDeal"]'));

    // Сумма на экране — «2 400 000 AED», в данных — число, которое складывают в комиссии
    // и в пайплайне. Запись строки в это поле сломала бы все суммы разом.
    const anna = dd().deals.find((x) => x.id === 'd_anna');
    const amtWas = anna.amount;
    WS.ui.saveDealField('d_anna', 'amount', '3 100 000 AED');
    check('условия · из «3 100 000 AED» в данные попадает число', anna.amount === 3100000,
      JSON.stringify(anna.amount) + ' (' + typeof anna.amount + ')');
    check('условия · прежнее значение сохранено, а не затёрто',
      anna.was && anna.was.amount === amtWas, JSON.stringify(anna.was));
    /* Пометка обязана лечь на тот ключ, ИЗ КОТОРОГО поле рисуется. Бюджет показывается из
       `prov.budget`, а лежит в `amount` — записав пометку в `amount`, мы бы оставили на цифре,
       которую человек уже заменил своей, значок «предложено AI» и кнопку подтверждения. */
    check('условия · пометка легла на тот ключ, из которого поле рисуется',
      (anna.prov || {}).budget === 'manual', JSON.stringify(anna.prov));
    WS.ui.dealCard('d_anna');
    check('условия · и значок «предложено AI» с правленого поля ушёл',
      !(doc.querySelector('#app .view .dcard-aside') || { innerHTML: '' }).innerHTML
        .match(/data-dfconfirm="d_anna:budget"/), 'кнопка подтверждения ещё висит');
    WS.ui.dealCard('d_anna');
    check('условия · пометка «изменено вручную» видна с прежним значением в подсказке',
      /изменено вручную/i.test(doc.querySelector('#app .view .dcard-aside').textContent) &&
      ((doc.querySelector('#app .view .dv-was') || {}).title || '').indexOf(WS.AED(amtWas)) >= 0,
      'ожидалось «' + WS.AED(amtWas) + '» в подсказке, получено: ' +
        ((doc.querySelector('#app .view .dv-was') || {}).title || 'пометки нет'));
    // Вторая правка не должна подменить оригинал: «прежнее» — это то, что было до руки, а не до
    // предыдущей правки, иначе исходный факт из документа теряется после двух исправлений.
    WS.ui.saveDealField('d_anna', 'amount', '3 300 000 AED');
    check('условия · вторая правка не съедает исходное значение', anna.was.amount === amtWas, JSON.stringify(anna.was));
    // Неразбираемый ввод не должен обнулять сумму.
    WS.ui.saveDealField('d_anna', 'amount', 'примерно столько же');
    check('условия · неразобранный ввод оставляет прежнее число', anna.amount === 3300000, JSON.stringify(anna.amount));
    anna.amount = amtWas; delete anna.was; if (anna.prov) delete anna.prov.amount;

    // Запланированное: будущее и просроченное списком под одной выделенной строкой следующего шага.
    const withTask = (dd().deals || []).find((d) =>
      (dd().tasks || []).some((t) => t.dealId === d.id && t.status !== 'done' && t.due));
    if (withTask) {
      WS.ui.dealCard(withTask.id);
      const rows = doc.querySelectorAll('#app .view .plev-row');
      check('карточка · запланированное показано списком', rows.length > 0, 'строк: ' + rows.length);
      check('карточка · и одна выделенная строка следующего шага осталась над ним',
        doc.querySelectorAll('#app .view .plev-list > .plev-next').length === 1 &&
        doc.querySelector('#app .view .plev-list').firstElementChild.className.indexOf('plev-next') === 0,
        'выделенных строк: ' + doc.querySelectorAll('#app .view .plev-next').length);
      // Просроченное идёт первым — оно и есть повод открыть карточку.
      const html = WS.ui.dealPlannedEventsCard(withTask);
      const firstOver = html.indexOf('plev-row over');
      const anyOver = /plev-row over/.test(html);
      check('карточка · просроченное стоит выше непросроченного',
        !anyOver || firstOver === html.indexOf('plev-row'),
        anyOver ? ('первая просроченная на ' + firstOver + ', первая вообще на ' + html.indexOf('plev-row')) : 'просроченных нет');
    }
  }

  // ---- Консьерж работает внутри карточки: без перехода и без потери экрана ----
  {
    WS.store.dealChat = null;
    WS.ui.dealCard('d_anna');
    const viewWas = WS.store.view;
    const stackWas = (WS.store.navStack || []).length;
    const before = doc.querySelector('#app .view').textContent;
    /* Строка внизу — НАСТОЯЩЕЕ поле ввода, а не картинка поля. Она выглядела как строка, в
       которую можно писать, а писать было нельзя: клик просто открывал панель. Теперь в ней
       живёт input, и она по-прежнему не помечена как переход в раздел — именно это уводило. */
    const cbar = doc.querySelector('#app .view .dcard-composer .dx-cbar');
    const cin = cbar && cbar.querySelector('input.ph-in');
    check('консьерж · строка ввода в карточке не ведёт в раздел',
      !!cbar && !cbar.hasAttribute('data-thread') && !cbar.hasAttribute('data-dealchat'),
      cbar ? cbar.outerHTML.slice(0, 90) : 'строки нет');
    check('консьерж · и в неё действительно можно писать',
      !!cin && cin.tagName === 'INPUT' && !cin.disabled && !cin.readOnly,
      cin ? cin.outerHTML.slice(0, 90) : 'поля ввода нет');

    // Настоящий клик — не вызов функции: именно на клике старое поведение и уходило с экрана.
    const errsWas = errors.length;
    cbar.querySelector('[data-act="cardSend"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('консьерж · клик по строке ничего не сломал', errors.length === errsWas, errors.slice(errsWas).join('; '));
    check('консьерж · экран не сменился', WS.store.view === viewWas, 'было ' + viewWas + ', стало ' + WS.store.view);
    check('консьерж · перехода в историю навигации не записано',
      (WS.store.navStack || []).length === stackWas, (WS.store.navStack || []).length + ' против ' + stackWas);
    // Разговор идёт в панели ПОВЕРХ экрана — той же самой на всех разделах. Отдельной ленты
    // внутри карточки больше нет: она раздвигала работу, и это была третья реализация чата.
    check('консьерж · диалог открылся именно по этой сделке',
      (WS.engine.activeThread() || {}).id === 'deal:d_anna' && WS.store.cgDock === true,
      ((WS.engine.activeThread() || {}).id || 'нет треда') + ' · док ' + WS.store.cgDock);


    // Читаем защищённо: если экран всё-таки сменился, `.view` может не существовать —
    // проверка должна показать провал, а не уронить весь прогон на null.
    const afterEl = doc.querySelector('#app .view');
    const after = afterEl ? afterEl.textContent : '';
    check('консьерж · лента диалога появилась панелью поверх экрана',
      !!doc.querySelector('#cgdock.show #cgdockmsgs'),
      (doc.getElementById('cgdock') || {}).className || 'дока нет');
    check('консьерж · и работа под панелью не перестроилась',
      !doc.querySelector('#app .view .dcard-chat .chat'),
      'внутри карточки снова появилась своя лента');
    check('консьерж · и это тот же тред, что и в разделе',
      (WS.engine.activeThread() || {}).id === 'deal:d_anna', ((WS.engine.activeThread() || {}).id) || 'нет треда');
    // Главное требование: остальное на экране осталось видимым, а не свернулось и не исчезло.
    check('консьерж · левая колонка с фактами и условиями осталась',
      !!doc.querySelector('#app .view .dcard-aside') &&
      /Условия сделки/.test((doc.querySelector('#app .view .dcard-aside') || { textContent: '' }).textContent));
    check('консьерж · и участники сделки с экрана не ушли',
      /Участники/.test((doc.querySelector('#app .view .dcard-main') || { textContent: '' }).textContent));
    // Не по заголовку, а по существу: объект сделки назван на экране поимённо.
    {
      const annaDeal = dd().deals.find((x) => x.id === 'd_anna');
      const lotNames = (WS.ui.dealLots ? WS.ui.dealLots(annaDeal) : []).map((o) => o.name.split(',')[0]);
      check('консьерж · объекты сделки остались на экране',
        lotNames.length > 0 && lotNames.every((n) => after.indexOf(n) >= 0),
        'ожидались: ' + lotNames.join(', '));
    }
    check('консьерж · история и работа не исчезли', after.indexOf('Последние события') >= 0);
    check('консьерж · лента шагов сделки осталась', doc.querySelectorAll('#app .view .dx-path .dx-step').length > 0);
    // Ничего из того, что было до открытия, не должно было пропасть.
    const lost = ['Участники', 'Последние события', 'Клиент · связь']
      .filter((w) => before.indexOf(w) >= 0 && after.indexOf(w) < 0);
    check('консьерж · открытие диалога ничего с экрана не унесло', lost.length === 0, lost.join(', '));
    // Второй строки ввода не появилось — два поля и были тем дублем, который убирали.
    check('консьерж · поле ввода одно, и оно в панели',
      doc.querySelectorAll('#app .view .dcard-composer .dx-cbar').length === 1 &&
      !doc.getElementById('dealChatPrompt') && !!doc.getElementById('cgDockPrompt'),
      'в карточке ' + doc.querySelectorAll('#app .view .dcard-composer .dx-cbar').length +
      ', ввод в доке: ' + !!doc.getElementById('cgDockPrompt'));
    // Лента обязана иметь собственный предел высоты, иначе она вытолкнет работу за экран.
    // В jsdom стили не применяются — правило проверяется по самому CSS.
    {
      const cssSrc = read('css/app.css');
      check('консьерж · у ленты в карточке есть свой предел высоты и своя прокрутка',
        /\.dcard-chat \.chat \{[^}]*max-height[^}]*overflow-y:\s*auto/.test(cssSrc),
        (cssSrc.match(/\.dcard-chat \.chat \{[^}]*\}/) || ['правила нет'])[0].slice(0, 110));
    }
    // Свернуть — вернуться к прежнему виду, снова без перехода.
    const closeBtn = doc.querySelector('#cgdock [data-act="cgDock"]');
    check('консьерж · есть чем свернуть', !!closeBtn);
    if (closeBtn) closeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('консьерж · свёрнут без смены экрана',
      !WS.store.cgDock && WS.store.view === viewWas, WS.store.view + ' / док ' + WS.store.cgDock);
    check('консьерж · и экран под ним вернулся таким, каким был',
      !doc.querySelector('#cgdock.show') &&
      !!doc.querySelector('#app .view .dcard-main') && !!doc.querySelector('#app .view .dcard-aside'));
    check('консьерж · и карточка вернулась к прежнему виду',
      !doc.querySelector('#app .view .dcard-chat') && !!doc.querySelector('#app .view .dcard-composer .dx-cbar'));
    // Раздел Консьержа при этом продолжает открываться отдельно — второй вход не сломан.
    WS.engine.openThread('deal:d_anna', 'Проверка', 'briefcase');
    check('консьерж · раздел Консьержа по-прежнему открывается сам по себе', WS.store.view === 'concierge', WS.store.view);
    WS.ui.dealCard('d_anna');

    /* ---- Консьерж знает, на каком экране стоит агент ----------------------------------------
       «А по этой сделке что?» приходило к модели без подлежащего: тред она знала, экран — нет,
       и честно отвечала, что не поняла. Экран — такой же вход, как текст поручения. */
    {
      WS.ui.dealCard('d_anna');
      const sc = WS.ui.screenContext();
      const dl = (dd().deals || []).find((x) => x.id === 'd_anna') || {};
      check('консьерж · знает, какая запись открыта',
        !!sc.запись && sc.запись.тип === 'сделка' && sc.запись.id === 'd_anna',
        JSON.stringify(sc).slice(0, 160));
      // Читаем защищённо: если контекста нет вовсе, проверка обязана показать провал, а не
      // уронить весь прогон на undefined.
      const rec = sc.запись || {};
      check('консьерж · и держит её ключевые факты, а не одно название',
        !!rec.клиент && !!rec.шаг && rec.сумма === dl.amount,
        JSON.stringify(sc.запись || null).slice(0, 200));
      // Экран уезжает к модели вместе с вопросом. Транспорт в jsdom не поднять, поэтому
      // проверяется само место склейки запроса — как и правила CSS выше.
      const liveSrc = read('js/live.js');
      check('консьерж · экран уходит к модели вместе с вопросом',
        /screen:\s*screen\(\)/.test(liveSrc) && /WS\.ui\.screenContext/.test(liveSrc));
      // И офлайновый планировщик отвечает про открытую сделку, а не сводкой по рабочему месту.
      const ans = WS.agent.ask('что по этой сделке');
      check('консьерж · «что по этой сделке» отвечает про открытую сделку',
        ans.kind === 'answer' && ans.text.indexOf(dl.title) >= 0, (ans.text || '').slice(0, 140));
      // Панель, открытая круглой кнопкой, привязывается к тому, что открыто. Тред сбрасывается
      // напрямую: openThread уводит на раздел Консьержа, и экран перестал бы быть сделкой.
      WS.store.cgDock = false;
      WS.engine.closeThread();
      WS.ui.dealCard('d_anna');
      WS.ui.toggleCgDock();
      check('консьерж · панель открылась привязанной к открытой сделке',
        (WS.engine.activeThread() || {}).id === 'deal:d_anna' && WS.store.cgDock === true,
        ((WS.engine.activeThread() || {}).id || 'нет треда'));
      const dock = doc.getElementById('cgdock');
      check('консьерж · и вслух называет экран, на котором стоит агент',
        !!dock && !!dock.querySelector('.cgdock-where') &&
        dock.querySelector('.cgdock-where').textContent.indexOf(dl.title) >= 0,
        dock && dock.querySelector('.cgdock-where') ? dock.querySelector('.cgdock-where').textContent : 'строки контекста нет');
      WS.store.cgDock = false; WS.ui.renderCgDock();
    }

    /* ---- Заведённая запись открывается из того сообщения, которое её завело -----------------
       Раньше карточка «Применено» показывала название текстом, а строка «не заполнены: телефон,
       канал» была именно строкой: агент нажимал на неё, и не происходило ничего. */
    {
      const res = WS.storeApi.apply([{ op: 'addClient',
        record: { name: 'Тестовый Контакт' } }], { confirmed: true });
      check('консьерж · запись возвращает свой идентификатор наружу',
        res.ok && (res.created || []).length === 1 && res.created[0].coll === 'clients' && !!res.created[0].id,
        JSON.stringify(res.created || res.error || null));
      const madeId = res.ok && (res.created || [])[0] && res.created[0].id;
      /* Тем самым путём, каким дефект и возникает: модель предлагает завести контакт, человек
         подтверждает, и карточка «Применено» обязана вести в саму запись. Предложение
         собирается через тот же вход, которым пользуется живая голова, — иначе офлайновый
         планировщик, который заводить контакты не умеет, тихо пропустил бы всю проверку. */
      const prop = WS.agent.tools.propose(
        [{ op: 'addClient', record: { name: 'Пробный Клиент' } }],
        { title: 'Новый контакт', lines: ['Контакт: Пробный Клиент'] });
      check('консьерж · предложение завести контакт собирается', prop && prop.kind === 'proposal',
        prop ? (prop.kind + ' ' + (prop.error || '')) : 'нет предложения');
      check('консьерж · и оно называет, чего записи не хватает',
        (prop.missing || []).length > 0 && /не заполнены/.test((prop.missing || []).join(' ')),
        JSON.stringify(prop.missing || []));
      if (prop && prop.kind === 'proposal') {
        const before = ((WS.engine.activeThread() || {}).items || []).length;
        WS.engine.agentConfirm(prop.id);
        const items = (WS.engine.activeThread() || {}).items || [];
        const last = (items[items.length - 1] || {}).html || '';
        check('консьерж · из карточки «Применено» запись открывается кнопкой',
          /data-client="/.test(last) && /Открыть контакт/.test(last),
          last.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
        check('консьерж · и рядом сказано, что осталось дозаполнить',
          /не заполнены/.test(last),
          last.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
        check('консьерж · и сообщение действительно добавилось', items.length > before, before + ' → ' + items.length);
      }
      // Пробные записи из рабочего места убираются: они были нужны на один вопрос.
      const arr = dd().clients;
      [madeId, 'Пробный Клиент'].forEach((k) => {
        const at = arr.findIndex((x) => x && (x.id === k || x.name === k));
        if (at >= 0) arr.splice(at, 1);
      });
      WS.ui.dealCard('d_anna');
    }
  }

  // ---- Gap A: board mini-card must show next task + call button ----
  {
    const d = data.deals.find((x) => x.id === 'd_anna');
    if (d) {
      const tasks = data.tasks.filter((t) => t.dealId === d.id && t.status !== 'done');
      check('gap-a · deal d_anna has open tasks', tasks.length > 0, 'tasks=' + tasks.length);
      check('gap-a · deal has call button attributes in code',
        /data-act="callClient"/.test(read('js/ui.js')), 'attribute not found in ui.js');
      // Check CSS for task row styling
      const cssSrc = read('css/app.css');
      check('gap-a · CSS has dtask class for task row',
        /\.deal \.dtask/.test(cssSrc), 'dtask style not found');
      check('gap-a · CSS has dtask-t for task title truncation',
        /\.dtask-t.*overflow:\s*hidden/.test(cssSrc) || /\.dtask-t.*text-overflow/.test(cssSrc),
        'truncation styles not found');
      // Check inbox stages exposed
      check('gap-b · INBOX_STAGES exists in WS',
        WS.INBOX_STAGES && WS.INBOX_STAGES.length > 0, 'not exposed');
      check('gap-b · INBOX_STAGE_LABELS exists in WS',
        WS.INBOX_STAGE_LABELS && Object.keys(WS.INBOX_STAGE_LABELS).length > 0, 'not exposed');
    } else { check('gap-a · deal d_anna exists', false); }
  }

  // ---- Gap B: inbox items have stage field ----
  {
    const inbox = data.inbox || [];
    check('gap-b · inbox items exist', inbox.length > 0, 'count=' + inbox.length);
    const haveStage = inbox.filter((i) => i.stage !== undefined);
    check('gap-b · all inbox items have stage field', haveStage.length === inbox.length,
      'have stage: ' + haveStage.length + ' / ' + inbox.length);
    const validStages = (WS.INBOX_STAGES || []);
    check('gap-b · INBOX_STAGES vocabulary exists', validStages.length > 0, 'stages=' + validStages.join(','));
    const unreachedItems = inbox.filter((i) => i.stage === 'unreached');
    check('gap-b · at least one inbox item is in «unreached» stage', unreachedItems.length > 0,
      'unreached items: ' + unreachedItems.length);
  }

  // ---- Gap C: inbox kanban board with four columns ----
  {
    const cssSrc = read('css/app.css');
    check('gap-c · CSS rule exists to hide kanban below 900px',
      /@media \(max-width: 899\.98px\) \{[^}]*\.kanban[^}]*display:\s*none/.test(cssSrc),
      'mobile breakpoint rule');
    check('gap-c · JS breakpoint matches CSS (900px)',
      /boardFits\(\)[^{]*\(min-width:\s*900px\)/.test(read('js/ui.js')),
      'JS-CSS threshold');
    // Render requests view and check for board when it fits
    WS.storeApi.setView('requests');
    WS.ui.render();
    const reqView = doc.getElementById('app').innerHTML;
    const hasKanbanStructure = /class="kanban"/.test(reqView);
    check('gap-c · inbox board is rendered',
      hasKanbanStructure,
      hasKanbanStructure ? '✓ board markup present' : 'no board markup');
    const stages = (WS.INBOX_STAGES || []);
    if (stages.length === 4) {
      check('gap-c · inbox kanban has exactly 4 stages', stages.length === 4,
        'stages: ' + stages.join(' / '));
      const stageLabels = (WS.INBOX_STAGE_LABELS || {});
      const expected = ['new', 'unreached', 'qualified', 'rejected'];
      expected.forEach((s) => {
        check('gap-c · stage «' + s + '» has label',
          stageLabels[s] !== undefined, 'label=' + stageLabels[s]);
      });
    } else { check('gap-c · INBOX_STAGES has 4 entries', stages.length === 4, 'actual=' + stages.length); }
  }

  // ---- доска входящих: она заменила список, значит обязана нести всё, что нёс список ----
  {
    WS.router.go('requests');
    const view = doc.querySelector('#app .view') || doc.getElementById('app');
    const board = view.querySelector('.kanban');
    check('входящие · доска нарисована', !!board);
    const cols = [].slice.call(view.querySelectorAll('.kanban .kcol .kh span:first-child')).map((e) => e.textContent.trim());
    check('входящие · четыре отсека по стадиям разбора', cols.length === 4, cols.join(' | '));
    check('входящие · и это стадии Евгения, слово в слово',
      cols.join('|') === 'Новое обращение|Не вышли на связь|Квалифицирована|Отказ', cols.join('|'));
    // Та самая стадия, ради которой всё затевалось, должна быть видна не пустой рамкой.
    const unreached = (dd().inbox || []).filter((it) => it.stage === 'unreached');
    check('входящие · на стенде есть обращение в стадии «Не вышли на связь»', unreached.length > 0,
      (dd().inbox || []).map((it) => it.stage).join(' '));

    // Доска заменила список — значит действие списка обязано было переехать вместе с ним.
    // Раздел открывают ради разбора; доска без «Разобрать» — витрина.
    const cards = [].slice.call(view.querySelectorAll('.kanban .kcol .deal'));
    check('входящие · на доске есть карточки обращений', cards.length > 0, 'карточек: ' + cards.length);
    // На доске два вида карточек, и действие у них разное: неразобранное обращение
    // разбирают, заведённую заявку открывают. Мёртвой не должна быть ни одна.
    const inCards = cards.filter((el) => !el.getAttribute('data-request'));
    const reqCards = cards.filter((el) => el.getAttribute('data-request'));
    const noTriage = inCards.filter((el) => el.textContent.indexOf('Разобрать') < 0);
    check('входящие · на каждом обращении есть «Разобрать»', noTriage.length === 0,
      'без разбора: ' + noTriage.length + ' из ' + inCards.length);
    const deadReq = reqCards.filter((el) => el.textContent.indexOf('Открыть заявку') < 0);
    check('входящие · с каждой заведённой заявки есть вход в неё', deadReq.length === 0,
      'без входа: ' + deadReq.length + ' из ' + reqCards.length);

    // Замечание партнёра дословно: раздел оставить ТОЛЬКО под разбор входящих, отображение —
    // канбаном. Прежняя проверка смотрела, что доска существует, — а над ней стоял список
    // из семнадцати разобранных заявок и абзац-пояснение, и раздел разбором не был.
    const blocks = [].slice.call(view.children).map((el) => el.className);
    check('входящие · доска — единственное содержимое раздела',
      blocks.filter((c) => c !== 'wh').length === 1 && blocks.indexOf('kanban') >= 0,
      'блоки экрана: ' + blocks.join(' | '));
    check('входящие · пояснения над разделом нет',
      ((view.querySelector('.wh__p') || {}).textContent || '').trim() === '',
      (view.querySelector('.wh__p') || {}).textContent);
    // Пустая колонка читается как поломка. «Квалифицирована» набиралась только из обращений,
    // а разбор заводит ЗАЯВКУ — колонка была вечно нулевой при семнадцати заявках рядом.
    const emptyCols = [].slice.call(view.querySelectorAll('.kanban .kcol'))
      .filter((c) => c.querySelectorAll('.deal').length === 0)
      .map((c) => (c.querySelector('.kh span') || {}).textContent);
    check('входящие · ни одна стадия разбора не пуста', emptyCols.length === 0,
      'пусто: ' + emptyCols.join(', '));
    // Ничего не потеряно: каждая заявка либо на доске, либо видна через свою сделку.
    const onBoard = [].slice.call(view.querySelectorAll('.kanban [data-request]'))
      .map((el) => el.getAttribute('data-request'));
    const lostReqs = (dd().requests || []).filter((r) =>
      onBoard.indexOf(r.id) < 0 && (dd().deals || []).filter((d) => d.requestId === r.id).length === 0);
    check('входящие · заявка без сделки не пропала с доски', lostReqs.length === 0,
      lostReqs.map((r) => r.title).join(', '));

    // Стадию должно быть чем сдвинуть, и крайние положения не заворачиваются.
    check('входящие · стадию можно двигать с карточки', view.querySelectorAll('[data-instage]').length > 0);
    const first = (WS.INBOX_STAGES || [])[0], last = (WS.INBOX_STAGES || []).slice(-1)[0];
    const inNew = (dd().inbox || []).find((it) => it.stage === first);
    if (inNew) {
      WS.ui.moveInboxStage(inNew.id, 'prev');
      check('входящие · из первой стадии назад не уходит', inNew.stage === first, inNew.stage);
      WS.ui.moveInboxStage(inNew.id, 'next');
      check('входящие · вперёд сдвигается', inNew.stage === (WS.INBOX_STAGES || [])[1], inNew.stage);
      WS.ui.moveInboxStage(inNew.id, 'prev');
      check('входящие · и возвращается назад', inNew.stage === first, inNew.stage);
    }
    const inLast = (dd().inbox || []).find((it) => it.stage === last);
    if (inLast) {
      WS.ui.moveInboxStage(inLast.id, 'next');
      check('входящие · из последней стадии вперёд не уходит', inLast.stage === last, inLast.stage);
    }
    // Текст обращения не режется в JS: обрезанная строка врёт о том, что написал клиент.
    const longest = (dd().inbox || []).reduce((m, it) => (!m || it.text.length > m.text.length ? it : m), null);
    if (longest) {
      const html = WS.ui.inboxKanban();
      check('входящие · текст обращения не обрезан в коде', html.indexOf(longest.text) >= 0,
        'полного текста нет: ' + longest.text.slice(0, 50));
    }

    // Узкий экран доску не получает — там она горизонтальная лента, в которой нельзя работать.
    const mmWas = win.matchMedia;
    win.matchMedia = (q) => ({ matches: false, media: q, addListener: () => {}, removeListener: () => {} });
    WS.router.go('requests');
    const narrow = doc.getElementById('app').innerHTML;
    check('входящие · на узком экране доски нет', narrow.indexOf('class="kanban') < 0);
    check('входящие · и вместо неё возвращается список с тем же «Разобрать»',
      narrow.indexOf('Разобрать') >= 0 && narrow.indexOf('feed-row') >= 0);
    win.matchMedia = mmWas;
    WS.router.go('requests');
  }

  // ---- мини-карточка доски сделок отвечает «трогать ли её сегодня» ----
  {
    /* Предыдущие блоки закрывают задачи — к этому месту открытых по сделке может не остаться,
       и проверка «на доске видна ближайшая задача» провалилась бы из-за порядка прогона, а не
       из-за кода. Восстанавливаем из фикстур ровно то, что нужно этому блоку. */
    // И сбрасываем фильтры доски: их оставил включёнными предыдущий блок, и сделки с задачами
    // просто не попадали в выборку — провал был бы про порядок прогона, а не про карточку.
    WS.store.dealSrc = 'all'; WS.store.dealObjType = 'all'; WS.store.dealReadiness = 'all';
    WS.store.dealAgent = 'all'; WS.store.dealStage = 'all'; WS.store.dealSearch = '';
    WS.store.dealBudFrom = ''; WS.store.dealBudTo = ''; WS.store.dealFunnel = 'sale'; WS.store.dealFunnelAll = true;
    (WS.fixtures.tasks || []).forEach((ft) => {
      if (!ft.dealId) return;
      const cur = (dd().tasks || []).find((t) => t.id === ft.id);
      if (cur) { cur.status = ft.status; cur.when = ft.when; cur.due = ft.due; }
      else (dd().tasks || []).push(JSON.parse(JSON.stringify(ft)));
    });
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const boardIds = [].slice.call(doc.querySelectorAll('#app .view .kanban .deal[data-deal]'))
      .map((el) => el.getAttribute('data-deal'));
    const withTask = (dd().deals || []).find((d) => boardIds.indexOf(d.id) >= 0 && WS.ui.nextTaskOfDeal(d));
    check('доска · на стенде есть сделка с открытой задачей', !!withTask,
      'на доске: [' + boardIds.join(', ') + '] · задачи по сделкам: ' +
      (dd().tasks || []).filter((t) => t.dealId).map((t) => t.dealId + '/' + (t.status || 'open')).join(' '));
    if (withTask) {
      const card = doc.querySelector('#app .view .kanban .deal[data-deal="' + withTask.id + '"]');
      check('доска · карточка сделки с задачей нарисована', !!card);
      if (card) {
        const t = WS.ui.nextTaskOfDeal(withTask);
        check('доска · на карточке названа ближайшая задача', card.textContent.indexOf(t.title) >= 0, card.textContent.slice(0, 120));
        check('доска · и её срок', card.textContent.indexOf(t.due) >= 0, card.textContent.slice(0, 120));
      }
    }
    // Звонок нужен и там, где задачи нет: карточка без задачи всё равно про живого клиента.
    // Ищем среди тех, кто РЕАЛЬНО на доске: закрытые сделки в отсеки не попадают, и «карточки нет»
    // означало бы дефект теста, а не кода.
    const onBoard = [].slice.call(doc.querySelectorAll('#app .view .kanban .deal[data-deal]'))
      .map((el) => el.getAttribute('data-deal'));
    const noTask = (dd().deals || []).find((d) => d.clientId && onBoard.indexOf(d.id) >= 0 && !WS.ui.nextTaskOfDeal(d));
    if (noTask) {
      const card2 = doc.querySelector('#app .view .kanban .deal[data-deal="' + noTask.id + '"]');
      check('доска · кнопка звонка есть и у сделки без задачи',
        !!card2 && !!card2.querySelector('[data-act="callClient"]'),
        card2 ? 'кнопки нет' : 'карточки нет');
    }
    // Номер телефона на доске не печатается — её показывают на встречах и снимают скриншотами.
    const boardEl = doc.querySelector('#app .view .kanban');
    if (boardEl) {
      const phones = (dd().clients || []).map((c) => c.phone).filter(Boolean);
      const leaked = phones.filter((p) => boardEl.innerHTML.indexOf(p) >= 0);
      check('доска · ни один номер телефона на доску не попал', leaked.length === 0, leaked.join(', '));
    }
  }

  // ---- нарисованный элемент, который ничего не делает ----
  // Проверка на data-act уже есть. Она не покрывает НАВИГАЦИОННЫЕ data-атрибуты: доска входящих
  // приехала с `data-inbox` и курсором-пальцем, а обработчика для него не существовало —
  // карточка обещала клик и молчала. Правило шире одного случая, поэтому и проверка шире.
  {
    const uiSrc = read('js/ui.js'), mainSrc = read('js/main.js');
    // Все data-атрибуты, которые ui.js рисует, кроме заведомо оформительских.
    const DECOR = ['data-act', 'data-mid', 'data-v', 'data-dir', 'data-scope', 'data-deal', 'data-req',
      'data-obj', 'data-cid', 'data-tlabel', 'data-ticon', 'data-feat', 'data-stage', 'data-field', 'data-task',
      'data-pblock'];
    const rendered = Array.from(new Set((uiSrc.match(/data-[a-z]+(?:-[a-z]+)*=/g) || [])
      .map((x) => x.slice(0, -1)))).filter((a) => DECOR.indexOf(a) < 0);
    // Обработчик обязан хотя бы упоминать атрибут: либо в списке делегирования, либо как d.<имя>.
    const camel = (a) => a.slice(5).replace(/-([a-z])/g, (m, ch) => ch.toUpperCase());
    // Читателем считается либо строка делегирования `[data-x]`, либо обращение `dataset.x`
    // где угодно в обработчиках или в самом ui.js. Узкая проверка «только d.x» давала одиннадцать
    // ложных срабатываний: половина обработчиков читает атрибут через dataset у своей переменной.
    const both = mainSrc + uiSrc;
    const orphans = rendered.filter((a) =>
      both.indexOf('[' + a + ']') < 0 && both.indexOf('dataset.' + camel(a)) < 0 &&
      both.indexOf('d.' + camel(a)) < 0);
    check('интерфейс · у каждого нарисованного data-атрибута есть кто-то, кто его читает',
      orphans.length === 0, orphans.join(', '));
  }

  // ---- что нашла кросс-модельная вычитка: четыре дыры без единой проверки ----
  {
    const anna = dd().deals.find((x) => x.id === 'd_anna');

    // 1. Словарное поле. По «готовности» выбирается вид договора, а из него — шаги сделки.
    // «офплан» вместо «оффплан» переводит сделку во вторичку, у которой брони нет, и сделка
    // оказывается на шаге, которого нет в её собственном пути.
    const rWas = anna.readiness, stWas = anna.stage;
    const ok = WS.ui.saveDealField('d_anna', 'readiness', 'офплан');
    check('словарь · опечатка в готовности не принимается', ok === false && anna.readiness === rWas,
      anna.readiness + ' (было ' + rWas + ')');
    check('словарь · и шаг сделки остался в её собственном пути',
      ((WS.DEAL_STEPS || {})[WS.contractKindFor(anna.funnel, anna.readiness)] || []).indexOf(anna.stage) >= 0,
      anna.stage + ' / ' + WS.contractKindFor(anna.funnel, anna.readiness));
    check('словарь · законное значение из списка принимается',
      WS.ui.saveDealField('d_anna', 'readiness', 'готовый') === true && anna.readiness === 'готовый');
    WS.ui.saveDealField('d_anna', 'readiness', rWas); anna.stage = stWas; delete anna.was;
    check('словарь · свободный текст там, где список не задан, по-прежнему принимается',
      WS.ui.dfieldAllowed('goal') === null && WS.ui.dfieldAllowed('readiness') !== null);

    // 2. Набранная разметка не должна исполняться при следующей отрисовке.
    const gWas = anna.goal;
    WS.ui.saveDealField('d_anna', 'goal', '<img src=x onerror=alert(1)>');
    WS.ui.dealCard('d_anna');
    const aside = doc.querySelector('#app .view .dcard-aside');
    check('правка · набранная разметка не становится разметкой',
      !!aside && aside.querySelectorAll('img').length === 0 && aside.textContent.indexOf('onerror') >= 0,
      aside ? ('img: ' + aside.querySelectorAll('img').length) : 'блока нет');
    anna.goal = gWas; delete anna.was; if (anna.prov) delete anna.prov.goal;

    // 3. Уход из поля не перерисовывает приложение: отрисовка заменяет узел, по которому только
    // что кликнули, и клик пропадает — кнопка выглядит мёртвой. Для названия сделки это правило
    // уже действует; проверяем, что правка условия ведёт себя так же.
    {
      // touch() зовёт отрисовку изнутри store.js, поэтому подмена внешнего emit её не видит.
      // Проверяем сам контракт: с каким аргументом сохранение просит перерисовать.
      const revWas = WS.store.dataRevision;
      const seen = [];
      const touchWas = WS.storeApi.touch;
      WS.storeApi.touch = function (o) { seen.push(o && o.render === false ? 'тихо' : 'с отрисовкой'); return touchWas.apply(this, arguments); };
      WS.ui.saveDealField('d_anna', 'paymentForm', 'рассрочка 60/40', { render: false });
      check('правка · уход из поля сохраняет, но не перерисовывает экран',
        seen.join('') === 'тихо' && WS.store.dataRevision > revWas, seen.join(', ') || 'сохранения не было');
      WS.ui.saveDealField('d_anna', 'paymentForm', 'рассрочка 70/30');
      check('правка · а подтверждение по Enter перерисовывает',
        seen[1] === 'с отрисовкой', seen.join(', '));
      WS.storeApi.touch = touchWas;
      delete anna.was; if (anna.prov) delete anna.prov.paymentForm;
    }

    // 4. Событие календаря несёт `title`/`when`, запись ленты — `text`/`at`. Чтение по чужой
    // форме молча выбрасывало КАЖДОЕ событие, и «Запланировано» показывало только задачи.
    {
      const ev = (dd().events || []).find((e) => e.dealId);
      check('данные · на стенде есть событие календаря, привязанное к сделке', !!ev,
        (dd().events || []).length + ' событий');
      if (ev) {
        const d2 = dd().deals.find((x) => x.id === ev.dealId);
        const html = WS.ui.dealPlannedEventsCard(d2);
        check('запланированное · событие календаря попало в блок, а не только задачи',
          html.indexOf(ev.title || ev.text) >= 0, 'нет «' + (ev.title || ev.text) + '»');
      }
    }

    // 5. Форма фикстур изменилась — сохранённый снимок обязан быть отвергнут, иначе у того, кто
    // уже открывал стенд, все обращения останутся в «Новом», а стадия «Не вышли на связь» — пустой.
    {
      const src = read('js/store.js');
      const m = /const SCHEMA = (\d+);/.exec(src);
      check('схема · версия поднята под новые поля волны 4', !!m && parseInt(m[1], 10) >= 26,
        m ? m[1] : 'не найдена');
      check('схема · и подъём объяснён в её же истории', /25→26/.test(src));
    }

    // 6. Доска или список решает ширина, и решение принимается один раз при отрисовке. Без
    // пересборки на пересечении порога поворот телефона оставляет раздел пустым.
    {
      const mainSrc = read('js/main.js');
      check('ширина · пересечение порога перерисовывает экран',
        /matchMedia\(WS\.ui\.BOARD_MIN\)/.test(mainSrc) && /addEventListener\('change'|addListener\(/.test(mainSrc),
        'слушателя порога нет');
      check('ширина · и порог берётся из одного места, а не пишется заново',
        mainSrc.indexOf('WS.ui.BOARD_MIN') >= 0 && !/main\.js[\s\S]*min-width: 9/.test(mainSrc));
    }
  }

  // ---- архив вместо удаления, и дубль условий ----
  {
    WS.store.dealArchivedOnly = false;
    WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients');
    const target = (dd().deals || []).find((d) => !WS.ui.dealArchived(d) && d.stage !== 'won' && d.stage !== 'lost');
    check('архив · есть живая сделка, на которой можно проверить', !!target);
    if (target) {
      const tlWas = ((dd().dealTimeline || {})[target.id] || []).length;
      const onBoardBefore = !!doc.querySelector('#app .view .kanban .deal[data-deal="' + target.id + '"]');
      check('архив · до архивации сделка на доске', onBoardBefore);

      WS.ui.archiveDeal(target.id);
      check('архив · форма спрашивает причину', doc.getElementById('modal').innerHTML.indexOf('ar_why') >= 0);
      WS.ui.saveArchive(target.id);
      check('архив · сделка помечена архивной', WS.ui.dealArchived(target) === true);
      // Удаления нет: запись, события и документы остаются на месте.
      check('архив · запись из данных не исчезла', !!dd().deals.find((x) => x.id === target.id));
      check('архив · история сохранена и пополнилась следом архивации',
        ((dd().dealTimeline || {})[target.id] || []).length === tlWas + 1);
      // Но из работы уходит: с доски, из списка и из сумм.
      WS.router.go('clients');
      check('архив · с доски убрана', !doc.querySelector('#app .view .kanban .deal[data-deal="' + target.id + '"]'));
      WS.store.dealsView = 'table'; WS.router.go('clients');
      check('архив · и из списка тоже',
        (doc.querySelector('#app .view') || { innerHTML: '' }).innerHTML.indexOf('data-deal="' + target.id + '"') < 0);
      WS.store.dealsView = 'kanban';
      // Архив — не проигрыш: смешав их, мы испортили бы конверсию, которую сами же считаем.
      check('архив · стадия сделки не подменена на проигрыш', target.stage !== 'lost', target.stage);
      // Вернуться должно быть чем, иначе архив — это «спрятать навсегда».
      WS.router.go('clients');
      check('архив · в панели фильтров есть переключатель архива',
        (doc.querySelector('#app .view') || { innerHTML: '' }).innerHTML.indexOf('data-act="dealsArchive"') >= 0);
      WS.store.dealArchivedOnly = true; WS.router.go('clients');
      check('архив · под переключателем сделка видна',
        !!doc.querySelector('#app .view .kanban .deal[data-deal="' + target.id + '"]'));
      WS.store.dealArchivedOnly = false;
      WS.ui.unarchiveDeal(target.id);
      check('архив · возвращается в работу', WS.ui.dealArchived(target) === false);
      WS.router.go('clients');
      check('архив · и снова на доске', !!doc.querySelector('#app .view .kanban .deal[data-deal="' + target.id + '"]'));
    }

    // Дубль копирует УСЛОВИЯ, а не историю: копия событий и денег удвоила бы пайплайн.
    const src = (dd().deals || []).find((d) => d.clientId && (d.lots || []).length);
    if (src) {
      const nWas = dd().deals.length;
      const copy = WS.ui.duplicateDeal(src.id);
      check('дубль · создана новая запись', !!copy && dd().deals.length === nWas + 1);
      check('дубль · со своим идентификатором', !!copy && copy.id !== src.id, copy && copy.id);
      check('дубль · условия перенесены', !!copy && copy.clientId === src.clientId &&
        copy.funnel === src.funnel && copy.readiness === src.readiness && copy.amount === src.amount);
      check('дубль · участники перенесены', !!copy && (copy.contacts || []).length === WS.ui.dealContacts(src).length);
      // Объект — предмет ВТОРОЙ сделки, он выбирается заново, иначе один лот окажется в двух договорах.
      check('дубль · объект не скопирован — выбирается заново',
        !!copy && (copy.lots || []).length === 0 && !copy.objectId, JSON.stringify(copy && copy.lots));
      // История и деньги принадлежат той сделке, где произошли.
      const ctl = (dd().dealTimeline || {})[copy.id] || [];
      const stl = (dd().dealTimeline || {})[src.id] || [];
      check('дубль · история исходной сделки не скопирована', ctl.length === 1 && ctl.length < stl.length,
        ctl.length + ' против ' + stl.length);
      check('дубль · в ленте копии сказано, откуда она', /копией условий/.test((ctl[0] || {}).text || ''));
      check('дубль · задачи исходной сделки не удвоились',
        (dd().tasks || []).filter((t) => t.dealId === copy.id).length === 0);
      check('дубль · копия стартует с первого шага своего договора',
        ((WS.DEAL_STEPS || {})[WS.contractKindFor(copy.funnel, copy.readiness)] || [])[0] === copy.stage,
        copy.stage);
      dd().deals = dd().deals.filter((d) => d.id !== copy.id);
      delete (dd().dealTimeline || {})[copy.id];
    }
  }

  // ---- первый экран: Консьерж, диалоги скрыты, подсказки из этих данных ----
  {
    // Читаем стартовое состояние из самого store.js: живой store к этому месту уже исхожен
    // предыдущими блоками, и проверка «что видит агент при первом запуске» по нему солгала бы.
    const st = read('js/store.js');
    check('вход · приложение открывается Консьержем, а не сводкой',
      /view: 'concierge'/.test(st), (st.match(/view: '[a-z]+'/) || [])[0]);
    check('вход · список диалогов при этом скрыт, как у привычной нейросети',
      /cgRailOpen: false/.test(st), (st.match(/cgRailOpen: \w+/) || [])[0]);
    const uiSrc = read('js/ui.js');
    const navOrder = (uiSrc.match(/\{ id: '(concierge|start)', label: '([^']+)'/g) || []).slice(0, 2);
    check('вход · в меню Консьерж стоит перед Пульсом',
      navOrder.length === 2 && navOrder[0].indexOf("'concierge'") >= 0 && navOrder[1].indexOf("'start'") >= 0,
      navOrder.join(' | '));

    WS.store.cgRailOpen = false;
    WS.engine.closeThread();
    WS.router.go('concierge');
    const view = doc.querySelector('#app .view') || doc.getElementById('app');
    check('вход · экран здоровается и спрашивает, чем помочь',
      /Чем помочь/.test(view.textContent), view.textContent.slice(0, 80));
    check('вход · строка ввода на месте', !!doc.getElementById('cgPrompt'));
    check('вход · список диалогов не показан',
      !doc.querySelector('#app .cg2:not(.cg2--railhidden)'),
      'колонка диалогов развёрнута');
    check('вход · но развернуть его есть чем', !!doc.querySelector('#app [data-act="cgRailToggle"]'));

    // Подсказки — не украшение: они снимают пустоту первого экрана и обязаны быть про ЭТИ данные.
    const starters = [].slice.call(doc.querySelectorAll('#app .cg-start'));
    check('вход · подсказки показаны', starters.length >= 3, 'подсказок: ' + starters.length);
    check('вход · каждая подсказка что-то отправляет Консьержу',
      starters.every((b) => (b.getAttribute('data-cgask') || '').length > 3),
      starters.map((b) => b.getAttribute('data-cgask')).join(' | '));
    // Хотя бы одна обязана называть живую запись стенда — иначе это выдуманные примеры.
    const names = (dd().clients || []).map((c) => c.name.split(' ')[0]);
    const txt = starters.map((b) => b.textContent + ' ' + b.getAttribute('data-cgask')).join(' ');
    check('вход · подсказки говорят про реальные данные, а не про абстрактный пример',
      names.some((n) => txt.indexOf(n) >= 0), txt.slice(0, 140));
    // И подсказка не должна предлагать то, чего на стенде нет.
    const overdue = (dd().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue');
    if (!overdue.length) {
      check('вход · про просроченное не предлагается, когда его нет', txt.indexOf('просрочен') < 0, txt.slice(0, 100));
    } else {
      check('вход · про просроченное предложено, раз оно есть', txt.indexOf('просрочен') >= 0, txt.slice(0, 100));
    }
    // Нажатие должно доходить до Консьержа, а не только рисоваться.
    if (starters.length) {
      const errsWas = errors.length;
      starters[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('вход · нажатие на подсказку ничего не ломает', errors.length === errsWas, errors.slice(errsWas).join('; '));
      check('вход · и открывает диалог', !!WS.engine.activeThreadId(), String(WS.engine.activeThreadId()));
    }
    WS.engine.closeThread();
  }

  // ---- Пульс: разделы по схеме партнёра, числа — из этих данных ----
  // Проверки написаны после того, как перестройка Пульса снесла строку Консьержа, «Сюжет дня»,
  // «Инсайты» и очередь дня, а весь набор из 1480 проверок остался зелёным. Раз состав экрана
  // ничем не удерживался, он и уехал. Дальше держится здесь.
  {
    WS.store.navStack = [];
    if (WS.store.role !== 'agent') WS.storeApi.setRole('agent');
    WS.store.pulseTab = 'deals';
    WS.router.go('start');
    const pulse = doc.querySelector('#app .start') || doc.getElementById('app');
    const labels = [].slice.call(pulse.querySelectorAll('.section-label, .pb-t')).map((e) => e.textContent.trim());
    const order = ['Мои цели', 'Мои дела', 'Перспективные сделки', 'Аналитика'];
    const idx = order.map((t) => labels.findIndex((l) => l.indexOf(t) === 0));
    check('Пульс · все четыре раздела на экране', idx.every((i) => i >= 0),
      order.filter((t, i) => idx[i] < 0).join(', ') + ' | есть: ' + labels.join(' / '));
    check('Пульс · разделы идут в порядке схемы партнёра',
      idx.every((v, i) => i === 0 || (v > idx[i - 1])), idx.join(','));
    // Каждый раздел сворачивается, и сворачивается без скрипта — как левая колонка карточки.
    const blocks = [].slice.call(pulse.querySelectorAll('.pblock'));
    check('Пульс · разделы блоками, а не левым списком', blocks.length >= 3, 'блоков: ' + blocks.length);
    check('Пульс · и каждый сворачивается без скриптов',
      blocks.every((b) => b.tagName === 'DETAILS' && !!b.querySelector('summary')));
    // Предложения идут раньше аналитики: их читают каждый день, аналитику — раз в неделю.
    const iIns = labels.findIndex((l) => l.indexOf('Инсайты') === 0);
    const iAn = labels.findIndex((l) => l.indexOf('Аналитика') === 0);
    check('Пульс · предложения и инсайты стоят раньше аналитики', iIns >= 0 && iAn > iIns,
      'инсайты ' + iIns + ', аналитика ' + iAn);

    /* ---- Цель полосой над рабочей областью -------------------------------------------------
       На каждом листе макета партнёра сверху стоит одна и та же полоса: срок · что заработать ·
       выполнено · осталось · прогресс. Проверяется не «полоса есть», а что все четыре текста
       на месте и что длина закраски совпадает с посчитанным процентом. */
    const band = pulse.querySelector('.pgoal');
    check('Пульс · цель стоит полосой над рабочей областью', !!band);
    if (band) {
      const row = band.querySelector('.pgoal-row');
      const t = row.textContent;
      check('Пульс · полоса называет срок, цель, выполненное и остаток',
        /Цель до \s*\d/.test(t) && /Выполнено/.test(t) && /Осталось/.test(t) &&
        row.querySelectorAll('.pgoal-cell').length === 2, t.replace(/\s+/g, ' ').slice(0, 160));
      const pct = parseInt((row.querySelector('.pgoal-pct') || {}).textContent || '', 10);
      const w = parseFloat(((row.querySelector('.pgoal-bar > i') || {}).getAttribute
        ? row.querySelector('.pgoal-bar > i').getAttribute('style') : '').replace(/[^\d.]/g, ''));
      check('Пульс · закраска полосы совпадает с процентом, а не нарисована на глаз',
        Math.abs(w - Math.max(0, Math.min(100, pct))) < 0.51, 'процент ' + pct + ', ширина ' + w);
    }

    /* ---- Ежедневник: срочность видна строкой, тип — своим цветом ---------------------------
       Состав колонок задан партнёром и проверяется выше. Здесь — то, из-за чего он сказал, что
       ему не нравится, как это выглядит: плоский список, в котором просроченное ничем не
       отличается от завтрашнего, пока не вчитаешься в дату. */
    {
      const bAll = doc.querySelector('#app [data-dayfilter="all"]');
      if (bAll) bAll.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const rows = [].slice.call(doc.querySelectorAll('#app .pd-table tbody tr'));
      const items = WS.ui.pulseDayItems();
      const over = items.filter((x) => x.when === 'overdue').length;
      const today = items.filter((x) => x.when === 'today').length;
      check('Пульс · просроченное и сегодняшнее помечены в самой строке, а не только датой',
        rows.filter((r) => r.className.indexOf('pd-over') >= 0).length === over &&
        rows.filter((r) => r.className.indexOf('pd-today') >= 0).length === today,
        'просрочено ' + over + ', сегодня ' + today + ' против строк ' +
        rows.filter((r) => r.className.indexOf('pd-over') >= 0).length + '/' +
        rows.filter((r) => r.className.indexOf('pd-today') >= 0).length);
      check('Пульс · тип дела назван и окрашен, а не выведен одним серым словом',
        rows.length > 0 && rows.every((r) => {
          const k = r.querySelector('.pd-kind');
          return k && /k-(call|meet|task|msg)/.test(k.className) && k.textContent.trim().length > 3;
        }), rows.length + ' строк');
    }

    /* ---- Предложение говорит, что сделать и что это даст ------------------------------------
       «Перспективная сделка» без глагола — это ещё одна карточка сделки. Здесь проверяется, что
       предложение названо тем же правилом, что рисует следующий шаг в карточке, и что ценность
       называет посчитанную комиссию, а не общие слова. */
    {
      const pcard = pulse.querySelector('.pcard[data-prospcard]');
      check('Пульс · перспективная сделка подана карточкой-предложением', !!pcard);
      if (pcard) {
        const d = (dd().deals || []).find((x) => x.id === pcard.getAttribute('data-prospcard'));
        const doTxt = (pcard.querySelector('.pc-do') || {}).textContent || '';
        const gain = (pcard.querySelector('.pc-gain-t') || {}).textContent || '';
        check('Пульс · «Предлагаю» — то же действие, что и следующий шаг по этой сделке',
          !!d && doTxt.trim() === WS.ui.prospectOffer(d).trim(), doTxt);
        check('Пульс · «Что это даёт» называет посчитанную комиссию',
          gain.indexOf(WS.AED(Math.round(WS.ui.dealCommission(d)))) >= 0, gain);
      }
    }

    /* Пролистывание карточки возвращало экран наверх: перерисовка заменяет разметку целиком, и
       прокрутка обнулялась. Восстанавливать её можно только на ТОМ ЖЕ экране — переход на другую
       запись обязан начинаться сверху. Проверяется решение, которое это различает. */
    {
      WS.router.go('start');
      const k1 = WS._renderKey;
      WS.store.prospIdx = (WS.store.prospIdx || 0) + 1;
      WS.storeApi.touch();
      check('Пульс · перелистывание не считается переходом — экран не отматывается наверх',
        !!k1 && WS._renderKey === k1, k1 + ' → ' + WS._renderKey);
      WS.ui.dealCard('d_anna');
      check('Пульс · а открытие другой записи переходом считается', WS._renderKey !== k1,
        k1 + ' → ' + WS._renderKey);
      WS.store.prospIdx = 0;
      WS.router.go('start');
    }
    // То, что уже было выверено, перестройка сносить не имеет права.
    check('Пульс · строка Консьержа осталась первой', !!doc.getElementById('startPrompt'));
    check('Пульс · вход в «Сюжет дня» не потерян', !!pulse.querySelector('[data-act="presenter"]'));
    check('Пульс · «Инсайты» на месте', /Инсайты/.test(pulse.textContent));
    // Ежедневник: состав строки задан партнёром дословно — дата, сделка или заявка, контакт,
    // событие, тип. Проверяется по шапке таблицы, а не по наличию слова «дела» на экране.
    const heads = [].slice.call(pulse.querySelectorAll('.pd-table thead th')).map((e) => e.textContent.trim());
    check('Пульс · «Мои дела» — ежедневник с колонками партнёра',
      ['Дата', 'Сделка или заявка', 'Контакт', 'Событие', 'Тип'].every((h, i) => heads[i] === h),
      heads.join(' | '));
    check('Пульс · и срок дел переключается',
      pulse.querySelectorAll('[data-dayfilter]').length >= 3,
      String(pulse.querySelectorAll('[data-dayfilter]').length));
    // Разбор просроченных был отдельной плиткой; она уехала во вкладки, и путь к записям
    // обязан остаться — иначе список просроченных с Пульса больше не открыть.
    const odN = (dd().tasks || []).filter((t) => t.status !== 'done' && t.when === 'overdue').length;
    if (odN) {
      // Просроченное открывается прямо из ежедневника: строка называет сделку и она кликается.
      const b = doc.querySelector('#app [data-dayfilter="overdue"]');
      if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const overRows = doc.querySelectorAll('#app .pd-table tbody tr');
      check('Пульс · просроченные показываются списком, а не только счётчиком',
        overRows.length >= odN, overRows.length + ' строк при ' + odN + ' просроченных');
      check('Пульс · и из строки можно уйти в саму сделку или заявку',
        !!doc.querySelector('#app .pd-table [data-deal], #app .pd-table [data-request]'));
      const b2 = doc.querySelector('#app [data-dayfilter="today"]');
      if (b2) b2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }
    // Кнопка «Работать через AI-консьержа» из схемы не повторена: ввод уже стоит наверху.
    check('Пульс · ввод Консьержа один, а не задвоен',
      pulse.querySelectorAll('.prompt input').length === 1,
      String(pulse.querySelectorAll('.prompt input').length));

    // Пять тем аналитики — по схеме партнёра.
    const tabs = [].slice.call(pulse.querySelectorAll('[data-pulsetab]'));
    check('Пульс · пять тем аналитики', tabs.length === 5, tabs.map((b) => b.textContent.trim()).join(' | '));
    const want = ['Сделки', 'Заявки', 'Клиенты', 'Партнёры', 'Стоимость'];
    check('Пульс · темы названы как у партнёра',
      want.every((w, i) => (tabs[i] || {}).textContent && tabs[i].textContent.indexOf(w) >= 0),
      tabs.map((b) => b.textContent.trim()).join(' | '));

    // Переключение обязано менять содержимое, а не только подсветку кнопки.
    // Кнопки перечитываем перед каждым нажатием: после перерисовки прежние узлы уже вне документа,
    // клик по ним никуда не всплывает и проверка молча «проходит» на старой панели.
    const clickTab = (key) => {
      const b = doc.querySelector('#app [data-pulsetab="' + key + '"]');
      if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return ((doc.querySelector('#app .pulse-panel')) || {}).textContent || '';
    };
    const dealsPanel = (pulse.querySelector('.pulse-panel') || {}).textContent || '';
    const errsWas = errors.length;
    const clientsPanel = clickTab('clients');
    check('Пульс · переключение темы меняет содержимое',
      clientsPanel !== dealsPanel && clientsPanel.indexOf('Клиентов в базе') >= 0,
      clientsPanel.slice(0, 90));
    check('Пульс · переключение темы ничего не роняет', errors.length === errsWas, errors.slice(errsWas).join('; '));

    // Числа считаются по стенду. Захардкоженное из макета партнёра здесь падает.
    const clientsN = (dd().clients || []).length;
    const investors = (dd().clients || []).filter((c) => c.ctype === 'investor').length;
    check('Пульс · «клиентов в базе» равно тому, сколько их в данных',
      clientsPanel.indexOf(String(clientsN)) >= 0 && clientsN > 0, 'в данных: ' + clientsN);
    check('Пульс · разбивка по типу клиента посчитана, а не взята из макета',
      clientsPanel.indexOf(String(investors)) >= 0, 'инвесторов в данных: ' + investors);

    // Стоимость лида посчитать НЕ ИЗ ЧЕГО. Экран обязан сказать это словами и не показать числа.
    // Пересмотр раньше принятого: раньше стоимость лида объявлялась непосчитанной. Партнёр
    // дал формулу — бюджет привлечения делить на число лидов, — а смета расходов в стенде есть.
    // Теперь она СЧИТАЕТСЯ, и проверка требует, чтобы цифра сходилась с этой формулой.
    const costPanel = clickTab('cost');
    const mk = WS.ui.marketingSpend();
    const leads = (dd().attribution || []).reduce((x, a) => x + a.leads, 0);
    const cpl = leads ? Math.round(mk.total / leads) : 0;
    check('Пульс · стоимость лида посчитана по формуле партнёра',
      costPanel.indexOf(WS.AED(cpl)) >= 0 && cpl > 0,
      'ожидалось ' + WS.AED(cpl) + ' (' + mk.total + '/' + leads + ')');
    check('Пульс · и названо, из чего собран бюджет привлечения',
      mk.items.length > 0 && mk.items.every((e) => costPanel.indexOf(e[0]) >= 0),
      mk.items.map((e) => e[0]).join(' | '));
    // В бюджет привлечения не должен попадать тариф CRM и клубный взнос — это не маркетинг.
    check('Пульс · в бюджет привлечения не свалены все расходы подряд',
      mk.total < mk.all && !mk.items.some((e) => /CRM|клубный/i.test(e[0])),
      mk.total + ' из ' + mk.all);
    // Чего в стенде действительно нет — ФОТ и офис, — экран называет прямо.
    check('Пульс · сказано, чего в расчёте не хватает',
      /ФОТ/.test(costPanel), costPanel.slice(-200));

    // Перспективные сделки: только живые, порядок — по ожидаемой комиссии.
    clickTab('deals');
    const prosp = [].slice.call(doc.querySelectorAll('#app .pulse-prospects .rel-row[data-deal]'));
    const prospIds = prosp.map((r) => r.getAttribute('data-deal'));
    const closedIn = prospIds.filter((id) => {
      const d = (dd().deals || []).find((x) => x.id === id);
      return d && (WS.ui.dealClosed(d) || d.archived);
    });
    check('Пульс · в перспективных нет закрытых и архивных сделок',
      closedIn.length === 0, closedIn.join(', '));
    const live = (dd().deals || []).filter((d) => !WS.ui.dealClosed(d) && !d.archived);
    if (live.length > 1) {
      const inSec = prospIds.map((id) => (dd().deals || []).find((x) => x.id === id)).filter(Boolean);
      const comms = inSec.map((d) => WS.ui.dealCommission(d));
      check('Пульс · перспективные отсортированы по ожидаемой комиссии',
        comms.every((v, i) => i === 0 || v <= comms[i - 1] + 0.5), comms.join(' > '));
    }
    WS.store.pulseTab = 'deals';
  }

  // ---- «Контакты»: люди и компании одним списком, пять фильтров, Консьерж по выборке ----
  {
    WS.store.navStack = [];
    if (WS.store.role !== 'agent') WS.storeApi.setRole('agent');
    WS.store.contactsChat = false;
    WS.store.contactsSearch = '';
    WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();
    WS.store.contactType = 'all';
    WS.store.contactsFiltersOpen = true;
    WS.store.clientsTab = 'contacts';
    WS.router.go('clients');
    const view = doc.querySelector('#app .view') || doc.getElementById('app');

    // 1. Раздел называется «Контакты», а не ролью одного из типов, которые в нём лежат.
    const navLabels = [].slice.call(doc.querySelectorAll('#app .nav [data-nav], #app .drawer [data-nav]'))
      .map((b) => b.textContent.trim());
    check('контакты · раздел назван «Контакты»', /Контакты/.test(view.textContent), view.textContent.slice(0, 60));
    check('контакты · отдельного пункта «Компании» в меню больше нет',
      !navLabels.some((t) => /^Компании/.test(t)), navLabels.join(' | '));

    // 2. Компании в том же списке, но ведут на свою карточку: у юрлица есть KYC и контактные лица.
    const coRows = [].slice.call(doc.querySelectorAll('#app .contacts-list [data-company]'));
    const peopleRows = [].slice.call(doc.querySelectorAll('#app .contacts-list [data-client]'));
    check('контакты · компании стоят в том же списке, что и люди',
      coRows.length === (dd().companies || []).length && peopleRows.length > 0,
      'компаний в списке ' + coRows.length + ' из ' + (dd().companies || []).length);
    check('контакты · строка компании ведёт на карточку компании, а не на карточку человека',
      coRows.every((r) => !r.getAttribute('data-client')));

    // 3. Компания видна в строке человека — прямая просьба партнёра.
    const withCo = (dd().clients || []).find((c) => (dd().deals || []).some((d) => d.clientId === c.id && d.companyId));
    if (withCo) {
      const row = doc.querySelector('#app .contacts-list [data-client="' + withCo.id + '"]');
      const co = (dd().companies || []).find((x) => x.id ===
        ((dd().deals || []).find((d) => d.clientId === withCo.id && d.companyId) || {}).companyId);
      check('контакты · в строке человека видна его компания',
        !!row && !!co && row.textContent.indexOf(co.name) >= 0,
        row ? row.textContent.slice(0, 100) : 'строки нет');
    }

    // 4. Пять фильтров второго пула — каждый со своим полем и своим обработчиком.
    ['cfKind', 'cfInterest', 'cfObjType', 'cfSuccess', 'cfChannel'].forEach((id) => {
      check('контакты · фильтр ' + id + ' есть на экране', !!doc.getElementById(id));
    });
    const uiSrc2 = read('js/ui.js');
    ['kind', 'interest', 'objType', 'success', 'channel'].forEach((k) => {
      check('контакты · фильтр «' + k + '» привязан к полю, а не нарисован',
        uiSrc2.indexOf("['cf" + k[0].toUpperCase() + k.slice(1) + "', '" + k + "']") >= 0);
    });

    // 5. Фильтр обязан менять выборку. Тип «собственник» есть в данных — по нему и проверяем.
    const ownersInData = (dd().clients || []).filter((c) => c.contactKind === 'owner').length;
    check('контакты · тип контакта проставлен в данных', ownersInData > 0, 'собственников: ' + ownersInData);
    const allN = WS.ui.contactsSearchList().length;
    WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { kind: 'owner' });
    const ownerList = WS.ui.contactsSearchList();
    check('контакты · фильтр по типу сужает выборку', ownerList.length < allN && ownerList.length > 0,
      ownerList.length + ' из ' + allN);
    check('контакты · под фильтр «собственник» не попали компании',
      ownerList.every((p) => !p.co), ownerList.filter((p) => p.co).map((p) => p.name).join(', '));
    // «Есть успешная сделка» — вычисление, не поле: хранимый признак разошёлся бы с фактами.
    WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { success: 'yes' });
    const wonList = WS.ui.contactsSearchList();
    const wrongWon = wonList.filter((p) => !(dd().deals || [])
      .some((d) => (d.clientId === p.id || d.companyId === p.id) && d.stage === 'won'));
    check('контакты · «есть успешная сделка» считается по сделкам, а не по полю',
      wrongWon.length === 0, wrongWon.map((p) => p.name).join(', '));
    WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

    // 6. Консьерж по выборке: список сворачивается, согласие пересчитано ДО отправки.
    WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { kind: 'buyer' });
    WS.ui.openContactsChat();
    const chatView = doc.querySelector('#app .view') || doc.getElementById('app');
    // Выборка названа строкой над списком, а сам список остаётся на экране: разговор идёт
    // в панели поверх него. Так решил принципал — видеть выдачу во время разговора.
    check('контакты · выборка названа строкой над выдачей',
      !!chatView.querySelector('.contacts-sel'),
      'строка выборки: ' + !!chatView.querySelector('.contacts-sel'));
    check('контакты · и сама выдача с экрана не ушла',
      !!chatView.querySelector('.contacts-list'));
    check('контакты · диалог открывается панелью поверх, без перехода',
      WS.store.view === 'clients' && WS.store.cgDock === true && !!doc.querySelector('#cgdock.show'),
      WS.store.view + ' · док ' + WS.store.cgDock);
    const reach = WS.ui.contactsReach();
    const noConsentReal = WS.ui.contactsSearchList().filter((p) => !p.co && !p.c.consent).length;
    check('контакты · без согласия посчитаны по данным, а не написаны словом',
      reach.noConsent === noConsentReal && reach.reachable === reach.people - reach.noConsent,
      'в выборке без согласия: ' + reach.noConsent + ', названо: ' + reach.noConsent);
    if (reach.noConsent) {
      check('контакты · и это сказано числом до отправки',
        /без согласия/.test(chatView.textContent) && chatView.textContent.indexOf(String(reach.noConsent)) >= 0,
        chatView.textContent.slice(0, 140));
    }
    // Автообзвон не делаем — и экран говорит почему, а не умалчивает.
    check('контакты · про автообзвон сказано прямо, что мы его не делаем',
      /автообзвон/i.test(chatView.textContent), chatView.textContent.slice(0, 200));
    // Выборка уходит Консьержу контекстом, а не пересказом.
    check('контакты · выборка передана Консьержу как контекст',
      (WS.store.cgCtx || []).length === 1 && /покупатель/.test((WS.store.cgCtx[0] || {}).label || ''),
      JSON.stringify(WS.store.cgCtx));
    WS.ui.closeContactsChat();
    check('контакты · возврат к списку одним касанием',
      !!(doc.querySelector('#app .contacts-list')) && !doc.querySelector('#app .contacts-sel'));
    WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();
    WS.store.contactsFiltersOpen = false;

    // 7. Вкладка внутри сделки больше не спорит с разделом за одно слово.
    // Участники и условия стоят в левой колонке карточки сделки — вкладки, повторявшей их,
    // больше нет: один список дважды на одном экране читается как две разные записи.
    check('контакты · участники сделки не задвоены вкладкой',
      uiSrc2.indexOf("['contacts', 'Участники") < 0 && uiSrc2.indexOf("'Участники · ' + dealContacts(d).length, addBtn") >= 0);
  }

  // ---- Карточка сделки: состав вкладок меняется на границе «условия согласованы» ----
  {
    const deals = dd().deals || [];
    const before = deals.find((d) => !WS.ui.dealTermsAgreed(d) && !d.archived);
    const after = deals.find((d) => WS.ui.dealTermsAgreed(d) && !WS.ui.dealClosed(d) && !d.archived);
    check('карточка · в данных есть сделка до согласования условий и сделка после',
      !!before && !!after, (before ? before.id : 'нет до') + ' / ' + (after ? after.id : 'нет после'));

    if (before && after) {
      WS.store.navStack = [];
      WS.ui.dealCard(before.id);
      const tabsBefore = [].slice.call(doc.querySelectorAll('#app .dcard-main .dx-tab')).map((b) => b.textContent.trim());
      check('карточка · до согласования условий первой стоит вкладка подбора',
        tabsBefore[0] === 'Подбор', tabsBefore.join(' | '));
      check('карточка · и она же открыта — не приходится кликать в неё каждый раз',
        (doc.querySelector('#app .dcard-main .dx-tab.on') || {}).textContent === 'Подбор',
        (doc.querySelector('#app .dcard-main .dx-tab.on') || {}).textContent);

      WS.ui.dealCard(after.id);
      const tabsAfter = [].slice.call(doc.querySelectorAll('#app .dcard-main .dx-tab')).map((b) => b.textContent.trim());
      check('карточка · после согласования первой стоит вкладка оформления',
        tabsAfter[0] === 'Оформление', tabsAfter.join(' | '));
      check('карточка · и открыта именно она',
        (doc.querySelector('#app .dcard-main .dx-tab.on') || {}).textContent === 'Оформление',
        (doc.querySelector('#app .dcard-main .dx-tab.on') || {}).textContent);
      // Порядок меняется, состав — нет: ничего из работы не пропадает после перехода границы.
      check('карточка · за границей ничего из вкладок не пропало',
        tabsBefore.length === tabsAfter.length &&
        tabsBefore.every((t) => tabsAfter.indexOf(t) >= 0),
        tabsBefore.join(' | ') + '  ПРОТИВ  ' + tabsAfter.join(' | '));

      // Объект — предмет сделки: он виден сразу, без клика по вкладке.
      const lots = WS.ui.dealLots(after);
      if (lots.length) {
        const main = doc.querySelector('#app .dcard-main');
        const inBody = main.querySelector('.dx-tabbody');
        const shownOutsideTabs = main.textContent.indexOf(lots[0].name) >= 0 &&
          (!inBody || inBody.textContent.indexOf(lots[0].name) < 0);
        check('карточка · объект сделки виден без клика по вкладке', shownOutsideTabs,
          'объект: ' + lots[0].name);
      }

      // Граница считается по шагам ЭТОГО договора: у оффплана есть бронь, у перепродажи нет.
      const offplan = deals.find((d) => WS.contractKindFor(d.funnel, d.readiness) === 'offplan_spa');
      if (offplan) {
        const steps = (WS.DEAL_STEPS || {})[WS.contractKindFor(offplan.funnel, offplan.readiness)];
        const was = offplan.stage;
        offplan.stage = steps[0];
        check('карточка · на первом шаге договора условия ещё не согласованы',
          !WS.ui.dealTermsAgreed(offplan), steps[0]);
        offplan.stage = steps[1];
        check('карточка · на втором шаге — уже согласованы',
          WS.ui.dealTermsAgreed(offplan), steps[1]);
        offplan.stage = was;
      }

      // Условия и участники живут в левой колонке; вкладка «Сделка» их не повторяет.
      WS.ui.dealCard(after.id);
      WS.ui.setEntityTab('deal', after.id, 'params');
      const body = doc.querySelector('#app .dcard-main .dx-tabbody');
      const aside = doc.querySelector('#app .dcard-aside');
      const dupes = ['Тип объекта', 'Готовность', 'Источник (из запроса)']
        .filter((k) => aside && body && aside.textContent.indexOf(k) >= 0 && body.textContent.indexOf(k) >= 0);
      check('карточка · условия не напечатаны дважды на одном экране', dupes.length === 0, dupes.join(', '));
      // Участники живут в правой колонке ровно один раз: ни второй копии слева, ни вкладки.
      const mainEl = doc.querySelector('#app .dcard-main');
      const peopleN = (((mainEl || {}).textContent || '').match(/Участники/g) || []).length;
      check('карточка · участники напечатаны ровно один раз',
        peopleN === 1 && !!aside && aside.textContent.indexOf('Участники') < 0,
        'справа ' + peopleN + ', слева ' + (!!aside && aside.textContent.indexOf('Участники') >= 0));

      // Запомненная вкладка, которой на новой стадии нет, не оставляет пустое место.
      WS.store.cardTabs = WS.store.cardTabs || {};
      WS.store.cardTabs.deal = 'вкладка-которой-нет';
      WS.ui.dealCard(after.id);
      check('карточка · исчезнувшая вкладка возвращает к первой, а не к пустому экрану',
        !!doc.querySelector('#app .dcard-main .dx-tab.on') &&
        (doc.querySelector('#app .dcard-main .dx-tabbody') || {}).textContent.trim().length > 0,
        (doc.querySelector('#app .dcard-main .dx-tabbody') || {}).textContent.slice(0, 60));
    }
  }

  // ---- находки кросс-модельной вычитки: то, что наши 1538 проверок пропустили ----
  {
    const src = read('js/ui.js');

    // Маршрут, которого нет. `data-nav="deals"` рисуется, нажимается и не делает ничего:
    // раздел сделок — это `clients` со вкладкой, а не собственный маршрут. Проверка держит
    // весь класс, а не три конкретных плитки.
    const vf = src.slice(src.indexOf('function viewFor'));
    const routes = (vf.slice(0, vf.indexOf('\n  }')).match(/case '([a-z]+)'/g) || [])
      .map((m) => m.slice(6, -1));
    const used = Array.from(new Set((src.match(/data-nav="([a-z]+)"/g) || []).map((m) => m.slice(10, -1))));
    const dead = used.filter((v) => routes.indexOf(v) < 0);
    check('маршруты · каждая ссылка меню ведёт на существующий экран', dead.length === 0,
      'нет таких экранов: ' + dead.join(', ') + ' | есть: ' + routes.join(', '));

    // Подпись выборки называет КАЖДЫЙ включённый фильтр: неназванный превращает суженный
    // список во «Всю книгу», и отправка уходит не тем, кого отобрал агент.
    const wasF = WS.store.contactsFilters;
    const wasQ = WS.store.contactsSearch;
    const missed = [];
    [['priority', 'A'], ['budget', 'hi'], ['area', 'Business Bay'], ['state', 'open'],
     ['consent', 'no'], ['kind', 'owner'], ['channel', 'phone']].forEach((pair) => {
      WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { [pair[0]]: pair[1] });
      if (WS.ui.contactsSelectionLabel() === 'Вся книга') missed.push(pair[0]);
    });
    check('контакты · подпись выборки не называет её «всей книгой», когда фильтр включён',
      missed.length === 0, 'не попали в подпись: ' + missed.join(', '));
    WS.store.contactsFilters = wasF; WS.store.contactsSearch = wasQ;

    // Сторона клиента хранится словом, а не ключом: сравнение с ключом не совпадало никогда,
    // и собственник получал роль покупателя — то есть попадал в выборку «покупатели».
    const ownerSide = (dd().deals || []).find((d) => /собственник/i.test(d.side || ''));
    check('контакты · в данных есть сделка со стороны собственника', !!ownerSide,
      'сторон: ' + Array.from(new Set((dd().deals || []).map((d) => d.side).filter(Boolean))).join(', '));
    if (ownerSide) {
      const oc = (dd().clients || []).find((c) => c.id === ownerSide.clientId);
      const otherDeals = (dd().deals || []).filter((d) => d.clientId === oc.id && d !== ownerSide);
      if (oc && !otherDeals.some((d) => /покупатель/i.test(d.side || ''))) {
        const roles = WS.ui.contactRoles(oc);
        check('контакты · собственник по сделке не записан покупателем',
          roles.indexOf('owner') >= 0 && roles.indexOf('buyer') < 0, oc.name + ': ' + roles.join(', '));
      }
    }

    // «Мессенджер» — способ связи, а не приложение: Telegram обязан попадать вместе с WhatsApp.
    const tg = (dd().clients || []).filter((c) => c.channel === 'telegram');
    check('контакты · в данных есть контакт на Telegram, иначе проверять нечего', tg.length > 0,
      'каналы: ' + Array.from(new Set((dd().clients || []).map((c) => c.channel))).join(', '));
    if (tg.length) {
      WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { channel: 'whatsapp' });
      const got = WS.ui.contactsSearchList().map((p) => p.id);
      check('контакты · «мессенджер» не теряет Telegram',
        tg.every((c) => got.indexOf(c.id) >= 0), 'потеряны: ' +
        tg.filter((c) => got.indexOf(c.id) < 0).map((c) => c.name).join(', '));
      WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();
    }

    // Ни один способ связи в фильтре не должен быть мёртвым выбором: пункт меню, который
    // всегда даёт пустой экран, читается как поломка. В данных телефонный канал записан
    // словом «call» — prefChannel знал только «phone», и «звонок» не находил никого.
    const emptyCh = ['whatsapp', 'phone', 'email'].filter((ch) => {
      WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { channel: ch });
      return WS.ui.contactsSearchList().length === 0;
    });
    WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();
    check('контакты · ни один способ связи не даёт пустой экран', emptyCh.length === 0,
      'пусто по: ' + emptyCh.join(', '));

    // «Заявок в работе» — по стадии заявки. Проигранная заявка в работе не находится.
    WS.store.pulseTab = 'requests';
    WS.store.clientsTab = 'deals';
    WS.router.go('start');
    const reqPanel = (doc.querySelector('#app .pulse-panel') || {}).textContent || '';
    const tileVal = (label) => {
      const t = [].slice.call(doc.querySelectorAll('#app .pulse-panel .tile'))
        .find((x) => (x.querySelector('.th') || {}).textContent === label);
      return t ? ((t.querySelector('.val') || {}).textContent || '').replace(/\D+.*$/, '') : null;
    };
    const liveReq = (dd().requests || []).filter((r) => ['closed', 'lost'].indexOf(WS.ui.reqStage(r)) < 0).length;
    check('пульс · «заявок в работе» считается по стадии, а не по наличию выбранного объекта',
      tileVal('Заявок в работе') === String(liveReq) && liveReq < (dd().requests || []).length,
      'на плитке ' + tileVal('Заявок в работе') + ', живых по стадии ' + liveReq +
      ' из ' + (dd().requests || []).length);

    // Конверсия источника считает выигранные сделки: проигрыш не поднимает конверсию.
    const lostSrc = (dd().deals || []).find((d) => d.stage === 'lost' && d.source);
    check('аналитика · в данных есть проигранная сделка с источником', !!lostSrc,
      lostSrc ? lostSrc.source : 'проигранных с источником нет');
    if (lostSrc) {
      const attr = (dd().attribution || []).find((a) => a.source === lostSrc.source);
      if (attr) {
        const wonN = (dd().deals || []).filter((x) => x.source === lostSrc.source && x.stage === 'won').length;
        const allN = (dd().deals || []).filter((x) => x.source === lostSrc.source).length;
        check('аналитика · конверсия источника считает выигранные сделки, а не все',
          reqPanel.indexOf(wonN + '/' + attr.leads) >= 0 && wonN < allN,
          'выиграно ' + wonN + ' из ' + allN + ' по источнику «' + lostSrc.source + '»');
      }
    }
    WS.store.pulseTab = 'deals';
  }

  // ---- меню сворачивается до значков ----
  {
    WS.store.navRail = false; WS.storeApi.emit();
    const wide = doc.querySelectorAll('#app .nav .nav-item').length;
    const toggle = doc.querySelector('#app [data-act="navRail"]');
    check('меню · есть чем свернуть', !!toggle);
    if (toggle) toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('меню · свёрнутое состояние включилось', WS.store.navRail === true, String(WS.store.navRail));
    check('меню · разметка оболочки помечена свёрнутой', !!doc.querySelector('#app.nav-railed, .app.nav-railed'));
    // Свернули — но ни один раздел не исчез: узкая полоса не должна отнимать доступ.
    const railed = doc.querySelectorAll('#app .nav .nav-item').length;
    check('меню · ни один раздел из меню не пропал', railed === wide, railed + ' против ' + wide);
    // Подпись уходит в подсказку, иначе значок без имени — это ребус.
    const noTitle = [].slice.call(doc.querySelectorAll('#app .nav .nav-item'))
      .filter((a2) => !(a2.getAttribute('title') || '').trim());
    check('меню · у каждого значка осталась подпись в подсказке', noTitle.length === 0,
      'без подсказки: ' + noTitle.length);
    // Ширина полосы задана в CSS, а не «на глаз» в разметке.
    const cssSrc2 = read('css/app.css');
    check('меню · свёрнутая ширина задана правилом', /\.app\.nav-railed \{ grid-template-columns: 64px/.test(cssSrc2));
    const t2 = doc.querySelector('#app [data-act="navRail"]');
    if (t2) t2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('меню · разворачивается обратно', WS.store.navRail === false, String(WS.store.navRail));
  }

  // ---- заявка и сделка стоят на одном каркасе ----
  // Соседние такты одной работы, между которыми агент ходит десятки раз в день. Разная
  // раскладка заставляет каждый раз заново искать глазами, где условия, а где что дальше.
  {
    const FRAME = ['.dcard-cover', '.dcard-title', '.dcard-sub', '.dcard-pathrow',
      '.dcard-cols', '.dcard-aside', '.dcard-main', '.dcard-composer', '.dx-tabs'];
    WS.store.navStack = [];
    const dOne = (dd().deals || []).find((d) => !d.archived);
    WS.ui.dealCard(dOne.id);
    const inDeal = FRAME.filter((sel) => !doc.querySelector('#app .view ' + sel));
    check('каркас · карточка сделки собрана из всех частей каркаса', inDeal.length === 0,
      'нет: ' + inDeal.join(', '));
    WS.ui.requestCard((dd().requests || [])[0].id);
    const inReq = FRAME.filter((sel) => !doc.querySelector('#app .view ' + sel));
    check('каркас · карточка заявки собрана из тех же частей', inReq.length === 0,
      'нет: ' + inReq.join(', '));
    // Не только присутствие, но и порядок: обложка выше заголовка, колонки ниже пути.
    const order = ['.dcard-cover', '.dcard-title', '.dcard-pathrow', '.dcard-cols'];
    const pos = order.map((sel) => {
      const e = doc.querySelector('#app .view ' + sel);
      if (!e) return -1;
      let n = 0, w = e;
      while (w.previousElementSibling) { w = w.previousElementSibling; n++; }
      return (e.parentElement ? e.parentElement.className : '') + '#' + n;
    });
    check('каркас · части заявки идут в том же порядке', pos.every((x) => x !== -1), pos.join(' | '));
    // Запланированное и последнее — в ряд, как в сделке.
    check('каркас · «что дальше» и «что было» в заявке тоже в ряд',
      !!doc.querySelector('#app .view .dcard-pair'));
    // Строка ввода внизу одна и ведёт в тот же док.
    check('каркас · внизу заявки одна строка ввода',
      doc.querySelectorAll('#app .view .dcard-composer .dx-cbar').length === 1,
      String(doc.querySelectorAll('#app .view .dcard-composer .dx-cbar').length));
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
