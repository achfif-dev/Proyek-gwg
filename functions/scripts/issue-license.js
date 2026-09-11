/**
 * Alat bantu developer untuk MENERBITKAN kode lisensi baru setiap ada pelanggan yang membeli
 * aplikasi ini, tanpa perlu buka Firebase Console manual. Jalankan dari folder `functions/`:
 *
 *   node scripts/issue-license.js --customer "Toko Sinar Jaya" --plan standard --devices 1
 *
 * Opsional:
 *   --key POS-XXXX-XXXX-XXXX   (kalau tidak diisi, dibuatkan otomatis & unik)
 *   --release-device <deviceId>  (lepas satu device dari lisensi yang sudah ada, mis. pelanggan
 *                                 ganti HP — tambahkan slot lagi tanpa perlu menaikkan maxDevices)
 *   --deactivate <licenseKey>    (nonaktifkan lisensi, mis. pelanggan berhenti berlangganan)
 *
 * BUTUH: file service account Firebase (Project Settings > Service Accounts > Generate new
 * private key) disimpan sebagai `functions/service-account.json` (sudah otomatis di-.gitignore
 * — JANGAN commit file ini, ini kredensial admin penuh ke proyek Firebase).
 */
const admin = require("firebase-admin");
const path = require("path");
const crypto = require("crypto");

const serviceAccountPath = path.join(__dirname, "..", "service-account.json");
let serviceAccount;
try {
  serviceAccount = require(serviceAccountPath);
} catch (e) {
  console.error(
    "Tidak menemukan functions/service-account.json. Download dari Firebase Console > " +
      "Project Settings > Service Accounts > Generate new private key, simpan dengan nama itu."
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[key] = value;
    }
  }
  return out;
}

function generateLicenseKey() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `POS-${part()}-${part()}-${part()}`;
}

async function main() {
  const args = parseArgs();

  if (args.deactivate) {
    await db.collection("licenses").doc(args.deactivate).update({ isActive: false });
    console.log(`Lisensi ${args.deactivate} dinonaktifkan.`);
    return;
  }

  if (args.key && args["release-device"]) {
    const ref = db.collection("licenses").doc(args.key);
    const snap = await ref.get();
    if (!snap.exists) return console.error("Lisensi tidak ditemukan.");
    const devices = snap.data().devices || {};
    delete devices[args["release-device"]];
    await ref.update({ devices });
    console.log(`Device ${args["release-device"]} dilepas dari lisensi ${args.key}.`);
    return;
  }

  if (!args.customer) {
    console.error("Wajib isi --customer \"Nama Toko\". Lihat komentar di atas file ini untuk contoh.");
    process.exit(1);
  }

  const licenseKey = args.key || generateLicenseKey();
  const plan = args.plan || "standard";
  const maxDevices = parseInt(args.devices || "1", 10);

  await db.collection("licenses").doc(licenseKey).set({
    customerName: args.customer,
    plan,
    maxDevices,
    isActive: true,
    devices: {},
    createdAt: Date.now(),
  });

  console.log("Lisensi berhasil dibuat:");
  console.log("  Kode Lisensi :", licenseKey);
  console.log("  Pelanggan    :", args.customer);
  console.log("  Plan         :", plan);
  console.log("  Maks Device  :", maxDevices);
  console.log("");
  console.log("Kirim kode lisensi di atas ke pelanggan (WhatsApp/email) bersama file APK.");
  console.log("Pelanggan tinggal buka app > tempel kode di layar Aktivasi > selesai.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
