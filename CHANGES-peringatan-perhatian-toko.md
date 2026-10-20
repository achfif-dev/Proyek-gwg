# Dashboard: kartu "Perlu Perhatian" (terlambat dikontrol & perkiraan stok habis)

**Tujuan**: pimpinan/Admin melihat toko yang perlu ditindak tanpa membuka Tab Kontrol satu per satu.
Filter "tidak dikontrol dalam N hari" di Tab Kontrol (Diagnostik) sudah ada; kartu ini menampilkannya
di Dashboard lintas wilayah, dan MENAMBAH perkiraan stok habis (baru).

**File**
- `src/lib/analitikToko.js` (baru) — logika murni, tanpa Firebase/React.
- `src/features/dashboard/PerhatianToko.jsx` (baru) — kartu; dipasang di `Dashboard.jsx` (1 import + 1 baris JSX).
- `tests/analitik-toko.test.mjs` (baru) — 14 tes.

**Aturan**
- *Terlambat*: toko Aktif/Baru dengan kontrol terakhir > 35 hari lalu (jarak normal 30 hari + toleransi).
- *Perkiraan stok habis*: laju = JUMLAH terjual ÷ JUMLAH hari dalam jendela (±60 hari, maks 120), bukan rata-rata
  laju per kunjungan — supaya kunjungan yang kadang < 1 bulan tidak membuat laju melonjak. `terjual_*` sebuah
  kontrol dianggap mencakup periode sejak kontrol sebelumnya, jadi kontrol pertama tidak dihitung.
  Stok saat ini = `toko.stok_*`. Tanggal habis = tanggal kontrol terakhir + stok ÷ laju.
  Level: *habis* (perkiraan sudah lewat), *segera* (≤ 7 hari), *waspada* (habis sebelum kunjungan berikutnya, < 30 hari sejak kontrol).
- Kunjungan berstatus Toko Tutup / Bermasalah bukan pengukuran; entri menunggu/ditolak diabaikan; produk yang
  ditarik atau tidak ada di daftar produk toko dilewati; data < 14 hari TIDAK ditandai (bukan ditebak).
- Sales hanya melihat wilayahnya sendiri.

**Belum dicakup / risiko**
- Hanya membaca `db.kontrol` yang termuat (tahun kalender berjalan). Awal tahun riwayat tipis → banyak produk
  "data kurang"; toko tanpa riwayat terlihat dihitung terpisah, tidak dituduh terlambat.
- Musiman (Ramadan/Lebaran/akhir tahun) TIDAK dikoreksi: laju memakai penjualan 1–4 bulan terakhir, jadi bisa
  meleset menjelang/seusai musim. Perkiraan, bukan kepastian.
- Penyesuaian Stok setelah kontrol terakhir mengubah `toko.stok_*` tetapi dianggap berlaku sejak tanggal kontrol terakhir.
- Belum diuji dengan data asli maupun di HP. Tes memakai data sintetis (termasuk 3.800 toko × 12 kontrol < 1 dtk di Node).
  **Cara validasi**: bandingkan daftar di kartu dengan penilaian Anda atas ±20 toko yang Anda kenal.
- Peringatan slow-moving, tren turun, dan anomali belum dibuat.

## Tahap 2: ambang bisa diatur (Admin/Manajer)

- Ikon ⚙ di kartu membuka panel: jarak kunjungan normal (30), batas terlambat (35), batas "segera" (7), dan —
  di "Pengaturan lanjutan" — data minimum (14), jendela perhitungan (60), data tertua (120). Ada tombol
  "Kembalikan bawaan" (menghapus node).
- Disimpan SATU kali untuk semua pengguna di `gwg_data/_config/analitikToko`. Sales/Viewer ikut membaca (tanpa ⚙).
  Alasan tidak memakai `bagiHasilConfig`: path itu hanya bisa DIBACA Admin/Manajer (Sales tak bisa), dan
  `saveConfig` menimpa seluruh objek sehingga kunci tambahan bisa hilang.
- **Wajib publikasikan `firebase-rules/database_rules_v18_analitik_toko.json`** (= v17 + node baru). Tanpa itu:
  kartu tetap jalan memakai bawaan/cache terakhir; tombol Simpan menampilkan "Ditolak server…".
- Validasi dua lapis: form (ketat, tolak — tidak memotong diam-diam; aturan antar-field: terlambat ≥ jarak,
  segera < jarak, min ≤ target ≤ maks) dan Rules (rentang tiap angka + tolak field asing). Aturan antar-field
  TIDAK bisa diekspresikan di Rules, jadi hanya dijaga klien; data yang melanggar dibaca sebagai bawaan.
- Cache lokal `gwg.analitikToko.v1` supaya kartu memakai nilai terakhir saat offline.
- Perubahan baru: `src/lib/analitikConfig.js`, `tests/rules-analitik-toko.test.mjs`; sentuhan kecil di `App.jsx`
  (1 prop: `bolehAturPeringatan={isManajer}`) dan `Dashboard.jsx`.
- **Belum**: pengaturan tidak ikut Ekspor/Backup (berada di `_config`, bukan `shared`); belum diuji di Firebase asli.
