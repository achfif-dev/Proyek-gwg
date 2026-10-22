// ─────────────────────────────────────────────────────────────────────
//  BACKUP / RESET / RESTORE — logika murni (tanpa React) supaya bisa diuji.
//
//  Kenapa file ini ada:
//  1) Security rules HANYA memberi izin tulis pada level TERSEMPIT:
//       kontrol/{tahun}/{id}, jurnalUmum/{tahun}/{id}, dan {tabel}/{id} untuk
//       penyesuaian, penarikanToko, penjualanLuar, kasTransaksi, asetAmortisasi,
//       stockOpname, hutangPiutang, gudangTransaksi, pengguna.
//     Versi lama Reset/Restore/Arsip menulis di ROOT tabel atau di level
//     {tahun} → SELALU ditolak PERMISSION_DENIED (Reset hanya menghapus master
//     data lalu meninggalkan kontrol yatim; Restore tidak pernah memulihkan
//     kontrol). Semua penulisan di sini per record.
//  2) Snapshot backup sekarang diambil dari SERVER (bukan dari state React),
//     jadi tidak bisa parsial akibat data yang belum selesai dimuat, dan
//     mencakup SEMUA tahun kontrol (bukan hanya tahun yang sedang "live").
//  3) Kalau salah satu pembacaan gagal, seluruh snapshot dibatalkan —
//     tidak pernah menulis backup parsial.
// ─────────────────────────────────────────────────────────────────────
import { LIST_TABLES, arrToMap, mapToArr, kontrolYearOf } from "./dataHelpers";
import { DB_EMPTY } from "../config/dbEmpty";

const BASE = "gwg_data/shared";

// Klasifikasi tabel menurut level izin tulis di rules.
export const TABEL_PARTISI_TAHUN = ["kontrol", "jurnalUmum"];
export const TABEL_ROOT = ["wilayah", "rute", "toko", "produk"]; // master data — root boleh ditulis Admin/Manajer
export const TABEL_PER_RECORD = [
  "penyesuaian", "penarikanToko", "penjualanLuar", "kasTransaksi", "asetAmortisasi",
  "stockOpname", "hutangPiutang", "gudangTransaksi", "distribusiLog", "tutupBuku",
];
// "pengguna" sengaja TIDAK ada di daftar: tabel akses (siapa boleh apa) tidak
// ikut Reset maupun Restore — memulihkannya dari backup lama bisa mengunci
// Admin yang sekarang, dan menghapusnya membuka celah "akun pertama jadi Admin".
export const TABEL_DIKECUALIKAN = ["pengguna"];

export function semuaTabelTerklasifikasi() {
  const dikenal = new Set([...TABEL_PARTISI_TAHUN, ...TABEL_ROOT, ...TABEL_PER_RECORD, ...TABEL_DIKECUALIKAN]);
  return LIST_TABLES.filter(t => !dikenal.has(t)); // harus kosong; diuji agar tabel baru tidak terlewat
}

const path = (p) => `${BASE}/${p}`;
// Data yang dibaca balik dari RTDB bisa berupa array ATAU peta indeks; samakan.
const keArray = (x) => (Array.isArray(x) ? x : (x && typeof x === "object" ? Object.values(x) : []));
async function baca(fb, p) {
  const snap = await fb.get(fb.ref(fb.rtdb, path(p)));
  return snap.val();
}
async function tulis(fb, p, value) {
  await fb.set(fb.ref(fb.rtdb, path(p)), value === undefined ? null : value);
}

// Jalankan daftar { path, value } berkelompok (tidak menembakkan ribuan set
// sekaligus di sinyal lemah). Mengembalikan daftar kegagalan.
export async function jalankanJobs(fb, jobs, { ukuran = 15 } = {}) {
  const gagal = [];
  for (let i = 0; i < jobs.length; i += ukuran) {
    const kelompok = jobs.slice(i, i + ukuran);
    const hasil = await Promise.allSettled(kelompok.map(j => tulis(fb, j.path, j.value)));
    hasil.forEach((h, k) => {
      if (h.status === "rejected") gagal.push({ path: kelompok[k].path, pesan: h.reason?.message || String(h.reason) });
    });
  }
  return gagal;
}

