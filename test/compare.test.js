'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_COMPARE, WR_CATALOG } = loadLibs();

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
