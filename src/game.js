import './styles.css';
import { setRandomSeed, gameRand, getCurrentSeed, makeRng } from './rng.js';
import {
  submitScore,
  fetchLeaderboard,
  fetchMyBest,
  fetchGlobalStats,
  getDisplayName,
  setDisplayName,
  isLeaderboardEnabled,
  flushPendingScores
} from './leaderboard.js';
import { isOffline } from './supabaseClient.js';
import {
  initAuth,
  onAuthChange,
  onRecoveryMode,
  signInWithPassword,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
  signOut,
  deleteAccount,
  setProfileDisplayName,
  isSignedIn,
  getSession,
  getProfile,
  handleAuthDeepLink
} from './auth.js';
import {
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  fetchMyFriendships,
  fetchFriendsLeaderboard
} from './friends.js';
import {
  getCurrentChallengeWeek,
  getCurrentChallengeSeed,
  getPreviousChallengeWeek,
  formatChallengeWeek,
  fetchChallengeLeaderboard,
  fetchChallengeStanding
} from './challenges.js';
import { weeklyChallenge, weeklySectorForWave, TWISTS, RULES } from './weekly.js';
import {
  multiplayerEnabled,
  onMultiplayerChange,
  onGameStart,
  onGameEnd,
  onUpgradeChoices,
  onWavePhase,
  onFx,
  createRoom,
  joinRoomByCode,
  leaveRoom,
  sendSetReady,
  sendStart,
  sendPickUpgrade,
  sendDash,
  sendPlayerState,
  sendInput,
  getRemotePlayers,
  getRemoteEnemies,
  getRemoteProjectiles,
  getRemotePickups,
  getRoomTotalScore,
  getMyPlayer,
  getMyScore,
  getRoomWaveNum,
  getWorldDims,
  isRunInRoom,
  getFusion,
  getCurrentRoom,
  setLoadout,
  getRemoteHazards,
  getRemoteBeams,
  getRemoteCover,
  getWarp
} from './multiplayer.js';
import { initMenuNav, navGamepadFrame } from './menuNav.js';
import { initNative } from './native.js';
import { initAppLock } from './appLock.js';
import { SHIPS, PILOT_COLORS, PILOT_COLOR_NAMES, getShip, drawShipModel, shipGuns } from './ships.js';
import { linkProgress, queueProgressPush, flushProgressPush } from './progressSync.js';
import { SECTORS, WAVES_PER_SECTOR, sectorForWave, loopSuffix } from '../shared/sectors.js';
import { drawSpaceBackdrop, drawWarp, rgba } from './backdrop.js';
import {
  makeRockSprite, drawRock, makePanelSprite, drawPanel,
  drawMine, drawWell, drawComet, drawFlare, drawStrike, drawPulse, drawGate
} from './spaceArt.js';
import { SPACE_BOSS_DEFS, MINION_DEFS, BOSS_TITLES, updateSpaceEnemy, unpackBossSync, singularityPull } from '../shared/bosses.js';
import {
  segDist, insideObstacle, resolveMove, segmentHitsObstacle as pathHitsObstacle, wrapPosition, freeSpot,
  generateCover, rockRadius, setupHazards as simSetupHazards, spawnHazard as simSpawnHazard,
  updateHazards as simUpdateHazards, removeHazard as simRemoveHazard, hazardHitByShot, hazardBlocksShot,
  damageHazard, applyWellGravity, pullShip, advanceShot, burstRing
} from '../shared/spaceSim.js';
import { drawSpaceEnemy, drawBeam } from './bossArt.js';


// ============================================================
// CORE SETUP
// ============================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ============================================================
// EMBEDDED AUDIO (base64 MP3 data)
// ============================================================
const AUDIO_DATA = {
  bgm:       '/audio/bgm.mp3',
  shoot:     '/audio/shoot.mp3',
  explosion: '/audio/explosion.mp3',
  bosswarn:  '/audio/bosswarn.mp3'
};

// Audio pool - multiple instances for rapid-fire sounds like shooting
const AUDIO_POOL = {};
function initAudio() {
  // Shoot sound needs a pool since it fires rapidly
  AUDIO_POOL.shoot = [];
  for (let i = 0; i < 6; i++) {
    const a = new Audio(AUDIO_DATA.shoot);
    a.volume = 0.25;
    AUDIO_POOL.shoot.push(a);
  }
  AUDIO_POOL.shootIdx = 0;
  AUDIO_POOL.explosion = new Audio(AUDIO_DATA.explosion);
  AUDIO_POOL.explosion.volume = 0.55;
  AUDIO_POOL.bosswarn = new Audio(AUDIO_DATA.bosswarn);
  AUDIO_POOL.bosswarn.volume = 0.6;
  // Background music: looping, quieter than SFX so it doesn't interrupt gameplay audio
  AUDIO_POOL.bgm = new Audio(AUDIO_DATA.bgm);
  AUDIO_POOL.bgm.loop = true;
  AUDIO_POOL.bgm.volume = 0.18;  // ~75% of mean SFX volume; sits under effects
}

function playSound(name) {
  try {
    if (!AUDIO_POOL.shoot) initAudio();
    if (name === 'shoot') {
      const a = AUDIO_POOL.shoot[AUDIO_POOL.shootIdx];
      AUDIO_POOL.shootIdx = (AUDIO_POOL.shootIdx + 1) % AUDIO_POOL.shoot.length;
      a.currentTime = 0;
      a.play().catch(() => {});
    } else if (name === 'explosion') {
      AUDIO_POOL.explosion.currentTime = 0;
      AUDIO_POOL.explosion.play().catch(() => {});
    } else if (name === 'bosswarn') {
      AUDIO_POOL.bosswarn.currentTime = 0;
      AUDIO_POOL.bosswarn.play().catch(() => {});
    }
  } catch (e) {}
}

function startBGM() {
  try {
    if (!AUDIO_POOL.bgm) initAudio();
    if (AUDIO_POOL.bgm.paused) {
      AUDIO_POOL.bgm.currentTime = 0;
      AUDIO_POOL.bgm.play().catch(() => {});
    }
  } catch (e) {}
}

function stopBGM() {
  try {
    if (AUDIO_POOL.bgm && !AUDIO_POOL.bgm.paused) {
      AUDIO_POOL.bgm.pause();
    }
  } catch (e) {}
}

function pauseBGM() {
  try {
    if (AUDIO_POOL.bgm && !AUDIO_POOL.bgm.paused) {
      AUDIO_POOL.bgm.pause();
    }
  } catch (e) {}
}

function resumeBGM() {
  try {
    if (AUDIO_POOL.bgm && AUDIO_POOL.bgm.paused) {
      AUDIO_POOL.bgm.play().catch(() => {});
    }
  } catch (e) {}
}

// iOS Safari requires audio elements to be touched by a user gesture before
// they can be played programmatically. Prime them on the first interaction.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (!AUDIO_POOL.shoot) initAudio();
  const all = [
    ...AUDIO_POOL.shoot,
    AUDIO_POOL.explosion,
    AUDIO_POOL.bosswarn,
    AUDIO_POOL.bgm
  ];
  for (const a of all) {
    a.muted = true;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
        .catch(() => { a.muted = false; });
    } else {
      a.muted = false;
    }
  }
}
window.addEventListener('touchstart', unlockAudio, { once: true, capture: true });
window.addEventListener('mousedown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });


const STORAGE_KEY = 'neon_drift_meta_v1';

// ============================================================
// META PROGRESSION (persistent across runs)
// ============================================================
const META_DEFAULTS = {
  bankedCores: 0,
  xp: 0,             // pilot XP; the level unlocks ships
  ship: 'glide',     // chosen ship id (ships.js)
  color: 0,          // chosen pilot color index (PILOT_COLORS)
  totalRuns: 0,
  totalVictories: 0,
  bestScore: 0,
  bestCombo: 0,
  bestWave: 0,
  nodes: {
    hull:      { level: 0, max: 8, costBase: 8,  costMul: 1.45 },
    damage:    { level: 0, max: 8, costBase: 10, costMul: 1.45 },
    fireRate:  { level: 0, max: 8, costBase: 10, costMul: 1.45 },
    dashCD:    { level: 0, max: 5, costBase: 15, costMul: 1.7 },
    startCore: { level: 0, max: 3, costBase: 20, costMul: 2.0 },
    magnet:    { level: 0, max: 5, costBase: 12, costMul: 1.6 },
    crit:      { level: 0, max: 5, costBase: 18, costMul: 1.7 },
    pierce:    { level: 0, max: 3, costBase: 30, costMul: 2.2 },
    luck:      { level: 0, max: 5, costBase: 22, costMul: 1.7 },
    regen:     { level: 0, max: 3, costBase: 35, costMul: 2.3 },
    startBank: { level: 0, max: 5, costBase: 15, costMul: 1.8 },
    combo:     { level: 0, max: 5, costBase: 20, costMul: 1.7 }
  }
};

const META_INFO = {
  hull:      { name: 'Reinforced Hull',    desc: '+1 max HP per level', icon: '🛡' },
  damage:    { name: 'Overcharged Cannon', desc: '+15% base damage per level', icon: '⚡' },
  fireRate:  { name: 'Rapid Cycler',       desc: '+10% fire rate per level', icon: '🔥' },
  dashCD:    { name: 'Phase Drive',        desc: '−15% dash cooldown per level', icon: '💨' },
  startCore: { name: 'Starter Augment',    desc: 'Begin runs with +1 random common upgrade per level', icon: '✦' },
  magnet:    { name: 'Core Magnet',        desc: '+35% pickup radius per level', icon: '🧲' },
  crit:      { name: 'Targeting Matrix',   desc: '+5% base crit chance per level', icon: '◈' },
  pierce:    { name: 'Hardlight Rounds',   desc: '+1 base pierce per level', icon: '➤' },
  luck:      { name: 'Fortune Circuit',    desc: '+8% rare upgrade chance per level', icon: '✨' },
  regen:     { name: 'Nanite Weave',       desc: 'Regen 1 HP every 45s − 10s/lvl', icon: '❤' },
  startBank: { name: 'Requisition',        desc: 'Start each run with +3 cores per level', icon: '⬡' },
  combo:     { name: 'Chain Link',         desc: '+0.3s combo decay window per level', icon: '⛓' }
};

let meta = loadMeta();

function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(META_DEFAULTS));
    const parsed = JSON.parse(raw);
    const merged = JSON.parse(JSON.stringify(META_DEFAULTS));
    Object.assign(merged, parsed);
    for (const k of Object.keys(META_DEFAULTS.nodes)) {
      merged.nodes[k] = Object.assign({}, META_DEFAULTS.nodes[k], parsed.nodes?.[k] || {});
    }
    // Pilot XP arrived with the ship roster: credit earlier play once.
    if (parsed.xp === undefined) merged.xp = (merged.totalRuns || 0) * 150 + (merged.bestWave || 0) * 50;
    return merged;
  } catch (e) { return JSON.parse(JSON.stringify(META_DEFAULTS)); }
}
function saveMeta() {
  meta.savedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch (e) {}
  // Signed-in pilots also get a cloud copy (progressSync.js).
  queueProgressPush(meta);
}

// When a pilot signs in, merge this device's save with their account's and
// keep the result on both. Signing out stops the cloud copy; the device
// keeps its local save.
let progressUserId = null;
onAuthChange(({ session }) => {
  const uid = session?.user?.id || null;
  if (uid === progressUserId) return;
  progressUserId = uid;
  linkProgress(uid, meta).then((merged) => {
    if (!merged || uid !== progressUserId) return;
    meta = merged;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch (e) {}
    refreshPilotLevelLine();
    syncLoadout();
  }).catch((e) => console.warn('Progress sync failed:', e));
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushProgressPush();
});

// ---- Pilot level ----
// Level L needs 250 * (L - 1)^1.6 total XP: level 3 after a couple of runs,
// the last ship (level 28) after a few dozen good ones.
function xpForLevel(level) {
  return Math.round(250 * Math.pow(level - 1, 1.6));
}
function pilotLevel(xp = meta.xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}
function isShipUnlocked(ship) {
  return pilotLevel() >= ship.level;
}
// The chosen ship, falling back to the Glide if it isn't unlocked (or a
// saved id no longer exists).
function currentShip() {
  const ship = getShip(meta.ship);
  return isShipUnlocked(ship) ? ship : SHIPS[0];
}
function currentColor() {
  return PILOT_COLORS[meta.color] || PILOT_COLORS[0];
}

// XP for a finished run, solo or multiplayer. Returns a summary line for the
// end-of-run screen, and toasts any ships the new level unlocked.
function awardXp(wave, score) {
  const gained = Math.max(0, Math.round(wave * 50 + score / 100));
  const before = pilotLevel();
  meta.xp += gained;
  saveMeta();
  const after = pilotLevel();
  const unlocked = SHIPS.filter((s) => s.level > before && s.level <= after);
  unlocked.forEach((s, i) => setTimeout(() => toast(`New ship unlocked: ${s.name}`), 600 + i * 1600));
  refreshPilotLevelLine();
  let line = `+${gained.toLocaleString()} XP · Pilot level ${after}`;
  if (after > before) line += ' · LEVEL UP!';
  if (unlocked.length) line += ` · Unlocked ${unlocked.map((s) => s.name).join(', ')}`;
  return line;
}

function refreshPilotLevelLine() {
  const el = document.getElementById('pilotLevelLine');
  if (!el) return;
  const level = pilotLevel();
  const next = SHIPS.find((s) => s.level > level);
  el.textContent = `PILOT LV ${level} · ${currentShip().name.toUpperCase()}` +
    (next ? ` · NEXT SHIP AT LV ${next.level}` : ' · ALL SHIPS UNLOCKED');
}

function nodeCost(node) {
  return Math.ceil(node.costBase * Math.pow(node.costMul, node.level));
}

// ============================================================
// RUN STATE - ENDLESS PROCEDURAL WAVES
// ============================================================
// Wave structure:
//   - Every wave: 3-card upgrade pick on clear
//   - The run drifts through 20 space sectors (sectors.js), 5 waves each.
//     The 5th wave of a sector is that sector's boss, then the shop, then
//     a hyperspace jump to the next sector. After sector 20 it loops.
//   - Every 25th wave (25, 50, 75, 100...): WARDEN mega-boss (escalating)
//   - New enemy types unlock as waves climb
const WAVE_NAMES_REGULAR = ['SWARM', 'LATTICE', 'FRACTURE', 'CASCADE', 'BREACH', 'TEMPEST', 'RIPTIDE', 'ECLIPSE', 'VORTEX', 'SURGE'];

// The sector a solo wave is in: the weekly challenge flies its own route
// (weekly.js), every other run the 20 sectors.
function runSector(waveNum) {
  return run && run.challenge ? weeklySectorForWave(run.challenge, waveNum) : sectorForWave(waveNum);
}

// A weekly challenge rule (weekly.js RULES) is on for this run.
function hasRule(rule) {
  return !!(run && run.challenge && run.challenge.rules.includes(rule));
}

function getWaveInfo(waveNum) {
  // waveNum is 1-indexed for display purposes
  const sector = runSector(waveNum);
  const isMegaBoss = waveNum % 25 === 0;
  const isMiniBoss = sector.waveInSector === WAVES_PER_SECTOR - 1 && !isMegaBoss;
  const loop = Math.floor((waveNum - 1) / 25); // 0, 1, 2...

  // Difficulty multiplier: grows smoothly
  // Wave 1 = 1.0, wave 5 = 1.32, wave 10 = 1.72, wave 25 = 3.1, wave 50 = 5.2
  const diffMul = 1 + (waveNum - 1) * 0.08 + Math.pow(Math.max(0, waveNum - 12), 1.15) * 0.02;

  if (isMegaBoss) {
    const tier = loop + 1;
    return {
      type: 'mega', waveNum, sector, loop, diffMul,
      name: tier === 1 ? 'WARDEN' : `WARDEN +${tier - 1}`,
      bossType: 'warden', bossScale: 1 + loop * 0.6
    };
  }
  if (isMiniBoss) {
    // Each sector has its own boss; toughness climbs every 25 waves and the
    // name gains a +N each time the 20-sector rotation comes back around.
    const bossType = sector.boss;
    // Weekly challenge bosses carry twists, and wear the first one in their name
    const twists = sector.twists || [];
    return {
      type: 'mini', waveNum, sector, loop, diffMul,
      name: (twists.length ? TWISTS[twists[0]].name + ' ' : '') + bossType.toUpperCase() + (sector.loop > 0 ? ` +${sector.loop}` : ''),
      bossType, bossScale: 1 + loop * 0.35, twists
    };
  }
  // Regular wave
  const unlockedTypes = ['grunt'];
  if (waveNum >= 3) unlockedTypes.push('drifter');
  if (waveNum >= 4) unlockedTypes.push('turret');
  if (waveNum >= 6) unlockedTypes.push('weaver');
  if (waveNum >= 12) unlockedTypes.push('splitter');
  if (waveNum >= 17) unlockedTypes.push('phantom');
  if (waveNum >= 22) unlockedTypes.push('bomber');
  if (waveNum >= 32) unlockedTypes.push('lancer');

  // Enemy count: gentler early growth so wave 3 isn't 12 enemies
  // Wave 1: 7, wave 3: 9, wave 5: 11, wave 10: 16, capped at 34
  const baseCount = 6 + Math.floor(waveNum * 0.9);
  const enemyCount = hasRule('swarm') ? Math.min(Math.round(baseCount * 1.4), 48) : Math.min(baseCount, 34);
  const name = WAVE_NAMES_REGULAR[(waveNum - 1) % WAVE_NAMES_REGULAR.length];
  return {
    type: 'regular', waveNum, sector, loop, diffMul,
    name, enemyCount,
    types: unlockedTypes
  };
}

let run = null;

// Dev builds only (npm run dev): ?wave=N starts runs at wave N, ?god makes
// the ship invulnerable. Handy for checking a sector or boss. Never shipped.
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const DEV_START_WAVE = DEV_PARAMS && DEV_PARAMS.get('wave') ? Math.max(1, parseInt(DEV_PARAMS.get('wave'), 10) || 1) : 0;
const DEV_GOD = !!(DEV_PARAMS && DEV_PARAMS.has('god'));
if (import.meta.env.DEV) {
  window.__nd = {
    get run() { return run; },
    startWave: (n) => startWave(n),
    beginWarp: (n) => beginWarp(n),
    killAll: () => { while (run.enemies.length) killEnemy(0); run.spawnQueue = []; },
    kill: (e) => killEnemy(run.enemies.indexOf(e))
  };
}

// ============================================================
// Phase 8c: multiplayer run uses server-authoritative simulation.
// Client just renders server state and forwards input. Single-player
// code path is intentionally untouched — this is a parallel system.
// ============================================================
// A pilot's color slot indexes PILOT_COLORS (ships.js). In multiplayer the
// server assigns slots, so a pilot looks the same on every screen: ship,
// name, pips, drones and bullets.
function pilotColor(slot) {
  return PILOT_COLORS[(slot || 0) % PILOT_COLORS.length];
}
const BOSS_TYPES = ['warden', 'obelisk', 'hive', 'sentinel', 'prism', ...Object.keys(SPACE_BOSS_DEFS)];
function isBossType(type) { return BOSS_TYPES.includes(type); }

function newMpRun(options) {
  const runSeed = options.seed || 0;
  setRandomSeed(runSeed);
  startBGM();
  mpResetViews();
  mpInputHistory.clear();
  mpInputSeq = 0;
  // Minimal `run` shape — the MP renderer is self-contained but a few
  // bits (HUD, pause behavior) read from `run` directly.
  run = {
    active: true,
    paused: false,
    isMultiplayer: true,
    waveNum: 1,
    score: 0,
    cores: 0,
    timeElapsed: 0,
    seed: runSeed,
    screenShake: 0,
    player: {
      x: 640, y: 360, lastX: 640, lastY: 360, angle: 0,
      hp: 3, maxHp: 3, r: 12,
      iframes: 0, invulnDash: 0, dashCD: 0, dashMax: 1, fireFlash: 0,
      bank: 0, enginePulse: 0, trail: []
    },
    enemies: [], projectiles: [], particles: [],
    pickups: [], powerupDrops: [], drones: [],
    turrets: [], medics: [], snakeTurrets: [], snakes: [],
    // Space sectors (views of the server's cover, hazards and beams)
    sector: sectorForWave(1),
    obstacles: [], hazards: [], beams: [],
    fxQueue: [], flash: 0,
    mpMapId: -1, mpBossName: '', mpWarping: false
  };
  document.getElementById('hud').classList.remove('hidden');
}

// Camera state shared by mpRender and mpCanvasToWorld. Every screen shows
// the whole arena (Math.min scale), centered with bars on the spare sides,
// so all pilots see exactly the same picture. camX/camY can be negative:
// they're the world point at the canvas's top-left corner.
function mpCamera() {
  const { w: ww, h: wh } = getWorldDims();
  const scale = Math.min(canvas.width / ww, canvas.height / wh);
  const viewW = canvas.width / scale;
  const viewH = canvas.height / scale;
  const camX = -(viewW - ww) / 2;
  const camY = -(viewH - wh) / 2;
  return { ww, wh, scale, camX, camY, viewW, viewH };
}

function mpCanvasToWorld(cx, cy) {
  const cam = mpCamera();
  return { x: cam.camX + cx / cam.scale, y: cam.camY + cy / cam.scale };
}

// Local muzzle-flash cooldown so we can predict our fire-rate visually
// without waiting for server projectile spawns.
let mpLocalFireCD = 0;

// Multiplayer screen wrap, mirroring wrap() in server/src/NeonDriftRoom.js:
// ships (radius 12) leaving one world edge reappear past the opposite edge.
function mpWrap(v, size) {
  if (v < -12) return v + size + 24;
  if (v > size + 12) return v - size - 24;
  return v;
}
// Shortest signed distance between two coordinates on the wrapped axis.
function mpWrapDelta(d, size) {
  const period = size + 24;
  return d - period * Math.round(d / period);
}

// Predicted ship movement, matching the server's moveShip(): slide along
// cover, then wrap at the world edge.
function mpMoveShip(s, x, y, ww, wh) {
  const res = resolveMove(run.obstacles, s.x, s.y, x, y, 12);
  const w = wrapPosition(run.obstacles, res.x, res.y, 12, ww, wh);
  s.x = w.x;
  s.y = w.y;
}

// Predicted gravity from wells and the Singularity, as the server applies it.
function mpApplyPulls(s, dt) {
  const { w: ww, h: wh } = getWorldDims();
  for (const h of run.hazards) {
    if (h.kind === 'well') pullShip(run.obstacles, s, h.x, h.y, h.strength, h.reach, dt);
  }
  for (const v of mpViews.enemies.values()) {
    if (v.type !== 'singularity' || v.x < 20 || v.x > ww - 20 || v.y < 20 || v.y > wh - 20) continue;
    const pull = singularityPull(v);
    pullShip(run.obstacles, s, v.x, v.y, pull.strength, pull.reach, dt);
  }
}

// Inputs sent to the server, numbered, with where we predicted our ship was
// at the time. Used to reconcile against the server's acknowledged position.
let mpInputSeq = 0;
const mpInputHistory = new Map();

function mpTick(t, dt) {
  const { w: ww, h: wh } = getWorldDims();
  const me = getMyPlayer();
  // While fused, only the driver steers; everyone else rides along on the
  // server's position, so skip local movement prediction for passengers.
  const fusion = getFusion();
  // Mid-jump the server holds every ship still; ride along like a Fusion
  // passenger does.
  const warp = getWarp();
  // The server also stands still while pilots pick upgrades
  const passenger = (fusion.time > 0 && fusion.driver !== fusion.mySession) || warp.time > 0 || warp.paused;
  if (warp.time > 0 && !run.mpWarping) {
    run.mpWarping = true;
    showSectorCard(sectorForWave(warp.to || 1), warp.time);
  } else if (warp.time <= 0) {
    run.mpWarping = false;
  }

  run.player.lastX = run.player.x;
  run.player.lastY = run.player.y;

  // 1. Reconcile our predicted position against the server's authoritative
  // position. The server reports the last input it applied (me.ack) and keeps
  // applying it until the next one arrives, so its position lines up with
  // where we predicted we'd be when we sent the *next* input. Comparing those
  // means network delay alone never drags the ship backward. Real
  // disagreement (a hit, Fusion) is eased out, and big jumps snap.
  if (me) {
    if (me.dead || passenger) {
      run.player.x = me.x;
      run.player.y = me.y;
      mpInputHistory.clear();
    } else {
      const sent = me.ack ? mpInputHistory.get(me.ack + 1) : null;
      const refX = sent ? sent.x : run.player.x;
      const refY = sent ? sent.y : run.player.y;
      // Measure the short way across the wrap seam.
      const dx = mpWrapDelta(me.x - refX, ww);
      const dy = mpWrapDelta(me.y - refY, wh);
      const dist = Math.hypot(dx, dy);
      if (dist > 120) {
        run.player.x = me.x;
        run.player.y = me.y;
        mpInputHistory.clear();
      } else if (dist > 2) {
        const cx = dx * 0.15, cy = dy * 0.15;
        run.player.x = mpWrap(run.player.x + cx, ww);
        run.player.y = mpWrap(run.player.y + cy, wh);
        // Shift newer predictions too, so this error isn't corrected twice.
        for (const h of mpInputHistory.values()) { h.x += cx; h.y += cy; }
      }
      for (const seq of mpInputHistory.keys()) {
        if (seq <= (me.ack || 0)) mpInputHistory.delete(seq);
      }
    }
    run.player.hp = me.hp;
    if (me.maxHp) run.player.maxHp = me.maxHp;
    run.player.ship = me.ship || currentShip().id;
    run.player.shieldUp = !!me.shieldUp;
  }

  // 2. Predict locally: apply input to our position right now so movement
  // feels responsive. Server reconciliation (above) corrects drift.
  if (run.player.hp > 0 && !me?.dead && !passenger) {
    const speedMul = me?.speedMul || 1;
    const speed = 240 * speedMul;
    let mx = input.moveX, my = input.moveY;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    mpMoveShip(run.player, run.player.x + mx * speed * dt, run.player.y + my * speed * dt, ww, wh);
    mpApplyPulls(run.player, dt);
  }

  run.waveNum = getRoomWaveNum() || 1;
  run.score = getRoomTotalScore();

  // 3. Aim resolution.
  //    - touch mode: readInput already set input.aimAngle (auto-aim or drag).
  //      Don't overwrite it (that was the bug — aim got clobbered by mouseX/Y
  //      which never updates on mobile).
  //    - gamepad: pollGamepad already set it from the right stick.
  //    - kbm: compute from mouseX/Y in world coords.
  if (input.mode === 'kbm') {
    const wm = mpCanvasToWorld(mouseX, mouseY);
    input.aimAngle = Math.atan2(wm.y - run.player.y, wm.x - run.player.x);
  }
  input.aimActive = true;
  run.player.angle = input.aimAngle;

  // 4. Predicted muzzle flash + shoot sound when we're firing locally.
  mpLocalFireCD = Math.max(0, mpLocalFireCD - dt);
  if (input.firing && mpLocalFireCD <= 0 && me && !me.dead && me.hp > 0) {
    const fireRateMul = me?.fireRateMul || 1;
    mpLocalFireCD = fusion.time > 0 ? 0.3 : 0.15 / fireRateMul;
    playSound('shoot');
    run.player.fireFlash = 0.08;
    spawnMpParticles({
      x: run.player.x + Math.cos(input.aimAngle) * 14,
      y: run.player.y + Math.sin(input.aimAngle) * 14,
      color: '#00f0ff', count: 4, speed: 120, life: 0.18, size: 2
    });
  }

  // 5. Dash (Shift / dash button). One-shot: consume input.dashRequested.
  if (input.dashRequested && me && !me.dead && !passenger && (me.dashCD || 0) <= 0) {
    input.dashRequested = false;
    sendDash();
    // Predict locally for instant feel: snap our predicted position forward
    // in move direction (or aim if not moving).
    let dx = input.moveX, dy = input.moveY;
    const mag = Math.hypot(dx, dy);
    if (mag > 0.15) { dx /= mag; dy /= mag; }
    else { dx = Math.cos(input.aimAngle); dy = Math.sin(input.aimAngle); }
    mpMoveShip(run.player, run.player.x + dx * 120, run.player.y + dy * 120, ww, wh);
    run.player.invulnDash = 0.35;
    spawnMpParticles({
      x: run.player.x, y: run.player.y,
      color: '#00f0ff', count: 18, speed: 260, life: 0.35, size: 2
    });
  } else if (input.dashRequested) {
    // Consume even if on cooldown so it doesn't queue.
    input.dashRequested = false;
  }

  // 6. Cosmetics: our ship's trail/bank/flash, the other ships, enemies and
  // bullets (eased between server updates), particles and screen shake.
  const lp = run.player;
  tickShipCosmetics(lp, dt);
  if (lp.iframes > 0) lp.iframes -= dt;
  if (lp.invulnDash > 0) lp.invulnDash -= dt;
  if (lp.fireFlash > 0) lp.fireFlash -= dt;
  lp.dashCD = me?.dashCD || 0;
  mpUpdateViews(dt);
  updateMpParticles(dt);
  updateParticles(dt);
  updateFx(dt);
  if (run.screenShake > 0) run.screenShake = Math.max(0, run.screenShake - dt * 30);

  run.timeElapsed += dt;

  // 7. Forward input at ~30Hz (server tick rate).
  if (t - lastMpInputAt > 33) {
    lastMpInputAt = t;
    const seq = ++mpInputSeq;
    mpInputHistory.set(seq, { x: run.player.x, y: run.player.y });
    sendInput({
      seq,
      moveX: input.moveX,
      moveY: input.moveY,
      aimAngle: input.aimAngle,
      firing: input.firing
    });
  }
}

// ---- MP local cosmetic particle system ----
const mpParticles = [];
const MP_PARTICLE_CAP = 600;

function spawnMpParticles({ x, y, color, count = 8, speed = 200, life = 0.5, size = 2 }) {
  for (let i = 0; i < count; i++) {
    if (mpParticles.length >= MP_PARTICLE_CAP) break;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.9);
    mpParticles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life, maxLife: life,
      color,
      size: size * (0.7 + Math.random() * 0.8)
    });
  }
}

function updateMpParticles(dt) {
  for (let i = mpParticles.length - 1; i >= 0; i--) {
    const p = mpParticles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) mpParticles.splice(i, 1);
  }
}

