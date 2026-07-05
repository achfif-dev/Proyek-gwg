# Panduan Deploy Tanpa Terminal Lokal

Ada **dua target build** yang perlu dibedakan — Netlify hanya menangani satu dari keduanya.

## 1. Versi Web / PWA → Netlify (tidak berubah, otomatis)

Netlify **bisa** langsung build & deploy begitu kamu push ke GitHub, karena
`netlify.toml` sudah ada dan Netlify cuma perlu menjalankan `npm install` +
`npm run build` (Vite) — tidak ada langkah native di sini. Tidak ada yang
perlu diubah di sisi Netlify.

## 2. Versi Android (.apk) → **tidak bisa lewat Netlify**

Netlify tidak punya Android SDK/Gradle di server build-nya, jadi ia **tidak
bisa** menghasilkan file `.apk`. Untuk ini dipakai **GitHub Actions**
(`.github/workflows/android-build.yml` yang sudah dibuatkan) — jalan
sepenuhnya di cloud milik GitHub, gratis untuk repo publik/privat kecil,
dan **tidak butuh terminal di komputermu sama sekali**.

### Langkah-langkahnya (semua lewat browser):

1. **Upload semua file project ini ke GitHub** (termasuk folder `.github/`
   yang berisi workflow-nya) — bisa lewat "Add file → Upload files" di web
   GitHub, atau lewat GitHub Desktop kalau kamu punya.
2. Buka tab **Actions** di repo GitHub-mu. Workflow "Build Android APK"
   akan otomatis jalan setiap kamu push ke branch `main`.
3. Tunggu sampai selesai (ikon centang hijau, biasanya 3–6 menit).
4. Klik hasil run yang selesai tadi → scroll ke bagian **Artifacts** →
   download `gwg-superapp-debug-apk.zip`.
5. Ekstrak zip-nya, dapat file `app-debug.apk` → kirim ke HP Android
   (lewat Google Drive/WhatsApp/kabel) → install seperti biasa (aktifkan
   "Install dari sumber tidak dikenal" kalau diminta).

### Catatan penting

- APK dari langkah di atas adalah **versi debug** — cocok untuk testing
  dan dibagikan ke tim lapangan, tapi **belum bisa** diupload ke Play
  Store (Play Store butuh APK/AAB yang **signed** dengan keystore rahasia).
- Kalau nanti sudah siap ke Play Store, tinggal tambah langkah *signing*
  di workflow ini (butuh generate keystore sekali lewat Android Studio
  teman/warnet, lalu simpan sebagai **GitHub Secret** — bukan hal yang
  perlu diulang tiap build).
- Folder `android/` akan dibuat ulang otomatis oleh CI setiap build kalau
  belum ada di repo. Kalau nanti kamu perlu kustom lebih lanjut (izin
  aplikasi, ikon native, nama app di HP), sebaiknya commit folder
  `android/` ke repo setelah generate pertama kali supaya perubahan
  manual tidak hilang di build berikutnya — cukup bilang kalau sudah
  sampai tahap itu, saya bantu susun langkahnya.
