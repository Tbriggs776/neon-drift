// ============================================================
// WEEKLY CHALLENGES
// ============================================================
// Every week (Monday UTC -> Sunday UTC), all players play the same
// seeded run. The seed is derived deterministically from the week
// start date — no DB round-trip required to pick it. Scores for
// challenge runs are tagged with their `challenge_week` column so
// a weekly leaderboard can filter cleanly.
// ============================================================

import { supabase, online } from './supabaseClient.js';

// Monday of the current ISO week in UTC, as YYYY-MM-DD.
export function getCurrentChallengeWeek() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday
  ));
  return monday.toISOString().slice(0, 10);
}

// Deterministic per-week seed string. rng.js accepts strings directly.
export function getCurrentChallengeSeed() {
  return 'challenge-' + getCurrentChallengeWeek();
}

export async function fetchChallengeLeaderboard(week, limit = 20) {
  if (!online) return [];
  const targetWeek = week || getCurrentChallengeWeek();
  try {
    const { data, error } = await supabase
      .from('scores')
      .select('display_name, wave, score, best_combo, created_at, user_id')
      .eq('challenge_week', targetWeek)
      .order('score', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}
