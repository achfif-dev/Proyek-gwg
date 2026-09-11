# Setup Firebase untuk Sinkronisasi Cloud (Multi-Cabang)

Fitur **Sinkronisasi Cloud** (Pengaturan > Multi-Cabang) mengirim **ringkasan omzet harian**
tiap cabang (bukan detail transaksi/produk/pelanggan) ke [Firestore](https://firebase.google.com/docs/firestore),
supaya pemilik bisa melihat gabungan omzet semua cabang dari satu HP lewat layar
**Ringkasan Semua Cabang**.

Fitur ini **nonaktif secara default** dan aplikasi tetap 100% offline-first tanpa langkah di
bawah ini — hanya perlu dilakukan kalau kamu memang ingin memakai fitur multi-cabang.

## 1. Buat proyek Firebase

1. Buka [console.firebase.google.com](https://console.firebase.google.com), klik **Add project**.
2. Beri nama bebas (mis. "POS App Toko Saya"), lanjutkan sampai selesai (Google Analytics boleh
   dimatikan, tidak dipakai fitur ini).

## 2. Daftarkan aplikasi Android

1. Di dashboard proyek, klik ikon Android untuk **Add app**.
2. **Android package name**: isi persis sesuai `applicationId` di `app/build.gradle.kts`
   (repo ini sekarang pakai: `id.shiftq.posapp` — cek `app/build.gradle.kts` kalau sudah diganti lagi).
3. Nickname app & SHA-1 boleh dikosongkan (tidak dipakai fitur ini).
4. **Download `google-services.json`**.

## 3. Taruh file konfigurasi

Upload file `google-services.json` yang barusan didownload ke folder **`app/`** di repo ini
(sejajar dengan `app/build.gradle.kts`), lewat GitHub web UI (Add file > Upload files).

> Build sengaja dibuat mendeteksi keberadaan file ini secara otomatis (lihat komentar di
> `app/build.gradle.kts`) — kalau file belum ada, build tetap sukses dan fitur cloud sync
> otomatis nonaktif (bukan error).

> **Penting:** plugin `com.google.gms.google-services` yang memproses file ini HARUS sudah
> terdaftar di `build.gradle.kts` (root project, bukan `app/build.gradle.kts`). Kalau repo ini
> kamu dapat dari sebelum perbaikan ini ditambahkan, build akan gagal dengan error
> `Plugin with id 'com.google.gms.google-services' not found` begitu `google-services.json`
> di-upload — root `build.gradle.kts` sudah diperbaiki untuk mendaftarkan plugin ini di baris
> `plugins { ... }`, jadi cukup pastikan repo kamu sudah pakai versi terbaru.

## 4. Aktifkan Firestore & Authentication

Di Firebase Console, proyek yang tadi dibuat:

1. **Build > Firestore Database > Create database** — pilih mode **production**, lokasi server
   terdekat (mis. `asia-southeast2` untuk Indonesia).
2. **Build > Authentication > Get started > Sign-in method > Anonymous** — aktifkan.
   (App memakai sign-in anonim, bukan akun Google/email, murni supaya Firestore Security Rules
   bisa membedakan "device app ini" dari pengunjung acak — tidak ada data pribadi yang dikirim.)

## 5. Pasang Firestore Security Rules

Di **Firestore Database > Rules**, ganti isinya jadi:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /outlet_summaries/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Ini membatasi akses hanya untuk client yang sudah sign-in anonim (app ini), bukan siapa pun yang
kebetulan tahu konfigurasi publikmu. Klik **Publish**.

## 6. Build & jalankan

Push/upload perubahan (termasuk `google-services.json` yang baru ditambahkan) ke GitHub, jalankan
Actions seperti biasa. Setelah APK terinstall di tiap cabang:

1. Buka **Pengaturan > Multi-Cabang > Sinkronisasi Cloud** di tiap device cabang.
2. Isi **Nama Cabang** yang berbeda-beda per device (mis. "Cabang Kelapa Gading", "Cabang Bekasi").
3. Nyalakan toggle **Aktifkan Sinkronisasi Cloud**.
4. Setelah ada transaksi, cek **Pengaturan > Multi-Cabang > Ringkasan Semua Cabang** — omzet hari
   itu dari semua cabang yang sudah sinkron akan muncul digabung.

## Batasan versi ini

- Yang disinkronkan **hanya ringkasan omzet harian** (total omzet + jumlah transaksi per hari per
  cabang) — bukan detail produk/stok/pelanggan/piutang. Manajemen produk, stok, dan piutang tetap
  sepenuhnya per-device/per-cabang.
- Ringkasan Semua Cabang menampilkan data **hari ini** saja (belum ada pilihan rentang tanggal).
- Ini fondasi awal — kalau ke depan kamu butuh sinkronisasi penuh (produk/stok terpusat, riwayat
  multi-hari, dsb.), itu pengembangan lanjutan di atas fondasi ini.
