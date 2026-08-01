import React, { useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ExportMenu, FilterBar, ImportMenu, Input, Modal, SearchableSelect, Table } from "../../components/ui";
import { fmt, fmtRp, genId, genUniqueId, naturalCompare, normTxt, sortByNama } from "../../lib/format";
import { downloadTokoTemplate } from "../../lib/importUtils";
import { appendStatusHistory, buildProdukFlagUpdates, recalcTokoStok } from "../../lib/dataHelpers";
import { T } from "../../theme/tokens";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Icon } from "../../theme/icons.jsx";

export function autoUpgradeBaruToAktif(db, updateRecord) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  (db.toko||[]).forEach(toko => {
    if (toko.status !== "Baru") return;
    if (!toko.tanggalMasuk) return;
    const masuk = new Date(toko.tanggalMasuk);
    if (isNaN(masuk.getTime())) return;
    if (masuk <= thirtyDaysAgo) {
      // Sudah lebih dari 30 hari, upgrade ke Aktif — dicatat juga di
      // riwayat status supaya Rekap Siklus Wilayah bisa merekonstruksi
      // status toko ini secara akurat pada tanggal berapa pun di masa lalu.
      updateRecord("toko", toko.id, { status: "Aktif",
        statusHistory: appendStatusHistory(toko.statusHistory, "Aktif", todayStr, "Otomatis: 30 hari sejak Tanggal Masuk (Baru → Aktif)") });
    }
  });
}

