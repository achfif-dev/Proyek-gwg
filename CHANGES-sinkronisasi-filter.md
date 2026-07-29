# Perubahan: Indikator Sinkronisasi & Filter Persisten

## 1) Revenue "sedikit" saat sinkronisasi (root cause + fix)

**Penyebab:** `db.penjualanLuar` (luar rute) adalah tabel kecil yang dimuat
sekaligus lewat `onValue`. `db.kontrol` (sumber revenue rute) adalah tabel
besar yang disinkron per-record (`onChildAdded`) dengan debounce "settle"
900ms. Di jaringan lambat, begitu ada jeda >900ms di tengah aliran data,
`syncing` sudah `false` walau `db.kontrol` baru terisi sebagian — sehingga
Total Revenue yang tampil untuk sesaat = hanya penjualan luar rute (karena
kontrol yang lain belum masuk).

**Fix:**
- `src/hooks/useDB.js`: state baru `dataStillSyncing`, tetap `true` selama
  listener kontrol (per tahun) & toko masih menerima `child_added/changed/
  removed`, baru `false` 2.5 detik setelah benar-benar tenang.
- `src/App.jsx`: banner baru muncul saat `dataStillSyncing` aktif meski
  `syncing` awal sudah kelar; titik kuning berkedip juga muncul di "Rev:"
  pada header.
- `src/components/ui/StatCard.jsx`: prop baru `pending` — titik kecil
  berkedip + label "masih memuat…" di StatCard yang datanya belum final.
- Diterapkan ke StatCard Total Pendapatan/Laba/Entri Kontrol/Total Bonus di
  `Dashboard.jsx`, `TabRekap.jsx`, dan ringkasan Rev/Bonus di
  `TabKontrol.jsx`.

Prop `dataStillSyncing` diteruskan dari `App.jsx` → `Dashboard`, `TabKontrol`,
`TabRekap` (termasuk `TabKontrol` yang dirender ulang di dalam `TabRekap`
saat pencarian toko).

## 2) Filter/pencarian tidak persisten setelah refresh (fix)

**Fix:** hook baru `src/hooks/usePersistedState.js` — drop-in pengganti
`useState` yang otomatis membaca/menulis nilainya ke `localStorage`
(prefix `gwg_filter_v1:`).

Diterapkan ke:
- `TabKontrol.jsx`: `filter`, `viewMode`, semua filter Diagnostik.
- `TabRekap.jsx`: `cariTokoQuery`, `mode`, semua `filter*`, `rankingScope`,
  `rankingSortBy`, filter Siklus, `perputaranPeriodeType`.
- `TabToko.jsx`: `filter`, `stokFilter`.
- `TabRute.jsx`, `TabWilayah.jsx`: `filter`.
- `TabBagiHasil.jsx`: `filterBulan`, `filterTahun`, `periodeMode`,
  `filterStart`, `filterEnd`.

**Catatan keamanan:** untuk field yang berhubungan dengan pembatasan
wilayah Sales (`wilayahId`), ditambahkan `useEffect` yang mengunci ulang
nilainya ke `salesWilayahId` — supaya nilai lama yang tersimpan di
localStorage (mis. sisa sesi Admin di device yang sama) tidak "bocor" ke
tampilan filter Sales. Ini murni UX; batasan akses data yang sebenarnya
tetap ditegakkan di level query masing-masing tab seperti sebelumnya.

## Belum dikerjakan / rekomendasi lanjutan
- Jalankan `npm install && npm run build` di lokal/CI sebelum deploy —
  belum bisa diverifikasi build penuh di lingkungan sandbox ini (tanpa akses
  jaringan untuk `npm install`). Perubahan sudah dicek manual (struktur
  kurung/brace) dan konsisten dengan gaya kode yang ada.
- Pertimbangkan indikator serupa untuk tabel `toko` yang berdiri sendiri
  (mis. saat tab Toko dibuka duluan sebelum kontrol selesai).
