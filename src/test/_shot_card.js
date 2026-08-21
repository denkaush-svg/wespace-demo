// Визуальная проверка карточки сделки после волны 2.
const puppeteer = require('puppeteer');
const path = require('path');
const url = 'file:///' + path.join(__dirname, '..', '..', 'index.html').split(path.sep).join('/');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [name, w, h] of [['laptop', 1440, 900], ['narrow', 1000, 800], ['phone', 390, 844]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 900));
    await p.evaluate(() => WS.ui.dealCard('d_anna'));
    await new Promise((r) => setTimeout(r, 500));
    const r = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const aside = q('.dcard-aside');
      const cs = aside ? getComputedStyle(aside) : null;
      const path0 = q('.dx-path');
      return {
        steps: document.querySelectorAll('.dx-path .dx-step').length,
        pre: document.querySelectorAll('.dx-path .dx-step.pre').length,
        bound: document.querySelectorAll('.dx-path .dx-bound').length,
        asideSticky: cs ? cs.position : 'нет',
        asideVisible: cs ? cs.display !== 'none' : false,
        mobileAside: !!q('.dcard-aside-m') && getComputedStyle(q('.dcard-aside-m')).display !== 'none',
        composer: !!q('.dcard-composer'),
        pathScroll: path0 ? path0.scrollWidth - path0.clientWidth : -1,
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    await p.screenshot({ path: '.shots/card-' + name + '.png', fullPage: false });
    console.log(name, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
