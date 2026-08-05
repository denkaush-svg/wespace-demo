/* ============================================================
   Build the single-file WESPACE stand published to GitHub Pages.

   Source of truth is this directory (index.html + css/ + js/).
   The published artifact is one self-contained index.html:
     - the 3 stylesheet links collapse into one <style>
     - the 11 module scripts inline in load order
     - title + WS_BUILD carry a build stamp

   Run:  node build.js [outPath] [--stamp HH:MM]
   Default outPath: ../wespace-preview-built.html
   ============================================================ */
const fs = require('fs');
const path = require('path');

const D = __dirname;
// Sources are edited on Windows and may carry CRLF; the published artifact is LF-only.
const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');

const args = process.argv.slice(2);
const stampIdx = args.indexOf('--stamp');
const stampValIdx = stampIdx >= 0 ? stampIdx + 1 : -1; // -1 so a lone positional arg is not skipped
// Default target is the published artifact at the repo root — what GitHub Pages serves.
const outPath = args.find((a, i) => !a.startsWith('--') && i !== stampValIdx) || path.join(D, '..', 'index.html');
const stamp = stampIdx >= 0 ? args[stampIdx + 1] : (() => {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
})();

let html = read('index.html');

// 1. Collapse the stylesheet links into a single inline <style>, preserving link order.
const cssFiles = [];
html = html.replace(/[ \t]*<link rel="stylesheet" href="css\/([^"]+)">\n/g, (_m, f) => {
  cssFiles.push(f);
  return '';
});
if (!cssFiles.length) throw new Error('no stylesheet links found in index.html');
const styleBlock = '  <style>\n' + cssFiles.map((f) => read('css/' + f)).join('\n\n') + '\n  </style>\n';
// Re-insert where the links were: immediately before </head>.
html = html.replace('</head>', styleBlock + '</head>');

// 2. Inline the module scripts in load order.
const jsFiles = [];
html = html.replace(/([ \t]*)<script src="js\/([^"]+)"><\/script>\n/g, (_m, indent, f) => {
  jsFiles.push(f);
  return indent + '<script>\n' + read('js/' + f) + '\n</script>\n';
});
if (!jsFiles.length) throw new Error('no module scripts found in index.html');

// 3. Build stamp — title + WS_BUILD.
html = html.replace(/<title>[^<]*<\/title>/, '<title>WESPACE · сборка ' + stamp + '</title>');
html = html.replace("window.WS_BUILD=window.WS_BUILD||'DEV';", "window.WS_BUILD='" + stamp + "';");

fs.writeFileSync(outPath, html);
console.log('built -> ' + outPath);
console.log('  css: ' + cssFiles.join(', '));
console.log('  js : ' + jsFiles.join(', '));
console.log('  stamp: ' + stamp + '  size: ' + Buffer.byteLength(html) + ' bytes');
