/**
 * Cloud Functions backend untuk aplikasi Kasir POS ini.
 *
 * INI DIDEPLOY SEKALI OLEH DEVELOPER (bukan per pelanggan) ke SATU proyek Firebase milik
 * developer/platform. Semua toko/pelanggan yang pakai aplikasi ini terhubung ke Cloud Functions
 * yang SAMA, tapi datanya terisolasi per outletId/licenseKey masing-masing lewat Firestore
 * (bukan file konfigurasi terpisah per pelanggan) — jadi developer TIDAK PERNAH perlu build APK
 * khusus atau setting manual per pelanggan. Lihat LICENSING_SETUP.md untuk langkah deploy.
 *
 * Fungsi di sini SENGAJA tidak menyentuh data penjualan/produk pelanggan sama sekali (kecuali
 * `outlet_catalog` yang memang didesain untuk fitur "Cek Stok Semua Cabang" opt-in) — payment
 * gateway hanya meneruskan permintaan charge ke Midtrans pakai kredensial milik toko itu sendiri.
 */

const functions = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const REGION = "asia-southeast2";

// ============================================================================================
// LISENSI — lihat app/src/main/java/.../data/license/LicenseCrypto.kt untuk sisi verifikasi.
// ============================================================================================

/**
 * WAJIB DIISI: private key RSA (PEM, PKCS#8) hasil `node scripts/generate-license-keypair.js`.
 * Simpan sebagai secret Cloud Functions, JANGAN commit ke Git:
 *   firebase functions:secrets:set LICENSE_PRIVATE_KEY
 * lalu tempel isi file private_key.pem saat diminta. Diakses di sini lewat process.env karena
 * secret di-bind ke function lewat `secrets: ["LICENSE_PRIVATE_KEY"]` di bawah.
 */
function getPrivateKey() {
  const key = process.env.LICENSE_PRIVATE_KEY;
  if (!key) {
    throw new HttpsError(
      "failed-precondition",
      "Server belum dikonfigurasi (LICENSE_PRIVATE_KEY kosong). Developer perlu menjalankan " +
        "firebase functions:secrets:set LICENSE_PRIVATE_KEY — lihat LICENSING_SETUP.md."
    );
  }
  return key;
}

/** Urutan field JSON di sini HARUS SAMA PERSIS dengan yang diharapkan LicenseCrypto.kt di app
 * (parsing pakai JSONObject biasa jadi urutan tidak masalah untuk PARSING, tapi HARUS konsisten
 * untuk VERIFIKASI TANDA TANGAN karena signature dihitung dari string JSON persis ini).
 *
 * TIDAK ADA `validUntil` — lisensi aplikasi ini SEKALI BAYAR (bukan langganan), jadi sertifikat
 * aktivasi yang ditandatangani di sini berlaku SELAMANYA untuk kombinasi licenseKey+deviceId
 * tersebut begitu diverifikasi sekali oleh app (lihat LicenseRepository.kt — tidak ada logika
 * kedaluwarsa berbasis waktu sama sekali). Satu-satunya cara sertifikat ini berhenti berlaku
 * adalah developer/penjual menonaktifkan lisensinya (`isActive: false`, lihat
 * `checkLicenseStatus` & `scripts/issue-license.js --deactivate`) — itu pun baru diketahui app
 * saat kebetulan online, TIDAK PERNAH memaksa koneksi internet berkala. */
function buildCanonicalPayload({ licenseKey, deviceId, customerName, plan, issuedAt }) {
  return JSON.stringify({
    licenseKey,
    deviceId,
    customerName,
    plan,
    issuedAt,
  });
}

function signPayload(payloadJson) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payloadJson, "utf8");
  signer.end();
  return signer.sign(getPrivateKey()).toString("base64");
}

