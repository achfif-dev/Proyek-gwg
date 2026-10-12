import test from "node:test";
import assert from "node:assert/strict";
import {
  daftarPiutangToko,
  hitungDeltaTagihanLama,
  perubahanTerbayar,
  ringkasPiutangToko,
  ringkasanUangKontrol,
  uangDiterimaBaris,
} from "../src/lib/tagihanLamaHelpers.js";

const KAT = "Piutang Toko/Konsinyasi";
const toko = [
  { id: "T1", nama: "Toko Satu" },
  { id: "T2", nama: "Toko Dua" },
];
const kontrol = [
  { id: "K-lama-1", tokoId: "T1" },
  { id: "K-lama-2", tokoId: "T1" },
  { id: "K-t2", tokoId: "T2" },
];
const hp = (id, o) => ({ id, tipe: "piutang", kategori: KAT, terbayar: 0, ...o });

function ctxDasar() {
  return {
    toko,
    kontrol,
    hutangPiutang: [
      hp("HP2", { pihak: "Toko Satu", nominalAwal: 30000, tanggal: "2026-10-05", sumberKontrolId: "K-lama-2" }),
      hp("HP1", { pihak: "Toko Satu", nominalAwal: 92000, tanggal: "2026-10-01", sumberKontrolId: "K-lama-1" }),
      hp("HPX", { pihak: "Toko Dua", nominalAwal: 50000, tanggal: "2026-10-02", sumberKontrolId: "K-t2" }),
    ],
  };
}

test("daftarPiutangToko: hanya toko itu, urut paling lama dulu", () => {
  const ids = daftarPiutangToko(ctxDasar(), "T1").map((p) => p.id);
  assert.deepEqual(ids, ["HP1", "HP2"]);
});

test("daftarPiutangToko: piutang dari kunjungan ini sendiri dikecualikan", () => {
  const ids = daftarPiutangToko(ctxDasar(), "T1", "K-lama-1").map((p) => p.id);
  assert.deepEqual(ids, ["HP2"]);
});

test("daftarPiutangToko: kontrol asal tidak termuat → cocokkan lewat nama toko; piutang manual lewat pihak", () => {
  const ctx = ctxDasar();
  ctx.kontrol = []; // tahun lain tidak termuat
  ctx.hutangPiutang.push(hp("HPM", { pihak: "Toko Satu", nominalAwal: 1000, tanggal: "2026-09-01" }));
  const ids = daftarPiutangToko(ctx, "T1").map((p) => p.id);
  assert.deepEqual(ids, ["HPM", "HP1", "HP2"]);
  assert.ok(!ids.includes("HPX"));
});

test("alokasi: paling lama dulu, lalu lanjut ke piutang berikutnya", () => {
  const rec = { id: "K-baru", tokoId: "T1", status: "disetujui", tagihanLama: 100000 };
  const r = hitungDeltaTagihanLama(ctxDasar(), rec);
  assert.deepEqual(r.alokasiBaru, [
    { id: "HP1", jumlah: 92000 },
    { id: "HP2", jumlah: 8000 },
  ]);
  assert.equal(r.tidakTeralokasi, 0);
});

test("alokasi: kasus nyata — tagihan 92.000 melunasi sisa kunjungan lalu", () => {
  const rec = { id: "K-baru", tokoId: "T1", status: "disetujui", tagihanLama: 92000 };
  const r = hitungDeltaTagihanLama(ctxDasar(), rec);
  assert.deepEqual(r.alokasiBaru, [{ id: "HP1", jumlah: 92000 }]);
  assert.deepEqual(perubahanTerbayar(ctxDasar().hutangPiutang, r.delta), [{ id: "HP1", terbayar: 92000 }]);
});

test("alokasi: melebihi total piutang → dibatasi, sisanya dilaporkan tidak teralokasi", () => {
  const rec = { id: "K-baru", tokoId: "T1", status: "disetujui", tagihanLama: 200000 };
  const r = hitungDeltaTagihanLama(ctxDasar(), rec);
  assert.equal(r.alokasiBaru.reduce((s, a) => s + a.jumlah, 0), 122000);
  assert.equal(r.tidakTeralokasi, 78000);
});

test("alokasi: tidak menyentuh piutang toko lain", () => {
  const rec = { id: "K-baru", tokoId: "T1", status: "disetujui", tagihanLama: 500000 };
  const r = hitungDeltaTagihanLama(ctxDasar(), rec);
  assert.ok(!("HPX" in r.delta));
});

test("edit: nominal diturunkan → alokasi lama dibalik lalu dihitung ulang (net benar)", () => {
  const ctx = ctxDasar();
  // Sebelumnya 100.000 sudah teralokasi: HP1 92.000 + HP2 8.000
  ctx.hutangPiutang.find((p) => p.id === "HP1").terbayar = 92000;
  ctx.hutangPiutang.find((p) => p.id === "HP2").terbayar = 8000;
  const rec = {
    id: "K-baru",
    tokoId: "T1",
    status: "disetujui",
    tagihanLama: 50000,
    alokasiTagihanLama: [
      { id: "HP1", jumlah: 92000 },
      { id: "HP2", jumlah: 8000 },
    ],
  };
  const r = hitungDeltaTagihanLama(ctx, rec);
  assert.deepEqual(r.alokasiBaru, [{ id: "HP1", jumlah: 50000 }]);
  const hasil = perubahanTerbayar(ctx.hutangPiutang, r.delta);
  assert.deepEqual(hasil.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "HP1", terbayar: 50000 },
    { id: "HP2", terbayar: 0 },
  ]);
});

