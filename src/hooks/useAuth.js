import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { initFirebase, firebaseAuth } from "../firebase/init";
import { ACTIVE_TAB_SESSION_KEY } from "../config/tabs";

export function useAuth() {
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
      // Hapus tab terakhir yang tersimpan supaya saat LOGIN ULANG (bukan
      // sekadar refresh halaman), tampilan selalu kembali ke Dashboard —
      // bukan melanjutkan tab terakhir dari sesi sebelumnya.
      try { sessionStorage.removeItem(ACTIVE_TAB_SESSION_KEY); } catch {}
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
