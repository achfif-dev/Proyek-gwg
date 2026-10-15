// Status sinkronisasi TUNGGAL untuk ikon header. Fungsi murni (mudah dites).
// Urutan prioritas = dari yang paling perlu diketahui pengguna:
//   ditolak server > offline perangkat > putus dari server Firebase > gagal baca
//   > antrean macet > mengirim > memuat awal > memuat latar belakang > OK
// Penting: "OK" hanya ditampilkan bila Firebase BENAR-BENAR terhubung
// (fbConnected === true) — bukan sekadar perangkat punya jaringan.

export const SYNC_STUCK_MS = 45000; // antrean tertunda tanpa kemajuan selama ini = "macet"

const jam = (ms) => (ms ? new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : null);

// Kendala pengiriman terakhir (kode + pesan) untuk ditampilkan saat ikon diketuk —
// supaya penyebab "macet" bisa dibaca langsung dari layar HP.
export function teksKendala(err) {
  if (!err) return "";
  const kode = err.code ? `[${err.code}] ` : "";
  return `\n\nKendala terakhir: ${kode}${err.message || "tidak diketahui"}`;
}

// Kunci pengiriman antrean dengan pengambilalihan: kalau pengiriman sebelumnya
// menggantung lebih lama dari `staleMs` (mis. satu `await` tak pernah selesai),
// pemanggil baru BOLEH mengambil alih — kalau tidak, semua flush berikutnya
// langsung keluar dan antrean macet sampai aplikasi di-refresh.
export function keputusanFlush({ berjalan, mulai, now, staleMs = 90000 }) {
  if (!berjalan) return "mulai";
  return now - mulai > staleMs ? "ambil-alih" : "tunda";
}

export function deriveSyncStatus({
  isOnline = true, fbConnected = null, writeDeniedCount = 0, syncError = null,
  pendingSync = 0, sendProgressAt = null, now = Date.now(),
  syncing = false, dataStillSyncing = false, lastSendOk = null, lastSync = null, sendError = null,
} = {}) {
  const lastSyncMs = lastSync instanceof Date ? lastSync.getTime() : (lastSync || null);

  if (writeDeniedCount > 0) {
    return { key: "ditolak", level: "bad", icon: "ban", spin: false, count: writeDeniedCount,
      label: "ditolak",
      title: `${writeDeniedCount} perubahan DITOLAK server (tidak ada izin) — belum tersimpan di server. Ketuk untuk melihat rinciannya.` };
  }
  if (!isOnline) {
    return { key: "offline", level: "warn", icon: "wifiOff", spin: false, count: pendingSync,
      label: pendingSync > 0 ? "Offline · menunggu" : "Offline · data lokal",
      title: "Perangkat tidak punya koneksi internet — perubahan tersimpan di perangkat ini dan akan terkirim otomatis begitu online kembali." };
  }
  if (fbConnected === false) {
    return { key: "putus", level: "warn", icon: "wifiOff", spin: false, count: pendingSync,
      label: pendingSync > 0 ? "Tak terhubung · menunggu" : "Tak terhubung ke server",
      title: "Perangkat online, tetapi belum tersambung ke server data (sinyal lemah / jaringan tanpa internet). Perubahan tetap aman tersimpan di perangkat dan akan terkirim saat tersambung." };
  }
  if (syncError) {
    return { key: "error", level: "bad", icon: "warning", spin: false, count: 0,
      label: "Gagal sync", title: String(syncError) };
  }
  if (pendingSync > 0) {
    const macet = sendProgressAt != null && now - sendProgressAt > SYNC_STUCK_MS;
    if (macet) {
      const detik = Math.round((now - sendProgressAt) / 1000);
      return { key: "macet", level: "warn", icon: "warning", spin: false, count: pendingSync,
        label: "tertunda · macet",
        title: `${pendingSync} perubahan belum terkirim dan belum ada kemajuan selama ${detik} detik. Sistem terus mencoba tiap 30 detik; data aman di perangkat. Jika berlanjut, periksa sinyal atau muat ulang aplikasi.${teksKendala(sendError)}` };
    }
    return { key: "mengirim", level: "info", icon: "refresh", spin: true, count: pendingSync,
      label: "Mengirim perubahan...",
      title: "Sedang mengirim perubahan yang tersimpan di perangkat ke server." };
  }
  if (syncing) {
    return { key: "memuat", level: "info", icon: "refresh", spin: true, count: 0,
      label: "Sinkronisasi...", title: "Sedang memuat data dari cloud — di jaringan lambat ini bisa makan waktu." };
  }
  if (dataStillSyncing) {
    return { key: "memuat-latar", level: "info", icon: "refresh", spin: true, count: 0,
      label: "Memuat data...", title: "Data masih mengalir di latar belakang — angka di Dashboard/Kontrol bisa masih bertambah." };
  }
  const terima = jam(lastSyncMs), kirim = jam(lastSendOk);
  const terbaru = jam(Math.max(lastSyncMs || 0, lastSendOk || 0) || null);
  return { key: "ok", level: "ok", icon: "cloud", spin: false, count: 0,
    label: terbaru ? `Sinkron ${terbaru}` : "Terhubung",
    title: `Terhubung ke server.${terima ? ` Data terakhir diterima ${terima}.` : ""}${kirim ? ` Perubahan terakhir terkirim ${kirim}.` : ""}` };
}
