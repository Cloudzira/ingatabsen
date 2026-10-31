import { buildPushPayload } from '@block65/webcrypto-web-push';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const NEW_COLUMNS = {
  days: "TEXT DEFAULT '1,2,3,4,5,6'", repeat_count: 'INTEGER DEFAULT 2', repeat_interval: 'INTEGER DEFAULT 5',
  paused_until: 'TEXT', sent_count_masuk: 'INTEGER DEFAULT 0', sent_count_pulang: 'INTEGER DEFAULT 0',
  sent_at_masuk: 'INTEGER DEFAULT 0', sent_at_pulang: 'INTEGER DEFAULT 0',
  next_at_masuk: 'INTEGER DEFAULT 0', next_at_pulang: 'INTEGER DEFAULT 0',
  last_push_at: 'INTEGER DEFAULT 0', last_push_status: 'INTEGER DEFAULT 0'
};
let schemaReady = false;
// Database otomatis di-upgrade: tidak perlu menjalankan SQL manual lagi.
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (device_id TEXT PRIMARY KEY, subscription_json TEXT NOT NULL, time_masuk TEXT NOT NULL DEFAULT '07:00', time_pulang TEXT NOT NULL DEFAULT '15:00', timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta', masuk_checked_date TEXT, pulang_checked_date TEXT, last_sent_masuk TEXT, last_sent_pulang TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_test_queue (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, run_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  ]);
  const info = await env.DB.prepare('PRAGMA table_info(subscriptions)').all();
  const have = new Set((info.results || []).map(r => r.name));
  for (const [name, ddl] of Object.entries(NEW_COLUMNS)) {
    if (have.has(name)) continue;
    try { await env.DB.prepare(`ALTER TABLE subscriptions ADD COLUMN ${name} ${ddl}`).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
  schemaReady = true;
}

function parseSettings(b, strict) {
  const m = validTime(b.timeMasuk) ? b.timeMasuk : null, p = validTime(b.timePulang) ? b.timePulang : null;
  if (strict && (!m || !p)) return null;
  const days = Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  return {
    timeMasuk: m || '07:00', timePulang: p || '15:00',
    timezone: validTimeZone(b.timezone) ? b.timezone : 'Asia/Jakarta',
    days: (days.length ? days : [1, 2, 3, 4, 5, 6]).join(','),
    repeatCount: Math.min(5, Math.max(0, parseInt(b.repeatCount ?? 2, 10) || 0)),
    repeatInterval: Math.min(30, Math.max(1, parseInt(b.repeatInterval ?? 5, 10) || 5)),
    pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(b.pausedUntil || '') ? b.pausedUntil : null
  };
}

function localClock(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return {
    weekday: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay(),
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute)
  };
}

function validateSubscription(subscription) {
  return subscription &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.startsWith('https://') &&
    PUSH_HOSTS.test(new URL(subscription.endpoint).hostname) &&
    subscription.keys &&
    typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string';
}

function vapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error('VAPID secrets belum dikonfigurasi di Cloudflare.');
  }
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
}

