# IngatAbsen — Cloudflare PWA + Web Push

Paket ini mempertahankan HTML IngatAbsen sebelumnya dan menambahkan Web Push melalui Cloudflare Workers + D1 + Cron.

## Penyimpanan
**Tetap di browser/perangkat:** link presensi, status checklist, dan pengaturan utama.

**Di Cloudflare D1 hanya untuk pengiriman push:** push subscription (endpoint dan kunci teknis), jam masuk/pulang, zona waktu, tanggal checklist minimal, dan tanggal pengiriman terakhir. Tidak ada akun/login dan tidak ada penyimpanan seluruh data aplikasi di cloud.

## Setup Cloudflare satu kali

### 1. Buat D1
1. Cloudflare Dashboard → Workers & Pages → D1 SQL Database.
2. Create database, nama `ingatabsen-db`.
3. Salin Database ID.
4. Buka database → Console → jalankan seluruh isi `migrations/0001_init.sql`.
5. Di `wrangler.jsonc`, ganti `GANTI_DENGAN_DATABASE_ID_DARI_CLOUDFLARE` dengan ID tersebut.

### 2. Buat VAPID key (tanpa terminal)
1. Ekstrak ZIP proyek ini di komputer.
2. Buka file `tools/generate-vapid.html` langsung di browser desktop.
3. Klik **Buat pasangan kunci**.
4. Unduh JSON hasilnya dan simpan secara pribadi.
5. Public Key akan dimasukkan sebagai Worker variable; Private Key sebagai Cloudflare Secret.
6. Jangan unggah JSON hasil generator ke GitHub atau kirim Private Key ke siapa pun.
7. Buat pasangan kunci satu kali saja. Jangan ganti setelah perangkat pengguna berlangganan push.

### 3. Deploy awal
1. Buat repository GitHub baru, misalnya `ingatabsen`.
2. Unggah semua isi folder proyek ini ke root repository.
3. Buat Cloudflare API Token dengan izin deploy Workers.
4. GitHub → repository Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Jalankan workflow dari tab Actions atau push ke branch `main`.

### 4. Tambahkan VAPID variables ke Worker
Setelah Worker pertama ter-deploy:
1. Cloudflare Dashboard → Workers & Pages → Worker `ingatabsen`.
2. Settings → Variables and Secrets.
3. Tambahkan:
   - `VAPID_PUBLIC_KEY` — Text
   - `VAPID_PRIVATE_KEY` — Secret
   - `VAPID_SUBJECT` — Text, contoh `mailto:email-kamu@example.com`
4. Simpan lalu deploy ulang.

Jangan pernah menaruh private key atau API token di file HTML, `wrangler.jsonc`, atau repository GitHub.

## Mengaktifkan push
1. Buka URL Worker melalui HTTPS.
2. Android/desktop: gunakan browser terbaru yang mendukung Web Push.
3. iPhone/iPad: tambahkan PWA ke Home Screen, lalu buka dari ikon Home Screen (Web Push PWA memerlukan iOS/iPadOS 16.4+).
4. Buka Pengaturan Jam Pengingat & Notifikasi.
5. Tekan Izinkan Notifikasi lalu pilih Allow.
6. Aplikasi akan mengirim notifikasi tes otomatis. Pastikan notifikasi muncul.

## Pemeriksaan
- `/api/health` harus menampilkan `{"ok":true,...}`.
- `/sw.js` dan `/manifest.webmanifest` harus dapat dibuka.
- Setelah push diaktifkan, tabel D1 `subscriptions` akan berisi satu baris perangkat.
- Atur waktu pengingat beberapa menit ke depan untuk menguji Cron.

## Batasan dan keandalan
- Cloudflare Cron memeriksa jadwal setiap menit; pengiriman dapat terlambat beberapa menit.
- Push bisa diterima saat PWA ditutup selama browser/perangkat mendukung Web Push dan perangkat tersambung ke internet.
- Jika perangkat offline, push service dapat menahan pesan sementara (TTL pengingat 1 jam), tetapi penerimaan setelah online kembali tidak dijamin.
- PWA murni tidak bisa menjamin alarm saat aplikasi ditutup dan perangkat offline. Itu membutuhkan penjadwalan native pada sistem operasi.
- Pengingat lokal di halaman yang sedang terbuka tetap diperiksa oleh aplikasi.
- Android: pengaturan baterai dan izin notifikasi dapat memengaruhi penerimaan.
- iPhone: PWA harus dipasang ke Home Screen untuk menerima Web Push.
- Cloudflare Free memiliki batas kuota; pantau penggunaan Worker dan D1 di dashboard.

## Privasi
D1 menyimpan subscription endpoint dan kunci teknis Web Push. Endpoint adalah token rahasia yang memungkinkan pengiriman notifikasi ke perangkat itu. Batasi akses database dan jangan membagikan datanya.
