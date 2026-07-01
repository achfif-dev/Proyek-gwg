# 🌿 Generasi Wangi Group — Super App

**Sistem Manajemen Konsinyasi** untuk mengelola wilayah, rute, toko, produk, kontrol kunjungan bulanan, stok, laporan, dan bagi hasil — dalam satu aplikasi web yang bisa diakses dari HP maupun komputer.

---

## Daftar Isi

1. [Ringkasan Aplikasi](#1-ringkasan-aplikasi)
2. [Cara Kerja & Alur Data](#2-cara-kerja--alur-data)
3. [Login & Peran Pengguna (Role)](#3-login--peran-pengguna-role)
4. [Setup Awal Aplikasi](#4-setup-awal-aplikasi)
5. [Panduan Tiap Menu (Tab)](#5-panduan-tiap-menu-tab)
   - [5.1 Dashboard](#51-dashboard)
   - [5.2 Master Wilayah](#52-master-wilayah)
   - [5.3 Master Rute](#53-master-rute)
   - [5.4 Master Toko](#54-master-toko)
   - [5.5 Master Produk](#55-master-produk)
   - [5.6 Kontrol Bulanan](#56-kontrol-bulanan)
   - [5.7 Rekap](#57-rekap)
   - [5.8 Bagi Hasil](#58-bagi-hasil)
   - [5.9 Pengguna](#59-pengguna)
6. [Import & Ekspor Data](#6-import--ekspor-data)
7. [Backup, Restore & Reset Database](#7-backup-restore--reset-database)
8. [Pencegahan Data Duplikat](#8-pencegahan-data-duplikat)
9. [Mode Lokal vs Mode Cloud (Firebase)](#9-mode-lokal-vs-mode-cloud-firebase)
10. [Tips & Troubleshooting](#10-tips--troubleshooting)
11. [Catatan Keamanan](#11-catatan-keamanan)

---

## 1. Ringkasan Aplikasi

GWG Super App adalah aplikasi satu-file (single React component) yang menangani seluruh proses bisnis konsinyasi produk ke toko-toko, mulai dari:

- Pendataan **wilayah**, **rute**, dan **toko** tempat produk dititipkan.
- Pendataan **produk** dan harga.
- Pencatatan **kontrol bulanan** (kunjungan rutin sales ke toko: stok awal, terjual, bonus).
- Pelacakan **stok** otomatis per toko per produk.
- **Rekap** penjualan harian/bulanan/kuartal/tahunan.
- Simulasi **bagi hasil** ke beberapa pihak (pemilik, investor, manajer, dll).
- **Manajemen pengguna** dengan 4 level akses (Admin, Manajer, Sales, Viewer).
- **Backup otomatis**, restore, dan reset database dengan pengaman berlapis.
- **Impor/Ekspor** data lewat Excel, CSV, PDF, HTML, JPG, JSON.

Aplikasi bisa berjalan dalam dua mode:
- **Mode Cloud** — data tersinkron real-time lewat Firebase, bisa diakses banyak pengguna & perangkat sekaligus.
- **Mode Lokal** — jika Firebase belum dikonfigurasi, data tetap tersimpan di `localStorage` browser (satu perangkat saja).

---

## 2. Cara Kerja & Alur Data

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

## 3. Login & Peran Pengguna (Role)

### Cara Login
- Login menggunakan **akun Google** (tombol "Masuk dengan Google").
- Akun pertama yang login (saat tabel Pengguna masih kosong) otomatis menjadi **Admin**.
- Akun Google berikutnya yang login otomatis terdaftar sebagai **Viewer** (hanya bisa melihat), kecuali Admin menaikkan role-nya di tab **Pengguna**.

### 4 Level Role

| Role | Akses Tab | Bisa Ubah Data? | Catatan |
|---|---|---|---|
| **Admin** | Semua tab (termasuk Pengguna) | ✅ Ya, semua | Bisa reset database, backup/restore, kelola pengguna |
| **Manajer** | Semua tab kecuali Pengguna | ✅ Ya, semua kecuali data pengguna | Bisa akses Bagi Hasil |
| **Sales** | Hanya Dashboard, Kontrol, Rekap | ✅ Ya, khusus Kontrol Bulanan | Bisa dibatasi hanya melihat 1 wilayah tugas |
| **Viewer** | Hanya Dashboard, Kontrol, Rekap | ❌ Tidak bisa ubah apa pun | Role default untuk akun baru, paling aman |

- Sales bisa diberi **"Wilayah Tugas"** tertentu (diatur Admin di tab Pengguna) sehingga Dashboard, Kontrol, dan Rekap-nya otomatis terkunci hanya menampilkan data wilayah tersebut.
- Sistem memiliki **Super Admin** (email tetap dikonfigurasi di kode) yang perannya selalu Admin dan **tidak bisa diubah/dihapus** siapa pun lewat tab Pengguna — ini pengaman utama supaya aplikasi tidak pernah kehilangan akses admin sepenuhnya.
- Ada juga **jalur darurat anti-deadlock**: jika suatu saat tabel Pengguna kosong dari role Admin, siapa pun yang login otomatis diberi akses Admin sementara agar bisa memperbaiki data pengguna.

---

## 4. Setup Awal Aplikasi

### A. Konfigurasi Firebase (opsional, untuk mode cloud/multi-perangkat)
1. Buka [Firebase Console](https://console.firebase.google.com).
2. Buat proyek baru → aktifkan **Realtime Database** dan **Authentication (Google)**.
3. Ambil konfigurasi SDK Web (Project Settings → SDK Config).
4. Buka file `GWG_SuperApp.jsx`, isi variabel `FIREBASE_CONFIG` di bagian atas file dengan konfigurasi tersebut.
5. Jika belum dikonfigurasi, aplikasi tetap berjalan dalam **Mode Lokal** (data tersimpan di browser saja, tanpa login).

### B. Login Pertama Kali
1. Buka aplikasi, klik **"Masuk dengan Google"**.
2. Akun pertama yang login otomatis menjadi **Admin**.
3. Mulai isi data secara berurutan: **Wilayah → Rute → Toko → Produk**.

### C. Menambahkan Pengguna Lain
1. Minta rekan kerja login sekali dengan akun Google mereka (otomatis masuk sebagai Viewer).
2. Admin membuka tab **Pengguna**, cari akun tersebut, klik **Edit**, lalu ubah **Role** (Admin/Manajer/Sales/Viewer) dan **Wilayah Tugas** (khusus Sales) sesuai kebutuhan.

---

## 5. Panduan Tiap Menu (Tab)

Semua tab (kecuali Dashboard) memiliki pola yang sama:
**Tambah** → isi form modal → **Simpan**. **Edit** → klik ikon pensil di baris tabel. **Hapus** → klik ikon hapus (perlu konfirmasi), atau pilih beberapa baris sekaligus dengan checkbox lalu **Hapus Terpilih**. Setiap tabel bisa **dicari/difilter** dan **diekspor**.

### 5.1 Dashboard
Ringkasan kondisi bisnis secara real-time:
- Kartu statistik: Toko Aktif, Total Wilayah, Total Pendapatan, Laba Bersih Estimasi (70% margin), Total Produk, Entri Kontrol, Total Bonus, Pengguna.
- Grafik batang **Revenue per Wilayah** dan **Performa Produk** (jumlah terjual per produk).
- Tabel **Rute Aktif** (jumlah toko & revenue per rute).
- Ringkasan **Simulasi Bagi Hasil** (mengikuti konfigurasi di tab Bagi Hasil).
- Tabel **8 Data Kontrol Terbaru**.
- Bisa diekspor sebagai ringkasan 3 kolom (Kategori/Metrik/Nilai).
- Untuk user **Sales** dengan wilayah tugas, Dashboard otomatis hanya menampilkan data wilayah tersebut (ditandai badge 🔒).

### 5.2 Master Wilayah
- Menyimpan daftar wilayah operasional (contoh: Bangkalan Utara, Bangkalan Selatan, Sampang, dst).
- Kolom: ID, Nama Wilayah, Deskripsi, jumlah Rute, jumlah Toko di wilayah tersebut.
- Otomatis terurut abjad.
- **Validasi anti-duplikat**: nama wilayah yang sama (tanpa membedakan huruf besar/kecil atau spasi) tidak bisa disimpan dua kali.
- **Deteksi & Gabungkan Duplikat**: jika ada wilayah lama yang terlanjur duplikat (misalnya dari sinkronisasi antar perangkat), sistem menampilkan badge ⚠️ **Duplikat** dan tombol **"Gabungkan N Duplikat"** yang otomatis memindahkan semua rute dari wilayah duplikat ke satu wilayah utama, lalu menghapus data duplikatnya — aman digunakan berkali-kali.

### 5.3 Master Rute
- Menyimpan daftar rute kunjungan sales di dalam suatu wilayah.
- Kolom: ID, Nama Rute, Wilayah, jumlah Toko, Keterangan.
- Filter berdasarkan nama rute atau wilayah.
- Terurut otomatis: per Wilayah (abjad) dulu, lalu Nama Rute (urutan alami — "Rute 2" tampil sebelum "Rute 10").
- **Validasi anti-duplikat**: nama rute yang sama di dalam wilayah yang sama tidak bisa disimpan dua kali (nama rute yang sama masih boleh dipakai di wilayah yang berbeda).

### 5.4 Master Toko
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

### 5.5 Master Produk
- Menyimpan daftar produk yang dijual (kode, nama, tipe bebas, harga dasar, bonus per kunjungan, status aktif).
- Kode produk unik (1–4 huruf, misal `R`, `B`, `P`, `LP`) dan dipakai sebagai identitas kolom di Kontrol Bulanan.
- Produk yang di-nonaktifkan tidak akan muncul lagi di form Kontrol Bulanan maupun form Toko, tapi data historisnya tetap tersimpan.

### 5.6 Kontrol Bulanan
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
- Sales dengan **Wilayah Tugas** hanya bisa melihat & menambah kontrol untuk toko-toko di wilayahnya sendiri.

### 5.7 Rekap
Laporan agregat dalam 4 mode periode:
- **Harian** — per rute, untuk satu tanggal tertentu.
- **Bulanan** — per wilayah (atau per rute jika satu wilayah dipilih).
- **Kuartal** — per 3 bulan (Q1–Q4) dalam satu tahun.
- **Tahunan** — total satu tahun penuh.

Setiap mode menampilkan: jumlah toko dikunjungi, total stok/terjual/bonus per produk, total revenue, dan bisa diekspor. Sales dengan Wilayah Tugas otomatis terkunci hanya melihat rekap wilayahnya.

### 5.8 Bagi Hasil
*(Khusus Admin & Manajer)*

Menghitung simulasi pembagian keuntungan ke beberapa pihak berdasarkan data Kontrol Bulanan pada periode tertentu (Bulanan/Tahunan/Kustom).

- **Pengaturan biaya**: margin laba (%), biaya operasional, biaya bonus, biaya logistik, biaya lainnya — semuanya bisa disesuaikan.
- **Daftar Pihak** (default: Pemilik Utama 60%, Investor A 20%, Manajer Ops 10%, Karyawan Pool 10%) — masing-masing bisa diatur:
  - **Basis perhitungan**: dari **Laba Bersih** atau dari **Pendapatan (Revenue)**.
  - **Persentase (%)** bagian masing-masing pihak.
  - Warna & keterangan untuk identifikasi.
- Pihak bisa ditambah, diedit, atau dihapus sesuai struktur bisnis Anda.
- Hasil kalkulasi otomatis: Pendapatan → dikurangi Total Biaya → Laba Kotor → Laba Bersih (setelah margin) → dibagi ke tiap pihak sesuai basis & persentasenya.

### 5.9 Pengguna
*(Khusus Admin)*

- Daftar seluruh akun yang pernah login, lengkap dengan status **🟢 Online** real-time jika sedang aktif memakai aplikasi.
- Admin bisa mengubah **Role** dan **Wilayah Tugas** tiap pengguna, atau menghapus akun.
- **Pengaman built-in:**
  - Tidak bisa menghapus atau menurunkan role **Admin terakhir** — harus ada Admin lain dulu.
  - Email tidak boleh dobel untuk dua pengguna berbeda.
  - Akun **Super Admin** (👑) terkunci total — tidak bisa diubah/dihapus lewat tab ini oleh siapa pun.
- **Email Diblokir** — daftar email yang pernah dihapus Admin (sehingga tidak otomatis mendaftar ulang saat login lagi). Bisa **dipulihkan** kapan saja agar bisa login normal lagi (akan masuk sebagai Viewer).

---

## 6. Import & Ekspor Data

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
5. Khusus **Import Toko**: jika ditemukan toko duplikat (nama sama dalam rute yang sama), proses berhenti sejenak dan meminta konfirmasi Anda sebelum melanjutkan (lihat bagian [Pencegahan Data Duplikat](#8-pencegahan-data-duplikat)).

---

## 7. Backup, Restore & Reset Database

*(Menu tersedia lewat ikon ☰ di header, khusus Admin)*

- **Backup Otomatis Harian** — sistem otomatis membuat backup sekali sehari per perangkat setiap kali ada aktivitas, disimpan di Firebase & localStorage (maksimal 30 backup tersimpan, backup lebih lama otomatis dibersihkan).
- **💾⚡ Backup Cepat** — membuat backup sekarang juga dan langsung mengunduhnya sebagai file `.json`.
- **💾 Backup & Restore** — melihat riwayat semua backup (tanggal & alasan), dan memilih satu snapshot untuk **dipulihkan** (menimpa seluruh data saat ini dengan data dari backup tersebut).
- **⚠️ Reset Database** — menghapus **seluruh data** secara permanen. Dilindungi 2 langkah:
  1. **Langkah 1**: wajib isi alasan reset (minimal 10 karakter) untuk dicatat di log.
  2. **Langkah 2**: wajib mengetik persis **"HAPUS PERMANEN"** untuk mengonfirmasi.
  - Sistem otomatis membuat backup **sebelum** menjalankan reset, sehingga data masih bisa dipulihkan lewat menu Backup & Restore jika reset tidak disengaja.

---

## 8. Pencegahan Data Duplikat

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

## 9. Mode Lokal vs Mode Cloud (Firebase)

| | Mode Lokal | Mode Cloud (Firebase) |
|---|---|---|
| Login | Tidak perlu | Wajib login Google |
| Penyimpanan | `localStorage` browser | Firebase Realtime Database + `localStorage` sebagai cache |
| Akses multi-perangkat | ❌ Tidak bisa | ✅ Bisa, real-time |
| Multi-pengguna | ❌ Tidak bisa | ✅ Bisa, dengan role masing-masing |
| Backup cloud | ❌ Tidak ada | ✅ Otomatis harian + manual |
| Status "Pengguna Aktif" | ❌ Tidak ada | ✅ Ada (indikator online real-time) |

Jika `FIREBASE_CONFIG` belum diisi di kode, aplikasi otomatis berjalan di **Mode Lokal** dan menampilkan banner peringatan kuning di bagian atas halaman.

---

## 10. Tips & Troubleshooting

- **Dropdown Toko kosong saat isi Kontrol?** Pastikan toko berstatus **Aktif** atau **Baru** (toko Non-Aktif sengaja disembunyikan dari dropdown kontrol).
- **Stok toko terasa tidak sesuai?** Stok dihitung otomatis dari entri Kontrol **terakhir** + Penyesuaian Stok sesudahnya. Gunakan menu **Update Stok** di panel "Daftar Stok Produk per Toko" untuk koreksi manual (stok opname).
- **Sales tidak bisa lihat wilayah lain?** Itu memang disengaja — atur "Wilayah Tugas" di tab Pengguna jika ingin membuka akses ke wilayah lain, atau kosongkan untuk memberi akses semua wilayah.
- **Toko baru tidak kunjung jadi "Aktif"?** Status "Baru" otomatis berubah "Aktif" setelah **30 hari** sejak Tanggal Masuk — proses ini berjalan otomatis sekali saat aplikasi dimuat.
- **Muncul nama wilayah/rute/toko dobel di filter?** Lihat [Pencegahan Data Duplikat](#8-pencegahan-data-duplikat) — gunakan tombol "Gabungkan Duplikat" di tab Master Wilayah.
- **Tidak sengaja reset/hapus data penting?** Buka menu ☰ → **Backup & Restore**, pilih snapshot sebelum kejadian, klik Restore.
- **Butuh menaikkan role sendiri tapi tidak ada Admin lagi?** Sistem punya jalur darurat otomatis — login saja, Anda akan sementara diberi akses Admin untuk memperbaikinya.

---

## 11. Catatan Keamanan

- Semua fungsi tulis data (`addRecord`, `updateRecord`, `deleteRecord`, `save`, `resetDB`) diblokir secara terpusat untuk role **Viewer** — bukan hanya disembunyikan di tampilan, sehingga tidak bisa "ditembus" lewat tab mana pun.
- Akun **Super Admin** dikunci permanen di kode (`SUPER_ADMIN_EMAIL`) dan tidak bisa direbut, diubah, atau dihapus lewat antarmuka aplikasi oleh siapa pun.
- Sistem tidak akan pernah membiarkan jumlah Admin turun ke nol lewat tab Pengguna (baik lewat hapus maupun ubah role), untuk mencegah aplikasi terkunci total dari akses admin.
- Email yang dihapus Admin masuk daftar blokir sehingga tidak otomatis mendaftar ulang — mencegah akun bekas karyawan/mitra login kembali tanpa sepengetahuan Admin.

---

*Dokumen ini dibuat otomatis berdasarkan struktur & logika kode `GWG_SuperApp.jsx`. Jika ada fitur baru yang ditambahkan ke aplikasi, perbarui juga bagian terkait di README ini.*
