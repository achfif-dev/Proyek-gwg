import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
// Firebase sekarang di-import langsung dari npm (bukan dynamic import dari CDN
// gstatic seperti sebelumnya). Ini membuat kode Firebase ikut ter-bundle ke
// dalam file APK, jadi saat app dibuka di sinyal lemah tidak perlu lagi
// fetch file JS tambahan dari internet — hanya panggilan data yang benar-benar
// butuh koneksi. Bekerja sama baiknya untuk versi web (Netlify) maupun APK.
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, get, onValue, onChildAdded, onChildChanged,
  onChildRemoved, off, onDisconnect, serverTimestamp, remove,
} from "firebase/database";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential,
  signOut, onAuthStateChanged,
} from "firebase/auth";

// ─────────────────────────────────────────────
//  FIREBASE CONFIG - Realtime Database untuk sinkronisasi lintas perangkat
// ─────────────────────────────────────────────
// PENTING: Ganti dengan konfigurasi Firebase project Anda
// 1. Buka https://console.firebase.google.com
// 2. Buat project baru → Tambah app web → Salin config di bawah
// 3. Aktifkan Realtime Database → mulai dalam test mode
// 4. Aktifkan Authentication → Google Sign-In
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBAWDbCtCde8mgRgASZ7nl36bfEwZaPM4",
  authDomain: "proyek-gwg.firebaseapp.com",
  databaseURL: "https://proyek-gwg-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "proyek-gwg",
  storageBucket: "proyek-gwg.firebasestorage.app",
  messagingSenderId: "481668966064",
  appId: "1:481668966064:web:8b1bbc7a1c1eac71bb3d75",
};
const FIREBASE_CONFIGURED = !FIREBASE_CONFIG.apiKey.includes("XXXXX");

// ─────────────────────────────────────────────
//  OFFLINE STORAGE (IndexedDB) — cache lokal database untuk mode offline
// ─────────────────────────────────────────────
// localStorage dibatasi ~5-10MB per origin dan bisa DIAM-DIAM GAGAL menulis
// (quota exceeded) begitu tabel besar seperti "kontrol"/"toko" bertambah
// banyak seiring waktu — sebelumnya kegagalan ini ditelan oleh `catch {}`
// sehingga data terbaru tidak benar-benar tersimpan lokal walau terlihat
// baik-baik saja di UI. IndexedDB tidak punya batas praktis seperti itu
// (biasanya ratusan MB - beberapa GB tergantung browser/perangkat), jadi
// kita jadikan IndexedDB sebagai penyimpan cadangan lokal UTAMA, sementara
// localStorage tetap ditulis juga (untuk kompatibilitas & load pertama yang
// sinkron/instan sebelum IndexedDB sempat dibuka).
const IDB_NAME = "gwg_offline_db";
const IDB_STORE = "kv";
// "writeQueue": antrean perubahan yang BELUM berhasil dikirim ke Firebase —
// keyPath = "path" (path Firebase relatif, mis. "toko/T001"), jadi kalau
// user mengedit path yang sama berkali-kali saat offline, cukup versi
// TERAKHIR yang tersimpan (put menimpa key yang sama), bukan riwayat
// bertumpuk. Ini yang membuat perubahan dari sales di lapangan (sinyal
// lemah/hilang) TIDAK PERNAH hilang walau app ditutup/HP restart sebelum
// sempat online lagi — begitu online, antrean ini otomatis dikirim ulang.
const IDB_QUEUE_STORE = "writeQueue";
let idbOpenPromise = null;
function openIDB() {
  if (idbOpenPromise) return idbOpenPromise;
  idbOpenPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    try {
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const dbConn = req.result;
        if (!dbConn.objectStoreNames.contains(IDB_STORE)) dbConn.createObjectStore(IDB_STORE);
        if (!dbConn.objectStoreNames.contains(IDB_QUEUE_STORE)) dbConn.createObjectStore(IDB_QUEUE_STORE, { keyPath: "path" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // IndexedDB tidak tersedia (mis. private mode Safari) → fallback localStorage saja
    } catch { resolve(null); }
  });
  return idbOpenPromise;
}
async function idbSet(key, value) {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
async function idbGet(key) {
  const db = await openIDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
// ── Antrean tulis offline (durable) ─────────────────────────────────────
async function queueWrite(path, value) {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      tx.objectStore(IDB_QUEUE_STORE).put({ path, value, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
async function queueRemove(path) {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      tx.objectStore(IDB_QUEUE_STORE).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
async function queueGetAll() {
  const db = await openIDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readonly");
      const req = tx.objectStore(IDB_QUEUE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}
async function queueCount() {
  const db = await openIDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readonly");
      const req = tx.objectStore(IDB_QUEUE_STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    } catch { resolve(0); }
  });
}
// Titik tunggal untuk menyimpan seluruh state `db` secara lokal. Dipanggil
// di SETIAP tempat yang dulu memanggil localStorage.setItem("gwg_db_v2", ...)
// langsung — perilaku localStorage dipertahankan (sinkron, cepat), ditambah
// tulis ke IndexedDB (async, best-effort, tidak memblokir UI) sebagai
// cadangan berkapasitas besar yang jauh lebih tahan dipakai offline.
function saveLocalDB(data) {
  try { localStorage.setItem("gwg_db_v2", JSON.stringify(data)); } catch {}
  idbSet("gwg_db_v2", data);
}

// Hook status koneksi — dipakai untuk menampilkan indikator "Offline" di
// header dan (nantinya) untuk menahan/menunda aksi yang butuh jaringan.
// navigator.onLine mendeteksi status koneksi perangkat secara umum (WiFi/
// data seluler mati/nyala); ini sudah cukup untuk kebanyakan kasus offline
// di lapangan (mis. sinyal hilang saat kunjungan toko).
function useOnlineStatus() {
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

// ─────────────────────────────────────────────
//  SUPER ADMIN — satu akun tetap yang TIDAK BISA diturunkan/dihapus
//  oleh Admin lain manapun (termasuk dirinya sendiri lewat UI).
//  Isi dengan email Google akun pemilik aplikasi. Kosongkan ("") untuk
//  menonaktifkan fitur ini (kembali ke perilaku Admin biasa).
// ─────────────────────────────────────────────
const SUPER_ADMIN_EMAIL = "achfif@gmail.com"; // TODO: ganti dengan email Anda
const isSuperAdminEmail = (email) =>
  !!SUPER_ADMIN_EMAIL && email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
// ID "resmi" baris Super Admin — dibuat deterministik dari email (sama seperti
// yang dipakai proses auto-register). Ini dipakai untuk membedakan baris
// Super Admin yang ASLI dari baris DUPLIKAT lama (bug sebelumnya) yang
// kebetulan punya email sama tapi id acak berbeda. Hanya baris dengan id
// PERSIS ini yang benar-benar dikunci dari hapus/edit — baris lain yang
// emailnya sama tapi id-nya beda dianggap duplikat basi dan BOLEH dihapus,
// supaya admin bisa membersihkan sisa duplikat tanpa terkunci total.
const SUPER_ADMIN_CANONICAL_ID = SUPER_ADMIN_EMAIL
  ? "U_" + encodeEmailKey(SUPER_ADMIN_EMAIL.toLowerCase())
  : null;

const GWG_LOGO_B64 = "data:image/png;base64,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";

// Logo khusus dipakai untuk header hasil ekspor (PDF/JPG/HTML).
// Ini adalah foto/raster logo asli PT. Generasi Wangi Group (bukan bentuk
// vektor buatan), ukurannya sengaja dibuat kecil (~10KB) supaya proses
// decode ke <canvas> cepat dan tidak gagal di WebView Android (.apk).
const GWG_EXPORT_LOGO_B64 = "data:image/png;base64,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";



// ─────────────────────────────────────────────
//  EMPTY DATABASE (no sample data)
// ─────────────────────────────────────────────
const DB_EMPTY = {
  wilayah: [],
  rute: [],
  toko: [],
  produk: [],
  kontrol: [],
  pengguna: [],
  penyesuaian: [], // Penyesuaian Stok di luar siklus kontrol rutin (tambah/kurang/tarik sebagian)
  penjualanLuar: [], // Penjualan Luar Rute: transaksi produk yang tokonya tidak diketahui/diingat sales saat kontrol
  stokAwal: {}, // { "tokoId_produkId_YYYY-MM": number }
  bagiHasilConfig: null, // konfigurasi bagi hasil
};

// ─────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────
const T = {
  green: "#0F4C35",
  greenMid: "#1A6B4A",
  greenLt: "#E6F4ED",
  gold: "#C49A1A",
  goldLt: "#FBF3D9",
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
const CATATAN_STATUS = {
  tutup:    { label: "Toko Tutup",    bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  terjual:  { label: "Tidak Terjual", bg: "#FEF9C3", color: "#CA8A04", border: "#FDE047" },
  masalah:  { label: "Bermasalah",    bg: "#FEE2E2", color: "#DC2626", border: "#FCA5A5" },
  manual:   { label: "Isi Manual",    bg: "#F9FAFB", color: "#4B5563", border: "#E5E7EB" },
};

// ─────────────────────────────────────────────
//  FIREBASE SDK LOADER
// ─────────────────────────────────────────────
let firebaseApp = null, firebaseDB = null, firebaseAuth = null;
let firebaseReady = false;

async function initFirebase() {
  if (firebaseReady) return true;
  if (!FIREBASE_CONFIGURED) return false;
  try {
    // Tidak ada lagi network fetch di sini — semua modul Firebase sudah
    // ter-bundle sejak build time (lihat import di bagian atas file).
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseDB = { db: getDatabase(firebaseApp), ref, set, get, onValue, onChildAdded, onChildChanged, onChildRemoved, off, onDisconnect, serverTimestamp, remove };
    firebaseAuth = { auth: getAuth(firebaseApp), GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged };
    firebaseReady = true;
    return true;
  } catch (e) {
    console.warn("Firebase init failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────
//  UTILITY HOOKS
// ─────────────────────────────────────────────
function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fbReady, setFbReady] = useState(false);

  useEffect(() => {
    initFirebase().then(ok => {
      setFbReady(ok);
      if (ok && firebaseAuth) {
        const unsub = firebaseAuth.onAuthStateChanged(firebaseAuth.auth, u => {
          setUser(u);
          setLoading(false);
        });
        return () => unsub();
      } else {
        setLoading(false);
      }
    });
  }, []);

  const loginGoogle = async () => {
    if (!firebaseAuth) return;
    try {
      if (Capacitor.isNativePlatform()) {
        // Plugin native Google Sign-In login ke Firebase Auth versi native
        // Android, TAPI itu instance yang terpisah dari Firebase Auth versi
        // JS/web yang dipakai tampilan app ini (getAuth() di atas). Supaya
        // tampilan app benar-benar "sadar" sudah login (onAuthStateChanged
        // terpicu), token hasil login native harus disambungkan manual ke
        // sisi JS lewat signInWithCredential — tanpa ini, login di
        // Firebase Console tercatat sukses tapi layar app tetap di halaman
        // login karena kedua sistem auth itu tidak otomatis nyambung.
        const result = await Promise.race([
          FirebaseAuthentication.signInWithGoogle(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(
            "Login timeout (30 detik). Cek koneksi internet — proses tukar token butuh sinyal yang stabil."
          )), 30000)),
        ]);
        const idToken = result?.credential?.idToken;
        if (!idToken) throw new Error("Login native tidak mengembalikan token. Coba lagi.");
        const credential = firebaseAuth.GoogleAuthProvider.credential(idToken);
        await firebaseAuth.signInWithCredential(firebaseAuth.auth, credential);
      } else {
        const provider = new firebaseAuth.GoogleAuthProvider();
        await firebaseAuth.signInWithPopup(firebaseAuth.auth, provider);
      }
    } catch (e) { throw new Error(e.message || "Login gagal"); }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    try {
      // Sebelumnya cuma logout dari sisi JS. Sesi Google di sisi NATIVE
      // tetap tersimpan (di-cache oleh Google Play Services), makanya waktu
      // login lagi, dialog pilih akun tidak muncul — otomatis masuk pakai
      // akun yang sama. signOut() di plugin native ini yang membersihkan
      // cache itu juga.
      if (Capacitor.isNativePlatform()) {
        try { await FirebaseAuthentication.signOut(); } catch {}
      }
      await firebaseAuth.signOut(firebaseAuth.auth);
    } catch {}
  };

  return { user, loading, fbReady, loginGoogle, logout };
}

// ─────────────────────────────────────────────
//  PRESENCE — daftar "pengguna sedang aktif" (real-time, per PERANGKAT/SESI)
// ─────────────────────────────────────────────
// Kenapa per-sesi (bukan per-email)? Supaya Super Admin yang login dari 2
// perangkat sekaligus terlihat sebagai 2 sesi aktif yang jelas — ini juga
// yang membantu mengonfirmasi kejadian "kok muncul 2 pengguna" di atas.
// Firebase onDisconnect() otomatis menghapus path sesi ini begitu koneksi
// terputus (tutup tab, sinyal hilang, dll), jadi daftar ini selalu real-time
// tanpa perlu heartbeat manual.
function usePresence(user, currentUserRecord) {
  const [activeUsers, setActiveUsers] = useState([]);
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    sessionIdRef.current = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  useEffect(() => {
    if (!user || !firebaseDB) return;
    const { db: rtdb, ref, set, onValue, onDisconnect, serverTimestamp, remove } = firebaseDB;
    const emailKey = encodeEmailKey(user.email || "");
    const sessionId = sessionIdRef.current;
    const sessionRef = ref(rtdb, `gwg_data/shared/presence/${emailKey}/${sessionId}`);
    const connectedRef = ref(rtdb, ".info/connected");

    const unsubConnected = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // Daftarkan sesi ini sebagai aktif, dan pastikan otomatis terhapus
        // saat koneksi perangkat ini putus (nutup tab, sinyal hilang, dst).
        onDisconnect(sessionRef).remove().then(() => {
          set(sessionRef, {
            nama: currentUserRecord?.nama || user.displayName || user.email,
            email: user.email,
            role: isSuperAdminEmail(user.email) ? "Admin" : (currentUserRecord?.role || "Viewer"),
            lastActive: serverTimestamp(),
          }).catch(console.warn);
        }).catch(console.warn);
      }
    });

    const presenceRootRef = ref(rtdb, `gwg_data/shared/presence`);
    const unsubPresence = onValue(presenceRootRef, (snap) => {
      const val = snap.val() || {};
      const list = [];
      Object.values(val).forEach((sessions) => {
        Object.entries(sessions || {}).forEach(([sid, info]) => {
          if (info) list.push({ sessionId: sid, ...info });
        });
      });
      // Urutkan: sesi milik pengguna sendiri dulu, lalu berdasar nama.
      list.sort((a, b) => (a.email === user.email ? -1 : 0) - (b.email === user.email ? -1 : 0) || (a.nama||"").localeCompare(b.nama||""));
      setActiveUsers(list);
    });

    return () => {
      unsubConnected();
      unsubPresence();
      // Bersihkan sesi ini segera saat komponen unmount (mis. logout).
      remove(sessionRef).catch(() => {});
    };
  }, [user, currentUserRecord?.nama, currentUserRecord?.role]);

  return activeUsers;
}

// Nama-nama tabel yang disimpan sebagai LIST (array of records dengan field
// `id`). Di Firebase, masing-masing disimpan sebagai OBJEK ber-key id (map),
// bukan array index, dan sebagai PATH TERPISAH (bukan satu blob besar) —
// supaya menambah/mengubah 1 toko tidak perlu mengirim ulang seluruh
// database (wilayah+rute+toko+kontrol+...) setiap kali. Ini penting untuk
// skala ribuan toko & data kontrol bulanan yang terus bertambah.
const LIST_TABLES = ["wilayah", "rute", "toko", "produk", "kontrol", "pengguna", "penyesuaian", "penjualanLuar"];

// Konversi array → objek ber-key id, untuk ditulis ke Firebase per-record.
function arrToMap(arr) {
  const map = {};
  (arr||[]).forEach(r => { if (r && r.id != null) map[r.id] = r; });
  return map;
}
// Konversi objek ber-key id (dari Firebase) → array, untuk dipakai komponen
// UI yang masih mengasumsikan bentuk array seperti semula.
function mapToArr(map) {
  if (!map) return [];
  if (Array.isArray(map)) {
    // Dedup by id untuk menghindari entri dobel dari data lama format array
    const seen = new Set();
    return map.filter(r => r && r.id != null && !seen.has(r.id) && seen.add(r.id));
  }
  return Object.values(map);
}
// Menentukan "tahun partisi" sebuah record kontrol, dari field tanggal
// (format "YYYY-MM-DD"). Dipakai untuk menentukan path Firebase
// kontrol/{tahun}/{id}. Fallback ke tahun berjalan kalau tanggal kosong/rusak
// (seharusnya tidak pernah terjadi karena form kontrol mewajibkan tanggal).
function kontrolYearOf(record) {
  const y = (record && record.tanggal || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

// Encode email menjadi key Firebase yang valid (tidak boleh ada ., #, $, [, ], /)
function encodeEmailKey(email) {
  return (email || "").toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_").replace(/[#$\[\]/]/g, "_");
}
// Kebalikan dari encodeEmailKey, untuk ditampilkan kembali sebagai email asli di UI.
// Catatan: karakter selain titik dan @ yang di-escape jadi "_" tidak bisa
// direkonstruksi sempurna, tapi ini cukup untuk kasus email pada umumnya.
function decodeEmailKey(key) {
  return (key || "").replace(/_dot_/g, ".").replace(/_at_/g, "@");
}

// Simpan/bagikan file di APK native — mekanisme <a download> browser TIDAK
// berfungsi di WebView native (Capacitor), jadi file harus ditulis lewat
// plugin Filesystem lalu dibuka lewat dialog "Bagikan/Simpan ke...". Di web
// biasa (PWA/browser), tetap pakai cara unduhan lama seperti sebelumnya.
async function saveOrShareBlob(blob, filename) {
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
async function saveWorkbookNative(wb, filename) {
  if (!Capacitor.isNativePlatform()) {
    XLSX.writeFile(wb, filename);
    return;
  }
  const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
  const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  await Share.share({ title: filename, url: result.uri });
}

// Memicu unduhan file JSON ke perangkat pengguna (dipakai fitur Backup).
async function downloadJSON(filename, obj) {
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
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

async function getGoogleDriveAccessToken() {
  if (window.__gwg_gtoken && window.__gwg_gtoken_exp > Date.now()) {
    return window.__gwg_gtoken;
  }
  if (!firebaseAuth) throw new Error("Firebase Auth belum siap.");
  let accessToken;
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle({ scopes: [DRIVE_SCOPE] });
    accessToken = result?.credential?.accessToken;
    if (result?.credential?.idToken) {
      const cred = firebaseAuth.GoogleAuthProvider.credential(result.credential.idToken, result.credential.accessToken);
      await firebaseAuth.signInWithCredential(firebaseAuth.auth, cred).catch(() => {});
    }
  } else {
    const provider = new firebaseAuth.GoogleAuthProvider();
    provider.addScope(DRIVE_SCOPE);
    const result = await firebaseAuth.signInWithPopup(firebaseAuth.auth, provider);
    const cred = firebaseAuth.GoogleAuthProvider.credentialFromResult(result);
    accessToken = cred?.accessToken;
  }
  if (!accessToken) throw new Error("Gagal mendapat access token Google. Pastikan scope Drive sudah diaktifkan di Google Cloud Console.");
  window.__gwg_gtoken = accessToken;
  window.__gwg_gtoken_exp = Date.now() + 55 * 60 * 1000;
  return accessToken;
}

async function getGDriveAccessToken() {
  return getGoogleDriveAccessToken();
}

// Upload satu file JSON ke Google Drive (multipart upload, Drive API v3).
// Mengembalikan { id, name, webViewLink } file yang baru dibuat.
async function gdriveUploadJSON(filename, obj, description) {
  const accessToken = await getGDriveAccessToken();
  const content = JSON.stringify(obj, null, 2);
  const metadata = { name: filename, mimeType: "application/json", description };
  const boundary = "gwg_boundary_xyz";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  // String biasa (bukan Blob) — CapacitorHttp (native networking di APK,
  // dipakai supaya fetch() tidak diblokir CORS) tidak menangani body
  // ber-tipe Blob dengan benar saat menyeberang ke sisi native, sehingga
  // isinya bisa rusak dan ditolak Google dengan HTTP 400.
  const multipartBody =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
    delimiter + "Content-Type: application/json\r\n\r\n" + content +
    closeDelimiter;
  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary="${boundary}"` }, body: multipartBody }
  );
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// Unduh isi (bukan hanya metadata) satu file dari Google Drive, by file ID.
async function gdriveDownloadJSON(fileId) {
  const accessToken = await getGDriveAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Hapus permanen satu file dari Google Drive, by file ID.
async function gdriveDeleteFile(fileId) {
  const accessToken = await getGDriveAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
}

// Bangun daftar kolom otomatis dari isi record (union semua key yang
// muncul), untuk export CSV/Excel data arsip — bentuk record kontrol tidak
// perlu diketahui persis di sini, cukup ambil semua field yang ada.
function autoColumns(records) {
  const keys = new Set();
  records.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
  return Array.from(keys).map(k => ({ key: k, label: k }));
}


// ─────────────────────────────────────────────
//  GOOGLE DRIVE HELPERS — dipakai bareng oleh backup manual & arsip data
// ─────────────────────────────────────────────
// Drive dipilih (bukan Firebase Storage) supaya tetap 100% gratis tanpa
// perlu upgrade project Firebase ke paket berbayar (Blaze) — Google kini
// mewajibkan kartu pembayaran untuk sekadar MENGAKTIFKAN Storage, walau
// kuota gratisnya tetap ada. Drive API tidak punya syarat itu.
//
// ⚠ SYARAT: "Google Drive API" harus aktif di Google Cloud Console untuk
//   project Firebase ini, dan scope "drive.file" ditambahkan ke OAuth
//   consent screen. Tanpa ini, permintaan token akan gagal.

// Ambil OAuth2 access token Google (bukan token Firebase biasa) — dipakai
// cache di window selama sesi supaya tidak selalu memicu popup login ulang.
async function getGoogleAccessToken() {
  return getGoogleDriveAccessToken();
}

// Upload satu object sebagai file JSON ke Drive (multipart upload, Drive API v3).
async function driveUploadJSON(accessToken, filename, obj, description) {
  const content = JSON.stringify(obj, null, 2);
  const metadata = { name: filename, mimeType: "application/json", description };
  const boundary = "gwg_boundary_xyz";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const multipartBody =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
    delimiter + "Content-Type: application/json\r\n\r\n" + content +
    closeDelimiter;
  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary="${boundary}"` },
    body: multipartBody,
  });
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json(); // { id, name, webViewLink }
}

// Unduh isi file JSON dari Drive berdasarkan fileId.
async function driveDownloadJSON(accessToken, fileId) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — file mungkin sudah dihapus dari Drive.`);
  return resp.json();
}

// Hapus satu file dari Drive berdasarkan fileId.
async function driveDeleteFile(accessToken, fileId) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok && resp.status !== 404) { // 404 = sudah terhapus, anggap sukses
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
}

function useDB(user) {
  const [db, setDB] = useState(() => {
    try {
      const saved = localStorage.getItem("gwg_db_v2");
      return saved ? JSON.parse(saved) : DB_EMPTY;
    } catch { return DB_EMPTY; }
  });
  // Hidrasi dari IndexedDB begitu tersedia (di render pertama kita hanya
  // sempat membaca localStorage secara sinkron di atas). Kalau IndexedDB
  // punya salinan — misalnya localStorage gagal menyimpan versi terbaru
  // karena kuota penuh — timpa state dengan versi IndexedDB yang lebih
  // lengkap. Ini membuat data offline tetap utuh walau app baru dibuka
  // ulang dalam kondisi tanpa internet sama sekali.
  useEffect(() => {
    let cancelled = false;
    idbGet("gwg_db_v2").then((saved) => {
      if (!cancelled && saved) setDB(saved);
    });
    return () => { cancelled = true; };
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  // cloudLoaded: true setelah snapshot PERTAMA dari Firebase diterima (baik
  // datanya ada isi atau kosong). Dipakai untuk MENCEGAH logika bootstrap-admin
  // di komponen utama berjalan sebelum kita benar-benar tahu isi database di
  // cloud — supaya tidak terjadi 2 perangkat berbeda mengira tabel "kosong" di
  // saat yang sama lalu masing-masing menambahkan dirinya sebagai Admin baru.
  const [cloudLoaded, setCloudLoaded] = useState(!firebaseDB); // jika Firebase tidak aktif, anggap langsung "loaded" (mode lokal)
  // Menyimpan snapshot mentah PER TABEL dari Firebase (bentuk map/objek apa
  // adanya), supaya saat menulis cukup hitung diff terhadap snapshot ini —
  // tidak perlu menulis ulang tabel yang tidak berubah.
  const remoteRef = useRef({}); // { wilayah: {...}, rute: {...}, ... , stokAwal: {...}, bagiHasilConfig: {...} }
  const basePathRef = useRef(null); // ref ke `gwg_data/shared`
  const deletedUsersRef = useRef({}); // { "email_encoded": true } — email yang sengaja dihapus admin

  // ─── PARTISI TAHUNAN UNTUK "kontrol" ───────────────────────────────────
  // Struktur di Firebase: gwg_data/shared/kontrol/{tahun}/{recordId}
  // (bukan lagi gwg_data/shared/kontrol/{recordId} langsung). Tujuannya
  // supaya klien tidak perlu men-download SELURUH riwayat penjualan
  // bertahun-tahun setiap kali aplikasi dibuka — cukup tahun berjalan +
  // tahun lalu yang otomatis dimuat; tahun-tahun lebih lama dimuat manual
  // saat dibutuhkan (lihat loadKontrolYear di bawah).
  // Di level UI, db.kontrol TETAP berupa array datar gabungan dari semua
  // tahun yang sudah dimuat — jadi seluruh tab/komponen yang sudah ada
  // TIDAK PERLU diubah sama sekali.
  const KONTROL_LIVE_YEARS = 1; // jumlah tahun terbaru yang otomatis live-sync — diturunkan dari 2 supaya hemat kuota unduhan Firebase menjelang pemakaian oleh sales lapangan (tahun lain tetap bisa dimuat manual dari menu Backup)
  const kontrolByYearRef = useRef({}); // { "2026": { id1:{...}, id2:{...} }, "2025": {...} }
  const kontrolYearUnsubsRef = useRef({}); // { "2026": () => {...} }
  const [loadedKontrolYears, setLoadedKontrolYears] = useState([]); // tahun yang sudah live-sync / dimuat
  const [availableKontrolYears, setAvailableKontrolYears] = useState([]); // semua tahun yang ADA di cloud (dari index ringan)

  // Subscribe Firebase realtime jika user login — SATU listener PER PATH
  // (per tabel), bukan satu listener di root yang mendownload semuanya
  // setiap kali ada perubahan di mana pun.
  useEffect(() => {
    if (!user || !firebaseDB) return;
    const { db: rtdb, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, off, set, get } = firebaseDB;
    // Tabel yang berpotensi tumbuh SANGAT besar (ribuan-ratusan ribu record
    // seiring waktu & jumlah toko): "kontrol" (data penjualan/kunjungan
    // bulanan — bertambah terus setiap bulan x setiap toko) dan "toko"
    // (bisa mencapai 5.000-20.000 baris). Untuk tabel ini kita HINDARI
    // `onValue` di root tabel, karena onValue mengirim ULANG SELURUH isi
    // tabel ke SETIAP klien yang sedang online setiap kali SATU record saja
    // berubah — biaya bandwidth-nya tumbuh sebagai (jumlah record) x
    // (jumlah klien online) x (jumlah perubahan), yang paling cepat
    // menghabiskan kuota gratis Firebase (Spark: 10GB/bulan). Sebagai
    // gantinya kita pakai listener per-child (onChildAdded/Changed/Removed)
    // yang hanya mengirim record yang benar-benar berubah — struktur data
    // di Firebase TETAP SAMA PERSIS, jadi tidak perlu migrasi apa pun.
    const LARGE_TABLES = new Set(["toko"]); // "kontrol" ditangani terpisah (partisi tahun) di bawah
    basePathRef.current = ref(rtdb, `gwg_data/shared`);

    const paths = [...LIST_TABLES, "stokAwal", "bagiHasilConfig"];
    const loadedSet = new Set(); // path mana yang sudah memberi snapshot pertama
    setSyncing(true);

    // MIGRASI SATU KALI: jika project ini masih memakai struktur LAMA (satu
    // blob besar tersimpan persis di root "gwg_data/shared", lengkap dengan
    // field seperti wilayah/rute/toko sebagai ARRAY langsung di root), maka
    // tulis ulang sebagai path-path terpisah sebelum listener di bawah mulai
    // membaca. Supaya tidak men-download seluruh root setiap kali ada yang
    // login (mahal untuk database besar), kita cek dulu lewat path KECIL
    // `gwg_data/shared/_migratedV3` — hanya jika flag ini BELUM ada, baru kita
    // baca root sekali untuk migrasi, lalu set flag supaya login-login
    // berikutnya melewati langkah ini sepenuhnya.
    async function migrateIfNeeded() {
      try {
        const flagSnap = await get(ref(rtdb, `gwg_data/shared/_migratedV3`));
        if (flagSnap.val() === true) return; // sudah pernah dimigrasi, skip
        const rootSnap = await get(ref(rtdb, `gwg_data/shared`));
        const rootVal = rootSnap.val();
        const isOldShape = rootVal && LIST_TABLES.some(key => Array.isArray(rootVal[key]));
        if (isOldShape) {
          // PENTING: hanya tulis ulang key yang BENAR-BENAR ada (berbentuk array)
          // di rootVal. JANGAN looping semua LIST_TABLES tanpa pengecekan —
          // kalau root hanya berisi sebagian tabel (misal hasil import JSON
          // parsial / restrukturisasi manual lewat Firebase Console yang hanya
          // menyertakan sebagian data), arrToMap(undefined) akan menghasilkan
          // {} kosong dan ITU AKAN MENIMPA / MENGHAPUS data tabel lain yang
          // sebenarnya masih valid tersimpan di path-nya masing-masing. Ini
          // adalah akar bug "data lama hilang setelah deploy JSON baru".
          const writes = {};
          LIST_TABLES.forEach(key => {
            if (Array.isArray(rootVal[key])) writes[key] = arrToMap(rootVal[key]);
          });
          if (rootVal.stokAwal !== undefined) writes.stokAwal = rootVal.stokAwal || {};
          if (rootVal.bagiHasilConfig !== undefined) writes.bagiHasilConfig = rootVal.bagiHasilConfig ?? null;
          if (Object.keys(writes).length > 0) {
            await Promise.all(Object.entries(writes).map(([key, val]) =>
              set(ref(rtdb, `gwg_data/shared/${key}`), val)
            ));
          }
        }
        await set(ref(rtdb, `gwg_data/shared/_migratedV3`), true); // tandai selesai, walau tidak ada yang dimigrasi
      } catch (e) {
        console.warn("Migrasi struktur lama gagal (akan tetap lanjut baca per-path):", e);
      }
    }

    const unsubs = [];
    migrateIfNeeded().finally(() => {
      // Subscribe listener untuk daftar email yang sudah dihapus admin,
      // agar auto-register tidak mendaftarkan ulang pengguna yang dihapus.
      // PENTING: ikutkan "deletedUsers" ke dalam loadedSet tracking supaya
      // cloudLoaded tidak di-set true sebelum blacklist ini selesai diterima
      // dari Firebase — mencegah race condition di mana auto-register jalan
      // saat deletedUsersRef masih kosong meski pengguna sudah ada di blacklist.
      const deletedRef = ref(rtdb, `gwg_data/shared/deletedUsers`);
      const unsubDeleted = onValue(deletedRef, snap => {
        deletedUsersRef.current = snap.val() || {};
        loadedSet.add("deletedUsers");
        if (loadedSet.size >= paths.length + 1) { // +1 untuk deletedUsers
          setSyncing(false);
          setCloudLoaded(true);
        }
      });
      unsubs.push(() => off(deletedRef));

      const markLoadedAndFlush = (key) => {
        loadedSet.add(key);
        setLastSync(new Date());
        setSyncError(null);
        if (loadedSet.size >= paths.length + 1) { // +1 karena deletedUsers juga dihitung
          setSyncing(false);
          setCloudLoaded(true);
        }
      };

      paths.forEach(key => {
        const r = ref(rtdb, `gwg_data/shared/${key}`);

        if (key === "kontrol") {
          // ── "kontrol" dipartisi per-tahun: gwg_data/shared/kontrol/{tahun}/{id} ──
          // Kita hanya live-sync tahun berjalan + KONTROL_LIVE_YEARS-1 tahun
          // sebelumnya secara otomatis. Tahun-tahun lebih lama BELUM dimuat
          // sampai admin memanggil loadKontrolYear(tahun) secara eksplisit
          // (lihat tombol "Muat Data Tahun Lama" di menu Cadangan/Admin).
          const thisYear = new Date().getFullYear();
          const liveYears = Array.from({ length: KONTROL_LIVE_YEARS }, (_, i) => String(thisYear - i));

          const recomputeKontrolArr = () => {
            const merged = {};
            Object.values(kontrolByYearRef.current).forEach(yearMap => {
              Object.assign(merged, yearMap);
            });
            remoteRef.current.kontrol = merged;
            setDB(prev => {
              const next = { ...prev, kontrol: mapToArr(merged) };
              saveLocalDB(next);
              return next;
            });
          };

          const attachYearListener = (year, { countTowardBoot } = {}) => {
            if (kontrolYearUnsubsRef.current[year]) return; // sudah aktif
            const yr = ref(rtdb, `gwg_data/shared/kontrol/${year}`);
            kontrolByYearRef.current[year] = kontrolByYearRef.current[year] || {};
            let settleTimer = null, firstBatchDone = false;
            const settle = () => {
              if (settleTimer) clearTimeout(settleTimer);
              settleTimer = setTimeout(() => {
                firstBatchDone = true;
                recomputeKontrolArr();
                setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort());
                if (countTowardBoot) markLoadedAndFlush("kontrol");
              }, 400);
            };
            const uAdd = onChildAdded(yr, snap => {
              kontrolByYearRef.current[year][snap.key] = snap.val();
              if (!firstBatchDone) settle(); else recomputeKontrolArr();
            }, (err) => { setSyncError(err.message); if (countTowardBoot) markLoadedAndFlush("kontrol"); });
            onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (firstBatchDone) recomputeKontrolArr(); });
            onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; if (firstBatchDone) recomputeKontrolArr(); });
            const emptyFallback = setTimeout(() => {
              if (!firstBatchDone) { firstBatchDone = true; recomputeKontrolArr(); setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort()); if (countTowardBoot) markLoadedAndFlush("kontrol"); }
            }, 3000);
            kontrolYearUnsubsRef.current[year] = () => { off(yr); if (settleTimer) clearTimeout(settleTimer); clearTimeout(emptyFallback); };
            unsubs.push(kontrolYearUnsubsRef.current[year]);
          };

          // Index ringan berisi daftar SEMUA tahun yang punya data (tanpa
          // perlu download isi datanya) — dipakai untuk menampilkan pilihan
          // "muat data tahun lama" di UI tanpa biaya bandwidth besar.
          const idxRef = ref(rtdb, `gwg_data/shared/kontrolYearsIndex`);
          const unsubIdx = onValue(idxRef, snap => {
            const val = snap.val() || {};
            setAvailableKontrolYears(Object.keys(val).sort());
          });
          unsubs.push(() => off(idxRef));

          liveYears.forEach(y => attachYearListener(y, { countTowardBoot: true }));
          return;
        }

        if (LARGE_TABLES.has(key)) {
          // ── Sinkronisasi INKREMENTAL untuk tabel besar (kontrol/toko) ──
          const localMap = {};
          let settleTimer = null;
          let firstBatchDone = false;

          const flushToState = () => {
            remoteRef.current[key] = { ...localMap };
            setDB(prev => {
              const next = { ...prev, [key]: mapToArr(localMap) };
              saveLocalDB(next);
              return next;
            });
          };

          const scheduleSettle = () => {
            // Selama listener child_added masih "membanjir" data awal
            // (initial sync), tunda update UI sampai aliran berhenti
            // sejenak (~400ms tanpa event baru) — supaya kita tidak
            // re-render ribuan kali saat load pertama, dan supaya kita
            // tahu kapan "loading awal" boleh dianggap selesai.
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
              firstBatchDone = true;
              flushToState();
              markLoadedAndFlush(key);
            }, 400);
          };

          const unsubAdd = onChildAdded(r, snap => {
            localMap[snap.key] = snap.val();
            if (!firstBatchDone) scheduleSettle();
            else flushToState();
          }, (err) => { setSyncError(err.message); markLoadedAndFlush(key); });

          const unsubChg = onChildChanged(r, snap => {
            localMap[snap.key] = snap.val();
            if (firstBatchDone) flushToState();
          });

          const unsubRem = onChildRemoved(r, snap => {
            delete localMap[snap.key];
            if (firstBatchDone) flushToState();
          });

          // Jika tabel kosong (toko baru / kontrol belum pernah diisi),
          // child_added tidak akan pernah terpanggil sama sekali — pasang
          // fallback timer supaya bootstrap tidak menunggu selamanya.
          const emptyFallback = setTimeout(() => {
            if (!firstBatchDone) { firstBatchDone = true; flushToState(); markLoadedAndFlush(key); }
          }, 3000);

          unsubs.push(() => { off(r); if (settleTimer) clearTimeout(settleTimer); clearTimeout(emptyFallback); });
          return;
        }

        // ── Tabel kecil (wilayah/rute/produk/pengguna/dst): tetap pakai
        // onValue seperti semula — aman karena ukurannya tidak akan
        // membesar signifikan seiring waktu. ──
        const unsub = onValue(r, snap => {
          const val = snap.val();
          remoteRef.current[key] = val;
          setDB(prev => {
            const next = { ...prev };
            if (LIST_TABLES.includes(key)) next[key] = mapToArr(val);
            else next[key] = val ?? (key === "stokAwal" ? {} : null);
            saveLocalDB(next);
            return next;
          });
          markLoadedAndFlush(key);
        }, (err) => {
          setSyncing(false);
          setSyncError(err.message);
          setCloudLoaded(true); // gagal konek pun jangan sampai bootstrap menunggu selamanya
        });
        unsubs.push(() => off(r));
      });
    });

    return () => {
      unsubs.forEach(fn => fn());
      basePathRef.current = null;
      remoteRef.current = {};
    };
  }, [user]);

  // Memuat data kontrol satu tahun tertentu SECARA MANUAL (dipanggil dari
  // tombol UI), untuk tahun-tahun lama yang tidak otomatis live-sync.
  // Setelah dimuat, tahun itu ikut live-sync juga (listener tetap aktif
  // sampai komponen unmount/logout), dan langsung ikut tergabung ke
  // db.kontrol seperti tahun-tahun lain — tidak perlu ubah kode tab manapun.
  const loadKontrolYear = useCallback((year) => {
    if (!user || !firebaseDB) return;
    year = String(year);
    if (kontrolYearUnsubsRef.current[year]) return; // sudah dimuat
    const { db: rtdb, ref, onChildAdded, onChildChanged, onChildRemoved, off } = firebaseDB;
    const yr = ref(rtdb, `gwg_data/shared/kontrol/${year}`);
    kontrolByYearRef.current[year] = kontrolByYearRef.current[year] || {};
    let settleTimer = null, firstBatchDone = false;
    const recompute = () => {
      const merged = {};
      Object.values(kontrolByYearRef.current).forEach(m => Object.assign(merged, m));
      remoteRef.current.kontrol = merged;
      setDB(prev => {
        const next = { ...prev, kontrol: mapToArr(merged) };
        saveLocalDB(next);
        return next;
      });
    };
    const settle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        firstBatchDone = true;
        recompute();
        setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort());
      }, 400);
    };
    onChildAdded(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (!firstBatchDone) settle(); else recompute(); });
    onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (firstBatchDone) recompute(); });
    onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; if (firstBatchDone) recompute(); });
    setTimeout(() => { if (!firstBatchDone) { firstBatchDone = true; recompute(); setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort()); } }, 3000);
    kontrolYearUnsubsRef.current[year] = () => off(yr);
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────
  // MIGRASI STRUKTUR "kontrol" LAMA (flat: kontrol/{id}) → PARTISI TAHUN
  // (kontrol/{tahun}/{id}). Dipanggil MANUAL oleh Admin lewat tombol khusus
  // (bukan otomatis saat login) karena ini operasi besar & sekali jalan —
  // lebih aman diawasi langsung daripada berjalan diam-diam di background.
  // Aman dijalankan berkali-kali (idempotent): kalau data lama sudah tidak
  // ada di root flat, migrasi akan langsung melapor "tidak ada yang perlu
  // dimigrasi" tanpa melakukan apa-apa.
  // Urutan aman: (1) baca semua data lama, (2) tulis ke path tahun baru,
  // (3) BARU setelah tulis berhasil, hapus data lama dari root flat.
  // Backup otomatis harian tetap menyimpan salinan penuh sebelum ini, dan
  // sangat disarankan menekan "Unduh Backup Sekarang" secara manual dulu
  // sebelum menjalankan migrasi ini.
  const runKontrolYearMigration = useCallback(async () => {
    if (!user || !firebaseDB) return { ok: false, message: "Tidak ada koneksi cloud." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    try {
      const rootSnap = await get(ref(rtdb, `gwg_data/shared/kontrol`));
      const rootVal = rootSnap.val() || {};
      // Pisahkan: key yang berbentuk TAHUN (4 digit, sudah dipartisi) vs
      // key yang berbentuk ID record lama (flat, masih perlu dimigrasi).
      const oldFlatEntries = Object.entries(rootVal).filter(([k, v]) => !/^\d{4}$/.test(k) && v && typeof v === "object");
      if (oldFlatEntries.length === 0) {
        return { ok: true, message: "Tidak ada data lama untuk dimigrasi — struktur sudah rapi." };
      }
      const byYear = {};
      oldFlatEntries.forEach(([id, rec]) => {
        const y = kontrolYearOf(rec);
        (byYear[y] = byYear[y] || {})[id] = rec;
      });
      // Tahap 1: tulis ke struktur baru (MERGE per tahun, tidak menimpa
      // tahun yang mungkin sudah sebagian terisi dari migrasi sebelumnya).
      for (const [year, recs] of Object.entries(byYear)) {
        const existingSnap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
        const merged = { ...(existingSnap.val() || {}), ...recs };
        await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), merged);
        await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), true);
      }
      // Tahap 2: verifikasi tulisan berhasil sebelum menghapus data lama.
      for (const [year, recs] of Object.entries(byYear)) {
        const checkSnap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
        const checkVal = checkSnap.val() || {};
        const missing = Object.keys(recs).filter(id => !checkVal[id]);
        if (missing.length > 0) {
          return { ok: false, message: `Verifikasi gagal untuk tahun ${year} (${missing.length} record tidak ditemukan). Migrasi DIHENTIKAN sebelum menghapus data lama — data lama masih utuh, aman dicoba lagi.` };
        }
      }
      // Tahap 3: baru sekarang hapus entri lama dari root flat, satu per satu.
      for (const [id] of oldFlatEntries) {
        await set(ref(rtdb, `gwg_data/shared/kontrol/${id}`), null);
      }
      return { ok: true, message: `Migrasi selesai: ${oldFlatEntries.length} record dipindahkan ke ${Object.keys(byYear).length} tahun (${Object.keys(byYear).sort().join(", ")}).` };
    } catch (e) {
      return { ok: false, message: `Migrasi gagal: ${e.message}. Data lama TIDAK dihapus (aman).` };
    }
  }, [user]);

  // Status antrean tulis offline — jumlah perubahan yang BELUM berhasil
  // dikirim ke Firebase (tersimpan aman di IndexedDB). Dipakai untuk
  // menampilkan "N perubahan menunggu sinkron" di header.
  const [pendingSync, setPendingSync] = useState(0);
  const flushingRef = useRef(false);
  const refreshPendingCount = useCallback(() => {
    queueCount().then(setPendingSync);
  }, []);

  // Kirim ulang SEMUA perubahan yang masih tertunda di antrean lokal, satu
  // per satu, secara berurutan (path yang sama hanya tersimpan sebagai versi
  // TERAKHIR — lihat queueWrite). Kalau satu path gagal (kemungkinan besar
  // masih offline), langsung berhenti — sisanya dicoba lagi di kesempatan
  // berikutnya (event 'online' berikutnya / retry berkala), supaya tidak
  // spam percobaan yang pasti gagal saat memang belum ada sinyal.
  const flushWriteQueue = useCallback(async () => {
    if (!firebaseDB || !basePathRef.current || flushingRef.current) return;
    flushingRef.current = true;
    try {
      const { db: rtdb, ref, set } = firebaseDB;
      const entries = await queueGetAll();
      for (const { path, value } of entries) {
        try {
          await set(ref(rtdb, `gwg_data/shared/${path}`), value);
          await queueRemove(path);
        } catch (e) {
          console.warn("Sinkron tertunda (kemungkinan masih offline):", path, e);
          break; // hentikan, coba lagi nanti begitu online/retry berikutnya
        }
      }
    } finally {
      flushingRef.current = false;
      refreshPendingCount();
    }
  }, [refreshPendingCount]);

  // Coba flush antrean: (1) begitu user login & Firebase siap — menyapu
  // sisa antrean dari sesi sebelumnya yang mungkin belum sempat terkirim;
  // (2) setiap kali koneksi kembali online; (3) berkala tiap 30 detik
  // sebagai jaring pengaman untuk kondisi sinyal naik-turun (lebih andal
  // daripada hanya mengandalkan event 'online' browser, yang di HP kadang
  // tidak selalu akurat mendeteksi koneksi data seluler yang lemah).
  useEffect(() => {
    if (!user || !firebaseDB) return;
    refreshPendingCount();
    flushWriteQueue();
    const onOnline = () => flushWriteQueue();
    window.addEventListener("online", onOnline);
    const interval = setInterval(flushWriteQueue, 30000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [user, flushWriteQueue, refreshPendingCount]);

  // Tulis HANYA path/record yang benar-benar berubah. Setiap perubahan
  // SELALU dicatat dulu ke antrean lokal durable (IndexedDB) — baru
  // kemudian dicoba dikirim ke Firebase. Kalau gagal/offline, perubahan
  // TETAP AMAN tersimpan di antrean dan otomatis dikirim ulang begitu
  // koneksi kembali, walau app sempat ditutup/HP mati di antaranya.
  const pushUpdates = useCallback((updates) => {
    const entries = Object.entries(updates).map(([path, value]) => [path, value === undefined ? null : value]);
    Promise.all(entries.map(([path, value]) => queueWrite(path, value))).then(refreshPendingCount);
    if (!user || !firebaseDB || !basePathRef.current) return;
    flushWriteQueue();
  }, [user, flushWriteQueue, refreshPendingCount]);

  // save() generik dipertahankan agar kode lama (stok update, import excel,
  // config bagi hasil) yang memanggil save(newDB) tetap berfungsi tanpa
  // diubah. Di balik layar, fungsi ini menghitung DIFF per-tabel terhadap
  // state sebelumnya dan hanya mengirim tabel yang berubah ke Firebase
  // (bukan seluruh database), serta menulis tabel sebagai MAP per-id
  // (bukan array besar) supaya update 1 toko = 1 path kecil, bukan 1 blob.
  const save = useCallback((newDB) => {
    setDB(prevDB => {
      const updates = {};
      LIST_TABLES.forEach(key => {
        if (newDB[key] === prevDB[key]) return;
        if (key === "kontrol") {
          // "kontrol" TIDAK ditulis sebagai satu blob di root — dipecah per
          // tahun. Kita hanya berwenang atas tahun-tahun yang SEDANG dimuat
          // (ada di prevDB.kontrol atau newDB.kontrol); tahun lain yang
          // belum dimuat sama sekali TIDAK disentuh sama sekali, supaya
          // save() bulk tidak pernah menimpa data tahun yang belum dimuat.
          const byYear = {};
          (newDB.kontrol || []).forEach(rec => {
            const y = kontrolYearOf(rec);
            (byYear[y] = byYear[y] || {})[rec.id] = rec;
          });
          const prevYears = new Set((prevDB.kontrol || []).map(kontrolYearOf));
          const touchedYears = new Set([...Object.keys(byYear), ...prevYears]);
          touchedYears.forEach(y => {
            updates[`kontrol/${y}`] = byYear[y] || null; // null = tahun itu jadi kosong
            if (byYear[y]) updates[`kontrolYearsIndex/${y}`] = true;
          });
          return;
        }
        updates[key] = arrToMap(newDB[key]);
      });
      if (newDB.stokAwal !== prevDB.stokAwal) updates.stokAwal = newDB.stokAwal || {};
      if (newDB.bagiHasilConfig !== prevDB.bagiHasilConfig) updates.bagiHasilConfig = newDB.bagiHasilConfig ?? null;
      if (Object.keys(updates).length) pushUpdates(updates);
      saveLocalDB(newDB);
      return newDB;
    });
  }, [pushUpdates]);

  // addRecord/updateRecord/deleteRecord ditulis ulang agar masing-masing
  // HANYA mengirim 1 record (path "table/id"), bukan seluruh tabel —
  // jauh lebih hemat bandwidth saat toko sudah ribuan & kontrol terus bertambah.
  // Untuk tabel "kontrol" khusus, path ditulis sebagai "kontrol/{tahun}/{id}"
  // (partisi tahun) alih-alih "kontrol/{id}".
  const addRecord = useCallback((table, record) => {
    setDB(prevDB => {
      const nextArr = [...(prevDB[table]||[]), record];
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      if (table === "kontrol") {
        const y = kontrolYearOf(record);
        pushUpdates({ [`kontrol/${y}/${record.id}`]: record, [`kontrolYearsIndex/${y}`]: true });
      } else {
        pushUpdates({ [`${table}/${record.id}`]: record });
      }
      return next;
    });
  }, [pushUpdates]);

  const updateRecord = useCallback((table, id, updated) => {
    setDB(prevDB => {
      let oldRecord = null, mergedRecord = null;
      const nextArr = (prevDB[table]||[]).map(r => {
        if (r.id !== id) return r;
        oldRecord = r;
        mergedRecord = { ...r, ...updated };
        return mergedRecord;
      });
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      if (mergedRecord) {
        if (table === "kontrol") {
          const oldYear = kontrolYearOf(oldRecord);
          const newYear = kontrolYearOf(mergedRecord);
          if (oldYear !== newYear) {
            // Tanggal record diedit lintas-tahun: pindahkan node-nya.
            pushUpdates({
              [`kontrol/${oldYear}/${id}`]: null,
              [`kontrol/${newYear}/${id}`]: mergedRecord,
              [`kontrolYearsIndex/${newYear}`]: true,
            });
          } else {
            pushUpdates({ [`kontrol/${newYear}/${id}`]: mergedRecord });
          }
        } else {
          pushUpdates({ [`${table}/${id}`]: mergedRecord });
        }
      }
      return next;
    });
  }, [pushUpdates]);

  const deleteRecord = useCallback((table, id) => {
    setDB(prevDB => {
      const targetRecord = table === "kontrol" ? (prevDB[table]||[]).find(r => r.id === id) : null;
      const nextArr = (prevDB[table]||[]).filter(r => r.id !== id);
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      // Jika menghapus pengguna, tandai emailnya di blacklist agar tidak
      // auto-register ulang ketika pengguna tersebut refresh browser.
      // KECUALI untuk email Super Admin — akun ini TIDAK BOLEH pernah masuk
      // blacklist, walau baris yang dihapus cuma duplikat lama. Tanpa
      // pengecualian ini, membersihkan baris duplikat Super Admin bisa
      // tanpa sengaja memblokir akun Super Admin asli selamanya dari
      // auto-register (bug: "data hilang, tidak bisa akses reset database").
      if (table === "pengguna") {
        const deletedUser = (prevDB[table]||[]).find(r => r.id === id);
        if (deletedUser?.email && !isSuperAdminEmail(deletedUser.email)) {
          const emailKey = encodeEmailKey(deletedUser.email);
          // Tulis langsung ke path khusus di luar shared (bukan lewat pushUpdates)
          if (firebaseDB && basePathRef.current) {
            const { db: rtdb, ref: fbRef, set } = firebaseDB;
            set(fbRef(rtdb, `gwg_data/shared/deletedUsers/${emailKey}`), true).catch(console.warn);
            // Update ref lokal segera agar cek langsung efektif
            deletedUsersRef.current = { ...deletedUsersRef.current, [emailKey]: true };
          }
          // Simpan juga di localStorage sebagai fallback offline
          try {
            const localDeleted = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
            localDeleted[emailKey] = true;
            localStorage.setItem("gwg_deletedUsers", JSON.stringify(localDeleted));
          } catch {}
        }
      }
      if (table === "kontrol" && targetRecord) {
        pushUpdates({ [`kontrol/${kontrolYearOf(targetRecord)}/${id}`]: null });
      } else {
        pushUpdates({ [`${table}/${id}`]: null }); // null = hapus path ini saja di Firebase
      }
      return next;
    });
  }, [pushUpdates]);

  const updateStokToko = useCallback((tokoId, produkId, jumlah) => {
    setDB(prevDB => {
      let mergedRecord = null;
      const nextArr = prevDB.toko.map(t => {
        if (t.id !== tokoId) return t;
        mergedRecord = { ...t, [`stok_${produkId}`]: jumlah };
        return mergedRecord;
      });
      const next = { ...prevDB, toko: nextArr };
      saveLocalDB(next);
      if (mergedRecord) pushUpdates({ [`toko/${tokoId}`]: mergedRecord });
      return next;
    });
  }, [pushUpdates]);

  const resetDB = useCallback(() => {
    // PENGAMAN TAMBAHAN: selalu backup snapshot SEBELUM data dihapus, supaya
    // kalau reset ternyata tidak disengaja, masih ada cara memulihkannya
    // lewat menu "Riwayat Backup" (lihat backupNow/listBackups/restoreBackup
    // di bawah).
    backupNow(db, { reason: "sebelum-reset" });
    setDB(DB_EMPTY);
    saveLocalDB(DB_EMPTY);
    // Reset menghapus SETIAP path tabel secara eksplisit (bukan menulis satu
    // blob kosong ke root), supaya konsisten dengan skema per-path di atas.
    const updates = {};
    LIST_TABLES.forEach(key => { updates[key] = null; });
    updates.stokAwal = null;
    updates.bagiHasilConfig = null;
    updates.kontrolYearsIndex = null; // index tahun kontrol — ikut dibersihkan saat reset
    pushUpdates(updates);
    // Reset juga state lokal partisi-tahun supaya UI tidak menampilkan
    // tahun-tahun "sudah dimuat" dari sesi sebelum reset.
    kontrolByYearRef.current = {};
    setLoadedKontrolYears([]);
    setAvailableKontrolYears([]);
  }, [pushUpdates, db]);

  // ───────────────────────────────────────────────────────────────────────
  // BACKUP OTOMATIS & MANUAL
  // Tujuannya: kalaupun suatu saat ada kesalahan deploy/import/reset lagi,
  // selalu ada salinan yang bisa dipulihkan. Backup disimpan dengan KEY =
  // tanggal (YYYY-MM-DD), jadi backup di hari yang sama akan menimpa backup
  // hari itu saja (tidak menumpuk tanpa batas), dan backup lebih tua dari
  // MAX_BACKUPS hari otomatis dibersihkan.
  // ───────────────────────────────────────────────────────────────────────
  // Diturunkan dari 30 → 10 hari. Backup adalah SALINAN PENUH seluruh
  // database (termasuk tabel "kontrol" yang akan terus membesar selama
  // bertahun-tahun), jadi menyimpan 30 salinan penuh sekaligus adalah
  // pengguna kuota storage gratis Firebase (1GB) paling boros — bisa habis
  // jauh sebelum data penjualan asli sendiri mendekati batas itu. 10 hari
  // masih cukup untuk jaga-jaga kalau ada kesalahan input/impor yang baru
  // ketahuan beberapa hari kemudian.
  const MAX_BACKUPS = 10;

  const backupNow = useCallback(async (dbToBackup, { reason = "manual" } = {}) => {
    const nowIso = new Date().toISOString();
    const snapshot = { ts: nowIso, reason, data: dbToBackup };
    const dateKey = nowIso.slice(0, 10); // YYYY-MM-DD

    // 1) Salinan lokal — selalu jalan, bahkan tanpa login/Firebase.
    try { localStorage.setItem(`gwg_backup_${dateKey}`, JSON.stringify(snapshot)); } catch {}

    // 2) Salinan cloud — supaya bisa dipulihkan dari perangkat lain juga.
    // Status keberhasilannya dikembalikan (cloudOk/cloudError), BUKAN cuma
    // di-console.warn diam-diam, supaya tombol di UI bisa menampilkan pesan
    // sukses/gagal yang sesungguhnya ke pengguna — sebelumnya tombol "Simpan
    // Snapshot ke Cloud" tidak memberi konfirmasi apa pun walau gagal.
    let cloudOk = false, cloudError = null;
    if (!user) {
      cloudError = "Belum login — backup cloud butuh akun Google aktif.";
    } else if (!firebaseDB) {
      cloudError = "Firebase belum aktif (aplikasi berjalan di Mode Lokal).";
    } else {
      try {
        const { db: rtdb, ref, set, get } = firebaseDB;
        await set(ref(rtdb, `gwg_data/_backups/${dateKey}`), snapshot);
        cloudOk = true;
        const listSnap = await get(ref(rtdb, `gwg_data/_backups`));
        const all = listSnap.val();
        if (all) {
          const keys = Object.keys(all).sort(); // format YYYY-MM-DD bisa diurutkan sebagai string
          const excess = keys.length - MAX_BACKUPS;
          if (excess > 0) {
            await Promise.all(keys.slice(0, excess).map(k => set(ref(rtdb, `gwg_data/_backups/${k}`), null)));
          }
        }
      } catch (e) {
        console.warn("Backup ke cloud gagal (salinan lokal tetap tersimpan):", e);
        cloudError = e.message;
      }
    }
    return { snapshot, cloudOk, cloudError };

  }, [user]);

  // Auto-backup 1x per hari per perangkat. Dipasang lewat efek terpisah agar
  // berjalan sendiri tanpa perlu dipanggil manual dari komponen UI, dan baru
  // jalan setelah cloudLoaded supaya tidak membackup data kosong/parsial yang
  // belum selesai sinkron dari Firebase.
  useEffect(() => {
    if (!cloudLoaded) return;
    if (!db || (db.pengguna || []).length === 0) return; // belum ada data nyata, lewati
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem("gwg_last_autobackup") === today) return;
      backupNow(db, { reason: "auto-harian" });
      localStorage.setItem("gwg_last_autobackup", today);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudLoaded, db, backupNow]);

  // Daftar backup yang tersedia di cloud, untuk ditampilkan di menu Admin.
  const listBackups = useCallback(async () => {
    if (!firebaseDB) return [];
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/_backups`));
      const all = snap.val() || {};
      return Object.entries(all)
        .map(([key, val]) => ({ key, ts: val?.ts, reason: val?.reason, data: val?.data }))
        .sort((a, b) => b.key.localeCompare(a.key));
    } catch (e) {
      console.warn("Gagal memuat daftar backup:", e);
      return [];
    }
  }, []);

  // Restore dari satu snapshot backup — menulis ulang SEMUA tabel secara
  // eksplisit (beda dengan save() yang hanya mengirim yang berubah), supaya
  // hasil restore benar-benar identik dengan snapshot yang dipilih.
  //
  // PENTING (bugfix): versi lama fungsi ini menulis "kontrol" lewat
  // pushUpdates() sama seperti tabel kecil lainnya — sebagai SATU blob flat
  // di root path "kontrol". Padahal listener pembaca kontrol HANYA membaca
  // path "kontrol/{tahun}/{id}" (dipartisi per tahun). Akibatnya data
  // kontrol/penjualan hasil restore tertulis ke Firebase, tapi di path yang
  // tidak pernah dibaca ulang oleh aplikasi → terlihat "hilang" setelah
  // refresh/login ulang. Sekarang "kontrol" ditulis terpisah, dipartisi per
  // tahun, SAMA PERSIS seperti save()/addRecord().
  //
  // Selain itu, semua penulisan sekarang di-await dan errornya dikumpulkan
  // lalu dikembalikan ke pemanggil (bukan cuma console.warn diam-diam),
  // supaya kalau tabel besar (toko/kontrol) gagal tertulis karena koneksi
  // terputus, ADMIN DIBERI TAHU — bukan mengira restore sudah berhasil.
  const restoreBackup = useCallback(async (snapshotData) => {
    const restored = { ...DB_EMPTY, ...snapshotData };
    setDB(restored);
    saveLocalDB(restored);

    const failed = [];

    if (firebaseDB) {
      const { db: rtdb, ref, set } = firebaseDB;
      const writeTable = async (key, value) => {
        try { await set(ref(rtdb, `gwg_data/shared/${key}`), value); }
        catch (e) { console.warn(`Gagal restore tabel "${key}":`, e); failed.push(key); }
      };
      await Promise.all([
        writeTable("wilayah", arrToMap(restored.wilayah)),
        writeTable("rute", arrToMap(restored.rute)),
        writeTable("toko", arrToMap(restored.toko)),
        writeTable("produk", arrToMap(restored.produk)),
        writeTable("pengguna", arrToMap(restored.pengguna)),
        writeTable("penyesuaian", arrToMap(restored.penyesuaian)),
        writeTable("penjualanLuar", arrToMap(restored.penjualanLuar)),
        writeTable("stokAwal", restored.stokAwal || {}),
        writeTable("bagiHasilConfig", restored.bagiHasilConfig ?? null),
      ]);

      // "kontrol" — bersihkan dulu node lama (termasuk sisa blob flat dari
      // restore versi lama, kalau ada) SEBELUM menulis partisi baru, supaya
      // tidak ada data ganda/nyasar tercampur di root "kontrol".
      try {
        await set(ref(rtdb, `gwg_data/shared/kontrol`), null);
        const kontrolByYear = {};
        (restored.kontrol || []).forEach(rec => {
          const y = kontrolYearOf(rec);
          (kontrolByYear[y] = kontrolByYear[y] || {})[rec.id] = rec;
        });
        for (const [year, recs] of Object.entries(kontrolByYear)) {
          await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), recs);
          await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), true);
        }
      } catch (e) {
        console.warn('Gagal restore tabel "kontrol":', e);
        failed.push("kontrol");
      }
    } else {
      // Mode lokal tanpa Firebase: cukup pushUpdates seperti semula.
      const updates = {};
      LIST_TABLES.forEach(key => { updates[key] = arrToMap(restored[key]); });
      updates.stokAwal = restored.stokAwal || {};
      updates.bagiHasilConfig = restored.bagiHasilConfig ?? null;
      pushUpdates(updates);
    }

    if (failed.length > 0) {
      return { ok: false, failed, message: `Sebagian data GAGAL disimpan ke cloud (kemungkinan koneksi terputus): ${failed.join(", ")}. Coba ulangi restore dengan koneksi lebih stabil — jangan tutup halaman saat proses berjalan.` };
    }
    return { ok: true };
  }, [pushUpdates]);

  // ─────────────────────────────────────────────
  //  ARSIP TAHUN LAMA (Google Drive) — hemat kuota Realtime Database
  // ─────────────────────────────────────────────
  // "kontrol" adalah tabel yang paling cepat membesar (bertambah tiap
  // kunjungan x tiap toko x tiap bulan), jadi paling berpengaruh ke kuota
  // gratis RTDB (1GB). Data tahun-tahun lama jarang dibuka lagi setelah
  // laporan tahunannya selesai, jadi kita pindahkan ke Google Drive (15GB
  // gratis, tanpa perlu upgrade paket Firebase) sebagai SATU file JSON per
  // tahun — jauh lebih hemat daripada tetap tersimpan sebagai ribuan node
  // di RTDB. Data TIDAK dihapus permanen: tetap bisa dilihat & diexport
  // kapan saja lewat viewArchivedKontrolYear di bawah.
  //
  // Index ringan (fileId per tahun) disimpan di RTDB path
  // `kontrolArchiveIndex` supaya daftar "sudah diarsipkan" bisa ditampilkan
  // tanpa perlu login/panggil Drive API dulu — token Google (popup) baru
  // diminta saat admin benar-benar klik Lihat/Export/Hapus/Arsipkan.
  const [archivedKontrolYears, setArchivedKontrolYears] = useState([]); // tahun yang sudah diarsipkan (dari index ringan)
  const archiveIndexRef = useRef({}); // { [year]: { fileId, driveLink } } — untuk lookup fileId tanpa query ulang

  const refreshArchivedYears = useCallback(async () => {
    if (!firebaseDB) return;
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex`));
      const all = snap.val() || {};
      archiveIndexRef.current = all;
      setArchivedKontrolYears(Object.keys(all).sort());
    } catch (e) { console.warn("Gagal memuat daftar arsip:", e); }
  }, []);

  useEffect(() => { if (user && firebaseDB) refreshArchivedYears(); }, [user, refreshArchivedYears]);

  // Pindahkan satu tahun data kontrol dari RTDB → Google Drive.
  // Urutan PENTING demi keamanan data: upload & VERIFIKASI dulu baru hapus
  // dari RTDB — kalau upload gagal di tengah jalan, data asli di RTDB tidak
  // disentuh sama sekali (tidak ada risiko kehilangan data).
  const archiveKontrolYear = useCallback(async (year) => {
    year = String(year);
    if (!user || !firebaseDB) return { ok: false, message: "Firebase belum siap." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    try {
      // 1) Ambil seluruh data tahun ini langsung dari RTDB (bukan dari
      //    state lokal, supaya akurat walau tahun ini belum/sudah pernah
      //    dimuat manual di perangkat ini).
      const snap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
      const yearData = snap.val();
      if (!yearData || Object.keys(yearData).length === 0) {
        return { ok: false, message: `Tidak ada data kontrol tahun ${year} untuk diarsipkan.` };
      }
      const recordCount = Object.keys(yearData).length;

      // 2) Upload sebagai satu file JSON ke Google Drive. Kalau upload
      //    gagal (exception dilempar dari dalam gdriveUploadJSON), fungsi
      //    berhenti di sini lewat catch di bawah — RTDB tidak disentuh.
      const archivedAt = new Date().toISOString();
      const fileData = await gdriveUploadJSON(
        `gwg_arsip_kontrol_${year}.json`,
        { year, archivedAt, recordCount, data: yearData },
        `GWG SuperApp - Arsip Kontrol Bulanan tahun ${year}`
      );
      if (!fileData?.id) {
        return { ok: false, message: "Upload arsip tampak gagal (tidak dapat file ID) — data ASLI di database tidak diubah, aman untuk dicoba lagi." };
      }

      // 3) Baru sekarang aman menghapus dari RTDB + hentikan listener
      //    tahun tsb kalau sedang aktif, dan perbarui index (sekarang
      //    menyimpan fileId Drive, bukan cuma `true`).
      if (kontrolYearUnsubsRef.current[year]) {
        kontrolYearUnsubsRef.current[year]();
        delete kontrolYearUnsubsRef.current[year];
      }
      delete kontrolByYearRef.current[year];
      await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), null);
      await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), null);
      await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), {
        fileId: fileData.id,
        driveLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
        archivedAt, recordCount,
      });

      // 4) Bersihkan tahun ini dari state lokal (db.kontrol gabungan)
      //    supaya UI tidak lagi menampilkan data yang sudah dipindah.
      setLoadedKontrolYears(prev => prev.filter(y => y !== year));
      setDB(prev => {
        const next = { ...prev, kontrol: prev.kontrol.filter(rec => kontrolYearOf(rec) !== year) };
        saveLocalDB(next);
        return next;
      });
      await refreshArchivedYears();

      return { ok: true, recordCount, message: `${recordCount} data kontrol tahun ${year} berhasil diarsipkan ke Google Drive dan dihapus dari database aktif.` };
    } catch (e) {
      console.warn(`Gagal mengarsipkan tahun ${year}:`, e);
      return { ok: false, message: `Gagal mengarsipkan: ${e.message}. Data ASLI tidak diubah — aman untuk dicoba lagi.` };
    }
  }, [user, refreshArchivedYears]);

  // Unduh & baca isi satu file arsip dari Drive — HANYA UNTUK DILIHAT/
  // DIEXPORT, tidak ditulis balik ke db.kontrol aktif (supaya tidak
  // tercampur/konflik dengan data yang sedang live-sync). Dipanggil dari
  // UI saat admin klik "Lihat" pada tahun yang sudah diarsipkan.
  const viewArchivedKontrolYear = useCallback(async (year) => {
    year = String(year);
    const entry = archiveIndexRef.current[year];
    if (!entry?.fileId) return { ok: false, message: "Data arsip tahun ini tidak ditemukan di index.", records: [] };
    try {
      const parsed = await gdriveDownloadJSON(entry.fileId);
      const records = mapToArr(parsed.data || {});
      return { ok: true, records, archivedAt: parsed.archivedAt, recordCount: parsed.recordCount ?? records.length };
    } catch (e) {
      console.warn(`Gagal membaca arsip tahun ${year}:`, e);
      return { ok: false, message: `Gagal membuka arsip dari Google Drive: ${e.message}`, records: [] };
    }
  }, []);

  // Export arsip ke file yang bisa dibuka di HP/komputer manapun (JSON
  // mentah — untuk Excel/CSV, ambil `records`-nya lewat viewArchivedKontrolYear
  // lalu pakai exportExcel/exportCSV yang sudah ada, dipanggil dari UI).
  const exportArchivedKontrolYear = useCallback(async (year) => {
    const result = await viewArchivedKontrolYear(year);
    if (!result.ok) return result;
    downloadJSON(`arsip_kontrol_${year}`, result.records);
    return result;
  }, [viewArchivedKontrolYear]);

  // Hapus permanen satu arsip dari Google Drive (dipisah dari
  // archiveKontrolYear supaya penghapusan permanen selalu perlu langkah
  // eksplisit tersendiri dari admin — bukan efek samping otomatis dari
  // aksi lain).
  const deleteArchivedKontrolYear = useCallback(async (year) => {
    year = String(year);
    const entry = archiveIndexRef.current[year];
    if (!firebaseDB) return { ok: false, message: "Firebase belum siap." };
    if (!entry?.fileId) return { ok: false, message: "Data arsip tahun ini tidak ditemukan di index." };
    try {
      await gdriveDeleteFile(entry.fileId);
      const { db: rtdb, ref, set } = firebaseDB;
      await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), null);
      await refreshArchivedYears();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `Gagal menghapus arsip dari Google Drive: ${e.message}` };
    }
  }, [refreshArchivedYears]);

  // Ambil daftar email yang sedang diblokir (sudah dihapus admin) dari
  // Firebase, supaya bisa ditampilkan & dikelola di UI Tab Pengguna.
  const listDeletedUsers = useCallback(async () => {
    if (!firebaseDB) {
      // Mode lokal (tanpa Firebase): baca dari localStorage saja
      try {
        const local = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
        return Object.keys(local).map(key => ({ key, email: decodeEmailKey(key) }));
      } catch { return []; }
    }
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/deletedUsers`));
      const all = snap.val() || {};
      return Object.keys(all).map(key => ({ key, email: decodeEmailKey(key) }));
    } catch (e) {
      console.warn("Gagal memuat daftar email diblokir:", e);
      return [];
    }
  }, []);

  // Hapus satu email dari blacklist, supaya pengguna tsb bisa kembali
  // ter-auto-register (sebagai Sales) saat login berikutnya.
  const restoreDeletedUser = useCallback((emailKey) => {
    if (firebaseDB) {
      const { db: rtdb, ref, set } = firebaseDB;
      set(ref(rtdb, `gwg_data/shared/deletedUsers/${emailKey}`), null).catch(console.warn);
    }
    deletedUsersRef.current = { ...deletedUsersRef.current };
    delete deletedUsersRef.current[emailKey];
    try {
      const local = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
      delete local[emailKey];
      localStorage.setItem("gwg_deletedUsers", JSON.stringify(local));
    } catch {}
  }, []);

  return { db, addRecord, updateRecord, deleteRecord, resetDB, updateStokToko, save, syncing, lastSync, syncError, pendingSync, cloudLoaded, backupNow, listBackups, restoreBackup, deletedUsersRef, listDeletedUsers, restoreDeletedUser, loadedKontrolYears, availableKontrolYears, loadKontrolYear, runKontrolYearMigration, archivedKontrolYears, archiveKontrolYear, viewArchivedKontrolYear, exportArchivedKontrolYear, deleteArchivedKontrolYear };
}



// ─────────────────────────────────────────────
//  DERIVED ANALYTICS
// ─────────────────────────────────────────────
function useAnalytics(db) {
  return useMemo(() => {
    const harga = {};
    (db.produk||[]).forEach(p => { harga[p.id] = p.harga; });

    const enrichKontrol = (db.kontrol||[]).map(k => {
      let totalRev = 0;
      let totalTerjual = 0;
      let totalStok = 0;
      let totalBonus = 0;
      (db.produk||[]).forEach(p => {
        const terjual = k[`terjual_${p.id}`] || 0;
        const stok = k[`stok_${p.id}`] || 0;
        // ⚠️ FIX BUG: dulu totalBonus tidak pernah dihitung di sini, jadi
        // Dashboard & tab Rekap (yang sumbernya analytics.kontrol ini)
        // menampilkan angka 0/stale, beda dengan tab Kontrol yang punya
        // perhitungan bonus sendiri (bonusInput_ jika diisi, kalau tidak
        // pakai default bonus produk). Disamakan rumusnya di sini.
        const bonusPcs = k[`bonusInput_${p.id}`] !== undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0);
        totalRev += terjual * (p.harga || 0);
        totalTerjual += terjual;
        totalStok += stok;
        totalBonus += bonusPcs;
      });
      let status = "⚪ Kosong";
      if (totalStok > 0) {
        if (totalTerjual === totalStok) status = "✅ Habis";
        else if (totalTerjual === 0) status = "🔴 Belum Laku";
        else status = "🟢 Laku Sebagian";
      }
      const toko = (db.toko||[]).find(t => t.id === k.tokoId);
      const rute = toko ? (db.rute||[]).find(r => r.id === toko.ruteId) : null;
      const wilayah = rute ? (db.wilayah||[]).find(w => w.id === rute.wilayahId) : null;
      return { ...k, totalRev, totalTerjual, totalStok, totalBonus, status, toko, rute, wilayah,
        tokoNama: toko?.nama||"?", ruteNama: rute?.nama||"?", wilayahNama: wilayah?.nama||"?",
        ruteId: rute?.id||"", wilayahId: wilayah?.id||"" };
    });

    // ✅ Penjualan Luar Rute: transaksi produk di luar kunjungan rute normal
    // (rute lain saat itu, atau penjualan perorangan) di mana sales tidak
    // tahu/lupa nama toko & rutenya. Tidak terikat ke toko manapun, tapi
    // tetap dihitung sebagai pendapatan & laba perusahaan.
    const enrichLuarRute = (db.penjualanLuar||[]).map(pl => {
      let totalRev = 0, totalTerjual = 0, totalBonus = 0;
      (db.produk||[]).forEach(p => {
        const terjual = pl[`terjual_${p.id}`] || 0;
        totalRev += terjual * (p.harga || 0);
        totalTerjual += terjual;
        totalBonus += Number(pl[`bonusInput_${p.id}`]||0);
      });
      // ✅ wilayahNama: supaya penjualan luar rute bisa dikaitkan & ditampilkan
      // per wilayah (mis. di Rekap Siklus), bukan cuma catatan yang mengambang.
      const wilayah = (db.wilayah||[]).find(w => w.id === pl.wilayahId);
      return { ...pl, totalRev, totalTerjual, totalBonus, wilayahNama: wilayah?.nama||"" };
    });
    const totalRevLuarRute = enrichLuarRute.reduce((s,k) => s + k.totalRev, 0);

    const totalRev = enrichKontrol.reduce((s,k) => s + k.totalRev, 0) + totalRevLuarRute;
    const tokoAktif = (db.toko||[]).filter(t => t.status==="Aktif").length;
    const labaBersih = totalRev * 0.7;

    const perWilayah = (db.wilayah||[]).map(w => {
      const rows = enrichKontrol.filter(k => k.wilayah?.id === w.id);
      return {
        ...w,
        rev: rows.reduce((s,k) => s + k.totalRev, 0),
        terjual: rows.reduce((s,k) => s + k.totalTerjual, 0),
        tokoCount: (db.toko||[]).filter(t => {
          const rute = (db.rute||[]).find(r => r.id === t.ruteId);
          return rute?.wilayahId === w.id;
        }).length,
      };
    });

    const perRute = (db.rute||[]).map(r => {
      const wil = (db.wilayah||[]).find(w => w.id === r.wilayahId);
      const rows = enrichKontrol.filter(k => k.rute?.id === r.id);
      return {
        ...r, wilayahNama: wil?.nama||"-",
        rev: rows.reduce((s,k) => s + k.totalRev, 0),
        tokoCount: (db.toko||[]).filter(t => t.ruteId === r.id).length,
      };
    })
      // Urutkan sama seperti Master Rute: per Wilayah (abjad) dulu, lalu
      // Nama Rute dengan natural sort — supaya daftar "Rute Aktif" di
      // Dashboard tidak tampil acak sesuai urutan input data.
      .sort((a,b) => {
        const wCompare = (a.wilayahNama||"").localeCompare(b.wilayahNama||"", "id", { sensitivity:"base" });
        if (wCompare !== 0) return wCompare;
        return naturalCompare(a.nama||"", b.nama||"");
      });

    const produkStats = (db.produk||[]).map(p => ({
      ...p,
      terjual: enrichKontrol.reduce((s,k) => s + (k[`terjual_${p.id}`]||0), 0)
        + enrichLuarRute.reduce((s,k) => s + (k[`terjual_${p.id}`]||0), 0),
      rev: enrichKontrol.reduce((s,k) => s + (k[`terjual_${p.id}`]||0) * p.harga, 0)
        + enrichLuarRute.reduce((s,k) => s + (k[`terjual_${p.id}`]||0) * p.harga, 0),
    }));

    const bagiHasil = [
      { nama:"Pemilik Utama", pct:0.60, tipe:"Laba", nominal: labaBersih*0.60 },
      { nama:"Investor A",    pct:0.20, tipe:"Pendapatan", nominal: totalRev*0.20 },
      { nama:"Manajer Ops",   pct:0.10, tipe:"Laba", nominal: labaBersih*0.10 },
      { nama:"Karyawan Pool", pct:0.10, tipe:"Laba", nominal: labaBersih*0.10 },
    ];

    return { kontrol: enrichKontrol, penjualanLuar: enrichLuarRute, totalRevLuarRute,
      totalRev, labaBersih, tokoAktif, perWilayah, perRute, produkStats, bagiHasil };
  }, [db]);
}

// ─────────────────────────────────────────────
//  EXPORT UTILITIES
// ─────────────────────────────────────────────
async function exportCSV(data, columns, filename) {
  const header = columns.map(c => `"${c.label}"`).join(",");
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "";
      const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
      return `"${str.replace(/"/g,'""')}"`;
    }).join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  await saveOrShareBlob(blob, filename + ".csv");
}

async function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  await saveOrShareBlob(blob, filename + ".json");
}

// Export Excel (XLSX) menggunakan SheetJS
async function exportExcel(data, columns, title, filename) {
  try {
    const header = columns.map(c => c.label);
    const rows = data.map(row =>
      columns.map(c => {
        const val = row[c.key] ?? "";
        if (typeof val === "boolean") return val ? "Ya" : "Tidak";
        if (typeof val === "number") return val;
        return String(val);
      })
    );

    const wsData = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Styling header (lebar kolom otomatis)
    const colWidths = columns.map((c, ci) => {
      const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[ci]||"").length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0,30));

    // Tambah sheet info
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["Generasi Wangi Group - Super App"],
      ["Judul Laporan:", title],
      ["Diekspor:", new Date().toLocaleString("id-ID")],
      ["Total Data:", data.length + " baris"],
    ]);
    XLSX.utils.book_append_sheet(wb, infoWs, "Info");

    await saveWorkbookNative(wb, filename + ".xlsx");
  } catch(e) {
    alert("Gagal ekspor Excel: " + e.message);
  }
}

// Export PDF landscape profesional menggunakan browser print dengan layout khusus
async function exportPDF(data, columns, title, filename) {
  const now = new Date().toLocaleString("id-ID");

  // jsPDF pakai font standar (Helvetica) yang TIDAK punya karakter
  // emoji/simbol Unicode (🛣️, ═══, 📊, dst) — kalau dibiarkan, karakter itu
  // berubah jadi teks sampah di PDF. Dibersihkan dulu, teks biasa (huruf/
  // angka Indonesia) tidak terpengaruh sama sekali.
  const pdfSafe = (s) => String(s ?? "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u2190-\u2BFF]/g, "")
    .replace(/[\uFE00-\uFE0F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ── APK NATIVE: window.open()+window.print() yang dipakai jalur web di
  //    bawah TIDAK berfungsi di WebView (tidak ada jendela baru, dan dialog
  //    print sistem tidak ter-hubung) — makanya sebelumnya cuma menampilkan
  //    halaman HTML polos tanpa opsi apa pun. Di native, bikin file PDF
  //    SUNGGUHAN pakai jsPDF, lalu simpan/bagikan lewat Filesystem+Share
  //    (mekanisme yang sama seperti export Excel/CSV yang sudah terbukti).
  if (Capacitor.isNativePlatform()) {
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();

      // Header hijau + logo + judul
      doc.setFillColor(15, 76, 53);
      doc.rect(0, 0, pageW, 50, "F");
      // Latar putih eksplisit dulu di belakang logo (bulat) — beberapa versi
      // jsPDF tidak mengompositkan transparansi PNG dengan benar, jadi tanpa
      // ini logo bisa tampil dengan kotak/pinggiran tidak rapi.
      const logoCx = 24 + 17, logoCy = 8 + 17, logoR = 17;
      doc.setFillColor(255,255,255);
      doc.circle(logoCx, logoCy, 18, "F");
      // Sama seperti versi JPG: logo di-clip jadi bulat SEBELUM digambar,
      // supaya foto logo (persegi) tidak "mentok"/terlihat kotak di dalam
      // badge bulat. Tanpa clip ini, hasil PDF terlihat beda dari JPG.
      try {
        doc.saveGraphicsState();
        doc.ellipse(logoCx, logoCy, logoR, logoR, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(GWG_EXPORT_LOGO_B64, "PNG", 24, 8, 34, 34);
        doc.restoreGraphicsState();
      } catch {}
      // Border hijau tipis di sekeliling badge logo, menyamai tampilan JPG.
      doc.setDrawColor(15, 76, 53);
      doc.setLineWidth(1.2);
      doc.circle(logoCx, logoCy, logoR, "S");
      doc.setTextColor(255,255,255);
      doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text(pdfSafe("Generasi Wangi Group"), 68, 22);
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      doc.text(pdfSafe("SUPER APP · SISTEM MANAJEMEN KONSINYASI"), 68, 33);
      doc.setFontSize(10);
      doc.text(pdfSafe(title), pageW-24, 20, { align:"right" });
      doc.setFontSize(8);
      doc.text(pdfSafe(`Diekspor: ${now}  ·  Total: ${data.length} data`), pageW-24, 32, { align:"right" });

      const rows = data.map(row => columns.map(c => {
        const val = row[c.key] ?? "—";
        const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
        return pdfSafe(str) || "—";
      }));

      autoTable(doc, {
        head: [columns.map(c=>pdfSafe(c.label))],
        body: rows,
        startY: 62,
        theme: "striped",
        // Kolom sering banyak (produk × stok/jual/bonus, dst), tidak selalu
        // muat di 1 halaman — horizontalPageBreak melanjutkan kolom yang
        // tidak muat ke halaman berikutnya (tetap utuh terbaca), bukan
        // diam-diam terpotong hilang seperti sebelumnya.
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: 0,
        styles: { overflow: "linebreak" },
        headStyles: { fillColor: [15,76,53], textColor: 255, fontStyle: "bold", fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248,250,248] },
        margin: { left: 24, right: 24, top: 62 },
      });

      const blob = doc.output("blob");
      await saveOrShareBlob(blob, filename + ".pdf");
    } catch (e) {
      alert("Gagal membuat PDF: " + e.message);
    }
    return;
  }

  // ── WEB: cara lama (buka jendela print) — terbukti bekerja baik di
  //    browser desktop maupun mobile, jadi tidak diubah.
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "—";
      if (typeof val === "boolean") return val ? "Ya" : "Tidak";
      return String(val);
    })
  );

  const colWidths = columns.map((c, ci) => {
    const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[ci]||"").length));
    return Math.min(Math.max(maxLen * 7 + 16, 60), 180);
  });
  const totalW = colWidths.reduce((s,w)=>s+w,0);
  const pct = colWidths.map(w=>(w/totalW*100).toFixed(1)+"%");

  const tableRows = rows.map((row, i) => `
    <tr style="background:${i%2===0?"#fff":"#f8faf8"}">
      ${row.map((cell, ci) => `<td style="padding:6px 10px;font-size:11px;border-bottom:1px solid #e5e7eb;width:${pct[ci]}">${cell}</td>`).join("")}
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm 12mm 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:0; color:#1F2937; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:3px solid #0F4C35; padding-bottom:10px; }
    .brand { display:flex; align-items:center; gap:10px; }
    .brand-text h1 { margin:0; font-size:16px; color:#0F4C35; font-weight:800; }
    .brand-text p { margin:0; font-size:10px; color:#6B7280; letter-spacing:0.05em; text-transform:uppercase; }
    .meta { text-align:right; font-size:10px; color:#6B7280; line-height:1.6; }
    .meta .title { font-size:13px; font-weight:700; color:#1F2937; }
    .summary-bar { display:flex; gap:16px; margin-bottom:14px; }
    .summary-item { background:#F0FDF4; border:1px solid #86EFAC; border-radius:6px; padding:6px 14px; font-size:11px; }
    .summary-item b { color:#0F4C35; display:block; font-size:13px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    thead tr { background:#0F4C35; }
    thead th { color:#fff; padding:8px 10px; text-align:left; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap; }
    tbody tr:last-child td { border-bottom:none; }
    .footer { margin-top:12px; border-top:1px solid #E5E7EB; padding-top:8px; display:flex; justify-content:space-between; font-size:9px; color:#9CA3AF; }
    @media print { button { display:none !important; } }
  </style>
  </head><body>
  <div class="header">
    <div class="brand">
      <img src="${GWG_EXPORT_LOGO_B64}" alt="GWG" style="width:40px;height:40px;border-radius:50%;background:#fff;padding:3px;object-fit:contain;border:2px solid #0F4C35;" onerror="this.onerror=null;this.src='${GWG_LOGO_B64}';" />
      <div class="brand-text">
        <h1>Generasi Wangi Group</h1>
        <p>Super App · Sistem Manajemen Konsinyasi</p>
      </div>
    </div>
    <div class="meta">
      <div class="title">${title}</div>
      <div>Diekspor: ${now}</div>
      <div>Total: ${data.length} data</div>
    </div>
  </div>
  <div class="summary-bar">
    <div class="summary-item"><b>${data.length}</b>Total Baris</div>
    <div class="summary-item"><b>${columns.length}</b>Kolom</div>
    <div class="summary-item"><b>${now.split(",")[0]}</b>Tanggal Ekspor</div>
  </div>
  <table>
    <thead><tr>${columns.map((c,i)=>`<th style="width:${pct[i]}">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    <span>Generasi Wangi Group · Super App</span>
    <span>${title} · ${now}</span>
    <span>GWG-${new Date().getFullYear()}</span>
  </div>
  <script>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`;

  const win = window.open("","_blank");
  if (win) { win.document.write(html); win.document.close(); }
  else alert("Pop-up diblokir. Izinkan pop-up untuk ekspor PDF.");
}

// Ekspor JPG: menggambar tabel langsung ke <canvas> (tanpa dependensi
// eksternal seperti html2canvas) lalu mengunduhnya sebagai file gambar.
// Cocok untuk dibagikan cepat lewat WhatsApp/chat karena hasilnya berupa
// satu gambar utuh, bukan dokumen yang perlu dibuka aplikasi lain.
async function exportJPG(data, columns, title, filename) {
  try {
    const now = new Date().toLocaleString("id-ID");
    const rows = data.map(row => columns.map(c => {
      const val = row[c.key] ?? "—";
      if (typeof val === "boolean") return val ? "Ya" : "Tidak";
      return String(val);
    }));

    const PAD_X = 14;
    const meas = document.createElement("canvas").getContext("2d");
    const headerFont = "bold 11px 'Segoe UI', Arial, sans-serif";
    const cellFont = "12px 'Segoe UI', Arial, sans-serif";

    function widthOf(text, font) {
      meas.font = font;
      return meas.measureText(String(text)).width;
    }
    function truncate(text, maxWidth, font) {
      text = String(text);
      meas.font = font;
      if (meas.measureText(text).width <= maxWidth) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (meas.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      return text.slice(0, lo) + (lo < text.length ? "…" : "");
    }

    const colWidths = columns.map((c, ci) => {
      let w = widthOf(c.label.toUpperCase(), headerFont);
      rows.forEach(r => { w = Math.max(w, widthOf(r[ci], cellFont)); });
      return Math.min(Math.max(w + PAD_X * 2, 90), 260);
    });

    const tableWidth = colWidths.reduce((s, w) => s + w, 0);
    const MARGIN = 28;
    const HEADER_H = 78;
    const SUMMARY_H = 38;
    const HEAD_ROW_H = 32;
    const ROW_H = 28;
    const FOOTER_H = 30;
    const width = tableWidth + MARGIN * 2;
    const height = MARGIN + HEADER_H + SUMMARY_H + HEAD_ROW_H + rows.length * ROW_H + FOOTER_H + MARGIN;

    const SCALE = 2; // render 2x lalu di-downscale otomatis oleh browser → teks lebih tajam
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * SCALE);
    canvas.height = Math.ceil(height * SCALE);
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Canvas fillText di sebagian WebView Android (HP kamu) ternyata tidak
    // punya font emoji sama sekali — bukannya kosong/kotak seperti biasanya,
    // malah muncul karakter acak/rusak. Bersihkan emoji khusus untuk teks
    // yang digambar ke canvas (tidak menyentuh data aslinya, jadi tampilan
    // di layar & PDF tetap normal seperti biasa).
    function canvasSafe(s) {
      return String(s ?? "")
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
        .replace(/[\u2190-\u2BFF]/g, "")
        .replace(/[\uFE00-\uFE0F]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    function drawTableAndDownload(logoImg) {
      let y;
      ctx.fillStyle = "#0F4C35";
      ctx.fillRect(0, 0, width, HEADER_H);
      drawLogoBadge(logoImg);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 17px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("Generasi Wangi Group", MARGIN + 52, 34);
      ctx.font = "10px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = "#D9F0E6";
      ctx.fillText("SUPER APP · SISTEM MANAJEMEN KONSINYASI", MARGIN + 52, 52);

      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(truncate(canvasSafe(title), width - MARGIN * 2 - 250, "bold 14px 'Segoe UI', Arial, sans-serif"), width - MARGIN, 32);
      ctx.font = "11px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = "#D9F0E6";
      ctx.fillText(`Diekspor: ${now}`, width - MARGIN, 50);
      ctx.fillText(`Total: ${data.length} data`, width - MARGIN, 65);
      ctx.textAlign = "left";

      y = HEADER_H + 14;
      ctx.fillStyle = "#F0FDF4";
      ctx.strokeStyle = "#86EFAC";
      const sumW = 120, sumGap = 10;
      [[data.length, "Total Baris"], [columns.length, "Kolom"]].forEach(([num, label], i) => {
        const bx = MARGIN + i * (sumW + sumGap);
        ctx.fillStyle = "#F0FDF4";
        ctx.fillRect(bx, y, sumW, SUMMARY_H - 10);
        ctx.strokeRect(bx, y, sumW, SUMMARY_H - 10);
        ctx.fillStyle = "#0F4C35";
        ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";
        ctx.fillText(String(num), bx + 10, y + 17);
        ctx.font = "10px 'Segoe UI', Arial, sans-serif";
        ctx.fillStyle = "#374151";
        ctx.fillText(label, bx + 10, y + 28);
      });
      y += SUMMARY_H;

      ctx.fillStyle = "#0F4C35";
      ctx.fillRect(MARGIN, y, tableWidth, HEAD_ROW_H);
      ctx.fillStyle = "#ffffff";
      let x = MARGIN;
      columns.forEach((c, ci) => {
        ctx.font = headerFont;
        ctx.fillText(truncate(canvasSafe(c.label).toUpperCase(), colWidths[ci] - PAD_X * 2, headerFont), x + PAD_X, y + HEAD_ROW_H / 2 + 4);
        x += colWidths[ci];
      });
      y += HEAD_ROW_H;

      rows.forEach((r, ri) => {
        ctx.fillStyle = ri % 2 === 0 ? "#ffffff" : "#F8FAF8";
        ctx.fillRect(MARGIN, y, tableWidth, ROW_H);
        ctx.strokeStyle = "#E5E7EB";
        ctx.beginPath();
        ctx.moveTo(MARGIN, y + ROW_H);
        ctx.lineTo(MARGIN + tableWidth, y + ROW_H);
        ctx.stroke();
        ctx.fillStyle = "#1F2937";
        let cx = MARGIN;
        r.forEach((cell, ci) => {
          ctx.font = cellFont;
          ctx.fillText(truncate(canvasSafe(cell), colWidths[ci] - PAD_X * 2, cellFont), cx + PAD_X, y + ROW_H / 2 + 4);
          cx += colWidths[ci];
        });
        y += ROW_H;
      });

      ctx.strokeStyle = "#E5E7EB";
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 8);
      ctx.lineTo(MARGIN + tableWidth, y + 8);
      ctx.stroke();
      ctx.fillStyle = "#9CA3AF";
      ctx.font = "9px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Generasi Wangi Group · Super App", MARGIN, y + 24);
      ctx.textAlign = "right";
      ctx.fillText(`${title} · ${now}`, MARGIN + tableWidth, y + 24);
      ctx.textAlign = "left";

      canvas.toBlob(async (blob) => {
        await saveOrShareBlob(blob, filename + ".jpg");
      }, "image/jpeg", 0.92);
    }

    // Logo digambar dari gambar raster asli (GWG_EXPORT_LOGO_B64), BUKAN
    // bentuk vektor. Sebelumnya sempat diganti ke vektor karena drawImage()
    // dipanggil sebelum gambar selesai di-decode, sehingga di sebagian
    // WebView Android (.apk) logo gagal muncul (kosong/putih). Perbaikannya:
    // tunggu proses decode gambar selesai dulu (pakai img.decode() dengan
    // fallback ke onload/onerror) baru gambar tabelnya, di web maupun .apk.
    async function loadLogoImage() {
      const img = new Image();
      img.src = GWG_EXPORT_LOGO_B64;
      try {
        if (img.decode) {
          await img.decode();
        } else {
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
        }
        return img;
      } catch (e) {
        return null; // gagal dimuat → header tetap dicetak tanpa logo
      }
    }

    function drawLogoBadge(img) {
      if (!img) return; // tidak ada fallback vektor, sesuai permintaan
      const cx = MARGIN + 22, cy = 39, r = 19;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0F4C35";
      ctx.stroke();
      ctx.restore();
    }

    const logoImg = await loadLogoImage();
    drawTableAndDownload(logoImg);
  } catch (e) {
    alert("Gagal ekspor JPG: " + e.message);
  }
}

async function exportHTML(data, columns, title, filename) {
  const rows = data.map(row =>
    `<tr>${columns.map(c => {
      const val = row[c.key] ?? "—";
      const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
      return `<td>${str}</td>`;
    }).join("")}</tr>`
  ).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:sans-serif;padding:24px}h1{color:#0F4C35}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#0F4C35;color:#fff}tr:nth-child(even){background:#f2f2f2}</style>
  </head><body><h1>${title}</h1><p>Diekspor: ${new Date().toLocaleString("id-ID")}</p>
  <table><thead><tr>${columns.map(c=>`<th>${c.label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  await saveOrShareBlob(blob, filename + ".html");
}

// ─────────────────────────────────────────────
//  IMPORT UTILITIES (Excel) — Template & Reader
// ─────────────────────────────────────────────
async function downloadTokoTemplate(db) {
  try {
    const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);
    const header = ["Nama Toko*", "Rute*", "Status", "Catatan", ...produkAktif.map(p=>`Jual: ${p.nama}`), ...produkAktif.map(p=>`Stok: ${p.nama}`)];
    const sample = ["Toko Barokah", (db.rute||[])[0]?.nama || "Rute Utara A", "Aktif", "",
      ...produkAktif.map(()=>"Ya"), ...produkAktif.map(()=>0)];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    ws["!cols"] = header.map(h=>({ wch: Math.max(String(h).length+2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Toko");

    const ruteList = (db.rute||[]).map(r=>{
      const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
      return [r.nama, w?.nama||"—"];
    });
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["Generasi Wangi Group - Super App"],
      ["PETUNJUK IMPORT DATA TOKO"],
      ["1. Kolom bertanda * wajib diisi."],
      ["2. Kolom 'Rute' harus sama persis (tidak case-sensitive) dengan nama rute yang sudah ada di Master Rute."],
      ["3. Kolom 'Status' isi salah satu: Aktif / Non-Aktif / Baru (default Aktif jika kosong)."],
      ["4. Kolom 'Jual: <produk>' isi Ya / Tidak untuk menandai produk yang dijual toko tersebut."],
      ["5. Kolom 'Stok: <produk>' isi angka stok awal untuk masing-masing produk di toko tersebut (boleh dikosongkan, default 0)."],
      ["6. Jangan mengubah urutan atau nama header kolom pada sheet 'Template Toko'."],
      ["7. Tambahkan satu baris untuk setiap toko, mulai dari baris ke-2."],
      [""],
      ["Daftar Rute & Wilayah yang tersedia saat ini:"],
      ["Nama Rute", "Wilayah"],
      ...ruteList,
    ]);
    infoWs["!cols"] = [{ wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infoWs, "Petunjuk");

    await saveWorkbookNative(wb, "template_import_toko.xlsx");
  } catch(e) {
    alert("Gagal membuat template: " + e.message);
  }
}

async function downloadKontrolTemplate(db) {
  try {
    const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);
    const header = ["Toko*", "Tanggal* (YYYY-MM-DD)", "Status Kunjungan", "Catatan",
      ...produkAktif.flatMap(p=>[`Stok Awal: ${p.nama}`, `Terjual: ${p.nama}`, `Bonus: ${p.nama}`])];
    const sample = [(db.toko||[]).find(t=>t.status==="Aktif")?.nama || "Toko Barokah",
      new Date().toISOString().slice(0,10), "", "",
      ...produkAktif.flatMap(()=>[0,0,0])];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    ws["!cols"] = header.map(h=>({ wch: Math.max(String(h).length+2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Kontrol");

    const tokoList = (db.toko||[]).filter(t=>t.status==="Aktif").map(t=>{
      const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
      return [t.nama, rute?.nama||"—"];
    });
    const statusOpts = Object.values(CATATAN_STATUS).map(c=>c.label);
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["Generasi Wangi Group - Super App"],
      ["PETUNJUK IMPORT KONTROL BULANAN"],
      ["1. Kolom bertanda * wajib diisi."],
      ["2. Kolom 'Toko' harus sama persis (tidak case-sensitive) dengan Nama Toko di Master Toko."],
      ["3. Kolom 'Tanggal' format YYYY-MM-DD, contoh: 2026-06-28."],
      ["4. Kolom 'Status Kunjungan': WAJIB diisi jika tidak ada produk yang terjual. OPSIONAL jika ada penjualan (untuk catatan tambahan). Pilihan: " + statusOpts.join(", ") + "."],
      ["5. Jika salah satu kolom 'Terjual: <produk>' lebih dari 0, status kunjungan otomatis Terjual dan boleh dikosongkan."],
      ["6. Kolom 'Catatan' hanya dipakai jika Status Kunjungan diisi 'Isi Manual'."],
      ["7. Jangan mengubah urutan atau nama header kolom pada sheet 'Template Kontrol'."],
      ["8. Tambahkan satu baris untuk setiap kunjungan kontrol, mulai dari baris ke-2."],
      [""],
      ["Daftar Toko Aktif yang tersedia saat ini:"],
      ["Nama Toko", "Rute"],
      ...tokoList,
    ]);
    infoWs["!cols"] = [{ wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infoWs, "Petunjuk");

    await saveWorkbookNative(wb, "template_import_kontrol.xlsx");
  } catch(e) {
    alert("Gagal membuat template: " + e.message);
  }
}

// Hook dipakai oleh menu dropdown (ImportMenu, ExportMenu, dll) supaya
// posisinya selalu terkunci di dalam layar. Sebelumnya dropdown memakai
// `position:absolute; right:0` relatif ke tombolnya sendiri — di HP, jika
// tombol berada dekat sisi kiri, dropdown (lebar ~230px) akan terdorong ke
// kiri hingga keluar layar dan terlihat terpotong. Hook ini mengukur posisi
// tombol saat menu dibuka lalu menghitung `left` yang di-clamp supaya
// seluruh dropdown selalu terlihat penuh, di layar seukuran apa pun.
function useClampedMenuPosition(open, anchorRef, menuWidth = 230) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) { setStyle(null); return; }
    const update = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(menuWidth, window.innerWidth - margin * 2);
      let left = rect.right - width; // default: rata kanan ke tombol
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      setStyle({ position:"fixed", top: rect.bottom + 4, left, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, menuWidth]);
  return style;
}

// Menu "hamburger" dipakai di header aplikasi untuk mengelompokkan tombol
// aksi admin (Backup Cepat, Backup, Reset DB) supaya header tidak penuh /
// berantakan di layar HP. Posisinya memakai hook clamped yang sama supaya
// selalu terlihat penuh di dalam layar.
function HeaderMenu({ items, icon="☰", title="Menu" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 240);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  if (!items?.length) return null;
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <button onClick={() => setOpen(o=>!o)} title={title}
        style={{ display:"flex", alignItems:"center", justifyContent:"center", width:34, height:34,
          background:"rgba(255,255,255,.12)", color:"#fff", border:"1px solid rgba(255,255,255,.2)",
          borderRadius:8, cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>
        {icon}
      </button>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.16)", zIndex:250, overflow:"hidden",
          maxHeight:"75vh", overflowY:"auto" }}>
          {items.map((it, i) => (
            it.divider ? (
              <div key={i} style={{ borderTop:`1px solid ${T.gray200}`, margin:"4px 0" }} />
            ) : (
              <button key={i} onClick={() => { it.onClick?.(); setOpen(false); }}
                style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
                  background: it.active ? T.greenLt : "none", cursor:"pointer", fontSize:13, fontFamily:"inherit",
                  fontWeight: it.active ? 700 : 400,
                  color: it.danger ? T.red : (it.active ? T.green : T.gray800),
                  borderBottom: i<items.length-1 ? `1px solid ${T.gray100}` : "none" }}
                onMouseEnter={e => e.target.style.background = it.danger ? T.redLt : (it.active ? T.greenLt : T.gray50)}
                onMouseLeave={e => e.target.style.background = it.active ? T.greenLt : "none"}>
                {it.active ? "✓ " : ""}{it.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// Import Menu Component — Download Template & Upload Excel
function ImportMenu({ label="Import", onTemplate, onParseRows }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // { title, message, dupList, onConfirm }
  const fileRef = useRef(null);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 230);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type:"array" });
        const sheetName = wb.SheetNames.find(n=>!/petunjuk/i.test(n)) || wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval:"" });
        const res = onParseRows(rows);
        // Jika hasil parsing menemukan baris yang berpotensi duplikat, jangan
        // langsung commit — tanyakan dulu ke user mau tetap ditambahkan atau
        // dilewati, baru tampilkan hasil akhir setelah dikonfirmasi.
        if (res && res.needsConfirm) setPending(res);
        else setResult(res);
      } catch (err) {
        setResult({ added:0, skipped:0, errors:["Gagal membaca file: " + err.message] });
      }
    };
    reader.onerror = () => setResult({ added:0, skipped:0, errors:["Gagal membaca file."] });
    reader.readAsArrayBuffer(file);
  }

  function resolvePending(includeDuplicates) {
    const finalRes = pending.onConfirm(includeDuplicates);
    setPending(null);
    setResult(finalRes);
  }

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <Btn variant="secondary" size="sm" icon="📥" onClick={() => setOpen(!open)}>{label}</Btn>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:200, overflow:"hidden" }}>
          <button onClick={() => { onTemplate(); setOpen(false); }}
            style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
              background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800,
              borderBottom:`1px solid ${T.gray100}` }}
            onMouseEnter={e => e.target.style.background=T.gray50}
            onMouseLeave={e => e.target.style.background="none"}>
            ⬇️ Download Template Excel
          </button>
          <button onClick={() => { fileRef.current?.click(); setOpen(false); }}
            style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
              background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800 }}
            onMouseEnter={e => e.target.style.background=T.gray50}
            onMouseLeave={e => e.target.style.background="none"}>
            ⬆️ Upload File Excel
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleFile} />
      {pending && (
        <Modal title={pending.title || "⚠️ Data Duplikat Ditemukan"} onClose={()=>setPending(null)}>
          <div style={{ fontSize:13, color:T.gray800, marginBottom:10 }}>{pending.message}</div>
          <div style={{ maxHeight:220, overflow:"auto", fontSize:12, color:T.red, background:T.redLt,
            borderRadius:8, padding:"10px 12px", lineHeight:1.7, marginBottom:14 }}>
            {pending.dupList.map((d,i) => <div key={i}>• {d}</div>)}
          </div>
          <div style={{ fontSize:12, color:T.gray400, marginBottom:14 }}>
            Pilih "Lewati Duplikat" (disarankan) agar tidak ada nama toko yang sama dalam satu rute,
            atau "Tetap Tambahkan Semua" jika duplikat ini memang disengaja.
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
            <Btn variant="secondary" onClick={()=>setPending(null)}>Batalkan Impor</Btn>
            <Btn variant="danger" onClick={()=>resolvePending(true)}>Tetap Tambahkan Semua</Btn>
            <Btn onClick={()=>resolvePending(false)}>Lewati Duplikat</Btn>
          </div>
        </Modal>
      )}
      {result && (
        <Modal title="📊 Hasil Import Excel" onClose={()=>setResult(null)}>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            <Badge color={T.green}>{result.added} berhasil ditambahkan</Badge>
            {result.skipped > 0 && <Badge color={T.red}>{result.skipped} baris dilewati</Badge>}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ maxHeight:260, overflow:"auto", fontSize:12, color:T.red, background:T.redLt,
              borderRadius:8, padding:"10px 12px", lineHeight:1.7 }}>
              {result.errors.map((e,i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {result.errors?.length===0 && result.added>0 && (
            <div style={{ fontSize:13, color:T.green, fontWeight:600 }}>✅ Semua baris berhasil diimpor tanpa error.</div>
          )}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
            <Btn onClick={()=>setResult(null)}>Tutup</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Export Menu Component
// exportData / exportCols: data & kolom khusus untuk file ekspor (CSV/Excel/PDF/JPG)
//   jika tidak diberikan, memakai data & columns yang sama dengan tampilan.
function ExportMenu({ data, columns, title, filename, exportData, exportCols }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 180);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const eData = exportData || data;
  const eCols = exportCols || columns;
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <Btn variant="secondary" size="sm" icon="📤" onClick={() => setOpen(!open)}>Ekspor</Btn>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:200, overflow:"hidden" }}>
          {[
            { label:"📊 CSV", action: () => { exportCSV(eData, eCols, filename); setOpen(false); } },
            { label:"🟢 Excel (.xlsx)", action: () => { exportExcel(eData, eCols, title, filename); setOpen(false); } },
            { label:"🌐 HTML", action: () => { exportHTML(eData, eCols, title, filename); setOpen(false); } },
            { label:"📋 JSON", action: () => { exportJSON(eData, filename); setOpen(false); } },
            { label:"📄 PDF Landscape", action: () => { exportPDF(eData, eCols, title, filename); setOpen(false); } },
            { label:"🖼️ JPG", action: () => { exportJPG(eData, eCols, title, filename); setOpen(false); } },
          ].map((opt, i) => (
            <button key={i} onClick={opt.action}
              style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
                background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800,
                borderBottom: i<5 ? `1px solid ${T.gray100}` : "none" }}
              onMouseEnter={e => e.target.style.background=T.gray50}
              onMouseLeave={e => e.target.style.background="none"}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  SHARED COMPONENTS
// ─────────────────────────────────────────────
function Badge({ children, color=T.green, bg }) {
  return (
    <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:20,
      background: bg || color+"18", color, fontSize:11, fontWeight:700, letterSpacing:"0.03em" }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, variant="primary", size="md", icon, disabled, style={} }) {
  const base = { display:"flex", alignItems:"center", gap:6, border:"none", borderRadius:8,
    cursor:disabled?"not-allowed":"pointer", fontWeight:600, fontFamily:"inherit",
    transition:"all .15s", opacity:disabled?0.5:1, ...style };
  const variants = {
    primary:   { background:T.green,  color:"#fff",     padding:size==="sm"?"6px 14px":"9px 20px", fontSize:size==="sm"?12:13 },
    secondary: { background:T.white,  color:T.gray800,  border:`1.5px solid ${T.gray200}`, padding:size==="sm"?"5px 13px":"8px 19px", fontSize:size==="sm"?12:13 },
    danger:    { background:T.redLt,  color:T.red,      border:`1.5px solid #FCA5A5`, padding:size==="sm"?"5px 13px":"8px 19px", fontSize:size==="sm"?12:13 },
    gold:      { background:T.gold,   color:"#fff",     padding:size==="sm"?"6px 14px":"9px 20px", fontSize:size==="sm"?12:13 },
  };
  return (
    <button onClick={disabled?undefined:onClick} style={{ ...base, ...variants[variant] }}>
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
}

function Card({ children, style={}, padding=20, className }) {
  return (
    <div className={className} style={{ background:T.white, borderRadius:14, border:`1px solid ${T.gray200}`,
      padding, boxShadow:"0 1px 4px rgba(0,0,0,.05)", ...style }}>
      {children}
    </div>
  );
}

function Input({ label, value, onChange, type="text", placeholder="", required, options, hint, disabled }) {
  const id = `inp-${label}-${Math.random().toString(36).slice(2,6)}`;
  const s = { width:"100%", padding:"9px 12px", border:`1.5px solid ${T.gray200}`,
    borderRadius:8, fontSize:13, fontFamily:"inherit", outline:"none",
    background: disabled ? T.gray50 : T.white, boxSizing:"border-box", color:T.gray800 };
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      {options ? (
        <select value={value} onChange={e=>onChange(e.target.value)} style={s} disabled={disabled}>
          <option value="">— Pilih —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type==="checkbox" ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, paddingTop:4 }}>
          <input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}
            style={{ width:16, height:16, accentColor:T.green }} />
          <span style={{ fontSize:13, color:T.gray600 }}>{placeholder}</span>
        </div>
      ) : type==="textarea" ? (
        <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{ ...s, resize:"vertical", minHeight:72 }} disabled={disabled} />
      ) : (
        <input type={type} value={value} onChange={e=>onChange(e.target.value)}
          placeholder={placeholder} style={s} disabled={disabled} />
      )}
      {hint && <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>{hint}</div>}
    </div>
  );
}

// Dropdown dengan kotak pencarian di dalamnya — dipakai untuk Wilayah/Rute
// yang opsinya bisa banyak, agar lebih mudah mencari saat input data.
function SearchableSelect({ label, value, onChange, options, required, placeholder="Cari...", hint, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const s = { width:"100%", padding:"9px 12px", border:`1.5px solid ${T.gray200}`,
    borderRadius:8, fontSize:13, fontFamily:"inherit", outline:"none",
    background: disabled ? T.gray50 : T.white, boxSizing:"border-box", color:T.gray800,
    cursor: disabled ? "not-allowed" : "pointer", display:"flex", alignItems:"center", justifyContent:"space-between" };

  return (
    <div style={{ marginBottom:14, position:"relative" }} ref={boxRef}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <div style={s} onClick={()=>{ if(!disabled){ setOpen(o=>!o); } }}>
        <span style={{ color: selected ? T.gray800 : T.gray400 }}>{selected ? selected.label : "— Pilih —"}</span>
        <span style={{ color:T.gray400, fontSize:11 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && !disabled && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, marginTop:4, background:T.white,
          border:`1.5px solid ${T.gray200}`, borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.12)",
          zIndex:50, maxHeight:260, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          <div style={{ padding:8, borderBottom:`1px solid ${T.gray100}` }}>
            <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={placeholder}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
          </div>
          <div style={{ overflowY:"auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding:"12px", fontSize:12, color:T.gray400, textAlign:"center" }}>Tidak ditemukan</div>
            ) : filtered.map(o => (
              <div key={o.value} onClick={()=>{ onChange(o.value); setOpen(false); setQ(""); }}
                style={{ padding:"9px 12px", fontSize:13, cursor:"pointer", color:T.gray800,
                  background: o.value===value ? T.greenLt : T.white }}
                onMouseEnter={e=>e.currentTarget.style.background=T.gray50}
                onMouseLeave={e=>e.currentTarget.style.background = o.value===value ? T.greenLt : T.white}>
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
      {hint && <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>{hint}</div>}
    </div>
  );
}

function Modal({ title, children, onClose, width=480 }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.white, borderRadius:16, width:"100%", maxWidth:width,
        maxHeight:"90vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
        <div className="gw-modal-header" style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"18px 24px", borderBottom:`1px solid ${T.gray200}`,
          position:"sticky", top:0, background:T.white, zIndex:1 }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.gray800 }}>{title}</div>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", fontSize:20, color:T.gray400 }}>×</button>
        </div>
        <div className="gw-modal-body" style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}

function ConfirmDelete({ onConfirm, onCancel, label }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:2000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:T.white, borderRadius:14, padding:28, maxWidth:360, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,.2)", textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🗑️</div>
        <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:8 }}>Hapus data ini?</div>
        <div style={{ fontSize:13, color:T.gray500, marginBottom:20 }}>{label || "Tindakan ini tidak dapat dibatalkan."}</div>
        <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
          <Btn variant="secondary" onClick={onCancel}>Batal</Btn>
          <Btn variant="danger" onClick={onConfirm}>Ya, Hapus</Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  BULK ACTION BAR — toolbar seleksi massal
// ─────────────────────────────────────────────
function BulkActionBar({ selectedIds, total, onSelectAll, onClearAll, onDeleteSelected, label="item" }) {
  if (selectedIds.length === 0) return null;
  const allSelected = selectedIds.length >= total;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
      background: T.redLt, border:`1.5px solid #FECACA`, borderRadius:10,
      padding:"10px 16px", marginBottom:10
    }}>
      <span style={{ fontSize:13, fontWeight:700, color:T.red }}>
        ✅ {selectedIds.length} {label} dipilih
      </span>
      <Btn variant="secondary" size="sm"
        onClick={allSelected ? onClearAll : onSelectAll}>
        {allSelected ? "✗ Batal Pilih Semua" : `☑ Pilih Semua (${total})`}
      </Btn>
      {selectedIds.length > 0 && (
        <Btn variant="danger" size="sm" icon="🗑"
          onClick={onDeleteSelected}>
          Hapus {selectedIds.length} Terpilih
        </Btn>
      )}
      <Btn variant="secondary" size="sm" onClick={onClearAll}>✗ Batal</Btn>
    </div>
  );
}

function Table({ columns, data, onEdit, onDelete, rowStyle, selectedIds, onToggleSelect, onToggleSelectAll, pageSize = 50 }) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const hasSelection = !!(onToggleSelect && onToggleSelectAll);

  // PAGINATION: dulu semua baris `data` dirender sekaligus ke DOM tanpa
  // batas. Kalau tabel (Toko, Kontrol, dst) sudah berisi ribuan baris, ini
  // bikin pindah tab terasa berat — karena tab yang tidak aktif di-unmount
  // total, jadi setiap kali dibuka lagi, browser harus membangun ulang
  // RIBUAN elemen <tr> dari nol. Dengan membatasi jumlah baris yang
  // dirender per halaman, pindah tab jadi jauh lebih cepat tanpa mengubah
  // apapun di sisi pemanggil (Table dipakai bersama oleh semua tab).
  const [page, setPage] = useState(1);
  // Reset ke halaman 1 setiap kali dataset (hasil filter/pencarian) berubah,
  // supaya tidak "nyangkut" di halaman kosong setelah pencarian dipersempit.
  useEffect(() => { setPage(1); }, [data]);

  if (!data || !data.length) return (
    <div style={{ textAlign:"center", padding:40, color:T.gray400, fontSize:13 }}>
      Belum ada data. Klik <b>+ Tambah</b> untuk menambahkan.
    </div>
  );

  // "Pilih semua" tetap mengacu ke SELURUH data hasil filter (semua
  // halaman), bukan cuma baris yang sedang tampil di halaman ini — supaya
  // perilaku bulk-select tidak berubah gara-gara pagination.
  const allChecked = hasSelection && data.length > 0 && data.every(row => (selectedIds||[]).includes(row.id));
  const someChecked = hasSelection && (selectedIds||[]).some(id => data.find(r=>r.id===id));

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageData = data.slice(startIdx, startIdx + pageSize);

  return (
    <>
      {deleteTarget && (
        <ConfirmDelete
          label={`Data akan dihapus permanen.`}
          onConfirm={() => { onDelete(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
              {hasSelection && (
                <th style={{ padding:"10px 14px", width:36 }}>
                  <input type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={() => onToggleSelectAll(data, allChecked)}
                    style={{ accentColor:T.green, width:15, height:15, cursor:"pointer" }} />
                </th>
              )}
              {columns.map(c => (
                <th key={c.key} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700,
                  color:T.gray600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>
                  {c.label}
                </th>
              ))}
              {(onEdit||onDelete) && (
                <th style={{ padding:"10px 14px", textAlign:"right", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>AKSI</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => {
              const isSelected = hasSelection && (selectedIds||[]).includes(row.id);
              const rowBg = isSelected ? T.greenLt : (rowStyle ? (rowStyle(row) || (i%2===0 ? T.white : T.gray50)) : (i%2===0 ? T.white : T.gray50));
              return (
                <tr key={row.id||(startIdx+i)} style={{ borderBottom:`1px solid ${T.gray100}`, background:rowBg, transition:"background .1s" }}>
                  {hasSelection && (
                    <td style={{ padding:"10px 14px", width:36 }}>
                      <input type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(row.id)}
                        style={{ accentColor:T.green, width:15, height:15, cursor:"pointer" }} />
                    </td>
                  )}
                  {columns.map(c => (
                    <td key={c.key} style={{ padding:"10px 14px", color:T.gray800, verticalAlign:"middle" }}>
                      {c.render ? c.render(row[c.key], row) : (row[c.key] ?? "—")}
                    </td>
                  ))}
                  {(onEdit||onDelete) && (
                    <td style={{ padding:"8px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                        {onEdit && <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>onEdit(row)}>Edit</Btn>}
                        {onDelete && <Btn variant="danger" size="sm" icon="🗑" onClick={()=>setDeleteTarget(row.id)}>Hapus</Btn>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.length > pageSize && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10,
          padding:"12px 14px", borderTop:`1px solid ${T.gray100}` }}>
          <div style={{ fontSize:12, color:T.gray400 }}>
            Menampilkan {startIdx+1}–{Math.min(startIdx+pageSize, data.length)} dari {data.length} data
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <Btn variant="secondary" size="sm" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Sebelumnya</Btn>
            <span style={{ fontSize:12, color:T.gray600, fontWeight:600 }}>Halaman {safePage} / {totalPages}</span>
            <Btn variant="secondary" size="sm" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya ›</Btn>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, sub, icon, color=T.green, bg }) {
  return (
    <Card className="gw-statcard" style={{ background:bg||color+"0D", border:`1.5px solid ${color}22` }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ minWidth:0 }}>
          <div className="gw-statcard-label" style={{ fontSize:11, fontWeight:700, color, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{label}</div>
          <div className="gw-statcard-value" style={{ fontSize:26, fontWeight:800, color:T.gray800, lineHeight:1.15, wordBreak:"break-word" }}>{value}</div>
          {sub && <div style={{ fontSize:12, color:T.gray400, marginTop:4 }}>{sub}</div>}
        </div>
        <div className="gw-statcard-icon" style={{ fontSize:28, opacity:.8, flexShrink:0, marginLeft:8 }}>{icon}</div>
      </div>
    </Card>
  );
}

function FilterBar({ filters, onChange, onReset }) {
  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14,
      background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"12px 16px" }}>
      {filters.map(f => (
        <div key={f.key} style={{ minWidth:140, flex:1 }}>
          <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>{f.label}</div>
          {f.options ? (
            <select value={f.value} onChange={e=>onChange(f.key, e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              <option value="">Semua</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input value={f.value} onChange={e=>onChange(f.key, e.target.value)}
              placeholder={f.placeholder||"Cari..."} type={f.type||"text"}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
          )}
        </div>
      ))}
      <Btn variant="secondary" size="sm" onClick={onReset} icon="↺">Reset</Btn>
    </div>
  );
}

const fmt = (n) => new Intl.NumberFormat("id-ID").format(n||0);
const fmtRp = (n) => "Rp " + fmt(n);
function genId(prefix, arr) {
  const nums = (arr||[]).map(r => parseInt(r.id?.replace(/\D/g,""))||0);
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return `${prefix}${String(next).padStart(3,"0")}`;
}

// ID unik lintas-perangkat: dipakai khusus untuk record yang bisa dibuat
// otomatis dari beberapa perangkat/sesi hampir bersamaan (mis. auto-register
// pengguna baru saat login). BEDA dengan genId() yang sekuensial berbasis
// data lokal — genId() bisa menghasilkan ID yang SAMA di dua perangkat kalau
// datanya belum ter-sync, sehingga tulisan salah satu perangkat akan
// MENIMPA (bukan menambah) data perangkat lain di Firebase (path per-id).
// genUniqueId() memakai timestamp + random supaya praktis mustahil bentrok
// walau dibuat di waktu yang hampir sama oleh perangkat berbeda.
function genUniqueId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

// Normalisasi teks untuk perbandingan duplikat: lowercase + trim +
// rapikan spasi ganda, supaya "Toko  Barokah" dan "toko barokah" terdeteksi sama.
function normTxt(s) {
  return String(s||"").trim().toLowerCase().replace(/\s+/g," ");
}
// Perbandingan "natural sort": memecah nama menjadi potongan teks & angka,
// lalu membandingkan potongan angka SEBAGAI ANGKA (bukan string). Ini supaya
// "Bklu2" terurut sebelum "Bklu10" (bukan "Bklu1, Bklu10, Bklu11, ..., Bklu2"
// seperti pada urutan alfabetis biasa).
function naturalCompare(a, b) {
  const ax = String(a||"").match(/(\d+|\D+)/g) || [];
  const bx = String(b||"").match(/(\d+|\D+)/g) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const an = ax[i] ?? "";
    const bn = bx[i] ?? "";
    const aIsNum = /^\d+$/.test(an);
    const bIsNum = /^\d+$/.test(bn);
    if (aIsNum && bIsNum) {
      const diff = parseInt(an,10) - parseInt(bn,10);
      if (diff !== 0) return diff;
    } else {
      const cmp = an.localeCompare(bn, "id", { sensitivity:"base" });
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
// Sort alfabetis + natural angka (case-insensitive, locale Indonesia) —
// dipakai supaya Master Wilayah, Master Rute, dan Master Toko selalu terurut
// otomatis walau ada penambahan data baru di kemudian hari, termasuk urutan
// angka di akhir nama (Bklu1, Bklu2, ... Bklu10, bukan Bklu1, Bklu10, Bklu2).
function sortByNama(arr, key="nama") {
  return [...(arr||[])].sort((a,b) => naturalCompare(a[key], b[key]));
}

// Hitung jumlah toko yang menjual masing-masing produk (toko.produkIds
// mengandung kode produk tsb), dari sekumpulan toko tertentu — bisa toko
// dalam 1 rute, dalam 1 wilayah, atau seluruh toko (total semua wilayah).
// Hanya produk aktif yang dihitung.
function hitungTokoPerProduk(tokoList, produkAktif) {
  return (produkAktif||[]).map(p => ({
    id: p.id,
    nama: p.nama,
    jumlah: (tokoList||[]).filter(t => (t.produkIds||[]).includes(p.id)).length,
  }));
}

// Menampilkan ringkasan "Nama Produk (Kode): N toko" sebagai badge-badge
// kecil — dipakai di Master Rute & Master Wilayah untuk menunjukkan sebaran
// toko per produk tanpa perlu buka halaman lain. Produk dengan 0 toko
// disembunyikan supaya ringkas.
function ProdukBreakdownBadges({ breakdown }) {
  const shown = (breakdown||[]).filter(b => b.jumlah > 0);
  if (shown.length === 0) return <span style={{ color:T.gray400, fontSize:12 }}>—</span>;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
      {shown.map(b => (
        <span key={b.id} style={{ display:"inline-block", padding:"2px 8px", borderRadius:20,
          background:T.blue+"14", color:T.blue, fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
          {b.nama} ({b.id}): {b.jumlah} toko
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB WILAYAH
// ─────────────────────────────────────────────
function TabWilayah({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", deskripsi:"" });
  const [filter, setFilter] = useState({ q:"" });
  const [selectedIds, setSelectedIds] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  // Deteksi wilayah duplikat (nama sama, tidak case-sensitive, abaikan spasi
  // berlebih) yang mungkin sudah kadung tersimpan dari sebelum validasi
  // duplikat ini ada, atau dari sinkronisasi ganda antar perangkat.
  // Dikelompokkan supaya bisa digabungkan jadi satu wilayah saja.
  const dupGroups = useMemo(() => {
    const map = new Map();
    (db.wilayah||[]).forEach(w => {
      const key = normTxt(w.nama);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(w);
    });
    return [...map.values()].filter(g => g.length > 1);
  }, [db.wilayah]);
  const totalDup = dupGroups.reduce((n,g) => n + (g.length-1), 0);

  // Gabungkan setiap grup duplikat menjadi satu wilayah "utama" (yang dipilih
  // adalah wilayah dengan ID terlama / pertama dibuat, supaya rute & toko yang
  // sudah lama terhubung tidak berubah ID rujukannya). Semua rute yang tadinya
  // menunjuk ke wilayah duplikat dialihkan ke wilayah utama, baru kemudian
  // wilayah duplikatnya dihapus. Aman dipakai berkali-kali (idempotent).
  function mergeDuplikat() {
    if (totalDup === 0) return;
    const ringkasan = dupGroups.map(g => `• "${g[0].nama}" — ${g.length} entri`).join("\n");
    if (!confirm(`Ditemukan ${dupGroups.length} nama wilayah yang duplikat:\n\n${ringkasan}\n\nSemua rute yang terhubung akan dialihkan ke satu wilayah utama (yang paling lama dibuat), lalu data duplikatnya dihapus. Lanjutkan?`)) return;

    dupGroups.forEach(group => {
      const sortedGroup = [...group].sort((a,b) => String(a.id).localeCompare(String(b.id)));
      const utama = sortedGroup[0];
      sortedGroup.slice(1).forEach(dup => {
        (db.rute||[]).filter(r => r.wilayahId === dup.id).forEach(r => {
          updateRecord("rute", r.id, { wilayahId: utama.id });
        });
        deleteRecord("wilayah", dup.id);
      });
    });
    alert("✅ Wilayah duplikat berhasil digabungkan.");
  }

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} wilayah terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("wilayah", id));
    setSelectedIds([]);
  }

  // Urutkan Master Wilayah berdasarkan abjad nama wilayah, otomatis
  // mengikutkan data baru kapan pun ditambahkan.
  const sorted = useMemo(() => sortByNama(db.wilayah), [db.wilayah]);

  const data = useMemo(() => sorted.filter(w =>
    !filter.q || w.nama.toLowerCase().includes(filter.q.toLowerCase())
  ), [sorted, filter]);

  // Produk aktif dipakai untuk menghitung sebaran "jumlah toko yang menjual
  // masing-masing produk" per wilayah (mis. Roll On 70 toko, B35 20 toko).
  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);

  const enriched = data.map(w => {
    const tokoWilayah = (db.toko||[]).filter(t=>{
      const rute=(db.rute||[]).find(r=>r.id===t.ruteId);
      return rute?.wilayahId===w.id;
    });
    return {
      ...w,
      jumlahRute: (db.rute||[]).filter(r=>r.wilayahId===w.id).length,
      jumlahToko: tokoWilayah.length,
      produkBreakdown: hitungTokoPerProduk(tokoWilayah, produkAktif),
      isDuplikat: dupGroups.some(g => g.some(x=>x.id===w.id)),
    };
  });

  // ✅ Total SEMUA WILAYAH: sebaran toko per produk dihitung dari SELURUH
  // toko (bukan hanya yang lolos filter pencarian), supaya jadi rekap total
  // yang stabil dan tidak berubah-ubah saat wilayah sedang difilter/dicari.
  const totalSemuaWilayahBreakdown = useMemo(
    () => hitungTokoPerProduk(db.toko||[], produkAktif),
    [db.toko, produkAktif]
  );
  const totalTokoSemuaWilayah = (db.toko||[]).length;

  function openAdd() { setForm({ nama:"", deskripsi:"" }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.nama) return alert("Nama wajib diisi");
    // Validasi duplikat: nama wilayah yang sama (tidak case-sensitive, abaikan spasi
    // berlebih) dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.wilayah||[]).some(w =>
      normTxt(w.nama) === normTxt(form.nama) && w.id !== form.id
    );
    if (isDup) {
      alert(`⚠️ Nama wilayah "${form.nama}" sudah ada di data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama wilayah yang berbeda.`);
      return;
    }
    if (modal==="add") addRecord("wilayah", { ...form, id:genId("WIL-",db.wilayah) });
    else updateRecord("wilayah", form.id, form);
    setModal(null);
  }

  const cols = [
    { key:"id",        label:"ID",         render: v=><Badge color={T.blue}>{v}</Badge> },
    { key:"nama",      label:"Nama Wilayah", render: (v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>{row.isDuplikat && <Badge color={T.red}>⚠️ Duplikat</Badge>}
        </span>
      ) },
    { key:"deskripsi", label:"Deskripsi" },
    { key:"jumlahRute",label:"Rute",       render: v=><Badge color={T.teal}>{v} rute</Badge> },
    { key:"jumlahToko",label:"Toko",       render: v=><Badge color={T.green}>{v} toko</Badge> },
    { key:"produkBreakdown", label:"Toko per Produk", render: v=><ProdukBreakdownBadges breakdown={v} /> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📍 Master Wilayah</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.wilayah||[]).length} wilayah terdaftar · terurut abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={enriched} columns={cols} title="Data Wilayah" filename="wilayah" />
          {totalDup > 0 && (
            <Btn variant="danger" onClick={mergeDuplikat} icon="🧹">
              Gabungkan {totalDup} Duplikat
            </Btn>
          )}
          <Btn onClick={openAdd} icon="＋">Tambah Wilayah</Btn>
        </div>
      </div>
      {totalDup > 0 && (
        <div style={{ background:T.redLt, color:T.red, padding:"10px 14px", borderRadius:10,
          fontSize:13, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
          ⚠️ Ditemukan nama wilayah yang duplikat (mis. dua "Bangkalan Utara"). Ini bisa membuat
          nama wilayah muncul dua kali di semua filter. Klik <b>"Gabungkan {totalDup} Duplikat"</b> untuk
          merapikannya secara otomatis — rute yang terhubung akan dipindah ke satu wilayah utama.
        </div>
      )}
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:700, color:T.gray800, marginBottom:8 }}>
          🧴 Total Toko per Produk — Semua Wilayah ({totalTokoSemuaWilayah} toko)
        </div>
        <ProdukBreakdownBadges breakdown={totalSemuaWilayahBreakdown} />
      </Card>
      <FilterBar filters={[{ key:"q", label:"Cari Wilayah", value:filter.q }]}
        onChange={(k,v)=>setFilter(p=>({...p,[k]:v}))} onReset={()=>setFilter({q:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={enriched.length}
        onSelectAll={()=>toggleSelectAll(enriched, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="wilayah" />
      <Card padding={0}>
        <Table columns={cols} data={enriched} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus wilayah ini?")) deleteRecord("wilayah",id); }}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Wilayah":"Edit Wilayah"} onClose={()=>setModal(null)}>
          <Input label="Nama Wilayah" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Bangkalan Utara" />
          <Input label="Deskripsi" value={form.deskripsi} onChange={v=>f("deskripsi",v)} type="textarea" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB RUTE
// ─────────────────────────────────────────────
function TabRute({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", wilayahId:"", keterangan:"" });
  const [filter, setFilter] = useState({ q:"", wilayahId:"" });
  const [selectedIds, setSelectedIds] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} rute terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("rute", id));
    setSelectedIds([]);
  }

  // Produk aktif dipakai untuk menghitung sebaran "jumlah toko yang menjual
  // masing-masing produk" per rute (mis. Rute Bklu1: Roll On 70 toko, B35 20 toko).
  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);

  const enriched = useMemo(() => (db.rute||[]).map(r => {
    const tokoRute = (db.toko||[]).filter(t=>t.ruteId===r.id);
    return {
      ...r,
      wilayahNama: (db.wilayah||[]).find(w=>w.id===r.wilayahId)?.nama||"—",
      jumlahToko: tokoRute.length,
      produkBreakdown: hitungTokoPerProduk(tokoRute, produkAktif),
    };
  }), [db, produkAktif]);

  // Urutkan Master Rute berdasarkan Wilayah dahulu (abjad), lalu Nama Rute
  // (natural sort: angka di akhir nama diurutkan sebagai angka, jadi
  // Bklu1, Bklu2, ... Bklu10 — bukan Bklu1, Bklu10, Bklu2 secara alfabetis).
  // Otomatis berlaku untuk rute baru yang ditambahkan kapan pun.
  const sorted = useMemo(() => [...enriched].sort((a,b) => {
    const wCompare = a.wilayahNama.localeCompare(b.wilayahNama, "id", { sensitivity:"base" });
    if (wCompare !== 0) return wCompare;
    return naturalCompare(a.nama, b.nama);
  }), [enriched]);

  const data = useMemo(() => sorted.filter(r =>
    (!filter.q || r.nama.toLowerCase().includes(filter.q.toLowerCase())) &&
    (!filter.wilayahId || r.wilayahId===filter.wilayahId)
  ), [sorted, filter]);

  function openAdd() { setForm({ nama:"", wilayahId:"", keterangan:"" }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.nama || !form.wilayahId) return alert("Nama & Wilayah wajib diisi");
    // Validasi duplikat: nama rute yang sama (tidak case-sensitive) DI DALAM
    // wilayah yang sama dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.rute||[]).some(r =>
      normTxt(r.nama) === normTxt(form.nama) && r.wilayahId === form.wilayahId && r.id !== form.id
    );
    if (isDup) {
      alert(`⚠️ Nama rute "${form.nama}" sudah ada di wilayah ini pada data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama rute yang berbeda.`);
      return;
    }
    if (modal==="add") addRecord("rute", { ...form, id:genId("RTE-",db.rute) });
    else updateRecord("rute", form.id, form);
    setModal(null);
  }

  const wilayahOpts = useMemo(() => sortByNama(db.wilayah).map(w=>({ value:w.id, label:w.nama })), [db.wilayah]);

  // ✅ Total per wilayah (mengikuti filter Wilayah yang aktif) dan total
  // SEMUA WILAYAH — selalu dihitung dari SELURUH toko (bukan hanya rute yang
  // lolos filter pencarian nama), supaya jadi rekap total yang stabil.
  const wilayahTerpilihNama = filter.wilayahId ? (db.wilayah||[]).find(w=>w.id===filter.wilayahId)?.nama : null;
  const totalWilayahBreakdown = useMemo(() => {
    if (!filter.wilayahId) return null;
    const ruteIdsWilayah = (db.rute||[]).filter(r=>r.wilayahId===filter.wilayahId).map(r=>r.id);
    const tokoWilayah = (db.toko||[]).filter(t=>ruteIdsWilayah.includes(t.ruteId));
    return { breakdown: hitungTokoPerProduk(tokoWilayah, produkAktif), totalToko: tokoWilayah.length };
  }, [db.rute, db.toko, filter.wilayahId, produkAktif]);
  const totalSemuaWilayahBreakdown = useMemo(
    () => hitungTokoPerProduk(db.toko||[], produkAktif),
    [db.toko, produkAktif]
  );
  const totalTokoSemuaWilayah = (db.toko||[]).length;

  const cols = [
    { key:"id",          label:"ID",         render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"nama",        label:"Nama Rute",  render:v=><b>{v}</b> },
    { key:"wilayahNama", label:"Wilayah",    render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahToko",  label:"Toko",       render:v=><span style={{ fontWeight:700, color:T.blue }}>{v}</span> },
    { key:"produkBreakdown", label:"Toko per Produk", render:v=><ProdukBreakdownBadges breakdown={v} /> },
    { key:"keterangan",  label:"Keterangan" },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>🛣️ Master Rute</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.rute||[]).length} rute aktif · terurut per wilayah & abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={data} columns={cols} title="Data Rute" filename="rute" />
          <Btn onClick={openAdd} icon="＋">Tambah Rute</Btn>
        </div>
      </div>
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:700, color:T.gray800, marginBottom:8 }}>
          🧴 Total Toko per Produk — Semua Wilayah ({totalTokoSemuaWilayah} toko)
        </div>
        <ProdukBreakdownBadges breakdown={totalSemuaWilayahBreakdown} />
        {totalWilayahBreakdown && (
          <>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray800, margin:"14px 0 8px" }}>
              📍 Total Toko per Produk — Wilayah {wilayahTerpilihNama} ({totalWilayahBreakdown.totalToko} toko)
            </div>
            <ProdukBreakdownBadges breakdown={totalWilayahBreakdown.breakdown} />
          </>
        )}
      </Card>
      <FilterBar filters={[
        { key:"q", label:"Cari Rute", value:filter.q },
        { key:"wilayahId", label:"Filter Wilayah", value:filter.wilayahId, options:wilayahOpts },
      ]} onChange={(k,v)=>setFilter(p=>({...p,[k]:v}))} onReset={()=>setFilter({q:"",wilayahId:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={data.length}
        onSelectAll={()=>toggleSelectAll(data, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="rute" />
      <Card padding={0}>
        <Table columns={cols} data={data} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus rute ini?")) deleteRecord("rute",id); }}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Rute":"Edit Rute"} onClose={()=>setModal(null)}>
          <Input label="Nama Rute" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Rute Utara A" />
          <SearchableSelect label="Wilayah" value={form.wilayahId} onChange={v=>f("wilayahId",v)} options={wilayahOpts} required placeholder="Cari wilayah..." />
          <Input label="Keterangan" value={form.keterangan} onChange={v=>f("keterangan",v)} type="textarea" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB TOKO (dengan stok terintegrasi)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  AUTO-UPGRADE: Toko status "Baru" → "Aktif" setelah 1 bulan (30 hari)
// ─────────────────────────────────────────────
function autoUpgradeBaruToAktif(db, updateRecord) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  (db.toko||[]).forEach(toko => {
    if (toko.status !== "Baru") return;
    if (!toko.tanggalMasuk) return;
    const masuk = new Date(toko.tanggalMasuk);
    if (isNaN(masuk.getTime())) return;
    if (masuk <= thirtyDaysAgo) {
      // Sudah lebih dari 30 hari, upgrade ke Aktif
      updateRecord("toko", toko.id, { status: "Aktif" });
    }
  });
}

function TabToko({ db, addRecord, updateRecord, deleteRecord, save, salesWilayahId, isSalesRestricted }) {
  const [modal, setModal] = useState(null);
  const [stokModal, setStokModal] = useState(null);
  const [form, setForm] = useState({ nama:"", ruteId:"", status:"Aktif", produkIds:[], catatan:"" });
  const [formWilayahId, setFormWilayahId] = useState(""); // wilayah filter di form toko
  const [stokForm, setStokForm] = useState({});
  const [filter, setFilter] = useState({ q:"", ruteId:"", wilayahId:"", status:"" });
  // Filter untuk panel Daftar Stok Produk
  const [stokFilter, setStokFilter] = useState({ q:"", ruteId:"", wilayahId:"", produkId:"" });
  const [showStokPanel, setShowStokPanel] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} toko terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("toko", id));
    setSelectedIds([]);
  }

  const enriched = useMemo(() => (db.toko||[]).map(t => {
    const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
    const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
    return { ...t, ruteNama:rute?.nama||"—", wilayahNama:wilayah?.nama||"—", wilayahId:wilayah?.id||"" };
  }), [db]);

  // Urutkan Master Toko berdasarkan abjad Nama Toko sebagai default,
  // agar lebih mudah dicari/diinput meski data terus bertambah.
  const sorted = useMemo(() => sortByNama(enriched), [enriched]);

  const data = useMemo(() => sorted.filter(t =>
    (!isSalesRestricted || t.wilayahId===salesWilayahId) && // Sales cuma boleh lihat/edit toko wilayahnya sendiri
    (!filter.q || t.nama.toLowerCase().includes(filter.q.toLowerCase()) || t.kode?.toLowerCase().includes(filter.q.toLowerCase())) &&
    (!filter.ruteId || t.ruteId===filter.ruteId) &&
    (!filter.wilayahId || t.wilayahId===filter.wilayahId) &&
    (!filter.status || t.status===filter.status)
  ), [sorted, filter, isSalesRestricted, salesWilayahId]);

  const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);

  function openAdd() {
    setForm({ nama:"", ruteId:"", status:"Aktif", produkIds:[], catatan:"" });
    setFormWilayahId("");
    setModal("add");
  }
  function openEdit(row) {
    const produkIds = produkAktif.filter(p=>row[`produk_${p.id}`]).map(p=>p.id);
    // Set wilayah filter sesuai rute toko yang sedang diedit
    const ruteObj = (db.rute||[]).find(r=>r.id===row.ruteId);
    setFormWilayahId(ruteObj?.wilayahId || "");
    setForm({ ...row, produkIds });
    setModal("edit");
  }
  function submit() {
    if (!form.nama || !form.ruteId) return alert("Nama & Rute wajib diisi");
    // Validasi duplikat toko: nama toko yang sama (tidak case-sensitive) DI
    // DALAM rute yang sama dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.toko||[]).some(t =>
      normTxt(t.nama) === normTxt(form.nama) && t.ruteId === form.ruteId && t.id !== form.id
    );
    if (isDup) {
      alert(`⚠️ Nama toko "${form.nama}" sudah terdaftar di rute ini pada data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama toko yang berbeda (atau periksa kembali apakah ini toko duplikat).`);
      return;
    }
    const ruteObj = (db.rute||[]).find(r=>r.id===form.ruteId);
    const prefix = ruteObj ? "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-" : "GW-XXX-";
    const produkFlags = {};
    produkAktif.forEach(p => { produkFlags[`produk_${p.id}`] = (form.produkIds||[]).includes(p.id); });
    if (modal==="add") {
      const newId = genId("T", db.toko);
      const counter = newId.replace("T","");
      const today = new Date().toISOString().slice(0,10);
      const tanggalMasuk = form.status === "Baru" ? (form.tanggalMasuk || today) : (form.tanggalMasuk || null);
      addRecord("toko", { ...form, ...produkFlags, id:newId, kode:prefix+counter, tanggalMasuk });
    } else {
      // Jika status diubah ke Baru dan belum ada tanggalMasuk, isi sekarang
      const existing = (db.toko||[]).find(t=>t.id===form.id);
      const tanggalMasuk = form.tanggalMasuk || (form.status === "Baru" && !existing?.tanggalMasuk
        ? new Date().toISOString().slice(0,10) : existing?.tanggalMasuk || null);
      updateRecord("toko", form.id, { ...form, ...produkFlags, tanggalMasuk });
    }
    setModal(null);
  }

  // Stok update modal
  function openStok(row) {
    const sf = {};
    produkAktif.forEach(p => { sf[p.id] = row[`stok_${p.id}`] || 0; });
    setStokForm({ tokoId:row.id, tokoNama:row.nama, stok:sf });
    setStokModal(true);
  }
  function submitStok() {
    const newDB = { ...db };
    newDB.toko = db.toko.map(t => {
      if (t.id !== stokForm.tokoId) return t;
      const updates = {};
      // ✅ Sinkron ceklis "Produk yang Dijual" (produkIds) dengan perubahan
      // stok lewat "Update Stok Awal" ini — sebelumnya cuma stok yang berubah,
      // ceklisnya dibiarkan apa adanya. Sekarang: produk yang diisi stok > 0
      // otomatis dicentang (kalau belum), dan produk yang diisi 0 otomatis
      // dihilangkan ceklisnya (kalau sebelumnya sudah tercentang) — sama
      // seperti sinkronisasi di Kontrol Bulanan & Penyesuaian Stok.
      const existingIds = t.produkIds || [];
      const toAdd = [];
      const toRemove = [];
      produkAktif.forEach(p => {
        const stokBaru = Number(stokForm.stok[p.id]||0);
        updates[`stok_${p.id}`] = stokBaru;
        const sudahAda = existingIds.includes(p.id);
        if (stokBaru > 0 && !sudahAda) toAdd.push(p.id);
        else if (stokBaru === 0 && sudahAda) toRemove.push(p.id);
      });
      if (toAdd.length > 0 || toRemove.length > 0) {
        updates.produkIds = existingIds.filter(id=>!toRemove.includes(id)).concat(toAdd);
      }
      return { ...t, ...updates };
    });
    save(newDB);
    setStokModal(false);
  }

  // Opsi Rute & Wilayah diurutkan per wilayah (abjad) lalu nama rute
  // (natural sort, angka di akhir nama diurutkan sebagai angka), agar mudah
  // dicari di dropdown pencarian.
  const ruteOpts = useMemo(() => {
    const list = (db.rute||[]).map(r => {
      const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
      return { value:r.id, label:`${r.nama} (${w?.nama||"?"})`, wilayahNama:w?.nama||"", ruteNama:r.nama, wilayahId:r.wilayahId };
    });
    return list.sort((a,b) => {
      const wCompare = a.wilayahNama.localeCompare(b.wilayahNama, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.ruteNama, b.ruteNama);
    });
  }, [db.rute, db.wilayah]);
  // Rute yang difilter sesuai wilayah yang dipilih di form (untuk dropdown form Tambah/Edit Toko)
  const ruteOptsFiltered = useMemo(() =>
    formWilayahId ? ruteOpts.filter(r => r.wilayahId === formWilayahId) : ruteOpts
  , [ruteOpts, formWilayahId]);
  // Rute yang difilter sesuai wilayah yang dipilih di FILTER PANEL (beda
  // dengan ruteOptsFiltered di atas yang khusus untuk form Tambah/Edit
  // Toko) — supaya dropdown Rute di filter cuma menampilkan rute dari
  // wilayah yang sedang difilter, bukan semua rute dari seluruh wilayah.
  const ruteOptsForFilter = useMemo(() =>
    filter.wilayahId ? ruteOpts.filter(r => r.wilayahId === filter.wilayahId) : ruteOpts
  , [ruteOpts, filter.wilayahId]);
  const wilayahOpts = useMemo(() => sortByNama(db.wilayah).map(w=>({ value:w.id, label:w.nama })), [db.wilayah]);

  // Import Toko dari Excel
  function importTokoFromRows(rows) {
    const errors = [];
    let skipped = 0;
    const existingToko = [...(db.toko||[])];
    const toAdd = [];          // toko baru yang aman langsung ditambahkan (tidak ada duplikat)
    const dupCandidates = [];  // { tokoObj, label } — nama toko duplikat dalam rute yang sama, menunggu keputusan user

    rows.forEach((row, i) => {
      const rowNum = i + 2; // header = baris 1
      const nama = String(row["Nama Toko*"] ?? row["Nama Toko"] ?? "").trim();
      const ruteNama = String(row["Rute*"] ?? row["Rute"] ?? "").trim();
      if (!nama || !ruteNama) { errors.push(`Baris ${rowNum}: Nama Toko & Rute wajib diisi`); skipped++; return; }
      const ruteObj = (db.rute||[]).find(r => r.nama.toLowerCase() === ruteNama.toLowerCase());
      if (!ruteObj) { errors.push(`Baris ${rowNum}: Rute "${ruteNama}" tidak ditemukan di Master Rute`); skipped++; return; }
      // Cek duplikat nama toko dalam rute yang sama (baik sudah ada di data
      // sebelumnya, maupun duplikat antar baris lain dalam file import ini).
      // TIDAK langsung dilewati — dikumpulkan dulu, lalu user ditanya apakah
      // tetap ingin menambahkannya atau melewatinya, supaya tidak ada nama
      // toko yang sama tanpa sengaja tercatat dua kali dalam satu rute.
      const isDup = existingToko.some(t => normTxt(t.nama) === normTxt(nama) && t.ruteId === ruteObj.id)
        || toAdd.some(t => normTxt(t.nama) === normTxt(nama) && t.ruteId === ruteObj.id)
        || dupCandidates.some(d => normTxt(d.tokoObj.nama) === normTxt(nama) && d.tokoObj.ruteId === ruteObj.id);
      let status = String(row["Status"] ?? "Aktif").trim();
      if (!["Aktif","Non-Aktif","Baru"].includes(status)) status = "Aktif";
      const catatan = String(row["Catatan"] ?? "").trim();
      const produkFlags = {};
      produkAktif.forEach(p => {
        const v = String(row[`Jual: ${p.nama}`] ?? "").trim().toLowerCase();
        produkFlags[`produk_${p.id}`] = ["ya","yes","true","1"].includes(v);
      });
      const newId = genId("T", [...existingToko, ...toAdd, ...dupCandidates.map(d=>d.tokoObj)]);
      const prefix = "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-";
      const counter = newId.replace("T","");
      const today = new Date().toISOString().slice(0,10);
      const tanggalMasukImport = status === "Baru" ? today : null;
      // Baca stok produk dari kolom Excel jika ada (Stok: <nama produk>)
      const stokFromExcel = {};
      produkAktif.forEach(p => {
        const stokVal = Number(row[`Stok: ${p.nama}`] ?? row[`Stok ${p.nama}`] ?? 0);
        stokFromExcel[`stok_${p.id}`] = isNaN(stokVal) ? 0 : stokVal;
      });
      const tokoObj = { id:newId, nama, ruteId:ruteObj.id, status, catatan, kode:prefix+counter, tanggalMasuk:tanggalMasukImport, ...produkFlags, ...stokFromExcel };
      if (isDup) {
        dupCandidates.push({ tokoObj, label: `Toko "${nama}" di rute "${ruteObj.nama}" (baris ${rowNum})` });
      } else {
        toAdd.push(tokoObj);
      }
    });

    // Komit final: dipanggil langsung kalau tidak ada duplikat sama sekali,
    // atau dipanggil setelah user memilih di dialog konfirmasi duplikat.
    function commit(includeDuplicates) {
      const finalNew = includeDuplicates ? [...toAdd, ...dupCandidates.map(d=>d.tokoObj)] : toAdd;
      const skippedDup = includeDuplicates ? 0 : dupCandidates.length;
      if (finalNew.length > 0) save({ ...db, toko:[...existingToko, ...finalNew] });
      return { added: finalNew.length, skipped: skipped + skippedDup, errors };
    }

    if (dupCandidates.length > 0) {
      return {
        needsConfirm: true,
        title: "⚠️ Toko Duplikat Ditemukan",
        message: `Ditemukan ${dupCandidates.length} toko dengan nama yang sama pada rute yang sama:`,
        dupList: dupCandidates.map(d => d.label),
        onConfirm: commit, // onConfirm(true) = tetap tambahkan semua, onConfirm(false) = lewati yang duplikat
      };
    }
    return commit(false);
  }

  const cols = [
    { key:"kode",       label:"Kode",    render:v=><code style={{ fontSize:11, color:T.blue }}>{v}</code> },
    { key:"nama",       label:"Nama Toko", render:v=><b>{v}</b> },
    { key:"ruteNama",   label:"Rute",    render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"wilayahNama",label:"Wilayah" },
    { key:"status",     label:"Status",  render:v=><Badge color={v==="Aktif"?T.green:v==="Baru"?T.blue:T.red}>{v}</Badge> },
    { key:"tanggalMasuk", label:"Tgl Masuk", render:(v,row)=> row.status==="Baru" && v
      ? <span style={{ fontSize:11, color:T.blue }}>{v}</span>
      : <span style={{ color:T.gray400 }}>—</span> },
    ...produkAktif.map(p=>({ key:`produk_${p.id}`, label:p.nama, render:v=><span>{v?"✅":"—"}</span> })),
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>🏪 Master Toko</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.toko||[]).length} toko · {(db.toko||[]).filter(t=>t.status==="Aktif").length} aktif · terurut abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {!isSalesRestricted && <ImportMenu label="Import Toko" onTemplate={()=>downloadTokoTemplate(db)} onParseRows={importTokoFromRows} />}
          <ExportMenu data={data} columns={cols} title="Data Toko" filename="toko" />
          {!isSalesRestricted && <Btn onClick={openAdd} icon="＋">Tambah Toko</Btn>}
        </div>
      </div>
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
          padding:"8px 14px", fontSize:12, color:T.green, marginBottom:12 }}>
          🔒 Menampilkan toko di wilayah kamu saja. Kamu bisa memperbaiki Nama Toko & Rute; perubahan
          status/produk/stok perlu Admin atau Manajer.
        </div>
      )}
      <FilterBar filters={[
        { key:"q",        label:"Cari Nama Toko / Kode", value:filter.q, placeholder:"Ketik untuk mencari..." },
        { key:"wilayahId",label:"Wilayah",          value:filter.wilayahId, options:wilayahOpts },
        { key:"ruteId",   label:"Rute",             value:filter.ruteId,    options:ruteOptsForFilter },
        { key:"status",   label:"Status",           value:filter.status,    options:[{value:"Aktif",label:"Aktif"},{value:"Baru",label:"Baru"},{value:"Non-Aktif",label:"Non-Aktif"}] },
      ]} onChange={(k,v)=>setFilter(p=>{
        const next = {...p,[k]:v};
        // Reset rute yang dipilih kalau wilayah diganti, supaya tidak
        // "nyangkut" filter rute dari wilayah sebelumnya.
        if (k==="wilayahId") next.ruteId = "";
        return next;
      })} onReset={()=>setFilter({q:"",ruteId:"",wilayahId:"",status:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={data.length}
        onSelectAll={()=>toggleSelectAll(data, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="toko" />
      <Card padding={0}>
        <Table columns={cols} data={data} onEdit={openEdit}
          onDelete={isSalesRestricted ? undefined : (id=>{ if(confirm("Hapus toko ini?")) deleteRecord("toko",id); })}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {/* Panel Daftar Stok Produk per Toko dengan Filter */}
      <div style={{ marginTop:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom: showStokPanel ? 12 : 0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:14, fontWeight:700, color:T.gray800 }}>📦 Daftar Stok Produk per Toko</div>
            <Badge color={T.teal}>{data.length} toko</Badge>
          </div>
          <Btn variant="secondary" size="sm"
            onClick={()=>setShowStokPanel(v=>!v)}>
            {showStokPanel ? "▲ Sembunyikan" : "▼ Tampilkan"}
          </Btn>
        </div>
        {showStokPanel && (() => {
          // Filter stok panel
          const stokData = data.filter(t =>
            (!stokFilter.q || t.nama.toLowerCase().includes(stokFilter.q.toLowerCase()) || t.kode?.toLowerCase().includes(stokFilter.q.toLowerCase())) &&
            (!stokFilter.ruteId || t.ruteId === stokFilter.ruteId) &&
            (!stokFilter.wilayahId || t.wilayahId === stokFilter.wilayahId)
          ).filter(t =>
            // Filter by produk stok: hanya tampilkan toko yang punya stok > 0 untuk produk terpilih
            !stokFilter.produkId || (t[`stok_${stokFilter.produkId}`]||0) > 0
          );

          return (
            <div>
              {/* Filter Bar Stok */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end",
                background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"12px 16px", marginBottom:12 }}>
                <div style={{ minWidth:180, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>🔍 Cari Toko</div>
                  <input value={stokFilter.q} onChange={e=>setStokFilter(p=>({...p,q:e.target.value}))}
                    placeholder="Nama toko / kode..."
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
                </div>
                <div style={{ minWidth:140, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Wilayah</div>
                  <select value={stokFilter.wilayahId}
                    onChange={e=>setStokFilter(p=>({...p, wilayahId:e.target.value, ruteId:""}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua</option>
                    {wilayahOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:140, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Rute</div>
                  <select value={stokFilter.ruteId}
                    onChange={e=>setStokFilter(p=>({...p, ruteId:e.target.value}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua</option>
                    {(stokFilter.wilayahId
                      ? ruteOpts.filter(r => {
                          const rObj = (db.rute||[]).find(x=>x.id===r.value);
                          return rObj?.wilayahId === stokFilter.wilayahId;
                        })
                      : ruteOpts
                    ).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:160, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Filter Produk (stok &gt; 0)</div>
                  <select value={stokFilter.produkId}
                    onChange={e=>setStokFilter(p=>({...p, produkId:e.target.value}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua produk</option>
                    {produkAktif.map(p=><option key={p.id} value={p.id}>{p.nama}</option>)}
                  </select>
                </div>
                <Btn variant="secondary" size="sm"
                  onClick={()=>setStokFilter({q:"",ruteId:"",wilayahId:"",produkId:""})}>
                  Reset
                </Btn>
              </div>

              {stokData.length === 0 ? (
                <div style={{ textAlign:"center", color:T.gray400, padding:24, fontSize:13 }}>
                  Tidak ada toko dengan stok yang sesuai filter.
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                        <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>Toko</th>
                        <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>Rute</th>
                        {produkAktif.map(p=>(
                          <th key={p.id} style={{ padding:"8px 12px", textAlign:"center", fontWeight:700,
                            color: stokFilter.produkId === p.id ? T.green : T.gray600,
                            fontSize:11, textTransform:"uppercase" }}>
                            📦 {p.nama}
                          </th>
                        ))}
                        <th style={{ padding:"8px 12px", textAlign:"right", fontWeight:700, color:T.gray600, fontSize:11 }}>AKSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stokData.map((t,i) => (
                        <tr key={t.id} style={{ background:i%2===0?T.white:T.gray50, borderBottom:`1px solid ${T.gray100}` }}>
                          <td style={{ padding:"8px 12px", fontWeight:700 }}>
                            {t.nama}
                            {t.status === "Baru" && <span style={{ marginLeft:6, fontSize:9, background:T.blue, color:"#fff", borderRadius:99, padding:"1px 6px" }}>BARU</span>}
                          </td>
                          <td style={{ padding:"8px 12px", color:T.teal }}>{t.ruteNama}</td>
                          {produkAktif.map(p=>{
                            const stok = t[`stok_${p.id}`]||0;
                            return (
                              <td key={p.id} style={{ padding:"8px 12px", textAlign:"center",
                                fontWeight: stok > 0 ? 700 : 400,
                                color: stok > 0 ? T.green : T.gray400,
                                background: stokFilter.produkId === p.id ? (stok > 0 ? T.greenLt : T.redLt) : "transparent" }}>
                                {stok > 0 ? `✅ ${fmt(stok)}` : "—"}
                              </td>
                            );
                          })}
                          <td style={{ padding:"8px 12px", textAlign:"right" }}>
                            {!isSalesRestricted && <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>openStok(t)}>Update</Btn>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize:11, color:T.gray400, marginTop:8, textAlign:"right" }}>
                    Menampilkan {stokData.length} dari {data.length} toko
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {modal && (
        <Modal title={modal==="add"?"Tambah Toko":"Edit Toko"} onClose={()=>setModal(null)}>
          {isSalesRestricted && (
            <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
              padding:"8px 12px", fontSize:12, color:T.green, marginBottom:12 }}>
              🔒 Sebagai Sales, kamu cuma bisa memperbaiki <b>Nama Toko</b> dan <b>Rute</b>. Perubahan
              lain (status, produk, stok) perlu dilakukan Admin/Manajer.
            </div>
          )}
          <Input label="Nama Toko" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Toko Barokah" />
          <SearchableSelect label="Filter Wilayah (opsional)" value={formWilayahId}
            onChange={v=>{ setFormWilayahId(v); f("ruteId",""); }}
            options={wilayahOpts} placeholder="Pilih wilayah untuk filter rute..." />
          <SearchableSelect label="Rute" value={form.ruteId} onChange={v=>f("ruteId",v)} options={ruteOptsFiltered} required placeholder={formWilayahId ? "Pilih rute..." : "Cari rute / wilayah..."} />
          {!isSalesRestricted && (
            <>
              <Input label="Status" value={form.status} onChange={v=>f("status",v)}
                options={[{value:"Aktif",label:"Aktif"},{value:"Non-Aktif",label:"Non-Aktif"},{value:"Baru",label:"Baru (trial)"}]} />
              {form.status === "Baru" && (
                <Input label="Tanggal Masuk (Baru)" value={form.tanggalMasuk||new Date().toISOString().slice(0,10)}
                  onChange={v=>f("tanggalMasuk",v)} type="date"
                  hint="Dipakai untuk auto-upgrade ke Aktif setelah 30 hari" />
              )}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:8 }}>Produk yang Dijual:</div>
                <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {produkAktif.map(p => (
                    <label key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                      border:`1.5px solid ${(form.produkIds||[]).includes(p.id)?T.green:T.gray200}`,
                      borderRadius:8, cursor:"pointer", background:(form.produkIds||[]).includes(p.id)?T.greenLt:T.white }}>
                      <input type="checkbox" checked={(form.produkIds||[]).includes(p.id)}
                        onChange={e => {
                          const ids = form.produkIds||[];
                          f("produkIds", e.target.checked ? [...ids,p.id] : ids.filter(x=>x!==p.id));
                        }}
                        style={{ accentColor:T.green }} />
                      <span style={{ fontSize:13, fontWeight:600 }}>{p.nama}</span>
                      <span style={{ fontSize:11, color:T.gray400 }}>{fmtRp(p.harga)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Input label="Catatan" value={form.catatan||""} onChange={v=>f("catatan",v)} type="textarea" />
            </>
          )}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}

      {stokModal && (
        <Modal title={`📦 Update Stok Awal — ${stokForm.tokoNama}`} onClose={()=>setStokModal(false)}>
          <div style={{ fontSize:13, color:T.gray600, marginBottom:16 }}>
            Stok ini otomatis ter-update setiap kali ada entri <b>Kontrol Bulanan</b> baru untuk toko ini
            — nilai "Stok Awal" pada kontrol terakhir dibawa apa adanya (sudah termasuk hasil
            restock etalase saat kunjungan itu). Gunakan form ini hanya untuk <b>koreksi manual</b>
            (misal: stok opname, retur, atau setup awal sebelum ada kontrol).
          </div>
          {produkAktif.map(p => (
            <Input key={p.id} label={`Stok ${p.nama} (${p.id})`}
              value={stokForm.stok?.[p.id]||0}
              onChange={v => setStokForm(sf=>({ ...sf, stok:{ ...sf.stok, [p.id]:v } }))}
              type="number" />
          ))}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setStokModal(false)}>Batal</Btn>
            <Btn onClick={submitStok}>Simpan Stok</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB PRODUK (tipe isi manual)
// ─────────────────────────────────────────────
function TabProduk({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0 });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function openAdd() { setForm({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0 }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.id || !form.nama || !form.harga) return alert("Kode, Nama, & Harga wajib diisi");
    if (modal==="add") {
      if ((db.produk||[]).find(p=>p.id===form.id)) return alert("Kode produk sudah ada!");
      addRecord("produk", { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0) });
    } else {
      updateRecord("produk", form.id, { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0) });
    }
    setModal(null);
  }

  const cols = [
    { key:"id",    label:"Kode",    render:v=><b style={{ color:T.blue }}>{v}</b> },
    { key:"nama",  label:"Nama Produk", render:v=><b>{v}</b> },
    { key:"tipe",  label:"Tipe",    render:v=><Badge color={T.purple}>{v||"—"}</Badge> },
    { key:"harga", label:"Harga (Rp)", render:v=><span style={{ fontWeight:700, color:T.green }}>{fmtRp(v)}</span> },
    { key:"bonus", label:"Bonus (pcs)", render:v=><span style={{ color:T.gold }}>{v?`${v} pcs`:"—"}</span> },
    { key:"aktif", label:"Aktif",   render:v=><Badge color={v?T.green:T.red}>{v?"Ya":"Tidak"}</Badge> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>🧴 Master Produk</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.produk||[]).length} produk · Tipe bisa diisi bebas</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={db.produk||[]} columns={cols} title="Data Produk" filename="produk" />
          <Btn onClick={openAdd} icon="＋">Tambah Produk</Btn>
        </div>
      </div>
      <Card padding={0}>
        <Table columns={cols} data={db.produk||[]} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus produk ini?")) deleteRecord("produk",id); }} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Produk":"Edit Produk"} onClose={()=>setModal(null)}>
          <Input label="Kode Produk" value={form.id} onChange={v=>f("id",v.toUpperCase())} required
            placeholder="cth: R, B, P, LP" disabled={modal==="edit"}
            hint="Kode unik 1–4 huruf, digunakan di Kontrol Bulanan" />
          <Input label="Nama Produk" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Roll On" />
          <Input label="Tipe Produk" value={form.tipe} onChange={v=>f("tipe",v)}
            placeholder="cth: Roll, Botol, Legend, Spray — isi bebas" hint="Ketik nama tipe secara manual" />
          <Input label="Harga Dasar (Rp)" value={form.harga} onChange={v=>f("harga",v)} type="number" required />
          <Input label="Bonus per Kontrol (pcs)" value={form.bonus||0} onChange={v=>f("bonus",v)} type="number"
            hint="Jumlah produk bonus yang diberikan ke toko per kunjungan kontrol (opsional)" />
          <Input label="Aktif" type="checkbox" value={form.aktif} onChange={v=>f("aktif",v)}
            placeholder="Tampilkan di kontrol bulanan" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB KONTROL BULANAN
// ─────────────────────────────────────────────
function TabKontrol({ db, addRecord, updateRecord, deleteRecord, save, salesWilayahId }) {
  const isSalesRestricted = !!salesWilayahId; // true jika Sales dengan wilayah spesifik
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ tokoId:"", tanggal:"", catatanStatus:"", catatan:"" });
  // Jika Sales dengan wilayah terkunci, filter modal otomatis menggunakan wilayah Sales
  const [modalFilter, setModalFilter] = useState({ wilayahId: salesWilayahId||"", ruteId:"" });
  const [filter, setFilter] = useState({ wilayahId: salesWilayahId||"", ruteId:"", bulan:"", q:"",
    // ✅ Filter "Belum Dikontrol Hari Ini": cek tanggal tertentu (default hari ini),
    // tampilkan hanya toko yang BELUM ada entri kontrol pada tanggal tsb,
    // padahal toko lain di rute yang sama sudah.
    cekTanggal: new Date().toISOString().slice(0,10), hanyaBelumHariIni: false });
  const [viewMode, setViewMode] = useState("table"); // table | monthly

  // ✅ AUTO-APPROVE: pengajuan Penyesuaian Stok dari Sales yang sudah lewat
  // 24 jam (autoApproveAt) dan belum ditolak, otomatis disetujui sendiri.
  // Dicek sekali tiap kali tab ini dibuka/data penyesuaian berubah — cukup
  // untuk pemakaian normal (app dibuka rutin tiap hari oleh Admin/Manajer).
  useEffect(() => {
    const now = Date.now();
    const expired = (db.penyesuaian||[]).filter(pz =>
      pz.status === "menunggu" && pz.autoApproveAt && pz.autoApproveAt <= now
    );
    if (expired.length === 0) return;
    expired.forEach(pz => {
      updateRecord("penyesuaian", pz.id, { status: "disetujui", disetujuiOleh: "Otomatis (24 jam)" });
    });
    // Hitung ulang stok toko yang terdampak, sesudah data ter-update.
    const tokoIds = [...new Set(expired.map(pz=>pz.tokoId))];
    setTimeout(() => tokoIds.forEach(tid => recalcTokoStok(tid)), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.penyesuaian]);
  const [deleteTarget, setDeleteTarget] = useState(null); // Fix: konfirmasi hapus
  const [selectedIds, setSelectedIds] = useState([]);

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} catatan kontrol terpilih? Tindakan ini permanen.`)) return;
    // Kumpulkan tokoId yang terdampak agar stoknya disinkronkan ulang setelah hapus
    const affectedTokoIds = [...new Set(selectedIds.map(id => (db.kontrol||[]).find(k=>k.id===id)?.tokoId).filter(Boolean))];
    selectedIds.forEach(id => deleteRecord("kontrol", id));
    const remaining = (db.kontrol||[]).filter(k => !selectedIds.includes(k.id));
    affectedTokoIds.forEach(tokoId => recalcTokoStok(tokoId, remaining));
    setSelectedIds([]);
  }
  // Modal untuk mengubah status toko langsung dari kontrol (tarik/non-aktifkan toko)
  const [tokoStatusModal, setTokoStatusModal] = useState(null); // { toko, mode:"nonaktif"|"aktif" }
  const [stokPenarikan, setStokPenarikan] = useState({}); // stok saat penarikan { produkId: jumlah }
  // ✅ BARU: Modal Edit Status Toko — ubah Aktif/Baru/Non-Aktif langsung dari TabKontrol
  const [editStatusModal, setEditStatusModal] = useState(null); // { toko } | null
  const [editStatusValue, setEditStatusValue] = useState(""); // "Aktif" | "Baru" | "Non-Aktif"
  const [editStatusCatatan, setEditStatusCatatan] = useState("");
  // ✅ Modal Tambah Toko Cepat dari Kontrol
  const [tambahTokoModal, setTambahTokoModal] = useState(false);
  const [tambahTokoForm, setTambahTokoForm] = useState({ nama:"", ruteId:"", status:"Aktif", catatan:"" });
  const ttf = (k,v) => setTambahTokoForm(p=>({...p,[k]:v}));
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  // ✅ Penyesuaian Stok lapangan (di luar siklus kontrol rutin): Tambah / Kurang / Tarik Sebagian
  const [penyesuaianModal, setPenyesuaianModal] = useState(false);
  const [penyesuaianForm, setPenyesuaianForm] = useState(null); // null saat tertutup
  const pf = (k,v) => setPenyesuaianForm(p=>({...p,[k]:v}));
  // ✅ Penjualan Luar Rute: sales menjual produk di luar kunjungan rute normal
  // (mis. rute lain saat kontrol rute 1, atau penjualan perorangan) dan TIDAK
  // tahu/lupa nama toko & rutenya. Dicatat terpisah dari Kontrol Bulanan
  // (yang selalu mewajibkan toko & rute) supaya penjualan tetap tercatat &
  // masuk laporan, tanpa memaksa sales mengarang nama toko/rute.
  const [luarRuteModal, setLuarRuteModal] = useState(false);
  const [luarRuteForm, setLuarRuteForm] = useState(null); // null saat tertutup
  const lf = (k,v) => setLuarRuteForm(p=>({...p,[k]:v}));

  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);

  const enriched = useMemo(() => (db.kontrol||[]).map(k => {
    const toko = (db.toko||[]).find(t=>t.id===k.tokoId);
    const rute = toko ? (db.rute||[]).find(r=>r.id===toko.ruteId) : null;
    const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
    let totalRev = 0, totalBonus = 0;
    produkAktif.forEach(p => {
      const terjual = k[`terjual_${p.id}`]||0;
      totalRev += terjual * (p.harga||0);
      // bonus per kontrol = jumlah pcs bonus produk (bukan uang)
      const bonusPcs = k[`bonusInput_${p.id}`] !== undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0);
      totalBonus += bonusPcs;
    });
    return { ...k, tokoNama:toko?.nama||"?", ruteNama:rute?.nama||"?",
      wilayahNama:wilayah?.nama||"?", ruteId:rute?.id||"", wilayahId:wilayah?.id||"",
      totalRev, totalBonus, toko, rute, wilayah };
  }), [db, produkAktif]);

  // Filter: wilayah → rute cascade.
  // Diurutkan per Wilayah (abjad) dahulu, lalu Nama Rute (natural sort) —
  // sama seperti urutan di tab Rute — supaya dropdown filter di sini tidak
  // tampil acak sesuai urutan input/insert data mentah.
  const ruteFiltered = useMemo(() => {
    const list = filter.wilayahId
      ? (db.rute||[]).filter(r=>r.wilayahId===filter.wilayahId)
      : (db.rute||[]);
    return [...list].sort((a,b) => {
      const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
      const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
      const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.nama||"", b.nama||"");
    });
  }, [db.rute, db.wilayah, filter.wilayahId]);

  const data = useMemo(() => enriched.filter(k =>
    (!filter.wilayahId || k.wilayahId === filter.wilayahId) &&
    (!filter.ruteId    || k.ruteId    === filter.ruteId) &&
    (!filter.bulan     || k.tanggal?.startsWith(filter.bulan)) &&
    (!filter.q         || normTxt(k.tokoNama).includes(normTxt(filter.q)) || normTxt(k.toko?.kode).includes(normTxt(filter.q)))
  ), [enriched, filter]);

  // Monthly view: tampilkan SEMUA toko di rute terpilih, bukan hanya yang ada entri kontrol
  const tokoPerRute = useMemo(() => {
    // Jika filter wilayah/rute aktif, filter sesuai; jika tidak, tampilkan semua rute
    const rutesToShow = filter.ruteId
      ? (db.rute||[]).filter(r=>r.id===filter.ruteId)
      : filter.wilayahId
        ? (db.rute||[]).filter(r=>r.wilayahId===filter.wilayahId)
        : (db.rute||[]);

    return rutesToShow.map(rute => {
      const wilayah = (db.wilayah||[]).find(w=>w.id===rute.wilayahId);
      // Semua toko aktif DAN baru di rute ini (Non-Aktif disembunyikan otomatis mulai bulan berikutnya)
      const tokoList = (db.toko||[]).filter(t=>t.ruteId===rute.id && (t.status==="Aktif" || t.status==="Baru")
        && (!filter.q || normTxt(t.nama).includes(normTxt(filter.q)) || normTxt(t.kode).includes(normTxt(filter.q))))
        .map(toko => {
          const entries = enriched.filter(k=>k.tokoId===toko.id && (!filter.bulan || k.tanggal?.startsWith(filter.bulan)));
          // ✅ Cek apakah toko ini SUDAH ada entri kontrol pada tanggal yang dipilih (filter.cekTanggal)
          const sudahDikontrolHariIni = enriched.some(k=>k.tokoId===toko.id && k.tanggal===filter.cekTanggal);
          return { toko, entries, sudahDikontrolHariIni };
        })
        // Jika toggle "Hanya Belum Dikontrol (tanggal terpilih)" aktif → sembunyikan toko yang sudah dikontrol di tanggal itu
        .filter(({sudahDikontrolHariIni}) => !filter.hanyaBelumHariIni || !sudahDikontrolHariIni);
      return {
        rute, wilayah,
        tokoList
      };
    }).filter(r=>r.tokoList.length>0);
  }, [db.rute, db.wilayah, db.toko, filter.ruteId, filter.wilayahId, filter.bulan, filter.q, filter.cekTanggal, filter.hanyaBelumHariIni, enriched]);

  function getInitialStok(tokoId, produkId) {
    const toko = (db.toko||[]).find(t=>t.id===tokoId);
    return toko?.[`stok_${produkId}`] || 0;
  }

  // ✅ SINKRONISASI STOK: Master Toko ↔ Kontrol Bulanan ↔ Penyesuaian Stok
  // PENTING: "Stok Awal" yang diinput sales saat kontrol itu adalah stok
  // SETELAH etalase diisi ulang saat kunjungan itu juga (kapasitas etalase,
  // misal 24 pcs) — BUKAN sisa sebelum diisi ulang. Karena sales langsung
  // mengisi ulang etalase yang kosong tiap kontrol, stok bulan depan akan
  // KEMBALI ke kapasitas yang sama, jadi cukup dibawa apa adanya (bukan
  // dikurangi Terjual/Bonus lagi — itu cuma dipakai untuk hitung Revenue &
  // pemakaian bonus, bukan untuk menentukan sisa fisik di etalase).
  // Stok di Master Toko dihitung dari GABUNGAN dua sumber:
  //  1) "Stok Awal" pada entri Kontrol Bulanan TERAKHIR (dibawa apa adanya)
  //  2) Semua Penyesuaian Stok (Tambah/Kurang/Tarik Sebagian) yang tanggalnya
  //     SAMA ATAU SETELAH kontrol terakhir tsb — dipakai kalau kapasitas
  //     etalase berubah (mis. 24→12) atau toko ditarik semua di luar siklus
  //     kontrol rutin.
  // extraKontrolList / extraPenyesuaianList: dipakai saat dipanggil tepat
  // setelah addRecord, karena db di closure ini belum memuat data terbaru.
  function recalcTokoStok(tokoId, extraKontrolList, extraPenyesuaianList) {
    const semuaKontrol = extraKontrolList || (db.kontrol||[]);
    const semuaPenyesuaian = extraPenyesuaianList || (db.penyesuaian||[]);
    const entriesToko = semuaKontrol
      .filter(k => k.tokoId === tokoId)
      .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
    const terakhir = entriesToko[entriesToko.length-1];

    // Baseline = "Stok Awal" kontrol terakhir apa adanya (sudah termasuk
    // hasil restock saat kunjungan itu). Kalau belum pernah ada kontrol,
    // baseline = 0.
    const baseline = {};
    produkAktif.forEach(p => {
      baseline[p.id] = terakhir ? Number(terakhir[`stok_${p.id}`]||0) : 0;
    });

    // Tambahkan Penyesuaian Stok yang terjadi pada/sesudah tanggal kontrol terakhir
    const batasTanggal = terakhir?.tanggal || "0000-00-00";
    const penyesuaianRelevan = semuaPenyesuaian
      .filter(pz => pz.tokoId === tokoId && (pz.tanggal||"") >= batasTanggal
        && pz.status !== "menunggu" && pz.status !== "ditolak") // hanya yang disetujui (atau data lama tanpa status)
      .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
    penyesuaianRelevan.forEach(pz => {
      const arah = pz.jenis === "Kurang" || pz.jenis === "Tarik" ? -1 : 1;
      produkAktif.forEach(p => {
        const jumlah = Number(pz[`jumlah_${p.id}`]||0);
        if (jumlah) baseline[p.id] = (baseline[p.id]||0) + arah*jumlah;
      });
    });

    if (!terakhir && penyesuaianRelevan.length === 0) return; // belum ada kontrol maupun penyesuaian → biarkan stok toko (input manual awal) apa adanya

    const updates = {};
    produkAktif.forEach(p => { updates[`stok_${p.id}`] = Math.max(0, baseline[p.id]||0); });
    updateRecord("toko", tokoId, updates);
  }

  // ✅ SINKRONISASI CEKLIS "Produk yang Dijual" ↔ Stok Kontrol Bulanan
  // Sebelumnya ceklis produk di Master Toko cuma disinkron otomatis lewat
  // fitur "Penyesuaian Stok" (Tambah), TIDAK lewat kontrol bulanan biasa.
  // Sekarang disamakan:
  //  - Stok Awal diisi > 0 untuk produk yang belum ada ceklisnya → otomatis
  //    dicentang (produk baru dititip saat kunjungan).
  //  - Produk ditandai eksplisit "🔻 Ditarik" di form kontrol (bukan sekadar
  //    Stok Awal = 0, karena stok 0 juga bisa berarti "sementara habis, tetap
  //    mau dijual bulan depan") → otomatis DIHILANGKAN ceklisnya.
  // payload = data stok_${produkId}/ditarik_${produkId} dari entri kontrol
  // yang baru saja disubmit (add atau edit).
  function syncProdukIdsDariStokKontrol(tokoId, payload) {
    const toko = (db.toko||[]).find(t => t.id === tokoId);
    if (!toko) return;
    const existingIds = toko.produkIds || [];
    const toAdd = [];
    const toRemove = [];
    produkAktif.forEach(p => {
      const stokBaru = Number(payload[`stok_${p.id}`] || 0);
      const ditarik = !!payload[`ditarik_${p.id}`];
      const sudahAda = existingIds.includes(p.id);
      if (stokBaru > 0 && !sudahAda) toAdd.push(p.id);
      else if (ditarik && sudahAda) toRemove.push(p.id);
    });
    if (toAdd.length === 0 && toRemove.length === 0) return;
    const newIds = existingIds.filter(id => !toRemove.includes(id)).concat(toAdd);
    updateRecord("toko", tokoId, { produkIds: newIds });
  }

  // ✅ HITUNG ULANG SEMUA STOK — dipakai setelah rumus baseline diperbaiki
  // (Stok Awal dibawa apa adanya, bukan dikurangi Terjual/Bonus lagi), supaya
  // Master Toko yang sudah kadung dihitung pakai rumus lama langsung
  // terkoreksi semua sekaligus, tanpa perlu menunggu kontrol berikutnya
  // satu-satu per toko. Penyesuaian Stok lapangan tetap diperhitungkan
  // seperti biasa (logika di recalcTokoStok tidak berubah untuk bagian itu).
  function recalcAllTokoStok() {
    const tokoIds = [...new Set((db.kontrol||[]).map(k=>k.tokoId))];
    if (!tokoIds.length) { alert("Belum ada data kontrol untuk dihitung."); return; }
    if (!confirm(`Hitung ulang stok untuk ${tokoIds.length} toko yang pernah dikontrol? Ini akan menimpa nilai Stok di Master Toko sesuai data kontrol & penyesuaian yang sudah ada.`)) return;
    tokoIds.forEach(tokoId => recalcTokoStok(tokoId));
    alert(`✅ Selesai — stok ${tokoIds.length} toko sudah dihitung ulang.`);
  }

  function openPenyesuaian(tokoId) {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tokoId: tokoId||"", tanggal: today, jenis:"Tambah", catatan:"", dicatatOleh:"" };
    produkAktif.forEach(p => { initial[`jumlah_${p.id}`] = 0; });
    setPenyesuaianForm(initial);
    setPenyesuaianModal(true);
  }

  function submitPenyesuaian() {
    const pforn = penyesuaianForm;
    if (!pforn?.tokoId || !pforn?.tanggal) return alert("Toko & Tanggal wajib diisi");
    if (isSalesRestricted) {
      const tokoObj = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      const ruteObj = tokoObj ? (db.rute||[]).find(r=>r.id===tokoObj.ruteId) : null;
      if (ruteObj?.wilayahId !== salesWilayahId) {
        return alert("Sebagai Sales, kamu hanya boleh mengajukan penyesuaian stok untuk toko di wilayahmu sendiri.");
      }
    }
    const adaJumlah = produkAktif.some(p => Number(pforn[`jumlah_${p.id}`]||0) > 0);
    if (!adaJumlah) return alert("Isi minimal 1 jumlah produk yang disesuaikan");
    const payload = { ...pforn };
    produkAktif.forEach(p => { payload[`jumlah_${p.id}`] = Number(pforn[`jumlah_${p.id}`]||0); });
    const newId = genId("PZ", db.penyesuaian);
    // ✅ WORKFLOW PERSETUJUAN: pengajuan dari Sales masuk status "menunggu"
    // dulu (tidak langsung mengubah stok), dan otomatis "disetujui" sendiri
    // kalau dalam 24 jam tidak ada penolakan dari Admin/Manajer. Pengajuan
    // dari Admin/Manajer langsung disetujui (tidak perlu approval sendiri).
    const newEntry = {
      ...payload, id:newId,
      status: isSalesRestricted ? "menunggu" : "disetujui",
      autoApproveAt: isSalesRestricted ? (Date.now() + 24*60*60*1000) : null,
    };
    addRecord("penyesuaian", newEntry);

    // ✅ Produk baru yang dititipkan: kalau jenis "Tambah" dan ada produk dengan
    // jumlah > 0 yang BELUM terdaftar di "Produk yang Dijual" toko ini, otomatis
    // daftarkan produk tsb ke profil toko (Master Toko) supaya langsung muncul
    // di form Kontrol bulan berikutnya — admin tidak perlu bolak-balik ke Tab Toko.
    if (pforn.jenis === "Tambah") {
      const toko = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      if (toko) {
        const existingIds = toko.produkIds||[];
        const produkBaruIds = produkAktif
          .filter(p => Number(pforn[`jumlah_${p.id}`]||0) > 0 && !existingIds.includes(p.id))
          .map(p=>p.id);
        if (produkBaruIds.length > 0) {
          updateRecord("toko", toko.id, { produkIds: [...existingIds, ...produkBaruIds] });
        }
      }
    } else if (pforn.jenis === "Tarik") {
      // ✅ "Tarik Sebagian Produk" = aksi eksplisit menandai produk ditarik dari
      // toko ini, jadi otomatis hilangkan ceklis "Produk yang Dijual".
      // Sengaja TIDAK berlaku untuk jenis "Kurang", karena "Kurang" dipakai
      // untuk penyesuaian kapasitas etalase biasa (mis. 24→12), produk tsb
      // tetap mau dijual di toko itu meski jumlahnya berkurang.
      const toko = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      if (toko) {
        const existingIds = toko.produkIds||[];
        const produkDitarikIds = produkAktif
          .filter(p => Number(pforn[`jumlah_${p.id}`]||0) > 0 && existingIds.includes(p.id))
          .map(p=>p.id);
        if (produkDitarikIds.length > 0) {
          updateRecord("toko", toko.id, { produkIds: existingIds.filter(id=>!produkDitarikIds.includes(id)) });
        }
      }
    }

    recalcTokoStok(pforn.tokoId, undefined, [...(db.penyesuaian||[]), newEntry]);
    setPenyesuaianModal(false);
    setPenyesuaianForm(null);
  }

  // ── Penjualan Luar Rute ──────────────────────────────────────────────
  // ✅ Wilayah WAJIB diisi: sales tetap bertanggung jawab atas SEMUA
  // penjualan (sesuai rute maupun di luar rute) di wilayah tugasnya, supaya
  // penjualan luar rute ini bisa ikut masuk ke Rekap Siklus wilayah terkait
  // saat siklus kontrol wilayah tsb selesai — bukan cuma "mengambang" tanpa
  // wilayah seperti sebelumnya.
  function openLuarRute() {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tanggal:today, keterangan:"", dicatatOleh:"", wilayahId: filter.wilayahId||"" };
    produkAktif.forEach(p => { initial[`terjual_${p.id}`] = 0; initial[`bonusInput_${p.id}`] = 0; });
    setLuarRuteForm(initial);
    setLuarRuteModal(true);
  }
  function submitLuarRute() {
    const lforn = luarRuteForm;
    if (!lforn?.tanggal) return alert("Tanggal wajib diisi");
    if (!lforn?.wilayahId) return alert("Wilayah wajib diisi — penjualan luar rute tetap menjadi tanggung jawab sales di wilayah tugasnya");
    if (isSalesRestricted && lforn.wilayahId !== salesWilayahId) {
      return alert("Sebagai Sales, kamu hanya boleh mencatat penjualan luar rute untuk wilayahmu sendiri.");
    }
    const adaTerjualLuar = produkAktif.some(p => Number(lforn[`terjual_${p.id}`]||0) > 0);
    if (!adaTerjualLuar) return alert("Isi minimal 1 jumlah produk yang terjual");
    const payload = { ...lforn };
    produkAktif.forEach(p => {
      payload[`terjual_${p.id}`] = Number(lforn[`terjual_${p.id}`]||0);
      payload[`bonusInput_${p.id}`] = Number(lforn[`bonusInput_${p.id}`]||0);
    });
    const newId = genId("PLR", db.penjualanLuar);
    addRecord("penjualanLuar", { ...payload, id:newId });
    setLuarRuteModal(false);
    setLuarRuteForm(null);
  }
  function deleteLuarRute(id) {
    if (!confirm("Hapus catatan penjualan luar rute ini? Tindakan ini permanen.")) return;
    deleteRecord("penjualanLuar", id);
  }


  const adaTerjual = useMemo(() =>
    produkAktif.some(p => Number(form[`terjual_${p.id}`]||0) > 0)
  , [form, produkAktif]);

  function openAdd() {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tokoId:"", tanggal:today, catatanStatus:"", catatan:"" };
    produkAktif.forEach(p => {
      initial[`stok_${p.id}`] = 0;
      initial[`terjual_${p.id}`] = 0;
      initial[`bonusInput_${p.id}`] = p.bonus||0;
      initial[`ditarik_${p.id}`] = false;
    });
    setForm(initial);
    setModalFilter({ wilayahId: filter.wilayahId||"", ruteId: filter.ruteId||"" });
    setModal("add");
  }

  function openEdit(row) {
    const initial = { ...row, catatanStatus: row.catatanStatus||"" };
    // Pastikan bonusInput tersedia
    produkAktif.forEach(p => {
      if (initial[`bonusInput_${p.id}`] === undefined) initial[`bonusInput_${p.id}`] = p.bonus||0;
      if (initial[`ditarik_${p.id}`] === undefined) initial[`ditarik_${p.id}`] = false;
    });
    setForm(initial);
    setModalFilter({ wilayahId: row.wilayahId||"", ruteId: row.ruteId||"" });
    setModal("edit");
  }

  function handleTokoChange(tokoId) {
    const updates = { tokoId };
    produkAktif.forEach(p => { updates[`stok_${p.id}`] = getInitialStok(tokoId, p.id); });
    setForm(prev => ({ ...prev, ...updates }));
  }

  // Cascade pilihan Wilayah & Rute di dalam modal Tambah/Edit Kontrol
  function handleModalWilayahChange(wilayahId) {
    setModalFilter({ wilayahId, ruteId:"" });
    setForm(p=>({ ...p, tokoId:"" }));
  }
  function handleModalRuteChange(ruteId) {
    setModalFilter(p=>({ ...p, ruteId }));
    setForm(p=>({ ...p, tokoId:"" }));
  }

  function submit() {
    if (!form.tokoId || !form.tanggal) return alert("Toko & Tanggal wajib diisi");
    // Status kunjungan WAJIB jika tidak ada produk terjual; opsional jika ada penjualan
    if (!adaTerjual && !form.catatanStatus) return alert("Pilih status kunjungan karena tidak ada produk yang terjual");
    const d = form.tanggal;
    const [y,m] = d.split("-");
    const payload = { ...form };
    // catatanStatus tetap disimpan apa adanya (boleh ada catatan meski ada penjualan)
    // Jika user tidak pilih status apapun → biarkan kosong (= Terjual normal)
    produkAktif.forEach(p => {
      const ditarik = !!form[`ditarik_${p.id}`];
      // ✅ Kalau ditandai "Ditarik", paksa Stok Awal ke 0 apapun yang keisi di input
      // (mencegah sales lupa mengosongkan angka stok saat menandai produk ditarik)
      payload[`stok_${p.id}`] = ditarik ? 0 : Number(form[`stok_${p.id}`]||0);
      payload[`terjual_${p.id}`] = Number(form[`terjual_${p.id}`]||0);
      payload[`bonusInput_${p.id}`] = Number(form[`bonusInput_${p.id}`]||0);
      payload[`ditarik_${p.id}`] = ditarik;
    });
    if (modal==="add") {
      // ⚠️ FIX BUG: ID kontrol dulu dihitung dari nomor urut bulan ini
      // (`${y}-${m}-NNN`) berdasarkan snapshot db lokal di browser sales.
      // Karena app ini multi-user real-time (Firebase), kalau 2 sales input
      // kontrol hampir bersamaan (toko/rute berbeda sekalipun), keduanya bisa
      // menghitung nomor urut YANG SAMA → ID sama → entri kedua MENIMPA
      // entri pertama di Firebase (path kontrol/{id} sama). Akibatnya entri
      // toko pertama "hilang" (jadi Belum Dikontrol lagi) padahal stoknya
      // sudah terlanjur dikurangi oleh recalcTokoStok sebelum tertimpa.
      // Solusi: tambahkan suffix unik (timestamp + random) yang TIDAK
      // bergantung pada hitungan data lain, jadi tidak mungkin bentrok
      // walau dua sales submit di detik yang sama.
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const newEntry = { ...payload, id:`${y}-${m}-${form.tokoId}-${uniqueSuffix}` };
      addRecord("kontrol", newEntry);
      // Sinkron stok master Toko pakai daftar kontrol + entri baru (db.kontrol di closure belum update)
      recalcTokoStok(form.tokoId, [...(db.kontrol||[]), newEntry]);
      // ✅ Sinkron ceklis "Produk yang Dijual": produk baru dititip saat kunjungan
      // otomatis dicentang, produk yang stoknya diisi 0 (ditarik) otomatis dihilangkan.
      syncProdukIdsDariStokKontrol(form.tokoId, payload);
    } else {
      updateRecord("kontrol", form.id, payload);
      // Sinkron stok master Toko: ganti entri lama dengan payload terbaru sebelum dihitung ulang
      const updatedList = (db.kontrol||[]).map(k => k.id===form.id ? { ...k, ...payload } : k);
      recalcTokoStok(form.tokoId, updatedList);
      syncProdukIdsDariStokKontrol(form.tokoId, payload);
    }
    setModal(null);
  }

  // ─── NONAKTIFKAN TOKO DARI KONTROL (logika penarikan toko) ───
  // Dipanggil saat petugas menandai toko sebagai "ditarik" / Non-Aktif langsung dari menu kontrol.
  // Proses:
  // 1. Update status toko di master toko → Non-Aktif (tersinkron ke tab Toko)
  // 2. Jika ada produk terjual di entri kontrol terakhir, stok toko otomatis dikembalikan
  //    ke stok awal (dikurangi terjual = sisa stok dikembalikan ke gudang)
  // 3. Toko tidak lagi muncul di dropdown kontrol bulan berikutnya
  // 4. Stok bisa disesuaikan manual (ditambah/dikurangi) sebelum konfirmasi
  // ✅ Submit modal Tambah Toko cepat dari Kontrol — rute/wilayah otomatis dari filter aktif
  function submitTambahToko() {
    const { nama, ruteId, status, catatan } = tambahTokoForm;
    if (!nama || !ruteId) return alert("Nama & Rute wajib diisi");
    const ruteObj = (db.rute||[]).find(r=>r.id===ruteId);
    if (isSalesRestricted && ruteObj?.wilayahId !== salesWilayahId) {
      return alert("Sebagai Sales, kamu hanya boleh menambahkan toko di wilayahmu sendiri.");
    }
    const isDup = (db.toko||[]).some(t =>
      t.nama.toLowerCase().trim() === nama.toLowerCase().trim() && t.ruteId === ruteId
    );
    if (isDup) return alert(`Toko "${nama}" sudah terdaftar di rute ini.`);
    const prefix = ruteObj ? "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-" : "GW-XXX-";
    const newId = genId("T", db.toko);
    const counter = newId.replace("T","");
    const today = new Date().toISOString().slice(0,10);
    const tanggalMasuk = status === "Baru" ? today : null;
    addRecord("toko", { id:newId, nama, ruteId, status, catatan, kode:prefix+counter, tanggalMasuk });
    setTambahTokoModal(false);
    setTambahTokoForm({ nama:"", ruteId:"", status:"Aktif", catatan:"" });
    alert(`✅ Toko "${nama}" berhasil ditambahkan!`);
  }

  function openTokoStatusModal(toko) {
    // Ambil stok saat ini dari master toko sebagai nilai awal form
    const stokInit = {};
    produkAktif.forEach(p => {
      stokInit[p.id] = toko[`stok_${p.id}`] || 0;
    });
    setStokPenarikan(stokInit);
    setTokoStatusModal({ toko });
  }

  function konfirmasiNonaktifkanToko() {
    if (!tokoStatusModal) return;
    const { toko } = tokoStatusModal;
    // Update status toko → Non-Aktif di master toko, sekaligus update stok saat penarikan
    const tokoUpdates = { status: "Non-Aktif" };

    // ✅ Catat selisih stok (sebelum vs sesudah penarikan) sebagai Penyesuaian
    // Stok otomatis — sebelumnya perubahan stok di sini langsung menimpa
    // Master Toko tanpa jejak audit sama sekali, beda dengan cara lain
    // (kontrol, penyesuaian manual) yang selalu punya riwayat. Kalau produk
    // campuran (sebagian naik, sebagian turun), dipisah jadi 2 catatan biar
    // arah (Tambah/Kurang) tetap benar per kelompok produk.
    const today = new Date().toISOString().slice(0,10);
    const naik = {}, turun = {};
    let adaNaik = false, adaTurun = false;
    produkAktif.forEach(p => {
      const sebelum = Number(toko[`stok_${p.id}`]||0);
      const sesudah = Number(stokPenarikan[p.id]||0);
      const delta = sesudah - sebelum;
      tokoUpdates[`stok_${p.id}`] = sesudah;
      if (delta > 0) { naik[`jumlah_${p.id}`] = delta; adaNaik = true; }
      else if (delta < 0) { turun[`jumlah_${p.id}`] = -delta; adaTurun = true; }
    });
    updateRecord("toko", toko.id, tokoUpdates);

    const catatanOtomatis = `Otomatis tercatat dari penarikan stok saat toko "${toko.nama}" dinonaktifkan.`;
    if (adaTurun) {
      addRecord("penyesuaian", {
        id: genUniqueId("PZ"), tokoId: toko.id, tanggal: today, jenis: "Tarik",
        catatan: catatanOtomatis, dicatatOleh: "Sistem (Nonaktifkan Toko)", ...turun,
      });
    }
    if (adaNaik) {
      addRecord("penyesuaian", {
        id: genUniqueId("PZ"), tokoId: toko.id, tanggal: today, jenis: "Tambah",
        catatan: catatanOtomatis, dicatatOleh: "Sistem (Nonaktifkan Toko)", ...naik,
      });
    }

    setTokoStatusModal(null);
    setStokPenarikan({});
  }

  // ✅ BARU: Buka modal Edit Status Toko
  function openEditStatusModal(toko) {
    setEditStatusValue(toko.status || "Aktif");
    setEditStatusCatatan("");
    setEditStatusModal({ toko });
  }

  // ✅ BARU: Simpan perubahan status toko dari modal EditStatus
  function konfirmasiEditStatusToko() {
    if (!editStatusModal) return;
    const { toko } = editStatusModal;
    if (!editStatusValue) return alert("Pilih status toko terlebih dahulu.");
    const updates = { status: editStatusValue };
    // Jika diubah ke Non-Aktif via jalur ini (bukan via "Tarik Toko"),
    // stok TIDAK diubah — tetap seperti semula di master toko.
    updateRecord("toko", toko.id, updates);
    setEditStatusModal(null);
    setEditStatusValue("");
    setEditStatusCatatan("");
  }

  const ruteOpts = ruteFiltered.map(r=>({ value:r.id, label:r.nama }));
  const wilayahOpts = (db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }));

  // Opsi Rute & Toko di dalam modal Tambah/Edit Kontrol — mengikuti cascade Wilayah → Rute → Toko
  const modalRuteOpts = useMemo(() => {
    const list = modalFilter.wilayahId
      ? (db.rute||[]).filter(r=>r.wilayahId===modalFilter.wilayahId)
      : (db.rute||[]);
    return [...list].sort((a,b) => {
      const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
      const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
      const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.nama||"", b.nama||"");
    }).map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, db.wilayah, modalFilter.wilayahId]);

  const modalTokoOpts = useMemo(() => {
    // Tampilkan toko Aktif DAN Baru di dropdown kontrol (jangan tampilkan Non-Aktif)
    // Label disertai badge status supaya petugas langsung tahu statusnya tanpa buka tab Toko
    let list = (db.toko||[]).filter(t => t.status === "Aktif" || t.status === "Baru");
    if (modalFilter.ruteId) {
      list = list.filter(t=>t.ruteId===modalFilter.ruteId);
    } else if (modalFilter.wilayahId) {
      const ruteIds = (db.rute||[]).filter(r=>r.wilayahId===modalFilter.wilayahId).map(r=>r.id);
      list = list.filter(t=>ruteIds.includes(t.ruteId));
    }
    return list.map(t => {
      const statusBadge = t.status === "Baru" ? " 🆕 [BARU]" : t.status === "Aktif" ? "" : ` [${t.status}]`;
      return { value:t.id, label: `${t.nama}${statusBadge}${t.kode?` (${t.kode})` :""}` };
    });
  }, [db.toko, db.rute, modalFilter]);

  // Daftar toko untuk dropdown Penyesuaian Stok (tidak terikat filter wilayah/rute modal kontrol)
  const allTokoOpts = useMemo(() => {
    return (db.toko||[])
      .filter(t => t.status === "Aktif" || t.status === "Baru")
      .filter(t => {
        if (!isSalesRestricted) return true;
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId; // Sales cuma boleh pilih toko wilayahnya sendiri
      })
      .map(t => ({ value:t.id, label: `${t.nama}${t.kode?` (${t.kode})`:""}` }));
  }, [db.toko, db.rute, isSalesRestricted, salesWilayahId]);

  // Import Kontrol Bulanan dari Excel
  function importKontrolFromRows(rows) {
    const errors = [];
    let added = 0, skipped = 0;
    const newKontrol = [...(db.kontrol||[])];
    rows.forEach((row, i) => {
      const rowNum = i + 2; // header = baris 1
      const tokoNama = String(row["Toko*"] ?? row["Toko"] ?? "").trim();
      const tanggalRaw = row["Tanggal* (YYYY-MM-DD)"] ?? row["Tanggal"] ?? "";
      if (!tokoNama || !tanggalRaw) { errors.push(`Baris ${rowNum}: Toko & Tanggal wajib diisi`); skipped++; return; }
      const tokoObj = (db.toko||[]).find(t => t.nama.toLowerCase() === tokoNama.toLowerCase());
      if (!tokoObj) { errors.push(`Baris ${rowNum}: Toko "${tokoNama}" tidak ditemukan di Master Toko`); skipped++; return; }

      let tanggal = tanggalRaw;
      if (tanggal instanceof Date) tanggal = tanggal.toISOString().slice(0,10);
      else tanggal = String(tanggal).trim().slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) { errors.push(`Baris ${rowNum}: Format Tanggal tidak valid ("${tanggalRaw}")`); skipped++; return; }

      const payload = { tokoId: tokoObj.id, tanggal, catatanStatus:"", catatan:"" };
      let adaTerjualRow = false;
      produkAktif.forEach(p => {
        const stok = Number(row[`Stok Awal: ${p.nama}`] ?? 0) || 0;
        const terjual = Number(row[`Terjual: ${p.nama}`] ?? 0) || 0;
        const bonus = Number(row[`Bonus: ${p.nama}`] ?? p.bonus ?? 0) || 0;
        payload[`stok_${p.id}`] = stok;
        payload[`terjual_${p.id}`] = terjual;
        payload[`bonusInput_${p.id}`] = bonus;
        if (terjual > 0) adaTerjualRow = true;
      });

      const statusLabel = String(row["Status Kunjungan"] ?? "").trim();
      if (statusLabel) {
        // Ada status → validasi dan simpan (berlaku baik saat terjual maupun tidak)
        const found = Object.entries(CATATAN_STATUS).find(([,cs]) => cs.label.toLowerCase()===statusLabel.toLowerCase());
        if (!found) { errors.push(`Baris ${rowNum}: Status Kunjungan "${statusLabel}" tidak dikenali`); skipped++; return; }
        payload.catatanStatus = found[0];
        if (payload.catatanStatus === "manual") payload.catatan = String(row["Catatan"] ?? "").trim();
      } else if (!adaTerjualRow) {
        // Tidak ada status DAN tidak ada penjualan → wajib ada status
        errors.push(`Baris ${rowNum}: Status Kunjungan wajib diisi jika tidak ada produk yang terjual`); skipped++; return;
      } else {
        // Ada penjualan, status kosong → oke, Terjual normal (catatanStatus = "")
        payload.catatanStatus = "";
      }

      const [y,m] = tanggal.split("-");
      // ID unik (lihat catatan fix di submit()) — hindari tabrakan dengan data lain
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + rowNum;
      newKontrol.push({ ...payload, id:`${y}-${m}-${payload.tokoId}-${uniqueSuffix}` });
      added++;
    });
    if (added > 0) {
      // Sinkron stok master Toko untuk setiap toko yang terdampak import, berdasarkan entri terakhir
      const affectedTokoIds = [...new Set(newKontrol.map(k=>k.tokoId))];
      const newToko = (db.toko||[]).map(t => {
        if (!affectedTokoIds.includes(t.id)) return t;
        const entriesToko = newKontrol.filter(k=>k.tokoId===t.id)
          .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
        const terakhir = entriesToko[entriesToko.length-1];
        if (!terakhir) return t;
        const updated = { ...t };
        produkAktif.forEach(p => {
          // "Stok Awal" dibawa apa adanya (lihat catatan di recalcTokoStok) —
          // sudah mencerminkan hasil restock etalase saat kunjungan itu.
          updated[`stok_${p.id}`] = Number(terakhir[`stok_${p.id}`]||0);
        });
        return updated;
      });
      save({ ...db, kontrol:newKontrol, toko:newToko });
    }
    return { added, skipped, errors };
  }

  const selToko = (db.toko||[]).find(t=>t.id===form.tokoId);
  const totalRevData = data.reduce((s,k)=>s+k.totalRev,0);
  const totalBonusData = data.reduce((s,k)=>s+k.totalBonus,0);
  const catatanSt = form.catatanStatus||"";

  const cols = [
    { key:"id",           label:"ID",         render:v=><code style={{ fontSize:10 }}>{v}</code> },
    { key:"tokoNama",     label:"Toko",       render:(v,row)=>{
      const tkObj = (db.toko||[]).find(t=>t.id===row.tokoId);
      const stMap = { "Aktif": { icon:"✅", color:T.green }, "Baru": { icon:"🆕", color:T.blue }, "Non-Aktif": { icon:"🔴", color:T.red } };
      const st = tkObj ? (stMap[tkObj.status]||stMap["Aktif"]) : null;
      return (
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>
          {st && tkObj && (
            <span
              title={`Status toko: ${tkObj.status} — klik untuk edit`}
              onClick={e=>{ e.stopPropagation(); openEditStatusModal(tkObj); }}
              style={{ cursor:"pointer", fontSize:10, background:st.color+"22", color:st.color,
                border:`1px solid ${st.color}44`, borderRadius:99, padding:"1px 7px", fontWeight:700, lineHeight:1.6,
                userSelect:"none", flexShrink:0 }}
            >{st.icon} {tkObj.status}</span>
          )}
        </div>
      );
    }},
    { key:"wilayahNama",  label:"Wilayah",    render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"ruteNama",     label:"Rute",       render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"tanggal",      label:"Tanggal" },
    ...produkAktif.flatMap(p=>[
      { key:`stok_${p.id}`,        label:`Stok ${p.id}` },
      { key:`terjual_${p.id}`,     label:`Jual ${p.id}` },
      { key:`bonusInput_${p.id}`,  label:`Bonus ${p.id} (pcs)`, render:(v,row)=><span style={{ color:T.gold }}>{(v||0)} pcs</span> },
    ]),
    { key:"totalRev",    label:"Revenue",    render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",  label:"Ttl Bonus",  render:v=><b style={{ color:T.gold }}>{fmt(v)} pcs</b> },
    { key:"catatanStatus",label:"Status",    render:(v,row)=>{ if(!v) return <Badge color={T.green}>✅ Terjual</Badge>; const s=CATATAN_STATUS[v]||CATATAN_STATUS.manual; return <span title={row.catatan||""} style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Badge color={s.color} bg={s.bg}>{s.label}</Badge>{row.catatan && <span style={{ fontSize:10, color:s.color, opacity:.7 }}>📝</span>}</span>; } },
    { key:"catatan",     label:"Catatan" },
  ];

  return (
    <div>
      {/* Ringkasan Penyesuaian Stok yang menunggu persetujuan (Admin/Manajer
          saja) — supaya tidak perlu buka toko satu-satu untuk ketahuan ada
          pengajuan dari Sales yang butuh ditinjau. Auto-approve 24 jam sudah
          jalan sendiri, ini cuma buat yang mau ditinjau/ditolak lebih awal. */}
      {!isSalesRestricted && (() => {
        const pending = (db.penyesuaian||[]).filter(pz=>pz.status==="menunggu");
        if (pending.length === 0) return null;
        return (
          <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:10,
            padding:"10px 16px", marginBottom:14, fontSize:13, color:"#92400E" }}>
            ⏳ Ada <b>{pending.length} pengajuan Penyesuaian Stok</b> dari Sales yang menunggu persetujuan
            (otomatis disetujui dalam 24 jam kalau tidak ditinjau). Buka detail toko terkait di bawah untuk
            menyetujui/menolak lebih awal.
          </div>
        );
      })()}
      {/* Fix: ConfirmDelete global untuk view monthly & tabel */}
      {deleteTarget && (
        <ConfirmDelete
          label="Data kontrol ini akan dihapus permanen."
          onConfirm={() => {
            const tokoIdTerdampak = (db.kontrol||[]).find(k=>k.id===deleteTarget)?.tokoId;
            deleteRecord("kontrol", deleteTarget);
            if (tokoIdTerdampak) {
              const remaining = (db.kontrol||[]).filter(k => k.id !== deleteTarget);
              recalcTokoStok(tokoIdTerdampak, remaining);
            }
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Modal Konfirmasi Penarikan / Non-Aktifkan Toko dari Kontrol */}
      {tokoStatusModal && (
        <Modal title="🏪 Tarik / Non-Aktifkan Toko" onClose={() => { setTokoStatusModal(null); setStokPenarikan({}); }} width={520}>
          <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#DC2626", marginBottom:4 }}>⚠️ Toko akan ditarik / dinonaktifkan</div>
            <div style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>
              Toko <b>{tokoStatusModal.toko.nama}</b> akan diubah statusnya menjadi <b>Non-Aktif</b>.<br/>
              Toko ini <b>tidak akan muncul</b> di dropdown kontrol bulan berikutnya.<br/>
              Untuk mengaktifkan kembali, buka tab <b>Toko</b> dan edit status toko tersebut.
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#1F2937", marginBottom:6 }}>📦 Stok Produk Saat Penarikan</div>
            <div style={{ fontSize:12, color:"#6B7280", marginBottom:10, lineHeight:1.5 }}>
              Isi stok produk yang dikembalikan ke gudang saat toko ini ditarik. Stok ini akan disimpan ke master toko sebagai referensi.<br/>
              <span style={{ color:"#D97706", fontWeight:600 }}>Isi 0 jika semua stok sudah habis terjual atau tidak ada yang dikembalikan.</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
              {produkAktif.map(p => (
                <div key={p.id} style={{ background:"#F9FAFB", border:"1.5px solid #E5E7EB", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1F2937", marginBottom:8 }}>{p.nama}</div>
                  <div style={{ fontSize:11, color:"#9CA3AF", marginBottom:4 }}>Stok dikembalikan (pcs)</div>
                  <input
                    type="number" min={0}
                    value={stokPenarikan[p.id] || 0}
                    onChange={e => setStokPenarikan(prev => ({ ...prev, [p.id]: e.target.value }))}
                    style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #E5E7EB",
                      borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12 }}>
            ℹ️ Data kontrol yang sudah ada untuk toko ini <b>tidak akan dihapus</b> — hanya status toko yang diubah menjadi Non-Aktif dan stok diperbarui.
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={() => { setTokoStatusModal(null); setStokPenarikan({}); }}>Batal</Btn>
            <Btn variant="danger" onClick={konfirmasiNonaktifkanToko}>🔴 Nonaktifkan Toko & Perbarui Stok</Btn>
          </div>
        </Modal>
      )}

      {/* ✅ BARU: Modal Edit Status Toko — terintegrasi dengan master toko */}
      {editStatusModal && (() => {
        const { toko } = editStatusModal;
        const STATUS_OPTS = [
          { value: "Aktif",     label: "Aktif",      icon: "✅", desc: "Toko aktif & muncul di dropdown kontrol.", color: T.green,  bg: T.greenLt,  border: T.green+"44" },
          { value: "Baru",      label: "Baru",       icon: "🆕", desc: "Toko baru, akan muncul di kontrol & ditandai BARU.", color: T.blue,   bg: T.blueLt,   border: "#93C5FD" },
          { value: "Non-Aktif", label: "Non-Aktif",  icon: "🔴", desc: "Toko tidak aktif, tersembunyi dari dropdown kontrol.", color: T.red,    bg: T.redLt,    border: "#FCA5A5" },
        ];
        const currentOpt = STATUS_OPTS.find(o => o.value === toko.status) || STATUS_OPTS[0];
        const selectedOpt = STATUS_OPTS.find(o => o.value === editStatusValue) || null;
        const changed = editStatusValue && editStatusValue !== toko.status;
        return (
          <Modal title="🏷️ Edit Status Toko" onClose={() => { setEditStatusModal(null); setEditStatusValue(""); setEditStatusCatatan(""); }} width={480}>
            {/* Info toko */}
            <div style={{ background: T.gray50, border: `1px solid ${T.gray200}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 28 }}>🏪</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: T.gray800 }}>{toko.nama}</div>
                <div style={{ fontSize: 12, color: T.gray400 }}>
                  {toko.kode && <span style={{ marginRight: 8 }}>Kode: <b>{toko.kode}</b></span>}
                  Status saat ini:{" "}
                  <span style={{ fontWeight: 700, color: currentOpt.color, background: currentOpt.bg, borderRadius: 99, padding: "1px 8px", fontSize: 11 }}>
                    {currentOpt.icon} {toko.status || "Aktif"}
                  </span>
                </div>
              </div>
            </div>

            {/* Pilihan status */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 10 }}>Ubah status toko menjadi:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {STATUS_OPTS.map(opt => {
                  const isSelected = editStatusValue === opt.value;
                  const isCurrent = toko.status === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setEditStatusValue(opt.value)}
                      style={{
                        cursor: "pointer",
                        border: `2px solid ${isSelected ? opt.color : T.gray200}`,
                        borderRadius: 10,
                        padding: "12px 16px",
                        background: isSelected ? opt.bg : T.white,
                        display: "flex", alignItems: "center", gap: 12,
                        transition: "all .15s",
                        opacity: isCurrent && !isSelected ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: 22 }}>{opt.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: isSelected ? opt.color : T.gray800 }}>
                          {opt.label}
                          {isCurrent && (
                            <span style={{ marginLeft: 8, fontSize: 10, background: T.gray200, color: T.gray600, borderRadius: 99, padding: "1px 7px" }}>
                              Status saat ini
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: T.gray500, marginTop: 2 }}>{opt.desc}</div>
                      </div>
                      <div style={{
                        width: 20, height: 20, borderRadius: "50%",
                        border: `2px solid ${isSelected ? opt.color : T.gray300}`,
                        background: isSelected ? opt.color : "transparent",
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Peringatan khusus jika pilih Non-Aktif lewat jalur ini */}
            {editStatusValue === "Non-Aktif" && toko.status !== "Non-Aktif" && (
              <div style={{ background: T.orangeLt, border: `1px solid ${T.orange}55`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
                ⚠️ <b>Catatan:</b> Mengubah status ke <b>Non-Aktif</b> via menu ini <b>tidak akan mengubah stok toko</b>.<br/>
                Jika ingin mencatat pengembalian stok, gunakan tombol <b>🔴 Tarik Toko</b> di view per Rute.
              </div>
            )}

            {/* Pesan info jika status tidak berubah */}
            {!changed && editStatusValue && (
              <div style={{ background: T.blueLt, border: `1px solid #BFDBFE`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: T.blue }}>
                ℹ️ Status toko sudah <b>{editStatusValue}</b>. Tidak ada perubahan yang akan disimpan.
              </div>
            )}

            {/* Tombol aksi */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <Btn variant="secondary" onClick={() => { setEditStatusModal(null); setEditStatusValue(""); setEditStatusCatatan(""); }}>Batal</Btn>
              <Btn
                onClick={konfirmasiEditStatusToko}
                disabled={!editStatusValue || !changed}
                style={{ opacity: (!editStatusValue || !changed) ? 0.5 : 1, cursor: (!editStatusValue || !changed) ? "not-allowed" : "pointer" }}
              >
                {selectedOpt ? `${selectedOpt.icon} Simpan — Ubah ke ${selectedOpt.label}` : "Simpan Perubahan"}
              </Btn>
            </div>
          </Modal>
        );
      })()}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📋 Kontrol Bulanan</div>
          <div style={{ fontSize:12, color:T.gray400 }}>
            {data.length} entri · Rev: <b style={{ color:T.green }}>{fmtRp(totalRevData)}</b>
            {" "}· Bonus: <b style={{ color:T.gold }}>{fmt(totalBonusData)} pcs</b>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ImportMenu label="Import Kontrol" onTemplate={()=>downloadKontrolTemplate(db)} onParseRows={importKontrolFromRows} />
          <Btn variant="secondary" icon="🔄" onClick={recalcAllTokoStok}
            title="Hitung ulang stok Master Toko untuk semua toko yang pernah dikontrol, pakai data kontrol & penyesuaian yang sudah ada">
            Hitung Ulang Semua Stok
          </Btn>
          {(() => {
            // ── Kolom ekspor kontrol (tanpa React render, gunakan nilai plain) ──
            const kontrolExportCols = [
              { key:"id",           label:"ID" },
              { key:"tokoNama",     label:"Toko" },
              { key:"wilayahNama",  label:"Wilayah" },
              { key:"ruteNama",     label:"Rute" },
              { key:"tanggal",      label:"Tanggal" },
              ...produkAktif.flatMap(p=>[
                { key:`stok_${p.id}`,       label:`Stok ${p.nama||p.id}` },
                { key:`terjual_${p.id}`,    label:`Jual ${p.nama||p.id}` },
                { key:`bonusInput_${p.id}`, label:`Bonus ${p.nama||p.id} (pcs)` },
              ]),
              { key:"totalRevFmt",  label:"Revenue (Rp)" },
              { key:"totalBonus",   label:"Total Bonus (pcs)" },
              { key:"statusLabel",  label:"Status" },
              { key:"catatan",      label:"Catatan" },
            ];
            const kontrolExportData = [
              ...data.map(row=>({
                ...row,
                totalRevFmt: fmtRp(row.totalRev||0),
                statusLabel: row.catatanStatus
                  ? (CATATAN_STATUS[row.catatanStatus]?.label || row.catatanStatus)
                  : "Terjual",
              })),
              // Baris kosong pemisah
              { id:"", tokoNama:"", wilayahNama:"", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
              // Baris total
              { id:"TOTAL", tokoNama:"═══ TOTAL KESELURUHAN ═══",
                wilayahNama:"", ruteNama:"", tanggal:"",
                totalRevFmt: fmtRp(totalRevData),
                totalBonus: totalBonusData,
                statusLabel:`${data.length} entri`, catatan:"" },
              // Baris kosong
              { id:"", tokoNama:"", wilayahNama:"", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
              // Ringkasan
              { id:"", tokoNama:"📊 RINGKASAN",        wilayahNama:"",                          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Entri Kontrol",  wilayahNama:String(data.length),          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Revenue",         wilayahNama:fmtRp(totalRevData),          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Bonus (pcs)",     wilayahNama:String(totalBonusData),       ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Revenue Rata-rata",     wilayahNama:data.length ? fmtRp(Math.round(totalRevData/data.length)) : "Rp 0", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
            ];
            return (
              <ExportMenu
                data={data} columns={cols}
                exportData={kontrolExportData} exportCols={kontrolExportCols}
                title="Kontrol Bulanan" filename={`kontrol_${filter.bulan||"semua"}`}
              />
            );
          })()}
          <Btn variant="secondary" size="sm" icon="📅"
            onClick={()=>setViewMode(v=>v==="table"?"monthly":"table")}>
            {viewMode==="table"?"🗺️ View per Rute":"📋 View Tabel"}
          </Btn>
          <Btn variant="secondary" onClick={()=>{
            // Pre-fill rute dari filter aktif jika ada
            setTambahTokoForm({ nama:"", ruteId:filter.ruteId||"", status:"Aktif", catatan:"" });
            setTambahTokoModal(true);
          }} icon="🏪">Tambah Toko</Btn>
          <Btn variant="secondary" onClick={()=>openPenyesuaian("")} icon="🔧">Penyesuaian Stok</Btn>
          <Btn variant="secondary" onClick={openLuarRute} icon="🛣️">Penjualan Luar Rute</Btn>
          <Btn onClick={openAdd} icon="＋">Tambah Kontrol</Btn>
        </div>
      </div>

      {/* Modal Tambah Toko Cepat */}
      {tambahTokoModal && (() => {
        const ruteOptsForToko = [...(db.rute||[])]
          .filter(r => !isSalesRestricted || r.wilayahId===salesWilayahId) // Sales cuma boleh pilih rute wilayahnya sendiri
          .sort((a,b) => {
          const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
          const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
          const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
          if (wCompare !== 0) return wCompare;
          return naturalCompare(a.nama||"", b.nama||"");
        }).map(r => {
          const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
          return { value:r.id, label:`${r.nama} (${w?.nama||"?"})` };
        });
        return (
          <Modal title="🏪 Tambah Toko Baru" onClose={()=>setTambahTokoModal(false)} width={480}>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:16, background:T.blueLt,
              border:`1px solid #BFDBFE`, borderRadius:8, padding:"8px 12px" }}>
              💡 Toko baru langsung bisa dipilih di input Kontrol tanpa menutup halaman ini.
              Jika status <b>Baru</b>, sistem otomatis mencatat tanggal masuk dan akan upgrade ke <b>Aktif</b> setelah 30 hari.
            </div>
            <Input label="Nama Toko" value={tambahTokoForm.nama}
              onChange={v=>ttf("nama",v)} required placeholder="cth: Toko Barokah" />
            <SearchableSelect label="Rute" value={tambahTokoForm.ruteId}
              onChange={v=>ttf("ruteId",v)} options={ruteOptsForToko} required
              placeholder="Cari rute / wilayah..." />
            <Input label="Status Awal" value={tambahTokoForm.status}
              onChange={v=>ttf("status",v)}
              options={[{value:"Aktif",label:"Aktif"},{value:"Baru",label:"Baru (trial)"},{value:"Non-Aktif",label:"Non-Aktif"}]} />
            <Input label="Catatan" value={tambahTokoForm.catatan||""} onChange={v=>ttf("catatan",v)}
              type="textarea" placeholder="Opsional" />
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
              <Btn variant="secondary" onClick={()=>setTambahTokoModal(false)}>Batal</Btn>
              <Btn onClick={submitTambahToko}>✅ Simpan Toko</Btn>
            </div>
          </Modal>
        );
      })()}

      {/* Modal Penyesuaian Stok (kejadian lapangan di luar siklus kontrol rutin) */}
      {penyesuaianModal && penyesuaianForm && (
        <Modal title="🔧 Penyesuaian Stok Lapangan" onClose={()=>{ setPenyesuaianModal(false); setPenyesuaianForm(null); }} width={560}>
          <div style={{ fontSize:12, color:T.gray600, marginBottom:14, background:T.blueLt,
            border:`1px solid #BFDBFE`, borderRadius:8, padding:"8px 12px" }}>
            💡 Gunakan untuk mencatat kejadian di toko <b>di luar kunjungan kontrol rutin</b> — misal laporan sales
            ada tambahan stok, stok berkurang (rusak/hilang), atau sebagian produk ditarik. Stok di Master Toko
            akan otomatis diperbarui.
          </div>
          <SearchableSelect label="Toko" value={penyesuaianForm.tokoId}
            onChange={v=>pf("tokoId",v)} options={allTokoOpts} required placeholder="Cari toko..." />
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Tanggal" value={penyesuaianForm.tanggal} onChange={v=>pf("tanggal",v)} type="date" required />
            <Input label="Jenis Penyesuaian" value={penyesuaianForm.jenis} onChange={v=>pf("jenis",v)}
              options={[{value:"Tambah",label:"➕ Tambah Stok"},{value:"Kurang",label:"➖ Kurang Stok"},{value:"Tarik",label:"🔻 Tarik Sebagian Produk"}]} />
          </div>
          <div style={{ marginTop:10, marginBottom:6, fontSize:12, fontWeight:600, color:T.gray600 }}>Jumlah per Produk:</div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            {(() => {
              const tokoTerpilih = (db.toko||[]).find(t=>t.id===penyesuaianForm.tokoId);
              const produkIdsToko = tokoTerpilih?.produkIds||[];
              return produkAktif.map(p=>{
                const belumDijual = penyesuaianForm.tokoId && !produkIdsToko.includes(p.id);
                return (
                  <Input key={p.id}
                    label={<>{p.nama}{belumDijual && penyesuaianForm.jenis==="Tambah" && (
                      <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:T.blue,
                        background:T.blueLt, border:`1px solid #BFDBFE`, borderRadius:99, padding:"1px 6px" }}>
                        🆕 produk baru untuk toko ini
                      </span>
                    )}</>}
                    value={penyesuaianForm[`jumlah_${p.id}`]||0}
                    onChange={v=>pf(`jumlah_${p.id}`,v)} type="number" />
                );
              });
            })()}
          </div>
          {(() => {
            const tokoTerpilih = (db.toko||[]).find(t=>t.id===penyesuaianForm.tokoId);
            const produkIdsToko = tokoTerpilih?.produkIds||[];
            const adaProdukBaru = penyesuaianForm.jenis==="Tambah" && produkAktif.some(p =>
              Number(penyesuaianForm[`jumlah_${p.id}`]||0) > 0 && penyesuaianForm.tokoId && !produkIdsToko.includes(p.id));
            return adaProdukBaru ? (
              <div style={{ fontSize:11, color:T.blue, background:T.blueLt, border:`1px solid #BFDBFE`,
                borderRadius:8, padding:"6px 10px", marginBottom:10 }}>
                ℹ️ Produk bertanda 🆕 akan otomatis ditambahkan ke daftar "Produk yang Dijual" toko ini saat disimpan.
              </div>
            ) : null;
          })()}
          <Input label="Dicatat Oleh (admin/sales)" value={penyesuaianForm.dicatatOleh||""} onChange={v=>pf("dicatatOleh",v)} placeholder="Nama pencatat" />
          <Input label="Catatan / Alasan" value={penyesuaianForm.catatan||""} onChange={v=>pf("catatan",v)}
            type="textarea" placeholder="cth: Laporan sales — 2 botol rusak saat kunjungan" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>{ setPenyesuaianModal(false); setPenyesuaianForm(null); }}>Batal</Btn>
            <Btn onClick={submitPenyesuaian}>✅ Simpan Penyesuaian</Btn>
          </div>
        </Modal>
      )}

      {/* Modal Penjualan Luar Rute (toko/rute tidak diketahui sales) */}
      {luarRuteModal && luarRuteForm && (
        <Modal title="🛣️ Penjualan Luar Rute" onClose={()=>{ setLuarRuteModal(false); setLuarRuteForm(null); }} width={560}>
          <div style={{ fontSize:12, color:T.gray600, marginBottom:14, background:T.goldLt||"#FEF9E7",
            border:`1px solid ${T.gold}55`, borderRadius:8, padding:"8px 12px" }}>
            💡 Gunakan ini jika sales <b>menjual produk di luar rute kontrol saat itu</b> (rute lain pada waktu yang sama,
            atau penjualan perorangan) dan <b>tidak tahu/lupa nama toko & rutenya</b>. Penjualan tetap tercatat &
            masuk laporan pendapatan, tanpa terikat ke toko manapun — namun tetap <b>dikaitkan ke wilayah</b>
            supaya ikut terhitung di Rekap Siklus wilayah tsb saat siklus kontrolnya selesai.
            Jika sales <b>tahu nama toko & rutenya</b>, gunakan tombol <b>＋ Tambah Kontrol</b> seperti biasa.
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Wilayah" value={luarRuteForm.wilayahId||""} onChange={v=>lf("wilayahId",v)}
              options={wilayahOpts} required placeholder="Pilih wilayah..." disabled={isSalesRestricted}
              hint={isSalesRestricted ? "Terkunci ke wilayah tugasmu" : "Wilayah tugas sales — penjualan ini akan ikut masuk ke Rekap Siklus wilayah ini"} />
            <Input label="Tanggal" value={luarRuteForm.tanggal} onChange={v=>lf("tanggal",v)} type="date" required />
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Dicatat Oleh (sales)" value={luarRuteForm.dicatatOleh||""} onChange={v=>lf("dicatatOleh",v)} placeholder="Nama sales" />
          </div>
          <Input label="Keterangan (opsional)" value={luarRuteForm.keterangan||""} onChange={v=>lf("keterangan",v)}
            type="textarea" placeholder="cth: dijual di rute 2 saat kontrol rute 1 / penjualan perorangan ke kenalan" />
          <div style={{ marginTop:10, marginBottom:6, fontSize:12, fontWeight:600, color:T.gray600 }}>Jumlah Terjual & Bonus per Produk:</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10, marginBottom:10 }}>
            {produkAktif.map(p => {
              const terjual = Number(luarRuteForm[`terjual_${p.id}`]||0);
              return (
                <div key={p.id} style={{ background:terjual>0?T.greenLt:T.gray50, borderRadius:10,
                  padding:"12px", border:`1.5px solid ${terjual>0?T.green+"44":T.gray200}`, transition:"all .2s" }}>
                  <div style={{ fontSize:12, fontWeight:800, color:T.gray800, marginBottom:10 }}>{p.nama}</div>
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Terjual</div>
                    <input type="number" value={luarRuteForm[`terjual_${p.id}`]||0}
                      onChange={e=>lf(`terjual_${p.id}`,e.target.value)} min={0}
                      style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${terjual>0?T.green:T.gray200}`,
                        borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:T.gold, marginBottom:3 }}>🎁 Bonus Produk (pcs)</div>
                    <input type="number" value={luarRuteForm[`bonusInput_${p.id}`]||0}
                      onChange={e=>lf(`bonusInput_${p.id}`,e.target.value)} min={0}
                      style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`,
                        borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                </div>
              );
            })}
          </div>
          {(() => {
            let estRev = 0;
            produkAktif.forEach(p => { estRev += Number(luarRuteForm[`terjual_${p.id}`]||0) * (p.harga||0); });
            return estRev > 0 ? (
              <div style={{ fontSize:12, color:T.green, background:T.greenLt, border:`1px solid ${T.green}33`,
                borderRadius:8, padding:"8px 12px", marginBottom:10 }}>
                💰 Estimasi pendapatan: <b>{fmtRp(estRev)}</b>
              </div>
            ) : null;
          })()}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>{ setLuarRuteModal(false); setLuarRuteForm(null); }}>Batal</Btn>
            <Btn onClick={submitLuarRute}>✅ Simpan Penjualan</Btn>
          </div>
        </Modal>
      )}

      {/* Filter: Wilayah → Rute → Bulan */}
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
          padding:"8px 14px", marginBottom:12, fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8 }}>
          🔒 Anda hanya dapat melihat data wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
        </div>
      )}
      <FilterBar filters={[
        { key:"q",         label:"Cari Toko",value:filter.q,         placeholder:"Nama atau kode toko..." },
        { key:"bulan",     label:"Bulan",    value:filter.bulan,     type:"month", placeholder:"2026-06" },
        ...(!isSalesRestricted ? [{ key:"wilayahId", label:"Wilayah",  value:filter.wilayahId, options:wilayahOpts }] : []),
        { key:"ruteId",    label:"Rute",     value:filter.ruteId,    options:ruteOpts },
      ]} onChange={(k,v)=>{
        if (k==="wilayahId") setFilter(p=>({...p, wilayahId:v, ruteId:""}));
        else setFilter(p=>({...p,[k]:v}));
      }} onReset={()=>setFilter({wilayahId: salesWilayahId||"", ruteId:"", bulan:"", q:"",
        cekTanggal: new Date().toISOString().slice(0,10), hanyaBelumHariIni:false})} />

      {/* Summary per Produk */}
      {produkAktif.length > 0 && data.length > 0 && (
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 }}>
          {produkAktif.map(p => {
            const totalTerjual = data.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0);
            const bonusTotal = data.reduce((s,k)=>s+(k[`bonusInput_${p.id}`]!==undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0)),0);
            return (
              <div key={p.id} style={{ background:T.goldLt, border:`1px solid ${T.gold}33`,
                borderRadius:10, padding:"10px 16px", flex:1, minWidth:130 }}>
                <div style={{ fontSize:11, fontWeight:700, color:T.gold, marginBottom:2 }}>{p.nama}</div>
                <div style={{ fontSize:16, fontWeight:800, color:T.gray800 }}>{fmt(totalTerjual)} pcs terjual</div>
                <div style={{ fontSize:12, color:T.orange }}>Bonus: {fmt(bonusTotal)} pcs</div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode==="monthly" ? (
        // View per Rute: tampilkan SEMUA toko di rute, baik yang sudah dikontrol maupun belum
        <div>
          {/* ✅ Filter: cari toko yang belum diinput kontrol pada tanggal tertentu */}
          <div style={{ background:T.orangeLt, border:`1px solid ${T.orange}55`, borderRadius:10,
            padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:13, fontWeight:700, color:T.orange }}>🔎 Cek tanggal:</span>
              <input type="date" value={filter.cekTanggal}
                onChange={e=>setFilter(p=>({...p, cekTanggal:e.target.value}))}
                style={{ border:`1px solid ${T.orange}55`, borderRadius:8, padding:"5px 8px", fontSize:13 }} />
            </div>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:T.gray700, cursor:"pointer" }}>
              <input type="checkbox" checked={!!filter.hanyaBelumHariIni}
                onChange={e=>setFilter(p=>({...p, hanyaBelumHariIni:e.target.checked}))} />
              Hanya tampilkan toko yang <b>belum dikontrol</b> pada tanggal ini
            </label>
          </div>
          {(!filter.wilayahId && !filter.ruteId) && (
            <div style={{ background:T.blueLt, border:`1px solid ${T.blue}33`, borderRadius:10,
              padding:"10px 16px", marginBottom:14, fontSize:13, color:T.blue }}>
              📋 Menampilkan <b>semua toko</b> dari semua rute. Gunakan filter <b>Wilayah</b> atau <b>Rute</b> untuk mempersempit tampilan.
            </div>
          )}
          {tokoPerRute.length === 0 ? (
            <Card><div style={{ textAlign:"center", color:T.gray400, padding:24 }}>
              {filter.hanyaBelumHariIni
                ? "🎉 Semua toko sudah dikontrol pada tanggal ini."
                : "Belum ada toko aktif. Tambahkan toko terlebih dahulu di tab Toko."}
            </div></Card>
          ) : tokoPerRute.map(({ rute, wilayah, tokoList }) => (
            <Card key={rute.id} style={{ marginBottom:16 }}>
              {/* Header Rute */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${T.gray200}` }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🛣️ {rute.nama}</div>
                  <div style={{ fontSize:12, color:T.gray400 }}>{wilayah?.nama||"—"} · {tokoList.length} toko</div>
                </div>
                <div style={{ display:"flex", gap:10, fontSize:12 }}>
                  <span style={{ color:T.green, fontWeight:700 }}>
                    Rev: {fmtRp(tokoList.reduce((s,{entries})=>s+entries.reduce((ss,e)=>ss+e.totalRev,0),0))}
                  </span>
                  <span style={{ color:T.gold, fontWeight:700 }}>
                    Bonus: {fmt(tokoList.reduce((s,{entries})=>s+entries.reduce((ss,e)=>ss+(e.totalBonus||0),0),0))} pcs
                  </span>
                </div>
              </div>

              {/* Toko-toko dalam rute */}
              {tokoList.map(({ toko, entries, sudahDikontrolHariIni }) => {
                const sudahDikontrol = entries.length > 0;
                const lastEntry = entries[entries.length-1];
                return (
                  <div key={toko.id} style={{ marginBottom:12, border:`1px solid ${sudahDikontrol?T.green+"33":T.gray200}`,
                    borderRadius:10, overflow:"hidden" }}>
                    {/* Header Toko */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"10px 14px", background:sudahDikontrol?T.greenLt:T.gray50, flexWrap:"wrap", gap:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:18 }}>{sudahDikontrol?"✅":"⏳"}</span>
                        <div>
                          <div style={{ fontWeight:700, fontSize:14, color:T.gray800, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            {toko.nama}
                            {toko.status === "Baru" && (
                              <span style={{ background:T.blue, color:"#fff", fontSize:10, fontWeight:700,
                                borderRadius:99, padding:"1px 8px", letterSpacing:"0.03em" }}>🆕 BARU</span>
                            )}
                          </div>
                          <div style={{ fontSize:11, color:T.gray400 }}>{toko.kode}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        {sudahDikontrolHariIni
                          ? <Badge color={T.green} bg={T.greenLt}>✅ Sudah ({filter.cekTanggal})</Badge>
                          : <Badge color={T.red} bg={T.redLt}>⚠️ Belum ({filter.cekTanggal})</Badge>}
                        {sudahDikontrol
                          ? <Badge color={T.green}>{entries.length}x kontrol</Badge>
                          : <Badge color={T.orange} bg={T.orangeLt}>Belum dikontrol</Badge>}
                        <Btn size="sm" icon="＋" onClick={()=>{
                          const today = new Date().toISOString().slice(0,10);
                          const initial = { tokoId:toko.id, tanggal:today, catatanStatus:"", catatan:"" };
                          produkAktif.forEach(p => {
                            initial[`stok_${p.id}`] = toko[`stok_${p.id}`]||0;
                            initial[`terjual_${p.id}`] = 0;
                            initial[`bonusInput_${p.id}`] = p.bonus||0;
                          });
                          setForm(initial);
                          setModalFilter({ wilayahId: wilayah?.id||"", ruteId: rute.id });
                          setModal("add");
                        }}>Tambah</Btn>
                        <Btn size="sm" variant="secondary" icon="🔧" onClick={() => openPenyesuaian(toko.id)}>
                          Penyesuaian
                        </Btn>
                        <Btn size="sm" variant="secondary" icon="🏷️" onClick={() => openEditStatusModal(toko)}>
                          Status
                        </Btn>
                        {toko.status !== "Non-Aktif" && (
                          <Btn size="sm" variant="danger" icon="🔴" onClick={() => openTokoStatusModal(toko)}>
                            Tarik Toko
                          </Btn>
                        )}
                      </div>
                    </div>

                    {/* Data kontrol toko */}
                    {entries.length > 0 && (
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead>
                            <tr style={{ background:T.gray50, borderTop:`1px solid ${T.gray200}` }}>
                              <th style={{ padding:"6px 10px", textAlign:"left", color:T.gray600, fontWeight:700 }}>Tanggal</th>
                              {produkAktif.map(p=>(
                                <th key={p.id} style={{ padding:"6px 10px", textAlign:"center", color:T.gray600, fontWeight:700 }}>
                                  {p.nama}
                                </th>
                              ))}
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Revenue</th>
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Bonus (pcs)</th>
                              <th style={{ padding:"6px 10px", textAlign:"center", color:T.gray600, fontWeight:700 }}>Status</th>
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(e => {
                              const cs = e.catatanStatus ? (CATATAN_STATUS[e.catatanStatus]||CATATAN_STATUS.manual) : null;
                              return (
                                <tr key={e.id} style={{ background:cs?cs.bg:T.white, borderTop:`1px solid ${T.gray100}` }}>
                                  <td style={{ padding:"6px 10px", fontWeight:600 }}>{e.tanggal}</td>
                                  {produkAktif.map(p=>(
                                    <td key={p.id} style={{ padding:"6px 10px", textAlign:"center" }}>
                                      <div style={{ color:T.gray600 }}>📦 {e[`stok_${p.id}`]||0}</div>
                                      <div style={{ color:T.green, fontWeight:700 }}>✓ {e[`terjual_${p.id}`]||0}</div>
                                    </td>
                                  ))}
                                  <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:T.green }}>{fmtRp(e.totalRev)}</td>
                                  <td style={{ padding:"6px 10px", textAlign:"right", color:T.gold }}>{fmt(e.totalBonus)} pcs</td>
                                  <td style={{ padding:"6px 10px", textAlign:"center" }}>
                                    <div>
                                      {cs
                                        ? <Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge>
                                        : <Badge color={T.green}>✅ Terjual</Badge>}
                                      {e.catatan && (
                                        <div style={{ fontSize:10, color:T.gray400, marginTop:2,
                                          maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                                          title={e.catatan}>
                                          📝 {e.catatan}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ padding:"6px 10px", textAlign:"right" }}>
                                    <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}>
                                      <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>openEdit(e)}>Edit</Btn>
                                      <Btn variant="danger" size="sm" icon="🗑" onClick={()=>setDeleteTarget(e.id)}>Hapus</Btn>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Riwayat Penyesuaian Stok toko ini */}
                    {(() => {
                      const pzList = (db.penyesuaian||[])
                        .filter(pz => pz.tokoId===toko.id && (!filter.bulan || pz.tanggal?.startsWith(filter.bulan)))
                        .sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
                      if (pzList.length===0) return null;
                      return (
                        <div style={{ overflowX:"auto", borderTop:`1px solid ${T.gray200}` }}>
                          <div style={{ padding:"6px 10px", fontSize:11, fontWeight:700, color:T.gray500 }}>🔧 Riwayat Penyesuaian Stok</div>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                            <tbody>
                              {pzList.map(pz => (
                                <tr key={pz.id} style={{ borderTop:`1px solid ${T.gray100}`, background: pz.status==="menunggu" ? "#FFFBEB" : "transparent" }}>
                                  <td style={{ padding:"6px 10px", fontWeight:600, whiteSpace:"nowrap" }}>{pz.tanggal}</td>
                                  <td style={{ padding:"6px 10px" }}>
                                    <Badge color={pz.jenis==="Tambah"?T.green:T.red} bg={pz.jenis==="Tambah"?T.greenLt:T.redLt}>
                                      {pz.jenis==="Tambah"?"➕ Tambah":pz.jenis==="Kurang"?"➖ Kurang":"🔻 Tarik Sebagian"}
                                    </Badge>
                                    {pz.status==="menunggu" && <span style={{marginLeft:4}}><Badge color={T.gold} bg="#FFFBEB">⏳ Menunggu</Badge></span>}
                                    {pz.status==="ditolak" && <span style={{marginLeft:4}}><Badge color={T.red} bg={T.redLt}>❌ Ditolak</Badge></span>}
                                  </td>
                                  <td style={{ padding:"6px 10px" }}>
                                    {produkAktif.filter(p=>Number(pz[`jumlah_${p.id}`]||0)>0)
                                      .map(p=>`${p.nama}: ${pz[`jumlah_${p.id}`]}`).join(" · ")}
                                  </td>
                                  <td style={{ padding:"6px 10px", color:T.gray400, fontSize:11 }}>
                                    {pz.dicatatOleh && <span>👤 {pz.dicatatOleh}</span>}
                                    {pz.catatan && <span style={{ marginLeft:6 }}>📝 {pz.catatan}</span>}
                                  </td>
                                  <td style={{ padding:"6px 10px", textAlign:"right", whiteSpace:"nowrap" }}>
                                    {pz.status==="menunggu" && !isSalesRestricted && (
                                      <>
                                        <Btn variant="primary" size="sm" icon="✅" onClick={()=>{
                                          updateRecord("penyesuaian", pz.id, { status:"disetujui", disetujuiOleh:"Manual" });
                                          setTimeout(()=>recalcTokoStok(toko.id), 300);
                                        }}>Setujui</Btn>
                                        {" "}
                                        <Btn variant="danger" size="sm" icon="❌" onClick={()=>{
                                          if (!confirm("Tolak pengajuan penyesuaian stok ini?")) return;
                                          updateRecord("penyesuaian", pz.id, { status:"ditolak", disetujuiOleh:"Manual" });
                                        }}>Tolak</Btn>
                                        {" "}
                                      </>
                                    )}
                                    <Btn variant="danger" size="sm" icon="🗑" onClick={()=>{
                                      if (!confirm("Hapus penyesuaian stok ini?")) return;
                                      deleteRecord("penyesuaian", pz.id);
                                      const remaining = (db.penyesuaian||[]).filter(x=>x.id!==pz.id);
                                      recalcTokoStok(toko.id, undefined, remaining);
                                    }}>Hapus</Btn>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      ) : (
        <>
          <BulkActionBar
            selectedIds={selectedIds} total={data.length}
            onSelectAll={()=>toggleSelectAll(data, false)}
            onClearAll={()=>setSelectedIds([])}
            onDeleteSelected={deleteSelected} label="catatan kontrol" />
          <Card padding={0}>
            <Table columns={cols} data={data} onEdit={openEdit}
              rowStyle={(row) => {
                if (!row.catatanStatus) return null;
                const st = row.catatanStatus;
                if (CATATAN_STATUS[st]) return CATATAN_STATUS[st].bg;
                return null;
              }}
              onDelete={id=>setDeleteTarget(id)}
              selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
          </Card>
        </>
      )}

      {/* Daftar Penjualan Luar Rute (tidak terikat toko/rute) */}
      {(() => {
        const luarList = (db.penjualanLuar||[])
          .filter(pl => (!isSalesRestricted || pl.wilayahId===salesWilayahId) && (!filter.bulan || pl.tanggal?.startsWith(filter.bulan)))
          .sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
        if (luarList.length===0) return null;
        const totalRevLuar = luarList.reduce((s,pl) => {
          let rev = 0;
          produkAktif.forEach(p => { rev += Number(pl[`terjual_${p.id}`]||0) * (p.harga||0); });
          return s + rev;
        }, 0);
        const totalBonusLuar = luarList.reduce((s,pl) => {
          let bonus = 0;
          produkAktif.forEach(p => { bonus += Number(pl[`bonusInput_${p.id}`]||0); });
          return s + bonus;
        }, 0);
        return (
          <Card padding={0} style={{ marginTop:16 }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.gray200}`,
              display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:T.gray800 }}>🛣️ Penjualan Luar Rute</div>
                <div style={{ fontSize:11, color:T.gray400 }}>
                  Penjualan di luar kunjungan rute normal (toko/rute tidak diketahui sales) · {luarList.length} entri
                  {" "}· Rev: <b style={{ color:T.green }}>{fmtRp(totalRevLuar)}</b>
                  {" "}· Bonus: <b style={{ color:T.gold }}>{fmt(totalBonusLuar)} pcs</b>
                </div>
              </div>
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Tanggal</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Wilayah</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Produk Terjual</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>🎁 Bonus</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Keterangan</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Dicatat Oleh</th>
                    <th style={{ padding:"8px 10px", textAlign:"right", fontSize:11, color:T.gray500 }}>Rev</th>
                    <th style={{ padding:"8px 10px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {luarList.map(pl => {
                    let rev = 0;
                    const produkTerjual = produkAktif
                      .filter(p => Number(pl[`terjual_${p.id}`]||0) > 0)
                      .map(p => { rev += Number(pl[`terjual_${p.id}`]||0) * (p.harga||0); return `${p.nama}: ${pl[`terjual_${p.id}`]}`; })
                      .join(" · ");
                    const bonusTerjual = produkAktif
                      .filter(p => Number(pl[`bonusInput_${p.id}`]||0) > 0)
                      .map(p => `${p.nama}: ${pl[`bonusInput_${p.id}`]}`)
                      .join(" · ");
                    const wilayahNama = (db.wilayah||[]).find(w=>w.id===pl.wilayahId)?.nama;
                    return (
                      <tr key={pl.id} style={{ borderTop:`1px solid ${T.gray100}` }}>
                        <td style={{ padding:"6px 10px", fontWeight:600, whiteSpace:"nowrap" }}>{pl.tanggal}</td>
                        <td style={{ padding:"6px 10px", fontWeight:600 }}>{wilayahNama || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px" }}>{produkTerjual || "—"}</td>
                        <td style={{ padding:"6px 10px", color:T.gold }}>{bonusTerjual || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", color:T.gray500, maxWidth:220 }}>{pl.keterangan || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", color:T.gray500 }}>{pl.dicatatOleh || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:T.green }}>{fmtRp(rev)}</td>
                        <td style={{ padding:"6px 10px", textAlign:"right" }}>
                          <Btn variant="danger" size="sm" icon="🗑" onClick={()=>deleteLuarRute(pl.id)}>Hapus</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {modal && (
        <Modal title={modal==="add"?"Tambah Kontrol Bulanan":"Edit Kontrol Bulanan"} onClose={()=>setModal(null)} width={600}>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:4 }}>
            <Input label="Wilayah" value={modalFilter.wilayahId} onChange={handleModalWilayahChange}
              options={wilayahOpts} hint="Pilih wilayah untuk mempersempit pilihan rute & toko" />
            <Input label="Rute" value={modalFilter.ruteId} onChange={handleModalRuteChange}
              options={modalRuteOpts} hint="Pilih rute untuk mempersempit pilihan toko" />
            <div style={{ gridColumn:"1/-1" }}>
              <SearchableSelect
                label="Toko"
                value={form.tokoId}
                onChange={handleTokoChange}
                options={modalTokoOpts}
                required
                placeholder="Ketik nama toko untuk mencari..."
                hint={
                  modalTokoOpts.length === 0
                    ? "Tidak ada toko Aktif/Baru untuk filter ini"
                    : `${modalTokoOpts.length} toko tersedia (Aktif + Baru) · Toko Non-Aktif otomatis disembunyikan · 🆕 = toko baru`
                }
              />
              {/* Panel info status toko yang dipilih */}
              {form.tokoId && (() => {
                const toko = (db.toko||[]).find(t=>t.id===form.tokoId);
                if (!toko) return null;
                const isBaru = toko.status === "Baru";
                return (
                  <div style={{
                    marginTop: -8, marginBottom: 14,
                    background: isBaru ? T.blueLt : T.greenLt,
                    border: `1px solid ${isBaru ? "#93C5FD" : T.green+"33"}`,
                    borderRadius: 8, padding: "8px 12px",
                    display: "flex", alignItems: "center", gap: 10, fontSize: 12
                  }}>
                    <span style={{ fontSize: 18 }}>{isBaru ? "🆕" : "✅"}</span>
                    <div>
                      <span style={{ fontWeight: 700, color: isBaru ? T.blue : T.green }}>
                        {toko.nama}
                      </span>
                      <span style={{
                        marginLeft: 8,
                        background: isBaru ? T.blue : T.green,
                        color: "#fff", fontSize: 10, fontWeight: 700,
                        borderRadius: 99, padding: "1px 8px"
                      }}>
                        {toko.status}
                      </span>
                      {toko.kode && <span style={{ marginLeft: 6, color: T.gray400 }}>· {toko.kode}</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
            <Input label="Tanggal Kontrol" value={form.tanggal} onChange={v=>f("tanggal",v)} type="date" required />
          </div>

          {selToko && (
            <div style={{ background:T.greenLt, borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:12 }}>
              <b style={{ color:T.green }}>Produk toko ini:</b>
              {" "}{produkAktif.filter(p=>selToko[`produk_${p.id}`]).map(p=>p.nama).join(", ")||"Semua produk"}
            </div>
          )}

          {/* Stok, Terjual, & Bonus per produk */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:4 }}>📦 Stok, Penjualan & Bonus Produk</div>
            <div style={{ fontSize:11, color:T.gray400, marginBottom:10 }}>Kolom <b style={{ color:T.gold }}>Bonus Produk</b> adalah jumlah <b>pcs produk</b> yang diberikan ke toko saat kunjungan ini</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10 }}>
              {/* Roll On ditaruh paling depan karena produk ini paling banyak dititipkan ke toko */}
              {[...produkAktif].sort((a,b)=>{
                const aRoll = /roll\s*on/i.test(a.nama) ? 0 : 1;
                const bRoll = /roll\s*on/i.test(b.nama) ? 0 : 1;
                return aRoll - bRoll;
              }).map(p => {
                const terjual = Number(form[`terjual_${p.id}`]||0);
                const bonusPcs = Number(form[`bonusInput_${p.id}`]||0);
                const ditarik = !!form[`ditarik_${p.id}`];
                return (
                  <div key={p.id} style={{ background:ditarik?T.redLt:(terjual>0?T.greenLt:T.gray50), borderRadius:10,
                    padding:"12px", border:`1.5px solid ${ditarik?T.red:(terjual>0?T.green+"44":T.gray200)}`, transition:"all .2s" }}>
                    <div style={{ fontSize:12, fontWeight:800, color:T.gray800, marginBottom:10 }}>
                      {p.nama}
                      {terjual>0 && !ditarik && <span style={{ marginLeft:6, fontSize:10, background:T.green, color:"#fff", borderRadius:99, padding:"1px 6px" }}>✓ Laku</span>}
                      {ditarik && <span style={{ marginLeft:6, fontSize:10, background:T.red, color:"#fff", borderRadius:99, padding:"1px 6px" }}>🔻 Ditarik</span>}
                    </div>
                    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", marginBottom:10,
                      padding:"6px 8px", borderRadius:7, background:ditarik?T.red+"22":T.gray100 }}>
                      <input type="checkbox" checked={ditarik}
                        onChange={e=>{
                          const val = e.target.checked;
                          f(`ditarik_${p.id}`, val);
                          if (val) f(`stok_${p.id}`, 0); // Ditarik → Stok Awal otomatis 0
                        }} />
                      <span style={{ fontSize:11, fontWeight:700, color:ditarik?T.red:T.gray600 }}>🔻 Produk ditarik dari toko ini</span>
                    </label>
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Stok Awal</div>
                      <input type="number" value={form[`stok_${p.id}`]||0} disabled={ditarik}
                        onChange={e=>f(`stok_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box",
                          background:ditarik?T.gray100:T.white, opacity:ditarik?0.6:1 }} />
                    </div>
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Terjual</div>
                      <input type="number" value={form[`terjual_${p.id}`]||0}
                        onChange={e=>f(`terjual_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${terjual>0?T.green:T.gray200}`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ marginBottom:4 }}>
                      <div style={{ fontSize:11, color:T.gold, marginBottom:3 }}>🎁 Bonus Produk (pcs)</div>
                      <input type="number" value={form[`bonusInput_${p.id}`]||0}
                        onChange={e=>f(`bonusInput_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gold}44`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:T.goldLt }} />
                    </div>
                    {bonusPcs>0 && (
                      <div style={{ fontSize:11, color:T.gold, marginTop:6, fontWeight:700 }}>
                        🎁 {bonusPcs} pcs bonus diberikan
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Revenue & Bonus estimasi */}
          <div style={{ background:T.goldLt, borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:13 }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span><b style={{ color:T.gold }}>Estimasi Revenue:</b></span>
              <span style={{ fontWeight:800, color:T.gold }}>
                {fmtRp(produkAktif.reduce((s,p)=>s+(Number(form[`terjual_${p.id}`])||0)*(p.harga||0),0))}
              </span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              <span><b style={{ color:T.orange }}>Total Bonus Produk:</b></span>
              <span style={{ fontWeight:800, color:T.orange }}>
                {fmt(produkAktif.reduce((s,p)=>s+(Number(form[`bonusInput_${p.id}`])||0),0))} pcs
              </span>
            </div>
          </div>

          {/* Status kunjungan: selalu tampil.
               - Saat tidak ada penjualan → WAJIB dipilih
               - Saat ada penjualan       → OPSIONAL (untuk catatan tambahan) */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
              <div style={{ fontSize:12, fontWeight:600, color:T.gray600 }}>Status Kunjungan</div>
              {!adaTerjual
                ? <Badge color={T.orange} bg={T.orangeLt}>⚠️ Wajib diisi — tidak ada penjualan</Badge>
                : <Badge color={T.gray400} bg={T.gray100}>Opsional — untuk catatan tambahan</Badge>
              }
            </div>

            {/* Saat ada penjualan: tombol "Tidak perlu catatan" sebagai default */}
            {adaTerjual && (
              <div style={{ marginBottom:8 }}>
                <label style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 14px",
                  border:`2px solid ${catatanSt==="" ? T.green : T.gray200}`,
                  borderRadius:8, cursor:"pointer",
                  background:catatanSt==="" ? T.greenLt : T.white }}>
                  <input type="radio" name="catatanStatus" value="" checked={catatanSt===""}
                    onChange={()=>{ f("catatanStatus",""); f("catatan",""); }}
                    style={{ accentColor:T.green }} />
                  <span style={{ fontSize:12, fontWeight:600, color:T.green }}>✅ Terjual — tanpa catatan tambahan</span>
                </label>
              </div>
            )}

            <div className="gw-grid3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              {Object.entries(CATATAN_STATUS).filter(([k])=>k!=="manual").map(([key, cs]) => (
                <label key={key} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                  border:`2px solid ${catatanSt===key ? cs.border : T.gray200}`,
                  borderRadius:8, cursor:"pointer", background:catatanSt===key ? cs.bg : T.white }}>
                  <input type="radio" name="catatanStatus" value={key} checked={catatanSt===key}
                    onChange={()=>f("catatanStatus",key)} style={{ accentColor:cs.color }} />
                  <span style={{ fontSize:12, fontWeight:600, color:cs.color }}>{cs.label}</span>
                </label>
              ))}
              <label style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                border:`2px solid ${catatanSt==="manual" ? T.gray400 : T.gray200}`,
                borderRadius:8, cursor:"pointer", background:catatanSt==="manual" ? T.gray100 : T.white }}>
                <input type="radio" name="catatanStatus" value="manual" checked={catatanSt==="manual"}
                  onChange={()=>f("catatanStatus","manual")} />
                <span style={{ fontSize:12, fontWeight:600, color:T.gray600 }}>📝 Isi Manual</span>
              </label>
            </div>

            {(catatanSt==="manual" || (adaTerjual && catatanSt && catatanSt!=="")) && (
              <div style={{ marginTop:10 }}>
                <Input label={catatanSt==="manual" ? "Catatan" : "Catatan Tambahan (opsional)"}
                  value={form.catatan||""} onChange={v=>f("catatan",v)} type="textarea"
                  placeholder={catatanSt==="manual"
                    ? "Tulis catatan bebas..."
                    : "Tambahkan keterangan jika perlu..."} />
              </div>
            )}
          </div>

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────────
function MiniBar({ value, max, color }) {
  const pct = max>0 ? Math.round((value/max)*100) : 0;
  return (
    <div style={{ position:"relative", height:6, background:T.gray100, borderRadius:99, overflow:"hidden", flex:1 }}>
      <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${pct}%`,
        background:color, borderRadius:99, transition:"width .5s" }} />
    </div>
  );
}

function Dashboard({ db, analytics, salesWilayahId }) {
  const isSalesRestricted = !!salesWilayahId;
  // Filter analytics data berdasarkan wilayah Sales (jika berlaku)
  const { totalRev: allRev, labaBersih: allLaba, produkStats, bagiHasil } = analytics;
  const perWilayahAll = analytics.perWilayah;
  const perRuteAll = analytics.perRute;

  const perWilayah = isSalesRestricted
    ? perWilayahAll.filter(w => w.id === salesWilayahId)
    : perWilayahAll;
  const perRute = isSalesRestricted
    ? perRuteAll.filter(r => {
        const w = (db.wilayah||[]).find(ww=>ww.id===r.wilayahId);
        return r.wilayahId === salesWilayahId;
      })
    : perRuteAll;

  // Hitung ulang total hanya untuk wilayah yang tampil
  const totalRev = isSalesRestricted ? perWilayah.reduce((s,w)=>s+w.rev,0) : allRev;
  const labaBersih = totalRev * 0.7;
  const tokoAktif = isSalesRestricted
    ? (db.toko||[]).filter(t => {
        if (t.status !== "Aktif") return false;
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId;
      }).length
    : analytics.tokoAktif;
  // ✅ Total toko & jumlah rute juga di-scope ke wilayah Sales — sebelumnya
  // masih menampilkan angka GLOBAL (semua wilayah) meski pembilangnya
  // (toko aktif) sudah benar di-scope, sehingga rasio yang tampil (mis.
  // "1 dari 3815") jadi tidak konsisten/membingungkan untuk Sales.
  const tokoTotalScoped = isSalesRestricted
    ? (db.toko||[]).filter(t => {
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId;
      }).length
    : (db.toko||[]).length;
  const ruteTotalScoped = isSalesRestricted
    ? (db.rute||[]).filter(r=>r.wilayahId===salesWilayahId).length
    : (db.rute||[]).length;
  const maxRev = Math.max(...perWilayah.map(w=>w.rev),1);

  // ✅ Ekspor Dashboard — tiga kolom (Kategori, Metrik, Nilai) agar lebih rapi & terkelompok
  const _totalBonus = analytics.kontrol.reduce((s,k)=>s+(k.totalBonus||0),0);
  const dashboardExportRows = [
    // ── Keuangan ──
    { kategori:"💰 KEUANGAN",      metrik:"Total Revenue",          nilai:fmtRp(totalRev) },
    { kategori:"",                  metrik:"Laba Bersih Est. (70%)", nilai:fmtRp(labaBersih) },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Master Data ──
    { kategori:"🏪 MASTER DATA",   metrik:"Toko Aktif",             nilai:`${tokoAktif} dari ${tokoTotalScoped}` },
    { kategori:"",                  metrik:"Total Wilayah",          nilai:isSalesRestricted ? 1 : (db.wilayah||[]).length },
    { kategori:"",                  metrik:"Total Rute",             nilai:ruteTotalScoped },
    { kategori:"",                  metrik:"Total Produk Aktif",     nilai:(db.produk||[]).filter(p=>p.aktif!==false).length },
    { kategori:"",                  metrik:"Pengguna Terdaftar",     nilai:(db.pengguna||[]).length },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Aktivitas ──
    { kategori:"📋 AKTIVITAS",     metrik:"Entri Kontrol",          nilai:(db.kontrol||[]).length },
    { kategori:"",                  metrik:"Total Bonus (pcs)",      nilai:fmt(_totalBonus) },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Revenue per Wilayah ──
    { kategori:"📍 REVENUE / WILAYAH", metrik:"",                   nilai:"" },
    ...perWilayah.map(w => ({ kategori:"", metrik:w.nama||w.id,     nilai:fmtRp(w.rev) })),
    { kategori:"",                  metrik:"",                       nilai:"" },
    { kategori:"",                  metrik:"TOTAL REVENUE",          nilai:fmtRp(totalRev) },
  ];
  const dashboardExportCols = [
    { key:"kategori", label:"Kategori" },
    { key:"metrik",   label:"Metrik" },
    { key:"nilai",    label:"Nilai" },
  ];

  return (
    <div>
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:10,
          padding:"10px 16px", marginBottom:14, fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, fontWeight:600 }}>
          🔒 Dashboard ini menampilkan data wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📈 Dashboard</div>
        <ExportMenu data={dashboardExportRows} columns={dashboardExportCols} title="Dashboard Ringkasan" filename="dashboard_summary" />
      </div>
      <div style={{ fontSize:12, color:T.gray400, marginBottom:20 }}>Data real-time dari semua master data & kontrol bulanan</div>

      <div className="gw-dash-stats" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12, marginBottom:20 }}>
        <StatCard label="Toko Aktif"      value={tokoAktif}            sub={`dari ${tokoTotalScoped} total`} icon="🏪" color={T.green} />
        <StatCard label="Total Wilayah"   value={isSalesRestricted ? 1 : (db.wilayah||[]).length} sub={`${ruteTotalScoped} rute`}   icon="📍" color={T.teal} />
        <StatCard label="Total Pendapatan" value={fmtRp(totalRev)}      sub="bulan ini"                           icon="💰" color={T.gold} />
        <StatCard label="Laba Bersih Est." value={fmtRp(labaBersih)}    sub="70% margin"                          icon="📊" color={T.green} />
        <StatCard label="Total Produk"    value={(db.produk||[]).filter(p=>p.aktif!==false).length+" produk"} sub="aktif" icon="🧴" color={T.purple} />
        <StatCard label="Entri Kontrol"   value={(db.kontrol||[]).length} sub="total transaksi"                  icon="📋" color={T.blue} />
        <StatCard label="Total Bonus"     value={`${fmt(analytics.kontrol.reduce((s,k)=>s+(k.totalBonus||0),0))} pcs`} sub="diberikan ke toko" icon="🎁" color={T.orange} />
        <StatCard label="Pengguna"        value={(db.pengguna||[]).length} sub="terdaftar"                       icon="👤" color={T.gray600} />
      </div>

      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📍 Revenue per Wilayah</div>
          {perWilayah.length===0 && <div style={{ color:T.gray400, fontSize:12 }}>Belum ada data</div>}
          {perWilayah.map(w => (
            <div key={w.id} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <span style={{ fontSize:13, fontWeight:600, color:T.gray800 }}>{w.nama}</span>
                <span style={{ fontSize:12, color:T.green, fontWeight:700 }}>{fmtRp(w.rev)}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <MiniBar value={w.rev} max={maxRev} color={T.green} />
                <span style={{ fontSize:11, color:T.gray400, minWidth:60, textAlign:"right" }}>{w.tokoCount} toko</span>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🧴 Performa Produk</div>
          {produkStats.length===0 && <div style={{ color:T.gray400, fontSize:12 }}>Belum ada data produk</div>}
          {produkStats.map((p, i) => {
            const maxP = Math.max(...produkStats.map(x=>x.terjual),1);
            const COLORS = [T.green,T.blue,T.orange,T.purple,T.teal,T.red,T.gold];
            const color = COLORS[i % COLORS.length];
            return (
              <div key={p.id} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{p.nama}</span>
                  <span style={{ fontSize:12, fontWeight:700, color }}>{fmt(p.terjual)} pcs</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <MiniBar value={p.terjual} max={maxP} color={color} />
                  <span style={{ fontSize:11, color:T.gray400, minWidth:80, textAlign:"right" }}>{fmtRp(p.rev)}</span>
                </div>
                {p.bonus>0 && (
                  <div style={{ fontSize:11, color:T.gold, marginTop:2 }}>
                    Bonus default: {p.bonus} pcs/kunjungan
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </div>

      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🛣️ Rute Aktif</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`2px solid ${T.gray200}` }}>
                {["Rute","Wilayah","Toko","Revenue"].map(h=>(
                  <th key={h} style={{ padding:"6px 8px", textAlign:"left", color:T.gray600, fontWeight:700, fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perRute.length===0 ? (
                <tr><td colSpan={4} style={{ padding:16, textAlign:"center", color:T.gray400 }}>Belum ada rute</td></tr>
              ) : perRute.map((r,i)=>(
                <tr key={r.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                  <td style={{ padding:"7px 8px", fontWeight:600 }}>{r.nama}</td>
                  <td style={{ padding:"7px 8px" }}><Badge color={T.teal}>{r.wilayahNama}</Badge></td>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}>{r.tokoCount}</td>
                  <td style={{ padding:"7px 8px", fontWeight:700, color:T.green }}>{fmtRp(r.rev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {!isSalesRestricted && (
          <Card>
            <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:4 }}>💰 Simulasi Bagi Hasil</div>
            <div style={{ fontSize:11, color:T.gray400, marginBottom:14 }}>Asumsi margin laba bersih 70% dari pendapatan</div>
            {bagiHasil.map((b,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 12px", borderRadius:8, marginBottom:8, background:i===0?T.greenLt:T.gray50 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.gray800 }}>{b.nama}</div>
                  <div style={{ fontSize:11, color:T.gray400 }}>{b.tipe==="Laba"?"Dari laba bersih":"Dari pendapatan"} · {(b.pct*100).toFixed(0)}%</div>
                </div>
                <div style={{ fontSize:15, fontWeight:800, color:i===0?T.green:T.gray800 }}>{fmtRp(b.nominal)}</div>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${T.gray200}`, paddingTop:10, marginTop:4, display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:T.gray600, fontWeight:600 }}>Laba Bersih Estimasi</span>
              <span style={{ fontSize:14, fontWeight:800, color:T.gold }}>{fmtRp(labaBersih)}</span>
            </div>
          </Card>
        )}
      </div>

      {/* Kontrol Terbaru */}
      <Card>
        <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📋 Data Kontrol Terbaru</div>
        {(() => {
          // ✅ Di-scope ke wilayah Sales — sebelumnya menampilkan kontrol
          // terbaru dari SEMUA wilayah, bukan cuma wilayah Sales sendiri.
          const kontrolScoped = isSalesRestricted
            ? analytics.kontrol.filter(k=>k.wilayahId===salesWilayahId)
            : analytics.kontrol;
          return kontrolScoped.length===0 ? (
          <div style={{ textAlign:"center", color:T.gray400, padding:20 }}>Belum ada data kontrol</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                  {["Toko","Wilayah","Tanggal","Revenue","Status"].map(h=>(
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kontrolScoped.slice().reverse().slice(0,8).map((k,i)=>{
                  const cs = CATATAN_STATUS[k.catatanStatus]||CATATAN_STATUS.manual;
                  return (
                    <tr key={k.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                      <td style={{ padding:"10px 14px" }}><b>{k.tokoNama}</b></td>
                      <td style={{ padding:"10px 14px" }}><Badge color={T.green}>{k.wilayahNama}</Badge></td>
                      <td style={{ padding:"10px 14px" }}>{k.tanggal}</td>
                      <td style={{ padding:"10px 14px" }}><b style={{ color:T.green }}>{fmtRp(k.totalRev)}</b></td>
                      <td style={{ padding:"10px 14px" }}><Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        })()}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB REKAP — Harian/Bulanan/Kuartal/Tahunan
// ─────────────────────────────────────────────
function TabRekap({ db, analytics, salesWilayahId }) {
  const isSalesRestricted = !!salesWilayahId;
  const [mode, setMode] = useState("bulanan"); // harian | bulanan | kuartal | tahunan
  const [filterWilayah, setFilterWilayah] = useState(salesWilayahId||""); // "" = semua
  const [filterBulan, setFilterBulan] = useState(() => new Date().toISOString().slice(0,7));
  const [filterTahun, setFilterTahun] = useState(() => String(new Date().getFullYear()));
  const [filterKuartal, setFilterKuartal] = useState("1"); // "1"|"2"|"3"|"4"
  const [filterTanggal, setFilterTanggal] = useState(() => new Date().toISOString().slice(0,10));
  const [filterRute, setFilterRute] = useState(""); // untuk harian
  const [rankingScope, setRankingScope] = useState("semua"); // 3bulan | 6bulan | tahunIni | semua
  const [rankingSortBy, setRankingSortBy] = useState("terjual"); // terjual | revenue

  // ─── Rekap Siklus per Wilayah ───
  // Untuk kasus kontrol yang mulai pertengahan bulan & berakhir awal bulan
  // berikutnya (tidak pas batas kalender), supaya progres 1 wilayah tetap
  // bisa dipantau utuh dari rute pertama sampai rute terakhir dalam 1
  // putaran, bukan terpotong batas bulan.
  const [filterSiklusWilayahs, setFilterSiklusWilayahs] = useState(salesWilayahId?[salesWilayahId]:[]);
  const [filterSiklusStart, setFilterSiklusStart] = useState("");
  const [filterSiklusEnd, setFilterSiklusEnd] = useState("");

  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);
  const wilayahOpts = (db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }));
  const ruteOpts = useMemo(() => {
    const rutes = filterWilayah
      ? (db.rute||[]).filter(r=>r.wilayahId===filterWilayah)
      : (db.rute||[]);
    // Urutkan alami (BKLU1, BKLU2, ..., BKLU14 — bukan urutan input asli
    // atau abjad teks biasa yang salah taruh BKLU10 sebelum BKLU2).
    return [...rutes].sort((a,b)=>naturalCompare(a.nama, b.nama)).map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, filterWilayah]);

  const tahunList = useMemo(() => {
    const years = new Set();
    (db.kontrol||[]).forEach(k => { if(k.tanggal) years.add(k.tanggal.slice(0,4)); });
    const cur = String(new Date().getFullYear());
    years.add(cur);
    return [...years].sort().reverse().map(y=>({ value:y, label:y }));
  }, [db.kontrol]);

  // Enrich kontrol dengan info wilayah/rute
  const enrichKontrol = useMemo(() => analytics.kontrol, [analytics.kontrol]);

  // Deteksi otomatis rentang siklus TERAKHIR untuk wilayah terpilih: mundur
  // dari tanggal kontrol paling baru, selama jeda antar tanggal kontrol
  // berurutan tidak lebih dari 10 hari (dianggap masih 1 putaran/siklus
  // yang sama). Kalau jeda lebih dari itu, dianggap sudah siklus baru.
  const SIKLUS_GAP_DAYS = 10;
  const siklusAutoRange = useMemo(() => {
    if (!filterSiklusWilayahs.length) return null;
    const dates = [...new Set(enrichKontrol.filter(k=>filterSiklusWilayahs.includes(k.wilayahId)).map(k=>k.tanggal))].sort();
    if (!dates.length) return null;
    let end = dates[dates.length-1];
    let start = end;
    for (let i = dates.length-2; i >= 0; i--) {
      const diffDays = (new Date(start) - new Date(dates[i])) / 86400000;
      if (diffDays > SIKLUS_GAP_DAYS) break;
      start = dates[i];
    }
    return { start, end };
  }, [enrichKontrol, filterSiklusWilayahs]);

  // Auto-isi tanggal mulai/selesai begitu wilayah dipilih/diganti — tetap
  // bisa digeser manual sesudahnya lewat input tanggal di filter panel.
  useEffect(() => {
    if (siklusAutoRange) {
      setFilterSiklusStart(siklusAutoRange.start);
      setFilterSiklusEnd(siklusAutoRange.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSiklusWilayahs.join(",")]);

  // (Urutan alami rute BKLU1..BKLU14 dsb sekarang pakai naturalCompare()
  // yang sudah tersedia secara global — konsisten dengan urutan di Master
  // Toko, Master Rute, dan dropdown filter rute lainnya.)

  // ─── HELPER: agregasi produk per entri kontrol ───
  function sumProduk(rows) {
    const res = {};
    produkAktif.forEach(p => {
      res[`stok_${p.id}`] = rows.reduce((s,k)=>s+(k[`stok_${p.id}`]||0), 0);
      res[`terjual_${p.id}`] = rows.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0), 0);
      res[`bonus_${p.id}`] = rows.reduce((s,k)=>s+(k[`bonusInput_${p.id}`]!==undefined?Number(k[`bonusInput_${p.id}`]):(p.bonus||0)),0);
    });
    return res;
  }

  // ✅ HELPER: hitung jumlah toko "Toko Tutup" & "Tidak Terjual" dari status
  // kunjungan (catatanStatus) — dipakai di semua mode rekap supaya setiap
  // hasil ekspor (Excel/PDF/JPG) ikut menampilkan keterangan ini, bukan cuma
  // angka Revenue/Terjual saja.
  function hitungStatusKunjungan(rows) {
    return {
      jumlahTutup: rows.filter(k => k.catatanStatus === "tutup").length,
      jumlahTidakTerjual: rows.filter(k => k.catatanStatus === "terjual").length,
    };
  }

  // ─── HELPER: bikin baris "Penjualan Luar Rute" (dipakai di semua mode
  //     rekap — harian/bulanan/kuartal/tahunan — supaya penjualan yang
  //     tidak terikat rute/wilayah tetap kelihatan rinciannya, bukan cuma
  //     nambah ke Total Revenue secara diam-diam). ───
  function luarRuteRow(luarRows, extra) {
    const sp = sumProduk(luarRows);
    return {
      wilayahId: "LUAR_RUTE", ruteId: "LUAR_RUTE",
      wilayahNama: "🛣️ Penjualan Luar Rute", ruteNama: "🛣️ Penjualan Luar Rute",
      jumlahKunjungan: luarRows.length, jumlahToko: luarRows.length,
      totalRev: luarRows.reduce((s,k)=>s+k.totalRev,0),
      totalBonus: luarRows.reduce((s,k)=>s+(k.totalBonus||0),0),
      jumlahTutup: 0, jumlahTidakTerjual: 0, // penjualan luar rute tidak punya status kunjungan
      ...sp, detail: luarRows, ...extra,
    };
  }

  // ─── HARIAN PER RUTE ───
  const rekapHarian = useMemo(() => {
    const rows = enrichKontrol.filter(k =>
      k.tanggal === filterTanggal &&
      (!filterWilayah || k.wilayahId === filterWilayah) &&
      (!filterRute || k.ruteId === filterRute)
    );
    // Group by rute
    const byRute = {};
    rows.forEach(k => {
      const key = k.ruteId || "NORUTE";
      if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
      byRute[key].rows.push(k);
    });
    const hasil = Object.values(byRute).map(g => {
      const sp = sumProduk(g.rows);
      return {
        ...g,
        jumlahToko: g.rows.length,
        totalRev: g.rows.reduce((s,k)=>s+k.totalRev,0),
        totalBonus: g.rows.reduce((s,k)=>s+(k.totalBonus||0),0),
        ...sp,
        ...hitungStatusKunjungan(g.rows),
        detail: g.rows,
      };
    });
    // Urutkan alami (BKLU1, BKLU2, ..., BKLU14) supaya rapi seperti mode
    // rekap lain — sebelumnya urutannya ikut urutan input data mentah.
    hasil.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));

    // ✅ Ikutkan Penjualan Luar Rute pada tanggal yang sama sebagai kelompok
    // tersendiri, supaya produk yang terjual di luar rute kontrol tetap
    // terlihat rinciannya di rekap harian — sebelumnya catatan ini cuma
    // menambah ke Total Revenue tanpa rincian produk apa yang terjual.
    // Sekarang penjualan luar rute sudah punya wilayahId, jadi ditampilkan
    // kalau cocok dengan filter wilayah (atau kalau tidak sedang memfilter
    // wilayah sama sekali). Filter rute tidak berlaku karena luar rute
    // memang tidak terikat ke rute manapun.
    if (!filterRute) {
      const luarRows = (analytics.penjualanLuar||[]).filter(pl =>
        pl.tanggal === filterTanggal && (!filterWilayah || pl.wilayahId === filterWilayah)
      );
      if (luarRows.length) {
        const sp = sumProduk(luarRows);
        hasil.push({
          ruteId: "LUAR_RUTE",
          ruteNama: "🛣️ Penjualan Luar Rute",
          wilayahNama: luarRows[0].wilayahNama ? `🛣️ ${luarRows[0].wilayahNama}` : "Tidak terikat rute/wilayah",
          jumlahToko: luarRows.length,
          totalRev: luarRows.reduce((s,k)=>s+k.totalRev,0),
          totalBonus: luarRows.reduce((s,k)=>s+(k.totalBonus||0),0),
          jumlahTutup: 0, jumlahTidakTerjual: 0,
          ...sp,
          detail: luarRows,
        });
      }
    }
    return hasil;
  }, [enrichKontrol, filterTanggal, filterWilayah, filterRute, produkAktif, analytics.penjualanLuar]);

  // ─── SIKLUS PER WILAYAH (rentang bebas, dari rute pertama s/d terakhir) ───
  // ✅ Sekarang bisa MENGGABUNGKAN siklus dari beberapa wilayah sekaligus
  // (filterSiklusWilayahs = array id wilayah, bukan cuma 1). Dikelompokkan
  // tetap per rute seperti biasa — karena tiap baris hasil sudah punya
  // kolom Wilayah sendiri, rute dari wilayah berbeda otomatis kebedakan
  // tanpa perlu grouping tambahan per wilayah.
  const rekapSiklus = useMemo(() => {
    if (!filterSiklusWilayahs.length || !filterSiklusStart || !filterSiklusEnd) return [];
    const rows = enrichKontrol.filter(k =>
      filterSiklusWilayahs.includes(k.wilayahId) &&
      k.tanggal >= filterSiklusStart && k.tanggal <= filterSiklusEnd
    );
    const byRute = {};
    rows.forEach(k => {
      const key = k.ruteId || "NORUTE";
      if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
      byRute[key].rows.push(k);
    });
    const hasil = Object.values(byRute).map(g => {
      const sp = sumProduk(g.rows);
      return {
        ...g,
        jumlahToko: g.rows.length,
        totalRev: g.rows.reduce((s,k)=>s+k.totalRev,0),
        totalBonus: g.rows.reduce((s,k)=>s+(k.totalBonus||0),0),
        ...sp,
        ...hitungStatusKunjungan(g.rows),
        detail: g.rows,
      };
    });
    // Urutkan per wilayah dulu (kalau gabungan >1 wilayah), baru per rute,
    // supaya rute-rute 1 wilayah tetap mengelompok rapi, bukan tercampur.
    hasil.sort((a,b)=>naturalCompare(a.wilayahNama, b.wilayahNama) || naturalCompare(a.ruteNama, b.ruteNama));

    // ✅ Ikutkan Penjualan Luar Rute milik wilayah-wilayah yang dipilih & jatuh
    // di rentang tanggal siklus ini — sales tetap bertanggung jawab atas semua
    // penjualan (sesuai rute maupun di luar rute) begitu siklus wilayahnya
    // selesai, jadi rekap siklus harus menampung keduanya, bukan cuma yang
    // sesuai rute. Kalau lebih dari 1 wilayah digabung, dipisah per wilayah
    // supaya rinciannya tetap jelas asalnya dari wilayah mana.
    const luarRows = (analytics.penjualanLuar||[]).filter(pl =>
      filterSiklusWilayahs.includes(pl.wilayahId) &&
      pl.tanggal >= filterSiklusStart && pl.tanggal <= filterSiklusEnd
    );
    if (luarRows.length) {
      if (filterSiklusWilayahs.length > 1) {
        const byWilLuar = {};
        luarRows.forEach(pl => {
          const key = pl.wilayahId || "NOWIL";
          if (!byWilLuar[key]) byWilLuar[key] = [];
          byWilLuar[key].push(pl);
        });
        Object.values(byWilLuar).forEach(rowsW => hasil.push(luarRuteRow(rowsW)));
      } else {
        hasil.push(luarRuteRow(luarRows));
      }
    }

    return hasil;
  }, [enrichKontrol, filterSiklusWilayahs, filterSiklusStart, filterSiklusEnd, produkAktif, analytics.penjualanLuar]);

  // ─── BULANAN PER WILAYAH ───
  const rekapBulanan = useMemo(() => {
    const rows = enrichKontrol.filter(k =>
      k.tanggal?.startsWith(filterBulan) &&
      (!filterWilayah || k.wilayahId === filterWilayah)
    );
    if (filterWilayah) {
      // Per rute dalam wilayah
      const byRute = {};
      rows.forEach(k => {
        const key = k.ruteId || "NORUTE";
        if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
        byRute[key].rows.push(k);
      });
      const result = Object.values(byRute).map(g => {
        const sp = sumProduk(g.rows);
        return { ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
      });
      result.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
      // ✅ Ikutkan Penjualan Luar Rute milik wilayah yang sama di bulan ini —
      // sales tetap bertanggung jawab atas semua penjualan wilayahnya.
      const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(filterBulan));
      if (luarRows.length) result.push(luarRuteRow(luarRows));
      return result;
    } else {
      // Per wilayah
      const byWil = {};
      rows.forEach(k => {
        const key = k.wilayahId || "NOWIL";
        if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, rows:[] };
        byWil[key].rows.push(k);
      });
      const result = Object.values(byWil).map(g => {
        const sp = sumProduk(g.rows);
        return { ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
      });
      const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(filterBulan));
      if (luarRows.length) result.push(luarRuteRow(luarRows));
      return result;
    }
  }, [enrichKontrol, filterBulan, filterWilayah, produkAktif, analytics.penjualanLuar]);

  // ─── KUARTAL ───
  const KUARTAL_MONTHS = { "1":["01","02","03"], "2":["04","05","06"], "3":["07","08","09"], "4":["10","11","12"] };
  const rekapKuartal = useMemo(() => {
    const months = KUARTAL_MONTHS[filterKuartal] || [];
    const rows = enrichKontrol.filter(k => {
      if (!k.tanggal) return false;
      const [y,m] = k.tanggal.split("-");
      return y===filterTahun && months.includes(m) &&
        (!filterWilayah || k.wilayahId === filterWilayah);
    });
    if (filterWilayah) {
      // Per rute per bulan
      const result = [];
      months.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const byRute = {};
        mRows.forEach(k => {
          const key = k.ruteId||"NORUTE";
          if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byRute[key].rows.push(k);
        });
        const bulanRows = Object.values(byRute).map(g => {
          const sp = sumProduk(g.rows);
          return { ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
        });
        bulanRows.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
        result.push(...bulanRows);
        // ✅ Luar rute milik wilayah terpilih, bulan ini
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    } else {
      // Per wilayah per bulan
      const result = [];
      months.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const byWil = {};
        mRows.forEach(k => {
          const key = k.wilayahId||"NOWIL";
          if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byWil[key].rows.push(k);
        });
        Object.values(byWil).forEach(g => {
          const sp = sumProduk(g.rows);
          result.push({ ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) });
        });
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    }
  }, [enrichKontrol, filterKuartal, filterTahun, filterWilayah, produkAktif, analytics.penjualanLuar]);

  // ─── TAHUNAN ───
  const rekapTahunan = useMemo(() => {
    const rows = enrichKontrol.filter(k => {
      if (!k.tanggal) return false;
      return k.tanggal.startsWith(filterTahun) && (!filterWilayah || k.wilayahId===filterWilayah);
    });
    const ALL_MONTHS = ["01","02","03","04","05","06","07","08","09","10","11","12"];
    if (filterWilayah) {
      const result = [];
      ALL_MONTHS.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (mRows.length===0 && luarRows.length===0) return;
        const byRute = {};
        mRows.forEach(k => {
          const key = k.ruteId||"NORUTE";
          if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byRute[key].rows.push(k);
        });
        const bulanRows = Object.values(byRute).map(g => {
          const sp = sumProduk(g.rows);
          return { ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
        });
        bulanRows.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
        result.push(...bulanRows);
        // ✅ Luar rute milik wilayah terpilih, bulan ini
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    } else {
      const result = [];
      ALL_MONTHS.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (mRows.length===0 && luarRows.length===0) return;
        const byWil = {};
        mRows.forEach(k => {
          const key = k.wilayahId||"NOWIL";
          if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byWil[key].rows.push(k);
        });
        Object.values(byWil).forEach(g => {
          const sp = sumProduk(g.rows);
          result.push({ ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) });
        });
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    }
  }, [enrichKontrol, filterTahun, filterWilayah, produkAktif, analytics.penjualanLuar]);
  // (dependency analytics.penjualanLuar sudah ada di atas — dipertahankan)

  // ─── RANKING TOKO — Terlaris (jumlah produk terjual / revenue) ───
  const rankingByJumlah = useMemo(() => {
    const now = new Date();
    let cutoff = null; // "YYYY-MM" — hanya ikutkan kontrol mulai bulan ini
    if (rankingScope === "3bulan") cutoff = new Date(now.getFullYear(), now.getMonth()-2, 1).toISOString().slice(0,7);
    else if (rankingScope === "6bulan") cutoff = new Date(now.getFullYear(), now.getMonth()-5, 1).toISOString().slice(0,7);
    else if (rankingScope === "tahunIni") cutoff = `${now.getFullYear()}-01`;

    const rows = enrichKontrol.filter(k =>
      (!filterWilayah || k.wilayahId === filterWilayah) &&
      (!cutoff || (k.tanggal||"").slice(0,7) >= cutoff)
    );
    const byToko = {};
    rows.forEach(k => {
      if (!k.tokoId) return;
      if (!byToko[k.tokoId]) byToko[k.tokoId] = {
        tokoId:k.tokoId, tokoNama:k.tokoNama, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama,
        totalTerjual:0, totalRev:0, jumlahKunjungan:0,
      };
      byToko[k.tokoId].totalTerjual += k.totalTerjual||0;
      byToko[k.tokoId].totalRev += k.totalRev||0;
      byToko[k.tokoId].jumlahKunjungan += 1;
    });
    const list = Object.values(byToko).filter(r => r.jumlahKunjungan > 0);
    list.sort((a,b) => rankingSortBy === "revenue" ? b.totalRev - a.totalRev : b.totalTerjual - a.totalTerjual);
    return list.map((r,i) => ({ ...r, rank:i+1 }));
  }, [enrichKontrol, filterWilayah, rankingScope, rankingSortBy]);

  // ─── RANKING TOKO — Konsisten terjual N bulan berturut-turut ───
  // Sebuah bulan dihitung "terjual" untuk toko itu kalau totalTerjual > 0
  // pada SALAH SATU entri kontrol di bulan itu. Streak dihitung dari
  // deretan bulan (YYYY-MM) yang berurutan tanpa jeda.
  const KONSISTEN_MIN_BULAN = 3;
  const rankingKonsisten = useMemo(() => {
    const isNextMonth = (a, b) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return (by*12+bm) - (ay*12+am) === 1;
    };
    const byToko = {};
    enrichKontrol.forEach(k => {
      if (!k.tokoId || !k.tanggal) return;
      if (filterWilayah && k.wilayahId !== filterWilayah) return;
      if ((k.totalTerjual||0) <= 0) return; // hanya bulan yang BENAR-BENAR ada penjualan
      const bln = k.tanggal.slice(0,7);
      if (!byToko[k.tokoId]) byToko[k.tokoId] = { tokoId:k.tokoId, tokoNama:k.tokoNama, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, months: new Set() };
      byToko[k.tokoId].months.add(bln);
    });
    const list = Object.values(byToko).map(info => {
      const sorted = [...info.months].sort();
      let longest = 1, current = 1;
      for (let i=1; i<sorted.length; i++) {
        current = isNextMonth(sorted[i-1], sorted[i]) ? current+1 : 1;
        if (current > longest) longest = current;
      }
      return { ...info, totalBulanTerjual: sorted.length, streakTerpanjang: sorted.length ? longest : 0, bulanTerakhir: sorted[sorted.length-1] || "-" };
    });
    return list.filter(r => r.streakTerpanjang >= KONSISTEN_MIN_BULAN)
      .sort((a,b) => b.streakTerpanjang - a.streakTerpanjang || b.totalBulanTerjual - a.totalBulanTerjual);
  }, [enrichKontrol, filterWilayah]);

  // ─── BUILD COLUMNS ───
  const produkCols = produkAktif.flatMap(p => [
    { key:`stok_${p.id}`,    label:`Stok ${p.id}`, render:v=><span>{fmt(v||0)}</span> },
    { key:`terjual_${p.id}`, label:`Jual ${p.id}`, render:v=><b style={{ color:T.green }}>{fmt(v||0)}</b> },
    { key:`bonus_${p.id}`,   label:`Bonus ${p.id}`,render:v=><span style={{ color:T.gold }}>{fmt(v||0)}</span> },
  ]);

  const colsHarian = [
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahToko",     label:"Jml Toko",     render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsBulananWil = [
    { key:"wilayahNama",    label:"Wilayah",      render:v=><b>{v||"—"}</b> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsBulananRute = [
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsKuartalWil = [
    { key:"bulan",          label:"Bulan",        render:v=><Badge color={T.blue}>{v}</Badge> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><b>{v||"—"}</b> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.teal }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsKuartalRute = [
    { key:"bulan",          label:"Bulan",        render:v=><Badge color={T.blue}>{v}</Badge> },
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.teal }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];

  const colsRanking = [
    { key:"rank",           label:"#",            render:v=><b style={{ color: v===1?T.gold:v===2?T.gray500:v===3?"#B45309":T.gray400 }}>{v<=3 ? ["🥇","🥈","🥉"][v-1] : v}</b> },
    { key:"tokoNama",       label:"Toko",         render:v=><b>{v}</b> },
    { key:"ruteNama",       label:"Rute",         render:v=><span>{v}</span> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"totalTerjual",   label:"Total Terjual",render:v=><b style={{ color:T.purple }}>{fmt(v)} pcs</b> },
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
  ];

  // ─── Ambil data & kolom aktif ───
  let activeData = [], activeCols = [], activeTitle = "", activeFilename = "";
  if (mode==="harian") {
    activeData = rekapHarian;
    activeCols = colsHarian;
    activeTitle = `Rekap Harian ${filterTanggal}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_harian_${filterTanggal}`;
  } else if (mode==="bulanan") {
    activeData = rekapBulanan;
    activeCols = filterWilayah ? colsBulananRute : colsBulananWil;
    activeTitle = `Rekap Bulanan ${filterBulan}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":"" }`;
    activeFilename = `rekap_bulanan_${filterBulan}`;
  } else if (mode==="kuartal") {
    activeData = rekapKuartal;
    activeCols = filterWilayah ? colsKuartalRute : colsKuartalWil;
    activeTitle = `Rekap Kuartal ${filterKuartal} Tahun ${filterTahun}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_kuartal${filterKuartal}_${filterTahun}`;
  } else if (mode==="ranking") {
    activeData = rankingByJumlah;
    activeCols = colsRanking;
    const scopeLabel = { semua:"Semua Waktu", tahunIni:"Tahun Ini", "3bulan":"3 Bulan Terakhir", "6bulan":"6 Bulan Terakhir" }[rankingScope];
    activeTitle = `Ranking Toko Terlaris — ${scopeLabel}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `ranking_toko_${rankingScope}`;
  } else if (mode==="siklus") {
    activeData = rekapSiklus;
    activeCols = colsHarian;
    const wilNamaList = filterSiklusWilayahs.map(id => (db.wilayah||[]).find(w=>w.id===id)?.nama || id);
    const wilNamaGabungan = wilNamaList.join(", ");
    activeTitle = filterSiklusWilayahs.length
      ? `Siklus Kontrol ${filterSiklusWilayahs.length>1 ? "Gabungan: "+wilNamaGabungan : wilNamaGabungan} (${filterSiklusStart||"?"} s/d ${filterSiklusEnd||"?"})`
      : "Siklus Kontrol — pilih wilayah dulu";
    activeFilename = `siklus_${filterSiklusWilayahs.join("-")||"wilayah"}_${filterSiklusStart||""}_${filterSiklusEnd||""}`;
  } else {
    activeData = rekapTahunan;
    activeCols = filterWilayah ? colsKuartalRute : colsKuartalWil;
    activeTitle = `Rekap Tahunan ${filterTahun}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_tahunan_${filterTahun}`;
  }

  // ─── Summary cards ───
  const totalRevAll = activeData.reduce((s,r)=>s+r.totalRev,0);
  const totalKunjungan = activeData.reduce((s,r)=>s+(r.jumlahToko||r.jumlahKunjungan||0),0);
  const totalBonusAll = activeData.reduce((s,r)=>s+(r.totalBonus||0),0);
  const totalTutupAll = activeData.reduce((s,r)=>s+(r.jumlahTutup||0),0);
  const totalTidakTerjualAll = activeData.reduce((s,r)=>s+(r.jumlahTidakTerjual||0),0);

  // ─── RENDER HARIAN DETAIL (per toko dalam rute) ───
  function HarianDetail() {
    return (
      <div>
        {rekapHarian.length === 0 ? (
          <Card>
            <div style={{ textAlign:"center", color:T.gray400, padding:32, fontSize:14 }}>
              📭 Tidak ada data kontrol untuk tanggal <b>{filterTanggal}</b>
              {filterWilayah && <span> di wilayah terpilih</span>}.
            </div>
          </Card>
        ) : rekapHarian.map((ruteGrp, gi) => (
          <Card key={ruteGrp.ruteId||gi} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${T.gray200}` }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🛣️ {ruteGrp.ruteNama}</div>
                <div style={{ fontSize:12, color:T.gray400 }}>{ruteGrp.wilayahNama} · {ruteGrp.jumlahToko} toko</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:14, fontWeight:800, color:T.green }}>{fmtRp(ruteGrp.totalRev)}</div>
                <div style={{ fontSize:12, color:T.gold }}>Bonus: {fmt(ruteGrp.totalBonus)} pcs</div>
              </div>
            </div>
            {/* Sub-tabel detail toko */}
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={thS}>Toko</th>
                    {produkAktif.map(p=>(
                      <th key={p.id} style={thS} colSpan={2}>{p.nama}</th>
                    ))}
                    <th style={thS}>Revenue</th>
                    <th style={thS}>Status</th>
                  </tr>
                  <tr style={{ background:T.gray100 }}>
                    <th style={thS}></th>
                    {produkAktif.map(p=>(
                      <React.Fragment key={p.id}>
                        <th style={{ ...thS, color:T.gray500 }}>Stok</th>
                        <th style={{ ...thS, color:T.green }}>Jual</th>
                      </React.Fragment>
                    ))}
                    <th style={thS}></th>
                    <th style={thS}></th>
                  </tr>
                </thead>
                <tbody>
                  {ruteGrp.detail.map((k,i) => {
                    const cs = k.catatanStatus ? (CATATAN_STATUS[k.catatanStatus]||CATATAN_STATUS.manual) : null;
                    const isLuarRute = !k.tokoNama;
                    return (
                      <tr key={k.id} style={{ background:i%2===0?T.white:T.gray50, borderTop:`1px solid ${T.gray100}` }}>
                        <td style={tdS}>
                          <b>{k.tokoNama || `👤 ${k.dicatatOleh || "Tidak diketahui"}`}</b>
                          {isLuarRute && k.keterangan && (
                            <div style={{ fontSize:10, color:T.gray400, fontWeight:400 }}>{k.keterangan}</div>
                          )}
                        </td>
                        {produkAktif.map(p=>(
                          <React.Fragment key={p.id}>
                            <td style={{ ...tdS, textAlign:"center" }}>{isLuarRute ? "—" : (k[`stok_${p.id}`]||0)}</td>
                            <td style={{ ...tdS, textAlign:"center", fontWeight:700, color:T.green }}>{k[`terjual_${p.id}`]||0}</td>
                          </React.Fragment>
                        ))}
                        <td style={{ ...tdS, fontWeight:700, color:T.green, whiteSpace:"nowrap" }}>{fmtRp(k.totalRev)}</td>
                        <td style={tdS}>
                          {isLuarRute ? <Badge color={T.purple}>🛣️ Luar Rute</Badge>
                              : cs ? <Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge>
                              : <Badge color={T.green}>✅ Terjual</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Sub-total baris */}
                  <tr style={{ background:T.greenLt, borderTop:`2px solid ${T.green}33`, fontWeight:700 }}>
                    <td style={tdS}>SUBTOTAL</td>
                    {produkAktif.map(p=>(
                      <React.Fragment key={p.id}>
                        <td style={{ ...tdS, textAlign:"center" }}>{fmt(ruteGrp[`stok_${p.id}`]||0)}</td>
                        <td style={{ ...tdS, textAlign:"center", color:T.green }}>{fmt(ruteGrp[`terjual_${p.id}`]||0)}</td>
                      </React.Fragment>
                    ))}
                    <td style={{ ...tdS, color:T.green }}>{fmtRp(ruteGrp.totalRev)}</td>
                    <td style={tdS}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        {/* Grand total harian */}
        {rekapHarian.length > 1 && (
          <Card style={{ background:T.goldLt, border:`2px solid ${T.gold}44` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>
                🏆 TOTAL KESELURUHAN — {filterTanggal}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:20, fontWeight:800, color:T.green }}>{fmtRp(totalRevAll)}</div>
                <div style={{ fontSize:13, color:T.gold }}>Bonus: {fmt(totalBonusAll)} pcs · {totalKunjungan} toko</div>
                {(totalTutupAll>0 || totalTidakTerjualAll>0) && (
                  <div style={{ fontSize:12, color:T.gray500, marginTop:2 }}>
                    {totalTutupAll>0 && <span>🔵 {totalTutupAll} toko tutup</span>}
                    {totalTutupAll>0 && totalTidakTerjualAll>0 && <span> · </span>}
                    {totalTidakTerjualAll>0 && <span>🟡 {totalTidakTerjualAll} tidak terjual</span>}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  const thS = { padding:"7px 10px", textAlign:"left", color:T.gray600, fontWeight:700, fontSize:11, whiteSpace:"nowrap", borderBottom:`1px solid ${T.gray200}` };
  const tdS = { padding:"7px 10px", color:T.gray800, verticalAlign:"middle" };

  const MODE_TABS = [
    { key:"harian",   label:"📅 Harian/Rute" },
    { key:"bulanan",  label:"📆 Bulanan" },
    { key:"kuartal",  label:"📊 Kuartal" },
    { key:"tahunan",  label:"📈 Tahunan" },
    { key:"siklus",   label:"🔁 Siklus Wilayah" },
    { key:"ranking",  label:"🏆 Ranking Toko" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📑 Rekap Penjualan</div>
          <div style={{ fontSize:12, color:T.gray400 }}>Rekap otomatis dari data kontrol bulanan</div>
        </div>
        {(() => {
          // ── Kolom ekspor rekap (plain, tanpa React render) ──
          const rekapExportCols = activeCols.map(c => ({ key: c.key, label: c.label }));
          // Tambah kolom revenue formatted jika ada totalRev
          const hasTotalRev = activeCols.some(c => c.key === "totalRev");
          const finalRekapCols = hasTotalRev
            ? rekapExportCols.map(c => c.key === "totalRev" ? { ...c, key:"totalRevFmt", label:"Revenue (Rp)" } : c)
            : rekapExportCols;
          const rekapExportData = [
            ...activeData.map(row => ({
              ...row,
              totalRevFmt: hasTotalRev ? fmtRp(row.totalRev||0) : undefined,
            })),
            // Pemisah
            {},
            // Baris total
            {
              wilayahNama: "═══ TOTAL ═══",
              ruteNama: "",
              bulan: "",
              jumlahToko: totalKunjungan,
              jumlahKunjungan: totalKunjungan,
              jumlahTutup: totalTutupAll,
              jumlahTidakTerjual: totalTidakTerjualAll,
              totalRevFmt: fmtRp(totalRevAll),
              totalBonus: totalBonusAll,
              ...produkAktif.reduce((acc, p) => {
                acc[`stok_${p.id}`]    = activeData.reduce((s,r)=>s+(r[`stok_${p.id}`]||0),0);
                acc[`terjual_${p.id}`] = activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0);
                acc[`bonus_${p.id}`]   = activeData.reduce((s,r)=>s+(r[`bonus_${p.id}`]||0),0);
                return acc;
              }, {}),
            },
            // Baris kosong
            {},
            // Ringkasan
            { wilayahNama:"📊 RINGKASAN",             ruteNama:"",                        totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Total Revenue",             ruteNama:fmtRp(totalRevAll),         totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Total Bonus (pcs)",         ruteNama:String(totalBonusAll),      totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Jumlah Kunjungan/Toko",    ruteNama:String(totalKunjungan),     totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Tutup",                ruteNama:String(totalTutupAll),       totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Tidak Terjual",        ruteNama:String(totalTidakTerjualAll),totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Jumlah Baris Data",         ruteNama:String(activeData.length),  totalRevFmt:"", totalBonus:"" },
          ];
          return (
            <ExportMenu
              data={activeData} columns={activeCols}
              exportData={rekapExportData} exportCols={finalRekapCols}
              title={activeTitle} filename={activeFilename}
            />
          );
        })()}
      </div>

      {/* Mode Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:16, background:T.white, border:`1px solid ${T.gray200}`,
        borderRadius:12, padding:6, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
        {MODE_TABS.map(m => (
          <button key={m.key} onClick={()=>setMode(m.key)}
            style={{ flex:1, padding:"9px 0", border:"none", borderRadius:8, cursor:"pointer",
              fontFamily:"inherit", fontWeight:700, fontSize:13, transition:"all .15s",
              background:mode===m.key ? T.green : "transparent",
              color:mode===m.key ? "#fff" : T.gray600 }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Filter Panel */}
      <div style={{ background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10,
        padding:"14px 16px", marginBottom:16, display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
        
        {/* Filter Wilayah — disembunyikan untuk Sales yang wilayahnya terkunci,
            dan untuk mode Siklus (yang punya field wilayah sendiri di bawah) */}
        {mode==="siklus" ? null : isSalesRestricted ? (
          <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
            padding:"8px 14px", fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, flex:1, minWidth:160 }}>
            🔒 Wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
          </div>
        ) : (
          <div style={{ minWidth:160, flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Wilayah</div>
            <select value={filterWilayah} onChange={e=>{ setFilterWilayah(e.target.value); setFilterRute(""); }}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              <option value="">Semua Wilayah</option>
              {wilayahOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* Filter Siklus per Wilayah: bisa pilih LEBIH DARI 1 wilayah untuk
            digabung jadi satu rekap siklus + rentang tanggal bebas
            (auto-terdeteksi dari siklus terakhir, tapi bisa digeser manual) */}
        {mode==="siklus" && (
          <>
            {isSalesRestricted ? (
              <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
                padding:"8px 14px", fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, flex:1, minWidth:160 }}>
                🔒 Wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
              </div>
            ) : (
              <div style={{ minWidth:220, flex:2 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>
                  Wilayah {filterSiklusWilayahs.length>1 && <span style={{ color:T.teal }}>({filterSiklusWilayahs.length} digabung)</span>}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {wilayahOpts.map(o => {
                    const active = filterSiklusWilayahs.includes(o.value);
                    return (
                      <button key={o.value} type="button"
                        onClick={() => setFilterSiklusWilayahs(prev =>
                          active ? prev.filter(id=>id!==o.value) : [...prev, o.value])}
                        style={{ padding:"6px 12px", borderRadius:99, border:`1.5px solid ${active?T.teal:T.gray200}`,
                          background:active?T.tealLt:T.white, color:active?T.teal:T.gray600,
                          fontSize:12, fontWeight:700, cursor:"pointer" }}>
                        {active?"✓ ":""}{o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ minWidth:150 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Dari Tanggal</div>
              <input type="date" value={filterSiklusStart} onChange={e=>setFilterSiklusStart(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            <div style={{ minWidth:150 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Sampai Tanggal</div>
              <input type="date" value={filterSiklusEnd} onChange={e=>setFilterSiklusEnd(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            {filterSiklusWilayahs.length>0 && (
              <Btn variant="secondary" size="sm" onClick={() => {
                if (siklusAutoRange) { setFilterSiklusStart(siklusAutoRange.start); setFilterSiklusEnd(siklusAutoRange.end); }
              }}>🔄 Deteksi Ulang Otomatis</Btn>
            )}
          </>
        )}


        {/* Filter tanggal (harian) */}
        {mode==="harian" && (
          <>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tanggal</div>
              <input type="date" value={filterTanggal} onChange={e=>setFilterTanggal(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            <div style={{ minWidth:160, flex:1 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Rute</div>
              <select value={filterRute} onChange={e=>setFilterRute(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="">Semua Rute</option>
                {ruteOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Filter bulan */}
        {mode==="bulanan" && (
          <div style={{ minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Bulan</div>
            <input type="month" value={filterBulan} onChange={e=>setFilterBulan(e.target.value)}
              style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
          </div>
        )}

        {/* Filter kuartal */}
        {(mode==="kuartal" || mode==="tahunan") && (
          <div style={{ minWidth:120 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tahun</div>
            <select value={filterTahun} onChange={e=>setFilterTahun(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              {tahunList.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {mode==="kuartal" && (
          <div style={{ minWidth:140 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Kuartal</div>
            <select value={filterKuartal} onChange={e=>setFilterKuartal(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              {[["1","Q1 (Jan–Mar)"],["2","Q2 (Apr–Jun)"],["3","Q3 (Jul–Sep)"],["4","Q4 (Okt–Des)"]].map(([v,l])=>(
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        )}

        {/* Filter khusus Ranking Toko */}
        {mode==="ranking" && (
          <>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Periode</div>
              <select value={rankingScope} onChange={e=>setRankingScope(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="3bulan">3 Bulan Terakhir</option>
                <option value="6bulan">6 Bulan Terakhir</option>
                <option value="tahunIni">Tahun Ini</option>
                <option value="semua">Semua Waktu (data yang sudah dimuat)</option>
              </select>
            </div>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Urutkan Berdasarkan</div>
              <select value={rankingSortBy} onChange={e=>setRankingSortBy(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="terjual">Jumlah Produk Terjual</option>
                <option value="revenue">Revenue</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Summary Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12, marginBottom:16 }}>
        <StatCard label="Total Revenue" value={fmtRp(totalRevAll)} icon="💰" color={T.green} />
        <StatCard label="Laba Est. (70%)" value={fmtRp(totalRevAll*0.7)} icon="📊" color={T.gold} />
        <StatCard label={mode==="harian"?"Toko":"Kunjungan"} value={totalKunjungan} icon="🏪" color={T.blue} />
        <StatCard label="Total Bonus" value={`${fmt(totalBonusAll)} pcs`} icon="🎁" color={T.orange} />
        {produkAktif.map(p => (
          <StatCard key={p.id}
            label={`Jual ${p.nama}`}
            value={`${fmt(activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0))} pcs`}
            icon="🧴" color={T.purple} />
        ))}
      </div>

      {/* Title Banner */}
      <div style={{ background:T.green, borderRadius:10, padding:"12px 18px", marginBottom:14,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ color:"#fff", fontWeight:800, fontSize:15 }}>{activeTitle}</div>
        <div style={{ color:"rgba(255,255,255,.8)", fontSize:12 }}>
          {activeData.length} kelompok · {fmt(totalKunjungan)} {mode==="harian"?"toko":"kunjungan"}
        </div>
      </div>

      {/* Content */}
      {mode==="harian" ? (
        <HarianDetail />
      ) : (
        activeData.length === 0 ? (
          <Card>
            <div style={{ textAlign:"center", color:T.gray400, padding:32, fontSize:14 }}>
              📭 Tidak ada data untuk periode ini.
            </div>
          </Card>
        ) : (
          <>
            <Card padding={0}>
              <Table columns={activeCols} data={activeData} />
            </Card>
            {/* Grand Total Row */}
            <Card style={{ background:T.goldLt, border:`2px solid ${T.gold}44`, marginTop:12 }}>
              <div style={{ display:"flex", flexWrap:"wrap", gap:24, alignItems:"center" }}>
                <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🏆 GRAND TOTAL</div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Total Revenue</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.green }}>{fmtRp(totalRevAll)}</div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Laba Bersih Est.</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.gold }}>{fmtRp(totalRevAll*0.7)}</div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Total Kunjungan</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.blue }}>{totalKunjungan}</div>
                </div>
                {produkAktif.map(p=>(
                  <div key={p.id}>
                    <div style={{ fontSize:11, color:T.gray500 }}>Jual {p.nama}</div>
                    <div style={{ fontSize:16, fontWeight:700, color:T.purple }}>
                      {fmt(activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0))} pcs
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )
      )}

      {/* Panel tambahan khusus mode Ranking: toko konsisten terjual berturut-turut */}
      {mode==="ranking" && (
        <Card style={{ marginTop:16 }}>
          <div style={{ fontSize:15, fontWeight:800, color:T.gray800, marginBottom:4 }}>
            🔥 Toko Konsisten Terjual ≥{KONSISTEN_MIN_BULAN} Bulan Berturut-turut
          </div>
          <div style={{ fontSize:12, color:T.gray400, marginBottom:14 }}>
            Dihitung dari SELURUH data kontrol yang sudah dimuat (tidak terikat periode di atas) — toko dengan
            deretan bulan tanpa jeda yang selalu ada penjualan (&gt;0 pcs terjual).
          </div>
          {rankingKonsisten.length === 0 ? (
            <div style={{ textAlign:"center", color:T.gray400, padding:24, fontSize:13 }}>
              📭 Belum ada toko dengan streak ≥{KONSISTEN_MIN_BULAN} bulan berturut-turut
              {filterWilayah ? " di wilayah terpilih" : ""}.
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={thS}>#</th>
                    <th style={thS}>Toko</th>
                    <th style={thS}>Rute</th>
                    <th style={thS}>Wilayah</th>
                    <th style={thS}>Streak Terpanjang</th>
                    <th style={thS}>Total Bulan Terjual</th>
                    <th style={thS}>Bulan Terakhir Terjual</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingKonsisten.map((r, i) => (
                    <tr key={r.tokoId} style={{ background:i%2===0?T.white:T.gray50, borderTop:`1px solid ${T.gray100}` }}>
                      <td style={tdS}>{i<3 ? ["🥇","🥈","🥉"][i] : i+1}</td>
                      <td style={tdS}><b>{r.tokoNama}</b></td>
                      <td style={tdS}>{r.ruteNama}</td>
                      <td style={tdS}><Badge color={T.green}>{r.wilayahNama}</Badge></td>
                      <td style={tdS}><b style={{ color:T.orange }}>{r.streakTerpanjang} bulan</b></td>
                      <td style={tdS}>{r.totalBulanTerjual} bulan</td>
                      <td style={tdS}>{r.bulanTerakhir}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
//  TAB BAGI HASIL — Simulasi Akuntansi Lengkap
// ─────────────────────────────────────────────
function TabBagiHasil({ db, analytics, save }) {
  const { totalRev, labaBersih, produkStats, kontrol } = analytics;

  // State untuk konfigurasi bagi hasil (tersimpan di db.bagiHasilConfig)
  const config = db.bagiHasilConfig || {
    marginLaba: 70, // % margin laba bersih dari pendapatan
    biayaOperasional: 0,
    biayaBonus: 0,
    biayaLogistik: 0,
    biayaLainnya: 0,
    pihak: [
      { id:"BH001", nama:"Pemilik Utama",  pct: 60, basis:"laba",    warna:"#0F4C35", keterangan:"Keuntungan inti bisnis" },
      { id:"BH002", nama:"Investor A",     pct: 20, basis:"revenue", warna:"#1D4ED8", keterangan:"Return on investment" },
      { id:"BH003", nama:"Manajer Ops",    pct: 10, basis:"laba",    warna:"#7C3AED", keterangan:"Bonus kinerja operasional" },
      { id:"BH004", nama:"Karyawan Pool",  pct: 10, basis:"laba",    warna:"#D97706", keterangan:"Insentif tim sales" },
    ],
  };

  const [editConfig, setEditConfig] = useState(false);
  const [cfgDraft, setCfgDraft] = useState(config);
  const [filterBulan, setFilterBulan] = useState(() => new Date().toISOString().slice(0,7));
  const [filterTahun, setFilterTahun] = useState(() => String(new Date().getFullYear()));
  const [periodeMode, setPeriodeMode] = useState("bulanan"); // bulanan | tahunan | kustom
  const [filterStart, setFilterStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
  const [filterEnd, setFilterEnd] = useState(() => new Date().toISOString().slice(0,10));
  const [showDetail, setShowDetail] = useState(false);
  const [modalPihak, setModalPihak] = useState(null);
  const [formPihak, setFormPihak] = useState({});

  // Hitung revenue berdasarkan filter periode
  const revPeriode = useMemo(() => {
    let rows = kontrol;
    if (periodeMode === "bulanan") {
      rows = kontrol.filter(k => k.tanggal?.startsWith(filterBulan));
    } else if (periodeMode === "tahunan") {
      rows = kontrol.filter(k => k.tanggal?.startsWith(filterTahun));
    } else {
      rows = kontrol.filter(k => k.tanggal >= filterStart && k.tanggal <= filterEnd);
    }
    const rev = rows.reduce((s,k) => s+k.totalRev, 0);
    const bonusTotal = rows.reduce((s,k) => s+(k.totalBonus||0), 0);
    const terjualTotal = rows.reduce((s,k) => s+k.totalTerjual, 0);
    const kunjunganTotal = rows.length;
    const tokoUnik = new Set(rows.map(k => k.tokoId)).size;
    return { rev, bonusTotal, terjualTotal, kunjunganTotal, tokoUnik, rows };
  }, [kontrol, periodeMode, filterBulan, filterTahun, filterStart, filterEnd]);

  // Kalkulasi akuntansi lengkap
  const akuntansi = useMemo(() => {
    const pendapatan = revPeriode.rev;
    const biayaOps = Number(config.biayaOperasional)||0;
    const biayaBonus = Number(config.biayaBonus)||0;
    const biayaLogistik = Number(config.biayaLogistik)||0;
    const biayaLain = Number(config.biayaLainnya)||0;
    const totalBiaya = biayaOps + biayaBonus + biayaLogistik + biayaLain;
    const labaKotor = pendapatan - totalBiaya;
    const marginPct = Number(config.marginLaba)||70;
    // ✅ Laba Bersih sekarang dihitung dari Laba Kotor (Pendapatan − semua
    // Biaya) dikali Margin%, BUKAN langsung dari Pendapatan. Sebelumnya,
    // biaya yang diisi (Operasional/Bonus/Logistik/Lainnya) cuma tampil di
    // baris "Laba Kotor" tapi tidak ikut mengurangi Laba Bersih yang benar-
    // benar dibagi ke semua pihak — jadi mengisi biaya tidak berpengaruh
    // sama sekali ke hasil bagi hasil. Sekarang biaya benar-benar mengurangi
    // apa yang dibagi.
    const labaBersihFinal = Math.max(labaKotor * (marginPct/100), 0);

    const pihakList = (config.pihak||[]).map(p => {
      const basis = p.basis === "laba" ? labaBersihFinal : pendapatan;
      const nominal = basis * (p.pct / 100);
      return { ...p, nominal, basisNilai: basis };
    });
    const totalDibagi = pihakList.reduce((s,p)=>s+p.nominal, 0);

    return {
      pendapatan, biayaOps, biayaBonus, biayaLogistik, biayaLain, totalBiaya,
      labaKotor, labaBersihFinal,
      pihakList, totalDibagi,
      marginPct,
    };
  }, [revPeriode.rev, config]);

  function saveConfig(newCfg) {
    save({ ...db, bagiHasilConfig: newCfg });
  }

  function submitConfig() {
    saveConfig(cfgDraft);
    setEditConfig(false);
  }

  function tambahPihak() {
    const newId = "BH" + String(Date.now()).slice(-5);
    setFormPihak({ id: newId, nama:"", pct:0, basis:"laba", warna:"#4B5563", keterangan:"" });
    setModalPihak("add");
  }

  function submitPihak() {
    if (!formPihak.nama) return alert("Nama wajib diisi");
    const pct = Number(formPihak.pct)||0;
    const pihakBaru = [...(cfgDraft.pihak||[])];
    if (modalPihak === "add") {
      pihakBaru.push({ ...formPihak, pct });
    } else {
      const idx = pihakBaru.findIndex(p=>p.id===formPihak.id);
      if (idx>=0) pihakBaru[idx] = { ...formPihak, pct };
    }
    const newCfg = { ...cfgDraft, pihak: pihakBaru };
    setCfgDraft(newCfg);
    saveConfig(newCfg);
    setModalPihak(null);
  }

  function hapusPihak(id) {
    if (!confirm("Hapus pihak ini?")) return;
    const newCfg = { ...config, pihak: (config.pihak||[]).filter(p=>p.id!==id) };
    saveConfig(newCfg);
    setCfgDraft(newCfg);
  }

  function exportLaporanBagiHasil() {
    const rows = [
      { keterangan:"LAPORAN BAGI HASIL", nilai:"" },
      { keterangan:"Periode", nilai: periodeMode==="bulanan"?filterBulan:periodeMode==="tahunan"?filterTahun:`${filterStart} s/d ${filterEnd}` },
      { keterangan:"", nilai:"" },
      { keterangan:"=== PENDAPATAN ===", nilai:"" },
      { keterangan:"Total Pendapatan (Revenue)", nilai: fmtRp(akuntansi.pendapatan) },
      { keterangan:"Total Produk Terjual", nilai: fmt(revPeriode.terjualTotal) + " pcs" },
      { keterangan:"Jumlah Kunjungan", nilai: revPeriode.kunjunganTotal },
      { keterangan:"Toko Aktif Dikunjungi", nilai: revPeriode.tokoUnik },
      { keterangan:"", nilai:"" },
      { keterangan:"=== BIAYA ===", nilai:"" },
      { keterangan:"Biaya Operasional", nilai: fmtRp(akuntansi.biayaOps) },
      { keterangan:"Biaya Bonus Produk", nilai: fmtRp(akuntansi.biayaBonus) },
      { keterangan:"Biaya Logistik", nilai: fmtRp(akuntansi.biayaLogistik) },
      { keterangan:"Biaya Lainnya", nilai: fmtRp(akuntansi.biayaLain) },
      { keterangan:"TOTAL BIAYA", nilai: fmtRp(akuntansi.totalBiaya) },
      { keterangan:"Laba Kotor", nilai: fmtRp(akuntansi.labaKotor) },
      { keterangan:"", nilai:"" },
      { keterangan:"=== LABA BERSIH ===", nilai:"" },
      { keterangan:`Laba Bersih (${akuntansi.marginPct}% dari Laba Kotor)`, nilai: fmtRp(akuntansi.labaBersihFinal) },
      { keterangan:"", nilai:"" },
      { keterangan:"=== DISTRIBUSI BAGI HASIL ===", nilai:"" },
      ...akuntansi.pihakList.map(p=>({
        keterangan: `${p.nama} (${p.pct}% dari ${p.basis==="laba"?"laba bersih":"revenue"})`,
        nilai: fmtRp(p.nominal)
      })),
      { keterangan:"TOTAL DIBAGI", nilai: fmtRp(akuntansi.totalDibagi) },
    ];
    exportExcel(rows, [{key:"keterangan",label:"Keterangan"},{key:"nilai",label:"Nilai"}],
      "Laporan Bagi Hasil GWG", `bagi_hasil_${filterBulan||filterTahun}`);
  }

  const PERIODE_LABELS = {
    bulanan: `Bulan ${filterBulan}`,
    tahunan: `Tahun ${filterTahun}`,
    kustom: `${filterStart} – ${filterEnd}`,
  };

  const totalPctLaba = (config.pihak||[]).filter(p=>p.basis==="laba").reduce((s,p)=>s+Number(p.pct||0),0);
  const totalPctRev = (config.pihak||[]).filter(p=>p.basis==="revenue").reduce((s,p)=>s+Number(p.pct||0),0);

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>💰 Simulasi Bagi Hasil & Akuntansi</div>
          <div style={{ fontSize:12, color:T.gray400 }}>Laporan keuangan & distribusi profit sesuai skema akuntansi</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Btn variant="secondary" size="sm" icon="⚙️" onClick={()=>{ setCfgDraft(config); setEditConfig(true); }}>Konfigurasi</Btn>
          <Btn variant="secondary" size="sm" icon="📊" onClick={exportLaporanBagiHasil}>Ekspor Excel</Btn>
          <Btn variant="secondary" size="sm" icon={showDetail?"🔼":"🔽"} onClick={()=>setShowDetail(v=>!v)}>
            {showDetail?"Sembunyikan Detail":"Lihat Detail Produk"}
          </Btn>
        </div>
      </div>

      {/* Filter Periode */}
      <Card style={{ marginBottom:16, padding:"14px 18px" }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Mode Periode</div>
            <div style={{ display:"flex", gap:6 }}>
              {["bulanan","tahunan","kustom"].map(m=>(
                <button key={m} onClick={()=>setPeriodeMode(m)}
                  style={{ padding:"6px 14px", border:`1.5px solid ${periodeMode===m?T.green:T.gray200}`,
                    borderRadius:7, background:periodeMode===m?T.greenLt:T.white, cursor:"pointer",
                    fontSize:12, fontWeight:600, color:periodeMode===m?T.green:T.gray600, fontFamily:"inherit" }}>
                  {m==="bulanan"?"📅 Bulanan":m==="tahunan"?"📆 Tahunan":"📌 Kustom"}
                </button>
              ))}
            </div>
          </div>
          {periodeMode==="bulanan" && (
            <div style={{ flex:1, minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Bulan</div>
              <input type="month" value={filterBulan} onChange={e=>setFilterBulan(e.target.value)}
                style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
            </div>
          )}
          {periodeMode==="tahunan" && (
            <div style={{ flex:1, minWidth:120 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tahun</div>
              <select value={filterTahun} onChange={e=>setFilterTahun(e.target.value)}
                style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }}>
                {[...new Set([...kontrol.map(k=>k.tanggal?.slice(0,4)).filter(Boolean), String(new Date().getFullYear())])].sort().reverse().map(y=>(
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {periodeMode==="kustom" && (
            <>
              <div style={{ flex:1, minWidth:140 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Dari Tanggal</div>
                <input type="date" value={filterStart} onChange={e=>setFilterStart(e.target.value)}
                  style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
              </div>
              <div style={{ flex:1, minWidth:140 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Sampai Tanggal</div>
                <input type="date" value={filterEnd} onChange={e=>setFilterEnd(e.target.value)}
                  style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
              </div>
            </>
          )}
          <div style={{ padding:"8px 16px", background:T.greenLt, borderRadius:8, border:`1px solid ${T.green}33`, fontSize:13 }}>
            <b style={{ color:T.green }}>Periode:</b> {PERIODE_LABELS[periodeMode]}
          </div>
        </div>
      </Card>

      {/* Ringkasan Kinerja Periode */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
        <StatCard label="Total Revenue" value={fmtRp(akuntansi.pendapatan)} icon="💵" color={T.green} sub={PERIODE_LABELS[periodeMode]} />
        <StatCard label="Laba Bersih" value={fmtRp(akuntansi.labaBersihFinal)} icon="📈" color={T.teal} sub={`${akuntansi.marginPct}% dari Laba Kotor`} />
        <StatCard label="Total Biaya" value={fmtRp(akuntansi.totalBiaya)} icon="📉" color={T.red} sub="semua kategori" />
        <StatCard label="Produk Terjual" value={fmt(revPeriode.terjualTotal)+" pcs"} icon="🧴" color={T.purple} sub={`${revPeriode.kunjunganTotal} kunjungan`} />
        <StatCard label="Toko Dikunjungi" value={revPeriode.tokoUnik} icon="🏪" color={T.blue} sub="toko unik" />
        <StatCard label="Total Dibagi" value={fmtRp(akuntansi.totalDibagi)} icon="🤝" color={T.gold} sub={`${(config.pihak||[]).length} pihak`} />
      </div>

      {/* Laporan Laba Rugi */}
      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:800, color:T.gray800, marginBottom:16, borderBottom:`2px solid ${T.green}`, paddingBottom:10 }}>
            📋 Laporan Laba Rugi — {PERIODE_LABELS[periodeMode]}
          </div>

          {/* Pendapatan */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>I. Pendapatan</div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.greenLt, borderRadius:7 }}>
              <span style={{ fontSize:13 }}>Pendapatan Konsinyasi</span>
              <span style={{ fontWeight:700, color:T.green }}>{fmtRp(akuntansi.pendapatan)}</span>
            </div>
          </div>

          {/* Biaya */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>II. Beban Usaha</div>
            {[
              { label:"Biaya Operasional", val: akuntansi.biayaOps },
              { label:"Biaya Bonus Produk", val: akuntansi.biayaBonus },
              { label:"Biaya Logistik/Distribusi", val: akuntansi.biayaLogistik },
              { label:"Biaya Lainnya", val: akuntansi.biayaLain },
            ].map((b,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px",
                borderBottom: i<3 ? `1px solid ${T.gray100}` : "none" }}>
                <span style={{ fontSize:13, color:T.gray600 }}>{b.label}</span>
                <span style={{ fontSize:13, color:T.red }}>({fmtRp(b.val)})</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.redLt, borderRadius:7, marginTop:6 }}>
              <span style={{ fontSize:13, fontWeight:700 }}>Total Beban</span>
              <span style={{ fontWeight:700, color:T.red }}>({fmtRp(akuntansi.totalBiaya)})</span>
            </div>
          </div>

          {/* Laba */}
          <div style={{ borderTop:`2px solid ${T.gray200}`, paddingTop:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.gray50, borderRadius:7, marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>Laba Kotor</span>
              <span style={{ fontWeight:700 }}>{fmtRp(akuntansi.labaKotor)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", marginBottom:4 }}>
              <span style={{ fontSize:13, color:T.gray600 }}>Penyesuaian Margin ({akuntansi.marginPct}%)</span>
              <span style={{ fontSize:13, color:T.gray600 }}>{fmtRp(akuntansi.labaBersihFinal)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 16px",
              background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`,
              borderRadius:10, marginTop:8 }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#fff" }}>💰 LABA BERSIH</span>
              <span style={{ fontSize:16, fontWeight:900, color:"#fff" }}>{fmtRp(akuntansi.labaBersihFinal)}</span>
            </div>
          </div>
        </Card>

        {/* Distribusi Bagi Hasil */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, borderBottom:`2px solid ${T.gold}`, paddingBottom:10 }}>
            <div style={{ fontSize:14, fontWeight:800, color:T.gray800 }}>🤝 Distribusi Bagi Hasil</div>
            <Btn size="sm" icon="＋" variant="gold" onClick={tambahPihak}>Tambah Pihak</Btn>
          </div>

          {/* Validasi total pct */}
          {(totalPctLaba > 100 || totalPctRev > 100) && (
            <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:12, color:T.red }}>
              ⚠️ Total persentase dari {totalPctLaba>100?"laba":"revenue"} melebihi 100% ({totalPctLaba>100?totalPctLaba:totalPctRev}%). Harap periksa konfigurasi.
            </div>
          )}

          {akuntansi.pihakList.length === 0 ? (
            <div style={{ textAlign:"center", color:T.gray400, padding:24 }}>Belum ada konfigurasi pihak bagi hasil</div>
          ) : (
            <>
              {/* Pie chart visual sederhana */}
              <div style={{ display:"flex", gap:4, height:16, borderRadius:99, overflow:"hidden", marginBottom:16 }}>
                {akuntansi.pihakList.map((p,i)=>{
                  const total = akuntansi.totalDibagi || 1;
                  const w = (p.nominal / total * 100).toFixed(1);
                  return <div key={i} style={{ width:`${w}%`, background:p.warna, minWidth:4, transition:"width .5s" }} title={`${p.nama}: ${fmtRp(p.nominal)}`} />;
                })}
              </div>

              {akuntansi.pihakList.map((p,i)=>(
                <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", borderRadius:10, marginBottom:10,
                  background:p.warna+"12", border:`1.5px solid ${p.warna}30` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:p.warna, flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:T.gray800 }}>{p.nama}</div>
                      <div style={{ fontSize:11, color:T.gray400 }}>
                        {p.pct}% dari {p.basis==="laba"?"laba bersih":"revenue"} · {p.keterangan}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:15, fontWeight:800, color:p.warna }}>{fmtRp(p.nominal)}</div>
                      <div style={{ fontSize:10, color:T.gray400 }}>dari {fmtRp(p.basisNilai)}</div>
                    </div>
                    <div style={{ display:"flex", gap:4 }}>
                      <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>{ setFormPihak({...p}); setModalPihak("edit"); }} />
                      <Btn variant="danger" size="sm" icon="🗑" onClick={()=>hapusPihak(p.id)} />
                    </div>
                  </div>
                </div>
              ))}

              <div style={{ borderTop:`2px solid ${T.gray200}`, paddingTop:12, marginTop:4,
                display:"flex", justifyContent:"space-between", padding:"12px 14px",
                background:T.goldLt, borderRadius:10, border:`1px solid ${T.gold}44` }}>
                <span style={{ fontSize:13, fontWeight:700, color:T.gray800 }}>Total Distribusi</span>
                <span style={{ fontSize:16, fontWeight:900, color:T.gold }}>{fmtRp(akuntansi.totalDibagi)}</span>
              </div>

              {/* Sisa laba undistributed */}
              {akuntansi.labaBersihFinal - akuntansi.pihakList.filter(p=>p.basis==="laba").reduce((s,p)=>s+p.nominal,0) > 0 && (
                <div style={{ marginTop:8, padding:"8px 14px", background:T.gray50, borderRadius:8, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                  <span style={{ color:T.gray600 }}>Laba tersisa (belum dibagi)</span>
                  <span style={{ fontWeight:700, color:T.gray800 }}>
                    {fmtRp(akuntansi.labaBersihFinal - akuntansi.pihakList.filter(p=>p.basis==="laba").reduce((s,p)=>s+p.nominal,0))}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Detail Per Produk */}
      {showDetail && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🧴 Kontribusi Per Produk — {PERIODE_LABELS[periodeMode]}</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                  {["Produk","Harga Jual","Terjual","Revenue","% dari Total","Kontribusi Laba"].map(h=>(
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {produkStats.map((p,i) => {
                  const terjual = revPeriode.rows.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0);
                  const rev = terjual * (p.harga||0);
                  const pctDariTotal = akuntansi.pendapatan > 0 ? (rev/akuntansi.pendapatan*100).toFixed(1) : "0";
                  const labaKontribusi = rev * (akuntansi.marginPct/100);
                  return (
                    <tr key={p.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                      <td style={{ padding:"10px 14px", fontWeight:700 }}>{p.nama}</td>
                      <td style={{ padding:"10px 14px", color:T.gray600 }}>{fmtRp(p.harga||0)}</td>
                      <td style={{ padding:"10px 14px", fontWeight:700 }}>{fmt(terjual)} pcs</td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:T.green }}>{fmtRp(rev)}</td>
                      <td style={{ padding:"10px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:60, height:6, background:T.gray100, borderRadius:99, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pctDariTotal}%`, background:T.green, borderRadius:99 }} />
                          </div>
                          <span style={{ fontSize:12 }}>{pctDariTotal}%</span>
                        </div>
                      </td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:T.teal }}>{fmtRp(labaKontribusi)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:T.greenLt, borderTop:`2px solid ${T.green}` }}>
                  <td colSpan={2} style={{ padding:"10px 14px", fontWeight:700, fontSize:13 }}>TOTAL</td>
                  <td style={{ padding:"10px 14px", fontWeight:800 }}>{fmt(revPeriode.terjualTotal)} pcs</td>
                  <td style={{ padding:"10px 14px", fontWeight:800, color:T.green }}>{fmtRp(akuntansi.pendapatan)}</td>
                  <td style={{ padding:"10px 14px", fontWeight:700 }}>100%</td>
                  <td style={{ padding:"10px 14px", fontWeight:800, color:T.teal }}>{fmtRp(akuntansi.labaBersihFinal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Analisis Tren Bulanan — Line chart sederhana */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📊 Tren Revenue & Laba (12 Bulan Terakhir)</div>
        {(() => {
          const months = [];
          const now = new Date();
          for (let i=11; i>=0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            const key = d.toISOString().slice(0,7);
            const label = d.toLocaleDateString("id-ID", { month:"short", year:"2-digit" });
            const rows = kontrol.filter(k=>k.tanggal?.startsWith(key));
            const rev = rows.reduce((s,k)=>s+k.totalRev,0);
            months.push({ key, label, rev, laba: rev*(akuntansi.marginPct/100) });
          }
          const maxRev = Math.max(...months.map(m=>m.rev), 1);
          return (
            <div style={{ overflowX:"auto" }}>
              <div style={{ display:"flex", alignItems:"flex-end", gap:8, minWidth:600, height:120, padding:"0 4px" }}>
                {months.map((m,i)=>(
                  <div key={m.key} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                    <div style={{ fontSize:10, color:T.green, fontWeight:700 }}>
                      {m.rev > 0 ? fmtRp(m.rev).replace("Rp ","") : ""}
                    </div>
                    <div style={{ width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:80 }}>
                      <div style={{ flex:1, height:`${(m.rev/maxRev*100)||1}%`, background:T.green,
                        borderRadius:"4px 4px 0 0", transition:"height .5s", minHeight:3 }}
                        title={`Revenue: ${fmtRp(m.rev)}`} />
                      <div style={{ flex:1, height:`${(m.laba/maxRev*100)||1}%`, background:T.teal,
                        borderRadius:"4px 4px 0 0", transition:"height .5s", minHeight:3 }}
                        title={`Laba: ${fmtRp(m.laba)}`} />
                    </div>
                    <div style={{ fontSize:9, color:T.gray400, textAlign:"center", lineHeight:1.2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:16, marginTop:10, justifyContent:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:14, height:10, background:T.green, borderRadius:3 }} />
                  <span style={{ fontSize:11, color:T.gray600 }}>Revenue</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:14, height:10, background:T.teal, borderRadius:3 }} />
                  <span style={{ fontSize:11, color:T.gray600 }}>Laba Bersih</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Card>

      {/* Modal Konfigurasi Bagi Hasil */}
      {editConfig && (
        <Modal title="⚙️ Konfigurasi Bagi Hasil & Biaya" onClose={()=>setEditConfig(false)} width={520}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              📊 Asumsi Margin Laba
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Margin Laba Bersih (%)</label>
                <input type="number" value={cfgDraft.marginLaba||70} min={0} max={100}
                  onChange={e=>setCfgDraft(p=>({...p, marginLaba:e.target.value}))}
                  style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
              </div>
              <div style={{ flex:1, padding:"8px 12px", background:T.greenLt, borderRadius:8, fontSize:12 }}>
                <div style={{ color:T.green, fontWeight:600 }}>Laba dari Revenue:</div>
                <div style={{ fontSize:16, fontWeight:800, color:T.green }}>
                  {fmtRp(revPeriode.rev * ((cfgDraft.marginLaba||70)/100))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              💸 Beban Usaha (Nominal Tetap)
            </div>
            {[
              { key:"biayaOperasional", label:"Biaya Operasional (Rp)" },
              { key:"biayaBonus",       label:"Biaya Bonus Produk (Rp)" },
              { key:"biayaLogistik",    label:"Biaya Logistik/Distribusi (Rp)" },
              { key:"biayaLainnya",     label:"Biaya Lainnya (Rp)" },
            ].map(b=>(
              <div key={b.key} style={{ marginBottom:10 }}>
                <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>{b.label}</label>
                <input type="number" value={cfgDraft[b.key]||0} min={0}
                  onChange={e=>setCfgDraft(p=>({...p, [b.key]:e.target.value}))}
                  style={{ width:"100%", padding:"7px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setEditConfig(false)}>Batal</Btn>
            <Btn onClick={submitConfig}>💾 Simpan Konfigurasi</Btn>
          </div>
        </Modal>
      )}

      {/* Modal Tambah/Edit Pihak */}
      {modalPihak && (
        <Modal title={modalPihak==="add"?"Tambah Pihak Bagi Hasil":"Edit Pihak Bagi Hasil"} onClose={()=>setModalPihak(null)} width={440}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Nama Pihak *</label>
            <input value={formPihak.nama||""} onChange={e=>setFormPihak(p=>({...p,nama:e.target.value}))}
              placeholder="cth: Pemilik, Investor, Manajer..."
              style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Persentase (%)</label>
              <input type="number" value={formPihak.pct||0} min={0} max={100}
                onChange={e=>setFormPihak(p=>({...p,pct:e.target.value}))}
                style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Basis Perhitungan</label>
              <select value={formPihak.basis||"laba"} onChange={e=>setFormPihak(p=>({...p,basis:e.target.value}))}
                style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit" }}>
                <option value="laba">Dari Laba Bersih</option>
                <option value="revenue">Dari Total Revenue</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Keterangan</label>
            <input value={formPihak.keterangan||""} onChange={e=>setFormPihak(p=>({...p,keterangan:e.target.value}))}
              placeholder="cth: Return on investment, bonus kinerja..."
              style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Warna Identitas</label>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="color" value={formPihak.warna||"#4B5563"} onChange={e=>setFormPihak(p=>({...p,warna:e.target.value}))}
                style={{ width:40, height:36, border:"none", borderRadius:8, cursor:"pointer", padding:2 }} />
              <span style={{ fontSize:12, color:T.gray600 }}>Pilih warna untuk identifikasi visual pihak ini</span>
            </div>
          </div>
          {/* Preview nominal */}
          <div style={{ background:T.goldLt, borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:13 }}>
            <div style={{ color:T.gray600 }}>Preview nominal ({formPihak.pct}% dari {formPihak.basis==="laba"?"laba bersih":"revenue"}):</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.gold }}>
              {fmtRp((formPihak.basis==="laba" ? akuntansi.labaBersihFinal : akuntansi.pendapatan) * ((Number(formPihak.pct)||0)/100))}
            </div>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setModalPihak(null)}>Batal</Btn>
            <Btn onClick={submitPihak}>{modalPihak==="add"?"Tambah":"Simpan"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB PENGGUNA
// ─────────────────────────────────────────────
function TabPengguna({ db, addRecord, updateRecord, deleteRecord, isEmergencyAdmin, listDeletedUsers, restoreDeletedUser, activeUsers }) {
  // Set email (huruf kecil) yang punya minimal satu sesi aktif — dipakai
  // untuk badge "🟢 Online" per baris pengguna di tabel bawah.
  const activeEmailSet = new Set((activeUsers||[]).map(a => a.email?.toLowerCase()).filter(Boolean));
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", email:"", role:"Viewer", wilayahId:"" });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const ROLE_C = { Admin:T.red, Manajer:T.purple, Sales:T.green, Viewer:T.gray600 };

  // Daftar email yang sedang diblokir (pernah dihapus admin sehingga tidak
  // auto-register lagi). Dimuat sekali saat modal dibuka, dan setiap kali
  // ada perubahan (pulihkan), supaya daftar tetap akurat.
  const [showBlocked, setShowBlocked] = useState(false);
  const [blockedList, setBlockedList] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(false);

  async function muatBlockedList() {
    setBlockedLoading(true);
    const list = await listDeletedUsers();
    setBlockedList(list);
    setBlockedLoading(false);
  }

  function openBlockedModal() {
    setShowBlocked(true);
    muatBlockedList();
  }

  function pulihkanEmail(key) {
    restoreDeletedUser(key);
    setBlockedList(prev => prev.filter(b => b.key !== key));
  }

  const jumlahAdmin = (db.pengguna||[]).filter(p => p.role === "Admin").length;

  function openAdd() { setForm({ nama:"", email:"", role:"Viewer", wilayahId:"" }); setModal("add"); }
  function openEdit(row) {
    // SUPER ADMIN: baris ini terkunci total dari UI — tidak ada Admin lain
    // (atau siapapun) yang bisa mengubah role/email-nya lewat tab Pengguna.
    if (isSuperAdminEmail(row.email) && row.id === SUPER_ADMIN_CANONICAL_ID) {
      alert("Akun ini adalah Super Admin tetap dan tidak bisa diubah lewat tab Pengguna.");
      return;
    }
    setForm({ ...row });
    setModal("edit");
  }
  function submit() {
    if (!form.nama || !form.email) return alert("Nama & Email wajib diisi");
    const emailBaru = form.email.trim().toLowerCase();

    // CEGAH EMAIL DUPLIKAT: pastikan tidak ada baris LAIN dengan email yang
    // sama (case-insensitive), baik saat menambah maupun mengedit.
    const emailSudahDipakai = (db.pengguna||[]).some(p =>
      p.email?.trim().toLowerCase() === emailBaru && p.id !== form.id
    );
    if (emailSudahDipakai) {
      return alert("Email ini sudah terdaftar untuk pengguna lain. Gunakan email yang berbeda, atau edit baris pengguna yang sudah ada.");
    }

    // Tidak boleh membuat/mengubah baris manapun menjadi email Super Admin —
    // baris Super Admin hanya dikelola lewat auto-register & konstanta
    // SUPER_ADMIN_EMAIL di kode, bukan lewat form ini.
    if (isSuperAdminEmail(emailBaru) && !(modal === "edit" && isSuperAdminEmail((db.pengguna||[]).find(p=>p.id===form.id)?.email))) {
      return alert("Email ini terdaftar sebagai Super Admin sistem dan tidak bisa didaftarkan manual lewat sini.");
    }

    // Cegah admin terakhir diturunkan rolenya sendiri lewat form edit,
    // supaya sistem tidak pernah kehilangan akses Admin sama sekali.
    if (modal === "edit") {
      const existing = (db.pengguna||[]).find(p => p.id === form.id);
      const sedangMenurunkanAdminTerakhir =
        existing?.role === "Admin" && form.role !== "Admin" && jumlahAdmin <= 1;
      if (sedangMenurunkanAdminTerakhir) {
        return alert("Tidak bisa mengubah role Admin terakhir. Tambahkan Admin lain dahulu sebelum menurunkan role ini.");
      }
    }
    if (modal==="add") addRecord("pengguna", { ...form, id:genUniqueId("U") });
    else updateRecord("pengguna", form.id, form);
    setModal(null);
  }
  function hapusPengguna(id) {
    const row = (db.pengguna||[]).find(p => p.id === id);
    if (isSuperAdminEmail(row?.email) && row?.id === SUPER_ADMIN_CANONICAL_ID) {
      alert("Akun Super Admin tidak bisa dihapus.");
      return;
    }
    if (row?.role === "Admin" && jumlahAdmin <= 1) {
      alert("Tidak bisa menghapus Admin terakhir. Tambahkan Admin lain dahulu.");
      return;
    }
    deleteRecord("pengguna", id);
  }

  const wilayahOpts = [{ value:"", label:"Semua Wilayah" }, ...(db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }))];

  const cols = [
    { key:"id",    label:"ID",    render:v=><code style={{ fontSize:11 }}>{v}</code> },
    { key:"nama",  label:"Nama",  render:(v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>
          {activeEmailSet.has(row?.email?.toLowerCase()) && (
            <span title="Sedang aktif" style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, color:"#16A34A", background:"#DCFCE7", borderRadius:99, padding:"1px 7px" }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#22C55E" }} /> Online
            </span>
          )}
        </span>
      ) },
    { key:"email", label:"Email", render:v=><span style={{ color:T.blue }}>{v}</span> },
    { key:"role",  label:"Role",  render:(v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Badge color={ROLE_C[v]||T.gray600}>{v}</Badge>
          {isSuperAdminEmail(row?.email) && <Badge color={T.gold}>👑 Super Admin</Badge>}
        </span>
      ) },
    { key:"wilayahId", label:"Wilayah", render:v=>v?<Badge color={T.green}>{(db.wilayah||[]).find(w=>w.id===v)?.nama||v}</Badge>:<span style={{ color:T.gray400 }}>Semua</span> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>👤 Manajemen Pengguna</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.pengguna||[]).length} pengguna terdaftar</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={db.pengguna||[]} columns={cols} title="Data Pengguna" filename="pengguna" />
          <Btn variant="secondary" onClick={openBlockedModal} icon="🚫">Email Diblokir</Btn>
          <Btn onClick={openAdd} icon="＋">Tambah Pengguna</Btn>
        </div>
      </div>
      {isEmergencyAdmin && (
        <div style={{ background:T.redLt, border:`1.5px solid #FCA5A5`, borderRadius:10, padding:"12px 16px",
          marginBottom:16, fontSize:13, color:T.red, lineHeight:1.6, fontWeight:600 }}>
          🚨 Sistem mendeteksi tidak ada satupun pengguna dengan role <b>Admin</b> di database — Anda
          diberi akses Admin <b>sementara</b> agar bisa memperbaiki ini. Segera ubah role akun Anda
          (atau pengguna lain yang tepat) kembali menjadi <b>Admin</b> di tabel di bawah, supaya akses
          Admin permanen tidak hilang lagi.
        </div>
      )}
      <div style={{ background:T.blueLt, border:`1px solid #BFDBFE`, borderRadius:10, padding:"10px 14px",
        marginBottom:16, fontSize:12, color:T.gray600, lineHeight:1.6 }}>
        ℹ️ Akun Google baru yang login langsung muncul otomatis di tabel di bawah dengan role <b>Viewer</b> —
        tidak perlu input manual nama/email. Viewer hanya bisa <b>melihat</b> data (tab Dashboard, Kontrol, Rekap),
        tidak bisa mengubah apa pun. Admin atau Manajer cukup ubah role-nya (Admin/Manajer/Sales/Viewer)
        lewat tombol edit jika perlu memberi akses input data. Tab ini (Pengguna) khusus untuk <b>Admin</b>,
        dan akun <b>Super Admin</b> tetap (👑) tidak bisa diubah/dihapus siapapun lewat tab ini.
      </div>
      <Card padding={0}>
        <Table columns={cols} data={db.pengguna||[]} onEdit={openEdit}
          onDelete={hapusPengguna} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Pengguna":"Edit Pengguna"} onClose={()=>setModal(null)}>
          <Input label="Nama Lengkap" value={form.nama} onChange={v=>f("nama",v)} required />
          <Input label="Email" value={form.email} onChange={v=>f("email",v)} type="email" required />
          <Input label="Role" value={form.role} onChange={v=>f("role",v)}
            options={["Admin","Manajer","Sales","Viewer"].map(r=>({ value:r, label:r }))} />
          <Input label="Wilayah Tugas" value={form.wilayahId} onChange={v=>f("wilayahId",v)} options={wilayahOpts} />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
      {showBlocked && (
        <Modal title="🚫 Email Diblokir" onClose={()=>setShowBlocked(false)} width={560}>
          <div style={{ fontSize:12, color:T.gray600, lineHeight:1.6, marginBottom:16 }}>
            Email di bawah ini pernah dihapus dari tabel Pengguna, sehingga <b>tidak akan
            otomatis terdaftar ulang</b> walaupun pemiliknya login kembali dengan akun
            Google yang sama. Klik <b>Pulihkan</b> untuk mengizinkan email tersebut
            kembali ter-auto-register (sebagai role Viewer) saat login berikutnya.
          </div>
          {blockedLoading ? (
            <div style={{ textAlign:"center", padding:24, color:T.gray400, fontSize:13 }}>Memuat…</div>
          ) : blockedList.length === 0 ? (
            <div style={{ textAlign:"center", padding:24, color:T.gray400, fontSize:13 }}>
              Tidak ada email yang diblokir saat ini.
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {blockedList.map(b => (
                <div key={b.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  background:T.gray50, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"10px 14px" }}>
                  <span style={{ fontSize:13, color:T.gray800, wordBreak:"break-all" }}>{b.email}</span>
                  <Btn size="sm" variant="secondary" onClick={()=>pulihkanEmail(b.key)}>Pulihkan</Btn>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
            <Btn variant="secondary" onClick={()=>setShowBlocked(false)}>Tutup</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  LOGIN PAGE
// ─────────────────────────────────────────────
function LoginPage({ onLoginGoogle, fbReady, error }) {
  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 60%, #0A3526 100%)`,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" }}>
      <div style={{ background:T.white, borderRadius:20, padding:"40px 36px", maxWidth:400, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)", textAlign:"center" }}>
        
        {/* Logo */}
        <img src={GWG_LOGO_B64} alt="GWG Logo"
          style={{ width:90, height:90, borderRadius:"50%", objectFit:"contain",
            background:T.greenLt, padding:8, marginBottom:20, border:`3px solid ${T.greenMid}` }} />

        <h1 style={{ fontSize:22, fontWeight:800, color:T.green, margin:"0 0 4px" }}>
          Generasi Wangi Group
        </h1>
        <p style={{ fontSize:13, color:T.gray400, marginBottom:32, letterSpacing:"0.06em", textTransform:"uppercase" }}>
          Super App · Manajemen Konsinyasi
        </p>

        {!FIREBASE_CONFIGURED ? (
          /* Firebase belum dikonfigurasi → tampilkan pesan setup */
          <div style={{ padding:"16px", background:T.yellowLt, borderRadius:12,
            border:`1px solid #FDE047`, textAlign:"left" }}>
            <p style={{ fontSize:14, fontWeight:700, color:T.yellow, margin:"0 0 8px" }}>
              ⚠️ Firebase Belum Dikonfigurasi
            </p>
            <p style={{ fontSize:12, color:T.gray600, margin:0, lineHeight:1.6 }}>
              Untuk mengaktifkan login, buka file <code>GWG_SuperApp.jsx</code> dan isi
              <code> FIREBASE_CONFIG</code> dengan konfigurasi proyek Firebase Anda.<br/><br/>
              <b>Langkah:</b> Firebase Console → Project Settings → Web App → SDK Config
            </p>
          </div>
        ) : fbReady ? (
          /* Firebase siap → tampilkan tombol login */
          <>
            <button onClick={onLoginGoogle}
              style={{ width:"100%", padding:"13px 24px", borderRadius:12, border:`1px solid ${T.gray200}`,
                background:T.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                gap:12, fontSize:15, fontWeight:600, color:T.gray800, fontFamily:"inherit",
                boxShadow:"0 2px 8px rgba(0,0,0,.08)", transition:"all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.background=T.gray50; e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.background=T.white; e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.08)"; }}>
              {/* Google icon SVG */}
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Masuk dengan Google
            </button>

            {error && (
              <div style={{ marginTop:16, padding:"10px 16px", background:T.redLt, borderRadius:8,
                fontSize:13, color:T.red, border:`1px solid #FCA5A5` }}>
                ⚠️ {error}
              </div>
            )}

            <p style={{ fontSize:12, color:T.gray400, marginTop:20 }}>
              Hanya akun Google yang terdaftar dapat mengakses aplikasi ini.<br/>
              Akun baru otomatis masuk sebagai <b>Sales</b>; Admin/Manajer dapat
              mengubah role di tab <b>Pengguna</b>.
            </p>
          </>
        ) : (
          /* Firebase dikonfigurasi tapi sedang loading */
          <div style={{ padding:"20px 0" }}>
            <div style={{ width:40, height:40, border:`3px solid ${T.green}`, borderTopColor:"transparent",
              borderRadius:"50%", margin:"0 auto 16px", animation:"spin 1s linear infinite" }} />
            <p style={{ color:T.gray600, fontSize:14 }}>Memuat sistem autentikasi...</p>
          </div>
        )}

        <div style={{ marginTop:32, paddingTop:20, borderTop:`1px solid ${T.gray100}`,
          fontSize:11, color:T.gray400 }}>
          © {new Date().getFullYear()} Generasi Wangi Group · Sampang, Jawa Timur
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// Tab yang boleh diakses oleh role Sales (terbatas: hanya operasional harian).
// Admin & Manajer otomatis bisa mengakses SEMUA tab (lihat fungsi canAccessTab).
const SALES_ALLOWED_TABS = ["dashboard", "kontrol", "rekap", "toko"];

const TABS = [
  { key:"dashboard",  label:"📈 Dashboard" },
  { key:"wilayah",    label:"📍 Wilayah" },
  { key:"rute",       label:"🛣️ Rute" },
  { key:"toko",       label:"🏪 Toko" },
  { key:"produk",     label:"🧴 Produk" },
  { key:"kontrol",    label:"📋 Kontrol" },
  { key:"rekap",      label:"📑 Rekap" },
  { key:"bagihasil",  label:"💰 Bagi Hasil" },
  { key:"pengguna",   label:"👤 Pengguna" },
];

// Aturan akses tab berdasarkan role:
// - Admin & Manajer  → semua tab (termasuk Pengguna untuk Admin, lihat pengecualian di bawah)
// - Sales & lainnya  → hanya tab di SALES_ALLOWED_TABS, dan tab "pengguna" tidak pernah terlihat kecuali Admin
function canAccessTab(tabKey, { isAdmin, isManajer }) {
  if (tabKey === "pengguna") return isAdmin; // Pengguna selalu khusus Admin
  if (tabKey === "bagihasil") return isManajer; // Bagi Hasil hanya Admin & Manajer
  if (isManajer) return true; // Admin & Manajer bebas akses tab lain
  return SALES_ALLOWED_TABS.includes(tabKey); // Sales/Viewer/lainnya: dibatasi
}

export default function GWGSuperApp() {
  // Tombol refresh manual — versi PWA/browser punya gesture "tarik ke bawah
  // untuk refresh" bawaan Chrome, tapi WebView native (APK) tidak punya ini
  // sama sekali. Data sebenarnya sudah live-sync lewat Firebase real-time
  // listener, tapi kalau koneksi sempat putus-nyambung (sinyal lemah) dan
  // listener-nya tidak reconnect otomatis, tombol ini jadi jalan pintas
  // "muat ulang total" — setara reload halaman di browser.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return; // di web/PWA tidak perlu, sudah ada gesture bawaan
    if (document.getElementById("gwg-native-refresh-btn")) return;
    const btn = document.createElement("button");
    btn.id = "gwg-native-refresh-btn";
    btn.innerHTML = "&#8635;";
    btn.setAttribute("aria-label", "Muat ulang");
    Object.assign(btn.style, {
      position: "fixed", bottom: "20px", right: "16px", zIndex: "99999",
      width: "48px", height: "48px", borderRadius: "50%", border: "none",
      background: "#16a34a", color: "#fff", fontSize: "22px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex",
      alignItems: "center", justifyContent: "center",
    });
    btn.onclick = () => window.location.reload();
    document.body.appendChild(btn);
    return () => { btn.remove(); };
  }, []);

  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetStep, setResetStep] = useState(1); // 1 = alasan, 2 = konfirmasi ketik
  const [resetAlasan, setResetAlasan] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [backupList, setBackupList] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCloudMsg, setBackupCloudMsg] = useState(null); // { ok, message } — hasil klik "Simpan Snapshot ke Cloud"
  const [restoring, setRestoring] = useState(false); // true selama proses tulis restore berjalan (cegah klik ganda + kasih indikator)
  const [restoreTarget, setRestoreTarget] = useState(null); // snapshot yang mau direstore (perlu konfirmasi)
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreFileError, setRestoreFileError] = useState(""); // error saat baca file backup lokal/Drive
  const restoreFileRef = useRef(null);
  const [migrating, setMigrating] = useState(false); // migrasi struktur kontrol → partisi tahun sedang berjalan
  const [migrationResult, setMigrationResult] = useState(null); // { ok, message } hasil migrasi terakhir
  const [migrateConfirmText, setMigrateConfirmText] = useState("");
  const [archivingYear, setArchivingYear] = useState(null); // tahun yang sedang diproses arsip
  const [archiveMsg, setArchiveMsg] = useState(null); // { ok, message } hasil aksi arsip terakhir
  const [viewArchiveYear, setViewArchiveYear] = useState(null); // tahun yang sedang dibuka untuk dilihat (modal)
  const [viewArchiveData, setViewArchiveData] = useState(null); // { records, archivedAt, recordCount } | "loading" | null
  const [exportingArchiveYear, setExportingArchiveYear] = useState(null);
  const [deleteArchiveConfirmYear, setDeleteArchiveConfirmYear] = useState(null);
  const [deleteArchiveConfirmText, setDeleteArchiveConfirmText] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showActiveUsers, setShowActiveUsers] = useState(false);
  // Ref tombol "Pengguna Aktif" + posisi panel yang selalu di-clamp di dalam
  // viewport (pakai hook yang sama dengan HeaderMenu) supaya di HP tidak
  // pernah terpotong/keluar layar di sisi kiri seperti sebelumnya.
  const activeUsersRef = useRef(null);
  const activeUsersMenuStyle = useClampedMenuPosition(showActiveUsers, activeUsersRef, 260);
  useEffect(() => {
    const handler = (e) => { if (activeUsersRef.current && !activeUsersRef.current.contains(e.target)) setShowActiveUsers(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  // Header dibuat position:fixed (bukan sticky) supaya BENAR-BENAR diam di
  // atas layar walau di-scroll, apa pun konteks scroll container tempat app
  // ini di-embed (sticky bisa gagal kalau parent punya overflow sendiri).
  // Tinggi header diukur otomatis (beda-beda di mobile vs desktop) lalu
  // dipakai sebagai spacer supaya konten di bawahnya tidak ketutupan.
  //
  // Diukur berkali-kali (bukan cuma sekali saat mount) karena tinggi header
  // bisa berubah SETELAH render pertama akibat hal-hal yang di luar kendali
  // urutan render React: font web yang baru selesai dimuat, foto profil
  // Google (user.photoURL) yang baru selesai di-fetch dari jaringan, atau
  // address bar browser HP yang muncul/hilang saat discroll. ResizeObserver
  // menangani perubahan susulan secara real-time, sedangkan beberapa
  // pengukuran ulang di awal (rAF + timeout bertahap) menutup celah race
  // condition sebelum ResizeObserver sempat terpasang/bereaksi. Ditambah
  // buffer +4px supaya tidak pernah kurang 1px pun (konten tidak akan
  // pernah ketutupan/terpotong walau ada pembulatan sub-pixel).
  // Header dibuat position:fixed (bukan sticky) supaya BENAR-BENAR diam di
  // atas layar walau di-scroll, apa pun konteks scroll container tempat app
  // ini di-embed (sticky bisa gagal kalau parent punya overflow sendiri).
  // Tinggi header diukur otomatis (beda-beda di mobile vs desktop) lalu
  // dipakai sebagai spacer supaya konten di bawahnya tidak ketutupan.
  //
  // PENTING: pakai CALLBACK REF (bukan useRef + useLayoutEffect ber-deps [])
  // karena komponen ini punya beberapa "return" bersyarat SEBELUM header-nya
  // dirender (saat masih loading, dan saat user belum login — lihat
  // `if (loading) return ...` dan `if (!user) return <LoginPage/>` di bawah).
  // Kalau pakai useRef biasa, effect ber-deps [] akan telanjur jalan sekali
  // pada mount PERTAMA (saat itu header belum ada di DOM sama sekali karena
  // masih loading/login), lalu tidak akan pernah jalan lagi setelah header
  // beneran muncul — akibatnya tinggi header nyangkut di 0 dan header jadi
  // menutupi seluruh konten dari atas. Callback ref memicu ulang effect
  // pengukuran persis saat elemen header benar-benar mount ke DOM, jadi bug
  // ini tidak bisa terjadi lagi.
  const [headerEl, setHeaderEl] = useState(null);
  const headerRef = useCallback((node) => setHeaderEl(node), []);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [spacerReady, setSpacerReady] = useState(false);
  useLayoutEffect(() => {
    const el = headerEl;
    if (!el) return;
    const measure = () => setHeaderHeight(Math.ceil(el.getBoundingClientRect().height) + 4);
    measure();
    const raf1 = requestAnimationFrame(() => { measure(); requestAnimationFrame(measure); });
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 500);
    const t3 = setTimeout(() => { measure(); setSpacerReady(true); }, 700);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(()=>{});
    window.addEventListener("load", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
      cancelAnimationFrame(raf1);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    };
  }, [headerEl]);
  // Header dibuat PERMANEN diam di atas (freeze), persis seperti header di
  // halaman chat ini — tidak lagi sembunyi/muncul otomatis saat di-scroll
  // (pendekatan itu dilepas karena walau sudah dikasih hysteresis + debounce,
  // tetap terasa jitter/kedip saat digeser bolak-balik pelan, mis. lagi cari
  // data). Konten di bawahnya tetap dijamin tidak ketutupan lewat spacer
  // yang tingginya diukur otomatis dari header asli (lihat penjelasan di
  // atas headerRef/headerHeight).
  const { user, loading, fbReady, loginGoogle, logout } = useAuth();
  const { db, addRecord: rawAddRecord, updateRecord: rawUpdateRecord, deleteRecord: rawDeleteRecord, resetDB: rawResetDB, save: rawSave, syncing, lastSync, syncError, pendingSync, cloudLoaded, backupNow, listBackups, restoreBackup, deletedUsersRef, listDeletedUsers, restoreDeletedUser, loadedKontrolYears, availableKontrolYears, loadKontrolYear, runKontrolYearMigration, archivedKontrolYears, archiveKontrolYear, viewArchivedKontrolYear, exportArchivedKontrolYear, deleteArchivedKontrolYear } = useDB(user);
  const analytics = useAnalytics(db);

  // ── Mobile-friendly: pastikan viewport meta tag benar agar tampilan tidak
  // ter-zoom-out/kepotong saat dibuka dari HP (banyak host page lupa setting ini).
  useEffect(() => {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    vp.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
  }, []);

  // ── Mobile-friendly: pasang sekali class CSS responsif global, dipakai
  // oleh header, tab nav, dan grid form 2-kolom di seluruh aplikasi supaya
  // otomatis menumpuk jadi 1 kolom di layar HP (≤640px) tanpa perlu
  // menulis ulang setiap form satu per satu.
  useEffect(() => {
    if (document.getElementById("gw-responsive-style")) return;
    const style = document.createElement("style");
    style.id = "gw-responsive-style";
    style.textContent = `
      * { box-sizing: border-box; }
      /* Cegah scroll horizontal "hantu" di HP — kalau ada elemen (mis. panel
         dropdown) yang secara tak sengaja melebar keluar viewport, ini
         memastikan halaman tetap tidak bisa digeser ke samping sehingga
         kontennya tidak pernah terpotong/hilang di sisi kiri layar. */
      html, body { max-width: 100vw; overflow-x: hidden; }

      /* Header dibuat "cair" (fluid) memakai clamp() supaya ukurannya
         menyesuaikan lebar layar secara halus/dinamis, bukan cuma loncat
         di titik-titik breakpoint tetap. */
      .gw-header-top { flex-wrap: wrap; row-gap: 10px; column-gap: 10px; }
      .gw-header-actions { flex-wrap: wrap; justify-content: flex-end; align-items: center; row-gap: 6px; column-gap: 6px; }
      .gw-header-logo { width: clamp(32px, 9vw, 46px) !important; height: clamp(32px, 9vw, 46px) !important; }
      .gw-header-title { font-size: clamp(15px, 4vw, 20px) !important; }
      .gw-header-revenue { padding: clamp(4px, 1.2vw, 6px) clamp(8px, 2.5vw, 14px) !important; font-size: clamp(10.5px, 2.6vw, 12px) !important; }
      .gw-header-activeusers button { padding: clamp(4px, 1.2vw, 6px) clamp(8px, 2.5vw, 12px) !important; font-size: clamp(10.5px, 2.6vw, 12px) !important; }

      @media (max-width: 640px) {
        .gw-header-top { padding-top: 10px !important; padding-bottom: 10px !important; }
        .gw-header-subtitle { display: none; }
        .gw-grid2, .gw-grid3 { grid-template-columns: 1fr !important; }
        .gw-dash-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
        .gw-statcard { padding: 12px !important; }
        .gw-statcard-value { font-size: 19px !important; }
        .gw-statcard-label { font-size: 9.5px !important; }
        .gw-modal-body { padding: 16px !important; }
        .gw-modal-header { padding: 14px 16px !important; }
        .gw-content { padding: 14px 10px !important; }
        table { font-size: 11px !important; }
      }
      @media (max-width: 400px) {
        .gw-hide-xs { display: none !important; }
        .gw-dash-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 6px !important; }
        .gw-statcard { padding: 10px !important; }
        .gw-statcard-value { font-size: 17px !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);


  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = GWG_LOGO_B64;
    link.type = "image/png";
  }, []);

  // Buka modal backup & langsung muat daftar backup cloud (kalau ada)
  const openBackupModal = useCallback(async () => {
    setShowBackup(true);
    setBackupLoading(true);
    try { setBackupList(await listBackups()); } catch { setBackupList([]); }
    setBackupLoading(false);
  }, [listBackups]);

  // ── PULIHKAN DARI FILE BACKUP (.json) ────────────────────────────────────
  // Menangani 2 sumber file yang sebelumnya TIDAK BISA dipulihkan langsung
  // dari dalam aplikasi: (1) file .json yang diunduh ke perangkat lewat
  // tombol "Unduh Backup Sekarang" / "Backup Cepat", dan (2) file yang
  // sebelumnya diunggah ke Google Drive lalu diunduh ulang oleh user (karena
  // Drive API tidak menyediakan restore langsung tanpa Google Picker). Kedua
  // sumber ini formatnya sama-sama file JSON, jadi cukup satu tombol upload
  // file untuk menangani keduanya — tidak perlu integrasi Drive Picker terpisah.
  function handleRestoreFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreFileError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Terima 2 bentuk file: snapshot lengkap { ts, reason, data:{...} }
        // (hasil "Unduh Backup Sekarang"/"Backup Cepat"/"Simpan Snapshot ke Cloud"),
        // ATAU objek database mentah langsung { wilayah:[...], toko:[...], ... }.
        const looksLikeSnapshot = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object";
        const looksLikeRawDb = parsed && typeof parsed === "object" &&
          ["wilayah","rute","toko","produk","kontrol","pengguna"].some(k => Array.isArray(parsed[k]));
        if (!looksLikeSnapshot && !looksLikeRawDb) {
          setRestoreFileError("⚠️ File tidak dikenali sebagai backup GWG SuperApp yang valid (format JSON tidak sesuai).");
          return;
        }
        const snapshot = looksLikeSnapshot
          ? { key: file.name, ts: parsed.ts, reason: parsed.reason || "file-upload", data: parsed.data }
          : { key: file.name, ts: null, reason: "file-upload", data: parsed };
        // Reuse alur konfirmasi yang sama dengan restore dari Riwayat Backup Cloud
        setRestoreTarget(snapshot);
        setRestoreConfirmText("");
      } catch (err) {
        setRestoreFileError("⚠️ Gagal membaca file: " + err.message + ". Pastikan file adalah backup .json yang valid dan tidak rusak.");
      }
    };
    reader.onerror = () => setRestoreFileError("⚠️ Gagal membaca file dari perangkat.");
    reader.readAsText(file);
  }

  // ── GOOGLE DRIVE UPLOAD ─────────────────────────────────────────────────
  // Menggunakan Google Drive REST API v3 (multipart upload) dengan OAuth2
  // access token yang diperoleh dari Firebase Auth (provider Google).
  // Tidak memerlukan gapi.js / Google Identity Services terpisah —
  // token Firebase sudah cukup untuk Drive API selama scope drive.file
  // dikonfigurasi di Firebase Console → Authentication → Google provider.
  //
  // ⚠ SYARAT: Di Google Cloud Console, aktifkan "Google Drive API" untuk
  //   project Firebase Anda, dan tambahkan scope
  //   "https://www.googleapis.com/auth/drive.file" ke OAuth consent screen.
  //   Tanpa langkah ini, upload akan gagal dengan error 403/insufficientScope.
  // ────────────────────────────────────────────────────────────────────────
  const [gDriveLoading, setGDriveLoading] = useState(false);
  const [gDriveMsg, setGDriveMsg] = useState(null); // { ok: bool, text: string }

  const uploadToGDrive = useCallback(async () => {
    if (!user) { alert("Login dengan Google terlebih dahulu."); return; }
    setGDriveLoading(true);
    setGDriveMsg(null);
    try {
      const ts = new Date().toISOString();
      const filename = `gwg_backup_${ts.slice(0,19).replace(/[:T]/g,"-")}.json`;
      const fileData = await gdriveUploadJSON(
        filename,
        { ts, reason: "gdrive-manual", data: db },
        `GWG SuperApp backup - ${ts}`
      );
      const viewLink = fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`;
      setGDriveMsg({
        ok: true,
        text: `✅ Berhasil diunggah ke Google Drive! File: "${fileData.name}"`,
        link: viewLink,
      });
    } catch (e) {
      console.error("GDrive upload error:", e);
      setGDriveMsg({ ok: false, text: `❌ Gagal upload ke Google Drive: ${e.message}` });
    } finally {
      setGDriveLoading(false);
    }
  }, [user, db]);

  // Cari role user yang login berdasarkan email di tabel pengguna
  const currentUserRecord = user ? db.pengguna.find(p => p.email?.toLowerCase() === user.email?.toLowerCase()) : null;

  // Daftar pengguna yang sedang aktif (real-time, per sesi/perangkat).
  const activeUsers = usePresence(user, currentUserRecord);

  // Daftar pengguna aktif yang SUDAH DIFILTER & DIKELOMPOKKAN untuk ditampilkan:
  // 1) FILTER: sembunyikan sesi milik email yang TIDAK/TIDAK LAGI ada di tabel
  //    pengguna (misalnya sudah dihapus/diblokir Admin). Login Firebase Auth
  //    di perangkat orang itu tidak otomatis putus saat baris pengguna-nya
  //    dihapus, jadi tanpa filter ini dia tetap terlihat "aktif" selama tab
  //    browser-nya masih terbuka.
  // 2) KELOMPOKKAN: satu email yang membuka beberapa sesi/tab/perangkat
  //    digabung jadi SATU baris (dengan jumlah sesi), supaya tidak terlihat
  //    seperti "pengguna dobel" di panel — sebelumnya tiap sesi ditampilkan
  //    sebagai baris terpisah walau namanya sama persis.
  const visibleActiveUsers = useMemo(() => {
    const registeredEmails = new Set((db.pengguna||[]).map(p => p.email?.toLowerCase()).filter(Boolean));
    const grouped = new Map();
    (activeUsers||[]).forEach(au => {
      const emailKey = au.email?.toLowerCase();
      if (!emailKey || !registeredEmails.has(emailKey)) return; // pengguna sudah diblokir/dihapus, sembunyikan
      const existing = grouped.get(emailKey);
      if (existing) existing.sessionCount += 1;
      else grouped.set(emailKey, { ...au, sessionCount: 1 });
    });
    return Array.from(grouped.values());
  }, [activeUsers, db.pengguna]);

  // BOOTSTRAP ADMIN & AUTO-DAFTAR PENGGUNA BARU:
  // 1) Jika tabel pengguna masih kosong, orang yang login sekarang PERMANEN
  //    didaftarkan sebagai Admin (bukan cuma status sementara di memori).
  //    Tanpa auto-simpan ini, status Admin hanya berlaku selama tabel kosong —
  //    begitu ada baris lain (atau baris ini terhapus), tidak ada lagi cara
  //    membuat Admin baru karena semua orang jatuh ke default "Sales" dan
  //    terkunci dari tab Pengguna untuk memperbaikinya.
  // 2) Jika tabel SUDAH berisi data tapi email akun yang login belum ada di
  //    tabel pengguna sama sekali (kasus: orang lain login dari perangkat
  //    baru/akun Google baru), akun itu otomatis didaftarkan dengan role
  //    "Viewer" (role paling rendah/aman secara default — hanya bisa melihat,
  //    tidak bisa mengubah data apa pun). Dengan ini, Admin
  //    tinggal membuka tab Pengguna dan mengubah role-nya lewat tabel — tidak
  //    perlu lagi mengetik manual nama & email orang tersebut.
  const bootstrapDone = useRef(false);
  const bootstrapJadiAdmin = useRef(false); // true hanya jika bootstrap ini untuk Admin pertama (tabel kosong)
  const autoDaftarSet = useRef(new Set()); // cegah auto-daftar dobel untuk email yang sama selagi addRecord belum sinkron
  useEffect(() => {
    if (!user || !cloudLoaded) return;
    // PENTING: jangan jalankan pengecekan ini sebelum data dari Firebase (cloud)
    // benar-benar selesai diterima minimal sekali. Tanpa penundaan ini, dua
    // perangkat yang login hampir bersamaan bisa SAMA-SAMA melihat db.pengguna
    // masih kosong (karena keduanya masih memakai data lokal/awal sebelum
    // snapshot cloud turun) dan masing-masing menambahkan dirinya sendiri
    // sebagai Admin baru → muncul 2 baris Admin di satu perangkat dan baris
    // yang berbeda di perangkat lain, padahal harusnya satu data yang sama.
    if (currentUserRecord) return; // sudah terdaftar, tidak perlu apa-apa

    const tabelMasihKosong = (db.pengguna||[]).length === 0;
    const emailKey = user.email?.toLowerCase();
    if (!emailKey || autoDaftarSet.current.has(emailKey)) return;

    // CEK BLACKLIST: jika email ini sudah pernah dihapus oleh Admin,
    // JANGAN daftarkan ulang secara otomatis. Pengguna harus didaftarkan
    // manual oleh Admin. Cek dari Firebase (realtime) dan localStorage (offline).
    const encodedKey = encodeEmailKey(emailKey);
    const isDeletedInFirebase = !!(deletedUsersRef.current[encodedKey]);
    const isDeletedInLocal = (() => {
      try {
        const localDeleted = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
        return !!(localDeleted[encodedKey]);
      } catch { return false; }
    })();
    if (isDeletedInFirebase || isDeletedInLocal) return; // akun ini sudah dihapus admin, skip auto-register

    if (tabelMasihKosong && !bootstrapDone.current) {
      bootstrapDone.current = true; // cegah panggilan ganda selama addRecord belum sinkron
      bootstrapJadiAdmin.current = true;
      autoDaftarSet.current.add(emailKey);
      // PENTING: ID dibuat DETERMINISTIK dari email (bukan genUniqueId acak).
      // Kalau dua perangkat sama-sama race di sini, keduanya akan menghasilkan
      // ID yang SAMA PERSIS dan menulis ke path Firebase yang sama pula →
      // tulisan kedua hanya menimpa (overwrite) tulisan pertama, TIDAK membuat
      // baris baru. Ini yang mencegah "akun muncul 2x di tabel pengguna".
      rawAddRecord("pengguna", {
        id: "U_" + encodeEmailKey(emailKey),
        nama: user.displayName || user.email,
        email: user.email,
        role: "Admin",
        wilayahId: "",
      });
    } else if (!tabelMasihKosong) {
      // Akun baru yang belum pernah login sebelumnya → daftarkan otomatis
      // sebagai Viewer (role paling rendah, hanya bisa melihat — TIDAK bisa
      // mengubah data apa pun) supaya aman secara default. Admin yang harus
      // menaikkan role-nya secara manual lewat tab Pengguna jika perlu.
      // Kecuali jika emailnya cocok dengan SUPER_ADMIN_EMAIL → langsung Admin.
      autoDaftarSet.current.add(emailKey);
      // Sama seperti bootstrap Admin di atas: ID deterministik dari email
      // supaya race antar-perangkat menimpa path yang sama, bukan bikin
      // baris duplikat.
      rawAddRecord("pengguna", {
        id: "U_" + encodeEmailKey(emailKey),
        nama: user.displayName || user.email,
        email: user.email,
        role: isSuperAdminEmail(user.email) ? "Admin" : "Viewer",
        wilayahId: "",
      });
    }
  }, [user, db.pengguna, currentUserRecord, rawAddRecord, cloudLoaded]);

  // Selama proses penyimpanan baris Admin pertama di atas belum selesai (delay
  // sinkron Firebase/localStorage), tetap anggap pengguna ini Admin agar tidak
  // ada momen "jatuh ke Sales" sesaat sebelum baris tersimpan. Khusus untuk
  // skenario tabel kosong (Admin pertama) — BUKAN untuk akun yang auto-terdaftar
  // sebagai Viewer, supaya akun baru itu tidak salah dapat akses Admin sementara.
  const isBootstrapAdmin = (db.pengguna||[]).length === 0 || (bootstrapJadiAdmin.current && !currentUserRecord);

  // JALUR DARURAT ANTI-DEADLOCK: jika tabel pengguna SUDAH berisi data, tapi
  // TIDAK ADA satupun baris dengan role "Admin" (misalnya baris Admin pertama
  // sempat terhapus/hilang), sistem akan terkunci selamanya karena tab Pengguna
  // cuma bisa dibuka Admin — tidak ada Admin berarti tidak ada yang bisa
  // memperbaikinya lagi. Untuk mencegah hal ini, siapapun yang login saat
  // kondisi ini terjadi otomatis diberi akses Admin sementara, supaya dia bisa
  // membuka tab Pengguna dan menetapkan ulang Admin yang benar.
  const tidakAdaAdminSamaSekali = (db.pengguna||[]).length > 0 && !(db.pengguna||[]).some(p => p.role === "Admin");
  const isEmergencyAdmin = tidakAdaAdminSamaSekali;

  // PENTING: jika sistem sedang dalam kondisi darurat (bootstrap atau tidak ada
  // Admin sama sekali), status Admin sementara ini HARUS menang meskipun baris
  // pengguna ini sudah tercatat sebagai "Sales" di tabel — karena itulah skenario
  // deadlock yang sebenarnya terjadi (akun pertama sempat tercatat/jatuh jadi
  // Sales, sehingga currentUserRecord?.role akan selalu "Sales" dan tidak pernah
  // memberi kesempatan perbaikan). Role Admin/Manajer yang SUDAH tercatat tetap
  // dihormati dan tidak pernah diturunkan oleh logika ini.
  const daruratAktif = isBootstrapAdmin || isEmergencyAdmin;
  const userRole = isSuperAdminEmail(user?.email)
    ? "Admin" // SUPER ADMIN: selalu Admin, tidak peduli apa yang tercatat di tabel
    : (daruratAktif && currentUserRecord?.role !== "Admin" && currentUserRecord?.role !== "Manajer")
    ? "Admin"
    : (currentUserRecord?.role || "Viewer"); // default Viewer (paling aman) jika tidak ditemukan & tidak darurat
  const isAdmin = userRole === "Admin";
  const isManajer = userRole === "Manajer" || isAdmin;
  const isViewer = userRole === "Viewer"; // Viewer: hanya bisa melihat, tidak bisa mengubah data apa pun
  const isUserSuperAdmin = isSuperAdminEmail(user?.email);

  // GUARD VIEWER: bungkus semua fungsi penulis data supaya Viewer benar-benar
  // tidak bisa mengubah database apa pun — dicek terpusat di sini, bukan
  // cuma disembunyikan di UI, supaya tidak bisa "ditembus" lewat tab manapun.
  const tolakViewer = () => { alert("Anda login sebagai Viewer (hanya bisa melihat). Hubungi Admin untuk menaikkan akses Anda jika perlu mengubah data."); };
  const addRecord    = (...args) => { if (isViewer) return tolakViewer(); return rawAddRecord(...args); };
  const updateRecord = (...args) => { if (isViewer) return tolakViewer(); return rawUpdateRecord(...args); };
  const deleteRecord = (...args) => { if (isViewer) return tolakViewer(); return rawDeleteRecord(...args); };
  const save         = (...args) => { if (isViewer) return tolakViewer(); return rawSave(...args); };
  const resetDB       = (...args) => { if (isViewer) return tolakViewer(); return rawResetDB(...args); };

  // Jaga-jaga: jika tab yang aktif sekarang tidak boleh diakses oleh role
  // pengguna saat ini (misal role baru saja diturunkan oleh Admin, atau
  // pengguna Sales mencoba membuka URL/state tab terlarang), alihkan ke Dashboard.
  useEffect(() => {
    if (!canAccessTab(activeTab, { isAdmin, isManajer })) {
      setActiveTab("dashboard");
    }
  }, [activeTab, isAdmin, isManajer]);

  // Auto-upgrade toko "Baru" → "Aktif" setelah 30 hari sejak tanggalMasuk
  // Dijalankan sekali saat data cloud sudah selesai dimuat.
  const autoUpgradeDone = useRef(false);
  useEffect(() => {
    if (!cloudLoaded || autoUpgradeDone.current) return;
    autoUpgradeDone.current = true;
    autoUpgradeBaruToAktif(db, updateRecord);
  }, [cloudLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoginGoogle = async () => {
    setLoginError("");
    try {
      await loginGoogle();
    } catch(e) {
      setLoginError(e.message || "Login gagal");
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
        <img src={GWG_LOGO_B64} alt="GWG" style={{ width:64, height:64, borderRadius:"50%", objectFit:"contain", background:"#fff", padding:6, boxShadow:"0 4px 16px rgba(0,0,0,.1)" }} />
        <div style={{ fontSize:16, color:T.gray600, fontWeight:600 }}>Memuat Generasi Wangi Group...</div>
      </div>
    );
  }

  // Tampilkan halaman login jika user belum login
  // (baik Firebase sudah dikonfigurasi maupun belum)
  if (!user) {
    return <LoginPage onLoginGoogle={handleLoginGoogle} fbReady={fbReady} error={loginError} />;
  }

  // Semua tab navigasi + tombol Keluar + menu khusus Admin digabung jadi
  // SATU menu hamburger (☰), supaya header lebih ringkas di layar kecil.
  const mainMenuItems = [
    ...TABS.filter(t => canAccessTab(t.key, { isAdmin, isManajer })).map(t => ({
      label: t.label,
      active: activeTab === t.key,
      onClick: () => setActiveTab(t.key),
    })),
    { divider: true },
    { label: "🚪 Keluar", danger: true, onClick: logout },
    ...(isAdmin ? [
      { divider: true },
      {
        label: "💾⚡ Backup Cepat (unduh sekarang)",
        onClick: async () => {
          const result = await backupNow(db, { reason: "manual-cepat" });
          if (result?.snapshot) {
            downloadJSON(`gwg_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, result.snapshot);
          }
        },
      },
      { label: "💾 Backup & Restore", onClick: openBackupModal },
      {
        label: "⚠️ Reset Database",
        danger: true,
        onClick: () => { setShowReset(true); setResetStep(1); setResetAlasan(""); setResetConfirmText(""); },
      },
    ] : []),
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Inter',system-ui,sans-serif" }}>
      {/* HEADER — dibuat "fixed" (freeze) terhadap viewport, selalu diam di
          atas layar persis seperti header halaman chat ini. Pakai
          position:fixed (bukan sticky) supaya tetap diam walau app ini
          di-embed di dalam container dengan scroll sendiri. */}
      <div ref={headerRef} style={{ position:"fixed", top:0, left:0, right:0, zIndex:100,
          background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`, boxShadow:"0 2px 12px rgba(0,0,0,.15)" }}>
        <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 20px" }}>
          <div className="gw-header-top" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:16, paddingBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <img src={GWG_LOGO_B64} alt="GWG Logo" className="gw-header-logo"
                style={{ width:46, height:46, borderRadius:"50%", background:"#fff",
                  padding:3, boxShadow:"0 2px 8px rgba(0,0,0,.2)", objectFit:"contain" }} />
              <div>
                <div className="gw-header-title" style={{ fontSize:20, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>Generasi Wangi Group</div>
                <div className="gw-header-subtitle" style={{ fontSize:11, color:"rgba(255,255,255,.7)", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                  Super App · Sistem Manajemen Konsinyasi
                  {!isOnline ? (
                    <span style={{ marginLeft:8, background:"rgba(252,211,77,.25)", color:"#FCD34D", borderRadius:99, padding:"1px 8px", fontSize:10, fontWeight:700 }}>
                      📴 Offline{pendingSync > 0 ? ` · ${pendingSync} tersimpan` : ""}
                    </span>
                  ) : pendingSync > 0 ? (
                    <span style={{ marginLeft:8, background:"rgba(252,211,77,.25)", color:"#FCD34D", borderRadius:99, padding:"1px 8px", fontSize:10, fontWeight:700 }}>🔄 Mengirim {pendingSync} perubahan...</span>
                  ) : syncing && (
                    <span style={{ marginLeft:8, background:"rgba(255,255,255,.2)", borderRadius:99, padding:"1px 8px", fontSize:10 }}>🔄 Sinkronisasi...</span>
                  )}
                </div>
              </div>
            </div>
            <div className="gw-header-actions" style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div className="gw-header-revenue" style={{ background:"rgba(255,255,255,.12)", borderRadius:10, padding:"6px 14px", fontSize:12, color:"rgba(255,255,255,.9)", fontWeight:600, whiteSpace:"nowrap" }}>
                💰 <span className="gw-hide-xs">Rev: </span>{fmtRp(
                  (!isManajer && currentUserRecord?.wilayahId)
                    ? analytics.perWilayah.filter(w=>w.id===currentUserRecord.wilayahId).reduce((s,w)=>s+w.rev,0)
                    : analytics.totalRev
                )}
              </div>

              {/* Tombol refresh manual — pengganti "tarik ke bawah untuk
                  refresh" ala browser, yang tidak berfungsi di WebView
                  native (APK). Reload penuh halaman supaya semua listener
                  Firebase tersambung ulang dari awal, berguna terutama
                  setelah sinyal sempat putus-nyambung. */}
              <button
                onClick={() => window.location.reload()}
                title="Muat ulang / sinkronkan data"
                style={{ background:"rgba(255,255,255,.12)", border:"none", borderRadius:10,
                  width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                  color:"#fff", cursor:"pointer", fontSize:16, flexShrink:0 }}
              >🔄</button>

              {/* Panel "Pengguna Aktif" — daftar sesi/perangkat yang sedang online real-time.
                  Posisi panel dihitung dinamis via useClampedMenuPosition (position:fixed +
                  auto-clamp ke lebar viewport), jadi selalu utuh terlihat di HP dan tidak
                  pernah lagi terpotong di sisi kiri layar seperti sebelumnya. */}
              {user && (
                <div ref={activeUsersRef} className="gw-header-activeusers" style={{ position:"relative" }}>
                  <button onClick={() => setShowActiveUsers(v => !v)}
                    title="Pengguna sedang aktif"
                    style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,.12)", border:"none", borderRadius:10, padding:"6px 12px", fontSize:12, color:"#fff", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:"#22C55E", display:"inline-block", boxShadow:"0 0 0 2px rgba(255,255,255,.4)" }} />
                    🟢 {visibleActiveUsers.length}<span className="gw-hide-xs"> Aktif</span>
                  </button>
                  {showActiveUsers && activeUsersMenuStyle && (
                    <div style={{ ...activeUsersMenuStyle, background:"#fff", borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.2)", maxHeight:"60vh", overflowY:"auto", zIndex:250, padding:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:T.gray600, padding:"4px 8px", textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        Pengguna Sedang Aktif ({visibleActiveUsers.length})
                      </div>
                      {visibleActiveUsers.length === 0 ? (
                        <div style={{ fontSize:12, color:T.gray400, padding:"8px" }}>Tidak ada sesi aktif.</div>
                      ) : visibleActiveUsers.map(au => (
                        <div key={au.email} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:8, background: au.email===user.email ? T.greenLt : "transparent" }}>
                          <span style={{ width:7, height:7, borderRadius:"50%", background:"#22C55E", flexShrink:0 }} />
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:T.gray800, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {au.nama || au.email} {au.email===user.email && "(Anda)"}
                              {au.sessionCount > 1 && <span style={{ color:T.gray400, fontWeight:400 }}> · {au.sessionCount} sesi</span>}
                            </div>
                            <div style={{ fontSize:10, color:T.gray400 }}>{au.role}{isSuperAdminEmail(au.email) ? " · 👑 Super Admin" : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* User section */}
              {fbReady ? (
                user ? (
                  <div className="gw-header-userinfo" style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                    {user.photoURL && (
                      <img src={user.photoURL} alt="" style={{ width:30, height:30, borderRadius:"50%", border:"2px solid rgba(255,255,255,.4)", flexShrink:0 }} />
                    )}
                    <div style={{ fontSize:12, color:"rgba(255,255,255,.9)", fontWeight:600, minWidth:0 }}>
                      <div style={{ maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.displayName?.split(" ")[0]}</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,.6)", fontWeight:400, whiteSpace:"nowrap" }}>
                      <span className="gw-hide-xs">
                      {!isOnline ? (
                        <span style={{ color:"#FCD34D" }} title="Tidak ada koneksi internet — perubahan tersimpan di perangkat ini dan akan sinkron otomatis begitu online kembali">
                          📴 Offline{pendingSync > 0 ? ` · ${pendingSync} menunggu` : " · data lokal"}
                        </span>
                      ) : pendingSync > 0 ? (
                        <span style={{ color:"#FCD34D" }} title="Sedang mengirim perubahan yang tersimpan saat offline">🔄 Mengirim {pendingSync} perubahan...</span>
                      ) : syncError ? (
                        <span style={{ color:"#FCA5A5" }}>⚠️ Gagal sync</span>
                      ) : syncing ? (
                        <span>🔄 Sinkronisasi...</span>
                      ) : lastSync ? (
                        <span>☁️ Sinkron {lastSync.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}</span>
                      ) : (
                        <span>☁️ Terhubung</span>
                      )}
                      {" ·"}{" "}
                      </span>
                      <span style={{ background: daruratAktif ? "#DC2626" : "rgba(255,255,255,.2)", borderRadius:4, padding:"0 5px", fontWeight:700 }}>
                        {userRole}{daruratAktif && " ⚠️"}
                      </span>
                    </div>
                  </div>
                  </div>
                ) : (
                  <Btn variant="secondary" size="sm" onClick={() => loginGoogle().catch(e => alert("Login gagal: "+e.message))}
                    style={{ background:"rgba(255,255,255,.15)", color:"#fff", border:"1px solid rgba(255,255,255,.3)" }}>
                    <span style={{ fontSize:14 }}>G</span> Login Google
                  </Btn>
                )
              ) : (
                <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", padding:"6px 10px", background:"rgba(255,255,255,.08)", borderRadius:8 }}>
                  💾 Mode Lokal
                </div>
              )}

              <HeaderMenu
                icon="☰"
                title="Menu"
                items={mainMenuItems}
              />
            </div>
          </div>

          {/* Sync status banner jika Firebase belum dikonfigurasi */}
          {!FIREBASE_CONFIGURED && (
            <div style={{ background:"rgba(196,154,26,.25)", border:"1px solid rgba(196,154,26,.4)", borderRadius:8, padding:"8px 14px",
              marginBottom:12, fontSize:12, color:"#FBF3D9", display:"flex", alignItems:"center", gap:8 }}>
              ⚠️ <span><b>Mode Lokal:</b> Untuk sinkronisasi lintas perangkat, konfigurasikan Firebase di variabel <code>FIREBASE_CONFIG</code> pada file ini. Lihat instruksi di komentar atas.</span>
            </div>
          )}

        </div>
      </div>

      {/* Spacer — mengganti "ruang" yang tadinya ditempati header sebelum
          header dijadikan position:fixed, supaya konten di bawah tidak
          ketutupan/ketumpuk. Tingginya diukur otomatis dari header asli
          (+ buffer kecil) dan tetap dijaga sinkron kalau tinggi header
          berubah (rotasi layar, resize, dll — lihat efek pengukuran di atas). */}
      <div style={{ height: headerHeight, transition: spacerReady ? "height 0.28s ease" : "none" }} />

      {/* CONTENT */}
      <div className="gw-content" style={{ maxWidth:1400, margin:"0 auto", padding:"24px 20px" }}>
        {activeTab==="dashboard" && <Dashboard db={db} analytics={analytics} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} />}
        {activeTab==="wilayah"   && canAccessTab("wilayah",  { isAdmin, isManajer }) && <TabWilayah   db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />}
        {activeTab==="rute"      && canAccessTab("rute",     { isAdmin, isManajer }) && <TabRute      db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />}
        {activeTab==="toko"      && canAccessTab("toko",     { isAdmin, isManajer }) && <TabToko      db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} save={save} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} isSalesRestricted={!isManajer} />}
        {activeTab==="produk"    && canAccessTab("produk",   { isAdmin, isManajer }) && <TabProduk    db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />}
        {activeTab==="kontrol"   && canAccessTab("kontrol",  { isAdmin, isManajer }) && <TabKontrol   db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} save={save} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} />}
        {activeTab==="rekap"     && canAccessTab("rekap",    { isAdmin, isManajer }) && <TabRekap     db={db} analytics={analytics} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} />}
        {activeTab==="bagihasil" && canAccessTab("bagihasil",{ isAdmin, isManajer }) && <TabBagiHasil db={db} analytics={analytics} save={save} />}
        {activeTab==="pengguna"  && canAccessTab("pengguna", { isAdmin, isManajer }) && <TabPengguna  db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} isEmergencyAdmin={isEmergencyAdmin} listDeletedUsers={listDeletedUsers} restoreDeletedUser={restoreDeletedUser} activeUsers={visibleActiveUsers} />}
      </div>

      {/* BACKUP & RESTORE — hanya Admin (tombol disembunyikan untuk role lain) */}
      {showBackup && isAdmin && (
        <Modal title="💾 Backup & Restore Data" onClose={()=>{ setShowBackup(false); setRestoreTarget(null); setRestoreConfirmText(""); setRestoreFileError(""); setBackupCloudMsg(null); }}>
          <div style={{ padding:"4px 0 8px" }}>
            <div style={{ fontSize:13, color:T.gray400, marginBottom:16 }}>
              Sistem otomatis membuat backup 1x/hari ke cloud. Anda juga bisa membuat backup manual kapan saja, atau mengunduh salinan ke perangkat.
            </div>

            <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
              <Btn onClick={() => downloadJSON(`gwg_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, { ts:new Date().toISOString(), reason:"manual-download", data:db })}>
                ⬇️ Unduh Backup Sekarang (.json)
              </Btn>
              <Btn variant="secondary" disabled={backupLoading} onClick={async () => {
                setBackupLoading(true);
                setBackupCloudMsg(null);
                const result = await backupNow(db, { reason: "manual" });
                setBackupCloudMsg(result.cloudOk
                  ? { ok: true, message: "✅ Snapshot berhasil disimpan ke Firebase." }
                  : { ok: false, message: `⚠️ Gagal menyimpan ke cloud: ${result.cloudError || "tidak diketahui"}. Salinan lokal tetap tersimpan di perangkat ini.` });
                setBackupList(await listBackups());
                setBackupLoading(false);
              }}>
                {backupLoading ? "⏳ Menyimpan..." : "☁️ Simpan Snapshot ke Cloud (Firebase)"}
              </Btn>
              {/* ── GOOGLE DRIVE UPLOAD ── */}
              <Btn
                variant="secondary"
                disabled={gDriveLoading}
                onClick={() => { setGDriveMsg(null); uploadToGDrive(); }}
                style={{ background:"#fff", color:"#444", border:"1px solid #ddd",
                  display:"flex", alignItems:"center", gap:6, fontWeight:600,
                  opacity: gDriveLoading ? 0.7 : 1 }}
                title={user ? "Upload backup JSON ke Google Drive Anda" : "Login Google diperlukan untuk upload ke Drive"}
              >
                {/* Google Drive logo (triangle triskelion) */}
                <svg width="18" height="16" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H.1c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                  <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.3 48.05c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00AC47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8z" fill="#EA4335"/>
                  <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
                  <path d="M59.8 52.55H27.5L13.75 76.35c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684FC"/>
                  <path d="M73.4 26.05l-12.65-21.9c-.15-.3-.35-.55-.55-.85L44.45 25 59.8 52.55H87.3c0-1.6-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
                </svg>
                {gDriveLoading ? "Mengunggah…" : "Upload ke Google Drive"}
              </Btn>
            </div>

            {backupCloudMsg && (
              <div style={{ padding:"8px 12px", borderRadius:8, marginBottom:16, fontSize:12,
                background: backupCloudMsg.ok ? "#E6F4ED" : "#FEF2F2",
                color: backupCloudMsg.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${backupCloudMsg.ok ? "#6EE7B7" : "#FCA5A5"}` }}>
                {backupCloudMsg.message}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8, marginTop:8 }}>Pulihkan dari File Backup</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Punya file backup <code>.json</code> yang tersimpan di perangkat (dari "Unduh Backup Sekarang") atau
              yang sebelumnya diunggah ke Google Drive lalu diunduh ulang? Unggah file tersebut di sini untuk
              memulihkan data — tidak perlu menunggu masuk daftar Riwayat Backup Cloud di bawah.
            </div>
            <div style={{ display:"flex", gap:10, marginBottom:8, flexWrap:"wrap" }}>
              <Btn variant="secondary" onClick={() => restoreFileRef.current?.click()}>
                📂 Pilih File Backup (.json) untuk Dipulihkan
              </Btn>
            </div>
            <input ref={restoreFileRef} type="file" accept=".json,application/json" style={{ display:"none" }} onChange={handleRestoreFileChange} />
            {restoreFileError && (
              <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"8px 12px",
                marginBottom:16, fontSize:12, color:T.red }}>
                {restoreFileError}
              </div>
            )}

            {/* Status pesan Google Drive upload */}
            {gDriveMsg && (
              <div style={{
                padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:13,
                background: gDriveMsg.ok ? "#E6F4ED" : "#FEF2F2",
                color: gDriveMsg.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${gDriveMsg.ok ? "#6EE7B7" : "#FCA5A5"}`,
                display:"flex", alignItems:"flex-start", gap:10, flexWrap:"wrap"
              }}>
                <span style={{ flex:1 }}>{gDriveMsg.text}</span>
                {gDriveMsg.ok && gDriveMsg.link && (
                  <a href={gDriveMsg.link} target="_blank" rel="noopener noreferrer"
                    style={{ color:"#1D4ED8", fontWeight:600, whiteSpace:"nowrap" }}>
                    🔗 Buka di Drive
                  </a>
                )}
                {!gDriveMsg.ok && (
                  <div style={{ fontSize:11, opacity:.8, width:"100%", marginTop:4 }}>
                    Pastikan <b>Google Drive API</b> aktif di Google Cloud Console dan scope <code>drive.file</code> sudah ditambahkan ke OAuth consent screen project Firebase Anda.
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>📅 Data Penjualan (Kontrol) per Tahun</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Untuk hemat kuota Firebase gratis, hanya <b>{new Date().getFullYear()}</b> &amp; <b>{new Date().getFullYear()-1}</b> yang otomatis dimuat.
              Tahun lain dimuat manual di sini bila perlu dilihat di laporan/rekap.
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {availableKontrolYears.length === 0 && (
                <div style={{ fontSize:12, color:T.gray400 }}>Belum ada indeks tahun (normal jika data kontrol masih struktur lama / belum ada data sama sekali).</div>
              )}
              {availableKontrolYears.map(y => {
                const isLoaded = loadedKontrolYears.includes(y);
                return (
                  <Btn key={y} variant={isLoaded ? "secondary" : "primary"} disabled={isLoaded}
                    onClick={() => loadKontrolYear(y)}>
                    {isLoaded ? `✅ ${y} (dimuat)` : `⬇️ Muat tahun ${y}`}
                  </Btn>
                );
              })}
            </div>

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>🗄️ Arsipkan Tahun Lama ke Google Drive</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Pindahkan data kontrol satu tahun dari Realtime Database (kuota 1GB) ke Google Drive Anda (15GB
              gratis, tanpa perlu upgrade paket Firebase) sebagai satu file arsip. Data <b>tidak hilang</b> — tetap
              bisa dilihat &amp; diexport kapan saja lewat daftar arsip di bawah. Sebaiknya jangan arsipkan tahun
              berjalan/tahun kemarin yang masih sering dibuka. Aksi ini akan meminta izin akses Google Drive
              (popup login) jika belum pernah diberikan sebelumnya.
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
              {availableKontrolYears.filter(y => !archivedKontrolYears.includes(y)).length === 0 && (
                <div style={{ fontSize:12, color:T.gray400 }}>Tidak ada tahun yang bisa diarsipkan saat ini.</div>
              )}
              {availableKontrolYears.filter(y => !archivedKontrolYears.includes(y)).map(y => (
                <Btn key={`arch-${y}`} variant="secondary" size="sm" disabled={archivingYear === y}
                  onClick={async () => {
                    if (!confirm(`Arsipkan data kontrol tahun ${y}?\n\nData akan dipindah ke Google Drive Anda dan dihapus dari database aktif (tetap bisa dilihat/diexport lagi kapan saja dari daftar arsip). Anda mungkin diminta login/izin akses Google Drive.`)) return;
                    setArchivingYear(y);
                    setArchiveMsg(null);
                    const result = await archiveKontrolYear(y);
                    setArchiveMsg(result);
                    setArchivingYear(null);
                  }}>
                  {archivingYear === y ? `⏳ Mengarsipkan ${y}...` : `🗄️ Arsipkan ${y}`}
                </Btn>
              ))}
            </div>
            {archiveMsg && (
              <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:12,
                background: archiveMsg.ok ? "#DCFCE7" : "#FEE2E2", color: archiveMsg.ok ? "#166534" : "#991B1B" }}>
                {archiveMsg.ok ? "✅ " : "⚠️ "}{archiveMsg.message}
              </div>
            )}

            {archivedKontrolYears.length > 0 && (
              <>
                <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>📦 Data Kontrol yang Sudah Diarsipkan</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                  {archivedKontrolYears.map(y => (
                    <div key={`archrow-${y}`} style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
                      padding:"8px 10px", borderRadius:8, background:T.gray50, border:`1px solid ${T.gray200}` }}>
                      <span style={{ fontSize:13, fontWeight:600, flex:1 }}>📅 Tahun {y}</span>
                      <Btn variant="secondary" size="sm"
                        onClick={async () => {
                          setViewArchiveYear(y);
                          setViewArchiveData("loading");
                          const result = await viewArchivedKontrolYear(y);
                          setViewArchiveData(result.ok ? result : { ok:false, message: result.message, records: [] });
                        }}>👁️ Lihat</Btn>
                      <Btn variant="secondary" size="sm" disabled={exportingArchiveYear === y}
                        onClick={async () => {
                          setExportingArchiveYear(y);
                          const result = await viewArchivedKontrolYear(y);
                          if (result.ok) {
                            exportExcel(result.records, autoColumns(result.records), `Arsip Kontrol ${y}`, `arsip_kontrol_${y}`);
                          } else {
                            alert(result.message || "Gagal mengekspor arsip.");
                          }
                          setExportingArchiveYear(null);
                        }}>{exportingArchiveYear === y ? "⏳ Menyiapkan..." : "⬇️ Export Excel"}</Btn>
                      <Btn variant="danger" size="sm" onClick={() => { setDeleteArchiveConfirmYear(y); setDeleteArchiveConfirmText(""); }}>🗑️ Hapus</Btn>
                    </div>
                  ))}
                </div>
              </>
            )}

            {viewArchiveYear && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000,
                display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
                onClick={() => { setViewArchiveYear(null); setViewArchiveData(null); }}>
                <div style={{ background:"#fff", borderRadius:12, padding:20, maxWidth:640, maxHeight:"80vh",
                  overflow:"auto", width:"100%" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:15, fontWeight:700 }}>📦 Arsip Kontrol {viewArchiveYear}</div>
                    <button onClick={() => { setViewArchiveYear(null); setViewArchiveData(null); }}
                      style={{ border:"none", background:"none", fontSize:18, cursor:"pointer" }}>✕</button>
                  </div>
                  {viewArchiveData === "loading" && <div style={{ fontSize:13, color:T.gray400 }}>⏳ Memuat arsip dari Storage...</div>}
                  {viewArchiveData && viewArchiveData !== "loading" && !viewArchiveData.ok && (
                    <div style={{ fontSize:13, color:"#991B1B" }}>⚠️ {viewArchiveData.message}</div>
                  )}
                  {viewArchiveData && viewArchiveData !== "loading" && viewArchiveData.ok && (
                    <>
                      <div style={{ fontSize:12, color:T.gray400, marginBottom:10 }}>
                        {viewArchiveData.recordCount} data · diarsipkan {viewArchiveData.archivedAt ? new Date(viewArchiveData.archivedAt).toLocaleString("id-ID") : "-"}
                      </div>
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", fontSize:11, borderCollapse:"collapse" }}>
                          <thead><tr>
                            {autoColumns(viewArchiveData.records).slice(0,8).map(c => (
                              <th key={c.key} style={{ textAlign:"left", padding:"4px 6px", borderBottom:`2px solid ${T.gray200}`, whiteSpace:"nowrap" }}>{c.label}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {viewArchiveData.records.slice(0,100).map((r,i) => (
                              <tr key={i} style={{ borderBottom:`1px solid ${T.gray100}` }}>
                                {autoColumns(viewArchiveData.records).slice(0,8).map(c => (
                                  <td key={c.key} style={{ padding:"4px 6px", whiteSpace:"nowrap" }}>{String(r[c.key] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {viewArchiveData.records.length > 100 && (
                        <div style={{ fontSize:11, color:T.gray400, marginTop:8 }}>Menampilkan 100 dari {viewArchiveData.records.length} data. Gunakan "Export Excel" untuk melihat semuanya.</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {deleteArchiveConfirmYear && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000,
                display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
                <div style={{ background:"#fff", borderRadius:12, padding:20, maxWidth:420, width:"100%" }}>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:8, color:"#991B1B" }}>⚠️ Hapus Arsip Permanen</div>
                  <div style={{ fontSize:13, color:T.gray600, marginBottom:12, lineHeight:1.6 }}>
                    Ini akan menghapus arsip tahun <b>{deleteArchiveConfirmYear}</b> secara permanen dari Google Drive.
                    Data <b>TIDAK BISA</b> dikembalikan setelah ini. Pastikan sudah export/simpan sendiri kalau masih perlu.
                  </div>
                  <input type="text" value={deleteArchiveConfirmText} onChange={e => setDeleteArchiveConfirmText(e.target.value)}
                    placeholder="Ketik HAPUS untuk konfirmasi"
                    style={{ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${T.gray200}`, borderRadius:8, marginBottom:12, fontFamily:"inherit" }} />
                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <Btn variant="secondary" size="sm" onClick={() => setDeleteArchiveConfirmYear(null)}>Batal</Btn>
                    <Btn variant="danger" size="sm" disabled={deleteArchiveConfirmText.trim().toUpperCase() !== "HAPUS"}
                      onClick={async () => {
                        const y = deleteArchiveConfirmYear;
                        setDeleteArchiveConfirmYear(null);
                        const result = await deleteArchivedKontrolYear(y);
                        setArchiveMsg(result.ok ? { ok:true, message:`Arsip tahun ${y} berhasil dihapus permanen.` } : result);
                      }}>Hapus Permanen</Btn>
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>🔧 Migrasi Struktur Data Lama</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Sekali jalan: memindahkan data kontrol lama (satu tabel besar) ke struktur per-tahun. Data diverifikasi
              tersalin dengan benar dulu sebelum salinan lama dihapus — aman diulang jika gagal di tengah jalan.
              Disarankan tekan "Unduh Backup Sekarang" dulu sebelum menjalankan ini.
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
              <input type="text" value={migrateConfirmText} onChange={e=>setMigrateConfirmText(e.target.value)}
                placeholder="Ketik MIGRASI untuk aktifkan tombol"
                style={{ padding:"8px 10px", fontSize:13, border:`1px solid ${T.gray200}`, borderRadius:8, fontFamily:"inherit" }} />
              <Btn variant="danger" disabled={migrating || migrateConfirmText.trim().toUpperCase() !== "MIGRASI"}
                onClick={async () => {
                  setMigrating(true);
                  setMigrationResult(null);
                  const result = await runKontrolYearMigration();
                  setMigrationResult(result);
                  setMigrating(false);
                  setMigrateConfirmText("");
                }}>
                {migrating ? "⏳ Memigrasi..." : "🔧 Jalankan Migrasi Sekarang"}
              </Btn>
            </div>
            {migrationResult && (
              <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:12,
                background: migrationResult.ok ? "#E6F4ED" : "#FEF2F2",
                color: migrationResult.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${migrationResult.ok ? "#6EE7B7" : "#FCA5A5"}` }}>
                {migrationResult.message}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>Riwayat Backup Cloud</div>
            {!user && (
              <div style={{ fontSize:12, color:T.gray400, marginBottom:8 }}>Login dengan Google untuk melihat & menyimpan backup di cloud.</div>
            )}
            {backupLoading && <div style={{ fontSize:13, color:T.gray400 }}>Memuat...</div>}
            {!backupLoading && user && backupList.length === 0 && (
              <div style={{ fontSize:13, color:T.gray400 }}>Belum ada backup cloud tersimpan.</div>
            )}
            {!backupLoading && backupList.length > 0 && (
              <div style={{ maxHeight:260, overflow:"auto", border:`1px solid ${T.gray200}`, borderRadius:8 }}>
                {backupList.map(b => (
                  <div key={b.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"10px 12px", borderBottom:`1px solid ${T.gray100}`, fontSize:13 }}>
                    <div>
                      <div style={{ fontWeight:600, color:T.gray800 }}>{b.key}</div>
                      <div style={{ fontSize:11, color:T.gray400 }}>{b.reason || "—"} · {b.ts ? new Date(b.ts).toLocaleString("id-ID") : "-"}</div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <Btn size="sm" variant="secondary" onClick={() => downloadJSON(`gwg_backup_${b.key}.json`, b)}>⬇️</Btn>
                      <Btn size="sm" variant="danger" onClick={() => { setRestoreTarget(b); setRestoreConfirmText(""); }}>Pulihkan</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:18 }}>
              <Btn variant="secondary" onClick={()=>setShowBackup(false)}>Tutup</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* KONFIRMASI RESTORE — backup akan MENGGANTI seluruh data saat ini,
          jadi perlu konfirmasi ketat sama seperti Reset. */}
      {restoreTarget && isAdmin && (
        <Modal title="⚠️ Pulihkan dari Backup" onClose={()=>{ setRestoreTarget(null); setRestoreConfirmText(""); }}>
          <div style={{ textAlign:"center", padding:"8px 0 20px" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:T.gray800, marginBottom:8 }}>
              Pulihkan data dari backup <b>{restoreTarget.key}</b>?
            </div>
            <div style={{ fontSize:13, color:T.gray400, marginBottom:16 }}>
              Seluruh data <b>saat ini</b> akan <b>diganti</b> dengan isi backup ini. Tindakan ini tidak bisa dibatalkan.
              Disarankan membuat backup data saat ini dulu sebelum melanjutkan (tombol "Unduh Backup Sekarang" di menu sebelumnya).
            </div>
            <div style={{ fontSize:13, color:T.gray800, marginBottom:8, textAlign:"left" }}>
              Ketik <b>PULIHKAN</b> di kolom bawah untuk mengonfirmasi:
            </div>
            <input
              type="text"
              value={restoreConfirmText}
              onChange={(e)=>setRestoreConfirmText(e.target.value)}
              placeholder="Ketik PULIHKAN"
              autoFocus
              style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:14,
                border:`1px solid ${T.gray200}`, borderRadius:8, marginBottom:20, textAlign:"center",
                fontFamily:"inherit", letterSpacing:1 }}
            />
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <Btn variant="secondary" onClick={()=>{ setRestoreTarget(null); setRestoreConfirmText(""); }}>Batal</Btn>
              <Btn
                variant="danger"
                disabled={restoreConfirmText.trim().toUpperCase() !== "PULIHKAN" || restoring}
                onClick={async ()=>{
                  if (!isAdmin || restoreConfirmText.trim().toUpperCase() !== "PULIHKAN" || restoring) return;
                  setRestoring(true);
                  const result = await restoreBackup(restoreTarget.data);
                  setRestoring(false);
                  setRestoreTarget(null);
                  setRestoreConfirmText("");
                  setShowBackup(false);
                  if (result && result.ok === false) {
                    alert("⚠️ Restore SEBAGIAN gagal!\n\n" + result.message);
                  } else {
                    alert("✅ Restore berhasil. Data toko/kontrol besar mungkin perlu beberapa detik untuk tampil sepenuhnya — tunggu status sinkron selesai sebelum menutup aplikasi.");
                  }
                }}
              >
                {restoring ? "Memulihkan..." : "Ya, Pulihkan Sekarang"}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* RESET CONFIRM — hanya bisa dibuka oleh Admin (tombol disembunyikan
          untuk role lain), DAN sebagai pengaman kedua, eksekusi resetDB()
          tetap dicek ulang isAdmin di sini, bukan hanya mengandalkan tombol
          yang tersembunyi di UI.
          VERIFIKASI 2 TAHAP:
          - Tahap 1: Admin wajib mengisi alasan reset (mencegah pencet tidak sengaja)
          - Tahap 2: Ketik frasa "HAPUS PERMANEN" persis (lebih susah terpencet sembarangan) */}
      {showReset && isAdmin && (
        <Modal title={`⚠️ Reset Database — Langkah ${resetStep} dari 2`}
          onClose={()=>{ setShowReset(false); setResetConfirmText(""); setResetStep(1); setResetAlasan(""); }}>
          <div style={{ padding:"4px 0 8px" }}>

            {/* Langkah 1: Isi alasan reset */}
            {resetStep === 1 && (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🔐</div>
                <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:8 }}>
                  Langkah 1: Konfirmasi Identitas & Alasan
                </div>
                <div style={{ fontSize:13, color:T.gray400, marginBottom:16, textAlign:"left",
                  background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"12px 14px" }}>
                  <b style={{ color:T.red }}>⚠️ Peringatan Keras:</b> Tindakan ini akan menghapus
                  <b> seluruh data</b> (toko, rute, wilayah, produk, kontrol, pengguna)
                  {user && <span> termasuk <b>data cloud Firebase</b></span>} secara <b>permanen</b> dan
                  tidak dapat dibatalkan. Sistem akan membuat backup otomatis sebelum reset.
                </div>
                <div style={{ textAlign:"left", marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
                    Alasan Reset <span style={{ color:T.red }}>*</span>
                  </div>
                  <textarea
                    value={resetAlasan}
                    onChange={e=>setResetAlasan(e.target.value)}
                    placeholder="Tulis alasan reset secara jelas (misal: migrasi data baru, perbaikan struktur, dll)..."
                    rows={3}
                    style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:13,
                      border:`1.5px solid ${T.gray200}`, borderRadius:8, fontFamily:"inherit", resize:"vertical" }}
                  />
                  <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>
                    Wajib diisi minimal 10 karakter. Alasan akan dicatat di log backup otomatis.
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                  <Btn variant="secondary" onClick={()=>{ setShowReset(false); setResetAlasan(""); setResetStep(1); }}>Batal</Btn>
                  <Btn variant="danger"
                    disabled={resetAlasan.trim().length < 10}
                    onClick={()=>{ if(resetAlasan.trim().length >= 10) setResetStep(2); }}>
                    Lanjut ke Langkah 2 →
                  </Btn>
                </div>
              </div>
            )}

            {/* Langkah 2: Ketik frasa konfirmasi */}
            {resetStep === 2 && (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>💣</div>
                <div style={{ fontSize:15, fontWeight:700, color:T.red, marginBottom:8 }}>
                  Langkah 2: Konfirmasi Penghapusan Permanen
                </div>
                <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8,
                  padding:"10px 14px", marginBottom:16, fontSize:13, textAlign:"left" }}>
                  <div style={{ fontWeight:700, color:T.red, marginBottom:4 }}>Alasan yang Anda isi:</div>
                  <div style={{ color:T.gray800, fontStyle:"italic" }}>"{resetAlasan}"</div>
                </div>
                <div style={{ fontSize:13, color:T.gray800, marginBottom:8, textAlign:"left" }}>
                  Ketik <b style={{ color:T.red, letterSpacing:1 }}>HAPUS PERMANEN</b> di kolom bawah untuk mengonfirmasi:
                </div>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e)=>setResetConfirmText(e.target.value)}
                  placeholder="Ketik: HAPUS PERMANEN"
                  autoFocus
                  style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:14,
                    border:`2px solid ${resetConfirmText.trim().toUpperCase()==="HAPUS PERMANEN"?T.red:T.gray200}`,
                    borderRadius:8, marginBottom:20, textAlign:"center",
                    fontFamily:"inherit", letterSpacing:2, background:T.redLt }}
                />
                <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                  <Btn variant="secondary" onClick={()=>{ setResetStep(1); setResetConfirmText(""); }}>← Kembali</Btn>
                  <Btn
                    variant="danger"
                    disabled={resetConfirmText.trim().toUpperCase() !== "HAPUS PERMANEN"}
                    onClick={()=>{
                      if (!isAdmin || resetConfirmText.trim().toUpperCase() !== "HAPUS PERMANEN") return;
                      resetDB();
                      setShowReset(false);
                      setResetConfirmText("");
                      setResetStep(1);
                      setResetAlasan("");
                    }}
                  >
                    💥 Ya, Reset Permanen Sekarang
                  </Btn>
                </div>
                <div style={{ marginTop:12, fontSize:11, color:T.gray400 }}>
                  Backup otomatis akan dibuat sebelum data dihapus.
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
