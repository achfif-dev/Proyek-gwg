# 🌿 Generasi Wangi Group — Super App

**Sistem Manajemen Konsinyasi** untuk mengelola wilayah, rute, toko, produk, kontrol kunjungan bulanan, stok, laporan, dan bagi hasil — dalam satu aplikasi web yang bisa diakses dari HP maupun komputer, bisa diinstall seperti aplikasi native, dan tetap berfungsi walau sinyal lemah/offline.

![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/react-18.2-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/vite-5-646CFF?logo=vite&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![License](https://img.shields.io/badge/license-private-lightgrey)

---

## Daftar Isi

1. [Ringkasan Aplikasi](#1-ringkasan-aplikasi)
2. [Tech Stack](#2-tech-stack)
3. [Cara Kerja & Alur Data](#3-cara-kerja--alur-data)
4. [Login & Peran Pengguna (Role)](#4-login--peran-pengguna-role)
5. [Setup Awal Aplikasi](#5-setup-awal-aplikasi)
6. [Panduan Tiap Menu (Tab)](#6-panduan-tiap-menu-tab)
7. [Import & Ekspor Data](#7-import--ekspor-data)
8. [Backup, Restore & Reset Database](#8-backup-restore--reset-database)
9. [Pencegahan Data Duplikat](#9-pencegahan-data-duplikat)
10. [Mode Lokal vs Mode Cloud (Firebase)](#10-mode-lokal-vs-mode-cloud-firebase)
11. [Mode Offline & Sinkronisasi Otomatis](#11-mode-offline--sinkronisasi-otomatis)
12. [Arsip Data Lama (Google Drive)](#12-arsip-data-lama-google-drive)
13. [Instalasi & Menjalankan Secara Lokal](#13-instalasi--menjalankan-secara-lokal)
14. [Build Production & Deploy](#14-build-production--deploy)
15. [Install sebagai Aplikasi (PWA) & Membuat APK Android](#15-install-sebagai-aplikasi-pwa--membuat-apk-android)
16. [Struktur Proyek](#16-struktur-proyek)
17. [Tips & Troubleshooting](#17-tips--troubleshooting)
18. [Catatan Keamanan](#18-catatan-keamanan)

---

## 1. Ringkasan Aplikasi

GWG Super App adalah aplikasi web (Progressive Web App) yang menangani seluruh proses bisnis konsinyasi produk ke toko-toko, mulai dari:

- Pendataan **wilayah**, **rute**, dan **toko** tempat produk dititipkan.
- Pendataan **produk** dan harga.
- Pencatatan **kontrol bulanan** (kunjungan rutin sales ke toko: stok awal, terjual, bonus).
- Pelacakan **stok** otomatis per toko per produk.
- **Rekap** penjualan harian/bulanan/kuartal/tahunan.
- Simulasi **bagi hasil** ke beberapa pihak (pemilik, investor, manajer, dll).
- **Manajemen pengguna** dengan 4 level akses (Admin, Manajer, Sales, Viewer).
- **Backup otomatis**, restore, dan reset database dengan pengaman berlapis.
- **Impor/Ekspor** data lewat Excel, CSV, PDF, HTML, JPG, JSON.
- **Bekerja penuh walau offline/sinyal lemah** — perubahan tersimpan aman di perangkat dan otomatis sinkron begitu online lagi.
- **Arsip data lama** ke Google Drive (15GB gratis, tanpa perlu upgrade paket Firebase) supaya kuota database gratis tidak cepat penuh, tanpa kehilangan data histori.
- **Bisa diinstall** langsung dari browser (Android/iOS/Desktop) seperti aplikasi native, bahkan bisa dibungkus jadi file `.apk`.

Aplikasi bisa berjalan dalam dua mode:
- **Mode Cloud** — data tersinkron real-time lewat Firebase, bisa diakses banyak pengguna & perangkat sekaligus.
- **Mode Lokal** — jika Firebase belum dikonfigurasi, data tetap tersimpan di perangkat (browser) saja.

---

## 2. Tech Stack

| Bagian | Teknologi |
|---|---|
| Framework UI | **React 18** (single-file component utama: `src/GWG_SuperApp.jsx`) |
| Build tool | **Vite 5** |
| PWA / offline | **vite-plugin-pwa** (Workbox) — auto-generate service worker & manifest |
| Backend / database | **Firebase Realtime Database** (data aktif, real-time) |
| Autentikasi | **Firebase Authentication** (Login Google) |
| Arsip data lama | **Google Drive** via Drive REST API (file JSON per tahun, 15GB gratis) |
| Cache & antrean offline | **IndexedDB** (native browser API) + `localStorage` (fallback) |
| Ekspor data | **SheetJS (xlsx)**, serta generator CSV/PDF/HTML/JPG buatan sendiri |
| Hosting | **Netlify** (juga kompatibel dengan Vercel) |
| Pembungkus APK Android | **PWABuilder** (pwabuilder.com) — tanpa perlu menulis kode native |

Aplikasi ini sengaja dibuat **tanpa backend server sendiri** — semua logika bisnis berjalan di sisi client (browser), dan Firebase hanya dipakai sebagai database + autentikasi + penyimpanan file. Ini membuatnya bisa di-deploy sebagai situs statis (cocok untuk Netlify/Vercel gratis).

---

## 3. Cara Kerja & Alur Data

Struktur data disusun berjenjang (hierarkis), dan **wajib diisi berurutan dari atas ke bawah**:

```
📍 Wilayah  →  🛣️ Rute  →  🏪 Toko  →  🧴 Produk (terpisah)
                                   ↓
                          📋 Kontrol Bulanan
                                   ↓
                     📑 Rekap   +   💰 Bagi Hasil
```

- Satu **Wilayah** memiliki banyak **Rute**.
- Satu **Rute** memiliki banyak **Toko**.
- Satu **Toko** menjual satu atau lebih **Produk** dari Master Produk.
- Setiap kunjungan sales ke toko dicatat sebagai satu baris **Kontrol Bulanan** (berisi stok awal, jumlah terjual, dan bonus per produk).
- Dari data Kontrol Bulanan, sistem otomatis menghitung **stok toko**, **revenue**, **rekap laporan**, dan **simulasi bagi hasil**.

> 🔑 **Penting:** Sebelum bisa menambahkan Toko, Anda harus sudah punya minimal satu Rute. Sebelum menambahkan Rute, harus sudah ada minimal satu Wilayah.

---

## 4. Login & Peran Pengguna (Role)

### Cara Login
- Login menggunakan **akun Google** (tombol "Masuk dengan Google").
- Akun pertama yang login (saat tabel Pengguna masih kosong) otomatis menjadi **Admin**.
- Akun Google berikutnya yang login otomatis terdaftar sebagai **Viewer** (hanya bisa melihat), kecuali Admin menaikkan role-nya di tab **Pengguna**.

### 4 Level Role

| Role | Akses Tab | Bisa Ubah Data? | Catatan |
|---|---|---|---|
| **Admin** | Semua tab (termasuk Pengguna) | ✅ Ya, semua | Bisa reset database, backup/restore, kelola pengguna, arsip data |
| **Manajer** | Semua tab kecuali Pengguna | ✅ Ya, semua kecuali data pengguna | Bisa akses Bagi Hasil |
| **Sales** | Hanya Dashboard, Kontrol, Rekap | ✅ Ya, khusus Kontrol Bulanan | Bisa dibatasi hanya melihat 1 wilayah tugas |
| **Viewer** | Hanya Dashboard, Kontrol, Rekap | ❌ Tidak bisa ubah apa pun | Role default untuk akun baru, paling aman |

- Sales bisa diberi **"Wilayah Tugas"** tertentu (diatur Admin di tab Pengguna) sehingga Dashboard, Kontrol, dan Rekap-nya otomatis terkunci hanya menampilkan data wilayah tersebut.
- Sistem memiliki **Super Admin** (email tetap dikonfigurasi di kode) yang perannya selalu Admin dan **tidak bisa diubah/dihapus** siapa pun lewat tab Pengguna — ini pengaman utama supaya aplikasi tidak pernah kehilangan akses admin sepenuhnya.
- Ada juga **jalur darurat anti-deadlock**: jika suatu saat tabel Pengguna kosong dari role Admin, siapa pun yang login otomatis diberi akses Admin sementara agar bisa memperbaiki data pengguna.

---

## 5. Setup Awal Aplikasi

### A. Konfigurasi Firebase (opsional, untuk mode cloud/multi-perangkat)
1. Buka [Firebase Console](https://console.firebase.google.com).
2. Buat proyek baru → aktifkan **Realtime Database** dan **Authentication (Google)**.
3. Ambil konfigurasi SDK Web (Project Settings → SDK Config).
4. Buka file `src/GWG_SuperApp.jsx`, isi variabel `FIREBASE_CONFIG` di bagian atas file dengan konfigurasi tersebut.
5. Jika belum dikonfigurasi, aplikasi tetap berjalan dalam **Mode Lokal** (data tersimpan di browser saja, tanpa login).
6. *(Opsional, hanya untuk fitur "Upload ke Google Drive" & "Arsip Kontrol")* — di [Google Cloud Console](https://console.cloud.google.com) untuk project yang sama, aktifkan **Google Drive API**, lalu tambahkan scope `https://www.googleapis.com/auth/drive.file` ke OAuth consent screen.

### B. Login Pertama Kali
1. Buka aplikasi, klik **"Masuk dengan Google"**.
2. Akun pertama yang login otomatis menjadi **Admin**.
3. Mulai isi data secara berurutan: **Wilayah → Rute → Toko → Produk**.

### C. Menambahkan Pengguna Lain
1. Minta rekan kerja login sekali dengan akun Google mereka (otomatis masuk sebagai Viewer).
2. Admin membuka tab **Pengguna**, cari akun tersebut, klik **Edit**, lalu ubah **Role** (Admin/Manajer/Sales/Viewer) dan **Wilayah Tugas** (khusus Sales) sesuai kebutuhan.

---

## 6. Panduan Tiap Menu (Tab)

Semua tab (kecuali Dashboard) memiliki pola yang sama:
**Tambah** → isi form modal → **Simpan**. **Edit** → klik ikon pensil di baris tabel. **Hapus** → klik ikon hapus (perlu konfirmasi), atau pilih beberapa baris sekaligus dengan checkbox lalu **Hapus Terpilih**. Setiap tabel bisa **dicari/difilter** dan **diekspor**.

### 6.1 Dashboard
Ringkasan kondisi bisnis secara real-time:
- Kartu statistik: Toko Aktif, Total Wilayah, Total Pendapatan, Laba Bersih Estimasi (70% margin), Total Produk, Entri Kontrol, Total Bonus, Pengguna.
- Grafik batang **Revenue per Wilayah** dan **Performa Produk** (jumlah terjual per produk).
- Tabel **Rute Aktif** (jumlah toko & revenue per rute).
- Ringkasan **Simulasi Bagi Hasil** (mengikuti konfigurasi di tab Bagi Hasil).
- Tabel **8 Data Kontrol Terbaru**.
- Bisa diekspor sebagai ringkasan 3 kolom (Kategori/Metrik/Nilai).
- Untuk user **Sales** dengan wilayah tugas, Dashboard otomatis hanya menampilkan data wilayah tersebut (ditandai badge 🔒).

### 6.2 Master Wilayah
- Menyimpan daftar wilayah operasional (contoh: Bangkalan Utara, Bangkalan Selatan, Sampang, dst).
- Kolom: ID, Nama Wilayah, Deskripsi, jumlah Rute, jumlah Toko di wilayah tersebut.
- Otomatis terurut abjad.
- **Validasi anti-duplikat**: nama wilayah yang sama (tanpa membedakan huruf besar/kecil atau spasi) tidak bisa disimpan dua kali.
- **Deteksi & Gabungkan Duplikat**: jika ada wilayah lama yang terlanjur duplikat (misalnya dari sinkronisasi antar perangkat), sistem menampilkan badge ⚠️ **Duplikat** dan tombol **"Gabungkan N Duplikat"** yang otomatis memindahkan semua rute dari wilayah duplikat ke satu wilayah utama, lalu menghapus data duplikatnya — aman digunakan berkali-kali.

### 6.3 Master Rute
- Menyimpan daftar rute kunjungan sales di dalam suatu wilayah.
- Kolom: ID, Nama Rute, Wilayah, jumlah Toko, Keterangan.
- Filter berdasarkan nama rute atau wilayah.
- Terurut otomatis: per Wilayah (abjad) dulu, lalu Nama Rute (urutan alami — "Rute 2" tampil sebelum "Rute 10").
- **Validasi anti-duplikat**: nama rute yang sama di dalam wilayah yang sama tidak bisa disimpan dua kali (nama rute yang sama masih boleh dipakai di wilayah yang berbeda).

### 6.4 Master Toko
- Menyimpan seluruh toko tempat produk dititipkan.
- Setiap toko punya: Nama, Rute (+ Wilayah otomatis mengikuti), Status, Produk yang dijual, Catatan.
- **Status toko** ada 3:
  - **Aktif** — toko normal, muncul di dropdown Kontrol Bulanan.
  - **Baru** — toko baru/masa percobaan; otomatis berubah jadi **Aktif** setelah 30 hari sejak Tanggal Masuk.
  - **Non-Aktif** — toko ditarik/berhenti; tidak muncul lagi di dropdown Kontrol bulan berikutnya.
- **Validasi anti-duplikat**: nama toko yang sama di dalam rute yang sama tidak bisa disimpan dua kali (nama toko yang sama masih boleh dipakai di rute lain).
- **Import Toko dari Excel**: unduh template, isi data massal, lalu unggah kembali.
  - Jika ada baris dengan nama toko yang sama di rute yang sama (duplikat), sistem **tidak langsung melewatkannya** — akan muncul dialog konfirmasi berisi daftar toko yang terdeteksi duplikat, dan Anda memilih: **Batalkan Impor**, **Tetap Tambahkan Semua**, atau **Lewati Duplikat** (disarankan).
- **Panel "Daftar Stok Produk per Toko"** (bisa ditampilkan/disembunyikan): tabel stok tiap toko per produk, bisa difilter per wilayah/rute/produk, dan diupdate manual lewat tombol **Update** (untuk koreksi stok, stok opname, atau setup awal).

### 6.5 Master Produk
- Menyimpan daftar produk yang dijual (kode, nama, tipe bebas, harga dasar, bonus per kunjungan, status aktif).
- Kode produk unik (1–4 huruf, misal `R`, `B`, `P`, `LP`) dan dipakai sebagai identitas kolom di Kontrol Bulanan.
- Produk yang di-nonaktifkan tidak akan muncul lagi di form Kontrol Bulanan maupun form Toko, tapi data historisnya tetap tersimpan.

### 6.6 Kontrol Bulanan
Ini adalah **jantung operasional harian** aplikasi — tempat sales mencatat hasil kunjungan ke setiap toko.

**Menambah entri kontrol:**
1. Klik **Tambah Kontrol**, pilih Wilayah → Rute → Toko (cascade, hanya menampilkan toko berstatus Aktif/Baru).
2. Isi Tanggal kunjungan.
3. Isi **Stok Awal**, **Terjual**, dan **Bonus** untuk tiap produk yang dijual toko tersebut.
4. Jika tidak ada produk terjual, wajib pilih **Status Kunjungan**: Toko Tutup, Tidak Terjual, Bermasalah, atau Isi Manual (dengan catatan bebas).
5. Simpan — stok toko di Master Toko otomatis diperbarui (**Stok Akhir = Stok Awal − Terjual + Bonus**).

**Dua mode tampilan:**
- **Tabel** — daftar semua entri kontrol yang sudah tercatat, bisa difilter per wilayah/rute/bulan/kata kunci.
- **Bulanan (per Rute)** — menampilkan **semua toko** di rute terpilih (bukan hanya yang sudah dikontrol), sehingga terlihat jelas toko mana yang **belum dikontrol** bulan ini. Ada toggle **"Hanya Belum Dikontrol (tanggal terpilih)"** untuk fokus ke toko yang belum dikunjungi hari itu.

**Fitur tambahan di tab ini:**
- **Tambah Toko Cepat** — menambahkan toko baru langsung dari tab Kontrol tanpa pindah ke Master Toko (rute otomatis mengikuti filter aktif).
- **Tarik / Non-Aktifkan Toko** — mengubah status toko jadi Non-Aktif langsung dari sini, sekaligus mencatat sisa stok yang dikembalikan.
- **Edit Status Toko** — mengubah status Aktif/Baru/Non-Aktif toko tanpa mengubah stok (berbeda dari "Tarik Toko" yang mempengaruhi stok).
- **Penyesuaian Stok** (Tambah/Kurang/Tarik Sebagian) — mencatat perubahan stok di luar siklus kontrol rutin (misal: retur, kejadian lapangan, titip produk baru). Jika jenis "Tambah" mengandung produk yang belum terdaftar di toko tersebut, produk itu otomatis didaftarkan ke profil toko.
- **Penjualan Luar Rute** — mencatat penjualan yang terjadi di luar kunjungan rute normal (misalnya penjualan perorangan) tanpa harus mengaitkannya ke toko/rute tertentu, supaya tetap tercatat dalam laporan.
- **Import Kontrol dari Excel** — unduh template, isi data massal kunjungan, unggah kembali; stok toko yang terdampak otomatis disinkronkan ulang.
- **Ekspor** — tabel kontrol lengkap dengan ringkasan Total Entri, Total Revenue, Total Bonus, dan Revenue Rata-rata di bagian bawah file ekspor.
- Data kontrol dipartisi **per tahun** — secara default hanya tahun berjalan & tahun sebelumnya yang otomatis dimuat, untuk menghemat kuota Firebase gratis (lihat [§11](#11-mode-offline--sinkronisasi-otomatis) dan [§12](#12-arsip-data-lama-firebase-storage)).
- Sales dengan **Wilayah Tugas** hanya bisa melihat & menambah kontrol untuk toko-toko di wilayahnya sendiri.

### 6.7 Rekap
Laporan agregat dalam 4 mode periode:
- **Harian** — per rute, untuk satu tanggal tertentu.
- **Bulanan** — per wilayah (atau per rute jika satu wilayah dipilih).
- **Kuartal** — per 3 bulan (Q1–Q4) dalam satu tahun.
- **Tahunan** — total satu tahun penuh.

Setiap mode menampilkan: jumlah toko dikunjungi, total stok/terjual/bonus per produk, total revenue, dan bisa diekspor. Sales dengan Wilayah Tugas otomatis terkunci hanya melihat rekap wilayahnya.

### 6.8 Bagi Hasil
*(Khusus Admin & Manajer)*

Menghitung simulasi pembagian keuntungan ke beberapa pihak berdasarkan data Kontrol Bulanan pada periode tertentu (Bulanan/Tahunan/Kustom).

- **Pengaturan biaya**: margin laba (%), biaya operasional, biaya bonus, biaya logistik, biaya lainnya — semuanya bisa disesuaikan.
- **Daftar Pihak** (default: Pemilik Utama 60%, Investor A 20%, Manajer Ops 10%, Karyawan Pool 10%) — masing-masing bisa diatur:
  - **Basis perhitungan**: dari **Laba Bersih** atau dari **Pendapatan (Revenue)**.
  - **Persentase (%)** bagian masing-masing pihak.
  - Warna & keterangan untuk identifikasi.
- Pihak bisa ditambah, diedit, atau dihapus sesuai struktur bisnis Anda.
- Hasil kalkulasi otomatis: Pendapatan → dikurangi Total Biaya → Laba Kotor → Laba Bersih (setelah margin) → dibagi ke tiap pihak sesuai basis & persentasenya.

### 6.9 Pengguna
*(Khusus Admin)*

- Daftar seluruh akun yang pernah login, lengkap dengan status **🟢 Online** real-time jika sedang aktif memakai aplikasi.
- Admin bisa mengubah **Role** dan **Wilayah Tugas** tiap pengguna, atau menghapus akun.
- **Pengaman built-in:**
  - Tidak bisa menghapus atau menurunkan role **Admin terakhir** — harus ada Admin lain dulu.
  - Email tidak boleh dobel untuk dua pengguna berbeda.
  - Akun **Super Admin** (👑) terkunci total — tidak bisa diubah/dihapus lewat tab ini oleh siapa pun.
- **Email Diblokir** — daftar email yang pernah dihapus Admin (sehingga tidak otomatis mendaftar ulang saat login lagi). Bisa **dipulihkan** kapan saja agar bisa login normal lagi (akan masuk sebagai Viewer).

---

## 7. Import & Ekspor Data

### Ekspor (tersedia di hampir semua tab)
Klik tombol **📤 Ekspor**, pilih format:
- 📊 **CSV**
- 🟢 **Excel (.xlsx)**
- 🌐 **HTML**
- 📋 **JSON**
- 📄 **PDF** (orientasi landscape)
- 🖼️ **JPG**

### Import (tersedia di Master Toko & Kontrol Bulanan)
1. Klik **📥 Import Toko** / **📥 Import Kontrol** → **⬇️ Download Template Excel** untuk mendapatkan format kolom yang benar.
2. Isi data pada template Excel tersebut.
3. Klik **⬆️ Upload File Excel** dan pilih file yang sudah diisi.
4. Sistem akan memvalidasi setiap baris (kolom wajib, rute/toko harus sudah terdaftar, format tanggal, dll) dan menampilkan ringkasan **berhasil / dilewati** beserta daftar error per baris.
5. Khusus **Import Toko**: jika ditemukan toko duplikat (nama sama dalam rute yang sama), proses berhenti sejenak dan meminta konfirmasi Anda sebelum melanjutkan (lihat bagian [Pencegahan Data Duplikat](#9-pencegahan-data-duplikat)).

---

## 8. Backup, Restore & Reset Database

*(Menu tersedia lewat ikon ☰ di header, khusus Admin)*

- **Backup Otomatis Harian** — sistem otomatis membuat backup sekali sehari per perangkat setiap kali ada aktivitas, disimpan di Firebase & localStorage (maksimal 30 backup tersimpan, backup lebih lama otomatis dibersihkan).
- **💾⚡ Backup Cepat** — membuat backup sekarang juga dan langsung mengunduhnya sebagai file `.json`.
- **💾 Backup & Restore** — melihat riwayat semua backup (tanggal & alasan), dan memilih satu snapshot untuk **dipulihkan** (menimpa seluruh data saat ini dengan data dari backup tersebut).
- **⚠️ Reset Database** — menghapus **seluruh data** secara permanen. Dilindungi 2 langkah:
  1. **Langkah 1**: wajib isi alasan reset (minimal 10 karakter) untuk dicatat di log.
  2. **Langkah 2**: wajib mengetik persis **"HAPUS PERMANEN"** untuk mengonfirmasi.
  - Sistem otomatis membuat backup **sebelum** menjalankan reset, sehingga data masih bisa dipulihkan lewat menu Backup & Restore jika reset tidak disengaja.

---

## 9. Pencegahan Data Duplikat

Aplikasi ini memiliki beberapa lapis pencegahan agar data tidak tercatat dua kali:

| Data | Aturan Duplikat |
|---|---|
| Wilayah | Nama wilayah harus unik (case-insensitive, abaikan spasi berlebih) |
| Rute | Nama rute harus unik **di dalam wilayah yang sama** |
| Toko | Nama toko harus unik **di dalam rute yang sama** |
| Pengguna | Email harus unik untuk semua pengguna |
| Import Toko | Sistem mendeteksi calon duplikat dan **meminta konfirmasi** sebelum menyimpan, bukan langsung melewatkan otomatis |

Jika Anda menemukan data duplikat yang **sudah terlanjur tersimpan** (misalnya dari sebelum validasi ini aktif, atau dari sinkronisasi ganda antar perangkat), buka tab **Master Wilayah** — sistem akan menandainya dengan badge ⚠️ **Duplikat** dan menyediakan tombol untuk menggabungkannya secara otomatis.

---

## 10. Mode Lokal vs Mode Cloud (Firebase)

| | Mode Lokal | Mode Cloud (Firebase) |
|---|---|---|
| Login | Tidak perlu | Wajib login Google |
| Penyimpanan | `localStorage` + IndexedDB browser | Firebase Realtime Database + cache lokal |
| Akses multi-perangkat | ❌ Tidak bisa | ✅ Bisa, real-time |
| Multi-pengguna | ❌ Tidak bisa | ✅ Bisa, dengan role masing-masing |
| Backup cloud | ❌ Tidak ada | ✅ Otomatis harian + manual |
| Status "Pengguna Aktif" | ❌ Tidak ada | ✅ Ada (indikator online real-time) |

Jika `FIREBASE_CONFIG` belum diisi di kode, aplikasi otomatis berjalan di **Mode Lokal** dan menampilkan banner peringatan kuning di bagian atas halaman.

---

## 11. Mode Offline & Sinkronisasi Otomatis

Aplikasi ini dirancang untuk tetap bisa dipakai penuh oleh sales di lapangan **walau sinyal lemah atau hilang total**, dengan 2 lapis mekanisme:

### A. Cache lokal berkapasitas besar (IndexedDB)
- Seluruh database disalin ke **IndexedDB** (bukan cuma `localStorage` yang dibatasi ~5–10MB), sehingga data tetap termuat utuh walau app dibuka dalam kondisi offline total.
- Saat app dibuka, data langsung tampil dari cache lokal ini terlebih dulu, baru disinkronkan dengan cloud kalau ada koneksi.

### B. Antrean tulis offline yang persisten (Write Queue)
- Setiap kali data ditambah/diedit/dihapus (Kontrol, Toko, Stok, dll), perubahan **langsung dicatat ke antrean lokal (IndexedDB) dulu**, baru dicoba dikirim ke Firebase.
- Kalau gagal terkirim (offline), perubahan **tetap aman tersimpan** di antrean — tidak hilang walau HP mati/aplikasi ditutup sebelum sempat online lagi.
- Antrean otomatis dikirim ulang lewat 3 pemicu:
  1. Event `online` dari browser (begitu sinyal kembali).
  2. Percobaan otomatis setiap 30 detik (jaring pengaman untuk sinyal seluler yang naik-turun).
  3. Saat aplikasi dibuka/login kembali (menyapu sisa antrean dari sesi sebelumnya).
- Edit berkali-kali ke record yang sama saat offline **tidak menumpuk** — hanya versi terakhir yang disimpan & dikirim.
- Indikator status selalu terlihat di header:
  - `📴 Offline · N menunggu` — sedang offline, ada N perubahan tersimpan lokal.
  - `🔄 Mengirim N perubahan...` — baru online lagi, sedang mengirim antrean.
  - `☁️ Sinkron HH:MM` — semua data sudah tersinkron ke cloud.

> Ini membuat sales bisa input data kunjungan toko di daerah tanpa sinyal, lanjut ke toko berikutnya, dan begitu HP dapat sinyal lagi (walau sebentar), data otomatis terkirim tanpa perlu aksi manual apa pun.

---

## 12. Arsip Data Lama (Google Drive)

Karena tabel **Kontrol Bulanan** terus bertambah tiap bulan, ada mekanisme arsip untuk menjaga kuota gratis Firebase Realtime Database (1GB) tidak cepat penuh dalam pemakaian bertahun-tahun. Arsip disimpan ke **Google Drive** (bukan Firebase Storage) — Google kini mewajibkan paket berbayar (Blaze) hanya untuk *mengaktifkan* Firebase Storage, sedangkan Google Drive API tidak punya syarat itu dan tetap 100% gratis (15GB).

**Cara kerja** *(menu Admin → "🗄️ Arsipkan Tahun Lama ke Google Drive")*:
1. Admin pilih tahun yang mau diarsipkan (disarankan tahun yang laporannya sudah selesai / jarang dibuka lagi).
2. Data tahun tersebut diambil dari Realtime Database, digabung jadi **satu file JSON**, lalu diunggah ke **Google Drive** milik admin yang login (butuh izin akses Drive sekali lewat popup, token di-cache ~55 menit).
3. Setelah upload **berhasil dan file ID-nya didapat**, barulah data tahun itu dihapus dari Realtime Database — kalau upload gagal di tengah jalan, data asli **tidak disentuh sama sekali** (aman dicoba ulang).
4. Tahun yang sudah diarsipkan muncul di daftar **"📦 Data Kontrol yang Sudah Diarsipkan"** dengan 3 aksi:
   - **👁️ Lihat** — unduh & tampilkan datanya langsung di app (tanpa ditulis balik ke database aktif).
   - **⬇️ Export Excel** — unduh sebagai file `.xlsx` lengkap.
   - **🗑️ Hapus** — hapus permanen dari Google Drive (perlu konfirmasi ketik "HAPUS", terpisah dari aksi arsip supaya tidak terhapus tidak sengaja).

Data yang diarsipkan **tidak pernah hilang** — hanya dipindah tempat penyimpanan, dan tetap bisa dilihat/diekspor kapan pun dibutuhkan untuk laporan atau audit tahun-tahun sebelumnya.

> ⚠️ **Syarat teknis**: fitur ini memakai Google Drive REST API langsung dari browser, jadi **"Google Drive API"** harus diaktifkan di Google Cloud Console untuk project Firebase Anda, dan scope `https://www.googleapis.com/auth/drive.file` harus tersedia di layar izin OAuth (OAuth consent screen). Tanpa ini, permintaan token akan gagal dengan error 403/insufficientScope. Ini adalah syarat yang sama dengan fitur "Upload ke Google Drive" pada menu Backup, yang memakai mekanisme login/token yang sama.

---

## 13. Instalasi & Menjalankan Secara Lokal

### Prasyarat
- **Node.js** versi 18 ke atas ([nodejs.org](https://nodejs.org))
- **npm** (terpasang otomatis bersama Node.js)
- Akun Firebase (opsional, hanya jika ingin mode cloud)

### Langkah-langkah
```bash
# 1. Clone atau download repo ini, lalu masuk ke foldernya
cd Proyek-gwg-main

# 2. Install semua dependency
npm install

# 3. Jalankan development server
npm run dev
```
Aplikasi akan terbuka otomatis di `http://localhost:5173` (atau port lain jika 5173 terpakai). Perubahan kode langsung ter-reload otomatis (hot reload).

> 💡 Kalau `FIREBASE_CONFIG` di `src/GWG_SuperApp.jsx` belum diisi, aplikasi tetap bisa dijalankan & dicoba dalam **Mode Lokal** tanpa perlu setup Firebase dulu.

---

## 14. Build Production & Deploy

### A. Build untuk production
```bash
npm run build
```
Perintah ini menghasilkan folder **`dist/`** berisi file statis (HTML/CSS/JS) yang sudah dioptimasi, termasuk `manifest.webmanifest` dan `sw.js` (service worker) yang di-generate otomatis oleh `vite-plugin-pwa`.

Untuk melihat hasil build secara lokal sebelum deploy:
```bash
npm run preview
```

### B. Deploy ke Netlify (direkomendasikan, sudah dikonfigurasi)
Project ini sudah menyertakan `netlify.toml` dengan konfigurasi build otomatis:
```toml
[build]
  command = "npm run build"
  publish = "dist"
```

**Opsi 1 — Auto-deploy via GitHub (disarankan):**
1. Push project ini ke repository GitHub.
2. Di [Netlify](https://app.netlify.com), klik **Add new site → Import an existing project**, hubungkan ke repo GitHub tersebut.
3. Netlify otomatis mendeteksi `netlify.toml` dan akan menjalankan `npm run build` setiap kali ada `git push` ke branch utama.

**Opsi 2 — Deploy manual:**
1. Jalankan `npm run build` di komputer sendiri.
2. Buka Netlify → drag & drop folder **`dist/`** (bukan folder project mentah) ke area deploy.

> ⚠️ Jangan drag folder source (`src/`, `public/`, dll) langsung ke Netlify — itu harus melalui proses build (`npm run build`) dulu agar service worker & manifest PWA-nya ter-generate.

### C. Deploy ke Vercel (alternatif)
Project ini juga menyertakan `vercel.json` sehingga bisa langsung di-import ke [Vercel](https://vercel.com) dengan cara yang sama (hubungkan repo GitHub, build command `npm run build`, output directory `dist`).

---

## 15. Install sebagai Aplikasi (PWA) & Membuat APK Android

### A. Install langsung dari browser (tanpa APK)
Karena project ini sudah dikonfigurasi sebagai **PWA** lengkap (manifest + service worker + ikon), begitu sudah di-deploy:
- **Android (Chrome)** — buka situsnya, ketuk menu titik tiga → **"Install app"** / **"Add to Home screen"**.
- **Desktop (Chrome/Edge)** — ikon install akan muncul di address bar.
- **iOS (Safari)** — tombol Share → **"Add to Home Screen"**.

Setelah diinstall, aplikasi berjalan fullscreen tanpa address bar, punya ikon sendiri, dan tetap bisa dibuka offline (berkat service worker + cache yang sudah dijelaskan di [§11](#11-mode-offline--sinkronisasi-otomatis)).

### B. Membuat file .apk (untuk dibagikan/upload ke Play Store)
Gunakan **[PWABuilder](https://www.pwabuilder.com)** (gratis, dari Microsoft):
1. Masukkan URL situs yang sudah di-deploy, klik **Start**.
2. Klik **Package for stores** → pilih **Android**.
3. Isi Package ID (mis. `com.gwg.superapp`), App name, dan pilih **"Generate new signing key"** — **simpan file `.keystore`-nya baik-baik**, dibutuhkan untuk update APK di kemudian hari.
4. Klik **Generate** → **Download**. Hasilnya berisi:
   - `app-release-signed.apk` → langsung diinstall di HP Android.
   - `app-release-bundle.aab` → untuk upload ke Google Play Store.

---

## 16. Struktur Proyek

```
Proyek-gwg-main/
├── index.html                  # Entry point HTML
├── package.json                 # Dependency & script (dev/build/preview)
├── vite.config.js               # Konfigurasi Vite + vite-plugin-pwa (manifest, service worker)
├── netlify.toml                 # Konfigurasi build & redirect untuk Netlify
├── vercel.json                  # Konfigurasi alternatif untuk Vercel
├── src/
│   ├── main.jsx                 # Bootstrap React + registrasi service worker (registerSW)
│   └── GWG_SuperApp.jsx         # Seluruh logika & UI aplikasi (single-file component)
└── public/
    ├── logo.png                 # Logo aplikasi
    ├── icons/                   # Ikon PWA (192px, 512px, apple-touch-icon)
    └── restore-tool-proyek-gwg.html  # Alat pemulihan darurat manual (di luar app utama)
```

> Aplikasi ini sengaja disusun sebagai **single large component** (`GWG_SuperApp.jsx`) alih-alih dipecah ke banyak file kecil, supaya seluruh logika bisnis (validasi, kalkulasi stok, role, dll) mudah ditelusuri dalam satu tempat tanpa harus lompat-lompat antar file saat debugging.

---

## 17. Tips & Troubleshooting

- **Dropdown Toko kosong saat isi Kontrol?** Pastikan toko berstatus **Aktif** atau **Baru** (toko Non-Aktif sengaja disembunyikan dari dropdown kontrol).
- **Stok toko terasa tidak sesuai?** Stok dihitung otomatis dari entri Kontrol **terakhir** + Penyesuaian Stok sesudahnya. Gunakan menu **Update Stok** di panel "Daftar Stok Produk per Toko" untuk koreksi manual (stok opname).
- **Sales tidak bisa lihat wilayah lain?** Itu memang disengaja — atur "Wilayah Tugas" di tab Pengguna jika ingin membuka akses ke wilayah lain, atau kosongkan untuk memberi akses semua wilayah.
- **Toko baru tidak kunjung jadi "Aktif"?** Status "Baru" otomatis berubah "Aktif" setelah **30 hari** sejak Tanggal Masuk — proses ini berjalan otomatis sekali saat aplikasi dimuat.
- **Muncul nama wilayah/rute/toko dobel di filter?** Lihat [Pencegahan Data Duplikat](#9-pencegahan-data-duplikat) — gunakan tombol "Gabungkan Duplikat" di tab Master Wilayah.
- **Tidak sengaja reset/hapus data penting?** Buka menu ☰ → **Backup & Restore**, pilih snapshot sebelum kejadian, klik Restore.
- **Butuh menaikkan role sendiri tapi tidak ada Admin lagi?** Sistem punya jalur darurat otomatis — login saja, Anda akan sementara diberi akses Admin untuk memperbaikinya.
- **Header menunjukkan "📴 Offline" terus padahal sinyal ada?** Cek indikator "N menunggu" — kalau angkanya tidak turun setelah beberapa menit, coba muat ulang halaman; antrean akan otomatis disapu ulang saat app dibuka.
- **PWABuilder menampilkan skor Service Worker rendah padahal sudah di-install di Chrome?** Itu biasanya cache/delay dari crawler PWABuilder, bukan masalah nyata — patokan paling akurat adalah apakah Chrome sungguhan menawarkan "Install app".
- **Deploy Netlify sukses tapi PWA tidak terdeteksi?** Cek **Deploy file browser** di dashboard Netlify — pastikan ada file `manifest.webmanifest` dan `sw.js`. Kalau tidak ada, berarti build tidak dijalankan lewat `npm run build` (misalnya karena drag-drop folder source mentah, bukan hasil `dist/`).

---

## 18. Catatan Keamanan

- Semua fungsi tulis data (`addRecord`, `updateRecord`, `deleteRecord`, `save`, `resetDB`) diblokir secara terpusat untuk role **Viewer** — bukan hanya disembunyikan di tampilan, sehingga tidak bisa "ditembus" lewat tab mana pun.
- Akun **Super Admin** dikunci permanen di kode (`SUPER_ADMIN_EMAIL`) dan tidak bisa direbut, diubah, atau dihapus lewat antarmuka aplikasi oleh siapa pun.
- Sistem tidak akan pernah membiarkan jumlah Admin turun ke nol lewat tab Pengguna (baik lewat hapus maupun ubah role), untuk mencegah aplikasi terkunci total dari akses admin.
- Email yang dihapus Admin masuk daftar blokir sehingga tidak otomatis mendaftar ulang — mencegah akun bekas karyawan/mitra login kembali tanpa sepengetahuan Admin.
- Proses arsip ke Google Drive selalu **upload dulu → dapat file ID sukses → baru hapus dari database aktif**, sehingga tidak ada risiko kehilangan data walau koneksi terputus di tengah proses.
- Perubahan data offline disimpan di antrean lokal (IndexedDB) yang **tidak menumpuk versi lama** — hanya versi terakhir per data yang dikirim, mencegah data usang menimpa data terbaru saat kembali online.

---

*Dokumen ini dibuat berdasarkan struktur & logika kode `src/GWG_SuperApp.jsx`. Jika ada fitur baru yang ditambahkan ke aplikasi, perbarui juga bagian terkait di README ini.*
