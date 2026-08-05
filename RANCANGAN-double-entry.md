# Rancangan Double-Entry Accounting — GWG Super App

Status: **DRAFT UNTUK DISEPAKATI** (belum ada kode yang diubah). Dirancang
supaya cocok dengan modul yang sudah ada (Kas Opname, Aset, Hutang/Piutang,
Bagi Hasil, Dana Cadangan) dan bisa mulai dipakai dari hari ini (opening
balance = kondisi saat ini), tanpa perlu rekonstruksi detail transaksi lama.

---

## 1. Daftar Akun (Chart of Accounts)

Kode akun 4 digit, mengikuti urutan standar (1=Aset, 2=Kewajiban, 3=Ekuitas,
4=Pendapatan, 5=Beban). Kategori yang sudah ada di app (`KATEGORI_KAS_MASUK`,
`KATEGORI_ASET`, dst) di-mapping 1:1 ke akun di bawah supaya UI existing
(dropdown kategori) tidak perlu diubah — cuma jadi trigger posting jurnal.

### 1xxx — ASET

| Kode | Nama Akun | Normal Balance | Sumber Data |
|---|---|---|---|
| 1101 | Kas | Debit | `kasTransaksi` |
| 1102 | Piutang Usaha (Toko/Konsinyasi) | Debit | `hutangPiutang` (kategori "Piutang Toko/Konsinyasi") |
| 1103 | Piutang Karyawan | Debit | `hutangPiutang` (kategori "Piutang Karyawan") |
| 1104 | Piutang Lainnya | Debit | `hutangPiutang` (kategori "Lainnya") |
| 1110 | Persediaan — Gudang Pusat | Debit | `gudangTransaksi` |
| 1111 | Persediaan — Beredar di Toko | Debit | `kontrol` (stok_*), `toko` |
| 1201 | Aset Tetap — Kendaraan | Debit | `asetAmortisasi` |
| 1202 | Aset Tetap — Peralatan Toko/Display | Debit | `asetAmortisasi` |
| 1203 | Aset Tetap — Sistem/Software | Debit | `asetAmortisasi` |
| 1204 | Aset Tetap — Perlengkapan Kantor | Debit | `asetAmortisasi` |
| 1205 | Aset Tetap — Lainnya | Debit | `asetAmortisasi` |
| 1290 | Akumulasi Penyusutan (kontra-aset) | **Kredit** | `asetAmortisasi` (amortisasi bulanan) |

### 2xxx — KEWAJIBAN

| Kode | Nama Akun | Normal Balance | Sumber Data |
|---|---|---|---|
| 2101 | Hutang Usaha/Supplier | Kredit | `hutangPiutang` (kategori "Hutang Supplier") |
| 2102 | Pinjaman Bank | Kredit | `hutangPiutang` |
| 2103 | Pinjaman Investor | Kredit | `hutangPiutang` |
| 2104 | Hutang Lainnya | Kredit | `hutangPiutang` |
| 2110 | Kewajiban Dana Cadangan | Kredit | dihitung otomatis dari `kontrol`+`penjualanLuar` (pcs × Rp/pcs) |
| 2120 | Hutang Bagi Hasil (belum dicairkan) | Kredit | perhitungan Bagi Hasil periode |
| 2130 | Hutang Pajak | Kredit | `kasTransaksi` (kategori "Pembayaran Pajak", sebelum dibayar) |

### 3xxx — EKUITAS

| Kode | Nama Akun | Normal Balance | Sumber Data |
|---|---|---|---|
| 3101 | Modal Disetor | Kredit | input manual Admin (`bagiHasilConfig.modalDisetor`) |
| 3102 | Laba Ditahan | Kredit | **akumulasi jurnal penutup**, bukan plug lagi |
| 3199 | Modal Disetor (Belum Dikonfirmasi) — suspense | Kredit | opening balance, direklasifikasi ke 3101 begitu nilai pasti dikonfirmasi (lihat §7.3) |

### 4xxx — PENDAPATAN

| Kode | Nama Akun | Normal Balance | Sumber Data |
|---|---|---|---|
| 4101 | Pendapatan Penjualan Konsinyasi | Kredit | `kontrol` |
| 4102 | Pendapatan Penjualan Luar Rute | Kredit | `penjualanLuar` |
| 4103 | Pendapatan Lain-lain | Kredit | `kasTransaksi` (kategori "Pendapatan Lain-lain") |

