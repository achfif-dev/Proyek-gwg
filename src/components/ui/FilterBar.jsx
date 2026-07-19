import { T } from "../../theme/tokens";
import { Btn } from "./Primitives";

export function FilterBar({ filters, onChange, onReset }) {
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
            <input value={f.value} onChange={e=>onChange(f.key, e.target.value)}
              placeholder={f.placeholder||"Cari..."} type={f.type||"text"}
              style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
          )}
        </div>
      ))}
      <Btn variant="secondary" size="sm" onClick={onReset} icon="↺">Reset</Btn>
    </div>
  );
}

