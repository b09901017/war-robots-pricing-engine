/**
 * 基準單價推算引擎。
 *
 * 問題設定：每一筆禮包是一條方程式
 *     售價_i  ≈  Σ_j  數量_ij × 單價_j
 * 把所有禮包疊起來就是一個超定線性系統。單價不可能為負，所以用
 * 帶 ridge 正則化的非負最小平方（NNLS）來解。
 *
 * 三個關鍵處理，缺一個結果就會歪掉：
 *
 * 1. 相對誤差加權 —— 直接對「元」做最小平方的話，一筆 3290 元的禮包
 *    會壓過十筆 90 元的禮包。把每一列除以該包售價，改成擬合相對誤差，
 *    貴包便宜包才有同等發言權。
 *
 * 2. 欄位正規化 —— 銀幣一次給 250 萬、終極資料卡一次給 1 張，兩者的
 *    欄位量級差了六個數量級，不正規化的話數值上根本解不動。把每個
 *    欄位縮成單位長度後求解，最後再還原回真實單價。
 *
 * 3. 自助重抽（bootstrap）區間 —— 只出現在一兩包裡的稀有物品，點估計
 *    幾乎沒有意義。重抽禮包重解多次，用分位數給出「可能區間」，
 *    誠實地表達不確定性。
 */
