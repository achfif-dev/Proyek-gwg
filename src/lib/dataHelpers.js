export const LIST_TABLES = ["wilayah", "rute", "toko", "produk", "kontrol", "pengguna", "penyesuaian", "penjualanLuar",
  // ✅ FIX BUG SINKRONISASI: "penarikanToko" (pengajuan Tarik/Non-Aktifkan
  // Toko dari Sales) sebelumnya TIDAK ada di LIST_TABLES ini, padahal dipakai
  // luas di TabKontrol.jsx (addRecord/updateRecord/panel approval/auto-approve
  // 24 jam). Akibatnya tabel ini tidak pernah ikut listener live-sync di
  // useDB.js (paths dibangun dari LIST_TABLES) — pengajuan dari Sales hanya
  // tampak di device Sales sendiri (optimistic local update), TIDAK PERNAH
  // terlihat di device Admin/Manajer lain, dan tidak ikut terhapus saat
  // Reset Semua Data. Menambahkannya di sini otomatis mengikutkannya ke
  // listener onValue tabel kecil, ke save() diff-per-tabel, dan ke resetDB().
  "penarikanToko",
  // ✅ NERACA KEUANGAN (Tab Bagi Hasil): 3 tabel baru untuk Kas Opname (buku
  // kas lengkap), Stock Opname (opname fisik vs sistem), dan Amortisasi
  // (daftar aset & penyusutan). Didaftarkan di sini supaya otomatis ikut
  // mekanisme sync/backup/restore yang sama seperti tabel lain (read di
  // useDB paths, tulis granular per-record via addRecord/updateRecord).
  "kasTransaksi", "asetAmortisasi", "stockOpname",
  // ✅ NERACA KEUANGAN lanjutan: Hutang/Piutang (buat Laporan Neraca
  // Aset=Kewajiban+Ekuitas) & log pencairan Bagi Hasil (biar tombol
  // "Cairkan ke Kas" tidak mencatat dobel ke buku kas).
  "hutangPiutang", "distribusiLog",
  // ✅ Tutup Buku: id record = "YYYY-MM", menandai bulan yang datanya sudah
  // dikunci (Kas/Stock Opname/Hutang-Piutang tidak bisa diubah lagi tanpa
  // dibuka kuncinya dulu).
  "tutupBuku",
  // ✅ Stok Gudang Pusat: ledger masuk/keluar stok gudang, terpisah dari
  // stok konsinyasi yang beredar di toko (field stok_* pada tabel toko).
  "gudangTransaksi",
  // ✅ FASE 1 DOUBLE-ENTRY ACCOUNTING (lihat RANCANGAN-double-entry.md):
  // Jurnal Umum — setiap transaksi sumber (Kontrol, Kas, Aset, Hutang/
  // Piutang, dst) memposting minimal 2 baris (debit=kredit) ke sini.
  // Dipartisi PER TAHUN persis seperti "kontrol" (lihat kontrolYearOf() —
  // dipakai juga untuk jurnalUmum karena sama-sama punya field `.tanggal`),
  // supaya bisa ikut mekanisme arsip yang sama nanti kalau volumenya besar.
  "jurnalUmum"];

// Jeda maksimum (hari) antar tanggal kontrol berurutan di satu wilayah supaya
// masih dianggap 1 putaran/siklus yang sama (dipakai di Rekap → "Siklus
// Wilayah", dan di Kontrol Bulanan untuk penanda toko yang belum dikontrol
// di siklus berjalan). Satu konstanta dipakai bersama supaya definisi
// "periode kontrol" konsisten di seluruh app — tidak berpatokan pada bulan
// kalender, karena siklus kunjungan tiap wilayah bisa maju-mundur tanggalnya.
export const SIKLUS_GAP_DAYS = 10;

// ✅ Ambang jeda (hari) yang dipakai HANYA setelah 1 putaran sudah dianggap
// LENGKAP (rute terakhir di wilayah itu sudah kebagian giliran) — lihat
// computeSiklusSegmentsPerWilayah. Lebih ketat dari SIKLUS_GAP_DAYS karena
// setelah rute terakhir selesai, kunjungan susulan (toko yang sempat tutup
// dikontrol lagi) biasanya cuma berjarak 1-3 hari — jeda lebih dari
// "sepekan" ini dianggap sudah masuk siklus BARU, bukan susulan lagi.
export const SIKLUS_GAP_DAYS_SETELAH_LENGKAP = 7;

