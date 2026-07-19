import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

export function useAppResumeReload() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return; // cuma relevan untuk APK native
    let pausedAt = null;
    let listenerHandle;
    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        pausedAt = Date.now();
      } else if (pausedAt && (Date.now() - pausedAt) > 60000) {
        window.location.reload();
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
