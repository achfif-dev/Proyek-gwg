import React, { useMemo, useState } from "react";
import { Btn, Card, Modal, StatCard, Table } from "../../components/ui";
import { fmt, fmtRp, genUniqueId } from "../../lib/format";
import { T } from "../../theme/tokens";
import { Icon } from "../../theme/icons.jsx";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  hitungSaldoKas, hitungStokSistem, hitungAmortisasiPeriode, statusAsetSaatIni,
  ringkasanHutangPiutang, hitungHppPeriode, bulanKeyOf, isPeriodeTerkunci,
  hitungStokGudang, nilaiPersediaanGabungan, hitungDanaCadanganKumulatif,
  KATEGORI_KAS_MASUK, KATEGORI_KAS_KELUAR, KATEGORI_ASET, KATEGORI_HUTANG, KATEGORI_PIUTANG,
  KATEGORI_GUDANG_MASUK, KATEGORI_GUDANG_KELUAR, migrasiBebanUsahaLama,
} from "../../lib/neracaHelpers";
import { bangunBarisJurnalKas, bangunBarisJurnalAsetPerolehan, bangunBarisJurnalAmortisasi, bangunBarisJurnalHutangPiutangAwal, bangunBarisJurnalPelunasanHutangPiutang, bangunBarisJurnalApropriasiDanaCadangan, bangunBarisJurnalAkrualBebanUsaha, bangunBarisJurnalPengakuanBagiHasil, bulanSebelumnya, hitungSnapshotSaldoAkun, hitungSaldoAkunTerkini, ringkasanSaldoAkunPerTipe, getTipeAkunDariKode, getNormalBalance, DEFAULT_DAFTAR_AKUN } from "../../lib/akuntansiHelpers";

const todayStr = () => new Date().toISOString().slice(0, 10);

