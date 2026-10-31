import { useState, useEffect, useRef } from "react";
import { idbGet, idbSet } from "../lib/offlineStore";

// ─────────────────────────────────────────────────────────────────────────
// usePersistedState — pengganti drop-in untuk useState, TAPI nilainya
// otomatis disimpan ke localStorage dan dipulihkan lagi saat komponen
// dimuat ulang (klik tombol refresh, reload manual, atau app dibuka lagi
// setelah lama ditutup). Dipakai khusus untuk state FILTER & PENCARIAN di
// tiap tab (Kontrol, Rekap, Toko, Rute, Wilayah, Bagi Hasil, dll) supaya
// tidak "reset ke default" tiap kali halaman dimuat ulang — sebelumnya
// filter/pencarian selalu balik kosong walau pengguna baru saja
// menyaringnya, sehingga tiap refresh terasa mengulang dari awal.
//
// PENTING soal keamanan data antar-pengguna: kunci localStorage diberi
// PREFIX supaya tidak bentrok dengan key lain, tapi TIDAK di-scope per
// akun secara otomatis — kalau beberapa pengguna login bergantian di
// perangkat/browser yang sama, filter wilayah terakhir yang tersimpan
// bisa saja "milik" pengguna sebelumnya. Untuk filter yang berhubungan
// dengan pembatasan wilayah Sales (isSalesRestricted), komponen pemanggil
// WAJIB tetap memvalidasi/mengunci ulang nilai wilayahId terhadap
// `salesWilayahId` setelah state dipulihkan (lihat useEffect clamp di
// TabKontrol/TabToko/TabRekap) — jangan mengandalkan nilai tersimpan apa
// adanya untuk keputusan otorisasi.
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "gwg_filter_v1:";

const nilaiAwal = (fallback) => (typeof fallback === "function" ? fallback() : fallback);
const objekBiasa = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null || raw === undefined) return nilaiAwal(fallback);
    const parsed = JSON.parse(raw);
    // Gabungkan dengan default: field filter yang ditambahkan di versi app yang lebih baru
    // (belum ada di data tersimpan) tetap punya nilai awal, bukan undefined.
    const def = nilaiAwal(fallback);
    return objekBiasa(def) && objekBiasa(parsed) ? { ...def, ...parsed } : parsed;
  } catch {
    return nilaiAwal(fallback);
  }
}

/**
 * @param {string} key - kunci unik per filter, disarankan format "namaTab.namaFilter"
 * @param {*} initialValue - nilai default (dipakai kalau belum pernah tersimpan di device ini)
 * @param {boolean} [enabled=true] - false = state biasa TANPA baca/tulis localStorage. Dipakai oleh
 *   instance KEDUA dari komponen yang sama (mis. TabKontrol yang ditanam di dalam Tab Rekap) supaya
 *   tidak menimpa filter milik instance utama lewat kunci localStorage yang sama.
 */
export function usePersistedState(key, initialValue, enabled = true) {
  const [value, setValue] = useState(() => (enabled ? readStored(key, initialValue) : nilaiAwal(initialValue)));
  const keyRef = useRef(key);
  const awalJsonRef = useRef(null);   // isi yang dipulihkan dari localStorage saat mount
  const disentuhRef = useRef(false);  // true kalau nilai sudah berubah sejak mount

  // ✅ FIX filter hilang setelah app ditutup paksa: localStorage WebView tidak langsung ke disk,
  // jadi pilihan terakhir (mis. Rute & Tgl Kontrol) bisa hilang. Salinan CADANGAN ditulis juga
  // ke IndexedDB (transaksi selesai dalam hitungan ms) beserta cap waktu; saat mount, kalau
  // cadangan itu lebih baru daripada localStorage dan user belum mengubah apa pun, dipakai.
  useEffect(() => {
    if (!enabled) return;
    let batal = false;
    try { awalJsonRef.current = JSON.stringify(value); } catch { awalJsonRef.current = null; }
    idbGet(STORAGE_PREFIX + keyRef.current).then(rec => {
      if (batal || disentuhRef.current || !rec || rec.t === undefined) return;
      let tLokal = 0;
      try { tLokal = Number(localStorage.getItem(STORAGE_PREFIX + keyRef.current + "@t") || 0); } catch {}
      if (rec.t <= tLokal) return;
      const def = nilaiAwal(initialValue);
      setValue(objekBiasa(def) && objekBiasa(rec.v) ? { ...def, ...rec.v } : rec.v);
    }).catch(() => {});
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let json = null;
    try { json = JSON.stringify(value); } catch { /* tidak bisa diserialisasi → abaikan */ }
    if (json !== null && json !== awalJsonRef.current) disentuhRef.current = true;
    // Jangan menulis ulang (dan memperbarui cap waktu) hanya karena komponen baru dipasang —
    // itu akan membuat salinan lama dari localStorage tampak "lebih baru" daripada cadangan IDB.
    if (!disentuhRef.current) return;
    const t = Date.now();
    try {
      localStorage.setItem(STORAGE_PREFIX + keyRef.current, json ?? "null");
      localStorage.setItem(STORAGE_PREFIX + keyRef.current + "@t", String(t));
    } catch {
      // Kuota localStorage penuh / mode private browsing — abaikan saja; cadangan IndexedDB
      // di bawah tetap mencoba menyimpan.
    }
    idbSet(STORAGE_PREFIX + keyRef.current, { v: value, t });
  }, [value, enabled]);

  return [value, setValue];
}

/** Hapus satu filter tersimpan (dipakai tombol "Reset" supaya reset juga menghapus dari localStorage, bukan cuma kembali ke default di memori). */
export function clearPersistedState(key) {
  try { localStorage.removeItem(STORAGE_PREFIX + key); localStorage.removeItem(STORAGE_PREFIX + key + "@t"); } catch {}
  idbSet(STORAGE_PREFIX + key, undefined);
}
