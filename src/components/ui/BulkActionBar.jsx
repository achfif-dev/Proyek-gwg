import { T } from "../../theme/tokens";
import { Btn } from "./Primitives";

export function BulkActionBar({ selectedIds, total, onSelectAll, onClearAll, onDeleteSelected, label="item" }) {
  if (selectedIds.length === 0) return null;
  const allSelected = selectedIds.length >= total;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
      background: T.redLt, border:`1.5px solid #FECACA`, borderRadius:10,
      padding:"10px 16px", marginBottom:10
    }}>
      <span style={{ fontSize:13, fontWeight:700, color:T.red }}>
        ✅ {selectedIds.length} {label} dipilih
      </span>
      <Btn variant="secondary" size="sm"
        onClick={allSelected ? onClearAll : onSelectAll}>
        {allSelected ? "✗ Batal Pilih Semua" : `☑ Pilih Semua (${total})`}
      </Btn>
      {selectedIds.length > 0 && (
        <Btn variant="danger" size="sm" icon="🗑"
          onClick={onDeleteSelected}>
          Hapus {selectedIds.length} Terpilih
        </Btn>
      )}
      <Btn variant="secondary" size="sm" onClick={onClearAll}>✗ Batal</Btn>
    </div>
  );
}

