import React from "react";
import { Badge, Card } from "../../components/ui";
import { hitungPeringatanToko, hariIniLokal, BATAS, KUNCI_CONFIG, ANALITIK_DEFAULT } from "../../lib/analitikToko";
import { useAnalitikConfig } from "../../lib/analitikConfig";
import { fmt } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tglPendek = (s) => (s && s.length >= 10 ? `${+s.slice(8, 10)} ${BULAN[+s.slice(5, 7) - 1]}` : "—");
const LEVEL = {
  habis:   { teks: "Perkiraan habis", warna: T.red },
  segera:  { teks: "Segera habis",    warna: T.orange },
  waspada: { teks: "Tak cukup s/d kunjungan", warna: T.gold },
};
const BATAS_AWAL = 8;

const btn = (primer, nonaktif) => ({
  border: primer ? "none" : `1px solid ${T.gray200}`, cursor: nonaktif ? "not-allowed" : "pointer", fontFamily: "inherit",
  fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8, opacity: nonaktif ? 0.6 : 1,
  background: primer ? T.green : T.white, color: primer ? "#fff" : T.gray600,
});

function PanelAtur({ config, adaOverride, simpan, kembalikanBawaan, onTutup }) {
  const [draft, setDraft] = React.useState(() => Object.fromEntries(KUNCI_CONFIG.map((k) => [k, String(config[k])])));
  const [errors, setErrors] = React.useState({});
  const [pesan, setPesan] = React.useState("");
  const [sibuk, setSibuk] = React.useState(false);
  const [lanjutan, setLanjutan] = React.useState(false);

  const kirim = async () => {
    setSibuk(true); setPesan("");
    const r = await simpan(draft);
    setSibuk(false);
    if (r.ok) { onTutup(); return; }
    setErrors(r.errors || {});
    if (r.pesan) setPesan(r.pesan);
    if (r.errors && KUNCI_CONFIG.some((k) => BATAS[k].lanjutan && r.errors[k])) setLanjutan(true);
  };
  const bawaan = async () => {
    setSibuk(true); setPesan("");
    const r = await kembalikanBawaan();
    setSibuk(false);
    if (r.ok) onTutup(); else setPesan(r.pesan || "Gagal.");
  };

  const baris = (k) => {
    const b = BATAS[k];
    return (
      <div key={k} style={{ marginBottom: 10 }}>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: T.gray800 }}>
          <span>{b.label}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="number" inputMode="numeric" min={b.min} max={b.max} value={draft[k]}
              onChange={(e) => { setDraft((d) => ({ ...d, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); }}
              style={{ width: 70, padding: "5px 8px", fontSize: 13, textAlign: "right", fontFamily: "inherit",
                border: `1px solid ${errors[k] ? T.red : T.gray200}`, borderRadius: 6 }} />
            <span style={{ fontSize: 11, color: T.gray400, fontWeight: 500 }}>{b.satuan}</span>
          </span>
        </label>
        <div style={{ fontSize: 10.5, color: errors[k] ? T.red : T.gray400, marginTop: 2 }}>
          {errors[k] || `${b.info} (bawaan ${ANALITIK_DEFAULT[k]}, rentang ${b.min}–${b.max})`}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: T.gray100, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.gray800, marginBottom: 4 }}>Atur ambang peringatan</div>
      <div style={{ fontSize: 10.5, color: T.gray400, marginBottom: 10 }}>
        Berlaku untuk semua pengguna di semua perangkat. {adaOverride ? "Saat ini memakai pengaturan khusus." : "Saat ini memakai nilai bawaan."}
      </div>
      {KUNCI_CONFIG.filter((k) => !BATAS[k].lanjutan).map(baris)}
      <button onClick={() => setLanjutan((v) => !v)}
        style={{ border: "none", background: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: T.green, cursor: "pointer", fontFamily: "inherit", marginBottom: 8 }}>
        {lanjutan ? "Sembunyikan pengaturan lanjutan" : "Pengaturan lanjutan (perhitungan laju)"}
      </button>
      {lanjutan && KUNCI_CONFIG.filter((k) => BATAS[k].lanjutan).map(baris)}
      {pesan && <div style={{ fontSize: 11.5, color: T.red, fontWeight: 600, margin: "6px 0" }}>{pesan}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <button onClick={kirim} disabled={sibuk} style={btn(true, sibuk)}>{sibuk ? "Menyimpan…" : "Simpan"}</button>
        <button onClick={onTutup} disabled={sibuk} style={btn(false, sibuk)}>Batal</button>
        {adaOverride && <button onClick={bawaan} disabled={sibuk} style={btn(false, sibuk)}>Kembalikan bawaan</button>}
      </div>
    </div>
  );
}

