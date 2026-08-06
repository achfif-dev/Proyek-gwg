# Audit Integrasi: Neraca Lama ↔ Double-Entry ↔ Bagi Hasil ↔ Perpajakan

> ✅ **UPDATE — SUDAH DITINDAKLANJUTI.** Ketiga temuan di bawah sudah
> diputuskan & dikerjakan — lihat `CHANGES-fase9-integrasi-historis.md`
> untuk detail implementasinya. Dokumen ini dipertahankan apa adanya
> sebagai catatan analisis awal (kenapa masalahnya muncul), bukan berarti
> masih terbuka.

Status: **Temuan desain/arsitektur — belum ada yang diperbaiki di dokumen
ini.** Berbeda dari bug-bug sebelumnya (yang murni salah kode dan bisa
langsung di-patch), ketiga temuan di bawah ini butuh **keputusan kamu**
dulu, karena menyangkut filosofi mana yang mau dipakai sebagai kebenaran.

---

## Ringkasan singkat

**Perpajakan (`LaporanPajak.jsx`), Bagi Hasil (SHU/`akuntansi`), dan Neraca
lama semuanya 100% masih membaca dari sistem LAMA** (`revPeriode`/
`akuntansi` di `TabBagiHasil.jsx`) — **tidak pernah membaca `jurnalUmum`
atau `saldoAkunBulanan` sama sekali**. Ini sesuai rencana (Fase 8 Opsi B
sengaja tidak mengganti apa pun). Tapi ini berarti ada **3 celah sinkronisasi
riil** antara "yang dilihat Pajak/Bagi Hasil" vs "yang dihitung double-entry
di balik layar" yang perlu kamu ketahui sebelum memutuskan migrasi penuh:

---

## Temuan 1 — Harga produk yang diedit membuat Pendapatan "goyang" di sistem lama, tapi TIDAK di jurnal

**Sistem lama** (`revPeriode.rev` di `TabBagiHasil.jsx`, dipakai Bagi Hasil
& Pajak): dihitung ulang **setiap kali dibuka**, dari `k.totalRev` yang
selalu pakai **harga produk SAAT INI** (`db.produk` versi terbaru) —
termasuk untuk kunjungan/penjualan bertahun-tahun lalu.

**Sistem jurnal** (Fase 3, `bangunBarisJurnalKontrol`): dihitung **sekali**
saat kontrol disetujui, memakai harga produk **saat itu juga**, lalu
disimpan permanen di `jurnalUmum` — tidak pernah dihitung ulang lagi.

**Akibat**: begitu Admin mengedit harga jual produk, Laporan Bagi
Hasil/Pajak untuk BULAN-BULAN LAMA ikut berubah retroaktif (karena dihitung
ulang pakai harga baru), sementara "Neraca versi Jurnal" untuk bulan yang
sama TETAP menampilkan angka lama (sesuai harga saat transaksi terjadi).
Kedua angka akan **terlihat beda**, dan **keduanya "benar" menurut
definisinya masing-masing** — bukan bug, tapi 2 filosofi berbeda:
- Sistem lama: "berapa nilainya kalau dihitung dengan harga sekarang" (mark-to-market).
- Sistem jurnal: "berapa nilainya saat transaksi benar-benar terjadi" (historical cost — ini yang standar akuntansi).

**Kapan ini jadi masalah nyata**: begitu kamu edit harga produk sekali saja,
dan ada histori transaksi sebelum tanggal edit itu.

---

## Temuan 2 — Beban Usaha (Gaji Sales, Produksi, dll) hanya "diasumsikan", tidak pernah masuk jurnal

Ini yang **paling berdampak**. Di sistem lama, `akuntansi.totalBiaya`
memotong Laba Bersih dengan **angka asumsi bulanan dari Konfigurasi**
(`config.bebanUsaha[]` — yang kamu sebutkan sendiri totalnya ~Rp16,5
juta/bulan) — **TANPA PERLU ada transaksi Kas apa pun**. Ini murni
angka anggaran/estimasi, bukan pencatatan transaksi riil.

Di sisi double-entry, **tidak ada Fase yang otomatis mem-posting Beban Usaha
ini**. Satu-satunya cara `5102 Beban Operasional` terisi di jurnal adalah
kalau Admin **secara manual** mencatatnya sebagai transaksi Kas Keluar
kategori "Biaya Operasional" — dan itu pun HANYA sebesar nominal yang
benar-benar dicatat, kapan pun itu terjadi, bukan otomatis tiap bulan.

