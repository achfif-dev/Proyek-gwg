import { useState, useEffect, useRef } from "react";
import { firebaseDB } from "../firebase/init";
import { encodeEmailKey } from "../lib/dataHelpers";
import { isSuperAdminEmail } from "../config/superAdmin";
import { PRESENCE_CONFIG, klasifikasiSesi, signatureSesi } from "../lib/presenceHelpers";

// Presence: daftar sesi yang terhubung + status "dipakai" vs "diam".
//
// Tiap sesi menulis gwg_data/shared/presence/<email>/<idSesi>. Dulu `lastActive` hanya
// ditulis SEKALI saat tersambung, jadi tab/APK yang dibiarkan terbuka di latar belakang
// tetap tampil "Aktif". Sekarang sesi mengirim detak (heartbeat) `lastActive` tiap ±1
// menit HANYA saat halaman terlihat dan ada interaksi pengguna (sentuh/klik/ketik/scroll)
// dalam 5 menit terakhir. Pembaca menandai sesi "diam" kalau detak terakhirnya lebih tua
// dari idleMs (lihat lib/presenceHelpers.js). Tidak ada perubahan Rules: hanya field
// `lastActive` yang sudah ada yang diperbarui (Rules menolak penulisan kalau sesinya sudah
// terhapus, jadi detak "hantu" setelah logout tidak membuat sesi baru).
export function usePresence(user, currentUserRecord) {
  const [activeUsers, setActiveUsers] = useState([]);
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    sessionIdRef.current = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  useEffect(() => {
    if (!user || !firebaseDB) return;
    const { db: rtdb, ref, set, onValue, onDisconnect, serverTimestamp, remove } = firebaseDB;
    const cfg = PRESENCE_CONFIG;
    const emailKey = encodeEmailKey(user.email || "");
    const sessionId = sessionIdRef.current;
    const sessionRef = ref(rtdb, `gwg_data/shared/presence/${emailKey}/${sessionId}`);
    const lastActiveRef = ref(rtdb, `gwg_data/shared/presence/${emailKey}/${sessionId}/lastActive`);
    const connectedRef = ref(rtdb, ".info/connected");
    const offsetRef = ref(rtdb, ".info/serverTimeOffset");

    let rawList = [];
    let serverOffset = 0;
    let lastSig = null;
    let connected = false;
    let lastBeat = 0;
    let lastInteraction = Date.now();

    // Hitung ulang status; hanya setState kalau ADA perubahan yang terlihat (status/menit
    // diam/daftar sesi). Detak rutin tidak mengubah tanda tangan → header tidak render ulang.
    const recompute = () => {
      const list = klasifikasiSesi(rawList, Date.now() + serverOffset, cfg.idleMs);
      const sig = signatureSesi(list);
      if (sig !== lastSig) {
        lastSig = sig;
        setActiveUsers(list);
      }
    };

    const beat = (force = false) => {
      if (!connected) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (!force && now - lastInteraction > cfg.interaksiMs) return; // tidak ada interaksi → jangan berdetak
      if (now - lastBeat < cfg.minGapMs) return;
      lastBeat = now;
      set(lastActiveRef, serverTimestamp()).catch(() => {});
    };

    // Interaksi pertama setelah diam lama langsung berdetak (supaya cepat kembali "Aktif");
    // interaksi beruntun cukup dicatat, detaknya menyusul lewat interval.
    const onInteraksi = () => {
      const now = Date.now();
      const lamaDiam = now - lastInteraction;
      lastInteraction = now;
      if (lamaDiam > cfg.heartbeatMs) beat();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastInteraction = Date.now();
        beat(true);
      }
    };
    const EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"];
    EVENTS.forEach((e) => window.addEventListener(e, onInteraksi, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisibility);

    const unsubOffset = onValue(offsetRef, (snap) => {
      serverOffset = Number(snap.val()) || 0;
      recompute();
    });

    const unsubConnected = onValue(connectedRef, (snap) => {
      connected = snap.val() === true;
      if (connected) {
        // Daftarkan sesi ini sebagai aktif, dan pastikan otomatis terhapus
        // saat koneksi perangkat ini putus (nutup tab, sinyal hilang, dst).
        onDisconnect(sessionRef).remove().then(() => {
          lastBeat = Date.now();
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
      rawList = list;
      recompute();
    });

    const hb = setInterval(() => beat(), cfg.heartbeatMs);
    const tick = setInterval(recompute, cfg.tickMs); // status "diam" muncul walau tak ada data baru

    return () => {
      clearInterval(hb);
      clearInterval(tick);
      EVENTS.forEach((e) => window.removeEventListener(e, onInteraksi, { capture: true }));
      document.removeEventListener("visibilitychange", onVisibility);
      unsubOffset();
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
