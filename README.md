# IngatAbsen — Pengingat Presensi (Cloudflare Worker + Web Push)

Folder yang dipakai server: `public/` (aplikasi), `src/index.js` (server push + Cron), `wrangler.jsonc`.
File lama di root (index.html, sw.js, manifest, icons) sudah tidak dipakai — boleh dihapus dari GitHub.

## Cara update (tanpa SQL manual)
1. Upload isi folder ini ke GitHub (timpa file lama), commit ke branch `main`.
2. Tunggu workflow **Deploy IngatAbsen Worker** hijau di tab Actions.
3. Buka aplikasi, tutup lalu buka lagi sekali. Database di Cloudflare otomatis di-upgrade.
4. VAPID key, secret, dan D1 yang sudah ada tidak perlu diubah.

## Fitur
- Push dari server: masuk walau aplikasi ditutup & layar mati, dengan getar + tombol **Sudah Absen** / **Tunda**.
- Pengingat diulang (default 2x tiap 5 menit) sampai Anda menandai presensi.
- Hari aktif (default Senin–Sabtu) dan jeda libur.
- Alarm di dalam aplikasi (suara + getar) tetap jalan sebagai cadangan, termasuk mengejar alarm yang terlewat.
- Panel **Kesiapan Notifikasi** + tombol tes di Pengaturan.

## Agar andal di HP
- Android: pasang ke layar utama, izinkan notifikasi, baterai Chrome/aplikasi = *Tanpa batasan*, matikan Jangan Ganggu, volume dering/getar aktif.
- iPhone: wajib dari ikon Layar Utama (iOS 16.4+). Getar web tidak didukung iOS; getar mengikuti pengaturan iPhone.
- Perangkat harus online saat jam pengingat. Tidak ada PWA yang bisa menjamin alarm saat offline total.
- Cron Cloudflare berjalan tiap menit, jadi pengingat bisa terlambat beberapa puluh detik.
