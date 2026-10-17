const { Room } = require('colyseus');
const { Schema, MapSchema, type } = require('@colyseus/schema');

// ============================================================
// Server-authoritative dimensions. Clients render in their own
// canvas size and rescale incoming positions from this world.
// ============================================================
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
    // server-only:
    this.fireCD = 0;
    this.iframes = 0;
    this.damageMul = 1;
    this.magnetMul = 1;
    this.droneFireCD = 0;
    this.pickedUpgrade = false;
    this.pendingChoices = null;
  }
}
type('string')(Player.prototype, 'name');
type('boolean')(Player.prototype, 'ready');
type('boolean')(Player.prototype, 'isHost');
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

class Enemy extends Schema {
  constructor() {
    super();
    this.type = 'grunt';
    this.x = 0;
    this.y = 0;
    this.hp = 3;
    this.maxHp = 3;
    this.r = 14;
    // server-only:
    this.speed = 80;
  }
}
type('string')(Enemy.prototype, 'type');
type('float32')(Enemy.prototype, 'x');
type('float32')(Enemy.prototype, 'y');
type('int16')(Enemy.prototype, 'hp');
type('int16')(Enemy.prototype, 'maxHp');
type('float32')(Enemy.prototype, 'r');

class Projectile extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.r = 4;
    this.ownerType = 'player'; // 'player' | 'enemy'
    // server-only:
    this.vx = 0;
    this.vy = 0;
    this.life = 1.5;
    this.damage = 1;
    this.ownerId = ''; // sessionId of the player who fired (for score)
    this.hitIds = null; // fusion rounds pierce: enemies already hit
  }
}
type('float32')(Projectile.prototype, 'x');
type('float32')(Projectile.prototype, 'y');
type('float32')(Projectile.prototype, 'r');
type('string')(Projectile.prototype, 'ownerType');

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

// Upgrade pool — each pick is per-player. Stats stack across picks.
const UPGRADE_POOL = [
  { id: 'damage',    name: 'OVERCHARGE',      desc: '+20% damage' },
  { id: 'fireRate',  name: 'RAPID CYCLER',    desc: '+25% fire rate' },
  { id: 'maxHp',     name: 'REINFORCED HULL', desc: '+1 max HP (full heal)' },
  { id: 'speed',     name: 'PHASE DRIVE',     desc: '+15% move speed' },
  { id: 'magnet',    name: 'CORE MAGNET',     desc: '+60% pickup radius' },
  { id: 'drone',     name: 'ORBITAL DRONE',   desc: '+1 drone · auto-fires' },
  { id: 'multishot', name: 'FORK ROUNDS',     desc: '+2 bullets · wide fan, tighter each pick' }
];

function pickRandomUpgrades(n) {
  const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map((u) => ({ id: u.id, name: u.name, desc: u.desc }));
}

function applyUpgrade(player, choice) {
  switch (choice.id) {
    case 'damage':    player.damageMul   = (player.damageMul   || 1) + 0.20; break;
    case 'fireRate':  player.fireRateMul = (player.fireRateMul || 1) + 0.25; break;
    case 'maxHp':     player.maxHp += 1; player.hp = player.maxHp; break;
    case 'speed':     player.speedMul    = (player.speedMul    || 1) + 0.15; break;
    case 'magnet':    player.magnetMul   = (player.magnetMul   || 1) + 0.60; break;
    case 'drone':     player.droneCount  = (player.droneCount  || 0) + 1;    break;
    case 'multishot': player.extraShots  = (player.extraShots  || 0) + 2;    break;
  }
}

function isBossWave(num)   { return num > 0 && num % 5 === 0; }
function isWardenWave(num) { return num > 0 && num % 10 === 0; }

// ============================================================
// Room — lobby + authoritative simulation
// ============================================================

