# 📘 Panduan Setup Aplikasi (White Label)

Panduan ini untuk perusahaan konsinyasi lain yang ingin memakai aplikasi
Super App ini dengan **identitas & database Firebase sendiri**, tanpa
mengubah kode program.

Ada 3 lapis pengaturan. Kerjakan **berurutan dari atas ke bawah**:

| Lapis | Diatur lewat | Kapan berlaku | Wajib? |
|---|---|---|---|
| 1. Firebase & Super Admin | Setup Wizard (dalam app) | Langsung, tanpa build ulang | ✅ Wajib |
| 2. Branding tampilan (logo/warna/nama) | Setup Wizard (dalam app) | Langsung, tanpa build ulang | Opsional |
| 3. Judul tab, nama PWA/APK | File `.env` | Perlu build ulang | Opsional |

---

## 🔥 Langkah 1 — Buat Project Firebase Sendiri

1. Buka **[console.firebase.google.com](https://console.firebase.google.com)** → **Add project** → beri nama (mis. nama perusahaan Anda).
2. Di dalam project baru:
   - **Build → Authentication → Get started → Sign-in method → Google** → aktifkan.
   - **Build → Realtime Database → Create database** → pilih lokasi server (mis. Singapore/asia-southeast1) → mulai dengan mode **locked/test**, aturan bisa disesuaikan nanti oleh Admin.
3. Buka **⚙️ Project Settings → General → Your apps → Add app → Web (</>)** → beri nickname → **Register app**.
4. Salin blok kode `firebaseConfig` yang muncul (isinya `apiKey`, `authDomain`, `databaseURL`, dst) — Anda akan tempel ini di Langkah 2. **Jangan tutup dulu halaman ini.**

> ⚠️ **Kalau Anda fork repo ini**: buka file `.env` di root project, cari bagian **"Firebase & Super Admin bawaan"**, lalu **hapus/kosongkan** nilai `VITE_FIREBASE_*` dan `VITE_SUPER_ADMIN_EMAIL` di sana (nilai itu kredensial Firebase GWG, bukan milik Anda). Kalau dibiarkan terisi, Setup Wizard **tidak akan muncul otomatis** dan aplikasi akan diam-diam tersambung ke database GWG.

---

## 🚀 Langkah 2 — Setup Wizard (di dalam aplikasi)

1. Buka aplikasi (URL deploy Anda, atau `npm run dev` di komputer).
2. Karena Firebase belum dikonfigurasi, **Setup Wizard akan otomatis muncul** — tidak perlu login apa pun dulu.
3. **Step 1 – Branding**: isi Nama Perusahaan, Nama Aplikasi, Tagline, Warna Utama & Aksen, dan (opsional) unggah logo.
4. **Step 2 – Firebase**: tempel kode `firebaseConfig` dari Langkah 1 ke kotak "Tempel Kode Konfigurasi Firebase" → klik **🔍 Ambil Otomatis dari Teks** → semua field (apiKey, authDomain, dst) otomatis terisi. Periksa sekali lagi sebelum lanjut.
5. **Step 3 – Super Admin**: isi email akun Google pemilik aplikasi. Akun ini akan **selalu** punya akses Admin penuh, apa pun isi tabel Pengguna nantinya — cocok sebagai "kunci cadangan". Boleh dikosongkan (lihat catatan di bawah).
6. **Step 4 – Ringkasan** → klik **💾 Simpan & Muat Ulang**.

> 💡 **Kalau kolom Super Admin dikosongkan**: akun Google **pertama** yang login akan otomatis menjadi Admin (mekanisme bawaan, berlaku selama tabel Pengguna masih kosong). Jadi langsung login pakai akun yang Anda mau jadikan Admin setelah wizard selesai.

7. Setelah reload, klik **Masuk dengan Google** dan login dengan akun yang tadi ditentukan sebagai Admin/Super Admin.

**Selesai — aplikasi sudah bisa dipakai sepenuhnya dengan database Anda sendiri.**

### Mengubah pengaturan ini nanti
Login sebagai Admin → menu **☰ → ⚙️ Setup Aplikasi (White Label)** — bisa dibuka kapan saja untuk ganti logo/warna/Firebase/Super Admin.

---

## 🎨 Langkah 3 — Branding Build-Time (opsional)

Langkah ini **hanya perlu** kalau Anda deploy instance sendiri (domain/APK
sendiri) dan mau judul tab browser, nama saat "Add to Home Screen", atau
nama APK ikut berganti — karena bagian ini dibaca browser **sebelum**
JavaScript jalan, jadi tidak bisa diatur lewat wizard.

Edit file **`.env`** di root project:

```env
VITE_APP_TITLE=Nama App — Nama Perusahaan Anda
VITE_APP_SHORT_NAME=Nama Pendek
VITE_APP_DESCRIPTION=Aplikasi manajemen konsinyasi Nama Perusahaan Anda
VITE_THEME_COLOR=#0F4C35
VITE_APP_ID=com.namaperusahaananda.app
```

> ⚠️ **`VITE_APP_ID` HANYA boleh diisi SEBELUM build APK pertama kali
> dirilis/disebar.** Ini jadi package name Android — kalau APK sudah
> terpasang di HP orang lalu `VITE_APP_ID` diganti, Android menganggapnya
> aplikasi yang sama sekali berbeda (update tidak akan menimpa yang lama).
> Format wajib domain terbalik, huruf kecil, tanpa spasi.

Setelah diedit, jalankan `npm run build` (untuk web) atau push ke GitHub
(untuk APK, lihat Langkah 4) agar perubahan berlaku.

---

## 🌐 Langkah 4 — Deploy

**Web (PWA):**
1. Fork/clone repo ini ke akun GitHub Anda.
2. Hubungkan repo ke **Netlify** (atau hosting static lain) → build command `npm run build`, publish directory `dist`.
3. Deploy. Buka URL-nya → lanjut ke Langkah 2 di atas.

**APK Android:**
1. Pastikan `.env` sudah diisi sesuai Langkah 3 (terutama `VITE_APP_ID`).
2. Push ke branch `main` di GitHub Anda — workflow **`.github/workflows/android-build.yml`** otomatis jalan (atau pakai tombol **Run workflow** manual di tab **Actions**).
3. Setelah selesai (±10–15 menit), unduh APK dari **Artifacts** hasil run tersebut (nama: `gwg-superapp-debug-apk`).
4. Install APK di HP Android → jalankan → lanjut ke Langkah 2 di atas.

---

## ✅ Checklist Ringkas

- [ ] Project Firebase baru dibuat (Authentication Google + Realtime Database aktif)
- [ ] Setup Wizard diisi: branding, Firebase config, Super Admin
- [ ] Login pertama sebagai Admin berhasil
- [ ] (Opsional) `.env` diisi untuk branding judul tab/PWA/APK
- [ ] (Opsional) `VITE_APP_ID` diisi **sebelum** APK pertama kali dirilis
- [ ] Deploy web (Netlify) dan/atau build APK (GitHub Actions)

---

## ❓ Troubleshooting Singkat

| Masalah | Kemungkinan Penyebab |
|---|---|
| Wizard tidak muncul, malah error | Cek kembali field Firebase — `databaseURL` harus format lengkap `https://xxx.firebasedatabase.app` |
| Tombol "Masuk dengan Google" tidak merespons | Google Sign-in belum diaktifkan di Firebase Authentication |
| Login berhasil tapi tidak jadi Admin | Kolom Super Admin di wizard belum sesuai email yang login, dan tabel Pengguna sudah terisi lebih dulu oleh akun lain |
| Data tidak tersimpan/muncul | Aturan (Rules) Realtime Database masih dalam mode locked penuh — sesuaikan agar user yang login bisa baca/tulis |
