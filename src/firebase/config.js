// ✅ WHITE LABEL: Firebase config sekarang dibaca dari appConfig (localStorage,
// diisi lewat Setup Wizard) — bukan lagi konstanta tetap di source code.
// Ini yang memungkinkan aplikasi yang sama dipakai perusahaan lain, cukup
// isi Firebase project MEREKA SENDIRI lewat wizard, tanpa perlu fork/edit
// source code sama sekali. Kalau wizard belum pernah diisi, tetap jatuh
// balik ke project GWG bawaan (supaya instance yang sudah berjalan tidak
// berubah).
import { loadAppConfig, isFirebaseConfigured } from "../config/appConfig";

export const FIREBASE_CONFIG = loadAppConfig().firebase;
export const FIREBASE_CONFIGURED = isFirebaseConfigured();
