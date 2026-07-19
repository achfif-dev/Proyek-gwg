import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { T } from "./theme/tokens";
import { GWG_LOGO_B64 } from "./theme/logo";
import { DB_EMPTY } from "./config/dbEmpty";
import { FIREBASE_CONFIGURED } from "./firebase/config";
import { firebaseDB } from "./firebase/init";
import { SUPER_ADMIN_EMAIL, isSuperAdminEmail, SUPER_ADMIN_CANONICAL_ID } from "./config/superAdmin";
import { TABS, canAccessTab, getInitialActiveTab, ACTIVE_TAB_SESSION_KEY, SALES_ALLOWED_TABS } from "./config/tabs";
import { useAuth } from "./hooks/useAuth";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useAppResumeReload } from "./hooks/useAppResumeReload";
import { usePresence } from "./hooks/usePresence";
import { useDB } from "./hooks/useDB";
import { useAnalytics } from "./hooks/useAnalytics";
import { encodeEmailKey, decodeEmailKey } from "./lib/dataHelpers";
import { downloadJSON } from "./lib/fileSave";
import { gdriveUploadJSON, gdriveDownloadJSON, gdriveDeleteFile } from "./lib/googleDrive";
import { exportExcel, autoColumns } from "./lib/exportUtils";
import { fmt, fmtRp, genUniqueId } from "./lib/format";
import { LoginPage } from "./components/LoginPage";
import { HeaderMenu, useClampedMenuPosition } from "./components/ui/Menus";
import { Btn, Card, Modal, Badge, Input, SearchableSelect, ConfirmDelete } from "./components/ui/Primitives";
import { Dashboard } from "./features/dashboard/Dashboard";
import { TabWilayah } from "./features/wilayah/TabWilayah";
import { TabRute } from "./features/rute/TabRute";
import { TabToko, autoUpgradeBaruToAktif } from "./features/toko/TabToko";
import { TabProduk } from "./features/produk/TabProduk";
import { TabKontrol } from "./features/kontrol/TabKontrol";
import { TabRekap } from "./features/rekap/TabRekap";
import { TabBagiHasil } from "./features/bagihasil/TabBagiHasil";
import { TabPengguna } from "./features/pengguna/TabPengguna";

