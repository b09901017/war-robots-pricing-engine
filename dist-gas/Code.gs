/* 由 tools/build.js 產生，請不要直接編輯這個檔案。
 * 原始碼在 src/gas/Code.gs 與 src/lib/catalog.js。
 */

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
   */
  var ITEMS = [
    { id: 'ag', name: '銀幣', abbr: 'Ag', group: 'currency', per: 1000000, common: true,
      inputScale: 1000000, inputUnit: 'M', steps: [250000, 500000, 1000000, 2500000, 5000000, 10000000, 20000000] },
    { id: 'au', name: '金幣', abbr: 'Au', group: 'currency', per: 1000, common: true, steps: [250, 500, 1000, 2500, 5000, 10000, 20000] },
    { id: 'pt', name: '白金', abbr: 'Pt', group: 'currency', per: 1000, common: true, steps: [10000, 25000, 50000, 100000, 250000] },
    { id: 'key', name: '鑰匙', abbr: '鑰', group: 'currency', per: 1000, common: true, steps: [5000, 10000, 25000, 50000, 100000] },

    { id: 'cell', name: '電池', abbr: '電', group: 'material', per: 1000, common: true, steps: [50, 100, 250, 500, 1000] },
    { id: 'module', name: '模塊', abbr: '模', group: 'material', per: 10, common: true, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'chip', name: '微晶片', abbr: '微', group: 'material', per: 1000, common: true, steps: [1000, 3200, 6400, 12800, 25600] },
    { id: 'pilotchip', name: '機師晶片', abbr: '機', group: 'material', per: 100, common: true, steps: [500, 1000, 2500, 5000, 10000] },
    { id: 'uptoken', name: '升級代幣', abbr: '代', group: 'material', per: 1, common: true, steps: [100, 250, 500, 1000, 2500] },

    { id: 'dc_basic_ag', name: '基礎銀', abbr: '基銀', group: 'datacard', per: 1, common: true, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_basic_au', name: '基礎金', abbr: '基金', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_weapon_ag', name: '武器銀', abbr: '武銀', group: 'datacard', per: 1, common: true, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_weapon_au', name: '武器金', abbr: '武金', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_bot_ag', name: '機器人銀', abbr: '機銀', group: 'datacard', per: 1, common: true, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_bot_au', name: '機器人金', abbr: '機金', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_titan', name: '泰坦', abbr: '泰', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10, 20] },
    { id: 'dc_newbot_ag', name: '新款機器人銀', abbr: '新銀', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },
    { id: 'dc_newbot_au', name: '新款機器人金', abbr: '新金', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },
    { id: 'dc_ultimate', name: '終極', abbr: '終', group: 'datacard', per: 1, steps: [1, 2, 3, 5, 10] },

    { id: 'misc', name: '其他物品', abbr: '其', group: 'other', per: 1, steps: [1, 2, 3, 5, 10] }
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
    formatQty: formatQty,
    formatUnitPrice: formatUnitPrice,
    formatMoney: formatMoney,
    groupDigits: groupDigits
  };
})();


/* ============================================================================
 *  War Robots 禮包比價 —— Google Apps Script 資料層
 *
 *  這個檔案只做一件事：把 Google 試算表變成一個網站可以讀寫的 API。
 *  所有介面與演算法都在網站那邊，所以這個檔案貼一次之後幾乎不用再動。
 *
 *  安裝步驟見 README。只要改下面 CONFIG 這兩行。
 * ========================================================================= */

var CONFIG = {
  /** 你自己想一組密碼，越長越好。沒有這組密碼的人即使拿到網址也讀不到資料。 */
  TOKEN: '換成你自己的密碼',

  /** 試算表網址中間那一長串。例如
   *  https://docs.google.com/spreadsheets/d/【就是這一段】/edit  */
  SHEET_ID: '換成你的試算表 ID'
};

/* -------------------------------------------------------------------------
 *  路由
 * ---------------------------------------------------------------------- */

