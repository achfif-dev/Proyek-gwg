import React from "react";
import { FIREBASE_CONFIGURED } from "../firebase/config";
import { GWG_LOGO_B64 } from "../theme/logo";
import { T } from "../theme/tokens";

export function LoginPage({ onLoginGoogle, fbReady, error }) {
  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(135deg, ${T.green} 0%, ${T.greenMid} 60%, #0A3526 100%)`,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" }}>
      <div style={{ background:T.white, borderRadius:20, padding:"40px 36px", maxWidth:400, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)", textAlign:"center" }}>
        
        {/* Logo */}
        <img src={GWG_LOGO_B64} alt="GWG Logo"
          style={{ width:90, height:90, borderRadius:"50%", objectFit:"contain",
            background:T.greenLt, padding:8, marginBottom:20, border:`3px solid ${T.greenMid}` }} />

        <h1 style={{ fontSize:22, fontWeight:800, color:T.green, margin:"0 0 4px" }}>
          Generasi Wangi Group
        </h1>
        <p style={{ fontSize:13, color:T.gray400, marginBottom:32, letterSpacing:"0.06em", textTransform:"uppercase" }}>
          Super App · Manajemen Konsinyasi
        </p>

        {!FIREBASE_CONFIGURED ? (
          /* Firebase belum dikonfigurasi → tampilkan pesan setup */
          <div style={{ padding:"16px", background:T.yellowLt, borderRadius:12,
            border:`1px solid #FDE047`, textAlign:"left" }}>
            <p style={{ fontSize:14, fontWeight:700, color:T.yellow, margin:"0 0 8px" }}>
              ⚠️ Firebase Belum Dikonfigurasi
            </p>
            <p style={{ fontSize:12, color:T.gray600, margin:0, lineHeight:1.6 }}>
              Untuk mengaktifkan login, buka file <code>src/firebase/config.js</code> dan isi
              <code> FIREBASE_CONFIG</code> dengan konfigurasi proyek Firebase Anda.<br/><br/>
              <b>Langkah:</b> Firebase Console → Project Settings → Web App → SDK Config
            </p>
          </div>
        ) : fbReady ? (
          /* Firebase siap → tampilkan tombol login */
          <>
            <button onClick={onLoginGoogle}
              style={{ width:"100%", padding:"13px 24px", borderRadius:12, border:`1px solid ${T.gray200}`,
                background:T.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                gap:12, fontSize:15, fontWeight:600, color:T.gray800, fontFamily:"inherit",
                boxShadow:"0 2px 8px rgba(0,0,0,.08)", transition:"all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.background=T.gray50; e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.background=T.white; e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.08)"; }}>
              {/* Google icon SVG */}
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Masuk dengan Google
            </button>

            {error && (
              <div style={{ marginTop:16, padding:"10px 16px", background:T.redLt, borderRadius:8,
                fontSize:13, color:T.red, border:`1px solid #FCA5A5` }}>
                ⚠️ {error}
              </div>
            )}

            <p style={{ fontSize:12, color:T.gray400, marginTop:20 }}>
              Hanya akun Google yang terdaftar dapat mengakses aplikasi ini.<br/>
              Akun baru otomatis masuk sebagai <b>Sales</b>; Admin/Manajer dapat
              mengubah role di tab <b>Pengguna</b>.
            </p>
          </>
        ) : (
          /* Firebase dikonfigurasi tapi sedang loading */
          <div style={{ padding:"20px 0" }}>
            <div style={{ width:40, height:40, border:`3px solid ${T.green}`, borderTopColor:"transparent",
              borderRadius:"50%", margin:"0 auto 16px", animation:"spin 1s linear infinite" }} />
            <p style={{ color:T.gray600, fontSize:14 }}>Memuat sistem autentikasi...</p>
          </div>
        )}

        <div style={{ marginTop:32, paddingTop:20, borderTop:`1px solid ${T.gray100}`,
          fontSize:11, color:T.gray400 }}>
          © {new Date().getFullYear()} Generasi Wangi Group · Sampang, Jawa Timur
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// Tab yang boleh diakses oleh role Sales (terbatas: hanya operasional harian).
// Admin & Manajer otomatis bisa mengakses SEMUA tab (lihat fungsi canAccessTab).
