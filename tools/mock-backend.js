/**
 * 本機預覽用的假後端：把試算表換成 localStorage。
 * 只在 tools/preview.js 產生的離線版裡使用，不會被推上 Apps Script。
 */
window.WR_MOCK = (function () {
  'use strict';

  var KEY = 'wr-preview-store';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 忽略 */ }
    return seed();
  }

  function seed() {
    var store = {
      bundles: WR_SAMPLE.bundles().map(function (s, i) {
        s.id = 'sample-' + i;
        return s;
      }),
      settings: { ridge: 0.005, relativeWeighting: true, samples: 240, interval: 0.8 },
      locks: {}
    };
    save(store);
    return store;
  }

  function save(store) {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
  }

  return {
    apiBootstrap: function () {
      var s = load();
      return { bundles: s.bundles, settings: s.settings, locks: s.locks, spreadsheetUrl: '' };
    },
    apiSaveBundle: function (bundle) {
      var s = load();
      var id = bundle.id || 'b' + Date.now().toString(36);
      var next = { id: id, name: bundle.name, price: bundle.price, qty: bundle.qty,
        date: bundle.date || new Date().toISOString().slice(0, 10), enabled: bundle.enabled !== false, note: bundle.note || '' };
      var i = s.bundles.findIndex(function (b) { return b.id === id; });
      if (i >= 0) s.bundles[i] = next; else s.bundles.push(next);
      save(s);
      return { id: id, bundles: s.bundles };
    },
    apiDeleteBundle: function (id) {
      var s = load();
      s.bundles = s.bundles.filter(function (b) { return b.id !== id; });
      save(s);
      return { bundles: s.bundles };
    },
    apiSaveLocks: function (locks) {
      var s = load(); s.locks = locks || {}; save(s);
      return { locks: s.locks };
    },
    apiSaveSettings: function (settings) {
      var s = load(); s.settings = settings; save(s);
      return { settings: s.settings };
    },
    apiSyncBoard: function (items) {
      return { written: (items || []).length };
    },
    apiLogEvaluation: function () { return { ok: true }; },
    apiLoadSample: function () {
      var s = seed();
      return { bundles: s.bundles };
    }
  };
})();
