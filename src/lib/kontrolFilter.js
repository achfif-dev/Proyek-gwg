// Penyaringan daftar Kontrol (Tab Kontrol) — fungsi murni agar bisa diuji.
//
// Kenapa dipisah: sebelumnya `data` (hasil filter) dihitung INLINE di setiap perubahan
// filter, dan tiap ketukan di kolom "Cari Toko" memicu, untuk SETIAP baris kontrol:
//   • normTxt(nama toko) + normTxt(kode toko) + normTxt(kata kunci)  (regex + alokasi string)
//   • sort ulang seluruh hasil (dengan localeCompare pada seri)
// Sekarang: teks yang dinormalisasi dihitung SEKALI per perubahan data (indeks),
// urutan dihitung SEKALI (urutkanKontrol), dan kata kunci dinormalisasi sekali per filter.
import { normTxt, naturalCompare } from "./format";

const bandingkanKontrol = (a, b) =>
  (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));

// Urutan tetap berdasarkan waktu simpan sebenarnya (sama di semua perangkat).
export function urutkanKontrol(rows) {
  return [...rows].sort(bandingkanKontrol);
}

// Indeks sejajar dengan `rowsUrut` (berdasarkan posisi, bukan id → aman bila id ganda).
export function bangunIndeksKontrol(rowsUrut) {
  return rowsUrut.map(k => ({
    nama: normTxt(k.tokoNama),
    kode: normTxt(k.toko?.kode),
    sales: normTxt(k.salesPelapor),
  }));
}

export function saringKontrol(rowsUrut, indeks, filter, kunjunganBerulangIds) {
  const q = filter.q ? normTxt(filter.q) : "";
  const sales = filter.salesPelapor ? normTxt(filter.salesPelapor) : "";
  const adaMin = !(filter.minJumlah === "" || filter.minJumlah == null);
  const adaMax = !(filter.maxJumlah === "" || filter.maxJumlah == null);
  const min = adaMin ? Number(filter.minJumlah) : 0;
  const max = adaMax ? Number(filter.maxJumlah) : 0;
  const hasil = [];
  for (let i = 0; i < rowsUrut.length; i++) {
    const k = rowsUrut[i];
    if (filter.wilayahId && k.wilayahId !== filter.wilayahId) continue;
    if (filter.ruteId && k.ruteId !== filter.ruteId) continue;
    if (filter.bulan && !k.tanggal?.startsWith(filter.bulan)) continue;
    if (filter.tanggal && k.tanggal !== filter.tanggal) continue;
    if (filter.dari && !(k.tanggal >= filter.dari)) continue;
    if (filter.sampai && !(k.tanggal <= filter.sampai)) continue;
    const ix = indeks[i];
    if (sales && ix.sales !== sales) continue;
    if (q && !(ix.nama.includes(q) || ix.kode.includes(q))) continue;
    if (filter.catatanStatus) {
      const ok = filter.catatanStatus === "manual"
        ? (!k.catatanStatus || k.catatanStatus === "manual")
        : k.catatanStatus === filter.catatanStatus;
      if (!ok) continue;
    }
    if (adaMin && !(k.totalTerjual >= min)) continue;
    if (adaMax && !(k.totalTerjual <= max)) continue;
    if (filter.kunjunganBerulang && !kunjunganBerulangIds.has(k.id)) continue;
    if (filter.piutangBelumTercatat && !(
      k.status === "disetujui" && k.nominalDisetor !== "" && k.nominalDisetor != null &&
      Number(k.nominalDisetor) < (k.totalRev || 0) && !k.piutangId
    )) continue;
    hasil.push(k);
  }
  return hasil;
}

// ─── Tampilan "View per Rute" (tokoPerRute) ───────────────────────────────────
// Sebelumnya: untuk SETIAP toko, `enriched.filter(k => k.tokoId === toko.id ...)` DAN
// `enriched.some(...)` memindai SELURUH kontrol → O(toko × kontrol) (mis. 3.000 × 20.000 =
// 60 juta pembandingan, dua kali), dihitung ulang tiap ketukan di "Cari Toko" — dan dihitung
// SELALU walau sedang di tampilan tabel (hasilnya hanya dipakai di tampilan per-rute).
// Sekarang: kontrol dikelompokkan per toko sekali (indeksKontrolPerToko), lalu tiap toko hanya
// melihat entrinya sendiri.
export function indeksKontrolPerToko(enriched) {
  const m = new Map();
  for (const k of enriched) {
    let arr = m.get(k.tokoId);
    if (!arr) { arr = []; m.set(k.tokoId, arr); }
    arr.push(k); // urutan `enriched` terjaga
  }
  return m;
}

