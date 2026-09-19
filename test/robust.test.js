'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs, makeBundles } = require('./helper');

const { WR_SOLVER, WR_LINALG } = loadLibs();

/** 可重現的 ±3% 雜訊，模擬真實禮包定價不會剛好落在線性模型上。 */
const jitter = (i) => 1 + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.03;

const TRUTH = { au: 0.00558, ag: 0.0000022, key: 0.00484, cell: 0.0077 };
const SPECS = [
  { au: 20000, ag: 5000000 }, { au: 5000, key: 2000 }, { ag: 10000000, cell: 1500 },
  { au: 10000, cell: 800 }, { key: 5000, ag: 2000000 }, { au: 30000, key: 1000 },
  { cell: 3000, ag: 8000000 }, { au: 2000, ag: 1000000 }, { key: 8000, cell: 2000 },
  { au: 15000, ag: 4000000, key: 1500 }, { ag: 20000000 }, { au: 40000 }
];

function noisy() {
  return makeBundles(TRUTH, SPECS).map((b, i) => ({ ...b, price: b.price * jitter(i) }));
}

function avgError(model) {
  const errs = Object.keys(TRUTH).map((id) => Math.abs(model.prices[id] - TRUTH[id]) / TRUTH[id]);
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

/* ---------- 穩健回歸 ---------- */

test('少打一個 0 的禮包會被抓出來，而且不會把其他單價拉歪', () => {
  const data = noisy();
  data[2] = { ...data[2], price: data[2].price / 10, name: '打錯的那包' };

  const ls = WR_SOLVER.solve(data, { method: 'ls', bootstrap: false });
  const robust = WR_SOLVER.solve(data, { method: 'robust', bootstrap: false });

  // 最小平方會被一筆打錯的資料整個拉走
  assert.ok(avgError(ls) > 0.3, `最小平方應該被拉歪，實際平均誤差 ${(avgError(ls) * 100).toFixed(1)}%`);
  // 穩健回歸應該幾乎不受影響
  assert.ok(avgError(robust) < 0.05,
    `穩健回歸應該擋住，實際平均誤差 ${(avgError(robust) * 100).toFixed(1)}%`);

  const flagged = robust.downweighted.map((d) => d.name);
  assert.deepStrictEqual([...flagged], ['打錯的那包'],
    `應該只有打錯的那包被降權，實際 ${JSON.stringify(flagged)}`);
});

test('乾淨的資料不會有任何一筆被誤殺', () => {
  const model = WR_SOLVER.solve(noisy(), { method: 'robust', bootstrap: false });
  assert.strictEqual(model.downweighted.length, 0,
    `不該有降權，實際 ${JSON.stringify(model.downweighted.map((d) => d.name))}`);
  assert.ok(avgError(model) < 0.03, `乾淨資料應該解得準，實際 ${(avgError(model) * 100).toFixed(1)}%`);
});

/**
 * 這個案例釘住一個真的發生過的錯誤：
 * 「唯一單獨釘住某物品」的那一筆，拿掉它之後解本來就會動幾個百分點。
 * 在完全沒有雜訊的資料裡，那個偏離相對於其他列的 0.2% 看起來像離群值，
 * 早期版本因此把一筆完全正確的純銀幣包降權到 0，銀幣的解跟著偏掉 6.8%。
 */
test('唯一釘住某物品的那一筆禮包不會被當成離群值', () => {
  const truth = { ag: 0.000002, au: 0.02, dc_ultimate: 120 };
  const bundles = makeBundles(truth, [
    { ag: 1000000, au: 2500 }, { ag: 2500000, dc_ultimate: 1 }, { au: 10000, dc_ultimate: 2 },
    { ag: 500000, au: 1000, dc_ultimate: 1 }, { ag: 250000, au: 5000 }, { dc_ultimate: 3 },
    { ag: 1000000 },                       // ← 唯一一筆「銀幣單獨出現」
    { au: 20000, dc_ultimate: 1 }
  ]);
  const model = WR_SOLVER.solve(bundles, { method: 'robust', bootstrap: false });
  assert.strictEqual(model.downweighted.length, 0,
    `完美資料不該有任何降權，實際 ${JSON.stringify(model.downweighted)}`);
  assert.ok(Math.abs(model.prices.ag - truth.ag) / truth.ag < 0.02,
    `銀幣應解回 ${truth.ag}，實際 ${model.prices.ag}`);
});

test('促銷包被降權，但紀錄與預測都完整保留', () => {
  const data = noisy();
  data[5] = { ...data[5], price: data[5].price * 0.35, name: '超級促銷' };
  const model = WR_SOLVER.solve(data, { method: 'robust', bootstrap: false });

  const row = model.fit.predictions.filter((p) => p.name === '超級促銷')[0];
  assert.ok(row, '促銷包仍然要出現在擬合診斷裡');
  assert.ok(row.weight < 0.6, `促銷包應該被降權，實際權重 ${row.weight}`);
  assert.ok(row.ratio > 1.5, `促銷包的性價比應該明顯高於 1，實際 ${row.ratio}`);
  assert.ok(avgError(model) < 0.06, `其他單價不該被促銷拉走，實際 ${(avgError(model) * 100).toFixed(1)}%`);
});

/* ---------- 單品支配 ---------- */

test('比較貴的同物品單品包不納入計算，基準價落在最便宜的那一筆', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '白金 1000', price: 100, qty: { pt: 1000 } },
    { id: 'b', name: '白金 1500', price: 130, qty: { pt: 1500 } },
    { id: 'c', name: '白金 500 + 金幣', price: 90, qty: { pt: 500, au: 5000 } }
  ], { bootstrap: false });

  assert.strictEqual(model.excludedCount, 1);
  const ex = model.excluded[0];
  assert.strictEqual(ex.name, '白金 1000');
  assert.strictEqual(ex.bestName, '白金 1500');
  // 1500 包是 0.0867/單位，1000 包是 0.1/單位
  assert.ok(Math.abs(model.prices.pt - 130 / 1500) / (130 / 1500) < 0.05,
    `白金應該貼近最便宜的那筆 0.0867，實際 ${model.prices.pt}`);
});

