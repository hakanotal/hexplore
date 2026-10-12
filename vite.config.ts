import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Hexplore',
        short_name: 'Hexplore',
        description: 'Your Google Maps saved places on an OpenStreetMap map, with filters, stats and an assistant.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Vector tiles, glyphs and sprites from OpenFreeMap
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Satellite imagery (Esri) and terrain (Mapterhorn). Live traffic is never cached.
            urlPattern: ({ url }) => url.hostname === 'server.arcgisonline.com' || url.hostname === 'tiles.mapterhorn.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-imagery',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // PLACES_API_KEY in .env reaches the client (and the built JS). Restrict the
  // key to the Places API and your own domain in Google Cloud.
  envPrefix: ['VITE_', 'PLACES_API_KEY'],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    manifest: true,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre'
        },
      },
    },
  },
})
