# Panduan Penggunaan GWG Super App

Panduan ini untuk **pemakaian sehari-hari** — cara setup pertama kali dan cara pakai tiap fitur, ditulis untuk Admin, pimpinan PT, dan tim lapangan, **tanpa perlu paham kode**. Kalau Anda mencari hal teknis (instalasi, deploy, struktur kode), buka `README.md`.

---

## Daftar Isi

1. [Siapa Memakai Apa](#1-siapa-memakai-apa)
2. [Setup Pertama Kali (Admin)](#2-setup-pertama-kali-admin)
3. [Mengundang Pimpinan PT & Tim Lain](#3-mengundang-pimpinan-pt--tim-lain)
4. [Alur Kerja Dasar: Wilayah → Rute → Toko → Produk](#4-alur-kerja-dasar-wilayah--rute--toko--produk)
5. [Panduan untuk Sales: Kontrol Bulanan Harian](#5-panduan-untuk-sales-kontrol-bulanan-harian)
6. [Panduan untuk Admin/Manajer: Rekap & Laporan](#6-panduan-untuk-adminmanajer-rekap--laporan)
7. [Panduan untuk Pimpinan PT: Bagi Hasil, Neraca & Pajak](#7-panduan-untuk-pimpinan-pt-bagi-hasil-neraca--pajak)
8. [Impor Data Massal & Ekspor Laporan](#8-impor-data-massal--ekspor-laporan)
9. [Backup, Restore & Kalau Terjadi Kesalahan](#9-backup-restore--kalau-terjadi-kesalahan)
10. [Pakai di Lapangan Tanpa Sinyal](#10-pakai-di-lapangan-tanpa-sinyal)
11. [Kalau Data Sudah Menumpuk Bertahun-tahun (Arsip)](#11-kalau-data-sudah-menumpuk-bertahun-tahun-arsip)
12. [Install Aplikasi di HP](#12-install-aplikasi-di-hp)
13. [Tanya Jawab Umum](#13-tanya-jawab-umum)

---

## 1. Siapa Memakai Apa

Aplikasi ini punya 4 level akses. Tentukan dulu siapa dapat peran apa:

| Peran | Cocok untuk | Bisa lihat | Bisa ubah data? |
|---|---|---|---|
| **Admin** | Anda (pemilik/pengelola sistem) | Semua menu | Semua, termasuk kelola pengguna & reset data |
| **Manajer** | Pimpinan PT, kepala operasional | Semua menu kecuali kelola Pengguna | Semua kecuali data pengguna |
| **Sales** | Tim lapangan yang kunjungi toko | Dashboard, Kontrol, Rekap (bisa dibatasi 1 wilayah) | Hanya input Kontrol Bulanan |
| **Viewer** | Siapa pun yang cuma perlu memantau | Dashboard, Kontrol, Rekap | Tidak bisa ubah apa pun — paling aman untuk dibagikan |

> Setiap akun baru yang login otomatis jadi **Viewer**. Andalah (Admin) yang menaikkan role mereka lewat menu **Pengguna**.

---

## 2. Setup Pertama Kali (Admin)

Kalau ini pertama kali aplikasi dipakai (database masih kosong):

1. Buka aplikasi, klik **"Masuk dengan Google"**, login pakai akun Google Anda.
2. Karena Anda yang login pertama, Anda **otomatis jadi Admin**.
3. Kalau muncul layar **🚀 Setup Aplikasi (White Label)** — berarti ini instance baru yang belum ada identitas/Firebase-nya. Isi 4 langkahnya:
   - **Branding**: nama perusahaan, nama aplikasi, warna, logo (opsional).
   - **Firebase**: tempel kode konfigurasi dari project Firebase Anda (lihat `README.md` §5.B kalau belum punya project Firebase).
   - **Super Admin**: email Google Anda — ini akun yang selamanya jadi Admin, tidak bisa "direbut" siapa pun.
   - **Ringkasan** → klik **Simpan & Muat Ulang**.
4. Kalau layar ini **tidak muncul** (langsung masuk ke Dashboard kosong) — berarti Firebase sudah dikonfigurasi sebelumnya (misalnya oleh developer), lanjut saja ke langkah berikutnya.
5. Mulai isi data dari menu **Master Wilayah**, lalu **Master Rute**, **Master Toko**, dan **Master Produk** — urutannya wajib seperti ini (lihat [§4](#4-alur-kerja-dasar-wilayah--rute--toko--produk)).

---

## 3. Mengundang Pimpinan PT & Tim Lain

1. Minta mereka buka link aplikasi, lalu **login sekali** pakai akun Google masing-masing. Setelah login, mereka otomatis masuk sebagai **Viewer** (belum bisa apa-apa selain lihat).
2. Anda (Admin) buka menu **Pengguna**, cari nama/email mereka di daftar, klik **Edit**.
3. Ubah **Role** sesuai kebutuhan:
   - Pimpinan PT yang perlu lihat laporan keuangan & bagi hasil → **Manajer**.
   - Tim sales lapangan → **Sales**, dan atur **Wilayah Tugas** supaya mereka cuma lihat data wilayah mereka sendiri (mencegah data wilayah lain "bocor" ke sales yang tidak berkepentingan).
   - Orang yang cuma perlu memantau tanpa risiko salah input → biarkan **Viewer**.
4. Simpan. Perubahan role langsung berlaku begitu mereka refresh aplikasi.

> Kalau ada karyawan/mitra keluar, hapus akunnya di menu Pengguna — emailnya otomatis masuk daftar blokir sehingga tidak bisa mendaftar ulang sendiri tanpa sepengetahuan Anda.

---

## 4. Alur Kerja Dasar: Wilayah → Rute → Toko → Produk

Ini fondasi seluruh data di aplikasi — **wajib diisi berurutan**, karena tiap tingkat "menempel" ke tingkat di atasnya:

```
📍 Wilayah  (contoh: "Sampang", "Bangkalan Utara")
     ↓
🛣️ Rute     (contoh: "Rute 1", "Rute Pasar Kota" — di dalam satu Wilayah)
     ↓
🏪 Toko     (toko/outlet tempat produk dititip — di dalam satu Rute)

🧴 Produk (terpisah, tidak ikut hierarki wilayah/rute/toko)
```

**Langkah isi data pertama kali:**
1. Buka **Master Wilayah** → klik Tambah → isi nama wilayah operasional Anda (bisa lebih dari satu, sesuai area bisnis).
2. Buka **Master Rute** → klik Tambah → pilih Wilayah-nya, isi nama rute.
3. Buka **Master Toko** → klik Tambah → pilih Rute-nya (Wilayah otomatis ikut), isi nama toko, status (biasanya "Baru" untuk toko yang baru mulai konsinyasi), dan pilih produk apa saja yang dititip di toko itu.
4. Buka **Master Produk** → klik Tambah → isi kode produk singkat (1–4 huruf, misal `R` untuk "Regular"), nama, harga jual, dan bonus per kunjungan kalau ada.

Setelah keempatnya terisi, aplikasi siap dipakai untuk pencatatan kunjungan harian (Kontrol Bulanan).

---

## 5. Panduan untuk Sales: Kontrol Bulanan Harian

Ini menu yang paling sering dibuka tim lapangan — dipakai **setiap kali habis kunjungi toko**:

1. Buka menu **Kontrol Bulanan** → klik **Tambah Kontrol**.
2. Pilih Wilayah → Rute → Toko (kalau Anda Sales dengan wilayah tugas, pilihan Wilayah sudah otomatis terkunci).
3. Isi tanggal kunjungan.
4. Untuk tiap produk yang dititip di toko itu, isi:
   - **Stok Awal** — sisa stok yang masih ada di toko saat Anda datang.
   - **Terjual** — berapa pcs yang laku sejak kunjungan terakhir.
   - **Bonus** — kalau ada produk bonus/sample yang dititip.
5. Kalau toko sedang tutup atau tidak ada yang terjual, jangan dikosongkan begitu saja — pilih **Status Kunjungan** yang sesuai (Toko Tutup / Tidak Terjual / Bermasalah / Isi Manual) supaya kunjungan tetap tercatat.
6. Klik **Simpan** — stok toko otomatis ter-update.

**Fitur tambahan yang berguna di lapangan:**
- **Tambah Toko Cepat** — kalau nemu toko baru saat kunjungan, bisa langsung didaftarkan dari sini tanpa pindah menu.
- **Penyesuaian Stok** — untuk retur, kejadian di luar kunjungan rutin, atau titip produk baru ke toko yang sudah ada.
- **Penjualan Luar Rute** — kalau ada penjualan yang bukan dari toko/rute biasa (misalnya penjualan perorangan), tetap bisa dicatat di sini supaya masuk laporan.
- **Mode "Bulanan (per Rute)"** — beralih ke tampilan ini untuk lihat toko mana saja di rute Anda yang **belum** dikunjungi bulan ini, supaya tidak ada yang terlewat.

> Semua input ini **tetap tersimpan walau tidak ada sinyal** — lihat [§10](#10-pakai-di-lapangan-tanpa-sinyal).

---

## 6. Panduan untuk Admin/Manajer: Rekap & Laporan

Menu **Rekap** memberi gambaran performa dalam 4 mode periode — pilih sesuai kebutuhan laporan:

| Mode | Untuk melihat |
|---|---|
| **Harian** | Performa satu rute di satu tanggal tertentu |
| **Bulanan** | Total per wilayah (atau per rute kalau satu wilayah dipilih) dalam sebulan |
| **Kuartal** | Total 3 bulan (Q1–Q4) |
| **Tahunan** | Total satu tahun penuh — cocok untuk laporan tahunan |

Setiap mode menampilkan total stok/terjual/bonus per produk dan total revenue, dan bisa langsung **diekspor** (Excel/PDF/dll — lihat [§8](#8-impor-data-massal--ekspor-laporan)) untuk dikirim ke pihak lain.

**Dashboard** (halaman pertama saat login) memberi ringkasan cepat tanpa perlu buka Rekap: total toko aktif, pendapatan, produk terlaris, dan grafik revenue per wilayah — cocok untuk cek kondisi bisnis sekilas tiap pagi.

---

## 7. Panduan untuk Pimpinan PT: Bagi Hasil, Neraca & Pajak

Menu **Bagi Hasil** (khusus Admin & Manajer) adalah pusat laporan keuangan, dibagi 3 sub-menu:

### 7.1 Bagi Hasil & Laba Rugi
Menghitung otomatis pembagian keuntungan ke tiap pihak (Pemilik, Investor, Manajer, dll) berdasarkan data kunjungan pada periode yang dipilih.
- Atur dulu lewat tombol **Konfigurasi**: daftar pihak dan persentase bagiannya, daftar beban usaha (gaji, sewa, listrik, dll), dan metode hitung laba kotor.
- Setelah pihak menerima bagiannya, klik **Cairkan ke Kas** supaya otomatis tercatat sebagai pengeluaran di Buku Kas — tidak perlu dicatat dua kali secara manual.

### 7.2 Neraca Keuangan Lengkap
Pembukuan lengkap ala akuntansi, terdiri dari:
- **Kas Opname** — buku kas keluar-masuk, dengan fitur cocokkan saldo fisik vs sistem.
- **Stock Opname** — bandingkan stok yang tercatat sistem vs hasil hitung fisik.
- **Amortisasi Aset** — daftar aset (kendaraan, alat, dll) dengan penyusutan otomatis tiap bulan.
- **Gudang Pusat** — catat stok yang masih di gudang, belum dititip ke toko.
- **Hutang/Piutang** — catat & lunasi hutang-piutang, otomatis tersambung ke Buku Kas.
- **Laporan Neraca** — posisi keuangan lengkap (Aset = Kewajiban + Ekuitas) per periode.
- **Tutup Buku** — kunci data bulan yang sudah final supaya tidak berubah tidak sengaja (bisa dibuka lagi kalau memang perlu dikoreksi).

### 7.3 Laporan Pajak (Coretax)
Simulasi kewajiban pajak, dua skema berdampingan supaya bisa dibandingkan (UMKM Non-PKP vs PKP). **Ini alat bantu hitung saja** — pelaporan resminya tetap lewat situs Coretax DJP, dan sebaiknya dicek ulang ke konsultan pajak sebelum dipakai untuk pelaporan sungguhan.

---

## 8. Impor Data Massal & Ekspor Laporan

**Ekspor** (hampir semua tabel di aplikasi):
Klik tombol **📤 Ekspor** → pilih format: CSV, Excel, HTML, JSON, PDF, atau JPG — sesuai kebutuhan (Excel untuk diolah lagi, PDF/JPG untuk dikirim langsung ke pimpinan atau dicetak).

**Impor data massal** (tersedia di Master Toko & Kontrol Bulanan — berguna saat migrasi data lama atau input banyak toko sekaligus):
1. Klik **📥 Import** → **⬇️ Download Template Excel**.
2. Isi data di template tersebut (jangan ubah nama kolomnya).
3. Upload kembali lewat **⬆️ Upload File Excel**.
4. Sistem cek tiap baris dan kasih tahu mana yang berhasil/gagal beserta alasannya. Kalau ada toko yang kelihatannya duplikat, Anda akan diminta konfirmasi dulu sebelum data benar-benar masuk.

---

## 9. Backup, Restore & Kalau Terjadi Kesalahan

*(Menu ☰ di pojok header, khusus Admin)*

- Aplikasi **otomatis backup sekali sehari** tiap ada aktivitas — Anda tidak perlu melakukan apa-apa untuk ini.
- Kalau ingin backup manual sekarang juga: **💾⚡ Backup Cepat** → langsung terunduh sebagai file.
- **Salah input besar / perlu kembali ke kondisi sebelumnya?** Buka **💾 Backup & Restore**, pilih tanggal backup yang sesuai, klik **Restore**.
- **Reset total database** hanya untuk situasi darurat (misalnya mau mulai ulang dari nol) — sengaja dibuat sulit tidak sengaja terpencet: harus isi alasan reset dulu, lalu ketik persis **"HAPUS PERMANEN"**. Sistem tetap bikin backup otomatis sebelum reset, jadi masih bisa dipulihkan kalau ternyata keliru.

---

## 10. Pakai di Lapangan Tanpa Sinyal

Tim Sales bisa tetap input Kontrol Bulanan walau **HP tidak ada sinyal sama sekali**:
- Data yang diinput langsung tersimpan aman di HP.
- Begitu HP dapat sinyal lagi (walau cuma sebentar), data otomatis terkirim ke server tanpa perlu aksi apa pun dari Sales.
- Status di bagian atas layar menunjukkan kondisinya: `📴 Offline · N menunggu` (masih ada N data belum terkirim) → `🔄 Mengirim...` → `☁️ Sinkron` (semua sudah aman di server).

Jadi Sales bisa lanjut kunjungi toko berikutnya tanpa khawatir data hilang, walau sedang di daerah blank spot.

---

## 11. Kalau Data Sudah Menumpuk Bertahun-tahun (Arsip)

Supaya database tidak "penuh" setelah bertahun-tahun (kuota gratis Firebase terbatas), Admin bisa arsipkan data Kontrol Bulanan tahun-tahun lama ke Google Drive lewat menu **🗄️ Arsipkan Tahun Lama**:
- Data tahun lama dipindah ke Google Drive (bukan dihapus) — masih bisa dilihat/diunduh kapan saja lewat menu **Data yang Sudah Diarsipkan**.
- Proses ini aman — data lama baru dihapus dari database aktif **setelah** benar-benar berhasil tersimpan di Drive.

---

## 12. Install Aplikasi di HP

Aplikasi ini bisa dipasang seperti aplikasi biasa tanpa lewat Play Store:
- **Android (Chrome)**: buka situsnya → menu titik tiga → **"Install app"**.
- **iPhone (Safari)**: tombol Share → **"Add to Home Screen"**.
- **Komputer (Chrome/Edge)**: ikon install muncul otomatis di address bar.

Setelah terpasang, aplikasi punya ikon sendiri di layar HP dan tetap bisa dibuka walau tanpa internet (data terakhir yang tersimpan tetap bisa dilihat).

Kalau butuh file `.apk` untuk dibagikan/diinstall manual ke banyak HP sekaligus, itu proses build terpisah lewat GitHub Actions — lihat `README.md` §15.B (biasanya dikerjakan Admin/developer, bukan pengguna sehari-hari).

---

## 13. Tanya Jawab Umum

**Dropdown toko kosong saat mau isi Kontrol?**
Toko itu berstatus Non-Aktif — cek status di Master Toko, ubah jadi Aktif/Baru kalau memang masih beroperasi.

**Toko baru kok belum jadi "Aktif" juga?**
Status "Baru" otomatis berubah "Aktif" sendiri setelah 30 hari sejak tanggal masuk — tidak perlu diubah manual.

**Ada nama wilayah/rute/toko yang muncul dobel di filter?**
Buka **Master Wilayah**, cari badge ⚠️ **Duplikat**, klik tombol **Gabungkan Duplikat** — aman dipakai kapan saja.

**Sales tidak bisa lihat data wilayah lain, itu normal?**
Ya, disengaja. Atur **Wilayah Tugas** di menu Pengguna kalau memang perlu dibuka ke wilayah lain, atau kosongkan kolom itu untuk buka akses semua wilayah.

**Tidak sengaja hapus/reset data penting?**
Menu ☰ → **Backup & Restore** → pilih snapshot sebelum kejadian → Restore. Lihat [§9](#9-backup-restore--kalau-terjadi-kesalahan).

**Butuh naikkan role diri sendiri tapi tidak ada Admin lain yang bisa bantu?**
Sistem punya jalur darurat: kalau suatu saat tidak ada satu pun akun Admin, siapa pun yang login akan otomatis diberi akses Admin sementara untuk memperbaiki ini.

**Ada pertanyaan teknis (deploy, error build, dll)?**
Itu di luar cakupan panduan ini — lihat `README.md`, atau hubungi Admin/developer aplikasi.

---

*Panduan ini untuk pemakaian sehari-hari. Untuk hal teknis (instalasi, deploy, struktur kode, keamanan), lihat `README.md`.*
