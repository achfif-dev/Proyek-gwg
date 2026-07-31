# Perubahan: Bidang Bisnis Multi-Industri, Font Dinamis, & Fix Warna Tombol Refresh

## 1. Setup Wizard — dukungan lintas Bidang Bisnis
Aplikasi ini SECARA FUNGSIONAL sudah generik (istilah Produk/Toko/Kontrol/
Rekap/Bagi Hasil bukan spesifik parfum), jadi sudah bisa dipakai perusahaan
konsinyasi bidang apa pun. Yang ditambahkan:

- `src/config/appConfig.js`:
  - `brand.businessField` & `brand.businessFieldOther` (field baru, opsional).
  - `BUSINESS_FIELD_OPTIONS` — daftar bidang usaha umum + "Lainnya".
  - `getBusinessFieldLabel()`, `suggestTagline()` — helper untuk menampilkan
    & menyarankan tagline berdasarkan bidang yang dipilih.
- `src/features/setup/SetupWizard.jsx` (Step 1 — Branding):
  - Dropdown **Bidang Bisnis** (+ input teks manual kalau pilih "Lainnya").
  - Placeholder Tagline otomatis menyesuaikan bidang yang dipilih.
  - Ringkasan (Step 4) menampilkan Bidang Bisnis yang dipilih.
- Tidak ada fitur/tab yang disembunyikan berdasarkan bidang ini — murni
  untuk identitas & saran teks, supaya wizard terasa relevan untuk
  perusahaan non-parfum juga.

## 2. Font Aplikasi Dinamis
- File baru `src/theme/fonts.js`:
  - `FONT_OPTIONS` — 6 pilihan font (Inter, Poppins, Nunito, Roboto,
    Plus Jakarta Sans, Font Sistem/perangkat).
  - `ensureFontLoaded()` — menyuntikkan `<link>` Google Fonts sesuai
    pilihan (idempotent), kecuali "Font Sistem" yang tidak perlu load apa pun.
  - `getFontStack()` — resolve nilai tersimpan jadi CSS `font-family` stack.
- `src/config/appConfig.js`: `brand.fontFamily` (default: `"inter"`).
- `src/theme/tokens.js`: `T.fontFamily` dihitung dari brand config saat
  modul dimuat, dan otomatis memanggil `ensureFontLoaded()`.
- `src/App.jsx`, `src/components/LoginPage.jsx`,
  `src/features/setup/SetupWizard.jsx`: root container masing-masing
  sekarang pakai `fontFamily:T.fontFamily` (sebelumnya hardcode
  `'Inter',system-ui,sans-serif` di App.jsx). Karena hampir semua elemen
  lain di aplikasi sudah pakai `fontFamily:"inherit"`, mengganti di root
  saja sudah cukup untuk mengubah font di SELURUH aplikasi.
- Wizard Step 1 menampilkan dropdown **Font Aplikasi** dengan preview teks
  langsung (live, sebelum disimpan).

## 3. Fix: Tombol Refresh APK & Semua Warna Hijau Hardcode Ikut Warna Brand
- `src/App.jsx` — tombol refresh mengambang khusus WebView native (APK),
  yang dibuat manual lewat `document.createElement("button")`, sebelumnya
  hardcode `background: "#16a34a"` (hijau) terlepas dari warna brand yang
  dipilih di Setup Wizard. Sekarang pakai `T.green` (= `brand.primaryColor`),
  konsisten dengan warna header & tombol lain di aplikasi.
- `src/App.jsx` — pesan sukses/gagal di Backup Cloud, Google Drive, Arsip,
  dan Migrasi Database sebelumnya juga hardcode hijau GWG (`#0F4C35`,
  `#166534`, dst) — sekarang ikut `T.green`/`T.greenLt`.
- `src/lib/exportUtils.js` — semua warna header di file ekspor (PDF native
  jsPDF, gambar/canvas, print HTML, export HTML sederhana) sebelumnya
  hardcode `#0F4C35`/`rgb(15,76,53)` walau nama & logo perusahaan sudah
  ikut brand. Ditambah `BRAND_COLOR` (hex), `BRAND_COLOR_LT` (varian
  terang untuk teks sekunder), dan `BRAND_COLOR_RGB` (array untuk jsPDF) —
  semua laporan yang diekspor sekarang otomatis memakai warna brand
  perusahaan yang login, bukan hijau GWG.