/**
 * Dipanggil app saat pengguna menempelkan kode lisensi pertama kali (self-service, lihat
 * LicenseActivationScreen.kt). Dokumen lisensi (licenses/{licenseKey}) dibuat lebih dulu oleh
 * DEVELOPER lewat `node scripts/issue-license.js` setelah pelanggan membayar — bukan dibuat
 * otomatis di sini, supaya tidak ada orang bisa "aktivasi" kode yang belum pernah dijual.
 */
exports.activateLicense = onCall({ region: REGION, secrets: ["LICENSE_PRIVATE_KEY"] }, async (request) => {
  const { licenseKey, deviceId, deviceModel } = request.data || {};
  if (!licenseKey || !deviceId) {
    throw new HttpsError("invalid-argument", "licenseKey dan deviceId wajib diisi.");
  }

  const ref = db.collection("licenses").doc(licenseKey);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Kode lisensi tidak ditemukan.");
    }
    const data = snap.data();
    if (data.isActive === false) {
      throw new HttpsError("failed-precondition", "Lisensi ini sudah dinonaktifkan penjual.");
    }

    const devices = data.devices || {}; // { [deviceId]: { activatedAt, deviceModel } }
    const maxDevices = data.maxDevices || 1;
    const alreadyBound = Object.prototype.hasOwnProperty.call(devices, deviceId);

    if (!alreadyBound && Object.keys(devices).length >= maxDevices) {
      throw new HttpsError(
        "permission-denied",
        `Lisensi ini sudah dipakai di ${Object.keys(devices).length} device (maksimal ${maxDevices}). ` +
          "Hubungi penjual untuk menambah slot device atau melepas device lama."
      );
    }

    devices[deviceId] = { activatedAt: Date.now(), deviceModel: deviceModel || "unknown" };
    tx.update(ref, { devices, lastActivatedAt: Date.now() });
    return data;
  });

  const now = Date.now();
  // TIDAK ADA validUntil di sini — sekali sertifikat ini lolos verifikasi tanda tangan di app,
  // berlaku SELAMANYA (lisensi sekali bayar, bukan langganan). Lihat komentar buildCanonicalPayload.
  const payload = {
    licenseKey,
    deviceId,
    customerName: result.customerName || "-",
    plan: result.plan || "standard",
    issuedAt: now,
  };
  const payloadJson = buildCanonicalPayload(payload);
  return { payload: payloadJson, signature: signPayload(payloadJson) };
});

/** Dipanggil OPSIONAL & OPORTUNISTIK oleh LicenseSyncWorker.kt setiap kebetulan ada internet —
 * BUKAN untuk memperpanjang masa berlaku (tidak ada masa berlaku, lisensi ini permanen begitu
 * aktivasi), tapi HANYA untuk mengecek apakah lisensi sempat dinonaktifkan penjual (refund,
 * chargeback, terbukti bajakan, dst.) sejak aktivasi. Kalau device tidak pernah online lagi
 * setelah aktivasi, lisensinya TETAP AKTIF selamanya di device itu — ini trade-off yang sengaja
 * diambil supaya toko offline-first tidak pernah "terkunci" hanya karena jarang online, sama
 * seperti filosofi fitur lain di app ini. Respons TIDAK ditandatangani (bukan sertifikat baru,
 * cuma live-check boolean) — cukup untuk kasus ini karena penyerang yang bisa memalsukan respons
 * ini juga bisa saja memilih untuk tetap offline selamanya, hasil akhirnya sama saja. */
exports.checkLicenseStatus = onCall({ region: REGION }, async (request) => {
  const { licenseKey, deviceId } = request.data || {};
  if (!licenseKey || !deviceId) {
    throw new HttpsError("invalid-argument", "licenseKey dan deviceId wajib diisi.");
  }
  const snap = await db.collection("licenses").doc(licenseKey).get();
  if (!snap.exists) throw new HttpsError("not-found", "Kode lisensi tidak ditemukan.");
  const data = snap.data();
  const devices = data.devices || {};
  if (!Object.prototype.hasOwnProperty.call(devices, deviceId)) {
    throw new HttpsError("permission-denied", "Device ini belum pernah aktivasi untuk lisensi ini.");
  }
  return { isActive: data.isActive !== false };
});

