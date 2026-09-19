'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * 在單一 context 裡依序載入所有 lib 檔案 —— 跟 Apps Script 與瀏覽器裡
 * 「共用同一個全域範圍」的執行方式完全一致，所以測試環境就是正式環境。
 */
function loadLibs() {
  const dir = path.join(__dirname, '..', 'src', 'lib');
  const ctx = vm.createContext({ console, Math, Date, JSON, isFinite, Number, Object, Array, String });
  for (const file of ['catalog.js', 'linalg.js', 'solver.js', 'evaluate.js', 'sample.js', 'importer.js', 'prompt.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

/** 由已知的「真實單價」造出一批禮包，用來檢查引擎能不能把它們解回來。 */
function makeBundles(truth, specs) {
  return specs.map((qty, i) => {
    let price = 0;
    for (const id of Object.keys(qty)) price += qty[id] * (truth[id] || 0);
    return { id: 'b' + i, name: '禮包 ' + (i + 1), price, qty };
  });
}

module.exports = { loadLibs, makeBundles };
