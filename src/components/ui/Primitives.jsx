import { useState, useEffect, useRef } from "react";
import { T } from "../../theme/tokens";

export function Badge({ children, color=T.green, bg }) {
  return (
    <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:20,
      background: bg || color+"18", color, fontSize:11, fontWeight:700, letterSpacing:"0.03em" }}>
      {children}
    </span>
  );
}

export function Btn({ children, onClick, variant="primary", size="md", icon, disabled, style={} }) {
  const base = { display:"flex", alignItems:"center", gap:6, border:"none", borderRadius:8,
    cursor:disabled?"not-allowed":"pointer", fontWeight:600, fontFamily:"inherit",
    transition:"all .15s", opacity:disabled?0.5:1, ...style };
  const variants = {
    primary:   { background:T.green,  color:"#fff",     padding:size==="sm"?"6px 14px":"9px 20px", fontSize:size==="sm"?12:13 },
    secondary: { background:T.white,  color:T.gray800,  border:`1.5px solid ${T.gray200}`, padding:size==="sm"?"5px 13px":"8px 19px", fontSize:size==="sm"?12:13 },
    danger:    { background:T.redLt,  color:T.red,      border:`1.5px solid #FCA5A5`, padding:size==="sm"?"5px 13px":"8px 19px", fontSize:size==="sm"?12:13 },
    gold:      { background:T.gold,   color:"#fff",     padding:size==="sm"?"6px 14px":"9px 20px", fontSize:size==="sm"?12:13 },
  };
  return (
    <button onClick={disabled?undefined:onClick} style={{ ...base, ...variants[variant] }}>
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
}

export function Card({ children, style={}, padding=20, className }) {
  return (
    <div className={className} style={{ background:T.white, borderRadius:14, border:`1px solid ${T.gray200}`,
      padding, boxShadow:"0 1px 4px rgba(0,0,0,.05)", ...style }}>
      {children}
    </div>
  );
}

export function Input({ label, value, onChange, type="text", placeholder="", required, options, hint, disabled }) {
  const id = `inp-${label}-${Math.random().toString(36).slice(2,6)}`;
  const s = { width:"100%", padding:"9px 12px", border:`1.5px solid ${T.gray200}`,
    borderRadius:8, fontSize:13, fontFamily:"inherit", outline:"none",
    background: disabled ? T.gray50 : T.white, boxSizing:"border-box", color:T.gray800 };
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      {options ? (
        <select value={value} onChange={e=>onChange(e.target.value)} style={s} disabled={disabled}>
          <option value="">— Pilih —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type==="checkbox" ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, paddingTop:4 }}>
          <input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}
            style={{ width:16, height:16, accentColor:T.green }} />
          <span style={{ fontSize:13, color:T.gray600 }}>{placeholder}</span>
        </div>
      ) : type==="textarea" ? (
        <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{ ...s, resize:"vertical", minHeight:72 }} disabled={disabled} />
      ) : (
        <input type={type} value={value} onChange={e=>onChange(e.target.value)}
          placeholder={placeholder} style={s} disabled={disabled} />
      )}
      {hint && <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>{hint}</div>}
    </div>
  );
}