function drawMpParticles() {
  if (mpParticles.length === 0) return;
  ctx.save();
  for (const p of mpParticles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.restore();
}

// ---- MP render views ----
// The server sends state ~30 times a second, but screens refresh at 60-120Hz.
// These views are what actually gets drawn: enemies and other pilots ease
// toward the server's positions, bullets keep flying along their velocity
// between updates, and each view carries the cosmetic state (trail, bank,
// animation time) that the single-player drawPlayer/drawEnemy art needs.
const mpViews = { enemies: new Map(), ships: new Map(), shots: new Map(), hazards: new Map() };
const MP_SNAP_DIST = 120;

function mpResetViews() {
  mpViews.enemies.clear();
  mpViews.ships.clear();
  mpViews.shots.clear();
  mpViews.hazards.clear();
}

function mpNewShip(x, y) {
  return {
    x, y, lastX: x, lastY: y, angle: 0, r: 12,
    iframes: 0, invulnDash: 0, dashCD: 0, dashMax: 1, fireFlash: 0,
    bank: 0, enginePulse: Math.random() * Math.PI * 2, trail: []
  };
}

// Ease a view toward the server position. Ships measure the short way across
// the wrap seam; enemies (which never wrap) use the plain difference.
function mpEase(view, tx, ty, k, ww, wh, wraps) {
  const dx = wraps ? mpWrapDelta(tx - view.x, ww) : tx - view.x;
  const dy = wraps ? mpWrapDelta(ty - view.y, wh) : ty - view.y;
  if (Math.hypot(dx, dy) > MP_SNAP_DIST) {
    view.x = tx;
    view.y = ty;
  } else if (wraps) {
    view.x = mpWrap(view.x + dx * k, ww);
    view.y = mpWrap(view.y + dy * k, wh);
  } else {
    view.x += dx * k;
    view.y += dy * k;
  }
}

function mpLerpAngle(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

function mpUpdateViews(dt) {
  const { w: ww, h: wh } = getWorldDims();
  const k = 1 - Math.exp(-dt * 18);
  const now = performance.now();

  const seenEnemies = new Set();
  for (const e of getRemoteEnemies()) {
    seenEnemies.add(e.id);
    let v = mpViews.enemies.get(e.id);
    if (!v) {
      const def = ENEMY_DEFS[e.type];
      v = {
        id: e.id, type: e.type, x: e.x, y: e.y, t: Math.random() * 10,
        color: def ? def.color : (MP_ENEMY_COLORS[e.type] || '#ff2d95')
      };
      mpViews.enemies.set(e.id, v);
    }
    mpEase(v, e.x, e.y, k, ww, wh, false);
    v.t += dt;
    v.r = e.r;
    if (v.hp !== undefined && e.hp < v.hp) v.hitFlash = 0.1;
    else if (v.hitFlash > 0) v.hitFlash -= dt;
    v.hp = e.hp;
    v.maxHp = e.maxHp;
    v.angle = e.angle;
    v.phase = e.phase;
    v.lancerCharge = e.charge;
    v.visible = !e.intangible;
    // Sector bosses: art fields, hitboxes (eased like the body), shield, owner
    unpackBossSync(e.type, e.vals, v);
    v.shielded = e.shielded;
    v.owner = e.owner;
    if (e.parts.length) {
      if (!v.parts || v.parts.length !== e.parts.length) v.parts = e.parts.map((pt) => ({ ...pt }));
      else {
        v.parts.forEach((pv, i) => {
          const pt = e.parts[i];
          mpEase(pv, pt.x, pt.y, k, ww, wh, false);
          pv.r = pt.r;
          pv.a = pt.a;
        });
      }
    } else {
      v.parts = null;
    }
    if (isBossType(e.type) && run.mpBossName) v.displayName = run.mpBossName;
  }
  for (const id of mpViews.enemies.keys()) {
    if (!seenEnemies.has(id)) mpViews.enemies.delete(id);
  }

  // Boss lasers, attached to their owners for the art (Pulsar emitters,
  // Dreadnought's charging cannon). Nexus finds its shield nodes the same way.
  run.beams = getRemoteBeams();
  for (const v of mpViews.enemies.values()) { v.nodes = null; v.beams = null; v.cannon = null; }
  for (const v of mpViews.enemies.values()) {
    const boss = v.owner && mpViews.enemies.get(v.owner);
    if (boss) (boss.nodes || (boss.nodes = [])).push(v);
  }
  for (const b of run.beams) {
    const boss = b.owner && mpViews.enemies.get(b.owner);
    if (!boss) continue;
    (boss.beams || (boss.beams = [])).push(b);
    if (!boss.cannon) boss.cannon = b;
  }

  // Cover: rebuilt (with sprites) whenever the server's map changes
  const cover = getRemoteCover();
  if (cover.mapId !== run.mpMapId) {
    run.mpMapId = cover.mapId;
    const sector = sectorForWave(getWarp().sectorWave || 1);
    run.obstacles = cover.obstacles.map((o) => ({ ...o, sprite: o.noDraw ? null : coverSprite(o, sector) }));
  }

  // Hazards: rocks and comets fly on between updates like bullets do
  const seenHazards = new Set();
  for (const h of getRemoteHazards()) {
    seenHazards.add(h.id);
    let v = mpViews.hazards.get(h.id);
    if (!v) {
      v = { at: now, sx: h.x, sy: h.y, rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * (4 - (h.tier || 2)) * 0.6, hitFlash: 0 };
      mpViews.hazards.set(h.id, v);
    } else if (h.x !== v.sx || h.y !== v.sy) {
      v.sx = h.x; v.sy = h.y; v.at = now;
    }
    if (v.hp !== undefined && h.hp < v.hp) v.hitFlash = 0.1;
    else if (v.hitFlash > 0) v.hitFlash -= dt;
    Object.assign(v, h);
    const age = Math.min(0.1, (now - v.at) / 1000);
    if (h.kind === 'rock' || (h.kind === 'comet' && h.warn <= 0)) {
      v.x = h.x + h.vx * age;
      v.y = h.y + h.vy * age;
    }
    v.rot += v.spin * dt;
  }
  for (const id of mpViews.hazards.keys()) {
    if (!seenHazards.has(id)) mpViews.hazards.delete(id);
  }
  run.hazards = [...mpViews.hazards.values()];

  // Bullets fly straight (or nearly), so dead-reckon from the last server
  // position using the synced velocity instead of easing behind it.
  const seenShots = new Set();
  for (const s of getRemoteProjectiles()) {
    seenShots.add(s.id);
    let v = mpViews.shots.get(s.id);
    if (!v) {
      v = { sx: s.x, sy: s.y, at: now, born: now };
      mpViews.shots.set(s.id, v);
    } else if (s.x !== v.sx || s.y !== v.sy) {
      v.sx = s.x; v.sy = s.y; v.at = now;
    }
    // Shots hanging in place (Glacier's trail) don't fly on yet
    const age = s.hold > 0 ? 0 : Math.min(0.1, (now - v.at) / 1000);
    v.x = s.x + s.vx * age;
    v.y = s.y + s.vy * age;
    v.kind = s.kind;
    v.delay = s.hold;
    v.age = (now - v.born) / 1000;
    v.vx = s.vx; v.vy = s.vy;
    v.r = s.r;
    v.ownerType = s.ownerType;
    v.color = s.color;
    v.crit = s.crit;
    v.owner = s.owner;
  }
  for (const id of mpViews.shots.keys()) {
    if (!seenShots.has(id)) mpViews.shots.delete(id);
  }

  const seenShips = new Set();
  for (const r of getRemotePlayers()) {
    seenShips.add(r.sessionId);
    let v = mpViews.ships.get(r.sessionId);
    if (!v) {
      v = mpNewShip(r.x, r.y);
      v.angle = r.angle || 0;
      mpViews.ships.set(r.sessionId, v);
    }
    v.lastX = v.x; v.lastY = v.y;
    mpEase(v, r.x, r.y, k, ww, wh, true);
    v.angle = mpLerpAngle(v.angle, r.angle || 0, k);
    v.sessionId = r.sessionId;
    v.slot = r.slot;
    v.ship = r.ship;
    v.shieldUp = r.shieldUp;
    v.score = r.score;
    if (v.iframes > 0) v.iframes -= dt;
    v.name = r.name;
    v.hp = r.hp;
    v.maxHp = r.maxHp;
    v.dead = r.dead;
    v.droneCount = r.droneCount;
    tickShipCosmetics(v, dt);
  }
  for (const id of mpViews.ships.keys()) {
    if (!seenShips.has(id)) mpViews.ships.delete(id);
  }
}

function mpRender() {
  const cam = mpCamera();
  const { ww, wh, scale, camX, camY } = cam;

  // Same space sky as single player, following the room's sector (it
  // swaps halfway through a jump)
  const now = performance.now() / 1000;
  const warp = getWarp();
  const sector = sectorForWave(warp.sectorWave || getRoomWaveNum() || 1);
  run.sector = sector;
  const me0 = getMyPlayer();
  const view = me0 ? { px: (run.player.x - camX) * scale - canvas.width / 2, py: (run.player.y - camY) * scale - canvas.height / 2 } : { px: 0, py: 0 };
  drawSpaceBackdrop(ctx, canvas.width, canvas.height, sector, now, view, 1 / 60);
  const time = run.timeElapsed;

  ctx.save();
  if (run.screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * run.screenShake,
      (Math.random() - 0.5) * run.screenShake
    );
  }
  // Camera-follow transform: canvas origin maps to (camX, camY) in world.
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  // World edge (ships wrap across it)
  ctx.strokeStyle = 'rgba(184, 71, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, ww, wh);

  // Hazard telegraphs, cover, rocks and mines (same art as single player)
  drawHazards('under', time, run.hazards, sector, ww, wh);
  for (const o of run.obstacles) {
    if (o.noDraw || !o.sprite) continue;
    if (o.shape === 'circle') drawRock(ctx, { x: o.x, y: o.y, rot: o.rot + time * o.spin, sprite: o.sprite });
    else drawPanel(ctx, o);
  }
  drawHazards('mid', time, run.hazards, sector, ww, wh);

  // Pickups (drawn under enemies/ships so they don't occlude action)
  for (const pk of getRemotePickups()) drawMpPickup(pk);
  // Boss lasers, enemy bullets, enemies, then player bullets on top
  for (const b of run.beams) drawBeam(ctx, b, time);
  for (const v of mpViews.shots.values()) {
    if (v.ownerType === 'enemy') drawEnemyBullet(v, time);
  }
  for (const v of mpViews.enemies.values()) {
    if (ENEMY_DEFS[v.type]) drawEnemy(v);
    else drawMpEnemy(v);
  }
  for (const v of mpViews.shots.values()) {
    if (v.ownerType !== 'player') continue;
    if (v.r >= 12) drawMpFusionShot(v);
    else drawPlayerBullet(v, v.owner >= 0 ? pilotColor(v.owner) : '#ff2d95');
  }
  drawParticles();
  drawMpParticles();

  const me = getMyPlayer();
  const fusion = getFusion();
  const fused = fusion.time > 0;
  const remotes = [...mpViews.ships.values()];
  // Remote ships (pilots other than me) + their drones. While fused, living
  // pilots are drawn as cannons on the fused ship instead.
  for (const v of remotes) {
    const color = pilotColor(v.slot);
    if (!fused) drawMpRemoteShip(v, color);
    if (!v.dead) drawMpDrones(v.x, v.y, v.droneCount, color);
  }
  if (fused) drawMpFusedShip(me, remotes, fusion);
  // Local ship + drones (drawn last so they sit on top)
  const myColor = pilotColor(me?.slot);
  if (me && !me.dead) {
    if (!fused) drawPlayer(run.player, myColor);
    drawMpDrones(run.player.x, run.player.y, me.droneCount || 0, myColor);
    // Local HP pips + dash CD ring under the ship (in addition to the HUD
    // pips, because the HUD is at the top of the screen during intense play).
    drawMpHpPips(run.player.x, run.player.y + 22, me.hp || 0, me.maxHp || 3, myColor);
    if ((me.dashCD || 0) > 0) drawMpDashCooldown(run.player.x, run.player.y, me.dashCD);
  }
  drawHazards('over', time, run.hazards, sector, ww, wh);

  ctx.restore();

  // Hyperspace jump and white flashes
  if (warp.time > 0) drawWarp(ctx, canvas.width, canvas.height, 1 - warp.time / WARP_TIME, sectorForWave(warp.to || 1).accent);
  if (run.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, run.flash)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Screen-space overlays
  drawMpOffscreenMarkers(cam, fused);
  const boss = [...mpViews.enemies.values()].find((v) => BOSS_TYPES.includes(v.type));
  if (boss) drawBossBar(boss);
  drawMpTeamPanel(me, remotes);
  if (me?.dead) drawMpSpectateBanner();
  drawMpFusionMeter(fusion);

  // HUD (canvas pixel coords)
  if (typeof updateHUD === 'function') {
    try { updateHUD(); } catch (e) { /* ignore */ }
  }
}

const MP_ENEMY_COLORS = {
  grunt: '#ff2d95',
  drifter: '#00f0ff',
  weaver: '#ffea00',
  miniboss: '#bc8cff',
  warden: '#ff4d6d'
};

function drawMpEnemy(e) {
  const color = MP_ENEMY_COLORS[e.type] || '#ff2d95';
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, e.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // HP bar above
  if (e.hp < e.maxHp) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-e.r, -e.r - 8, e.r * 2, 4);
    ctx.fillStyle = '#ffea00';
    ctx.fillRect(-e.r, -e.r - 8, e.r * 2 * (e.hp / e.maxHp), 4);
  }
  ctx.restore();
}

function drawMpPickup(pk) {
  ctx.save();
  ctx.translate(pk.x, pk.y);
  // Soft pulse based on time so cores feel alive
  const pulse = 1 + Math.sin(performance.now() / 250) * 0.15;
  ctx.shadowColor = '#ffea00';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffea00';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, pk.r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Fusion rounds (server sends r >= 12): white-hot core in a pink halo.
function drawMpFusionShot(v) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.shadowColor = '#ff2d95';
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(255, 45, 149, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, v.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, v.r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Fused ship: one big glowing hull at the driver's position with a cannon
// for every living pilot, each pointing where that pilot is aiming.
function drawMpFusedShip(me, remotes, fusion) {
  const amDriver = fusion.driver === fusion.mySession;
  let cx, cy;
  if (me && !me.dead) {
    cx = run.player.x; cy = run.player.y;
  } else {
    const d = remotes.find(r => r.sessionId === fusion.driver) || remotes.find(r => !r.dead);
    if (!d) return;
    cx = d.x; cy = d.y;
  }
  const cannons = [];
  if (me && !me.dead) cannons.push({ angle: run.player.angle, color: pilotColor(me.slot) });
  for (const r of remotes) {
    if (!r.dead) cannons.push({ angle: r.angle || 0, color: pilotColor(r.slot) });
  }
  const t = performance.now() / 1000;
  const pulse = 1 + Math.sin(t * 8) * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  // Cannons
  for (const c of cannons) {
    ctx.save();
    ctx.rotate(c.angle);
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = c.color;
    ctx.fillRect(10, -5, 30, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(36, -3, 6, 6);
    ctx.restore();
  }
  // Hull: spinning hexagon with a hot core
  ctx.rotate(t * 1.5);
  ctx.shadowColor = '#ff2d95';
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(26, 11, 46, 0.9)';
  ctx.strokeStyle = '#ff2d95';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 26 * pulse;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = '#00f0ff';
  ctx.fillStyle = '#00f0ff';
  ctx.beginPath();
  ctx.arc(0, 0, 9 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (amDriver) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText('YOU DRIVE', cx, cy + 44);
    ctx.restore();
  }
}

// Fusion meter, bottom center (canvas pixel coords) so toasts at the top
// never cover it; the 6% margin keeps it inside TV overscan. Fills from team
// kills; while fused it drains with the time left.
function drawMpFusionMeter(fusion) {
  const fused = fusion.time > 0;
  const frac = fused ? fusion.time / 10 : fusion.meter;
  const w = 200, h = 8;
  const x = canvas.width / 2 - w / 2;
  const y = canvas.height - Math.max(36, canvas.height * 0.06);
  const color = fused ? '#ff2d95' : '#00f0ff';
  ctx.save();
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(fused ? 'FUSED' : 'FUSION', x, y - 3);
  ctx.textAlign = 'right';
  ctx.fillText(fused ? `${Math.ceil(fusion.time)}s` : `${Math.floor(fusion.meter * 100)}%`, x + w, y - 3);
  ctx.fillStyle = 'rgba(10, 5, 20, 0.7)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.shadowColor = color;
  ctx.shadowBlur = fused ? 14 + Math.sin(performance.now() / 80) * 6 : 8;
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, frac)), h - 2);
  ctx.restore();
}

// Bottom edge of the DOM HUD in canvas pixels, so canvas overlays sit below
// it on every device (the HUD already respects the notch / safe area).
function hudBottom() {
  const hud = document.getElementById('hud');
  const r = hud && !hud.classList.contains('hidden') ? hud.getBoundingClientRect() : null;
  return r && r.height > 0 ? r.bottom : 44;
}

// Boss name and health across the top of the screen.
function drawBossBar(e) {
  const w = Math.min(520, canvas.width * 0.6), h = 8;
  const x = canvas.width / 2 - w / 2;
  const y = hudBottom() + 18;
  const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
  const color = e.color || '#ff3860';
  ctx.save();
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillText((e.displayName || e.type).toUpperCase(), canvas.width / 2, y - 3);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(10, 5, 20, 0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, (w - 2) * frac, h - 2);
  ctx.restore();
}

function drawMpRemoteShip(v, color) {
  if (v.dead) return;
  drawPlayer(v, color);
  // Name label above
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText(v.name || 'pilot', v.x, v.y - 20);
  ctx.restore();
  // HP pips below
  drawMpHpPips(v.x, v.y + 22, v.hp || 0, v.maxHp || 3, color);
}

// Small HP pips used for teammate (and local) ship indicators.
function drawMpHpPips(cx, cy, hp, maxHp, color) {
  if (!maxHp || maxHp <= 0) return;
  const pipW = 6, pipGap = 2, pipH = 3;
  const totalW = maxHp * pipW + (maxHp - 1) * pipGap;
  const startX = cx - totalW / 2;
  ctx.save();
  for (let i = 0; i < maxHp; i++) {
    if (i < hp) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.shadowBlur = 0;
    }
    ctx.fillRect(startX + i * (pipW + pipGap), cy, pipW, pipH);
  }
  ctx.restore();
}

// Orbit angle derived from local clock. Client's clock may differ from the
// server's by a small amount, so the visual drone position won't exactly
// match the server's fire origin — acceptable since projectiles come from
// the server with their own spawn coordinates.
function drawMpDrones(x, y, count, color) {
  if (!count || count <= 0) return;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const a = t * 2 + (i / count) * Math.PI * 2;
    const dx = x + Math.cos(a) * 44;
    const dy = y + Math.sin(a) * 44;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(-5, 5);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Draining arc around the local ship while dash is on cooldown (1s max).
function drawMpDashCooldown(x, y, cd) {
  const frac = Math.max(0, Math.min(1, cd / 1.0));
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * frac;
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 20, start, end);
  ctx.stroke();
  ctx.restore();
}

// The teammate named in the spectate banner: the living one with the lowest slot.
function mpSpectateTarget() {
  let best = null;
  for (const v of mpViews.ships.values()) {
    if (!v.dead && (!best || v.slot < best.slot)) best = v;
  }
  return best;
}

function drawMpSpectateBanner() {
  const target = mpSpectateTarget();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 77, 109, 0.95)';
  ctx.shadowColor = '#ff4d6d';
  ctx.shadowBlur = 20;
  ctx.font = 'bold 34px "Courier New", monospace';
  const y = Math.max(110, canvas.height * 0.16);
  ctx.fillText('DRIFTED', canvas.width / 2, y);
  ctx.shadowBlur = 4;
  ctx.font = '13px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Back in when this wave is cleared', canvas.width / 2, y + 24);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(target ? `Spectating ${target.name || 'pilot'} · Pause to leave` : 'Pause to leave',
    canvas.width / 2, y + 42);
  ctx.restore();
}

// Arrows on the screen edge pointing at teammates and bosses that are out
// of view (the camera often shows only part of the world on phones).
function drawMpOffscreenMarkers(cam, fused) {
  const targets = [];
  if (!fused) {
    for (const v of mpViews.ships.values()) {
      if (!v.dead) targets.push({ x: v.x, y: v.y, color: pilotColor(v.slot), size: 9 });
    }
  }
  for (const v of mpViews.enemies.values()) {
    if (BOSS_TYPES.includes(v.type)) targets.push({ x: v.x, y: v.y, color: v.color, size: 14 });
  }
  const margin = 26;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  for (const t of targets) {
    const sx = (t.x - cam.camX) * cam.scale;
    const sy = (t.y - cam.camY) * cam.scale;
    if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) continue;
    // Walk from the screen center toward the target until we hit the margin box.
    const dx = sx - cx, dy = sy - cy;
    const k = Math.min(
      (cx - margin) / Math.max(1e-6, Math.abs(dx)),
      (cy - margin) / Math.max(1e-6, Math.abs(dy))
    );
    const ax = cx + dx * k, ay = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(t.size, 0);
    ctx.lineTo(-t.size * 0.7, -t.size * 0.75);
    ctx.lineTo(-t.size * 0.35, 0);
    ctx.lineTo(-t.size * 0.7, t.size * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// Team panel, top left under the HUD: color, name, hull pips and score for
// every pilot. Shot-down pilots are dimmed.
function drawMpTeamPanel(me, remotes) {
  const rows = [];
  if (me) rows.push({ slot: me.slot, name: me.name || 'You', hp: me.hp, maxHp: me.maxHp, score: me.score, dead: me.dead, isMe: true });
  for (const v of remotes) rows.push({ slot: v.slot, name: v.name, hp: v.hp, maxHp: v.maxHp, score: v.score, dead: v.dead });
  if (rows.length < 2) return;
  rows.sort((a, b) => a.slot - b.slot);
  const x = 14, rowH = 18;
  // On narrow screens the boss bar spans the top, so stack the panel below it.
  const bossShowing = [...mpViews.enemies.values()].some((v) => BOSS_TYPES.includes(v.type));
  let y = hudBottom() + 18 + (bossShowing && canvas.width < 760 ? 30 : 0);
  ctx.save();
  ctx.font = '11px "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10, 5, 20, 0.55)';
  ctx.fillRect(x - 6, y - 8, 190, rows.length * rowH + 6);
  for (const r of rows) {
    const color = pilotColor(r.slot);
    ctx.globalAlpha = r.dead ? 0.4 : 1;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillRect(x, y - 5, 4, 10);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    const label = (r.name || 'pilot').slice(0, 10) + (r.isMe ? ' ★' : '');
    ctx.fillText(label, x + 10, y);
    // Hull pips
    const maxHp = r.maxHp || 3;
    for (let i = 0; i < Math.min(maxHp, 8); i++) {
      ctx.fillStyle = !r.dead && i < (r.hp || 0) ? color : 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(x + 100 + i * 6, y - 3, 4, 6);
    }
    ctx.fillStyle = r.dead ? '#888888' : '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(r.dead ? 'DOWN' : String(r.score || 0), x + 180, y);
    y += rowH;
  }
  ctx.restore();
}


// MP upgrade modal — shown when server signals upgradeChoices.
function showMpUpgradeScreen(choices) {
  const overlay = document.getElementById('mpUpgradeScreen');
  const list = document.getElementById('mpUpgradeChoices');
  const waiting = document.getElementById('mpUpgradeWaiting');
  if (!overlay || !list) return;
  const rarityColor = (r) => r === 'legendary' ? 'var(--pink)' : r === 'rare' ? 'var(--yellow)' : 'var(--cyan)';
  list.innerHTML = choices.map((c) => {
    const rarity = c.rarity || 'common';
    return `
    <button class="upgrade ${rarity}" data-mp-upgrade-id="${c.id}">
      <div class="upgrade-rarity" style="color: ${rarityColor(rarity)};">${rarity}</div>
      <div class="upgrade-icon" style="color: ${rarityColor(rarity)};">${c.icon || '✦'}</div>
      <div class="upgrade-name">${c.name}</div>
      <div class="upgrade-desc">${c.desc}</div>
    </button>`;
  }).join('');
  if (waiting) waiting.textContent = '';
  overlay.classList.remove('hidden');
}
function hideMpUpgradeScreen() {
  document.getElementById('mpUpgradeScreen')?.classList.add('hidden');
}
// Click delegation for upgrade pick buttons.
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest('[data-mp-upgrade-id]');
  if (!btn) return;
  const id = btn.getAttribute('data-mp-upgrade-id');
  // Disable all buttons; show waiting hint.
  document.querySelectorAll('[data-mp-upgrade-id]').forEach((b) => { b.disabled = true; });
  const waiting = document.getElementById('mpUpgradeWaiting');
  if (waiting) waiting.textContent = 'Waiting for other pilots...';
  sendPickUpgrade(id);
});

function newRun(options = {}) {
  // Phase 8c: multiplayer runs use a separate code path with the server-
  // authoritative simulation. Single-player path below is untouched.
  if (options.isMultiplayer) {
    newMpRun(options);
    return;
  }
  const runSeed = options.seed !== undefined
    ? options.seed
    : Math.floor(Math.random() * 0x7fffffff);
  setRandomSeed(runSeed);
  const challengeWeek = options.challengeWeek || null;
  const challenge = challengeWeek ? weeklyChallenge(challengeWeek) : null;
  const startingCores = meta.nodes.startBank.level * 3;
  startBGM();
  run = {
    active: true,
    paused: false,
    seed: runSeed,
    seedInt: getCurrentSeed(),   // runSeed hashed to an int (challenge seeds are strings)
    challengeWeek,
    challenge,                   // this week's route, boss twists and rules (weekly.js)
    player: {
      x: W / 2, y: H / 2,
      vx: 0, vy: 0,
      lastX: W / 2, lastY: H / 2,
      r: 12,
      maxHp: 3 + meta.nodes.hull.level,
      hp: 3 + meta.nodes.hull.level,
      speed: 320,
      iframes: 0,
      dashCD: 0,
      dashMax: 2.0 * Math.pow(0.85, meta.nodes.dashCD.level),
      fireCD: 0,
      invulnDash: 0,
      trail: [],
      bank: 0,
      enginePulse: 0,
      fireFlash: 0,
      regenTimer: 0
    },
    weapons: {
      current: 'pulse',
      damage: 1 * (1 + 0.15 * meta.nodes.damage.level),
      fireRate: 0.22 / (1 + 0.10 * meta.nodes.fireRate.level),
      projectileSpeed: 720,
      projectileCount: 1,
      spread: 0,
      pierce: meta.nodes.pierce.level,
      crit: 0.05 + 0.05 * meta.nodes.crit.level,
      homing: 0,
      explosive: 0,
      ricochet: 0
    },
    passives: {
      magnetRadius: 80 * (1 + 0.35 * meta.nodes.magnet.level),
      grazeBonus: 1,
      comboDecayTime: 2.0 + 0.3 * meta.nodes.combo.level,
      pickupHeal: 0,
      onKillShockwave: 0,
      timeSlow: 0,
      regenInterval: meta.nodes.regen.level > 0 ? (45 - 10 * meta.nodes.regen.level) : 0,
      luckBonus: 0.08 * meta.nodes.luck.level
    },
    upgrades: [],
    waveNum: 0,              // now 1-indexed
    currentWaveInfo: null,
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    particles: [],
    pickups: [],
    obstacles: [],
    hazards: [],          // sector hazards: asteroids, mines, gravity wells, comets, flares...
    hazardClock: {},      // countdowns for timed hazards (comets, flares, strikes, pulses)
    beams: [],            // telegraphed boss lasers
    sector: challenge ? weeklySectorForWave(challenge, 1) : sectorForWave(1),
    warp: null,           // hyperspace jump between sectors
    fxQueue: [],          // delayed explosions (boss death chains)
    flash: 0,             // white screen flash
    drones: [],           // orbiting drones that shoot alongside you
    turrets: [],          // stationary combat turrets placed on map
    maxTurrets: 0,        // how many combat turrets you can deploy (upgrade gated)
    turretDeployCD: 0,    // cooldown for deploying next turret
    medics: [],           // stationary medical turrets (heal aura)
    maxMedics: 0,         // how many medics you can deploy
    medicDeployCD: 0,     // cooldown for deploying next medic
    snakeTurrets: [],     // stationary snake turrets
    maxSnakeTurrets: 0,   // how many snake turrets you can deploy
    snakeTurretDeployCD: 0,
    snakes: [],           // active wiggling snake projectiles
    missileReady: 0,      // how many homing missiles queued to fire with main shots
    beamMode: false,      // beam cannon weapon mode
    droppedPowerups: [],  // pending powerup pickups on the ground
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    comboMult: 1,
    score: 0,
    cores: startingCores,
    spawnQueue: [],
    spawnTimer: 0,
    screenShake: 0,
    slowmo: 1,
    waveCleared: false,
    timeElapsed: 0
  };
  const ship = currentShip();
  run.player.ship = ship.id;
  run.player.color = currentColor();
  applyShipPerks(ship);
  if (hasRule('glass')) {
    run.player.maxHp = 1;
    run.player.hp = 1;
    run.weapons.damage *= 2;
  }
  meta.totalRuns++;
  saveMeta();
  updateHUD();
  // Arrive out of hyperspace, then wave 1 starts
  beginWarp(DEV_START_WAVE || 1, true);
  hideAll();
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('controlsPanel').classList.remove('hidden');

  // Starter augment meta perk (one per level)
  const starterCount = meta.nodes.startCore.level;
  if (starterCount > 0) {
    // Own seeded stream: wave 1 now starts after the arrival jump, so these
    // rolls must not shift what the shared stream gives wave 1
    const starterRand = waveRng(0, 0x57a7);
    const commons = UPGRADES.filter(u => u.rarity === 'common');
    for (let i = 0; i < starterCount; i++) {
      const choice = commons[Math.floor(starterRand() * commons.length)];
      applyUpgrade(choice);
    }
    toast(`Starter: ${starterCount} augment${starterCount > 1 ? 's' : ''}`);
  }
  if (startingCores > 0) toast(`Requisition: +${startingCores} cores`);
}

// ============================================================
// SECTOR MAPS: static cover
// ============================================================
// Each regular wave lays out the sector's cover (shared/spaceSim.js:
// generateCover) and paints its sprites here. Layouts use their own RNG
// seeded by the run seed and wave, so a seeded run (the weekly challenge)
// always gets the same maps. Boss waves stay open.
const TAU = Math.PI * 2;

const ICE_COLORS = { body: '#9fd8ee', shade: '#2a5a78', rim: '#8ff0ff' };
const METAL_COLORS = { body: '#4a4e5e', shade: '#16181f', rim: '#ff6b35' };

function waveRng(waveNum, salt) {
  return makeRng((run.seedInt ^ Math.imul(waveNum + 1, 2654435761) ^ salt) >>> 0);
}

function rockColors(sector, kind) {
  if (kind === 'ice') return sector.rockKind === 'ice' ? sector.rock : ICE_COLORS;
  if (kind === 'crystal') return sector.rockKind === 'crystal' ? sector.rock : { body: '#6a5aa8', shade: '#1e1638', rim: sector.accent };
  if (kind === 'metal') return sector.rockKind === 'metal' ? sector.rock : METAL_COLORS;
  return sector.rock;
}

// Paint a cover obstacle's sprite (shared by single player and multiplayer).
function coverSprite(o, sector) {
  if (o.shape === 'rect') return makePanelSprite(o.w, o.h, o.kind, rockColors(sector, 'metal'), o.seed);
  const spriteKind = o.kind === 'asteroid' ? 'stone' : o.kind;
  return makeRockSprite(o.spriteR, spriteKind, rockColors(sector, o.kind), o.seed, spriteKind !== 'crystal');
}

function generateObstaclesForWave(waveNum, waveInfo) {
  // Boss waves: always open, player needs room
  if (waveInfo && (waveInfo.type === 'mega' || waveInfo.type === 'mini')) return [];
  // Wave 1: always open so new players get comfortable
  if (waveNum === 1) return [];
  const cover = generateCover(waveInfo.sector, W, H, waveRng(waveNum, 0xc0fe));
  for (const o of cover) o.sprite = coverSprite(o, waveInfo.sector);
  return cover;
}

function startWave(waveNum) {
  run.waveNum = waveNum;
  run.waveCleared = false;
  const info = getWaveInfo(waveNum);
  run.currentWaveInfo = info;
  run.sector = info.sector;
  run.beams = [];
  run.bossRand = waveRng(waveNum, 0xb055);   // boss rolls stay off the shared stream

  // Generate obstacles and hazards for this wave
  run.obstacles = generateObstaclesForWave(waveNum, info);
  setupHazards(waveNum, info);

  // If player is inside an obstacle (can happen on resize or wave change),
  // nudge them to the nearest open space
  const spot = freeSpot(run.obstacles, run.player.x, run.player.y, run.player.r, W, H);
  run.player.x = spot.x;
  run.player.y = spot.y;

  run.spawnQueue = [];
  if (info.type === 'mega' || info.type === 'mini') {
    playSound('bosswarn');
    run.spawnQueue.push({ type: info.bossType, delay: 0.6, scale: info.bossScale, diff: info.diffMul, twists: info.twists });
  } else {
    for (let i = 0; i < info.enemyCount; i++) {
      const type = info.types[Math.floor(gameRand() * info.types.length)];
      // Spawn cadence tightens with difficulty but never too fast
      const baseDelay = Math.max(0.18, 0.65 - info.diffMul * 0.02);
      const jitter = 0.4 - Math.min(0.22, info.diffMul * 0.01);
      run.spawnQueue.push({
        type,
        delay: baseDelay + gameRand() * jitter,
        scale: info.diffMul,
        diff: info.diffMul
      });
    }
  }
  run.spawnTimer = 0;

  let sub = '';
  if (info.type !== 'regular') sub = BOSS_TITLES[info.bossType] || '';
  else if (info.sector.waveInSector === 0) sub = sectorLabel(info.sector);
  announceWave(waveNum, info.type, info.name, sub);
}

// "SECTOR 03 · CRIMSON NEBULA" (sector numbers keep climbing past 20)
function sectorLabel(sector) {
  return `SECTOR ${String(sector.number).padStart(2, '0')} · ${sector.name}${loopSuffix(sector.loop)}`;
}

// ============================================================
// HYPERSPACE JUMP between sectors
// ============================================================
// After a boss's shop, the ship jumps: stars stretch, the screen flashes,
// the new sector's sky fades in, then its first wave starts. A new run
// arrives the same way (arriveOnly skips the departure half).
const WARP_TIME = 2.6;

