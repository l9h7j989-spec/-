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
  function searchPlaces(query) {
    return new Promise(function (resolve, reject) {
      try { needReady(); } catch (e) { return reject(e); }
      var S = kakao.maps.services;
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
      });
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

  /** 카카오맵 길안내 링크 (휴대폰에서는 카카오맵 앱으로 이어집니다) */
  function navLink(p) {
    var name = String(p.name || '목적지').replace(/,/g, ' ');
    return 'https://map.kakao.com/link/to/' + encodeURIComponent(name) + ',' + p.lat + ',' + p.lng;
  }

  root.KakaoApi = { state: state, load: load, searchPlaces: searchPlaces, geocode: geocode, navLink: navLink };
})(window);
