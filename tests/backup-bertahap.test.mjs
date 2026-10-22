import test from "node:test";
import assert from "node:assert/strict";
import { bagiPotongan, simpanBackupCloud } from "../src/lib/backupRestore.js";

// Cloud palsu: pohon JSON + log urutan operasi.
function cloudPalsu(awal = {}) {
  const root = JSON.parse(JSON.stringify(awal)); const log = [];
  const parts = (p) => p.split("/").filter(Boolean);
  const taruh = (path, val) => {
    const ps = parts(path); let o = root;
    for (let i = 0; i < ps.length - 1; i++) { o[ps[i]] ??= {}; o = o[ps[i]]; }
    if (val === null) delete o[ps.at(-1)]; else o[ps.at(-1)] = val;
  };
  const ambil = (path) => parts(path).reduce((o, k) => (o == null ? undefined : o[k]), root);
  const fb = {
    rtdb: {}, ref: (_, p) => p,
    set: async (p, v) => { log.push(["set", p, JSON.stringify(v ?? null).length]); taruh(p, v); },
    update: async (p, obj) => { log.push(["update", p, JSON.stringify(obj).length]); for (const [k, v] of Object.entries(obj)) taruh(`${p}/${k}`, v); },
    get: async (p) => ({ val: () => ambil(p) ?? null }),
    shallowKeys: async (p) => Object.keys(ambil(p) || {}),
  };
  return { fb, root, log };
}
const rec = (i) => ({ id: `K${i}`, tanggal: "2026-10-22", catatan: "x".repeat(200) });
const snap = (n) => ({ ts: "2026-10-22T01:00:00Z", reason: "auto-harian", versi: 2, jurnalUmumDikecualikan: false,
  data: { kontrol: Array.from({ length: n }, (_, i) => rec(i)), stokAwal: { A: 1, B: 2 }, bagiHasilConfig: { x: 1 }, daftarAkun: null, produk: [] } });

test("bagiPotongan: tiap potongan ≤ batas dan tidak ada data hilang", () => {
  const arr = Array.from({ length: 1000 }, (_, i) => rec(i));
  const p = bagiPotongan(arr, 20000);
  assert.ok(p.length > 5);
  p.forEach(x => assert.ok(JSON.stringify(x).length <= 20000 + 400));
  assert.equal(p.reduce((a, x) => a + Object.keys(x).length, 0), 1000);
});

test("hasil di cloud sama dengan satu set() lama; tiap tulisan kecil; metadata terakhir", async () => {
  const { fb, root, log } = cloudPalsu();
  await simpanBackupCloud(fb, snap(900), "2026-10-22", 5, { jedaMs: 0, batas: 30000 });
  const b = root.gwg_data._backups["2026-10-22"];
  assert.equal(Object.keys(b.data.kontrol).length, 900);
  assert.deepEqual(Object.values(b.data.kontrol)[899], rec(899));
  assert.deepEqual(b.data.stokAwal, { A: 1, B: 2 });
  assert.equal(b.ts, "2026-10-22T01:00:00Z"); assert.equal(b.versi, 2); assert.equal(b.jurnalUmumDikecualikan, false);
  assert.equal(b.data.produk, undefined); assert.equal(b.data.daftarAkun, undefined);
  assert.ok(Math.max(...log.map(l => l[2])) < 32000, "tidak ada tulisan raksasa");
  assert.ok(log.filter(l => l[0] === "update").length > 5);
  assert.equal(log.at(-1)[1], "gwg_data/_backups/2026-10-22"); // metadata paling akhir
  assert.equal(log[0][0], "set");                               // kosongkan dulu
});

test("gagal di tengah → tidak ada ts (dianggap belum lengkap)", async () => {
  const { fb, root } = cloudPalsu(); let n = 0; const asli = fb.update;
  fb.update = async (p, o) => { if (++n === 3) throw new Error("putus"); return asli(p, o); };
  await assert.rejects(simpanBackupCloud(fb, snap(900), "2026-10-22", 5, { jedaMs: 0, batas: 30000 }), /putus/);
  assert.equal(root.gwg_data._backups["2026-10-22"].ts, undefined);
});