// { tahun: { id: record } } → [record, ...]. Sisa data format lama (record
// langsung di bawah root tabel) ikut diambil bila bentuknya jelas record.
export function ratakanPartisi(val) {
  const out = [];
  if (!val || typeof val !== "object") return out;
  Object.values(val).forEach(node => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && (node.tanggal || node.tokoId)) { out.push(node); return; }
    Object.values(node).forEach(rec => { if (rec && typeof rec === "object" && rec.id != null) out.push(rec); });
  });
  return out;
}

export function snapshotKosong(data) {
  return ["pengguna", "toko", "kontrol"].every(k => !(data?.[k] || []).length);
}

// ── SNAPSHOT DARI SERVER ────────────────────────────────────────────
export async function ambilSnapshotServer(fb, { termasukJurnal = false } = {}) {
  const data = {};
  for (const key of LIST_TABLES) {
    if (key === "jurnalUmum" && !termasukJurnal) continue;
    const val = await baca(fb, key);
    data[key] = TABEL_PARTISI_TAHUN.includes(key) ? ratakanPartisi(val) : mapToArr(val);
  }
  data.stokAwal = (await baca(fb, "stokAwal")) || {};
  data.bagiHasilConfig = (await baca(fb, "bagiHasilConfig")) ?? null;
  data.daftarAkun = (await baca(fb, "daftarAkun")) ?? null;
  data.saldoAkunBulanan = (await baca(fb, "saldoAkunBulanan")) ?? null;
  return data;
}

// ── SIMPAN BACKUP KE CLOUD — DIPECAH JADI POTONGAN KECIL ─────────────
// Sebelumnya: SATU set() ~9 MB. Di RTDB tulisan diproses berurutan per koneksi,
// jadi tulisan raksasa itu menahan SEMUA input di belakangnya (antrean macet),
// dan tiap putus-sambung mengulangnya dari nol. Sekarang: potongan ≤ ~200 KB,
// dikirim satu per satu (await) dengan jeda singkat, sehingga input pengguna
// bisa menyelip di antara potongan.
// Bentuk data di cloud TETAP SAMA (_backups/{kunci}/data/{tabel}/{indeks}) —
// pembaca lama (daftar backup & restore) tidak perlu diubah.
// Kelengkapan: kunci dikosongkan dulu, metadata (ts, reason, versi, ...) ditulis
// PALING AKHIR. Backup tanpa `ts` = belum lengkap → diabaikan dan dibersihkan.
export const BATAS_POTONGAN_BYTE = 200000;
const tunggu = (ms) => new Promise(r => setTimeout(r, ms));

// Bagi array/objek jadi daftar peta { kunci: nilai } berukuran ≤ batas (perkiraan).
export function bagiPotongan(nilai, batas = BATAS_POTONGAN_BYTE) {
  const entri = Array.isArray(nilai) ? nilai.map((v, i) => [String(i), v]) : Object.entries(nilai || {});
  const hasil = [];
  let cur = {}, ukuran = 0, n = 0;
  for (const [k, v] of entri) {
    if (v === undefined || v === null) continue;
    const u = JSON.stringify(v).length + k.length + 6;
    if (n > 0 && ukuran + u > batas) { hasil.push(cur); cur = {}; ukuran = 0; n = 0; }
    cur[k] = v; ukuran += u; n++;
  }
  if (n > 0) hasil.push(cur);
  return hasil;
}

function denganTimeout(promise, ms, label) {
  let t;
  const batas = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`Backup berhenti: ${label} tidak dibalas server dalam ${Math.round(ms / 1000)} detik`), { code: "backup/timeout" })), ms); });
  return Promise.race([promise, batas]).finally(() => clearTimeout(t));
}

