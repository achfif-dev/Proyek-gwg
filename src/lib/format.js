// Formatter DIBUAT SEKALI: membuat `new Intl.NumberFormat(...)` itu mahal (puluhan µs di desktop,
// lebih lama di HP) dan dulu dilakukan di SETIAP panggilan fmt() — ribuan kali per render tabel.
const _formatAngkaId = new Intl.NumberFormat("id-ID");
export const fmt = (n) => _formatAngkaId.format(n||0);
export const fmtRp = (n) => "Rp " + fmt(n);
export function genId(prefix, arr) {
  const nums = (arr||[]).map(r => parseInt(r.id?.replace(/\D/g,""))||0);
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return `${prefix}${String(next).padStart(3,"0")}`;
}

// ✅ FIX (audit, dilaporkan lewat screenshot Master Toko — banyak toko beda
// kebagian "kode" tampilan yang SAMA persis, mis. "GW-SMP-780116971" muncul
// di 14 toko sekaligus): dulu nomor urut "kode" toko (GW-<rute>-###) dibuat
// lewat genId("T", listToko) — yaitu ambil ANGKA dari `id` toko itu sendiri.
// Itu cocok SELAMA id toko masih format lama "T014" (murni angka). Tapi
// sejak id toko dipindah ke genUniqueId() (fix ID-collision, campuran huruf
// + angka basis-36 dari timestamp — lihat format di bawah), membuang huruf
// dari id semacam itu menyisakan angka ACAK yang gampang KEBETULAN SAMA
// untuk toko-toko yang dibuat berdekatan waktu (satu sesi import: Date.now()
// hampir sama, digit yang tersisa setelah huruf dibuang pun sering identik)
// — makanya kodenya jadi tabrakan massal, bukan cuma sesekali.
// Sekarang nomor urut kode diambil dari field `kode` YANG SUDAH ADA di
// record (bukan dari `id`) — field ini murni angka di ujungnya sejak dulu,
// jadi tetap bisa diandalkan sebagai sumber urutan berikutnya, terlepas
// format `id` internalnya seperti apa.
export function nextKodeCounter(existingList) {
  const nums = (existingList||[]).map(r => {
    const m = String(r.kode||"").match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// ID unik lintas-perangkat: dipakai khusus untuk record yang bisa dibuat
// otomatis dari beberapa perangkat/sesi hampir bersamaan (mis. auto-register
// pengguna baru saat login). BEDA dengan genId() yang sekuensial berbasis
// data lokal — genId() bisa menghasilkan ID yang SAMA di dua perangkat kalau
// datanya belum ter-sync, sehingga tulisan salah satu perangkat akan
// MENIMPA (bukan menambah) data perangkat lain di Firebase (path per-id).
// genUniqueId() memakai timestamp + random supaya praktis mustahil bentrok
// walau dibuat di waktu yang hampir sama oleh perangkat berbeda.
export function genUniqueId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

// Normalisasi teks untuk perbandingan duplikat: lowercase + trim +
// rapikan spasi ganda, supaya "Toko  Barokah" dan "toko barokah" terdeteksi sama.
export function normTxt(s) {
  return String(s||"").trim().toLowerCase().replace(/\s+/g," ");
}
// Perbandingan "natural sort": memecah nama menjadi potongan teks & angka,
// lalu membandingkan potongan angka SEBAGAI ANGKA (bukan string). Ini supaya
// "Bklu2" terurut sebelum "Bklu10" (bukan "Bklu1, Bklu10, Bklu11, ..., Bklu2"
// seperti pada urutan alfabetis biasa).
// Perbandingan "alami" (Rute 2 < Rute 10). Versi lama menjalankan 2 regex match + banyak
// regex test + localeCompare(...) berpilihan PADA SETIAP perbandingan; di Tab Kontrol ia
// dipanggil ratusan ribu kali saat memilih Wilayah (ringkasan per tanggal). Sekarang
// pemecahan token di-cache per string & pembanding Intl.Collator dipakai ulang — hasil
// IDENTIK (diuji terhadap implementasi lama di tests/natural-compare.test.mjs).
const _kolatorAlami = new Intl.Collator("id", { sensitivity: "base" });
const _cacheToken = new Map();
function _tokenAlami(v) {
  const str = String(v || "");
  let t = _cacheToken.get(str);
  if (t === undefined) {
    if (_cacheToken.size > 20000) _cacheToken.clear();
    const bagian = str.match(/(\d+|\D+)/g) || [];
    t = bagian.map(x => ({ s: x, n: /^\d+$/.test(x) ? parseInt(x, 10) : null }));
    _cacheToken.set(str, t);
  }
  return t;
}
export function naturalCompare(a, b) {
  const ax = _tokenAlami(a), bx = _tokenAlami(b);
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const A = ax[i], B = bx[i];
    if (A && B && A.n !== null && B.n !== null) {
      const diff = A.n - B.n;
      if (diff !== 0) return diff;
    } else {
      const cmp = _kolatorAlami.compare(A ? A.s : "", B ? B.s : "");
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
// Sort alfabetis + natural angka (case-insensitive, locale Indonesia) —
// dipakai supaya Master Wilayah, Master Rute, dan Master Toko selalu terurut
// otomatis walau ada penambahan data baru di kemudian hari, termasuk urutan
// angka di akhir nama (Bklu1, Bklu2, ... Bklu10, bukan Bklu1, Bklu10, Bklu2).
export function sortByNama(arr, key="nama") {
  return [...(arr||[])].sort((a,b) => naturalCompare(a[key], b[key]));
}

// Urutan produk TUNGGAL untuk seluruh aplikasi (Master Produk, Tambah/Edit
// Kontrol, tabel Kontrol, Rekap, Master Toko, template import, Dashboard).
// Sumber kebenarannya field `urutan` yang diatur admin lewat tombol ↑/↓ di
// tab Produk. Produk lama yang belum punya `urutan` fallback ke posisi
// aslinya di array supaya tampilan yang sudah ada tidak tiba-tiba berubah.
// Sort stabil: dua produk dengan nilai sama tetap mengikuti urutan array.
export function sortProdukByUrutan(arr) {
  return (arr||[])
    .map((p,i) => ({ p, eff: typeof p.urutan === "number" ? p.urutan : i, i }))
    .sort((a,b) => a.eff - b.eff || a.i - b.i)
    .map(x => x.p);
}
