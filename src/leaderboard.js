// ============================================================
// LEADERBOARD / TELEMETRY MODULE
// ============================================================
// Anonymous-or-authenticated score submission and leaderboard fetch.
// When signed in, scores are attributed to user_id (and display_name is
// snapshotted from the profile so renames don't rewrite history).
// Falls back to anon_id if not signed in. Game still plays offline.
// ============================================================

import { supabase, online } from './supabaseClient.js';
import { getSession, getProfile } from './auth.js';

// ---- Anonymous device identity ----
// Stable per-browser ID. Kept even after sign-in so we can union signed-in
// scores with this device's earlier anon scores when showing personal bests.
const ANON_ID_KEY = 'neon_drift_anon_id';
function getAnonId() {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = 'anon_' + crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

// ---- Anonymous display name (used when not signed in) ----
const NAME_KEY = 'neon_drift_display_name';
export function getDisplayName() {
  return localStorage.getItem(NAME_KEY) || '';
}
export function setDisplayName(name) {
  const sanitized = (name || '').trim().slice(0, 20);
  localStorage.setItem(NAME_KEY, sanitized);
  return sanitized;
}

// ---- Plausibility check (mirrors the DB CHECK constraints) ----
function isPlausibleScore(submission) {
  const { wave, score, bestCombo, cores } = submission;
  if (typeof wave !== 'number' || wave < 1 || wave > 500) return false;
  if (typeof score !== 'number' || score < 0) return false;
  if (typeof bestCombo !== 'number' || bestCombo < 0) return false;
  if (typeof cores !== 'number' || cores < 0) return false;
  if (score > wave * 50000) return false;
  if (bestCombo > 10000) return false;
  return true;
}

// ---- Submit run results ----
export async function submitScore({ wave, score, bestCombo, cores, runDurationMs, upgrades, challengeWeek }) {
  if (!online) return { success: false, reason: 'offline' };
  if (!isPlausibleScore({ wave, score, bestCombo, cores })) {
    return { success: false, reason: 'implausible' };
  }
  const session = getSession();
  const profile = getProfile();
  const userId = session?.user?.id || null;
  // Snapshot the name at submit-time so leaderboard history is stable across renames.
  const displayName = userId
    ? (profile?.display_name || null)
    : (getDisplayName() || null);

  try {
    const { error } = await supabase.from('scores').insert({
      user_id: userId,
      anon_id: getAnonId(),
      display_name: displayName,
      wave,
      score,
      best_combo: bestCombo,
      cores,
      run_duration_ms: runDurationMs,
      upgrades_picked: upgrades || [],
      challenge_week: challengeWeek || null
    });
    if (error) {
      console.warn('Score submission failed:', error);
      return { success: false, reason: 'db_error' };
    }
    return { success: true };
  } catch (e) {
    console.warn('Score submission threw:', e);
    return { success: false, reason: 'network' };
  }
}

// ---- Top N global scores ----
export async function fetchLeaderboard(limit = 20) {
  if (!online) return [];
  try {
    const { data, error } = await supabase
      .from('scores')
      .select('display_name, wave, score, best_combo, created_at, user_id')
      .order('score', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('Leaderboard fetch failed:', error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('Leaderboard fetch threw:', e);
    return [];
  }
}

// ---- Personal best ----
// Signed-in: union of scores attributed to user_id OR to this device's anon_id
// (so pre-signin runs still count). Anon: just this device.
export async function fetchMyBest() {
  if (!online) return null;
  const userId = getSession()?.user?.id;
  const anonId = getAnonId();
  try {
    let query = supabase
      .from('scores')
      .select('wave, score, best_combo')
      .order('score', { ascending: false })
      .limit(1);
    if (userId) {
      query = query.or(`user_id.eq.${userId},anon_id.eq.${anonId}`);
    } else {
      query = query.eq('anon_id', anonId);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    return data[0];
  } catch (e) {
    return null;
  }
}

// ---- Global aggregates for title screen ----
export async function fetchGlobalStats() {
  if (!online) return null;
  try {
    const { data, error } = await supabase
      .from('global_stats_view')
      .select('*')
      .single();
    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function isLeaderboardEnabled() {
  return online;
}
