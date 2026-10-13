import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESENCE_CONFIG,
  klasifikasiSesi,
  signatureSesi,
  kelompokkanPengguna,
  ringkasPresence,
  teksDiam,
} from "../src/lib/presenceHelpers.js";

const MENIT = 60 * 1000;
const NOW = 1_800_000_000_000;
const sesi = (sessionId, email, umurMenit, extra = {}) => ({
  sessionId,
  email,
  nama: email.split("@")[0],
  role: "Admin",
  lastActive: NOW - umurMenit * MENIT,
  ...extra,
});

test("klasifikasiSesi: dipakai bila detak terakhir ≤ idleMs, selain itu diam", () => {
  const r = klasifikasiSesi([sesi("a", "x@x.com", 0), sesi("b", "y@y.com", 5), sesi("c", "z@z.com", 6)], NOW);
  assert.deepEqual(r.map((s) => s.dipakai), [true, true, false]); // tepat 5 mnt masih dipakai
  assert.equal(r[2].idleMs, 6 * MENIT);
});

test("klasifikasiSesi: lastActive belum terbaca (null/undefined) dianggap baru tersambung", () => {
  const r = klasifikasiSesi([sesi("a", "x@x.com", 0, { lastActive: null }), sesi("b", "y@y.com", 0, { lastActive: undefined })], NOW);
  assert.ok(r.every((s) => s.dipakai && s.idleMs === 0));
});

test("klasifikasiSesi: jam perangkat tidak dipakai langsung — serverNow menentukan", () => {
  // jam perangkat sama sekali tidak muncul; hanya serverNow yang dibandingkan dengan lastActive
  const s = sesi("a", "x@x.com", 0, { lastActive: NOW });
  assert.equal(klasifikasiSesi([s], NOW + 10 * MENIT)[0].dipakai, false);
  assert.equal(klasifikasiSesi([s], NOW + 1 * MENIT)[0].dipakai, true);
  // lastActive di "masa depan" (selisih jam kecil) tidak menghasilkan umur negatif
  assert.equal(klasifikasiSesi([s], NOW - 5000)[0].idleMs, 0);
});

test("kelompokkanPengguna: satu akun = satu baris, dipakai bila salah satu sesi dipakai", () => {
  const reg = new Set(["a@x.com", "b@x.com"]);
  const list = klasifikasiSesi(
    [sesi("1", "a@x.com", 20), sesi("2", "A@X.com", 1), sesi("3", "b@x.com", 30)],
    NOW
  );
  const g = kelompokkanPengguna(list, reg);
  assert.equal(g.length, 2);
  const a = g.find((x) => x.email.toLowerCase() === "a@x.com");
  assert.equal(a.sessionCount, 2);
  assert.equal(a.dipakai, true);
  assert.equal(a.idleMs, 1 * MENIT); // detak terbaru
  const b = g.find((x) => x.email === "b@x.com");
  assert.equal(b.dipakai, false);
});

test("kelompokkanPengguna: email tidak terdaftar disembunyikan; yang dipakai diurutkan lebih dulu", () => {
  const reg = new Set(["diam@x.com", "aktif@x.com"]);
  const list = klasifikasiSesi(
    [sesi("1", "diam@x.com", 60), sesi("2", "asing@x.com", 0), sesi("3", "aktif@x.com", 0)],
    NOW
  );
  const g = kelompokkanPengguna(list, reg);
  assert.deepEqual(g.map((x) => x.email), ["aktif@x.com", "diam@x.com"]);
});

test("ringkasPresence: hitung akun aktif vs terhubung", () => {
  const reg = new Set(["a@x.com", "b@x.com", "c@x.com"]);
  const g = kelompokkanPengguna(
    klasifikasiSesi([sesi("1", "a@x.com", 0), sesi("2", "b@x.com", 10), sesi("3", "c@x.com", 99)], NOW),
    reg
  );
  assert.deepEqual(ringkasPresence(g), { aktif: 1, terhubung: 3 });
  assert.deepEqual(ringkasPresence([]), { aktif: 0, terhubung: 0 });
});

test("signatureSesi: detak rutin tidak mengubah tanda tangan, perubahan status/menit diam mengubahnya", () => {
  const a1 = klasifikasiSesi([sesi("1", "a@x.com", 0)], NOW);
  const a2 = klasifikasiSesi([sesi("1", "a@x.com", 0, { lastActive: NOW + 40_000 })], NOW + 40_000);
  assert.equal(signatureSesi(a1), signatureSesi(a2)); // masih dipakai → tidak render ulang
  const diam6 = klasifikasiSesi([sesi("1", "a@x.com", 6)], NOW);
  const diam7 = klasifikasiSesi([sesi("1", "a@x.com", 7)], NOW);
  assert.notEqual(signatureSesi(a1), signatureSesi(diam6)); // dipakai → diam
  assert.notEqual(signatureSesi(diam6), signatureSesi(diam7)); // menit diam berubah → label berubah
});

test("teksDiam", () => {
  assert.equal(teksDiam(30_000), "<1 mnt");
  assert.equal(teksDiam(5 * MENIT), "5 mnt");
  assert.equal(teksDiam(59 * MENIT), "59 mnt");
  assert.equal(teksDiam(120 * MENIT), "2 jam");
  assert.equal(teksDiam(49 * 60 * MENIT), "2 hari");
});

test("PRESENCE_CONFIG: detak lebih rapat daripada batas diam", () => {
  assert.ok(PRESENCE_CONFIG.heartbeatMs * 2 < PRESENCE_CONFIG.idleMs);
  assert.ok(PRESENCE_CONFIG.minGapMs < PRESENCE_CONFIG.heartbeatMs);
});
