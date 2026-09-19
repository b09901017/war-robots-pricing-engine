'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_LINALG, WR_SOLVER, WR_EVAL, WR_CATALOG } = loadLibs();

test('NNLS 解得出無約束就已經非負的簡單系統', () => {
  const A = [[1, 0], [0, 1], [1, 1]];
  const b = [2, 3, 5];
  const x = WR_LINALG.nnls(A, b, 0);
  assert.ok(Math.abs(x[0] - 2) < 1e-6, `x0=${x[0]}`);
  assert.ok(Math.abs(x[1] - 3) < 1e-6, `x1=${x[1]}`);
});

test('NNLS 把會變成負數的係數夾在 0，而不是回傳負值', () => {
  // 無約束最小平方會給 x = [-1, 2]；非負約束下正解是 [0, 1.5] 附近。
  const A = [[1, 1], [1, 2]];
  const b = [1, 3];
  const x = WR_LINALG.nnls(A, b, 0);
  assert.ok(x[0] >= 0 && x[1] >= 0, `解出現負值: ${JSON.stringify(x)}`);
  assert.ok(Math.abs(x[0]) < 1e-6, `x0 應被夾到 0，實際 ${x[0]}`);
});

test('量級差六個數量級的物品仍能被同時解出', () => {
  // 銀幣單價 ~2e-6、終極資料卡單價 120，中間差了近八個數量級。
  const truth = { ag: 0.000002, au: 0.02, dc_ultimate: 120 };
  const bundles = makeBundles(truth, [
    { ag: 1000000, au: 2500 },
    { ag: 2500000, dc_ultimate: 1 },
    { au: 10000, dc_ultimate: 2 },
    { ag: 500000, au: 1000, dc_ultimate: 1 },
    { ag: 250000, au: 5000 },
    { dc_ultimate: 3 },
    { ag: 1000000 },
    { au: 20000, dc_ultimate: 1 }
  ]);

  const model = WR_SOLVER.solve(bundles, { ridge: 0, bootstrap: false });
  for (const id of Object.keys(truth)) {
    const got = model.prices[id];
    const rel = Math.abs(got - truth[id]) / truth[id];
    assert.ok(rel < 0.02, `${id}: 期望 ${truth[id]}，解出 ${got}（相對誤差 ${(rel * 100).toFixed(2)}%）`);
  }
  assert.ok(model.fit.mape < 0.01, `完美資料的 MAPE 應接近 0，實際 ${model.fit.mape}`);
  assert.ok(model.fit.r2 > 0.999, `R² 應接近 1，實際 ${model.fit.r2}`);
});

test('資料含雜訊時仍能收斂到接近真值', () => {
  const truth = { ag: 0.0000024, au: 0.018, pt: 0.0009, key: 0.00035, chip: 0.0085 };
  const specs = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 40; i++) {
    const qty = {};
    for (const id of Object.keys(truth)) {
      if (rand() < 0.55) qty[id] = Math.round((0.2 + rand() * 3) * refQty(id));
    }
    if (Object.keys(qty).length === 0) qty.au = 1000;
    specs.push(qty);
  }
  const bundles = makeBundles(truth, specs).map((b) => ({
    ...b,
    price: b.price * (0.92 + rand() * 0.16)  // ±8% 的定價雜訊
  }));

  const model = WR_SOLVER.solve(bundles, { bootstrap: false });
  for (const id of Object.keys(truth)) {
    const rel = Math.abs(model.prices[id] - truth[id]) / truth[id];
    assert.ok(rel < 0.25, `${id}: 期望 ${truth[id]}，解出 ${model.prices[id]}（相對誤差 ${(rel * 100).toFixed(1)}%）`);
  }

  function refQty(id) {
    return { ag: 1000000, au: 2000, pt: 40000, key: 30000, chip: 6400 }[id];
  }
});

