// Визуальная проверка раздела «Сделки» после волны 1: строка поиска, ширина, переполнение.
// Запуск: node src/test/_shot_deals.js  (из корня репозитория)
const puppeteer = require('puppeteer');
const path = require('path');
const url = 'file:///' + path.join(__dirname, '..', '..', 'index.html').split(path.sep).join('/');

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [name, w, h] of [['laptop', 1440, 900], ['narrow', 1100, 800], ['phone', 390, 844]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 900));
    await p.evaluate(() => { WS.store.clientsTab = 'deals'; WS.router.go('clients'); });
    await new Promise((r) => setTimeout(r, 500));
    const before = await p.evaluate(() => {
      const el = document.getElementById('dealSearch');
      const box = el && el.getBoundingClientRect();
      return {
        search: !!el,
        searchW: box ? Math.round(box.width) : 0,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        rows: (document.getElementById('main').innerHTML.match(/data-deal="/g) || []).length,
      };
    });
    await p.screenshot({ path: '.shots/deals-' + name + '.png' });
    const after = await p.evaluate(() => {
      WS.store.dealSearch = 'DIFC'; WS.storeApi.emit();
      return (document.getElementById('main').innerHTML.match(/data-deal="/g) || []).length;
    });
    await new Promise((r) => setTimeout(r, 200));
    await p.screenshot({ path: '.shots/deals-' + name + '-search.png' });
    console.log(name, JSON.stringify(Object.assign(before, { rowsAfterSearch: after })));
    await p.close();
  }
  await b.close();
})();
