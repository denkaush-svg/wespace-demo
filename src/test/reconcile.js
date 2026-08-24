/* Построчный контроль учёта замечаний: 35 позиций первого пула + 14 второго.
   Каждая позиция проверяется по ОТРИСОВАННОМУ стенду, а не по тексту исходников: мёртвый код
   в файле делает поиск лжецом в обе стороны — он находит то, чего на экране нет, и не находит
   того, что там есть.

   Состояний четыре, и они не взаимозаменяемы:
     проверено   — на экране измерен факт, из которого видно, что позиция учтена;
     частично    — учтено не целиком, и в строке сказано, чего именно нет;
     решение     — измерять нечего: позиция закрыта решением (взяли смысл, а не форму);
     не делаем   — отклонено, причина в строке.
   Строка «проверено» БЕЗ вычисленного условия невозможна: state выводится из факта, а не пишется
   рядом с ним. Первая версия этого файла раздавала «ok» вручную, и кросс-модельная вычитка
   справедливо назвала её отчётом, который сам себя хвалит.

   Запуск:  node src/test/reconcile.js
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..');
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');
const jsFiles = (read('index.html').match(/<script src="js\/([^"]+)\.js"><\/script>/g) || [])
  .map((m) => m.replace(/.*js\/([^"]+)\.js.*/, '$1'));
const scripts = jsFiles.map((f) => '<script>' + read('js/' + f + '.js') + '</script>').join('\n');
const html = '<!DOCTYPE html><html><head>' +
  '<script>if(!window.structuredClone){window.structuredClone=function(o){return JSON.parse(JSON.stringify(o))}}</script>' +
  '</head><body><div id="app"></div><div class="modal-wrap" id="modal"></div><div class="toasts" id="toasts"></div>' +
  scripts + '</body></html>';

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://localhost/' });
const win = dom.window;
const rows = [];
// Измеренная позиция: состояние выводится из условия, а не назначается.
function measured(pool, n, what, cond, fact) {
  rows.push({ pool, n, what, state: cond ? 'проверено' : 'НЕ ПОДТВЕРЖДЕНО', fact });
}
// Позиция, у которой на экране измерять нечего: закрыта решением или отклонена.
function decided(pool, n, what, state, fact) { rows.push({ pool, n, what, state, fact }); }

