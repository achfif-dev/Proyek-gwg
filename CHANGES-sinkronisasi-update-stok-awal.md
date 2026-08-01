# Perubahan: Sinkronisasi "Update Stok Awal — Baru" dengan alur persetujuan Sales

## Masalah yang ditemukan

Sesi sebelumnya (`CHANGES-persetujuan-sales.md`) sudah menyamakan 3 alur:
**Penyesuaian Stok**, **Kontrol Bulanan (Stok Awal)**, dan **Tarik/Non-Aktifkan
Toko** — ketiganya sudah bisa diajukan Sales lewat status `menunggu` →
`disetujui` (manual/otomatis 24 jam).

Tapi ada SATU fitur yang tertinggal dan tidak ikut disamakan:
**"Update Stok Awal — Baru"** di Tab Toko → panel "Daftar Stok Produk per
Toko" (tombol **Update**). Fitur ini:

1. **Disembunyikan total untuk Sales** (`{!isSalesRestricted && <Btn .../>}`),
   beda dengan 3 fitur lain yang sudah boleh diajukan Sales.
2. **Langsung menimpa `stok_<id>` di Master Toko** tanpa jejak audit apa pun
   (beda dengan Penyesuaian Stok yang selalu tercatat).
3. **Nilainya bisa hilang diam-diam** — `recalcTokoStok()` (dipakai fitur
   lain) menghitung ulang stok dari histori Kontrol + Penyesuaian, BUKAN dari
   nilai `stok_<id>` yang ditimpa manual di sini. Jadi begitu ada entri
   Kontrol/Penyesuaian baru untuk toko yang sama, koreksi manual lewat modal
   ini akan tertimpa balik tanpa disadari.

## Perbaikan

- **`src/lib/dataHelpers.js`** — `recalcTokoStok()` dan
  `buildProdukFlagUpdates()` diekstrak dari `TabKontrol.jsx` jadi fungsi
  bersama (`export function`), supaya semua fitur yang mengubah stok/ceklis
  produk toko memakai **rumus yang sama persis**, bukan duplikat logika yang
  bisa diam-diam berbeda.
- **`src/features/kontrol/TabKontrol.jsx`** — dua fungsi lokal itu diganti
  jadi wrapper tipis yang memanggil versi bersama di atas (tidak ada
  perubahan perilaku, semua pemanggilan yang sudah ada tetap sama).
- **`src/features/toko/TabToko.jsx`** — `submitStok()` ditulis ulang:
  - Selisih (delta) stok lama vs baru dihitung per produk, lalu dicatat
    sebagai entri **`penyesuaian`** (jenis Tambah/Tarik) — persis pola yang
    sama dengan "Tarik/Non-Aktifkan Toko".
  - **Admin/Manajer**: entri langsung berstatus `disetujui`, `recalcTokoStok`
    langsung menuliskan hasilnya ke Master Toko (efeknya sama seperti
    sebelumnya, cuma sekarang lewat jalur beraudit).
  - **Sales**: entri berstatus `menunggu` + `autoApproveAt` (24 jam) — stok
    Master Toko BELUM berubah sampai disetujui Admin/Manajer atau lewat 24
    jam. Tombol "Update" untuk Sales sekarang tampil sebagai **"Ajukan
    Koreksi"**, dan modal menampilkan catatan bahwa ini akan masuk sebagai
    pengajuan.
  - Ceklis "Produk yang Dijual" tetap disinkron seketika (sama seperti
    perilaku Penyesuaian Stok yang sudah ada — hanya angka stok yang
    menunggu approval).
  - Karena ini memakai koleksi `penyesuaian` yang SUDAH ADA (bukan koleksi
    baru), pengajuan dari fitur ini otomatis muncul di banner & modal
    **"Pengajuan Penyesuaian Stok"** yang sudah ada di Tab Kontrol — tidak
    perlu UI tinjauan baru.

## Firebase Rules

**TIDAK PERLU diubah.** Fitur ini sengaja dibuat memakai koleksi
`penyesuaian` yang rule-nya sudah mengizinkan Sales membuat pengajuan
`status: "menunggu"` untuk toko di wilayahnya sendiri — beda dengan fitur
"Tarik Toko" yang perlu koleksi baru (`penarikanToko`) dan rule Firebase baru.

## Konsistensi akhir (ringkasan)

| Fitur | Sales bisa akses? | Efek Sales | Efek Admin/Manajer |
|---|---|---|---|
| Penyesuaian Stok | ✅ | menunggu → disetujui | langsung disetujui |
| Kontrol Bulanan (Stok Awal) | ✅ | menunggu → disetujui | langsung disetujui |
| Tarik/Non-Aktifkan Toko (view Rute & dalam modal Kontrol) | ✅ | menunggu → disetujui | langsung disetujui |
| **Update Stok Awal — Baru (Tab Toko)** | ✅ **(baru)** | menunggu → disetujui | langsung disetujui |

Keempatnya sekarang memakai logika persetujuan yang sama persis.
