const puppeteer = require('puppeteer');
const path = require('path');
const url = 'file:///' + path.join('C:/Users/Lenovo/Documents/wespace-demo', 'index.html').split(path.sep).join('/');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [name, w, h] of [['laptop', 1440, 900], ['wide', 1680, 1000], ['narrow', 1000, 800]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 900));
    await p.evaluate(() => { WS.store.clientsTab = 'deals'; WS.store.dealsView = 'kanban'; WS.router.go('clients'); });
    await new Promise((r) => setTimeout(r, 500));
    const r = await p.evaluate(() => {
      const k = document.querySelector('.kanban');
      const cols = [].slice.call(document.querySelectorAll('.kanban .kcol'));
      return { bands: cols.length, kanbanScroll: k ? k.scrollWidth - k.clientWidth : -1,
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        colW: cols.map((c) => Math.round(c.getBoundingClientRect().width)) };
    });
    await p.screenshot({ path: 'C:/Users/Lenovo/Documents/wespace-demo/.shots/board-' + name + '.png' });
    console.log(name, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
