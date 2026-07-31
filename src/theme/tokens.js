import { loadAppConfig, lighten } from "../config/appConfig";
import { getFontStack, ensureFontLoaded, DEFAULT_FONT_VALUE } from "./fonts";

// ✅ WHITE LABEL: warna utama (green) & aksen (gold) dipetakan dari
// konfigurasi brand yang diisi lewat Setup Wizard (localStorage) — kalau
// belum pernah diisi, tetap pakai warna hijau/emas bawaan GWG seperti
// sebelumnya. Varian terang/gelap ("Lt"/"Mid") dihitung otomatis dari SATU
// warna utama yang dipilih, supaya wizard cukup minta 2 warna saja.
const _brand = loadAppConfig().brand;
const _primary = _brand.primaryColor || "#0F4C35";
const _accent = _brand.accentColor || "#C49A1A";
const _fontValue = _brand.fontFamily || DEFAULT_FONT_VALUE;

// ✅ FONT DINAMIS: font tampilan juga bisa diganti lewat Setup Wizard
// (lihat src/theme/fonts.js), sama seperti warna. `ensureFontLoaded` di
// sini menyuntikkan <link> Google Fonts yang sesuai begitu modul token ini
// pertama kali dipakai (sekali per load aplikasi) — kalau font pilihannya
// "Font Sistem", tidak ada apa pun yang dimuat dari internet.
ensureFontLoaded(_fontValue);

export const T = {
  green: _primary,
  greenMid: lighten(_primary, 0.28),
  greenLt: lighten(_primary, 0.92),
  gold: _accent,
  goldLt: lighten(_accent, 0.9),
  fontFamily: getFontStack(_fontValue),
  bg: "#F7F8FA",
  white: "#FFFFFF",
  gray50: "#F9FAFB",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray400: "#9CA3AF",
  gray600: "#4B5563",
  gray800: "#1F2937",
  blue: "#1D4ED8",
  blueLt: "#EFF6FF",
  red: "#DC2626",
  redLt: "#FEF2F2",
  orange: "#D97706",
  orangeLt: "#FFFBEB",
  yellow: "#CA8A04",
  yellowLt: "#FEFCE8",
  purple: "#7C3AED",
  purpleLt: "#F5F3FF",
  teal: "#0F766E",
  tealLt: "#F0FDFA",

  // ── Skala radius & shadow terpusat, dipakai supaya card/button/modal
  //    terasa halus & modern (bukan sudut tajam/kaku ala UI jadul).
  radiusSm: "8px",
  radiusMd: "12px",
  radiusLg: "16px",
  radiusFull: "999px",
  shadowSm: "0 1px 2px rgba(16,24,40,.06)",
  shadowMd: "0 1px 3px rgba(16,24,40,.08), 0 2px 6px rgba(16,24,40,.06)",
  shadowLg: "0 4px 12px rgba(16,24,40,.10), 0 8px 24px rgba(16,24,40,.08)",
  transition: "all .15s ease",
};

// Warna status catatan kontrol
export const CATATAN_STATUS = {
  tutup:    { label: "Toko Tutup",    bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  terjual:  { label: "Tidak Terjual", bg: "#FEF9C3", color: "#CA8A04", border: "#FDE047" },
  masalah:  { label: "Bermasalah",    bg: "#FEE2E2", color: "#DC2626", border: "#FCA5A5" },
  manual:   { label: "Isi Manual",    bg: "#F9FAFB", color: "#4B5563", border: "#E5E7EB" },
};

// ─────────────────────────────────────────────
//  FIREBASE SDK LOADER
// ─────────────────────────────────────────────
