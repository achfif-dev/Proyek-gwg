import { useState, useEffect } from "react";
import { T } from "../../theme/tokens";
import { Btn, ConfirmDelete } from "./Primitives";

export function Table({ columns, data, onEdit, onDelete, rowStyle, selectedIds, onToggleSelect, onToggleSelectAll, pageSize = 50 }) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const hasSelection = !!(onToggleSelect && onToggleSelectAll);

  // PAGINATION: dulu semua baris `data` dirender sekaligus ke DOM tanpa
  // batas. Kalau tabel (Toko, Kontrol, dst) sudah berisi ribuan baris, ini
  // bikin pindah tab terasa berat — karena tab yang tidak aktif di-unmount
  // total, jadi setiap kali dibuka lagi, browser harus membangun ulang
  // RIBUAN elemen <tr> dari nol. Dengan membatasi jumlah baris yang
  // dirender per halaman, pindah tab jadi jauh lebih cepat tanpa mengubah
  // apapun di sisi pemanggil (Table dipakai bersama oleh semua tab).
  const [page, setPage] = useState(1);
  // Reset ke halaman 1 setiap kali dataset (hasil filter/pencarian) berubah,
  // supaya tidak "nyangkut" di halaman kosong setelah pencarian dipersempit.
  useEffect(() => { setPage(1); }, [data]);

  if (!data || !data.length) return (
    <div style={{ textAlign:"center", padding:40, color:T.gray400, fontSize:13 }}>
      Belum ada data. Klik <b>+ Tambah</b> untuk menambahkan.
    </div>
  );

  // "Pilih semua" tetap mengacu ke SELURUH data hasil filter (semua
  // halaman), bukan cuma baris yang sedang tampil di halaman ini — supaya
  // perilaku bulk-select tidak berubah gara-gara pagination.
  const allChecked = hasSelection && data.length > 0 && data.every(row => (selectedIds||[]).includes(row.id));
  const someChecked = hasSelection && (selectedIds||[]).some(id => data.find(r=>r.id===id));

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageData = data.slice(startIdx, startIdx + pageSize);

  return (
    <>
      {deleteTarget && (
        <ConfirmDelete
          label={`Data akan dihapus permanen.`}
          onConfirm={() => { onDelete(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
              {hasSelection && (
                <th style={{ padding:"10px 14px", width:36 }}>
                  <input type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={() => onToggleSelectAll(data, allChecked)}
                    style={{ accentColor:T.green, width:15, height:15, cursor:"pointer" }} />
                </th>
              )}
              {columns.map(c => (
                <th key={c.key} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700,
                  color:T.gray600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>
                  {c.label}
                </th>
              ))}
              {(onEdit||onDelete) && (
                <th style={{ padding:"10px 14px", textAlign:"right", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>AKSI</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => {
              const isSelected = hasSelection && (selectedIds||[]).includes(row.id);
              const rowBg = isSelected ? T.greenLt : (rowStyle ? (rowStyle(row) || (i%2===0 ? T.white : T.gray50)) : (i%2===0 ? T.white : T.gray50));
              return (
                <tr key={row.id||(startIdx+i)} style={{ borderBottom:`1px solid ${T.gray100}`, background:rowBg, transition:"background .1s" }}>
                  {hasSelection && (
                    <td style={{ padding:"10px 14px", width:36 }}>
                      <input type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(row.id)}
                        style={{ accentColor:T.green, width:15, height:15, cursor:"pointer" }} />
                    </td>
                  )}
                  {columns.map(c => (
                    <td key={c.key} style={{ padding:"10px 14px", color:T.gray800, verticalAlign:"middle" }}>
                      {c.render ? c.render(row[c.key], row) : (row[c.key] ?? "—")}
                    </td>
                  ))}
                  {(onEdit||onDelete) && (
                    <td style={{ padding:"8px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                        {onEdit && <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>onEdit(row)}>Edit</Btn>}
                        {onDelete && <Btn variant="danger" size="sm" icon="🗑" onClick={()=>setDeleteTarget(row.id)}>Hapus</Btn>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.length > pageSize && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10,
          padding:"12px 14px", borderTop:`1px solid ${T.gray100}` }}>
          <div style={{ fontSize:12, color:T.gray400 }}>
            Menampilkan {startIdx+1}–{Math.min(startIdx+pageSize, data.length)} dari {data.length} data
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <Btn variant="secondary" size="sm" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Sebelumnya</Btn>
            <span style={{ fontSize:12, color:T.gray600, fontWeight:600 }}>Halaman {safePage} / {totalPages}</span>
            <Btn variant="secondary" size="sm" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya ›</Btn>
          </div>
        </div>
      )}
    </>
  );
}

