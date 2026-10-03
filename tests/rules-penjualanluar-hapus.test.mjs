// Rules v16: Sales tidak boleh menghapus/mengubah penjualan luar rute yang sudah ada
// (jurnalnya tidak bisa di-void dari perangkat Sales). Buat baru tetap boleh.
// Jalankan: node --import ./tests/register.mjs --test tests/rules-penjualanluar-hapus.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync(new URL("../firebase-rules/database_rules_v16_penjualanluar_hapus.json", import.meta.url), "utf8"));
const node = rules.rules.gwg_data.shared.penjualanLuar["$id"];
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

const NOW = 1_800_000_000_000, ADMIN = "adm@x.com", MGR = "mgr@x.com", SALES = "sales.a@x.com", SALES2 = "sales.b@x.com";
const authOf = (email) => ({ token: { email, email_verified: true } });
const base = { gwg_data: { shared: {
  pengguna: {
    ["U_" + enc(ADMIN)]: { role: "Admin" }, ["U_" + enc(MGR)]: { role: "Manajer" },
    ["U_" + enc(SALES)]: { role: "Sales", wilayahId: "W1" }, ["U_" + enc(SALES2)]: { role: "Sales", wilayahId: "W2" },
  },
  tutupBuku: { "2026-08": { id: "2026-08" } }, penjualanLuar: {},
} } };
const rec = (tgl = "2026-09-15", wil = "W1") => ({ id: "PLR1", tanggal: tgl, wilayahId: wil, terjual_P1: 3, bonusInput_P1: 0 });
const P = ["gwg_data", "shared", "penjualanLuar", "PLR1"];
function w(email, before, after) {
  const b = clone(base), a = clone(base);
  if (before) b.gwg_data.shared.penjualanLuar.PLR1 = before;
  if (after) a.gwg_data.shared.penjualanLuar.PLR1 = after;
  return run(node[".write"], { auth: authOf(email), root: snap(a), data: snap(b, P), newData: snap(a, P), now: NOW, $id: "PLR1" });
}

test("Sales boleh MENCATAT penjualan luar baru di wilayahnya, tidak di wilayah lain", () => {
  assert.equal(w(SALES, undefined, rec()), true);
  assert.equal(w(SALES2, undefined, rec()), false);
});
test("Sales TIDAK boleh menghapus penjualan luar (wilayah sendiri maupun lain)", () => {
  assert.equal(w(SALES, rec(), undefined), false);
  assert.equal(w(SALES2, rec(), undefined), false);
});
test("Sales tidak boleh mengubah penjualan luar yang sudah ada", () => {
  assert.equal(w(SALES, rec(), { ...rec(), terjual_P1: 99 }), false);
});
test("Admin dan Manajer tetap boleh menghapus di bulan terbuka, tapi tidak di bulan terkunci", () => {
  for (const e of [ADMIN, MGR]) {
    assert.equal(w(e, rec(), undefined), true, `${e} bulan terbuka`);
    assert.equal(w(e, rec("2026-08-10"), undefined), false, `${e} bulan terkunci`);
  }
});
test("Klien: tombol dan fungsi hapus penjualan luar dijaga isSalesRestricted", () => {
  const src = readFileSync(new URL("../src/features/kontrol/TabKontrol.jsx", import.meta.url), "utf8");
  const i = src.indexOf("function deleteLuarRute(id) {");
  assert.match(src.slice(i, i + 900), /if \(isSalesRestricted\) \{/);
  assert.match(src, /\{!isSalesRestricted && \(\s*<Btn variant="danger" size="sm" icon=\{Icon\.delete\} onClick=\{\(\)=>deleteLuarRute\(pl\.id\)\}>Hapus<\/Btn>/);
});
