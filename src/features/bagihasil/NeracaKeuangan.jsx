import React, { useMemo, useState } from "react";
import { Btn, Card, Modal, StatCard, Table } from "../../components/ui";
import { fmt, fmtRp, genUniqueId } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";
import {
  hitungSaldoKas, hitungStokSistem, hitungAmortisasiPeriode, statusAsetSaatIni,
  nilaiPersediaan, ringkasanHutangPiutang,
  KATEGORI_KAS_MASUK, KATEGORI_KAS_KELUAR, KATEGORI_ASET, KATEGORI_HUTANG, KATEGORI_PIUTANG,
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
  function submitEditOpnameStok() {
    const items = detailOpnameStok.items.map(it => ({ ...it, stokFisik: Number(it.stokFisik) || 0 }));
    const totalSelisihPcs = items.reduce((s, it) => s + (it.stokFisik - it.stokSistem), 0);
    const totalSelisihRp = items.reduce((s, it) => {
      const p = produkArr.find(pp => pp.id === it.produkId);
      return s + (it.stokFisik - it.stokSistem) * (p?.harga || 0);
    }, 0);
    updateRecord("stockOpname", detailOpnameStok.id, { tanggal: detailOpnameStok.tanggal, keterangan: detailOpnameStok.keterangan, items, totalSelisihPcs, totalSelisihRp });
    setDetailOpnameStok(null);
  }

  // ── Hutang / Piutang ─────────────────────────────────────────────
  const hutangPiutangArr = db.hutangPiutang || [];
  const ringkasanHutang = useMemo(() => ringkasanHutangPiutang(hutangPiutangArr, "hutang"), [hutangPiutangArr]);
  const ringkasanPiutang = useMemo(() => ringkasanHutangPiutang(hutangPiutangArr, "piutang"), [hutangPiutangArr]);
  const [hpForm, setHpForm] = useState(null); // form tambah/edit hutang-piutang
  const [hpTipeAktif, setHpTipeAktif] = useState("hutang"); // tab kecil: hutang | piutang
  const [bayarForm, setBayarForm] = useState(null); // { row, nominal }

  function submitHp() {
    if (!hpForm.pihak || !Number(hpForm.nominalAwal) || !hpForm.tanggal) return alert("Nama Pihak, Nominal, & Tanggal wajib diisi");
    const rec = { ...hpForm, nominalAwal: Number(hpForm.nominalAwal), terbayar: Number(hpForm.terbayar) || 0 };
    if (hpForm.id) updateRecord("hutangPiutang", hpForm.id, rec);
    else addRecord("hutangPiutang", { ...rec, id: genUniqueId(hpForm.tipe === "hutang" ? "HTG" : "PIU") });
    setHpForm(null);
  }
  function submitBayar() {
    const nominal = Number(bayarForm.nominal) || 0;
    if (nominal <= 0) return alert("Nominal pembayaran harus lebih dari 0");
    const row = bayarForm.row;
    const terbayarBaru = (Number(row.terbayar) || 0) + nominal;
    updateRecord("hutangPiutang", row.id, { terbayar: Math.min(terbayarBaru, row.nominalAwal) });
    // ✅ Auto-link ke Kas: hutang dibayar = Kas Keluar, piutang tertagih = Kas Masuk
    addRecord("kasTransaksi", {
      id: genUniqueId("KAS"), tanggal: bayarForm.tanggal || todayStr(),
      tipe: row.tipe === "hutang" ? "keluar" : "masuk",
      kategori: row.tipe === "hutang" ? "Pembayaran Hutang Usaha" : "Piutang Tertagih",
      nominal, keterangan: `${row.tipe === "hutang" ? "Bayar hutang ke" : "Tagih piutang dari"} ${row.pihak}`,
    });
    setBayarForm(null);
  }

  // ── Laporan Neraca (Aset = Kewajiban + Ekuitas) ────────────────────
  const neracaTanggal = bounds?.end || todayStr();
  const kasSistemNeraca = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, neracaTanggal).saldoAkhir, [kasArr, config.kasSaldoAwal, neracaTanggal]);
  const persediaanNeraca = useMemo(() => nilaiPersediaan(stokSistemMap, produkArr), [stokSistemMap, produkArr]);
  const nilaiBukuAsetNeraca = useMemo(() => asetArr.reduce((s, a) => s + statusAsetSaatIni(a, neracaTanggal).nilaiBuku, 0), [asetArr, neracaTanggal]);
  const asetLancar = kasSistemNeraca + ringkasanPiutang.totalOutstanding + persediaanNeraca;
  const totalAset = asetLancar + nilaiBukuAsetNeraca;
  const totalKewajiban = ringkasanHutang.totalOutstanding;
  const labaDitahanPlug = totalAset - totalKewajiban - modalDisetor; // residual — lihat catatan di UI
  const totalEkuitas = modalDisetor + labaDitahanPlug;

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
    { key: "hutangpiutang", label: "Hutang/Piutang", icon: Icon.receipt },
    { key: "neraca", label: "Laporan Neraca", icon: Icon.spreadsheet },
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
            <Modal title={`Edit Opname — ${detailOpnameStok.tanggal}`} onClose={() => setDetailOpnameStok(null)} width={640}>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={detailOpnameStok.tanggal} onChange={e => setDetailOpnameStok(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                  <input value={detailOpnameStok.keterangan || ""} onChange={e => setDetailOpnameStok(f => ({ ...f, keterangan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.gray50 }}>
                      {["Produk", "Sistem", "Fisik", "Selisih"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOpnameStok.items || []).map((it, i) => {
                      const selisih = (Number(it.stokFisik) || 0) - it.stokSistem;
                      return (
                        <tr key={it.produkId} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.nama}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokSistem)}</td>
                          <td style={{ padding: "6px 10px" }}>
                            <input type="number" value={it.stokFisik} onChange={e => {
                              const v = e.target.value;
                              setDetailOpnameStok(f => ({ ...f, items: f.items.map((x, xi) => xi === i ? { ...x, stokFisik: v } : x) }));
                            }} style={{ width: 90, padding: "5px 8px", border: `1.5px solid ${T.gray200}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
                          </td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: selisih === 0 ? T.gray600 : selisih > 0 ? T.green : T.red }}>{selisih > 0 ? "+" : ""}{fmt(selisih)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setDetailOpnameStok(null)}>Batal</Btn>
                <Btn onClick={submitEditOpnameStok} icon={Icon.save}>Simpan Perubahan</Btn>
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

      {section === "hutangpiutang" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Total Hutang Outstanding" value={fmtRp(ringkasanHutang.totalOutstanding)} icon={Icon.trendingDown} color={T.red} sub={`${ringkasanHutang.rows.filter(r=>!r.lunas).length} belum lunas`} />
            <StatCard label="Total Piutang Outstanding" value={fmtRp(ringkasanPiutang.totalOutstanding)} icon={Icon.trendingUp} color={T.green} sub={`${ringkasanPiutang.rows.filter(r=>!r.lunas).length} belum lunas`} />
            <StatCard label="Posisi Bersih" value={fmtRp(ringkasanPiutang.totalOutstanding - ringkasanHutang.totalOutstanding)} icon={Icon.scale} color={T.blue} sub="Piutang − Hutang" />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ key: "hutang", label: "Hutang" }, { key: "piutang", label: "Piutang" }].map(t => (
              <button key={t.key} onClick={() => setHpTipeAktif(t.key)}
                style={{ padding: "7px 16px", border: `1.5px solid ${hpTipeAktif === t.key ? T.green : T.gray200}`, borderRadius: 99,
                  background: hpTipeAktif === t.key ? T.greenLt : T.white, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, color: hpTipeAktif === t.key ? T.green : T.gray600 }}>
                {t.label}
              </button>
            ))}
          </div>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.receipt size={16} strokeWidth={2} /> Daftar {hpTipeAktif === "hutang" ? "Hutang" : "Piutang"}
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setHpForm({ tipe: hpTipeAktif, pihak: "", kategori: (hpTipeAktif === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG)[0], nominalAwal: "", terbayar: 0, tanggal: todayStr(), jatuhTempo: "", keterangan: "" })}>
                Tambah {hpTipeAktif === "hutang" ? "Hutang" : "Piutang"}
              </Btn>
            </div>
            <Table
              data={(hpTipeAktif === "hutang" ? ringkasanHutang.rows : ringkasanPiutang.rows)}
              columns={[
                { key: "pihak", label: "Pihak" },
                { key: "kategori", label: "Kategori" },
                { key: "tanggal", label: "Tanggal" },
                { key: "jatuhTempo", label: "Jatuh Tempo", render: v => v || "-" },
                { key: "nominalAwal", label: "Nominal Awal", render: v => fmtRp(v) },
                { key: "sisa", label: "Sisa", render: (v, row) => (
                  <span style={{ fontWeight: 700, color: row.lunas ? T.gray400 : T.red }}>{row.lunas ? "Lunas" : fmtRp(v)}</span>
                ) },
                { key: "id", label: "Aksi Cepat", render: (_, row) => !row.lunas && (
                  <button onClick={() => setBayarForm({ row, nominal: row.sisa, tanggal: todayStr() })}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.green}`, background: T.greenLt, color: T.green,
                      fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                    {hpTipeAktif === "hutang" ? "Bayar" : "Tagih"}
                  </button>
                ) },
              ]}
              onEdit={row => setHpForm(row)}
              onDelete={id => deleteRecord("hutangPiutang", id)}
            />
          </Card>

          {hpForm && (
            <Modal title={hpForm.id ? "Edit" : `Tambah ${hpForm.tipe === "hutang" ? "Hutang" : "Piutang"}`} onClose={() => setHpForm(null)} width={480}>
              {!hpForm.id && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tipe</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["hutang", "piutang"].map(t => (
                      <button key={t} onClick={() => setHpForm(f => ({ ...f, tipe: t, kategori: (t === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG)[0] }))}
                        style={{ flex: 1, padding: "8px 12px", border: `1.5px solid ${hpForm.tipe === t ? T.green : T.gray200}`,
                          borderRadius: 8, background: hpForm.tipe === t ? T.greenLt : T.white, cursor: "pointer",
                          fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: hpForm.tipe === t ? T.green : T.gray600 }}>
                        {t === "hutang" ? "Hutang" : "Piutang"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nama Pihak *</label>
                <input value={hpForm.pihak} onChange={e => setHpForm(f => ({ ...f, pihak: e.target.value }))} placeholder={hpForm.tipe === "hutang" ? "cth: Supplier ABC" : "cth: Toko XYZ"}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={hpForm.kategori} onChange={e => setHpForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {(hpForm.tipe === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal Awal (Rp) *</label>
                  <input type="number" value={hpForm.nominalAwal} onChange={e => setHpForm(f => ({ ...f, nominalAwal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Sudah Terbayar (Rp)</label>
                  <input type="number" value={hpForm.terbayar} onChange={e => setHpForm(f => ({ ...f, terbayar: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal *</label>
                  <input type="date" value={hpForm.tanggal} onChange={e => setHpForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Jatuh Tempo</label>
                  <input type="date" value={hpForm.jatuhTempo || ""} onChange={e => setHpForm(f => ({ ...f, jatuhTempo: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={hpForm.keterangan || ""} onChange={e => setHpForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setHpForm(null)}>Batal</Btn>
                <Btn onClick={submitHp} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}

          {bayarForm && (
            <Modal title={`Catat ${bayarForm.row.tipe === "hutang" ? "Pembayaran" : "Penagihan"} — ${bayarForm.row.pihak}`} onClose={() => setBayarForm(null)} width={420}>
              <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
                Sisa saat ini: <b>{fmtRp(bayarForm.row.sisa)}</b>. Mencatat ini akan otomatis membuat entri {bayarForm.row.tipe === "hutang" ? "Kas Keluar" : "Kas Masuk"} di Buku Kas.
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal (Rp)</label>
                  <input type="number" value={bayarForm.nominal} max={bayarForm.row.sisa} onChange={e => setBayarForm(f => ({ ...f, nominal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={bayarForm.tanggal} onChange={e => setBayarForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setBayarForm(null)}>Batal</Btn>
                <Btn onClick={submitBayar} icon={Icon.save}>Simpan & Catat ke Kas</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "neraca" && (
        <>
          <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
            Posisi keuangan per <b>{neracaTanggal}</b> (akhir periode {PERIODE_LABELS[periodeMode]}). Karena aplikasi ini belum memakai pembukuan berpasangan (double-entry) penuh, <b>Laba Ditahan</b> di bawah dihitung sebagai angka sisa (Total Aset − Total Kewajiban − Modal Disetor) — bukan hasil akumulasi transaksi historis per bulan, jadi Neraca ini akan selalu balance secara matematis.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="gw-grid2">
            {/* ASET */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.blue}`, paddingBottom: 10 }}>ASET</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "12px 0 6px" }}>Aset Lancar</div>
              {[
                ["Kas & Setara Kas", kasSistemNeraca],
                ["Piutang Usaha", ringkasanPiutang.totalOutstanding],
                ["Persediaan (Stok Konsinyasi, harga jual)", persediaanNeraca],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(val)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.blue, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Aset Lancar</span><span>{fmtRp(asetLancar)}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "16px 0 6px" }}>Aset Tetap</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                <span>Nilai Buku Aset (setelah amortisasi)</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(nilaiBukuAsetNeraca)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: T.blueLt, borderRadius: 8, marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.blue }}>TOTAL ASET</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: T.blue }}>{fmtRp(totalAset)}</span>
              </div>
            </Card>

            {/* KEWAJIBAN + EKUITAS */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.red}`, paddingBottom: 10 }}>KEWAJIBAN & EKUITAS</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "12px 0 6px" }}>Kewajiban (Liabilitas)</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                <span>Hutang Usaha</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(totalKewajiban)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.red, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Kewajiban</span><span>{fmtRp(totalKewajiban)}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "16px 0 6px" }}>Ekuitas</div>
              {[
                ["Modal Disetor", modalDisetor],
                ["Laba Ditahan (akumulasi, angka sisa)", labaDitahanPlug],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: val < 0 ? T.red : T.gray800 }}>{fmtRp(val)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.green, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Ekuitas</span><span>{fmtRp(totalEkuitas)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: T.greenLt, borderRadius: 8, marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.green }}>TOTAL KEWAJIBAN + EKUITAS</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: T.green }}>{fmtRp(totalKewajiban + totalEkuitas)}</span>
              </div>
            </Card>
          </div>
          {modalDisetor === 0 && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: T.orangeLt, border: `1px solid ${T.orange}44`, borderRadius: 8, fontSize: 12, color: T.gray700 }}>
              <Icon.warning size={13} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 5 }} />
              Modal Disetor belum diisi (masih Rp0) — isi di tombol Konfigurasi pada sub-tab "Bagi Hasil & Laba Rugi" supaya Laba Ditahan & ROE lebih akurat.
            </div>
          )}
        </>
      )}
    </div>
  );
}