export async function simpanBackupCloud(fb, snapshot, key, maxBackups = 5, { jedaMs = 150, timeoutMs = 90000, batas = BATAS_POTONGAN_BYTE, onProgress } = {}) {
  const { data = {}, ...meta } = snapshot || {};
  const akar = `gwg_data/_backups/${key}`;
  const R = (sub) => fb.ref(fb.rtdb, sub ? `${akar}/${sub}` : akar);

  await denganTimeout(fb.set(R(""), null), timeoutMs, "pengosongan backup");
  let nomor = 0;
  for (const [tabel, nilai] of Object.entries(data)) {
    if (nilai === null || nilai === undefined || typeof nilai !== "object") {
      if (nilai !== null && nilai !== undefined) await denganTimeout(fb.set(R(`data/${tabel}`), nilai), timeoutMs, tabel);
      continue;
    }
    for (const potongan of bagiPotongan(nilai, batas)) {
      await denganTimeout(fb.update(R(`data/${tabel}`), potongan), timeoutMs, `${tabel} (potongan ${nomor + 1})`);
      nomor++;
      if (onProgress) onProgress({ tabel, nomor });
      if (jedaMs) await tunggu(jedaMs);
    }
  }
  const metaBersih = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  await denganTimeout(fb.update(R(""), metaBersih), timeoutMs, "metadata backup");

  // Pangkas: backup tak lengkap (tanpa ts) dihapus; sisanya dipertahankan maxBackups terbaru.
  // Tanpa shallowKeys → lewati (JANGAN mengunduh semua snapshot hanya untuk memangkas).
  const keys = typeof fb.shallowKeys === "function" ? await fb.shallowKeys("gwg_data/_backups") : null;
  if (!Array.isArray(keys)) return;
  const lengkap = [], rusak = [];
  for (const k of [...keys].sort()) {
    if (k === key) { lengkap.push(k); continue; }
    const ts = (await fb.get(fb.ref(fb.rtdb, `gwg_data/_backups/${k}/ts`))).val();
    (ts ? lengkap : rusak).push(k);
  }
  const lebih = lengkap.length - maxBackups;
  const hapus = [...rusak, ...(lebih > 0 ? lengkap.filter(k => k !== key).slice(0, lebih) : [])];
  await Promise.all(hapus.map(k => fb.set(fb.ref(fb.rtdb, `gwg_data/_backups/${k}`), null)));
}

// ── BACA BACKUP DARI CLOUD (hemat: tidak mengunduh semua snapshot) ─────
// Daftar: hanya metadata kecil (ts, reason, ...) per kunci — TANPA isi data.
// Sebelumnya get() seluruh _backups (≈ 9 MB × jumlah backup) tiap menu dibuka.
export async function daftarBackupMeta(fb) {
  const keys = typeof fb.shallowKeys === "function" ? await fb.shallowKeys("gwg_data/_backups") : null;
  if (!Array.isArray(keys)) throw new Error("daftar backup tidak dapat dibaca (koneksi atau izin)");
  const baca = async (k, f) => (await fb.get(fb.ref(fb.rtdb, `gwg_data/_backups/${k}/${f}`))).val();
  const hasil = await Promise.all(keys.map(async (key) => {
    const [ts, reason, jurnalUmumDikecualikan] = await Promise.all([baca(key, "ts"), baca(key, "reason"), baca(key, "jurnalUmumDikecualikan")]);
    return { key, ts, reason, jurnalUmumDikecualikan };
  }));
  return hasil.filter(b => b.ts).sort((a, b) => b.key.localeCompare(a.key)); // tanpa ts = belum lengkap
}

// Isi satu backup, diunduh PER TABEL (berurutan) hanya saat dibutuhkan
// (unduh file / pulihkan). Hasil = bentuk `data` yang sama seperti sebelumnya.
export async function ambilIsiBackup(fb, key, { onProgress } = {}) {
  const dasar = `gwg_data/_backups/${key}/data`;
  const tabel = typeof fb.shallowKeys === "function" ? await fb.shallowKeys(dasar) : null;
  if (!Array.isArray(tabel)) return (await fb.get(fb.ref(fb.rtdb, dasar))).val() || {};
  const data = {};
  for (const t of tabel) {
    data[t] = (await fb.get(fb.ref(fb.rtdb, `${dasar}/${t}`))).val();
    if (onProgress) onProgress(t);
  }
  return data;
}