async function sendPush(env, subscription, message, ttl = 3600) {
  const payload = await buildPushPayload({
    data: message,
    options: { ttl, urgency: 'high' }
  }, subscription, vapid(env));
  return fetch(subscription.endpoint, payload);
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20000) throw new Error('Payload terlalu besar.');
  return request.json();
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  await ensureSchema(env);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'Origin tidak diizinkan.' }, 403);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ ok: true, service: 'IngatAbsen Push API' });
  }
  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
  }
  if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);

  let body;
  try { body = await readBody(request); }
  catch (error) { return json({ error: error.message || 'JSON tidak valid.' }, 400); }

  const deviceId = String(body.deviceId || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(deviceId)) return json({ error: 'deviceId tidak valid.' }, 400);

  if (url.pathname === '/api/subscribe') {
    const subscription = body.subscription;
    if (!validateSubscription(subscription)) return json({ error: 'Data langganan push tidak valid.' }, 400);

    const c = parseSettings(body, false);
    await env.DB.prepare(`
      INSERT INTO subscriptions
        (device_id, subscription_json, time_masuk, time_pulang, timezone, days, repeat_count, repeat_interval, paused_until, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET
        subscription_json=excluded.subscription_json, time_masuk=excluded.time_masuk, time_pulang=excluded.time_pulang,
        timezone=excluded.timezone, days=excluded.days, repeat_count=excluded.repeat_count,
        repeat_interval=excluded.repeat_interval, paused_until=excluded.paused_until, updated_at=CURRENT_TIMESTAMP
    `).bind(deviceId, JSON.stringify(subscription), c.timeMasuk, c.timePulang, c.timezone, c.days, c.repeatCount, c.repeatInterval, c.pausedUntil).run();

    return json({ ok: true });
  }

  if (url.pathname === '/api/settings') {
    const c = parseSettings(body, true);
    if (!c) return json({ error: 'Format jam tidak valid.' }, 400);
    const result = await env.DB.prepare(`
      UPDATE subscriptions SET time_masuk=?, time_pulang=?, timezone=?, days=?, repeat_count=?, repeat_interval=?, paused_until=?, updated_at=CURRENT_TIMESTAMP
      WHERE device_id=?
    `).bind(c.timeMasuk, c.timePulang, c.timezone, c.days, c.repeatCount, c.repeatInterval, c.pausedUntil, deviceId).run();

    if (!result.meta?.changes) return json({ error: 'Perangkat belum mengaktifkan push.' }, 404);
    return json({ ok: true });
  }

  if (url.pathname === '/api/checkin') {
    const type = body.type === 'masuk' ? 'masuk' : body.type === 'pulang' ? 'pulang' : null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null;
    if (!type || !date || typeof body.checked !== 'boolean') {
      return json({ error: 'Status presensi tidak valid.' }, 400);
    }
    const column = type === 'masuk' ? 'masuk_checked_date' : 'pulang_checked_date';
    const result = await env.DB.prepare(
      `UPDATE subscriptions SET ${column}=?, updated_at=CURRENT_TIMESTAMP WHERE device_id=?`
    ).bind(body.checked ? date : null, deviceId).run();

    if (!result.meta?.changes) return json({ error: 'Perangkat belum terdaftar.' }, 404);
    return json({ ok: true });
  }

  if (url.pathname === '/api/state' || url.pathname === '/api/snooze') {
    const row = await env.DB.prepare('SELECT * FROM subscriptions WHERE device_id=?').bind(deviceId).first();
    if (!row) return json({ registered: false }, url.pathname === '/api/state' ? 200 : 404);
    const local = localClock(validTimeZone(row.timezone) ? row.timezone : 'Asia/Jakarta');
    if (url.pathname === '/api/state') {
      return json({ registered: true, masukChecked: row.masuk_checked_date === local.date, pulangChecked: row.pulang_checked_date === local.date,
        lastPushAt: row.last_push_at || 0, lastPushStatus: row.last_push_status || 0 });
    }
    const t = body.type === 'masuk' ? 'masuk' : body.type === 'pulang' ? 'pulang' : null;
    if (!t) return json({ error: 'Tipe tidak valid.' }, 400);
    const minutes = Math.min(60, Math.max(1, parseInt(body.minutes, 10) || 10));
    await env.DB.prepare(`UPDATE subscriptions SET sent_count_${t}=CASE WHEN last_sent_${t} IS ? THEN sent_count_${t} ELSE 0 END, next_at_${t}=?, last_sent_${t}=? WHERE device_id=?`)
      .bind(local.date, Math.floor(Date.now() / 1000) + minutes * 60, local.date, deviceId).run();
    return json({ ok: true, minutes });
  }

  if (url.pathname === '/api/unsubscribe') {
    await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(deviceId).run();
    return json({ ok: true });
  }

  if (url.pathname === '/api/test') {
    const row = await env.DB.prepare(
      'SELECT device_id FROM subscriptions WHERE device_id=?'
    ).bind(deviceId).first();
    if (!row) return json({ error: 'Perangkat belum terdaftar untuk push.' }, 404);

    if (body.mode === 'now') {
      const full = await env.DB.prepare('SELECT subscription_json FROM subscriptions WHERE device_id=?').bind(deviceId).first();
      const r = await sendPush(env, JSON.parse(full.subscription_json), {
        title: 'Tes notifikasi — IngatAbsen', body: 'Berhasil! Notifikasi dan getar dari server diterima.',
        tag: 'ingatabsen-test', data: { url: '/' } }, 600);
      if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(deviceId).run();
      return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
    }
    await env.DB.prepare('DELETE FROM push_test_queue WHERE device_id=?').bind(deviceId).run();
    // Queue the test for a future Cron run. This lets the user close the PWA
    // and lock the screen before the push is actually sent.
    const id = crypto.randomUUID();
    const runAt = Math.floor(Date.now() / 1000) + 120;
    await env.DB.prepare(
      'INSERT INTO push_test_queue (id, device_id, run_at, attempts) VALUES (?, ?, ?, 0)'
    ).bind(id, deviceId, runAt).run();
    return json({ ok: true, queued: true, runAt, delaySeconds: 120 }, 202);
  }

  return json({ error: 'Endpoint tidak ditemukan.' }, 404);
}

