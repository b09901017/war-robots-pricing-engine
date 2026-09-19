'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_SOLVER } = loadLibs();

/** 金幣單獨出現，所以資料本身就能定出它的單價。 */
function soloBundles(n, truth) {
  const specs = [];
  for (let i = 0; i < n; i++) specs.push({ au: 1000 + i * 300 });
  return makeBundles(truth, specs);
}

/**
 * 共線：金幣與銀幣在每一包裡都是 1 : 1000。
 * 方程式只說得出「金幣單價 + 1000 × 銀幣單價 = 某數」，
 * 兩者怎麼分攤都是誤差 0 的合法解，最佳化本身挑不出來。
 */
function collinear(n) {
  const specs = [];
  for (let i = 0; i < n; i++) {
    const au = 1000 + i * 500;
    specs.push({ au, ag: au * 1000 });
  }
  return makeBundles({ au: 0.02, ag: 0.000004 }, specs);
}

test('沒有參考值時，共線的組合值仍然守得住', () => {
  const m = WR_SOLVER.solve(collinear(6), { bootstrap: false });
  const combined = m.prices.au + 1000 * m.prices.ag;
  assert.ok(Math.abs(combined - 0.024) / 0.024 < 0.05, `組合值跑掉了：${combined}`);
});

test('參考值只在共線時介入分攤，組合值不受影響', () => {
  const m = WR_SOLVER.solve(collinear(6), { bootstrap: false, priors: { au: 0.019 } });
  assert.ok(m.prices.au > 0 && m.prices.ag > 0, '兩者都不該被壓成 0');
  const combined = m.prices.au + 1000 * m.prices.ag;
  assert.ok(Math.abs(combined - 0.024) / 0.024 < 0.05, `組合值跑掉了：${combined}`);
  // 給了金幣的參考值之後，分攤結果應該比沒給時更靠近該值
  const bare = WR_SOLVER.solve(collinear(6), { bootstrap: false });
  assert.ok(Math.abs(m.prices.au - 0.019) < Math.abs(bare.prices.au - 0.019),
    '有參考值時應該更靠近參考值');
});

/**
 * 整個設計的重點：參考值是起點不是答案。
 * 拉力應該正好是 份量 / (觀測次數 + 份量)，所以筆數一多就自動失效。
 */
test('參考值的拉力等於 份量/(觀測次數+份量)，隨筆數遞減', () => {
  const truth = { au: 0.02 };
  const prior = 0.2;                 // 故意錯 10 倍
  const weight = 2;

  let prev = Infinity;
  for (const n of [2, 4, 8, 16, 32]) {
    const m = WR_SOLVER.solve(soloBundles(n, truth), {
      bootstrap: false, priors: { au: prior }, priorWeight: weight
    });
    const expected = truth.au + (weight / (n + weight)) * (prior - truth.au);
    const err = Math.abs(m.prices.au - expected) / expected;
    assert.ok(err < 0.05,
      `${n} 筆：預期被拉到 ${expected.toFixed(5)}，實際 ${m.prices.au.toFixed(5)}`);

    const off = Math.abs(m.prices.au - truth.au);
    assert.ok(off < prev, `${n} 筆時誤差沒有比上一階段小`);
    prev = off;
  }
});

test('參考值正確時，資料再多也不會被帶偏', () => {
  const truth = { au: 0.02 };
  for (const n of [2, 10, 40]) {
    const m = WR_SOLVER.solve(soloBundles(n, truth), { bootstrap: false, priors: { au: 0.02 } });
    assert.ok(Math.abs(m.prices.au - truth.au) / truth.au < 0.02,
      `${n} 筆時應該仍是 0.02，實際 ${m.prices.au}`);
  }
});

/**
 * 參考值不是免費的：資料本來就夠的時候，它會把答案往錯的方向拉一點，
 * 而且會透過物品之間的相關性波及到沒給參考值的物品。
 * 這裡釘住的是「這個代價會隨筆數縮小」，而不是「完全沒有代價」。
 */
test('參考值帶來的偏差會隨筆數縮小', () => {
  const truth = { au: 0.02, pt: 0.001, key: 0.002 };
  function build(n) {
    const specs = [];
    for (let i = 0; i < n; i++) {
      specs.push({
        au: 500 + i * 400,
        pt: i % 2 ? 20000 + i * 3000 : 0,
        key: i % 3 ? 5000 + i * 1200 : 0
      });
    }
    return makeBundles(truth, specs);
  }
  function errors(n) {
    const m = WR_SOLVER.solve(build(n), { bootstrap: false, priors: { au: 0.04, pt: 0.002 } });
    const out = {};
    for (const id of Object.keys(truth)) out[id] = Math.abs(m.prices[id] - truth[id]) / truth[id];
    return out;
  }
  const few = errors(10);
  const many = errors(120);
  for (const id of Object.keys(truth)) {
    assert.ok(many[id] < few[id],
      `${id}：120 筆的誤差 ${(many[id] * 100).toFixed(1)}% 沒有比 10 筆的 ${(few[id] * 100).toFixed(1)}% 小`);
  }
  assert.ok(many.au < 0.05, `120 筆時金幣仍差 ${(many.au * 100).toFixed(1)}%`);
});

test('完全不給參考值時，乾淨的資料應該幾乎完美還原', () => {
  const truth = { au: 0.02, pt: 0.001, key: 0.002 };
  const specs = [];
  for (let i = 0; i < 40; i++) {
    specs.push({ au: 500 + i * 400, pt: i % 2 ? 20000 + i * 3000 : 0, key: i % 3 ? 5000 + i * 1200 : 0 });
  }
  const m = WR_SOLVER.solve(makeBundles(truth, specs), { bootstrap: false });
  for (const id of Object.keys(truth)) {
    assert.ok(Math.abs(m.prices[id] - truth[id]) / truth[id] < 0.01,
      `${id} 應該幾乎完美，實際差 ${Math.abs(m.prices[id] - truth[id]) / truth[id]}`);
  }
});

test('會回報參考值把答案拉動了多少', () => {
  const m = WR_SOLVER.solve(collinear(6), { bootstrap: false, priors: { ag: 0.000022 } });
  const ag = m.items.find((it) => it.id === 'ag');
  assert.strictEqual(ag.prior, 0.000022);
  assert.ok(ag.dataOnlyPrice !== null, '要同時算出不用參考值的版本');
  assert.ok(ag.priorPull > 0, '共線情境下參考值應該有明顯影響');
  assert.strictEqual(m.priorCount, 1);
});

test('沒給參考值時不做多餘的第二次求解', () => {
  const m = WR_SOLVER.solve(collinear(6), { bootstrap: false });
  assert.strictEqual(m.priorCount, 0);
  for (const it of m.items) {
    assert.strictEqual(it.prior, null);
    assert.strictEqual(it.dataOnlyPrice, null);
    assert.strictEqual(it.priorPull, null);
  }
});

test('參考值不破壞非負性與擬合品質', () => {
  const m = WR_SOLVER.solve(collinear(8), { bootstrap: false, priors: { au: 0.019, ag: 0.000005 } });
  for (const id of Object.keys(m.prices)) {
    assert.ok(m.prices[id] >= 0, `${id} 解出負值`);
  }
  assert.ok(m.fit.mape < 0.05, `擬合誤差過大：${m.fit.mape}`);
});

test('參考值為 0 或負數視為沒給', () => {
  const m = WR_SOLVER.solve(collinear(6), { bootstrap: false, priors: { au: 0, ag: -1 } });
  assert.strictEqual(m.priorCount, 0);
});
