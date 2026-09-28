// Jalankan: node --import ./tests/register.mjs --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateJurnal, buatEntryJurnal, buatEntryPembalik,
  bangunBarisJurnalKontrol, bangunBarisJurnalPenjualanLuar,
  hitungSaldoAkunTerkini, getNormalBalance, getTipeAkunDariKode,
} from "../src/lib/akuntansiHelpers.js";

const produk = [
  { id: "P1", harga: 50000, hargaModal: 30000, bonus: 0 },
  { id: "P2", harga: 80000, hargaModal: 45000, bonus: 1 },
];
const sumDK = (baris) => ({
  d: baris.reduce((s, b) => s + b.debit, 0),
  k: baris.reduce((s, b) => s + b.kredit, 0),
});

test("validateJurnal: menolak jurnal timpang, <2 baris, negatif, dan debit+kredit sekaligus", () => {
  assert.equal(validateJurnal([{ akun: "1101", debit: 100, kredit: 0 }]).ok, false);
  assert.equal(validateJurnal([{ akun: "1101", debit: 100, kredit: 0 }, { akun: "4101", debit: 0, kredit: 90 }]).ok, false);
  assert.equal(validateJurnal([{ akun: "1101", debit: -5, kredit: 0 }, { akun: "4101", debit: 0, kredit: -5 }]).ok, false);
  assert.equal(validateJurnal([{ akun: "1101", debit: 10, kredit: 10 }, { akun: "4101", debit: 0, kredit: 0 }]).ok, false);
  assert.equal(validateJurnal([{ akun: "1101", debit: 100, kredit: 0 }, { akun: "4101", debit: 0, kredit: 100 }]).ok, true);
});

test("buatEntryJurnal: melempar error untuk jurnal timpang & mengisi bulanKey", () => {
  assert.throws(() => buatEntryJurnal({ tanggal: "2026-09-10", sumberTipe: "kas",
    baris: [{ akun: "1101", debit: 100, kredit: 0 }, { akun: "4101", debit: 0, kredit: 1 }] }));
  const e = buatEntryJurnal({ tanggal: "2026-09-10", sumberTipe: "kas", createdBy: "a@b.com",
    baris: [{ akun: "1101", debit: 100, kredit: 0 }, { akun: "4101", debit: 0, kredit: 100 }] });
  assert.equal(e.bulanKey, "2026-09");
  assert.equal(e.void, false);
  assert.equal(e.createdBy, "a@b.com");
});

test("bangunBarisJurnalKontrol: balance, akun hanya yang ada di whitelist Rules v13 (Sales)", () => {
  const rec = { terjual_P1: 4, terjual_P2: 2, bonusInput_P1: 1, bonusInput_P2: 0 };
  const baris = bangunBarisJurnalKontrol(rec, produk);
  const { d, k } = sumDK(baris);
  assert.equal(d, k);
  assert.ok(baris.length >= 2 && baris.length <= 6, "Rules v13 membatasi 2–6 baris");
  const WHITELIST = new Set(["1101", "1102", "1111", "4101", "4102", "5101", "5103"]);
  baris.forEach(b => assert.ok(WHITELIST.has(b.akun), `akun ${b.akun} tidak ada di whitelist Rules v13`));
  // pendapatan = 4*50000 + 2*80000 = 360000
  assert.equal(baris.find(b => b.akun === "4101").kredit, 360000);
  // HPP = 4*30000 + 2*45000 = 210000 ; bonus = 1*30000 = 30000 ; persediaan berkurang 240000
  assert.equal(baris.find(b => b.akun === "5101").debit, 210000);
  assert.equal(baris.find(b => b.akun === "5103").debit, 30000);
  assert.equal(baris.filter(b => b.akun === "1111").reduce((s, b) => s + b.kredit, 0), 240000);
});

test("bangunBarisJurnalKontrol: kunjungan tanpa penjualan tidak menghasilkan jurnal", () => {
  assert.equal(bangunBarisJurnalKontrol({ bonusInput_P1: 0, bonusInput_P2: 0 }, [{ ...produk[0], bonus: 0 }, { ...produk[1], bonus: 0 }]), null);
});

