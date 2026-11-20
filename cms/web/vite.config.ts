import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'offline.html',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        id: '/',
        name: 'Auto AdTech Display',
        short_name: 'Auto Display',
        description:
          'Auto AdTech full-screen vehicle display — Auto Number login, OTP, then /display signage',
        theme_color: '#050e0a',
        background_color: '#050e0a',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone', 'minimal-ui'],
        orientation: 'landscape',
        // App root: login → OTP → /display (session resumes at /display after install)
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['business', 'productivity'],
        prefer_related_applications: false,
        launch_handler: {
          client_mode: ['navigate-existing', 'auto'],
        },
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell SPA navigations
        navigateFallback: '/index.html',
        // Never fall back navigations that look like API/auth
        navigateFallbackDenylist: [/^\/api\//],
        // Precache offline page + icons with the build
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        // Do NOT cache OTP / auth / any API responses (sensitive)
        runtimeCaching: [
          {
            // Explicit NetworkOnly for all API — no OTP, tokens, or dashboard JSON in Cache Storage
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            /*
              Phone / PWA: do NOT CacheFirst video.
              <video> uses Range requests; CacheFirst without range support returns
              broken responses → media_playback_error → black Display on tunnel HTTPS.
              NetworkOnly keeps same-origin /test-ad-*.mp4 playable through Cloudflare.
            */
            urlPattern: ({ request, url }) =>
              request.destination === 'video' ||
              /\.(mp4|webm|ogg|m4v)(\?|$)/i.test(url.pathname),
            handler: 'NetworkOnly',
          },
          {
            // Creative images (and app icons) — never invent URLs; only cache what the queue assigns
            urlPattern: ({ request, url }) =>
              (request.destination === 'image' ||
                url.pathname.startsWith('/icons/')) &&
              !/\.(mp4|webm|ogg|m4v)(\?|$)/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              // v2: old cms-ad-media-v1 may hold broken full-body video responses
              cacheName: 'cms-ad-media-images-v2',
              expiration: {
                maxEntries: 48,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
        additionalManifestEntries: [
          { url: '/offline.html', revision: 'auto-cms-offline-1' },
        ],
      },
      // Required for Chrome Install while using `npm run dev` / tunnel HTTPS
      // (without this, /manifest.webmanifest and /sw.js SPA-fallback to HTML)
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      injectRegister: 'auto',
    }),
  ],
  server: {
    host: '0.0.0.0',
    // Default 4173; override with --port / VITE_PORT (e.g. 3002) for tunnels
    port: Number(process.env.VITE_PORT) || 4173,
    strictPort: false,
    // Allow Cloudflare quick tunnels / localtunnel / ngrok hostnames for phone HTTPS install
    allowedHosts: true,
    hmr: {
      // Use the page URL port (works for 4173, 3002, or HTTPS tunnel)
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT) || 4173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
  },
});
