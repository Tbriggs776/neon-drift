const { Room } = require('colyseus');
const { Schema, MapSchema, type } = require('@colyseus/schema');
const { ENEMY_DEFS, isBoss, getWaveInfo, makeEnemy, updateEnemyAI } = require('./enemies');

// ============================================================
// Server-authoritative dimensions. Clients render in their own
// canvas size and rescale incoming positions from this world.
// ============================================================
const MAX_PILOTS = 5;
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
    // Color slot 0..MAX_PILOTS-1, fixed for the session so every screen
    // shows the same pilot in the same color.
    this.slot = 0;
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
    // Last input sequence number applied, so the client can reconcile its
    // predicted position against the right moment.
    this.ack = 0;
    // server-only:
    this.fireCD = 0;
    this.iframes = 0;
    this.damageMul = 1;
    this.magnetMul = 1;
    this.droneFireCD = 0;
    this.pickedUpgrade = false;
    this.pendingChoices = null;
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
}
type('string')(Player.prototype, 'name');
type('boolean')(Player.prototype, 'ready');
type('boolean')(Player.prototype, 'isHost');
type('int8')(Player.prototype, 'slot');
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
type('uint32')(Player.prototype, 'ack');

// Synced fields are what the client needs to draw the single-player art:
// angle (lancer aim), phase (warden), charge (lancer wind-up) and
// intangible (phantom blink). AI state from makeEnemy() is server-only.
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
    this.players = new MapSchema();
    this.enemies = new MapSchema();
    this.projectiles = new MapSchema();
    this.pickups = new MapSchema();
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

    this.onMessage('setName', (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.name = String(name || '').slice(0, 20);
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
      if (!this.state.started || this.state.gameOver || this.upgradePhase) return;
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
      p.x = wrap(p.x + dx * 120, WORLD_W);
      p.y = wrap(p.y + dy * 120, WORLD_H);
      p.iframes = 0.35;
      p.dashCD = 1.0;
      this.broadcast('fx', { type: 'dash', x: p.x, y: p.y });
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
        pl.pickedUpgrade = false;
        pl.pendingChoices = null;
        resetRunStats(pl);
      });
      this.upgradePhase = false;
      this.startWave(1);
      this.broadcast('gameStart', { seed: this.state.seed });
      this.lock();
      // Begin the simulation loop now that the run has started.
      this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
    });
  }

  onJoin(client, options) {
    const player = new Player();
    player.name = (options && options.name)
      ? String(options.name).slice(0, 20)
      : 'Pilot';
    player.isHost = this.state.players.size === 0;
    const taken = new Set();
    this.state.players.forEach((p) => taken.add(p.slot));
    for (let i = 0; i < MAX_PILOTS; i++) {
      if (!taken.has(i)) { player.slot = i; break; }
    }
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    const wasHost = this.state.players.get(client.sessionId)?.isHost || false;
    this.state.players.delete(client.sessionId);
    this.playerInput.delete(client.sessionId);
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
    this.simTime = (this.simTime || 0) + dt;
    this.updateFusion(dt);
    this.updatePlayers(dt);
    this.updateDrones(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.collisions(dt);
    this.collectPickups(dt);
    this.updateSpawning(dt);
    this.checkGameOver();
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
      if (p.dead) return;
      const inp = this.playerInput.get(sid);
      if (!inp) return;
      // Movement (with speed upgrade). While fused only the driver steers.
      if (!fused || sid === this.state.fusionDriver) {
        let mx = inp.moveX, my = inp.moveY;
        const mag = Math.hypot(mx, my);
        if (mag > 1) { mx /= mag; my /= mag; }
        const speed = BASE_SPEED * (p.speedMul || 1);
        p.x = wrap(p.x + mx * speed * dt, WORLD_W);
        p.y = wrap(p.y + my * speed * dt, WORLD_H);
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
    const fx = {
      shoot: (x, y, angle, speed, color) => this.spawnEnemyShot(x, y, angle, speed, color),
      spawnAdds: (hive) => {
        if (this.state.enemies.size >= 40) return;
        for (let k = 0; k < 2; k++) {
          this.addEnemy('grunt', 0.5, this.waveInfo ? this.waveInfo.diffMul * 0.6 : 1,
            hive.x + (Math.random() - 0.5) * 40, hive.y + (Math.random() - 0.5) * 40);
        }
        this.broadcast('fx', { type: 'burst', x: hive.x, y: hive.y, color: '#39ff14' });
      }
    };
    this.state.enemies.forEach((e, id) => {
      const ai = this.enemyAI.get(id);
      if (!ai) return;
      const target = this.nearestPilot(ai.x, ai.y);
      if (!target) return;
      updateEnemyAI(ai, target, dt, WORLD_W, WORLD_H, fx);
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

  // Keeps the synced HP and the AI copy in step.
  damageEnemy(e, id, amount) {
    e.hp -= amount;
    const ai = this.enemyAI.get(id);
    if (ai) ai.hp = e.hp;
  }

  updateProjectiles(dt) {
    const dead = [];
    this.state.projectiles.forEach((p, id) => {
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
        const dx = proj.x - e.x, dy = proj.y - e.y;
        const rr = (proj.r + e.r);
        if (dx * dx + dy * dy >= rr * rr) return;
        if (!proj.hitIds) proj.hitIds = new Set();
        if (proj.hitIds.has(eId)) return;
        proj.hitIds.add(eId);
        this.damageEnemy(e, eId, proj.damage);
        if (proj.explosive) {
          // Payload: half damage to everything nearby.
          this.state.enemies.forEach((other, oId) => {
            if (other === e || enemyDeath.has(oId)) return;
            if (Math.hypot(other.x - proj.x, other.y - proj.y) < 60) {
              this.damageEnemy(other, oId, proj.damage * 0.5);
              if (other.hp <= 0) kill(other, oId, proj.ownerId);
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

    this.state.enemies.forEach((e) => {
      if (e.intangible) return;
      this.state.players.forEach((p, sid) => {
        if (p.dead || p.iframes > 0) return;
        const dx = p.x - e.x, dy = p.y - e.y;
        const rr = (10 + e.r);
        if (dx * dx + dy * dy < rr * rr) this.hurtPlayer(p, sid);
      });
    });
  }

  hurtPlayer(p, sid) {
    p.hp -= 1;
    p.iframes = 1.0;
    if (p.hp <= 0) p.dead = true;
    this.broadcast('fx', { type: 'playerHit', x: p.x, y: p.y, sid });
  }

  // `dying` collects ids removed this tick, so chain kills (Deathwave,
  // splitters) never count an enemy twice.
  onEnemyKilled(e, eId, killerSid, dying) {
    const ai = this.enemyAI.get(eId);
    const points = ai ? ai.score : 10;
    this.state.totalScore += points;
    const killer = killerSid ? this.state.players.get(killerSid) : null;
    if (killer) killer.score += points;

    const boss = isBoss(e.type);
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
    this.broadcast('fx', { type: 'enemyDeath', x: e.x, y: e.y, eType: e.type });

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
    this.broadcast('fx', { type: 'waveStart', wave: num, kind: info.kind, name: info.name });
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

  // Creates an enemy (at a random edge, or at x/y when given) and its AI state.
  addEnemy(type, scale, diffMul, x, y) {
    if (!ENEMY_DEFS[type]) return;
    const ai = makeEnemy(type, scale, diffMul, WORLD_W, WORLD_H);
    if (x !== undefined) { ai.x = x; ai.y = y; }
    const e = new Enemy();
    e.type = type;
    e.x = ai.x;
    e.y = ai.y;
    e.hp = ai.hp;
    e.maxHp = ai.maxHp;
    e.r = ai.r;
    const id = String(this.nextEntityId++);
    this.state.enemies.set(id, e);
    this.enemyAI.set(id, ai);
  }

  spawnEnemyShot(x, y, angle, speed, color) {
    const proj = new Projectile();
    proj.x = x;
    proj.y = y;
    proj.r = 5;
    proj.ownerType = 'enemy';
    proj.color = color;
    proj.vx = Math.cos(angle) * speed;
    proj.vy = Math.sin(angle) * speed;
    proj.life = 6;
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }

  startUpgradePhase() {
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
      this.broadcast('wavePhase');
      this.startWave(this.state.waveNum + 1);
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