**Akibat**: "Laba Berjalan" di card Neraca versi Jurnal akan **selalu lebih
besar** dari SHU/Laba Bersih di Bagi Hasil & Pajak — sebesar selisih antara
Beban Usaha yang DIASUMSIKAN (sistem lama, otomatis tiap periode) vs yang
BENAR-BENAR DICATAT sebagai transaksi Kas (sistem jurnal, manual & kapan
pun). Kalau Admin tidak pernah mencatat pengeluaran ini di Kas Opname sama
sekali (mengandalkan angka asumsi saja), jurnal tidak akan pernah
mencerminkan beban ini — Laba versi jurnal akan jauh lebih besar dari
kenyataan bisnis.

**Ini bukan bug** — ini konsekuensi dari 2 pendekatan berbeda:
- Sistem lama: budgeting (asumsi biaya rutin, tidak perlu pencatatan transaksi).
- Sistem jurnal: transaksional murni (cuma catat apa yang benar-benar terjadi).

**Rekomendasi**: kalau mau kedua sistem sinkron, salah satu dari dua hal
perlu terjadi — (a) Admin mulai mencatat SEMUA Beban Usaha sebagai
transaksi Kas riil (bukan cuma asumsi), atau (b) ditambahkan Fase baru yang
memposting Beban Usaha dari config secara otomatis tiap bulan (mirip pola
Amortisasi di Fase 4/7) — tapi ini butuh keputusan kamu, karena akan
otomatis "mengeluarkan" Kas versi jurnal walau belum ada transaksi kas
riilnya (perlu akun kewajiban penampung, mirip pola Dana Cadangan).

---

## Temuan 3 — Kewajiban Bagi Hasil (`2120`) & Dana Cadangan (`2110`) periode vs kumulatif tidak searah

`cairkanKeKas()` (yang saya perbaiki minggu lalu) membayar Bagi Hasil
berdasarkan `labaBersihFinal` **PERIODE tertentu** (angka dari sistem lama,
sudah kena Temuan 1 & 2 di atas) — tapi jurnalnya men-debit `2120` yang
**tidak pernah dikredit terlebih dulu** (sudah didokumentasikan sebagai
keterbatasan di fix minggu lalu). Ditambah dengan Temuan 1 & 2, nominal
yang dicairkan bisa jauh berbeda dari yang "seharusnya" menurut logika
jurnal murni — memperbesar potensi saldo `2120` negatif.

Dana Cadangan sendiri (Fase 6) **sudah benar** menghitung selisih (bukan
nilai penuh) dan konsisten dengan versi lama karena sengaja memakai
`hitungDanaCadanganKumulatif()` yang sama — ini SATU-SATUNYA angka yang
sudah benar-benar disinkronkan antara sistem lama & jurnal sejauh ini.

---

## Kesimpulan: apakah "tidak sinkron"? Ya, secara desain — dan itu sesuai rencana Opsi B

Ingat tujuan Opsi B: **card "Neraca versi Jurnal" memang dibuat untuk
dibandingkan**, bukan untuk cocok persis dengan sistem lama. Ketidaksesuaian
yang kamu lihat di card itu **sebagian besar berasal dari Temuan 1 & 2 di
atas**, BUKAN dari bug posting (yang sudah saya perbaiki di 2 sesi audit
sebelumnya). Supaya perbandingan itu bermakna dan tidak membingungkan, ada
baiknya kamu tahu persis kenapa angkanya beda — sudah dijelaskan di atas.

## Yang perlu diputuskan sebelum Fase 8 migrasi penuh (Opsi A) dikerjakan
1. Apakah Pendapatan harus **historical cost** (harga saat transaksi,
   seperti jurnal) atau **mark-to-market** (harga sekarang, seperti sistem
   lama)? Standar akuntansi mengarah ke historical cost.
2. Beban Usaha: mulai dicatat sebagai transaksi Kas riil semua, ATAU
   dibuatkan Fase baru untuk posting otomatis dari config?
3. Kewajiban Bagi Hasil (`2120`): perlu Fase baru "pengakuan SHU final"
   supaya tidak pernah didebit tanpa dikredit dulu?

Saya tidak akan mengerjakan salah satu dari ini tanpa arahan kamu, karena
masing-masing punya trade-off yang berbeda tergantung bagaimana kamu &
Direktur ingin laporan keuangan ini benar-benar mencerminkan bisnis.
