import './styles.css';
import {
  submitScore,
  fetchLeaderboard,
  fetchMyBest,
  fetchGlobalStats,
  getDisplayName,
  setDisplayName,
  isLeaderboardEnabled
} from './leaderboard.js';
import {
  initAuth,
  onAuthChange,
  sendMagicLink,
  signOut,
  setProfileDisplayName,
  isSignedIn,
  getProfile
} from './auth.js';
import {
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  fetchMyFriendships,
  fetchFriendsLeaderboard
} from './friends.js';


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
    return merged;
  } catch (e) { return JSON.parse(JSON.stringify(META_DEFAULTS)); }
}
function saveMeta() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch (e) {}
}

function nodeCost(node) {
  return Math.ceil(node.costBase * Math.pow(node.costMul, node.level));
}

// ============================================================
// RUN STATE - ENDLESS PROCEDURAL WAVES
// ============================================================
// Wave structure:
//   - Every wave: 3-card upgrade pick on clear
//   - Every 5th wave (5, 10, 15...): MINI-BOSS + shop screen
//   - Every 25th wave (25, 50, 75...): WARDEN mega-boss (escalating)
//   - New enemy types unlock at waves 10, 15, 20, 25
// Sectors (cosmetic theme): 1 per 10 waves
const SECTORS = [
  { name: 'THE OUTER GRID',    accent: '#00f0ff', secondary: '#ff2d95' },
  { name: 'CRIMSON LATTICE',   accent: '#ff2d95', secondary: '#ffea00' },
  { name: 'VOID SPIRE',        accent: '#b847ff', secondary: '#00f0ff' },
  { name: 'PULSAR CORE',       accent: '#ffea00', secondary: '#ff2d95' },
  { name: 'HEATWAVE',          accent: '#ff6b35', secondary: '#b847ff' },
  { name: 'CRYOGRID',          accent: '#5ac8fa', secondary: '#00f0ff' }
];

const WAVE_NAMES_REGULAR = ['SWARM', 'LATTICE', 'FRACTURE', 'CASCADE', 'BREACH', 'TEMPEST', 'RIPTIDE', 'ECLIPSE', 'VORTEX', 'SURGE'];
const MINI_BOSSES = ['obelisk', 'hive', 'sentinel', 'prism'];

