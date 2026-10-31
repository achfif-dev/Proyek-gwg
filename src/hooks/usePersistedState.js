import { useState, useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + keyRef.current, JSON.stringify(value));
    } catch {
      // Kuota localStorage penuh / mode private browsing — abaikan saja,
      // filter tetap berfungsi normal untuk sesi berjalan, hanya saja
      // tidak tersimpan lintas-reload.
    }
  }, [value, enabled]);

  return [value, setValue];
}

/** Hapus satu filter tersimpan (dipakai tombol "Reset" supaya reset juga menghapus dari localStorage, bukan cuma kembali ke default di memori). */
export function clearPersistedState(key) {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch {}
}
