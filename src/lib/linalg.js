/**
 * 小型線性代數工具。問題規模很小（最多約 20 個物品、數百筆禮包），
 * 所以用最直接的稠密實作，不做任何稀疏或分塊優化。
 */
var WR_LINALG = (function () {
  'use strict';

  function zeros(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function norm2(a) {
    return Math.sqrt(dot(a, a));
  }

  /** LU 分解 + 部分主元消去。矩陣近奇異時回傳 null，讓呼叫端決定怎麼退場。 */
  function solveLU(M, h) {
    var k = h.length;
    var a = new Array(k);
    for (var i = 0; i < k; i++) {
      a[i] = M[i].slice();
      a[i].push(h[i]);
    }
    for (var col = 0; col < k; col++) {
      var pivot = col;
      for (var r = col + 1; r < k; r++) {
        if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
      }
      if (Math.abs(a[pivot][col]) < 1e-13) return null;
      if (pivot !== col) { var t = a[pivot]; a[pivot] = a[col]; a[col] = t; }
      for (r = col + 1; r < k; r++) {
        var f = a[r][col] / a[col][col];
        if (f === 0) continue;
        for (var c = col; c <= k; c++) a[r][c] -= f * a[col][c];
      }
    }
    var x = new Array(k);
    for (i = k - 1; i >= 0; i--) {
      var s = a[i][k];
      for (var j = i + 1; j < k; j++) s -= a[i][j] * x[j];
      x[i] = s / a[i][i];
    }
    return x;
  }

  /**
   * 解對稱正定系統 S z = h（Cholesky）。
   * 加了 ridge 之後 S 一定正定；萬一數值上仍然失敗就退回 LU。
   */
  function solveSPD(S, h) {
    var k = h.length;
    if (k === 0) return [];
    var L = new Array(k);
    for (var i = 0; i < k; i++) L[i] = zeros(k);
    for (i = 0; i < k; i++) {
      for (var j = 0; j <= i; j++) {
        var sum = S[i][j];
        for (var p = 0; p < j; p++) sum -= L[i][p] * L[j][p];
        if (i === j) {
          if (sum <= 1e-14) return solveLU(S, h);
          L[i][i] = Math.sqrt(sum);
        } else {
          L[i][j] = sum / L[j][j];
        }
      }
    }
    var y = new Array(k);
    for (i = 0; i < k; i++) {
      var sy = h[i];
      for (p = 0; p < i; p++) sy -= L[i][p] * y[p];
      y[i] = sy / L[i][i];
    }
    var z = new Array(k);
    for (i = k - 1; i >= 0; i--) {
      var sz = y[i];
      for (p = i + 1; p < k; p++) sz -= L[p][i] * z[p];
      z[i] = sz / L[i][i];
    }
    return z;
  }

  /**
   * 在指定的欄位子集合上做最小平方 + ridge：
   *   min ||A_S z - b||^2 + ridge * ||z - p||^2
   *
   * p 是「錨點」。傳 null 等同 p = 0，也就是課本上的 ridge：把答案往 0 拉。
   * 傳入參考值時就是往那組值拉 —— 兩者只差正規方程式右側多一項 ridge * p。
   *
   * ridge 可以是單一數字，也可以是每欄一個值的陣列 —— 有參考值的欄位需要
   * 明顯的份量，沒有參考值的欄位只需要一點點以免矩陣退化，兩者差好幾個數量級。
   *
   * 回傳長度 n 的向量，子集合以外的位置為 0。
   */
  function lstsqSubset(A, b, cols, ridge, prior) {
    var m = A.length;
    var n = A[0].length;
    var k = cols.length;
    var out = zeros(n);
    if (k === 0) return out;

    var G = new Array(k);
    for (var i = 0; i < k; i++) G[i] = zeros(k);
    var h = zeros(k);

    for (var r = 0; r < m; r++) {
      var row = A[r];
      var br = b[r];
      for (i = 0; i < k; i++) {
        var vi = row[cols[i]];
        if (vi === 0) continue;
        h[i] += vi * br;
        for (var j = i; j < k; j++) {
          var vj = row[cols[j]];
          if (vj === 0) continue;
          G[i][j] += vi * vj;
        }
      }
    }
    for (i = 0; i < k; i++) {
      var lam = typeof ridge === 'number' ? ridge : ridge[cols[i]];
      G[i][i] += lam;
      if (prior) h[i] += lam * prior[cols[i]];
      for (j = i + 1; j < k; j++) G[j][i] = G[i][j];
    }

    var z = solveSPD(G, h);
    if (!z) return out;
    for (i = 0; i < k; i++) out[cols[i]] = z[i];
    return out;
  }

  /**
   * 非負最小平方（Lawson–Hanson 主動集法），帶 ridge 正則化：
   *   min ||A x - b||^2 + ridge * ||x - p||^2   s.t.  x >= 0
   *
   * p（prior）是正則化的錨點，傳 null 就是往 0 拉的標準 ridge。
   * 加了錨點之後目標函數仍是凸二次式，KKT 條件的形式不變，
   * 所以主動集法的流程完全照舊，只有梯度與內層最小平方各多一項。
   *
   * ridge 直接加在正規方程式的對角線上，所以不需要把 A 擴增成 (m+n) x n，
   * 每次內層求解都省下 n 列的運算。
   */
  function nnls(A, b, ridge, prior, maxIter) {
    var m = A.length;
    if (m === 0) return [];
    var n = A[0].length;
    var x = zeros(n);
    if (n === 0) return x;

    ridge = ridge || 0;
    maxIter = maxIter || Math.max(30, 3 * n);
    var ridgeAt = typeof ridge === 'number'
      ? function () { return ridge; }
      : function (c) { return ridge[c]; };

    var passive = new Array(n);
    for (var i = 0; i < n; i++) passive[i] = false;

    var tol = 1e-11;
    var resid = zeros(m);
    var grad = zeros(n);

    function refreshGradient() {
      for (var r = 0; r < m; r++) resid[r] = b[r] - dot(A[r], x);
      for (var c = 0; c < n; c++) grad[c] = 0;
      for (r = 0; r < m; r++) {
        var row = A[r];
        var e = resid[r];
        if (e === 0) continue;
        for (c = 0; c < n; c++) {
          if (row[c] !== 0) grad[c] += row[c] * e;
        }
      }
      for (c = 0; c < n; c++) {
        var lam = ridgeAt(c);
        if (lam) grad[c] -= lam * (x[c] - (prior ? prior[c] : 0));
      }
    }

    function activeCols() {
      var cols = [];
      for (var c = 0; c < n; c++) if (passive[c]) cols.push(c);
      return cols;
    }

    refreshGradient();

    var outer = 0;
    while (outer++ < maxIter) {
      var best = -1;
      var bestVal = tol;
      for (i = 0; i < n; i++) {
        if (!passive[i] && grad[i] > bestVal) { bestVal = grad[i]; best = i; }
      }
      if (best < 0) break;
      passive[best] = true;

      var inner = 0;
      var innerCap = 3 * n + 10;
      while (inner++ < innerCap) {
        var cols = activeCols();
        if (cols.length === 0) break;
        var s = lstsqSubset(A, b, cols, ridge, prior);

        var allPositive = true;
        for (i = 0; i < cols.length; i++) {
          if (s[cols[i]] <= tol) { allPositive = false; break; }
        }
        if (allPositive) { x = s; break; }

        // 沿著 x -> s 前進到第一個碰到 0 的座標，把它踢出主動集。
        var alpha = Infinity;
        for (i = 0; i < cols.length; i++) {
          var c2 = cols[i];
          if (s[c2] > tol) continue;
          var denom = x[c2] - s[c2];
          if (denom > tol) alpha = Math.min(alpha, x[c2] / denom);
        }
        if (!isFinite(alpha)) {
          // 理論上不會發生；真的碰到就直接把違規的座標歸零收場，避免無窮迴圈。
          for (i = 0; i < cols.length; i++) {
            if (s[cols[i]] <= tol) { passive[cols[i]] = false; x[cols[i]] = 0; }
          }
          continue;
        }
        for (i = 0; i < cols.length; i++) {
          var c3 = cols[i];
          x[c3] = x[c3] + alpha * (s[c3] - x[c3]);
        }
        for (i = 0; i < cols.length; i++) {
          var c4 = cols[i];
          if (x[c4] <= tol) { passive[c4] = false; x[c4] = 0; }
        }
      }

      refreshGradient();
    }

    for (i = 0; i < n; i++) if (x[i] < 0) x[i] = 0;
    return x;
  }

  /** mulberry32：小而夠用的可重現亂數，讓每次重算的區間估計不會亂跳。 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 線性內插的百分位數。values 必須已排序。 */
  function percentile(sorted, p) {
    var n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    var idx = (n - 1) * p;
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  return {
    zeros: zeros,
    dot: dot,
    norm2: norm2,
    solveLU: solveLU,
    solveSPD: solveSPD,
    lstsqSubset: lstsqSubset,
    nnls: nnls,
    rng: rng,
    percentile: percentile
  };
})();
