#!/usr/bin/env node
'use strict';

/**
 * 產生一個可以直接用瀏覽器打開的離線版（dist-preview/index.html）。
 *
 * 把 Index.html 裡的 <?!= include(...) ?> 就地展開，再塞進一個以
 * localStorage 當儲存的假後端。用途有兩個：改介面時不用每次 push 上
 * Apps Script 才看得到結果；以及讓人在決定要不要架設之前先試用看看。
 *
 *   node tools/preview.js          產生檔案
 *   node tools/preview.js --serve  順便起一個本機伺服器
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist-preview');

function libScript(name) {
  return `<script>\n${fs.readFileSync(path.join(SRC, 'lib', `${name}.js`), 'utf8')}\n</script>`;
}

function uiFile(name) {
  return fs.readFileSync(path.join(SRC, 'ui', `${name}.html`), 'utf8');
}

function build() {
  let html = uiFile('Index');

  html = html.replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (_, name) => {
    const leaf = name.replace(/^ui\//, '');
    if (leaf.startsWith('js_')) return libScript(leaf.slice(3));
    return uiFile(leaf);
  });

  const mock = fs.readFileSync(path.join(__dirname, 'mock-backend.js'), 'utf8');
  const banner = `
<div id="previewBanner" style="
  position:fixed; left:12px; z-index:70;
  bottom:calc(84px + env(safe-area-inset-bottom,0px));
  padding:4px 11px; border-radius:999px; font-size:11px; font-weight:700;
  background:rgba(250,178,25,.16); color:#8a5d00; border:1px solid rgba(250,178,25,.5);
  font-family:'Manrope','Noto Sans TC',sans-serif; pointer-events:none;
">離線預覽 · 資料存在瀏覽器</div>
<script>
  (function () {
    var b = document.getElementById('previewBanner');
    if (window.matchMedia('(prefers-color-scheme: dark)').matches &&
        document.documentElement.getAttribute('data-theme') !== 'light') {
      b.style.color = '#fab219';
    }
    if (window.matchMedia('(min-width: 900px)').matches) b.style.bottom = '16px';
  })();
</script>
`;

  // 假後端要在 bridge 之前就定義好，所以放在 <body> 開頭。
  html = html.replace('<body>', `<body>\n<script>${mock}</script>`);
  html = html.replace('</body>', `${banner}\n</body>`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(`✓ 已產生 ${path.relative(ROOT, path.join(OUT, 'index.html'))}（${(html.length / 1024).toFixed(0)} KB）`);
  return path.join(OUT, 'index.html');
}

const file = build();

if (process.argv.includes('--serve')) {
  const port = Number(process.env.PORT) || 4173;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  }).listen(port, () => {
    console.log(`  預覽伺服器：http://localhost:${port}`);
  });
}
