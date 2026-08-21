import { useMemo } from "react";
import { naturalCompare } from "../lib/format";
import { hitungHppPeriode, periodeBounds, hitungJumlahBulanPeriode, hitungAmortisasiPeriode, migrasiBebanUsahaLama, hitungDanaCadanganPeriode } from "../lib/neracaHelpers";

// ─────────────────────────────────────────────────────────────────────────
// ⚡ OPTIMISASI PERFORMA (setelah laporan "input kontrol masih terasa stuck"
// walau internet sudah bagus): versi sebelumnya memakai `.find()` DI DALAM
// `.map()` untuk mencari toko/rute/wilayah tiap baris kontrol — artinya
// SETIAP kontrol men-scan ulang SELURUH tabel toko/rute/wilayah dari awal.
// Ini kompleksitas O(kontrol × toko), bukan O(kontrol). Untuk toko/rute
// yang jumlahnya ratusan dan kontrol yang terus menumpuk (tidak pernah
// berkurang, bertambah tiap hari), ini jadi jutaan perbandingan setiap kali
// recompute jalan — kerja CPU murni di HP, TIDAK ADA hubungannya dengan
// kecepatan internet, dan makin lambat seiring data historis menumpuk.
// Pola yang sama (nested find/filter) juga terjadi di perWilayah, perRute,
// dan produkStats.
//
// Fix: bangun Map id→record SEKALI di awal (O(1) lookup), dan hitung
// agregat per-wilayah/per-rute/per-produk dengan SATU KALI scan atas
// kontrol (bukan scan kontrol berulang per wilayah/rute/produk). Total
// kompleksitas turun dari O(n×m) jadi O(n+m).
// ─────────────────────────────────────────────────────────────────────────
export function useAnalytics(db) {
  return useMemo(() => {
    const produkArr = db.produk||[];
    const tokoArr = db.toko||[];
    const ruteArr = db.rute||[];
    const wilayahArr = db.wilayah||[];
    // ✅ FIX BUG (persiapan pemakaian oleh Sales): sebelumnya kontrolArr di
    // sini memakai db.kontrol APA ADANYA, termasuk entri berstatus
    // "menunggu" (belum ditinjau Admin/Manajer, bisa masih 24 jam
    // menggantung) dan "ditolak" (sudah eksplisit ditolak). Padahal sejak
    // fitur alur persetujuan Sales dibuat (lihat CHANGES-persetujuan-
    // sales.md), recalcTokoStok() SUDAH mengabaikan kedua status ini saat
    // menghitung stok Master Toko — tapi pengecualian yang sama lupa
    // diterapkan di sini, sumber data untuk Dashboard (Total Revenue/Laba
    // Bersih), SEMUA mode Tab Rekap (Harian/Bulanan/Kuartal/Tahunan/Siklus/
    // Perputaran Stok/Ranking Toko), dan Tab Bagi Hasil (revPeriode — dasar
    // hitung Pendapatan/HPP/Dana Cadangan/alokasi ke tiap pihak). Akibatnya
    // penjualan yang BELUM disetujui atau SUDAH ditolak tetap ikut
    // menggelembungkan semua angka itu. Entri lama (dari sebelum fitur
    // status ini ada) tidak punya field `status` sama sekali — tetap
    // dihitung seperti biasa lewat pengecualian eksplisit di bawah, BUKAN
    // whitelist "status === disetujui" (yang akan salah membuang data lama).
    const kontrolArr = (db.kontrol||[]).filter(k => k.status !== "menunggu" && k.status !== "ditolak");
    const luarArr = db.penjualanLuar||[];

    const harga = {};
    produkArr.forEach(p => { harga[p.id] = p.harga; });

    // Map id→record, dibangun sekali (bukan .find() berulang per baris kontrol)
    const tokoById = new Map(tokoArr.map(t => [t.id, t]));
    const ruteById = new Map(ruteArr.map(r => [r.id, r]));
    const wilayahById = new Map(wilayahArr.map(w => [w.id, w]));

    // Akumulator per-wilayah/per-rute/per-produk, diisi SAMBIL scan kontrol
    // 1x (bukan enrichKontrol.filter(...) yang diulang per wilayah/rute).
    const wilayahAgg = new Map(); // id -> { rev, terjual }
    const ruteAgg = new Map();    // id -> { rev, terjual, luarRuteCount }
    const produkAgg = new Map();  // id -> { terjual, rev }
    produkArr.forEach(p => produkAgg.set(p.id, { terjual: 0, rev: 0 }));
    const bump = (map, id, revD, terjualD) => {
      if (!id) return;
      const cur = map.get(id) || { rev: 0, terjual: 0, luarRuteCount: 0 };
      cur.rev += revD; cur.terjual += terjualD;
      map.set(id, cur);
    };

    const enrichKontrol = kontrolArr.map(k => {
      let totalRev = 0, totalTerjual = 0, totalStok = 0, totalBonus = 0;
      produkArr.forEach(p => {
        const terjual = k[`terjual_${p.id}`] || 0;
        const stok = k[`stok_${p.id}`] || 0;
        // ⚠️ FIX BUG: dulu totalBonus tidak pernah dihitung di sini, jadi
        // Dashboard & tab Rekap (yang sumbernya analytics.kontrol ini)
        // menampilkan angka 0/stale, beda dengan tab Kontrol yang punya
        // perhitungan bonus sendiri (bonusInput_ jika diisi, kalau tidak
        // pakai default bonus produk). Disamakan rumusnya di sini.
        const bonusPcs = k[`bonusInput_${p.id}`] !== undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0);
        totalRev += terjual * (p.harga || 0);
        totalTerjual += terjual;
        totalStok += stok;
        totalBonus += bonusPcs;
        // Akumulasi produkStats sambil jalan (1x scan kontrol total, bukan per-produk)
        const pAgg = produkAgg.get(p.id);
        if (pAgg) { pAgg.terjual += terjual; pAgg.rev += terjual * (p.harga||0); }
      });
      let status = "Kosong";
      if (totalStok > 0) {
        if (totalTerjual === totalStok) status = "Habis";
        else if (totalTerjual === 0) status = "Belum Laku";
        else status = "Laku Sebagian";
      }
      const toko = tokoById.get(k.tokoId) || null;
      const rute = toko ? (ruteById.get(toko.ruteId) || null) : null;
      const wilayah = rute ? (wilayahById.get(rute.wilayahId) || null) : null;
      if (wilayah) bump(wilayahAgg, wilayah.id, totalRev, totalTerjual);
      if (rute) bump(ruteAgg, rute.id, totalRev, totalTerjual);
      return { ...k, totalRev, totalTerjual, totalStok, totalBonus, status, toko, rute, wilayah,
        tokoNama: toko?.nama||"?", ruteNama: rute?.nama||"?", wilayahNama: wilayah?.nama||"?",
        ruteId: rute?.id||"", wilayahId: wilayah?.id||"" };
    });

    // ✅ Penjualan Luar Rute: transaksi produk di luar kunjungan rute normal
    // (rute lain saat itu, atau penjualan perorangan) di mana sales tidak
    // tahu/lupa nama toko & rutenya. Tidak terikat ke toko manapun, tapi
    // tetap dihitung sebagai pendapatan & laba perusahaan.
    const enrichLuarRute = luarArr.map(pl => {
      let totalRev = 0, totalTerjual = 0, totalBonus = 0;
      produkArr.forEach(p => {
        const terjual = pl[`terjual_${p.id}`] || 0;
        totalRev += terjual * (p.harga || 0);
        totalTerjual += terjual;
        totalBonus += Number(pl[`bonusInput_${p.id}`]||0);
        const pAgg = produkAgg.get(p.id);
        if (pAgg) { pAgg.terjual += terjual; pAgg.rev += terjual * (p.harga||0); }
      });
      // ✅ wilayahNama: supaya penjualan luar rute bisa dikaitkan & ditampilkan
      // per wilayah (mis. di Rekap Siklus), bukan cuma catatan yang mengambang.
      // ✅ ruteNama: opsional — jika sales mengisi rute saat mencatat penjualan
      // luar rute, penjualan ini juga bisa dikaitkan & ditampilkan per rute
      // (Revenue per Rute), bukan cuma ikut total wilayah saja.
      const wilayah = wilayahById.get(pl.wilayahId) || null;
      const rute = ruteById.get(pl.ruteId) || null;
      if (pl.wilayahId) bump(wilayahAgg, pl.wilayahId, totalRev, totalTerjual);
      if (pl.ruteId) {
        const cur = ruteAgg.get(pl.ruteId) || { rev: 0, terjual: 0, luarRuteCount: 0 };
        cur.luarRuteCount += 1;
        ruteAgg.set(pl.ruteId, cur);
        bump(ruteAgg, pl.ruteId, totalRev, totalTerjual);
      }
      return { ...pl, totalRev, totalTerjual, totalBonus, wilayahNama: wilayah?.nama||"", ruteNama: rute?.nama||"" };
    });
    const totalRevLuarRute = enrichLuarRute.reduce((s,k) => s + k.totalRev, 0);

    const totalRev = enrichKontrol.reduce((s,k) => s + k.totalRev, 0) + totalRevLuarRute;
    const tokoAktif = tokoArr.filter(t => t.status==="Aktif").length;
    // ✅ FIX SINKRONISASI: marginPct sebelumnya hardcoded 70% di sini,
    // terpisah dari konfigurasi yang bisa diedit user di Tab Bagi Hasil
    // (db.bagiHasilConfig.marginLaba). Sekarang keduanya membaca sumber
    // yang sama, supaya "Laba Bersih Estimasi" di Dashboard & Tab Rekap
    // selalu konsisten dengan margin % yang di-set user di Tab Bagi Hasil.
    const marginPctGlobal = Number(db.bagiHasilConfig?.marginLaba) || 70;
    // ✅ FIX "Laba Bersih Est. masih pakai margin, padahal konfigurasi di Tab
    // Bagi Hasil pakai HPP": labaBersih di sini SELALU dihitung pakai rumus
    // margin%, tidak peduli metodeHpp yang dipilih user di Tab Bagi Hasil
    // (db.bagiHasilConfig.metodeHpp: "manual" pakai margin% | "otomatis"
    // pakai HPP produk riil). metodeHppGlobal juga belum pernah di-return
    // dari hook ini, padahal Dashboard.jsx sudah mencoba membacanya —
    // akibatnya kondisi di Dashboard selalu jatuh ke cabang margin. Sekarang
    // ikuti metodeHpp yang sama seperti Tab Bagi Hasil, pakai helper
    // hitungHppPeriode yang sama juga (Laba Kotor Riil = pendapatan - HPP).
    const metodeHppGlobal = db.bagiHasilConfig?.metodeHpp === "otomatis" ? "otomatis" : "manual";

    // ✅ FIX PARITAS RUMUS (audit lanjutan): setelah fix di atas, labaBersih
    // di Dashboard/Rekap SUDAH ikut metodeHpp yang benar, tapi rumusnya
    // sendiri MASIH beda dari Tab Bagi Hasil (yang jadi acuan pembagian uang
    // ke tiap pihak) — di sini cuma "Pendapatan (- HPP) × sisanya", tanpa
    // pernah mengurangi Beban Usaha, Amortisasi Aset, atau Dana Cadangan
    // sama sekali. Akibatnya "Laba Bersih Estimasi" di Dashboard SELALU
    // lebih besar dari angka riil yang benar-benar dibagi di Tab Bagi Hasil.
    //
    // Sekarang dipakai rumus yang SAMA PERSIS seperti `akuntansi` di
    // TabBagiHasil.jsx, di-scope YTD (Year-To-Date, 1 Jan tahun berjalan s/d
    // hari ini) — bukan periode custom seperti di Tab Bagi Hasil, karena
    // totalRev di sini memang scope-nya "akumulasi tahun berjalan" (lihat
    // KONTROL_LIVE_YEARS di useDB.js: hanya tahun ini yang live-sync
    // default). Beban Usaha bulanan & Amortisasi di-scale sesuai jumlah
    // bulan yang sudah lewat tahun ini (jumlahBulanYtd), persis logika
    // proration yang sama dipakai TabBagiHasil untuk mode "Tahunan".
    // Catatan: kalau admin secara manual memuat tahun-tahun lain juga (lihat
    // menu Backup & Restore → Muat Tahun Lain), kontrolArr bisa memuat lebih
    // dari 1 tahun sekaligus — asumsi "YTD tahun berjalan" di sini jadi
    // kurang presisi untuk kasus itu (edge case, bukan penggunaan default).
    const todayYmd = new Date().toISOString().slice(0,10);
    const boundsYtd = periodeBounds("tahunan", null, String(new Date().getFullYear()), null, todayYmd);
    boundsYtd.end = todayYmd; // potong di hari ini, bukan 31 Des (belum lewat)
    const jumlahBulanYtd = hitungJumlahBulanPeriode(boundsYtd);
    const bebanUsahaListGlobal = Array.isArray(db.bagiHasilConfig?.bebanUsaha)
      ? db.bagiHasilConfig.bebanUsaha : migrasiBebanUsahaLama(db.bagiHasilConfig);
    const bebanUsahaTotalYtd = bebanUsahaListGlobal.reduce((s,b) => {
      const frekuensi = b.frekuensi === "sekali" ? "sekali" : "bulanan";
      const multiplier = frekuensi === "sekali" ? 1 : jumlahBulanYtd;
      return s + (Number(b.nominal)||0) * multiplier;
    }, 0);
    const biayaAmortisasiYtd = hitungAmortisasiPeriode(db.asetAmortisasi||[], boundsYtd).total;
    const totalBiayaYtd = bebanUsahaTotalYtd + biayaAmortisasiYtd;

    let labaKotorGlobal, labaSebelumCadanganGlobal;
    if (metodeHppGlobal === "otomatis") {
      labaKotorGlobal = totalRev - hitungHppPeriode({ rows: enrichKontrol, luarRows: enrichLuarRute }, produkArr).totalHpp;
      labaSebelumCadanganGlobal = Math.max(labaKotorGlobal - totalBiayaYtd, 0);
    } else {
      labaKotorGlobal = totalRev - totalBiayaYtd;
      labaSebelumCadanganGlobal = Math.max(labaKotorGlobal * (marginPctGlobal/100), 0);
    }
    const terjualTotalYtd = enrichKontrol.reduce((s,k) => s+k.totalTerjual, 0) + enrichLuarRute.reduce((s,k)=>s+k.totalTerjual, 0);
    const danaCadanganYtd = hitungDanaCadanganPeriode(terjualTotalYtd, db.bagiHasilConfig?.danaCadangan);
    const labaBersih = Math.max(labaSebelumCadanganGlobal - danaCadanganYtd, 0);

    // Jumlah toko per rute & per wilayah — dihitung 1x scan toko (bukan
    // filter toko berulang per wilayah seperti sebelumnya).
    const tokoCountByRute = new Map();
    tokoArr.forEach(t => { if (t.ruteId) tokoCountByRute.set(t.ruteId, (tokoCountByRute.get(t.ruteId)||0)+1); });
    const tokoCountByWilayah = new Map();
    ruteArr.forEach(r => {
      const n = tokoCountByRute.get(r.id) || 0;
      if (n && r.wilayahId) tokoCountByWilayah.set(r.wilayahId, (tokoCountByWilayah.get(r.wilayahId)||0)+n);
    });

    const perWilayah = wilayahArr.map(w => {
      const agg = wilayahAgg.get(w.id) || { rev:0, terjual:0 };
      return { ...w, rev: agg.rev, terjual: agg.terjual, tokoCount: tokoCountByWilayah.get(w.id) || 0 };
    });

    const perRute = ruteArr.map(r => {
      const wil = wilayahById.get(r.wilayahId) || null;
      const agg = ruteAgg.get(r.id) || { rev:0, terjual:0, luarRuteCount:0 };
      return { ...r, wilayahNama: wil?.nama||"-", rev: agg.rev, terjual: agg.terjual,
        luarRuteCount: agg.luarRuteCount, tokoCount: tokoCountByRute.get(r.id) || 0 };
    })
      // Urutkan sama seperti Master Rute: per Wilayah (abjad) dulu, lalu
      // Nama Rute dengan natural sort — supaya daftar "Rute Aktif" di
      // Dashboard tidak tampil acak sesuai urutan input data.
      .sort((a,b) => {
        const wCompare = (a.wilayahNama||"").localeCompare(b.wilayahNama||"", "id", { sensitivity:"base" });
        if (wCompare !== 0) return wCompare;
        return naturalCompare(a.nama||"", b.nama||"");
      });

    const produkStats = produkArr.map(p => {
      const agg = produkAgg.get(p.id) || { terjual:0, rev:0 };
      return { ...p, terjual: agg.terjual, rev: agg.rev };
    });

    // ✅ FIX SINKRONISASI: daftar pihak & persentase sebelumnya hardcoded
    // (60/20/10/10) di sini, terpisah dari daftar pihak yang bisa
    // ditambah/diubah user di Tab Bagi Hasil (db.bagiHasilConfig.pihak).
    // Kalau user mengedit pihak/persentase di sana, kartu "Simulasi Bagi
    // Hasil" di Dashboard sebelumnya tetap menampilkan susunan lama.
    // Sekarang keduanya membaca daftar pihak yang sama.
    const pihakConfig = db.bagiHasilConfig?.pihak || [
      { nama:"Pemilik Utama", pct:60, basis:"laba" },
      { nama:"Investor A",    pct:20, basis:"revenue" },
      { nama:"Manajer Ops",   pct:10, basis:"laba" },
      { nama:"Karyawan Pool", pct:10, basis:"laba" },
    ];
    const bagiHasil = pihakConfig.map(p => {
      const basisNilai = p.basis === "laba" ? labaBersih : totalRev;
      return {
        nama: p.nama,
        pct: (Number(p.pct)||0)/100,
        tipe: p.basis === "laba" ? "Laba" : "Pendapatan",
        nominal: basisNilai * ((Number(p.pct)||0)/100),
      };
    });

    return { kontrol: enrichKontrol, penjualanLuar: enrichLuarRute, totalRevLuarRute,
      totalRev, labaBersih, marginPctGlobal, metodeHppGlobal, tokoAktif, perWilayah, perRute, produkStats, bagiHasil };
  }, [db]);
}

// ─────────────────────────────────────────────
//  EXPORT UTILITIES
// ─────────────────────────────────────────────