// ── RESET ───────────────────────────────────────────────────────────
async function jobsHapusPerRecord(fb, tabel) {
  const map = (await baca(fb, tabel)) || {};
  return Object.keys(map).map(id => ({ path: `${tabel}/${id}`, value: null }));
}
async function jobsHapusPartisi(fb, tabel) {
  const val = (await baca(fb, tabel)) || {};
  const jobs = [];
  Object.entries(val).forEach(([tahun, node]) => {
    if (!node || typeof node !== "object") return;
    // node berupa record format lama (bukan peta id→record): tidak ada izin
    // tulis di level itu, lewati (data lama, tidak dijangkau aplikasi).
    if (typeof node.id === "string") return;
    Object.keys(node).forEach(id => jobs.push({ path: `${tabel}/${tahun}/${id}`, value: null }));
  });
  return jobs;
}

// Urutan: data transaksi (anak) → index/saldo/konfigurasi → master data.
// Berhenti bila satu tahap gagal supaya tidak meninggalkan transaksi yatim
// (master terhapus tapi transaksinya masih ada).
export async function jalankanReset(fb) {
  const tahap = [
    ["transaksi", async () => {
      const jobs = [];
      for (const t of ["penyesuaian", "penarikanToko", "penjualanLuar", "kasTransaksi", "asetAmortisasi", "stockOpname", "hutangPiutang", "gudangTransaksi"]) {
        jobs.push(...await jobsHapusPerRecord(fb, t));
      }
      jobs.push(...await jobsHapusPartisi(fb, "kontrol"), ...await jobsHapusPartisi(fb, "jurnalUmum"));
      return jobs;
    }],
    ["index & konfigurasi", async () => {
      const jobs = [];
      for (const idx of ["kontrolYearsIndex", "jurnalYearsIndex"]) {
        Object.keys((await baca(fb, idx)) || {}).forEach(y => jobs.push({ path: `${idx}/${y}`, value: null }));
      }
      const saldo = (await baca(fb, "saldoAkunBulanan")) || {};
      Object.entries(saldo).forEach(([bulan, kodes]) => Object.keys(kodes || {}).forEach(kode => jobs.push({ path: `saldoAkunBulanan/${bulan}/${kode}`, value: null })));
      ["distribusiLog", "tutupBuku", "stokAwal", "bagiHasilConfig", "daftarAkun"].forEach(p => jobs.push({ path: p, value: null }));
      return jobs;
    }],
    ["master data", async () => TABEL_ROOT.map(t => ({ path: t, value: null }))],
  ];
  let dihapus = 0;
  for (const [nama, bangun] of tahap) {
    let jobs;
    try { jobs = await bangun(); } catch (e) { return { ok: false, tahap: nama, gagal: [{ path: `(membaca ${nama})`, pesan: e?.message || String(e) }], dihapus }; }
    const gagal = await jalankanJobs(fb, jobs);
    dihapus += jobs.length - gagal.length;
    if (gagal.length) return { ok: false, tahap: nama, gagal, dihapus };
  }
  return { ok: true, dihapus, gagal: [] };
}

