# Perubahan: Akurasi Akuntansi Setelah Arsip Kontrol Tahun Lama

## Latar Belakang
Fitur arsip (`archiveKontrolYear` di `useDB.js`) memindahkan data kontrol
tahun lama ke Google Drive lalu menghapusnya dari RTDB — ini penting supaya
kuota gratis Firebase RTDB (1GB) tidak cepat penuh. Tapi ini menabrak dua
asumsi diam-diam di logika akuntansi:

1. **Kewajiban Dana Cadangan Kumulatif** (`neracaHelpers.js`) dihitung dari
   `analytics.kontrol` — yaitu HANYA tahun-tahun yang sedang termuat di state
   aktif. Begitu sebuah tahun diarsipkan, angka kumulatifnya diam-diam
   berkurang, padahal niatnya "jumlah dari SELURUH transaksi sepanjang
   sejarah aplikasi".
2. **Laporan periode** (Bagi Hasil, Neraca, Pajak, Rekap) yang dihitung untuk
   rentang tanggal bebas (mode Bulanan/Kustom/Harian/Siklus) bisa saja
   menyentuh tahun yang sudah diarsip — hasilnya tampil Rp0 di semua angka
   tanpa penjelasan, seolah memang tidak ada penjualan bulan itu.

Dua kategori temuan ini diperbaiki dengan pendekatan berbeda: yang pertama
diperbaiki **secara matematis** (angka tetap akurat), yang kedua **tidak bisa**
diperbaiki secara matematis (datanya memang sengaja dipindah keluar RTDB),
jadi solusinya adalah peringatan eksplisit ke admin.

## 1. Dana Cadangan Kumulatif — tetap akurat walau diarsip

- **`src/lib/dataHelpers.js`** — fungsi baru `hitungAgregatTahunKontrol(yearDataMap, produkArr)`:
  menghitung total pcs terjual / revenue / bonus dari satu tahun data kontrol
  MENTAH (format Firebase langsung, field `terjual_{produkId}` dst).
  `totalTerjualTahun` tidak bergantung harga produk sama sekali, jadi selalu
  akurat kapan pun dihitung.
- **`src/hooks/useDB.js`**:
  - `archiveKontrolYear()` sekarang menghitung agregat tahun tsb SEBELUM data
    dihapus dari RTDB, lalu menyimpannya permanen sebagai bagian dari
    `kontrolArchiveIndex/{tahun}` (field `totalTerjualTahun`, `totalRevTahun`,
    `totalBonusTahun`, `agregatComputedAt`).
  - Fungsi baru `recalcArchivedYearAgregat(tahun)` — untuk arsip LAMA yang
    dibuat sebelum fitur ini ada (belum punya agregat tersimpan): download
    ulang file arsipnya dari Drive sekali, hitung, simpan permanen ke index.
  - State/hook baru yang di-expose: `archivedKontrolAgregat` (per tahun),
    `totalArsipPcsTerjual` (`{ total, adaYangPerluDihitungUlang, tahunPerluDihitungUlang }`).
- **`src/lib/neracaHelpers.js`** — `hitungDanaCadanganKumulatif()` menerima
  parameter tambahan `arsipPcsTerjual`, dijumlahkan ke total pcs sebelum
  dikali Rp/pcs.
- **`src/App.jsx` → `TabBagiHasil.jsx` → `NeracaKeuangan.jsx`** — prop-prop
  baru diteruskan berjenjang ke perhitungan `kewajibanCadangan`. Di Laporan
  Neraca, kalau ada arsip lama yang belum punya agregat, muncul banner
  oranye + tombol **"Hitung Ulang Sekarang"** (bukan diam-diam kurang akurat).

**Catatan:** `totalRevTahun` hasil hitung ulang arsip lama pakai harga produk
SAAT INI (bukan harga historis saat tahun itu berjalan) — jadi hanya estimasi.
`totalTerjualTahun` (pcs, satu-satunya yang dipakai Dana Cadangan) tetap
akurat karena tidak bergantung harga.

