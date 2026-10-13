// Logika murni (tanpa React/Firebase) untuk status "Aktif" pengguna.
//
// Dulu "Aktif" = ada sesi yang TERHUBUNG (lastActive hanya ditulis sekali saat
// tersambung). Tab/APK yang dibiarkan terbuka di latar belakang tetap terlihat aktif.
// Sekarang tiap sesi mengirim detak (heartbeat) ke lastActive HANYA saat tab terlihat
// dan ada interaksi pengguna; sesi yang detaknya berhenti > idleMs dianggap "Diam"
// (masih terhubung, tapi tidak sedang dipakai).

export const PRESENCE_CONFIG = {
  heartbeatMs: 60 * 1000, // tulis lastActive tiap 1 menit selama dipakai
  idleMs: 5 * 60 * 1000, // tanpa detak > 5 menit → "Diam"
  interaksiMs: 5 * 60 * 1000, // interaksi terakhir lebih lama dari ini → berhenti berdetak
  tickMs: 30 * 1000, // hitung ulang status tiap 30 detik
  minGapMs: 15 * 1000, // jarak minimal antar penulisan lastActive
};

const num = (v) => Number(v);

// Tambahkan `idleMs` (umur detak terakhir) dan `dipakai` ke tiap sesi.
// `serverNow` = jam SERVER (Date.now() + .info/serverTimeOffset), karena lastActive
// ditulis dengan serverTimestamp. lastActive belum terbaca (null) → dianggap baru tersambung.
export function klasifikasiSesi(sessions, serverNow, idleMs = PRESENCE_CONFIG.idleMs) {
  return (sessions || []).map((s) => {
    const la = num(s.lastActive);
    const umur = Number.isFinite(la) && la > 0 ? Math.max(0, serverNow - la) : 0;
    return { ...s, idleMs: umur, dipakai: umur <= idleMs };
  });
}

// Tanda tangan ringkas untuk mendeteksi perubahan yang PERLU render ulang. Detak
// rutin (lastActive naik tapi status tetap "dipakai") tidak mengubahnya, jadi header
// tidak ikut render ulang tiap menit. Sesi diam menyertakan menit-nya karena teks
// "diam N mnt" ikut berubah.
export function signatureSesi(list) {
  return (list || [])
    .map((s) => `${s.sessionId}|${s.email}|${s.nama}|${s.role}|${s.dipakai ? 1 : 0}|${s.dipakai ? "" : Math.floor(s.idleMs / 60000)}`)
    .join(";");
}

// Gabungkan sesi per email (satu akun = satu baris), buang email yang tidak/tidak lagi
// terdaftar di tabel pengguna. Akun "dipakai" kalau minimal satu sesinya dipakai;
// idleMs = umur detak TERBARU di antara sesinya. Urutan: yang dipakai dulu (stabil).
export function kelompokkanPengguna(sessions, registeredEmails) {
  const grouped = new Map();
  (sessions || []).forEach((au) => {
    const key = au.email?.toLowerCase();
    if (!key || !registeredEmails.has(key)) return;
    const ada = grouped.get(key);
    if (ada) {
      ada.sessionCount += 1;
      ada.dipakai = ada.dipakai || !!au.dipakai;
      ada.idleMs = Math.min(ada.idleMs, au.idleMs ?? 0);
    } else {
      grouped.set(key, { ...au, sessionCount: 1, dipakai: !!au.dipakai, idleMs: au.idleMs ?? 0 });
    }
  });
  return [...grouped.values()].sort((a, b) => (b.dipakai ? 1 : 0) - (a.dipakai ? 1 : 0));
}

export function ringkasPresence(grouped) {
  const list = grouped || [];
  return { aktif: list.filter((g) => g.dipakai).length, terhubung: list.length };
}

// "5 mnt", "2 jam", "3 hari" — untuk label "Diam ...".
export function teksDiam(ms) {
  const menit = Math.floor((ms || 0) / 60000);
  if (menit < 1) return "<1 mnt";
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam`;
  return `${Math.floor(jam / 24)} hari`;
}
