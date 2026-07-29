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
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'logo.png'],
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
    },
    // Ensure compatibility
    target: 'es2020',
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
