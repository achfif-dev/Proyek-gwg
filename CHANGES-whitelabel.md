# Perubahan: Integrasi White Label

Mengadopsi arsitektur white-label dari `Proyek-gwg-main-whitelabel-main`
ke project ini, TANPA menghilangkan perbaikan sinkronisasi/performa yang
sudah dikerjakan sebelumnya (dataStillSyncing, anti-echo tulisan lokal,
optimisasi useAnalytics/TabKontrol, dropdown SearchableSelect, dsb).

## File BARU
- `src/config/appConfig.js` — penyimpanan konfigurasi runtime (branding +
  Firebase + Super Admin) di localStorage, diisi lewat Setup Wizard.
- `src/features/setup/SetupWizard.jsx` — wizard 4 langkah (Branding →
  Firebase → Super Admin → Ringkasan).
- `.env` — nilai bawaan GWG (branding build-time + kredensial Firebase GWG
  + email Super Admin) — instance yang sudah jalan sekarang TIDAK berubah
  sama sekali karena nilainya persis sama dengan yang sebelumnya hardcoded.
- `PANDUAN-SETUP-WHITE-LABEL.md` — panduan untuk perusahaan lain yang mau
  fork & pakai aplikasi ini dengan identitas/Firebase sendiri.

## File di-REPLACE (diambil apa adanya dari repo whitelabel — tidak ada
konflik dengan perubahan sebelumnya)
- `src/firebase/config.js` — baca dari `loadAppConfig()`, bukan hardcode.
- `src/theme/tokens.js` — warna utama/aksen dari brand config (default:
  hijau/emas GWG kalau belum diisi).
- `src/config/superAdmin.js` — email Super Admin dari `appConfig`.
- `src/components/LoginPage.jsx` — tampilkan `SetupWizard` otomatis kalau
  Firebase belum dikonfigurasi; branding dinamis di halaman login.
- `src/lib/importUtils.js`, `src/lib/exportUtils.js` — nama perusahaan &
  logo di semua ekspor (Excel/PDF/Cetak/Gambar) ikut brand config.
- `vite.config.js`, `index.html` — judul tab, nama PWA, theme-color dibaca
  dari `.env` saat build (bukan lagi hardcode "GWG Super App").
- `.github/workflows/android-build.yml` — `capacitor.config.json` (appId,
  appName APK) di-generate dari `.env` saat build APK.

## File di-MERGE manual (supaya tidak menghilangkan fix sebelumnya)
- `src/App.jsx`:
  - Import `loadAppConfig`, `getBrandLogo`, `SetupWizard`.
  - State `brand`, `brandLogo`, `showSetupWizard` + efek `document.title`.
  - Semua teks/logo hardcoded ("Generasi Wangi Group", GWG_LOGO_B64) di
    favicon, loading screen, dan header diganti jadi dinamis dari `brand`.
  - Render `<SetupWizard onCancel={...}/>` saat `showSetupWizard` true
    (hanya bisa dibuka Admin lewat menu ☰ → ⚙️ Setup Aplikasi).
  - Semua fix sebelumnya (banner `dataStillSyncing`, prop ke
    Dashboard/TabKontrol/TabRekap, dst) **tetap utuh, tidak tersentuh**.

## Cara pakai untuk instance GWG yang sudah berjalan
Tidak ada tindakan tambahan — `.env` sudah berisi kredensial & branding
GWG yang sama persis dengan sebelumnya, jadi build & perilaku aplikasi
tetap sama. Fitur baru (Setup Wizard) hanya akan terlihat lewat menu
☰ → ⚙️ Setup Aplikasi (khusus Admin) kalau suatu saat ingin diubah.

## Cara pakai untuk perusahaan lain yang fork
Ikuti `PANDUAN-SETUP-WHITE-LABEL.md` — inti: kosongkan `VITE_FIREBASE_*`
di `.env` sebelum deploy pertama kali, supaya Setup Wizard otomatis
muncul di halaman login.
