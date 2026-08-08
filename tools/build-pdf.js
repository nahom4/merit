#!/usr/bin/env node
// Markdown -> styled HTML -> PDF (via headless Chrome), with Mermaid rendered.
//
//   node tools/build-pdf.js SRS-v2.md            -> SRS-v2.pdf
//   node tools/build-pdf.js SRS.md out/foo.pdf   -> out/foo.pdf
//
// Setup once:  cd tools && npm install

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { marked } = require('marked');

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/build-pdf.js <input.md> [output.pdf]');
  process.exit(1);
}
const srcPath = path.resolve(src);
const outPdf = path.resolve(process.argv[3] || srcPath.replace(/\.md$/, '.pdf'));
const tmpHtml = path.join(path.dirname(outPdf), '.' + path.basename(outPdf, '.pdf') + '.tmp.html');

let md = fs.readFileSync(srcPath, 'utf8');

// Pull mermaid fences out before marked touches them.
const diagrams = [];
md = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
  diagrams.push(code.trim());
  return `\n@@MERMAID${diagrams.length - 1}@@\n`;
});

marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: false });
let body = marked.parse(md);

body = body.replace(
  /<p>@@MERMAID(\d+)@@<\/p>/g,
  (_, i) =>
    `<div class="diagram"><pre class="mermaid">${diagrams[+i]
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre></div>`,
);

const mermaidJs = fs.readFileSync(path.join(__dirname, 'node_modules/mermaid/dist/mermaid.min.js'), 'utf8');

const title = (md.match(/^#\s+(.+)$/m) || [, 'Document'])[1].replace(/"/g, '');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
@page { size: A4; margin: 17mm 16mm 18mm 16mm; }

:root {
  --ink:#1a1d21; --muted:#5b6470; --faint:#8a929c;
  --rule:#dfe3e8; --rule-lt:#eceff2;
  --accent:#165c66; --accent-lt:#e8f1f2; --bg-soft:#f7f8f9;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family:"Source Sans 3","Segoe UI",-apple-system,"Helvetica Neue",Arial,sans-serif;
  font-size:10.2pt; line-height:1.55; color:var(--ink); margin:0; hyphens:none;
}

h1 { font-size:27pt; line-height:1.12; letter-spacing:-0.02em; font-weight:700; margin:0 0 2mm; }
h1 + h3 {
  font-size:13pt; font-weight:400; color:var(--accent);
  margin:0 0 6mm; padding:0 0 6mm; border-bottom:2.5px solid var(--accent);
  letter-spacing:-0.01em;
}
h1 + h3 + p { font-size:9.6pt; color:var(--muted); line-height:1.9; margin:0 0 5mm; }
h1 + h3 + p strong { color:var(--ink); font-weight:600; }

h2 {
  font-size:14pt; font-weight:700; letter-spacing:-0.01em;
  margin:9mm 0 3.5mm; padding-bottom:2mm; border-bottom:1px solid var(--rule);
  break-after:avoid; page-break-after:avoid;
}
h3 {
  font-size:11pt; font-weight:650; color:var(--accent);
  margin:6mm 0 2.5mm; break-after:avoid; page-break-after:avoid;
}
h2 + h3 { margin-top:4mm; }

p { margin:0 0 3mm; }
strong { font-weight:650; }
a { color:var(--accent); text-decoration:none; }
ul, ol { margin:0 0 3.5mm; padding-left:5.5mm; }
li { margin-bottom:1.4mm; }
li::marker { color:var(--faint); }
hr { border:0; border-top:1px solid var(--rule-lt); margin:7mm 0; }

blockquote {
  margin:3.5mm 0; padding:3mm 4.5mm; background:var(--accent-lt);
  border-left:3px solid var(--accent); color:#234; font-size:9.9pt; break-inside:avoid;
}
blockquote p { margin:0; }

table { width:100%; border-collapse:collapse; margin:3.5mm 0 5mm; font-size:9.2pt; }
thead { display:table-header-group; }
tr { break-inside:avoid; page-break-inside:avoid; }
th {
  text-align:left; font-weight:650; font-size:8.4pt; text-transform:uppercase;
  letter-spacing:0.05em; color:var(--muted); padding:2mm 2.5mm;
  border-bottom:1.5px solid var(--rule); background:var(--bg-soft);
}
td { padding:2mm 2.5mm; border-bottom:1px solid var(--rule-lt); vertical-align:top; }
tbody tr:last-child td { border-bottom:1px solid var(--rule); }

code {
  font-family:"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace;
  font-size:0.86em; background:var(--bg-soft); padding:0.4mm 1.2mm;
  border-radius:2px; color:#1f4d54;
}
pre {
  background:var(--bg-soft); border:1px solid var(--rule-lt); border-left:3px solid var(--accent);
  padding:3mm 4mm; margin:3mm 0 4.5mm; border-radius:3px;
  font-size:8.3pt; line-height:1.5; white-space:pre-wrap; word-break:break-word;
  break-inside:avoid; page-break-inside:avoid;
}
pre code { background:none; padding:0; font-size:inherit; color:#253238; }

.diagram {
  margin:5mm 0 6mm; padding:4mm 3mm; border:1px solid var(--rule);
  border-radius:4px; background:#fff; text-align:center;
  break-inside:avoid; page-break-inside:avoid;
}
.diagram svg { max-width:100%; height:auto; }
pre.mermaid { background:none; border:0; padding:0; margin:0; }

[id^="appendix"] { break-before:page; }
</style></head>
<body>
${body}
<script>${mermaidJs}<\/script>
<script>
  mermaid.initialize({
    startOnLoad:true, theme:'base', securityLevel:'loose',
    flowchart:{ curve:'basis', padding:10, useMaxWidth:true },
    themeVariables:{
      fontFamily:'"Source Sans 3","Segoe UI",Arial,sans-serif', fontSize:'15px',
      primaryColor:'#e8f1f2', primaryTextColor:'#1a1d21', primaryBorderColor:'#165c66',
      lineColor:'#5b6470', secondaryColor:'#f7f8f9', tertiaryColor:'#ffffff',
      clusterBkg:'#fbfcfc', clusterBorder:'#dfe3e8'
    }
  });
<\/script>
</body></html>`;

fs.writeFileSync(tmpHtml, html);

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find((c) => {
  try {
    execFileSync('command', ['-v', c], { shell: true });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) {
  console.error('no chrome/chromium found');
  process.exit(1);
}

execFileSync(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--virtual-time-budget=30000',
    '--run-all-compositor-stages-before-draw',
    '--no-pdf-header-footer',
    `--print-to-pdf=${outPdf}`,
    tmpHtml,
  ],
  { stdio: 'ignore' },
);

fs.unlinkSync(tmpHtml);
const kb = (fs.statSync(outPdf).size / 1024).toFixed(0);
console.log(`${path.basename(outPdf)}  (${kb} KB, ${diagrams.length} diagram(s))`);
