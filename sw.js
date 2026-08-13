// 彩虹 PWA Service Worker —— 应用壳缓存 + 离线兜底
const CACHE = 'rainbow-v14';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/supabase.js',
  './js/config.js',
  './js/ui.js',
  './js/views/home.js',
  './js/views/memory.js',
  './js/views/chat.js',
  './js/views/mine.js',
  './js/views/pairing.js',
  './js/views/onboarding.js',
  './js/views/anniversary.js',
  './js/views/plan.js',
  './js/views/task.js',
  './js/views/movie.js',
  './js/views/movie-search.js',
  './js/views/checkin.js',
  './js/views/api-config.js',
  './js/views/settings.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isLocal = url.origin === self.location.origin;

  // 本地应用代码（html/js/css）：网络优先 + 强制绕过浏览器 HTTP 缓存，
  // 确保改了文件立即生效（Python 静态服务器不发送 Cache-Control，否则会被磁盘缓存成旧版）；
  // 断网再回退缓存（离线可开）
  if (isLocal) {
    event.respondWith(
      fetch(req, { cache: 'reload' })
        .then((r) => { cachePut(req, r.clone()); return r; })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 外部 CDN（Supabase / jsdelivr）：stale-while-revalidate，加速且容忍网络抖动
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((r) => { cachePut(req, r.clone()); return r; })
        .catch(() => cached);
      return cached || network;
    })
  );
});

function cachePut(req, res) {
  if (res && (res.status === 200 || res.type === 'opaque')) {
    caches.open(CACHE).then((c) => c.put(req, res));
  }
}
