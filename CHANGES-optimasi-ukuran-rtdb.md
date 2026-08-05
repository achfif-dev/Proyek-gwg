# Perubahan: Optimasi Ukuran RTDB Pasca Fitur Akuntansi (Fase 1-8)

Status: **Selesai — perlu deploy rules baru dulu sebelum dipakai** (lihat
langkah deploy di bawah).

## Latar belakang: kenapa RTDB melonjak dari ~3MB ke ~7MB

Audit menemukan **backup harian otomatis** (`backupNow()` di `useDB.js`)
adalah penyebab utama, bukan volume transaksi akuntansi itu sendiri:

- `backupNow()` menyimpan **salinan penuh seluruh `db`** (state gabungan
  semua tabel, termasuk tabel baru `jurnalUmum`/`daftarAkun`/
  `saldoAkunBulanan` sejak Fase 1) ke `gwg_data/_backups/{tanggal}`, **1x per
  hari**, dan menyimpan **10 backup terakhir** (`MAX_BACKUPS = 10`).
- Artinya setiap byte pertumbuhan `jurnalUmum` (yang memang belum ada
  arsipnya — lihat Fase 6/7) **dikalikan ~11x** di dalam RTDB (1 salinan live
  + 10 salinan backup), karena backup ikut menyalinnya tiap hari selama masih
  ada dalam jendela 10 hari.
- Ditambah pola `buatEntryPembalik()` yang sengaja tidak menghapus entry
  lama (audit trail) — tiap edit/approve-ulang Kontrol menambah net +2 entry
  permanen (1 void + 1 pembalik) — sehingga `jurnalUmum` tumbuh lebih cepat
  dari yang sebenarnya diperlukan.

### Estimasi kasar

Entry jurnal khas (2-4 baris debit/kredit + metadata) berukuran **~350-480
byte** sebagai JSON (rata-rata dibulatkan **~420 byte/entry**).

Kalau pertumbuhan RTDB +4MB (3MB→7MB) dianggap **hampir seluruhnya**
berasal dari efek pengganda backup di atas:

```
pertumbuhan_live ≈ pertumbuhan_total / (MAX_BACKUPS_lama + 1)
                  ≈ 4.000.000 byte / 11
                  ≈ ~364.000 byte

perkiraan_jumlah_entry ≈ 364.000 / 420 byte
                        ≈ ~870 entry jurnal terakumulasi
                          sejak fitur akuntansi mulai dipakai
```

**Catatan penting:** ini estimasi kasar berdasarkan ukuran entry tipikal dan
asumsi mayoritas pertumbuhan berasal dari efek pengganda backup — bukan
hasil pengukuran langsung terhadap data produksi (tidak ada file export RTDB
aktual yang tersedia saat audit). Untuk angka pasti, export
`gwg_data/shared/jurnalUmum` dari Firebase Console lalu ukur byte JSON-nya
langsung.

### Efek setelah patch ini

- **Segera (dalam ≤5 hari setelah deploy):** backup lama yang masih
  menyertakan `jurnalUmum` akan otomatis tergusur dari jendela rolling
  (`MAX_BACKUPS` turun ke 5), dan backup baru tidak lagi menyalin
  `jurnalUmum` sama sekali — total `_backups` diperkirakan menyusut sekitar
  **3-3.6MB**, mendekati ukuran sebelum fitur akuntansi ditambahkan.
- **Jangka panjang:** `jurnalUmum` tahun-tahun lama bisa dipindah ke Drive
  lewat tombol arsip baru, sama seperti data Kontrol.

## Poin 1 — Backup harian tidak lagi menyalin `jurnalUmum`

**File:** `src/hooks/useDB.js`

- `MAX_BACKUPS` diturunkan dari **10 → 5**.
- `backupNow()` sekarang mengecualikan `jurnalUmum` dari snapshot
  (`daftarAkun`/`saldoAkunBulanan` tetap disertakan karena kecil).
  Snapshot baru diberi penanda `jurnalUmumDikecualikan: true`.
- `restoreBackup()` diberi guard: kalau snapshot yang direstore **tidak**
  menyertakan key `jurnalUmum` (backup buatan versi baru), path RTDB
  `jurnalUmum` **tidak disentuh sama sekali** saat restore — jurnal aktif
  yang sedang berjalan tetap seperti apa adanya. Backup LAMA (dari sebelum
  patch ini, yang masih menyertakan `jurnalUmum`) tetap direstore seperti
  biasa — kompatibel mundur.

## Poin 2 & 3 — Arsip `jurnalUmum` per tahun ke Google Drive (digabung)

**File:** `src/hooks/useDB.js`, `src/App.jsx`

