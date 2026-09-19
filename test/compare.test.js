'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_COMPARE, WR_CATALOG, WR_EVAL, WR_SOLVER } = loadLibs();

const TRUTH = { au: 0.00558, ag: 0.0000022, key: 0.00484, cell: 0.0077 };
const jitter = (i) => 1 + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.03;

function data() {
  return makeBundles(TRUTH, [
    { au: 20000, ag: 5000000 }, { au: 5000, key: 2000 }, { ag: 10000000, cell: 1500 },
    { au: 10000, cell: 800 }, { key: 5000, ag: 2000000 }, { au: 30000, key: 1000 },
    { cell: 3000, ag: 8000000 }, { au: 2000, ag: 1000000 }, { key: 8000, cell: 2000 },
    { au: 15000, ag: 4000000, key: 1500 }, { ag: 20000000 }, { au: 40000 }
  ]).map((b, i) => ({ ...b, price: b.price * jitter(i) }));
}

test('沒填參考值時只有三個變體，填了才出現「參考值優先」', () => {
  const bare = WR_COMPARE.build(data(), {});
  assert.deepStrictEqual([...bare.map((v) => v.key)], ['ls', 'robust', 'bayes']);

  const withPrior = WR_COMPARE.build(data(), { priors: { au: TRUTH.au } });
  assert.deepStrictEqual([...withPrior.map((v) => v.key)], ['ls', 'robust', 'prior', 'bayes']);
});

test('每個變體都真的用了不同的算法', () => {
  const variants = WR_COMPARE.build(data(), { priors: { au: TRUTH.au } });
  const byKey = {};
  variants.forEach((v) => { byKey[v.key] = v.model; });
  assert.strictEqual(byKey.ls.method, 'ls');
  assert.strictEqual(byKey.robust.method, 'robust');
  assert.strictEqual(byKey.bayes.method, 'bayes');
  assert.strictEqual(byKey.bayes.draws.source, 'posterior');
  assert.strictEqual(byKey.ls.draws.source, 'bootstrap');
});

test('「參考值優先」真的把參考值釘住，即使資料不同意', () => {
  // 故意給一個離譜的參考值：真值的三倍
  const wrong = TRUTH.au * 3;
  const variants = WR_COMPARE.build(data(), { priors: { au: wrong } });
  const prior = variants.filter((v) => v.key === 'prior')[0].model;
  const robust = variants.filter((v) => v.key === 'robust')[0].model;

  assert.ok(Math.abs(prior.prices.au - wrong) / wrong < 0.05,
    `參考值優先應該釘在 ${wrong}，實際 ${prior.prices.au}`);
  // 而正常的穩健回歸應該無視這個離譜的參考值（資料夠，參考值已退場）
  assert.ok(Math.abs(robust.prices.au - TRUTH.au) / TRUTH.au < 0.1,
    `穩健回歸應該由資料決定，實際 ${robust.prices.au}`);
});

test('四種算法對同一個組合各給一個判斷', () => {
  const variants = WR_COMPARE.build(data(), { priors: { au: TRUTH.au } });
  const candidate = { price: 200, qty: { au: 20000, ag: 5000000 } };
  const list = WR_COMPARE.verdicts(candidate, variants);

  assert.strictEqual(list.length, 4);
  list.forEach((v) => {
    assert.ok(v.ev.ratio > 0, `${v.label} 應該算得出性價比`);
    assert.ok(v.ev.tier && v.ev.tier.label, `${v.label} 應該有等第`);
  });
});

test('結論一致時共識是 strong，分歧時是 weak', () => {
  const variants = WR_COMPARE.build(data(), {});
  const agree = WR_COMPARE.verdicts({ price: 200, qty: { au: 20000, ag: 5000000 } }, variants);
  assert.strictEqual(WR_COMPARE.consensus(agree).level, 'strong');

  // 手工捏造分歧：把其中一個變體的判斷換成極端值
  const split = agree.map((v, i) => i === 0
    ? { ...v, ev: { ...v.ev, ratio: 3.0, tier: { id: 'great', label: '超值', tone: 'good' } } }
    : v);
  const c = WR_COMPARE.consensus(split);
  assert.strictEqual(c.level, 'weak');
  assert.ok(/算法之間看法不同/.test(c.text));
});

test('「超值」與「划算」算同一個方向，不會被當成分歧', () => {
  const base = { ev: { ratio: 1.2, tier: { id: 'good' } } };
  const list = [
    { ...base, ev: { ratio: 1.20, tier: { id: 'good' } } },
    { ...base, ev: { ratio: 1.26, tier: { id: 'great' } } }
  ];
  assert.notStrictEqual(WR_COMPARE.consensus(list).level, 'weak');
});

test('空清單不會爆炸', () => {
  assert.strictEqual(WR_COMPARE.consensus([]).level, 'none');
});

/* ==========================================================================
   行情參考：第五欄，而且刻意不是第五種算法
   ========================================================================== */

