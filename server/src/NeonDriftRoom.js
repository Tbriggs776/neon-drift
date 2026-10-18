const { Room } = require('colyseus');
const { Schema, MapSchema, ArraySchema, type } = require('@colyseus/schema');
const { ENEMY_DEFS, isBoss, getWaveInfo, makeEnemy, updateEnemyAI, keepInside } = require('./enemies');
const { shared } = require('./shared');
// Ship perks, shared with the client (src/ships.js reads the same file).
const SHIPS = require('../../shared/ships.json');

// ============================================================
// Server-authoritative dimensions. Clients render in their own
// canvas size and rescale incoming positions from this world.
// ============================================================
const MAX_PILOTS = 5;
const PILOT_COLOR_COUNT = 8; // matches PILOT_COLORS in src/ships.js
const WORLD_W = 1280;
const WORLD_H = 720;
const TICK_HZ = 30;
const FORK_FAN = 0.9; // Fork Rounds total fan width in radians (about 26° each side)

// Fusion: team kills fill a shared meter. When it's full, every living pilot
// snaps into one ship for FUSION_DURATION seconds. The host drives (or the
// first living pilot if the host is down), everyone aims their own giant
// cannon, and the fused ship can't be hurt. Enemies that touch it are crushed.
const FUSION_DURATION = 10;
const FUSION_PER_KILL = 0.04;       // 25 regular kills fills the meter
const FUSION_PER_BOSS_KILL = 0.35;
const FUSION_FIRE_CD = 0.3;
const FUSION_SHOT_DAMAGE = 40;      // one-shots every regular enemy
const FUSION_SHOT_RADIUS = 16;      // clients draw r >= 12 as fusion rounds

// Space sectors: a hyperspace jump between sectors (and on arrival), bosses
// stay below the HUD band at the top of the screen, and a cap on boss fire.
const WARP_TIME = 2.6;
const BOSS_TOP = 80;
const ENEMY_SHOT_CAP = 700;
const SHIP_R = 12;
// Test hooks (jump to a wave, invulnerable pilot). Only with NEON_DEV=1.
const DEV = process.env.NEON_DEV === '1';

// Small seeded RNG (mulberry32) so a room's maps follow its seed.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Schema state (only typed fields are sync'd; plain JS fields
// are server-only AI / cooldown bookkeeping).
// ============================================================

class Player extends Schema {
  constructor() {
    super();
    this.name = '';
    this.ready = false;
    this.isHost = false;
    // Color index into the client's PILOT_COLORS. Each pilot's choice when
    // it's free, so every screen shows the same pilot in the same color.
    this.slot = 0;
    this.ship = 'glide';
    this.shieldUp = false; // Royal's deflector is charged
    this.x = WORLD_W / 2;
    this.y = WORLD_H / 2;
    this.angle = 0;
    this.hp = 3;
    this.maxHp = 3;
    this.dead = false;
    this.score = 0;
    // Stat multipliers synced so the client can predict movement + fire-rate
    // for snappy local feel.
    this.speedMul = 1;
    this.fireRateMul = 1;
    // Companion counts — synced so clients can render drones around each pilot.
    this.droneCount = 0;
    this.extraShots = 0;
    // Dash cooldown synced so the local client can render a cooldown ring.
    this.dashCD = 0;
    // Wingmen (shared/wingmen.js): meter 0..1 from this pilot's kills, and
    // seconds the squad has left out. The squad itself is in state.wingmen.
    this.wingCharge = 0;
    this.wingTime = 0;
    // Last input sequence number applied, so the client can reconcile its
    // predicted position against the right moment.
    this.ack = 0;
    // server-only:
    this.fireCD = 0;
    this.iframes = 0;
    this.damageMul = 1;
    this.magnetMul = 1;
    this.droneFireCD = 0;
    this.wingSquad = [];  // the flying wingmen (synced copies in state.wingmen)
    this.pickedUpgrade = false;
    this.pendingChoices = null;
    this.r = SHIP_R;    // hit radius for hazards and beams
    this.sid = '';      // sessionId, so hazards can report who they hit
    this.god = false;   // dev only
    resetRunStats(this);
  }
}

// Per-run weapon and passive stats (server-only). Reset at the start of
// every run along with the synced multipliers.
function resetRunStats(p) {
  p.upgrades = [];
  p.pierce = 0;
  p.critChance = 0;
  p.shotSpeedMul = 1;
  p.homing = false;
  p.explosive = false;
  p.ricochet = 0;
  p.shockwave = false;
  p.leech = false;
  p.coresSinceHeal = 0;
  p.dashMul = 1;
  p.shieldMax = 0;
  p.shieldCD = 0;
  p.shieldUp = false;
}

function shipById(id) {
  return SHIPS.find((s) => s.id === id) || SHIPS[0];
}

// Same perk numbers the client applies in single player (applyShipPerks).
function applyShipPerks(p) {
  const s = shipById(p.ship).stats || {};
  if (s.hp) { p.maxHp = Math.max(1, p.maxHp + s.hp); p.hp = p.maxHp; }
  if (s.speed) p.speedMul *= s.speed;
  if (s.dashCD) p.dashMul *= s.dashCD;
  if (s.fireRate) p.fireRateMul *= s.fireRate;
  if (s.damage) p.damageMul *= s.damage;
  if (s.pierce) p.pierce += s.pierce;
  if (s.crit) p.critChance += s.crit;
  if (s.magnet) p.magnetMul *= s.magnet;
  if (s.drones) p.droneCount += s.drones;
  if (s.shield) { p.shieldMax = s.shield; p.shieldUp = true; }
}
type('string')(Player.prototype, 'name');
type('boolean')(Player.prototype, 'ready');
type('boolean')(Player.prototype, 'isHost');
type('int8')(Player.prototype, 'slot');
type('string')(Player.prototype, 'ship');
type('boolean')(Player.prototype, 'shieldUp');
type('float32')(Player.prototype, 'x');
type('float32')(Player.prototype, 'y');
type('float32')(Player.prototype, 'angle');
type('int16')(Player.prototype, 'hp');
type('int16')(Player.prototype, 'maxHp');
type('boolean')(Player.prototype, 'dead');
type('int32')(Player.prototype, 'score');
type('float32')(Player.prototype, 'speedMul');
type('float32')(Player.prototype, 'fireRateMul');
type('int8')(Player.prototype, 'droneCount');
type('int8')(Player.prototype, 'extraShots');
type('float32')(Player.prototype, 'dashCD');
type('float32')(Player.prototype, 'wingCharge');
type('float32')(Player.prototype, 'wingTime');
type('uint32')(Player.prototype, 'ack');

// One hitbox of a multi-part boss (Leviathan segment, Kraken tip, turret).
class Part extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.r = 10;
    this.a = 0; // turret aim
  }
}
type('float32')(Part.prototype, 'x');
type('float32')(Part.prototype, 'y');
type('float32')(Part.prototype, 'r');
type('float32')(Part.prototype, 'a');

// Synced fields are what the client needs to draw the single-player art:
// angle (lancer aim), phase (warden), charge (lancer wind-up) and
// intangible (phantom blink). Sector bosses add `vals` (the fields listed
// in BOSS_SYNC, shared/bosses.js), `parts`, `shielded` and their adds'
// `owner`. AI state from makeEnemy() is server-only.
class Enemy extends Schema {
  constructor() {
    super();
    this.type = 'grunt';
    this.x = 0;
    this.y = 0;
    this.hp = 3;
    this.maxHp = 3;
    this.r = 14;
    this.angle = 0;
    this.phase = 0;
    this.charge = 0;
    this.intangible = false;
    this.owner = '';
    this.shielded = false;
    this.vals = new ArraySchema();
    this.parts = new ArraySchema();
  }
}
type('string')(Enemy.prototype, 'type');
type('float32')(Enemy.prototype, 'x');
type('float32')(Enemy.prototype, 'y');
type('float32')(Enemy.prototype, 'hp');
type('float32')(Enemy.prototype, 'maxHp');
type('float32')(Enemy.prototype, 'r');
type('float32')(Enemy.prototype, 'angle');
type('int8')(Enemy.prototype, 'phase');
type('float32')(Enemy.prototype, 'charge');
type('boolean')(Enemy.prototype, 'intangible');
type('string')(Enemy.prototype, 'owner');
type('boolean')(Enemy.prototype, 'shielded');
type(['float32'])(Enemy.prototype, 'vals');
type([Part])(Enemy.prototype, 'parts');

class Projectile extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.r = 4;
    this.ownerType = 'player'; // 'player' | 'enemy'
    this.owner = -1; // shooter's color slot (player shots only)
    // Velocity is synced so clients can move bullets smoothly between updates.
    this.vx = 0;
    this.vy = 0;
    this.color = '';  // enemy bullet color
    this.crit = false;
    this.kind = 'orb'; // enemy bullet look: orb, shard, ice, rock, flame, missile, ink
    this.hold = 0;     // > 0 while the shot hangs in place before moving
    // server-only:
    this.life = 1.5;
    this.pierce = 0;
    this.ricochet = 0;
    this.homing = false;
    this.explosive = false;
    this.damage = 1;
    this.ownerId = ''; // sessionId of the player who fired (for score)
    this.hitIds = null; // fusion rounds pierce: enemies already hit
  }
}
type('float32')(Projectile.prototype, 'x');
type('float32')(Projectile.prototype, 'y');
type('float32')(Projectile.prototype, 'r');
type('string')(Projectile.prototype, 'ownerType');
type('int8')(Projectile.prototype, 'owner');
type('float32')(Projectile.prototype, 'vx');
type('float32')(Projectile.prototype, 'vy');
type('string')(Projectile.prototype, 'color');
type('boolean')(Projectile.prototype, 'crit');
type('string')(Projectile.prototype, 'kind');
type('float32')(Projectile.prototype, 'hold');

