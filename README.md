# Kasir POS (Full Offline-First + Hybrid Online) — Android Kotlin + Jetpack Compose

Aplikasi kasir offline-first, Clean Architecture, siap di-build otomatis lewat GitHub Actions
tanpa perlu PC lokal maupun terminal — semua langkah (build APK, generate keystore, generate
keypair lisensi, deploy Cloud Functions, terbitkan lisensi pelanggan) dijalankan dari tab
**Actions** di GitHub lewat browser. Lihat bagian "Alur kerja GitHub Actions (tanpa PC/terminal)"
di bawah. UI menggunakan tema Material 3 kustom (palet oranye/navy khas retail, bukan ungu
default Material You, lihat `presentation/theme/`), mendukung mode gelap otomatis.

Transaksi harian tetap berjalan 100% offline. Beberapa fitur kompetitif tambahan (lisensi,
QRIS otomatis, sinkronisasi lintas cabang) memakai internet HANYA saat momen tertentu, dan
gagal dengan aman (fail-soft) ke perilaku offline biasa kalau tidak ada koneksi — lihat
`LICENSING_SETUP.md` dan `PAYMENT_GATEWAY_SETUP.md` untuk setup masing-masing.

## Model Lisensi: SEKALI BAYAR, bukan langganan

Lisensi aplikasi ini **sekali aktivasi, berlaku selamanya** — TIDAK ADA tanggal kedaluwarsa,
TIDAK ADA perpanjangan otomatis, TIDAK ADA biaya berulang. Ini keputusan desain yang sengaja
tertanam di backend (`functions/index.js`, fungsi `activateLicense`) maupun client
(`data/license/`): payload lisensi yang ditandatangani server **tidak memiliki field
`validUntil` sama sekali**.

- Sekali kode lisensi diaktivasi di sebuah device (butuh internet HANYA saat itu), device
  tersebut punya akses fitur prioritas **selamanya**, sepenuhnya offline setelahnya.
- Sebelum aktivasi, ada **masa coba 15 hari** sejak app pertama kali dibuka
  (`LicenseRepository.TRIAL_PERIOD_MILLIS`) di mana SEMUA fitur — termasuk fitur prioritas —
  bisa dicoba penuh. Aplikasi **tidak pernah memblokir seluruh app**, baik selama masa coba
  maupun setelahnya: transaksi harian (Kasir/Produk/Stok/Laporan) selalu berjalan. Yang
  terkunci setelah masa coba habis tanpa aktivasi HANYA fitur prioritas (QRIS Otomatis,
  Sinkronisasi Cloud, Cek Stok Lintas Cabang) — lihat `PremiumFeatureGate` di `MainActivity.kt`
  dan `LicenseState.hasPremiumAccess` di `data/license/LicenseModels.kt`.
- Satu-satunya cara sebuah device kehilangan akses setelah aktivasi adalah penjual/developer
  menonaktifkannya secara eksplisit lewat `scripts/issue-license.js --deactivate` (mis. kasus
  refund/chargeback) — status `REVOKED`, dicek murni oportunistik & fail-open lewat
  `LicenseSyncWorker` (tidak pernah retry paksa, tidak pernah butuh online rutin).

## Fitur yang sudah diimplementasikan penuh

- **Sistem Lisensi Anti-Bajakan** (self-service, lihat `LICENSING_SETUP.md`) — aktivasi lewat
  kode lisensi tanpa bantuan developer, verifikasi tanda tangan RSA offline.
- **QRIS Otomatis via Midtrans** (self-service per toko, lihat `PAYMENT_GATEWAY_SETUP.md`) —
  konfirmasi lunas realtime, QRIS statis manual tetap ada sebagai cadangan.
- **Printer Bluetooth, LAN/WiFi, & USB** — tidak lagi terbatas Bluetooth saja.
- **Cek Stok Semua Cabang** realtime (read-only) sebagai perluasan Sinkronisasi Cloud.
- **Struktur project** Clean Architecture (`data`, `domain`, `presentation`, `di`).
- **Tema Material 3 modern minimalis** — `presentation/theme/` (palet netral + aksen, light/dark otomatis).
- **Room Database** — Produk, Kategori, Transaksi + Item, Penyesuaian Stok, Varian Produk,
  Pengguna, lengkap dengan query laporan (omzet, laba kotor, top-selling items).
