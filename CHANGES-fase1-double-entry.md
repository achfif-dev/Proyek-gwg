# Perubahan: Fase 1 — Fondasi Double-Entry Accounting

Status: **Fondasi selesai, belum ada titik input yang memposting otomatis.**
Lihat `RANCANGAN-double-entry.md` §6 untuk peta fase lengkap (Fase 2–8).

## Kenapa fase ini "aman" dideploy sendiri
Tidak ada satu pun UI atau logika laporan yang ada sekarang (Bagi Hasil,
Neraca, Pajak, Rekap) yang disentuh atau bergantung pada tabel baru ini.
Yang ditambahkan murni infrastruktur baru yang belum dipakai/dipicu oleh
apa pun — aman untuk di-deploy & dites dulu sebelum Fase 2 (Kas) mulai
memanggil `postJurnal()` dari titik input sungguhan.

## ⚠️ WAJIB dilakukan sebelum deploy kode ini
**Upload `database_rules_v7_akuntansi.json` ke Firebase Console dulu**,
menggantikan rules yang aktif sekarang. Tanpa ini, semua percobaan menulis
ke `jurnalUmum`, `daftarAkun`, atau `saldoAkunBulanan` akan ditolak Firebase
(permission denied) — beda dari perbaikan arsip sebelumnya yang tidak perlu
update rules sama sekali.

## File baru
- **`src/lib/akuntansiHelpers.js`** — inti logika akuntansi (tidak
  menyentuh Firebase/UI):
  - `DEFAULT_DAFTAR_AKUN` — Chart of Accounts seed (lihat
    RANCANGAN-double-entry.md §1 & §7 untuk daftar lengkap + alasan tiap
    akun, termasuk akun suspense `3199` untuk Modal Disetor yang belum
    dikonfirmasi).
  - `getTipeAkunDariKode(kode)`, `getNormalBalance(kode)` — baca tipe &
    normal balance dari kode akun (termasuk penanganan akun kontra `1290`
    Akumulasi Penyusutan).
  - `validateJurnal(baris)` — validasi wajib: minimal 2 baris, tidak boleh
    negatif, tidak boleh isi debit+kredit sekaligus di 1 baris, dan
    **total debit harus sama persis dengan total kredit**.
  - `buatEntryJurnal({...})` — bikin 1 entry jurnal siap-simpan; **throw
    Error** kalau tidak balance (gagal keras, bukan diam-diam menyimpan
    entry timpang — ini yang membedakan dari masalah Laba Ditahan-plug lama).
  - `buatEntryPembalik(entryLama)` — bikin entry pembalik (debit↔kredit
    ditukar) untuk void/reversal, TANPA menghapus entry lama (audit trail
    utuh).

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/dataHelpers.js` | `jurnalUmum` ditambahkan ke `LIST_TABLES`, dipartisi per tahun (field `.tanggal`, lewat `kontrolYearOf()` yang sudah ada) |
| `src/hooks/useDB.js` | Generalisasi semua penanganan khusus `"kontrol"` (di `addRecord`/`updateRecord`/`deleteRecord`/`save`) supaya juga berlaku untuk `"jurnalUmum"`; listener baca baru untuk `jurnalUmum` (partisi tahun, versi disederhanakan — lihat catatan di kode); `daftarAkun` & `saldoAkunBulanan` diperlakukan sebagai config object (pola sama seperti `bagiHasilConfig`); fungsi baru `postJurnal()`, `voidJurnal()`, `seedDaftarAkunJikaKosong()`; `restoreBackup()`/`resetDB()` diupdate ikut mencakup tabel-tabel baru |
| `src/config/dbEmpty.js` | Default kosong untuk `jurnalUmum`/`daftarAkun`/`saldoAkunBulanan` |
| `src/App.jsx` | `useEffect` baru: auto-seed `daftarAkun` dari `DEFAULT_DAFTAR_AKUN` **sekali saja** kalau masih kosong, digerbangi `isAdmin` |

## File rules baru
`database_rules_v7_akuntansi.json` — superset dari `database_rules_v6_neraca.json`
ditambah 3 path baru:
- `jurnalUmum/{tahun}/{id}` — Admin/Manajer write, validasi tiap baris (debit/kredit non-negatif, tidak boleh dua-duanya diisi).
- `daftarAkun/{kode}` — Admin/Manajer write, validasi field `nama`+`tipe` wajib ada.
- `saldoAkunBulanan/{bulan}/{kode}` — Admin/Manajer write, validasi field saldo wajib lengkap.

## Catatan desain penting
- **Kode akun (4 digit) = kunci teknis tetap**, tidak boleh berubah — dipakai
  mesin posting. **Nama akun** sepenuhnya bisa diedit per white-label lewat
  `daftarAkun/{kode}.nama` tanpa menyentuh logika.
- **Dimensi wilayah** (bukan sub-akun literal) — breakdown per wilayah nanti
  memakai field `dimensi.wilayahId` di tiap baris jurnal, bukan kode akun
  baru per wilayah, supaya Chart of Accounts stabil lintas klien white-label.
- **Volume `jurnalUmum` di Fase 1** dibaca dengan `onValue` per tahun
  (bukan listener inkremental child_added/changed/removed seperti `kontrol`)
  — lebih sederhana, cukup untuk volume saat ini. Bisa di-upgrade ke pola
  `kontrol` kalau nanti volumenya membesar signifikan.

## Yang BELUM dikerjakan (Fase 2 dst)
Tidak ada satu titik input pun (Kas, Kontrol, Aset, Hutang/Piutang) yang
memanggil `postJurnal()` secara otomatis — jurnal baru akan ada kalau
dipanggil manual/lewat kode lain. Chart of Accounts juga belum ada UI untuk
mengedit nama/menambah akun (baru bisa diedit langsung lewat Firebase
Console kalau dibutuhkan sekarang). Ini menyusul di fase berikutnya sesuai
peta di `RANCANGAN-double-entry.md` §6.
