
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 800 });
  await p.goto('file:///C:/Users/Lenovo/Documents/wespace-demo/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 900));
  await p.evaluate(() => { WS.store.clientsTab='deals'; WS.store.dealsView='kanban'; WS.router.go('clients'); });
  await new Promise(r => setTimeout(r, 400));
  const out = await p.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > docW + 1) bad.push({ t: el.tagName + '.' + (el.className||'').toString().slice(0,40), right: Math.round(r.right), w: Math.round(r.width) });
    });
    return { docW, count: bad.length, first: bad.slice(0, 6) };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
