/* ============================================================
   The report file.

   Same block vocabulary as an answer in the chat, but assembled into a
   standalone document: its own styles, its own fonts, nothing referenced from
   the stand. A broker forwards this file to a client, so it has to open
   correctly on a phone that has never seen WESPACE.

   Values are escaped here exactly as they are in the chat — a report is
   built from a model's output and mailed onward, which is the worst possible
   place for markup to slip through.
   ============================================================ */
(function (WS) {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]); }

  const CSS = [
    ':root{--ink:#171717;--ink2:#404040;--mut:#737373;--faint:#a3a3a3;--line:#e5e5e5;',
    '--hair:#f0f0f0;--soft:#fafafa;--acc:#F26522;--acc-soft:#FFF3EC;--acc-line:#FBD5C0}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#f5f5f4;color:var(--ink);',
    "font:15px/1.6 Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    '-webkit-text-size-adjust:100%}',
    '.wrap{max-width:820px;margin:0 auto;padding:28px 20px 64px}',
    '.sheet{background:#fff;border:1px solid var(--line);border-radius:16px;padding:34px 34px 30px}',
    '.brand{display:flex;align-items:center;gap:9px;margin-bottom:26px}',
    '.mark{width:26px;height:26px;border-radius:7px;background:var(--ink);color:#fff;',
    'display:grid;place-items:center;font-weight:800;font-size:13px;flex:none}',
    '.brand b{font-weight:800;letter-spacing:-.01em}.brand span{color:var(--acc);font-weight:800}',
    'h1{margin:0 0 6px;font-size:27px;line-height:1.22;letter-spacing:-.02em;font-weight:800}',
    '.sub{margin:0 0 4px;color:var(--mut);font-size:14px}',
    '.meta{margin:14px 0 26px;padding-top:14px;border-top:1px solid var(--hair);',
    'color:var(--faint);font-size:12px;display:flex;flex-wrap:wrap;gap:6px 18px}',
    'h2{margin:26px 0 10px;font-size:11px;font-weight:800;letter-spacing:.07em;',
    'text-transform:uppercase;color:var(--faint)}h2:first-of-type{margin-top:0}',
    'p{margin:0 0 11px}ul{margin:0 0 13px;padding-left:19px}li{margin-bottom:4px}',
    '.kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;',
    'padding:8px 12px;background:var(--soft);border-radius:9px;margin-bottom:6px}',
    '.kv .k{color:var(--mut);font-size:13.5px}',
    '.kv .v{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.tw{overflow-x:auto;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:14px}',
    'th{text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;',
    'color:var(--faint);padding:0 12px 7px 0;white-space:nowrap}',
    'td{padding:7px 12px 7px 0;border-top:1px solid var(--hair);font-variant-numeric:tabular-nums}',
    'td:first-child{font-weight:600}',
    '.bars{margin-bottom:14px}',
    '.bar{display:grid;grid-template-columns:minmax(0,1fr) minmax(70px,2.2fr) auto;',
    'align-items:center;gap:11px;margin-bottom:7px}',
    '.bar .bl{color:var(--ink2);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bar .bt{height:8px;background:var(--soft);border-radius:99px;overflow:hidden}',
    '.bar .bt i{display:block;height:100%;background:var(--acc);border-radius:99px}',
    '.bar .bv{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:14px}',
    '.note{display:flex;gap:9px;padding:12px 14px;background:var(--acc-soft);',
    'border:1px solid var(--acc-line);border-radius:11px;color:var(--ink2);font-size:13px;margin-bottom:14px}',
    '.foot{margin-top:30px;padding-top:15px;border-top:1px solid var(--hair);',
    'color:var(--faint);font-size:11.5px;line-height:1.55}',
    '@media(max-width:640px){.wrap{padding:14px 12px 40px}.sheet{padding:22px 17px 20px;border-radius:13px}',
    'h1{font-size:22px}.bar{grid-template-columns:minmax(0,1fr) auto;}',
    '.bar .bt{grid-column:1/-1;order:3}}',
    '@media print{body{background:#fff}.wrap{padding:0}.sheet{border:0;border-radius:0;padding:0}}',
  ].join('');

  // Russian prints a decimal comma, and no gap before a percent sign. Left as
  // «8.1 %» this reads as a machine artefact in a document sent to a client.
  function val(v, suffix) {
    const s = String(v == null ? '' : v).replace('.', ',');
    const suf = String(suffix || '');
    if (!suf) return s;
    return suf === '%' ? s + suf : s + '\u00a0' + suf;
  }

  // The same shapes the chat renders, drawn for a standalone page.
  function blockHtml(b) {
    if (!b || typeof b !== 'object') return '';
    const t = String(b.t || '');
    if (t === 'h') return '<h2>' + esc(b.text) + '</h2>';
    if (t === 'p') return '<p>' + esc(b.text) + '</p>';
    if (t === 'note') return '<div class="note">' + esc(b.text) + '</div>';
    if (t === 'list') {
      const li = (b.items || []).slice(0, 20).map((x) => '<li>' + esc(x) + '</li>').join('');
      return li ? '<ul>' + li + '</ul>' : '';
    }
    if (t === 'kv') {
      return (b.rows || []).slice(0, 20).map((x) =>
        '<div class="kv"><span class="k">' + esc(x && x.k) + '</span>' +
        '<span class="v">' + esc(x && x.v) + '</span></div>').join('');
    }
    if (t === 'table') {
      const head = (b.head || []).slice(0, 6);
      const body = (b.rows || []).slice(0, 40).map((row) =>
        '<tr>' + (Array.isArray(row) ? row : []).slice(0, 6).map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
      if (!body) return '';
      return '<div class="tw"><table>' +
        (head.length ? '<thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>' : '') +
        '<tbody>' + body + '</tbody></table></div>';
    }
    if (t === 'bars') {
      const rows = (b.rows || []).slice(0, 12).filter((x) => x && isFinite(Number(x.value)));
      if (!rows.length) return '';
      const max = Math.max.apply(null, rows.map((x) => Math.abs(Number(x.value)))) || 1;
      return '<div class="bars">' + rows.map((x) => {
        const w = Math.max(3, Math.round(Math.abs(Number(x.value)) / max * 100));
        return '<div class="bar"><span class="bl">' + esc(x.label) + '</span>' +
          '<span class="bt"><i style="width:' + w + '%"></i></span>' +
          '<span class="bv">' + esc(val(x.value, x.suffix)) + '</span></div>';
      }).join('') + '</div>';
    }
    return '';
  }

  // Whoever receives this file did not watch it being made, so the footer says
  // what it is and where its figures came from. A demo figure leaving the
  // stand unlabelled is the one failure this whole design exists to prevent.
  function provenance() {
    const rows = (WS.store && WS.store.data && WS.store.data.market) || [];
    const demo = rows.some((r) => r.basis && r.basis !== 'публикация');
    const who = (WS.store && WS.store.data && WS.store.data.tenant) || {};
    return [
      'Собрано Консьержем WESPACE' + (who.name ? ' · ' + who.name : '') + '.',
      demo ? 'Рыночные величины в этом документе демонстрационные, не из публикации — проверьте перед отправкой клиенту.' : '',
      'Показатели по сделкам и задачам посчитаны по данным рабочего места на момент сборки.',
    ].filter(Boolean).join(' ');
  }

  function build(spec) {
    const s = spec || {};
    const title = esc(s.title || 'Аналитическая записка');
    const blocks = (Array.isArray(s.blocks) ? s.blocks : []).map(blockHtml).join('');
    const stamp = (WS.storeApi && WS.storeApi.clockLabel) ? WS.storeApi.clockLabel() : {};
    const meta = [stamp.date, stamp.time].filter(Boolean)
      .map((x) => '<span>' + esc(x) + '</span>').join('');
    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<title>' + title + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">' +
      '<style>' + CSS + '</style></head><body><div class="wrap"><div class="sheet">' +
      '<div class="brand"><span class="mark">W</span><b>WE<span>SPACE</span></b></div>' +
      '<h1>' + title + '</h1>' +
      (s.subtitle ? '<p class="sub">' + esc(s.subtitle) + '</p>' : '') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      blocks +
      '<div class="foot">' + esc(provenance()) + '</div>' +
      '</div></div></body></html>';
  }

  function fileName(title) {
    const base = String(title || 'отчёт').toLowerCase().replace(/[^\wа-яё]+/gi, '-').replace(/^-+|-+$/g, '');
    return 'wespace-' + (base || 'report').slice(0, 48) + '.html';
  }

  // Held so the chat card can offer the same document twice without rebuilding
  // it, and so a test can read what was produced without a download.
  const made = {};
  let seq = 0;

  function create(spec) {
    seq++;
    const id = 'rp' + seq;
    const html = build(spec);
    made[id] = { id: id, html: html, title: (spec && spec.title) || 'Аналитическая записка', name: fileName(spec && spec.title) };
    return made[id];
  }
  function get(id) { return made[id] || null; }

  function download(id) {
    const r = made[id];
    if (!r || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = r.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  function openTab(id) {
    const r = made[id];
    if (!r || typeof Blob === 'undefined' || !URL.createObjectURL) return false;
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  WS.report = { build, create, get, download, openTab, fileName, blockHtml };
})(window.WS = window.WS || {});
