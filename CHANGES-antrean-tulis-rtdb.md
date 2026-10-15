# Perbaikan antrean tulis ke RTDB (input kontrol cepat tidak ikut tersinkron)

**Akar masalah (dari kode)**
1. `drainQueue` mengirim SATU tulisan per `await` — tiap tulisan menunggu ACK server dulu.
   Di sinyal seluler (RTT 0,3–1 dtk) hanya ±1–3 tulisan/dtk, sedangkan 1 input kontrol = 2+
   tulisan (record + `kontrolYearsIndex/{tahun}`), jadi input cepat admin menumpuk.
2. `kontrolYearsIndex/{tahun}` ditulis ulang di SETIAP input kontrol walau sudah ada di server.
3. Tiap path = 1 transaksi IndexedDB (simpan) + 1 transaksi (hapus setelah terkirim).
4. Pengiriman dipicu paralel dengan penyimpanan antrean (balapan), dan jaring pengaman 30 dtk.
5. Satu tulisan yang tak pernah di-ACK (socket mati diam-diam) menahan seluruh antrean.

**Perbaikan**
- `offlineStore.js`: `drainQueue` kini berjendela-paralel (20 tulisan dipanggil berurutan tanpa
  menunggu ACK, lalu ditunggu bersama; SDK Firebase menjaga urutan). DENIED hanya menandai
  entri itu; error jaringan menghentikan setelah jendela (yang sukses tetap dihapus);
  timeout 25 dtk per jendela. Baru: `queueWriteMany` & `queueRemoveManyIfSame` (1 transaksi).
- `useDB.js`: `pushUpdates` memakai `queueWriteMany` dan memulai kirim SETELAH antrean
  tersimpan; index tahun kontrol tidak ditulis ulang bila sudah ada di server; kirim otomatis
  begitu `.info/connected` jadi true; interval jaring pengaman 30 -> 10 dtk; jumlah antrean
  diperbarui tiap jendela.
- `tests/antrean-kirim.test.mjs`: 7 test (kecepatan, urutan, denied, error, timeout, entri
  baru, versi path).

**Belum dicakup / risiko**
- Pipelining mengandalkan SDK Firebase mempertahankan urutan tulisan di satu koneksi (perilaku
  yang didokumentasikan), tapi belum diuji dengan RTDB asli.
- Tulisan dalam satu jendela TIDAK atomik (sama seperti sebelumnya: tiap path berdiri sendiri).
- Entri hasil timeout bisa terkirim dua kali (idempoten, nilai sama).
- `saveLocalDB` tetap men-serialisasi seluruh db per perubahan (didebounce 500 ms) — belum diubah.
