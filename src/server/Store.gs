/**
 * 試算表存取層。所有工作表的建立、讀寫都集中在這裡。
 *
 * 資料表刻意採「寬表」格式（每個物品一欄），這樣你直接打開 Google 試算表
 * 也看得懂、也能手動改，而不是只有程式讀得動的長表。
 */

var WR_SHEETS = {
  bundles: '禮包',
  board: '單價看板',
  settings: '設定',
  evaluations: '試算紀錄'
};

var WR_BUNDLE_FIXED = ['ID', '名稱', '售價(TWD)', '日期', '啟用'];
var WR_BOARD_HEADERS = ['物品', '基準單價', '區間下界', '區間上界', '信心度', '出現包數', '總數量', '價值占比', '鎖定單價'];
var WR_EVAL_HEADERS = ['時間', '名稱', '售價(TWD)', '理論價值', '性價比指數', '評價', '內容'];

var WR_PROP_SHEET_ID = 'WR_SHEET_ID';

/**
 * 取得要操作的試算表。
 * 從試算表選單執行時 getActiveSpreadsheet() 就夠用；但 Web App 是獨立的執行環境，
 * 拿不到「作用中」的試算表，所以初始化時會把試算表 ID 記在指令碼屬性裡備用。
 */
function wrSpreadsheet_() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) {
    PropertiesService.getScriptProperties().setProperty(WR_PROP_SHEET_ID, ss.getId());
    return ss;
  }
  var id = PropertiesService.getScriptProperties().getProperty(WR_PROP_SHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('找不到試算表。請先在試算表裡執行一次選單的「初始化工作表」。');
}

function wrSheet_(name) {
  var ss = wrSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/** 禮包表的欄位標題：固定欄 + 每個物品一欄 + 備註。 */
function wrBundleHeaders_() {
  var headers = WR_BUNDLE_FIXED.slice();
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) {
    headers.push(WR_CATALOG.labelOf(WR_CATALOG.IDS[i]));
  }
  headers.push('備註');
  return headers;
}

/** 建立（或補齊）所有工作表與標題列。重複執行是安全的。 */
function wrEnsureSchema() {
  var ss = wrSpreadsheet_();
  PropertiesService.getScriptProperties().setProperty(WR_PROP_SHEET_ID, ss.getId());

  wrEnsureHeaders_(wrSheet_(WR_SHEETS.bundles), wrBundleHeaders_());
  wrEnsureHeaders_(wrSheet_(WR_SHEETS.board), WR_BOARD_HEADERS);
  wrEnsureHeaders_(wrSheet_(WR_SHEETS.evaluations), WR_EVAL_HEADERS);

  var settings = wrSheet_(WR_SHEETS.settings);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 1, 3).setValues([['設定項', '值', '說明']]);
    settings.getRange(2, 1, 4, 3).setValues([
      ['ridge', WR_SOLVER.DEFAULTS.ridge, '正則化強度。調高會讓稀有物品的單價更保守，建議 0 ~ 0.1。'],
      ['relativeWeighting', true, '是否讓每包的相對誤差等權。關掉的話高價禮包會主導結果。'],
      ['bootstrapSamples', WR_SOLVER.DEFAULTS.samples, '重抽次數。越多區間越穩，但計算越慢。'],
      ['interval', WR_SOLVER.DEFAULTS.interval, '區間信賴水準，例如 0.8 代表 80% 區間。']
    ]);
    settings.setFrozenRows(1);
    settings.autoResizeColumns(1, 3);
  }

  var sh = wrSheet_(WR_SHEETS.bundles);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  return { ok: true, url: ss.getUrl() };
}

function wrEnsureHeaders_(sheet, headers) {
  var current = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  var missing = [];
  for (var i = 0; i < headers.length; i++) {
    if (current.indexOf(headers[i]) === -1) missing.push(headers[i]);
  }
  if (current.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  } else if (missing.length) {
    // 使用者可能自己搬動過欄位順序，所以只補上缺的欄，不重排既有欄位。
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, current.length + 1, 1, missing.length).setFontWeight('bold');
  }
  sheet.setFrozenRows(1);
}

/** 讀出標題列，回傳 {標題: 欄索引(0-based)}。 */
function wrHeaderIndex_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var i = 0; i < row.length; i++) {
    var key = String(row[i]).trim();
    if (key) idx[key] = i;
  }
  return idx;
}

