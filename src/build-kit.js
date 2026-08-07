/* ============================================================
   Build the component showcase: WEWALL UI primitives, rewritten
   in plain CSS and filled with WESPACE content.

   The template carries {{PHOTO_<key>}} markers; the photos come
   from the stand's own offline photo module, so the showcase
   shows the same objects the stand shows.

   Run:  node build-kit.js [outPath]   -> ../kit-wewall.html
   ============================================================ */
const fs = require('fs');
const path = require('path');

const D = __dirname;
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// photos.js is a browser module: it self-attaches to window.WS.
const win = { WS: {} };
new Function('window', read(path.join(D, 'js', 'photos.js')))(win);
const WS = win.WS;
if (!WS.photos) throw new Error('photos.js did not expose WS.photos');

let html = read(path.join(D, 'kit', 'kit.html'));
const missing = [];
html = html.replace(/\{\{PHOTO_([a-z0-9_]+)\}\}/gi, (_m, key) => {
  if (!WS.photos[key]) { missing.push(key); return ''; }
  return WS.photos[key];
});
if (missing.length) throw new Error('unknown photo keys: ' + missing.join(', '));

const outPath = process.argv[2] || path.join(D, '..', 'kit-wewall.html');
fs.writeFileSync(outPath, html);
console.log('built -> ' + outPath + '  (' + Buffer.byteLength(html) + ' bytes)');
