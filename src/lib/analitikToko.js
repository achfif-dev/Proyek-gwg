// Logika murni (tanpa React/Firebase) untuk peringatan "Perlu Perhatian" di Dashboard.
//
// Dua peringatan:
//  1. TERLAMBAT  — toko Aktif/Baru yang kontrol terakhirnya lebih lama dari batas.
//  2. RESTOK     — perkiraan stok habis per toko per produk, dari laju terjual.
//
// Prinsip (alasan ada di percakapan desain, ringkasnya):
//  - Laju terjual = JUMLAH terjual ÷ JUMLAH hari dalam satu jendela (bukan rata-rata
//    laju per kunjungan). Kunjungan yang kadang kurang dari sebulan membuat laju per
//    kunjungan sangat berfluktuasi; menjumlahkan dulu meredam itu.
//  - `terjual_*` pada sebuah kontrol mencakup periode SEJAK kontrol sebelumnya. Maka
//    kontrol pertama tidak punya periode yang diketahui dan tidak dihitung.
//  - Kunjungan berstatus "tutup"/"masalah" bukan pengukuran: dilewati, dan jarak hari
//    dihitung antar kunjungan pengukuran yang valid.
//  - Entri "menunggu"/"ditolak" diabaikan (sama dengan useAnalytics & recalcTokoStok).
//  - Data tidak cukup → TIDAK ditandai (bukan ditebak).
//  - Hanya membaca data yang sedang termuat (db.kontrol = tahun live). Riwayat yang
//    tidak termuat tidak terlihat di sini.

export const ANALITIK_DEFAULT = {
  jarakKunjunganHari: 30, // jarak kunjungan normal ke tiap toko
  terlambatHari: 35,      // > ini sejak kontrol terakhir = terlambat (30 hari + toleransi)
  segeraHari: 7,          // perkiraan habis dalam <= ini hari = "segera"
  jendelaMinHari: 14,     // total hari minimum agar laju dipercaya
  jendelaTargetHari: 60,  // kumpulkan interval ke belakang sampai segini hari
  jendelaMaksHari: 120,   // jangan memakai data lebih tua dari ini
};

const STATUS_BUKAN_PENGUKURAN = new Set(["tutup", "masalah"]);
const LEVEL_URUT = { habis: 0, segera: 1, waspada: 2 };

const RE_TGL = /^\d{4}-\d{2}-\d{2}/;

function hariKeEpoch(tgl) {
  if (typeof tgl !== "string" || !RE_TGL.test(tgl)) return NaN;
  const y = +tgl.slice(0, 4), m = +tgl.slice(5, 7), d = +tgl.slice(8, 10);
  return Date.UTC(y, m - 1, d) / 86400000;
}
export function selisihHari(dari, ke) {
  return hariKeEpoch(ke) - hariKeEpoch(dari);
}
export function tambahHari(tgl, n) {
  const e = hariKeEpoch(tgl) + n;
  return new Date(e * 86400000).toISOString().slice(0, 10);
}
// Tanggal lokal perangkat (BUKAN toISOString: di WIB dini hari itu masih "kemarin").
export function hariIniLokal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bandingKontrol(a, b) {
  return (a.tanggal || "").localeCompare(b.tanggal || "") || (a.id || "").localeCompare(b.id || "");
}

// Laju terjual satu produk dari daftar kunjungan pengukuran (urut lama → baru).
// Mengembalikan null bila data belum cukup.
function hitungLaju(pengukuran, produkId, opsi) {
  const n = pengukuran.length;
  if (n < 2) return null;
  let totalHari = 0, totalTerjual = 0, interval = 0;
  for (let i = n - 1; i >= 1; i--) {
    const cur = pengukuran[i], prev = pengukuran[i - 1];
    // stok produk ini direset (ditarik) pada kunjungan cur → periode sebelumnya tak relevan
    if (cur[`ditarik_${produkId}`]) break;
    const hari = selisihHari(prev.tanggal, cur.tanggal);
    if (!(hari >= 0)) break;
    // jangan pakai data lebih tua dari jendelaMaksHari (diukur dari kunjungan pengukuran terakhir)
    if (selisihHari(prev.tanggal, pengukuran[n - 1].tanggal) > opsi.jendelaMaksHari) break;
    totalHari += hari;
    totalTerjual += Number(cur[`terjual_${produkId}`] || 0);
    interval++;
    if (totalHari >= opsi.jendelaTargetHari) break;
  }
  if (interval === 0 || totalHari < opsi.jendelaMinHari) return null;
  return { laju: totalTerjual / totalHari, hari: totalHari, terjual: totalTerjual, interval };
}

