/* ============================================================
   Build the WEWALL-skinned variant of the stand.

   Strictly additive: it takes the already-built single-file
   artifact byte-for-byte and appends ONE stylesheet before
   </head>. Nothing in src/css, src/js or src/index.html is
   touched, so the two versions can never drift apart in
   behaviour — only in skin.

   Run:  node build-wewall.js [outPath]
   Default in : ../index.html        (the published stand)
   Default out: ../index-wewall.html (the second stand)
   ============================================================ */
const fs = require('fs');
const path = require('path');

const D = __dirname;
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const base = path.join(D, '..', 'index.html');
const outPath = process.argv[2] || path.join(D, '..', 'index-wewall.html');

if (!fs.existsSync(base)) throw new Error('build index.html first: npm run build');

let html = read(base);
const skin = read(path.join(D, 'css', 'theme-wewall.css'));

// Bebas Neue carries no Cyrillic, so on a Russian product it silently hands
// every heading to the fallback. Oswald is the display face that can actually
// set this language; it ships with the skin rather than with the base stand.
const fontLink = '  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&display=swap" rel="stylesheet">\n';

// The skin must win the cascade, so it goes last in <head>.
const block = '  <style id="skin-wewall">\n' + skin + '\n  </style>\n';
if (!html.includes('</head>')) throw new Error('no </head> in the built artifact');
html = html.replace('</head>', fontLink + block + '</head>');

html = html.replace(/<title>[^<]*<\/title>/, '<title>WESPACE · скин WEWALL</title>');

fs.writeFileSync(outPath, html);
console.log('built -> ' + outPath);
console.log('  base: ' + base + ' (' + Buffer.byteLength(read(base)) + ' bytes)');
console.log('  skin: ' + Buffer.byteLength(skin) + ' bytes  total: ' + Buffer.byteLength(html) + ' bytes');
