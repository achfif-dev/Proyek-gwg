# Perubahan: Fase 8 (Opsi B) — Neraca Versi Jurnal (Perbandingan)

Status: **Selesai.** Ini BUKAN migrasi penuh — Laporan Neraca lama **tidak
disentuh sama sekali** dan tetap jadi sumber utama seperti biasa. Section
baru ini cuma tampil **berdampingan** untuk keperluan verifikasi/uji coba,
sesuai kesepakatan (Opsi B) sebelum diputuskan migrasi total.

## Yang berubah secara perilaku
Di sub-tab **Laporan Neraca**, di bagian paling bawah (setelah kartu
Aset/Kewajiban/Ekuitas yang lama), ada card baru **"🧪 Neraca (versi
Jurnal) — Perbandingan"** yang bisa di-expand/collapse. Defaultnya
collapsed (tidak mengganggu tampilan yang sudah ada).

Isinya:
- **Cek keseimbangan** (Aset = Kewajiban + Ekuitas + Laba Berjalan) —
  hijau kalau balance, oranye + selisihnya kalau TIDAK balance (tandanya
  ada bug di salah satu Fase 1-7 yang perlu diperiksa).
- Total per tipe akun (Aset, Kewajiban, Ekuitas, Pendapatan, Beban).
- Rincian saldo tiap akun yang ada isinya (akun dengan saldo 0 disembunyikan
  biar tidak penuh).

## Cara pakai untuk verifikasi
Bandingkan angka di card baru ini dengan angka di Laporan Neraca lama di
atasnya:
- **Total Aset** (versi Jurnal) vs **TOTAL ASET** (lama)
- **Kewajiban + Ekuitas** (versi Jurnal) vs **TOTAL KEWAJIBAN + EKUITAS** (lama)

Kalau angkanya jauh berbeda, itu sinyal ada transaksi yang belum
diposting/salah posting di salah satu Fase 2-6 — **berguna justru karena
independen sepenuhnya** dari perhitungan lama (sumber datanya beda total:
jurnal berpasangan vs hitung-ulang tabel mentah).

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `hitungSaldoAkunTerkini()`, `ringkasanSaldoAkunPerTipe()` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | + komponen baru `NeracaVersiJurnal`, dipasang di akhir section "neraca" |

## Cara kerja perhitungan
1. **Saldo awal** = snapshot bulan **tertutup terakhir** yang ada di
   `saldoAkunBulanan` (Fase 7). Kalau belum pernah ada Tutup Buku sama
   sekali, saldo awal = 0 semua.
2. **+ seluruh `jurnalUmum`** (yang sedang termuat — tahun berjalan) dengan
   tanggal SETELAH bulan snapshot terakhir itu, sampai hari ini.
3. Hasilnya = saldo tiap akun **per HARI INI** (bukan per-periode filter
   seperti Laporan Neraca lama, yang tergantung dropdown periode/tanggal).

## ⚠️ Kenapa mungkin TIDAK BALANCE, dan itu bukan berarti sistem rusak
Pendapatan & Beban di desain double-entry ini **belum pernah "ditutup"**
(closing entry) ke Laba Ditahan di titik mana pun — sengaja belum
ditambahkan sampai fase ini. Supaya pengecekan tetap valid, `Pendapatan −
Beban` (disebut "Laba Berjalan") dihitung terpisah dan dianggap bagian dari
Ekuitas sementara. Kalau nanti closing entry ditambahkan (opsional, bisa di
fase lanjutan), "Laba Berjalan" akan berpindah permanen jadi bagian
`3102 Laba Ditahan`.

Ketidakseimbangan yang **genuine** (bukan karena closing entry) berarti ada
bug nyata di salah satu fase posting — dan itu justru tujuan dibuatnya
section ini: mendeteksi masalah SEBELUM diputuskan migrasi penuh.

## Yang BELUM dikerjakan
- Migrasi PENUH (mengganti Laporan Neraca lama) — sengaja ditahan sampai
  hasil perbandingan ini diverifikasi dulu di lapangan/cabang uji coba.
- Closing entry Pendapatan/Beban → Laba Ditahan (opsional, tergantung
  apakah "Laba Berjalan" terpisah ini sudah cukup jelas atau perlu benar-
  benar di-carry-forward).
- Neraca versi Jurnal untuk PERIODE tertentu (saat ini cuma "per hari ini",
  belum ada filter tanggal seperti Laporan Neraca lama).
