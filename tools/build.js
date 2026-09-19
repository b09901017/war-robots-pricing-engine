#!/usr/bin/env node
'use strict';

/**
 * 產生兩份東西：
 *
 *   dist-web/index.html  —— 整個網站，單一檔案。GitHub Pages 部署的就是它。
 *   dist-gas/Code.gs     —— 貼進 Apps Script 的那一個檔案。
 *
 * 為什麼需要建置：src/lib/ 的演算法要同時跑在瀏覽器、Apps Script 和 node 測試裡。
 * 與其複製三份，不如留一份原始碼，建置時各自產生。物品目錄（catalog.js）
 * 兩邊都要用 —— 試算表的欄位標題就是從它來的，所以它會被接在 Code.gs 前面。
 *
 *   node tools/build.js          產生檔案
 *   node tools/build.js --serve  順便起一個本機伺服器
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const WEB = path.join(ROOT, 'dist-web');
const GAS = path.join(ROOT, 'dist-gas');

const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

function buildWeb() {
  let html = read('ui', 'index.html');

  html = html.replace(/<!--include:([\w:]+)-->/g, (_, token) => {
    if (token.startsWith('lib:')) {
      const name = token.slice(4);
      return `<script>\n${read('lib', `${name}.js`)}\n</script>`;
    }
    return read('ui', `${token}.html`);
  });

  const leftover = html.match(/<!--include:[\w:]+-->/g);
  if (leftover) {
    console.error(`\n✗ 有 include 沒有被展開：${leftover.join(', ')}`);
    process.exit(1);
  }

  // 漏掉一個 </script> 是靜默失敗：檔案照樣產生，但整個 app 不會跑。
  // 所以把每個 script 區塊都拿去解析一次，有問題就當場擋下來。
  const opens = (html.match(/<script>/g) || []).length;
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== opens) {
    console.error(`\n✗ <script> 標籤沒有成對：${opens} 個開頭，${blocks.length} 個結尾。檢查 src/ui/ 底下的檔案有沒有漏掉 </script>。`);
    process.exit(1);
  }
  for (const [i, block] of blocks.entries()) {
    try {
      new vm.Script(block[1]);
    } catch (err) {
      console.error(`\n✗ 第 ${i + 1} 個 script 區塊語法錯誤：${err.message}`);
      process.exit(1);
    }
  }

  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, 'index.html'), html);
  // GitHub Pages 預設會跑 Jekyll，底線開頭的檔案會被忽略。這裡沒有這種檔案，
  // 但關掉它可以少一道處理、部署也快一點。
  fs.writeFileSync(path.join(WEB, '.nojekyll'), '');
  return html.length;
}

function buildGas() {
  const code = [
    '/* 由 tools/build.js 產生，請不要直接編輯這個檔案。',
    ' * 原始碼在 src/gas/Code.gs 與 src/lib/catalog.js。',
    ' */',
    '',
    read('lib', 'catalog.js'),
    '',
    read('gas', 'Code.gs')
  ].join('\n');

  fs.mkdirSync(GAS, { recursive: true });
  fs.writeFileSync(path.join(GAS, 'Code.gs'), code);
  return code.length;
}

const webSize = buildWeb();
const gasSize = buildGas();
console.log(`✓ dist-web/index.html  ${(webSize / 1024).toFixed(0)} KB  （網站，GitHub Pages 部署這個）`);
console.log(`✓ dist-gas/Code.gs     ${(gasSize / 1024).toFixed(0)} KB  （貼進 Apps Script 的那一個檔案）`);

if (process.argv.includes('--serve')) {
  const port = Number(process.env.PORT) || 4173;
  const file = path.join(WEB, 'index.html');
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  }).listen(port, () => console.log(`  本機預覽：http://localhost:${port}`));
}
