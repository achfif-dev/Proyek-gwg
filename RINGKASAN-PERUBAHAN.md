# Ringkasan Perubahan — Optimasi GWG Super App

15 file diubah, dikelompokkan jadi 4 batch optimasi. **Cara pakai**: timpa file-file ini
ke lokasi yang sama persis di repo kamu (struktur folder di zip ini sudah sama dengan
struktur `src/` proyek), lalu jalankan `npm run build` untuk verifikasi. Semua perubahan
ini belum pernah di-build/test langsung di sandbox (tidak ada akses internet/node_modules
di sini) — kalau ada error saat build, kirim log-nya untuk dibantu perbaiki.

## 1. Fix build gagal di GitHub Action (bundle > 2 MiB)
- `vite.config.js` — `maximumFileSizeToCacheInBytes` dinaikkan + `manualChunks` untuk
  memecah bundle vendor (Firebase, xlsx, jspdf, html2canvas, dst) jadi file terpisah.

## 2. Code-splitting per tab (React.lazy + Suspense)
- `src/App.jsx` — 8 komponen tab (`TabWilayah`, `TabRute`, `TabToko`, `TabProduk`,
  `TabKontrol`, `TabRekap`, `TabBagiHasil`, `TabPengguna`) diubah dari import statis
  jadi `React.lazy()`, dibungkus 1 `<Suspense>`. Tab yang tidak bisa diakses role
  tertentu (mis. Sales) tidak akan pernah ter-download.
- `src/lib/dataHelpers.js` — fungsi `autoUpgradeBaruToAktif()` dipindah ke sini dari
  `TabToko.jsx` supaya App.jsx bisa memanggilnya tanpa memuat komponen TabToko.
- `src/features/toko/TabToko.jsx` — fungsi di atas dihapus dari sini (sudah pindah).
- `src/features/rekap/TabRekap.jsx` — **bonus fix**: import `autoUpgradeBaruToAktif`
  yang sebelumnya menunjuk ke lokasi lama (sudah dipindah), diarahkan ulang ke
  `dataHelpers.js`. Tanpa ini build akan gagal.

## 3. Logo default tidak lagi di-embed sebagai base64 di kode JS
- `src/theme/logo.js` — konstanta `GWG_LOGO_B64` (~127 KB base64) dihapus.
  `GWG_EXPORT_LOGO_B64` (untuk watermark PDF, jauh lebih kecil) tetap dipertahankan.
- `src/config/appConfig.js` — fallback logo default (`getBrandLogo()`) sekarang
  mengarah ke file `/logo.png`, bukan string base64. Tidak mengubah mekanisme
  white-label — logo custom perusahaan lain tetap lewat `logoDataUrl` di Setup Wizard.
- `src/lib/exportUtils.js` — fallback logo untuk fitur "Export HTML" juga diarahkan
  ke `/logo.png`.

## 4. React.memo di 9 komponen tab-level
- `src/features/dashboard/Dashboard.jsx`
- `src/features/wilayah/TabWilayah.jsx`
- `src/features/rute/TabRute.jsx`
- `src/features/toko/TabToko.jsx`
- `src/features/produk/TabProduk.jsx`
- `src/features/kontrol/TabKontrol.jsx` (paling berdampak — 3.500+ baris)
- `src/features/rekap/TabRekap.jsx`
- `src/features/bagihasil/TabBagiHasil.jsx` (otomatis melindungi NeracaKeuangan juga)
- `src/features/pengguna/TabPengguna.jsx`

Semua tab tetap ter-*mount* sekaligus (disembunyikan lewat `display:none`, bukan
di-unmount), jadi tanpa `memo` semua tab ikut re-render tiap kali data Firebase
berubah. Sudah diverifikasi: semua props yang dikirim ke tab-tab ini (db, analytics,
addRecord/updateRecord/deleteRecord/save, dst) sudah stabil lewat useState/useMemo/
useCallback, jadi `memo` ini langsung efektif tanpa perlu perubahan tambahan.

## Yang BELUM dikerjakan (dari daftar optimasi sebelumnya)
- `measuredWidths()` di `exportUtils.js` — export PDF 5.000 baris berpotensi lambat.
- Import `exportUtils` statis di `App.jsx` sendiri (fitur arsip viewer) — masih
  memaksa xlsx/jspdf ikut ke bundle utama.
- Pemecahan `TabKontrol.jsx` (3.500+ baris) jadi sub-komponen lebih kecil.
- `.env` belum di-`.gitignore`-kan (kredensial + email admin berpotensi ter-commit).
