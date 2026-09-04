/* Регресс раскатки: старый снимок localStorage (версия, на которой сейчас работает
   живой брокер) загружается в НОВУЮ сборку. Проверяем, что ничего не потеряно и
   ничего не сломано. Это единственная проверка, которая отвечает на вопрос
   «можно ли накатывать, не потеряв накопленное». */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { JSDOM } = require(path.join(ROOT, 'node_modules', 'jsdom'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, note) => {
  if (ok) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (note ? '  [' + note + ']' : '')); }
};

// ---- Шаг 1: старой сборкой создаём снимок, как у брокера -------------------
const dom1 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });

setTimeout(() => {
  const W1 = dom1.window, WS1 = W1.WS;

  // Брокер поработал: задал вопросы, переписка легла в тред, что-то поменял в данных.
  WS1.engine.openThread('deal:d_anna', '\u0410\u043d\u043d\u0430 \u041f\u0435\u0442\u0440\u043e\u0432\u0430', 'chat');
  WS1.engine.pushText && WS1.engine.pushText('me', '', '\u043a\u0430\u043a \u043f\u0440\u043e\u0434\u0430\u0432\u0430\u0442\u044c Creekline 1208', 'deal:d_anna');
  WS1.store.signals = ['\u043a\u0430\u043a \u043f\u0440\u043e\u0434\u0430\u0432\u0430\u0442\u044c Creekline 1208', '\u043a\u043e\u043c\u0443 \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u044d\u0442\u043e\u0442 \u043e\u0431\u044a\u0435\u043a\u0442'];
  WS1.store.data.clients[0].note = '\u0437\u0430\u043c\u0435\u0442\u043a\u0430 \u0431\u0440\u043e\u043a\u0435\u0440\u0430';
  WS1.store.aboutSeen = true;
  WS1.store.role = 'manager';
  WS1.storeApi.save();

  const raw = W1.localStorage.getItem(Object.keys(W1.localStorage).find((k) => /wespace|ws_/i.test(k)) || 'wespace');
  let snapshot = raw;
  if (!snapshot) {
    for (let i = 0; i < W1.localStorage.length; i++) {
      const k = W1.localStorage.key(i);
      const v = W1.localStorage.getItem(k);
      if (v && v.indexOf('"schema"') >= 0) { snapshot = v; break; }
    }
  }
  if (!snapshot) { console.log('НЕ УДАЛОСЬ СНЯТЬ СНИМОК'); process.exit(1); }

  const parsed = JSON.parse(snapshot);
  const storageKey = (() => {
    for (let i = 0; i < W1.localStorage.length; i++) {
      const k = W1.localStorage.key(i);
      if ((W1.localStorage.getItem(k) || '').indexOf('"schema"') >= 0) return k;
    }
    return 'wespace';
  })();

  console.log('\n\u0421\u041d\u0418\u041c\u041e\u041a \u0421\u041d\u042f\u0422: \u043a\u043b\u044e\u0447 "' + storageKey + '", \u0441\u0445\u0435\u043c\u0430 ' + parsed.schema +
    ', \u0440\u0430\u0437\u043c\u0435\u0440 ' + Math.round(snapshot.length / 1024) + ' \u041a\u0411');

  // ---- Шаг 2: имитируем СТАРУЮ версию — убираем то, чего в ней не было -----
  // Живой брокер работает на сборке БЕЗ approvals: их не было в фикстурах.
  const old = JSON.parse(snapshot);
  delete old.data.approvals;      // коллекции, добавленной новой сборкой, у него нет
  delete old.signals;             // старая сборка их не сохраняла вовсе
  const oldSnapshot = JSON.stringify(old);
  console.log('\u0421\u0422\u0410\u0420\u042b\u0419 \u0421\u041d\u0418\u041c\u041e\u041a: \u0431\u0435\u0437 approvals, \u0431\u0435\u0437 signals \u2014 \u043a\u0430\u043a \u0443 \u0431\u0440\u043e\u043a\u0435\u0440\u0430 \u0441\u0435\u0439\u0447\u0430\u0441\n');

  // ---- Шаг 3: НОВАЯ сборка поднимается на этом снимке ----------------------
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(w) {
      // положить снимок ДО того, как сборка стартует
      try { w.localStorage.setItem(storageKey, oldSnapshot); } catch (e) {}
    },
  });

  setTimeout(() => {
    const W2 = dom2.window, WS2 = W2.WS, doc2 = W2.document;
    console.log('=== \u0427\u0422\u041e \u0421 \u041d\u0410\u041a\u041e\u041f\u041b\u0415\u041d\u041d\u042b\u041c \u041f\u041e\u0421\u041b\u0415 \u0420\u0410\u0421\u041a\u0410\u0422\u041a\u0418 ===');

    check('\u0441\u043d\u0438\u043c\u043e\u043a \u043f\u0440\u0438\u043d\u044f\u0442, \u0430 \u043d\u0435 \u043e\u0442\u0431\u0440\u043e\u0448\u0435\u043d \u043a\u0430\u043a \u043d\u0435\u0441\u043e\u0432\u043c\u0435\u0441\u0442\u0438\u043c\u044b\u0439',
      WS2.store.incompatible !== true, 'incompatible=' + WS2.store.incompatible);

    check('\u043f\u0440\u0430\u0432\u043a\u0430 \u0431\u0440\u043e\u043a\u0435\u0440\u0430 \u0432 \u0434\u0430\u043d\u043d\u044b\u0445 \u0446\u0435\u043b\u0430',
      (WS2.store.data.clients[0] || {}).note === '\u0437\u0430\u043c\u0435\u0442\u043a\u0430 \u0431\u0440\u043e\u043a\u0435\u0440\u0430',
      String((WS2.store.data.clients[0] || {}).note));

    check('\u0440\u043e\u043b\u044c \u0438 \u0444\u043b\u0430\u0433\u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0441\u044c',
      WS2.store.role === 'manager' && WS2.store.aboutSeen === true,
      WS2.store.role + '/' + WS2.store.aboutSeen);

    const th = WS2.engine.exportThreads ? WS2.engine.exportThreads() : null;
    const hasThread = th && JSON.stringify(th).indexOf('Creekline 1208') >= 0;
    check('\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u043a\u0430 \u0441 \u041a\u043e\u043d\u0441\u044c\u0435\u0440\u0436\u0435\u043c \u0443\u0446\u0435\u043b\u0435\u043b\u0430', !!hasThread,
      hasThread ? '' : '\u0442\u0440\u0435\u0434 \u043f\u043e\u0442\u0435\u0440\u044f\u043d');

    check('\u043d\u043e\u0432\u0430\u044f \u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u044f approvals \u0434\u043e-\u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0430 \u0438\u0437 \u0444\u0438\u043a\u0441\u0442\u0443\u0440',
      Array.isArray(WS2.store.data.approvals) && WS2.store.data.approvals.length > 0,
      '\u0437\u0430\u043f\u0438\u0441\u0435\u0439 ' + ((WS2.store.data.approvals || []).length));

    check('\u0434\u043e-\u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u043e',
      Array.isArray(WS2.store.migratedKeys) && WS2.store.migratedKeys.indexOf('approvals') >= 0,
      JSON.stringify(WS2.store.migratedKeys));

    // Экраны, которые новая сборка добавила, должны рисоваться на СТАРОМ снимке.
    let crashed = null;
    ['start', 'concierge', 'approvals', 'team', 'leads', 'clients', 'objects'].forEach((v) => {
      ['agent', 'manager'].forEach((r) => {
        try {
          WS2.store.role = r; WS2.store.pulseSection = null;
          WS2.router.go(v); WS2.ui.render();
          const len = ((doc2.getElementById('app') || {}).textContent || '').trim().length;
          if (len < 40) crashed = crashed || (v + '/' + r + ' \u043f\u0443\u0441\u0442');
        } catch (e) { crashed = crashed || (v + '/' + r + ': ' + e.message); }
      });
    });
    check('\u0432\u0441\u0435 \u044d\u043a\u0440\u0430\u043d\u044b \u0440\u0438\u0441\u0443\u044e\u0442\u0441\u044f \u043d\u0430 \u0441\u0442\u0430\u0440\u043e\u043c \u0441\u043d\u0438\u043c\u043a\u0435, \u0432 \u043e\u0431\u0435\u0438\u0445 \u0440\u043e\u043b\u044f\u0445', !crashed, crashed || '');

    // Новая запись signals должна лечь на диск сразу.
    WS2.store.role = 'agent';
    WS2.store.signals = WS2.store.signals || [];
    const before = WS2.store.signals.length;
    WS2.store.signals.push('\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f');
    WS2.storeApi.save();
    const reread = JSON.parse(W2.localStorage.getItem(storageKey) || '{}');
    check('\u0437\u0430\u043f\u0440\u043e\u0441\u044b \u0431\u0440\u043e\u043a\u0435\u0440\u0430 \u0442\u0435\u043f\u0435\u0440\u044c \u043f\u0435\u0440\u0435\u0436\u0438\u0432\u0430\u044e\u0442 \u043f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443',
      Array.isArray(reread.signals) && reread.signals.length === before + 1,
      '\u0432 \u0441\u043d\u0438\u043c\u043a\u0435: ' + JSON.stringify(reread.signals));

    console.log('\n\u0418\u0442\u043e\u0433: ' + pass + ' \u043f\u0440\u043e\u0448\u043b\u043e, ' + fail + ' \u043f\u0440\u043e\u0432\u0430\u043b\u0438\u043b\u043e\u0441\u044c');
    process.exit(fail ? 1 : 0);
  }, 3500);
}, 3500);
