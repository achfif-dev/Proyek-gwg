// Penjaga sintaks Rules Realtime Database. Evaluator lokal di tes lain memakai
// JavaScript, jadi method yang TIDAK ada di Firebase (mis. substring) tetap lolos
// di sana tapi ditolak Console ("No such method/property"). Tes ini menolak semua
// method di luar daftar resmi RTDB:
// https://firebase.google.com/docs/reference/security/database
// Jalankan: node --import ./tests/register.mjs --test tests/rules-sintaks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../firebase-rules/", import.meta.url);
const BOLEH = new Set([
  // snapshot
  "child", "parent", "val", "exists", "hasChild", "hasChildren", "getPriority", "isNumber", "isString", "isBoolean",
  // string
  "contains", "beginsWith", "endsWith", "replace", "toLowerCase", "toUpperCase", "matches",
]);
const PROPERTI_BOLEH = new Set(["length", "token", "email", "email_verified", "uid"]);

function* semuaExpr(node, path = "") {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string" && k.startsWith(".")) yield [`${path}/${k}`, v];
    else if (v && typeof v === "object") yield* semuaExpr(v, `${path}/${k}`);
  }
}
const bersih = (e) => e.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/matches\(\/(?:\\.|[^/\\])+\/\)/g, "matches()");

// Hanya versi TERBARU (yang akan dipublikasikan). File lama (mis. v11) sengaja diabaikan.
const versi = (n) => Number(n.match(/_v(\d+)/)[1]);
const semua = readdirSync(DIR).filter((n) => /^database_rules_v\d+.*\.json$/.test(n)).sort((a, b) => versi(a) - versi(b));
for (const f of semua.slice(-1)) {
  test(`${f}: hanya memakai method/properti yang didukung Realtime Database`, () => {
    const rules = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
    const salah = new Set();
    for (const [path, expr] of semuaExpr(rules)) {
      const e = bersih(expr);
      for (const m of e.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) if (!BOLEH.has(m[1])) salah.add(`${m[1]}() di ${path}`);
      for (const m of e.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g)) if (!PROPERTI_BOLEH.has(m[1])) salah.add(`.${m[1]} di ${path}`);
    }
    assert.deepEqual([...salah], [], `Tidak didukung Firebase: ${[...salah].join("; ")}`);
  });
}
