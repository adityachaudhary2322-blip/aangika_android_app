/**
 * Android-app-only wiring (this file exists only in aangika-android).
 * Everything else is the website's code, merged from `upstream`.
 *
 * - native Bluetooth LE for the glove (instead of Web Bluetooth)
 * - the hardware back button -> 'aangika:back' (App.jsx steps back or exits)
 * - hide the splash screen once the UI has rendered
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { registerTransport } from '../services/glove/transports.js';
import { capacitorBleTransport } from './capacitorBle.js';

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  registerTransport('native-ble', capacitorBleTransport);
  App.addListener('backButton', () => {
    window.dispatchEvent(new CustomEvent('aangika:back', { detail: { exit: () => App.exitApp() } }));
  });
  // After first paint, so the splash never hides a blank screen.
  requestAnimationFrame(() => setTimeout(() => SplashScreen.hide(), 300));
}

export default setupNative;
