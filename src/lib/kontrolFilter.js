// Penyaringan daftar Kontrol (Tab Kontrol) — fungsi murni agar bisa diuji.
//
// Kenapa dipisah: sebelumnya `data` (hasil filter) dihitung INLINE di setiap perubahan
// filter, dan tiap ketukan di kolom "Cari Toko" memicu, untuk SETIAP baris kontrol:
//   • normTxt(nama toko) + normTxt(kode toko) + normTxt(kata kunci)  (regex + alokasi string)
//   • sort ulang seluruh hasil (dengan localeCompare pada seri)
// Sekarang: teks yang dinormalisasi dihitung SEKALI per perubahan data (indeks),
// urutan dihitung SEKALI (urutkanKontrol), dan kata kunci dinormalisasi sekali per filter.
import { normTxt } from "./format";

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