- **Kasir (POS Screen)** — grid produk, pencarian, keranjang, diskon per-item/transaksi,
  pajak otomatis, checkout Cash/Debit/QRIS (dengan tampilan gambar QRIS otomatis).
- **Manajemen Produk** — CRUD lengkap (nama, SKU, harga beli/jual, stok, alert stok tipis,
  diskon) + kelola kategori.
- **Varian Produk (Matrix)** — toggle "Produk Punya Varian" pada form produk; setiap kombinasi
  (mis. Ukuran x Warna) punya SKU, stok, dan harga khusus sendiri. Dikelola lewat dialog "Kelola
  Varian" dan otomatis muncul sebagai bottom sheet pemilih di layar Kasir saat produk dipilih.
- **Scan Barcode** — CameraX + ML Kit, otomatis menambahkan produk (atau varian via SKU) ke
  keranjang begitu barcode terbaca (`presentation/scanner/BarcodeScannerScreen.kt`).
- **Cetak Struk Bluetooth (ESC/POS)** — `data/printer/PrinterRepository.kt` menggunakan
  DantSu/ESCPOS-ThermalPrinter-Android, terhubung ke printer yang sudah di-pair, memakai nama
  toko/alamat/catatan dari Profil Toko.
- **Export PDF Invoice** — `data/export/PdfInvoiceGenerator.kt` memakai
  `android.graphics.pdf.PdfDocument` native, memakai data dari Profil Toko.
- **Export Excel/CSV** — `data/export/ExcelExporter.kt` (Apache POI) untuk produk & riwayat
  transaksi, plus opsi CSV ringan. Diakses dari layar Pengaturan.
- **Profil Toko** — layar khusus (`presentation/settings/StoreProfileScreen.kt`) untuk mengatur
  nama toko, alamat, telepon, catatan kaki struk, dan upload gambar QRIS statis (disimpan via
  DataStore + internal storage, dipakai di struk/PDF/layar pembayaran).
- **Login PIN Multi-User** — `presentation/auth/LoginScreen.kt` + manajemen kasir/admin di
  Pengaturan > Pengguna & Login PIN. PIN di-hash SHA-256, sesi login in-memory (wajib login lagi
  tiap buka app bila fitur diaktifkan), setiap transaksi mencatat nama kasir yang login.
- **Backup & Restore** — `data/backup/BackupRepository.kt` meng-copy file database SQLite
  secara utuh, dengan **riwayat backup lokal** yang tampil di layar Pengaturan (tanggal, ukuran,
  tombol restore/bagikan langsung).
- **Laporan Penjualan** — `presentation/report/ReportScreen.kt`: filter Hari Ini/Minggu
  Ini/Bulan Ini, ringkasan omzet & laba kotor, daftar produk terlaris.
- **Stok & Inventaris** — `presentation/stock/StockScreen.kt`: stok masuk/keluar/opname
  dengan riwayat, filter stok tipis.
- **`.github/workflows/android_build.yml`** — build otomatis: lint → unit test → APK debug
  & release ter-upload sebagai Build Artifact.

## Yang masih berupa penyempurnaan opsional (bukan blocker untuk pemakaian)

- **Role-based permission** — ditegakkan lewat `domain/auth/Permission.kt`, baik di navigasi
  (`RoleGatedRoute`) maupun (untuk rute berisiko tinggi seperti Stok Opname) di dalam fungsi
  mutasi ViewModel. Audit 2026-09-06 menemukan rute "Produk" dan aksi Stok Opname sempat lolos
  tanpa gerbang sama sekali — sudah diperbaiki (`Permission.canManageProducts`,
  `Permission.canPerformStockOpname`).
- Riwayat penyesuaian stok per varian dan QRIS dinamis (generate QR otomatis berisi nominal
  transaksi dari QRIS statis yang diunggah pemilik toko) — **sudah diimplementasikan penuh**
  (lihat `StockViewModel.adjustmentHistory` dan `data/qris/QrisUtil.kt` + pemakaiannya di layar
  pembayaran Kasir); catatan lama di sini yang bilang keduanya belum ada sudah ketinggalan zaman.