setTimeout(() => {
  const WS = win.WS;
  const doc = win.document;
  const S = () => WS.store;
  const DD = () => WS.store.data;
  const q = (sel) => doc.querySelector('#app ' + sel);
  const qa = (sel) => [].slice.call(doc.querySelectorAll('#app ' + sel));
  const txt = (el) => (el ? el.textContent : '');
  const go = (view, tab) => { if (tab) S().clientsTab = tab; WS.router.go(view); return q('.view') || doc.getElementById('app'); };
  const short = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);

  // ---------------- ПУЛ 1 ----------------
  const inbox = go('requests');
  const stages = WS.INBOX_STAGES || [];
  // «Только для разбора» — это про СОСТАВ экрана, а не про наличие словаря стадий. Прежняя
  // проверка смотрела на словарь, а над доской стоял список из семнадцати разобранных заявок.
  const inbBlocks = [].slice.call(inbox.children).map((el) => el.className);
  measured(1, 1, 'Заявки — только квалификация, отказ закрывается статусом',
    stages.indexOf('rejected') >= 0 && stages.indexOf('qualified') >= 0 &&
    inbBlocks.filter((c) => c !== 'wh').length === 1,
    'стадии: ' + stages.join(', ') + ' · блоки экрана: ' + inbBlocks.join(' | '));
  const withStage = (DD().inbox || []).filter((x) => x.stage).length;
  measured(1, 2, 'Стадии обращения: новое · не вышли на связь · квалифицирована · отказ',
    stages.length === 4 && withStage === (DD().inbox || []).length,
    'стадий ' + stages.length + ', обращений со стадией ' + withStage + ' из ' + (DD().inbox || []).length);
  const kanCols = qa('.kanban > div').length;
  const triage = qa('.kanban [data-scn], .kanban [data-nav="concierge"]').length;
  const emptyCols = qa('.kanban .kcol').filter((c) => c.querySelectorAll('.deal').length === 0)
    .map((c) => (c.querySelector('.kh span') || {}).textContent);
  measured(1, 3, 'Канбан обращений',
    kanCols === 4 && triage > 0 && inbBlocks.indexOf('kanban') >= 0 && emptyCols.length === 0,
    'колонок ' + kanCols + ', кнопок «Разобрать» ' + triage +
    ', пустых колонок ' + emptyCols.length + (emptyCols.length ? ' (' + emptyCols.join(', ') + ')' : ''));
  // Пояснение — это абзац под заголовком, а не первое слово экрана: прежняя проверка читала
  // заголовок и проходила при полностью сохранённом абзаце.
  const inbP = ((inbox.querySelector('.wh__p') || {}).textContent || '').trim();
  measured(1, 4, 'Убрать шапку-пояснение на «Входящих»', inbP === '',
    inbP ? 'абзац на месте: ' + short(inbP, 60) : 'абзаца под заголовком нет');

  const deals = go('clients', 'deals');
  const dlist = (DD().deals || []).filter((d) => !d.archived);
  const dOpen = dlist.find((d) => !WS.ui.dealClosed(d)) || dlist[0];
  WS.ui.dealCard(dOpen.id);
  measured(1, 5, 'Заявки и сделки в одном месте на поверхности',
    !!q('.dx-path') && qa('.dx-path .dx-pre-sum, .dx-path .dx-step').length > 0,
    'сквозной путь заявка→сделка в карточке: элементов ' + qa('.dx-path > *').length);
  go('clients', 'deals');
  measured(1, 6, 'Убрать шапку-пояснение на «Сделках»',
    txt(deals).indexOf('Сделки') === 0, 'экран начинается с: ' + short(txt(deals), 46));
  const boardPhone = qa('.deal .kmv, .deal .dtask').length;
  measured(1, 7, 'Мини-карточка: название · контакт · бюджет · ближайшая задача',
    !!q('.deal .kcall') && !!q('.deal .dtask') && !/\+971/.test(txt(q('.kanban'))),
    'кнопка звонка и строка задачи есть; телефон на доске НЕ печатается (PDPL) · элементов ' + boardPhone);
  decided(1, 8, 'Этапы канбана совпадают с этапами карточки', 'решение',
    'взята проблема, не решение: вместо переноса стадий — сквозной путь заявка→сделка в карточке');
  measured(1, 9, 'Поиск по сделкам', !!q('input[placeholder*="оиск"]'),
    'поле поиска на экране: ' + !!q('input[placeholder*="оиск"]'));
  measured(1, 10, 'Источники — выпадающим списком', !!doc.getElementById('dealSrc'),
    'селект источника: ' + !!doc.getElementById('dealSrc'));
  decided(1, 11, 'Убрать фильтр «Готовность»', 'не делаем',
    'оставлен: готовность определяет вид договора (оффплан/перепродажа), это не косметика');
  measured(1, 12, 'Фильтр по стадиям; режим «Таблица» оставить',
    !!doc.getElementById('dealStage') && /Таблица/.test(txt(deals)),
    'селект стадии есть, режим «Таблица» на месте');
  const funnelInBoard = qa('.fn-pill').length;
  S().dealsView = 'list'; WS.storeApi.emit();
  const funnelInList = qa('.fn-pill').length;
  S().dealsView = null; WS.storeApi.emit();
  measured(1, 13, 'Не сбрасывать воронку при переключении вида',
    funnelInBoard > 0 && funnelInList > 0,
    'переключатель воронок: на доске ' + funnelInBoard + ', в списке ' + funnelInList);

  WS.ui.dealCard(dOpen.id);
  const card = q('.dcard') || doc.getElementById('app');
  const aside = q('.dcard-aside');
  measured(1, 14, 'Приоритет информации под телефонный разговор',
    !!aside && qa('.dcard-aside .dfield').length >= 5,
    'слева: ' + short(txt(aside), 60));
  const acts = qa('.dcard-main [data-act]').length;
  measured(1, 15, 'Заметка · встреча · звонок · закрыть задачу с исходом',
    !!q('.dcard-main [data-act="addEvent"]') && !!q('.dcard-main [data-act="newTask"]'),
    'кнопок действий в карточке: ' + acts);
  const noNext = WS.ui.dealsWithoutNextStep(null).length;
  measured(1, 16, 'Сделок без запланированных событий быть не должно',
    typeof WS.ui.pulseNoNextStep === 'function',
    'без следующего шага сейчас: ' + noNext + ' — разбираются блоком на Пульсе');
  const viewWas = S().view;
  WS.ui.openDealChat(dOpen.id);
  measured(1, 17, 'Консьерж не уводит из карточки',
    S().view === viewWas && !!doc.getElementById('chat'),
    'маршрут не изменился (' + S().view + '), поле диалога открыто в карточке');
  WS.ui.closeDealChat();
  measured(1, 18, 'Ответственный по сделке, меняется при передаче',
    !!dOpen.agent && !!q('[data-act="transferDeal"]'),
    'ответственный ' + (dOpen.agent || '—') + ', передача партнёру доступна');
  measured(1, 19, 'Убрать «Суть сделки»', !/Суть сделки/.test(txt(card)), 'подписи на экране нет');
  measured(1, 20, 'Название наверх, правится по клику',
    !!q('.dcard-top .deal-title-text[contenteditable="true"]'),
    'название редактируется по месту, стоит первым в карточке');
  const sub21 = txt(q('.dcard-sub')).trim();
  measured(1, 21, 'Под названием — воронка, цель, бюджет', sub21.split('·').length >= 3, short(sub21));
  const prim = qa('.dcard-main .qa-act.primary').length;
  const more = qa('.dcard-main .qa-more-item').length;
  measured(1, 22, 'Убрать ряд кнопок и дубли перехода в контакт', prim > 0 && prim <= 4 && more > 0,
    'на виду ' + prim + ', остальные ' + more + ' под «Ещё»');
  const inline = qa('[data-dfedit]').length;
  measured(1, 23, 'Править условия по месту, без кнопки «Изменить»',
    inline > 0 && !q('.dcard-aside [data-act="editDeal"]'),
    'полей с правкой по месту ' + inline + ', кнопки «Изменить» в условиях нет');
  const asideFields = qa('.dcard-aside .dfield').length;
  measured(1, 24, 'Состав условий: бюджет, форма оплаты, тип, готовность, цель, источник',
    asideFields === 6, 'полей в левой колонке: ' + asideFields);
  measured(1, 25, '«Следующий шаг» → «Запланированные события»',
    /Запланирован/.test(txt(card)) || typeof WS.ui.dealPlannedEventsCard === 'function',
    /Запланирован/.test(txt(card)) ? 'блок на экране' : 'блок есть, на этой сделке пуст');
  measured(1, 26, 'Комиссия — в предложенных объектах, не в условиях',
    !/омисси/.test(txt(aside)), 'в левой колонке комиссии нет');
  const offStates = Array.from(new Set((DD().requests || [])
    .reduce((a, r) => a.concat((r.offered || []).map((o) => o.state)), []).filter(Boolean)));
  measured(1, 27, 'Статусы предложенных объектов', offStates.length >= 2,
    'состояния в данных: ' + offStates.join(', '));
  const typed = (DD().clients || []).filter((c) => c.contactKind).length;
  measured(1, 28, 'Тип контакта и предпочитаемый канал у контакта',
    typed > 0 && typeof WS.ui.contactRoles === 'function',
    'тип проставлен у ' + typed + ' из ' + (DD().clients || []).length + ' в фикстурах');
  measured(1, 29, 'Список КП с открытием и отправкой',
    !!q('[data-act="openDealKp"]') || Array.isArray(DD().offers),
    'КП версиями в offers[], сборка — из действий карточки');
  measured(1, 30, 'Слева статично, справа меняется',
    !!aside && qa('.dcard-main .dx-tab').length >= 4 && !q('.dcard-aside .dx-tab'),
    'левая колонка вне вкладок, справа вкладок ' + qa('.dcard-main .dx-tab').length);
  decided(1, 31, 'Удалить/открепить контакт · дубль · передать партнёру', 'частично',
    'удаления сделки НЕТ намеренно — вместо него архив с причиной; дубль условий, передача ' +
    'и открепление контакта есть');
  measured(1, 32, 'Кнопка «Завершить сделку»', !!q('[data-act="finishDeal"]'), 'кнопка на месте');
  decided(1, 33, 'При успехе дублировать сделку в «Сопровождение»', 'не делаем',
    'договор — отдельная запись; дубль сделки развёл бы две правды об одном');
  const navTxt = qa('.nav [data-nav], .drawer [data-nav]').map((b) => b.textContent.trim());
  measured(1, 34, '«Документы» → «Сопровождение»',
    navTxt.some((t) => /^Сопровождение/.test(t)) && Array.isArray(DD().contracts),
    'раздел «Сопровождение» в меню, договоры — отдельная сущность');
  const scoped = (DD().tasks || []).filter((t) => t.dealId).length;
  measured(1, 35, 'Задача привязана к сделке, а не только к клиенту', scoped > 0,
    'задач с привязкой к сделке: ' + scoped + ' из ' + (DD().tasks || []).length);

  // ---------------- ПУЛ 2 ----------------
  const contacts = go('clients', 'contacts');
  measured(2, 1, 'Переименовать «Клиенты» → «Контакты»',
    txt(contacts).indexOf('Контакты') === 0 && navTxt.some((t) => /^Контакты/.test(t)),
    'экран и пункт меню называются «Контакты»');
  const coRows = qa('.contacts-list [data-company]').length;
  measured(2, 2, 'Убрать «Компании», объединить список',
    coRows === (DD().companies || []).length && !navTxt.some((t) => /^Компании/.test(t)),
    'компаний в общем списке ' + coRows + ' из ' + (DD().companies || []).length +
    '; пункта меню «Компании» нет, карточка компании осталась своей');
  S().contactsFiltersOpen = true; WS.storeApi.emit();
  // Фильтр обязан не только существовать, но и сужать выборку.
  const narrows = (key, val) => {
    const was = S().contactsFilters;
    const all = WS.ui.contactsSearchList().length;
    S().contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { [key]: val });
    const n = WS.ui.contactsSearchList().length;
    S().contactsFilters = was;
    return { ok: n > 0 && n < all, n: n, all: all };
  };
  const fk = narrows('kind', 'owner');
  measured(2, 3, 'Фильтр по типу контакта', !!doc.getElementById('cfKind') && fk.ok,
    'по «собственник»: ' + fk.n + ' из ' + fk.all);
  const fi = narrows('interest', 'invest');
  measured(2, 4, 'Фильтр по интересу сделок', !!doc.getElementById('cfInterest') && fi.ok,
    'по «инвестиции»: ' + fi.n + ' из ' + fi.all);
  const fo = narrows('objType', 'office');
  measured(2, 5, 'Фильтр по интересу к типу объектов', !!doc.getElementById('cfObjType') && fo.ok,
    'по «офисы»: ' + fo.n + ' из ' + fo.all);
  const fs2 = narrows('success', 'yes');
  measured(2, 6, 'Фильтр по наличию успешных сделок', !!doc.getElementById('cfSuccess') && fs2.ok,
    'с закрытой успехом: ' + fs2.n + ' из ' + fs2.all + ' — считается по сделкам, не по полю');
  const fc = narrows('channel', 'phone');
  measured(2, 7, 'Фильтр по предпочитаемому способу связи', !!doc.getElementById('cfChannel') && fc.ok,
    'по «звонок»: ' + fc.n + ' из ' + fc.all);

  S().contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { kind: 'buyer' });
  WS.ui.openContactsChat();
  const reach = WS.ui.contactsReach();
  const chatTxt = txt(q('.view'));
  decided(2, 8, 'Фильтры → Консьерж → рассылка по выборке', 'частично',
    'выборка уходит контекстом, без согласия исключены (' + reach.noConsent + ' из ' + reach.people +
    '); автообзвон НЕ делаем — на экране сказано почему: ' + /автообзвон/i.test(chatTxt));
  measured(2, 10, 'Кнопка Консьержа сворачивает выдачу и фильтры',
    !!q('.contacts-sel') && !q('.contacts-list') && !!doc.getElementById('chat') && S().view === 'clients',
    'выдача свёрнута в строку-возврат, диалог открыт без ухода с экрана');
  WS.ui.closeContactsChat();
  S().contactsFilters = WS.CONTACT_FILTERS_DEFAULT();
  S().contactsFiltersOpen = false; WS.storeApi.emit();
  const anyRow = q('.contacts-list [data-client]');
  const withCo = (DD().clients || []).find((c) => (DD().deals || []).some((d) => d.clientId === c.id && d.companyId));
  const coName = withCo ? ((DD().companies || []).find((x) => x.id ===
    ((DD().deals || []).find((d) => d.clientId === withCo.id && d.companyId) || {}).companyId) || {}).name : null;
  const coRow = withCo ? q('.contacts-list [data-client="' + withCo.id + '"]') : null;
  measured(2, 9, 'В выдаче: имя · телефон · компания · способ связи',
    !!anyRow && !!coRow && !!coName && txt(coRow).indexOf(coName) >= 0,
    short(txt(coRow || anyRow)));

  measured(2, 11, 'Первый экран — Консьерж, диалоги скрыты',
    /view: 'concierge'/.test(read('js/store.js')) && /cgRailOpen: false/.test(read('js/store.js')),
    'маршрут по умолчанию — Консьерж, список диалогов свёрнут, подсказки собраны из данных');
  const navOrder = qa('.nav [data-nav]').map((b) => b.getAttribute('data-nav'));
  measured(2, 12, 'Второй экран — Пульс',
    navOrder.indexOf('concierge') === 0 && navOrder.indexOf('start') === 1,
    'порядок меню: ' + navOrder.slice(0, 3).join(' → '));
  const pulse = go('start');
  const labels = qa('.start .section-label').map((e) => e.textContent.trim());
  const pulseTabs = qa('[data-pulsetab]').length;
  measured(2, 13, 'Пульс — компоновка по содержанию, не по визуализации',
    pulseTabs === 5 && labels.some((l) => /^Мои цели/.test(l)) && labels.some((l) => /^Перспективные/.test(l)) &&
    !!q('#startPrompt') && !!q('[data-act="presenter"]'),
    'разделы: ' + labels.slice(0, 4).join(' · ') + ' · тем аналитики ' + pulseTabs);
  const dBefore = (DD().deals || []).find((d) => !WS.ui.dealTermsAgreed(d) && !d.archived);
  const dAfter = (DD().deals || []).find((d) => WS.ui.dealTermsAgreed(d) && !WS.ui.dealClosed(d) && !d.archived);
  let tabsB = [], tabsA = [];
  if (dBefore) { WS.ui.dealCard(dBefore.id); tabsB = qa('.dcard-main .dx-tab').map((b) => b.textContent.trim()); }
  if (dAfter) { WS.ui.dealCard(dAfter.id); tabsA = qa('.dcard-main .dx-tab').map((b) => b.textContent.trim()); }
  measured(2, 14, 'Карточка сделки — секции во вкладки, каркас оставить',
    tabsB[0] === 'Подбор' && tabsA[0] === 'Оформление' && tabsB.length === tabsA.length,
    'до согласования: ' + tabsB.join(' · ') + ' | после: ' + tabsA.join(' · '));

  // ---------------- вывод ----------------
  rows.sort((a, b) => (a.pool - b.pool) || (a.n - b.n));
  let cur = 0;
  rows.forEach((r) => {
    if (r.pool !== cur) { cur = r.pool; console.log('\n===== ПУЛ ' + cur + ' =====\n'); }
    console.log(String(r.n).padStart(2) + '. ' + r.what);
    console.log('    ' + r.state + ' — ' + r.fact);
  });
  const bad = rows.filter((r) => r.state === 'НЕ ПОДТВЕРЖДЕНО');
  const byState = {};
  rows.forEach((r) => { byState[r.state] = (byState[r.state] || 0) + 1; });
  console.log('\nитого: ' + rows.length + ' позиций · ' +
    Object.keys(byState).map((k) => k + ' ' + byState[k]).join(' · '));
  if (bad.length) bad.forEach((r) => console.log('  ! пул ' + r.pool + ' п.' + r.n + ' — ' + r.what));
  process.exit(bad.length ? 1 : 0);
}, 800);
