import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const apiPort = process.env.E2E_API_PORT ?? '3000';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    solidPlugin(),
    VitePWA({
      // We register the SW ourselves from src/lib/sw.ts so we can drive
      // the "update available" toast. The static manifest in public/ stays
      // the source of truth — let the plugin focus on the SW.
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // SSE and the rest of the API must never get the SPA shell back,
        // and we intentionally add no runtimeCaching for /api/* so the
        // service worker stays out of the realtime stream's way.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Pull in our `push` / `notificationclick` listeners. The file
        // lives in /public so it's served at the root and the Workbox
        // generated SW can importScripts() it at install time.
        importScripts: ['/push-handlers.js'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        // SSE-friendly: disable buffering
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
