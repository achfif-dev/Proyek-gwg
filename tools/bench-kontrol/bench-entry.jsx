import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { TabKontrol } from "/home/claude/Proyek-gwg/src/features/kontrol/TabKontrol.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pilih = (a) => a[Math.floor(rnd() * a.length)];
const N_TOKO = +(process.env.N_TOKO || 3000), N_KONTROL = +(process.env.N_KONTROL || 20000);
const produk = Array.from({ length: 8 }, (_, i) => ({ id: `P${i}`, nama: `Parfum ${i}`, harga: 15000 + i * 1000, urutan: i, status: "Aktif" }));
const wilayah = Array.from({ length: 5 }, (_, i) => ({ id: `W${i}`, nama: `Wilayah ${i}`, siklusHari: 30 }));
const rute = Array.from({ length: 60 }, (_, i) => ({ id: `R${i}`, nama: `Rute ${i}`, wilayahId: `W${i % 5}` }));
const nama = ["Toko Barokah", "Warung Sinar", "UD Maju", "Kios Berkah", "Mini Mart", "Bu Siti", "Pak Haji", "Sumber Rejeki"];
const toko = Array.from({ length: N_TOKO }, (_, i) => {
  const o = { id: `T${i}`, nama: `${pilih(nama)} ${i}`, kode: `T${String(i).padStart(4, "0")}`, ruteId: `R${i % 60}`, wilayahId: `W${(i % 60) % 5}`, status: "Aktif", tanggalMasuk: "2025-01-10" };
  produk.forEach(p => { o[`produk_${p.id}`] = true; o[`stok_${p.id}`] = Math.floor(rnd() * 20); });
  return o;
});
const kontrol = Array.from({ length: N_KONTROL }, (_, i) => {
  const t = toko[Math.floor(rnd() * N_TOKO)];
  const o = { id: `K${i}`, tokoId: t.id, tanggal: `2026-${String(1 + Math.floor(rnd() * 10)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
    status: "disetujui", createdAt: 1700000000000 + i * 1000, salesPelapor: pilih(["Abim", "Alfi", "Rudi"]), catatanStatus: "", nominalDisetor: "" };
  produk.forEach(p => { o[`stok_${p.id}`] = Math.floor(rnd() * 20); o[`terjual_${p.id}`] = Math.floor(rnd() * 6); o[`bonusInput_${p.id}`] = 0; });
  return o;
});
const db = { wilayah, rute, toko, produk, kontrol, penyesuaian: [], tutupBuku: [], pengguna: [], penarikanToko: [], penjualanLuar: [], hutangPiutang: [], jurnalUmum: [] };
const noop = () => {};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const container = document.createElement("div"); document.body.appendChild(container);
const root = createRoot(container);
const mode = process.env.VIEW || "table";
localStorage.setItem("kontrol.viewMode", JSON.stringify(mode));

let t0 = performance.now();
await act(async () => { root.render(<TabKontrol db={db} addRecord={noop} updateRecord={noop} deleteRecord={noop} save={noop} salesWilayahId="" isManajer={true}
  loadedKontrolYears={["2026"]} availableKontrolYears={["2026"]} initialQuery="" dataStillSyncing={false} postJurnal={noop} voidJurnal={noop} createdBy="a@b.c" />); });
console.log(`render awal (toko=${N_TOKO}, kontrol=${N_KONTROL}, view=${mode}): ${(performance.now() - t0).toFixed(0)} ms`);

const hitung = (label) => { const q = (x) => document.querySelectorAll(x).length; console.log(`DOM ${label}: total=${q("*")} tr=${q("tr")} td=${q("td")} option=${q("option")} button=${q("button")} svg=${q("svg")}`); };
hitung("awal");
await act(async () => { await sleep(500); }); // SETTLE: tunggu render bertahap & efek awal selesai
const input = [...document.querySelectorAll("input")].find(i => (i.placeholder || "").toLowerCase().includes("nama atau kode toko"));
if (!input) { console.log("input cari tidak ditemukan"); process.exit(1); }
const setNilai = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
async function ketik(teks) {
  // 1) ketukan (state lokal)  2) komit segera lewat blur → render berat
  let a = performance.now();
  await act(async () => { setNilai.call(input, teks); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
  const ketukan = performance.now() - a;
  a = performance.now();
  await act(async () => { input.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })); });
  return { ketukan, komit: performance.now() - a };
}
const urutan = (process.env.URUTAN || "b,ba,bar,baro,bar,ba,b,").split(",");
for (const q of urutan) { const r = await ketik(q); hitung(`q=${q}`); console.log(`q="${q}"  ketukan(lokal)=${r.ketukan.toFixed(0)}ms  komit(berat)=${r.komit.toFixed(0)}ms`); }

const sel = [...document.querySelectorAll("select")];
console.log(`jumlah <select> terdeteksi: ${sel.length}`);
const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
const sw = sel.find(s => [...s.options].some(o => o.value === "W1"));
if (sw) {
  for (const v of ["W1", "W2", ""]) {
    const a = performance.now();
    await act(async () => { setSel.call(sw, v); sw.dispatchEvent(new window.Event("change", { bubbles: true })); });
    console.log(`pilih wilayah "${v}": ${(performance.now() - a).toFixed(0)}ms`);
  }
} else console.log("select wilayah tidak ditemukan");
process.exit(0);
