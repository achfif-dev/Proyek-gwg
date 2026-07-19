import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { firebaseAuth } from "../firebase/init";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export async function getGoogleDriveAccessToken() {
  if (window.__gwg_gtoken && window.__gwg_gtoken_exp > Date.now()) {
    return window.__gwg_gtoken;
  }
  if (!firebaseAuth) throw new Error("Firebase Auth belum siap.");
  let accessToken;
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle({ scopes: [DRIVE_SCOPE] });
    accessToken = result?.credential?.accessToken;
    if (result?.credential?.idToken) {
      const cred = firebaseAuth.GoogleAuthProvider.credential(result.credential.idToken, result.credential.accessToken);
      await firebaseAuth.signInWithCredential(firebaseAuth.auth, cred).catch(() => {});
    }
  } else {
    const provider = new firebaseAuth.GoogleAuthProvider();
    provider.addScope(DRIVE_SCOPE);
    const result = await firebaseAuth.signInWithPopup(firebaseAuth.auth, provider);
    const cred = firebaseAuth.GoogleAuthProvider.credentialFromResult(result);
    accessToken = cred?.accessToken;
  }
  if (!accessToken) throw new Error("Gagal mendapat access token Google. Pastikan scope Drive sudah diaktifkan di Google Cloud Console.");
  window.__gwg_gtoken = accessToken;
  window.__gwg_gtoken_exp = Date.now() + 55 * 60 * 1000;
  return accessToken;
}

export async function getGDriveAccessToken() {
  return getGoogleDriveAccessToken();
}

// Upload satu file JSON ke Google Drive (multipart upload, Drive API v3).
// Mengembalikan { id, name, webViewLink } file yang baru dibuat.
export async function gdriveUploadJSON(filename, obj, description) {
  const accessToken = await getGDriveAccessToken();
  const content = JSON.stringify(obj, null, 2);
  const metadata = { name: filename, mimeType: "application/json", description };
  const boundary = "gwg_boundary_xyz";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  // String biasa (bukan Blob) — CapacitorHttp (native networking di APK,
  // dipakai supaya fetch() tidak diblokir CORS) tidak menangani body
  // ber-tipe Blob dengan benar saat menyeberang ke sisi native, sehingga
  // isinya bisa rusak dan ditolak Google dengan HTTP 400.
  const multipartBody =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
    delimiter + "Content-Type: application/json\r\n\r\n" + content +
    closeDelimiter;
  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary="${boundary}"` }, body: multipartBody }
  );
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// Unduh isi (bukan hanya metadata) satu file dari Google Drive, by file ID.
export async function gdriveDownloadJSON(fileId) {
  const accessToken = await getGDriveAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Hapus permanen satu file dari Google Drive, by file ID.
export async function gdriveDeleteFile(fileId) {
  const accessToken = await getGDriveAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
}

// Bangun daftar kolom otomatis dari isi record (union semua key yang
// muncul), untuk export CSV/Excel data arsip — bentuk record kontrol tidak
// perlu diketahui persis di sini, cukup ambil semua field yang ada.

export async function getGoogleAccessToken() {
  return getGoogleDriveAccessToken();
}

// Upload satu object sebagai file JSON ke Drive (multipart upload, Drive API v3).
export async function driveUploadJSON(accessToken, filename, obj, description) {
  const content = JSON.stringify(obj, null, 2);
  const metadata = { name: filename, mimeType: "application/json", description };
  const boundary = "gwg_boundary_xyz";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const multipartBody =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
    delimiter + "Content-Type: application/json\r\n\r\n" + content +
    closeDelimiter;
  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary="${boundary}"` },
    body: multipartBody,
  });
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json(); // { id, name, webViewLink }
}

// Unduh isi file JSON dari Drive berdasarkan fileId.
export async function driveDownloadJSON(accessToken, fileId) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — file mungkin sudah dihapus dari Drive.`);
  return resp.json();
}

// Hapus satu file dari Drive berdasarkan fileId.
export async function driveDeleteFile(accessToken, fileId) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok && resp.status !== 404) { // 404 = sudah terhapus, anggap sukses
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
  }
}

