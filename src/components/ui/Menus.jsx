import { useState, useEffect, useLayoutEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { T } from "../../theme/tokens";
import { Btn, Modal, Badge } from "./Primitives";
import { exportCSV, exportExcel, exportHTML, exportJSON, exportPDF, exportJPG } from "../../lib/exportUtils";

export function useClampedMenuPosition(open, anchorRef, menuWidth = 230) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) { setStyle(null); return; }
    const update = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(menuWidth, window.innerWidth - margin * 2);
      let left = rect.right - width; // default: rata kanan ke tombol
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      setStyle({ position:"fixed", top: rect.bottom + 4, left, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, menuWidth]);
  return style;
}

// Menu "hamburger" dipakai di header aplikasi untuk mengelompokkan tombol
// aksi admin (Backup Cepat, Backup, Reset DB) supaya header tidak penuh /
// berantakan di layar HP. Posisinya memakai hook clamped yang sama supaya
// selalu terlihat penuh di dalam layar.
export function HeaderMenu({ items, icon="☰", title="Menu" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 240);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  if (!items?.length) return null;
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <button onClick={() => setOpen(o=>!o)} title={title}
        style={{ display:"flex", alignItems:"center", justifyContent:"center", width:34, height:34,
          background:"rgba(255,255,255,.12)", color:"#fff", border:"1px solid rgba(255,255,255,.2)",
          borderRadius:8, cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>
        {icon}
      </button>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.16)", zIndex:250, overflow:"hidden",
          maxHeight:"75vh", overflowY:"auto" }}>
          {items.map((it, i) => (
            it.divider ? (
              <div key={i} style={{ borderTop:`1px solid ${T.gray200}`, margin:"4px 0" }} />
            ) : (
              <button key={i} onClick={() => { it.onClick?.(); setOpen(false); }}
                style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
                  background: it.active ? T.greenLt : "none", cursor:"pointer", fontSize:13, fontFamily:"inherit",
                  fontWeight: it.active ? 700 : 400,
                  color: it.danger ? T.red : (it.active ? T.green : T.gray800),
                  borderBottom: i<items.length-1 ? `1px solid ${T.gray100}` : "none" }}
                onMouseEnter={e => e.target.style.background = it.danger ? T.redLt : (it.active ? T.greenLt : T.gray50)}
                onMouseLeave={e => e.target.style.background = it.active ? T.greenLt : "none"}>
                {it.active ? "✓ " : ""}{it.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// Import Menu Component — Download Template & Upload Excel
export function ImportMenu({ label="Import", onTemplate, onParseRows }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // { title, message, dupList, onConfirm }
  const fileRef = useRef(null);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 230);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type:"array" });
        const sheetName = wb.SheetNames.find(n=>!/petunjuk/i.test(n)) || wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval:"" });
        const res = onParseRows(rows);
        // Jika hasil parsing menemukan baris yang berpotensi duplikat, jangan
        // langsung commit — tanyakan dulu ke user mau tetap ditambahkan atau
        // dilewati, baru tampilkan hasil akhir setelah dikonfirmasi.
        if (res && res.needsConfirm) setPending(res);
        else setResult(res);
      } catch (err) {
        setResult({ added:0, skipped:0, errors:["Gagal membaca file: " + err.message] });
      }
    };
    reader.onerror = () => setResult({ added:0, skipped:0, errors:["Gagal membaca file."] });
    reader.readAsArrayBuffer(file);
  }

  function resolvePending(includeDuplicates) {
    const finalRes = pending.onConfirm(includeDuplicates);
    setPending(null);
    setResult(finalRes);
  }

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <Btn variant="secondary" size="sm" icon="📥" onClick={() => setOpen(!open)}>{label}</Btn>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:200, overflow:"hidden" }}>
          <button onClick={() => { onTemplate(); setOpen(false); }}
            style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
              background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800,
              borderBottom:`1px solid ${T.gray100}` }}
            onMouseEnter={e => e.target.style.background=T.gray50}
            onMouseLeave={e => e.target.style.background="none"}>
            ⬇️ Download Template Excel
          </button>
          <button onClick={() => { fileRef.current?.click(); setOpen(false); }}
            style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
              background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800 }}
            onMouseEnter={e => e.target.style.background=T.gray50}
            onMouseLeave={e => e.target.style.background="none"}>
            ⬆️ Upload File Excel
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleFile} />
      {pending && (
        <Modal title={pending.title || "⚠️ Data Duplikat Ditemukan"} onClose={()=>setPending(null)}>
          <div style={{ fontSize:13, color:T.gray800, marginBottom:10 }}>{pending.message}</div>
          <div style={{ maxHeight:220, overflow:"auto", fontSize:12, color:T.red, background:T.redLt,
            borderRadius:8, padding:"10px 12px", lineHeight:1.7, marginBottom:14 }}>
            {pending.dupList.map((d,i) => <div key={i}>• {d}</div>)}
          </div>
          <div style={{ fontSize:12, color:T.gray400, marginBottom:14 }}>
            Pilih "Lewati Duplikat" (disarankan) agar tidak ada nama toko yang sama dalam satu rute,
            atau "Tetap Tambahkan Semua" jika duplikat ini memang disengaja.
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
            <Btn variant="secondary" onClick={()=>setPending(null)}>Batalkan Impor</Btn>
            <Btn variant="danger" onClick={()=>resolvePending(true)}>Tetap Tambahkan Semua</Btn>
            <Btn onClick={()=>resolvePending(false)}>Lewati Duplikat</Btn>
          </div>
        </Modal>
      )}
      {result && (
        <Modal title="📊 Hasil Import Excel" onClose={()=>setResult(null)}>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            <Badge color={T.green}>{result.added} berhasil ditambahkan</Badge>
            {result.skipped > 0 && <Badge color={T.red}>{result.skipped} baris dilewati</Badge>}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ maxHeight:260, overflow:"auto", fontSize:12, color:T.red, background:T.redLt,
              borderRadius:8, padding:"10px 12px", lineHeight:1.7 }}>
              {result.errors.map((e,i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {result.errors?.length===0 && result.added>0 && (
            <div style={{ fontSize:13, color:T.green, fontWeight:600 }}>✅ Semua baris berhasil diimpor tanpa error.</div>
          )}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
            <Btn onClick={()=>setResult(null)}>Tutup</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Export Menu Component
// exportData / exportCols: data & kolom khusus untuk file ekspor (CSV/Excel/PDF/JPG)
//   jika tidak diberikan, memakai data & columns yang sama dengan tampilan.
export function ExportMenu({ data, columns, title, filename, exportData, exportCols }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuStyle = useClampedMenuPosition(open, ref, 180);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const eData = exportData || data;
  const eCols = exportCols || columns;
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <Btn variant="secondary" size="sm" icon="📤" onClick={() => setOpen(!open)}>Ekspor</Btn>
      {open && menuStyle && (
        <div style={{ ...menuStyle, background:T.white, border:`1px solid ${T.gray200}`,
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:200, overflow:"hidden" }}>
          {[
            { label:"📊 CSV", action: () => { exportCSV(eData, eCols, filename); setOpen(false); } },
            { label:"🟢 Excel (.xlsx)", action: () => { exportExcel(eData, eCols, title, filename); setOpen(false); } },
            { label:"🌐 HTML", action: () => { exportHTML(eData, eCols, title, filename); setOpen(false); } },
            { label:"📋 JSON", action: () => { exportJSON(eData, filename); setOpen(false); } },
            { label:"📄 PDF Landscape", action: () => { exportPDF(eData, eCols, title, filename); setOpen(false); } },
            { label:"🖼️ JPG", action: () => { exportJPG(eData, eCols, title, filename); setOpen(false); } },
          ].map((opt, i) => (
            <button key={i} onClick={opt.action}
              style={{ display:"block", width:"100%", padding:"10px 16px", textAlign:"left", border:"none",
                background:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", color:T.gray800,
                borderBottom: i<5 ? `1px solid ${T.gray100}` : "none" }}
              onMouseEnter={e => e.target.style.background=T.gray50}
              onMouseLeave={e => e.target.style.background="none"}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
