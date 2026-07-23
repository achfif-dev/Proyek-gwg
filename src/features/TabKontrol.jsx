import React, { useEffect, useMemo, useState } from "react";
import { Badge, Btn, BulkActionBar, Card, ConfirmDelete, ExportMenu, FilterBar, ImportMenu, Input, Modal, SearchableSelect, StatCard, Table } from "../../components/ui";
import { TabToko } from "../../features/toko/TabToko";
import { useDB } from "../../hooks/useDB";
import { exportExcel } from "../../lib/exportUtils";
import { fmt, fmtRp, genId, genUniqueId, naturalCompare, normTxt } from "../../lib/format";
import { SIKLUS_GAP_DAYS } from "../../lib/dataHelpers";
import { downloadKontrolTemplate } from "../../lib/importUtils";
import { CATATAN_STATUS, T } from "../../theme/tokens";

export function TabKontrol({ db, addRecord, updateRecord, deleteRecord, save, salesWilayahId, isManajer, loadedKontrolYears, availableKontrolYears }) {
  const isSalesRestricted = !!salesWilayahId; // true jika Sales dengan wilayah spesifik
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ tokoId:"", tanggal:"", catatanStatus:"", catatan:"" });
  // Jika Sales dengan wilayah terkunci, filter modal otomatis menggunakan wilayah Sales
  const [modalFilter, setModalFilter] = useState({ wilayahId: salesWilayahId||"", ruteId:"" });
  // Filter tambahan di dropdown Toko modal Kontrol: kalau aktif, cuma
  // tampilkan toko yang punya badge 🔴/🟠 (belum ada kontrol berhasil di
  // siklus berjalan) — mempermudah menyisir toko yang masih perlu dikunjungi.
  const [hanyaBelumKontrol, setHanyaBelumKontrol] = useState(false);
  const [filter, setFilter] = useState({ wilayahId: salesWilayahId||"", ruteId:"", bulan:"", q:"",
    // ✅ Filter "Belum Dikontrol Hari Ini": cek tanggal tertentu (default hari ini),
    // tampilkan hanya toko yang BELUM ada entri kontrol pada tanggal tsb,
    // padahal toko lain di rute yang sama sudah.
    cekTanggal: new Date().toISOString().slice(0,10), hanyaBelumHariIni: false,
    // ✅ Filter tambahan supaya lebih gampang ketemu kesalahan input:
    // status catatan kunjungan (Tutup/Tidak Terjual/Bermasalah/Isi Manual),
    // dan rentang jumlah penjualan (total pcs semua produk per entri).
    catatanStatus:"", minJumlah:"", maxJumlah:"" });
  const [viewMode, setViewMode] = useState("table"); // table | monthly
  // ✅ Diagnostik Cakupan Kontrol: kartu ringkas default tertutup (biar tidak
  // mengganggu tampilan harian), daftar rincian toko baru dimuat saat dibuka.
  const [diagnostikOpen, setDiagnostikOpen] = useState(false);
  const [diagnostikShowList, setDiagnostikShowList] = useState(false);
  const [diagnostikGroupBy, setDiagnostikGroupBy] = useState("wilayah"); // "wilayah" | "rute"
  // ✅ Filter khusus daftar/ekspor di kartu Diagnostik Cakupan Kontrol — terpisah
  // dari filter utama tab, supaya bisa saring per Wilayah/Rute + cari nama/kode
  // toko sebelum kirim daftar "belum dikontrol" ke sales tertentu.
  const [diagnostikFilterWilayahId, setDiagnostikFilterWilayahId] = useState("");
  const [diagnostikFilterRuteId, setDiagnostikFilterRuteId] = useState("");
  const [diagnostikSearchQ, setDiagnostikSearchQ] = useState("");
  // ✅ Mode "Rentang Waktu": selain "belum pernah SAMA SEKALI", tambahkan opsi
  // "tidak dikontrol dalam N hari terakhir" — menangkap toko yang PERNAH
  // dikontrol tapi sudah lama tidak dikunjungi lagi (kasus ini tidak kena
  // filter "belum pernah" karena secara historis pernah ada entrinya).
  const [diagnostikMode, setDiagnostikMode] = useState("never"); // "never" | "rentang"
  const [diagnostikRentangHari, setDiagnostikRentangHari] = useState(30);
  // ✅ Edit nama toko langsung dari modal Tambah/Edit Kontrol — untuk kasus
  // nama toko ternyata salah ketik dan baru ketahuan saat kunjungan berikutnya.
  // Cuma Manajer/Admin (field master toko, bukan operasional seperti Sales).
  const [renameToko, setRenameToko] = useState(null); // { tokoId, value }

  // ✅ AUTO-APPROVE: pengajuan Penyesuaian Stok dari Sales yang sudah lewat
  // 24 jam (autoApproveAt) dan belum ditolak, otomatis disetujui sendiri.
  // Dicek sekali tiap kali tab ini dibuka/data penyesuaian berubah — cukup
  // untuk pemakaian normal (app dibuka rutin tiap hari oleh Admin/Manajer).
  useEffect(() => {
    const now = Date.now();
    const expired = (db.penyesuaian||[]).filter(pz =>
      pz.status === "menunggu" && pz.autoApproveAt && pz.autoApproveAt <= now
    );
    if (expired.length === 0) return;
    expired.forEach(pz => {
      updateRecord("penyesuaian", pz.id, { status: "disetujui", disetujuiOleh: "Otomatis (24 jam)" });
    });
    // Hitung ulang stok toko yang terdampak, sesudah data ter-update.
    const tokoIds = [...new Set(expired.map(pz=>pz.tokoId))];
    setTimeout(() => tokoIds.forEach(tid => recalcTokoStok(tid)), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.penyesuaian]);
  const [deleteTarget, setDeleteTarget] = useState(null); // Fix: konfirmasi hapus
  const [selectedIds, setSelectedIds] = useState([]);

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleSelectAll(rows, allChecked) {
    if (allChecked) setSelectedIds(prev => prev.filter(id => !rows.find(r=>r.id===id)));
    else setSelectedIds(prev => [...new Set([...prev, ...rows.map(r=>r.id)])]);
  }
  function deleteSelected() {
    if (!confirm(`Hapus ${selectedIds.length} catatan kontrol terpilih? Tindakan ini permanen.`)) return;
    // Kumpulkan tokoId yang terdampak agar stoknya disinkronkan ulang setelah hapus
    const affectedTokoIds = [...new Set(selectedIds.map(id => (db.kontrol||[]).find(k=>k.id===id)?.tokoId).filter(Boolean))];
    selectedIds.forEach(id => deleteRecord("kontrol", id));
    const remaining = (db.kontrol||[]).filter(k => !selectedIds.includes(k.id));
    affectedTokoIds.forEach(tokoId => recalcTokoStok(tokoId, remaining));
    setSelectedIds([]);
  }
  // Modal untuk mengubah status toko langsung dari kontrol (tarik/non-aktifkan toko)
  const [tokoStatusModal, setTokoStatusModal] = useState(null); // { toko, mode:"nonaktif"|"aktif" }
  const [stokPenarikan, setStokPenarikan] = useState({}); // stok saat penarikan { produkId: jumlah }
  // ✅ BARU: Modal Edit Status Toko — ubah Aktif/Baru/Non-Aktif langsung dari TabKontrol
  const [editStatusModal, setEditStatusModal] = useState(null); // { toko } | null
  const [editStatusValue, setEditStatusValue] = useState(""); // "Aktif" | "Baru" | "Non-Aktif"
  const [editStatusCatatan, setEditStatusCatatan] = useState("");
  // ✅ Modal Tambah Toko Cepat dari Kontrol
  const [tambahTokoModal, setTambahTokoModal] = useState(false);
  const [tambahTokoForm, setTambahTokoForm] = useState({ nama:"", ruteId:"", status:"Aktif", catatan:"" });
  const ttf = (k,v) => setTambahTokoForm(p=>({...p,[k]:v}));
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  // ✅ Penyesuaian Stok lapangan (di luar siklus kontrol rutin): Tambah / Kurang / Tarik Sebagian
  const [penyesuaianModal, setPenyesuaianModal] = useState(false);
  const [penyesuaianForm, setPenyesuaianForm] = useState(null); // null saat tertutup
  const pf = (k,v) => setPenyesuaianForm(p=>({...p,[k]:v}));
  // ✅ Penjualan Luar Rute: sales menjual produk di luar kunjungan rute normal
  // (mis. rute lain saat kontrol rute 1, atau penjualan perorangan) dan TIDAK
  // tahu/lupa nama toko & rutenya. Dicatat terpisah dari Kontrol Bulanan
  // (yang selalu mewajibkan toko & rute) supaya penjualan tetap tercatat &
  // masuk laporan, tanpa memaksa sales mengarang nama toko/rute.
  const [luarRuteModal, setLuarRuteModal] = useState(false);
  const [luarRuteForm, setLuarRuteForm] = useState(null); // null saat tertutup
  const lf = (k,v) => setLuarRuteForm(p=>({...p,[k]:v}));

  const produkAktif = useMemo(() => (db.produk||[]).filter(p=>p.aktif!==false), [db.produk]);

  const enriched = useMemo(() => (db.kontrol||[]).map(k => {
    const toko = (db.toko||[]).find(t=>t.id===k.tokoId);
    const rute = toko ? (db.rute||[]).find(r=>r.id===toko.ruteId) : null;
    const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
    let totalRev = 0, totalBonus = 0, totalTerjual = 0;
    produkAktif.forEach(p => {
      const terjual = k[`terjual_${p.id}`]||0;
      totalRev += terjual * (p.harga||0);
      totalTerjual += terjual;
      // bonus per kontrol = jumlah pcs bonus produk (bukan uang)
      const bonusPcs = k[`bonusInput_${p.id}`] !== undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0);
      totalBonus += bonusPcs;
    });
    return { ...k, tokoNama:toko?.nama||"?", ruteNama:rute?.nama||"?",
      wilayahNama:wilayah?.nama||"?", ruteId:rute?.id||"", wilayahId:wilayah?.id||"",
      totalRev, totalBonus, totalTerjual, toko, rute, wilayah };
  }), [db, produkAktif]);

  // Filter: wilayah → rute cascade.
  // Diurutkan per Wilayah (abjad) dahulu, lalu Nama Rute (natural sort) —
  // sama seperti urutan di tab Rute — supaya dropdown filter di sini tidak
  // tampil acak sesuai urutan input/insert data mentah.
  const ruteFiltered = useMemo(() => {
    const list = filter.wilayahId
      ? (db.rute||[]).filter(r=>r.wilayahId===filter.wilayahId)
      : (db.rute||[]);
    return [...list].sort((a,b) => {
      const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
      const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
      const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.nama||"", b.nama||"");
    });
  }, [db.rute, db.wilayah, filter.wilayahId]);

  const data = useMemo(() => enriched.filter(k =>
    (!filter.wilayahId || k.wilayahId === filter.wilayahId) &&
    (!filter.ruteId    || k.ruteId    === filter.ruteId) &&
    (!filter.bulan     || k.tanggal?.startsWith(filter.bulan)) &&
    (!filter.q         || normTxt(k.tokoNama).includes(normTxt(filter.q)) || normTxt(k.toko?.kode).includes(normTxt(filter.q))) &&
    (!filter.catatanStatus || (filter.catatanStatus==="manual" ? !k.catatanStatus || k.catatanStatus==="manual" : k.catatanStatus===filter.catatanStatus)) &&
    (filter.minJumlah==="" || filter.minJumlah==null || k.totalTerjual >= Number(filter.minJumlah)) &&
    (filter.maxJumlah==="" || filter.maxJumlah==null || k.totalTerjual <= Number(filter.maxJumlah))
  ), [enriched, filter]);

  // ✅ Penjualan Luar Rute yang cocok dengan filter Wilayah/Rute/Bulan yang
  // sedang aktif di tab ini — dipakai supaya ringkasan Revenue, ringkasan
  // per Produk, dan hasil Ekspor Kontrol Bulanan ikut ter-update sesuai
  // kontribusi luar rute, bukan cuma menghitung entri kontrol saja.
  // Kalau filter Rute spesifik dipilih, hanya luar rute yang ruteId-nya
  // sudah cocok dengan rute tsb yang ikut dihitung (konsisten dengan
  // logika Rekap & daftar Penjualan Luar Rute di bawah).
  const luarRuteData = useMemo(() => {
    // ✅ FIX: Penjualan Luar Rute tidak terikat toko manapun (tidak ada field
    // nama/kode toko sama sekali di record ini) — jadi kalau sedang mencari
    // toko tertentu (filter.q terisi), entri Luar Rute TIDAK relevan dan
    // harus dikosongkan. Sebelumnya field ini tidak ikut disaring filter.q,
    // sehingga Rev/Bonus di ringkasan header masih ikut menambahkan seluruh
    // Penjualan Luar Rute walau sedang mencari 1 toko spesifik — bikin
    // angkanya tidak sinkron dengan hasil pencarian yang tampil di tabel.
    if (filter.q) return [];
    return (db.penjualanLuar||[])
      .filter(pl =>
        (!isSalesRestricted || pl.wilayahId===salesWilayahId) &&
        (!filter.wilayahId || pl.wilayahId === filter.wilayahId) &&
        (!filter.ruteId    || pl.ruteId    === filter.ruteId) &&
        (!filter.bulan     || pl.tanggal?.startsWith(filter.bulan))
      )
      .map(pl => {
        let totalRev = 0, totalBonus = 0;
        produkAktif.forEach(p => {
          totalRev += Number(pl[`terjual_${p.id}`]||0) * (p.harga||0);
          totalBonus += Number(pl[`bonusInput_${p.id}`]||0);
        });
        const wilayahNama = (db.wilayah||[]).find(w=>w.id===pl.wilayahId)?.nama || "";
        const ruteNama = (db.rute||[]).find(r=>r.id===pl.ruteId)?.nama || "";
        return { ...pl, totalRev, totalBonus, wilayahNama, ruteNama };
      });
  }, [db.penjualanLuar, produkAktif, filter.wilayahId, filter.ruteId, filter.bulan, filter.q, isSalesRestricted, salesWilayahId]);

  // ✅ DIAGNOSTIK CAKUPAN KONTROL — dibuat permanen di dalam app (bukan cek
  // manual sekali-sekali lewat file backup) supaya Admin/Manajer bisa
  // memantau kapan saja:
  //  1) Toko Aktif/Baru yang BELUM PERNAH punya entri Kontrol Bulanan sama
  //     sekali (dari data kontrol yang SEDANG termuat di perangkat ini) —
  //     berguna untuk prioritas kunjungan lapangan.
  //  2) Toko yang py Stok tersimpan >0 di Master Toko TAPI tidak ada entri
  //     kontrol yang termuat — sinyal peringatan dini: BISA berarti
  //     kontrol terakhirnya ada di tahun yang belum dimuat (lihat
  //     KONTROL_LIVE_YEARS/partisi tahun di useDB), sehingga baseline stok
  //     berisiko salah kalau "Hitung Ulang Semua Stok" dijalankan.
  // Dihitung dari SELURUH db.kontrol yang termuat (bukan `data` yang sudah
  // kena filter Wilayah/Rute/Bulan di atas) supaya angkanya konsisten
  // berapa pun filter yang sedang aktif di tabel.
  const cakupanDiagnostik = useMemo(() => {
    const controlledIds = new Set((db.kontrol||[]).map(k=>k.tokoId));
    const tokoRelevan = (db.toko||[]).filter(t => t.status==="Aktif" || t.status==="Baru");
    const belumPernah = tokoRelevan.filter(t => !controlledIds.has(t.id));
    const berstokTanpaKontrol = belumPernah.filter(t =>
      produkAktif.some(p => Number(t[`stok_${p.id}`]||0) > 0));

    const perWilayah = {};
    const perRute = {}; // key: "Nama Rute — Nama Wilayah" → hitung per rute, bukan cuma per wilayah
    belumPernah.forEach(t => {
      const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
      const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
      const namaWilayah = wilayah?.nama || t.wilayahNama || "Tidak diketahui";
      perWilayah[namaWilayah] = (perWilayah[namaWilayah]||0) + 1;
      const namaRute = rute?.nama || t.ruteNama || "Tidak diketahui";
      const keyRute = `${namaRute}|||${namaWilayah}`;
      perRute[keyRute] = (perRute[keyRute]||0) + 1;
    });
    const perWilayahSorted = Object.entries(perWilayah).sort((a,b)=>b[1]-a[1]);
    // ✅ Diurutkan per Wilayah (abjad) dulu lalu jumlah terbanyak — supaya
    // rute-rute di wilayah yang sama tetap mengelompok, bukan tercampur
    // acak hanya berdasar angka terbanyak lintas wilayah.
    const perRuteSorted = Object.entries(perRute)
      .map(([key,cnt]) => { const [rute,wilayah] = key.split("|||"); return { rute, wilayah, cnt }; })
      .sort((a,b) => a.wilayah.localeCompare(b.wilayah,"id",{sensitivity:"base"}) || b.cnt - a.cnt);

    // Tahun kontrol lama yang ADA di cloud tapi BELUM dimuat ke perangkat
    // ini — kalau ada, angka "berstokTanpaKontrol" di atas patut dicurigai
    // sebagai histori tahun lama, bukan murni toko baru yang belum dikunjungi.
    const tahunBelumDimuat = (availableKontrolYears||[])
      .filter(y => !(loadedKontrolYears||[]).includes(y));

    return { totalRelevan: tokoRelevan.length, belumPernah, berstokTanpaKontrol, perWilayahSorted, perRuteSorted, tahunBelumDimuat };
  }, [db.toko, db.kontrol, db.rute, db.wilayah, produkAktif, availableKontrolYears, loadedKontrolYears]);

  // ✅ Rute untuk dropdown filter Diagnostik (dipersempit sesuai Wilayah yang dipilih di filter diagnostik)
  const diagnostikRuteOpts = useMemo(() => {
    const list = diagnostikFilterWilayahId
      ? (db.rute||[]).filter(r=>r.wilayahId===diagnostikFilterWilayahId)
      : (db.rute||[]);
    return list.map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, diagnostikFilterWilayahId]);

  // ✅ Tanggal entri Kontrol Bulanan PALING BARU per toko (dari seluruh data
  // kontrol yang sudah termuat) — dipakai untuk mode "tidak dikontrol dalam
  // rentang waktu". Beda dengan "belum pernah" (yang cuma cek ada/tidaknya
  // entri sama sekali), ini bisa menangkap toko yang pernah dikontrol tapi
  // sudah lama tidak dikunjungi ulang.
  const lastKontrolByToko = useMemo(() => {
    const map = {};
    (db.kontrol||[]).forEach(k => {
      if (!k.tokoId || !k.tanggal) return;
      if (!map[k.tokoId] || k.tanggal > map[k.tokoId]) map[k.tokoId] = k.tanggal;
    });
    return map;
  }, [db.kontrol]);

  // ✅ Daftar dasar sebelum disaring Wilayah/Rute/pencarian — tergantung mode:
  //  - "never": toko yang TIDAK PERNAH SAMA SEKALI ada entri kontrol (sama seperti sebelumnya)
  //  - "rentang": toko Aktif/Baru yang entri kontrol TERAKHIRnya (kalau ada)
  //    lebih lama dari N hari yang lalu, ATAU belum pernah sama sekali
  //    (otomatis ikut kehitung "tidak dikontrol dalam rentang" juga).
  const diagnostikBaseList = useMemo(() => {
    if (diagnostikMode === "never") return cakupanDiagnostik.belumPernah;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(diagnostikRentangHari || 30));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const tokoRelevan = (db.toko || []).filter(t => t.status === "Aktif" || t.status === "Baru");
    return tokoRelevan.filter(t => {
      const last = lastKontrolByToko[t.id];
      return !last || last < cutoffStr;
    });
  }, [diagnostikMode, diagnostikRentangHari, cakupanDiagnostik.belumPernah, db.toko, lastKontrolByToko]);

  // ✅ Daftar "belum pernah dikontrol" setelah disaring Wilayah/Rute/pencarian —
  // dipakai baik untuk tabel "Lihat Daftar Toko" maupun tombol "Ekspor Excel",
  // supaya file yang diunduh persis sama dengan yang tampil di layar (bisa
  // dikirim langsung ke sales wilayah/rute tertentu tanpa perlu disortir manual).
  const diagnostikFiltered = useMemo(() => {
    const q = normTxt(diagnostikSearchQ||"");
    return diagnostikBaseList.filter(t => {
      if (diagnostikFilterRuteId && t.ruteId !== diagnostikFilterRuteId) return false;
      if (diagnostikFilterWilayahId && !diagnostikFilterRuteId) {
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        if (!rute || rute.wilayahId !== diagnostikFilterWilayahId) return false;
      }
      if (q && !normTxt(t.nama).includes(q) && !normTxt(t.kode||"").includes(q)) return false;
      return true;
    });
  }, [diagnostikBaseList, diagnostikFilterWilayahId, diagnostikFilterRuteId, diagnostikSearchQ, db.rute]);

  // Monthly view: tampilkan SEMUA toko di rute terpilih, bukan hanya yang ada entri kontrol
  const tokoPerRute = useMemo(() => {
    // Jika filter wilayah/rute aktif, filter sesuai; jika tidak, tampilkan semua rute
    const rutesToShow = filter.ruteId
      ? (db.rute||[]).filter(r=>r.id===filter.ruteId)
      : filter.wilayahId
        ? (db.rute||[]).filter(r=>r.wilayahId===filter.wilayahId)
        : (db.rute||[]);

    return rutesToShow.map(rute => {
      const wilayah = (db.wilayah||[]).find(w=>w.id===rute.wilayahId);
      // Semua toko aktif DAN baru di rute ini (Non-Aktif disembunyikan otomatis mulai bulan berikutnya)
      const tokoList = (db.toko||[]).filter(t=>t.ruteId===rute.id && (t.status==="Aktif" || t.status==="Baru")
        && (!filter.q || normTxt(t.nama).includes(normTxt(filter.q)) || normTxt(t.kode).includes(normTxt(filter.q))))
        .map(toko => {
          const entries = enriched.filter(k=>k.tokoId===toko.id && (!filter.bulan || k.tanggal?.startsWith(filter.bulan)));
          // ✅ Cek apakah toko ini SUDAH ada entri kontrol pada tanggal yang dipilih (filter.cekTanggal)
          const sudahDikontrolHariIni = enriched.some(k=>k.tokoId===toko.id && k.tanggal===filter.cekTanggal);
          return { toko, entries, sudahDikontrolHariIni };
        })
        // Jika toggle "Hanya Belum Dikontrol (tanggal terpilih)" aktif → sembunyikan toko yang sudah dikontrol di tanggal itu
        .filter(({sudahDikontrolHariIni}) => !filter.hanyaBelumHariIni || !sudahDikontrolHariIni);
      return {
        rute, wilayah,
        tokoList
      };
    }).filter(r=>r.tokoList.length>0);
  }, [db.rute, db.wilayah, db.toko, filter.ruteId, filter.wilayahId, filter.bulan, filter.q, filter.cekTanggal, filter.hanyaBelumHariIni, enriched]);

  function getInitialStok(tokoId, produkId) {
    const toko = (db.toko||[]).find(t=>t.id===tokoId);
    return toko?.[`stok_${produkId}`] || 0;
  }

  // ✅ SINKRONISASI STOK: Master Toko ↔ Kontrol Bulanan ↔ Penyesuaian Stok
  // PENTING: "Stok Awal" yang diinput sales saat kontrol itu adalah stok
  // SETELAH etalase diisi ulang saat kunjungan itu juga (kapasitas etalase,
  // misal 24 pcs) — BUKAN sisa sebelum diisi ulang. Karena sales langsung
  // mengisi ulang etalase yang kosong tiap kontrol, stok bulan depan akan
  // KEMBALI ke kapasitas yang sama, jadi cukup dibawa apa adanya (bukan
  // dikurangi Terjual/Bonus lagi — itu cuma dipakai untuk hitung Revenue &
  // pemakaian bonus, bukan untuk menentukan sisa fisik di etalase).
  // Stok di Master Toko dihitung dari GABUNGAN dua sumber:
  //  1) "Stok Awal" pada entri Kontrol Bulanan TERAKHIR (dibawa apa adanya)
  //  2) Semua Penyesuaian Stok (Tambah/Kurang/Tarik Sebagian) yang tanggalnya
  //     SAMA ATAU SETELAH kontrol terakhir tsb — dipakai kalau kapasitas
  //     etalase berubah (mis. 24→12) atau toko ditarik semua di luar siklus
  //     kontrol rutin.
  // extraKontrolList / extraPenyesuaianList: dipakai saat dipanggil tepat
  // setelah addRecord, karena db di closure ini belum memuat data terbaru.
  function recalcTokoStok(tokoId, extraKontrolList, extraPenyesuaianList) {
    const semuaKontrol = extraKontrolList || (db.kontrol||[]);
    const semuaPenyesuaian = extraPenyesuaianList || (db.penyesuaian||[]);
    const entriesToko = semuaKontrol
      .filter(k => k.tokoId === tokoId)
      .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
    const terakhir = entriesToko[entriesToko.length-1];

    // Baseline = "Stok Awal" kontrol terakhir apa adanya (sudah termasuk
    // hasil restock saat kunjungan itu). Kalau belum pernah ada kontrol,
    // baseline = 0.
    const baseline = {};
    produkAktif.forEach(p => {
      baseline[p.id] = terakhir ? Number(terakhir[`stok_${p.id}`]||0) : 0;
    });

    // Tambahkan Penyesuaian Stok yang terjadi pada/sesudah tanggal kontrol terakhir
    const batasTanggal = terakhir?.tanggal || "0000-00-00";
    const penyesuaianRelevan = semuaPenyesuaian
      .filter(pz => pz.tokoId === tokoId && (pz.tanggal||"") >= batasTanggal
        && pz.status !== "menunggu" && pz.status !== "ditolak") // hanya yang disetujui (atau data lama tanpa status)
      .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
    penyesuaianRelevan.forEach(pz => {
      const arah = pz.jenis === "Kurang" || pz.jenis === "Tarik" ? -1 : 1;
      produkAktif.forEach(p => {
        const jumlah = Number(pz[`jumlah_${p.id}`]||0);
        if (jumlah) baseline[p.id] = (baseline[p.id]||0) + arah*jumlah;
      });
    });

    if (!terakhir && penyesuaianRelevan.length === 0) return; // belum ada kontrol maupun penyesuaian → biarkan stok toko (input manual awal) apa adanya

    const updates = {};
    produkAktif.forEach(p => { updates[`stok_${p.id}`] = Math.max(0, baseline[p.id]||0); });
    updateRecord("toko", tokoId, updates);
  }

  // ✅ Helper: dari daftar produkIds baru, hasilkan juga flag produk_<id>
  // (boolean per produk) yang dipakai Master Toko (kolom tabel & form ceklis
  // "Produk yang Dijual" di TabToko). Dua representasi ini (produkIds array
  // vs produk_<id> flags) HARUS selalu diupdate bersamaan supaya ceklis di
  // Master Toko konsisten dengan perubahan yang terjadi lewat Kontrol
  // Bulanan maupun Penyesuaian Stok — sebelumnya cuma produkIds yang
  // terupdate, jadi ceklis di tabel Master Toko tidak ikut berubah.
  function buildProdukFlagUpdates(newIds) {
    const flags = {};
    produkAktif.forEach(p => { flags[`produk_${p.id}`] = newIds.includes(p.id); });
    return flags;
  }

  // ✅ SINKRONISASI CEKLIS "Produk yang Dijual" ↔ Stok Kontrol Bulanan
  // Sebelumnya ceklis produk di Master Toko cuma disinkron otomatis lewat
  // fitur "Penyesuaian Stok" (Tambah), TIDAK lewat kontrol bulanan biasa.
  // Sekarang disamakan:
  //  - Stok Awal diisi > 0 untuk produk yang belum ada ceklisnya → otomatis
  //    dicentang (produk baru dititip saat kunjungan).
  //  - Produk ditandai eksplisit "🔻 Ditarik" di form kontrol (bukan sekadar
  //    Stok Awal = 0, karena stok 0 juga bisa berarti "sementara habis, tetap
  //    mau dijual bulan depan") → otomatis DIHILANGKAN ceklisnya.
  // payload = data stok_${produkId}/ditarik_${produkId} dari entri kontrol
  // yang baru saja disubmit (add atau edit).
  function syncProdukIdsDariStokKontrol(tokoId, payload) {
    const toko = (db.toko||[]).find(t => t.id === tokoId);
    if (!toko) return;
    // Ambil dari flag produk_<id> (bukan array produkIds) sebagai sumber
    // kebenaran, karena itu yang benar-benar dipakai di kolom & form Master
    // Toko — sekaligus otomatis memperbaiki kalau produkIds sempat basi.
    const existingIds = produkAktif.filter(p=>toko[`produk_${p.id}`]).map(p=>p.id);
    const toAdd = [];
    const toRemove = [];
    produkAktif.forEach(p => {
      const stokBaru = Number(payload[`stok_${p.id}`] || 0);
      const ditarik = !!payload[`ditarik_${p.id}`];
      const sudahAda = existingIds.includes(p.id);
      if (stokBaru > 0 && !sudahAda) toAdd.push(p.id);
      else if (ditarik && sudahAda) toRemove.push(p.id);
    });
    if (toAdd.length === 0 && toRemove.length === 0) return;
    const newIds = existingIds.filter(id => !toRemove.includes(id)).concat(toAdd);
    updateRecord("toko", tokoId, { produkIds: newIds, ...buildProdukFlagUpdates(newIds) });
  }

  // ✅ HITUNG ULANG SEMUA STOK — dipakai setelah rumus baseline diperbaiki
  // (Stok Awal dibawa apa adanya, bukan dikurangi Terjual/Bonus lagi), supaya
  // Master Toko yang sudah kadung dihitung pakai rumus lama langsung
  // terkoreksi semua sekaligus, tanpa perlu menunggu kontrol berikutnya
  // satu-satu per toko. Penyesuaian Stok lapangan tetap diperhitungkan
  // seperti biasa (logika di recalcTokoStok tidak berubah untuk bagian itu).
  function recalcAllTokoStok() {
    const tokoIds = [...new Set((db.kontrol||[]).map(k=>k.tokoId))];
    if (!tokoIds.length) { alert("Belum ada data kontrol untuk dihitung."); return; }
    if (!confirm(`Hitung ulang stok untuk ${tokoIds.length} toko yang pernah dikontrol? Ini akan menimpa nilai Stok di Master Toko sesuai data kontrol & penyesuaian yang sudah ada.`)) return;
    tokoIds.forEach(tokoId => recalcTokoStok(tokoId));
    alert(`✅ Selesai — stok ${tokoIds.length} toko sudah dihitung ulang.`);
  }

  function openPenyesuaian(tokoId) {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tokoId: tokoId||"", tanggal: today, jenis:"Tambah", catatan:"", dicatatOleh:"" };
    produkAktif.forEach(p => { initial[`jumlah_${p.id}`] = 0; });
    setPenyesuaianForm(initial);
    setPenyesuaianModal(true);
  }

  function submitPenyesuaian() {
    const pforn = penyesuaianForm;
    if (!pforn?.tokoId || !pforn?.tanggal) return alert("Toko & Tanggal wajib diisi");
    if (isSalesRestricted) {
      const tokoObj = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      const ruteObj = tokoObj ? (db.rute||[]).find(r=>r.id===tokoObj.ruteId) : null;
      if (ruteObj?.wilayahId !== salesWilayahId) {
        return alert("Sebagai Sales, kamu hanya boleh mengajukan penyesuaian stok untuk toko di wilayahmu sendiri.");
      }
    }
    const adaJumlah = produkAktif.some(p => Number(pforn[`jumlah_${p.id}`]||0) > 0);
    if (!adaJumlah) return alert("Isi minimal 1 jumlah produk yang disesuaikan");
    const payload = { ...pforn };
    produkAktif.forEach(p => { payload[`jumlah_${p.id}`] = Number(pforn[`jumlah_${p.id}`]||0); });
    const newId = genId("PZ", db.penyesuaian);
    // ✅ WORKFLOW PERSETUJUAN: pengajuan dari Sales masuk status "menunggu"
    // dulu (tidak langsung mengubah stok), dan otomatis "disetujui" sendiri
    // kalau dalam 24 jam tidak ada penolakan dari Admin/Manajer. Pengajuan
    // dari Admin/Manajer langsung disetujui (tidak perlu approval sendiri).
    const newEntry = {
      ...payload, id:newId,
      status: isSalesRestricted ? "menunggu" : "disetujui",
      autoApproveAt: isSalesRestricted ? (Date.now() + 24*60*60*1000) : null,
    };
    addRecord("penyesuaian", newEntry);

    // ✅ Produk baru yang dititipkan: kalau jenis "Tambah" dan ada produk dengan
    // jumlah > 0 yang BELUM terdaftar di "Produk yang Dijual" toko ini, otomatis
    // daftarkan produk tsb ke profil toko (Master Toko) supaya langsung muncul
    // di form Kontrol bulan berikutnya — admin tidak perlu bolak-balik ke Tab Toko.
    if (pforn.jenis === "Tambah") {
      const toko = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      if (toko) {
        // Sumber kebenaran: flag produk_<id>, bukan array produkIds (lihat
        // catatan di buildProdukFlagUpdates).
        const existingIds = produkAktif.filter(p=>toko[`produk_${p.id}`]).map(p=>p.id);
        const produkBaruIds = produkAktif
          .filter(p => Number(pforn[`jumlah_${p.id}`]||0) > 0 && !existingIds.includes(p.id))
          .map(p=>p.id);
        if (produkBaruIds.length > 0) {
          const newIds = [...existingIds, ...produkBaruIds];
          updateRecord("toko", toko.id, { produkIds: newIds, ...buildProdukFlagUpdates(newIds) });
        }
      }
    } else if (pforn.jenis === "Tarik") {
      // ✅ "Tarik Sebagian Produk" = aksi eksplisit menandai produk ditarik dari
      // toko ini, jadi otomatis hilangkan ceklis "Produk yang Dijual".
      // Sengaja TIDAK berlaku untuk jenis "Kurang", karena "Kurang" dipakai
      // untuk penyesuaian kapasitas etalase biasa (mis. 24→12), produk tsb
      // tetap mau dijual di toko itu meski jumlahnya berkurang.
      const toko = (db.toko||[]).find(t=>t.id===pforn.tokoId);
      if (toko) {
        // Sumber kebenaran: flag produk_<id>, bukan array produkIds (lihat
        // catatan di buildProdukFlagUpdates).
        const existingIds = produkAktif.filter(p=>toko[`produk_${p.id}`]).map(p=>p.id);
        const produkDitarikIds = produkAktif
          .filter(p => Number(pforn[`jumlah_${p.id}`]||0) > 0 && existingIds.includes(p.id))
          .map(p=>p.id);
        if (produkDitarikIds.length > 0) {
          const newIds = existingIds.filter(id=>!produkDitarikIds.includes(id));
          updateRecord("toko", toko.id, { produkIds: newIds, ...buildProdukFlagUpdates(newIds) });
        }
      }
    }

    recalcTokoStok(pforn.tokoId, undefined, [...(db.penyesuaian||[]), newEntry]);
    setPenyesuaianModal(false);
    setPenyesuaianForm(null);
  }

  // ── Penjualan Luar Rute ──────────────────────────────────────────────
  // ✅ Wilayah WAJIB diisi: sales tetap bertanggung jawab atas SEMUA
  // penjualan (sesuai rute maupun di luar rute) di wilayah tugasnya, supaya
  // penjualan luar rute ini bisa ikut masuk ke Rekap Siklus wilayah terkait
  // saat siklus kontrol wilayah tsb selesai — bukan cuma "mengambang" tanpa
  // wilayah seperti sebelumnya.
  function openLuarRute() {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tanggal:today, keterangan:"", dicatatOleh:"", wilayahId: filter.wilayahId||"", ruteId: filter.ruteId||"" };
    produkAktif.forEach(p => { initial[`terjual_${p.id}`] = 0; initial[`bonusInput_${p.id}`] = 0; });
    setLuarRuteForm(initial);
    setLuarRuteModal(true);
  }
  function submitLuarRute() {
    const lforn = luarRuteForm;
    if (!lforn?.tanggal) return alert("Tanggal wajib diisi");
    if (!lforn?.wilayahId) return alert("Wilayah wajib diisi — penjualan luar rute tetap menjadi tanggung jawab sales di wilayah tugasnya");
    if (isSalesRestricted && lforn.wilayahId !== salesWilayahId) {
      return alert("Sebagai Sales, kamu hanya boleh mencatat penjualan luar rute untuk wilayahmu sendiri.");
    }
    const adaTerjualLuar = produkAktif.some(p => Number(lforn[`terjual_${p.id}`]||0) > 0);
    if (!adaTerjualLuar) return alert("Isi minimal 1 jumlah produk yang terjual");
    const payload = { ...lforn };
    produkAktif.forEach(p => {
      payload[`terjual_${p.id}`] = Number(lforn[`terjual_${p.id}`]||0);
      payload[`bonusInput_${p.id}`] = Number(lforn[`bonusInput_${p.id}`]||0);
    });
    const newId = genId("PLR", db.penjualanLuar);
    addRecord("penjualanLuar", { ...payload, id:newId });
    setLuarRuteModal(false);
    setLuarRuteForm(null);
  }
  function deleteLuarRute(id) {
    if (!confirm("Hapus catatan penjualan luar rute ini? Tindakan ini permanen.")) return;
    deleteRecord("penjualanLuar", id);
  }


  const adaTerjual = useMemo(() =>
    produkAktif.some(p => Number(form[`terjual_${p.id}`]||0) > 0)
  , [form, produkAktif]);

  function openAdd() {
    const today = new Date().toISOString().slice(0,10);
    const initial = { tokoId:"", tanggal:today, catatanStatus:"", catatan:"" };
    produkAktif.forEach(p => {
      initial[`stok_${p.id}`] = 0;
      initial[`terjual_${p.id}`] = 0;
      initial[`bonusInput_${p.id}`] = p.bonus||0;
      initial[`ditarik_${p.id}`] = false;
    });
    setForm(initial);
    // ✅ FIX: untuk Sales, wilayah modal SELALU dipaksa ke wilayahnya sendiri
    // (jangan ikut apa adanya filter.wilayahId, jaga-jaga kalau kosong/berubah).
    setModalFilter({ wilayahId: isSalesRestricted ? salesWilayahId : (filter.wilayahId||""), ruteId: filter.ruteId||"" });
    setModal("add");
  }

  function openEdit(row) {
    const initial = { ...row, catatanStatus: row.catatanStatus||"" };
    // Pastikan bonusInput tersedia
    produkAktif.forEach(p => {
      if (initial[`bonusInput_${p.id}`] === undefined) initial[`bonusInput_${p.id}`] = p.bonus||0;
      if (initial[`ditarik_${p.id}`] === undefined) initial[`ditarik_${p.id}`] = false;
    });
    setForm(initial);
    setModalFilter({ wilayahId: row.wilayahId||"", ruteId: row.ruteId||"" });
    setModal("edit");
  }

  function handleTokoChange(tokoId) {
    const updates = { tokoId };
    produkAktif.forEach(p => { updates[`stok_${p.id}`] = getInitialStok(tokoId, p.id); });
    setForm(prev => ({ ...prev, ...updates }));
  }

  // Cascade pilihan Wilayah & Rute di dalam modal Tambah/Edit Kontrol
  function handleModalWilayahChange(wilayahId) {
    setModalFilter({ wilayahId, ruteId:"" });
    setForm(p=>({ ...p, tokoId:"" }));
  }
  function handleModalRuteChange(ruteId) {
    setModalFilter(p=>({ ...p, ruteId }));
    setForm(p=>({ ...p, tokoId:"" }));
  }

  function submit() {
    if (!form.tokoId || !form.tanggal) return alert("Toko & Tanggal wajib diisi");
    // ✅ FIX (pengaman kedua): walau dropdown sudah dikunci di UI, tetap cek
    // ulang di sini sebelum simpan — kalau toko yang dipilih ternyata berada
    // di luar wilayah Sales (misal karena bug lain / state basi), tolak simpan
    // daripada diam-diam tersimpan lintas wilayah.
    if (isSalesRestricted) {
      const tokoDipilih = (db.toko||[]).find(t=>t.id===form.tokoId);
      const ruteDipilih = tokoDipilih ? (db.rute||[]).find(r=>r.id===tokoDipilih.ruteId) : null;
      if (!ruteDipilih || ruteDipilih.wilayahId !== salesWilayahId) {
        return alert("❌ Toko ini berada di luar wilayah Anda. Kontrol tidak dapat disimpan.");
      }
    }
    // ⚠️ Validasi kontrol ganda: cegah input dobel untuk toko yang sama di
    // tanggal yang sama (kecuali entri yang sedang diedit sendiri). Tetap
    // izinkan lanjut kalau memang disengaja (mis. koreksi/kunjungan susulan),
    // tapi wajib konfirmasi eksplisit dulu.
    const duplikatKontrol = (db.kontrol||[]).some(k =>
      k.tokoId === form.tokoId && k.tanggal === form.tanggal && !(modal==="edit" && k.id===form.id)
    );
    if (duplikatKontrol) {
      const namaTokoDup = (db.toko||[]).find(t=>t.id===form.tokoId)?.nama || "Toko ini";
      const lanjut = confirm(
        `⚠️ ${namaTokoDup} SUDAH ada entri kontrol pada tanggal ${form.tanggal}.\n\n` +
        `Menyimpan sekarang akan menambah entri kontrol KEDUA di hari yang sama untuk toko ini.\n\n` +
        `Lanjutkan simpan?`
      );
      if (!lanjut) return;
    }
    // Status kunjungan WAJIB jika tidak ada produk terjual; opsional jika ada penjualan
    if (!adaTerjual && !form.catatanStatus) return alert("Pilih status kunjungan karena tidak ada produk yang terjual");
    const d = form.tanggal;
    const [y,m] = d.split("-");
    const payload = { ...form };
    // catatanStatus tetap disimpan apa adanya (boleh ada catatan meski ada penjualan)
    // Jika user tidak pilih status apapun → biarkan kosong (= Terjual normal)
    produkAktif.forEach(p => {
      const ditarik = !!form[`ditarik_${p.id}`];
      // ✅ Kalau ditandai "Ditarik", paksa Stok Awal ke 0 apapun yang keisi di input
      // (mencegah sales lupa mengosongkan angka stok saat menandai produk ditarik)
      payload[`stok_${p.id}`] = ditarik ? 0 : Number(form[`stok_${p.id}`]||0);
      payload[`terjual_${p.id}`] = Number(form[`terjual_${p.id}`]||0);
      payload[`bonusInput_${p.id}`] = Number(form[`bonusInput_${p.id}`]||0);
      payload[`ditarik_${p.id}`] = ditarik;
    });
    if (modal==="add") {
      // ⚠️ FIX BUG: ID kontrol dulu dihitung dari nomor urut bulan ini
      // (`${y}-${m}-NNN`) berdasarkan snapshot db lokal di browser sales.
      // Karena app ini multi-user real-time (Firebase), kalau 2 sales input
      // kontrol hampir bersamaan (toko/rute berbeda sekalipun), keduanya bisa
      // menghitung nomor urut YANG SAMA → ID sama → entri kedua MENIMPA
      // entri pertama di Firebase (path kontrol/{id} sama). Akibatnya entri
      // toko pertama "hilang" (jadi Belum Dikontrol lagi) padahal stoknya
      // sudah terlanjur dikurangi oleh recalcTokoStok sebelum tertimpa.
      // Solusi: tambahkan suffix unik (timestamp + random) yang TIDAK
      // bergantung pada hitungan data lain, jadi tidak mungkin bentrok
      // walau dua sales submit di detik yang sama.
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const newEntry = { ...payload, id:`${y}-${m}-${form.tokoId}-${uniqueSuffix}` };
      addRecord("kontrol", newEntry);
      // Sinkron stok master Toko pakai daftar kontrol + entri baru (db.kontrol di closure belum update)
      recalcTokoStok(form.tokoId, [...(db.kontrol||[]), newEntry]);
      // ✅ Sinkron ceklis "Produk yang Dijual": produk baru dititip saat kunjungan
      // otomatis dicentang, produk yang stoknya diisi 0 (ditarik) otomatis dihilangkan.
      syncProdukIdsDariStokKontrol(form.tokoId, payload);
    } else {
      updateRecord("kontrol", form.id, payload);
      // Sinkron stok master Toko: ganti entri lama dengan payload terbaru sebelum dihitung ulang
      const updatedList = (db.kontrol||[]).map(k => k.id===form.id ? { ...k, ...payload } : k);
      recalcTokoStok(form.tokoId, updatedList);
      syncProdukIdsDariStokKontrol(form.tokoId, payload);
    }
    setModal(null);
  }

  // ─── NONAKTIFKAN TOKO DARI KONTROL (logika penarikan toko) ───
  // Dipanggil saat petugas menandai toko sebagai "ditarik" / Non-Aktif langsung dari menu kontrol.
  // Proses:
  // 1. Update status toko di master toko → Non-Aktif (tersinkron ke tab Toko)
  // 2. Jika ada produk terjual di entri kontrol terakhir, stok toko otomatis dikembalikan
  //    ke stok awal (dikurangi terjual = sisa stok dikembalikan ke gudang)
  // 3. Toko tidak lagi muncul di dropdown kontrol bulan berikutnya
  // 4. Stok bisa disesuaikan manual (ditambah/dikurangi) sebelum konfirmasi
  // ✅ Submit modal Tambah Toko cepat dari Kontrol — rute/wilayah otomatis dari filter aktif
  function submitTambahToko() {
    const { nama, ruteId, status, catatan, produkIds } = tambahTokoForm;
    if (!nama || !ruteId) return alert("Nama & Rute wajib diisi");
    const ruteObj = (db.rute||[]).find(r=>r.id===ruteId);
    if (isSalesRestricted && ruteObj?.wilayahId !== salesWilayahId) {
      return alert("Sebagai Sales, kamu hanya boleh menambahkan toko di wilayahmu sendiri.");
    }
    const isDup = (db.toko||[]).some(t =>
      t.nama.toLowerCase().trim() === nama.toLowerCase().trim() && t.ruteId === ruteId
    );
    if (isDup) return alert(`Toko "${nama}" sudah terdaftar di rute ini.`);
    const prefix = ruteObj ? "GW-"+ruteObj.nama.slice(0,3).toUpperCase()+"-" : "GW-XXX-";
    const newId = genId("T", db.toko);
    const counter = newId.replace("T","");
    const today = new Date().toISOString().slice(0,10);
    const tanggalMasuk = status === "Baru" ? today : null;
    // ✅ Produk yang dititip + stok awalnya langsung tersimpan sejak toko
    // dibuat — dulu harus ditambah manual belakangan lewat Penyesuaian
    // Stok. Pakai buildProdukFlagUpdates() yang sama dengan yang dipakai
    // Kontrol/Penyesuaian Stok, supaya representasi produkIds ↔ produk_<id>
    // selalu konsisten di satu tempat, tidak diduplikasi manual di sini.
    const payload = { id:newId, nama, ruteId, status, catatan, kode:prefix+counter, tanggalMasuk,
      produkIds: produkIds||[], ...buildProdukFlagUpdates(produkIds||[]) };
    produkAktif.forEach(p => {
      payload[`stok_${p.id}`] = (produkIds||[]).includes(p.id) ? Number(tambahTokoForm[`stok_${p.id}`]||0) : 0;
    });
    addRecord("toko", payload);
    setTambahTokoModal(false);
    setTambahTokoForm({ nama:"", ruteId:"", status:"Aktif", catatan:"", produkIds:[] });
    alert(`✅ Toko "${nama}" berhasil ditambahkan!`);
  }

  function openTokoStatusModal(toko) {
    // ✅ FIX: default ke 0 (dianggap SEMUA stok ditarik/habis), bukan stok
    // saat ini — sebelumnya form ini prefill dengan stok yang masih ada,
    // sehingga kalau admin tidak sengaja tidak mengubah apapun lalu langsung
    // konfirmasi, stok di Master Toko malah TIDAK berubah sama sekali
    // (delta=0, tidak ada Penyesuaian tercatat), padahal tokonya sudah
    // dinonaktifkan. Kalau memang ada stok yang secara nyata dikembalikan ke
    // gudang, admin tinggal isi manual jumlahnya.
    const stokInit = {};
    produkAktif.forEach(p => { stokInit[p.id] = 0; });
    setStokPenarikan(stokInit);
    setTokoStatusModal({ toko });
  }

  function konfirmasiNonaktifkanToko() {
    if (!tokoStatusModal) return;
    const { toko } = tokoStatusModal;
    // Update status toko → Non-Aktif di master toko, sekaligus update stok saat penarikan
    // ✅ FIX: toko yang dinonaktifkan sudah tidak menjual produk apapun lagi —
    // kosongkan juga produkIds & ceklis produk_<id> di Master Toko (sebelumnya
    // dua field ini tidak ikut disentuh, jadi toko yang sudah Non-Aktif masih
    // tampak "menjual" produk lama dengan ceklis tercentang di tab Toko).
    const tokoUpdates = { status: "Non-Aktif", produkIds: [], ...buildProdukFlagUpdates([]) };

    // ✅ Catat selisih stok (sebelum vs sesudah penarikan) sebagai Penyesuaian
    // Stok otomatis — sebelumnya perubahan stok di sini langsung menimpa
    // Master Toko tanpa jejak audit sama sekali, beda dengan cara lain
    // (kontrol, penyesuaian manual) yang selalu punya riwayat. Kalau produk
    // campuran (sebagian naik, sebagian turun), dipisah jadi 2 catatan biar
    // arah (Tambah/Kurang) tetap benar per kelompok produk.
    const today = new Date().toISOString().slice(0,10);
    const naik = {}, turun = {};
    let adaNaik = false, adaTurun = false;
    produkAktif.forEach(p => {
      const sebelum = Number(toko[`stok_${p.id}`]||0);
      const sesudah = Number(stokPenarikan[p.id]||0);
      const delta = sesudah - sebelum;
      tokoUpdates[`stok_${p.id}`] = sesudah;
      if (delta > 0) { naik[`jumlah_${p.id}`] = delta; adaNaik = true; }
      else if (delta < 0) { turun[`jumlah_${p.id}`] = -delta; adaTurun = true; }
    });
    updateRecord("toko", toko.id, tokoUpdates);

    const catatanOtomatis = `Otomatis tercatat dari penarikan stok saat toko "${toko.nama}" dinonaktifkan.`;
    if (adaTurun) {
      addRecord("penyesuaian", {
        id: genUniqueId("PZ"), tokoId: toko.id, tanggal: today, jenis: "Tarik",
        catatan: catatanOtomatis, dicatatOleh: "Sistem (Nonaktifkan Toko)", ...turun,
      });
    }
    if (adaNaik) {
      addRecord("penyesuaian", {
        id: genUniqueId("PZ"), tokoId: toko.id, tanggal: today, jenis: "Tambah",
        catatan: catatanOtomatis, dicatatOleh: "Sistem (Nonaktifkan Toko)", ...naik,
      });
    }

    setTokoStatusModal(null);
    setStokPenarikan({});
    // ✅ Kalau dipicu dari dalam modal Tambah/Edit Kontrol (form.tokoId sama
    // dengan toko yang baru dinonaktifkan), tutup juga modal itu — toko sudah
    // Non-Aktif, tidak relevan lagi melanjutkan input kontrol bulanan untuknya.
    if (modal && form.tokoId === toko.id) {
      setModal(null);
    }
  }

  // ✅ BARU: Buka modal Edit Status Toko
  function openEditStatusModal(toko) {
    setEditStatusValue(toko.status || "Aktif");
    setEditStatusCatatan("");
    setEditStatusModal({ toko });
  }

  // ✅ BARU: Simpan perubahan status toko dari modal EditStatus
  function konfirmasiEditStatusToko() {
    if (!editStatusModal) return;
    const { toko } = editStatusModal;
    if (!editStatusValue) return alert("Pilih status toko terlebih dahulu.");
    const updates = { status: editStatusValue };
    // Jika diubah ke Non-Aktif via jalur ini (bukan via "Tarik Toko"),
    // stok TIDAK diubah — tetap seperti semula di master toko.
    updateRecord("toko", toko.id, updates);
    setEditStatusModal(null);
    setEditStatusValue("");
    setEditStatusCatatan("");
  }

  const ruteOpts = ruteFiltered.map(r=>({ value:r.id, label:r.nama }));
  const wilayahOpts = (db.wilayah||[]).map(w=>({ value:w.id, label:w.nama }));

  // ✅ Opsi Rute khusus modal Penjualan Luar Rute — ikut cascade dari Wilayah
  // yang dipilih di form itu (sama seperti pola cascade Wilayah → Rute di
  // form lain), supaya sales bisa (opsional) menandai rute mana yang
  // sebenarnya jadi sumber penjualan luar rute tsb.
  const luarRuteRuteOpts = useMemo(() => {
    const wid = luarRuteForm?.wilayahId;
    const list = wid ? (db.rute||[]).filter(r=>r.wilayahId===wid) : (db.rute||[]);
    return [...list]
      .sort((a,b)=>naturalCompare(a.nama||"", b.nama||""))
      .map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, luarRuteForm?.wilayahId]);

  // Opsi Rute & Toko di dalam modal Tambah/Edit Kontrol — mengikuti cascade Wilayah → Rute → Toko
  const modalRuteOpts = useMemo(() => {
    let list = modalFilter.wilayahId
      ? (db.rute||[]).filter(r=>r.wilayahId===modalFilter.wilayahId)
      : (db.rute||[]);
    // ✅ FIX: Sales cuma boleh pilih rute di wilayahnya sendiri — sebelumnya
    // dropdown ini tidak dibatasi sama sekali, sehingga Sales bisa memilih
    // rute (dan toko) di wilayah manapun lewat modal Tambah Kontrol.
    if (isSalesRestricted) list = list.filter(r=>r.wilayahId===salesWilayahId);
    return [...list].sort((a,b) => {
      const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
      const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
      const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
      if (wCompare !== 0) return wCompare;
      return naturalCompare(a.nama||"", b.nama||"");
    }).map(r=>({ value:r.id, label:r.nama }));
  }, [db.rute, db.wilayah, modalFilter.wilayahId, isSalesRestricted, salesWilayahId]);

  // ✅ Rentang siklus per wilayah — pakai algoritma & konstanta yang SAMA
  // dengan "Siklus Wilayah" di Rekap (lib/dataHelpers.js → SIKLUS_GAP_DAYS):
  // mundur dari tanggal kontrol terbaru di wilayah itu, selama jeda antar
  // tanggal berurutan tidak lebih dari SIKLUS_GAP_DAYS hari. Periode kontrol
  // TIDAK selalu pas 1 bulan kalender — bisa maju-mundur tanggalnya, jadi
  // definisinya harus ikut yang dipakai Rekap, bukan sekadar potong "YYYY-MM".
  // Tanggal yang sedang diisi di form (form.tanggal) ikut dianggap bagian
  // siklus berjalan walau belum tersimpan, supaya badge langsung bereaksi
  // begitu tanggal diisi/diganti.
  const siklusRangePerWilayah = useMemo(() => {
    const byWilayah = {};
    enriched.forEach(k => {
      if (!k.wilayahId || !k.tanggal) return;
      (byWilayah[k.wilayahId] ||= new Set()).add(k.tanggal);
    });
    if (form.tanggal) {
      const tokoTerpilih = (db.toko||[]).find(t => t.id === form.tokoId);
      const ruteTerpilih = tokoTerpilih ? (db.rute||[]).find(r=>r.id===tokoTerpilih.ruteId) : null;
      const wilayahAnchor = ruteTerpilih?.wilayahId || modalFilter.wilayahId;
      if (wilayahAnchor) (byWilayah[wilayahAnchor] ||= new Set()).add(form.tanggal);
    }
    const map = {};
    Object.entries(byWilayah).forEach(([wilayahId, dateSet]) => {
      const dates = [...dateSet].sort();
      let end = dates[dates.length-1];
      let start = end;
      for (let i = dates.length-2; i >= 0; i--) {
        const diffDays = (new Date(start) - new Date(dates[i])) / 86400000;
        if (diffDays > SIKLUS_GAP_DAYS) break;
        start = dates[i];
      }
      map[wilayahId] = { start, end };
    });
    return map;
  }, [enriched, form.tanggal, form.tokoId, db.toko, db.rute, modalFilter.wilayahId]);

  const modalTokoOpts = useMemo(() => {
    // Tampilkan toko Aktif DAN Baru di dropdown kontrol (jangan tampilkan Non-Aktif)
    // Label disertai badge status supaya petugas langsung tahu statusnya tanpa buka tab Toko
    let list = (db.toko||[]).filter(t => t.status === "Aktif" || t.status === "Baru");
    // ✅ FIX: Sales cuma boleh pilih toko di wilayahnya sendiri, sama seperti
    // sudah diterapkan di allTokoOpts (Penyesuaian Stok) — sebelumnya dropdown
    // toko di modal Tambah Kontrol ini tidak ikut dibatasi, jadi Sales bisa
    // input kontrol untuk toko wilayah lain.
    if (isSalesRestricted) {
      const ruteIdsSendiri = new Set((db.rute||[]).filter(r=>r.wilayahId===salesWilayahId).map(r=>r.id));
      list = list.filter(t=>ruteIdsSendiri.has(t.ruteId));
    }
    if (modalFilter.ruteId) {
      list = list.filter(t=>t.ruteId===modalFilter.ruteId);
    } else if (modalFilter.wilayahId) {
      const ruteIds = (db.rute||[]).filter(r=>r.wilayahId===modalFilter.wilayahId).map(r=>r.id);
      list = list.filter(t=>ruteIds.includes(t.ruteId));
    }
    const tglCek = form.tanggal;
    return list.map(t => {
      const statusBadge = t.status === "Baru" ? " 🆕 [BARU]" : t.status === "Aktif" ? "" : ` [${t.status}]`;
      const sudahDikontrol = !!tglCek && (db.kontrol||[]).some(k =>
        k.tokoId === t.id && k.tanggal === tglCek && !(modal==="edit" && k.id===form.id)
      );
      let extraBadge = null;
      if (!sudahDikontrol) {
        const ruteToko = (db.rute||[]).find(r=>r.id===t.ruteId);
        const siklus = ruteToko ? siklusRangePerWilayah[ruteToko.wilayahId] : null;
        if (siklus) {
          const entriSiklusIni = (db.kontrol||[]).filter(k =>
            k.tokoId === t.id && k.tanggal >= siklus.start && k.tanggal <= siklus.end && !(modal==="edit" && k.id===form.id)
          );
          if (entriSiklusIni.length === 0) {
            extraBadge = { label: "🔴 Belum Kontrol", title: `Belum ada entri kontrol untuk toko ini di siklus berjalan (${siklus.start} s/d ${siklus.end})`, color: T.red, bg: T.redLt };
          } else if (entriSiklusIni.every(k => k.catatanStatus === "tutup")) {
            extraBadge = { label: "🟠 Tutup, Perlu Diulang", title: "Semua kunjungan di siklus berjalan ketemu toko tutup — belum ada kontrol yang berhasil", color: T.orange, bg: T.orangeLt };
          }
        }
      }
      return { value:t.id, label: `${t.nama}${statusBadge}${t.kode?` (${t.kode})` :""}`, sudahDikontrol, extraBadge };
    });
  }, [db.toko, db.rute, db.kontrol, modalFilter, form.tanggal, form.id, modal, isSalesRestricted, salesWilayahId, siklusRangePerWilayah]);

  // ✅ Flag toko yang sedang dipilih di form: apakah SUDAH ada entri kontrol
  // untuk tanggal yang sama (dipakai untuk banner peringatan di modal)
  const tokoSudahDikontrolHariIni = useMemo(() => {
    if (!form.tokoId || !form.tanggal) return false;
    return (db.kontrol||[]).some(k =>
      k.tokoId === form.tokoId && k.tanggal === form.tanggal && !(modal==="edit" && k.id===form.id)
    );
  }, [db.kontrol, form.tokoId, form.tanggal, form.id, modal]);

  // Daftar toko untuk dropdown Penyesuaian Stok (tidak terikat filter wilayah/rute modal kontrol)
  const allTokoOpts = useMemo(() => {
    return (db.toko||[])
      .filter(t => t.status === "Aktif" || t.status === "Baru")
      .filter(t => {
        if (!isSalesRestricted) return true;
        const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
        return rute?.wilayahId === salesWilayahId; // Sales cuma boleh pilih toko wilayahnya sendiri
      })
      .map(t => ({ value:t.id, label: `${t.nama}${t.kode?` (${t.kode})`:""}` }));
  }, [db.toko, db.rute, isSalesRestricted, salesWilayahId]);

  // Import Kontrol Bulanan dari Excel
  function importKontrolFromRows(rows) {
    const errors = [];
    let added = 0, skipped = 0;
    const newKontrol = [...(db.kontrol||[])];
    rows.forEach((row, i) => {
      const rowNum = i + 2; // header = baris 1
      const tokoNama = String(row["Toko*"] ?? row["Toko"] ?? "").trim();
      const tanggalRaw = row["Tanggal* (YYYY-MM-DD)"] ?? row["Tanggal"] ?? "";
      if (!tokoNama || !tanggalRaw) { errors.push(`Baris ${rowNum}: Toko & Tanggal wajib diisi`); skipped++; return; }
      const tokoObj = (db.toko||[]).find(t => t.nama.toLowerCase() === tokoNama.toLowerCase());
      if (!tokoObj) { errors.push(`Baris ${rowNum}: Toko "${tokoNama}" tidak ditemukan di Master Toko`); skipped++; return; }

      let tanggal = tanggalRaw;
      if (tanggal instanceof Date) tanggal = tanggal.toISOString().slice(0,10);
      else tanggal = String(tanggal).trim().slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) { errors.push(`Baris ${rowNum}: Format Tanggal tidak valid ("${tanggalRaw}")`); skipped++; return; }

      const payload = { tokoId: tokoObj.id, tanggal, catatanStatus:"", catatan:"" };
      let adaTerjualRow = false;
      produkAktif.forEach(p => {
        const stok = Number(row[`Stok Awal: ${p.nama}`] ?? 0) || 0;
        const terjual = Number(row[`Terjual: ${p.nama}`] ?? 0) || 0;
        const bonus = Number(row[`Bonus: ${p.nama}`] ?? p.bonus ?? 0) || 0;
        payload[`stok_${p.id}`] = stok;
        payload[`terjual_${p.id}`] = terjual;
        payload[`bonusInput_${p.id}`] = bonus;
        if (terjual > 0) adaTerjualRow = true;
      });

      const statusLabel = String(row["Status Kunjungan"] ?? "").trim();
      if (statusLabel) {
        // Ada status → validasi dan simpan (berlaku baik saat terjual maupun tidak)
        const found = Object.entries(CATATAN_STATUS).find(([,cs]) => cs.label.toLowerCase()===statusLabel.toLowerCase());
        if (!found) { errors.push(`Baris ${rowNum}: Status Kunjungan "${statusLabel}" tidak dikenali`); skipped++; return; }
        payload.catatanStatus = found[0];
        if (payload.catatanStatus === "manual") payload.catatan = String(row["Catatan"] ?? "").trim();
      } else if (!adaTerjualRow) {
        // Tidak ada status DAN tidak ada penjualan → wajib ada status
        errors.push(`Baris ${rowNum}: Status Kunjungan wajib diisi jika tidak ada produk yang terjual`); skipped++; return;
      } else {
        // Ada penjualan, status kosong → oke, Terjual normal (catatanStatus = "")
        payload.catatanStatus = "";
      }

      const [y,m] = tanggal.split("-");
      // ID unik (lihat catatan fix di submit()) — hindari tabrakan dengan data lain
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + rowNum;
      newKontrol.push({ ...payload, id:`${y}-${m}-${payload.tokoId}-${uniqueSuffix}` });
      added++;
    });
    if (added > 0) {
      // Sinkron stok master Toko untuk setiap toko yang terdampak import, berdasarkan entri terakhir
      const affectedTokoIds = [...new Set(newKontrol.map(k=>k.tokoId))];
      const newToko = (db.toko||[]).map(t => {
        if (!affectedTokoIds.includes(t.id)) return t;
        const entriesToko = newKontrol.filter(k=>k.tokoId===t.id)
          .sort((a,b) => (a.tanggal||"").localeCompare(b.tanggal||"") || (a.id||"").localeCompare(b.id||""));
        const terakhir = entriesToko[entriesToko.length-1];
        if (!terakhir) return t;
        const updated = { ...t };
        produkAktif.forEach(p => {
          // "Stok Awal" dibawa apa adanya (lihat catatan di recalcTokoStok) —
          // sudah mencerminkan hasil restock etalase saat kunjungan itu.
          updated[`stok_${p.id}`] = Number(terakhir[`stok_${p.id}`]||0);
        });
        // ✅ FIX SINKRONISASI: entri manual (submit()) selalu memanggil
        // syncProdukIdsDariStokKontrol setelahnya supaya ceklis "Produk yang
        // Dijual" ikut ter-update kalau ada produk baru dititip — import
        // massal sebelumnya TIDAK melakukan ini sama sekali, jadi toko yang
        // baru pertama kali dititipi produk lewat file Excel tidak otomatis
        // tercentang di Master Toko (harus dicentang manual belakangan).
        // Disamakan di sini: produk dengan Stok Awal > 0 di entri TERAKHIR
        // yang belum tercentang, otomatis ditambahkan ke ceklis.
        const existingIds = produkAktif.filter(p=>!!t[`produk_${p.id}`]).map(p=>p.id);
        const toAdd = produkAktif.filter(p =>
          Number(terakhir[`stok_${p.id}`]||0) > 0 && !existingIds.includes(p.id)
        ).map(p=>p.id);
        if (toAdd.length > 0) {
          const finalIds = [...new Set(existingIds.concat(toAdd))];
          updated.produkIds = finalIds;
          produkAktif.forEach(p => { updated[`produk_${p.id}`] = finalIds.includes(p.id); });
        }
        return updated;
      });
      save({ ...db, kontrol:newKontrol, toko:newToko });
    }
    return { added, skipped, errors };
  }

  const selToko = (db.toko||[]).find(t=>t.id===form.tokoId);
  // ✅ Total Revenue & Bonus di header kini ikut menjumlahkan Penjualan Luar
  // Rute yang cocok dengan filter aktif — sebelumnya hanya menghitung entri
  // Kontrol Bulanan, jadi tidak konsisten dengan Rekap yang sudah menyertakan
  // kontribusi luar rute per rute.
  const totalRevData = data.reduce((s,k)=>s+k.totalRev,0) + luarRuteData.reduce((s,k)=>s+k.totalRev,0);
  const totalBonusData = data.reduce((s,k)=>s+k.totalBonus,0) + luarRuteData.reduce((s,k)=>s+k.totalBonus,0);
  const catatanSt = form.catatanStatus||"";

  const cols = [
    { key:"id",           label:"ID",         render:v=><code style={{ fontSize:10 }}>{v}</code> },
    { key:"tokoNama",     label:"Toko",       render:(v,row)=>{
      const tkObj = (db.toko||[]).find(t=>t.id===row.tokoId);
      const stMap = { "Aktif": { icon:"✅", color:T.green }, "Baru": { icon:"🆕", color:T.blue }, "Non-Aktif": { icon:"🔴", color:T.red } };
      const st = tkObj ? (stMap[tkObj.status]||stMap["Aktif"]) : null;
      return (
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <b>{v}</b>
          {st && tkObj && (
            <span
              title={`Status toko: ${tkObj.status} — klik untuk edit`}
              onClick={e=>{ e.stopPropagation(); openEditStatusModal(tkObj); }}
              style={{ cursor:"pointer", fontSize:10, background:st.color+"22", color:st.color,
                border:`1px solid ${st.color}44`, borderRadius:99, padding:"1px 7px", fontWeight:700, lineHeight:1.6,
                userSelect:"none", flexShrink:0 }}
            >{st.icon} {tkObj.status}</span>
          )}
        </div>
      );
    }},
    { key:"wilayahNama",  label:"Wilayah",    render:v=><Badge color={T.green}>{v}</Badge> },
    { key:"ruteNama",     label:"Rute",       render:v=><Badge color={T.teal}>{v}</Badge> },
    { key:"tanggal",      label:"Tanggal" },
    ...produkAktif.flatMap(p=>[
      { key:`stok_${p.id}`,        label:`Stok ${p.id}` },
      { key:`terjual_${p.id}`,     label:`Jual ${p.id}` },
      { key:`bonusInput_${p.id}`,  label:`Bonus ${p.id} (pcs)`, render:(v,row)=><span style={{ color:T.gold }}>{(v||0)} pcs</span> },
    ]),
    { key:"totalRev",    label:"Revenue",    render:v=><b style={{ color:T.green }}>{fmtRp(v)}</b> },
    { key:"totalBonus",  label:"Ttl Bonus",  render:v=><b style={{ color:T.gold }}>{fmt(v)} pcs</b> },
    { key:"catatanStatus",label:"Status",    render:(v,row)=>{ if(!v) return <Badge color={T.green}>✅ Terjual</Badge>; const s=CATATAN_STATUS[v]||CATATAN_STATUS.manual; return <span title={row.catatan||""} style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Badge color={s.color} bg={s.bg}>{s.label}</Badge>{row.catatan && <span style={{ fontSize:10, color:s.color, opacity:.7 }}>📝</span>}</span>; } },
    { key:"catatan",     label:"Catatan" },
  ];

  return (
    <div>
      {/* Ringkasan Penyesuaian Stok yang menunggu persetujuan (Admin/Manajer
          saja) — supaya tidak perlu buka toko satu-satu untuk ketahuan ada
          pengajuan dari Sales yang butuh ditinjau. Auto-approve 24 jam sudah
          jalan sendiri, ini cuma buat yang mau ditinjau/ditolak lebih awal. */}
      {!isSalesRestricted && (() => {
        const pending = (db.penyesuaian||[]).filter(pz=>pz.status==="menunggu");
        if (pending.length === 0) return null;
        return (
          <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:10,
            padding:"10px 16px", marginBottom:14, fontSize:13, color:"#92400E" }}>
            ⏳ Ada <b>{pending.length} pengajuan Penyesuaian Stok</b> dari Sales yang menunggu persetujuan
            (otomatis disetujui dalam 24 jam kalau tidak ditinjau). Buka detail toko terkait di bawah untuk
            menyetujui/menolak lebih awal.
          </div>
        );
      })()}
      {/* Fix: ConfirmDelete global untuk view monthly & tabel */}
      {deleteTarget && (
        <ConfirmDelete
          label="Data kontrol ini akan dihapus permanen."
          onConfirm={() => {
            const tokoIdTerdampak = (db.kontrol||[]).find(k=>k.id===deleteTarget)?.tokoId;
            deleteRecord("kontrol", deleteTarget);
            if (tokoIdTerdampak) {
              const remaining = (db.kontrol||[]).filter(k => k.id !== deleteTarget);
              recalcTokoStok(tokoIdTerdampak, remaining);
            }
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Modal Konfirmasi Penarikan / Non-Aktifkan Toko dari Kontrol */}
      {tokoStatusModal && (
        <Modal title="🏪 Tarik / Non-Aktifkan Toko" onClose={() => { setTokoStatusModal(null); setStokPenarikan({}); }} width={520}>
          <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#DC2626", marginBottom:4 }}>⚠️ Toko akan ditarik / dinonaktifkan</div>
            <div style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>
              Toko <b>{tokoStatusModal.toko.nama}</b> akan diubah statusnya menjadi <b>Non-Aktif</b>.<br/>
              Toko ini <b>tidak akan muncul</b> di dropdown kontrol bulan berikutnya.<br/>
              Untuk mengaktifkan kembali, buka tab <b>Toko</b> dan edit status toko tersebut.
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#1F2937", marginBottom:6 }}>📦 Stok Produk Saat Penarikan</div>
            <div style={{ fontSize:12, color:"#6B7280", marginBottom:10, lineHeight:1.5 }}>
              Isi stok produk yang dikembalikan ke gudang saat toko ini ditarik. Stok ini akan disimpan ke master toko sebagai referensi.<br/>
              <span style={{ color:"#D97706", fontWeight:600 }}>Isi 0 jika semua stok sudah habis terjual atau tidak ada yang dikembalikan.</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
              {produkAktif.map(p => (
                <div key={p.id} style={{ background:"#F9FAFB", border:"1.5px solid #E5E7EB", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1F2937", marginBottom:8 }}>{p.nama}</div>
                  <div style={{ fontSize:11, color:"#9CA3AF", marginBottom:4 }}>Stok dikembalikan (pcs)</div>
                  <input
                    type="number" min={0}
                    value={stokPenarikan[p.id] || 0}
                    onChange={e => setStokPenarikan(prev => ({ ...prev, [p.id]: e.target.value }))}
                    style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #E5E7EB",
                      borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12 }}>
            ℹ️ Data kontrol yang sudah ada untuk toko ini <b>tidak akan dihapus</b> — status toko diubah menjadi Non-Aktif, stok diperbarui, dan ceklis "Produk yang Dijual" di Master Toko ikut <b>dikosongkan</b> (karena toko ini sudah tidak menjual produk apapun).
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={() => { setTokoStatusModal(null); setStokPenarikan({}); }}>Batal</Btn>
            <Btn variant="danger" onClick={konfirmasiNonaktifkanToko}>🔴 Nonaktifkan Toko & Perbarui Stok</Btn>
          </div>
        </Modal>
      )}

      {/* ✅ BARU: Modal Edit Status Toko — terintegrasi dengan master toko */}
      {editStatusModal && (() => {
        const { toko } = editStatusModal;
        const STATUS_OPTS = [
          { value: "Aktif",     label: "Aktif",      icon: "✅", desc: "Toko aktif & muncul di dropdown kontrol.", color: T.green,  bg: T.greenLt,  border: T.green+"44" },
          { value: "Baru",      label: "Baru",       icon: "🆕", desc: "Toko baru, akan muncul di kontrol & ditandai BARU.", color: T.blue,   bg: T.blueLt,   border: "#93C5FD" },
          { value: "Non-Aktif", label: "Non-Aktif",  icon: "🔴", desc: "Toko tidak aktif, tersembunyi dari dropdown kontrol.", color: T.red,    bg: T.redLt,    border: "#FCA5A5" },
        ];
        const currentOpt = STATUS_OPTS.find(o => o.value === toko.status) || STATUS_OPTS[0];
        const selectedOpt = STATUS_OPTS.find(o => o.value === editStatusValue) || null;
        const changed = editStatusValue && editStatusValue !== toko.status;
        return (
          <Modal title="🏷️ Edit Status Toko" onClose={() => { setEditStatusModal(null); setEditStatusValue(""); setEditStatusCatatan(""); }} width={480}>
            {/* Info toko */}
            <div style={{ background: T.gray50, border: `1px solid ${T.gray200}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 28 }}>🏪</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: T.gray800 }}>{toko.nama}</div>
                <div style={{ fontSize: 12, color: T.gray400 }}>
                  {toko.kode && <span style={{ marginRight: 8 }}>Kode: <b>{toko.kode}</b></span>}
                  Status saat ini:{" "}
                  <span style={{ fontWeight: 700, color: currentOpt.color, background: currentOpt.bg, borderRadius: 99, padding: "1px 8px", fontSize: 11 }}>
                    {currentOpt.icon} {toko.status || "Aktif"}
                  </span>
                </div>
              </div>
            </div>

            {/* Pilihan status */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 10 }}>Ubah status toko menjadi:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {STATUS_OPTS.map(opt => {
                  const isSelected = editStatusValue === opt.value;
                  const isCurrent = toko.status === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setEditStatusValue(opt.value)}
                      style={{
                        cursor: "pointer",
                        border: `2px solid ${isSelected ? opt.color : T.gray200}`,
                        borderRadius: 10,
                        padding: "12px 16px",
                        background: isSelected ? opt.bg : T.white,
                        display: "flex", alignItems: "center", gap: 12,
                        transition: "all .15s",
                        opacity: isCurrent && !isSelected ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: 22 }}>{opt.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: isSelected ? opt.color : T.gray800 }}>
                          {opt.label}
                          {isCurrent && (
                            <span style={{ marginLeft: 8, fontSize: 10, background: T.gray200, color: T.gray600, borderRadius: 99, padding: "1px 7px" }}>
                              Status saat ini
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: T.gray500, marginTop: 2 }}>{opt.desc}</div>
                      </div>
                      <div style={{
                        width: 20, height: 20, borderRadius: "50%",
                        border: `2px solid ${isSelected ? opt.color : T.gray300}`,
                        background: isSelected ? opt.color : "transparent",
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Peringatan khusus jika pilih Non-Aktif lewat jalur ini */}
            {editStatusValue === "Non-Aktif" && toko.status !== "Non-Aktif" && (
              <div style={{ background: T.orangeLt, border: `1px solid ${T.orange}55`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
                ⚠️ <b>Catatan:</b> Mengubah status ke <b>Non-Aktif</b> via menu ini <b>tidak akan mengubah stok toko</b>.<br/>
                Jika ingin mencatat pengembalian stok, gunakan tombol <b>🔴 Tarik Toko</b> di view per Rute.
              </div>
            )}

            {/* Pesan info jika status tidak berubah */}
            {!changed && editStatusValue && (
              <div style={{ background: T.blueLt, border: `1px solid #BFDBFE`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: T.blue }}>
                ℹ️ Status toko sudah <b>{editStatusValue}</b>. Tidak ada perubahan yang akan disimpan.
              </div>
            )}

            {/* Tombol aksi */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <Btn variant="secondary" onClick={() => { setEditStatusModal(null); setEditStatusValue(""); setEditStatusCatatan(""); }}>Batal</Btn>
              <Btn
                onClick={konfirmasiEditStatusToko}
                disabled={!editStatusValue || !changed}
                style={{ opacity: (!editStatusValue || !changed) ? 0.5 : 1, cursor: (!editStatusValue || !changed) ? "not-allowed" : "pointer" }}
              >
                {selectedOpt ? `${selectedOpt.icon} Simpan — Ubah ke ${selectedOpt.label}` : "Simpan Perubahan"}
              </Btn>
            </div>
          </Modal>
        );
      })()}

      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:700, color:T.gray800 }}>📋 Kontrol Bulanan</div>
        <div style={{ fontSize:12, color:T.gray400, marginBottom:12 }}>
          {data.length} entri
          {luarRuteData.length>0 && <span> · 🛣️ +{luarRuteData.length} luar rute</span>}
          {" "}· Rev: <b style={{ color:T.green }}>{fmtRp(totalRevData)}</b>
          {" "}· Bonus: <b style={{ color:T.gold }}>{fmt(totalBonusData)} pcs</b>
        </div>

        {/* ✅ Kartu Diagnostik Cakupan Kontrol — khusus Admin/Manajer, supaya
            bisa memantau toko yang belum pernah dikontrol & sinyal dini
            "kemungkinan histori tahun lama belum dimuat" tanpa perlu unduh
            backup manual tiap kali mau cek. */}
        {isManajer && cakupanDiagnostik.totalRelevan > 0 && (
          <div style={{ background:cakupanDiagnostik.belumPernah.length>0?T.orangeLt:T.greenLt,
            border:`1px solid ${cakupanDiagnostik.belumPernah.length>0?T.orange:T.green}44`,
            borderRadius:10, marginBottom:8, overflow:"hidden" }}>
            <div onClick={()=>setDiagnostikOpen(o=>!o)}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 14px", cursor:"pointer", gap:10, flexWrap:"wrap" }}>
              <div style={{ fontSize:12.5, fontWeight:700,
                color:cakupanDiagnostik.belumPernah.length>0?T.orange:T.green }}>
                🩺 Diagnostik Cakupan Kontrol
                {" — "}
                {cakupanDiagnostik.belumPernah.length===0
                  ? "semua toko aktif sudah pernah dikontrol ✅"
                  : `${fmt(cakupanDiagnostik.belumPernah.length)} dari ${fmt(cakupanDiagnostik.totalRelevan)} toko aktif belum pernah dikontrol`}
              </div>
              <span style={{ fontSize:11, color:T.gray500 }}>{diagnostikOpen?"▲ Tutup":"▼ Detail"}</span>
            </div>
            {diagnostikOpen && (
              <div style={{ padding:"0 14px 14px", fontSize:12.5, color:T.gray700 }}>
                {cakupanDiagnostik.belumPernah.length===0 ? (
                  <div>Semua toko berstatus Aktif/Baru sudah punya minimal satu entri Kontrol Bulanan pada data yang termuat saat ini. 🎉</div>
                ) : (
                  <>
                    <div style={{ marginBottom:8 }}>
                      Toko ini status Aktif/Baru tapi <b>tidak ada satu pun entri Kontrol Bulanan</b> untuknya
                      di data yang sedang termuat di perangkat ini — kemungkinan belum pernah dikunjungi sales,
                      atau (kalau ada tahun lama yang belum dimuat, lihat catatan di bawah) histori lamanya
                      belum ikut terunduh.
                    </div>
                    {cakupanDiagnostik.berstokTanpaKontrol.length > 0 && (
                      <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:8,
                        padding:"8px 12px", marginBottom:10, color:"#DC2626" }}>
                        ⚠️ <b>{fmt(cakupanDiagnostik.berstokTanpaKontrol.length)} toko</b> di antaranya sudah
                        punya <b>Stok tersimpan {'>'}0</b> di Master Toko meski tidak ada entri kontrol termuat —
                        patut dicek manual, karena baseline stoknya bisa salah kalau "Hitung Ulang Semua Stok"
                        dijalankan sebelum histori lamanya (kalau ada) dimuat.
                      </div>
                    )}
                    {cakupanDiagnostik.tahunBelumDimuat.length > 0 ? (
                      <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:8,
                        padding:"8px 12px", marginBottom:10, color:"#92400E" }}>
                        📅 Ada data kontrol tahun <b>{cakupanDiagnostik.tahunBelumDimuat.join(", ")}</b> di cloud
                        yang belum dimuat ke perangkat ini. Muat dulu lewat menu <b>Cadangan/Admin → Muat Data
                        Tahun Lama</b> sebelum menyimpulkan toko-toko di atas benar-benar "belum pernah dikontrol".
                      </div>
                    ) : (
                      <div style={{ fontSize:11.5, color:T.gray500, marginBottom:10 }}>
                        Tidak ada tahun kontrol lama yang tertunda dimuat — jadi daftar di atas mencerminkan
                        histori penuh yang tersedia di cloud.
                      </div>
                    )}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, gap:8, flexWrap:"wrap" }}>
                        <div style={{ fontWeight:700 }}>
                          {diagnostikGroupBy==="wilayah" ? "Per Wilayah:" : "Per Rute:"}
                        </div>
                        <div style={{ display:"flex", gap:4, background:T.gray100, borderRadius:99, padding:2 }}>
                          <button onClick={()=>setDiagnostikGroupBy("wilayah")}
                            style={{ border:"none", cursor:"pointer", fontSize:11, fontWeight:700, borderRadius:99,
                              padding:"4px 10px", background:diagnostikGroupBy==="wilayah"?T.white:"transparent",
                              color:diagnostikGroupBy==="wilayah"?T.gray800:T.gray500,
                              boxShadow:diagnostikGroupBy==="wilayah"?"0 1px 2px rgba(0,0,0,.12)":"none" }}>Wilayah</button>
                          <button onClick={()=>setDiagnostikGroupBy("rute")}
                            style={{ border:"none", cursor:"pointer", fontSize:11, fontWeight:700, borderRadius:99,
                              padding:"4px 10px", background:diagnostikGroupBy==="rute"?T.white:"transparent",
                              color:diagnostikGroupBy==="rute"?T.gray800:T.gray500,
                              boxShadow:diagnostikGroupBy==="rute"?"0 1px 2px rgba(0,0,0,.12)":"none" }}>Rute</button>
                        </div>
                      </div>
                      {diagnostikGroupBy==="wilayah" ? (
                        cakupanDiagnostik.perWilayahSorted.map(([nama,cnt]) => (
                          <div key={nama} style={{ display:"flex", justifyContent:"space-between",
                            padding:"3px 0", borderBottom:`1px solid ${T.gray100}` }}>
                            <span>{nama}</span><b>{fmt(cnt)}</b>
                          </div>
                        ))
                      ) : (
                        <div style={{ maxHeight:260, overflowY:"auto" }}>
                          {cakupanDiagnostik.perRuteSorted.map(({rute,wilayah,cnt}) => (
                            <div key={`${wilayah}-${rute}`} style={{ display:"flex", justifyContent:"space-between",
                              padding:"3px 0", borderBottom:`1px solid ${T.gray100}` }}>
                              <span>{rute} <span style={{ color:T.gray400, fontSize:11 }}>({wilayah})</span></span>
                              <b>{fmt(cnt)}</b>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* ✅ Mode: "Belum Pernah Sama Sekali" vs "Tidak Dikontrol dalam Rentang Waktu" */}
                    <div style={{ marginBottom:8 }}>
                      <div style={{ display:"flex", gap:4, background:T.gray100, borderRadius:99, padding:2, width:"fit-content" }}>
                        <button onClick={()=>setDiagnostikMode("never")}
                          style={{ border:"none", cursor:"pointer", fontSize:11, fontWeight:700, borderRadius:99,
                            padding:"5px 12px", background:diagnostikMode==="never"?T.white:"transparent",
                            color:diagnostikMode==="never"?T.gray800:T.gray500,
                            boxShadow:diagnostikMode==="never"?"0 1px 2px rgba(0,0,0,.12)":"none" }}>Belum Pernah Sama Sekali</button>
                        <button onClick={()=>setDiagnostikMode("rentang")}
                          style={{ border:"none", cursor:"pointer", fontSize:11, fontWeight:700, borderRadius:99,
                            padding:"5px 12px", background:diagnostikMode==="rentang"?T.white:"transparent",
                            color:diagnostikMode==="rentang"?T.gray800:T.gray500,
                            boxShadow:diagnostikMode==="rentang"?"0 1px 2px rgba(0,0,0,.12)":"none" }}>Tidak Dikontrol dalam Rentang Waktu</button>
                      </div>
                      {diagnostikMode==="rentang" && (
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, flexWrap:"wrap" }}>
                          <span style={{ fontSize:12, color:T.gray600 }}>Tidak dikontrol lebih dari</span>
                          <input type="number" min={1} value={diagnostikRentangHari}
                            onChange={e=>setDiagnostikRentangHari(e.target.value)}
                            style={{ width:70, padding:"5px 8px", border:`1.5px solid ${T.gray200}`,
                              borderRadius:7, fontSize:12.5, fontFamily:"inherit", boxSizing:"border-box" }} />
                          <span style={{ fontSize:12, color:T.gray600 }}>hari terakhir</span>
                          <div style={{ display:"flex", gap:4 }}>
                            {[30,60,90].map(h => (
                              <button key={h} onClick={()=>setDiagnostikRentangHari(h)}
                                style={{ border:`1px solid ${T.gray200}`, cursor:"pointer", fontSize:10.5, fontWeight:700,
                                  borderRadius:99, padding:"3px 9px",
                                  background:Number(diagnostikRentangHari)===h?T.orange:T.white,
                                  color:Number(diagnostikRentangHari)===h?"#fff":T.gray500 }}>
                                {h===30?"1 bulan":h===60?"2 bulan":"3 bulan"}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* ✅ Filter Wilayah/Rute + pencarian, khusus untuk daftar & ekspor di bawah —
                        supaya bisa saring daftar per wilayah/rute lalu ekspor terpisah per sales. */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                      <Input label="Filter Wilayah" value={diagnostikFilterWilayahId}
                        onChange={v=>{ setDiagnostikFilterWilayahId(v); setDiagnostikFilterRuteId(""); }}
                        options={[{value:"",label:"Semua Wilayah"}, ...wilayahOpts]} />
                      <Input label="Filter Rute" value={diagnostikFilterRuteId}
                        onChange={setDiagnostikFilterRuteId}
                        options={[{value:"",label:"Semua Rute"}, ...diagnostikRuteOpts]} />
                    </div>
                    <input placeholder="🔍 Cari nama/kode toko..." value={diagnostikSearchQ}
                      onChange={e=>setDiagnostikSearchQ(e.target.value)}
                      style={{ width:"100%", padding:"7px 10px", border:`1.5px solid ${T.gray200}`,
                        borderRadius:8, fontSize:12.5, fontFamily:"inherit", boxSizing:"border-box", marginBottom:10 }} />
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                      <Btn size="sm" variant="secondary" onClick={()=>setDiagnostikShowList(v=>!v)}>
                        {diagnostikShowList ? "Sembunyikan Daftar Toko" : "📋 Lihat Daftar Toko"}
                      </Btn>
                      <Btn size="sm" variant="secondary" icon="📥" disabled={diagnostikFiltered.length===0} onClick={()=>{
                        const rows = diagnostikFiltered.map(t => {
                          const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
                          const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
                          return { kode:t.kode||"", nama:t.nama||"", wilayah:wilayah?.nama||"-", rute:rute?.nama||"-",
                            status:t.status, punyaStok: produkAktif.some(p=>Number(t[`stok_${p.id}`]||0)>0) ? "Ya" : "Tidak" };
                        });
                        const namaWilayahTerpilih = wilayahOpts.find(w=>w.value===diagnostikFilterWilayahId)?.label;
                        const namaRuteTerpilih = diagnostikRuteOpts.find(r=>r.value===diagnostikFilterRuteId)?.label;
                        const suffix = namaRuteTerpilih ? `_${namaRuteTerpilih}` : namaWilayahTerpilih ? `_${namaWilayahTerpilih}` : "";
                        exportExcel(rows,
                          [{key:"kode",label:"Kode"},{key:"nama",label:"Nama Toko"},{key:"wilayah",label:"Wilayah"},
                           {key:"rute",label:"Rute"},{key:"status",label:"Status"},{key:"punyaStok",label:"Sudah Ada Stok?"}],
                          "Toko Belum Pernah Dikontrol", `toko_belum_dikontrol${suffix}`);
                      }}>Ekspor Excel {diagnostikFiltered.length !== diagnostikBaseList.length ? `(${fmt(diagnostikFiltered.length)})` : ""}</Btn>
                      <span style={{ fontSize:11, color:T.gray400 }}>
                        Menampilkan {fmt(diagnostikFiltered.length)} dari {fmt(diagnostikBaseList.length)} toko
                        {diagnostikMode==="rentang" ? ` (tidak dikontrol >${diagnostikRentangHari} hari)` : ""}
                      </span>
                    </div>
                    {diagnostikShowList && (
                      <div style={{ marginTop:10, maxHeight:320, overflowY:"auto", border:`1px solid ${T.gray200}`, borderRadius:8 }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
                          <thead>
                            <tr style={{ background:T.gray50, position:"sticky", top:0 }}>
                              <th style={{ padding:"6px 8px", textAlign:"left" }}>Toko</th>
                              <th style={{ padding:"6px 8px", textAlign:"left" }}>Wilayah / Rute</th>
                              <th style={{ padding:"6px 8px", textAlign:"center" }}>Stok?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagnostikFiltered.map(t => {
                              const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
                              const wilayah = rute ? (db.wilayah||[]).find(w=>w.id===rute.wilayahId) : null;
                              const punyaStok = produkAktif.some(p=>Number(t[`stok_${p.id}`]||0)>0);
                              return (
                                <tr key={t.id} style={{ borderTop:`1px solid ${T.gray100}` }}>
                                  <td style={{ padding:"5px 8px" }}>{t.nama}</td>
                                  <td style={{ padding:"5px 8px", color:T.gray500 }}>{wilayah?.nama||"-"} / {rute?.nama||"-"}</td>
                                  <td style={{ padding:"5px 8px", textAlign:"center" }}>{punyaStok ? "⚠️" : "—"}</td>
                                </tr>
                              );
                            })}
                            {diagnostikFiltered.length===0 && (
                              <tr><td colSpan={3} style={{ padding:"12px 8px", textAlign:"center", color:T.gray400 }}>Tidak ada toko yang cocok dengan filter.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Toolbar aksi — ✅ Dirapikan: sebelumnya tombol-tombol ini cuma
            flex-wrap bebas (lebar tiap tombol beda-beda mengikuti isi teks),
            jadi barisnya patah tidak rata. Sekarang dibungkus 1 kartu putih
            bertepi seperti kartu "Mode Tabs" di tab Rekap, dengan CSS grid
            (auto-fit, lebar kolom seragam) supaya rapi & konsisten di layar
            HP — satu kartu besar, bukan tombol lepas berserakan. */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",
          gap:8, background:T.white, border:`1px solid ${T.gray200}`, borderRadius:12,
          padding:10, boxShadow:"0 1px 4px rgba(0,0,0,.05)", marginBottom:8 }}>
          <ImportMenu label="Import Kontrol" onTemplate={()=>downloadKontrolTemplate(db)} onParseRows={importKontrolFromRows} />
          <Btn variant="secondary" icon="🔄" onClick={recalcAllTokoStok}
            style={{ width:"100%", justifyContent:"center" }}
            title="Hitung ulang stok Master Toko untuk semua toko yang pernah dikontrol, pakai data kontrol & penyesuaian yang sudah ada">
            Hitung Ulang Semua Stok
          </Btn>
          {(() => {
            // ── Kolom ekspor kontrol (tanpa React render, gunakan nilai plain) ──
            const kontrolExportCols = [
              { key:"id",           label:"ID" },
              { key:"tokoNama",     label:"Toko" },
              { key:"wilayahNama",  label:"Wilayah" },
              { key:"ruteNama",     label:"Rute" },
              { key:"tanggal",      label:"Tanggal" },
              ...produkAktif.flatMap(p=>[
                { key:`stok_${p.id}`,       label:`Stok ${p.nama||p.id}` },
                { key:`terjual_${p.id}`,    label:`Jual ${p.nama||p.id}` },
                { key:`bonusInput_${p.id}`, label:`Bonus ${p.nama||p.id} (pcs)` },
              ]),
              { key:"totalRevFmt",  label:"Revenue (Rp)" },
              { key:"totalBonus",   label:"Total Bonus (pcs)" },
              { key:"statusLabel",  label:"Status" },
              { key:"catatan",      label:"Catatan" },
            ];
            const kontrolExportData = [
              ...data.map(row=>({
                ...row,
                totalRevFmt: fmtRp(row.totalRev||0),
                statusLabel: row.catatanStatus
                  ? (CATATAN_STATUS[row.catatanStatus]?.label || row.catatanStatus)
                  : "Terjual",
              })),
              // ✅ Baris Penjualan Luar Rute yang cocok filter — sebelumnya
              // export ini cuma berisi entri Kontrol Bulanan, jadi kontribusi
              // luar rute (revenue & pcs) tidak pernah muncul di sini sama
              // sekali, hanya di Rekap.
              ...luarRuteData.map(pl => ({
                ...pl,
                id: pl.id,
                tokoNama: `🛣️ Penjualan Luar Rute${pl.ruteNama ? " — "+pl.ruteNama : ""}`,
                wilayahNama: pl.wilayahNama || "-",
                ruteNama: pl.ruteNama || "-",
                totalRevFmt: fmtRp(pl.totalRev||0),
                statusLabel: "Luar Rute",
                catatan: pl.keterangan || "",
              })),
              // Baris kosong pemisah
              { id:"", tokoNama:"", wilayahNama:"", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
              // Baris total
              { id:"TOTAL", tokoNama:"═══ TOTAL KESELURUHAN ═══",
                wilayahNama:"", ruteNama:"", tanggal:"",
                totalRevFmt: fmtRp(totalRevData),
                totalBonus: totalBonusData,
                statusLabel:`${data.length} entri${luarRuteData.length ? ` + ${luarRuteData.length} luar rute` : ""}`, catatan:"" },
              // Baris kosong
              { id:"", tokoNama:"", wilayahNama:"", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
              // Ringkasan
              { id:"", tokoNama:"📊 RINGKASAN",        wilayahNama:"",                          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Entri Kontrol",  wilayahNama:String(data.length),          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Entri Luar Rute", wilayahNama:String(luarRuteData.length), ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Revenue",         wilayahNama:fmtRp(totalRevData),          ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Total Bonus (pcs)",     wilayahNama:String(totalBonusData),       ruteNama:"", tanggal:"", totalRevFmt:"",                              totalBonus:"", statusLabel:"", catatan:"" },
              { id:"", tokoNama:"Revenue Rata-rata",     wilayahNama:data.length ? fmtRp(Math.round(totalRevData/data.length)) : "Rp 0", ruteNama:"", tanggal:"", totalRevFmt:"", totalBonus:"", statusLabel:"", catatan:"" },
            ];
            return (
              <ExportMenu
                data={data} columns={cols}
                exportData={kontrolExportData} exportCols={kontrolExportCols}
                title="Kontrol Bulanan" filename={`kontrol_${filter.bulan||"semua"}`}
              />
            );
          })()}
          <Btn variant="secondary" size="sm" icon="📅"
            style={{ width:"100%", justifyContent:"center" }}
            onClick={()=>setViewMode(v=>v==="table"?"monthly":"table")}>
            {viewMode==="table"?"🗺️ View per Rute":"📋 View Tabel"}
          </Btn>
          <Btn variant="secondary" style={{ width:"100%", justifyContent:"center" }} onClick={()=>{
            // Pre-fill rute dari filter aktif jika ada
            setTambahTokoForm({ nama:"", ruteId:filter.ruteId||"", status:"Aktif", catatan:"", produkIds:[] });
            setTambahTokoModal(true);
          }} icon="🏪">Tambah Toko</Btn>
          <Btn variant="secondary" style={{ width:"100%", justifyContent:"center" }} onClick={()=>openPenyesuaian("")} icon="🔧">Penyesuaian Stok</Btn>
          <Btn variant="secondary" style={{ width:"100%", justifyContent:"center" }} onClick={openLuarRute} icon="🛣️">Penjualan Luar Rute</Btn>
        </div>

        {/* ✅ "Tambah Kontrol" tetap jadi tombol utama (hijau, aksi paling
            sering dipakai) — dipisah di bawah grid supaya menonjol, full
            lebar layar, senada dengan gaya tombol utama di tab lain. */}
        <Btn onClick={openAdd} icon="＋" style={{ width:"100%", justifyContent:"center", padding:"12px 20px", fontSize:14 }}>Tambah Kontrol</Btn>
      </div>

      {/* Modal Tambah Toko Cepat */}
      {tambahTokoModal && (() => {
        const ruteOptsForToko = [...(db.rute||[])]
          .filter(r => !isSalesRestricted || r.wilayahId===salesWilayahId) // Sales cuma boleh pilih rute wilayahnya sendiri
          .sort((a,b) => {
          const wA = (db.wilayah||[]).find(w=>w.id===a.wilayahId)?.nama||"";
          const wB = (db.wilayah||[]).find(w=>w.id===b.wilayahId)?.nama||"";
          const wCompare = wA.localeCompare(wB, "id", { sensitivity:"base" });
          if (wCompare !== 0) return wCompare;
          return naturalCompare(a.nama||"", b.nama||"");
        }).map(r => {
          const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
          return { value:r.id, label:`${r.nama} (${w?.nama||"?"})` };
        });
        return (
          <Modal title="🏪 Tambah Toko Baru" onClose={()=>setTambahTokoModal(false)} width={480}>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:16, background:T.blueLt,
              border:`1px solid #BFDBFE`, borderRadius:8, padding:"8px 12px" }}>
              💡 Toko baru langsung bisa dipilih di input Kontrol tanpa menutup halaman ini.
              Jika status <b>Baru</b>, sistem otomatis mencatat tanggal masuk dan akan upgrade ke <b>Aktif</b> setelah 30 hari.
            </div>
            <Input label="Nama Toko" value={tambahTokoForm.nama}
              onChange={v=>ttf("nama",v)} required placeholder="cth: Toko Barokah" />
            <SearchableSelect label="Rute" value={tambahTokoForm.ruteId}
              onChange={v=>ttf("ruteId",v)} options={ruteOptsForToko} required
              placeholder="Cari rute / wilayah..." />
            <Input label="Status Awal" value={tambahTokoForm.status}
              onChange={v=>ttf("status",v)}
              options={[{value:"Aktif",label:"Aktif"},{value:"Baru",label:"Baru (trial)"},{value:"Non-Aktif",label:"Non-Aktif"}]} />
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:8 }}>
                Produk yang Dititipkan (opsional — bisa diisi belakangan lewat Penyesuaian Stok):
              </div>
              {produkAktif.map(p => {
                const checked = (tambahTokoForm.produkIds||[]).includes(p.id);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
                    border:`1.5px solid ${checked?T.green:T.gray200}`, borderRadius:8, marginBottom:6,
                    background:checked?T.greenLt:T.white }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", flex:1 }}>
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          const ids = tambahTokoForm.produkIds||[];
                          ttf("produkIds", e.target.checked ? [...ids,p.id] : ids.filter(x=>x!==p.id));
                          if (!e.target.checked) ttf(`stok_${p.id}`, 0);
                        }}
                        style={{ accentColor:T.green }} />
                      <span style={{ fontSize:13, fontWeight:600 }}>{p.nama}</span>
                      <span style={{ fontSize:11, color:T.gray400 }}>{fmtRp(p.harga)}</span>
                    </label>
                    {checked && (
                      <input type="number" min="0" placeholder="Stok awal"
                        value={tambahTokoForm[`stok_${p.id}`]||""}
                        onChange={e=>ttf(`stok_${p.id}`, e.target.value)}
                        style={{ width:90, padding:"6px 8px", border:`1.5px solid ${T.gray200}`, borderRadius:6, fontSize:13, fontFamily:"inherit" }} />
                    )}
                  </div>
                );
              })}
            </div>
            <Input label="Catatan" value={tambahTokoForm.catatan||""} onChange={v=>ttf("catatan",v)}
              type="textarea" placeholder="Opsional" />
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
              <Btn variant="secondary" onClick={()=>setTambahTokoModal(false)}>Batal</Btn>
              <Btn onClick={submitTambahToko}>✅ Simpan Toko</Btn>
            </div>
          </Modal>
        );
      })()}

      {/* Modal Penyesuaian Stok (kejadian lapangan di luar siklus kontrol rutin) */}
      {penyesuaianModal && penyesuaianForm && (
        <Modal title="🔧 Penyesuaian Stok Lapangan" onClose={()=>{ setPenyesuaianModal(false); setPenyesuaianForm(null); }} width={560}>
          <div style={{ fontSize:12, color:T.gray600, marginBottom:14, background:T.blueLt,
            border:`1px solid #BFDBFE`, borderRadius:8, padding:"8px 12px" }}>
            💡 Gunakan untuk mencatat kejadian di toko <b>di luar kunjungan kontrol rutin</b> — misal laporan sales
            ada tambahan stok, stok berkurang (rusak/hilang), atau sebagian produk ditarik. Stok di Master Toko
            akan otomatis diperbarui.
          </div>
          <SearchableSelect label="Toko" value={penyesuaianForm.tokoId}
            onChange={v=>pf("tokoId",v)} options={allTokoOpts} required placeholder="Cari toko..." />
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Tanggal" value={penyesuaianForm.tanggal} onChange={v=>pf("tanggal",v)} type="date" required />
            <Input label="Jenis Penyesuaian" value={penyesuaianForm.jenis} onChange={v=>pf("jenis",v)}
              options={[{value:"Tambah",label:"➕ Tambah Stok"},{value:"Kurang",label:"➖ Kurang Stok"},{value:"Tarik",label:"🔻 Tarik Sebagian Produk"}]} />
          </div>
          <div style={{ marginTop:10, marginBottom:6, fontSize:12, fontWeight:600, color:T.gray600 }}>Jumlah per Produk:</div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            {(() => {
              const tokoTerpilih = (db.toko||[]).find(t=>t.id===penyesuaianForm.tokoId);
              const produkIdsToko = tokoTerpilih?.produkIds||[];
              return produkAktif.map(p=>{
                const belumDijual = penyesuaianForm.tokoId && !produkIdsToko.includes(p.id);
                return (
                  <Input key={p.id}
                    label={<>{p.nama}{belumDijual && penyesuaianForm.jenis==="Tambah" && (
                      <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:T.blue,
                        background:T.blueLt, border:`1px solid #BFDBFE`, borderRadius:99, padding:"1px 6px" }}>
                        🆕 produk baru untuk toko ini
                      </span>
                    )}</>}
                    value={penyesuaianForm[`jumlah_${p.id}`]||0}
                    onChange={v=>pf(`jumlah_${p.id}`,v)} type="number" />
                );
              });
            })()}
          </div>
          {(() => {
            const tokoTerpilih = (db.toko||[]).find(t=>t.id===penyesuaianForm.tokoId);
            const produkIdsToko = tokoTerpilih?.produkIds||[];
            const adaProdukBaru = penyesuaianForm.jenis==="Tambah" && produkAktif.some(p =>
              Number(penyesuaianForm[`jumlah_${p.id}`]||0) > 0 && penyesuaianForm.tokoId && !produkIdsToko.includes(p.id));
            return adaProdukBaru ? (
              <div style={{ fontSize:11, color:T.blue, background:T.blueLt, border:`1px solid #BFDBFE`,
                borderRadius:8, padding:"6px 10px", marginBottom:10 }}>
                ℹ️ Produk bertanda 🆕 akan otomatis ditambahkan ke daftar "Produk yang Dijual" toko ini saat disimpan.
              </div>
            ) : null;
          })()}
          <Input label="Dicatat Oleh (admin/sales)" value={penyesuaianForm.dicatatOleh||""} onChange={v=>pf("dicatatOleh",v)} placeholder="Nama pencatat" />
          <Input label="Catatan / Alasan" value={penyesuaianForm.catatan||""} onChange={v=>pf("catatan",v)}
            type="textarea" placeholder="cth: Laporan sales — 2 botol rusak saat kunjungan" />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>{ setPenyesuaianModal(false); setPenyesuaianForm(null); }}>Batal</Btn>
            <Btn onClick={submitPenyesuaian}>✅ Simpan Penyesuaian</Btn>
          </div>
        </Modal>
      )}

      {/* Modal Penjualan Luar Rute (toko/rute tidak diketahui sales) */}
      {luarRuteModal && luarRuteForm && (
        <Modal title="🛣️ Penjualan Luar Rute" onClose={()=>{ setLuarRuteModal(false); setLuarRuteForm(null); }} width={560}>
          <div style={{ fontSize:12, color:T.gray600, marginBottom:14, background:T.goldLt||"#FEF9E7",
            border:`1px solid ${T.gold}55`, borderRadius:8, padding:"8px 12px" }}>
            💡 Gunakan ini jika sales <b>menjual produk di luar rute kontrol saat itu</b> (rute lain pada waktu yang sama,
            atau penjualan perorangan) dan <b>tidak tahu/lupa nama toko & rutenya</b>. Penjualan tetap tercatat &
            masuk laporan pendapatan, tanpa terikat ke toko manapun — namun tetap <b>dikaitkan ke wilayah</b>
            supaya ikut terhitung di Rekap Siklus wilayah tsb saat siklus kontrolnya selesai.
            Jika sales <b>tahu nama toko & rutenya</b>, gunakan tombol <b>＋ Tambah Kontrol</b> seperti biasa.
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Wilayah" value={luarRuteForm.wilayahId||""}
              onChange={v=>setLuarRuteForm(p=>({ ...p, wilayahId:v, ruteId:"" }))}
              options={wilayahOpts} required placeholder="Pilih wilayah..." disabled={isSalesRestricted}
              hint={isSalesRestricted ? "Terkunci ke wilayah tugasmu" : "Wilayah tugas sales — penjualan ini akan ikut masuk ke Rekap Siklus wilayah ini"} />
            <Input label="Tanggal" value={luarRuteForm.tanggal} onChange={v=>lf("tanggal",v)} type="date" required />
          </div>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Rute (opsional)" value={luarRuteForm.ruteId||""} onChange={v=>lf("ruteId",v)}
              options={luarRuteRuteOpts} placeholder="Pilih rute jika diketahui..."
              hint="Isi jika tahu rute sumbernya, supaya penjualan ini ikut masuk ke Revenue per Rute (bukan cuma per Wilayah)" />
            <Input label="Dicatat Oleh (sales)" value={luarRuteForm.dicatatOleh||""} onChange={v=>lf("dicatatOleh",v)} placeholder="Nama sales" />
          </div>
          <Input label="Keterangan (opsional)" value={luarRuteForm.keterangan||""} onChange={v=>lf("keterangan",v)}
            type="textarea" placeholder="cth: dijual di rute 2 saat kontrol rute 1 / penjualan perorangan ke kenalan" />
          <div style={{ marginTop:10, marginBottom:6, fontSize:12, fontWeight:600, color:T.gray600 }}>Jumlah Terjual & Bonus per Produk:</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10, marginBottom:10 }}>
            {produkAktif.map(p => {
              const terjual = Number(luarRuteForm[`terjual_${p.id}`]||0);
              return (
                <div key={p.id} style={{ background:terjual>0?T.greenLt:T.gray50, borderRadius:10,
                  padding:"12px", border:`1.5px solid ${terjual>0?T.green+"44":T.gray200}`, transition:"all .2s" }}>
                  <div style={{ fontSize:12, fontWeight:800, color:T.gray800, marginBottom:10 }}>{p.nama}</div>
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Terjual</div>
                    <input type="number" value={luarRuteForm[`terjual_${p.id}`]||0}
                      onChange={e=>lf(`terjual_${p.id}`,e.target.value)} min={0}
                      style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${terjual>0?T.green:T.gray200}`,
                        borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:T.gold, marginBottom:3 }}>🎁 Bonus Produk (pcs)</div>
                    <input type="number" value={luarRuteForm[`bonusInput_${p.id}`]||0}
                      onChange={e=>lf(`bonusInput_${p.id}`,e.target.value)} min={0}
                      style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`,
                        borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  </div>
                </div>
              );
            })}
          </div>
          {(() => {
            let estRev = 0;
            produkAktif.forEach(p => { estRev += Number(luarRuteForm[`terjual_${p.id}`]||0) * (p.harga||0); });
            return estRev > 0 ? (
              <div style={{ fontSize:12, color:T.green, background:T.greenLt, border:`1px solid ${T.green}33`,
                borderRadius:8, padding:"8px 12px", marginBottom:10 }}>
                💰 Estimasi pendapatan: <b>{fmtRp(estRev)}</b>
              </div>
            ) : null;
          })()}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>{ setLuarRuteModal(false); setLuarRuteForm(null); }}>Batal</Btn>
            <Btn onClick={submitLuarRute}>✅ Simpan Penjualan</Btn>
          </div>
        </Modal>
      )}

      {/* Filter: Wilayah → Rute → Bulan */}
      {isSalesRestricted && (
        <div style={{ background:T.greenLt, border:`1px solid ${T.greenMid}44`, borderRadius:8,
          padding:"8px 14px", marginBottom:12, fontSize:12, color:T.green, display:"flex", alignItems:"center", gap:8 }}>
          🔒 Anda hanya dapat melihat data wilayah: <b>{(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}</b>
        </div>
      )}
      <FilterBar filters={[
        { key:"q",         label:"Cari Toko",value:filter.q,         placeholder:"Nama atau kode toko..." },
        { key:"bulan",     label:"Bulan",    value:filter.bulan,     type:"month", placeholder:"2026-06" },
        ...(!isSalesRestricted ? [{ key:"wilayahId", label:"Wilayah",  value:filter.wilayahId, options:wilayahOpts }] : []),
        { key:"ruteId",    label:"Rute",     value:filter.ruteId,    options:ruteOpts },
        { key:"catatanStatus", label:"Status Kunjungan", value:filter.catatanStatus,
          options:[
            { value:"manual",  label:"✅ Isi Manual (normal)" },
            { value:"tutup",   label:"🔵 Toko Tutup" },
            { value:"terjual", label:"🟡 Tidak Terjual" },
            { value:"masalah", label:"🔴 Bermasalah" },
          ] },
      ]} onChange={(k,v)=>{
        if (k==="wilayahId") setFilter(p=>({...p, wilayahId:v, ruteId:""}));
        else setFilter(p=>({...p,[k]:v}));
      }} onReset={()=>setFilter({wilayahId: salesWilayahId||"", ruteId:"", bulan:"", q:"",
        cekTanggal: new Date().toISOString().slice(0,10), hanyaBelumHariIni:false,
        catatanStatus:"", minJumlah:"", maxJumlah:""})} />

      {/* Filter rentang Jumlah Penjualan (total pcs semua produk per entri)
          — membantu cari entri yang kelihatan janggal, mis. salah ketik
          angka kebesaran/kekecilan saat input kontrol. */}
      <div style={{ display:"flex", gap:10, alignItems:"flex-end", marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ minWidth:130 }}>
          <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Jumlah Terjual Min</div>
          <input type="number" min="0" placeholder="cth: 0" value={filter.minJumlah}
            onChange={e=>setFilter(p=>({...p, minJumlah:e.target.value}))}
            style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", width:110 }} />
        </div>
        <div style={{ minWidth:130 }}>
          <div style={{ fontSize:11, fontWeight:600, color:T.gray600, marginBottom:4 }}>Jumlah Terjual Maks</div>
          <input type="number" min="0" placeholder="cth: 100" value={filter.maxJumlah}
            onChange={e=>setFilter(p=>({...p, maxJumlah:e.target.value}))}
            style={{ padding:"7px 10px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:12, fontFamily:"inherit", width:110 }} />
        </div>
        {(filter.minJumlah!=="" || filter.maxJumlah!=="") && (
          <Btn variant="secondary" size="sm" onClick={()=>setFilter(p=>({...p, minJumlah:"", maxJumlah:""}))}>Reset Jumlah</Btn>
        )}
      </div>

      {/* Summary per Produk — ✅ Dirapikan supaya konsisten dengan gaya kartu
          di tab Rekap Penjualan (StatCard: ikon, label kapital berwarna,
          angka besar), disusun dalam SATU KOLOM PENUH (bukan grid/flex-wrap
          2 kolom seperti sebelumnya) supaya rapi & mudah dibaca di layar HP. */}
      {produkAktif.length > 0 && (data.length > 0 || luarRuteData.length > 0) && (
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
          {produkAktif.map(p => {
            // ✅ Pcs terjual & bonus kini ikut menjumlahkan Penjualan Luar
            // Rute yang cocok filter — sebelumnya cuma dari entri Kontrol
            // Bulanan, jadi angkanya beda dengan yang tampil di Rekap.
            const totalTerjual = data.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0)
              + luarRuteData.reduce((s,k)=>s+(k[`terjual_${p.id}`]||0),0);
            const bonusTotal = data.reduce((s,k)=>s+(k[`bonusInput_${p.id}`]!==undefined ? Number(k[`bonusInput_${p.id}`]) : (p.bonus||0)),0)
              + luarRuteData.reduce((s,k)=>s+Number(k[`bonusInput_${p.id}`]||0),0);
            return (
              <StatCard key={p.id}
                label={p.nama}
                value={`${fmt(totalTerjual)} pcs terjual`}
                sub={`Bonus: ${fmt(bonusTotal)} pcs`}
                icon="🧴" color={T.gold} />
            );
          })}
        </div>
      )}

      {viewMode==="monthly" ? (
        // View per Rute: tampilkan SEMUA toko di rute, baik yang sudah dikontrol maupun belum
        <div>
          {/* ✅ Filter: cari toko yang belum diinput kontrol pada tanggal tertentu */}
          <div style={{ background:T.orangeLt, border:`1px solid ${T.orange}55`, borderRadius:10,
            padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:13, fontWeight:700, color:T.orange }}>🔎 Cek tanggal:</span>
              <input type="date" value={filter.cekTanggal}
                onChange={e=>setFilter(p=>({...p, cekTanggal:e.target.value}))}
                style={{ border:`1px solid ${T.orange}55`, borderRadius:8, padding:"5px 8px", fontSize:13 }} />
            </div>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:T.gray700, cursor:"pointer" }}>
              <input type="checkbox" checked={!!filter.hanyaBelumHariIni}
                onChange={e=>setFilter(p=>({...p, hanyaBelumHariIni:e.target.checked}))} />
              Hanya tampilkan toko yang <b>belum dikontrol</b> pada tanggal ini
            </label>
          </div>
          {(!filter.wilayahId && !filter.ruteId) && (
            <div style={{ background:T.blueLt, border:`1px solid ${T.blue}33`, borderRadius:10,
              padding:"10px 16px", marginBottom:14, fontSize:13, color:T.blue }}>
              📋 Menampilkan <b>semua toko</b> dari semua rute. Gunakan filter <b>Wilayah</b> atau <b>Rute</b> untuk mempersempit tampilan.
            </div>
          )}
          {tokoPerRute.length === 0 ? (
            <Card><div style={{ textAlign:"center", color:T.gray400, padding:24 }}>
              {filter.hanyaBelumHariIni
                ? "🎉 Semua toko sudah dikontrol pada tanggal ini."
                : "Belum ada toko aktif. Tambahkan toko terlebih dahulu di tab Toko."}
            </div></Card>
          ) : tokoPerRute.map(({ rute, wilayah, tokoList }) => (
            <Card key={rute.id} style={{ marginBottom:16 }}>
              {/* Header Rute */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${T.gray200}` }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:T.gray800 }}>🛣️ {rute.nama}</div>
                  <div style={{ fontSize:12, color:T.gray400 }}>{wilayah?.nama||"—"} · {tokoList.length} toko</div>
                </div>
                <div style={{ display:"flex", gap:10, fontSize:12 }}>
                  <span style={{ color:T.green, fontWeight:700 }}>
                    Rev: {fmtRp(tokoList.reduce((s,{entries})=>s+entries.reduce((ss,e)=>ss+e.totalRev,0),0))}
                  </span>
                  <span style={{ color:T.gold, fontWeight:700 }}>
                    Bonus: {fmt(tokoList.reduce((s,{entries})=>s+entries.reduce((ss,e)=>ss+(e.totalBonus||0),0),0))} pcs
                  </span>
                </div>
              </div>

              {/* Toko-toko dalam rute */}
              {tokoList.map(({ toko, entries, sudahDikontrolHariIni }) => {
                const sudahDikontrol = entries.length > 0;
                const lastEntry = entries[entries.length-1];
                return (
                  <div key={toko.id} style={{ marginBottom:12, border:`1px solid ${sudahDikontrol?T.green+"33":T.gray200}`,
                    borderRadius:10, overflow:"hidden" }}>
                    {/* Header Toko */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"10px 14px", background:sudahDikontrol?T.greenLt:T.gray50, flexWrap:"wrap", gap:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:18 }}>{sudahDikontrol?"✅":"⏳"}</span>
                        <div>
                          <div style={{ fontWeight:700, fontSize:14, color:T.gray800, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            {toko.nama}
                            {toko.status === "Baru" && (
                              <span style={{ background:T.blue, color:"#fff", fontSize:10, fontWeight:700,
                                borderRadius:99, padding:"1px 8px", letterSpacing:"0.03em" }}>🆕 BARU</span>
                            )}
                          </div>
                          <div style={{ fontSize:11, color:T.gray400 }}>{toko.kode}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        {sudahDikontrolHariIni
                          ? <Badge color={T.green} bg={T.greenLt}>✅ Sudah ({filter.cekTanggal})</Badge>
                          : <Badge color={T.red} bg={T.redLt}>⚠️ Belum ({filter.cekTanggal})</Badge>}
                        {sudahDikontrol
                          ? <Badge color={T.green}>{entries.length}x kontrol</Badge>
                          : <Badge color={T.orange} bg={T.orangeLt}>Belum dikontrol</Badge>}
                        <Btn size="sm" icon="＋" onClick={()=>{
                          const today = new Date().toISOString().slice(0,10);
                          const initial = { tokoId:toko.id, tanggal:today, catatanStatus:"", catatan:"" };
                          produkAktif.forEach(p => {
                            initial[`stok_${p.id}`] = toko[`stok_${p.id}`]||0;
                            initial[`terjual_${p.id}`] = 0;
                            initial[`bonusInput_${p.id}`] = p.bonus||0;
                          });
                          setForm(initial);
                          setModalFilter({ wilayahId: wilayah?.id||"", ruteId: rute.id });
                          setModal("add");
                        }}>Tambah</Btn>
                        <Btn size="sm" variant="secondary" icon="🔧" onClick={() => openPenyesuaian(toko.id)}>
                          Penyesuaian
                        </Btn>
                        <Btn size="sm" variant="secondary" icon="🏷️" onClick={() => openEditStatusModal(toko)}>
                          Status
                        </Btn>
                        {toko.status !== "Non-Aktif" && (
                          <Btn size="sm" variant="danger" icon="🔴" onClick={() => openTokoStatusModal(toko)}>
                            Tarik Toko
                          </Btn>
                        )}
                      </div>
                    </div>

                    {/* Data kontrol toko */}
                    {entries.length > 0 && (
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead>
                            <tr style={{ background:T.gray50, borderTop:`1px solid ${T.gray200}` }}>
                              <th style={{ padding:"6px 10px", textAlign:"left", color:T.gray600, fontWeight:700 }}>Tanggal</th>
                              {produkAktif.map(p=>(
                                <th key={p.id} style={{ padding:"6px 10px", textAlign:"center", color:T.gray600, fontWeight:700 }}>
                                  {p.nama}
                                </th>
                              ))}
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Revenue</th>
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Bonus (pcs)</th>
                              <th style={{ padding:"6px 10px", textAlign:"center", color:T.gray600, fontWeight:700 }}>Status</th>
                              <th style={{ padding:"6px 10px", textAlign:"right", color:T.gray600, fontWeight:700 }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(e => {
                              const cs = e.catatanStatus ? (CATATAN_STATUS[e.catatanStatus]||CATATAN_STATUS.manual) : null;
                              return (
                                <tr key={e.id} style={{ background:cs?cs.bg:T.white, borderTop:`1px solid ${T.gray100}` }}>
                                  <td style={{ padding:"6px 10px", fontWeight:600 }}>{e.tanggal}</td>
                                  {produkAktif.map(p=>(
                                    <td key={p.id} style={{ padding:"6px 10px", textAlign:"center" }}>
                                      <div style={{ color:T.gray600 }}>📦 {e[`stok_${p.id}`]||0}</div>
                                      <div style={{ color:T.green, fontWeight:700 }}>✓ {e[`terjual_${p.id}`]||0}</div>
                                    </td>
                                  ))}
                                  <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:T.green }}>{fmtRp(e.totalRev)}</td>
                                  <td style={{ padding:"6px 10px", textAlign:"right", color:T.gold }}>{fmt(e.totalBonus)} pcs</td>
                                  <td style={{ padding:"6px 10px", textAlign:"center" }}>
                                    <div>
                                      {cs
                                        ? <Badge color={cs.color} bg={cs.bg}>{cs.label}</Badge>
                                        : <Badge color={T.green}>✅ Terjual</Badge>}
                                      {e.catatan && (
                                        <div style={{ fontSize:10, color:T.gray400, marginTop:2,
                                          maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                                          title={e.catatan}>
                                          📝 {e.catatan}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ padding:"6px 10px", textAlign:"right" }}>
                                    <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}>
                                      <Btn variant="secondary" size="sm" icon="✏️" onClick={()=>openEdit(e)}>Edit</Btn>
                                      <Btn variant="danger" size="sm" icon="🗑" onClick={()=>setDeleteTarget(e.id)}>Hapus</Btn>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Riwayat Penyesuaian Stok toko ini */}
                    {(() => {
                      const pzList = (db.penyesuaian||[])
                        .filter(pz => pz.tokoId===toko.id && (!filter.bulan || pz.tanggal?.startsWith(filter.bulan)))
                        .sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
                      if (pzList.length===0) return null;
                      return (
                        <div style={{ overflowX:"auto", borderTop:`1px solid ${T.gray200}` }}>
                          <div style={{ padding:"6px 10px", fontSize:11, fontWeight:700, color:T.gray500 }}>🔧 Riwayat Penyesuaian Stok</div>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                            <tbody>
                              {pzList.map(pz => (
                                <tr key={pz.id} style={{ borderTop:`1px solid ${T.gray100}`, background: pz.status==="menunggu" ? "#FFFBEB" : "transparent" }}>
                                  <td style={{ padding:"6px 10px", fontWeight:600, whiteSpace:"nowrap" }}>{pz.tanggal}</td>
                                  <td style={{ padding:"6px 10px" }}>
                                    <Badge color={pz.jenis==="Tambah"?T.green:T.red} bg={pz.jenis==="Tambah"?T.greenLt:T.redLt}>
                                      {pz.jenis==="Tambah"?"➕ Tambah":pz.jenis==="Kurang"?"➖ Kurang":"🔻 Tarik Sebagian"}
                                    </Badge>
                                    {pz.status==="menunggu" && <span style={{marginLeft:4}}><Badge color={T.gold} bg="#FFFBEB">⏳ Menunggu</Badge></span>}
                                    {pz.status==="ditolak" && <span style={{marginLeft:4}}><Badge color={T.red} bg={T.redLt}>❌ Ditolak</Badge></span>}
                                  </td>
                                  <td style={{ padding:"6px 10px" }}>
                                    {produkAktif.filter(p=>Number(pz[`jumlah_${p.id}`]||0)>0)
                                      .map(p=>`${p.nama}: ${pz[`jumlah_${p.id}`]}`).join(" · ")}
                                  </td>
                                  <td style={{ padding:"6px 10px", color:T.gray400, fontSize:11 }}>
                                    {pz.dicatatOleh && <span>👤 {pz.dicatatOleh}</span>}
                                    {pz.catatan && <span style={{ marginLeft:6 }}>📝 {pz.catatan}</span>}
                                  </td>
                                  <td style={{ padding:"6px 10px", textAlign:"right", whiteSpace:"nowrap" }}>
                                    {pz.status==="menunggu" && !isSalesRestricted && (
                                      <>
                                        <Btn variant="primary" size="sm" icon="✅" onClick={()=>{
                                          updateRecord("penyesuaian", pz.id, { status:"disetujui", disetujuiOleh:"Manual" });
                                          setTimeout(()=>recalcTokoStok(toko.id), 300);
                                        }}>Setujui</Btn>
                                        {" "}
                                        <Btn variant="danger" size="sm" icon="❌" onClick={()=>{
                                          if (!confirm("Tolak pengajuan penyesuaian stok ini?")) return;
                                          updateRecord("penyesuaian", pz.id, { status:"ditolak", disetujuiOleh:"Manual" });
                                          // ✅ FIX SINKRONISASI: submitPenyesuaian (jenis "Tambah") langsung
                                          // mendaftarkan produk baru ke ceklis "Produk yang Dijual" toko SEKETIKA
                                          // saat diajukan — SEBELUM disetujui. Kalau ternyata pengajuannya
                                          // DITOLAK, ceklis itu sebelumnya tidak pernah dibatalkan lagi, jadi
                                          // toko permanen tercatat menjual produk yang pengajuannya sendiri
                                          // ditolak. Sekarang: lepas ceklisnya lagi, KECUALI toko punya alasan
                                          // lain untuk produk itu (ada riwayat Kontrol atau pengajuan lain yang
                                          // belum/tidak ditolak yang melibatkan produk yang sama).
                                          const tokoTerdampak = (db.toko||[]).find(t=>t.id===pz.tokoId);
                                          if (tokoTerdampak && pz.jenis === "Tambah") {
                                            const produkDiPengajuanIni = produkAktif.filter(p => Number(pz[`jumlah_${p.id}`]||0) > 0);
                                            const adaAlasanLain = (p) => {
                                              const adaKontrol = (db.kontrol||[]).some(k => k.tokoId===tokoTerdampak.id &&
                                                (Number(k[`stok_${p.id}`]||0)>0 || Number(k[`terjual_${p.id}`]||0)>0));
                                              const adaPenyesuaianLain = (db.penyesuaian||[]).some(pz2 => pz2.id!==pz.id &&
                                                pz2.tokoId===tokoTerdampak.id && pz2.status!=="ditolak" && Number(pz2[`jumlah_${p.id}`]||0)>0);
                                              return adaKontrol || adaPenyesuaianLain;
                                            };
                                            const toRemove = produkDiPengajuanIni.filter(p=>!adaAlasanLain(p)).map(p=>p.id);
                                            if (toRemove.length > 0) {
                                              const existingIds = produkAktif.filter(p=>!!tokoTerdampak[`produk_${p.id}`]).map(p=>p.id);
                                              const finalIds = existingIds.filter(id=>!toRemove.includes(id));
                                              updateRecord("toko", tokoTerdampak.id, { produkIds: finalIds, ...buildProdukFlagUpdates(finalIds) });
                                            }
                                          } else if (tokoTerdampak && pz.jenis === "Tarik") {
                                            // ✅ FIX SINKRONISASI (lanjutan dari fix "Tambah" di atas): submitPenyesuaian
                                            // untuk jenis "Tarik" JUGA langsung menghilangkan ceklis "Produk yang
                                            // Dijual" SEKETIKA saat diajukan — sebelum disetujui. Kalau ternyata
                                            // pengajuannya DITOLAK, ceklis yang sudah terlanjur dihilangkan itu
                                            // sebelumnya TIDAK PERNAH dikembalikan lagi, jadi toko permanen
                                            // kehilangan produk dari daftar jualnya walau penarikannya sendiri
                                            // ditolak. Dikembalikan di sini, KECUALI masih ada pengajuan "Tarik"
                                            // lain (belum ditolak) untuk produk yang sama di toko ini.
                                            const produkDiPengajuanIni = produkAktif.filter(p => Number(pz[`jumlah_${p.id}`]||0) > 0);
                                            const masihAdaAlasanTarikLain = (p) => (db.penyesuaian||[]).some(pz2 => pz2.id!==pz.id &&
                                              pz2.tokoId===tokoTerdampak.id && pz2.jenis==="Tarik" && pz2.status!=="ditolak" && Number(pz2[`jumlah_${p.id}`]||0)>0);
                                            const toRestore = produkDiPengajuanIni.filter(p=>!masihAdaAlasanTarikLain(p)).map(p=>p.id);
                                            if (toRestore.length > 0) {
                                              const existingIds = produkAktif.filter(p=>!!tokoTerdampak[`produk_${p.id}`]).map(p=>p.id);
                                              const finalIds = [...new Set(existingIds.concat(toRestore))];
                                              updateRecord("toko", tokoTerdampak.id, { produkIds: finalIds, ...buildProdukFlagUpdates(finalIds) });
                                            }
                                          }
                                        }}>Tolak</Btn>
                                        {" "}
                                      </>
                                    )}
                                    {/* ✅ FIX SINKRONISASI: sebelumnya tombol Hapus di sini TIDAK dibatasi
                                        sama sekali — Sales (walau cuma bisa lihat toko wilayahnya sendiri)
                                        bisa menghapus SEMBARANG entri, termasuk yang SUDAH DISETUJUI Admin,
                                        tanpa perlu persetujuan apa pun. Padahal menghapus entri yang sudah
                                        disetujui langsung memicu recalcTokoStok() yang bisa memundurkan
                                        angka stok toko secara diam-diam. Alur approval "menunggu → disetujui/
                                        ditolak" cuma menjaga sisi PEMBUATAN, jadi sisi PENGHAPUSAN ini
                                        efektif jadi celah untuk melewati approval sepenuhnya. Dibatasi:
                                        Sales hanya boleh hapus pengajuannya sendiri yang MASIH "menunggu"
                                        (kalau salah input, bisa dibatalkan sendiri sebelum ditinjau) — begitu
                                        sudah "disetujui"/"ditolak", hanya Admin/Manajer yang boleh menghapus. */}
                                    {(!isSalesRestricted || pz.status==="menunggu") && (
                                    <Btn variant="danger" size="sm" icon="🗑" onClick={()=>{
                                      if (!confirm("Hapus penyesuaian stok ini?")) return;
                                      deleteRecord("penyesuaian", pz.id);
                                      const remaining = (db.penyesuaian||[]).filter(x=>x.id!==pz.id);
                                      recalcTokoStok(toko.id, undefined, remaining);
                                      // ✅ FIX SINKRONISASI: sama seperti "Tolak" di atas — kalau penyesuaian
                                      // yang dihapus ini jenis "Tambah" dan sempat mendaftarkan produk baru
                                      // ke ceklis "Produk yang Dijual", hapus juga ceklisnya kalau tidak ada
                                      // alasan lain (riwayat Kontrol / penyesuaian lain yang tidak ditolak).
                                      if (pz.jenis === "Tambah") {
                                        const produkDiPengajuanIni = produkAktif.filter(p => Number(pz[`jumlah_${p.id}`]||0) > 0);
                                        const adaAlasanLain = (p) => {
                                          const adaKontrol = (db.kontrol||[]).some(k => k.tokoId===toko.id &&
                                            (Number(k[`stok_${p.id}`]||0)>0 || Number(k[`terjual_${p.id}`]||0)>0));
                                          const adaPenyesuaianLain = remaining.some(pz2 => pz2.tokoId===toko.id &&
                                            pz2.status!=="ditolak" && Number(pz2[`jumlah_${p.id}`]||0)>0);
                                          return adaKontrol || adaPenyesuaianLain;
                                        };
                                        const toRemove = produkDiPengajuanIni.filter(p=>!adaAlasanLain(p)).map(p=>p.id);
                                        if (toRemove.length > 0) {
                                          const existingIds = produkAktif.filter(p=>!!toko[`produk_${p.id}`]).map(p=>p.id);
                                          const finalIds = existingIds.filter(id=>!toRemove.includes(id));
                                          updateRecord("toko", toko.id, { produkIds: finalIds, ...buildProdukFlagUpdates(finalIds) });
                                        }
                                      } else if (pz.jenis === "Tarik") {
                                        // ✅ FIX SINKRONISASI (sama seperti "Tolak" di atas): kalau penyesuaian
                                        // "Tarik" yang dihapus ini sempat menghilangkan ceklis "Produk yang
                                        // Dijual", kembalikan lagi ceklisnya kalau tidak ada pengajuan "Tarik"
                                        // lain (belum ditolak) untuk produk yang sama.
                                        const produkDiPengajuanIni = produkAktif.filter(p => Number(pz[`jumlah_${p.id}`]||0) > 0);
                                        const masihAdaAlasanTarikLain = (p) => remaining.some(pz2 =>
                                          pz2.tokoId===toko.id && pz2.jenis==="Tarik" && pz2.status!=="ditolak" && Number(pz2[`jumlah_${p.id}`]||0)>0);
                                        const toRestore = produkDiPengajuanIni.filter(p=>!masihAdaAlasanTarikLain(p)).map(p=>p.id);
                                        if (toRestore.length > 0) {
                                          const existingIds = produkAktif.filter(p=>!!toko[`produk_${p.id}`]).map(p=>p.id);
                                          const finalIds = [...new Set(existingIds.concat(toRestore))];
                                          updateRecord("toko", toko.id, { produkIds: finalIds, ...buildProdukFlagUpdates(finalIds) });
                                        }
                                      }
                                    }}>Hapus</Btn>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      ) : (
        <>
          <BulkActionBar
            selectedIds={selectedIds} total={data.length}
            onSelectAll={()=>toggleSelectAll(data, false)}
            onClearAll={()=>setSelectedIds([])}
            onDeleteSelected={deleteSelected} label="catatan kontrol" />
          <Card padding={0}>
            <Table columns={cols} data={data} onEdit={openEdit}
              rowStyle={(row) => {
                if (!row.catatanStatus) return null;
                const st = row.catatanStatus;
                if (CATATAN_STATUS[st]) return CATATAN_STATUS[st].bg;
                return null;
              }}
              onDelete={id=>setDeleteTarget(id)}
              selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
          </Card>
        </>
      )}

      {/* Daftar Penjualan Luar Rute (tidak terikat toko/rute) */}
      {(() => {
        // ✅ Ikut semua filter di toolbar atas, konsisten dengan tabel Kontrol
        // Bulanan di atasnya (sebelumnya cuma ikut filter Bulan, jadi kalau
        // Wilayah/Rute/Cari Toko diisi, daftar ini tetap menampilkan semua
        // data tanpa terpengaruh).
        const luarList = (db.penjualanLuar||[])
          .filter(pl =>
            (!isSalesRestricted || pl.wilayahId===salesWilayahId) &&
            (!filter.bulan || pl.tanggal?.startsWith(filter.bulan)) &&
            (!filter.wilayahId || pl.wilayahId===filter.wilayahId) &&
            // ✅ Kalau ruteId sudah diisi sales, penjualan luar rute ini ikut
            // muncul saat filter Rute tsb dipilih. Kalau ruteId kosong (rute
            // memang tidak diketahui), tetap disembunyikan saat filter Rute
            // spesifik aktif — karena tidak bisa dipastikan cocok/tidak.
            (!filter.ruteId || pl.ruteId===filter.ruteId) &&
            (!filter.q || pl.keterangan?.toLowerCase().includes(filter.q.toLowerCase()) || pl.dicatatOleh?.toLowerCase().includes(filter.q.toLowerCase()))
          )
          .sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
        if (luarList.length===0) return null;
        const totalRevLuar = luarList.reduce((s,pl) => {
          let rev = 0;
          produkAktif.forEach(p => { rev += Number(pl[`terjual_${p.id}`]||0) * (p.harga||0); });
          return s + rev;
        }, 0);
        const totalBonusLuar = luarList.reduce((s,pl) => {
          let bonus = 0;
          produkAktif.forEach(p => { bonus += Number(pl[`bonusInput_${p.id}`]||0); });
          return s + bonus;
        }, 0);
        return (
          <Card padding={0} style={{ marginTop:16 }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.gray200}`,
              display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:T.gray800 }}>🛣️ Penjualan Luar Rute</div>
                <div style={{ fontSize:11, color:T.gray400 }}>
                  Penjualan di luar kunjungan rute normal (toko/rute tidak diketahui sales) · {luarList.length} entri
                  {" "}· Rev: <b style={{ color:T.green }}>{fmtRp(totalRevLuar)}</b>
                  {" "}· Bonus: <b style={{ color:T.gold }}>{fmt(totalBonusLuar)} pcs</b>
                </div>
              </div>
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:T.gray50 }}>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Tanggal</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Wilayah</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Rute</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Produk Terjual</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>🎁 Bonus</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Keterangan</th>
                    <th style={{ padding:"8px 10px", textAlign:"left", fontSize:11, color:T.gray500 }}>Dicatat Oleh</th>
                    <th style={{ padding:"8px 10px", textAlign:"right", fontSize:11, color:T.gray500 }}>Rev</th>
                    <th style={{ padding:"8px 10px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {luarList.map(pl => {
                    let rev = 0;
                    const produkTerjual = produkAktif
                      .filter(p => Number(pl[`terjual_${p.id}`]||0) > 0)
                      .map(p => { rev += Number(pl[`terjual_${p.id}`]||0) * (p.harga||0); return `${p.nama}: ${pl[`terjual_${p.id}`]}`; })
                      .join(" · ");
                    const bonusTerjual = produkAktif
                      .filter(p => Number(pl[`bonusInput_${p.id}`]||0) > 0)
                      .map(p => `${p.nama}: ${pl[`bonusInput_${p.id}`]}`)
                      .join(" · ");
                    const wilayahNama = (db.wilayah||[]).find(w=>w.id===pl.wilayahId)?.nama;
                    const ruteNama = (db.rute||[]).find(r=>r.id===pl.ruteId)?.nama;
                    return (
                      <tr key={pl.id} style={{ borderTop:`1px solid ${T.gray100}` }}>
                        <td style={{ padding:"6px 10px", fontWeight:600, whiteSpace:"nowrap" }}>{pl.tanggal}</td>
                        <td style={{ padding:"6px 10px", fontWeight:600 }}>{wilayahNama || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px" }}>{ruteNama || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px" }}>{produkTerjual || "—"}</td>
                        <td style={{ padding:"6px 10px", color:T.gold }}>{bonusTerjual || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", color:T.gray500, maxWidth:220 }}>{pl.keterangan || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", color:T.gray500 }}>{pl.dicatatOleh || <span style={{ color:T.gray400 }}>—</span>}</td>
                        <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:T.green }}>{fmtRp(rev)}</td>
                        <td style={{ padding:"6px 10px", textAlign:"right" }}>
                          <Btn variant="danger" size="sm" icon="🗑" onClick={()=>deleteLuarRute(pl.id)}>Hapus</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {modal && (
        <Modal title={modal==="add"?"Tambah Kontrol Bulanan":"Edit Kontrol Bulanan"} onClose={()=>setModal(null)} width={600}>
          <div className="gw-grid2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:4, minWidth:0 }}>
            {/* ✅ FIX: untuk Sales, field Wilayah dikunci (tidak bisa diganti) —
                sebelumnya dropdown ini terbuka untuk semua wilayah, jadi Sales
                bisa input kontrol ke wilayah manapun lewat modal ini. */}
            {isSalesRestricted ? (
              <div>
                <div style={{ fontSize:12.5, fontWeight:600, color:T.gray600, marginBottom:5 }}>Wilayah</div>
                <div style={{ padding:"8px 10px", background:T.gray50, border:`1.5px solid ${T.gray200}`, borderRadius:8, fontSize:13, color:T.gray700 }}>
                  🔒 {(db.wilayah||[]).find(w=>w.id===salesWilayahId)?.nama || salesWilayahId}
                </div>
              </div>
            ) : (
              <Input label="Wilayah" value={modalFilter.wilayahId} onChange={handleModalWilayahChange}
                options={wilayahOpts} hint="Pilih wilayah untuk mempersempit pilihan rute & toko" />
            )}
            <Input label="Rute" value={modalFilter.ruteId} onChange={handleModalRuteChange}
              options={modalRuteOpts} hint="Pilih rute untuk mempersempit pilihan toko" />
            <div style={{ gridColumn:"1/-1", minWidth:0 }}>
              <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:12.5, color:T.gray600,
                marginBottom:8, cursor:"pointer", userSelect:"none" }}>
                <input type="checkbox" checked={hanyaBelumKontrol}
                  onChange={e=>setHanyaBelumKontrol(e.target.checked)}
                  style={{ accentColor:T.red, width:15, height:15, cursor:"pointer" }} />
                Tampilkan cuma yang <b>Belum Kontrol</b> (🔴/🟠) di siklus berjalan
              </label>
              <SearchableSelect
                label="Toko"
                value={form.tokoId}
                onChange={handleTokoChange}
                options={hanyaBelumKontrol ? modalTokoOpts.filter(o => o.extraBadge) : modalTokoOpts}
                required
                placeholder="Ketik nama toko untuk mencari..."
                hint={
                  modalTokoOpts.length === 0
                    ? "Tidak ada toko Aktif/Baru untuk filter ini"
                    : hanyaBelumKontrol
                    ? `${modalTokoOpts.filter(o=>o.extraBadge).length} dari ${modalTokoOpts.length} toko belum ada kontrol berhasil di siklus berjalan`
                    : `${modalTokoOpts.length} toko tersedia (Aktif + Baru) · Toko Non-Aktif otomatis disembunyikan · 🆕 = toko baru`
                }
              />
              {/* Panel info status toko yang dipilih */}
              {form.tokoId && (() => {
                const toko = (db.toko||[]).find(t=>t.id===form.tokoId);
                if (!toko) return null;
                const isBaru = toko.status === "Baru";
                return (
                  <div style={{
                    marginTop: -8, marginBottom: 14,
                    background: isBaru ? T.blueLt : T.greenLt,
                    border: `1px solid ${isBaru ? "#93C5FD" : T.green+"33"}`,
                    borderRadius: 8, padding: "8px 12px",
                    display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12
                  }}>
                    <span style={{ fontSize: 18, flexShrink:0 }}>{isBaru ? "🆕" : "✅"}</span>
                    <div style={{ minWidth:0, flex:1, wordBreak:"break-word" }}>
                      {renameToko?.tokoId === toko.id ? (
                        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                          <input autoFocus value={renameToko.value}
                            onChange={e=>setRenameToko(r=>({ ...r, value:e.target.value }))}
                            style={{ flex:1, minWidth:120, padding:"5px 8px", border:`1.5px solid ${T.gray300}`,
                              borderRadius:6, fontSize:12.5, fontFamily:"inherit" }} />
                          <Btn size="sm" onClick={()=>{
                            const namaBaru = renameToko.value.trim();
                            if (!namaBaru) return alert("Nama toko tidak boleh kosong");
                            const dup = (db.toko||[]).some(t=>t.id!==toko.id && t.ruteId===toko.ruteId &&
                              t.nama.toLowerCase().trim()===namaBaru.toLowerCase());
                            if (dup && !confirm(`Sudah ada toko lain bernama "${namaBaru}" di rute yang sama. Tetap simpan?`)) return;
                            updateRecord("toko", toko.id, { nama: namaBaru });
                            setRenameToko(null);
                          }}>Simpan</Btn>
                          <Btn size="sm" variant="secondary" onClick={()=>setRenameToko(null)}>Batal</Btn>
                        </div>
                      ) : (
                        <>
                          <span style={{ fontWeight: 700, color: isBaru ? T.blue : T.green }}>
                            {toko.nama}
                          </span>
                          {/* ✅ Edit nama toko langsung dari sini — untuk kasus salah ketik
                              yang baru ketahuan saat kunjungan berikutnya. Manajer/Admin saja,
                              karena "nama" adalah field master (bukan operasional milik Sales). */}
                          {!isSalesRestricted && (
                            <button onClick={()=>setRenameToko({ tokoId: toko.id, value: toko.nama })}
                              style={{ marginLeft:6, border:"none", background:"transparent", cursor:"pointer",
                                fontSize:11, color:T.gray500, textDecoration:"underline", padding:0 }}>
                              ✏️ Edit Nama
                            </button>
                          )}
                          <span style={{
                            marginLeft: 8,
                            background: isBaru ? T.blue : T.green,
                            color: "#fff", fontSize: 10, fontWeight: 700,
                            borderRadius: 99, padding: "1px 8px", whiteSpace:"nowrap", display:"inline-block"
                          }}>
                            {toko.status}
                          </span>
                          {toko.kode && <span style={{ marginLeft: 6, color: T.gray400 }}>· {toko.kode}</span>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
              {/* ⚠️ Peringatan: toko yang dipilih SUDAH ada entri kontrol di tanggal yang sama */}
              {tokoSudahDikontrolHariIni && (
                <div style={{
                  marginTop: -8, marginBottom: 14,
                  background: T.redLt, border: `1px solid #FCA5A5`,
                  borderRadius: 8, padding: "8px 12px",
                  display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12
                }}>
                  <span style={{ fontSize: 18, flexShrink:0 }}>⚠️</span>
                  <div style={{ color: T.red, minWidth:0, flex:1, wordBreak:"break-word" }}>
                    <b>Toko ini sudah dikontrol pada tanggal {form.tanggal}.</b>
                    <div style={{ color: T.gray500, marginTop: 2 }}>
                      {modal==="add"
                        ? "Menyimpan sekarang akan membuat entri kontrol KEDUA di hari yang sama untuk toko ini."
                        : "Ada entri kontrol lain untuk toko & tanggal yang sama."}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Input label="Tanggal Kontrol" value={form.tanggal} onChange={v=>f("tanggal",v)} type="date" required />
          </div>

          {selToko && (
            <div style={{ background:T.greenLt, borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:12 }}>
              <b style={{ color:T.green }}>Produk toko ini:</b>
              {" "}{produkAktif.filter(p=>selToko[`produk_${p.id}`]).map(p=>p.nama).join(", ")||"Semua produk"}
            </div>
          )}

          {/* Stok, Terjual, & Bonus per produk */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.gray600 }}>📦 Stok, Penjualan & Bonus Produk</div>
              {/* ✅ Tarik Toko Ini: DISAMAKAN dengan alur "🏪 Tarik / Non-Aktifkan Toko"
                  yang sudah ada di view per rute — bukan sekadar mencentang "Ditarik"
                  di form ini. Klik tombol ini membuka modal konfirmasi yang sama
                  (input stok kembali ke gudang, catat Penyesuaian Stok otomatis,
                  ubah status toko jadi Non-Aktif di Master Toko). Setelah
                  dikonfirmasi, modal Tambah Kontrol ini otomatis ditutup karena
                  toko sudah tidak aktif — tidak perlu lagi entri kontrol bulanan
                  terpisah untuk kunjungan ini. */}
              {form.tokoId && (() => {
                const tokoTerpilih = (db.toko||[]).find(t=>t.id===form.tokoId);
                if (!tokoTerpilih || tokoTerpilih.status === "Non-Aktif") return null;
                return (
                  <Btn size="sm" variant="danger" onClick={() => openTokoStatusModal(tokoTerpilih)}>
                    🏪 Tarik / Non-Aktifkan Toko Ini
                  </Btn>
                );
              })()}
            </div>
            <div style={{ fontSize:11, color:T.gray400, marginBottom:10 }}>Kolom <b style={{ color:T.gold }}>Bonus Produk</b> adalah jumlah <b>pcs produk</b> yang diberikan ke toko saat kunjungan ini</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10 }}>
              {/* Roll On ditaruh paling depan karena produk ini paling banyak dititipkan ke toko */}
              {[...produkAktif].sort((a,b)=>{
                const aRoll = /roll\s*on/i.test(a.nama) ? 0 : 1;
                const bRoll = /roll\s*on/i.test(b.nama) ? 0 : 1;
                return aRoll - bRoll;
              }).map(p => {
                const terjual = Number(form[`terjual_${p.id}`]||0);
                const bonusPcs = Number(form[`bonusInput_${p.id}`]||0);
                const ditarik = !!form[`ditarik_${p.id}`];
                return (
                  <div key={p.id} style={{ background:ditarik?T.redLt:(terjual>0?T.greenLt:T.gray50), borderRadius:10,
                    padding:"12px", border:`1.5px solid ${ditarik?T.red:(terjual>0?T.green+"44":T.gray200)}`, transition:"all .2s" }}>
                    <div style={{ fontSize:12, fontWeight:800, color:T.gray800, marginBottom:10 }}>
                      {p.nama}
                      {terjual>0 && !ditarik && <span style={{ marginLeft:6, fontSize:10, background:T.green, color:"#fff", borderRadius:99, padding:"1px 6px" }}>✓ Laku</span>}
                      {ditarik && <span style={{ marginLeft:6, fontSize:10, background:T.red, color:"#fff", borderRadius:99, padding:"1px 6px" }}>🔻 Ditarik</span>}
                    </div>
                    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", marginBottom:10,
                      padding:"6px 8px", borderRadius:7, background:ditarik?T.red+"22":T.gray100 }}>
                      <input type="checkbox" checked={ditarik}
                        onChange={e=>{
                          const val = e.target.checked;
                          f(`ditarik_${p.id}`, val);
                          if (val) f(`stok_${p.id}`, 0); // Ditarik → Stok Awal otomatis 0
                        }} />
                      <span style={{ fontSize:11, fontWeight:700, color:ditarik?T.red:T.gray600 }}>🔻 Produk ditarik dari toko ini</span>
                    </label>
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Stok Awal</div>
                      <input type="number" value={form[`stok_${p.id}`]||0} disabled={ditarik}
                        onChange={e=>f(`stok_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gray200}`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box",
                          background:ditarik?T.gray100:T.white, opacity:ditarik?0.6:1 }} />
                    </div>
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontSize:11, color:T.gray500, marginBottom:3 }}>Terjual</div>
                      <input type="number" value={form[`terjual_${p.id}`]||0}
                        onChange={e=>f(`terjual_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${terjual>0?T.green:T.gray200}`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ marginBottom:4 }}>
                      <div style={{ fontSize:11, color:T.gold, marginBottom:3 }}>🎁 Bonus Produk (pcs)</div>
                      <input type="number" value={form[`bonusInput_${p.id}`]||0}
                        onChange={e=>f(`bonusInput_${p.id}`,e.target.value)} min={0}
                        style={{ width:"100%", padding:"6px 10px", border:`1.5px solid ${T.gold}44`,
                          borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:T.goldLt }} />
                    </div>
                    {bonusPcs>0 && (
                      <div style={{ fontSize:11, color:T.gold, marginTop:6, fontWeight:700 }}>
                        🎁 {bonusPcs} pcs bonus diberikan
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Revenue & Bonus estimasi */}
          <div style={{ background:T.goldLt, borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:13 }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span><b style={{ color:T.gold }}>Estimasi Revenue:</b></span>
              <span style={{ fontWeight:800, color:T.gold }}>
                {fmtRp(produkAktif.reduce((s,p)=>s+(Number(form[`terjual_${p.id}`])||0)*(p.harga||0),0))}
              </span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              <span><b style={{ color:T.orange }}>Total Bonus Produk:</b></span>
              <span style={{ fontWeight:800, color:T.orange }}>
                {fmt(produkAktif.reduce((s,p)=>s+(Number(form[`bonusInput_${p.id}`])||0),0))} pcs
              </span>
            </div>
          </div>

          {/* Status kunjungan: selalu tampil.
               - Saat tidak ada penjualan → WAJIB dipilih
               - Saat ada penjualan       → OPSIONAL (untuk catatan tambahan) */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
              <div style={{ fontSize:12, fontWeight:600, color:T.gray600 }}>Status Kunjungan</div>
              {!adaTerjual
                ? <Badge color={T.orange} bg={T.orangeLt}>⚠️ Wajib diisi — tidak ada penjualan</Badge>
                : <Badge color={T.gray400} bg={T.gray100}>Opsional — untuk catatan tambahan</Badge>
              }
            </div>

            {/* Saat ada penjualan: tombol "Tidak perlu catatan" sebagai default */}
            {adaTerjual && (
              <div style={{ marginBottom:8 }}>
                <label style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 14px",
                  border:`2px solid ${catatanSt==="" ? T.green : T.gray200}`,
                  borderRadius:8, cursor:"pointer",
                  background:catatanSt==="" ? T.greenLt : T.white }}>
                  <input type="radio" name="catatanStatus" value="" checked={catatanSt===""}
                    onChange={()=>{ f("catatanStatus",""); f("catatan",""); }}
                    style={{ accentColor:T.green }} />
                  <span style={{ fontSize:12, fontWeight:600, color:T.green }}>✅ Terjual — tanpa catatan tambahan</span>
                </label>
              </div>
            )}

            <div className="gw-grid3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              {Object.entries(CATATAN_STATUS).filter(([k])=>k!=="manual").map(([key, cs]) => (
                <label key={key} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                  border:`2px solid ${catatanSt===key ? cs.border : T.gray200}`,
                  borderRadius:8, cursor:"pointer", background:catatanSt===key ? cs.bg : T.white }}>
                  <input type="radio" name="catatanStatus" value={key} checked={catatanSt===key}
                    onChange={()=>f("catatanStatus",key)} style={{ accentColor:cs.color }} />
                  <span style={{ fontSize:12, fontWeight:600, color:cs.color }}>{cs.label}</span>
                </label>
              ))}
              <label style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                border:`2px solid ${catatanSt==="manual" ? T.gray400 : T.gray200}`,
                borderRadius:8, cursor:"pointer", background:catatanSt==="manual" ? T.gray100 : T.white }}>
                <input type="radio" name="catatanStatus" value="manual" checked={catatanSt==="manual"}
                  onChange={()=>f("catatanStatus","manual")} />
                <span style={{ fontSize:12, fontWeight:600, color:T.gray600 }}>📝 Isi Manual</span>
              </label>
            </div>

            {(catatanSt==="manual" || (adaTerjual && catatanSt && catatanSt!=="")) && (
              <div style={{ marginTop:10 }}>
                <Input label={catatanSt==="manual" ? "Catatan" : "Catatan Tambahan (opsional)"}
                  value={form.catatan||""} onChange={v=>f("catatan",v)} type="textarea"
                  placeholder={catatanSt==="manual"
                    ? "Tulis catatan bebas..."
                    : "Tambahkan keterangan jika perlu..."} />
              </div>
            )}
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
//  DASHBOARD
// ─────────────────────────────────────────────
