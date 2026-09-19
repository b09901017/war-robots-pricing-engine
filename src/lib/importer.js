/**
 * JSON 批次匯入。
 *
 * 用途：截圖 → 丟給任何一個看得懂圖的 AI → 產出 JSON → 貼回這裡一次新增多筆。
 * 提示詞在 lib/prompt.js。
 *
 * 設計原則是「寧可擋下來，不要猜」：
 * 任何一個認不出來的物品名稱都會變成明確的錯誤訊息並指出是第幾筆，
 * 而不是安靜地被丟掉 —— 少算一項物品會讓那一包的售價無端多出來一截，
 * 然後整個模型跟著歪掉，而且完全看不出來哪裡錯了。
 */
var WR_IMPORT = (function () {
  'use strict';

  /** 物品名稱的解析表：id、看板標題、純名稱、以及常見的手寫變體都認。 */
  function resolver() {
    var map = {};
    function add(key, id) {
      if (key) map[normalize(key)] = id;
    }
    for (var i = 0; i < WR_CATALOG.IDS.length; i++) {
      var id = WR_CATALOG.IDS[i];
      var item = WR_CATALOG.get(id);
      add(id, id);
      add(item.name, id);
      add(WR_CATALOG.labelOf(id), id);
      add(item.abbr, id);
      if (item.group === 'datacard') {
        add('資料卡' + item.name, id);
        add('資料卡-' + item.name, id);
        add('資料卡_' + item.name, id);
      }
    }
    return map;
  }

  function normalize(s) {
    return String(s).trim().toLowerCase()
      .replace(/[\s·・.。\-_/]/g, '')
      .replace(/[（）()]/g, '');
  }

  /**
   * @param {string} text 使用者貼上的 JSON
   * @returns {{ok: boolean, bundles: Array, issues: Array, unknownItems: Array}}
   */
  function parse(text) {
    var issues = [];
    var raw;

    try {
      raw = JSON.parse(stripFences(text));
    } catch (e) {
      return {
        ok: false, bundles: [], unknownItems: [],
        issues: [{ level: 'error', text: 'JSON 格式有誤：' + e.message + '。請確認整段都複製到了，開頭是 { 或 [。' }]
      };
    }

    var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.bundles) ? raw.bundles : null);
    if (!list) {
      return {
        ok: false, bundles: [], unknownItems: [],
        issues: [{ level: 'error', text: '找不到禮包清單。最外層應該是一個陣列，或是 {"bundles": [...]}。' }]
      };
    }
    if (list.length === 0) {
      return { ok: false, bundles: [], unknownItems: [], issues: [{ level: 'error', text: '清單是空的，沒有東西可以匯入。' }] };
    }

    var map = resolver();
    var bundles = [];
    var unknownItems = {};

    for (var i = 0; i < list.length; i++) {
      var entry = list[i] || {};
      var where = '第 ' + (i + 1) + ' 筆' + (entry.name ? '（' + entry.name + '）' : '');

      var price = Number(entry.price);
      if (!isFinite(price) || price <= 0) {
        issues.push({ level: 'error', index: i, text: where + '：售價缺少或不是正數。' });
        continue;
      }

      var source = entry.items || entry.qty || {};
      var qty = {};
      var bad = false;
      var count = 0;

      for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        var id = map[normalize(key)];
        if (!id) {
          unknownItems[key] = true;
          issues.push({ level: 'error', index: i, text: where + '：認不得物品「' + key + '」。' });
          bad = true;
          continue;
        }
        var v = Number(source[key]);
        if (!isFinite(v) || v <= 0) {
          issues.push({ level: 'error', index: i, text: where + '：「' + key + '」的數量不是正數。' });
          bad = true;
          continue;
        }
        qty[id] = (qty[id] || 0) + v;
        count++;
      }

      if (bad) continue;

      // 辨識時有認不出來的東西 → 記下來但不納入推算，
      // 因為少算的那一項會讓售價憑空多出一截，把單價整個拉歪。
      var unknown = Array.isArray(entry.unknown) ? entry.unknown : [];

      // 整包都認不出來也照樣收下：這是一筆「先存著」的觀測，
      // 等圖示確認之後補上物品就能用，總比當場丟掉好。反正它是停用的，不影響推算。
      if (!count && !unknown.length) {
        issues.push({ level: 'error', index: i, text: where + '：沒有任何內容物。' });
        continue;
      }

      var note = String(entry.note || '').trim();
      if (unknown.length) {
        var described = unknown.map(describeUnknown).join('、');
        note = note ? note + '；未辨識：' + described : '未辨識：' + described;
        issues.push({
          level: 'warn', index: i,
          text: where + '：還有認不出來的內容（' + described + '），這筆會先設成「不納入推算」。'
        });
      }

      bundles.push({
        name: String(entry.name || '').trim(),
        price: price,
        date: normalizeDate(entry.date),
        qty: qty,
        note: note,
        enabled: unknown.length ? false : (entry.enabled !== false)
      });
    }

    return {
      ok: bundles.length > 0 && !issues.some(function (x) { return x.level === 'error'; }),
      bundles: bundles,
      unknownItems: Object.keys(unknownItems),
      issues: issues
    };
  }

  function describeUnknown(u) {
    if (typeof u === 'string') return u;
    if (!u || typeof u !== 'object') return String(u);
    var label = u.描述 || u.desc || u.icon || u.name || '不明物品';
    var n = u.數量 !== undefined ? u.數量 : u.qty;
    return n === undefined || n === null ? String(label) : label + ' ' + n;
  }

  /** AI 常常把 JSON 包在 ```json ... ``` 裡，直接幫忙剝掉。 */
  function stripFences(text) {
    var t = String(text || '').trim();
    var fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fence) return fence[1];
    return t;
  }

  function normalizeDate(v) {
    if (!v) return '';
    var s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  /** 匯出目前的禮包，格式跟匯入完全相同，可以直接貼回來。 */
  function serialize(bundles) {
    return JSON.stringify({
      bundles: bundles.map(function (b) {
        var items = {};
        WR_CATALOG.IDS.forEach(function (id) {
          if (b.qty && b.qty[id] > 0) items[WR_CATALOG.labelOf(id)] = b.qty[id];
        });
        var out = { name: b.name || '', price: b.price, items: items };
        if (b.date) out.date = b.date;
        if (b.note) out.note = b.note;
        if (b.enabled === false) out.enabled = false;
        return out;
      })
    }, null, 2);
  }

  return { parse: parse, serialize: serialize };
})();
