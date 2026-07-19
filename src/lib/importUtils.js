import * as XLSX from "xlsx";
import { saveWorkbookNative } from "./fileSave";
import { CATATAN_STATUS } from "../theme/tokens";

export async function downloadTokoTemplate(db) {
  try {
    const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);
    const header = ["Nama Toko*", "Rute*", "Status", "Catatan", ...produkAktif.map(p=>`Jual: ${p.nama}`), ...produkAktif.map(p=>`Stok: ${p.nama}`)];
    const sample = ["Toko Barokah", (db.rute||[])[0]?.nama || "Rute Utara A", "Aktif", "",
      ...produkAktif.map(()=>"Ya"), ...produkAktif.map(()=>0)];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    ws["!cols"] = header.map(h=>({ wch: Math.max(String(h).length+2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Toko");

    const ruteList = (db.rute||[]).map(r=>{
      const w = (db.wilayah||[]).find(x=>x.id===r.wilayahId);
      return [r.nama, w?.nama||"—"];
    });
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["Generasi Wangi Group - Super App"],
      ["PETUNJUK IMPORT DATA TOKO"],
      ["1. Kolom bertanda * wajib diisi."],
      ["2. Kolom 'Rute' harus sama persis (tidak case-sensitive) dengan nama rute yang sudah ada di Master Rute."],
      ["3. Kolom 'Status' isi salah satu: Aktif / Non-Aktif / Baru (default Aktif jika kosong)."],
      ["4. Kolom 'Jual: <produk>' isi Ya / Tidak untuk menandai produk yang dijual toko tersebut."],
      ["5. Kolom 'Stok: <produk>' isi angka stok awal untuk masing-masing produk di toko tersebut (boleh dikosongkan, default 0)."],
      ["6. Jangan mengubah urutan atau nama header kolom pada sheet 'Template Toko'."],
      ["7. Tambahkan satu baris untuk setiap toko, mulai dari baris ke-2."],
      [""],
      ["Daftar Rute & Wilayah yang tersedia saat ini:"],
      ["Nama Rute", "Wilayah"],
      ...ruteList,
    ]);
    infoWs["!cols"] = [{ wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infoWs, "Petunjuk");

    await saveWorkbookNative(wb, "template_import_toko.xlsx");
  } catch(e) {
    alert("Gagal membuat template: " + e.message);
  }
}

export async function downloadKontrolTemplate(db) {
  try {
    const produkAktif = (db.produk||[]).filter(p=>p.aktif!==false);
    const header = ["Toko*", "Tanggal* (YYYY-MM-DD)", "Status Kunjungan", "Catatan",
      ...produkAktif.flatMap(p=>[`Stok Awal: ${p.nama}`, `Terjual: ${p.nama}`, `Bonus: ${p.nama}`])];
    const sample = [(db.toko||[]).find(t=>t.status==="Aktif")?.nama || "Toko Barokah",
      new Date().toISOString().slice(0,10), "", "",
      ...produkAktif.flatMap(()=>[0,0,0])];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    ws["!cols"] = header.map(h=>({ wch: Math.max(String(h).length+2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Kontrol");

    const tokoList = (db.toko||[]).filter(t=>t.status==="Aktif").map(t=>{
      const rute = (db.rute||[]).find(r=>r.id===t.ruteId);
      return [t.nama, rute?.nama||"—"];
    });
    const statusOpts = Object.values(CATATAN_STATUS).map(c=>c.label);
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["Generasi Wangi Group - Super App"],
      ["PETUNJUK IMPORT KONTROL BULANAN"],
      ["1. Kolom bertanda * wajib diisi."],
      ["2. Kolom 'Toko' harus sama persis (tidak case-sensitive) dengan Nama Toko di Master Toko."],
      ["3. Kolom 'Tanggal' format YYYY-MM-DD, contoh: 2026-06-28."],
      ["4. Kolom 'Status Kunjungan': WAJIB diisi jika tidak ada produk yang terjual. OPSIONAL jika ada penjualan (untuk catatan tambahan). Pilihan: " + statusOpts.join(", ") + "."],
      ["5. Jika salah satu kolom 'Terjual: <produk>' lebih dari 0, status kunjungan otomatis Terjual dan boleh dikosongkan."],
      ["6. Kolom 'Catatan' hanya dipakai jika Status Kunjungan diisi 'Isi Manual'."],
      ["7. Jangan mengubah urutan atau nama header kolom pada sheet 'Template Kontrol'."],
      ["8. Tambahkan satu baris untuk setiap kunjungan kontrol, mulai dari baris ke-2."],
      [""],
      ["Daftar Toko Aktif yang tersedia saat ini:"],
      ["Nama Toko", "Rute"],
      ...tokoList,
    ]);
    infoWs["!cols"] = [{ wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infoWs, "Petunjuk");

    await saveWorkbookNative(wb, "template_import_kontrol.xlsx");
  } catch(e) {
    alert("Gagal membuat template: " + e.message);
  }
}

// Hook dipakai oleh menu dropdown (ImportMenu, ExportMenu, dll) supaya
// posisinya selalu terkunci di dalam layar. Sebelumnya dropdown memakai
// `position:absolute; right:0` relatif ke tombolnya sendiri — di HP, jika
// tombol berada dekat sisi kiri, dropdown (lebar ~230px) akan terdorong ke
// kiri hingga keluar layar dan terlihat terpotong. Hook ini mengukur posisi
// tombol saat menu dibuka lalu menghitung `left` yang di-clamp supaya
// seluruh dropdown selalu terlihat penuh, di layar seukuran apa pun.
