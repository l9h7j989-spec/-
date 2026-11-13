/*
 * cloud.js — 로그인과 기기 간 저장 (Supabase)
 *
 * - 이메일·비밀번호로 한 번 로그인하면 계속 로그인된 채로 유지됩니다. (브라우저 데이터를 지우기 전까지)
 * - 로그인한 사람마다 표(mimifresh)에 줄이 하나 있고, 본인 줄만 읽고 쓸 수 있습니다.
 * - 다른 기기가 먼저 바꾼 내용을 모르고 덮어쓰지 않도록, 저장할 때 "내가 마지막으로 본 시각"을 함께 확인합니다.
 */
(function (root) {
  'use strict';
  var TABLE = 'mimifresh';
  var client = null, user = null, listeners = [];

  function configured() { return !!client; }
  function init(url, key) {
    client = null; user = null;
    if (!url || !key) return false;
    if (!root.supabase || !root.supabase.createClient) throw new Error('로그인 프로그램을 불러오지 못했습니다.');
    client = root.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'mimifresh.auth' } });
    client.auth.onAuthStateChange(function (event, session) {
      var before = user && user.id;
      user = session ? session.user : null;
      if ((user && user.id) !== before) listeners.forEach(function (fn) { fn(user); });
    });
    return true;
  }
  function onUserChange(fn) { listeners.push(fn); }
  function email() { return user ? user.email : ''; }
  function signedIn() { return !!user; }

  function msg(error) {
    var m = String((error && error.message) || error || ''), code = error && (error.code || error.status);
    if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/Email not confirmed/i.test(m)) return '가입 확인 메일의 링크를 먼저 눌러 주세요.';
    if (/already registered|already been registered/i.test(m)) return '이미 가입된 이메일입니다. 로그인해 주세요.';
    if (/Password should be at least|weak/i.test(m)) return '비밀번호가 너무 짧거나 단순합니다. 더 길게 만들어 주세요.';
    if (/Signups not allowed|signup.*disabled/i.test(m)) return '새 가입이 막혀 있습니다. 이미 만든 계정으로 로그인해 주세요.';
    if (/rate limit|too many/i.test(m)) return '잠시 뒤에 다시 시도해 주세요. (요청이 너무 잦습니다)';
    if (/valid email|invalid.*email/i.test(m)) return '이메일 주소를 다시 확인해 주세요.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
    if (/relation .* does not exist|Could not find the table|schema cache/i.test(m) || code === '42P01' || code === 'PGRST205') return '서버에 저장용 표가 없습니다. supabase-setup.sql 을 SQL Editor 에서 실행해 주세요.';
    if (/JWT|Invalid API key|No API key/i.test(m)) return 'Supabase 주소 또는 공개 키가 맞지 않습니다.';
    return m || '알 수 없는 오류가 났습니다.';
  }
  function fail(error) { var e = new Error(msg(error)); e.raw = error; return e; }

  /** 앱을 열 때: 저장된 로그인이 있으면 이어서 쓴다 */
  function restore() {
    if (!client) return Promise.resolve(null);
    return client.auth.getSession().then(function (r) { user = r.data && r.data.session ? r.data.session.user : null; return user; }, function () { return null; });
  }
  function signIn(mail, password) {
    return client.auth.signInWithPassword({ email: mail, password: password }).then(function (r) {
      if (r.error) throw fail(r.error);
      user = r.data.user; return user;
    }, function (e) { throw fail(e); });
  }
  /** 가입. 메일 확인이 필요하게 설정돼 있으면 { needConfirm: true } */
  function signUp(mail, password) {
    return client.auth.signUp({ email: mail, password: password }).then(function (r) {
      if (r.error) throw fail(r.error);
      if (!r.data.session) return { needConfirm: true };
      user = r.data.user; return { needConfirm: false };
    }, function (e) { throw fail(e); });
  }
  function signOut() { return client.auth.signOut().then(function () { user = null; }, function () { user = null; }); }

  /** 서버 내용이 마지막으로 바뀐 시각만 확인 (없으면 null) */
  function stamp() {
    return client.from(TABLE).select('updated_at').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw fail(r.error);
      return r.data ? r.data.updated_at : null;
    });
  }
  /** 서버 내용 가져오기 → { data, updated_at } 또는 null */
  function pull() {
    return client.from(TABLE).select('data, updated_at').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw fail(r.error);
      return r.data || null;
    });
  }
  /**
   * 서버에 저장 → 새 updated_at.
   * expected: 내가 마지막으로 본 서버 시각(없으면 '' = 아직 줄이 없다고 알고 있음).
   * 그 사이 다른 기기가 바꿨으면 e.conflict = true 인 오류를 던진다.
   */
  function push(data, expected) {
    var now = new Date().toISOString(), q;
    if (!expected) q = client.from(TABLE).insert({ user_id: user.id, data: data, updated_at: now }).select('updated_at');
    else q = client.from(TABLE).update({ data: data, updated_at: now }).eq('user_id', user.id).eq('updated_at', expected).select('updated_at');
    return q.then(function (r) {
      if (r.error) {
        if (r.error.code === '23505') { var c = new Error('다른 기기에서 먼저 저장했습니다.'); c.conflict = true; throw c; }
        throw fail(r.error);
      }
      if (!r.data || !r.data.length) { var e = new Error('다른 기기에서 먼저 저장했습니다.'); e.conflict = true; throw e; }
      return r.data[0].updated_at;
    });
  }
  function pullTemplate() {
    return client.from(TABLE).select('template').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw fail(r.error);
      return r.data ? r.data.template : null;
    });
  }
  /** 양식만 따로 저장 (내용 저장 시각은 건드리지 않음). 줄이 아직 없으면 false */
  function pushTemplate(b64) {
    return client.from(TABLE).update({ template: b64 }).eq('user_id', user.id).select('user_id').then(function (r) {
      if (r.error) throw fail(r.error);
      return !!(r.data && r.data.length);
    });
  }

  root.Cloud = { configured: configured, init: init, onUserChange: onUserChange, email: email, signedIn: signedIn, restore: restore, signIn: signIn, signUp: signUp, signOut: signOut, stamp: stamp, pull: pull, push: push, pullTemplate: pullTemplate, pushTemplate: pushTemplate };
})(window);