test('組合包不會被單品支配規則排除', () => {
  // 組合包的單價沒有被直接觀測到，不能拿來互相比較
  const model = WR_SOLVER.solve([
    { id: 'a', name: '便宜組合', price: 100, qty: { pt: 1000, au: 1000 } },
    { id: 'b', name: '貴組合', price: 300, qty: { pt: 1000, au: 1000 } }
  ], { bootstrap: false });
  assert.strictEqual(model.excludedCount, 0);
});

test('只差一點點的兩個報價都留著，不算被壓過', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '卡 ×1', price: 99, qty: { dc_basic_au: 1 } },
    { id: 'b', name: '卡 ×3', price: 300, qty: { dc_basic_au: 3 } }   // 100 vs 99，差 1%
  ], { bootstrap: false });
  assert.strictEqual(model.excludedCount, 0, '差 1% 是湊整數，不該排除');
});

test('被排除的禮包仍然出現在擬合診斷裡並標明原因', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '白金 1000', price: 100, qty: { pt: 1000 } },
    { id: 'b', name: '白金 1500', price: 130, qty: { pt: 1500 } }
  ], { bootstrap: false });
  const row = model.fit.predictions.filter((p) => p.excluded)[0];
  assert.ok(row, '被排除的禮包要看得到');
  assert.strictEqual(row.excludedBy, '白金 1500');
});

/* ---------- 自由度 ---------- */

test('未知數跟方程式一樣多時，不會假裝擬合誤差是好消息', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '銀', price: 100, qty: { ag: 50000000 } },
    { id: 'b', name: '金', price: 100, qty: { au: 18000 } }
  ], { bootstrap: false });

  assert.strictEqual(model.fit.dof, 0);
  assert.strictEqual(model.fit.meaningful, false);
  assert.ok(model.warnings.some((w) => w.code === 'no-dof'), '應該要有自由度不足的警告');
});

