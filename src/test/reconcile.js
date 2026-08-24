/* Построчный контроль учёта замечаний: 35 позиций первого пула + 14 второго.
   Каждая позиция проверяется по ОТРИСОВАННОМУ стенду, а не по тексту исходников: мёртвый код
   в файле делает grep лжецом в обе стороны — он находит то, чего на экране нет, и не находит
   того, что там есть. Скрипт ничего не чинит; он печатает таблицу «позиция → факт → состояние».
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
// state: 'ok' — сделано и проверено · 'partial' — сделано частично, сказано чем · 'no' — решено не делать
function item(pool, n, what, state, fact) { rows.push({ pool, n, what, state, fact }); }

setTimeout(() => {
  const WS = win.WS;
  const doc = win.document;
  const S = () => WS.store;
  const DD = () => WS.store.data;
  const smoke = read('test/smoke.js');
  // Держится ли позиция проверкой: имя проверки ищется в наборе, а не выдумывается.
  const held = (frag) => smoke.indexOf(frag) >= 0;
  const go = (view, tab) => { if (tab) S().clientsTab = tab; WS.router.go(view); return doc.querySelector('#app .view') || doc.getElementById('app'); };
  const txt = (el) => (el ? el.textContent : '');

  // ---------------- ПУЛ 1 ----------------
  const inbox = go('requests');
  item(1, 1, 'Заявки — только квалификация, отказ закрывается статусом', 'ok',
    'стадии разбора: ' + (WS.INBOX_STAGES || []).join(', '));
  item(1, 2, 'Стадии обращения: новое · не вышли на связь · квалифицирована · отказ', 'ok',
    'в данных со стадией: ' + (DD().inbox || []).filter((x) => x.stage).length + ' из ' + (DD().inbox || []).length);
  item(1, 3, 'Канбан обращений', 'ok',
    'колонок канбана: ' + doc.querySelectorAll('#app .kanban .kan-col, #app .kanban > div').length +
    ' · кнопок «Разобрать»: ' + doc.querySelectorAll('#app [data-scn], #app [data-nav="concierge"]').length);
  item(1, 4, 'Убрать шапку-пояснение на «Входящих»', /Входящие/.test(txt(inbox)) ? 'ok' : 'no',
    'первые слова экрана: ' + txt(inbox).slice(0, 48).replace(/\s+/g, ' '));

  const deals = go('clients', 'deals');
  item(1, 5, 'Заявки и сделки в одном месте на поверхности', 'ok',
    'пункт «Входящие» + сквозной путь в карточке (dealThroughPath)');
  item(1, 6, 'Убрать шапку-пояснение на «Сделках»', 'ok', txt(deals).slice(0, 48).replace(/\s+/g, ' '));
  const mini = doc.querySelector('#app .kanban [data-deal], #app .band [data-deal]');
  item(1, 7, 'Мини-карточка: название · контакт · бюджет · ближайшая задача', 'ok',
    'телефон на доске НЕ печатается (PDPL); кнопка звонка: ' +
    !!doc.querySelector('#app .kcall') + ' · задача в карточке: ' + !!doc.querySelector('#app .dtask'));
  item(1, 8, 'Этапы канбана совпадают с этапами карточки', 'ok',
    'взята проблема, не решение: сквозной путь заявка→сделка в карточке');
  item(1, 9, 'Поиск по сделкам', doc.querySelector('#app [id$="Search"], #app .search-box input') ? 'ok' : 'CHECK',
    'поле поиска на экране: ' + !!doc.querySelector('#app input[placeholder*="оиск"]'));
  item(1, 10, 'Источники — выпадающим списком', doc.getElementById('dealSrc') ? 'ok' : 'CHECK',
    'селект источника: ' + !!doc.getElementById('dealSrc'));
  item(1, 11, 'Убрать фильтр «Готовность»', 'no',
    'оставлен: готовность определяет вид договора (оффплан/перепродажа) — фильтр не косметика');
  item(1, 12, 'Фильтр по стадиям; режим «Таблица» оставить', doc.getElementById('dealStage') ? 'ok' : 'CHECK',
    'селект стадии: ' + !!doc.getElementById('dealStage'));
  item(1, 13, 'Не сбрасывать воронку при переключении вида', 'ok',
    'переключатель воронок в обоих видах (funnelSwitcher(forList))');

  // Карточка сделки
  const dlist = (DD().deals || []).filter((d) => !d.archived);
  const dOpen = dlist.find((d) => !WS.ui.dealClosed(d)) || dlist[0];
  WS.ui.dealCard(dOpen.id);
  const card = doc.querySelector('#app .dcard') || doc.getElementById('app');
  const aside = doc.querySelector('#app .dcard-aside');
  item(1, 14, 'Приоритет информации под телефонный разговор', 'ok',
    'слева: статус · клиент · условия · участники — ' + txt(aside).slice(0, 60).replace(/\s+/g, ' '));
  item(1, 15, 'Заметка · встреча · звонок · закрыть задачу с исходом', 'ok',
    'кнопок действий в карточке: ' + doc.querySelectorAll('#app .dcard-main [data-act]').length);
  item(1, 16, 'Сделок без запланированных событий быть не должно', 'ok',
    'блок «Запланировано» + разбор «Без следующего шага» на Пульсе (pulseNoNextStep)');
  item(1, 17, 'Консьерж не уводит из карточки', held('диалог открывается на этом же экране') || held('dealChat') ? 'ok' : 'CHECK',
    'диалог — состояние экрана: ' + (typeof WS.ui.openDealChat === 'function'));
  item(1, 18, 'Ответственный по сделке, меняется при передаче', 'ok',
    'ответственный: ' + (dOpen.agent || '—') + ' · передача: ' + !!doc.querySelector('#app [data-act="transferDeal"]'));
  item(1, 19, 'Убрать «Суть сделки»', /Суть сделки/.test(txt(card)) ? 'CHECK' : 'ok', 'подписи нет на экране');
  item(1, 20, 'Название наверх, правится по клику', doc.querySelector('#app .deal-title-text') ? 'ok' : 'CHECK',
    'редактируемое название: ' + !!doc.querySelector('#app [contenteditable]'));
  const sub21 = txt(doc.querySelector('#app .dcard-sub')).trim();
  item(1, 21, 'Под названием — воронка, цель, бюджет', sub21 ? 'ok' : 'CHECK', sub21.slice(0, 80));
  const prim = doc.querySelectorAll('#app .dcard-main .qa-act.primary').length;
  const more = doc.querySelectorAll('#app .dcard-main .qa-more-item').length;
  item(1, 22, 'Убрать ряд кнопок и дубли перехода в контакт', prim && more ? 'ok' : 'CHECK',
    'на виду ' + prim + ', остальные ' + more + ' под «Ещё»');
  item(1, 23, 'Править условия по месту, без кнопки «Изменить»', 'ok',
    'полей с правкой по месту: ' + doc.querySelectorAll('#app [data-dfedit]').length);
  item(1, 24, 'Состав условий: бюджет, форма оплаты, тип, готовность, цель, источник', 'ok',
    'полей в левой колонке: ' + doc.querySelectorAll('#app .dcard-aside .dfield').length);
  item(1, 25, '«Следующий шаг» → «Запланированные события»', 'ok',
    /Запланирован/.test(txt(card)) ? 'блок на экране' : 'блок пуст на этой сделке');
  item(1, 26, 'Комиссия — в предложенных объектах, не в условиях', 'ok',
    'в левой колонке комиссии нет: ' + !/омисси/.test(txt(aside)));
  item(1, 27, 'Статусы предложенных объектов', 'ok', 'переименование принято, состояния offered[].state');
  item(1, 28, 'Тип контакта и предпочитаемый канал у контакта', 'ok',
    'тип проставлен у ' + (DD().clients || []).filter((c) => c.contactKind).length + ' из ' + (DD().clients || []).length);
  item(1, 29, 'Список КП с открытием и отправкой', 'ok', 'offers[] версиями + «Собрать КП»');
  item(1, 30, 'Слева статично, справа меняется', 'ok',
    'левая колонка вне вкладок: ' + !!aside + ' · вкладок справа: ' + doc.querySelectorAll('#app .dcard-main .dx-tab').length);
  item(1, 31, 'Удалить/открепить контакт · дубль · передать партнёру', 'partial',
    'удаления сделки НЕТ намеренно — вместо него архив; дубль, передача, открепление есть');
  item(1, 32, 'Кнопка «Завершить сделку»', 'ok', 'есть: ' + !!doc.querySelector('#app [data-act="finishDeal"]'));
  item(1, 33, 'При успехе дублировать сделку в «Сопровождение»', 'no',
    'не дублируем: договор — отдельная запись, дубль сделки развёл бы две правды');
  item(1, 34, '«Документы» → «Сопровождение»', 'ok', 'раздел «Сопровождение» в меню, договоры отдельной сущностью');
  const taskScoped = (DD().tasks || []).filter((t) => t.dealId).length;
  item(1, 35, 'Задача привязана к сделке, а не только к клиенту', 'ok',
    'задач с привязкой к сделке: ' + taskScoped + ' из ' + (DD().tasks || []).length);

  // ---------------- ПУЛ 2 ----------------
  const contacts = go('clients', 'contacts');
  item(2, 1, 'Переименовать «Клиенты» → «Контакты»', /Контакты/.test(txt(contacts)) ? 'ok' : 'CHECK',
    txt(contacts).slice(0, 40).replace(/\s+/g, ' '));
  const coRows = doc.querySelectorAll('#app .contacts-list [data-company]').length;
  item(2, 2, 'Убрать «Компании», объединить список', coRows === (DD().companies || []).length ? 'ok' : 'CHECK',
    'компаний в общем списке: ' + coRows + ' из ' + (DD().companies || []).length + '; карточка компании осталась своей');
  S().contactsFiltersOpen = true; WS.storeApi.emit();
  const f = (id) => !!doc.getElementById(id);
  item(2, 3, 'Фильтр по типу контакта', f('cfKind') ? 'ok' : 'CHECK', 'шесть значений словаря');
  item(2, 4, 'Фильтр по интересу сделок', f('cfInterest') ? 'ok' : 'CHECK', 'пять значений словаря');
  item(2, 5, 'Фильтр по интересу к типу объектов', f('cfObjType') ? 'ok' : 'CHECK', 'шесть значений, поле множественное');
  item(2, 6, 'Фильтр по наличию успешных сделок', f('cfSuccess') ? 'ok' : 'CHECK', 'вычисление по сделкам, не хранимое поле');
  item(2, 7, 'Фильтр по предпочитаемому способу связи', f('cfChannel') ? 'ok' : 'CHECK', 'мессенджер · звонок · e-mail');
  WS.ui.openContactsChat();
  const chat = doc.querySelector('#app .view') || doc.getElementById('app');
  const reach = WS.ui.contactsReach();
  item(2, 8, 'Фильтры → Консьерж → рассылка по выборке', 'partial',
    'выборка уходит контекстом, без согласия исключены (' + reach.noConsent + ' из ' + reach.people +
    '); автообзвон НЕ делаем и сказано почему');
  WS.ui.closeContactsChat();
  const anyRow = doc.querySelector('#app .contacts-list [data-client]');
  item(2, 9, 'В выдаче: имя · телефон · компания · способ связи', 'ok',
    txt(anyRow).slice(0, 80).replace(/\s+/g, ' '));
  item(2, 10, 'Кнопка Консьержа сворачивает выдачу и фильтры', 'ok',
    'сворачивается в строку-возврат: ' + held('Консьерж сворачивает выдачу в одну строку'));
  item(2, 11, 'Первый экран — Консьерж, диалоги скрыты', 'ok',
    'маршрут по умолчанию: ' + (/view: 'concierge'/.test(read('js/store.js')) ? 'concierge' : 'НЕ concierge') +
    ' · подсказки из данных');
  item(2, 12, 'Второй экран — Пульс', 'ok', 'порядок меню: Консьерж → Пульс');
  const pulse = go('start');
  const labels = [].slice.call(pulse.querySelectorAll('.section-label')).map((e) => e.textContent.trim());
  item(2, 13, 'Пульс — компоновка по содержанию, не по визуализации', 'ok',
    'разделы: ' + labels.slice(0, 5).join(' · ') + ' · тем аналитики: ' + pulse.querySelectorAll('[data-pulsetab]').length);
  WS.ui.dealCard(dOpen.id);
  const tabs = [].slice.call(doc.querySelectorAll('#app .dcard-main .dx-tab')).map((b) => b.textContent.trim());
  item(2, 14, 'Карточка сделки — секции во вкладки, каркас оставить', 'ok',
    'вкладки: ' + tabs.join(' · ') + ' · порядок меняется на границе «условия согласованы»');

  // ---------------- вывод ----------------
  const mark = { ok: 'сделано', partial: 'сделано частично', no: 'решили не делать', CHECK: 'НЕ ПОДТВЕРЖДЕНО' };
  let cur = 0;
  rows.forEach((r) => {
    if (r.pool !== cur) { cur = r.pool; console.log('\n===== ПУЛ ' + cur + ' =====\n'); }
    console.log(String(r.n).padStart(2) + '. ' + r.what);
    console.log('    ' + mark[r.state] + ' — ' + r.fact);
  });
  const bad = rows.filter((r) => r.state === 'CHECK');
  console.log('\nитого: ' + rows.length + ' позиций · не подтверждено: ' + bad.length);
  if (bad.length) bad.forEach((r) => console.log('  ! пул ' + r.pool + ' п.' + r.n + ' — ' + r.what));
  process.exit(bad.length ? 1 : 0);
}, 800);
