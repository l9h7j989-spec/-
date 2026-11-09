// 오프라인 캐시: 앱 파일을 저장해 두고, 새 버전이 있으면 네트워크 것을 쓴다.
const CACHE = 'plumbing-v4';
const FILES = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'config.js', 'vendor/jszip.min.js', 'vendor/supabase.js', 'js/sync.js', 'icon-maskable-512.png', 'js/estimate-core.js', 'js/hwpx.js', 'js/db.js', 'js/app.js', 'templates/estimate_template.hwpx'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // Supabase/카카오 요청은 캐시 안 함
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
