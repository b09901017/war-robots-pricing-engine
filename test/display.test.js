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
    ['pilotchip', 0.0118, 1.18]  // 每 100
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

test('以計價單位鎖定的值，換回原始單價後引擎得到正確結果', () => {
  // 使用者在看板上看到「金幣 每 1K」，所以他輸入的 5.58 意思是每 1000 顆 5.58 元。
  const truth = { au: 0.00558, pt: 0.0011 };
  const bundles = makeBundles(truth, [
    { au: 20000, pt: 40000 }, { au: 5000 }, { pt: 100000 },
    { au: 10000, pt: 20000 }, { au: 2000, pt: 60000 }
  ]);

  const displayLock = 5.58;
  const unitLock = WR_CATALOG.toUnitPrice('au', displayLock);
  assert.ok(Math.abs(unitLock - 0.00558) < 1e-12, `換算後應為 0.00558，得到 ${unitLock}`);

  const model = WR_SOLVER.solve(bundles, { bootstrap: false, locks: { au: unitLock } });
  assert.ok(Math.abs(model.prices.au - 0.00558) < 1e-12, '鎖定值應原封不動進入模型');
  // 鎖定值等於真值時，白金也該解回真值。
  assert.ok(Math.abs(model.prices.pt - truth.pt) / truth.pt < 0.02,
    `白金應解回 ${truth.pt}，實際 ${model.prices.pt}`);

  // 而且看板上看到的又會變回 5.58。
  assert.ok(Math.abs(WR_CATALOG.toDisplayPrice('au', model.prices.au) - displayLock) < 1e-9);
});

test('若誤把計價單位的值直接當原始單價餵給引擎，結果會明顯錯掉', () => {
  // 這個測試是在釘住「換算不能省略」這件事：少換算一次，金幣會貴一千倍。
  const bundles = makeBundles({ au: 0.00558, pt: 0.0011 }, [
    { au: 20000, pt: 40000 }, { au: 5000 }, { pt: 100000 }, { au: 10000, pt: 20000 }
  ]);
  const wrong = WR_SOLVER.solve(bundles, { bootstrap: false, locks: { au: 5.58 } });
  assert.ok(wrong.warnings.some((w) => w.code === 'lock-exceeds-price'),
    '忘記換算應該會觸發「鎖定單價超過售價」的警告');
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
