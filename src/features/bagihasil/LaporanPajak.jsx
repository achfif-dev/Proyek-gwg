import React, { useState } from "react";
import { Btn, Card, StatCard } from "../../components/ui";
import { exportExcel } from "../../lib/exportUtils";
import { fmtRp } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";

// Referensi tarif (per pengetahuan terkini, HARUS dicek ulang di pajak.go.id
// karena aturan pajak bisa berubah sewaktu-waktu — lihat disclaimer di UI):
// - PPh Final UMKM: 0,5% dari omzet bruto (PP 23/2018 jo. PP 55/2022).
//   Bebas PPh untuk Orang Pribadi dengan omzet ≤ Rp500 juta/tahun.
//   Batas peredaran bruto agar tetap eligible: Rp4,8 miliar/tahun.
//   Jangka waktu pemakaian skema: OP 7 tahun, Koperasi/CV/Firma 4 tahun, PT 3 tahun (sejak terdaftar).
// - PPN: 11% (tarif umum sesuai UU HPP; 12% hanya untuk barang mewah tertentu).
// - PPh Badan: 22% (umum), dengan fasilitas diskon 50% (Ps. 31E) bila peredaran bruto ≤ Rp4,8 miliar/tahun.
const PPH_FINAL_RATE = 0.005;
const PPN_RATE = 0.11;
const PPH_BADAN_RATE = 0.22;
const BATAS_OMZET_UMKM = 4_800_000_000;
const BATAS_BEBAS_OP = 500_000_000;

