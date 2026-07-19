export const LIST_TABLES = ["wilayah", "rute", "toko", "produk", "kontrol", "pengguna", "penyesuaian", "penjualanLuar"];

// Konversi array → objek ber-key id, untuk ditulis ke Firebase per-record.
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
