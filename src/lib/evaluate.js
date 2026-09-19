/**
 * 禮包性價比試算。
 *
 * 性價比指數 = 理論價值 / 售價。理論價值由當前解出的基準單價算出。
 *
 * 「正常行情」的寬度不是拍腦袋訂的，而是跟著模型自己的擬合誤差走：
 * 如果模型連歷史禮包都有 15% 的平均誤差，那 1.10 倍就根本分辨不出
 * 到底是划算還是雜訊，不該說它超值。
 */
var WR_EVAL = (function () {
  'use strict';

  var TIERS = [
    { id: 'great', label: '超值', tone: 'good', blurb: '明顯高於你記錄過的行情' },
    { id: 'good', label: '划算', tone: 'good', blurb: '比行情好一些' },
    { id: 'fair', label: '正常行情', tone: 'neutral', blurb: '跟你記錄過的禮包差不多' },
    { id: 'poor', label: '偏貴', tone: 'warning', blurb: '比行情差一些' },
    { id: 'bad', label: '很貴', tone: 'critical', blurb: '明顯低於你記錄過的行情' }
  ];

  var TIER_BY_ID = {};
  for (var t = 0; t < TIERS.length; t++) TIER_BY_ID[TIERS[t].id] = TIERS[t];

  /**
   * @param {{qty: Object, price: number}} candidate 要評估的組合包
   * @param {Object} model WR_SOLVER.solve() 的輸出
   */
  function evaluate(candidate, model) {
    var price = Number(candidate.price);
    var qty = candidate.qty || {};
    var prices = (model && model.prices) || {};
    var itemInfo = {};
    var list = (model && model.items) || [];
    for (var i = 0; i < list.length; i++) itemInfo[list[i].id] = list[i];

    var contributions = [];
    var value = 0;
    var unpriced = [];
    var confidentValue = 0;

    for (var id in qty) {
      if (!Object.prototype.hasOwnProperty.call(qty, id)) continue;
      var q = Number(qty[id]);
      if (!isFinite(q) || q <= 0) continue;
      var unit = prices[id];
      var info = itemInfo[id];
      if (unit === undefined || info === undefined || info.occurrences === 0) {
        unpriced.push({ id: id, label: WR_CATALOG.labelOf(id), qty: q });
        continue;
      }
      var v = q * unit;
      value += v;
      if (info.confidence === 'high' || info.confidence === 'locked') confidentValue += v;
      contributions.push({
        id: id,
        label: WR_CATALOG.labelOf(id),
        group: info.group,
        qty: q,
        unitPrice: unit,
        value: v,
        confidence: info.confidence,
        low: info.low === null || info.low === undefined ? null : q * info.low,
        high: info.high === null || info.high === undefined ? null : q * info.high
      });
    }

    contributions.sort(function (a, b) { return b.value - a.value; });
    for (i = 0; i < contributions.length; i++) {
      contributions[i].share = value > 0 ? contributions[i].value / value : 0;
    }

    var ratio = isFinite(price) && price > 0 ? value / price : null;
    var band = normalBand(model);
    var tier = ratio === null ? null : tierFor(ratio, band);
    var range = ratioRange(qty, price, model);
    var rank = rankAmong(ratio, model);

    return {
      price: isFinite(price) ? price : null,
      value: value,
      ratio: ratio,
      ratioLow: range ? range.low : null,
      ratioHigh: range ? range.high : null,
      tier: tier,
      band: band,
      contributions: contributions,
      unpriced: unpriced,
      /** 理論價值裡有多少比例是由高信心（或已鎖定）的單價撐起來的 */
      confidenceCoverage: value > 0 ? confidentValue / value : 0,
      rank: rank,
      /** 在目前模型下，這包「應該」賣多少錢才算正常行情 */
      fairPrice: value
    };
  }

  /** 正常行情的半寬：跟著模型的平均絕對百分誤差走，夾在 6% ~ 25% 之間。 */
  function normalBand(model) {
    var mape = model && model.fit ? model.fit.mape : null;
    if (mape === null || mape === undefined || !isFinite(mape)) return 0.12;
    return Math.max(0.06, Math.min(0.25, mape));
  }

  function tierFor(ratio, band) {
    if (ratio >= 1 + 2 * band) return TIER_BY_ID.great;
    if (ratio >= 1 + band) return TIER_BY_ID.good;
    if (ratio > 1 - band) return TIER_BY_ID.fair;
    if (ratio > 1 - 2 * band) return TIER_BY_ID.poor;
    return TIER_BY_ID.bad;
  }

  /** 用 bootstrap 的每一輪抽樣重算一次性價比，得到指數本身的可能區間。 */
  function ratioRange(qty, price, model) {
    if (!model || !model.draws || !isFinite(price) || price <= 0) return null;
    var ids = model.draws.itemIds;
    var values = model.draws.values;
    if (!values || values.length === 0) return null;

    var index = {};
    for (var j = 0; j < ids.length; j++) index[ids[j]] = j;

    // 鎖定的、或沒進 bootstrap 的物品，在每一輪都用點估計當常數。
    var constant = 0;
    var dynamic = [];
    for (var id in qty) {
      if (!Object.prototype.hasOwnProperty.call(qty, id)) continue;
      var q = Number(qty[id]);
      if (!isFinite(q) || q <= 0) continue;
      var unit = model.prices[id];
      if (unit === undefined) continue;
      if (index[id] === undefined) {
        constant += q * unit;
      } else {
        dynamic.push({ col: index[id], qty: q, fallback: unit });
      }
    }
    if (dynamic.length === 0) return null;

    var ratios = [];
    for (var s = 0; s < values.length; s++) {
      var draw = values[s];
      var v = constant;
      for (var k = 0; k < dynamic.length; k++) {
        var d = dynamic[k];
        var est = draw[d.col];
        v += d.qty * (est === null || est === undefined || !isFinite(est) ? d.fallback : est);
      }
      ratios.push(v / price);
    }
    ratios.sort(function (a, b) { return a - b; });
    var interval = (model.options && model.options.interval) || 0.8;
    var lo = (1 - interval) / 2;
    return {
      low: WR_LINALG.percentile(ratios, lo),
      high: WR_LINALG.percentile(ratios, 1 - lo)
    };
  }

  /** 這個性價比在歷史禮包裡排第幾？讓「超值」有個具體的比較基準。 */
  function rankAmong(ratio, model) {
    if (ratio === null || !model || !model.fit || !model.fit.predictions) return null;
    var preds = model.fit.predictions;
    if (preds.length < 3) return null;
    var better = 0;
    for (var i = 0; i < preds.length; i++) {
      if (ratio > preds[i].ratio) better++;
    }
    return {
      total: preds.length,
      beats: better,
      percentile: better / preds.length
    };
  }

  return {
    TIERS: TIERS,
    evaluate: evaluate,
    normalBand: normalBand,
    tierFor: tierFor
  };
})();
