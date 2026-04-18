// ============================================================
// FRIENDS MODULE
// ============================================================
// Search profiles by display_name, send/accept/cancel friend requests,
// and pull a friends-only leaderboard slice.
// All writes go through RLS — see supabase/phase5_friends.sql.
// ============================================================

import { supabase, online } from './supabaseClient.js';
import { getSession } from './auth.js';

function meId() { return getSession()?.user?.id || null; }

// ---- Search profiles by display name (case-insensitive partial match) ----
export async function searchUsers(query) {
  if (!online) return [];
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const me = meId();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .ilike('display_name', `%${q.slice(0, 30)}%`)
      .not('display_name', 'is', null)
      .limit(20);
    if (error) { console.warn('searchUsers failed:', error); return []; }
    return (data || []).filter(p => p.id !== me);
  } catch (e) {
    console.warn('searchUsers threw:', e);
    return [];
  }
}

// ---- Send a request ----
export async function sendFriendRequest(recipientId) {
  if (!online) return { error: { message: 'Offline' } };
  const me = meId();
  if (!me) return { error: { message: 'Not signed in' } };
  if (me === recipientId) return { error: { message: "Can't friend yourself" } };
  const { error } = await supabase.from('friendships').insert({
    requester_id: me,
    recipient_id: recipientId,
    status: 'pending'
  });
  return { error };
}

// ---- Recipient accepts a pending request ----
export async function acceptFriendRequest(friendshipId) {
  if (!online) return { error: { message: 'Offline' } };
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);
  return { error };
}

// ---- Either party deletes (decline / cancel / unfriend) ----
export async function removeFriendship(friendshipId) {
  if (!online) return { error: { message: 'Offline' } };
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  return { error };
}

// ---- All friendships involving me, split into buckets and enriched with names ----
export async function fetchMyFriendships() {
  const empty = { incoming: [], outgoing: [], friends: [] };
  if (!online) return empty;
  const me = meId();
  if (!me) return empty;

  try {
    const { data, error } = await supabase
      .from('friendships')
      .select('id, requester_id, recipient_id, status, created_at, accepted_at');
    if (error) {
      console.warn('fetchMyFriendships failed:', error);
      return empty;
    }
    const rows = data || [];

    // Bulk-fetch the "other party" display names so we can render in one pass.
    const otherIds = new Set();
    for (const r of rows) {
      otherIds.add(r.requester_id === me ? r.recipient_id : r.requester_id);
    }
    const nameMap = new Map();
    if (otherIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', [...otherIds]);
      for (const p of profiles || []) nameMap.set(p.id, p.display_name);
    }

    const incoming = [], outgoing = [], friends = [];
    for (const r of rows) {
      const otherId = r.requester_id === me ? r.recipient_id : r.requester_id;
      const enriched = { ...r, otherId, displayName: nameMap.get(otherId) || '(unnamed pilot)' };
      if (r.status === 'accepted') friends.push(enriched);
      else if (r.recipient_id === me) incoming.push(enriched);
      else outgoing.push(enriched);
    }
    return { incoming, outgoing, friends };
  } catch (e) {
    console.warn('fetchMyFriendships threw:', e);
    return empty;
  }
}

// ---- Top scores from me + my accepted friends ----
export async function fetchFriendsLeaderboard(limit = 20) {
  if (!online) return [];
  const me = meId();
  if (!me) return [];
  try {
    const { data: friendships, error: fErr } = await supabase
      .from('friendships')
      .select('requester_id, recipient_id')
      .eq('status', 'accepted');
    if (fErr) return [];
    const ids = new Set([me]);
    for (const f of friendships || []) {
      ids.add(f.requester_id);
      ids.add(f.recipient_id);
    }
    const { data, error } = await supabase
      .from('scores')
      .select('display_name, wave, score, best_combo, created_at, user_id')
      .in('user_id', [...ids])
      .order('score', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}
