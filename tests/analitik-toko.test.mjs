import test from "node:test";
import assert from "node:assert/strict";
import { hitungPeringatanToko, selisihHari, tambahHari, hariIniLokal } from "../src/lib/analitikToko.js";

const produk = [{ id: "p1", nama: "Parfum A" }, { id: "p2", nama: "Parfum B" }];
const rute = [{ id: "r1", wilayahId: "w1" }, { id: "r2", wilayahId: "w2" }];
const tk = (o = {}) => ({ id: "t1", nama: "Toko 1", ruteId: "r1", status: "Aktif", produkIds: ["p1"], stok_p1: 10, ...o });
let seq = 0;
const kc = (tanggal, terjual, o = {}) => ({ id: "k" + ++seq, tokoId: "t1", tanggal, terjual_p1: terjual, ...o });
const jalan = (toko, kontrol, hariIni, extra = {}) =>
  hitungPeringatanToko({ toko, kontrol, rute, produk, hariIni, ...extra });

test("util tanggal: selisih, tambah, lintas bulan", () => {
  assert.equal(selisihHari("2026-08-31", "2026-09-10"), 10);
  assert.equal(tambahHari("2026-08-31", 10), "2026-09-10");
  assert.match(hariIniLokal(new Date(2026, 9, 19, 5, 0)), /^2026-10-19$/);
});

test("terlambat: >35 hari ditandai, 20 hari tidak, Non-Aktif dikecualikan", () => {
  const toko = [tk({ id: "a" }), tk({ id: "b" }), tk({ id: "c", status: "Non-Aktif" })];
  const kontrol = [
    { id: "1", tokoId: "a", tanggal: "2026-09-01" },
    { id: "2", tokoId: "b", tanggal: "2026-09-20" },
    { id: "3", tokoId: "c", tanggal: "2026-01-01" },
  ];
  const r = jalan(toko, kontrol, "2026-10-10");
  assert.deepEqual(r.terlambat.map((x) => x.tokoId), ["a"]);
  assert.equal(r.terlambat[0].hari, 39);
});

test("toko Aktif tanpa riwayat terlihat dihitung terpisah, tidak dituduh terlambat", () => {
  const r = jalan([tk({ id: "z" })], [], "2026-10-10");
  assert.equal(r.terlambat.length, 0);
  assert.equal(r.tanpaRiwayat, 1);
});

test("entri menunggu/ditolak diabaikan", () => {
  const kontrol = [
    { id: "1", tokoId: "t1", tanggal: "2026-08-01" },
    { id: "2", tokoId: "t1", tanggal: "2026-10-05", status: "menunggu" },
    { id: "3", tokoId: "t1", tanggal: "2026-10-06", status: "ditolak" },
  ];
  const r = jalan([tk()], kontrol, "2026-10-10");
  assert.equal(r.terlambat[0].terakhir, "2026-08-01");
});

test("restok: laju 1/hari, stok 10 → 'segera' lalu 'habis' sesuai hari ini", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-31", 30)];
  const a = jalan([tk()], kontrol, "2026-09-05");
  assert.equal(a.restok[0].level, "segera");
  assert.equal(a.restok[0].produk[0].habisTanggal, "2026-09-10");
  assert.equal(a.restok[0].produk[0].sisaHari, 5);
  const b = jalan([tk()], kontrol, "2026-09-12");
  assert.equal(b.restok[0].level, "habis");
});

test("restok 'waspada': tidak cukup sampai kunjungan berikutnya (habis < 30 hari sejak kontrol)", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-31", 30)];
  const r = jalan([tk({ stok_p1: 20 })], kontrol, "2026-09-02");
  assert.equal(r.restok[0].level, "waspada");
  const aman = jalan([tk({ stok_p1: 100 })], kontrol, "2026-09-02");
  assert.equal(aman.restok.length, 0);
});

test("interval pendek dijumlahkan, bukan merata-rata laju (5 hari/5 pcs + 25 hari/5 pcs)", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-06", 5), kc("2026-08-31", 5)];
  const r = jalan([tk({ stok_p1: 5 })], kontrol, "2026-09-01");
  assert.equal(r.restok[0].produk[0].lajuPerHari, 0.33); // 10/30, bukan (1+0,2)/2=0,6
});

test("data kurang dari 14 hari → tidak ditandai (bukan ditebak)", () => {
  const kontrol = [kc("2026-08-25", 0), kc("2026-08-31", 30)];
  const r = jalan([tk({ stok_p1: 1 })], kontrol, "2026-09-10");
  assert.equal(r.restok.length, 0);
  assert.equal(r.produkDataKurang, 1);
});

test("kunjungan 'tutup' bukan pengukuran: jarak dihitung antar pengukuran valid", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-15", 0, { catatanStatus: "tutup" }), kc("2026-08-31", 30)];
  const r = jalan([tk()], kontrol, "2026-09-05");
  assert.equal(r.restok[0].produk[0].lajuPerHari, 1); // 30/30, bukan 30/16
});

test("produk ditarik pada kunjungan terakhir dilewati; produk di luar daftar toko diabaikan", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-31", 30, { ditarik_p1: true, terjual_p2: 99 })];
  const r = jalan([tk()], kontrol, "2026-09-12");
  assert.equal(r.restok.length, 0);
});

test("laju nol tidak ditandai restok", () => {
  const kontrol = [kc("2026-08-01", 0), kc("2026-08-31", 0)];
  assert.equal(jalan([tk()], kontrol, "2026-09-12").restok.length, 0);
});

test("scope wilayah (Sales) membatasi hasil", () => {
  const toko = [tk({ id: "a", ruteId: "r1" }), tk({ id: "b", ruteId: "r2" })];
  const kontrol = [
    { id: "1", tokoId: "a", tanggal: "2026-08-01" },
    { id: "2", tokoId: "b", tanggal: "2026-08-01" },
  ];
  const r = jalan(toko, kontrol, "2026-10-10", { wilayahId: "w2" });
  assert.deepEqual(r.terlambat.map((x) => x.tokoId), ["b"]);
});

test("urutan: habis lebih dulu dari segera dari waspada", () => {
  const toko = [
    tk({ id: "w", stok_p1: 20 }), tk({ id: "s", stok_p1: 10 }), tk({ id: "h", stok_p1: 1 }),
  ];
  const kontrol = ["w", "s", "h"].flatMap((id) => [
    kc("2026-08-01", 0, { tokoId: id }), kc("2026-08-31", 30, { tokoId: id }),
  ]);
  const r = jalan(toko, kontrol, "2026-09-05");
  assert.deepEqual(r.restok.map((x) => x.tokoId), ["h", "s", "w"]);
});

test("performa: 3.800 toko × 12 kontrol < 1 detik", () => {
  const toko = [], kontrol = [];
  for (let i = 0; i < 3800; i++) {
    toko.push(tk({ id: "t" + i, produkIds: ["p1", "p2"], stok_p1: 2, stok_p2: 5 }));
    for (let m = 0; m < 12; m++) kontrol.push({ id: `k${i}-${m}`, tokoId: "t" + i, tanggal: `2026-${String(m + 1).padStart(2, "0")}-05`, terjual_p1: 3, terjual_p2: 2 });
  }
  const t0 = performance.now();
  const r = jalan(toko, kontrol, "2026-12-20");
  const ms = performance.now() - t0;
  assert.ok(r.restok.length > 0);
  assert.ok(ms < 1000, `terlalu lambat: ${ms}ms`);
});
