/* ============================================================
   Схема планировки юнита.

   Дубайский брокер назвал это первым, что съедает время: клиент просит планировку,
   её нет под рукой, и она ищется руками по телеграм-ботам с брошюрами. Поэтому
   схема нужна — но нужно и честно сказать, ЧТО именно мы показываем.

   Чертежа застройщика в системе нет и взяться ему неоткуда. Здесь строится СХЕМА
   из тех чисел, которые у объекта есть на самом деле: площадь, число спален, вид,
   этаж. Она годится, чтобы объяснить клиенту раскладку и сориентировать по метражу,
   и НЕ годится как обмерный документ — так и подписано на самой картинке, чтобы
   подпись уехала вместе с изображением, куда бы его ни переслали.

   Рисуется вектором, без сети: стенд открывается с диска одним файлом.
   ============================================================ */
(function (WS) {
  'use strict';

  const C = {
    wall: '#2c2a26',
    fill: '#f7f4ee',
    room: '#ffffff',
    line: '#c9c2b4',
    ink: '#2c2a26',
    mut: '#8a8275',
    acc: '#c8721f',
    balcony: '#efe9dd',
  };

  /* Раскладка выводится из числа спален, а пропорции — из настоящей площади.
     Доли подобраны по типовым дубайским юнитам: жилая зона с кухней занимает
     примерно половину, спальня около трети, санузел и прихожая — остальное. */
  function layoutFor(br, size) {
    const b = String(br || '').toUpperCase();
    if (/STUDIO|СТУДИ/.test(b)) {
      return [
        { k: 'Жилая зона · кухня', share: 0.72 },
        { k: 'Санузел', share: 0.14 },
        { k: 'Прихожая', share: 0.14 },
      ];
    }
    if (/OFFICE|ОФИС/.test(b)) {
      return [
        { k: 'Открытая площадь', share: 0.62 },
        { k: 'Переговорная', share: 0.18 },
        { k: 'Санузел', share: 0.10 },
        { k: 'Приём', share: 0.10 },
      ];
    }
    if (/2BR|2 BR|ДВУХ/.test(b)) {
      return [
        { k: 'Гостиная · кухня', share: 0.42 },
        { k: 'Спальня 1', share: 0.22 },
        { k: 'Спальня 2', share: 0.18 },
        { k: 'Санузлы', share: 0.10 },
        { k: 'Прихожая', share: 0.08 },
      ];
    }
    // 1BR и 1BR+ — самый частый случай в инвентаре
    const plus = /\+/.test(b);
    return [
      { k: 'Гостиная · кухня', share: plus ? 0.46 : 0.50 },
      { k: 'Спальня', share: 0.28 },
      plus ? { k: 'Кабинет', share: 0.10 } : null,
      { k: 'Санузел', share: 0.12 },
      { k: 'Прихожая', share: plus ? 0.04 : 0.10 },
    ].filter(Boolean);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Прямоугольники раскладываются срезами: широкая полоса сверху под жилую зону,
     остальное делится по вертикали. Не архитектура — читаемая схема соотношений. */
  function blocks(rooms, W, H) {
    const out = [];
    const top = rooms[0];
    const topH = Math.round(H * Math.max(0.42, Math.min(0.6, top.share + 0.06)));
    out.push({ x: 0, y: 0, w: W, h: topH, r: top });
    const rest = rooms.slice(1);
    const restShare = rest.reduce((s, r) => s + r.share, 0) || 1;
    let x = 0;
    rest.forEach((r, i) => {
      const w = i === rest.length - 1 ? W - x : Math.round(W * (r.share / restShare));
      out.push({ x: x, y: topH, w: w, h: H - topH, r: r });
      x += w;
    });
    return out;
  }

  function svg(o) {
    const size = Number(o && o.size) || 0;
    const rooms = layoutFor(o && o.br, size);
    const W = 520, H = 360;
    const PAD = 26;
    // Место внизу занято подписями и полосой оговорки — комнаты на неё наезжать не должны.
    const iw = W - PAD * 2, ih = H - PAD * 2 - 68;
    const bs = blocks(rooms, iw, ih);
    const view = (o.attrs && o.attrs.view) || '';
    const viewLabel = view === 'city' ? 'город' : view === 'sea' ? 'море'
      : view === 'canal' ? 'канал' : view === 'park' ? 'парк' : '';

    const rects = bs.map((b) => {
      const m2 = size ? Math.round(size * b.r.share) : 0;
      const cx = PAD + b.x + b.w / 2, cy = PAD + b.y + b.h / 2;
      const small = b.w < 118;
      return '<rect x="' + (PAD + b.x) + '" y="' + (PAD + b.y) + '" width="' + b.w + '" height="' + b.h +
        '" fill="' + C.room + '" stroke="' + C.line + '" stroke-width="1.5"/>' +
        (small
          ? '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="9.5" fill="' + C.mut +
            '" font-family="system-ui,sans-serif">' + esc(b.r.k.split(' ')[0]) + '</text>' +
            (m2 ? '<text x="' + cx + '" y="' + (cy + 11) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + C.ink +
              '" font-family="system-ui,sans-serif">' + m2 + ' м²</text>' : '')
          : '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="11.5" fill="' + C.mut +
            '" font-family="system-ui,sans-serif">' + esc(b.r.k) + '</text>' +
            (m2 ? '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="14" font-weight="700" fill="' + C.ink +
              '" font-family="system-ui,sans-serif">' + m2 + ' м²</text>' : ''));
    }).join('');

    // Балкон и сторона вида — то, из-за чего два одинаковых по метражу юнита стоят по-разному.
    const balcony = '<rect x="' + PAD + '" y="' + (PAD - 13) + '" width="' + iw + '" height="11" fill="' + C.balcony +
      '" stroke="' + C.line + '" stroke-width="1"/>' +
      '<text x="' + (PAD + iw / 2) + '" y="' + (PAD - 4.5) + '" text-anchor="middle" font-size="8" fill="' + C.mut +
      '" font-family="system-ui,sans-serif" letter-spacing="0.08em">БАЛКОН' +
      (viewLabel ? ' · ВИД НА ' + viewLabel.toUpperCase() : '') + '</text>';

    const title = esc(o.name || 'Юнит');
    const sub = [o.br, size ? size + ' м²' : '', o.attrs && o.attrs.floor ? 'этаж ' + o.attrs.floor : '']
      .filter(Boolean).join(' · ');

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Схема планировки: ' + title + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="' + C.fill + '"/>' +
      balcony + rects +
      '<text x="' + PAD + '" y="' + (H - 34) + '" font-size="12.5" font-weight="700" fill="' + C.ink +
        '" font-family="system-ui,sans-serif">' + title + '</text>' +
      '<text x="' + PAD + '" y="' + (H - 20) + '" font-size="10.5" fill="' + C.mut +
        '" font-family="system-ui,sans-serif">' + esc(sub) + '</text>' +
      /* Подпись уезжает вместе с картинкой. Клиент, которому её переслали, обязан видеть,
         что это не обмерный чертёж, — иначе схема начнёт жить как документ. */
      /* Подпись была 9px в углу — на телефоне, куда картинку и перешлют, это нечитаемо.
         Оговорка, которую не видно, равносильна её отсутствию. Теперь полоса во всю ширину. */
      '<rect x="0" y="' + (H - 15) + '" width="' + W + '" height="15" fill="' + C.acc + '"/>' +
      '<text x="' + (W / 2) + '" y="' + (H - 4.5) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#fff"' +
        ' font-family="system-ui,sans-serif">Схема по площади и составу комнат · не чертёж застройщика</text>' +
      '</svg>';
  }

  function dataUrl(o) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(o));
  }

  /* Что мы можем сказать про планировку и чего сказать не можем. Вторая половина
     важнее первой: брокер должен знать, что нести клиенту, а что ещё запросить. */
  function note(o) {
    const has = [];
    const missing = [];
    if (o.size) has.push('площадь ' + o.size + ' м²'); else missing.push('площадь');
    if (o.br) has.push('состав — ' + o.br); else missing.push('число спален');
    if (o.attrs && o.attrs.floor) has.push('этаж ' + o.attrs.floor);
    if (o.attrs && o.attrs.view) has.push('вид');
    missing.push('обмерный чертёж застройщика');
    missing.push('точные размеры комнат');
    return { has: has, missing: missing };
  }

  WS.floorplan = { svg: svg, dataUrl: dataUrl, layoutFor: layoutFor, note: note };
})(window.WS = window.WS || {});
