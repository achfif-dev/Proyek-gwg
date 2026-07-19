import React, { useState } from "react";
import { Badge, Btn, Card, ExportMenu, Input, Modal, Table } from "../../components/ui";
import { fmtRp } from "../../lib/format";
import { T } from "../../theme/tokens";

export function TabProduk({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0 });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function openAdd() { setForm({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0 }); setModal("add"); }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.id || !form.nama || !form.harga) return alert("Kode, Nama, & Harga wajib diisi");
    if (modal==="add") {
      if ((db.produk||[]).find(p=>p.id===form.id)) return alert("Kode produk sudah ada!");
      addRecord("produk", { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0) });
    } else {
      updateRecord("produk", form.id, { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0) });
    }
    setModal(null);
  }

  const cols = [
    { key:"id",    label:"Kode",    render:v=><b style={{ color:T.blue }}>{v}</b> },
    { key:"nama",  label:"Nama Produk", render:v=><b>{v}</b> },
    { key:"tipe",  label:"Tipe",    render:v=><Badge color={T.purple}>{v||"—"}</Badge> },
    { key:"harga", label:"Harga (Rp)", render:v=><span style={{ fontWeight:700, color:T.green }}>{fmtRp(v)}</span> },
    { key:"bonus", label:"Bonus (pcs)", render:v=><span style={{ color:T.gold }}>{v?`${v} pcs`:"—"}</span> },
    { key:"aktif", label:"Aktif",   render:v=><Badge color={v?T.green:T.red}>{v?"Ya":"Tidak"}</Badge> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>🧴 Master Produk</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.produk||[]).length} produk · Tipe bisa diisi bebas</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={db.produk||[]} columns={cols} title="Data Produk" filename="produk" />
          <Btn onClick={openAdd} icon="＋">Tambah Produk</Btn>
        </div>
      </div>
      <Card padding={0}>
        <Table columns={cols} data={db.produk||[]} onEdit={openEdit}
          onDelete={id=>{ if(confirm("Hapus produk ini?")) deleteRecord("produk",id); }} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Produk":"Edit Produk"} onClose={()=>setModal(null)}>
          <Input label="Kode Produk" value={form.id} onChange={v=>f("id",v.toUpperCase())} required
            placeholder="cth: R, B, P, LP" disabled={modal==="edit"}
            hint="Kode unik 1–4 huruf, digunakan di Kontrol Bulanan" />
          <Input label="Nama Produk" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Roll On" />
          <Input label="Tipe Produk" value={form.tipe} onChange={v=>f("tipe",v)}
            placeholder="cth: Roll, Botol, Legend, Spray — isi bebas" hint="Ketik nama tipe secara manual" />
          <Input label="Harga Dasar (Rp)" value={form.harga} onChange={v=>f("harga",v)} type="number" required />
          <Input label="Bonus per Kontrol (pcs)" value={form.bonus||0} onChange={v=>f("bonus",v)} type="number"
            hint="Jumlah produk bonus yang diberikan ke toko per kunjungan kontrol (opsional)" />
          <Input label="Aktif" type="checkbox" value={form.aktif} onChange={v=>f("aktif",v)}
            placeholder="Tampilkan di kontrol bulanan" />
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
//  TAB KONTROL BULANAN
// ─────────────────────────────────────────────
