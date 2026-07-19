import { useMemo } from "react";
import { naturalCompare } from "../lib/format";

export function useAnalytics(db) {
  return useMemo(() => {
    const harga = {};
    (db.produk||[]).forEach(p => { harga[p.id] = p.harga; });

    const enrichKontrol = (db.kontrol||[]).map(k => {
      let totalRev = 0;
      let totalTerjual = 0;
      let totalStok = 0;
      let totalBonus = 0;
      (db.produk||[]).forEach(p => {
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
      });
      let status = "⚪ Kosong";
      if (totalStok > 0) {
        if (totalTerjual === totalStok) status = "✅ Habis";
        else if (totalTerjual === 0) status = "🔴 Belum Laku";
        else status = "🟢 Laku Sebagian";
      }
      const toko = (db.toko||[]).find(t => t.id === k.tokoId);
      const rute = toko ? (db.rute||[]).find(r => r.id === toko.ruteId) : null;
      const wilayah = rute ? (db.wilayah||[]).find(w => w.id === rute.wilayahId) : null;
      return { ...k, totalRev, totalTerjual, totalStok, totalBonus, status, toko, rute, wilayah,
        tokoNama: toko?.nama||"?", ruteNama: rute?.nama||"?", wilayahNama: wilayah?.nama||"?",
        ruteId: rute?.id||"", wilayahId: wilayah?.id||"" };
    });

    // ✅ Penjualan Luar Rute: transaksi produk di luar kunjungan rute normal
    // (rute lain saat itu, atau penjualan perorangan) di mana sales tidak
    // tahu/lupa nama toko & rutenya. Tidak terikat ke toko manapun, tapi
    // tetap dihitung sebagai pendapatan & laba perusahaan.
    const enrichLuarRute = (db.penjualanLuar||[]).map(pl => {
      let totalRev = 0, totalTerjual = 0, totalBonus = 0;
      (db.produk||[]).forEach(p => {
        const terjual = pl[`terjual_${p.id}`] || 0;
        totalRev += terjual * (p.harga || 0);
        totalTerjual += terjual;
        totalBonus += Number(pl[`bonusInput_${p.id}`]||0);
      });
      // ✅ wilayahNama: supaya penjualan luar rute bisa dikaitkan & ditampilkan
      // per wilayah (mis. di Rekap Siklus), bukan cuma catatan yang mengambang.
      // ✅ ruteNama: opsional — jika sales mengisi rute saat mencatat penjualan
      // luar rute, penjualan ini juga bisa dikaitkan & ditampilkan per rute
      // (Revenue per Rute), bukan cuma ikut total wilayah saja.
      const wilayah = (db.wilayah||[]).find(w => w.id === pl.wilayahId);
      const rute = (db.rute||[]).find(r => r.id === pl.ruteId);
      return { ...pl, totalRev, totalTerjual, totalBonus, wilayahNama: wilayah?.nama||"", ruteNama: rute?.nama||"" };
    });
    const totalRevLuarRute = enrichLuarRute.reduce((s,k) => s + k.totalRev, 0);

    const totalRev = enrichKontrol.reduce((s,k) => s + k.totalRev, 0) + totalRevLuarRute;
    const tokoAktif = (db.toko||[]).filter(t => t.status==="Aktif").length;
    // ✅ FIX SINKRONISASI: marginPct sebelumnya hardcoded 70% di sini,
    // terpisah dari konfigurasi yang bisa diedit user di Tab Bagi Hasil
    // (db.bagiHasilConfig.marginLaba). Sekarang keduanya membaca sumber
    // yang sama, supaya "Laba Bersih Estimasi" di Dashboard & Tab Rekap
    // selalu konsisten dengan margin % yang di-set user di Tab Bagi Hasil.
    const marginPctGlobal = Number(db.bagiHasilConfig?.marginLaba) || 70;
    const labaBersih = totalRev * (marginPctGlobal/100);

    const perWilayah = (db.wilayah||[]).map(w => {
      const rows = enrichKontrol.filter(k => k.wilayah?.id === w.id);
      // ✅ Penjualan luar rute yang wilayahnya cocok ikut dijumlahkan, supaya
      // total per wilayah konsisten dengan totalRev keseluruhan (yang sudah
      // memasukkan totalRevLuarRute).
      const luarRows = enrichLuarRute.filter(pl => pl.wilayahId === w.id);
      return {
        ...w,
        rev: rows.reduce((s,k) => s + k.totalRev, 0) + luarRows.reduce((s,k) => s + k.totalRev, 0),
        terjual: rows.reduce((s,k) => s + k.totalTerjual, 0) + luarRows.reduce((s,k) => s + k.totalTerjual, 0),
        tokoCount: (db.toko||[]).filter(t => {
          const rute = (db.rute||[]).find(r => r.id === t.ruteId);
          return rute?.wilayahId === w.id;
        }).length,
      };
    });

    const perRute = (db.rute||[]).map(r => {
      const wil = (db.wilayah||[]).find(w => w.id === r.wilayahId);
      const rows = enrichKontrol.filter(k => k.rute?.id === r.id);
      // ✅ Penjualan luar rute yang sudah dikaitkan ke rute ini (ruteId diisi
      // sales saat mencatat) ikut masuk ke revenue & pcs terjual rute
      // tersebut — sebelumnya penjualan luar rute tidak pernah tampil di
      // breakdown per rute sama sekali, hanya nyangkut di level wilayah.
      const luarRows = enrichLuarRute.filter(pl => pl.ruteId === r.id);
      return {
        ...r, wilayahNama: wil?.nama||"-",
        rev: rows.reduce((s,k) => s + k.totalRev, 0) + luarRows.reduce((s,k) => s + k.totalRev, 0),
        terjual: rows.reduce((s,k) => s + k.totalTerjual, 0) + luarRows.reduce((s,k) => s + k.totalTerjual, 0),
        luarRuteCount: luarRows.length,
        tokoCount: (db.toko||[]).filter(t => t.ruteId === r.id).length,
      };
    })
      // Urutkan sama seperti Master Rute: per Wilayah (abjad) dulu, lalu
      // Nama Rute dengan natural sort — supaya daftar "Rute Aktif" di
      // Dashboard tidak tampil acak sesuai urutan input data.
      .sort((a,b) => {
        const wCompare = (a.wilayahNama||"").localeCompare(b.wilayahNama||"", "id", { sensitivity:"base" });
        if (wCompare !== 0) return wCompare;
        return naturalCompare(a.nama||"", b.nama||"");
      });

    const produkStats = (db.produk||[]).map(p => ({
      ...p,
      terjual: enrichKontrol.reduce((s,k) => s + (k[`terjual_${p.id}`]||0), 0)
        + enrichLuarRute.reduce((s,k) => s + (k[`terjual_${p.id}`]||0), 0),
      rev: enrichKontrol.reduce((s,k) => s + (k[`terjual_${p.id}`]||0) * p.harga, 0)
        + enrichLuarRute.reduce((s,k) => s + (k[`terjual_${p.id}`]||0) * p.harga, 0),
    }));

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
      totalRev, labaBersih, marginPctGlobal, tokoAktif, perWilayah, perRute, produkStats, bagiHasil };
  }, [db]);
}

// ─────────────────────────────────────────────
//  EXPORT UTILITIES
// ─────────────────────────────────────────────
