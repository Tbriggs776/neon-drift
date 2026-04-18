// ============================================================
// AUTH MODULE
// ============================================================
// Magic-link email sign-in via Supabase Auth.
// Holds the current session + cached profile and notifies listeners on change.
// ============================================================

import { supabase, online } from './supabaseClient.js';

let currentSession = null;
let currentProfile = null;
let initialized = false;
const listeners = new Set();

function emit() {
  const snapshot = { session: currentSession, profile: currentProfile };
  for (const fn of listeners) {
    try { fn(snapshot); } catch (e) { console.warn('auth listener threw:', e); }
  }
}

export function onAuthChange(fn) {
  listeners.add(fn);
  fn({ session: currentSession, profile: currentProfile });
  return () => listeners.delete(fn);
}

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

export async function initAuth() {
  if (initialized || !online) return;
  initialized = true;

  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  if (session?.user?.id) await loadProfile(session.user.id);
  emit();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    if (session?.user?.id) {
      await loadProfile(session.user.id);
    } else {
      currentProfile = null;
    }
    emit();
  });
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