test('資料夠多時自由度為正，擬合誤差才算數', () => {
  const model = WR_SOLVER.solve(noisy(), { bootstrap: false });
  assert.strictEqual(model.fit.dof, 12 - 4);
  assert.strictEqual(model.fit.meaningful, true);
  assert.ok(!model.warnings.some((w) => w.code === 'no-dof'));
});

/* ---------- 完整貝氏 ---------- */

test('後驗平均在資料充足時跟最小平方幾乎一致', () => {
  const data = noisy();
  const ls = WR_SOLVER.solve(data, { method: 'ls', bootstrap: false });
  const bayes = WR_SOLVER.solve(data, { method: 'bayes' });
  for (const id of Object.keys(TRUTH)) {
    const rel = Math.abs(bayes.prices[id] - ls.prices[id]) / ls.prices[id];
    assert.ok(rel < 0.15, `${id}: 後驗平均 ${bayes.prices[id]} 不該偏離最小平方 ${ls.prices[id]} 太多（${(rel * 100).toFixed(1)}%）`);
  }
});

/**
 * 這是完整貝氏存在的唯一理由。
 *
 * 金幣與銀幣永遠綁在一起賣時，資料在數學上分不出誰值多少。bootstrap 在這種
 * 情況下每一次重抽都收斂到同一個最小範數解，於是區間很窄 —— 那個穩定是假的，
 * 它只是穩定在一個任意的答案上。後驗會沿著那個分不出來的方向大幅擺盪，
 * 誠實地給出很寬的區間。
 */
test('共線時，後驗區間誠實地變寬，bootstrap 卻會給出假的窄區間', () => {
  const bundles = [];
  for (let i = 0; i < 30; i++) {
    const k = 1 + i * 0.1;
    bundles.push({
      id: 'c' + i, name: '綁定包' + i,
      price: (20000 * k * TRUTH.au + 5000000 * k * TRUTH.ag) * jitter(i),
      qty: { au: 20000 * k, ag: 5000000 * k }
    });
  }
  const boot = WR_SOLVER.solve(bundles, { method: 'robust', samples: 300 });
  const post = WR_SOLVER.solve(bundles, { method: 'bayes', samples: 300 });

  const width = (m) => {
    const it = m.items.filter((x) => x.id === 'au')[0];
    return (it.high - it.low) / it.price;
  };
  assert.strictEqual(boot.draws.source, 'bootstrap');
  assert.strictEqual(post.draws.source, 'posterior');
  assert.ok(width(boot) < 0.1, `bootstrap 在共線下會給出假的窄區間，實際寬度 ${(width(boot) * 100).toFixed(0)}%`);
  assert.ok(width(post) > 0.25,
    `後驗區間應該誠實地寬，實際寬度 ${(width(post) * 100).toFixed(0)}%`);
});

test('完美吻合的資料不會讓後驗宣稱無限精確', () => {
  // σ 有下限，所以區間不會塌成一個點
  const bundles = makeBundles(TRUTH, SPECS);
  const post = WR_SOLVER.solve(bundles, { method: 'bayes', samples: 200 });
  const it = post.items.filter((x) => x.id === 'au')[0];
  assert.ok(it.high > it.low, '區間不該塌成一個點');
  assert.ok(isFinite(it.low) && it.low >= 0, '區間下界要是有限的非負數');
});

/* ---------- 抽樣工具 ---------- */

test('截斷常態抽樣永遠不會回傳負數', () => {
  const rand = WR_LINALG.rng(7);
  for (const mu of [-5, -1, 0, 1, 5]) {
    for (let i = 0; i < 200; i++) {
      const v = WR_LINALG.truncatedNormalPositive(mu, 1, rand);
      assert.ok(v >= 0 && isFinite(v), `mu=${mu} 抽出 ${v}`);
    }
  }
});

