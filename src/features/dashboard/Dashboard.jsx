import React from "react";
import { Badge, Card, ExportMenu, StatCard } from "../../components/ui";
import { useDB } from "../../hooks/useDB";
import { fmt, fmtRp } from "../../lib/format";
import { CATATAN_STATUS, T } from "../../theme/tokens";

export function MiniBar({ value, max, color }) {
  const pct = max>0 ? Math.round((value/max)*100) : 0;
  return (
    <div style={{ position:"relative", height:6, background:T.gray100, borderRadius:99, overflow:"hidden", flex:1 }}>
      <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${pct}%`,
        background:color, borderRadius:99, transition:"width .5s" }} />
    </div>
  );
}

export function Dashboard({ db, analytics, salesWilayahId }) {
  const isSalesRestricted = !!salesWilayahId;
  // Filter analytics data berdasarkan wilayah Sales (jika berlaku)
  const { totalRev: allRev, labaBersih: allLaba, marginPctGlobal, produkStats, bagiHasil } = analytics;
  const perWilayahAll = analytics.perWilayah;
  const perRuteAll = analytics.perRute;

  const perWilayah = isSalesRestricted
    ? perWilayahAll.filter(w => w.id === salesWilayahId)
    : perWilayahAll;
  const perRute = isSalesRestricted
    ? perRuteAll.filter(r => {
        const w = (db.wilayah||[]).find(ww=>ww.id===r.wilayahId);
        return r.wilayahId === salesWilayahId;
      })
    : perRuteAll;

  // Hitung ulang total hanya untuk wilayah yang tampil
  const totalRev = isSalesRestricted ? perWilayah.reduce((s,w)=>s+w.rev,0) : allRev;
  const labaBersih = totalRev * (marginPctGlobal/100);
  const tokoAktif = isSalesRestricted
    ? (db.toko||[]).filter(t => {
        if (t.status !== "Aktif") return false;
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId;
      }).length
    : analytics.tokoAktif;
  // ✅ Total toko & jumlah rute juga di-scope ke wilayah Sales — sebelumnya
  // masih menampilkan angka GLOBAL (semua wilayah) meski pembilangnya
  // (toko aktif) sudah benar di-scope, sehingga rasio yang tampil (mis.
  // "1 dari 3815") jadi tidak konsisten/membingungkan untuk Sales.
  const tokoTotalScoped = isSalesRestricted
    ? (db.toko||[]).filter(t => {
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId;
      }).length
    : (db.toko||[]).length;
  const ruteTotalScoped = isSalesRestricted
    ? (db.rute||[]).filter(r=>r.wilayahId===salesWilayahId).length
    : (db.rute||[]).length;
  const maxRev = Math.max(...perWilayah.map(w=>w.rev),1);

  // ✅ FIX SINKRONISASI: StatCard "Total Pendapatan" sebelumnya diberi
  // caption statis "bulan ini", padahal `totalRev` di atas menjumlahkan
  // SELURUH data `kontrol` yang sedang termuat di aplikasi (tanpa filter
  // tanggal apa pun) — bukan cuma bulan berjalan. Ini penting karena data
  // "kontrol" dipartisi per-tahun di Firebase dan hanya 1 tahun terbaru
  // yang otomatis dimuat (lihat KONTROL_LIVE_YEARS di useDB); kalau admin
  // memuat tahun-tahun lama secara manual, angka ini otomatis mencakup
  // beberapa tahun sekaligus. Caption sekarang dihitung DINAMIS dari
  // rentang tahun yang benar-benar ada di data kontrol yang sedang
  // disumbangkan ke totalRev, supaya selalu sesuai apa pun cakupannya.
  const kontrolUntukRentang = isSalesRestricted
    ? analytics.kontrol.filter(k => k.wilayahId === salesWilayahId)
    : analytics.kontrol;
  const tahunKontrolTermuat = [...new Set(
    kontrolUntukRentang.map(k => k.tanggal?.slice(0,4)).filter(Boolean)
  )].sort();
  const totalPendapatanSub = tahunKontrolTermuat.length === 0
    ? "belum ada data"
    : tahunKontrolTermuat.length === 1
      ? `akumulasi tahun ${tahunKontrolTermuat[0]}`
      : `akumulasi ${tahunKontrolTermuat[0]}–${tahunKontrolTermuat[tahunKontrolTermuat.length-1]}`;

  // ✅ Ekspor Dashboard — tiga kolom (Kategori, Metrik, Nilai) agar lebih rapi & terkelompok
  const _totalBonus = analytics.kontrol.reduce((s,k)=>s+(k.totalBonus||0),0);
  const dashboardExportRows = [
    // ── Keuangan ──
    { kategori:"💰 KEUANGAN",      metrik:"Total Revenue",          nilai:fmtRp(totalRev) },
    { kategori:"",                  metrik:`Laba Bersih Est. (${marginPctGlobal}%)`, nilai:fmtRp(labaBersih) },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Master Data ──
    { kategori:"🏪 MASTER DATA",   metrik:"Toko Aktif",             nilai:`${tokoAktif} dari ${tokoTotalScoped}` },
    { kategori:"",                  metrik:"Total Wilayah",          nilai:isSalesRestricted ? 1 : (db.wilayah||[]).length },
    { kategori:"",                  metrik:"Total Rute",             nilai:ruteTotalScoped },
    { kategori:"",                  metrik:"Total Produk Aktif",     nilai:(db.produk||[]).filter(p=>p.aktif!==false).length },
    { kategori:"",                  metrik:"Pengguna Terdaftar",     nilai:(db.pengguna||[]).length },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Aktivitas ──
    { kategori:"📋 AKTIVITAS",     metrik:"Entri Kontrol",          nilai:(db.kontrol||[]).length },
    { kategori:"",                  metrik:"Total Bonus (pcs)",      nilai:fmt(_totalBonus) },
    { kategori:"",                  metrik:"",                       nilai:"" },
    // ── Revenue per Wilayah ──
    { kategori:"📍 REVENUE / WILAYAH", metrik:"",                   nilai:"" },
    ...perWilayah.map(w => ({ kategori:"", metrik:w.nama||w.id,     nilai:fmtRp(w.rev) })),
    { kategori:"",                  metrik:"",                       nilai:"" },
    { kategori:"",                  metrik:"TOTAL REVENUE",          nilai:fmtRp(totalRev) },
  ];
  const dashboardExportCols = [
    { key:"kategori", label:"Kategori" },
    { key:"metrik",   label:"Metrik" },
    { key:"nilai",    label:"Nilai" },
  ];

  return (
    <div>
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:10,
          padding:"10px 16px", marginBottom:14, fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8, fontWeight:600 }}>
          🔒 Dashboard ini menampilkan data wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📈 Dashboard</div>
        <ExportMenu data={dashboardExportRows} columns={dashboardExportCols} title="Dashboard Ringkasan" filename="dashboard_summary" />
      </div>
      <div style={{ fontSize:12, color:T.gray400, marginBottom:20 }}>Data real-time dari semua master data & kontrol bulanan</div>

      <div className="gw-dash-stats" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12, marginBottom:20 }}>
        <StatCard label="Toko Aktif"      value={tokoAktif}            sub={`dari ${tokoTotalScoped} total`} icon="🏪" color={T.green} />
        <StatCard label="Total Wilayah"   value={isSalesRestricted ? 1 : (db.wilayah||[]).length} sub={`${ruteTotalScoped} rute`}   icon="📍" color={T.teal} />
        <StatCard label="Total Pendapatan" value={fmtRp(totalRev)}      sub={totalPendapatanSub}                 icon="💰" color={T.gold} />
        <StatCard label="Laba Bersih Est." value={fmtRp(labaBersih)}    sub={`${marginPctGlobal}% margin · ${totalPendapatanSub}`} icon="📊" color={T.green} />
        <StatCard label="Total Produk"    value={(db.produk||[]).filter(p=>p.aktif!==false).length+" produk"} sub="aktif" icon="🧴" color={T.purple} />
        <StatCard label="Entri Kontrol"   value={(db.kontrol||[]).length} sub="total transaksi"                  icon="📋" color={T.blue} />
        <StatCard label="Total Bonus"     value={`${fmt(analytics.kontrol.reduce((s,k)=>s+(k.totalBonus||0),0))} pcs`} sub="diberikan ke toko" icon="🎁" color={T.orange} />
        <StatCard label="Pengguna"        value={(db.pengguna||[]).length} sub="terdaftar"                       icon="👤" color={T.gray600} />
      </div>

      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📍 Revenue per Wilayah</div>
          {perWilayah.length===0 && <div style={{ color:T.gray400, fontSize:12 }}>Belum ada data</div>}
          {perWilayah.map(w => (
            <div key={w.id} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <span style={{ fontSize:13, fontWeight:600, color:T.gray800 }}>{w.nama}</span>
                <span style={{ fontSize:12, color:T.green, fontWeight:700 }}>{fmtRp(w.rev)}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <MiniBar value={w.rev} max={maxRev} color={T.green} />
                <span style={{ fontSize:11, color:T.gray400, minWidth:60, textAlign:"right" }}>{w.tokoCount} toko</span>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🧴 Performa Produk</div>
          {produkStats.length===0 && <div style={{ color:T.gray400, fontSize:12 }}>Belum ada data produk</div>}
          {produkStats.map((p, i) => {
            const maxP = Math.max(...produkStats.map(x=>x.terjual),1);
            const COLORS = [T.green,T.blue,T.orange,T.purple,T.teal,T.red,T.gold];
            const color = COLORS[i % COLORS.length];
            return (
              <div key={p.id} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{p.nama}</span>
                  <span style={{ fontSize:12, fontWeight:700, color }}>{fmt(p.terjual)} pcs</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <MiniBar value={p.terjual} max={maxP} color={color} />
                  <span style={{ fontSize:11, color:T.gray400, minWidth:80, textAlign:"right" }}>{fmtRp(p.rev)}</span>
                </div>
                {p.bonus>0 && (
                  <div style={{ fontSize:11, color:T.gold, marginTop:2 }}>
                    Bonus default: {p.bonus} pcs/kunjungan
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </div>

      <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>🛣️ Rute Aktif</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`2px solid ${T.gray200}` }}>
                {["Rute","Wilayah","Toko","Pcs Terjual","Revenue"].map(h=>(
                  <th key={h} style={{ padding:"6px 8px", textAlign:"left", color:T.gray600, fontWeight:700, fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perRute.length===0 ? (
                <tr><td colSpan={5} style={{ padding:16, textAlign:"center", color:T.gray400 }}>Belum ada rute</td></tr>
              ) : perRute.map((r,i)=>(
                <tr key={r.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                  <td style={{ padding:"7px 8px", fontWeight:600 }}>
                    {r.nama}
                    {r.luarRuteCount>0 && (
                      <span title={`${r.luarRuteCount} penjualan luar rute ikut dihitung di rute ini`}
                        style={{ marginLeft:5, fontSize:10, color:T.purple }}>🛣️×{r.luarRuteCount}</span>
                    )}
                  </td>
                  <td style={{ padding:"7px 8px" }}><Badge color={T.teal}>{r.wilayahNama}</Badge></td>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}>{r.tokoCount}</td>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}>{fmt(r.terjual)}</td>
                  <td style={{ padding:"7px 8px", fontWeight:700, color:T.green }}>{fmtRp(r.rev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {!isSalesRestricted && (
          <Card>
            <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:4 }}>💰 Simulasi Bagi Hasil</div>
            <div style={{ fontSize:11, color:T.gray400, marginBottom:14 }}>Asumsi margin laba bersih {marginPctGlobal}% dari pendapatan · ikut konfigurasi Tab Bagi Hasil</div>
            {bagiHasil.map((b,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 12px", borderRadius:8, marginBottom:8, background:i===0?T.greenLt:T.gray50 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.gray800 }}>{b.nama}</div>
                  <div style={{ fontSize:11, color:T.gray400 }}>{b.tipe==="Laba"?"Dari laba bersih":"Dari pendapatan"} · {(b.pct*100).toFixed(0)}%</div>
                </div>
                <div style={{ fontSize:15, fontWeight:800, color:i===0?T.green:T.gray800 }}>{fmtRp(b.nominal)}</div>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${T.gray200}`, paddingTop:10, marginTop:4, display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:T.gray600, fontWeight:600 }}>Laba Bersih Estimasi</span>
              <span style={{ fontSize:14, fontWeight:800, color:T.gold }}>{fmtRp(labaBersih)}</span>
            </div>
          </Card>
        )}
      </div>

      {/* Kontrol Terbaru */}
      <Card>
        <div style={{ fontSize:14, fontWeight:700, color:T.gray800, marginBottom:14 }}>📋 Data Kontrol Terbaru</div>
        {(() => {
          // ✅ Di-scope ke wilayah Sales — sebelumnya menampilkan kontrol
          // terbaru dari SEMUA wilayah, bukan cuma wilayah Sales sendiri.
          const kontrolScoped = isSalesRestricted
            ? analytics.kontrol.filter(k=>k.wilayahId===salesWilayahId)
            : analytics.kontrol;
          return kontrolScoped.length===0 ? (
          <div style={{ textAlign:"center", color:T.gray400, padding:20 }}>Belum ada data kontrol</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                  {["Toko","Wilayah","Tanggal","Revenue","Status"].map(h=>(
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kontrolScoped.slice()
                  // ✅ Diurutkan berdasarkan TANGGAL sungguhan (turun/terbaru
                  // dulu), bukan cuma dibalik urutan array — sebelumnya
                  // reverse() saja bisa salah tampil kalau urutan data di
                  // database tidak kebetulan sama dengan urutan tanggal.
                  .sort((a,b) => (b.tanggal||"").localeCompare(a.tanggal||"") || (b.id||"").localeCompare(a.id||""))
                  .slice(0,8).map((k,i)=>{
                  const cs = CATATAN_STATUS[k.catatanStatus]||CATATAN_STATUS.manual;
                  return (
                    <tr key={k.id} style={{ borderBottom:`1px solid ${T.gray100}`, background:i%2===0?T.white:T.gray50 }}>
                      <td style={{ padding:"10px 14px" }}><b>{k.tokoNama}</b></td>
                      <td style={{ padding:"10px 14px" }}><Badge color={T.green}>{k.wilayahNama}</Badge></td>
                      <td style={{ padding:"10px 14px" }}>{k.tanggal}</td>
                      <td style={{ padding:"10px 14px" }}><b style={{ color:T.green }}>{fmtRp(k.totalRev)}</b></td>
                      <td style={{ padding:"10px 14px" }}><Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        })()}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB REKAP — Harian/Bulanan/Kuartal/Tahunan
// ─────────────────────────────────────────────
