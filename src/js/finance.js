/* ============================================================
   Financial model — single source of truth for screen/PDF/Excel.
   Recomputes from assumptions; matches reference set (spec §12.2).
   ============================================================ */
(function (WS) {
  const pct = (x, d = 2) => (x * 100).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const aed = (x, d = 0) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' AED';

  function irr(flows, guess = 0.08) {
    // bisection on [-0.9, 1.0]
    const npvAt = (r) => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
    let lo = -0.9, hi = 1.0, mid = guess;
    if (npvAt(lo) * npvAt(hi) > 0) return guess;
    for (let i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      const v = npvAt(mid);
      if (Math.abs(v) < 0.01) break;
      if (npvAt(lo) * v < 0) hi = mid; else lo = mid;
    }
    return mid;
  }

  function compute(m) {
    const invested = m.price + m.addCosts;
    // Derive yearly net flows from assumptions so sliders truly recompute
    // (rent grows yearly, opex flat). At reference inputs this reproduces
    // the spec §12.2 set exactly: 100000, 103750, 107612.50, 111590.88, 115688.60.
    const g = (m.rentGrowth != null ? m.rentGrowth : 0.03);
    const flows = [0, 1, 2, 3, 4].map((i) => m.rentY1 * Math.pow(1 + g, i) - m.opexY1);
    const y5WithExit = flows[flows.length - 1] + m.exitNet;
    const cfSeries = [-invested, flows[0], flows[1], flows[2], flows[3], y5WithExit];

    const grossYield = m.rentY1 / m.price;                 // on price
    const netYield = (m.rentY1 - m.opexY1) / invested;     // on total invested
    const npv = cfSeries.reduce((s, cf, t) => s + cf / Math.pow(1 + m.discount, t), 0);
    const irrVal = irr(cfSeries);
    const sumFlows = flows.reduce((a, b) => a + b, 0);
    const roi5 = (sumFlows + m.exitNet - invested) / invested;

    return {
      invested, cfSeries, flows, y5WithExit,
      grossYield, netYield, npv, irr: irrVal, roi5,
      fmt: {
        grossYield: pct(grossYield),
        netYield: pct(netYield),
        npv: (npv < 0 ? '−' : '') + aed(Math.abs(npv), 2),
        irr: pct(irrVal),
        roi5: pct(roi5),
        invested: aed(invested),
        price: aed(m.price),
      },
    };
  }

  WS.finance = { compute, pct, aed };
})(window.WS = window.WS || {});
