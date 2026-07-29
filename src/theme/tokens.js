import { loadAppConfig, lighten } from "../config/appConfig";

// ✅ WHITE LABEL: warna utama (green) & aksen (gold) dipetakan dari
// konfigurasi brand yang diisi lewat Setup Wizard (localStorage) — kalau
// belum pernah diisi, tetap pakai warna hijau/emas bawaan GWG seperti
// sebelumnya. Varian terang/gelap ("Lt"/"Mid") dihitung otomatis dari SATU
// warna utama yang dipilih, supaya wizard cukup minta 2 warna saja.
const _brand = loadAppConfig().brand;
const _primary = _brand.primaryColor || "#0F4C35";
const _accent = _brand.accentColor || "#C49A1A";

export const T = {
  green: _primary,
  greenMid: lighten(_primary, 0.28),
  greenLt: lighten(_primary, 0.92),
  gold: _accent,
  goldLt: lighten(_accent, 0.9),
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
