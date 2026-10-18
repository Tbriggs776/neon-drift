// ============================================================
// NEON DRIFT - FACE ID LOCK (iOS app)
// ============================================================
// Face ID in front of the iOS app whenever someone is signed in: when the app
// opens, and when it comes back after AWAY_MS in the background. Face ID,
// else Touch ID, else the device passcode (NeonSecure.authenticate,
// LAPolicy.deviceOwnerAuthentication), so nobody is locked out of a device
// they can unlock. Nobody signed in, or a device with no passcode at all:
// no lock (iOS has nothing to check against).
//
// The sign-in itself stays in the Keychain (secureStorage.js); this only asks
// that the device's owner is the one holding it. "Sign in with password
// instead" signs out and drops the lock. The browser and Android never lock.
// ============================================================

import { supabase } from './supabaseClient.js';
import { NeonSecure, hasSecureStore } from './secureStorage.js';

const AWAY_MS = 5 * 60 * 1000;
const KIND_LABEL = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', passcode: 'Passcode' };

let kind = null;      // null until known; 'none' = cannot ask
let asking = false;
let hiddenAt = null;

const screen = () => document.getElementById('lockScreen');

function show(ready) {
  const el = screen();
  el.classList.remove('hidden');
  el.querySelector('.card').classList.toggle('hidden', !ready);
}

function hide() {
  screen().classList.add('hidden');
}

function setMessage(text) {
  document.getElementById('lockMessage').textContent = text;
}

async function unlock() {
  if (asking) return;
  asking = true;
  setMessage('');
  try {
    const r = await NeonSecure.authenticate({ reason: 'Unlock Neon Drift' });
    if (r?.ok) hide(); else setMessage(r?.reason || 'Not unlocked.');
  } catch (e) {
    setMessage(e?.message || 'Not unlocked.');
  } finally {
    asking = false;
  }
}

async function signedIn() {
  const { data } = await supabase.auth.getSession();
  return !!data?.session;
}

function lockNow() {
  const label = KIND_LABEL[kind] || 'Face ID';
  document.getElementById('lockUnlockBtn').textContent = `Unlock with ${label}`;
  show(true);
  unlock();
}

// onLock(): pause whatever is running behind the lock screen.
export async function initAppLock({ onLock } = {}) {
  if (!hasSecureStore || !supabase) return;

  // Opaque from the first paint until we know whether to ask.
  show(false);

  document.getElementById('lockUnlockBtn').addEventListener('click', unlock);
  document.getElementById('lockPasswordBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    hide();
  });

  const [isIn, info] = await Promise.all([
    signedIn(),
    NeonSecure.biometry().catch(() => ({ available: false, kind: 'none' }))
  ]);
  kind = info?.available ? info.kind : 'none';
  if (isIn && kind !== 'none') lockNow(); else hide();

  // Back after five minutes away: ask again (also covers signing in later).
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (away < AWAY_MS || kind === 'none') return;
    if (!(await signedIn())) return;
    onLock?.();
    lockNow();
  });
}
