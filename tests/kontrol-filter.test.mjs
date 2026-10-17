import test from "node:test";
import assert from "node:assert/strict";
import { urutkanKontrol, bangunIndeksKontrol, saringKontrol } from "../src/lib/kontrolFilter.js";
import { normTxt } from "../src/lib/format.js";

// Implementasi LAMA (salinan persis dari TabKontrol sebelum dioptimalkan) sebagai acuan.
function acuanLama(enriched, filter, kunjunganBerulangIds) {
  return enriched.filter(k =>
    (!filter.wilayahId || k.wilayahId === filter.wilayahId) &&
    (!filter.ruteId    || k.ruteId    === filter.ruteId) &&
    (!filter.bulan     || k.tanggal?.startsWith(filter.bulan)) &&
    (!filter.tanggal   || k.tanggal === filter.tanggal) &&
    (!filter.dari      || k.tanggal >= filter.dari) &&
    (!filter.sampai    || k.tanggal <= filter.sampai) &&
    (!filter.salesPelapor || normTxt(k.salesPelapor) === normTxt(filter.salesPelapor)) &&
    (!filter.q         || normTxt(k.tokoNama).includes(normTxt(filter.q)) || normTxt(k.toko?.kode).includes(normTxt(filter.q))) &&
    (!filter.catatanStatus || (filter.catatanStatus==="manual" ? !k.catatanStatus || k.catatanStatus==="manual" : k.catatanStatus===filter.catatanStatus)) &&
    (filter.minJumlah==="" || filter.minJumlah==null || k.totalTerjual >= Number(filter.minJumlah)) &&
    (filter.maxJumlah==="" || filter.maxJumlah==null || k.totalTerjual <= Number(filter.maxJumlah)) &&
    (!filter.kunjunganBerulang || kunjunganBerulangIds.has(k.id))
  )
    .filter(k => !filter.piutangBelumTercatat || (
      k.status==="disetujui" && k.nominalDisetor!=="" && k.nominalDisetor!=null &&
      Number(k.nominalDisetor) < (k.totalRev||0) && !k.piutangId
    ))
    .sort((a,b) => (a.createdAt||0)-(b.createdAt||0) || String(a.id).localeCompare(String(b.id)));
}

// Pembangkit acak deterministik
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pilih = (a) => a[Math.floor(rnd() * a.length)];
const namaToko = ["Toko Barokah", "toko  barokah jaya", "Warung Sinar", "UD Maju", "Kios Berkah", "SINAR  Abadi", "Mini Mart 7", "Bu Siti"];
const stat = ["", "tutup", "terjual", "masalah", "manual", undefined];

function buatData(n) {
  return Array.from({ length: n }, (_, i) => {
    const tgl = `2026-${String(1 + Math.floor(rnd() * 10)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
    return {
      id: i % 17 === 0 ? `K${Math.floor(i / 2)}` : `K${i}`, // sebagian id ganda sengaja
      createdAt: rnd() < 0.2 ? 1000 : Math.floor(rnd() * 5000), // banyak seri
      tanggal: tgl, tokoNama: pilih(namaToko), toko: { kode: pilih(["T001", "T002", " t003 ", "X9"]) },
      wilayahId: pilih(["W1", "W2", "W3"]), ruteId: pilih(["R1", "R2", "R3", "R4"]),
      salesPelapor: pilih(["Abim", " abim ", "ALFI", "", undefined]),
      catatanStatus: pilih(stat), totalTerjual: Math.floor(rnd() * 40), totalRev: Math.floor(rnd() * 900000),
      status: pilih(["disetujui", "menunggu"]), nominalDisetor: pilih(["", null, 100, 500000, 900000]), piutangId: pilih([undefined, "", "P1"]),
    };
  });
}

test("hasil saring baru IDENTIK (isi & urutan) dengan implementasi lama untuk 400 kombinasi filter acak", () => {
  const enriched = buatData(600);
  const berulang = new Set(enriched.filter(() => rnd() < 0.2).map(k => k.id));
  const urut = urutkanKontrol(enriched); const indeks = bangunIndeksKontrol(urut);
  for (let n = 0; n < 400; n++) {
    const f = {
      wilayahId: rnd() < 0.3 ? pilih(["W1", "W2"]) : "", ruteId: rnd() < 0.2 ? pilih(["R1", "R3"]) : "",
      bulan: rnd() < 0.2 ? pilih(["2026-03", "2026-10"]) : "", tanggal: rnd() < 0.05 ? "2026-05-10" : "",
      dari: rnd() < 0.2 ? "2026-03-01" : "", sampai: rnd() < 0.2 ? "2026-09-30" : "",
      salesPelapor: rnd() < 0.2 ? pilih(["abim", "Alfi ", "ABIM"]) : "",
      q: rnd() < 0.6 ? pilih(["b", "ba", "bar", " BAROKAH ", "sinar", "t00", "x9", "zzz", "mart 7", "  toko  "]) : "",
      catatanStatus: rnd() < 0.3 ? pilih(["manual", "tutup", "terjual", "masalah"]) : "",
      minJumlah: rnd() < 0.2 ? pilih(["", 5, "10", null]) : "", maxJumlah: rnd() < 0.2 ? pilih(["", 30, "20", null]) : "",
      kunjunganBerulang: rnd() < 0.15, piutangBelumTercatat: rnd() < 0.15,
    };
    const baru = saringKontrol(urut, indeks, f, berulang);
    const lama = acuanLama(enriched, f, berulang);
    assert.equal(baru.length, lama.length, `panjang beda untuk filter ${JSON.stringify(f)}`);
    baru.forEach((r, i) => assert.equal(r, lama[i], `baris ke-${i} beda untuk filter ${JSON.stringify(f)}`));
  }
});

test("tanpa filter: semua baris, terurut createdAt lalu id", () => {
  const enriched = buatData(50);
  const urut = urutkanKontrol(enriched);
  const hasil = saringKontrol(urut, bangunIndeksKontrol(urut), {}, new Set());
  assert.equal(hasil.length, 50);
  for (let i = 1; i < hasil.length; i++) assert.ok((hasil[i - 1].createdAt || 0) <= (hasil[i].createdAt || 0));
});

test("performa: 20.000 baris, 'cari toko' per ketukan jauh lebih cepat daripada cara lama", () => {
  const enriched = buatData(20000);
  const urut = urutkanKontrol(enriched); const indeks = bangunIndeksKontrol(urut);
  const kosong = new Set(); const f = { q: "ba" };
  let t0 = performance.now(); for (let i = 0; i < 10; i++) acuanLama(enriched, f, kosong); const lama = performance.now() - t0;
  t0 = performance.now(); for (let i = 0; i < 10; i++) saringKontrol(urut, indeks, f, kosong); const baru = performance.now() - t0;
  console.log(`# perf 20rb baris x10 ketukan: lama=${lama.toFixed(0)}ms baru=${baru.toFixed(0)}ms`);
  assert.ok(baru < lama, `tidak lebih cepat: lama=${lama} baru=${baru}`);
});
