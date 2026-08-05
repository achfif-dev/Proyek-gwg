# Perbaikan: Bug Kritis — Fase 2/4/5/6/7 Tidak Pernah Posting Sama Sekali

Status: **Selesai.** Ditemukan lewat audit lanjutan (diminta setelah fix bug
Fase 8 sebelumnya), sebelum Tab Bagi Hasil sempat dipakai serius — jadi
belum ada dampak ke data produksi.

## Bug #1 (KRITIS): `TabBagiHasil.jsx` tidak meneruskan `postJurnal`/`voidJurnal`/`createdBy`

`App.jsx` sudah mengirim ketiga prop ini ke `<TabBagiHasil>`, TAPI function
signature `TabBagiHasil({ db, analytics, ... })` **tidak pernah
men-destructure-nya** — jadi prop itu ada di objek yang diterima tapi tidak
pernah "diambil" untuk dipakai/diteruskan. Akibatnya `<NeracaKeuangan
postJurnal={postJurnal} .../>` di dalam `TabBagiHasil.jsx` sebenarnya
mengirim `postJurnal={undefined}`.

**Dampak**: SEMUA posting di `NeracaKeuangan.jsx` dibungkus `if (postJurnal)
{...}` (pola "aman gagal" yang sengaja dipasang supaya fitur lama tidak
terhambat) — begitu `postJurnal` selalu `undefined`, kondisi itu SELALU
false, dan blok posting-nya TIDAK PERNAH JALAN. Ini melumpuhkan **Fase 2
(Kas), Fase 4 (Aset), Fase 5 (Hutang/Piutang), Fase 6 (Dana Cadangan), Fase
7 (snapshot saldo bulanan)** — hanya Fase 3 (Kontrol & Penjualan Luar Rute,
di-wire terpisah lewat `TabKontrol.jsx`) yang benar-benar memposting jurnal.

**Fix**: `TabBagiHasil({ ..., postJurnal, voidJurnal, createdBy })` — tambah
ke destructuring, dan diteruskan ke `<NeracaKeuangan>`.

## Bug #2: "Cairkan ke Kas" (Bagi Hasil) tidak pernah posting jurnal

`cairkanKeKas()`/`batalkanPencairan()` menulis `kasTransaksi` **langsung**
via `addRecord`, bukan lewat `submitKas()` di `NeracaKeuangan.jsx` — jadi
walau Bug #1 diperbaiki, fungsi ini TETAP tidak akan posting jurnal karena
memang tidak pernah memanggil `postJurnal` sejak ditulis (kode yang
sepenuhnya terpisah dari alur Kas Opname biasa).

**Fix**: `cairkanKeKas()` sekarang memposting `Dr 2120 Kewajiban Bagi Hasil
/ Kr 1101 Kas` (pakai `bangunBarisJurnalKas()`, kategori "Pencairan Bagi
Hasil" — mapping yang sudah ada sejak Fase 2 tapi belum pernah kepakai).
`batalkanPencairan()` sekarang ikut membatalkan (void) jurnal terkait
sebelum menghapus record Kas & log distribusinya.

## ⚠️ Keterbatasan yang BELUM diperbaiki (butuh desain baru, bukan sekadar bug)
Akun `2120 Kewajiban Bagi Hasil` di-**debit** saat dicairkan, tapi **tidak
pernah di-kredit** lebih dulu — belum ada jurnal yang mengakui kewajiban ini
saat SHU dihitung/difinalisasi (beda dari Dana Cadangan yang sudah ada
Fase 6 khusus untuk itu). Efeknya: saldo `2120` bisa terlihat **negatif**
untuk sementara. Ini bukan bug, tapi keterbatasan desain yang perlu fase
tambahan kalau mau benar-benar rapi (mis. "Fase 9 — Pengakuan Kewajiban
Bagi Hasil saat SHU final").

## File yang diubah
| File | Perubahan |
|---|---|
| `src/features/bagihasil/TabBagiHasil.jsx` | + `postJurnal, voidJurnal, createdBy` di signature & diteruskan ke `NeracaKeuangan`; `cairkanKeKas()`/`batalkanPencairan()` posting/void jurnal |

## Cara verifikasi setelah deploy
1. Buka Laporan Neraca → Kas Opname → tambah 1 transaksi. Cek
   `gwg_data/shared/jurnalUmum/{tahun}` di Firebase Console — HARUS muncul
   entry baru (sebelumnya TIDAK akan muncul sama sekali, ini pengetesan
   yang paling penting).
2. Tambah Aset baru → cek juga jurnal perolehannya muncul.
3. Di sub-tab Ringkasan, klik "Cairkan ke Kas" untuk 1 pihak → cek jurnal
   `Dr 2120 / Kr 1101` muncul.
4. Expand card "🧪 Neraca (versi Jurnal)" di Laporan Neraca — sekarang
   seharusnya menunjukkan saldo yang jauh lebih lengkap dibanding sebelum
   fix ini (sebelumnya cuma berisi kontribusi dari Kontrol/Penjualan Luar
   Rute saja).
