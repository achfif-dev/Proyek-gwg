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
  // ✅ FASE 1 DOUBLE-ENTRY ACCOUNTING (lihat RANCANGAN-double-entry.md):
  jurnalUmum: [], // dipartisi per tahun di Firebase (lihat kontrolYearOf), tapi tetap array flat di state lokal — sama pola dengan "kontrol"
  daftarAkun: null, // Chart of Accounts — diseed dari DEFAULT_DAFTAR_AKUN (akuntansiHelpers.js) saat pertama kali kosong
  saldoAkunBulanan: null, // snapshot saldo per akun per bulan, diisi saat Tutup Buku (Fase 7)
};

// ─────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────