/**
 * 網站一律用 POST，而且 Content-Type 刻意送 text/plain。
 * 送 application/json 會觸發瀏覽器的 CORS 預檢（OPTIONS），
 * 而 Apps Script 不處理 OPTIONS，請求就會直接失敗。
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    return json(handle(body));
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** 瀏覽器直接開這個網址時，回一個連線測試結果，方便確認有沒有裝好。 */
function doGet(e) {
  var token = e && e.parameter ? e.parameter.token : '';
  if (!tokenOk(token)) {
    return json({ ok: false, error: '密碼不正確，或還沒在 Code.gs 裡設定 CONFIG.TOKEN。' });
  }
  return json({ ok: true, data: { message: '連線正常', sheet: spreadsheet().getName() } });
}

function handle(body) {
  if (!tokenOk(body.token)) return { ok: false, error: '密碼不正確。' };

  var p = body.payload;
  switch (body.action) {
    case 'ping':           return ok({ sheet: spreadsheet().getName(), url: spreadsheet().getUrl() });
    case 'init':           return ok(ensureSchema());
    case 'load':           return ok(loadAll());
    case 'saveBundle':     saveBundle(p); return ok({ bundles: readBundles() });
    case 'saveBundles':    saveBundles(p); return ok({ bundles: readBundles() });
    case 'deleteBundle':   deleteBundle(p); return ok({ bundles: readBundles() });
    case 'savePriors':     savePriors(p); return ok({});
    case 'saveSettings':   saveSettings(p); return ok({});
    case 'syncBoard':      return ok({ written: writeBoard(p) });
    case 'logEvaluation':  appendEvaluation(p); return ok({});
    default:               return { ok: false, error: '不認識的指令：' + body.action };
  }
}

function ok(data) { return { ok: true, data: data }; }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 比對時間固定，不因為前幾個字元對了就比較慢，避免被一個字一個字試出來。 */
function tokenOk(token) {
  var expected = String(CONFIG.TOKEN || '');
  var given = String(token || '');
  if (expected.length === 0 || expected === '換成你自己的密碼') return false;
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------
 *  試算表
 * ---------------------------------------------------------------------- */

var SHEETS = { bundles: '禮包', board: '單價看板', settings: '設定', evaluations: '試算紀錄' };
var BUNDLE_FIXED = ['ID', '名稱', '售價(TWD)', '日期', '啟用'];
var BOARD_HEADERS = ['物品', '計價單位', '基準單價', '區間下界', '區間上界', '信心度', '出現包數', '總數量', '價值占比', '參考單價'];
var EVAL_HEADERS = ['時間', '名稱', '售價(TWD)', '理論價值', '性價比指數', '評價', '內容'];

function spreadsheet() {
  var id = String(CONFIG.SHEET_ID || '').trim();
  if (!id || id === '換成你的試算表 ID') {
    throw new Error('還沒在 Code.gs 裡設定 CONFIG.SHEET_ID。');
  }
  return SpreadsheetApp.openById(id);
}

function sheet(name) {
  var ss = spreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 禮包表的欄位：固定欄 + 每個物品一欄 + 備註。 */
function bundleHeaders() {
  var headers = BUNDLE_FIXED.slice();
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) headers.push(WR_CATALOG.labelOf(WR_CATALOG.IDS[i]));
  headers.push('備註');
  return headers;
}

/** 建立或補齊所有工作表。重複執行是安全的。 */
function ensureSchema() {
  var ss = spreadsheet();
  ensureHeaders(sheet(SHEETS.bundles), bundleHeaders());
  ensureHeaders(sheet(SHEETS.board), BOARD_HEADERS);
  ensureHeaders(sheet(SHEETS.evaluations), EVAL_HEADERS);

  ensureSettingRows(sheet(SHEETS.settings));

  var b = sheet(SHEETS.bundles);
  b.setFrozenRows(1);
  b.setFrozenColumns(2);
  return { sheet: ss.getName(), url: ss.getUrl() };
}

function ensureHeaders(sh, headers) {
  var current = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (current.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  } else {
    // 使用者可能自己搬過欄位順序，所以只補缺的欄，不重排既有欄位。
    var missing = [];
    for (var i = 0; i < headers.length; i++) {
      if (current.indexOf(headers[i]) === -1) missing.push(headers[i]);
    }
    if (missing.length) {
      sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  sh.setFrozenRows(1);
}

function headerIndex(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return {};
  var row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var i = 0; i < row.length; i++) {
    var key = String(row[i]).trim();
    if (key) idx[key] = i;
  }
  return idx;
}

function loadAll() {
  ensureSchema();
  return {
    bundles: readBundles(),
    settings: readSettings(),
    priors: readPriors(),
    spreadsheetUrl: spreadsheet().getUrl(),
    spreadsheetName: spreadsheet().getName()
  };
}

function readBundles() {
  var sh = sheet(SHEETS.bundles);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var idx = headerIndex(sh);
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var out = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(cell(row, idx, 'ID') || '').trim();
    var name = String(cell(row, idx, '名稱') || '').trim();
    var price = Number(cell(row, idx, '售價(TWD)'));
    if (!id && !name && !(price > 0)) continue;

    var qty = {};
    for (var i = 0; i < WR_CATALOG.IDS.length; i++) {
      var itemId = WR_CATALOG.IDS[i];
      var v = Number(cell(row, idx, WR_CATALOG.labelOf(itemId)));
      if (isFinite(v) && v > 0) qty[itemId] = v;
    }

    var en = cell(row, idx, '啟用');
    var enabled = (en === '' || en === null || en === undefined)
      ? true
      : !(en === false || en === 'FALSE' || en === '否' || en === 0);

    out.push({
      id: id || ('row-' + (r + 2)),
      name: name,
      price: isFinite(price) ? price : 0,
      date: asDate(cell(row, idx, '日期')),
      enabled: enabled,
      note: String(cell(row, idx, '備註') || ''),
      qty: qty
    });
  }
  return out;
}

function cell(row, idx, header) {
  var i = idx[header];
  return i === undefined ? '' : row[i];
}

function put(row, idx, header, value) {
  var i = idx[header];
  if (i !== undefined) row[i] = value;
}

function asDate(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(v);
}

function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
}

