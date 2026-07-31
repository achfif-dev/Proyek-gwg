import { T } from "../../theme/tokens";
import { Btn } from "./Primitives";
import { Icon } from "../../theme/icons.jsx";

export function BulkActionBar({ selectedIds, total, onSelectAll, onClearAll, onDeleteSelected, label="item", extraActions }) {
  if (selectedIds.length === 0) return null;
  const allSelected = selectedIds.length >= total;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
      background: T.redLt, border:`1.5px solid #FECACA`, borderRadius:10,
      padding:"10px 16px", marginBottom:10
    }}>
      <span style={{ fontSize:13, fontWeight:700, color:T.red, display:"flex", alignItems:"center", gap:6 }}>
        <Icon.checkCircle size={15} strokeWidth={2} />
        {selectedIds.length} {label} dipilih
      </span>
      <Btn variant="secondary" size="sm"
        icon={allSelected ? Icon.close : Icon.checkSquare}
        onClick={allSelected ? onClearAll : onSelectAll}>
        {allSelected ? "Batal Pilih Semua" : `Pilih Semua (${total})`}
      </Btn>
      {/* ✅ Slot aksi massal tambahan (mis. Pindah Rute Massal di Master
          Toko) — dirender di antara aksi bawaan supaya bisa dipakai lintas
          tab tanpa mengubah signature onDeleteSelected. */}
      {extraActions}
      {selectedIds.length > 0 && (
        <Btn variant="danger" size="sm" icon={Icon.delete}
          onClick={onDeleteSelected}>
          Hapus {selectedIds.length} Terpilih
        </Btn>
      )}
      <Btn variant="secondary" size="sm" icon={Icon.close} onClick={onClearAll}>Batal</Btn>
    </div>
  );
}

