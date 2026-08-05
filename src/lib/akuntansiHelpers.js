// ═══════════════════════════════════════════════════════════════════════
//  FASE 1 — FONDASI DOUBLE-ENTRY ACCOUNTING
// ═══════════════════════════════════════════════════════════════════════
// Lihat RANCANGAN-double-entry.md untuk desain lengkap & alasan tiap
// keputusan. File ini murni logika (tidak menyentuh Firebase/UI):
//   1. Chart of Accounts default (seed untuk `daftarAkun` saat pertama kali
//      diinisialisasi — sesudahnya bisa diedit/ditambah/dikurangi lewat UI
//      di fase berikutnya, TIDAK di-hardcode di sini lagi).
//   2. Validasi & pembuatan entry jurnal (`buatEntryJurnal`) — memastikan
//      TIDAK MUNGKIN ada entry timpang (debit ≠ kredit) tersimpan, dari
//      jalur mana pun kode ini dipanggil.
//   3. Helper baca tipe/normal-balance akun dari kode 4-digit.
//
// ⚠️ Kode akun (4 digit) adalah KUNCI TEKNIS TETAP dipakai mesin posting —
// jangan diubah nilainya walau `nama` tampilan akun boleh diedit bebas per
// instalasi (white-label) lewat tabel `daftarAkun` di Firebase.

import { genUniqueId } from "./format";

// ─── Tipe akun & normal balance, ditentukan dari digit pertama kode ───
// 1=Aset(Debit) 2=Kewajiban(Kredit) 3=Ekuitas(Kredit) 4=Pendapatan(Kredit) 5=Beban(Debit)
export const TIPE_AKUN_LABELS = {
  aset: "Aset", kewajiban: "Kewajiban", ekuitas: "Ekuitas",
  pendapatan: "Pendapatan", beban: "Beban",
};

export function getTipeAkunDariKode(kode) {
  const d = String(kode||"")[0];
  if (d === "1") return "aset";
  if (d === "2") return "kewajiban";
  if (d === "3") return "ekuitas";
  if (d === "4") return "pendapatan";
  if (d === "5") return "beban";
  return null;
}

// Akun kontra (normal balance-nya kebalikan dari tipe induknya) — daftar
// eksplisit karena tidak bisa ditebak dari kode saja (mis. 1290 Akumulasi
// Penyusutan tetap kode "1xxx" / Aset, tapi normal balance-nya KREDIT).
const AKUN_KONTRA = new Set(["1290"]);

export function getNormalBalance(kode) {
  const tipe = getTipeAkunDariKode(kode);
  const isDebitType = tipe === "aset" || tipe === "beban";
  const isKontra = AKUN_KONTRA.has(String(kode));
  return (isDebitType !== isKontra) ? "debit" : "kredit"; // XOR
}

// ─── Chart of Accounts default (seed) ───
// Dipakai HANYA saat `daftarAkun` di Firebase masih kosong (instalasi
// baru/pertama migrasi). Sesudah itu, sumber kebenaran adalah data di
// Firebase (`db.daftarAkun`), bukan konstanta ini — supaya nama & daftar
// akun tambahan yang diedit Admin tidak tertimpa tiap kali kode di-deploy.
// `protected: true` = dipakai langsung oleh mesin posting otomatis (lihat
// tabel referensi di RANCANGAN-double-entry.md §1) — tidak boleh dihapus,
// hanya bisa dinonaktifkan (`aktif:false`) & namanya tetap bisa diedit.
export const DEFAULT_DAFTAR_AKUN = {
  // ASET
  "1101": { nama: "Kas", tipe: "aset", protected: true, aktif: true },
  "1102": { nama: "Piutang Usaha (Toko/Konsinyasi)", tipe: "aset", protected: true, aktif: true },
  "1103": { nama: "Piutang Karyawan", tipe: "aset", protected: false, aktif: true },
  "1104": { nama: "Piutang Lainnya", tipe: "aset", protected: false, aktif: true },
  "1110": { nama: "Persediaan — Gudang Pusat", tipe: "aset", protected: true, aktif: true },
  "1111": { nama: "Persediaan — Beredar di Toko", tipe: "aset", protected: true, aktif: true },
  "1201": { nama: "Aset Tetap — Kendaraan", tipe: "aset", protected: false, aktif: true },
  "1202": { nama: "Aset Tetap — Peralatan Toko/Display", tipe: "aset", protected: false, aktif: true },
  "1203": { nama: "Aset Tetap — Sistem/Software", tipe: "aset", protected: false, aktif: true },
  "1204": { nama: "Aset Tetap — Perlengkapan Kantor", tipe: "aset", protected: false, aktif: true },
  "1205": { nama: "Aset Tetap — Lainnya", tipe: "aset", protected: false, aktif: true },
  "1290": { nama: "Akumulasi Penyusutan", tipe: "aset", protected: true, aktif: true }, // kontra-aset (kredit)

  // KEWAJIBAN
  "2101": { nama: "Hutang Usaha/Supplier", tipe: "kewajiban", protected: false, aktif: true },
  "2102": { nama: "Pinjaman Bank", tipe: "kewajiban", protected: false, aktif: true },
  "2103": { nama: "Pinjaman Investor", tipe: "kewajiban", protected: false, aktif: true },
  "2104": { nama: "Hutang Lainnya", tipe: "kewajiban", protected: false, aktif: true },
  "2110": { nama: "Kewajiban Dana Cadangan", tipe: "kewajiban", protected: true, aktif: true },
  "2120": { nama: "Hutang Bagi Hasil (Belum Dicairkan)", tipe: "kewajiban", protected: true, aktif: true },
  "2130": { nama: "Hutang Pajak", tipe: "kewajiban", protected: false, aktif: true },

  // EKUITAS
  "3101": { nama: "Modal Disetor", tipe: "ekuitas", protected: true, aktif: true },
  "3102": { nama: "Laba Ditahan", tipe: "ekuitas", protected: true, aktif: true },
  "3199": { nama: "Modal Disetor (Belum Dikonfirmasi)", tipe: "ekuitas", protected: true, aktif: true },

  // PENDAPATAN
  "4101": { nama: "Pendapatan Penjualan Konsinyasi", tipe: "pendapatan", protected: true, aktif: true },
  "4102": { nama: "Pendapatan Penjualan Luar Rute", tipe: "pendapatan", protected: true, aktif: true },
  "4103": { nama: "Pendapatan Lain-lain", tipe: "pendapatan", protected: false, aktif: true },

  // BEBAN & HPP
  "5101": { nama: "HPP (Harga Pokok Penjualan)", tipe: "beban", protected: true, aktif: true },
  "5102": { nama: "Beban Operasional", tipe: "beban", protected: false, aktif: true },
  "5103": { nama: "Beban Bonus/Insentif Sales", tipe: "beban", protected: false, aktif: true },
  "5104": { nama: "Beban Logistik/Distribusi", tipe: "beban", protected: false, aktif: true },
  "5105": { nama: "Beban Penyusutan (Amortisasi)", tipe: "beban", protected: true, aktif: true },
  "5106": { nama: "Beban Pajak", tipe: "beban", protected: false, aktif: true },
  "5107": { nama: "Beban Lain-lain", tipe: "beban", protected: false, aktif: true },
};

