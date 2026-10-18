import test from "node:test";
import assert from "node:assert/strict";
import { naturalCompare } from "../src/lib/format.js";
import { ringkasanPerTanggal, hitungRingkasanProduk } from "../src/lib/kontrolFilter.js";

// Implementasi LAMA (salinan persis) sebagai acuan.
function naturalCompareLama(a, b) {
  const ax = String(a||"").match(/(\d+|\D+)/g) || [];
  const bx = String(b||"").match(/(\d+|\D+)/g) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const an = ax[i] ?? "", bn = bx[i] ?? "";
    const aIsNum = /^\d+$/.test(an), bIsNum = /^\d+$/.test(bn);
    if (aIsNum && bIsNum) { const diff = parseInt(an,10) - parseInt(bn,10); if (diff !== 0) return diff; }
    else { const cmp = an.localeCompare(bn, "id", { sensitivity:"base" }); if (cmp !== 0) return cmp; }
  }
  return 0;
}
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pil = (a) => a[Math.floor(rnd() * a.length)];
const kata = ["Rute", "rute", "RUTE", "Bangkalan", "Utara", "Sampang", "Barat", "Blu", "Éka", "Kota", "A", "b", "10", "2", "007", "7", "12a", "x9y", "", " ", "-", "Rute 10", "Rute 2"];
const acak = () => { let s = ""; const n = Math.floor(rnd() * 4); for (let i = 0; i < n; i++) s += pil(kata) + (rnd() < 0.5 ? " " : ""); return rnd() < 0.05 ? undefined : (rnd() < 0.03 ? null : s); };

test("naturalCompare baru: tanda hasil IDENTIK dengan implementasi lama (30.000 pasangan acak)", () => {
  for (let i = 0; i < 30000; i++) {
    const a = acak(), b = acak();
    assert.equal(Math.sign(naturalCompare(a, b)), Math.sign(naturalCompareLama(a, b)), `beda untuk ${JSON.stringify([a, b])}`);
  }
});
test("naturalCompare: urutan alami", () => {
  assert.deepEqual(["Rute 10", "Rute 2", "Rute 1"].sort(naturalCompare), ["Rute 1", "Rute 2", "Rute 10"]);
});

// Acuan lama ringkasan per tanggal
function ringkasanLama(enriched, filter) {
  const map = {};
  enriched.forEach(k => {
    if (!k.tanggal) return;
    if (filter.wilayahId && k.wilayahId !== filter.wilayahId) return;
    if (filter.ruteId && k.ruteId !== filter.ruteId) return;
    if (filter.bulan && !k.tanggal.startsWith(filter.bulan)) return;
    if (!map[k.tanggal]) map[k.tanggal] = { tanggal: k.tanggal, count: 0, ruteMap: {} };
    const entry = map[k.tanggal]; entry.count++;
    const ruteKey = k.ruteId || `${k.ruteNama}|${k.wilayahNama}`;
    if (!entry.ruteMap[ruteKey]) entry.ruteMap[ruteKey] = { ruteNama: k.ruteNama || "-", wilayahNama: k.wilayahNama || "-", count: 0 };
    entry.ruteMap[ruteKey].count++;
  });
  return Object.values(map).map(e => ({ ...e, ruteList: Object.values(e.ruteMap).sort((a, b) => naturalCompareLama(a.ruteNama, b.ruteNama)) }))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}
test("ringkasanPerTanggal baru IDENTIK (isi & urutan) dengan implementasi lama", () => {
  const namaRute = ["Rute 1", "Rute 2", "Rute 10", "rute 2", "Bangkalan Utara", "Sampang 3", "Sampang 12", "Éka", "", undefined];
  const rows = Array.from({ length: 3000 }, (_, i) => ({ tanggal: rnd() < 0.03 ? "" : `2026-${String(1 + Math.floor(rnd() * 10)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
    wilayahId: pil(["W1", "W2"]), ruteId: rnd() < 0.1 ? "" : `R${Math.floor(rnd() * 14)}`, ruteNama: pil(namaRute), wilayahNama: pil(["Bkl", "Spg"]) }));
  for (let n = 0; n < 30; n++) {
    const f = { wilayahId: rnd() < 0.4 ? "W1" : "", ruteId: rnd() < 0.2 ? "R3" : "", bulan: rnd() < 0.4 ? pil(["2026-03", "2026-10"]) : "" };
    assert.deepEqual(ringkasanPerTanggal(rows, f), ringkasanLama(rows, f), `beda untuk ${JSON.stringify(f)}`);
  }
});

test("hitungRingkasanProduk: sama dengan perhitungan inline lama", () => {
  const produk = [{ id: "P1", bonus: 2 }, { id: "P2" }];
  const data = [{ terjual_P1: 3, bonusInput_P1: 1 }, { terjual_P1: 2 }, { terjual_P2: 5, bonusInput_P2: "4" }];
  const luar = [{ terjual_P1: 1, bonusInput_P1: 1 }, { terjual_P2: 2 }];
  const r = hitungRingkasanProduk(produk, data, luar);
  // P1: terjual 3+2+0 +1 = 6; bonus data 1 (isi) + 2 (default produk) + 2 (default) = 5, + luar 1 = 6
  // P2: terjual 0+0+5 +2 = 7;  bonus data 0+0+4 = 4, + luar 0 = 4
  assert.deepEqual(r.map(x => [x.totalTerjual, x.bonusTotal]), [[6, 6], [7, 4]]);
});

import { fmt, fmtRp } from "../src/lib/format.js";
test("fmt memakai formatter bersama: hasil identik dengan new Intl.NumberFormat tiap panggilan", () => {
  const nilai = [0, 1, 999, 1000, 1234567.89, -5000, -0.5, "12000", "abc", null, undefined, NaN, 1e12, 0.1 + 0.2, "", true];
  for (const v of nilai) assert.equal(fmt(v), new Intl.NumberFormat("id-ID").format(v || 0), `beda untuk ${String(v)}`);
  for (let i = 0; i < 2000; i++) { const v = (Math.random() - 0.3) * 10 ** Math.floor(Math.random() * 11); assert.equal(fmt(v), new Intl.NumberFormat("id-ID").format(v || 0)); }
  assert.equal(fmtRp(1500000), "Rp " + new Intl.NumberFormat("id-ID").format(1500000));
});