function getWaveInfo(waveNum) {
  // waveNum is 1-indexed for display purposes
  const isMegaBoss = waveNum % 25 === 0;
  const isMiniBoss = waveNum % 5 === 0 && !isMegaBoss;
  const sectorIndex = Math.min(SECTORS.length - 1, Math.floor((waveNum - 1) / 10));
  const sector = SECTORS[sectorIndex];
  const loop = Math.floor((waveNum - 1) / 25); // 0, 1, 2...

  // Difficulty multiplier: grows smoothly
  // Wave 1 = 1.0, wave 10 = 2.0, wave 25 = 4.0, wave 50 = 7.0
  // Difficulty multiplier: slower ramp than before so early waves feel beatable
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
    // Rotate mini-boss pool, tougher on later loops
    const mbIdx = Math.floor((waveNum / 5 - 1)) % MINI_BOSSES.length;
    const bossType = MINI_BOSSES[mbIdx];
    const miniLoop = Math.floor((waveNum / 5 - 1) / MINI_BOSSES.length);
    return {
      type: 'mini', waveNum, sector, loop, diffMul,
      name: bossType.toUpperCase() + (miniLoop > 0 ? ` +${miniLoop}` : ''),
      bossType, bossScale: 1 + miniLoop * 0.35
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

  // Enemy count scales but doesn't spiral
  // Enemy count: gentler early growth so wave 3 isn't 12 enemies
  // Wave 1: 7, wave 3: 9, wave 5: 11, wave 10: 16, capped at 34
  const baseCount = 6 + Math.floor(waveNum * 0.9);
  const enemyCount = Math.min(baseCount, 34);
  const name = WAVE_NAMES_REGULAR[(waveNum - 1) % WAVE_NAMES_REGULAR.length];
  return {
    type: 'regular', waveNum, sector, loop, diffMul,
    name, enemyCount,
    types: unlockedTypes
  };
}

let run = null;

function newRun() {
  const startingCores = meta.nodes.startBank.level * 3;
  startBGM();
  run = {
    active: true,
    paused: false,
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
  meta.totalRuns++;
  saveMeta();
  updateHUD();
  startWave(1);
  hideAll();
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('controlsPanel').classList.remove('hidden');

  // Starter augment meta perk (one per level)
  const starterCount = meta.nodes.startCore.level;
  if (starterCount > 0) {
    const commons = UPGRADES.filter(u => u.rarity === 'common');
    for (let i = 0; i < starterCount; i++) {
      const choice = commons[Math.floor(Math.random() * commons.length)];
      applyUpgrade(choice);
    }
    toast(`Starter: ${starterCount} augment${starterCount > 1 ? 's' : ''}`);
  }
  if (startingCores > 0) toast(`Requisition: +${startingCores} cores`);
}

// ============================================================
// MAPS / OBSTACLE LAYOUTS
// Each template returns an array of rectangular obstacles {x, y, w, h}
// sized proportionally to current canvas dimensions.
// ============================================================
const MAP_TEMPLATES = [
  // OPEN: no obstacles, used for bosses and occasional regular waves
  {
    name: 'OPEN',
    generate: () => []
  },
  // FOUR PILLARS: four rectangular pillars in a diamond arrangement
  {
    name: 'PILLARS',
    generate: () => {
      const cx = W / 2, cy = H / 2;
      const spread = Math.min(W, H) * 0.28;
      const pw = Math.min(60, W * 0.08);
      const ph = Math.min(100, H * 0.14);
      return [
        { x: cx - spread - pw / 2, y: cy - ph / 2, w: pw, h: ph },
        { x: cx + spread - pw / 2, y: cy - ph / 2, w: pw, h: ph },
        { x: cx - pw / 2, y: cy - spread - ph / 2, w: pw, h: ph },
        { x: cx - pw / 2, y: cy + spread - ph / 2, w: pw, h: ph }
      ];
    }
  },
  // CORRIDOR: two horizontal walls creating a channel through the middle
  {
    name: 'CORRIDOR',
    generate: () => {
      const thick = Math.min(40, H * 0.05);
      const gap = Math.min(180, H * 0.28);
      const topY = H / 2 - gap / 2 - thick;
      const botY = H / 2 + gap / 2;
      const margin = W * 0.12;
      const wallLen = W * 0.32;
      return [
        { x: margin, y: topY, w: wallLen, h: thick },
        { x: W - margin - wallLen, y: topY, w: wallLen, h: thick },
        { x: margin, y: botY, w: wallLen, h: thick },
        { x: W - margin - wallLen, y: botY, w: wallLen, h: thick }
      ];
    }
  },
  // CROSS: plus-sign of walls with openings on each side
  {
    name: 'CROSS',
    generate: () => {
      const cx = W / 2, cy = H / 2;
      const thick = Math.min(36, W * 0.045);
      const armLen = Math.min(W, H) * 0.18;
      return [
        { x: cx - thick / 2, y: cy - armLen - thick * 1.2, w: thick, h: armLen },
        { x: cx - thick / 2, y: cy + thick * 1.2, w: thick, h: armLen },
        { x: cx - armLen - thick * 1.2, y: cy - thick / 2, w: armLen, h: thick },
        { x: cx + thick * 1.2, y: cy - thick / 2, w: armLen, h: thick }
      ];
    }
  },
  // DIAGONALS: two blocks in opposing corners creating a zigzag feel
  {
    name: 'DIAGONALS',
    generate: () => {
      const bw = Math.min(160, W * 0.2);
      const bh = Math.min(60, H * 0.08);
      const margin = Math.min(W, H) * 0.18;
      return [
        { x: margin, y: H * 0.28, w: bw, h: bh },
        { x: W - margin - bw, y: H * 0.28, w: bw, h: bh },
        { x: W / 2 - bw / 2, y: H * 0.55, w: bw, h: bh },
        { x: margin * 1.5, y: H * 0.75, w: bw * 0.7, h: bh },
        { x: W - margin * 1.5 - bw * 0.7, y: H * 0.75, w: bw * 0.7, h: bh }
      ];
    }
  },
  // FORTRESS: U-shape in the center, open on one side
  {
    name: 'FORTRESS',
    generate: () => {
      const cx = W / 2, cy = H / 2;
      const size = Math.min(W, H) * 0.22;
      const thick = Math.min(30, W * 0.04);
      // U open on top
      return [
        { x: cx - size, y: cy - size * 0.3, w: thick, h: size * 1.2 }, // left wall
        { x: cx + size - thick, y: cy - size * 0.3, w: thick, h: size * 1.2 }, // right wall
        { x: cx - size, y: cy + size * 0.9 - thick, w: size * 2, h: thick } // bottom
      ];
    }
  },
  // SCATTER: 6 random small blocks
  {
    name: 'SCATTER',
    generate: (seed) => {
      // Use waveNum as seed for consistency within a run
      let s = seed || 1;
      const rng = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      const blocks = [];
      const margin = Math.min(W, H) * 0.14;
      for (let i = 0; i < 6; i++) {
        const bw = 40 + rng() * 60;
        const bh = 40 + rng() * 60;
        const x = margin + rng() * (W - margin * 2 - bw);
        const y = margin + rng() * (H - margin * 2 - bh);
        // Avoid spawning too close to center (player spawns there)
        const cx = x + bw / 2, cy = y + bh / 2;
        if (Math.hypot(cx - W / 2, cy - H / 2) < 100) continue;
        blocks.push({ x, y, w: bw, h: bh });
      }
      return blocks;
    }
  },
  // GAUNTLET: two vertical columns of blocks creating lanes
  {
    name: 'GAUNTLET',
    generate: () => {
      const bw = Math.min(50, W * 0.06);
      const bh = Math.min(70, H * 0.1);
      const col1x = W * 0.3;
      const col2x = W * 0.7 - bw;
      const rows = 3;
      const gap = (H - rows * bh - H * 0.2) / (rows - 1);
      const blocks = [];
      for (let r = 0; r < rows; r++) {
        const y = H * 0.1 + r * (bh + gap);
        blocks.push({ x: col1x, y, w: bw, h: bh });
        blocks.push({ x: col2x, y: y + bh * 0.5, w: bw, h: bh });
      }
      return blocks;
    }
  },
  // RING: a hollow rectangular ring in the center
  {
    name: 'ARENA RING',
    generate: () => {
      const cx = W / 2, cy = H / 2;
      const outerW = Math.min(W, H) * 0.45;
      const outerH = Math.min(W, H) * 0.35;
      const thick = Math.min(26, W * 0.035);
      // Four walls of a hollow rect
      return [
        { x: cx - outerW / 2, y: cy - outerH / 2, w: outerW * 0.35, h: thick },
        { x: cx + outerW * 0.15, y: cy - outerH / 2, w: outerW * 0.35, h: thick },
        { x: cx - outerW / 2, y: cy + outerH / 2 - thick, w: outerW * 0.35, h: thick },
        { x: cx + outerW * 0.15, y: cy + outerH / 2 - thick, w: outerW * 0.35, h: thick },
        { x: cx - outerW / 2, y: cy - outerH / 2, w: thick, h: outerH * 0.35 },
        { x: cx - outerW / 2, y: cy + outerH * 0.15, w: thick, h: outerH * 0.35 },
        { x: cx + outerW / 2 - thick, y: cy - outerH / 2, w: thick, h: outerH * 0.35 },
        { x: cx + outerW / 2 - thick, y: cy + outerH * 0.15, w: thick, h: outerH * 0.35 }
      ];
    }
  }
];

function generateObstaclesForWave(waveNum, waveInfo) {
  // Boss waves: always open, player needs room
  if (waveInfo && (waveInfo.type === 'mega' || waveInfo.type === 'mini')) {
    return [];
  }
  // Wave 1: always open so new players get comfortable
  if (waveNum === 1) return [];
  // Wave 2: occasionally still open
  if (waveNum === 2 && Math.random() < 0.5) return [];
  // Pick template based on wave number (rotates through pool, skipping OPEN for non-boss waves)
  const nonOpenTemplates = MAP_TEMPLATES.filter(t => t.name !== 'OPEN');
  const idx = (waveNum - 1) % nonOpenTemplates.length;
  const template = nonOpenTemplates[idx];
  return template.generate(waveNum * 37 + 1);
}

function startWave(waveNum) {
  run.waveNum = waveNum;
  run.waveCleared = false;
  const info = getWaveInfo(waveNum);
  run.currentWaveInfo = info;

  // Generate obstacles for this wave
  run.obstacles = generateObstaclesForWave(waveNum, info);

  // If player is inside an obstacle (can happen on resize or wave change),
  // nudge them to the nearest open space
  if (run.obstacles.length > 0) {
    const p = run.player;
    if (isInsideObstacle(p.x, p.y, p.r + 4)) {
      // Try canvas center first
      if (!isInsideObstacle(W / 2, H / 2, p.r + 4)) {
        p.x = W / 2; p.y = H / 2;
      } else {
        // Scan outward from center for open space
        let placed = false;
        for (let rad = 60; rad < Math.max(W, H) && !placed; rad += 40) {
          for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 6) {
            const tx = W / 2 + Math.cos(ang) * rad;
            const ty = H / 2 + Math.sin(ang) * rad;
            if (tx > p.r && tx < W - p.r && ty > p.r && ty < H - p.r && !isInsideObstacle(tx, ty, p.r + 4)) {
              p.x = tx; p.y = ty;
              placed = true;
              break;
            }
          }
        }
      }
    }
  }


  run.spawnQueue = [];
  if (info.type === 'mega' || info.type === 'mini') {
    playSound('bosswarn');
    run.spawnQueue.push({ type: info.bossType, delay: 0.6, scale: info.bossScale, diff: info.diffMul });
  } else {
    for (let i = 0; i < info.enemyCount; i++) {
      const type = info.types[Math.floor(Math.random() * info.types.length)];
      // Spawn cadence tightens with difficulty
      // Spawn cadence tightens with difficulty but never too fast
      const baseDelay = Math.max(0.18, 0.65 - info.diffMul * 0.02);
      const jitter = 0.4 - Math.min(0.22, info.diffMul * 0.01);
      run.spawnQueue.push({
        type,
        delay: baseDelay + Math.random() * jitter,
        scale: info.diffMul,
        diff: info.diffMul
      });
    }
  }
  run.spawnTimer = 0;

  // Announce
  const ann = document.getElementById('waveAnnouncer');
  document.getElementById('waveAnnounceNum').textContent = waveNum.toString().padStart(2, '0');
  let label = 'WAVE';
  if (info.type === 'mega') label = 'MEGA BOSS';
  else if (info.type === 'mini') label = 'MINI BOSS';
  const labelEl = document.getElementById('waveAnnouncer').querySelector('.wave-label');
  if (labelEl) labelEl.textContent = label;
  document.getElementById('waveAnnounceName').textContent = info.name;
  ann.classList.remove('show');
  void ann.offsetWidth;
  ann.classList.add('show');
  setTimeout(() => ann.classList.remove('show'), 2000);

  // Sector transition toast at each 10-wave mark
  if (waveNum === 1 || (waveNum - 1) % 10 === 0) {
    toast(`Sector: ${info.sector.name}`);
  }
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
  warden:   { hp: 70, speed: 60,  r: 42, color: '#ff3860', score: 750, ai: 'warden',  fireRate: 0.5 }
};

function spawnEnemy(type, scale = 1, diffMul = 1) {
  const def = ENEMY_DEFS[type];
  if (!def) return;
  // Spawn at random edge
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * W; y = -30; }
  else if (side === 1) { x = W + 30; y = Math.random() * H; }
  else if (side === 2) { x = Math.random() * W; y = H + 30; }
  else { x = -30; y = Math.random() * H; }
  // Bosses spawn top center
  if (def.ai === 'warden' || def.ai === 'obelisk' || def.ai === 'hive' ||
      def.ai === 'sentinel' || def.ai === 'prism') {
    x = W / 2; y = -80;
  }

  // HP scales with both wave scale AND diffMul (for regular enemies only)
  const hpScale = def.ai.includes('warden') || ['obelisk','hive','sentinel','prism'].includes(def.ai)
    ? scale
    : scale;
  // Speed scales more gently
  const speedScale = 1 + (diffMul - 1) * 0.18;

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

  run.enemies.push({
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
    fireCD: def.fireRate ? Math.random() * def.fireRate : 0,
    fireRate: def.fireRate ? def.fireRate / (1 + (diffMul - 1) * 0.15) : 0,
    angle: 0,
    t: 0,
    phase: 0,
    // Behavioral state
    splitLeft: type === 'splitter' ? 2 : 0,  // splits into 2 mini-grunts on death
    phantomCycle: 0,                         // phantoms fade in/out
    lancerCharge: 0
  });
}

