# Perubahan: Unifikasi Alur Persetujuan Sales (Kontrol, Penyesuaian Stok, Tarik Toko)

## Masalah yang diperbaiki

1. **Banner pengajuan tanpa kejelasan toko mana** — banner "Ada N pengajuan
   Penyesuaian Stok..." dulu cuma teks polos. Admin/Manajer harus buka toko
   satu-satu untuk tahu toko mana yang mengajukan. Sekarang ada tombol
   **"Tinjau Pengajuan"** yang membuka modal berisi daftar toko, tanggal, dan
   detail produk yang diajukan — persis pola yang sudah ada di fitur
   "Pengajuan Hapus Kontrol".

2. **Logika "Tambah Kontrol" (Stok Awal) tidak konsisten dengan "Penyesuaian
   Stok"** — dulu, Stok Awal yang diisi Sales lewat Tambah Kontrol LANGSUNG
   mengubah stok Master Toko & ceklis "Produk yang Dijual" tanpa persetujuan
   apa pun, padahal Penyesuaian Stok sudah lama punya alur
   menunggu → disetujui/ditolak. Sekarang keduanya disamakan:
   - Kontrol Bulanan yang diajukan **Sales** masuk status **"menunggu"**
     dulu (tidak langsung memengaruhi Master Toko), otomatis **"disetujui"**
     sendiri kalau 24 jam tidak ditinjau — sama persis seperti Penyesuaian
     Stok.
   - Kontrol yang diajukan **Admin/Manajer** langsung **"disetujui"** (tidak
     perlu approval sendiri).
   - Baik disetujui manual maupun otomatis, barulah stok Master Toko &
     ceklis produk ikut diperbarui.

3. **Tarik Toko / Non-Aktifkan & "Produk ditarik dari toko ini" diblokir
   total untuk Sales** — dulu Sales yang mencoba menarik/menonaktifkan toko
   cuma dapat alert "hubungi Admin/Manajer". Sekarang Sales BOLEH mengajukan
   (koleksi baru `penarikanToko`, status "menunggu" + auto-approve 24 jam),
   Admin/Manajer yang menyetujui/menolak. Begitu disetujui, efeknya baru
   diterapkan ke Master Toko (status Non-Aktif, ceklis produk dikosongkan,
   stok disesuaikan + tercatat sebagai Penyesuaian Stok otomatis) — sama
   seperti alur lama untuk Admin/Manajer, cuma sekarang lewat tinjauan dulu
   kalau yang mengajukan Sales.

## Sinkronisasi (poin 3 di permintaan)

Semua status di atas otomatis tersinkron ke Tab Toko (ceklis produk) &
Daftar Stok Produk per toko — TAPI sekarang baru terjadi **setelah**
pengajuan disetujui (bukan seketika saat diajukan seperti sebelumnya).
`recalcTokoStok()` sekarang mengabaikan entri Kontrol berstatus
"menunggu"/"ditolak" saat menghitung baseline stok (sebelumnya sudah begitu
untuk Penyesuaian Stok, sekarang disamakan untuk Kontrol Bulanan juga).

## File yang diubah

- `src/features/kontrol/TabKontrol.jsx` — logika utama (lihat komentar `✅`
  di kode untuk detail tiap perubahan).
- `src/config/dbEmpty.js` — tambah koleksi `penarikanToko: []`.
- `src/hooks/useDB.js` — ikutkan `penarikanToko` saat restore backup.
- `database_rules.json` (lihat `database_rules_updated.json` di root project)
  — tambah rule Firebase untuk koleksi baru `penarikanToko` (Sales cuma
  boleh membuat pengajuan status "menunggu" untuk toko di wilayahnya
  sendiri; ubah/hapus hanya Admin/Manajer). **Rule `kontrol` &
  `penyesuaian` yang sudah ada TIDAK perlu diubah** — validasi field-nya
  sudah punya fallback yang mengizinkan field baru (`status`,
  `autoApproveAt`, dst).

## ⚠️ Yang perlu Anda lakukan secara manual

`database_rules.json` di Firebase Console **perlu diupdate** memakai isi
`database_rules_updated.json` (di root proyek ini) supaya koleksi baru
`penarikanToko` bisa ditulis oleh Sales. Tanpa ini, tombol "Tarik Toko" oleh
Sales akan gagal tersimpan (ditolak Firebase) walau tampil "berhasil" di UI
untuk sesaat.
