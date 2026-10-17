// ============================================================
// NEON DRIFT - NATIVE APP GLUE (Capacitor)
// ============================================================
// Everything here is a no-op in the browser. In the iOS / Android apps it:
//   - opens auth deep links (password reset) back into the game
//   - routes the Android / TV remote Back button through menu nav
//   - turns on TV layout + always-on focus rings on Android TV
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { navBack, setTvMode } from './menuNav.js';

export const isNative = Capacitor.isNativePlatform();

// Custom URL scheme registered in ios/App/App/Info.plist and
// android/app/src/main/AndroidManifest.xml. Must also be added to
// Supabase → Authentication → URL Configuration → Redirect URLs.
export const AUTH_REDIRECT_URL = 'com.tylerbriggs.neondrift://auth';

// Local Android plugin (android/app/src/main/java/.../TvModePlugin.java).
const TvMode = registerPlugin('TvMode');

async function detectTv() {
  // ?tv in the URL forces TV layout, handy for testing in a desktop browser
  // or on TV web runtimes (Tizen / webOS).
  if (new URLSearchParams(window.location.search).has('tv')) return true;
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    const { isTv } = await TvMode.isTv();
    return !!isTv;
  } catch (e) {
    return false;
  }
}

// onDeepLink(url): called for app-scheme URLs, both cold start and warm.
// onBack(): game-level Back handling when no overlay used it (e.g. pause a
// live run). Return true if handled; otherwise the app exits, which is what
// Android and Android TV expect from Back on the title screen.
export async function initNative({ onDeepLink, onBack } = {}) {
  if (await detectTv()) setTvMode(true);
  if (!isNative) return;

  App.addListener('appUrlOpen', ({ url }) => onDeepLink?.(url));
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) onDeepLink?.(launch.url);
  } catch (e) {}

  App.addListener('backButton', () => {
    if (navBack()) return;
    if (onBack?.()) return;
    App.exitApp();
  });
}