function PerhatianTokoImpl({ db, salesWilayahId, dataStillSyncing, bolehAtur }) {
  const [tab, setTab] = React.useState("restok");
  const [semua, setSemua] = React.useState(false);
  const [atur, setAtur] = React.useState(false);
  const { config, adaOverride, simpan, kembalikanBawaan } = useAnalitikConfig();

  const hasil = React.useMemo(() => hitungPeringatanToko({
    toko: db.toko, kontrol: db.kontrol, rute: db.rute,
    produk: (db.produk || []).filter((p) => p.aktif !== false),
    hariIni: hariIniLokal(), wilayahId: salesWilayahId || "", opsi: config,
  }), [db.toko, db.kontrol, db.rute, db.produk, salesWilayahId, config]);

  const namaRute = React.useMemo(() => new Map((db.rute || []).map((r) => [r.id, r.nama])), [db.rute]);
  const namaWil = React.useMemo(() => new Map((db.wilayah || []).map((w) => [w.id, w.nama])), [db.wilayah]);

  const daftar = tab === "restok" ? hasil.restok : hasil.terlambat;
  const tampil = semua ? daftar : daftar.slice(0, BATAS_AWAL);
  const lokasi = (x) => [namaWil.get(x.wilayahId), namaRute.get(x.ruteId)].filter(Boolean).join(" · ");

  const tabBtn = (key, label, n) => (
    <button key={key} onClick={() => { setTab(key); setSemua(false); }}
      style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
        padding: "6px 12px", borderRadius: 20,
        background: tab === key ? T.green : T.gray100, color: tab === key ? "#fff" : T.gray600 }}>
      {label} ({n})
    </button>
  );

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.gray800, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon.warning size={16} strokeWidth={2} style={{ display: "inline", verticalAlign: "-3px" }} />
        <span style={{ flex: 1 }}>Perlu Perhatian</span>
        {bolehAtur && (
          <button onClick={() => setAtur((v) => !v)} title="Atur ambang peringatan" aria-label="Atur ambang peringatan"
            style={{ border: "none", background: atur ? T.gray100 : "none", borderRadius: 8, padding: 6, cursor: "pointer", color: T.gray600, display: "flex" }}>
            <Icon.settings size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {atur && bolehAtur && (
        <PanelAtur config={config} adaOverride={adaOverride} simpan={simpan} kembalikanBawaan={kembalikanBawaan} onTutup={() => setAtur(false)} />
      )}

      {dataStillSyncing && (
        <div style={{ fontSize: 11, color: T.gold, fontWeight: 700, marginBottom: 8 }}>
          Data kontrol masih disinkronkan — daftar bisa berubah.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {tabBtn("restok", "Perkiraan stok habis", hasil.restok.length)}
        {tabBtn("terlambat", "Terlambat dikontrol", hasil.terlambat.length)}
      </div>

      {daftar.length === 0 && (
        <div style={{ color: T.gray400, fontSize: 12 }}>
          {tab === "restok" ? "Tidak ada toko yang diperkirakan kehabisan stok sebelum kunjungan berikutnya." : `Tidak ada toko yang lebih dari ${hasil.opsi.terlambatHari} hari belum dikontrol.`}
        </div>
      )}

      {tampil.map((x) => (
        <div key={x.tokoId} style={{ padding: "8px 0", borderTop: `1px solid ${T.gray100}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.gray800 }}>{x.nama}</div>
            {tab === "restok"
              ? <Badge color={LEVEL[x.level].warna}>{LEVEL[x.level].teks}</Badge>
              : <Badge color={x.hari > 2 * hasil.opsi.terlambatHari ? T.red : T.orange}>{x.hari} hari</Badge>}
          </div>
          <div style={{ fontSize: 11, color: T.gray400, marginTop: 2 }}>
            {lokasi(x) || "—"} · kontrol terakhir {tglPendek(x.terakhir)}{x.bermasalah ? " · terakhir berstatus Bermasalah" : ""}
          </div>
          {tab === "restok" && x.produk.slice(0, 3).map((p) => (
            <div key={p.produkId} style={{ fontSize: 11, color: T.gray600, marginTop: 2 }}>
              {p.nama}: stok {fmt(p.stok)}, ±{p.lajuPerHari}/hari → habis ±{tglPendek(p.habisTanggal)}
            </div>
          ))}
          {tab === "restok" && x.produk.length > 3 && (
            <div style={{ fontSize: 11, color: T.gray400, marginTop: 2 }}>+{x.produk.length - 3} produk lain</div>
          )}
        </div>
      ))}

      {daftar.length > BATAS_AWAL && (
        <button onClick={() => setSemua((v) => !v)}
          style={{ marginTop: 8, border: "none", background: "none", color: T.green, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
          {semua ? "Tampilkan lebih sedikit" : `Tampilkan semua (${daftar.length})`}
        </button>
      )}

      <div style={{ fontSize: 10.5, color: T.gray400, marginTop: 12, lineHeight: 1.5 }}>
        Perkiraan dari penjualan antar-kunjungan yang tercatat (jendela ±{hasil.opsi.jendelaTargetHari} hari), bukan kepastian.
        Produk dengan data kurang dari {hasil.opsi.jendelaMinHari} hari tidak ditandai
        {hasil.produkDataKurang ? ` (${hasil.produkDataKurang} produk)` : ""}.
        {hasil.tanpaRiwayat ? ` ${hasil.tanpaRiwayat} toko Aktif belum punya riwayat kontrol terlihat (baru, atau tahun lama belum dimuat).` : ""}
      </div>
    </Card>
  );
}

export const PerhatianToko = React.memo(PerhatianTokoImpl);