function bundleRow(bundle, idx, width) {
  var id = bundle.id || ('b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36));
  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';
  put(row, idx, 'ID', id);
  put(row, idx, '名稱', bundle.name || '');
  put(row, idx, '售價(TWD)', Number(bundle.price) || 0);
  put(row, idx, '日期', bundle.date || today());
  put(row, idx, '啟用', bundle.enabled !== false);
  put(row, idx, '備註', bundle.note || '');
  for (i = 0; i < WR_CATALOG.IDS.length; i++) {
    var itemId = WR_CATALOG.IDS[i];
    var v = bundle.qty ? Number(bundle.qty[itemId]) : 0;
    put(row, idx, WR_CATALOG.labelOf(itemId), isFinite(v) && v > 0 ? v : '');
  }
  return { id: id, row: row };
}

function saveBundle(bundle) {
  var sh = sheet(SHEETS.bundles);
  ensureHeaders(sh, bundleHeaders());
  var idx = headerIndex(sh);
  var width = sh.getLastColumn();
  var built = bundleRow(bundle, idx, width);
  var target = findRow(sh, idx, built.id);
  if (target > 0) sh.getRange(target, 1, 1, width).setValues([built.row]);
  else sh.appendRow(built.row);
  return built.id;
}

/** 批次寫入（載入範例、匯入用）。一次 setValues 遠快於逐列 appendRow。 */
function saveBundles(bundles) {
  if (!bundles || !bundles.length) return 0;
  var sh = sheet(SHEETS.bundles);
  ensureHeaders(sh, bundleHeaders());
  var idx = headerIndex(sh);
  var width = sh.getLastColumn();
  var rows = [];
  for (var i = 0; i < bundles.length; i++) rows.push(bundleRow(bundles[i], idx, width).row);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  return rows.length;
}

function findRow(sh, idx, id) {
  var col = idx['ID'];
  if (col === undefined) return -1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sh.getRange(2, col + 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]).trim() === id) return r + 2;
  }
  return -1;
}

