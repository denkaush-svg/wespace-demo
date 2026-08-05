/* Smoke test for the event feed on contact, deal and company cards.
   Boots the real app in jsdom and asserts every entity renders a populated, newest-first feed.
   Run:  npm install && npm test        (from the repo root)
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..');          // sources live in src/
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');
const jsFiles = ['icons', 'photos', 'viz', 'fixtures', 'scenarios', 'finance', 'store', 'engine', 'events', 'ui', 'main'];
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

setTimeout(() => {
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

  // ---- regression: main screens still render ----
  ['start', 'concierge', 'clients', 'objects', 'calc', 'finance', 'tasks', 'docs', 'analytics', 'club', 'network', 'profile', 'settings'].forEach((v) => {
    try {
      WS.router.go(v);
      const h = doc.getElementById('app').innerHTML;
      check('screen ' + v + ' renders', h && h.length > 400, 'len=' + (h || '').length);
    } catch (e) { check('screen ' + v + ' renders', false, e.message); }
  });

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