- `app/schemas/` — CI sekarang meng-upload folder ini sebagai artifact "room-schemas" tiap
  build (lihat `android_build.yml`), tapi developer TETAP WAJIB mendownload & commit manual
  file JSON terbaru dari tab Actions setiap kali `version` di `AppDatabase.kt` naik; ini belum
  otomatis ter-commit sendiri.

## Alur kerja GitHub Actions (tanpa PC/terminal)

Semua workflow di `.github/workflows/` didesain supaya seluruh siklus hidup app — build, sign,
setup lisensi, deploy backend, terbitkan lisensi pelanggan — bisa dikerjakan dari **browser di
tab Actions GitHub**, tanpa Android Studio, Node, atau terminal apa pun di komputer kamu:

1. **`android_build.yml`** (build APK) — jalan otomatis tiap push ke `main`, atau klik manual
   di tab **Actions → Android CI Build → Run workflow**. Setelah selesai, buka run tersebut,
   scroll ke **Artifacts**, download `app-debug-apk` (langsung bisa diinstall untuk uji coba)
   atau `app-release-apk` (perlu 4 secrets keystore di bawah dulu supaya ter-signed).
2. **`generate_keystore.yml`** (sekali saja) — bikin keystore signing release otomatis di
   runner GitHub. Hasilnya (file `.jks` + `keystore-info.txt` berisi 4 nilai) didownload dari
   Artifacts, lalu 4 nilainya disalin ke **Settings → Secrets and variables → Actions**:
   `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
   `RELEASE_KEY_PASSWORD`. Setelah disalin, hapus run ini dari tab Actions (passwordnya ada di
   log).
3. **`generate_license_keypair.yml`** (sekali saja, lihat `LICENSING_SETUP.md`) — bikin
   pasangan kunci RSA untuk sistem lisensi. Public key ditempel ke `LicenseCrypto.kt` lewat
   GitHub web editor; private key disimpan sebagai secret di Google Cloud Secret Manager.
4. **`deploy_license_functions.yml`** — deploy `functions/index.js` (Cloud Functions:
   `activateLicense`, `checkLicenseStatus`, `createQrisCharge`, dll.) & `firestore.rules` ke
   Firebase, mengganti `firebase deploy` dari terminal lokal. Butuh 2 secrets:
   `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`.
5. **`issue_license.yml`** — terbitkan/kelola kode lisensi pelanggan (issue/release-device/
   deactivate) lewat form di tab Actions, mengganti `node scripts/issue-license.js` dari
   terminal lokal.

Alur paling dasar untuk sekadar build & install APK:
1. Upload/commit seluruh isi folder ini ke repo GitHub kamu lewat web UI.
2. Push ke branch `main` (atau jalankan manual lewat tab **Actions → Run workflow**).
3. Setelah build selesai, buka run terkait di tab **Actions**, scroll ke
   **Artifacts**, download `app-debug-apk` (langsung bisa diinstall) atau `app-release-apk`
   (unsigned selama secrets keystore belum diisi — lihat langkah 2 di atas untuk membuatnya).

## Catatan teknis penting

- **WAJIB sebelum rilis ke pelanggan pertama**: `LicenseCrypto.kt` masih berisi public key
  placeholder — app akan SELALU menolak aktivasi lisensi (fail-closed, disengaja) sampai
  developer menjalankan `LICENSING_SETUP.md`. Jangan lupa langkah ini atau semua pelanggan
  tidak akan bisa aktivasi.
- **QRIS Otomatis — keterbatasan yang perlu diketahui**: order ID yang dikirim ke Midtrans saat
  checkout (`QrisAutoPaymentViewModel`) adalah ID sementara (`TEMP-<timestamp>`), dibuat SEBELUM
  transaksi final tersimpan ke database (nomor invoice baru dibuat setelah checkout selesai).
  Artinya saat ini belum ada kolom yang menyimpan tautan `order_id Midtrans <-> invoiceNumber`
  di `TransactionEntity` untuk rekonsiliasi laporan keuangan lintas sistem. Cukup aman untuk
  konfirmasi status "Lunas" real-time di kasir (yang sudah berfungsi penuh), tapi kalau butuh
  rekonsiliasi akuntansi formal ke dashboard Midtrans, tambahkan kolom `midtransOrderId` ke
  `TransactionEntity` (migrasi baru) dan alirkan `autoOrderId` dari `PosScreen.kt` ke
  `CheckoutUseCase` sebagai pengembangan lanjutan.
- `minSdk = 26` (Android 8.0+) karena Apache POI (export Excel) memakai
  `java.lang.invoke.MethodHandle` yang baru didukung mulai API 26.
- Workflow CI menggunakan `gradle/actions/setup-gradle` dengan `gradle-version: '8.7'` (bukan
  `./gradlew`) supaya repo tetap ringan tanpa commit `gradle-wrapper.jar` biner.
- `proguard-rules.pro` sudah menyertakan `-dontwarn` untuk dependency opsional Apache POI
  (OSGi, Batik/SVG) yang tidak dipakai di path Android manapun di app ini.
- **Migrasi database resmi**: sejak v10, database TIDAK LAGI pakai `fallbackToDestructiveMigration()`
  untuk upgrade (versi lama sempat memakainya saat masih tahap awal — itu MENGHAPUS seluruh data
  toko setiap skema berubah). Sekarang setiap kenaikan versi WAJIB punya `Migration` eksplisit di
  `Migrations.kt`, didaftarkan di `DatabaseModule.kt`. `fallbackToDestructiveMigrationOnDowngrade()`
  tetap dipakai tapi HANYA untuk skenario downgrade (pasang ulang APK versi lebih lama secara
  tidak sengaja) — aman karena versi skema baru memang tidak mungkin dibaca kode lama.
  `exportSchema = true` mulai v10 (lihat `app/schemas/`) — folder ini WAJIB ikut di-commit ke
  Git, jadi jangan ditambahkan ke `.gitignore`.
- PIN pengguna disimpan sebagai hash **PBKDF2WithHmacSHA256 + salt acak per-user** (120.000
  iterasi, lihat `UserRepository`) — bukan SHA-256 polos. Akun lama dari sebelum v10 yang masih
  memakai skema SHA-256 tanpa salt otomatis di-upgrade ke PBKDF2+salt begitu berhasil login
  sekali. Sesi login bersifat in-memory (`SessionManager`) sehingga aplikasi akan meminta PIN
  lagi setiap kali dibuka ulang selama fitur "Login PIN" aktif di Pengaturan > Pengguna & Login
  PIN.
- **Auto-Lock (`AutoLockManager`)**: selama fitur PIN aktif, sesi otomatis logout (a) begitu
  app kembali dibuka setelah sempat di-background — Home/app-switch/layar mati (tidak bisa
  dimatikan), dan (b) setelah idle beberapa menit di foreground (bisa diatur di Pengaturan >
  Pengguna & Login PIN: mati/1/5/15/30 menit, default 5 menit).
- **Role-based permission ditegakkan** lewat `domain/auth/Permission.kt` sebagai satu sumber
  kebenaran, dicek ulang baik di nav-graph (guard route, fail-closed) maupun di dalam setiap
  fungsi mutasi ViewModel (bukan cuma sembunyi tombol) — termasuk stok opname (admin-only),
  harga beli/margin produk (disembunyikan dari kasir), dan manajemen produk/kategori/varian.
- **Backup terenkripsi**: `BackupRepository` + `BackupCrypto` mengenkripsi file backup dengan
  AES-256-GCM (kunci diturunkan dari password lewat PBKDF2WithHmacSHA256), ekstensi `.posbak`.
  Password wajib diisi saat backup dibuat & saat restore, TIDAK disimpan aplikasi di mana pun.
  Restore tetap mendukung file `.db` mentah dari versi app sebelumnya tanpa password (dideteksi
  lewat isi file, bukan ekstensi nama file).
- Izin runtime yang diminta: Kamera (scan barcode) dan Bluetooth Connect/Scan (Android 12+,
  untuk cetak struk). Printer harus sudah di-pair lewat pengaturan Bluetooth sistem terlebih
  dahulu sebelum mencetak dari app.

## Riwayat audit menyeluruh — bug yang sudah ditemukan & diperbaiki

Setiap baris di bawah ini adalah bug NYATA yang pernah ada di kode (bukan sekadar gaya
penulisan), ditemukan lewat audit ulang menyeluruh, dan sudah diperbaiki di commit terkait.
Ditulis di sini secara terus-menerus (bukan dihapus setelah diperbaiki) supaya pola bug yang
sama tidak diam-diam terulang di fitur baru:

- **Aktivasi lisensi selalu gagal/crash**: client (`LicenseCrypto.kt`) mem-parsing field
  `validUntil` dari payload server, padahal backend (`functions/index.js`) sejak awal didesain
  sekali-bayar dan TIDAK PERNAH mengirim field itu — `JSONException` di setiap aktivasi. Sudah
  diperbaiki dengan menyelaraskan seluruh model lisensi client ke desain sekali-bayar backend
  (lihat bagian "Model Lisensi" di atas).
- **`LicenseSyncWorker` memanggil Cloud Function yang tidak ada** (`revalidateLicense`, sisa
  desain langganan lama) — akan gagal terus-menerus setiap 12 jam selamanya. Diganti dengan
  `checkStatus()` (memanggil `checkLicenseStatus` yang memang ada), fail-open, tidak retry
  paksa.
- **`ReportViewModel.voidTransaction()` & `saveTransactionCorrection()`** (Void transaksi &
  koreksi harga/qty transaksi lama) hanya digerbang di UI (tombol disembunyikan untuk
  non-Admin) — TIDAK diverifikasi ulang di ViewModel, padahal rute "reports" tempat keduanya
  dipanggil memang sengaja bisa diakses Kasir (untuk retur). Sekarang keduanya memanggil
  `Permission.canVoidTransaction` / `Permission.canCorrectTransaction` ulang di ViewModel
  (fail-closed), dikunci regresinya lewat `app/src/test/.../PermissionTest.kt`.
- **Toko bisa terkunci permanen dari Pengaturan sendiri (lockout)**: (a)
  `UserManagementViewModel.deleteUser()` mengizinkan menghapus Admin aktif TERAKHIR sementara
  PIN login aktif — setelah itu tidak ada seorang pun yang bisa membuka rute
  `settings`/`user_management` (admin-only) lagi; (b) `setPinLoginEnabled(true)` hanya
  mensyaratkan "ada minimal 1 user APAPUN role-nya", jadi toko yang baru menambahkan Kasir dulu
  (tanpa Admin) lalu mengaktifkan PIN login langsung terkunci juga. Keduanya sekarang
  mensyaratkan minimal 1 Admin aktif tersisa/tersedia sebelum aksi tersebut diizinkan.
- Route "Produk" & aksi Stok Opname sempat lolos tanpa gerbang permission sama sekali (audit
  2026-09-06) — sudah diperbaiki (`Permission.canManageProducts`,
  `Permission.canPerformStockOpname`).
- `PaymentGatewayRepository` sempat memanggil Cloud Function kredensial gateway tanpa memastikan
  device sign-in ke Firebase Auth dulu — server sekarang mewajibkan `request.auth` terisi
  (`ensureSignedIn()` di client).

### Temuan yang BELUM diperbaiki (rekomendasi untuk iterasi berikutnya)

- `payment_status/{orderId}` di `firestore.rules` bisa dibaca siapa saja yang menebak `orderId`
  (formatnya `TEMP-<timestamp_ms>`, cukup sulit ditebak tapi bukan mustahil dalam jendela waktu
  checkout) — potensi kebocoran info nominal+status transaksi ke pihak luar, bukan risiko uang
  hilang. Perbaikan: tambahkan komponen acak ke order ID, atau batasi read ke `ownerUid` yang
  cocok.
- Iterasi PBKDF2 untuk enkripsi backup (`BackupCrypto`, 120.000) sedikit di bawah rekomendasi
  OWASP terbaru (210.000+) — masih aman untuk saat ini, bisa dinaikkan di migrasi berikutnya.
- Belum ada kolom `midtransOrderId` di `TransactionEntity` untuk rekonsiliasi akuntansi formal
  QRIS Otomatis ke dashboard Midtrans (lihat catatan "QRIS Otomatis — keterbatasan" di bawah).
- Zero test coverage untuk `data/repository/`, `CloudSyncRepository`, dan sebagian besar
  ViewModel — hanya `Permission.kt`, `CheckoutValidator`, `Cart`, `BackupCrypto`, dan
  `QrisUtil` yang punya unit test saat ini.

## Saran fitur — supaya beda jauh dari kompetitor (Moka, Pawoon, Qasir, dll.)

Kompetitor di atas rata-rata sudah punya: kasir dasar, produk, stok, laporan, multi-outlet,
langganan bulanan. Supaya app ini punya alasan kuat dipilih dibanding mereka (bukan cuma
"versi gratis/sekali-bayar dari fitur yang sama"), berikut arah fitur yang **belum umum** di
kelas aplikasi kasir Indonesia:

**Kelas "AI/insight otomatis" (paling membedakan, kompetitor lokal jarang punya ini):**
- **Prediksi stok habis & saran re-order otomatis** — dari histori penjualan per produk,
  proyeksikan "stok Kopi Susu diperkirakan habis 3 hari lagi berdasarkan rata-rata penjualan",
  bukan cuma alert "stok < 5". Bisa dikerjakan offline murni pakai regresi sederhana di Room
  (tidak perlu API AI berbayar).
- **Deteksi anomali kasir** — pola void/koreksi/retur yang tidak wajar dari satu kasir
  (mis. jauh di atas rata-rata rekan-rekannya) otomatis di-flag ke Admin lewat notifikasi,
  bukan cuma tercatat pasif di Log Aktivitas yang harus dibuka manual.
- **Rekomendasi bundling/cross-sell** — "pembeli yang beli Item A juga sering beli Item B",
  dihitung dari `TransactionItemEntity` yang sudah ada, ditampilkan sebagai saran halus di
  Kasir saat checkout (opsional, tidak mengganggu alur cepat kasir).

**Kelas "operasional harian toko kecil" (fitur yang sering diabaikan kompetitor karena mereka
fokus ke toko menengah-besar):**
- **Split bill / bagi struk** — pelanggan bayar patungan, umum di F&B tapi jarang didukung
  aplikasi kasir lokal dengan baik.
- **Mode "Pesanan Terbuka" (open tab / tanda gantung)** — simpan keranjang belum dibayar
  (pelanggan warung/kafe yang bayar belakangan), beda dari "Pesanan Tertunda" biasa karena
  terikat ke nama pelanggan/meja dan bisa ditambah item berkali-kali sebelum ditutup.
  Struktur data mirip `Cart`/`CartLine` yang sudah ada, tinggal ditambah status "OPEN_TAB".
- **Kalkulator harga modal otomatis dari resep (untuk F&B/kue)** — produk racikan (mis. "Kopi
  Susu" dari susu+kopi+gula) yang stok bahan bakunya otomatis berkurang proporsional saat
  produk jadi terjual, dan margin dihitung dari total harga bahan baku, bukan input manual.
  Ini pembeda besar dari kompetitor kelas warung/kafe kecil yang biasanya tidak punya BOM
  (Bill of Materials) sama sekali.
- **Pengingat utang pelanggan otomatis via WhatsApp** — `CustomerRepository` sudah punya
  `DebtPaymentEntity`/loyalty points; tinggal ditambah tombol "Ingatkan via WA" yang membuka
  `wa.me` dengan draft pesan siap kirim (tanpa perlu API WhatsApp Business berbayar).

**Kelas "diferensiasi model bisnis" (langsung dari perubahan lisensi sekali-bayar):**
- Jadikan **"Sekali Bayar, Selamanya"** sebagai jargon pemasaran utama — kompetitor besar
  (Moka, Pawoon, Qasir) semuanya langganan bulanan/tahunan. Halaman aktivasi & Dashboard sudah
  menampilkan pesan ini (lihat perubahan lisensi di atas); tinggal dipertegas di listing
  Play Store/materi promosi.
- **Mode "Toko Offline Total"** sebagai selling point eksplisit — banyak kompetitor
  cloud-based BUTUH internet untuk transaksi dasar; app ini secara arsitektur sudah 100%
  offline-first untuk Kasir/Produk/Stok/Laporan, tinggal dikomunikasikan sebagai keunggulan
  (cocok untuk toko di area sinyal lemah).

## Saran UI/UX — supaya tidak terlihat "UI stok Android"

Yang perlu diketahui dulu: app ini **sudah** menghindari beberapa jebakan umum "terlihat
default Android" — palet warna kustom oranye/navy (bukan ungu Material You bawaan Google),
sudut membulat lebih besar dari default (`Shape.kt`), font kustom via Google Fonts
(Plus Jakarta Sans/Inter/Poppins/Nunito Sans, bisa dipilih pengguna), top bar bermerek dengan
garis aksen (`BrandedTopBar.kt`), dan avatar produk berwarna-warni berbasis kategori
(`ProductVisuals.kt`). Ini levelnya sudah di atas rata-rata aplikasi kasir lokal.

Yang masih bisa dinaikkan supaya makin terasa "produk premium", bukan "Compose default plus
warna":

- **Micro-interaction & motion** — saat ini transisi antar layar kemungkinan masih pakai
  default `NavHost` (fade/slide standar). Tambahkan `AnimatedContent`/shared-element transition
  untuk hal-hal yang sering terjadi: produk masuk keranjang (animasi kecil ke ikon keranjang),
  total harga berubah (angka bergulir/count-up, bukan langsung loncat), checkout sukses
  (animasi checkmark, bukan Toast/Snackbar polos).
- **Empty states & ilustrasi custom** — kondisi "belum ada transaksi hari ini",
  "keranjang kosong", "belum ada produk" biasanya cuma teks polos di app kasir. Ganti dengan
  ilustrasi SVG sederhana bergaya konsisten (bisa satu set ikon custom line-art, bukan Material
  Icons default) — ini salah satu sinyal visual terkuat "produk dirancang", bukan "cukup jalan".
- **Skeleton loading, bukan spinner** — saat data Room/Firestore sedang dimuat (Dashboard,
  Laporan, Sinkronisasi Cloud), tampilkan shimmer/skeleton placeholder berbentuk kartu, bukan
  `CircularProgressIndicator` di tengah layar — standar UI modern (Shopee, Gojek, dll.) yang
  bikin app terasa lebih cepat walau waktu tunggu sama.
- **Bottom navigation bar untuk 4-5 layar inti** — saat ini navigasi utama kemungkinan besar
  lewat Dashboard sebagai hub + tombol-tombol kartu (pola "menu grid" yang umum di app kasir
  generik). Pertimbangkan `NavigationBar` M3 persisten untuk Kasir/Laporan/Stok/Dashboard/Lainnya
  supaya kasir bisa berpindah 1 tap tanpa selalu kembali ke Dashboard dulu — pola ini yang
  membuat app terasa seperti aplikasi konsumen modern (mis. gaya Shopee/Tokopedia Seller),
  bukan aplikasi kasir kantor.
- **Dashboard berbasis kartu metrik dengan grafik mini (sparkline)** — omzet hari ini
  ditampilkan sebagai angka besar + grafik tren 7 hari terakhir dalam satu kartu kecil
  (`recharts`-style sparkline, bisa dibuat manual dengan Canvas Compose), bukan cuma angka
  statis. Ini pola dashboard fintech modern (Jenius, Flip) yang jarang ada di app kasir lokal.
- **Product grid dengan foto lebih dominan** — kalau grid produk Kasir saat ini masih
  text-forward (nama+harga sebagai fokus utama, foto kecil di pojok), pertimbangkan kartu
  produk foto-dominan (foto besar di atas, nama/harga di bawah sebagai overlay gradient) —
  gaya e-commerce yang lebih cepat dikenali mata dibanding daftar berbasis teks, terutama untuk
  toko F&B/retail dengan banyak SKU bervariasi visual.
- **Haptic feedback konsisten** — getaran halus (`HapticFeedback` Compose) di aksi penting:
  tambah ke keranjang, checkout sukses, scan barcode berhasil. Detail kecil tapi sangat terasa
  bedanya di HP modern dibanding app yang sunyi total.
- **Dark mode yang benar-benar dioptimalkan untuk kasir malam hari** — `Theme.kt` sudah
  punya `DarkColors` lengkap; pastikan kontras tombol "Bayar"/total harga tetap sangat tinggi
  di dark mode (warna primary oranye di atas background gelap kadang butuh sedikit
  penyesuaian saturasi supaya tidak terasa "menyala berlebihan" di ruangan gelap).

Semua saran di atas **inkremental** di atas fondasi tema yang sudah ada (`presentation/theme/`)
— tidak perlu redesign total, cukup diterapkan bertahap per layar mulai dari yang paling sering
dilihat kasir (Kasir & Dashboard) baru menyebar ke layar lain.