test("timeout per potongan melempar backup/timeout", async () => {
  const { fb } = cloudPalsu(); fb.update = () => new Promise(() => {});
  await assert.rejects(simpanBackupCloud(fb, snap(10), "k", 5, { jedaMs: 0, timeoutMs: 30 }), (e) => e.code === "backup/timeout");
});

test("pangkas: hapus backup tak lengkap dan sisakan maxBackups terbaru", async () => {
  const lama = (ts) => ({ ts, data: { toko: { 0: { id: "T" } } } });
  const { fb, root } = cloudPalsu({ gwg_data: { _backups: {
    "2026-10-19": lama("a"), "2026-10-20": lama("b"), "2026-10-21": lama("c"), "2026-10-21-rusak": { data: { kontrol: { 0: {} } } } } } });
  await simpanBackupCloud(fb, snap(5), "2026-10-22", 2, { jedaMs: 0 });
  assert.deepEqual(Object.keys(root.gwg_data._backups).sort(), ["2026-10-21", "2026-10-22"]);
});

test("tanpa shallowKeys: tidak memangkas dan tidak mengunduh semua backup", async () => {
  const { fb, root } = cloudPalsu({ gwg_data: { _backups: { "2026-10-01": { ts: "a" } } } });
  delete fb.shallowKeys; let unduh = 0; const g = fb.get; fb.get = async (p) => { unduh++; return g(p); };
  await simpanBackupCloud(fb, snap(5), "2026-10-22", 1, { jedaMs: 0 });
  assert.equal(unduh, 0); assert.ok(root.gwg_data._backups["2026-10-01"]);
});

// ── Daftar & isi backup (hemat unduhan) ──
import { daftarBackupMeta, ambilIsiBackup } from "../src/lib/backupRestore.js";
function cloudDenganUnduh(awal) {
  const c = cloudPalsu(awal); const diunduh = []; const g = c.fb.get;
  c.fb.get = async (p) => { const r = await g(p); diunduh.push([p, JSON.stringify(r.val() ?? null).length]); return r; };
  return { ...c, diunduh };
}
const besar = { toko: { 0: { id: "T1" } }, kontrol: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [i, rec(i)])) };
const awal = { gwg_data: { _backups: {
  "2026-10-20": { ts: "a", reason: "auto-harian", jurnalUmumDikecualikan: false, data: besar },
  "2026-10-21": { ts: "b", reason: "manual", data: besar },
  "2026-10-21-rusak": { data: besar } } } };

test("daftarBackupMeta: hanya metadata, tanpa mengunduh isi data; backup tak lengkap disembunyikan", async () => {
  const { fb, diunduh } = cloudDenganUnduh(awal);
  const d = await daftarBackupMeta(fb);
  assert.deepEqual(d.map(x => x.key), ["2026-10-21", "2026-10-20"]);
  assert.equal(d[1].reason, "auto-harian"); assert.equal(d[0].data, undefined);
  assert.ok(diunduh.reduce((a, x) => a + x[1], 0) < 500, "total unduhan hanya byte metadata");
});

test("daftarBackupMeta: gagal baca kunci → melempar (bukan daftar kosong palsu)", async () => {
  const { fb } = cloudPalsu(awal); fb.shallowKeys = async () => null;
  await assert.rejects(daftarBackupMeta(fb), /daftar backup/);
});

test("ambilIsiBackup: sama dengan data asli, diunduh per tabel dan hanya untuk kunci terpilih", async () => {
  const { fb, diunduh } = cloudDenganUnduh(awal);
  const isi = await ambilIsiBackup(fb, "2026-10-20");
  assert.deepEqual(isi, besar);
  assert.ok(diunduh.length === 2 && diunduh.every(x => x[0].startsWith("gwg_data/_backups/2026-10-20/data/")));
});

test("ambilIsiBackup: backup tanpa data → objek kosong (UI membatalkan restore)", async () => {
  const { fb } = cloudPalsu({ gwg_data: { _backups: { k: { ts: "a" } } } });
  assert.deepEqual(await ambilIsiBackup(fb, "k"), {});
});
