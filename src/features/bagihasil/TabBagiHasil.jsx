import React, { useMemo, useState } from "react";
import { Btn, Card, Modal, StatCard } from "../../components/ui";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { useAnalytics } from "../../hooks/useAnalytics";
import { exportExcel } from "../../lib/exportUtils";
import { fmt, fmtRp } from "../../lib/format";
import { T } from "../../theme/tokens";

export function TabBagiHasil({ db, analytics, save }) {
  const { totalRev, labaBersih, produkStats, kontrol, penjualanLuar } = analytics;

  // State untuk konfigurasi bagi hasil (tersimpan di db.bagiHasilConfig)
  const config = db.bagiHasilConfig || {
    marginLaba: 70, // % margin laba bersih dari pendapatan
    biayaOperasional: 0,
    biayaBonus: 0,
    biayaLogistik: 0,
    biayaLainnya: 0,
    pihak: [
      { id:"BH001", nama:"Pemilik Utama",  pct: 60, basis:"laba",    warna:"#0F4C35", keterangan:"Keuntungan inti bisnis" },
      { id:"BH002", nama:"Investor A",     pct: 20, basis:"revenue", warna:"#1D4ED8", keterangan:"Return on investment" },
      { id:"BH003", nama:"Manajer Ops",    pct: 10, basis:"laba",    warna:"#7C3AED", keterangan:"Bonus kinerja operasional" },
      { id:"BH004", nama:"Karyawan Pool",  pct: 10, basis:"laba",    warna:"#D97706", keterangan:"Insentif tim sales" },
    ],
  };

  const [editConfig, setEditConfig] = useState(false);
  const [cfgDraft, setCfgDraft] = useState(config);
  const [filterBulan, setFilterBulan] = useState(() => new Date().toISOString().slice(0,7));
  const [filterTahun, setFilterTahun] = useState(() => String(new Date().getFullYear()));
  const [periodeMode, setPeriodeMode] = useState("bulanan"); // bulanan | tahunan | kustom
  const [filterStart, setFilterStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
  const [filterEnd, setFilterEnd] = useState(() => new Date().toISOString().slice(0,10));
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


  // Kalkulasi akuntansi lengkap
  const akuntansi = useMemo(() => {
    const pendapatan = revPeriode.rev;
    const biayaOps = Number(config.biayaOperasional)||0;
    const biayaBonus = Number(config.biayaBonus)||0;
    const biayaLogistik = Number(config.biayaLogistik)||0;
    const biayaLain = Number(config.biayaLainnya)||0;
    const totalBiaya = biayaOps + biayaBonus + biayaLogistik + biayaLain;
    const labaKotor = pendapatan - totalBiaya;
    const marginPct = Number(config.marginLaba)||70;
    // ✅ Laba Bersih sekarang dihitung dari Laba Kotor (Pendapatan − semua
    // Biaya) dikali Margin%, BUKAN langsung dari Pendapatan. Sebelumnya,
    // biaya yang diisi (Operasional/Bonus/Logistik/Lainnya) cuma tampil di
    // baris "Laba Kotor" tapi tidak ikut mengurangi Laba Bersih yang benar-
    // benar dibagi ke semua pihak — jadi mengisi biaya tidak berpengaruh
    // sama sekali ke hasil bagi hasil. Sekarang biaya benar-benar mengurangi
    // apa yang dibagi.
    const labaBersihFinal = Math.max(labaKotor * (marginPct/100), 0);

    const pihakList = (config.pihak||[]).map(p => {
      const basis = p.basis === "laba" ? labaBersihFinal : pendapatan;
      const nominal = basis * (p.pct / 100);
      return { ...p, nominal, basisNilai: basis };
    });
    const totalDibagi = pihakList.reduce((s,p)=>s+p.nominal, 0);

    return {
      pendapatan, biayaOps, biayaBonus, biayaLogistik, biayaLain, totalBiaya,
      labaKotor, labaBersihFinal,
      pihakList, totalDibagi,
      marginPct,
    };
  }, [revPeriode.rev, config]);

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
      { keterangan:"=== BIAYA ===", nilai:"" },
      { keterangan:"Biaya Operasional", nilai: fmtRp(akuntansi.biayaOps) },
      { keterangan:"Biaya Bonus Produk", nilai: fmtRp(akuntansi.biayaBonus) },
      { keterangan:"Biaya Logistik", nilai: fmtRp(akuntansi.biayaLogistik) },
      { keterangan:"Biaya Lainnya", nilai: fmtRp(akuntansi.biayaLain) },
      { keterangan:"TOTAL BIAYA", nilai: fmtRp(akuntansi.totalBiaya) },
      { keterangan:"Laba Kotor", nilai: fmtRp(akuntansi.labaKotor) },
      { keterangan:"", nilai:"" },
      { keterangan:"=== LABA BERSIH ===", nilai:"" },
      { keterangan:`Laba Bersih (${akuntansi.marginPct}% dari Laba Kotor)`, nilai: fmtRp(akuntansi.labaBersihFinal) },
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
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>💰 Simulasi Bagi Hasil & Akuntansi</div>
          <div style={{ fontSize:12, color:T.gray400 }}>Laporan keuangan & distribusi profit sesuai skema akuntansi</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Btn variant="secondary" size="sm" icon="⚙️" onClick={()=>{ setCfgDraft(config); setEditConfig(true); }}>Konfigurasi</Btn>
          <Btn variant="secondary" size="sm" icon="📊" onClick={exportLaporanBagiHasil}>Ekspor Excel</Btn>
          <Btn variant="secondary" size="sm" icon={showDetail?"🔼":"🔽"} onClick={()=>setShowDetail(v=>!v)}>
            {showDetail?"Sembunyikan Detail":"Lihat Detail Produk"}
          </Btn>
        </div>
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
                  {m==="bulanan"?"📅 Bulanan":m==="tahunan"?"📆 Tahunan":"📌 Kustom"}
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

      {/* Ringkasan Kinerja Periode */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
        <StatCard label="Total Revenue" value={fmtRp(akuntansi.pendapatan)} icon="💵" color={T.green} sub={PERIODE_LABELS[periodeMode]} />
        <StatCard label="Laba Bersih" value={fmtRp(akuntansi.labaBersihFinal)} icon="📈" color={T.teal} sub={`${akuntansi.marginPct}% dari Laba Kotor`} />
        <StatCard label="Total Biaya" value={fmtRp(akuntansi.totalBiaya)} icon="📉" color={T.red} sub="semua kategori" />
        <StatCard label="Produk Terjual" value={fmt(revPeriode.terjualTotal)+" pcs"} icon="🧴" color={T.purple} sub={`${revPeriode.kunjunganTotal} kunjungan`} />
        <StatCard label="Toko Dikunjungi" value={revPeriode.tokoUnik} icon="🏪" color={T.blue} sub="toko unik" />
        <StatCard label="Total Dibagi" value={fmtRp(akuntansi.totalDibagi)} icon="🤝" color={T.gold} sub={`${(config.pihak||[]).length} pihak`} />
      </div>

      {/* Laporan Laba Rugi */}
      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:800, color:T.gray800, marginBottom:16, borderBottom:`2px solid ${T.green}`, paddingBottom:10 }}>
            📋 Laporan Laba Rugi — {PERIODE_LABELS[periodeMode]}
          </div>

          {/* Pendapatan */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>I. Pendapatan</div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.greenLt, borderRadius:7 }}>
              <span style={{ fontSize:13 }}>Pendapatan Konsinyasi</span>
              <span style={{ fontWeight:700, color:T.green }}>{fmtRp(akuntansi.pendapatan)}</span>
            </div>
          </div>

          {/* Biaya */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.gray600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>II. Beban Usaha</div>
            {[
              { label:"Biaya Operasional", val: akuntansi.biayaOps },
              { label:"Biaya Bonus Produk", val: akuntansi.biayaBonus },
              { label:"Biaya Logistik/Distribusi", val: akuntansi.biayaLogistik },
              { label:"Biaya Lainnya", val: akuntansi.biayaLain },
            ].map((b,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px",
                borderBottom: i<3 ? `1px solid ${T.gray100}` : "none" }}>
                <span style={{ fontSize:13, color:T.gray600 }}>{b.label}</span>
                <span style={{ fontSize:13, color:T.red }}>({fmtRp(b.val)})</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.redLt, borderRadius:7, marginTop:6 }}>
              <span style={{ fontSize:13, fontWeight:700 }}>Total Beban</span>
              <span style={{ fontWeight:700, color:T.red }}>({fmtRp(akuntansi.totalBiaya)})</span>
            </div>
          </div>

          {/* Laba */}
          <div style={{ borderTop:`2px solid ${T.gray200}`, paddingTop:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:T.gray50, borderRadius:7, marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>Laba Kotor</span>
              <span style={{ fontWeight:700 }}>{fmtRp(akuntansi.labaKotor)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", marginBottom:4 }}>
              <span style={{ fontSize:13, color:T.gray600 }}>Penyesuaian Margin ({akuntansi.marginPct}%)</span>
              <span style={{ fontSize:13, color:T.gray600 }}>{fmtRp(akuntansi.labaBersihFinal)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 16px",
              background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`,
              borderRadius:10, marginTop:8 }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#fff" }}>💰 LABA BERSIH</span>
              <span style={{ fontSize:16, fontWeight:900, color:"#fff" }}>{fmtRp(akuntansi.labaBersihFinal)}</span>
            </div>
          </div>
        </Card>

        {/* Distribusi Bagi Hasil */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, borderBottom:`2px solid ${T.gold}`, paddingBottom:10 }}>
            <div style={{ fontSize:14, fontWeight:800, color:T.gray800 }}>🤝 Distribusi Bagi Hasil</div>
            <Btn size="sm" icon="＋" variant="gold" onClick={tambahPihak}>Tambah Pihak</Btn>
          </div>

          {/* Validasi total pct */}
          {(totalPctLaba > 100 || totalPctRev > 100) && (
            <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:12, color:T.red }}>
              ⚠️ Total persentase dari {totalPctLaba>100?"laba":"revenue"} melebihi 100% ({totalPctLaba>100?totalPctLaba:totalPctRev}%). Harap periksa konfigurasi.
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

              {akuntansi.pihakList.map((p,i)=>(
                <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", borderRadius:10, marginBottom:10,
                  background:p.warna+"12", border:`1.5px solid ${p.warna}30` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:p.warna, flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:T.gray800 }}>{p.nama}</div>
                      <div style={{ fontSize:11, color:T.gray400 }}>
                        {p.pct}% dari {p.basis==="laba"?"laba bersih":"revenue"} · {p.keterangan}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:15, fontWeight:800, color:p.warna }}>{fmtRp(p.nominal)}</div>
                      <div style={{ fontSize:10, color:T.gray400 }}>dari {fmtRp(p.basisNilai)}</div>
                    </div>
                    <div style={{ display:"flex", gap:4 }}>
                      <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>{ setFormPihak({...p}); setModalPihak("edit"); }} />
                      <Btn variant="danger" size="sm" icon="🗑" onClick={()=>hapusPihak(p.id)} />
                    </div>
                  </div>
                </div>
              ))}

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
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🧴 Kontribusi Per Produk — {PERIODE_LABELS[periodeMode]}</div>
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
        <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📊 Tren Revenue & Laba (12 Bulan Terakhir)</div>
        {(() => {
          const months = [];
          const now = new Date();
          for (let i=11; i>=0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            const key = d.toISOString().slice(0,7);
            const label = d.toLocaleDateString("id-ID", { month:"short", year:"2-digit" });
            const rows = kontrol.filter(k=>k.tanggal?.startsWith(key));
            const rev = rows.reduce((s,k)=>s+k.totalRev,0);
            months.push({ key, label, rev, laba: rev*(akuntansi.marginPct/100) });
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

      {/* Modal Konfigurasi Bagi Hasil */}
      {editConfig && (
        <Modal title="⚙️ Konfigurasi Bagi Hasil & Biaya" onClose={()=>setEditConfig(false)} width={520}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              📊 Asumsi Margin Laba
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>Margin Laba Bersih (%)</label>
                <input type="number" value={cfgDraft.marginLaba||70} min={0} max={100}
                  onChange={e=>setCfgDraft(p=>({...p, marginLaba:e.target.value}))}
                  style={{ width:"100%", padding:"8px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
              </div>
              <div style={{ flex:1, padding:"8px 12px", background:T.greenLt, borderRadius:8, fontSize:12 }}>
                <div style={{ color:T.green, fontWeight:600 }}>Laba dari Revenue:</div>
                <div style={{ fontSize:16, fontWeight:800, color:T.green }}>
                  {fmtRp(revPeriode.rev * ((cfgDraft.marginLaba||70)/100))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.gray700, marginBottom:12, borderBottom:`1px solid ${T.gray200}`, paddingBottom:8 }}>
              💸 Beban Usaha (Nominal Tetap)
            </div>
            {[
              { key:"biayaOperasional", label:"Biaya Operasional (Rp)" },
              { key:"biayaBonus",       label:"Biaya Bonus Produk (Rp)" },
              { key:"biayaLogistik",    label:"Biaya Logistik/Distribusi (Rp)" },
              { key:"biayaLainnya",     label:"Biaya Lainnya (Rp)" },
            ].map(b=>(
              <div key={b.key} style={{ marginBottom:10 }}>
                <label style={{ fontSize:12, fontWeight:600, color:T.gray600, display:"block", marginBottom:4 }}>{b.label}</label>
                <input type="number" value={cfgDraft[b.key]||0} min={0}
                  onChange={e=>setCfgDraft(p=>({...p, [b.key]:e.target.value}))}
                  style={{ width:"100%", padding:"7px 12px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setEditConfig(false)}>Batal</Btn>
            <Btn onClick={submitConfig}>💾 Simpan Konfigurasi</Btn>
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
