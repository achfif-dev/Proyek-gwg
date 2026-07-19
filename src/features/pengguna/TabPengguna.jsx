import React, { useState } from "react";
import { Badge, Btn, Card, ExportMenu, Input, Modal, Table } from "../../components/ui";
import { SUPER_ADMIN_CANONICAL_ID, SUPER_ADMIN_EMAIL, isSuperAdminEmail } from "../../config/superAdmin";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { genUniqueId } from "../../lib/format";
import { T } from "../../theme/tokens";

export function TabPengguna({ db, addRecord, updateRecord, deleteRecord, isEmergencyAdmin, listDeletedUsers, restoreDeletedUser, activeUsers }) {
  // Set email (huruf kecil) yang punya minimal satu sesi aktif — dipakai
  // untuk badge "🟢 Online" per baris pengguna di tabel bawah.
  const activeEmailSet = new Set((activeUsers||[]).map(a => a.email?.toLowerCase()).filter(Boolean));
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nama:"", email:"", role:"Viewer", wilayahId:"" });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const ROLE_C = { Admin:T.red, Manajer:T.purple, Sales:T.green, Viewer:T.gray600 };

  // Daftar email yang sedang diblokir (pernah dihapus admin sehingga tidak
  // auto-register lagi). Dimuat sekali saat modal dibuka, dan setiap kali
  // ada perubahan (pulihkan), supaya daftar tetap akurat.
  const [showBlocked, setShowBlocked] = useState(false);
  const [blockedList, setBlockedList] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(false);

  async function muatBlockedList() {
    setBlockedLoading(true);
    const list = await listDeletedUsers();
    setBlockedList(list);
    setBlockedLoading(false);
  }

  function openBlockedModal() {
    setShowBlocked(true);
    muatBlockedList();
  }

  function pulihkanEmail(key) {
    restoreDeletedUser(key);
    setBlockedList(prev => prev.filter(b => b.key !== key));
  }

  const jumlahAdmin = (db.pengguna||[]).filter(p => p.role === "Admin").length;

  function openAdd() { setForm({ nama:"", email:"", role:"Viewer", wilayahId:"" }); setModal("add"); }
  function openEdit(row) {
    // SUPER ADMIN: baris ini terkunci total dari UI — tidak ada Admin lain
    // (atau siapapun) yang bisa mengubah role/email-nya lewat tab Pengguna.
    if (isSuperAdminEmail(row.email) && row.id === SUPER_ADMIN_CANONICAL_ID) {
      alert("Akun ini adalah Super Admin tetap dan tidak bisa diubah lewat tab Pengguna.");
      return;
    }
    setForm({ ...row });
    setModal("edit");
  }
  function submit() {
    if (!form.nama || !form.email) return alert("Nama & Email wajib diisi");
    const emailBaru = form.email.trim().toLowerCase();

    // CEGAH EMAIL DUPLIKAT: pastikan tidak ada baris LAIN dengan email yang
    // sama (case-insensitive), baik saat menambah maupun mengedit.
    const emailSudahDipakai = (db.pengguna||[]).some(p =>
      p.email?.trim().toLowerCase() === emailBaru && p.id !== form.id
    );
    if (emailSudahDipakai) {
      return alert("Email ini sudah terdaftar untuk pengguna lain. Gunakan email yang berbeda, atau edit baris pengguna yang sudah ada.");
    }

    // Tidak boleh membuat/mengubah baris manapun menjadi email Super Admin —
    // baris Super Admin hanya dikelola lewat auto-register & konstanta
    // SUPER_ADMIN_EMAIL di kode, bukan lewat form ini.
    if (isSuperAdminEmail(emailBaru) && !(modal === "edit" && isSuperAdminEmail((db.pengguna||[]).find(p=>p.id===form.id)?.email))) {
      return alert("Email ini terdaftar sebagai Super Admin sistem dan tidak bisa didaftarkan manual lewat sini.");
    }

    // Cegah admin terakhir diturunkan rolenya sendiri lewat form edit,
    // supaya sistem tidak pernah kehilangan akses Admin sama sekali.
    if (modal === "edit") {
      const existing = (db.pengguna||[]).find(p => p.id === form.id);
      const sedangMenurunkanAdminTerakhir =
        existing?.role === "Admin" && form.role !== "Admin" && jumlahAdmin <= 1;
      if (sedangMenurunkanAdminTerakhir) {
        return alert("Tidak bisa mengubah role Admin terakhir. Tambahkan Admin lain dahulu sebelum menurunkan role ini.");
      }
    }
    if (modal==="add") addRecord("pengguna", { ...form, id:genUniqueId("U") });
    else updateRecord("pengguna", form.id, form);
    setModal(null);
  }
  function hapusPengguna(id) {
    const row = (db.pengguna||[]).find(p => p.id === id);
    if (isSuperAdminEmail(row?.email) && row?.id === SUPER_ADMIN_CANONICAL_ID) {
      alert("Akun Super Admin tidak bisa dihapus.");
      return;
    }
    if (row?.role === "Admin" && jumlahAdmin <= 1) {
      alert("Tidak bisa menghapus Admin terakhir. Tambahkan Admin lain dahulu.");
      return;
    }
    deleteRecord("pengguna", id);
  }

  const wilayahOpts = [{ value:"", label:"Semua Wilayah" }, ...(db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }))];

  const cols = [
    { key:"id",    label:"ID",    render:v=><code style={{ fontSize:11 }}>{v}</code> },
    { key:"nama",  label:"Nama",  render:(v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>
          {activeEmailSet.has(row?.email?.toLowerCase()) && (
            <span title="Sedang aktif" style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, color:"#16A34A", background:"#DCFCE7", borderRadius:99, padding:"1px 7px" }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#22C55E" }} /> Online
            </span>
          )}
        </span>
      ) },
    { key:"email", label:"Email", render:v=><span style={{ color:T.blue }}>{v}</span> },
    { key:"role",  label:"Role",  render:(v,row)=>(
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Badge color={ROLE_C[v]||T.gray600}>{v}</Badge>
          {isSuperAdminEmail(row?.email) && <Badge color={T.gold}>👑 Super Admin</Badge>}
        </span>
      ) },
    { key:"wilayahId", label:"Wilayah", render:v=>v?<Badge color={T.green}>{(db.wilayah||[]).find(w=>w.id===v)?.nama||v}</Badge>:<span style={{ color:T.gray400 }}>Semua</span> },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>👤 Manajemen Pengguna</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.pengguna||[]).length} pengguna terdaftar</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <ExportMenu data={db.pengguna||[]} columns={cols} title="Data Pengguna" filename="pengguna" />
          <Btn variant="secondary" onClick={openBlockedModal} icon="🚫">Email Diblokir</Btn>
          <Btn onClick={openAdd} icon="＋">Tambah Pengguna</Btn>
        </div>
      </div>
      {isEmergencyAdmin && (
        <div style={{ background:T.redLt, border:`1.5px solid #FCA5A5`, borderRadius:10, padding:"12px 16px",
          marginBottom:16, fontSize:13, color:T.red, lineHeight:1.6, fontWeight:600 }}>
          🚨 Sistem mendeteksi tidak ada satupun pengguna dengan role <b>Admin</b> di database — Anda
          diberi akses Admin <b>sementara</b> agar bisa memperbaiki ini. Segera ubah role akun Anda
          (atau pengguna lain yang tepat) kembali menjadi <b>Admin</b> di tabel di bawah, supaya akses
          Admin permanen tidak hilang lagi.
        </div>
      )}
      <div style={{ background:T.blueLt, border:`1px solid #BFDBFE`, borderRadius:10, padding:"10px 14px",
        marginBottom:16, fontSize:12, color:T.gray600, lineHeight:1.6 }}>
        ℹ️ Akun Google baru yang login langsung muncul otomatis di tabel di bawah dengan role <b>Viewer</b> —
        tidak perlu input manual nama/email. Viewer hanya bisa <b>melihat</b> data (tab Dashboard, Kontrol, Rekap),
        tidak bisa mengubah apa pun. Admin atau Manajer cukup ubah role-nya (Admin/Manajer/Sales/Viewer)
        lewat tombol edit jika perlu memberi akses input data. Tab ini (Pengguna) khusus untuk <b>Admin</b>,
        dan akun <b>Super Admin</b> tetap (👑) tidak bisa diubah/dihapus siapapun lewat tab ini.
      </div>
      <Card padding={0}>
        <Table columns={cols} data={db.pengguna||[]} onEdit={openEdit}
          onDelete={hapusPengguna} />
      </Card>
      {modal && (
        <Modal title={modal==="add"?"Tambah Pengguna":"Edit Pengguna"} onClose={()=>setModal(null)}>
          <Input label="Nama Lengkap" value={form.nama} onChange={v=>f("nama",v)} required />
          <Input label="Email" value={form.email} onChange={v=>f("email",v)} type="email" required />
          <Input label="Role" value={form.role} onChange={v=>f("role",v)}
            options={["Admin","Manajer","Sales","Viewer"].map(r=>({ value:r, label:r }))} />
          <Input label="Wilayah Tugas" value={form.wilayahId} onChange={v=>f("wilayahId",v)} options={wilayahOpts} />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}
      {showBlocked && (
        <Modal title="🚫 Email Diblokir" onClose={()=>setShowBlocked(false)} width={560}>
          <div style={{ fontSize:12, color:T.gray600, lineHeight:1.6, marginBottom:16 }}>
            Email di bawah ini pernah dihapus dari tabel Pengguna, sehingga <b>tidak akan
            otomatis terdaftar ulang</b> walaupun pemiliknya login kembali dengan akun
            Google yang sama. Klik <b>Pulihkan</b> untuk mengizinkan email tersebut
            kembali ter-auto-register (sebagai role Viewer) saat login berikutnya.
          </div>
          {blockedLoading ? (
            <div style={{ textAlign:"center", padding:24, color:T.gray400, fontSize:13 }}>Memuat…</div>
          ) : blockedList.length === 0 ? (
            <div style={{ textAlign:"center", padding:24, color:T.gray400, fontSize:13 }}>
              Tidak ada email yang diblokir saat ini.
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {blockedList.map(b => (
                <div key={b.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  background:T.gray50, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"10px 14px" }}>
                  <span style={{ fontSize:13, color:T.gray800, wordBreak:"break-all" }}>{b.email}</span>
                  <Btn size="sm" variant="secondary" onClick={()=>pulihkanEmail(b.key)}>Pulihkan</Btn>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
            <Btn variant="secondary" onClick={()=>setShowBlocked(false)}>Tutup</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  LOGIN PAGE
// ─────────────────────────────────────────────
