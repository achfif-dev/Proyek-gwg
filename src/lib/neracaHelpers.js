// ─────────────────────────────────────────────────────────────────────────
//  NERACA KEUANGAN — helper kalkulasi bersama
// ─────────────────────────────────────────────────────────────────────────
// Dipakai bareng oleh TabBagiHasil.jsx (untuk menyuntikkan Biaya Amortisasi
// ke Laporan Laba Rugi / SHU) dan NeracaKeuangan.jsx (untuk tampilan detail
// Kas Opname, Stock Opname, & Amortisasi Aset) — supaya rumusnya HANYA ada
// di satu tempat, tidak dihitung ulang beda cara di dua file berbeda.

// Ubah filter periode (mode bulanan/tahunan/kustom di Tab Bagi Hasil) jadi
// rentang tanggal string "YYYY-MM-DD" inklusif [start, end].
export function periodeBounds(mode, filterBulan, filterTahun, filterStart, filterEnd) {
  if (mode === "bulanan" && filterBulan) {
    const [y, m] = filterBulan.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // hari terakhir bulan itu
    return { start: `${filterBulan}-01`, end: `${filterBulan}-${String(lastDay).padStart(2,"0")}` };
  }
  if (mode === "tahunan" && filterTahun) {
    return { start: `${filterTahun}-01-01`, end: `${filterTahun}-12-31` };
  }
  return { start: filterStart, end: filterEnd };
}

// "YYYY-MM-DD" → indeks bulan absolut (tahun*12+bulan), dipakai untuk
// menghitung overlap bulan antara umur aset & periode laporan tanpa ribet
// urusan presisi hari (penyusutan garis lurus lazimnya dihitung per bulan).
function ymOf(dateStr) {
  if (!dateStr) return null;
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return null;
  return y * 12 + (m - 1);
}

// Total biaya amortisasi (penyusutan garis lurus) aset yang jatuh DALAM
// rentang periode terpilih — dengan proration bulanan (aset yang baru
// dibeli/habis umur di tengah periode hanya dihitung bulan yang overlap).
export function hitungAmortisasiPeriode(asetArr, bounds) {
  const pStart = ymOf(bounds?.start);
  const pEnd = ymOf(bounds?.end);
  let total = 0;
  const detail = [];
  (asetArr || []).forEach(a => {
    const nilaiPerolehan = Number(a.nilaiPerolehan) || 0;
    const nilaiResidu = Number(a.nilaiResidu) || 0;
    const umurBulan = Number(a.umurBulan) || 0;
    const assetStart = ymOf(a.tanggalPerolehan);
    if (assetStart === null || umurBulan <= 0 || pStart === null || pEnd === null) return;
    const perBulan = Math.max(0, (nilaiPerolehan - nilaiResidu)) / umurBulan;
    const assetEnd = assetStart + umurBulan - 1; // bulan terakhir umur aset (inklusif)
    const ovStart = Math.max(pStart, assetStart);
    const ovEnd = Math.min(pEnd, assetEnd);
    const bulanOverlap = Math.max(0, ovEnd - ovStart + 1);
    const nominal = bulanOverlap * perBulan;
    if (bulanOverlap > 0) total += nominal;
    detail.push({ ...a, perBulan, bulanOverlap, nominalPeriode: nominal });
  });
  return { total, detail };
}

// Status aset pada tanggal tertentu (default: hari ini) — dipakai baik di
// tabel daftar aset (asOf = hari ini) maupun Laporan Neraca (asOf = akhir
// periode terpilih, supaya Nilai Buku konsisten dengan tanggal neraca).
export function statusAsetSaatIni(aset, asOfDateStr) {
  const nilaiPerolehan = Number(aset.nilaiPerolehan) || 0;
  const nilaiResidu = Number(aset.nilaiResidu) || 0;
  const umurBulan = Number(aset.umurBulan) || 0;
  const assetStart = ymOf(aset.tanggalPerolehan);
  const asOf = asOfDateStr ? new Date(asOfDateStr) : new Date();
  const asOfYm = asOf.getFullYear() * 12 + asOf.getMonth();
  const perBulan = umurBulan > 0 ? Math.max(0, (nilaiPerolehan - nilaiResidu)) / umurBulan : 0;
  const bulanBerjalan = assetStart === null ? 0 : Math.min(Math.max(0, asOfYm - assetStart + 1), umurBulan);
  const akumulasi = bulanBerjalan * perBulan;
  const nilaiBuku = Math.max(nilaiResidu, nilaiPerolehan - akumulasi);
  const lunas = umurBulan > 0 && bulanBerjalan >= umurBulan;
  return { perBulan, bulanBerjalan, akumulasi, nilaiBuku, lunas };
}