test("bangunBarisJurnalPenjualanLuar: balance & whitelist", () => {
  const baris = bangunBarisJurnalPenjualanLuar({ terjual_P1: 3, bonusInput_P1: 0, bonusInput_P2: 0 }, produk);
  const { d, k } = sumDK(baris);
  assert.equal(d, k);
  const WHITELIST = new Set(["1101", "1102", "1111", "4101", "4102", "5101", "5103"]);
  baris.forEach(b => assert.ok(WHITELIST.has(b.akun)));
});

test("buatEntryPembalik: membatalkan efek entry asli pada saldo", () => {
  const asli = buatEntryJurnal({ tanggal: "2026-09-10", sumberTipe: "kontrol", sumberId: "K1",
    baris: bangunBarisJurnalKontrol({ terjual_P1: 2, bonusInput_P1: 0, bonusInput_P2: 0 }, produk) });
  const balik = buatEntryPembalik(asli, { keterangan: "batal" });
  assert.equal(balik.tanggal, asli.tanggal, "pembalik memakai tanggal transaksi asli");
  const { saldoAkhir } = hitungSaldoAkunTerkini([asli, balik], {}, null);
  Object.entries(saldoAkhir).forEach(([kode, v]) => assert.equal(v, 0, `akun ${kode} harus nol setelah dibalik`));
});

test("hitungSaldoAkunTerkini: entry void diabaikan; persamaan akuntansi terjaga", () => {
  const j1 = buatEntryJurnal({ tanggal: "2026-09-01", sumberTipe: "kontrol", sumberId: "K1",
    baris: [{ akun: "1102", debit: 1000, kredit: 0 }, { akun: "4101", debit: 0, kredit: 1000 }] });
  const jVoid = { ...buatEntryJurnal({ tanggal: "2026-09-02", sumberTipe: "kontrol", sumberId: "K2",
    baris: [{ akun: "1102", debit: 500, kredit: 0 }, { akun: "4101", debit: 0, kredit: 500 }] }), void: true };
  const { saldoAkhir } = hitungSaldoAkunTerkini([j1, jVoid], {}, null);
  assert.equal(saldoAkhir["1102"], 1000);
  assert.equal(saldoAkhir["4101"], 1000);
});

test("hitungSaldoAkunTerkini: hanya menjumlah entry SETELAH bulan tertutup terakhir", () => {
  const lama = buatEntryJurnal({ tanggal: "2026-08-15", sumberTipe: "kas",
    baris: [{ akun: "1101", debit: 700, kredit: 0 }, { akun: "4102", debit: 0, kredit: 700 }] });
  const baru = buatEntryJurnal({ tanggal: "2026-09-15", sumberTipe: "kas",
    baris: [{ akun: "1101", debit: 300, kredit: 0 }, { akun: "4102", debit: 0, kredit: 300 }] });
  const snapshot = { "2026-08": { "1101": { saldoAkhir: 700 }, "4102": { saldoAkhir: 700 } } };
  const { saldoAkhir, bulanTerakhirTertutup } = hitungSaldoAkunTerkini([lama, baru], snapshot, null);
  assert.equal(bulanTerakhirTertutup, "2026-08");
  assert.equal(saldoAkhir["1101"], 1000); // 700 (snapshot) + 300, entry Agustus tidak dihitung dua kali
});

test("normal balance: akun kontra 1290 kredit; tipe akun dari digit pertama", () => {
  assert.equal(getNormalBalance("1101"), "debit");
  assert.equal(getNormalBalance("1290"), "kredit");
  assert.equal(getNormalBalance("4101"), "kredit");
  assert.equal(getNormalBalance("5101"), "debit");
  assert.equal(getTipeAkunDariKode("2101"), "kewajiban");
  assert.equal(getTipeAkunDariKode("9999"), null);
});
