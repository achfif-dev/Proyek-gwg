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
// Setiap entri: { path, value, ts, v } — `ts` menentukan URUTAN kirim (selalu
// naik, tidak pernah kembar walau dua perubahan terjadi di milidetik yang
// sama), `v` = "nomor versi" unik entri itu. Nomor versi dipakai untuk
// hapus-bersyarat: entri di antrean hanya dihapus kalau versinya MASIH SAMA
// dengan yang baru saja terkirim. Kalau selama pengiriman (sinyal lemah =
// bisa lama) user mengedit path yang sama lagi, versi barunya tidak ikut
// terhapus.
//
// Entri yang DITOLAK security rules tidak lagi dibuang: ditandai `denied`
// (tetap tersimpan di IndexedDB, tidak ikut dikirim ulang otomatis) sampai
// user memilih Kirim Ulang / Buang / Simpan cadangan.
let _lastTs = 0;
let _seq = 0;
function nextTs() { const n = Date.now(); _lastTs = n > _lastTs ? n : _lastTs + 1; return _lastTs; }
const versiOf = (e) => (e ? (e.v ?? e.ts) : undefined); // entri lama (sebelum patch) belum punya `v`

// Mengembalikan true kalau perubahan BENAR-BENAR tersimpan di IndexedDB.
export async function queueWrite(path, value) {
  const ts = nextTs(); // dipatok SINKRON saat dipanggil → urutan antrean = urutan pemanggilan
  const v = `${ts}-${++_seq}`;
  const db = await openIDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      tx.objectStore(IDB_QUEUE_STORE).put({ path, value, ts, v });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

// Versi BATCH dari queueWrite: SATU transaksi IndexedDB untuk semua path
// (bukan satu transaksi per path). `ts`/`v` tetap dipatok SINKRON dan
// berurutan, jadi urutan kirim = urutan pemanggilan. Mengembalikan array
// boolean (sama panjang dengan `pairs`); semuanya true/false bersama karena
// satu transaksi = semuanya tersimpan atau tidak sama sekali.
export async function queueWriteMany(pairs) {
  const items = pairs.map(([path, value]) => { const ts = nextTs(); return { path, value, ts, v: `${ts}-${++_seq}` }; });
  const gagal = () => items.map(() => false);
  if (!items.length) return [];
  const db = await openIDB();
  if (!db) return gagal();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const st = tx.objectStore(IDB_QUEUE_STORE);
      items.forEach(it => st.put(it));
      tx.oncomplete = () => resolve(items.map(() => true));
      tx.onerror = () => resolve(gagal());
      tx.onabort = () => resolve(gagal());
    } catch { resolve(gagal()); }
  });
}

// Hapus-bersyarat BANYAK entri dalam SATU transaksi (versi batch dari
// queueRemoveIfSame). Mengembalikan jumlah entri yang benar-benar terhapus.
export async function queueRemoveManyIfSame(entries) {
  const db = await openIDB();
  if (!db || !entries || !entries.length) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(IDB_QUEUE_STORE);
      let removed = 0;
      entries.forEach(entry => {
        const req = store.get(entry.path);
        req.onsuccess = () => {
          const cur = req.result;
          if (cur && !cur.denied && versiOf(cur) === versiOf(entry)) { store.delete(entry.path); removed++; }
        };
      });
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    } catch { resolve(0); }
  });
}

