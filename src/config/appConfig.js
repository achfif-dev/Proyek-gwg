// ─────────────────────────────────────────────
//  APP CONFIG — konfigurasi runtime untuk White Label
// ─────────────────────────────────────────────
// Menyimpan branding (nama, logo, warna) dan konfigurasi Firebase di
// localStorage, supaya BISA DIUBAH LEWAT UI (Setup Wizard) tanpa perlu
// mengedit source code / build ulang. Ini yang memungkinkan aplikasi yang
// SAMA PERSIS dipakai oleh perusahaan konsinyasi lain, cukup dengan mengisi
// wizard: nama, logo, warna, dan Firebase project mereka sendiri.
//
// Prioritas nilai: localStorage (diisi lewat wizard) → DEFAULT bawaan
// (identitas Generasi Wangi Group, supaya instance yang sudah berjalan
// sekarang tidak berubah/rusak kalau belum pernah mengisi wizard).

import { GWG_LOGO_B64 } from "../theme/logo";
import { DEFAULT_FONT_VALUE } from "../theme/fonts";

const STORAGE_KEY = "gw_app_config";

// ✅ FIX: kredensial Firebase GWG SEBELUMNYA tertanam permanen sebagai
// fallback di kode JS (bukan cuma placeholder) — akibatnya wizard TIDAK
// PERNAH otomatis muncul untuk fork/instance manapun, termasuk instance
// perusahaan lain yang belum sempat mengisi Firebase sendiri (mereka diam-
// diam akan terhubung ke database GWG tanpa disadari). Sekarang kredensial
// bawaan dipindah ke variabel .env (VITE_FIREBASE_*, dibaca saat BUILD) —
// instance GWG yang sudah berjalan tetap jalan normal (nilainya sudah ada
// di .env), tapi fork baru yang BELUM mengisi .env-nya akan benar-benar
// kosong, sehingga isFirebaseConfigured() = false dan Setup Wizard otomatis
// tampil di login, seperti mestinya.
const _envFirebase = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

const DEFAULT_CONFIG = {
  brand: {
    companyName: "Generasi Wangi Group",
    appName: "GWG Super App",
    // ✅ MULTI BIDANG USAHA: aplikasi ini sejak awal sudah memakai istilah
    // generik (Produk/Toko/Kontrol/Rekap/Bagi Hasil, dst — bukan istilah
    // khusus parfum), jadi SECARA FUNGSIONAL sudah bisa dipakai perusahaan
    // konsinyasi bidang apa pun. `businessField` di sini sifatnya deskriptif
    // saja (dipakai untuk saran tagline & ditampilkan di Ringkasan wizard),
    // TIDAK mengubah/menyembunyikan fitur apa pun berdasarkan nilainya.
    businessField: "", // kosong = generik ("Sistem Manajemen Konsinyasi" tanpa embel-embel bidang)
    businessFieldOther: "", // dipakai kalau businessField === "lainnya"
    tagline: "Super App · Sistem Manajemen Konsinyasi",
    footerText: "Generasi Wangi Group · Sampang, Jawa Timur",
    logoDataUrl: "", // kosong = pakai logo bawaan (GWG_LOGO_B64)
    primaryColor: "#0F4C35", // dipetakan ke T.green
    accentColor: "#C49A1A",  // dipetakan ke T.gold
    fontFamily: DEFAULT_FONT_VALUE, // ✅ FONT DINAMIS: lihat src/theme/fonts.js
  },
  // Kosong kalau .env belum diisi VITE_FIREBASE_* — lihat komentar di atas.
  firebase: _envFirebase,
  // Email akun Google yang otomatis mendapat akses Admin penuh kapan pun
  // login, apa pun yang tercatat di tabel Pengguna (lihat isSuperAdminEmail
  // di src/config/superAdmin.js). Kosong = tidak ada Super Admin khusus
  // (mengandalkan mekanisme "akun pertama yang login otomatis jadi Admin").
  superAdminEmail: import.meta.env.VITE_SUPER_ADMIN_EMAIL || "",
  // Sudah pernah menyelesaikan Setup Wizard setidaknya sekali di perangkat
  // ini — dipakai supaya wizard tidak otomatis muncul lagi tiap refresh
  // kalau memang sengaja tidak mau mengisi Firebase (mis. mode demo).
  setupCompleted: false,
};