var WR_SOLVER = (function () {
  'use strict';

  var DEFAULTS = {
    ridge: 0.005,          // 正則化強度（欄位正規化後的尺度，0 ~ 0.1 之間合理）
    relativeWeighting: true,
    bootstrap: true,
    samples: 240,
    interval: 0.8,         // 80% 區間：比 95% 窄，對「這包值不值」這種決策更實用
    seed: 1337             // 固定種子，資料沒變時區間就不會自己跳動
  };

  function solve(bundles, options) {
    var opt = merge(DEFAULTS, options || {});
    var locks = opt.locks || {};

    var rows = [];
    for (var i = 0; i < bundles.length; i++) {
      var bd = bundles[i];
      if (bd.enabled === false) continue;
      var price = Number(bd.price);
      if (!isFinite(price) || price <= 0) continue;
      var qty = normalizeQty(bd.qty);
      if (totalOf(qty) <= 0) continue;
      rows.push({ id: bd.id, name: bd.name, price: price, qty: qty });
    }

    var stats = itemStats(rows);
    var present = stats.present;

    // 鎖定的物品單價視為已知，從售價裡先扣掉，不參與求解。
    var solveIds = [];
    for (i = 0; i < present.length; i++) {
      if (!isLocked(locks, present[i])) solveIds.push(present[i]);
    }

    var warnings = [];
    var target = [];
    var lockedValue = [];
    for (i = 0; i < rows.length; i++) {
      var lv = 0;
      for (var id in locks) {
        if (!Object.prototype.hasOwnProperty.call(locks, id)) continue;
        if (!isLocked(locks, id)) continue;
        lv += (rows[i].qty[id] || 0) * Number(locks[id]);
      }
      lockedValue.push(lv);
      target.push(rows[i].price - lv);
    }
    for (i = 0; i < rows.length; i++) {
      if (target[i] < 0) {
        warnings.push({
          level: 'warn',
          code: 'lock-exceeds-price',
          text: '「' + (rows[i].name || rows[i].id) + '」的鎖定單價加總已超過它的售價，請檢查鎖定值。'
        });
        break;
      }
    }

    var point = fit(rows, solveIds, target, opt);
    var prices = {};
    for (i = 0; i < solveIds.length; i++) prices[solveIds[i]] = point[i];
    for (id in locks) {
      if (Object.prototype.hasOwnProperty.call(locks, id) && isLocked(locks, id)) {
        prices[id] = Number(locks[id]);
      }
    }

    var interval = null;
    var draws = null;
    if (opt.bootstrap && rows.length >= 3 && solveIds.length > 0) {
      var boot = bootstrap(rows, solveIds, locks, opt, point);
      interval = boot.interval;
      draws = { itemIds: solveIds, values: boot.values };
    }

    var diagnostics = fitQuality(rows, prices);
    var items = describeItems(present, prices, interval, stats, locks, rows.length);

    if (rows.length === 0) {
      warnings.push({ level: 'info', code: 'no-data', text: '還沒有任何禮包資料，先新增幾筆再回來看單價。' });
    } else if (rows.length < 4) {
      warnings.push({ level: 'warn', code: 'few-bundles', text: '目前只有 ' + rows.length + ' 筆禮包，單價會非常不穩定。建議至少累積 8 筆以上。' });
    } else if (solveIds.length > rows.length) {
      warnings.push({
        level: 'warn',
        code: 'underdetermined',
        text: '待解物品（' + solveIds.length + ' 種）比禮包筆數（' + rows.length + ' 筆）還多，方程式不足。可以鎖定幾個你有把握的單價來收斂結果。'
      });
    }

    var zeroed = [];
    for (i = 0; i < solveIds.length; i++) {
      if (prices[solveIds[i]] === 0 && stats.occurrences[solveIds[i]] > 0) zeroed.push(solveIds[i]);
    }
    if (zeroed.length) {
      warnings.push({
        level: 'info',
        code: 'pinned-zero',
        code2: zeroed,
        text: '有 ' + zeroed.length + ' 種物品被解成 0 元。通常代表它總是跟別的物品綁在一起出現，資料還分不出它自己的價值。'
      });
    }

    return {
      bundleCount: rows.length,
      solvedCount: solveIds.length,
      lockedCount: countLocks(locks, present),
      items: items,
      prices: prices,
      fit: diagnostics,
      draws: draws,
      warnings: warnings,
      options: { ridge: opt.ridge, relativeWeighting: opt.relativeWeighting, samples: opt.samples, interval: opt.interval }
    };
  }

  /** 單次求解：加權 → 欄位正規化 → NNLS → 還原尺度。回傳與 itemIds 同序的單價陣列。 */
  function fit(rows, itemIds, target, opt) {
    var m = rows.length;
    var n = itemIds.length;
    if (m === 0 || n === 0) return WR_LINALG.zeros(n);

    var weights = new Array(m);
    var meanPrice = 0;
    for (var i = 0; i < m; i++) meanPrice += rows[i].price;
    meanPrice = meanPrice / m;
    for (i = 0; i < m; i++) {
      weights[i] = opt.relativeWeighting ? 1 / rows[i].price : 1 / meanPrice;
    }

    var A = new Array(m);
    for (i = 0; i < m; i++) {
      var row = new Array(n);
      var q = rows[i].qty;
      for (var j = 0; j < n; j++) row[j] = (q[itemIds[j]] || 0) * weights[i];
      A[i] = row;
    }

    var colNorm = new Array(n);
    for (j = 0; j < n; j++) {
      var s = 0;
      for (i = 0; i < m; i++) s += A[i][j] * A[i][j];
      colNorm[j] = Math.sqrt(s);
    }
    for (j = 0; j < n; j++) {
      if (colNorm[j] > 0) {
        for (i = 0; i < m; i++) A[i][j] /= colNorm[j];
      }
    }

    var b = new Array(m);
    for (i = 0; i < m; i++) b[i] = target[i] * weights[i];
    var bNorm = WR_LINALG.norm2(b);
    if (bNorm === 0) return WR_LINALG.zeros(n);
    for (i = 0; i < m; i++) b[i] /= bNorm;

    var scaled = WR_LINALG.nnls(A, b, opt.ridge);

    var out = new Array(n);
    for (j = 0; j < n; j++) {
      out[j] = colNorm[j] > 0 ? (scaled[j] * bNorm) / colNorm[j] : 0;
    }
    return out;
  }

  /** 重抽禮包（有放回）重解多次，得到每個物品單價的經驗分布。 */
  function bootstrap(rows, itemIds, locks, opt, point) {
    var m = rows.length;
    var n = itemIds.length;
    var rand = WR_LINALG.rng(opt.seed);
    var samples = Math.max(30, Math.min(opt.samples, 600));

    var values = [];
    for (var s = 0; s < samples; s++) {
      var picked = new Array(m);
      var seen = {};
      for (var i = 0; i < m; i++) {
        var k = Math.floor(rand() * m);
        if (k >= m) k = m - 1;
        picked[i] = rows[k];
        var q = rows[k].qty;
        for (var id in q) {
          if (Object.prototype.hasOwnProperty.call(q, id) && q[id] > 0) seen[id] = true;
        }
      }
      var target = new Array(m);
      for (i = 0; i < m; i++) {
        var lv = 0;
        for (var lid in locks) {
          if (Object.prototype.hasOwnProperty.call(locks, lid) && isLocked(locks, lid)) {
            lv += (picked[i].qty[lid] || 0) * Number(locks[lid]);
          }
        }
        target[i] = picked[i].price - lv;
      }
      var est = fit(picked, itemIds, target, opt);
      // 這一輪沒抽到的物品沒有估計值，記成 null 而不是 0 —— 記成 0 會把區間往下拉歪。
      for (var j = 0; j < n; j++) {
        if (!seen[itemIds[j]]) est[j] = null;
      }
      values.push(est);
    }

    var lo = (1 - opt.interval) / 2;
    var hi = 1 - lo;
    var interval = {};
    for (j = 0; j < n; j++) {
      var col = [];
      for (s = 0; s < samples; s++) {
        var v = values[s][j];
        if (v !== null && isFinite(v)) col.push(v);
      }
      if (col.length < Math.max(10, samples * 0.2)) { interval[itemIds[j]] = null; continue; }
      col.sort(function (a, b) { return a - b; });
      interval[itemIds[j]] = {
        low: WR_LINALG.percentile(col, lo),
        high: WR_LINALG.percentile(col, hi),
        median: WR_LINALG.percentile(col, 0.5),
        samples: col.length
      };
    }
    // NNLS 在 0 這個邊界上會讓重抽分布偏態，百分位區間因此可能整段落在點估計的
    // 同一側 —— 看板上就會出現「點估計落在區間外」這種看起來壞掉的畫面。
    // 把區間撐開到至少涵蓋點估計：只會變寬，不會低估不確定性。
    if (point) {
      for (j = 0; j < n; j++) {
        var band = interval[itemIds[j]];
        if (!band) continue;
        band.low = Math.max(0, Math.min(band.low, point[j]));
        band.high = Math.max(band.high, point[j]);
      }
    }
    return { interval: interval, values: values };
  }

  function itemStats(rows) {
    var occurrences = {};
    var totalQty = {};
    var present = [];
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i].qty;
      for (var id in q) {
        if (!Object.prototype.hasOwnProperty.call(q, id)) continue;
        if (!(q[id] > 0)) continue;
        if (occurrences[id] === undefined) { occurrences[id] = 0; totalQty[id] = 0; present.push(id); }
        occurrences[id] += 1;
        totalQty[id] += q[id];
      }
    }
    present.sort(function (a, b) {
      return WR_CATALOG.IDS.indexOf(a) - WR_CATALOG.IDS.indexOf(b);
    });
    return { occurrences: occurrences, totalQty: totalQty, present: present };
  }

  function describeItems(present, prices, interval, stats, locks, bundleCount) {
    var out = [];
    var grandTotal = 0;
    var contribution = {};
    for (var i = 0; i < present.length; i++) {
      var id = present[i];
      var c = (stats.totalQty[id] || 0) * (prices[id] || 0);
      contribution[id] = c;
      grandTotal += c;
    }
    for (i = 0; i < present.length; i++) {
      id = present[i];
      var band = interval ? interval[id] : null;
      var price = prices[id];
      var locked = isLocked(locks, id);
      var occ = stats.occurrences[id] || 0;
      var relWidth = null;
      if (band && price > 0) relWidth = (band.high - band.low) / price;
      out.push({
        id: id,
        label: WR_CATALOG.labelOf(id),
        group: (WR_CATALOG.get(id) || {}).group || 'other',
        price: price,
        locked: locked,
        low: band ? band.low : null,
        high: band ? band.high : null,
        relativeWidth: relWidth,
        occurrences: occ,
        totalQty: stats.totalQty[id] || 0,
        share: grandTotal > 0 ? contribution[id] / grandTotal : 0,
        confidence: locked ? 'locked' : confidenceOf(occ, relWidth, price, bundleCount)
      });
    }
    out.sort(function (a, b) { return b.share - a.share; });
    return out;
  }

  /**
   * 信心度看兩件事：這個物品出現在幾包裡（資料量），
   * 以及重抽區間相對於點估計有多寬（穩定度）。
   */
  function confidenceOf(occurrences, relWidth, price, bundleCount) {
    if (occurrences === 0) return 'none';
    if (price === 0) return 'low';
    if (relWidth === null) return occurrences >= 4 ? 'mid' : 'low';
    if (occurrences >= 4 && relWidth <= 0.35) return 'high';
    if (occurrences >= 2 && relWidth <= 0.9) return 'mid';
    return 'low';
  }

  function fitQuality(rows, prices) {
    var m = rows.length;
    if (m === 0) return { count: 0, r2: null, mape: null, rmse: null, predictions: [] };
    var predictions = [];
    var sumActual = 0;
    var ssRes = 0;
    var absPct = 0;
    for (var i = 0; i < m; i++) {
      var predicted = 0;
      var q = rows[i].qty;
      for (var id in q) {
        if (Object.prototype.hasOwnProperty.call(q, id)) predicted += q[id] * (prices[id] || 0);
      }
      var actual = rows[i].price;
      sumActual += actual;
      ssRes += (predicted - actual) * (predicted - actual);
      absPct += Math.abs(predicted - actual) / actual;
      predictions.push({
        id: rows[i].id,
        name: rows[i].name,
        actual: actual,
        predicted: predicted,
        residual: predicted - actual,
        ratio: predicted / actual
      });
    }
    var mean = sumActual / m;
    var ssTot = 0;
    for (i = 0; i < m; i++) ssTot += (rows[i].price - mean) * (rows[i].price - mean);
    predictions.sort(function (a, b) { return Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1); });
    return {
      count: m,
      r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
      mape: absPct / m,
      rmse: Math.sqrt(ssRes / m),
      predictions: predictions
    };
  }

  function normalizeQty(qty) {
    var out = {};
    if (!qty) return out;
    for (var id in qty) {
      if (!Object.prototype.hasOwnProperty.call(qty, id)) continue;
      var v = Number(qty[id]);
      if (isFinite(v) && v > 0) out[id] = v;
    }
    return out;
  }

  function totalOf(qty) {
    var t = 0;
    for (var id in qty) if (Object.prototype.hasOwnProperty.call(qty, id)) t += qty[id];
    return t;
  }

  function isLocked(locks, id) {
    if (!locks || !Object.prototype.hasOwnProperty.call(locks, id)) return false;
    var v = Number(locks[id]);
    return isFinite(v) && v >= 0;
  }

  function countLocks(locks, present) {
    var c = 0;
    for (var i = 0; i < present.length; i++) if (isLocked(locks, present[i])) c++;
    return c;
  }

  function merge(base, extra) {
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined && extra[k] !== null) out[k] = extra[k];
    }
    return out;
  }

  return {
    DEFAULTS: DEFAULTS,
    solve: solve,
    fit: fit,
    fitQuality: fitQuality,
    confidenceOf: confidenceOf
  };
})();
