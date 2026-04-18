// ============================================================
// LEADERBOARD / TELEMETRY MODULE
// ============================================================
// Handles anonymous score submission, leaderboard fetch, and
// per-session telemetry (upgrade picks, wave progression).
// Gracefully degrades: if Supabase is unavailable, the game
// still plays normally — only network features are skipped.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let leaderboardEnabled = false;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
    leaderboardEnabled = true;
  } catch (e) {
    console.warn('Supabase init failed, running offline:', e);
  }
}

// ---- Anonymous identity ----
// Generate once, persist in localStorage. Not auth — just a stable ID
// so we can track "this player's best score" without requiring sign-up.
const ANON_ID_KEY = 'neon_drift_anon_id';
function getAnonId() {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = 'anon_' + crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

// ---- Display name ----
const NAME_KEY = 'neon_drift_display_name';
export function getDisplayName() {
  return localStorage.getItem(NAME_KEY) || '';
}
export function setDisplayName(name) {
  const sanitized = (name || '').trim().slice(0, 20);
  localStorage.setItem(NAME_KEY, sanitized);
  return sanitized;
}

// ---- Basic plausibility check ----
// Soft anti-cheat: reject impossible submissions client-side.
// Real determined cheaters can bypass this; the goal is to filter noise.
function isPlausibleScore(submission) {
  const { wave, score, bestCombo, cores } = submission;
  if (typeof wave !== 'number' || wave < 1 || wave > 500) return false;
  if (typeof score !== 'number' || score < 0) return false;
  if (typeof bestCombo !== 'number' || bestCombo < 0) return false;
  if (typeof cores !== 'number' || cores < 0) return false;
  // Score upper bound: unrealistic to get more than ~50k per wave on average
  if (score > wave * 50000) return false;
  // Combo bound: max multiplier is 5x, cap combo chain length at 10k
  if (bestCombo > 10000) return false;
  return true;
}

// ---- Submit score at end of run ----
export async function submitScore({ wave, score, bestCombo, cores, runDurationMs, upgrades }) {
  if (!leaderboardEnabled) return { success: false, reason: 'offline' };
  const submission = { wave, score, bestCombo, cores };
  if (!isPlausibleScore(submission)) {
    return { success: false, reason: 'implausible' };
  }
  try {
    const { error } = await supabase.from('scores').insert({
      anon_id: getAnonId(),
      display_name: getDisplayName() || null,
      wave,
      score,
      best_combo: bestCombo,
      cores,
      run_duration_ms: runDurationMs,
      upgrades_picked: upgrades || []
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

// ---- Fetch top N scores ----
export async function fetchLeaderboard(limit = 20) {
  if (!leaderboardEnabled) return [];
  try {
    const { data, error } = await supabase
      .from('scores')
      .select('display_name, wave, score, best_combo, created_at')
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

// ---- Fetch this player's best ----
export async function fetchMyBest() {
  if (!leaderboardEnabled) return null;
  try {
    const { data, error } = await supabase
      .from('scores')
      .select('wave, score, best_combo')
      .eq('anon_id', getAnonId())
      .order('score', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0];
  } catch (e) {
    return null;
  }
}

// ---- Global stats (total runs, record wave, etc) ----
export async function fetchGlobalStats() {
  if (!leaderboardEnabled) return null;
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
  return leaderboardEnabled;
}
