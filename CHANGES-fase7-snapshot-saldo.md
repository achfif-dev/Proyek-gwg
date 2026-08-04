# Perubahan: Fase 7 — Snapshot Saldo Akun Bulanan

Status: **Selesai.** Lihat `RANCANGAN-double-entry.md` §6 untuk peta fase
lengkap. Ini fase terakhir sebelum Fase 8 (mengganti `NeracaKeuangan.jsx`
untuk membaca dari saldo akun).

## Yang berubah secara perilaku
**Tutup Buku** sekarang, selain memposting jurnal Amortisasi (Fase 4) &
Apropriasi Dana Cadangan (Fase 6), juga menyimpan **snapshot saldo SEMUA
akun** untuk bulan itu ke `gwg_data/shared/saldoAkunBulanan/{YYYY-MM}`.
**Buka Kunci** menghapus snapshot bulan itu (supaya kalau ditutup ulang,
dihitung ulang dari data yang benar, bukan snapshot basi).

## Kenapa ini penting
Ini yang membuat `jurnalUmum` detail tahun-tahun lama **suatu saat bisa**
diarsipkan/dihapus dari RTDB (pola arsip yang sama seperti `kontrol` di
Fase 1) **tanpa kehilangan saldo kumulatifnya** — saldo akhir tiap bulan
sudah "dibekukan" di snapshot, permanen, tidak bergantung lagi pada jurnal
mentah yang mungkin sudah tidak ada di RTDB aktif. Fase 8 nanti akan
memakai snapshot ini: bulan yang SUDAH tertutup tinggal dibaca angkanya,
bulan yang MASIH berjalan dihitung live dari `jurnalUmum`.

## Cara kerja perhitungan
1. **Saldo awal** tiap akun = `saldoAkhir` dari snapshot **bulan sebelumnya**
   (atau 0 semua kalau ini bulan pertama yang pernah ditutup buku).
2. **Entry bulan ini** = seluruh `jurnalUmum` yang tanggalnya jatuh di bulan
   ini (dari transaksi Kas/Kontrol/Aset/Hutang-Piutang sepanjang bulan)
   **DITAMBAH** 2 entry Amortisasi & Dana Cadangan yang baru saja diposting
   di langkah sebelumnya dalam klik Tutup Buku yang sama.
3. **Saldo akhir** = saldo awal + debit − kredit (untuk akun bernormal
   debit) atau + kredit − debit (untuk akun bernormal kredit).

## ⚠️ Detail teknis penting: kenapa entry Amortisasi/Dana Cadangan ditambah manual
`postJurnal()` mengubah state React secara **asinkron** (lewat `addRecord`).
Kalau snapshot dihitung dengan langsung membaca `db.jurnalUmum` tepat
setelah memanggil `postJurnal()` di baris sebelumnya, 2 entry yang BARU SAJA
diposting (Amortisasi & Dana Cadangan) **belum tentu sudah masuk** ke
`db.jurnalUmum` saat itu — state React belum sempat re-render. Makanya
kedua entry itu disimpan dulu di variabel lokal (`barisAmortisasi`,
`barisDanaCadangan`) dan digabung manual ke daftar entry sebelum dihitung,
supaya snapshot pertama kali langsung akurat tanpa perlu klik dua kali.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `bulanSebelumnya()`, `hitungSnapshotSaldoAkun()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `tutupBukuBulanIni()` menghitung & menyimpan snapshot; `bukaKunciBulan()` menghapus snapshot bulan terkait |

## ⚠️ Belum dipakai di mana pun untuk tampilan
Snapshot ini **tersimpan** tapi **belum dibaca** oleh Laporan Neraca/Laba
Rugi mana pun — `NeracaKeuangan.jsx` masih 100% menghitung ulang dari tabel
mentah seperti sebelumnya (`kasTransaksi`, `hutangPiutang`, dst), TIDAK dari
`saldoAkunBulanan` atau `jurnalUmum`. Menyambungkan itu adalah **Fase 8**,
yang sengaja dijeda dulu untuk didiskusikan karena berisiko mengubah angka
yang tampil ke user.

## Yang BELUM disentuh
Fase 8 — mengganti cara `NeracaKeuangan.jsx` menghitung Neraca/Laba Rugi
dari hitung-ulang manual jadi query saldo akun (`saldoAkunBulanan` untuk
bulan tertutup + `jurnalUmum` live untuk bulan berjalan).