function beginWarp(toWave, arriveOnly = false) {
  const to = runSector(toWave);
  run.warp = { t: arriveOnly ? WARP_TIME * 0.5 : 0, toWave, to, swapped: false };
  run.enemyProjectiles = [];
  run.beams = [];
  if (arriveOnly) swapSector();
  showSectorCard(to, WARP_TIME - run.warp.t);
}

function swapSector() {
  const w = run.warp;
  w.swapped = true;
  run.sector = w.to;
  run.hazards = [];
  run.obstacles = [];
  run.pickups = [];
  run.turrets = [];
  run.medics = [];
  run.snakeTurrets = [];
  run.snakes = [];
  run.particles = [];
  const p = run.player;
  p.x = W / 2; p.y = H / 2;
  p.lastX = p.x; p.lastY = p.y;
  p.trail = [];
}

function updateWarp(dt) {
  const w = run.warp;
  w.t += dt;
  if (!w.swapped && w.t >= WARP_TIME * 0.5) swapSector();
  if (w.t >= WARP_TIME) {
    run.warp = null;
    startWave(w.toWave);
  }
}

// Sector title card that plays over the jump and is gone when the wave starts
function showSectorCard(sector, duration) {
  const el = document.getElementById('sectorCard');
  if (!el) return;
  document.getElementById('sectorCardNum').textContent = `SECTOR ${String(sector.number).padStart(2, '0')}`;
  document.getElementById('sectorCardName').textContent = sector.name + loopSuffix(sector.loop);
  document.getElementById('sectorCardTag').textContent = sector.tagline;
  el.style.setProperty('--sector-accent', sector.accent);
  el.style.animationDuration = `${duration}s`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(showSectorCard.timer);
  showSectorCard.timer = setTimeout(() => el.classList.remove('show'), duration * 1000);
}

// Big "WAVE 07 · SWARM" banner. kind is 'regular', 'mini' or 'mega'.
// sub is an optional line under the name (boss title or sector).
function announceWave(waveNum, kind, name, sub = '') {
  const ann = document.getElementById('waveAnnouncer');
  document.getElementById('waveAnnounceNum').textContent = waveNum.toString().padStart(2, '0');
  let label = 'WAVE';
  if (kind === 'mega') label = 'MEGA BOSS';
  else if (kind === 'mini') label = 'SECTOR BOSS';
  const labelEl = ann.querySelector('.wave-label');
  if (labelEl) labelEl.textContent = label;
  document.getElementById('waveAnnounceName').textContent = name;
  const subEl = document.getElementById('waveAnnounceSub');
  if (subEl) subEl.textContent = sub;
  ann.classList.remove('show');
  void ann.offsetWidth;
  ann.classList.add('show');
  clearTimeout(announceWave.timer);
  announceWave.timer = setTimeout(() => ann.classList.remove('show'), kind === 'regular' ? 2000 : 2800);
}

// ============================================================
// ENEMIES - expanded pool with late-game unlocks
// ============================================================
const ENEMY_DEFS = {
  grunt:    { hp: 2,  speed: 90,  r: 12, color: '#ff2d95', score: 10,  ai: 'chase' },
  drifter:  { hp: 3,  speed: 140, r: 10, color: '#00f0ff', score: 18,  ai: 'zigzag' },
  turret:   { hp: 4,  speed: 40,  r: 14, color: '#ffea00', score: 25,  ai: 'turret',  fireRate: 1.6 },
  weaver:   { hp: 3,  speed: 180, r: 9,  color: '#b847ff', score: 30,  ai: 'weaver',  fireRate: 0.8 },
  splitter: { hp: 5,  speed: 75,  r: 16, color: '#39ff14', score: 40,  ai: 'chase' },
  phantom:  { hp: 2,  speed: 220, r: 10, color: '#5ac8fa', score: 45,  ai: 'phantom' },
  bomber:   { hp: 6,  speed: 100, r: 13, color: '#ff6b35', score: 55,  ai: 'bomber',  fireRate: 2.5 },
  lancer:   { hp: 4,  speed: 110, r: 11, color: '#ffffff', score: 60,  ai: 'lancer',  fireRate: 1.8 },
  // Mini-bosses
  obelisk:  { hp: 40, speed: 30,  r: 32, color: '#b847ff', score: 250, ai: 'obelisk', fireRate: 1.4 },
  hive:     { hp: 35, speed: 70,  r: 28, color: '#39ff14', score: 250, ai: 'hive',    fireRate: 3.0 },
  sentinel: { hp: 50, speed: 90,  r: 26, color: '#ffea00', score: 280, ai: 'sentinel',fireRate: 1.0 },
  prism:    { hp: 45, speed: 100, r: 28, color: '#5ac8fa', score: 300, ai: 'prism',   fireRate: 0.9 },
  // Mega
  warden:   { hp: 70, speed: 60,  r: 42, color: '#ff3860', score: 750, ai: 'warden',  fireRate: 0.5 },
  // Sector bosses and their adds (bosses.js)
  ...SPACE_BOSS_DEFS,
  ...MINION_DEFS
};

function spawnEnemy(type, scale = 1, diffMul = 1) {
  const def = ENEMY_DEFS[type];
  if (!def) return null;
  // Spawn at random edge
  const side = Math.floor(gameRand() * 4);
  let x, y;
  if (side === 0) { x = gameRand() * W; y = -30; }
  else if (side === 1) { x = W + 30; y = gameRand() * H; }
  else if (side === 2) { x = gameRand() * W; y = H + 30; }
  else { x = -30; y = gameRand() * H; }
  // Bosses spawn top center
  if (isBossType(type)) {
    x = W / 2; y = -80;
  }

  // HP scales with the wave scale (diffMul for regular enemies, bossScale for bosses)
  const hpScale = scale;
  // Speed scales more gently
  let speedScale = 1 + (diffMul - 1) * 0.18;
  if (hasRule('overdrive') && !isBossType(type)) speedScale *= 1.2;

  // Safety: if the edge spawn landed inside an obstacle, nudge it to the nearest edge
  if (run.obstacles && run.obstacles.length > 0 && isInsideObstacle(x, y, def.r)) {
    // Push toward the nearest canvas edge
    const distances = [y, W - x, H - y, x]; // top, right, bottom, left
    const minD = Math.min(...distances);
    if (minD === distances[0]) y = -30;
    else if (minD === distances[1]) x = W + 30;
    else if (minD === distances[2]) y = H + 30;
    else x = -30;
  }

  const enemy = {
    type,
    x, y,
    vx: 0, vy: 0,
    hp: def.hp * hpScale,
    maxHp: def.hp * hpScale,
    r: def.r,
    color: def.color,
    score: Math.ceil(def.score * scale),
    ai: def.ai,
    baseSpeed: def.speed * speedScale,
    fireCD: def.fireRate ? gameRand() * def.fireRate : 0,
    fireRate: def.fireRate ? def.fireRate / (1 + (diffMul - 1) * 0.15) : 0,
    angle: 0,
    t: 0,
    phase: 0,
    seed: (run.enemies.length * 2.39996) % 10,   // per-enemy phase offset, no RNG draw
    // Behavioral state
    splitLeft: type === 'splitter' ? 2 : 0,  // splits into 2 mini-grunts on death
    phantomCycle: 0,                         // phantoms fade in/out
    lancerCharge: 0
  };
  if (isBossType(type) && run.currentWaveInfo) enemy.displayName = run.currentWaveInfo.name;
  run.enemies.push(enemy);
  return enemy;
}

// An add brought in by a boss (hive grunts, carrier fighters, nexus nodes).
// Owned adds die with their boss.
function spawnMinion(type, x, y, owner) {
  const info = run.currentWaveInfo;
  const diff = info ? info.diffMul : 1;
  const scale = type === 'node' ? (info?.bossScale || 1) * (1 + (diff - 1) * 0.25) : Math.max(0.5, diff * 0.5);
  const m = spawnEnemy(type, scale, diff * 0.6);
  if (!m) return null;
  m.x = x; m.y = y;
  m.owner = owner || null;
  m.minion = true;
  return m;
}

// What bosses.js can reach (see the header comment there).
const bossApi = {
  get W() { return W; },
  get H() { return H; },
  get p() { return run.player; },
  get diff() { return run.currentWaveInfo ? run.currentWaveInfo.diffMul : 1; },
  get top() { return hudBottom() + 34; },   // clear of the HUD and boss bar
  rand: () => (run.bossRand || gameRand)(),
  shoot: (x, y, a, speed, color, opts) => enemyShoot(x, y, a, speed, color, opts),
  beam: (owner, opts) => addBeam(owner, opts),
  minion: spawnMinion,
  hazard: (kind, props) => spawnHazard(kind, props),
  hazards: () => run.hazards,
  alive: (e) => !!e && !e.dead,
  pull: (x, y, strength, reach, dt) => pullShip(run.obstacles, run.player, x, y, strength, reach, dt),
  explode: (x, y, color, size) => spawnExplosion(x, y, color, size),
  shake: (n) => { run.screenShake = Math.max(run.screenShake, n); },
  sound: playSound
};

// ============================================================
// UPGRADE POOL (roguelike drops)
// ============================================================
// unique: offered once per run (picking it again would do nothing).
// requires: only offered after the named upgrade has been picked.
const MULTISHOT_FAN = 0.9; // total fan width in radians (about 26° each side)
const UPGRADES = [
  // COMMON
  { id: 'dmg1',    name: 'Hotter Pulse',     rarity: 'common', icon: '⚡', desc: '+20% damage', apply: () => run.weapons.damage *= 1.2 },
  { id: 'rate1',   name: 'Quicker Trigger',  rarity: 'common', icon: '🔥', desc: '+20% fire rate', apply: () => run.weapons.fireRate *= 0.82 },
  { id: 'speed1',  name: 'Thruster Boost',   rarity: 'common', icon: '💨', desc: '+15% move speed', apply: () => run.player.speed *= 1.15 },
  { id: 'magnet1', name: 'Core Magnet',      rarity: 'common', icon: '🧲', desc: '+50% pickup radius', apply: () => run.passives.magnetRadius *= 1.5 },
  { id: 'hp1',     name: 'Plating',          rarity: 'common', icon: '🛡', desc: '+1 max HP, full heal', apply: () => { run.player.maxHp++; run.player.hp = run.player.maxHp; } },
  { id: 'spread1', name: 'Twin Shot',        rarity: 'common', icon: '✦',  desc: '+1 projectile, small spread', apply: () => { run.weapons.projectileCount++; run.weapons.spread += 0.12; } },
  // RARE
  { id: 'pierce',  name: 'Hardlight Rounds', rarity: 'rare',   icon: '◈', desc: 'Bullets pierce +1 enemy', apply: () => run.weapons.pierce++ },
  { id: 'crit',    name: 'Overcharge Coils', rarity: 'rare',   icon: '✦', desc: '+15% crit chance (2x dmg)', apply: () => run.weapons.crit += 0.15 },
  { id: 'multishot1', name: 'Multi Shot',     rarity: 'rare',   icon: '❋', desc: 'Fire 3 bullets: straight, left and right', unique: true, apply: () => { run.weapons.projectileCount += 2; run.weapons.spread = Math.max(run.weapons.spread, MULTISHOT_FAN); } },
  { id: 'multishot2', name: 'Multi Shot II',  rarity: 'rare',   icon: '✹', desc: '+2 bullets in the same fan, packed tighter (3 → 5)', unique: true, requires: 'multishot1', apply: () => { run.weapons.projectileCount += 2; } },
  { id: 'velocity',name: 'Coilgun',          rarity: 'rare',   icon: '➤',  desc: '+50% projectile speed & damage', apply: () => { run.weapons.projectileSpeed *= 1.5; run.weapons.damage *= 1.5; } },
  { id: 'graze',   name: 'Grazer',           rarity: 'rare',   icon: '◯', desc: 'Near-miss grazing builds combo faster', apply: () => run.passives.grazeBonus += 2 },
  { id: 'leech',   name: 'Core Siphon',      rarity: 'rare',   icon: '❤', desc: 'Cores heal 1 HP every 5 picked up', apply: () => run.passives.pickupHeal += 1 },
  // RARE NEW: drone and turret slot
  { id: 'drone1',  name: 'Combat Drone',     rarity: 'rare',   icon: '✧', desc: 'Orbiting drone that shoots with you', apply: () => spawnDrone() },
  { id: 'turret1', name: 'Turret Module',    rarity: 'rare',   icon: '⌖', desc: '+1 turret slot (press Q/Y to deploy)', apply: () => { run.maxTurrets++; toast('Press Q or Y button to deploy turret'); } },
  { id: 'medic1',  name: 'Medical Turret',    rarity: 'rare',   icon: '✚', desc: '+1 medic slot (press E/X to deploy, heals nearby)', apply: () => { run.maxMedics++; toast('Press E or X button to deploy medic'); } },
  { id: 'snake1',  name: 'Snake Turret',      rarity: 'rare',   icon: '🐍', desc: '+1 snake slot (press R/LB to deploy, shoots wiggling snakes)', apply: () => { run.maxSnakeTurrets++; toast('Press R or LB to deploy snake turret'); } },
  { id: 'missile', name: 'Missile Rack',     rarity: 'rare',   icon: '◤', desc: 'Every 4th shot becomes a homing missile', apply: () => run.weapons.missileRack = (run.weapons.missileRack || 0) + 1 },
  // LEGENDARY
  { id: 'homing',  name: 'Smart Rounds',     rarity: 'legendary', icon: '◉', desc: 'Bullets home toward enemies', unique: true, apply: () => run.weapons.homing = Math.max(run.weapons.homing, 1) },
  { id: 'explode', name: 'Payload',          rarity: 'legendary', icon: '✺', desc: 'Bullets explode on impact', unique: true, apply: () => run.weapons.explosive = 1 },
  { id: 'shock',   name: 'Deathwave',        rarity: 'legendary', icon: '⬢', desc: 'Kills release damaging shockwaves', unique: true, apply: () => run.passives.onKillShockwave = 1 },
  { id: 'slowmo',  name: 'Temporal Shield',  rarity: 'legendary', icon: '◐', desc: 'Taking damage triggers brief slow-mo', unique: true, apply: () => run.passives.timeSlow = 1 },
  { id: 'ricochet',name: 'Bouncer',          rarity: 'legendary', icon: '⟲', desc: 'Bullets ricochet up to 2 times', unique: true, apply: () => run.weapons.ricochet = 2 },
  // LEGENDARY NEW: drone swarm and beam
  { id: 'drone2',  name: 'Drone Swarm',      rarity: 'legendary', icon: '✨', desc: 'Adds 2 more drones', apply: () => { spawnDrone(); spawnDrone(); } },
  { id: 'beam',    name: 'Beam Cannon',      rarity: 'legendary', icon: '━', desc: 'Piercing beam replaces pulse', unique: true, apply: () => { run.beamMode = true; run.weapons.pierce = Math.max(run.weapons.pierce, 99); } }
];

function applyUpgrade(u) {
  u.apply();
  run.upgrades.push(u.id);
}

function isUpgradeAvailable(u) {
  if (u.unique && run.upgrades.includes(u.id)) return false;
  if (u.requires && !run.upgrades.includes(u.requires)) return false;
  return true;
}

function offerUpgrades() {
  // 3 choices: weighted by rarity. Wave number + luck bonus controls rarity chances.
  const waveNum = run.waveNum;
  const luck = run.passives.luckBonus;
  const rolls = [];
  for (let i = 0; i < 3; i++) {
    const r = gameRand();
    let rarity;
    // Rarity gates improve with waves
    const legendaryChance = Math.min(0.35, 0.05 + Math.max(0, waveNum - 5) * 0.02 + luck * 0.5);
    const rareChance = Math.min(0.6, 0.2 + Math.max(0, waveNum - 2) * 0.04 + luck);
    if (r < legendaryChance) rarity = 'legendary';
    else if (r < legendaryChance + rareChance) rarity = 'rare';
    else rarity = 'common';
    const pool = UPGRADES.filter(u => u.rarity === rarity && isUpgradeAvailable(u) && !rolls.find(x => x.id === u.id));
    if (pool.length === 0) {
      const fallback = UPGRADES.filter(u => isUpgradeAvailable(u) && !rolls.find(x => x.id === u.id));
      rolls.push(fallback[Math.floor(gameRand() * fallback.length)]);
    } else {
      rolls.push(pool[Math.floor(gameRand() * pool.length)]);
    }
  }

  const grid = document.getElementById('upgradeGrid');
  grid.innerHTML = '';
  document.getElementById('upgradeSubtitle').textContent = `Wave ${waveNum} clear · Pick one`;
  for (const u of rolls) {
    const el = document.createElement('div');
    el.className = 'upgrade ' + u.rarity;
    el.innerHTML = `
      <div class="upgrade-rarity" style="color: ${u.rarity === 'legendary' ? 'var(--pink)' : u.rarity === 'rare' ? 'var(--yellow)' : 'var(--cyan)'};">${u.rarity}</div>
      <div class="upgrade-icon" style="color: ${u.rarity === 'legendary' ? 'var(--pink)' : u.rarity === 'rare' ? 'var(--yellow)' : 'var(--cyan)'};">${u.icon}</div>
      <div class="upgrade-name">${u.name}</div>
      <div class="upgrade-desc">${u.desc}</div>
    `;
    el.onclick = () => {
      applyUpgrade(u);
      toast(`+ ${u.name}`);
      document.getElementById('upgradeScreen').classList.add('hidden');
      // After upgrade card: if this was a boss wave (mini or mega), open shop
      const justClearedInfo = run.currentWaveInfo;
      if (justClearedInfo && (justClearedInfo.type === 'mini' || justClearedInfo.type === 'mega')) {
        openShop();
      } else {
        startWave(run.waveNum + 1);
      }
    };
    grid.appendChild(el);
  }
  document.getElementById('upgradeScreen').classList.remove('hidden');
}

// ============================================================
// IN-RUN SHOP (opens after every boss wave)
// ============================================================
const SHOP_ITEMS = [
  { id: 'shop_hp',      name: 'Repair Cell',    icon: '❤', desc: 'Restore 2 HP', cost: 12, apply: () => { run.player.hp = Math.min(run.player.maxHp, run.player.hp + 2); } },
  { id: 'shop_maxhp',   name: 'Hull Plate',     icon: '🛡', desc: '+1 max HP, full heal', cost: 30, apply: () => { run.player.maxHp++; run.player.hp = run.player.maxHp; } },
  { id: 'shop_dmg',     name: 'Weapon Tune-up', icon: '⚡', desc: '+15% damage', cost: 22, apply: () => { run.weapons.damage *= 1.15; } },
  { id: 'shop_rate',    name: 'Cycle Tuning',   icon: '🔥', desc: '+10% fire rate', cost: 20, apply: () => { run.weapons.fireRate *= 0.9; } },
  { id: 'shop_speed',   name: 'Thrust Tune',    icon: '💨', desc: '+10% move speed', cost: 18, apply: () => { run.player.speed *= 1.1; } },
  { id: 'shop_crit',    name: 'Target Lock',    icon: '◈', desc: '+10% crit', cost: 25, apply: () => { run.weapons.crit += 0.1; } },
  { id: 'shop_reroll',  name: 'Full Heal',      icon: '✚', desc: 'Restore all HP', cost: 40, apply: () => { run.player.hp = run.player.maxHp; } },
  { id: 'shop_pierce',  name: 'Hardlight Ammo', icon: '➤', desc: '+1 pierce', cost: 35, apply: () => { run.weapons.pierce++; } },
  { id: 'shop_spread',  name: 'Split Barrel',   icon: '✦', desc: '+1 projectile', cost: 40, apply: () => { run.weapons.projectileCount++; run.weapons.spread += 0.1; } },
  { id: 'shop_combo',   name: 'Combo Extender', icon: '⛓', desc: '+1s combo window', cost: 22, apply: () => { run.passives.comboDecayTime += 1; } }
];

function openShop() {
  // Offer 4 items
  const shuffled = [...SHOP_ITEMS].sort(() => gameRand() - 0.5);
  const picks = shuffled.slice(0, 4);
  // Scale costs with wave progression (more expensive on later bosses)
  const waveMul = 1 + Math.floor(run.waveNum / 5 - 1) * 0.15;

  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  const next = runSector(run.waveNum + 1);
  document.getElementById('shopSubtitle').textContent = `Boss down · Next: ${sectorLabel(next)}`;
  document.getElementById('shopCoresText').textContent = run.cores;

  for (const item of picks) {
    const cost = Math.ceil(item.cost * waveMul);
    const el = document.createElement('div');
    const affordable = run.cores >= cost;
    el.className = 'shop-item' + (affordable ? '' : ' locked');
    el.innerHTML = `
      <div class="shop-icon">${item.icon}</div>
      <div class="shop-name">${item.name}</div>
      <div class="shop-desc">${item.desc}</div>
      <div class="shop-cost ${affordable ? '' : 'locked'}">${cost} ⬡</div>
    `;
    if (affordable) {
      el.onclick = () => {
        run.cores -= cost;
        item.apply();
        toast(`+ ${item.name}`);
        document.getElementById('shopCoresText').textContent = run.cores;
        // Refresh affordability display
        openShopRefresh(picks, waveMul);
      };
    }
    grid.appendChild(el);
  }
  hideAll();
  document.getElementById('shopScreen').classList.remove('hidden');
}

function openShopRefresh(picks, waveMul) {
  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  for (const item of picks) {
    const cost = Math.ceil(item.cost * waveMul);
    const el = document.createElement('div');
    const affordable = run.cores >= cost;
    el.className = 'shop-item' + (affordable ? '' : ' locked');
    el.innerHTML = `
      <div class="shop-icon">${item.icon}</div>
      <div class="shop-name">${item.name}</div>
      <div class="shop-desc">${item.desc}</div>
      <div class="shop-cost ${affordable ? '' : 'locked'}">${cost} ⬡</div>
    `;
    if (affordable) {
      el.onclick = () => {
        run.cores -= cost;
        item.apply();
        toast(`+ ${item.name}`);
        document.getElementById('shopCoresText').textContent = run.cores;
        openShopRefresh(picks, waveMul);
      };
    }
    grid.appendChild(el);
  }
}

// ============================================================
// UNIFIED INPUT SYSTEM
// Supports: keyboard+mouse, touch (dual stick), gamepad
// ============================================================
const keys = {};
let mouseX = W / 2, mouseY = H / 2, mouseDown = false;

// Unified input state - read by game logic each frame
const input = {
  moveX: 0, moveY: 0,       // normalized move vector
  aimAngle: 0,              // angle in radians (always valid)
  aimActive: false,         // is player actively aiming this frame?
  firing: false,            // is player firing this frame?
  dashRequested: false,     // one-shot: true for single frame when dash pressed
  pauseRequested: false,    // one-shot
  mode: 'kbm'               // 'kbm' | 'touch' | 'gamepad'
};

// Touch state
const touch = {
  leftId: null, leftStartX: 0, leftStartY: 0, leftX: 0, leftY: 0,
  rightId: null, rightStartX: 0, rightStartY: 0, rightX: 0, rightY: 0,
  rightWasActive: false
};
const STICK_RADIUS = 60;
const STICK_DEADZONE = 6;
const STICK_FULL_SPEED = 0.65;   // fraction of radius that gives full speed
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Gamepad state
let gamepadIndex = null;
const GAMEPAD_DEADZONE = 0.18;
let lastDashGamepad = false;
let lastPauseGamepad = false;
let lastTurretGamepad = false;
let lastMedicGamepad = false;
let lastSnakeGamepad = false;

const CONTROLS_HELP = {
  kbm: 'WASD or arrows to move. Mouse to aim, click to fire. Shift to dash through bullets (brief invuln). Every cleared wave offers an upgrade.',
  touch: 'Drag on the left to move. Drag on the right to aim and fire; hold to keep firing. DASH slips through bullets (brief invuln). Every cleared wave offers an upgrade.',
  gamepad: 'Left stick to move, right stick to aim, RT or A to fire. B to dash through bullets (brief invuln). Every cleared wave offers an upgrade.'
};

function setInputMode(mode) {
  if (input.mode === mode) return;
  input.mode = mode;
  const ind = document.getElementById('inputIndicator');
  ind.classList.remove('gamepad', 'touch');
  if (mode === 'gamepad') { ind.textContent = 'GAMEPAD'; ind.classList.add('gamepad'); }
  else if (mode === 'touch') { ind.textContent = 'TOUCH'; ind.classList.add('touch'); }
  else { ind.textContent = 'KEYBOARD+MOUSE'; }
  buildControlsPanel(mode);
  const help = document.getElementById('controlsHelp');
  if (help) help.textContent = CONTROLS_HELP[mode];
  document.getElementById('touchUI').classList.toggle('visible', mode === 'touch');
  document.body.classList.toggle('touch-mode', mode === 'touch');
  refreshTouchUIVisibility();
}

// Touch UI must be hidden whenever any modal overlay is open, otherwise its
// 50vw stick zones at the bottom intercept taps meant for buttons inside
// the title/leaderboard/friends/etc cards. Handled in JS via MutationObserver
// instead of CSS :has() so it works on every browser (some iOS versions and
// embedded webviews don't reliably evaluate :has() the way desktop does).
function refreshTouchUIVisibility() {
  const t = document.getElementById('touchUI');
  if (!t) return;
  const overlayShown = !!document.querySelector('.overlay:not(.hidden)');
  const shouldShow = input.mode === 'touch' && !overlayShown;
  t.style.display = shouldShow ? 'block' : 'none';
}
// Watch every .overlay's class attribute for changes (.hidden toggled).
(() => {
  const obs = new MutationObserver(refreshTouchUIVisibility);
  document.querySelectorAll('.overlay').forEach(el => {
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  refreshTouchUIVisibility();
})();

function buildControlsPanel(mode) {
  const body = document.getElementById('panelBody');
  if (!body) return;
  const rows = [];
  if (mode === 'kbm') {
    rows.push(['<kbd>WASD</kbd>', 'Move', '']);
    rows.push(['<kbd>MOUSE</kbd>', 'Aim', '']);
    rows.push(['<kbd>CLICK</kbd>', 'Fire', '']);
    rows.push(['<kbd>SHIFT</kbd>', 'Dash', '']);
    rows.push(['divider', '', '']);
    rows.push(['<kbd>Q</kbd>', 'Deploy Combat Turret', 'turret']);
    rows.push(['<kbd>E</kbd>', 'Deploy Medic Turret', 'medic']);
    rows.push(['<kbd>R</kbd>', 'Deploy Snake Turret', 'snake']);
    rows.push(['divider', '', '']);
    rows.push(['<kbd>ESC</kbd>', 'Pause', '']);
  } else if (mode === 'gamepad') {
    rows.push(['<kbd>L STICK</kbd>', 'Move', '']);
    rows.push(['<kbd>R STICK</kbd>', 'Aim', '']);
    rows.push(['<kbd>RT</kbd> / <kbd>A</kbd>', 'Fire', '']);
    rows.push(['<kbd>B</kbd> / <kbd>LB</kbd>', 'Dash', '']);
    rows.push(['divider', '', '']);
    rows.push(['<kbd>Y</kbd>', 'Deploy Combat Turret', 'turret']);
    rows.push(['<kbd>X</kbd>', 'Deploy Medic Turret', 'medic']);
    rows.push(['<kbd>LT</kbd>', 'Deploy Snake Turret', 'snake']);
    rows.push(['divider', '', '']);
    rows.push(['<kbd>START</kbd>', 'Pause', '']);
  } else if (mode === 'touch') {
    rows.push(['<kbd>LEFT</kbd>', 'Move stick', '']);
    rows.push(['<kbd>RIGHT</kbd>', 'Aim + Fire stick', '']);
    rows.push(['<kbd>DASH</kbd>', 'Dash button', '']);
    rows.push(['divider', '', '']);
    rows.push(['<kbd>⌖</kbd>', 'Combat Turret', 'turret']);
    rows.push(['<kbd>✚</kbd>', 'Medic Turret', 'medic']);
    rows.push(['<kbd>🐍</kbd>', 'Snake Turret', 'snake']);
  }
  body.innerHTML = rows.map(([key, label, cls]) => {
    if (key === 'divider') return '<div class="panel-divider"></div>';
    return `<span>${key}</span><span class="action-label ${cls}">${label}</span>`;
  }).join('');
}

// --- Keyboard + Mouse ---
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (input.mode !== 'touch') setInputMode('kbm');
  if (e.key === 'Escape' && run && run.active) {
    // Marks the key as used so menu nav doesn't also treat it as Back.
    e.preventDefault();
    togglePause();
  }
  if ((e.key === 'Shift') && run && run.active && !run.paused) {
    input.dashRequested = true;
  }
  if ((e.key === 'q' || e.key === 'Q') && run && run.active && !run.paused) {
    tryDeployTurret();
  }
  if ((e.key === 'e' || e.key === 'E') && run && run.active && !run.paused) {
    tryDeployMedic();
  }
  if ((e.key === 'r' || e.key === 'R') && run && run.active && !run.paused) {
    tryDeploySnakeTurret();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  if (input.mode !== 'touch') setInputMode('kbm');
});
canvas.addEventListener('mousedown', () => { mouseDown = true; if (input.mode !== 'touch') setInputMode('kbm'); });
canvas.addEventListener('mouseup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Controller / TV remote / arrow-key navigation for every overlay menu.
// Registered after the keydown handler above so it sees Escape's defaultPrevented.
initMenuNav();

// iOS / Android apps: auth deep links, hardware Back button, Android TV layout.
// Back with no menu open pauses a live run, same as Escape.
initNative({
  onDeepLink: handleAuthDeepLink,
  onBack: () => {
    if (run && run.active && !run.paused) { togglePause(); return true; }
    return false;
  }
});

// iOS app: Face ID lock while signed in, on launch and after five minutes away.
// Pauses a live run before covering it.
initAppLock({
  onLock: () => { if (run && run.active && !run.paused) togglePause(); }
});

// --- Touch ---
function handleTouchStart(e) {
  e.preventDefault();
  setInputMode('touch');
  const halfW = window.innerWidth / 2;
  for (const t of e.changedTouches) {
    if (t.clientX < halfW && touch.leftId === null) {
      touch.leftId = t.identifier;
      touch.leftStartX = t.clientX; touch.leftStartY = t.clientY;
      touch.leftX = t.clientX; touch.leftY = t.clientY;
      updateStickVisual('left', true, t.clientX, t.clientY, t.clientX, t.clientY);
    } else if (t.clientX >= halfW && touch.rightId === null) {
      touch.rightId = t.identifier;
      touch.rightStartX = t.clientX; touch.rightStartY = t.clientY;
      touch.rightX = t.clientX; touch.rightY = t.clientY;
      updateStickVisual('right', true, t.clientX, t.clientY, t.clientX, t.clientY);
    }
  }
}
function handleTouchMove(e) {
  // Only consume the touch (preventDefault) if it's one of our tracked stick
  // touches. Calling preventDefault unconditionally cancels iOS Safari's
  // touchend->click synthesis, breaking every button on the page.
  let consumed = false;
  for (const t of e.changedTouches) {
    if (t.identifier === touch.leftId) {
      touch.leftX = t.clientX; touch.leftY = t.clientY;
      // Drag the stick base along once the thumb passes the rim, so reversing
      // direction only takes a short flick instead of a full return trip.
      const dx = touch.leftX - touch.leftStartX, dy = touch.leftY - touch.leftStartY;
      const mag = Math.hypot(dx, dy);
      if (mag > STICK_RADIUS) {
        touch.leftStartX = touch.leftX - (dx / mag) * STICK_RADIUS;
        touch.leftStartY = touch.leftY - (dy / mag) * STICK_RADIUS;
      }
      updateStickVisual('left', true, touch.leftStartX, touch.leftStartY, t.clientX, t.clientY);
      consumed = true;
    } else if (t.identifier === touch.rightId) {
      touch.rightX = t.clientX; touch.rightY = t.clientY;
      // Same follow-the-thumb rim as the move stick, for quick re-aims.
      const dx = touch.rightX - touch.rightStartX, dy = touch.rightY - touch.rightStartY;
      const mag = Math.hypot(dx, dy);
      if (mag > STICK_RADIUS) {
        touch.rightStartX = touch.rightX - (dx / mag) * STICK_RADIUS;
        touch.rightStartY = touch.rightY - (dy / mag) * STICK_RADIUS;
      }
      updateStickVisual('right', true, touch.rightStartX, touch.rightStartY, t.clientX, t.clientY);
      consumed = true;
    }
  }
  if (consumed) e.preventDefault();
}
function handleTouchEnd(e) {
  let consumed = false;
  for (const t of e.changedTouches) {
    if (t.identifier === touch.leftId) {
      touch.leftId = null;
      updateStickVisual('left', false);
      consumed = true;
    } else if (t.identifier === touch.rightId) {
      touch.rightId = null;
      updateStickVisual('right', false);
      consumed = true;
    }
  }
  if (consumed) e.preventDefault();
}
document.getElementById('leftZone').addEventListener('touchstart', handleTouchStart, { passive: false });
document.getElementById('rightZone').addEventListener('touchstart', handleTouchStart, { passive: false });
window.addEventListener('touchmove', handleTouchMove, { passive: false });
window.addEventListener('touchend', handleTouchEnd, { passive: false });
window.addEventListener('touchcancel', handleTouchEnd, { passive: false });

function updateStickVisual(side, active, baseX, baseY, knobX, knobY) {
  const base = document.getElementById(side + 'Base');
  const knob = document.getElementById(side + 'Knob');
  if (!active) {
    base.classList.remove('active');
    knob.classList.remove('active');
    return;
  }
  base.classList.add('active');
  knob.classList.add('active');
  base.style.left = baseX + 'px';
  base.style.top = baseY + 'px';
  // Clamp knob to stick radius
  const dx = knobX - baseX, dy = knobY - baseY;
  const mag = Math.hypot(dx, dy);
  let kx = knobX, ky = knobY;
  if (mag > STICK_RADIUS) {
    kx = baseX + (dx / mag) * STICK_RADIUS;
    ky = baseY + (dy / mag) * STICK_RADIUS;
  }
  knob.style.left = kx + 'px';
  knob.style.top = ky + 'px';
}

// Dash button (touch)
const dashBtn = document.getElementById('dashBtn');
dashBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  setInputMode('touch');
  if (run && run.active && !run.paused) input.dashRequested = true;
}, { passive: false });
dashBtn.addEventListener('click', () => {
  if (run && run.active && !run.paused) input.dashRequested = true;
});

