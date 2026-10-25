# Perbaikan: database lokal tertimpa kosong/sebagian saat muat awal tanpa sinyal

**Gejala**: sinyal hilang saat app memuat data server → toko hilang, hanya sebagian data kontrol
(luar rute) tampil, tidak bisa input kontrol.

**Penyebab (terbukti dari kode)**: listener toko & kontrol memakai onChildAdded tanpa sinyal "selesai".
Muat awal dianggap selesai bila aliran data diam 0,9 dtk, atau 12 dtk tanpa data. Saat offline,
`localMap` masih kosong → `flushToState()` menulis `toko: []` ke state DAN `saveLocalDB` (localStorage
+ IndexedDB). Salinan lokal tertimpa. Tabel kecil (penjualanLuar) lewat onValue tidak kena, sehingga
itu satu-satunya yang tampil.

**Perbaikan**
- `syncStatus.js`: `keputusanMuatAwal` (fungsi murni). Tak terhubung → tahan. Terhubung tapi hasil
  kosong / <80% salinan lokal sebelum koneksi stabil 45 dtk → tahan. Selain itu terima (perilaku lama).
- `useDB.js`: toko & kontrol tahun berjalan memakai gerbang itu. Saat "tahan": salinan lokal TIDAK
  ditimpa, app tetap dibuka dengan data lokal (`markLoadedAndFlush`), dicek ulang tiap 15 dtk dan
  saat sambung ulang. Dicatat di log ("muat awal ... ditahan").
- `tests/muat-awal.test.mjs`: 4 tes.
- Disertakan juga `diagLog.js` & `offlineStore.js` (log `set MULAI/ACK`, log SDK sejak awal, pemantau
  main thread beku) — versi ini BELUM ada di GitHub (commit 1a01031).

**Batas perbaikan**: (1) data sebagian yang >=80% dari salinan lokal tetap diterima, sisanya menyusul
lewat listener; (2) toko yang dihapus di server saat HP offline baru hilang dari HP setelah muat awal
diterima; (3) `loadKontrolYear` (muat manual tahun lama) belum diberi gerbang; (4) belum diuji di
perangkat — build `vite` tidak bisa dijalankan di sandbox (npm diblokir), hanya tes unit + cek sintaks.
