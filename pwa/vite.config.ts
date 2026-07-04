import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Low-data, installable PWA shell. Workbox precaches the app shell so a
// returning user on a flaky Zambian connection still gets an instant load;
// API GETs use NetworkFirst with a short timeout + cache fallback.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Sebenza',
        short_name: 'Sebenza',
        description: 'Find trusted local service providers, or earn doing what you do.',
        theme_color: '#7B1A3A',
        background_color: '#FBF7F8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Dev: proxy API calls to the Laravel backend.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      // Dev: service/provider photos live on the backend's public storage disk.
      '/storage': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    // Lean chunks for low-data: split vendor and lazy-load routes.
    chunkSizeWarningLimit: 600,
  },
});
