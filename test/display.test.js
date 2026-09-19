'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_CATALOG, WR_SOLVER } = loadLibs();

/**
 * 可以大量計量的物品，換算後要落在 1～10 元。
 * 左邊是實際截圖解出的「每 1 單位」單價，右邊是看板上應該出現的數字。
 */
test('計價單位讓可大量計量的物品落在 1～10 元', () => {
  const cases = [
    ['ag', 0.0000022, 2.2],      // 每 1M
    ['au', 0.00558, 5.58],       // 每 1K
    ['key', 0.00484, 4.84],      // 每 1K
    ['cell', 0.0077, 7.7],       // 每 1K
    ['module', 0.135, 1.35],     // 每 10
    ['pilotchip', 0.0118, 1.18], // 每 100
    // 下面兩個是用 96 筆實際資料解出來的單價校準的。原本都設成「每 1K」，
    // 換算後會變成白金 95 元、微晶片 210 元 —— 完全違背「讓金額落在 1～10」的初衷。
    ['pt', 0.0953, 9.53],        // 每 100
    ['chip', 0.2104, 2.104]      // 每 10
  ];
  for (const [id, unitPrice, expected] of cases) {
    const got = WR_CATALOG.toDisplayPrice(id, unitPrice);
    assert.ok(Math.abs(got - expected) < 1e-9, `${id}: 期望 ${expected}，得到 ${got}`);
    assert.ok(got >= 1 && got < 10,
      `${id} 換算後是 ${got}，不在 1～10。請重新校準 catalog.js 的 per。`);
  }
});

/**
 * 資料卡與升級代幣一單位就值好幾十塊，而且買不到半張，
 * 所以它們停在「每 1 個／張」是刻意的，不是漏掉沒調。
 */
test('單位不可再細分的物品維持每 1 個', () => {
  for (const id of ['uptoken', 'dc_basic_ag', 'dc_titan', 'dc_ultimate', 'misc']) {
    assert.strictEqual(WR_CATALOG.perOf(id), 1, `${id} 不該有大於 1 的計價單位`);
  }
  assert.strictEqual(WR_CATALOG.toDisplayPrice('dc_basic_ag', 4.85), 4.85);
  assert.strictEqual(WR_CATALOG.toDisplayPrice('uptoken', 32.8), 32.8);
});

test('換算來回不會失真', () => {
  for (const id of WR_CATALOG.IDS) {
    const unit = 0.00731;
    const back = WR_CATALOG.toUnitPrice(id, WR_CATALOG.toDisplayPrice(id, unit));
    assert.ok(Math.abs(back - unit) < 1e-15, `${id} 來回換算跑掉了：${back}`);
  }
});

/**
 * 數字鍵盤上方的快捷值必須真的涵蓋商城會出現的數量。
 * 原本這些值是憑印象猜的，對上真實資料才發現差了幾十到幾百倍：
 * 銀幣快捷最大只到 20M，但實際禮包動輒 100M～500M；升級代幣快捷從 100 起跳，
 * 實際卻只會出現 1～7 個。快捷值沒對到，等於每次都要自己打全部數字。
 */
test('快捷值涵蓋實際會出現的數量範圍', () => {
  const seen = {
    ag: [100000000, 500000000], au: [2000, 20000], pt: [600, 10300],
    key: [5500, 50000], cell: [100, 54000], module: [100, 1700],
    chip: [200, 800], pilotchip: [2200, 12000], uptoken: [1, 7],
    dc_basic_ag: [3, 107], dc_weapon_ag: [5, 125], dc_bot_ag: [2, 38]
  };
  for (const [id, [lo, hi]] of Object.entries(seen)) {
    const steps = WR_CATALOG.get(id).steps;
    const min = Math.min(...steps);
    const max = Math.max(...steps);
    assert.ok(min <= lo * 2, `${id}: 最小快捷值 ${min} 遠高於實際最小量 ${lo}`);
    assert.ok(max >= hi * 0.5, `${id}: 最大快捷值 ${max} 遠低於實際最大量 ${hi}`);
  }
});

test('售價快捷值涵蓋最常見的定價', () => {
  // 實際 96 筆裡出現最多次的幾個價格
  for (const p of [66, 99, 130, 170, 200, 230, 260]) {
    assert.ok(WR_CATALOG.PRICE_STEPS.indexOf(p) >= 0, `售價快捷值缺少常見的 ${p}`);
  }
});

test('計價單位標籤', () => {
  assert.strictEqual(WR_CATALOG.perLabel('ag'), '1M');
  assert.strictEqual(WR_CATALOG.perLabel('au'), '1K');
  assert.strictEqual(WR_CATALOG.perLabel('key'), '1K');
  assert.strictEqual(WR_CATALOG.perLabel('module'), '10');
  assert.strictEqual(WR_CATALOG.perLabel('uptoken'), '');
  assert.strictEqual(WR_CATALOG.priceUnitLabel('ag'), '元 / 1M');
  assert.strictEqual(WR_CATALOG.priceUnitLabel('dc_titan'), '元 / 張');
  assert.strictEqual(WR_CATALOG.priceUnitLabel('uptoken'), '元 / 個');
});

