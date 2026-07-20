import { useState, useEffect, useRef, useCallback } from "react";
import { firebaseDB } from "../firebase/init";
import { idbGet, idbSet, queueWrite, queueRemove, queueGetAll, queueCount, saveLocalDB } from "../lib/offlineStore";
import { DB_EMPTY } from "../config/dbEmpty";
import { LIST_TABLES, arrToMap, mapToArr, kontrolYearOf, encodeEmailKey, decodeEmailKey } from "../lib/dataHelpers";
import { isSuperAdminEmail } from "../config/superAdmin";
import { gdriveUploadJSON, gdriveDownloadJSON, gdriveDeleteFile } from "../lib/googleDrive";
import { downloadJSON } from "../lib/fileSave";

export function useDB(user) {
  const [db, setDB] = useState(() => {
    try {
      const saved = localStorage.getItem("gwg_db_v2");
      return saved ? JSON.parse(saved) : DB_EMPTY;
    } catch { return DB_EMPTY; }
  });
  // Hidrasi dari IndexedDB begitu tersedia (di render pertama kita hanya
  // sempat membaca localStorage secara sinkron di atas). Kalau IndexedDB
  // punya salinan — misalnya localStorage gagal menyimpan versi terbaru
  // karena kuota penuh — timpa state dengan versi IndexedDB yang lebih
  // lengkap. Ini membuat data offline tetap utuh walau app baru dibuka
  // ulang dalam kondisi tanpa internet sama sekali.
  useEffect(() => {
    let cancelled = false;
    idbGet("gwg_db_v2").then((saved) => {
      if (!cancelled && saved) setDB(saved);
    });
    return () => { cancelled = true; };
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  // ✅ BARU: khusus menampung penolakan TULIS oleh security rules (bukan
  // gagal baca seperti syncError, dan bukan sekadar offline). Array berisi
  // { path, message, at } — setiap kali Firebase menolak satu perubahan
  // (permission-denied), dicatat di sini SUPAYA TAMPIL JELAS ke pengguna,
  // bukan didiamkan seolah cuma "belum sempat sinkron". Sebelumnya semua
  // jenis error (offline ATAU ditolak rules) diperlakukan SAMA — didiamkan
  // & dicoba lagi tiap 30 detik — sehingga penolakan permanen oleh rules
  // tidak pernah ketahuan pengguna: tampilan lokal sudah kadung berubah
  // (optimistic update), padahal Firebase yang sebenarnya menolaknya, jadi
  // perangkat/akun lain masih melihat data yang lama.
  const [writeDenied, setWriteDenied] = useState([]);
  const clearWriteDenied = useCallback(() => setWriteDenied([]), []);
  // cloudLoaded: true setelah snapshot PERTAMA dari Firebase diterima (baik
  // datanya ada isi atau kosong). Dipakai untuk MENCEGAH logika bootstrap-admin
  // di komponen utama berjalan sebelum kita benar-benar tahu isi database di
  // cloud — supaya tidak terjadi 2 perangkat berbeda mengira tabel "kosong" di
  // saat yang sama lalu masing-masing menambahkan dirinya sebagai Admin baru.
  const [cloudLoaded, setCloudLoaded] = useState(!firebaseDB); // jika Firebase tidak aktif, anggap langsung "loaded" (mode lokal)
  // Menyimpan snapshot mentah PER TABEL dari Firebase (bentuk map/objek apa
  // adanya), supaya saat menulis cukup hitung diff terhadap snapshot ini —
  // tidak perlu menulis ulang tabel yang tidak berubah.
  const remoteRef = useRef({}); // { wilayah: {...}, rute: {...}, ... , stokAwal: {...}, bagiHasilConfig: {...} }
  const basePathRef = useRef(null); // ref ke `gwg_data/shared`
  const deletedUsersRef = useRef({}); // { "email_encoded": true } — email yang sengaja dihapus admin

  // ─── PARTISI TAHUNAN UNTUK "kontrol" ───────────────────────────────────
  // Struktur di Firebase: gwg_data/shared/kontrol/{tahun}/{recordId}
  // (bukan lagi gwg_data/shared/kontrol/{recordId} langsung). Tujuannya
  // supaya klien tidak perlu men-download SELURUH riwayat penjualan
  // bertahun-tahun setiap kali aplikasi dibuka — cukup tahun berjalan +
  // tahun lalu yang otomatis dimuat; tahun-tahun lebih lama dimuat manual
  // saat dibutuhkan (lihat loadKontrolYear di bawah).
  // Di level UI, db.kontrol TETAP berupa array datar gabungan dari semua
  // tahun yang sudah dimuat — jadi seluruh tab/komponen yang sudah ada
  // TIDAK PERLU diubah sama sekali.
  const KONTROL_LIVE_YEARS = 1; // jumlah tahun terbaru yang otomatis live-sync — diturunkan dari 2 supaya hemat kuota unduhan Firebase menjelang pemakaian oleh sales lapangan (tahun lain tetap bisa dimuat manual dari menu Backup)
  const kontrolByYearRef = useRef({}); // { "2026": { id1:{...}, id2:{...} }, "2025": {...} }
  const kontrolYearUnsubsRef = useRef({}); // { "2026": () => {...} }
  const [loadedKontrolYears, setLoadedKontrolYears] = useState([]); // tahun yang sudah live-sync / dimuat
  const [availableKontrolYears, setAvailableKontrolYears] = useState([]); // semua tahun yang ADA di cloud (dari index ringan)

  // Subscribe Firebase realtime jika user login — SATU listener PER PATH
  // (per tabel), bukan satu listener di root yang mendownload semuanya
  // setiap kali ada perubahan di mana pun.
  useEffect(() => {
    if (!user || !firebaseDB) return;
    const { db: rtdb, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, off, set, get } = firebaseDB;
    // Tabel yang berpotensi tumbuh SANGAT besar (ribuan-ratusan ribu record
    // seiring waktu & jumlah toko): "kontrol" (data penjualan/kunjungan
    // bulanan — bertambah terus setiap bulan x setiap toko) dan "toko"
    // (bisa mencapai 5.000-20.000 baris). Untuk tabel ini kita HINDARI
    // `onValue` di root tabel, karena onValue mengirim ULANG SELURUH isi
    // tabel ke SETIAP klien yang sedang online setiap kali SATU record saja
    // berubah — biaya bandwidth-nya tumbuh sebagai (jumlah record) x
    // (jumlah klien online) x (jumlah perubahan), yang paling cepat
    // menghabiskan kuota gratis Firebase (Spark: 10GB/bulan). Sebagai
    // gantinya kita pakai listener per-child (onChildAdded/Changed/Removed)
    // yang hanya mengirim record yang benar-benar berubah — struktur data
    // di Firebase TETAP SAMA PERSIS, jadi tidak perlu migrasi apa pun.
    const LARGE_TABLES = new Set(["toko"]); // "kontrol" ditangani terpisah (partisi tahun) di bawah
    basePathRef.current = ref(rtdb, `gwg_data/shared`);

    const paths = [...LIST_TABLES, "stokAwal", "bagiHasilConfig"];
    const loadedSet = new Set(); // path mana yang sudah memberi snapshot pertama
    setSyncing(true);

    // MIGRASI SATU KALI: jika project ini masih memakai struktur LAMA (satu
    // blob besar tersimpan persis di root "gwg_data/shared", lengkap dengan
    // field seperti wilayah/rute/toko sebagai ARRAY langsung di root), maka
    // tulis ulang sebagai path-path terpisah sebelum listener di bawah mulai
    // membaca. Supaya tidak men-download seluruh root setiap kali ada yang
    // login (mahal untuk database besar), kita cek dulu lewat path KECIL
    // `gwg_data/shared/_migratedV3` — hanya jika flag ini BELUM ada, baru kita
    // baca root sekali untuk migrasi, lalu set flag supaya login-login
    // berikutnya melewati langkah ini sepenuhnya.
    async function migrateIfNeeded() {
      try {
        const flagSnap = await get(ref(rtdb, `gwg_data/shared/_migratedV3`));
        if (flagSnap.val() === true) return; // sudah pernah dimigrasi, skip
        const rootSnap = await get(ref(rtdb, `gwg_data/shared`));
        const rootVal = rootSnap.val();
        const isOldShape = rootVal && LIST_TABLES.some(key => Array.isArray(rootVal[key]));
        if (isOldShape) {
          // PENTING: hanya tulis ulang key yang BENAR-BENAR ada (berbentuk array)
          // di rootVal. JANGAN looping semua LIST_TABLES tanpa pengecekan —
          // kalau root hanya berisi sebagian tabel (misal hasil import JSON
          // parsial / restrukturisasi manual lewat Firebase Console yang hanya
          // menyertakan sebagian data), arrToMap(undefined) akan menghasilkan
          // {} kosong dan ITU AKAN MENIMPA / MENGHAPUS data tabel lain yang
          // sebenarnya masih valid tersimpan di path-nya masing-masing. Ini
          // adalah akar bug "data lama hilang setelah deploy JSON baru".
          const writes = {};
          LIST_TABLES.forEach(key => {
            if (Array.isArray(rootVal[key])) writes[key] = arrToMap(rootVal[key]);
          });
          if (rootVal.stokAwal !== undefined) writes.stokAwal = rootVal.stokAwal || {};
          if (rootVal.bagiHasilConfig !== undefined) writes.bagiHasilConfig = rootVal.bagiHasilConfig ?? null;
          if (Object.keys(writes).length > 0) {
            await Promise.all(Object.entries(writes).map(([key, val]) =>
              set(ref(rtdb, `gwg_data/shared/${key}`), val)
            ));
          }
        }
        await set(ref(rtdb, `gwg_data/shared/_migratedV3`), true); // tandai selesai, walau tidak ada yang dimigrasi
      } catch (e) {
        console.warn("Migrasi struktur lama gagal (akan tetap lanjut baca per-path):", e);
      }
    }

    const unsubs = [];
    migrateIfNeeded().finally(() => {
      // Subscribe listener untuk daftar email yang sudah dihapus admin,
      // agar auto-register tidak mendaftarkan ulang pengguna yang dihapus.
      // PENTING: ikutkan "deletedUsers" ke dalam loadedSet tracking supaya
      // cloudLoaded tidak di-set true sebelum blacklist ini selesai diterima
      // dari Firebase — mencegah race condition di mana auto-register jalan
      // saat deletedUsersRef masih kosong meski pengguna sudah ada di blacklist.
      const deletedRef = ref(rtdb, `gwg_data/shared/deletedUsers`);
      const unsubDeleted = onValue(deletedRef, snap => {
        deletedUsersRef.current = snap.val() || {};
        loadedSet.add("deletedUsers");
        if (loadedSet.size >= paths.length + 1) { // +1 untuk deletedUsers
          setSyncing(false);
          setCloudLoaded(true);
        }
      });
      unsubs.push(() => off(deletedRef));

      const markLoadedAndFlush = (key) => {
        loadedSet.add(key);
        setLastSync(new Date());
        setSyncError(null);
        if (loadedSet.size >= paths.length + 1) { // +1 karena deletedUsers juga dihitung
          setSyncing(false);
          setCloudLoaded(true);
        }
      };

      paths.forEach(key => {
        const r = ref(rtdb, `gwg_data/shared/${key}`);

        if (key === "kontrol") {
          // ── "kontrol" dipartisi per-tahun: gwg_data/shared/kontrol/{tahun}/{id} ──
          // Kita hanya live-sync tahun berjalan + KONTROL_LIVE_YEARS-1 tahun
          // sebelumnya secara otomatis. Tahun-tahun lebih lama BELUM dimuat
          // sampai admin memanggil loadKontrolYear(tahun) secara eksplisit
          // (lihat tombol "Muat Data Tahun Lama" di menu Cadangan/Admin).
          const thisYear = new Date().getFullYear();
          const liveYears = Array.from({ length: KONTROL_LIVE_YEARS }, (_, i) => String(thisYear - i));

          const recomputeKontrolArr = () => {
            const merged = {};
            Object.values(kontrolByYearRef.current).forEach(yearMap => {
              Object.assign(merged, yearMap);
            });
            remoteRef.current.kontrol = merged;
            setDB(prev => {
              const next = { ...prev, kontrol: mapToArr(merged) };
              saveLocalDB(next);
              return next;
            });
          };

          const attachYearListener = (year, { countTowardBoot } = {}) => {
            if (kontrolYearUnsubsRef.current[year]) return; // sudah aktif
            const yr = ref(rtdb, `gwg_data/shared/kontrol/${year}`);
            kontrolByYearRef.current[year] = kontrolByYearRef.current[year] || {};
            let settleTimer = null, postSettleTimer = null, firstBatchDone = false;
            const settle = () => {
              if (settleTimer) clearTimeout(settleTimer);
              // ✅ Diperpanjang (dari 400ms) — sama alasannya seperti tabel
              // toko: di jaringan sangat lambat, jeda alami antar-batch data
              // yang masih mengalir jangan sampai dikira "sudah selesai".
              settleTimer = setTimeout(() => {
                firstBatchDone = true;
                recomputeKontrolArr();
                setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort());
                if (countTowardBoot) markLoadedAndFlush("kontrol");
              }, 900);
            };
            // ✅ Setelah batch pertama, update-update berikutnya juga
            // di-debounce (bukan recompute per record) — supaya ribuan
            // entri kontrol yang masih mengalir di jaringan lambat tidak
            // memicu render+hitung-ulang satu-satu (lag).
            const recomputeDebounced = () => {
              if (postSettleTimer) clearTimeout(postSettleTimer);
              postSettleTimer = setTimeout(recomputeKontrolArr, 300);
            };
            const uAdd = onChildAdded(yr, snap => {
              kontrolByYearRef.current[year][snap.key] = snap.val();
              if (!firstBatchDone) settle(); else recomputeDebounced();
            }, (err) => { setSyncError(err.message); if (countTowardBoot) markLoadedAndFlush("kontrol"); });
            onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (firstBatchDone) recomputeDebounced(); });
            onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; if (firstBatchDone) recomputeDebounced(); });
            // ✅ Diperpanjang (dari 3 detik) — sama alasannya seperti tabel
            // toko: di jaringan sangat lambat, record pertama yang memang
            // ada tapi belum sempat tiba jangan sampai dikira "tahun ini
            // kosong".
            const emptyFallback = setTimeout(() => {
              if (!firstBatchDone) { firstBatchDone = true; recomputeKontrolArr(); setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort()); if (countTowardBoot) markLoadedAndFlush("kontrol"); }
            }, 12000);
            kontrolYearUnsubsRef.current[year] = () => { off(yr); if (settleTimer) clearTimeout(settleTimer); if (postSettleTimer) clearTimeout(postSettleTimer); clearTimeout(emptyFallback); };
            unsubs.push(kontrolYearUnsubsRef.current[year]);
          };

          // Index ringan berisi daftar SEMUA tahun yang punya data (tanpa
          // perlu download isi datanya) — dipakai untuk menampilkan pilihan
          // "muat data tahun lama" di UI tanpa biaya bandwidth besar.
          const idxRef = ref(rtdb, `gwg_data/shared/kontrolYearsIndex`);
          const unsubIdx = onValue(idxRef, snap => {
            const val = snap.val() || {};
            setAvailableKontrolYears(Object.keys(val).sort());
          });
          unsubs.push(() => off(idxRef));

          liveYears.forEach(y => attachYearListener(y, { countTowardBoot: true }));
          return;
        }

        if (LARGE_TABLES.has(key)) {
          // ── Sinkronisasi INKREMENTAL untuk tabel besar (kontrol/toko) ──
          const localMap = {};
          let settleTimer = null;
          let postSettleTimer = null; // ✅ debounce update SETELAH batch pertama juga
          let firstBatchDone = false;

          const flushToState = () => {
            remoteRef.current[key] = { ...localMap };
            setDB(prev => {
              const next = { ...prev, [key]: mapToArr(localMap) };
              saveLocalDB(next);
              return next;
            });
          };

          // ✅ Sebelumnya, SETELAH batch pertama "settle", setiap 1 record baru
          // yang datang (child_added/changed/removed) langsung memicu
          // flushToState() satu-satu — untuk tabel beribu-ribu baris (toko)
          // di jaringan lambat, ini berarti ratusan render+tulis-localStorage
          // berturut-turut = lag parah yang dikeluhkan pengguna. Sekarang
          // update-update ini juga digabung (debounce ~300ms) seperti batch
          // pertama, supaya render/tulis-localStorage terjadi sekali per
          // "gerombolan" perubahan, bukan per record.
          const flushToStateDebounced = () => {
            if (postSettleTimer) clearTimeout(postSettleTimer);
            postSettleTimer = setTimeout(flushToState, 300);
          };

          const scheduleSettle = () => {
            // Selama listener child_added masih "membanjir" data awal
            // (initial sync), tunda update UI sampai aliran berhenti
            // sejenak tanpa event baru — supaya kita tidak re-render ribuan
            // kali saat load pertama, dan supaya kita tahu kapan "loading
            // awal" boleh dianggap selesai. Jeda diperpanjang (dari 400ms)
            // supaya di jaringan sangat lambat (mis. <1 KB/dtk), jeda alami
            // antar-batch data yang masih mengalir tidak salah dikira "sudah
            // selesai" padahal masih banyak record berikutnya dalam perjalanan.
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
              firstBatchDone = true;
              flushToState();
              markLoadedAndFlush(key);
            }, 900);
          };

          const unsubAdd = onChildAdded(r, snap => {
            localMap[snap.key] = snap.val();
            if (!firstBatchDone) scheduleSettle();
            else flushToStateDebounced();
          }, (err) => { setSyncError(err.message); markLoadedAndFlush(key); });

          const unsubChg = onChildChanged(r, snap => {
            localMap[snap.key] = snap.val();
            if (firstBatchDone) flushToStateDebounced();
          });

          const unsubRem = onChildRemoved(r, snap => {
            delete localMap[snap.key];
            if (firstBatchDone) flushToStateDebounced();
          });

          // Jika tabel kosong (toko baru / kontrol belum pernah diisi),
          // child_added tidak akan pernah terpanggil sama sekali — pasang
          // fallback timer supaya bootstrap tidak menunggu selamanya.
          // Diperpanjang (dari 3 detik) supaya di jaringan sangat lambat,
          // record PERTAMA yang memang ada tapi belum sempat tiba tidak
          // keliru dianggap "tabel ini kosong" — itu akar masalah Dashboard
          // sempat menampilkan "0 toko" padahal datanya ada, cuma lambat.
          const emptyFallback = setTimeout(() => {
            if (!firstBatchDone) { firstBatchDone = true; flushToState(); markLoadedAndFlush(key); }
          }, 12000);

          unsubs.push(() => { off(r); if (settleTimer) clearTimeout(settleTimer); if (postSettleTimer) clearTimeout(postSettleTimer); clearTimeout(emptyFallback); });
          return;
        }

        // ── Tabel kecil (wilayah/rute/produk/pengguna/dst): tetap pakai
        // onValue seperti semula — aman karena ukurannya tidak akan
        // membesar signifikan seiring waktu. ──
        const unsub = onValue(r, snap => {
          const val = snap.val();
          remoteRef.current[key] = val;
          setDB(prev => {
            const next = { ...prev };
            if (LIST_TABLES.includes(key)) next[key] = mapToArr(val);
            else next[key] = val ?? (key === "stokAwal" ? {} : null);
            saveLocalDB(next);
            return next;
          });
          markLoadedAndFlush(key);
        }, (err) => {
          setSyncing(false);
          setSyncError(err.message);
          setCloudLoaded(true); // gagal konek pun jangan sampai bootstrap menunggu selamanya
        });
        unsubs.push(() => off(r));
      });
    });

    return () => {
      unsubs.forEach(fn => fn());
      basePathRef.current = null;
      remoteRef.current = {};
    };
  }, [user]);

  // Memuat data kontrol satu tahun tertentu SECARA MANUAL (dipanggil dari
  // tombol UI), untuk tahun-tahun lama yang tidak otomatis live-sync.
  // Setelah dimuat, tahun itu ikut live-sync juga (listener tetap aktif
  // sampai komponen unmount/logout), dan langsung ikut tergabung ke
  // db.kontrol seperti tahun-tahun lain — tidak perlu ubah kode tab manapun.
  const loadKontrolYear = useCallback((year) => {
    if (!user || !firebaseDB) return;
    year = String(year);
    if (kontrolYearUnsubsRef.current[year]) return; // sudah dimuat
    const { db: rtdb, ref, onChildAdded, onChildChanged, onChildRemoved, off } = firebaseDB;
    const yr = ref(rtdb, `gwg_data/shared/kontrol/${year}`);
    kontrolByYearRef.current[year] = kontrolByYearRef.current[year] || {};
    let settleTimer = null, postSettleTimer = null, firstBatchDone = false;
    const recompute = () => {
      const merged = {};
      Object.values(kontrolByYearRef.current).forEach(m => Object.assign(merged, m));
      remoteRef.current.kontrol = merged;
      setDB(prev => {
        const next = { ...prev, kontrol: mapToArr(merged) };
        saveLocalDB(next);
        return next;
      });
    };
    // ✅ Update setelah batch pertama juga di-debounce (bukan per record) —
    // supaya di jaringan lambat tidak lag; dan jeda settle/empty-fallback
    // diperpanjang supaya tidak keliru dianggap "sudah selesai/kosong"
    // padahal data masih dalam perjalanan (lihat penjelasan yang sama di
    // listener tahun berjalan/toko di atas).
    const recomputeDebounced = () => {
      if (postSettleTimer) clearTimeout(postSettleTimer);
      postSettleTimer = setTimeout(recompute, 300);
    };
    const settle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        firstBatchDone = true;
        recompute();
        setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort());
      }, 900);
    };
    onChildAdded(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (!firstBatchDone) settle(); else recomputeDebounced(); });
    onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); if (firstBatchDone) recomputeDebounced(); });
    onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; if (firstBatchDone) recomputeDebounced(); });
    setTimeout(() => { if (!firstBatchDone) { firstBatchDone = true; recompute(); setLoadedKontrolYears(prev => prev.includes(year) ? prev : [...prev, year].sort()); } }, 12000);
    kontrolYearUnsubsRef.current[year] = () => { off(yr); if (settleTimer) clearTimeout(settleTimer); if (postSettleTimer) clearTimeout(postSettleTimer); };
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────
  // MIGRASI STRUKTUR "kontrol" LAMA (flat: kontrol/{id}) → PARTISI TAHUN
  // (kontrol/{tahun}/{id}). Dipanggil MANUAL oleh Admin lewat tombol khusus
  // (bukan otomatis saat login) karena ini operasi besar & sekali jalan —
  // lebih aman diawasi langsung daripada berjalan diam-diam di background.
  // Aman dijalankan berkali-kali (idempotent): kalau data lama sudah tidak
  // ada di root flat, migrasi akan langsung melapor "tidak ada yang perlu
  // dimigrasi" tanpa melakukan apa-apa.
  // Urutan aman: (1) baca semua data lama, (2) tulis ke path tahun baru,
  // (3) BARU setelah tulis berhasil, hapus data lama dari root flat.
  // Backup otomatis harian tetap menyimpan salinan penuh sebelum ini, dan
  // sangat disarankan menekan "Unduh Backup Sekarang" secara manual dulu
  // sebelum menjalankan migrasi ini.
  const runKontrolYearMigration = useCallback(async () => {
    if (!user || !firebaseDB) return { ok: false, message: "Tidak ada koneksi cloud." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    try {
      const rootSnap = await get(ref(rtdb, `gwg_data/shared/kontrol`));
      const rootVal = rootSnap.val() || {};
      // Pisahkan: key yang berbentuk TAHUN (4 digit, sudah dipartisi) vs
      // key yang berbentuk ID record lama (flat, masih perlu dimigrasi).
      const oldFlatEntries = Object.entries(rootVal).filter(([k, v]) => !/^\d{4}$/.test(k) && v && typeof v === "object");
      if (oldFlatEntries.length === 0) {
        return { ok: true, message: "Tidak ada data lama untuk dimigrasi — struktur sudah rapi." };
      }
      const byYear = {};
      oldFlatEntries.forEach(([id, rec]) => {
        const y = kontrolYearOf(rec);
        (byYear[y] = byYear[y] || {})[id] = rec;
      });
      // Tahap 1: tulis ke struktur baru (MERGE per tahun, tidak menimpa
      // tahun yang mungkin sudah sebagian terisi dari migrasi sebelumnya).
      for (const [year, recs] of Object.entries(byYear)) {
        const existingSnap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
        const merged = { ...(existingSnap.val() || {}), ...recs };
        await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), merged);
        await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), true);
      }
      // Tahap 2: verifikasi tulisan berhasil sebelum menghapus data lama.
      for (const [year, recs] of Object.entries(byYear)) {
        const checkSnap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
        const checkVal = checkSnap.val() || {};
        const missing = Object.keys(recs).filter(id => !checkVal[id]);
        if (missing.length > 0) {
          return { ok: false, message: `Verifikasi gagal untuk tahun ${year} (${missing.length} record tidak ditemukan). Migrasi DIHENTIKAN sebelum menghapus data lama — data lama masih utuh, aman dicoba lagi.` };
        }
      }
      // Tahap 3: baru sekarang hapus entri lama dari root flat, satu per satu.
      for (const [id] of oldFlatEntries) {
        await set(ref(rtdb, `gwg_data/shared/kontrol/${id}`), null);
      }
      return { ok: true, message: `Migrasi selesai: ${oldFlatEntries.length} record dipindahkan ke ${Object.keys(byYear).length} tahun (${Object.keys(byYear).sort().join(", ")}).` };
    } catch (e) {
      return { ok: false, message: `Migrasi gagal: ${e.message}. Data lama TIDAK dihapus (aman).` };
    }
  }, [user]);

  // Status antrean tulis offline — jumlah perubahan yang BELUM berhasil
  // dikirim ke Firebase (tersimpan aman di IndexedDB). Dipakai untuk
  // menampilkan "N perubahan menunggu sinkron" di header.
  const [pendingSync, setPendingSync] = useState(0);
  const flushingRef = useRef(false);
  const refreshPendingCount = useCallback(() => {
    queueCount().then(setPendingSync);
  }, []);

  // Kirim ulang SEMUA perubahan yang masih tertunda di antrean lokal, satu
  // per satu, secara berurutan (path yang sama hanya tersimpan sebagai versi
  // TERAKHIR — lihat queueWrite). Kalau satu path gagal (kemungkinan besar
  // masih offline), langsung berhenti — sisanya dicoba lagi di kesempatan
  // berikutnya (event 'online' berikutnya / retry berkala), supaya tidak
  // spam percobaan yang pasti gagal saat memang belum ada sinyal.
  const flushWriteQueue = useCallback(async () => {
    if (!firebaseDB || !basePathRef.current || flushingRef.current) return;
    flushingRef.current = true;
    try {
      const { db: rtdb, ref, set } = firebaseDB;
      const entries = await queueGetAll();
      for (const { path, value } of entries) {
        try {
          await set(ref(rtdb, `gwg_data/shared/${path}`), value);
          await queueRemove(path);
        } catch (e) {
          // ✅ FIX: bedakan "ditolak security rules" (PERMANEN, tidak akan
          // pernah berhasil walau dicoba ulang) dari "kemungkinan masih
          // offline" (SEMENTARA, wajar dicoba lagi nanti). Sebelumnya
          // keduanya diperlakukan sama, jadi penolakan rules jadi nyangkut
          // selamanya di antrean tanpa pernah kelihatan oleh pengguna.
          const kode = String(e?.code || e?.message || "").toUpperCase();
          const ditolakRules = kode.includes("PERMISSION_DENIED");
          if (ditolakRules) {
            console.error("Ditolak security rules (permanen, tidak dicoba ulang):", path, e);
            await queueRemove(path); // hentikan percobaan ulang yang sia-sia
            setWriteDenied(prev => [...prev, { path, message: e?.message || "Permission denied", at: Date.now() }]);
            continue; // lanjut proses sisa antrean — bukan berhenti total
          }
          console.warn("Sinkron tertunda (kemungkinan masih offline):", path, e);
          break; // hentikan, coba lagi nanti begitu online/retry berikutnya
        }
      }
    } finally {
      flushingRef.current = false;
      refreshPendingCount();
    }
  }, [refreshPendingCount]);

  // Coba flush antrean: (1) begitu user login & Firebase siap — menyapu
  // sisa antrean dari sesi sebelumnya yang mungkin belum sempat terkirim;
  // (2) setiap kali koneksi kembali online; (3) berkala tiap 30 detik
  // sebagai jaring pengaman untuk kondisi sinyal naik-turun (lebih andal
  // daripada hanya mengandalkan event 'online' browser, yang di HP kadang
  // tidak selalu akurat mendeteksi koneksi data seluler yang lemah).
  useEffect(() => {
    if (!user || !firebaseDB) return;
    refreshPendingCount();
    flushWriteQueue();
    const onOnline = () => flushWriteQueue();
    window.addEventListener("online", onOnline);
    const interval = setInterval(flushWriteQueue, 30000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [user, flushWriteQueue, refreshPendingCount]);

  // Tulis HANYA path/record yang benar-benar berubah. Setiap perubahan
  // SELALU dicatat dulu ke antrean lokal durable (IndexedDB) — baru
  // kemudian dicoba dikirim ke Firebase. Kalau gagal/offline, perubahan
  // TETAP AMAN tersimpan di antrean dan otomatis dikirim ulang begitu
  // koneksi kembali, walau app sempat ditutup/HP mati di antaranya.
  const pushUpdates = useCallback((updates) => {
    const entries = Object.entries(updates).map(([path, value]) => [path, value === undefined ? null : value]);
    Promise.all(entries.map(([path, value]) => queueWrite(path, value))).then(refreshPendingCount);
    if (!user || !firebaseDB || !basePathRef.current) return;
    flushWriteQueue();
  }, [user, flushWriteQueue, refreshPendingCount]);

  // save() generik dipertahankan agar kode lama (stok update, import excel,
  // config bagi hasil) yang memanggil save(newDB) tetap berfungsi tanpa
  // diubah. Di balik layar, fungsi ini menghitung DIFF per-tabel terhadap
  // state sebelumnya dan hanya mengirim tabel yang berubah ke Firebase
  // (bukan seluruh database), serta menulis tabel sebagai MAP per-id
  // (bukan array besar) supaya update 1 toko = 1 path kecil, bukan 1 blob.
  const save = useCallback((newDB) => {
    setDB(prevDB => {
      const updates = {};
      LIST_TABLES.forEach(key => {
        if (newDB[key] === prevDB[key]) return;
        if (key === "kontrol") {
          // "kontrol" TIDAK ditulis sebagai satu blob di root — dipecah per
          // tahun. Kita hanya berwenang atas tahun-tahun yang SEDANG dimuat
          // (ada di prevDB.kontrol atau newDB.kontrol); tahun lain yang
          // belum dimuat sama sekali TIDAK disentuh sama sekali, supaya
          // save() bulk tidak pernah menimpa data tahun yang belum dimuat.
          const byYear = {};
          (newDB.kontrol || []).forEach(rec => {
            const y = kontrolYearOf(rec);
            (byYear[y] = byYear[y] || {})[rec.id] = rec;
          });
          const prevYears = new Set((prevDB.kontrol || []).map(kontrolYearOf));
          const touchedYears = new Set([...Object.keys(byYear), ...prevYears]);
          touchedYears.forEach(y => {
            updates[`kontrol/${y}`] = byYear[y] || null; // null = tahun itu jadi kosong
            if (byYear[y]) updates[`kontrolYearsIndex/${y}`] = true;
          });
          return;
        }
        updates[key] = arrToMap(newDB[key]);
      });
      if (newDB.stokAwal !== prevDB.stokAwal) updates.stokAwal = newDB.stokAwal || {};
      if (newDB.bagiHasilConfig !== prevDB.bagiHasilConfig) updates.bagiHasilConfig = newDB.bagiHasilConfig ?? null;
      if (Object.keys(updates).length) pushUpdates(updates);
      saveLocalDB(newDB);
      return newDB;
    });
  }, [pushUpdates]);

  // addRecord/updateRecord/deleteRecord ditulis ulang agar masing-masing
  // HANYA mengirim 1 record (path "table/id"), bukan seluruh tabel —
  // jauh lebih hemat bandwidth saat toko sudah ribuan & kontrol terus bertambah.
  // Untuk tabel "kontrol" khusus, path ditulis sebagai "kontrol/{tahun}/{id}"
  // (partisi tahun) alih-alih "kontrol/{id}".
  const addRecord = useCallback((table, record) => {
    setDB(prevDB => {
      const nextArr = [...(prevDB[table]||[]), record];
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      if (table === "kontrol") {
        const y = kontrolYearOf(record);
        pushUpdates({ [`kontrol/${y}/${record.id}`]: record, [`kontrolYearsIndex/${y}`]: true });
      } else {
        pushUpdates({ [`${table}/${record.id}`]: record });
      }
      return next;
    });
  }, [pushUpdates]);

  const updateRecord = useCallback((table, id, updated) => {
    setDB(prevDB => {
      let oldRecord = null, mergedRecord = null;
      const nextArr = (prevDB[table]||[]).map(r => {
        if (r.id !== id) return r;
        oldRecord = r;
        mergedRecord = { ...r, ...updated };
        return mergedRecord;
      });
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      if (mergedRecord) {
        if (table === "kontrol") {
          const oldYear = kontrolYearOf(oldRecord);
          const newYear = kontrolYearOf(mergedRecord);
          if (oldYear !== newYear) {
            // Tanggal record diedit lintas-tahun: pindahkan node-nya.
            pushUpdates({
              [`kontrol/${oldYear}/${id}`]: null,
              [`kontrol/${newYear}/${id}`]: mergedRecord,
              [`kontrolYearsIndex/${newYear}`]: true,
            });
          } else {
            pushUpdates({ [`kontrol/${newYear}/${id}`]: mergedRecord });
          }
        } else {
          pushUpdates({ [`${table}/${id}`]: mergedRecord });
        }
      }
      return next;
    });
  }, [pushUpdates]);

  const deleteRecord = useCallback((table, id) => {
    setDB(prevDB => {
      const targetRecord = table === "kontrol" ? (prevDB[table]||[]).find(r => r.id === id) : null;
      const nextArr = (prevDB[table]||[]).filter(r => r.id !== id);
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      // Jika menghapus pengguna, tandai emailnya di blacklist agar tidak
      // auto-register ulang ketika pengguna tersebut refresh browser.
      // KECUALI untuk email Super Admin — akun ini TIDAK BOLEH pernah masuk
      // blacklist, walau baris yang dihapus cuma duplikat lama. Tanpa
      // pengecualian ini, membersihkan baris duplikat Super Admin bisa
      // tanpa sengaja memblokir akun Super Admin asli selamanya dari
      // auto-register (bug: "data hilang, tidak bisa akses reset database").
      if (table === "pengguna") {
        const deletedUser = (prevDB[table]||[]).find(r => r.id === id);
        if (deletedUser?.email && !isSuperAdminEmail(deletedUser.email)) {
          const emailKey = encodeEmailKey(deletedUser.email);
          // Tulis langsung ke path khusus di luar shared (bukan lewat pushUpdates)
          if (firebaseDB && basePathRef.current) {
            const { db: rtdb, ref: fbRef, set } = firebaseDB;
            set(fbRef(rtdb, `gwg_data/shared/deletedUsers/${emailKey}`), true).catch(console.warn);
            // Update ref lokal segera agar cek langsung efektif
            deletedUsersRef.current = { ...deletedUsersRef.current, [emailKey]: true };
          }
          // Simpan juga di localStorage sebagai fallback offline
          try {
            const localDeleted = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
            localDeleted[emailKey] = true;
            localStorage.setItem("gwg_deletedUsers", JSON.stringify(localDeleted));
          } catch {}
        }
      }
      if (table === "kontrol" && targetRecord) {
        pushUpdates({ [`kontrol/${kontrolYearOf(targetRecord)}/${id}`]: null });
      } else {
        pushUpdates({ [`${table}/${id}`]: null }); // null = hapus path ini saja di Firebase
      }
      return next;
    });
  }, [pushUpdates]);

  const updateStokToko = useCallback((tokoId, produkId, jumlah) => {
    setDB(prevDB => {
      let mergedRecord = null;
      const nextArr = prevDB.toko.map(t => {
        if (t.id !== tokoId) return t;
        mergedRecord = { ...t, [`stok_${produkId}`]: jumlah };
        return mergedRecord;
      });
      const next = { ...prevDB, toko: nextArr };
      saveLocalDB(next);
      if (mergedRecord) pushUpdates({ [`toko/${tokoId}`]: mergedRecord });
      return next;
    });
  }, [pushUpdates]);

  const resetDB = useCallback(() => {
    // PENGAMAN TAMBAHAN: selalu backup snapshot SEBELUM data dihapus, supaya
    // kalau reset ternyata tidak disengaja, masih ada cara memulihkannya
    // lewat menu "Riwayat Backup" (lihat backupNow/listBackups/restoreBackup
    // di bawah).
    backupNow(db, { reason: "sebelum-reset" });
    setDB(DB_EMPTY);
    saveLocalDB(DB_EMPTY);
    // Reset menghapus SETIAP path tabel secara eksplisit (bukan menulis satu
    // blob kosong ke root), supaya konsisten dengan skema per-path di atas.
    const updates = {};
    LIST_TABLES.forEach(key => { updates[key] = null; });
    updates.stokAwal = null;
    updates.bagiHasilConfig = null;
    updates.kontrolYearsIndex = null; // index tahun kontrol — ikut dibersihkan saat reset
    pushUpdates(updates);
    // Reset juga state lokal partisi-tahun supaya UI tidak menampilkan
    // tahun-tahun "sudah dimuat" dari sesi sebelum reset.
    kontrolByYearRef.current = {};
    setLoadedKontrolYears([]);
    setAvailableKontrolYears([]);
  }, [pushUpdates, db]);

  // ───────────────────────────────────────────────────────────────────────
  // BACKUP OTOMATIS & MANUAL
  // Tujuannya: kalaupun suatu saat ada kesalahan deploy/import/reset lagi,
  // selalu ada salinan yang bisa dipulihkan. Backup disimpan dengan KEY =
  // tanggal (YYYY-MM-DD), jadi backup di hari yang sama akan menimpa backup
  // hari itu saja (tidak menumpuk tanpa batas), dan backup lebih tua dari
  // MAX_BACKUPS hari otomatis dibersihkan.
  // ───────────────────────────────────────────────────────────────────────
  // Diturunkan dari 30 → 10 hari. Backup adalah SALINAN PENUH seluruh
  // database (termasuk tabel "kontrol" yang akan terus membesar selama
  // bertahun-tahun), jadi menyimpan 30 salinan penuh sekaligus adalah
  // pengguna kuota storage gratis Firebase (1GB) paling boros — bisa habis
  // jauh sebelum data penjualan asli sendiri mendekati batas itu. 10 hari
  // masih cukup untuk jaga-jaga kalau ada kesalahan input/impor yang baru
  // ketahuan beberapa hari kemudian.
  const MAX_BACKUPS = 10;

  const backupNow = useCallback(async (dbToBackup, { reason = "manual" } = {}) => {
    const nowIso = new Date().toISOString();
    const snapshot = { ts: nowIso, reason, data: dbToBackup };
    const dateKey = nowIso.slice(0, 10); // YYYY-MM-DD

    // 1) Salinan lokal — selalu jalan, bahkan tanpa login/Firebase.
    try { localStorage.setItem(`gwg_backup_${dateKey}`, JSON.stringify(snapshot)); } catch {}

    // 2) Salinan cloud — supaya bisa dipulihkan dari perangkat lain juga.
    // Status keberhasilannya dikembalikan (cloudOk/cloudError), BUKAN cuma
    // di-console.warn diam-diam, supaya tombol di UI bisa menampilkan pesan
    // sukses/gagal yang sesungguhnya ke pengguna — sebelumnya tombol "Simpan
    // Snapshot ke Cloud" tidak memberi konfirmasi apa pun walau gagal.
    let cloudOk = false, cloudError = null;
    if (!user) {
      cloudError = "Belum login — backup cloud butuh akun Google aktif.";
    } else if (!firebaseDB) {
      cloudError = "Firebase belum aktif (aplikasi berjalan di Mode Lokal).";
    } else {
      try {
        const { db: rtdb, ref, set, get } = firebaseDB;
        await set(ref(rtdb, `gwg_data/_backups/${dateKey}`), snapshot);
        cloudOk = true;
        const listSnap = await get(ref(rtdb, `gwg_data/_backups`));
        const all = listSnap.val();
        if (all) {
          const keys = Object.keys(all).sort(); // format YYYY-MM-DD bisa diurutkan sebagai string
          const excess = keys.length - MAX_BACKUPS;
          if (excess > 0) {
            await Promise.all(keys.slice(0, excess).map(k => set(ref(rtdb, `gwg_data/_backups/${k}`), null)));
          }
        }
      } catch (e) {
        console.warn("Backup ke cloud gagal (salinan lokal tetap tersimpan):", e);
        cloudError = e.message;
      }
    }
    return { snapshot, cloudOk, cloudError };

  }, [user]);

  // Auto-backup 1x per hari per perangkat. Dipasang lewat efek terpisah agar
  // berjalan sendiri tanpa perlu dipanggil manual dari komponen UI, dan baru
  // jalan setelah cloudLoaded supaya tidak membackup data kosong/parsial yang
  // belum selesai sinkron dari Firebase.
  useEffect(() => {
    if (!cloudLoaded) return;
    if (!db || (db.pengguna || []).length === 0) return; // belum ada data nyata, lewati
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem("gwg_last_autobackup") === today) return;
      backupNow(db, { reason: "auto-harian" });
      localStorage.setItem("gwg_last_autobackup", today);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudLoaded, db, backupNow]);

  // Daftar backup yang tersedia di cloud, untuk ditampilkan di menu Admin.
  const listBackups = useCallback(async () => {
    if (!firebaseDB) return [];
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/_backups`));
      const all = snap.val() || {};
      return Object.entries(all)
        .map(([key, val]) => ({ key, ts: val?.ts, reason: val?.reason, data: val?.data }))
        .sort((a, b) => b.key.localeCompare(a.key));
    } catch (e) {
      console.warn("Gagal memuat daftar backup:", e);
      return [];
    }
  }, []);

  // Restore dari satu snapshot backup — menulis ulang SEMUA tabel secara
  // eksplisit (beda dengan save() yang hanya mengirim yang berubah), supaya
  // hasil restore benar-benar identik dengan snapshot yang dipilih.
  //
  // PENTING (bugfix): versi lama fungsi ini menulis "kontrol" lewat
  // pushUpdates() sama seperti tabel kecil lainnya — sebagai SATU blob flat
  // di root path "kontrol". Padahal listener pembaca kontrol HANYA membaca
  // path "kontrol/{tahun}/{id}" (dipartisi per tahun). Akibatnya data
  // kontrol/penjualan hasil restore tertulis ke Firebase, tapi di path yang
  // tidak pernah dibaca ulang oleh aplikasi → terlihat "hilang" setelah
  // refresh/login ulang. Sekarang "kontrol" ditulis terpisah, dipartisi per
  // tahun, SAMA PERSIS seperti save()/addRecord().
  //
  // Selain itu, semua penulisan sekarang di-await dan errornya dikumpulkan
  // lalu dikembalikan ke pemanggil (bukan cuma console.warn diam-diam),
  // supaya kalau tabel besar (toko/kontrol) gagal tertulis karena koneksi
  // terputus, ADMIN DIBERI TAHU — bukan mengira restore sudah berhasil.
  const restoreBackup = useCallback(async (snapshotData) => {
    const restored = { ...DB_EMPTY, ...snapshotData };
    setDB(restored);
    saveLocalDB(restored);

    const failed = [];

    if (firebaseDB) {
      const { db: rtdb, ref, set } = firebaseDB;
      const writeTable = async (key, value) => {
        try { await set(ref(rtdb, `gwg_data/shared/${key}`), value); }
        catch (e) { console.warn(`Gagal restore tabel "${key}":`, e); failed.push(key); }
      };
      await Promise.all([
        writeTable("wilayah", arrToMap(restored.wilayah)),
        writeTable("rute", arrToMap(restored.rute)),
        writeTable("toko", arrToMap(restored.toko)),
        writeTable("produk", arrToMap(restored.produk)),
        writeTable("pengguna", arrToMap(restored.pengguna)),
        writeTable("penyesuaian", arrToMap(restored.penyesuaian)),
        writeTable("penjualanLuar", arrToMap(restored.penjualanLuar)),
        writeTable("stokAwal", restored.stokAwal || {}),
        writeTable("bagiHasilConfig", restored.bagiHasilConfig ?? null),
      ]);

      // "kontrol" — bersihkan dulu node lama (termasuk sisa blob flat dari
      // restore versi lama, kalau ada) SEBELUM menulis partisi baru, supaya
      // tidak ada data ganda/nyasar tercampur di root "kontrol".
      try {
        await set(ref(rtdb, `gwg_data/shared/kontrol`), null);
        const kontrolByYear = {};
        (restored.kontrol || []).forEach(rec => {
          const y = kontrolYearOf(rec);
          (kontrolByYear[y] = kontrolByYear[y] || {})[rec.id] = rec;
        });
        for (const [year, recs] of Object.entries(kontrolByYear)) {
          await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), recs);
          await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), true);
        }
        // ✅ FIX SINKRONISASI: sebelumnya, tahun-tahun kontrol dari backup
        // yang BUKAN tahun live (mis. tahun-tahun lama) hanya sempat tampil
        // sekilas lewat setDB(restored) di atas — begitu event Firebase apa
        // pun terjadi pada tahun yang sedang live (termasuk tulisan restore
        // ini sendiri ke tahun berjalan), recomputeKontrolArr() otomatis
        // terpicu dan membangun ulang db.kontrol HANYA dari kontrolByYearRef
        // (tahun-tahun yang benar-benar ter-listen) — diam-diam MEMBUANG
        // tahun-tahun lama yang baru saja dipulihkan dari tampilan (datanya
        // tetap aman di Firebase, cuma hilang dari layar tanpa peringatan).
        // Memanggil loadKontrolYear() untuk setiap tahun di backup membuat
        // tahun-tahun itu resmi "termuat" (listener aktif + ikut di-merge),
        // sehingga tidak hilang lagi setelah recompute berikutnya.
        Object.keys(kontrolByYear).forEach(year => loadKontrolYear(year));
      } catch (e) {
        console.warn('Gagal restore tabel "kontrol":', e);
        failed.push("kontrol");
      }
    } else {
      // Mode lokal tanpa Firebase: cukup pushUpdates seperti semula.
      const updates = {};
      LIST_TABLES.forEach(key => { updates[key] = arrToMap(restored[key]); });
      updates.stokAwal = restored.stokAwal || {};
      updates.bagiHasilConfig = restored.bagiHasilConfig ?? null;
      pushUpdates(updates);
    }

    if (failed.length > 0) {
      return { ok: false, failed, message: `Sebagian data GAGAL disimpan ke cloud (kemungkinan koneksi terputus): ${failed.join(", ")}. Coba ulangi restore dengan koneksi lebih stabil — jangan tutup halaman saat proses berjalan.` };
    }
    return { ok: true };
  }, [pushUpdates, loadKontrolYear]);

  // ─────────────────────────────────────────────
  //  ARSIP TAHUN LAMA (Google Drive) — hemat kuota Realtime Database
  // ─────────────────────────────────────────────
  // "kontrol" adalah tabel yang paling cepat membesar (bertambah tiap
  // kunjungan x tiap toko x tiap bulan), jadi paling berpengaruh ke kuota
  // gratis RTDB (1GB). Data tahun-tahun lama jarang dibuka lagi setelah
  // laporan tahunannya selesai, jadi kita pindahkan ke Google Drive (15GB
  // gratis, tanpa perlu upgrade paket Firebase) sebagai SATU file JSON per
  // tahun — jauh lebih hemat daripada tetap tersimpan sebagai ribuan node
  // di RTDB. Data TIDAK dihapus permanen: tetap bisa dilihat & diexport
  // kapan saja lewat viewArchivedKontrolYear di bawah.
  //
  // Index ringan (fileId per tahun) disimpan di RTDB path
  // `kontrolArchiveIndex` supaya daftar "sudah diarsipkan" bisa ditampilkan
  // tanpa perlu login/panggil Drive API dulu — token Google (popup) baru
  // diminta saat admin benar-benar klik Lihat/Export/Hapus/Arsipkan.
  const [archivedKontrolYears, setArchivedKontrolYears] = useState([]); // tahun yang sudah diarsipkan (dari index ringan)
  const archiveIndexRef = useRef({}); // { [year]: { fileId, driveLink } } — untuk lookup fileId tanpa query ulang

  const refreshArchivedYears = useCallback(async () => {
    if (!firebaseDB) return;
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex`));
      const all = snap.val() || {};
      archiveIndexRef.current = all;
      setArchivedKontrolYears(Object.keys(all).sort());
    } catch (e) { console.warn("Gagal memuat daftar arsip:", e); }
  }, []);

  useEffect(() => { if (user && firebaseDB) refreshArchivedYears(); }, [user, refreshArchivedYears]);

  // Pindahkan satu tahun data kontrol dari RTDB → Google Drive.
  // Urutan PENTING demi keamanan data: upload & VERIFIKASI dulu baru hapus
  // dari RTDB — kalau upload gagal di tengah jalan, data asli di RTDB tidak
  // disentuh sama sekali (tidak ada risiko kehilangan data).
  const archiveKontrolYear = useCallback(async (year) => {
    year = String(year);
    if (!user || !firebaseDB) return { ok: false, message: "Firebase belum siap." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    try {
      // 1) Ambil seluruh data tahun ini langsung dari RTDB (bukan dari
      //    state lokal, supaya akurat walau tahun ini belum/sudah pernah
      //    dimuat manual di perangkat ini).
      const snap = await get(ref(rtdb, `gwg_data/shared/kontrol/${year}`));
      const yearData = snap.val();
      if (!yearData || Object.keys(yearData).length === 0) {
        return { ok: false, message: `Tidak ada data kontrol tahun ${year} untuk diarsipkan.` };
      }
      const recordCount = Object.keys(yearData).length;

      // 2) Upload sebagai satu file JSON ke Google Drive. Kalau upload
      //    gagal (exception dilempar dari dalam gdriveUploadJSON), fungsi
      //    berhenti di sini lewat catch di bawah — RTDB tidak disentuh.
      const archivedAt = new Date().toISOString();
      const fileData = await gdriveUploadJSON(
        `gwg_arsip_kontrol_${year}.json`,
        { year, archivedAt, recordCount, data: yearData },
        `GWG SuperApp - Arsip Kontrol Bulanan tahun ${year}`
      );
      if (!fileData?.id) {
        return { ok: false, message: "Upload arsip tampak gagal (tidak dapat file ID) — data ASLI di database tidak diubah, aman untuk dicoba lagi." };
      }

      // 3) Baru sekarang aman menghapus dari RTDB + hentikan listener
      //    tahun tsb kalau sedang aktif, dan perbarui index (sekarang
      //    menyimpan fileId Drive, bukan cuma `true`).
      if (kontrolYearUnsubsRef.current[year]) {
        kontrolYearUnsubsRef.current[year]();
        delete kontrolYearUnsubsRef.current[year];
      }
      delete kontrolByYearRef.current[year];
      await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), null);
      await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), null);
      await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), {
        fileId: fileData.id,
        driveLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
        archivedAt, recordCount,
      });

      // 4) Bersihkan tahun ini dari state lokal (db.kontrol gabungan)
      //    supaya UI tidak lagi menampilkan data yang sudah dipindah.
      setLoadedKontrolYears(prev => prev.filter(y => y !== year));
      setDB(prev => {
        const next = { ...prev, kontrol: prev.kontrol.filter(rec => kontrolYearOf(rec) !== year) };
        saveLocalDB(next);
        return next;
      });
      await refreshArchivedYears();

      return { ok: true, recordCount, message: `${recordCount} data kontrol tahun ${year} berhasil diarsipkan ke Google Drive dan dihapus dari database aktif.` };
    } catch (e) {
      console.warn(`Gagal mengarsipkan tahun ${year}:`, e);
      return { ok: false, message: `Gagal mengarsipkan: ${e.message}. Data ASLI tidak diubah — aman untuk dicoba lagi.` };
    }
  }, [user, refreshArchivedYears]);

  // Unduh & baca isi satu file arsip dari Drive — HANYA UNTUK DILIHAT/
  // DIEXPORT, tidak ditulis balik ke db.kontrol aktif (supaya tidak
  // tercampur/konflik dengan data yang sedang live-sync). Dipanggil dari
  // UI saat admin klik "Lihat" pada tahun yang sudah diarsipkan.
  const viewArchivedKontrolYear = useCallback(async (year) => {
    year = String(year);
    const entry = archiveIndexRef.current[year];
    if (!entry?.fileId) return { ok: false, message: "Data arsip tahun ini tidak ditemukan di index.", records: [] };
    try {
      const parsed = await gdriveDownloadJSON(entry.fileId);
      const records = mapToArr(parsed.data || {});
      return { ok: true, records, archivedAt: parsed.archivedAt, recordCount: parsed.recordCount ?? records.length };
    } catch (e) {
      console.warn(`Gagal membaca arsip tahun ${year}:`, e);
      return { ok: false, message: `Gagal membuka arsip dari Google Drive: ${e.message}`, records: [] };
    }
  }, []);

  // Export arsip ke file yang bisa dibuka di HP/komputer manapun (JSON
  // mentah — untuk Excel/CSV, ambil `records`-nya lewat viewArchivedKontrolYear
  // lalu pakai exportExcel/exportCSV yang sudah ada, dipanggil dari UI).
  const exportArchivedKontrolYear = useCallback(async (year) => {
    const result = await viewArchivedKontrolYear(year);
    if (!result.ok) return result;
    downloadJSON(`arsip_kontrol_${year}`, result.records);
    return result;
  }, [viewArchivedKontrolYear]);

  // Hapus permanen satu arsip dari Google Drive (dipisah dari
  // archiveKontrolYear supaya penghapusan permanen selalu perlu langkah
  // eksplisit tersendiri dari admin — bukan efek samping otomatis dari
  // aksi lain).
  const deleteArchivedKontrolYear = useCallback(async (year) => {
    year = String(year);
    const entry = archiveIndexRef.current[year];
    if (!firebaseDB) return { ok: false, message: "Firebase belum siap." };
    if (!entry?.fileId) return { ok: false, message: "Data arsip tahun ini tidak ditemukan di index." };
    try {
      await gdriveDeleteFile(entry.fileId);
      const { db: rtdb, ref, set } = firebaseDB;
      await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), null);
      await refreshArchivedYears();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `Gagal menghapus arsip dari Google Drive: ${e.message}` };
    }
  }, [refreshArchivedYears]);

  // Ambil daftar email yang sedang diblokir (sudah dihapus admin) dari
  // Firebase, supaya bisa ditampilkan & dikelola di UI Tab Pengguna.
  const listDeletedUsers = useCallback(async () => {
    if (!firebaseDB) {
      // Mode lokal (tanpa Firebase): baca dari localStorage saja
      try {
        const local = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
        return Object.keys(local).map(key => ({ key, email: decodeEmailKey(key) }));
      } catch { return []; }
    }
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/deletedUsers`));
      const all = snap.val() || {};
      return Object.keys(all).map(key => ({ key, email: decodeEmailKey(key) }));
    } catch (e) {
      console.warn("Gagal memuat daftar email diblokir:", e);
      return [];
    }
  }, []);

  // Hapus satu email dari blacklist, supaya pengguna tsb bisa kembali
  // ter-auto-register (sebagai Sales) saat login berikutnya.
  const restoreDeletedUser = useCallback((emailKey) => {
    if (firebaseDB) {
      const { db: rtdb, ref, set } = firebaseDB;
      set(ref(rtdb, `gwg_data/shared/deletedUsers/${emailKey}`), null).catch(console.warn);
    }
    deletedUsersRef.current = { ...deletedUsersRef.current };
    delete deletedUsersRef.current[emailKey];
    try {
      const local = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
      delete local[emailKey];
      localStorage.setItem("gwg_deletedUsers", JSON.stringify(local));
    } catch {}
  }, []);

  return { db, addRecord, updateRecord, deleteRecord, resetDB, updateStokToko, save, syncing, lastSync, syncError, writeDenied, clearWriteDenied, pendingSync, cloudLoaded, backupNow, listBackups, restoreBackup, deletedUsersRef, listDeletedUsers, restoreDeletedUser, loadedKontrolYears, availableKontrolYears, loadKontrolYear, runKontrolYearMigration, archivedKontrolYears, archiveKontrolYear, viewArchivedKontrolYear, exportArchivedKontrolYear, deleteArchivedKontrolYear };
}



// ─────────────────────────────────────────────
//  DERIVED ANALYTICS
// ─────────────────────────────────────────────