function deleteBundle(id) {
  var sh = sheet(SHEETS.bundles);
  var row = findRow(sh, headerIndex(sh), id);
  if (row > 0) sh.deleteRow(row);
}

/**
 * 設定表的欄位定義。
 *
 * sheetKey 是寫在試算表第一欄的字串，field 是程式裡用的名字 —— 兩者不同名
 * 的那幾個是歷史包袱（bootstrapSamples / samples），改名會弄壞既有的試算表。
 * kind 決定讀回來怎麼轉型。
 */
var SETTING_ROWS = [
  ['method', 'method', 'text', 'robust', '看板用哪種算法：ls（最小平方）、robust（穩健回歸）、bayes（完整貝氏）。'],
  ['dropDominatedSingles', 'dropDominatedSingles', 'bool', true, '同一物品有多個純單品包時，只採用最便宜的那個。開著代表基準單價是「買得到的最好價格」。'],
  ['priorWeight', 'priorWeight', 'number', 1, '參考單價的份量，單位是「相當於幾筆禮包」。0 代表完全不理會參考單價。'],
  ['relativeWeighting', 'relativeWeighting', 'bool', true, '是否讓每包的相對誤差等權。關掉的話高價禮包會主導結果。'],
  ['bootstrapSamples', 'samples', 'number', 240, '重抽次數。越多區間越穩，但計算越慢。'],
  ['interval', 'interval', 'number', 0.8, '區間信賴水準，例如 0.8 代表 80% 區間。']
];

/**
 * 補齊設定表缺少的列。
 *
 * 不能只在「表是空的」時候建 —— 既有使用者的試算表早就建好了，新增的設定項
 * 若只在建表時寫入，他們永遠不會拿到那幾列，saveSettings 也就永遠寫不進去。
 */
function ensureSettingRows(sh) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['設定項', '值', '說明']]);
    sh.setFrozenRows(1);
  }
  var have = {};
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < keys.length; r++) have[String(keys[r][0]).trim()] = true;
  }
  var missing = [];
  for (var i = 0; i < SETTING_ROWS.length; i++) {
    var row = SETTING_ROWS[i];
    if (!have[row[0]]) missing.push([row[0], row[3], row[4]]);
  }
  if (missing.length) {
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  }
}

function settingIndex() {
  var m = {};
  for (var i = 0; i < SETTING_ROWS.length; i++) {
    m[SETTING_ROWS[i][0]] = { field: SETTING_ROWS[i][1], kind: SETTING_ROWS[i][2] };
  }
  return m;
}

function readSettings() {
  var sh = sheet(SHEETS.settings);
  var out = {};
  for (var i = 0; i < SETTING_ROWS.length; i++) out[SETTING_ROWS[i][1]] = SETTING_ROWS[i][3];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return out;
  var rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  var idx = settingIndex();
  for (var r = 0; r < rows.length; r++) {
    var spec = idx[String(rows[r][0]).trim()];
    if (!spec) continue;
    var raw = rows[r][1];
    if (spec.kind === 'bool') {
      out[spec.field] = !(raw === false || raw === 'FALSE' || raw === '否' || raw === 0);
    } else if (spec.kind === 'text') {
      var t = String(raw).trim();
      if (t) out[spec.field] = t;
    } else if (isFinite(Number(raw))) {
      out[spec.field] = Number(raw);
    }
  }
  return out;
}

function saveSettings(settings) {
  var sh = sheet(SHEETS.settings);
  ensureSettingRows(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var idx = settingIndex();
  for (var r = 0; r < keys.length; r++) {
    var spec = idx[String(keys[r][0]).trim()];
    if (spec && settings[spec.field] !== undefined) sh.getRange(r + 2, 2).setValue(settings[spec.field]);
  }
}

function labelToId() {
  var m = {};
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) m[WR_CATALOG.labelOf(WR_CATALOG.IDS[i])] = WR_CATALOG.IDS[i];
  return m;
}