// Kode akun yang WAJIB ada untuk mesin posting berfungsi (subset yang
// `protected:true` di atas) — dipakai untuk validasi integritas `daftarAkun`
// sebelum posting pertama kali dijalankan.
export const KODE_AKUN_WAJIB = Object.keys(DEFAULT_DAFTAR_AKUN).filter(k => DEFAULT_DAFTAR_AKUN[k].protected);

// ─── Validasi satu baris jurnal ───
function validateSatuBaris(b, idx) {
  if (!b || typeof b !== "object") return `Baris #${idx+1}: tidak valid.`;
  if (!b.akun) return `Baris #${idx+1}: kode akun kosong.`;
  const debit = Number(b.debit) || 0, kredit = Number(b.kredit) || 0;
  if (debit < 0 || kredit < 0) return `Baris #${idx+1} (akun ${b.akun}): debit/kredit tidak boleh negatif.`;
  if (debit > 0 && kredit > 0) return `Baris #${idx+1} (akun ${b.akun}): satu baris tidak boleh mengisi debit & kredit sekaligus.`;
  if (debit === 0 && kredit === 0) return `Baris #${idx+1} (akun ${b.akun}): debit dan kredit sama-sama 0 — baris tidak berguna.`;
  return null;
}

// Validasi keseluruhan entry jurnal: minimal 2 baris, tiap baris valid, dan
// TOTAL DEBIT === TOTAL KREDIT (syarat mutlak double-entry). Mengembalikan
// { ok:true } atau { ok:false, message }.
export function validateJurnal(baris) {
  if (!Array.isArray(baris) || baris.length < 2) {
    return { ok: false, message: "Jurnal butuh minimal 2 baris (debit & kredit)." };
  }
  for (let i = 0; i < baris.length; i++) {
    const err = validateSatuBaris(baris[i], i);
    if (err) return { ok: false, message: err };
  }
  const totalDebit = baris.reduce((s, b) => s + (Number(b.debit)||0), 0);
  const totalKredit = baris.reduce((s, b) => s + (Number(b.kredit)||0), 0);
  // Pembulatan sampai 2 desimal (rupiah tidak punya pecahan, tapi jaga-jaga
  // dari floating point error seperti 0.1+0.2 !== 0.3).
  if (Math.round(totalDebit*100) !== Math.round(totalKredit*100)) {
    return { ok: false, message: `Jurnal tidak balance: total debit ${totalDebit} ≠ total kredit ${totalKredit}.` };
  }
  return { ok: true, totalDebit, totalKredit };
}

