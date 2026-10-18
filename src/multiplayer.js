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
const gameEndListeners = new Set();
const upgradeChoicesListeners = new Set();
const wavePhaseListeners = new Set();
const fxListeners = new Set();

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
      slot: p.slot || 0,
      ship: p.ship || 'glide',
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

export function onGameEnd(fn) {
  gameEndListeners.add(fn);
  return () => gameEndListeners.delete(fn);
}

export function onUpgradeChoices(fn) {
  upgradeChoicesListeners.add(fn);
  return () => upgradeChoicesListeners.delete(fn);
}

export function onWavePhase(fn) {
  wavePhaseListeners.add(fn);
  return () => wavePhaseListeners.delete(fn);
}

// Cosmetic/audio event broadcasts from the server (enemy death,
// player hit, boss spawn). Pure feel — no gameplay impact.
export function onFx(fn) {
  fxListeners.add(fn);
  return () => fxListeners.delete(fn);
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
  room.onMessage('gameEnd', (msg) => {
    for (const fn of gameEndListeners) {
      try { fn(msg); } catch (e) { console.warn(e); }
    }
  });
  room.onMessage('upgradeChoices', (msg) => {
    for (const fn of upgradeChoicesListeners) {
      try { fn(msg); } catch (e) { console.warn(e); }
    }
  });
  room.onMessage('wavePhase', () => {
    for (const fn of wavePhaseListeners) {
      try { fn(); } catch (e) { console.warn(e); }
    }
  });
  room.onMessage('fx', (msg) => {
    for (const fn of fxListeners) {
      try { fn(msg); } catch (e) { console.warn(e); }
    }
  });
  emit();
}

// The local pilot's ship and color, sent when creating or joining a room and
// again whenever they change in the lobby.
let loadout = { ship: 'glide', color: 0 };
export function setLoadout(ship, color) {
  loadout = { ship, color };
  if (currentRoom && !currentRoom.state?.started) currentRoom.send('setLoadout', loadout);
}

// ---- Actions ----
export async function createRoom(name) {
  if (!client) return { error: { message: 'Multiplayer offline' } };
  if (currentRoom) return { error: { message: 'Already in a room' } };
  try {
    const room = await client.create('neondrift', { name: name || 'Pilot', ...loadout });
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
    const room = await client.joinById(match.roomId, { name: name || 'Pilot', ...loadout });
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

export function sendPickUpgrade(id) {
  currentRoom?.send('pickUpgrade', { id });
}

export function sendDash() {
  currentRoom?.send('dash');
}

// Phase 8b legacy: broadcast local player position. Phase 8c the server
// owns position, so this is a no-op when authoritative-sim is in play.
export function sendPlayerState(payload) {
  if (!currentRoom || !currentRoom.state?.started) return;
  currentRoom.send('playerState', payload);
}

// Phase 8c: send the current input snapshot to the server at ~30Hz.
// Server runs the sim and writes back authoritative positions/state.
export function sendInput(payload) {
  if (!currentRoom || !currentRoom.state?.started) return;
  currentRoom.send('input', payload);
}

// Snapshot of other players for rendering. Always reflects server state.
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
      maxHp: p.maxHp || 3,
      dead: p.dead,
      isHost: p.isHost,
      slot: p.slot || 0,
      ship: p.ship || 'glide',
      shieldUp: !!p.shieldUp,
      score: p.score || 0,
      droneCount: p.droneCount || 0
    });
  });
  return out;
}

// My own player state from the server (authoritative position, HP, dead).
export function getMyPlayer() {
  if (!currentRoom || !currentRoom.state) return null;
  return currentRoom.state.players.get(currentRoom.sessionId) || null;
}

export function getMyScore() {
  return getMyPlayer()?.score || 0;
}