test('Gamma 抽樣的平均值接近形狀參數', () => {
  const rand = WR_LINALG.rng(11);
  for (const shape of [2, 10, 50]) {
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += WR_LINALG.gamma(shape, rand);
    const mean = sum / n;
    assert.ok(Math.abs(mean - shape) / shape < 0.08,
      `shape=${shape} 的平均應接近 ${shape}，實際 ${mean.toFixed(2)}`);
  }
});

test('中位數處理奇數與偶數長度', () => {
  assert.strictEqual(WR_LINALG.median([3, 1, 2]), 2);
  assert.strictEqual(WR_LINALG.median([4, 1, 3, 2]), 2.5);
});

test('反矩陣乘回原矩陣是單位矩陣', () => {
  const G = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
  const inv = WR_LINALG.inverseSPD(G);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += G[i][k] * inv[k][j];
      assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-10, `(${i},${j}) = ${s}`);
    }
  }
});

/* ---------- 資料健檢：抓可能打錯的那幾筆 ---------- */

test('每單位價格遠高於同物品其他筆的，會被標成可疑', () => {
  // 武器銀卡每張穩定在 6.6 元，其中一筆卻是 14.14 —— 同一批資料裡還有
  // 一筆同樣賣 99 元但寫 15 張的，所以「7 張」幾乎確定是數量少看了一位。
  const model = WR_SOLVER.solve([
    { id: 'a', name: '武器銀 5', price: 33, qty: { dc_weapon_ag: 5 } },
    { id: 'b', name: '武器銀 10', price: 66, qty: { dc_weapon_ag: 10 } },
    { id: 'c', name: '武器銀 15', price: 99, qty: { dc_weapon_ag: 15 } },
    { id: 'd', name: '武器銀 50', price: 330, qty: { dc_weapon_ag: 50 } },
    { id: 'e', name: '武器銀 7', price: 99, qty: { dc_weapon_ag: 7 } }
  ], { bootstrap: false });

  assert.strictEqual(model.suspects.length, 1);
  assert.strictEqual(model.suspects[0].name, '武器銀 7');
  assert.ok(model.suspects[0].ratio > 2, `應該是中位數的兩倍以上，實際 ${model.suspects[0].ratio}`);
  assert.ok(model.warnings.some((w) => w.code === 'suspect-entry'));
});

test('價格一致的資料不會被誤報', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '武器銀 5', price: 33, qty: { dc_weapon_ag: 5 } },
    { id: 'b', name: '武器銀 10', price: 66, qty: { dc_weapon_ag: 10 } },
    { id: 'c', name: '武器銀 15', price: 99, qty: { dc_weapon_ag: 15 } },
    { id: 'd', name: '武器銀 50', price: 330, qty: { dc_weapon_ag: 50 } }
  ], { bootstrap: false });
  assert.strictEqual(model.suspects.length, 0);
});

test('只有兩筆時不做判斷 —— 無從得知誰才是對的', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '卡 10', price: 66, qty: { dc_weapon_ag: 10 } },
    { id: 'b', name: '卡 1', price: 66, qty: { dc_weapon_ag: 1 } }
  ], { bootstrap: false });
  assert.strictEqual(model.suspects.length, 0);
});

test('組合包不參與健檢 —— 它的每單位價格沒有被直接觀測到', () => {
  const model = WR_SOLVER.solve([
    { id: 'a', name: '卡 5', price: 33, qty: { dc_weapon_ag: 5 } },
    { id: 'b', name: '卡 10', price: 66, qty: { dc_weapon_ag: 10 } },
    { id: 'c', name: '卡 15', price: 99, qty: { dc_weapon_ag: 15 } },
    { id: 'd', name: '卡 1 + 電池', price: 500, qty: { dc_weapon_ag: 1, cell: 100 } }
  ], { bootstrap: false });
  assert.strictEqual(model.suspects.length, 0);
});
