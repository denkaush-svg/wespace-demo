/* ============================================================================================
   Проверка целостности данных стенда (Task 12 — .takt/evidence/00-intent.md).

   ТОЛЬКО ДЛЯ ТЕСТОВ. В продукте (src/js/) такой проверки намеренно нет: валидатор, который
   гоняется у пользователя, требует решения, что делать с найденным разрывом в бою, а такого
   решения нет (00-intent.md, «Чего в этой задаче не делаем»).

   Возвращает МАССИВ всех расхождений за один прогон — проверка не останавливается на первом
   (пункт 1 постановки). Пустой массив означает, что разрывов не найдено.

   ТРЕТИЙ ИСХОД. Пустой массив обязан значить «разрывов нет», и только это. Вход, который
   разобрать не удалось — отсутствующая коллекция, объект вместо массива, `null` вместо записи —
   раньше давал ровно тот же пустой массив, то есть «проверить не удалось» было неотличимо от
   «проверено и чисто», а битая коллекция вдобавок роняла прогон исключением вместо списка
   находок. Теперь у такого входа своё правило `структура`: проверка доходит до конца, а
   неразобранное называет вслух.
   ============================================================================================ */
'use strict';

/* Услуги, где предметом договора служит КОНКРЕТНЫЙ объект: продажа и аренда. У остальных
   (управление, эксклюзив, кросс-продажи, консалтинг) предмет — работа, и коммерческое
   предложение без списка объектов там законно, а не пусто. */
const PHYSICAL_FUNNELS = ['sale', 'rent'];
const CLOSED_STAGES = ['won', 'lost'];
/* Коллекции, без которых граф не проверен, а не чист. Отсутствие любой из них — находка
   правила `структура`, а не молчание. */
const REQUIRED_COLLECTIONS = ['clients', 'objects', 'deals', 'requests', 'roster', 'companies',
  'events', 'approvals', 'tasks'];

