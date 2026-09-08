import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  const plugins = [react()];
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
