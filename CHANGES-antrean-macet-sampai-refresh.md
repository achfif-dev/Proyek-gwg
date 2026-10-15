# Antrean "macet" sampai halaman di-refresh (laporan: 1 kontrol, Wi-Fi stabil, ikon ⚠ 5)

**Gejala**: ikon kuning ⚠ + angka 5 (status "macet": 5 perubahan tertunda, tanpa kemajuan > 45 dtk);
Firebase dianggap tersambung; baru terkirim setelah refresh.

**Penyebab yang bisa dibuktikan dari kode**
- Kunci kirim (`flushingRef`) tidak punya pengambilalihan: satu `await` yang tak pernah selesai
  membuat SEMUA flush berikutnya langsung keluar (`flushAgainRef = true; return`) — antrean
  macet sampai refresh (refresh = kunci baru).
**Penyebab yang belum terbukti (hipotesis)**
- Socket Firebase "setengah mati": SDK mengira tersambung, tapi tulisan tak pernah di-ACK
  (mis. HP memakai Wi-Fi + data seluler bersamaan, terlihat di bilah status foto).

**Perbaikan**
- `useDB.js`: kunci flush dengan pengambilalihan (>90 dtk dianggap menggantung; hanya generasi
  terbaru yang melepas kunci). Bila tulisan kena timeout (tak di-ACK 25 dtk) → putus-sambung
  koneksi (`goOffline`/`goOnline`, maks 1x/60 dtk; tulisan yang belum di-ACK tidak hilang) lalu
  kirim ulang 3 dtk kemudian. Kendala kirim terakhir disimpan (`sendError`).
- `syncStatus.js`: `keputusanFlush`, `teksKendala`; mengetuk ikon "macet" kini menampilkan
  kode + pesan kendala terakhir.
- `firebase/init.js`: ekspos `goOffline`/`goOnline`.
- `offlineStore.js`: `isKirimTimeout`.
- Test: +2 (kunci flush, teks kendala).

**Belum terbukti memperbaiki** — butuh uji di perangkat. Jika masih macet, ketuk ikon dan catat
pesan "Kendala terakhir".

---
## Tambahan: sinyal lemah — percepat sambung ulang ke RTDB
**Fakta dari kode SDK (@firebase/database 1.0.5, bawaan firebase 10.12.0):** SDK TIDAK mencoba
sambung tanpa jeda. Jeda mulai 1 dtk, dikali 1,3 tiap gagal (diacak), maksimal **5 menit**;
reset ke 1 dtk hanya bila event `online` browser, jendela jadi terlihat saat jeda sudah
maksimal, atau terhubung >30 dtk. Tulisan baru hanya di-*buffer* (`Buffering put`) dan TIDAK
memicu sambung. Di sinyal lemah, aplikasi bisa tampak mati lama walau sinyal sudah pulih.

**Perbaikan (`useDB.js`)**: `dorongSambung` — bila `.info/connected` false > 8 dtk dan aplikasi
terlihat, jeda direset lewat goOffline/goOnline (maks 1x/30 dtk). Dipicu: input baru (setelah
antrean tersimpan), kembali ke layar depan, dan jaring pengaman 10 dtk. Saat terputus, antrean
TIDAK disetor ke SDK (menghindari menggantung 25 dtk + duplikat); kirim otomatis saat
`.info/connected` kembali true.
**Risiko**: tiap upaya sambung ulang memakai baterai/data sedikit; 30 dtk dipilih supaya
handshake di sinyal lemah punya waktu. Belum diuji di jaringan nyata.
