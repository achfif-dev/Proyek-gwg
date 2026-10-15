import { useState, useEffect } from "react";
import { firebaseDB } from "../firebase/init";

// Status koneksi SOCKET Firebase (bukan sekadar status jaringan perangkat).
// Mengembalikan: null = belum diketahui, true = tersambung, false = terputus.
// `false` baru dilaporkan setelah terputus terus-menerus ≥ DEBOUNCE_MS, supaya
// kedipan sesaat (saat start / reconnect cepat) tidak memunculkan peringatan.
const DEBOUNCE_MS = 4000;

export function useFirebaseConnected(user) {
  const [connected, setConnected] = useState(null);
  useEffect(() => {
    if (!user || !firebaseDB) { setConnected(null); return; }
    const { db: rtdb, ref, onValue } = firebaseDB;
    const r = ref(rtdb, ".info/connected");
    let timer = null;
    const unsub = onValue(r, snap => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (snap.val() === true) setConnected(true);
      else timer = setTimeout(() => setConnected(false), DEBOUNCE_MS);
    });
    return () => { if (timer) clearTimeout(timer); if (typeof unsub === "function") unsub(); };
  }, [user]);
  return connected;
}
