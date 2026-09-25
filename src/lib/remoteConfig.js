// ─────────────────────────────────────────────
//  REMOTE CONFIG — sentralisasi branding & superAdminEmail lewat Firebase
// ─────────────────────────────────────────────
// Sebelumnya branding (nama usaha, warna, logo, tagline) dan superAdminEmail
// HANYA tersimpan di localStorage tiap device (lihat appConfig.js) — device
// lain yang buka aplikasi yang sama tidak akan tahu nilai-nilai ini sampai
// mengisi Setup Wizard sendiri secara manual.
//
// Modul ini menyimpan SATU salinan "sumber kebenaran" di Firebase, di
// gwg_data/_config, supaya semua device otomatis sinkron setelah Firebase
// konek. localStorage tetap dipakai sebagai CACHE instan (supaya halaman
// login tetap render tanpa nunggu network), tapi begitu remote config
// berhasil dibaca dan ternyata beda, App.jsx akan menimpa cache lokal &
// reload sekali. Lihat Firebase Rules (gwg_data/_config) — branding boleh
// dibaca siapa saja (perlu tampil sebelum login), tapi HANYA BISA DITULIS
// oleh akun yang emailnya cocok dengan gwg_data/_config/superAdminEmail.
//
// Catatan penting: Firebase apiKey/project config TIDAK ikut disentralisasi
// ke sini — itu mustahil (chicken-and-egg, butuh Firebase config dulu untuk
// bisa connect ke Firebase). Config Firebase tetap dari .env/Secrets saat
// build, seperti sudah berjalan sekarang.

import { firebaseDB } from "../firebase/init";

const BRANDING_PATH = "gwg_data/_config/branding";
const SUPERADMIN_PATH = "gwg_data/_config/superAdminEmail";

function requireDB() {
  if (!firebaseDB) throw new Error("Firebase belum siap (firebaseDB kosong).");
  return firebaseDB;
}

// Baca branding + superAdminEmail sekaligus (satu-dua panggilan get, ringan,
// dipanggil sekali saat app start setelah fbReady true — lihat App.jsx).
export async function fetchRemoteConfig() {
  const { db, ref, get } = requireDB();
  const [brandingSnap, superAdminSnap] = await Promise.all([
    get(ref(db, BRANDING_PATH)),
    get(ref(db, SUPERADMIN_PATH)),
  ]);
  return {
    branding: brandingSnap.exists() ? brandingSnap.val() : null,
    superAdminEmail: superAdminSnap.exists() ? superAdminSnap.val() : null,
  };
}

// Tulis branding ke remote. HANYA akan berhasil kalau akun yang sedang
// login emailnya cocok dengan gwg_data/_config/superAdminEmail (lihat
// Rules) — kalau bukan Super Admin, Firebase menolak dengan PERMISSION_DENIED.
// Sengaja dibiarkan melempar error ke pemanggil supaya UI (SetupWizard) bisa
// kasih tahu user secara eksplisit, bukan gagal diam-diam.
export async function pushRemoteBranding(brand) {
  const { db, ref, set } = requireDB();
  await set(ref(db, BRANDING_PATH), brand);
}

// Klaim status Super Admin secara terpusat. Rules mengizinkan tulis kalau:
// (a) node ini masih kosong (klaim pertama kali / bootstrap — dilakukan
//     otomatis oleh App.jsx begitu akun yang cocok dengan superAdminEmail
//     LOKAL berhasil login untuk pertama kalinya), ATAU
// (b) akun yang menulis emailnya SAMA dengan nilai yang sudah tersimpan
//     (menulis ulang nilai yang sama / no-op, selalu diizinkan).
// Di luar dua kondisi itu Rules menolak — jadi fungsi ini TIDAK BISA dipakai
// untuk mengambil alih status Super Admin dari akun lain begitu saja.
export async function bootstrapClaimSuperAdmin(email) {
  const { db, ref, set } = requireDB();
  await set(ref(db, SUPERADMIN_PATH), email.toLowerCase());
}
