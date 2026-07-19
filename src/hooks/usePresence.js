import { useState, useEffect, useRef } from "react";
import { firebaseDB } from "../firebase/init";
import { encodeEmailKey } from "../lib/dataHelpers";
import { isSuperAdminEmail } from "../config/superAdmin";

export function usePresence(user, currentUserRecord) {
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