## 2. Laporan Periode — peringatan eksplisit saat overlap arsip

Tidak bisa "diperbaiki" secara matematis (data memang sengaja dipindah), jadi
ditambahkan deteksi otomatis + banner peringatan oranye di 2 tempat:

- **`src/features/bagihasil/TabBagiHasil.jsx`** — `periodeArsipOverlap`:
  dihitung dari `bounds` (rentang tanggal periode aktif) vs `archivedKontrolYears`.
  Banner tampil di atas SEMUA sub-tab (Bagi Hasil, Neraca, Pajak) begitu
  mode Bulanan/Kustom menyentuh tahun terarsip. Mode Tahunan otomatis aman
  (dropdown Tahun dibangun dari `kontrol` yang termuat).
- **`src/features/rekap/TabRekap.jsx`** — `periodeArsipOverlapRekap`: sama,
  untuk mode Harian, Bulanan, Siklus Wilayah, dan Perputaran Stok (submode
  Bulanan). Mode Kuartal/Tahunan/Ranking sudah aman/jujur sejak awal, tidak
  disentuh.
- **`src/App.jsx`** — meneruskan `archivedKontrolYears` (dan untuk Bagi Hasil,
  juga `archivedKontrolAgregat` / `recalcArchivedYearAgregat` / `totalArsipPcsTerjual`)
  dari `useDB()` ke kedua tab.

Pesan banner mengarahkan admin ke menu **Backup & Restore** untuk
melihat/mengekspor arsip tahun yang bersangkutan.

## Bagian yang SUDAH aman sejak awal (tidak diubah)
- **Dashboard** — caption "Total Pendapatan" sudah dinamis mengikuti rentang
  tahun yang benar-benar termuat, bukan klaim "semua waktu".
- **Tab Kontrol** — daftar "tahun belum dimuat" sumbernya `kontrolYearsIndex`,
  otomatis bersih begitu tahun diarsip.
- **Mode Kuartal & Tahunan** (Bagi Hasil, Rekap) — dropdown Tahun dibangun
  dari `kontrol` yang termuat, tahun terarsip otomatis hilang dari pilihan.
- **Mode Ranking** (Rekap) — opsi "Semua Waktu" sudah diberi label yang jujur
  (data yang sudah dimuat), bukan klaim salah.
- Semua rumus lain di Neraca (Stok Sistem, Nilai Persediaan, Kas Opname,
  Amortisasi, Hutang/Piutang) berbasis SALDO SAAT INI (bukan riwayat mentah
  kontrol), jadi tidak tersentuh sama sekali oleh arsip.

## Rules Firebase (`database_rules_v6_neraca.json`)
**Tidak perlu diupdate.** Field agregat baru (`totalTerjualTahun`,
`totalRevTahun`, `totalBonusTahun`, `agregatComputedAt`) ditulis sebagai
bagian dari objek yang sama di path `kontrolArchiveIndex/{tahun}`. Rule yang
sudah ada di path itu (`$tahun` → `.write`: Admin/Manajer, tanpa validasi
per-field) sudah mengizinkan penulisan seluruh objek termasuk field baru ini
tanpa perubahan apa pun.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/dataHelpers.js` | + `hitungAgregatTahunKontrol()` |
| `src/lib/neracaHelpers.js` | `hitungDanaCadanganKumulatif()` + param `arsipPcsTerjual` |
| `src/hooks/useDB.js` | agregat saat arsip, `recalcArchivedYearAgregat()`, expose state baru |
| `src/App.jsx` | teruskan props arsip ke `TabBagiHasil` & `TabRekap` |
| `src/features/bagihasil/TabBagiHasil.jsx` | banner overlap arsip |
| `src/features/bagihasil/NeracaKeuangan.jsx` | pakai agregat arsip + banner "Hitung Ulang Sekarang" |
| `src/features/rekap/TabRekap.jsx` | banner overlap arsip (mode berisiko) |

Tidak ada file yang DIHAPUS atau file baru selain dokumentasi ini.
