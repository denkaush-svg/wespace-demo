/* Проверка спасения: стенд с накопленной перепиской должен отправить её на /snapshot
   один раз, и НЕ отправлять повторно, если ничего не изменилось. */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { JSDOM } = require(path.join(ROOT, 'node_modules', 'jsdom'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
const win = dom.window;

const sent = [];
setTimeout(() => {
  const WS = win.WS;
  // перехватываем сеть
  win.fetch = (url, opts) => {
    const u = String(url);
    if (/\/snapshot$/.test(u)) {
      sent.push(JSON.parse((opts && opts.body) || '{}'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (/\/health$/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    return Promise.reject(new TypeError('no'));
  };

  // брокер поработал
  WS.engine.openThread('deal:d_anna', 'Анна Петрова', 'chat');
  WS.engine.pushText && WS.engine.pushText('me', '', 'как продавать Creekline 1208', 'deal:d_anna');
  WS.store.signals = ['как продавать Creekline 1208', 'кому подходит этот объект'];

  WS.live.uploadSnapshot('probe');
  setTimeout(() => {
    console.log('отправок после первой попытки:', sent.length);
    if (sent.length) {
      const p = sent[0].payload || {};
      const asText = JSON.stringify(p);
      console.log('  причина      :', sent[0].reason);
      console.log('  подпись      :', sent[0].hash);
      console.log('  запросы      :', JSON.stringify(p.signals));
      console.log('  вопрос в треде:', asText.indexOf('Creekline 1208') >= 0 ? 'ЕСТЬ' : 'НЕТ');
      console.log('  размер       :', Math.round(asText.length / 1024) + ' КБ');
    }
    // вторая попытка без изменений — не должна отправлять
    WS.live.uploadSnapshot('probe2');
    setTimeout(() => {
      console.log('отправок после второй попытки (ничего не менялось):', sent.length);
      // что-то изменилось — должна отправить
      WS.store.signals.push('новый вопрос брокера');
      WS.live.uploadSnapshot('probe3');
      setTimeout(() => {
        console.log('отправок после изменения:', sent.length);
        const ok = sent.length === 2;
        console.log(ok ? '\nИТОГ: отправляет по изменению, не спамит' : '\nИТОГ: ПОВЕДЕНИЕ НЕВЕРНОЕ');
        process.exit(ok ? 0 : 1);
      }, 400);
    }, 400);
  }, 400);
}, 3500);
