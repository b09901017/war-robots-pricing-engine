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
    /**
     * 參考值的份量，單位是「相當於幾次觀測」。拉力正好是 份量/(觀測次數+份量)。
     *
     * 預設 1 是刻意保守的：參考值在共線、資料完全無法分辨的情況下只要有一點點
     * 份量就足以決定分攤，但在資料本來就夠的地方，它反而會把答案往錯的方向拉一些，
     * 而且會透過物品之間的相關性波及到沒給參考值的物品。所以份量給到「一筆」就好。
     */
    priorWeight: 1,
    /** 純粹避免矩陣退化的最小正則化。共線時決定「平手就選比較小的」，其餘情況影響可以忽略。 */
    ridgeFloor: 0.01,
    relativeWeighting: true,
    bootstrap: true,
    samples: 240,
    interval: 0.8,         // 80% 區間：比 95% 窄，對「這包值不值」這種決策更實用
    seed: 1337             // 固定種子，資料沒變時區間就不會自己跳動
    // priors: {物品id: 每單位參考單價} —— 正則化的錨點，不是鎖定值
  };

  function solve(bundles, options) {
    var opt = merge(DEFAULTS, options || {});
    var priors = opt.priors || {};

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
    var solveIds = stats.present;
    var warnings = [];

    var target = [];
    for (i = 0; i < rows.length; i++) target.push(rows[i].price);

    var point = fit(rows, solveIds, target, opt, priors);
    var prices = {};
    for (i = 0; i < solveIds.length; i++) prices[solveIds[i]] = point[i];

    // 同一批資料再解一次、但完全不理會參考值。兩者的差距就是「參考值影響了多少」，
    // 讓使用者看得出結論是資料撐起來的，還是只是自己的猜測被原樣印回來。
    var hasPriors = countPriors(priors, solveIds) > 0;
    var dataOnly = {};
    if (hasPriors) {
      var bare = fit(rows, solveIds, target, opt, null);
      for (i = 0; i < solveIds.length; i++) dataOnly[solveIds[i]] = bare[i];
    }

    var interval = null;
    var draws = null;
    if (opt.bootstrap && rows.length >= 3 && solveIds.length > 0) {
      var boot = bootstrap(rows, solveIds, priors, opt, point);
      interval = boot.interval;
      draws = { itemIds: solveIds, values: boot.values };
    }

    var diagnostics = fitQuality(rows, prices);
    var items = describeItems(solveIds, prices, interval, stats, priors, dataOnly, hasPriors);

    if (rows.length === 0) {
      warnings.push({ level: 'info', code: 'no-data', text: '還沒有任何禮包資料，先新增幾筆再回來看單價。' });
    } else if (rows.length < 4) {
      warnings.push({ level: 'warn', code: 'few-bundles', text: '目前只有 ' + rows.length + ' 筆禮包，單價會非常不穩定。建議至少累積 8 筆以上。' });
    } else if (solveIds.length > rows.length) {
      warnings.push({
        level: 'warn',
        code: 'underdetermined',
        text: '待解物品（' + solveIds.length + ' 種）比禮包筆數（' + rows.length + ' 筆）還多，方程式不足。' +
          '再多記幾筆，或到設定裡給幾個參考單價當起點。'
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
      priorCount: countPriors(priors, solveIds),
      items: items,
      prices: prices,
      fit: diagnostics,
      draws: draws,
      warnings: warnings,
      options: { priorWeight: opt.priorWeight, relativeWeighting: opt.relativeWeighting, samples: opt.samples, interval: opt.interval }
    };
  }

  /** 單次求解：加權 → 欄位正規化 → NNLS → 還原尺度。回傳與 itemIds 同序的單價陣列。 */
  function fit(rows, itemIds, target, opt, priors) {
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

    /*
     * 欄位縮放用「該物品出現過的那幾列」的均方根，而不是整欄的長度。
     * 這樣縮放後 G 的對角線正好等於該物品被觀測到的次數，於是正則化的
     * 係數就有了明確的單位：λ = 2 就是「參考值相當於兩次觀測」。
     *
     * 先前版本把整個問題正規化成與筆數無關，λ 的相對份量因此永遠不變，
     * 資料再多也推不翻參考值 —— 那正好毀掉這個功能存在的理由。
     */
    var colNorm = new Array(n);
    var occ = new Array(n);
    for (j = 0; j < n; j++) {
      var sq = 0;
      var k = 0;
      for (i = 0; i < m; i++) {
        if (A[i][j] !== 0) { sq += A[i][j] * A[i][j]; k++; }
      }
      occ[j] = k;
      colNorm[j] = k > 0 ? Math.sqrt(sq / k) : 0;
    }
    for (j = 0; j < n; j++) {
      if (colNorm[j] > 0) {
        for (i = 0; i < m; i++) A[i][j] /= colNorm[j];
      }
    }

    var b = new Array(m);
    var bsq = 0;
    for (i = 0; i < m; i++) {
      b[i] = target[i] * weights[i];
      bsq += b[i] * b[i];
    }
    var bNorm = Math.sqrt(bsq / m);
    if (bNorm === 0) return WR_LINALG.zeros(n);
    for (i = 0; i < m; i++) b[i] /= bNorm;

    // 參考值要換到同一個縮放座標系，否則錨點會落在完全不同的位置。
    // 還原時是 x = scaled * bNorm / colNorm，反過來就是 scaled = x * colNorm / bNorm。
    var prior = null;
    var ridgeVec = new Array(n);
    for (j = 0; j < n; j++) {
      var pv = priors ? Number(priors[itemIds[j]]) : NaN;
      var hasPrior = isFinite(pv) && pv > 0 && colNorm[j] > 0;
      if (hasPrior) {
        if (!prior) prior = WR_LINALG.zeros(n);
        prior[j] = (pv * colNorm[j]) / bNorm;
      }
      // 有參考值的欄位給足份量；沒有的只給最低限度，避免被無謂地往 0 拉。
      ridgeVec[j] = hasPrior ? opt.priorWeight : opt.ridgeFloor;
    }

    var scaled = WR_LINALG.nnls(A, b, ridgeVec, prior);

    var out = new Array(n);
    for (j = 0; j < n; j++) {
      out[j] = colNorm[j] > 0 ? (scaled[j] * bNorm) / colNorm[j] : 0;
    }
    return out;
  }

  /** 重抽禮包（有放回）重解多次，得到每個物品單價的經驗分布。 */
  function bootstrap(rows, itemIds, priors, opt, point) {
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
      for (i = 0; i < m; i++) target[i] = picked[i].price;
      var est = fit(picked, itemIds, target, opt, priors);
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

  function describeItems(present, prices, interval, stats, priors, dataOnly, hasPriors) {
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
      var prior = Number(priors[id]);
      var hasPrior = isFinite(prior) && prior > 0;
      var occ = stats.occurrences[id] || 0;
      var relWidth = null;
      if (band && price > 0) relWidth = (band.high - band.low) / price;

      // 參考值把答案拉動了多少。接近 0 代表結論是資料自己撐起來的。
      var pull = null;
      if (hasPriors && hasPrior && dataOnly[id] !== undefined) {
        var base = Math.max(price, dataOnly[id]);
        pull = base > 0 ? Math.abs(price - dataOnly[id]) / base : 0;
      }
      out.push({
        id: id,
        label: WR_CATALOG.labelOf(id),
        group: (WR_CATALOG.get(id) || {}).group || 'other',
        price: price,
        prior: hasPrior ? prior : null,
        dataOnlyPrice: hasPriors && dataOnly[id] !== undefined ? dataOnly[id] : null,
        priorPull: pull,
        low: band ? band.low : null,
        high: band ? band.high : null,
        relativeWidth: relWidth,
        occurrences: occ,
        totalQty: stats.totalQty[id] || 0,
        share: grandTotal > 0 ? contribution[id] / grandTotal : 0,
        confidence: confidenceOf(occ, relWidth, price)
      });
    }
    out.sort(function (a, b) { return b.share - a.share; });
    return out;
  }

  /**
   * 信心度看兩件事：這個物品出現在幾包裡（資料量），
   * 以及重抽區間相對於點估計有多寬（穩定度）。
   */
  function confidenceOf(occurrences, relWidth, price) {
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

  function countPriors(priors, ids) {
    if (!priors) return 0;
    var c = 0;
    for (var i = 0; i < ids.length; i++) {
      var v = Number(priors[ids[i]]);
      if (isFinite(v) && v > 0) c++;
    }
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