// Cores dropped on enemy death; collected on player overlap.
class Pickup extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.r = 8;
    this.value = 1;
  }
}
type('float32')(Pickup.prototype, 'x');
type('float32')(Pickup.prototype, 'y');
type('float32')(Pickup.prototype, 'r');
type('int16')(Pickup.prototype, 'value');

// Sector hazards (shared/spaceSim.js). One schema covers every kind; each
// kind fills only the fields it uses.
const HAZARD_FIELDS = {
  number: ['x', 'y', 'r', 'vx', 'vy', 'tier', 'variant', 'hp', 'warn', 'warnMax', 'burn', 'burnMax',
    'fuse', 'fuseMax', 'trigger', 'blast', 'core', 'reach', 'strength', 'life', 'pos', 'half',
    'x1', 'y1', 'x2', 'y2', 'width', 'pylonR', 'radius', 'thick', 'maxRadius', 'markX', 'markY',
    'boltSeed', 'seed'],
  string: ['kind', 'rockKind', 'axis', 'state', 'color', 'disk']
};
class Hazard extends Schema {
  constructor() {
    super();
    for (const f of HAZARD_FIELDS.number) this[f] = 0;
    for (const f of HAZARD_FIELDS.string) this[f] = '';
  }
}
for (const f of HAZARD_FIELDS.number) type('float32')(Hazard.prototype, f);
for (const f of HAZARD_FIELDS.string) type('string')(Hazard.prototype, f);

// Telegraphed boss lasers (Pulsar, Binary, Dreadnought, Nexus fence).
class Beam extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.len = 0;
    this.width = 10;
    this.warn = 0;
    this.warnMax = 1;
    this.color = '#ffffff';
    this.owner = '';
  }
}
type('float32')(Beam.prototype, 'x');
type('float32')(Beam.prototype, 'y');
type('float32')(Beam.prototype, 'angle');
type('float32')(Beam.prototype, 'len');
type('float32')(Beam.prototype, 'width');
type('float32')(Beam.prototype, 'warn');
type('float32')(Beam.prototype, 'warnMax');
type('string')(Beam.prototype, 'color');
type('string')(Beam.prototype, 'owner');

// Static cover for the current wave. Clients paint sprites from `seed`.
class Obstacle extends Schema {
  constructor() {
    super();
    this.shape = 'circle';
    this.kind = 'asteroid';
    this.x = 0;
    this.y = 0;
    this.r = 0;
    this.w = 0;
    this.h = 0;
    this.spriteR = 0;
    this.rot = 0;
    this.spin = 0;
    this.seed = 0;
    this.noDraw = false;
  }
}
type('string')(Obstacle.prototype, 'shape');
type('string')(Obstacle.prototype, 'kind');
type('float32')(Obstacle.prototype, 'x');
type('float32')(Obstacle.prototype, 'y');
type('float32')(Obstacle.prototype, 'r');
type('float32')(Obstacle.prototype, 'w');
type('float32')(Obstacle.prototype, 'h');
type('float32')(Obstacle.prototype, 'spriteR');
type('float32')(Obstacle.prototype, 'rot');
type('float32')(Obstacle.prototype, 'spin');
type('uint32')(Obstacle.prototype, 'seed');
type('boolean')(Obstacle.prototype, 'noDraw');

// One of a pilot's wingmen. `owner` is the pilot's sessionId, so every
// screen can draw it as a small copy of that pilot's ship in their color.
class Wingman extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.owner = '';
  }
}
type('float32')(Wingman.prototype, 'x');
type('float32')(Wingman.prototype, 'y');
type('float32')(Wingman.prototype, 'angle');
type('string')(Wingman.prototype, 'owner');

class RoomState extends Schema {
  constructor() {
    super();
    this.code = '';
    this.started = false;
    this.gameOver = false;
    this.seed = 0;
    this.waveNum = 0;
    this.totalScore = 0;
    this.fusionMeter = 0;   // 0..1, fills from team kills
    this.fusionTime = 0;    // seconds of fusion left; > 0 means fused
    this.fusionDriver = ''; // sessionId steering the fused ship
    this.worldW = WORLD_W;
    this.worldH = WORLD_H;
    this.sectorWave = 1;  // wave whose sector sky is showing (swaps mid-jump)
    this.warpTime = 0;    // seconds of hyperspace jump left
    this.warpTo = 0;      // wave the jump is heading to
    this.paused = false;  // sim stopped while pilots pick upgrades
    this.mapId = 0;       // bumps whenever the cover changes
    this.players = new MapSchema();
    this.enemies = new MapSchema();
    this.projectiles = new MapSchema();
    this.pickups = new MapSchema();
    this.hazards = new MapSchema();
    this.beams = new MapSchema();
    this.wingmen = new MapSchema();
    this.obstacles = new ArraySchema();
  }
}
type('string')(RoomState.prototype, 'code');
type('boolean')(RoomState.prototype, 'started');
type('boolean')(RoomState.prototype, 'gameOver');
type('int32')(RoomState.prototype, 'seed');
type('int16')(RoomState.prototype, 'waveNum');
type('int32')(RoomState.prototype, 'totalScore');
type('float32')(RoomState.prototype, 'fusionMeter');
type('float32')(RoomState.prototype, 'fusionTime');
type('string')(RoomState.prototype, 'fusionDriver');
type('int16')(RoomState.prototype, 'worldW');
type('int16')(RoomState.prototype, 'worldH');
type({ map: Player })(RoomState.prototype, 'players');
type({ map: Enemy })(RoomState.prototype, 'enemies');
type({ map: Projectile })(RoomState.prototype, 'projectiles');
type({ map: Pickup })(RoomState.prototype, 'pickups');
type('int16')(RoomState.prototype, 'sectorWave');
type('float32')(RoomState.prototype, 'warpTime');
type('int16')(RoomState.prototype, 'warpTo');
type('boolean')(RoomState.prototype, 'paused');
type('int16')(RoomState.prototype, 'mapId');
type({ map: Hazard })(RoomState.prototype, 'hazards');
type({ map: Beam })(RoomState.prototype, 'beams');
type([Obstacle])(RoomState.prototype, 'obstacles');
type({ map: Wingman })(RoomState.prototype, 'wingmen');

