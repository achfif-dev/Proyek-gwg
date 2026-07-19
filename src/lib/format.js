export const fmt = (n) => new Intl.NumberFormat("id-ID").format(n||0);
export const fmtRp = (n) => "Rp " + fmt(n);
export function genId(prefix, arr) {
  const nums = (arr||[]).map(r => parseInt(r.id?.replace(/\D/g,""))||0);
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return `${prefix}${String(next).padStart(3,"0")}`;
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
export function naturalCompare(a, b) {
  const ax = String(a||"").match(/(\d+|\D+)/g) || [];
  const bx = String(b||"").match(/(\d+|\D+)/g) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const an = ax[i] ?? "";
    const bn = bx[i] ?? "";
    const aIsNum = /^\d+$/.test(an);
    const bIsNum = /^\d+$/.test(bn);
    if (aIsNum && bIsNum) {
      const diff = parseInt(an,10) - parseInt(bn,10);
      if (diff !== 0) return diff;
    } else {
      const cmp = an.localeCompare(bn, "id", { sensitivity:"base" });
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
