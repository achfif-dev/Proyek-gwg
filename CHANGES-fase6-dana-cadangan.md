# Perubahan: Fase 6 — Dana Cadangan sebagai Apropriasi Laba

Status: **Selesai.** Lihat `RANCANGAN-double-entry.md` §6 untuk peta fase
lengkap.

## Yang berubah secara perilaku
Setiap kali **Tutup Buku** dijalankan (tombol yang sudah ada), sistem
sekarang juga memposting jurnal **apropriasi Dana Cadangan**:
`Dr 3102 Laba Ditahan / Kr 2110 Kewajiban Dana Cadangan`. Dibatalkan
otomatis kalau kuncinya dibuka lagi (**Buka Kunci**).

Kalau Dana Cadangan tidak diaktifkan (`config.danaCadangan.aktif` false),
tidak ada apa pun yang diposting — sama seperti perilaku Laporan Neraca
lama.

## Kenapa "apropriasi", bukan beban P&L
Dana Cadangan di app ini **mengurangi SHU yang dibagi ke pihak**, tapi bukan
biaya operasional dalam pengertian akuntansi. Diperlakukan sebagai
apropriasi laba (mengunci sebagian Laba Ditahan jadi cadangan) — bukan
`Dr Beban`, supaya maknanya tetap sama seperti yang dipahami di app ini
sejak awal (lihat diskusi di `RANCANGAN-double-entry.md` §1).

## Kenapa diposting sebagai SELISIH (increment), bukan nilai penuh
`hitungDanaCadanganKumulatif()` (dipakai Laporan Neraca lama) menghasilkan
angka **ALL-TIME** (akumulasi sejak diaktifkan, bukan per-bulan). Kalau
jurnal memposting nilai PENUH itu setiap kali Tutup Buku, kewajibannya akan
dobel-hitung tiap bulan. Jadi setiap Tutup Buku:
1. Jumlahkan berapa yang **sudah** diposting sebelumnya (dari `jurnalUmum`
   yang masih aktif/belum void, sisi kredit akun `2110`).
2. `increment = kewajibanCadangan (all-time terkini) − sudahDiposting`.
3. Kalau `increment > 0`, posting sejumlah itu saja untuk bulan ini.

Ini memakai **angka yang sama persis** dengan yang sudah ditampilkan di
Laporan Neraca lama (`kewajibanCadangan`, sudah termasuk perbaikan akurasi
arsip dari Fase 1 lewat `totalArsipPcsTerjual`) — jadi tidak mungkin ada 2
angka Dana Cadangan yang berbeda untuk periode yang sama.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `bangunBarisJurnalApropriasiDanaCadangan()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `tutupBukuBulanIni()` menghitung increment & posting; `bukaKunciBulan()` void jurnal apropriasi periode terkait |

## ⚠️ Catatan
- Kalau `rpPerPcs` di konfigurasi Dana Cadangan **diturunkan** (sehingga
  target kumulatif jadi lebih kecil dari yang sudah diposting), increment
  jadi negatif → **sengaja tidak diposting otomatis** (butuh koreksi manual
  oleh admin/akuntan, bukan dibalik otomatis oleh sistem).
- Perhitungan "sudah diposting" membaca `db.jurnalUmum` yang sedang termuat
  (tahun berjalan, sesuai desain Fase 1). Kalau nanti `jurnalUmum` sendiri
  juga diarsipkan ke tahun-tahun lama (belum ada mekanismenya sampai
  sekarang), perhitungan ini perlu disesuaikan supaya tetap membaca agregat
  dari tahun yang diarsip — sama seperti yang sudah dilakukan untuk
  `kontrolArchiveIndex` di Fase 1.

## Yang BELUM disentuh
Snapshot saldo akun bulanan penuh ke `saldoAkunBulanan` (Fase 7 — saat ini
Tutup Buku baru memposting jurnal, belum menyimpan snapshot saldo akun per
bulan), dan penggantian `NeracaKeuangan.jsx` untuk membaca dari saldo akun
alih-alih hitung-ulang manual (Fase 8).
