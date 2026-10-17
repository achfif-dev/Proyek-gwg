import test from "node:test";
import assert from "node:assert/strict";
import { drainQueue } from "../src/lib/offlineStore.js";

// Penyimpanan antrean palsu (memori) — meniru semantik hapus-bersyarat per versi.
function buatStore(awal) {
  const m = new Map(awal.map(e => [e.path, { ...e }]));
  return {
    map: m,
    async getAll() { return [...m.values()].filter(e => !e.denied); },
    async removeMany(entries) { let n = 0; entries.forEach(e => { const c = m.get(e.path); if (c && !c.denied && c.v === e.v) { m.delete(e.path); n++; } }); return n; },
    async markDenied(e, msg) { const c = m.get(e.path); if (c && c.v === e.v) { m.set(e.path, { ...c, denied: true, deniedMessage: msg }); return true; } return false; },
  };
}
const isi = (n, mulai = 1) => Array.from({ length: n }, (_, i) => ({ path: `kontrol/2026/K${String(mulai + i).padStart(3, "0")}`, value: { n: mulai + i }, ts: mulai + i, v: `${mulai + i}-${mulai + i}` }));
const tunda = (ms) => new Promise(r => setTimeout(r, ms));

test("pipelining: 40 tulisan @40ms selesai jauh lebih cepat daripada berurutan (1600ms)", async () => {
  const store = buatStore(isi(40));
  const t0 = Date.now();
  const hasil = await drainQueue(async () => { await tunda(40); }, { store, concurrency: 20 });
  const dur = Date.now() - t0;
  assert.equal(hasil.sent, 40); assert.equal(hasil.stopped, false);
  assert.equal(store.map.size, 0);
  assert.ok(dur < 600, `terlalu lambat: ${dur}ms`);
});

test("urutan terbit send() = urutan ts (ketergantungan antar-path aman)", async () => {
  const store = buatStore(isi(25));
  const panggilan = [];
  await drainQueue(async (path) => { panggilan.push(path); await tunda(5); }, { store, concurrency: 10 });
  assert.deepEqual(panggilan, [...panggilan].sort());
  assert.equal(panggilan.length, 25);
});

test("PERMISSION_DENIED hanya menandai entri itu; yang lain tetap terkirim", async () => {
  const store = buatStore(isi(10));
  const ditolak = [];
  const hasil = await drainQueue(async (path) => {
    if (path.endsWith("K005")) throw Object.assign(new Error("PERMISSION_DENIED: x"), { code: "PERMISSION_DENIED" });
  }, { store, onDenied: (e) => ditolak.push(e.path) });
  assert.equal(hasil.sent, 9); assert.equal(hasil.denied, 1); assert.equal(hasil.stopped, false);
  assert.deepEqual(ditolak, ["kontrol/2026/K005"]);
  assert.equal(store.map.get("kontrol/2026/K005").denied, true);
  assert.equal(store.map.size, 1);
});

test("error jaringan: berhenti, yang sudah sukses dihapus, sisanya tetap di antrean", async () => {
  const store = buatStore(isi(30));
  const hasil = await drainQueue(async (path) => {
    if (path.endsWith("K003")) throw new Error("network");
  }, { store, concurrency: 5 });
  assert.equal(hasil.stopped, true);
  assert.equal(hasil.sent, 4); // K001,K002,K004,K005 di jendela pertama
  assert.ok(store.map.has("kontrol/2026/K003"));
  assert.ok(store.map.has("kontrol/2026/K010")); // jendela berikutnya belum disentuh
  assert.equal(store.map.size, 26);
});

test("tulisan tak di-ACK (socket mati diam-diam) → timeout, antrean tidak hilang", async () => {
  const store = buatStore(isi(3));
  const hasil = await drainQueue(() => new Promise(() => {}), { store, timeoutMs: 50 });
  assert.equal(hasil.stopped, true);
  assert.equal(hasil.error.code, "kirim/timeout");
  assert.equal(store.map.size, 3);
});

test("entri baru yang masuk selama pengiriman diproses di putaran berikutnya", async () => {
  const store = buatStore(isi(5));
  let sudahTambah = false;
  const hasil = await drainQueue(async () => {
    if (!sudahTambah) { sudahTambah = true; isi(3, 100).forEach(e => store.map.set(e.path, e)); }
    await tunda(5);
  }, { store, concurrency: 5 });
  assert.equal(hasil.sent, 8); assert.equal(store.map.size, 0);
});

test("edit baru di path yang sama selama pengiriman TIDAK ikut terhapus (versi beda)", async () => {
  const store = buatStore(isi(2));
  const hasil = await drainQueue(async (path) => {
    if (path.endsWith("K001")) store.map.set(path, { path, value: { n: 999 }, ts: 999, v: "999-999" });
    await tunda(5);
  }, { store, concurrency: 5 });
  assert.ok(hasil.sent >= 2);
  assert.equal(store.map.size, 0); // versi baru dikirim di putaran berikutnya, lalu terhapus
});

test("timeout → entri 'terbang': TIDAK dikirim ulang (tak menumpuk salinan di buffer SDK)", async () => {
  const store = buatStore(isi(3));
  const terbang = new Map();
  let jumlahKirim = 0;
  const sendMati = () => { jumlahKirim++; return new Promise(() => {}); };
  await drainQueue(sendMati, { store, timeoutMs: 30, terbang });
  assert.equal(jumlahKirim, 3); assert.equal(terbang.size, 3);
  const h2 = await drainQueue(sendMati, { store, timeoutMs: 30, terbang });
  assert.equal(jumlahKirim, 3); // tidak ada send() baru
  assert.equal(h2.terbang, 3); assert.equal(store.map.size, 3);
});

test("balasan TERLAMBAT dari SDK menghapus entri dari antrean & memanggil onLateOk", async () => {
  const store = buatStore(isi(2));
  const terbang = new Map(); const lateOk = [];
  const penyelesai = [];
  const send = () => new Promise(res => penyelesai.push(res));
  const h = await drainQueue(send, { store, timeoutMs: 20, terbang, onLateOk: e => lateOk.push(e.path) });
  assert.equal(h.stopped, true); assert.equal(store.map.size, 2);
  penyelesai.forEach(r => r()); // SDK akhirnya membalas (mis. setelah putus-sambung)
  await tunda(20);
  assert.equal(store.map.size, 0);
  assert.equal(lateOk.length, 2); assert.equal(terbang.size, 0);
});

test("tanda 'terbang' kedaluwarsa setelah TTL → boleh dikirim ulang", async () => {
  const store = buatStore(isi(1));
  const terbang = new Map(); let n = 0;
  const send = () => { n++; return new Promise(() => {}); };
  await drainQueue(send, { store, timeoutMs: 20, terbang, terbangTtlMs: 40 });
  await tunda(60);
  await drainQueue(send, { store, timeoutMs: 20, terbang, terbangTtlMs: 40 });
  assert.equal(n, 2);
});
