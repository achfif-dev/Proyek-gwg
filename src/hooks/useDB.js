import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { firebaseDB, firebaseAuth } from "../firebase/init";
import { FIREBASE_CONFIGURED, FIREBASE_CONFIG } from "../firebase/config";
import { idbGet, idbSet, queueWrite, queueGetDenied, queueCount, queueRetryDenied, queueDiscardDenied, drainQueue, isPermissionDenied, saveLocalDB, flushLocalDBNow } from "../lib/offlineStore";
import { DB_EMPTY } from "../config/dbEmpty";
import { loadAppConfig } from "../config/appConfig";
import { LIST_TABLES, arrToMap, mapToArr, kontrolYearOf, encodeEmailKey, decodeEmailKey, hitungAgregatTahunKontrol } from "../lib/dataHelpers";
import { DEFAULT_DAFTAR_AKUN, buatEntryJurnal, buatEntryPembalik } from "../lib/akuntansiHelpers";
import { isSuperAdminEmail } from "../config/superAdmin";
import { gdriveUploadJSON, gdriveDownloadJSON, gdriveDeleteFile } from "../lib/googleDrive";
import { downloadJSON } from "../lib/fileSave";
import { ambilSnapshotServer, simpanBackupCloud, jalankanReset, jalankanRestore, snapshotKosong } from "../lib/backupRestore";

