# Tab Kontrol: pilih Wilayah & "Cari Toko" lemot

**Gejala**: memilih Wilayah lama; mengetik di "Cari Toko" lemot saat mulai mengetik dan saat
menghapus sampai sisa ≤2 huruf, lancar di 3+ huruf. Pola ini = lemot HANYA saat daftar hasil besar.

**Penyebab (dari kode, `TabKontrol.jsx`)**
1. Tiap ketukan mengubah state `filter` di komponen induk (±4000 baris) → seluruh tab dirender ulang per huruf.
2. Di SETIAP render, array ekspor `kontrolExportData` dibangun untuk SEMUA baris hasil filter
   (`data.map(row => ({...row, fmtRp(...)}))`) walau menu Ekspor tidak dibuka → biaya ∝ jumlah hasil
   (besar di 0–2 huruf, kecil di 3+ huruf — cocok dengan gejala).
3. Per ketukan, untuk tiap baris: `normTxt` nama + kode + kata kunci (regex + alokasi string), lalu sort ulang seluruh hasil.
4. Memilih Wilayah: render sinkron berat sebelum dropdown sempat menutup.

**Perbaikan**
- `ExportMenu`: `exportData` boleh berupa fungsi → dibangun saat diklik. `TabKontrol` memakainya.
- `lib/kontrolFilter.js` (baru): urutan & teks ternormalisasi dihitung SEKALI per perubahan data;
  kata kunci dinormalisasi sekali per filter. Hasil IDENTIK dengan logika lama (uji acak 400 kombinasi).
- `FilterBar`: kolom teks bebas memakai state lokal + jeda 250 ms (juga diteruskan saat blur/Enter);
  Reset membuang ketikan tertunda. Berlaku untuk SEMUA tab yang memakai FilterBar (efek: hasil
  muncul ±¼ detik setelah berhenti mengetik, bukan per huruf).
- `TabKontrol`: `filter` dipecah jadi `filterLive` (kolom filter, langsung) dan `filter` ditunda
  (`useDeferredValue`) untuk semua hitungan berat → dropdown menutup/huruf muncul dulu, daftar menyusul.
- `tests/kontrol-filter.test.mjs`: 3 test (kesetaraan, urutan, performa).

**Belum terukur di HP.** Di Node, 10 ketukan × 20.000 baris: 138 ms → 30 ms untuk penyaringannya saja;
penghematan terbesar yang diharapkan ada di ekspor malas & render per huruf, yang tidak terukur di sini.
**Belum dicakup**: ringkasan per-produk (`data.reduce` per produk) & `ringkasanUangKontrol` masih
dihitung tiap render (murah dibanding yang di atas); `usePersistedState` menulis localStorage per perubahan filter.