export function LaporanPajak({ akuntansi, revPeriode, periodeMode, PERIODE_LABELS, config, saveConfig, filterBulan, filterTahun }) {
  const [namaUsaha, setNamaUsaha] = useState(config.pajakInfo?.namaUsaha || "");
  const [npwp, setNpwp] = useState(config.pajakInfo?.npwp || "");

  function simpanInfo() {
    saveConfig({ ...config, pajakInfo: { namaUsaha, npwp } });
  }

  const periodOmzet = akuntansi.pendapatan;
  const pkpEstimasi = Math.max(0, akuntansi.labaKotor); // Penghasilan Kena Pajak kasar (belum koreksi fiskal)

  // Estimasi setahun — cuma bisa diandalkan untuk mode Bulanan/Tahunan.
  const annualEstimate = periodeMode === "bulanan" ? periodOmzet * 12 : periodeMode === "tahunan" ? periodOmzet : null;
  const eligibleUmkm = annualEstimate === null ? null : annualEstimate <= BATAS_OMZET_UMKM;
  const eligibleFasilitasBadan = eligibleUmkm;

  // Skema A — UMKM Non-PKP (PPh Final 0,5%)
  const pphFinal = periodOmzet * PPH_FINAL_RATE;

  // Skema B — PKP (PPN Keluaran + PPh Badan)
  const ppnKeluaran = periodOmzet * PPN_RATE;
  const pphBadanNormal = pkpEstimasi * PPH_BADAN_RATE;
  const pphBadanFasilitas = pkpEstimasi * (PPH_BADAN_RATE / 2);
  const pphBadanDipakai = eligibleFasilitasBadan ? pphBadanFasilitas : pphBadanNormal;
  const totalSkemaB = ppnKeluaran + pphBadanDipakai;

  function exportLaporanPajak() {
    const rows = [
      { keterangan: "SIMULASI LAPORAN PERPAJAKAN", nilai: "" },
      { keterangan: "Nama Usaha", nilai: namaUsaha || "-" },
      { keterangan: "NPWP", nilai: npwp || "-" },
      { keterangan: "Periode", nilai: PERIODE_LABELS[periodeMode] },
      { keterangan: "Total Pendapatan (Omzet)", nilai: fmtRp(periodOmzet) },
      { keterangan: "", nilai: "" },
      { keterangan: "=== SKEMA A: UMKM NON-PKP (PPh Final 0,5%) ===", nilai: "" },
      { keterangan: "PPh Final Terutang (0,5% x Omzet)", nilai: fmtRp(pphFinal) },
      { keterangan: "", nilai: "" },
      { keterangan: "=== SKEMA B: PKP (PPN + PPh Badan) ===", nilai: "" },
      { keterangan: "PPN Keluaran (11% x Omzet)", nilai: fmtRp(ppnKeluaran) },
      { keterangan: "Estimasi Penghasilan Kena Pajak", nilai: fmtRp(pkpEstimasi) },
      { keterangan: `PPh Badan (${eligibleFasilitasBadan ? "11% dgn fasilitas Psl.31E" : "22% umum"})`, nilai: fmtRp(pphBadanDipakai) },
      { keterangan: "TOTAL KEWAJIBAN SKEMA B", nilai: fmtRp(totalSkemaB) },
      { keterangan: "", nilai: "" },
      { keterangan: "Catatan", nilai: "Simulasi ini adalah alat bantu hitung, BUKAN pengganti pelaporan resmi. Pelaporan wajib tetap dilakukan lewat Coretax DJP (pajak.go.id)." },
    ];
    exportExcel(rows, [{ key: "keterangan", label: "Keterangan" }, { key: "nilai", label: "Nilai" }],
      "Simulasi Laporan Pajak GWG", `laporan_pajak_${filterBulan || filterTahun}`);
  }

  return (
    <div>
      <Card style={{ marginBottom: 16, background: T.orangeLt, border: `1px solid ${T.orange}44` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Icon.warning size={18} strokeWidth={2} style={{ color: T.orange, flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: T.gray700, lineHeight: 1.6 }}>
            <b>Ini simulasi/alat bantu hitung, bukan pengganti konsultan pajak atau pelaporan resmi.</b> Tarif di bawah mengikuti aturan yang berlaku umum saat ini (PP 55/2022 & UU HPP) dan bisa berubah sewaktu-waktu — selalu cek aturan terbaru & lapor kewajiban sebenarnya lewat <b>Coretax DJP</b> di{" "}
            <a href="https://www.pajak.go.id" target="_blank" rel="noreferrer" style={{ color: T.orange, fontWeight: 700 }}>pajak.go.id</a>. Angka di sini juga belum memperhitungkan Pajak Masukan (kredit PPN), koreksi fiskal, PPh 21 karyawan, atau kompensasi rugi.
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 12 }}>Identitas Usaha (opsional, untuk kop laporan)</div>
        <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nama Usaha</label>
            <input value={namaUsaha} onChange={e => setNamaUsaha(e.target.value)} onBlur={simpanInfo}
              style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>NPWP</label>
            <input value={npwp} onChange={e => setNpwp(e.target.value)} onBlur={simpanInfo}
              style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: T.gray600 }}>
          Periode: <b>{PERIODE_LABELS[periodeMode]}</b> · Omzet: <b>{fmtRp(periodOmzet)}</b>
          {annualEstimate !== null && <> · Estimasi setahun: <b>{fmtRp(annualEstimate)}</b></>}
        </div>
        <Btn variant="secondary" size="sm" icon={Icon.spreadsheet} onClick={exportLaporanPajak}>Ekspor Excel</Btn>
      </div>

      {annualEstimate === null && (
        <div style={{ fontSize: 12, color: T.gray400, marginBottom: 12 }}>
          Mode periode "Kustom" tidak bisa diestimasi setahun secara akurat — pilih mode Bulanan/Tahunan di atas untuk melihat status kelayakan skema UMKM & fasilitas Pasal 31E.
        </div>
      )}

      <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Skema A */}
        <Card>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.green}`, paddingBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.receipt size={16} strokeWidth={2} /> Skema A — UMKM Non-PKP
          </div>
          <div style={{ fontSize: 11, color: T.gray400, marginBottom: 14 }}>PPh Final 0,5% dari omzet bruto (PP 55/2022)</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.greenLt, borderRadius: 7, marginBottom: 10 }}>
            <span style={{ fontSize: 13 }}>Omzet Periode</span>
            <span style={{ fontWeight: 700 }}>{fmtRp(periodOmzet)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: `linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`, borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>PPh Final Terutang (0,5%)</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{fmtRp(pphFinal)}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: T.gray500, lineHeight: 1.8 }}>
            <li>Orang Pribadi bebas PPh bila omzet setahun ≤ {fmtRp(BATAS_BEBAS_OP)}.</li>
            <li>Hanya berlaku selama peredaran bruto setahun ≤ {fmtRp(BATAS_OMZET_UMKM)}.
              {eligibleUmkm !== null && (
                <b style={{ color: eligibleUmkm ? T.green : T.red }}> {eligibleUmkm ? " (estimasi Anda saat ini masih memenuhi)" : " (estimasi Anda saat ini SUDAH MELEBIHI batas)"}</b>
              )}
            </li>
            <li>Jangka waktu pemakaian skema sejak terdaftar: OP 7 tahun, Koperasi/CV/Firma 4 tahun, PT 3 tahun.</li>
          </ul>
        </Card>

        {/* Skema B */}
        <Card>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.blue}`, paddingBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.receipt size={16} strokeWidth={2} /> Skema B — PKP
          </div>
          <div style={{ fontSize: 11, color: T.gray400, marginBottom: 14 }}>PPN Keluaran 11% + PPh Badan (umum/fasilitas)</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.blueLt, borderRadius: 7, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>PPN Keluaran (11% × Omzet)</span>
            <span style={{ fontWeight: 700, color: T.blue }}>{fmtRp(ppnKeluaran)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.gray50, borderRadius: 7, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>Estimasi Penghasilan Kena Pajak</span>
            <span style={{ fontWeight: 700 }}>{fmtRp(pkpEstimasi)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.blueLt, borderRadius: 7, marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>PPh Badan ({eligibleFasilitasBadan ? "11%, fasilitas Ps.31E" : "22%, tarif umum"})</span>
            <span style={{ fontWeight: 700, color: T.blue }}>{fmtRp(pphBadanDipakai)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: `linear-gradient(135deg, ${T.blue} 0%, #3B82F6 100%)`, borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Total Kewajiban Periode Ini</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{fmtRp(totalSkemaB)}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: T.gray500, lineHeight: 1.8 }}>
            <li>PPN di atas belum dikurangi Pajak Masukan (kredit PPN) yang bisa dikreditkan.</li>
            <li>Fasilitas diskon 50% PPh Badan (Ps. 31E) berlaku bila peredaran bruto setahun ≤ {fmtRp(BATAS_OMZET_UMKM)}.</li>
          </ul>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 10 }}>Kewajiban lain yang perlu dicek terpisah</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.gray600, lineHeight: 1.9 }}>
          <li><b>PPh 21</b> — jika ada karyawan/sales bergaji tetap, potong & setor PPh 21 masing-masing (belum dihitung di sini, butuh data payroll).</li>
          <li><b>PPh 23</b> — jika ada jasa/sewa dari pihak lain yang dibayar perusahaan.</li>
          <li><b>Pajak Daerah</b> — retribusi/pajak reklame, pajak restoran, dsb., tergantung jenis usaha & lokasi.</li>
        </ul>
      </Card>
    </div>
  );
}