// ✅ Pecah SATU daftar tanggal kontrol (sudah untuk 1 wilayah) menjadi
// beberapa SEGMEN SIKLUS (putaran) terpisah: dua tanggal berurutan dianggap
// masih 1 siklus yang sama kalau jaraknya ≤ SIKLUS_GAP_DAYS hari, kalau
// lebih maka siklus baru dimulai. Hasil terurut kronologis (siklus paling
// LAMA duluan, siklus TERBARU di elemen terakhir array).
export function computeSiklusSegments(dates) {
  const sorted = [...new Set(dates)].filter(Boolean).sort();
  if (!sorted.length) return [];
  const segments = [];
  let segStart = sorted[0], segEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const diffDays = (new Date(sorted[i]) - new Date(segEnd)) / 86400000;
    if (diffDays > SIKLUS_GAP_DAYS) { segments.push({ start: segStart, end: segEnd }); segStart = sorted[i]; }
    segEnd = sorted[i];
  }
  segments.push({ start: segStart, end: segEnd });
  return segments;
}

// ⚠️ FIX BUG: sebelumnya fungsi ini cuma memecah berdasar JEDA TANGGAL
// (delegasi murni ke computeSiklusSegments) — cukup akurat untuk wilayah
// yang rute-nya lama (>SIKLUS_GAP_DAYS hari untuk habis 1 putaran) dan
// biasanya ADA jeda alami antar putaran. TAPI untuk wilayah dengan rute
// PENDEK — bisa dihabiskan (semua toko dikunjungi 1x) dalam waktu KURANG
// dari sebulan, lalu sales langsung lanjut ke putaran berikutnya tanpa
// jeda panjang — kumpulan TANGGAL kunjungannya jadi rapat terus-menerus
// (selisih antar tanggal berurutan selalu ≤ SIKLUS_GAP_DAYS hari) walau
// sebenarnya sudah masuk putaran ke-2/ke-3. Murni dari jeda tanggal, ini
// SALAH dianggap 1 siklus raksasa — tidak pernah terpecah jadi "Siklus
// 1/2/3 (terbaru)" di panel filter Rekap.
//
// Fix (v1, SALAH): sempat dicoba menganggap toko yang MUNCUL LAGI di
// tanggal APAPUN yang berbeda sebagai penanda putaran baru. Keliru untuk
// kasus "kunjungan susulan" — toko yang tutup saat rute lewat, lalu
// dikontrol lagi ±1-3 hari setelah rute itu selesai — itu MASIH bagian
// siklus yang sama, bukan siklus baru, padahal toko yang sama muncul di
// tanggal berbeda.
//
// Fix (v2, KURANG PAS): lalu dicoba jeda sejak toko itu SENDIRI (bukan
// tanggal wilayah) terakhir dikunjungi, dengan SATU ambang (SIKLUS_GAP_
// DAYS, 10 hari) untuk semua kasus. Susulan cepat (1-3 hari) lolos, tapi
// ambang 10 hari itu tidak membedakan "belum tentu semua toko kebagian
// giliran" dari "rute terakhir sudah selesai, ini beneran susulan".
//
// Fix (v3, KELIRU JUGA): dicoba GABUNGAN kelengkapan putaran + jeda
// PER-TOKO (jarak dari kemunculan TERAKHIR toko itu sendiri, bukan jeda
// tanggal wilayah). Ternyata ini salah untuk toko dari rute AWAL (rute 1,
// 2, dst): kalau wilayah punya belasan rute, toko di rute 1 otomatis
// sudah berjarak PULUHAN hari dari kunjungan pertamanya begitu rute
// TERAKHIR (mis. rute 13) selesai — jadi begitu toko rute 1 itu disusul
// 1-3 hari kemudian, jeda PER-TOKO-nya tetap besar (puluhan hari, warisan
// dari rute 1 ke rute 13), salah kena ambang SIKLUS_GAP_DAYS_SETELAH_
// LENGKAP (7 hari) dan dianggap siklus baru — padahal ini jelas susulan
// (jeda dari kunjungan TERAKHIR WILAYAH cuma 1-3 hari, cuma jaraknya dari
// TOKO ITU SENDIRI yang kebetulan jauh karena posisinya di rute awal).
//
// Fix (v4, DIPAKAI): jeda PER-TOKO dilepas — kembali ke jeda GLOBAL
// (dari kunjungan TERAKHIR WILAYAH itu, siapa pun tokonya/rute berapa
// pun), tapi ambangnya tetap MENGECIL begitu putaran dianggap lengkap
// (rute terakhir sudah kebagian giliran): SIKLUS_GAP_DAYS (10 hari)
// sebelum lengkap, SIKLUS_GAP_DAYS_SETELAH_LENGKAP (7 hari) sesudahnya.
// Ini otomatis benar untuk toko dari rute BERAPA PUN — yang dicek adalah
// "sudah berapa hari sejak wilayah ini TERAKHIR dikontrol", bukan sejak
// toko itu sendiri terakhir dikontrol — jadi susulan 1-3 hari (toko rute
// 1 atau rute 13 sekalipun) tetap 1 siklus, dan jeda >1 minggu (tanpa
// kontrol SAMA SEKALI di wilayah itu, bukan cuma 1 toko tertentu) baru
// dianggap siklus baru.
//
// ⚠️ Batasan yang MASIH ada: kalau wilayah itu SAMA SEKALI tidak pernah
// libur/jeda antar putaran (rute 1 langsung disusul lagi besoknya setelah
// rute terakhir kelar, tanpa jeda sehari pun >7 hari), pendekatan jeda
// global ini tidak bisa membedakannya dari susulan biasa — akan tetap
// dianggap 1 siklus sampai suatu saat memang ada jeda >7 hari. Kalau pola
// wilayah Anda memang seperti ini (betul-betul tanpa jeda sama sekali
// antar putaran), kasih tahu — perlu penanda eksplisit di form kontrol
// (mis. ceklis "kunjungan susulan siklus sebelumnya") supaya tidak
// bergantung pada tebakan jarak hari sama sekali.
export function computeSiklusSegmentsPerWilayah(kontrolList, ruteList) {
  const byWilayah = {};
  (kontrolList || []).forEach(k => {
    if (!k.wilayahId || !k.tanggal || !k.tokoId) return;
    (byWilayah[k.wilayahId] ||= []).push(k);
  });
  // Total rute PER WILAYAH dari Master Rute (kalau dikirim pemanggil) —
  // dihitung sekali di sini, dipakai sebagai acuan "rute terakhir" untuk
  // semua wilayah sekaligus.
  const totalRuteDariMaster = {};
  (ruteList || []).forEach(r => {
    if (!r?.wilayahId) return;
    totalRuteDariMaster[r.wilayahId] = (totalRuteDariMaster[r.wilayahId] || 0) + 1;
  });

  const map = {};
  Object.entries(byWilayah).forEach(([wilayahId, entriesForWilayah]) => {
    const sorted = [...entriesForWilayah].sort((a, b) =>
      a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0);
    // Fallback: kalau ruteList tidak dikirim (atau wilayah ini tidak ada
    // rute-nya di Master Rute — data tidak konsisten), pakai jumlah ruteId
    // BERBEDA yang pernah tercatat di histori kontrol wilayah ini sendiri.
    const totalRuteWilayah = totalRuteDariMaster[wilayahId] !== undefined
      ? totalRuteDariMaster[wilayahId]
      : new Set(sorted.map(e => e.ruteId).filter(Boolean)).size;

    const segments = [];
    let segStart = sorted[0].tanggal, segEnd = sorted[0].tanggal;
    // Set rute yang sudah kebagian giliran DALAM segmen yang sedang berjalan.
    let ruteSeenInSegment = new Set(sorted[0].ruteId ? [sorted[0].ruteId] : []);

    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const diffDays = (new Date(cur.tanggal) - new Date(segEnd)) / 86400000;

      // Putaran lengkap = semua rute wilayah ini sudah pernah kebagian
      // giliran di segmen yang sedang berjalan (rute terakhir sudah lewat).
      const putaranLengkap = totalRuteWilayah > 0 && ruteSeenInSegment.size >= totalRuteWilayah;
      const thresholdUmum = putaranLengkap ? SIKLUS_GAP_DAYS_SETELAH_LENGKAP : SIKLUS_GAP_DAYS;

      if (diffDays > thresholdUmum) {
        segments.push({ start: segStart, end: segEnd });
        segStart = cur.tanggal;
        ruteSeenInSegment = new Set();
      }
      if (cur.ruteId) ruteSeenInSegment.add(cur.ruteId);
      segEnd = cur.tanggal;
    }
    segments.push({ start: segStart, end: segEnd });
    map[wilayahId] = segments;
  });
  return map;
}

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
// ✅ CODE-SPLITTING: dipindah dari TabToko.jsx (komponen UI berat, 792 baris)
// ke sini supaya App.jsx bisa memanggil fungsi ini tanpa memaksa seluruh
// komponen TabToko ikut ter-download di awal — TabToko sekarang bisa
// di-lazy-load murni sebagai komponen tab. Logic function-nya sendiri
// tidak berubah sama sekali.
export function autoUpgradeBaruToAktif(db, updateRecord) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  (db.toko||[]).forEach(toko => {
    if (toko.status !== "Baru") return;
    if (!toko.tanggalMasuk) return;
    const masuk = new Date(toko.tanggalMasuk);
    if (isNaN(masuk.getTime())) return;
    if (masuk <= thirtyDaysAgo) {
      // Sudah lebih dari 30 hari, upgrade ke Aktif — dicatat juga di
      // riwayat status supaya Rekap Siklus Wilayah bisa merekonstruksi
      // status toko ini secara akurat pada tanggal berapa pun di masa lalu.
      updateRecord("toko", toko.id, { status: "Aktif",
        statusHistory: appendStatusHistory(toko.statusHistory, "Aktif", todayStr, "Otomatis: 30 hari sejak Tanggal Masuk (Baru → Aktif)") });
    }
  });
}

