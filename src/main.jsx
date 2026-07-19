import React from 'react'
import ReactDOM from 'react-dom/client'
import GWGSuperApp from './App'
import { registerSW } from 'virtual:pwa-register'

registerSW({
  immediate: true,
  onNeedRefresh() {
    if (confirm('Versi baru aplikasi tersedia. Muat ulang sekarang?')) {
      window.location.reload()
    }
  },
  onOfflineReady() {
    console.log('Aplikasi siap dipakai offline.')
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GWGSuperApp />
  </React.StrictMode>,
)