// Hapus entri HANYA jika versinya masih sama dengan `entry` (yang baru terkirim).
export async function queueRemoveIfSame(entry) {
  const db = await openIDB();
  if (!db || !entry) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(IDB_QUEUE_STORE);
      const req = store.get(entry.path);
      let removed = false;
      req.onsuccess = () => {
        const cur = req.result;
        if (cur && !cur.denied && versiOf(cur) === versiOf(entry)) { store.delete(entry.path); removed = true; }
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

// Tandai entri sebagai DITOLAK (bukan dihapus). Hanya berlaku jika versinya
// masih sama — kalau sudah digantikan perubahan yang lebih baru, biarkan yang baru.
export async function queueMarkDenied(entry, message) {
  const db = await openIDB();
  if (!db || !entry) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(IDB_QUEUE_STORE);
      const req = store.get(entry.path);
      let marked = false;
      req.onsuccess = () => {
        const cur = req.result;
        if (cur && versiOf(cur) === versiOf(entry)) {
          store.put({ ...cur, denied: true, deniedAt: Date.now(), deniedMessage: String(message || "Permission denied") });
          marked = true;
        }
      };
      tx.oncomplete = () => resolve(marked);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

async function queueGetRaw() {
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

// Entri yang MASIH menunggu dikirim (tidak termasuk yang sudah ditolak).
export async function queueGetAll() {
  return (await queueGetRaw()).filter(e => !e.denied);
}
// Entri yang ditolak rules dan disimpan menunggu keputusan user.
export async function queueGetDenied() {
  return (await queueGetRaw()).filter(e => e.denied).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
export async function queueCount() {
  return (await queueGetAll()).length;
}
// Kembalikan SEMUA entri ditolak ke antrean (urutan asli `ts` dipertahankan
// supaya ketergantungan antar-koleksi, mis. toko sebelum kontrol, tetap benar).
export async function queueRetryDenied() {
  const db = await openIDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(IDB_QUEUE_STORE);
      const req = store.getAll();
      let n = 0;
      req.onsuccess = () => {
        (req.result || []).filter(e => e.denied).forEach(e => {
          const { denied, deniedAt, deniedMessage, ...bersih } = e;
          store.put(bersih); n++;
        });
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    } catch { resolve(0); }
  });
}
// Buang PERMANEN semua entri yang ditolak.
export async function queueDiscardDenied() {
  const db = await openIDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(IDB_QUEUE_STORE);
      const req = store.getAll();
      let n = 0;
      req.onsuccess = () => {
        (req.result || []).filter(e => e.denied).forEach(e => { store.delete(e.path); n++; });
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    } catch { resolve(0); }
  });
}

export function isPermissionDenied(e) {
  return String(e?.code || e?.message || "").toUpperCase().includes("PERMISSION_DENIED");
}

// Kirim antrean menurut urutan `ts`, secara BERJENDELA-PARALEL (pipelining).
//
// Sebelumnya: `await send()` SATU PER SATU — tiap tulisan menunggu balasan
// (ACK) server dulu sebelum yang berikutnya dikirim. Di sinyal seluler
// (RTT 300–1000 ms) itu cuma ±1–3 tulisan/detik, dan 1 input kontrol = 2+
// tulisan, jadi input cepat admin lebih cepat daripada antrean → menumpuk.
// Sekarang: sampai `concurrency` tulisan DIPANGGIL BERURUTAN tanpa menunggu
// ACK (SDK Firebase menjaga urutan di satu socket, jadi ketergantungan
// antar-path tetap aman), lalu ditunggu bersama. Dampak:
//  • sukses            → hapus-bersyarat sekaligus (1 transaksi per jendela)
//  • PERMISSION_DENIED → hanya entri ITU yang ditandai `denied` (TIDAK dihapus);
//                        yang lain di jendela tetap terkirim
//  • error lain/timeout→ berhenti setelah jendela ini (kemungkinan offline);
//                        yang sudah sukses tetap dihapus, sisanya dicoba lagi
// `timeoutMs`: tulisan yang tak kunjung di-ACK (socket mati diam-diam)
// dianggap gagal-sementara supaya antrean tidak macet selamanya; mengirim
// ulang aman karena tulisan bersifat idempoten (set nilai yang sama).
// `store` bisa disuntik untuk pengujian.
export const isKirimTimeout = (e) => e?.code === "kirim/timeout";
const kunciEntri = (e) => `${e.path}|${versiOf(e)}`;

// `terbang`: Map kunci→waktu untuk tulisan yang kena timeout TAPI belum selesai
// (masih ada di buffer SDK Firebase). Selama masih "terbang" (maks `terbangTtlMs`)
// tulisan itu TIDAK dikirim ulang — sebelumnya tiap putaran retry menambah salinan
// baru ke buffer SDK (menumpuk selama sinyal buruk). Bila SDK akhirnya membalas
// (mis. setelah putus-sambung), entri dihapus dari antrean saat itu juga (`onLateOk`).
export async function drainQueue(send, { onDenied, onProgress, onLateOk, concurrency = 20, timeoutMs = 25000, store, terbang, terbangTtlMs = 120000 } = {}) {
  const st = store || { getAll: queueGetAll, removeMany: queueRemoveManyIfSame, markDenied: queueMarkDenied };
  const tb = terbang || new Map();
  const hasil = { sent: 0, denied: 0, stopped: false, error: null, terbang: 0 };
  const sudah = new Set();
  const kirimSatu = (e) => {
    const kunci = kunciEntri(e);
    const p = new Promise((res, rej) => { try { res(send(e.path, e.value)); } catch (x) { rej(x); } });
    // Penyelesaian TERLAMBAT (setelah timeout menandai entri "terbang").
    p.then(
      () => { if (tb.has(kunci)) { tb.delete(kunci); st.removeMany([e]).then(() => { if (onLateOk) onLateOk(e); }); } },
      (err) => {
        if (!tb.has(kunci)) return;
        tb.delete(kunci);
        if (isPermissionDenied(err)) st.markDenied(e, err?.message || "Permission denied").then(ok => { if (ok && onDenied) onDenied(e, err?.message || "Permission denied"); });
      });
    let t;
    const batas = new Promise((_, rej) => {
      t = setTimeout(() => { tb.set(kunci, Date.now()); rej(Object.assign(new Error("Waktu kirim habis (tidak ada balasan server)"), { code: "kirim/timeout" })); }, timeoutMs);
    });
    return Promise.race([p, batas]).finally(() => clearTimeout(t));
  };
  for (let putaran = 0; putaran < 25; putaran++) {
    const now = Date.now();
    for (const [k, ts] of tb) if (now - ts > terbangTtlMs) tb.delete(k);
    const semua = await st.getAll();
    const entries = semua
      .filter(e => !sudah.has(kunciEntri(e)))
      .filter(e => { if (tb.has(kunciEntri(e))) { hasil.terbang++; return false; } return true; })
      .sort((a, b) => ((a.ts || 0) - (b.ts || 0)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (!entries.length) break;
    for (let i = 0; i < entries.length; i += concurrency) {
      const jendela = entries.slice(i, i + concurrency);
      jendela.forEach(e => sudah.add(kunciEntri(e)));
      // send() dipanggil SINKRON berurutan di dalam map → urutan terbit = urutan ts.
      const hs = await Promise.allSettled(jendela.map(kirimSatu));
      const sukses = [];
      let galat = null;
      for (let k = 0; k < hs.length; k++) {
        const h = hs[k], entry = jendela[k];
        if (h.status === "fulfilled") { sukses.push(entry); continue; }
        if (isPermissionDenied(h.reason)) {
          const pesan = h.reason?.message || "Permission denied";
          const ditandai = await st.markDenied(entry, pesan);
          if (ditandai) { hasil.denied++; if (onDenied) onDenied(entry, pesan); }
          continue;
        }
        if (!galat) galat = h.reason;
      }
      await st.removeMany(sukses);
      hasil.sent += sukses.length;
      if (onProgress) { try { onProgress(hasil); } catch { /* callback UI tidak boleh menggagalkan pengiriman */ } }
      if (galat) { hasil.stopped = true; hasil.error = galat; return hasil; }
    }
  }
  return hasil;
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