### 5xxx — BEBAN & HPP

| Kode | Nama Akun | Normal Balance | Sumber Data |
|---|---|---|---|
| 5101 | HPP (Harga Pokok Penjualan) | Debit | `kontrol`/`penjualanLuar` × `produk.hargaModal` |
| 5102 | Beban Operasional | Debit | `bagiHasilConfig.bebanUsaha[]` / `kasTransaksi` |
| 5103 | Beban Bonus/Insentif Sales | Debit | `kontrol` (bonus_*), `kasTransaksi` |
| 5104 | Beban Logistik/Distribusi | Debit | `kasTransaksi` |
| 5105 | Beban Penyusutan (Amortisasi) | Debit | `asetAmortisasi` (bulanan, lawan akun 1290) |
| 5106 | Beban Pajak | Debit | `kasTransaksi` (kategori "Pembayaran Pajak") |
| 5107 | Beban Lain-lain | Debit | `kasTransaksi` (kategori "Lainnya") |

> **Catatan desain — Dana Cadangan bukan beban P&L.** Di app ini, Dana
> Cadangan mengurangi SHU yang DIBAGI ke pihak, tapi bukan "beban usaha"
> dalam pengertian akuntansi (bukan biaya operasional). Diperlakukan sebagai
> **apropriasi laba** — dijurnal langsung: Debit `3102 Laba Ditahan`, Kredit
> `2110 Kewajiban Dana Cadangan`. Ini mempertahankan makna aslinya (mengunci
> sebagian laba jadi cadangan) tanpa memutar-balikkan definisi "beban".

---

## 2. Skema Jurnal (struktur data baru di RTDB)

### `gwg_data/shared/jurnalUmum/{tahun}/{id}`
```json
{
  "tanggal": "2026-08-03",
  "sumberTipe": "kontrol | kasTransaksi | asetAmortisasi | hutangPiutang | stockOpname | gudangTransaksi | danaCadangan | bagiHasil | tutupBuku | openingBalance | manual",
  "sumberId": "K_abc123",          // id record asal di tabel sumber — WAJIB, untuk audit trail & mencegah posting dobel
  "keterangan": "Penjualan konsinyasi — Toko Sumber Rejeki",
  "baris": [
    { "akun": "1102", "debit": 45000, "kredit": 0 },
    { "akun": "4101", "debit": 0,     "kredit": 45000 }
  ],
  "createdAt": 1754200000000,
  "createdBy": "U_admin_at_gmail_dot_com",
  "void": false                    // true kalau dibatalkan (bukan dihapus — audit trail tidak boleh hilang)
}
```
**Aturan wajib**: `sum(baris.debit) === sum(baris.kredit)` di SETIAP entry —
divalidasi di kode (sebelum kirim) **dan** di Firebase Rules (`.validate`)
supaya tidak mungkin ada entry timpang tersimpan, dari jalur mana pun.

### `gwg_data/shared/saldoAkunBulanan/{YYYY-MM}/{kodeAkun}`
Snapshot saldo per akun per bulan — dibuat **saat Tutup Buku**, lalu terkunci
(sama seperti pola `kontrolArchiveIndex` yang sudah dipakai untuk Dana
Cadangan). Ini yang membuat saldo tetap akurat walau jurnal detail bulan lama
suatu saat ikut diarsip/dihapus dari RTDB:
```json
{
  "saldoAwal": 12000000,
  "totalDebit": 8500000,
  "totalKredit": 5200000,
  "saldoAkhir": 15300000,
  "lockedAt": "2026-09-01T00:00:00.000Z"
}
```
Neraca & Laba Rugi tinggal **query saldo**, bukan hitung ulang dari data
mentah seperti sekarang. Bulan berjalan (belum ditutup) dihitung live dari
`jurnalUmum`; bulan yang sudah tertutup dibaca dari `saldoAkunBulanan`.

---

## 3. Mesin Posting (Posting Engine)

Satu fungsi `postJurnal(sumberTipe, sumberRecord, action)` dipanggil dari titik-titik
yang SUDAH ADA sekarang (bukan lapisan baru di UI):