const GRACE_FIRST_MIN = 10, MAX_LATE_MIN = 180;

async function deliverReminder(env, row, t, local, nowSec) {
  const time = row[`time_${t}`];
  if (!validTime(time)) return;
  const days = String(row.days ?? '1,2,3,4,5,6').split(',').map(Number);
  if (!days.includes(local.weekday) || (row.paused_until && row.paused_until >= local.date)) return;
  if (row[`${t}_checked_date`] === local.date) return;

  const same = row[`last_sent_${t}`] === local.date;
  const count = same ? Number(row[`sent_count_${t}`] || 0) : 0;
  const sentAt = same ? Number(row[`sent_at_${t}`] || 0) : 0;
  const nextAt = same ? Number(row[`next_at_${t}`] || 0) : 0;
  const maxSends = 1 + Number(row.repeat_count ?? 2);
  const interval = Number(row.repeat_interval || 5) * 60;
  const elapsed = local.minutes - (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));

  let due = false;
  if (nextAt > 0) due = nowSec >= nextAt;                                   // sedang ditunda
  else if (count === 0) due = elapsed >= 0 && elapsed <= GRACE_FIRST_MIN;   // pengingat pertama
  else if (count < maxSends) due = nowSec >= sentAt + interval && elapsed <= MAX_LATE_MIN; // ulangi
  if (!due) return;

  const prev = { last: row[`last_sent_${t}`] ?? null, count: Number(row[`sent_count_${t}`] || 0), at: Number(row[`sent_at_${t}`] || 0), next: Number(row[`next_at_${t}`] || 0) };
  const claim = await env.DB.prepare(
    `UPDATE subscriptions SET last_sent_${t}=?, sent_count_${t}=?, sent_at_${t}=?, next_at_${t}=0
     WHERE device_id=? AND last_sent_${t} IS ? AND COALESCE(sent_count_${t},0)=? AND COALESCE(sent_at_${t},0)=?`
  ).bind(local.date, count + 1, nowSec, row.device_id, prev.last, prev.count, prev.at).run();
  if (!claim.meta?.changes) return;

  const label = t === 'masuk' ? 'masuk' : 'pulang';
  const n = count + 1;
  const rollback = () => env.DB.prepare(
    `UPDATE subscriptions SET last_sent_${t}=?, sent_count_${t}=?, sent_at_${t}=?, next_at_${t}=? WHERE device_id=? AND last_sent_${t}=? AND sent_at_${t}=?`
  ).bind(prev.last, prev.count, prev.at, prev.next, row.device_id, local.date, nowSec).run();

  try {
    const response = await sendPush(env, JSON.parse(row.subscription_json), {
      title: `⏰ Waktunya Presensi ${label === 'masuk' ? 'Masuk' : 'Pulang'}!`,
      body: n === 1 ? (t === 'masuk' ? 'Jangan lupa mengisi presensi kehadiran awal Anda.' : 'Saatnya melakukan presensi kepulangan hari ini.')
                    : `Pengingat ke-${n}: Anda belum menandai presensi ${label}.`,
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: `ingatabsen-${t}-${local.date}`,
      data: { url: '/', deviceId: row.device_id, type: t, date: local.date, snoozeMinutes: 10 }
    }, 3600);
    await env.DB.prepare('UPDATE subscriptions SET last_push_at=?, last_push_status=? WHERE device_id=?').bind(nowSec, response.status, row.device_id).run();
    if (response.status === 404 || response.status === 410) {
      await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(row.device_id).run();
    } else if (!response.ok) {
      await rollback();
      console.error('Push service error:', response.status, await response.text());
    }
  } catch (error) {
    await rollback();
    console.error('Push delivery failed:', row.device_id, error);
  }
}


