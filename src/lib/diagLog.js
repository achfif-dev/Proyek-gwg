// Perekam log diagnosa sinkronisasi (ring buffer di memori, tanpa dikirim ke mana pun).
// Tujuan: saat sinkron macet di HP (tanpa akses konsol), pengguna cukup mengetuk ikon
// sinkronisasi → log disalin ke clipboard → ditempel ke chat untuk dianalisis.
//  • catatApp(...)  : peristiwa tingkat-aplikasi (selalu aktif, murah)
//  • aktifkanLogSDK : meneruskan log internal SDK Firebase ("Buffering put",
//    "Reconnecting in", "Websocket connected", ...). Sengaja BARU dinyalakan saat
//    terjadi masalah, karena SDK memformat seluruh data masuk saat log aktif (berat).
const MAKS_BARIS = 900, MAKS_PANJANG = 160;
const baris = [];
let sdkAktif = false;

const cap = () => { const d = new Date(); const p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; };
function tambah(jenis, teks) {
  // Sembunyikan token login (JWT) supaya aman ditempel ke chat.
  let t = String(teks).replace(/eyJ[\w.-]*/g, "[jwt]");
  if (t.length > MAKS_PANJANG) t = t.slice(0, MAKS_PANJANG) + "…";
  baris.push(`${cap()} ${jenis} ${t}`);
  if (baris.length > MAKS_BARIS) baris.splice(0, baris.length - MAKS_BARIS);
}

export function catatApp(...bagian) {
  tambah("APP", bagian.map(b => (typeof b === "string" ? b : JSON.stringify(b))).join(" "));
}

export function aktifkanLogSDK(firebaseDB) {
  if (sdkAktif || !firebaseDB?.enableLogging) return;
  try {
    firebaseDB.enableLogging((m) => tambah("SDK", m));
    sdkAktif = true;
    catatApp("log SDK Firebase diaktifkan");
  } catch (e) { catatApp("gagal mengaktifkan log SDK:", String(e?.message || e)); }
}

// ── Mode diagnosa awal (sementara, selama mencari penyebab macet) ──────────
// SDK_DEFAULT_AKTIF = true → log SDK menyala sejak aplikasi dibuka, supaya
// momen macet terekam. CATATAN: ini menambah beban CPU; ubah ke false setelah
// penyebab ketemu. Bisa dimatikan per-perangkat: localStorage gwg_diag_sdk = "0".
const SDK_DEFAULT_AKTIF = true;
let pemantauBeku = null;
export function mulaiDiagAwal(firebaseDB) {
  let aktif = SDK_DEFAULT_AKTIF;
  try { const v = localStorage.getItem("gwg_diag_sdk"); if (v === "0") aktif = false; else if (v === "1") aktif = true; } catch { /* abaikan */ }
  if (aktif) aktifkanLogSDK(firebaseDB);
  // Pemantau "main thread beku": bila timer 1 dtk terlambat > 1,5 dtk, catat.
  // Menguji dugaan aplikasi membeku ±3 dtk saat sambung ulang (hash cache Firebase).
  if (pemantauBeku || typeof setInterval === "undefined") return;
  let terakhir = Date.now();
  pemantauBeku = setInterval(() => {
    const now = Date.now(), telat = now - terakhir - 1000;
    terakhir = now;
    if (telat > 1500 && (typeof document === "undefined" || document.visibilityState === "visible")) catatApp("main thread BEKU ±", telat, "ms");
  }, 1000);
}

export function ambilLog(ringkasan = "") {
  const kepala = [`GWG diagnosa sinkron — ${new Date().toISOString()}`,
    `online=${typeof navigator !== "undefined" ? navigator.onLine : "?"} visibilitas=${typeof document !== "undefined" ? document.visibilityState : "?"}`,
    typeof navigator !== "undefined" && navigator.connection ? `jaringan=${navigator.connection.effectiveType || "?"} rtt=${navigator.connection.rtt ?? "?"}ms downlink=${navigator.connection.downlink ?? "?"}Mbps` : "",
    ringkasan].filter(Boolean);
  return kepala.join("\n") + "\n---\n" + baris.join("\n");
}

export async function salinLog(ringkasan = "") {
  const teks = ambilLog(ringkasan);
  try { await navigator.clipboard.writeText(teks); return true; } catch { /* coba cara lama */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = teks; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}
export const _jumlahBaris = () => baris.length;