// Total nilai Rp persediaan/stok konsinyasi yang beredar (Stok Sistem × Harga Jual per produk).
// Catatan: memakai harga JUAL karena aplikasi belum punya harga modal/HPP per produk
// — jadi ini estimasi nilai persediaan pada harga jual, bukan harga pokok sesungguhnya.
export function nilaiPersediaan(stokSistemMap, produkArr) {
  return (produkArr || []).reduce((s, p) => s + (Number(stokSistemMap[p.id]) || 0) * (Number(p.harga) || 0), 0);
}

// Ringkasan Hutang/Piutang: sisa = nominalAwal - terbayar, lunas otomatis kalau sisa <= 0.
export function ringkasanHutangPiutang(arr, tipe) {
  const rows = (arr || []).filter(x => x.tipe === tipe).map(x => {
    const nominalAwal = Number(x.nominalAwal) || 0;
    const terbayar = Number(x.terbayar) || 0;
    const sisa = Math.max(0, nominalAwal - terbayar);
    return { ...x, nominalAwal, terbayar, sisa, lunas: sisa <= 0 };
  });
  const totalOutstanding = rows.filter(r => !r.lunas).reduce((s, r) => s + r.sisa, 0);
  return { rows, totalOutstanding };
}

// Total stok konsinyasi yang SEDANG BEREDAR di semua toko per produk
// (sum field stok_{produkId} di tiap record toko) — dipakai sebagai "Stok
// Sistem" pembanding Stock Opname. Catatan: ini TIDAK termasuk stok gudang
// pusat, karena aplikasi ini memang belum punya modul gudang terpisah.
export function hitungStokSistem(tokoArr, produkArr) {
  const map = {};
  (produkArr || []).forEach(p => { map[p.id] = 0; });
  (tokoArr || []).forEach(t => {
    (produkArr || []).forEach(p => {
      map[p.id] = (map[p.id] || 0) + (Number(t[`stok_${p.id}`]) || 0);
    });
  });
  return map;
}

// Buku kas berjalan: urutkan transaksi kronologis, hitung saldo berjalan
// dari saldo awal. `uptoDate` (opsional, "YYYY-MM-DD") membatasi sampai
// tanggal berapa saldo dihitung (dipakai untuk saldo kas per akhir periode
// laporan Neraca, terpisah dari saldo kas TERKINI untuk Kas Opname).
export function hitungSaldoKas(kasArr, saldoAwal, uptoDate) {
  const rows = (kasArr || [])
    .filter(k => !uptoDate || (k.tanggal || "") <= uptoDate)
    .sort((a, b) => (a.tanggal || "").localeCompare(b.tanggal || "") || (a.id || "").localeCompare(b.id || ""));
  let saldo = Number(saldoAwal) || 0;
  const totalMasuk = rows.filter(k => k.tipe === "masuk").reduce((s, k) => s + (Number(k.nominal) || 0), 0);
  const totalKeluar = rows.filter(k => k.tipe === "keluar").reduce((s, k) => s + (Number(k.nominal) || 0), 0);
  const withRunning = rows.map(k => {
    saldo += k.tipe === "masuk" ? (Number(k.nominal) || 0) : -(Number(k.nominal) || 0);
    return { ...k, saldoBerjalan: saldo };
  });
  return { rows: withRunning, saldoAkhir: saldo, totalMasuk, totalKeluar };
}

export const KATEGORI_KAS_MASUK = ["Setoran Penjualan Konsinyasi", "Modal Investor", "Pinjaman Masuk", "Piutang Tertagih", "Pendapatan Lain-lain", "Lainnya"];
export const KATEGORI_KAS_KELUAR = ["Biaya Operasional", "Biaya Logistik/Distribusi", "Bonus/Insentif Sales", "Pencairan Bagi Hasil", "Pembelian Aset", "Pembayaran Pajak", "Pembayaran Hutang Usaha", "Pelunasan Pinjaman", "Lainnya"];
export const KATEGORI_ASET = ["Kendaraan", "Peralatan Toko/Display", "Sistem/Software", "Perlengkapan Kantor", "Lainnya"];
export const KATEGORI_HUTANG = ["Hutang Supplier", "Pinjaman Bank", "Pinjaman Investor", "Lainnya"];
export const KATEGORI_PIUTANG = ["Piutang Toko/Konsinyasi", "Piutang Karyawan", "Lainnya"];
