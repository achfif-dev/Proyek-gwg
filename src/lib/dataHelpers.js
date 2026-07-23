export const LIST_TABLES = ["wilayah", "rute", "toko", "produk", "kontrol", "pengguna", "penyesuaian", "penjualanLuar"];

// Jeda maksimum (hari) antar tanggal kontrol berurutan di satu wilayah supaya
// masih dianggap 1 putaran/siklus yang sama (dipakai di Rekap → "Siklus
// Wilayah", dan di Kontrol Bulanan untuk penanda toko yang belum dikontrol
// di siklus berjalan). Satu konstanta dipakai bersama supaya definisi
// "periode kontrol" konsisten di seluruh app — tidak berpatokan pada bulan
// kalender, karena siklus kunjungan tiap wilayah bisa maju-mundur tanggalnya.
export const SIKLUS_GAP_DAYS = 10;

// ✅ RIWAYAT STATUS TOKO (statusHistory): array {status, tanggal, catatan}
// disimpan di record toko, ditambah setiap kali status toko BENAR-BENAR
// berubah (dari Master Toko, "Tarik Toko", "Edit Status Toko", maupun
// auto-upgrade Baru→Aktif). Dipakai untuk merekonstruksi status toko PADA
// TANGGAL TERTENTU di masa lalu (mis. akhir sebuah siklus kontrol), bukan
// cuma status TERKINI — supaya laporan histori (Rekap → Siklus Wilayah)
// tetap akurat meski dibuka jauh setelah siklusnya lewat & status toko
// sudah berubah lagi sesudahnya.

// Status toko PADA tanggal tertentu, direkonstruksi dari statusHistory.
// Kalau toko tidak punya riwayat sama sekali (data lama, sebelum fitur ini
// ditambahkan) ATAU tanggal targetnya sebelum riwayat pertama tercatat,
// fallback ke status TERKINI toko (pendekatan lama) — supaya tetap
// kompatibel dengan data yang sudah ada sebelumnya.
export function statusTokoPadaTanggal(toko, tanggal) {
  const riwayat = toko?.statusHistory;
  if (!Array.isArray(riwayat) || riwayat.length === 0) return toko?.status || "Aktif";
  const terurut = riwayat.filter(r => r?.tanggal).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  let hasil = null;
  for (const r of terurut) {
    if (r.tanggal <= tanggal) hasil = r.status;
    else break;
  }
  return hasil ?? (toko?.status || "Aktif");
}

// Tambah 1 entri riwayat status. Dedup sederhana: kalau tanggal & status
// persis sama dengan entri terakhir, tidak usah ditambah dobel (mis. toko
// disimpan ulang tanpa status berubah).
export function appendStatusHistory(existingHistory, status, tanggal, catatan) {
  const list = Array.isArray(existingHistory) ? [...existingHistory] : [];
  const last = list[list.length - 1];
  if (last && last.status === status && last.tanggal === tanggal) return list;
  list.push({ status, tanggal, catatan: catatan || "" });
  return list;
}


export function arrToMap(arr) {
  const map = {};
  (arr||[]).forEach(r => { if (r && r.id != null) map[r.id] = r; });
  return map;
}
// Konversi objek ber-key id (dari Firebase) → array, untuk dipakai komponen
// UI yang masih mengasumsikan bentuk array seperti semula.
export function mapToArr(map) {
  if (!map) return [];
  if (Array.isArray(map)) {
    // Dedup by id untuk menghindari entri dobel dari data lama format array
    const seen = new Set();
    return map.filter(r => r && r.id != null && !seen.has(r.id) && seen.add(r.id));
  }
  return Object.values(map);
}
// Menentukan "tahun partisi" sebuah record kontrol, dari field tanggal
// (format "YYYY-MM-DD"). Dipakai untuk menentukan path Firebase
// kontrol/{tahun}/{id}. Fallback ke tahun berjalan kalau tanggal kosong/rusak
// (seharusnya tidak pernah terjadi karena form kontrol mewajibkan tanggal).
export function kontrolYearOf(record) {
  const y = (record && record.tanggal || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

// Encode email menjadi key Firebase yang valid (tidak boleh ada ., #, $, [, ], /)
export function encodeEmailKey(email) {
  return (email || "").toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_").replace(/[#$\[\]/]/g, "_");
}
// Kebalikan dari encodeEmailKey, untuk ditampilkan kembali sebagai email asli di UI.
// Catatan: karakter selain titik dan @ yang di-escape jadi "_" tidak bisa
// direkonstruksi sempurna, tapi ini cukup untuk kasus email pada umumnya.
export function decodeEmailKey(key) {
  return (key || "").replace(/_dot_/g, ".").replace(/_at_/g, "@");
}

// Simpan/bagikan file di APK native — mekanisme <a download> browser TIDAK
// berfungsi di WebView native (Capacitor), jadi file harus ditulis lewat
// plugin Filesystem lalu dibuka lewat dialog "Bagikan/Simpan ke...". Di web
// biasa (PWA/browser), tetap pakai cara unduhan lama seperti sebelumnya.
