import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'GWG Super App — Generasi Wangi Group',
        short_name: 'GWG App',
        description: 'Aplikasi manajemen Generasi Wangi Group',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#000000',
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
})
