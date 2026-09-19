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
 *    欄位量級差了六個數量級，不正規化的話數值上根本解不動。
 *
 * 3. 不確定性 —— 只出現在一兩包裡的稀有物品，點估計幾乎沒有意義，
 *    一定要給區間。
 *
 * ── 三種解法 ──────────────────────────────────────────────
 *
 * ls      最小平方。教科書解，誤差平方，所以一筆打錯的資料影響力極大。
 * robust  穩健回歸（Huber + IRLS）。偏離太遠的禮包會被自動降權，
 *         打錯的數字和「真的超級促銷」都不會再把整張看板拉歪。
 * bayes   完整貝氏（Gibbs 抽樣截斷多元常態）。點估計跟 ls 幾乎一樣，
 *         真正的差別在區間：共線時它會誠實地給出很寬的區間，
 *         而 bootstrap 在同樣情況下會給出假的窄區間。
 */
var WR_SOLVER = (function () {
  'use strict';

  var DEFAULTS = {
    /** 'ls' | 'robust' | 'bayes'，見檔頭說明。 */
    method: 'robust',
    /**
     * Tukey bisquare 的截斷點，單位是「幾倍的典型誤差」。
     * 超過這個距離的禮包權重直接歸零 —— 用 Huber 的話影響力只是線性遞減，
     * 永遠壓不完，一筆少打一個 0 的資料仍然會把答案拉走。
     * 4.685 是對常態雜訊保留 95% 效率的標準值。
     */
    tukeyC: 4.685,
    /** IRLS 重新加權的最多輪數。權重不再變動就提早收工。 */
    robustIters: 6,
    /** 典型誤差的下限（相對值）。資料太乾淨時避免除以接近 0 的尺度。 */
    minScale: 0.01,
    /**
     * 先做一輪「逐筆剔除」篩檢再開始 IRLS。
     *
     * 這一步是必要的，不是保險。重新加權法對「售價打錯」很有效，但對
     * 「數量特別大、又剛好打錯」無效 —— 那種禮包的槓桿足以把整條迴歸線
     * 拉到自己身上，於是它的殘差變得很小，反而是其他誠實的禮包看起來像離群值。
     * 逐筆剔除讓每一筆禮包由「不含它自己」的模型來評斷，它就再也遮掩不了自己。
     */
    screenOutliers: true,
    /** 超過這麼多筆就跳過篩檢：成本是 O(筆數²)，而且筆數一多，單筆的槓桿本來就被稀釋了。 */
    screenMax: 80,
    /**
     * 拿掉某筆禮包之後，它的內容物至少要還剩這麼多有效觀測次數，
     * 剩下的資料才有資格評斷它。低於這個數就跳過篩檢、給滿權重。
     */
    screenMinEffObs: 2,
    /**
     * 篩檢階段只抓「大錯」：逐筆剔除後的偏離要超過這個比例才算數。
     *
     * 這條線把兩件事分開：
     *   篩檢   專抓少打一個 0 這種等級的錯（偏離動輒 900%）
     *   IRLS   處理一般的離群（促銷、模型本身的誤差），用正常的 MAD 門檻
     *
     * 沒有這條線的話，篩檢會把「剛好是唯一釘住某物品的那一筆」也殺掉：
     * 那種列拿掉之後解本來就會動幾個百分點，在乾淨到沒有雜訊的資料裡，
     * 6.8% 的偏離相對於其他列的 0.2% 看起來就像離群值，但它其實完全正確。
     */
    screenMinResidual: 0.5,

    /**
     * 單品禮包若被另一筆更便宜的同物品單品禮包全面壓過，就不納入求解。
     *
     * 「1000 白金 100 元」和「1500 白金 130 元」同時存在時，前者不是行情，
     * 它只是一個沒有人會買的選項。把它算進去只會把白金的基準單價往上拉。
     * 只有純單品才適用 —— 組合包的單價沒有被直接觀測到，不能這樣比較。
     */
    dropDominatedSingles: true,
    /**
     * 要貴多少才算「被壓過」。兩個報價只差 1%～2% 的話那是湊整數的結果，
     * 不是真的比較差的選項，兩筆都該留著當觀測。
     */
    dominateMargin: 0.02,
    /**
     * 售價與內容物都一模一樣的兩筆，合併成一次觀測。
     * 重複的紀錄是同一條方程式，放兩次等於無中生有多了一份證據。
     */
    mergeDuplicates: true,
    /** 每單位價格超過同物品中位數的幾倍就視為可疑（很可能是打錯）。 */
    outlierRatio: 1.5,

    /**
     * 參考值的份量，單位是「相當於幾次觀測」。拉力正好是 份量/(觀測次數+份量)。
     */
    priorWeight: 1,
    /**
     * 參考值是否在資料足夠後自動退場。判準是「有效觀測次數」而不是「出現過幾包」：
     * 共線不會因為筆數變多而消失，金幣與銀幣就算記了 30 包、只要每包都綁在一起，
     * 資料仍然分不出誰值多少。
     */
    retirePriors: true,
    retireAt: 4,
    /** 純粹避免矩陣退化的最小正則化。 */
    ridgeFloor: 0.01,
    relativeWeighting: true,
    bootstrap: true,
    samples: 240,
    interval: 0.8,         // 80% 區間：比 95% 窄，對「這包值不值」這種決策更實用
    seed: 1337,            // 固定種子，資料沒變時區間就不會自己跳動

    /* 只有 method: 'bayes' 會用到 */
    burnIn: 300,           // 前面這幾輪丟掉，等鏈走進後驗的主體
    thin: 2                // 每隔幾輪取一個樣本，降低相鄰樣本的相關性
    // priors: {物品id: 每單位參考單價} —— 正則化的錨點，不是鎖定值
  };

  var METHODS = [
    { id: 'ls', label: '最小平方', blurb: '教科書解法。所有禮包一視同仁，一筆打錯的資料會被平方放大。' },
    { id: 'robust', label: '穩健回歸', blurb: '偏離太遠的禮包自動降權。辨識錯誤和超級促銷都不會把行情拉歪。' },
    { id: 'bayes', label: '完整貝氏', blurb: '點估計跟最小平方差不多，但區間是誠實的：資料分不出來時它就會說分不出來。' }
  ];

  function methodInfo(id) {
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i].id === id) return METHODS[i];
    return METHODS[1];
  }

  function solve(bundles, options) {
    var opt = merge(DEFAULTS, options || {});
    var method = normalizeMethod(opt.method);
    var priors = opt.priors || {};
    var i, j;

    var all = [];
    for (i = 0; i < bundles.length; i++) {
      var bd = bundles[i];
      if (bd.enabled === false) continue;
      var price = Number(bd.price);
      if (!isFinite(price) || price <= 0) continue;
      var qty = normalizeQty(bd.qty);
      if (totalOf(qty) <= 0) continue;
      all.push({ id: bd.id, name: bd.name, price: price, qty: qty });
    }

    // 完全相同的兩筆是同一條方程式，合併成一次觀測。
    var dedup = opt.mergeDuplicates ? mergeDuplicates(all) : { rows: all, merged: [] };
    all = dedup.rows;

    // 被更便宜的同物品單品壓過的那些，先拿掉再求解。
    var dom = opt.dropDominatedSingles ? dominatedSingles(all, opt.dominateMargin) : { rows: all, excluded: [] };
    var rows = dom.rows;
    var excluded = dom.excluded;

    var stats = itemStats(rows);
    var solveIds = stats.present;
    var warnings = [];

    var target = [];
    for (i = 0; i < rows.length; i++) target.push(rows[i].price);

    // 有效觀測次數：物品彼此正交時就等於出現包數，一旦共線就大幅下降。
    // 這是判斷「資料到底有沒有定住這個物品」唯一可靠的訊號。
    var effObs = effectiveObservations(rows, solveIds, opt);

    /*
     * 有參考值時先解一次「完全不看參考值」的版本，它有兩個用途：
     *   1. 判斷哪些物品光靠資料就已經夠了 —— 那些的參考值直接退場
     *   2. 拿來跟最終結果比對，算出參考值實際把答案拉動了多少
     */
    var givenPriors = countPriors(priors, solveIds) > 0;
    var dataOnly = {};
    var retired = {};
    var activePriors = {};

    if (givenPriors && rows.length > 0) {
      var bare = estimate(rows, solveIds, target, opt, null, method === 'bayes' ? 'ls' : method).prices;
      for (i = 0; i < solveIds.length; i++) dataOnly[solveIds[i]] = bare[i];

      for (i = 0; i < solveIds.length; i++) {
        var pid = solveIds[i];
        var pv = Number(priors[pid]);
        if (!(isFinite(pv) && pv > 0)) continue;
        if (opt.retirePriors && effObs[i] >= opt.retireAt) retired[pid] = true;
        else activePriors[pid] = pv;
      }
    }

    var main = estimate(rows, solveIds, target, opt, activePriors, method);
    var point = main.prices;
    var prices = {};
    for (i = 0; i < solveIds.length; i++) prices[solveIds[i]] = point[i];

    var hasPriors = countPriors(activePriors, solveIds) > 0;

    /*
     * 區間的來源依方法而定：
     *   bayes —— 後驗抽樣本身就是區間，不需要 bootstrap
     *   其他  —— 重抽禮包重解，用分位數
     * 兩者都整理成同一個 draws 結構，上層（性價比區間）因此完全不必分辨。
     */
    var interval = null;
    var draws = null;
    if (main.draws) {
      interval = intervalFrom(main.draws, solveIds, opt, point);
      draws = { itemIds: solveIds, values: main.draws, source: 'posterior' };
    } else if (opt.bootstrap && rows.length >= 3 && solveIds.length > 0) {
      var boot = bootstrap(rows, solveIds, activePriors, opt, main.rowWeights);
      interval = intervalFrom(boot, solveIds, opt, point);
      draws = { itemIds: solveIds, values: boot, source: 'bootstrap' };
    }

    var suspects = unitPriceOutliers(bundles, opt.outlierRatio);
    var diagnostics = fitQuality(rows, prices, main.rowWeights, excluded, solveIds.length);
    var items = describeItems(solveIds, prices, interval, stats, priors, retired, dataOnly, hasPriors, effObs);

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

    if (dedup.merged.length) {
      warnings.push({
        level: 'info',
        code: 'merged',
        text: '有 ' + dedup.merged.length + ' 筆禮包跟另一筆完全相同（售價與內容物都一樣），' +
          '已合併成一次觀測 —— 同一條方程式放兩次會讓它的份量變兩倍。'
      });
    }

    if (excluded.length) {
      warnings.push({
        level: 'info',
        code: 'dominated',
        text: '有 ' + excluded.length + ' 筆單品禮包被更便宜的同物品單品壓過，沒有納入計算（紀錄仍然留著）。' +
          '基準單價因此代表「你買得到的最好價格」，不是平均行情。'
      });
    }

    if (suspects.length) {
      warnings.push({
        level: 'warn',
        code: 'suspect-entry',
        text: '有 ' + suspects.length + ' 筆單品禮包的每單位價格明顯高於同物品的其他筆，' +
          '比較可能是輸入或辨識打錯了。到「禮包」分頁看一下就知道。'
      });
    }

    if (rows.length > 0 && diagnostics.dof !== null && diagnostics.dof < 3) {
      warnings.push({
        level: 'warn',
        code: 'no-dof',
        text: diagnostics.dof <= 0
          ? '待解物品有 ' + solveIds.length + ' 種，納入計算的禮包只有 ' + rows.length + ' 筆 —— 未知數跟方程式一樣多，' +
            '解一定會完美通過每一個點。此時的「平均誤差」不代表模型準，只代表它還沒被考驗過。'
          : '納入計算的禮包只比待解物品多 ' + diagnostics.dof + ' 筆，擬合誤差還不太能當作模型好壞的證據。'
      });
    }

    var downweighted = [];
    var bargains = 0;
    if (main.rowWeights) {
      for (i = 0; i < rows.length; i++) {
        if (main.rowWeights[i] >= 0.75) continue;
        var predicted = predictPrice(rows[i].qty, prices);
        var better = predicted > rows[i].price;
        if (better) bargains++;
        downweighted.push({
          id: rows[i].id, name: rows[i].name, weight: main.rowWeights[i], better: better
        });
      }
    }
    if (downweighted.length) {
      // 降權有兩個方向，對使用者的意義完全不同：比行情好太多的是好貨，
      // 比行情差太多的才需要回頭檢查是不是打錯了。混在一起講會讓人誤以為資料有問題。
      var parts = [];
      if (bargains) parts.push(bargains + ' 筆划算得超出行情');
      if (downweighted.length - bargains) parts.push((downweighted.length - bargains) + ' 筆比行情貴得多');
      warnings.push({
        level: 'info',
        code: 'downweighted',
        text: '有 ' + downweighted.length + ' 筆禮包偏離行情太遠（' + parts.join('、') +
          '），沒有拿去決定一般行情（紀錄仍然完整保留）。'
      });
    }

    return {
      method: method,
      methodLabel: methodInfo(method).label,
      bundleCount: rows.length,
      excludedCount: excluded.length,
      excluded: excluded,
      mergedCount: dedup.merged.length,
      merged: dedup.merged,
      suspects: suspects,
      downweighted: downweighted,
      solvedCount: solveIds.length,
      priorCount: countPriors(activePriors, solveIds),
      priorRetiredCount: countKeys(retired),
      items: items,
      prices: prices,
      fit: diagnostics,
      draws: draws,
      warnings: warnings,
      options: {
        method: method, priorWeight: opt.priorWeight, relativeWeighting: opt.relativeWeighting,
        samples: opt.samples, interval: opt.interval
      }
    };
  }

  function normalizeMethod(m) {
    return (m === 'ls' || m === 'bayes' || m === 'robust') ? m : 'robust';
  }

  /* ==================================================================
     單品支配：同一個物品的純單品禮包只留最便宜的那一筆
     ================================================================== */

  /**
   * 回傳 { rows: 實際拿去解的列, excluded: 被拿掉的列與原因 }。
   *
   * 只看「內容物剛好一種」的禮包，因為只有那種的單價是被直接觀測到的。
   * 組合包的售價是好幾個未知數的和，兩包之間沒有可以直接比較的單價。
   */
  function dominatedSingles(rows, margin) {
    var best = {};      // 物品id -> { row, unit }
    var i;
    if (!(margin >= 0)) margin = 0;
    for (i = 0; i < rows.length; i++) {
      var single = onlyItem(rows[i].qty);
      if (!single) continue;
      var unit = rows[i].price / rows[i].qty[single];
      if (!best[single] || unit < best[single].unit) best[single] = { row: rows[i], unit: unit };
    }

    var kept = [];
    var excluded = [];
    for (i = 0; i < rows.length; i++) {
      var id = onlyItem(rows[i].qty);
      if (!id) { kept.push(rows[i]); continue; }
      var b = best[id];
      if (b.row === rows[i]) { kept.push(rows[i]); continue; }
      var myUnit = rows[i].price / rows[i].qty[id];
      // 只差一點點的不算被壓過 —— 那是湊整數的結果，兩筆都是一致的觀測。
      if (myUnit <= b.unit * (1 + margin)) { kept.push(rows[i]); continue; }
      excluded.push({
        id: rows[i].id,
        name: rows[i].name,
        itemId: id,
        itemLabel: WR_CATALOG.labelOf(id),
        unitPrice: myUnit,
        bestId: b.row.id,
        bestName: b.row.name,
        bestUnitPrice: b.unit,
        overpay: myUnit / b.unit - 1
      });
    }
    return { rows: kept, excluded: excluded };
  }

  /* ==================================================================
     完全重複的禮包
     ================================================================== */

  /**
   * 售價與內容物都一模一樣的兩筆，合併成一次觀測。
   *
   * 這不是潔癖，是正確性問題：兩筆一模一樣的紀錄在數學上是**同一條方程式**，
   * 重複放進去只會讓它的權重變成兩倍，等於無中生有多了一份證據。連帶
   * 「出現在幾包」與「有效觀測次數」也會虛胖，看板上的信心度因此高估。
   *
   * 同一個禮包在商城的不同分頁各出現一次，是很常見的記錄方式，
   * 但那是同一個報價被看到兩次，不是兩次獨立的觀測。
   *
   * 日期不納入比對：售價完全相同的話，它就不是「再量一次」而是同一個報價。
   */
  function mergeDuplicates(rows) {
    var seen = {};
    var kept = [];
    var merged = [];
    for (var i = 0; i < rows.length; i++) {
      var key = duplicateKey(rows[i]);
      var at = seen[key];
      if (at === undefined) {
        seen[key] = kept.length;
        kept.push(rows[i]);
        continue;
      }
      var first = kept[at];
      merged.push({
        id: rows[i].id,
        name: rows[i].name,
        keptId: first.id,
        keptName: first.name,
        price: rows[i].price
      });
    }
    return { rows: kept, merged: merged };
  }

  function duplicateKey(row) {
    var ids = [];
    for (var id in row.qty) {
      if (Object.prototype.hasOwnProperty.call(row.qty, id) && row.qty[id] > 0) ids.push(id);
    }
    ids.sort();
    var parts = [];
    for (var i = 0; i < ids.length; i++) parts.push(ids[i] + ':' + row.qty[ids[i]]);
    return row.price + '|' + parts.join(',');
  }

  /**
   * 給介面用：把原始禮包清單裡完全重複的分組回傳，好讓使用者一次清掉多餘的。
   * 跟引擎內部用的是同一套判準，所以畫面上看到的跟實際被合併的一定一致。
   */
  function duplicateGroups(bundles) {
    var groups = {};
    var order = [];
    for (var i = 0; i < bundles.length; i++) {
      var bd = bundles[i];
      if (bd.enabled === false) continue;
      var price = Number(bd.price);
      if (!isFinite(price) || price <= 0) continue;
      var qty = normalizeQty(bd.qty);
      if (totalOf(qty) <= 0) continue;
      var key = duplicateKey({ price: price, qty: qty });
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(bd);
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      var list = groups[order[i]];
      if (list.length < 2) continue;
      out.push({ keep: list[0], drop: list.slice(1) });
    }
    return out;
  }

  /**
   * 資料健檢：找出「同一物品的單品包裡，每單位價格明顯不合群」的那幾筆。
   *
   * 跟單品支配是兩件事。支配規則問的是「哪個最便宜」，這裡問的是
   * 「哪一筆離大家太遠，遠到比較可能是打錯而不是真的行情」。
   *
   * 為什麼這個檢查特別有用：資料主要來自 AI 看截圖辨識，最常見的錯就是
   * 數量少看一位。而同一種資料卡不論幾張一包，每張的價格其實非常一致
   * （實測武器銀卡八筆裡有六筆剛好都是 6.60 元），所以一筆 14.14 元
   * 幾乎不可能是真的 —— 何況同一批資料裡就有一筆同價位的正確版本。
   *
   * 用中位數當基準，不用平均：平均會被離群值自己拉高，然後它就不離群了。
   */
  function unitPriceOutliers(bundles, ratio) {
    if (!(ratio > 1)) ratio = 1.5;
    var groups = {};
    var i;
    for (i = 0; i < bundles.length; i++) {
      var bd = bundles[i];
      if (bd.enabled === false) continue;
      var price = Number(bd.price);
      if (!isFinite(price) || price <= 0) continue;
      var qty = normalizeQty(bd.qty);
      var only = onlyItem(qty);
      if (!only) continue;
      (groups[only] = groups[only] || []).push({
        id: bd.id, name: bd.name, qty: qty[only], price: price, unitPrice: price / qty[only]
      });
    }

    var out = [];
    for (var itemId in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, itemId)) continue;
      var list = groups[itemId];
      // 少於三筆就沒有「大家」可言，兩筆不一致無從判斷誰才是對的。
      if (list.length < 3) continue;
      var units = [];
      for (i = 0; i < list.length; i++) units.push(list[i].unitPrice);
      var med = WR_LINALG.median(units);
      if (!(med > 0)) continue;
      for (i = 0; i < list.length; i++) {
        var r = list[i].unitPrice / med;
        if (r <= ratio) continue;
        out.push({
          id: list[i].id,
          name: list[i].name,
          itemId: itemId,
          itemLabel: WR_CATALOG.labelOf(itemId),
          qty: list[i].qty,
          price: list[i].price,
          unitPrice: list[i].unitPrice,
          median: med,
          ratio: r,
          samples: list.length
        });
      }
    }
    out.sort(function (a, b) { return b.ratio - a.ratio; });
    return out;
  }

  /** 內容物剛好一種時回傳那個物品 id，否則 null。 */
  function onlyItem(qty) {
    var found = null;
    for (var id in qty) {
      if (!Object.prototype.hasOwnProperty.call(qty, id)) continue;
      if (!(qty[id] > 0)) continue;
      if (found) return null;
      found = id;
    }
    return found;
  }

  /* ==================================================================
     求解
     ================================================================== */

  /**
   * 依方法求一次解。
   * 回傳 { prices: 陣列, rowWeights: 陣列|null, draws: 陣列的陣列|null }。
   */
  function estimate(rows, itemIds, target, opt, priors, method) {
    if (rows.length === 0 || itemIds.length === 0) {
      return { prices: WR_LINALG.zeros(itemIds.length), rowWeights: null, draws: null };
    }
    if (method === 'ls') {
      return { prices: fit(rows, itemIds, target, opt, priors), rowWeights: null, draws: null };
    }
    if (method === 'bayes') {
      return gibbs(rows, itemIds, target, opt, priors);
    }
    return irls(rows, itemIds, target, opt, priors);
  }

  /**
   * 建立求解用的設計矩陣，把加權與縮放都做完。
   *
   * robustW 是每一列額外的穩健權重（Huber）。權重作用在「殘差平方」上，
   * 所以放進矩陣時要開根號。
   */
  function design(rows, itemIds, target, opt, priors, robustW) {
    var m = rows.length;
    var n = itemIds.length;
    if (m === 0 || n === 0) return null;
    var i, j;

    var meanPrice = 0;
    for (i = 0; i < m; i++) meanPrice += rows[i].price;
    meanPrice = meanPrice / m;

    var weights = new Array(m);
    for (i = 0; i < m; i++) {
      var base = opt.relativeWeighting ? 1 / rows[i].price : 1 / meanPrice;
      weights[i] = base * (robustW ? Math.sqrt(robustW[i]) : 1);
    }

    var A = new Array(m);
    for (i = 0; i < m; i++) {
      var row = new Array(n);
      var q = rows[i].qty;
      for (j = 0; j < n; j++) row[j] = (q[itemIds[j]] || 0) * weights[i];
      A[i] = row;
    }

    /*
     * 欄位縮放用「該物品出現過的那幾列」的均方根，而不是整欄的長度。
     * 這樣縮放後 G 的對角線正好等於該物品被觀測到的次數（不論加了什麼權重，
     * 因為分子分母同時被權重縮放），於是正則化的係數就有了明確的單位：
     * λ = 2 就是「參考值相當於兩次觀測」。
     */
    var colNorm = new Array(n);
    for (j = 0; j < n; j++) {
      var sq = 0;
      var k = 0;
      for (i = 0; i < m; i++) {
        if (A[i][j] !== 0) { sq += A[i][j] * A[i][j]; k++; }
      }
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
    if (!(bNorm > 0)) return null;
    for (i = 0; i < m; i++) b[i] /= bNorm;

    // 參考值要換到同一個縮放座標系，否則錨點會落在完全不同的位置。
    var prior = null;
    var ridge = new Array(n);
    for (j = 0; j < n; j++) {
      var pv = priors ? Number(priors[itemIds[j]]) : NaN;
      var hasPrior = isFinite(pv) && pv > 0 && colNorm[j] > 0;
      if (hasPrior) {
        if (!prior) prior = WR_LINALG.zeros(n);
        prior[j] = (pv * colNorm[j]) / bNorm;
      }
      ridge[j] = hasPrior ? opt.priorWeight : opt.ridgeFloor;
    }

    return { A: A, b: b, colNorm: colNorm, bNorm: bNorm, prior: prior, ridge: ridge, m: m, n: n };
  }

  function unscale(z, d) {
    var out = new Array(d.n);
    for (var j = 0; j < d.n; j++) {
      out[j] = d.colNorm[j] > 0 ? (z[j] * d.bNorm) / d.colNorm[j] : 0;
    }
    return out;
  }

  /** 單次求解：加權 → 欄位正規化 → NNLS → 還原尺度。回傳與 itemIds 同序的單價陣列。 */
  function fit(rows, itemIds, target, opt, priors, robustW) {
    var d = design(rows, itemIds, target, opt, priors, robustW);
    if (!d) return WR_LINALG.zeros(itemIds.length);
    return unscale(WR_LINALG.nnls(d.A, d.b, d.ridge, d.prior), d);
  }

  /* ==================================================================
     穩健回歸（Huber + IRLS）
     ================================================================== */

  /**
   * 兩段式穩健回歸。
   *
   * 第一段「逐筆剔除篩檢」：每一筆禮包都由**不含它自己**的模型來預測，
   * 看它偏離多遠。這是整個穩健化的關鍵 —— 少打一個 0 的那筆禮包通常
   * 數量也很大，槓桿足以把迴歸線拉到自己身上，於是它在一般的殘差裡
   * 看起來完全正常，反而是誠實的禮包被當成離群值。把它排除在評斷它的
   * 模型之外，它就遮掩不了自己了。
   *
   * 第二段 IRLS：用 Tukey bisquare 反覆重新加權到收斂。bisquare 會讓
   * 距離夠遠的禮包權重真的歸零，而不是像 Huber 那樣永遠留著線性的影響力。
   *
   * 兩段都用 MAD（中位數絕對離差）當尺度，而不是標準差 —— 用標準差的話，
   * 離群值自己就會把尺度撐大，於是它就不再算離群值了。
   */
  function irls(rows, itemIds, target, opt, priors) {
    var m = rows.length;
    var iters = Math.max(1, Math.min(20, opt.robustIters));
    var sole = soleSourceRows(rows);

    var w = null;
    if (opt.screenOutliers && m >= 6 && m <= opt.screenMax) {
      w = screenWeights(rows, itemIds, target, opt, priors, sole);
    }

    var x = fit(rows, itemIds, target, opt, priors, w);

    /*
     * 典型誤差只估這一次，之後整個 IRLS 過程固定不動。
     *
     * 這一行是整段穩健回歸裡最關鍵的一行。每輪重估尺度的話會塌掉：
     * 降權 → 殘差變小 → 尺度變小 → 門檻變嚴 → 更多列被降權 → 再循環。
     * 用真實的 96 筆資料實測，尺度會從 11% 一路掉到 1%，門檻從 51% 收到 5%，
     * 最後宣稱 62 筆裡有 17 筆是離群值 —— 包括只偏離 2% 的那些。
     *
     * 這是 redescending M-estimator 的已知性質，標準解法（MM 估計）就是
     * 尺度先定好、IRLS 過程中不再更新。MAD 本身對離群值免疫，所以拿
     * 初始擬合來估它是安全的。
     */
    var scale = madScale(residualsOf(rows, itemIds, target, x), opt);

    for (var it = 0; it < iters; it++) {
      var next = bisquareWeights(residualsOf(rows, itemIds, target, x), scale, opt, sole);
      if (w && maxDiff(w, next) < 1e-3) { w = next; break; }
      w = next;
      x = fit(rows, itemIds, target, opt, priors, w);
    }

    if (!w) {
      w = new Array(m);
      for (var i = 0; i < m; i++) w[i] = 1;
    }
    return { prices: x, rowWeights: w, draws: null };
  }

  /**
   * 逐筆剔除後的殘差，轉成權重。
   *
   * 只有「內容物在夠多別的禮包裡也出現過」的那些才評斷得了。
   *
   * 這個門檻不能鬆。商城裡大量的禮包是單品包，很多物品就只被一兩筆釘住；
   * 把那一筆拿掉之後，模型根本無從預測它的售價，算出來的巨大殘差反映的是
   * 資料稀少，不是這筆有問題。門檻放鬆的話，整批資料會互相把對方判成離群值，
   * 最後全部被降權到 0 —— 實測過，擬合誤差會從 0.8% 炸到 1000% 以上。
   *
   * 判準用的是**槓桿值** h_ii（迴歸理論裡的 hat 值），不是「出現過幾次」。
   * h_ii 逼近 1 代表這一列是某個方向上唯一的支撐 —— 拿掉它，剩下的模型
   * 根本無從預測它，算出來的巨大殘差反映的是資料稀少，不是這筆有問題。
   * 這不是理論上的顧慮：一筆「純銀幣包」在完美無雜訊的資料裡就被這樣誤殺過，
   * 而放寬成「出現過 3 次」這種計次判準完全抓不到（它出現了 5 次）。
   *
   * 反過來，一筆少打一個 0 的禮包槓桿值通常是中等的 —— 別的禮包對它有意見，
   * 只是被它的平方影響力壓過而已。所以這個門檻不會擋掉真正該抓的東西。
   */
  function screenWeights(rows, itemIds, target, opt, priors, sole) {
    var m = rows.length;
    var resid = new Array(m);
    var judged = [];
    var diag = rowDiagnostics(rows, itemIds, opt);

    for (var i = 0; i < m; i++) {
      if (sole[i] || diag[i].minEffObs < opt.screenMinEffObs) { resid[i] = null; continue; }
      var sub = [];
      var subT = [];
      for (var k = 0; k < m; k++) {
        if (k === i) continue;
        sub.push(rows[k]);
        subT.push(target[k]);
      }
      var x = fit(sub, itemIds, subT, opt, priors, null);
      var pred = predictWith(rows[i].qty, itemIds, x);
      resid[i] = (pred - target[i]) / target[i];
      judged.push(Math.abs(resid[i]));
    }
    if (judged.length < 4) return null;

    var w = bisquareWeights(resid, madScale(resid, opt), opt, sole);
    // 偏離還沒大到「明顯是打錯」的程度，就不在這一階段動它 —— 交給後面的 IRLS。
    for (i = 0; i < m; i++) {
      if (resid[i] !== null && Math.abs(resid[i]) < opt.screenMinResidual) w[i] = 1;
    }
    return w;
  }

  function residualsOf(rows, itemIds, target, x) {
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) {
      out[i] = (predictWith(rows[i].qty, itemIds, x) - target[i]) / target[i];
    }
    return out;
  }

  function predictWith(qty, itemIds, x) {
    var p = 0;
    for (var j = 0; j < itemIds.length; j++) {
      var q = qty[itemIds[j]];
      if (q) p += q * x[j];
    }
    return p;
  }

  /** 典型誤差：中位數絕對離差。用中位數而不是標準差，離群值才不會把尺度自己撐大。 */
  function madScale(resid, opt) {
    var abs = [];
    for (var i = 0; i < resid.length; i++) {
      if (resid[i] !== null) abs.push(Math.abs(resid[i]));
    }
    if (!abs.length) return opt.minScale;
    // 1.4826 是讓 MAD 在常態下等於標準差的換算常數。
    return Math.max(opt.minScale, 1.4826 * WR_LINALG.median(abs));
  }

  /**
   * Tukey bisquare：w = (1 - (u/c)²)²，|u| > c 時為 0。
   * resid 裡的 null 代表「這筆評斷不了」，一律給滿權重。
   */
  function bisquareWeights(resid, scale, opt, sole) {
    var m = resid.length;
    var w = new Array(m);
    for (var i = 0; i < m; i++) {
      if (resid[i] === null) { w[i] = 1; continue; }
      var u = Math.abs(resid[i]) / scale / opt.tukeyC;
      var v = u >= 1 ? 0 : (1 - u * u) * (1 - u * u);
      // 某個物品唯一的來源不能被完全丟掉，否則那個物品會直接消失、解成 0。
      // 留一點點份量：足以撐住它的存在，不足以主導整張看板。
      if (sole && sole[i]) v = Math.max(v, 0.15);
      w[i] = v;
    }
    return w;
  }

  /** 每個物品出現在幾筆禮包裡。 */
  function occurrenceCounts(rows) {
    var counts = {};
    for (var i = 0; i < rows.length; i++) {
      for (var id in rows[i].qty) {
        if (!Object.prototype.hasOwnProperty.call(rows[i].qty, id)) continue;
        if (rows[i].qty[id] > 0) counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }

  /** 標記「含有某個只出現在這一筆裡的物品」的禮包。 */
  function soleSourceRows(rows) {
    return rowsWhereEveryItem(rows, function (count) { return count === 1; }, true);
  }

  /**
   * 每一列的槓桿值 h_ii = a_iᵀ G⁻¹ a_i，以及「拿掉這一列之後，它的內容物
   * 還剩多少有效觀測次數」。
   *
   * 為什麼不能只看槓桿值：實測過一筆純銀幣包，槓桿值只有 0.125（很低），
   * 但它是整批資料裡唯一「銀幣單獨出現」的一列 —— 拿掉它，銀幣就只剩下
   * 跟別的物品綁在一起的觀測，解出來的價格立刻偏掉 7%。槓桿值衡量的是
   * 「這一列對自己的預測值有多少決定權」，不是「這一列對某個物品的
   * 可辨識性有多關鍵」，而後者才是我們要的。
   *
   * 有效觀測次數正好衡量後者，而且不必重解 m 次：
   *     G₋ᵢ = G − aᵢaᵢᵀ  ⟹  G₋ᵢ⁻¹ = G⁻¹ + (G⁻¹aᵢ)(G⁻¹aᵢ)ᵀ / (1 − hᵢᵢ)
   * 這個 Sherman–Morrison 更新每一列只要 O(n²)，而且 hᵢᵢ → 1 時分母趨近 0，
   * 有效觀測次數自動趨近 0 —— 槓桿值的判斷被包含在裡面了。
   *
   * 關鍵細節：這裡必須關掉相對誤差加權。相對誤差加權是把每一列除以該包售價，
   * 於是「售價少打一個 0」的那一列權重會變成十倍，槓桿值衝到 1 附近，然後它
   * 就被當成「無從評斷」而跳過篩檢，正好逃掉。這裡要衡量的是內容物組合的
   * 結構，純粹是 x 空間的性質，不該讓可能有錯的售價參一腳。
   */
  function rowDiagnostics(rows, itemIds, opt) {
    var m = rows.length;
    var n = itemIds.length;
    var out = new Array(m);
    var i, j, k;
    for (i = 0; i < m; i++) out[i] = { leverage: 1, minEffObs: 0 };

    var flat = merge(opt, { relativeWeighting: false });
    var d = design(rows, itemIds, pricesOf(rows), flat, null, null);
    if (!d) return out;

    var inv = WR_LINALG.inverseSPD(gram(d));
    if (!inv) return out;

    for (i = 0; i < m; i++) {
      var a = d.A[i];
      var v = WR_LINALG.zeros(n);      // v = G⁻¹aᵢ
      var h = 0;
      for (j = 0; j < n; j++) {
        var s = 0;
        for (k = 0; k < n; k++) {
          if (a[k] !== 0) s += inv[j][k] * a[k];
        }
        v[j] = s;
        h += a[j] * s;
      }
      var denom = 1 - h;
      var worst = Infinity;
      if (denom <= 1e-9) {
        worst = 0;
      } else {
        for (j = 0; j < n; j++) {
          if (a[j] === 0) continue;          // 只在意這一列真的含有的物品
          var without = inv[j][j] + (v[j] * v[j]) / denom;
          var eff = without > 0 ? 1 / without : 0;
          if (eff < worst) worst = eff;
        }
      }
      out[i] = { leverage: h, minEffObs: worst === Infinity ? 0 : worst };
    }
    return out;
  }

  /** 只要槓桿值那一欄時的便利包裝（測試與診斷用）。 */
  function leverages(rows, itemIds, opt) {
    var d = rowDiagnostics(rows, itemIds, opt);
    var out = new Array(d.length);
    for (var i = 0; i < d.length; i++) out[i] = d[i].leverage;
    return out;
  }

  /** G = AᵀA + diag(ridge)，也就是正則化後的正規方程式矩陣。 */
  function gram(d) {
    var n = d.n;
    var G = new Array(n);
    var i, j;
    for (i = 0; i < n; i++) G[i] = WR_LINALG.zeros(n);
    for (var r = 0; r < d.m; r++) {
      var row = d.A[r];
      for (i = 0; i < n; i++) {
        if (row[i] === 0) continue;
        for (j = i; j < n; j++) {
          if (row[j] !== 0) G[i][j] += row[i] * row[j];
        }
      }
    }
    for (i = 0; i < n; i++) {
      G[i][i] += d.ridge[i];
      for (j = i + 1; j < n; j++) G[j][i] = G[i][j];
    }
    return G;
  }

  /**
   * 對每一列，看它的內容物有沒有任何一種滿足 hit()。
   * whenHit 決定命中時標記成 true 還是 false，兩個用途剛好相反。
   */
  function rowsWhereEveryItem(rows, hit, whenHit) {
    var counts = occurrenceCounts(rows);
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) {
      out[i] = !whenHit;
      for (var id in rows[i].qty) {
        if (!Object.prototype.hasOwnProperty.call(rows[i].qty, id)) continue;
        if (rows[i].qty[id] > 0 && hit(counts[id] || 0)) { out[i] = whenHit; break; }
      }
    }
    return out;
  }

  function maxDiff(a, b) {
    var d = 0;
    for (var i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  }

  /* ==================================================================
     完整貝氏（Gibbs 抽樣）
     ================================================================== */

  /**
   * 對截斷多元常態後驗做 Gibbs 抽樣。
   *
   * 模型（在縮放後的座標系裡）：
   *     b | z, σ²  ~  N(A z, σ² I)
   *     z_j | σ²   ~  N(參考值_j, σ² / λ_j)   ，且 z ≥ 0
   *
   * 於是 z 的後驗精度矩陣是 G/σ²，其中 G = AᵀA + diag(λ)，
   * 後驗平均是 G⁻¹h，h = Aᵀb + λ∘參考值 —— 跟 ridge 解是同一個點。
   * 也就是說：**貝氏不會給你更準的單價**，它給的是誠實的不確定性。
   *
   * 逐座標抽樣時，每個 z_j 的條件分布是一維截斷常態：
   *     平均 (h_j - Σ_{k≠j} G_jk z_k) / G_jj，標準差 √(σ²/G_jj)，截在 [0, ∞)
   * 共線時 G_jj 沒變小、但 G 的某個特徵值接近 0，抽出來的鏈就會沿著那個
   * 方向大幅擺盪 —— 那正是 bootstrap 看不見的不確定性。
   *
   * 註：z 截斷之後 σ² 的條件分布嚴格來說不再是倒 Gamma（截斷的正規化常數
   * 也跟著 σ 走）。非負限制實際綁住的只有被解成 0 的那幾項，這裡就用
   * 共軛形式近似，不值得為此換成 Metropolis。
   */
  function gibbs(rows, itemIds, target, opt, priors) {
    var d = design(rows, itemIds, target, opt, priors, null);
    var n = itemIds.length;
    if (!d) return { prices: WR_LINALG.zeros(n), rowWeights: null, draws: null };

    var m = d.m;
    var i, j, k, r;

    // G = AᵀA + diag(λ)，h = Aᵀb + λ∘prior
    var G = new Array(n);
    for (i = 0; i < n; i++) G[i] = WR_LINALG.zeros(n);
    var hv = WR_LINALG.zeros(n);
    for (r = 0; r < m; r++) {
      var row = d.A[r];
      var br = d.b[r];
      for (i = 0; i < n; i++) {
        var vi = row[i];
        if (vi === 0) continue;
        hv[i] += vi * br;
        for (j = i; j < n; j++) {
          var vj = row[j];
          if (vj !== 0) G[i][j] += vi * vj;
        }
      }
    }
    for (i = 0; i < n; i++) {
      G[i][i] += d.ridge[i];
      if (d.prior) hv[i] += d.ridge[i] * d.prior[i];
      for (j = i + 1; j < n; j++) G[j][i] = G[i][j];
    }

    var rand = WR_LINALG.rng((opt.seed ^ 0x5bf03635) >>> 0);
    var z = WR_LINALG.nnls(d.A, d.b, d.ridge, d.prior);   // 從眾數起步，省掉一段 burn-in
    var floor2 = opt.minScale * opt.minScale;
    var sigma2 = Math.max(penalty(d, G, hv, z) / m, floor2);

    var samples = Math.max(60, Math.min(opt.samples, 600));
    var thin = Math.max(1, opt.thin);
    var burn = Math.max(0, opt.burnIn);
    var total = burn + samples * thin;

    var sums = WR_LINALG.zeros(n);
    var draws = [];

    for (var t = 0; t < total; t++) {
      for (j = 0; j < n; j++) {
        if (G[j][j] <= 0) { z[j] = 0; continue; }
        var s = hv[j];
        for (k = 0; k < n; k++) {
          if (k !== j && z[k] !== 0) s -= G[j][k] * z[k];
        }
        var mu = s / G[j][j];
        var sd = Math.sqrt(sigma2 / G[j][j]);
        z[j] = WR_LINALG.truncatedNormalPositive(mu, sd, rand);
      }

      // σ² | z ~ 倒 Gamma((m+n)/2, 殘差平方和/2)
      var sse = penalty(d, G, hv, z);
      sigma2 = (sse / 2) / WR_LINALG.gamma((m + n) / 2, rand);
      if (!(sigma2 > 0) || !isFinite(sigma2)) sigma2 = floor2;
      // 開了相對誤差加權之後 b 正好是全 1 向量，所以 σ 直接就是「相對誤差」。
      // 給它一個下限：資料剛好完美吻合時，不該因此宣稱單價精確到小數點後好幾位。
      if (sigma2 < floor2) sigma2 = floor2;

      if (t >= burn && (t - burn) % thin === 0) {
        var x = unscale(z, d);
        draws.push(x);
        for (j = 0; j < n; j++) sums[j] += x[j];
      }
    }

    var mean = new Array(n);
    for (j = 0; j < n; j++) mean[j] = draws.length ? sums[j] / draws.length : 0;
    return { prices: mean, rowWeights: null, draws: draws };
  }

  /** ‖Az - b‖² + Σ λ_j (z_j - p_j)²，用 G 與 h 算會比重建殘差快一個數量級。 */
  function penalty(d, G, hv, z) {
    // ‖Az-b‖² + λ‖z-p‖² = zᵀGz - 2hᵀz + ‖b‖² + λ‖p‖²
    var n = z.length;
    var quad = 0;
    for (var i = 0; i < n; i++) {
      if (z[i] === 0) continue;
      var s = 0;
      for (var j = 0; j < n; j++) s += G[i][j] * z[j];
      quad += z[i] * s;
    }
    var lin = 0;
    for (i = 0; i < n; i++) lin += hv[i] * z[i];
    var cst = 0;
    for (i = 0; i < d.m; i++) cst += d.b[i] * d.b[i];
    if (d.prior) {
      for (i = 0; i < n; i++) cst += d.ridge[i] * d.prior[i] * d.prior[i];
    }
    return Math.max(quad - 2 * lin + cst, 1e-14);
  }

  /* ==================================================================
     區間
     ================================================================== */

  /** 重抽禮包（有放回）重解多次，得到每個物品單價的經驗分布。 */
  function bootstrap(rows, itemIds, priors, opt, rowWeights) {
    var m = rows.length;
    var n = itemIds.length;
    var rand = WR_LINALG.rng(opt.seed);
    var samples = Math.max(30, Math.min(opt.samples, 600));

    var values = [];
    for (var s = 0; s < samples; s++) {
      var picked = new Array(m);
      var pickedW = rowWeights ? new Array(m) : null;
      var seen = {};
      for (var i = 0; i < m; i++) {
        var k = Math.floor(rand() * m);
        if (k >= m) k = m - 1;
        picked[i] = rows[k];
        // 穩健權重沿用完整資料那次算出來的，不在每一輪重跑 IRLS：
        // 重抽本來就是在問「同樣的分析換一批資料會怎樣」，而且省下數倍的時間。
        if (pickedW) pickedW[i] = rowWeights[k];
        var q = rows[k].qty;
        for (var id in q) {
          if (Object.prototype.hasOwnProperty.call(q, id) && q[id] > 0) seen[id] = true;
        }
      }
      var target = new Array(m);
      for (i = 0; i < m; i++) target[i] = picked[i].price;
      var est = fit(picked, itemIds, target, opt, priors, pickedW);
      // 這一輪沒抽到的物品沒有估計值，記成 null 而不是 0 —— 記成 0 會把區間往下拉歪。
      for (var j = 0; j < n; j++) {
        if (!seen[itemIds[j]]) est[j] = null;
      }
      values.push(est);
    }
    return values;
  }

  /** 把一堆抽樣（bootstrap 或後驗）整理成每個物品的分位數區間。 */
  function intervalFrom(values, itemIds, opt, point) {
    var n = itemIds.length;
    var samples = values.length;
    var lo = (1 - opt.interval) / 2;
    var hi = 1 - lo;
    var interval = {};
    for (var j = 0; j < n; j++) {
      var col = [];
      for (var s = 0; s < samples; s++) {
        var v = values[s][j];
        if (v !== null && v !== undefined && isFinite(v)) col.push(v);
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
    // NNLS 在 0 這個邊界上會讓分布偏態，百分位區間因此可能整段落在點估計的
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
    return interval;
  }

  /**
   * 每個物品的「有效觀測次數」。
   *
   * 縮放後正規方程式的對角線 G_jj 正好等於該物品出現過的次數，但那只在欄位
   * 彼此正交時才代表真正的資訊量。取 1/(G⁻¹)_jj 才會把共線扣掉：某物品若總是
   * 跟別的物品綁在一起賣，出現三十次的有效觀測可能還不到一次。
   */
  function effectiveObservations(rows, itemIds, opt) {
    var d = design(rows, itemIds, pricesOf(rows), opt, null, null);
    var n = itemIds.length;
    if (!d) return [];
    var i, j;

    var G = new Array(n);
    for (i = 0; i < n; i++) G[i] = WR_LINALG.zeros(n);
    for (var r = 0; r < d.m; r++) {
      for (i = 0; i < n; i++) {
        if (d.A[r][i] === 0) continue;
        for (j = i; j < n; j++) G[i][j] += d.A[r][i] * d.A[r][j];
      }
    }
    for (i = 0; i < n; i++) {
      G[i][i] += opt.ridgeFloor;
      for (j = i + 1; j < n; j++) G[j][i] = G[i][j];
    }

    var diag = WR_LINALG.inverseDiagonal(G);
    var out = new Array(n);
    for (j = 0; j < n; j++) out[j] = diag[j] > 0 ? 1 / diag[j] : 0;
    return out;
  }

  function pricesOf(rows) {
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) out[i] = rows[i].price;
    return out;
  }

  /* ==================================================================
     整理輸出
     ================================================================== */

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

  function describeItems(present, prices, interval, stats, priors, retired, dataOnly, hasPriors, effObs) {
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
      var isRetired = hasPrior && retired[id] === true;
      var occ = stats.occurrences[id] || 0;
      var relWidth = null;
      if (band && price > 0) relWidth = (band.high - band.low) / price;

      // 參考值把答案拉動了多少。接近 0 代表結論是資料自己撐起來的。
      var pull = null;
      if (hasPriors && hasPrior && !isRetired && dataOnly[id] !== undefined) {
        var base = Math.max(price, dataOnly[id]);
        pull = base > 0 ? Math.abs(price - dataOnly[id]) / base : 0;
      }
      out.push({
        id: id,
        label: WR_CATALOG.labelOf(id),
        group: (WR_CATALOG.get(id) || {}).group || 'other',
        price: price,
        prior: hasPrior ? prior : null,
        priorRetired: isRetired,
        dataOnlyPrice: hasPriors && dataOnly[id] !== undefined ? dataOnly[id] : null,
        priorPull: isRetired ? 0 : pull,
        low: band ? band.low : null,
        high: band ? band.high : null,
        relativeWidth: relWidth,
        occurrences: occ,
        effectiveObs: effObs && effObs[i] !== undefined ? effObs[i] : null,
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
   * 以及區間相對於點估計有多寬（穩定度）。
   */
  function confidenceOf(occurrences, relWidth, price) {
    if (occurrences === 0) return 'none';
    if (price === 0) return 'low';
    if (relWidth === null) return occurrences >= 4 ? 'mid' : 'low';
    if (occurrences >= 4 && relWidth <= 0.35) return 'high';
    if (occurrences >= 2 && relWidth <= 0.9) return 'mid';
    return 'low';
  }

  /**
   * 擬合診斷。r²、平均誤差只算「實際納入求解」的那些禮包，
   * 但被排除的單品也會出現在 predictions 裡並標記原因 —— 使用者要看得到它們。
   */
  function fitQuality(rows, prices, rowWeights, excluded, itemCount) {
    var m = rows.length;
    var dof = itemCount === undefined ? null : m - itemCount;
    if (m === 0) return { count: 0, dof: dof, r2: null, mape: null, rmse: null, meaningful: false, predictions: [] };
    var predictions = [];
    var sumActual = 0;
    var ssRes = 0;
    var absPct = 0;
    for (var i = 0; i < m; i++) {
      var predicted = predictPrice(rows[i].qty, prices);
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
        ratio: predicted / actual,
        weight: rowWeights ? rowWeights[i] : 1,
        excluded: false
      });
    }
    if (excluded) {
      for (i = 0; i < excluded.length; i++) {
        var ex = excluded[i];
        predictions.push({
          id: ex.id, name: ex.name,
          actual: null, predicted: null, residual: null, ratio: null,
          weight: 0, excluded: true, excludedBy: ex.bestName, excludedItem: ex.itemLabel
        });
      }
    }
    var mean = sumActual / m;
    var ssTot = 0;
    for (i = 0; i < m; i++) ssTot += (rows[i].price - mean) * (rows[i].price - mean);
    predictions.sort(function (a, b) {
      if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
      if (a.excluded) return 0;
      return Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1);
    });
    return {
      count: m,
      /**
       * 自由度 = 禮包筆數 − 待解物品數。
       *
       * 這個數字決定「平均誤差」到底有沒有意義。未知數跟方程式一樣多的時候，
       * 解一定會完美通過每一個點，誤差趨近 0 —— 那不是模型準，那是它還沒被
       * 考驗過。看板上必須誠實地講這件事，不然 0.8% 的誤差會讓人以為一切都很穩。
       */
      dof: dof,
      meaningful: dof === null ? true : dof >= 3,
      r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
      mape: absPct / m,
      rmse: Math.sqrt(ssRes / m),
      predictions: predictions
    };
  }

  function predictPrice(qty, prices) {
    var p = 0;
    for (var id in qty) {
      if (Object.prototype.hasOwnProperty.call(qty, id)) p += qty[id] * (prices[id] || 0);
    }
    return p;
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

  function countKeys(obj) {
    var c = 0;
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) c++;
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
    METHODS: METHODS,
    methodInfo: methodInfo,
    solve: solve,
    fit: fit,
    irls: irls,
    gibbs: gibbs,
    effectiveObservations: effectiveObservations,
    leverages: leverages,
    rowDiagnostics: rowDiagnostics,
    dominatedSingles: dominatedSingles,
    mergeDuplicates: mergeDuplicates,
    duplicateGroups: duplicateGroups,
    unitPriceOutliers: unitPriceOutliers,
    fitQuality: fitQuality,
    predictPrice: predictPrice,
    confidenceOf: confidenceOf
  };
})();
