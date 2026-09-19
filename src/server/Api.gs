/**
 * 前端唯一會呼叫的一層。
 *
 * google.script.run 每次往返大約 300~800ms，所以介面刻意做得粗顆粒：
 * 一個使用者動作 = 一次呼叫，而且寫入後直接把最新的完整清單一起回傳，
 * 前端就不用再補一次讀取。
 *
 * 推算引擎本身跑在瀏覽器端（見 lib/solver.js），所以改一個數字就能
 * 立刻重算，不需要等伺服器。伺服器只負責試算表的讀寫。
 */

function apiBootstrap() {
  wrEnsureSchema();
  return {
    bundles: wrReadBundles(),
    settings: wrReadSettings(),
    locks: wrReadLocks(),
    spreadsheetUrl: wrSpreadsheet_().getUrl()
  };
}

function apiSaveBundle(bundle) {
  var id = wrSaveBundle(bundle);
  return { id: id, bundles: wrReadBundles() };
}

function apiDeleteBundle(id) {
  wrDeleteBundle(id);
  return { bundles: wrReadBundles() };
}

function apiSaveLocks(locks) {
  wrSaveLocks(locks || {});
  return { locks: wrReadLocks() };
}

function apiSaveSettings(settings) {
  wrSaveSettings(settings || {});
  return { settings: wrReadSettings() };
}

/** 把前端算好的單價看板寫回試算表。 */
function apiSyncBoard(items) {
  var n = wrWriteBoard(items || []);
  return { written: n };
}

function apiLogEvaluation(record) {
  wrAppendEvaluation(record || {});
  return { ok: true };
}

function apiLoadSample() {
  wrLoadSampleData();
  return { bundles: wrReadBundles() };
}
