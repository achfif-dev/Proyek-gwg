import test from "node:test";
import assert from "node:assert/strict";
import { recalcTokoStok, riwayatKontrolMungkinTersembunyi, setTahunKontrolTidakTerlihat } from "../src/lib/dataHelpers.js";

const produk = [{ id: "P1" }];
const mkDb = (kontrol, penyesuaian, toko) => ({ kontrol, penyesuaian, toko: [toko] });
const jalankan = (db, ...args) => {
  const ditulis = [];
  const hasil = recalcTokoStok(db, produk, "T1", (t, id, u) => ditulis.push(u), ...args);
  return { ditulis, hasil };
};
const adj = [{ id: "PZ1", tokoId: "T1", tanggal: "2027-01-05", jenis: "Tambah", jumlah_P1: 5, status: "disetujui" }];

test.afterEach(() => setTahunKontrolTidakTerlihat([]));

test("kontrol terakhir toko di tahun tak termuat: stok TIDAK ditimpa", () => {
  setTahunKontrolTidakTerlihat(["2026"]);
  const toko = { id: "T1", tanggalMasuk: "2024-03-01", stok_P1: 40 };
  const { ditulis, hasil } = jalankan(mkDb([], adj, toko), undefined, adj);
  assert.equal(ditulis.length, 0);
  assert.equal(hasil?.dilewati, true);
});

test("forceIfEmpty (hapus kontrol terakhir) juga dilewati bila riwayat mungkin tersembunyi", () => {
  setTahunKontrolTidakTerlihat(["2025"]);
  const toko = { id: "T1", tanggalMasuk: "2024-03-01", stok_P1: 40 };
  const { ditulis } = jalankan(mkDb([], [], toko), [], undefined, true);
  assert.equal(ditulis.length, 0);
});

test("toko baru (masuk setelah tahun tak terlihat) tetap dihitung normal", () => {
  setTahunKontrolTidakTerlihat(["2025"]);
  const toko = { id: "T1", tanggalMasuk: "2026-06-01", stok_P1: 0 };
  const { ditulis } = jalankan(mkDb([], adj, toko), undefined, adj);
  assert.deepEqual(ditulis, [{ stok_P1: 5 }]);
});

test("ada kontrol terlihat: dihitung normal walau ada tahun tak termuat", () => {
  setTahunKontrolTidakTerlihat(["2025"]);
  const toko = { id: "T1", tanggalMasuk: "2024-03-01" };
  const k = [{ id: "K1", tokoId: "T1", tanggal: "2026-09-01", stok_P1: 12, status: "disetujui" }];
  const { ditulis } = jalankan(mkDb(k, [], toko));
  assert.deepEqual(ditulis, [{ stok_P1: 12 }]);
});

test("semua tahun termuat: perilaku lama tidak berubah", () => {
  const toko = { id: "T1", tanggalMasuk: "2024-03-01" };
  const { ditulis } = jalankan(mkDb([], adj, toko), undefined, adj);
  assert.deepEqual(ditulis, [{ stok_P1: 5 }]);
});

test("toko tanpa tanggalMasuk dianggap mungkin punya riwayat tersembunyi", () => {
  assert.equal(riwayatKontrolMungkinTersembunyi({ id: "T1" }, ["2020"]), true);
  assert.equal(riwayatKontrolMungkinTersembunyi({ id: "T1" }, []), false);
});
