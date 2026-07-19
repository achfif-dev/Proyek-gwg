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
// Titik tunggal untuk menyimpan seluruh state `db` secara lokal. Dipanggil
// di SETIAP tempat yang dulu memanggil localStorage.setItem("gwg_db_v2", ...)
// langsung — perilaku localStorage dipertahankan (sinkron, cepat), ditambah
// tulis ke IndexedDB (async, best-effort, tidak memblokir UI) sebagai
// cadangan berkapasitas besar yang jauh lebih tahan dipakai offline.
export function saveLocalDB(data) {
  try { localStorage.setItem("gwg_db_v2", JSON.stringify(data)); } catch {}
  idbSet("gwg_db_v2", data);
}

// Hook status koneksi — dipakai untuk menampilkan indikator "Offline" di
// header dan (nantinya) untuk menahan/menunda aksi yang butuh jaringan.
// navigator.onLine mendeteksi status koneksi perangkat secara umum (WiFi/
// data seluler mati/nyala); ini sudah cukup untuk kebanyakan kasus offline
// di lapangan (mis. sinyal hilang saat kunjungan toko).