function wrReadBundles() {
  var sh = wrSheet_(WR_SHEETS.bundles);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var idx = wrHeaderIndex_(sh);
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var out = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(pick_(row, idx, 'ID') || '').trim();
    var price = Number(pick_(row, idx, '售價(TWD)'));
    var name = String(pick_(row, idx, '名稱') || '').trim();
    if (!id && !name && !(price > 0)) continue;

    var qty = {};
    for (var i = 0; i < WR_CATALOG.IDS.length; i++) {
      var itemId = WR_CATALOG.IDS[i];
      var v = Number(pick_(row, idx, WR_CATALOG.labelOf(itemId)));
      if (isFinite(v) && v > 0) qty[itemId] = v;
    }

    var enabledCell = pick_(row, idx, '啟用');
    var enabled = enabledCell === '' || enabledCell === null || enabledCell === undefined
      ? true
      : !(enabledCell === false || enabledCell === 'FALSE' || enabledCell === '否' || enabledCell === 0);

    out.push({
      id: id || ('row-' + (r + 2)),
      row: r + 2,
      name: name,
      price: isFinite(price) ? price : 0,
      date: formatDate_(pick_(row, idx, '日期')),
      enabled: enabled,
      note: String(pick_(row, idx, '備註') || ''),
      qty: qty
    });
  }
  return out;
}

function pick_(row, idx, header) {
  var i = idx[header];
  return i === undefined ? '' : row[i];
}

function formatDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(v);
}

/** 新增或更新一筆禮包。沒有 id 就配一個新的。 */
function wrSaveBundle(bundle) {
  var sh = wrSheet_(WR_SHEETS.bundles);
  wrEnsureHeaders_(sh, wrBundleHeaders_());
  var idx = wrHeaderIndex_(sh);
  var width = sh.getLastColumn();

  var id = bundle.id || ('b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36));
  var targetRow = wrFindRow_(sh, idx, id);

  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';
  put_(row, idx, 'ID', id);
  put_(row, idx, '名稱', bundle.name || '');
  put_(row, idx, '售價(TWD)', Number(bundle.price) || 0);
  put_(row, idx, '日期', bundle.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd'));
  put_(row, idx, '啟用', bundle.enabled === false ? false : true);
  put_(row, idx, '備註', bundle.note || '');
  for (i = 0; i < WR_CATALOG.IDS.length; i++) {
    var itemId = WR_CATALOG.IDS[i];
    var v = bundle.qty ? Number(bundle.qty[itemId]) : 0;
    put_(row, idx, WR_CATALOG.labelOf(itemId), isFinite(v) && v > 0 ? v : '');
  }

  if (targetRow > 0) {
    sh.getRange(targetRow, 1, 1, width).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return id;
}

function put_(row, idx, header, value) {
  var i = idx[header];
  if (i !== undefined) row[i] = value;
}

function wrFindRow_(sheet, idx, id) {
  var col = idx['ID'];
  if (col === undefined) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]).trim() === id) return r + 2;
  }
  return -1;
}

function wrDeleteBundle(id) {
  var sh = wrSheet_(WR_SHEETS.bundles);
  var idx = wrHeaderIndex_(sh);
  var row = wrFindRow_(sh, idx, id);
  if (row > 0) sh.deleteRow(row);
  return row > 0;
}

function wrReadSettings() {
  var sh = wrSheet_(WR_SHEETS.settings);
  var out = {
    ridge: WR_SOLVER.DEFAULTS.ridge,
    relativeWeighting: WR_SOLVER.DEFAULTS.relativeWeighting,
    samples: WR_SOLVER.DEFAULTS.samples,
    interval: WR_SOLVER.DEFAULTS.interval
  };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return out;
  var rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  var map = { ridge: 'ridge', relativeWeighting: 'relativeWeighting', bootstrapSamples: 'samples', interval: 'interval' };
  for (var r = 0; r < rows.length; r++) {
    var key = map[String(rows[r][0]).trim()];
    if (!key) continue;
    var raw = rows[r][1];
    if (key === 'relativeWeighting') {
      out[key] = !(raw === false || raw === 'FALSE' || raw === '否' || raw === 0);
    } else {
      var n = Number(raw);
      if (isFinite(n)) out[key] = n;
    }
  }
  return out;
}

