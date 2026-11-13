/*
 * 동선 계산 검증 — 실행: node test/verify.js
 * 1) 샘플 5곳: "정말로 모든 순서(120가지)를 하나씩 비교한 결과"와 앱의 계산이 같은지
 * 2) 무작위 2,000문제(1~9곳): 위와 같은 비교
 * 3) 13~15곳: 근사 계산(최근접 이웃 + 2-opt)이 정답보다 얼마나 긴지
 */
var path = require('path');
var Route = require(path.join(__dirname, '..', 'js', 'route.js'));
global.self = global;
require(path.join(__dirname, '..', 'js', 'store.js'));
var Store = global.Store;

var fail = 0;
function check(ok, msg) { console.log((ok ? '  통과  ' : '  실패  ') + msg); if (!ok) fail++; }
function rnd(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

(async function () {
  console.log('\n[0] 하버사인 거리 공식 점검');
  var d1 = Route.haversineKm({ lat: 37, lng: 127 }, { lat: 38, lng: 127 });
  check(Math.abs(d1 - 111.195) < 0.01, '위도 1도 차이 = ' + d1.toFixed(3) + 'km (이론값 111.195km)');
  var d2 = Route.haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
  check(Math.abs(d2 - Math.PI * 6371.0088) < 0.001, '지구 반 바퀴 = ' + d2.toFixed(1) + 'km (이론값 ' + (Math.PI * 6371.0088).toFixed(1) + 'km)');

  console.log('\n[1] 샘플 5곳 (사무실: ' + Store.SAMPLE_OFFICE.name + ')');
  var pts = [Store.SAMPLE_OFFICE].concat(Store.SAMPLE_CLIENTS);
  var m = await Route.buildMatrix(pts);
  Store.SAMPLE_CLIENTS.forEach(function (c, i) { console.log('    사무실 → ' + c.name + ' : ' + m[0][i + 1].toFixed(2) + 'km'); });
  // 120가지 순서를 전부 나열
  var all = [];
  (function perm(cur, rest) {
    if (!rest.length) return all.push(cur);
    rest.forEach(function (x, i) { perm(cur.concat(x), rest.slice(0, i).concat(rest.slice(i + 1))); });
  })([], [1, 2, 3, 4, 5]);
  all = all.map(function (o) { return { o: o, km: Route.tourLength(m, o) }; }).sort(function (a, b) { return a.km - b.km; });
  var r = Route.solve(m);
  var names = function (o) { return o.map(function (i) { return pts[i].name.replace('(샘플) ', ''); }).join(' → '); };
  console.log('    앱의 추천: 사무실 → ' + names(r.order) + ' → 사무실');
  console.log('    구간별: ' + Route.legs(m, r.order).map(function (x) { return x.toFixed(2); }).join(' + ') + ' = ' + r.km.toFixed(2) + 'km');
  console.log('    전체 120가지 중 가장 짧은 것: ' + all[0].km.toFixed(4) + 'km / 가장 긴 것: ' + all[119].km.toFixed(2) + 'km');
  check(all.length === 120, '순서 120가지를 모두 만들었음');
  check(r.method === 'exact', '5곳은 "정확한 계산" 방식 사용');
  check(Math.abs(r.km - all[0].km) < 1e-9, '앱의 추천 거리 = 120가지 중 최솟값');
  check(r.order.slice().sort().join() === '1,2,3,4,5', '5곳을 빠짐없이 한 번씩 방문');
  check(Math.abs(Route.legs(m, r.order).reduce(function (a, b) { return a + b; }, 0) - r.km) < 1e-9, '구간 거리의 합 = 총 거리');

  console.log('\n[2] 무작위 문제 2,000개 (1~9곳) — 전부 나열한 정답과 비교');
  var R = rnd(42), bad = 0;
  for (var t = 0; t < 2000; t++) {
    var n = 1 + Math.floor(R() * 9), p = [];
    for (var i = 0; i <= n; i++) p.push({ lat: 35 + R() * 3, lng: 126 + R() * 3 });
    var mm = await Route.buildMatrix(p);
    var a = Route.tourLength(mm, Route.solveExact(mm)), b = Route.tourLength(mm, Route.solveBruteForce(mm));
    if (Math.abs(a - b) > 1e-9) bad++;
  }
  check(bad === 0, '2,000문제 모두 일치 (불일치 ' + bad + '건)');

  console.log('\n[2-1] 가는 길과 오는 길 거리가 다른 경우(나중에 도로거리 API 대비) 300문제');
  bad = 0;
  for (t = 0; t < 300; t++) {
    n = 2 + Math.floor(R() * 6); mm = [];
    for (i = 0; i <= n; i++) { mm.push([]); for (var j = 0; j <= n; j++) mm[i].push(i === j ? 0 : 1 + R() * 20); }
    if (Math.abs(Route.tourLength(mm, Route.solveExact(mm)) - Route.tourLength(mm, Route.solveBruteForce(mm))) > 1e-9) bad++;
  }
  check(bad === 0, '300문제 모두 일치 (불일치 ' + bad + '건)');

  console.log('\n[3] 12곳 계산 속도');
  p = []; for (i = 0; i <= 12; i++) p.push({ lat: 37.4 + R() * 0.3, lng: 126.8 + R() * 0.4 });
  mm = await Route.buildMatrix(p);
  var t0 = Date.now(); r = Route.solve(mm); var ms = Date.now() - t0;
  check(r.method === 'exact' && ms < 1000, '12곳 정확 계산 ' + ms + 'ms (이 컴퓨터 기준)');

  console.log('\n[4] 근사 계산(13~15곳) 200문제 — 정답 대비 얼마나 긴가');
  var worst = 0, sum = 0, exactHit = 0, cnt = 200;
  for (t = 0; t < cnt; t++) {
    n = 13 + Math.floor(R() * 3); p = [];
    for (i = 0; i <= n; i++) p.push({ lat: 37.4 + R() * 0.3, lng: 126.8 + R() * 0.4 });
    mm = await Route.buildMatrix(p);
    var ap = Route.solve(mm), ex = Route.tourLength(mm, Route.solveExact(mm));
    var gap = (ap.km / ex - 1) * 100;
    if (ap.method !== 'approx' || ap.order.slice().sort(function (x, y) { return x - y; }).join() !== p.slice(1).map(function (_, k) { return k + 1; }).join()) fail++;
    sum += gap; worst = Math.max(worst, gap); if (gap < 1e-7) exactHit++;
  }
  console.log('    평균 +' + (sum / cnt).toFixed(2) + '% / 최악 +' + worst.toFixed(2) + '% / 정답과 같은 경우 ' + exactHit + '/' + cnt);
  check(worst < 25, '근사 계산이 모든 곳을 한 번씩 방문하고, 정답보다 크게 길지 않음');

  console.log('\n' + (fail ? '결과: 실패 ' + fail + '건' : '결과: 모든 검증 통과') + '\n');
  process.exit(fail ? 1 : 0);
})();
