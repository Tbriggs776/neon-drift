// ============================================================
// MULTIPLAYER (Colyseus client)
// ============================================================
// Phase 8a: lobby only. Create room (server generates code), join
// by code, player list, ready-up, host can start. `gameStart` message
// carries the shared seed so every client runs the same seeded
// simulation. Ship-position sync and server-authoritative sim come
// later (Phase 8b/8c).
// ============================================================

import { Client } from 'colyseus.js';

const URL = import.meta.env.VITE_COLYSEUS_URL;
let client = null;
let currentRoom = null;

if (URL) {
  try { client = new Client(URL); } catch (e) { console.warn('Colyseus init failed:', e); }
}

export const multiplayerEnabled = !!client;
export function isInRoom() { return !!currentRoom; }
export function getCurrentRoom() { return currentRoom; }

// ---- State snapshot + listeners ----
const listeners = new Set();
const gameStartListeners = new Set();

function snapshot() {
  if (!currentRoom || !currentRoom.state) {
    return { inRoom: false, code: '', players: [], isHost: false, started: false };
  }
  const mySession = currentRoom.sessionId;
  const players = [];
  currentRoom.state.players.forEach((p, sid) => {
    players.push({
      sessionId: sid,
      name: p.name,
      ready: p.ready,
      isHost: p.isHost,
      isMe: sid === mySession
    });
  });
  const me = currentRoom.state.players.get(mySession);
  return {
    inRoom: true,
    code: currentRoom.state.code || '',
    players,
    isHost: !!me?.isHost,
    started: !!currentRoom.state.started,
    seed: currentRoom.state.seed || 0
  };
}
function emit() {
  const s = snapshot();
  for (const fn of listeners) { try { fn(s); } catch (e) { console.warn(e); } }
}
export function onMultiplayerChange(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}
export function onGameStart(fn) {
  gameStartListeners.add(fn);
  return () => gameStartListeners.delete(fn);
}

function wireRoom(room) {
  currentRoom = room;
  room.onStateChange(() => emit());
  room.onLeave(() => {
    if (currentRoom === room) {
      currentRoom = null;
      emit();
    }
  });
  room.onError((code, msg) => {
    console.warn('Room error:', code, msg);
  });
  room.onMessage('gameStart', (msg) => {
    for (const fn of gameStartListeners) {
      try { fn(msg); } catch (e) { console.warn(e); }
    }
  });
  emit();
}

// ---- Actions ----
export async function createRoom(name) {
  if (!client) return { error: { message: 'Multiplayer offline' } };
  if (currentRoom) return { error: { message: 'Already in a room' } };
  try {
    const room = await client.create('neondrift', { name: name || 'Pilot' });
    wireRoom(room);
    return { room };
  } catch (e) {
    return { error: { message: e?.message || 'Create failed' } };
  }
}

export async function joinRoomByCode(code, name) {
  if (!client) return { error: { message: 'Multiplayer offline' } };
  if (currentRoom) return { error: { message: 'Already in a room' } };
  const target = String(code || '').trim().toUpperCase();
  if (target.length !== 6) return { error: { message: 'Code must be 6 characters' } };
  try {
    const rooms = await client.getAvailableRooms('neondrift');
    const match = rooms.find((r) => r.metadata && r.metadata.code === target);
    if (!match) return { error: { message: 'Room not found' } };
    const room = await client.joinById(match.roomId, { name: name || 'Pilot' });
    wireRoom(room);
    return { room };
  } catch (e) {
    return { error: { message: e?.message || 'Join failed' } };
  }
}

export async function leaveRoom() {
  if (!currentRoom) return;
  try { await currentRoom.leave(); } catch (e) { /* ignore */ }
  currentRoom = null;
  emit();
}

export function sendSetReady(ready) {
  currentRoom?.send('setReady', !!ready);
}

export function sendStart() {
  currentRoom?.send('start');
}

// Broadcast the local player's state to the room. Called at ~20Hz from the
// game loop while in a started multiplayer run.
export function sendPlayerState(payload) {
  if (!currentRoom || !currentRoom.state?.started) return;
  currentRoom.send('playerState', payload);
}

// Snapshot of other players' positions for the renderer to draw.
// Returns array of { sessionId, name, x, y, angle, hp, dead, isHost }
export function getRemotePlayers() {
  if (!currentRoom || !currentRoom.state) return [];
  const me = currentRoom.sessionId;
  const out = [];
  currentRoom.state.players.forEach((p, sid) => {
    if (sid === me) return;
    out.push({
      sessionId: sid,
      name: p.name,
      x: p.x, y: p.y,
      angle: p.angle,
      hp: p.hp,
      dead: p.dead,
      isHost: p.isHost
    });
  });
  return out;
}

export function isRunInRoom() {
  return !!(currentRoom && currentRoom.state?.started);
}
