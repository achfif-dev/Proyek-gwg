# Changelog

Semua perubahan penting pada proyek ini dicatat di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/), versioning mengikuti [Semantic Versioning](https://semver.org/).

## [Unrilis]
### Ditambahkan (Fase Bersaing Kompetitor)
- **Sistem Lisensi Anti-Bajakan** (self-service): aktivasi lewat kode lisensi yang ditempel
  sendiri oleh pelanggan (tanpa bantuan developer), diverifikasi via tanda tangan RSA-2048 —
  private key hanya ada di Cloud Functions, tidak pernah ikut ke dalam APK. Sekali aktivasi
  online, aplikasi tetap 100% bisa dipakai offline (revalidasi otomatis diam-diam tiap ada
  internet lewat WorkManager, masa tenggang 14 hari sebelum benar-benar terkunci). Developer
  cukup build SATU APK generik untuk semua pelanggan — lihat `LICENSING_SETUP.md`.
- **Payment Gateway QRIS Otomatis (Midtrans)**: setiap toko menghubungkan akun Midtrans sendiri
  (uang masuk langsung ke rekening toko, bukan lewat developer) lewat Pengaturan > Payment
  Gateway — sepenuhnya self-service. Status "Lunas" terkonfirmasi otomatis realtime di layar
  Kasir lewat webhook + Firestore listener, tanpa cek manual. QRIS statis manual tetap tersedia
  sebagai cadangan offline. Lihat `PAYMENT_GATEWAY_SETUP.md`.
- **Printer LAN/WiFi & USB**: `PrinterRepository` kini mendukung 3 jenis koneksi printer thermal
  (Bluetooth/LAN-TCP/USB Host), tidak lagi terbatas Bluetooth saja. Diatur di Pengaturan > Profil
  Toko > Printer Struk, termasuk pilihan lebar kertas 58mm/80mm.
- **Cek Stok Semua Cabang**: perluasan Sinkronisasi Cloud — tiap cabang (opt-in, dari toggle yang
  sama dengan ringkasan omzet) mengirim snapshot katalog produk+stoknya secara berkala, admin
  bisa melihat stok & harga cabang lain secara realtime (read-only, tidak menimpa data lokal
  cabang sendiri) dari Pengaturan > Multi-Cabang > Cek Stok Semua Cabang.
- (Struk digital via WhatsApp sudah ada sejak sebelumnya — lihat entri Ditambahkan di bawah.)

## [Unrilis - riwayat sebelumnya]
### Ditambahkan
- **Retur/Refund & Void Transaksi**: tabel baru `transaction_returns` & `transaction_return_items`
  (migrasi v10 -> v11). Retur boleh diproses Kasir maupun Admin (alasan wajib, per-item bisa
  ditandai layak jual lagi/rusak, bisa bertahap). Void (batalkan transaksi sepenuhnya) khusus
  Admin — menggantikan tombol "Hapus Transaksi" lama yang menghapus permanen; sekarang transaksi
  tetap tersimpan (status VOIDED) untuk audit, hanya dikeluarkan dari perhitungan Laporan.
- **Role Manager**: peran baru di antara Kasir dan Admin (migrasi v11 -> v12, tanpa perubahan
  skema — cuma nilai enum baru). Manager bisa jual & retur seperti Kasir, plus akses Beban Usaha
  & Laba Bersih di Laporan — tapi tetap tidak bisa Void/koreksi transaksi maupun akses
  Pengaturan/Backup/Manajemen Pengguna (murni Admin-only).
- **Log Aktivitas**: tabel baru `audit_logs`, mencatat Void, Retur, Koreksi Transaksi, Tambah/
  Hapus Pengguna, dan Restore Backup (siapa, kapan, alasan). Layar baru di Pengaturan > Log
  Aktivitas (Admin-only). Jejak Restore Backup sengaja disimpan di file teks terpisah
  (`restore_audit_log.txt`), BUKAN di tabel `audit_logs` — karena restore menimpa seluruh file
  database termasuk tabel itu sendiri, jadi jejaknya justru akan ikut hilang kalau disimpan di
  sana (lihat komentar `RestoreAuditLog.kt`).

### Diperbaiki
- Bug lama di query Laporan Omzet (`getSalesSummary`): `SUM(t.total)` ikut ter-JOIN dengan baris
  item transaksi, sehingga omzet transaksi dengan banyak item terhitung berulang kali. Sekarang
  dihitung dari subquery terpisah yang tidak ikut kelipatan oleh JOIN.

### Diubah
- `exportSchema` Room diaktifkan (`true`) + `room.schemaLocation` dikonfigurasi ke `app/schemas/`.
  Mulai sekarang setiap kenaikan versi database menyimpan snapshot skema JSON asli, sehingga
  migrasi berikutnya (v10 -> v11, dst.) bisa diuji otomatis terhadap skema versi sebelumnya yang
  sungguhan (bukan cuma dugaan) memakai `MigrationTestHelper`. Folder `app/schemas/` WAJIB
  ikut di-commit ke Git — jangan masukkan ke `.gitignore`.

## [1.2.0] - 2026-08-26
### Ditambahkan
- **Manajemen Shift Kasir**: buka/tutup kasir dengan rekonsiliasi kas otomatis (kas seharusnya
  dihitung sistem dari data transaksi tunai asli, bukan input manual) — tabel `shifts` baru.
  Saat "Wajibkan Login PIN" aktif, transaksi digerbang: harus ada shift terbuka dulu.
- **Pelanggan & Piutang (Bon)**: metode pembayaran baru `BON` (bisa dicampur/split dengan
  Cash/QRIS/Debit), saldo piutang dihitung otomatis dari transaksi Bon dikurangi pelunasan
  (tabel `customers` + `debt_payments` baru), layar daftar pelanggan + detail piutang + catat
  pelunasan (boleh mencicil).
- **Sinkronisasi Cloud / Multi-Cabang (fondasi)**: kirim ringkasan omzet harian per cabang ke
  Firestore (opsional, nonaktif default, butuh setup Firebase sendiri — lihat `FIREBASE_SETUP.md`),
  layar Ringkasan Semua Cabang untuk pemilik. Sepenuhnya fail-soft: tanpa konfigurasi Firebase,
  app tetap 100% offline seperti biasa.
- Database Room naik ke v9 (v7 Beban Usaha → v8 Shift → v9 Customer/Piutang/kolom `customerId`).

## [1.1.0] - 2026-08-25
### Diperbaiki
- Build gagal: import `Modifier.pointerInput` yang salah paket di `MainActivity.kt`.
- Build gagal: file `domain/auth/Permission.kt` (dipakai untuk role-gating rute Expenses/Settings/Backup) hilang dari repo.
### Ditambahkan
- Unit test untuk logika inti: `Cart` (kalkulasi subtotal/diskon/pajak), `CheckoutValidator`
  (validasi checkout — cart kosong, pembayaran kurang, stok tidak cukup, split payment),
  `QrisUtil.injectAmount` (TLV & CRC16 QRIS dinamis), `BackupCrypto` (round-trip enkripsi backup).
- `applicationId` diganti dari `com.example.posapp` (ditolak Play Store) ke `id.gwg.posapp`.
### Diubah
- Logika validasi checkout dipisah ke `CheckoutValidator` (objek murni tanpa dependensi Room/Hilt)
  supaya bisa diuji unit test tanpa emulator/device.

## [1.0.0] - 2026-08-24
### Ditambahkan
- Rilis awal: Kasir (POS), Manajemen Produk + Varian, Scan Barcode, Cetak Struk Bluetooth ESC/POS,
  QRIS statis→dinamis on-device, Export PDF/Excel, Login PIN multi-user, Backup & Restore terenkripsi,
  Laporan Penjualan + Laba Bersih, Stok & Inventaris, Beban Usaha.