/**
 * @param {object} p
 * @param {Array}  p.toko        db.toko
 * @param {Array}  p.kontrol     db.kontrol (yang termuat)
 * @param {Array}  p.rute        db.rute (untuk menentukan wilayah toko)
 * @param {Array}  p.produk      produk aktif (sudah difilter pemanggil)
 * @param {string} p.hariIni     "YYYY-MM-DD"
 * @param {string} [p.wilayahId] batasi ke satu wilayah (Sales)
 * @param {object} [p.opsi]      menimpa ANALITIK_DEFAULT
 */
export function hitungPeringatanToko({ toko, kontrol, rute, produk, hariIni, wilayahId, opsi: opsiIn }) {
  const opsi = { ...ANALITIK_DEFAULT, ...(opsiIn || {}) };
  const ruteWil = new Map((rute || []).map((r) => [r.id, r.wilayahId]));

  // kelompokkan kontrol valid per toko (satu kali jalan)
  const perToko = new Map();
  for (const k of kontrol || []) {
    if (!k || !k.tokoId || !RE_TGL.test(k.tanggal || "")) continue;
    if (k.status === "menunggu" || k.status === "ditolak") continue;
    let arr = perToko.get(k.tokoId);
    if (!arr) perToko.set(k.tokoId, (arr = []));
    arr.push(k);
  }

  const terlambat = [];
  const restok = [];
  let tanpaRiwayat = 0;
  let produkDataKurang = 0;

  for (const t of toko || []) {
    if (!t || (t.status !== "Aktif" && t.status !== "Baru")) continue;
    const wil = ruteWil.get(t.ruteId) || "";
    if (wilayahId && wil !== wilayahId) continue;

    const visits = perToko.get(t.id);
    if (!visits || visits.length === 0) {
      if (t.status === "Aktif") tanpaRiwayat++;
      continue;
    }
    visits.sort(bandingKontrol);
    const terakhir = visits[visits.length - 1];

    // 1) TERLAMBAT
    const hariSejak = selisihHari(terakhir.tanggal, hariIni);
    if (hariSejak > opsi.terlambatHari) {
      terlambat.push({
        tokoId: t.id, nama: t.nama || "(tanpa nama)", ruteId: t.ruteId || "", wilayahId: wil,
        terakhir: terakhir.tanggal.slice(0, 10), hari: hariSejak,
        bermasalah: terakhir.catatanStatus === "masalah",
      });
    }

    // 2) RESTOK
    const pengukuran = visits.filter((k) => !STATUS_BUKAN_PENGUKURAN.has(k.catatanStatus || ""));
    if (pengukuran.length < 2) continue;
    const idDijual = new Set(t.produkIds || []);
    const risiko = [];
    for (const p of produk || []) {
      if (!idDijual.has(p.id)) continue;
      if (terakhir[`ditarik_${p.id}`]) continue;
      const lj = hitungLaju(pengukuran, p.id, opsi);
      if (!lj) { produkDataKurang++; continue; }
      if (!(lj.laju > 0)) continue;
      const stok = Math.max(0, Number(t[`stok_${p.id}`] || 0));
      const habisHari = stok / lj.laju; // hari sejak kunjungan terakhir
      const habisTanggal = tambahHari(terakhir.tanggal.slice(0, 10), Math.floor(habisHari));
      const sisaHari = selisihHari(hariIni, habisTanggal);
      let level = null;
      if (sisaHari <= 0) level = "habis";
      else if (sisaHari <= opsi.segeraHari) level = "segera";
      else if (habisHari < opsi.jarakKunjunganHari) level = "waspada"; // tak cukup sampai kunjungan berikutnya
      if (!level) continue;
      risiko.push({
        produkId: p.id, nama: p.nama || p.id, stok,
        lajuPerHari: Math.round(lj.laju * 100) / 100,
        habisTanggal, sisaHari, level,
        dasarHari: lj.hari, dasarTerjual: lj.terjual,
      });
    }
    if (risiko.length) {
      risiko.sort((a, b) => LEVEL_URUT[a.level] - LEVEL_URUT[b.level] || a.sisaHari - b.sisaHari);
      restok.push({
        tokoId: t.id, nama: t.nama || "(tanpa nama)", ruteId: t.ruteId || "", wilayahId: wil,
        terakhir: terakhir.tanggal.slice(0, 10),
        level: risiko[0].level, sisaHari: risiko[0].sisaHari, produk: risiko,
      });
    }
  }

  terlambat.sort((a, b) => b.hari - a.hari);
  restok.sort((a, b) => LEVEL_URUT[a.level] - LEVEL_URUT[b.level] || a.sisaHari - b.sisaHari);

  return { terlambat, restok, tanpaRiwayat, produkDataKurang, opsi };
}