export default function GWGSuperApp() {
  // Tombol refresh manual — versi PWA/browser punya gesture "tarik ke bawah
  // untuk refresh" bawaan Chrome, tapi WebView native (APK) tidak punya ini
  // sama sekali. Data sebenarnya sudah live-sync lewat Firebase real-time
  // listener, tapi kalau koneksi sempat putus-nyambung (sinyal lemah) dan
  // listener-nya tidak reconnect otomatis, tombol ini jadi jalan pintas
  // "muat ulang total" — setara reload halaman di browser.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return; // di web/PWA tidak perlu, sudah ada gesture bawaan
    if (document.getElementById("gwg-native-refresh-btn")) return;
    const btn = document.createElement("button");
    btn.id = "gwg-native-refresh-btn";
    btn.innerHTML = "&#8635;";
    btn.setAttribute("aria-label", "Muat ulang");
    Object.assign(btn.style, {
      position: "fixed", bottom: "20px", right: "16px", zIndex: "99999",
      width: "48px", height: "48px", borderRadius: "50%", border: "none",
      background: "#16a34a", color: "#fff", fontSize: "22px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex",
      alignItems: "center", justifyContent: "center",
    });
    btn.onclick = () => window.location.reload();
    document.body.appendChild(btn);
    return () => { btn.remove(); };
  }, []);

  const isOnline = useOnlineStatus();
  useAppResumeReload();
  const [activeTab, setActiveTab] = useState(getInitialActiveTab);
  // Simpan tab aktif ke sessionStorage setiap kali berubah, supaya refresh
  // (tombol header maupun refresh browser) tetap membuka tab yang sama.
  useEffect(() => {
    try { sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, activeTab); } catch {}
  }, [activeTab]);
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetStep, setResetStep] = useState(1); // 1 = alasan, 2 = konfirmasi ketik
  const [resetAlasan, setResetAlasan] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [backupList, setBackupList] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCloudMsg, setBackupCloudMsg] = useState(null); // { ok, message } — hasil klik "Simpan Snapshot ke Cloud"
  const [restoring, setRestoring] = useState(false); // true selama proses tulis restore berjalan (cegah klik ganda + kasih indikator)
  const [restoreTarget, setRestoreTarget] = useState(null); // snapshot yang mau direstore (perlu konfirmasi)
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreFileError, setRestoreFileError] = useState(""); // error saat baca file backup lokal/Drive
  const restoreFileRef = useRef(null);
  const [migrating, setMigrating] = useState(false); // migrasi struktur kontrol → partisi tahun sedang berjalan
  const [migrationResult, setMigrationResult] = useState(null); // { ok, message } hasil migrasi terakhir
  const [migrateConfirmText, setMigrateConfirmText] = useState("");
  const [archivingYear, setArchivingYear] = useState(null); // tahun yang sedang diproses arsip
  const [archiveMsg, setArchiveMsg] = useState(null); // { ok, message } hasil aksi arsip terakhir
  const [viewArchiveYear, setViewArchiveYear] = useState(null); // tahun yang sedang dibuka untuk dilihat (modal)
  const [viewArchiveData, setViewArchiveData] = useState(null); // { records, archivedAt, recordCount } | "loading" | null
  const [exportingArchiveYear, setExportingArchiveYear] = useState(null);
  const [deleteArchiveConfirmYear, setDeleteArchiveConfirmYear] = useState(null);
  const [deleteArchiveConfirmText, setDeleteArchiveConfirmText] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showActiveUsers, setShowActiveUsers] = useState(false);
  // Ref tombol "Pengguna Aktif" + posisi panel yang selalu di-clamp di dalam
  // viewport (pakai hook yang sama dengan HeaderMenu) supaya di HP tidak
  // pernah terpotong/keluar layar di sisi kiri seperti sebelumnya.
  const activeUsersRef = useRef(null);
  const activeUsersMenuStyle = useClampedMenuPosition(showActiveUsers, activeUsersRef, 260);
  useEffect(() => {
    const handler = (e) => { if (activeUsersRef.current && !activeUsersRef.current.contains(e.target)) setShowActiveUsers(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  // Header dibuat position:fixed (bukan sticky) supaya BENAR-BENAR diam di
  // atas layar walau di-scroll, apa pun konteks scroll container tempat app
  // ini di-embed (sticky bisa gagal kalau parent punya overflow sendiri).
  // Tinggi header diukur otomatis (beda-beda di mobile vs desktop) lalu
  // dipakai sebagai spacer supaya konten di bawahnya tidak ketutupan.
  //
  // Diukur berkali-kali (bukan cuma sekali saat mount) karena tinggi header
  // bisa berubah SETELAH render pertama akibat hal-hal yang di luar kendali
  // urutan render React: font web yang baru selesai dimuat, foto profil
  // Google (user.photoURL) yang baru selesai di-fetch dari jaringan, atau
  // address bar browser HP yang muncul/hilang saat discroll. ResizeObserver
  // menangani perubahan susulan secara real-time, sedangkan beberapa
  // pengukuran ulang di awal (rAF + timeout bertahap) menutup celah race
  // condition sebelum ResizeObserver sempat terpasang/bereaksi. Ditambah
  // buffer +4px supaya tidak pernah kurang 1px pun (konten tidak akan
  // pernah ketutupan/terpotong walau ada pembulatan sub-pixel).
  // Header dibuat position:fixed (bukan sticky) supaya BENAR-BENAR diam di
  // atas layar walau di-scroll, apa pun konteks scroll container tempat app
  // ini di-embed (sticky bisa gagal kalau parent punya overflow sendiri).
  // Tinggi header diukur otomatis (beda-beda di mobile vs desktop) lalu
  // dipakai sebagai spacer supaya konten di bawahnya tidak ketutupan.
  //
  // PENTING: pakai CALLBACK REF (bukan useRef + useLayoutEffect ber-deps [])
  // karena komponen ini punya beberapa "return" bersyarat SEBELUM header-nya
  // dirender (saat masih loading, dan saat user belum login — lihat
  // `if (loading) return ...` dan `if (!user) return <LoginPage/>` di bawah).
  // Kalau pakai useRef biasa, effect ber-deps [] akan telanjur jalan sekali
  // pada mount PERTAMA (saat itu header belum ada di DOM sama sekali karena
  // masih loading/login), lalu tidak akan pernah jalan lagi setelah header
  // beneran muncul — akibatnya tinggi header nyangkut di 0 dan header jadi
  // menutupi seluruh konten dari atas. Callback ref memicu ulang effect
  // pengukuran persis saat elemen header benar-benar mount ke DOM, jadi bug
  // ini tidak bisa terjadi lagi.
  const [headerEl, setHeaderEl] = useState(null);
  const headerRef = useCallback((node) => setHeaderEl(node), []);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [spacerReady, setSpacerReady] = useState(false);
  useLayoutEffect(() => {
    const el = headerEl;
    if (!el) return;
    const measure = () => setHeaderHeight(Math.ceil(el.getBoundingClientRect().height) + 4);
    measure();
    const raf1 = requestAnimationFrame(() => { measure(); requestAnimationFrame(measure); });
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 500);
    const t3 = setTimeout(() => { measure(); setSpacerReady(true); }, 700);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(()=>{});
    window.addEventListener("load", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
      cancelAnimationFrame(raf1);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    };
  }, [headerEl]);
  // Header dibuat PERMANEN diam di atas (freeze), persis seperti header di
  // halaman chat ini — tidak lagi sembunyi/muncul otomatis saat di-scroll
  // (pendekatan itu dilepas karena walau sudah dikasih hysteresis + debounce,
  // tetap terasa jitter/kedip saat digeser bolak-balik pelan, mis. lagi cari
  // data). Konten di bawahnya tetap dijamin tidak ketutupan lewat spacer
  // yang tingginya diukur otomatis dari header asli (lihat penjelasan di
  // atas headerRef/headerHeight).
  const { user, loading, fbReady, loginGoogle, logout } = useAuth();
  const { db, addRecord: rawAddRecord, updateRecord: rawUpdateRecord, deleteRecord: rawDeleteRecord, resetDB: rawResetDB, save: rawSave, syncing, lastSync, syncError, pendingSync, cloudLoaded, backupNow, listBackups, restoreBackup, deletedUsersRef, listDeletedUsers, restoreDeletedUser, loadedKontrolYears, availableKontrolYears, loadKontrolYear, runKontrolYearMigration, archivedKontrolYears, archiveKontrolYear, viewArchivedKontrolYear, exportArchivedKontrolYear, deleteArchivedKontrolYear } = useDB(user);
  const analytics = useAnalytics(db);

  // ── Bedakan "LOGIN ULANG" (baru masuk) vs "REFRESH" (reload halaman saat
  // sesi masih berjalan):
  // - Refresh (tombol refresh header ATAU refresh bawaan browser) memuat
  //   ulang seluruh halaman via window.location.reload(), lalu Firebase Auth
  //   otomatis memulihkan sesi yang sama. Dalam kasus ini status "loading"
  //   akan langsung berubah ke user yang SAMA tanpa pernah melewati kondisi
  //   "belum login" (halaman Login tidak pernah benar-benar tampil) →
  //   activeTab TETAP dipertahankan (diambil dari sessionStorage, lihat
  //   getInitialActiveTab di atas).
  // - Login ulang sesungguhnya (mis. baru buka aplikasi tanpa sesi tersimpan,
  //   atau logout lalu login lagi) akan benar-benar menampilkan halaman
  //   Login (user === null && loading === false) sebelum akhirnya login
  //   berhasil → transisi INI yang memicu reset otomatis ke tab Dashboard.
  const pernahDiHalamanLoginRef = useRef(false);
  useEffect(() => {
    if (loading) return; // status auth belum pasti, jangan simpulkan apa-apa dulu
    if (!user) {
      pernahDiHalamanLoginRef.current = true;
    } else if (pernahDiHalamanLoginRef.current) {
      pernahDiHalamanLoginRef.current = false;
      setActiveTab("dashboard");
      try { sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, "dashboard"); } catch {}
    }
  }, [user, loading]);

  // ── Mobile-friendly: pastikan viewport meta tag benar agar tampilan tidak
  // ter-zoom-out/kepotong saat dibuka dari HP (banyak host page lupa setting ini).
  useEffect(() => {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    vp.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
  }, []);

  // ── Mobile-friendly: pasang sekali class CSS responsif global, dipakai
  // oleh header, tab nav, dan grid form 2-kolom di seluruh aplikasi supaya
  // otomatis menumpuk jadi 1 kolom di layar HP (≤640px) tanpa perlu
  // menulis ulang setiap form satu per satu.
  useEffect(() => {
    if (document.getElementById("gw-responsive-style")) return;
    const style = document.createElement("style");
    style.id = "gw-responsive-style";
    style.textContent = `
      * { box-sizing: border-box; }
      /* Cegah scroll horizontal "hantu" di HP — kalau ada elemen (mis. panel
         dropdown) yang secara tak sengaja melebar keluar viewport, ini
         memastikan halaman tetap tidak bisa digeser ke samping sehingga
         kontennya tidak pernah terpotong/hilang di sisi kiri layar. */
      html, body { max-width: 100vw; overflow-x: hidden; }

      /* Header dibuat "cair" (fluid) memakai clamp() supaya ukurannya
         menyesuaikan lebar layar secara halus/dinamis, bukan cuma loncat
         di titik-titik breakpoint tetap. */
      .gw-header-top { flex-wrap: wrap; row-gap: 10px; column-gap: 10px; }
      .gw-header-actions { flex-wrap: wrap; justify-content: flex-end; align-items: center; row-gap: 6px; column-gap: 6px; }
      .gw-header-logo { width: clamp(32px, 9vw, 46px) !important; height: clamp(32px, 9vw, 46px) !important; }
      .gw-header-title { font-size: clamp(15px, 4vw, 20px) !important; }
      .gw-header-revenue { padding: clamp(4px, 1.2vw, 6px) clamp(8px, 2.5vw, 14px) !important; font-size: clamp(10.5px, 2.6vw, 12px) !important; }
      .gw-header-activeusers button { padding: clamp(4px, 1.2vw, 6px) clamp(8px, 2.5vw, 12px) !important; font-size: clamp(10.5px, 2.6vw, 12px) !important; }

      @media (max-width: 640px) {
        .gw-header-top { padding-top: 10px !important; padding-bottom: 10px !important; }
        .gw-header-subtitle { display: none; }
        .gw-grid2, .gw-grid3 { grid-template-columns: 1fr !important; }
        .gw-dash-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
        .gw-statcard { padding: 12px !important; }
        .gw-statcard-value { font-size: 19px !important; }
        .gw-statcard-label { font-size: 9.5px !important; }
        .gw-modal-body { padding: 16px !important; }
        .gw-modal-header { padding: 14px 16px !important; }
        .gw-content { padding: 14px 10px !important; }
        table { font-size: 11px !important; }
      }
      @media (max-width: 400px) {
        .gw-hide-xs { display: none !important; }
        .gw-dash-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 6px !important; }
        .gw-statcard { padding: 10px !important; }
        .gw-statcard-value { font-size: 17px !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);


  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = GWG_LOGO_B64;
    link.type = "image/png";
  }, []);

  // Buka modal backup & langsung muat daftar backup cloud (kalau ada)
  const openBackupModal = useCallback(async () => {
    setShowBackup(true);
    setBackupLoading(true);
    try { setBackupList(await listBackups()); } catch { setBackupList([]); }
    setBackupLoading(false);
  }, [listBackups]);

  // ── PULIHKAN DARI FILE BACKUP (.json) ────────────────────────────────────
  // Menangani 2 sumber file yang sebelumnya TIDAK BISA dipulihkan langsung
  // dari dalam aplikasi: (1) file .json yang diunduh ke perangkat lewat
  // tombol "Unduh Backup Sekarang" / "Backup Cepat", dan (2) file yang
  // sebelumnya diunggah ke Google Drive lalu diunduh ulang oleh user (karena
  // Drive API tidak menyediakan restore langsung tanpa Google Picker). Kedua
  // sumber ini formatnya sama-sama file JSON, jadi cukup satu tombol upload
  // file untuk menangani keduanya — tidak perlu integrasi Drive Picker terpisah.
  function handleRestoreFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreFileError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Terima 2 bentuk file: snapshot lengkap { ts, reason, data:{...} }
        // (hasil "Unduh Backup Sekarang"/"Backup Cepat"/"Simpan Snapshot ke Cloud"),
        // ATAU objek database mentah langsung { wilayah:[...], toko:[...], ... }.
        const looksLikeSnapshot = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object";
        const looksLikeRawDb = parsed && typeof parsed === "object" &&
          ["wilayah","rute","toko","produk","kontrol","pengguna"].some(k => Array.isArray(parsed[k]));
        if (!looksLikeSnapshot && !looksLikeRawDb) {
          setRestoreFileError("⚠️ File tidak dikenali sebagai backup GWG SuperApp yang valid (format JSON tidak sesuai).");
          return;
        }
        const snapshot = looksLikeSnapshot
          ? { key: file.name, ts: parsed.ts, reason: parsed.reason || "file-upload", data: parsed.data }
          : { key: file.name, ts: null, reason: "file-upload", data: parsed };
        // Reuse alur konfirmasi yang sama dengan restore dari Riwayat Backup Cloud
        setRestoreTarget(snapshot);
        setRestoreConfirmText("");
      } catch (err) {
        setRestoreFileError("⚠️ Gagal membaca file: " + err.message + ". Pastikan file adalah backup .json yang valid dan tidak rusak.");
      }
    };
    reader.onerror = () => setRestoreFileError("⚠️ Gagal membaca file dari perangkat.");
    reader.readAsText(file);
  }

  // ── GOOGLE DRIVE UPLOAD ─────────────────────────────────────────────────
  // Menggunakan Google Drive REST API v3 (multipart upload) dengan OAuth2
  // access token yang diperoleh dari Firebase Auth (provider Google).
  // Tidak memerlukan gapi.js / Google Identity Services terpisah —
  // token Firebase sudah cukup untuk Drive API selama scope drive.file
  // dikonfigurasi di Firebase Console → Authentication → Google provider.
  //
  // ⚠ SYARAT: Di Google Cloud Console, aktifkan "Google Drive API" untuk
  //   project Firebase Anda, dan tambahkan scope
  //   "https://www.googleapis.com/auth/drive.file" ke OAuth consent screen.
  //   Tanpa langkah ini, upload akan gagal dengan error 403/insufficientScope.
  // ────────────────────────────────────────────────────────────────────────
  const [gDriveLoading, setGDriveLoading] = useState(false);
  const [gDriveMsg, setGDriveMsg] = useState(null); // { ok: bool, text: string }

  const uploadToGDrive = useCallback(async () => {
    if (!user) { alert("Login dengan Google terlebih dahulu."); return; }
    setGDriveLoading(true);
    setGDriveMsg(null);
    try {
      const ts = new Date().toISOString();
      const filename = `gwg_backup_${ts.slice(0,19).replace(/[:T]/g,"-")}.json`;
      const fileData = await gdriveUploadJSON(
        filename,
        { ts, reason: "gdrive-manual", data: db },
        `GWG SuperApp backup - ${ts}`
      );
      const viewLink = fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`;
      setGDriveMsg({
        ok: true,
        text: `✅ Berhasil diunggah ke Google Drive! File: "${fileData.name}"`,
        link: viewLink,
      });
    } catch (e) {
      console.error("GDrive upload error:", e);
      setGDriveMsg({ ok: false, text: `❌ Gagal upload ke Google Drive: ${e.message}` });
    } finally {
      setGDriveLoading(false);
    }
  }, [user, db]);

  // Cari role user yang login berdasarkan email di tabel pengguna
  const currentUserRecord = user ? db.pengguna.find(p => p.email?.toLowerCase() === user.email?.toLowerCase()) : null;

  // Daftar pengguna yang sedang aktif (real-time, per sesi/perangkat).
  const activeUsers = usePresence(user, currentUserRecord);

  // Daftar pengguna aktif yang SUDAH DIFILTER & DIKELOMPOKKAN untuk ditampilkan:
  // 1) FILTER: sembunyikan sesi milik email yang TIDAK/TIDAK LAGI ada di tabel
  //    pengguna (misalnya sudah dihapus/diblokir Admin). Login Firebase Auth
  //    di perangkat orang itu tidak otomatis putus saat baris pengguna-nya
  //    dihapus, jadi tanpa filter ini dia tetap terlihat "aktif" selama tab
  //    browser-nya masih terbuka.
  // 2) KELOMPOKKAN: satu email yang membuka beberapa sesi/tab/perangkat
  //    digabung jadi SATU baris (dengan jumlah sesi), supaya tidak terlihat
  //    seperti "pengguna dobel" di panel — sebelumnya tiap sesi ditampilkan
  //    sebagai baris terpisah walau namanya sama persis.
  const visibleActiveUsers = useMemo(() => {
    const registeredEmails = new Set((db.pengguna||[]).map(p => p.email?.toLowerCase()).filter(Boolean));
    const grouped = new Map();
    (activeUsers||[]).forEach(au => {
      const emailKey = au.email?.toLowerCase();
      if (!emailKey || !registeredEmails.has(emailKey)) return; // pengguna sudah diblokir/dihapus, sembunyikan
      const existing = grouped.get(emailKey);
      if (existing) existing.sessionCount += 1;
      else grouped.set(emailKey, { ...au, sessionCount: 1 });
    });
    return Array.from(grouped.values());
  }, [activeUsers, db.pengguna]);

  // BOOTSTRAP ADMIN & AUTO-DAFTAR PENGGUNA BARU:
  // 1) Jika tabel pengguna masih kosong, orang yang login sekarang PERMANEN
  //    didaftarkan sebagai Admin (bukan cuma status sementara di memori).
  //    Tanpa auto-simpan ini, status Admin hanya berlaku selama tabel kosong —
  //    begitu ada baris lain (atau baris ini terhapus), tidak ada lagi cara
  //    membuat Admin baru karena semua orang jatuh ke default "Sales" dan
  //    terkunci dari tab Pengguna untuk memperbaikinya.
  // 2) Jika tabel SUDAH berisi data tapi email akun yang login belum ada di
  //    tabel pengguna sama sekali (kasus: orang lain login dari perangkat
  //    baru/akun Google baru), akun itu otomatis didaftarkan dengan role
  //    "Viewer" (role paling rendah/aman secara default — hanya bisa melihat,
  //    tidak bisa mengubah data apa pun). Dengan ini, Admin
  //    tinggal membuka tab Pengguna dan mengubah role-nya lewat tabel — tidak
  //    perlu lagi mengetik manual nama & email orang tersebut.
  const bootstrapDone = useRef(false);
  const bootstrapJadiAdmin = useRef(false); // true hanya jika bootstrap ini untuk Admin pertama (tabel kosong)
  const autoDaftarSet = useRef(new Set()); // cegah auto-daftar dobel untuk email yang sama selagi addRecord belum sinkron
  useEffect(() => {
    if (!user || !cloudLoaded) return;
    // PENTING: jangan jalankan pengecekan ini sebelum data dari Firebase (cloud)
    // benar-benar selesai diterima minimal sekali. Tanpa penundaan ini, dua
    // perangkat yang login hampir bersamaan bisa SAMA-SAMA melihat db.pengguna
    // masih kosong (karena keduanya masih memakai data lokal/awal sebelum
    // snapshot cloud turun) dan masing-masing menambahkan dirinya sendiri
    // sebagai Admin baru → muncul 2 baris Admin di satu perangkat dan baris
    // yang berbeda di perangkat lain, padahal harusnya satu data yang sama.
    if (currentUserRecord) return; // sudah terdaftar, tidak perlu apa-apa

    const tabelMasihKosong = (db.pengguna||[]).length === 0;
    const emailKey = user.email?.toLowerCase();
    if (!emailKey || autoDaftarSet.current.has(emailKey)) return;

    // CEK BLACKLIST: jika email ini sudah pernah dihapus oleh Admin,
    // JANGAN daftarkan ulang secara otomatis. Pengguna harus didaftarkan
    // manual oleh Admin. Cek dari Firebase (realtime) dan localStorage (offline).
    const encodedKey = encodeEmailKey(emailKey);
    const isDeletedInFirebase = !!(deletedUsersRef.current[encodedKey]);
    const isDeletedInLocal = (() => {
      try {
        const localDeleted = JSON.parse(localStorage.getItem("gwg_deletedUsers") || "{}");
        return !!(localDeleted[encodedKey]);
      } catch { return false; }
    })();
    if (isDeletedInFirebase || isDeletedInLocal) return; // akun ini sudah dihapus admin, skip auto-register

    if (tabelMasihKosong && !bootstrapDone.current) {
      bootstrapDone.current = true; // cegah panggilan ganda selama addRecord belum sinkron
      bootstrapJadiAdmin.current = true;
      autoDaftarSet.current.add(emailKey);
      // PENTING: ID dibuat DETERMINISTIK dari email (bukan genUniqueId acak).
      // Kalau dua perangkat sama-sama race di sini, keduanya akan menghasilkan
      // ID yang SAMA PERSIS dan menulis ke path Firebase yang sama pula →
      // tulisan kedua hanya menimpa (overwrite) tulisan pertama, TIDAK membuat
      // baris baru. Ini yang mencegah "akun muncul 2x di tabel pengguna".
      rawAddRecord("pengguna", {
        id: "U_" + encodeEmailKey(emailKey),
        nama: user.displayName || user.email,
        email: user.email,
        role: "Admin",
        wilayahId: "",
      });
    } else if (!tabelMasihKosong) {
      // Akun baru yang belum pernah login sebelumnya → daftarkan otomatis
      // sebagai Viewer (role paling rendah, hanya bisa melihat — TIDAK bisa
      // mengubah data apa pun) supaya aman secara default. Admin yang harus
      // menaikkan role-nya secara manual lewat tab Pengguna jika perlu.
      // Kecuali jika emailnya cocok dengan SUPER_ADMIN_EMAIL → langsung Admin.
      autoDaftarSet.current.add(emailKey);
      // Sama seperti bootstrap Admin di atas: ID deterministik dari email
      // supaya race antar-perangkat menimpa path yang sama, bukan bikin
      // baris duplikat.
      rawAddRecord("pengguna", {
        id: "U_" + encodeEmailKey(emailKey),
        nama: user.displayName || user.email,
        email: user.email,
        role: isSuperAdminEmail(user.email) ? "Admin" : "Viewer",
        wilayahId: "",
      });
    }
  }, [user, db.pengguna, currentUserRecord, rawAddRecord, cloudLoaded]);

  // Selama proses penyimpanan baris Admin pertama di atas belum selesai (delay
  // sinkron Firebase/localStorage), tetap anggap pengguna ini Admin agar tidak
  // ada momen "jatuh ke Sales" sesaat sebelum baris tersimpan. Khusus untuk
  // skenario tabel kosong (Admin pertama) — BUKAN untuk akun yang auto-terdaftar
  // sebagai Viewer, supaya akun baru itu tidak salah dapat akses Admin sementara.
  const isBootstrapAdmin = (db.pengguna||[]).length === 0 || (bootstrapJadiAdmin.current && !currentUserRecord);

  // JALUR DARURAT ANTI-DEADLOCK: jika tabel pengguna SUDAH berisi data, tapi
  // TIDAK ADA satupun baris dengan role "Admin" (misalnya baris Admin pertama
  // sempat terhapus/hilang), sistem akan terkunci selamanya karena tab Pengguna
  // cuma bisa dibuka Admin — tidak ada Admin berarti tidak ada yang bisa
  // memperbaikinya lagi. Untuk mencegah hal ini, siapapun yang login saat
  // kondisi ini terjadi otomatis diberi akses Admin sementara, supaya dia bisa
  // membuka tab Pengguna dan menetapkan ulang Admin yang benar.
  const tidakAdaAdminSamaSekali = (db.pengguna||[]).length > 0 && !(db.pengguna||[]).some(p => p.role === "Admin");
  const isEmergencyAdmin = tidakAdaAdminSamaSekali;

  // PENTING: jika sistem sedang dalam kondisi darurat (bootstrap atau tidak ada
  // Admin sama sekali), status Admin sementara ini HARUS menang meskipun baris
  // pengguna ini sudah tercatat sebagai "Sales" di tabel — karena itulah skenario
  // deadlock yang sebenarnya terjadi (akun pertama sempat tercatat/jatuh jadi
  // Sales, sehingga currentUserRecord?.role akan selalu "Sales" dan tidak pernah
  // memberi kesempatan perbaikan). Role Admin/Manajer yang SUDAH tercatat tetap
  // dihormati dan tidak pernah diturunkan oleh logika ini.
  const daruratAktif = isBootstrapAdmin || isEmergencyAdmin;
  const userRole = isSuperAdminEmail(user?.email)
    ? "Admin" // SUPER ADMIN: selalu Admin, tidak peduli apa yang tercatat di tabel
    : (daruratAktif && currentUserRecord?.role !== "Admin" && currentUserRecord?.role !== "Manajer")
    ? "Admin"
    : (currentUserRecord?.role || "Viewer"); // default Viewer (paling aman) jika tidak ditemukan & tidak darurat
  const isAdmin = userRole === "Admin";
  const isManajer = userRole === "Manajer" || isAdmin;
  const isViewer = userRole === "Viewer"; // Viewer: hanya bisa melihat, tidak bisa mengubah data apa pun
  const isUserSuperAdmin = isSuperAdminEmail(user?.email);

  // GUARD VIEWER: bungkus semua fungsi penulis data supaya Viewer benar-benar
  // tidak bisa mengubah database apa pun — dicek terpusat di sini, bukan
  // cuma disembunyikan di UI, supaya tidak bisa "ditembus" lewat tab manapun.
  const tolakViewer = () => { alert("Anda login sebagai Viewer (hanya bisa melihat). Hubungi Admin untuk menaikkan akses Anda jika perlu mengubah data."); };
  const addRecord    = (...args) => { if (isViewer) return tolakViewer(); return rawAddRecord(...args); };
  const updateRecord = (...args) => { if (isViewer) return tolakViewer(); return rawUpdateRecord(...args); };
  const deleteRecord = (...args) => { if (isViewer) return tolakViewer(); return rawDeleteRecord(...args); };
  const save         = (...args) => { if (isViewer) return tolakViewer(); return rawSave(...args); };
  const resetDB       = (...args) => { if (isViewer) return tolakViewer(); return rawResetDB(...args); };

  // Jaga-jaga: jika tab yang aktif sekarang tidak boleh diakses oleh role
  // pengguna saat ini (misal role baru saja diturunkan oleh Admin, atau
  // pengguna Sales mencoba membuka URL/state tab terlarang), alihkan ke Dashboard.
  useEffect(() => {
    if (!canAccessTab(activeTab, { isAdmin, isManajer })) {
      setActiveTab("dashboard");
    }
  }, [activeTab, isAdmin, isManajer]);

  // Auto-upgrade toko "Baru" → "Aktif" setelah 30 hari sejak tanggalMasuk
  // Dijalankan sekali saat data cloud sudah selesai dimuat.
  const autoUpgradeDone = useRef(false);
  useEffect(() => {
    if (!cloudLoaded || autoUpgradeDone.current) return;
    autoUpgradeDone.current = true;
    autoUpgradeBaruToAktif(db, updateRecord);
  }, [cloudLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoginGoogle = async () => {
    setLoginError("");
    try {
      await loginGoogle();
    } catch(e) {
      setLoginError(e.message || "Login gagal");
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
        <img src={GWG_LOGO_B64} alt="GWG" style={{ width:64, height:64, borderRadius:"50%", objectFit:"contain", background:"#fff", padding:6, boxShadow:"0 4px 16px rgba(0,0,0,.1)" }} />
        <div style={{ fontSize:16, color:T.gray600, fontWeight:600 }}>Memuat Generasi Wangi Group...</div>
      </div>
    );
  }

  // Tampilkan halaman login jika user belum login
  // (baik Firebase sudah dikonfigurasi maupun belum)
  if (!user) {
    return <LoginPage onLoginGoogle={handleLoginGoogle} fbReady={fbReady} error={loginError} />;
  }

  // Semua tab navigasi + tombol Keluar + menu khusus Admin digabung jadi
  // SATU menu hamburger (☰), supaya header lebih ringkas di layar kecil.
  const mainMenuItems = [
    ...TABS.filter(t => canAccessTab(t.key, { isAdmin, isManajer })).map(t => ({
      label: t.label,
      active: activeTab === t.key,
      onClick: () => setActiveTab(t.key),
    })),
    { divider: true },
    { label: "🚪 Keluar", danger: true, onClick: logout },
    ...(isAdmin ? [
      { divider: true },
      {
        label: "💾⚡ Backup Cepat (unduh sekarang)",
        onClick: async () => {
          const result = await backupNow(db, { reason: "manual-cepat" });
          if (result?.snapshot) {
            downloadJSON(`gwg_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, result.snapshot);
          }
        },
      },
      { label: "💾 Backup & Restore", onClick: openBackupModal },
      {
        label: "⚠️ Reset Database",
        danger: true,
        onClick: () => { setShowReset(true); setResetStep(1); setResetAlasan(""); setResetConfirmText(""); },
      },
    ] : []),
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Inter',system-ui,sans-serif" }}>
      {/* HEADER — dibuat "fixed" (freeze) terhadap viewport, selalu diam di
          atas layar persis seperti header halaman chat ini. Pakai
          position:fixed (bukan sticky) supaya tetap diam walau app ini
          di-embed di dalam container dengan scroll sendiri. */}
      <div ref={headerRef} style={{ position:"fixed", top:0, left:0, right:0, zIndex:100,
          background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 100%)`, boxShadow:"0 2px 12px rgba(0,0,0,.15)" }}>
        <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 20px" }}>
          <div className="gw-header-top" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:16, paddingBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <img src={GWG_LOGO_B64} alt="GWG Logo" className="gw-header-logo"
                style={{ width:46, height:46, borderRadius:"50%", background:"#fff",
                  padding:3, boxShadow:"0 2px 8px rgba(0,0,0,.2)", objectFit:"contain" }} />
              <div>
                <div className="gw-header-title" style={{ fontSize:20, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>Generasi Wangi Group</div>
                <div className="gw-header-subtitle" style={{ fontSize:11, color:"rgba(255,255,255,.7)", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                  Super App · Sistem Manajemen Konsinyasi
                  {!isOnline ? (
                    <span style={{ marginLeft:8, background:"rgba(252,211,77,.25)", color:"#FCD34D", borderRadius:99, padding:"1px 8px", fontSize:10, fontWeight:700 }}>
                      📴 Offline{pendingSync > 0 ? ` · ${pendingSync} tersimpan` : ""}
                    </span>
                  ) : pendingSync > 0 ? (
                    <span style={{ marginLeft:8, background:"rgba(252,211,77,.25)", color:"#FCD34D", borderRadius:99, padding:"1px 8px", fontSize:10, fontWeight:700 }}>🔄 Mengirim {pendingSync} perubahan...</span>
                  ) : syncing && (
                    <span style={{ marginLeft:8, background:"rgba(255,255,255,.2)", borderRadius:99, padding:"1px 8px", fontSize:10 }}>🔄 Sinkronisasi...</span>
                  )}
                </div>
              </div>
            </div>
            <div className="gw-header-actions" style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div className="gw-header-revenue" style={{ background:"rgba(255,255,255,.12)", borderRadius:10, padding:"6px 14px", fontSize:12, color:"rgba(255,255,255,.9)", fontWeight:600, whiteSpace:"nowrap" }}>
                💰 <span className="gw-hide-xs">Rev: </span>{fmtRp(
                  (!isManajer && currentUserRecord?.wilayahId)
                    ? analytics.perWilayah.filter(w=>w.id===currentUserRecord.wilayahId).reduce((s,w)=>s+w.rev,0)
                    : analytics.totalRev
                )}
              </div>

              {/* Tombol refresh manual — pengganti "tarik ke bawah untuk
                  refresh" ala browser, yang tidak berfungsi di WebView
                  native (APK). Reload penuh halaman supaya semua listener
                  Firebase tersambung ulang dari awal, berguna terutama
                  setelah sinyal sempat putus-nyambung. */}
              <button
                onClick={() => window.location.reload()}
                title="Muat ulang / sinkronkan data"
                style={{ background:"rgba(255,255,255,.12)", border:"none", borderRadius:10,
                  width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                  color:"#fff", cursor:"pointer", fontSize:16, flexShrink:0 }}
              >🔄</button>

              {/* Panel "Pengguna Aktif" — daftar sesi/perangkat yang sedang online real-time.
                  Posisi panel dihitung dinamis via useClampedMenuPosition (position:fixed +
                  auto-clamp ke lebar viewport), jadi selalu utuh terlihat di HP dan tidak
                  pernah lagi terpotong di sisi kiri layar seperti sebelumnya. */}
              {user && (
                <div ref={activeUsersRef} className="gw-header-activeusers" style={{ position:"relative" }}>
                  <button onClick={() => setShowActiveUsers(v => !v)}
                    title="Pengguna sedang aktif"
                    style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,.12)", border:"none", borderRadius:10, padding:"6px 12px", fontSize:12, color:"#fff", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:"#22C55E", display:"inline-block", boxShadow:"0 0 0 2px rgba(255,255,255,.4)" }} />
                    🟢 {visibleActiveUsers.length}<span className="gw-hide-xs"> Aktif</span>
                  </button>
                  {showActiveUsers && activeUsersMenuStyle && (
                    <div style={{ ...activeUsersMenuStyle, background:"#fff", borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.2)", maxHeight:"60vh", overflowY:"auto", zIndex:250, padding:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:T.gray600, padding:"4px 8px", textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        Pengguna Sedang Aktif ({visibleActiveUsers.length})
                      </div>
                      {visibleActiveUsers.length === 0 ? (
                        <div style={{ fontSize:12, color:T.gray400, padding:"8px" }}>Tidak ada sesi aktif.</div>
                      ) : visibleActiveUsers.map(au => (
                        <div key={au.email} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:8, background: au.email===user.email ? T.greenLt : "transparent" }}>
                          <span style={{ width:7, height:7, borderRadius:"50%", background:"#22C55E", flexShrink:0 }} />
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:T.gray800, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {au.nama || au.email} {au.email===user.email && "(Anda)"}
                              {au.sessionCount > 1 && <span style={{ color:T.gray400, fontWeight:400 }}> · {au.sessionCount} sesi</span>}
                            </div>
                            <div style={{ fontSize:10, color:T.gray400 }}>{au.role}{isSuperAdminEmail(au.email) ? " · 👑 Super Admin" : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* User section */}
              {fbReady ? (
                user ? (
                  <div className="gw-header-userinfo" style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                    {user.photoURL && (
                      <img src={user.photoURL} alt="" style={{ width:30, height:30, borderRadius:"50%", border:"2px solid rgba(255,255,255,.4)", flexShrink:0 }} />
                    )}
                    <div style={{ fontSize:12, color:"rgba(255,255,255,.9)", fontWeight:600, minWidth:0 }}>
                      <div style={{ maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.displayName?.split(" ")[0]}</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,.6)", fontWeight:400, whiteSpace:"nowrap" }}>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,.6)", fontWeight:400, whiteSpace:"nowrap" }}>
                      {!isOnline ? (
                        <span style={{ color:"#FCD34D" }} title="Tidak ada koneksi internet — perubahan tersimpan di perangkat ini dan akan sinkron otomatis begitu online kembali">
                          📴<span className="gw-hide-xs"> Offline{pendingSync > 0 ? ` · ${pendingSync} menunggu` : " · data lokal"}</span>
                        </span>
                      ) : pendingSync > 0 ? (
                        <span style={{ color:"#FCD34D" }} title="Sedang mengirim perubahan yang tersimpan saat offline">🔄<span className="gw-hide-xs"> Mengirim {pendingSync} perubahan...</span></span>
                      ) : syncError ? (
                        <span style={{ color:"#FCA5A5" }} title={syncError}>⚠️<span className="gw-hide-xs"> Gagal sync</span></span>
                      ) : syncing ? (
                        <span title="Sedang memuat data dari cloud — di jaringan lambat ini bisa makan waktu">🔄<span className="gw-hide-xs"> Sinkronisasi...</span></span>
                      ) : lastSync ? (
                        <span>☁️<span className="gw-hide-xs"> Sinkron {lastSync.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}</span></span>
                      ) : (
                        <span>☁️<span className="gw-hide-xs"> Terhubung</span></span>
                      )}
                      {" ·"}{" "}
                      </span>
                      <span style={{ background: daruratAktif ? "#DC2626" : "rgba(255,255,255,.2)", borderRadius:4, padding:"0 5px", fontWeight:700 }}>
                        {userRole}{daruratAktif && " ⚠️"}
                      </span>
                    </div>
                  </div>
                  </div>
                ) : (
                  <Btn variant="secondary" size="sm" onClick={() => loginGoogle().catch(e => alert("Login gagal: "+e.message))}
                    style={{ background:"rgba(255,255,255,.15)", color:"#fff", border:"1px solid rgba(255,255,255,.3)" }}>
                    <span style={{ fontSize:14 }}>G</span> Login Google
                  </Btn>
                )
              ) : (
                <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", padding:"6px 10px", background:"rgba(255,255,255,.08)", borderRadius:8 }}>
                  💾 Mode Lokal
                </div>
              )}

              <HeaderMenu
                icon="☰"
                title="Menu"
                items={mainMenuItems}
              />
            </div>
          </div>

          {/* Sync status banner jika Firebase belum dikonfigurasi */}
          {!FIREBASE_CONFIGURED && (
            <div style={{ background:"rgba(196,154,26,.25)", border:"1px solid rgba(196,154,26,.4)", borderRadius:8, padding:"8px 14px",
              marginBottom:12, fontSize:12, color:"#FBF3D9", display:"flex", alignItems:"center", gap:8 }}>
              ⚠️ <span><b>Mode Lokal:</b> Untuk sinkronisasi lintas perangkat, konfigurasikan Firebase di variabel <code>FIREBASE_CONFIG</code> pada file ini. Lihat instruksi di komentar atas.</span>
            </div>
          )}

          {/* ✅ Banner "masih memuat data awal dari cloud" — supaya di jaringan
              lambat, angka yang masih rendah/nol di Dashboard tidak disalah-
              artikan sebagai "data hilang". Tanpa ini, pengguna hanya melihat
              angka yang diam-diam terus bertambah tanpa penjelasan kenapa
              belum lengkap saat aplikasi baru dibuka. */}
          {user && firebaseDB && syncing && !cloudLoaded && (
            <div style={{ background:"rgba(59,130,246,.2)", border:"1px solid rgba(59,130,246,.4)", borderRadius:8, padding:"8px 14px",
              marginBottom:12, fontSize:12, color:"#DBEAFE", display:"flex", alignItems:"center", gap:8 }}>
              🔄 <span><b>Memuat data dari cloud...</b> Angka di bawah masih bisa bertambah sebentar lagi, terutama di jaringan lambat — bukan data yang hilang.</span>
            </div>
          )}

        </div>
      </div>

      {/* Spacer — mengganti "ruang" yang tadinya ditempati header sebelum
          header dijadikan position:fixed, supaya konten di bawah tidak
          ketutupan/ketumpuk. Tingginya diukur otomatis dari header asli
          (+ buffer kecil) dan tetap dijaga sinkron kalau tinggi header
          berubah (rotasi layar, resize, dll — lihat efek pengukuran di atas). */}
      <div style={{ height: headerHeight, transition: spacerReady ? "height 0.28s ease" : "none" }} />

      {/* CONTENT */}
      <div className="gw-content" style={{ maxWidth:1400, margin:"0 auto", padding:"24px 20px" }}>
        {/* ✅ FIX: sebelumnya setiap tab di-render kondisional penuh
            ({activeTab==="x" && <TabX/>}), jadi pindah tab = komponen lama
            di-UNMOUNT total (state lokalnya, termasuk semua filter, ikut
            hilang) dan komponen baru dipasang dari nol. Begitu balik lagi
            ke tab sebelumnya, filter kembali ke default. Sekarang semua tab
            yang boleh diakses tetap "hidup" (mounted) di background, cuma
            disembunyikan lewat CSS (display:none) saat tidak aktif — jadi
            filter, hasil pencarian, dan state lain tetap tersimpan persis
            seperti saat ditinggalkan. Pengecekan izin akses (canAccessTab)
            tetap dilakukan SEBELUM komponennya sempat dipasang sama sekali,
            jadi tab yang memang tidak boleh diakses tetap tidak pernah ikut
            di-render (bukan cuma disembunyikan). Ini melengkapi (bukan
            menggantikan) fix sessionStorage activeTab di atas — yang itu
            mengingat tab mana yang aktif lintas refresh, yang ini menjaga
            state DI DALAM tiap tab tetap utuh saat pindah-pindah tab. */}
        <div style={{ display: activeTab==="dashboard" ? "block" : "none" }}>
          <Dashboard db={db} analytics={analytics} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} />
        </div>
        {canAccessTab("wilayah",  { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="wilayah" ? "block" : "none" }}>
            <TabWilayah   db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />
          </div>
        )}
        {canAccessTab("rute",     { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="rute" ? "block" : "none" }}>
            <TabRute      db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />
          </div>
        )}
        {canAccessTab("toko",     { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="toko" ? "block" : "none" }}>
            <TabToko      db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} save={save} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} isSalesRestricted={!isManajer} />
          </div>
        )}
        {canAccessTab("produk",   { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="produk" ? "block" : "none" }}>
            <TabProduk    db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} />
          </div>
        )}
        {canAccessTab("kontrol",  { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="kontrol" ? "block" : "none" }}>
            <TabKontrol   db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} save={save} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""}
              isManajer={isManajer} loadedKontrolYears={loadedKontrolYears} availableKontrolYears={availableKontrolYears} />
          </div>
        )}
        {canAccessTab("rekap",    { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="rekap" ? "block" : "none" }}>
            <TabRekap     db={db} analytics={analytics} salesWilayahId={!isManajer ? currentUserRecord?.wilayahId||"" : ""} />
          </div>
        )}
        {canAccessTab("bagihasil",{ isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="bagihasil" ? "block" : "none" }}>
            <TabBagiHasil db={db} analytics={analytics} save={save} />
          </div>
        )}
        {canAccessTab("pengguna", { isAdmin, isManajer }) && (
          <div style={{ display: activeTab==="pengguna" ? "block" : "none" }}>
            <TabPengguna  db={db} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} isEmergencyAdmin={isEmergencyAdmin} listDeletedUsers={listDeletedUsers} restoreDeletedUser={restoreDeletedUser} activeUsers={visibleActiveUsers} />
          </div>
        )}
      </div>

      {/* BACKUP & RESTORE — hanya Admin (tombol disembunyikan untuk role lain) */}
      {showBackup && isAdmin && (
        <Modal title="💾 Backup & Restore Data" onClose={()=>{ setShowBackup(false); setRestoreTarget(null); setRestoreConfirmText(""); setRestoreFileError(""); setBackupCloudMsg(null); }}>
          <div style={{ padding:"4px 0 8px" }}>
            <div style={{ fontSize:13, color:T.gray400, marginBottom:16 }}>
              Sistem otomatis membuat backup 1x/hari ke cloud. Anda juga bisa membuat backup manual kapan saja, atau mengunduh salinan ke perangkat.
            </div>

            <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
              <Btn onClick={() => downloadJSON(`gwg_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, { ts:new Date().toISOString(), reason:"manual-download", data:db })}>
                ⬇️ Unduh Backup Sekarang (.json)
              </Btn>
              <Btn variant="secondary" disabled={backupLoading} onClick={async () => {
                setBackupLoading(true);
                setBackupCloudMsg(null);
                const result = await backupNow(db, { reason: "manual" });
                setBackupCloudMsg(result.cloudOk
                  ? { ok: true, message: "✅ Snapshot berhasil disimpan ke Firebase." }
                  : { ok: false, message: `⚠️ Gagal menyimpan ke cloud: ${result.cloudError || "tidak diketahui"}. Salinan lokal tetap tersimpan di perangkat ini.` });
                setBackupList(await listBackups());
                setBackupLoading(false);
              }}>
                {backupLoading ? "⏳ Menyimpan..." : "☁️ Simpan Snapshot ke Cloud (Firebase)"}
              </Btn>
              {/* ── GOOGLE DRIVE UPLOAD ── */}
              <Btn
                variant="secondary"
                disabled={gDriveLoading}
                onClick={() => { setGDriveMsg(null); uploadToGDrive(); }}
                style={{ background:"#fff", color:"#444", border:"1px solid #ddd",
                  display:"flex", alignItems:"center", gap:6, fontWeight:600,
                  opacity: gDriveLoading ? 0.7 : 1 }}
                title={user ? "Upload backup JSON ke Google Drive Anda" : "Login Google diperlukan untuk upload ke Drive"}
              >
                {/* Google Drive logo (triangle triskelion) */}
                <svg width="18" height="16" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H.1c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                  <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.3 48.05c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00AC47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8z" fill="#EA4335"/>
                  <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
                  <path d="M59.8 52.55H27.5L13.75 76.35c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684FC"/>
                  <path d="M73.4 26.05l-12.65-21.9c-.15-.3-.35-.55-.55-.85L44.45 25 59.8 52.55H87.3c0-1.6-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
                </svg>
                {gDriveLoading ? "Mengunggah…" : "Upload ke Google Drive"}
              </Btn>
            </div>

            {backupCloudMsg && (
              <div style={{ padding:"8px 12px", borderRadius:8, marginBottom:16, fontSize:12,
                background: backupCloudMsg.ok ? "#E6F4ED" : "#FEF2F2",
                color: backupCloudMsg.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${backupCloudMsg.ok ? "#6EE7B7" : "#FCA5A5"}` }}>
                {backupCloudMsg.message}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8, marginTop:8 }}>Pulihkan dari File Backup</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Punya file backup <code>.json</code> yang tersimpan di perangkat (dari "Unduh Backup Sekarang") atau
              yang sebelumnya diunggah ke Google Drive lalu diunduh ulang? Unggah file tersebut di sini untuk
              memulihkan data — tidak perlu menunggu masuk daftar Riwayat Backup Cloud di bawah.
            </div>
            <div style={{ display:"flex", gap:10, marginBottom:8, flexWrap:"wrap" }}>
              <Btn variant="secondary" onClick={() => restoreFileRef.current?.click()}>
                📂 Pilih File Backup (.json) untuk Dipulihkan
              </Btn>
            </div>
            <input ref={restoreFileRef} type="file" accept=".json,application/json" style={{ display:"none" }} onChange={handleRestoreFileChange} />
            {restoreFileError && (
              <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"8px 12px",
                marginBottom:16, fontSize:12, color:T.red }}>
                {restoreFileError}
              </div>
            )}

            {/* Status pesan Google Drive upload */}
            {gDriveMsg && (
              <div style={{
                padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:13,
                background: gDriveMsg.ok ? "#E6F4ED" : "#FEF2F2",
                color: gDriveMsg.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${gDriveMsg.ok ? "#6EE7B7" : "#FCA5A5"}`,
                display:"flex", alignItems:"flex-start", gap:10, flexWrap:"wrap"
              }}>
                <span style={{ flex:1 }}>{gDriveMsg.text}</span>
                {gDriveMsg.ok && gDriveMsg.link && (
                  <a href={gDriveMsg.link} target="_blank" rel="noopener noreferrer"
                    style={{ color:"#1D4ED8", fontWeight:600, whiteSpace:"nowrap" }}>
                    🔗 Buka di Drive
                  </a>
                )}
                {!gDriveMsg.ok && (
                  <div style={{ fontSize:11, opacity:.8, width:"100%", marginTop:4 }}>
                    Pastikan <b>Google Drive API</b> aktif di Google Cloud Console dan scope <code>drive.file</code> sudah ditambahkan ke OAuth consent screen project Firebase Anda.
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>📅 Data Penjualan (Kontrol) per Tahun</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Untuk hemat kuota Firebase gratis, hanya <b>{new Date().getFullYear()}</b> &amp; <b>{new Date().getFullYear()-1}</b> yang otomatis dimuat.
              Tahun lain dimuat manual di sini bila perlu dilihat di laporan/rekap.
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {availableKontrolYears.length === 0 && (
                <div style={{ fontSize:12, color:T.gray400 }}>Belum ada indeks tahun (normal jika data kontrol masih struktur lama / belum ada data sama sekali).</div>
              )}
              {availableKontrolYears.map(y => {
                const isLoaded = loadedKontrolYears.includes(y);
                return (
                  <Btn key={y} variant={isLoaded ? "secondary" : "primary"} disabled={isLoaded}
                    onClick={() => loadKontrolYear(y)}>
                    {isLoaded ? `✅ ${y} (dimuat)` : `⬇️ Muat tahun ${y}`}
                  </Btn>
                );
              })}
            </div>

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>🗄️ Arsipkan Tahun Lama ke Google Drive</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Pindahkan data kontrol satu tahun dari Realtime Database (kuota 1GB) ke Google Drive Anda (15GB
              gratis, tanpa perlu upgrade paket Firebase) sebagai satu file arsip. Data <b>tidak hilang</b> — tetap
              bisa dilihat &amp; diexport kapan saja lewat daftar arsip di bawah. Sebaiknya jangan arsipkan tahun
              berjalan/tahun kemarin yang masih sering dibuka. Aksi ini akan meminta izin akses Google Drive
              (popup login) jika belum pernah diberikan sebelumnya.
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
              {availableKontrolYears.filter(y => !archivedKontrolYears.includes(y)).length === 0 && (
                <div style={{ fontSize:12, color:T.gray400 }}>Tidak ada tahun yang bisa diarsipkan saat ini.</div>
              )}
              {availableKontrolYears.filter(y => !archivedKontrolYears.includes(y)).map(y => (
                <Btn key={`arch-${y}`} variant="secondary" size="sm" disabled={archivingYear === y}
                  onClick={async () => {
                    if (!confirm(`Arsipkan data kontrol tahun ${y}?\n\nData akan dipindah ke Google Drive Anda dan dihapus dari database aktif (tetap bisa dilihat/diexport lagi kapan saja dari daftar arsip). Anda mungkin diminta login/izin akses Google Drive.`)) return;
                    setArchivingYear(y);
                    setArchiveMsg(null);
                    const result = await archiveKontrolYear(y);
                    setArchiveMsg(result);
                    setArchivingYear(null);
                  }}>
                  {archivingYear === y ? `⏳ Mengarsipkan ${y}...` : `🗄️ Arsipkan ${y}`}
                </Btn>
              ))}
            </div>
            {archiveMsg && (
              <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:12,
                background: archiveMsg.ok ? "#DCFCE7" : "#FEE2E2", color: archiveMsg.ok ? "#166534" : "#991B1B" }}>
                {archiveMsg.ok ? "✅ " : "⚠️ "}{archiveMsg.message}
              </div>
            )}

            {archivedKontrolYears.length > 0 && (
              <>
                <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>📦 Data Kontrol yang Sudah Diarsipkan</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                  {archivedKontrolYears.map(y => (
                    <div key={`archrow-${y}`} style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
                      padding:"8px 10px", borderRadius:8, background:T.gray50, border:`1px solid ${T.gray200}` }}>
                      <span style={{ fontSize:13, fontWeight:600, flex:1 }}>📅 Tahun {y}</span>
                      <Btn variant="secondary" size="sm"
                        onClick={async () => {
                          setViewArchiveYear(y);
                          setViewArchiveData("loading");
                          const result = await viewArchivedKontrolYear(y);
                          setViewArchiveData(result.ok ? result : { ok:false, message: result.message, records: [] });
                        }}>👁️ Lihat</Btn>
                      <Btn variant="secondary" size="sm" disabled={exportingArchiveYear === y}
                        onClick={async () => {
                          setExportingArchiveYear(y);
                          const result = await viewArchivedKontrolYear(y);
                          if (result.ok) {
                            exportExcel(result.records, autoColumns(result.records), `Arsip Kontrol ${y}`, `arsip_kontrol_${y}`);
                          } else {
                            alert(result.message || "Gagal mengekspor arsip.");
                          }
                          setExportingArchiveYear(null);
                        }}>{exportingArchiveYear === y ? "⏳ Menyiapkan..." : "⬇️ Export Excel"}</Btn>
                      <Btn variant="danger" size="sm" onClick={() => { setDeleteArchiveConfirmYear(y); setDeleteArchiveConfirmText(""); }}>🗑️ Hapus</Btn>
                    </div>
                  ))}
                </div>
              </>
            )}

            {viewArchiveYear && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000,
                display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
                onClick={() => { setViewArchiveYear(null); setViewArchiveData(null); }}>
                <div style={{ background:"#fff", borderRadius:12, padding:20, maxWidth:640, maxHeight:"80vh",
                  overflow:"auto", width:"100%" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:15, fontWeight:700 }}>📦 Arsip Kontrol {viewArchiveYear}</div>
                    <button onClick={() => { setViewArchiveYear(null); setViewArchiveData(null); }}
                      style={{ border:"none", background:"none", fontSize:18, cursor:"pointer" }}>✕</button>
                  </div>
                  {viewArchiveData === "loading" && <div style={{ fontSize:13, color:T.gray400 }}>⏳ Memuat arsip dari Storage...</div>}
                  {viewArchiveData && viewArchiveData !== "loading" && !viewArchiveData.ok && (
                    <div style={{ fontSize:13, color:"#991B1B" }}>⚠️ {viewArchiveData.message}</div>
                  )}
                  {viewArchiveData && viewArchiveData !== "loading" && viewArchiveData.ok && (
                    <>
                      <div style={{ fontSize:12, color:T.gray400, marginBottom:10 }}>
                        {viewArchiveData.recordCount} data · diarsipkan {viewArchiveData.archivedAt ? new Date(viewArchiveData.archivedAt).toLocaleString("id-ID") : "-"}
                      </div>
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", fontSize:11, borderCollapse:"collapse" }}>
                          <thead><tr>
                            {autoColumns(viewArchiveData.records).slice(0,8).map(c => (
                              <th key={c.key} style={{ textAlign:"left", padding:"4px 6px", borderBottom:`2px solid ${T.gray200}`, whiteSpace:"nowrap" }}>{c.label}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {viewArchiveData.records.slice(0,100).map((r,i) => (
                              <tr key={i} style={{ borderBottom:`1px solid ${T.gray100}` }}>
                                {autoColumns(viewArchiveData.records).slice(0,8).map(c => (
                                  <td key={c.key} style={{ padding:"4px 6px", whiteSpace:"nowrap" }}>{String(r[c.key] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {viewArchiveData.records.length > 100 && (
                        <div style={{ fontSize:11, color:T.gray400, marginTop:8 }}>Menampilkan 100 dari {viewArchiveData.records.length} data. Gunakan "Export Excel" untuk melihat semuanya.</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {deleteArchiveConfirmYear && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000,
                display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
                <div style={{ background:"#fff", borderRadius:12, padding:20, maxWidth:420, width:"100%" }}>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:8, color:"#991B1B" }}>⚠️ Hapus Arsip Permanen</div>
                  <div style={{ fontSize:13, color:T.gray600, marginBottom:12, lineHeight:1.6 }}>
                    Ini akan menghapus arsip tahun <b>{deleteArchiveConfirmYear}</b> secara permanen dari Google Drive.
                    Data <b>TIDAK BISA</b> dikembalikan setelah ini. Pastikan sudah export/simpan sendiri kalau masih perlu.
                  </div>
                  <input type="text" value={deleteArchiveConfirmText} onChange={e => setDeleteArchiveConfirmText(e.target.value)}
                    placeholder="Ketik HAPUS untuk konfirmasi"
                    style={{ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${T.gray200}`, borderRadius:8, marginBottom:12, fontFamily:"inherit" }} />
                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <Btn variant="secondary" size="sm" onClick={() => setDeleteArchiveConfirmYear(null)}>Batal</Btn>
                    <Btn variant="danger" size="sm" disabled={deleteArchiveConfirmText.trim().toUpperCase() !== "HAPUS"}
                      onClick={async () => {
                        const y = deleteArchiveConfirmYear;
                        setDeleteArchiveConfirmYear(null);
                        const result = await deleteArchivedKontrolYear(y);
                        setArchiveMsg(result.ok ? { ok:true, message:`Arsip tahun ${y} berhasil dihapus permanen.` } : result);
                      }}>Hapus Permanen</Btn>
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>🔧 Migrasi Struktur Data Lama</div>
            <div style={{ fontSize:12, color:T.gray400, marginBottom:10, lineHeight:1.6 }}>
              Sekali jalan: memindahkan data kontrol lama (satu tabel besar) ke struktur per-tahun. Data diverifikasi
              tersalin dengan benar dulu sebelum salinan lama dihapus — aman diulang jika gagal di tengah jalan.
              Disarankan tekan "Unduh Backup Sekarang" dulu sebelum menjalankan ini.
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
              <input type="text" value={migrateConfirmText} onChange={e=>setMigrateConfirmText(e.target.value)}
                placeholder="Ketik MIGRASI untuk aktifkan tombol"
                style={{ padding:"8px 10px", fontSize:13, border:`1px solid ${T.gray200}`, borderRadius:8, fontFamily:"inherit" }} />
              <Btn variant="danger" disabled={migrating || migrateConfirmText.trim().toUpperCase() !== "MIGRASI"}
                onClick={async () => {
                  setMigrating(true);
                  setMigrationResult(null);
                  const result = await runKontrolYearMigration();
                  setMigrationResult(result);
                  setMigrating(false);
                  setMigrateConfirmText("");
                }}>
                {migrating ? "⏳ Memigrasi..." : "🔧 Jalankan Migrasi Sekarang"}
              </Btn>
            </div>
            {migrationResult && (
              <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:12,
                background: migrationResult.ok ? "#E6F4ED" : "#FEF2F2",
                color: migrationResult.ok ? "#0F4C35" : "#DC2626",
                border: `1px solid ${migrationResult.ok ? "#6EE7B7" : "#FCA5A5"}` }}>
                {migrationResult.message}
              </div>
            )}

            <div style={{ fontSize:13, fontWeight:600, color:T.gray800, marginBottom:8 }}>Riwayat Backup Cloud</div>
            {!user && (
              <div style={{ fontSize:12, color:T.gray400, marginBottom:8 }}>Login dengan Google untuk melihat & menyimpan backup di cloud.</div>
            )}
            {backupLoading && <div style={{ fontSize:13, color:T.gray400 }}>Memuat...</div>}
            {!backupLoading && user && backupList.length === 0 && (
              <div style={{ fontSize:13, color:T.gray400 }}>Belum ada backup cloud tersimpan.</div>
            )}
            {!backupLoading && backupList.length > 0 && (
              <div style={{ maxHeight:260, overflow:"auto", border:`1px solid ${T.gray200}`, borderRadius:8 }}>
                {backupList.map(b => (
                  <div key={b.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"10px 12px", borderBottom:`1px solid ${T.gray100}`, fontSize:13 }}>
                    <div>
                      <div style={{ fontWeight:600, color:T.gray800 }}>{b.key}</div>
                      <div style={{ fontSize:11, color:T.gray400 }}>{b.reason || "—"} · {b.ts ? new Date(b.ts).toLocaleString("id-ID") : "-"}</div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <Btn size="sm" variant="secondary" onClick={() => downloadJSON(`gwg_backup_${b.key}.json`, b)}>⬇️</Btn>
                      <Btn size="sm" variant="danger" onClick={() => { setRestoreTarget(b); setRestoreConfirmText(""); }}>Pulihkan</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:18 }}>
              <Btn variant="secondary" onClick={()=>setShowBackup(false)}>Tutup</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* KONFIRMASI RESTORE — backup akan MENGGANTI seluruh data saat ini,
          jadi perlu konfirmasi ketat sama seperti Reset. */}
      {restoreTarget && isAdmin && (
        <Modal title="⚠️ Pulihkan dari Backup" onClose={()=>{ setRestoreTarget(null); setRestoreConfirmText(""); }}>
          <div style={{ textAlign:"center", padding:"8px 0 20px" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:T.gray800, marginBottom:8 }}>
              Pulihkan data dari backup <b>{restoreTarget.key}</b>?
            </div>
            <div style={{ fontSize:13, color:T.gray400, marginBottom:16 }}>
              Seluruh data <b>saat ini</b> akan <b>diganti</b> dengan isi backup ini. Tindakan ini tidak bisa dibatalkan.
              Disarankan membuat backup data saat ini dulu sebelum melanjutkan (tombol "Unduh Backup Sekarang" di menu sebelumnya).
            </div>
            <div style={{ fontSize:13, color:T.gray800, marginBottom:8, textAlign:"left" }}>
              Ketik <b>PULIHKAN</b> di kolom bawah untuk mengonfirmasi:
            </div>
            <input
              type="text"
              value={restoreConfirmText}
              onChange={(e)=>setRestoreConfirmText(e.target.value)}
              placeholder="Ketik PULIHKAN"
              autoFocus
              style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:14,
                border:`1px solid ${T.gray200}`, borderRadius:8, marginBottom:20, textAlign:"center",
                fontFamily:"inherit", letterSpacing:1 }}
            />
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <Btn variant="secondary" onClick={()=>{ setRestoreTarget(null); setRestoreConfirmText(""); }}>Batal</Btn>
              <Btn
                variant="danger"
                disabled={restoreConfirmText.trim().toUpperCase() !== "PULIHKAN" || restoring}
                onClick={async ()=>{
                  if (!isAdmin || restoreConfirmText.trim().toUpperCase() !== "PULIHKAN" || restoring) return;
                  setRestoring(true);
                  const result = await restoreBackup(restoreTarget.data);
                  setRestoring(false);
                  setRestoreTarget(null);
                  setRestoreConfirmText("");
                  setShowBackup(false);
                  if (result && result.ok === false) {
                    alert("⚠️ Restore SEBAGIAN gagal!\n\n" + result.message);
                  } else {
                    alert("✅ Restore berhasil. Data toko/kontrol besar mungkin perlu beberapa detik untuk tampil sepenuhnya — tunggu status sinkron selesai sebelum menutup aplikasi.");
                  }
                }}
              >
                {restoring ? "Memulihkan..." : "Ya, Pulihkan Sekarang"}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* RESET CONFIRM — hanya bisa dibuka oleh Admin (tombol disembunyikan
          untuk role lain), DAN sebagai pengaman kedua, eksekusi resetDB()
          tetap dicek ulang isAdmin di sini, bukan hanya mengandalkan tombol
          yang tersembunyi di UI.
          VERIFIKASI 2 TAHAP:
          - Tahap 1: Admin wajib mengisi alasan reset (mencegah pencet tidak sengaja)
          - Tahap 2: Ketik frasa "HAPUS PERMANEN" persis (lebih susah terpencet sembarangan) */}
      {showReset && isAdmin && (
        <Modal title={`⚠️ Reset Database — Langkah ${resetStep} dari 2`}
          onClose={()=>{ setShowReset(false); setResetConfirmText(""); setResetStep(1); setResetAlasan(""); }}>
          <div style={{ padding:"4px 0 8px" }}>

            {/* Langkah 1: Isi alasan reset */}
            {resetStep === 1 && (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🔐</div>
                <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:8 }}>
                  Langkah 1: Konfirmasi Identitas & Alasan
                </div>
                <div style={{ fontSize:13, color:T.gray400, marginBottom:16, textAlign:"left",
                  background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8, padding:"12px 14px" }}>
                  <b style={{ color:T.red }}>⚠️ Peringatan Keras:</b> Tindakan ini akan menghapus
                  <b> seluruh data</b> (toko, rute, wilayah, produk, kontrol, pengguna)
                  {user && <span> termasuk <b>data cloud Firebase</b></span>} secara <b>permanen</b> dan
                  tidak dapat dibatalkan. Sistem akan membuat backup otomatis sebelum reset.
                </div>
                <div style={{ textAlign:"left", marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:5 }}>
                    Alasan Reset <span style={{ color:T.red }}>*</span>
                  </div>
                  <textarea
                    value={resetAlasan}
                    onChange={e=>setResetAlasan(e.target.value)}
                    placeholder="Tulis alasan reset secara jelas (misal: migrasi data baru, perbaikan struktur, dll)..."
                    rows={3}
                    style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:13,
                      border:`1.5px solid ${T.gray200}`, borderRadius:8, fontFamily:"inherit", resize:"vertical" }}
                  />
                  <div style={{ fontSize:11, color:T.gray400, marginTop:3 }}>
                    Wajib diisi minimal 10 karakter. Alasan akan dicatat di log backup otomatis.
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                  <Btn variant="secondary" onClick={()=>{ setShowReset(false); setResetAlasan(""); setResetStep(1); }}>Batal</Btn>
                  <Btn variant="danger"
                    disabled={resetAlasan.trim().length < 10}
                    onClick={()=>{ if(resetAlasan.trim().length >= 10) setResetStep(2); }}>
                    Lanjut ke Langkah 2 →
                  </Btn>
                </div>
              </div>
            )}

            {/* Langkah 2: Ketik frasa konfirmasi */}
            {resetStep === 2 && (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>💣</div>
                <div style={{ fontSize:15, fontWeight:700, color:T.red, marginBottom:8 }}>
                  Langkah 2: Konfirmasi Penghapusan Permanen
                </div>
                <div style={{ background:T.redLt, border:`1px solid #FCA5A5`, borderRadius:8,
                  padding:"10px 14px", marginBottom:16, fontSize:13, textAlign:"left" }}>
                  <div style={{ fontWeight:700, color:T.red, marginBottom:4 }}>Alasan yang Anda isi:</div>
                  <div style={{ color:T.gray800, fontStyle:"italic" }}>"{resetAlasan}"</div>
                </div>
                <div style={{ fontSize:13, color:T.gray800, marginBottom:8, textAlign:"left" }}>
                  Ketik <b style={{ color:T.red, letterSpacing:1 }}>HAPUS PERMANEN</b> di kolom bawah untuk mengonfirmasi:
                </div>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e)=>setResetConfirmText(e.target.value)}
                  placeholder="Ketik: HAPUS PERMANEN"
                  autoFocus
                  style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", fontSize:14,
                    border:`2px solid ${resetConfirmText.trim().toUpperCase()==="HAPUS PERMANEN"?T.red:T.gray200}`,
                    borderRadius:8, marginBottom:20, textAlign:"center",
                    fontFamily:"inherit", letterSpacing:2, background:T.redLt }}
                />
                <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                  <Btn variant="secondary" onClick={()=>{ setResetStep(1); setResetConfirmText(""); }}>← Kembali</Btn>
                  <Btn
                    variant="danger"
                    disabled={resetConfirmText.trim().toUpperCase() !== "HAPUS PERMANEN"}
                    onClick={()=>{
                      if (!isAdmin || resetConfirmText.trim().toUpperCase() !== "HAPUS PERMANEN") return;
                      resetDB();
                      setShowReset(false);
                      setResetConfirmText("");
                      setResetStep(1);
                      setResetAlasan("");
                    }}
                  >
                    💥 Ya, Reset Permanen Sekarang
                  </Btn>
                </div>
                <div style={{ marginTop:12, fontSize:11, color:T.gray400 }}>
                  Backup otomatis akan dibuat sebelum data dihapus.
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
