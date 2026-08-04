# Perubahan: Fase 5 — Posting Hutang/Piutang (Pengakuan Awal + Perbaikan Pelunasan)

Status: **Selesai.** Lihat `RANCANGAN-double-entry.md` §6 untuk peta fase
lengkap.

## Yang berubah secara perilaku
- **Tambah Hutang/Piutang baru** → otomatis memposting jurnal **pengakuan
  awal** (kecuali kategori "Piutang Toko/Konsinyasi" — lihat catatan di bawah).
- **Edit** Hutang/Piutang → jurnal pengakuan awal lama di-void, diposting
  ulang dari data terbaru.
- **Hapus** Hutang/Piutang → jurnal pengakuan awal di-void.
- **Bayar/Tagih** (tombol "Bayar") → jurnal pelunasan sekarang memakai akun
  **spesifik** sesuai kategori record-nya (lihat "Perbaikan" di bawah),
  bukan lagi akun generik dari kategori Kas.

## ⚠️ Perbaikan retroaktif terhadap Fase 2
Fase 2 memposting pelunasan Hutang/Piutang lewat mapping kategori Kas GENERIK
(`"Pembayaran Hutang Usaha"` selalu → `2101`, `"Piutang Tertagih"` selalu →
`1104`) — TIDAK peduli kategori spesifik record-nya. Ini salah kalau, misalnya,
yang dilunasi adalah "Pinjaman Bank" (harusnya `2102`), bukan "Hutang Supplier"
(`2101`) — akun yang berkurang jadi tidak konsisten dengan akun yang
bertambah saat pengakuan awal.

**Fase 5 memperbaiki ini**: `submitBayar()` sekarang membangun baris jurnal
langsung dari `bangunBarisJurnalPelunasanHutangPiutang(row, nominal)` yang
membaca kategori SPESIFIK record ybs, bukan lagi lewat `bangunBarisJurnalKas()`
(mapping generik Fase 2). Kalau kamu belum pernah deploy Fase 2 secara
terpisah, ini bukan masalah — cukup deploy versi final yang sudah termasuk
perbaikan ini.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `KATEGORI_HUTANG_AKUN`, `KATEGORI_PIUTANG_AKUN`, `akunHutangPiutang()`, `bangunBarisJurnalHutangPiutangAwal()`, `bangunBarisJurnalPelunasanHutangPiutang()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `submitHp()`/`hapusHp()` posting/void pengakuan awal; `submitBayar()` pakai akun spesifik utk pelunasan |

## Mapping akun
| Kategori | Tipe | Akun spesifik | Lawan akun saat pengakuan awal |
|---|---|---|---|
| Piutang Toko/Konsinyasi | Piutang | 1102 | **Tidak diposting dari sini** (lihat catatan) |
| Piutang Karyawan | Piutang | 1103 | Kr 1101 Kas (asumsi: perusahaan kasih pinjaman/uang muka) |
| Piutang Lainnya | Piutang | 1104 | Kr 1101 Kas |
| Hutang Supplier | Hutang | 2101 | Dr 1110 Persediaan Gudang Pusat (asumsi: barang diterima) |
| Pinjaman Bank | Hutang | 2102 | Dr 1101 Kas (asumsi: uang diterima) |
| Pinjaman Investor | Hutang | 2103 | Dr 1101 Kas |
| Hutang Lainnya | Hutang | 2104 | Dr 1101 Kas |

## ⚠️ Kenapa "Piutang Toko/Konsinyasi" TIDAK diposting dari modul ini
Piutang jenis ini **sudah** diposting otomatis lewat Kontrol (Fase 3, setiap
kunjungan disetujui → `Dr 1102`). Kalau modul Hutang/Piutang JUGA memposting
`Dr 1102` untuk record manual dengan kategori yang sama, itu **double-count**
— piutang toko akan tercatat dua kali di jurnal. Form Hutang/Piutang untuk
kategori ini tetap bisa dipakai sebagai alat bantu TRACKING manual (mis.
mencatat toko mana yang piutangnya sudah lama/bermasalah), tapi sengaja
tidak menghasilkan jurnal baru.

## ⚠️ Asumsi lain yang perlu diperhatikan
- **Hutang Supplier diasumsikan berupa barang/persediaan** (Dr Persediaan
  Gudang Pusat). Kalau ternyata hutang itu untuk jasa/beban (bukan barang),
  Admin perlu koreksi manual — form belum punya field untuk membedakan ini.
- Semua asumsi "Kas diterima/dikeluarkan duluan" berlaku **hanya untuk
  pengakuan awal** — kalau hutang/piutang itu SEBENARNYA sudah lunas
  sebagian sejak awal dicatat (field `terbayar` diisi langsung saat create,
  bukan lewat tombol "Bayar"), jurnal pelunasan untuk porsi itu **tidak
  otomatis ikut terposting** (cuma field `terbayar`-nya yang berubah). Kalau
  ini penting untuk dipakai, kabari saya untuk ditambahkan di fase
  berikutnya.

## Yang BELUM disentuh
Dana Cadangan (jadi apropriasi laba, bukan sekadar angka Kewajiban di
Laporan Neraca lama), dan penggantian `NeracaKeuangan.jsx` untuk membaca
dari saldo akun (bukan hitung-ulang manual). Menyusul di Fase 6 & 8.
