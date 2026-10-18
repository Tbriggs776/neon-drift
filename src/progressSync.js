// ============================================================
// PROGRESS SYNC — cloud save for signed-in pilots.
// ============================================================
// The game always saves to localStorage first (game.js saveMeta). When a
// pilot is signed in, this module mirrors that save to the
// player_progress table (supabase/phase10_progress_sync.sql) so the same
// level, ships, Hangar upgrades and cores show up on every device.
//
// On sign-in the local and cloud saves are merged:
// - Progress only grows, so XP, run count, personal bests and Hangar
//   upgrade levels take the higher of the two. Nothing earned is lost.
// - Banked cores, the chosen ship and the chosen color are spent or
//   changed, so they come from whichever save is newer (savedAt). The first
//   time a device links to an account it keeps the higher core count.
// ============================================================

import { supabase, online } from './supabaseClient.js';

const PUSH_DELAY_MS = 1500;
const GROWING_FIELDS = ['xp', 'totalRuns', 'totalVictories', 'bestScore', 'bestCombo', 'bestWave'];

let userId = null;
let pushTimer = null;
let pendingMeta = null;

export function mergeProgress(local, cloud, firstLink) {
  const merged = JSON.parse(JSON.stringify(local));
  for (const k of GROWING_FIELDS) {
    merged[k] = Math.max(Number(local[k]) || 0, Number(cloud[k]) || 0);
  }
  for (const [k, node] of Object.entries(merged.nodes || {})) {
    const cloudLevel = Number(cloud.nodes?.[k]?.level) || 0;
    node.level = Math.min(node.max ?? Infinity, Math.max(node.level || 0, cloudLevel));
  }
  const cloudNewer = (Number(cloud.savedAt) || 0) > (Number(local.savedAt) || 0);
  merged.savedAt = Math.max(Number(local.savedAt) || 0, Number(cloud.savedAt) || 0);
  if (firstLink) {
    merged.bankedCores = Math.max(Number(local.bankedCores) || 0, Number(cloud.bankedCores) || 0);
  } else if (cloudNewer) {
    merged.bankedCores = Number(cloud.bankedCores) || 0;
  }
  if (cloudNewer) {
    if (cloud.ship) merged.ship = cloud.ship;
    if (Number.isInteger(cloud.color)) merged.color = cloud.color;
  }
  return merged;
}

// Called when the signed-in user changes. Returns the merged save to use
// locally (or null when there's nothing to merge), and remembers the user
// so later saves are pushed to their row.
export async function linkProgress(newUserId, localMeta) {
  userId = newUserId || null;
  if (!online || !userId) return null;
  const { data, error } = await supabase
    .from('player_progress')
    .select('progress')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('Progress load failed:', error);
    return null;
  }
  const firstLink = localMeta.syncedUser !== userId;
  const merged = data?.progress
    ? mergeProgress(localMeta, data.progress, firstLink)
    : JSON.parse(JSON.stringify(localMeta));
  merged.syncedUser = userId;
  await pushNow(merged);
  return merged;
}

// Debounced mirror of a local save. A no-op when signed out.
export function queueProgressPush(meta) {
  if (!online || !userId) return;
  pendingMeta = meta;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow(pendingMeta); }, PUSH_DELAY_MS);
}

async function pushNow(meta) {
  if (!online || !userId || !meta) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  let error = null;
  try {
    ({ error } = await supabase
      .from('player_progress')
      .upsert({ user_id: userId, progress: meta, updated_at: new Date().toISOString() }));
  } catch (e) {
    error = e;
  }
  // Offline or a dropped connection: keep it and try again on reconnect.
  unsentMeta = error ? meta : null;
  if (error && navigator.onLine !== false) console.warn('Progress save failed:', error);
}

// Saves made with no connection go up as soon as the device is back online.
let unsentMeta = null;
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (unsentMeta) pushNow(pendingMeta || unsentMeta);
  });
}

// Send any waiting save right away (the page is being hidden or closed).
export function flushProgressPush() {
  if (pendingMeta && pushTimer) pushNow(pendingMeta);
}