test('行情參考完全不影響四種算法解出來的單價', () => {
  // 行情參考價寫在物品目錄裡，任何一條求解路徑都不該讀到它。
  // 這條測試的價值在於：哪天有人「順手」把它接進 priors，這裡會立刻紅。
  const bundles = data();
  const before = WR_COMPARE.build(bundles, {}).map((v) => ({ ...v.model.prices }));

  const backup = WR_CATALOG.ITEMS.map((it) => it.ref);
  WR_CATALOG.ITEMS.forEach((it) => { if (it.ref) it.ref = [it.ref[0] * 50, it.ref[1] * 50]; });
  try {
    const after = WR_COMPARE.build(bundles, {}).map((v) => ({ ...v.model.prices }));
    after.forEach((prices, i) => {
      Object.keys(prices).forEach((id) => {
        assert.strictEqual(prices[id], before[i][id],
          `把行情參考價乘 50 之後 ${id} 的單價變了，代表它被接進求解了`);
      });
    });
  } finally {
    WR_CATALOG.ITEMS.forEach((it, i) => { if (backup[i]) it.ref = backup[i]; });
  }
});

test('行情參考用目錄裡的上下限直接乘，不經過任何模型', () => {
  const model = WR_SOLVER.solve(data(), {});
  const ref = WR_EVAL.reference({ price: 100, qty: { au: 10000, key: 5000 } }, model);

  // 金幣每 1K 是 1.6 ~ 2，鑰匙每 1K 是 4.8（單一值）
  assert.ok(Math.abs(ref.valueLow - (10 * 1.6 + 5 * 4.8)) < 1e-9);
  assert.ok(Math.abs(ref.valueHigh - (10 * 2 + 5 * 4.8)) < 1e-9);
  assert.ok(Math.abs(ref.ratio - ref.value / 100) < 1e-12);
  assert.strictEqual(ref.coverage, 1);
  assert.strictEqual(ref.filled.length, 0);
});

/**
 * 資料卡沒有行情參考價。整包只算「有參考價的那幾項」會嚴重低估，
 * 那個數字比不給還糟 —— 所以用模型的點估計補上，並把補了多少寫出來。
 */
test('沒有行情參考價的物品用模型單價補上，並誠實回報補了多少', () => {
  const model = WR_SOLVER.solve(data(), {});
  model.prices.dc_titan = 90;

  const ref = WR_EVAL.reference({ price: 300, qty: { au: 10000, dc_titan: 2 } }, model);
  assert.ok(ref.coverage > 0 && ref.coverage < 1, `coverage 應該落在 0～1，實際 ${ref.coverage}`);
  assert.deepStrictEqual([...ref.filled.map((f) => f.id)], ['dc_titan']);
  // 補上的那一項在三個界都是同一個數字，所以區間寬度只來自真的有參考價的項目
  assert.ok(Math.abs((ref.valueHigh - ref.valueLow) - (10 * 2 - 10 * 1.6)) < 1e-9);
});

test('一項行情參考價都沒有的組合，就不給行情參考那一列', () => {
  const model = WR_SOLVER.solve(data(), {});
  assert.strictEqual(WR_EVAL.reference({ price: 300, qty: { dc_titan: 2 } }, model), null);
});

test('並排表格是「四種算法 + 行情參考」，而且只有最後一列是參考', () => {
  const variants = WR_COMPARE.build(data(), { priors: { au: TRUTH.au } });
  const model = WR_SOLVER.solve(data(), { priors: { au: TRUTH.au } });
  const rows = WR_COMPARE.rows({ price: 200, qty: { au: 20000, ag: 5000000 } }, variants, model);

  assert.deepStrictEqual([...rows.map((r) => r.key)], ['ls', 'robust', 'prior', 'bayes', 'ref']);
  assert.deepStrictEqual([...rows.map((r) => r.isRef)], [false, false, false, false, true]);

  // 每一列都要同時給得出預估價錢與性價比 —— 少一個這張表就沒有意義
  rows.forEach((r) => {
    assert.ok(r.value > 0, `${r.label} 少了預估價錢`);
    assert.ok(r.ratio > 0, `${r.label} 少了性價比`);
    assert.ok(r.tier && r.tier.label, `${r.label} 少了等第`);
    assert.ok(r.tip && r.blurb, `${r.label} 少了說明文字`);
  });
  // 只有行情參考那一列的預估價錢本身是區間
  assert.ok(rows[4].valueHigh > rows[4].valueLow);
  assert.strictEqual(rows[0].valueLow, null);
});

test('沒有售價時整張表不會爆炸，只是算不出指數', () => {
  const variants = WR_COMPARE.build(data(), {});
  const rows = WR_COMPARE.rows({ price: 0, qty: { au: 20000 } }, variants, variants[0].model);
  rows.forEach((r) => {
    assert.strictEqual(r.ratio, null, `${r.label} 沒有售價卻算出了指數`);
    assert.ok(r.value > 0, `${r.label} 應該還是有預估價錢`);
  });
});