Awalnya direncanakan sebagai 2 hal terpisah: (2) arsip `jurnalUmum` per
tahun, dan (3) hapus permanen entry yang sudah `void` di bulan yang sudah
Tutup Buku. **Setelah ditelusuri, poin 3 digabung ke poin 2** (bukan
dikerjakan sebagai penghapusan baris-per-baris terpisah), karena:

`bukaKunciBulan()` (tombol "Buka Kunci" di Laporan Neraca) menghapus
snapshot `saldoAkunBulanan` bulan itu dan **mengandalkan `jurnalUmum` mentah
untuk dihitung ulang** — termasuk entry yang **aktif** (bukan cuma yang
`void`). Kalau cuma entry `void` yang dihapus permanen, "Buka Kunci" tetap
aman; tapi menghapus entry `void` saja tidak banyak mengurangi ukuran
(entry aktifnya, yang justru lebih banyak, akan tetap ada) — dan
menghapus SEBAGIAN entry per bulan (campur aktif+void) tanpa arsip Drive
lebih dulu berisiko membuat riwayat itu tidak bisa dipulihkan/diverifikasi
kalau ternyata suatu saat perlu.

Solusi yang dipilih: **arsipkan satu tahun jurnal penuh** (aktif + void,
persis pola arsip `kontrol` yang sudah ada) ke Drive, baru hapus dari RTDB.
Ini otomatis memenuhi tujuan poin 3 (data lama yang sudah "dibekukan" lewat
snapshot `saldoAkunBulanan` tidak perlu lagi memenuhi RTDB) sekaligus lebih
aman (audit trail lengkap tetap ada di Drive, bukan sebagian terhapus diam-diam).

### Fungsi baru: `archiveJurnalTahun(year)`

- Mirror persis `archiveKontrolYear()`: ambil `jurnalUmum/{tahun}` langsung
  dari RTDB → upload sebagai satu file JSON ke Drive
  (`gwg_arsip_jurnal_{tahun}.json`) → baru hapus dari RTDB → catat index
  ringan di `jurnalArchiveIndex/{tahun}` (fileId, link Drive, jumlah entry).
- Mengembalikan field `semuaBulanTertutup` (true kalau seluruh 12 bulan
  tahun itu sudah punya snapshot `saldoAkunBulanan`, artinya sudah Tutup
  Buku semua) — dipakai untuk menampilkan peringatan di UI, **tidak
  memblokir** aksi (keputusan tetap di tangan admin, sama seperti arsip
  Kontrol).
- State baru `archivedJurnalYears` + `refreshArchivedJurnalYears()`,
  dibaca dari `jurnalArchiveIndex` — pola identik dengan
  `archivedKontrolYears`.

### UI baru di App.jsx

Card "Arsipkan Jurnal Umum (Akuntansi) ke Google Drive" ditambahkan tepat
di bawah card arsip Kontrol yang sudah ada (menu Admin → Backup & Restore),
dengan pola tombol/konfirmasi yang sama. Tahun yang ditawarkan = tahun yang
punya data di `db.jurnalUmum` MINUS tahun berjalan MINUS yang sudah
diarsipkan.

**Belum termasuk** (di luar cakupan poin 1-3, menyusul kalau dibutuhkan):
tombol Lihat/Export Excel untuk arsip jurnal (kontrol punya ini, jurnal
belum) — datanya tetap bisa diambil manual dari file JSON di Google Drive.

## Rules Firebase baru: `database_rules_v9_fix.json`

Superset dari `database_rules_v8_fix.json` + 1 path baru:
- `jurnalArchiveIndex/{tahun}` — pola rule identik dengan
  `jurnalYearsIndex` yang sudah ada (Admin/Manajer/Sales read, Admin/Manajer
  write). Tanpa ini, `archiveJurnalTahun()` akan gagal permission-denied
  persis seperti bug `jurnalYearsIndex` yang pernah ditemukan di audit
  Fase 8 sebelumnya.

## Langkah deploy (WAJIB urut, sama seperti fase-fase sebelumnya)

1. **Upload `database_rules_v9_fix.json` ke Firebase Console → Realtime
   Database → Rules dulu**, sebelum kode baru dipakai.
2. Ganti isi `src/hooks/useDB.js` dan `src/App.jsx` di GitHub dengan versi
   yang sudah dipatch.
3. Biarkan GitHub Actions build & deploy seperti biasa.
4. (Opsional, kapan saja setelahnya) Buka menu Admin → Backup & Restore →
   arsipkan tahun-tahun jurnal lama yang sudah Tutup Buku penuh.

## Yang BELUM ditangani

- Tombol Lihat/Export Excel untuk arsip jurnal (lihat catatan UI di atas).
- Pengecekan otomatis "semua bulan tertutup" tidak memblokir arsip — masih
  mengandalkan kehati-hatian admin (sama seperti arsip Kontrol yang juga
  cuma mengandalkan peringatan teks, bukan validasi keras).