/** 參考單價放在「單價看板」最後一欄，讓你在看到估計值的當下就能直接填。 */
function readPriors() {
  var sh = sheet(SHEETS.board);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  var idx = headerIndex(sh);
  if (idx['物品'] === undefined || idx['參考單價'] === undefined) return {};
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var byLabel = labelToId();
  var priors = {};
  for (var r = 0; r < values.length; r++) {
    var id = byLabel[String(values[r][idx['物品']]).trim()];
    if (!id) continue;
    var raw = values[r][idx['參考單價']];
    if (raw === '' || raw === null || raw === undefined) continue;
    var v = Number(raw);
    if (isFinite(v) && v > 0) priors[id] = v;
  }
  return priors;
}

function savePriors(priors) {
  var sh = sheet(SHEETS.board);
  var idx = headerIndex(sh);
  var lastRow = sh.getLastRow();
  if (idx['參考單價'] === undefined || idx['物品'] === undefined || lastRow < 2) return;
  var byLabel = labelToId();
  var labels = sh.getRange(2, idx['物品'] + 1, lastRow - 1, 1).getValues();
  var column = [];
  for (var r = 0; r < labels.length; r++) {
    var id = byLabel[String(labels[r][0]).trim()];
    var v = (id && Object.prototype.hasOwnProperty.call(priors, id)) ? priors[id] : '';
    column.push([v]);
  }
  sh.getRange(2, idx['參考單價'] + 1, column.length, 1).setValues(column);
}

/** 寫回單價看板。參考單價那一欄是使用者的輸入，覆寫時要原樣保留。 */
function writeBoard(items) {
  var sh = sheet(SHEETS.board);
  ensureHeaders(sh, BOARD_HEADERS);
  var priors = readPriors();
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();

  var idx = headerIndex(sh);
  var width = sh.getLastColumn();
  var confidenceText = { high: '高', mid: '中', low: '低', none: '無資料' };
  var rows = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var row = new Array(width);
    for (var c = 0; c < width; c++) row[c] = '';
    // 銀幣一枚 0.0000022 元這種數字在試算表裡一樣難讀，所以連同計價單位一起寫，
    // 「參考單價」那一欄使用者填的也是同一個單位。
    var per = WR_CATALOG.perOf(it.id);
    put(row, idx, '物品', it.label);
    put(row, idx, '計價單位', per === 1 ? '每 1 個' : '每 ' + WR_CATALOG.perLabel(it.id));
    put(row, idx, '基準單價', it.price * per);
    put(row, idx, '區間下界', it.low === null || it.low === undefined ? '' : it.low * per);
    put(row, idx, '區間上界', it.high === null || it.high === undefined ? '' : it.high * per);
    put(row, idx, '信心度', confidenceText[it.confidence] || it.confidence);
    put(row, idx, '出現包數', it.occurrences);
    put(row, idx, '總數量', it.totalQty);
    put(row, idx, '價值占比', it.share);
    put(row, idx, '參考單價', Object.prototype.hasOwnProperty.call(priors, it.id) ? priors[it.id] : '');
    rows.push(row);
  }
  if (rows.length) {
    sh.getRange(2, 1, rows.length, width).setValues(rows);
    if (idx['價值占比'] !== undefined) {
      sh.getRange(2, idx['價值占比'] + 1, rows.length, 1).setNumberFormat('0.0%');
    }
  }
  return rows.length;
}

function appendEvaluation(record) {
  var sh = sheet(SHEETS.evaluations);
  ensureHeaders(sh, EVAL_HEADERS);
  sh.appendRow([
    new Date(),
    record.name || '',
    Number(record.price) || 0,
    Number(record.value) || 0,
    Number(record.ratio) || 0,
    record.verdict || '',
    record.contents || ''
  ]);
}