test('null 與非數值不會變成 NaN 洩漏到畫面上', () => {
  assert.strictEqual(WR_CATALOG.toDisplayPrice('ag', null), null);
  assert.strictEqual(WR_CATALOG.toDisplayPrice('ag', undefined), null);
  assert.strictEqual(WR_CATALOG.toUnitPrice('ag', null), null);
  assert.strictEqual(WR_CATALOG.formatDisplayPrice('ag', null), '—');
});

test('沒有定義 per 的物品視為每 1 單位', () => {
  assert.strictEqual(WR_CATALOG.perOf('不存在的物品'), 1);
  assert.strictEqual(WR_CATALOG.toDisplayPrice('不存在的物品', 3.5), 3.5);
});

test('以計價單位填的參考值，換回原始單價後引擎才吃得下', () => {
  // 使用者在看板上看到「金幣 每 1K」，所以他填的 5.58 意思是每 1000 顆 5.58 元。
  const truth = { au: 0.00558, pt: 0.0011 };
  const bundles = makeBundles(truth, [
    { au: 20000, pt: 40000 }, { au: 5000 }, { pt: 100000 },
    { au: 10000, pt: 20000 }, { au: 2000, pt: 60000 }
  ]);

  const displayPrior = 5.58;
  const unitPrior = WR_CATALOG.toUnitPrice('au', displayPrior);
  assert.ok(Math.abs(unitPrior - 0.00558) < 1e-12, `換算後應為 0.00558，得到 ${unitPrior}`);

  const model = WR_SOLVER.solve(bundles, { bootstrap: false, priors: { au: unitPrior } });
  // 參考值等於真值，所以結果應該就在真值上
  assert.ok(Math.abs(model.prices.au - truth.au) / truth.au < 0.05,
    `金幣應解回 ${truth.au}，實際 ${model.prices.au}`);
  assert.ok(Math.abs(model.prices.pt - truth.pt) / truth.pt < 0.05,
    `白金應解回 ${truth.pt}，實際 ${model.prices.pt}`);
});

test('忘記換算計價單位的話，參考值會差上千倍而把結果拉歪', () => {
  // 這個測試在釘住「換算不能省略」：5.58 是每 1K 的價，直接餵進去就是每 1 顆 5.58 元。
  const truth = { au: 0.00558, pt: 0.0011 };
  const bundles = makeBundles(truth, [
    { au: 20000, pt: 40000 }, { au: 5000 }, { pt: 100000 }, { au: 10000, pt: 20000 }
  ]);
  const wrong = WR_SOLVER.solve(bundles, { bootstrap: false, priors: { au: 5.58 } });
  assert.ok(wrong.prices.au > truth.au * 10,
    `沒換算的話金幣應該被拉得離譜，實際 ${wrong.prices.au}`);
});

/* ---------- 輸入單位（跟計價單位是兩回事） ---------- */

test('銀幣以 M 為單位輸入，存進去的是原始數量', () => {
  assert.strictEqual(WR_CATALOG.inputScaleOf('ag'), 1000000);
  assert.strictEqual(WR_CATALOG.inputUnitOf('ag'), 'M');
  assert.strictEqual(WR_CATALOG.fromInputValue('ag', '2.5'), 2500000);
  assert.strictEqual(WR_CATALOG.fromInputValue('ag', '474.7'), 474700000);
  // 0.1 × 1e6 在浮點下是 100000.00000000001，必須取整
  assert.strictEqual(WR_CATALOG.fromInputValue('ag', '0.1'), 100000);
});

test('其他物品維持原樣輸入', () => {
  for (const id of ['au', 'pt', 'key', 'cell', 'dc_basic_ag']) {
    assert.strictEqual(WR_CATALOG.inputScaleOf(id), 1, `${id} 不該有輸入縮放`);
    assert.strictEqual(WR_CATALOG.inputUnitOf(id), '');
    assert.strictEqual(WR_CATALOG.fromInputValue(id, '5000'), 5000);
  }
});

test('數量與輸入字串來回轉換不失真', () => {
  for (const qty of [250000, 500000, 2500000, 15000000, 474700000]) {
    assert.strictEqual(WR_CATALOG.fromInputValue('ag', WR_CATALOG.toInputValue('ag', qty)), qty);
  }
});

test('空字串與非數值一律當成 0，不會寫出 NaN 數量', () => {
  for (const bad of ['', '.', 'abc', '-3', undefined]) {
    assert.strictEqual(WR_CATALOG.fromInputValue('ag', bad), 0, `輸入 ${bad} 應為 0`);
  }
});
