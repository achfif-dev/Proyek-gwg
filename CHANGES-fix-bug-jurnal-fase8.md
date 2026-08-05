# Perbaikan: 3 Bug di Double-Entry Accounting (ditemukan saat audit Fase 8)

Status: **Selesai — perlu 3 langkah manual untuk deploy** (lihat di bawah).

## Bug yang diperbaiki

### 1. Rule Firebase `jurnalUmum` tidak cocok dengan siapa yang memicu posting
Sales bisa memicu `postJurnal()` lewat submit "Penjualan Luar Rute" dan lewat
auto-approve Kontrol 24 jam (jalan di sesi siapa pun yang sedang online) —
tapi rule lama membatasi tulis `jurnalUmum` hanya Admin/Manajer. Akibatnya
jurnal dari kedua jalur ini ditolak Firebase secara diam-diam (state lokal
sempat menampilkannya karena `addRecord` optimistic, tapi tidak pernah
tersimpan ke server).

**Fix**: `database_rules_v8_fix.json` — `.write` di `jurnalUmum/$tahun/$id`
sekarang juga mengizinkan Sales, **dibatasi hanya** untuk
`sumberTipe === 'kontrol'` atau `'penjualanLuar'` (bukan akses penuh seperti
Admin/Manajer).

### 2. Path `jurnalYearsIndex` tidak punya rule sama sekali
Setiap `postJurnal()` (dari modul APA PUN) juga menulis ke
`jurnalYearsIndex/{tahun}`, path yang tidak pernah didefinisikan di
`database_rules_v7_akuntansi.json` — selalu ditolak Firebase (termasuk untuk
Admin), memicu banner "writeDenied" di SETIAP posting jurnal walau data
jurnal utamanya sendiri tetap tersimpan (path terpisah). Field ini juga
ternyata tidak pernah dibaca di kode manapun.

**Fix**: `database_rules_v8_fix.json` — tambah rule `jurnalYearsIndex`
(pola sama dengan `kontrolYearsIndex` yang sudah ada).

### 3. Kunci Tutup Buku tidak berlaku untuk Aset & Kontrol/Penjualan Luar Rute
`cekKunci()` (penolakan submit ke bulan yang sudah ditutup buku) sebelumnya
hanya dipasang di Kas, Stock Opname, & Hutang/Piutang — tidak ada sama
sekali di `submitAset()` maupun di `TabKontrol.jsx`. Akibatnya transaksi
bertanggal di bulan yang sudah di-snapshot (`saldoAkunBulanan`, Fase 7) bisa
tetap diposting/diedit/dihapus, dan karena `hitungSaldoAkunTerkini()` (mesin
"Neraca versi Jurnal", Fase 8) hanya menjumlah jurnal SETELAH bulan tertutup
terakhir, entry semacam ini jadi permanen tidak terhitung — saldo di kartu
perbandingan diam-diam meleset tanpa peringatan apa pun.

**Fix**:
- `NeracaKeuangan.jsx` — `submitAset()` & tombol hapus Aset sekarang
  memanggil `cekKunci()` seperti modul lain.
- `TabKontrol.jsx` — fungsi baru `cekTutupBuku()` (pola sama dengan
  `cekKunci()`) dipasang di:
  - `submit()` (tambah/edit Kontrol) & `submitLuarRute()` — pengecekan
    interaktif SEBELUM data tersimpan.
  - `setujuiKontrolPengajuan()` (approve manual) & kedua titik hapus
    Kontrol — dicegah kalau bulan sudah tertutup.
  - `syncJurnalKontrol()` & `postJurnalPenjualanLuar()` — jaring pengaman
    terakhir (silent skip + `console.warn`, TANPA alert) supaya jalur
    non-interaktif seperti auto-approve 24 jam tidak pernah lolos memposting
    jurnal ke periode yang sudah terkunci.

## File yang diubah
| File | Perubahan |
|---|---|
| `database_rules_v7_akuntansi.json` → `database_rules_v8_fix.json` | Rule `jurnalUmum` (+ Sales scoped), rule baru `jurnalYearsIndex` |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `cekKunci()` di `submitAset()` & hapus Aset |
| `src/features/kontrol/TabKontrol.jsx` | Import `isPeriodeTerkunci`/`bulanKeyOf`, fungsi baru `cekTutupBuku()`, dipasang di 6 titik (lihat di atas) |

## Langkah deploy (WAJIB urut)
1. **Upload `database_rules_v8_fix.json` ke Firebase Console → Realtime
   Database → Rules dulu**, sebelum kode baru dipakai — kalau tidak, Sales
   yang mencoba submit Penjualan Luar Rute akan tetap kena permission
   denied sampai rule-nya ter-update.
2. Ganti isi `src/features/bagihasil/NeracaKeuangan.jsx` dan
   `src/features/kontrol/TabKontrol.jsx` di GitHub dengan versi yang sudah
   diperbaiki (atau tempel diff-nya secara manual per bagian kalau ada
   perubahan lain yang belum di-pull).
3. Biarkan GitHub Actions build & deploy APK/hosting seperti biasa.

## Yang BELUM ditangani (di luar cakupan 3 bug ini)
- `jurnalUmum` masih live-sync cuma 1 tahun (`KONTROL_LIVE_YEARS`) — belum
  masalah sekarang (data baru mulai 2026), tapi perlu diantisipasi sebelum
  pergantian tahun pertama tanpa Tutup Buku.
