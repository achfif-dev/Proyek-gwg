# Perubahan: Fase 3 — Posting Kontrol & Penjualan Luar Rute

Status: **Selesai.** Penjualan (sumber Pendapatan terbesar di app ini) sekarang
otomatis memposting jurnal. Lihat `RANCANGAN-double-entry.md` §6 untuk peta
fase lengkap.

## Yang berubah secara perilaku
- **Kontrol** (kunjungan sales ke toko) — jurnal diposting **hanya saat status
  `"disetujui"`** (baik disetujui manual, otomatis 24 jam, atau approve
  pengajuan hapus dibatalkan/ditolak). Entri yang masih `"menunggu"` atau
  `"ditolak"` TIDAK memposting apa pun. Edit/approve ulang → jurnal lama
  di-void, jurnal baru diposting dari data terbaru. Dihapus (langsung atau
  lewat pengajuan yang disetujui) → jurnal di-void.
- **Penjualan Luar Rute** — tidak ada alur persetujuan (langsung final saat
  disimpan), jadi posting sekali saat ditambahkan, void saat dihapus.
- Satu record kontrol/penjualanLuar bisa menjual **banyak produk sekaligus**
  → dijadikan **1 entry jurnal gabungan** (bukan per-produk), supaya
  `jurnalUmum` tidak kebanjiran ribuan entry kecil per hari.

## File yang diubah
| File | Perubahan |
|---|---|
| `src/lib/akuntansiHelpers.js` | + `hitungTotalKontrol()` (internal), `bangunBarisJurnalKontrol()`, `bangunBarisJurnalPenjualanLuar()` |
| `src/features/kontrol/TabKontrol.jsx` | + `jurnalAktifUntukSumber()`, `voidJurnalSumber()`, `syncJurnalKontrol()`, `postJurnalPenjualanLuar()` — dipanggil dari semua titik simpan/approve/tolak/hapus kontrol & penjualan luar rute |
| `src/App.jsx` | `postJurnal`, `voidJurnal`, `createdBy` diteruskan ke `TabKontrol` |

## Logika jurnal per record
1 record kontrol/penjualanLuar dijumlah dulu jadi 3 angka:
- **Revenue** = Σ(`terjual_{produkId}` × `produk.harga`)
- **HPP** = Σ(`terjual_{produkId}` × `produk.hargaModal`)
- **Nilai Bonus** = Σ(`bonusInput_{produkId}` × `produk.hargaModal`)

Lalu diposting (baris yang nilainya 0 dilewati, bukan dipaksa masuk):

| | Kontrol (konsinyasi) | Penjualan Luar Rute |
|---|---|---|
| Revenue | Dr **1102** Piutang Usaha / Kr **4101** Pendapatan Konsinyasi | Dr **1101** Kas / Kr **4102** Pendapatan Luar Rute |
| HPP | Dr **5101** HPP / Kr **1111** Persediaan Toko | sama |
| Bonus | Dr **5103** Beban Bonus/Insentif / Kr **1111** Persediaan Toko | sama |

Kalau ketiganya 0 (kunjungan tanpa penjualan sama sekali) → **tidak
memposting apa pun** (bukan error, memang tidak ada yang perlu dijurnal).

## ⚠️ Keterbatasan yang disengaja/diwarisi
- **Kontrol diasumsikan KREDIT** (toko bayar belakangan lewat Kas Opname
  kategori "Setoran Penjualan Konsinyasi", sudah dipetakan balik ke akun
  `1102` sejak Fase 2) — bukan tunai langsung.
- **Penjualan Luar Rute diasumsikan TUNAI** (langsung ke Kas `1101`), karena
  tidak ada toko/pihak spesifik yang berpiutang dengannya. Kalau ternyata
  praktiknya ada yang dibayar belakangan juga, mapping ini perlu direvisi —
  saat ini belum ada field di form yang membedakan tunai/kredit untuk
  penjualan luar rute.
- **HPP pakai fallback 0** kalau `produk.hargaModal` belum diisi Admin —
  SAMA PERSIS keterbatasan yang sudah ada di `hitungHppPeriode()`
  (`neracaHelpers.js`, dipakai Laporan Laba Rugi lama). Bukan bug baru,
  mewarisi keterbatasan yang sudah diketahui di app ini — HPP & Persediaan
  di jurnal bisa understate kalau data Harga Modal produk belum lengkap.

## Yang BELUM disentuh
Aset & Amortisasi, Hutang/Piutang (sisi pengakuan awal), Dana Cadangan, dan
Tutup Buku — masih pakai perhitungan lama. Menyusul di Fase 4–7. Fase 8
(mengganti `NeracaKeuangan.jsx` untuk membaca dari saldo akun, bukan
hitung-ulang manual) baru masuk akal setelah semua sumber jurnal selesai.
