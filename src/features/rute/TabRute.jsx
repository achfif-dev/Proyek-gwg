import React, { useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ExportMenu, FilterBar, Input, Modal, SearchableSelect, Table } from "../../components/ui";
import { genId, naturalCompare, normTxt, sortByNama } from "../../lib/format";
import { T } from "../../theme/tokens";

export function TabRute({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", wilayahId:"", keterangan:"" });
  const [filter, setFilter] = useState({ q:"", wilayahId:"" });
  const [selectedIds, setSelectedIds] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} rute terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("rute", id));
    setSelectedIds([]);
  }

  const enriched = useMemo(() => (db.rute||[]).map(r => ({
    ...r,
    wilayahNama: (db.wilayah||[]).find(w=>w.id===r.wilayahId)?.nama||"—",
    jumlahToko: (db.toko||[]).filter(t=>t.ruteId===r.id).length,
  })), [db]);

  // Urutkan Master Rute berdasarkan Wilayah dahulu (abjad), lalu Nama Rute
  // (natural sort: angka di akhir nama diurutkan sebagai angka, jadi
  // Bklu1, Bklu2, ... Bklu10 — bukan Bklu1, Bklu10, Bklu2 secara alfabetis).
  // Otomatis berlaku untuk rute baru yang ditambahkan kapan pun.
  const sorted = useMemo(() => [...enriched].sort((a,b) => {
    const wCompare = a.wilayahNama.localeCompare(b.wilayahNama, "id", { sensitivity:"base" });
    if (wCompare !== 0) return wCompare;
    return naturalCompare(a.nama, b.nama);
  }), [enriched]);

  const data = useMemo(() => sorted.filter(r =>
    (!filter.q || r.nama.toLowerCase().includes(filter.q.toLowerCase())) &&
    (!filter.wilayahId || r.wilayahId===filter.wilayahId)
  ), [sorted, filter]);

  function openAdd() { setForm({ nama:"", wilayahId:"", keterangan:"" }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.nama || !form.wilayahId) return alert("Nama & Wilayah wajib diisi");
    // Validasi duplikat: nama rute yang sama (tidak case-sensitive) DI DALAM
    // wilayah yang sama dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.rute||[]).some(r =>
      normTxt(r.nama) === normTxt(form.nama) && r.wilayahId === form.wilayahId && r.id !== form.id
    );
    if (isDup) {
      alert(`⚠️ Nama rute "${form.nama}" sudah ada di wilayah ini pada data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama rute yang berbeda.`);
      return;
    }
    if (modal==="add") addRecord("rute", { ...form, id:genId("RTE-",db.rute) });
    else updateRecord("rute", form.id, form);
    setModal(null);
  }

  const wilayahOpts = useMemo(() => sortByNama(db.wilayah).map(w=>({ value:w.id, label:w.nama })), [db.wilayah]);

  const cols = [
    { key:"id",          label:"ID",         render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"nama",        label:"Nama Rute",  render:v=><b>{v}</b> },
    { key:"wilayahNama", label:"Wilayah",    render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahToko",  label:"Toko",       render:v=><span style={{ fontWeight:700, color:T.blue }}>{v}</span> },
    { key:"keterangan",  label:"Keterangan" },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>🛣️ Master Rute</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.rute||[]).length} rute aktif · terurut per wilayah & abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={data} columns={cols} title="Data Rute" filename="rute" />
          <Btn onClick={openAdd} icon="＋">Tambah Rute</Btn>
        </div>
      </div>
      <FilterBar filters={[
        { key:"q", label:"Cari Rute", value:filter.q },
        { key:"wilayahId", label:"Filter Wilayah", value:filter.wilayahId, options:wilayahOpts },
      ]} onChange={(k,v)=>setFilter(p=>({...p,[k]:v}))} onReset={()=>setFilter({q:"",wilayahId:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={data.length}
        onSelectAll={()=>toggleSelectAll(data, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="rute" />
      <Card padding={0}>
        <Table columns={cols} data={data} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus rute ini?")) deleteRecord("rute",id); }}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Rute":"Edit Rute"} onClose={()=>setModal(null)}>
          <Input label="Nama Rute" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Rute Utara A" />
          <SearchableSelect label="Wilayah" value={form.wilayahId} onChange={v=>f("wilayahId",v)} options={wilayahOpts} required placeholder="Cari wilayah..." />
          <Input label="Keterangan" value={form.keterangan} onChange={v=>f("keterangan",v)} type="textarea" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB TOKO (dengan stok terintegrasi)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  AUTO-UPGRADE: Toko status "Baru" → "Aktif" setelah 1 bulan (30 hari)
// ─────────────────────────────────────────────
