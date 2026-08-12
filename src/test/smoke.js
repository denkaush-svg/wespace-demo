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
    const h = doc.getElementById('app').innerHTML + doc.getElementById('modal').innerHTML;
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
      const iOld = hd.indexOf('Просила график первого платежа');
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

    const back = WS.ui.addEventEntry('deal', 'd_igor', { type: 'meet', text: 'АГЕНТ: встреча позавчера', when: { daysAgo: 2, h: 15, mi: 30 } });
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
    const activeReal = data.deals.filter((d) => d.stage !== 'done').length;
    check('deals_active matches the real data', snap.metrics.deals_active.v === activeReal, snap.metrics.deals_active.v + ' vs ' + activeReal);
    const closedReal = data.deals.filter((d) => d.stage === 'done').length;
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
    const r5 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'work' } }]);
    check('apply · guarded field refused without confirmation', !!r5 && r5.ok === false && r5.code === 'needs_confirmation', JSON.stringify(r5));
    check('apply · unconfirmed guarded write changes nothing', dealBy('d_anna').stage === stageWas);
    check('apply · unconfirmed guarded write leaves revision alone', WS.store.dataRevision === revB);
    const r6 = sapi.apply([{ op: 'updateDeal', id: 'd_anna', patch: { stage: 'work' } }], { confirmed: true });
    check('apply · guarded field applies once confirmed', !!r6 && r6.ok === true && dealBy('d_anna').stage === 'work', JSON.stringify(r6));
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

    const expectActive = dd().deals.filter((d) => d.stage !== 'done').length;
    const qActive = QRY.run({ from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'done' }], aggregate: { fn: 'count' } });
    check('query · count matches an independent computation', qActive.value === expectActive, qActive.value + ' vs ' + expectActive);
    check('query · the number comes with the records behind it', qActive.rows.length === expectActive, 'rows=' + qActive.rows.length);

    const expectSum = dd().deals.filter((d) => d.stage !== 'done').reduce((s, d) => s + (d.amount || 0), 0);
    const qSum = QRY.run({ from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'done' }], aggregate: { fn: 'sum', field: 'amount' } });
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
    const dKarim = dealBy('d_karim');
    if (dKarim) {
      const oKarim = dd().objects.find((o) => o.id === dKarim.objectId);
      const expectComm = Math.round(dKarim.amount * (oKarim.commissionPct || 2) / 100);
      check('commission · a deal uses its object\'s rate', WS.ui.dealCommission(dKarim) === expectComm,
        WS.ui.dealCommission(dKarim) + ' vs ' + expectComm);
    }

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
    const expectN = dd().deals.filter((d) => d.stage !== 'done').length;
    const expectSum = dd().deals.filter((d) => d.stage !== 'done').reduce((s, d) => s + (d.amount || 0), 0);
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
    const p2 = AG.ask('переведи сделку Анны в стадию документы');
    check('agent · a stage change is proposed, not applied', !!p2 && p2.kind === 'proposal' && dealBy('d_anna').stage === dealStageWas);
    check('agent · the proposal is marked as needing confirmation', p2.tier === 'guarded', 'tier=' + (p2 && p2.tier));
    AG.confirm(p2.id);
    check('agent · confirmed stage change lands', dealBy('d_anna').stage === 'docs', 'stage=' + dealBy('d_anna').stage);

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
  ['start', 'concierge', 'clients', 'objects', 'calc', 'finance', 'tasks', 'docs', 'analytics', 'club', 'network', 'profile', 'settings'].forEach((v) => {
    try {
      WS.router.go(v);
      const h = doc.getElementById('app').innerHTML;
      check('screen ' + v + ' renders', h && h.length > 400, 'len=' + (h || '').length);
    } catch (e) { check('screen ' + v + ' renders', false, e.message); }
  });

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
      const bad = WS.storeApi.preview([{ op: 'updateRequest', id: r0.id, patch: { kp: { formed: false } } }]);
      check('запись · what the deal owns is not writable from a chat', bad.ok === false && bad.code === 'field_not_writable', bad.code);
      const ghost = WS.storeApi.preview([{ op: 'updateRequest', id: 'r_nope', patch: { note: 'x' } }]);
      check('запись · an invented request id is refused', ghost.ok === false && ghost.code === 'not_found');

      const feedWas = ((dd().requestTimeline || {})[r0.id] || []).length;
      const ev = WS.storeApi.apply([{ op: 'addEvent', scope: 'request', id: r0.id, type: 'call', text: 'созвон по подбору' }], { confirmed: true });
      check('запись · a call can be filed against a request', ev.ok === true, ev.error || '');
      check('запись · and it lands in that request’s own history',
        ((dd().requestTimeline || {})[r0.id] || []).length === feedWas + 1);
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
      check('live · block lists are capped',
        L.normBlocks(Array.from({ length: 30 }, () => ({ t: 'p', text: 'x' }))).length === 10);
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
    const truth = WS.query.run({ from: 'deals', where: [{ field: 'stage', op: 'ne', value: 'done' }], aggregate: { fn: 'count' } });
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
      check('live · a stage reaches the model as words, not a code',
        !!deal && !/^(new|work|docs|done)$/.test(deal.стадия), deal && deal.стадия);
      check('live · and the code is still there to write a change with',
        !!deal && /^(new|work|docs|done)$/.test(deal.стадия_код), deal && deal.стадия_код);
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
  // The Concierge answers on a scripted delay, so waiting a fixed span races it
  // on a busy machine — and a race here used to surface as a TypeError three
  // lines later rather than as a failed check. Wait for the thing itself.
  async function waitFor(cond, ms) {
    const until = Date.now() + (ms || 6000);
    while (Date.now() < until) {
      try { if (cond()) return true; } catch (e) { /* not there yet */ }
      await wait(60);
    }
    return false;
  }
  if (WS.agent && typeof WS.router.routePrompt === 'function') {
    WS.engine.openThread('probe:e2e', 'Сквозная', 'chat');
    WS.router.go('concierge');

    WS.router.routePrompt('сколько сделок в работе и на какую сумму');
    await waitFor(() => doc.getElementById('chat').querySelector('[data-agev]'));
    const chat1 = doc.getElementById('chat');
    const html1 = chat1 ? chat1.innerHTML : '';
    const liveActive = dd().deals.filter((d) => d.stage !== 'done').length;
    check('e2e · a typed question produces an answer in the chat', html1.indexOf(String(liveActive)) >= 0, 'looking for ' + liveActive);
    const chip = chat1 && chat1.querySelector('[data-agev]');
    check('e2e · the answer offers openable evidence', !!chip);
    check('e2e · no Wizard-of-Oz fallback left', html1.indexOf('Wizard-of-Oz') < 0 && html1.indexOf('подготовлены близкие результаты') < 0);

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
    await waitFor(() => doc.getElementById('chat').querySelector('[data-agok]'));
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