export function getRemoteEnemies() {
  if (!currentRoom || !currentRoom.state) return [];
  const out = [];
  currentRoom.state.enemies.forEach((e, id) => {
    const parts = [];
    if (e.parts) e.parts.forEach((pt) => parts.push({ x: pt.x, y: pt.y, r: pt.r, a: pt.a }));
    out.push({
      id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, r: e.r,
      angle: e.angle || 0, phase: e.phase || 0, charge: e.charge || 0,
      intangible: !!e.intangible,
      // Sector bosses: art fields (BOSS_SYNC in shared/bosses.js), hitboxes,
      // shield, and which boss an add belongs to
      vals: e.vals ? Array.from(e.vals) : [],
      parts,
      shielded: !!e.shielded,
      owner: e.owner || ''
    });
  });
  return out;
}

// Sector hazards (shared/spaceSim.js), as plain objects.
export function getRemoteHazards() {
  if (!currentRoom || !currentRoom.state || !currentRoom.state.hazards) return [];
  const out = [];
  currentRoom.state.hazards.forEach((h, id) => out.push({ ...h.toJSON(), id }));
  return out;
}

// Boss lasers: position, aim, length, and how much telegraph is left.
export function getRemoteBeams() {
  if (!currentRoom || !currentRoom.state || !currentRoom.state.beams) return [];
  const out = [];
  currentRoom.state.beams.forEach((b, id) => {
    out.push({ id, x: b.x, y: b.y, angle: b.angle, len: b.len, width: b.width, warn: b.warn, warnMax: b.warnMax || 1, color: b.color, owner: b.owner });
  });
  return out;
}

// The wave's static cover, and an id that changes whenever it does.
export function getRemoteCover() {
  const st = currentRoom?.state;
  if (!st || !st.obstacles) return { mapId: -1, obstacles: [] };
  const obstacles = [];
  st.obstacles.forEach((o) => obstacles.push(o.toJSON()));
  return { mapId: st.mapId, obstacles };
}

// Hyperspace jump state: seconds left, where it's going, and which
// sector's sky is showing. `paused`: the server's sim is stopped for
// upgrade picks.
export function getWarp() {
  const st = currentRoom?.state;
  return { time: st?.warpTime || 0, to: st?.warpTo || 0, sectorWave: st?.sectorWave || 1, paused: !!st?.paused };
}

export function getRemoteProjectiles() {
  if (!currentRoom || !currentRoom.state) return [];
  const out = [];
  currentRoom.state.projectiles.forEach((p, id) => {
    out.push({
      id, x: p.x, y: p.y, r: p.r, ownerType: p.ownerType,
      vx: p.vx || 0, vy: p.vy || 0, color: p.color || '', crit: !!p.crit,
      owner: p.owner ?? -1, kind: p.kind || 'orb', hold: p.hold || 0
    });
  });
  return out;
}

export function getRemotePickups() {
  if (!currentRoom || !currentRoom.state || !currentRoom.state.pickups) return [];
  const out = [];
  currentRoom.state.pickups.forEach((p, id) => {
    out.push({ id, x: p.x, y: p.y, r: p.r, value: p.value });
  });
  return out;
}

export function getRoomTotalScore() {
  return currentRoom?.state?.totalScore || 0;
}

export function isGameOver() {
  return !!currentRoom?.state?.gameOver;
}

// Fusion state: shared meter (0..1), seconds left while fused, and who drives.
export function getFusion() {
  const st = currentRoom?.state;
  return {
    meter: st?.fusionMeter || 0,
    time: st?.fusionTime || 0,
    driver: st?.fusionDriver || '',
    mySession: currentRoom?.sessionId || ''
  };
}

export function getRoomWaveNum() {
  return currentRoom?.state?.waveNum || 0;
}

export function getWorldDims() {
  return {
    w: currentRoom?.state?.worldW || 1280,
    h: currentRoom?.state?.worldH || 720
  };
}

export function isRunInRoom() {
  return !!(currentRoom && currentRoom.state?.started);
}

// Dev builds only: lets play-tests drive the server's test hooks
// (devWave, devGod, devKill), which the server only accepts with NEON_DEV=1.
if (import.meta.env.DEV) {
  window.__ndmp = { send: (type, payload) => currentRoom?.send(type, payload) };
}
