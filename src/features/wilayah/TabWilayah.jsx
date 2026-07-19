import React, { useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ExportMenu, FilterBar, Input, Modal, Table } from "../../components/ui";
import { genId, normTxt, sortByNama } from "../../lib/format";
import { T } from "../../theme/tokens";

export function TabWilayah({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", deskripsi:"" });
  const [filter, setFilter] = useState({ q:"" });
  const [selectedIds, setSelectedIds] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  // Deteksi wilayah duplikat (nama sama, tidak case-sensitive, abaikan spasi
  // berlebih) yang mungkin sudah kadung tersimpan dari sebelum validasi
  // duplikat ini ada, atau dari sinkronisasi ganda antar perangkat.
  // Dikelompokkan supaya bisa digabungkan jadi satu wilayah saja.
  const dupGroups = useMemo(() => {
    const map = new Map();
    (db.wilayah||[]).forEach(w => {
      const key = normTxt(w.nama);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(w);
    });
    return [...map.values()].filter(g => g.length > 1);
  }, [db.wilayah]);
  const totalDup = dupGroups.reduce((n,g) => n + (g.length-1), 0);

  // Gabungkan setiap grup duplikat menjadi satu wilayah "utama" (yang dipilih
  // adalah wilayah dengan ID terlama / pertama dibuat, supaya rute & toko yang
  // sudah lama terhubung tidak berubah ID rujukannya). Semua rute yang tadinya
  // menunjuk ke wilayah duplikat dialihkan ke wilayah utama, baru kemudian
  // wilayah duplikatnya dihapus. Aman dipakai berkali-kali (idempotent).
  function mergeDuplikat() {
    if (totalDup === 0) return;
    const ringkasan = dupGroups.map(g => `• "${g[0].nama}" — ${g.length} entri`).join("\n");
    if (!confirm(`Ditemukan ${dupGroups.length} nama wilayah yang duplikat:\n\n${ringkasan}\n\nSemua rute yang terhubung akan dialihkan ke satu wilayah utama (yang paling lama dibuat), lalu data duplikatnya dihapus. Lanjutkan?`)) return;

    dupGroups.forEach(group => {
      const sortedGroup = [...group].sort((a,b) => String(a.id).localeCompare(String(b.id)));
      const utama = sortedGroup[0];
      sortedGroup.slice(1).forEach(dup => {
        (db.rute||[]).filter(r => r.wilayahId === dup.id).forEach(r => {
          updateRecord("rute", r.id, { wilayahId: utama.id });
        });
        deleteRecord("wilayah", dup.id);
      });
    });
    alert("✅ Wilayah duplikat berhasil digabungkan.");
  }

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} wilayah terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("wilayah", id));
    setSelectedIds([]);
  }

  // Urutkan Master Wilayah berdasarkan abjad nama wilayah, otomatis
  // mengikutkan data baru kapan pun ditambahkan.
  const sorted = useMemo(() => sortByNama(db.wilayah), [db.wilayah]);

  const data = useMemo(() => sorted.filter(w =>
    !filter.q || w.nama.toLowerCase().includes(filter.q.toLowerCase())
  ), [sorted, filter]);

  const enriched = data.map(w => ({
    ...w,
    jumlahRute: (db.rute||[]).filter(r=>r.wilayahId===w.id).length,
    jumlahToko: (db.toko||[]).filter(t=>{
      const rute=(db.rute||[]).find(r=>r.id===t.ruteId);
      return rute?.wilayahId===w.id;
    }).length,
    isDuplikat: dupGroups.some(g => g.some(x=>x.id===w.id)),
  }));

  function openAdd() { setForm({ nama:"", deskripsi:"" }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.nama) return alert("Nama wajib diisi");
    // Validasi duplikat: nama wilayah yang sama (tidak case-sensitive, abaikan spasi
    // berlebih) dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.wilayah||[]).some(w =>
      normTxt(w.nama) === normTxt(form.nama) && w.id !== form.id
    );
    if (isDup) {
      alert(`⚠️ Nama wilayah "${form.nama}" sudah ada di data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama wilayah yang berbeda.`);
      return;
    }
    if (modal==="add") addRecord("wilayah", { ...form, id:genId("WIL-",db.wilayah) });
    else updateRecord("wilayah", form.id, form);
    setModal(null);
  }

  const cols = [
    { key:"id",        label:"ID",         render: v=><Badge color={T.blue}>{v}</Badge> },
    { key:"nama",      label:"Nama Wilayah", render: (v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>{row.isDuplikat && <Badge color={T.red}>⚠️ Duplikat</Badge>}
        </span>
      ) },
    { key:"deskripsi", label:"Deskripsi" },
    { key:"jumlahRute",label:"Rute",       render: v=><Badge color={T.teal}>{v} rute</Badge> },
    { key:"jumlahToko",label:"Toko",       render: v=><Badge color={T.green}>{v} toko</Badge> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📍 Master Wilayah</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.wilayah||[]).length} wilayah terdaftar · terurut abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={enriched} columns={cols} title="Data Wilayah" filename="wilayah" />
          {totalDup > 0 && (
            <Btn variant="danger" onClick={mergeDuplikat} icon="🧹">
              Gabungkan {totalDup} Duplikat
            </Btn>
          )}
          <Btn onClick={openAdd} icon="＋">Tambah Wilayah</Btn>
        </div>
      </div>
      {totalDup > 0 && (
        <div style={{ background:T.redLt, color:T.red, padding:"10px 14px", borderRadius:10,
          fontSize:13, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
          ⚠️ Ditemukan nama wilayah yang duplikat (mis. dua "Bangkalan Utara"). Ini bisa membuat
          nama wilayah muncul dua kali di semua filter. Klik <b>"Gabungkan {totalDup} Duplikat"</b> untuk
          merapikannya secara otomatis — rute yang terhubung akan dipindah ke satu wilayah utama.
        </div>
      )}
      <FilterBar filters={[{ key:"q", label:"Cari Wilayah", value:filter.q }]}
        onChange={(k,v)=>setFilter(p=>({...p,[k]:v}))} onReset={()=>setFilter({q:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={enriched.length}
        onSelectAll={()=>toggleSelectAll(enriched, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="wilayah" />
      <Card padding={0}>
        <Table columns={cols} data={enriched} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus wilayah ini?")) deleteRecord("wilayah",id); }}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Wilayah":"Edit Wilayah"} onClose={()=>setModal(null)}>
          <Input label="Nama Wilayah" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Bangkalan Utara" />
          <Input label="Deskripsi" value={form.deskripsi} onChange={v=>f("deskripsi",v)} type="textarea" />
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
//  TAB RUTE
// ─────────────────────────────────────────────
