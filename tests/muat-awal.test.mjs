import test from "node:test";
import assert from "node:assert/strict";
import { keputusanMuatAwal as k } from "../src/lib/syncStatus.js";

test("tak terhubung → selalu tahan (salinan lokal aman)", () => {
  assert.equal(k({ terhubung: false, jumlahBaru: 0, jumlahLokal: 500 }), "tahan");
  assert.equal(k({ terhubung: false, jumlahBaru: 500, jumlahLokal: 500 }), "tahan");
});
test("terhubung, hasil kosong padahal lokal ada → tahan sampai koneksi stabil", () => {
  assert.equal(k({ terhubung: true, jumlahBaru: 0, jumlahLokal: 500, lamaTerhubungMs: 12000 }), "tahan");
  assert.equal(k({ terhubung: true, jumlahBaru: 0, jumlahLokal: 500, lamaTerhubungMs: 46000 }), "terima");
});
test("terhubung, hasil menyusut tajam (<80%) → tahan; wajar → terima", () => {
  assert.equal(k({ terhubung: true, jumlahBaru: 30, jumlahLokal: 500, lamaTerhubungMs: 5000 }), "tahan");
  assert.equal(k({ terhubung: true, jumlahBaru: 450, jumlahLokal: 500, lamaTerhubungMs: 5000 }), "terima");
  assert.equal(k({ terhubung: true, jumlahBaru: 520, jumlahLokal: 500, lamaTerhubungMs: 5000 }), "terima");
});
test("pemasangan baru (lokal kosong) → terima apa adanya, termasuk kosong", () => {
  assert.equal(k({ terhubung: true, jumlahBaru: 0, jumlahLokal: 0 }), "terima");
});