// ─────────────────────────────────────────────
//  KONFIGURASI (ambang yang bisa diubah Admin/Manajer)
// ─────────────────────────────────────────────
// Disimpan di Firebase: gwg_data/_config/analitikToko (lihat analitikConfig.js).
// BATAS dipakai oleh form, validasi, DAN Firebase Rules v18 (nilai di sana harus sama;
// ada tes yang menjaga keselarasannya).
export const BATAS = {
  jarakKunjunganHari: { min: 7,  max: 120, label: "Jarak kunjungan normal",      satuan: "hari", info: "Seberapa sering tiap toko biasanya dikunjungi." },
  terlambatHari:      { min: 7,  max: 180, label: "Dianggap terlambat setelah",   satuan: "hari", info: "Harus ≥ jarak kunjungan normal, kalau tidak toko yang sesuai jadwal ikut ditandai." },
  segeraHari:         { min: 1,  max: 30,  label: "\"Segera habis\" bila sisa",   satuan: "hari", info: "Harus < jarak kunjungan normal." },
  jendelaMinHari:     { min: 7,  max: 60,  label: "Data minimum agar dipercaya",  satuan: "hari", lanjutan: true, info: "Di bawah ini produk tidak ditandai sama sekali." },
  jendelaTargetHari:  { min: 14, max: 180, label: "Jendela perhitungan laju",     satuan: "hari", lanjutan: true, info: "Berapa hari ke belakang penjualan dijumlahkan. Pendek = peka tapi berisik." },
  jendelaMaksHari:    { min: 30, max: 365, label: "Data tertua yang dipakai",     satuan: "hari", lanjutan: true, info: "Penjualan lebih lama dari ini diabaikan." },
};
export const KUNCI_CONFIG = Object.keys(BATAS);

const bulat = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);

/**
 * Validasi KETAT untuk form (sebelum disimpan). Tidak mengubah nilai diam-diam.
 * @returns {{ok:boolean, errors:Object<string,string>, nilai:object}}
 */
export function validasiAnalitikConfig(raw) {
  const errors = {};
  const nilai = {};
  for (const k of KUNCI_CONFIG) {
    const b = BATAS[k];
    const v = bulat(typeof raw?.[k] === "string" && raw[k].trim() !== "" ? Number(raw[k]) : raw?.[k]);
    if (Number.isNaN(v)) { errors[k] = "Isi dengan angka."; continue; }
    if (v < b.min || v > b.max) { errors[k] = `Harus antara ${b.min}–${b.max} ${b.satuan}.`; continue; }
    nilai[k] = v;
  }
  if (!errors.terlambatHari && !errors.jarakKunjunganHari && nilai.terlambatHari < nilai.jarakKunjunganHari)
    errors.terlambatHari = "Tidak boleh lebih kecil dari jarak kunjungan normal.";
  if (!errors.segeraHari && !errors.jarakKunjunganHari && nilai.segeraHari >= nilai.jarakKunjunganHari)
    errors.segeraHari = "Harus lebih kecil dari jarak kunjungan normal.";
  if (!errors.jendelaMinHari && !errors.jendelaTargetHari && nilai.jendelaMinHari > nilai.jendelaTargetHari)
    errors.jendelaMinHari = "Tidak boleh lebih besar dari jendela perhitungan.";
  if (!errors.jendelaTargetHari && !errors.jendelaMaksHari && nilai.jendelaTargetHari > nilai.jendelaMaksHari)
    errors.jendelaTargetHari = "Tidak boleh lebih besar dari data tertua yang dipakai.";
  return { ok: Object.keys(errors).length === 0, errors, nilai };
}

/**
 * Pembacaan LONGGAR dari Firebase/cache: data rusak/tidak lengkap tidak boleh merusak kartu.
 * Nilai yang tidak valid diganti bawaan; bila kombinasi melanggar aturan antar-field,
 * seluruh konfigurasi jatuh ke bawaan (lebih aman daripada kombinasi setengah-benar).
 */
export function bacaAnalitikConfig(raw) {
  const kandidat = { ...ANALITIK_DEFAULT };
  if (raw && typeof raw === "object") {
    for (const k of KUNCI_CONFIG) {
      const v = bulat(raw[k]);
      if (!Number.isNaN(v) && v >= BATAS[k].min && v <= BATAS[k].max) kandidat[k] = v;
    }
  }
  return validasiAnalitikConfig(kandidat).ok ? kandidat : { ...ANALITIK_DEFAULT };
}
