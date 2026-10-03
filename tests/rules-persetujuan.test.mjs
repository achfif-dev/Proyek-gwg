// Regresi alur persetujuan Sales (Rules v14 + guard klien).
// Jalankan: node --import ./tests/register.mjs --test tests/rules-persetujuan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync(new URL("../firebase-rules/database_rules_v14_kontrol_hapus_sales.json", import.meta.url), "utf8"));
const node = rules.rules.gwg_data.shared.kontrol["$tahun"]["$id"];
// Pengganti method string khas Firebase Rules untuk evaluasi lokal.
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
    parent: () => snap(tree, path.slice(0, -1)),
  };
}
const run = (expr, vars) => { const n = Object.keys(vars); return new Function(...n, `return (${expr});`)(...n.map((k) => vars[k])); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const NOW = 1_800_000_000_000, H = 3_600_000, SALES = "sales.a@x.com";
const base = { gwg_data: { shared: {
  pengguna: { ["U_" + enc(SALES)]: { role: "Sales", wilayahId: "W1", email: SALES } },
  toko: { T1: { ruteId: "R1" } }, rute: { R1: { wilayahId: "W1" } }, kontrol: {},
} } };
const auth = { token: { email: SALES, email_verified: true } };
const ID = "2026-09-T1-abc";
const P = ["gwg_data", "shared", "kontrol", "2026", ID];
const rec = { id: ID, tokoId: "T1", status: "menunggu", autoApproveAt: NOW + 24 * H, createdAt: NOW, createdBy: SALES, tanggal: "2026-09-30", stok_P1: 5, terjual_P1: 2, bonusInput_P1: 0, ditarik_P1: false };
const withKontrol = (r) => { const t = clone(base); t.gwg_data.shared.kontrol = { 2026: { [ID]: r } }; return t; };
const validate = (before, after, f) => run(node["$field"][".validate"], {
  auth, root: snap(after), data: snap(before, [...P, f]), newData: snap(after, [...P, f]), now: NOW, $tahun: "2026", $id: ID, $field: f });

test("Sales boleh membuat pengajuan kontrol baru (status menunggu) di wilayahnya", () => {
  const before = clone(base), after = withKontrol(rec);
  assert.equal(run(node[".write"], { auth, root: snap(after), data: snap(before, P), newData: snap(after, P), now: NOW, $tahun: "2026", $id: ID }), true);
  for (const f of Object.keys(rec)) assert.equal(validate(before, after, f), true, `field ${f} ditolak`);
});

function autoApprove(withServerTs) {
  const before = withKontrol({ ...rec, createdAt: NOW - 25 * H, autoApproveAt: NOW - H, ...(withServerTs ? { diterimaServerAt: NOW - 25 * H } : {}) });
  const after = clone(before);
  Object.assign(after.gwg_data.shared.kontrol[2026][ID], { status: "disetujui", disetujuiOleh: "Otomatis (24 jam)" });
  return validate(before, after, "status");
}
test("Rules menolak Sales auto-approve kalau diterimaServerAt tidak ada (kondisi klien saat ini)", () => {
  assert.equal(autoApprove(false), false);
});
test("Rules mengizinkan Sales auto-approve > 24 jam HANYA kalau diterimaServerAt ada", () => {
  assert.equal(autoApprove(true), true);
});

test("Klien: tiga efek auto-approve di TabKontrol dijaga isManajer", () => {
  const src = readFileSync(new URL("../src/features/kontrol/TabKontrol.jsx", import.meta.url), "utf8");
  for (const tabel of ["penyesuaian", "kontrol", "penarikanToko"]) {
    const i = src.indexOf(`const expired = (db.${tabel}||[]).filter(`);
    assert.ok(i > 0, `efek ${tabel} tidak ditemukan`);
    const awal = src.lastIndexOf("useEffect(() => {", i);
    assert.match(src.slice(awal, i), /if \(!isManajer\) return;/, `efek ${tabel} tanpa guard isManajer`);
    const akhir = src.indexOf("}, [db.", i);
    assert.match(src.slice(akhir, akhir + 60), /isManajer\]/, `dependency ${tabel} tanpa isManajer`);
  }
});
