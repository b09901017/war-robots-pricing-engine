#!/usr/bin/env node
'use strict';

/**
 * 把 src/ 組裝成 clasp 可以直接 push 的 dist/。
 *
 * 唯一需要「建置」的理由：lib/ 底下的演算法必須同時跑在三個地方
 * —— Apps Script 伺服器端（.gs）、瀏覽器前端（包在 <script> 裡的 .html）、
 * 以及 node 測試。與其複製三份，不如留一份原始碼，建置時各自產生。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
}

function build() {
  rmrf(DIST);
  mkdirp(path.join(DIST, 'ui'));

  const written = [];

  fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(DIST, 'appsscript.json'));
  written.push('appsscript.json');

  for (const file of listFiles(path.join(SRC, 'server'), '.gs')) {
    fs.copyFileSync(path.join(SRC, 'server', file), path.join(DIST, file));
    written.push(file);
  }

  // lib：一份原始碼，兩種產出。
  // Apps Script 的 .gs 本來就是純 JS，所以伺服器端那份直接複製即可。
  for (const file of listFiles(path.join(SRC, 'lib'), '.js')) {
    const name = path.basename(file, '.js');
    const code = fs.readFileSync(path.join(SRC, 'lib', file), 'utf8');

    fs.writeFileSync(path.join(DIST, `lib_${name}.gs`), code);
    written.push(`lib_${name}.gs`);

    fs.writeFileSync(
      path.join(DIST, 'ui', `js_${name}.html`),
      `<script>\n${code}\n</script>\n`
    );
    written.push(`ui/js_${name}.html`);
  }

  for (const file of listFiles(path.join(SRC, 'ui'), '.html')) {
    fs.copyFileSync(path.join(SRC, 'ui', file), path.join(DIST, 'ui', file));
    written.push(`ui/${file}`);
  }

  // lib 的載入順序有相依性（solver 依賴 linalg 與 catalog），
  // 在這裡驗一次，免得改了檔名之後在 Apps Script 上才炸。
  const indexHtml = fs.readFileSync(path.join(SRC, 'ui', 'Index.html'), 'utf8');
  const includes = [...indexHtml.matchAll(/include\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = includes.filter((name) => !fs.existsSync(path.join(DIST, `${name}.html`)));
  if (missing.length) {
    console.error(`\n✗ Index.html 引用了不存在的檔案：${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`✓ 已建置 ${written.length} 個檔案到 dist/`);
  console.log(`  下一步：clasp push`);
}

build();
