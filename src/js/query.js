/* ============================================================
   Declarative reads over the demo state.
   The Concierge never counts anything itself: it describes the question, this
   file answers it. Every result carries the records the number came from and
   the revision it was computed at — so a figure in a reply can be opened and
   checked against the same rows the screen draws from.
   ============================================================ */
(function (WS) {
  // The addressable surface. A name that is not here is refused, so a question
  // can never reach into internals by guessing a collection name.
  const COLLECTIONS = {
    clients: 'контакты',
    deals: 'сделки',
    requests: 'заявки',
    objects: 'объекты',
    tasks: 'задачи',
    events: 'события календаря',
    companies: 'компании',
    requests: 'заявки',
    inbox: 'входящие',
    market: 'районы рынка Дубая',
  };

  const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
  const str = (v) => String(v == null ? '' : v).toLowerCase();

  const OPS = {
    eq: (a, b) => a === b,
    ne: (a, b) => a !== b,
    gt: (a, b) => num(a) > num(b),
    gte: (a, b) => num(a) >= num(b),
    lt: (a, b) => num(a) < num(b),
    lte: (a, b) => num(a) <= num(b),
    in: (a, b) => Array.isArray(b) && b.indexOf(a) >= 0,
    has: (a, b) => Array.isArray(a) && a.indexOf(b) >= 0,
    contains: (a, b) => str(a).indexOf(str(b)) >= 0,
    truthy: (a) => !!a,
    falsy: (a) => !a,
    exists: (a) => a !== undefined && a !== null,
  };

  const AGGS = ['count', 'sum', 'avg', 'min', 'max'];

  function err(code, message, extra) {
    return Object.assign({ ok: false, code: code, error: message }, extra || {});
  }
  function rev() { return WS.store.dataRevision; }

  function aggregate(list, agg) {
    const fn = (agg && agg.fn) || 'count';
    if (fn === 'count') return list.length;
    const vals = list.map((r) => num(r[agg.field])).filter((v) => !isNaN(v));
    if (fn === 'sum') return vals.reduce((s, v) => s + v, 0);
    if (fn === 'avg') return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    if (fn === 'min') return vals.length ? Math.min.apply(null, vals) : null;
    return vals.length ? Math.max.apply(null, vals) : null;
  }

  // spec: { from, where:[{field,op,value}], groupBy, aggregate:{fn,field}, sort:{field,dir}, limit }
  function run(spec) {
    spec = spec || {};
    const from = spec.from;
    if (!COLLECTIONS[from]) {
      return err('unknown_collection', 'нет такой коллекции: ' + from, { available: Object.keys(COLLECTIONS) });
    }
    const src = (WS.store.data || {})[from];
    if (!Array.isArray(src)) return err('unknown_collection', 'коллекция недоступна: ' + from);

    const agg = spec.aggregate;
    if (agg && AGGS.indexOf(agg.fn || 'count') < 0) {
      return err('unknown_aggregate', 'неизвестная функция: ' + agg.fn, { available: AGGS });
    }
    if (agg && agg.fn && agg.fn !== 'count' && !agg.field) {
      return err('missing_field', 'функции ' + agg.fn + ' нужно поле');
    }

    let out = src.slice();
    const where = spec.where || [];
    for (let i = 0; i < where.length; i++) {
      const w = where[i] || {};
      const fn = OPS[w.op || 'eq'];
      if (!fn) return err('unknown_operator', 'неизвестное условие: ' + w.op, { available: Object.keys(OPS) });
      if (!w.field) return err('missing_field', 'в условии не указано поле');
      out = out.filter((r) => fn(r[w.field], w.value));
    }

    if (spec.sort && spec.sort.field) {
      const f = spec.sort.field;
      const dir = spec.sort.dir === 'asc' ? 1 : -1;
      out.sort((a, b) => {
        const x = a[f], y = b[f];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * dir;
      });
    }

    if (spec.groupBy) {
      const groups = {};
      out.forEach((r) => {
        const k = String(r[spec.groupBy]);
        (groups[k] = groups[k] || { rows: [] }).rows.push(r);
      });
      Object.keys(groups).forEach((k) => { groups[k].value = aggregate(groups[k].rows, agg); });
      return { ok: true, from: from, where: where, groupBy: spec.groupBy, groups: groups, count: out.length, revision: rev() };
    }

    const res = {
      ok: true, from: from, where: where,
      rows: spec.limit > 0 ? out.slice(0, spec.limit) : out,
      count: out.length, revision: rev(),
    };
    if (agg) res.value = aggregate(out, agg);
    return res;
  }

  // What can be asked about, and with which fields — so the answer to an unusual
  // question is a different query, not an apology.
  function collections() {
    const d = WS.store.data || {};
    return Object.keys(COLLECTIONS).map((k) => {
      const arr = Array.isArray(d[k]) ? d[k] : [];
      return { name: k, label: COLLECTIONS[k], count: arr.length, fields: arr.length ? Object.keys(arr[0]) : [] };
    });
  }

  WS.query = { run: run, collections: collections, operators: () => Object.keys(OPS), aggregates: () => AGGS.slice() };
})(window.WS = window.WS || {});
