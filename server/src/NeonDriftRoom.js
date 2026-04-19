const { Room } = require('colyseus');
const { Schema, MapSchema, type } = require('@colyseus/schema');

// ============================================================
// Server-authoritative dimensions. Clients render in their own
// canvas size and rescale incoming positions from this world.
// ============================================================
const WORLD_W = 1280;
const WORLD_H = 720;
const TICK_HZ = 30;

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
    // server-only:
    this.fireCD = 0;
    this.iframes = 0;
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
    this.spawn = { active: false, remaining: 0, betweenSpawns: 0 };
    this.nextEntityId = 1;

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
      // Reset gameplay state for the run.
      this.state.enemies.clear();
      this.state.projectiles.clear();
      this.state.pickups.clear();
      this.state.players.forEach((pl) => {
        pl.x = WORLD_W / 2 + (Math.random() - 0.5) * 80;
        pl.y = WORLD_H / 2 + (Math.random() - 0.5) * 80;
        pl.hp = pl.maxHp;
        pl.dead = false;
        pl.iframes = 0;
        pl.fireCD = 0;
        pl.score = 0;
      });
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
  }

  // ----------------------------------------------------------
  // Simulation tick (30Hz)
  // ----------------------------------------------------------
  tick(dt) {
    if (!this.state.started || this.state.gameOver) return;
    this.updatePlayers(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.collisions(dt);
    this.collectPickups();
    this.updateSpawning(dt);
    this.checkGameOver();
  }

  updatePlayers(dt) {
    const SPEED = 240;
    this.state.players.forEach((p, sid) => {
      if (p.iframes > 0) p.iframes = Math.max(0, p.iframes - dt);
      p.fireCD = Math.max(0, (p.fireCD || 0) - dt);
      if (p.dead) return;
      const inp = this.playerInput.get(sid);
      if (!inp) return;
      // Movement
      let mx = inp.moveX, my = inp.moveY;
      const mag = Math.hypot(mx, my);
      if (mag > 1) { mx /= mag; my /= mag; }
      p.x = clamp(p.x + mx * SPEED * dt, 12, WORLD_W - 12);
      p.y = clamp(p.y + my * SPEED * dt, 12, WORLD_H - 12);
      p.angle = inp.aimAngle;
      // Fire
      if (inp.firing && p.fireCD <= 0) {
        p.fireCD = 0.15;
        this.spawnPlayerProjectile(p, sid);
      }
    });
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
          e.hp -= proj.damage;
          projDeath.add(projId);
          if (e.hp <= 0) {
            enemyDeath.add(eId);
            this.onEnemyKilled(e, proj.ownerId);
          }
        }
      });
    });
    for (const id of projDeath) this.state.projectiles.delete(id);
    for (const id of enemyDeath) this.state.enemies.delete(id);

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
        }
      });
    });
  }

  onEnemyKilled(e, killerSid) {
    const points = e.type === 'weaver' ? 30 : e.type === 'drifter' ? 20 : 10;
    this.state.totalScore += points;
    if (killerSid) {
      const killer = this.state.players.get(killerSid);
      if (killer) killer.score += points;
    }
    // Drop a core (occasionally two for tougher enemies)
    const cores = e.type === 'weaver' ? 2 : 1;
    for (let i = 0; i < cores; i++) {
      this.spawnPickup(
        e.x + (Math.random() - 0.5) * 20,
        e.y + (Math.random() - 0.5) * 20
      );
    }
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
        const dx = pk.x - p.x, dy = pk.y - p.y;
        const rr = (16 + pk.r);
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
    // Auto-heal +1 HP between waves (capped at maxHp). Skipped on wave 1.
    if (num > 1) {
      this.state.players.forEach((p) => {
        if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + 1);
      });
    }
    const count = 5 + num * 2;
    this.spawn = { active: true, remaining: count, betweenSpawns: 0 };
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
      // Wave clear when all enemies are dead AND we're not actively spawning
      if (this.state.enemies.size === 0) {
        this.startWave(this.state.waveNum + 1);
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

  spawnEnemy() {
    const e = new Enemy();
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
    const proj = new Projectile();
    proj.x = player.x;
    proj.y = player.y;
    proj.r = 4;
    proj.ownerType = 'player';
    proj.ownerId = ownerId || '';
    proj.vx = Math.cos(player.angle) * 600;
    proj.vy = Math.sin(player.angle) * 600;
    proj.life = 1.5;
    proj.damage = 1;
    this.state.projectiles.set(String(this.nextEntityId++), proj);
  }
}

module.exports = { NeonDriftRoom, Player, Enemy, Projectile, Pickup, RoomState };