// Dropdown dengan kotak pencarian di dalamnya — dipakai untuk Wilayah/Rute
// yang opsinya bisa banyak, agar lebih mudah mencari saat input data.
export function SearchableSelect({ label, value, onChange, options, required, placeholder="Cari...", hint, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const s = { width:"100%", padding:"9px 12px", border:`1.5px solid ${T.gray200}`,
    borderRadius:8, fontSize:13, fontFamily:"inherit", outline:"none",
    background: disabled ? T.gray50 : T.white, boxSizing:"border-box", color:T.gray800,
    cursor: disabled ? "not-allowed" : "pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, minWidth:0 };

  return (
    <div style={{ marginBottom:14, position:"relative", minWidth:0 }} ref={boxRef}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <div style={s} onClick={()=>{ if(!disabled){ setOpen(o=>!o); } }}>
        <span style={{ color: selected ? T.gray800 : T.gray400, display:"flex", alignItems:"center", gap:6, overflow:"hidden", minWidth:0, flex:1 }}>
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0, flexShrink:1 }}>{selected ? selected.label : "— Pilih —"}</span>
          {selected?.sudahDikontrol && (
            <span title="Toko ini sudah ada entri kontrol pada tanggal yang dipilih" style={{ flexShrink:0, fontSize:10, fontWeight:700,
              color:T.green, background:T.greenLt, border:`1px solid ${T.green}55`, borderRadius:99, padding:"1px 6px" }}>✅ Sudah</span>
          )}
          {/* Badge generik kedua — dipakai untuk penanda lain di luar "sudah dikontrol
              hari ini", mis. "belum pernah dikontrol periode ini" di Kontrol Bulanan.
              Cuma tampil kalau sudahDikontrol tidak aktif, supaya tidak dobel badge
              untuk toko yang sama. */}
          {!selected?.sudahDikontrol && selected?.extraBadge && (
            <span title={selected.extraBadge.title||""} style={{ flexShrink:0, fontSize:10, fontWeight:700,
              color:selected.extraBadge.color, background:selected.extraBadge.bg,
              border:`1px solid ${selected.extraBadge.color}55`, borderRadius:99, padding:"1px 6px", whiteSpace:"nowrap" }}>{selected.extraBadge.label}</span>
          )}
        </span>
        <span style={{ color:T.gray400, fontSize:11, flexShrink:0 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && !disabled && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, marginTop:4, background:T.white,
          border:`1.5px solid ${T.gray200}`, borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.12)",
          zIndex:50, maxHeight:260, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          <div style={{ padding:8, borderBottom:`1px solid ${T.gray100}` }}>
            <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={placeholder}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
          </div>
          <div style={{ overflowY:"auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding:"12px", fontSize:12, color:T.gray400, textAlign:"center" }}>Tidak ditemukan</div>
            ) : filtered.map(o => (
              <div key={o.value} onClick={()=>{ onChange(o.value); setOpen(false); setQ(""); }}
                style={{ padding:"9px 12px", fontSize:13, cursor:"pointer", color:T.gray800,
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, minWidth:0,
                  background: o.value===value ? T.greenLt : T.white }}
                onMouseEnter={e=>e.currentTarget.style.background=T.gray50}
                onMouseLeave={e=>e.currentTarget.style.background = o.value===value ? T.greenLt : T.white}>
                <span style={{ minWidth:0, wordBreak:"break-word" }}>{o.label}</span>
                {/* ✅ Badge: toko ini sudah ada entri kontrol pada tanggal yang sedang dipilih di form */}
                {o.sudahDikontrol && (
                  <span title="Sudah dikontrol pada tanggal ini" style={{ flexShrink:0, fontSize:10, fontWeight:700,
                    color:T.green, background:T.greenLt, border:`1px solid ${T.green}55`, borderRadius:99, padding:"1px 6px", whiteSpace:"nowrap" }}>✅ Sudah</span>
                )}
                {/* Badge kedua (generik) — hanya tampil kalau badge "Sudah" di atas tidak aktif,
                    supaya tiap toko maksimal 1 badge saja di daftar (tidak berantakan) */}
                {!o.sudahDikontrol && o.extraBadge && (
                  <span title={o.extraBadge.title||""} style={{ flexShrink:0, fontSize:10, fontWeight:700,
                    color:o.extraBadge.color, background:o.extraBadge.bg,
                    border:`1px solid ${o.extraBadge.color}55`, borderRadius:99, padding:"1px 6px", whiteSpace:"nowrap" }}>{o.extraBadge.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {hint && <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>{hint}</div>}
    </div>
  );
}

export function Modal({ title, children, onClose, width=480 }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.white, borderRadius:16, width:"100%", maxWidth:width,
        maxHeight:"90vh", overflowY:"auto", overflowX:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,.2)", boxSizing:"border-box" }}>
        <div className="gw-modal-header" style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"18px 24px", borderBottom:`1px solid ${T.gray200}`,
          position:"sticky", top:0, background:T.white, zIndex:1 }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.gray800 }}>{title}</div>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", fontSize:20, color:T.gray400 }}>×</button>
        </div>
        <div className="gw-modal-body" style={{ padding:24, boxSizing:"border-box", minWidth:0 }}>{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDelete({ onConfirm, onCancel, label }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:2000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:T.white, borderRadius:14, padding:28, maxWidth:360, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,.2)", textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🗑️</div>
        <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:8 }}>Hapus data ini?</div>
        <div style={{ fontSize:13, color:T.gray500, marginBottom:20 }}>{label || "Tindakan ini tidak dapat dibatalkan."}</div>
        <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
          <Btn variant="secondary" onClick={onCancel}>Batal</Btn>
          <Btn variant="danger" onClick={onConfirm}>Ya, Hapus</Btn>
        </div>
      </div>
    </div>
  );
}
