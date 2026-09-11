# Setup Lisensi Tanpa Terminal (100% lewat browser + GitHub)

Versi `LICENSING_SETUP.md` asli menganggap kamu punya terminal (`firebase functions:secrets:set`,
`node scripts/issue-license.js`, dst). Panduan ini menggantikan SETIAP perintah CLI itu dengan
langkah web: GitHub web UI, tab Actions, dan Google Cloud Console.

Tambahkan 3 file workflow berikut ke folder `.github/workflows/` di repo GitHub kamu (lewat
"Add file > Create new file" di web GitHub — bukan lewat terminal):
- `generate_license_keypair.yml`
- `deploy_license_functions.yml`
- `issue_license.yml`

## Langkah 1 — Firebase project (web)
Ikuti `FIREBASE_SETUP.md` langkah 1-2 (buat proyek, daftarkan app Android, download
`google-services.json`, upload ke folder `app/` lewat web GitHub). Upgrade ke plan **Blaze** di
Firebase Console (klik nama proyek > Upgrade) — semua lewat browser.

## Langkah 2 — Generate keypair RSA
Tab **Actions** di GitHub > pilih workflow **"Generate License Keypair"** > **Run workflow**.
Setelah selesai, buka run itu > lihat **Summary** — di sana ada:
- Public key → copy, tempel ke `LicenseCrypto.kt` (edit file itu langsung di web GitHub, ganti
  `LICENSE_PUBLIC_KEY_BASE64`), commit.
- Private key (PEM lengkap) → JANGAN commit. Lanjut ke Langkah 3.

## Langkah 3 — Simpan private key sebagai secret (Google Cloud Console, bukan CLI)
1. Buka [console.cloud.google.com](https://console.cloud.google.com), pilih project yang SAMA
   dengan project Firebase kamu (nama project sama).
2. Menu kiri > **Security > Secret Manager** > **Create Secret**.
3. Secret ID: `LICENSE_PRIVATE_KEY`. Secret value: paste isi PEM dari Summary Langkah 2 (apa
   adanya, termasuk baris `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`). Create.
4. Buka secret yang baru dibuat > tab **Permissions** > **Grant Access**. Principal: akun service
   default Cloud Functions gen2 kamu — biasanya `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`
   (lihat Project Settings > General di Firebase Console untuk Project Number). Role: **Secret
   Manager Secret Accessor**. Save.

Sekarang hapus run workflow di Langkah 2 dari tab Actions (private key tidak boleh nyangkut di
log lebih lama dari perlu).

## Langkah 4 — Service account untuk deploy & terbitkan lisensi
1. Firebase Console > ikon gerigi > **Project Settings > Service Accounts**.
2. **Generate new private key** → download file `.json`.
3. Buka file itu dengan text editor apa pun (Notepad/TextEdit), select all, copy SELURUH isinya.
4. Di GitHub: repo > **Settings > Secrets and variables > Actions > New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT_JSON`, Value: paste isi file JSON tadi apa adanya. Add secret.
   - Name: `FIREBASE_PROJECT_ID`, Value: Project ID kamu (Project Settings > General > Project ID,
     BUKAN nama tampilan). Add secret.

File `.json` di komputer kamu boleh dihapus setelah ini — jangan pernah upload/commit ke Git.

## Langkah 5 — Deploy Cloud Functions
Tab **Actions** > **"Deploy Functions Lisensi & Payment Gateway"** > **Run workflow**. Tunggu
sampai hijau. Ini menggantikan `firebase deploy --only functions,firestore:rules`.

## Langkah 6 — Terbitkan lisensi tiap ada pelanggan baru
Tab **Actions** > **"Terbitkan / Kelola Lisensi Pelanggan"** > **Run workflow**. Isi form:
- `action`: `issue`, `customer`: nama toko, `plan`: standard/pro, `devices`: jumlah HP diizinkan.

Jalankan, tunggu selesai, buka run > **Summary** → kode lisensi (`POS-XXXX-XXXX-XXXX`) muncul di
sana. Kirim kode itu + APK ke pelanggan.

Untuk pelanggan ganti HP (`release-device`) atau berhenti berlangganan (`deactivate`), jalankan
workflow yang sama dengan `action` yang sesuai — semuanya lewat form di tab Actions, tanpa
mengetik satu perintah pun.

## Ringkasan pemetaan CLI → web
| Perintah di LICENSING_SETUP.md asli | Pengganti tanpa terminal |
|---|---|
| `node scripts/generate-license-keypair.js` | Run workflow "Generate License Keypair" |
| `firebase functions:secrets:set LICENSE_PRIVATE_KEY` | Google Cloud Console > Secret Manager |
| `firebase deploy --only functions,firestore:rules` | Run workflow "Deploy Functions Lisensi & Payment Gateway" |
| `node scripts/issue-license.js --customer ...` | Run workflow "Terbitkan / Kelola Lisensi Pelanggan" |