function validateDataGraph(data) {
  const d = (data && typeof data === 'object') ? data : {};
  const issues = [];
  const add = (правило, где, id, поле, ссылка, что) =>
    issues.push({ правило: правило, где: где, id: id, поле: поле, ссылка: ссылка, что: что });

  if (!data || typeof data !== 'object') {
    add('структура', 'граф', null, null, typeof data, 'на вход подан не объект — проверить граф не удалось');
  }

  // ---- третий исход: вход, который не удалось разобрать, называется, а не молчит ----
  REQUIRED_COLLECTIONS.forEach((имя) => {
    const v = d[имя];
    if (v === null || v === undefined) {
      add('структура', имя, имя, null, null, 'коллекция отсутствует — проверить граф по ней не удалось');
    } else if (!Array.isArray(v)) {
      add('структура', имя, имя, null, typeof v, 'коллекция не массив — проверить граф по ней не удалось');
    }
  });

  /* Читать коллекцию можно только как массив. Всё остальное уже названо выше правилом
     `структура`; здесь оно просто не роняет прогон. */
  const rows = (имя) => (Array.isArray(d[имя]) ? d[имя] : []);
  /* Обход коллекции. Пустая запись не роняет обращение к полю — она сама находка. Коллекции
     обходятся дважды (ключи, затем инварианты), поэтому пустая запись называется один раз. */
  const пустыеНазваны = Object.create(null);
  const each = (имя, где, fn) => {
    rows(имя).forEach((x, i) => {
      if (!x || typeof x !== 'object') {
        const ключ = имя + '[' + i + ']';
        if (!пустыеНазваны[ключ]) {
          пустыеНазваны[ключ] = true;
          add('структура', где, ключ, null, x === undefined ? 'undefined' : x,
            'запись пуста или не является объектом — проверить её не удалось');
        }
        return;
      }
      fn(x);
    });
  };

  /* Таблица идентификаторов хранит САМ идентификатор, а не `true`: обращение по ключу приводит
     число к строке, и числовая ссылка 123 молча попадала в строковый id '123'. Строгое сравнение
     возвращённого значения с искомым эту подмену ловит. */
  const index = (имя) => {
    const s = Object.create(null);
    rows(имя).forEach((x) => {
      if (x && typeof x === 'object' && (typeof x.id === 'string' || typeof x.id === 'number')) s[x.id] = x.id;
    });
    return s;
  };
  const clients = index('clients');
  const objects = index('objects');
  const deals = index('deals');
  const requests = index('requests');
  const people = index('roster');
  const companies = index('companies');

  /* Одно направление внешнего ключа. Пустая ссылка законна — её просто нет (сделка без
     объекта, задача без сделки). Непустая, не попадающая ни в одну запись, — разрыв. */
  const fk = (где, rec, поле, значение, таблица, имяТаблицы) => {
    if (значение === null || значение === undefined || значение === '') return;
    if (таблица[значение] === значение) return;
    add('внешний ключ', где, rec.id, поле, значение, 'ссылка ни во что не попадает: ' + имяТаблицы);
  };
  const fkList = (где, rec, поле, список, таблица, имяТаблицы) => {
    if (список === null || список === undefined) return;
    if (!Array.isArray(список)) {
      add('структура', где, rec.id, поле, typeof список, 'поле-список не является массивом — проверить его не удалось');
      return;
    }
    список.forEach((v, i) => fk(где, rec, поле + '[' + i + ']', v, таблица, имяТаблицы));
  };

  // ---- пункт 2 постановки: внешние ключи по пяти направлениям ----

  each('deals', 'сделка', (x) => {
    fk('сделка', x, 'clientId', x.clientId, clients, 'клиенты');
    fk('сделка', x, 'requestId', x.requestId, requests, 'заявки');
    fk('сделка', x, 'agent', x.agent, people, 'сотрудники');
    fk('сделка', x, 'partnerAgent', x.partnerAgent, people, 'сотрудники');
    fk('сделка', x, 'objectId', x.objectId, objects, 'объекты');
    fkList('сделка', x, 'lots', x.lots, objects, 'объекты');
    fk('сделка', x, 'companyId', x.companyId, companies, 'компании');
  });

  each('requests', 'заявка', (r) => {
    fk('заявка', r, 'clientId', r.clientId, clients, 'клиенты');
    fk('заявка', r, 'assignee', r.assignee, people, 'сотрудники');
    fk('заявка', r, 'partnerAgent', r.partnerAgent, people, 'сотрудники');
    if (r.offered !== null && r.offered !== undefined && !Array.isArray(r.offered)) {
      add('структура', 'заявка', r.id, 'offered', typeof r.offered, 'поле-список не является массивом — проверить его не удалось');
    } else {
      (r.offered || []).forEach((o, i) => fk('заявка', r, 'offered[' + i + ']', o && o.id, objects, 'объекты'));
    }
    fkList('заявка', r, 'kp.objectIds', r.kp && r.kp.objectIds, objects, 'объекты');
  });

  each('events', 'событие', (e) => {
    fk('событие', e, 'clientId', e.clientId, clients, 'клиенты');
    fk('событие', e, 'requestId', e.requestId, requests, 'заявки');
    fk('событие', e, 'dealId', e.dealId, deals, 'сделки');
    fk('событие', e, 'objectId', e.objectId, objects, 'объекты');
    fk('событие', e, 'executorId', e.executorId, people, 'сотрудники');
  });

  each('approvals', 'согласование', (a) => {
    fk('согласование', a, 'dealId', a.dealId, deals, 'сделки');
    fk('согласование', a, 'requestId', a.requestId, requests, 'заявки');
    fk('согласование', a, 'who', a.who, people, 'сотрудники');
  });

  each('tasks', 'задача', (t) => {
    fk('задача', t, 'clientId', t.clientId, clients, 'клиенты');
    fk('задача', t, 'dealId', t.dealId, deals, 'сделки');
    fk('задача', t, 'requestId', t.requestId, requests, 'заявки');
  });

  // ---- пункт 3 постановки: рабочие инварианты ----

  each('deals', 'сделка', (x) => {
    if (CLOSED_STAGES.indexOf(x.stage) >= 0) return;
    if (!x.agent) add('инвариант', 'сделка', x.id, 'agent', null, 'у активной сделки нет ответственного');
  });

  /* Сформированное КП обязано нести объекты — кроме двух случаев: услуга нефизическая
     (предмет договора не объект) либо исключение объявлено в самих данных полем kp.emptyReason.
     Молчаливый пустой набор на продаже или аренде — разрыв. */
  each('requests', 'заявка', (r) => {
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
  each('approvals', 'согласование', (a) => {
    if (!a.dealId && !a.requestId) {
      add('инвариант', 'согласование', a.id, 'основание', null, 'согласование не привязано ни к сделке, ни к заявке');
      return;
    }
    const basis = a.dealId
      ? rows('deals').find((x) => x && x.id === a.dealId)
      : rows('requests').find((x) => x && x.id === a.requestId);
    if (!basis) return;
    const closed = basis.stage
      ? CLOSED_STAGES.indexOf(basis.stage) >= 0
      : /закрыт|отказ/i.test(basis.leadStatus || '');
    if (closed) {
      add('инвариант', 'согласование', a.id, 'основание', basis.id,
        'ждёт решения по основанию, которое уже закрыто');
    }
  });

  each('events', 'событие', (e) => {
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