// ============================================================
// UPGRADE POOL (roguelike drops)
// ============================================================
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
  { id: 'spread2', name: 'Triple Fan',       rarity: 'rare',   icon: '❋', desc: '+2 projectiles, wider spread', apply: () => { run.weapons.projectileCount += 2; run.weapons.spread += 0.2; } },
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
  { id: 'homing',  name: 'Smart Rounds',     rarity: 'legendary', icon: '◉', desc: 'Bullets home toward enemies', apply: () => run.weapons.homing = Math.max(run.weapons.homing, 1) },
  { id: 'explode', name: 'Payload',          rarity: 'legendary', icon: '✺', desc: 'Bullets explode on impact', apply: () => run.weapons.explosive = 1 },
  { id: 'shock',   name: 'Deathwave',        rarity: 'legendary', icon: '⬢', desc: 'Kills release damaging shockwaves', apply: () => run.passives.onKillShockwave = 1 },
  { id: 'slowmo',  name: 'Temporal Shield',  rarity: 'legendary', icon: '◐', desc: 'Taking damage triggers brief slow-mo', apply: () => run.passives.timeSlow = 1 },
  { id: 'ricochet',name: 'Bouncer',          rarity: 'legendary', icon: '⟲', desc: 'Bullets ricochet up to 2 times', apply: () => run.weapons.ricochet = 2 },
  // LEGENDARY NEW: drone swarm and beam
  { id: 'drone2',  name: 'Drone Swarm',      rarity: 'legendary', icon: '✨', desc: 'Adds 2 more drones', apply: () => { spawnDrone(); spawnDrone(); } },
  { id: 'beam',    name: 'Beam Cannon',      rarity: 'legendary', icon: '━', desc: 'Piercing beam replaces pulse', apply: () => { run.beamMode = true; run.weapons.pierce = Math.max(run.weapons.pierce, 99); } }
];

