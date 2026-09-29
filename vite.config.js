import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// getUserMedia only works in a secure context. http://localhost qualifies;
// http://192.168.x.x does NOT, so a phone on the LAN gets a blocked camera and
// microphone. `npm run dev:https` sets VITE_HTTPS=1 and serves a self-signed
// certificate instead, which makes the phone show a one-time warning and then
// grant camera access normally.
//
// The plugin is imported dynamically and only when that flag is set, so a
// missing or version-mismatched dev dependency can never break `npm run build`.
const useHttps = process.env.VITE_HTTPS === '1';

export default defineConfig(async () => {
  const plugins = [
    react(),
    // Installable, offline-capable PWA.
    //  - The app shell (code, styles, icons, word list) is precached, so the
    //    app always opens offline.
    //  - Recognition models are cached the first time they load (or from
    //    Settings > "Prepare for offline"): the 21 MB tagger and the 27 MB
    //    ONNX runtime are too big to force on every install. Model files are
    //    versioned by NAME (…_v2.onnx), so CacheFirst never serves stale
    //    weights: a new release ships a new file name.
    //  - registerType 'prompt': a new version waits for the user's tap
    //    rather than reloading under someone mid-conversation.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,          // registered from src/services/pwa.js
      manifest: false,               // public/manifest.webmanifest is the manifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'brand/*.jpg', 'models/vocab.json'],
        globIgnores: ['**/*.wasm', '**/*.onnx'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Control the page on the very first visit, so models loaded then
        // are already cached. (Updates still wait for the user's tap.)
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin
              && (url.pathname.endsWith('.onnx') || url.pathname.endsWith('.wasm')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aangika-models',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://cdn.jsdelivr.net'
              && url.pathname.startsWith('/npm/@mediapipe/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aangika-mediapipe',
              expiration: { maxEntries: 20 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://storage.googleapis.com'
              && url.pathname.startsWith('/mediapipe-models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aangika-mediapipe',
              expiration: { maxEntries: 20 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com'
              || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'aangika-fonts',
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ];
  if (useHttps) {
    try {
      const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
      plugins.push(basicSsl());
    } catch {
      console.warn(
        '[isl-web] @vitejs/plugin-basic-ssl not installed - serving plain HTTP. ' +
        'Camera access will be blocked on any origin other than localhost.'
      );
    }
  }

  return {
    plugins,
    server: { host: true, port: 5173 },
    // onnxruntime-web ships prebuilt .wasm binaries. Excluding it from dep
    // pre-bundling keeps Vite from rewriting them, and assetsInlineLimit 0
    // stops the 21 MB model ever being base64-inlined.
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  };
});