function wrSaveSettings(settings) {
  var sh = wrSheet_(WR_SHEETS.settings);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var map = { ridge: 'ridge', relativeWeighting: 'relativeWeighting', bootstrapSamples: 'samples', interval: 'interval' };
  for (var r = 0; r < keys.length; r++) {
    var key = map[String(keys[r][0]).trim()];
    if (key && settings[key] !== undefined) sh.getRange(r + 2, 2).setValue(settings[key]);
  }
}

/** 鎖定單價存在「單價看板」的最後一欄，讓你在看到估計值的當下就能直接釘住它。 */
function wrReadLocks() {
  var sh = wrSheet_(WR_SHEETS.board);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  var idx = wrHeaderIndex_(sh);
  if (idx['物品'] === undefined || idx['鎖定單價'] === undefined) return {};
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var byLabel = {};
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) byLabel[WR_CATALOG.labelOf(WR_CATALOG.IDS[i])] = WR_CATALOG.IDS[i];

  var locks = {};
  for (var r = 0; r < values.length; r++) {
    var id = byLabel[String(values[r][idx['物品']]).trim()];
    if (!id) continue;
    var raw = values[r][idx['鎖定單價']];
    if (raw === '' || raw === null || raw === undefined) continue;
    var v = Number(raw);
    if (isFinite(v) && v >= 0) locks[id] = v;
  }
  return locks;
}

function wrSaveLocks(locks) {
  var board = wrReadBoardRows_();
  var sh = wrSheet_(WR_SHEETS.board);
  var idx = wrHeaderIndex_(sh);
  if (idx['鎖定單價'] === undefined) return;
  var byLabel = {};
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) byLabel[WR_CATALOG.labelOf(WR_CATALOG.IDS[i])] = WR_CATALOG.IDS[i];

  for (var r = 0; r < board.length; r++) {
    var id = byLabel[board[r].label];
    if (!id) continue;
    var v = Object.prototype.hasOwnProperty.call(locks, id) ? locks[id] : '';
    sh.getRange(board[r].row, idx['鎖定單價'] + 1).setValue(v === null || v === undefined ? '' : v);
  }
}

function wrReadBoardRows_() {
  var sh = wrSheet_(WR_SHEETS.board);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var idx = wrHeaderIndex_(sh);
  if (idx['物品'] === undefined) return [];
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    out.push({ row: r + 2, label: String(values[r][idx['物品']]).trim() });
  }
  return out;
}

/**
 * 把算好的單價看板寫回試算表。
 * 鎖定單價那一欄是使用者的輸入，覆寫時要原樣保留。
 */
function wrWriteBoard(items) {
  var sh = wrSheet_(WR_SHEETS.board);
  wrEnsureHeaders_(sh, WR_BOARD_HEADERS);
  var locks = wrReadLocks();
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();

  var idx = wrHeaderIndex_(sh);
  var width = sh.getLastColumn();
  var byLabel = {};
  for (var i = 0; i < WR_CATALOG.IDS.length; i++) byLabel[WR_CATALOG.labelOf(WR_CATALOG.IDS[i])] = WR_CATALOG.IDS[i];

  var confidenceText = { high: '高', mid: '中', low: '低', none: '無資料', locked: '已鎖定' };
  var rows = [];
  for (i = 0; i < items.length; i++) {
    var it = items[i];
    var row = new Array(width);
    for (var c = 0; c < width; c++) row[c] = '';
    put_(row, idx, '物品', it.label);
    put_(row, idx, '基準單價', it.price);
    put_(row, idx, '區間下界', it.low === null || it.low === undefined ? '' : it.low);
    put_(row, idx, '區間上界', it.high === null || it.high === undefined ? '' : it.high);
    put_(row, idx, '信心度', confidenceText[it.confidence] || it.confidence);
    put_(row, idx, '出現包數', it.occurrences);
    put_(row, idx, '總數量', it.totalQty);
    put_(row, idx, '價值占比', it.share);
    put_(row, idx, '鎖定單價', Object.prototype.hasOwnProperty.call(locks, it.id) ? locks[it.id] : '');
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

function wrAppendEvaluation(record) {
  var sh = wrSheet_(WR_SHEETS.evaluations);
  wrEnsureHeaders_(sh, WR_EVAL_HEADERS);
  sh.appendRow([
    new Date(),
    record.name || '',
    Number(record.price) || 0,
    Number(record.value) || 0,
    Number(record.ratio) || 0,
    record.verdict || '',
    record.contents || ''
  ]);
  return true;
}
