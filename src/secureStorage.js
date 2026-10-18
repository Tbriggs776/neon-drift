// ============================================================
// NEON DRIFT - SIGN-IN STORAGE (iOS Keychain)
// ============================================================
// Inside the iOS app the Supabase session lives in the Keychain
// (ios/App/App/NeonSecure.swift), not the web view's localStorage.
//
// WebKit writes localStorage to disk lazily, so the app killed just after
// supabase-js rotated the refresh token could come back with the OLD token,
// which the server refuses as already used, and the pilot is signed out.
// The Keychain is written at once. A session already in localStorage moves
// into the Keychain the first time it is read, so nobody is signed out by
// the change. The browser and Android have no NeonSecure and keep using
// localStorage exactly as before.
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core';

export const NeonSecure = registerPlugin('NeonSecure');
export const hasSecureStore = Capacitor.isPluginAvailable('NeonSecure');

const local = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch (e) {} }
};

const keychainStorage = {
  async getItem(key) {
    try {
      const { value } = await NeonSecure.getItem({ key });
      if (value != null) return value;
      const old = local.getItem(key);
      if (old != null) { await NeonSecure.setItem({ key, value: old }); local.removeItem(key); }
      return old;
    } catch (e) {
      return local.getItem(key);
    }
  },
  async setItem(key, value) {
    try { await NeonSecure.setItem({ key, value }); local.removeItem(key); } catch (e) { local.setItem(key, value); }
  },
  async removeItem(key) {
    local.removeItem(key);
    try { await NeonSecure.removeItem({ key }); } catch (e) {}
  }
};

// The storage supabase-js should use: the Keychain inside the iOS app,
// undefined (its own localStorage default) everywhere else.
export const authStorage = hasSecureStore ? keychainStorage : undefined;
