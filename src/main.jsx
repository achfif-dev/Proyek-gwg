import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import GWGSuperApp from './App'

// PWA service worker HANYA relevan untuk konteks browser/PWA (supaya app bisa
// dipakai offline & auto-update lewat browser). Di APK (Capacitor native),
// app SUDAH terpasang sebagai paket native — tidak butuh service worker sama
// sekali. Sebelumnya registerSW() dipanggil TANPA pengecekan platform, DI
// ATAS ReactDOM.render() — kalau registrasi ini gagal/macet di WebView
// Android (skema lokal "https://localhost" milik Capacitor tidak selalu
// berperilaku sama seperti origin web biasa untuk service worker), seluruh
// baris di bawahnya termasuk ReactDOM.render() TIDAK PERNAH SEMPAT JALAN —
// hasilnya layar benar-benar putih kosong, bahkan logo loading pun tidak
// sempat tampil. Sekarang render React dijalankan LEBIH DULU (supaya app
// selalu tampil apa pun yang terjadi dengan service worker), dan registerSW
// dilewati total di platform native.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GWGSuperApp />
  </React.StrictMode>,
)

if (!Capacitor.isNativePlatform()) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    try {
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
    } catch (e) {
      console.warn('registerSW gagal (diabaikan, tidak menghalangi app):', e)
    }
  })
}
