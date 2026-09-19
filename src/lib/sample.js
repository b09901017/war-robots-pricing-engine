/**
 * 範例禮包。
 *
 * 這些數字是為了示範而編的，不是 War Robots 真實的商城定價 ——
 * 用途是讓你在還沒開始記錄之前，就能看到引擎在「資料夠多、物品有重疊」
 * 的情況下長什麼樣子。試用完請直接刪掉整個「禮包」工作表的內容。
 *
 * 作法：先假設一組基準單價，再由內容物反推售價、加上 ±4% 的定價雜訊、
 * 四捨五入到整十元。這樣產生的資料跟真實商城一樣「大致一致但不完全一致」，
 * 引擎解出來的結果才會是有意義的示範。
 */
var WR_SAMPLE = (function () {
  'use strict';

  var TRUTH = {
    ag: 0.0000022, au: 0.035, pt: 0.0011, key: 0.0022,
    cell: 0.55, module: 22, chip: 0.0125, pilotchip: 0.075, uptoken: 0.32,
    dc_basic_ag: 3.2, dc_basic_au: 9, dc_weapon_ag: 6, dc_weapon_au: 18,
    dc_bot_ag: 8, dc_bot_au: 26, dc_titan: 95,
    dc_newbot_ag: 22, dc_newbot_au: 62, dc_ultimate: 210
  };

  var SPECS = [
    ['微晶片小包', { chip: 3200, ag: 300000 }],
    ['金幣補給', { au: 2500, ag: 500000 }],
    ['週末特惠', { au: 3000, pt: 40000, key: 20000 }],
    ['強化材料包', { chip: 12800, cell: 250, uptoken: 500 }],
    ['資料卡入門', { dc_basic_au: 5, dc_basic_ag: 8, dc_weapon_ag: 10, au: 1000 }],
    ['機師養成', { pilotchip: 5000, au: 4000, ag: 1000000 }],
    ['鑰匙補充', { key: 12000, ag: 150000 }],
    ['銀幣補給', { ag: 15000000 }],
    ['電池箱', { cell: 120, uptoken: 200, chip: 3200 }],
    ['泰坦禮包', { dc_titan: 2, au: 6000, module: 3 }],
    ['白金大包', { pt: 180000, au: 2000, key: 30000 }],
    ['機器人資料卡包', { dc_bot_au: 4, dc_bot_ag: 8, dc_weapon_ag: 6, chip: 6400 }],
    ['旗艦組合', { dc_ultimate: 1, dc_bot_au: 3, dc_weapon_au: 2, dc_titan: 1, dc_newbot_au: 1, au: 8000, pt: 100000, chip: 25600 }],
    ['新機首發包', { dc_newbot_au: 3, dc_newbot_ag: 6, dc_basic_au: 4, dc_bot_ag: 5, au: 5000 }],
    ['銀幣大禮包', { ag: 2500000, uptoken: 300 }],
    ['模塊補給', { module: 5, cell: 300, pt: 50000 }],
    ['武器強化包', { dc_weapon_au: 3, dc_weapon_ag: 12, dc_basic_ag: 6, chip: 6400, cell: 100 }],
    ['機師精英包', { pilotchip: 10000, dc_basic_ag: 10, au: 2500 }],
    ['每日超值', { au: 1000, ag: 200000, key: 8000, pilotchip: 1200 }],
    ['泰坦資料卡包', { dc_titan: 3, dc_basic_au: 8, dc_bot_ag: 4, dc_newbot_ag: 2, pt: 60000 }],
    ['終極禮包', { dc_ultimate: 2, dc_newbot_au: 2, dc_newbot_ag: 3, dc_weapon_au: 3, dc_bot_au: 2, module: 4, au: 10000 }],
    ['終極典藏', { dc_ultimate: 3, au: 5000, pt: 80000 }],
    ['資料卡週包', { dc_basic_ag: 12, dc_weapon_ag: 8, dc_bot_ag: 6, au: 1500 }],
    ['高級資料卡包', { dc_basic_au: 6, dc_weapon_au: 4, dc_bot_au: 3, pt: 40000 }]
  ];

  /** 產生範例禮包。日期從 endDate 往回推，看起來像連續幾個月的紀錄。 */
  function bundles(endDate) {
    var rand = WR_LINALG.rng(20260919);
    var end = endDate ? new Date(endDate) : new Date();
    var out = [];
    for (var i = 0; i < SPECS.length; i++) {
      var name = SPECS[i][0];
      var qty = SPECS[i][1];
      var value = 0;
      for (var id in qty) {
        if (Object.prototype.hasOwnProperty.call(qty, id)) value += qty[id] * TRUTH[id];
      }
      var noisy = value * (0.96 + rand() * 0.08);
      // 不設價格下限：硬把一包便宜東西抬到某個最低價，等於憑空造出一筆
      // 十幾倍的定價錯誤，整組範例資料就毀了。
      var price = noisy >= 100 ? Math.round(noisy / 10) * 10 : Math.round(noisy);
      var d = new Date(end.getTime() - (SPECS.length - 1 - i) * 5 * 86400000);
      out.push({
        name: '【範例】' + name,
        price: price,
        qty: qty,
        date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
        enabled: true,
        note: '範例資料，可直接刪除'
      });
    }
    return out;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  return { TRUTH: TRUTH, bundles: bundles };
})();
