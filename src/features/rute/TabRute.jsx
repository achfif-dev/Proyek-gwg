import React, { useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ExportMenu, FilterBar, Input, Modal, SearchableSelect, Table } from "../../components/ui";
import { genUniqueId, naturalCompare, normTxt, sortByNama } from "../../lib/format";
import { T } from "../../theme/tokens";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Icon } from "../../theme/icons.jsx";

function TabRuteImpl({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", wilayahId:"", keterangan:"" });
  // ✅ PERSISTEN: filter tetap sama setelah refresh / app dibuka ulang.
  const [filter, setFilter] = usePersistedState("rute.filter", { q:"", wilayahId:"" });
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
    // ✅ FIX (audit — sama seperti kasus Produk): menghapus Rute yang masih
    // dipakai Toko tidak akan error, tapi toko-toko itu jadi "nyasar" —
    // ruteId-nya menunjuk ke rute yang sudah tidak ada. Akibatnya: nama
    // rute/wilayah toko itu tampil "—" di Master Toko, DAN penjualannya
    // otomatis hilang dari rekap per-Rute/per-Wilayah (Dashboard, Tab
    // Rekap) — walau tetap terhitung normal di Total Pendapatan
    // keseluruhan (useAnalytics tidak butuh rute valid untuk itu). Beda
    // dari kasus Produk, ini TIDAK menghilangkan data dari laporan utama,
    // tapi bikin rekap regional pincang tanpa peringatan apa pun.
    const ruteDipakai = selectedIds.filter(id => (db.toko||[]).some(t=>t.ruteId===id));
    if (ruteDipakai.length > 0) {
      const nama = ruteDipakai.map(id => (db.rute||[]).find(r=>r.id===id)?.nama || id).join(", ");
      alert(`Tidak bisa menghapus ${ruteDipakai.length} rute karena masih dipakai toko: ${nama}.\n\nPindahkan atau hapus toko-toko di rute itu dulu, atau lewati rute ini dari pilihan.`);
      return;
    }
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
      alert(`Nama rute "${form.nama}" sudah ada di wilayah ini pada data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama rute yang berbeda.`);
      return;
    }
    // ✅ FIX ID-COLLISION (audit): dulu id rute baru = genId("RTE-", db.rute)
    // — nomor urut dihitung dari data LOKAL perangkat ini saja. Kalau 2
    // Admin/Manajer menambah rute baru hampir bersamaan di device berbeda
    // (data lokal belum sempat sinkron), keduanya bisa menghitung nomor
    // yang SAMA → id yang sama → yang sinkron ke Firebase belakangan
    // MENIMPA TOTAL punya yang duluan, tanpa pesan error. Karena ruteId
    // dipakai sebagai rujukan di ribuan toko/kontrol, ini bisa bikin toko
    // yang sudah menunjuk ke rute itu diam-diam "pindah" ke rute yang salah.
    // genUniqueId() (timestamp+random) praktis mustahil bentrok lintas
    // perangkat — sama seperti yang sudah dipakai untuk toko/kontrol/
    // penyesuaian sejak fix ID-collision sebelumnya.
    if (modal==="add") addRecord("rute", { ...form, id:genUniqueId("RTE-") });
    else updateRecord("rute", form.id, form);
    setModal(null);
  }

  const wilayahOpts = useMemo(() => sortByNama(db.wilayah).map(w=>({ value:w.id, label:w.nama })), [db.wilayah]);
  const ruteOptsGabung = useMemo(() => sorted.map(r=>({ value:r.id, label:`${r.nama} (${r.wilayahNama})` })), [sorted]);

  const cols = [
    { key:"id",          label:"ID",         render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"nama",        label:"Nama Rute",  render:v=><b>{v}</b> },
    { key:"wilayahNama", label:"Wilayah",    render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"jumlahToko",  label:"Toko",       render:v=><span style={{ fontWeight:700, color:T.blue }}>{v}</span> },
    { key:"keterangan",  label:"Keterangan" },
  ];

  function hapusRute(id) {
    const r = (db.rute||[]).find(x=>x.id===id);
    const namaRute = r?.nama || id;
    const tokoTerdampak = (db.toko||[]).filter(t=>t.ruteId===id).length;
    if (tokoTerdampak > 0) {
      alert(`Rute "${namaRute}" masih dipakai oleh ${tokoTerdampak} toko. Pindahkan atau hapus toko-toko itu dulu — kalau tidak, penjualan mereka akan diam-diam hilang dari rekap per-Rute/per-Wilayah walau tetap tercatat di Total Pendapatan keseluruhan.`);
      return;
    }
    if (!confirm(`Hapus rute "${namaRute}"?`)) return;
    deleteRecord("rute", id);
  }

  const [gabungModal, setGabungModal] = useState(false);
  const [gabungSumberId, setGabungSumberId] = useState("");
  const [gabungTujuanId, setGabungTujuanId] = useState("");

  function openGabungRute() {
    setGabungSumberId(""); setGabungTujuanId("");
    setGabungModal(true);
  }
  // ✅ FITUR: Gabungkan Rute — dipakai kalau ternyata 2 rute yang tadinya
  // dianggap beda ternyata sama (mis. salah eja/duplikat saat input awal),
  // atau memang ingin disatukan karena area kerjanya digabung. Beda dari
  // sekadar Hapus (yang sekarang diblokir kalau rute masih dipakai toko —
  // lihat hapusRute di bawah): ini memindahkan SEMUA toko & Penjualan Luar
  // Rute dari rute sumber ke rute tujuan dulu, baru menghapus rute sumber.
  // Karena entri Kontrol Bulanan TIDAK menyimpan ruteId sendiri (rute-nya
  // selalu diturunkan dari toko.ruteId saat laporan dibaca — lihat
  // enrichKontrol di useAnalytics.js), seluruh riwayat kontrol toko yang
  // dipindah otomatis "ikut" ke rute tujuan di semua laporan tanpa perlu
  // diedit satu-satu. Penjualan Luar Rute BEDA — menyimpan ruteId/wilayahId
  // sendiri secara eksplisit (karena tidak terikat toko tertentu), jadi
  // record-recordnya harus ikut dipindah manual di sini.
  function submitGabungRute() {
    if (!gabungSumberId || !gabungTujuanId) return alert("Pilih rute sumber & rute tujuan");
    if (gabungSumberId === gabungTujuanId) return alert("Rute sumber & tujuan tidak boleh sama");
    const ruteSumber = (db.rute||[]).find(r=>r.id===gabungSumberId);
    const ruteTujuan = (db.rute||[]).find(r=>r.id===gabungTujuanId);
    if (!ruteSumber || !ruteTujuan) return;

    const tokoTerdampak = (db.toko||[]).filter(t=>t.ruteId===gabungSumberId);
    const luarTerdampak = (db.penjualanLuar||[]).filter(pl=>pl.ruteId===gabungSumberId);

    // Cek toko yang namanya bakal bentrok di rute tujuan setelah digabung —
    // sekadar peringatan (tidak diblokir), sama seperti pendekatan yang
    // sudah dipakai di Import Toko untuk kasus duplikat nama.
    const tokoTujuanNama = new Set((db.toko||[]).filter(t=>t.ruteId===gabungTujuanId).map(t=>normTxt(t.nama)));
    const dup = tokoTerdampak.filter(t=>tokoTujuanNama.has(normTxt(t.nama)));

    let pesan = `Gabungkan rute "${ruteSumber.nama}" ke "${ruteTujuan.nama}"?\n\n`
      + `• ${tokoTerdampak.length} toko akan dipindah ke rute tujuan.\n`
      + (luarTerdampak.length ? `• ${luarTerdampak.length} catatan Penjualan Luar Rute ikut dipindah.\n` : "")
      + `• Rute "${ruteSumber.nama}" akan DIHAPUS setelah semua data dipindah.\n`
      + `• Riwayat Kontrol Bulanan & semua laporan otomatis mengikuti (tidak perlu diedit manual).`;
    if (dup.length > 0) {
      pesan += `\n\n⚠️ ${dup.length} nama toko bentrok dengan toko yang sudah ada di rute tujuan: ${dup.map(t=>t.nama).join(", ")}. Toko-toko ini tetap akan dipindah (dianggap toko berbeda) — periksa manual sesudahnya kalau perlu digabung juga.`;
    }
    if (!confirm(pesan)) return;

    tokoTerdampak.forEach(t => updateRecord("toko", t.id, { ruteId: gabungTujuanId }));
    // wilayahId ikut disamakan ke wilayah rute tujuan, jaga-jaga kalau rute
    // sumber & tujuan ternyata beda wilayah (merge lintas wilayah).
    luarTerdampak.forEach(pl => updateRecord("penjualanLuar", pl.id, { ruteId: gabungTujuanId, wilayahId: ruteTujuan.wilayahId }));
    deleteRecord("rute", gabungSumberId);
    setGabungModal(false);
    alert(`Selesai. ${tokoTerdampak.length} toko${luarTerdampak.length ? ` & ${luarTerdampak.length} penjualan luar rute` : ""} dipindah ke "${ruteTujuan.nama}".`);
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:7 }}><Icon.rute size={19} strokeWidth={2} /> Master Rute</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.rute||[]).length} rute aktif · terurut per wilayah & abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={data} columns={cols} title="Data Rute" filename="rute" />
          <Btn variant="secondary" onClick={openGabungRute} icon={Icon.shuffle}>Gabungkan Rute</Btn>
          <Btn onClick={openAdd} icon={Icon.add}>Tambah Rute</Btn>
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
          onDelete={hapusRute}
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
      {gabungModal && (
        <Modal title={<><Icon.shuffle size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Gabungkan Rute</>} onClose={()=>setGabungModal(false)}>
          <div style={{ fontSize:12, color:T.gray500, marginBottom:12 }}>
            Semua toko & Penjualan Luar Rute di rute sumber dipindah ke rute tujuan, lalu rute sumber dihapus. Riwayat Kontrol Bulanan otomatis ikut — tidak perlu diedit manual.
          </div>
          <SearchableSelect label="Rute Sumber (akan dihapus)" value={gabungSumberId} onChange={setGabungSumberId}
            options={ruteOptsGabung} required placeholder="Pilih rute yang mau digabungkan..." />
          <SearchableSelect label="Rute Tujuan (tetap ada)" value={gabungTujuanId} onChange={setGabungTujuanId}
            options={ruteOptsGabung.filter(o=>o.value!==gabungSumberId)} required placeholder="Pilih rute tujuan..." />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setGabungModal(false)}>Batal</Btn>
            <Btn onClick={submitGabungRute}>Gabungkan</Btn>
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

// ✅ PERFORMA: lihat komentar di Dashboard.jsx untuk alasan React.memo di sini.
export const TabRute = React.memo(TabRuteImpl);
