// Proporsi baris `kandidat` (halaman yang akan dirender) yang SUDAH ada di layar pada render
// sebelumnya (`idTampil`: Set id). Dipakai Table untuk memutuskan apakah perlu render bertahap:
// bila sebagian besar baris sama (mis. satu baris diedit, atau hasil pencarian menyempit),
// React cukup memperbarui DOM yang ada → tak perlu dipotong jadi 15 baris dulu (itu malah
// membuat tabel menciut lalu melebar dan posisi gulir pengguna melompat).
export function proporsiBarisSama(idTampil, kandidat) {
  if (!kandidat || kandidat.length === 0) return 1;
  let sama = 0;
  for (let i = 0; i < kandidat.length; i++) if (idTampil.has(kandidat[i].id)) sama++;
  return sama / kandidat.length;
}
export const AMBANG_BARIS_SAMA = 0.5;