test('單價永遠不為負，即使禮包定價明顯不一致', () => {
  const bundles = [
    { id: 'a', price: 100, qty: { au: 1000, ag: 500000 } },
    { id: 'b', price: 30, qty: { au: 1000 } },
    { id: 'c', price: 200, qty: { ag: 500000 } },
    { id: 'd', price: 10, qty: { au: 500, ag: 2000000 } }
  ];
  const model = WR_SOLVER.solve(bundles, { bootstrap: false });
  for (const id of Object.keys(model.prices)) {
    assert.ok(model.prices[id] >= 0, `${id} 解出負值 ${model.prices[id]}`);
  }
});

test('參考值只在資料分不出來時介入，不會取代資料', () => {
  const truth = { au: 0.02, pt: 0.001 };
  const bundles = makeBundles(truth, [
    { au: 1000, pt: 20000 }, { au: 5000 }, { au: 2500 }, { pt: 100000 },
    { au: 3000, pt: 40000 }, { pt: 50000 }, { au: 800, pt: 10000 }
  ]);
  // 給一個錯一倍的參考值：資料足夠，所以結果應該還是靠近真值而不是參考值
  const model = WR_SOLVER.solve(bundles, { bootstrap: false, priors: { au: 0.04 } });
  assert.ok(Math.abs(model.prices.au - truth.au) < Math.abs(model.prices.au - 0.04),
    `解出 ${model.prices.au}，應該比較靠近真值 ${truth.au} 而不是參考值 0.04`);
  const au = model.items.find((it) => it.id === 'au');
  assert.strictEqual(au.prior, 0.04);
  assert.ok(au.priorPull !== null, '要回報參考值的影響程度');
});

test('bootstrap 區間會包住點估計，且稀有物品的區間明顯較寬', () => {
  const truth = { au: 0.02, ag: 0.000002, dc_titan: 60 };
  const specs = [];
  for (let i = 0; i < 24; i++) {
    specs.push({ au: 500 + i * 250, ag: 100000 + i * 90000 });
  }
  specs.push({ au: 1000, dc_titan: 1 });  // 泰坦只出現一次

  const model = WR_SOLVER.solve(makeBundles(truth, specs), { samples: 200 });
  const au = model.items.find((it) => it.id === 'au');
  const titan = model.items.find((it) => it.id === 'dc_titan');

  assert.ok(au.low !== null && au.high !== null, '常見物品應有區間');
  assert.ok(au.low <= au.price + 1e-12 && au.price <= au.high + 1e-12,
    `區間 [${au.low}, ${au.high}] 未包住點估計 ${au.price}`);
  assert.strictEqual(au.confidence, 'high');
  assert.strictEqual(titan.occurrences, 1);
  assert.ok(titan.confidence !== 'high', '只出現一次的物品不該是高信心');
});

test('重複求解得到完全相同的區間（固定種子）', () => {
  const bundles = makeBundles({ au: 0.02, pt: 0.001 }, [
    { au: 1000, pt: 20000 }, { au: 5000 }, { pt: 50000 },
    { au: 2500, pt: 10000 }, { au: 800, pt: 40000 }, { pt: 100000 }
  ]);
  const a = WR_SOLVER.solve(bundles, { samples: 120 });
  const b = WR_SOLVER.solve(bundles, { samples: 120 });
  assert.deepStrictEqual(
    a.items.map((i) => [i.id, i.low, i.high]),
    b.items.map((i) => [i.id, i.low, i.high])
  );
});

test('沒有資料時回傳空模型而不是爆炸', () => {
  const model = WR_SOLVER.solve([], {});
  assert.strictEqual(model.bundleCount, 0);
  assert.strictEqual(model.items.length, 0);
  assert.ok(model.warnings.some((w) => w.code === 'no-data'));
});

test('被停用與定價無效的禮包會被排除', () => {
  const bundles = [
    { id: 'a', price: 100, qty: { au: 5000 } },
    { id: 'b', price: 200, qty: { au: 10000 }, enabled: false },
    { id: 'c', price: 0, qty: { au: 1000 } },
    { id: 'd', price: 50, qty: {} }
  ];
  const model = WR_SOLVER.solve(bundles, { bootstrap: false });
  assert.strictEqual(model.bundleCount, 1);
});

