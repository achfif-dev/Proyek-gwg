export const DB_EMPTY = {
  wilayah: [],
  rute: [],
  toko: [],
  produk: [],
  kontrol: [],
  pengguna: [],
  penyesuaian: [], // Penyesuaian Stok di luar siklus kontrol rutin (tambah/kurang/tarik sebagian)
  penarikanToko: [], // Pengajuan Tarik/Non-Aktifkan Toko dari Sales — menunggu persetujuan Admin/Manajer (sama alurnya dengan penyesuaian & kontrol)
  penjualanLuar: [], // Penjualan Luar Rute: transaksi produk yang tokonya tidak diketahui/diingat sales saat kontrol
  stokAwal: {}, // { "tokoId_produkId_YYYY-MM": number }
  bagiHasilConfig: null, // konfigurasi bagi hasil
};

// ─────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────
