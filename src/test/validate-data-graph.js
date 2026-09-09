/* ============================================================================================
   Проверка целостности данных стенда (Task 12 — .takt/evidence/00-intent.md).

   ТОЛЬКО ДЛЯ ТЕСТОВ. В продукте (src/js/) такой проверки намеренно нет: валидатор, который
   гоняется у пользователя, требует решения, что делать с найденным разрывом в бою, а такого
   решения нет (00-intent.md, «Чего в этой задаче не делаем»).

   Возвращает МАССИВ всех расхождений за один прогон — проверка не останавливается на первом
   (пункт 1 постановки). Пустой массив означает, что разрывов не найдено.
   ============================================================================================ */
'use strict';

/* Услуги, где предметом договора служит КОНКРЕТНЫЙ объект: продажа и аренда. У остальных
   (управление, эксклюзив, кросс-продажи, консалтинг) предмет — работа, и коммерческое
   предложение без списка объектов там законно, а не пусто. */
const PHYSICAL_FUNNELS = ['sale', 'rent'];
const CLOSED_STAGES = ['won', 'lost'];

function validateDataGraph(data) {
  const d = data || {};
  const issues = [];
  const add = (правило, где, id, поле, ссылка, что) =>
    issues.push({ правило: правило, где: где, id: id, поле: поле, ссылка: ссылка, что: что });

  const index = (arr) => {
    const s = Object.create(null);
    (arr || []).forEach((x) => { if (x && x.id) s[x.id] = true; });
    return s;
  };
  const clients = index(d.clients);
  const objects = index(d.objects);
  const deals = index(d.deals);
  const requests = index(d.requests);
  const people = index(d.roster);
  const companies = index(d.companies);

  /* Одно направление внешнего ключа. Пустая ссылка законна — её просто нет (сделка без
     объекта, задача без сделки). Непустая, не попадающая ни в одну запись, — разрыв. */
  const fk = (где, rec, поле, значение, таблица, имяТаблицы) => {
    if (значение === null || значение === undefined || значение === '') return;
    if (таблица[значение]) return;
    add('внешний ключ', где, rec.id, поле, значение, 'ссылка ни во что не попадает: ' + имяТаблицы);
  };
  const fkList = (где, rec, поле, список, таблица, имяТаблицы) => {
    (список || []).forEach((v, i) => fk(где, rec, поле + '[' + i + ']', v, таблица, имяТаблицы));
  };

  // ---- пункт 2 постановки: внешние ключи по пяти направлениям ----

  (d.deals || []).forEach((x) => {
    fk('сделка', x, 'clientId', x.clientId, clients, 'клиенты');
    fk('сделка', x, 'requestId', x.requestId, requests, 'заявки');
    fk('сделка', x, 'agent', x.agent, people, 'сотрудники');
    fk('сделка', x, 'partnerAgent', x.partnerAgent, people, 'сотрудники');
    fk('сделка', x, 'objectId', x.objectId, objects, 'объекты');
    fkList('сделка', x, 'lots', x.lots, objects, 'объекты');
    fk('сделка', x, 'companyId', x.companyId, companies, 'компании');
  });

  (d.requests || []).forEach((r) => {
    fk('заявка', r, 'clientId', r.clientId, clients, 'клиенты');
    fk('заявка', r, 'assignee', r.assignee, people, 'сотрудники');
    fk('заявка', r, 'partnerAgent', r.partnerAgent, people, 'сотрудники');
    (r.offered || []).forEach((o, i) => fk('заявка', r, 'offered[' + i + ']', o && o.id, objects, 'объекты'));
    fkList('заявка', r, 'kp.objectIds', r.kp && r.kp.objectIds, objects, 'объекты');
  });

  (d.events || []).forEach((e) => {
    fk('событие', e, 'clientId', e.clientId, clients, 'клиенты');
    fk('событие', e, 'requestId', e.requestId, requests, 'заявки');
    fk('событие', e, 'dealId', e.dealId, deals, 'сделки');
    fk('событие', e, 'objectId', e.objectId, objects, 'объекты');
    fk('событие', e, 'executorId', e.executorId, people, 'сотрудники');
  });

  (d.approvals || []).forEach((a) => {
    fk('согласование', a, 'dealId', a.dealId, deals, 'сделки');
    fk('согласование', a, 'requestId', a.requestId, requests, 'заявки');
    fk('согласование', a, 'who', a.who, people, 'сотрудники');
  });

  (d.tasks || []).forEach((t) => {
    fk('задача', t, 'clientId', t.clientId, clients, 'клиенты');
    fk('задача', t, 'dealId', t.dealId, deals, 'сделки');
    fk('задача', t, 'requestId', t.requestId, requests, 'заявки');
  });

  // ---- пункт 3 постановки: рабочие инварианты ----

  (d.deals || []).forEach((x) => {
    if (CLOSED_STAGES.indexOf(x.stage) >= 0) return;
    if (!x.agent) add('инвариант', 'сделка', x.id, 'agent', null, 'у активной сделки нет ответственного');
  });

  /* Сформированное КП обязано нести объекты — кроме двух случаев: услуга нефизическая
     (предмет договора не объект) либо исключение объявлено в самих данных полем kp.emptyReason.
     Молчаливый пустой набор на продаже или аренде — разрыв. */
  (d.requests || []).forEach((r) => {
    const kp = r.kp;
    if (!kp || kp.formed !== true) return;
    if ((kp.objectIds || []).length) return;
    if (PHYSICAL_FUNNELS.indexOf(r.funnel) < 0) return;
    if (kp.emptyReason) return;
    add('инвариант', 'заявка', r.id, 'kp.objectIds', null,
      'КП сформировано на физической услуге, но набор объектов пуст и исключение не объявлено');
  });

  /* Согласование в ожидании должно опираться на актуальное основание: закрытая сделка или
     закрытая заявка — это уже история, и решать по ней нечего. Отсутствующее основание здесь
     не повторяется — его уже назвала проверка внешних ключей. */
  (d.approvals || []).forEach((a) => {
    if (!a.dealId && !a.requestId) {
      add('инвариант', 'согласование', a.id, 'основание', null, 'согласование не привязано ни к сделке, ни к заявке');
      return;
    }
    const basis = a.dealId
      ? (d.deals || []).find((x) => x.id === a.dealId)
      : (d.requests || []).find((x) => x.id === a.requestId);
    if (!basis) return;
    const closed = basis.stage
      ? CLOSED_STAGES.indexOf(basis.stage) >= 0
      : /закрыт|отказ/i.test(basis.leadStatus || '');
    if (closed) {
      add('инвариант', 'согласование', a.id, 'основание', basis.id,
        'ждёт решения по основанию, которое уже закрыто');
    }
  });

  (d.events || []).forEach((e) => {
    if (e.kind !== 'show') return;
    ['when', 'objectId', 'clientId', 'status'].forEach((поле) => {
      if (!e[поле]) add('инвариант', 'показ', e.id, поле, null, 'у показа не заполнено обязательное поле');
    });
  });

  /* Счётчик, выводимый из сделок, не хранится рядом константой: сохранённое число расходится
     с настоящим молча и всплывает только в ответе. Двое таких уже убирали (см. комментарий у
     analytics в fixtures.js) — проверка держит их убранными. */
  ['dealsActive', 'pipelineValue'].forEach((k) => {
    if (d.analytics && d.analytics[k] !== undefined) {
      add('инвариант', 'аналитика', 'analytics', k, d.analytics[k],
        'счётчик выводится из сделок и не должен лежать рядом константой');
    }
  });

  return issues;
}

module.exports = validateDataGraph;
module.exports.validateDataGraph = validateDataGraph;
