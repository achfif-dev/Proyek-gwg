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

// Simpan snapshot ke cloud dalam SATU tulisan (atomik), lalu pangkas yang
// paling lama (kecuali yang baru ditulis). Daftar kunci diambil lewat
// `fb.shallowKeys` (hanya nama kunci, TANPA mengunduh isi semua snapshot);
// kalau tidak tersedia/gagal, jatuh ke get() biasa.
export async function simpanBackupCloud(fb, snapshot, key, maxBackups = 5) {
  await fb.set(fb.ref(fb.rtdb, `gwg_data/_backups/${key}`), snapshot);
  let keys = null;
  if (typeof fb.shallowKeys === "function") keys = await fb.shallowKeys("gwg_data/_backups");
  if (!Array.isArray(keys)) {
    const semua = (await fb.get(fb.ref(fb.rtdb, "gwg_data/_backups"))).val();
    keys = semua ? Object.keys(semua) : [];
  }
  keys = [...keys].sort();
  const lebih = keys.length - maxBackups;
  if (lebih > 0) {
    const hapus = keys.filter(k => k !== key).slice(0, lebih);
    await Promise.all(hapus.map(k => fb.set(fb.ref(fb.rtdb, `gwg_data/_backups/${k}`), null)));
  }
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