// Turret button (touch)
const turretBtn = document.getElementById('turretBtn');
turretBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  setInputMode('touch');
  tryDeployTurret();
}, { passive: false });
turretBtn.addEventListener('click', () => {
  tryDeployTurret();
});

// Medic button (touch)
const medicBtn = document.getElementById('medicBtn');
medicBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  setInputMode('touch');
  tryDeployMedic();
}, { passive: false });
medicBtn.addEventListener('click', () => {
  tryDeployMedic();
});

// Snake button (touch)
const snakeBtn = document.getElementById('snakeBtn');
snakeBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  setInputMode('touch');
  tryDeploySnakeTurret();
}, { passive: false });
snakeBtn.addEventListener('click', () => {
  tryDeploySnakeTurret();
});

// Pause button (touch)
document.getElementById('pauseBtn').addEventListener('click', (e) => {
  e.preventDefault();
  if (run && run.active) togglePause();
});
document.getElementById('pauseBtn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (run && run.active) togglePause();
}, { passive: false });

// Touch-only devices (phones/tablets) start in touch mode so #touchUI is
// visible — otherwise its child stick zones are display:none and can never
// receive the touchstart that would activate touch mode (chicken/egg).
// Hybrid devices with hover (touchscreen laptops) stay in kbm and switch
// on demand if the user actually taps.
if (isTouchDevice && !window.matchMedia('(hover: hover)').matches) {
  setInputMode('touch');
}

// --- Gamepad ---
// Note: some environments (Claude preview iframe, sandboxed embeds) block the
// Gamepad API via Permissions-Policy. We guard everything so a failed access
// disables gamepad support silently rather than crashing the game loop.
let gamepadSupported = true;
try {
  if (typeof navigator.getGamepads !== 'function') gamepadSupported = false;
} catch (e) { gamepadSupported = false; }

if (gamepadSupported) {
  window.addEventListener('gamepadconnected', (e) => {
    gamepadIndex = e.gamepad.index;
    setInputMode('gamepad');
    toast(`Controller connected`);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === gamepadIndex) {
      gamepadIndex = null;
      if (input.mode === 'gamepad') setInputMode(isTouchDevice ? 'touch' : 'kbm');
    }
  });
}

function deadzone(v) {
  return Math.abs(v) < GAMEPAD_DEADZONE ? 0 : (v - Math.sign(v) * GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
}

function pollGamepad() {
  if (!gamepadSupported || gamepadIndex === null) return false;
  let pads;
  try {
    pads = navigator.getGamepads();
  } catch (e) {
    // Permissions policy blocked the API; disable for the rest of the session
    gamepadSupported = false;
    gamepadIndex = null;
    return false;
  }
  const gp = pads && pads[gamepadIndex];
  if (!gp) return false;
  navGamepadFrame(gp, performance.now());

  // Detect if gamepad is being used this frame
  const lx = deadzone(gp.axes[0] || 0);
  const ly = deadzone(gp.axes[1] || 0);
  const rx = deadzone(gp.axes[2] || 0);
  const ry = deadzone(gp.axes[3] || 0);
  const rt = gp.buttons[7] ? gp.buttons[7].value : 0; // Right trigger (fire)
  const lt = gp.buttons[6] ? gp.buttons[6].value : 0; // Left trigger (deploy snake)
  const aBtn = gp.buttons[0] ? gp.buttons[0].pressed : false; // A (fire alt)
  const bBtn = gp.buttons[1] ? gp.buttons[1].pressed : false; // B (dash)
  const xBtn = gp.buttons[2] ? gp.buttons[2].pressed : false; // X (deploy medic)
  const yBtn = gp.buttons[3] ? gp.buttons[3].pressed : false; // Y (deploy turret)
  const lbBtn = gp.buttons[4] ? gp.buttons[4].pressed : false; // LB (dash alt)
  const startBtn = gp.buttons[9] ? gp.buttons[9].pressed : false; // Start (pause)

  const anyAxisActive = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.05;
  const dpadActive = [12, 13, 14, 15].some(i => gp.buttons[i] && gp.buttons[i].pressed);
  const anyBtnActive = rt > 0.1 || lt > 0.1 || aBtn || bBtn || xBtn || yBtn || lbBtn || startBtn || dpadActive;

  if (anyAxisActive || anyBtnActive) {
    if (input.mode !== 'gamepad') setInputMode('gamepad');
  }

  if (input.mode !== 'gamepad') return false;

  // Write to unified input
  input.moveX = lx;
  input.moveY = ly;
  // Right stick aim: only update angle if stick is deflected
  const rMag = Math.hypot(rx, ry);
  if (rMag > 0.15) {
    input.aimAngle = Math.atan2(ry, rx);
    input.aimActive = true;
  }
  input.firing = rt > 0.5 || aBtn;

  // Edge-triggered dash and pause
  const dashNow = bBtn || lbBtn;
  if (dashNow && !lastDashGamepad && run && run.active && !run.paused) {
    input.dashRequested = true;
  }
  lastDashGamepad = dashNow;

  // Edge-triggered turret deploy (Y button)
  if (yBtn && !lastTurretGamepad && run && run.active && !run.paused) {
    tryDeployTurret();
  }
  lastTurretGamepad = yBtn;

  // Edge-triggered medic deploy (X button)
  if (xBtn && !lastMedicGamepad && run && run.active && !run.paused) {
    tryDeployMedic();
  }
  lastMedicGamepad = xBtn;

  // Edge-triggered snake deploy (LT - left trigger)
  const ltPressed = lt > 0.5;
  if (ltPressed && !lastSnakeGamepad && run && run.active && !run.paused) {
    tryDeploySnakeTurret();
  }
  lastSnakeGamepad = ltPressed;

  if (startBtn && !lastPauseGamepad && run && run.active) {
    togglePause();
  }
  lastPauseGamepad = startBtn;

  return true;
}

// --- Compute unified input every frame (called from game loop) ---
function readInput() {
  // Gamepad takes precedence if active
  const gpActive = pollGamepad();
  if (gpActive && input.mode === 'gamepad') return; // Already wrote to input

  if (input.mode === 'touch') {
    // Left stick -> move. Full speed is reached at STICK_FULL_SPEED of the
    // radius so small thumb movements still feel decisive.
    if (touch.leftId !== null) {
      const dx = touch.leftX - touch.leftStartX;
      const dy = touch.leftY - touch.leftStartY;
      const mag = Math.hypot(dx, dy);
      if (mag > STICK_DEADZONE) {
        const strength = Math.min(1, (mag - STICK_DEADZONE) / (STICK_RADIUS * STICK_FULL_SPEED - STICK_DEADZONE));
        input.moveX = (dx / mag) * strength;
        input.moveY = (dy / mag) * strength;
      } else {
        input.moveX = 0; input.moveY = 0;
      }
    } else {
      input.moveX = 0; input.moveY = 0;
    }
    // Right stick -> aim + fire. Firing lasts as long as the thumb is down;
    // dragging sets the aim, and holding still keeps the last direction.
    if (touch.rightId !== null) {
      const dx = touch.rightX - touch.rightStartX;
      const dy = touch.rightY - touch.rightStartY;
      if (Math.hypot(dx, dy) > 10) {
        input.aimAngle = Math.atan2(dy, dx);
        input.aimActive = true;
      }
      input.firing = true;
      touch.rightWasActive = true;
    } else {
      input.firing = false;
      touch.rightWasActive = false;
    }
    return;
  }

  // KB+M
  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  const mag = Math.hypot(mx, my);
  if (mag > 0) { mx /= mag; my /= mag; }
  input.moveX = mx;
  input.moveY = my;
  if (run && run.player) {
    input.aimAngle = Math.atan2(mouseY - run.player.y, mouseX - run.player.x);
    input.aimActive = true;
  }
  input.firing = mouseDown;
}

// Screen wrap: once the ship fully leaves one edge it reappears on the
// opposite one. If the far side is blocked by an obstacle, the ship stops at
// the edge instead. lastX/lastY shift with it so banking doesn't spike.
function wrapPlayer(p) {
  let nx = p.x, ny = p.y;
  if (nx < -p.r) nx += W + 2 * p.r;
  else if (nx > W + p.r) nx -= W + 2 * p.r;
  if (ny < -p.r) ny += H + 2 * p.r;
  else if (ny > H + p.r) ny -= H + 2 * p.r;
  if (nx === p.x && ny === p.y) return;
  if (isInsideObstacle(nx, ny, p.r)) {
    p.x = Math.max(-p.r, Math.min(W + p.r, p.x));
    p.y = Math.max(-p.r, Math.min(H + p.r, p.y));
    return;
  }
  p.lastX += nx - p.x;
  p.lastY += ny - p.y;
  p.x = nx;
  p.y = ny;
}

function tryDash() {
  if (run.player.dashCD > 0) return;
  let vx = input.moveX, vy = input.moveY;
  const mag = Math.hypot(vx, vy);
  if (mag < 0.1) {
    // No move input: dash toward current aim
    vx = Math.cos(input.aimAngle);
    vy = Math.sin(input.aimAngle);
  } else {
    vx /= mag; vy /= mag;
  }
  const p = run.player;
  const fromX = p.x, fromY = p.y;
  const targetX = p.x + vx * 120;
  const targetY = p.y + vy * 120;
  // Dash still respects walls but slides along them
  const resolved = resolveCircleMove(fromX, fromY, targetX, targetY, p.r);
  p.x = resolved.x;
  p.y = resolved.y;
  wrapPlayer(p);
  p.invulnDash = 0.35;
  p.iframes = Math.max(p.iframes, 0.35);
  p.dashCD = p.dashMax;
  // Dash particles
  for (let i = 0; i < 16; i++) {
    run.particles.push({
      x: p.x, y: p.y,
      vx: (Math.random() - 0.5) * 300,
      vy: (Math.random() - 0.5) * 300,
      life: 0.4, maxLife: 0.4,
      color: '#00f0ff', size: 3
    });
  }
}

// Auto-detect initial mode
if (isTouchDevice && !window.matchMedia('(hover: hover)').matches) {
  setInputMode('touch');
}
// Build initial controls panel (setInputMode early-exits when mode is already set)
buildControlsPanel(input.mode);

// ============================================================
// GAME LOOP
// ============================================================
let lastTime = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastTime) / 1000 || 0);
  lastTime = t;
  // Always poll input so gamepad pause toggle works even when paused
  readInput();
  if (run && run.active && !run.paused) {
    if (run.isMultiplayer) {
      mpTick(t, dt);
    } else {
      update(dt * run.slowmo);
      // Slowmo recovery
      if (run.slowmo < 1) run.slowmo = Math.min(1, run.slowmo + dt * 0.8);
    }
  }
  if (run && run.isMultiplayer) {
    mpRender();
  } else {
    render();
  }
  requestAnimationFrame(loop);
}
let lastMpInputAt = 0;
requestAnimationFrame(loop);

