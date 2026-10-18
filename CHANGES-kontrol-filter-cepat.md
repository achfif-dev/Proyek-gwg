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

---
## Tambahan: lemot di huruf kedua — penyebab utama sebenarnya
**Temuan**: `tokoPerRute` (hanya dipakai di tampilan "View per Rute") dihitung di SETIAP render,
termasuk saat di tampilan tabel, dan bergantung pada `filter.q`. Untuk tiap toko yang cocok ia
memindai SELURUH kontrol dua kali (`enriched.filter` + `enriched.some`) → O(toko × kontrol).
Di 1–2 huruf banyak toko cocok → berat; di 3+ huruf sedikit toko cocok → ringan. Inilah pola gejala.
Uji Node (3.000 toko × 20.000 kontrol): lama 686 ms/ketukan → baru ±36 ms (HP bisa beberapa kali lebih lambat).

**Perbaikan**: kontrol dikelompokkan per toko sekali (`indeksKontrolPerToko`); `hitungTokoPerRute`
(murni, `lib/kontrolFilter.js`) hanya melihat entri toko itu sendiri; hasil `tokoPerRute` = `[]`
kecuali `viewMode === "monthly"`. Diuji identik dengan logika lama (200 filter acak) + uji performa.
Total test: 89 lulus, 0 gagal, 7 dilewati.

---
## Audit ulang (diukur, bukan ditebak)
Metode: Tab Kontrol dirender di jsdom + React (mode development) dengan data sintetis 3.000 toko × 20.000
kontrol × 8 produk, lalu ketikan/pilihan filter disimulasikan dan di-profil CPU. Skrip yang SAMA dijalankan
pada kode asli (HEAD) dan kode baru. Angka mutlak di HP akan lebih besar (mesin ini jauh lebih cepat);
yang bermakna adalah perbandingannya.

| Aksi | Kode asli | Kode baru |
|---|---|---|
| Render awal tab | 5.900 ms | 1.190 ms |
| Ketik "b" | 1.838 ms (memblokir) | ketukan 3 ms; daftar menyusul ±300 ms setelah berhenti |
| Ketik "ba" / "bar" | 771 / 412 ms | 1 ms; daftar menyusul 124 / 42 ms |
| Hapus sampai kosong | 2.930 ms | 1 ms; daftar menyusul 123 ms |
| Pilih Wilayah | 478 / 452 / 921 ms | 136 / 173 / 181 ms |
(“menyusul” = render berat dipindah ke prioritas rendah, setelah jeda 250 ms; layar tidak membeku per huruf.)

**Penyebab tambahan yang ditemukan lewat profil**
1. `fmt()` membuat `new Intl.NumberFormat("id-ID")` di SETIAP panggilan (ribuan per render tabel) → kini formatter bersama.
2. `naturalCompare` (urut rute "Rute 2" < "Rute 10") memakai regex + `localeCompare` berpilihan per perbandingan;
   dipanggil ratusan ribu kali di "Ringkasan Tanggal" saat Wilayah/Rute/Bulan diganti → token di-cache + `Intl.Collator`;
   ringkasan per tanggal memakai peringkat nama rute (urut sekali).
3. Kartu ringkasan per produk menjalankan 2 `reduce` × jumlah produk × seluruh baris di SETIAP render, dengan template
   string dibuat di tiap iterasi → kini `useMemo` + kunci dibentuk sekali. `ringkasanUang`, `totalRev/Bonus` juga di-memo;
   array kosong bersama `ARR_KOSONG` agar memo tidak batal tiap render.
4. DOM: tiap hasil baru mengganti hampir semua dari 50 baris × 35 kolom (±1.750 <td>). Eksperimen: 10 baris/halaman →
   komit turun ±2,5×. `Table` kini merender 15 baris dulu lalu sisanya ±80 ms kemudian — KECUALI bila ≥50% baris
   yang akan tampil sudah ada di layar (edit satu baris, hasil menyempit) supaya tabel tidak menciut dan gulir tidak melompat.
5. `Table`: `includes`/`find` berulang untuk seleksi massal (O(dipilih × seluruh data)) → Set.

**Uji**: `tests/natural-compare.test.mjs` (naturalCompare identik pada 30.000 pasangan acak; ringkasan per tanggal identik;
fmt identik), `tests/table-utils.test.mjs`. Total 95 lulus, 0 gagal, 7 dilewati. Skrip pengukur: `tools/bench-kontrol/`.

**Batas**: pengukuran di jsdom (pembuatan DOM jsdom jauh lebih lambat daripada browser sungguhan) dan React mode
development; belum diuji di HP/Capacitor. Render bertahap memecah satu blokir jadi dua, total kerja baris tidak hilang.
