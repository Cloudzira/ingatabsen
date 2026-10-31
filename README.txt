INGATABSEN PWA — PANDUAN SINGKAT

Isi paket:
- index.html              Aplikasi utama
- manifest.webmanifest    Identitas PWA dan konfigurasi ikon
- sw.js                   Service Worker untuk cache/offline shell dan klik notifikasi
- icons/                  Ikon SVG dan PNG 192/512

CARA MENJALANKAN
1. Ekstrak seluruh isi ZIP ke satu folder.
2. Upload seluruh folder beserta struktur subfoldernya ke hosting yang mendukung HTTPS.
3. Buka URL index.html melalui domain HTTPS.
4. Izinkan notifikasi dari dalam aplikasi.
5. Untuk memasang, gunakan tombol Instal atau menu browser "Install app / Tambahkan ke Layar Utama".

PENTING
- PWA dan Service Worker membutuhkan HTTPS (localhost untuk pengujian).
- Jangan membuka index.html langsung dengan file:// jika ingin menguji instalasi/offline.
- Alarm suara/getar berjalan ketika halaman aplikasi aktif. Browser/OS dapat menangguhkan JavaScript saat aplikasi ditutup, perangkat terkunci, atau mode hemat baterai aktif. Notifikasi terjadwal yang andal saat aplikasi benar-benar tertutup memerlukan backend push/layanan penjadwalan; Service Worker saja tidak dapat menjalankan timer harian secara mandiri.
- File ini menyimpan pengaturan pada localStorage browser/perangkat. Data tidak otomatis tersinkron antar perangkat.
