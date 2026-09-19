/**
 * 物品目錄：定義《War Robots》商城禮包內可能出現的所有物品。
 *
 * 這份檔案同時被三個執行環境載入，所以必須是「無相依、無模組系統」的純 JS：
 *   1. Apps Script（建置時接在 Code.gs 前面，試算表的欄位標題從這裡來）
 *   2. 瀏覽器前端（建置時包進 index.html）
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
   *
   * per = 計價單位。銀幣一枚值 0.0000022 元，這種數字人腦讀不動，
   * 所以看板改成「每 1M 2.2 元」。挑選原則是讓常見單價落在 1～10 元之間。
   *
   * 資料卡與升級代幣停在 1：它們一單位就值好幾十塊，而你不可能買半張卡，
   * 再縮下去只會變成「每 0.1 張」這種沒有意義的單位。
   *
   * per 純粹是顯示用的，推算引擎一律用「每 1 單位」的原始值。
   * 商城行情大幅變動時這些值可能需要重新校準。
   *
   * inputScale / inputUnit = 輸入時的單位。銀幣動輒上百萬，遊戲本身也是顯示
   * 「474.7 M」，要人在數字鍵盤上打 474700000 太荒謬，所以改成打 474.7 再乘回去。
   * 這純粹是輸入介面的事，存進去與算進去的一律是原始數量。
   *
   * common = 是否放在輸入介面的第一排。二十個物品全部攤開會變成一面牆，
   * 但實際上只有金卡以外的東西會天天用到 —— 金卡與泰坦太貴，多數人不會考慮，
   * 所以收進「更多」裡，需要時再展開。
   *
   * ref = 行情參考價 [下限, 上限]，單位跟 per 一樣（銀幣是「每 1M 多少元」）。
   *
   *   這是使用者自己給的市場行情，**完全不參與推算**：不是 priors、不進正則化、
   *   不影響任何一種算法解出來的單價。它只在畫面上多開一欄，讓人用自己心裡那把尺
   *   對照引擎算出來的數字。會刻意跟引擎隔開是因為兩者的性質完全不同 ——
   *   引擎的答案是你的禮包資料推出來的，行情參考價是你事先相信的，
   *   把後者混進前者就等於拿自己的猜測去驗證自己的猜測。
   *
   *   只有一個值的物品寫成上下限相同，畫面上就會顯示成單一數字而不是區間。
   *   資料卡沒有行情參考價 —— 它們的價值取決於開出什麼，本來就沒有公定行情。
   */
  var ITEMS = [
    { id: 'ag', name: '銀幣', abbr: 'Ag', group: 'currency', per: 1000000, common: true, ref: [0.85, 1],
      inputScale: 1000000, inputUnit: 'M', steps: [25000000, 50000000, 100000000, 150000000, 200000000, 260000000, 500000000] },
    { id: 'au', name: '金幣', abbr: 'Au', group: 'currency', per: 1000, common: true, ref: [1.6, 2], steps: [1000, 2000, 3000, 5000, 7500, 10000, 20000] },
    { id: 'pt', name: '白金', abbr: 'Pt', group: 'currency', per: 100, common: true, ref: [8.4, 10], steps: [500, 1000, 1500, 2000, 2500, 5000, 10000] },
    { id: 'key', name: '鑰匙', abbr: '鑰', group: 'currency', per: 1000, common: true, ref: [4.8, 4.8], steps: [5000, 7500, 10000, 20000, 25000, 30000, 50000] },

    { id: 'cell', name: '電池', abbr: '電', group: 'material', per: 1000, common: true, ref: [7.7, 7.7], steps: [100, 1000, 5000, 10000, 15000, 25000, 50000] },
    { id: 'module', name: '模塊', abbr: '模', group: 'material', per: 10, common: true, ref: [1.2, 1.2], steps: [100, 200, 500, 750, 1000, 1500, 2000] },
    { id: 'chip', name: '微晶片', abbr: '微', group: 'material', per: 10, common: true, ref: [2, 2], steps: [100, 200, 400, 800, 1600, 3200] },
    { id: 'pilotchip', name: '機師晶片', abbr: '機', group: 'material', per: 100, common: true, ref: [1, 1.5], steps: [1000, 2500, 5000, 7500, 10000, 12500] },
    { id: 'uptoken', name: '升級代幣', abbr: '代', group: 'material', per: 1, common: true, ref: [99, 99], steps: [1, 2, 3, 5, 7, 10] },

    { id: 'dc_basic_ag', name: '基礎銀', abbr: '基銀', group: 'datacard', per: 1, common: true, steps: [3, 5, 15, 25, 45, 55, 105] },
    { id: 'dc_basic_au', name: '基礎金', abbr: '基金', group: 'datacard', per: 1, steps: [1, 2, 3, 6, 10] },
    { id: 'dc_weapon_ag', name: '武器銀', abbr: '武銀', group: 'datacard', per: 1, common: true, steps: [5, 10, 15, 28, 50, 75, 125] },
    { id: 'dc_weapon_au', name: '武器金', abbr: '武金', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },
    { id: 'dc_bot_ag', name: '機器人銀', abbr: '機銀', group: 'datacard', per: 1, common: true, steps: [2, 5, 6, 10, 19, 25, 38] },
    { id: 'dc_bot_au', name: '機器人金', abbr: '機金', group: 'datacard', per: 1, steps: [1, 2, 3, 4, 8] },
    { id: 'dc_titan', name: '泰坦', abbr: '泰', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },
    { id: 'dc_newbot_ag', name: '新款機器人銀', abbr: '新銀', group: 'datacard', per: 1, steps: [1, 2, 5, 10, 15] },
    { id: 'dc_newbot_au', name: '新款機器人金', abbr: '新金', group: 'datacard', per: 1, steps: [1, 2, 3, 4, 8] },
    { id: 'dc_ultimate', name: '終極', abbr: '終', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },

    { id: 'misc', name: '其他物品', abbr: '其', group: 'other', per: 1, steps: [1, 2, 3, 5, 10] }
  ];

  /**
   * 售價快捷鍵。這串是從實際記錄的 96 筆禮包統計出來最常出現的價格，
   * 不是憑印象猜的 —— 商城的定價其實高度集中在這十幾個數字上。
   */
  var PRICE_STEPS = [66, 99, 130, 160, 170, 200, 230, 260, 270, 330, 500, 730, 1000, 1500];

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

  /* ---------- 計價單位 -------------------------------------------------
     推算引擎內部一律用「每 1 單位」的原始單價；下面這組函式只負責在畫面上
     把它換算成人讀得懂的計價單位。兩邊絕對不能混用，所以換算集中在這裡。
     -------------------------------------------------------------------- */

  function perOf(id) {
    var it = BY_ID[id];
    return it && it.per > 0 ? it.per : 1;
  }

  /** 計價單位的短標籤：1000000 → '1M'、1000 → '1K'、100 → '100'、1 → ''。 */
  function perLabel(id) {
    var per = perOf(id);
    if (per === 1) return '';
    if (per >= 1000000) return trimZeros(per / 1000000) + 'M';
    if (per >= 1000) return trimZeros(per / 1000) + 'K';
    return String(per);
  }

  /** 看板上單價後面那段文字，例如「元 / 1M」「元 / 張」。 */
  function priceUnitLabel(id) {
    var label = perLabel(id);
    if (label) return '元 / ' + label;
    var it = BY_ID[id];
    return '元 / ' + (it && it.group === 'datacard' ? '張' : '個');
  }

  /** 每 1 單位的原始單價 → 顯示用的計價單位單價。 */
  function toDisplayPrice(id, unitPrice) {
    if (unitPrice === null || unitPrice === undefined || !isFinite(unitPrice)) return null;
    return unitPrice * perOf(id);
  }

  /** 顯示用的計價單位單價 → 每 1 單位的原始單價。 */
  function toUnitPrice(id, displayPrice) {
    if (displayPrice === null || displayPrice === undefined || !isFinite(displayPrice)) return null;
    return displayPrice / perOf(id);
  }

  /** 直接把原始單價格式化成顯示字串（已換算過計價單位）。 */
  function formatDisplayPrice(id, unitPrice) {
    return formatUnitPrice(toDisplayPrice(id, unitPrice));
  }

  /* ---------- 行情參考價 -----------------------------------------------
     使用者自己給的市場行情，單位跟 per 相同。跟上面那組換算函式一樣，
     對外一律回傳「每 1 單位」的原始值，畫面要顯示時再自己換算回去 ——
     引擎與畫面之間只有一種單位約定，這裡不開例外。

     再強調一次：這組數字不進求解器。它沒有被寫進 priors，也沒有被寫進
     任何 solve() 的選項，唯一的用途是在畫面上多給一個對照欄。
     -------------------------------------------------------------------- */

  /** 行情參考價（計價單位）：{ low, high, mid, single } 或 null。 */
  function refOf(id) {
    var it = BY_ID[id];
    if (!it || !it.ref) return null;
    var lo = Number(it.ref[0]);
    var hi = Number(it.ref.length > 1 ? it.ref[1] : it.ref[0]);
    if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= 0) return null;
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    return { low: lo, high: hi, mid: (lo + hi) / 2, single: hi === lo };
  }

  /** 同上，但換算成引擎那邊的「每 1 單位」原始單價。 */
  function refUnitOf(id) {
    var r = refOf(id);
    if (!r) return null;
    var per = perOf(id);
    return { low: r.low / per, high: r.high / per, mid: r.mid / per, single: r.single };
  }

  function hasRef(id) {
    return refOf(id) !== null;
  }

  /**
   * 行情參考價的顯示字串：單一值寫成「4.8」，區間寫成「0.85 – 1」。
   *
   * 這裡刻意不用 formatUnitPrice 的輸出原樣 —— 它會把 1 寫成「1.00」、
   * 把 4.8 寫成「4.80」。解出來的單價那樣寫是對的（位數代表精度），
   * 但行情參考價是使用者自己寫下的整數字，補零只會讓人以為多了精度。
   */
  function formatRef(id) {
    var r = refOf(id);
    if (!r) return '';
    if (r.single) return refNumber(r.low);
    return refNumber(r.low) + ' – ' + refNumber(r.high);
  }

  function refNumber(v) {
    return formatUnitPrice(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  /** 有行情參考價的物品 id。 */
  function refItems() {
    return IDS.filter(hasRef);
  }

  /* ---------- 輸入單位 -------------------------------------------------
     跟 per 是兩回事：per 管的是「單價怎麼顯示」，這裡管的是「數量怎麼輸入」。
     -------------------------------------------------------------------- */

  function inputScaleOf(id) {
    var it = BY_ID[id];
    return it && it.inputScale > 0 ? it.inputScale : 1;
  }

  function inputUnitOf(id) {
    var it = BY_ID[id];
    return (it && it.inputUnit) || '';
  }

  /** 真實數量 → 輸入框裡該顯示的數字（例如 2500000 → '2.5'）。 */
  function toInputValue(id, qty) {
    var scale = inputScaleOf(id);
    if (!(qty > 0)) return '';
    if (scale === 1) return String(qty);
    var v = qty / scale;
    return String(Math.round(v * 1000) / 1000);
  }

  /** 輸入框裡的數字 → 真實數量。小數乘回去會有浮點雜訊，所以取整。 */
  function fromInputValue(id, text) {
    var raw = Number(text);
    if (!isFinite(raw) || raw <= 0) return 0;
    return Math.round(raw * inputScaleOf(id));
  }

  /** 常用物品：輸入介面預設只顯示這些，其餘收在「更多」裡。 */
  function commonItems() {
    return ITEMS.filter(function (it) { return it.common; });
  }

  function restItems() {
    return ITEMS.filter(function (it) { return !it.common; });
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
    inputScaleOf: inputScaleOf,
    inputUnitOf: inputUnitOf,
    toInputValue: toInputValue,
    fromInputValue: fromInputValue,
    commonItems: commonItems,
    restItems: restItems,
    perOf: perOf,
    perLabel: perLabel,
    priceUnitLabel: priceUnitLabel,
    toDisplayPrice: toDisplayPrice,
    toUnitPrice: toUnitPrice,
    formatDisplayPrice: formatDisplayPrice,
    refOf: refOf,
    refUnitOf: refUnitOf,
    hasRef: hasRef,
    formatRef: formatRef,
    refItems: refItems,
    formatQty: formatQty,
    formatUnitPrice: formatUnitPrice,
    formatMoney: formatMoney,
    groupDigits: groupDigits
  };
})();
