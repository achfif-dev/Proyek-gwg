# 🌸 GWG Super App v4.0

**Generasi Wangi Group** — Sistem Manajemen Konsinyasi Parfum

## ✅ Fitur Baru v4.0: Tab Rekap Lengkap

### 📑 Tab Rekap — 4 Mode Rekap Otomatis

| Mode | Deskripsi |
|------|-----------|
| **📅 Harian/Rute** | Rekap kunjungan per hari, digroup per rute. Detail per toko termasuk stok & terjual per produk |
| **📆 Bulanan** | Rekap bulan terpilih: per wilayah (gabungan semua) atau per rute (jika filter wilayah aktif) |
| **📊 Kuartal** | Rekap Q1–Q4 per tahun: per wilayah-per-bulan (gabungan) atau per rute-per-bulan (per wilayah) |
| **📈 Tahunan** | Rekap 12 bulan per tahun: semua wilayah atau per wilayah tertentu |

### Filter Rekap
- **Wilayah**: Semua wilayah (gabungan) atau pilih satu wilayah spesifik
- **Tanggal** (Harian), **Bulan** (Bulanan), **Kuartal + Tahun**, atau **Tahun**
- **Rute** (khusus mode Harian)

### Export Multi-Format
Setiap rekap dapat diekspor dalam:
- 📊 **CSV** — untuk spreadsheet
- 🟢 **Excel (.xlsx)** — format Excel lengkap dengan info sheet
- 📄 **PDF Landscape** — format cetak profesional
- 🌐 **HTML** — halaman web
- 📋 **JSON** — data mentah

### Summary Cards Otomatis
- Total Revenue, Laba Est. (70%), Jumlah Kunjungan/Toko
- Total Bonus Produk, Terjual per Produk
- Grand Total row di bawah tabel

## 🚀 Setup

```bash
npm install
npm run dev
```

## ⚙️ Konfigurasi Firebase
Edit variabel `FIREBASE_CONFIG` di `src/GWG_SuperApp.jsx` untuk sinkronisasi cloud.

---
© 2025 Generasi Wangi Group · Sampang, Jawa Timur
