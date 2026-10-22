import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, get, onValue, onChildAdded, onChildChanged,
  onChildRemoved, off, onDisconnect, serverTimestamp, remove, goOffline, goOnline, enableLogging, forceLongPolling,
} from "firebase/database";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential,
  signOut, onAuthStateChanged,
} from "firebase/auth";
import { FIREBASE_CONFIG, FIREBASE_CONFIGURED } from "./config";

// ─────────────────────────────────────────────
//  FIREBASE SDK LOADER — inisialisasi Firebase (app + database + auth)
// ─────────────────────────────────────────────
export let firebaseApp = null, firebaseDB = null, firebaseAuth = null;
export let firebaseReady = false;

export async function initFirebase() {
  if (firebaseReady) return true;
  if (!FIREBASE_CONFIGURED) return false;
  try {
    // Tidak ada lagi network fetch di sini — semua modul Firebase sudah
    // ter-bundle sejak build time (lihat import di bagian atas file).
    // Long-polling HANYA bila diminta eksplisit (localStorage "gwg.forceLP" = "1").
    // Default WebSocket: long-polling mengirim data dalam potongan ~1,8 KB sehingga
    // tulisan besar jauh lebih lambat. Harus dipanggil SEBELUM getDatabase().
    try {
      if (localStorage.getItem("gwg.forceLP") === "1") forceLongPolling();
    } catch { /* abaikan */ }
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseDB = { db: getDatabase(firebaseApp), ref, set, get, onValue, onChildAdded, onChildChanged, onChildRemoved, off, onDisconnect, serverTimestamp, remove, goOffline, goOnline, enableLogging };
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
