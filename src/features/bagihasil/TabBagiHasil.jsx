import React, { useMemo, useState } from "react";
import { Btn, Card, Modal, StatCard } from "../../components/ui";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { useAnalytics } from "../../hooks/useAnalytics";
import { exportExcel } from "../../lib/exportUtils";
import { fmt, fmtRp, genUniqueId } from "../../lib/format";
import { T } from "../../theme/tokens";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Icon } from "../../theme/icons.jsx";
import { NeracaKeuangan } from "./NeracaKeuangan.jsx";
import { LaporanPajak } from "./LaporanPajak.jsx";
import { periodeBounds, hitungAmortisasiPeriode, migrasiBebanUsahaLama, hitungDanaCadanganPeriode, hitungHppPeriode } from "../../lib/neracaHelpers";

export function TabBagiHasil({ db, analytics, save, addRecord, updateRecord, deleteRecord }) {
  const { totalRev, labaBersih, produkStats, kontrol, penjualanLuar } = analytics;
  const [activeSubTab, setActiveSubTab] = usePersistedState("bagihasil.subtab", "ringkasan");

  // State untuk konfigurasi bagi hasil (tersimpan di db.bagiHasilConfig)
  const config = db.bagiHasilConfig || {
    marginLaba: 70, // % margin laba bersih dari pendapatan (dipakai kalau metodeHpp = "manual")
    biayaOperasional: 0,
    biayaBonus: 0,
    biayaLogistik: 0,
    biayaLainnya: 0,
    metodeHpp: "manual", // "manual" (Margin % asumsi) | "otomatis" (dari HPP produk riil)
    danaCadangan: { aktif: false, rpPerPcs: 500, keterangan: "Dana Darurat Perusahaan" },
    pihak: [
      { id:"BH001", nama:"Pemilik Utama",  pct: 60, basis:"laba",    warna:"#0F4C35", keterangan:"Keuntungan inti bisnis" },
      { id:"BH002", nama:"Investor A",     pct: 20, basis:"revenue", warna:"#1D4ED8", keterangan:"Return on investment" },
      { id:"BH003", nama:"Manajer Ops",    pct: 10, basis:"laba",    warna:"#7C3AED", keterangan:"Bonus kinerja operasional" },
      { id:"BH004", nama:"Karyawan Pool",  pct: 10, basis:"laba",    warna:"#D97706", keterangan:"Insentif tim sales" },
    ],
  };

  const [editConfig, setEditConfig] = useState(false);
  const [cfgDraft, setCfgDraft] = useState(config);
  // ✅ PERSISTEN: filter periode tetap sama setelah refresh / app dibuka ulang.
  const [filterBulan, setFilterBulan] = usePersistedState("bagihasil.filterBulan", () => new Date().toISOString().slice(0,7));
  const [filterTahun, setFilterTahun] = usePersistedState("bagihasil.filterTahun", () => String(new Date().getFullYear()));
  const [periodeMode, setPeriodeMode] = usePersistedState("bagihasil.periodeMode", "bulanan"); // bulanan | tahunan | kustom
  const [filterStart, setFilterStart] = usePersistedState("bagihasil.filterStart", () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
  const [filterEnd, setFilterEnd] = usePersistedState("bagihasil.filterEnd", () => new Date().toISOString().slice(0,10));
  const [showDetail, setShowDetail] = useState(false);
  const [modalPihak, setModalPihak] = useState(null);
  const [formPihak, setFormPihak] = useState({});

  // Hitung revenue berdasarkan filter periode
  const revPeriode = useMemo(() => {
    let rows = kontrol;
    let luarRows = penjualanLuar||[];
    if (periodeMode === "bulanan") {
      rows = kontrol.filter(k => k.tanggal?.startsWith(filterBulan));
      luarRows = luarRows.filter(pl => pl.tanggal?.startsWith(filterBulan));
    } else if (periodeMode === "tahunan") {
      rows = kontrol.filter(k => k.tanggal?.startsWith(filterTahun));
      luarRows = luarRows.filter(pl => pl.tanggal?.startsWith(filterTahun));
    } else {
      rows = kontrol.filter(k => k.tanggal >= filterStart && k.tanggal <= filterEnd);
      luarRows = luarRows.filter(pl => pl.tanggal >= filterStart && pl.tanggal <= filterEnd);
    }
    // ✅ FIX SINKRONISASI: Penjualan Luar Rute (transaksi yang tokonya tidak
    // diketahui/dicatat sales) sebelumnya TIDAK IKUT dihitung di sini sama
    // sekali, padahal itu tetap pendapatan & laba resmi perusahaan (lihat
    // enrichLuarRute di useAnalytics) — Dashboard dan semua mode Tab Rekap
    // sudah menyertakannya. Akibatnya, "Total Pendapatan" dan Laba Bersih
    // di Bagi Hasil (yang menentukan nominal yang benar-benar dibagi ke
    // Pemilik/Investor/Manajer/Karyawan) bisa lebih kecil dari kenyataan
    // kalau ada Penjualan Luar Rute di periode terpilih. Pcs terjual & bonus
    // ikut disertakan juga; tapi kunjunganTotal & tokoUnik TIDAK ditambah
    // karena Penjualan Luar Rute bukan kunjungan ke toko tertentu.
    const rev = rows.reduce((s,k) => s+k.totalRev, 0) + luarRows.reduce((s,k)=>s+k.totalRev, 0);
    const bonusTotal = rows.reduce((s,k) => s+(k.totalBonus||0), 0) + luarRows.reduce((s,k)=>s+(k.totalBonus||0), 0);
    const terjualTotal = rows.reduce((s,k) => s+k.totalTerjual, 0) + luarRows.reduce((s,k)=>s+k.totalTerjual, 0);
    const kunjunganTotal = rows.length;
    const tokoUnik = new Set(rows.map(k => k.tokoId)).size;
    return { rev, bonusTotal, terjualTotal, kunjunganTotal, tokoUnik, rows, luarRows };
  }, [kontrol, penjualanLuar, periodeMode, filterBulan, filterTahun, filterStart, filterEnd]);


  // Batas tanggal periode terpilih (dipakai bareng oleh Amortisasi & Neraca Keuangan)
  const bounds = useMemo(() => periodeBounds(periodeMode, filterBulan, filterTahun, filterStart, filterEnd),
    [periodeMode, filterBulan, filterTahun, filterStart, filterEnd]);
  // Kunci unik per-periode (dipakai supaya "Cairkan ke Kas" tidak mencatat dobel
  // untuk periode & pihak yang sama)
  const periodeKey = `${bounds.start}_${bounds.end}`;
  const distribusiLog = db.distribusiLog || [];
  function cariLogPencairan(pihakId) {
    return distribusiLog.find(d => d.periodeKey === periodeKey && d.pihakId === pihakId);
  }
  function cairkanKeKas(p) {
    const kasId = genUniqueId("KAS");
    addRecord("kasTransaksi", { id: kasId, tanggal: new Date().toISOString().slice(0,10), tipe:"keluar",
      kategori:"Pencairan Bagi Hasil", nominal: p.nominal, keterangan: `Bagi hasil ${p.nama} — ${PERIODE_LABELS[periodeMode]}` });
    addRecord("distribusiLog", { id: genUniqueId("DIST"), periodeKey, periodeLabel: PERIODE_LABELS[periodeMode],
      pihakId: p.id, pihakNama: p.nama, nominal: p.nominal, tanggal: new Date().toISOString().slice(0,10), kasTransaksiId: kasId });
  }
  function batalkanPencairan(log) {
    if (!confirm(`Batalkan pencairan "${log.pihakNama}" & hapus entri Kas terkait?`)) return;
    if (log.kasTransaksiId) deleteRecord("kasTransaksi", log.kasTransaksiId);
    deleteRecord("distribusiLog", log.id);
  }
  function cairkanSemua() {
    const belumCair = akuntansi.pihakList.filter(p => !cariLogPencairan(p.id));
    if (belumCair.length === 0) return alert("Semua pihak untuk periode ini sudah dicairkan.");
    if (!confirm(`Catat pencairan ke Kas untuk ${belumCair.length} pihak (total ${fmtRp(belumCair.reduce((s,p)=>s+p.nominal,0))})?`)) return;
    belumCair.forEach(cairkanKeKas);
  }

  // Kalkulasi akuntansi lengkap
  const akuntansi = useMemo(() => {
    const pendapatan = revPeriode.rev;

    // ✅ Beban Usaha sekarang list dinamis (Gaji Karyawan, Gaji Sales, dll —
    // bebas ditambah admin), bukan 4 field tetap lagi. Selama config.bebanUsaha
    // belum pernah disimpan, dipakai hasil migrasi otomatis dari 4 field lama
    // (biayaOperasional dkk) supaya nilai yang sudah ada di lapangan TIDAK
    // hilang/reset — begitu Admin membuka & simpan Konfigurasi sekali, list
    // ini permanen tersimpan menggantikan 4 field lama.
    const bebanUsahaList = Array.isArray(config.bebanUsaha) ? config.bebanUsaha : migrasiBebanUsahaLama(config);
    const bebanUsahaTotal = bebanUsahaList.reduce((s,b)=>s+(Number(b.nominal)||0), 0);
    // (field lama tetap dihitung terpisah untuk kompatibilitas ekspor lama, tapi TIDAK dobel-hitung ke totalBiaya)
    const biayaOps = Number(config.biayaOperasional)||0;
    const biayaBonus = Number(config.biayaBonus)||0;
    const biayaLogistik = Number(config.biayaLogistik)||0;
    const biayaLain = Number(config.biayaLainnya)||0;

    // ✅ NERACA KEUANGAN: Biaya Amortisasi dihitung OTOMATIS dari daftar aset
    // (Tab Bagi Hasil → Neraca Keuangan → Amortisasi), bukan diisi manual —
    // supaya SHU/Laba Bersih & ROE mencerminkan beban penyusutan aset tetap.
    const biayaAmortisasi = hitungAmortisasiPeriode(db.asetAmortisasi||[], bounds).total;
    const totalBiaya = bebanUsahaTotal + biayaAmortisasi;

    // ✅ HPP: kalau produk sudah diisi Harga Modal, bisa dipakai sebagai dasar
    // Laba Kotor RIIL (akuntansi yang benar) menggantikan asumsi Margin %.
    const hppInfo = hitungHppPeriode(revPeriode, db.produk||[]);
    const metodeHpp = config.metodeHpp === "otomatis" ? "otomatis" : "manual";
    const marginPct = Number(config.marginLaba)||70;

    let labaKotor, labaSebelumCadangan;
    if (metodeHpp === "otomatis") {
      // Laba Kotor (Gross Profit) = Pendapatan − HPP riil (bukan asumsi %)
      labaKotor = pendapatan - hppInfo.totalHpp;
      // Laba Usaha = Laba Kotor − Beban Usaha − Amortisasi (tanpa dikali Margin% lagi,
      // karena HPP sudah jadi dasar biaya yang akurat)
      labaSebelumCadangan = Math.max(labaKotor - totalBiaya, 0);
    } else {
      // Metode lama (tetap sama persis seperti sebelumnya, demi kompatibilitas):
      // Laba Kotor = Pendapatan − Beban Usaha − Amortisasi, lalu Laba Bersih = Laba Kotor × Margin%
      labaKotor = pendapatan - totalBiaya;
      labaSebelumCadangan = Math.max(labaKotor * (marginPct/100), 0);
    }

    // ✅ Kewajiban Dana Cadangan (OPSIONAL, per white-label beda kebijakan):
    // sekian Rupiah per pcs terjual disisihkan sebelum sisanya dibagi ke pihak.
    const danaCadanganPeriode = hitungDanaCadanganPeriode(revPeriode.terjualTotal, config.danaCadangan);
    const labaBersihFinal = Math.max(labaSebelumCadangan - danaCadanganPeriode, 0);

    const pihakList = (config.pihak||[]).map(p => {
      const basis = p.basis === "laba" ? labaBersihFinal : pendapatan;
      const nominal = basis * (p.pct / 100);
      return { ...p, nominal, basisNilai: basis };
    });
    const totalDibagi = pihakList.reduce((s,p)=>s+p.nominal, 0);

    return {
      pendapatan, biayaOps, biayaBonus, biayaLogistik, biayaLain, biayaAmortisasi, totalBiaya,
      bebanUsahaList, bebanUsahaTotal, metodeHpp, hppInfo, marginPct,
      danaCadanganPeriode,
      labaKotor, labaSebelumCadangan, labaBersihFinal,
      pihakList, totalDibagi,
    };
  }, [revPeriode, config, db.asetAmortisasi, db.produk, bounds]);

  function tambahBebanUsaha() {
    setCfgDraft(p => ({ ...p, bebanUsaha: [...(p.bebanUsaha||[]), { id: genUniqueId("BU"), nama:"", nominal:0 }] }));
  }
  function updateBebanUsaha(id, field, value) {
    setCfgDraft(p => ({ ...p, bebanUsaha: (p.bebanUsaha||[]).map(b => b.id===id ? { ...b, [field]: value } : b) }));
  }
  function hapusBebanUsaha(id) {
    setCfgDraft(p => ({ ...p, bebanUsaha: (p.bebanUsaha||[]).filter(b => b.id!==id) }));
  }

  function saveConfig(newCfg) {
    save({ ...db, bagiHasilConfig: newCfg });
  }

  function submitConfig() {
    saveConfig(cfgDraft);
    setEditConfig(false);
  }

  function tambahPihak() {
    const newId = "BH" + String(Date.now()).slice(-5);
    setFormPihak({ id: newId, nama:"", pct:0, basis:"laba", warna:"#4B5563", keterangan:"" });
    setModalPihak("add");
  }

  function submitPihak() {
    if (!formPihak.nama) return alert("Nama wajib diisi");
    const pct = Number(formPihak.pct)||0;
    const pihakBaru = [...(cfgDraft.pihak||[])];
    if (modalPihak === "add") {
      pihakBaru.push({ ...formPihak, pct });
    } else {
      const idx = pihakBaru.findIndex(p=>p.id===formPihak.id);
      if (idx>=0) pihakBaru[idx] = { ...formPihak, pct };
    }
    const newCfg = { ...cfgDraft, pihak: pihakBaru };
    setCfgDraft(newCfg);
    saveConfig(newCfg);
    setModalPihak(null);
  }

  function hapusPihak(id) {
    if (!confirm("Hapus pihak ini?")) return;
    const newCfg = { ...config, pihak: (config.pihak||[]).filter(p=>p.id!==id) };
    saveConfig(newCfg);
    setCfgDraft(newCfg);
  }

  function exportLaporanBagiHasil() {
    const rows = [
      { keterangan:"LAPORAN BAGI HASIL", nilai:"" },
      { keterangan:"Periode", nilai: periodeMode==="bulanan"?filterBulan:periodeMode==="tahunan"?filterTahun:`${filterStart} s/d ${filterEnd}` },
      { keterangan:"", nilai:"" },
      { keterangan:"=== PENDAPATAN ===", nilai:"" },
      { keterangan:"Total Pendapatan (Revenue)", nilai: fmtRp(akuntansi.pendapatan) },
      { keterangan:"Total Produk Terjual", nilai: fmt(revPeriode.terjualTotal) + " pcs" },
      { keterangan:"Jumlah Kunjungan", nilai: revPeriode.kunjunganTotal },
      { keterangan:"Toko Aktif Dikunjungi", nilai: revPeriode.tokoUnik },
      { keterangan:"", nilai:"" },
      { keterangan:"=== BEBAN USAHA ===", nilai:"" },
      ...(akuntansi.metodeHpp==="otomatis" ? [{ keterangan:"HPP (Harga Pokok Penjualan)", nilai: fmtRp(akuntansi.hppInfo.totalHpp) }] : []),
      ...akuntansi.bebanUsahaList.map(b=>({ keterangan:b.nama, nilai: fmtRp(b.nominal) })),
      { keterangan:"Biaya Amortisasi (Aset Tetap)", nilai: fmtRp(akuntansi.biayaAmortisasi) },
      { keterangan:"TOTAL BEBAN USAHA", nilai: fmtRp(akuntansi.totalBiaya) },
      { keterangan:`Laba Kotor${akuntansi.metodeHpp==="otomatis"?" (Riil, dari HPP)":""}`, nilai: fmtRp(akuntansi.labaKotor) },
      ...(akuntansi.danaCadanganPeriode > 0 ? [{ keterangan:`Kewajiban Dana Cadangan (${config.danaCadangan?.keterangan||"opsional"})`, nilai: fmtRp(akuntansi.danaCadanganPeriode) }] : []),
      { keterangan:"", nilai:"" },
      { keterangan:"=== LABA BERSIH / SHU ===", nilai:"" },
      { keterangan: akuntansi.metodeHpp==="otomatis" ? "Laba Bersih (metode HPP)" : `Laba Bersih (${akuntansi.marginPct}% dari Laba Kotor)`, nilai: fmtRp(akuntansi.labaBersihFinal) },
      { keterangan:"", nilai:"" },
      { keterangan:"=== DISTRIBUSI BAGI HASIL ===", nilai:"" },
      ...akuntansi.pihakList.map(p=>({
        keterangan: `${p.nama} (${p.pct}% dari ${p.basis==="laba"?"laba bersih":"revenue"})`,
        nilai: fmtRp(p.nominal)
      })),
      { keterangan:"TOTAL DIBAGI", nilai: fmtRp(akuntansi.totalDibagi) },
    ];
    exportExcel(rows, [{key:"keterangan",label:"Keterangan"},{key:"nilai",label:"Nilai"}],
      "Laporan Bagi Hasil GWG", `bagi_hasil_${filterBulan||filterTahun}`);
  }

  const PERIODE_LABELS = {
    bulanan: `Bulan ${filterBulan}`,
    tahunan: `Tahun ${filterTahun}`,
    kustom: `${filterStart} – ${filterEnd}`,
  };

  const totalPctLaba = (config.pihak||[]).filter(p=>p.basis==="laba").reduce((s,p)=>s+Number(p.pct||0),0);
  const totalPctRev = (config.pihak||[]).filter(p=>p.basis==="revenue").reduce((s,p)=>s+Number(p.pct||0),0);

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:7 }}><Icon.wallet size={19} strokeWidth={2} /> Simulasi Bagi Hasil & Akuntansi</div>
          <div style={{ fontSize:12, color:T.gray400 }}>Laporan keuangan & distribusi profit sesuai skema akuntansi</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Btn variant="secondary" size="sm" icon={Icon.settings} onClick={()=>{ setCfgDraft({...config, bebanUsaha: Array.isArray(config.bebanUsaha) ? config.bebanUsaha : migrasiBebanUsahaLama(config)}); setEditConfig(true); }}>Konfigurasi</Btn>
          <Btn variant="secondary" size="sm" icon={Icon.rekap} onClick={exportLaporanBagiHasil}>Ekspor Excel</Btn>
          <Btn variant="secondary" size="sm" icon={showDetail?Icon.chevronUp:Icon.chevronDown} onClick={()=>setShowDetail(v=>!v)}>
            {showDetail?"Sembunyikan Detail":"Lihat Detail Produk"}
          </Btn>
        </div>
      </div>

      {/* Sub-navigasi: Ringkasan Bagi Hasil | Neraca Keuangan Lengkap | Laporan Pajak (Coretax) */}
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", borderBottom:`1.5px solid ${T.gray200}`, paddingBottom:2 }}>
        {[
          { key:"ringkasan", label:"Bagi Hasil & Laba Rugi", icon:Icon.wallet },
          { key:"neraca", label:"Neraca Keuangan Lengkap", icon:Icon.scale },
          { key:"pajak", label:"Laporan Pajak (Coretax)", icon:Icon.receipt },
        ].map(t=>(
          <button key={t.key} onClick={()=>setActiveSubTab(t.key)}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 16px", border:"none",
              borderBottom:`2.5px solid ${activeSubTab===t.key?T.green:"transparent"}`,
              background:"none", cursor:"pointer", fontFamily:"inherit",
              fontSize:13, fontWeight:700, color:activeSubTab===t.key?T.green:T.gray400 }}>
            <t.icon size={15} strokeWidth={2} /> {t.label}
          </button>
        ))}
      </div>

      {/* Filter Periode */}
      <Card style={{ marginBottom:16, padding:"14px 18px" }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Mode Periode</div>
            <div style={{ display:"flex", gap:6 }}>
              {["bulanan","tahunan","kustom"].map(m=>(
                <button key={m} onClick={()=>setPeriodeMode(m)}
                  style={{ padding:"6px 14px", border:`1.5px solid ${periodeMode===m?T.green:T.gray200}`,
                    borderRadius:7, background:periodeMode===m?T.greenLt:T.white, cursor:"pointer",
                    fontSize:12, fontWeight:600, color:periodeMode===m?T.green:T.gray600, fontFamily:"inherit" }}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}>{m==="bulanan"?<Icon.calendar size={13} strokeWidth={2}/>:m==="tahunan"?<Icon.calendarDays size={13} strokeWidth={2}/>:<Icon.pin size={13} strokeWidth={2}/>}{m==="bulanan"?"Bulanan":m==="tahunan"?"Tahunan":"Kustom"}</span>
                </button>
              ))}
            </div>
          </div>
          {periodeMode==="bulanan" && (
            <div style={{ flex:1, minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Bulan</div>
              <input type="month" value={filterBulan} onChange={e=>setFilterBulan(e.target.value)}
                style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
            </div>
          )}
          {periodeMode==="tahunan" && (
            <div style={{ flex:1, minWidth:120 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Tahun</div>
              <select value={filterTahun} onChange={e=>setFilterTahun(e.target.value)}
                style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }}>
                {[...new Set([...kontrol.map(k=>k.tanggal?.slice(0,4)).filter(Boolean), String(new Date().getFullYear())])].sort().reverse().map(y=>(
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {periodeMode==="kustom" && (
            <>
              <div style={{ flex:1, minWidth:140 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Dari Tanggal</div>
                <input type="date" value={filterStart} onChange={e=>setFilterStart(e.target.value)}
                  style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
              </div>
              <div style={{ flex:1, minWidth:140 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Sampai Tanggal</div>
                <input type="date" value={filterEnd} onChange={e=>setFilterEnd(e.target.value)}
                  style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit" }} />
              </div>
            </>
          )}
          <div style={{ padding:"8px 16px", background:T.greenLt, borderRadius:8, border:`1px solid ${T.green}33`, fontSize:13 }}>
            <b style={{ color:T.green }}>Periode:</b> {PERIODE_LABELS[periodeMode]}
          </div>
        </div>
      </Card>

      {activeSubTab === "ringkasan" && (<>
      {/* Ringkasan Kinerja Periode */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
        <StatCard label="Total Revenue" value={fmtRp(akuntansi.pendapatan)} icon={Icon.banknote} color={T.green} sub={PERIODE_LABELS[periodeMode]} />
        <StatCard label="Laba Bersih / SHU" value={fmtRp(akuntansi.labaBersihFinal)} icon={Icon.trendingUp} color={T.teal}
          sub={akuntansi.metodeHpp==="otomatis" ? "metode HPP (riil)" : `${akuntansi.marginPct}% dari Laba Kotor`} />
        <StatCard label="Total Beban Usaha" value={fmtRp(akuntansi.totalBiaya)} icon={Icon.trendingDown} color={T.red} sub={`${akuntansi.bebanUsahaList.length} item + amortisasi`} />
        <StatCard label="Produk Terjual" value={fmt(revPeriode.terjualTotal)+" pcs"} icon={Icon.produk} color={T.purple} sub={`${revPeriode.kunjunganTotal} kunjungan`} />
        <StatCard label="Toko Dikunjungi" value={revPeriode.tokoUnik} icon={Icon.toko} color={T.blue} sub="toko unik" />
        <StatCard label="Total Dibagi" value={fmtRp(akuntansi.totalDibagi)} icon={Icon.bagihasil} color={T.gold} sub={`${(config.pihak||[]).length} pihak`} />
      </div>

      {/* Laporan Laba Rugi */}
      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:800, color:T.gray800, marginBottom:6, borderBottom:`2px solid ${T.green}`, paddingBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span><Icon.file size={15} strokeWidth={2} style={{verticalAlign:"-3px", marginRight:6}} /> Laporan Laba Rugi — {PERIODE_LABELS[periodeMode]}</span>
            <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:99, background:akuntansi.metodeHpp==="otomatis"?T.goldLt:T.gray100, color:akuntansi.metodeHpp==="otomatis"?T.gold:T.gray600 }}>
              {akuntansi.metodeHpp==="otomatis" ? "Metode HPP" : "Metode Margin %"}
            </span>
          </div>
          {akuntansi.metodeHpp==="otomatis" && akuntansi.hppInfo.adaYangBelumIsi && (
            <div style={{ fontSize:11, color:T.orange, marginBottom:10, padding:"6px 10px", background:T.orangeLt, borderRadius:6 }}>
              <Icon.warning size={11} strokeWidth={2} style={{verticalAlign:"-1px", marginRight:4}} /> Ada produk terjual yang belum diisi Harga Modal/HPP — Laba Kotor di bawah bisa under-estimate biaya (HPP produk itu dianggap Rp0).
            </div>
          )}

          {/* Pendapatan */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>I. Pendapatan</div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.greenLt, borderRadius:7 }}>
              <span style={{ fontSize:13 }}>Pendapatan Konsinyasi</span>
              <span style={{ fontWeight:700, color:T.green }}>{fmtRp(akuntansi.pendapatan)}</span>
            </div>
            {akuntansi.metodeHpp==="otomatis" && (
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px" }}>
                <span style={{ fontSize:13, color:T.gray600 }}>HPP (Harga Pokok Penjualan)</span>
                <span style={{ fontSize:13, color:T.red }}>({fmtRp(akuntansi.hppInfo.totalHpp)})</span>
              </div>
            )}
          </div>

          {/* Beban Usaha — list dinamis, diatur di tombol Konfigurasi */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>II. Beban Usaha</div>
            {akuntansi.bebanUsahaList.length === 0 ? (
              <div style={{ fontSize:12, color:T.gray400, padding:"6px 12px" }}>Belum ada item Beban Usaha — atur lewat tombol Konfigurasi.</div>
            ) : akuntansi.bebanUsahaList.map((b,i)=>(
              <div key={b.id||i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px", borderBottom:`1px solid ${T.gray100}` }}>
                <span style={{ fontSize:13, color:T.gray600 }}>{b.nama}</span>
                <span style={{ fontSize:13, color:T.red }}>({fmtRp(b.nominal)})</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px", borderBottom:`1px solid ${T.gray100}` }}>
              <span style={{ fontSize:13, color:T.gray600 }}>Biaya Amortisasi (Aset Tetap) <span title="Dihitung otomatis dari daftar aset di Neraca Keuangan → Amortisasi" style={{ fontSize:10, color:T.gray400 }}>(otomatis)</span></span>
              <span style={{ fontSize:13, color:T.red }}>({fmtRp(akuntansi.biayaAmortisasi)})</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.redLt, borderRadius:7, marginTop:6 }}>
              <span style={{ fontSize:13, fontWeight:700 }}>Total Beban Usaha</span>
              <span style={{ fontWeight:700, color:T.red }}>({fmtRp(akuntansi.totalBiaya)})</span>
            </div>
          </div>

          {/* Laba */}
          <div style={{ borderTop:`2px solid ${T.gray200}`, paddingTop:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.gray50, borderRadius:7, marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>Laba Kotor{akuntansi.metodeHpp==="otomatis" && " (Riil, dari HPP)"}</span>
              <span style={{ fontWeight:700 }}>{fmtRp(akuntansi.labaKotor)}</span>
            </div>
            {akuntansi.metodeHpp==="manual" && (
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", marginBottom:4 }}>
                <span style={{ fontSize:13, color:T.gray600 }}>Penyesuaian Margin ({akuntansi.marginPct}%)</span>
                <span style={{ fontSize:13, color:T.gray600 }}>{fmtRp(akuntansi.labaSebelumCadangan)}</span>
              </div>
            )}
            {akuntansi.danaCadanganPeriode > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", marginBottom:4 }}>
                <span style={{ fontSize:13, color:T.gray600 }}>Kewajiban Dana Cadangan ({config.danaCadangan?.keterangan || "opsional"})</span>
                <span style={{ fontSize:13, color:T.red }}>({fmtRp(akuntansi.danaCadanganPeriode)})</span>
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 16px",
              background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`,
              borderRadius:10, marginTop:8 }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#fff", display:"inline-flex", alignItems:"center", gap:6 }}><Icon.wallet size={15} strokeWidth={2} /> LABA BERSIH / SHU</span>
              <span style={{ fontSize:16, fontWeight:900, color:"#fff" }}>{fmtRp(akuntansi.labaBersihFinal)}</span>
            </div>
          </div>
        </Card>

        {/* Distribusi Bagi Hasil */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, borderBottom:`2px solid ${T.gold}`, paddingBottom:10, flexWrap:"wrap", rowGap:8 }}>
            <div style={{ fontSize:14, fontWeight:800, color:T.gray800, display:"flex", alignItems:"center", gap:6 }}><Icon.bagihasil size={16} strokeWidth={2} /> Distribusi Bagi Hasil</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {akuntansi.pihakList.length > 0 && (
                <Btn size="sm" icon={Icon.landmark} variant="secondary" onClick={cairkanSemua}>Cairkan Semua ke Kas</Btn>
              )}
              <Btn size="sm" icon={Icon.add} variant="gold" onClick={tambahPihak}>Tambah Pihak</Btn>
            </div>
          </div>

          {/* Validasi total pct */}
          {(totalPctLaba > 100 || totalPctRev > 100) && (
            <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:12, color:T.red }}>
              <Icon.warning size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Total persentase dari {totalPctLaba>100?"laba":"revenue"} melebihi 100% ({totalPctLaba>100?totalPctLaba:totalPctRev}%). Harap periksa konfigurasi.
            </div>
          )}

          {akuntansi.pihakList.length === 0 ? (
            <div style={{ textAlign:"center", color:T.gray400, padding:24 }}>Belum ada konfigurasi pihak bagi hasil</div>
          ) : (
            <>
              {/* Pie chart visual sederhana */}
              <div style={{ display:"flex", gap:4, height:16, borderRadius:99, overflow:"hidden", marginBottom:16 }}>
                {akuntansi.pihakList.map((p,i)=>{
                  const total = akuntansi.totalDibagi || 1;
                  const w = (p.nominal / total * 100).toFixed(1);
                  return <div key={i} style={{ width:`${w}%`, background:p.warna, minWidth:4, transition:"width .5s" }} title={`${p.nama}: ${fmtRp(p.nominal)}`} />;
                })}
              </div>

              {akuntansi.pihakList.map((p,i)=>{
                const log = cariLogPencairan(p.id);
                return (
                <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  flexWrap:"wrap", rowGap:10, columnGap:10,
                  padding:"10px 14px", borderRadius:10, marginBottom:10,
                  background:p.warna+"12", border:`1.5px solid ${p.warna}30` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0, flex:"1 1 140px" }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:p.warna, flexShrink:0 }} />
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:T.gray800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.nama}</div>
                      <div style={{ fontSize:11, color:T.gray400 }}>
                        {p.pct}% dari {p.basis==="laba"?"laba bersih":"revenue"} · {p.keterangan}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end", flex:"0 1 auto" }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:15, fontWeight:800, color:p.warna }}>{fmtRp(p.nominal)}</div>
                      <div style={{ fontSize:10, color:T.gray400 }}>dari {fmtRp(p.basisNilai)}</div>
                    </div>
                    {log ? (
                      <button onClick={()=>batalkanPencairan(log)} title={`Dicairkan ${log.tanggal} — klik untuk batalkan`}
                        style={{ display:"flex", alignItems:"center", gap:4, padding:"5px 10px", borderRadius:99, border:"none",
                          background:T.greenLt, color:T.green, fontSize:11, fontWeight:700, fontFamily:"inherit", cursor:"pointer", flexShrink:0 }}>
                        <Icon.checklist size={12} strokeWidth={2.5} /> Dicairkan
                      </button>
                    ) : (
                      <Btn variant="secondary" size="sm" icon={Icon.landmark} onClick={()=>cairkanKeKas(p)} title="Catat pencairan ini sebagai Kas Keluar" />
                    )}
                    <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                      <Btn variant="secondary" size="sm" icon={Icon.edit} onClick={()=>{ setFormPihak({...p}); setModalPihak("edit"); }} />
                      <Btn variant="danger" size="sm" icon={Icon.delete} onClick={()=>hapusPihak(p.id)} />
                    </div>
                  </div>
                </div>
              );})}

              <div style={{ borderTop:`2px solid ${T.gray200}`, paddingTop:12, marginTop:4,
                display:"flex", justifyContent:"space-between", padding:"12px 14px",
                background:T.goldLt, borderRadius:10, border:`1px solid ${T.gold}44` }}>
                <span style={{ fontSize:13, fontWeight:700, color:T.gray800 }}>Total Distribusi</span>
                <span style={{ fontSize:16, fontWeight:900, color:T.gold }}>{fmtRp(akuntansi.totalDibagi)}</span>
              </div>

              {/* Sisa laba undistributed */}
              {akuntansi.labaBersihFinal - akuntansi.pihakList.filter(p=>p.basis==="laba").reduce((s,p)=>s+p.nominal,0) > 0 && (
                <div style={{ marginTop:8, padding:"8px 14px", background:T.gray50, borderRadius:8, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                  <span style={{ color:T.gray600 }}>Laba tersisa (belum dibagi)</span>
                  <span style={{ fontWeight:700, color:T.gray800 }}>
                    {fmtRp(akuntansi.labaBersihFinal - akuntansi.pihakList.filter(p=>p.basis==="laba").reduce((s,p)=>s+p.nominal,0))}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Detail Per Produk */}
      {showDetail && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14, display:"flex", alignItems:"center", gap:6 }}><Icon.produk size={16} strokeWidth={2} /> Kontribusi Per Produk — {PERIODE_LABELS[periodeMode]}</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                  {["Produk","Harga Jual","Terjual","Revenue","% dari Total","Kontribusi Laba"].map(h=>(
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {produkStats.map((p,i) => {
                  // ✅ Ikutkan Penjualan Luar Rute juga di sini — supaya jumlah
                  // baris per-produk konsisten/pas dengan baris TOTAL di bawah
                  // (yang sejak perbaikan sinkronisasi di atas sudah mencakup
                  // Luar Rute), bukan cuma dari kunjungan toko biasa saja.
                  const terjual = revPeriode.rows.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0)
                    + revPeriode.luarRows.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0);
                  const rev = terjual * (p.harga||0);
                  const pctDariTotal = akuntansi.pendapatan > 0 ? (rev/akuntansi.pendapatan*100).toFixed(1) : "0";
                  const labaKontribusi = rev * (akuntansi.marginPct/100);
                  return (
                    <tr key={p.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                      <td style={{ padding:"10px 14px", fontWeight:700 }}>{p.nama}</td>
                      <td style={{ padding:"10px 14px", color:T.gray600 }}>{fmtRp(p.harga||0)}</td>
                      <td style={{ padding:"10px 14px", fontWeight:700 }}>{fmt(terjual)} pcs</td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:T.green }}>{fmtRp(rev)}</td>
                      <td style={{ padding:"10px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:60, height:6, background:T.gray100, borderRadius:99, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pctDariTotal}%`, background:T.green, borderRadius:99 }} />
                          </div>
                          <span style={{ fontSize:12 }}>{pctDariTotal}%</span>
                        </div>
                      </td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:T.teal }}>{fmtRp(labaKontribusi)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:T.greenLt, borderTop:`2px solid ${T.green}` }}>
                  <td colSpan={2} style={{ padding:"10px 14px", fontWeight:700, fontSize:13 }}>TOTAL</td>
                  <td style={{ padding:"10px 14px", fontWeight:800 }}>{fmt(revPeriode.terjualTotal)} pcs</td>
                  <td style={{ padding:"10px 14px", fontWeight:800, color:T.green }}>{fmtRp(akuntansi.pendapatan)}</td>
                  <td style={{ padding:"10px 14px", fontWeight:700 }}>100%</td>
                  <td style={{ padding:"10px 14px", fontWeight:800, color:T.teal }}>{fmtRp(akuntansi.labaBersihFinal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Analisis Tren Bulanan — Line chart sederhana */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14, display:"flex", alignItems:"center", gap:6 }}><Icon.rekap size={16} strokeWidth={2} /> Tren Revenue & Laba (12 Bulan Terakhir)</div>
        {(() => {
          const months = [];
          const now = new Date();
          const produkArr = db.produk||[];
          for (let i=11; i>=0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            const key = d.toISOString().slice(0,7);
            const label = d.toLocaleDateString("id-ID", { month:"short", year:"2-digit" });
            const rows = kontrol.filter(k=>k.tanggal?.startsWith(key));
            const luarRows = (penjualanLuar||[]).filter(pl=>pl.tanggal?.startsWith(key));
            const rev = rows.reduce((s,k)=>s+k.totalRev,0) + luarRows.reduce((s,k)=>s+k.totalRev,0);
            const terjual = rows.reduce((s,k)=>s+(k.totalTerjual||0),0) + luarRows.reduce((s,k)=>s+(k.totalTerjual||0),0);
            // ✅ Konsisten dengan formula resmi di akuntansi (Metode HPP/Margin,
            // Beban Usaha, & Dana Cadangan) — bukan cuma rev×margin% seperti
            // sebelumnya. Beban Usaha & Amortisasi dianggap beban BULANAN yang
            // relatif tetap (approksimasi wajar untuk item rutin spt gaji),
            // Amortisasi dihitung ulang khusus utk bulan tsb (bisa beda tiap
            // bulan kalau ada aset baru/selesai umur di tengah jalan).
            const monthBounds = { start: `${key}-01`, end: `${key}-${String(new Date(d.getFullYear(),d.getMonth()+1,0).getDate()).padStart(2,"0")}` };
            const amortisasiBulan = hitungAmortisasiPeriode(db.asetAmortisasi||[], monthBounds).total;
            let labaKotorBulan, labaSblmCadangan;
            if (akuntansi.metodeHpp === "otomatis") {
              const hppBulan = hitungHppPeriode({ rows, luarRows }, produkArr).totalHpp;
              labaKotorBulan = rev - hppBulan;
              labaSblmCadangan = Math.max(labaKotorBulan - akuntansi.bebanUsahaTotal - amortisasiBulan, 0);
            } else {
              labaKotorBulan = rev - akuntansi.bebanUsahaTotal - amortisasiBulan;
              labaSblmCadangan = Math.max(labaKotorBulan * (akuntansi.marginPct/100), 0);
            }
            const cadanganBulan = hitungDanaCadanganPeriode(terjual, config.danaCadangan);
            const laba = Math.max(labaSblmCadangan - cadanganBulan, 0);
            months.push({ key, label, rev, laba });
          }
          const maxRev = Math.max(...months.map(m=>m.rev), 1);
          return (
            <div style={{ overflowX:"auto" }}>
              <div style={{ display:"flex", alignItems:"flex-end", gap:8, minWidth:600, height:120, padding:"0 4px" }}>
                {months.map((m,i)=>(
                  <div key={m.key} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                    <div style={{ fontSize:10, color:T.green, fontWeight:700 }}>
                      {m.rev > 0 ? fmtRp(m.rev).replace("Rp ","") : ""}
                    </div>
                    <div style={{ width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:80 }}>
                      <div style={{ flex:1, height:`${(m.rev/maxRev*100)||1}%`, background:T.green,
                        borderRadius:"4px 4px 0 0", transition:"height .5s", minHeight:3 }}
                        title={`Revenue: ${fmtRp(m.rev)}`} />
                      <div style={{ flex:1, height:`${(m.laba/maxRev*100)||1}%`, background:T.teal,
                        borderRadius:"4px 4px 0 0", transition:"height .5s", minHeight:3 }}
                        title={`Laba: ${fmtRp(m.laba)}`} />
                    </div>
                    <div style={{ fontSize:9, color:T.gray400, textAlign:"center", lineHeight:1.2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:16, marginTop:10, justifyContent:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:14, height:10, background:T.green, borderRadius:3 }} />
                  <span style={{ fontSize:11, color:T.gray600 }}>Revenue</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:14, height:10, background:T.teal, borderRadius:3 }} />
                  <span style={{ fontSize:11, color:T.gray600 }}>Laba Bersih</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Card>
      </>)}

      {activeSubTab === "neraca" && (
        <NeracaKeuangan
          db={db} save={save} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord}
          config={config} saveConfig={saveConfig} akuntansi={akuntansi} revPeriode={revPeriode}
          periodeMode={periodeMode} PERIODE_LABELS={PERIODE_LABELS} bounds={bounds} analytics={analytics}
        />
      )}

      {activeSubTab === "pajak" && (
        <LaporanPajak
          akuntansi={akuntansi} revPeriode={revPeriode} periodeMode={periodeMode}
          PERIODE_LABELS={PERIODE_LABELS} config={config} saveConfig={saveConfig}
          filterBulan={filterBulan} filterTahun={filterTahun}
        />
      )}

      {/* Modal Konfigurasi Bagi Hasil */}
      {editConfig && (
        <Modal title={<><Icon.settings size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Konfigurasi Bagi Hasil & Biaya</>} onClose={()=>setEditConfig(false)} width={520}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              <Icon.rekap size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Metode Hitung Laba Kotor
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {[
                { key:"manual", label:"Margin % (Asumsi)" },
                { key:"otomatis", label:"HPP Produk (Riil)" },
              ].map(m=>(
                <button key={m.key} onClick={()=>setCfgDraft(p=>({...p, metodeHpp:m.key}))}
                  style={{ flex:1, padding:"9px 12px", border:`1.5px solid ${(cfgDraft.metodeHpp||"manual")===m.key?T.green:T.gray200}`,
                    borderRadius:8, background:(cfgDraft.metodeHpp||"manual")===m.key?T.greenLt:T.white, cursor:"pointer",
                    fontFamily:"inherit", fontSize:12, fontWeight:700, color:(cfgDraft.metodeHpp||"manual")===m.key?T.green:T.gray600 }}>
                  {m.label}
                </button>
              ))}
            </div>
            {(cfgDraft.metodeHpp||"manual")==="manual" ? (
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Margin Laba Kotor (%)</label>
                  <input type="number" value={cfgDraft.marginLaba||70} min={0} max={100}
                    onChange={e=>setCfgDraft(p=>({...p, marginLaba:e.target.value}))}
                    style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                </div>
                <div style={{ flex:1, padding:"8px 12px", background:T.greenLt, borderRadius:8, fontSize:12 }}>
                  <div style={{ color:T.green, fontWeight:600 }}>Laba Kotor (asumsi):</div>
                  <div style={{ fontSize:16, fontWeight:800, color:T.green }}>
                    {fmtRp(revPeriode.rev * ((cfgDraft.marginLaba||70)/100))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding:"10px 14px", background: akuntansi.hppInfo.adaYangBelumIsi ? T.orangeLt : T.greenLt, borderRadius:8, fontSize:12, color:T.gray700 }}>
                {akuntansi.hppInfo.adaYangBelumIsi ? (
                  <><Icon.warning size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} />Ada produk terjual yang belum diisi <b>Harga Modal/HPP</b> di Master Produk — HPP-nya dihitung Rp0 sementara, jadi Laba Kotor bisa <b>terlalu tinggi</b>. Lengkapi dulu di tab Master Produk untuk hasil akurat.</>
                ) : (
                  <>Laba Kotor riil periode ini: <b>{fmtRp(akuntansi.hppInfo.labaKotorRiil)}</b> (dari HPP total {fmtRp(akuntansi.hppInfo.totalHpp)}). Diambil dari field Harga Modal di Master Produk.</>
                )}
              </div>
            )}
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:T.gray700 }}>
                <Icon.money size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Beban Usaha
              </div>
              <button onClick={tambahBebanUsaha} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:6,
                border:`1px solid ${T.green}`, background:T.greenLt, color:T.green, fontSize:11, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                <Icon.add size={12} strokeWidth={2.5} /> Tambah Item
              </button>
            </div>
            {(cfgDraft.bebanUsaha||[]).length === 0 ? (
              <div style={{ fontSize:12, color:T.gray400, padding:"10px 0" }}>Belum ada item. Klik "Tambah Item" — cth: Gaji Karyawan, Gaji Sales/Komisi, Sewa Tempat, Listrik, dll.</div>
            ) : (cfgDraft.bebanUsaha||[]).map(b=>(
              <div key={b.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
                <input value={b.nama} onChange={e=>updateBebanUsaha(b.id,"nama",e.target.value)} placeholder="Nama beban, cth: Gaji Karyawan"
                  style={{ flex:"1.4 1 0%", minWidth:0, padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", boxSizing:"border-box" }} />
                <input type="number" value={b.nominal} min={0} onChange={e=>updateBebanUsaha(b.id,"nominal",e.target.value)} placeholder="Rp"
                  style={{ flex:"1 1 0%", minWidth:0, padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", boxSizing:"border-box" }} />
                <button onClick={()=>hapusBebanUsaha(b.id)} title="Hapus item"
                  style={{ border:"none", background:T.redLt, color:T.red, borderRadius:6, width:28, height:28, display:"flex",
                    alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}>
                  <Icon.delete size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 4px", fontSize:12, fontWeight:700, color:T.gray700, borderTop:`1px solid ${T.gray100}`, marginTop:4 }}>
              <span>Total Beban Usaha (belum termasuk Amortisasi otomatis)</span>
              <span>{fmtRp((cfgDraft.bebanUsaha||[]).reduce((s,b)=>s+(Number(b.nominal)||0),0))}</span>
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <div style={{ fontSize:13, fontWeight:700, color:T.gray700 }}>
                <Icon.piggyBank size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Kewajiban Dana Cadangan (Opsional)
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                <input type="checkbox" checked={cfgDraft.danaCadangan?.aktif||false}
                  onChange={e=>setCfgDraft(p=>({...p, danaCadangan:{...(p.danaCadangan||{}), aktif:e.target.checked, rpPerPcs:p.danaCadangan?.rpPerPcs??500, keterangan:p.danaCadangan?.keterangan||"Dana Darurat Perusahaan"}}))} />
                <span style={{ fontSize:12, fontWeight:600, color:T.gray600 }}>Aktifkan</span>
              </label>
            </div>
            <div style={{ fontSize:11, color:T.gray400, marginBottom:10, borderBottom:`1px solid ${T.gray200}`, paddingBottom:10 }}>
              Kalau aktif, sekian Rupiah dari SETIAP PCS produk terjual otomatis disisihkan sebagai kewajiban/cadangan perusahaan SEBELUM sisa laba dibagi ke pihak — muncul juga sebagai baris Kewajiban di Laporan Neraca. Bersifat opsional karena kebijakan tiap perusahaan (white label) bisa berbeda.
            </div>
            {cfgDraft.danaCadangan?.aktif && (
              <>
                <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Rp per pcs terjual</label>
                    <input type="number" value={cfgDraft.danaCadangan?.rpPerPcs??500} min={0}
                      onChange={e=>setCfgDraft(p=>({...p, danaCadangan:{...p.danaCadangan, rpPerPcs:e.target.value}}))}
                      style={{ width:"100%", padding:"7px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Label / Keterangan</label>
                    <input value={cfgDraft.danaCadangan?.keterangan||""} onChange={e=>setCfgDraft(p=>({...p, danaCadangan:{...p.danaCadangan, keterangan:e.target.value}}))}
                      style={{ width:"100%", padding:"7px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                </div>
                <div style={{ padding:"8px 12px", background:T.goldLt, borderRadius:7, fontSize:12, color:T.gray700 }}>
                  Estimasi periode berjalan: {fmt(revPeriode.terjualTotal)} pcs × {fmtRp(Number(cfgDraft.danaCadangan?.rpPerPcs)||0)} = <b>{fmtRp(revPeriode.terjualTotal * (Number(cfgDraft.danaCadangan?.rpPerPcs)||0))}</b>
                </div>
              </>
            )}
          </div>
          <div style={{ marginBottom:4 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              <Icon.landmark size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Ekuitas (untuk ROE)
            </div>
            <div style={{ marginBottom:2 }}>
              <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Modal Disetor / Total Ekuitas (Rp)</label>
              <input type="number" value={cfgDraft.modalDisetor||0} min={0}
                onChange={e=>setCfgDraft(p=>({...p, modalDisetor:e.target.value}))}
                style={{ width:"100%", padding:"7px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
              <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>Total modal yang disetorkan Pemilik & Investor — dipakai sebagai pembagi di ROE (Return on Equity) pada tab Neraca Keuangan.</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setEditConfig(false)}>Batal</Btn>
            <Btn onClick={submitConfig} icon={Icon.save}>Simpan Konfigurasi</Btn>
          </div>
        </Modal>
      )}

      {/* Modal Tambah/Edit Pihak */}
      {modalPihak && (
        <Modal title={modalPihak==="add"?"Tambah Pihak Bagi Hasil":"Edit Pihak Bagi Hasil"} onClose={()=>setModalPihak(null)} width={440}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Nama Pihak *</label>
            <input value={formPihak.nama||""} onChange={e=>setFormPihak(p=>({...p,nama:e.target.value}))}
              placeholder="cth: Pemilik, Investor, Manajer..."
              style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Persentase (%)</label>
              <input type="number" value={formPihak.pct||0} min={0} max={100}
                onChange={e=>setFormPihak(p=>({...p,pct:e.target.value}))}
                style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Basis Perhitungan</label>
              <select value={formPihak.basis||"laba"} onChange={e=>setFormPihak(p=>({...p,basis:e.target.value}))}
                style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit" }}>
                <option value="laba">Dari Laba Bersih</option>
                <option value="revenue">Dari Total Revenue</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Keterangan</label>
            <input value={formPihak.keterangan||""} onChange={e=>setFormPihak(p=>({...p,keterangan:e.target.value}))}
              placeholder="cth: Return on investment, bonus kinerja..."
              style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Warna Identitas</label>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="color" value={formPihak.warna||"#4B5563"} onChange={e=>setFormPihak(p=>({...p,warna:e.target.value}))}
                style={{ width:40, height:36, border:"none", borderRadius:8, cursor:"pointer", padding:2 }} />
              <span style={{ fontSize:12, color:T.gray600 }}>Pilih warna untuk identifikasi visual pihak ini</span>
            </div>
          </div>
          {/* Preview nominal */}
          <div style={{ background:T.goldLt, borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:13 }}>
            <div style={{ color:T.gray600 }}>Preview nominal ({formPihak.pct}% dari {formPihak.basis==="laba"?"laba bersih":"revenue"}):</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.gold }}>
              {fmtRp((formPihak.basis==="laba" ? akuntansi.labaBersihFinal : akuntansi.pendapatan) * ((Number(formPihak.pct)||0)/100))}
            </div>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setModalPihak(null)}>Batal</Btn>
            <Btn onClick={submitPihak}>{modalPihak==="add"?"Tambah":"Simpan"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB PENGGUNA
// ─────────────────────────────────────────────