export function hitungTokoPerRute({ rute, wilayah, toko }, perToko, filter) {
  const qn = filter.q ? normTxt(filter.q) : "";
  const rutesToShow = filter.ruteId
    ? (rute || []).filter(r => r.id === filter.ruteId)
    : filter.wilayahId
      ? (rute || []).filter(r => r.wilayahId === filter.wilayahId)
      : (rute || []);
  const semuaToko = toko || [];
  const hasil = [];
  for (const r of rutesToShow) {
    const w = (wilayah || []).find(x => x.id === r.wilayahId);
    const tokoList = [];
    for (const t of semuaToko) {
      if (t.ruteId !== r.id) continue;
      if (!(t.status === "Aktif" || t.status === "Baru")) continue;
      if (qn && !(normTxt(t.nama).includes(qn) || normTxt(t.kode).includes(qn))) continue;
      const semua = perToko.get(t.id) || [];
      const entries = filter.bulan ? semua.filter(k => k.tanggal?.startsWith(filter.bulan)) : semua.slice();
      const sudahDikontrolHariIni = semua.some(k => k.tanggal === filter.cekTanggal);
      if (filter.hanyaBelumHariIni && sudahDikontrolHariIni) continue;
      tokoList.push({ toko: t, entries, sudahDikontrolHariIni });
    }
    if (tokoList.length > 0) hasil.push({ rute: r, wilayah: w, tokoList });
  }
  return hasil;
}

// ─── Ringkasan per tanggal (panel "Tanggal Kontrol") ──────────────────────────
// Sebelumnya tiap tanggal mengurutkan daftar rutenya dengan naturalCompare (regex per
// perbandingan) → ratusan ribu panggilan saat Wilayah/Rute/Bulan diganti. Sekarang nama rute
// unik diurutkan SEKALI → peringkat; tiap tanggal cukup membandingkan angka peringkat.
// Nama yang dianggap sama oleh naturalCompare diberi peringkat sama (urutan tie tetap stabil).
export function ringkasanPerTanggal(enriched, { wilayahId, ruteId, bulan } = {}) {
  const map = {};
  enriched.forEach(k => {
    if (!k.tanggal) return;
    if (wilayahId && k.wilayahId !== wilayahId) return;
    if (ruteId && k.ruteId !== ruteId) return;
    if (bulan && !k.tanggal.startsWith(bulan)) return;
    if (!map[k.tanggal]) map[k.tanggal] = { tanggal: k.tanggal, count: 0, ruteMap: {} };
    const entry = map[k.tanggal];
    entry.count++;
    const ruteKey = k.ruteId || `${k.ruteNama}|${k.wilayahNama}`;
    if (!entry.ruteMap[ruteKey]) entry.ruteMap[ruteKey] = { ruteNama: k.ruteNama || "-", wilayahNama: k.wilayahNama || "-", count: 0 };
    entry.ruteMap[ruteKey].count++;
  });
  const namaUnik = new Set();
  Object.values(map).forEach(e => Object.values(e.ruteMap).forEach(r => namaUnik.add(r.ruteNama)));
  const urut = [...namaUnik].sort(naturalCompare);
  const peringkat = new Map(); let rk = 0;
  urut.forEach((nm, i) => { if (i > 0 && naturalCompare(urut[i - 1], nm) !== 0) rk++; peringkat.set(nm, rk); });
  return Object.values(map)
    .map(e => ({ ...e, ruteList: Object.values(e.ruteMap).sort((a, b) => peringkat.get(a.ruteNama) - peringkat.get(b.ruteNama)) }))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

// Ringkasan pcs & bonus per produk (kartu di atas tabel) — rumus SAMA dengan yang dulu
// dihitung inline di JSX pada setiap render; kini dipanggil di dalam useMemo.
export function hitungRingkasanProduk(produkAktif, data, luarRute) {
  // Kunci properti dibentuk SEKALI per produk (dulu template string dibuat di setiap iterasi
  // baris → alokasi jutaan string kecil & beban GC). Urutan penjumlahan sama persis dengan reduce lama.
  return produkAktif.map(p => {
    const kT = `terjual_${p.id}`, kB = `bonusInput_${p.id}`, bonusBawaan = p.bonus || 0;
    let tData = 0, bData = 0;
    for (let i = 0; i < data.length; i++) {
      const k = data[i];
      tData = tData + (k[kT] || 0);
      bData = bData + (k[kB] !== undefined ? Number(k[kB]) : bonusBawaan);
    }
    let tLuar = 0, bLuar = 0;
    for (let i = 0; i < luarRute.length; i++) {
      const k = luarRute[i];
      tLuar = tLuar + (k[kT] || 0);
      bLuar = bLuar + Number(k[kB] || 0);
    }
    return { p, totalTerjual: tData + tLuar, bonusTotal: bData + bLuar };
  });
}
