/**
 * 物品目錄：定義《War Robots》商城禮包內可能出現的所有物品。
 *
 * 這份檔案同時被三個執行環境載入，所以必須是「無相依、無模組系統」的純 JS：
 *   1. Apps Script 伺服器端（複製成 lib_catalog.gs）
 *   2. 瀏覽器前端（包成 <script> 塞進 HTML）
 *   3. node 測試（用 vm 在同一個 context 裡依序執行）
 */
var WR_CATALOG = (function () {
  'use strict';

  var GROUPS = [
    { id: 'currency', name: '貨幣', hint: '可直接花用的資源' },
    { id: 'material', name: '強化材料', hint: '升級與改造用的消耗品' },
    { id: 'datacard', name: '資料卡', hint: '開出機器人、武器與泰坦' },
    { id: 'other', name: '其他', hint: '不在上面分類的東西' }
  ];

  /**
   * steps = 數字鍵盤上方的「常用值」快捷鍵，依照商城常見的發放量挑選。
   * 只是輸入捷徑，任何數字都可以用鍵盤自己打。
   */
  var ITEMS = [
    { id: 'ag', name: '銀幣', abbr: 'Ag', group: 'currency', steps: [100000, 250000, 500000, 1000000, 2500000] },
    { id: 'au', name: '金幣', abbr: 'Au', group: 'currency', steps: [250, 500, 1000, 2500, 5000, 10000, 20000] },
    { id: 'pt', name: '白金', abbr: 'Pt', group: 'currency', steps: [10000, 25000, 50000, 100000, 250000] },
    { id: 'key', name: '鑰匙', abbr: '鑰', group: 'currency', steps: [5000, 10000, 25000, 50000, 100000] },

    { id: 'cell', name: '電池', abbr: '電', group: 'material', steps: [50, 100, 250, 500, 1000] },
    { id: 'module', name: '模塊', abbr: '模', group: 'material', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'chip', name: '微晶片', abbr: '微', group: 'material', steps: [1000, 3200, 6400, 12800, 25600] },
    { id: 'pilotchip', name: '機師晶片', abbr: '機', group: 'material', steps: [500, 1000, 2500, 5000, 10000] },
    { id: 'uptoken', name: '升級代幣', abbr: '代', group: 'material', steps: [100, 250, 500, 1000, 2500] },

    { id: 'dc_basic_ag', name: '基礎銀', abbr: '基銀', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_basic_au', name: '基礎金', abbr: '基金', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_weapon_ag', name: '武器銀', abbr: '武銀', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_weapon_au', name: '武器金', abbr: '武金', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_bot_ag', name: '機器人銀', abbr: '機銀', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_bot_au', name: '機器人金', abbr: '機金', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_titan', name: '泰坦', abbr: '泰', group: 'datacard', steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_newbot_ag', name: '新款機器人銀', abbr: '新銀', group: 'datacard', steps: [1, 2, 3, 5, 10] },
    { id: 'dc_newbot_au', name: '新款機器人金', abbr: '新金', group: 'datacard', steps: [1, 2, 3, 5, 10] },
    { id: 'dc_ultimate', name: '終極', abbr: '終', group: 'datacard', steps: [1, 2, 3, 5, 10] },

    { id: 'misc', name: '其他物品', abbr: '其', group: 'other', steps: [1, 2, 3, 5, 10] }
  ];

  var PRICE_STEPS = [30, 90, 170, 330, 490, 790, 990, 1590, 1990, 2990, 3290];

  var BY_ID = {};
  for (var i = 0; i < ITEMS.length; i++) BY_ID[ITEMS[i].id] = ITEMS[i];

  var IDS = ITEMS.map(function (it) { return it.id; });

  function get(id) {
    return BY_ID[id] || null;
  }

  function nameOf(id) {
    var it = BY_ID[id];
    return it ? it.name : id;
  }

  /** 看板與試算表的欄位標題：資料卡加上分類前綴，避免「泰坦」這種名字看起來像獨立物品。 */
  function labelOf(id) {
    var it = BY_ID[id];
    if (!it) return id;
    return it.group === 'datacard' ? '資料卡·' + it.name : it.name;
  }

  function groups() {
    return GROUPS.map(function (g) {
      return {
        id: g.id,
        name: g.name,
        hint: g.hint,
        items: ITEMS.filter(function (it) { return it.group === g.id; })
      };
    });
  }

  /** 數量顯示：大數字縮寫成 2.5M / 12.8K，讓卡片在手機上不會被撐爆。 */
  function formatQty(n) {
    if (!isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1000000) return trimZeros(n / 1000000) + 'M';
    if (abs >= 10000) return trimZeros(n / 1000) + 'K';
    return groupDigits(Math.round(n * 100) / 100);
  }

  /**
   * 單價顯示：不同物品的單價差了六個數量級（銀幣約 0.000002 元，終極資料卡可能上百元），
   * 所以位數要跟著數值大小走，不能固定小數點。
   */
  function formatUnitPrice(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (v === 0) return '0';
    var abs = Math.abs(v);
    if (abs >= 100) return groupDigits(Math.round(v));
    if (abs >= 10) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    // 銀幣單價大約是 0.000002 元/枚，科學記號在看板上很難讀，
    // 所以小數一律用三位有效數字的一般寫法撐到 1e-7 才放棄。
    var s = v.toPrecision(3);
    if (s.indexOf('e') >= 0) return v.toExponential(2);
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function formatMoney(v) {
    if (!isFinite(v)) return '—';
    var abs = Math.abs(v);
    if (abs >= 100) return groupDigits(Math.round(v));
    if (abs >= 1) return trimZeros(Math.round(v * 10) / 10);
    return trimZeros(Math.round(v * 100) / 100);
  }

  function groupDigits(n) {
    var parts = String(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function trimZeros(n) {
    var s = n.toFixed(2).replace(/\.?0+$/, '');
    return groupDigits(s === '' || s === '-' ? '0' : s);
  }

  return {
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    IDS: IDS,
    PRICE_STEPS: PRICE_STEPS,
    get: get,
    nameOf: nameOf,
    labelOf: labelOf,
    groups: groups,
    formatQty: formatQty,
    formatUnitPrice: formatUnitPrice,
    formatMoney: formatMoney,
    groupDigits: groupDigits
  };
})();
