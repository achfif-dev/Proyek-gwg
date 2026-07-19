// ─────────────────────────────────────────────
//  KONFIGURASI TAB — daftar tab, aturan akses per role, dan tab aktif tersimpan
// ─────────────────────────────────────────────
export const SALES_ALLOWED_TABS = ["dashboard", "kontrol", "rekap", "toko"];

// Key sessionStorage untuk mengingat tab yang sedang aktif.
// SENGAJA pakai sessionStorage (bukan localStorage):
// - sessionStorage tetap ada selama TAB BROWSER ini masih terbuka, sehingga
//   refresh (baik tombol refresh di header maupun refresh bawaan browser,
//   yang keduanya memanggil window.location.reload()) akan tetap berada di
//   tab yang sama seperti sebelum di-refresh.
// - sessionStorage otomatis KOSONG lagi kalau tab/aplikasi ditutup lalu
//   dibuka ulang (sesi baru), dan juga sengaja DIHAPUS saat logout (lihat
//   fungsi logout di useAuth) — sehingga saat LOGIN ULANG, tampilan selalu
//   kembali otomatis ke Dashboard, bukan melanjutkan tab terakhir.
export const ACTIVE_TAB_SESSION_KEY = "gwg_active_tab";

export function getInitialActiveTab() {
  try {
    const saved = sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY);
    return saved || "dashboard";
  } catch {
    return "dashboard";
  }
}

export const TABS = [
  { key:"dashboard",  label:"📈 Dashboard" },
  { key:"wilayah",    label:"📍 Wilayah" },
  { key:"rute",       label:"🛣️ Rute" },
  { key:"toko",       label:"🏪 Toko" },
  { key:"produk",     label:"🧴 Produk" },
  { key:"kontrol",    label:"📋 Kontrol" },
  { key:"rekap",      label:"📑 Rekap" },
  { key:"bagihasil",  label:"💰 Bagi Hasil" },
  { key:"pengguna",   label:"👤 Pengguna" },
];

// Aturan akses tab berdasarkan role:
// - Admin & Manajer  → semua tab (termasuk Pengguna untuk Admin, lihat pengecualian di bawah)

export function canAccessTab(tabKey, { isAdmin, isManajer }) {
  if (tabKey === "pengguna") return isAdmin; // Pengguna selalu khusus Admin
  if (tabKey === "bagihasil") return isManajer; // Bagi Hasil hanya Admin & Manajer
  if (isManajer) return true; // Admin & Manajer bebas akses tab lain
  return SALES_ALLOWED_TABS.includes(tabKey); // Sales/Viewer/lainnya: dibatasi
}
