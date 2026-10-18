// ============================================================
// WEEKLY CHALLENGES
// ============================================================
// Every week (Monday UTC -> Sunday UTC), all players play the same
// seeded run. The seed is derived deterministically from the week
// start date — no DB round-trip required to pick it. Scores for
// challenge runs are tagged with their `challenge_week` column so
// a weekly leaderboard can filter cleanly.
// ============================================================

import { supabase, online, isOffline } from './supabaseClient.js';

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

export function getPreviousChallengeWeek() {
  const d = new Date(getCurrentChallengeWeek() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// "Oct 19" for a YYYY-MM-DD week. Read in UTC: a bare date parses as UTC
// midnight, which local time zones west of UTC would show as the day before.
export function formatChallengeWeek(week) {
  return new Date(week + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Every run of the week, best first, kept to each pilot's best (signed-in
// pilots by account, guests by device).
async function fetchWeekBests(week) {
  const { data, error } = await supabase
    .from('scores')
    .select('display_name, wave, score, best_combo, created_at, user_id, anon_id')
    .eq('challenge_week', week)
    .order('score', { ascending: false })
    .limit(1000);
  if (error) return null;
  const seen = new Set();
  return (data || []).filter((r) => {
    const who = r.user_id || r.anon_id || r.display_name || r.created_at;
    if (seen.has(who)) return false;
    seen.add(who);
    return true;
  });
}

export async function fetchChallengeLeaderboard(week, limit = 20) {
  if (!online || isOffline()) return [];
  try {
    const rows = await fetchWeekBests(week || getCurrentChallengeWeek());
    return rows ? rows.slice(0, limit) : [];
  } catch (e) {
    return [];
  }
}

// Where `score` places among the week's pilots: { rank, total }, or null.
export async function fetchChallengeStanding(week, score) {
  if (!online || isOffline()) return null;
  try {
    const rows = await fetchWeekBests(week);
    if (!rows) return null;
    const ahead = rows.filter((r) => r.score > score).length;
    return { rank: ahead + 1, total: Math.max(rows.length, ahead + 1) };
  } catch (e) {
    return null;
  }
}
