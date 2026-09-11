/**
 * Jalankan SEKALI SAJA oleh developer sebelum rilis pertama:
 *   cd functions && npm install && node scripts-src-not-used-here
 *
 * CARA PAKAI:
 *   node scripts/generate-license-keypair.js
 *
 * Menghasilkan 2 file di folder ini:
 *   - license_private_key.pem  -> JANGAN PERNAH commit ke Git. Upload sebagai secret:
 *       firebase functions:secrets:set LICENSE_PRIVATE_KEY < license_private_key.pem
 *     (atau paste isinya saat diminta interaktif oleh perintah di atas)
 *   - license_public_key_base64.txt -> AMAN dibagikan/dilihat siapa pun. Salin ISI file ini
 *     (satu baris base64, tanpa header/footer -----BEGIN/END-----) ke konstanta
 *     LICENSE_PUBLIC_KEY_BASE64 di:
 *       app/src/main/java/com/example/posapp/data/license/LicenseCrypto.kt
 *
 * Setelah kedua langkah di atas, build ulang & deploy ulang Cloud Functions
 * (`firebase deploy --only functions`), lalu build ulang APK dengan public key baru.
 *
 * PENTING: kalau keypair ini pernah bocor/hilang kendali, generate ulang DAN paksa semua
 * pelanggan aktivasi ulang (public key lama otomatis tidak berlaku lagi begitu APK baru dipasang
 * karena LicenseCrypto akan menolak tanda tangan dari private key lama).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const privatePath = path.join(__dirname, "..", "license_private_key.pem");
const publicPath = path.join(__dirname, "..", "license_public_key_base64.txt");

fs.writeFileSync(privatePath, privateKey, "utf8");

// Ubah PEM public key jadi base64 satu baris (buang header/footer & newline) supaya gampang
// ditempel sebagai konstanta String Kotlin.
const publicKeyBase64 = publicKey
  .replace(/-----BEGIN PUBLIC KEY-----/g, "")
  .replace(/-----END PUBLIC KEY-----/g, "")
  .replace(/\s+/g, "");
fs.writeFileSync(publicPath, publicKeyBase64, "utf8");

console.log("Selesai! 2 file dibuat:");
console.log("  -", privatePath, "(RAHASIA — jangan commit, upload sebagai Cloud Functions secret)");
console.log("  -", publicPath, "(aman — tempel isinya ke LicenseCrypto.kt)");
console.log("");
console.log("Langkah selanjutnya:");
console.log("  1. firebase functions:secrets:set LICENSE_PRIVATE_KEY");
console.log("     (paste isi license_private_key.pem saat diminta, lalu tekan Ctrl+D)");
console.log("  2. Salin isi license_public_key_base64.txt ke LICENSE_PUBLIC_KEY_BASE64");
console.log("     di app/src/main/java/com/example/posapp/data/license/LicenseCrypto.kt");
console.log("  3. firebase deploy --only functions");
console.log("  4. Build ulang APK");
