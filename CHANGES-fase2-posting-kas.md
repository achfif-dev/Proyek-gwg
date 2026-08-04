# Perubahan: Fase 2 — Posting Otomatis dari Modul Kas

Status: **Selesai.** Titik input pertama (Kas Opname) sekarang otomatis
memposting jurnal berpasangan. Lihat `RANCANGAN-double-entry.md` §6 untuk
peta fase lengkap.

## Yang berubah secara perilaku
Setiap kali Kas Opname disimpan/diedit/dihapus di Laporan Neraca, sistem
sekarang **otomatis** membuat/membatalkan entry di `jurnalUmum` — tanpa
mengubah tampilan/form Kas Opname sama sekali (dropdown kategori, field
nominal, dst semuanya identik seperti sebelumnya).

| Aksi user | Jurnal yang terjadi |
|---|---|
| Tambah Kas Masuk/Keluar | 1 entry baru diposting (Debit/Kredit Kas 1101 vs akun lawan sesuai kategori) |
| Edit Kas | Entry lama di-**void** (dibalik, bukan dihapus) + entry baru diposting dengan angka terbaru |
| Hapus Kas | Entry lama di-**void** (dibalik) — Kas Opname tetap terhapus seperti biasa |
| Pelunasan Hutang/Piutang (tombol "Bayar") | Kas otomatis ter-link (fitur lama) **+ sekarang ikut diposting jurnalnya** juga |

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `KATEGORI_KAS_MASUK_AKUN`, `KATEGORI_KAS_KELUAR_AKUN` (mapping kategori→akun), `bangunBarisJurnalKas()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `submitKas()`/`hapusKas()`/`submitBayar()` sekarang memanggil `postJurnal()`/`voidJurnal()` lewat helper `postingJurnalKasAman()` |
| `src/App.jsx` | `postJurnal`, `voidJurnal`, `createdBy` (email user aktif) diteruskan ke `TabBagiHasil` → `NeracaKeuangan` |

## Desain penting: gagal Kas TIDAK PERNAH gagal karena akuntansi
`postingJurnalKasAman()` sengaja membungkus posting jurnal dengan try/catch
terpisah dari penyimpanan Kas itu sendiri. Kalau posting jurnal gagal
(misalnya kategori baru belum dipetakan, atau `daftarAkun` belum ter-seed),
**catatan Kas tetap tersimpan seperti biasa** — cuma muncul alert peringatan
ke user. Prinsipnya: fitur Kas Opname yang sudah lama dipakai dan diandalkan
tidak boleh terhambat oleh fitur akuntansi baru yang masih tahap awal.

## ⚠️ Keterbatasan yang disengaja (akan disempurnakan di fase berikutnya)
Modul Kas belum menyimpan link eksplisit ke record Aset/Hutang/Piutang
spesifik, jadi beberapa kategori memakai akun **generik** dulu:
- **"Pembelian Aset"** → akun generik `1205 Aset Tetap Lainnya`. Fase 4
  akan menghubungkan ke aset spesifik (kode akun sesuai jenisnya:
  Kendaraan/Peralatan/dst), bukan `1205` lagi.
- **"Pembayaran Hutang Usaha" / "Pelunasan Pinjaman" / "Pinjaman Masuk"** →
  akun Kewajiban generik. Fase 5 akan menghubungkan ke record `hutangPiutang`
  spesifik begitu Kas punya field link ke situ.
- **"Piutang Tertagih"** diasumsikan piutang non-toko → `1104`. **"Setoran
  Penjualan Konsinyasi"** diasumsikan pelunasan piutang toko (dari `kontrol`,
  yang baru diposting sebagai Piutang di Fase 3) → `1102`.

Ini bukan bug — didesain sadar sebagai pendekatan bertahap: saldo akun
generik tetap benar secara TOTAL (Rp-nya akurat), cuma belum ter-breakdown
sampai per-counterparty spesifik. Itu menyusul begitu Fase 4/5 selesai.

## Yang BELUM disentuh
Kontrol (penjualan), Aset, Hutang/Piutang (sisi pengakuan awalnya, bukan
cuma pelunasan lewat Kas), dan Dana Cadangan — semuanya masih pakai
perhitungan lama (belum memposting jurnal). Menyusul di Fase 3–6.
