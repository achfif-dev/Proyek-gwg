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

// Jumlah bulan (inklusif, granularitas bulanan — sama seperti proration
// Amortisasi di atas) yang tercakup dalam periode terpilih. Dipakai untuk
// men-scale item Beban Usaha yang bersifat BULANAN (mis. Gaji, Biaya
// Operasional rutin) supaya laporan Tahunan/Kustom otomatis mengalikan
// nominal bulanan tsb × jumlah bulan periode — bukan cuma dijumlah 1x
// seperti nominal itu berlaku utuh untuk periode berapa pun panjangnya.
// Mode "bulanan" & "tahunan" selalu pas bulan penuh (lihat periodeBounds),
// jadi hasilnya presisi (1 / 12). Mode "kustom" pakai tanggal bebas —
// di sini tetap dihitung berbasis bulan kalender yang disentuh (inklusif),
// konsisten dengan cara Amortisasi menghitung overlap bulan aset.
export function hitungJumlahBulanPeriode(bounds) {
  const pStart = ymOf(bounds?.start);
  const pEnd = ymOf(bounds?.end);
  if (pStart === null || pEnd === null) return 0;
  return Math.max(0, pEnd - pStart + 1);
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

// Estimasi HPP (Harga Pokok Penjualan) terjual pada periode terpilih, dari
// field opsional `hargaModal` di Produk (default 0 kalau belum diisi —
// artinya belum bisa dihitung akurat, ditandai `terisi:false` per produk).
export function hitungHppPeriode(revPeriode, produkArr) {
  let totalHpp = 0, totalPendapatan = 0, adaYangBelumIsi = false;
  const detail = (produkArr || []).map(p => {
    const terjual = (revPeriode?.rows || []).reduce((s, k) => s + (k[`terjual_${p.id}`] || 0), 0)
      + (revPeriode?.luarRows || []).reduce((s, k) => s + (k[`terjual_${p.id}`] || 0), 0);
    const hargaModal = Number(p.hargaModal) || 0;
    const terisi = p.hargaModal !== undefined && p.hargaModal !== null && p.hargaModal !== "";
    if (terjual > 0 && !terisi) adaYangBelumIsi = true;
    const hpp = terjual * hargaModal;
    const rev = terjual * (Number(p.harga) || 0);
    totalHpp += hpp; totalPendapatan += rev;
    return { produkId: p.id, nama: p.nama, terjual, hargaModal, hpp, rev, terisi };
  });
  return { totalHpp, totalPendapatan, labaKotorRiil: totalPendapatan - totalHpp, adaYangBelumIsi, detail };
}

// ── Tutup Buku (kunci periode) ──────────────────────────────────────────
// Format id/kunci periode tertutup selalu "YYYY-MM" (granularitas bulanan,
// standar akuntansi). Dipakai untuk mengunci Kas, Stock Opname, & Hutang/
// Piutang supaya data bulan yang sudah "ditutup" tidak berubah tanpa sengaja.
export function bulanKeyOf(dateStr) {
  return (dateStr || "").slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
}
export function isPeriodeTerkunci(tutupBukuArr, dateStr) {
  const key = bulanKeyOf(dateStr);
  return (tutupBukuArr || []).some(t => t.id === key);
}

// Migrasi 1x-pakai dari 4 field Biaya lama (biayaOperasional/biayaBonus/
// biayaLogistik/biayaLainnya) ke format list Beban Usaha yang baru & lebih
// fleksibel. Dipanggil sebagai FALLBACK live (tidak otomatis tersimpan)
// selama config.bebanUsaha belum pernah di-set — begitu Admin membuka &
// menyimpan Konfigurasi sekali, hasil migrasi ini permanen tersimpan.
export function migrasiBebanUsahaLama(cfg) {
  const items = [];
  if (Number(cfg?.biayaOperasional)) items.push({ id: "BU_MIG_1", nama: "Biaya Operasional", nominal: Number(cfg.biayaOperasional), frekuensi: "bulanan" });
  if (Number(cfg?.biayaBonus)) items.push({ id: "BU_MIG_2", nama: "Biaya Bonus Produk", nominal: Number(cfg.biayaBonus), frekuensi: "bulanan" });
  if (Number(cfg?.biayaLogistik)) items.push({ id: "BU_MIG_3", nama: "Biaya Logistik/Distribusi", nominal: Number(cfg.biayaLogistik), frekuensi: "bulanan" });
  if (Number(cfg?.biayaLainnya)) items.push({ id: "BU_MIG_4", nama: "Biaya Lainnya", nominal: Number(cfg.biayaLainnya), frekuensi: "bulanan" });
  return items;
}

// Kewajiban Dana Cadangan (opsional, per white-label bisa beda kebijakan):
// sekian Rupiah per pcs terjual disisihkan sebagai "kewajiban" perusahaan.
// Versi PERIODE (mengurangi SHU yang bisa dibagi periode berjalan):
export function hitungDanaCadanganPeriode(terjualTotalPeriode, danaCadanganCfg) {
  if (!danaCadanganCfg?.aktif) return 0;
  return (Number(terjualTotalPeriode) || 0) * (Number(danaCadanganCfg.rpPerPcs) || 0);
}
// Versi KUMULATIF ALL-TIME (buat baris Kewajiban di Laporan Neraca) — jumlah
// dari SELURUH transaksi terjual sepanjang sejarah aplikasi, bukan cuma
// periode yang sedang difilter.
//
// ⚠️ `kontrolArr` yang diteruskan ke sini (analytics.kontrol / db.kontrol)
// HANYA berisi tahun-tahun yang sedang termuat di state aktif — begitu
// sebuah tahun diarsipkan ke Google Drive (lihat useDB.js → archiveKontrolYear)
// dan dihapus dari RTDB, tahun itu otomatis hilang dari array ini walau
// datanya masih ada (di Drive). Supaya total tetap "all-time" yang benar,
// parameter `arsipPcsTerjual` (total pcs dari tahun-tahun yang sudah
// diarsipkan, dijumlah dari kontrolArchiveIndex/{tahun}.totalTerjualTahun —
// lihat useDB.js → archivedKontrolAgregat) WAJIB ditambahkan di sini.
export function hitungDanaCadanganKumulatif(kontrolArr, penjualanLuarArr, danaCadanganCfg, arsipPcsTerjual) {
  if (!danaCadanganCfg?.aktif) return 0;
  const totalPcs = (kontrolArr || []).reduce((s, k) => s + (k.totalTerjual || 0), 0)
    + (penjualanLuarArr || []).reduce((s, k) => s + (k.totalTerjual || 0), 0)
    + (Number(arsipPcsTerjual) || 0);
  return totalPcs * (Number(danaCadanganCfg.rpPerPcs) || 0);
}

// ── Stok Gudang Pusat ────────────────────────────────────────────────────
export const KATEGORI_GUDANG_MASUK = ["Pembelian/Produksi Baru", "Retur dari Toko", "Penyesuaian Tambah", "Lainnya"];
export const KATEGORI_GUDANG_KELUAR = ["Distribusi ke Toko/Sales", "Rusak/Hilang/Kadaluarsa", "Penyesuaian Kurang", "Lainnya"];

// Stok gudang saat ini per produk = kumulatif semua transaksi masuk − keluar.
export function hitungStokGudang(gudangArr, produkArr) {
  const map = {};
  (produkArr || []).forEach(p => { map[p.id] = 0; });
  (gudangArr || []).forEach(t => {
    if (map[t.produkId] === undefined) map[t.produkId] = 0;
    map[t.produkId] += t.tipe === "masuk" ? (Number(t.qty) || 0) : -(Number(t.qty) || 0);
  });
  return map;
}

// Nilai Persediaan (dipakai di Laporan Neraca, Aset Lancar) = (Stok Gudang +
// Stok Toko/Beredar) × harga per unit. Diprioritaskan pakai Harga Modal/HPP
// (nilai wajar akuntansi persediaan); kalau produk belum diisi HPP, fallback
// ke Harga Jual supaya tetap ada angka (ditandai kurang akurat).
export function nilaiPersediaanGabungan(stokGudangMap, stokTokoMap, produkArr) {
  let totalNilai = 0, adaFallbackHarga = false;
  const detail = (produkArr || []).map(p => {
    const qtyGudang = Number(stokGudangMap[p.id]) || 0;
    const qtyToko = Number(stokTokoMap[p.id]) || 0;
    const qtyTotal = qtyGudang + qtyToko;
    const hargaModal = Number(p.hargaModal) || 0;
    const pakaiFallback = !hargaModal;
    if (pakaiFallback && qtyTotal > 0) adaFallbackHarga = true;
    const hargaDipakai = hargaModal || Number(p.harga) || 0;
    const nilai = qtyTotal * hargaDipakai;
    totalNilai += nilai;
    return { produkId: p.id, nama: p.nama, qtyGudang, qtyToko, qtyTotal, hargaDipakai, pakaiFallback, nilai };
  });
  return { totalNilai, adaFallbackHarga, detail };
}

export const KATEGORI_KAS_MASUK = ["Setoran Penjualan Konsinyasi", "Modal Investor", "Pinjaman Masuk", "Piutang Tertagih", "Pendapatan Lain-lain", "Lainnya"];
export const KATEGORI_KAS_KELUAR = ["Biaya Operasional", "Biaya Logistik/Distribusi", "Bonus/Insentif Sales", "Pencairan Bagi Hasil", "Pembelian Aset", "Pembayaran Pajak", "Pembayaran Hutang Usaha", "Pelunasan Pinjaman", "Lainnya"];
export const KATEGORI_ASET = ["Kendaraan", "Peralatan Toko/Display", "Sistem/Software", "Perlengkapan Kantor", "Lainnya"];
export const KATEGORI_HUTANG = ["Hutang Supplier", "Pinjaman Bank", "Pinjaman Investor", "Lainnya"];
export const KATEGORI_PIUTANG = ["Piutang Toko/Konsinyasi", "Piutang Karyawan", "Lainnya"];