| Titik input (sudah ada) | Jurnal yang diposting |
|---|---|
| `addRecord("kontrol", ...)` disetujui | Dr Piutang/Kas, Kr Pendapatan **+** Dr HPP, Kr Persediaan |
| `addRecord("kasTransaksi", ...)` | Dr/Kr Kas lawan akun sesuai kategori |
| `addRecord("asetAmortisasi", ...)` | Dr Aset Tetap, Kr Kas/Hutang (saat beli) |
| Amortisasi bulanan (job Tutup Buku) | Dr Beban Penyusutan, Kr Akumulasi Penyusutan |
| `addRecord("hutangPiutang", ...)` | Dr/Kr Piutang/Hutang lawan Kas (saat lunas) |
| `updateRecord` (edit) | Jurnal lama di-**void**, jurnal baru diposting (bukan diedit langsung — audit trail utuh) |
| `deleteRecord` | Jurnal terkait di-**void**, tidak dihapus fisik |
| Tutup Buku | Snapshot `saldoAkunBulanan`, lock periode |

---

## 4. Opening Balance (mulai hari ini)

Karena `kasTransaksi`/`asetAmortisasi`/`hutangPiutang` **kosong total** di
data live kamu, tidak perlu rekonstruksi apa pun untuk 3 modul itu. Yang
perlu 1 jurnal pembuka:

```
Tanggal: [tanggal go-live double-entry]
Dr 1111 Persediaan Beredar di Toko   = Σ(stok toko saat ini × HPP)
Dr 1101 Kas                          = 0 (sesuai kasSaldoAwal saat ini)
    Kr 2110 Kewajiban Dana Cadangan  = 3.963 baris kontrol existing × Rp500/pcs
    Kr 3101 Modal Disetor            = [perlu diisi Admin — saat ini kosong]
    Kr 3102 Laba Ditahan (plug awal) = sisanya, SEKALI SAJA sebagai titik mulai
```
Setelah jurnal pembuka ini, `3102 Laba Ditahan` **tidak pernah lagi** dihitung
sebagai plug — murni akumulasi jurnal penutup bulanan ke depan.

⚠️ **Modal Disetor harus diisi Admin dulu** sebelum go-live — kalau tetap
kosong, Laba Ditahan opening akan menyerap seluruh nilai itu sebagai "laba
misterius", yang justru mengulang masalah lama.

---

## 5. Firebase Rules — INI PERLU DIUPDATE

Beda dari perbaikan arsip kemarin (yang cuma nulis ke path lama), fitur ini
butuh 2 path RTDB BARU (`jurnalUmum`, `saldoAkunBulanan`) yang belum ada
aturannya sama sekali di `database_rules_v6_neraca.json` — kalau tidak
ditambahkan, semua tulis ke situ akan **ditolak** oleh Firebase (permission
denied), bukan cuma "kurang optimal" seperti kasus kemarin. Aturannya perlu:
- `.write` hanya Admin/Manajer (sama seperti tabel akuntansi lain).
- `.validate` di level `baris` memaksa `debit`/`kredit` non-negatif dan
  salah satu dari keduanya harus 0 (satu baris tidak boleh isi debit & kredit
  sekaligus) — validasi jumlah total debit=kredit lebih aman dilakukan di
  kode (Firebase Rules tidak bisa mudah men-jumlah array).

---

## 6. Fase Implementasi (disarankan, bukan sekali jalan)

1. **Fase 1 — Fondasi**: skema akun, `postJurnal()`, tabel `jurnalUmum`,
   Firebase Rules baru. Belum mengubah UI sama sekali.
2. **Fase 2 — Kas** (paling sederhana, sudah 2 sisi jelas: kategori masuk/keluar).
3. **Fase 3 — Kontrol & Penjualan Luar** (Pendapatan + HPP + Persediaan).
4. **Fase 4 — Aset & Amortisasi**.
5. **Fase 5 — Hutang/Piutang**.
6. **Fase 6 — Dana Cadangan** jadi apropriasi (bukan plug lagi).
7. **Fase 7 — Tutup Buku** → snapshot `saldoAkunBulanan`, lock periode.
8. **Fase 8 — Ganti `NeracaKeuangan.jsx`** dari hitung-ulang manual jadi
   query saldo akun. Baru di fase ini Laba Ditahan berhenti jadi plug, dan
   Neraca Saldo (trial balance) bisa jadi validator otomatis.

