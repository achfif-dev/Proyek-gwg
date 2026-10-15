# Perbaikan ikon sinkronisasi (header)

**Masalah**: ikon "Sinkron HH:MM" memakai status jaringan perangkat (bukan koneksi Firebase),
jamnya hanya dari data masuk (bukan tulisan terkirim), perubahan DITOLAK server tidak
memengaruhi ikon, "Mengirim" tidak bisa dibedakan dari macet, dan di HP (<=400px) hanya
tersisa ikon 11px statis.

**Perbaikan**
- `src/lib/syncStatus.js` (baru): satu status gabungan, urutan prioritas:
  ditolak > offline > putus dari server > gagal baca > macet (>45 dtk tanpa kemajuan) >
  mengirim > memuat > OK. "OK" hanya jika Firebase benar-benar terhubung.
- `src/hooks/useFirebaseConnected.js` (baru): membaca `.info/connected`; "putus" baru
  dilaporkan setelah 4 detik terus-menerus (menghindari kedipan saat start/reconnect).
- `src/hooks/useDB.js`: melacak `lastSendOk` & `sendProgressAt` dari pengiriman antrean yang
  sukses (di-throttle 1x/2 dtk).
- `src/components/SyncIndicator.jsx` (baru): ikon berputar saat aktif, latar berwarna per
  level, badge angka tetap tampil di HP, ketuk = penjelasan (status ditolak = gulir ke banner).
- `src/App.jsx`: dua indikator lama diganti komponen ini; keyframes `gw-spin`; id banner
  `gw-banner-ditolak`.
- `tests/sync-status.test.mjs`: 8 test.

**Belum diuji di perangkat/Firebase asli.** Cek manual: matikan data seluler (harus "Offline"),
pakai Wi-Fi tanpa internet (harus "Tak terhubung"), buat perubahan yang ditolak rules
(harus merah + gulir ke banner).
