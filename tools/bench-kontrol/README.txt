Pengukur kinerja Tab Kontrol (butuh komputer dengan Node 20+; tidak untuk HP).
1) mkdir bench && cd bench && npm init -y && npm i react@18.3.1 react-dom@18.3.1 lucide-react@0.462.0 jsdom@24 esbuild
2) salin build.mjs, bench-entry.jsx, run.mjs ke folder itu; ubah path "/home/claude/Proyek-gwg" di bench-entry.jsx ke lokasi repo.
3) node build.mjs && N_TOKO=3000 N_KONTROL=20000 URUTAN="b,ba,bar,," node run.mjs
Profil: node --cpu-prof --cpu-prof-dir=prof run.mjs ; node analisa.mjs
