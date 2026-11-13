/*
 * drive.js — 구글 드라이브에 데이터 파일 1개를 저장하고 가져오기
 *
 * - 서버 없이 브라우저에서 구글 로그인 창(Google Identity Services)으로 허락을 받습니다.
 * - 권한은 "이 앱이 만든 파일만"(drive.file) 입니다. 드라이브의 다른 파일은 볼 수 없습니다.
 * - 허락은 약 1시간 유지됩니다. 지나면 "드라이브 연결"을 한 번 더 눌러야 합니다.
 */
(function (root) {
  'use strict';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FILE_NAME = 'mimifresh-data.json';
  var API = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  var state = { gis: 'none', message: '' }; // gis: none | loading | ready | error
  var token = '', expiresAt = 0, client = null, clientIdUsed = '', fileId = '', pending = null, gisLoading = null;

  /** 구글 로그인 프로그램을 미리 불러 둔다 (버튼을 눌렀을 때 창이 바로 뜨게 하려고) */
  function preload(clientId) {
    if (!clientId) return Promise.reject(new Error('구글 클라이언트 ID가 없습니다.'));
    if (state.gis === 'ready') { init(clientId); return Promise.resolve(); }
    if (gisLoading) return gisLoading;
    state.gis = 'loading';
    gisLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () {
        if (!root.google || !google.accounts || !google.accounts.oauth2) { state.gis = 'error'; state.message = '구글 로그인 프로그램 응답이 올바르지 않습니다.'; gisLoading = null; return reject(new Error(state.message)); }
        state.gis = 'ready'; state.message = '';
        try { init(clientId); resolve(); } catch (e) { state.message = e.message; reject(e); }
      };
      s.onerror = function () { state.gis = 'error'; state.message = '구글 로그인 프로그램을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'; gisLoading = null; reject(new Error(state.message)); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }
  function init(clientId) {
    if (client && clientIdUsed === clientId) return;
    token = ''; expiresAt = 0; fileId = '';
    clientIdUsed = clientId;
    client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: function (r) {
        var p = pending; pending = null;
        if (!p) return;
        if (!r || r.error || !r.access_token) return p.reject(new Error('구글 드라이브 연결이 허락되지 않았습니다.' + (r && r.error ? ' (' + r.error + ')' : '')));
        token = r.access_token;
        expiresAt = Date.now() + (Math.max(120, parseInt(r.expires_in, 10) || 3600) - 60) * 1000;
        p.resolve();
      },
      error_callback: function (e) {
        var p = pending; pending = null;
        if (!p) return;
        var t = e && e.type;
        p.reject(new Error(t === 'popup_failed_to_open' ? '로그인 창이 열리지 않았습니다. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.' :
          t === 'popup_closed' ? '로그인 창이 닫혔습니다. 다시 눌러 주세요.' : '구글 로그인에 실패했습니다.'));
      }
    });
  }

  function connected() { return !!token && Date.now() < expiresAt; }

  /** 반드시 사용자가 버튼을 누른 순간에 호출 (로그인 창이 뜸) */
  function connect(clientId) {
    if (connected() && clientIdUsed === clientId) return Promise.resolve();
    if (state.gis !== 'ready') {
      // 아직 준비 전이면 불러온 뒤 한 번 더 눌러 달라고 안내 (창은 누른 순간에만 열 수 있음)
      return preload(clientId).then(function () { throw new Error('준비가 끝났습니다. 한 번 더 눌러 주세요.'); });
    }
    init(clientId);
    return new Promise(function (resolve, reject) {
      if (pending) pending.reject(new Error('다시 시도합니다.'));
      pending = { resolve: resolve, reject: reject };
      try { client.requestAccessToken({ prompt: '' }); }
      catch (e) { pending = null; reject(new Error('구글 로그인 창을 열지 못했습니다.')); }
    });
  }

  function call(url, opt) {
    if (!connected()) return Promise.reject(new Error('구글 드라이브 연결이 끊겼습니다. 다시 연결해 주세요.'));
    opt = opt || {};
    opt.headers = Object.assign({ Authorization: 'Bearer ' + token }, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { token = ''; throw new Error('구글 드라이브 연결이 끊겼습니다. 다시 연결해 주세요.'); }
      if (r.status === 403) return r.text().then(function (t) {
        throw new Error(/accessNotConfigured|has not been used|disabled/i.test(t) ? '구글 클라우드에서 "Google Drive API"를 사용 설정해야 합니다.' : '구글 드라이브가 요청을 거절했습니다. (403)');
      });
      if (r.status === 404) { fileId = ''; throw new Error('드라이브의 저장 파일을 찾지 못했습니다. 다시 시도해 주세요.'); }
      if (!r.ok) throw new Error('구글 드라이브 오류가 났습니다. (' + r.status + ')');
      return r;
    });
  }

  /** 이 앱이 만든 저장 파일 찾기 → {id, modifiedTime} 또는 null */
  function find() {
    var q = "name='" + FILE_NAME + "' and trashed=false";
    return call(API + '?q=' + encodeURIComponent(q) + '&spaces=drive&orderBy=modifiedTime%20desc&pageSize=1&fields=' + encodeURIComponent('files(id,name,modifiedTime)'))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var f = j.files && j.files[0];
        fileId = f ? f.id : '';
        return f ? { id: f.id, modifiedTime: f.modifiedTime } : null;
      });
  }

  /** 내용 저장 (없으면 새로 만들고, 있으면 덮어씀) → {id, modifiedTime} */
  function save(text) {
    var go = function () {
      if (fileId) {
        return call(UPLOAD + '/' + encodeURIComponent(fileId) + '?uploadType=media&fields=id,modifiedTime', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      }
      var boundary = 'mimi' + Date.now().toString(36);
      var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' }) +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
      return call(UPLOAD + '?uploadType=multipart&fields=id,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body });
    };
    return (fileId ? Promise.resolve() : find()).then(go)
      .then(function (r) { return r.json(); })
      .then(function (j) { fileId = j.id; return { id: j.id, modifiedTime: j.modifiedTime }; });
  }

  /** 저장 파일 내용 가져오기 → 글자(JSON) */
  function download(id) {
    return call(API + '/' + encodeURIComponent(id) + '?alt=media').then(function (r) { return r.text(); });
  }

  function disconnect() { token = ''; expiresAt = 0; fileId = ''; }

  root.Drive = { FILE_NAME: FILE_NAME, state: state, preload: preload, connect: connect, connected: connected, find: find, save: save, download: download, disconnect: disconnect };
})(window);
