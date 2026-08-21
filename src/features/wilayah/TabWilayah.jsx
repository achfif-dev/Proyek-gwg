import React, { useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ExportMenu, FilterBar, Input, Modal, SearchableSelect, Table } from "../../components/ui";
import { genUniqueId, normTxt, sortByNama } from "../../lib/format";
import { T } from "../../theme/tokens";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Icon } from "../../theme/icons.jsx";

function TabWilayahImpl({ db, addRecord, updateRecord, deleteRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", deskripsi:"" });
  // ✅ PERSISTEN: filter tetap sama setelah refresh / app dibuka ulang.
  const [filter, setFilter] = usePersistedState("wilayah.filter", { q:"" });
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
        // ✅ FIX (audit): Penjualan Luar Rute menyimpan wilayahId-nya SENDIRI
        // secara langsung (tidak selalu lewat rute — field ruteId di sana
        // opsional), jadi tidak ikut ter-alihkan otomatis lewat pemindahan
        // rute di atas. Sebelumnya record-record ini dibiarkan menunjuk ke
        // wilayah duplikat yang baru saja dihapus — diam-diam "nyasar" dan
        // hilang dari rekap per-Wilayah setelahnya.
        (db.penjualanLuar||[]).filter(pl => pl.wilayahId === dup.id).forEach(pl => {
          updateRecord("penjualanLuar", pl.id, { wilayahId: utama.id });
        });
        deleteRecord("wilayah", dup.id);
      });
    });
    alert("Wilayah duplikat berhasil digabungkan.");
  }

  const [gabungModal, setGabungModal] = useState(false);
  const [gabungSumberId, setGabungSumberId] = useState("");
  const [gabungTujuanId, setGabungTujuanId] = useState("");

  function openGabungWilayah() {
    setGabungSumberId(""); setGabungTujuanId("");
    setGabungModal(true);
  }
  // ✅ FITUR: Gabungkan Wilayah (manual, nama BOLEH beda) — beda dari
  // mergeDuplikat() di atas yang cuma otomatis-mendeteksi nama PERSIS sama.
  // Dipakai kalau dua wilayah dengan nama berbeda memang ingin disatukan
  // (mis. reorganisasi area kerja). Memindahkan semua Rute & Penjualan Luar
  // Rute dari wilayah sumber ke tujuan dulu, baru menghapus wilayah sumber
  // — toko ikut otomatis karena wilayah toko selalu diturunkan dari
  // rute.wilayahId, tidak perlu disentuh terpisah.
  function submitGabungWilayah() {
    if (!gabungSumberId || !gabungTujuanId) return alert("Pilih wilayah sumber & wilayah tujuan");
    if (gabungSumberId === gabungTujuanId) return alert("Wilayah sumber & tujuan tidak boleh sama");
    const wilSumber = (db.wilayah||[]).find(w=>w.id===gabungSumberId);
    const wilTujuan = (db.wilayah||[]).find(w=>w.id===gabungTujuanId);
    if (!wilSumber || !wilTujuan) return;

    const ruteTerdampak = (db.rute||[]).filter(r=>r.wilayahId===gabungSumberId);
    const luarTerdampak = (db.penjualanLuar||[]).filter(pl=>pl.wilayahId===gabungSumberId);

    // Cek nama rute yang bakal bentrok di wilayah tujuan setelah digabung —
    // sekadar peringatan (tidak diblokir), sama seperti pendekatan yang
    // sudah dipakai di Gabungkan Rute untuk kasus duplikat nama toko.
    const ruteTujuanNama = new Set((db.rute||[]).filter(r=>r.wilayahId===gabungTujuanId).map(r=>normTxt(r.nama)));
    const dup = ruteTerdampak.filter(r=>ruteTujuanNama.has(normTxt(r.nama)));

    let pesan = `Gabungkan wilayah "${wilSumber.nama}" ke "${wilTujuan.nama}"?\n\n`
      + `• ${ruteTerdampak.length} rute (beserta seluruh toko di dalamnya) akan dipindah ke wilayah tujuan.\n`
      + (luarTerdampak.length ? `• ${luarTerdampak.length} catatan Penjualan Luar Rute ikut dipindah.\n` : "")
      + `• Wilayah "${wilSumber.nama}" akan DIHAPUS setelah semua data dipindah.`;
    if (dup.length > 0) {
      pesan += `\n\n⚠️ ${dup.length} nama rute bentrok dengan rute yang sudah ada di wilayah tujuan: ${dup.map(r=>r.nama).join(", ")}. Rute-rute ini tetap akan dipindah (dianggap rute berbeda) — periksa manual sesudahnya kalau perlu digabung juga (pakai tombol Gabungkan Rute).`;
    }
    if (!confirm(pesan)) return;

    ruteTerdampak.forEach(r => updateRecord("rute", r.id, { wilayahId: gabungTujuanId }));
    luarTerdampak.forEach(pl => updateRecord("penjualanLuar", pl.id, { wilayahId: gabungTujuanId }));
    deleteRecord("wilayah", gabungSumberId);
    setGabungModal(false);
    alert(`Selesai. ${ruteTerdampak.length} rute${luarTerdampak.length ? ` & ${luarTerdampak.length} penjualan luar rute` : ""} dipindah ke "${wilTujuan.nama}".`);
  }

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    // ✅ FIX (audit — sama seperti kasus Rute/Produk): wilayah yang masih
    // dipakai Rute (dan lewat rute itu, Toko) kalau dihapus akan bikin
    // rute-rute itu "nyasar" — penjualan tokonya diam-diam hilang dari
    // rekap per-Wilayah walau tetap terhitung di Total Pendapatan.
    const wilayahDipakai = selectedIds.filter(id => (db.rute||[]).some(r=>r.wilayahId===id));
    if (wilayahDipakai.length > 0) {
      const nama = wilayahDipakai.map(id => (db.wilayah||[]).find(w=>w.id===id)?.nama || id).join(", ");
      alert(`Tidak bisa menghapus ${wilayahDipakai.length} wilayah karena masih dipakai rute: ${nama}.\n\nPindahkan atau hapus rute-rute di wilayah itu dulu, atau lewati wilayah ini dari pilihan.`);
      return;
    }
    if (!confirm(`Hapus ${selectedIds.length} wilayah terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("wilayah", id));
    setSelectedIds([]);
  }

  // Urutkan Master Wilayah berdasarkan abjad nama wilayah, otomatis
  // mengikutkan data baru kapan pun ditambahkan.
  const sorted = useMemo(() => sortByNama(db.wilayah), [db.wilayah]);
  const wilayahOptsGabung = useMemo(() => sorted.map(w=>({ value:w.id, label:w.nama })), [sorted]);

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
      alert(`Nama wilayah "${form.nama}" sudah ada di data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama wilayah yang berbeda.`);
      return;
    }
    // ✅ FIX ID-COLLISION (audit): dulu id wilayah baru = genId("WIL-",
    // db.wilayah) — nomor urut dihitung dari data LOKAL perangkat ini saja.
    // Kalau dua orang menambah wilayah baru hampir bersamaan di perangkat
    // berbeda sebelum sempat saling sync, keduanya bisa menghasilkan id yang
    // SAMA persis (mis. dua-duanya "WIL-004") — tulisan yang belakangan
    // sampai ke Firebase akan MENIMPA yang pertama (path per-id), bukan
    // menambah data baru. Pola persis sama sudah diperbaiki di Rute/Toko/
    // Kontrol/Pengguna (lihat komentar FIX ID-COLLISION di file-file itu),
    // tapi Wilayah sempat terlewat. Sekarang pakai genUniqueId() (timestamp
    // + random, basis-36) yang praktis mustahil bentrok lintas perangkat.
    if (modal==="add") addRecord("wilayah", { ...form, id:genUniqueId("WIL-") });
    else updateRecord("wilayah", form.id, form);
    setModal(null);
  }

  const cols = [
    { key:"id",        label:"ID",         render: v=><Badge color={T.blue}>{v}</Badge> },
    { key:"nama",      label:"Nama Wilayah", render: (v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>{row.isDuplikat && <Badge color={T.red}><Icon.warning size={10} strokeWidth={2.5} style={{verticalAlign:"-1px", marginRight:2}}/>Duplikat</Badge>}
        </span>
      ) },
    { key:"deskripsi", label:"Deskripsi" },
    { key:"jumlahRute",label:"Rute",       render: v=><Badge color={T.teal}>{v} rute</Badge> },
    { key:"jumlahToko",label:"Toko",       render: v=><Badge color={T.green}>{v} toko</Badge> },
  ];

  function hapusWilayah(id) {
    const w = (db.wilayah||[]).find(x=>x.id===id);
    const namaWilayah = w?.nama || id;
    const ruteTerdampak = (db.rute||[]).filter(r=>r.wilayahId===id).length;
    if (ruteTerdampak > 0) {
      alert(`Wilayah "${namaWilayah}" masih dipakai oleh ${ruteTerdampak} rute. Pindahkan atau hapus rute-rute itu dulu — kalau tidak, penjualan toko di rute tersebut akan diam-diam hilang dari rekap per-Wilayah walau tetap tercatat di Total Pendapatan keseluruhan.`);
      return;
    }
    if (!confirm(`Hapus wilayah "${namaWilayah}"?`)) return;
    deleteRecord("wilayah", id);
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:7 }}><Icon.wilayah size={19} strokeWidth={2} /> Master Wilayah</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.wilayah||[]).length} wilayah terdaftar · terurut abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={enriched} columns={cols} title="Data Wilayah" filename="wilayah" />
          {totalDup > 0 && (
            <Btn variant="danger" onClick={mergeDuplikat} icon={Icon.eraser}>
              Gabungkan {totalDup} Duplikat
            </Btn>
          )}
          <Btn variant="secondary" onClick={openGabungWilayah} icon={Icon.shuffle}>Gabungkan Wilayah</Btn>
          <Btn onClick={openAdd} icon={Icon.add}>Tambah Wilayah</Btn>
        </div>
      </div>
      {totalDup > 0 && (
        <div style={{ background:T.redLt, color:T.red, padding:"10px 14px", borderRadius:10,
          fontSize:13, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
          <Icon.warning size={15} strokeWidth={2} style={{flexShrink:0}} /> Ditemukan nama wilayah yang duplikat (mis. dua "Bangkalan Utara"). Ini bisa membuat
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
          onDelete={hapusWilayah}
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
      {gabungModal && (
        <Modal title={<><Icon.shuffle size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Gabungkan Wilayah</>} onClose={()=>setGabungModal(false)}>
          <div style={{ fontSize:12, color:T.gray500, marginBottom:12 }}>
            Semua rute (beserta toko di dalamnya) & Penjualan Luar Rute di wilayah sumber dipindah ke wilayah tujuan, lalu wilayah sumber dihapus.
          </div>
          <SearchableSelect label="Wilayah Sumber (akan dihapus)" value={gabungSumberId} onChange={setGabungSumberId}
            options={wilayahOptsGabung} required placeholder="Pilih wilayah yang mau digabungkan..." />
          <SearchableSelect label="Wilayah Tujuan (tetap ada)" value={gabungTujuanId} onChange={setGabungTujuanId}
            options={wilayahOptsGabung.filter(o=>o.value!==gabungSumberId)} required placeholder="Pilih wilayah tujuan..." />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setGabungModal(false)}>Batal</Btn>
            <Btn onClick={submitGabungWilayah}>Gabungkan</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB RUTE
// ─────────────────────────────────────────────

// ✅ PERFORMA: lihat komentar di Dashboard.jsx untuk alasan React.memo di sini.
export const TabWilayah = React.memo(TabWilayahImpl);