// Bangun 1 entry jurnal siap-simpan (sudah divalidasi). MELEMPAR Error kalau
// tidak balance — sengaja "gagal keras" (fail loudly) alih-alih diam-diam
// menyimpan entry timpang, sesuai prinsip double-entry: kesalahan harus
// KETAHUAN, bukan diserap diam-diam (persis masalah lama Laba Ditahan-plug
// yang sedang kita perbaiki).
export function buatEntryJurnal({ tanggal, sumberTipe, sumberId, keterangan, baris, createdBy }) {
  const v = validateJurnal(baris);
  if (!v.ok) throw new Error(`Gagal membuat jurnal — ${v.message}`);
  if (!tanggal) throw new Error("Gagal membuat jurnal — tanggal wajib diisi.");
  if (!sumberTipe) throw new Error("Gagal membuat jurnal — sumberTipe wajib diisi.");
  return {
    id: genUniqueId("J_"),
    tanggal,
    sumberTipe,
    sumberId: sumberId || null,
    keterangan: keterangan || "",
    baris: baris.map(b => ({ akun: String(b.akun), debit: Number(b.debit)||0, kredit: Number(b.kredit)||0 })),
    createdAt: Date.now(),
    createdBy: createdBy || null,
    void: false,
  };
}

// Bangun entry PEMBATALAN (reversal) dari entry lama — dipakai saat sebuah
// transaksi sumber diedit/dihapus. TIDAK menghapus entry lama (audit trail
// harus utuh), cuma menandainya `void:true` (dilakukan terpisah lewat
// updateRecord) DAN membuat entry baru berisi baris kebalikan (debit↔kredit
// ditukar) supaya saldo akun tetap benar tanpa kehilangan jejak.
export function buatEntryPembalik(entryLama, { keterangan, createdBy } = {}) {
  if (!entryLama?.baris?.length) throw new Error("Entry lama tidak valid untuk dibalik.");
  const barisBalik = entryLama.baris.map(b => ({ akun: b.akun, debit: b.kredit, kredit: b.debit }));
  return buatEntryJurnal({
    tanggal: new Date().toISOString().slice(0,10),
    sumberTipe: entryLama.sumberTipe,
    sumberId: entryLama.sumberId,
    keterangan: keterangan || `Pembalik dari jurnal ${entryLama.id} (${entryLama.keterangan||""})`,
    baris: barisBalik,
    createdBy,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 2 — POSTING KAS (kasTransaksi)
// ═══════════════════════════════════════════════════════════════════════
// Mapping kategori Kas (KATEGORI_KAS_MASUK/KATEGORI_KAS_KELUAR di
// neracaHelpers.js) → kode akun lawan Kas (1101). Kas sendiri SELALU jadi
// salah satu baris (Debit kalau tipe "masuk", Kredit kalau "keluar").
//
// ⚠️ CATATAN KETERBATASAN (akan disempurnakan di fase berikutnya): modul
// Kas saat ini TIDAK menyimpan link eksplisit ke record Aset/Hutang/Piutang
// spesifik yang terkait (mis. transaksi "Pembelian Aset" tidak tahu aset
// MANA yang dibeli, "Pembayaran Hutang Usaha" tidak tahu hutang MANA yang
// dilunasi). Jadi baris lawannya untuk kategori-kategori ini memakai akun
// GENERIK dulu:
//   - "Pembelian Aset" → 1205 (Aset Tetap Lainnya, generik) — Fase 4 akan
//     menghubungkan ini ke aset spesifik yang dibuat bersamaan & memakai
//     kode akunnya masing-masing (Kendaraan/Peralatan/dst), BUKAN 1205 lagi.
//   - "Pembayaran Hutang Usaha" / "Pelunasan Pinjaman" / "Pinjaman Masuk" →
//     akun Kewajiban generik — Fase 5 akan menghubungkan ke record
//     `hutangPiutang` spesifik begitu Kas punya field link ke situ.
//   - "Piutang Tertagih" diasumsikan piutang UMUM (bukan toko) → 1104.
//     "Setoran Penjualan Konsinyasi" diasumsikan pelunasan piutang TOKO
//     (dari penjualan `kontrol` yang di Fase 3 diposting sebagai Piutang)
//     → 1102.
export const KATEGORI_KAS_MASUK_AKUN = {
  "Setoran Penjualan Konsinyasi": "1102", // pelunasan Piutang Usaha (Toko/Konsinyasi)
  "Modal Investor": "3101",               // Modal Disetor
  "Pinjaman Masuk": "2104",                // Hutang Lainnya (generik — lihat catatan di atas)
  "Piutang Tertagih": "1104",              // Piutang Lainnya (generik, bukan toko)
  "Pendapatan Lain-lain": "4103",
  "Lainnya": "4103",
};
export const KATEGORI_KAS_KELUAR_AKUN = {
  "Biaya Operasional": "5102",
  "Biaya Logistik/Distribusi": "5104",
  "Bonus/Insentif Sales": "5103",
  "Pencairan Bagi Hasil": "2120",          // mengurangi Hutang Bagi Hasil yang sudah diakui (Fase 6)
  "Pembelian Aset": "1205",                // generik — lihat catatan di atas (Fase 4 menyempurnakan)
  "Pembayaran Pajak": "5106",
  "Pembayaran Hutang Usaha": "2101",
  "Pelunasan Pinjaman": "2104",            // generik — lihat catatan di atas (Fase 5 menyempurnakan)
  "Lainnya": "5107",
};

// Bangun `baris` jurnal (belum divalidasi/disimpan) dari 1 record
// kasTransaksi `{ tanggal, kategori, tipe: "masuk"|"keluar", nominal, id }`.
// Melempar Error kalau kategori tidak dikenali sama sekali (harusnya tidak
// pernah terjadi selama form Kas Opname cuma memakai KATEGORI_KAS_MASUK/
// KATEGORI_KAS_KELUAR yang sudah ada — pengaman kalau ada kategori baru
// ditambahkan di form tapi lupa dipetakan di sini).
export function bangunBarisJurnalKas(kasRecord) {
  const nominal = Number(kasRecord.nominal) || 0;
  const mapping = kasRecord.tipe === "masuk" ? KATEGORI_KAS_MASUK_AKUN : KATEGORI_KAS_KELUAR_AKUN;
  const lawanAkun = mapping[kasRecord.kategori];
  if (!lawanAkun) {
    throw new Error(`Kategori Kas "${kasRecord.kategori}" (tipe: ${kasRecord.tipe}) belum dipetakan ke akun manapun di bangunBarisJurnalKas().`);
  }
  if (kasRecord.tipe === "masuk") {
    return [
      { akun: "1101", debit: nominal, kredit: 0 },
      { akun: lawanAkun, debit: 0, kredit: nominal },
    ];
  }
  return [
    { akun: lawanAkun, debit: nominal, kredit: 0 },
    { akun: "1101", debit: 0, kredit: nominal },
  ];
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 3 — POSTING KONTROL (penjualan konsinyasi) & PENJUALAN LUAR RUTE
// ═══════════════════════════════════════════════════════════════════════
// Satu record kontrol/penjualanLuar bisa menjual BEBERAPA produk sekaligus
// (field `terjual_{produkId}`) + memberi bonus (`bonusInput_{produkId}`).
// Dijadikan SATU entry jurnal gabungan (bukan per-produk) supaya tidak
// membanjiri jurnalUmum dengan ratusan entry kecil per hari — baris di
// dalamnya sudah cukup detail untuk ditelusuri per produk kalau perlu lewat
// `keterangan`.
//
// ⚠️ HPP pakai fallback 0 kalau `produk.hargaModal` belum diisi Admin —
// SAMA PERSIS keterbatasan yang sudah ada di `hitungHppPeriode()`
// (neracaHelpers.js). Artinya HPP & nilai Persediaan yang berkurang di
// jurnal ini bisa UNDERSTATE (kurang dari yang sebenarnya) kalau HPP produk
// belum lengkap diisi — bukan bug baru, mewarisi keterbatasan yang sudah
// diketahui di app ini.
//
// Bonus produk (dikasih gratis ke toko) TIDAK diakui sebagai HPP/Pendapatan
// — diperlakukan sebagai Beban Bonus/Insentif Sales (5103) pada nilai modal
// (harga modal), karena bonus bukan penjualan.
function hitungTotalKontrol(record, produkArr) {
  let totalRevenue = 0, totalHpp = 0, totalBonusNilai = 0;
  (produkArr || []).forEach(p => {
    const terjual = Number(record[`terjual_${p.id}`]) || 0;
    const bonusPcs = record[`bonusInput_${p.id}`] !== undefined ? Number(record[`bonusInput_${p.id}`]) : (Number(p.bonus) || 0);
    const hargaModal = Number(p.hargaModal) || 0;
    totalRevenue += terjual * (Number(p.harga) || 0);
    totalHpp += terjual * hargaModal;
    totalBonusNilai += bonusPcs * hargaModal;
  });
  return { totalRevenue, totalHpp, totalBonusNilai };
}

// Kontrol (penjualan konsinyasi ke toko) — diasumsikan KREDIT (toko bayar
// belakangan lewat Kas Opname kategori "Setoran Penjualan Konsinyasi",
// lihat Fase 2), BUKAN tunai langsung. Hanya diposting untuk record dengan
// `status === "disetujui"` — lihat pemanggil di TabKontrol.jsx yang
// menjamin ini (record "menunggu"/"ditolak" tidak boleh sampai ke sini).
// Mengembalikan `null` kalau tidak ada apa-apa untuk diposting (mis. entri
// kunjungan "Bermasalah"/tutup tanpa penjualan sama sekali).
export function bangunBarisJurnalKontrol(record, produkArr) {
  const { totalRevenue, totalHpp, totalBonusNilai } = hitungTotalKontrol(record, produkArr);
  if (totalRevenue === 0 && totalHpp === 0 && totalBonusNilai === 0) return null;
  const baris = [];
  if (totalRevenue > 0) {
    baris.push({ akun: "1102", debit: totalRevenue, kredit: 0 }); // Piutang Usaha (Toko/Konsinyasi)
    baris.push({ akun: "4101", debit: 0, kredit: totalRevenue }); // Pendapatan Penjualan Konsinyasi
  }
  if (totalHpp > 0) {
    baris.push({ akun: "5101", debit: totalHpp, kredit: 0 });     // HPP
    baris.push({ akun: "1111", debit: 0, kredit: totalHpp });     // Persediaan — Beredar di Toko (berkurang)
  }
  if (totalBonusNilai > 0) {
    baris.push({ akun: "5103", debit: totalBonusNilai, kredit: 0 }); // Beban Bonus/Insentif Sales
    baris.push({ akun: "1111", debit: 0, kredit: totalBonusNilai }); // Persediaan berkurang (bonus keluar juga dari stok)
  }
  return baris;
}

// Penjualan Luar Rute — DIASUMSIKAN TUNAI (Kas langsung), karena tidak ada
// toko/pihak spesifik yang berpiutang dengannya (lihat catatan di
// TabKontrol.jsx: "produk yang tokonya tidak diketahui/diingat sales").
// ⚠️ Kalau ternyata praktiknya ada yang dibayar belakangan juga, mapping ini
// perlu direvisi jadi 1102 (sama seperti kontrol) — untuk sekarang belum
// ada field di form yang membedakan tunai/kredit untuk penjualan luar rute.
export function bangunBarisJurnalPenjualanLuar(record, produkArr) {
  const { totalRevenue, totalHpp, totalBonusNilai } = hitungTotalKontrol(record, produkArr);
  if (totalRevenue === 0 && totalHpp === 0 && totalBonusNilai === 0) return null;
  const baris = [];
  if (totalRevenue > 0) {
    baris.push({ akun: "1101", debit: totalRevenue, kredit: 0 }); // Kas (tunai)
    baris.push({ akun: "4102", debit: 0, kredit: totalRevenue }); // Pendapatan Penjualan Luar Rute
  }
  if (totalHpp > 0) {
    baris.push({ akun: "5101", debit: totalHpp, kredit: 0 });
    baris.push({ akun: "1111", debit: 0, kredit: totalHpp });
  }
  if (totalBonusNilai > 0) {
    baris.push({ akun: "5103", debit: totalBonusNilai, kredit: 0 });
    baris.push({ akun: "1111", debit: 0, kredit: totalBonusNilai });
  }
  return baris;
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 4 — POSTING ASET & AMORTISASI
// ═══════════════════════════════════════════════════════════════════════
// Mapping KATEGORI_ASET (neracaHelpers.js) → kode akun Aset Tetap spesifik.
export const KATEGORI_ASET_AKUN = {
  "Kendaraan": "1201",
  "Peralatan Toko/Display": "1202",
  "Sistem/Software": "1203",
  "Perlengkapan Kantor": "1204",
  "Lainnya": "1205",
};

// Perolehan (pembelian) 1 aset baru — DIASUMSIKAN DIBAYAR TUNAI LEWAT KAS
// SAAT ITU JUGA (Dr akun Aset spesifik, Kr 1101 Kas). Kalau nyatanya dibeli
// kredit/hutang, sesuaikan manual dulu — Fase 5 (Hutang/Piutang) akan
// menambah opsi "dibayar kredit" yang presisi.
//
// ⚠️ PENTING supaya TIDAK DOUBLE-COUNT dengan Fase 2 (Kas): begitu aset
// didaftarkan lewat form Amortisasi Aset ini (dan otomatis memposting
// jurnal perolehannya dari SINI), Admin JANGAN LAGI mencatat pembelian yang
// SAMA sebagai transaksi Kas kategori "Pembelian Aset" secara terpisah —
// kategori Kas itu tetap ada untuk pembelian kecil/tidak-disusutkan yang
// memang tidak didaftarkan sebagai Aset Tetap formal.
export function bangunBarisJurnalAsetPerolehan(asetRecord) {
  const nilai = Number(asetRecord.nilaiPerolehan) || 0;
  if (nilai <= 0) return null;
  const akunAset = KATEGORI_ASET_AKUN[asetRecord.kategori] || KATEGORI_ASET_AKUN["Lainnya"];
  return [
    { akun: akunAset, debit: nilai, kredit: 0 },
    { akun: "1101", debit: 0, kredit: nilai },
  ];
}

// Amortisasi/penyusutan 1 periode (dipanggil dari titik "Tutup Buku" yang
// SUDAH ADA di NeracaKeuangan.jsx — lihat tutupBukuBulanIni() — supaya tidak
// perlu UI baru; amortisasi memang secara alami adalah proses akhir periode,
// bukan per-transaksi). `totalAmortisasi` didapat dari hitungAmortisasiPeriode()
// (neracaHelpers.js) yang sudah dipakai laporan lama — SATU sumber angka
// yang sama dipakai baik di tampilan lama maupun jurnal baru ini, supaya
// tidak mungkin ada dua angka amortisasi yang beda untuk periode yang sama.
export function bangunBarisJurnalAmortisasi(totalAmortisasi) {
  const total = Number(totalAmortisasi) || 0;
  if (total <= 0) return null;
  return [
    { akun: "5105", debit: total, kredit: 0 }, // Beban Penyusutan (Amortisasi)
    { akun: "1290", debit: 0, kredit: total }, // Akumulasi Penyusutan (kontra-aset)
  ];
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 5 — POSTING HUTANG/PIUTANG
// ═══════════════════════════════════════════════════════════════════════
export const KATEGORI_HUTANG_AKUN = {
  "Hutang Supplier": "2101",
  "Pinjaman Bank": "2102",
  "Pinjaman Investor": "2103",
  "Lainnya": "2104",
};
export const KATEGORI_PIUTANG_AKUN = {
  "Piutang Toko/Konsinyasi": "1102",
  "Piutang Karyawan": "1103",
  "Lainnya": "1104",
};

// Akun spesifik (bukan generik) untuk 1 record hutangPiutang, berdasarkan
// `tipe` + `kategori`-nya. Dipakai baik untuk posting pengakuan awal maupun
// pelunasan — supaya DUA-DUANYA konsisten memakai akun yang SAMA (beda
// dengan Fase 2 yang sempat memetakan pelunasan lewat kategori Kas generik
// "Pembayaran Hutang Usaha"/"Piutang Tertagih" tanpa peduli kategori
// spesifik hutangPiutang-nya — sudah diperbaiki di bangunBarisJurnalPelunasanHutangPiutang
// di bawah, TIDAK lagi lewat bangunBarisJurnalKas()).
export function akunHutangPiutang(record) {
  const mapping = record.tipe === "hutang" ? KATEGORI_HUTANG_AKUN : KATEGORI_PIUTANG_AKUN;
  return mapping[record.kategori] || mapping["Lainnya"];
}

// Pengakuan AWAL 1 hutang/piutang (saat record dibuat, SEBELUM ada
// pembayaran/pelunasan apa pun). Asumsi lawan akun ditentukan dari
// tipe+kategori:
//   - Piutang "Toko/Konsinyasi" → return null, SENGAJA TIDAK diposting dari
//     sini — piutang jenis ini SUDAH diposting otomatis lewat Kontrol (Fase
//     3, Dr 1102). Kalau modul ini JUGA memposting Dr 1102 lagi untuk
//     record yang sama, itu DOUBLE-COUNT. Form Hutang/Piutang kategori ini
//     dianggap murni alat bantu tracking manual atas saldo yang sudah
//     diposting dari Kontrol, bukan sumber jurnal baru.
//   - Piutang lain (Karyawan/Lainnya) → diasumsikan Kas keluar duluan
//     (perusahaan kasih pinjaman/uang muka): Dr Piutang spesifik / Kr Kas.
//   - Hutang "Supplier" → diasumsikan barang/persediaan diterima duluan:
//     Dr Persediaan Gudang Pusat / Kr Hutang spesifik.
//   - Hutang lain (Pinjaman Bank/Investor/Lainnya) → diasumsikan Kas masuk
//     duluan: Dr Kas / Kr Hutang spesifik.
export function bangunBarisJurnalHutangPiutangAwal(record) {
  if (record.tipe === "piutang" && record.kategori === "Piutang Toko/Konsinyasi") return null;
  const nominal = Number(record.nominalAwal) || 0;
  if (nominal <= 0) return null;
  const akunSpesifik = akunHutangPiutang(record);
  if (record.tipe === "piutang") {
    return [
      { akun: akunSpesifik, debit: nominal, kredit: 0 },
      { akun: "1101", debit: 0, kredit: nominal }, // Kas keluar
    ];
  }
  // hutang
  const akunLawan = record.kategori === "Hutang Supplier" ? "1110" : "1101"; // Persediaan Gudang Pusat vs Kas
  return [
    { akun: akunLawan, debit: nominal, kredit: 0 },
    { akun: akunSpesifik, debit: 0, kredit: nominal },
  ];
}

// Pelunasan/penagihan SEBAGIAN atau PENUH — dipanggil dari submitBayar()
// (NeracaKeuangan.jsx), MENGGANTIKAN pemetaan generik Fase 2
// (bangunBarisJurnalKas lewat kategori Kas "Pembayaran Hutang Usaha"/
// "Piutang Tertagih") supaya lawan akunnya PRESISI ke kategori spesifik
// record ybs (mis. Pinjaman Bank berkurang di 2102, bukan bucket generik
// 2104/2101 lagi).
export function bangunBarisJurnalPelunasanHutangPiutang(record, nominal) {
  const n = Number(nominal) || 0;
  if (n <= 0) return null;
  const akunSpesifik = akunHutangPiutang(record);
  if (record.tipe === "hutang") {
    // Bayar hutang: Kewajiban berkurang (debit), Kas berkurang (kredit)
    return [
      { akun: akunSpesifik, debit: n, kredit: 0 },
      { akun: "1101", debit: 0, kredit: n },
    ];
  }
  // Tagih piutang: Kas bertambah (debit), Piutang berkurang (kredit) —
  // KECUALI "Piutang Toko/Konsinyasi" yang akun-lawannya tetap 1102 (sudah
  // benar dari Kontrol Fase 3, tidak perlu penanganan khusus di sini karena
  // akunHutangPiutang() sudah memetakan kategori itu ke 1102 juga).
  return [
    { akun: "1101", debit: n, kredit: 0 },
    { akun: akunSpesifik, debit: 0, kredit: n },
  ];
}


// ═══════════════════════════════════════════════════════════════════════
//  FASE 6 — DANA CADANGAN SEBAGAI APROPRIASI LABA (bukan beban P&L)
// ═══════════════════════════════════════════════════════════════════════
// Dana Cadangan (config.danaCadangan) MENGURANGI SHU yang dibagi ke pihak,
// tapi bukan "beban usaha" dalam pengertian akuntansi — diperlakukan
// sebagai APROPRIASI LABA: Debit Laba Ditahan, Kredit Kewajiban Dana
// Cadangan. Ini mempertahankan makna aslinya (mengunci sebagian laba jadi
// cadangan) tanpa memutar-balikkan definisi "beban" (lihat
// RANCANGAN-double-entry.md §1, catatan di bawah tabel akun Beban).
//
// `hitungDanaCadanganKumulatif()` (neracaHelpers.js) menghasilkan angka
// ALL-TIME (bukan per-periode) — jadi journal-nya diposting sebagai
// SELISIH (increment) dari yang sudah pernah diposting sebelumnya, bukan
// nilai penuh tiap kali. Dipanggil dari titik Tutup Buku (sama seperti
// Amortisasi, Fase 4) karena sifatnya juga alami sebagai proses akhir
// periode, bukan per-transaksi.
export function bangunBarisJurnalApropriasiDanaCadangan(incrementAmount) {
  const inc = Number(incrementAmount) || 0;
  if (inc <= 0) return null; // increment negatif (mis. rpPerPcs diturunkan) sengaja tidak diposting otomatis — perlu koreksi manual
  return [
    { akun: "3102", debit: inc, kredit: 0 }, // Laba Ditahan berkurang
    { akun: "2110", debit: 0, kredit: inc }, // Kewajiban Dana Cadangan bertambah
  ];
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 8 (OPSI B) — SALDO AKUN TERKINI DARI JURNAL (buat perbandingan)
// ═══════════════════════════════════════════════════════════════════════
// Dipakai untuk section "Neraca (versi Jurnal)" yang tampil BERDAMPINGAN
// dengan Laporan Neraca lama (bukan menggantikannya) — supaya angka bisa
// dibandingkan dulu sebelum diputuskan untuk benar-benar migrasi penuh.
//
// Saldo "TERKINI" (hari ini, bukan per-periode) dihitung dari:
//   1. Snapshot bulan TERTUTUP TERAKHIR yang ada di saldoAkunBulanan
//      (kalau belum pernah ada yang ditutup, saldo awal = 0 semua).
//   2. + seluruh entry jurnalUmum (yang sedang termuat di state — tahun
//      berjalan) yang tanggalnya SETELAH bulan snapshot terakhir itu.
export function hitungSaldoAkunTerkini(jurnalUmumArr, saldoAkunBulananMap, daftarAkun) {
  const sumberAkun = daftarAkun && Object.keys(daftarAkun).length > 0 ? daftarAkun : DEFAULT_DAFTAR_AKUN;
  const bulanTertutupUrut = Object.keys(saldoAkunBulananMap || {}).sort();
  const bulanTerakhir = bulanTertutupUrut.length ? bulanTertutupUrut[bulanTertutupUrut.length - 1] : null;
  const saldoAwal = {};
  Object.keys(sumberAkun).forEach(k => { saldoAwal[k] = 0; });
  if (bulanTerakhir) {
    const snap = saldoAkunBulananMap[bulanTerakhir] || {};
    Object.keys(snap).forEach(k => { saldoAwal[k] = Number(snap[k]?.saldoAkhir) || 0; });
  }
  const entries = (jurnalUmumArr || []).filter(j => {
    if (j.void) return false;
    if (!bulanTerakhir) return true;
    return String(j.tanggal || "").slice(0, 7) > bulanTerakhir;
  });
  const totals = {};
  Object.keys(sumberAkun).forEach(k => { totals[k] = { debit: 0, kredit: 0 }; });
  entries.forEach(j => (j.baris || []).forEach(b => {
    if (!totals[b.akun]) totals[b.akun] = { debit: 0, kredit: 0 };
    totals[b.akun].debit += Number(b.debit) || 0;
    totals[b.akun].kredit += Number(b.kredit) || 0;
  }));
  const saldoAkhir = {};
  Object.keys(totals).forEach(kode => {
    const normal = getNormalBalance(kode);
    const awal = saldoAwal[kode] || 0;
    saldoAkhir[kode] = normal === "debit" ? awal + totals[kode].debit - totals[kode].kredit : awal + totals[kode].kredit - totals[kode].debit;
  });
  return { saldoAkhir, bulanTerakhirTertutup: bulanTerakhir };
}

// Ringkasan per tipe akun (Aset/Kewajiban/Ekuitas/Pendapatan/Beban) dari
// hasil hitungSaldoAkunTerkini(), + cek keseimbangan. ⚠️ CATATAN: akun
// Pendapatan & Beban di desain ini belum pernah "ditutup" (closing entry)
// ke Laba Ditahan di titik mana pun (Fase 1-7 tidak menambahkannya) — jadi
// saldo Pendapatan/Beban terkini mencerminakan SELURUH akumulasi sejak
// awal pemakaian, bukan cuma periode berjalan. Supaya Aset = Kewajiban +
// Ekuitas tetap valid sebagai pengecekan, "Laba Berjalan (belum ditutup)"
// = Pendapatan − Beban dihitung terpisah dan dianggap bagian dari Ekuitas
// sementara (mirip Laba Ditahan yang belum di-carry-forward resmi).
export function ringkasanSaldoAkunPerTipe(saldoAkhirMap, daftarAkun) {
  const sumberAkun = daftarAkun && Object.keys(daftarAkun).length > 0 ? daftarAkun : DEFAULT_DAFTAR_AKUN;
  const perTipe = { aset: 0, kewajiban: 0, ekuitas: 0, pendapatan: 0, beban: 0 };
  const rincian = { aset: [], kewajiban: [], ekuitas: [], pendapatan: [], beban: [] };
  Object.keys(sumberAkun).forEach(kode => {
    const tipe = getTipeAkunDariKode(kode);
    if (!tipe) return;
    const saldo = Number(saldoAkhirMap?.[kode]) || 0;
    perTipe[tipe] += saldo;
    rincian[tipe].push({ kode, nama: sumberAkun[kode]?.nama || kode, saldo });
  });
  const labaBerjalan = perTipe.pendapatan - perTipe.beban;
  const totalAset = perTipe.aset;
  const totalKewajibanEkuitas = perTipe.kewajiban + perTipe.ekuitas + labaBerjalan;
  const selisih = Math.round((totalAset - totalKewajibanEkuitas) * 100) / 100;
  return { perTipe, rincian, labaBerjalan, totalAset, totalKewajibanEkuitas, selisih, balance: Math.abs(selisih) < 1 };
}
// ═══════════════════════════════════════════════════════════════════════
// Dipanggil dari titik Tutup Buku (bareng Amortisasi & Dana Cadangan di
// Fase 4/6) — supaya `jurnalUmum` detail tahun-tahun lama SUATU SAAT bisa
// diarsipkan/dihapus tanpa kehilangan saldo kumulatifnya (pola yang SAMA
// dengan `kontrolArchiveIndex` di Fase 1). Neraca & Laba Rugi periode yang
// SUDAH TERTUTUP nantinya (Fase 8) tinggal baca snapshot ini, bukan
// menjumlah ulang seluruh jurnal detail dari awal waktu setiap kali dibuka.

// "YYYY-MM" bulan sebelumnya dari "YYYY-MM" yang diberikan.
export function bulanSebelumnya(bulanKey) {
  const [y, m] = String(bulanKey || "").split("-").map(Number);
  if (!y || !m) return null;
  const d = new Date(y, m - 2, 1); // m-2 karena Date bulan 0-indexed & kita mundur 1 bulan
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Hitung snapshot saldo SEMUA akun di `daftarAkun` untuk 1 bulan, dari
// gabungan entry jurnal bulan itu (`entriesBulanIni`, sudah difilter
// tanggal & tidak void oleh pemanggil) + saldo awal (hasil snapshot bulan
// sebelumnya, atau semua 0 kalau bulan pertama yang ditutup).
export function hitungSnapshotSaldoAkun(entriesBulanIni, saldoAwalMap, daftarAkun) {
  const sumberAkun = daftarAkun && Object.keys(daftarAkun).length > 0 ? daftarAkun : DEFAULT_DAFTAR_AKUN;
  const totals = {};
  Object.keys(sumberAkun).forEach(k => { totals[k] = { debit: 0, kredit: 0 }; });
  (entriesBulanIni || []).forEach(entry => {
    if (entry?.void) return;
    (entry?.baris || []).forEach(b => {
      if (!totals[b.akun]) totals[b.akun] = { debit: 0, kredit: 0 }; // akun custom di luar daftarAkun tetap ditangkap
      totals[b.akun].debit += Number(b.debit) || 0;
      totals[b.akun].kredit += Number(b.kredit) || 0;
    });
  });
  const lockedAt = new Date().toISOString();
  const snapshot = {};
  Object.keys(totals).forEach(kode => {
    const saldoAwal = Number(saldoAwalMap?.[kode]?.saldoAkhir ?? saldoAwalMap?.[kode]) || 0;
    const { debit, kredit } = totals[kode];
    const normal = getNormalBalance(kode);
    const saldoAkhir = normal === "debit" ? saldoAwal + debit - kredit : saldoAwal + kredit - debit;
    snapshot[kode] = { saldoAwal, totalDebit: debit, totalKredit: kredit, saldoAkhir, lockedAt };
  });
  return snapshot;
}
