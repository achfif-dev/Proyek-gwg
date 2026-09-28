# Perubahan audit keamanan — 28 Sep 2026

## 1. XSS & CSV injection di ekspor (`src/lib/exportUtils.js`)
- Semua teks yang masuk ke HTML cetak PDF dan `exportHTML` kini lewat `escapeHtml()`.
- `onerror` inline pada logo dihapus (nilai ter-decode bisa memecah string JS); diganti handler di script cetak.
- `exportCSV`: teks bebas yang diawali `= + - @` diberi awalan `'` (mencegah rumus di Excel/Sheets).

## 2. Rules v13 (`firebase-rules/database_rules_v13_jurnal_sales_superadmin.json`)
Perubahan terhadap v12, hanya pada:
- `jurnalUmum`, jalur Sales (buat entry baru): wajib `createdBy` = email sendiri, 2–6 baris,
  total debit = total kredit (> 0), akun hanya `1101 1102 1111 4101 4102 5101 5103`,
  dan untuk sumber `kontrol` wilayah kontrol harus sama dengan wilayah Sales.
  Jalur Admin/Manajer tidak berubah.
- `_config/superAdminEmail`: klaim pertama hanya boleh oleh email yang tertulis di placeholder
  `__SUPER_ADMIN_EMAIL__` dan hanya untuk dirinya sendiri.
- `pengguna`: Admin pertama (bootstrap) hanya untuk email Super Admin.
**Wajib pada instalasi BARU:** ganti kedua `__SUPER_ADMIN_EMAIL__` dengan email Super Admin sebelum
Publish. Jika lupa, bootstrap gagal tertutup (tidak ada yang bisa mengklaim). Untuk database GWG yang
sudah berjalan, placeholder tidak berpengaruh (node & pengguna sudah ada).

Keterbatasan (jujur): Rules tidak bisa menghitung ulang nominal dari data produk. Sales masih bisa
memposting entry yang *seimbang* dengan nominal salah pada akun di whitelist untuk kontrol
wilayahnya sendiri. Pencegah penuh butuh rekonsiliasi di sisi Admin atau Cloud Function.

## 3. Workflow keystore (`.github/workflows/generate-keystore.yml`)
Tidak lagi mencetak password ke Summary atau mengunggah keystore sebagai artifact (repo publik).
Kunci langsung disimpan sebagai 4 Secrets lewat `gh secret set`; butuh secret `SECRETS_WRITE_TOKEN`
(fine-grained PAT, izin Secrets: read/write). Menolak menimpa keystore yang sudah ada.

## 4. Tes (`tests/`)
Tanpa dependensi baru (lockfile & build tidak tersentuh):
`node --import ./tests/register.mjs --test tests/*.test.mjs` (butuh Node 22).
Mencakup: validasi jurnal, jurnal Kontrol/Penjualan Luar (balance + whitelist Rules), entry pembalik,
saldo terkini + snapshot bulan tertutup, dan escapeHtml.

## Belum dikerjakan
- Pembatasan baca Sales per wilayah (`kontrol`, `toko`, `pengguna`): butuh backfill `wilayahId`
  pada data lama dan perubahan listener di `useDB.js`; harus diuji dengan akun Sales sungguhan.
- `google-services.json` white-label dan purge riwayat git (`.env` lama).