function update(dt) {
  run.timeElapsed += dt;
  if (run.warp) {
    // Hyperspace: nothing to fight, just the jump
    updateWarp(dt);
    tickShipCosmetics(run.player, dt);
    updateParticles(dt);
    updateFx(dt);
    return;
  }
  updatePlayer(dt);
  updateSpawning(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateEnemyProjectiles(dt);
  updateBeams(dt);
  updateHazards(dt);
  updateDrones(dt);
  updateTurrets(dt);
  updateMedics(dt);
  updateSnakeTurrets(dt);
  updateSnakes(dt);
  updatePowerupDrops(dt);
  updateParticles(dt);
  updatePickups(dt);
  updateCombo(dt);
  updateCooldowns(dt);
  updateFx(dt);
  checkWaveClear();
  if (run.screenShake > 0) run.screenShake = Math.max(0, run.screenShake - dt * 30);
}

// Bank, engine pulse and engine trail for any ship drawn with drawPlayer().
// Uses p.lastX/p.lastY (position at the start of the frame) to find motion.
function tickShipCosmetics(p, dt) {
  const dx = p.x - p.lastX, dy = p.y - p.lastY;
  const moveSpeed = Math.hypot(dx, dy);

  // Bank: how much the ship is moving "sideways" relative to its aim direction
  // Cross product of (move dir) x (aim dir) gives signed lateral amount
  if (moveSpeed > 0.5 && moveSpeed < 100) {
    const mdx = dx / moveSpeed;
    const mdy = dy / moveSpeed;
    const cross = Math.cos(p.angle) * mdy - Math.sin(p.angle) * mdx;
    const targetBank = Math.max(-0.35, Math.min(0.35, cross * 0.6));
    p.bank += (targetBank - p.bank) * 0.2;
  } else {
    p.bank += (0 - p.bank) * 0.12;
  }

  // Engine pulse animation
  p.enginePulse = (p.enginePulse + dt * 12) % (Math.PI * 2);

  // Trail: push a point every frame, keep ~12
  p.trail.push({ x: p.x, y: p.y, age: 0 });
  if (p.trail.length > 14) p.trail.shift();
  for (const t of p.trail) t.age += dt;
}

function updatePlayer(dt) {
  const p = run.player;
  p.lastX = p.x; p.lastY = p.y;
  // Use unified input (populated by readInput before update)
  let vx = input.moveX;
  let vy = input.moveY;
  // Compute target position
  const targetX = p.x + vx * p.speed * dt;
  const targetY = p.y + vy * p.speed * dt;
  // Resolve against obstacles (slides along walls)
  const resolved = resolveCircleMove(p.x, p.y, targetX, targetY, p.r);
  p.x = resolved.x;
  p.y = resolved.y;
  wrapPlayer(p);
  p.angle = input.aimAngle;

  tickShipCosmetics(p, dt);

  if (p.iframes > 0) p.iframes -= dt;
  if (p.invulnDash > 0) p.invulnDash -= dt;
  if (p.dashCD > 0) p.dashCD -= dt;
  if (p.shieldMax && !p.shieldUp) {
    p.shieldCD -= dt;
    if (p.shieldCD <= 0) p.shieldUp = true;
  }
  if (p.fireFlash > 0) p.fireFlash -= dt;

  // Handle dash request (one-shot)
  if (input.dashRequested) {
    tryDash();
    input.dashRequested = false;
  }

  // Auto-fire while firing input held
  if (input.firing && p.fireCD <= 0) {
    firePlayer();
    // Rapid fire powerup halves cooldown between shots
    const rateMul = run.weapons.rapidFireTimer > 0 ? 0.5 : 1;
    p.fireCD = run.weapons.fireRate * rateMul;
    p.fireFlash = 0.08;
  }
  if (p.fireCD > 0) p.fireCD -= dt;

  // Regen passive (Nanite Weave meta node)
  if (run.passives.regenInterval > 0 && p.hp < p.maxHp) {
    p.regenTimer += dt;
    if (p.regenTimer >= run.passives.regenInterval) {
      p.regenTimer = 0;
      p.hp = Math.min(p.maxHp, p.hp + 1);
      spawnFloat(p.x, p.y - 20, '+1 HP', '#39ff14', 14);
    }
  }

  // Update dash button cooldown visual
  if (input.mode === 'touch') {
    const db = document.getElementById('dashBtn');
    db.classList.toggle('cooldown', p.dashCD > 0);
    const tb = document.getElementById('turretBtn');
    if (tb) {
      tb.style.display = run.maxTurrets > 0 ? 'flex' : 'none';
      tb.classList.toggle('cooldown', run.turretDeployCD > 0);
    }
    const mb = document.getElementById('medicBtn');
    if (mb) {
      mb.style.display = run.maxMedics > 0 ? 'flex' : 'none';
      mb.classList.toggle('cooldown', run.medicDeployCD > 0);
    }
    const sb = document.getElementById('snakeBtn');
    if (sb) {
      sb.style.display = run.maxSnakeTurrets > 0 ? 'flex' : 'none';
      sb.classList.toggle('cooldown', run.snakeTurretDeployCD > 0);
    }
  }
}

function firePlayer() {
  playSound('shoot');
  const w = run.weapons;
  const count = w.projectileCount;
  const spread = w.spread;
  const baseAngle = run.player.angle;

  // Damage boost powerup doubles damage while active
  const dmgMul = w.damageBoostTimer > 0 ? 2 : 1;

  // Track shot counter for missile rack
  run.weapons.shotCount = (run.weapons.shotCount || 0) + 1;
  const missileFire = w.missileRack > 0 && (run.weapons.shotCount % 4 === 0);

  for (let i = 0; i < count; i++) {
    let angle = baseAngle;
    if (count > 1) {
      const t = i / (count - 1);
      angle += (t - 0.5) * spread;
    }
    const isCrit = gameRand() < w.crit;
    run.projectiles.push({
      x: run.player.x + Math.cos(angle) * 16,
      y: run.player.y + Math.sin(angle) * 16,
      vx: Math.cos(angle) * w.projectileSpeed,
      vy: Math.sin(angle) * w.projectileSpeed,
      damage: w.damage * dmgMul * (isCrit ? 2 : 1),
      crit: isCrit,
      r: run.beamMode ? 5 : 3,
      life: run.beamMode ? 3 : 2,
      pierce: run.beamMode ? 99 : w.pierce,
      hitIds: new Set(),
      homing: w.homing,
      explosive: w.explosive,
      ricochet: w.ricochet,
      beam: run.beamMode
    });
  }

  // Missile rack: fire homing missiles every 4th shot (count per missileRack level)
  if (missileFire) {
    for (let k = 0; k < w.missileRack; k++) {
      const offsetAngle = baseAngle + (k - (w.missileRack - 1) / 2) * 0.25;
      run.projectiles.push({
        x: run.player.x + Math.cos(offsetAngle) * 16,
        y: run.player.y + Math.sin(offsetAngle) * 16,
        vx: Math.cos(offsetAngle) * w.projectileSpeed * 0.7,
        vy: Math.sin(offsetAngle) * w.projectileSpeed * 0.7,
        damage: w.damage * dmgMul * 2.5,
        crit: false,
        r: 5,
        life: 3,
        pierce: 0,
        hitIds: new Set(),
        homing: 2,   // missiles home strongly
        explosive: 1,
        ricochet: 0,
        missile: true
      });
    }
  }

  // Muzzle flash
  for (let i = 0; i < 4; i++) {
    run.particles.push({
      x: run.player.x + Math.cos(baseAngle) * 18,
      y: run.player.y + Math.sin(baseAngle) * 18,
      vx: Math.cos(baseAngle) * (100 + Math.random() * 100) + (Math.random() - 0.5) * 60,
      vy: Math.sin(baseAngle) * (100 + Math.random() * 100) + (Math.random() - 0.5) * 60,
      life: 0.15, maxLife: 0.15,
      color: '#ff2d95', size: 2
    });
  }
}

// ============================================================
// DRONES (orbiting friendly gunners)
// ============================================================
// Single-player ship perks (shared/ships.json); the multiplayer server
// applies the same numbers in NeonDriftRoom.
function applyShipPerks(ship) {
  const s = ship.stats || {};
  const p = run.player;
  if (s.hp) { p.maxHp = Math.max(1, p.maxHp + s.hp); p.hp = p.maxHp; }
  if (s.speed) p.speed *= s.speed;
  if (s.dashCD) p.dashMax *= s.dashCD;
  if (s.fireRate) run.weapons.fireRate /= s.fireRate;
  if (s.damage) run.weapons.damage *= s.damage;
  if (s.pierce) run.weapons.pierce += s.pierce;
  if (s.crit) run.weapons.crit += s.crit;
  if (s.magnet) run.passives.magnetRadius *= s.magnet;
  if (s.shield) { p.shieldMax = s.shield; p.shieldCD = 0; p.shieldUp = true; }
  for (let i = 0; i < (s.drones || 0); i++) spawnDrone();
}

function spawnDrone() {
  run.drones.push({
    orbitAngle: Math.random() * Math.PI * 2,
    orbitRadius: 44,
    fireCD: 0.15 + gameRand() * 0.3,
    x: run.player.x,
    y: run.player.y,
    angle: 0
  });
  toast('Combat drone online');
}

function updateDrones(dt) {
  if (!run.drones || run.drones.length === 0) return;
  const p = run.player;
  const count = run.drones.length;
  for (let i = 0; i < count; i++) {
    const d = run.drones[i];
    // Distribute drones evenly around player, with slow orbit rotation
    const baseOffset = (i / count) * Math.PI * 2;
    d.orbitAngle = (d.orbitAngle || 0) + dt * 2;
    const a = baseOffset + d.orbitAngle * 0.15;
    d.x = p.x + Math.cos(a) * d.orbitRadius;
    d.y = p.y + Math.sin(a) * d.orbitRadius;

    // Find nearest enemy within range
    let nearest = null, nd = 380;
    for (const e of run.enemies) {
      if (e.intangible) continue;
      const ed = Math.hypot(e.x - d.x, e.y - d.y);
      if (ed < nd) { nd = ed; nearest = e; }
    }
    if (nearest) {
      d.angle = Math.atan2(nearest.y - d.y, nearest.x - d.x);
      d.fireCD -= dt;
      if (d.fireCD <= 0) {
        d.fireCD = 0.5;  // drones fire every half second
        const spd = 600;
        run.projectiles.push({
          x: d.x, y: d.y,
          vx: Math.cos(d.angle) * spd,
          vy: Math.sin(d.angle) * spd,
          damage: run.weapons.damage * 0.6,   // drones do 60% of main damage
          crit: false,
          r: 3,
          life: 1.5,
          pierce: 0,
          hitIds: new Set(),
          homing: 0,
          explosive: 0,
          ricochet: 0,
          drone: true
        });
      }
    }
  }
}

function drawDrones() {
  if (!run.drones || run.drones.length === 0) return;
  for (const d of run.drones) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 15;
    // Small ship-like shape: triangle with cyan glow
    ctx.strokeStyle = '#00f0ff';
    ctx.fillStyle = 'rgba(10, 40, 60, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Central dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================
// TURRETS (deployable stationary gunners)
// ============================================================
function tryDeployTurret() {
  if (!run || !run.active || run.paused) return;
  if (run.maxTurrets <= 0) return;
  if (run.turretDeployCD > 0) return;
  // If at max, remove oldest
  if (run.turrets.length >= run.maxTurrets) {
    const oldest = run.turrets.shift();
    spawnExplosion(oldest.x, oldest.y, '#ffea00', 20);
  }
  const p = run.player;
  // Place slightly behind the player
  const placeX = p.x - Math.cos(p.angle) * 30;
  const placeY = p.y - Math.sin(p.angle) * 30;
  // Don't place inside obstacles
  if (isInsideObstacle(placeX, placeY, 14)) {
    toast('No room to deploy');
    return;
  }
  run.turrets.push({
    x: placeX, y: placeY,
    angle: 0,
    fireCD: 0.3,
    life: 20,    // turrets last 20 seconds
    maxLife: 20
  });
  run.turretDeployCD = 0.15;  // rapid deploy
  spawnExplosion(placeX, placeY, '#ffea00', 16);
  toast(`Turret deployed (${run.turrets.length}/${run.maxTurrets})`);
}

function updateTurrets(dt) {
  if (run.turretDeployCD > 0) run.turretDeployCD -= dt;
  if (!run.turrets || run.turrets.length === 0) return;
  for (let i = run.turrets.length - 1; i >= 0; i--) {
    const t = run.turrets[i];
    t.life -= dt;
    if (t.life <= 0) {
      spawnExplosion(t.x, t.y, '#ffea00', 18);
      run.turrets.splice(i, 1);
      continue;
    }
    // Find nearest enemy in range
    let nearest = null, nd = 420;
    for (const e of run.enemies) {
      if (e.intangible) continue;
      const ed = Math.hypot(e.x - t.x, e.y - t.y);
      if (ed < nd) { nd = ed; nearest = e; }
    }
    if (nearest) {
      t.angle = Math.atan2(nearest.y - t.y, nearest.x - t.x);
      t.fireCD -= dt;
      if (t.fireCD <= 0) {
        t.fireCD = 0.35;
        const spd = 700;
        run.projectiles.push({
          x: t.x + Math.cos(t.angle) * 14,
          y: t.y + Math.sin(t.angle) * 14,
          vx: Math.cos(t.angle) * spd,
          vy: Math.sin(t.angle) * spd,
          damage: run.weapons.damage * 0.8,
          crit: false,
          r: 3,
          life: 1.5,
          pierce: 0,
          hitIds: new Set(),
          homing: 0,
          explosive: 0,
          ricochet: 0,
          turret: true
        });
      }
    }
  }
}

function drawTurrets() {
  if (!run.turrets || run.turrets.length === 0) return;
  for (const t of run.turrets) {
    ctx.save();
    ctx.translate(t.x, t.y);
    // Lifetime warning flash when about to expire
    const lifeFrac = t.life / t.maxLife;
    const flashing = lifeFrac < 0.25 && Math.floor(t.life * 6) % 2 === 0;
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 18;
    // Hex base
    ctx.fillStyle = flashing ? 'rgba(255, 234, 0, 0.3)' : 'rgba(40, 30, 0, 0.85)';
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = Math.cos(a) * 14;
      const y = Math.sin(a) * 14;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Rotating barrel
    ctx.save();
    ctx.rotate(t.angle);
    ctx.fillStyle = '#ffea00';
    ctx.fillRect(0, -2, 16, 4);
    ctx.beginPath();
    ctx.arc(16, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Central cap
    ctx.fillStyle = '#1a1a00';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Life ring
    ctx.strokeStyle = flashing ? '#ff3860' : 'rgba(255, 234, 0, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + lifeFrac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================
// MEDIC TURRETS (stationary healing auras)
// ============================================================
const MEDIC_HEAL_RADIUS = 90;
const MEDIC_HEAL_INTERVAL = 3;  // seconds between heal ticks

function tryDeployMedic() {
  if (!run || !run.active || run.paused) return;
  if (run.maxMedics <= 0) return;
  if (run.medicDeployCD > 0) return;
  // If at max, remove oldest
  if (run.medics.length >= run.maxMedics) {
    const oldest = run.medics.shift();
    spawnExplosion(oldest.x, oldest.y, '#39ff14', 20);
  }
  const p = run.player;
  // Place slightly behind the player
  const placeX = p.x - Math.cos(p.angle) * 30;
  const placeY = p.y - Math.sin(p.angle) * 30;
  if (isInsideObstacle(placeX, placeY, 14)) {
    toast('No room to deploy');
    return;
  }
  run.medics.push({
    x: placeX, y: placeY,
    life: 20,
    maxLife: 20,
    healTimer: 0,
    pulseT: 0
  });
  run.medicDeployCD = 0.15;
  spawnExplosion(placeX, placeY, '#39ff14', 16);
  toast(`Medic deployed (${run.medics.length}/${run.maxMedics})`);
}

function updateMedics(dt) {
  if (run.medicDeployCD > 0) run.medicDeployCD -= dt;
  if (!run.medics || run.medics.length === 0) return;
  const p = run.player;
  for (let i = run.medics.length - 1; i >= 0; i--) {
    const m = run.medics[i];
    m.life -= dt;
    m.pulseT = (m.pulseT || 0) + dt;
    if (m.life <= 0) {
      spawnExplosion(m.x, m.y, '#39ff14', 18);
      run.medics.splice(i, 1);
      continue;
    }
    // Heal the player if within range
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist < MEDIC_HEAL_RADIUS && p.hp < p.maxHp) {
      m.healTimer = (m.healTimer || 0) + dt;
      if (m.healTimer >= MEDIC_HEAL_INTERVAL) {
        m.healTimer = 0;
        p.hp = Math.min(p.maxHp, p.hp + 1);
        spawnFloat(p.x, p.y - 24, '+1 HP', '#39ff14', 14);
        // Healing beam particles from medic to player
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          run.particles.push({
            x: m.x + dx * t,
            y: m.y + dy * t,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: 0.6, maxLife: 0.6,
            color: '#39ff14', size: 2
          });
        }
      }
    } else {
      // Reset timer if out of range so you don't instantly heal on re-entry
      m.healTimer = Math.max(0, (m.healTimer || 0) - dt * 0.5);
    }
  }
}

function drawMedics() {
  if (!run.medics || run.medics.length === 0) return;
  const p = run.player;
  for (const m of run.medics) {
    const lifeFrac = m.life / m.maxLife;
    const flashing = lifeFrac < 0.25 && Math.floor(m.life * 6) % 2 === 0;
    // Heal aura circle (shows radius)
    const dx = p.x - m.x, dy = p.y - m.y;
    const inRange = Math.hypot(dx, dy) < MEDIC_HEAL_RADIUS;
    ctx.save();
    ctx.strokeStyle = inRange ? 'rgba(57, 255, 20, 0.5)' : 'rgba(57, 255, 20, 0.2)';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = inRange ? 18 : 8;
    ctx.lineWidth = inRange ? 2 : 1;
    // Pulsing radius ring
    const pulseR = MEDIC_HEAL_RADIUS + Math.sin(m.pulseT * 3) * 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, pulseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Medic body
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 20;
    // Circular base
    ctx.fillStyle = flashing ? 'rgba(57, 255, 20, 0.35)' : 'rgba(10, 40, 10, 0.9)';
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Inner ring
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    // Rotating plus sign (medical cross)
    ctx.save();
    ctx.rotate(m.pulseT * 1.2);
    ctx.fillStyle = '#39ff14';
    ctx.shadowBlur = 14;
    const crossArm = 8;
    const crossThick = 3;
    ctx.fillRect(-crossThick / 2, -crossArm, crossThick, crossArm * 2);
    ctx.fillRect(-crossArm, -crossThick / 2, crossArm * 2, crossThick);
    ctx.restore();
    // Central white glow
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 18;
    const glow = 0.6 + Math.sin(m.pulseT * 4) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 2 * glow, 0, Math.PI * 2);
    ctx.fill();
    // Life ring
    ctx.strokeStyle = flashing ? '#ff3860' : 'rgba(57, 255, 20, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + lifeFrac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================
// SNAKE TURRETS (shoot wiggling homing snake projectiles)
// ============================================================
function tryDeploySnakeTurret() {
  if (!run || !run.active || run.paused) return;
  if (run.maxSnakeTurrets <= 0) return;
  if (run.snakeTurretDeployCD > 0) return;
  if (run.snakeTurrets.length >= run.maxSnakeTurrets) {
    const oldest = run.snakeTurrets.shift();
    spawnExplosion(oldest.x, oldest.y, '#bc8cff', 20);
  }
  const p = run.player;
  const placeX = p.x - Math.cos(p.angle) * 30;
  const placeY = p.y - Math.sin(p.angle) * 30;
  if (isInsideObstacle(placeX, placeY, 14)) {
    toast('No room to deploy');
    return;
  }
  run.snakeTurrets.push({
    x: placeX, y: placeY,
    life: 20,
    maxLife: 20,
    fireCD: 0.6,
    pulseT: 0
  });
  run.snakeTurretDeployCD = 0.15;
  spawnExplosion(placeX, placeY, '#bc8cff', 16);
  toast(`Snake turret deployed (${run.snakeTurrets.length}/${run.maxSnakeTurrets})`);
}

function updateSnakeTurrets(dt) {
  if (run.snakeTurretDeployCD > 0) run.snakeTurretDeployCD -= dt;
  if (!run.snakeTurrets || run.snakeTurrets.length === 0) return;
  for (let i = run.snakeTurrets.length - 1; i >= 0; i--) {
    const st = run.snakeTurrets[i];
    st.life -= dt;
    st.pulseT = (st.pulseT || 0) + dt;
    if (st.life <= 0) {
      spawnExplosion(st.x, st.y, '#bc8cff', 18);
      run.snakeTurrets.splice(i, 1);
      continue;
    }
    // Find a random enemy to target (not always nearest, for variety)
    let nearest = null, nd = 600;
    for (const e of run.enemies) {
      if (e.intangible) continue;
      const ed = Math.hypot(e.x - st.x, e.y - st.y);
      if (ed < nd) { nd = ed; nearest = e; }
    }
    if (nearest) {
      st.fireCD -= dt;
      if (st.fireCD <= 0) {
        st.fireCD = 0.8;  // shoot a snake every 0.8s
        spawnSnake(st.x, st.y, Math.atan2(nearest.y - st.y, nearest.x - st.x));
      }
    }
  }
}

function spawnSnake(x, y, angle) {
  run.snakes.push({
    x, y,
    angle,
    life: 6,
    maxLife: 6,
    t: 0,
    damage: run.weapons.damage * 1.2,
    hitIds: new Set(),     // which enemies this snake has hit (pierce)
    hitCount: 0,           // how many enemies this snake has bitten
    maxHits: 5,            // snake dies after 5 bites
    segments: []           // trail of past positions for the body
  });
}

function updateSnakes(dt) {
  if (!run.snakes || run.snakes.length === 0) return;
  for (let i = run.snakes.length - 1; i >= 0; i--) {
    const s = run.snakes[i];
    s.life -= dt;
    s.t += dt;
    if (s.life <= 0) {
      run.snakes.splice(i, 1);
      continue;
    }
    // Home toward nearest enemy (gently, so it wiggles while pursuing)
    let nearest = null, nd = 500;
    for (const e of run.enemies) {
      if (e.intangible || s.hitIds.has(e)) continue;
      const ed = Math.hypot(e.x - s.x, e.y - s.y);
      if (ed < nd) { nd = ed; nearest = e; }
    }
    if (nearest) {
      const targetAngle = Math.atan2(nearest.y - s.y, nearest.x - s.x);
      let diff = targetAngle - s.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      s.angle += diff * 2 * dt;  // turn toward target
    }
    // Wiggle! Sine wave added perpendicular to motion direction
    const wiggleAmp = 1.2;  // how much it sways
    const wiggleFreq = 10;  // how fast it oscillates
    const wiggle = Math.sin(s.t * wiggleFreq) * wiggleAmp;
    const moveAngle = s.angle + wiggle * 0.4;
    // Always move at current player speed (upgrades apply to existing snakes too)
    const currentSpeed = run.player.speed;
    s.x += Math.cos(moveAngle) * currentSpeed * dt;
    s.y += Math.sin(moveAngle) * currentSpeed * dt;

    // Record segment trail for body rendering
    s.segments.push({ x: s.x, y: s.y });
    if (s.segments.length > 18) s.segments.shift();

    // Destroy at canvas edge
    if (s.x < -30 || s.x > W + 30 || s.y < -30 || s.y > H + 30) {
      run.snakes.splice(i, 1);
      continue;
    }

    // Destroy if hit obstacle
    if (run.obstacles && run.obstacles.length > 0 && isInsideObstacle(s.x, s.y, 6)) {
      spawnHitParticles(s.x, s.y, '#bc8cff');
      run.snakes.splice(i, 1);
      continue;
    }

    // Bite any enemy we touch (once per enemy, limited total bites)
    for (const e of run.enemies) {
      if (e.intangible || s.hitIds.has(e)) continue;
      if (enemyHitTest(e, s.x, s.y, 7)) {
        damageEnemy(e, s.damage);
        s.hitIds.add(e);
        s.hitCount++;
        spawnHitParticles(s.x, s.y, '#bc8cff');
        if (e.hp <= 0) killEnemy(run.enemies.indexOf(e));
        if (s.hitCount >= s.maxHits) {
          // Snake is tired, explode into particles
          spawnExplosion(s.x, s.y, '#bc8cff', 14);
          run.snakes.splice(i, 1);
          break;
        }
      }
    }
  }
}

function drawSnakes() {
  if (!run.snakes || run.snakes.length === 0) return;
  for (const s of run.snakes) {
    if (s.segments.length < 2) continue;
    ctx.save();
    ctx.shadowColor = '#bc8cff';
    ctx.shadowBlur = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Draw body as segmented path with varying thickness (tapered)
    const segs = s.segments;
    for (let i = segs.length - 1; i > 0; i--) {
      const a = segs[i];
      const b = segs[i - 1];
      const t = i / segs.length;
      // Alternating color stripes along the body
      const stripe = i % 2 === 0;
      ctx.strokeStyle = stripe ? '#bc8cff' : '#39ff14';
      ctx.lineWidth = 6 * t + 2;
      ctx.globalAlpha = 0.4 + t * 0.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Snake head at the leading position
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#bc8cff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    // Head shape (pointed)
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-2, -5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Eyes
    ctx.fillStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(2, -2, 1, 0, Math.PI * 2);
    ctx.arc(2, 2, 1, 0, Math.PI * 2);
    ctx.fill();
    // Tongue flicker (animated)
    if (Math.sin(s.t * 18) > 0) {
      ctx.strokeStyle = '#ff2d95';
      ctx.shadowColor = '#ff2d95';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(14, -2);
      ctx.moveTo(8, 0);
      ctx.lineTo(14, 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSnakeTurrets() {
  if (!run.snakeTurrets || run.snakeTurrets.length === 0) return;
  for (const st of run.snakeTurrets) {
    const lifeFrac = st.life / st.maxLife;
    const flashing = lifeFrac < 0.25 && Math.floor(st.life * 6) % 2 === 0;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.shadowColor = '#bc8cff';
    ctx.shadowBlur = 18;
    // Coiled snake body base (spiral)
    ctx.fillStyle = flashing ? 'rgba(188, 140, 255, 0.35)' : 'rgba(30, 10, 50, 0.9)';
    ctx.strokeStyle = '#bc8cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Coiled rings inside (snake coil pattern)
    ctx.strokeStyle = 'rgba(188, 140, 255, 0.6)';
    ctx.lineWidth = 1.5;
    for (let r = 10; r > 2; r -= 3) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Center glowing eye
    ctx.fillStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 14;
    const eye = 0.8 + Math.sin(st.pulseT * 3) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 3 * eye, 0, Math.PI * 2);
    ctx.fill();
    // Life ring
    ctx.strokeStyle = flashing ? '#ff3860' : 'rgba(188, 140, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#bc8cff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + lifeFrac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}


const POWERUPS = [
  { id: 'pu_heal',    name: 'Repair Pack',  icon: '❤', color: '#39ff14', chance: 1.0, apply: () => { run.player.hp = Math.min(run.player.maxHp, run.player.hp + 2); toast('+2 HP'); } },
  { id: 'pu_cores',   name: 'Core Cluster', icon: '⬡', color: '#ffea00', chance: 1.2, apply: () => { run.cores += 8; toast('+8 cores'); } },
  { id: 'pu_nuke',    name: 'Screen Wipe',  icon: '✺', color: '#ff2d95', chance: 0.4, apply: () => nukeScreen() },
  { id: 'pu_shield',  name: 'Shield',       icon: '◈', color: '#00f0ff', chance: 0.6, apply: () => { run.player.iframes = Math.max(run.player.iframes, 6); toast('Shield 6s'); } },
  { id: 'pu_rapid',   name: 'Rapid Fire',   icon: '🔥', color: '#ff6b35', chance: 0.8, apply: () => { run.weapons.rapidFireTimer = 8; toast('Rapid fire 8s'); } },
  { id: 'pu_magnet',  name: 'Super Magnet', icon: '🧲', color: '#b847ff', chance: 0.7, apply: () => { run.passives.superMagnetTimer = 10; toast('Mega magnet 10s'); } },
  { id: 'pu_damage',  name: 'Damage Boost', icon: '⚡', color: '#ffea00', chance: 0.6, apply: () => { run.weapons.damageBoostTimer = 10; toast('Damage x2 for 10s'); } }
];

function maybeDropPowerup(x, y, dropChanceMultiplier = 1) {
  // Base drop chance: 20%. Multiplier is higher for bosses.
  const base = 0.20 * dropChanceMultiplier;
  if (gameRand() > base) return;
  // Weighted pick from pool
  const totalWeight = POWERUPS.reduce((s, p) => s + p.chance, 0);
  let roll = gameRand() * totalWeight;
  let chosen = POWERUPS[0];
  for (const p of POWERUPS) {
    roll -= p.chance;
    if (roll <= 0) { chosen = p; break; }
  }
  run.droppedPowerups.push({
    x, y,
    vx: (Math.random() - 0.5) * 120,
    vy: (Math.random() - 0.5) * 120,
    r: 14,
    life: 12,
    maxLife: 12,
    t: 0,
    power: chosen
  });
}

function updatePowerupDrops(dt) {
  if (!run.droppedPowerups) return;
  const p = run.player;
  // Super magnet buff extends pickup range
  const mag = run.passives.magnetRadius * (run.passives.superMagnetTimer > 0 ? 4 : 1);
  for (let i = run.droppedPowerups.length - 1; i >= 0; i--) {
    const pk = run.droppedPowerups[i];
    pk.vx *= 0.95;
    pk.vy *= 0.95;
    pk.t += dt;
    pk.life -= dt;
    const dx = p.x - pk.x;
    const dy = p.y - pk.y;
    const d = Math.hypot(dx, dy);
    // Magnet
    if (d < mag) {
      const pull = 500;
      pk.vx += (dx / d) * pull * dt;
      pk.vy += (dy / d) * pull * dt;
    }
    pk.x += pk.vx * dt;
    pk.y += pk.vy * dt;
    // Expire
    if (pk.life <= 0) {
      run.droppedPowerups.splice(i, 1);
      continue;
    }
    // Pickup
    if (d < p.r + pk.r) {
      pk.power.apply();
      // Shiny pickup particles
      for (let k = 0; k < 20; k++) {
        const ang = Math.random() * Math.PI * 2;
        run.particles.push({
          x: pk.x, y: pk.y,
          vx: Math.cos(ang) * (80 + Math.random() * 200),
          vy: Math.sin(ang) * (80 + Math.random() * 200),
          life: 0.5, maxLife: 0.5,
          color: pk.power.color, size: 3
        });
      }
      run.droppedPowerups.splice(i, 1);
    }
  }

  // Tick down temporary buffs
  if (run.weapons.rapidFireTimer > 0) run.weapons.rapidFireTimer -= dt;
  if (run.weapons.damageBoostTimer > 0) run.weapons.damageBoostTimer -= dt;
  if (run.passives.superMagnetTimer > 0) run.passives.superMagnetTimer -= dt;
}

function drawPowerupDrops() {
  if (!run.droppedPowerups || run.droppedPowerups.length === 0) return;
  for (const pk of run.droppedPowerups) {
    ctx.save();
    ctx.translate(pk.x, pk.y);
    const pulse = 1 + Math.sin(pk.t * 5) * 0.15;
    const flashAlpha = pk.life < 3 && Math.floor(pk.life * 6) % 2 === 0 ? 0.4 : 1;
    ctx.globalAlpha = flashAlpha;
    // Rotating outer ring
    ctx.rotate(pk.t * 2);
    ctx.shadowColor = pk.power.color;
    ctx.shadowBlur = 25;
    ctx.strokeStyle = pk.power.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = Math.cos(a) * pk.r * pulse;
      const y = Math.sin(a) * pk.r * pulse;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    // Inner fill
    ctx.fillStyle = `${pk.power.color}22`;
    ctx.fill();
    // Icon (counter-rotate to keep upright)
    ctx.rotate(-pk.t * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 16px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pk.power.icon, 0, 0);
    ctx.restore();
  }
}

// Screen-wipe nuke powerup
function nukeScreen() {
  toast('NUKE!');
  run.screenShake = 25;
  // Damage all enemies on screen
  for (let i = run.enemies.length - 1; i >= 0; i--) {
    const e = run.enemies[i];
    if (!e || !damageEnemy(e, 100)) continue;
    if (e.hp <= 0) killEnemy(i);
  }
  // Clear all enemy projectiles
  for (const b of run.enemyProjectiles) {
    spawnHitParticles(b.x, b.y, b.color);
  }
  run.enemyProjectiles = [];
  // Big shockwave visual
  spawnShockwave(W / 2, H / 2, '#ff2d95');
  spawnShockwave(W / 2, H / 2, '#00f0ff');
  for (let k = 0; k < 60; k++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 300 + Math.random() * 600;
    run.particles.push({
      x: W / 2, y: H / 2,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.8, maxLife: 0.8,
      color: Math.random() < 0.5 ? '#ff2d95' : '#ffea00',
      size: 3
    });
  }
}

// ============================================================
// SPACE HAZARDS
// ============================================================
// The hazard rules live in shared/spaceSim.js (multiplayer runs the same
// code on the server). This is single player's side: the "hazard world"
// the sim plays in, plus sprites, effects and drawing.
const rockSpriteCache = new Map();

function rockSprite(sector, kind, tier, variant, ww = W, wh = H) {
  const r = rockRadius(tier, ww, wh);
  const key = `${sector.index}:${kind}:${r}:${variant}`;
  let s = rockSpriteCache.get(key);
  if (!s) {
    const colors = rockColors(sector, kind === 'stone' ? 'asteroid' : kind);
    s = makeRockSprite(r * 1.08, kind, colors, sector.index * 1000 + tier * 100 + variant * 7 + kind.length);
    rockSpriteCache.set(key, s);
  }
  return s;
}

const hazardWorld = {
  get W() { return W; },
  get H() { return H; },
  get sector() { return run.sector; },
  get hazards() { return run.hazards; },
  get obstacles() { return run.obstacles; },
  get clock() { return run.hazardClock; },
  set clock(v) { run.hazardClock = v; },
  get wells() { return run.wells; },
  set wells(v) { run.wells = v; },
  get diff() { return run.currentWaveInfo ? run.currentWaveInfo.diffMul : 1; },
  // Once the wave is clear, leftovers can't hurt you (you're picking an upgrade)
  get live() { return !run.waveCleared; },
  rand: () => (run.hazardRand || Math.random)(),
  pilots: () => [run.player],
  hurt: () => damagePlayer(1),
  enemies: () => run.enemies,
  isBoss: (e) => isBossType(e.type),
  hitEnemy: (e, amt) => {
    if (damageEnemy(e, amt) && e.hp <= 0) killEnemy(run.enemies.indexOf(e));
  },
  enemyShots: () => run.enemyProjectiles,
  dropShots: (pred) => { run.enemyProjectiles = run.enemyProjectiles.filter((b) => !pred(b)); },
  rockBroken: (h, shooter, points, dropCore) => {
    const rim = rockColors(run.sector, h.rockKind === 'stone' ? 'asteroid' : h.rockKind).rim;
    run.score += points;
    spawnFloat(h.x, h.y - h.r, `+${points}`, rim, 12);
    if (dropCore) run.pickups.push({ x: h.x, y: h.y, vx: 0, vy: 0, r: 6, life: 10, type: 'core' });
  },
  fx: (type, h) => {
    if (type === 'debris') {
      spawnRockDebris(h.x, h.y, h.r, rockColors(run.sector, h.rockKind === 'stone' ? 'asteroid' : h.rockKind).rim);
    } else if (type === 'mine') {
      spawnExplosion(h.x, h.y, '#ff3860', h.blast * 0.5);
      spawnShockwave(h.x, h.y, '#ffb347');
      run.screenShake = Math.max(run.screenShake, 9);
    } else if (type === 'wellGone') {
      spawnShockwave(h.x, h.y, h.color);
    } else if (type === 'cometTrail') {
      if (Math.random() < 0.6) {
        run.particles.push({ x: h.x, y: h.y, vx: -h.vx * 0.1 + (Math.random() - 0.5) * 60, vy: -h.vy * 0.1 + (Math.random() - 0.5) * 60, life: 0.5, maxLife: 0.5, color: '#bff4ff', size: 2 });
      }
    } else if (type === 'flare') {
      run.screenShake = Math.max(run.screenShake, 6);
    } else if (type === 'strike') {
      run.screenShake = Math.max(run.screenShake, 8);
      spawnExplosion(h.x, h.y, '#c08bff', 20);
    }
  }
};

function setupHazards(waveNum, info) {
  run.hazards = [];
  run.hazardRand = waveRng(waveNum, 0x4a2a);
  simSetupHazards(hazardWorld, waveNum, info.type !== 'regular');
}

function spawnHazard(kind, props) {
  return simSpawnHazard(hazardWorld, kind, props);
}

function updateHazards(dt) {
  simUpdateHazards(hazardWorld, dt);
}

function spawnRockDebris(x, y, r, rim) {
  const n = Math.min(18, 6 + Math.floor(r / 2));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 220;
    run.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
      color: i % 3 === 0 ? rim : '#8a7a6a', size: 1.5 + Math.random() * 2.5, debris: true
    });
  }
  run.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, color: rim, size: r * 0.6, ring: true });
}

// Telegraphs and floor-level hazards go under the action, rocks and mines
// in the middle, comets and lightning on top. `sector` picks rock sprites;
// ww/wh are the arena size (multiplayer draws its fixed world).
function drawHazards(layer, time, hazards = run.hazards, sector = run.sector, ww = W, wh = H) {
  for (const h of hazards) {
    if (layer === 'under') {
      if (h.kind === 'flare') drawFlare(ctx, h, ww, wh, time);
      else if (h.kind === 'gate') drawGate(ctx, h, time);
      else if (h.kind === 'pulse') drawPulse(ctx, h, time);
      else if (h.kind === 'well') drawWell(ctx, h, time);
    } else if (layer === 'mid') {
      if (h.kind === 'rock') drawRock(ctx, { x: h.x, y: h.y, rot: h.rot, hitFlash: h.hitFlash, sprite: rockSprite(sector, h.rockKind, h.tier, h.variant, ww, wh) });
      else if (h.kind === 'mine') drawMine(ctx, h, time);
    } else if (layer === 'over') {
      if (h.kind === 'comet') drawComet(ctx, h, time);
      else if (h.kind === 'strike') drawStrike(ctx, h, time);
    }
  }
}

function updateSpawning(dt) {
  run.spawnTimer += dt;
  while (run.spawnQueue.length > 0 && run.spawnTimer >= run.spawnQueue[0].delay) {
    const q = run.spawnQueue.shift();
    run.spawnTimer -= q.delay;
    const e = spawnEnemy(q.type, q.scale || 1, q.diff || 1);
    if (q.twists) applyBossTwists(e, q.twists);
  }
}

// ---- Weekly challenge boss twists (weekly.js TWISTS) ----
function applyBossTwists(e, twists) {
  if (!e || !twists.length) return;
  e.twists = twists;
  e.lastHitT = 0;
  if (twists.includes('fortified')) { e.hp *= 1.5; e.maxHp *= 1.5; }
  if (twists.includes('overclocked')) { e.aiRate = 1.3; e.baseSpeed *= 1.15; e.fireRate /= 1.3; }
  if (twists.includes('bulwark')) e.bulwarkT = 5;
  if (twists.includes('escorted')) e.escortT = 4;
}

function updateBossTwists(e, dt) {
  const tw = e.twists;
  if (tw.includes('bulwark')) {
    // 2s of shield, 6s open
    e.bulwarkT -= dt;
    if (e.bulwarkT <= 0) {
      e.twistShield = !e.twistShield;
      e.bulwarkT = e.twistShield ? 2 : 6;
    }
  }
  if (tw.includes('escorted')) {
    e.escortT -= dt;
    if (e.escortT <= 0) {
      e.escortT = 9;
      const alive = run.enemies.filter((m) => m.owner === e && m.type === 'fighter').length;
      for (let k = alive; k < Math.min(4, alive + 2); k++) {
        spawnMinion('fighter', e.x + (k % 2 ? 1 : -1) * e.r * 1.6, e.y + e.r, e);
      }
    }
  }
  if (tw.includes('regenerating') && e.t - e.lastHitT > 3 && e.hp < e.maxHp) {
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt);
  }
}

function drawTwistShield(e) {
  ctx.save();
  ctx.strokeStyle = 'rgba(127, 220, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.lineDashOffset = -(run.timeElapsed || 0) * 40;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.5, 0, TAU); ctx.stroke();
  // Multi-part bosses (Binary's stars, Dreadnought's turrets) get a ring per part
  if (e.parts) for (const pt of e.parts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * 1.4, 0, TAU); ctx.stroke(); }
  ctx.restore();
  drawGlowSprite(e.x, e.y, e.r * 1.8, '#7fdcff', 0.25);
}

function updateEnemies(dt) {
  const p = run.player;
  for (let i = run.enemies.length - 1; i >= 0; i--) {
    const e = run.enemies[i];
    e.t += dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const spd = e.baseSpeed;

    if (e.twists) updateBossTwists(e, dt);
    if (updateSpaceEnemy(e, e.aiRate ? dt * e.aiRate : dt, bossApi)) {
      // Sector bosses and their adds run in bosses.js
    } else if (e.ai === 'chase') {
      e.vx = (dx / dist) * spd;
      e.vy = (dy / dist) * spd;
    } else if (e.ai === 'zigzag') {
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const wobble = Math.sin(e.t * 4) * 0.7;
      e.vx = (dx / dist + perpX * wobble) * spd;
      e.vy = (dy / dist + perpY * wobble) * spd;
    } else if (e.ai === 'turret') {
      const targetDist = 260;
      if (dist > targetDist + 40) {
        e.vx = (dx / dist) * spd;
        e.vy = (dy / dist) * spd;
      } else {
        e.vx *= 0.9; e.vy *= 0.9;
      }
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const ang = Math.atan2(dy, dx);
        enemyShoot(e.x, e.y, ang, 260, '#ffea00');
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'weaver') {
      const targetDist = 220;
      const tangent = Math.atan2(dy, dx) + Math.PI / 2;
      const desiredX = p.x - (dx / dist) * targetDist;
      const desiredY = p.y - (dy / dist) * targetDist;
      const ddx = desiredX - e.x;
      const ddy = desiredY - e.y;
      const dmag = Math.hypot(ddx, ddy) || 1;
      e.vx = (ddx / dmag + Math.cos(tangent) * 0.6) * spd;
      e.vy = (ddy / dmag + Math.sin(tangent) * 0.6) * spd;
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const ang = Math.atan2(dy, dx);
        enemyShoot(e.x, e.y, ang, 340, '#b847ff');
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'phantom') {
      // Blinks in and out of visibility, chases fast
      e.phantomCycle += dt;
      const phase = (e.phantomCycle % 3) / 3;
      e.visible = phase < 0.65; // invisible for the last ~35% of cycle
      e.intangible = !e.visible;
      e.vx = (dx / dist) * spd * (e.visible ? 1 : 1.3);
      e.vy = (dy / dist) * spd * (e.visible ? 1 : 1.3);
    } else if (e.ai === 'bomber') {
      // Approaches and lobs slow bomb clusters
      const targetDist = 200;
      if (dist > targetDist + 30) {
        e.vx = (dx / dist) * spd;
        e.vy = (dy / dist) * spd;
      } else {
        e.vx *= 0.85; e.vy *= 0.85;
      }
      e.fireCD -= dt;
      if (e.fireCD <= 0 && dist < 500) {
        // Lob a cluster of 5 bombs in a tight arc
        const ang = Math.atan2(dy, dx);
        for (let k = -2; k <= 2; k++) {
          enemyShoot(e.x, e.y, ang + k * 0.08, 180, '#ff6b35');
        }
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'lancer') {
      // Charges in straight lines toward player, pausing to aim
      e.lancerCharge -= dt;
      if (e.lancerCharge <= 0) {
        // Lock in aim direction, then charge
        e.angle = Math.atan2(dy, dx);
        e.lancerCharge = 1.6;
      }
      const chargeRatio = e.lancerCharge / 1.6;
      if (chargeRatio > 0.7) {
        // Winding up - slow down
        e.vx *= 0.88; e.vy *= 0.88;
      } else {
        // Charging
        e.vx = Math.cos(e.angle) * spd * 2.3;
        e.vy = Math.sin(e.angle) * spd * 2.3;
      }
      e.fireCD -= dt;
      if (e.fireCD <= 0 && chargeRatio < 0.5) {
        enemyShoot(e.x, e.y, e.angle, 450, '#ffffff');
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'obelisk') {
      // Slow moving spire that emits rotating beam pattern
      const targetY = H * 0.25;
      const targetX = W / 2 + Math.sin(e.t * 0.4) * (W * 0.2);
      e.vx = (targetX - e.x) * 0.8;
      e.vy = (targetY - e.y) * 0.8;
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const hpFrac = e.hp / e.maxHp;
        const rayCount = hpFrac > 0.5 ? 4 : 6;
        for (let k = 0; k < rayCount; k++) {
          const ang = (k / rayCount) * Math.PI * 2 + e.t * 1.2;
          enemyShoot(e.x, e.y, ang, 240, '#b847ff');
        }
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'hive') {
      // Spawns adds every firecycle, roams
      const targetDist = 280;
      const tangent = Math.atan2(dy, dx) + Math.PI / 2;
      const desiredX = p.x - (dx / dist) * targetDist;
      const desiredY = p.y - (dy / dist) * targetDist;
      const ddx = desiredX - e.x;
      const ddy = desiredY - e.y;
      const dmag = Math.hypot(ddx, ddy) || 1;
      e.vx = (ddx / dmag) * spd + Math.cos(tangent) * spd * 0.4;
      e.vy = (ddy / dmag) * spd + Math.sin(tangent) * spd * 0.4;
      e.fireCD -= dt;
      if (e.fireCD <= 0 && run.enemies.length < 30) {
        // Spawn 2 grunt adds at own position
        for (let k = 0; k < 2; k++) {
          const adjInfo = run.currentWaveInfo;
          const last = spawnEnemy('grunt', 0.5, adjInfo ? adjInfo.diffMul * 0.6 : 1);
          // Move it to near the hive; adds die with their hive
          last.x = e.x + (gameRand() - 0.5) * 40;
          last.y = e.y + (gameRand() - 0.5) * 40;
          last.owner = e;
          last.minion = true;
        }
        spawnExplosion(e.x, e.y, '#39ff14', 25);
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'sentinel') {
      // Heavy chaser with 3-burst shots in aimed direction
      e.vx = (dx / dist) * spd;
      e.vy = (dy / dist) * spd;
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const ang = Math.atan2(dy, dx);
        // 3-burst tight spread
        for (let k = -1; k <= 1; k++) {
          enemyShoot(e.x, e.y, ang + k * 0.14, 320, '#ffea00');
        }
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'prism') {
      // Kite-distance boss with rotating bullet patterns that reflect color
      const targetDist = 320;
      const tangent = Math.atan2(dy, dx) + Math.PI / 2;
      const desiredX = p.x - (dx / dist) * targetDist;
      const desiredY = p.y - (dy / dist) * targetDist;
      const ddx = desiredX - e.x;
      const ddy = desiredY - e.y;
      const dmag = Math.hypot(ddx, ddy) || 1;
      e.vx = (ddx / dmag + Math.cos(tangent) * 0.8) * spd;
      e.vy = (ddy / dmag + Math.sin(tangent) * 0.8) * spd;
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const hpFrac = e.hp / e.maxHp;
        // 3 interleaving spirals
        const colors = ['#5ac8fa', '#ff2d95', '#ffea00'];
        for (let c = 0; c < 3; c++) {
          const ang = e.t * (c === 0 ? 1.2 : c === 1 ? -1.5 : 0.9) + c * (Math.PI * 2 / 3);
          enemyShoot(e.x, e.y, ang, 240 + c * 20, colors[c]);
          if (hpFrac < 0.5) {
            enemyShoot(e.x, e.y, ang + Math.PI, 240 + c * 20, colors[c]);
          }
        }
        e.fireCD = e.fireRate;
      }
    } else if (e.ai === 'warden') {
      // Mega-boss with 3 phases, now also with a 4th "enraged" phase at low HP
      const targetY = H * 0.22;
      const targetX = W / 2 + Math.sin(e.t * 0.7) * (W * 0.25);
      e.vx = (targetX - e.x) * 1.2;
      e.vy = (targetY - e.y) * 1.2;
      e.fireCD -= dt;
      if (e.fireCD <= 0) {
        const hpFrac = e.hp / e.maxHp;
        if (hpFrac < 0.25) e.phase = 3;
        else if (hpFrac < 0.5) e.phase = 2;
        else if (hpFrac < 0.8) e.phase = 1;
        else e.phase = 0;

        if (e.phase === 0) {
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + e.t * 0.3;
            enemyShoot(e.x, e.y, ang, 220, '#ff3860');
          }
          e.fireCD = 1.2;
        } else if (e.phase === 1) {
          const ang = Math.atan2(dy, dx);
          for (let k = -2; k <= 2; k++) enemyShoot(e.x, e.y, ang + k * 0.18, 280, '#ff3860');
          for (let k = 0; k < 4; k++) enemyShoot(e.x, e.y, e.t * 2 + k * Math.PI / 2, 200, '#ff2d95');
          e.fireCD = 0.9;
        } else if (e.phase === 2) {
          for (let k = 0; k < 12; k++) {
            const ang = (k / 12) * Math.PI * 2 + e.t * 0.6;
            enemyShoot(e.x, e.y, ang, 200, '#ff3860');
            enemyShoot(e.x, e.y, ang + Math.PI / 12, 260, '#ff2d95');
          }
          const ang = Math.atan2(dy, dx);
          for (let k = -1; k <= 1; k++) enemyShoot(e.x, e.y, ang + k * 0.1, 360, '#ffea00');
          e.fireCD = 0.7;
        } else {
          // ENRAGED: dense starburst + aimed barrage
          for (let k = 0; k < 16; k++) {
            const ang = (k / 16) * Math.PI * 2 + e.t * 0.8;
            enemyShoot(e.x, e.y, ang, 240, '#ff3860');
          }
          const ang = Math.atan2(dy, dx);
          for (let k = -2; k <= 2; k++) enemyShoot(e.x, e.y, ang + k * 0.08, 420, '#ffffff');
          e.fireCD = 0.5;
        }
      }
    }

    // Move enemies, respecting obstacles.
    // Phantoms phase through walls while intangible.
    // Bosses (mega/mini) ignore obstacles — they need to reach the battlefield.
    const isBoss = isBossType(e.type);
    if (isBoss || e.intangible || e.type === 'node') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    } else {
      const tx = e.x + e.vx * dt;
      const ty = e.y + e.vy * dt;
      const res = resolveCircleMove(e.x, e.y, tx, ty, e.r);
      e.x = res.x;
      e.y = res.y;
    }
    if (e.shieldHit > 0) e.shieldHit -= dt;
    // Once a boss has flown in, it stays on screen
    if (isBoss) {
      if (!e.entered && e.y > e.r && e.y < H - e.r && e.x > e.r && e.x < W - e.r) e.entered = true;
      if (e.entered) {
        e.x = Math.max(e.r * 0.5, Math.min(W - e.r * 0.5, e.x));
        e.y = Math.max(e.r * 0.5, Math.min(H - e.r * 0.5, e.y));
      }
    }

    // Collide with player (phantoms in intangible phase don't collide)
    if (p.iframes <= 0 && !e.intangible && circleHit(e.x, e.y, e.r, p.x, p.y, p.r)) {
      damagePlayer(1);
    }
    // Multi-part bosses: every part is solid
    if (e.parts && p.iframes <= 0) {
      for (const pt of e.parts) {
        if (circleHit(pt.x, pt.y, pt.r, p.x, p.y, p.r)) { damagePlayer(1); break; }
      }
    }
  }
}

// opts (all optional), used by the sector bosses:
//   kind      look: 'orb' (default), 'shard', 'ice', 'rock', 'flame', 'missile', 'ink'
//   r, life   size and lifetime
//   accel     speed change per second, clamped to [minSpeed, maxSpeed]
//   turn      constant curve in rad/s
//   homing    max turn toward the player in rad/s
//   delay     hang in place this long before moving
//   grow      radius growth per second, up to maxR
//   burst     { count, speed, color, kind }: pops into a ring when life runs out
//   orbit     { center, vt, vr, minR }: spirals around center (an object with x/y)
const ENEMY_BULLET_CAP = 900;
function enemyShoot(x, y, angle, speed, color, opts) {
  if (run.enemyProjectiles.length >= ENEMY_BULLET_CAP) return null;
  const b = {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 5,
    life: 6,
    color,
    grazed: false,
    kind: 'orb',
    age: 0
  };
  if (opts) {
    Object.assign(b, opts);
    if (opts.r) b.r = opts.r;
    if (opts.life) b.life = opts.life;
  }
  run.enemyProjectiles.push(b);
  return b;
}

function updateProjectiles(dt) {
  const enemies = run.enemies;
  for (let i = run.projectiles.length - 1; i >= 0; i--) {
    const pr = run.projectiles[i];
    // Homing: gently steer toward nearest enemy
    if (pr.homing && enemies.length > 0) {
      let nearest = null, nd = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (d < nd) { nd = d; nearest = e; }
      }
      if (nearest && nd < 400) {
        const tx = nearest.x - pr.x;
        const ty = nearest.y - pr.y;
        const tmag = Math.hypot(tx, ty) || 1;
        const speed = Math.hypot(pr.vx, pr.vy);
        pr.vx = pr.vx * 0.9 + (tx / tmag) * speed * 0.15;
        pr.vy = pr.vy * 0.9 + (ty / tmag) * speed * 0.15;
        // Renormalize to original speed
        const newSpeed = Math.hypot(pr.vx, pr.vy) || 1;
        pr.vx = (pr.vx / newSpeed) * speed;
        pr.vy = (pr.vy / newSpeed) * speed;
      }
    }

    const prevX = pr.x, prevY = pr.y;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    // Gravity wells bend your shots too
    if (applyWellGravity(run.wells, pr, dt)) {
      run.projectiles.splice(i, 1);
      continue;
    }

    // Check if the bullet's travel segment hit an obstacle
    const wall = run.obstacles && run.obstacles.length > 0 ? segmentHitsObstacle(prevX, prevY, pr.x, pr.y) : null;
    if (wall) {
      // Ricochet off the obstacle if available, else destroy
      if (pr.ricochet > 0) {
        if (wall.shape === 'circle') {
          // Bounce off the rock's surface
          const nx0 = prevX - wall.x, ny0 = prevY - wall.y;
          const nl = Math.hypot(nx0, ny0) || 1;
          const nx = nx0 / nl, ny = ny0 / nl;
          const dot = pr.vx * nx + pr.vy * ny;
          pr.vx -= 2 * dot * nx;
          pr.vy -= 2 * dot * ny;
        } else if (Math.abs(pr.vx) > Math.abs(pr.vy)) pr.vx *= -1;
        else pr.vy *= -1;
        pr.ricochet--;
        // Back off a touch so we're not immediately inside the wall
        pr.x = prevX;
        pr.y = prevY;
        spawnHitParticles(prevX, prevY, '#ffffff');
      } else {
        spawnHitParticles(pr.x, pr.y, '#ffffff');
        run.projectiles.splice(i, 1);
        continue;
      }
    }

    // Asteroids and mines take hits (beams punch straight through)
    const hz = hazardHitByShot(hazardWorld, pr);
    if (hz) {
      pr.hitIds.add(hz);
      damageHazard(hazardWorld, hz, pr.damage, true);
      spawnHitParticles(pr.x, pr.y, hz.kind === 'mine' ? '#ff3860' : '#ffffff');
      if (!pr.beam) {
        run.projectiles.splice(i, 1);
        continue;
      }
    }

    if (pr.life <= 0 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) {
      // Try ricochet off walls
      if (pr.ricochet > 0 && pr.life > 0) {
        if (pr.x < 0 || pr.x > W) { pr.vx *= -1; pr.x = Math.max(0, Math.min(W, pr.x)); pr.ricochet--; continue; }
        if (pr.y < 0 || pr.y > H) { pr.vy *= -1; pr.y = Math.max(0, Math.min(H, pr.y)); pr.ricochet--; continue; }
      }
      run.projectiles.splice(i, 1);
      continue;
    }

    // Hit enemies
    let consumed = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (!e || pr.hitIds.has(e)) continue;
      if (e.intangible) continue;
      if (enemyHitTest(e, pr.x, pr.y, pr.r)) {
        pr.hitIds.add(e);
        if (!damageEnemy(e, pr.damage)) {
          // Shielded: the shot splashes off
          spawnHitParticles(pr.x, pr.y, '#00f0ff');
          consumed = true;
          break;
        }
        spawnHitParticles(pr.x, pr.y, pr.crit ? '#ffea00' : e.color);
        if (pr.explosive) {
          // Small AOE
          for (const other of [...enemies]) {
            if (other === e || other.dead) continue;
            const d = Math.hypot(other.x - pr.x, other.y - pr.y);
            if (d < 60 && damageEnemy(other, pr.damage * 0.5) && other.hp <= 0) killEnemy(enemies.indexOf(other));
          }
          spawnExplosion(pr.x, pr.y);
        }
        if (e.hp <= 0 && !e.dead) {
          killEnemy(enemies.indexOf(e));
        }
        if (pr.pierce > 0) {
          pr.pierce--;
        } else {
          consumed = true;
          break;
        }
      }
    }
    if (consumed) run.projectiles.splice(i, 1);
  }
}

function updateEnemyProjectiles(dt) {
  const p = run.player;
  for (let i = run.enemyProjectiles.length - 1; i >= 0; i--) {
    const b = run.enemyProjectiles[i];
    const prevX = b.x, prevY = b.y;
    // Delays, spirals, curves, homing and growth (shared/spaceSim.js)
    const step = advanceShot(b, dt, p);
    if (step === 'swallowed') {
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Gravity wells bend shots and swallow them
    if (applyWellGravity(run.wells, b, dt)) {
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Burst shells pop into a ring of shards at the end of their life
    if (step === 'burst') {
      run.enemyProjectiles.splice(i, 1);
      burstRing(b, enemyShoot, run.bossRand || Math.random);
      spawnHitParticles(b.x, b.y, b.color);
      continue;
    }

    // Obstacle collision: walls block enemy bullets (cover mechanic)
    if (run.obstacles && run.obstacles.length > 0 && !b.orbit && segmentHitsObstacle(prevX, prevY, b.x, b.y)) {
      spawnHitParticles(b.x, b.y, b.color);
      run.enemyProjectiles.splice(i, 1);
      continue;
    }
    // Drifting asteroids soak up shots too
    if (hazardBlocksShot(hazardWorld, b)) {
      spawnHitParticles(b.x, b.y, b.color);
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Graze detection
    const gd = Math.hypot(b.x - p.x, b.y - p.y);
    if (!b.grazed && gd < 25 + b.r && gd > p.r + b.r) {
      b.grazed = true;
      // graze: add to combo without breaking
      addCombo(run.passives.grazeBonus);
      spawnFloat(b.x, b.y, 'GRAZE', '#00f0ff', 12);
    }

    const m = 40 + b.r;
    if (b.life <= 0 || b.x < -m || b.x > W + m || b.y < -m || b.y > H + m) {
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    if (!run.waveCleared && p.iframes <= 0 && circleHit(b.x, b.y, b.r, p.x, p.y, p.r)) {
      damagePlayer(1);
      run.enemyProjectiles.splice(i, 1);
    }
  }
}

// ============================================================
// BEAMS: telegraphed boss lasers
// ============================================================
// A beam shows a thin flickering line for `warn` seconds, then burns for
// `life` seconds. Its owner moves/aims it each frame by writing x, y,
// angle (and len). Beams die with their owner.
function addBeam(owner, opts) {
  const b = {
    owner,
    x: owner.x, y: owner.y,
    angle: opts.angle ?? 0,
    len: opts.len ?? 2400,
    width: opts.width ?? 12,
    hitWidth: opts.hitWidth ?? opts.width ?? 12,  // can be wider than drawn (Nexus fence)
    warn: opts.warn ?? 1,
    warnMax: opts.warn ?? 1,
    life: opts.life ?? 1,
    color: opts.color || '#ffffff',
    done: false
  };
  run.beams.push(b);
  return b;
}

function updateBeams(dt) {
  const p = run.player;
  for (let i = run.beams.length - 1; i >= 0; i--) {
    const b = run.beams[i];
    if (b.owner && b.owner.dead) b.done = true;
    if (b.done) { run.beams.splice(i, 1); continue; }
    if (b.warn > 0) { b.warn -= dt; continue; }
    b.life -= dt;
    if (b.life <= 0) { b.done = true; run.beams.splice(i, 1); continue; }
    const x2 = b.x + Math.cos(b.angle) * b.len, y2 = b.y + Math.sin(b.angle) * b.len;
    if (p.iframes <= 0 && segDist(p.x, p.y, b.x, b.y, x2, y2) < b.hitWidth / 2 + p.r * 0.7) damagePlayer(1);
  }
}

// Damage that respects shields. Returns false if the enemy shrugged it off.
function damageEnemy(e, amt) {
  if (e.shielded || e.twistShield) {
    e.shieldHit = 0.15;
    return false;
  }
  e.hp -= amt;
  e.lastHitT = e.t;
  e.hitFlash = 0.1;
  return true;
}

// Body or any part of a multi-part boss
function enemyHitTest(e, x, y, r) {
  if (circleHit(x, y, r, e.x, e.y, e.r)) return true;
  if (e.parts) {
    for (const pt of e.parts) if (circleHit(x, y, r, pt.x, pt.y, pt.r)) return true;
  }
  return false;
}

function damagePlayer(amt) {
  if (run.player.iframes > 0 || run.player.invulnDash > 0) return;
  if (DEV_GOD) { run.player.iframes = 0.3; return; }
  // Royal's deflector soaks the hit, then recharges.
  if (run.player.shieldUp) {
    run.player.shieldUp = false;
    run.player.shieldCD = run.player.shieldMax;
    run.player.iframes = 0.6;
    run.screenShake = 6;
    spawnExplosion(run.player.x, run.player.y, '#7fdcff', 26);
    return;
  }
  run.player.hp -= amt;
  run.player.iframes = 1.0;
  run.screenShake = 14;
  resetCombo();
  if (run.passives.timeSlow) {
    run.slowmo = 0.35;
  }
  // Hit particles
  for (let i = 0; i < 20; i++) {
    run.particles.push({
      x: run.player.x, y: run.player.y,
      vx: (Math.random() - 0.5) * 400,
      vy: (Math.random() - 0.5) * 400,
      life: 0.6, maxLife: 0.6,
      color: '#ff3860', size: 3
    });
  }
  if (run.player.hp <= 0) {
    gameOver();
  }
}

function killEnemy(idx) {
  const e = run.enemies[idx];
  if (!e || e.dead) return;
  e.dead = true;
  // Boss death sound
  const isBossKill = isBossType(e.type);
  if (isBossKill) playSound('explosion');
  run.enemies.splice(idx, 1);
  if (isBossKill) bossDeath(e);
  if (isBossKill && e.twists && e.twists.includes('volatile')) {
    for (let k = 0; k < 18; k++) enemyShoot(e.x, e.y, (k / 18) * TAU, 160, e.color);
    for (let k = 0; k < 3; k++) spawnMinion('fighter', e.x + Math.cos(k * 2.1) * e.r, e.y + Math.sin(k * 2.1) * e.r, null);
  }
  run.score += Math.ceil(e.score * run.comboMult);
  addCombo(1);
  spawnExplosion(e.x, e.y, e.color, e.r);
  spawnFloat(e.x, e.y - e.r, `+${Math.ceil(e.score * run.comboMult)}`, e.color, 14);

  // Splitter: spawn 2 mini-grunts at death location
  if (e.type === 'splitter' && e.splitLeft > 0) {
    const diff = run.currentWaveInfo ? run.currentWaveInfo.diffMul : 1;
    for (let k = 0; k < e.splitLeft; k++) {
      spawnEnemy('grunt', 0.5 * diff, diff);
      const last = run.enemies[run.enemies.length - 1];
      last.x = e.x + (gameRand() - 0.5) * 30;
      last.y = e.y + (gameRand() - 0.5) * 30;
      last.hp = last.maxHp * 0.5;
      last.maxHp = last.hp;
    }
  }

  // Drop cores - scales with enemy type
  let coreCount;
  if (['warden'].includes(e.type)) coreCount = 30 + Math.floor(gameRand() * 15);
  else if (isBossKill) coreCount = 12 + Math.floor(gameRand() * 8);
  else if (['bomber', 'lancer', 'splitter'].includes(e.type)) coreCount = 2 + (gameRand() < 0.3 ? 1 : 0);
  else coreCount = 1 + (gameRand() < 0.3 ? 1 : 0);

  for (let i = 0; i < coreCount; i++) {
    run.pickups.push({
      x: e.x + (Math.random() - 0.5) * 20,
      y: e.y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      r: 6,
      life: 10,
      type: 'core'
    });
  }

  // Screen shake
  if (e.type === 'warden') run.screenShake = Math.max(run.screenShake, 25);
  else if (isBossKill) run.screenShake = Math.max(run.screenShake, 14);
  else run.screenShake = Math.max(run.screenShake, 4);

  if (run.passives.onKillShockwave) {
    for (const other of run.enemies) {
      const d = Math.hypot(other.x - e.x, other.y - e.y);
      if (d < 120) damageEnemy(other, 1);
    }
    spawnShockwave(e.x, e.y, '#00f0ff');
  }

  // Random powerup drop (bosses have much higher chance)
  let dropMultiplier = 1;
  if (e.type === 'warden') dropMultiplier = 10;  // always drops from mega boss
  else if (isBossKill) dropMultiplier = 6;
  else if (['bomber', 'lancer', 'splitter'].includes(e.type)) dropMultiplier = 2;
  maybeDropPowerup(e.x, e.y, dropMultiplier);
}

// A boss goes out in a chain of explosions and takes its adds, beams,
// mines and wells with it.
function bossDeath(e) {
  for (let i = run.enemies.length - 1; i >= 0; i--) {
    const m = run.enemies[i];
    if (m && m.owner === e) killEnemy(run.enemies.indexOf(m));
  }
  run.beams = run.beams.filter((b) => b.owner !== e);
  for (let i = run.hazards.length - 1; i >= 0; i--) {
    const h = run.hazards[i];
    if (h.owner !== e) continue;
    spawnExplosion(h.x ?? e.x, h.y ?? e.y, '#ffffff', 10);
    simRemoveHazard(hazardWorld, h);
  }
  run.enemyProjectiles = run.enemyProjectiles.filter((b) => !(b.orbit && b.orbit.center === e));
  queueBossDeathFx(e);
}

// The chain of explosions and the white flash when a boss dies (single
// player and multiplayer). `e` needs x, y, r, color and optional parts.
function queueBossDeathFx(e) {
  const pts = e.parts && e.parts.length ? e.parts : [{ x: e.x, y: e.y }];
  for (let k = 0; k < 9; k++) {
    const at = pts[k % pts.length];
    run.fxQueue.push({
      t: 0.12 * k + Math.random() * 0.08,
      x: at.x + (Math.random() - 0.5) * e.r * 1.6,
      y: at.y + (Math.random() - 0.5) * e.r * 1.6,
      color: k % 3 === 0 ? '#ffffff' : e.color,
      size: 18 + Math.random() * 20
    });
  }
  run.fxQueue.push({ t: 1.15, x: e.x, y: e.y, color: e.color, size: e.r * 1.5, big: true });
  run.flash = Math.max(run.flash, 0.5);
}

function updateFx(dt) {
  if (run.flash > 0) run.flash = Math.max(0, run.flash - dt * 1.6);
  for (let i = run.fxQueue.length - 1; i >= 0; i--) {
    const f = run.fxQueue[i];
    f.t -= dt;
    if (f.t > 0) continue;
    run.fxQueue.splice(i, 1);
    spawnExplosion(f.x, f.y, f.color, f.size);
    if (f.big) {
      spawnShockwave(f.x, f.y, f.color);
      spawnShockwave(f.x, f.y, '#ffffff');
      run.flash = Math.max(run.flash, 0.8);
      run.screenShake = Math.max(run.screenShake, 20);
      playSound('explosion');
    } else {
      run.screenShake = Math.max(run.screenShake, 6);
    }
  }
}

function updateParticles(dt) {
  for (let i = run.particles.length - 1; i >= 0; i--) {
    const p = run.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) run.particles.splice(i, 1);
  }
}

function updatePickups(dt) {
  const p = run.player;
  for (let i = run.pickups.length - 1; i >= 0; i--) {
    const pk = run.pickups[i];
    pk.vx *= 0.96;
    pk.vy *= 0.96;
    const dx = p.x - pk.x;
    const dy = p.y - pk.y;
    const d = Math.hypot(dx, dy) || 1;
    // AUTO-SNATCH: cores always magnet to the player at any distance.
    // Pull strength scales up with distance so far-away cores don't feel sluggish.
    const pull = 900 + Math.min(d * 2, 600);
    pk.vx += (dx / d) * pull * dt;
    pk.vy += (dy / d) * pull * dt;
    pk.x += pk.vx * dt;
    pk.y += pk.vy * dt;
    pk.life -= dt;
    if (pk.life <= 0) { run.pickups.splice(i, 1); continue; }
    if (d < p.r + pk.r) {
      const gain = hasRule('coreRush') ? 2 : 1;
      run.cores += gain;
      run.pickups.splice(i, 1);
      spawnFloat(pk.x, pk.y, `+${gain}`, '#ffea00', 10);
      if (run.passives.pickupHeal > 0 && Math.floor(run.cores / 5) > Math.floor((run.cores - gain) / 5) && run.player.hp < run.player.maxHp) {
        run.player.hp = Math.min(run.player.maxHp, run.player.hp + 1);
        spawnFloat(p.x, p.y - 20, '+1 HP', '#39ff14', 14);
      }
    }
  }
}

function updateCombo(dt) {
  if (run.combo > 0) {
    run.comboTimer -= dt;
    if (run.comboTimer <= 0) {
      resetCombo();
    }
  }
}

function addCombo(amt) {
  run.combo += amt;
  if (run.combo > run.bestCombo) run.bestCombo = run.combo;
  run.comboMult = 1 + Math.min(run.combo * 0.05, 4); // cap at 5x
  run.comboTimer = run.passives.comboDecayTime;
}
function resetCombo() {
  run.combo = 0;
  run.comboMult = 1;
  run.comboTimer = 0;
}

function updateCooldowns(dt) {
  // Already handled in player
}

function checkWaveClear() {
  if (run.waveCleared) return;
  if (run.spawnQueue.length === 0 && run.enemies.length === 0) {
    run.waveCleared = true;
    // Leftover enemy fire (missiles, boulders about to burst) fizzles out,
    // so nothing can hit you while you pick an upgrade
    for (const b of run.enemyProjectiles) spawnHitParticles(b.x, b.y, b.color);
    run.enemyProjectiles = [];
    run.beams = [];
    setTimeout(() => {
      if (run.active) offerUpgrades();
    }, 800);
  }
}

function spawnHitParticles(x, y, color) {
  for (let i = 0; i < 6; i++) {
    run.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      life: 0.3, maxLife: 0.3,
      color, size: 2
    });
  }
}
function spawnExplosion(x, y, color = '#ff2d95', size = 20) {
  for (let i = 0; i < 20; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 300;
    run.particles.push({
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.5 + Math.random() * 0.3,
      maxLife: 0.7,
      color, size: 2 + Math.random() * 3
    });
  }
  // Shockwave ring
  run.particles.push({
    x, y, vx: 0, vy: 0,
    life: 0.4, maxLife: 0.4,
    color, size: size, ring: true
  });
}
function spawnShockwave(x, y, color) {
  run.particles.push({
    x, y, vx: 0, vy: 0,
    life: 0.5, maxLife: 0.5,
    color, size: 80, ring: true
  });
}
function spawnFloat(x, y, text, color, size) {
  run.particles.push({
    x, y, vx: 0, vy: -60,
    life: 0.8, maxLife: 0.8,
    color, size,
    text
  });
}

function circleHit(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1;
  return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
}

// ============================================================
// OBSTACLE COLLISION HELPERS
// ============================================================
// Cover collision lives in shared/spaceSim.js; these read run.obstacles.
function isInsideObstacle(x, y, r) {
  return !!run && insideObstacle(run.obstacles, x, y, r);
}

function resolveCircleMove(fromX, fromY, toX, toY, r) {
  return resolveMove(run && run.obstacles, fromX, fromY, toX, toY, r);
}

// The obstacle a bullet's path crosses (for destruction and ricochets), or null.
function segmentHitsObstacle(x1, y1, x2, y2) {
  return pathHitsObstacle(run && run.obstacles, x1, y1, x2, y2);
}

// ============================================================
// RENDER
// ============================================================
let titleSector = null;
let lastRenderAt = 0;

function render() {
  const now = performance.now() / 1000;
  const frameDt = Math.min(0.05, now - lastRenderAt || 0.016);
  lastRenderAt = now;

  if (!run) {
    // Title and menus: a random sector's sky behind the overlay
    if (!titleSector) titleSector = sectorForWave(1 + Math.floor(Math.random() * SECTORS.length) * WAVES_PER_SECTOR);
    drawSpaceBackdrop(ctx, W, H, titleSector, now, { px: 0, py: 0 }, frameDt);
    return;
  }
  titleSector = null;
  const time = run.timeElapsed;
  const p = run.player;
  drawSpaceBackdrop(ctx, W, H, run.sector, now, { px: p.x - W / 2, py: p.y - H / 2 }, frameDt);

  ctx.save();
  // Screen shake
  if (run.screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * run.screenShake,
      (Math.random() - 0.5) * run.screenShake
    );
  }

  drawHazards('under', time);

  // Static cover: asteroids, ice, crystals, wreckage, station modules
  for (const o of run.obstacles) {
    if (o.noDraw) continue;
    if (o.shape === 'circle') {
      drawRock(ctx, { x: o.x, y: o.y, rot: o.rot + time * o.spin, sprite: o.sprite });
    } else {
      drawPanel(ctx, o);
    }
  }

  drawHazards('mid', time);

  // Pickups
  for (const pk of run.pickups) {
    const pulse = 0.85 + Math.sin(time * 8 + pk.x * 0.1) * 0.15;
    drawGlowSprite(pk.x, pk.y, pk.r * 2.6 * pulse, '#ffea00', 0.9);
    ctx.fillStyle = '#fff6b0';
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, pk.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  // Boss lasers (telegraphs and burns)
  for (const b of run.beams) drawBeam(ctx, b, time);

  // Enemy projectiles
  for (const b of run.enemyProjectiles) drawEnemyBullet(b, time);

  // Enemies
  for (const e of run.enemies) {
    drawEnemy(e);
    if (e.twistShield) drawTwistShield(e);
  }

  // Player projectiles
  for (const pr of run.projectiles) drawPlayerBullet(pr, run.player.color);

  // Remote multiplayer pilots (drawn before local player so yours renders on top)
  drawRemotePlayers();

  // Player
  drawPlayer();

  // Drones and turrets (after player, so they render in front)
  drawDrones();
  drawTurrets();
  drawMedics();
  drawSnakeTurrets();
  drawSnakes();
  drawPowerupDrops();

  drawHazards('over', time);

  // Particles
  drawParticles();

  ctx.restore();

  // Hyperspace jump and white flashes
  if (run.warp) drawWarp(ctx, W, H, run.warp.t / WARP_TIME, run.warp.to.accent);
  if (run.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, run.flash)})`;
    ctx.fillRect(0, 0, W, H);
  }

  const boss = run.enemies.find((e) => BOSS_TYPES.includes(e.type));
  if (boss) drawBossBar(boss);

  // HUD sync (lightweight, every frame)
  updateHUD();
}

// Soft glow dots, pre-rendered per color: much cheaper than shadowBlur on
// every bullet and particle.
const glowSprites = new Map();
function glowSprite(color) {
  let s = glowSprites.get(color);
  if (!s) {
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 1));
    grad.addColorStop(0.25, rgba(color, 0.55));
    grad.addColorStop(0.6, rgba(color, 0.15));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowSprites.set(color, s);
  }
  return s;
}

function drawGlowSprite(x, y, size, color, alpha = 1) {
  const s = glowSprite(color);
  const prevA = ctx.globalAlpha, prevOp = ctx.globalCompositeOperation;
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(s, x - size, y - size, size * 2, size * 2);
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

// Enemy shots by kind (see enemyShoot). Glow comes from cached sprites.
function drawEnemyBullet(b, time) {
  const hanging = b.delay > 0;
  drawGlowSprite(b.x, b.y, b.r * (b.kind === 'ink' ? 2.2 : 3), b.color, hanging ? 0.45 + Math.sin(time * 20) * 0.2 : 0.8);
  const a = Math.atan2(b.vy, b.vx);
  ctx.save();
  ctx.translate(b.x, b.y);
  switch (b.kind) {
    case 'shard':
    case 'ice':
      ctx.rotate(a);
      ctx.fillStyle = b.kind === 'ice' ? '#e8fbff' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(b.r * 1.8, 0); ctx.lineTo(0, -b.r * 0.7); ctx.lineTo(-b.r * 1.3, 0); ctx.lineTo(0, b.r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'rock':
      ctx.rotate(b.age * 5);
      ctx.fillStyle = '#6a5040';
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const ka = (k / 7) * Math.PI * 2, kr = b.r * (0.8 + ((k * 37) % 5) * 0.06);
        k ? ctx.lineTo(Math.cos(ka) * kr, Math.sin(ka) * kr) : ctx.moveTo(Math.cos(ka) * kr, Math.sin(ka) * kr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'flame': {
      ctx.rotate(a);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(b.r, 0, -b.r * 3, 0);
      g.addColorStop(0, 'rgba(255, 255, 220, 0.95)');
      g.addColorStop(0.4, rgba(b.color, 0.7));
      g.addColorStop(1, rgba(b.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(b.r, 0);
      ctx.quadraticCurveTo(0, -b.r, -b.r * 3, 0);
      ctx.quadraticCurveTo(0, b.r, b.r, 0);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'missile':
      ctx.rotate(a);
      ctx.fillStyle = '#d8d0c8';
      ctx.fillRect(-b.r * 1.4, -b.r * 0.4, b.r * 2.4, b.r * 0.8);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.moveTo(b.r * 1.6, 0); ctx.lineTo(b.r, -b.r * 0.4); ctx.lineTo(b.r, b.r * 0.4); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 200, 120, ${0.6 + Math.sin(time * 40) * 0.3})`;
      ctx.beginPath(); ctx.moveTo(-b.r * 1.4, -b.r * 0.4); ctx.lineTo(-b.r * 2.6, 0); ctx.lineTo(-b.r * 1.4, b.r * 0.4); ctx.fill();
      break;
    case 'ink':
      ctx.fillStyle = rgba(b.color, 0.55);
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, b.r * (0.7 + Math.sin(time * 6 + b.x) * 0.1), 0, Math.PI * 2); ctx.stroke();
      break;
    default:
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Glowing capsule bullet; crits are yellow. Shared by single player and
// multiplayer (which passes its own projectile views and the shooter's color).
function drawPlayerBullet(pr, baseColor = '#ff2d95') {
  ctx.save();
  const color = pr.crit ? '#ffea00' : baseColor;
  const angle = Math.atan2(pr.vy, pr.vx);
  ctx.translate(pr.x, pr.y);
  ctx.rotate(angle);
  // Outer glow capsule
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  const len = pr.crit ? 14 : 11;
  const thick = pr.crit ? 4 : 3;
  // Rounded rect
  ctx.beginPath();
  ctx.moveTo(-len / 2, -thick / 2);
  ctx.lineTo(len / 2 - thick / 2, -thick / 2);
  ctx.arc(len / 2 - thick / 2, 0, thick / 2, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-len / 2 + thick / 2, thick / 2);
  ctx.arc(-len / 2 + thick / 2, 0, thick / 2, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  // Inner white core
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-len / 2 + 2, -thick / 4, len - 4, thick / 2);
  ctx.restore();
}