Setiap fase bisa jalan berdampingan dengan sistem lama (tidak perlu big-bang
cutover) — cocok karena data masih sedikit, risiko kecil kalau salah satu
fase perlu direvisi di tengah jalan.

---

## 7. Revisi Berdasarkan Keputusan (update setelah diskusi)

### 7.1 Dimensi Wilayah (bukan sub-akun literal)
Breakdown per wilayah dilakukan lewat field `dimensi` di tiap baris jurnal,
BUKAN kode akun baru per wilayah:
```json
{ "akun": "5102", "debit": 500000, "kredit": 0, "dimensi": { "wilayahId": "W_bklu1" } }
```
Alasan: Chart of Accounts jadi stabil lintas klien white-label (jumlah &
nama wilayah beda-beda per klien, dan bisa berubah kapan saja) — laporan
"Beban per Wilayah" tinggal query/filter berdasarkan `dimensi.wilayahId`,
tanpa perlu menambah akun tiap kali ada wilayah baru.

### 7.2 Nama Akun — dipisah dari Kode Akun
Tabel baru `gwg_data/shared/daftarAkun/{kodeAkun}`:
```json
{ "nama": "Dana Cadangan", "tipe": "kewajiban", "aktif": true, "protected": true }
```
- **Kode akun** (`2110`, dst) = kunci teknis tetap, dipakai mesin posting —
  TIDAK berubah antar white-label.
- **`nama`** = label tampilan, bisa diedit bebas per instalasi (mengikuti
  pola `config.danaCadangan.keterangan` yang sudah ada).
- **`protected: true`** = akun inti yang dipakai logika posting otomatis
  (Kas, Piutang, Laba Ditahan, Dana Cadangan, dll) — tidak bisa dihapus,
  cuma bisa dinonaktifkan kalau memang tidak dipakai, dan namanya tetap
  bisa diedit.
- Akun non-protected (kategori Beban/Pendapatan tambahan) bisa
  ditambah/dihapus bebas oleh Admin — dihapus hanya diizinkan kalau belum
  pernah dipakai di `jurnalUmum` manapun (jaga audit trail).

### 7.3 Modal Disetor — akun suspense sementara
Karena nilai Modal Disetor belum dikonfirmasi Direktur, opening balance
PAKAI akun sementara, bukan menebak:
```
Kr 3199 Modal Disetor (Belum Dikonfirmasi)  = [saldo sisa opening]
```
Begitu angka pasti didapat → 1 jurnal reklasifikasi `Dr 3199 / Kr 3101`,
TIDAK menyentuh Laba Ditahan atau periode berjalan. Neraca tetap balance
sejak hari pertama go-live — proses ini tidak perlu ditunda.

### 7.4 Rencana Eksekusi
Semua fase (1–8) dikerjakan, **bertahap** sesuai urutan di Bagian 6 — tidak
big-bang. Fase 1 (Fondasi: skema akun + `daftarAkun` + `postJurnal()` +
Firebase Rules baru) jadi titik mulai berikutnya.

## 8. Status: Fase 1 (Fondasi) — SELESAI ✅

Diimplementasikan (lihat juga `CHANGES-fase1-double-entry.md` untuk rincian
per file):
- `src/lib/akuntansiHelpers.js` (baru) — Chart of Accounts default, validasi
  jurnal, `buatEntryJurnal()`, `buatEntryPembalik()` (void/reversal).
- `src/lib/dataHelpers.js` — `jurnalUmum` masuk `LIST_TABLES`, dipartisi per
  tahun sama seperti `kontrol`.
- `src/hooks/useDB.js` — mesin sync/tulis untuk `jurnalUmum` (partisi tahun,
  versi disederhanakan dari `kontrol`), `daftarAkun`/`saldoAkunBulanan`
  sebagai config object, fungsi `postJurnal()`, `voidJurnal()`,
  `seedDaftarAkunJikaKosong()`. Backup/restore & reset diupdate ikut
  mencakup tabel-tabel baru ini.
