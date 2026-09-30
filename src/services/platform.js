/**
 * Where the app is running, and where its large assets come from.
 *
 * Website: MediaPipe's wasm and .task models load from their CDNs (cached by
 * the service worker after first use).
 * Android app (Capacitor): everything is bundled inside the APK under
 * /mediapipe/, so recognition works offline from the very first launch.
 * scripts/fetch-offline-assets.mjs stages those files before `cap sync`.
 */

export function isNativeApp() {
  return typeof window !== 'undefined'
    && Boolean(window.Capacitor?.isNativePlatform?.());
}

/** The public website (links shared from the Android app must point here, not at the app's own https://localhost). */
export const SITE_URL = String(import.meta.env?.VITE_SITE_URL || 'https://aangika-pwa02.onrender.com').replace(/\/+$/, '');

/** Where a link other people open should point: this site, or the website from inside the app. */
export const publicOrigin = () => (isNativeApp() ? SITE_URL : window.location.origin);

export const LOCAL_MEDIAPIPE = {
  wasm: '/mediapipe/wasm',
  models: '/mediapipe/models',
};

/** Pick the bundled copy of a CDN asset when running as the Android app. */
export function assetUrl(cdnUrl, localPath) {
  return isNativeApp() ? localPath : cdnUrl;
}

export default { isNativeApp, assetUrl, LOCAL_MEDIAPIPE };
