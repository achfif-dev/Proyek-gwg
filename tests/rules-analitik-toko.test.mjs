// Menguji TEKS aturan asli v18 untuk gwg_data/_config/analitikToko (baca semua pengguna,
// tulis hanya Admin/Manajer, nilai dibatasi) dan menjaga keselarasan dengan BATAS di klien.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BATAS, KUNCI_CONFIG } from "../src/lib/analitikToko.js";

const rules = JSON.parse(readFileSync(new URL("../firebase-rules/database_rules_v18_analitik_toko.json", import.meta.url), "utf8"));
const node = rules.rules.gwg_data._config.analitikToko;
const encodeEmailKey = (e) => e.toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_").replace(/[#$\[\]/]/g, "_");

function snap(tree, path = []) {
  const get = () => path.reduce((n, k) => (n == null ? undefined : n[k]), tree);
  return {
    child: (p) => snap(tree, [...path, ...String(p).split("/")]),
    val: () => { const v = get(); return v === undefined ? null : v; },
    exists: () => get() !== undefined && get() !== null,
    isNumber: () => typeof get() === "number",
    hasChildren: () => !!get() && typeof get() === "object" && Object.keys(get()).length > 0,
  };
}
function evalExpr(expr, { email, role, verified = true, newVal }) {
  const tree = { gwg_data: { shared: { pengguna: email && role ? { ["U_" + encodeEmailKey(email)]: { role } } : {} } } };
  const auth = email ? { token: { email, email_verified: verified } } : null;
  const fn = new Function("auth", "root", "newData", `return (${expr});`);
  return fn(auth, snap(tree), snap({ v: newVal }, ["v"]));
}

test("baca: semua pengguna login terverifikasi (Sales/Viewer ikut), anonim ditolak", () => {
  assert.equal(evalExpr(node[".read"], { email: "s@x.com", role: "Sales" }), true);
  assert.equal(evalExpr(node[".read"], { email: "v@x.com", role: "Viewer" }), true);
  assert.equal(evalExpr(node[".read"], { email: "s@x.com", role: "Sales", verified: false }), false);
  assert.equal(evalExpr(node[".read"], { email: null }), false);
});
test("tulis: hanya Admin & Manajer", () => {
  assert.equal(evalExpr(node[".write"], { email: "a@x.com", role: "Admin" }), true);
  assert.equal(evalExpr(node[".write"], { email: "m@x.com", role: "Manajer" }), true);
  assert.equal(evalExpr(node[".write"], { email: "s@x.com", role: "Sales" }), false);
  assert.equal(evalExpr(node[".write"], { email: "v@x.com", role: "Viewer" }), false);
  assert.equal(evalExpr(node[".write"], { email: "a@x.com", role: "Admin", verified: false }), false);
  assert.equal(evalExpr(node[".write"], { email: "tak@terdaftar.com" }), false);
});
test("tulis memakai ekspresi YANG SAMA dengan bagiHasilConfig (paritas Admin/Manajer)", () => {
  assert.equal(node[".write"], rules.rules.gwg_data.shared.bagiHasilConfig[".write"]);
});
test("batas nilai di Rules sama persis dengan BATAS di klien", () => {
  assert.deepEqual(Object.keys(node).filter((k) => !k.startsWith(".") && !k.startsWith("$")).sort(), [...KUNCI_CONFIG].sort());
  for (const k of KUNCI_CONFIG) {
    const ok = (v) => evalExpr(node[k][".validate"], { email: "a@x.com", role: "Admin", newVal: v });
    assert.equal(ok(BATAS[k].min), true, `${k} min`);
    assert.equal(ok(BATAS[k].max), true, `${k} max`);
    assert.equal(ok(BATAS[k].min - 1), false, `${k} min-1`);
    assert.equal(ok(BATAS[k].max + 1), false, `${k} max+1`);
    assert.equal(ok("30"), false, `${k} bukan angka`);
  }
});
test("field tak dikenal ditolak; node harus berisi anak", () => {
  assert.equal(node["$lain"][".validate"], false);
  assert.equal(node[".validate"], "newData.hasChildren()");
});
