# Perubahan: Fase 4 — Posting Aset & Amortisasi

Status: **Selesai.** Lihat `RANCANGAN-double-entry.md` §6 untuk peta fase
lengkap.

## Yang berubah secara perilaku
- **Tambah Aset baru** (Amortisasi Aset → Tambah Aset) → otomatis memposting
  jurnal **perolehan**: `Dr [akun sesuai kategori] / Kr 1101 Kas`.
- **Edit Aset** → jurnal perolehan lama di-void, diposting ulang dari data
  terbaru.
- **Hapus Aset** → jurnal perolehan di-void.
- **Tutup Buku** (tombol yang sudah ada di sub-bagian Tutup Buku) → sekarang
  SEKALIGUS memposting jurnal **amortisasi/penyusutan** periode itu:
  `Dr 5105 Beban Penyusutan / Kr 1290 Akumulasi Penyusutan`.
- **Buka Kunci** bulan yang sudah ditutup → jurnal amortisasi periode itu
  ikut di-void.

## Kenapa amortisasi diposting lewat Tutup Buku, bukan titik lain
Amortisasi bulanan bukan kejadian "per transaksi" — secara alami memang
proses akhir periode (menghitung penyusutan SEMUA aset aktif untuk 1 bulan
penuh). Tutup Buku sudah jadi checkpoint akhir-periode yang ada di app ini
sejak awal, jadi dipakai sebagai titik posting alih-alih membuat UI baru.
Angka amortisasinya diambil dari `amortisasiPeriode.total` — **variabel yang
sama** yang sudah dipakai tampilan Laporan Neraca lama, supaya tidak mungkin
ada 2 angka amortisasi berbeda untuk periode yang sama.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `KATEGORI_ASET_AKUN`, `bangunBarisJurnalAsetPerolehan()`, `bangunBarisJurnalAmortisasi()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `submitAset()`/hapus Aset posting perolehan; `tutupBukuBulanIni()`/`bukaKunciBulan()` posting/void amortisasi; + helper `jurnalAktifSumber()`/`voidJurnalSumberAman()` |

## ⚠️ KEPUTUSAN PENTING — baca sebelum dipakai di lapangan
**Perolehan Aset diasumsikan DIBAYAR TUNAI LEWAT KAS saat itu juga.** Begitu
sebuah aset didaftarkan lewat form Amortisasi Aset (dan otomatis memposting
jurnal perolehannya dari sana), **Admin JANGAN LAGI mencatat pembelian yang
SAMA sebagai transaksi Kas terpisah** dengan kategori "Pembelian Aset" —
kalau dicatat dua-duanya, Kas akan berkurang DUA KALI padahal uang cuma
keluar sekali (double-count).

Kategori Kas "Pembelian Aset" (dari Fase 2) **tetap ada** dan tetap berguna
untuk pembelian kecil yang **tidak** didaftarkan sebagai Aset Tetap formal
(tidak disusutkan) — dua alur ini sengaja dipisah:
- Beli aset yang MAU disusutkan (kendaraan, peralatan, dst) → **daftarkan
  lewat Amortisasi Aset**, jangan dicatat lagi di Kas.
- Beli sesuatu kecil yang TIDAK perlu disusutkan/dilacak sebagai aset →
  cukup catat di Kas kategori "Pembelian Aset" seperti biasa.

Kalau ternyata praktiknya aset sering dibeli KREDIT (bukan tunai), mapping
ini perlu direvisi — Fase 5 (Hutang/Piutang) akan menambahkan opsi
"dibayar kredit" yang presisi untuk kasus ini.

## Yang BELUM disentuh
Hutang/Piutang (sisi pengakuan awal, di luar yang sudah auto-link Kas sejak
Fase 2), Dana Cadangan (jadi apropriasi laba), dan penggantian
`NeracaKeuangan.jsx` untuk membaca dari saldo akun. Menyusul di Fase 5, 6, 8.
(Fase 7 — snapshot `saldoAkunBulanan` per bulan — sudah sebagian jalan lewat
titik Tutup Buku yang sama, tapi belum benar-benar MENYIMPAN snapshot saldo
ke `saldoAkunBulanan`; itu masih menyusul juga.)