function deepMerge(base, override) {
  const out = { ...base };
  Object.keys(override || {}).forEach(k => {
    if (override[k] && typeof override[k] === "object" && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else if (override[k] !== undefined) {
      out[k] = override[k];
    }
  });
  return out;
}

export function loadAppConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveAppConfig(partial) {
  const current = loadAppConfig();
  const next = deepMerge(current, partial);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("Gagal menyimpan konfigurasi aplikasi:", e);
  }
  return next;
}

export function resetAppConfig() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function isFirebaseConfigured(cfg = loadAppConfig()) {
  return !!cfg.firebase.apiKey;
}

export function getBrandLogo(cfg = loadAppConfig()) {
  return cfg.brand.logoDataUrl || GWG_LOGO_B64;
}

// ── Bidang Bisnis (industri) — dipakai di Setup Wizard supaya perusahaan
// konsinyasi bidang APA PUN (bukan cuma parfum/wewangian seperti GWG) bisa
// isi identitas usahanya sendiri. Daftar ini hanya contoh umum; "Lainnya"
// selalu tersedia untuk bidang yang tidak ada di daftar.
export const BUSINESS_FIELD_OPTIONS = [
  { value: "parfum",     label: "Parfum & Wewangian" },
  { value: "fashion",    label: "Fashion & Pakaian" },
  { value: "fnb",        label: "Makanan & Minuman (F&B)" },
  { value: "kosmetik",   label: "Kosmetik & Perawatan Tubuh" },
  { value: "elektronik", label: "Elektronik & Gadget" },
  { value: "atk",        label: "Buku & Alat Tulis" },
  { value: "rumahtangga",label: "Peralatan Rumah Tangga" },
  { value: "pertanian",  label: "Hasil Pertanian & Sembako" },
  { value: "mainan",     label: "Mainan & Hobi" },
  { value: "lainnya",    label: "Lainnya" },
];

export function getBusinessFieldLabel(brand) {
  if (!brand) return "";
  if (brand.businessField === "lainnya") return (brand.businessFieldOther || "").trim();
  const found = BUSINESS_FIELD_OPTIONS.find(o => o.value === brand.businessField);
  return found ? found.label : "";
}

// Saran tagline otomatis berdasarkan bidang bisnis yang dipilih — HANYA
// dipakai sebagai placeholder/contoh di wizard (bukan dipaksa mengisi),
// supaya field "Sistem Manajemen Konsinyasi" tetap generik apa pun bidang
// usahanya, tapi user tetap dapat contoh yang relevan dengan bidangnya.
export function suggestTagline(brand) {
  const field = getBusinessFieldLabel(brand);
  return field
    ? `Super App · Sistem Manajemen Konsinyasi ${field}`
    : "Super App · Sistem Manajemen Konsinyasi";
}

// ── Util warna: bikin varian terang ("Lt") & sedikit lebih terang
// ("Mid") dari SATU warna utama yang dipilih user di wizard, supaya tidak
// perlu color-picker terpisah untuk tiap varian.
function hexToRgb(hex) {
  const clean = (hex || "#000000").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function mixColor(hex, targetHex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(targetHex);
  return rgbToHex([r + (tr - r) * amount, g + (tg - g) * amount, b + (tb - b) * amount]);
}
export function lighten(hex, amount = 0.85) { return mixColor(hex, "#FFFFFF", amount); }
export function darken(hex, amount = 0.25) { return mixColor(hex, "#000000", amount); }
