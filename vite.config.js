import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ✅ WHITE LABEL: nama/deskripsi/warna manifest PWA dibaca dari .env (lihat
// file .env di root — sudah ada nilai bawaan GWG di sana) supaya perusahaan
// lain yang mem-fork aplikasi ini cukup ganti .env lalu build ulang, tanpa
// perlu edit file konfigurasi ini.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appTitle = env.VITE_APP_TITLE || 'GWG Super App — Generasi Wangi Group'
  const shortName = env.VITE_APP_SHORT_NAME || 'GWG App'
  const description = env.VITE_APP_DESCRIPTION || 'Aplikasi manajemen Generasi Wangi Group'
  const themeColor = env.VITE_THEME_COLOR || '#000000'

  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/favicon-16.png', 'logo.png'],
      manifest: {
        name: appTitle,
        short_name: shortName,
        description: description,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: themeColor,
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Bundle utama (Firebase + xlsx + jspdf + html2canvas, dll) sedikit
        // di atas batas default Workbox 2 MiB, jadi service worker gagal
        // di-generate. Dinaikkan ke 3 MB supaya file tetap ikut di-precache.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*firebasedatabase\.app\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-rtdb-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      // Prevent Vite from trying to bundle Firebase CDN imports
      external: [],
      output: {
        // ✅ CODE-SPLITTING: sebelumnya semua dependency (Firebase, xlsx,
        // jspdf, html2canvas, dll) digabung jadi satu file JS ~2.1 MB —
        // ini yang bikin build gagal (lewat batas precache Workbox 2 MiB)
        // dan bikin loading awal berat di HP dengan sinyal lemah.
        // Dipecah per-library jadi beberapa chunk vendor terpisah supaya:
        // 1. Tidak ada satu file pun yang mendekati/lewat batas 2 MiB lagi.
        // 2. Browser bisa cache tiap vendor terpisah — kalau cuma kode
        //    aplikasi (src/**) yang berubah, user tidak perlu download
        //    ulang chunk Firebase/xlsx/jspdf yang tidak berubah.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase') || id.includes('@capacitor-firebase')) return 'vendor-firebase'
          if (id.includes('xlsx')) return 'vendor-xlsx'
          if (id.includes('jspdf')) return 'vendor-jspdf'
          if (id.includes('html2canvas')) return 'vendor-html2canvas'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@capacitor')) return 'vendor-capacitor'
          return 'vendor'
        },
      },
    },
    // Ensure compatibility
    target: 'es2020',
    // Naikkan ambang warning bawaan Vite (500 kB) supaya tidak berisik untuk
    // chunk vendor yang memang wajar berukuran lebih besar (mis. Firebase).
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ['xlsx'],
    // Don't pre-bundle Firebase CDN imports
    exclude: [],
  },
  // Required for Netlify SPA routing
  server: {
    historyApiFallback: true,
  },
  }
})
