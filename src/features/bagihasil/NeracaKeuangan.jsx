import React, { useMemo, useState } from "react";
import { Btn, Card, Modal, StatCard, Table } from "../../components/ui";
import { fmt, fmtRp, genUniqueId } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";
import {
  hitungSaldoKas, hitungStokSistem, hitungAmortisasiPeriode, statusAsetSaatIni,
  KATEGORI_KAS_MASUK, KATEGORI_KAS_KELUAR, KATEGORI_ASET,
} from "../../lib/neracaHelpers";

const todayStr = () => new Date().toISOString().slice(0, 10);

export function NeracaKeuangan({ db, save, addRecord, updateRecord, deleteRecord, config, saveConfig, akuntansi, revPeriode, periodeMode, PERIODE_LABELS, bounds }) {
  const [section, setSection] = useState("ringkasan"); // ringkasan | kas | stok | amortisasi

  const produkArr = db.produk || [];
  const tokoArr = db.toko || [];
  const kasArr = db.kasTransaksi || [];
  const stockOpnameArr = db.stockOpname || [];
  const asetArr = db.asetAmortisasi || [];

  // ── Rasio Keuangan ──────────────────────────────────────────────
  const bopoPct = akuntansi.pendapatan > 0 ? (akuntansi.totalBiaya / akuntansi.pendapatan) * 100 : 0;
  const modalDisetor = Number(config.modalDisetor) || 0;
  const roePeriodePct = modalDisetor > 0 ? (akuntansi.labaBersihFinal / modalDisetor) * 100 : null;
  const roeSetahunPct = roePeriodePct !== null && periodeMode === "bulanan" ? roePeriodePct * 12 : null;

  // ── Kas ──────────────────────────────────────────────────────────
  const kasLedgerTerkini = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, null), [kasArr, config.kasSaldoAwal]);
  const kasLedgerPeriode = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, bounds?.end), [kasArr, config.kasSaldoAwal, bounds]);
  const kasRowsDesc = useMemo(() => [...kasLedgerTerkini.rows].reverse(), [kasLedgerTerkini]);
  const [kasForm, setKasForm] = useState(null); // null=tertutup, {} object=form terbuka
  const [opnameFisik, setOpnameFisik] = useState(() => config.kasOpname?.saldoFisik ?? "");
  const [opnameKet, setOpnameKet] = useState(() => config.kasOpname?.keterangan ?? "");
  const selisihKas = opnameFisik === "" ? null : (Number(opnameFisik) || 0) - kasLedgerTerkini.saldoAkhir;

  function submitKas() {
    if (!kasForm.tanggal || !kasForm.kategori || !Number(kasForm.nominal)) return alert("Tanggal, kategori, & nominal wajib diisi");
    const rec = { ...kasForm, nominal: Number(kasForm.nominal) };
    if (kasForm.id) updateRecord("kasTransaksi", kasForm.id, rec);
    else addRecord("kasTransaksi", { ...rec, id: genUniqueId("KAS") });
    setKasForm(null);
  }
  function simpanOpnameKas() {
    saveConfig({ ...config, kasOpname: { saldoFisik: Number(opnameFisik) || 0, keterangan: opnameKet, tanggal: todayStr() } });
  }

  // ── Stock Opname ─────────────────────────────────────────────────
  const stokSistemMap = useMemo(() => hitungStokSistem(tokoArr, produkArr), [tokoArr, produkArr]);
  const [opnameStokForm, setOpnameStokForm] = useState(null); // null=tertutup, {} = terbuka
  const [detailOpnameStok, setDetailOpnameStok] = useState(null);

  function bukaOpnameStokBaru() {
    const items = produkArr.filter(p => p.aktif !== false).map(p => ({
      produkId: p.id, nama: p.nama, stokSistem: stokSistemMap[p.id] || 0, stokFisik: stokSistemMap[p.id] || 0,
    }));
    setOpnameStokForm({ tanggal: todayStr(), keterangan: "", items });
  }
  function submitOpnameStok() {
    const items = opnameStokForm.items.map(it => ({ ...it, stokFisik: Number(it.stokFisik) || 0 }));
    const totalSelisihPcs = items.reduce((s, it) => s + (it.stokFisik - it.stokSistem), 0);
    const totalSelisihRp = items.reduce((s, it) => {
      const p = produkArr.find(pp => pp.id === it.produkId);
      return s + (it.stokFisik - it.stokSistem) * (p?.harga || 0);
    }, 0);
    addRecord("stockOpname", { id: genUniqueId("SO"), tanggal: opnameStokForm.tanggal, keterangan: opnameStokForm.keterangan, items, totalSelisihPcs, totalSelisihRp });
    setOpnameStokForm(null);
  }

  // ── Amortisasi ───────────────────────────────────────────────────
  const [asetForm, setAsetForm] = useState(null);
  const amortisasiPeriode = useMemo(() => hitungAmortisasiPeriode(asetArr, bounds), [asetArr, bounds]);
  function submitAset() {
    if (!asetForm.nama || !Number(asetForm.nilaiPerolehan) || !Number(asetForm.umurBulan) || !asetForm.tanggalPerolehan)
      return alert("Nama, Nilai Perolehan, Umur Ekonomis, & Tanggal Perolehan wajib diisi");
    const rec = { ...asetForm, nilaiPerolehan: Number(asetForm.nilaiPerolehan), nilaiResidu: Number(asetForm.nilaiResidu) || 0, umurBulan: Number(asetForm.umurBulan) };
    if (asetForm.id) updateRecord("asetAmortisasi", asetForm.id, rec);
    else addRecord("asetAmortisasi", { ...rec, id: genUniqueId("AST") });
    setAsetForm(null);
  }

  const SECTIONS = [
    { key: "ringkasan", label: "Ringkasan Rasio", icon: Icon.scale },
    { key: "kas", label: "Kas Opname", icon: Icon.landmark },
    { key: "stok", label: "Stock Opname", icon: Icon.boxes },
    { key: "amortisasi", label: "Amortisasi Aset", icon: Icon.calculator },
  ];

  return (
    <div>
      {/* Sub-sub-navigasi */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
              border: `1.5px solid ${section === s.key ? T.green : T.gray200}`, borderRadius: 99,
              background: section === s.key ? T.greenLt : T.white, cursor: "pointer", fontFamily: "inherit",
              fontSize: 12, fontWeight: 700, color: section === s.key ? T.green : T.gray600 }}>
            <s.icon size={14} strokeWidth={2} /> {s.label}
          </button>
        ))}
      </div>

      {section === "ringkasan" && (
        <>
          <div style={{ fontSize: 12, color: T.gray400, marginBottom: 10 }}>
            Rasio & indikator keuangan untuk periode <b>{PERIODE_LABELS[periodeMode]}</b>. Biaya Amortisasi otomatis diambil dari daftar Aset (tab Amortisasi) dan sudah termasuk di Laporan Laba Rugi.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="BOPO" value={`${bopoPct.toFixed(1)}%`} icon={Icon.percent} color={bopoPct > 80 ? T.red : T.orange} sub="Biaya Operasional / Pendapatan" />
            <StatCard label="SHU / Laba Bersih" value={fmtRp(akuntansi.labaBersihFinal)} icon={Icon.wallet} color={T.teal} sub={PERIODE_LABELS[periodeMode]} />
            <StatCard label="ROE Periode" value={roePeriodePct !== null ? `${roePeriodePct.toFixed(1)}%` : "—"} icon={Icon.trendingUp} color={T.purple}
              sub={modalDisetor > 0 ? `dari Modal ${fmtRp(modalDisetor)}` : "Isi Modal Disetor di Konfigurasi"} />
            {roeSetahunPct !== null && (
              <StatCard label="ROE Disetahunkan (Estimasi)" value={`${roeSetahunPct.toFixed(1)}%`} icon={Icon.trendingUp} color={T.purple} sub="ROE bulanan × 12" />
            )}
            <StatCard label="Biaya Amortisasi" value={fmtRp(akuntansi.biayaAmortisasi)} icon={Icon.calculator} color={T.orange} sub={`${amortisasiPeriode.detail.filter(d=>d.bulanOverlap>0).length} aset aktif`} />
            <StatCard label="Saldo Kas Sistem (terkini)" value={fmtRp(kasLedgerTerkini.saldoAkhir)} icon={Icon.landmark} color={T.blue} sub="saldo awal + kas masuk − kas keluar" />
          </div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 10 }}>Rumus yang dipakai</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.gray600, lineHeight: 1.9 }}>
              <li><b>BOPO</b> = Total Biaya Operasional ÷ Total Pendapatan × 100% — makin rendah makin efisien.</li>
              <li><b>SHU / Laba Bersih</b> = Pendapatan − Total Biaya (termasuk Amortisasi), lalu disesuaikan Margin Laba.</li>
              <li><b>ROE</b> = SHU ÷ Modal Disetor × 100% — mengukur imbal hasil bagi pemilik modal.</li>
              <li><b>Amortisasi</b> = (Nilai Perolehan − Nilai Residu) ÷ Umur Ekonomis (bulan), diakui merata tiap bulan selama umur aset.</li>
            </ul>
          </Card>
        </>
      )}

      {section === "kas" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Saldo Awal" value={fmtRp(Number(config.kasSaldoAwal) || 0)} icon={Icon.landmark} color={T.gray600} />
            <StatCard label="Total Kas Masuk" value={fmtRp(kasLedgerTerkini.totalMasuk)} icon={Icon.trendingUp} color={T.green} />
            <StatCard label="Total Kas Keluar" value={fmtRp(kasLedgerTerkini.totalKeluar)} icon={Icon.trendingDown} color={T.red} />
            <StatCard label="Saldo Sistem (terkini)" value={fmtRp(kasLedgerTerkini.saldoAkhir)} icon={Icon.piggyBank} color={T.blue} />
            <StatCard label={`Saldo Sistem s.d. ${PERIODE_LABELS[periodeMode]}`} value={fmtRp(kasLedgerPeriode.saldoAkhir)} icon={Icon.calendar} color={T.teal} />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.checklist size={16} strokeWidth={2} /> Kas Opname (Cocokkan Fisik vs Sistem)
            </div>
            <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>Hitung uang tunai/saldo kas yang benar-benar ada, lalu bandingkan dengan saldo sistem terkini.</div>
            <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Saldo Fisik Hasil Hitung (Rp)</label>
                <input type="number" value={opnameFisik} onChange={e => setOpnameFisik(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={opnameKet} onChange={e => setOpnameKet(e.target.value)} placeholder="cth: opname akhir bulan"
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
            {opnameFisik !== "" && (
              <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12,
                background: selisihKas === 0 ? T.greenLt : T.redLt, border: `1px solid ${selisihKas === 0 ? T.green : T.red}44` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: selisihKas === 0 ? T.green : T.red }}>
                  Selisih: {fmtRp(Math.abs(selisihKas))} {selisihKas === 0 ? "(Cocok)" : selisihKas > 0 ? "(Fisik lebih besar dari sistem)" : "(Fisik lebih kecil dari sistem)"}
                </span>
              </div>
            )}
            {config.kasOpname?.tanggal && (
              <div style={{ fontSize: 11, color: T.gray400, marginBottom: 10 }}>Opname terakhir disimpan: {config.kasOpname.tanggal}</div>
            )}
            <Btn size="sm" icon={Icon.save} onClick={simpanOpnameKas}>Simpan Hasil Opname</Btn>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.spreadsheet size={16} strokeWidth={2} /> Buku Kas
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setKasForm({ tanggal: todayStr(), tipe: "masuk", kategori: "", nominal: "", keterangan: "" })}>Catat Transaksi</Btn>
            </div>
            <Table
              data={kasRowsDesc}
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "tipe", label: "Tipe", render: v => (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    color: v === "masuk" ? T.green : T.red, background: v === "masuk" ? T.greenLt : T.redLt }}>
                    {v === "masuk" ? "Masuk" : "Keluar"}
                  </span>
                ) },
                { key: "kategori", label: "Kategori" },
                { key: "keterangan", label: "Keterangan" },
                { key: "nominal", label: "Nominal", render: (v, row) => (
                  <span style={{ fontWeight: 700, color: row.tipe === "masuk" ? T.green : T.red }}>
                    {row.tipe === "masuk" ? "+" : "−"}{fmtRp(v)}
                  </span>
                ) },
                { key: "saldoBerjalan", label: "Saldo Berjalan", render: v => fmtRp(v) },
              ]}
              onEdit={row => setKasForm(row)}
              onDelete={id => deleteRecord("kasTransaksi", id)}
            />
          </Card>

          {kasForm && (
            <Modal title={kasForm.id ? "Edit Transaksi Kas" : "Catat Transaksi Kas"} onClose={() => setKasForm(null)} width={440}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tipe</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["masuk", "keluar"].map(t => (
                    <button key={t} onClick={() => setKasForm(f => ({ ...f, tipe: t, kategori: "" }))}
                      style={{ flex: 1, padding: "8px 12px", border: `1.5px solid ${kasForm.tipe === t ? T.green : T.gray200}`,
                        borderRadius: 8, background: kasForm.tipe === t ? T.greenLt : T.white, cursor: "pointer",
                        fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: kasForm.tipe === t ? T.green : T.gray600 }}>
                      {t === "masuk" ? "Kas Masuk" : "Kas Keluar"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={kasForm.tanggal} onChange={e => setKasForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal (Rp)</label>
                  <input type="number" value={kasForm.nominal} onChange={e => setKasForm(f => ({ ...f, nominal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={kasForm.kategori} onChange={e => setKasForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  <option value="">— Pilih —</option>
                  {(kasForm.tipe === "masuk" ? KATEGORI_KAS_MASUK : KATEGORI_KAS_KELUAR).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={kasForm.keterangan || ""} onChange={e => setKasForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 16, padding: "10px 14px", background: T.gray50, borderRadius: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Saldo Awal Kas (opsional, dasar perhitungan saldo berjalan)</label>
                <input type="number" value={config.kasSaldoAwal || 0} onChange={e => saveConfig({ ...config, kasSaldoAwal: Number(e.target.value) || 0 })}
                  style={{ width: "100%", padding: "7px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 7, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setKasForm(null)}>Batal</Btn>
                <Btn onClick={submitKas} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "stok" && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.gray400, marginBottom: 10 }}>
              "Stok Sistem" = total stok konsinyasi yang tercatat sedang beredar di semua toko (belum termasuk stok gudang pusat, karena aplikasi belum punya modul gudang terpisah). Setiap sesi opname membekukan angka sistem saat itu supaya bisa dibandingkan dengan hasil hitung fisik.
            </div>
            <Btn size="sm" icon={Icon.add} onClick={bukaOpnameStokBaru}>Opname Baru</Btn>
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.boxes size={16} strokeWidth={2} /> Riwayat Stock Opname
            </div>
            <Table
              data={[...stockOpnameArr].sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""))}
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "keterangan", label: "Keterangan" },
                { key: "items", label: "Jml Produk", render: v => `${(v || []).length} produk` },
                { key: "totalSelisihPcs", label: "Selisih (pcs)", render: v => (
                  <span style={{ fontWeight: 700, color: v === 0 ? T.gray600 : v > 0 ? T.green : T.red }}>{v > 0 ? "+" : ""}{fmt(v)}</span>
                ) },
                { key: "totalSelisihRp", label: "Selisih (Rp)", render: v => (
                  <span style={{ fontWeight: 700, color: v === 0 ? T.gray600 : v > 0 ? T.green : T.red }}>{v > 0 ? "+" : ""}{fmtRp(v)}</span>
                ) },
              ]}
              onEdit={row => setDetailOpnameStok(row)}
              onDelete={id => deleteRecord("stockOpname", id)}
            />
          </Card>

          {opnameStokForm && (
            <Modal title="Opname Stok Baru" onClose={() => setOpnameStokForm(null)} width={640}>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={opnameStokForm.tanggal} onChange={e => setOpnameStokForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                  <input value={opnameStokForm.keterangan} onChange={e => setOpnameStokForm(f => ({ ...f, keterangan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.gray50 }}>
                      {["Produk", "Stok Sistem", "Stok Fisik", "Selisih"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {opnameStokForm.items.map((it, i) => {
                      const selisih = (Number(it.stokFisik) || 0) - it.stokSistem;
                      return (
                        <tr key={it.produkId} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.nama}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokSistem)}</td>
                          <td style={{ padding: "6px 10px" }}>
                            <input type="number" value={it.stokFisik} onChange={e => {
                              const v = e.target.value;
                              setOpnameStokForm(f => ({ ...f, items: f.items.map((x, xi) => xi === i ? { ...x, stokFisik: v } : x) }));
                            }} style={{ width: 90, padding: "5px 8px", border: `1.5px solid ${T.gray200}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
                          </td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: selisih === 0 ? T.gray600 : selisih > 0 ? T.green : T.red }}>
                            {selisih > 0 ? "+" : ""}{fmt(selisih)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setOpnameStokForm(null)}>Batal</Btn>
                <Btn onClick={submitOpnameStok} icon={Icon.save}>Simpan Opname</Btn>
              </div>
            </Modal>
          )}

          {detailOpnameStok && (
            <Modal title={`Detail Opname — ${detailOpnameStok.tanggal}`} onClose={() => setDetailOpnameStok(null)} width={560}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.gray50 }}>
                      {["Produk", "Sistem", "Fisik", "Selisih"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOpnameStok.items || []).map(it => {
                      const selisih = it.stokFisik - it.stokSistem;
                      return (
                        <tr key={it.produkId} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                          <td style={{ padding: "6px 10px" }}>{it.nama}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokSistem)}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokFisik)}</td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: selisih === 0 ? T.gray600 : selisih > 0 ? T.green : T.red }}>{selisih > 0 ? "+" : ""}{fmt(selisih)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <Btn variant="secondary" onClick={() => setDetailOpnameStok(null)}>Tutup</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "amortisasi" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Jumlah Aset" value={fmt(asetArr.length)} icon={Icon.package} color={T.gray600} />
            <StatCard label="Total Nilai Perolehan" value={fmtRp(asetArr.reduce((s, a) => s + (Number(a.nilaiPerolehan) || 0), 0))} icon={Icon.banknote} color={T.blue} />
            <StatCard label={`Amortisasi ${PERIODE_LABELS[periodeMode]}`} value={fmtRp(amortisasiPeriode.total)} icon={Icon.calculator} color={T.orange} />
            <StatCard label="Total Nilai Buku Saat Ini" value={fmtRp(asetArr.reduce((s, a) => s + statusAsetSaatIni(a).nilaiBuku, 0))} icon={Icon.scale} color={T.teal} />
          </div>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.calculator size={16} strokeWidth={2} /> Daftar Aset & Penyusutan
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setAsetForm({ nama: "", kategori: KATEGORI_ASET[0], nilaiPerolehan: "", nilaiResidu: 0, tanggalPerolehan: todayStr(), umurBulan: 36, keterangan: "" })}>Tambah Aset</Btn>
            </div>
            <Table
              data={asetArr}
              columns={[
                { key: "nama", label: "Nama Aset" },
                { key: "kategori", label: "Kategori" },
                { key: "nilaiPerolehan", label: "Nilai Perolehan", render: v => fmtRp(v) },
                { key: "umurBulan", label: "Umur", render: v => `${v} bln` },
                { key: "id", label: "Amortisasi/Bln", render: (_, row) => fmtRp(statusAsetSaatIni(row).perBulan) },
                { key: "nilaiBuku", label: "Nilai Buku", render: (_, row) => {
                  const st = statusAsetSaatIni(row);
                  return <span style={{ color: st.lunas ? T.gray400 : T.gray800, fontWeight: 700 }}>{fmtRp(st.nilaiBuku)}{st.lunas && " (lunas)"}</span>;
                } },
              ]}
              onEdit={row => setAsetForm(row)}
              onDelete={id => deleteRecord("asetAmortisasi", id)}
            />
          </Card>

          {asetForm && (
            <Modal title={asetForm.id ? "Edit Aset" : "Tambah Aset"} onClose={() => setAsetForm(null)} width={480}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nama Aset *</label>
                <input value={asetForm.nama} onChange={e => setAsetForm(f => ({ ...f, nama: e.target.value }))} placeholder="cth: Motor Distribusi, Rak Display Toko..."
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={asetForm.kategori} onChange={e => setAsetForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {KATEGORI_ASET.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nilai Perolehan (Rp) *</label>
                  <input type="number" value={asetForm.nilaiPerolehan} onChange={e => setAsetForm(f => ({ ...f, nilaiPerolehan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nilai Residu (Rp)</label>
                  <input type="number" value={asetForm.nilaiResidu} onChange={e => setAsetForm(f => ({ ...f, nilaiResidu: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal Perolehan *</label>
                  <input type="date" value={asetForm.tanggalPerolehan} onChange={e => setAsetForm(f => ({ ...f, tanggalPerolehan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Umur Ekonomis (bulan) *</label>
                  <input type="number" value={asetForm.umurBulan} onChange={e => setAsetForm(f => ({ ...f, umurBulan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={asetForm.keterangan || ""} onChange={e => setAsetForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setAsetForm(null)}>Batal</Btn>
                <Btn onClick={submitAset} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