export function TabToko({ db, addRecord, updateRecord, deleteRecord, save, salesWilayahId, isSalesRestricted }) {
  const [modal, setModal] = useState(null);
  const [stokModal, setStokModal] = useState(null);
  const [form, setForm] = useState({ nama:"", ruteId:"", status:"Aktif", produkIds:[], catatan:"" });
  const [formWilayahId, setFormWilayahId] = useState(""); // wilayah filter di form toko
  const [stokForm, setStokForm] = useState({});
  // ✅ PERSISTEN: filter tetap sama setelah refresh / app dibuka ulang.
  const [filter, setFilter] = usePersistedState("toko.filter", { q:"", ruteId:"", wilayahId:"", status:"", produkId:"" });
  // Filter untuk panel Daftar Stok Produk
  const [stokFilter, setStokFilter] = usePersistedState("toko.stokFilter", { q:"", ruteId:"", wilayahId:"", produkId:"" });
  // ✅ Nilai wilayahId yang tersimpan bisa saja "sisa" dari sesi Admin
  // sebelumnya di perangkat yang sama — untuk Sales, kosongkan filter
  // wilayah supaya dropdown tidak menampilkan pilihan yang sebenarnya
  // tidak relevan (data intinya sudah aman terkunci di query `filtered`
  // di bawah, ini murni supaya tampilan filter tidak membingungkan).
  React.useEffect(() => {
    if (!isSalesRestricted) return;
    if (filter.wilayahId && filter.wilayahId !== salesWilayahId) setFilter(f => ({ ...f, wilayahId: "" }));
    if (stokFilter.wilayahId && stokFilter.wilayahId !== salesWilayahId) setStokFilter(f => ({ ...f, wilayahId: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesRestricted, salesWilayahId]);
  const [showStokPanel, setShowStokPanel] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  // ✅ Pindah Rute Massal: migrasi banyak toko sekaligus ke rute lain lewat
  // ceklis (mis. saat rute lama dipecah/digabung, atau toko-toko dipindah
  // ke sales/rute baru) — sebelumnya cuma bisa satu-satu lewat Edit Toko.
  const [pindahRuteModal, setPindahRuteModal] = useState(false);
  const [pindahRuteWilayahId, setPindahRuteWilayahId] = useState(""); // filter wilayah di modal
  const [pindahRuteTarget, setPindahRuteTarget] = useState("");
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} toko terpilih? Tindakan ini permanen.`)) return;
    selectedIds.forEach(id => deleteRecord("toko", id));
    setSelectedIds([]);
  }
  function openPindahRuteMassal() {
    setPindahRuteWilayahId("");
    setPindahRuteTarget("");
    setPindahRuteModal(true);
  }
  function submitPindahRuteMassal() {
    if (!pindahRuteTarget) return alert("Pilih rute tujuan terlebih dahulu");
    const ruteTujuan = (db.rute||[]).find(r=>r.id===pindahRuteTarget);
    if (!confirm(`Pindahkan ${selectedIds.length} toko terpilih ke rute "${ruteTujuan?.nama||""}"?`)) return;
    // ✅ FIX: sebelumnya baris ini memakai save({ ...db, toko: newToko }),
    // yang menulis ULANG SELURUH tabel toko sebagai satu set() raksasa —
    // rawan gagal total kalau ada SATU SAJA toko (di luar yang dipindah)
    // dengan field yang tidak lolos .validate Firebase. Sekarang hanya toko
    // yang benar-benar dipindah rutenya yang dikirim, satu per satu.
    selectedIds.forEach(id => updateRecord("toko", id, { ruteId: pindahRuteTarget }));
    setPindahRuteModal(false);
    setSelectedIds([]);
  }

  // ⚡ OPTIMISASI PERFORMA (data toko ~5.000 baris): versi sebelumnya
  // memakai `.find()` di dalam `.map()` untuk mencari rute/wilayah TIAP
  // baris toko — O(toko × rute), dan dependensi `[db]` berarti hitung ulang
  // SEMUA 5.000 baris ini setiap kali TABEL APA PUN berubah (bukan cuma
  // toko/rute/wilayah — edit 1 produk pun ikut memicu). Sama seperti bug
  // yang sudah diperbaiki di useAnalytics.js & TabKontrol.jsx, diganti ke
  // Map lookup O(1) + dependensi dipersempit ke tabel yang benar-benar
  // dipakai di sini.
  const ruteByIdToko = useMemo(() => new Map((db.rute||[]).map(r => [r.id, r])), [db.rute]);
  const wilayahByIdToko = useMemo(() => new Map((db.wilayah||[]).map(w => [w.id, w])), [db.wilayah]);
  const enriched = useMemo(() => (db.toko||[]).map(t => {
    const rute = ruteByIdToko.get(t.ruteId) || null;
    const wilayah = rute ? (wilayahByIdToko.get(rute.wilayahId) || null) : null;
    return { ...t, ruteNama:rute?.nama||"—", wilayahNama:wilayah?.nama||"—", wilayahId:wilayah?.id||"" };
  }), [db.toko, ruteByIdToko, wilayahByIdToko]);

  // Urutkan Master Toko berdasarkan abjad Nama Toko sebagai default,
  // agar lebih mudah dicari/diinput meski data terus bertambah.
  const sorted = useMemo(() => sortByNama(enriched), [enriched]);

  const data = useMemo(() => sorted.filter(t =>
    (!isSalesRestricted || t.wilayahId===salesWilayahId) && // Sales cuma boleh lihat/edit toko wilayahnya sendiri
    (!filter.q || t.nama.toLowerCase().includes(filter.q.toLowerCase()) || t.kode?.toLowerCase().includes(filter.q.toLowerCase())) &&
    (!filter.ruteId || t.ruteId===filter.ruteId) &&
    (!filter.wilayahId || t.wilayahId===filter.wilayahId) &&
    (!filter.status || t.status===filter.status) &&
    (!filter.produkId || t[`produk_${filter.produkId}`]) // hanya toko yang dititipkan produk ini
  ), [sorted, filter, isSalesRestricted, salesWilayahId]);

  const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);
  // Opsi dropdown untuk filter "Produk" — daftar produk aktif, terurut abjad,
  // dipakai untuk menyaring toko berdasarkan produk yang dititipkan di sana
  // (flag produk_<id> === true pada masing-masing toko).
  const produkOptsForFilter = useMemo(() =>
    sortByNama(produkAktif).map(p=>({ value:p.id, label:p.nama }))
  , [produkAktif]);

  function openAdd() {
    setForm({ nama:"", ruteId:"", status:"Aktif", produkIds:[], catatan:"" });
    setFormWilayahId("");
    setModal("add");
  }
  function openEdit(row) {
    const produkIds = produkAktif.filter(p=>row[`produk_${p.id}`]).map(p=>p.id);
    // Set wilayah filter sesuai rute toko yang sedang diedit
    const ruteObj = (db.rute||[]).find(r=>r.id===row.ruteId);
    setFormWilayahId(ruteObj?.wilayahId || "");
    setForm({ ...row, produkIds });
    setModal("edit");
  }
  function submit() {
    if (!form.nama || !form.ruteId) return alert("Nama & Rute wajib diisi");
    // Validasi duplikat toko: nama toko yang sama (tidak case-sensitive) DI
    // DALAM rute yang sama dengan data yang sudah ada tidak boleh disimpan.
    const isDup = (db.toko||[]).some(t =>
      normTxt(t.nama) === normTxt(form.nama) && t.ruteId === form.ruteId && t.id !== form.id
    );
    if (isDup) {
      alert(`Nama toko "${form.nama}" sudah terdaftar di rute ini pada data sebelumnya.\n\nData TIDAK tersimpan. Mohon isi ulang dengan nama toko yang berbeda (atau periksa kembali apakah ini toko duplikat).`);
      return;
    }
    const ruteObj = (db.rute||[]).find(r=>r.id===form.ruteId);
    const prefix = ruteObj ? "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-" : "GW-XXX-";
    const produkFlags = {};
    produkAktif.forEach(p => { produkFlags[`produk_${p.id}`] = (form.produkIds||[]).includes(p.id); });
    // ✅ FIX BUG "GAGAL disimpan — tidak ada izin" saat Tambah Toko:
    // input HTML <input type="number"> SELALU mengembalikan STRING lewat
    // e.target.value (walau type="number"), sedangkan Firebase Rules
    // mewajibkan field stok_<id> bertipe Number murni (newData.isNumber())
    // — kalau tidak, Firebase menolak SELURUH penulisan toko itu (muncul
    // sebagai "permission denied", padahal sebenarnya gagal validasi tipe
    // data, bukan soal role/izin). Sebelumnya field stok_<id> ikut
    // ke-spread apa adanya dari `form` (string) saat modal==="add" dan ada
    // produk yang dicentang + diisi stok awal — makanya baru ketahuan saat
    // bikin toko baru yang langsung diisi produk & stok sekaligus (biasa
    // terjadi saat setup rute/wilayah baru). Dipaksa jadi Number di sini,
    // sama seperti yang sudah benar dilakukan di TabKontrol.jsx.
    const stokFlags = {};
    if (modal === "add") {
      produkAktif.forEach(p => {
        if ((form.produkIds||[]).includes(p.id)) {
          stokFlags[`stok_${p.id}`] = Number(form[`stok_${p.id}`]) || 0;
        }
      });
    }
    if (modal==="add") {
      const newId = genId("T", db.toko);
      const counter = newId.replace("T","");
      const today = new Date().toISOString().slice(0,10);
      const tanggalMasuk = form.status === "Baru" ? (form.tanggalMasuk || today) : (form.tanggalMasuk || null);
      // ✅ Riwayat status: catat status awal toko sejak didaftarkan, supaya
      // Rekap Siklus Wilayah bisa tahu persis toko ini sudah "Aktif"/"Baru"
      // sejak tanggal berapa (bukan cuma status terkini).
      const statusHistory = appendStatusHistory([], form.status || "Aktif", tanggalMasuk || today, "Toko didaftarkan");
      addRecord("toko", { ...form, ...produkFlags, ...stokFlags, id:newId, kode:prefix+counter, tanggalMasuk, statusHistory });
    } else {
      // Jika status diubah ke Baru dan belum ada tanggalMasuk, isi sekarang
      const existing = (db.toko||[]).find(t=>t.id===form.id);
      const tanggalMasuk = form.tanggalMasuk || (form.status === "Baru" && !existing?.tanggalMasuk
        ? new Date().toISOString().slice(0,10) : existing?.tanggalMasuk || null);
      // ✅ Kalau status BENAR-BENAR berubah lewat form edit ini, catat ke
      // riwayat status (tanggal = hari ini, karena form umum ini tidak
      // punya kolom tanggal khusus — untuk mengisi tanggal pasti yang bisa
      // digeser mundur, gunakan modal "🏷️ Edit Status Toko" di tab Kontrol).
      const today = new Date().toISOString().slice(0,10);
      const statusHistory = (form.status && existing && form.status !== existing.status)
        ? appendStatusHistory(existing.statusHistory, form.status, today, "Diubah lewat Master Toko")
        : (existing?.statusHistory || undefined);
      updateRecord("toko", form.id, { ...form, ...produkFlags, tanggalMasuk, ...(statusHistory ? { statusHistory } : {}) });
    }
    setModal(null);
  }

  // Stok update modal
  function openStok(row) {
    const sf = {};
    produkAktif.forEach(p => { sf[p.id] = row[`stok_${p.id}`] || 0; });
    setStokForm({ tokoId:row.id, tokoNama:row.nama, stok:sf });
    setStokModal(true);
  }
  // ✅ SINKRONISASI (disamakan dengan Penyesuaian Stok / Tarik Toko di Tab
  // Kontrol): "Update Stok Awal" DULU langsung menimpa field stok_<id> di
  // Master Toko lewat updateRecord biasa. Ini punya 2 masalah:
  //  1. Tidak ada jejak audit sama sekali (beda dengan Penyesuaian Stok yang
  //     selalu tercatat di koleksi "penyesuaian"), dan nilainya bisa "hilang"
  //     tertimpa diam-diam saat recalcTokoStok() jalan lagi (dipicu entri
  //     Kontrol/Penyesuaian lain) — karena recalcTokoStok menghitung ulang
  //     stok dari histori kontrol+penyesuaian, BUKAN dari nilai stok_<id>
  //     yang ditimpa manual di sini.
  //  2. Tombolnya disembunyikan TOTAL untuk Sales (lihat kondisi render di
  //     bawah) — beda dengan Penyesuaian Stok & Tarik Toko yang sudah lama
  //     boleh diajukan Sales lewat alur menunggu → disetujui/otomatis 24 jam.
  // Sekarang disamakan: selisih (delta) stok lama vs baru dihitung, lalu
  // dicatat sebagai entri "penyesuaian" (jenis Tambah/Tarik) — persis pola
  // yang sama dipakai konfirmasiNonaktifkanToko() di TabKontrol.jsx. Kalau
  // yang mengajukan Sales, entri masuk status "menunggu" (otomatis disetujui
  // 24 jam kalau tidak ditinjau); kalau Admin/Manajer, langsung "disetujui".
  // Baik disetujui manual maupun otomatis, recalcTokoStok() yang akhirnya
  // menuliskan stok final ke Master Toko — sama seperti 2 fitur lain itu.
  function submitStok() {
    const t = (db.toko||[]).find(x => x.id === stokForm.tokoId);
    if (!t) { setStokModal(false); alert("Toko tidak ditemukan — mungkin sudah dihapus. Silakan tutup dan coba lagi."); return; }
    if (isSalesRestricted) {
      const ruteObj = (db.rute||[]).find(r=>r.id===t.ruteId);
      if (ruteObj?.wilayahId !== salesWilayahId) {
        alert("Sebagai Sales, kamu hanya boleh mengoreksi stok toko di wilayahmu sendiri.");
        return;
      }
    }

    // ✅ Sinkron ceklis "Produk yang Dijual" (produkIds/produk_<id>) — sumber
    // kebenaran "sudah tercentang atau belum" dibaca dari flag produk_<id>
    // langsung (bukan array produkIds), sama seperti perbaikan sebelumnya di
    // fungsi ini, supaya toko lama yang produkIds-nya belum sinkron (mis.
    // hasil import) ikut terkoreksi otomatis, bukan malah tertimpa kosong.
    const existingIds = produkAktif.filter(p=>!!t[`produk_${p.id}`]).map(p=>p.id);
    const toAdd = [];
    const toRemove = [];
    const naik = {}, turun = {};
    let adaNaik = false, adaTurun = false;
    produkAktif.forEach(p => {
      const sebelum = Number(t[`stok_${p.id}`]||0);
      const sesudah = Number(stokForm.stok[p.id]||0);
      const delta = sesudah - sebelum;
      if (delta > 0) { naik[`jumlah_${p.id}`] = delta; adaNaik = true; }
      else if (delta < 0) { turun[`jumlah_${p.id}`] = -delta; adaTurun = true; }
      const sudahAda = !!t[`produk_${p.id}`];
      if (sesudah > 0 && !sudahAda) toAdd.push(p.id);
      else if (sesudah === 0 && sudahAda) toRemove.push(p.id);
    });

    // ✅ FIX: sebelumnya baris ini `return` diam-diam tanpa notifikasi apa pun
    // kalau tidak ada selisih stok — dari luar terlihat seperti tombol
    // "Simpan Stok" tidak melakukan apa-apa (tidak ada tanda berhasil MAUPUN
    // gagal). Sekarang selalu ada alert, supaya jelas: kalau memang tidak ada
    // angka yang berubah dari nilai sebelumnya, katakan itu secara eksplisit.
    if (!adaNaik && !adaTurun) {
      setStokModal(false);
      alert(`Tidak ada perubahan — angka stok yang diisi sama dengan stok toko "${t.nama}" saat ini.`);
      return;
    }

    const today = new Date().toISOString().slice(0,10);
    const status = isSalesRestricted ? "menunggu" : "disetujui";
    const autoApproveAt = isSalesRestricted ? (Date.now() + 24*60*60*1000) : null;
    const catatan = `Koreksi manual stok awal toko "${t.nama}" lewat Update Stok Awal (Tab Toko).`;
    const dicatatOleh = isSalesRestricted ? "Sales" : "Admin/Manajer";
    const entriesBaru = [];
    // Dipisah jadi 2 catatan (Tambah & Tarik) kalau campuran, biar arah
    // naik/turun per kelompok produk tetap benar — sama seperti pola di
    // konfirmasiNonaktifkanToko (TabKontrol.jsx).
    if (adaTurun) entriesBaru.push({ id: genUniqueId("PZ"), tokoId: t.id, tanggal: today, jenis:"Tarik", catatan, dicatatOleh, status, autoApproveAt, ...turun });
    if (adaNaik) entriesBaru.push({ id: genUniqueId("PZ"), tokoId: t.id, tanggal: today, jenis:"Tambah", catatan, dicatatOleh, status, autoApproveAt, ...naik });
    entriesBaru.forEach(e => addRecord("penyesuaian", e));

    // Ceklis "Produk yang Dijual" disinkron segera (sama seperti perilaku
    // Penyesuaian Stok yang sudah ada — ceklis tidak menunggu approval,
    // hanya ANGKA stok yang menunggu lewat recalcTokoStok di bawah).
    if (toAdd.length > 0 || toRemove.length > 0) {
      const finalIds = [...new Set(existingIds.filter(id=>!toRemove.includes(id)).concat(toAdd))];
      updateRecord("toko", t.id, { produkIds: finalIds, ...buildProdukFlagUpdates(produkAktif, finalIds) });
    }
    recalcTokoStok(db, produkAktif, t.id, updateRecord, undefined, [...(db.penyesuaian||[]), ...entriesBaru]);

    setStokModal(false);
    // ✅ FIX: dulu Admin/Manajer TIDAK dapat notifikasi apa pun setelah
    // "Simpan Stok" (cuma Sales yang dapat alert pengajuan) — sekarang
    // Admin/Manajer juga dapat konfirmasi eksplisit bahwa perubahan
    // tersimpan, supaya tidak ambigu dengan kasus "tidak ada perubahan" di atas.
    if (isSalesRestricted) {
      alert(`Pengajuan koreksi stok toko "${t.nama}" terkirim. Menunggu persetujuan Admin/Manajer (otomatis disetujui dalam 24 jam kalau tidak ditinjau) — stok toko masih seperti semula sampai disetujui.`);
    } else {
      alert(`Stok toko "${t.nama}" berhasil diupdate.`);
    }
  }

  // Opsi Rute & Wilayah diurutkan per wilayah (abjad) lalu nama rute
  // (natural sort, angka di akhir nama diurutkan sebagai angka), agar mudah
  // dicari di dropdown pencarian.
  const ruteOpts = useMemo(() => {
    const list = (db.rute||[]).map(r => {
      const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
      return { value:r.id, label:`${r.nama} (${w?.nama||"?"})`, wilayahNama:w?.nama||"", ruteNama:r.nama, wilayahId:r.wilayahId };
    });
    return list.sort((a,b) => {
      const wCompare = a.wilayahNama.localeCompare(b.wilayahNama, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.ruteNama, b.ruteNama);
    });
  }, [db.rute, db.wilayah]);
  // Rute yang difilter sesuai wilayah yang dipilih di form (untuk dropdown form Tambah/Edit Toko)
  const ruteOptsFiltered = useMemo(() =>
    formWilayahId ? ruteOpts.filter(r => r.wilayahId === formWilayahId) : ruteOpts
  , [ruteOpts, formWilayahId]);
  // Rute yang difilter sesuai wilayah yang dipilih di FILTER PANEL (beda
  // dengan ruteOptsFiltered di atas yang khusus untuk form Tambah/Edit
  // Toko) — supaya dropdown Rute di filter cuma menampilkan rute dari
  // wilayah yang sedang difilter, bukan semua rute dari seluruh wilayah.
  const ruteOptsForFilter = useMemo(() =>
    filter.wilayahId ? ruteOpts.filter(r => r.wilayahId === filter.wilayahId) : ruteOpts
  , [ruteOpts, filter.wilayahId]);
  const wilayahOpts = useMemo(() => sortByNama(db.wilayah).map(w=>({ value:w.id, label:w.nama })), [db.wilayah]);

  // Import Toko dari Excel
  function importTokoFromRows(rows) {
    const errors = [];
    let skipped = 0;
    const existingToko = [...(db.toko||[])];
    const toAdd = [];          // toko baru yang aman langsung ditambahkan (tidak ada duplikat)
    const dupCandidates = [];  // { tokoObj, label } — nama toko duplikat dalam rute yang sama, menunggu keputusan user

    rows.forEach((row, i) => {
      const rowNum = i + 2; // header = baris 1
      const nama = String(row["Nama Toko*"] ?? row["Nama Toko"] ?? "").trim();
      const ruteNama = String(row["Rute*"] ?? row["Rute"] ?? "").trim();
      if (!nama || !ruteNama) { errors.push(`Baris ${rowNum}: Nama Toko & Rute wajib diisi`); skipped++; return; }
      const ruteObj = (db.rute||[]).find(r => r.nama.toLowerCase() === ruteNama.toLowerCase());
      if (!ruteObj) { errors.push(`Baris ${rowNum}: Rute "${ruteNama}" tidak ditemukan di Master Rute`); skipped++; return; }
      // Cek duplikat nama toko dalam rute yang sama (baik sudah ada di data
      // sebelumnya, maupun duplikat antar baris lain dalam file import ini).
      // TIDAK langsung dilewati — dikumpulkan dulu, lalu user ditanya apakah
      // tetap ingin menambahkannya atau melewatinya, supaya tidak ada nama
      // toko yang sama tanpa sengaja tercatat dua kali dalam satu rute.
      const isDup = existingToko.some(t => normTxt(t.nama) === normTxt(nama) && t.ruteId === ruteObj.id)
        || toAdd.some(t => normTxt(t.nama) === normTxt(nama) && t.ruteId === ruteObj.id)
        || dupCandidates.some(d => normTxt(d.tokoObj.nama) === normTxt(nama) && d.tokoObj.ruteId === ruteObj.id);
      let status = String(row["Status"] ?? "Aktif").trim();
      if (!["Aktif","Non-Aktif","Baru"].includes(status)) status = "Aktif";
      const catatan = String(row["Catatan"] ?? "").trim();
      const produkFlags = {};
      produkAktif.forEach(p => {
        const v = String(row[`Jual: ${p.nama}`] ?? "").trim().toLowerCase();
        produkFlags[`produk_${p.id}`] = ["ya","yes","true","1"].includes(v);
      });
      // ✅ FIX SINKRONISASI: sebelumnya import toko hanya mengisi flag
      // produk_<id>, TIDAK PERNAH mengisi array produkIds sama sekali —
      // padahal beberapa fitur lain (Update Stok Awal sebelum diperbaiki,
      // Penyesuaian Stok, badge "produk baru") membaca produkIds sebagai
      // acuan. Toko hasil import jadi punya dua representasi yang tidak
      // sinkron sejak awal dibuat. Disamakan di sini: produkIds diturunkan
      // dari flag yang sama persis.
      const produkIdsFromImport = produkAktif.filter(p=>produkFlags[`produk_${p.id}`]).map(p=>p.id);
      const newId = genId("T", [...existingToko, ...toAdd, ...dupCandidates.map(d=>d.tokoObj)]);
      const prefix = "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-";
      const counter = newId.replace("T","");
      const today = new Date().toISOString().slice(0,10);
      const tanggalMasukImport = status === "Baru" ? today : null;
      // Baca stok produk dari kolom Excel jika ada (Stok: <nama produk>)
      const stokFromExcel = {};
      produkAktif.forEach(p => {
        const stokVal = Number(row[`Stok: ${p.nama}`] ?? row[`Stok ${p.nama}`] ?? 0);
        stokFromExcel[`stok_${p.id}`] = isNaN(stokVal) ? 0 : stokVal;
      });
      const tokoObj = { id:newId, nama, ruteId:ruteObj.id, status, catatan, kode:prefix+counter, tanggalMasuk:tanggalMasukImport, produkIds: produkIdsFromImport, ...produkFlags, ...stokFromExcel };
      if (isDup) {
        dupCandidates.push({ tokoObj, label: `Toko "${nama}" di rute "${ruteObj.nama}" (baris ${rowNum})` });
      } else {
        toAdd.push(tokoObj);
      }
    });

    // Komit final: dipanggil langsung kalau tidak ada duplikat sama sekali,
    // atau dipanggil setelah user memilih di dialog konfirmasi duplikat.
    function commit(includeDuplicates) {
      const finalNew = includeDuplicates ? [...toAdd, ...dupCandidates.map(d=>d.tokoObj)] : toAdd;
      const skippedDup = includeDuplicates ? 0 : dupCandidates.length;
      // ✅ FIX RISIKO IMPORT DI SKALA BESAR: sebelumnya baris ini memakai
      // save({ ...db, toko:[...existingToko, ...finalNew] }) — yang menulis
      // ULANG SELURUH koleksi toko (ribuan record lama + yang baru) sebagai
      // SATU set() raksasa ke Firebase (bukan cuma record yang baru
      // diimpor). Di skala 4000+ toko ini: (1) boros bandwidth — upload
      // ulang semua data yang sebenarnya tidak berubah; (2) kalau field
      // APAPUN di toko MANAPUN (bukan cuma yang baru diimpor) kebetulan
      // tidak lolos .validate Firebase, SELURUH proses import ikut gagal
      // tanpa ada petunjuk baris mana penyebabnya; (3) rawan menimpa
      // perubahan toko lain yang baru saja disimpan device/pengguna lain,
      // karena snapshot lokal `existingToko` yang dipakai bisa saja sudah
      // sedikit basi (stale) dibanding data terbaru di server saat commit
      // ini benar-benar terkirim. Sekarang setiap toko baru ditulis SATU
      // PER SATU lewat addRecord (path kecil `toko/<id>` masing-masing),
      // persis sama seperti alur Tambah Toko manual — jauh lebih hemat &
      // aman, dan kalau ada satu baris gagal, baris lain tetap tersimpan.
      finalNew.forEach(t => addRecord("toko", t));
      return { added: finalNew.length, skipped: skipped + skippedDup, errors };
    }

    if (dupCandidates.length > 0) {
      return {
        needsConfirm: true,
        title: <><Icon.warning size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Toko Duplikat Ditemukan</>,
        message: `Ditemukan ${dupCandidates.length} toko dengan nama yang sama pada rute yang sama:`,
        dupList: dupCandidates.map(d => d.label),
        onConfirm: commit, // onConfirm(true) = tetap tambahkan semua, onConfirm(false) = lewati yang duplikat
      };
    }
    return commit(false);
  }

  const cols = [
    { key:"kode",       label:"Kode",    render:v=><code style={{ fontSize:11, color:T.blue }}>{v}</code> },
    { key:"nama",       label:"Nama Toko", render:v=><b>{v}</b> },
    { key:"ruteNama",   label:"Rute",    render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"wilayahNama",label:"Wilayah" },
    { key:"status",     label:"Status",  render:v=><Badge color={v==="Aktif"?T.green:v==="Baru"?T.blue:T.red}>{v}</Badge> },
    { key:"tanggalMasuk", label:"Tgl Masuk", render:(v,row)=> row.status==="Baru" && v
      ? <span style={{ fontSize:11, color:T.blue }}>{v}</span>
      : <span style={{ color:T.gray400 }}>—</span> },
    ...produkAktif.map(p=>({ key:`produk_${p.id}`, label:p.nama, render:v=><span>{v?<Icon.checkCircle size={14} strokeWidth={2} color={T.green}/>:"—"}</span> })),
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:7 }}><Icon.toko size={19} strokeWidth={2} /> Master Toko</div>
          <div style={{ fontSize:12, color:T.gray400 }}>{(db.toko||[]).length} toko · {(db.toko||[]).filter(t=>t.status==="Aktif").length} aktif · terurut abjad</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {!isSalesRestricted && <ImportMenu label="Import Toko" onTemplate={()=>downloadTokoTemplate(db)} onParseRows={importTokoFromRows} />}
          <ExportMenu data={data} columns={cols} title="Data Toko" filename="toko" />
          {!isSalesRestricted && <Btn onClick={openAdd} icon={Icon.add}>Tambah Toko</Btn>}
        </div>
      </div>
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
          padding:"8px 14px", fontSize:12, color:T.green, marginBottom:12 }}>
          <Icon.lock size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Menampilkan toko di wilayah kamu saja. Kamu bisa memperbaiki Nama Toko & Rute; perubahan
          status/produk/stok perlu Admin atau Manajer.
        </div>
      )}
      <FilterBar filters={[
        { key:"q",        label:"Cari Nama Toko / Kode", value:filter.q, placeholder:"Ketik untuk mencari..." },
        { key:"wilayahId",label:"Wilayah",          value:filter.wilayahId, options:wilayahOpts },
        { key:"ruteId",   label:"Rute",             value:filter.ruteId,    options:ruteOptsForFilter },
        { key:"status",   label:"Status",           value:filter.status,    options:[{value:"Aktif",label:"Aktif"},{value:"Baru",label:"Baru"},{value:"Non-Aktif",label:"Non-Aktif"}] },
        { key:"produkId", label:"Produk Dititip",   value:filter.produkId,  options:produkOptsForFilter },
      ]} onChange={(k,v)=>setFilter(p=>{
        const next = {...p,[k]:v};
        // Reset rute yang dipilih kalau wilayah diganti, supaya tidak
        // "nyangkut" filter rute dari wilayah sebelumnya.
        if (k==="wilayahId") next.ruteId = "";
        return next;
      })} onReset={()=>setFilter({q:"",ruteId:"",wilayahId:"",status:"",produkId:""})} />
      <BulkActionBar
        selectedIds={selectedIds} total={data.length}
        onSelectAll={()=>toggleSelectAll(data, false)}
        onClearAll={()=>setSelectedIds([])}
        onDeleteSelected={deleteSelected} label="toko"
        extraActions={!isSalesRestricted && (
          <Btn variant="secondary" size="sm" icon={Icon.shuffle} onClick={openPindahRuteMassal}>
            Pindah Rute {selectedIds.length} Toko
          </Btn>
        )} />
      <Card padding={0}>
        {/* ✅ FIX SINKRONISASI/HAK AKSES: sebelumnya onEdit di sini TIDAK
            dibatasi sama sekali (beda dengan onDelete di bawah yang sudah
            benar dikunci untuk Sales) — padahal form edit toko ini bisa
            mengubah field struktural: Rute (dropdown-nya menampilkan SEMUA
            rute dari SEMUA wilayah, tanpa filter wilayah Sales — jadi Sales
            bisa memindahkan toko keluar dari wilayahnya sendiri), Status
            (melewati alur "Nonaktifkan Toko" yang benar, yang otomatis
            mencatat penarikan stok sebagai Penyesuaian beraudit), dan ceklis
            "Produk yang Dijual" (melewati alur approval Penyesuaian Stok
            sepenuhnya). Dikunci sama seperti onDelete. */}
        <Table columns={cols} data={data} onEdit={isSalesRestricted ? undefined : openEdit}
          onDelete={isSalesRestricted ? undefined : (id=>{ if(confirm("Hapus toko ini?")) deleteRecord("toko",id); })}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      </Card>
      {/* Panel Daftar Stok Produk per Toko dengan Filter */}
      <div style={{ marginTop:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom: showStokPanel ? 12 : 0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:14, fontWeight:700, color:T.gray800, display:"flex", alignItems:"center", gap:6 }}><Icon.package size={16} strokeWidth={2} /> Daftar Stok Produk per Toko</div>
            <Badge color={T.teal}>{data.length} toko</Badge>
          </div>
          <Btn variant="secondary" size="sm"
            onClick={()=>setShowStokPanel(v=>!v)}>
            {showStokPanel ? "▲ Sembunyikan" : "▼ Tampilkan"}
          </Btn>
        </div>
        {showStokPanel && (() => {
          // Filter stok panel
          const stokData = data.filter(t =>
            (!stokFilter.q || t.nama.toLowerCase().includes(stokFilter.q.toLowerCase()) || t.kode?.toLowerCase().includes(stokFilter.q.toLowerCase())) &&
            (!stokFilter.ruteId || t.ruteId === stokFilter.ruteId) &&
            (!stokFilter.wilayahId || t.wilayahId === stokFilter.wilayahId)
          ).filter(t =>
            // Filter by produk stok: hanya tampilkan toko yang punya stok > 0 untuk produk terpilih
            !stokFilter.produkId || (t[`stok_${stokFilter.produkId}`]||0) > 0
          );

          return (
            <div>
              {/* Filter Bar Stok */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end",
                background:T.white, border:`1px solid ${T.gray200}`, borderRadius:10, padding:"12px 16px", marginBottom:12 }}>
                <div style={{ minWidth:180, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4, display:"flex", alignItems:"center", gap:4 }}><Icon.search size={12} strokeWidth={2} /> Cari Toko</div>
                  <input value={stokFilter.q} onChange={e=>setStokFilter(p=>({...p,q:e.target.value}))}
                    placeholder="Nama toko / kode..."
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white, boxSizing:"border-box" }} />
                </div>
                <div style={{ minWidth:140, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Wilayah</div>
                  <select value={stokFilter.wilayahId}
                    onChange={e=>setStokFilter(p=>({...p, wilayahId:e.target.value, ruteId:""}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua</option>
                    {wilayahOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:140, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Rute</div>
                  <select value={stokFilter.ruteId}
                    onChange={e=>setStokFilter(p=>({...p, ruteId:e.target.value}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua</option>
                    {(stokFilter.wilayahId
                      ? ruteOpts.filter(r => {
                          const rObj = (db.rute||[]).find(x=>x.id===r.value);
                          return rObj?.wilayahId === stokFilter.wilayahId;
                        })
                      : ruteOpts
                    ).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:160, flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Filter Produk (stok &gt; 0)</div>
                  <select value={stokFilter.produkId}
                    onChange={e=>setStokFilter(p=>({...p, produkId:e.target.value}))}
                    style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                      borderRadius:7, fontSize:12, fontFamily:"inherit", background:T.white }}>
                    <option value="">Semua produk</option>
                    {produkAktif.map(p=><option key={p.id} value={p.id}>{p.nama}</option>)}
                  </select>
                </div>
                <Btn variant="secondary" size="sm"
                  onClick={()=>setStokFilter({q:"",ruteId:"",wilayahId:"",produkId:""})}>
                  Reset
                </Btn>
              </div>

              {stokData.length === 0 ? (
                <div style={{ textAlign:"center", color:T.gray400, padding:24, fontSize:13 }}>
                  Tidak ada toko dengan stok yang sesuai filter.
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:T.gray50, borderBottom:`2px solid ${T.gray200}` }}>
                        <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>Toko</th>
                        <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:T.gray600, fontSize:11, textTransform:"uppercase" }}>Rute</th>
                        {produkAktif.map(p=>(
                          <th key={p.id} style={{ padding:"8px 12px", textAlign:"center", fontWeight:700,
                            color: stokFilter.produkId === p.id ? T.green : T.gray600,
                            fontSize:11, textTransform:"uppercase" }}>
                            <Icon.package size={11} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:3}} />{p.nama}
                          </th>
                        ))}
                        <th style={{ padding:"8px 12px", textAlign:"right", fontWeight:700, color:T.gray600, fontSize:11 }}>AKSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stokData.map((t,i) => (
                        <tr key={t.id} style={{ background:i%2===0?T.white:T.gray50, borderBottom:`1px solid ${T.gray100}` }}>
                          <td style={{ padding:"8px 12px", fontWeight:700 }}>
                            {t.nama}
                            {t.status === "Baru" && <span style={{ marginLeft:6, fontSize:9, background:T.blue, color:"#fff", borderRadius:99, padding:"1px 6px" }}>BARU</span>}
                          </td>
                          <td style={{ padding:"8px 12px", color:T.teal }}>{t.ruteNama}</td>
                          {produkAktif.map(p=>{
                            const stok = t[`stok_${p.id}`]||0;
                            return (
                              <td key={p.id} style={{ padding:"8px 12px", textAlign:"center",
                                fontWeight: stok > 0 ? 700 : 400,
                                color: stok > 0 ? T.green : T.gray400,
                                background: stokFilter.produkId === p.id ? (stok > 0 ? T.greenLt : T.redLt) : "transparent" }}>
                                {stok > 0 ? <span style={{display:"inline-flex",alignItems:"center",gap:3}}><Icon.checkCircle size={12} strokeWidth={2}/>{fmt(stok)}</span> : "—"}
                              </td>
                            );
                          })}
                          <td style={{ padding:"8px 12px", textAlign:"right" }}>
                            <Btn variant="secondary" size="sm" icon={Icon.edit} onClick={()=>openStok(t)}>
                              {isSalesRestricted ? "Ajukan Koreksi" : "Update"}
                            </Btn>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize:11, color:T.gray400, marginTop:8, textAlign:"right" }}>
                    Menampilkan {stokData.length} dari {data.length} toko
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {modal && (
        <Modal title={modal==="add"?"Tambah Toko":"Edit Toko"} onClose={()=>setModal(null)}>
          {isSalesRestricted && (
            <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
              padding:"8px 12px", fontSize:12, color:T.green, marginBottom:12 }}>
              <Icon.lock size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Sebagai Sales, kamu cuma bisa memperbaiki <b>Nama Toko</b> dan <b>Rute</b>. Perubahan
              lain (status, produk, stok) perlu dilakukan Admin/Manajer.
            </div>
          )}
          <Input label="Nama Toko" value={form.nama} onChange={v=>f("nama",v)} required placeholder="cth: Toko Barokah" />
          <SearchableSelect label="Filter Wilayah (opsional)" value={formWilayahId}
            onChange={v=>{ setFormWilayahId(v); f("ruteId",""); }}
            options={wilayahOpts} placeholder="Pilih wilayah untuk filter rute..." />
          <SearchableSelect label="Rute" value={form.ruteId} onChange={v=>f("ruteId",v)} options={ruteOptsFiltered} required placeholder={formWilayahId ? "Pilih rute..." : "Cari rute / wilayah..."} />
          {!isSalesRestricted && (
            <>
              <Input label="Status" value={form.status} onChange={v=>f("status",v)}
                options={[{value:"Aktif",label:"Aktif"},{value:"Non-Aktif",label:"Non-Aktif"},{value:"Baru",label:"Baru (trial)"}]} />
              {form.status === "Baru" && (
                <Input label="Tanggal Masuk (Baru)" value={form.tanggalMasuk||new Date().toISOString().slice(0,10)}
                  onChange={v=>f("tanggalMasuk",v)} type="date"
                  hint="Dipakai untuk auto-upgrade ke Aktif setelah 30 hari" />
              )}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:8 }}>
                  Produk yang Dijual{modal==="add" ? " & Stok Awal" : ""}:
                </div>
                <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns: modal==="add" ? "1fr" : "1fr 1fr", gap:6 }}>
                  {produkAktif.map(p => {
                    const checked = (form.produkIds||[]).includes(p.id);
                    return (
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                      border:`1.5px solid ${checked?T.green:T.gray200}`,
                      borderRadius:8, background:checked?T.greenLt:T.white }}>
                      <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", flex:1 }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => {
                            const ids = form.produkIds||[];
                            f("produkIds", e.target.checked ? [...ids,p.id] : ids.filter(x=>x!==p.id));
                            if (modal==="add" && !e.target.checked) f(`stok_${p.id}`, 0);
                          }}
                          style={{ accentColor:T.green }} />
                        <span style={{ fontSize:13, fontWeight:600 }}>{p.nama}</span>
                        <span style={{ fontSize:11, color:T.gray400 }}>{fmtRp(p.harga)}</span>
                      </label>
                      {modal==="add" && checked && (
                        <input type="number" min="0" placeholder="Stok awal"
                          value={form[`stok_${p.id}`]||""}
                          onChange={e=>f(`stok_${p.id}`, e.target.value)}
                          style={{ width:90, padding:"6px 8px", border:`1.5px solid ${T.gray200}`, borderRadius:6, fontSize:13, fontFamily:"inherit" }} />
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
              <Input label="Catatan" value={form.catatan||""} onChange={v=>f("catatan",v)} type="textarea" />
            </>
          )}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setModal(null)}>Batal</Btn>
            <Btn onClick={submit}>{modal==="add"?"Simpan":"Update"}</Btn>
          </div>
        </Modal>
      )}

      {stokModal && (
        <Modal title={<><Icon.package size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Update Stok Awal — {stokForm.tokoNama}</>} onClose={()=>setStokModal(false)}>
          <div style={{ fontSize:13, color:T.gray600, marginBottom:16 }}>
            Stok ini otomatis ter-update setiap kali ada entri <b>Kontrol Bulanan</b> baru untuk toko ini
            — nilai "Stok Awal" pada kontrol terakhir dibawa apa adanya (sudah termasuk hasil
            restock etalase saat kunjungan itu). Gunakan form ini hanya untuk <b>koreksi manual</b>
            (misal: stok opname, retur, atau setup awal sebelum ada kontrol).
          </div>
          {isSalesRestricted && (
            <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
              padding:"8px 12px", fontSize:12, color:T.green, marginBottom:16 }}>
              <Icon.lock size={13} strokeWidth={2} style={{verticalAlign:"-2px", marginRight:5}} /> Sebagai Sales, koreksi ini akan
              tercatat sebagai <b>pengajuan Penyesuaian Stok</b> berstatus menunggu — stok toko baru berubah
              setelah disetujui Admin/Manajer (atau otomatis disetujui dalam 24 jam kalau tidak ditinjau).
            </div>
          )}
          {produkAktif.map(p => (
            <Input key={p.id} label={`Stok ${p.nama} (${p.id})`}
              value={stokForm.stok?.[p.id]||0}
              onChange={v => setStokForm(sf=>({ ...sf, stok:{ ...sf.stok, [p.id]:v } }))}
              type="number" />
          ))}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setStokModal(false)}>Batal</Btn>
            <Btn onClick={submitStok}>Simpan Stok</Btn>
          </div>
        </Modal>
      )}

      {pindahRuteModal && (
        <Modal title={<><Icon.shuffle size={16} style={{verticalAlign:"-3px", marginRight:6}}/>Pindah Rute Massal — {selectedIds.length} Toko Terpilih</>} onClose={()=>setPindahRuteModal(false)}>
          <div style={{ fontSize:13, color:T.gray600, marginBottom:16 }}>
            Semua toko yang dicentang akan dipindahkan ke rute tujuan yang dipilih di bawah ini.
            Berguna untuk migrasi banyak toko sekaligus (mis. rute dipecah/digabung, atau
            toko-toko dialihkan ke sales/rute baru).
          </div>
          <SearchableSelect label="Filter Wilayah (opsional)" value={pindahRuteWilayahId}
            onChange={v=>{ setPindahRuteWilayahId(v); setPindahRuteTarget(""); }}
            options={wilayahOpts} placeholder="Pilih wilayah untuk mempersempit daftar rute..." />
          <SearchableSelect label="Rute Tujuan" value={pindahRuteTarget}
            onChange={setPindahRuteTarget}
            options={pindahRuteWilayahId ? ruteOpts.filter(r=>r.wilayahId===pindahRuteWilayahId) : ruteOpts}
            required placeholder="Cari rute / wilayah..." />
          <div style={{ background:T.gray50, borderRadius:8, padding:"10px 14px", marginTop:4, marginBottom:8, fontSize:12, color:T.gray600 }}>
            Toko terpilih: <b>{selectedIds.length}</b>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setPindahRuteModal(false)}>Batal</Btn>
            <Btn onClick={submitPindahRuteMassal}>Pindahkan {selectedIds.length} Toko</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TAB PRODUK (tipe isi manual)
// ─────────────────────────────────────────────
