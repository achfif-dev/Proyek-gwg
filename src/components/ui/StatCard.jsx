import { T } from "../../theme/tokens";
import { Card } from "./Primitives";

export function StatCard({ label, value, sub, icon, color=T.green, bg, pending, pendingTitle }) {
  return (
    <Card className="gw-statcard" style={{ background:bg||color+"0D", border:`1.5px solid ${color}22`, position:"relative" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ minWidth:0 }}>
          <div className="gw-statcard-label" style={{ fontSize:11, fontWeight:700, color, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>
            {label}
            {/* ✅ Titik kecil berkedip: menandai angka ini masih bisa berubah
                karena data (biasanya kontrol/toko, tabel besar) masih terus
                disinkronkan di latar belakang — supaya angka yang tampak
                "kecil sebentar" saat sinkronisasi tidak disalahartikan
                sebagai data final/hilang. */}
            {pending && (
              <span title={pendingTitle||"Masih menyinkronkan data — angka ini bisa bertambah"}
                style={{ width:7, height:7, borderRadius:"50%", background:color, flexShrink:0,
                  animation:"gw-pulse 1.2s ease-in-out infinite" }} />
            )}
          </div>
          <div className="gw-statcard-value" style={{ fontSize:26, fontWeight:800, color:T.gray800, lineHeight:1.15, wordBreak:"break-word" }}>{value}</div>
          {sub && <div style={{ fontSize:12, color:T.gray400, marginTop:4 }}>{sub}{pending && <span style={{ color, fontWeight:700 }}> · masih memuat…</span>}</div>}
        </div>
        <div className="gw-statcard-icon" style={{ fontSize:28, opacity:.8, flexShrink:0, marginLeft:8 }}>{icon}</div>
      </div>
    </Card>
  );
}

