const CACHE_NAME = 'ingatabsen-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ingatabsen-') && k !== CACHE_NAME && k !== CACHE_NAME + '-cdn').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        event.waitUntil(fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); }).catch(() => {}));
        return cached;
      }
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch {
        return cache.match('/');
      }
    })());
    return;
  }
  if (['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'].includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME + '-cdn');
      const cached = await cache.match(req);
      const network = fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
        return r;
      }).catch(() => null);
      return cached || await network || new Response('', {status: 503});
    })());
  }
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = {body: event.data?.text() || ''}; }
  event.waitUntil(self.registration.showNotification(data.title || 'IngatAbsen', {
    body: data.body || 'Waktunya melakukan presensi.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'ingatabsen-reminder',
    renotify: true,
    requireInteraction: true,
    data: data.data || {url: '/'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
