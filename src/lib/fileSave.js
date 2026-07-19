import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function saveOrShareBlob(blob, filename) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  await Share.share({ title: filename, url: result.uri });
}

// Sama seperti saveOrShareBlob, tapi khusus workbook Excel (SheetJS) supaya
// tidak perlu diubah ke Blob dulu — XLSX bisa langsung menulis base64.
export async function saveWorkbookNative(wb, filename) {
  if (!Capacitor.isNativePlatform()) {
    XLSX.writeFile(wb, filename);
    return;
  }
  const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
  const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  await Share.share({ title: filename, url: result.uri });
}

// Memicu unduhan file JSON ke perangkat pengguna (dipakai fitur Backup).
export async function downloadJSON(filename, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    await saveOrShareBlob(blob, filename);
  } catch (e) {
    alert("Gagal membuat file backup: " + e.message);
  }
}

// Ambil access token OAuth2 Google (untuk panggil Google Drive REST API
// langsung dari browser). Dipakai bersama oleh fitur "Upload ke Google
// Drive" (backup manual) dan fitur arsip Kontrol Bulanan, supaya tidak
// dobel logic dan token yang sama (di-cache di window.__gwg_gtoken selama
// ~55 menit) bisa dipakai ulang tanpa memicu popup login berkali-kali.
// ⚠ SYARAT: "Google Drive API" harus aktif di Google Cloud Console untuk
//   project Firebase ini, dan scope drive.file harus diizinkan di OAuth
//   consent screen — tanpa ini, panggilan akan gagal 403/insufficientScope.
// Ambil OAuth2 access token Google dengan scope Drive (dipakai sama-sama
// oleh backup manual & arsip Kontrol Bulanan). Popup berbasis web (yang
// dipakai versi lama) TIDAK berfungsi di WebView native (APK) — untuk app
// native, scope tambahan diminta langsung lewat plugin Google Sign-In
// native (FirebaseAuthentication), yang mengembalikan accessToken OAuth
// selain idToken biasa.
