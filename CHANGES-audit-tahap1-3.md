# CHANGES — Audit keandalan data & keamanan (tahap 1–3)

Semua perubahan di bawah berasal dari audit kode + Firebase Rules. Tidak ada
perubahan pada skema data; klien baru tetap berjalan dengan rules lama (v10)
maupun rules baru (v11).

## Tahap 1 — antrean tulis offline & ID pengguna
- `src/lib/offlineStore.js`: perubahan yang DITOLAK rules tidak lagi dihapus dari
  antrean — ditandai `denied` dan tetap tersimpan di IndexedDB. Hapus-bersyarat
  (versi entri harus sama) sehingga edit baru pada path yang sama tidak ikut
  hilang. Urutan kirim tidak pernah kembar. `drainQueue()` dipakai `useDB`.
- `src/App.jsx`: banner "DITOLAK" baru — Kirim Ulang / Simpan Cadangan (JSON) /
  Buang / Tutup.
- `src/hooks/useDB.js`: pengiriman antrean lewat `drainQueue`; retry sekali
  setelah token diperbarui; fallback kirim langsung bila IndexedDB tidak ada;
  `pindahIdPengguna()`.
- `src/features/pengguna/TabPengguna.jsx`: "Tambah Pengguna" memakai ID
  `U_<email>` (dicari oleh rules); banner "Perbaiki ID" untuk baris lama.

## Tahap 3 — backup, restore, reset
- `src/lib/backupRestore.js` (baru, logika murni): snapshot dibaca dari SERVER
  (semua tahun kontrol + jurnalUmum), reset/restore ditulis PER RECORD sesuai
  level izin rules. Tabel `pengguna` tidak ikut reset/restore.
- Backup harian kini menyertakan `jurnalUmum` dan semua tahun kontrol, dibuat
  dari server (bukan dari state layar yang bisa parsial), hanya oleh
  Admin/Manajer; penanda "sudah backup hari ini" ditulis setelah sukses.
  Pemangkasan backup lama memakai `?shallow=true` (tidak mengunduh semua
  snapshot). Ubah `HARIAN_TERMASUK_JURNAL` bila database sudah sangat besar.
- Reset: kirim antrean dulu → backup pengaman lengkap (harus berhasil) → hapus
  transaksi per record → baru master data. Berhenti bila satu tahap gagal.
- Restore: antrean dikirim dulu + backup pengaman "-sebelum-restore"; kontrol
  & jurnal benar-benar pulih (dulu selalu ditolak rules).
- Menu baru "Ekspor Penuh (semua tahun + jurnal)" + pengingat mingguan untuk Admin.

## Rules
- `firebase-rules/database_rules_v11_hardening.json` — BELUM aktif sampai
  ditempel di Firebase Console → Realtime Database → Rules.

## Belum diperbaiki
- Rules v11 memerlukan klien mengirim `diterimaServerAt` untuk auto-approve
  oleh non-Admin; sampai itu dikerjakan, persetujuan otomatis hanya efektif
  lewat klien Admin/Manajer.
- Efek auto-approve di TabKontrol belum dibatasi role.
- Arsip tahun (kontrol/jurnal) masih menghapus di level {tahun} → ditolak rules
  (gagal dengan aman: data asli tidak diubah).
- `cloudLoaded` untuk Manajer/Sales; Viewer melihat UI Admin; escape HTML pada
  ekspor PDF web; workflow `generate-keystore.yml` mencetak password.
- Daftar backup (modal Backup) masih mengunduh semua snapshot saat dibuka.
