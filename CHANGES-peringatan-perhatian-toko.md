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
- Ambang (35 hari, 7 hari, dst.) masih nilai bawaan di `ANALITIK_DEFAULT`, belum bisa diubah dari UI.
- Belum diuji dengan data asli maupun di HP. Tes memakai data sintetis (termasuk 3.800 toko × 12 kontrol < 1 dtk di Node).
  **Cara validasi**: bandingkan daftar di kartu dengan penilaian Anda atas ±20 toko yang Anda kenal.
- Peringatan slow-moving, tren turun, dan anomali belum dibuat.