- `src/App.jsx` — auto-seed `daftarAkun` dari `DEFAULT_DAFTAR_AKUN` sekali,
  digerbangi `isAdmin`.
- `database_rules_v7_akuntansi.json` — rule baru untuk `jurnalUmum`,
  `daftarAkun`, `saldoAkunBulanan` (Admin/Manajer only + validasi struktur
  baris jurnal).

**Belum ada titik input yang memposting jurnal secara otomatis** — itu Fase
2 dst (Kas → Kontrol/Penjualan Luar → Aset → Hutang/Piutang → Dana Cadangan
→ Tutup Buku → ganti `NeracaKeuangan.jsx`). Fondasi ini aman dideploy sendiri
lebih dulu (tidak mengubah perilaku UI/laporan yang ada sama sekali) sebelum
lanjut ke fase berikutnya — **rules Firebase (§5 / `database_rules_v7_akuntansi.json`)
WAJIB diupload dulu** sebelum kode ini di-deploy, kalau tidak semua
percobaan tulis ke `jurnalUmum`/`daftarAkun`/`saldoAkunBulanan` akan ditolak
Firebase (permission denied).

## 9. Status: Fase 2 (Posting Kas) — SELESAI ✅

Lihat `CHANGES-fase2-posting-kas.md` untuk rincian. Ringkas: `submitKas()`,
`hapusKas()`, dan `submitBayar()` (pelunasan Hutang/Piutang via Kas) di
`NeracaKeuangan.jsx` sekarang otomatis memposting/membatalkan jurnal lewat
`postJurnal()`/`voidJurnal()`. Beberapa kategori (Pembelian Aset, Pembayaran
Hutang, Pelunasan Pinjaman) sementara memakai akun GENERIK karena Kas belum
link ke record Aset/Hutang/Piutang spesifik — disempurnakan di Fase 4/5.

## 10. Status: Fase 3 (Posting Kontrol & Penjualan Luar Rute) — SELESAI ✅

Lihat `CHANGES-fase3-posting-kontrol.md` untuk rincian. Ringkas: Kontrol
diposting HANYA saat status `"disetujui"` (Pendapatan+HPP, diasumsikan
kredit/Piutang, konsisten dengan mapping Kas "Setoran Penjualan Konsinyasi"
di Fase 2). Penjualan Luar Rute diposting langsung (diasumsikan tunai/Kas).
Satu record → 1 entry jurnal gabungan (multi-produk dijumlah, bukan
per-produk) supaya `jurnalUmum` tidak kebanjiran.

## 11. Status: Fase 4 (Posting Aset & Amortisasi) — SELESAI ✅

Lihat `CHANGES-fase4-posting-aset.md` untuk rincian. Ringkas: Tambah/edit/
hapus Aset → posting/void jurnal perolehan (`Dr akun-spesifik / Kr Kas`).
Tutup Buku → posting jurnal amortisasi periode (`Dr Beban Penyusutan / Kr
Akumulasi Penyusutan`), dibatalkan kalau kuncinya dibuka lagi.

⚠️ Keputusan penting: perolehan Aset diasumsikan TUNAI via Kas — Admin
JANGAN mencatat pembelian aset yang sama di Kas kategori "Pembelian Aset"
lagi (double-count). Lihat CHANGES-fase4 untuk detail & alasan.

## 12. Status: Fase 5 (Posting Hutang/Piutang) — SELESAI ✅

Lihat `CHANGES-fase5-posting-hutangpiutang.md` untuk rincian. Ringkas:
Tambah/edit/hapus Hutang/Piutang → posting/void jurnal pengakuan awal
dengan akun spesifik per kategori (Pinjaman Bank→2102, Hutang Supplier→2101
dst). **Perbaikan retroaktif Fase 2**: pelunasan (tombol "Bayar") sekarang
juga pakai akun spesifik yang sama, bukan lagi mapping generik kategori Kas.

⚠️ "Piutang Toko/Konsinyasi" SENGAJA tidak diposting dari modul ini (sudah
diposting via Kontrol di Fase 3) — mencegah double-count.

## 13. Status: Fase 6 (Dana Cadangan sebagai Apropriasi Laba) — SELESAI ✅

