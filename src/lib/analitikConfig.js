// Penyimpanan konfigurasi kartu "Perlu Perhatian" di Firebase + cache lokal.
// Path: gwg_data/_config/analitikToko  (butuh Firebase Rules v18 — lihat firebase-rules/).
//  - Semua pengguna login boleh MEMBACA; hanya Admin/Manajer boleh MENULIS.
//  - Tanpa Rules v18 / saat offline: kartu tetap jalan memakai cache terakhir atau nilai bawaan.
import React from "react";
import { firebaseDB } from "../firebase/init";
import { ANALITIK_DEFAULT, bacaAnalitikConfig, validasiAnalitikConfig } from "./analitikToko";

const PATH = "gwg_data/_config/analitikToko";
const CACHE_KEY = "gwg.analitikToko.v1";

function bacaCache() {
  try { return bacaAnalitikConfig(JSON.parse(localStorage.getItem(CACHE_KEY) || "null")); }
  catch { return { ...ANALITIK_DEFAULT }; }
}
function tulisCache(nilai) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(nilai)); } catch { /* penyimpanan penuh/dilarang */ }
}

/** @returns {{config:object, adaOverride:boolean, simpan:(raw)=>Promise<{ok:boolean,errors?:object,pesan?:string}>, kembalikanBawaan:()=>Promise<{ok:boolean,pesan?:string}>}} */
export function useAnalitikConfig() {
  const [config, setConfig] = React.useState(bacaCache);
  const [adaOverride, setAdaOverride] = React.useState(false);

  React.useEffect(() => {
    if (!firebaseDB) return undefined;
    const { db, ref, onValue, off } = firebaseDB;
    const r = ref(db, PATH);
    const cb = (snap) => {
      const raw = snap.exists() ? snap.val() : null;
      const nilai = bacaAnalitikConfig(raw);
      setAdaOverride(raw != null);
      setConfig(nilai);
      tulisCache(nilai);
    };
    // Gagal baca (offline / Rules belum v18): diam, tetap pakai cache atau bawaan.
    onValue(r, cb, () => {});
    return () => { try { off(r, "value", cb); } catch { /* sudah dilepas */ } };
  }, []);

  const simpan = React.useCallback(async (raw) => {
    const v = validasiAnalitikConfig(raw);
    if (!v.ok) return { ok: false, errors: v.errors };
    if (!firebaseDB) return { ok: false, pesan: "Firebase belum siap." };
    try {
      await firebaseDB.set(firebaseDB.ref(firebaseDB.db, PATH), v.nilai);
      return { ok: true };
    } catch (e) {
      const ditolak = /permission|denied/i.test(String(e?.code || e?.message || ""));
      return { ok: false, pesan: ditolak
        ? "Ditolak server: akun Anda bukan Admin/Manajer, atau Firebase Rules v18 belum dipublikasikan."
        : "Gagal menyimpan (mungkin sedang offline). Coba lagi." };
    }
  }, []);

  const kembalikanBawaan = React.useCallback(async () => {
    if (!firebaseDB) return { ok: false, pesan: "Firebase belum siap." };
    try {
      await firebaseDB.remove(firebaseDB.ref(firebaseDB.db, PATH));
      return { ok: true };
    } catch (e) {
      const ditolak = /permission|denied/i.test(String(e?.code || e?.message || ""));
      return { ok: false, pesan: ditolak ? "Ditolak server (hanya Admin/Manajer; pastikan Rules v18 aktif)." : "Gagal mengembalikan bawaan." };
    }
  }, []);

  return { config, adaOverride, simpan, kembalikanBawaan };
}