class NeonDriftRoom extends Room {
  onCreate(options) {
    this.maxClients = 4;
    this.setState(new RoomState());
    this.state.code = generateCode();
    this.setMetadata({ code: this.state.code });

    // 30Hz state patches keep ship/enemy motion smooth on clients.
    this.setPatchRate(1000 / TICK_HZ);

    this.playerInput = new Map(); // sessionId -> { moveX, moveY, aimAngle, firing }
    this.spawn = { active: false, remaining: 0, betweenSpawns: 0, boss: false };
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
      p.x = clamp(p.x + dx * 120, 12, WORLD_W - 12);
      p.y = clamp(p.y + dy * 120, 12, WORLD_H - 12);
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
    this.collectPickups();
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
        p.x = clamp(p.x + mx * speed * dt, 12, WORLD_W - 12);
        p.y = clamp(p.y + my * speed * dt, 12, WORLD_H - 12);
      }
      p.angle = inp.aimAngle;
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
    this.state.enemies.forEach((e) => {
      // Find nearest alive player
      let target = null;
      let bestDist = Infinity;
      this.state.players.forEach((p) => {
        if (p.dead) return;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < bestDist) { bestDist = d; target = p; }
      });
      if (!target) return;
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const mag = Math.hypot(dx, dy) || 1;
      if (e.type === 'weaver') {
        // Weaver moves toward target with a sinusoidal perpendicular wobble
        e.weaveT = (e.weaveT || 0) + dt;
        const px = -dy / mag, py = dx / mag;
        const wobble = Math.sin(e.weaveT * 4) * 60 * (e.weaveDir || 1);
        e.x += (dx / mag) * e.speed * dt + px * wobble * dt;
        e.y += (dy / mag) * e.speed * dt + py * wobble * dt;
      } else {
        e.x += (dx / mag) * e.speed * dt;
        e.y += (dy / mag) * e.speed * dt;
      }
    });
  }

  updateProjectiles(dt) {
    const dead = [];
    this.state.projectiles.forEach((p, id) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.x < -50 || p.x > WORLD_W + 50 || p.y < -50 || p.y > WORLD_H + 50) {
        dead.push(id);
      }
    });
    for (const id of dead) this.state.projectiles.delete(id);
  }

  collisions(dt) {
    // Player projectiles vs enemies
    const projDeath = new Set();
    const enemyDeath = new Set();
    this.state.projectiles.forEach((proj, projId) => {
      if (proj.ownerType !== 'player' || projDeath.has(projId)) return;
      this.state.enemies.forEach((e, eId) => {
        if (enemyDeath.has(eId)) return;
        const dx = proj.x - e.x, dy = proj.y - e.y;
        const rr = (proj.r + e.r);
        if (dx * dx + dy * dy < rr * rr) {
          if (proj.hitIds) {
            // Fusion rounds pierce: hit each enemy once and keep flying.
            if (proj.hitIds.has(eId)) return;
            proj.hitIds.add(eId);
          } else {
            projDeath.add(projId);
          }
          e.hp -= proj.damage;
          if (e.hp <= 0) {
            enemyDeath.add(eId);
            this.onEnemyKilled(e, proj.ownerId);
          }
        }
      });
    });
    for (const id of projDeath) this.state.projectiles.delete(id);
    for (const id of enemyDeath) this.state.enemies.delete(id);

    // Fused ship: can't be hurt, and enemies that touch it are crushed.
    if (this.state.fusionTime > 0) {
      const driver = this.state.players.get(this.state.fusionDriver);
      if (driver) {
        const crushed = [];
        this.state.enemies.forEach((e, eId) => {
          const dx = driver.x - e.x, dy = driver.y - e.y;
          const rr = (28 + e.r);
          if (dx * dx + dy * dy >= rr * rr) return;
          e.hp -= FUSION_SHOT_DAMAGE * dt * 4;
          if (e.hp <= 0) {
            crushed.push(eId);
            this.onEnemyKilled(e, this.state.fusionDriver);
          }
        });
        for (const id of crushed) this.state.enemies.delete(id);
      }
      return;
    }

    // Enemy contact damage to players
    this.state.enemies.forEach((e) => {
      this.state.players.forEach((p) => {
        if (p.dead || p.iframes > 0) return;
        const dx = p.x - e.x, dy = p.y - e.y;
        const rr = (10 + e.r);
        if (dx * dx + dy * dy < rr * rr) {
          p.hp -= 1;
          p.iframes = 1.0;
          if (p.hp <= 0) p.dead = true;
          this.broadcast('fx', { type: 'playerHit', x: p.x, y: p.y });
        }
      });
    });
  }

  onEnemyKilled(e, killerSid) {
    const points =
      e.type === 'warden'   ? 1000 :
      e.type === 'miniboss' ? 300  :
      e.type === 'weaver'   ? 30   :
      e.type === 'drifter'  ? 20   : 10;
    this.state.totalScore += points;
    if (killerSid) {
      const killer = this.state.players.get(killerSid);
      if (killer) killer.score += points;
    }
    const cores =
      e.type === 'warden'   ? 30 :
      e.type === 'miniboss' ? 8  :
      e.type === 'weaver'   ? 2  : 1;
    for (let i = 0; i < cores; i++) {
      this.spawnPickup(
        e.x + (Math.random() - 0.5) * 30,
        e.y + (Math.random() - 0.5) * 30
      );
    }
    // Client uses this to play explosion SFX + spawn particles.
    this.broadcast('fx', { type: 'enemyDeath', x: e.x, y: e.y, eType: e.type });
    const boss = e.type === 'warden' || e.type === 'miniboss';
    this.addFusionCharge(boss ? FUSION_PER_BOSS_KILL : FUSION_PER_KILL);
  }

  spawnPickup(x, y) {
    const p = new Pickup();
    p.x = x; p.y = y; p.r = 8; p.value = 1;
    this.state.pickups.set(String(this.nextEntityId++), p);
  }

  collectPickups() {
    const picked = [];
    this.state.pickups.forEach((pk, id) => {
      this.state.players.forEach((p) => {
        if (p.dead) return;
        const radius = 16 * (p.magnetMul || 1);
        const dx = pk.x - p.x, dy = pk.y - p.y;
        const rr = (radius + pk.r);
        if (dx * dx + dy * dy < rr * rr) {
          p.score += pk.value;
          this.state.totalScore += pk.value;
          picked.push(id);
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
  // Wave spawning (simplified for 8c session 1)
  // ----------------------------------------------------------
  startWave(num) {
    this.state.waveNum = num;
    if (num > 1) {
      this.state.players.forEach((p) => {
        if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + 1);
      });
    }
    if (isBossWave(num)) {
      // Boss waves spawn one tougher enemy. No swarm.
      this.spawn = { active: true, remaining: 1, betweenSpawns: 0, boss: true };
    } else {
      const count = 5 + num * 2;
      this.spawn = { active: true, remaining: count, betweenSpawns: 0, boss: false };
    }
  }

  pickEnemyType(num) {
    if (num < 3) return 'grunt';
    const r = Math.random();
    if (num >= 5) {
      if (r < 0.4) return 'grunt';
      if (r < 0.75) return 'drifter';
      return 'weaver';
    }
    return r < 0.6 ? 'grunt' : 'drifter';
  }

  updateSpawning(dt) {
    if (!this.spawn.active) {
      // Wave cleared when all enemies are dead AND we're not actively spawning
      if (this.state.enemies.size === 0) {
        this.startUpgradePhase();
      }
      return;
    }
    this.spawn.betweenSpawns -= dt;
    while (this.spawn.betweenSpawns <= 0 && this.spawn.remaining > 0) {
      this.spawnEnemy();
      this.spawn.remaining--;
      this.spawn.betweenSpawns += 0.6;
    }
    if (this.spawn.remaining === 0) {
      this.spawn.active = false;
    }
  }

  startUpgradePhase() {
    const alive = [];
    this.state.players.forEach((p, sid) => { if (!p.dead) alive.push([p, sid]); });
    if (alive.length === 0) {
      // Should be unreachable — checkGameOver runs every tick — but be safe.
      this.startWave(this.state.waveNum + 1);
      return;
    }
    this.upgradePhase = true;
    for (const [p] of alive) {
      p.pickedUpgrade = false;
      p.pendingChoices = pickRandomUpgrades(3);
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

  spawnEnemy() {
    const e = new Enemy();
    if (this.spawn.boss) {
      // Boss waves: warden every 10, miniboss otherwise.
      if (isWardenWave(this.state.waveNum)) {
        e.type = 'warden';
        e.maxHp = 200 + this.state.waveNum * 12;
        e.speed = 50;
        e.r = 36;
      } else {
        e.type = 'miniboss';
        e.maxHp = 60 + this.state.waveNum * 8;
        e.speed = 60;
        e.r = 24;
      }
      e.hp = e.maxHp;
      // Bosses enter from top center for drama.
      e.x = WORLD_W / 2;
      e.y = -50;
      this.state.enemies.set(String(this.nextEntityId++), e);
      this.broadcast('fx', { type: 'bossSpawn', eType: e.type, wave: this.state.waveNum });
      return;
    }
    e.type = this.pickEnemyType(this.state.waveNum);
    if (e.type === 'drifter') {
      e.maxHp = 2 + this.state.waveNum;
      e.speed = 110 + this.state.waveNum * 5;
      e.r = 12;
    } else if (e.type === 'weaver') {
      e.maxHp = 2 + this.state.waveNum;
      e.speed = 95 + this.state.waveNum * 4;
      e.r = 13;
      e.weaveT = 0;
      e.weaveDir = Math.random() > 0.5 ? 1 : -1;
    } else {
      e.maxHp = 3 + this.state.waveNum;
      e.speed = 70 + this.state.waveNum * 4;
      e.r = 14;
    }
    e.hp = e.maxHp;
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { e.x = Math.random() * WORLD_W; e.y = -30; }
    else if (side === 1) { e.x = WORLD_W + 30; e.y = Math.random() * WORLD_H; }
    else if (side === 2) { e.x = Math.random() * WORLD_W; e.y = WORLD_H + 30; }
    else { e.x = -30; e.y = Math.random() * WORLD_H; }
    this.state.enemies.set(String(this.nextEntityId++), e);
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
    proj.vx = Math.cos(player.angle) * 520;
    proj.vy = Math.sin(player.angle) * 520;
    proj.life = 1.8;
    proj.damage = FUSION_SHOT_DAMAGE * (player.damageMul || 1);
    proj.hitIds = new Set();
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }

  spawnProjectileAt(player, ownerId, angle) {
    const proj = new Projectile();
    proj.x = player.x;
    proj.y = player.y;
    proj.r = 4;
    proj.ownerType = 'player';
    proj.ownerId = ownerId || '';
    proj.vx = Math.cos(angle) * 600;
    proj.vy = Math.sin(angle) * 600;
    proj.life = 1.5;
    proj.damage = 1 * (player.damageMul || 1);
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }
}

module.exports = { NeonDriftRoom, Player, Enemy, Projectile, Pickup, RoomState };
