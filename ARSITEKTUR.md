# Struktur Modular GWG Super App

File `src/GWG_SuperApp.jsx` (10.235 baris, satu file) sudah dipecah menjadi
39 file kecil dengan tanggung jawab jelas. Tidak ada logika yang diubah —
murni dipindah + ditambah `import`/`export` supaya modular. Semua tetap
di-export dari `src/App.jsx` sebagai `GWGSuperApp` (default export), jadi
`src/main.jsx` cuma ganti satu baris import.

## Peta folder

```
src/
├── main.jsx                     — entry point (tidak berubah selain import)
├── App.jsx                      — komponen utama GWGSuperApp (orkestrasi tab, layout, modal global)
│
├── firebase/
│   ├── config.js                — FIREBASE_CONFIG (ganti kredensial di sini)
│   └── init.js                  — initFirebase(), instance firebaseApp/DB/Auth
│
├── config/
│   ├── superAdmin.js            — SUPER_ADMIN_EMAIL & helper terkait
│   ├── dbEmpty.js                — struktur database kosong (DB_EMPTY)
│   └── tabs.js                   — daftar TABS, canAccessTab(), getInitialActiveTab()
│
├── theme/
│   ├── tokens.js                 — design tokens (warna, dll) + CATATAN_STATUS
│   └── logo.js                   — logo base64 (dipisah karena besar)
│
├── hooks/
│   ├── useAuth.js                 — login/logout Google
│   ├── useOnlineStatus.js         — deteksi online/offline
│   ├── useAppResumeReload.js      — reload saat app native resume
│   ├── usePresence.js             — daftar pengguna aktif real-time
│   ├── useDB.js                   — HOOK INTI: sinkronisasi Firebase + IndexedDB + CRUD
│   └── useAnalytics.js            — kalkulasi turunan (total, laba, dst) dari db
│
├── lib/
│   ├── offlineStore.js            — IndexedDB + antrean tulis offline
│   ├── dataHelpers.js             — LIST_TABLES, arrToMap/mapToArr, kontrolYearOf, encode/decodeEmailKey
│   ├── format.js                  — fmt, fmtRp, genId, normTxt, naturalCompare, sortByNama
│   ├── fileSave.js                — simpan/bagikan file (web vs APK native)
│   ├── googleDrive.js             — backup ke Google Drive
│   ├── exportUtils.js             — export CSV/Excel/PDF/JPG/HTML
│   └── importUtils.js             — template & baca file Excel import
│
├── components/
│   ├── LoginPage.jsx               — halaman login
│   └── ui/
│       ├── index.js                — barrel export (import semua dari sini)
│       ├── Primitives.jsx          — Badge, Btn, Card, Input, SearchableSelect, Modal, ConfirmDelete
│       ├── Menus.jsx                — HeaderMenu, ImportMenu, ExportMenu
│       ├── Table.jsx, StatCard.jsx, FilterBar.jsx, BulkActionBar.jsx
│
└── features/                      — satu folder per tab aplikasi
    ├── wilayah/TabWilayah.jsx
    ├── rute/TabRute.jsx
    ├── toko/TabToko.jsx            — juga berisi autoUpgradeBaruToAktif()
    ├── produk/TabProduk.jsx
    ├── kontrol/TabKontrol.jsx      — tab terbesar (kontrol bulanan)
    ├── dashboard/Dashboard.jsx
    ├── rekap/TabRekap.jsx
    ├── bagihasil/TabBagiHasil.jsx
    └── pengguna/TabPengguna.jsx
```

## Cara kerja import antar-modul

Semua komponen UI bersama diimpor lewat satu barrel file:

```js
import { Btn, Card, Table, ExportMenu } from "../../components/ui";
```

Utility (format angka, generate ID, dll) diimpor langsung dari `lib/format`:

```js
import { fmt, fmtRp, genId } from "../../lib/format";
```

## Yang perlu diperhatikan kalau mau menambah fitur baru

1. **Tab baru** → buat folder di `features/<nama>/Tab<Nama>.jsx`, lalu:
   - tambahkan entry di `config/tabs.js` (`TABS` array + `canAccessTab`)
   - import & render di `App.jsx`
2. **Komponen UI baru yang dipakai berkali-kali** → taruh di `components/ui/`,
   lalu tambahkan `export * from "./NamaFile"` di `components/ui/index.js`.
3. **Util murni (tanpa state/JSX)** → taruh di `lib/`.
4. **Hook baru** → taruh di `hooks/`.

## Verifikasi

Semua 39 file sudah dicek sintaksnya (esbuild transform, 0 error) dan sudah
ditelusuri manual untuk memastikan setiap fungsi/komponen yang dipakai lintas
file benar-benar di-import dari lokasi yang tepat. Karena sandbox ini tidak
punya akses internet untuk `npm install` dependency asli project (firebase,
xlsx, jspdf, capacitor, dst), langkah berikutnya di komputer Anda:

```bash
npm install
npm run dev      # coba jalankan
npm run build    # pastikan build production juga lolos
```

Kalau ada error import yang lolos dari pengecekan otomatis di atas, itu akan
langsung kelihatan di sini karena Vite akan menyebut file & baris persisnya.
