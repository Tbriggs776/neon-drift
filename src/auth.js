// ============================================================
// AUTH MODULE
// ============================================================
// Magic-link email sign-in via Supabase Auth.
// Holds the current session + cached profile and notifies listeners on change.
// ============================================================

import { supabase, online } from './supabaseClient.js';
import { isNative, AUTH_REDIRECT_URL } from './native.js';

let currentSession = null;
let currentProfile = null;
let initPromise = null;
let recoveryMode = false; // true when the user arrived via a password-reset link
const listeners = new Set();
const recoveryListeners = new Set();

function emit() {
  const snapshot = { session: currentSession, profile: currentProfile };
  for (const fn of listeners) {
    try { fn(snapshot); } catch (e) { console.warn('auth listener threw:', e); }
  }
}
function emitRecovery() {
  for (const fn of recoveryListeners) {
    try { fn(recoveryMode); } catch (e) { console.warn('recovery listener threw:', e); }
  }
}

export function onAuthChange(fn) {
  listeners.add(fn);
  fn({ session: currentSession, profile: currentProfile });
  return () => listeners.delete(fn);
}

export function onRecoveryMode(fn) {
  recoveryListeners.add(fn);
  fn(recoveryMode);
  return () => recoveryListeners.delete(fn);
}

export function isInRecoveryMode() { return recoveryMode; }

export function getSession() { return currentSession; }
export function getProfile() { return currentProfile; }
export function isSignedIn() { return !!currentSession?.user?.id; }

async function loadProfile(userId) {
  if (!userId) { currentProfile = null; return; }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Profile load failed:', error);
      currentProfile = null;
    } else {
      currentProfile = data || null;
    }
  } catch (e) {
    console.warn('Profile load threw:', e);
    currentProfile = null;
  }
}

// Safe to call more than once; every caller gets the same startup promise.
export function initAuth() {
  if (!online) return Promise.resolve();
  if (!initPromise) initPromise = startAuth();
  return initPromise;
}

async function startAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  if (session?.user?.id) await loadProfile(session.user.id);
  emit();

  supabase.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;
    if (session?.user?.id) {
      await loadProfile(session.user.id);
    } else {
      currentProfile = null;
    }
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      emitRecovery();
    }
    emit();
  });
}

export async function requestPasswordReset(email) {
  if (!online) return { error: { message: 'Leaderboard offline' } };
  const cleaned = (email || '').trim().toLowerCase();
  if (!cleaned || !cleaned.includes('@') || cleaned.length > 254) {
    return { error: { message: 'Enter a valid email' } };
  }
  // The apps have no web origin to return to (capacitor://localhost), so the
  // email link opens the app through its URL scheme instead.
  const { error } = await supabase.auth.resetPasswordForEmail(cleaned, {
    redirectTo: isNative ? AUTH_REDIRECT_URL : window.location.origin + window.location.pathname
  });
  return { error };
}

// Native apps receive auth links as com.tylerbriggs.neondrift://auth with the
// tokens in the hash (implicit flow) or a ?code= (PKCE). The browser build
// gets the same thing from detectSessionInUrl instead.
export async function handleAuthDeepLink(url) {
  if (!online || !url || !url.startsWith(AUTH_REDIRECT_URL)) return;
  await initAuth();
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  parsed.searchParams.forEach((v, k) => { if (!params.has(k)) params.set(k, v); });

  if (params.get('error_description')) {
    console.warn('Auth link error:', params.get('error_description'));
    return;
  }
  let error = null;
  if (params.get('code')) {
    ({ error } = await supabase.auth.exchangeCodeForSession(params.get('code')));
  } else if (params.get('access_token') && params.get('refresh_token')) {
    ({ error } = await supabase.auth.setSession({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token')
    }));
  } else {
    return;
  }
  if (error) {
    console.warn('Auth deep link failed:', error);
    return;
  }
  // setSession reports SIGNED_IN, not PASSWORD_RECOVERY, so flag it here.
  if (params.get('type') === 'recovery') {
    recoveryMode = true;
    emitRecovery();
  }
}

export async function updatePassword(newPassword) {
  if (!online) return { error: { message: 'Leaderboard offline' } };
  if (!newPassword || newPassword.length < 6) {
    return { error: { message: 'Password must be at least 6 characters' } };
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (!error) {
    recoveryMode = false;
    emitRecovery();
  }
  return { error };
}

function validateCreds(email, password) {
  const cleaned = (email || '').trim().toLowerCase();
  if (!cleaned || !cleaned.includes('@') || cleaned.length > 254) {
    return { error: { message: 'Enter a valid email' } };
  }
  if (!password || password.length < 6) {
    return { error: { message: 'Password must be at least 6 characters' } };
  }
  return { email: cleaned, password };
}

export async function signInWithPassword(email, password) {
  if (!online) return { error: { message: 'Leaderboard offline' } };
  const v = validateCreds(email, password);
  if (v.error) return v;
  const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
  return { error };
}

export async function signUpWithPassword(email, password) {
  if (!online) return { error: { message: 'Leaderboard offline' } };
  const v = validateCreds(email, password);
  if (v.error) return v;
  const { error } = await supabase.auth.signUp({ email: v.email, password: v.password });
  return { error };
}

export async function signOut() {
  if (!online) return;
  await supabase.auth.signOut();
}

// Permanently deletes the signed-in account (supabase/phase9_account_deletion.sql),
// then clears the local session. The server session is already gone, so only
// a local sign-out is needed.
export async function deleteAccount() {
  if (!isSignedIn()) return { error: { message: 'Not signed in' } };
  const { error } = await supabase.rpc('delete_my_account');
  if (error) return { error };
  await supabase.auth.signOut({ scope: 'local' });
  return { error: null };
}

export async function setProfileDisplayName(name) {
  if (!isSignedIn()) return { error: { message: 'Not signed in' } };
  const trimmed = (name || '').trim().slice(0, 20);
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed || null, updated_at: new Date().toISOString() })
    .eq('id', currentSession.user.id)
    .select('id, display_name')
    .maybeSingle();
  if (!error) {
    currentProfile = data;
    emit();
  }
  return { error };
}
