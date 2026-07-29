import React, { useRef, useState } from "react";
import { Btn, Card, Input } from "../../components/ui";
import { loadAppConfig, saveAppConfig, resetAppConfig } from "../../config/appConfig";
import { T } from "../../theme/tokens";

// Regex sederhana untuk mengambil field dari kode konfigurasi Firebase yang
// ditempel apa adanya dari Firebase Console (Project Settings → SDK setup
// and configuration), tanpa user perlu memisah manual satu-satu.
function parseFirebaseConfigText(text) {
  const fields = ["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"];
  const out = {};
  fields.forEach(key => {
    const re = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`, "i");
    const m = text.match(re);
    if (m) out[key] = m[1];
  });
  return out;
}

const STEP_LABELS = ["Branding", "Firebase", "Super Admin", "Selesai"];

export function SetupWizard({ onDone, onCancel }) {
  const initial = loadAppConfig();
  const [step, setStep] = useState(1);
  const [brand, setBrand] = useState(initial.brand);
  const [firebase, setFirebaseForm] = useState(initial.firebase);
  const [superAdminEmail, setSuperAdminEmail] = useState(initial.superAdminEmail || "");
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const fileRef = useRef(null);

  const bset = (k, v) => setBrand(p => ({ ...p, [k]: v }));
  const fset = (k, v) => setFirebaseForm(p => ({ ...p, [k]: v }));

  function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 900 * 1024) {
      alert("⚠️ Ukuran logo terlalu besar (maks ±900 KB). Gunakan gambar yang lebih kecil/terkompresi.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => bset("logoDataUrl", reader.result);
    reader.readAsDataURL(file);
  }

  function applyPaste() {
    const parsed = parseFirebaseConfigText(pasteText);
    const foundCount = Object.keys(parsed).length;
    if (foundCount === 0) {
      setPasteMsg("⚠️ Tidak ada field yang terdeteksi. Pastikan kode konfigurasi ditempel apa adanya dari Firebase Console.");
      return;
    }
    setFirebaseForm(p => ({ ...p, ...parsed }));
    setPasteMsg(`✅ ${foundCount} field berhasil terisi otomatis dari teks yang ditempel. Periksa kembali di bawah.`);
  }

  function finish() {
    const next = saveAppConfig({
      brand,
      firebase,
      superAdminEmail: superAdminEmail.trim(),
      setupCompleted: true,
    });
    if (onDone) onDone(next);
    // Reload penuh supaya semua modul (Firebase init, palet warna T, dsb)
    // yang sudah kadung dibaca sekali saat startup ikut memakai nilai baru.
    window.location.reload();
  }

  const previewLogo = brand.logoDataUrl || null;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:20, overflowX:"hidden", boxSizing:"border-box", width:"100%" }}>
      {/* ✅ FIX TAMPILAN MOBILE: SetupWizard bisa dirender SEBELUM App.jsx
          sempat memasang reset CSS global-nya (mis. saat LoginPage
          menampilkannya otomatis untuk instalasi baru — belum ada elemen
          App.jsx sama sekali di halaman). Tanpa `box-sizing:border-box`,
          elemen dengan padding (seperti Card & input di bawah) dihitung
          browser dengan lebar TOTAL = lebar konten + padding + border,
          bukan padding "dimakan" dari dalam — di layar kecil ini gampang
          bikin elemen melebar sedikit demi sedikit sampai ada yang
          terdorong keluar layar. Discope pakai className supaya tidak
          bocor mempengaruhi styling di luar wizard ini. */}
      <style>{`
        .gw-setup-wizard, .gw-setup-wizard *, .gw-setup-wizard *::before, .gw-setup-wizard *::after {
          box-sizing: border-box;
        }
        .gw-setup-wizard input, .gw-setup-wizard textarea {
          max-width: 100%;
        }
      `}</style>
      <div className="gw-setup-wizard" style={{ maxWidth:560, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.gray800 }}>🚀 Setup Aplikasi (White Label)</div>
          <div style={{ fontSize:12, color:T.gray400, marginTop:4 }}>
            Sesuaikan aplikasi ini dengan identitas & database perusahaan Anda sendiri
          </div>
        </div>

        {/* Progress */}
        <div style={{ display:"flex", gap:6, marginBottom:16 }}>
          {STEP_LABELS.map((label, i) => (
            <div key={label} style={{ flex:1, textAlign:"center", minWidth:0 }}>
              <div style={{ height:5, borderRadius:99, background:(i+1)<=step ? T.green : T.gray200, marginBottom:5 }} />
              <div style={{ fontSize:10, fontWeight:700, color:(i+1)<=step ? T.green : T.gray400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
            </div>
          ))}
        </div>

        <Card>
          {step === 1 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:14 }}>🎨 Identitas & Branding</div>
              <Input label="Nama Perusahaan" value={brand.companyName} onChange={v=>bset("companyName", v)} required placeholder="cth: Aroma Nusantara Group" />
              <Input label="Nama Aplikasi" value={brand.appName} onChange={v=>bset("appName", v)} placeholder="cth: ANG Super App" />
              <Input label="Tagline" value={brand.tagline} onChange={v=>bset("tagline", v)} placeholder="cth: Super App · Sistem Manajemen Konsinyasi" />
              <Input label="Teks Footer" value={brand.footerText} onChange={v=>bset("footerText", v)} placeholder="cth: Aroma Nusantara Group · Kota Anda" />

              {/* ⚡ FIX: root cause overflow di layar kecil — grid 2 kolom ini
                  sebelumnya tanpa `minWidth:0` di setiap sel. Perilaku default
                  CSS Grid: lebar minimum sebuah sel = lebar konten TERBESAR di
                  dalamnya (bukan menyusut mengikuti `1fr`), jadi kalau input
                  hex-nya "maunya" lebih lebar dari jatah kolom, seluruh grid
                  (dan halaman) ikut terdorong melebar ke kanan sampai keluar
                  layar — persis yang terlihat di screenshot ("Warna Aksen"
                  terpotong di tepi layar). `minWidth:0` mengizinkan sel grid
                  benar-benar menyusut sesuai jatahnya. */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:6 }}>Warna Utama</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", minWidth:0 }}>
                    <input type="color" value={brand.primaryColor} onChange={e=>bset("primaryColor", e.target.value)}
                      style={{ width:34, height:34, flexShrink:0, border:`1.5px solid ${T.gray200}`, borderRadius:8, cursor:"pointer", padding:2 }} />
                    <input value={brand.primaryColor} onChange={e=>bset("primaryColor", e.target.value)}
                      style={{ flex:1, minWidth:0, width:"100%", padding:"8px 6px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:11, fontFamily:"inherit" }} />
                  </div>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:6 }}>Warna Aksen</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", minWidth:0 }}>
                    <input type="color" value={brand.accentColor} onChange={e=>bset("accentColor", e.target.value)}
                      style={{ width:34, height:34, flexShrink:0, border:`1.5px solid ${T.gray200}`, borderRadius:8, cursor:"pointer", padding:2 }} />
                    <input value={brand.accentColor} onChange={e=>bset("accentColor", e.target.value)}
                      style={{ flex:1, minWidth:0, width:"100%", padding:"8px 6px", border:`1.5px solid ${T.gray200}`, borderRadius:7, fontSize:11, fontFamily:"inherit" }} />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom:6 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.gray600, marginBottom:6 }}>Logo (opsional)</div>
                <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ width:64, height:64, borderRadius:"50%", background:T.gray100, border:`1.5px solid ${T.gray200}`,
                    display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
                    {previewLogo
                      ? <img src={previewLogo} alt="Preview logo" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
                      : <span style={{ fontSize:22 }}>🌿</span>}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <Btn variant="secondary" size="sm" onClick={()=>fileRef.current?.click()}>Unggah Logo</Btn>
                    {brand.logoDataUrl && (
                      <Btn variant="secondary" size="sm" onClick={()=>bset("logoDataUrl","")} style={{ marginLeft:8 }}>Hapus</Btn>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoFile} style={{ display:"none" }} />
                    <div style={{ fontSize:11, color:T.gray400, marginTop:4 }}>PNG/JPG, maks ±900 KB. Kosongkan untuk pakai logo bawaan.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:6 }}>🔥 Konfigurasi Firebase</div>
              <div style={{ fontSize:12, color:T.gray500, marginBottom:14, lineHeight:1.6 }}>
                Buat/pakai project Firebase milik perusahaan Anda sendiri (gratis), lalu buka
                <b> Project Settings → Your apps → SDK setup and configuration</b>, salin kodenya,
                dan tempel di bawah ini.
              </div>
              <Input label="Tempel Kode Konfigurasi Firebase" value={pasteText} onChange={setPasteText}
                type="textarea" placeholder={`const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  ...\n};`} />
              <Btn variant="secondary" size="sm" onClick={applyPaste} style={{ marginBottom:10 }}>🔍 Ambil Otomatis dari Teks</Btn>
              {pasteMsg && <div style={{ fontSize:12, color:T.green, marginBottom:10 }}>{pasteMsg}</div>}

              <div style={{ fontSize:11, fontWeight:700, color:T.gray400, textTransform:"uppercase", letterSpacing:"0.06em", margin:"14px 0 8px" }}>
                Atau isi manual
              </div>
              <Input label="apiKey" value={firebase.apiKey} onChange={v=>fset("apiKey", v)} />
              <Input label="authDomain" value={firebase.authDomain} onChange={v=>fset("authDomain", v)} />
              <Input label="databaseURL" value={firebase.databaseURL} onChange={v=>fset("databaseURL", v)} />
              <Input label="projectId" value={firebase.projectId} onChange={v=>fset("projectId", v)} />
              <Input label="storageBucket" value={firebase.storageBucket} onChange={v=>fset("storageBucket", v)} />
              <Input label="messagingSenderId" value={firebase.messagingSenderId} onChange={v=>fset("messagingSenderId", v)} />
              <Input label="appId" value={firebase.appId} onChange={v=>fset("appId", v)} />
              <div style={{ background:T.blueLt, borderRadius:8, padding:"10px 12px", fontSize:11, color:T.gray600, marginTop:6 }}>
                💡 Jangan lupa aktifkan <b>Authentication → Sign-in method → Google</b> dan
                <b> Realtime Database</b> di project Firebase tersebut.
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:6 }}>👑 Akun Super Admin</div>
              <div style={{ fontSize:12, color:T.gray500, marginBottom:14, lineHeight:1.6 }}>
                Akun Google dengan email ini akan SELALU mendapat akses Admin penuh setiap kali
                login — apa pun yang tercatat di tabel Pengguna. Cocok sebagai "kunci cadangan"
                pemilik aplikasi. Bisa dikosongkan (akun Google pertama yang login otomatis
                menjadi Admin selama tabel Pengguna masih kosong).
              </div>
              <Input label="Email Google Super Admin" value={superAdminEmail} onChange={setSuperAdminEmail}
                placeholder="cth: pemilik@perusahaananda.com" />
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:T.gray800, marginBottom:14 }}>✅ Ringkasan</div>
              <div style={{ fontSize:12, color:T.gray700, lineHeight:2 }}>
                <div><b>Nama Perusahaan:</b> {brand.companyName || "—"}</div>
                <div><b>Nama Aplikasi:</b> {brand.appName || "—"}</div>
                <div><b>Warna:</b> <span style={{ display:"inline-block", width:14, height:14, borderRadius:4, background:brand.primaryColor, verticalAlign:"middle", marginRight:4 }} />{brand.primaryColor} · <span style={{ display:"inline-block", width:14, height:14, borderRadius:4, background:brand.accentColor, verticalAlign:"middle", marginRight:4 }} />{brand.accentColor}</div>
                <div><b>Firebase Project:</b> {firebase.projectId || "—"}</div>
                <div><b>Super Admin:</b> {superAdminEmail || "(tidak diisi)"}</div>
              </div>
              <div style={{ background:T.orangeLt, borderRadius:8, padding:"10px 12px", fontSize:11, color:T.orange, marginTop:14 }}>
                ⚠️ Setelah disimpan, aplikasi akan dimuat ulang otomatis untuk menerapkan
                perubahan.
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:10, justifyContent:"space-between", marginTop:20 }}>
            <div>
              {step > 1 && <Btn variant="secondary" onClick={()=>setStep(s=>s-1)}>← Kembali</Btn>}
              {step === 1 && onCancel && <Btn variant="secondary" onClick={onCancel}>Batal</Btn>}
            </div>
            <div>
              {step < 4
                ? <Btn onClick={()=>setStep(s=>s+1)}>Lanjut →</Btn>
                : <Btn onClick={finish}>💾 Simpan & Muat Ulang</Btn>}
            </div>
          </div>
        </Card>

        {onCancel && (
          <div style={{ textAlign:"center", marginTop:14 }}>
            <button onClick={()=>{ if(confirm("Kembalikan semua pengaturan white label ke bawaan GWG?")) { resetAppConfig(); window.location.reload(); } }}
              style={{ background:"none", border:"none", color:T.gray400, fontSize:11, cursor:"pointer", textDecoration:"underline" }}>
              Kembalikan ke pengaturan bawaan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
