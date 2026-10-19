import React from "react";
import { Badge, Card } from "../../components/ui";
import { hitungPeringatanToko, hariIniLokal } from "../../lib/analitikToko";
import { fmt } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tglPendek = (s) => (s && s.length >= 10 ? `${+s.slice(8, 10)} ${BULAN[+s.slice(5, 7) - 1]}` : "—");
const LEVEL = {
  habis:   { teks: "Perkiraan habis", warna: T.red },
  segera:  { teks: "Segera habis",    warna: T.orange },
  waspada: { teks: "Tak cukup s/d kunjungan",  warna: T.gold },
};
const BATAS_AWAL = 8;

function PerhatianTokoImpl({ db, salesWilayahId, dataStillSyncing }) {
  const [tab, setTab] = React.useState("restok");
  const [semua, setSemua] = React.useState(false);

  const hasil = React.useMemo(() => hitungPeringatanToko({
    toko: db.toko, kontrol: db.kontrol, rute: db.rute,
    produk: (db.produk || []).filter((p) => p.aktif !== false),
    hariIni: hariIniLokal(), wilayahId: salesWilayahId || "",
  }), [db.toko, db.kontrol, db.rute, db.produk, salesWilayahId]);

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
        <Icon.warning size={16} strokeWidth={2} style={{ display: "inline", verticalAlign: "-3px" }} /> Perlu Perhatian
      </div>
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
              : <Badge color={x.hari > 60 ? T.red : T.orange}>{x.hari} hari</Badge>}
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
        Perkiraan dari penjualan antar-kunjungan yang tercatat (jendela ±2 bulan), bukan kepastian.
        Produk dengan data kurang dari {hasil.opsi.jendelaMinHari} hari tidak ditandai
        {hasil.produkDataKurang ? ` (${hasil.produkDataKurang} produk)` : ""}.
        {hasil.tanpaRiwayat ? ` ${hasil.tanpaRiwayat} toko Aktif belum punya riwayat kontrol terlihat (baru, atau tahun lama belum dimuat).` : ""}
      </div>
    </Card>
  );
}

export const PerhatianToko = React.memo(PerhatianTokoImpl);