function applyUpgrade(u) {
  u.apply();
  run.upgrades.push(u.id);
}

function offerUpgrades() {
  // 3 choices: weighted by rarity. Wave number + luck bonus controls rarity chances.
  const waveNum = run.waveNum;
  const luck = run.passives.luckBonus;
  const rolls = [];
  for (let i = 0; i < 3; i++) {
    const r = Math.random();
    let rarity;
    // Rarity gates improve with waves
    const legendaryChance = Math.min(0.35, 0.05 + Math.max(0, waveNum - 5) * 0.02 + luck * 0.5);
    const rareChance = Math.min(0.6, 0.2 + Math.max(0, waveNum - 2) * 0.04 + luck);
    if (r < legendaryChance) rarity = 'legendary';
    else if (r < legendaryChance + rareChance) rarity = 'rare';
    else rarity = 'common';
    const pool = UPGRADES.filter(u => u.rarity === rarity && !rolls.find(x => x.id === u.id));
    if (pool.length === 0) {
      const fallback = UPGRADES.filter(u => !rolls.find(x => x.id === u.id));
      rolls.push(fallback[Math.floor(Math.random() * fallback.length)]);
    } else {
      rolls.push(pool[Math.floor(Math.random() * pool.length)]);
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
  const shuffled = [...SHOP_ITEMS].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, 4);
  // Scale costs with wave progression (more expensive on later bosses)
  const waveMul = 1 + Math.floor(run.waveNum / 5 - 1) * 0.15;

  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  document.getElementById('shopSubtitle').textContent = `Wave ${run.waveNum} boss cleared · Spend cores`;
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
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Gamepad state
let gamepadIndex = null;
const GAMEPAD_DEADZONE = 0.18;
let lastDashGamepad = false;
let lastPauseGamepad = false;
let lastTurretGamepad = false;
let lastMedicGamepad = false;
let lastSnakeGamepad = false;

function setInputMode(mode) {
  if (input.mode === mode) return;
  input.mode = mode;
  const ind = document.getElementById('inputIndicator');
  ind.classList.remove('gamepad', 'touch');
  if (mode === 'gamepad') { ind.textContent = 'GAMEPAD'; ind.classList.add('gamepad'); }
  else if (mode === 'touch') { ind.textContent = 'TOUCH'; ind.classList.add('touch'); }
  else { ind.textContent = 'KEYBOARD+MOUSE'; }
  // Rebuild controls panel for this mode
  buildControlsPanel(mode);
  // Show/hide touch UI
  document.getElementById('touchUI').classList.toggle('visible', mode === 'touch');
  document.body.classList.toggle('touch-mode', mode === 'touch');
}

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
    rows.push(['<kbd>RIGHT</kbd>', 'Aim + Fire', '']);
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
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touch.leftId) {
      touch.leftX = t.clientX; touch.leftY = t.clientY;
      updateStickVisual('left', true, touch.leftStartX, touch.leftStartY, t.clientX, t.clientY);
    } else if (t.identifier === touch.rightId) {
      touch.rightX = t.clientX; touch.rightY = t.clientY;
      updateStickVisual('right', true, touch.rightStartX, touch.rightStartY, t.clientX, t.clientY);
    }
  }
}
function handleTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touch.leftId) {
      touch.leftId = null;
      updateStickVisual('left', false);
    } else if (t.identifier === touch.rightId) {
      touch.rightId = null;
      updateStickVisual('right', false);
    }
  }
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
  const anyBtnActive = rt > 0.1 || lt > 0.1 || aBtn || bBtn || xBtn || yBtn || lbBtn || startBtn;

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
    // Left stick -> move
    if (touch.leftId !== null) {
      const dx = touch.leftX - touch.leftStartX;
      const dy = touch.leftY - touch.leftStartY;
      const mag = Math.hypot(dx, dy);
      const clamped = Math.min(mag, STICK_RADIUS) / STICK_RADIUS;
      if (mag > 8) {
        input.moveX = (dx / mag) * clamped;
        input.moveY = (dy / mag) * clamped;
      } else {
        input.moveX = 0; input.moveY = 0;
      }
    } else {
      input.moveX = 0; input.moveY = 0;
    }
    // Right stick -> aim + fire
    if (touch.rightId !== null) {
      const dx = touch.rightX - touch.rightStartX;
      const dy = touch.rightY - touch.rightStartY;
      const mag = Math.hypot(dx, dy);
      if (mag > 10) {
        input.aimAngle = Math.atan2(dy, dx);
        input.aimActive = true;
        input.firing = true;
      } else {
        input.firing = false;
      }
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
  p.x = Math.max(p.r, Math.min(W - p.r, resolved.x));
  p.y = Math.max(p.r, Math.min(H - p.r, resolved.y));
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
    update(dt * run.slowmo);
    // Slowmo recovery
    if (run.slowmo < 1) run.slowmo = Math.min(1, run.slowmo + dt * 0.8);
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt) {
  run.timeElapsed += dt;
  updatePlayer(dt);
  updateSpawning(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateEnemyProjectiles(dt);
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
  checkWaveClear();
  if (run.screenShake > 0) run.screenShake = Math.max(0, run.screenShake - dt * 30);
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
  // Clamp to canvas edges
  p.x = Math.max(p.r, Math.min(W - p.r, p.x));
  p.y = Math.max(p.r, Math.min(H - p.r, p.y));
  p.angle = input.aimAngle;

  // Compute movement speed for trail intensity
  const dx = p.x - p.lastX, dy = p.y - p.lastY;
  const moveSpeed = Math.hypot(dx, dy);

  // Bank: how much the ship is moving "sideways" relative to its aim direction
  // Cross product of (move dir) x (aim dir) gives signed lateral amount
  if (moveSpeed > 0.5) {
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

  if (p.iframes > 0) p.iframes -= dt;
  if (p.invulnDash > 0) p.invulnDash -= dt;
  if (p.dashCD > 0) p.dashCD -= dt;
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
    const isCrit = Math.random() < w.crit;
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
function spawnDrone() {
  run.drones.push({
    orbitAngle: Math.random() * Math.PI * 2,
    orbitRadius: 44,
    fireCD: 0.15 + Math.random() * 0.3,
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
      if (circleHit(s.x, s.y, 7, e.x, e.y, e.r)) {
        e.hp -= s.damage;
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
  if (Math.random() > base) return;
  // Weighted pick from pool
  const totalWeight = POWERUPS.reduce((s, p) => s + p.chance, 0);
  let roll = Math.random() * totalWeight;
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
    e.hp -= 100;
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

function updateSpawning(dt) {
  run.spawnTimer += dt;
  while (run.spawnQueue.length > 0 && run.spawnTimer >= run.spawnQueue[0].delay) {
    const q = run.spawnQueue.shift();
    run.spawnTimer -= q.delay;
    spawnEnemy(q.type, q.scale || 1, q.diff || 1);
  }
}

function updateEnemies(dt) {
  const p = run.player;
  for (let i = run.enemies.length - 1; i >= 0; i--) {
    const e = run.enemies[i];
    e.t += dt;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const spd = e.baseSpeed;

    if (e.ai === 'chase') {
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
          spawnEnemy('grunt', 0.5, adjInfo ? adjInfo.diffMul * 0.6 : 1);
          // Move last spawned to near the hive
          const last = run.enemies[run.enemies.length - 1];
          last.x = e.x + (Math.random() - 0.5) * 40;
          last.y = e.y + (Math.random() - 0.5) * 40;
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
    const isBoss = ['warden', 'obelisk', 'hive', 'sentinel', 'prism'].includes(e.type);
    if (isBoss || e.intangible) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    } else {
      const tx = e.x + e.vx * dt;
      const ty = e.y + e.vy * dt;
      const res = resolveCircleMove(e.x, e.y, tx, ty, e.r);
      e.x = res.x;
      e.y = res.y;
    }

    // Collide with player (phantoms in intangible phase don't collide)
    if (p.iframes <= 0 && !e.intangible && circleHit(e.x, e.y, e.r, p.x, p.y, p.r)) {
      damagePlayer(1);
    }
  }
}

function enemyShoot(x, y, angle, speed, color) {
  run.enemyProjectiles.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 5,
    life: 6,
    color,
    grazed: false
  });
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

    // Check if the bullet's travel segment hit an obstacle
    if (run.obstacles && run.obstacles.length > 0 && segmentHitsObstacle(prevX, prevY, pr.x, pr.y)) {
      // Ricochet off the obstacle if available, else destroy
      if (pr.ricochet > 0) {
        // Simple ricochet: flip whichever axis is the larger velocity component
        if (Math.abs(pr.vx) > Math.abs(pr.vy)) pr.vx *= -1;
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
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (pr.hitIds.has(j)) continue;
      if (circleHit(pr.x, pr.y, pr.r, e.x, e.y, e.r)) {
        e.hp -= pr.damage;
        pr.hitIds.add(j);
        spawnHitParticles(pr.x, pr.y, pr.crit ? '#ffea00' : e.color);
        if (pr.explosive) {
          // Small AOE
          for (const other of enemies) {
            if (other === e) continue;
            const d = Math.hypot(other.x - pr.x, other.y - pr.y);
            if (d < 60) {
              other.hp -= pr.damage * 0.5;
              if (other.hp <= 0) killEnemy(enemies.indexOf(other));
            }
          }
          spawnExplosion(pr.x, pr.y);
        }
        if (e.hp <= 0) {
          killEnemy(j);
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
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    // Obstacle collision: walls block enemy bullets (cover mechanic)
    if (run.obstacles && run.obstacles.length > 0 && segmentHitsObstacle(prevX, prevY, b.x, b.y)) {
      spawnHitParticles(b.x, b.y, b.color);
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Graze detection
    const gd = Math.hypot(b.x - p.x, b.y - p.y);
    if (!b.grazed && gd < 25 && gd > p.r + b.r) {
      b.grazed = true;
      // graze: add to combo without breaking
      addCombo(run.passives.grazeBonus);
      spawnFloat(b.x, b.y, 'GRAZE', '#00f0ff', 12);
    }

    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
      run.enemyProjectiles.splice(i, 1);
      continue;
    }

    if (p.iframes <= 0 && circleHit(b.x, b.y, b.r, p.x, p.y, p.r)) {
      damagePlayer(1);
      run.enemyProjectiles.splice(i, 1);
    }
  }
}

function damagePlayer(amt) {
  if (run.player.iframes > 0 || run.player.invulnDash > 0) return;
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
  if (!e) return;
  // Boss death sound
  const isBossKill = ['warden', 'obelisk', 'hive', 'sentinel', 'prism'].includes(e.type);
  if (isBossKill) playSound('explosion');
  run.enemies.splice(idx, 1);
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
      last.x = e.x + (Math.random() - 0.5) * 30;
      last.y = e.y + (Math.random() - 0.5) * 30;
      last.hp = last.maxHp * 0.5;
      last.maxHp = last.hp;
    }
  }

  // Drop cores - scales with enemy type
  let coreCount;
  if (['warden'].includes(e.type)) coreCount = 30 + Math.floor(Math.random() * 15);
  else if (['obelisk', 'hive', 'sentinel', 'prism'].includes(e.type)) coreCount = 12 + Math.floor(Math.random() * 8);
  else if (['bomber', 'lancer', 'splitter'].includes(e.type)) coreCount = 2 + (Math.random() < 0.3 ? 1 : 0);
  else coreCount = 1 + (Math.random() < 0.3 ? 1 : 0);

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
  else if (['obelisk', 'hive', 'sentinel', 'prism'].includes(e.type)) run.screenShake = Math.max(run.screenShake, 14);
  else run.screenShake = Math.max(run.screenShake, 4);

  if (run.passives.onKillShockwave) {
    for (const other of run.enemies) {
      const d = Math.hypot(other.x - e.x, other.y - e.y);
      if (d < 120) other.hp -= 1;
    }
    spawnShockwave(e.x, e.y, '#00f0ff');
  }

  // Random powerup drop (bosses have much higher chance)
  let dropMultiplier = 1;
  if (e.type === 'warden') dropMultiplier = 10;  // always drops from mega boss
  else if (['obelisk', 'hive', 'sentinel', 'prism'].includes(e.type)) dropMultiplier = 6;
  else if (['bomber', 'lancer', 'splitter'].includes(e.type)) dropMultiplier = 2;
  maybeDropPowerup(e.x, e.y, dropMultiplier);
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
      run.cores++;
      run.pickups.splice(i, 1);
      spawnFloat(pk.x, pk.y, '+1', '#ffea00', 10);
      if (run.passives.pickupHeal > 0 && run.cores % 5 === 0 && run.player.hp < run.player.maxHp) {
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
// Check if a circle (x, y, r) overlaps any obstacle
function isInsideObstacle(x, y, r) {
  if (!run || !run.obstacles) return false;
  for (const o of run.obstacles) {
    if (circleRectOverlap(x, y, r, o)) return true;
  }
  return false;
}

// Circle vs axis-aligned rect overlap test
function circleRectOverlap(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < cr * cr;
}

// Move a circle from (fromX, fromY) toward (toX, toY), stopping at obstacle edges.
// Returns the final position. Handles axis-separated sliding so you can slide along walls.
function resolveCircleMove(fromX, fromY, toX, toY, r) {
  if (!run || !run.obstacles || run.obstacles.length === 0) {
    return { x: toX, y: toY };
  }
  // Try X axis move first
  let nx = toX;
  let ny = fromY;
  for (const o of run.obstacles) {
    if (circleRectOverlap(nx, ny, r, o)) {
      // Blocked on X; revert
      nx = fromX;
      break;
    }
  }
  // Then try Y axis from the resolved X position
  let fx = nx;
  let fy = toY;
  for (const o of run.obstacles) {
    if (circleRectOverlap(fx, fy, r, o)) {
      fy = fromY;
      break;
    }
  }
  return { x: fx, y: fy };
}

// Check if a line segment from (x1,y1) to (x2,y2) hits any obstacle.
// Returns true if blocked (for bullet destruction).
function segmentHitsObstacle(x1, y1, x2, y2) {
  if (!run || !run.obstacles || run.obstacles.length === 0) return false;
  for (const o of run.obstacles) {
    if (segmentIntersectsRect(x1, y1, x2, y2, o)) return true;
  }
  return false;
}

function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  // Quick reject: is either endpoint inside?
  if (x1 >= rect.x && x1 <= rect.x + rect.w && y1 >= rect.y && y1 <= rect.y + rect.h) return true;
  if (x2 >= rect.x && x2 <= rect.x + rect.w && y2 >= rect.y && y2 <= rect.y + rect.h) return true;
  // Test segment against 4 edges of rect
  const rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
  if (segmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx + rw, ry + rh, rx, ry + rh)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx, ry)) return true;
  return false;
}

function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ============================================================
// RENDER
// ============================================================
function render() {
  // Clear with synthwave gradient (done by CSS but let's ensure fresh frame)
  ctx.fillStyle = 'rgba(10, 5, 20, 0.35)'; // motion blur trails
  ctx.fillRect(0, 0, W, H);

  if (!run) return;

  ctx.save();
  // Screen shake
  if (run.screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * run.screenShake,
      (Math.random() - 0.5) * run.screenShake
    );
  }

  // Grid floor
  drawGrid();

  // Obstacles (walls) - Tron-styled with glow
  if (run.obstacles && run.obstacles.length > 0) {
    for (const o of run.obstacles) {
      // Dark fill
      ctx.save();
      ctx.fillStyle = 'rgba(20, 10, 40, 0.85)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // Outer glow border
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      // Inner accent line (pink, offset)
      ctx.shadowColor = '#ff2d95';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(255, 45, 149, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
      // Corner accent dots
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#00f0ff';
      const d = 3;
      ctx.fillRect(o.x, o.y, d, d);
      ctx.fillRect(o.x + o.w - d, o.y, d, d);
      ctx.fillRect(o.x, o.y + o.h - d, d, d);
      ctx.fillRect(o.x + o.w - d, o.y + o.h - d, d, d);
      ctx.restore();
    }
  }

  // Pickups
  for (const pk of run.pickups) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffea00';
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Enemy projectiles
  for (const b of run.enemyProjectiles) {
    ctx.save();
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Enemies
  for (const e of run.enemies) {
    drawEnemy(e);
  }

  // Player projectiles
  for (const pr of run.projectiles) {
    ctx.save();
    const color = pr.crit ? '#ffea00' : '#ff2d95';
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

  // Player
  drawPlayer();

  // Drones and turrets (after player, so they render in front)
  drawDrones();
  drawTurrets();
  drawMedics();
  drawSnakeTurrets();
  drawSnakes();
  drawPowerupDrops();

  // Particles
  for (const p of run.particles) {
    const alpha = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (p.text) {
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.size}px Courier New`;
      ctx.textAlign = 'center';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.ring) {
      const growth = 1 - alpha;
      ctx.strokeStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 20;
      ctx.lineWidth = 3 * alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size + growth * 80, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();

  // HUD sync (lightweight, every frame)
  updateHUD();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(184, 71, 255, 0.12)';
  ctx.lineWidth = 1;
  const spacing = 50;
  const scroll = (run.timeElapsed * 30) % spacing;
  for (let x = -scroll; x < W; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = -scroll; y < H; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer() {
  const p = run.player;

  // ─── Engine trail (drawn first, behind ship) ───
  if (p.trail.length > 2) {
    ctx.save();
    for (let i = 1; i < p.trail.length; i++) {
      const t = p.trail[i];
      const prev = p.trail[i - 1];
      const alpha = (i / p.trail.length) * 0.5;
      const width = (i / p.trail.length) * 8;
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.shadowColor = '#00f0ff';
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
  const primary = dashing ? '#00f0ff' : '#ff2d95';
  const accent = dashing ? '#ffffff' : '#00f0ff';

  // ─── Thruster plume (behind ship) ───
  const pulse = 1 + Math.sin(p.enginePulse) * 0.15;
  const plumeLen = (12 + Math.sin(p.enginePulse * 2) * 3) * pulse;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 20;
  // Outer glow plume
  const plumeGrad = ctx.createLinearGradient(-8, 0, -8 - plumeLen, 0);
  plumeGrad.addColorStop(0, 'rgba(0, 240, 255, 0.9)');
  plumeGrad.addColorStop(0.5, 'rgba(184, 71, 255, 0.6)');
  plumeGrad.addColorStop(1, 'rgba(255, 45, 149, 0)');
  ctx.fillStyle = plumeGrad;
  ctx.beginPath();
  ctx.moveTo(-8, -5);
  ctx.lineTo(-8 - plumeLen, 0);
  ctx.lineTo(-8, 5);
  ctx.closePath();
  ctx.fill();
  // Inner bright core of thrust
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(-8, -2);
  ctx.lineTo(-8 - plumeLen * 0.5, 0);
  ctx.lineTo(-8, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ─── Hull fill (dark base) ───
  ctx.shadowColor = primary;
  ctx.shadowBlur = 18;
  ctx.fillStyle = flash ? 'rgba(255,255,255,0.4)' : 'rgba(26, 11, 46, 0.85)';
  ctx.strokeStyle = flash ? '#ffffff' : primary;
  ctx.lineWidth = 2;

  // Main body: angular delta-wing shape (arrow forward + swept wings)
  ctx.beginPath();
  ctx.moveTo(18, 0);           // nose tip
  ctx.lineTo(6, -4);           // upper neck
  ctx.lineTo(2, -14);          // upper wing tip
  ctx.lineTo(-8, -12);         // upper wing trailing
  ctx.lineTo(-10, -5);         // fuselage upper
  ctx.lineTo(-8, 0);            // tail center
  ctx.lineTo(-10, 5);          // fuselage lower
  ctx.lineTo(-8, 12);          // lower wing trailing
  ctx.lineTo(2, 14);           // lower wing tip
  ctx.lineTo(6, 4);            // lower neck
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ─── Tron light ribbons along hull edges ───
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  // Upper wing edge stripe
  ctx.beginPath();
  ctx.moveTo(14, -2);
  ctx.lineTo(4, -12);
  ctx.lineTo(-6, -10);
  ctx.stroke();
  // Lower wing edge stripe
  ctx.beginPath();
  ctx.moveTo(14, 2);
  ctx.lineTo(4, 12);
  ctx.lineTo(-6, 10);
  ctx.stroke();
  // Spine line
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-8, 0);
  ctx.stroke();
  ctx.restore();

  // ─── Dual cannons (little barrels at wing leading edges) ───
  ctx.save();
  ctx.fillStyle = '#1a0b2e';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 6;
  // Upper cannon
  ctx.fillRect(6, -9, 7, 3);
  ctx.strokeRect(6, -9, 7, 3);
  // Lower cannon
  ctx.fillRect(6, 6, 7, 3);
  ctx.strokeRect(6, 6, 7, 3);
  ctx.restore();

  // ─── Muzzle flash at cannon tips when firing ───
  if (p.fireFlash > 0) {
    const fa = p.fireFlash / 0.08;
    ctx.save();
    ctx.shadowColor = '#ffea00';
    ctx.shadowBlur = 20;
    ctx.fillStyle = `rgba(255, 234, 0, ${fa})`;
    ctx.beginPath(); ctx.arc(13, -7.5, 4 * fa, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(13, 7.5, 4 * fa, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ─── Rotating core reactor (center, pulses with fire rate) ───
  ctx.save();
  const coreRotation = p.enginePulse * 0.5;
  const coreSize = 3 + Math.sin(p.enginePulse * 3) * 0.6;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  // Outer rotating hex
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + coreRotation;
    const x = Math.cos(a) * (coreSize + 1.5);
    const y = Math.sin(a) * (coreSize + 1.5);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  // Inner bright core
  ctx.fillStyle = '#ffffff';
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.arc(0, 0, coreSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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
  submitScore({
    wave: run.waveNum,
    score: run.score,
    bestCombo: run.bestCombo,
    cores: run.cores,
    runDurationMs: Math.round(run.timeElapsed * 1000),
    upgrades: run.upgrades || []
  }).then((result) => {
    if (result.success) {
      toast('Score submitted to leaderboard');
    }
  });

  document.getElementById('hud').classList.add('hidden');
  document.getElementById('controlsPanel').classList.add('hidden');
  document.getElementById('dsWave').textContent = run.waveNum;
  document.getElementById('dsScore').textContent = run.score.toLocaleString();
  document.getElementById('dsCores').textContent = run.cores;
  document.getElementById('dsCombo').textContent = run.bestCombo;
  document.getElementById('dsBanked').textContent = banked;
  document.getElementById('deathScreen').classList.remove('hidden');
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
document.getElementById('metaBtn').onclick = openMeta;
document.getElementById('closeMetaBtn').onclick = () => { hideAll(); document.getElementById('titleScreen').classList.remove('hidden'); };
document.getElementById('resetBtn').onclick = () => {
  if (confirm('Wipe all meta progress?')) {
    localStorage.removeItem(STORAGE_KEY);
    meta = loadMeta();
    alert('Progress reset.');
  }
};
document.getElementById('retryBtn').onclick = () => { hideAll(); newRun(); };
document.getElementById('deathMetaBtn').onclick = openMeta;
document.getElementById('deathTitleBtn').onclick = () => { hideAll(); document.getElementById('titleScreen').classList.remove('hidden'); };
document.getElementById('leaveShopBtn').onclick = () => {
  hideAll();
  startWave(run.waveNum + 1);
};
document.getElementById('resumeBtn').onclick = togglePause;
document.getElementById('abandonBtn').onclick = () => {
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
        profileSaveTimer = setTimeout(() => setProfileDisplayName(v), 400);
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

  // Leaderboard button + scope toggle (Global / Friends)
  let leaderboardScope = 'global';
  function renderLeaderboardRows(rows, list, scope) {
    if (!rows || rows.length === 0) {
      const empty = scope === 'friends'
        ? 'No friend scores yet — invite some pilots!'
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
    if (!g || !f) return;
    const base = 'padding: 4px 14px; font-size: 11px;';
    const active = ' border-color: var(--pink); color: var(--pink);';
    g.style.cssText = base + (leaderboardScope === 'global' ? active : '');
    f.style.cssText = base + (leaderboardScope === 'friends' ? active : '');
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
    if (leaderboardScope === 'friends' && !isSignedIn()) {
      list.innerHTML = '<div class="dim" style="text-align: center; padding: 40px 0;">Sign in to see your friends-only leaderboard.</div>';
      return;
    }
    const fetcher = leaderboardScope === 'friends' ? fetchFriendsLeaderboard : fetchLeaderboard;
    const [rows, myBest] = await Promise.all([fetcher(20), fetchMyBest()]);
    if (myBest) {
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
  if (lbScopeG) lbScopeG.onclick = () => { leaderboardScope = 'global'; loadLeaderboard(); };
  if (lbScopeF) lbScopeF.onclick = () => { leaderboardScope = 'friends'; loadLeaderboard(); };
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
  const authMessage = document.getElementById('authMessage');
  const sendMagicBtn = document.getElementById('sendMagicLinkBtn');
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
    if (authEmailInput) {
      authEmailInput.value = '';
      setTimeout(() => authEmailInput.focus(), 50);
    }
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

  if (sendMagicBtn) {
    sendMagicBtn.onclick = async () => {
      const email = authEmailInput?.value || '';
      sendMagicBtn.disabled = true;
      showAuthMessage('Sending...', '');
      const { error } = await sendMagicLink(email);
      sendMagicBtn.disabled = false;
      if (error) {
        showAuthMessage(error.message || 'Send failed', 'error');
      } else {
        showAuthMessage(`Link sent to ${email.trim()}. Check your inbox.`, 'success');
      }
    };
  }
  if (closeAuthBtn) closeAuthBtn.onclick = closeAuthScreen;
  if (authEmailInput) {
    authEmailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && sendMagicBtn) sendMagicBtn.click();
    });
  }

  // Reflect auth state in the title-screen UI whenever it changes
  onAuthChange(({ session, profile }) => {
    if (!authStatusText || !authActionBtn) return;
    if (session?.user) {
      const name = profile?.display_name || session.user.email || 'pilot';
      authStatusText.textContent = `SIGNED IN: ${name.toUpperCase()}`;
      authStatusText.classList.remove('dim');
      authActionBtn.textContent = 'Sign Out';
      // If we just landed back from a magic-link redirect, return to title.
      if (!authScreen.classList.contains('hidden')) closeAuthScreen();
    } else {
      authStatusText.textContent = 'NOT SIGNED IN';
      authStatusText.classList.add('dim');
      authActionBtn.textContent = 'Sign In';
    }
    refreshNameInput();
  });

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