export function useDB(user) {
  const [db, setDB] = useState(() => {
    try {
      // Key baru (skema pasca-optimisasi): hanya tabel kecil, selalu ada &
      // selalu ringan. Tabel besar (toko/kontrol) menyusul lewat idbGet di
      // bawah begitu IndexedDB siap (biasanya dalam hitungan puluhan ms).
      const savedSmall = localStorage.getItem("gwg_db_v2_small");
      if (savedSmall) return { ...DB_EMPTY, ...JSON.parse(savedSmall) };
      // Fallback sekali pakai: user lama yang belum pernah tersimpan lewat
      // skema baru (key lama masih menyimpan seluruh db, termasuk tabel
      // besar, dari sebelum patch ini).
      const savedOld = localStorage.getItem("gwg_db_v2");
      return savedOld ? JSON.parse(savedOld) : DB_EMPTY;
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
  // ✅ BARU: dataStillSyncing — BEDA dari `syncing` di atas. `syncing` cuma
  // menandai periode SEBELUM batch pertama tiap tabel "settle" (jeda 900ms
  // tanpa data baru) — begitu itu terjadi, `syncing` langsung jadi false
  // walau tabel besar (kontrol/toko) masih terus menerima record baru
  // secara perlahan di jaringan lambat (trickle). Akibatnya: banner
  // "sedang sinkronisasi" hilang duluan, padahal data (terutama kontrol —
  // sumber revenue utama) masih jauh dari lengkap, sehingga Dashboard/
  // Kontrol/Rekap sempat menampilkan Total Revenue yang HANYA berisi
  // penjualan luar rute (tabel kecil, sudah termuat penuh lewat onValue)
  // karena kontrol (tabel besar, listener per-child) belum selesai —
  // pengguna mengiranya angka final, padahal masih akan terus bertambah.
  // `dataStillSyncing` tetap true selama masih ada aktivitas child_added/
  // changed/removed pada tabel besar, dan baru jadi false setelah jeda
  // tenang (tidak ada record baru) selama SYNC_ACTIVITY_QUIET_MS — dipakai
  // UI untuk tetap menampilkan peringatan & menahan diri menganggap angka
  // revenue sudah final selama itu.
  const SYNC_ACTIVITY_QUIET_MS = 2500;
  // ✅ FIX v1 (setelah laporan "input kontrol jadi terasa stuck"): versi
  // paling awal langsung menyalakan `dataStillSyncing=true` di EVENT
  // PERTAMA apa pun — termasuk saat admin sendiri menulis 1 entri kontrol
  // baru, karena Firebase langsung meng-echo tulisan lokal itu balik ke
  // listener (onChildAdded/Changed). Setiap kali flag ini berubah, App.jsx
  // re-render, dan karena Dashboard/TabKontrol/TabRekap semuanya tetap
  // ter-mount (cuma disembunyikan via display:none, bukan di-unmount,
  // supaya state tab lain tidak hilang) dan tidak di-memo, SEMUANYA ikut
  // re-render — termasuk TabKontrol (2700+ baris) & TabRekap (1600+ baris)
  // yang sedang tersembunyi.
  //
  // ❌ FIX v2 (ambang "≥5 event beruntun"): ternyata TIDAK CUKUP — kalau
  // admin input kontrol cepat (mengejar backlog laporan sales dari grup
  // WA), 5+ entri beruntun dalam waktu singkat itu WAJAR terjadi, dan tetap
  // salah kena anggap "sinkronisasi besar" walau itu murni tulisan lokal.
  //
  // ✅ FIX v3 (final, dipakai sekarang): daripada menghitung jumlah event,
  // kita tandai LANGSUNG setiap key yang baru saja DITULIS SENDIRI oleh
  // device ini (lewat addRecord/updateRecord/deleteRecord/save — lihat
  // markLocalWrite di bawah). Saat listener Firebase meng-echo balik
  // tulisan itu, kita cek: kalau key-nya ada di daftar "baru saja ditulis
  // sendiri", event itu DIABAIKAN SAMA SEKALI — tidak dihitung sebagai
  // aktivitas sinkronisasi, seberapa pun cepat/banyak admin menulis.
  // `dataStillSyncing` sekarang HANYA bereaksi terhadap data yang benar-
  // benar datang dari luar (pemuatan awal dari cloud, atau tulisan dari
  // sales/device lain) — bukan echo dari tulisan device ini sendiri.
  const LOCAL_WRITE_TTL_MS = 15000; // seberapa lama sebuah key dianggap "baru saja ditulis sendiri"
  const localWriteKeysRef = useRef(new Map()); // "table:id" -> waktu kedaluwarsa (ms epoch)
  const markLocalWrite = useCallback((table, id) => {
    if (!id) return;
    localWriteKeysRef.current.set(`${table}:${id}`, Date.now() + LOCAL_WRITE_TTL_MS);
  }, []);
  const isRecentLocalWrite = useCallback((table, id) => {
    const key = `${table}:${id}`;
    const exp = localWriteKeysRef.current.get(key);
    if (exp === undefined) return false;
    if (Date.now() > exp) { localWriteKeysRef.current.delete(key); return false; }
    return true;
  }, []);
  const [dataStillSyncing, setDataStillSyncing] = useState(false);
  const syncActivityTimerRef = useRef(null);
  const markSyncActivity = useCallback((table, id) => {
    if (table && isRecentLocalWrite(table, id)) return; // echo dari tulisan lokal sendiri — abaikan total
    setDataStillSyncing(true);
    if (syncActivityTimerRef.current) clearTimeout(syncActivityTimerRef.current);
    syncActivityTimerRef.current = setTimeout(() => {
      setDataStillSyncing(false);
    }, SYNC_ACTIVITY_QUIET_MS);
  }, [isRecentLocalWrite]);
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
  //
  // ✅ FIX: sebelumnya cek `!firebaseDB` di sini — tapi `firebaseDB` itu
  // variabel module biasa yang baru terisi SETELAH initFirebase() (async)
  // selesai di useAuth. Di render PERTAMA nilainya masih pasti `null`
  // (belum sempat diisi), jadi `!firebaseDB` selalu `true` walau Firebase
  // sebenarnya AKTIF & masih dalam proses sinkron — akibatnya cloudLoaded
  // salah kaprah dianggap "sudah loaded" sejak awal, padahal belum. Ini
  // yang bikin App.jsx mengira role user sudah pasti ("Viewer" sementara,
  // karena user/db.pengguna belum sempat termuat) lalu buru-buru menendang
  // tab manajer-only (Bagi Hasil, dll) ke Dashboard sebelum data asli
  // sempat masuk. `FIREBASE_CONFIGURED` dipakai sebagai gantinya karena
  // nilainya sudah pasti (sinkron, dari config) sejak render pertama.
  const [cloudLoaded, setCloudLoaded] = useState(!FIREBASE_CONFIGURED); // jika Firebase tidak aktif, anggap langsung "loaded" (mode lokal)
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
  const jurnalByYearRef = useRef({}); // { "2026": { id1:{...}, ... } } — sama pola dengan kontrolByYearRef, versi disederhanakan (lihat komentar di listener "jurnalUmum")
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

    const paths = [...LIST_TABLES, "stokAwal", "bagiHasilConfig", "daftarAkun", "saldoAkunBulanan"];
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
              markSyncActivity("kontrol", snap.key);
              if (!firstBatchDone) settle(); else recomputeDebounced();
            }, (err) => { setSyncError(err.message); if (countTowardBoot) markLoadedAndFlush("kontrol"); });
            onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); markSyncActivity("kontrol", snap.key); if (firstBatchDone) recomputeDebounced(); });
            onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; markSyncActivity("kontrol", snap.key); if (firstBatchDone) recomputeDebounced(); });
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

        if (key === "jurnalUmum") {
          // ── "jurnalUmum" dipartisi per-tahun sama seperti "kontrol" di
          // atas (field `.tanggal`, lewat kontrolYearOf()), TAPI disederhana­
          // kan: baca via onValue per tahun langsung (bukan listener
          // child_added/changed/removed inkremental). Volumenya di Fase 1
          // ini jauh lebih kecil dari kontrol, jadi belum perlu optimasi
          // sebesar itu — bisa di-upgrade ke pola kontrol persis kalau nanti
          // volume jurnal membesar signifikan (mis. setelah bertahun-tahun).
          const thisYear = new Date().getFullYear();
          const liveYears = Array.from({ length: KONTROL_LIVE_YEARS }, (_, i) => String(thisYear - i));
          const recomputeJurnalArr = () => {
            const merged = {};
            Object.values(jurnalByYearRef.current).forEach(yearMap => Object.assign(merged, yearMap));
            remoteRef.current.jurnalUmum = merged;
            setDB(prev => {
              const next = { ...prev, jurnalUmum: mapToArr(merged) };
              saveLocalDB(next);
              return next;
            });
          };
          liveYears.forEach(year => {
            const yr = ref(rtdb, `gwg_data/shared/jurnalUmum/${year}`);
            const unsub = onValue(yr, snap => {
              jurnalByYearRef.current[year] = snap.val() || {};
              recomputeJurnalArr();
              markLoadedAndFlush(key);
            }, (err) => { setSyncError(err.message); markLoadedAndFlush(key); });
            unsubs.push(() => off(yr));
          });
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
            markSyncActivity(key, snap.key);
            if (!firstBatchDone) scheduleSettle();
            else flushToStateDebounced();
          }, (err) => { setSyncError(err.message); markLoadedAndFlush(key); });

          const unsubChg = onChildChanged(r, snap => {
            localMap[snap.key] = snap.val();
            markSyncActivity(key, snap.key);
            if (firstBatchDone) flushToStateDebounced();
          });

          const unsubRem = onChildRemoved(r, snap => {
            delete localMap[snap.key];
            markSyncActivity(key, snap.key);
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
            else next[key] = val ?? ((key === "stokAwal" || key === "daftarAkun" || key === "saldoAkunBulanan") ? {} : null);
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
      if (syncActivityTimerRef.current) clearTimeout(syncActivityTimerRef.current);
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
    onChildAdded(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); markSyncActivity("kontrol", snap.key); if (!firstBatchDone) settle(); else recomputeDebounced(); });
    onChildChanged(yr, snap => { kontrolByYearRef.current[year][snap.key] = snap.val(); markSyncActivity("kontrol", snap.key); if (firstBatchDone) recomputeDebounced(); });
    onChildRemoved(yr, snap => { delete kontrolByYearRef.current[year][snap.key]; markSyncActivity("kontrol", snap.key); if (firstBatchDone) recomputeDebounced(); });
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
  const flushAgainRef = useRef(false);
  const flushWriteQueue = useCallback(async () => {
    if (!firebaseDB || !basePathRef.current) return;
    // Sedang mengirim → jangan tumpuk, tapi CATAT bahwa ada perubahan baru
    // supaya begitu putaran ini selesai langsung diproses (bukan menunggu
    // interval 30 detik).
    if (flushingRef.current) { flushAgainRef.current = true; return; }
    flushingRef.current = true;
    try {
      const { db: rtdb, ref, set } = firebaseDB;
      // Urutan kirim = urutan `ts` (waktu perubahan di-queue), bukan
      // alfabetis — penting untuk ketergantungan antar-koleksi (toko harus
      // sudah ada di server sebelum kontrol/penyesuaiannya). Lihat drainQueue.
      //
      // PERMISSION_DENIED bisa SEMENTARA (token login kedaluwarsa). Karena itu,
      // penolakan pertama pada putaran ini dicoba SEKALI LAGI setelah token
      // diperbarui, baru dianggap benar-benar ditolak.
      let tokenSudahDiperbarui = false;
      const kirim = async (path, value) => {
        const target = ref(rtdb, `gwg_data/shared/${path}`);
        try {
          await set(target, value);
        } catch (e) {
          if (!isPermissionDenied(e) || tokenSudahDiperbarui) throw e;
          tokenSudahDiperbarui = true;
          try { await firebaseAuth?.auth?.currentUser?.getIdToken(true); } catch { throw e; }
          await set(target, value);
        }
      };
      do {
        flushAgainRef.current = false;
        const hasil = await drainQueue(kirim, {
          // ✅ FIX: perubahan yang ditolak rules TIDAK lagi dibuang dari
          // antrean. Ia ditandai `denied` dan disimpan permanen di
          // IndexedDB sampai user memilih Kirim Ulang / Buang / Simpan
          // cadangan (lihat retryDenied/discardDenied/exportDenied).
          onDenied: (entry, message) => {
            console.error("Ditolak security rules (disimpan, tidak dibuang):", entry.path, message);
            setWriteDenied(prev => [...prev.filter(x => x.path !== entry.path), { path: entry.path, message, at: Date.now() }]);
          },
        });
        if (hasil.stopped) {
          console.warn("Sinkron tertunda (kemungkinan masih offline):", hasil.error);
          break; // coba lagi nanti begitu online/retry berikutnya
        }
      } while (flushAgainRef.current);
    } finally {
      flushingRef.current = false;
      refreshPendingCount();
    }
  }, [refreshPendingCount]);

  // Perubahan yang ditolak rules di sesi SEBELUMNYA tetap tampil di banner
  // begitu user login lagi (state writeDenied sendiri hanya di memori).
  useEffect(() => {
    if (!user) return;
    let batal = false;
    queueGetDenied().then(rows => {
      if (batal || !rows.length) return;
      setWriteDenied(prev => {
        const sudah = new Set(prev.map(x => x.path));
        return [...prev, ...rows.filter(r => !sudah.has(r.path)).map(r => ({ path: r.path, message: r.deniedMessage || "Permission denied", at: r.deniedAt || r.ts }))];
      });
    });
    return () => { batal = true; };
  }, [user]);

  // Kirim ulang semua perubahan yang ditolak (mis. setelah rules diperbaiki
  // atau Admin memberi izin), buang permanen, atau ekspor sebagai cadangan.
  const retryDenied = useCallback(async () => {
    const n = await queueRetryDenied();
    setWriteDenied([]);
    refreshPendingCount();
    flushWriteQueue();
    return n;
  }, [flushWriteQueue, refreshPendingCount]);
  const discardDenied = useCallback(async () => {
    const n = await queueDiscardDenied();
    setWriteDenied([]);
    return n;
  }, []);
  const exportDenied = useCallback(async () => queueGetDenied(), []);

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
    Promise.all(entries.map(([path, value]) => queueWrite(path, value))).then((tersimpan) => {
      refreshPendingCount();
      // ✅ FIX: kalau IndexedDB tidak tersedia (mis. private mode), queueWrite
      // gagal dan antrean kosong → sebelumnya perubahan TIDAK PERNAH dikirim
      // ke Firebase sama sekali. Kirim langsung sebagai upaya terbaik.
      if (tersimpan.some(ok => !ok) && firebaseDB && basePathRef.current) {
        const { db: rtdb, ref, set } = firebaseDB;
        entries.forEach(([path, value], i) => {
          if (tersimpan[i]) return;
          set(ref(rtdb, `gwg_data/shared/${path}`), value).catch(e => {
            if (isPermissionDenied(e)) setWriteDenied(prev => [...prev, { path, message: e?.message || "Permission denied", at: Date.now() }]);
            else console.warn("Kirim langsung gagal (IndexedDB tidak tersedia):", path, e);
          });
        });
      }
    });
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
        if (key === "kontrol" || key === "jurnalUmum") {
          // ✅ FIX "GAGAL disimpan — tidak ada izin" pada import massal (mis.
          // Import Excel Kontrol): sebelumnya baris ini menulis SATU BLOB
          // berisi seluruh record 1 tahun langsung ke path `kontrol/{tahun}`
          // (atau null untuk hapus semua). Tapi rules Firebase HANYA memberi
          // .write satu level lebih dalam lagi, di `kontrol/{tahun}/{id}`
          // (sama untuk jurnalUmum) — menulis di level tahun (lebih dangkal
          // dari situ) SELALU ditolak PERMISSION_DENIED, walau akunnya
          // Admin/Manajer, karena izin di child tidak "naik" ke induknya.
          // Sekarang dipecah per record (per id) supaya path yang ditulis
          // persis cocok dengan path yang diberi izin oleh rules — dan HANYA
          // record yang benar-benar berubah/dihapus yang dikirim (bukan
          // seluruh tahun), sekalian lebih hemat bandwidth untuk import besar.
          const yearsIndexKey = key === "kontrol" ? "kontrolYearsIndex" : "jurnalYearsIndex";
          const byYearBaru = {};
          (newDB[key] || []).forEach(rec => {
            const y = kontrolYearOf(rec);
            (byYearBaru[y] = byYearBaru[y] || {})[rec.id] = rec;
          });
          const byYearLama = {};
          (prevDB[key] || []).forEach(rec => {
            const y = kontrolYearOf(rec);
            (byYearLama[y] = byYearLama[y] || {})[rec.id] = rec;
          });
          const touchedYears = new Set([...Object.keys(byYearBaru), ...Object.keys(byYearLama)]);
          touchedYears.forEach(y => {
            const idsBaru = byYearBaru[y] || {};
            const idsLama = byYearLama[y] || {};
            const allIds = new Set([...Object.keys(idsBaru), ...Object.keys(idsLama)]);
            allIds.forEach(id => {
              if (idsBaru[id] === idsLama[id]) return; // record ini tidak berubah, skip
              updates[`${key}/${y}/${id}`] = idsBaru[id] || null; // null = record ini dihapus
              if (idsBaru[id]) markLocalWrite(key, id);
            });
            if (Object.keys(idsBaru).length > 0) updates[`${yearsIndexKey}/${y}`] = true;
          });
          return;
        }
        // ✅ FIX pencegahan (audit lanjutan, kasus sama dengan
        // kontrol/jurnalUmum/saldoAkunBulanan di atas): SEBAGIAN tabel di
        // LIST_TABLES ("kasTransaksi", "asetAmortisasi", "stockOpname",
        // "hutangPiutang", "penyesuaian", "penjualanLuar", "penarikanToko",
        // "gudangTransaksi", "pengguna") rules-nya HANYA memberi .write di
        // level `{table}/{id}`, TIDAK di root tabelnya — jadi menulis blob
        // `updates[key] = arrToMap(...)` ke root tabel (perilaku lama) akan
        // ditolak PERMISSION_DENIED untuk tabel-tabel itu kalau suatu saat
        // ada kode yang memanggil save() generik ini dengan tabel tsb
        // berubah (saat ini belum ada — semua mutasinya lewat addRecord/
        // updateRecord/deleteRecord yang sudah benar — tapi ini jadi jebakan
        // laten kalau ada fitur baru nanti yang pakai save()). Tabel yang
        // root-nya MEMANG diizinkan blob (wilayah/rute/produk/toko/
        // distribusiLog/tutupBuku) tetap aman ditulis per-record juga,
        // karena izin di root otomatis mengalir ke child-nya. Jadi: tulis
        // SEMUA tabel di sini per-record ke `{table}/{id}` — selalu cocok
        // dengan level permission tersempit yang mungkin berlaku, dan
        // sekalian lebih hemat bandwidth (hanya record yang berubah yang
        // dikirim).
        const lamaMap = {};
        (prevDB[key] || []).forEach(rec => { lamaMap[rec.id] = rec; });
        const baruMap = {};
        (newDB[key] || []).forEach(rec => { baruMap[rec.id] = rec; });
        const semuaId = new Set([...Object.keys(lamaMap), ...Object.keys(baruMap)]);
        semuaId.forEach(id => {
          if (baruMap[id] === lamaMap[id]) return; // record ini tidak berubah, skip
          updates[`${key}/${id}`] = baruMap[id] || null; // null = record ini dihapus
          if (baruMap[id]) markLocalWrite(key, id);
        });
      });
      if (newDB.stokAwal !== prevDB.stokAwal) updates.stokAwal = newDB.stokAwal || {};
      if (newDB.bagiHasilConfig !== prevDB.bagiHasilConfig) updates.bagiHasilConfig = newDB.bagiHasilConfig ?? null;
      if (newDB.daftarAkun !== prevDB.daftarAkun) updates.daftarAkun = newDB.daftarAkun || {};
      // ✅ FIX "GAGAL disimpan — tidak ada izin" saat Tutup Buku: "saldoAkunBulanan"
      // TIDAK ditulis sebagai satu blob di root — rules Firebase HANYA memberi
      // .write di level saldoAkunBulanan/{bulan}/{kode} (2 level lebih dalam),
      // bukan di saldoAkunBulanan atau saldoAkunBulanan/{bulan}. Menulis blob
      // utuh ke path yang lebih dangkal dari itu SELALU ditolak PERMISSION_DENIED
      // walau akunnya Admin/Manajer, karena Firebase tidak "menaikkan" izin dari
      // child ke ancestor-nya. Sekarang dipecah per bulan/kode (pola sama dengan
      // kontrol/jurnalUmum di atas) supaya path yang ditulis persis cocok dengan
      // path yang diberi izin oleh rules.
      if (newDB.saldoAkunBulanan !== prevDB.saldoAkunBulanan) {
        const saldoBaru = newDB.saldoAkunBulanan || {};
        const saldoLama = prevDB.saldoAkunBulanan || {};
        const touchedBulan = new Set([...Object.keys(saldoBaru), ...Object.keys(saldoLama)]);
        touchedBulan.forEach(bulan => {
          if (saldoBaru[bulan] === saldoLama[bulan]) return; // bulan ini tidak berubah, skip
          if (!saldoBaru[bulan]) {
            // Bulan ini dihapus seluruhnya (mis. saat "Buka Kunci" periode) —
            // hapus tiap akun SATU-SATU (`saldoAkunBulanan/{bulan}/{kode}` =
            // null), BUKAN sekaligus di level bulan — rules hanya beri .write
            // di level {bulan}/{kode}, sama seperti alasan di atas.
            Object.keys(saldoLama[bulan] || {}).forEach(kode => {
              updates[`saldoAkunBulanan/${bulan}/${kode}`] = null;
            });
            return;
          }
          Object.entries(saldoBaru[bulan]).forEach(([kode, val]) => {
            if (saldoLama[bulan]?.[kode] !== val) updates[`saldoAkunBulanan/${bulan}/${kode}`] = val;
          });
        });
      }
      if (Object.keys(updates).length) pushUpdates(updates);
      saveLocalDB(newDB);
      return newDB;
    });
  }, [pushUpdates, markLocalWrite]);
  // HANYA mengirim 1 record (path "table/id"), bukan seluruh tabel —
  // jauh lebih hemat bandwidth saat toko sudah ribuan & kontrol terus bertambah.
  // Untuk tabel "kontrol" khusus, path ditulis sebagai "kontrol/{tahun}/{id}"
  // (partisi tahun) alih-alih "kontrol/{id}".
  const addRecord = useCallback((table, record) => {
    // ✅ Tandai key ini "baru saja ditulis sendiri" SEBELUM push ke Firebase,
    // supaya begitu echo-nya sampai lewat listener (bisa dalam hitungan
    // milidetik di jaringan cepat), sudah langsung dikenali dan diabaikan
    // oleh markSyncActivity — secepat apa pun admin input berturut-turut.
    markLocalWrite(table, record.id);
    setDB(prevDB => {
      const nextArr = [...(prevDB[table]||[]), record];
      const next = { ...prevDB, [table]: nextArr };
      saveLocalDB(next);
      if (table === "kontrol" || table === "jurnalUmum") {
        const y = kontrolYearOf(record);
        const yearsIndexKey = table === "kontrol" ? "kontrolYearsIndex" : "jurnalYearsIndex";
        pushUpdates({ [`${table}/${y}/${record.id}`]: record, [`${yearsIndexKey}/${y}`]: true });
      } else {
        pushUpdates({ [`${table}/${record.id}`]: record });
      }
      return next;
    });
  }, [pushUpdates, markLocalWrite]);

  const updateRecord = useCallback((table, id, updated) => {
    markLocalWrite(table, id);
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
        if (table === "kontrol" || table === "jurnalUmum") {
          const oldYear = kontrolYearOf(oldRecord);
          const newYear = kontrolYearOf(mergedRecord);
          const yearsIndexKey = table === "kontrol" ? "kontrolYearsIndex" : "jurnalYearsIndex";
          if (oldYear !== newYear) {
            // Tanggal record diedit lintas-tahun: pindahkan node-nya. Ini
            // tetap menulis SELURUH record (bukan per-field) karena memang
            // operasinya "pindah path", bukan sekadar ubah beberapa field —
            // kasusnya juga jarang (ganti tanggal sampai lintas tahun).
            pushUpdates({
              [`${table}/${oldYear}/${id}`]: null,
              [`${table}/${newYear}/${id}`]: mergedRecord,
              [`${yearsIndexKey}/${newYear}`]: true,
            });
          } else {
            // ✅ FIX RISIKO TABRAKAN EDIT BERSAMAAN: dulu baris ini menulis
            // SELURUH `mergedRecord` (hasil gabungan field baru DENGAN
            // snapshot lokal lama) ke satu path. Untuk record kontrol —
            // yang field-nya bisa diubah dari 2 "aktor" berbeda hampir
            // bersamaan (mis. Sales mengedit kuantitas terjual dari HP-nya
            // sementara Admin menyetujui/menolak entri yang sama dari HP
            // lain, keduanya sempat offline) — siapa pun yang SINKRON
            // PALING AKHIR akan menimpa path itu dengan snapshotnya sendiri
            // yang sudah basi, sehingga perubahan pihak lain yang sudah
            // lebih dulu tersimpan di Firebase ikut hilang tanpa pesan
            // error apa pun. Sekarang tiap FIELD yang benar-benar berubah
            // (`updated`, bukan seluruh `mergedRecord`) ditulis sebagai
            // path terpisah `${table}/${year}/${id}/${field}` — supaya dua
            // tulisan yang menyentuh field BERBEDA pada record yang sama
            // tidak lagi saling menimpa, sama seperti pola yang sudah
            // dipakai untuk "toko" di bawah (alasan asalnya beda — rules
            // Sales — tapi manfaat anti-tabrakannya sama).
            const fieldUpdates = {};
            Object.keys(updated).forEach(field => {
              fieldUpdates[`${table}/${newYear}/${id}/${field}`] = updated[field] === undefined ? null : updated[field];
            });
            pushUpdates(fieldUpdates);
          }
        } else if (table === "toko" || table === "penyesuaian") {
          // ✅ FIX: Firebase Rules mendefinisikan izin Sales HANYA di level
          // `toko/$tokoId/$field` (per field: status/produkIds/stok_*/
          // produk_*) — TIDAK ADA rule Sales di level `toko/$tokoId` atau di
          // level `toko` (ancestor-nya, yang cuma izinkan Admin/Manajer).
          // Sebelumnya baris ini menulis SATU set() raksasa ke path
          // `toko/{id}` berisi SELURUH record gabungan — karena tidak ada
          // rule PERSIS di path itu, Firebase mundur ke rule ancestor
          // terdekat ("toko"), yang TIDAK mengizinkan Sales sama sekali.
          // Akibatnya SETIAP tulisan ke toko oleh akun Sales selalu ditolak
          // Firebase ("tidak ada izin"), walau field yang ditulis sebenarnya
          // ada di daftar yang diizinkan untuk Sales — termasuk Tarik Toko,
          // sinkronisasi ceklis produk & stok dari Penyesuaian Stok, dan
          // hitung ulang stok otomatis. Sekarang setiap field dikirim
          // sebagai path terpisah (`toko/{id}/{field}`), persis granularitas
          // yang diasumsikan rules — supaya field yang diizinkan untuk Sales
          // benar-benar bisa tersimpan, sekaligus tetap menolak field yang
          // memang di luar wewenang Sales (mis. nama, ruteId, statusHistory).
          // "penyesuaian" ikut dipindah ke pola ini juga (bukan karena
          // masalah rules seperti "toko", tapi karena tabel ini juga rawan
          // ditulis dari 2 aktor berbeda hampir bersamaan — Sales mengajukan,
          // Admin menyetujui/menolak — lihat catatan tabrakan edit di atas.
          const fieldUpdates = {};
          Object.keys(updated).forEach(field => {
            fieldUpdates[`${table}/${id}/${field}`] = updated[field] === undefined ? null : updated[field];
          });
          pushUpdates(fieldUpdates);
        } else {
          pushUpdates({ [`${table}/${id}`]: mergedRecord });
        }
      }
      return next;
    });
  }, [pushUpdates, markLocalWrite]);


  const deleteRecord = useCallback((table, id) => {
    markLocalWrite(table, id);
    setDB(prevDB => {
      const targetRecord = (table === "kontrol" || table === "jurnalUmum") ? (prevDB[table]||[]).find(r => r.id === id) : null;
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
      if ((table === "kontrol" || table === "jurnalUmum") && targetRecord) {
        pushUpdates({ [`${table}/${kontrolYearOf(targetRecord)}/${id}`]: null });
      } else {
        pushUpdates({ [`${table}/${id}`]: null }); // null = hapus path ini saja di Firebase
      }
      return next;
    });
  }, [pushUpdates, markLocalWrite]);

  // Pindahkan baris pengguna ke ID yang BENAR ("U_" + kunci email). Security
  // rules mencari role pengguna lewat ID itu; baris berID acak (dibuat lewat
  // form Tambah Pengguna versi lama) tidak pernah ditemukan → akun tsb tidak
  // punya akses server sama sekali. Sengaja BUKAN lewat deleteRecord() karena
  // itu memasukkan email ke daftar blokir (deletedUsers). Ditulis langsung &
  // berurutan: baris baru dulu, baru baris lama dihapus.
  const pindahIdPengguna = useCallback(async (idLama, barisBaru) => {
    if (!firebaseDB || !basePathRef.current) {
      return { ok: false, message: "Belum terhubung ke server. Coba lagi saat online." };
    }
    const { db: rtdb, ref, set } = firebaseDB;
    try {
      await set(ref(rtdb, `gwg_data/shared/pengguna/${barisBaru.id}`), barisBaru);
      if (idLama && idLama !== barisBaru.id) {
        await set(ref(rtdb, `gwg_data/shared/pengguna/${idLama}`), null);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e?.message || String(e) };
    }
  }, []);

  const updateStokToko = useCallback((tokoId, produkId, jumlah) => {
    markLocalWrite("toko", tokoId);
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
  }, [pushUpdates, markLocalWrite]);


  // ───────────────────────────────────────────────────────────────────────
  // BACKUP OTOMATIS & MANUAL
  // Tujuannya: kalaupun suatu saat ada kesalahan deploy/import/reset lagi,
  // selalu ada salinan yang bisa dipulihkan. Backup disimpan dengan KEY =
  // tanggal (YYYY-MM-DD), jadi backup di hari yang sama akan menimpa backup
  // hari itu saja (tidak menumpuk tanpa batas), dan backup lebih tua dari
  // MAX_BACKUPS hari otomatis dibersihkan.
  // ───────────────────────────────────────────────────────────────────────
  // Diturunkan dari 30 → 10 → 5 hari. Backup adalah SALINAN PENUH seluruh
  // database (termasuk tabel "kontrol" yang akan terus membesar selama
  // bertahun-tahun), jadi menyimpan banyak salinan penuh sekaligus adalah
  // pengguna kuota storage gratis Firebase (1GB) paling boros — bisa habis
  // jauh sebelum data penjualan asli sendiri mendekati batas itu. 5 hari
  // masih cukup untuk jaga-jaga kalau ada kesalahan input/impor yang baru
  // ketahuan beberapa hari kemudian, dan mengurangi separuh pengganda
  // ukuran backup (lihat catatan di backupNow() soal jurnalUmum).
  const MAX_BACKUPS = 5;
  const HARIAN_TERMASUK_JURNAL = true;

  // Objek API Firebase minimal untuk modul lib/backupRestore.js.
  const fbApi = () => {
    const { db: rtdb, ref, set, get } = firebaseDB;
    // Daftar NAMA kunci anak tanpa mengunduh isinya (REST ?shallow=true).
    // Dipakai untuk memangkas backup lama tanpa mengunduh semua snapshot.
    // Gagal/tidak tersedia → null, pemanggil jatuh ke get() biasa.
    const shallowKeys = async (p) => {
      try {
        const base = FIREBASE_CONFIG?.databaseURL;
        const token = await firebaseAuth?.auth?.currentUser?.getIdToken();
        if (!base || !token) return null;
        const r = await fetch(`${base.replace(/\/$/, "")}/${p}.json?shallow=true&auth=${encodeURIComponent(token)}`);
        if (!r.ok) return null;
        const j = await r.json();
        return j && typeof j === "object" ? Object.keys(j) : [];
      } catch { return null; }
    };
    return { rtdb, ref, set, get, shallowKeys };
  };

  // ✅ FIX (audit): snapshot cloud sekarang diambil dari SERVER, bukan dari
  // state React. Sebelumnya snapshot dibuat dari `db` di memori — yang bisa
  // PARSIAL (tabel besar dianggap "selesai dimuat" setelah jeda 900 ms) dan
  // hanya berisi tahun kontrol yang sedang live, lalu MENIMPA backup hari itu.
  // Sekarang: semua tahun kontrol, dan kalau satu pembacaan gagal seluruh
  // backup dibatalkan (tidak pernah menulis backup parsial).
  //
  // SEMUA jenis backup (harian, manual, pengaman reset/restore, ekspor penuh)
  // kini menyertakan jurnalUmum. Sebelumnya jurnal dikecualikan dari backup
  // harian demi kuota RTDB; tapi jurnal adalah data akuntansi yang TIDAK bisa
  // dibangun ulang dari data lain. Pemangkasan backup lama sekarang tidak lagi
  // mengunduh semua snapshot (lihat shallowKeys), jadi biayanya hanya storage
  // (~MAX_BACKUPS × ukuran database). Kalau suatu saat database sudah besar,
  // ubah HARIAN_TERMASUK_JURNAL ke false.
  const backupNow = useCallback(async (dbToBackup, { reason = "manual", termasukJurnal, sufiks } = {}) => {
    const nowIso = new Date().toISOString();
    const dateKey = nowIso.slice(0, 10); // YYYY-MM-DD
    const key = sufiks ? `${dateKey}-${sufiks}` : dateKey;
    const sertakanJurnal = termasukJurnal ?? (reason === "auto-harian" ? HARIAN_TERMASUK_JURNAL : true);

    if (user && firebaseDB && basePathRef.current) {
      let data;
      try {
        data = await ambilSnapshotServer(fbApi(), { termasukJurnal: sertakanJurnal });
      } catch (e) {
        return { snapshot: null, cloudOk: false, cloudError: `Gagal membaca data dari server: ${e?.message || e}` };
      }
      if (reason === "auto-harian" && snapshotKosong(data)) {
        return { snapshot: null, cloudOk: false, cloudError: "Database masih kosong — backup dilewati." };
      }
      const snapshot = { ts: nowIso, reason, versi: 2, data, jurnalUmumDikecualikan: !sertakanJurnal };
      try {
        await simpanBackupCloud(fbApi(), snapshot, key, MAX_BACKUPS);
        return { snapshot, cloudOk: true, cloudError: null };
      } catch (e) {
        console.warn("Backup ke cloud gagal:", e);
        return { snapshot, cloudOk: false, cloudError: e?.message || String(e) };
      }
    }

    // Mode lokal / belum login: salinan lokal dari state, seperti sebelumnya.
    const { jurnalUmum: _jurnalUmum, ...dbRingkas } = dbToBackup || {};
    const snapshot = { ts: nowIso, reason, data: sertakanJurnal ? (dbToBackup || {}) : dbRingkas, jurnalUmumDikecualikan: !sertakanJurnal };
    try { localStorage.setItem(`gwg_backup_${key}`, JSON.stringify(snapshot)); } catch {}
    return {
      snapshot, cloudOk: false,
      cloudError: !user ? "Belum login — backup cloud butuh akun Google aktif." : "Firebase belum aktif (aplikasi berjalan di Mode Lokal).",
    };
  }, [user]);

  // Ekspor penuh untuk diunduh sebagai file: semua tahun kontrol + jurnalUmum,
  // langsung dari server.
  const eksporPenuh = useCallback(async () => {
    if (!(user && firebaseDB && basePathRef.current)) return { ok: false, message: "Butuh login dan koneksi ke server." };
    try {
      const data = await ambilSnapshotServer(fbApi(), { termasukJurnal: true });
      return { ok: true, snapshot: { ts: new Date().toISOString(), reason: "ekspor-penuh", versi: 2, data, jurnalUmumDikecualikan: false } };
    } catch (e) {
      return { ok: false, message: e?.message || String(e) };
    }
  }, [user]);

  // Auto-backup 1x per hari per perangkat — hanya Admin/Manajer (yang boleh
  // menulis _backups). Snapshot diambil dari server sehingga tidak bergantung
  // pada state yang mungkin belum selesai dimuat. Penanda "sudah backup hari
  // ini" baru ditulis SETELAH sukses (sebelumnya ditulis sebelum hasil
  // diketahui, jadi kegagalan tidak pernah dicoba ulang di hari yang sama).
  const autoBackupBerjalanRef = useRef(false);
  const bolehBackupCloud = useMemo(() => {
    if (!user?.email) return false;
    const me = (db.pengguna || []).find(p => p.id === "U_" + encodeEmailKey(user.email.toLowerCase()));
    return me?.role === "Admin" || me?.role === "Manajer";
  }, [user, db.pengguna]);
  useEffect(() => {
    if (!cloudLoaded || !bolehBackupCloud || autoBackupBerjalanRef.current) return;
    let today;
    try {
      today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem("gwg_last_autobackup") === today) return;
    } catch { return; }
    autoBackupBerjalanRef.current = true;
    backupNow(null, { reason: "auto-harian" })
      .then(r => { if (r?.cloudOk) { try { localStorage.setItem("gwg_last_autobackup", today); } catch {} } })
      .finally(() => { autoBackupBerjalanRef.current = false; });
  }, [cloudLoaded, bolehBackupCloud, backupNow]);

  // Daftar backup yang tersedia di cloud, untuk ditampilkan di menu Admin.
  const listBackups = useCallback(async () => {
    if (!firebaseDB) return [];
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/_backups`));
      const all = snap.val() || {};
      return Object.entries(all)
        .map(([key, val]) => ({ key, ts: val?.ts, reason: val?.reason, data: val?.data, jurnalUmumDikecualikan: val?.jurnalUmumDikecualikan }))
        .sort((a, b) => b.key.localeCompare(a.key));
    } catch (e) {
      console.warn("Gagal memuat daftar backup:", e);
      return [];
    }
  }, []);

  // Restore dari satu snapshot backup. Semua penulisan PER RECORD (lihat
  // lib/backupRestore.js) sesuai level izin di security rules — versi lama
  // menulis di root `kontrol`/`jurnalUmum` dan level {tahun}, yang selalu
  // ditolak, sehingga data kontrol tidak pernah benar-benar pulih.
  //  • Tabel "pengguna" TIDAK ikut dipulihkan (bisa mengunci Admin sekarang).
  //  • Sebelum menulis: antrean lokal dikirim dulu dan dibuat backup pengaman
  //    kondisi saat ini (kunci terpisah "-sebelum-restore"). Kalau salah satu
  //    gagal, restore dibatalkan dan data tidak berubah.
  //  • Hanya tahun kontrol yang ADA di snapshot yang direkonsiliasi.
  const restoreBackup = useCallback(async (snapshotData, opsi = {}) => {
    const jurnalDisertakan = opsi.jurnalDisertakan ?? Object.prototype.hasOwnProperty.call(snapshotData || {}, "jurnalUmum");
    const online = !!(firebaseDB && user && basePathRef.current);

    if (online) {
      await flushWriteQueue();
      const tertunda = await queueCount();
      if (tertunda > 0) {
        return { ok: false, failed: ["antrean"], message: `Restore DIBATALKAN: masih ada ${tertunda} perubahan yang belum terkirim ke server. Sambungkan internet, tunggu sinkron selesai, lalu ulangi. Data tidak diubah.` };
      }
      const pengaman = await backupNow(null, { reason: "sebelum-restore", termasukJurnal: jurnalDisertakan, sufiks: "sebelum-restore" });
      if (!pengaman.cloudOk) {
        return { ok: false, failed: ["backup-pengaman"], message: `Restore DIBATALKAN: backup pengaman kondisi saat ini gagal (${pengaman.cloudError}). Data tidak diubah.` };
      }
    }

    const restored = { ...DB_EMPTY, ...snapshotData, pengguna: db.pengguna };
    if (!jurnalDisertakan) restored.jurnalUmum = db.jurnalUmum;
    setDB(restored);
    saveLocalDB(restored);
    flushLocalDBNow(); // hindari race dengan write lama yang masih ditunda debounce

    if (online) {
      const hasil = await jalankanRestore(fbApi(), snapshotData, { jurnalDisertakan });
      // Tahun-tahun kontrol yang baru dipulihkan harus resmi "termuat" supaya
      // tidak hilang dari layar saat recompute berikutnya.
      (hasil.tahunKontrol || []).forEach(year => loadKontrolYear(year));
      if (!hasil.ok) {
        const daftar = [...new Set(hasil.gagal.map(g => g.nama))];
        return { ok: false, failed: daftar, message: `Sebagian data GAGAL dipulihkan: ${daftar.join(", ")}. Penyebab pertama: ${hasil.gagal[0].pesan}. Muat ulang aplikasi untuk melihat kondisi data yang sebenarnya di server, lalu coba lagi. Kondisi sebelum restore tersimpan di backup "...-sebelum-restore".` };
      }
      return { ok: true };
    }

    // Mode lokal tanpa Firebase: antrean per-record (dikirim NANTI saat Firebase tersedia).
    const updates = {};
    LIST_TABLES.forEach(key => {
      if (key === "pengguna") return;
      (restored[key] || []).forEach(rec => {
        const p = (key === "kontrol" || key === "jurnalUmum") ? `${key}/${kontrolYearOf(rec)}/${rec.id}` : `${key}/${rec.id}`;
        updates[p] = rec;
      });
    });
    updates.stokAwal = restored.stokAwal || {};
    updates.bagiHasilConfig = restored.bagiHasilConfig ?? null;
    pushUpdates(updates);
    return { ok: true };
  }, [user, flushWriteQueue, backupNow, pushUpdates, loadKontrolYear, db.pengguna, db.jurnalUmum]);

  // ✅ FIX (audit): Reset versi lama menulis null di ROOT tabel — ditolak rules
  // untuk kontrol/penyesuaian/jurnalUmum/dst — sehingga hanya master data
  // (toko/wilayah/rute/produk) yang terhapus dan kontrol jadi yatim. Sekarang:
  //  1. antrean lokal dikirim dulu (supaya tidak menulis balik data lama),
  //  2. backup pengaman LENGKAP (termasuk jurnal) dibuat dan HARUS berhasil,
  //  3. data transaksi dihapus per record, baru master data; kalau ada tahap
  //     yang gagal, proses berhenti tanpa menyentuh master data,
  //  4. tabel "pengguna" tidak ikut dihapus.
  const resetDB = useCallback(async () => {
    const bersihkanLokal = () => {
      const kosong = { ...DB_EMPTY, pengguna: db.pengguna };
      setDB(kosong);
      saveLocalDB(kosong);
      flushLocalDBNow();
      kontrolByYearRef.current = {};
      setLoadedKontrolYears([]);
      setAvailableKontrolYears([]);
      jurnalByYearRef.current = {};
    };
    if (!(firebaseDB && user && basePathRef.current)) { bersihkanLokal(); return { ok: true, lokal: true }; }

    await flushWriteQueue();
    const tertunda = await queueCount();
    if (tertunda > 0) {
      return { ok: false, message: `Reset DIBATALKAN: masih ada ${tertunda} perubahan yang belum terkirim ke server. Sambungkan internet dan tunggu sinkron selesai dulu. Tidak ada data yang dihapus.` };
    }
    const pengaman = await backupNow(null, { reason: "sebelum-reset", termasukJurnal: true, sufiks: "sebelum-reset" });
    if (!pengaman.cloudOk) {
      return { ok: false, message: `Reset DIBATALKAN: backup pengaman gagal (${pengaman.cloudError}). Tidak ada data yang dihapus.` };
    }
    const hasil = await jalankanReset(fbApi());
    if (!hasil.ok) {
      const g = hasil.gagal[0];
      return { ok: false, message: `Reset BERHENTI di tahap "${hasil.tahap}" (${hasil.gagal.length} path gagal, contoh: ${g.path} — ${g.pesan}). Master data tidak dihapus supaya tidak ada data yatim. Backup pengaman ada di menu Backup & Restore (kunci "...-sebelum-reset").` };
    }
    bersihkanLokal();
    return { ok: true, dihapus: hasil.dihapus };
  }, [user, db.pengguna, flushWriteQueue, backupNow]);

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
  // Agregat pcs terjual/revenue/bonus PER TAHUN yang sudah diarsipkan — dibaca
  // dari field agregat di kontrolArchiveIndex/{tahun} (lihat archiveKontrolYear
  // & recalcArchivedYearAgregat di bawah). Tahun yang diarsipkan SEBELUM fitur
  // ini ada tidak akan punya field ini sampai admin klik "Hitung Ulang".
  const [archivedKontrolAgregat, setArchivedKontrolAgregat] = useState({}); // { [year]: { totalTerjualTahun, totalRevTahun, totalBonusTahun, agregatComputedAt } | undefined }
  const archiveIndexRef = useRef({}); // { [year]: { fileId, driveLink, ...agregat } } — untuk lookup fileId tanpa query ulang

  const refreshArchivedYears = useCallback(async () => {
    if (!firebaseDB) return;
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex`));
      const all = snap.val() || {};
      archiveIndexRef.current = all;
      setArchivedKontrolYears(Object.keys(all).sort());
      const agregat = {};
      Object.entries(all).forEach(([year, entry]) => {
        if (entry?.totalTerjualTahun !== undefined) {
          agregat[year] = {
            totalTerjualTahun: entry.totalTerjualTahun,
            totalRevTahun: entry.totalRevTahun,
            totalBonusTahun: entry.totalBonusTahun,
            agregatComputedAt: entry.agregatComputedAt,
          };
        }
      });
      setArchivedKontrolAgregat(agregat);
    } catch (e) { console.warn("Gagal memuat daftar arsip:", e); }
  }, []);

  useEffect(() => { if (user && firebaseDB) refreshArchivedYears(); }, [user, refreshArchivedYears]);

  // ─────────────────────────────────────────────
  //  ARSIP "jurnalUmum" PER TAHUN (Google Drive) — sama pola dengan arsip
  //  "kontrol" di atas. Ini mengisi kekosongan yang dicatat di Fase 6/7:
  //  "jurnalUmum belum ada mekanisme arsip". Index ringan disimpan di
  //  `jurnalArchiveIndex/{tahun}`.
  // ─────────────────────────────────────────────
  const [archivedJurnalYears, setArchivedJurnalYears] = useState([]);
  const refreshArchivedJurnalYears = useCallback(async () => {
    if (!firebaseDB) return;
    try {
      const { db: rtdb, ref, get } = firebaseDB;
      const snap = await get(ref(rtdb, `gwg_data/shared/jurnalArchiveIndex`));
      setArchivedJurnalYears(Object.keys(snap.val() || {}).sort());
    } catch (e) { console.warn("Gagal memuat daftar arsip jurnal:", e); }
  }, []);
  useEffect(() => { if (user && firebaseDB) refreshArchivedJurnalYears(); }, [user, firebaseDB, refreshArchivedJurnalYears]);

  // Arsipkan SELURUH entry jurnalUmum (baik yang aktif MAUPUN yang sudah
  // void) satu tahun ke Drive, lalu hapus dari RTDB. SENGAJA tidak
  // memisahkan "hanya hapus yang void" — entry yang masih aktif di bulan
  // yang sama tetap dibutuhkan kalau admin suatu saat "Buka Kunci" bulan
  // itu lagi (bukaKunciBulan() di NeracaKeuangan.jsx menghapus snapshot
  // saldoAkunBulanan dan mengandalkan jurnalUmum mentah untuk dihitung
  // ulang) — jadi meng-arsipkan per BLOK TAHUN PENUH (bukan prune baris per
  // baris) adalah satu-satunya cara yang aman: begitu diarsipkan, admin
  // paham konsekuensinya sama seperti arsip "kontrol" (data dipindah, kalau
  // mau dibuka lagi harus direstore dulu dari arsip).
  //
  // ⚠️ SEBAIKNYA hanya arsipkan tahun yang SEMUA bulannya sudah Tutup Buku
  // (ada snapshot `saldoAkunBulanan` untuk tiap bulan Jan–Des tahun itu) —
  // fungsi ini TIDAK memblokir kalau belum, tapi memberi peringatan lewat
  // field `semuaBulanTertutup` di hasilnya supaya UI bisa menampilkannya
  // sebelum admin konfirmasi.
  const archiveJurnalTahun = useCallback(async (year) => {
    year = String(year);
    if (!user || !firebaseDB) return { ok: false, message: "Firebase belum siap." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    let pointOfNoReturn = false;
    try {
      const snap = await get(ref(rtdb, `gwg_data/shared/jurnalUmum/${year}`));
      const yearData = snap.val();
      if (!yearData || Object.keys(yearData).length === 0) {
        return { ok: false, message: `Tidak ada data jurnal tahun ${year} untuk diarsipkan.` };
      }
      const recordCount = Object.keys(yearData).length;

      const bulanTahunIni = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
      const semuaBulanTertutup = bulanTahunIni.every(bk => !!(db.saldoAkunBulanan || {})[bk]);

      const archivedAt = new Date().toISOString();
      const fileData = await gdriveUploadJSON(
        `gwg_arsip_jurnal_${year}.json`,
        { year, archivedAt, recordCount, data: yearData },
        `${loadAppConfig().brand.appName || "App"} - Arsip Jurnal Umum (Akuntansi) tahun ${year}`
      );
      if (!fileData?.id) {
        return { ok: false, message: "Upload arsip jurnal tampak gagal (tidak dapat file ID) — data ASLI di database tidak diubah, aman untuk dicoba lagi." };
      }

      await set(ref(rtdb, `gwg_data/shared/jurnalUmum/${year}`), null);
      pointOfNoReturn = true;

      const cleanupWarnings = [];
      try {
        await set(ref(rtdb, `gwg_data/shared/jurnalYearsIndex/${year}`), null);
      } catch (e) {
        cleanupWarnings.push(`index tahun (jurnalYearsIndex) gagal dibersihkan: ${e.message}`);
      }
      try {
        await set(ref(rtdb, `gwg_data/shared/jurnalArchiveIndex/${year}`), {
          fileId: fileData.id,
          driveLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
          archivedAt, recordCount, semuaBulanTertutup,
        });
      } catch (e) {
        cleanupWarnings.push(`daftar arsip (jurnalArchiveIndex) gagal dicatat: ${e.message}`);
      }

      setDB(prev => {
        const next = { ...prev, jurnalUmum: (prev.jurnalUmum || []).filter(rec => kontrolYearOf(rec) !== year) };
        saveLocalDB(next);
        return next;
      });
      await refreshArchivedJurnalYears();

      const baseMsg = `${recordCount} entry jurnal tahun ${year} berhasil diarsipkan ke Google Drive dan dihapus dari database aktif.`;
      const warnMsg = !semuaBulanTertutup ? ` Perhatian: belum semua bulan tahun ${year} ditutup buku (di-snapshot) — pastikan tidak perlu "Buka Kunci" bulan manapun di tahun ini lagi sebelum mengarsipkan.` : "";
      return { ok: true, recordCount, semuaBulanTertutup, cleanupWarnings, message: `${baseMsg}${warnMsg}${cleanupWarnings.length ? " Catatan: " + cleanupWarnings.join(" ") : ""}` };
    } catch (e) {
      console.warn(`Gagal mengarsipkan jurnal tahun ${year}:`, e);
      if (pointOfNoReturn) {
        return { ok: false, partiallyDone: true, message: `Data jurnal tahun ${year} sudah terlanjur terhapus dari database aktif dan sudah tersimpan di Google Drive, tapi ada masalah lanjutan (${e.message}). Cek "jurnalArchiveIndex" — kalau file Drive-nya ada, data AMAN.` };
      }
      return { ok: false, message: `Gagal mengarsipkan jurnal: ${e.message}. Data ASLI tidak diubah — aman untuk dicoba lagi.` };
    }
  }, [user, db.saldoAkunBulanan, refreshArchivedJurnalYears]);

  // Pindahkan satu tahun data kontrol dari RTDB → Google Drive.
  // Urutan PENTING demi keamanan data: upload & VERIFIKASI dulu baru hapus
  // dari RTDB — kalau upload gagal di tengah jalan, data asli di RTDB tidak
  // disentuh sama sekali (tidak ada risiko kehilangan data).
  const archiveKontrolYear = useCallback(async (year) => {
    year = String(year);
    if (!user || !firebaseDB) return { ok: false, message: "Firebase belum siap." };
    const { db: rtdb, ref, get, set } = firebaseDB;
    let pointOfNoReturn = false; // true setelah kontrol/{year} berhasil dihapus dari RTDB
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

      // 1b) Hitung agregat (pcs terjual/revenue/bonus) tahun ini SEBELUM
      //     datanya dihapus dari RTDB — supaya Kewajiban Dana Cadangan
      //     Kumulatif (lihat neracaHelpers.js → hitungDanaCadanganKumulatif)
      //     tetap akurat walau tahun ini nanti hilang dari db.kontrol aktif.
      //     Pakai db.produk yang berlaku SAAT INI (harga sekarang) — untuk
      //     totalTerjualTahun (pcs) ini tidak masalah karena tidak
      //     bergantung harga sama sekali.
      const agregatTahunIni = hitungAgregatTahunKontrol(yearData, db.produk);

      // 2) Upload sebagai satu file JSON ke Google Drive. Kalau upload
      //    gagal (exception dilempar dari dalam gdriveUploadJSON), fungsi
      //    berhenti di sini lewat catch di bawah — RTDB tidak disentuh.
      const archivedAt = new Date().toISOString();
      const fileData = await gdriveUploadJSON(
        `gwg_arsip_kontrol_${year}.json`,
        { year, archivedAt, recordCount, data: yearData },
        `${loadAppConfig().brand.appName || "App"} - Arsip Kontrol Bulanan tahun ${year}`
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

      // ✅ FIX BUG #3: sebelum baris ini, kalau salah satu langkah di bawah
      // gagal (mis. karena permission-denied di rules), error-nya lolos ke
      // catch paling luar yang isi pesannya "data ASLI tidak diubah" — padahal
      // `kontrol/{year}` di bawah ini SUDAH dihapus dari database aktif duluan.
      // Sekarang, begitu baris hapus `kontrol/{year}` di bawah berhasil, kita
      // anggap sudah "titik tanpa jalan balik" (point of no return): upload
      // Drive sudah sukses & data live sudah terhapus, jadi pesan error
      // sesudah titik ini TIDAK BOLEH lagi bilang "data aman/tidak diubah".
      // Langkah pembersihan index (kontrolYearsIndex, kontrolArchiveIndex)
      // juga dibuat best-effort satu-satu — kalau salah satu gagal, yang lain
      // tetap dicoba, dan hasil akhirnya tetap dilaporkan sebagai SUKSES
      // (recordCount tersimpan) tapi dengan catatan langkah mana yang perlu
      // dicek manual, bukan seolah-olah seluruh proses gagal total.
      await set(ref(rtdb, `gwg_data/shared/kontrol/${year}`), null);
      pointOfNoReturn = true;

      const cleanupWarnings = [];
      try {
        await set(ref(rtdb, `gwg_data/shared/kontrolYearsIndex/${year}`), null);
      } catch (e) {
        console.warn(`Gagal membersihkan kontrolYearsIndex/${year}:`, e);
        cleanupWarnings.push(`index tahun (kontrolYearsIndex) — coba lagi lewat menu Arsip, atau abaikan (tidak memengaruhi data yang sudah diarsipkan).`);
      }
      try {
        await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), {
          fileId: fileData.id,
          driveLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
          archivedAt, recordCount,
          totalTerjualTahun: agregatTahunIni.totalTerjualTahun,
          totalRevTahun: agregatTahunIni.totalRevTahun,
          totalBonusTahun: agregatTahunIni.totalBonusTahun,
          agregatComputedAt: archivedAt,
        });
      } catch (e) {
        console.warn(`Gagal mencatat kontrolArchiveIndex/${year}:`, e);
        cleanupWarnings.push(`daftar arsip (kontrolArchiveIndex) — file sudah ada di Google Drive, tapi mungkin tidak muncul di daftar "Riwayat Arsip" sampai dicatat ulang.`);
      }

      // 4) Bersihkan tahun ini dari state lokal (db.kontrol gabungan)
      //    supaya UI tidak lagi menampilkan data yang sudah dipindah.
      setLoadedKontrolYears(prev => prev.filter(y => y !== year));
      setDB(prev => {
        const next = { ...prev, kontrol: prev.kontrol.filter(rec => kontrolYearOf(rec) !== year) };
        saveLocalDB(next);
        return next;
      });
      await refreshArchivedYears();

      const baseMsg = `${recordCount} data kontrol tahun ${year} berhasil diarsipkan ke Google Drive dan dihapus dari database aktif.`;
      const message = cleanupWarnings.length > 0
        ? `${baseMsg} Namun ada langkah pembersihan tambahan yang gagal: ${cleanupWarnings.join(" ")}`
        : baseMsg;
      return { ok: true, recordCount, cleanupWarnings, message };
    } catch (e) {
      console.warn(`Gagal mengarsipkan tahun ${year}:`, e);
      if (pointOfNoReturn) {
        // Data live SUDAH terhapus (dan sudah tersimpan aman di Drive) —
        // jangan lagi bilang "data ASLI tidak diubah", supaya admin tidak
        // salah kira proses belum jalan sama sekali dan mengulang upload.
        return { ok: false, partiallyDone: true, message: `Data kontrol tahun ${year} sudah terlanjur terhapus dari database aktif dan sudah tersimpan di Google Drive, tapi ada masalah lanjutan (${e.message}). Cek menu "Riwayat Arsip" — kalau file Drive-nya ada, data AMAN, tidak perlu upload ulang.` };
      }
      return { ok: false, message: `Gagal mengarsipkan: ${e.message}. Data ASLI tidak diubah — aman untuk dicoba lagi.` };
    }
  }, [user, refreshArchivedYears, db.produk]);

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

  // Hitung ulang agregat (pcs terjual/revenue/bonus) untuk SATU tahun arsip
  // LAMA yang dibuat sebelum fitur agregat ini ada (kontrolArchiveIndex/{tahun}
  // belum punya field totalTerjualTahun). Download ulang file JSON arsipnya
  // dari Drive sekali, hitung, lalu simpan permanen ke index — supaya ke
  // depannya tidak perlu diunduh ulang lagi. Dipanggil dari tombol "Hitung
  // Ulang Sekarang" di Laporan Neraca saat ada arsip yang belum lengkap.
  // ⚠️ totalRevTahun hasil ini pakai HARGA PRODUK SAAT INI (bukan harga
  // historis saat tahun itu berjalan) — jadi hanya estimasi. totalTerjualTahun
  // (pcs, satu-satunya yang dipakai Dana Cadangan Kumulatif) tetap akurat
  // karena tidak bergantung harga sama sekali.
  const recalcArchivedYearAgregat = useCallback(async (year) => {
    year = String(year);
    if (!firebaseDB) return { ok: false, message: "Firebase belum siap." };
    const entry = archiveIndexRef.current[year];
    if (!entry?.fileId) return { ok: false, message: "Data arsip tahun ini tidak ditemukan di index." };
    try {
      const parsed = await gdriveDownloadJSON(entry.fileId);
      const agregat = hitungAgregatTahunKontrol(parsed.data || {}, db.produk);
      const agregatComputedAt = new Date().toISOString();
      const { db: rtdb, ref, set } = firebaseDB;
      const updatedEntry = { ...entry,
        totalTerjualTahun: agregat.totalTerjualTahun,
        totalRevTahun: agregat.totalRevTahun,
        totalBonusTahun: agregat.totalBonusTahun,
        agregatComputedAt,
      };
      await set(ref(rtdb, `gwg_data/shared/kontrolArchiveIndex/${year}`), updatedEntry);
      archiveIndexRef.current = { ...archiveIndexRef.current, [year]: updatedEntry };
      setArchivedKontrolAgregat(prev => ({ ...prev, [year]: {
        totalTerjualTahun: agregat.totalTerjualTahun,
        totalRevTahun: agregat.totalRevTahun,
        totalBonusTahun: agregat.totalBonusTahun,
        agregatComputedAt,
      } }));
      return { ok: true, ...agregat };
    } catch (e) {
      console.warn(`Gagal menghitung ulang agregat arsip tahun ${year}:`, e);
      return { ok: false, message: `Gagal mengunduh/menghitung arsip dari Google Drive: ${e.message}` };
    }
  }, [db.produk]);

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

  // Ringkasan gabungan seluruh tahun terarsip: total pcs terjual (buat
  // ditambahkan ke Dana Cadangan Kumulatif via neracaHelpers.js), plus flag
  // kalau ada tahun terarsip yang BELUM punya agregat tersimpan (arsip lama
  // dari sebelum fitur ini ada) — supaya UI bisa munculkan peringatan +
  // tombol "Hitung Ulang Sekarang" alih-alih diam-diam kurang akurat.
  const totalArsipPcsTerjual = useMemo(() => {
    let total = 0;
    let adaYangPerluDihitungUlang = false;
    const tahunPerluDihitungUlang = [];
    archivedKontrolYears.forEach(year => {
      const agregat = archivedKontrolAgregat[year];
      if (agregat?.totalTerjualTahun !== undefined) {
        total += agregat.totalTerjualTahun;
      } else {
        adaYangPerluDihitungUlang = true;
        tahunPerluDihitungUlang.push(year);
      }
    });
    return { total, adaYangPerluDihitungUlang, tahunPerluDihitungUlang };
  }, [archivedKontrolYears, archivedKontrolAgregat]);

  // ═══════════════════════════════════════════════════════════════════
  //  FASE 1 DOUBLE-ENTRY ACCOUNTING — mesin posting (lihat akuntansiHelpers.js
  //  & RANCANGAN-double-entry.md). Fungsi-fungsi ini murni infrastruktur;
  //  BELUM ada titik input (Kas/Aset/Hutang/Kontrol) yang memanggilnya
  //  otomatis — itu Fase 2 dst. Diekspos di sini supaya siap dipakai.
  // ═══════════════════════════════════════════════════════════════════

  // Posting 1 entry jurnal baru. Melempar Error kalau tidak balance (lihat
  // validateJurnal di akuntansiHelpers.js) — SENGAJA gagal keras, bukan
  // menyimpan entry timpang. `createdBy` sebaiknya diisi email/id user aktif
  // (dari App.jsx) untuk audit trail.
  const postJurnal = useCallback(({ tanggal, sumberTipe, sumberId, keterangan, baris, createdBy }) => {
    const entry = buatEntryJurnal({ tanggal, sumberTipe, sumberId, keterangan, baris, createdBy });
    addRecord("jurnalUmum", entry);
    return entry;
  }, [addRecord]);

  // Batalkan 1 entry jurnal: entry LAMA ditandai void:true (TIDAK dihapus —
  // audit trail harus utuh), lalu entry BARU dibuat berisi baris kebalikan
  // supaya saldo akun tetap benar. Dipakai saat transaksi sumbernya
  // diedit/dihapus (Fase 2 dst akan memanggil ini otomatis dari
  // updateRecord/deleteRecord tabel sumber terkait).
  const voidJurnal = useCallback((entryId, { alasan, createdBy } = {}) => {
    const entryLama = (db.jurnalUmum || []).find(j => j.id === entryId);
    if (!entryLama) return { ok: false, message: "Entry jurnal tidak ditemukan." };
    if (entryLama.void) return { ok: false, message: "Entry ini sudah pernah dibatalkan sebelumnya." };
    // ✅ FIX (audit — akar masalah siklus Tutup Buku tak berhenti, lihat
    // catatan lengkap di buatEntryPembalik(), akuntansiHelpers.js): entry
    // PEMBALIK tidak boleh dibalik lagi — membalik sebuah pembalik artinya
    // justru MENEGASKAN KEMBALI efek entry asli yang harusnya sudah batal.
    // Pemanggil (jurnalAktifSumber dkk) sudah dibenahi untuk tidak
    // menyertakan entry pembalik sejak awal — guard ini cuma jaring
    // pengaman kedua kalau ada jalur lain yang lolos.
    if (entryLama.isPembalik) return { ok: false, message: "Entry ini adalah entry pembalik — tidak boleh dibatalkan lagi." };
    const entryBalik = buatEntryPembalik(entryLama, { keterangan: alasan, createdBy });
    updateRecord("jurnalUmum", entryId, { void: true, voidAt: Date.now(), voidKeterangan: alasan || "" });
    addRecord("jurnalUmum", entryBalik);
    return { ok: true, entryBalik };
  }, [db.jurnalUmum, updateRecord, addRecord]);

  // Isi `daftarAkun` dengan Chart of Accounts default — HANYA kalau memang
  // masih kosong (instalasi baru/migrasi pertama). Sengaja TIDAK dipanggil
  // otomatis dari dalam hook ini (useDB tidak tahu role user yang login) —
  // App.jsx yang memanggil, digerbangi `isAdmin` di sisi pemanggil, dengan
  // Firebase Rules sebagai penjaga terakhir kalau ada yang mencoba memanggil
  // tanpa izin.
  const seedDaftarAkunJikaKosong = useCallback(() => {
    if (db.daftarAkun && Object.keys(db.daftarAkun).length > 0) {
      return { ok: false, message: "daftarAkun sudah terisi — tidak ditimpa." };
    }
    save({ ...db, daftarAkun: DEFAULT_DAFTAR_AKUN });
    return { ok: true };
  }, [db, save]);

  return { db, addRecord, updateRecord, deleteRecord, resetDB, updateStokToko, save, syncing, lastSync, syncError, writeDenied, clearWriteDenied, retryDenied, discardDenied, exportDenied, pindahIdPengguna, eksporPenuh, pendingSync, cloudLoaded, dataStillSyncing, backupNow, listBackups, restoreBackup, deletedUsersRef, listDeletedUsers, restoreDeletedUser, loadedKontrolYears, availableKontrolYears, loadKontrolYear, runKontrolYearMigration, archivedKontrolYears, archiveKontrolYear, viewArchivedKontrolYear, exportArchivedKontrolYear, deleteArchivedKontrolYear, archivedKontrolAgregat, recalcArchivedYearAgregat, totalArsipPcsTerjual, postJurnal, voidJurnal, seedDaftarAkunJikaKosong, archiveJurnalTahun, archivedJurnalYears };
}



// ─────────────────────────────────────────────
//  DERIVED ANALYTICS
// ─────────────────────────────────────────────
