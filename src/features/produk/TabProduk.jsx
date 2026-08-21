import React, { useState } from "react";
import { Badge, Btn, Card, ExportMenu, Input, Modal, Table } from "../../components/ui";
import { fmtRp } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";

function TabProdukImpl({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0, hargaModal:0 });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function hapusProduk(id) {
    const p = (db.produk||[]).find(pp=>pp.id===id);
    const namaProduk = p?.nama || id;
    // ✅ FIX (audit — risiko kehilangan data historis SENYAP): sebelumnya
    // tombol Hapus di sini langsung deleteRecord("produk", id) tanpa cek
    // apa pun. Padahal useAnalytics.js (sumber SEMUA laporan — Dashboard,
    // Tab Rekap, Tab Bagi Hasil) menghitung totalRev/labaBersih dengan
    // MENGITERASI db.produk (produk yang MASIH ADA) untuk membaca field
    // `terjual_${p.id}` di tiap entri Kontrol/Penjualan Luar Rute. Begitu
    // sebuah produk dihapus permanen, SELURUH riwayat penjualannya —
    // sejak kapan pun produk itu pernah aktif — otomatis TIDAK TERHITUNG
    // LAGI di semua laporan, secara retroaktif & permanen, TANPA galat
    // atau peringatan apa pun (angka cuma "mengecil sendiri" diam-diam).
    // Produk sudah punya field `aktif` yang justru didesain untuk kasus
    // ini (non-aktifkan = berhenti muncul di form baru, riwayat tetap
    // utuh) — tombol Hapus permanen cuma cocok untuk produk yang
    // BENAR-BENAR belum pernah ada transaksi (salah input, dsb).
    // Catatan: pengecekan ini hanya menjangkau data kontrol/penjualan luar
    // rute yang SEDANG termuat (tahun berjalan + tahun live lainnya) —
    // tahun-tahun yang sudah diarsipkan (lihat archiveKontrolYear di
    // useDB.js) tidak ikut tercek di sini karena datanya sudah tidak ada
    // di state aktif.
    const adaTransaksiKontrol = (db.kontrol||[]).some(k => Number(k[`terjual_${id}`])>0 || Number(k[`stok_${id}`])>0 || Number(k[`bonusInput_${id}`])>0);
    const adaTransaksiLuar = (db.penjualanLuar||[]).some(pl => Number(pl[`terjual_${id}`])>0);
    if (adaTransaksiKontrol || adaTransaksiLuar) {
      alert(`Produk "${namaProduk}" tidak bisa dihapus karena masih punya riwayat transaksi (kontrol/penjualan luar rute) di data yang sedang termuat.\n\nMenghapusnya akan membuat SELURUH riwayat penjualan produk ini hilang dari semua laporan (Total Pendapatan, Laba Bersih, Bagi Hasil, dst) secara retroaktif & permanen — termasuk kemungkinan tahun-tahun lama yang sudah diarsipkan, yang tidak ikut tercek di sini.\n\nGunakan tombol Edit -> matikan "Aktif" untuk menghentikan produk ini muncul di form Kontrol baru, TANPA menghapus riwayat & laporan lama.`);
      return;
    }
    const adaDiToko = (db.toko||[]).some(t => t[`produk_${id}`] || (t.produkIds||[]).includes(id));
    if (adaDiToko && !confirm(`Produk "${namaProduk}" masih tercatat "dijual" di beberapa Master Toko (walau belum ada riwayat transaksi tercatat). Lanjut hapus?`)) return;
    if (!confirm(`Hapus produk "${namaProduk}"? Tindakan ini permanen.`)) return;
    deleteRecord("produk", id);
  }

  // ✅ Urutan tampil produk (dipakai di sini & di grid "Stok, Penjualan &
  // Bonus Produk" pada Tambah/Edit Kontrol Bulanan) — SEBELUMNYA urutan
  // cuma ikut urutan array mentah db.produk (urutan input pertama kali),
  // ditambah satu pengecualian hardcode: produk bernama "Roll On" selalu
  // dipaksa tampil paling depan lewat regex nama di TabKontrol.jsx. Itu
  // spesifik ke bisnis GWG dan tidak cocok untuk client white label lain
  // yang produknya beda. Sekarang diganti field `urutan` (angka) yang bisa
  // diatur admin lewat tombol ↑/↓ di bawah — generik untuk produk apa pun.
  //
  // Produk lama yang belum punya `urutan` (data existing sebelum fitur ini
  // ada) otomatis fallback ke posisi aslinya di array db.produk, supaya
  // urutan yang sudah ada di lapangan tidak tiba-tiba berubah/acak.
  const produkUrut = React.useMemo(() => {
    const withEff = (db.produk||[]).map((p,i) => ({ ...p, _eff: typeof p.urutan === "number" ? p.urutan : i }));
    return withEff.sort((a,b) => a._eff - b._eff);
  }, [db.produk]);

  function moveProduk(id, dir) {
    const idx = produkUrut.findIndex(p=>p.id===id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= produkUrut.length) return;
    const reordered = [...produkUrut];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // "Materialize" urutan 0..n-1 sesuai posisi baru — sekalian merapikan
    // produk lama yang tadinya masih pakai fallback (urutan belum tersimpan).
    reordered.forEach((p, i) => {
      if (p.urutan !== i) updateRecord("produk", p.id, { urutan: i });
    });
  }

  function openAdd() {
    // Produk baru ditaruh paling akhir secara default.
    const nextUrutan = produkUrut.length ? Math.max(...produkUrut.map(p=>p._eff)) + 1 : 0;
    setForm({ id:"", nama:"", tipe:"", harga:0, aktif:true, bonus:0, hargaModal:0, urutan: nextUrutan });
    setModal("add");
  }
  function openEdit(row) { setForm({ ...row }); setModal("edit"); }
  function submit() {
    if (!form.id || !form.nama || !form.harga) return alert("Kode, Nama, & Harga wajib diisi");
    if (modal==="add") {
      if ((db.produk||[]).find(p=>p.id===form.id)) return alert("Kode produk sudah ada!");
      addRecord("produk", { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0), hargaModal:Number(form.hargaModal||0) });
    } else {
      updateRecord("produk", form.id, { ...form, harga:Number(form.harga), bonus:Number(form.bonus||0), hargaModal:Number(form.hargaModal||0) });
    }
    setModal(null);
  }

  const cols = [
    { key:"_urutanBtn", label:"Urutan", render:(_,row) => {
        const idx = produkUrut.findIndex(p=>p.id===row.id);
        return (
          <div style={{ display:"flex", gap:4 }}>
            <button onClick={()=>moveProduk(row.id,-1)} disabled={idx<=0}
              title="Naikkan urutan"
              style={{ border:`1px solid ${T.gray200}`, background:idx<=0?T.gray50:"#fff",
                borderRadius:6, width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center",
                cursor:idx<=0?"default":"pointer", color:idx<=0?T.gray300:T.gray600 }}>
              <Icon.arrowUp size={13} strokeWidth={2.5}/>
            </button>
            <button onClick={()=>moveProduk(row.id,1)} disabled={idx>=produkUrut.length-1}
              title="Turunkan urutan"
              style={{ border:`1px solid ${T.gray200}`, background:idx>=produkUrut.length-1?T.gray50:"#fff",
                borderRadius:6, width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center",
                cursor:idx>=produkUrut.length-1?"default":"pointer", color:idx>=produkUrut.length-1?T.gray300:T.gray600 }}>
              <Icon.arrowDown size={13} strokeWidth={2.5}/>
            </button>
          </div>
        );
      } },
    { key:"id",    label:"Kode",    render:v=><b style={{ color:T.blue }}>{v}</b> },
    { key:"nama",  label:"Nama Produk", render:v=><b>{v}</b> },
    { key:"tipe",  label:"Tipe",    render:v=><Badge color={T.purple}>{v||"—"}</Badge> },
    { key:"harga", label:"Harga (Rp)", render:v=><span style={{ fontWeight:700, color:T.green }}>{fmtRp(v)}</span> },
    { key:"hargaModal", label:"HPP (Rp)", render:v=><span style={{ color:v?T.orange:T.gray300 }}>{v?fmtRp(v):"belum diisi"}</span> },
    { key:"bonus", label:"Bonus (pcs)", render:v=><span style={{ color:T.gold }}>{v?`${v} pcs`:"—"}</span> },
    { key:"aktif", label:"Aktif",   render:v=><Badge color={v?T.green:T.red}>{v?"Ya":"Tidak"}</Badge> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:7 }}><Icon.produk size={19} strokeWidth={2} /> Master Produk</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.produk||[]).length} produk · Tipe bisa diisi bebas · Urutan pakai tombol ↑/↓, dipakai juga di Kontrol Bulanan</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={db.produk||[]} columns={cols} title="Data Produk" filename="produk" />
          <Btn onClick={openAdd} icon={Icon.add}>Tambah Produk</Btn>
        </div>
      </div>
      <Card padding={0}>
        <Table columns={cols} data={produkUrut} onEdit={openEdit}
          onDelete={hapusProduk} />
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
          <Input label="Harga Modal / HPP (Rp)" value={form.hargaModal||0} onChange={v=>f("hargaModal",v)} type="number"
            hint="Opsional — harga pokok/modal produk ini. Dipakai di Neraca Keuangan untuk menghitung estimasi Laba Kotor Riil, terpisah dari asumsi Margin Laba % di tab Bagi Hasil." />
          <Input label="Bonus per Kontrol (pcs)" value={form.bonus||0} onChange={v=>f("bonus",v)} type="number"
            hint="Jumlah produk bonus yang diberikan ke toko per kunjungan kontrol (opsional)" />
          <Input label="Aktif" type="checkbox" value={form.aktif} onChange={v=>f("aktif",v)}
            placeholder="Tampilkan di kontrol bulanan" />
          <div style={{ fontSize:11, color:T.gray400, marginTop:-4, marginBottom:8 }}>
            Urutan tampil bisa diatur belakangan lewat tombol ↑/↓ di tabel Master Produk.
          </div>
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

// ✅ PERFORMA: lihat komentar di Dashboard.jsx untuk alasan React.memo di sini.
export const TabProduk = React.memo(TabProdukImpl);
