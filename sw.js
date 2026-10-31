const CACHE = 'ingatabsen-shell-v2';
const VIBRATE = [1500, 300, 1500, 300, 1500, 300, 1500];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('ingatabsen-') && k !== CACHE && k !== CACHE + '-cdn').map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { // network-first: selalu versi terbaru, cache hanya cadangan offline
        const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(rej, 4000))]);
        if (r.ok && !r.redirected) cache.put(req, r.clone());
        return r;
      } catch {
        return (await cache.match(req)) || (await cache.match('/')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  if (['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'].includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE + '-cdn');
      const cached = await cache.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }).catch(() => null);
      return cached || (await net) || new Response('', { status: 503 });
    })());
  }
});

async function tellClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => c.postMessage(msg));
  return list;
}
function badge(n) { try { n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge(); } catch {} }

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const meta = d.data || { url: '/' };
  const opts = {
    body: d.body || 'Waktunya melakukan presensi.',
    icon: d.icon || '/icons/icon-192.png',
    badge: d.badge || '/icons/icon-192.png',
    tag: d.tag || 'ingatabsen-reminder',
    renotify: true, requireInteraction: true, silent: false,
    vibrate: d.vibrate || VIBRATE, timestamp: Date.now(), data: meta
  };
  if (meta.type) opts.actions = [{ action: 'done', title: '✔ Sudah Absen' }, { action: 'snooze', title: '⏱ Tunda' }];
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'IngatAbsen', opts);
    if (meta.type) {
      badge(1);
      // Efek 'telepon': tampilkan ulang (getar lagi) tiap 6 dtk selama notifikasi belum diklik/ditutup.
      for (let i = 0; i < 6; i++) {
        await sleep(6000);
        const still = await self.registration.getNotifications({ tag: opts.tag });
        if (!still.length) break;
        await self.registration.showNotification(d.title || 'IngatAbsen', opts);
      }
    }
    await tellClients({ type: 'reminder', reminderType: meta.type || null, title: d.title, body: d.body });
  })());
});

async function ack(text, silent = true) {
  await self.registration.showNotification('IngatAbsen', { body: text, tag: 'ingatabsen-ack', silent, icon: '/icons/icon-192.png' });
  if (silent) setTimeout(async () => (await self.registration.getNotifications({ tag: 'ingatabsen-ack' })).forEach(n => n.close()), 3500);
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
}

self.addEventListener('notificationclick', e => {
  const n = e.notification, d = n.data || {};
  n.close();
  e.waitUntil((async () => {
    if ((e.action === 'done' || e.action === 'snooze') && d.deviceId) {
      try {
        if (e.action === 'done') {
          await post('/api/checkin', { deviceId: d.deviceId, type: d.type, checked: true, date: d.date });
          badge(0);
          await tellClients({ type: 'checkin', reminderType: d.type, date: d.date });
          await ack('Presensi ditandai selesai ✔');
        } else {
          await post('/api/snooze', { deviceId: d.deviceId, type: d.type, minutes: d.snoozeMinutes || 10 });
          await tellClients({ type: 'snooze', reminderType: d.type, minutes: d.snoozeMinutes || 10 });
          await ack(`Diingatkan lagi ${d.snoozeMinutes || 10} menit lagi ⏱`);
        }
      } catch { await ack('Gagal terhubung. Buka aplikasi untuk menandai presensi.', false); }
      return;
    }
    const list = await tellClients({ type: 'focus' });
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus();
    return self.clients.openWindow(d.url || '/');
  })());
});
