// Rules v15: periode yang sudah ditutup buku mengunci kontrol, penjualanLuar,
// penyesuaian, dan penarikanToko (pola sama dengan kasTransaksi/jurnal).
// Jalankan: node --import ./tests/register.mjs --test tests/rules-tutupbuku.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync(new URL("../firebase-rules/database_rules_v15_tutupbuku_operasional.json", import.meta.url), "utf8"));
const S = rules.rules.gwg_data.shared;
String.prototype.matches = function (r) { return r.test(String(this)); };
String.prototype.beginsWith = function (s) { return String(this).startsWith(s); };

const enc = (e) => e.toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_");
function snap(tree, path = []) {
  const get = () => path.reduce((n, k) => (n == null ? undefined : n[k]), tree);
  return {
    child: (p) => snap(tree, [...path, ...String(p).split("/")]),
    val: () => { const v = get(); return v === undefined ? null : v; },
    exists: () => get() !== undefined && get() !== null,
    isNumber: () => typeof get() === "number",
    isString: () => typeof get() === "string",
    hasChildren: () => !!get() && typeof get() === "object" && Object.keys(get()).length > 0,
    hasChild: (k) => { const v = get(); return !!v && typeof v === "object" && v[k] !== undefined && v[k] !== null; },
    parent: () => snap(tree, path.slice(0, -1)),
  };
}
const run = (expr, vars) => { const n = Object.keys(vars); return new Function(...n, `return (${expr});`)(...n.map((k) => vars[k])); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const NOW = 1_800_000_000_000, H = 3_600_000;
const ADMIN = "adm@x.com", SALES = "sales.a@x.com";
const authOf = (email) => ({ token: { email, email_verified: true } });
const base = { gwg_data: { shared: {
  pengguna: {
    ["U_" + enc(ADMIN)]: { role: "Admin", email: ADMIN },
    ["U_" + enc(SALES)]: { role: "Sales", wilayahId: "W1", email: SALES },
  },
  toko: { T1: { ruteId: "R1" } }, rute: { R1: { wilayahId: "W1" } },
  tutupBuku: { "2026-08": { id: "2026-08" } },   // Agustus 2026 terkunci
  kontrol: {}, penyesuaian: {}, penjualanLuar: {}, penarikanToko: {},
} } };

const TERKUNCI = "2026-08-15", TERBUKA = "2026-09-15";
const kontrolRec = (tgl, extra = {}) => ({ id: "K1", tokoId: "T1", status: "menunggu", autoApproveAt: NOW + 24 * H, createdAt: NOW, createdBy: SALES, tanggal: tgl, stok_P1: 5, ...extra });
const withRec = (kol, tahun, rec) => { const t = clone(base); t.gwg_data.shared[kol] = tahun ? { [tahun]: { [rec.id]: rec } } : { [rec.id]: rec }; return t; };

// Evaluasi .write di level $id: before/after = isi record (undefined = tidak ada).
function writeId(kol, email, beforeRec, afterRec) {
  const tahun = kol === "kontrol" ? "2026" : null;
  const id = (beforeRec || afterRec).id;
  const node = tahun ? S[kol]["$tahun"]["$id"] : S[kol]["$id"];
  const path = ["gwg_data", "shared", kol, ...(tahun ? [tahun] : []), id];
  const b = beforeRec ? withRec(kol, tahun, beforeRec) : clone(base);
  const a = afterRec ? withRec(kol, tahun, afterRec) : clone(base);
  return run(node[".write"], { auth: authOf(email), root: snap(a), data: snap(b, path), newData: snap(a, path), now: NOW, $tahun: tahun, $id: id });
}

test("Admin: ubah/hapus kontrol di bulan terkunci DITOLAK, di bulan terbuka boleh", () => {
  assert.equal(writeId("kontrol", ADMIN, kontrolRec(TERBUKA), kontrolRec(TERBUKA, { status: "disetujui" })), true);
  assert.equal(writeId("kontrol", ADMIN, kontrolRec(TERKUNCI), kontrolRec(TERKUNCI, { status: "disetujui" })), false);
  assert.equal(writeId("kontrol", ADMIN, kontrolRec(TERKUNCI), undefined), false);          // hapus
  assert.equal(writeId("kontrol", ADMIN, undefined, kontrolRec(TERKUNCI)), false);          // buat baru
});

test("Admin tidak bisa memindahkan kontrol dari bulan terkunci ke bulan terbuka (atau sebaliknya)", () => {
  assert.equal(writeId("kontrol", ADMIN, kontrolRec(TERKUNCI), kontrolRec(TERBUKA)), false);
  assert.equal(writeId("kontrol", ADMIN, kontrolRec(TERBUKA), kontrolRec(TERKUNCI)), false);
});

test("Sales: buat pengajuan kontrol di bulan terkunci DITOLAK, di bulan terbuka boleh", () => {
  assert.equal(writeId("kontrol", SALES, undefined, kontrolRec(TERBUKA)), true);
  assert.equal(writeId("kontrol", SALES, undefined, kontrolRec(TERKUNCI)), false);
});

test("Sales: tulis per-field pada kontrol di bulan terkunci DITOLAK", () => {
  const field = (tgl) => {
    const b = withRec("kontrol", "2026", kontrolRec(tgl));
    const a = clone(b); a.gwg_data.shared.kontrol[2026].K1.stok_P1 = 9;
    const P = ["gwg_data", "shared", "kontrol", "2026", "K1", "stok_P1"];
    return run(S.kontrol["$tahun"]["$id"]["$field"][".write"], { auth: authOf(SALES), root: snap(a), data: snap(b, P), newData: snap(a, P), now: NOW, $tahun: "2026", $id: "K1", $field: "stok_P1" });
  };
  assert.equal(field(TERBUKA), true);
  assert.equal(field(TERKUNCI), false);
});

test("penyesuaian / penjualanLuar / penarikanToko: bulan terkunci ditolak, bulan terbuka boleh", () => {
  for (const kol of ["penyesuaian", "penjualanLuar", "penarikanToko"]) {
    const rec = (tgl) => ({ id: "X1", tokoId: "T1", tanggal: tgl, status: "menunggu", autoApproveAt: NOW + 24 * H, createdAt: NOW, createdBy: SALES });
    assert.equal(writeId(kol, ADMIN, undefined, rec(TERBUKA)), true, `${kol} terbuka`);
    assert.equal(writeId(kol, ADMIN, undefined, rec(TERKUNCI)), false, `${kol} terkunci (buat)`);
    assert.equal(writeId(kol, ADMIN, rec(TERKUNCI), undefined), false, `${kol} terkunci (hapus)`);
  }
});

test("Record tanpa tanggal tidak ikut terkunci (kompatibel dengan data lama)", () => {
  const r = kontrolRec(TERBUKA); delete r.tanggal;
  assert.equal(writeId("kontrol", ADMIN, undefined, r), true);
});

test("Klien: tiga efek auto-approve melewati entri periode terkunci", () => {
  const src = readFileSync(new URL("../src/features/kontrol/TabKontrol.jsx", import.meta.url), "utf8");
  for (const [tabel, v] of [["penyesuaian", "pz"], ["kontrol", "k"], ["penarikanToko", "pk"]]) {
    assert.ok(src.includes(`&& !isPeriodeTerkunci(db.tutupBuku || [], ${v}.tanggal)`), `efek ${tabel} tanpa filter periode terkunci`);
    assert.ok(src.includes(`}, [db.${tabel}, db.tutupBuku, isManajer]);`), `dependency ${tabel} tanpa db.tutupBuku`);
  }
});