// ── RESTORE ─────────────────────────────────────────────────────────
async function jobsRekonsiliasiPerRecord(fb, tabel, arr) {
  const server = (await baca(fb, tabel)) || {};
  const baru = new Map(keArray(arr).filter(r => r && r.id != null).map(r => [String(r.id), r]));
  const jobs = [];
  baru.forEach((rec, id) => jobs.push({ path: `${tabel}/${id}`, value: rec }));
  Object.keys(server).forEach(id => { if (!baru.has(id)) jobs.push({ path: `${tabel}/${id}`, value: null }); });
  return jobs;
}
async function jobsRekonsiliasiPartisi(fb, tabel, arr) {
  const perTahun = {};
  keArray(arr).forEach(rec => {
    if (!rec || rec.id == null) return;
    const y = kontrolYearOf(rec);
    (perTahun[y] = perTahun[y] || {})[rec.id] = rec;
  });
  const server = (await baca(fb, tabel)) || {};
  const idx = tabel === "kontrol" ? "kontrolYearsIndex" : "jurnalYearsIndex";
  const jobs = [];
  Object.entries(perTahun).forEach(([y, recs]) => {
    Object.entries(recs).forEach(([id, rec]) => jobs.push({ path: `${tabel}/${y}/${id}`, value: rec }));
    const sy = server[y];
    // hanya tahun yang ADA di snapshot yang direkonsiliasi — tahun lain (mis.
    // tahun lama di luar cakupan backup) tidak disentuh
    if (sy && typeof sy === "object" && typeof sy.id !== "string") {
      Object.keys(sy).forEach(id => { if (!(id in recs)) jobs.push({ path: `${tabel}/${y}/${id}`, value: null }); });
    }
    jobs.push({ path: `${idx}/${y}`, value: true });
  });
  return { jobs, tahun: Object.keys(perTahun) };
}

// snapshotData = isi `data` dari backup. Tidak menyentuh tabel "pengguna".
export async function jalankanRestore(fb, snapshotData, { jurnalDisertakan } = {}) {
  const restored = { ...DB_EMPTY, ...(snapshotData || {}) };
  const sertakanJurnal = jurnalDisertakan ?? Object.prototype.hasOwnProperty.call(snapshotData || {}, "jurnalUmum");
  const gagal = [];
  const catat = (nama, e) => gagal.push({ nama, pesan: e?.message || String(e) });
  const jalankan = async (nama, bangun) => {
    try {
      const jobs = await bangun();
      const g = await jalankanJobs(fb, jobs);
      g.forEach(x => gagal.push({ nama, pesan: `${x.path}: ${x.pesan}` }));
    } catch (e) { catat(nama, e); }
  };

  // 1) master data (root tabel), 2) konfigurasi, 3) tabel per record, 4) saldo, 5) partisi tahun
  await jalankan("master data", async () => TABEL_ROOT.map(t => ({ path: t, value: arrToMap(keArray(restored[t])) })));
  await jalankan("konfigurasi", async () => [
    { path: "stokAwal", value: restored.stokAwal || {} },
    { path: "bagiHasilConfig", value: restored.bagiHasilConfig ?? null },
    { path: "daftarAkun", value: restored.daftarAkun || {} },
  ]);
  for (const t of TABEL_PER_RECORD) {
    await jalankan(t, () => jobsRekonsiliasiPerRecord(fb, t, restored[t]));
  }
  await jalankan("saldoAkunBulanan", async () => {
    const baru = restored.saldoAkunBulanan || {};
    const lama = (await baca(fb, "saldoAkunBulanan")) || {};
    const jobs = [];
    new Set([...Object.keys(baru), ...Object.keys(lama)]).forEach(bulan => {
      const kb = baru[bulan] || {}, kl = lama[bulan] || {};
      new Set([...Object.keys(kb), ...Object.keys(kl)]).forEach(kode => jobs.push({ path: `saldoAkunBulanan/${bulan}/${kode}`, value: kb[kode] ?? null }));
    });
    return jobs;
  });
  let tahunKontrol = [];
  await jalankan("kontrol", async () => {
    const { jobs, tahun } = await jobsRekonsiliasiPartisi(fb, "kontrol", restored.kontrol);
    tahunKontrol = tahun;
    return jobs;
  });
  if (sertakanJurnal) {
    await jalankan("jurnalUmum", async () => (await jobsRekonsiliasiPartisi(fb, "jurnalUmum", restored.jurnalUmum)).jobs);
  }
  return { ok: gagal.length === 0, gagal, tahunKontrol };
}
