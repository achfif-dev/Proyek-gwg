import { useState, useEffect } from "react";
import { Icon } from "../theme/icons.jsx";
import { deriveSyncStatus } from "../lib/syncStatus";
import { salinLog } from "../lib/diagLog";

const WARNA = {
  ok:   { fg: "rgba(255,255,255,.8)", bg: "transparent" },
  info: { fg: "rgba(255,255,255,.95)", bg: "rgba(255,255,255,.18)" },
  warn: { fg: "#FCD34D", bg: "rgba(252,211,77,.25)" },
  bad:  { fg: "#FCA5A5", bg: "rgba(220,38,38,.35)" },
};

// Satu indikator sinkronisasi untuk seluruh header. Memakai status gabungan
// (lib/syncStatus.js). Di layar kecil label teks disembunyikan (gw-hide-xs),
// tetapi warna latar + ikon berputar + badge angka TETAP tampil, dan ketukan
// menampilkan penjelasan lengkap (tooltip `title` tidak ada di layar sentuh).
export function SyncIndicator({ variant = "inline", onDenied, ...input }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(t); }, []);
  const st = deriveSyncStatus({ ...input, now });
  const c = WARNA[st.level] || WARNA.ok;
  const IconCmp = Icon[st.icon] || Icon.cloud;
  const pill = variant === "pill" || st.level !== "ok";
  function ketuk(e) {
    e.stopPropagation();
    if (st.key === "ditolak" && onDenied) { onDenied(); return; }
    const info = `${st.count > 0 ? st.count + " " : ""}${st.label}\n\n${st.title}`;
    // Status bermasalah: salin log diagnosa ke clipboard (untuk ditempel ke chat) dan
    // tawarkan muat ulang SATU KETUKAN (antrean tersimpan di perangkat, aman).
    if (["macet", "putus", "error"].includes(st.key)) {
      salinLog(`status=${st.key} antrean=${st.count}`).then(ok => {
        const muat = window.confirm(`${info}\n\n${ok ? "Log diagnosa sudah disalin ke clipboard — tempelkan ke chat." : "(Log diagnosa gagal disalin.)"}\n\nMuat ulang aplikasi sekarang? Data yang belum terkirim tetap aman dan dikirim setelah dimuat ulang.`);
        if (muat) window.location.reload();
      });
      return;
    }
    alert(info);
  }
  return (
    <span role="status" aria-live="polite" onClick={ketuk} title={st.title}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", color: c.fg,
        background: pill ? c.bg : "transparent", borderRadius: 99, padding: pill ? "1px 8px" : 0,
        fontSize: 10, fontWeight: st.level === "ok" ? 400 : 700, whiteSpace: "nowrap" }}>
      <span className={st.spin ? "gw-spin" : undefined} style={{ display: "inline-flex" }}>
        <IconCmp size={11} strokeWidth={2.5} />
      </span>
      {st.count > 0 && <span style={{ fontWeight: 800 }}>{st.count}</span>}
      <span className="gw-hide-xs">{st.label}</span>
    </span>
  );
}
