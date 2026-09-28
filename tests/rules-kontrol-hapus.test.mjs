// Menguji TEKS aturan asli (bukan salinan logika) untuk hapus kontrol oleh Sales.
// Ekspresi .write dievaluasi dengan mock snapshot Firebase minimal.
// Jalankan: node --import ./tests/register.mjs --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync(new URL("../firebase-rules/database_rules_v14_kontrol_hapus_sales.json", import.meta.url), "utf8"));
const node = rules.rules.gwg_data.shared.kontrol["$tahun"]["$id"];
const encodeEmailKey = (e) => e.toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_").replace(/[#$\[\]/]/g, "_");

// Snapshot mock: membungkus nilai + path, mendukung child/val/exists/isNumber/parent/hasChildren.
function snap(tree, path = []) {
  const get = () => path.reduce((n, k) => (n == null ? undefined : n[k]), tree);
  return {
    child: (p) => snap(tree, [...path, ...String(p).split("/")]),
    val: () => { const v = get(); return v === undefined ? null : v; },
    exists: () => get() !== undefined && get() !== null,
    isNumber: () => typeof get() === "number",
    hasChildren: () => get() && typeof get() === "object" && Object.keys(get()).length > 0,
    parent: () => snap(tree, path.slice(0, -1)),
  };
}

const SALES = "sales.a@x.com";
const NOW = 1_800_000_000_000;
const HARI = 86_400_000;

function bolehHapus({ rec, email = SALES, wilayah = "W1", role = "Sales" }) {
  const tree = {
    gwg_data: { shared: {
      pengguna: { ["U_" + encodeEmailKey(email)]: { role, wilayahId: wilayah, email } },
      toko: { T1: { ruteId: "R1" } },
      rute: { R1: { wilayahId: "W1" } },
      kontrol: { 2026: { K1: rec } },
    } },
  };
  const root = snap(tree);
  const data = root.child("gwg_data/shared/kontrol/2026/K1");
  const newData = snap({}, ["x"]); // dihapus → tidak ada
  const auth = { token: { email, email_verified: true } };
  const fn = new Function("auth", "root", "data", "newData", "now", `return (${node[".write"]});`);
  return fn(auth, root, data, newData, NOW);
}

const dasar = { tokoId: "T1", status: "menunggu", createdAt: NOW - HARI / 2, createdBy: SALES };

test("Sales boleh hapus entri MENUNGGU miliknya sendiri < 24 jam", () => {
  assert.equal(bolehHapus({ rec: dasar }), true);
});
test("Sales TIDAK boleh hapus entri yang sudah DISETUJUI (< 24 jam)", () => {
  assert.equal(bolehHapus({ rec: { ...dasar, status: "disetujui" } }), false);
});
test("Sales TIDAK boleh hapus entri DITOLAK", () => {
  assert.equal(bolehHapus({ rec: { ...dasar, status: "ditolak" } }), false);
});
test("Sales TIDAK boleh hapus entri milik Sales lain di wilayah yang sama", () => {
  assert.equal(bolehHapus({ rec: { ...dasar, createdBy: "sales.b@x.com" } }), false);
});
test("Sales TIDAK boleh hapus entri lama tanpa createdBy (harus lewat pengajuan)", () => {
  const { createdBy, ...tanpa } = dasar;
  assert.equal(bolehHapus({ rec: tanpa }), false);
});
test("Sales TIDAK boleh hapus entri > 24 jam", () => {
  assert.equal(bolehHapus({ rec: { ...dasar, createdAt: NOW - HARI - 1000 } }), false);
});
test("Sales TIDAK boleh hapus entri wilayah lain", () => {
  assert.equal(bolehHapus({ rec: dasar, wilayah: "W2" }), false);
});
test("Manajer tetap boleh hapus entri apa pun", () => {
  assert.equal(bolehHapus({ rec: { ...dasar, status: "disetujui", createdBy: "lain@x.com", createdAt: NOW - 30 * HARI }, email: "mgr@x.com", role: "Manajer", wilayah: "" }), true);
});

test("Rules v14: createdBy dilindungi di validate & dipakai di create", () => {
  assert.match(node["$field"][".validate"], /\$field === 'createdBy'/);
  assert.match(node[".write"], /newData\.child\('createdBy'\)\.val\(\) === auth\.token\.email/);
});
