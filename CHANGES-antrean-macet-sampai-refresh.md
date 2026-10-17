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

---
## Tambahan 3: masih macet ("kirim/timeout", 0 KB/s) — diagnosa + pemulihan satu ketukan
**Data dari foto**: 12 tertunda, 116 dtk tanpa kemajuan, kendala `[kirim/timeout]`, status BUKAN
"tak terhubung" (SDK mengira tersambung), kecepatan jaringan 0,00 KB/s, layar terbagi dengan chat.
Penyebab pastinya BELUM diketahui; yang pasti: tulisan tidak dibalas server sementara `.info/connected` true.

**Perubahan**
- `lib/diagLog.js` (baru): perekam log (ring buffer 300 baris) — peristiwa aplikasi (connected,
  goOffline/goOnline, kirim berhenti, visibilitas, online/offline) + log internal SDK Firebase
  (baru diaktifkan saat timeout pertama, karena berat bila aktif terus).
- `SyncIndicator.jsx`: mengetuk ikon status macet/putus/gagal → log disalin ke clipboard +
  konfirmasi "Muat ulang sekarang?" (antrean tersimpan di perangkat).
- `offlineStore.js`: tulisan yang kena timeout ditandai "terbang" (masih di buffer SDK) dan TIDAK
  dikirim ulang tiap 10 dtk (sebelumnya menumpuk salinan di buffer SDK); bila SDK membalas
  terlambat, entri langsung dihapus dari antrean (`onLateOk`).
- `useDB.js`: jeda putus-sambung default 60 → 30 dtk; pencatatan log; aktifkan log SDK saat timeout.
- `firebase/init.js`: ekspos `enableLogging`.
- Test +3 (terbang, balasan terlambat, TTL). Total 84 lulus, 0 gagal, 7 dilewati.
