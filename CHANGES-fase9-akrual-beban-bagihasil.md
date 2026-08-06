# Perubahan: Fase 9 — Akrual Beban Usaha & Pengakuan Kewajiban Bagi Hasil

Status: **Selesai.** Dibangun berdasarkan 3 keputusan eksplisit yang
menjawab 3 temuan di `AUDIT-integrasi-neraca-bagihasil-pajak.md`:
1. Pendapatan **historical cost** (sudah benar sejak Fase 3 — tidak berubah).
2. Beban Usaha diposting **otomatis** (bukan cuma asumsi seperti sistem lama).
3. Kewajiban Bagi Hasil dapat **Fase pengakuan baru** (bukan cuma didebit
   saat dicairkan tanpa pernah dikredit).

## Akun baru
| Kode | Nama | Tipe |
|---|---|---|
| `2140` | Hutang Beban Usaha (Accrued) | Kewajiban |

## 1. Akrual Beban Usaha (Temuan 2)

Setiap **Tutup Buku**, sistem sekarang memposting: `Dr 5102 Beban
Operasional (total dari config.bebanUsaha[]) / Kr 2140 Hutang Beban Usaha`
— dilakukan di titik yang sama dengan Amortisasi & Dana Cadangan (proses
akhir periode, bukan per-transaksi).

**Perubahan penting**: kategori Kas "Biaya Operasional" (sejak Fase 2)
**tidak lagi men-debit `5102` langsung** — sekarang melunasi `2140` (Dr
2140, Kr Kas). Ini WAJIB supaya tidak dobel-hitung beban yang sama (sekali
saat diakui otomatis, sekali lagi saat benar-benar dibayar).

⚠️ **Kalau ada pengeluaran operasional yang genuinely di luar anggaran
bulanan** (bukan bagian dari `config.bebanUsaha` yang diakui otomatis),
membayarnya lewat kategori Kas "Biaya Operasional" akan membuat saldo
`2140` **negatif sementara** — ini bukan error, tapi sinyal untuk ditinjau
(sama pola dengan `2120`/`2110`).

## 2. Pengakuan Kewajiban Bagi Hasil (Temuan 3)

Setiap **Tutup Buku**, sistem menghitung **Laba (Rugi) BULAN INI versi
JURNAL** (historical cost — dijumlah langsung dari entry `jurnalUmum` bulan
itu SENDIRI, termasuk akrual Beban Usaha & Amortisasi yang baru saja
diposting — BUKAN dari `akuntansi.labaBersihFinal` sistem lama yang
live-recalculate harga & Beban Usahanya cuma asumsi), lalu mengalokasikan
ke tiap pihak (`config.pihak[]`, field `basis`+`pct` — sama seperti sistem
lama) dan memposting: `Dr 3102 Laba Ditahan (total) / Kr 2120 Hutang Bagi
Hasil` — **satu baris kredit per pihak**, masing-masing ditandai
`dimensi.pihakId` (bukan akun baru per pihak — konsisten dengan prinsip
dimensi wilayah di `RANCANGAN-double-entry.md` §7.1).

**Dampak ke "Cairkan ke Kas"**: `cairkanKeKas()` (TabBagiHasil.jsx, sudah
ada sejak sebelumnya) TIDAK berubah kodenya — tapi sekarang **benar-benar
make sense**, karena `2120` yang di-debit saat pencairan sudah punya saldo
kredit dari pengakuan di atas, bukan langsung negatif dari nol seperti
sebelumnya.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + akun `2140`; `KATEGORI_KAS_KELUAR_AKUN["Biaya Operasional"]` diubah `5102`→`2140`; + `bangunBarisJurnalAkrualBebanUsaha()`, `bangunBarisJurnalPengakuanBagiHasil()`; `buatEntryJurnal()` sekarang mempertahankan field opsional `dimensi` per baris |
| `src/features/bagihasil/NeracaKeuangan.jsx` | `tutupBukuBulanIni()` posting akrual Beban Usaha + pengakuan Bagi Hasil (setelah Amortisasi & Dana Cadangan, sebelum snapshot); `bukaKunciBulan()` void keduanya |

