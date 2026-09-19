'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadLibs } = require('./helper');

const { WR_IMPORT } = loadLibs();

test('接受 {bundles:[...]} 與裸陣列兩種寫法', () => {
  const items = { 微晶片: 12800 };
  const a = WR_IMPORT.parse(JSON.stringify({ bundles: [{ name: 'A', price: 130, items }] }));
  const b = WR_IMPORT.parse(JSON.stringify([{ name: 'A', price: 130, items }]));
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(a.bundles.length, 1);
  assert.strictEqual(b.bundles.length, 1);
});

test('剝掉 AI 常加的 ```json 圍籬', () => {
  const res = WR_IMPORT.parse('```json\n{"bundles":[{"name":"A","price":99,"items":{"金幣":2500}}]}\n```');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.bundles[0].qty.au, 2500);
});

test('物品名稱可以用 id、中文名、看板標題或縮寫', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{
      price: 500,
      items: { au: 1000, 白金: 20000, '資料卡·泰坦': 2, 微: 3200 }
    }]
  }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.issues));
  assert.deepStrictEqual({ ...res.bundles[0].qty }, { au: 1000, pt: 20000, dc_titan: 2, chip: 3200 });
});

test('資料卡名稱少了分隔點也認得', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{ price: 300, items: { 資料卡泰坦: 1, '資料卡-終極': 2, '資料卡_武器金': 3 } }]
  }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.issues));
  assert.deepStrictEqual({ ...res.bundles[0].qty }, { dc_titan: 1, dc_ultimate: 2, dc_weapon_au: 3 });
});

test('認不得的物品是錯誤，不會被安靜丟掉', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{ name: '怪包', price: 200, items: { 金幣: 1000, 藍色齒輪: 8444 } }]
  }));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.bundles.length, 0, '有錯的那筆不該被匯入');
  assert.ok(res.issues.some((i) => i.level === 'error' && i.text.includes('藍色齒輪')));
  assert.deepStrictEqual([...res.unknownItems], ['藍色齒輪']);
});

test('有 unknown 的禮包會被記下來但預設不納入推算', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{
      name: 'Pascal 包', price: 230,
      items: { 金幣: 1000 },
      unknown: [{ 描述: 'Pascal 機器人', 數量: 1 }]
    }]
  }));
  assert.strictEqual(res.ok, true);
  const b = res.bundles[0];
  assert.strictEqual(b.enabled, false, '含未辨識內容的禮包不該進入計算');
  assert.ok(b.note.includes('Pascal 機器人'), '未辨識的東西要寫進備註');
  assert.ok(res.issues.some((i) => i.level === 'warn'));
});

test('unknown 也接受純字串', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{ price: 100, items: { 金幣: 500 }, unknown: ['金色三角形 3'] }]
  }));
  assert.strictEqual(res.bundles[0].enabled, false);
  assert.ok(res.bundles[0].note.includes('金色三角形'));
});

test('售價缺少、為零或負數都會被擋下', () => {
  for (const price of [undefined, 0, -50, 'abc']) {
    const res = WR_IMPORT.parse(JSON.stringify({ bundles: [{ price, items: { 金幣: 100 } }] }));
    assert.strictEqual(res.ok, false, `price=${price} 應該被擋下`);
    assert.strictEqual(res.bundles.length, 0);
  }
});

test('數量不是正數會被擋下', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{ price: 100, items: { 金幣: 0 } }]
  }));
  assert.strictEqual(res.ok, false);
});

test('完全沒有內容物的禮包會被擋下', () => {
  const res = WR_IMPORT.parse(JSON.stringify({ bundles: [{ price: 100, items: {} }] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues[0].text.includes('沒有任何內容物'));
});

test('整包都認不出來時仍然收下，但停用，當成待補的觀測', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [{ name: '金色三角形', price: 99, items: {}, unknown: [{ 描述: '金黃色三角形', 數量: 3 }] }]
  }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.issues));
  assert.strictEqual(res.bundles.length, 1);
  assert.strictEqual(res.bundles[0].enabled, false);
  assert.ok(res.bundles[0].note.includes('金黃色三角形'));
});

test('壞掉的 JSON 給出可讀的錯誤而不是丟例外', () => {
  const res = WR_IMPORT.parse('{"bundles": [');
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues[0].text.includes('JSON 格式有誤'));
});

test('最外層不是清單時給出明確提示', () => {
  const res = WR_IMPORT.parse('{"foo": 1}');
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues[0].text.includes('找不到禮包清單'));
});

test('錯誤訊息會指出是第幾筆', () => {
  const res = WR_IMPORT.parse(JSON.stringify({
    bundles: [
      { name: '好的', price: 100, items: { 金幣: 500 } },
      { name: '壞的', price: 100, items: { 不存在的東西: 5 } }
    ]
  }));
  assert.ok(res.issues.some((i) => i.text.includes('第 2 筆') && i.text.includes('壞的')));
});

test('只接受 YYYY-MM-DD 的日期，其他一律留空', () => {
  const mk = (date) => WR_IMPORT.parse(JSON.stringify({
    bundles: [{ price: 100, date, items: { 金幣: 100 } }]
  })).bundles[0].date;
  assert.strictEqual(mk('2026-09-19'), '2026-09-19');
  assert.strictEqual(mk('2026/9/19'), '');
  assert.strictEqual(mk('昨天'), '');
  assert.strictEqual(mk(undefined), '');
});

test('匯出再匯入得到相同的內容', () => {
  const original = [
    { name: '甲', price: 130, qty: { chip: 12800, au: 2500 }, date: '2026-09-01', note: '活動', enabled: true },
    { name: '乙', price: 990, qty: { dc_titan: 2, pt: 40000 }, date: '', note: '', enabled: false }
  ];
  const round = WR_IMPORT.parse(WR_IMPORT.serialize(original));
  assert.strictEqual(round.ok, true, JSON.stringify(round.issues));
  assert.strictEqual(round.bundles.length, 2);
  assert.deepStrictEqual({ ...round.bundles[0].qty }, { chip: 12800, au: 2500 });
  assert.deepStrictEqual({ ...round.bundles[1].qty }, { dc_titan: 2, pt: 40000 });
  assert.strictEqual(round.bundles[0].price, 130);
  assert.strictEqual(round.bundles[1].enabled, false, '停用狀態要保留');
  assert.strictEqual(round.bundles[0].date, '2026-09-01');
});

test('提示詞包含所有物品名稱與輸出格式', () => {
  const { WR_PROMPT, WR_CATALOG } = loadLibs();
  for (const id of WR_CATALOG.IDS) {
    if (id === 'misc') continue;
    assert.ok(WR_PROMPT.TEXT.includes(WR_CATALOG.labelOf(id)), `提示詞少了「${WR_CATALOG.labelOf(id)}」`);
  }
  assert.ok(WR_PROMPT.TEXT.includes('"bundles"'));
  assert.ok(WR_PROMPT.TEXT.includes('unknown'));
});
