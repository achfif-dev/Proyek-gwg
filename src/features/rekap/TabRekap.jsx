import React, { useEffect, useMemo, useState } from "react";
import { Badge, Btn, Card, ExportMenu, StatCard, Table } from "../../components/ui";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { TabKontrol } from "../../features/kontrol/TabKontrol";
import { autoUpgradeBaruToAktif } from "../../features/toko/TabToko";
import { fmt, fmtRp, naturalCompare } from "../../lib/format";
import { CATATAN_STATUS, T } from "../../theme/tokens";

export function TabRekap({ db, analytics, salesWilayahId }) {
  const isSalesRestricted = !!salesWilayahId;
  const [mode, setMode] = useState("bulanan"); // harian | bulanan | kuartal | tahunan
  const [filterWilayah, setFilterWilayah] = useState(salesWilayahId||""); // "" = semua
  const [filterBulan, setFilterBulan] = useState(() => new Date().toISOString().slice(0,7));
  const [filterTahun, setFilterTahun] = useState(() => String(new Date().getFullYear()));
  const [filterKuartal, setFilterKuartal] = useState("1"); // "1"|"2"|"3"|"4"
  const [filterTanggal, setFilterTanggal] = useState(() => new Date().toISOString().slice(0,10));
  const [filterRute, setFilterRute] = useState(""); // untuk harian
  const [rankingScope, setRankingScope] = useState("semua"); // 3bulan | 6bulan | tahunIni | semua
  const [rankingSortBy, setRankingSortBy] = useState("terjual"); // terjual | revenue

  // ─── Rekap Siklus per Wilayah ───
  // Untuk kasus kontrol yang mulai pertengahan bulan & berakhir awal bulan
  // berikutnya (tidak pas batas kalender), supaya progres 1 wilayah tetap
  // bisa dipantau utuh dari rute pertama sampai rute terakhir dalam 1
  // putaran, bukan terpotong batas bulan.
  const [filterSiklusWilayahs, setFilterSiklusWilayahs] = useState(salesWilayahId?[salesWilayahId]:[]);
  const [filterSiklusStart, setFilterSiklusStart] = useState("");
  const [filterSiklusEnd, setFilterSiklusEnd] = useState("");

  // ─── Perputaran Stok (Terjual ÷ Stok Beredar saat ini) ───
  // Pakai ulang filterBulan/filterKuartal/filterTahun yang sama dengan mode
  // Bulanan/Kuartal/Tahunan — tinggal pilih tipe periodenya di sini.
  const [perputaranPeriodeType, setPerputaranPeriodeType] = useState("bulanan"); // bulanan|kuartal|tahunan

  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);
  const wilayahOpts = (db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }));
  const ruteOpts = useMemo(() => {
    const rutes = filterWilayah
      ? (db.rute||[]).filter(r=>r.wilayahId===filterWilayah)
      : (db.rute||[]);
    // Urutkan alami (BKLU1, BKLU2, ..., BKLU14 — bukan urutan input asli
    // atau abjad teks biasa yang salah taruh BKLU10 sebelum BKLU2).
    return [...rutes].sort((a,b)=>naturalCompare(a.nama, b.nama)).map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, filterWilayah]);

  const tahunList = useMemo(() => {
    const years = new Set();
    (db.kontrol||[]).forEach(k => { if(k.tanggal) years.add(k.tanggal.slice(0,4)); });
    const cur = String(new Date().getFullYear());
    years.add(cur);
    return [...years].sort().reverse().map(y=>({ value:y, label:y }));
  }, [db.kontrol]);

  // Enrich kontrol dengan info wilayah/rute
  const enrichKontrol = useMemo(() => analytics.kontrol, [analytics.kontrol]);

  // Deteksi otomatis rentang siklus TERAKHIR untuk wilayah terpilih: mundur
  // dari tanggal kontrol paling baru, selama jeda antar tanggal kontrol
  // berurutan tidak lebih dari 10 hari (dianggap masih 1 putaran/siklus
  // yang sama). Kalau jeda lebih dari itu, dianggap sudah siklus baru.
  const SIKLUS_GAP_DAYS = 10;
  const siklusAutoRange = useMemo(() => {
    if (!filterSiklusWilayahs.length) return null;
    const dates = [...new Set(enrichKontrol.filter(k=>filterSiklusWilayahs.includes(k.wilayahId)).map(k=>k.tanggal))].sort();
    if (!dates.length) return null;
    let end = dates[dates.length-1];
    let start = end;
    for (let i = dates.length-2; i >= 0; i--) {
      const diffDays = (new Date(start) - new Date(dates[i])) / 86400000;
      if (diffDays > SIKLUS_GAP_DAYS) break;
      start = dates[i];
    }
    return { start, end };
  }, [enrichKontrol, filterSiklusWilayahs]);

  // Auto-isi tanggal mulai/selesai begitu wilayah dipilih/diganti — tetap
  // bisa digeser manual sesudahnya lewat input tanggal di filter panel.
  useEffect(() => {
    if (siklusAutoRange) {
      setFilterSiklusStart(siklusAutoRange.start);
      setFilterSiklusEnd(siklusAutoRange.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSiklusWilayahs.join(",")]);

  // (Urutan alami rute BKLU1..BKLU14 dsb sekarang pakai naturalCompare()
  // yang sudah tersedia secara global — konsisten dengan urutan di Master
  // Toko, Master Rute, dan dropdown filter rute lainnya.)

  // ─── HELPER: agregasi produk per entri kontrol ───
  function sumProduk(rows) {
    const res = {};
    produkAktif.forEach(p => {
      res[`stok_${p.id}`] = rows.reduce((s,k)=>s+(k[`stok_${p.id}`]||0), 0);
      res[`terjual_${p.id}`] = rows.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0), 0);
      res[`bonus_${p.id}`] = rows.reduce((s,k)=>s+(k[`bonusInput_${p.id}`]!==undefined?Number(k[`bonusInput_${p.id}`]):(p.bonus||0)),0);
    });
    return res;
  }

  // ✅ HELPER: hitung jumlah toko "Toko Tutup" & "Tidak Terjual" dari status
  // kunjungan (catatanStatus) — dipakai di semua mode rekap supaya setiap
  // hasil ekspor (Excel/PDF/JPG) ikut menampilkan keterangan ini, bukan cuma
  // angka Revenue/Terjual saja.
  function hitungStatusKunjungan(rows) {
    return {
      jumlahTutup: rows.filter(k => k.catatanStatus === "tutup").length,
      jumlahTidakTerjual: rows.filter(k => k.catatanStatus === "terjual").length,
      // ✅ BARU: hitung juga kunjungan yang ditandai "Bermasalah" di form
      // Tambah Kontrol, supaya ikut muncul di ekspor (Excel/PDF/JPG) — bukan
      // cuma Toko Tutup & Tidak Terjual seperti sebelumnya.
      jumlahMasalah: rows.filter(k => k.catatanStatus === "masalah").length,
    };
  }

  // ─── HELPER: gabungkan Penjualan Luar Rute yang sudah dikaitkan ke rute
  //     (ruteId terisi sales saat mencatat) ke dalam grup per-rute (byRute)
  //     yang sedang dibangun — supaya revenue & pcs-nya ikut masuk ke rute
  //     yang sebenarnya, bukan cuma nyangkut di baris generik "🛣️ Penjualan
  //     Luar Rute". Entri tanpa ruteId (rute memang tidak diketahui sales)
  //     dikembalikan sebagai "sisa" supaya tetap dibuatkan baris generik
  //     seperti sebelumnya — jadi tidak ada penjualan yang hilang. ───
  function mergeLuarRuteToByRute(byRute, luarRows, ruteFilterId) {
    const sisa = [];
    luarRows.forEach(pl => {
      if (pl.ruteId) {
        if (ruteFilterId && pl.ruteId !== ruteFilterId) return; // di luar cakupan filter rute yang dipilih
        const key = pl.ruteId;
        if (!byRute[key]) {
          const ruteObj = (db.rute||[]).find(r=>r.id===pl.ruteId);
          byRute[key] = { ruteId: pl.ruteId, ruteNama: ruteObj?.nama || pl.ruteNama || "?", wilayahNama: pl.wilayahNama || "-", rows: [] };
        }
        byRute[key].rows.push(pl);
      } else {
        sisa.push(pl);
      }
    });
    return sisa;
  }

  // ─── HELPER: bikin baris "Penjualan Luar Rute" (dipakai di semua mode
  //     rekap — harian/bulanan/kuartal/tahunan — supaya penjualan yang
  //     tidak terikat rute/wilayah tetap kelihatan rinciannya, bukan cuma
  //     nambah ke Total Revenue secara diam-diam). ───
  function luarRuteRow(luarRows, extra) {
    const sp = sumProduk(luarRows);
    return {
      wilayahId: "LUAR_RUTE", ruteId: "LUAR_RUTE",
      wilayahNama: "🛣️ Penjualan Luar Rute", ruteNama: "🛣️ Penjualan Luar Rute",
      jumlahKunjungan: luarRows.length, jumlahToko: luarRows.length,
      totalRev: luarRows.reduce((s,k)=>s+k.totalRev,0),
      totalBonus: luarRows.reduce((s,k)=>s+(k.totalBonus||0),0),
      jumlahTutup: 0, jumlahTidakTerjual: 0, jumlahMasalah: 0, // penjualan luar rute tidak punya status kunjungan
      ...sp, detail: luarRows, ...extra,
    };
  }

  // ─── HARIAN PER RUTE ───
  const rekapHarian = useMemo(() => {
    const rows = enrichKontrol.filter(k =>
      k.tanggal === filterTanggal &&
      (!filterWilayah || k.wilayahId === filterWilayah) &&
      (!filterRute || k.ruteId === filterRute)
    );
    // Group by rute
    const byRute = {};
    rows.forEach(k => {
      const key = k.ruteId || "NORUTE";
      if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
      byRute[key].rows.push(k);
    });
    // ✅ Gabungkan Penjualan Luar Rute yang sudah dikaitkan ke rute (ruteId
    // terisi) ke grup rute yang sesuai. Sisa (ruteId kosong) ditampung untuk
    // jadi baris generik "🛣️ Penjualan Luar Rute" di bawah.
    const luarRowsAll = (analytics.penjualanLuar||[]).filter(pl =>
      pl.tanggal === filterTanggal && (!filterWilayah || pl.wilayahId === filterWilayah)
    );
    const luarSisa = mergeLuarRuteToByRute(byRute, luarRowsAll, filterRute);
    const hasil = Object.values(byRute).map(g => {
      const sp = sumProduk(g.rows);
      // ✅ Tandai berapa banyak entri Penjualan Luar Rute yang ikut tergabung
      // ke rute ini (jika ada) — luar rute dikenali karena tidak punya tokoId.
      const jumlahLuarRute = g.rows.filter(r=>!r.tokoId).length;
      return {
        ...g,
        ruteNama: jumlahLuarRute>0 ? `${g.ruteNama} 🛣️×${jumlahLuarRute}` : g.ruteNama,
        jumlahToko: g.rows.filter(r=>r.tokoId).length,
        totalRev: g.rows.reduce((s,k)=>s+k.totalRev,0),
        totalBonus: g.rows.reduce((s,k)=>s+(k.totalBonus||0),0),
        ...sp,
        ...hitungStatusKunjungan(g.rows),
        detail: g.rows,
      };
    });
    // Urutkan alami (BKLU1, BKLU2, ..., BKLU14) supaya rapi seperti mode
    // rekap lain — sebelumnya urutannya ikut urutan input data mentah.
    hasil.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));

    // ✅ Ikutkan Penjualan Luar Rute pada tanggal yang sama sebagai kelompok
    // tersendiri, supaya produk yang terjual di luar rute kontrol tetap
    // terlihat rinciannya di rekap harian — sebelumnya catatan ini cuma
    // menambah ke Total Revenue tanpa rincian produk apa yang terjual.
    // Sekarang penjualan luar rute sudah punya wilayahId, jadi ditampilkan
    // kalau cocok dengan filter wilayah (atau kalau tidak sedang memfilter
    // wilayah sama sekali). Yang sudah punya ruteId sendiri sudah digabung
    // ke grup rute masing-masing di atas (lihat mergeLuarRuteToByRute) —
    // di sini cuma sisa yang ruteId-nya kosong.
    // ✅ Sisa Penjualan Luar Rute yang ruteId-nya kosong (rute memang tidak
    // diketahui sales) tetap ditampilkan sebagai kelompok tersendiri, supaya
    // produk yang terjual di luar rute kontrol tetap terlihat rinciannya di
    // rekap harian — bukan cuma menambah ke Total Revenue diam-diam.
    if (!filterRute && luarSisa.length) {
      const sp = sumProduk(luarSisa);
      hasil.push({
        ruteId: "LUAR_RUTE",
        ruteNama: "🛣️ Penjualan Luar Rute",
        wilayahNama: luarSisa[0].wilayahNama ? `🛣️ ${luarSisa[0].wilayahNama}` : "Tidak terikat rute/wilayah",
        jumlahToko: luarSisa.length,
        totalRev: luarSisa.reduce((s,k)=>s+k.totalRev,0),
        totalBonus: luarSisa.reduce((s,k)=>s+(k.totalBonus||0),0),
        jumlahTutup: 0, jumlahTidakTerjual: 0, jumlahMasalah: 0,
        ...sp,
        detail: luarSisa,
      });
    }
    return hasil;
  }, [enrichKontrol, filterTanggal, filterWilayah, filterRute, produkAktif, analytics.penjualanLuar]);

  // ─── SIKLUS PER WILAYAH (rentang bebas, dari rute pertama s/d terakhir) ───
  // ✅ Sekarang bisa MENGGABUNGKAN siklus dari beberapa wilayah sekaligus
  // (filterSiklusWilayahs = array id wilayah, bukan cuma 1). Dikelompokkan
  // tetap per rute seperti biasa — karena tiap baris hasil sudah punya
  // kolom Wilayah sendiri, rute dari wilayah berbeda otomatis kebedakan
  // tanpa perlu grouping tambahan per wilayah.
  const rekapSiklus = useMemo(() => {
    if (!filterSiklusWilayahs.length || !filterSiklusStart || !filterSiklusEnd) return [];
    const rows = enrichKontrol.filter(k =>
      filterSiklusWilayahs.includes(k.wilayahId) &&
      k.tanggal >= filterSiklusStart && k.tanggal <= filterSiklusEnd
    );
    const byRute = {};
    rows.forEach(k => {
      const key = k.ruteId || "NORUTE";
      if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
      byRute[key].rows.push(k);
    });
    // ✅ Ambil semua Penjualan Luar Rute wilayah-wilayah terpilih dalam rentang
    // siklus ini lebih awal, lalu gabungkan yang sudah punya ruteId ke grup
    // rute yang bersangkutan — supaya revenue & pcs-nya ikut masuk ke rute
    // yang sebenarnya, bukan cuma jadi baris generik per wilayah di bawah.
    const luarRowsAll = (analytics.penjualanLuar||[]).filter(pl =>
      filterSiklusWilayahs.includes(pl.wilayahId) &&
      pl.tanggal >= filterSiklusStart && pl.tanggal <= filterSiklusEnd
    );
    const luarSisa = mergeLuarRuteToByRute(byRute, luarRowsAll);
    const hasil = Object.values(byRute).map(g => {
      const sp = sumProduk(g.rows);
      const jumlahLuarRute = g.rows.filter(r=>!r.tokoId).length;
      return {
        ...g,
        ruteNama: jumlahLuarRute>0 ? `${g.ruteNama} 🛣️×${jumlahLuarRute}` : g.ruteNama,
        jumlahToko: g.rows.filter(r=>r.tokoId).length,
        totalRev: g.rows.reduce((s,k)=>s+k.totalRev,0),
        totalBonus: g.rows.reduce((s,k)=>s+(k.totalBonus||0),0),
        ...sp,
        ...hitungStatusKunjungan(g.rows),
        detail: g.rows,
      };
    });
    // Urutkan per wilayah dulu (kalau gabungan >1 wilayah), baru per rute,
    // supaya rute-rute 1 wilayah tetap mengelompok rapi, bukan tercampur.
    hasil.sort((a,b)=>naturalCompare(a.wilayahNama, b.wilayahNama) || naturalCompare(a.ruteNama, b.ruteNama));

    // ✅ Sisa Penjualan Luar Rute yang ruteId-nya kosong (rute tidak
    // diketahui sales) tetap ditampilkan sebagai baris generik per wilayah —
    // sales tetap bertanggung jawab atas semua penjualan (sesuai rute maupun
    // di luar rute) begitu siklus wilayahnya selesai. Kalau lebih dari 1
    // wilayah digabung, dipisah per wilayah supaya rinciannya tetap jelas
    // asalnya dari wilayah mana.
    if (luarSisa.length) {
      if (filterSiklusWilayahs.length > 1) {
        const byWilLuar = {};
        luarSisa.forEach(pl => {
          const key = pl.wilayahId || "NOWIL";
          if (!byWilLuar[key]) byWilLuar[key] = [];
          byWilLuar[key].push(pl);
        });
        Object.values(byWilLuar).forEach(rowsW => hasil.push(luarRuteRow(rowsW)));
      } else {
        hasil.push(luarRuteRow(luarSisa));
      }
    }

    return hasil;
  }, [enrichKontrol, filterSiklusWilayahs, filterSiklusStart, filterSiklusEnd, produkAktif, analytics.penjualanLuar]);

  // ─── PERPUTARAN STOK (Terjual periode ÷ Stok Beredar saat ini) ───
  const perputaranStok = useMemo(() => {
    // 1) Terjual per rute, sesuai tipe periode yang dipilih (bulanan/kuartal/tahunan)
    let rowsPeriode, luarRowsPeriode;
    if (perputaranPeriodeType === "bulanan") {
      rowsPeriode = enrichKontrol.filter(k => k.tanggal?.startsWith(filterBulan));
      luarRowsPeriode = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(filterBulan));
    } else if (perputaranPeriodeType === "kuartal") {
      const KUARTAL_MONTHS_LOCAL = { "1":["01","02","03"], "2":["04","05","06"], "3":["07","08","09"], "4":["10","11","12"] };
      const months = KUARTAL_MONTHS_LOCAL[filterKuartal] || [];
      rowsPeriode = enrichKontrol.filter(k => {
        if (!k.tanggal) return false;
        const [y,m] = k.tanggal.split("-");
        return y===filterTahun && months.includes(m);
      });
      luarRowsPeriode = (analytics.penjualanLuar||[]).filter(pl => {
        if (!pl.tanggal) return false;
        const [y,m] = pl.tanggal.split("-");
        return y===filterTahun && months.includes(m);
      });
    } else {
      rowsPeriode = enrichKontrol.filter(k => k.tanggal?.startsWith(filterTahun));
      luarRowsPeriode = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(filterTahun));
    }
    const terjualByRute = {};
    rowsPeriode.forEach(k => {
      const key = k.ruteId || "NORUTE";
      if (!terjualByRute[key]) terjualByRute[key] = {};
      produkAktif.forEach(p => {
        terjualByRute[key][p.id] = (terjualByRute[key][p.id]||0) + Number(k[`terjual_${p.id}`]||0);
      });
    });
    // ✅ FIX SINKRONISASI: ikutkan Penjualan Luar Rute yang sudah terkait ke
    // rute (ruteId terisi) — mode Harian/Siklus/Bulanan/Kuartal/Tahunan
    // sudah menggabungkan ini, tapi Perputaran Stok sebelumnya tidak,
    // sehingga angka "Terjual" di sini selalu lebih rendah (under-count)
    // dibanding rekap lain untuk periode yang sama persis.
    (luarRowsPeriode||[]).forEach(pl => {
      if (!pl.ruteId) return; // rute tidak diketahui — tidak bisa dikaitkan ke rute manapun di sini
      if (!terjualByRute[pl.ruteId]) terjualByRute[pl.ruteId] = {};
      produkAktif.forEach(p => {
        terjualByRute[pl.ruteId][p.id] = (terjualByRute[pl.ruteId][p.id]||0) + Number(pl[`terjual_${p.id}`]||0);
      });
    });

    // 2) Stok Beredar per rute — LIVE dari Master Toko saat ini (bukan
    //    historis per periode), karena stok memang selalu "kembali ke
    //    kapasitas etalase" tiap kunjungan kecuali ada penyesuaian —
    //    jadi yang relevan dibandingkan adalah kondisi SEKARANG.
    // ✅ FIX SINKRONISASI: sebelumnya hanya toko status "Aktif" yang dihitung
    // di sini, padahal TabKontrol mengizinkan entri kontrol (jadi ikut
    // menyumbang angka "Terjual" di atas) untuk toko berstatus "Aktif" MAUPUN
    // "Baru" (toko baru otomatis naik status jadi "Aktif" setelah 30 hari —
    // lihat autoUpgradeBaruToAktif). Kalau toko "Baru" sudah tercatat
    // penjualannya tapi stoknya tidak ikut dihitung di penyebut, persentase
    // Perputaran Stok jadi digelembungkan secara tidak akurat (pembilang naik,
    // penyebut tidak). Disamakan cakupan status-nya di sini.
    const stokByRute = {};
    (db.toko||[]).filter(t=>t.status==="Aktif"||t.status==="Baru").forEach(t => {
      const key = t.ruteId || "NORUTE";
      if (!stokByRute[key]) stokByRute[key] = {};
      produkAktif.forEach(p => {
        stokByRute[key][p.id] = (stokByRute[key][p.id]||0) + Number(t[`stok_${p.id}`]||0);
      });
    });

    // 3) Gabungkan jadi baris per rute (dengan info wilayah)
    const ruteRows = (db.rute||[]).map(r => {
      const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
      const stok = stokByRute[r.id] || {};
      const terjual = terjualByRute[r.id] || {};
      return { ruteId:r.id, ruteNama:r.nama, wilayahId:r.wilayahId, wilayahNama:w?.nama||"—", stok, terjual };
    }).filter(r => !isSalesRestricted || r.wilayahId===salesWilayahId)
      .sort((a,b) => a.wilayahNama.localeCompare(b.wilayahNama,"id",{sensitivity:"base"}) || naturalCompare(a.ruteNama,b.ruteNama));

    // ✅ FIX SINKRONISASI: toko/kontrol yang TIDAK punya rute (ruteId kosong —
    // toko belum diset rute-nya, atau rute-nya sudah terlanjur dihapus) masuk
    // ke bucket "NORUTE" di terjualByRute/stokByRute di atas, tapi sebelumnya
    // diam-diam HILANG dari sini karena ruteRows hanya dibangun dari daftar
    // db.rute (rute yang benar-benar masih ada) — Total Perputaran Stok jadi
    // under-count dan tidak sinkron dengan Rekap Harian/Bulanan/Kuartal/
    // Tahunan/Siklus, yang semuanya SUDAH menampilkan entri semacam ini
    // sebagai baris generik "Tanpa Rute"/"Tanpa Wilayah". Disamakan di sini
    // dengan menambahkan baris generik yang sama (khusus non-Sales, karena
    // wilayahnya memang tidak diketahui — tidak relevan untuk tampilan yang
    // sudah di-scope per wilayah Sales).
    if (!isSalesRestricted && (terjualByRute.NORUTE || stokByRute.NORUTE)) {
      ruteRows.push({
        ruteId: "NORUTE", ruteNama: "🛣️ Tanpa Rute",
        wilayahId: "NOWIL", wilayahNama: "— (Tanpa Wilayah)",
        stok: stokByRute.NORUTE || {}, terjual: terjualByRute.NORUTE || {},
      });
    }

    // 4) Agregasi per wilayah
    const wilByMap = {};
    ruteRows.forEach(r => {
      if (!wilByMap[r.wilayahId]) wilByMap[r.wilayahId] = { wilayahId:r.wilayahId, wilayahNama:r.wilayahNama, stok:{}, terjual:{} };
      produkAktif.forEach(p => {
        wilByMap[r.wilayahId].stok[p.id] = (wilByMap[r.wilayahId].stok[p.id]||0) + (r.stok[p.id]||0);
        wilByMap[r.wilayahId].terjual[p.id] = (wilByMap[r.wilayahId].terjual[p.id]||0) + (r.terjual[p.id]||0);
      });
    });
    const wilayahRows = Object.values(wilByMap).sort((a,b)=>a.wilayahNama.localeCompare(b.wilayahNama,"id",{sensitivity:"base"}));

    // 5) Keseluruhan (total perusahaan)
    const total = { stok:{}, terjual:{} };
    wilayahRows.forEach(w => {
      produkAktif.forEach(p => {
        total.stok[p.id] = (total.stok[p.id]||0) + (w.stok[p.id]||0);
        total.terjual[p.id] = (total.terjual[p.id]||0) + (w.terjual[p.id]||0);
      });
    });

    return { ruteRows, wilayahRows, total };
  }, [enrichKontrol, db.toko, db.rute, db.wilayah, produkAktif, perputaranPeriodeType, filterBulan, filterKuartal, filterTahun, isSalesRestricted, salesWilayahId, analytics.penjualanLuar]);

  // ─── BULANAN PER WILAYAH ───
  const rekapBulanan = useMemo(() => {
    const rows = enrichKontrol.filter(k =>
      k.tanggal?.startsWith(filterBulan) &&
      (!filterWilayah || k.wilayahId === filterWilayah)
    );
    if (filterWilayah) {
      // Per rute dalam wilayah
      const byRute = {};
      rows.forEach(k => {
        const key = k.ruteId || "NORUTE";
        if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, rows:[] };
        byRute[key].rows.push(k);
      });
      // ✅ Gabungkan Penjualan Luar Rute wilayah ini di bulan ini yang sudah
      // punya ruteId ke grup rute yang bersangkutan; sisanya (ruteId kosong)
      // tetap jadi baris generik seperti sebelumnya.
      const luarRowsAll = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(filterBulan));
      const luarSisa = mergeLuarRuteToByRute(byRute, luarRowsAll);
      const result = Object.values(byRute).map(g => {
        const sp = sumProduk(g.rows);
        const jumlahLuarRute = g.rows.filter(r=>!r.tokoId).length;
        return { ...g,
          ruteNama: jumlahLuarRute>0 ? `${g.ruteNama} 🛣️×${jumlahLuarRute}` : g.ruteNama,
          jumlahKunjungan:g.rows.filter(r=>r.tokoId).length,
          totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
      });
      result.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
      // ✅ Sisa Penjualan Luar Rute yang ruteId-nya kosong tetap ditampilkan
      // sebagai baris generik — sales tetap bertanggung jawab atas semua
      // penjualan wilayahnya.
      if (luarSisa.length) result.push(luarRuteRow(luarSisa));
      return result;
    } else {
      // Per wilayah
      const byWil = {};
      rows.forEach(k => {
        const key = k.wilayahId || "NOWIL";
        if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, rows:[] };
        byWil[key].rows.push(k);
      });
      const result = Object.values(byWil).map(g => {
        const sp = sumProduk(g.rows);
        return { ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
      });
      const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(filterBulan));
      if (luarRows.length) result.push(luarRuteRow(luarRows));
      return result;
    }
  }, [enrichKontrol, filterBulan, filterWilayah, produkAktif, analytics.penjualanLuar]);

  // ─── KUARTAL ───
  const KUARTAL_MONTHS = { "1":["01","02","03"], "2":["04","05","06"], "3":["07","08","09"], "4":["10","11","12"] };
  const rekapKuartal = useMemo(() => {
    const months = KUARTAL_MONTHS[filterKuartal] || [];
    const rows = enrichKontrol.filter(k => {
      if (!k.tanggal) return false;
      const [y,m] = k.tanggal.split("-");
      return y===filterTahun && months.includes(m) &&
        (!filterWilayah || k.wilayahId === filterWilayah);
    });
    if (filterWilayah) {
      // Per rute per bulan
      const result = [];
      months.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const byRute = {};
        mRows.forEach(k => {
          const key = k.ruteId||"NORUTE";
          if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byRute[key].rows.push(k);
        });
        // ✅ Gabungkan Penjualan Luar Rute wilayah ini di bulan ini yang sudah
        // punya ruteId ke grup rute yang bersangkutan.
        const luarRowsAll = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        const luarSisa = mergeLuarRuteToByRute(byRute, luarRowsAll);
        const bulanRows = Object.values(byRute).map(g => {
          const sp = sumProduk(g.rows);
          const jumlahLuarRute = g.rows.filter(r=>!r.tokoId).length;
          return { ...g,
            ruteNama: jumlahLuarRute>0 ? `${g.ruteNama} 🛣️×${jumlahLuarRute}` : g.ruteNama,
            jumlahKunjungan:g.rows.filter(r=>r.tokoId).length,
            totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
        });
        bulanRows.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
        result.push(...bulanRows);
        // ✅ Sisa luar rute (ruteId kosong) milik wilayah terpilih, bulan ini
        if (luarSisa.length) result.push(luarRuteRow(luarSisa, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    } else {
      // Per wilayah per bulan
      const result = [];
      months.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const byWil = {};
        mRows.forEach(k => {
          const key = k.wilayahId||"NOWIL";
          if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byWil[key].rows.push(k);
        });
        Object.values(byWil).forEach(g => {
          const sp = sumProduk(g.rows);
          result.push({ ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) });
        });
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    }
  }, [enrichKontrol, filterKuartal, filterTahun, filterWilayah, produkAktif, analytics.penjualanLuar]);

  // ─── TAHUNAN ───
  const rekapTahunan = useMemo(() => {
    const rows = enrichKontrol.filter(k => {
      if (!k.tanggal) return false;
      return k.tanggal.startsWith(filterTahun) && (!filterWilayah || k.wilayahId===filterWilayah);
    });
    const ALL_MONTHS = ["01","02","03","04","05","06","07","08","09","10","11","12"];
    if (filterWilayah) {
      const result = [];
      ALL_MONTHS.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.wilayahId===filterWilayah && pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (mRows.length===0 && luarRows.length===0) return;
        const byRute = {};
        mRows.forEach(k => {
          const key = k.ruteId||"NORUTE";
          if (!byRute[key]) byRute[key] = { ruteId:k.ruteId, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byRute[key].rows.push(k);
        });
        const luarSisa = mergeLuarRuteToByRute(byRute, luarRows);
        const bulanRows = Object.values(byRute).map(g => {
          const sp = sumProduk(g.rows);
          const jumlahLuarRute = g.rows.filter(r=>!r.tokoId).length;
          return { ...g,
            ruteNama: jumlahLuarRute>0 ? `${g.ruteNama} 🛣️×${jumlahLuarRute}` : g.ruteNama,
            jumlahKunjungan:g.rows.filter(r=>r.tokoId).length,
            totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) };
        });
        bulanRows.sort((a,b)=>naturalCompare(a.ruteNama, b.ruteNama));
        result.push(...bulanRows);
        // ✅ Sisa luar rute (ruteId kosong) milik wilayah terpilih, bulan ini
        if (luarSisa.length) result.push(luarRuteRow(luarSisa, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    } else {
      const result = [];
      ALL_MONTHS.forEach(m => {
        const mRows = rows.filter(k=>k.tanggal.startsWith(`${filterTahun}-${m}`));
        const luarRows = (analytics.penjualanLuar||[]).filter(pl => pl.tanggal?.startsWith(`${filterTahun}-${m}`));
        if (mRows.length===0 && luarRows.length===0) return;
        const byWil = {};
        mRows.forEach(k => {
          const key = k.wilayahId||"NOWIL";
          if (!byWil[key]) byWil[key] = { wilayahId:k.wilayahId, wilayahNama:k.wilayahNama, bulan:`${filterTahun}-${m}`, rows:[] };
          byWil[key].rows.push(k);
        });
        Object.values(byWil).forEach(g => {
          const sp = sumProduk(g.rows);
          result.push({ ...g, jumlahKunjungan:g.rows.length, totalRev:g.rows.reduce((s,k)=>s+k.totalRev,0), totalBonus:g.rows.reduce((s,k)=>s+(k.totalBonus||0),0), ...sp, ...hitungStatusKunjungan(g.rows) });
        });
        if (luarRows.length) result.push(luarRuteRow(luarRows, { bulan:`${filterTahun}-${m}` }));
      });
      return result;
    }
  }, [enrichKontrol, filterTahun, filterWilayah, produkAktif, analytics.penjualanLuar]);
  // (dependency analytics.penjualanLuar sudah ada di atas — dipertahankan)

  // ─── RANKING TOKO — Terlaris (jumlah produk terjual / revenue) ───
  const rankingByJumlah = useMemo(() => {
    const now = new Date();
    let cutoff = null; // "YYYY-MM" — hanya ikutkan kontrol mulai bulan ini
    if (rankingScope === "3bulan") cutoff = new Date(now.getFullYear(), now.getMonth()-2, 1).toISOString().slice(0,7);
    else if (rankingScope === "6bulan") cutoff = new Date(now.getFullYear(), now.getMonth()-5, 1).toISOString().slice(0,7);
    else if (rankingScope === "tahunIni") cutoff = `${now.getFullYear()}-01`;

    const rows = enrichKontrol.filter(k =>
      (!filterWilayah || k.wilayahId === filterWilayah) &&
      (!cutoff || (k.tanggal||"").slice(0,7) >= cutoff)
    );
    const byToko = {};
    rows.forEach(k => {
      if (!k.tokoId) return;
      if (!byToko[k.tokoId]) byToko[k.tokoId] = {
        tokoId:k.tokoId, tokoNama:k.tokoNama, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama,
        totalTerjual:0, totalRev:0, jumlahKunjungan:0, totalBonus:0,
      };
      byToko[k.tokoId].totalTerjual += k.totalTerjual||0;
      byToko[k.tokoId].totalRev += k.totalRev||0;
      byToko[k.tokoId].jumlahKunjungan += 1;
      // ⚠️ FIX: field totalBonus juga tidak pernah diakumulasi di sini —
      // sama seperti terjual_${p.id} di bawah, akibatnya kartu "Total Bonus"
      // di mode Ranking Toko selalu tampil 0 pcs walau sebetulnya ada bonus.
      byToko[k.tokoId].totalBonus += k.totalBonus||0;
      // ⚠️ FIX: sebelumnya field per-produk (terjual_${p.id}) tidak pernah
      // diisi di sini — hanya totalTerjual gabungan semua produk yang
      // diakumulasi. Akibatnya kartu ringkasan "Jual B35/Roll On/Roll 7500"
      // di mode Ranking Toko selalu tampil 0 pcs, karena kartu itu (generik,
      // dipakai semua mode) mencari field terjual_${p.id} per baris yang
      // memang belum ada di sini. Ditambahkan supaya konsisten dengan mode
      // rekap lain.
      produkAktif.forEach(p => {
        byToko[k.tokoId][`terjual_${p.id}`] = (byToko[k.tokoId][`terjual_${p.id}`]||0) + Number(k[`terjual_${p.id}`]||0);
      });
    });
    const list = Object.values(byToko).filter(r => r.jumlahKunjungan > 0);
    list.sort((a,b) => rankingSortBy === "revenue" ? b.totalRev - a.totalRev : b.totalTerjual - a.totalTerjual);
    return list.map((r,i) => ({ ...r, rank:i+1 }));
  }, [enrichKontrol, filterWilayah, rankingScope, rankingSortBy, produkAktif]);

  // ─── RANKING TOKO — Konsisten terjual N bulan berturut-turut ───
  // Sebuah bulan dihitung "terjual" untuk toko itu kalau totalTerjual > 0
  // pada SALAH SATU entri kontrol di bulan itu. Streak dihitung dari
  // deretan bulan (YYYY-MM) yang berurutan tanpa jeda.
  const KONSISTEN_MIN_BULAN = 3;
  const rankingKonsisten = useMemo(() => {
    const isNextMonth = (a, b) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return (by*12+bm) - (ay*12+am) === 1;
    };
    const byToko = {};
    enrichKontrol.forEach(k => {
      if (!k.tokoId || !k.tanggal) return;
      if (filterWilayah && k.wilayahId !== filterWilayah) return;
      if ((k.totalTerjual||0) <= 0) return; // hanya bulan yang BENAR-BENAR ada penjualan
      const bln = k.tanggal.slice(0,7);
      if (!byToko[k.tokoId]) byToko[k.tokoId] = { tokoId:k.tokoId, tokoNama:k.tokoNama, ruteNama:k.ruteNama, wilayahNama:k.wilayahNama, months: new Set() };
      byToko[k.tokoId].months.add(bln);
    });
    const list = Object.values(byToko).map(info => {
      const sorted = [...info.months].sort();
      let longest = 1, current = 1;
      for (let i=1; i<sorted.length; i++) {
        current = isNextMonth(sorted[i-1], sorted[i]) ? current+1 : 1;
        if (current > longest) longest = current;
      }
      return { ...info, totalBulanTerjual: sorted.length, streakTerpanjang: sorted.length ? longest : 0, bulanTerakhir: sorted[sorted.length-1] || "-" };
    });
    return list.filter(r => r.streakTerpanjang >= KONSISTEN_MIN_BULAN)
      .sort((a,b) => b.streakTerpanjang - a.streakTerpanjang || b.totalBulanTerjual - a.totalBulanTerjual);
  }, [enrichKontrol, filterWilayah]);

  // ─── BUILD COLUMNS ───
  const produkCols = produkAktif.flatMap(p => [
    { key:`stok_${p.id}`,    label:`Stok ${p.id}`, render:v=><span>{fmt(v||0)}</span> },
    { key:`terjual_${p.id}`, label:`Jual ${p.id}`, render:v=><b style={{ color:T.green }}>{fmt(v||0)}</b> },
    { key:`bonus_${p.id}`,   label:`Bonus ${p.id}`,render:v=><span style={{ color:T.gold }}>{fmt(v||0)}</span> },
  ]);

  const colsHarian = [
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahToko",     label:"Jml Toko",     render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahMasalah",      label:"Bermasalah",      render:v=>v>0?<Badge color={"#DC2626"} bg={"#FEE2E2"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsBulananWil = [
    { key:"wilayahNama",    label:"Wilayah",      render:v=><b>{v||"—"}</b> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahMasalah",      label:"Bermasalah",      render:v=>v>0?<Badge color={"#DC2626"} bg={"#FEE2E2"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsBulananRute = [
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahMasalah",      label:"Bermasalah",      render:v=>v>0?<Badge color={"#DC2626"} bg={"#FEE2E2"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsKuartalWil = [
    { key:"bulan",          label:"Bulan",        render:v=><Badge color={T.blue}>{v}</Badge> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><b>{v||"—"}</b> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.teal }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahMasalah",      label:"Bermasalah",      render:v=>v>0?<Badge color={"#DC2626"} bg={"#FEE2E2"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];
  const colsKuartalRute = [
    { key:"bulan",          label:"Bulan",        render:v=><Badge color={T.blue}>{v}</Badge> },
    { key:"ruteNama",       label:"Rute",         render:v=><b>{v}</b> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.teal }}>{v}</span> },
    { key:"jumlahTutup",        label:"Toko Tutup",      render:v=>v>0?<Badge color={T.blue} bg={"#DBEAFE"}>{v} tutup</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahTidakTerjual", label:"Tidak Terjual",   render:v=>v>0?<Badge color={"#CA8A04"} bg={"#FEF9C3"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    { key:"jumlahMasalah",      label:"Bermasalah",      render:v=>v>0?<Badge color={"#DC2626"} bg={"#FEE2E2"}>{v} toko</Badge>:<span style={{ color:T.gray300 }}>0</span> },
    ...produkCols,
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",     label:"Total Bonus",  render:v=><span style={{ color:T.gold }}>{fmt(v)} pcs</span> },
  ];

  const colsRanking = [
    { key:"rank",           label:"#",            render:v=><b style={{ color: v===1?T.gold:v===2?T.gray500:v===3?"#B45309":T.gray400 }}>{v<=3 ? ["🥇","🥈","🥉"][v-1] : v}</b> },
    { key:"tokoNama",       label:"Toko",         render:v=><b>{v}</b> },
    { key:"ruteNama",       label:"Rute",         render:v=><span>{v}</span> },
    { key:"wilayahNama",    label:"Wilayah",      render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahKunjungan",label:"Kunjungan",    render:v=><span style={{ fontWeight:700,color:T.blue }}>{v}</span> },
    { key:"totalTerjual",   label:"Total Terjual",render:v=><b style={{ color:T.purple }}>{fmt(v)} pcs</b> },
    { key:"totalRev",       label:"Revenue",      render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
  ];

  // ─── Ambil data & kolom aktif ───
  let activeData = [], activeCols = [], activeTitle = "", activeFilename = "";
  if (mode==="harian") {
    activeData = rekapHarian;
    activeCols = colsHarian;
    activeTitle = `Rekap Harian ${filterTanggal}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_harian_${filterTanggal}`;
  } else if (mode==="bulanan") {
    activeData = rekapBulanan;
    activeCols = filterWilayah ? colsBulananRute : colsBulananWil;
    activeTitle = `Rekap Bulanan ${filterBulan}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":"" }`;
    activeFilename = `rekap_bulanan_${filterBulan}`;
  } else if (mode==="kuartal") {
    activeData = rekapKuartal;
    activeCols = filterWilayah ? colsKuartalRute : colsKuartalWil;
    activeTitle = `Rekap Kuartal ${filterKuartal} Tahun ${filterTahun}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_kuartal${filterKuartal}_${filterTahun}`;
  } else if (mode==="ranking") {
    activeData = rankingByJumlah;
    activeCols = colsRanking;
    const scopeLabel = { semua:"Semua Waktu", tahunIni:"Tahun Ini", "3bulan":"3 Bulan Terakhir", "6bulan":"6 Bulan Terakhir" }[rankingScope];
    activeTitle = `Ranking Toko Terlaris — ${scopeLabel}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `ranking_toko_${rankingScope}`;
  } else if (mode==="siklus") {
    activeData = rekapSiklus;
    activeCols = colsHarian;
    const wilNamaList = filterSiklusWilayahs.map(id => (db.wilayah||[]).find(w=>w.id===id)?.nama || id);
    const wilNamaGabungan = wilNamaList.join(", ");
    activeTitle = filterSiklusWilayahs.length
      ? `Siklus Kontrol ${filterSiklusWilayahs.length>1 ? "Gabungan: "+wilNamaGabungan : wilNamaGabungan} (${filterSiklusStart||"?"} s/d ${filterSiklusEnd||"?"})`
      : "Siklus Kontrol — pilih wilayah dulu";
    activeFilename = `siklus_${filterSiklusWilayahs.join("-")||"wilayah"}_${filterSiklusStart||""}_${filterSiklusEnd||""}`;
  } else if (mode==="perputaran") {
    // Tampilan layarnya "bespoke" (PerputaranDetail, 3 tabel bertingkat),
    // tapi untuk export perlu diratakan jadi 1 tabel biasa: setiap baris
    // = 1 cakupan (Keseluruhan/Wilayah/Rute), kolom = Terjual, Stok Beredar,
    // dan Persentase per produk.
    const perpRows = [];
    perpRows.push({ cakupan:"🌍 Keseluruhan", nama:"Semua Wilayah",
      ...Object.fromEntries(produkAktif.flatMap(p => [
        [`terjual_${p.id}`, perputaranStok.total.terjual[p.id]||0],
        [`stok_${p.id}`, perputaranStok.total.stok[p.id]||0],
        [`pct_${p.id}`, perputaranStok.total.stok[p.id] ? `${((perputaranStok.total.terjual[p.id]||0)/perputaranStok.total.stok[p.id]*100).toFixed(1)}%` : "—"],
      ])) });
    perputaranStok.wilayahRows.forEach(w => perpRows.push({ cakupan:"📍 Wilayah", nama:w.wilayahNama,
      ...Object.fromEntries(produkAktif.flatMap(p => [
        [`terjual_${p.id}`, w.terjual[p.id]||0],
        [`stok_${p.id}`, w.stok[p.id]||0],
        [`pct_${p.id}`, w.stok[p.id] ? `${((w.terjual[p.id]||0)/w.stok[p.id]*100).toFixed(1)}%` : "—"],
      ])) }));
    perputaranStok.ruteRows.forEach(r => perpRows.push({ cakupan:"🛣️ Rute", nama:`${r.ruteNama} (${r.wilayahNama})`,
      ...Object.fromEntries(produkAktif.flatMap(p => [
        [`terjual_${p.id}`, r.terjual[p.id]||0],
        [`stok_${p.id}`, r.stok[p.id]||0],
        [`pct_${p.id}`, r.stok[p.id] ? `${((r.terjual[p.id]||0)/r.stok[p.id]*100).toFixed(1)}%` : "—"],
      ])) }));
    activeData = perpRows;
    activeCols = [
      { key:"cakupan", label:"Cakupan" },
      { key:"nama", label:"Nama" },
      ...produkAktif.flatMap(p => [
        { key:`terjual_${p.id}`, label:`${p.nama} - Terjual` },
        { key:`stok_${p.id}`, label:`${p.nama} - Stok Beredar` },
        { key:`pct_${p.id}`, label:`${p.nama} - %` },
      ]),
    ];
    const periodeLabel = perputaranPeriodeType==="bulanan" ? filterBulan
      : perputaranPeriodeType==="kuartal" ? `Q${filterKuartal} ${filterTahun}` : filterTahun;
    activeTitle = `Perputaran Stok (${periodeLabel})`;
    activeFilename = `perputaran_stok_${perputaranPeriodeType}_${periodeLabel}`;
  } else {
    activeData = rekapTahunan;
    activeCols = filterWilayah ? colsKuartalRute : colsKuartalWil;
    activeTitle = `Rekap Tahunan ${filterTahun}${filterWilayah?" – "+(db.wilayah||[]).find(w=>w.id===filterWilayah)?.nama||"":""}`;
    activeFilename = `rekap_tahunan_${filterTahun}`;
  }

  // ─── Summary cards ───
  // ⚠️ FIX TRIPLE-COUNT: untuk mode Perputaran Stok, activeData (perpRows)
  // berisi 3 tingkat baris sekaligus dalam 1 array — "🌍 Keseluruhan" (1
  // baris = total nasional), "📍 Wilayah" (jumlahnya = total nasional lagi),
  // dan "🛣️ Rute" (jumlahnya = total nasional lagi juga). Array ini memang
  // dirancang begitu supaya file ekspor jadi 1 tabel datar berjenjang.
  // Tapi kalau di-reduce polos seperti mode lain (yang activeData-nya flat,
  // baris SALING EKSKLUSIF), angka "Terjual" jadi ke-hitung 3x lipat
  // (Keseluruhan + semua Wilayah + semua Rute ditumpuk). Makanya sebelumnya
  // Jual Roll 7500 tampil 30 pcs padahal aslinya cuma 10 pcs (10 × 3 level).
  // Untuk mode ini, sumber angka yang benar adalah perputaranStok.total
  // (dihitung sekali, bukan hasil jumlah baris yang tumpang tindih).
  const isPerputaran = mode === "perputaran";
  const totalRevAll = isPerputaran ? 0 : activeData.reduce((s,r)=>s+r.totalRev,0);
  // ✅ FIX SINKRONISASI: margin sebelumnya hardcoded *0.7 di tab ini,
  // sekarang ikut config yang sama dengan Tab Bagi Hasil & Dashboard.
  const marginPctRekap = Number(db.bagiHasilConfig?.marginLaba) || 70;
  const totalKunjungan = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r.jumlahToko||r.jumlahKunjungan||0),0);
  const totalBonusAll = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r.totalBonus||0),0);
  const totalTutupAll = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r.jumlahTutup||0),0);
  const totalTidakTerjualAll = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r.jumlahTidakTerjual||0),0);
  const totalMasalahAll = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r.jumlahMasalah||0),0);
  // ✅ BARU: jumlah toko yang statusnya Non-Aktif ("ditarik" lewat fitur
  // Tarik/Nonaktifkan Toko), dibatasi sesuai filter Wilayah/Rute yang sedang
  // aktif di Rekap. Beda dengan Tutup/Tidak Terjual/Bermasalah yang dihitung
  // dari entri kontrol per kunjungan, ini snapshot status TERKINI toko
  // (bukan kejadian yang terikat tanggal), jadi ditampilkan sebagai satu
  // angka ringkasan, bukan pecahan per baris wilayah/rute.
  const totalTokoDitarik = useMemo(() => {
    return (db.toko||[]).filter(t => {
      if (t.status !== "Non-Aktif") return false;
      if (filterRute) return t.ruteId === filterRute;
      if (filterWilayah) {
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return !!rute && rute.wilayahId === filterWilayah;
      }
      return true;
    }).length;
  }, [db.toko, db.rute, filterWilayah, filterRute]);

  // ─── RENDER HARIAN DETAIL (per toko dalam rute) ───
  function PerputaranDetail() {
    const { ruteRows, wilayahRows, total } = perputaranStok;

    // Format 1 sel: "terjual/stok (persentase%)" — kalau stok 0, tampilkan
    // "—" (bukan pembagian dengan nol yang tidak berarti apa-apa).
    function selPerputaran(terjual, stok) {
      if (!stok) return <span style={{ color:T.gray400 }}>—</span>;
      const pct = (terjual / stok) * 100;
      const warna = pct >= 50 ? T.green : pct >= 20 ? T.gold : T.red;
      return (
        <span>
          <b>{fmt(terjual)}</b><span style={{ color:T.gray400 }}>/{fmt(stok)}</span>
          {" "}<span style={{ color:warna, fontWeight:700 }}>({pct.toFixed(1)}%)</span>
        </span>
      );
    }

    function TabelPerputaran({ title, rows, labelKey, labelNama }) {
      return (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:12 }}>{title}</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                  <th style={{ padding:"8px 10px", textAlign:"left" }}>{labelNama}</th>
                  {produkAktif.map(p=>(
                    <th key={p.id} style={{ padding:"8px 10px", textAlign:"left" }}>{p.nama}<br/><span style={{ fontWeight:400, color:T.gray400 }}>Terjual/Beredar</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r,i)=>(
                  <tr key={r[labelKey]||i} style={{ borderTop:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                    <td style={{ padding:"8px 10px", fontWeight:600 }}>{r[labelNama==="Rute"?"ruteNama":"wilayahNama"]}</td>
                    {produkAktif.map(p=>(
                      <td key={p.id} style={{ padding:"8px 10px" }}>{selPerputaran(r.terjual[p.id]||0, r.stok[p.id]||0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      );
    }

    return (
      <div>
        <Card style={{ marginBottom:16, background:T.greenLt }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:12 }}>🌍 Keseluruhan Perusahaan</div>
          <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
            {produkAktif.map(p=>(
              <div key={p.id}>
                <div style={{ fontSize:12, color:T.gray600, marginBottom:4 }}>{p.nama}</div>
                <div style={{ fontSize:18 }}>{selPerputaran(total.terjual[p.id]||0, total.stok[p.id]||0)}</div>
              </div>
            ))}
          </div>
        </Card>
        {!isSalesRestricted && <TabelPerputaran title="📍 Per Wilayah" rows={wilayahRows} labelKey="wilayahId" labelNama="Wilayah" />}
        <TabelPerputaran title="🛣️ Per Rute" rows={ruteRows} labelKey="ruteId" labelNama="Rute" />
      </div>
    );
  }

  function HarianDetail() {
    return (
      <div>
        {rekapHarian.length === 0 ? (
          <Card>
            <div style={{ textAlign:"center", color:T.gray400, padding:32, fontSize:14 }}>
              📭 Tidak ada data kontrol untuk tanggal <b>{filterTanggal}</b>
              {filterWilayah && <span> di wilayah terpilih</span>}.
            </div>
          </Card>
        ) : rekapHarian.map((ruteGrp, gi) => (
          <Card key={ruteGrp.ruteId||gi} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${T.gray200}` }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🛣️ {ruteGrp.ruteNama}</div>
                <div style={{ fontSize:12, color:T.gray400 }}>{ruteGrp.wilayahNama} · {ruteGrp.jumlahToko} toko</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:14, fontWeight:800, color:T.green }}>{fmtRp(ruteGrp.totalRev)}</div>
                <div style={{ fontSize:12, color:T.gold }}>Bonus: {fmt(ruteGrp.totalBonus)} pcs</div>
              </div>
            </div>
            {/* Sub-tabel detail toko */}
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={thS}>Toko</th>
                    {produkAktif.map(p=>(
                      <th key={p.id} style={thS} colSpan={2}>{p.nama}</th>
                    ))}
                    <th style={thS}>Revenue</th>
                    <th style={thS}>Status</th>
                  </tr>
                  <tr style={{ background:T.gray100 }}>
                    <th style={thS}></th>
                    {produkAktif.map(p=>(
                      <React.Fragment key={p.id}>
                        <th style={{ ...thS, color:T.gray500 }}>Stok</th>
                        <th style={{ ...thS, color:T.green }}>Jual</th>
                      </React.Fragment>
                    ))}
                    <th style={thS}></th>
                    <th style={thS}></th>
                  </tr>
                </thead>
                <tbody>
                  {ruteGrp.detail.map((k,i) => {
                    const cs = k.catatanStatus ? (CATATAN_STATUS[k.catatanStatus]||CATATAN_STATUS.manual) : null;
                    const isLuarRute = !k.tokoNama;
                    return (
                      <tr key={k.id} style={{ background:i%2===0?T.white:T.gray50, borderTop:`1px solid ${T.gray100}` }}>
                        <td style={tdS}>
                          <b>{k.tokoNama || `👤 ${k.dicatatOleh || "Tidak diketahui"}`}</b>
                          {isLuarRute && k.keterangan && (
                            <div style={{ fontSize:10, color:T.gray400, fontWeight:400 }}>{k.keterangan}</div>
                          )}
                        </td>
                        {produkAktif.map(p=>(
                          <React.Fragment key={p.id}>
                            <td style={{ ...tdS, textAlign:"center" }}>{isLuarRute ? "—" : (k[`stok_${p.id}`]||0)}</td>
                            <td style={{ ...tdS, textAlign:"center", fontWeight:700, color:T.green }}>{k[`terjual_${p.id}`]||0}</td>
                          </React.Fragment>
                        ))}
                        <td style={{ ...tdS, fontWeight:700, color:T.green, whiteSpace:"nowrap" }}>{fmtRp(k.totalRev)}</td>
                        <td style={tdS}>
                          {isLuarRute ? <Badge color={T.purple}>🛣️ Luar Rute</Badge>
                              : cs ? <Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge>
                              : <Badge color={T.green}>✅ Terjual</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Sub-total baris */}
                  <tr style={{ background:T.greenLt, borderTop:`2px solid ${T.green}33`, fontWeight:700 }}>
                    <td style={tdS}>SUBTOTAL</td>
                    {produkAktif.map(p=>(
                      <React.Fragment key={p.id}>
                        <td style={{ ...tdS, textAlign:"center" }}>{fmt(ruteGrp[`stok_${p.id}`]||0)}</td>
                        <td style={{ ...tdS, textAlign:"center", color:T.green }}>{fmt(ruteGrp[`terjual_${p.id}`]||0)}</td>
                      </React.Fragment>
                    ))}
                    <td style={{ ...tdS, color:T.green }}>{fmtRp(ruteGrp.totalRev)}</td>
                    <td style={tdS}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        {/* Grand total harian */}
        {rekapHarian.length > 1 && (
          <Card style={{ background:T.goldLt, border:`2px solid ${T.gold}44` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>
                🏆 TOTAL KESELURUHAN — {filterTanggal}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:20, fontWeight:800, color:T.green }}>{fmtRp(totalRevAll)}</div>
                <div style={{ fontSize:13, color:T.gold }}>Bonus: {fmt(totalBonusAll)} pcs · {totalKunjungan} toko</div>
                {(totalTutupAll>0 || totalTidakTerjualAll>0 || totalMasalahAll>0) && (
                  <div style={{ fontSize:12, color:T.gray500, marginTop:2 }}>
                    {totalTutupAll>0 && <span>🔵 {totalTutupAll} toko tutup</span>}
                    {totalTutupAll>0 && (totalTidakTerjualAll>0||totalMasalahAll>0) && <span> · </span>}
                    {totalTidakTerjualAll>0 && <span>🟡 {totalTidakTerjualAll} tidak terjual</span>}
                    {totalTidakTerjualAll>0 && totalMasalahAll>0 && <span> · </span>}
                    {totalMasalahAll>0 && <span>🔴 {totalMasalahAll} bermasalah</span>}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  const thS = { padding:"7px 10px", textAlign:"left", color:T.gray600, fontWeight:700, fontSize:11, whiteSpace:"nowrap", borderBottom:`1px solid ${T.gray200}` };
  const tdS = { padding:"7px 10px", color:T.gray800, verticalAlign:"middle" };

  const MODE_TABS = [
    { key:"harian",   label:"📅 Harian/Rute" },
    { key:"bulanan",  label:"📆 Bulanan" },
    { key:"kuartal",  label:"📊 Kuartal" },
    { key:"tahunan",  label:"📈 Tahunan" },
    { key:"siklus",   label:"🔁 Siklus Wilayah" },
    { key:"perputaran", label:"🔄 Perputaran Stok" },
    { key:"ranking",  label:"🏆 Ranking Toko" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📑 Rekap Penjualan</div>
          <div style={{ fontSize:12, color:T.gray400 }}>Rekap otomatis dari data kontrol bulanan</div>
        </div>
        {(() => {
          // ── Kolom ekspor rekap (plain, tanpa React render) ──
          const rekapExportCols = activeCols.map(c => ({ key: c.key, label: c.label }));
          // Tambah kolom revenue formatted jika ada totalRev
          const hasTotalRev = activeCols.some(c => c.key === "totalRev");
          const finalRekapCols = hasTotalRev
            ? rekapExportCols.map(c => c.key === "totalRev" ? { ...c, key:"totalRevFmt", label:"Revenue (Rp)" } : c)
            : rekapExportCols;
          const rekapExportData = [
            ...activeData.map(row => ({
              ...row,
              totalRevFmt: hasTotalRev ? fmtRp(row.totalRev||0) : undefined,
            })),
            // Pemisah
            {},
            // Baris total
            {
              wilayahNama: "═══ TOTAL ═══",
              ruteNama: "",
              bulan: "",
              jumlahToko: totalKunjungan,
              jumlahKunjungan: totalKunjungan,
              jumlahTutup: totalTutupAll,
              jumlahTidakTerjual: totalTidakTerjualAll,
              jumlahMasalah: totalMasalahAll,
              totalRevFmt: fmtRp(totalRevAll),
              totalBonus: totalBonusAll,
              ...produkAktif.reduce((acc, p) => {
                // ⚠️ Sama seperti fix kartu ringkasan di atas: khusus mode
                // Perputaran Stok, activeData (perpRows) berisi 3 tingkat
                // baris tumpang tindih (Keseluruhan+Wilayah+Rute), jadi
                // reduce polos akan triple-count. Ambil dari
                // perputaranStok.total yang sudah benar untuk mode ini.
                acc[`stok_${p.id}`]    = isPerputaran ? (perputaranStok.total.stok[p.id]||0)    : activeData.reduce((s,r)=>s+(r[`stok_${p.id}`]||0),0);
                acc[`terjual_${p.id}`] = isPerputaran ? (perputaranStok.total.terjual[p.id]||0) : activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0);
                acc[`bonus_${p.id}`]   = isPerputaran ? 0 : activeData.reduce((s,r)=>s+(r[`bonus_${p.id}`]||0),0);
                return acc;
              }, {}),
            },
            // Baris kosong
            {},
            // Ringkasan
            { wilayahNama:"📊 RINGKASAN",             ruteNama:"",                        totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Total Revenue",             ruteNama:fmtRp(totalRevAll),         totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Total Bonus (pcs)",         ruteNama:String(totalBonusAll),      totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Jumlah Kunjungan/Toko",    ruteNama:String(totalKunjungan),     totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Tutup",                ruteNama:String(totalTutupAll),       totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Tidak Terjual",        ruteNama:String(totalTidakTerjualAll),totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Bermasalah",           ruteNama:String(totalMasalahAll),     totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Toko Ditarik/Non-Aktif",    ruteNama:String(totalTokoDitarik),    totalRevFmt:"", totalBonus:"" },
            { wilayahNama:"Jumlah Baris Data",         ruteNama:String(activeData.length),  totalRevFmt:"", totalBonus:"" },
          ];
          return (
            <ExportMenu
              data={activeData} columns={activeCols}
              exportData={rekapExportData} exportCols={finalRekapCols}
              title={activeTitle} filename={activeFilename}
            />
          );
        })()}
      </div>

      {/* Mode Tabs — pakai CSS grid (bukan flex:1 tanpa wrap) supaya di
          layar sempit tombol otomatis pindah ke baris baru dengan lebar
          kolom yang tetap sama rata (simetris), bukan malah terdorong
          keluar dari kartu seperti sebelumnya (flex row tanpa flexWrap
          bisa overflow kalau total lebar minimum ke-7 tombol > lebar layar). */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(104px, 1fr))",
        gap:6, marginBottom:16, background:T.white, border:`1px solid ${T.gray200}`,
        borderRadius:12, padding:6, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
        {MODE_TABS.map(m => (
          <button key={m.key} onClick={()=>setMode(m.key)}
            style={{ padding:"9px 6px", border:"none", borderRadius:8, cursor:"pointer",
              fontFamily:"inherit", fontWeight:700, fontSize:12.5, lineHeight:1.25, transition:"all .15s",
              textAlign:"center", whiteSpace:"normal", wordBreak:"break-word",
              background:mode===m.key ? T.green : "transparent",
              color:mode===m.key ? "#fff" : T.gray600 }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Filter Panel */}
      <div style={{ background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10,
        padding:"14px 16px", marginBottom:16, display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
        
        {/* Filter Wilayah — disembunyikan untuk Sales yang wilayahnya terkunci,
            dan untuk mode Siklus (yang punya field wilayah sendiri di bawah) */}
        {mode==="siklus" ? null : isSalesRestricted ? (
          <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
            padding:"8px 14px", fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, flex:1, minWidth:160 }}>
            🔒 Wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
          </div>
        ) : (
          <div style={{ minWidth:160, flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Wilayah</div>
            <select value={filterWilayah} onChange={e=>{ setFilterWilayah(e.target.value); setFilterRute(""); }}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              <option value="">Semua Wilayah</option>
              {wilayahOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* Filter Siklus per Wilayah: bisa pilih LEBIH DARI 1 wilayah untuk
            digabung jadi satu rekap siklus + rentang tanggal bebas
            (auto-terdeteksi dari siklus terakhir, tapi bisa digeser manual) */}
        {mode==="siklus" && (
          <>
            {isSalesRestricted ? (
              <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
                padding:"8px 14px", fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, flex:1, minWidth:160 }}>
                🔒 Wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
              </div>
            ) : (
              <div style={{ minWidth:220, flex:2 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>
                  Wilayah {filterSiklusWilayahs.length>1 && <span style={{ color:T.teal }}>({filterSiklusWilayahs.length} digabung)</span>}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {wilayahOpts.map(o => {
                    const active = filterSiklusWilayahs.includes(o.value);
                    return (
                      <button key={o.value} type="button"
                        onClick={() => setFilterSiklusWilayahs(prev =>
                          active ? prev.filter(id=>id!==o.value) : [...prev, o.value])}
                        style={{ padding:"6px 12px", borderRadius:99, border:`1.5px solid ${active?T.teal:T.gray200}`,
                          background:active?T.tealLt:T.white, color:active?T.teal:T.gray600,
                          fontSize:12, fontWeight:700, cursor:"pointer" }}>
                        {active?"✓ ":""}{o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ minWidth:150 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Dari Tanggal</div>
              <input type="date" value={filterSiklusStart} onChange={e=>setFilterSiklusStart(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            <div style={{ minWidth:150 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Sampai Tanggal</div>
              <input type="date" value={filterSiklusEnd} onChange={e=>setFilterSiklusEnd(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            {filterSiklusWilayahs.length>0 && (
              <Btn variant="secondary" size="sm" onClick={() => {
                if (siklusAutoRange) { setFilterSiklusStart(siklusAutoRange.start); setFilterSiklusEnd(siklusAutoRange.end); }
              }}>🔄 Deteksi Ulang Otomatis</Btn>
            )}
          </>
        )}


        {/* Filter tanggal (harian) */}
        {mode==="harian" && (
          <>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tanggal</div>
              <input type="date" value={filterTanggal} onChange={e=>setFilterTanggal(e.target.value)}
                style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
            </div>
            <div style={{ minWidth:160, flex:1 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Rute</div>
              <select value={filterRute} onChange={e=>setFilterRute(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="">Semua Rute</option>
                {ruteOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Filter bulan */}
        {mode==="bulanan" && (
          <div style={{ minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Bulan</div>
            <input type="month" value={filterBulan} onChange={e=>setFilterBulan(e.target.value)}
              style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
          </div>
        )}

        {/* Filter kuartal */}
        {(mode==="kuartal" || mode==="tahunan") && (
          <div style={{ minWidth:120 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tahun</div>
            <select value={filterTahun} onChange={e=>setFilterTahun(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              {tahunList.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {mode==="kuartal" && (
          <div style={{ minWidth:140 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Kuartal</div>
            <select value={filterKuartal} onChange={e=>setFilterKuartal(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              {[["1","Q1 (Jan–Mar)"],["2","Q2 (Apr–Jun)"],["3","Q3 (Jul–Sep)"],["4","Q4 (Okt–Des)"]].map(([v,l])=>(
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        )}

        {/* Filter khusus Perputaran Stok */}
        {mode==="perputaran" && (
          <>
            <div style={{ minWidth:140 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tipe Periode</div>
              <select value={perputaranPeriodeType} onChange={e=>setPerputaranPeriodeType(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="bulanan">Bulanan</option>
                <option value="kuartal">Kuartal</option>
                <option value="tahunan">Tahunan</option>
              </select>
            </div>
            {perputaranPeriodeType==="bulanan" && (
              <div style={{ minWidth:160 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Bulan</div>
                <input type="month" value={filterBulan} onChange={e=>setFilterBulan(e.target.value)}
                  style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }} />
              </div>
            )}
            {(perputaranPeriodeType==="kuartal" || perputaranPeriodeType==="tahunan") && (
              <div style={{ minWidth:120 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tahun</div>
                <select value={filterTahun} onChange={e=>setFilterTahun(e.target.value)}
                  style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                  {tahunList.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {perputaranPeriodeType==="kuartal" && (
              <div style={{ minWidth:140 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Kuartal</div>
                <select value={filterKuartal} onChange={e=>setFilterKuartal(e.target.value)}
                  style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                  {[["1","Q1 (Jan–Mar)"],["2","Q2 (Apr–Jun)"],["3","Q3 (Jul–Sep)"],["4","Q4 (Okt–Des)"]].map(([v,l])=>(
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {/* Filter khusus Ranking Toko */}
        {mode==="ranking" && (
          <>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Periode</div>
              <select value={rankingScope} onChange={e=>setRankingScope(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="3bulan">3 Bulan Terakhir</option>
                <option value="6bulan">6 Bulan Terakhir</option>
                <option value="tahunIni">Tahun Ini</option>
                <option value="semua">Semua Waktu (data yang sudah dimuat)</option>
              </select>
            </div>
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Urutkan Berdasarkan</div>
              <select value={rankingSortBy} onChange={e=>setRankingSortBy(e.target.value)}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                <option value="terjual">Jumlah Produk Terjual</option>
                <option value="revenue">Revenue</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Summary Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12, marginBottom:16 }}>
        <StatCard label="Total Revenue" value={fmtRp(totalRevAll)} icon="💰" color={T.green} />
        <StatCard label={`Laba Est. (${marginPctRekap}%)`} value={fmtRp(totalRevAll*(marginPctRekap/100))} icon="📊" color={T.gold} />
        <StatCard label={mode==="harian"?"Toko":"Kunjungan"} value={totalKunjungan} icon="🏪" color={T.blue} />
        <StatCard label="Total Bonus" value={`${fmt(totalBonusAll)} pcs`} icon="🎁" color={T.orange} />
        {produkAktif.map(p => (
          <StatCard key={p.id}
            label={`Jual ${p.nama}`}
            value={`${fmt(isPerputaran ? (perputaranStok.total.terjual[p.id]||0) : activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0))} pcs`}
            icon="🧴" color={T.purple} />
        ))}
      </div>
      {/* ℹ️ Ranking Toko dihitung per-toko, jadi Penjualan Luar Rute (toko
          tidak diketahui) tidak ikut masuk di sini — beda cakupan dengan
          badge "Rev" di header yang mencakup seluruh perusahaan. Ini bukan
          data tidak sinkron, cuma beda cakupan; catatan ini supaya jelas. */}
      {mode==="ranking" && (
        <div style={{ fontSize:11, color:T.gray500, marginTop:-8, marginBottom:16 }}>
          ℹ️ Total di atas hanya mencakup penjualan yang terikat ke toko tertentu. Penjualan Luar Rute (toko tidak diketahui) tidak dihitung di sini, sehingga totalnya bisa lebih kecil dari badge "Rev" di header.
        </div>
      )}

      {/* Title Banner */}
      <div style={{ background:T.green, borderRadius:10, padding:"12px 18px", marginBottom:14,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ color:"#fff", fontWeight:800, fontSize:15 }}>{activeTitle}</div>
        <div style={{ color:"rgba(255,255,255,.8)", fontSize:12 }}>
          {activeData.length} kelompok · {fmt(totalKunjungan)} {mode==="harian"?"toko":"kunjungan"}
        </div>
      </div>

      {/* Content */}
      {mode==="harian" ? (
        <HarianDetail />
      ) : mode==="perputaran" ? (
        <PerputaranDetail />
      ) : (
        activeData.length === 0 ? (
          <Card>
            <div style={{ textAlign:"center", color:T.gray400, padding:32, fontSize:14 }}>
              📭 Tidak ada data untuk periode ini.
            </div>
          </Card>
        ) : (
          <>
            <Card padding={0}>
              <Table columns={activeCols} data={activeData} />
            </Card>
            {/* Grand Total Row */}
            <Card style={{ background:T.goldLt, border:`2px solid ${T.gold}44`, marginTop:12 }}>
              <div style={{ display:"flex", flexWrap:"wrap", gap:24, alignItems:"center" }}>
                <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🏆 GRAND TOTAL</div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Total Revenue</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.green }}>{fmtRp(totalRevAll)}</div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Laba Bersih Est.</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.gold }}>{fmtRp(totalRevAll*(marginPctRekap/100))}</div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.gray500 }}>Total Kunjungan</div>
                  <div style={{ fontSize:18, fontWeight:800, color:T.blue }}>{totalKunjungan}</div>
                </div>
                {produkAktif.map(p=>(
                  <div key={p.id}>
                    <div style={{ fontSize:11, color:T.gray500 }}>Jual {p.nama}</div>
                    <div style={{ fontSize:16, fontWeight:700, color:T.purple }}>
                      {fmt(activeData.reduce((s,r)=>s+(r[`terjual_${p.id}`]||0),0))} pcs
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )
      )}

      {/* Panel tambahan khusus mode Ranking: toko konsisten terjual berturut-turut */}
      {mode==="ranking" && (
        <Card style={{ marginTop:16 }}>
          <div style={{ fontSize:15, fontWeight:800, color:T.gray800, marginBottom:4 }}>
            🔥 Toko Konsisten Terjual ≥{KONSISTEN_MIN_BULAN} Bulan Berturut-turut
          </div>
          <div style={{ fontSize:12, color:T.gray400, marginBottom:14 }}>
            Dihitung dari SELURUH data kontrol yang sudah dimuat (tidak terikat periode di atas) — toko dengan
            deretan bulan tanpa jeda yang selalu ada penjualan (&gt;0 pcs terjual).
          </div>
          {rankingKonsisten.length === 0 ? (
            <div style={{ textAlign:"center", color:T.gray400, padding:24, fontSize:13 }}>
              📭 Belum ada toko dengan streak ≥{KONSISTEN_MIN_BULAN} bulan berturut-turut
              {filterWilayah ? " di wilayah terpilih" : ""}.
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={thS}>#</th>
                    <th style={thS}>Toko</th>
                    <th style={thS}>Rute</th>
                    <th style={thS}>Wilayah</th>
                    <th style={thS}>Streak Terpanjang</th>
                    <th style={thS}>Total Bulan Terjual</th>
                    <th style={thS}>Bulan Terakhir Terjual</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingKonsisten.map((r, i) => (
                    <tr key={r.tokoId} style={{ background:i%2===0?T.white:T.gray50, borderTop:`1px solid ${T.gray100}` }}>
                      <td style={tdS}>{i<3 ? ["🥇","🥈","🥉"][i] : i+1}</td>
                      <td style={tdS}><b>{r.tokoNama}</b></td>
                      <td style={tdS}>{r.ruteNama}</td>
                      <td style={tdS}><Badge color={T.green}>{r.wilayahNama}</Badge></td>
                      <td style={tdS}><b style={{ color:T.orange }}>{r.streakTerpanjang} bulan</b></td>
                      <td style={tdS}>{r.totalBulanTerjual} bulan</td>
                      <td style={tdS}>{r.bulanTerakhir}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
//  TAB BAGI HASIL — Simulasi Akuntansi Lengkap
// ─────────────────────────────────────────────