Lihat `CHANGES-fase6-dana-cadangan.md` untuk rincian. Ringkas: Tutup Buku
sekarang juga memposting jurnal apropriasi (`Dr 3102 Laba Ditahan / Kr 2110
Kewajiban Dana Cadangan`) sebesar SELISIH dari yang sudah pernah diposting
(karena `hitungDanaCadanganKumulatif()` menghasilkan angka all-time, bukan
per-periode) — memakai angka yang sama persis dengan Laporan Neraca lama.
Buka Kunci membatalkan jurnal apropriasi periode terkait.

## 14. Status: Fase 7 (Snapshot Saldo Akun Bulanan) — SELESAI ✅

Lihat `CHANGES-fase7-snapshot-saldo.md` untuk rincian. Ringkas: Tutup Buku
sekarang juga menyimpan snapshot saldo SEMUA akun ke
`saldoAkunBulanan/{YYYY-MM}` (saldo awal dari bulan sebelumnya + seluruh
jurnal bulan ini termasuk Amortisasi & Dana Cadangan yang baru diposting).
Buka Kunci menghapus snapshot itu. **Belum dipakai untuk tampilan mana
pun** — `NeracaKeuangan.jsx` masih 100% hitung-ulang manual seperti
sebelumnya. Menyambungkannya adalah Fase 8, yang sengaja dijeda dulu untuk
didiskusikan sebelum dikerjakan karena berisiko mengubah angka yang tampil
ke user.

## 15. Status: Fase 8 — Opsi B (Neraca Versi Jurnal, Perbandingan) — SELESAI ✅

Lihat `CHANGES-fase8-opsiB-perbandingan.md` untuk rincian. Ringkas: card baru
(collapsible, default tertutup) di bawah Laporan Neraca lama menampilkan
saldo akun dari jurnal berpasangan (independen 100% dari perhitungan lama)
+ cek keseimbangan Aset = Kewajiban + Ekuitas + Laba Berjalan. **Laporan
Neraca lama TIDAK diganti/disentuh** — ini murni alat verifikasi
berdampingan sebelum migrasi penuh diputuskan.

## 16. Perbaikan: 3 Bug Ditemukan Saat Audit Fase 8 — SELESAI ✅

Ditemukan lewat audit terpisah (lihat `CHANGES-fix-bug-jurnal-fase8.md`),
sudah diverifikasi ulang & diterapkan ke source ini:
1. Rule `jurnalUmum` tidak mengizinkan Sales, padahal `postJurnal()` dipicu
   dari `submit()`/`submitLuarRute()` di TabKontrol.jsx yang bisa dijalankan
   Sales — jurnal dari jalur ini ditolak Firebase diam-diam. Fix: rule di
   `database_rules_v8_fix.json` sekarang izinkan Sales, DIBATASI hanya untuk
   `sumberTipe === 'kontrol'` / `'penjualanLuar'`.
2. Path `jurnalYearsIndex` (ditulis dari `useDB.js` sejak Fase 1, generalisasi
   dari `kontrolYearsIndex`) tidak pernah punya rule sama sekali → selalu
   ditolak, memicu banner "writeDenied" di SETIAP posting jurnal. Fix: rule
   baru ditambahkan.
3. `cekKunci`/kunci Tutup Buku tidak pernah dipasang di `submitAset()`
   (NeracaKeuangan.jsx) maupun di TabKontrol.jsx sama sekali — transaksi di
   bulan yang sudah di-snapshot (Fase 7) bisa tetap diposting/diedit/dihapus,
   bikin "Neraca versi Jurnal" (Fase 8) diam-diam meleset. Fix: `cekKunci()`
   dipasang di Aset; fungsi baru `cekTutupBuku()` (pola sama) dipasang di 7
   titik across `submit()`, `submitLuarRute()`, `setujuiKontrolPengajuan()`,
   `setujuiHapusKontrol()`, `deleteSelected()` (bulk), `deleteLuarRute()`,
   ConfirmDelete modal, tabel — plus jaring pengaman silent (console.warn,
   tanpa alert) di `syncJurnalKontrol()`/`postJurnalPenjualanLuar()` untuk
   jalur non-interaktif (auto-approve 24 jam).

**WAJIB**: upload `database_rules_v8_fix.json` (menggantikan v7) ke Firebase
Console SEBELUM kode baru dipakai.





