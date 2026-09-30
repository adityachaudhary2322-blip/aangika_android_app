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
import { SocialLogin } from '@capgo/capacitor-social-login';
import { registerTransport } from '../services/glove/transports.js';
import { registerNativeGoogle } from '../services/session.js';
import { capacitorBleTransport } from './capacitorBle.js';

/**
 * Google sign-in, natively (Android Credential Manager): Google refuses its
 * web sign-in inside app WebViews. Uses the WEB client id, so the ID token is
 * the same kind the Worker verifies for the website. Works only in an APK
 * signed with a key whose SHA-1 is registered as an Android OAuth client in
 * the same Google Cloud project (package com.aangika.app).
 */
let googleReady = null;
async function googleIdToken(webClientId) {
  googleReady ||= SocialLogin.initialize({ google: { webClientId, mode: 'online' } });
  await googleReady;
  let res;
  try {
    res = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'], style: 'standard' } });
  } catch (err) {
    const m = String(err?.message || err);
    if (/cancel/i.test(m)) throw new Error('Google sign-in was cancelled.');
    if (/no credential|developer|10:|16:|misconfig/i.test(m)) {
      throw new Error('Google sign-in is not set up for this copy of the app (its signing key is not registered with Google).');
    }
    throw new Error(`Google sign-in failed: ${m}`);
  }
  const token = res?.result?.idToken;
  if (!token) throw new Error('Google did not return a sign-in token.');
  return token;
}

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  registerTransport('native-ble', capacitorBleTransport);
  registerNativeGoogle(googleIdToken);
  App.addListener('backButton', () => {
    window.dispatchEvent(new CustomEvent('aangika:back', { detail: { exit: () => App.exitApp() } }));
  });
  // After first paint, so the splash never hides a blank screen.
  requestAnimationFrame(() => setTimeout(() => SplashScreen.hide(), 300));
}

export default setupNative;
