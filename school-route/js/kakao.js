/*
 * kakao.js — 카카오맵 JavaScript SDK 불러오기 + 장소 검색 + 주소→좌표 변환
 * 키는 설정 화면에서 입력한 값을 사용합니다.
 */
(function (root) {
  'use strict';
  var state = { status: 'none', message: '' }; // none | loading | ready | error
  var loading = null;

  function load(key) {
    if (!key) { state.status = 'none'; state.message = ''; return Promise.reject(new Error('카카오 키가 없습니다.')); }
    if (state.status === 'ready') return Promise.resolve();
    if (loading) return loading;
    state.status = 'loading';
    loading = new Promise(function (resolve, reject) {
      var done = false;
      var fail = function (msg) {
        if (done) return; done = true;
        state.status = 'error'; state.message = msg; loading = null;
        reject(new Error(msg));
      };
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&libraries=services&autoload=false';
      s.onerror = function () {
        fail('카카오맵을 불러오지 못했습니다. ① 키가 맞는지 ② 카카오 개발자 사이트에 이 사이트 주소(' + location.origin + ')를 등록했는지 ③ 카카오맵 사용 설정을 켰는지 ④ 인터넷 연결을 확인해 주세요.');
      };
      s.onload = function () {
        if (!root.kakao || !root.kakao.maps || !root.kakao.maps.load) return fail('카카오맵 응답이 올바르지 않습니다. 키를 다시 확인해 주세요.');
        root.kakao.maps.load(function () {
          if (done) return; done = true;
          state.status = 'ready'; state.message = '';
          resolve();
        });
      };
      setTimeout(function () { fail('카카오맵 연결 시간이 초과되었습니다. 인터넷 연결을 확인해 주세요.'); }, 15000);
      document.head.appendChild(s);
    });
    return loading;
  }

  function needReady() {
    if (state.status !== 'ready') throw new Error(state.message || '카카오맵이 연결되지 않았습니다. 설정에서 카카오 키를 먼저 입력해 주세요.');
  }

  /** 이름(키워드)으로 장소 검색 → [{name,address,lat,lng,phone,placeId}] */
  function searchPlaces(query, size) {
    return new Promise(function (resolve, reject) {
      try { needReady(); } catch (e) { return reject(e); }
      var S = kakao.maps.services;
      var opt = size ? { size: size } : undefined;
      new S.Places().keywordSearch(query, function (data, status) {
        if (status === S.Status.OK) {
          resolve(data.map(function (d) {
            return {
              name: d.place_name,
              address: d.road_address_name || d.address_name || '',
              lat: parseFloat(d.y), lng: parseFloat(d.x),
              phone: d.phone || '', placeId: d.id || ''
            };
          }));
        } else if (status === S.Status.ZERO_RESULT) resolve([]);
        else reject(new Error('장소 검색 중 오류가 났습니다. 잠시 후 다시 시도해 주세요.'));
      }, opt);
    });
  }

  /** 주소 → 좌표 변환 → [{name,address,lat,lng}] */
  function geocode(address) {
    return new Promise(function (resolve, reject) {
      try { needReady(); } catch (e) { return reject(e); }
      var S = kakao.maps.services;
      new S.Geocoder().addressSearch(address, function (data, status) {
        if (status === S.Status.OK) {
          resolve(data.map(function (d) {
            var addr = (d.road_address && d.road_address.address_name) || d.address_name || address;
            return { name: addr, address: addr, lat: parseFloat(d.y), lng: parseFloat(d.x), phone: '', placeId: '' };
          }));
        } else if (status === S.Status.ZERO_RESULT) resolve([]);
        else reject(new Error('주소 검색 중 오류가 났습니다. 잠시 후 다시 시도해 주세요.'));
      });
    });
  }

  /* ---------- 자동차 실제 경로 (카카오모빌리티 길찾기) ---------- */
  var NAVI = 'https://apis-navi.kakaomobility.com/v1/';
  /** 출발·도착이 서로 다른 한 구간 묶음을 조회 → { legs:[{km,min}], path:[{lat,lng}] } */
  function fetchRoute(restKey, points) {
    var P = function (p) { return { name: String(p.name || '').slice(0, 30), x: p.lng, y: p.lat }; };
    var headers = { 'Content-Type': 'application/json', Authorization: 'KakaoAK ' + restKey };
    var req;
    if (points.length === 2) { // 경유지가 없으면 기본 길찾기
      req = fetch(NAVI + 'directions?origin=' + points[0].lng + ',' + points[0].lat + '&destination=' + points[1].lng + ',' + points[1].lat + '&priority=RECOMMEND', { headers: headers });
    } else { // 경유지 최대 30곳
      req = fetch(NAVI + 'waypoints/directions', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ origin: P(points[0]), destination: P(points[points.length - 1]), waypoints: points.slice(1, -1).map(P), priority: 'RECOMMEND' })
      });
    }
    return req.then(function (r) {
      if (r.status === 401) throw new Error('카카오 REST API 키를 확인해 주세요. (키에 "호출 허용 IP"를 등록했다면 비워야 합니다)');
      if (r.status === 403) throw new Error('이 키로는 자동차 길찾기를 쓸 수 없습니다. 카카오 개발자 사이트에서 권한을 확인해 주세요.');
      if (r.status === 429) throw new Error('오늘 자동차 경로 조회 한도를 넘었습니다.');
      if (!r.ok) throw new Error('자동차 경로를 가져오지 못했습니다. (' + r.status + ')');
      return r.json();
    }, function () {
      throw new Error('자동차 경로 서버에 연결하지 못했습니다.');
    }).then(function (j) {
      var rt = j && j.routes && j.routes[0];
      if (!rt || rt.result_code !== 0) {
        var err = new Error('자동차 경로를 찾지 못했습니다.' + (rt && rt.result_msg ? ' (' + rt.result_msg + ')' : ''));
        err.code = rt ? rt.result_code : -1;
        throw err;
      }
      var path = [], legs = [];
      (rt.sections || []).forEach(function (sec) {
        legs.push({ km: sec.distance / 1000, min: sec.duration / 60 });
        (sec.roads || []).forEach(function (road) {
          var v = road.vertexes || []; // [경도, 위도, 경도, 위도, ...]
          for (var i = 0; i + 1 < v.length; i += 2) path.push({ lat: v[i + 1], lng: v[i] });
        });
      });
      if (legs.length !== points.length - 1 || path.length < 2) throw new Error('자동차 경로 응답이 예상과 다릅니다.');
      return { legs: legs, path: path };
    });
  }
  /**
   * 사무실 → 방문지들 → 사무실 한 바퀴.  points: [출발, 방문지..., 도착(=출발)]
   * → { km, min, legs:[{km,min}], path:[{lat,lng}] }
   * 출발지와 도착지가 같은 좌표라 거절(결과 코드 104)되면 "가는 길"과 "돌아오는 길"로 나눠 두 번 조회합니다.
   */
  function roadRoute(restKey, points) {
    if (points.length - 2 > 30) return Promise.reject(new Error('자동차 경로는 방문지 30곳까지만 조회할 수 있습니다.'));
    var finish = function (r) {
      var km = 0, min = 0;
      r.legs.forEach(function (l) { km += l.km; min += l.min; });
      return { km: km, min: min, legs: r.legs, path: r.path };
    };
    return fetchRoute(restKey, points).then(finish, function (e) {
      if (e.code !== 104) throw e;
      return Promise.all([fetchRoute(restKey, points.slice(0, -1)), fetchRoute(restKey, points.slice(-2))]).then(function (r) {
        return finish({ legs: r[0].legs.concat(r[1].legs), path: r[0].path.concat(r[1].path) });
      });
    });
  }

  /** 카카오맵 길안내 링크 (휴대폰에서는 카카오맵 앱으로 이어집니다) */
  function navLink(p) {
    var name = String(p.name || '목적지').replace(/,/g, ' ');
    return 'https://map.kakao.com/link/to/' + encodeURIComponent(name) + ',' + p.lat + ',' + p.lng;
  }

  /* ---------- 카카오내비 앱으로 바로 길안내 ---------- */
  var NAVI_SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js';
  var naviLoading = null;
  /** 미리 불러 두기 (단추를 누른 순간 바로 앱이 열리게) */
  function naviPreload(jsKey) {
    if (root.Kakao && root.Kakao.Navi) { if (!root.Kakao.isInitialized()) root.Kakao.init(jsKey); return Promise.resolve(); }
    if (naviLoading) return naviLoading;
    naviLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = NAVI_SDK; s.crossOrigin = 'anonymous';
      s.onload = function () {
        try { if (!root.Kakao.isInitialized()) root.Kakao.init(jsKey); resolve(); }
        catch (e) { naviLoading = null; reject(new Error('카카오내비 연결에 실패했습니다. 카카오 JavaScript 키를 확인해 주세요.')); }
      };
      s.onerror = function () { naviLoading = null; reject(new Error('카카오내비 프로그램을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
    return naviLoading;
  }
  /** 카카오내비 실행. 준비가 됐으면 true, 아직이면 불러오기만 하고 false */
  function naviStart(jsKey, p) {
    if (!(root.Kakao && root.Kakao.Navi && root.Kakao.isInitialized())) { naviPreload(jsKey).catch(function () { }); return false; }
    root.Kakao.Navi.start({ name: String(p.name || '목적지').slice(0, 40), x: p.lng, y: p.lat, coordType: 'wgs84' });
    return true;
  }

  root.KakaoApi = { state: state, load: load, naviPreload: naviPreload, naviStart: naviStart, searchPlaces: searchPlaces, geocode: geocode, roadRoute: roadRoute, navLink: navLink };
})(window);
