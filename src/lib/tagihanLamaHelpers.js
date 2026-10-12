// Logika murni (tanpa React/Firebase) untuk "Tagihan Lama Diterima" di Kontrol:
// uang yang diterima Sales di sebuah kunjungan untuk MELUNASI piutang toko dari
// kunjungan sebelumnya. Nominalnya otomatis mengurangi saldo piutang di Neraca
// Keuangan → Hutang/Piutang (field `terbayar`), paling lama dulu, dan bisa
// DIBALIK persis kalau kontrolnya diedit/dihapus/ditolak.
//
// Sengaja TIDAK membuat Kas Masuk / jurnal: akuntansi belum dipakai dan Sales
// sering menumpuk uang sampai akhir perjalanan. Hanya `terbayar` yang berubah.

export const KATEGORI_PIUTANG_TOKO = "Piutang Toko/Konsinyasi";

const num = (v) => Number(v) || 0;

// Entri yang belum final (menunggu/ditolak) tidak boleh menahan alokasi.
export function kontrolAktif(rec) {
  return rec?.status !== "menunggu" && rec?.status !== "ditolak";
}

// Piutang toko yang cocok untuk `tokoId`, urut paling lama dulu.
// ctx = { hutangPiutang, toko, kontrol } (array dari db).
// - piutang otomatis (punya sumberKontrolId): toko ditentukan dari kontrol asalnya,
//   kalau kontrol asal tidak termuat (tahun lain) → cocokkan lewat nama toko.
// - piutang manual (tanpa sumberKontrolId): cocokkan lewat nama toko (pihak).
// `excludeKontrolId`: piutang yang lahir dari kunjungan ini sendiri tidak dihitung.
export function daftarPiutangToko(ctx, tokoId, excludeKontrolId) {
  const tokoNama = (ctx.toko || []).find((t) => t.id === tokoId)?.nama;
  const kontrol = ctx.kontrol || [];
  return (ctx.hutangPiutang || [])
    .filter((h) => {
      if (h.tipe !== "piutang" || h.kategori !== KATEGORI_PIUTANG_TOKO) return false;
      if (excludeKontrolId && h.sumberKontrolId === excludeKontrolId) return false;
      if (h.sumberKontrolId) {
        const src = kontrol.find((k) => k.id === h.sumberKontrolId);
        return src ? src.tokoId === tokoId : !!tokoNama && h.pihak === tokoNama;
      }
      return !!tokoNama && h.pihak === tokoNama;
    })
    .sort(
      (a, b) =>
        String(a.tanggal || "").localeCompare(String(b.tanggal || "")) ||
        String(a.id).localeCompare(String(b.id))
    );
}

// Hitung perubahan `terbayar` per piutang untuk satu record kontrol:
// 1) kembalikan alokasi lama (rec.alokasiTagihanLama),
// 2) kecuali `hapus` / entri belum final, alokasikan rec.tagihanLama yang baru.
// Mengembalikan { delta: {piutangId: ±nominal}, alokasiBaru: [{id, jumlah}], tidakTeralokasi }.
export function hitungDeltaTagihanLama(ctx, rec, { hapus = false } = {}) {
  const delta = {};
  const prev = Array.isArray(rec.alokasiTagihanLama) ? rec.alokasiTagihanLama : [];
  prev.forEach((a) => {
    delta[a.id] = (delta[a.id] || 0) - num(a.jumlah);
  });

  const alokasiBaru = [];
  let want = !hapus && kontrolAktif(rec) ? num(rec.tagihanLama) : 0;
  if (want > 0) {
    for (const p of daftarPiutangToko(ctx, rec.tokoId, rec.id)) {
      if (want <= 0) break;
      const terbayarEfektif = Math.max(0, num(p.terbayar) + (delta[p.id] || 0));
      const sisa = Math.max(0, num(p.nominalAwal) - terbayarEfektif);
      if (sisa <= 0) continue;
      const alok = Math.min(sisa, want);
      delta[p.id] = (delta[p.id] || 0) + alok;
      alokasiBaru.push({ id: p.id, jumlah: alok });
      want -= alok;
    }
  }
  return { delta, alokasiBaru, tidakTeralokasi: Math.max(0, want) };
}

// Ubah delta jadi daftar perubahan `terbayar` yang aman (0 ≤ terbayar ≤ nominalAwal).
// Piutang yang sudah dihapus dilewati; yang tidak berubah tidak dikembalikan.
export function perubahanTerbayar(hutangPiutang, delta) {
  const hasil = [];
  Object.entries(delta || {}).forEach(([id, d]) => {
    if (!d) return;
    const p = (hutangPiutang || []).find((h) => h.id === id);
    if (!p) return;
    const lama = num(p.terbayar);
    const baru = Math.max(0, Math.min(lama + d, num(p.nominalAwal)));
    if (baru !== lama) hasil.push({ id, terbayar: baru });
  });
  return hasil;
}

// Total sisa piutang toko yang masih berjalan, memperhitungkan alokasi lama
// record yang sedang diedit (supaya angka di form tidak mengurangi dirinya sendiri).
export function ringkasPiutangToko(ctx, tokoId, kontrolId, alokasiLama) {
  if (!tokoId) return { total: 0, jumlah: 0 };
  const prev = {};
  (alokasiLama || []).forEach((a) => {
    prev[a.id] = (prev[a.id] || 0) + num(a.jumlah);
  });
  let total = 0;
  let jumlah = 0;
  daftarPiutangToko(ctx, tokoId, kontrolId).forEach((p) => {
    const sisa = Math.max(0, num(p.nominalAwal) - Math.max(0, num(p.terbayar) - (prev[p.id] || 0)));
    if (sisa > 0) {
      total += sisa;
      jumlah++;
    }
  });
  return { total, jumlah };
}

// Ringkasan uang untuk daftar kontrol (yang sudah difilter). Entri "menunggu"
// dan "ditolak" tidak dihitung (belum final).
// - diterima: nominal setoran kalau diisi, kalau kosong dianggap pas = nilai penjualan
// - piutangBaru: selisih kalau setoran diisi dan lebih kecil dari nilai penjualan
// - tagihanLama: uang yang diterima untuk melunasi piutang kunjungan sebelumnya
export function ringkasanUangKontrol(rows) {
  const r = { nilai: 0, diterima: 0, piutangBaru: 0, tagihanLama: 0, n: 0, nMenunggu: 0, nTagihan: 0 };
  (rows || []).forEach((k) => {
    if (k.status === "menunggu") r.nMenunggu++;
    if (!kontrolAktif(k)) return;
    r.n++;
    const rev = num(k.totalRev);
    const isi = k.nominalDisetor === "" || k.nominalDisetor == null ? null : num(k.nominalDisetor);
    r.nilai += rev;
    r.diterima += isi == null ? rev : isi;
    if (isi != null && isi < rev) r.piutangBaru += rev - isi;
    const tl = num(k.tagihanLama);
    if (tl > 0) {
      r.tagihanLama += tl;
      r.nTagihan++;
    }
  });
  r.total = r.diterima + r.tagihanLama;
  return r;
}

// Uang diterima satu baris (untuk kolom ekspor).
export function uangDiterimaBaris(k) {
  const rev = num(k.totalRev);
  return k.nominalDisetor === "" || k.nominalDisetor == null ? rev : num(k.nominalDisetor);
}