// ============================================================
// Helpers
// ============================================================

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  let c = '';
  for (let i = 0; i < 6; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// Screen wrap: a ship (radius 12) that fully leaves one edge of the world
// reappears just past the opposite edge. Clients mirror this in game.js.
function wrap(v, size) {
  if (v < -12) return v + size + 24;
  if (v > size + 12) return v - size - 24;
  return v;
}

// Upgrade pool, matching single player's names, rarities and icons. The
// deployable turrets, beam and slow-mo are single-player only. `unique`
// upgrades are offered once; `requires` needs another one first.
const UPGRADE_POOL = [
  // COMMON
  { id: 'dmg1',    name: 'Hotter Pulse',    rarity: 'common', icon: '⚡', desc: '+20% damage' },
  { id: 'rate1',   name: 'Quicker Trigger', rarity: 'common', icon: '🔥', desc: '+20% fire rate' },
  { id: 'speed1',  name: 'Thruster Boost',  rarity: 'common', icon: '💨', desc: '+15% move speed' },
  { id: 'magnet1', name: 'Core Magnet',     rarity: 'common', icon: '🧲', desc: '+50% pickup radius' },
  { id: 'hp1',     name: 'Plating',         rarity: 'common', icon: '🛡', desc: '+1 max HP, full heal' },
  // RARE
  { id: 'pierce',     name: 'Hardlight Rounds', rarity: 'rare', icon: '◈', desc: 'Bullets pierce +1 enemy' },
  { id: 'crit',       name: 'Overcharge Coils', rarity: 'rare', icon: '✦', desc: '+15% crit chance (2x dmg)' },
  { id: 'multishot1', name: 'Multi Shot',       rarity: 'rare', icon: '❋', desc: 'Fire 3 bullets: straight, left and right', unique: true },
  { id: 'multishot2', name: 'Multi Shot II',    rarity: 'rare', icon: '✹', desc: '+2 bullets in the same fan, packed tighter (3 → 5)', unique: true, requires: 'multishot1' },
  { id: 'velocity',   name: 'Coilgun',          rarity: 'rare', icon: '➤', desc: '+50% projectile speed & damage' },
  { id: 'leech',      name: 'Core Siphon',      rarity: 'rare', icon: '❤', desc: 'Cores heal 1 HP every 5 picked up', unique: true },
  { id: 'drone1',     name: 'Combat Drone',     rarity: 'rare', icon: '✧', desc: 'Orbiting drone that shoots with you' },
  // LEGENDARY
  { id: 'homing',   name: 'Smart Rounds', rarity: 'legendary', icon: '◉', desc: 'Bullets home toward enemies', unique: true },
  { id: 'explode',  name: 'Payload',      rarity: 'legendary', icon: '✺', desc: 'Bullets explode on impact', unique: true },
  { id: 'shock',    name: 'Deathwave',    rarity: 'legendary', icon: '⬢', desc: 'Kills release damaging shockwaves', unique: true },
  { id: 'ricochet', name: 'Bouncer',      rarity: 'legendary', icon: '⟲', desc: 'Bullets bounce off the world edge up to 2 times', unique: true },
  { id: 'drone2',   name: 'Drone Swarm',  rarity: 'legendary', icon: '✨', desc: 'Adds 2 more drones' }
];

function isUpgradeAvailable(player, u) {
  if (u.unique && player.upgrades.includes(u.id)) return false;
  if (u.requires && !player.upgrades.includes(u.requires)) return false;
  return true;
}

// Three distinct choices, rarity weighted the same way as single player:
// rare and legendary odds climb with the wave number.
function pickUpgradeChoices(player, waveNum) {
  const legendaryChance = Math.min(0.35, 0.05 + Math.max(0, waveNum - 5) * 0.02);
  const rareChance = Math.min(0.6, 0.2 + Math.max(0, waveNum - 2) * 0.04);
  const picks = [];
  for (let i = 0; i < 3; i++) {
    const r = Math.random();
    let rarity = r < legendaryChance ? 'legendary' : r < legendaryChance + rareChance ? 'rare' : 'common';
    let pool = [];
    // Fall back to a lower rarity if everything at this one is taken.
    for (const tier of [rarity, 'rare', 'common']) {
      pool = UPGRADE_POOL.filter((u) => u.rarity === tier && isUpgradeAvailable(player, u) && !picks.includes(u));
      if (pool.length) break;
    }
    if (!pool.length) break;
    picks.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return picks.map(({ id, name, desc, rarity, icon }) => ({ id, name, desc, rarity, icon }));
}

function applyUpgrade(player, choice) {
  player.upgrades.push(choice.id);
  switch (choice.id) {
    case 'dmg1':       player.damageMul   = (player.damageMul   || 1) * 1.2;  break;
    case 'rate1':      player.fireRateMul = (player.fireRateMul || 1) * 1.22; break;
    case 'speed1':     player.speedMul    = (player.speedMul    || 1) * 1.15; break;
    case 'magnet1':    player.magnetMul   = (player.magnetMul   || 1) * 1.5;  break;
    case 'hp1':        player.maxHp += 1; player.hp = player.maxHp; break;
    case 'pierce':     player.pierce += 1; break;
    case 'crit':       player.critChance += 0.15; break;
    case 'multishot1': player.extraShots = (player.extraShots || 0) + 2; break;
    case 'multishot2': player.extraShots = (player.extraShots || 0) + 2; break;
    case 'velocity':   player.shotSpeedMul *= 1.5; player.damageMul = (player.damageMul || 1) * 1.5; break;
    case 'leech':      player.leech = true; break;
    case 'drone1':     player.droneCount = (player.droneCount || 0) + 1; break;
    case 'homing':     player.homing = true; break;
    case 'explode':    player.explosive = true; break;
    case 'shock':      player.shockwave = true; break;
    case 'ricochet':   player.ricochet = 2; break;
    case 'drone2':     player.droneCount = (player.droneCount || 0) + 2; break;
  }
}


// Keep a synced float array in step with a plain one.
function syncNumbers(arr, vals) {
  if (arr.length !== vals.length) {
    arr.clear();
    arr.push(...vals);
    return;
  }
  for (let i = 0; i < vals.length; i++) if (arr[i] !== vals[i]) arr.setAt(i, vals[i]);
}

// Keep a boss's synced hitboxes in step with its AI parts.
function syncParts(arr, parts) {
  if (arr.length !== parts.length) {
    arr.clear();
    for (let i = 0; i < parts.length; i++) arr.push(new Part());
  }
  parts.forEach((pt, i) => {
    const s = arr[i];
    if (s.x !== pt.x) s.x = pt.x;
    if (s.y !== pt.y) s.y = pt.y;
    if (s.r !== pt.r) s.r = pt.r;
    const a = pt.a || 0;
    if (s.a !== a) s.a = a;
  });
}

// ============================================================
// Room — lobby + authoritative simulation
// ============================================================

class NeonDriftRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_PILOTS;
    this.setState(new RoomState());
    this.state.code = generateCode();
    this.setMetadata({ code: this.state.code });

    // 30Hz state patches keep ship/enemy motion smooth on clients.
    this.setPatchRate(1000 / TICK_HZ);

    this.playerInput = new Map(); // sessionId -> { moveX, moveY, aimAngle, firing }
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.enemyAI = new Map(); // enemy id -> AI state from makeEnemy()
    this.nextEntityId = 1;
    this.upgradePhase = false;
    this.warp = null;           // { t, toWave, swapped } during a hyperspace jump
    this.beams = [];            // live boss lasers, mirrored into state.beams
    this.hazardRand = Math.random;
    this.bossRand = Math.random;
    this.target = null;         // the pilot the boss being updated is after
    this.hw = this.makeHazardWorld();
    this.bossApi = this.makeBossApi();

    this.onMessage('setName', (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.name = String(name || '').slice(0, 20);
    });

    this.onMessage('setLoadout', (client, payload) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.started) return;
      p.ship = shipById(payload?.ship).id;
      const color = Number(payload?.color);
      if (Number.isInteger(color) && color >= 0 && color < PILOT_COLOR_COUNT && !this.colorTaken(color, p)) {
        p.slot = color;
      }
    });

    this.onMessage('setReady', (client, ready) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.started) return;
      p.ready = !!ready;
    });

    this.onMessage('input', (client, payload) => {
      if (!this.state.started) return;
      this.playerInput.set(client.sessionId, {
        seq: Math.max(0, Math.floor(Number(payload?.seq) || 0)),
        moveX: clamp(Number(payload?.moveX) || 0, -1, 1),
        moveY: clamp(Number(payload?.moveY) || 0, -1, 1),
        aimAngle: Number(payload?.aimAngle) || 0,
        firing: !!payload?.firing
      });
    });

    this.onMessage('dash', (client) => {
      if (!this.state.started || this.state.gameOver || this.upgradePhase || this.warp) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead || (p.dashCD || 0) > 0) return;
      if (this.state.fusionTime > 0 && client.sessionId !== this.state.fusionDriver) return;
      const inp = this.playerInput.get(client.sessionId);
      // Dash goes in the move direction if any, else in aim direction.
      let dx = 0, dy = 0;
      if (inp) {
        const mag = Math.hypot(inp.moveX || 0, inp.moveY || 0);
        if (mag > 0.15) {
          dx = inp.moveX / mag;
          dy = inp.moveY / mag;
        } else {
          dx = Math.cos(inp.aimAngle || 0);
          dy = Math.sin(inp.aimAngle || 0);
        }
      }
      this.moveShip(p, p.x + dx * 120, p.y + dy * 120);
      p.iframes = 0.35;
      p.dashCD = 1.0 * (p.dashMul || 1);
      this.broadcast('fx', { type: 'dash', x: p.x, y: p.y });
    });

    this.onMessage('wingmen', (client) => {
      if (!this.state.started || this.state.gameOver || this.upgradePhase || this.warp) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead || p.wingTime > 0 || p.wingCharge < 1) return;
      const { wingmen } = shared();
      p.wingSquad = wingmen.launchSquad(p.x, p.y, p.angle, Math.random);
      p.wingTime = wingmen.WING.duration;
      p.wingCharge = 0;
      this.broadcast('fx', { type: 'wingmen', x: p.x, y: p.y, slot: p.slot });
    });

    this.onMessage('pickUpgrade', (client, payload) => {
      if (!this.upgradePhase) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead || p.pickedUpgrade) return;
      const choice = (p.pendingChoices || []).find((c) => c.id === payload?.id);
      if (!choice) return;
      applyUpgrade(p, choice);
      p.pickedUpgrade = true;
      p.pendingChoices = null;
      this.maybeEndUpgradePhase();
    });

    this.onMessage('start', (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.isHost || this.state.started) return;
      const all = Array.from(this.state.players.values());
      if (all.length < 1) return;
      const allReady = all.every((x) => x.ready);
      if (!allReady) return;
      this.state.seed = Math.floor(Math.random() * 0x7fffffff);
      this.state.started = true;
      this.state.gameOver = false;
      this.state.totalScore = 0;
      this.state.fusionMeter = 0;
      this.state.fusionTime = 0;
      this.state.fusionDriver = '';
      // Reset gameplay state for the run.
      this.state.enemies.clear();
      this.enemyAI.clear();
      this.state.projectiles.clear();
      this.state.pickups.clear();
      this.state.players.forEach((pl) => {
        pl.x = WORLD_W / 2 + (Math.random() - 0.5) * 80;
        pl.y = WORLD_H / 2 + (Math.random() - 0.5) * 80;
        pl.maxHp = 3;
        pl.hp = pl.maxHp;
        pl.dead = false;
        pl.iframes = 0;
        pl.fireCD = 0;
        pl.dashCD = 0;
        pl.score = 0;
        // Reset per-run stats and companions
        pl.damageMul = 1;
        pl.fireRateMul = 1;
        pl.speedMul = 1;
        pl.magnetMul = 1;
        pl.droneCount = 0;
        pl.extraShots = 0;
        pl.droneFireCD = 0;
        pl.wingCharge = 0;
        pl.wingTime = 0;
        pl.wingSquad = [];
        pl.pickedUpgrade = false;
        pl.pendingChoices = null;
        resetRunStats(pl);
        applyShipPerks(pl);
      });
      this.upgradePhase = false;
      this.state.paused = false;
      this.clearBeams();
      this.hw.hazards.length = 0;
      this.setObstacles([]);
      // Arrive out of hyperspace, then wave 1 starts
      this.beginWarp(1, true);
      this.broadcast('gameStart', { seed: this.state.seed });
      this.lock();
      // Begin the simulation loop now that the run has started.
      this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
    });

    // Test hooks for local play-testing (NEON_DEV=1 only): jump to a wave,
    // make your pilot invulnerable, move your pilot, fill the wingmen meter,
    // clear the wave.
    if (DEV) {
      this.onMessage('devWave', (_client, n) => {
        if (!this.state.started) return;
        this.state.enemies.clear();
        this.enemyAI.clear();
        this.state.projectiles.clear();
        this.spawnQueue = [];
        this.upgradePhase = false;
        this.state.paused = false;
        this.beginWarp(Math.max(1, Math.floor(Number(n) || 1)));
      });
      this.onMessage('devGod', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.god = true;
      });
      this.onMessage('devPos', (client, pos) => {
        const p = this.state.players.get(client.sessionId);
        if (p) { p.x = Number(pos?.x) || p.x; p.y = Number(pos?.y) || p.y; }
      });
      this.onMessage('devWing', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.wingCharge = 1;
      });
      this.onMessage('devKill', () => {
        for (const id of [...this.enemyAI.keys()]) this.killEnemyNow(id, null);
        this.spawnQueue = [];
      });
    }
  }

  onJoin(client, options) {
    const player = new Player();
    player.name = (options && options.name)
      ? String(options.name).slice(0, 20)
      : 'Pilot';
    player.isHost = this.state.players.size === 0;
    player.ship = shipById(options && options.ship).id;
    // The pilot's chosen color if nobody has it, else the first free one.
    const wanted = Number(options && options.color);
    if (Number.isInteger(wanted) && wanted >= 0 && wanted < PILOT_COLOR_COUNT && !this.colorTaken(wanted)) {
      player.slot = wanted;
    } else {
      for (let i = 0; i < PILOT_COLOR_COUNT; i++) {
        if (!this.colorTaken(i)) { player.slot = i; break; }
      }
    }
    player.sid = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  colorTaken(color, except) {
    let taken = false;
    this.state.players.forEach((p) => { if (p !== except && p.slot === color) taken = true; });
    return taken;
  }

  onLeave(client) {
    const wasHost = this.state.players.get(client.sessionId)?.isHost || false;
    this.state.players.delete(client.sessionId);
    this.playerInput.delete(client.sessionId);
    this.syncWingmen();
    if (wasHost && this.state.players.size > 0) {
      const next = this.state.players.values().next().value;
      if (next) next.isHost = true;
    }
    // If the leaver was the only one we were waiting on for an upgrade pick,
    // unblock the run.
    if (this.upgradePhase) this.maybeEndUpgradePhase();
  }

  // ----------------------------------------------------------
  // Simulation tick (30Hz)
  // ----------------------------------------------------------
  tick(dt) {
    if (!this.state.started || this.state.gameOver) return;
    if (this.upgradePhase) return; // sim is paused while pilots pick upgrades
    if (this.warp) { this.updateWarp(dt); return; } // nothing to fight mid-jump
    this.simTime = (this.simTime || 0) + dt;
    this.updateFusion(dt);
    this.updatePlayers(dt);
    this.updateDrones(dt);
    this.updateWingmen(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateBeams(dt);
    this.updateHazards(dt);
    this.collisions(dt);
    this.collectPickups(dt);
    this.updateSpawning(dt);
    this.mirrorSpace();
    this.checkGameOver();
  }

  // Every pilot's squad hunts on its own (shared/wingmen.js), then the
  // synced copies in state.wingmen are brought in step.
  updateWingmen(dt) {
    const { wingmen } = shared();
    const { WING } = wingmen;
    // The AI copies carry velocity, so wingmen can lead their shots
    const enemies = [...this.enemyAI.values()];
    this.state.players.forEach((p, sid) => {
      if (!p.wingSquad.length) return;
      p.wingTime = Math.max(0, p.wingTime - dt);
      if (p.wingTime <= 0) {
        for (const w of p.wingSquad) this.broadcast('fx', { type: 'wingmanGone', x: w.x, y: w.y, slot: p.slot });
        p.wingSquad = [];
        return;
      }
      const g = {
        W: WORLD_W, H: WORLD_H,
        home: p,
        enemies: () => enemies,
        alive: (e) => !e.dead && this.enemyAI.get(String(e.id)) === e,
        shoot: (w, angle) => {
          const proj = new Projectile();
          proj.x = w.x + Math.cos(angle) * 10; proj.y = w.y + Math.sin(angle) * 10; proj.r = 3;
          proj.ownerType = 'player';
          proj.ownerId = sid;
          proj.owner = p.slot;
          proj.vx = Math.cos(angle) * WING.shotSpeed;
          proj.vy = Math.sin(angle) * WING.shotSpeed;
          proj.life = 1.2;
          proj.damage = WING.damage * (p.damageMul || 1);
          proj.homing = true;
          this.state.projectiles.set(String(this.nextEntityId++), proj);
        }
      };
      for (const w of p.wingSquad) wingmen.updateWingman(w, dt, g);
    });
    this.syncWingmen();
  }

  syncWingmen() {
    const seen = new Set();
    this.state.players.forEach((p, sid) => {
      p.wingSquad.forEach((w, k) => {
        const id = `${sid}:${k}`;
        seen.add(id);
        let s = this.state.wingmen.get(id);
        if (!s) { s = new Wingman(); s.owner = sid; this.state.wingmen.set(id, s); }
        s.x = w.x; s.y = w.y; s.angle = w.angle;
      });
    });
    for (const id of [...this.state.wingmen.keys()]) {
      if (!seen.has(id)) this.state.wingmen.delete(id);
    }
  }

  updateDrones(dt) {
    this.state.players.forEach((p, sid) => {
      if (p.dead || !p.droneCount) return;
      p.droneFireCD = Math.max(0, (p.droneFireCD || 0) - dt);
      if (p.droneFireCD > 0) return;
      // Fire one volley from every orbiting drone this pilot owns.
      p.droneFireCD = 0.9;
      const t = this.simTime || 0;
      for (let i = 0; i < p.droneCount; i++) {
        const orbitAngle = t * 2 + (i / p.droneCount) * Math.PI * 2;
        const dx = p.x + Math.cos(orbitAngle) * 44;
        const dy = p.y + Math.sin(orbitAngle) * 44;
        // Target nearest enemy within 400px
        let target = null, best = Infinity;
        this.state.enemies.forEach((e) => {
          if (e.intangible) return;
          const ex = e.x - dx, ey = e.y - dy;
          const d = Math.hypot(ex, ey);
          if (d < best) { best = d; target = e; }
        });
        if (!target || best > 400) continue;
        const aim = Math.atan2(target.y - dy, target.x - dx);
        const proj = new Projectile();
        proj.x = dx; proj.y = dy; proj.r = 3;
        proj.ownerType = 'player';
        proj.ownerId = sid;
        proj.owner = p.slot;
        proj.vx = Math.cos(aim) * 500;
        proj.vy = Math.sin(aim) * 500;
        proj.life = 1.2;
        // Drones do half the damage of the main gun so they feel supportive,
        // not dominant — you still want to shoot yourself.
        proj.damage = 0.5 * (p.damageMul || 1);
        this.state.projectiles.set(String(this.nextEntityId++), proj);
      }
    });
  }

  updatePlayers(dt) {
    const BASE_SPEED = 240;
    const BASE_FIRE_CD = 0.15;
    const fused = this.state.fusionTime > 0;
    if (fused) this.snapToFusionDriver();
    this.state.players.forEach((p, sid) => {
      if (p.iframes > 0) p.iframes = Math.max(0, p.iframes - dt);
      p.fireCD = Math.max(0, (p.fireCD || 0) - dt);
      p.dashCD = Math.max(0, (p.dashCD || 0) - dt);
      if (p.shieldMax && !p.shieldUp && !p.dead) {
        p.shieldCD -= dt;
        if (p.shieldCD <= 0) p.shieldUp = true;
      }
      if (p.dead) return;
      const inp = this.playerInput.get(sid);
      if (!inp) return;
      // Movement (with speed upgrade). While fused only the driver steers.
      if (!fused || sid === this.state.fusionDriver) {
        let mx = inp.moveX, my = inp.moveY;
        const mag = Math.hypot(mx, my);
        if (mag > 1) { mx /= mag; my /= mag; }
        const speed = BASE_SPEED * (p.speedMul || 1);
        this.moveShip(p, p.x + mx * speed * dt, p.y + my * speed * dt);
      }
      p.angle = inp.aimAngle;
      p.ack = inp.seq;
      // Fire (with fire-rate upgrade — divides cooldown). Fused pilots fire
      // their giant cannon on a fixed cadence instead.
      if (inp.firing && p.fireCD <= 0) {
        if (fused) {
          p.fireCD = FUSION_FIRE_CD;
          this.spawnFusionShot(p, sid);
        } else {
          p.fireCD = BASE_FIRE_CD / (p.fireRateMul || 1);
          this.spawnPlayerProjectile(p, sid);
        }
      }
    });
    if (fused) this.snapToFusionDriver();
  }

  // ----------------------------------------------------------
  // Fusion
  // ----------------------------------------------------------
  pickFusionDriver() {
    let host = null, first = null;
    this.state.players.forEach((p, sid) => {
      if (p.dead) return;
      if (!first) first = sid;
      if (p.isHost) host = sid;
    });
    return host || first;
  }

  // Keeps every living pilot on the driver's position. Re-picks the driver
  // if the current one left the room.
  snapToFusionDriver() {
    const current = this.state.players.get(this.state.fusionDriver);
    if (!current || current.dead) this.state.fusionDriver = this.pickFusionDriver() || '';
    const driver = this.state.players.get(this.state.fusionDriver);
    if (!driver) return;
    this.state.players.forEach((p) => {
      if (p.dead || p === driver) return;
      p.x = driver.x;
      p.y = driver.y;
    });
  }

  addFusionCharge(amount) {
    if (this.state.fusionTime > 0) return;
    this.state.fusionMeter = Math.min(1, this.state.fusionMeter + amount);
    if (this.state.fusionMeter >= 1) this.startFusion();
  }

  startFusion() {
    const driverSid = this.pickFusionDriver();
    const driver = driverSid && this.state.players.get(driverSid);
    if (!driver) return;
    this.state.fusionMeter = 0;
    this.state.fusionTime = FUSION_DURATION;
    this.state.fusionDriver = driverSid;
    this.state.players.forEach((p) => {
      if (p.dead) return;
      p.x = driver.x;
      p.y = driver.y;
      p.fireCD = 0;
    });
    this.broadcast('fx', { type: 'fusionStart', x: driver.x, y: driver.y });
  }

  updateFusion(dt) {
    if (this.state.fusionTime <= 0) return;
    this.state.fusionTime = Math.max(0, this.state.fusionTime - dt);
    if (this.state.fusionTime === 0) this.endFusion();
  }

  // Split the team back apart in a small ring around the driver, with a
  // moment of invulnerability so nobody pops out into an enemy.
  endFusion() {
    const driver = this.state.players.get(this.state.fusionDriver)
      || this.state.players.get(this.pickFusionDriver());
    this.state.fusionDriver = '';
    if (!driver) return;
    const others = [];
    this.state.players.forEach((p) => { if (!p.dead && p !== driver) others.push(p); });
    others.forEach((p, i) => {
      const a = (i / others.length) * Math.PI * 2;
      p.x = clamp(driver.x + Math.cos(a) * 40, 12, WORLD_W - 12);
      p.y = clamp(driver.y + Math.sin(a) * 40, 12, WORLD_H - 12);
      p.iframes = 1.0;
    });
    driver.iframes = 1.0;
    this.broadcast('fx', { type: 'fusionEnd', x: driver.x, y: driver.y });
  }

  updateEnemies(dt) {
    const { sim, bosses } = shared();
    const obstacles = this.hw.obstacles;
    const fx = {
      shoot: (x, y, angle, speed, color) => this.spawnEnemyShot(x, y, angle, speed, color),
      spawnAdds: (hive) => {
        if (this.state.enemies.size >= 40) return;
        for (let k = 0; k < 2; k++) {
          // Adds die with their hive
          this.addEnemy('grunt', 0.5, this.waveInfo ? this.waveInfo.diffMul * 0.6 : 1,
            hive.x + (Math.random() - 0.5) * 40, hive.y + (Math.random() - 0.5) * 40, hive);
        }
        this.broadcast('fx', { type: 'burst', x: hive.x, y: hive.y, color: '#39ff14' });
      },
      // Bosses and phasing phantoms fly over cover; everything else slides along it
      move: (e, x, y) => {
        if (e.intangible || isBoss(e.type) || obstacles.length === 0) { e.x = x; e.y = y; return; }
        const res = sim.resolveMove(obstacles, e.x, e.y, x, y, e.r);
        e.x = res.x;
        e.y = res.y;
      }
    };
    this.state.enemies.forEach((e, id) => {
      const ai = this.enemyAI.get(id);
      if (!ai || ai.dead) return;
      const target = this.nearestPilot(ai.x, ai.y);
      if (!target) return;
      if (bosses.BOSS_SYNC[ai.ai]) {
        // Sector bosses and their adds: the same AI as single player
        ai.t += dt;
        this.target = target;
        bosses.updateSpaceEnemy(ai, dt, this.bossApi);
        fx.move(ai, ai.x + ai.vx * dt, ai.y + ai.vy * dt);
        if (isBoss(ai.type)) keepInside(ai, WORLD_W, WORLD_H);
        if (ai.shieldHit > 0) ai.shieldHit -= dt;
      } else {
        updateEnemyAI(ai, target, dt, WORLD_W, WORLD_H, fx);
      }
      e.x = ai.x;
      e.y = ai.y;
      e.angle = ai.angle;
      e.phase = ai.phase;
      e.charge = ai.charge;
      e.intangible = ai.intangible;
    });
  }

  nearestPilot(x, y) {
    let target = null;
    let bestDist = Infinity;
    this.state.players.forEach((p) => {
      if (p.dead) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) { bestDist = d; target = p; }
    });
    return target;
  }

  // Keeps the synced HP and the AI copy in step. A shielded boss (Nexus)
  // shrugs it off: returns false.
  damageEnemy(e, id, amount) {
    const ai = this.enemyAI.get(id);
    if (ai && ai.shielded) {
      ai.shieldHit = 0.15;
      return false;
    }
    e.hp -= amount;
    if (ai) ai.hp = e.hp;
    return true;
  }

  // Damage from hazards (mines, comets, flares, lightning, gates).
  hitEnemy(ai, amount, killerSid) {
    const e = this.state.enemies.get(String(ai.id));
    if (!e || ai.dead) return;
    if (this.damageEnemy(e, String(ai.id), amount) && e.hp <= 0) this.killEnemyNow(String(ai.id), killerSid);
  }

  // Kill outside the collision pass (hazards, dev hooks).
  killEnemyNow(id, killerSid) {
    const e = this.state.enemies.get(id);
    const ai = this.enemyAI.get(id);
    if (!e || !ai || ai.dead) return;
    const dying = new Set([id]);
    this.onEnemyKilled(e, id, killerSid, dying);
    for (const d of dying) {
      this.state.enemies.delete(d);
      this.enemyAI.delete(d);
    }
  }

  // Body or any part of a multi-part boss.
  shotHitsEnemy(proj, e, ai) {
    const dx = proj.x - e.x, dy = proj.y - e.y, rr = proj.r + e.r;
    if (dx * dx + dy * dy < rr * rr) return true;
    if (ai && ai.parts) {
      for (const pt of ai.parts) {
        const px = proj.x - pt.x, py = proj.y - pt.y, pr = proj.r + pt.r;
        if (px * px + py * py < pr * pr) return true;
      }
    }
    return false;
  }

  // Ship movement: slide along cover, then wrap at the world edge.
  // The client predicts with the same two calls (mpTick in src/game.js).
  moveShip(p, x, y) {
    const { sim } = shared();
    const res = sim.resolveMove(this.hw.obstacles, p.x, p.y, x, y, SHIP_R);
    const w = sim.wrapPosition(this.hw.obstacles, res.x, res.y, SHIP_R, WORLD_W, WORLD_H);
    p.x = w.x;
    p.y = w.y;
  }

  updateProjectiles(dt) {
    const { sim } = shared();
    const obstacles = this.hw.obstacles;
    const wells = this.hw.wells;
    const dead = [];
    const bursts = [];
    this.state.projectiles.forEach((p, id) => {
      const prevX = p.x, prevY = p.y;
      if (p.ownerType === 'enemy') {
        // Delays, spirals, curves, homing and growth (shared/spaceSim.js)
        const step = sim.advanceShot(p, dt, this.nearestPilot(p.x, p.y));
        if (step === 'swallowed') { dead.push(id); return; }
        p.hold = p.delay > 0 ? p.delay : 0;
        if (sim.applyWellGravity(wells, p, dt)) { dead.push(id); return; }
        if (step === 'burst') { dead.push(id); bursts.push(p); return; }
        // Cover and drifting rocks block enemy fire
        if (!p.orbit && sim.segmentHitsObstacle(obstacles, prevX, prevY, p.x, p.y)) { dead.push(id); return; }
        if (sim.hazardBlocksShot(this.hw, p)) { dead.push(id); return; }
        const m = 40 + p.r;
        if (p.life <= 0 || p.x < -m || p.x > WORLD_W + m || p.y < -m || p.y > WORLD_H + m) dead.push(id);
        return;
      }
      // Smart Rounds: steer gently toward the nearest enemy, keeping speed.
      if (p.homing) {
        let nearest = null, nd = 400;
        this.state.enemies.forEach((e) => {
          if (e.intangible) return;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; nearest = e; }
        });
        if (nearest) {
          const speed = Math.hypot(p.vx, p.vy);
          const tx = nearest.x - p.x, ty = nearest.y - p.y;
          const tmag = Math.hypot(tx, ty) || 1;
          let vx = p.vx * 0.9 + (tx / tmag) * speed * 0.15;
          let vy = p.vy * 0.9 + (ty / tmag) * speed * 0.15;
          const nv = Math.hypot(vx, vy) || 1;
          p.vx = (vx / nv) * speed;
          p.vy = (vy / nv) * speed;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      // Gravity wells bend pilots' shots too
      if (sim.applyWellGravity(wells, p, dt)) { dead.push(id); return; }
      const fusionRound = p.r >= FUSION_SHOT_RADIUS;
      // Cover stops shots (or bounces them, with Bouncer). Fusion rounds plough through.
      const wall = fusionRound ? null : sim.segmentHitsObstacle(obstacles, prevX, prevY, p.x, p.y);
      if (wall) {
        if (p.ricochet > 0) {
          if (wall.shape === 'circle') {
            const nx0 = prevX - wall.x, ny0 = prevY - wall.y;
            const nl = Math.hypot(nx0, ny0) || 1;
            const nx = nx0 / nl, ny = ny0 / nl;
            const dot = p.vx * nx + p.vy * ny;
            p.vx -= 2 * dot * nx;
            p.vy -= 2 * dot * ny;
          } else if (Math.abs(p.vx) > Math.abs(p.vy)) p.vx *= -1;
          else p.vy *= -1;
          p.ricochet--;
          p.x = prevX;
          p.y = prevY;
        } else {
          dead.push(id);
          return;
        }
      }
      // Asteroids and mines take hits
      const hz = sim.hazardHitByShot(this.hw, p);
      if (hz) {
        if (!p.hitIds) p.hitIds = new Set();
        p.hitIds.add(hz);
        sim.damageHazard(this.hw, hz, p.damage, p.ownerId || true);
        if (!fusionRound) { dead.push(id); return; }
      }
      // Bouncer: player bullets reflect off the world edge.
      if (p.ricochet > 0 && p.life > 0) {
        if (p.x < 0 || p.x > WORLD_W) { p.vx *= -1; p.x = clamp(p.x, 0, WORLD_W); p.ricochet--; }
        else if (p.y < 0 || p.y > WORLD_H) { p.vy *= -1; p.y = clamp(p.y, 0, WORLD_H); p.ricochet--; }
      }
      if (p.life <= 0 || p.x < -50 || p.x > WORLD_W + 50 || p.y < -50 || p.y > WORLD_H + 50) {
        dead.push(id);
      }
    });
    for (const id of dead) this.state.projectiles.delete(id);
    // Burst shells pop into rings of shards
    for (const b of bursts) {
      sim.burstRing(b, (x, y, a, sp, c, o) => this.spawnEnemyShot(x, y, a, sp, c, o), this.bossRand);
      this.broadcast('fx', { type: 'burst', x: b.x, y: b.y, color: b.color, size: 12 });
    }
  }

  collisions(dt) {
    // Player bullets vs enemies
    const projDeath = new Set();
    const enemyDeath = new Set();
    const kill = (e, eId, killerSid) => {
      if (enemyDeath.has(eId)) return;
      enemyDeath.add(eId);
      this.onEnemyKilled(e, eId, killerSid, enemyDeath);
    };
    this.state.projectiles.forEach((proj, projId) => {
      if (proj.ownerType !== 'player' || projDeath.has(projId)) return;
      this.state.enemies.forEach((e, eId) => {
        if (projDeath.has(projId) || enemyDeath.has(eId) || e.intangible) return;
        const ai = this.enemyAI.get(eId);
        if (!this.shotHitsEnemy(proj, e, ai)) return;
        if (!proj.hitIds) proj.hitIds = new Set();
        if (proj.hitIds.has(eId)) return;
        proj.hitIds.add(eId);
        if (!this.damageEnemy(e, eId, proj.damage)) {
          // Shielded (Nexus): the shot splashes off
          if (proj.r < FUSION_SHOT_RADIUS) projDeath.add(projId);
          return;
        }
        if (proj.explosive) {
          // Payload: half damage to everything nearby.
          this.state.enemies.forEach((other, oId) => {
            if (other === e || enemyDeath.has(oId)) return;
            if (Math.hypot(other.x - proj.x, other.y - proj.y) < 60) {
              if (this.damageEnemy(other, oId, proj.damage * 0.5) && other.hp <= 0) kill(other, oId, proj.ownerId);
            }
          });
          this.broadcast('fx', { type: 'burst', x: proj.x, y: proj.y, color: '#ff2d95' });
        }
        if (e.hp <= 0) kill(e, eId, proj.ownerId);
        // Fusion rounds pierce everything; others pierce while they have charges.
        if (proj.r >= FUSION_SHOT_RADIUS) return;
        if (proj.pierce > 0) proj.pierce--;
        else projDeath.add(projId);
      });
    });
    for (const id of projDeath) this.state.projectiles.delete(id);
    for (const id of enemyDeath) {
      this.state.enemies.delete(id);
      this.enemyAI.delete(id);
    }

    // Fused ship: can't be hurt, and enemies that touch it are crushed.
    if (this.state.fusionTime > 0) {
      const driver = this.state.players.get(this.state.fusionDriver);
      if (driver) {
        const crushed = new Set();
        this.state.enemies.forEach((e, eId) => {
          if (e.intangible) return;
          const dx = driver.x - e.x, dy = driver.y - e.y;
          const rr = (28 + e.r);
          if (dx * dx + dy * dy >= rr * rr) return;
          this.damageEnemy(e, eId, FUSION_SHOT_DAMAGE * dt * 4);
          if (e.hp <= 0 && !crushed.has(eId)) {
            crushed.add(eId);
            this.onEnemyKilled(e, eId, this.state.fusionDriver, crushed);
          }
        });
        for (const id of crushed) {
          this.state.enemies.delete(id);
          this.enemyAI.delete(id);
        }
      }
      // Enemy bullets fizzle against the fused ship.
      return;
    }

    // Enemy bullets and enemy contact vs pilots
    const shotDeath = [];
    this.state.projectiles.forEach((proj, projId) => {
      if (proj.ownerType !== 'enemy') return;
      this.state.players.forEach((p, sid) => {
        if (p.dead || p.iframes > 0 || shotDeath.includes(projId)) return;
        const dx = p.x - proj.x, dy = p.y - proj.y;
        const rr = 10 + proj.r;
        if (dx * dx + dy * dy < rr * rr) {
          shotDeath.push(projId);
          this.hurtPlayer(p, sid);
        }
      });
    });
    for (const id of shotDeath) this.state.projectiles.delete(id);

    this.state.enemies.forEach((e, eId) => {
      if (e.intangible) return;
      const ai = this.enemyAI.get(eId);
      this.state.players.forEach((p, sid) => {
        if (p.dead || p.iframes > 0) return;
        const dx = p.x - e.x, dy = p.y - e.y;
        const rr = (10 + e.r);
        if (dx * dx + dy * dy < rr * rr) { this.hurtPlayer(p, sid); return; }
        // Multi-part bosses: every part is solid
        for (const pt of (ai && ai.parts) || []) {
          const px = p.x - pt.x, py = p.y - pt.y, pr = 10 + pt.r;
          if (px * px + py * py < pr * pr) { this.hurtPlayer(p, sid); return; }
        }
      });
    });
  }

  hurtPlayer(p, sid) {
    // The fused ship can't be hurt (hazards and beams included)
    if (p.dead || p.iframes > 0 || p.god || this.state.fusionTime > 0) return;
    // Royal's deflector soaks the hit, then recharges.
    if (p.shieldUp) {
      p.shieldUp = false;
      p.shieldCD = p.shieldMax;
      p.iframes = 0.6;
      this.broadcast('fx', { type: 'shieldBreak', x: p.x, y: p.y, sid });
      return;
    }
    p.hp -= 1;
    p.iframes = 1.0;
    if (p.hp <= 0) p.dead = true;
    this.broadcast('fx', { type: 'playerHit', x: p.x, y: p.y, sid });
  }

  // `dying` collects ids removed this tick, so chain kills (Deathwave,
  // splitters) never count an enemy twice.
  onEnemyKilled(e, eId, killerSid, dying) {
    const ai = this.enemyAI.get(eId);
    if (ai) ai.dead = true;
    const points = ai ? ai.score : 10;
    this.state.totalScore += points;
    const killer = killerSid ? this.state.players.get(killerSid) : null;
    if (killer) killer.score += points;

    const boss = isBoss(e.type);
    // The killer's wingmen meter charges while their squad is home
    if (killer && killer.wingTime <= 0) {
      killer.wingCharge = Math.min(1, killer.wingCharge + shared().wingmen.wingCharge(boss));
    }
    const cores =
      e.type === 'warden' ? 30 + Math.floor(Math.random() * 15) :
      boss ? 12 + Math.floor(Math.random() * 8) :
      ['bomber', 'lancer', 'splitter'].includes(e.type) ? 2 + (Math.random() < 0.3 ? 1 : 0) :
      1 + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < cores; i++) {
      this.spawnPickup(
        e.x + (Math.random() - 0.5) * 30,
        e.y + (Math.random() - 0.5) * 30
      );
    }
    // Client uses this to play explosion SFX + spawn particles.
    this.broadcast('fx', { type: 'enemyDeath', x: e.x, y: e.y, eType: e.type, r: e.r });
    if (boss && ai) this.bossCleanup(ai, dying);

    // Splitters break into two small grunts.
    if (e.type === 'splitter' && ai && ai.splitLeft > 0) {
      const diff = this.waveInfo ? this.waveInfo.diffMul : 1;
      for (let k = 0; k < ai.splitLeft; k++) {
        this.addEnemy('grunt', 0.5 * diff, diff,
          e.x + (Math.random() - 0.5) * 20, e.y + (Math.random() - 0.5) * 20);
      }
    }

    // Deathwave: the killer's kills damage everything nearby.
    if (killer && killer.shockwave) {
      this.broadcast('fx', { type: 'shockwave', x: e.x, y: e.y });
      this.state.enemies.forEach((other, oId) => {
        if (oId === eId || dying.has(oId)) return;
        if (Math.hypot(other.x - e.x, other.y - e.y) >= 120) return;
        this.damageEnemy(other, oId, 1);
        if (other.hp <= 0) {
          dying.add(oId);
          this.onEnemyKilled(other, oId, killerSid, dying);
        }
      });
    }

    this.addFusionCharge(boss ? FUSION_PER_BOSS_KILL : FUSION_PER_KILL);
  }

  spawnPickup(x, y) {
    const p = new Pickup();
    p.x = x; p.y = y; p.r = 8; p.value = 1;
    this.state.pickups.set(String(this.nextEntityId++), p);
  }

  collectPickups(dt) {
    // Cores drift toward the nearest pilot within their magnet range.
    this.state.pickups.forEach((pk) => {
      const p = this.nearestPilot(pk.x, pk.y);
      if (!p) return;
      const dx = p.x - pk.x, dy = p.y - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 140 * (p.magnetMul || 1)) return;
      const step = Math.min(d, 420 * dt);
      pk.x += (dx / d) * step;
      pk.y += (dy / d) * step;
    });
    const picked = [];
    this.state.pickups.forEach((pk, id) => {
      this.state.players.forEach((p) => {
        if (p.dead) return;
        const radius = 16 * (p.magnetMul || 1);
        const dx = pk.x - p.x, dy = pk.y - p.y;
        const rr = (radius + pk.r);
        if (dx * dx + dy * dy < rr * rr && !picked.includes(id)) {
          p.score += pk.value;
          this.state.totalScore += pk.value;
          picked.push(id);
          // Core Siphon: every 5 cores heals 1 HP.
          if (p.leech && ++p.coresSinceHeal >= 5) {
            p.coresSinceHeal = 0;
            if (p.hp < p.maxHp) p.hp += 1;
          }
        }
      });
    });
    for (const id of picked) this.state.pickups.delete(id);
  }

  checkGameOver() {
    if (this.state.gameOver || this.state.players.size === 0) return;
    let anyAlive = false;
    this.state.players.forEach((p) => { if (!p.dead) anyAlive = true; });
    if (!anyAlive) {
      this.state.gameOver = true;
      this.broadcast('gameEnd', {
        totalScore: this.state.totalScore,
        waveReached: this.state.waveNum
      });
    }
  }

  // ----------------------------------------------------------
  // Waves: same schedule and enemy unlocks as single player
  // ----------------------------------------------------------
  livingPilots() {
    let n = 0;
    this.state.players.forEach((p) => { if (!p.dead) n++; });
    return Math.max(1, n);
  }

  startWave(num) {
    this.state.waveNum = num;
    if (num > 1) {
      this.state.players.forEach((p) => {
        if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + 1);
      });
    }
    const info = getWaveInfo(num, this.livingPilots());
    this.waveInfo = info;
    this.setupSector(num, info);
    this.spawnQueue = [];
    if (info.kind === 'mega' || info.kind === 'mini') {
      this.spawnQueue.push({ type: info.bossType, delay: 0.6, scale: info.bossScale });
      this.broadcast('fx', { type: 'bossSpawn', eType: info.bossType, wave: num });
    } else {
      // Spawn cadence tightens with difficulty but never too fast.
      const baseDelay = Math.max(0.18, 0.65 - info.diffMul * 0.02);
      const jitter = 0.4 - Math.min(0.22, info.diffMul * 0.01);
      for (let i = 0; i < info.enemyCount; i++) {
        this.spawnQueue.push({
          type: info.types[Math.floor(Math.random() * info.types.length)],
          delay: baseDelay + Math.random() * jitter,
          scale: info.diffMul * info.hpMul
        });
      }
    }
    this.spawnTimer = 0;
    this.broadcast('fx', { type: 'waveStart', wave: num, kind: info.kind, name: info.name, bossType: info.bossType || '' });
  }

  // ----------------------------------------------------------
  // Sectors: cover, hazards and the hyperspace jump
  // ----------------------------------------------------------
  // Per-wave streams so a room's maps follow its seed.
  waveRng(num, salt) {
    return makeRng((this.state.seed ^ Math.imul(num + 1, 2654435761) ^ salt) >>> 0);
  }

  setupSector(num, info) {
    const { sim } = shared();
    this.state.sectorWave = num;
    this.hw.sector = info.sector;
    this.hazardRand = this.waveRng(num, 0x4a2a);
    this.bossRand = this.waveRng(num, 0xb055);
    this.clearBeams();
    // Regular waves get the sector's cover; boss waves and wave 1 stay open
    const cover = info.kind === 'regular' && num > 1
      ? sim.generateCover(info.sector, WORLD_W, WORLD_H, this.waveRng(num, 0xc0fe))
      : [];
    this.setObstacles(cover);
    sim.setupHazards(this.hw, num, info.kind !== 'regular');
    this.syncObstacles(); // after setupHazards: gates add their pylons
    // Nudge ships out of any cover they ended up inside
    this.state.players.forEach((p) => {
      if (p.dead) return;
      const at = sim.freeSpot(this.hw.obstacles, p.x, p.y, SHIP_R, WORLD_W, WORLD_H);
      p.x = at.x;
      p.y = at.y;
    });
    this.mirrorSpace();
  }

  setObstacles(list) {
    this.hw.obstacles = list;
    this.syncObstacles();
  }

  syncObstacles() {
    this.state.obstacles.clear();
    for (const o of this.hw.obstacles) {
      const s = new Obstacle();
      s.shape = o.shape;
      s.kind = o.kind;
      s.x = o.x;
      s.y = o.y;
      s.r = o.r || 0;
      s.w = o.w || 0;
      s.h = o.h || 0;
      s.spriteR = o.spriteR || 0;
      s.rot = o.rot || 0;
      s.spin = o.spin || 0;
      s.seed = o.seed || 0;
      s.noDraw = !!o.noDraw;
      this.state.obstacles.push(s);
    }
    this.state.mapId = (this.state.mapId + 1) % 30000;
  }

  // A jump: stars stretch for half of WARP_TIME, the sky swaps, the new
  // sector fades in, then its first wave starts. A new run arrives the
  // same way (arriveOnly skips the departure half). Clients draw it from
  // state.warpTime.
  beginWarp(toWave, arriveOnly = false) {
    this.warp = { t: arriveOnly ? WARP_TIME / 2 : 0, toWave, swapped: false };
    this.state.warpTime = WARP_TIME - this.warp.t;
    this.state.warpTo = toWave;
    this.clearBeams();
    const shots = [];
    this.state.projectiles.forEach((p, id) => { if (p.ownerType === 'enemy') shots.push(id); });
    for (const id of shots) this.state.projectiles.delete(id);
    if (arriveOnly) this.swapSector();
    this.mirrorSpace();
  }

  swapSector() {
    this.warp.swapped = true;
    this.state.sectorWave = this.warp.toWave;
    this.hw.hazards.length = 0;
    this.setObstacles([]);
    this.state.pickups.clear();
    // Everyone comes out of the jump together, in a small ring at the middle
    const living = [];
    this.state.players.forEach((p) => { if (!p.dead) living.push(p); });
    living.forEach((p, i) => {
      const a = (i / Math.max(1, living.length)) * Math.PI * 2;
      const rad = living.length > 1 ? 46 : 0;
      p.x = WORLD_W / 2 + Math.cos(a) * rad;
      p.y = WORLD_H / 2 + Math.sin(a) * rad;
    });
    this.mirrorSpace();
  }

  updateWarp(dt) {
    const w = this.warp;
    w.t += dt;
    this.state.warpTime = Math.max(0, WARP_TIME - w.t);
    if (!w.swapped && w.t >= WARP_TIME / 2) this.swapSector();
    if (w.t >= WARP_TIME) {
      this.warp = null;
      this.state.warpTime = 0;
      this.startWave(w.toWave);
    }
  }

  updateHazards(dt) {
    shared().sim.updateHazards(this.hw, dt);
  }

  // The "hazard world" shared/spaceSim.js plays in (see its header).
  makeHazardWorld() {
    const room = this;
    return {
      W: WORLD_W,
      H: WORLD_H,
      sector: null,
      hazards: [],
      obstacles: [],
      clock: {},
      wells: null,
      live: true,   // the sim pauses during upgrade picks, so hazards are always live here
      get diff() { return room.waveInfo ? room.waveInfo.diffMul : 1; },
      rand: () => room.hazardRand(),
      nextId: () => room.nextEntityId++,
      pilots: () => {
        const out = [];
        room.state.players.forEach((p) => { if (!p.dead) out.push(p); });
        return out;
      },
      hurt: (p) => room.hurtPlayer(p, p.sid),
      enemies: () => [...room.enemyAI.values()].filter((e) => !e.dead),
      isBoss: (e) => isBoss(e.type),
      hitEnemy: (e, amount) => room.hitEnemy(e, amount, null),
      enemyShots: () => {
        const out = [];
        room.state.projectiles.forEach((p) => { if (p.ownerType === 'enemy') out.push(p); });
        return out;
      },
      dropShots: (pred) => {
        const ids = [];
        room.state.projectiles.forEach((p, id) => { if (p.ownerType === 'enemy' && pred(p)) ids.push(id); });
        for (const id of ids) room.state.projectiles.delete(id);
      },
      rockBroken: (h, shooter, points, dropCore) => {
        room.state.totalScore += points;
        const killer = typeof shooter === 'string' ? room.state.players.get(shooter) : null;
        if (killer) killer.score += points;
        if (dropCore) room.spawnPickup(h.x, h.y);
      },
      fx: (type, h) => {
        if (type === 'debris') room.broadcast('fx', { type: 'rockBreak', x: h.x, y: h.y, r: h.r, rockKind: h.rockKind });
        else if (type === 'mine') room.broadcast('fx', { type: 'mineBlast', x: h.x, y: h.y, blast: h.blast });
        else if (type === 'strike') room.broadcast('fx', { type: 'strike', x: h.x, y: h.y });
        else if (type === 'flare') room.broadcast('fx', { type: 'shake', n: 6 });
        else if (type === 'wellGone') room.broadcast('fx', { type: 'wellGone', x: h.x, y: h.y });
      }
    };
  }

  // The game API the shared boss AI gets (see shared/bosses.js).
  makeBossApi() {
    const room = this;
    return {
      W: WORLD_W,
      H: WORLD_H,
      top: BOSS_TOP,
      get p() { return room.target; },
      get diff() { return room.waveInfo ? room.waveInfo.diffMul : 1; },
      rand: () => room.bossRand(),
      shoot: (x, y, a, speed, color, opts) => room.spawnEnemyShot(x, y, a, speed, color, opts),
      beam: (owner, opts) => room.addBeam(owner, opts),
      minion: (type, x, y, owner) => room.addMinion(type, x, y, owner),
      hazard: (kind, props) => shared().sim.spawnHazard(room.hw, kind, props),
      hazards: () => room.hw.hazards,
      alive: (e) => !!e && !e.dead,
      pull: (x, y, strength, reach, dt) => {
        room.state.players.forEach((p) => {
          if (!p.dead) shared().sim.pullShip(room.hw.obstacles, p, x, y, strength, reach, dt);
        });
      },
      explode: (x, y, color, size) => room.broadcast('fx', { type: 'burst', x, y, color, size }),
      shake: (n) => room.broadcast('fx', { type: 'shake', n }),
      sound: (name) => room.broadcast('fx', { type: 'sound', name })
    };
  }

  // An add brought in by a boss. Owned adds die with their boss.
  addMinion(type, x, y, owner) {
    const info = this.waveInfo;
    const diff = info ? info.diffMul : 1;
    const scale = type === 'node' ? (info?.bossScale || 1) * (1 + (diff - 1) * 0.25) : Math.max(0.5, diff * 0.5);
    return this.addEnemy(type, scale, diff * 0.6, x, y, owner);
  }

  // When a boss dies its adds die too, and its beams, mines, wells and
  // orbiting shots go with it.
  bossCleanup(ai, dying) {
    for (const [id, other] of this.enemyAI) {
      if (other.owner !== ai || other.dead || dying.has(id)) continue;
      const e = this.state.enemies.get(id);
      if (!e) continue;
      dying.add(id);
      this.onEnemyKilled(e, id, null, dying);
    }
    for (const b of this.beams) if (b.owner === ai) b.done = true;
    this.beams = this.beams.filter((b) => !b.done);
    for (const h of this.hw.hazards.slice()) {
      if (h.owner !== ai) continue;
      shared().sim.removeHazard(this.hw, h);
      // Flares have no position of their own
      this.broadcast('fx', { type: 'burst', x: h.x ?? ai.x, y: h.y ?? ai.y, color: '#ffffff', size: 10 });
    }
    const orbiting = [];
    this.state.projectiles.forEach((p, id) => { if (p.orbit && p.orbit.center === ai) orbiting.push(id); });
    for (const id of orbiting) this.state.projectiles.delete(id);
  }

  // ----------------------------------------------------------
  // Beams: telegraphed boss lasers. The owner aims them each tick.
  // ----------------------------------------------------------
  addBeam(owner, opts) {
    const b = {
      id: this.nextEntityId++,
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
    this.beams.push(b);
    return b;
  }

  clearBeams() {
    for (const b of this.beams) b.done = true;
    this.beams = [];
    this.state.beams.clear();
  }

  updateBeams(dt) {
    const { segDist } = shared().sim;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      if (b.owner && b.owner.dead) b.done = true;
      if (b.done) { this.beams.splice(i, 1); continue; }
      if (b.warn > 0) { b.warn -= dt; continue; }
      b.life -= dt;
      if (b.life <= 0) { b.done = true; this.beams.splice(i, 1); continue; }
      const x2 = b.x + Math.cos(b.angle) * b.len, y2 = b.y + Math.sin(b.angle) * b.len;
      this.state.players.forEach((p, sid) => {
        if (p.dead || p.iframes > 0) return;
        if (segDist(p.x, p.y, b.x, b.y, x2, y2) < b.hitWidth / 2 + SHIP_R * 0.7) this.hurtPlayer(p, sid);
      });
    }
  }

  // Copies the space sim (hazards, beams, boss art fields) into the synced
  // state. Runs once per tick.
  mirrorSpace() {
    const { bosses } = shared();
    const seen = new Set();
    for (const h of this.hw.hazards) {
      const key = String(h.id);
      seen.add(key);
      let s = this.state.hazards.get(key);
      if (!s) { s = new Hazard(); this.state.hazards.set(key, s); }
      for (const f of HAZARD_FIELDS.number) {
        const v = h[f];
        if (typeof v === 'number' && Number.isFinite(v) && s[f] !== v) s[f] = v;
      }
      for (const f of HAZARD_FIELDS.string) {
        const v = h[f];
        if (typeof v === 'string' && s[f] !== v) s[f] = v;
      }
    }
    for (const key of [...this.state.hazards.keys()]) if (!seen.has(key)) this.state.hazards.delete(key);

    seen.clear();
    for (const b of this.beams) {
      if (b.done) continue;
      const key = String(b.id);
      seen.add(key);
      let s = this.state.beams.get(key);
      if (!s) {
        s = new Beam();
        s.owner = b.owner && b.owner.id !== undefined ? String(b.owner.id) : '';
        s.color = b.color;
        s.warnMax = b.warnMax;
        this.state.beams.set(key, s);
      }
      s.x = b.x; s.y = b.y; s.angle = b.angle; s.len = b.len; s.width = b.width; s.warn = Math.max(0, b.warn);
    }
    for (const key of [...this.state.beams.keys()]) if (!seen.has(key)) this.state.beams.delete(key);

    this.state.enemies.forEach((e, id) => {
      const ai = this.enemyAI.get(id);
      if (!ai) return;
      const vals = bosses.packBossSync(ai);
      if (vals) syncNumbers(e.vals, vals);
      if (ai.parts) syncParts(e.parts, ai.parts);
      if (e.shielded !== !!ai.shielded) e.shielded = !!ai.shielded;
    });
  }

  updateSpawning(dt) {
    if (this.spawnQueue.length === 0) {
      // Wave cleared when the queue is empty and every enemy is dead.
      if (this.state.enemies.size === 0) this.startUpgradePhase();
      return;
    }
    this.spawnTimer += dt;
    while (this.spawnQueue.length > 0 && this.spawnTimer >= this.spawnQueue[0].delay) {
      const next = this.spawnQueue.shift();
      this.spawnTimer -= next.delay;
      this.addEnemy(next.type, next.scale, this.waveInfo ? this.waveInfo.diffMul : 1);
    }
  }

  // Creates an enemy (at a random edge, or at x/y when given) and its AI
  // state, which it returns. `owner` (an AI object) makes it a boss's add.
  addEnemy(type, scale, diffMul, x, y, owner) {
    if (!ENEMY_DEFS[type]) return null;
    const ai = makeEnemy(type, scale, diffMul, WORLD_W, WORLD_H);
    if (x !== undefined) { ai.x = x; ai.y = y; }
    const id = String(this.nextEntityId++);
    ai.id = id;
    ai.owner = owner || null;
    const e = new Enemy();
    e.type = type;
    e.x = ai.x;
    e.y = ai.y;
    e.hp = ai.hp;
    e.maxHp = ai.maxHp;
    e.r = ai.r;
    e.owner = owner ? String(owner.id) : '';
    this.state.enemies.set(id, e);
    this.enemyAI.set(id, ai);
    return ai;
  }

  // Enemy bullet. `opts` are the extras bosses use (kind, r, life, delay,
  // orbit, accel, turn, homing, grow, burst; see shared/spaceSim.js).
  spawnEnemyShot(x, y, angle, speed, color, opts) {
    if (this.state.projectiles.size >= ENEMY_SHOT_CAP) return null;
    const proj = new Projectile();
    proj.x = x;
    proj.y = y;
    proj.r = 5;
    proj.ownerType = 'enemy';
    proj.color = color;
    proj.vx = Math.cos(angle) * speed;
    proj.vy = Math.sin(angle) * speed;
    proj.life = 6;
    proj.age = 0;
    if (opts) for (const k of Object.keys(opts)) proj[k] = opts[k];
    proj.hold = proj.delay > 0 ? proj.delay : 0;
    this.state.projectiles.set(String(this.nextEntityId++), proj);
    return proj;
  }

  // Downed pilots come back once the wave is cleared, beside a living
  // teammate, with half their hull (the next wave adds +1 on top).
  reviveDowned() {
    const living = [];
    this.state.players.forEach((p) => { if (!p.dead) living.push(p); });
    if (living.length === 0) return;
    this.state.players.forEach((p, sid) => {
      if (!p.dead) return;
      const buddy = living[Math.floor(Math.random() * living.length)];
      const a = Math.random() * Math.PI * 2;
      const at = shared().sim.freeSpot(this.hw.obstacles,
        wrap(buddy.x + Math.cos(a) * 70, WORLD_W), wrap(buddy.y + Math.sin(a) * 70, WORLD_H), SHIP_R, WORLD_W, WORLD_H);
      p.x = at.x;
      p.y = at.y;
      p.dead = false;
      p.hp = Math.max(1, Math.ceil(p.maxHp / 2));
      p.iframes = 2;
      p.fireCD = 0;
      p.dashCD = 0;
      if (p.shieldMax) { p.shieldUp = true; p.shieldCD = 0; }
      this.broadcast('fx', { type: 'revive', sid, x: p.x, y: p.y, name: p.name });
    });
  }

  startUpgradePhase() {
    this.reviveDowned();
    const alive = [];
    this.state.players.forEach((p, sid) => { if (!p.dead) alive.push([p, sid]); });
    if (alive.length === 0) {
      // Should be unreachable — checkGameOver runs every tick — but be safe.
      this.startWave(this.state.waveNum + 1);
      return;
    }
    // Clear leftover enemy bullets so nobody gets hit coming out of the pick.
    const stray = [];
    this.state.projectiles.forEach((proj, id) => { if (proj.ownerType === 'enemy') stray.push(id); });
    for (const id of stray) this.state.projectiles.delete(id);
    this.upgradePhase = true;
    this.state.paused = true;
    for (const [p] of alive) {
      p.pickedUpgrade = false;
      p.pendingChoices = pickUpgradeChoices(p, this.state.waveNum);
    }
    // Send each alive player their per-player choices.
    this.clients.forEach((client) => {
      const p = this.state.players.get(client.sessionId);
      if (p && p.pendingChoices) {
        client.send('upgradeChoices', { choices: p.pendingChoices });
      }
    });
  }

  maybeEndUpgradePhase() {
    if (!this.upgradePhase) return;
    let allPicked = true;
    this.state.players.forEach((pl) => {
      if (!pl.dead && !pl.pickedUpgrade) allPicked = false;
    });
    if (allPicked) {
      this.upgradePhase = false;
      this.state.paused = false;
      this.broadcast('wavePhase');
      const next = this.state.waveNum + 1;
      // A boss closes out every sector, so the next one starts with a jump
      if (shared().sectors.sectorForWave(next).waveInSector === 0) this.beginWarp(next);
      else this.startWave(next);
    }
  }

  spawnPlayerProjectile(player, ownerId) {
    // Fork rounds spread the main shot plus extras evenly across a fixed fan:
    // the first pick fires straight / left / right, and each later pick packs
    // the same fan tighter (3 → 5 → 7 bullets). Matches Multi Shot in solo.
    const count = 1 + (player.extraShots || 0);
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      this.spawnProjectileAt(player, ownerId, player.angle + t * FORK_FAN);
    }
  }

  spawnFusionShot(player, ownerId) {
    const proj = new Projectile();
    proj.x = player.x + Math.cos(player.angle) * 30;
    proj.y = player.y + Math.sin(player.angle) * 30;
    proj.r = FUSION_SHOT_RADIUS;
    proj.ownerType = 'player';
    proj.ownerId = ownerId || '';
    proj.owner = player.slot;
    proj.vx = Math.cos(player.angle) * 520;
    proj.vy = Math.sin(player.angle) * 520;
    proj.life = 1.8;
    proj.damage = FUSION_SHOT_DAMAGE * (player.damageMul || 1);
    proj.hitIds = new Set();
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }

  spawnProjectileAt(player, ownerId, angle) {
    const proj = new Projectile();
    const speed = 600 * (player.shotSpeedMul || 1);
    proj.x = player.x;
    proj.y = player.y;
    proj.r = 4;
    proj.ownerType = 'player';
    proj.ownerId = ownerId || '';
    proj.owner = player.slot;
    proj.vx = Math.cos(angle) * speed;
    proj.vy = Math.sin(angle) * speed;
    proj.life = 1.5;
    proj.crit = Math.random() < (player.critChance || 0);
    proj.damage = (proj.crit ? 2 : 1) * (player.damageMul || 1);
    proj.pierce = player.pierce || 0;
    proj.homing = !!player.homing;
    proj.explosive = !!player.explosive;
    proj.ricochet = player.ricochet || 0;
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }
}

module.exports = { NeonDriftRoom, Player, Enemy, Projectile, Pickup, RoomState };