test("edit: nominal sama → tidak ada perubahan saldo (idempoten)", () => {
  const ctx = ctxDasar();
  ctx.hutangPiutang.find((p) => p.id === "HP1").terbayar = 92000;
  const rec = {
    id: "K-baru",
    tokoId: "T1",
    status: "disetujui",
    tagihanLama: 92000,
    alokasiTagihanLama: [{ id: "HP1", jumlah: 92000 }],
  };
  const r = hitungDeltaTagihanLama(ctx, rec);
  assert.deepEqual(r.alokasiBaru, [{ id: "HP1", jumlah: 92000 }]);
  assert.deepEqual(perubahanTerbayar(ctx.hutangPiutang, r.delta), []);
});

test("hapus: alokasi dibalik penuh, tidak ada alokasi baru", () => {
  const ctx = ctxDasar();
  ctx.hutangPiutang.find((p) => p.id === "HP1").terbayar = 92000;
  const rec = {
    id: "K-baru",
    tokoId: "T1",
    status: "disetujui",
    tagihanLama: 92000,
    alokasiTagihanLama: [{ id: "HP1", jumlah: 92000 }],
  };
  const r = hitungDeltaTagihanLama(ctx, rec, { hapus: true });
  assert.deepEqual(r.alokasiBaru, []);
  assert.deepEqual(perubahanTerbayar(ctx.hutangPiutang, r.delta), [{ id: "HP1", terbayar: 0 }]);
});

test("entri menunggu/ditolak tidak mengalokasikan; kalau sebelumnya ada, dibalik", () => {
  const ctx = ctxDasar();
  ctx.hutangPiutang.find((p) => p.id === "HP1").terbayar = 10000;
  const rec = {
    id: "K-baru",
    tokoId: "T1",
    status: "ditolak",
    tagihanLama: 10000,
    alokasiTagihanLama: [{ id: "HP1", jumlah: 10000 }],
  };
  const r = hitungDeltaTagihanLama(ctx, rec);
  assert.deepEqual(r.alokasiBaru, []);
  assert.deepEqual(perubahanTerbayar(ctx.hutangPiutang, r.delta), [{ id: "HP1", terbayar: 0 }]);
  const menunggu = hitungDeltaTagihanLama(ctxDasar(), { id: "K9", tokoId: "T1", status: "menunggu", tagihanLama: 5000 });
  assert.deepEqual(menunggu.alokasiBaru, []);
});

test("perubahanTerbayar: dijepit 0..nominalAwal dan piutang yang sudah dihapus dilewati", () => {
  const list = [hp("A", { nominalAwal: 1000, terbayar: 200 })];
  assert.deepEqual(perubahanTerbayar(list, { A: -5000 }), [{ id: "A", terbayar: 0 }]);
  assert.deepEqual(perubahanTerbayar(list, { A: 99999 }), [{ id: "A", terbayar: 1000 }]);
  assert.deepEqual(perubahanTerbayar(list, { HILANG: 500 }), []);
});

test("ringkasPiutangToko: alokasi lama record yang diedit tidak mengurangi dirinya sendiri", () => {
  const ctx = ctxDasar();
  ctx.hutangPiutang.find((p) => p.id === "HP1").terbayar = 92000; // lunas oleh record yang sedang diedit
  assert.equal(ringkasPiutangToko(ctx, "T1", "K-baru", []).total, 30000);
  assert.equal(ringkasPiutangToko(ctx, "T1", "K-baru", [{ id: "HP1", jumlah: 92000 }]).total, 122000);
});

test("ringkasanUangKontrol: nominal kosong = pas; setoran kurang = piutang baru; menunggu tidak dihitung", () => {
  const rows = [
    { status: "disetujui", totalRev: 192000, nominalDisetor: 100000 }, // piutang baru 92.000
    { status: "disetujui", totalRev: 40000, nominalDisetor: "" }, // pas
    { status: "disetujui", totalRev: 0, nominalDisetor: "", tagihanLama: 92000 }, // hanya tagihan lama
    { status: "menunggu", totalRev: 999999, nominalDisetor: "" },
    { status: "ditolak", totalRev: 888888, nominalDisetor: "" },
  ];
  const r = ringkasanUangKontrol(rows);
  assert.equal(r.n, 3);
  assert.equal(r.nMenunggu, 1);
  assert.equal(r.nilai, 232000);
  assert.equal(r.diterima, 140000);
  assert.equal(r.piutangBaru, 92000);
  assert.equal(r.tagihanLama, 92000);
  assert.equal(r.total, 232000);
  assert.equal(r.nTagihan, 1);
});

test("ringkasanUangKontrol: entri lama tanpa status dianggap final", () => {
  const r = ringkasanUangKontrol([{ totalRev: 8000 }]);
  assert.equal(r.n, 1);
  assert.equal(r.diterima, 8000);
});

test("uangDiterimaBaris", () => {
  assert.equal(uangDiterimaBaris({ totalRev: 192000, nominalDisetor: 100000 }), 100000);
  assert.equal(uangDiterimaBaris({ totalRev: 8000, nominalDisetor: "" }), 8000);
  assert.equal(uangDiterimaBaris({ totalRev: 8000 }), 8000);
});