test('試算器：低於行情的組合被判為偏貴，高於行情的被判為超值', () => {
  const truth = { au: 0.02, pt: 0.001 };
  const bundles = makeBundles(truth, [
    { au: 1000, pt: 20000 }, { au: 5000 }, { pt: 50000 },
    { au: 2500, pt: 10000 }, { au: 800, pt: 40000 }, { pt: 100000 },
    { au: 3000, pt: 5000 }, { au: 1500, pt: 60000 }
  ]);
  const model = WR_SOLVER.solve(bundles, { samples: 150 });

  const fair = WR_EVAL.evaluate({ qty: { au: 5000 }, price: 100 }, model);
  assert.strictEqual(fair.tier.id, 'fair', `應為正常行情，實際 ${fair.tier.id}（指數 ${fair.ratio}）`);

  const great = WR_EVAL.evaluate({ qty: { au: 5000 }, price: 50 }, model);
  assert.strictEqual(great.tier.id, 'great');
  assert.ok(great.ratio > 1.9);

  const bad = WR_EVAL.evaluate({ qty: { au: 5000 }, price: 250 }, model);
  assert.strictEqual(bad.tier.id, 'bad');
});

test('試算器：貢獻度加總等於理論價值，且沒有單價的物品被單獨列出', () => {
  const model = WR_SOLVER.solve(
    makeBundles({ au: 0.02, pt: 0.001 }, [
      { au: 1000, pt: 20000 }, { au: 5000 }, { pt: 50000 }, { au: 2500, pt: 10000 }
    ]),
    { samples: 100 }
  );
  const res = WR_EVAL.evaluate({ qty: { au: 2000, pt: 30000, dc_ultimate: 2 }, price: 150 }, model);

  const sum = res.contributions.reduce((s, c) => s + c.value, 0);
  assert.ok(Math.abs(sum - res.value) < 1e-9);
  assert.deepStrictEqual([...res.unpriced].map((u) => u.id), ['dc_ultimate']);
  assert.ok(res.contributions[0].value >= res.contributions[1].value, '貢獻應由大到小排序');
  assert.ok(res.ratioLow <= res.ratio && res.ratio <= res.ratioHigh,
    `指數區間 [${res.ratioLow}, ${res.ratioHigh}] 未包住 ${res.ratio}`);
});

test('正常行情的寬度跟著模型誤差走', () => {
  assert.strictEqual(WR_EVAL.normalBand({ fit: { mape: 0.15 } }), 0.15);
  assert.strictEqual(WR_EVAL.normalBand({ fit: { mape: 0.01 } }), 0.06, '下限 6%');
  assert.strictEqual(WR_EVAL.normalBand({ fit: { mape: 0.9 } }), 0.25, '上限 25%');
});

test('單價格式化會隨數量級調整位數', () => {
  assert.strictEqual(WR_CATALOG.formatUnitPrice(0.000002), '0.000002');
  assert.strictEqual(WR_CATALOG.formatUnitPrice(0.0185), '0.0185');
  assert.strictEqual(WR_CATALOG.formatUnitPrice(1.5), '1.50');
  assert.strictEqual(WR_CATALOG.formatUnitPrice(123.4), '123');
  assert.strictEqual(WR_CATALOG.formatUnitPrice(0), '0');
});

test('數量格式化會縮寫大數字', () => {
  assert.strictEqual(WR_CATALOG.formatQty(2500000), '2.5M');
  assert.strictEqual(WR_CATALOG.formatQty(12800), '12.8K');
  assert.strictEqual(WR_CATALOG.formatQty(500), '500');
});

test('目錄涵蓋需求裡列出的所有物品', () => {
  const expected = [
    'ag', 'au', 'pt', 'key', 'cell', 'module', 'chip', 'pilotchip', 'uptoken',
    'dc_basic_ag', 'dc_basic_au', 'dc_weapon_ag', 'dc_weapon_au',
    'dc_bot_ag', 'dc_bot_au', 'dc_titan', 'dc_newbot_ag', 'dc_newbot_au',
    'dc_ultimate', 'misc'
  ];
  assert.deepStrictEqual([...WR_CATALOG.IDS], expected);
});
