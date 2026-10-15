# Fix: stok toko tertimpa 0 saat riwayat kontrol ada di tahun yang tidak termuat

**Masalah**: `recalcTokoStok` menghitung stok dari `db.kontrol`, yang hanya berisi tahun live
(`KONTROL_LIVE_YEARS = 1` = tahun kalender berjalan) + tahun yang dimuat manual. Jika kontrol
terakhir sebuah toko ada di tahun yang tidak termuat/terarsip, baseline jadi 0 lalu `stok_*`
ditulis ke RTDB (dibaca semua perangkat). Terjadi saat Penyesuaian Stok disetujui, atau hapus
kontrol (`forceIfEmpty`). Sudah berlaku sekarang untuk toko yang tahun ini belum punya kontrol.

**Perbaikan**
- `src/lib/dataHelpers.js`: guard di `recalcTokoStok` — jika tidak ada kontrol terlihat DAN ada
  tahun tak-terlihat >= tahun `tanggalMasuk` toko → stok TIDAK ditulis, return `{dilewati:true}`,
  tampil 1 alert (maks 1x/10 dtk) + `console.warn`. Toko baru (masuk setelah tahun tak-terlihat)
  tetap dihitung normal.
- `src/hooks/useDB.js`: effect mengisi daftar tahun tak-terlihat (tahun di cloud yang belum
  dimuat + tahun terarsip) lewat `setTahunKontrolTidakTerlihat`.
- `tests/stok-riwayat.test.mjs`: 6 test baru.

**Cara pulih bila alert muncul**: Cadangan/Admin → Muat Data Tahun Lama → ulangi aksinya.
**Belum dicakup**: tulis stok absolut dari 2 perangkat bersamaan (lost update) — butuh transaksi.
