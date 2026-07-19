import { useState, useEffect } from "react";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    let handle;
    let mounted = true;
    // @capacitor/network otomatis pakai navigator.onLine di web/PWA, dan
    // pakai API konektivitas native (lebih akurat) saat berjalan sebagai
    // APK — jadi satu hook ini berlaku untuk kedua target tanpa cabang kode.
    Network.getStatus().then(status => { if (mounted) setIsOnline(status.connected); });
    Network.addListener("networkStatusChange", status => setIsOnline(status.connected))
      .then(h => { handle = h; });
    return () => { mounted = false; if (handle) handle.remove(); };
  }, []);
  return isOnline;
}

// ✅ Android sering membekukan/memutus koneksi jaringan aplikasi yang
// sedang di-BACKGROUND (pindah ke app lain / layar dikunci) demi hemat
// baterai — walau app-nya sendiri TIDAK ditutup. Koneksi Firebase yang
// sedang berjalan bisa putus diam-diam, dan saat app dibuka lagi, proses
// "menyambung ulang" tidak selalu mulus/cepat, terutama di sinyal lemah.
// Solusinya: kalau app di-background LEBIH DARI 60 detik, begitu aktif
// lagi langsung reload penuh — supaya proses re-sync mengikuti alur "buka
// dari awal" yang sudah diperbaiki (deteksi loading lebih sabar di sinyal
// lemah), bukan bergantung pada reconnect otomatis yang tidak selalu andal.
// Background SEBENTAR (<60 detik, misal cuma buka notifikasi lalu balik
// lagi) TIDAK memicu reload, supaya tidak mengganggu pemakaian normal.