## Field baru: `dimensi` (opsional) di baris jurnal
```json
{ "akun": "2120", "debit": 0, "kredit": 1500000, "dimensi": { "pihakId": "P1", "pihakNama": "Pemilik Utama" } }
```
Dipakai untuk breakdown Kewajiban Bagi Hasil per pihak TANPA menambah kode
akun baru. Firebase Rules (v9) tidak perlu diupdate — validasi baris jurnal
sudah pakai `hasChildren([...])` (memastikan field WAJIB ada), bukan daftar
tertutup, jadi field tambahan seperti `dimensi` otomatis diizinkan.

## Urutan posting di Tutup Buku (lengkap, setelah Fase 9)
1. Snapshot `tutupBuku` (existing).
2. Amortisasi Aset (Fase 4).
3. Apropriasi Dana Cadangan — increment (Fase 6).
4. **Akrual Beban Usaha (Fase 9, BARU)**.
5. **Pengakuan Kewajiban Bagi Hasil (Fase 9, BARU)** — dihitung SETELAH
   langkah 2 & 4 supaya Amortisasi & Beban Usaha ikut mengurangi laba
   sebelum dibagi ke pihak.
6. Snapshot saldo akun bulanan (Fase 7) — sekarang mencakup ke-4 jurnal di
   atas.

## Yang BELUM disentuh
- UI Ringkasan Bagi Hasil (`akuntansi`/`revPeriode`) TIDAK diubah — masih
  menampilkan angka sistem lama (live-recalculate). Card "Neraca versi
  Jurnal" (Fase 8) sekarang akan menunjukkan angka yang BERBEDA dan
  **lebih akurat secara historical cost** — ini disengaja, bukan bug,
  sesuai Opsi B (dibandingkan, belum menggantikan).
- Migrasi penuh UI Bagi Hasil/Pajak untuk membaca dari jurnal (Fase 8
  Opsi A) — belum dikerjakan, masih perlu keputusan terpisah.

---

## Fase 9b — Laporan Pajak: Historical Cost (menyusul, melengkapi Fase 9)

Di atas ditulis "Pendapatan historical cost — sudah benar sejak Fase 3,
tidak berubah". Itu benar untuk **jurnal & Pengakuan Kewajiban Bagi Hasil**
— tapi **Laporan Pajak (`LaporanPajak.jsx`) ternyata masih 100% baca dari
`akuntansi` sistem lama** (`akuntansi.pendapatan`/`akuntansi.labaKotor`,
live-recalculate pakai harga produk SAAT INI, bukan harga saat transaksi).
Kalau harga produk diedit, angka Pajak untuk bulan-bulan lama bisa berubah
retroaktif — tidak konsisten dengan keputusan historical cost yang sudah
disepakati. Celah ini ditutup terpisah:

- **`src/lib/akuntansiHelpers.js`** — fungsi baru `hitungAkuntansiHistoris(bounds,
  jurnalUmumArr)`: hitung Pendapatan (akun 4101+4102+4103) & Laba Kotor
  (Pendapatan − HPP akun 5101) untuk **periode apa pun** yang sedang
  difilter di Tab Bagi Hasil (bukan cuma bulan yang ditutup buku seperti
  fungsi Fase 9 di atas), murni dari `jurnalUmum`.
- **`src/features/bagihasil/TabBagiHasil.jsx`** — `akuntansiHistoris`
  dihitung via `useMemo` dari `bounds`+`db.jurnalUmum`, diteruskan ke
  `<LaporanPajak akuntansi={akuntansiHistoris} .../>` **menggantikan**
  `akuntansi` (sistem lama). `revPeriode` tetap diteruskan apa adanya
  (dipakai untuk keperluan lain di Pajak, bukan Omzet/PKP).
- **`src/features/bagihasil/LaporanPajak.jsx`** — 1 kalimat tambahan di
  disclaimer card yang sudah ada, menjelaskan basis historical cost & bahwa
  cuma penjualan **berstatus disetujui** yang terhitung.

**Dampak**: Omzet & Estimasi PKP di Laporan Pajak sekarang beku sesuai
harga transaksi & basis akrual (hanya Kontrol disetujui) — **tidak lagi
otomatis identik dengan Ringkasan Bagi Hasil** (yang masih sistem lama).
Beban Usaha/Amortisasi/Dana Cadangan di Pajak masih dari `akuntansi` lama
untuk sementara (`hitungAkuntansiHistoris` baru mencakup 2 field yang
benar-benar dipakai `LaporanPajak.jsx`).

Rules Firebase tidak perlu diupdate untuk bagian ini (cuma membaca
`jurnalUmum`, tidak menulis path baru).
