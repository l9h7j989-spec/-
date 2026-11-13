/*
 * route.js — 동선(방문 순서) 계산 전용 파일
 * AI를 쓰지 않고, 아래의 수학 알고리즘만으로 계산합니다.
 *
 *  - 거리 계산   : haversineKm (좌표 사이 직선거리)
 *  - 거리표 만들기: buildMatrix  ← 나중에 "실제 도로거리 API"로 바꿀 때 여기만 교체
 *  - 12곳 이하   : solveExact (Held-Karp 동적계획법 = 모든 순서를 빠짐없이 따져 정확한 최단 순서)
 *  - 13곳 이상   : nearestNeighbor + twoOpt (근사 계산)
 *
 * 브라우저에서는 window.Route, Node(검증용)에서는 require 로 사용합니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Route = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EARTH_RADIUS_KM = 6371.0088; // 지구 평균 반지름
  var EXACT_LIMIT = 12;            // 이 개수 이하면 정확한 최단 순서를 구함

  /** 두 좌표 {lat,lng} 사이의 직선거리(km) — 하버사인 공식 */
  function haversineKm(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ------------------------------------------------------------------
   * 거리 제공자(Provider)
   * points: [{lat,lng}, ...]  →  Promise<거리표 m>,  m[i][j] = i에서 j까지 km
   * 실제 도로거리 API를 붙일 때는 같은 모양의 함수를 만들어
   *   Route.setDistanceProvider(내함수)
   * 한 줄만 호출하면 됩니다. 아래 계산 코드는 손댈 필요가 없습니다.
   * (가는 길과 오는 길 거리가 달라도 동작하도록 만들어 두었습니다.)
   * ------------------------------------------------------------------ */
  function haversineProvider(points) {
    var n = points.length, m = [];
    for (var i = 0; i < n; i++) {
      m.push([]);
      for (var j = 0; j < n; j++) m[i].push(i === j ? 0 : haversineKm(points[i], points[j]));
    }
    return Promise.resolve(m);
  }
  var provider = haversineProvider;
  function setDistanceProvider(fn) { provider = fn || haversineProvider; }
  function buildMatrix(points) { return provider(points); }

  /* 아래부터는 거리표 m 만 사용합니다. 0번 = 사무실, 1..n = 방문지 */

  /** 구간별 거리: [사무실→첫곳, 첫곳→둘째, ..., 마지막→사무실] */
  function legs(m, order) {
    var out = [], prev = 0;
    for (var i = 0; i < order.length; i++) { out.push(m[prev][order[i]]); prev = order[i]; }
    out.push(m[prev][0]);
    return out;
  }

  /** 총 이동 거리(km) */
  function tourLength(m, order) {
    var sum = 0, l = legs(m, order);
    for (var i = 0; i < l.length; i++) sum += l[i];
    return sum;
  }

  /**
   * 정확한 최단 순서 (Held-Karp).
   * "어느 곳들을 이미 들렀고 지금 어디에 있는가"별로 최단 거리를 기록해 가며
   * 가능한 모든 순서를 빠짐없이 따집니다. 결과는 모든 순서를 하나씩 비교한 것과 같고,
   * 12곳도 휴대폰에서 즉시 계산됩니다. (하나씩 비교하면 12곳 = 약 4억 8천만 가지)
   */
  function solveExact(m) {
    var n = m.length - 1;
    if (n <= 0) return [];
    if (n === 1) return [1];
    var size = 1 << n, full = size - 1;
    var dp = new Float64Array(size * n).fill(Infinity);
    var parent = new Int8Array(size * n).fill(-1);
    var mask, j, k;
    for (j = 0; j < n; j++) dp[(1 << j) * n + j] = m[0][j + 1];
    for (mask = 1; mask < size; mask++) {
      for (j = 0; j < n; j++) {
        if (!(mask & (1 << j))) continue;
        var cur = dp[mask * n + j];
        if (cur === Infinity) continue;
        for (k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          var nm = mask | (1 << k);
          var cand = cur + m[j + 1][k + 1];
          if (cand < dp[nm * n + k]) { dp[nm * n + k] = cand; parent[nm * n + k] = j; }
        }
      }
    }
    var best = Infinity, last = -1;
    for (j = 0; j < n; j++) {
      var total = dp[full * n + j] + m[j + 1][0];
      if (total < best) { best = total; last = j; }
    }
    var order = [];
    mask = full;
    while (last !== -1) {
      order.push(last + 1);
      var p = parent[mask * n + last];
      mask ^= (1 << last);
      last = p;
    }
    return order.reverse();
  }

  /** 검증용: 정말로 모든 순서를 하나씩 만들어 비교 (느림, 9곳 이하에서만 사용 권장) */
  function solveBruteForce(m) {
    var n = m.length - 1, best = Infinity, bestOrder = [];
    var cur = [], used = [];
    (function walk() {
      if (cur.length === n) {
        var len = tourLength(m, cur);
        if (len < best) { best = len; bestOrder = cur.slice(); }
        return;
      }
      for (var i = 1; i <= n; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(i);
        walk();
        cur.pop(); used[i] = false;
      }
    })();
    return bestOrder;
  }

  /** 최근접 이웃: 지금 있는 곳에서 가장 가까운 곳을 다음 방문지로 */
  function nearestNeighbor(m) {
    var n = m.length - 1, visited = [], order = [], cur = 0;
    for (var step = 0; step < n; step++) {
      var best = -1;
      for (var i = 1; i <= n; i++) {
        if (visited[i]) continue;
        if (best === -1 || m[cur][i] < m[cur][best]) best = i;
      }
      visited[best] = true; order.push(best); cur = best;
    }
    return order;
  }

  /** 2-opt: 순서의 한 토막을 뒤집어 보고, 더 짧아지면 채택. 더 줄일 수 없을 때까지 반복 */
  function twoOpt(m, start) {
    var order = start.slice(), n = order.length;
    var best = tourLength(m, order), improved = true, guard = 0;
    while (improved && guard++ < 1000) {
      improved = false;
      for (var i = 0; i < n - 1; i++) {
        for (var k = i + 1; k < n; k++) {
          var cand = order.slice(0, i)
            .concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
          var len = tourLength(m, cand);
          if (len < best - 1e-9) { order = cand; best = len; improved = true; }
        }
      }
    }
    return order;
  }

  /** 개수에 따라 알맞은 방법을 골라 계산 */
  function solve(m) {
    var n = m.length - 1, order, method;
    if (n <= EXACT_LIMIT) { order = solveExact(m); method = 'exact'; }
    else { order = twoOpt(m, nearestNeighbor(m)); method = 'approx'; }
    return { order: order, km: tourLength(m, order), method: method };
  }

  return {
    EXACT_LIMIT: EXACT_LIMIT,
    haversineKm: haversineKm,
    setDistanceProvider: setDistanceProvider,
    buildMatrix: buildMatrix,
    legs: legs,
    tourLength: tourLength,
    solveExact: solveExact,
    solveBruteForce: solveBruteForce,
    nearestNeighbor: nearestNeighbor,
    twoOpt: twoOpt,
    solve: solve
  };
});
