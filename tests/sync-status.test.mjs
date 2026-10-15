import test from "node:test";
import assert from "node:assert/strict";
import { deriveSyncStatus, SYNC_STUCK_MS } from "../src/lib/syncStatus.js";

const dasar = { isOnline: true, fbConnected: true };

test("normal: terhubung → ok", () => {
  const s = deriveSyncStatus({ ...dasar, lastSync: new Date() });
  assert.equal(s.key, "ok"); assert.equal(s.level, "ok");
});
test("perangkat punya jaringan tapi socket Firebase putus → bukan OK", () => {
  const s = deriveSyncStatus({ ...dasar, fbConnected: false, pendingSync: 3 });
  assert.equal(s.key, "putus"); assert.equal(s.count, 3);
});
test("fbConnected belum diketahui (null) tidak dianggap putus", () => {
  assert.equal(deriveSyncStatus({ isOnline: true, fbConnected: null }).key, "ok");
});
test("perubahan ditolak server mengalahkan semua status lain (bukan OK)", () => {
  const s = deriveSyncStatus({ ...dasar, writeDeniedCount: 2, pendingSync: 5, syncing: true });
  assert.equal(s.key, "ditolak"); assert.equal(s.level, "bad"); assert.equal(s.count, 2);
});
test("offline perangkat", () => {
  const s = deriveSyncStatus({ isOnline: false, fbConnected: false, pendingSync: 2 });
  assert.equal(s.key, "offline"); assert.equal(s.count, 2);
});
test("antrean: mengirim vs macet (batas waktu tanpa kemajuan)", () => {
  const now = 1_000_000;
  assert.equal(deriveSyncStatus({ ...dasar, pendingSync: 4, sendProgressAt: now - 5000, now }).key, "mengirim");
  assert.equal(deriveSyncStatus({ ...dasar, pendingSync: 4, sendProgressAt: now - SYNC_STUCK_MS - 1, now }).key, "macet");
});
test("syncError tampil, memuat awal berputar", () => {
  assert.equal(deriveSyncStatus({ ...dasar, syncError: "boom" }).key, "error");
  const m = deriveSyncStatus({ ...dasar, syncing: true });
  assert.equal(m.key, "memuat"); assert.equal(m.spin, true);
});
test("jam OK memakai yang terbaru antara data diterima dan perubahan terkirim", () => {
  const a = new Date(2026, 9, 15, 10, 0).getTime(), b = new Date(2026, 9, 15, 11, 30).getTime();
  const s = deriveSyncStatus({ ...dasar, lastSync: a, lastSendOk: b });
  assert.match(s.label, /11[.:]30/);
});

import { keputusanFlush, teksKendala } from "../src/lib/syncStatus.js";
test("kunci flush: mulai / tunda / ambil-alih bila menggantung", () => {
  assert.equal(keputusanFlush({ berjalan: false, mulai: 0, now: 1000 }), "mulai");
  assert.equal(keputusanFlush({ berjalan: true, mulai: 1000, now: 20000 }), "tunda");
  assert.equal(keputusanFlush({ berjalan: true, mulai: 1000, now: 1000 + 90001 }), "ambil-alih");
});
test("status macet menampilkan kendala terakhir (kode + pesan) saat diketuk", () => {
  const now = 1_000_000;
  const s = deriveSyncStatus({ ...dasar, pendingSync: 5, sendProgressAt: now - 60000, now,
    sendError: { code: "kirim/timeout", message: "Waktu kirim habis (tidak ada balasan server)" } });
  assert.equal(s.key, "macet");
  assert.match(s.title, /kirim\/timeout/);
  assert.match(teksKendala({ message: "x" }), /Kendala terakhir: x/);
  assert.equal(teksKendala(null), "");
});
