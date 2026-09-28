import test from "node:test";
import assert from "node:assert/strict";

// escapeHtml dites lewat ekstraksi source — exportUtils.js mengimpor xlsx/jspdf
// (butuh browser/dependensi), jadi fungsinya dimuat terpisah tanpa modul itu.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/lib/exportUtils.js", import.meta.url), "utf8");
const m = src.match(/export function escapeHtml\(v\) \{[\s\S]*?\n\}/);
assert.ok(m, "escapeHtml harus ada di exportUtils.js");
const escapeHtml = new Function(m[0].replace("export function", "return function") + "")();

test("escapeHtml menetralkan payload XSS umum", () => {
  const p = `<img src=x onerror="alert(1)">'&`;
  const out = escapeHtml(p);
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes('"'));
  assert.equal(out, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
});

test("escapeHtml aman untuk null/undefined/angka", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(12500), "12500");
});

test("jalur cetak PDF: tidak ada interpolasi mentah tersisa di template HTML", () => {
  const html = src.slice(src.indexOf("const html = `<!DOCTYPE html>"), src.indexOf("win.document.write"));
  const mentah = [...html.matchAll(/\$\{([^}]+)\}/g)].map(x => x[1])
    .filter(e => /^(title|now|cell|c\.label|BRAND_NAME|BRAND_TAGLINE)$/.test(e.trim()));
  assert.deepEqual(mentah, [], "interpolasi teks-bebas harus dibungkus escapeHtml()");
});