function drawParticles() {
  for (const p of run.particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    if (p.text) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.size}px Courier New`;
      ctx.textAlign = 'center';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    } else if (p.ring) {
      const growth = 1 - alpha;
      const rr = p.size + growth * 80;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 9 * alpha;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.5 * alpha;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (p.debris) {
      // Tumbling rock chips
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.life * 12);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
      ctx.restore();
    } else {
      drawGlowSprite(p.x, p.y, p.size * 3, p.color, alpha * 0.9);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// Remote player ship colors (up to 3 other pilots, local player is always pink).
const REMOTE_COLORS = ['#39ff14', '#ffea00', '#bc8cff'];

function drawRemotePlayers() {
  const remotes = getRemotePlayers();
  if (remotes.length === 0) return;
  let idx = 0;
  for (const r of remotes) {
    const color = REMOTE_COLORS[idx % REMOTE_COLORS.length];
    idx++;
    if (r.dead || !isFinite(r.x) || !isFinite(r.y)) continue;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle || 0);
    // Simple triangular ship outline, no fancy banking or trail — kept cheap
    // so many remote players don't tank the framerate.
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(10, 5, 20, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Name label floating above
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(r.name || 'pilot', r.x, r.y - 18);
    ctx.restore();
  }
}

// Draws a pilot's ship (p.ship, see ships.js) with its engine trail, banking,
// hit blink, muzzle flash and shields. Multiplayer passes each pilot's ship
// view and color; single player draws run.player in the chosen color.
function drawPlayer(p = run.player, hullColor = run.player.color || '#ff2d95') {

  // ─── Engine trail (drawn first, behind ship) ───
  if (p.trail.length > 2) {
    ctx.save();
    for (let i = 1; i < p.trail.length; i++) {
      const t = p.trail[i];
      const prev = p.trail[i - 1];
      // Skip segments that jump (screen wrap, a dash, a network snap) so the
      // trail never draws a line across the screen.
      if (Math.abs(t.x - prev.x) > 60 || Math.abs(t.y - prev.y) > 60) continue;
      const alpha = (i / p.trail.length) * 0.4;
      const width = (i / p.trail.length) * 7;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = hullColor;
      ctx.shadowColor = hullColor;
      ctx.shadowBlur = 12;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Ship body ───
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  // Apply bank (scaleY squish based on lateral movement for 3D illusion)
  ctx.scale(1, 1 - Math.abs(p.bank) * 0.15);
  // Slight skew for bank lean
  ctx.transform(1, 0, p.bank * 0.2, 1, 0, 0);

  const dashing = p.invulnDash > 0;
  const flash = p.iframes > 0 && !dashing && Math.floor(p.iframes * 20) % 2 === 0;
  const moving = Math.hypot(p.x - p.lastX, p.y - p.lastY) > 0.5;
  const shipId = p.ship || 'glide';
  drawShipModel(ctx, shipId, hullColor, performance.now() / 1000, { flash, thrust: moving ? 1 : 0.5 });

  // ─── Muzzle flash at the ship's gun points when firing ───
  if (p.fireFlash > 0) {
    const fa = p.fireFlash / 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = hullColor;
    ctx.shadowBlur = 16;
    ctx.fillStyle = `rgba(255, 255, 255, ${fa})`;
    for (const [gx, gy] of shipGuns(shipId)) {
      ctx.beginPath(); ctx.arc(gx + 2, gy, 3 * fa, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ─── Royal's deflector bubble while it's charged ───
  if (p.shieldUp) {
    ctx.save();
    const pulse = 0.55 + Math.sin(p.enginePulse * 0.7) * 0.15;
    ctx.strokeStyle = `rgba(127, 220, 255, ${pulse})`;
    ctx.fillStyle = `rgba(127, 220, 255, ${pulse * 0.12})`;
    ctx.shadowColor = '#7fdcff';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ─── Holographic shield ring (only during dash i-frames) ───
  if (dashing) {
    ctx.save();
    const sa = p.invulnDash / 0.35;
    ctx.strokeStyle = `rgba(0, 240, 255, ${sa * 0.7})`;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 25;
    ctx.lineWidth = 2;
    // Two overlapping hex rings
    for (let ring = 0; ring < 2; ring++) {
      ctx.beginPath();
      const rotOff = p.enginePulse * (ring === 0 ? 1 : -1.5);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rotOff;
        const rad = 20 + ring * 3;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // end ship transform

  // ─── Dash cooldown ring (circular progress indicator) ───
  if (p.dashCD > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 10, -Math.PI / 2, -Math.PI / 2 + (1 - p.dashCD / p.dashMax) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawEnemy(e) {
  // Sector bosses and their adds draw themselves in world space (bossArt.js)
  if (drawSpaceEnemy(ctx, e, run.timeElapsed ?? performance.now() / 1000, run.player)) {
    if (e.hitFlash > 0) {
      const a = Math.min(1, e.hitFlash / 0.1) * 0.5;
      drawGlowSprite(e.x, e.y, e.r * 1.6, '#ffffff', a);
      if (e.parts) for (const pt of e.parts) drawGlowSprite(pt.x, pt.y, pt.r * 1.5, '#ffffff', a * 0.8);
    }
    if (e.minion && e.maxHp > 3 && e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2, 3);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2 * (e.hp / e.maxHp), 3);
    }
    return;
  }
  ctx.save();
  ctx.translate(e.x, e.y);
  const hpFrac = e.hp / e.maxHp;

  if (e.type === 'grunt') {
    // ── Scout drone: sharp triangle with inner Tron lines ──
    ctx.rotate(Math.PI / 2 + Math.sin(e.t * 3) * 0.08);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 16;
    // Dark fill
    ctx.fillStyle = 'rgba(26, 11, 46, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 1.1);
    ctx.lineTo(e.r * 0.9, e.r * 0.7);
    ctx.lineTo(0, e.r * 0.3);
    ctx.lineTo(-e.r * 0.9, e.r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner edge highlight lines
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 0.7);
    ctx.lineTo(e.r * 0.5, e.r * 0.4);
    ctx.moveTo(0, -e.r * 0.7);
    ctx.lineTo(-e.r * 0.5, e.r * 0.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Red eye
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, -e.r * 0.2, 2, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'drifter') {
    // ── Disc fighter: spinning dual-diamond with core ──
    ctx.rotate(e.t * 2.5);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 18;
    // Outer ring
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(10, 30, 46, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r, 0);
    ctx.lineTo(0, e.r);
    ctx.lineTo(-e.r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner crossed diamond
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 0.6);
    ctx.lineTo(e.r * 0.6, 0);
    ctx.lineTo(0, e.r * 0.6);
    ctx.lineTo(-e.r * 0.6, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Central core pulse
    const pulse = 0.7 + Math.sin(e.t * 6) * 0.3;
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5 * pulse, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'turret') {
    // ── Turret platform: hex base + rotating barrel aimed at player ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 16;
    // Hex base (static)
    ctx.fillStyle = 'rgba(40, 30, 0, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * e.r;
      const y = Math.sin(a) * e.r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner hex detail
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * e.r * 0.6;
      const y = Math.sin(a) * e.r * 0.6;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Rotating barrel (aims at player)
    const p = run.player;
    const aimA = Math.atan2(p.y - e.y, p.x - e.x);
    ctx.save();
    ctx.rotate(aimA);
    ctx.fillStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 12;
    ctx.fillRect(0, -2, e.r + 4, 4);
    // Barrel tip glow
    ctx.beginPath();
    ctx.arc(e.r + 4, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Central cap
    ctx.fillStyle = '#1a1a00';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 1;
    ctx.stroke();

  } else if (e.type === 'weaver') {
    // ── Weaver: fast orbital unit, sharp star with trail ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 20;
    ctx.rotate(e.t * 3);
    // Outer glow aura
    ctx.strokeStyle = e.color;
    ctx.fillStyle = 'rgba(30, 10, 50, 0.85)';
    ctx.lineWidth = 2;
    // 4-pointed star
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? e.r * 1.15 : e.r * 0.5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner X crosshair
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.4, -e.r * 0.4);
    ctx.lineTo(e.r * 0.4, e.r * 0.4);
    ctx.moveTo(e.r * 0.4, -e.r * 0.4);
    ctx.lineTo(-e.r * 0.4, e.r * 0.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Core
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'splitter') {
    // ── Splitter: green segmented cell that looks ready to split ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 20;
    ctx.rotate(Math.sin(e.t * 2) * 0.1);
    // Outer asymmetric blob (two lobes)
    ctx.fillStyle = 'rgba(10, 40, 10, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    const wobble = Math.sin(e.t * 3) * 1.5;
    ctx.beginPath();
    ctx.ellipse(-e.r * 0.35, 0, e.r * 0.85 + wobble, e.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(e.r * 0.35, 0, e.r * 0.85 - wobble, e.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Dividing membrane line down the middle
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 0.9);
    ctx.lineTo(0, e.r * 0.9);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Two pulsing nuclei
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(-e.r * 0.35, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.r * 0.35, 0, 3, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'phantom') {
    // ── Phantom: ghost ship that fades in and out ──
    const visible = e.visible !== false;
    const fadeAlpha = visible ? 0.95 : 0.18;
    ctx.globalAlpha = fadeAlpha;
    ctx.rotate(Math.atan2(e.vy || 1, e.vx || 0));
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 22;
    // Stretched ghostly delta-wing
    ctx.fillStyle = 'rgba(20, 40, 60, 0.6)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.r * 1.1, 0);
    ctx.lineTo(-e.r * 0.6, -e.r * 0.9);
    ctx.lineTo(-e.r * 0.3, 0);
    ctx.lineTo(-e.r * 0.6, e.r * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Ghostly wisps trailing behind
    ctx.globalAlpha = fadeAlpha * 0.5;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.arc(-e.r * 0.6 - k * 4, (k % 2 === 0 ? 1 : -1) * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glowing eyes
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(e.r * 0.4, -3, 1.5, 0, Math.PI * 2);
    ctx.arc(e.r * 0.4, 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

  } else if (e.type === 'bomber') {
    // ── Bomber: orange bulbous ship with payload bays ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 18;
    ctx.rotate(Math.sin(e.t * 1.5) * 0.08);
    // Main bulbous body
    ctx.fillStyle = 'rgba(50, 20, 5, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.05, e.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Armored plating lines
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.9, 0);
    ctx.lineTo(e.r * 0.9, 0);
    ctx.moveTo(0, -e.r * 0.7);
    ctx.lineTo(0, e.r * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Payload indicators (4 small glowing bays)
    const bayPulse = (Math.sin(e.t * 4) + 1) * 0.5;
    ctx.fillStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 10;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.globalAlpha = 0.5 + bayPulse * 0.5;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * e.r * 0.55, Math.sin(a) * e.r * 0.55, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

  } else if (e.type === 'lancer') {
    // ── Lancer: white elongated spear that charges ──
    const charging = e.lancerCharge < 1.1; // visually signal charge state
    const windup = e.lancerCharge > 1.1;
    ctx.rotate(e.angle || 0);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = charging ? 28 : 15;
    // Windup warning flash
    if (windup) {
      ctx.strokeStyle = '#ff3860';
      ctx.globalAlpha = 0.6 + Math.sin(e.t * 20) * 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(600, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Long narrow spear shape
    ctx.fillStyle = 'rgba(80, 80, 90, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.r * 1.6, 0);
    ctx.lineTo(e.r * 0.3, -e.r * 0.45);
    ctx.lineTo(-e.r * 1.1, -e.r * 0.35);
    ctx.lineTo(-e.r * 1.3, 0);
    ctx.lineTo(-e.r * 1.1, e.r * 0.35);
    ctx.lineTo(e.r * 0.3, e.r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Energy core along spine
    ctx.strokeStyle = charging ? '#ffea00' : '#ffffff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-e.r * 1.0, 0);
    ctx.lineTo(e.r * 1.5, 0);
    ctx.stroke();
    // Bright tip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(e.r * 1.6, 0, 3, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'obelisk') {
    // ── Obelisk mini-boss: tall purple spire with rotating rings ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 35;
    // Outer rotating aura ring
    ctx.save();
    ctx.rotate(e.t * 0.8);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Spire body: tall hexagonal prism (rendered as stacked diamonds)
    ctx.fillStyle = 'rgba(40, 10, 60, 0.9)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2.5;
    // Main vertical diamond
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 1.1);
    ctx.lineTo(e.r * 0.55, -e.r * 0.3);
    ctx.lineTo(e.r * 0.7, e.r * 0.3);
    ctx.lineTo(0, e.r * 1.1);
    ctx.lineTo(-e.r * 0.7, e.r * 0.3);
    ctx.lineTo(-e.r * 0.55, -e.r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner glyph lines
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) {
      const y = k * 5;
      const xw = (1 - Math.abs(k) / 4) * e.r * 0.55;
      ctx.moveTo(-xw, y);
      ctx.lineTo(xw, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Glowing central core
    const corePulse = 0.8 + Math.sin(e.t * 3) * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(0, 0, 6 * corePulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(0, 0, 3.5 * corePulse, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'hive') {
    // ── Hive mini-boss: green pulsing cluster that spawns adds ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 30;
    ctx.rotate(e.t * 0.5);
    // Outer organic blob with 5 bumps
    ctx.fillStyle = 'rgba(10, 40, 5, 0.9)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const bumps = 8;
    for (let k = 0; k < bumps; k++) {
      const a = (k / bumps) * Math.PI * 2;
      const r = e.r + Math.sin(e.t * 2 + k) * 3;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Multiple spawn chambers inside (small circles)
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 12;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + e.t;
      const rad = e.r * 0.55;
      const chamberPulse = 0.6 + Math.sin(e.t * 3 + k) * 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rad, Math.sin(a) * rad, 3 * chamberPulse, 0, Math.PI * 2);
      ctx.fill();
    }
    // Central glowing nucleus
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 25;
    const nucPulse = 0.8 + Math.sin(e.t * 4) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 5 * nucPulse, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'sentinel') {
    // ── Sentinel mini-boss: yellow armored heavy with shields ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 28;
    // Outer armor plates (4 rotating)
    ctx.save();
    ctx.rotate(e.t * 0.7);
    ctx.fillStyle = 'rgba(50, 40, 0, 0.85)';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate((k / 4) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(e.r * 0.5, -e.r * 0.3);
      ctx.lineTo(e.r * 1.15, -e.r * 0.5);
      ctx.lineTo(e.r * 1.15, e.r * 0.5);
      ctx.lineTo(e.r * 0.5, e.r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // Inner core hexagon
    ctx.rotate(-e.t * 0.4);
    ctx.fillStyle = 'rgba(80, 60, 0, 0.9)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = Math.cos(a) * e.r * 0.55;
      const y = Math.sin(a) * e.r * 0.55;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Central targeting eye
    ctx.fillStyle = '#ff3860';
    ctx.shadowColor = '#ff3860';
    ctx.shadowBlur = 20;
    const eyePulse = 0.85 + Math.sin(e.t * 5) * 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, 5 * eyePulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2 * eyePulse, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 'prism') {
    // ── Prism mini-boss: crystalline rotating shape refracting light ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 35;
    // Three counter-rotating triangular crystal layers with different colors
    const colors = ['#5ac8fa', '#ff2d95', '#ffea00'];
    for (let layer = 0; layer < 3; layer++) {
      ctx.save();
      ctx.rotate(e.t * (layer === 0 ? 0.6 : layer === 1 ? -0.9 : 1.2));
      ctx.strokeStyle = colors[layer];
      ctx.shadowColor = colors[layer];
      ctx.shadowBlur = 22;
      ctx.fillStyle = `rgba(20, 20, 40, ${0.4 - layer * 0.1})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const size = e.r * (1.1 - layer * 0.25);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * size;
        const y = Math.sin(a) * size;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Central white core
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 25;
    const corePulse = 0.7 + Math.sin(e.t * 4) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 6 * corePulse, 0, Math.PI * 2);
    ctx.fill();
    // Refraction rays
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 12;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + e.t * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * e.r * 0.9, Math.sin(a) * e.r * 0.9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

  } else if (e.type === 'warden') {
    // ── Warden boss: massive layered core with orbiting shields ──
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 50;
    // Outer rotating spiked ring
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(40, 5, 10, 0.85)';
    ctx.save();
    ctx.rotate(e.t * 0.6);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rO = e.r * 1.05;
      ctx.lineTo(Math.cos(a) * rO, Math.sin(a) * rO);
      const aM = a + (Math.PI / 8);
      const rM = e.r * 0.85;
      ctx.lineTo(Math.cos(aM) * rM, Math.sin(aM) * rM);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Middle rotating ring (opposite direction)
    ctx.save();
    ctx.rotate(-e.t * 0.9);
    ctx.strokeStyle = '#ff2d95';
    ctx.shadowColor = '#ff2d95';
    ctx.shadowBlur = 25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * e.r * 0.65;
      const y = Math.sin(a) * e.r * 0.65;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Innermost rotating triangle
    ctx.save();
    ctx.rotate(e.t * 1.4);
    ctx.strokeStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const x = Math.cos(a) * e.r * 0.4;
      const y = Math.sin(a) * e.r * 0.4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Central eye (pulsing)
    const eyePulse = 0.8 + Math.sin(e.t * 4) * 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(0, 0, 7 * eyePulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(0, 0, 4 * eyePulse, 0, Math.PI * 2);
    ctx.fill();
    // Orbiting runes (indicate phase)
    const phaseRunes = e.phase === 2 ? 4 : e.phase === 1 ? 3 : 2;
    for (let i = 0; i < phaseRunes; i++) {
      const a = (i / phaseRunes) * Math.PI * 2 + e.t * 2;
      const rx = Math.cos(a) * (e.r + 18);
      const ry = Math.sin(a) * (e.r + 18);
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(a);
      ctx.fillStyle = '#ffea00';
      ctx.shadowColor = '#ffea00';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();

  // Brief white flash when hit
  if (e.hitFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, e.hitFlash / 0.1) * 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // HP bar for tough enemies
  if (e.maxHp > 3) {
    ctx.save();
    const barW = e.r * 2;
    const barH = e.type === 'warden' ? 6 : 4;
    const barY = e.y - e.r - (e.type === 'warden' ? 20 : 10);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(e.x - e.r, barY, barW, barH);
    ctx.fillStyle = e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(e.x - e.r, barY, barW * hpFrac, barH);
    // Segmented tick marks on boss bar
    if (e.type === 'warden') {
      ctx.fillStyle = 'rgba(10, 5, 20, 0.5)';
      ctx.shadowBlur = 0;
      for (let tick = 1; tick < 4; tick++) {
        ctx.fillRect(e.x - e.r + barW * (tick / 4) - 0.5, barY, 1, barH);
      }
    }
    ctx.restore();
  }
}

// ============================================================
// HUD
// ============================================================
function updateHUD() {
  if (!run) return;
  const pips = document.getElementById('hpPips');
  if (pips.children.length !== run.player.maxHp) {
    pips.innerHTML = '';
    for (let i = 0; i < run.player.maxHp; i++) {
      const p = document.createElement('div');
      p.className = 'pip';
      pips.appendChild(p);
    }
  }
  for (let i = 0; i < pips.children.length; i++) {
    pips.children[i].classList.toggle('empty', i >= run.player.hp);
  }
  document.getElementById('waveText').textContent = run.waveNum;
  // Show BOSS badge if currently on a boss wave
  const wt = document.getElementById('waveText');
  if (run.currentWaveInfo && (run.currentWaveInfo.type === 'mega' || run.currentWaveInfo.type === 'mini')) {
    wt.style.color = run.currentWaveInfo.type === 'mega' ? 'var(--red)' : 'var(--pink)';
    wt.style.textShadow = `0 0 12px ${run.currentWaveInfo.type === 'mega' ? 'var(--red)' : 'var(--pink)'}`;
  } else {
    wt.style.color = 'var(--pink)';
    wt.style.textShadow = '';
  }
  const tag = document.getElementById('sectorTag');
  if (tag) {
    const label = run.sector ? (run.challenge ? 'WEEKLY · ' : '') + sectorLabel(run.sector) : '';
    if (tag.textContent !== label) {
      tag.textContent = label;
      if (run.sector) tag.style.color = run.sector.accent;
    }
  }
  document.getElementById('scoreText').textContent = run.score.toLocaleString();
  document.getElementById('coresText').textContent = run.cores;
  document.getElementById('weaponText').textContent = run.weapons.projectileCount > 1
    ? `PULSE ×${run.weapons.projectileCount}` : 'PULSE';

  // Combo meter
  const cm = document.getElementById('comboMeter');
  document.getElementById('comboNum').textContent = run.combo;
  document.getElementById('comboMult').textContent = `×${run.comboMult.toFixed(1)}`;
  if (run.combo >= 3) {
    cm.classList.add('active');
    cm.classList.toggle('hot', run.comboMult >= 3);
  } else {
    cm.classList.remove('active', 'hot');
  }
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============================================================
// SCREEN TRANSITIONS
// ============================================================
function hideAll() {
  document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
}

function togglePause() {
  if (!run || !run.active) return;
  run.paused = !run.paused;
  document.getElementById('pauseScreen').classList.toggle('hidden', !run.paused);
  if (run.paused) pauseBGM(); else resumeBGM();
}

// "Weekly challenge · rank #3 of 11 pilots" on the death screen
async function showWeeklyStanding(week, score, result) {
  const el = document.getElementById('dsWeekly');
  if (!result.success) {
    el.textContent = result.reason === 'queued'
      ? 'Weekly challenge · your rank shows once the score posts'
      : 'Weekly challenge · score not ranked';
    return;
  }
  const standing = await fetchChallengeStanding(week, score);
  el.textContent = standing
    ? `Weekly challenge · rank #${standing.rank} of ${standing.total} pilot${standing.total === 1 ? '' : 's'}`
    : 'Weekly challenge · rank unavailable';
}

function gameOver() {
  run.active = false;
  stopBGM();
  const banked = run.cores;
  meta.bankedCores += banked;
  if (run.score > meta.bestScore) meta.bestScore = run.score;
  if (run.bestCombo > meta.bestCombo) meta.bestCombo = run.bestCombo;
  if (run.waveNum > (meta.bestWave || 0)) meta.bestWave = run.waveNum;
  saveMeta();

  // Submit to global leaderboard (fire and forget)
  const challengeWeek = run.challengeWeek;
  const finalScore = run.score;
  const dsWeekly = document.getElementById('dsWeekly');
  dsWeekly.classList.toggle('hidden', !challengeWeek);
  dsWeekly.textContent = challengeWeek ? 'Weekly challenge · checking your rank...' : '';
  submitScore({
    wave: run.waveNum,
    score: run.score,
    challengeWeek: run.challengeWeek,
    bestCombo: run.bestCombo,
    cores: run.cores,
    runDurationMs: Math.round(run.timeElapsed * 1000),
    upgrades: run.upgrades || []
  }).then((result) => {
    if (result.success) {
      toast('Score submitted to leaderboard');
    } else if (result.reason === 'queued') {
      toast('Offline: score will post when you reconnect');
    }
    if (challengeWeek) showWeeklyStanding(challengeWeek, finalScore, result);
  });

  hideAll();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('controlsPanel').classList.add('hidden');
  document.getElementById('deathSubtitle').textContent = 'Lost to the void';
  document.getElementById('dsWave').textContent = run.waveNum;
  document.getElementById('dsScore').textContent = run.score.toLocaleString();
  document.getElementById('dsCores').textContent = run.cores;
  document.getElementById('dsCombo').textContent = run.bestCombo;
  document.getElementById('dsBanked').textContent = banked;
  document.getElementById('dsXp').textContent = awardXp(run.waveNum, run.score);
  document.getElementById('deathScreen').classList.remove('hidden');
}

// ---- Ships screen: pick a ship and a pilot color ----
function drawShipCard(canvas, ship, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 150, h = canvas.clientHeight || 100;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0a0514';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(184, 71, 255, 0.12)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.translate(w / 2 + 4, h / 2);
  g.rotate(-0.3);
  drawShipModel(g, ship.id, color, 1.3, { scale: Math.min(w, h) / 52 });
}

function openShips() {
  const level = pilotLevel();
  const nextXp = xpForLevel(level + 1), baseXp = xpForLevel(level);
  document.getElementById('shipsSubtitle').textContent = `Pilot level ${level}`;
  document.getElementById('shipsXpFill').style.width = `${Math.min(100, ((meta.xp - baseXp) / (nextXp - baseXp)) * 100)}%`;
  document.getElementById('shipsXpText').textContent =
    `${meta.xp.toLocaleString()} XP · ${(nextXp - meta.xp).toLocaleString()} to level ${level + 1}`;

  const colors = document.getElementById('shipColors');
  colors.innerHTML = '';
  PILOT_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'ship-color';
    b.id = 'shipColor' + i;
    b.style.setProperty('--c', c);
    b.title = PILOT_COLOR_NAMES[i];
    b.setAttribute('aria-label', PILOT_COLOR_NAMES[i]);
    b.setAttribute('aria-pressed', i === meta.color ? 'true' : 'false');
    b.onclick = () => { meta.color = i; saveMeta(); syncLoadout(); openShips(); };
    colors.appendChild(b);
  });

  const grid = document.getElementById('shipGrid');
  grid.innerHTML = '';
  const chosen = currentShip().id;
  for (const ship of SHIPS) {
    const unlocked = level >= ship.level;
    const b = document.createElement('button');
    b.className = 'ship-card' + (unlocked ? '' : ' locked');
    b.id = 'shipCard-' + ship.id;
    b.setAttribute('aria-pressed', ship.id === chosen ? 'true' : 'false');
    b.innerHTML = `<canvas></canvas>
      <div class="ship-info">
        <div class="ship-name">${ship.name.toUpperCase()}</div>
        <div class="ship-style">${unlocked ? ship.style : 'Locked · LV ' + ship.level}</div>
        <div class="ship-perk">${ship.perk}</div>
      </div>`;
    if (unlocked) {
      b.onclick = () => { meta.ship = ship.id; saveMeta(); syncLoadout(); refreshPilotLevelLine(); openShips(); };
    } else {
      b.disabled = true;
    }
    grid.appendChild(b);
  }
  hideAll();
  document.getElementById('shipsScreen').classList.remove('hidden');
  // Draw after the screen is visible so the canvases have their real size.
  requestAnimationFrame(() => {
    for (const ship of SHIPS) {
      const c = document.querySelector(`#shipCard-${ship.id} canvas`);
      if (c) drawShipCard(c, ship, currentColor());
    }
  });
}

// Tell the multiplayer room about a ship or color change (no-op outside one).
function syncLoadout() {
  setLoadout(currentShip().id, meta.color);
}

function openMeta() {
  const grid = document.getElementById('metaGrid');
  grid.innerHTML = '';
  document.getElementById('metaCoresText').textContent = meta.bankedCores.toLocaleString();
  for (const [key, node] of Object.entries(meta.nodes)) {
    const info = META_INFO[key];
    const el = document.createElement('div');
    const maxed = node.level >= node.max;
    const cost = maxed ? '—' : nodeCost(node);
    const affordable = !maxed && meta.bankedCores >= cost;
    el.className = 'meta-node' + (maxed ? ' maxed' : '') + (!affordable && !maxed ? ' locked' : '');
    el.innerHTML = `
      <div>
        <div class="meta-name">${info.icon} ${info.name}</div>
        <div class="meta-desc">${info.desc}</div>
        <div class="meta-level">LVL ${node.level} / ${node.max}</div>
      </div>
      <div class="meta-cost">${maxed ? 'MAX' : cost + ' ⬡'}</div>
    `;
    if (!maxed && affordable) {
      el.onclick = () => {
        meta.bankedCores -= cost;
        node.level++;
        saveMeta();
        openMeta();
      };
    }
    grid.appendChild(el);
  }
  hideAll();
  document.getElementById('metaScreen').classList.remove('hidden');
}

// ============================================================
// EVENTS
// ============================================================
document.getElementById('startBtn').onclick = () => { hideAll(); newRun(); };

// This week's challenge: same seed, route, boss and rules for every pilot
function startChallengeRun() {
  newRun({
    seed: getCurrentChallengeSeed(),
    challengeWeek: getCurrentChallengeWeek()
  });
}
document.getElementById('metaBtn').onclick = openMeta;
document.getElementById('shipsBtn').onclick = openShips;
document.getElementById('closeShipsBtn').onclick = () => { hideAll(); document.getElementById('titleScreen').classList.remove('hidden'); };
refreshPilotLevelLine();
syncLoadout();
document.getElementById('closeMetaBtn').onclick = () => { hideAll(); document.getElementById('titleScreen').classList.remove('hidden'); };
document.getElementById('resetBtn').onclick = () => {
  const where = isSignedIn() ? 'on this device and your account' : 'on this device';
  if (confirm(`Wipe all progress ${where}? Pilot level, ships, Hangar upgrades and cores reset to zero.`)) {
    localStorage.removeItem(STORAGE_KEY);
    meta = loadMeta();
    saveMeta();
    refreshPilotLevelLine();
    syncLoadout();
    alert('Progress reset.');
  }
};
document.getElementById('retryBtn').onclick = () => {
  // MP runs can't be retried in place — leave the room and return to title.
  if (run?.isMultiplayer) {
    leaveRoom().catch(() => {});
    run = null;
    hideAll();
    document.getElementById('titleScreen').classList.remove('hidden');
    return;
  }
  hideAll();
  if (run?.challengeWeek) startChallengeRun();
  else newRun();
};
document.getElementById('deathMetaBtn').onclick = openMeta;
document.getElementById('deathTitleBtn').onclick = () => {
  if (run?.isMultiplayer) {
    leaveRoom().catch(() => {});
    run = null;
  }
  hideAll();
  document.getElementById('titleScreen').classList.remove('hidden');
};
document.getElementById('leaveShopBtn').onclick = () => {
  hideAll();
  // A boss always closes out a sector, so leaving the shop means a jump
  beginWarp(run.waveNum + 1);
};
document.getElementById('resumeBtn').onclick = togglePause;
document.getElementById('abandonBtn').onclick = () => {
  // If we're in a multiplayer run, leave the Colyseus room so other clients
  // see us depart and we don't keep an orphan session open.
  if (run?.isMultiplayer) {
    leaveRoom().catch(() => {});
  }
  if (run) { run.active = false; }
  stopBGM();
  hideAll();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('controlsPanel').classList.add('hidden');
  document.getElementById('titleScreen').classList.remove('hidden');
};

// Controls panel collapse toggle
(() => {
  const panel = document.getElementById('controlsPanel');
  const toggle = document.getElementById('panelToggle');
  const icon = document.getElementById('toggleIcon');
  if (panel && toggle) {
    // Auto-collapse on narrow screens
    if (window.innerWidth < 480) {
      panel.classList.add('collapsed');
      icon.textContent = '?';
    }
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      icon.textContent = collapsed ? '?' : '−';
    });
  }
})();

