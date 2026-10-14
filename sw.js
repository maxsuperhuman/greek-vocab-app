const CACHE = 'greek-vocab-v30';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (!req.url.startsWith('http') || req.method !== 'GET') return;
  // Never cache API calls
  if (req.url.includes('api.anthropic.com') || req.url.includes('supabase')) return;

  const isPage = req.mode === 'navigate' || req.url.endsWith('.html') || req.url.endsWith('/');
  if (isPage) {
    // Network-first for the app shell so new deploys show up immediately; cache is the offline fallback
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for static assets (CDN scripts, icons)
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
