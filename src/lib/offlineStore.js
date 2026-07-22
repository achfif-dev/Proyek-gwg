export const IDB_NAME = "gwg_offline_db";
export const IDB_STORE = "kv";
// "writeQueue": antrean perubahan yang BELUM berhasil dikirim ke Firebase —
// keyPath = "path" (path Firebase relatif, mis. "toko/T001"), jadi kalau
// user mengedit path yang sama berkali-kali saat offline, cukup versi
// TERAKHIR yang tersimpan (put menimpa key yang sama), bukan riwayat
// bertumpuk. Ini yang membuat perubahan dari sales di lapangan (sinyal
// lemah/hilang) TIDAK PERNAH hilang walau app ditutup/HP restart sebelum
// sempat online lagi — begitu online, antrean ini otomatis dikirim ulang.
export const IDB_QUEUE_STORE = "writeQueue";
export let idbOpenPromise = null;
export function openIDB() {
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
export async function idbSet(key, value) {
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
export async function idbGet(key) {
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
export async function queueWrite(path, value) {
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
export async function queueRemove(path) {
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
export async function queueGetAll() {
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
export async function queueCount() {
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
// ── Penyimpanan lokal, dipecah 2 jalur berdasarkan ukuran tabel ──────────
// Sebelumnya SETIAP panggilan saveLocalDB() men-JSON.stringify SELURUH
// `db` (termasuk `toko` & `kontrol`) lalu localStorage.setItem SECARA
// SINKRON — di skala ribuan toko ini bisa >30MB dan blocking main thread
// ratusan ms per klik. Lebih parah: localStorage punya kuota ~5-10MB per
// origin, jauh di bawah ukuran itu, dan localStorage.setItem dibungkus
// try{}catch{} kosong → di skala besar kemungkinan GAGAL SENYAP tiap kali.
//
// Skema baru:
// 1) Tabel KECIL (semua KECUALI toko/kontrol) → localStorage, SINKRON.
//    Ukurannya tetap kecil (ratusan KB) walau bisnis berkembang, jadi
//    aman dari kuota & instan sebagai fallback tercepat saat app baru
//    dibuka (sebelum IndexedDB sempat siap).
// 2) SELURUH data (termasuk toko/kontrol) → IndexedDB, ASYNC + DI-DEBOUNCE
//    ~500ms. IndexedDB tidak kena batas kuota seketat localStorage, dan
//    API-nya memang didesain tidak memblokir UI thread. Debounce memastikan
//    klik beruntun cepat (mis. isi banyak baris kontrol) cuma memicu 1x
//    tulis di akhir, bukan 1x tulis besar per klik.
const LARGE_TABLES = ["toko", "kontrol"];

let idbFlushTimer = null;
let idbFlushPending = null;

function flushIdbNow() {
  if (idbFlushTimer) { clearTimeout(idbFlushTimer); idbFlushTimer = null; }
  if (idbFlushPending) {
    const payload = idbFlushPending;
    idbFlushPending = null;
    idbSet("gwg_db_v2", payload);
  }
}

if (typeof window !== "undefined") {
  // Jaga-jaga: kalau tab ditutup / app dipindah ke background persis di
  // tengah jendela debounce 500ms, jangan sampai perubahan terakhir hilang.
  window.addEventListener("beforeunload", flushIdbNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushIdbNow();
  });
}

export function saveLocalDB(data) {
  const smallSlice = {};
  for (const key in data) {
    if (!LARGE_TABLES.includes(key)) smallSlice[key] = data[key];
  }
  try { localStorage.setItem("gwg_db_v2_small", JSON.stringify(smallSlice)); } catch {}

  idbFlushPending = data;
  if (idbFlushTimer) clearTimeout(idbFlushTimer);
  idbFlushTimer = setTimeout(flushIdbNow, 500);
}

// Dipakai di titik-titik kritis (sebelum reset/restore/logout) supaya
// tidak menunggu window debounce 500ms saat kepastian tersimpan itu penting.
export function flushLocalDBNow() {
  flushIdbNow();
}

// Hook status koneksi — dipakai untuk menampilkan indikator "Offline" di
// header dan (nantinya) untuk menahan/menunda aksi yang butuh jaringan.
// navigator.onLine mendeteksi status koneksi perangkat secara umum (WiFi/
// data seluler mati/nyala); ini sudah cukup untuk kebanyakan kasus offline
// di lapangan (mis. sinyal hilang saat kunjungan toko).
