/**
 * 多算法對照。
 *
 * 同一批禮包、同一個要評估的組合，用四種不同的算法各跑一次，把結論並排。
 * 這不是為了選出「最好的那個」，而是為了看出**結論到底穩不穩**：
 *
 *   四個都說超值  → 這個判斷跟算法怎麼選無關，可以相信
 *   彼此打架      → 結論是算法假設撐起來的，不是資料撐起來的，該去多記幾包
 *
 * 四個變體各自回答一個具體的問題：
 *
 *   最小平方    教科書解法會怎麼說？（也就是改動之前的答案）
 *   穩健回歸    把偏離行情太遠的那幾包降權之後呢？
 *   參考值優先  如果完全照我自己心裡那份價目表算呢？
 *   完整貝氏    考慮到資料根本分不出某些物品，誠實的區間有多寬？
 */
var WR_COMPARE = (function () {
  'use strict';

  var VARIANTS = [
    {
      key: 'ls',
      label: '最小平方',
      short: '最小平方',
      tip: '一視同仁',
      blurb: '所有禮包一視同仁。一筆打錯的資料或一次超級促銷會被平方放大，整張看板都會被它拉走。',
      options: function () { return { method: 'ls' }; }
    },
    {
      key: 'robust',
      label: '穩健回歸',
      short: '穩健',
      tip: '離群自動降權',
      blurb: '偏離典型誤差太遠的禮包自動降權。促銷包仍然完整記著，但不會再把行情拉歪。',
      options: function () { return { method: 'robust' }; }
    },
    {
      key: 'prior',
      label: '參考值優先',
      short: '參考值',
      tip: '照你填的參考單價',
      blurb: '把你填的參考單價當成定值，其餘物品再由資料補齊。等於問「照我自己的價目表，這包值多少」。',
      needsPriors: true,
      options: function () {
        // 份量開到極大 = 實質上釘住；這是對照用的極端情境，不是引擎平常的行為。
        return { method: 'robust', priorWeight: 1e6, retirePriors: false };
      }
    },
    {
      key: 'bayes',
      label: '完整貝氏',
      short: '貝氏',
      tip: '區間最誠實',
      blurb: '點估計跟最小平方差不多，差別在區間：資料分不出來的物品，它就會誠實地給出很寬的區間。',
      options: function () { return { method: 'bayes' }; }
    }
  ];

  /**
   * 建出所有變體的模型。
   *
   * @param {Array} bundles 禮包清單
   * @param {Object} base   共用的設定（priors、relativeWeighting、samples…）
   * @returns {Array} [{ key, label, short, blurb, model }]
   */
  function build(bundles, base) {
    base = base || {};
    var hasPriors = countPriors(base.priors) > 0;
    var out = [];
    for (var i = 0; i < VARIANTS.length; i++) {
      var v = VARIANTS[i];
      if (v.needsPriors && !hasPriors) continue;
      out.push({
        key: v.key,
        label: v.label,
        short: v.short,
        tip: v.tip,
        blurb: v.blurb,
        model: WR_SOLVER.solve(bundles, merge(base, v.options()))
      });
    }
    return out;
  }

  /** 對同一個組合，逐個變體算出性價比判斷。 */
  function verdicts(candidate, variants) {
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      out.push({
        key: v.key,
        label: v.label,
        short: v.short,
        tip: v.tip,
        blurb: v.blurb,
        model: v.model,
        ev: WR_EVAL.evaluate(candidate, v.model)
      });
    }
    return out;
  }

  /**
   * 行情參考那一欄的說明文字。它不是第五種算法 —— 那一欄的數字沒有經過
   * 任何求解，所以刻意跟四種算法分開存放，畫面上也該畫出分隔線。
   */
  var REFERENCE = {
    key: 'ref',
    label: '行情參考',
    short: '參考',
    tip: '你自己給的市價',
    blurb: '用物品目錄裡的行情參考價直接乘出來的，完全沒有經過推算。它不參與任何計算，' +
      '只是多給你一把尺：四種算法的結論跟你自己的價目表對不對得上。'
  };

  /**
   * 並排表格要畫的每一列：四種算法 + 行情參考。
   *
   * 兩個畫面（禮包編輯器與試算頁）都用這一份，欄位的意義與順序才不會各寫一套。
   * 每一列都同時給「預估價錢」與「性價比」—— 只看性價比會漏掉一件事：
   * 兩種算法可以給出一樣的指數，卻是用完全不同的價值估出來的。
   *
   * @param {Object} candidate  { qty, price }
   * @param {Array}  variants   build() 的輸出
   * @param {Object} refModel   行情參考欄用來填補「沒有參考價的物品」的模型
   */
  function rows(candidate, variants, refModel) {
    var out = [];
    var list = verdicts(candidate, variants || []);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      out.push({
        key: v.key, label: v.label, short: v.short, tip: v.tip, blurb: v.blurb,
        isRef: false,
        value: v.ev.value,
        valueLow: null,
        valueHigh: null,
        ratio: v.ev.ratio,
        ratioLow: v.ev.ratioLow,
        ratioHigh: v.ev.ratioHigh,
        tier: v.ev.tier,
        ev: v.ev
      });
    }

    var ref = WR_EVAL.reference(candidate, refModel || (variants && variants.length ? variants[0].model : null));
    if (ref) {
      out.push({
        key: REFERENCE.key, label: REFERENCE.label, short: REFERENCE.short,
        tip: REFERENCE.tip, blurb: REFERENCE.blurb,
        isRef: true,
        value: ref.value,
        valueLow: ref.valueLow,
        valueHigh: ref.valueHigh,
        ratio: ref.ratio,
        ratioLow: ref.ratioLow,
        ratioHigh: ref.ratioHigh,
        tier: ref.tier,
        ref: ref
      });
    }
    return out;
  }

  /**
   * 這幾個判斷彼此有多一致。
   *
   * 看的是「好／持平／差」這個粗分類，而不是等第的字面 ——「超值」和「划算」
   * 都是該買，把它們算成分歧只會製造沒必要的焦慮。
   */
  function consensus(list) {
    var usable = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].ev && list[i].ev.tier) usable.push(list[i]);
    }
    if (usable.length === 0) return { level: 'none', text: '還算不出結論。' };

    var tones = {};
    var ratios = [];
    for (i = 0; i < usable.length; i++) {
      tones[side(usable[i].ev.tier.id)] = true;
      ratios.push(usable[i].ev.ratio);
    }
    var kinds = 0;
    for (var k in tones) if (Object.prototype.hasOwnProperty.call(tones, k)) kinds++;

    var lo = Math.min.apply(null, ratios);
    var hi = Math.max.apply(null, ratios);
    var spread = lo > 0 ? (hi - lo) / lo : 0;

    if (kinds === 1 && spread <= 0.15) {
      return {
        level: 'strong',
        spread: spread,
        text: usable.length + ' 種算法結論一致，性價比指數也只差 ' + Math.round(spread * 100) +
          '%。這個判斷跟算法怎麼選無關，可以相信。'
      };
    }
    if (kinds === 1) {
      return {
        level: 'ok',
        spread: spread,
        text: usable.length + ' 種算法方向一致，但指數之間差了 ' + Math.round(spread * 100) +
          '%。結論可信，實際划算多少還有變數。'
      };
    }
    return {
      level: 'weak',
      spread: spread,
      text: '算法之間看法不同（指數 ' + lo.toFixed(2) + ' ～ ' + hi.toFixed(2) +
        '）。代表這個結論是算法的假設撐起來的，不是資料撐起來的 —— 再多記幾包含有這些物品的禮包會有幫助。'
    };
  }

  function side(tierId) {
    if (tierId === 'great' || tierId === 'good') return 'good';
    if (tierId === 'fair') return 'fair';
    return 'bad';
  }

  function countPriors(priors) {
    var c = 0;
    if (!priors) return 0;
    for (var k in priors) {
      if (!Object.prototype.hasOwnProperty.call(priors, k)) continue;
      var v = Number(priors[k]);
      if (isFinite(v) && v > 0) c++;
    }
    return c;
  }

  function merge(a, b) {
    var out = {};
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  return {
    VARIANTS: VARIANTS,
    REFERENCE: REFERENCE,
    build: build,
    verdicts: verdicts,
    rows: rows,
    consensus: consensus
  };
})();