export function NeracaKeuangan({ db, save, addRecord, updateRecord, deleteRecord, config, saveConfig, akuntansi, revPeriode, periodeMode, PERIODE_LABELS, bounds, analytics, totalArsipPcsTerjual, recalcArchivedYearAgregat, postJurnal, voidJurnal, createdBy }) {
  // ✅ FIX: sebelumnya pakai useState biasa, jadi tiap refresh (tombol
  // header/APK maupun reload browser) sub-bagian Neraca (Ringkasan/Kas/Stok/
  // Amortisasi) selalu balik ke "ringkasan" walau user sedang di bagian lain
  // — beda dari tab-tab lain yang semuanya sudah pakai usePersistedState.
  // Disamakan di sini supaya ikut tersimpan & pulih setelah refresh.
  const [section, setSection] = usePersistedState("neraca.section", "ringkasan"); // ringkasan | kas | stok | amortisasi

  const produkArr = db.produk || [];
  const tokoArr = db.toko || [];
  const kasArr = db.kasTransaksi || [];
  const stockOpnameArr = db.stockOpname || [];
  const asetArr = db.asetAmortisasi || [];
  const tutupBukuArr = db.tutupBuku || [];

  // Cek apakah tanggal tertentu berada di bulan yang sudah "ditutup buku" —
  // kalau ya, batalkan aksi & kasih tahu user. Dipanggil di awal tiap fungsi
  // submit/hapus untuk Kas, Stock Opname, & Hutang/Piutang.
  function cekKunci(dateStr) {
    if (isPeriodeTerkunci(tutupBukuArr, dateStr)) {
      alert(`Periode ${bulanKeyOf(dateStr)} sudah ditutup buku (terkunci). Buka kunci dulu di sub-bagian "Tutup Buku" kalau memang perlu diubah.`);
      return true;
    }
    return false;
  }

  // ── Rasio Keuangan ──────────────────────────────────────────────
  const bopoPct = akuntansi.pendapatan > 0 ? (akuntansi.totalBiaya / akuntansi.pendapatan) * 100 : 0;
  const modalDisetor = Number(config.modalDisetor) || 0;
  const roePeriodePct = modalDisetor > 0 ? (akuntansi.labaBersihFinal / modalDisetor) * 100 : null;
  const roeSetahunPct = roePeriodePct !== null && periodeMode === "bulanan" ? roePeriodePct * 12 : null;
  const hppPeriode = useMemo(() => hitungHppPeriode(revPeriode, produkArr), [revPeriode, produkArr]);

  // ── Kas ──────────────────────────────────────────────────────────
  const kasLedgerTerkini = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, null), [kasArr, config.kasSaldoAwal]);
  const kasLedgerPeriode = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, bounds?.end), [kasArr, config.kasSaldoAwal, bounds]);
  const kasRowsDesc = useMemo(() => [...kasLedgerTerkini.rows].reverse(), [kasLedgerTerkini]);
  const [kasForm, setKasForm] = useState(null); // null=tertutup, {} object=form terbuka
  const [opnameFisik, setOpnameFisik] = useState(() => config.kasOpname?.saldoFisik ?? "");
  const [opnameKet, setOpnameKet] = useState(() => config.kasOpname?.keterangan ?? "");
  const selisihKas = opnameFisik === "" ? null : (Number(opnameFisik) || 0) - kasLedgerTerkini.saldoAkhir;

  // Cari entry jurnal AKTIF (belum void) yang sumbernya 1 record kasTransaksi
  // tertentu — dipakai submitKas (edit) & hapusKas (hapus) untuk membatalkan
  // jurnal lama sebelum memposting yang baru / setelah record dihapus.
  // ✅ FIX (konsisten dengan jurnalAktifSumber di bawah — sama-sama untuk
  // mencegah entry pembalik ikut dibalik ulang secara berantai):
  function jurnalAktifUntukKas(kasId) {
    return (db.jurnalUmum || []).filter(j => j.sumberTipe === "kasTransaksi" && j.sumberId === kasId && !j.void && !j.isPembalik);
  }

  // Posting/repost jurnal untuk 1 record Kas. Kalau gagal (mis. kategori
  // belum dipetakan di bangunBarisJurnalKas, atau daftarAkun belum diseed),
  // TIDAK membatalkan penyimpanan kasTransaksi-nya sendiri — cuma
  // menampilkan peringatan, supaya pencatatan Kas (fitur yang sudah lama
  // dipakai) tidak pernah terhambat oleh fitur akuntansi baru yang masih
  // Fase 2. Admin bisa diminta memposting ulang manual nanti kalau perlu.
  function postingJurnalKasAman(kasRecord) {
    if (!postJurnal) return; // prop belum diteruskan (versi lama App.jsx) — lewati diam-diam
    try {
      // ✅ FIX Bug #2 (audit): kalau record Kas ini adalah hasil auto-link
      // dari pelunasan Hutang/Piutang (submitBayar), PAKAI akun spesifik
      // kategori hutang/piutangnya (bangunBarisJurnalPelunasanHutangPiutang)
      // — BUKAN pemetaan generik bangunBarisJurnalKas — supaya tetap
      // konsisten walau record Kas-nya diedit ulang lewat tab Kas Opname
      // biasa. Kalau record Hutang/Piutang asalnya sudah dihapus, baru
      // fallback ke pemetaan generik (dengan peringatan eksplisit).
      const hp = kasRecord.hutangPiutangId ? hutangPiutangArr.find(h => h.id === kasRecord.hutangPiutangId) : null;
      let baris;
      if (kasRecord.hutangPiutangId && !hp) {
        console.warn("Record Hutang/Piutang asal sudah dihapus — jurnal Kas ini pakai pemetaan generik.");
        baris = bangunBarisJurnalKas(kasRecord);
      } else if (hp) {
        baris = bangunBarisJurnalPelunasanHutangPiutang(hp, kasRecord.nominal);
      } else {
        baris = bangunBarisJurnalKas(kasRecord);
      }
      postJurnal({ tanggal: kasRecord.tanggal, sumberTipe: "kasTransaksi", sumberId: kasRecord.id,
        keterangan: kasRecord.keterangan || kasRecord.kategori, baris, createdBy });
    } catch (e) {
      console.warn("Gagal memposting jurnal Kas (data Kas tetap tersimpan):", e);
      alert(`Catatan Kas tersimpan, TAPI jurnal akuntansinya gagal diposting: ${e.message}\n\nHubungi admin teknis untuk posting manual kalau perlu.`);
    }
  }

  // ✅ FIX Bug #2 (audit): sesuaikan field `terbayar` pada record
  // Hutang/Piutang yang terhubung, supaya tetap sinkron kalau nominal kas
  // hasil auto-link diedit atau kas-nya dihapus. `delta` positif = nominal
  // pelunasan bertambah (terbayar naik), negatif = berkurang/dihapus.
  // Diklem ke rentang [0, nominalAwal] supaya tidak pernah keluar batas
  // wajar walau ada urutan edit yang aneh.
  function sesuaikanTerbayarHp(hutangPiutangId, delta) {
    if (!hutangPiutangId || !delta) return;
    const hp = hutangPiutangArr.find(h => h.id === hutangPiutangId);
    if (!hp) return; // record asal sudah dihapus — tidak ada yang bisa disesuaikan
    const terbayarBaru = Math.max(0, Math.min((Number(hp.terbayar) || 0) + delta, hp.nominalAwal));
    updateRecord("hutangPiutang", hp.id, { terbayar: terbayarBaru });
  }

  function submitKas() {
    if (!kasForm.tanggal || !kasForm.kategori || !Number(kasForm.nominal)) return alert("Tanggal, kategori, & nominal wajib diisi");
    if (cekKunci(kasForm.tanggal)) return;
    // ✅ bulanKey ("YYYY-MM") dikirim eksplisit di setiap record — dipakai
    // Firebase Rules untuk menegakkan kunci Tutup Buku di level database
    // (bukan cuma cekKunci() di JS ini, yang bisa dilewati device/versi app
    // lama). Rules tidak punya .substring(), makanya field turunan ini yang
    // dicocokkan lewat beginsWith().
    const rec = { ...kasForm, nominal: Number(kasForm.nominal), bulanKey: bulanKeyOf(kasForm.tanggal) };
    if (kasForm.id) {
      // Edit: batalkan (void) jurnal lama dulu, baru posting jurnal baru
      // dengan angka/kategori yang sudah diubah — supaya saldo akun tetap
      // benar dan audit trail tetap utuh (jurnal lama tidak dihapus, cuma
      // ditandai void + dibalik).
      const rowLama = kasArr.find(k => k.id === kasForm.id);
      if (voidJurnal) jurnalAktifUntukKas(kasForm.id).forEach(j => voidJurnal(j.id, { alasan: "Kas diedit", createdBy }));
      updateRecord("kasTransaksi", kasForm.id, rec);
      postingJurnalKasAman({ ...rec, id: kasForm.id });
      // ✅ FIX Bug #2 (audit): kalau record ini auto-link dari Hutang/
      // Piutang, sesuaikan `terbayar` di record asalnya sebesar SELISIH
      // nominal lama→baru, supaya saldo outstanding tetap sinkron dengan
      // Kas walau nominalnya diedit dari tab Kas Opname.
      if (rec.hutangPiutangId && rowLama) {
        const delta = rec.nominal - (Number(rowLama.nominal) || 0);
        if (delta) sesuaikanTerbayarHp(rec.hutangPiutangId, delta);
      }
    } else {
      const id = genUniqueId("KAS");
      addRecord("kasTransaksi", { ...rec, id });
      postingJurnalKasAman({ ...rec, id });
    }
    setKasForm(null);
  }
  function hapusKas(id) {
    const row = kasArr.find(k => k.id === id);
    if (row && cekKunci(row.tanggal)) return;
    if (voidJurnal) jurnalAktifUntukKas(id).forEach(j => voidJurnal(j.id, { alasan: "Kas dihapus", createdBy }));
    // ✅ FIX Bug #2 (audit): kalau record ini auto-link dari Hutang/Piutang,
    // kurangi `terbayar` di record asalnya sebesar nominal yang dihapus —
    // supaya saldo outstanding Hutang/Piutang tidak "menganggap" pelunasan
    // ini masih berlaku padahal Kas-nya sudah hilang.
    if (row?.hutangPiutangId) sesuaikanTerbayarHp(row.hutangPiutangId, -(Number(row.nominal) || 0));
    deleteRecord("kasTransaksi", id);
  }
  function simpanOpnameKas() {
    saveConfig({ ...config, kasOpname: { saldoFisik: Number(opnameFisik) || 0, keterangan: opnameKet, tanggal: todayStr() } });
  }

  // ── Stock Opname ─────────────────────────────────────────────────
  const stokSistemMap = useMemo(() => hitungStokSistem(tokoArr, produkArr), [tokoArr, produkArr]);
  const [opnameStokForm, setOpnameStokForm] = useState(null); // null=tertutup, {} = terbuka
  const [detailOpnameStok, setDetailOpnameStok] = useState(null);

  function bukaOpnameStokBaru() {
    const items = produkArr.filter(p => p.aktif !== false).map(p => ({
      produkId: p.id, nama: p.nama, stokSistem: stokSistemMap[p.id] || 0, stokFisik: stokSistemMap[p.id] || 0,
    }));
    setOpnameStokForm({ tanggal: todayStr(), keterangan: "", items });
  }
  function submitOpnameStok() {
    if (cekKunci(opnameStokForm.tanggal)) return;
    const items = opnameStokForm.items.map(it => ({ ...it, stokFisik: Number(it.stokFisik) || 0 }));
    const totalSelisihPcs = items.reduce((s, it) => s + (it.stokFisik - it.stokSistem), 0);
    const totalSelisihRp = items.reduce((s, it) => {
      const p = produkArr.find(pp => pp.id === it.produkId);
      return s + (it.stokFisik - it.stokSistem) * (p?.harga || 0);
    }, 0);
    addRecord("stockOpname", { id: genUniqueId("SO"), tanggal: opnameStokForm.tanggal, bulanKey: bulanKeyOf(opnameStokForm.tanggal), keterangan: opnameStokForm.keterangan, items, totalSelisihPcs, totalSelisihRp });
    setOpnameStokForm(null);
  }
  function submitEditOpnameStok() {
    if (cekKunci(detailOpnameStok.tanggal)) return;
    const items = detailOpnameStok.items.map(it => ({ ...it, stokFisik: Number(it.stokFisik) || 0 }));
    const totalSelisihPcs = items.reduce((s, it) => s + (it.stokFisik - it.stokSistem), 0);
    const totalSelisihRp = items.reduce((s, it) => {
      const p = produkArr.find(pp => pp.id === it.produkId);
      return s + (it.stokFisik - it.stokSistem) * (p?.harga || 0);
    }, 0);
    updateRecord("stockOpname", detailOpnameStok.id, { tanggal: detailOpnameStok.tanggal, bulanKey: bulanKeyOf(detailOpnameStok.tanggal), keterangan: detailOpnameStok.keterangan, items, totalSelisihPcs, totalSelisihRp });
    setDetailOpnameStok(null);
  }
  function hapusStockOpname(id) {
    const row = stockOpnameArr.find(o => o.id === id);
    if (row && cekKunci(row.tanggal)) return;
    deleteRecord("stockOpname", id);
  }

  // ── Gudang Pusat ─────────────────────────────────────────────────
  const gudangArr = db.gudangTransaksi || [];
  const stokGudangMap = useMemo(() => hitungStokGudang(gudangArr, produkArr), [gudangArr, produkArr]);
  const [gudangForm, setGudangForm] = useState(null);
  function submitGudang() {
    if (!gudangForm.tanggal || !gudangForm.produkId || !Number(gudangForm.qty)) return alert("Tanggal, Produk, & Jumlah wajib diisi");
    if (cekKunci(gudangForm.tanggal)) return;
    const rec = { ...gudangForm, qty: Number(gudangForm.qty), bulanKey: bulanKeyOf(gudangForm.tanggal) };
    if (gudangForm.id) updateRecord("gudangTransaksi", gudangForm.id, rec);
    else addRecord("gudangTransaksi", { ...rec, id: genUniqueId("GDG") });
    setGudangForm(null);
  }
  function hapusGudang(id) {
    const row = gudangArr.find(g => g.id === id);
    if (row && cekKunci(row.tanggal)) return;
    deleteRecord("gudangTransaksi", id);
  }

  // ── Hutang / Piutang ─────────────────────────────────────────────
  const hutangPiutangArr = db.hutangPiutang || [];
  const ringkasanHutang = useMemo(() => ringkasanHutangPiutang(hutangPiutangArr, "hutang"), [hutangPiutangArr]);
  const ringkasanPiutang = useMemo(() => ringkasanHutangPiutang(hutangPiutangArr, "piutang"), [hutangPiutangArr]);
  const [hpForm, setHpForm] = useState(null); // form tambah/edit hutang-piutang
  const [hpTipeAktif, setHpTipeAktif] = useState("hutang"); // tab kecil: hutang | piutang
  const [bayarForm, setBayarForm] = useState(null); // { row, nominal }

  function submitHp() {
    if (!hpForm.pihak || !Number(hpForm.nominalAwal) || !hpForm.tanggal) return alert("Nama Pihak, Nominal, & Tanggal wajib diisi");
    if (cekKunci(hpForm.tanggal)) return;
    const rec = { ...hpForm, nominalAwal: Number(hpForm.nominalAwal), terbayar: Number(hpForm.terbayar) || 0, bulanKey: bulanKeyOf(hpForm.tanggal) };
    const id = hpForm.id || genUniqueId(hpForm.tipe === "hutang" ? "HTG" : "PIU");
    if (hpForm.id) updateRecord("hutangPiutang", hpForm.id, rec);
    else addRecord("hutangPiutang", { ...rec, id });
    // Posting/repost jurnal pengakuan AWAL — void dulu kalau edit (mis.
    // nominalAwal/kategori diubah), lalu posting ulang dari data terbaru.
    // Untuk kategori "Piutang Toko/Konsinyasi", bangunBarisJurnalHutangPiutangAwal
    // sengaja mengembalikan null (sudah diposting via Kontrol, Fase 3) —
    // jadi tidak ada apa pun yang diposting di sini untuk kategori itu.
    voidJurnalSumberAman("hutangPiutang", id, "Hutang/Piutang diedit — jurnal pengakuan awal diposting ulang");
    if (postJurnal) {
      try {
        const baris = bangunBarisJurnalHutangPiutangAwal({ ...rec, id });
        if (baris) postJurnal({ tanggal: rec.tanggal, sumberTipe: "hutangPiutang", sumberId: id,
          keterangan: `Pengakuan ${rec.tipe === "hutang" ? "Hutang" : "Piutang"} — ${rec.kategori} — ${rec.pihak}`, baris, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal pengakuan Hutang/Piutang (data tetap tersimpan):", e);
        alert(`Hutang/Piutang tersimpan, TAPI jurnal pengakuannya gagal diposting: ${e.message}`);
      }
    }
    setHpForm(null);
  }
  function hapusHp(id) {
    const row = hutangPiutangArr.find(h => h.id === id);
    if (row && cekKunci(row.tanggal)) return;
    voidJurnalSumberAman("hutangPiutang", id, "Hutang/Piutang dihapus");
    deleteRecord("hutangPiutang", id);
  }
  function submitBayar() {
    const nominal = Number(bayarForm.nominal) || 0;
    if (nominal <= 0) return alert("Nominal pembayaran harus lebih dari 0");
    if (cekKunci(bayarForm.tanggal)) return;
    const row = bayarForm.row;
    const terbayarBaru = (Number(row.terbayar) || 0) + nominal;
    updateRecord("hutangPiutang", row.id, { terbayar: Math.min(terbayarBaru, row.nominalAwal) });
    // ✅ Auto-link ke Kas: hutang dibayar = Kas Keluar, piutang tertagih = Kas Masuk
    const kasId = genUniqueId("KAS");
    const kasTanggal = bayarForm.tanggal || todayStr();
    const kasRecAutoLink = {
      id: kasId, tanggal: kasTanggal, bulanKey: bulanKeyOf(kasTanggal),
      tipe: row.tipe === "hutang" ? "keluar" : "masuk",
      kategori: row.tipe === "hutang" ? "Pembayaran Hutang Usaha" : "Piutang Tertagih",
      nominal, keterangan: `${row.tipe === "hutang" ? "Bayar hutang ke" : "Tagih piutang dari"} ${row.pihak}`,
      // ✅ FIX Bug #2 (audit): simpan link balik ke record Hutang/Piutang
      // asalnya. Tanpa field ini, kalau admin nanti mengedit/menghapus
      // record Kas ini lewat tab Kas Opname biasa, submitKas()/hapusKas()
      // tidak tahu record ini sebenarnya pelunasan hutang/piutang spesifik
      // — jurnalnya akan di-repost pakai pemetaan akun GENERIK
      // (bangunBarisJurnalKas, mis. selalu ke 2101/1104) alih-alih akun
      // spesifik kategorinya (mis. 2102 Pinjaman Bank), dan field
      // `terbayar` di record Hutang/Piutang tidak ikut disesuaikan —
      // saldo outstanding jadi tidak sinkron dengan Kas. Lihat
      // postingJurnalKasAman/submitKas/hapusKas di bawah untuk sisi lain
      // perbaikan ini.
      hutangPiutangId: row.id,
    };
    addRecord("kasTransaksi", kasRecAutoLink);
    // ✅ FASE 5: jurnal pelunasan sekarang pakai akun SPESIFIK sesuai kategori
    // hutangPiutang-nya (mis. Pinjaman Bank → 2102), BUKAN lagi lewat
    // pemetaan generik kategori Kas seperti Fase 2 (postingJurnalKasAman /
    // bangunBarisJurnalKas) — supaya konsisten dengan akun yang dipakai
    // saat pengakuan awal di submitHp() di atas.
    if (postJurnal) {
      try {
        const baris = bangunBarisJurnalPelunasanHutangPiutang(row, nominal);
        if (baris) postJurnal({ tanggal: kasRecAutoLink.tanggal, sumberTipe: "kasTransaksi", sumberId: kasId,
          keterangan: kasRecAutoLink.keterangan, baris, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal pelunasan Hutang/Piutang (data tetap tersimpan):", e);
        alert(`Pembayaran tersimpan, TAPI jurnal akuntansinya gagal diposting: ${e.message}`);
      }
    }
    setBayarForm(null);
  }

  // ── Laporan Neraca (Aset = Kewajiban + Ekuitas) ────────────────────
  const neracaTanggal = bounds?.end || todayStr();
  const kasSistemNeraca = useMemo(() => hitungSaldoKas(kasArr, config.kasSaldoAwal || 0, neracaTanggal).saldoAkhir, [kasArr, config.kasSaldoAwal, neracaTanggal]);
  // ✅ Persediaan sekarang gabungan Stok Gudang Pusat + Stok Beredar di Toko,
  // dinilai pakai Harga Modal/HPP (fallback Harga Jual kalau HPP belum diisi).
  const persediaanInfo = useMemo(() => nilaiPersediaanGabungan(stokGudangMap, stokSistemMap, produkArr), [stokGudangMap, stokSistemMap, produkArr]);
  const persediaanNeraca = persediaanInfo.totalNilai;
  const nilaiBukuAsetNeraca = useMemo(() => asetArr.reduce((s, a) => s + statusAsetSaatIni(a, neracaTanggal).nilaiBuku, 0), [asetArr, neracaTanggal]);
  const asetLancar = kasSistemNeraca + ringkasanPiutang.totalOutstanding + persediaanNeraca;
  const totalAset = asetLancar + nilaiBukuAsetNeraca;
  // ✅ Kewajiban Dana Cadangan (opsional, Rp/pcs terjual) — akumulasi SEMUA
  // waktu (bukan cuma periode terpilih), karena ini kewajiban yang terus
  // menumpuk sejak diaktifkan sampai benar-benar dipakai/dicairkan.
  const kewajibanCadangan = useMemo(() => hitungDanaCadanganKumulatif(analytics?.kontrol||[], analytics?.penjualanLuar||[], config.danaCadangan, totalArsipPcsTerjual?.total), [analytics, config.danaCadangan, totalArsipPcsTerjual]);
  // Kalau ada tahun terarsip yang BELUM punya agregat tersimpan (arsip lama
  // dari sebelum fitur ini ada), angka kewajibanCadangan di atas MASIH kurang
  // akurat (belum menghitung pcs tahun tsb) — beri tahu admin secara eksplisit
  // + tombol untuk mengisinya, alih-alih diam-diam salah.
  const [hitungUlangLoading, setHitungUlangLoading] = useState(false);
  async function hitungUlangSemuaArsip() {
    if (!recalcArchivedYearAgregat || !totalArsipPcsTerjual?.tahunPerluDihitungUlang?.length) return;
    setHitungUlangLoading(true);
    try {
      for (const year of totalArsipPcsTerjual.tahunPerluDihitungUlang) {
        const r = await recalcArchivedYearAgregat(year);
        if (!r.ok) alert(`Gagal menghitung ulang arsip tahun ${year}: ${r.message}`);
      }
    } finally {
      setHitungUlangLoading(false);
    }
  }
  const totalKewajiban = ringkasanHutang.totalOutstanding + kewajibanCadangan;
  const labaDitahanPlug = totalAset - totalKewajiban - modalDisetor; // residual — lihat catatan di UI
  const totalEkuitas = modalDisetor + labaDitahanPlug;

  // ── Tutup Buku (kunci periode) ──────────────────────────────────
  const bulanIniKey = bulanKeyOf(bounds?.start);
  const bulanIniSudahTertutup = tutupBukuArr.some(t => t.id === bulanIniKey);
  const [catatanTutupBuku, setCatatanTutupBuku] = useState("");
  function tutupBukuBulanIni() {
    if (!confirm(`Tutup buku periode ${bulanIniKey}? Setelah ditutup, transaksi Kas/Stock Opname/Hutang-Piutang di bulan ini tidak bisa diubah lagi sampai dibuka kuncinya.`)) return;
    // ⚠️ FIX DOBEL-POSTING: sebelumnya jurnal Amortisasi/Beban Usaha/Bagi
    // Hasil di bawah TIDAK PERNAH dicek "apakah sudah pernah diposting
    // untuk bulan ini" (beda dengan Dana Cadangan yang sudah benar hitung
    // selisih/`sudahDiposting`) — cuma dilindungi tombol UI yang hilang
    // setelah `bulanIniSudahTertutup` jadi true. Itu TIDAK cukup kalau 2
    // perangkat (mis. Admin & Manajer, atau Admin di 2 HP) sama-sama buka
    // Tutup Buku bulan yang sama sebelum keduanya sempat sync — keduanya
    // masih melihat tombol, keduanya klik, dan jurnal-jurnal itu terposting
    // 2x (dobel Beban Operasional/Penyusutan/Hutang Bagi Hasil bulan itu),
    // karena masing-masing dapat id unik sendiri (genUniqueId) jadi TIDAK
    // saling menimpa — malah dua-duanya tersimpan & saling menambah saldo.
    // Guard di bawah cek langsung ke db.jurnalUmum (bukan cuma state lokal
    // `bulanIniSudahTertutup`) sebelum tiap posting — kalau jurnal dengan
    // sumberTipe+sumberId yang sama SUDAH ADA (non-void), batalkan seluruh
    // proses tutup buku ini supaya tidak dobel, dan kasih tahu penggunanya
    // supaya refresh dulu.
    // ✅ FIX (lihat catatan lengkap di buatEntryPembalik(), akuntansiHelpers.js):
    // entry PEMBALIK (dibuat otomatis oleh voidJurnal — Buka Kunci ATAU
    // tombol pembersihan jurnal sisa) ikut kepakai sumberTipe+sumberId yang
    // SAMA dengan entry aslinya, jadi HARUS dikecualikan di sini — kalau
    // tidak, keberadaan entry pembalik (yang justru berarti closure-nya
    // SUDAH DIBATALKAN) malah disalahartikan sebagai "closure masih aktif"
    // dan terus memblokir Tutup Buku ulang tanpa henti.
    const sudahAdaJurnalUntuk = (sumberTipe) =>
      (db.jurnalUmum || []).some(j => j.sumberTipe === sumberTipe && j.sumberId === bulanIniKey && !j.void && !j.isPembalik);
    const sudahDiposting = ["tutupBuku-amortisasi", "tutupBuku-bebanUsaha", "tutupBuku-bagiHasil"]
      .filter(sudahAdaJurnalUntuk);
    if (sudahDiposting.length > 0) {
      // ✅ FIX JALAN BUNTU (dilaporkan lewat screenshot): sebelumnya kalau
      // kondisi ini kejadian (jurnal tutupBuku-* sudah ada TAPI catatan
      // "tutupBuku" resminya sendiri hilang/tidak pernah tersimpan —
      // misalnya sisa percobaan yang terputus antar-device sebelum sempat
      // sinkron), penutupan dibatalkan begitu saja tanpa jalan keluar sama
      // sekali: tombol "Buka Kunci" cuma bisa dipencet dari baris di tabel
      // "Riwayat Periode Tertutup", yang KOSONG persis karena catatan
      // tutupBuku-nya tidak ada — jadi periode ini terkunci PERMANEN dari
      // ditutup ulang, tanpa cara membersihkannya lewat aplikasi. Sekarang
      // ditawarkan pembersihan langsung dari sini (void jurnal sisa itu),
      // tanpa perlu ada catatan tutupBuku untuk melakukannya.
      const mauBersihkan = confirm(
        `Periode ${bulanIniKey} punya jurnal (${sudahDiposting.join(", ")}) yang sudah pernah diposting, TAPI tidak ada catatan "Tutup Buku" resmi untuk periode ini — kemungkinan sisa percobaan yang terputus/belum sinkron sebelumnya.\n\n`+
        `Karena catatan Tutup Buku-nya tidak ada, tombol "Buka Kunci" biasa juga tidak bisa dipakai untuk membersihkan ini.\n\n`+
        `Batalkan (void) jurnal sisa itu sekarang supaya periode ${bulanIniKey} bisa ditutup buku ulang dari awal?`
      );
      if (mauBersihkan) {
        sudahDiposting.forEach(sumberTipe => voidJurnalSumberAman(sumberTipe, bulanIniKey,
          `Pembersihan: jurnal sisa tanpa catatan Tutup Buku untuk periode ${bulanIniKey}`));
        alert(`Jurnal sisa periode ${bulanIniKey} sudah dibatalkan. Tekan sekali lagi tombol "Tutup Buku Periode ${bulanIniKey}" untuk menutup ulang dari awal.`);
      }
      return;
    }
    addRecord("tutupBuku", {
      id: bulanIniKey, periodeLabel: PERIODE_LABELS[periodeMode], tanggalTutup: todayStr(), catatan: catatanTutupBuku,
      snapshotSaldoKas: kasLedgerPeriode.saldoAkhir, snapshotTotalAset: totalAset, snapshotTotalKewajiban: totalKewajiban, snapshotSHU: akuntansi.labaBersihFinal,
    });
    // ✅ FASE 4: posting jurnal Amortisasi/Penyusutan periode ini — dilakukan
    // di titik Tutup Buku (bukan per-transaksi) karena amortisasi memang
    // secara alami proses AKHIR PERIODE, bukan kejadian per hari. Pakai
    // `amortisasiPeriode.total` yang SUDAH dihitung dari hitungAmortisasiPeriode()
    // (sumber angka yang sama dipakai tampilan lama) — supaya tidak mungkin
    // ada 2 angka amortisasi berbeda untuk periode yang sama. sumberId pakai
    // bulanIniKey supaya idempoten: buka-kunci lalu tutup ulang bulan yang
    // sama tidak akan dobel post (di-void dulu lewat bukaKunciBulan).
    // `baris*` juga disimpan di variabel lokal (bukan cuma dikirim ke
    // postJurnal) supaya bisa ikut dihitung di snapshot saldo akun (Fase 7)
    // di bawah — db.jurnalUmum belum ter-update saat itu juga karena
    // addRecord/postJurnal mengubah state React secara ASYNC.
    let barisAmortisasi = null, barisDanaCadangan = null;
    if (postJurnal) {
      try {
        barisAmortisasi = bangunBarisJurnalAmortisasi(amortisasiPeriode.total);
        if (barisAmortisasi) postJurnal({ tanggal: bounds?.end || todayStr(), sumberTipe: "tutupBuku-amortisasi", sumberId: bulanIniKey,
          keterangan: `Amortisasi Aset periode ${bulanIniKey}`, baris: barisAmortisasi, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal Amortisasi (Tutup Buku tetap tersimpan):", e);
        alert(`Periode berhasil ditutup, TAPI jurnal amortisasinya gagal diposting: ${e.message}`);
      }
    }
    // ✅ FASE 6: posting jurnal APROPRIASI Dana Cadangan (Dr Laba Ditahan /
    // Kr Kewajiban Dana Cadangan) — hanya SELISIH (increment) dari yang
    // sudah pernah diposting sebelumnya, karena kewajibanCadangan sendiri
    // adalah angka ALL-TIME kumulatif (bukan per-periode). Kalau config
    // Dana Cadangan tidak aktif, kewajibanCadangan otomatis 0 (lihat
    // hitungDanaCadanganKumulatif) jadi tidak ada yang diposting.
    if (postJurnal) {
      try {
        const sudahDiposting = (db.jurnalUmum || [])
          .filter(j => j.sumberTipe === "danaCadangan-apropriasi" && !j.void)
          .reduce((s, j) => s + (j.baris || []).filter(b => b.akun === "2110").reduce((s2, b) => s2 + (Number(b.kredit) || 0), 0), 0);
        const increment = kewajibanCadangan - sudahDiposting;
        barisDanaCadangan = bangunBarisJurnalApropriasiDanaCadangan(increment);
        if (barisDanaCadangan) postJurnal({ tanggal: bounds?.end || todayStr(), sumberTipe: "danaCadangan-apropriasi", sumberId: bulanIniKey,
          keterangan: `Apropriasi Dana Cadangan periode ${bulanIniKey} (kumulatif: ${fmtRp(kewajibanCadangan)})`, baris: barisDanaCadangan, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal Apropriasi Dana Cadangan (Tutup Buku tetap tersimpan):", e);
        alert(`Periode berhasil ditutup, TAPI jurnal Dana Cadangannya gagal diposting: ${e.message}`);
      }
    }
    // ✅ FASE 9: akrual Beban Usaha (Dr 5102 / Kr 2140) — mengganti asumsi
    // "otomatis potong tanpa jurnal" di sistem lama (lihat AUDIT-integrasi-
    // neraca-bagihasil-pajak.md, Temuan 2) dengan pengakuan jurnal riil tiap
    // Tutup Buku. Pembayaran tunainya nanti (kategori Kas "Biaya
    // Operasional") melunasi 2140 ini, BUKAN men-debit 5102 lagi.
    //
    // ✅ FIX ITEM "SEKALI": sebelumnya SEMUA item (termasuk yang frekuensinya
    // "sekali" — biaya non-rutin spt beli properti satu kali) ikut dijumlah
    // FLAT tiap kali Tutup Buku jalan, jadi kalau admin lupa hapus item itu
    // dari daftar, nominalnya keakru ULANG tiap bulan berikutnya seolah
    // rutin bulanan. Sekarang: item "bulanan" tetap selalu ikut (memang
    // rutin tiap bulan); item "sekali" HANYA ikut di bulan Tutup Buku
    // PERTAMA setelah ditambahkan (ditandai `diakruPadaBulan` di config
    // setelah berhasil diposting) — bulan-bulan berikutnya otomatis
    // dilewati tanpa admin perlu ingat menghapusnya manual. Kalau bulan itu
    // dibuka-kunci lagi (lihat bukaKunciBulan di bawah), tanda ini dilepas
    // supaya bisa diakru ulang saat ditutup lagi (idempoten, sama seperti
    // jurnal lain di Tutup Buku ini).
    let barisBebanUsaha = null;
    const bebanUsahaListTutup = Array.isArray(config.bebanUsaha) ? config.bebanUsaha : migrasiBebanUsahaLama(config);
    const itemSekaliBaruDiakru = bebanUsahaListTutup.filter(b => b.frekuensi === "sekali" && !b.diakruPadaBulan);
    const totalBebanUsahaTutup = bebanUsahaListTutup.reduce((s,b) => {
      if (b.frekuensi === "sekali") return s + (b.diakruPadaBulan ? 0 : (Number(b.nominal)||0));
      return s + (Number(b.nominal)||0); // "bulanan" (atau kosong/data lama) — selalu ikut tiap bulan
    }, 0);
    if (postJurnal) {
      try {
        barisBebanUsaha = bangunBarisJurnalAkrualBebanUsaha(totalBebanUsahaTutup);
        if (barisBebanUsaha) postJurnal({ tanggal: bounds?.end || todayStr(), sumberTipe: "tutupBuku-bebanUsaha", sumberId: bulanIniKey,
          keterangan: `Akrual Beban Usaha periode ${bulanIniKey}`, baris: barisBebanUsaha, createdBy });
        // Tandai item "sekali" yang baru saja diakru supaya tidak ikut lagi
        // di Tutup Buku bulan-bulan berikutnya.
        if (itemSekaliBaruDiakru.length > 0) {
          const bebanUsahaBaru = bebanUsahaListTutup.map(b =>
            itemSekaliBaruDiakru.some(x => x.id === b.id) ? { ...b, diakruPadaBulan: bulanIniKey } : b);
          saveConfig({ ...config, bebanUsaha: bebanUsahaBaru });
        }
      } catch (e) {
        console.warn("Gagal memposting jurnal Akrual Beban Usaha (Tutup Buku tetap tersimpan):", e);
        alert(`Periode berhasil ditutup, TAPI jurnal Akrual Beban Usaha gagal diposting: ${e.message}`);
      }
    }
    // ✅ FASE 9: pengakuan Kewajiban Bagi Hasil (Dr 3102 Laba Ditahan / Kr
    // 2120 per pihak) — mengganti "didebit tanpa pernah dikredit" (lihat
    // AUDIT §Temuan 3) dengan pengakuan berbasis Laba (Rugi) BULAN INI versi
    // JURNAL (historical cost — dihitung dari entry jurnal bulan ini SENDIRI,
    // BUKAN dari akuntansi.labaBersihFinal sistem lama yang live-recalculate
    // harga & Beban Usaha-nya cuma asumsi — lihat AUDIT §Temuan 1 & 2).
    // Dihitung SETELAH akrual Beban Usaha & Amortisasi bulan ini supaya ikut
    // terhitung sebagai pengurang laba sebelum dibagi ke pihak.
    let barisBagiHasil = null;
    if (postJurnal) {
      try {
        const entriesBulanIniUntukLaba = [
          ...(db.jurnalUmum || []).filter(j => !j.void && bulanKeyOf(j.tanggal) === bulanIniKey),
          barisAmortisasi ? { baris: barisAmortisasi } : null,
          barisBebanUsaha ? { baris: barisBebanUsaha } : null,
        ].filter(Boolean);
        let pendapatanBulanIniJurnal = 0, bebanBulanIniJurnal = 0;
        entriesBulanIniUntukLaba.forEach(e => (e.baris||[]).forEach(b => {
          if (String(b.akun)[0] === "4") pendapatanBulanIniJurnal += (Number(b.kredit)||0) - (Number(b.debit)||0);
          if (String(b.akun)[0] === "5") bebanBulanIniJurnal += (Number(b.debit)||0) - (Number(b.kredit)||0);
        }));
        const labaBulanIniJurnal = pendapatanBulanIniJurnal - bebanBulanIniJurnal;
        barisBagiHasil = bangunBarisJurnalPengakuanBagiHasil(config.pihak || [], labaBulanIniJurnal, pendapatanBulanIniJurnal);
        if (barisBagiHasil) postJurnal({ tanggal: bounds?.end || todayStr(), sumberTipe: "tutupBuku-bagiHasil", sumberId: bulanIniKey,
          keterangan: `Pengakuan Kewajiban Bagi Hasil periode ${bulanIniKey} (Laba jurnal: ${fmtRp(labaBulanIniJurnal)})`, baris: barisBagiHasil, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal Pengakuan Bagi Hasil (Tutup Buku tetap tersimpan):", e);
        alert(`Periode berhasil ditutup, TAPI jurnal Pengakuan Kewajiban Bagi Hasil gagal diposting: ${e.message}`);
      }
    }
    // ✅ FASE 7: snapshot saldo SEMUA akun untuk bulan ini ke
    // `saldoAkunBulanan/{bulanIniKey}` — supaya jurnal detail bulan ini
    // SUATU SAAT bisa diarsipkan/dihapus dari RTDB tanpa kehilangan saldo
    // kumulatifnya (pola sama dengan kontrolArchiveIndex, Fase 1). Saldo
    // awal diambil dari snapshot BULAN SEBELUMNYA (atau 0 semua kalau ini
    // bulan pertama yang ditutup). Entry bulan ini = seluruh jurnalUmum
    // yang tanggalnya jatuh di bulan ini (SUDAH termasuk yang di-posting
    // hari-hari sebelumnya lewat Kas/Kontrol/Aset/Hutang-Piutang) DITAMBAH
    // 4 entry Amortisasi/Dana Cadangan/Beban Usaha/Bagi Hasil yang baru saja
    // diposting di atas (belum ada di db.jurnalUmum karena state React
    // belum sempat update).
    try {
      const entriesBulanIniDb = (db.jurnalUmum || []).filter(j => !j.void && bulanKeyOf(j.tanggal) === bulanIniKey);
      const entriesTambahan = [
        barisAmortisasi ? { baris: barisAmortisasi, void: false } : null,
        barisDanaCadangan ? { baris: barisDanaCadangan, void: false } : null,
        barisBebanUsaha ? { baris: barisBebanUsaha, void: false } : null,
        barisBagiHasil ? { baris: barisBagiHasil, void: false } : null,
      ].filter(Boolean);
      const bulanLalu = bulanSebelumnya(bulanIniKey);
      const saldoAwalMap = db.saldoAkunBulanan?.[bulanLalu] || {};
      const snapshot = hitungSnapshotSaldoAkun([...entriesBulanIniDb, ...entriesTambahan], saldoAwalMap, db.daftarAkun);
      save({ ...db, saldoAkunBulanan: { ...db.saldoAkunBulanan, [bulanIniKey]: snapshot } });
    } catch (e) {
      console.warn("Gagal menyimpan snapshot saldo akun bulanan (Tutup Buku & jurnal tetap tersimpan):", e);
      alert(`Periode berhasil ditutup, TAPI snapshot saldo akun bulanan gagal disimpan: ${e.message}`);
    }
    setCatatanTutupBuku("");
  }
  function bukaKunciBulan(id) {
    if (!confirm(`Buka kunci periode ${id}? Data di bulan ini akan bisa diubah lagi.`)) return;
    voidJurnalSumberAman("tutupBuku-amortisasi", id, `Buka kunci periode ${id}`);
    voidJurnalSumberAman("danaCadangan-apropriasi", id, `Buka kunci periode ${id}`);
    voidJurnalSumberAman("tutupBuku-bebanUsaha", id, `Buka kunci periode ${id}`);
    voidJurnalSumberAman("tutupBuku-bagiHasil", id, `Buka kunci periode ${id}`);
    // ✅ Lepas tanda `diakruPadaBulan` dari item Beban Usaha "sekali" yang
    // diakru DI BULAN INI — supaya kalau bulan ini ditutup ulang nanti,
    // item tsb ikut diakru lagi (idempoten, konsisten dengan jurnal lain
    // di atas yang juga di-void supaya bisa diposting ulang).
    const bebanUsahaListSaatIni = Array.isArray(config.bebanUsaha) ? config.bebanUsaha : migrasiBebanUsahaLama(config);
    if (bebanUsahaListSaatIni.some(b => b.diakruPadaBulan === id)) {
      saveConfig({ ...config, bebanUsaha: bebanUsahaListSaatIni.map(b =>
        b.diakruPadaBulan === id ? { ...b, diakruPadaBulan: undefined } : b) });
    }
    // ✅ FASE 7: hapus snapshot saldo akun bulan ini juga — supaya kalau
    // nanti ditutup ulang, snapshot dihitung ulang dari data yang benar
    // (bukan snapshot basi dari sebelum dibuka kuncinya).
    if (db.saldoAkunBulanan?.[id]) {
      const updated = { ...db.saldoAkunBulanan };
      delete updated[id];
      save({ ...db, saldoAkunBulanan: updated });
    }
    deleteRecord("tutupBuku", id);
  }

  // Cari & batalkan (void) semua jurnal AKTIF untuk 1 sumber tertentu — pola
  // sama persis dengan yang dipakai submitKas/hapusKas di atas.
  // ✅ FIX (akar masalah siklus tak berhenti di Tutup Buku — lihat catatan
  // lengkap di buatEntryPembalik(), akuntansiHelpers.js): dulu fungsi ini
  // mengambil SEMUA entry non-void untuk sumberTipe+sumberId ini — termasuk
  // entry PEMBALIK yang sudah lebih dulu ada (sisa dari void sebelumnya).
  // voidJurnalSumberAman() lalu MEMBATALKAN ULANG entry pembalik itu juga —
  // padahal membalik sebuah pembalik artinya justru MENEGASKAN KEMBALI efek
  // entry asli yang harusnya sudah batal! Ini yang bikin Buka Kunci /
  // pembersihan jurnal sisa bisa "muter" tak berhenti: tiap kali dipanggil,
  // ikut membalik pembalik-pembalik sebelumnya secara berantai. Sekarang
  // entry pembalik dikecualikan — hanya entry ASLI (bukan hasil pembalikan)
  // yang akan dibatalkan di sini.
  function jurnalAktifSumber(sumberTipe, sumberId) {
    return (db.jurnalUmum || []).filter(j => j.sumberTipe === sumberTipe && j.sumberId === sumberId && !j.void && !j.isPembalik);
  }
  function voidJurnalSumberAman(sumberTipe, sumberId, alasan) {
    if (!voidJurnal) return;
    jurnalAktifSumber(sumberTipe, sumberId).forEach(j => voidJurnal(j.id, { alasan, createdBy }));
  }

  const [asetForm, setAsetForm] = useState(null);
  const amortisasiPeriode = useMemo(() => hitungAmortisasiPeriode(asetArr, bounds), [asetArr, bounds]);
  function submitAset() {
    if (!asetForm.nama || !Number(asetForm.nilaiPerolehan) || !Number(asetForm.umurBulan) || !asetForm.tanggalPerolehan)
      return alert("Nama, Nilai Perolehan, Umur Ekonomis, & Tanggal Perolehan wajib diisi");
    if (cekKunci(asetForm.tanggalPerolehan)) return;
    const rec = { ...asetForm, nilaiPerolehan: Number(asetForm.nilaiPerolehan), nilaiResidu: Number(asetForm.nilaiResidu) || 0, umurBulan: Number(asetForm.umurBulan), bulanKey: bulanKeyOf(asetForm.tanggalPerolehan) };
    const id = asetForm.id || genUniqueId("AST");
    if (asetForm.id) updateRecord("asetAmortisasi", asetForm.id, rec);
    else addRecord("asetAmortisasi", { ...rec, id });
    // Posting/repost jurnal perolehan — void dulu kalau edit (supaya tidak
    // dobel kalau nilai/kategorinya diubah), lalu posting ulang dari data
    // terbaru. Sama sekali TIDAK menghambat penyimpanan Aset kalau gagal.
    voidJurnalSumberAman("asetAmortisasi", id, "Aset diedit — jurnal perolehan diposting ulang");
    if (postJurnal) {
      try {
        const baris = bangunBarisJurnalAsetPerolehan({ ...rec, id });
        if (baris) postJurnal({ tanggal: rec.tanggalPerolehan, sumberTipe: "asetAmortisasi", sumberId: id,
          keterangan: `Perolehan Aset — ${rec.nama}`, baris, createdBy });
      } catch (e) {
        console.warn("Gagal memposting jurnal perolehan Aset (data Aset tetap tersimpan):", e);
        alert(`Aset tersimpan, TAPI jurnal perolehannya gagal diposting: ${e.message}`);
      }
    }
    setAsetForm(null);
  }

  const SECTIONS = [
    { key: "ringkasan", label: "Ringkasan Rasio", icon: Icon.scale },
    { key: "kas", label: "Kas Opname", icon: Icon.landmark },
    { key: "stok", label: "Stock Opname", icon: Icon.boxes },
    { key: "amortisasi", label: "Amortisasi Aset", icon: Icon.calculator },
    { key: "gudang", label: "Gudang Pusat", icon: Icon.package },
    { key: "hutangpiutang", label: "Hutang/Piutang", icon: Icon.receipt },
    { key: "neraca", label: "Laporan Neraca", icon: Icon.spreadsheet },
    { key: "tutupbuku", label: "Tutup Buku", icon: Icon.checklist },
    { key: "jurnalpembuka", label: "Jurnal Pembuka (Setup)", icon: Icon.piggyBank },
  ];

  return (
    <div>
      {/* Sub-sub-navigasi */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
              border: `1.5px solid ${section === s.key ? T.green : T.gray200}`, borderRadius: 99,
              background: section === s.key ? T.greenLt : T.white, cursor: "pointer", fontFamily: "inherit",
              fontSize: 12, fontWeight: 700, color: section === s.key ? T.green : T.gray600 }}>
            <s.icon size={14} strokeWidth={2} /> {s.label}
          </button>
        ))}
      </div>

      {section === "ringkasan" && (
        <>
          <div style={{ fontSize: 12, color: T.gray400, marginBottom: 10 }}>
            Rasio & indikator keuangan untuk periode <b>{PERIODE_LABELS[periodeMode]}</b>. Biaya Amortisasi otomatis diambil dari daftar Aset (tab Amortisasi) dan sudah termasuk di Laporan Laba Rugi.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="BOPO" value={`${bopoPct.toFixed(1)}%`} icon={Icon.percent} color={bopoPct > 80 ? T.red : T.orange} sub="Biaya Operasional / Pendapatan" />
            <StatCard label="SHU / Laba Bersih" value={fmtRp(akuntansi.labaBersihFinal)} icon={Icon.wallet} color={T.teal} sub={PERIODE_LABELS[periodeMode]} />
            <StatCard label="ROE Periode" value={roePeriodePct !== null ? `${roePeriodePct.toFixed(1)}%` : "—"} icon={Icon.trendingUp} color={T.purple}
              sub={modalDisetor > 0 ? `dari Modal ${fmtRp(modalDisetor)}` : "Isi Modal Disetor di Konfigurasi"} />
            {roeSetahunPct !== null && (
              <StatCard label="ROE Disetahunkan (Estimasi)" value={`${roeSetahunPct.toFixed(1)}%`} icon={Icon.trendingUp} color={T.purple} sub="ROE bulanan × 12" />
            )}
            <StatCard label="Biaya Amortisasi" value={fmtRp(akuntansi.biayaAmortisasi)} icon={Icon.calculator} color={T.orange} sub={`${amortisasiPeriode.detail.filter(d=>d.bulanOverlap>0).length} aset aktif`} />
            <StatCard label="Saldo Kas Sistem (terkini)" value={fmtRp(kasLedgerTerkini.saldoAkhir)} icon={Icon.landmark} color={T.blue} sub="saldo awal + kas masuk − kas keluar" />
            <StatCard label="Laba Kotor Riil (HPP)" value={fmtRp(hppPeriode.labaKotorRiil)} icon={Icon.calculator} color={T.gold}
              sub={hppPeriode.adaYangBelumIsi ? "⚠ ada produk belum diisi HPP" : "Pendapatan − HPP produk terjual"} />
          </div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.gray700, marginBottom: 10 }}>Rumus yang dipakai</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.gray600, lineHeight: 1.9 }}>
              <li><b>BOPO</b> = Total Biaya Operasional ÷ Total Pendapatan × 100% — makin rendah makin efisien.</li>
              <li><b>SHU / Laba Bersih</b> = Pendapatan − Total Biaya (termasuk Amortisasi), lalu disesuaikan Margin Laba.</li>
              <li><b>ROE</b> = SHU ÷ Modal Disetor × 100% — mengukur imbal hasil bagi pemilik modal.</li>
              <li><b>Amortisasi</b> = (Nilai Perolehan − Nilai Residu) ÷ Umur Ekonomis (bulan), diakui merata tiap bulan selama umur aset.</li>
              <li><b>Laba Kotor Riil (HPP)</b> = Pendapatan − (qty terjual × Harga Modal/HPP per produk, diisi di Master Produk). Ini <i>pembanding</i> — angka resmi Laba Bersih/SHU tetap pakai asumsi Margin Laba % di tab Bagi Hasil & Laba Rugi, supaya perhitungan yang sudah berjalan tidak berubah tiba-tiba. Kalau HPP sudah diisi untuk semua produk, bandingkan kedua angka ini untuk mengecek apakah asumsi Margin % masih realistis.</li>
            </ul>
          </Card>
        </>
      )}

      {section === "kas" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Saldo Awal" value={fmtRp(Number(config.kasSaldoAwal) || 0)} icon={Icon.landmark} color={T.gray600} />
            <StatCard label="Total Kas Masuk" value={fmtRp(kasLedgerTerkini.totalMasuk)} icon={Icon.trendingUp} color={T.green} />
            <StatCard label="Total Kas Keluar" value={fmtRp(kasLedgerTerkini.totalKeluar)} icon={Icon.trendingDown} color={T.red} />
            <StatCard label="Saldo Sistem (terkini)" value={fmtRp(kasLedgerTerkini.saldoAkhir)} icon={Icon.piggyBank} color={T.blue} />
            <StatCard label={`Saldo Sistem s.d. ${PERIODE_LABELS[periodeMode]}`} value={fmtRp(kasLedgerPeriode.saldoAkhir)} icon={Icon.calendar} color={T.teal} />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.checklist size={16} strokeWidth={2} /> Kas Opname (Cocokkan Fisik vs Sistem)
            </div>
            <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>Hitung uang tunai/saldo kas yang benar-benar ada, lalu bandingkan dengan saldo sistem terkini.</div>
            <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Saldo Fisik Hasil Hitung (Rp)</label>
                <input type="number" value={opnameFisik} onChange={e => setOpnameFisik(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={opnameKet} onChange={e => setOpnameKet(e.target.value)} placeholder="cth: opname akhir bulan"
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
            {opnameFisik !== "" && (
              <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12,
                background: selisihKas === 0 ? T.greenLt : T.redLt, border: `1px solid ${selisihKas === 0 ? T.green : T.red}44` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: selisihKas === 0 ? T.green : T.red }}>
                  Selisih: {fmtRp(Math.abs(selisihKas))} {selisihKas === 0 ? "(Cocok)" : selisihKas > 0 ? "(Fisik lebih besar dari sistem)" : "(Fisik lebih kecil dari sistem)"}
                </span>
              </div>
            )}
            {config.kasOpname?.tanggal && (
              <div style={{ fontSize: 11, color: T.gray400, marginBottom: 10 }}>Opname terakhir disimpan: {config.kasOpname.tanggal}</div>
            )}
            <Btn size="sm" icon={Icon.save} onClick={simpanOpnameKas}>Simpan Hasil Opname</Btn>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.spreadsheet size={16} strokeWidth={2} /> Buku Kas
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setKasForm({ tanggal: todayStr(), tipe: "masuk", kategori: "", nominal: "", keterangan: "" })}>Catat Transaksi</Btn>
            </div>
            <Table
              data={kasRowsDesc}
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "tipe", label: "Tipe", render: v => (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    color: v === "masuk" ? T.green : T.red, background: v === "masuk" ? T.greenLt : T.redLt }}>
                    {v === "masuk" ? "Masuk" : "Keluar"}
                  </span>
                ) },
                { key: "kategori", label: "Kategori", render: (v, row) => (
                  <span>
                    {v}
                    {row.hutangPiutangId && (
                      <span title="Auto-link dari pelunasan Hutang/Piutang — kategori & tipe terkunci saat diedit di sini"
                        style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                          color: "#2563eb", background: "#dbeafe" }}>
                        🔗 H/P
                      </span>
                    )}
                  </span>
                ) },
                { key: "keterangan", label: "Keterangan" },
                { key: "nominal", label: "Nominal", render: (v, row) => (
                  <span style={{ fontWeight: 700, color: row.tipe === "masuk" ? T.green : T.red }}>
                    {row.tipe === "masuk" ? "+" : "−"}{fmtRp(v)}
                  </span>
                ) },
                { key: "saldoBerjalan", label: "Saldo Berjalan", render: v => fmtRp(v) },
              ]}
              onEdit={row => setKasForm(row)}
              onDelete={hapusKas}
            />
          </Card>

          {kasForm && (
            <Modal title={kasForm.id ? "Edit Transaksi Kas" : "Catat Transaksi Kas"} onClose={() => setKasForm(null)} width={440}>
              {kasForm.hutangPiutangId && (
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#2563eb" }}>🔗 Transaksi ini auto-link dari pelunasan Hutang/Piutang.</span>
                  <div style={{ fontSize: 11.5, color: T.gray600, marginTop: 3 }}>
                    Tipe & Kategori dikunci supaya jurnalnya tetap konsisten dengan akun spesifik Hutang/Piutang terkait.
                    Kalau nominal diubah di sini, saldo terbayar Hutang/Piutang-nya akan ikut disesuaikan otomatis.
                    Untuk mengubah tipe/kategori, hapus transaksi ini lalu catat ulang dari tab Hutang/Piutang.
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tipe</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["masuk", "keluar"].map(t => (
                    <button key={t} disabled={!!kasForm.hutangPiutangId}
                      onClick={() => setKasForm(f => ({ ...f, tipe: t, kategori: "" }))}
                      style={{ flex: 1, padding: "8px 12px", border: `1.5px solid ${kasForm.tipe === t ? T.green : T.gray200}`,
                        borderRadius: 8, background: kasForm.tipe === t ? T.greenLt : T.white,
                        cursor: kasForm.hutangPiutangId ? "not-allowed" : "pointer", opacity: kasForm.hutangPiutangId ? 0.7 : 1,
                        fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: kasForm.tipe === t ? T.green : T.gray600 }}>
                      {t === "masuk" ? "Kas Masuk" : "Kas Keluar"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={kasForm.tanggal} onChange={e => setKasForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal (Rp)</label>
                  <input type="number" value={kasForm.nominal} onChange={e => setKasForm(f => ({ ...f, nominal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={kasForm.kategori} disabled={!!kasForm.hutangPiutangId}
                  onChange={e => setKasForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit",
                    background: kasForm.hutangPiutangId ? T.gray50 : T.white, cursor: kasForm.hutangPiutangId ? "not-allowed" : "auto" }}>
                  <option value="">— Pilih —</option>
                  {(kasForm.tipe === "masuk" ? KATEGORI_KAS_MASUK : KATEGORI_KAS_KELUAR).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={kasForm.keterangan || ""} onChange={e => setKasForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 16, padding: "10px 14px", background: T.gray50, borderRadius: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Saldo Awal Kas (opsional, dasar perhitungan saldo berjalan)</label>
                <input type="number" value={config.kasSaldoAwal || 0} onChange={e => saveConfig({ ...config, kasSaldoAwal: Number(e.target.value) || 0 })}
                  style={{ width: "100%", padding: "7px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 7, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setKasForm(null)}>Batal</Btn>
                <Btn onClick={submitKas} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "stok" && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.gray400, marginBottom: 10 }}>
              "Stok Sistem" = total stok konsinyasi yang tercatat sedang beredar di semua toko (belum termasuk Stok Gudang Pusat — untuk itu, lihat tab "Gudang Pusat" terpisah). Setiap sesi opname membekukan angka sistem saat itu supaya bisa dibandingkan dengan hasil hitung fisik.
            </div>
            <Btn size="sm" icon={Icon.add} onClick={bukaOpnameStokBaru}>Opname Baru</Btn>
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.boxes size={16} strokeWidth={2} /> Riwayat Stock Opname
            </div>
            <Table
              data={[...stockOpnameArr].sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""))}
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "keterangan", label: "Keterangan" },
                { key: "items", label: "Jml Produk", render: v => `${(v || []).length} produk` },
                { key: "totalSelisihPcs", label: "Selisih (pcs)", render: v => (
                  <span style={{ fontWeight: 700, color: v === 0 ? T.gray600 : v > 0 ? T.green : T.red }}>{v > 0 ? "+" : ""}{fmt(v)}</span>
                ) },
                { key: "totalSelisihRp", label: "Selisih (Rp)", render: v => (
                  <span style={{ fontWeight: 700, color: v === 0 ? T.gray600 : v > 0 ? T.green : T.red }}>{v > 0 ? "+" : ""}{fmtRp(v)}</span>
                ) },
              ]}
              onEdit={row => setDetailOpnameStok(row)}
              onDelete={hapusStockOpname}
            />
          </Card>

          {opnameStokForm && (
            <Modal title="Opname Stok Baru" onClose={() => setOpnameStokForm(null)} width={640}>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={opnameStokForm.tanggal} onChange={e => setOpnameStokForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                  <input value={opnameStokForm.keterangan} onChange={e => setOpnameStokForm(f => ({ ...f, keterangan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.gray50 }}>
                      {["Produk", "Stok Sistem", "Stok Fisik", "Selisih"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {opnameStokForm.items.map((it, i) => {
                      const selisih = (Number(it.stokFisik) || 0) - it.stokSistem;
                      return (
                        <tr key={it.produkId} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.nama}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokSistem)}</td>
                          <td style={{ padding: "6px 10px" }}>
                            <input type="number" value={it.stokFisik} onChange={e => {
                              const v = e.target.value;
                              setOpnameStokForm(f => ({ ...f, items: f.items.map((x, xi) => xi === i ? { ...x, stokFisik: v } : x) }));
                            }} style={{ width: 90, padding: "5px 8px", border: `1.5px solid ${T.gray200}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
                          </td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: selisih === 0 ? T.gray600 : selisih > 0 ? T.green : T.red }}>
                            {selisih > 0 ? "+" : ""}{fmt(selisih)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setOpnameStokForm(null)}>Batal</Btn>
                <Btn onClick={submitOpnameStok} icon={Icon.save}>Simpan Opname</Btn>
              </div>
            </Modal>
          )}

          {detailOpnameStok && (
            <Modal title={`Edit Opname — ${detailOpnameStok.tanggal}`} onClose={() => setDetailOpnameStok(null)} width={640}>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={detailOpnameStok.tanggal} onChange={e => setDetailOpnameStok(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                  <input value={detailOpnameStok.keterangan || ""} onChange={e => setDetailOpnameStok(f => ({ ...f, keterangan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.gray50 }}>
                      {["Produk", "Sistem", "Fisik", "Selisih"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOpnameStok.items || []).map((it, i) => {
                      const selisih = (Number(it.stokFisik) || 0) - it.stokSistem;
                      return (
                        <tr key={it.produkId} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.nama}</td>
                          <td style={{ padding: "6px 10px" }}>{fmt(it.stokSistem)}</td>
                          <td style={{ padding: "6px 10px" }}>
                            <input type="number" value={it.stokFisik} onChange={e => {
                              const v = e.target.value;
                              setDetailOpnameStok(f => ({ ...f, items: f.items.map((x, xi) => xi === i ? { ...x, stokFisik: v } : x) }));
                            }} style={{ width: 90, padding: "5px 8px", border: `1.5px solid ${T.gray200}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
                          </td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: selisih === 0 ? T.gray600 : selisih > 0 ? T.green : T.red }}>{selisih > 0 ? "+" : ""}{fmt(selisih)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setDetailOpnameStok(null)}>Batal</Btn>
                <Btn onClick={submitEditOpnameStok} icon={Icon.save}>Simpan Perubahan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "amortisasi" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Jumlah Aset" value={fmt(asetArr.length)} icon={Icon.package} color={T.gray600} />
            <StatCard label="Total Nilai Perolehan" value={fmtRp(asetArr.reduce((s, a) => s + (Number(a.nilaiPerolehan) || 0), 0))} icon={Icon.banknote} color={T.blue} />
            <StatCard label={`Amortisasi ${PERIODE_LABELS[periodeMode]}`} value={fmtRp(amortisasiPeriode.total)} icon={Icon.calculator} color={T.orange} />
            <StatCard label="Total Nilai Buku Saat Ini" value={fmtRp(asetArr.reduce((s, a) => s + statusAsetSaatIni(a).nilaiBuku, 0))} icon={Icon.scale} color={T.teal} />
          </div>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.calculator size={16} strokeWidth={2} /> Daftar Aset & Penyusutan
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setAsetForm({ nama: "", kategori: KATEGORI_ASET[0], nilaiPerolehan: "", nilaiResidu: 0, tanggalPerolehan: todayStr(), umurBulan: 36, keterangan: "" })}>Tambah Aset</Btn>
            </div>
            <Table
              data={asetArr}
              columns={[
                { key: "nama", label: "Nama Aset" },
                { key: "kategori", label: "Kategori" },
                { key: "nilaiPerolehan", label: "Nilai Perolehan", render: v => fmtRp(v) },
                { key: "umurBulan", label: "Umur", render: v => `${v} bln` },
                { key: "id", label: "Amortisasi/Bln", render: (_, row) => fmtRp(statusAsetSaatIni(row).perBulan) },
                { key: "nilaiBuku", label: "Nilai Buku", render: (_, row) => {
                  const st = statusAsetSaatIni(row);
                  return <span style={{ color: st.lunas ? T.gray400 : T.gray800, fontWeight: 700 }}>{fmtRp(st.nilaiBuku)}{st.lunas && " (lunas)"}</span>;
                } },
              ]}
              onEdit={row => setAsetForm(row)}
              onDelete={id => {
                const row = asetArr.find(a => a.id === id);
                if (row && cekKunci(row.tanggalPerolehan)) return;
                voidJurnalSumberAman("asetAmortisasi", id, "Aset dihapus"); deleteRecord("asetAmortisasi", id);
              }}
            />
          </Card>

          {asetForm && (
            <Modal title={asetForm.id ? "Edit Aset" : "Tambah Aset"} onClose={() => setAsetForm(null)} width={480}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nama Aset *</label>
                <input value={asetForm.nama} onChange={e => setAsetForm(f => ({ ...f, nama: e.target.value }))} placeholder="cth: Motor Distribusi, Rak Display Toko..."
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={asetForm.kategori} onChange={e => setAsetForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {KATEGORI_ASET.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nilai Perolehan (Rp) *</label>
                  <input type="number" value={asetForm.nilaiPerolehan} onChange={e => setAsetForm(f => ({ ...f, nilaiPerolehan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nilai Residu (Rp)</label>
                  <input type="number" value={asetForm.nilaiResidu} onChange={e => setAsetForm(f => ({ ...f, nilaiResidu: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal Perolehan *</label>
                  <input type="date" value={asetForm.tanggalPerolehan} onChange={e => setAsetForm(f => ({ ...f, tanggalPerolehan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Umur Ekonomis (bulan) *</label>
                  <input type="number" value={asetForm.umurBulan} onChange={e => setAsetForm(f => ({ ...f, umurBulan: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={asetForm.keterangan || ""} onChange={e => setAsetForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setAsetForm(null)}>Batal</Btn>
                <Btn onClick={submitAset} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "gudang" && (
        <>
          <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
            Ledger stok gudang pusat — terpisah dari stok yang sudah dititip ke toko (lihat Stock Opname). "Masuk" = barang baru diterima gudang (pembelian/produksi/retur toko). "Keluar" = barang didistribusikan ke sales/toko, atau penyesuaian (rusak/hilang).
          </div>
          <div style={{ overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
              <thead>
                <tr style={{ background: T.gray50 }}>
                  {["Produk", "Stok Gudang Saat Ini", "Nilai (HPP/Harga Jual)"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.gray600, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {produkArr.map(p => {
                  const qty = stokGudangMap[p.id] || 0;
                  const hargaPakai = Number(p.hargaModal) || Number(p.harga) || 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${T.gray100}` }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{p.nama}</td>
                      <td style={{ padding: "6px 10px", fontWeight: 700, color: qty < 0 ? T.red : T.gray800 }}>{fmt(qty)} pcs</td>
                      <td style={{ padding: "6px 10px" }}>{fmtRp(qty * hargaPakai)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.package size={16} strokeWidth={2} /> Riwayat Transaksi Gudang
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setGudangForm({ tanggal: todayStr(), tipe: "masuk", produkId: produkArr[0]?.id || "", qty: "", kategori: KATEGORI_GUDANG_MASUK[0], keterangan: "" })}>
                Catat Transaksi
              </Btn>
            </div>
            <Table
              data={[...gudangArr].sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""))}
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "tipe", label: "Tipe", render: v => (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    color: v === "masuk" ? T.green : T.red, background: v === "masuk" ? T.greenLt : T.redLt }}>
                    {v === "masuk" ? "Masuk" : "Keluar"}
                  </span>
                ) },
                { key: "produkId", label: "Produk", render: v => produkArr.find(p => p.id === v)?.nama || v },
                { key: "qty", label: "Qty", render: (v, row) => (
                  <span style={{ fontWeight: 700, color: row.tipe === "masuk" ? T.green : T.red }}>{row.tipe === "masuk" ? "+" : "−"}{fmt(v)} pcs</span>
                ) },
                { key: "kategori", label: "Kategori" },
                { key: "keterangan", label: "Keterangan" },
              ]}
              onEdit={row => setGudangForm(row)}
              onDelete={hapusGudang}
            />
          </Card>

          {gudangForm && (
            <Modal title={gudangForm.id ? "Edit Transaksi Gudang" : "Catat Transaksi Gudang"} onClose={() => setGudangForm(null)} width={460}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tipe</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["masuk", "keluar"].map(t => (
                    <button key={t} onClick={() => setGudangForm(f => ({ ...f, tipe: t, kategori: (t === "masuk" ? KATEGORI_GUDANG_MASUK : KATEGORI_GUDANG_KELUAR)[0] }))}
                      style={{ flex: 1, padding: "8px 12px", border: `1.5px solid ${gudangForm.tipe === t ? T.green : T.gray200}`,
                        borderRadius: 8, background: gudangForm.tipe === t ? T.greenLt : T.white, cursor: "pointer",
                        fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: gudangForm.tipe === t ? T.green : T.gray600 }}>
                      {t === "masuk" ? "Stok Masuk" : "Stok Keluar"}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Produk</label>
                <select value={gudangForm.produkId} onChange={e => setGudangForm(f => ({ ...f, produkId: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {produkArr.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}
                </select>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={gudangForm.tanggal} onChange={e => setGudangForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Jumlah (pcs)</label>
                  <input type="number" value={gudangForm.qty} onChange={e => setGudangForm(f => ({ ...f, qty: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={gudangForm.kategori} onChange={e => setGudangForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {(gudangForm.tipe === "masuk" ? KATEGORI_GUDANG_MASUK : KATEGORI_GUDANG_KELUAR).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={gudangForm.keterangan || ""} onChange={e => setGudangForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setGudangForm(null)}>Batal</Btn>
                <Btn onClick={submitGudang} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "hutangpiutang" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Total Hutang Outstanding" value={fmtRp(ringkasanHutang.totalOutstanding)} icon={Icon.trendingDown} color={T.red} sub={`${ringkasanHutang.rows.filter(r=>!r.lunas).length} belum lunas`} />
            <StatCard label="Total Piutang Outstanding" value={fmtRp(ringkasanPiutang.totalOutstanding)} icon={Icon.trendingUp} color={T.green} sub={`${ringkasanPiutang.rows.filter(r=>!r.lunas).length} belum lunas`} />
            <StatCard label="Posisi Bersih" value={fmtRp(ringkasanPiutang.totalOutstanding - ringkasanHutang.totalOutstanding)} icon={Icon.scale} color={T.blue} sub="Piutang − Hutang" />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ key: "hutang", label: "Hutang" }, { key: "piutang", label: "Piutang" }].map(t => (
              <button key={t.key} onClick={() => setHpTipeAktif(t.key)}
                style={{ padding: "7px 16px", border: `1.5px solid ${hpTipeAktif === t.key ? T.green : T.gray200}`, borderRadius: 99,
                  background: hpTipeAktif === t.key ? T.greenLt : T.white, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, color: hpTipeAktif === t.key ? T.green : T.gray600 }}>
                {t.label}
              </button>
            ))}
          </div>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.receipt size={16} strokeWidth={2} /> Daftar {hpTipeAktif === "hutang" ? "Hutang" : "Piutang"}
              </div>
              <Btn size="sm" icon={Icon.add} onClick={() => setHpForm({ tipe: hpTipeAktif, pihak: "", kategori: (hpTipeAktif === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG)[0], nominalAwal: "", terbayar: 0, tanggal: todayStr(), jatuhTempo: "", keterangan: "" })}>
                Tambah {hpTipeAktif === "hutang" ? "Hutang" : "Piutang"}
              </Btn>
            </div>
            <Table
              data={(hpTipeAktif === "hutang" ? ringkasanHutang.rows : ringkasanPiutang.rows)}
              columns={[
                { key: "pihak", label: "Pihak" },
                { key: "kategori", label: "Kategori" },
                { key: "tanggal", label: "Tanggal" },
                { key: "jatuhTempo", label: "Jatuh Tempo", render: v => v || "-" },
                { key: "nominalAwal", label: "Nominal Awal", render: v => fmtRp(v) },
                { key: "sisa", label: "Sisa", render: (v, row) => (
                  <span style={{ fontWeight: 700, color: row.lunas ? T.gray400 : T.red }}>{row.lunas ? "Lunas" : fmtRp(v)}</span>
                ) },
                { key: "id", label: "Aksi Cepat", render: (_, row) => !row.lunas && (
                  <button onClick={() => setBayarForm({ row, nominal: row.sisa, tanggal: todayStr() })}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.green}`, background: T.greenLt, color: T.green,
                      fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                    {hpTipeAktif === "hutang" ? "Bayar" : "Tagih"}
                  </button>
                ) },
              ]}
              onEdit={row => setHpForm(row)}
              onDelete={hapusHp}
            />
          </Card>

          {hpForm && (
            <Modal title={hpForm.id ? "Edit" : `Tambah ${hpForm.tipe === "hutang" ? "Hutang" : "Piutang"}`} onClose={() => setHpForm(null)} width={480}>
              {!hpForm.id && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tipe</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["hutang", "piutang"].map(t => (
                      <button key={t} onClick={() => setHpForm(f => ({ ...f, tipe: t, kategori: (t === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG)[0] }))}
                        style={{ flex: 1, padding: "8px 12px", border: `1.5px solid ${hpForm.tipe === t ? T.green : T.gray200}`,
                          borderRadius: 8, background: hpForm.tipe === t ? T.greenLt : T.white, cursor: "pointer",
                          fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: hpForm.tipe === t ? T.green : T.gray600 }}>
                        {t === "hutang" ? "Hutang" : "Piutang"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nama Pihak *</label>
                <input value={hpForm.pihak} onChange={e => setHpForm(f => ({ ...f, pihak: e.target.value }))} placeholder={hpForm.tipe === "hutang" ? "cth: Supplier ABC" : "cth: Toko XYZ"}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Kategori</label>
                <select value={hpForm.kategori} onChange={e => setHpForm(f => ({ ...f, kategori: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}>
                  {(hpForm.tipe === "hutang" ? KATEGORI_HUTANG : KATEGORI_PIUTANG).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal Awal (Rp) *</label>
                  <input type="number" value={hpForm.nominalAwal} onChange={e => setHpForm(f => ({ ...f, nominalAwal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Sudah Terbayar (Rp)</label>
                  <input type="number" value={hpForm.terbayar} onChange={e => setHpForm(f => ({ ...f, terbayar: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal *</label>
                  <input type="date" value={hpForm.tanggal} onChange={e => setHpForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Jatuh Tempo</label>
                  <input type="date" value={hpForm.jatuhTempo || ""} onChange={e => setHpForm(f => ({ ...f, jatuhTempo: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={hpForm.keterangan || ""} onChange={e => setHpForm(f => ({ ...f, keterangan: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setHpForm(null)}>Batal</Btn>
                <Btn onClick={submitHp} icon={Icon.save}>Simpan</Btn>
              </div>
            </Modal>
          )}

          {bayarForm && (
            <Modal title={`Catat ${bayarForm.row.tipe === "hutang" ? "Pembayaran" : "Penagihan"} — ${bayarForm.row.pihak}`} onClose={() => setBayarForm(null)} width={420}>
              <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
                Sisa saat ini: <b>{fmtRp(bayarForm.row.sisa)}</b>. Mencatat ini akan otomatis membuat entri {bayarForm.row.tipe === "hutang" ? "Kas Keluar" : "Kas Masuk"} di Buku Kas.
              </div>
              <div className="gw-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Nominal (Rp)</label>
                  <input type="number" value={bayarForm.nominal} max={bayarForm.row.sisa} onChange={e => setBayarForm(f => ({ ...f, nominal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal</label>
                  <input type="date" value={bayarForm.tanggal} onChange={e => setBayarForm(f => ({ ...f, tanggal: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setBayarForm(null)}>Batal</Btn>
                <Btn onClick={submitBayar} icon={Icon.save}>Simpan & Catat ke Kas</Btn>
              </div>
            </Modal>
          )}
        </>
      )}

      {section === "neraca" && (
        <>
          <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
            Posisi keuangan per <b>{neracaTanggal}</b> (akhir periode {PERIODE_LABELS[periodeMode]}). Karena aplikasi ini belum memakai pembukuan berpasangan (double-entry) penuh, <b>Laba Ditahan</b> di bawah dihitung sebagai angka sisa (Total Aset − Total Kewajiban − Modal Disetor) — bukan hasil akumulasi transaksi historis per bulan, jadi Neraca ini akan selalu balance secara matematis.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="gw-grid2">
            {/* ASET */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.blue}`, paddingBottom: 10 }}>ASET</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "12px 0 6px" }}>Aset Lancar</div>
              {[
                ["Kas & Setara Kas", kasSistemNeraca],
                ["Piutang Usaha", ringkasanPiutang.totalOutstanding],
                ["Persediaan (Gudang Pusat + Beredar di Toko)", persediaanNeraca],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(val)}</span>
                </div>
              ))}
              {persediaanInfo.adaFallbackHarga && (
                <div style={{ fontSize: 10, color: T.orange, marginTop: -2, marginBottom: 4 }}>
                  <Icon.warning size={10} strokeWidth={2} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                  Ada produk yang belum diisi Harga Modal/HPP — dinilai pakai Harga Jual sebagai fallback (kurang akurat).
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.blue, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Aset Lancar</span><span>{fmtRp(asetLancar)}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "16px 0 6px" }}>Aset Tetap</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                <span>Nilai Buku Aset (setelah amortisasi)</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(nilaiBukuAsetNeraca)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: T.blueLt, borderRadius: 8, marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.blue }}>TOTAL ASET</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: T.blue }}>{fmtRp(totalAset)}</span>
              </div>
            </Card>

            {/* KEWAJIBAN + EKUITAS */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, borderBottom: `2px solid ${T.red}`, paddingBottom: 10 }}>KEWAJIBAN & EKUITAS</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "12px 0 6px" }}>Kewajiban (Liabilitas)</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                <span>Hutang Usaha</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(ringkasanHutang.totalOutstanding)}</span>
              </div>
              {config.danaCadangan?.aktif && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                  <span>Kewajiban Dana Cadangan ({config.danaCadangan?.keterangan || "opsional"})</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(kewajibanCadangan)}</span>
                </div>
              )}
              {config.danaCadangan?.aktif && totalArsipPcsTerjual?.adaYangPerluDihitungUlang && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", background: T.orangeLt,
                  border: `1.5px solid ${T.orange}55`, borderRadius: 8, margin: "4px 0 8px", fontSize: 11.5, color: T.gray700, lineHeight: 1.5 }}>
                  <Icon.warning size={15} strokeWidth={2} color={T.orange} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <b style={{ color: T.orange }}>Angka Dana Cadangan Kumulatif di atas belum lengkap.</b> Tahun terarsip{" "}
                    {totalArsipPcsTerjual.tahunPerluDihitungUlang.join(", ")} belum punya data agregat pcs terjual tersimpan
                    (diarsipkan sebelum fitur ini ada).
                    <div style={{ marginTop: 6 }}>
                      <Btn size="sm" onClick={hitungUlangSemuaArsip} disabled={hitungUlangLoading}>
                        {hitungUlangLoading ? "Menghitung..." : "Hitung Ulang Sekarang"}
                      </Btn>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.red, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Kewajiban</span><span>{fmtRp(totalKewajiban)}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", margin: "16px 0 6px" }}>Ekuitas</div>
              {[
                ["Modal Disetor", modalDisetor],
                ["Laba Ditahan (akumulasi, angka sisa)", labaDitahanPlug],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: T.gray600 }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: val < 0 ? T.red : T.gray800 }}>{fmtRp(val)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.green, borderTop: `1px solid ${T.gray100}`, marginTop: 4 }}>
                <span>Subtotal Ekuitas</span><span>{fmtRp(totalEkuitas)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: T.greenLt, borderRadius: 8, marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.green }}>TOTAL KEWAJIBAN + EKUITAS</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: T.green }}>{fmtRp(totalKewajiban + totalEkuitas)}</span>
              </div>
            </Card>
          </div>
          {modalDisetor === 0 && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: T.orangeLt, border: `1px solid ${T.orange}44`, borderRadius: 8, fontSize: 12, color: T.gray700 }}>
              <Icon.warning size={13} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 5 }} />
              Modal Disetor belum diisi (masih Rp0) — isi di tombol Konfigurasi pada sub-tab "Bagi Hasil & Laba Rugi" supaya Laba Ditahan & ROE lebih akurat.
            </div>
          )}

          {/* ✅ FASE 8 (OPSI B): Neraca versi Jurnal — TAMPIL BERDAMPINGAN
              dengan Laporan Neraca lama di atas, TIDAK menggantikannya.
              Dihitung dari saldoAkunBulanan + jurnalUmum (double-entry),
              independen sepenuhnya dari perhitungan lama di atas — supaya
              bisa dibandingkan dulu sebelum diputuskan migrasi penuh. */}
          <NeracaVersiJurnal db={db} />
        </>
      )}

      {section === "tutupbuku" && (
        <>
          {/* ✅ ALAT PEMBERSIHAN SEKALI-PAKAI (audit — data testing bersama
              periode Juni-Agustus 2026, dikonfirmasi Admin aman dihapus).
              Menarget ID SPESIFIK yang sudah diverifikasi dari ekspor RTDB,
              BUKAN "cari lalu hapus otomatis" — supaya tidak ada risiko
              salah kena data lain. Kartu ini otomatis hilang begitu semua
              targetnya sudah tidak ada (jadi aman ditinggal, tidak perlu
              diingat untuk dihapus manual nanti). */}
          {(() => {
            const targetJurnal2026 = ["J_msvvvkrxgwvnos","J_msvvvkrxva79c7","J_mt02wocxbeudem","J_mt02wocxhz36e5",
              "J_mt02x4r6g03inw","J_mt02x4r6p6v5ss","J_mt02ybffq3gtjn","J_mt02ybg5ndqdiz","J_mt02ybg5va2b1j",
              "J_mt02ybg62ee1ao","J_mt0lf9nko2wg86","J_mt0lfh028tnuy1","J_mt0lfh04t0fger","J_mt0lfvwwie2ico",
              "J_mt0lfvxj4o976e","J_mt0lgwxz92m8y5","J_mt0lgwyioznlpk","J_mt0lhbq1axgq9k","J_mt0lhbr6xelrne",
              "J_mt0li9azur4ftm","J_mt0li9bl9nzu0e","J_mt0liser6q3fq6","J_mt0liserwgip9w","J_mt0ljt5rbrvc01",
              "J_mt0ljt6aw4725q","J_mt0ll8ep4no5dq","J_mt0ll8f9t9e4zc"];
            const targetJurnal2023 = ["J_msmgmdhtycand6","J_msmgnssygy7nln","J_msmgnssywewyhq","J_mso1qpxh75i2c5"];
            const targetAsetId = "ASTmsmgmdhi99e8j0";
            const targetOpnameId = "SOmsmgdtcg7wu5yo";
            const jurnal2026Ids = new Set((db.jurnalUmum||[]).map(j=>j.id));
            const asetAda = (db.asetAmortisasi||[]).some(a=>a.id===targetAsetId);
            const opnameAda = (db.stockOpname||[]).some(o=>o.id===targetOpnameId);
            const sisaJurnal = [...targetJurnal2026, ...targetJurnal2023].filter(id => jurnal2026Ids.has(id));
            const totalSisa = sisaJurnal.length + (asetAda?1:0) + (opnameAda?1:0);
            if (totalSisa === 0) return null;
            return (
              <Card style={{ marginBottom: 16, border: `1.5px solid #FCA5A5` }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.red, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon.delete size={16} strokeWidth={2} /> Bersihkan Sisa Data Testing (satu kali)
                </div>
                <div style={{ fontSize: 12, color: T.gray500, marginBottom: 12 }}>
                  {totalSisa} item sisa dari testing Tutup Buku bersama (jurnal Beban Usaha/Dana Cadangan/Amortisasi
                  yang tabrakan, Aset "Rak display", Stock Opname 9 Agustus) — sudah dikonfirmasi aman dihapus.
                  Kartu ini otomatis hilang setelah dijalankan.
                </div>
                <Btn variant="secondary" icon={Icon.delete} onClick={() => {
                  if (!confirm(`Hapus ${totalSisa} item sisa testing ini? Tidak bisa dibatalkan (tapi memang cuma data testing, bukan transaksi asli).`)) return;
                  sisaJurnal.forEach(id => deleteRecord("jurnalUmum", id));
                  if (asetAda) deleteRecord("asetAmortisasi", targetAsetId);
                  if (opnameAda) deleteRecord("stockOpname", targetOpnameId);
                  alert(`Selesai — ${totalSisa} item sisa testing sudah dihapus. Silakan cek ulang Tutup Buku Periode 2026-07.`);
                }}>Hapus {totalSisa} Item Sisa Testing</Btn>
              </Card>
            );
          })()}

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.checklist size={16} strokeWidth={2} /> Tutup Buku Bulan Berjalan
            </div>
            <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14 }}>
              Menutup buku bulan tertentu akan mengunci transaksi Kas, Stock Opname, & Hutang/Piutang bertanggal di bulan itu — mencegah perubahan tidak sengaja pada data yang sudah final. Bisa dibuka kuncinya lagi kapan saja kalau memang perlu dikoreksi.
            </div>
            {periodeMode !== "bulanan" ? (
              <div style={{ padding: "10px 14px", background: T.gray50, borderRadius: 8, fontSize: 12, color: T.gray600 }}>
                Pilih mode periode <b>Bulanan</b> di bagian atas (Filter Periode) untuk menutup buku bulan tertentu.
              </div>
            ) : bulanIniSudahTertutup ? (
              <div style={{ padding: "12px 16px", background: T.greenLt, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ Periode {bulanIniKey} sudah ditutup buku</span>
                <Btn size="sm" variant="secondary" onClick={() => bukaKunciBulan(bulanIniKey)}>Buka Kunci</Btn>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Catatan Penutupan (opsional)</label>
                  <input value={catatanTutupBuku} onChange={e => setCatatanTutupBuku(e.target.value)} placeholder="cth: sudah dicek & cocok per akhir bulan"
                    style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                {(() => {
                  const bebanUsahaListPreview = Array.isArray(config.bebanUsaha) ? config.bebanUsaha : migrasiBebanUsahaLama(config);
                  const sekaliPending = bebanUsahaListPreview.filter(b => b.frekuensi === "sekali" && !b.diakruPadaBulan);
                  const sekaliSudah = bebanUsahaListPreview.filter(b => b.frekuensi === "sekali" && b.diakruPadaBulan);
                  if (sekaliPending.length === 0 && sekaliSudah.length === 0) return null;
                  return (
                    <div style={{ padding: "10px 14px", background: T.gray50, borderRadius: 8, fontSize: 12, color: T.gray600, marginBottom: 12 }}>
                      {sekaliPending.length > 0 && (
                        <div style={{ marginBottom: sekaliSudah.length > 0 ? 4 : 0 }}>
                          <b style={{ color: T.gray700 }}>Item Beban Usaha "Sekali" yang akan diakru bulan ini:</b>{" "}
                          {sekaliPending.map(b => `${b.nama} (${fmtRp(Number(b.nominal)||0)})`).join(", ")}.
                        </div>
                      )}
                      {sekaliSudah.length > 0 && (
                        <div>
                          <b style={{ color: T.gray400 }}>Sudah diakru sebelumnya (dilewati bulan ini):</b>{" "}
                          {sekaliSudah.map(b => `${b.nama} — bulan ${b.diakruPadaBulan}`).join(", ")}.
                        </div>
                      )}
                    </div>
                  );
                })()}
                <Btn icon={Icon.save} onClick={tutupBukuBulanIni}>Tutup Buku Periode {bulanIniKey}</Btn>
              </>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.landmark size={16} strokeWidth={2} /> Riwayat Periode Tertutup
            </div>
            {tutupBukuArr.length === 0 ? (
              <div style={{ textAlign: "center", color: T.gray400, padding: 24, fontSize: 12 }}>Belum ada periode yang ditutup buku.</div>
            ) : (
              <Table
                data={[...tutupBukuArr].sort((a, b) => (b.id || "").localeCompare(a.id || ""))}
                columns={[
                  { key: "id", label: "Periode" },
                  { key: "tanggalTutup", label: "Ditutup Tanggal" },
                  { key: "snapshotSaldoKas", label: "Saldo Kas (saat ditutup)", render: v => fmtRp(v || 0) },
                  { key: "snapshotSHU", label: "SHU (saat ditutup)", render: v => fmtRp(v || 0) },
                  { key: "catatan", label: "Catatan", render: v => v || "-" },
                ]}
                onDelete={bukaKunciBulan}
              />
            )}
            <div style={{ fontSize: 11, color: T.gray400, marginTop: 10 }}>Tombol hapus di tabel ini berfungsi sebagai "Buka Kunci" periode.</div>
          </Card>
        </>
      )}

      {section === "jurnalpembuka" && (
        <JurnalPembukaForm db={db} postJurnal={postJurnal} voidJurnal={voidJurnal} createdBy={createdBy} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  FASE 8 (OPSI B) — NERACA VERSI JURNAL (perbandingan, BUKAN pengganti)
// ═══════════════════════════════════════════════════════════════════════
// Dihitung SEPENUHNYA independen dari NeracaKeuangan di atas — sumbernya
// cuma saldoAkunBulanan + jurnalUmum (double-entry, Fase 1-7). Tujuannya
// supaya admin bisa bandingkan dulu dengan Laporan Neraca lama sebelum
// diputuskan migrasi penuh (mengganti, bukan cuma menambah section ini).
function NeracaVersiJurnal({ db }) {
  const daftarAkunEfektif = db.daftarAkun && Object.keys(db.daftarAkun).length > 0 ? db.daftarAkun : DEFAULT_DAFTAR_AKUN;
  const { saldoAkhir, bulanTerakhirTertutup } = useMemo(
    () => hitungSaldoAkunTerkini(db.jurnalUmum, db.saldoAkunBulanan, daftarAkunEfektif),
    [db.jurnalUmum, db.saldoAkunBulanan, daftarAkunEfektif]
  );
  const ringkasan = useMemo(() => ringkasanSaldoAkunPerTipe(saldoAkhir, daftarAkunEfektif), [saldoAkhir, daftarAkunEfektif]);
  const [expanded, setExpanded] = useState(false);
  const LABEL_TIPE = { aset: "Aset", kewajiban: "Kewajiban", ekuitas: "Ekuitas", pendapatan: "Pendapatan (belum ditutup)", beban: "Beban (belum ditutup)" };
  const WARNA_TIPE = { aset: T.blue, kewajiban: T.red || "#DC2626", ekuitas: T.green, pendapatan: T.gold, beban: T.orange };

  return (
    <Card style={{ marginTop: 16, border: `1.5px dashed ${T.gray300}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.gray700 }}>
          🧪 Neraca (versi Jurnal) — Perbandingan
        </div>
        <Btn size="sm" onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}>{expanded ? "Sembunyikan" : "Tampilkan"}</Btn>
      </div>
      <div style={{ fontSize: 11.5, color: T.gray500, marginTop: 6, lineHeight: 1.5 }}>
        Dihitung dari <b>saldo akun double-entry</b> (Fase 1-7), independen sepenuhnya dari perhitungan
        Laporan Neraca di atas — untuk DIBANDINGKAN dulu, bukan pengganti. Saldo per{" "}
        <b>{bulanTerakhirTertutup ? `setelah tutup buku ${bulanTerakhirTertutup}` : "hari ini (belum pernah ada Tutup Buku)"}</b>.
      </div>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: ringkasan.balance ? T.greenLt : T.orangeLt,
            border: `1.5px solid ${ringkasan.balance ? T.green : T.orange}55`, borderRadius: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: ringkasan.balance ? T.green : T.orange }}>
              {ringkasan.balance ? "✓ Balance — Aset = Kewajiban + Ekuitas + Laba Berjalan" : "⚠️ TIDAK BALANCE — ada kesalahan jurnal"}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: ringkasan.balance ? T.green : T.orange }}>
              Selisih: {fmtRp(ringkasan.selisih)}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }} className="gw-grid3">
            <StatCard label="Total Aset" value={fmtRp(ringkasan.totalAset)} icon={Icon.wallet} color={T.blue} />
            <StatCard label="Kewajiban + Ekuitas" value={fmtRp(ringkasan.totalKewajibanEkuitas)} icon={Icon.spreadsheet} color={T.green} />
            <StatCard label="Laba Berjalan (blm ditutup)" value={fmtRp(ringkasan.labaBerjalan)} icon={Icon.rekap} color={T.gold} />
          </div>
          {Object.keys(LABEL_TIPE).map(tipe => (
            <div key={tipe} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: WARNA_TIPE[tipe], textTransform: "uppercase", marginBottom: 6 }}>
                {LABEL_TIPE[tipe]} — {fmtRp(ringkasan.perTipe[tipe])}
              </div>
              {ringkasan.rincian[tipe].filter(r => r.saldo !== 0).length === 0 ? (
                <div style={{ fontSize: 12, color: T.gray400, fontStyle: "italic" }}>Belum ada saldo</div>
              ) : (
                ringkasan.rincian[tipe].filter(r => r.saldo !== 0).map(r => (
                  <div key={r.kode} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: T.gray600 }}>
                    <span>{r.kode} — {r.nama}</span><span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(r.saldo)}</span>
                  </div>
                ))
              )}
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: T.gray400, marginTop: 4 }}>
            ⚠️ Pendapatan & Beban di atas belum pernah "ditutup" (closing entry) ke Laba Ditahan — jadi
            saldonya adalah akumulasi SEJAK AWAL PEMAKAIAN, bukan cuma periode berjalan.
          </div>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  JURNAL PEMBUKA (Saldo Awal) — persiapan migrasi penuh ke Neraca Jurnal
// ═══════════════════════════════════════════════════════════════════════
// Kenapa fitur ini perlu ada SEBELUM Neraca versi Jurnal (Fase 8, di atas)
// bisa diandalkan sebagai sumber kebenaran tunggal: Fase 1-9 hanya
// memposting jurnal untuk TRANSAKSI yang terjadi SETELAH sistem jurnal
// dipakai (Kas, Kontrol, Aset baru, Hutang/Piutang baru, dst) — tidak ada
// mekanisme yang otomatis "mengisi" saldo yang SUDAH ADA sebelum migrasi
// (Modal, Kas riil, Persediaan Gudang/Toko, Aset Tetap existing). Tanpa
// entry pembuka, akun-akun itu diam-diam mulai dari 0 — paling parah untuk
// 1111 (Persediaan Beredar di Toko) yang TERUS DIKURANGI tiap ada penjualan
// Kontrol sejak hari pertama, jadi akan bergerak ke NEGATIF tanpa henti
// kalau nilai stok yang sudah beredar duluan tidak pernah "dimasukkan" ke
// jurnal lewat entry ini.
//
// Desain: SATU entry jurnal gabungan (sumberTipe:"jurnalPembuka",
// sumberId tetap "OPENING" — cuma boleh ada SATU aktif kapan pun, dicek
// lewat `existing` di bawah) berisi saldo AWAL tiap akun Aset/Kewajiban/
// Ekuitas (bukan Pendapatan/Beban — itu memang harus mulai dari 0 karena
// sifatnya akumulasi sejak pemakaian, lihat catatan di NeracaVersiJurnal).
// Nilai yang diisi diinterpretasikan sebagai NORMAL BALANCE akun itu
// (mis. isi 5000000 di 1101 Kas → otomatis jadi DEBIT 5000000, isi
// 5000000 di 2101 Hutang Usaha → otomatis jadi KREDIT 5000000) — supaya
// pengguna tidak perlu mikir debit/kredit manual, cukup isi "berapa
// saldonya", searah dengan cara berpikir Neraca biasa.
//
// Kalau total sisi Aset ≠ total sisi Kewajiban+Ekuitas yang diisi (jamak
// terjadi karena Modal Disetor riil sering tidak persis diketahui),
// tombol "Auto-isi Selisih ke Modal Disetor" menghitung selisihnya dan
// menaruhnya ke 3101 — konsisten dengan definisi Modal Disetor sebagai
// sisa klaim pemilik atas Aset setelah dikurangi Kewajiban.
function JurnalPembukaForm({ db, postJurnal, voidJurnal, createdBy }) {
  const daftarAkunEfektif = db.daftarAkun && Object.keys(db.daftarAkun).length > 0 ? db.daftarAkun : DEFAULT_DAFTAR_AKUN;
  const akunNeraca = useMemo(() => Object.keys(daftarAkunEfektif)
    .filter(k => ["aset", "kewajiban", "ekuitas"].includes(getTipeAkunDariKode(k)) && daftarAkunEfektif[k]?.aktif !== false)
    .sort(), [daftarAkunEfektif]);

  const existing = (db.jurnalUmum || []).find(j => j.sumberTipe === "jurnalPembuka" && j.sumberId === "OPENING" && !j.void);

  const [tanggal, setTanggal] = useState(todayStr());
  const [keterangan, setKeterangan] = useState("Saldo awal migrasi ke sistem jurnal double-entry");
  const [nilai, setNilai] = useState({}); // { kode: "angka string" }

  const totalDebit = akunNeraca.reduce((s, k) => (getNormalBalance(k) === "debit" ? s + (Number(nilai[k]) || 0) : s), 0);
  const totalKredit = akunNeraca.reduce((s, k) => (getNormalBalance(k) === "kredit" ? s + (Number(nilai[k]) || 0) : s), 0);
  const selisih = Math.round((totalDebit - totalKredit) * 100) / 100;
  const jumlahDiisi = akunNeraca.filter(k => (Number(nilai[k]) || 0) !== 0).length;

  function autoIsiSelisihKeModal() {
    const modalSaatIni = Number(nilai["3101"]) || 0;
    // 3101 Modal Disetor bertipe ekuitas → normal balance KREDIT. Menaikkan
    // nilainya sebesar `selisih` (Debit − Kredit saat ini) membuat totalKredit
    // ikut naik sebesar itu, sehingga selisih baru = 0.
    setNilai(n => ({ ...n, "3101": String(modalSaatIni + selisih) }));
  }

  function submit() {
    if (existing) return;
    if (jumlahDiisi < 2) return alert("Isi minimal 2 akun (kalau cuma 1 sisi yang diisi, tidak mungkin balance).");
    if (selisih !== 0) return alert(`Belum balance — Total Aset (Rp${fmt(totalDebit)}) ≠ Total Kewajiban+Ekuitas (Rp${fmt(totalKredit)}), selisih Rp${fmt(selisih)}. Pakai tombol "Auto-isi Selisih ke Modal Disetor" atau koreksi manual dulu.`);
    if (!confirm(`Posting Jurnal Pembuka per ${tanggal}? Ini akan jadi SALDO AWAL sistem jurnal untuk ${jumlahDiisi} akun. Sebaiknya cuma dilakukan SEKALI — kalau nanti ada yang salah, batalkan dulu lewat tombol "Batalkan" sebelum input ulang.`)) return;
    const baris = akunNeraca.map(k => {
      const v = Number(nilai[k]) || 0;
      if (v === 0) return null;
      const isDebit = getNormalBalance(k) === "debit";
      return { akun: k, debit: isDebit ? v : 0, kredit: isDebit ? 0 : v };
    }).filter(Boolean);
    try {
      postJurnal({ tanggal, sumberTipe: "jurnalPembuka", sumberId: "OPENING", keterangan, baris, createdBy });
      setNilai({});
      alert("Jurnal Pembuka berhasil diposting. Cek hasilnya di \"Neraca (versi Jurnal)\" pada sub-tab Laporan Neraca.");
    } catch (e) {
      alert(`Gagal memposting Jurnal Pembuka: ${e.message}`);
    }
  }

  function batalkan() {
    if (!existing || !voidJurnal) return;
    if (!confirm("Batalkan Jurnal Pembuka yang sudah diposting? Ini akan membalik semua saldo awalnya (jadi 0 lagi) — dipakai kalau mau input ulang dari awal karena ada yang salah.")) return;
    voidJurnal(existing.id, { alasan: "Jurnal Pembuka dibatalkan untuk diinput ulang", createdBy });
  }

  const LABEL_TIPE = { aset: "Aset", kewajiban: "Kewajiban", ekuitas: "Ekuitas" };
  const grouped = { aset: [], kewajiban: [], ekuitas: [] };
  akunNeraca.forEach(k => grouped[getTipeAkunDariKode(k)].push(k));

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.gray800, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.piggyBank size={16} strokeWidth={2} /> Jurnal Pembuka (Saldo Awal)
        </div>
        <div style={{ fontSize: 12, color: T.gray400, marginBottom: 14, lineHeight: 1.5 }}>
          Isi SEKALI SAJA sebelum "Neraca (versi Jurnal)" dipakai sebagai acuan resmi — supaya akun seperti Persediaan
          Beredar di Toko, Aset Tetap, Kas, dan Modal tidak diam-diam mulai dari Rp0 padahal secara riil sudah ada
          nilainya sejak sebelum sistem jurnal ini dipakai. Cukup isi akun yang relevan (boleh dikosongkan kalau
          memang belum ada/masih Rp0) — nilai yang diisi otomatis dianggap sebagai saldo NORMAL akun itu (Aset & Beban
          = Debit, Kewajiban/Ekuitas/Pendapatan = Kredit), tidak perlu pusing debit/kredit manual.
        </div>

        {existing ? (
          <div style={{ padding: "12px 16px", background: T.greenLt, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ Jurnal Pembuka sudah diposting ({existing.tanggal})</span>
              <Btn size="sm" variant="secondary" onClick={batalkan}>Batalkan</Btn>
            </div>
            {existing.keterangan && <div style={{ fontSize: 12, color: T.gray600, marginBottom: 8 }}>{existing.keterangan}</div>}
            {(existing.baris || []).map((b, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: T.gray600 }}>
                <span>{b.akun} — {daftarAkunEfektif[b.akun]?.nama || b.akun}</span>
                <span style={{ fontWeight: 600, color: T.gray800 }}>{fmtRp(b.debit || b.kredit)} ({b.debit > 0 ? "Debit" : "Kredit"})</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }} className="gw-grid2">
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Tanggal Saldo Awal</label>
                <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.gray600, display: "block", marginBottom: 4 }}>Keterangan</label>
                <input value={keterangan} onChange={e => setKeterangan(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>

            {Object.keys(LABEL_TIPE).map(tipe => (
              <div key={tipe} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, textTransform: "uppercase", marginBottom: 8 }}>{LABEL_TIPE[tipe]}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} className="gw-grid2">
                  {grouped[tipe].map(k => (
                    <div key={k}>
                      <label style={{ fontSize: 11.5, color: T.gray600, display: "block", marginBottom: 3 }}>{k} — {daftarAkunEfektif[k]?.nama || k}</label>
                      <input type="number" value={nilai[k] || ""} onChange={e => setNilai(n => ({ ...n, [k]: e.target.value }))} placeholder="0"
                        style={{ width: "100%", padding: "7px 10px", border: `1.5px solid ${T.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: selisih === 0 ? T.greenLt : T.orangeLt,
              border: `1.5px solid ${selisih === 0 ? T.green : T.orange}55`, borderRadius: 8, marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: selisih === 0 ? T.green : T.orange }}>
                {selisih === 0 ? "✓ Balance" : `⚠️ Belum balance — selisih ${fmtRp(selisih)}`}
              </span>
              <span style={{ fontSize: 12, color: T.gray600 }}>Aset: {fmtRp(totalDebit)} · Kewajiban+Ekuitas: {fmtRp(totalKredit)}</span>
            </div>
            {selisih !== 0 && (
              <Btn size="sm" variant="secondary" onClick={autoIsiSelisihKeModal} style={{ marginBottom: 12 }}>
                Auto-isi Selisih ke Modal Disetor (3101)
              </Btn>
            )}
            <div>
              <Btn icon={Icon.save} onClick={submit} disabled={selisih !== 0 || jumlahDiisi < 2}>Posting Jurnal Pembuka</Btn>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