async function runPushTestQueue(env) {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    'SELECT id, device_id, attempts FROM push_test_queue WHERE run_at <= ? ORDER BY run_at LIMIT 100'
  ).bind(now).all();

  for (const item of (result.results || [])) {
    const row = await env.DB.prepare(
      'SELECT subscription_json FROM subscriptions WHERE device_id=?'
    ).bind(item.device_id).first();
    if (!row) {
      await env.DB.prepare('DELETE FROM push_test_queue WHERE id=?').bind(item.id).run();
      continue;
    }
    try {
      const response = await sendPush(env, JSON.parse(row.subscription_json), {
        title: 'Tes push layar mati — IngatAbsen',
        body: 'Berhasil! Web Push diterima saat aplikasi tidak dibuka.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `ingatabsen-test-${item.id}`,
        data: { url: '/' }
      }, 3600);
      if (response.ok) {
        await env.DB.prepare('DELETE FROM push_test_queue WHERE id=?').bind(item.id).run();
      } else if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(item.device_id).run();
        await env.DB.prepare('DELETE FROM push_test_queue WHERE id=?').bind(item.id).run();
      } else {
        const attempts = Number(item.attempts || 0) + 1;
        if (attempts >= 3) {
          await env.DB.prepare('DELETE FROM push_test_queue WHERE id=?').bind(item.id).run();
        } else {
          await env.DB.prepare('UPDATE push_test_queue SET attempts=?, run_at=? WHERE id=?')
            .bind(attempts, now + 60, item.id).run();
        }
        console.error('Push test rejected:', response.status, await response.text());
      }
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      if (attempts >= 3) {
        await env.DB.prepare('DELETE FROM push_test_queue WHERE id=?').bind(item.id).run();
      } else {
        await env.DB.prepare('UPDATE push_test_queue SET attempts=?, run_at=? WHERE id=?')
          .bind(attempts, now + 60, item.id).run();
      }
      console.error('Push test failed:', item.device_id, error);
    }
  }
}

async function runScheduled(env) {
  await ensureSchema(env);
  await runPushTestQueue(env);
  const result = await env.DB.prepare('SELECT * FROM subscriptions').all();
  const rows = result.results || [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (let i = 0; i < rows.length; i += 10) {
    await Promise.allSettled(rows.slice(i, i + 10).map(async row => {
      const timezone = validTimeZone(row.timezone) ? row.timezone : 'Asia/Jakarta';
      const local = localClock(timezone);
      await deliverReminder(env, row, 'masuk', local, nowSec);
      await deliverReminder(env, row, 'pulang', local, nowSec);
    }));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env); }
      catch (error) {
        console.error('API error:', error);
        return json({ error: 'Terjadi kesalahan pada server.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env).catch(e => console.error('Cron error:', e)));
  }
};