export function appendStatusHistory(existingHistory, status, tanggal, catatan) {
  const list = Array.isArray(existingHistory) ? [...existingHistory] : [];
  const last = list[list.length - 1];
  if (last && last.status === status && last.tanggal === tanggal) return list;
  list.push({ status, tanggal, catatan: catatan || "" });
  return list;
}


// ✅ SHARED: dari daftar produkIds baru, hasilkan juga flag produk_<id>
// (boolean per produk) yang dipakai Master Toko (kolom tabel & form ceklis
// "Produk yang Dijual" di TabToko). Diekstrak dari TabKontrol.jsx supaya
// fitur lain (mis. "Update Stok Awal" di TabToko.jsx) yang juga perlu
// menyinkronkan ceklis produk memakai LOGIKA YANG SAMA PERSIS, bukan
// duplikat kode yang bisa diam-diam berbeda seiring waktu.
export function buildProdukFlagUpdates(produkAktif, newIds) {
  const flags = {};
  (produkAktif||[]).forEach(p => { flags[`produk_${p.id}`] = newIds.includes(p.id); });
  return flags;
}

// ✅ SHARED: hitung ulang stok Master Toko dari GABUNGAN dua sumber:
//  1) "Stok Awal" pada entri Kontrol Bulanan TERAKHIR yang berstatus final
//     (bukan "menunggu"/"ditolak") — dibawa apa adanya.
//  2) Semua Penyesuaian Stok (Tambah/Kurang/Tarik) berstatus final yang
//     tanggalnya SAMA ATAU SETELAH kontrol terakhir tsb.
// Diekstrak dari TabKontrol.jsx (lihat komentar aslinya di sana) supaya
// SEMUA fitur yang mengubah stok toko lewat "penyesuaian" (Penyesuaian
// Stok, Tarik/Non-Aktifkan Toko, maupun Update Stok Awal di TabToko.jsx)
// menghitung ulang stok akhir dengan rumus yang SAMA PERSIS — mencegah
// nilai yang diset satu fitur "hilang" tertimpa diam-diam oleh fitur lain.
// extraKontrolList / extraPenyesuaianList: dipakai saat dipanggil tepat
// setelah addRecord, karena `db` di closure pemanggil belum memuat data terbaru.
// forceIfEmpty: kalau true, TETAP reset stok ke 0 walau tidak ada kontrol
// maupun penyesuaian tersisa untuk toko ini — dipakai KHUSUS oleh alur
// PENGHAPUSAN kontrol/penyesuaian (bukan pembuatan toko baru). Beda dengan
// kasus toko baru (memang belum pernah punya riwayat sama sekali, jadi
// stok manual awalnya harus dibiarkan apa adanya), di sini toko SUDAH
// pernah punya kontrol/penyesuaian sebelumnya (makanya recalc ini
// dipanggil) — begitu satu-satunya entri itu dihapus, guard "belum ada
// riwayat" di bawah akan salah mengira ini toko baru dan MEMBIARKAN stok
// lama (dari entri yang baru saja dihapus) tetap nyangkut alih-alih
// direset — parameter ini mencegah itu.
export function recalcTokoStok(db, produkAktif, tokoId, updateRecord, extraKontrolList, extraPenyesuaianList, forceIfEmpty) {
  const semuaKontrol = extraKontrolList || (db.kontrol||[]);
  const semuaPenyesuaian = extraPenyesuaianList || (db.penyesuaian||[]);
  const entriesToko = semuaKontrol
    .filter(k => k.tokoId === tokoId && k.status !== "menunggu" && k.status !== "ditolak")
    .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
  const terakhir = entriesToko[entriesToko.length-1];

  const baseline = {};
  (produkAktif||[]).forEach(p => { baseline[p.id] = terakhir ? Number(terakhir[`stok_${p.id}`]||0) : 0; });

  const batasTanggal = terakhir?.tanggal || "0000-00-00";
  const penyesuaianRelevan = semuaPenyesuaian
    .filter(pz => pz.tokoId === tokoId && (pz.tanggal||"") >= batasTanggal
      && pz.status !== "menunggu" && pz.status !== "ditolak")
    .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
  penyesuaianRelevan.forEach(pz => {
    const arah = pz.jenis === "Kurang" || pz.jenis === "Tarik" ? -1 : 1;
    (produkAktif||[]).forEach(p => {
      const jumlah = Number(pz[`jumlah_${p.id}`]||0);
      if (jumlah) baseline[p.id] = (baseline[p.id]||0) + arah*jumlah;
    });
  });

  // belum ada kontrol maupun penyesuaian → biarkan stok toko (input manual
  // awal) apa adanya, KECUALI forceIfEmpty=true (lihat komentar di atas).
  if (!terakhir && penyesuaianRelevan.length === 0 && !forceIfEmpty) return;

  const updates = {};
  (produkAktif||[]).forEach(p => { updates[`stok_${p.id}`] = Math.max(0, baseline[p.id]||0); });
  updateRecord("toko", tokoId, updates);
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
// Hitung agregat (pcs terjual / revenue / bonus) dari satu tahun data
// kontrol MENTAH (map id→record, format Firebase langsung — field
// `terjual_{produkId}`, `bonusInput_{produkId}`, dst — BUKAN hasil enrich
// dari useAnalytics). Dipakai di 2 tempat yang butuh hasil identik:
//  1) archiveKontrolYear (useDB.js) — snapshot SEBELUM data dihapus dari RTDB.
//  2) recalcArchivedYearAgregat (useDB.js) — hitung ulang dari file arsip
//     Drive untuk tahun-tahun lama yang diarsipkan sebelum fitur ini ada.
// totalTerjualTahun (pcs) TIDAK bergantung harga produk, jadi akurat selalu.
// totalRevTahun bergantung `produkArr.harga` SAAT fungsi ini dipanggil —
// untuk arsip lama yang dihitung ulang belakangan, ini cuma estimasi
// (pakai harga sekarang, bukan harga historis saat tahun itu berjalan).
export function hitungAgregatTahunKontrol(yearDataMap, produkArr) {
  const records = mapToArr(yearDataMap || {});
  let totalTerjualTahun = 0, totalRevTahun = 0, totalBonusTahun = 0;
  records.forEach(k => {
    (produkArr || []).forEach(p => {
      const terjual = Number(k[`terjual_${p.id}`]) || 0;
      const bonusPcs = k[`bonusInput_${p.id}`] !== undefined ? Number(k[`bonusInput_${p.id}`]) : (Number(p.bonus) || 0);
      totalTerjualTahun += terjual;
      totalRevTahun += terjual * (Number(p.harga) || 0);
      totalBonusTahun += bonusPcs;
    });
  });
  return { totalTerjualTahun, totalRevTahun, totalBonusTahun, recordCount: records.length };
}

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