// ============================================================================================
// PAYMENT GATEWAY (MIDTRANS) — kredensial MILIK TOKO SENDIRI, disimpan server-side saja.
// ============================================================================================

/** Simpan/hapus kredensial Midtrans milik satu outlet. Koleksi `gateway_credentials` TIDAK
 * boleh readable/writable langsung dari client — lihat firestore.rules.
 *
 * TEMUAN KEAMANAN PENTING (ditambahkan saat audit ulang): sebelum ada pengecekan `ownerUid` di
 * bawah, SIAPA PUN yang tahu (atau mendapat lewat cara apa pun — log, screenshot dukungan,
 * dsb.) outletId milik toko lain bisa memanggil fungsi ini dan MENIMPA kredensial Midtrans toko
 * tersebut dengan kredensial milik penyerang — akibatnya semua pembayaran QRIS Otomatis toko
 * korban diam-diam mengalir ke akun Midtrans penyerang. outletId memang UUID v4 (praktis tidak
 * bisa ditebak brute-force), tapi tetap bukan rahasia yang didesain untuk menahan kebocoran
 * (mis. tersimpan di log crash, terlihat di URL, dsb.) — jadi TETAP harus diverifikasi
 * kepemilikannya, bukan cukup mengandalkan "sulit ditebak". Sekarang: percobaan PERTAMA
 * menyimpan kredensial untuk suatu outletId mengikat `ownerUid` (identitas akun anonim Firebase
 * Auth device itu — lihat PaymentGatewayRepository.kt yang sekarang wajib sign-in dulu sebelum
 * memanggil fungsi ini); percobaan berikutnya HANYA diterima kalau `request.auth.uid` sama
 * dengan `ownerUid` yang tersimpan. */
exports.saveGatewayCredentials = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sesi tidak valid, coba lagi setelah pastikan internet aktif.");
  }
  const { outletId, merchantId, serverKey, clientKey, isProduction, clear } = request.data || {};
  if (!outletId) throw new HttpsError("invalid-argument", "outletId wajib diisi.");

  const ref = db.collection("gateway_credentials").doc(outletId);
  const existing = await ref.get();
  if (existing.exists && existing.data().ownerUid && existing.data().ownerUid !== request.auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "outletId ini sudah terhubung ke device/akun lain. Kalau ini toko Anda sendiri dan " +
        "berpindah device, hubungi developer untuk melepas ikatan lama."
    );
  }

  if (clear) {
    await ref.delete().catch(() => {});
    return { ok: true };
  }
  if (!merchantId || !serverKey || !clientKey) {
    throw new HttpsError("invalid-argument", "merchantId, serverKey, clientKey wajib diisi.");
  }
  await ref.set({
    ownerUid: request.auth.uid,
    merchantId,
    serverKey,
    clientKey,
    isProduction: !!isProduction,
    updatedAt: Date.now(),
  });
  return { ok: true };
});

function midtransBaseUrl(isProduction) {
  return isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}

/** Buat charge QRIS dinamis resmi Midtrans untuk satu order. Lihat dokumentasi Midtrans Core API
 * (https://docs.midtrans.com/reference/qris) untuk field response terbaru — sesuaikan parsing
 * `actions` di bawah kalau Midtrans mengubah format responsnya.
 *
 * Sama seperti saveGatewayCredentials di atas: WAJIB `request.auth` dan WAJIB cocok dengan
 * `ownerUid` tersimpan — tanpa ini siapa pun yang tahu outletId toko lain bisa membuat transaksi
 * QRIS atas nama toko tersebut di dashboard Midtrans mereka (bukan mencuri uang langsung karena
 * tetap butuh orang yang benar-benar scan & bayar, tapi bisa dipakai untuk spam/mengacaukan
 * riwayat transaksi toko korban). */
