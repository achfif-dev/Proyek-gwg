// ─────────────────────────────────────────────
//  FONT CONFIG — daftar pilihan font aplikasi (White Label)
// ─────────────────────────────────────────────
// Memungkinkan Admin mengganti font tampilan aplikasi lewat Setup Wizard
// tanpa perlu edit kode/build ulang, mirip mekanisme warna brand di
// appConfig.js. Font dipilih dari daftar aman (readable, mendukung huruf
// Latin lengkap) dan dimuat dari Google Fonts secara dinamis saat dipakai
// (bukan di-load semuanya sekaligus supaya tidak memberatkan koneksi
// lambat) — kecuali opsi "Font Sistem" yang tidak butuh Google Fonts sama
// sekali (langsung pakai font bawaan perangkat, paling ringan & cepat).

export const FONT_OPTIONS = [
  {
    value: "inter",
    label: "Inter (Bawaan)",
    stack: "'Inter', system-ui, -apple-system, sans-serif",
    google: "Inter:wght@400;500;600;700;800",
  },
  {
    value: "poppins",
    label: "Poppins",
    stack: "'Poppins', system-ui, -apple-system, sans-serif",
    google: "Poppins:wght@400;500;600;700;800",
  },
  {
    value: "nunito",
    label: "Nunito",
    stack: "'Nunito', system-ui, -apple-system, sans-serif",
    google: "Nunito:wght@400;600;700;800",
  },
  {
    value: "roboto",
    label: "Roboto",
    stack: "'Roboto', system-ui, -apple-system, sans-serif",
    google: "Roboto:wght@400;500;700;900",
  },
  {
    value: "jakarta",
    label: "Plus Jakarta Sans",
    stack: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    google: "Plus+Jakarta+Sans:wght@400;500;600;700;800",
  },
  {
    value: "system",
    label: "Font Sistem (Perangkat)",
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    google: null, // tidak perlu Google Fonts — paling ringan & selalu tersedia offline
  },
];

export const DEFAULT_FONT_VALUE = "inter";

export function getFontOption(value) {
  return FONT_OPTIONS.find(f => f.value === value) || FONT_OPTIONS[0];
}

export function getFontStack(value) {
  return getFontOption(value).stack;
}

// Menyuntikkan <link> Google Fonts ke <head> kalau font tsb butuh Google
// Fonts dan belum pernah dimuat sebelumnya di halaman ini. Aman dipanggil
// berkali-kali (idempotent lewat pengecekan id).
export function ensureFontLoaded(value) {
  if (typeof document === "undefined") return; // jaga-jaga kalau dipanggil di luar browser
  const opt = getFontOption(value);
  if (!opt.google) return;
  const id = `gw-google-font-${opt.value}`;
  if (document.getElementById(id)) return;
  try {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${opt.google}&display=swap`;
    document.head.appendChild(link);
  } catch (e) {
    console.warn("Gagal memuat Google Font:", e);
  }
}
