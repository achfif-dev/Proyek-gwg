import { useState, useEffect, useRef } from "react";
import { T } from "../../theme/tokens";
import { Btn } from "./Primitives";
import { Icon } from "../../theme/icons.jsx";

// Kolom teks bebas: nilai diketik ditahan di state LOKAL dan baru diteruskan ke induk
// setelah jeda (DEBOUNCE_MS) / saat blur / Enter. Sebelumnya setiap ketukan mengubah
// state induk (Tab Kontrol ±4000 baris kode) sehingga seluruh tab dirender ulang
// per huruf — terasa "lemot" tepat saat daftar masih besar (0–2 huruf).
const DEBOUNCE_MS = 250;
function InputTeks({ value, onCommit, placeholder, style }) {
  const [lokal, setLokal] = useState(value ?? "");
  const timerRef = useRef(null);
  const komitRef = useRef(value ?? "");
  useEffect(() => {
    // Perubahan dari luar (mis. dipulihkan/reset) → ikuti, kecuali sedang mengetik.
    if (timerRef.current == null && (value ?? "") !== komitRef.current) { komitRef.current = value ?? ""; setLokal(value ?? ""); }
  }, [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const komit = (v) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (v !== komitRef.current) { komitRef.current = v; onCommit(v); }
  };
  return (
    <input value={lokal} placeholder={placeholder} type="text" style={style}
      onChange={e => {
        const v = e.target.value; setLokal(v);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { timerRef.current = null; komit(v); }, DEBOUNCE_MS);
      }}
      onBlur={() => komit(lokal)}
      onKeyDown={e => { if (e.key === "Enter") komit(lokal); }} />
  );
}

export function FilterBar({ filters, onChange, onReset }) {
  // Reset harus membuang ketikan yang masih tertunda → kunci input diganti agar dipasang ulang.
  const [resetKey, setResetKey] = useState(0);
  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14,
      background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"12px 16px" }}>
      {filters.map(f => (
        <div key={f.key} style={{ minWidth:140, flex:1 }}>
          <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>{f.label}</div>
          {f.options ? (
            <select value={f.value} onChange={e=>onChange(f.key, e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
              <option value="">Semua</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            (!f.type || f.type === "text") ? (
              <InputTeks key={`${f.key}-${resetKey}`} value={f.value} onCommit={v=>onChange(f.key, v)}
                placeholder={f.placeholder||"Cari..."}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                  borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
            ) : (
              <input value={f.value} onChange={e=>onChange(f.key, e.target.value)}
                placeholder={f.placeholder||"Cari..."} type={f.type}
                style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                  borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
            )
          )}
        </div>
      ))}
      <Btn variant="secondary" size="sm" onClick={() => { setResetKey(k => k + 1); onReset(); }} icon={Icon.undo}>Reset</Btn>
    </div>
  );
}