exports.createQrisCharge = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sesi tidak valid, coba lagi setelah pastikan internet aktif.");
  }
  const { outletId, orderId, amount } = request.data || {};
  if (!outletId || !orderId || !amount) {
    throw new HttpsError("invalid-argument", "outletId, orderId, amount wajib diisi.");
  }
  const credSnap = await db.collection("gateway_credentials").doc(outletId).get();
  if (!credSnap.exists) {
    throw new HttpsError("failed-precondition", "Payment gateway belum dihubungkan untuk toko ini.");
  }
  const cred = credSnap.data();
  if (cred.ownerUid && cred.ownerUid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Device ini tidak terhubung dengan outlet tersebut.");
  }
  const auth = Buffer.from(`${cred.serverKey}:`).toString("base64");

  const response = await fetch(`${midtransBaseUrl(cred.isProduction)}/v2/charge`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      payment_type: "qris",
      transaction_details: { order_id: orderId, gross_amount: Math.round(amount) },
      qris: { acquirer: "gopay" },
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new HttpsError("internal", json.status_message || "Midtrans menolak permintaan charge.");
  }

  const qrAction = (json.actions || []).find((a) => a.name === "generate-qr-code");

  // Catat status awal supaya PaymentGatewayRepository.observeChargeStatus langsung punya
  // dokumen untuk didengarkan (dari PENDING), diperbarui lagi oleh webhook di bawah.
  await db.collection("payment_status").doc(orderId).set({
    outletId,
    amount,
    status: "PENDING",
    createdAt: Date.now(),
  });

  return {
    qrisImageUrl: qrAction ? qrAction.url : null,
    qrString: json.qr_string || null,
    expiresAtMillis: Date.now() + 5 * 60 * 1000,
  };
});

/**
 * Webhook HTTP yang didaftarkan di dashboard Midtrans (Settings > Configuration > Payment
 * Notification URL) mengarah ke URL Cloud Function ini. Midtrans POST setiap ada perubahan
 * status transaksi. Endpoint ini publik (tidak pakai onCall) karena dipanggil server Midtrans,
 * bukan dari app — verifikasi keaslian notifikasi lewat `signature_key` (SHA512 dari
 * order_id+status_code+gross_amount+ServerKey, lihat docs.midtrans.com/reference/notification).
 */
exports.midtransNotification = onRequest({ region: REGION }, async (req, res) => {
  try {
    const body = req.body || {};
    const { order_id, status_code, gross_amount, signature_key, transaction_status } = body;
    if (!order_id) return res.status(400).send("missing order_id");

    const statusSnap = await db.collection("payment_status").doc(order_id).get();
    if (!statusSnap.exists) return res.status(404).send("unknown order");
    const outletId = statusSnap.data().outletId;
    const credSnap = await db.collection("gateway_credentials").doc(outletId).get();
    if (!credSnap.exists) return res.status(404).send("unknown outlet");
    const serverKey = credSnap.data().serverKey;

    const expectedSignature = crypto
      .createHash("sha512")
      .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
      .digest("hex");
    if (expectedSignature !== signature_key) {
      return res.status(403).send("invalid signature");
    }

    const mapped =
      transaction_status === "settlement" || transaction_status === "capture"
        ? "SETTLED"
        : transaction_status === "expire"
        ? "EXPIRED"
        : transaction_status === "cancel" || transaction_status === "deny"
        ? "CANCELLED"
        : "PENDING";

    await db.collection("payment_status").doc(order_id).set(
      { status: mapped, updatedAt: Date.now(), rawStatus: transaction_status },
      { merge: true }
    );
    res.status(200).send("ok");
  } catch (e) {
    console.error("midtransNotification error", e);
    res.status(500).send("error");
  }
});
