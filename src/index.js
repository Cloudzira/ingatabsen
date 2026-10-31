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

function localClock(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute)
  };
}

function validateSubscription(subscription) {
  return subscription &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.startsWith('https://') &&
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

  const deviceId = String(body.deviceId || '').slice(0, 100);
  if (!deviceId) return json({ error: 'deviceId wajib diisi.' }, 400);

  if (url.pathname === '/api/subscribe') {
    const subscription = body.subscription;
    if (!validateSubscription(subscription)) return json({ error: 'Data langganan push tidak valid.' }, 400);

    const timeMasuk = validTime(body.timeMasuk) ? body.timeMasuk : '07:00';
    const timePulang = validTime(body.timePulang) ? body.timePulang : '15:00';
    const timezone = validTimeZone(body.timezone) ? body.timezone : 'Asia/Jakarta';

    await env.DB.prepare(`
      INSERT INTO subscriptions
        (device_id, subscription_json, time_masuk, time_pulang, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET
        subscription_json=excluded.subscription_json,
        time_masuk=excluded.time_masuk,
        time_pulang=excluded.time_pulang,
        timezone=excluded.timezone,
        updated_at=CURRENT_TIMESTAMP
    `).bind(deviceId, JSON.stringify(subscription), timeMasuk, timePulang, timezone).run();

    return json({ ok: true });
  }

  if (url.pathname === '/api/settings') {
    const timeMasuk = validTime(body.timeMasuk) ? body.timeMasuk : null;
    const timePulang = validTime(body.timePulang) ? body.timePulang : null;
    const timezone = validTimeZone(body.timezone) ? body.timezone : 'Asia/Jakarta';
    if (!timeMasuk || !timePulang) return json({ error: 'Format jam tidak valid.' }, 400);

    const result = await env.DB.prepare(`
      UPDATE subscriptions
      SET time_masuk=?, time_pulang=?, timezone=?, updated_at=CURRENT_TIMESTAMP
      WHERE device_id=?
    `).bind(timeMasuk, timePulang, timezone, deviceId).run();

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

  if (url.pathname === '/api/unsubscribe') {
    await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(deviceId).run();
    return json({ ok: true });
  }

  if (url.pathname === '/api/test') {
    const row = await env.DB.prepare(
      'SELECT device_id FROM subscriptions WHERE device_id=?'
    ).bind(deviceId).first();
    if (!row) return json({ error: 'Perangkat belum terdaftar untuk push.' }, 404);

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

async function deliverReminder(env, row, type, local) {
  const isMasuk = type === 'masuk';
  const time = isMasuk ? row.time_masuk : row.time_pulang;
  if (!validTime(time)) return;

  const targetMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const delay = local.minutes - targetMinutes;

  // Cron checks each minute. A five-minute grace window tolerates small delays.
  if (delay < 0 || delay > 5) return;
  if ((isMasuk ? row.masuk_checked_date : row.pulang_checked_date) === local.date) return;
  if ((isMasuk ? row.last_sent_masuk : row.last_sent_pulang) === local.date) return;

  const column = isMasuk ? 'last_sent_masuk' : 'last_sent_pulang';
  const claim = await env.DB.prepare(
    `UPDATE subscriptions SET ${column}=? WHERE device_id=? AND (${column} IS NULL OR ${column}<>?)`
  ).bind(local.date, row.device_id, local.date).run();
  if (!claim.meta?.changes) return;

  try {
    const response = await sendPush(env, JSON.parse(row.subscription_json), {
      title: isMasuk ? 'Waktunya Presensi Masuk!' : 'Waktunya Presensi Pulang!',
      body: isMasuk
        ? 'Jangan lupa mengisi presensi kehadiran awal Anda.'
        : 'Saatnya melakukan presensi kepulangan hari ini.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `ingatabsen-${type}-${local.date}`,
      data: { url: '/' }
    }, 3600);

    if (response.status === 404 || response.status === 410) {
      await env.DB.prepare('DELETE FROM subscriptions WHERE device_id=?').bind(row.device_id).run();
    } else if (!response.ok) {
      await env.DB.prepare(`UPDATE subscriptions SET ${column}=NULL WHERE device_id=? AND ${column}=?`)
        .bind(row.device_id, local.date).run();
      console.error('Push service error:', response.status, await response.text());
    }
  } catch (error) {
    await env.DB.prepare(`UPDATE subscriptions SET ${column}=NULL WHERE device_id=? AND ${column}=?`)
      .bind(row.device_id, local.date).run();
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
  await runPushTestQueue(env);
  const result = await env.DB.prepare(`
    SELECT device_id, subscription_json, time_masuk, time_pulang, timezone,
           masuk_checked_date, pulang_checked_date, last_sent_masuk, last_sent_pulang
    FROM subscriptions
  `).all();

  for (const row of (result.results || [])) {
    try {
      const timezone = validTimeZone(row.timezone) ? row.timezone : 'Asia/Jakarta';
      const local = localClock(timezone);
      await deliverReminder(env, row, 'masuk', local);
      await deliverReminder(env, row, 'pulang', local);
    } catch (error) {
      console.error('Reminder processing error:', row.device_id, error);
    }
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
    ctx.waitUntil(runScheduled(env));
  }
};