// ============================================================
// LEADERBOARD UI WIRING
// ============================================================
(() => {
  // Display name input - dual-purpose:
  //   signed out -> writes to localStorage (anon name)
  //   signed in  -> writes to profiles.display_name (debounced)
  const nameInput = document.getElementById('displayNameInput');
  const pilotLabel = document.getElementById('pilotNameLabel');
  let profileSaveTimer = null;
  function refreshNameInput() {
    if (!nameInput) return;
    // Don't rewrite the box while the pilot is typing in it (a save would
    // trim away the space they just typed).
    if (document.activeElement === nameInput) return;
    if (isSignedIn()) {
      const p = getProfile();
      nameInput.value = p?.display_name || '';
      nameInput.placeholder = 'Pilot name';
      if (pilotLabel) pilotLabel.textContent = 'PROFILE NAME:';
    } else {
      nameInput.value = getDisplayName();
      nameInput.placeholder = 'Anonymous';
      if (pilotLabel) pilotLabel.textContent = 'PILOT NAME:';
    }
  }
  if (nameInput) {
    refreshNameInput();
    nameInput.addEventListener('input', (e) => {
      const v = e.target.value;
      if (isSignedIn()) {
        if (profileSaveTimer) clearTimeout(profileSaveTimer);
        profileSaveTimer = setTimeout(async () => {
          const { error } = await setProfileDisplayName(v);
          if (error) toast("Couldn't save your name. Try again in a moment.");
        }, 400);
      } else {
        setDisplayName(v);
      }
    });
  }

  // Global stats on title screen
  function refreshGlobalStats() {
    const bar = document.getElementById('globalStatsBar');
    if (!bar) return;
    if (!isLeaderboardEnabled()) {
      bar.textContent = 'LEADERBOARD OFFLINE · PLAYING LOCALLY';
      return;
    }
    if (isOffline()) {
      bar.textContent = 'OFFLINE · SOLO RUNS, SHIPS AND HANGAR STILL WORK';
      return;
    }
    bar.textContent = 'LOADING STATS...';
    fetchGlobalStats().then((stats) => {
      if (!stats) {
        bar.textContent = 'LEADERBOARD ONLINE · BE THE FIRST TO SET A RECORD';
        return;
      }
      bar.innerHTML = `${stats.total_runs.toLocaleString()} RUNS · RECORD WAVE <span style="color: var(--pink)">${stats.record_wave}</span> · RECORD SCORE <span style="color: var(--yellow)">${stats.record_score.toLocaleString()}</span>`;
    });
  }
  refreshGlobalStats();

  // Coming back online: post runs finished offline and refresh the stats.
  async function onReconnect() {
    const sent = await flushPendingScores();
    if (sent > 0) toast(sent === 1 ? 'Offline run posted to the leaderboard' : `${sent} offline runs posted to the leaderboard`);
    refreshGlobalStats();
  }
  window.addEventListener('online', onReconnect);
  window.addEventListener('offline', refreshGlobalStats);
  onReconnect();

  // Leaderboard button + scope toggle (Global / Friends)
  let leaderboardScope = 'global';
  function renderLeaderboardRows(rows, list, scope) {
    if (!rows || rows.length === 0) {
      const empty = scope === 'friends'
        ? 'No friend scores yet — invite some pilots!'
        : scope === 'challenge' ? 'Nobody has flown this week\'s challenge yet. Be the first!'
        : scope === 'lastweek' ? 'Nobody flew last week\'s challenge.'
        : 'No scores yet — be the first!';
      list.innerHTML = `<div class="dim" style="text-align: center; padding: 40px 0;">${empty}</div>`;
      return;
    }
    list.innerHTML = rows.map((r, i) => {
      const rank = (i + 1).toString().padStart(2, '0');
      const name = (r.display_name || 'anon').substring(0, 18);
      const nameCol = r.display_name ? 'var(--cyan)' : 'var(--dim)';
      return `
        <div style="display: grid; grid-template-columns: 30px 1fr 70px 50px; gap: 10px; padding: 6px 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <span style="color: var(--yellow); font-weight: bold;">#${rank}</span>
          <span style="color: ${nameCol};">${escapeHtml(name)}</span>
          <span style="color: var(--yellow); text-align: right;">${r.score.toLocaleString()}</span>
          <span style="color: var(--pink); text-align: right;">W${r.wave}</span>
        </div>
      `;
    }).join('');
  }
  function paintScopeButtons() {
    const g = document.getElementById('lbScopeGlobal');
    const f = document.getElementById('lbScopeFriends');
    const c = document.getElementById('lbScopeChallenge');
    const lw = document.getElementById('lbScopeLastWeek');
    const base = 'padding: 4px 14px; font-size: 11px;';
    const active = ' border-color: var(--pink); color: var(--pink);';
    if (g) g.style.cssText = base + (leaderboardScope === 'global' ? active : '');
    if (f) f.style.cssText = base + (leaderboardScope === 'friends' ? active : '');
    if (c) c.style.cssText = base + (leaderboardScope === 'challenge' ? active : '');
    if (lw) lw.style.cssText = base + (leaderboardScope === 'lastweek' ? active : '');
  }
  async function loadLeaderboard() {
    const list = document.getElementById('leaderboardList');
    const myBestLine = document.getElementById('myBestLine');
    if (!list) return;
    paintScopeButtons();
    list.innerHTML = '<div class="dim" style="text-align: center; padding: 40px 0;">Loading...</div>';
    myBestLine.textContent = '';
    if (!isLeaderboardEnabled()) {
      list.innerHTML = '<div class="dim" style="text-align: center; padding: 40px 0;">Leaderboard unavailable (offline mode)</div>';
      return;
    }
    if (isOffline()) {
      list.innerHTML = '<div class="dim" style="text-align: center; padding: 40px 0;">You\'re offline. Leaderboards come back when you reconnect.</div>';
      return;
    }
    if (leaderboardScope === 'friends' && !isSignedIn()) {
      list.innerHTML = '<div class="dim" style="text-align: center; padding: 40px 0;">Sign in to see your friends-only leaderboard.</div>';
      return;
    }
    // Weekly tabs show the week's best run per pilot, and your best that week
    const week = leaderboardScope === 'challenge' ? getCurrentChallengeWeek()
               : leaderboardScope === 'lastweek' ? getPreviousChallengeWeek()
               : null;
    const fetcher = leaderboardScope === 'friends' ? fetchFriendsLeaderboard
                  : week ? () => fetchChallengeLeaderboard(week, 20)
                  : fetchLeaderboard;
    const [rows, myBest] = await Promise.all([fetcher(20), fetchMyBest(week)]);
    if (week) {
      const label = `Week of ${formatChallengeWeek(week)}`;
      myBestLine.textContent = myBest
        ? `${label} · Your best: Wave ${myBest.wave} · Score ${myBest.score.toLocaleString()}`
        : `${label} · You haven't flown it yet`;
    } else if (myBest) {
      myBestLine.textContent = `Your best: Wave ${myBest.wave} · Score ${myBest.score.toLocaleString()}`;
    }
    renderLeaderboardRows(rows, list, leaderboardScope);
  }
  const lbBtn = document.getElementById('leaderboardBtn');
  if (lbBtn) {
    lbBtn.onclick = () => {
      hideAll();
      document.getElementById('leaderboardScreen').classList.remove('hidden');
      loadLeaderboard();
    };
  }
  const lbScopeG = document.getElementById('lbScopeGlobal');
  const lbScopeF = document.getElementById('lbScopeFriends');
  const lbScopeC = document.getElementById('lbScopeChallenge');
  if (lbScopeG) lbScopeG.onclick = () => { leaderboardScope = 'global'; loadLeaderboard(); };
  if (lbScopeF) lbScopeF.onclick = () => { leaderboardScope = 'friends'; loadLeaderboard(); };
  if (lbScopeC) lbScopeC.onclick = () => { leaderboardScope = 'challenge'; loadLeaderboard(); };
  const lbScopeLW = document.getElementById('lbScopeLastWeek');
  if (lbScopeLW) lbScopeLW.onclick = () => { leaderboardScope = 'lastweek'; loadLeaderboard(); };

  // ----------------------------------------------------------
  // MULTIPLAYER LOBBY WIRING (Phase 8a)
  // ----------------------------------------------------------
  const mpScreen = document.getElementById('multiplayerScreen');
  const mpLobbyView = document.getElementById('mpLobbyView');
  const mpRoomView = document.getElementById('mpRoomView');
  const mpJoinInput = document.getElementById('mpJoinCodeInput');
  const mpLobbyMsg = document.getElementById('mpLobbyMessage');
  const mpCreateBtn = document.getElementById('mpCreateBtn');
  const mpJoinBtn = document.getElementById('mpJoinBtn');
  const mpRoomCode = document.getElementById('mpRoomCode');
  const mpPlayerList = document.getElementById('mpPlayerList');
  const mpReadyBtn = document.getElementById('mpReadyBtn');
  const mpStartBtn = document.getElementById('mpStartBtn');
  const mpLeaveBtn = document.getElementById('mpLeaveBtn');
  const mpCloseBtn = document.getElementById('mpCloseBtn');
  const mpBtn = document.getElementById('multiplayerBtn');

  // Lobby errors in words a pilot can act on; connection failures from the
  // client library arrive with no message or a raw network one.
  function mpErrorText(error, fallback) {
    if (isOffline()) return 'Multiplayer needs an internet connection.';
    const msg = error?.message || '';
    if (!msg || msg === fallback || /fetch|network|socket|load failed/i.test(msg)) {
      return "Couldn't reach the multiplayer server. Check your connection and try again.";
    }
    return msg;
  }

  function showMpLobbyMessage(text, kind) {
    if (!mpLobbyMsg) return;
    mpLobbyMsg.textContent = text || '';
    mpLobbyMsg.style.color = kind === 'error' ? 'var(--red, #ff4d6d)'
      : kind === 'success' ? 'var(--cyan)'
      : '';
  }

  function renderMpState(state) {
    if (!mpScreen) return;
    if (state.inRoom) {
      mpLobbyView.classList.add('hidden');
      mpRoomView.classList.remove('hidden');
      mpRoomCode.textContent = state.code || '------';
      mpPlayerList.innerHTML = state.players.map((p) => `
        <div style="display: flex; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <span style="color: ${pilotColor(p.slot)};"><span style="display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: ${pilotColor(p.slot)}; box-shadow: 0 0 6px ${pilotColor(p.slot)};"></span>${escapeHtml(p.name)} <span class="dim">· ${escapeHtml(getShip(p.ship).name)}</span> ${p.isHost ? '<span style="color: var(--yellow);">[host]</span>' : ''} ${p.isMe ? '<span class="dim">(you)</span>' : ''}</span>
          <span style="color: ${p.ready ? '#39ff14' : 'var(--dim)'};">${p.ready ? 'READY' : 'not ready'}</span>
        </div>
      `).join('');
      // My ready state
      const me = state.players.find((p) => p.isMe);
      if (me) {
        mpReadyBtn.textContent = me.ready ? 'Unready' : 'Ready Up';
      }
      const allReady = state.players.length > 0 && state.players.every((p) => p.ready);
      if (state.isHost) {
        mpStartBtn.classList.remove('hidden');
        mpStartBtn.disabled = !allReady;
        mpStartBtn.style.opacity = allReady ? '1' : '0.5';
      } else {
        mpStartBtn.classList.add('hidden');
      }
    } else {
      mpLobbyView.classList.remove('hidden');
      mpRoomView.classList.add('hidden');
    }
  }

  if (mpBtn) {
    mpBtn.onclick = () => {
      if (!multiplayerEnabled) {
        alert('Multiplayer server not configured (VITE_COLYSEUS_URL missing).');
        return;
      }
      hideAll();
      mpScreen.classList.remove('hidden');
      showMpLobbyMessage('');
      if (mpJoinInput) mpJoinInput.value = '';
    };
  }
  if (mpCloseBtn) {
    mpCloseBtn.onclick = () => {
      hideAll();
      document.getElementById('titleScreen').classList.remove('hidden');
    };
  }
  if (mpCreateBtn) {
    mpCreateBtn.onclick = async () => {
      if (isOffline()) { showMpLobbyMessage('Multiplayer needs an internet connection.', 'error'); return; }
      mpCreateBtn.disabled = true;
      showMpLobbyMessage('Creating room...', '');
      const name = (getProfile()?.display_name) || (typeof getDisplayName === 'function' ? getDisplayName() : '') || 'Pilot';
      const { error } = await createRoom(name);
      mpCreateBtn.disabled = false;
      if (error) showMpLobbyMessage(mpErrorText(error, 'Create failed'), 'error');
    };
  }
  if (mpJoinBtn) {
    mpJoinBtn.onclick = async () => {
      const code = (mpJoinInput?.value || '').trim().toUpperCase();
      if (isOffline()) { showMpLobbyMessage('Multiplayer needs an internet connection.', 'error'); return; }
      mpJoinBtn.disabled = true;
      showMpLobbyMessage('Joining...', '');
      const name = (getProfile()?.display_name) || (typeof getDisplayName === 'function' ? getDisplayName() : '') || 'Pilot';
      const { error } = await joinRoomByCode(code, name);
      mpJoinBtn.disabled = false;
      if (error) showMpLobbyMessage(mpErrorText(error, 'Join failed'), 'error');
    };
  }
  if (mpJoinInput) {
    mpJoinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') mpJoinBtn?.click();
    });
  }
  if (mpReadyBtn) {
    mpReadyBtn.onclick = () => {
      const isReady = mpReadyBtn.textContent.trim() === 'Unready';
      sendSetReady(!isReady);
    };
  }
  if (mpStartBtn) {
    mpStartBtn.onclick = () => sendStart();
  }
  if (mpLeaveBtn) {
    mpLeaveBtn.onclick = async () => {
      await leaveRoom();
    };
  }

  onMultiplayerChange(renderMpState);
  onGameStart(({ seed }) => {
    // Server runs the authoritative simulation; client renders state + sends input.
    hideAll();
    newRun({ seed, isMultiplayer: true });
  });

  onGameEnd(({ totalScore, waveReached }) => {
    if (!run?.isMultiplayer) return;
    run.active = false;
    stopBGM();
    hideAll();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('deathSubtitle').textContent = 'The whole squad is lost to the void';
    document.getElementById('dsWave').textContent = waveReached || 1;
    document.getElementById('dsScore').textContent = (totalScore || 0).toLocaleString();
    document.getElementById('dsCores').textContent = '—';
    document.getElementById('dsCombo').textContent = '—';
    document.getElementById('dsBanked').textContent = '0';
    document.getElementById('dsXp').textContent = awardXp(waveReached || 1, getMyScore());
    document.getElementById('deathScreen').classList.remove('hidden');
    // Submit MY personal score to the leaderboard. Anon submissions still
    // work; signed-in submissions get attributed to the user_id.
    const personal = getMyScore();
    if (personal > 0 && waveReached > 0) {
      submitScore({
        wave: waveReached,
        score: personal,
        bestCombo: 0,
        cores: 0,
        runDurationMs: Math.round((run.timeElapsed || 0) * 1000),
        upgrades: []
      }).then((res) => {
        const sub = document.getElementById('deathSubtitle');
        if (res?.success) sub.textContent = sub.textContent + ' · Score saved';
      }).catch(() => {});
    }
  });

  // Upgrade pick flow during multiplayer runs
  onUpgradeChoices(({ choices }) => {
    if (!run?.isMultiplayer) return;
    showMpUpgradeScreen(choices || []);
  });
  onWavePhase(() => {
    hideMpUpgradeScreen();
  });

  // Cosmetic FX broadcasts from the server (enemy death / player hit / boss).
  onFx((msg) => {
    if (!run?.isMultiplayer || !msg) return;
    if (msg.type === 'enemyDeath') {
      const big = BOSS_TYPES.includes(msg.eType);
      const color = ENEMY_DEFS[msg.eType]?.color || MP_ENEMY_COLORS[msg.eType] || '#ff2d95';
      spawnExplosion(msg.x, msg.y, color, big ? 60 : 20);
      spawnMpParticles({
        x: msg.x, y: msg.y, color,
        count: big ? 50 : 10,
        speed: big ? 380 : 220,
        life: big ? 0.9 : 0.55,
        size: big ? 3 : 2
      });
      if (big) {
        run.screenShake = 20;
        const view = [...mpViews.enemies.values()].find((v) => v.type === msg.eType && Math.hypot(v.x - msg.x, v.y - msg.y) < 80);
        queueBossDeathFx({ x: msg.x, y: msg.y, r: msg.r || 40, color, parts: view && view.parts });
      }
      playSound('explosion');
    } else if (msg.type === 'rockBreak') {
      const kind = msg.rockKind === 'stone' ? 'asteroid' : msg.rockKind;
      spawnRockDebris(msg.x, msg.y, msg.r, rockColors(run.sector || sectorForWave(1), kind || 'asteroid').rim);
    } else if (msg.type === 'mineBlast') {
      spawnExplosion(msg.x, msg.y, '#ff3860', msg.blast * 0.5);
      spawnShockwave(msg.x, msg.y, '#ffb347');
      run.screenShake = Math.max(run.screenShake, 9);
    } else if (msg.type === 'strike') {
      spawnExplosion(msg.x, msg.y, '#c08bff', 20);
      run.screenShake = Math.max(run.screenShake, 8);
    } else if (msg.type === 'wellGone') {
      spawnShockwave(msg.x, msg.y, '#b847ff');
    } else if (msg.type === 'shake') {
      run.screenShake = Math.max(run.screenShake, msg.n || 6);
    } else if (msg.type === 'sound') {
      playSound(msg.name);
    } else if (msg.type === 'playerHit') {
      spawnMpParticles({
        x: msg.x, y: msg.y, color: '#ff4d6d',
        count: 20, speed: 260, life: 0.6, size: 3
      });
      const mine = msg.sid
        ? msg.sid === getCurrentRoom()?.sessionId
        : Math.hypot(msg.x - run.player.x, msg.y - run.player.y) < 40;
      if (mine) {
        run.screenShake = 14;
        run.player.iframes = 1.0;
      } else if (msg.sid && mpViews.ships.has(msg.sid)) {
        mpViews.ships.get(msg.sid).iframes = 1.0;
      }
    } else if (msg.type === 'revive') {
      spawnMpParticles({ x: msg.x, y: msg.y, color: '#00f0ff', count: 36, speed: 280, life: 0.8, size: 3 });
      spawnShockwave(msg.x, msg.y, '#00f0ff');
      if (msg.sid === getCurrentRoom()?.sessionId) {
        run.player.iframes = 2;
        toast("You're back in!");
      } else {
        toast(`${msg.name || 'Pilot'} is back in!`);
      }
    } else if (msg.type === 'bossSpawn') {
      playSound('bosswarn');
    } else if (msg.type === 'waveStart') {
      let sub = '';
      if (msg.kind !== 'regular') {
        sub = BOSS_TITLES[msg.bossType] || '';
        run.mpBossName = msg.name;
      } else if (sectorForWave(msg.wave).waveInSector === 0) {
        sub = sectorLabel(sectorForWave(msg.wave));
      }
      announceWave(msg.wave, msg.kind, msg.name, sub);
    } else if (msg.type === 'shieldBreak') {
      spawnExplosion(msg.x, msg.y, '#7fdcff', 26);
      if (msg.sid === getCurrentRoom()?.sessionId) run.screenShake = 6;
    } else if (msg.type === 'burst') {
      spawnExplosion(msg.x, msg.y, msg.color || '#ff2d95', msg.size || 30);
    } else if (msg.type === 'shockwave') {
      spawnShockwave(msg.x, msg.y, '#00f0ff');
    } else if (msg.type === 'fusionStart') {
      spawnMpParticles({ x: msg.x, y: msg.y, color: '#ff2d95', count: 60, speed: 420, life: 0.9, size: 3 });
      spawnMpParticles({ x: msg.x, y: msg.y, color: '#00f0ff', count: 40, speed: 300, life: 0.8, size: 3 });
      playSound('bosswarn');
      toast('FUSION! One ship, giant cannons');
    } else if (msg.type === 'fusionEnd') {
      spawnMpParticles({ x: msg.x, y: msg.y, color: '#00f0ff', count: 30, speed: 260, life: 0.6, size: 2 });
      toast('Fusion over · split up');
    }
  });

  // Weekly challenge banner + button on title screen
  const challengeInfo = document.getElementById('weeklyChallengeInfo');
  if (challengeInfo) {
    const week = getCurrentChallengeWeek();
    const ch = weeklyChallenge(week);
    challengeInfo.textContent = `Week of ${formatChallengeWeek(week)} · ${ch.first.name}`;
    const boss = ch.featuredTwists.map((t) => TWISTS[t].name).join(' ') + ' ' + ch.featured.toUpperCase();
    const details = document.getElementById('weeklyChallengeDetails');
    if (details) {
      details.innerHTML = `BOSS: <span style="color: var(--cyan);">${escapeHtml(boss)}</span><br>`
        + 'RULES: ' + ch.rules.map((r) => `<span style="color: var(--yellow);" title="${escapeHtml(RULES[r].desc)}">${escapeHtml(RULES[r].name)}</span>`).join(' · ')
        + `<br>${ch.rules.map((r) => escapeHtml(RULES[r].desc)).join(' · ')}`;
    }
  }
  const playChallengeBtn = document.getElementById('playChallengeBtn');
  if (playChallengeBtn) {
    playChallengeBtn.onclick = () => {
      hideAll();
      startChallengeRun();
    };
  }
  document.getElementById('closeLeaderboardBtn').onclick = () => {
    hideAll();
    document.getElementById('titleScreen').classList.remove('hidden');
    refreshGlobalStats();
  };

  // Refresh global stats when returning from death/abandon
  const deathTitleBtn = document.getElementById('deathTitleBtn');
  if (deathTitleBtn) {
    const oldHandler = deathTitleBtn.onclick;
    deathTitleBtn.onclick = () => {
      if (oldHandler) oldHandler();
      refreshGlobalStats();
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ----------------------------------------------------------
  // AUTH UI WIRING (sign in / sign out / magic link)
  // ----------------------------------------------------------
  const authStatusText = document.getElementById('authStatusText');
  const authActionBtn = document.getElementById('authActionBtn');
  const authScreen = document.getElementById('authScreen');
  const authEmailInput = document.getElementById('authEmailInput');
  const authPasswordInput = document.getElementById('authPasswordInput');
  const authMessage = document.getElementById('authMessage');
  const signInBtn = document.getElementById('signInBtn');
  const signUpBtn = document.getElementById('signUpBtn');
  const closeAuthBtn = document.getElementById('closeAuthBtn');

  function showAuthMessage(text, kind) {
    if (!authMessage) return;
    authMessage.textContent = text || '';
    authMessage.style.color = kind === 'error' ? 'var(--red, #ff4d6d)'
      : kind === 'success' ? 'var(--cyan)'
      : '';
  }

  function openAuthScreen() {
    hideAll();
    authScreen.classList.remove('hidden');
    showAuthMessage('');
    if (authEmailInput) authEmailInput.value = '';
    if (authPasswordInput) authPasswordInput.value = '';
    setTimeout(() => authEmailInput?.focus(), 50);
  }
  function closeAuthScreen() {
    hideAll();
    document.getElementById('titleScreen').classList.remove('hidden');
  }

  if (authActionBtn) {
    authActionBtn.onclick = async () => {
      if (!isLeaderboardEnabled()) {
        showAuthMessage('Leaderboard offline — sign-in unavailable', 'error');
        return;
      }
      if (isSignedIn()) {
        authActionBtn.disabled = true;
        await signOut();
        authActionBtn.disabled = false;
      } else {
        openAuthScreen();
      }
    };
  }

  async function runAuth(mode) {
    const email = authEmailInput?.value || '';
    const password = authPasswordInput?.value || '';
    signInBtn.disabled = true;
    signUpBtn.disabled = true;
    showAuthMessage(mode === 'signup' ? 'Creating account...' : 'Signing in...', '');
    const { error } = mode === 'signup'
      ? await signUpWithPassword(email, password)
      : await signInWithPassword(email, password);
    signInBtn.disabled = false;
    signUpBtn.disabled = false;
    if (error) {
      showAuthMessage(error.message || 'Failed', 'error');
    } else if (mode === 'signup') {
      // If email confirmation is enabled in Supabase, no session is returned;
      // otherwise the auth state listener will close the screen automatically.
      showAuthMessage('Account created. Signing you in...', 'success');
    }
    // Successful sign-in is handled by onAuthChange (closes the screen).
  }

  if (signInBtn) signInBtn.onclick = () => runAuth('signin');
  if (signUpBtn) signUpBtn.onclick = () => runAuth('signup');
  if (closeAuthBtn) closeAuthBtn.onclick = closeAuthScreen;
  [authEmailInput, authPasswordInput].forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runAuth('signin');
    });
  });

  // Reflect auth state in the title-screen UI whenever it changes
  const profileBtn = document.getElementById('profileBtn');
  onAuthChange(({ session, profile }) => {
    if (!authStatusText || !authActionBtn) return;
    if (session?.user) {
      const name = profile?.display_name || session.user.email || 'pilot';
      authStatusText.textContent = `SIGNED IN: ${name.toUpperCase()}`;
      authStatusText.classList.remove('dim');
      authActionBtn.textContent = 'Sign Out';
      if (profileBtn) profileBtn.classList.remove('hidden');
      // If we just landed back from a magic-link redirect, return to title.
      if (!authScreen.classList.contains('hidden')) closeAuthScreen();
    } else {
      authStatusText.textContent = 'NOT SIGNED IN';
      authStatusText.classList.add('dim');
      authActionBtn.textContent = 'Sign In';
      if (profileBtn) profileBtn.classList.add('hidden');
    }
    refreshNameInput();
  });

  // ----------------------------------------------------------
  // FORGOT PASSWORD (on auth screen)
  // ----------------------------------------------------------
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  if (forgotBtn) {
    forgotBtn.onclick = async () => {
      const email = (authEmailInput?.value || '').trim();
      if (!email) {
        showAuthMessage('Enter your email above first, then tap Forgot.', 'error');
        authEmailInput?.focus();
        return;
      }
      forgotBtn.disabled = true;
      showAuthMessage('Sending reset link...', '');
      const { error } = await requestPasswordReset(email);
      forgotBtn.disabled = false;
      if (error) {
        showAuthMessage(error.message || 'Reset failed', 'error');
      } else {
        showAuthMessage(`Reset link sent to ${email}. Check your inbox.`, 'success');
      }
    };
  }

  // ----------------------------------------------------------
  // PROFILE SCREEN
  // ----------------------------------------------------------
  const profileScreen = document.getElementById('profileScreen');
  const profileEmailDisplay = document.getElementById('profileEmailDisplay');
  const profileNameInput = document.getElementById('profileNameInput');
  const profileNameSaved = document.getElementById('profileNameSaved');
  const profileNewPassword = document.getElementById('profileNewPassword');
  const profileConfirmPassword = document.getElementById('profileConfirmPassword');
  const profilePasswordMsg = document.getElementById('profilePasswordMsg');
  const profileUpdatePasswordBtn = document.getElementById('profileUpdatePasswordBtn');
  const profileSignOutBtn = document.getElementById('profileSignOutBtn');
  const closeProfileBtn = document.getElementById('closeProfileBtn');
  const profileDeleteBtn = document.getElementById('profileDeleteBtn');
  const profileDeleteConfirm = document.getElementById('profileDeleteConfirm');
  const profileDeleteMsg = document.getElementById('profileDeleteMsg');
  const profileDeleteConfirmBtn = document.getElementById('profileDeleteConfirmBtn');
  const profileDeleteCancelBtn = document.getElementById('profileDeleteCancelBtn');

  function openProfile() {
    if (!isSignedIn()) return;
    hideAll();
    profileScreen.classList.remove('hidden');
    const s = getSession();
    const p = getProfile();
    profileEmailDisplay.textContent = s?.user?.email || '';
    profileNameInput.value = p?.display_name || '';
    profileNameSaved.textContent = '';
    profileNewPassword.value = '';
    profileConfirmPassword.value = '';
    profilePasswordMsg.textContent = '';
    profilePasswordMsg.style.color = '';
    profileDeleteConfirm.classList.add('hidden');
    profileDeleteBtn.classList.remove('hidden');
    profileDeleteMsg.textContent = '';
  }
  function closeProfile() {
    hideAll();
    document.getElementById('titleScreen').classList.remove('hidden');
  }

  if (profileBtn) profileBtn.onclick = openProfile;
  if (closeProfileBtn) closeProfileBtn.onclick = closeProfile;

  if (profileNameInput) {
    let t = null;
    profileNameInput.addEventListener('input', (e) => {
      const v = e.target.value;
      if (t) clearTimeout(t);
      t = setTimeout(async () => {
        const { error } = await setProfileDisplayName(v);
        profileNameSaved.textContent = error ? (error.message || 'Save failed') : 'Saved ✓';
        profileNameSaved.style.color = error ? 'var(--red, #ff4d6d)' : 'var(--cyan)';
        refreshNameInput(); // keep title input in sync
      }, 400);
    });
  }

  if (profileUpdatePasswordBtn) {
    profileUpdatePasswordBtn.onclick = async () => {
      const np = profileNewPassword.value;
      const cp = profileConfirmPassword.value;
      if (np.length < 6) {
        profilePasswordMsg.textContent = 'Password must be at least 6 characters';
        profilePasswordMsg.style.color = 'var(--red, #ff4d6d)';
        return;
      }
      if (np !== cp) {
        profilePasswordMsg.textContent = 'Passwords do not match';
        profilePasswordMsg.style.color = 'var(--red, #ff4d6d)';
        return;
      }
      profileUpdatePasswordBtn.disabled = true;
      profilePasswordMsg.textContent = 'Updating...';
      profilePasswordMsg.style.color = '';
      const { error } = await updatePassword(np);
      profileUpdatePasswordBtn.disabled = false;
      if (error) {
        profilePasswordMsg.textContent = error.message || 'Update failed';
        profilePasswordMsg.style.color = 'var(--red, #ff4d6d)';
      } else {
        profilePasswordMsg.textContent = 'Password updated ✓';
        profilePasswordMsg.style.color = 'var(--cyan)';
        profileNewPassword.value = '';
        profileConfirmPassword.value = '';
      }
    };
  }

  if (profileSignOutBtn) {
    profileSignOutBtn.onclick = async () => {
      profileSignOutBtn.disabled = true;
      await signOut();
      profileSignOutBtn.disabled = false;
      closeProfile();
    };
  }

  // Account deletion (required by the App Store for apps with sign-up).
  // Two steps: Delete Account reveals the warning, Delete Forever commits.
  if (profileDeleteBtn) {
    profileDeleteBtn.onclick = () => {
      profileDeleteBtn.classList.add('hidden');
      profileDeleteConfirm.classList.remove('hidden');
      profileDeleteCancelBtn.focus();
    };
    profileDeleteCancelBtn.onclick = () => {
      profileDeleteConfirm.classList.add('hidden');
      profileDeleteBtn.classList.remove('hidden');
      profileDeleteMsg.textContent = '';
      profileDeleteBtn.focus();
    };
    profileDeleteConfirmBtn.onclick = async () => {
      profileDeleteConfirmBtn.disabled = true;
      profileDeleteCancelBtn.disabled = true;
      profileDeleteMsg.textContent = 'Deleting...';
      profileDeleteMsg.style.color = '';
      const { error } = await deleteAccount();
      profileDeleteConfirmBtn.disabled = false;
      profileDeleteCancelBtn.disabled = false;
      if (error) {
        profileDeleteMsg.textContent = error.message || 'Delete failed';
        profileDeleteMsg.style.color = 'var(--red, #ff4d6d)';
        return;
      }
      closeProfile();
      toast('Account deleted');
    };
  }

  // ----------------------------------------------------------
  // PASSWORD RECOVERY FLOW (arrived via reset email link)
  // ----------------------------------------------------------
  const recoveryScreen = document.getElementById('recoveryScreen');
  const recoveryNewPassword = document.getElementById('recoveryNewPassword');
  const recoveryConfirmPassword = document.getElementById('recoveryConfirmPassword');
  const recoveryMessage = document.getElementById('recoveryMessage');
  const recoverySaveBtn = document.getElementById('recoverySaveBtn');

  onRecoveryMode((active) => {
    if (!recoveryScreen) return;
    if (active) {
      hideAll();
      recoveryScreen.classList.remove('hidden');
      recoveryMessage.textContent = '';
      recoveryNewPassword.value = '';
      recoveryConfirmPassword.value = '';
      setTimeout(() => recoveryNewPassword?.focus(), 50);
    }
  });

  if (recoverySaveBtn) {
    recoverySaveBtn.onclick = async () => {
      const np = recoveryNewPassword.value;
      const cp = recoveryConfirmPassword.value;
      if (np.length < 6) {
        recoveryMessage.textContent = 'Password must be at least 6 characters';
        recoveryMessage.style.color = 'var(--red, #ff4d6d)';
        return;
      }
      if (np !== cp) {
        recoveryMessage.textContent = 'Passwords do not match';
        recoveryMessage.style.color = 'var(--red, #ff4d6d)';
        return;
      }
      recoverySaveBtn.disabled = true;
      recoveryMessage.textContent = 'Saving...';
      recoveryMessage.style.color = '';
      const { error } = await updatePassword(np);
      recoverySaveBtn.disabled = false;
      if (error) {
        recoveryMessage.textContent = error.message || 'Save failed';
        recoveryMessage.style.color = 'var(--red, #ff4d6d)';
      } else {
        recoveryMessage.textContent = 'Password saved. You are signed in.';
        recoveryMessage.style.color = 'var(--cyan)';
        setTimeout(() => {
          hideAll();
          document.getElementById('titleScreen').classList.remove('hidden');
        }, 800);
      }
    };
  }

  // ----------------------------------------------------------
  // FRIENDS UI WIRING
  // ----------------------------------------------------------
  const friendsScreen = document.getElementById('friendsScreen');
  const friendsAuthGate = document.getElementById('friendsAuthGate');
  const friendsBody = document.getElementById('friendsBody');
  const friendSearchInput = document.getElementById('friendSearchInput');
  const friendSearchBtn = document.getElementById('friendSearchBtn');
  const friendSearchResults = document.getElementById('friendSearchResults');
  const friendsListsEl = document.getElementById('friendsLists');
  const friendsBtn = document.getElementById('friendsBtn');
  const closeFriendsBtn = document.getElementById('closeFriendsBtn');

  function renderFriendsLists({ incoming, outgoing, friends }) {
    if (!friendsListsEl) return;
    if (incoming.length === 0 && outgoing.length === 0 && friends.length === 0) {
      friendsListsEl.innerHTML = '<div class="dim" style="text-align: center; padding: 30px 0;">No friends or pending requests yet. Search above to find pilots.</div>';
      return;
    }
    const btn = (label, id, kind) => `<button class="btn secondary" style="padding: 2px 8px; font-size: 10px;${kind === 'danger' ? ' color: var(--red, #ff4d6d); border-color: var(--red, #ff4d6d);' : ''}" data-fr-action="${id}">${label}</button>`;
    const row = (name, actions) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">
        <span style="color: var(--cyan);">${escapeHtml(name)}</span>
        <span style="display: flex; gap: 4px;">${actions}</span>
      </div>`;
    const section = (title, items, renderItem) => items.length === 0 ? '' : `
      <div style="margin-top: 14px;">
        <div class="dim" style="font-size: 11px; letter-spacing: 1px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08);">${title} (${items.length})</div>
        ${items.map(renderItem).join('')}
      </div>`;
    friendsListsEl.innerHTML = [
      section('INCOMING REQUESTS', incoming, f => row(f.displayName, btn('Accept', `accept:${f.id}`) + btn('Decline', `remove:${f.id}`, 'danger'))),
      section('FRIENDS', friends, f => row(f.displayName, btn('Unfriend', `remove:${f.id}`, 'danger'))),
      section('SENT (PENDING)', outgoing, f => row(f.displayName, btn('Cancel', `remove:${f.id}`, 'danger')))
    ].join('');
  }

  async function refreshFriends() {
    if (!friendsListsEl) return;
    if (!isSignedIn()) {
      friendsAuthGate?.classList.remove('hidden');
      friendsBody?.classList.add('hidden');
      return;
    }
    friendsAuthGate?.classList.add('hidden');
    friendsBody?.classList.remove('hidden');
    friendsListsEl.innerHTML = '<div class="dim" style="text-align: center; padding: 20px 0;">Loading...</div>';
    const data = await fetchMyFriendships();
    renderFriendsLists(data);
  }

  async function runFriendSearch() {
    if (!friendSearchResults || !friendSearchInput) return;
    const q = friendSearchInput.value;
    if (q.trim().length < 2) {
      friendSearchResults.innerHTML = '<div class="dim" style="padding: 6px 0;">Type at least 2 characters.</div>';
      return;
    }
    friendSearchResults.innerHTML = '<div class="dim" style="padding: 6px 0;">Searching...</div>';
    const results = await searchUsers(q);
    if (results.length === 0) {
      friendSearchResults.innerHTML = '<div class="dim" style="padding: 6px 0;">No pilots found.</div>';
      return;
    }
    friendSearchResults.innerHTML = results.map(p => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.05);">
        <span style="color: var(--cyan);">${escapeHtml(p.display_name || '(unnamed)')}</span>
        <button class="btn secondary" style="padding: 2px 8px; font-size: 10px;" data-fr-action="request:${p.id}">Send Request</button>
      </div>`).join('');
  }

  if (friendsBtn) {
    friendsBtn.onclick = () => {
      if (!isLeaderboardEnabled()) return;
      hideAll();
      friendsScreen.classList.remove('hidden');
      if (friendSearchInput) friendSearchInput.value = '';
      if (friendSearchResults) friendSearchResults.innerHTML = '';
      refreshFriends();
    };
  }
  if (closeFriendsBtn) {
    closeFriendsBtn.onclick = () => {
      hideAll();
      document.getElementById('titleScreen').classList.remove('hidden');
    };
  }
  if (friendSearchBtn) friendSearchBtn.onclick = runFriendSearch;
  if (friendSearchInput) {
    friendSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runFriendSearch();
    });
  }

  // Event delegation for Accept / Decline / Unfriend / Cancel / Send Request buttons
  if (friendsScreen) {
    friendsScreen.addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const action = t.getAttribute('data-fr-action');
      if (!action) return;
      const [op, id] = action.split(':');
      t.disabled = true;
      if (op === 'accept') {
        await acceptFriendRequest(Number(id));
        await refreshFriends();
      } else if (op === 'remove') {
        await removeFriendship(Number(id));
        await refreshFriends();
      } else if (op === 'request') {
        const { error } = await sendFriendRequest(id);
        if (error) {
          t.textContent = error.message?.includes('duplicate') ? 'Already exists' : 'Failed';
        } else {
          t.textContent = 'Sent ✓';
        }
        await refreshFriends();
      }
    });
  }

  // Kick off auth (loads existing session, parses magic-link redirect hash)
  initAuth();
})();
