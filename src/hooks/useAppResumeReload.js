import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { firebaseDB } from "../firebase/init";

// ✅ AUDIT "lag saat app dibuka lagi setelah minimize" (sinyal lemah + data
// kontrol sudah banyak):
//
// Akar masalahnya BUKAN di listener useDB.js (itu sudah dioptimasi:
// per-child listener, debounce batch, dst — lihat komentar di sana) —
// melainkan di hook INI. Sebelumnya: begitu app di-background LEBIH DARI
// 60 DETIK lalu dibuka lagi, kita langsung `window.location.reload()` TANPA
// CEK APAKAH KONEKSI FIREBASE-NYA MASIH HIDUP. Reload penuh berarti SELURUH
// listener kontrol/toko (tabel besar) pasang ulang dari NOL sebagai listener
// BARU — dan Firebase RTDB tidak punya mekanisme "lanjutkan dari state
// terakhir" lintas reload, jadi SEMUA record tahun berjalan (bisa ribuan)
// harus diunduh ULANG lewat jaringan. Di sinyal lemah, ini terasa sebagai
// "lag/stuck" tepat saat app dibuka lagi — persis keluhan pengguna, dan
// makin sering kejadian karena ambang 60 detik TERLALU MUDAH terlewati
// untuk pemakaian normal (lihat notifikasi WA sebentar, pindah app lalu
// balik lagi, dst — user merasa "baru saja" minimize padahal sudah lewat
// 60 detik).
//
// ✅ FIX: (1) ambang diperpanjang jadi 3 menit — reload penuh cuma untuk
// background yang BENAR-BENAR lama, bukan pemakaian sehari-hari yang wajar.
// (2) SEBELUM reload, cek dulu `.info/connected` — kalau socket Firebase
// ternyata masih/sudah tersambung sendiri (banyak Android modern TIDAK
// benar-benar memutusnya walau app lama di-background), reload dilewati
// total dan listener yang sudah ada dibiarkan lanjut seperti biasa — tidak
// ada alasan bayar ongkos reload kalau datanya toh tidak pernah putus.
// Reload hanya benar-benar dijalankan kalau socket TIDAK kunjung
// tersambung dalam beberapa detik (menandakan koneksi memang mati/beku).
export function useAppResumeReload() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return; // cuma relevan untuk APK native
    let pausedAt = null;
    let listenerHandle;
    const RELOAD_THRESHOLD_MS = 3 * 60 * 1000; // 3 menit (sebelumnya 60 detik)
    const CONNECTED_CHECK_TIMEOUT_MS = 4000;

    function maybeReloadIfDisconnected() {
      // Firebase belum sempat init (jarang, tapi jaga-jaga) — tidak bisa
      // dicek, langsung reload seperti perilaku lama supaya tetap aman.
      if (!firebaseDB) { window.location.reload(); return; }
      const { db: rtdb, ref, onValue, off } = firebaseDB;
      const connectedRef = ref(rtdb, ".info/connected");
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        off(connectedRef);
        window.location.reload(); // tidak kunjung tersambung — reload penuh
      }, CONNECTED_CHECK_TIMEOUT_MS);
      onValue(connectedRef, snap => {
        if (settled || snap.val() !== true) return;
        // Masih/sudah tersambung sendiri — batalkan reload, listener lama
        // tetap jalan, tidak ada data yang perlu diunduh ulang dari nol.
        settled = true;
        clearTimeout(timeout);
        off(connectedRef);
      });
    }

    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        pausedAt = Date.now();
      } else if (pausedAt && (Date.now() - pausedAt) > RELOAD_THRESHOLD_MS) {
        maybeReloadIfDisconnected();
      }
    }).then(h => { listenerHandle = h; });
    return () => { if (listenerHandle) listenerHandle.remove(); };
  }, []);
}

// ─────────────────────────────────────────────
//  SUPER ADMIN — satu akun tetap yang TIDAK BISA diturunkan/dihapus
//  oleh Admin lain manapun (termasuk dirinya sendiri lewat UI).
//  Isi dengan email Google akun pemilik aplikasi. Kosongkan ("") untuk
//  menonaktifkan fitur ini (kembali ke perilaku Admin biasa).
// ─────────────────────────────────────────────
