import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
