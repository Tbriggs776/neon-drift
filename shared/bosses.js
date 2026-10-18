// ============================================================
// SPACE BOSSES: stats and attack patterns
// ============================================================
// Twelve sector bosses that join the original five (Obelisk, Hive,
// Sentinel, Prism, Warden). Each one guards a sector in sectors.js.
//
// Shared by single player (src/game.js) and the multiplayer server
// (server/src/NeonDriftRoom.js), so co-op fights the exact same bosses.
// The AI functions get the boss `e` and a small game API `g`, so this file
// never reaches into either game directly:
//   g.W, g.H, g.p (the pilot this boss is after), g.rand(), g.diff
//   g.top                                      highest y a boss should sit at (below the HUD)
//   g.shoot(x, y, angle, speed, color, opts)   enemy bullet (see enemyShoot)
//   g.beam(e, opts)                            telegraphed laser, owned by e; hits every pilot
//   g.minion(type, x, y, e)                    spawn an add owned by e
//   g.hazard(kind, props)                      spawn a sector hazard (spaceSim.js)
//   g.alive(enemy), g.hazards()                lookups
//   g.pull(x, y, strength, reach, dt)          gravity on every pilot
//   g.explode(x, y, color, size), g.shake(n), g.sound(name)
//
// Multi-part bosses fill e.parts with { x, y, r } circles (plus `a`, an aim
// angle, on turrets). Parts take hits (damage goes to the shared HP pool)
// and hurt pilots on contact. e.shielded makes the boss shrug off all
// damage (Nexus).
// ============================================================

export const SPACE_BOSS_DEFS = {
  colossus:    { hp: 50, speed: 35,  r: 46, color: '#ffb347', score: 300, ai: 'colossus',    fireRate: 1.5 },
  glacier:     { hp: 45, speed: 90,  r: 30, color: '#8ff0ff', score: 300, ai: 'glacier',     fireRate: 0.9 },
  helios:      { hp: 55, speed: 40,  r: 40, color: '#ffd23f', score: 320, ai: 'helios',      fireRate: 1.7 },
  arachne:     { hp: 50, speed: 80,  r: 30, color: '#39ff14', score: 320, ai: 'arachne',     fireRate: 1.3 },
  pulsar:      { hp: 50, speed: 30,  r: 24, color: '#5ac8fa', score: 340, ai: 'pulsar',      fireRate: 1.4 },
  binary:      { hp: 55, speed: 40,  r: 14, color: '#ffd23f', score: 340, ai: 'binary',      fireRate: 1.1 },
  leviathan:   { hp: 60, speed: 150, r: 24, color: '#3affd8', score: 360, ai: 'leviathan',   fireRate: 2.2 },
  carrier:     { hp: 60, speed: 40,  r: 50, color: '#ff9f1a', score: 360, ai: 'carrier',     fireRate: 1.3 },
  kraken:      { hp: 60, speed: 60,  r: 36, color: '#7aff6a', score: 380, ai: 'kraken',      fireRate: 2.4 },
  dreadnought: { hp: 65, speed: 40,  r: 50, color: '#ff3860', score: 400, ai: 'dreadnought', fireRate: 0.4 },
  nexus:       { hp: 50, speed: 30,  r: 30, color: '#00f0ff', score: 400, ai: 'nexus',       fireRate: 1.0 },
  singularity: { hp: 60, speed: 25,  r: 36, color: '#b847ff', score: 420, ai: 'singularity', fireRate: 0.5 }
};

// Adds that bosses bring with them.
export const MINION_DEFS = {
  fighter: { hp: 2, speed: 210, r: 9,  color: '#ff9f1a', score: 20, ai: 'fighter', fireRate: 1.6 },
  node:    { hp: 7, speed: 0,   r: 13, color: '#00f0ff', score: 30, ai: 'node',    fireRate: 2.4 }
};

// Shown under the boss name when it arrives.
export const BOSS_TITLES = {
  obelisk: 'The Silent Spire',
  hive: 'Mother of the Swarm',
  sentinel: 'The Iron Watch',
  prism: 'Refraction Engine',
  warden: 'Keeper of the Gate',
  colossus: 'The Living Rock',
  glacier: 'Comet of the Long Dark',
  helios: 'A Star With a Grudge',
  arachne: 'The Minelayer',
  pulsar: 'The Lighthouse',
  binary: 'Twin Fires',
  leviathan: 'Serpent of the Void',
  carrier: 'Mothership',
  kraken: 'Arms of the Nebula',
  dreadnought: 'Flagship of the Fleet',
  nexus: 'The Machine Mind',
  singularity: 'The End of Light'
};

// Multiplayer sends these fields for each boss on top of position and HP,
// so every screen draws the same art (src/bossArt.js reads them). Values
// travel as floats; `enc` lists the strings or booleans a field can hold.
export const BOSS_SYNC = {
  colossus: ['rot'],
  glacier: [{ key: 'mode', enc: ['hover', 'aim', 'charge'] }, 'chargeAng', 'vx', 'vy'],
  helios: ['spin'],
  arachne: ['vx', 'vy', 'legPhase', 'detFlash'],
  pulsar: ['beamAng'],
  binary: ['orbitR'],
  leviathan: ['heading', 'lunge'],
  carrier: [],
  kraken: ['t', 'spin', 'slamArm', 'slamT', 'slamAng'],
  dreadnought: ['turret'],
  nexus: [{ key: 'fenceState', enc: ['off', 'warn', 'on'] }, 'shieldHit'],
  singularity: ['spin'],
  fighter: [],
  node: []
};

export function packBossSync(e) {
  const spec = BOSS_SYNC[e.ai];
  if (!spec) return null;
  return spec.map((f) => {
    if (typeof f === 'string') return Number(e[f]) || 0;
    const i = f.enc.indexOf(e[f.key]);
    return i < 0 ? 0 : i;
  });
}

export function unpackBossSync(type, vals, into) {
  const spec = BOSS_SYNC[type];
  if (!spec || !vals) return;
  spec.forEach((f, i) => {
    if (typeof f === 'string') into[f] = vals[i] ?? 0;
    else into[f.key] = f.enc[vals[i] | 0];
  });
}

const TAU = Math.PI * 2;

function aim(e, g) { return Math.atan2(g.p.y - e.y, g.p.x - e.x); }
function dist(e, g) { return Math.hypot(g.p.x - e.x, g.p.y - e.y); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function hoverTo(e, tx, ty, k, maxSpeed) {
  e.vx = (tx - e.x) * k;
  e.vy = (ty - e.y) * k;
  const s = Math.hypot(e.vx, e.vy);
  if (maxSpeed && s > maxSpeed) { e.vx *= maxSpeed / s; e.vy *= maxSpeed / s; }
}

function ring(g, x, y, n, speed, color, offset = 0, opts) {
  for (let k = 0; k < n; k++) g.shoot(x, y, offset + (k / n) * TAU, speed, color, opts);
}

function fan(g, x, y, ang, n, spread, speed, color, opts) {
  for (let k = 0; k < n; k++) {
    const a = n > 1 ? ang + (k / (n - 1) - 0.5) * spread : ang;
    g.shoot(x, y, a, speed, color, opts);
  }
}

// Bosses spawn above the screen; hold fire until they're on stage.
function onStage(e, g) { return e.y > 20 && e.y < g.H - 20 && e.x > 20 && e.x < g.W - 20; }

// ------------------------------------------------------------
// COLOSSUS: a walking asteroid. Hurls boulders that burst into
// shards, sprays rock rings, and calves real asteroids when cracked.
// ------------------------------------------------------------
function colossus(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  e.rot = (e.rot || 0) + dt * (enraged ? 0.45 : 0.25);
  const tx = clamp(g.p.x, g.W * 0.2, g.W * 0.8);
  const ty = clamp(g.p.y - 230, g.top + e.r * 1.6, Math.max(g.top + e.r * 1.6, g.H * 0.4));
  hoverTo(e, tx, ty, 0.6, e.baseSpeed * 1.6);
  e.fireCD -= dt;
  if (e.fireCD <= 0 && onStage(e, g)) {
    e.cycle = (e.cycle || 0) + 1;
    const step = e.cycle % 3;
    const a = aim(e, g);
    if (step === 0) {
      const n = enraged ? 3 : 2;
      for (let k = 0; k < n; k++) {
        g.shoot(e.x, e.y, a + (k - (n - 1) / 2) * 0.42, 250, '#ffb347', {
          kind: 'rock', r: 11, accel: -180, minSpeed: 20, life: 1.35,
          burst: { count: enraged ? 10 : 8, speed: 170, color: '#ffcf8a', kind: 'shard' }
        });
      }
    } else if (step === 1) {
      ring(g, e.x, e.y, enraged ? 20 : 14, 185, '#ffcf8a', e.rot, { kind: 'shard' });
    } else if (enraged) {
      // Calving: chunks break off and become real drifting asteroids
      for (let k = -1; k <= 1; k += 2) {
        const ca = a + k * 0.8;
        g.hazard('rock', { x: e.x + Math.cos(ca) * e.r, y: e.y + Math.sin(ca) * e.r, tier: 2, vx: Math.cos(ca) * 90, vy: Math.sin(ca) * 90, owner: null });
      }
      g.shake(8);
      g.explode(e.x, e.y, '#ffb347', 30);
    } else {
      fan(g, e.x, e.y, a, 5, 0.6, 270, '#ffcf8a', { kind: 'shard' });
    }
    e.fireCD = enraged ? 1.1 : 1.5;
  }
}

// ------------------------------------------------------------
// GLACIER: an ice comet that circles, takes aim, then rams across
// the arena leaving a trail of shards that fan out a moment later.
// ------------------------------------------------------------
function glacier(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  e.mode = e.mode || 'hover';
  e.modeT = (e.modeT || 0) + dt;
  if (e.mode === 'hover') {
    const d = dist(e, g) || 1;
    const a = aim(e, g);
    const want = 290;
    const tang = a + Math.PI / 2;
    const radial = (d - want) / want;
    e.vx = (Math.cos(a) * radial * 1.4 + Math.cos(tang) * 0.8) * e.baseSpeed * 1.6;
    e.vy = (Math.sin(a) * radial * 1.4 + Math.sin(tang) * 0.8) * e.baseSpeed * 1.6;
    if (e.y < g.H * 0.12) e.vy = Math.abs(e.vy) + 60;
    e.fireCD -= dt;
    if (e.fireCD <= 0 && onStage(e, g)) {
      fan(g, e.x, e.y, a, 3, 0.3, 280, '#bff4ff', { kind: 'ice' });
      e.fireCD = enraged ? 0.7 : 0.9;
    }
    if (e.modeT > (enraged ? 2.4 : 3.2) && onStage(e, g)) {
      e.mode = 'aim'; e.modeT = 0;
      e.chain = enraged ? 2 : 1;
      e.chargeAng = a;
    }
  } else if (e.mode === 'aim') {
    // Wind up, tracking the player for most of it, then lock
    e.vx *= 0.85; e.vy *= 0.85;
    if (e.modeT < 0.55) e.chargeAng = aim(e, g);
    if (e.modeT > 0.9) { e.mode = 'charge'; e.modeT = 0; e.trailCD = 0; }
  } else if (e.mode === 'charge') {
    const sp = 720;
    e.vx = Math.cos(e.chargeAng) * sp;
    e.vy = Math.sin(e.chargeAng) * sp;
    e.trailCD -= dt;
    if (e.trailCD <= 0) {
      e.trailCD = enraged ? 0.045 : 0.06;
      const side = e.chargeAng + Math.PI / 2;
      for (const s of [side, side + Math.PI]) {
        g.shoot(e.x, e.y, s, 150, '#bff4ff', { kind: 'ice', delay: 0.45 });
      }
    }
    const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
    const out = nx < e.r || nx > g.W - e.r || ny < e.r || ny > g.H - e.r;
    if (out || e.modeT > 1.6) {
      g.shake(10);
      g.explode(clamp(nx, 0, g.W), clamp(ny, 0, g.H), '#8ff0ff', 26);
      e.vx = e.vy = 0;
      e.chain--;
      if (e.chain > 0) { e.mode = 'aim'; e.modeT = 0.3; }
      else { e.mode = 'hover'; e.modeT = 0; }
    }
  }
}

// ------------------------------------------------------------
// HELIOS: a living star. Flare rings with a gap to slip through,
// accelerating sunspots, solar flares that burn whole lanes, and
// spiral arms once it's angry.
// ------------------------------------------------------------
function helios(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.45;
  e.spin = (e.spin || 0) + dt * (enraged ? 1.3 : 0.9);
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.35) * g.W * 0.25, Math.max(g.H * 0.24, g.top + e.r * 1.4), 0.8, e.baseSpeed * 3);
  if (!onStage(e, g)) return;
  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    e.cycle = (e.cycle || 0) + 1;
    const step = e.cycle % 3;
    if (step === 0) {
      const n = 30, gap = 5;
      const start = Math.floor(g.rand() * n);
      for (let k = 0; k < n; k++) {
        if ((k - start + n) % n < gap) continue;
        g.shoot(e.x, e.y, (k / n) * TAU, 165, '#ffb000', { kind: 'flame' });
      }
    } else if (step === 1) {
      fan(g, e.x, e.y, aim(e, g), 5, 0.9, 110, '#ff6b35', { kind: 'flame', r: 7, accel: 280, maxSpeed: 430 });
    } else {
      // Solar flares: one lane through the player, one somewhere else
      const axis = g.rand() < 0.5 ? 'x' : 'y';
      g.hazard('flare', { axis, pos: axis === 'x' ? g.p.x : g.p.y, owner: e });
      if (enraged) {
        const other = axis === 'x' ? 'y' : 'x';
        g.hazard('flare', { axis: other, pos: (other === 'x' ? g.W : g.H) * (0.2 + g.rand() * 0.6), owner: e });
      }
    }
    e.fireCD = enraged ? 1.25 : 1.7;
  }
  if (enraged) {
    e.armCD = (e.armCD || 0) - dt;
    if (e.armCD <= 0) {
      e.armCD = 0.13;
      for (const off of [0, Math.PI]) g.shoot(e.x, e.y, e.spin + off, 200, '#ff9f1a', { kind: 'flame', r: 4 });
    }
  }
}

// ------------------------------------------------------------
// ARACHNE: a spider station that skitters between waypoints laying
// mines, then sets them all off at once.
// ------------------------------------------------------------
function arachne(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  e.wpT = (e.wpT || 0) + dt;
  if (!e.wp || e.wpT > 4 || Math.hypot(e.wp.x - e.x, e.wp.y - e.y) < 24) {
    for (let tries = 0; tries < 8; tries++) {
      const wp = { x: g.W * (0.15 + g.rand() * 0.7), y: g.H * (0.15 + g.rand() * 0.7) };
      if (Math.hypot(wp.x - g.p.x, wp.y - g.p.y) > 170 || tries === 7) { e.wp = wp; break; }
    }
    e.wpT = 0;
  }
  const sp = e.baseSpeed * (enraged ? 1.4 : 1);
  const a = Math.atan2(e.wp.y - e.y, e.wp.x - e.x);
  e.vx += (Math.cos(a) * sp - e.vx) * Math.min(1, dt * 4);
  e.vy += (Math.sin(a) * sp - e.vy) * Math.min(1, dt * 4);
  e.legPhase = (e.legPhase || 0) + dt * Math.hypot(e.vx, e.vy) * 0.06;
  if (!onStage(e, g)) return;

  const mines = g.hazards().filter((h) => h.kind === 'mine' && h.owner === e);
  e.layCD = (e.layCD ?? 1) - dt;
  if (e.layCD <= 0 && mines.length < (enraged ? 10 : 7)) {
    if (enraged) {
      for (let k = 0; k < 3; k++) {
        const ma = (k / 3) * TAU + e.t;
        g.hazard('mine', { x: e.x + Math.cos(ma) * 34, y: e.y + Math.sin(ma) * 34, owner: e });
      }
    } else {
      g.hazard('mine', { x: e.x, y: e.y, owner: e });
    }
    e.layCD = enraged ? 2.2 : 1.6;
  }
  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    fan(g, e.x, e.y, aim(e, g), 5, 0.7, 250, '#39ff14');
    e.fireCD = enraged ? 1.0 : 1.3;
  }
  e.detCD = (e.detCD ?? 6) - dt;
  if (e.detCD <= 0 && mines.length >= 3) {
    for (const m of mines) if (m.fuse <= 0) m.fuse = m.fuseMax = 1.0;
    e.detFlash = 0.5;
    e.detCD = enraged ? 5.5 : 7;
  }
  if (e.detFlash > 0) e.detFlash -= dt;
}

// ------------------------------------------------------------
// PULSAR: a neutron star with sweeping lighthouse beams. Two beams,
// four when it's hurt, with pulse rings between sweeps.
// ------------------------------------------------------------
function pulsar(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.25) * g.W * 0.15, g.H * 0.42 + Math.cos(e.t * 0.3) * g.H * 0.08, 0.7, e.baseSpeed * 4);
  if (e.spinDir === undefined) e.spinDir = 1;
  if (enraged) {
    e.flipT = (e.flipT || 0) + dt;
    if (e.flipT > 8) { e.flipT = 0; e.spinDir *= -1; }
  }
  e.beamAng = (e.beamAng ?? g.rand() * TAU) + dt * e.spinDir * (enraged ? 0.55 : 0.42);
  if (!onStage(e, g)) return;

  e.beams = (e.beams || []).filter((b) => !b.done);
  if (e.beams.length === 0) {
    e.beamRest = (e.beamRest ?? 1.2) - dt;
    if (e.beamRest <= 0) {
      const n = enraged ? 4 : 2;
      for (let k = 0; k < n; k++) e.beams.push(g.beam(e, { warn: 1.2, life: 4.2, width: 14, len: 2400, color: '#bfefff' }));
      e.beamRest = 2.4;
    }
  }
  e.beams.forEach((b, k) => {
    b.x = e.x; b.y = e.y;
    b.angle = e.beamAng + (k / e.beams.length) * TAU;
  });
  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    const firing = e.beams.length > 0;
    ring(g, e.x, e.y, firing ? 10 : 16, firing ? 120 : 155, '#5ac8fa', e.beamAng + 0.3);
    e.fireCD = enraged ? 1.1 : 1.4;
  }
}

// ------------------------------------------------------------
// BINARY: two stars locked in orbit around a shared core. Gold fires
// aimed bursts, blue spins spirals; wounded, they spread apart and a
// plasma tether burns between them.
// ------------------------------------------------------------
function binary(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.3) * g.W * 0.22, Math.max(g.H * 0.32, g.top + 170) + Math.sin(e.t * 0.5) * g.H * 0.07, 0.6, e.baseSpeed * 3);
  const want = enraged ? 150 : 85 + Math.sin(e.t * 0.8) * 15;
  e.orbitR = (e.orbitR || 60) + (want - (e.orbitR || 60)) * Math.min(1, dt * 1.5);
  e.orbitA = (e.orbitA || 0) + dt * (enraged ? 1.5 : 1.1);
  const ax = e.x + Math.cos(e.orbitA) * e.orbitR, ay = e.y + Math.sin(e.orbitA) * e.orbitR * 0.9;
  const bx = e.x - Math.cos(e.orbitA) * e.orbitR, by = e.y - Math.sin(e.orbitA) * e.orbitR * 0.9;
  e.parts = [{ x: ax, y: ay, r: 22 }, { x: bx, y: by, r: 17 }];
  if (!onStage(e, g)) return;

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    fan(g, ax, ay, Math.atan2(g.p.y - ay, g.p.x - ax), 3, 0.24, 270, '#ffd23f', { kind: 'flame' });
    e.fireCD = enraged ? 0.9 : 1.1;
  }
  e.spiralCD = (e.spiralCD || 0) - dt;
  if (e.spiralCD <= 0) {
    e.spiralCD = 0.18;
    e.spiral = (e.spiral || 0) + 0.32;
    const n = enraged ? 3 : 2;
    for (let k = 0; k < n; k++) g.shoot(bx, by, e.spiral + (k / n) * TAU, 165, '#5ac8fa');
  }
  if (enraged) {
    if (!e.tether || e.tether.done) e.tether = g.beam(e, { warn: 1.0, life: 9999, width: 9, color: '#ffe8a0' });
    e.tether.x = ax; e.tether.y = ay;
    e.tether.angle = Math.atan2(by - ay, bx - ax);
    e.tether.len = Math.hypot(bx - ax, by - ay);
  }
}

// ------------------------------------------------------------
// LEVIATHAN: a serpent that swims through the arena. Every body
// segment is a hitbox; segments fire broadsides, the head lunges.
// ------------------------------------------------------------
const LEVI_SEGMENTS = 14;
const LEVI_SPACING = 21;

function leviathan(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  if (!e.trail) {
    e.trail = [];
    e.heading = Math.PI / 2;
    for (let i = 0; i < LEVI_SEGMENTS * LEVI_SPACING / 4 + 4; i++) e.trail.push({ x: e.x, y: e.y - i * 4 });
  }
  // Steering: hunt the player, but keep off the walls
  let want = aim(e, g);
  const m = 70;
  if (e.x < m || e.x > g.W - m || e.y < m || e.y > g.H - m) want = Math.atan2(g.H / 2 - e.y, g.W / 2 - e.x);
  let diff = want - e.heading;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  const turn = (enraged ? 2.8 : 2.2) * dt;
  e.heading += clamp(diff, -turn, turn);
  e.lungeCD = (e.lungeCD ?? 4) - dt;
  if (e.lungeCD <= 0) { e.lunge = 0.9; e.lungeCD = enraged ? 3.5 : 5; }
  let sp = e.baseSpeed * (enraged ? 1.2 : 1);
  if (e.lunge > 0) { e.lunge -= dt; sp *= 1.9; }
  e.vx = Math.cos(e.heading) * sp;
  e.vy = Math.sin(e.heading) * sp;

  // Record the path, then hang the segments along it
  const last = e.trail[0];
  if (Math.hypot(e.x - last.x, e.y - last.y) >= 4) {
    e.trail.unshift({ x: e.x, y: e.y });
    if (e.trail.length > LEVI_SEGMENTS * LEVI_SPACING / 4 + 8) e.trail.pop();
  }
  e.parts = [];
  for (let i = 1; i <= LEVI_SEGMENTS; i++) {
    const idx = Math.min(e.trail.length - 1, Math.round((i * LEVI_SPACING) / 4));
    const pt = e.trail[idx];
    e.parts.push({ x: pt.x, y: pt.y, r: 18 - (i / LEVI_SEGMENTS) * 9, seg: i });
  }
  if (!onStage(e, g)) return;

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    e.parts.forEach((pt, i) => {
      if (i % 3 !== 1) return;
      const prev = i > 0 ? e.parts[i - 1] : e;
      const body = Math.atan2(prev.y - pt.y, prev.x - pt.x);
      g.shoot(pt.x, pt.y, body + Math.PI / 2, 170, '#3affd8');
      g.shoot(pt.x, pt.y, body - Math.PI / 2, 170, '#3affd8');
    });
    if (enraged) fan(g, e.x, e.y, aim(e, g), 5, 0.5, 260, '#b847ff');
    e.fireCD = enraged ? 1.6 : 2.2;
  }
}

// ------------------------------------------------------------
// CARRIER: a mothership patrolling the top of the arena. Launches
// fighters, flak from its wing pods, homing missile salvos.
// ------------------------------------------------------------
function carrier(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.22) * g.W * 0.3, Math.max(g.H * 0.2, g.top + e.r * 1.7), 0.5, e.baseSpeed * 3);
  const podL = { x: e.x - e.r * 1.15, y: e.y - e.r * 0.15, r: 15 };
  const podR = { x: e.x + e.r * 1.15, y: e.y - e.r * 0.15, r: 15 };
  for (const pod of [podL, podR]) pod.a = Math.atan2(g.p.y - pod.y, g.p.x - pod.x);
  e.parts = [podL, podR];
  if (!onStage(e, g)) return;

  e.fighters = (e.fighters || []).filter((f) => g.alive(f));
  e.launchCD = (e.launchCD ?? 1.5) - dt;
  if (e.launchCD <= 0 && e.fighters.length < 6) {
    for (const side of [-1, 1]) {
      const f = g.minion('fighter', e.x + side * 22, e.y + e.r * 0.5, e);
      if (f) { f.vx = side * 120; f.vy = 160; e.fighters.push(f); }
    }
    e.launchCD = enraged ? 2.6 : 3.6;
  }
  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    e.podTurn = !e.podTurn;
    const pod = e.podTurn ? podL : podR;
    fan(g, pod.x, pod.y, Math.atan2(g.p.y - pod.y, g.p.x - pod.x), 3, 0.25, 260, '#ff9f1a');
    e.fireCD = enraged ? 0.9 : 1.3;
  }
  e.missileCD = (e.missileCD ?? 3) - dt;
  if (e.missileCD <= 0) {
    for (let k = 0; k < 4; k++) {
      g.shoot(e.x + (k - 1.5) * 16, e.y + e.r * 0.3, Math.PI / 2 + (k - 1.5) * 0.5, 190, '#ff6b35', { kind: 'missile', homing: 1.7, life: 3.4, r: 5 });
    }
    e.missileCD = enraged ? 4.5 : 5.5;
  }
  if (enraged) {
    e.curtainCD = (e.curtainCD ?? 2) - dt;
    if (e.curtainCD <= 0) {
      for (let k = 0; k < 12; k++) {
        const x = e.x - e.r * 1.4 + (k / 11) * e.r * 2.8;
        g.shoot(x, e.y + e.r * 0.3, Math.PI / 2 + Math.sin(e.t + k) * 0.15, 150, '#ffd23f');
      }
      e.curtainCD = 2.6;
    }
  }
}

// ------------------------------------------------------------
// KRAKEN: a nebula beast with six tentacles. Tips spit and slam,
// ink blobs swell and linger, and wounded it spins its arms.
// ------------------------------------------------------------
const KRAKEN_ARMS = 6;
const KRAKEN_JOINTS = 9;

// The six arms as joint chains, from the boss's position, time, spin and
// slam state (slamArm, slamT, slamAng). Shared so multiplayer clients can
// redraw the arms from a handful of synced numbers.
export function krakenArms(e) {
  const arms = [];
  for (let i = 0; i < KRAKEN_ARMS; i++) {
    let base = (e.spin || 0) + (i / KRAKEN_ARMS) * TAU;
    let ext = 1;
    const slamming = e.slamArm === i;
    if (slamming) {
      // 0.6s wind-up (curl in), then a fast lash toward where the player was
      const st = e.slamT;
      if (st < 0.6) ext = 1 - st * 0.4;
      else {
        ext = 1 + Math.sin(Math.min(1, (st - 0.6) / 0.7) * Math.PI) * 1.1;
        if (Number.isFinite(e.slamAng)) {
          base += Math.atan2(Math.sin(e.slamAng - base), Math.cos(e.slamAng - base)) * Math.min(1, (st - 0.6) * 4);
        }
      }
    }
    const pts = [];
    let x = e.x + Math.cos(base) * e.r * 0.8, y = e.y + Math.sin(base) * e.r * 0.8;
    for (let j = 0; j < KRAKEN_JOINTS; j++) {
      const ang = base + Math.sin(e.t * 2.2 + j * 0.55 + i * 1.3) * 0.35 * (j / KRAKEN_JOINTS + 0.2);
      x += Math.cos(ang) * 17 * ext;
      y += Math.sin(ang) * 17 * ext;
      pts.push({ x, y });
    }
    arms.push({ pts, slam: slamming ? e.slamT : -1 });
  }
  return arms;
}

function kraken(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  const d = dist(e, g) || 1;
  const a = aim(e, g);
  const radial = (d - 240) / 240;
  e.vx = Math.cos(a) * radial * e.baseSpeed * 1.5 + Math.cos(e.t * 0.7) * 25;
  e.vy = Math.sin(a) * radial * e.baseSpeed * 1.5 + Math.sin(e.t * 0.9) * 25;
  if (e.y < g.top + e.r * 2) e.vy = Math.max(e.vy, 60);
  e.spin = (e.spin || 0) + dt * (enraged ? 1.4 : 0.25);

  // Slam: the arm pointing closest at the player winds up and lashes out
  if (e.slamArm === undefined) { e.slamArm = -1; e.slamT = 0; e.slamAng = NaN; }
  e.slamCD = (e.slamCD ?? 3) - dt;
  if (e.slamCD <= 0 && e.slamArm < 0) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < KRAKEN_ARMS; i++) {
      let dd = (e.spin + (i / KRAKEN_ARMS) * TAU) - a;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      if (Math.abs(dd) < bestD) { bestD = Math.abs(dd); best = i; }
    }
    e.slamArm = best;
    e.slamT = 0;
    e.slamAng = NaN;
    e.slamCD = enraged ? 2.4 : 3.4;
  }
  if (e.slamArm >= 0) {
    e.slamT += dt;
    // Lock the lash direction as the wind-up ends
    if (e.slamT >= 0.6 && !Number.isFinite(e.slamAng)) e.slamAng = a;
    if (e.slamT > 1.3) e.slamArm = -1;
  }

  e.arms = krakenArms(e);
  e.parts = [];
  for (const arm of e.arms) {
    for (let j = KRAKEN_JOINTS - 3; j < KRAKEN_JOINTS; j++) {
      e.parts.push({ x: arm.pts[j].x, y: arm.pts[j].y, r: 9 - (j - (KRAKEN_JOINTS - 3)) * 1.5 });
    }
  }
  if (!onStage(e, g)) return;

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    fan(g, e.x, e.y, a, 3, 0.5, 105, '#b847ff', { kind: 'ink', r: 9, grow: 9, maxR: 20, accel: -18, minSpeed: 35, life: 5 });
    e.fireCD = enraged ? 1.9 : 2.4;
  }
  e.spitCD = (e.spitCD ?? 1) - dt;
  if (e.spitCD <= 0) {
    const arms = enraged ? [0, 1, 2, 3, 4, 5] : [Math.floor(g.rand() * KRAKEN_ARMS), Math.floor(g.rand() * KRAKEN_ARMS)];
    for (const i of arms) {
      const tip = e.arms[i].pts[KRAKEN_JOINTS - 1];
      if (enraged) ring(g, tip.x, tip.y, 3, 170, '#7aff6a', e.t);
      else g.shoot(tip.x, tip.y, Math.atan2(g.p.y - tip.y, g.p.x - tip.x), 240, '#7aff6a');
    }
    e.spitCD = enraged ? 1.4 : 1.5;
  }
}

// ------------------------------------------------------------
// DREADNOUGHT: the fleet flagship. Four turrets walk fire across
// the arena, the spinal cannon locks on and fires a huge beam, and
// missile swarms fill the gaps. Wounded, the beam tracks you.
// ------------------------------------------------------------
function dreadnought(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  hoverTo(e, clamp(g.p.x, g.W * 0.25, g.W * 0.75), Math.max(g.H * 0.17, g.top + e.r * 1.9), 0.35, e.baseSpeed * 2);
  const offs = [[-0.55, -0.35], [0.55, -0.35], [-0.42, 0.3], [0.42, 0.3]];
  e.parts = offs.map(([ox, oy]) => ({ x: e.x + ox * e.r, y: e.y + oy * e.r, r: 12 }));
  for (const pt of e.parts) pt.a = Math.atan2(g.p.y - pt.y, g.p.x - pt.x);
  if (!onStage(e, g)) return;

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    e.turret = ((e.turret || 0) + 1) % 4;
    const pt = e.parts[e.turret];
    fan(g, pt.x, pt.y, pt.a, 2, 0.1, 300, '#ff3860');
    e.fireCD = e.turret === 3 ? (enraged ? 0.9 : 1.3) : (enraged ? 0.22 : 0.3);
  }
  const noseX = e.x, noseY = e.y + e.r * 1.15;
  e.cannonCD = (e.cannonCD ?? 4) - dt;
  if (e.cannonCD <= 0 && (!e.cannon || e.cannon.done)) {
    e.cannon = g.beam(e, { warn: 1.3, life: 0.9, width: 36, len: 2400, color: '#ff3860', angle: Math.atan2(g.p.y - noseY, g.p.x - noseX) });
    e.cannonCD = enraged ? 4.5 : 6;
    g.sound('bosswarn');
  }
  if (e.cannon && !e.cannon.done) {
    e.cannon.x = noseX; e.cannon.y = noseY;
    if (enraged && e.cannon.warn <= 0) {
      // Sweep toward the player while firing
      const want = Math.atan2(g.p.y - noseY, g.p.x - noseX);
      let dd = Math.atan2(Math.sin(want - e.cannon.angle), Math.cos(want - e.cannon.angle));
      e.cannon.angle += clamp(dd, -0.5 * dt, 0.5 * dt);
    }
  }
  e.missileCD = (e.missileCD ?? 6) - dt;
  if (e.missileCD <= 0) {
    for (let k = 0; k < 6; k++) {
      g.shoot(e.x + (k - 2.5) * 12, e.y - e.r * 0.6, -Math.PI / 2 + (k - 2.5) * 0.45, 170, '#ff6b35', { kind: 'missile', homing: 1.5, life: 3.6, r: 5 });
    }
    e.missileCD = enraged ? 5 : 7;
  }
}

// ------------------------------------------------------------
// NEXUS: a machine core behind a shield, held up by orbiting
// nodes strung together with a laser fence. Kill the nodes to drop
// the shield; it rebuilds them until it's badly hurt.
// ------------------------------------------------------------
function nexus(e, dt, g) {
  const hp = e.hp / e.maxHp, frantic = hp < 0.35;
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.3) * g.W * 0.12, Math.max(g.H * 0.34, g.top + 150), 0.7, e.baseSpeed * 4);
  e.spin = (e.spin || 0) + dt * (frantic ? 1.1 : 0.6);
  e.nodes = (e.nodes || []).filter((n) => g.alive(n));

  if (!e.built && onStage(e, g)) {
    e.built = true;
    spawnNodes(e, g, 4);
  }
  if (e.built && e.nodes.length === 0 && !frantic) {
    e.rebuild = (e.rebuild ?? 7) - dt;
    if (e.rebuild <= 0) { spawnNodes(e, g, hp < 0.65 ? 5 : 4); e.rebuild = 7; }
  }
  e.shielded = e.nodes.length > 0;

  const R = 120 + Math.sin(e.t * 1.3) * 16;
  e.nodes.forEach((n, k) => {
    const a = e.spin + (k / e.nodes.length) * TAU;
    n.x = e.x + Math.cos(a) * R;
    n.y = e.y + Math.sin(a) * R;
  });

  // Laser fence between neighbouring nodes: 3s on, 1.6s off, 0.6s flicker
  // warning. Each segment is a beam re-aimed at its two nodes every frame.
  e.fenceT = ((e.fenceT || 0) + dt) % 5.2;
  e.fenceState = e.fenceT < 1.6 ? 'off' : e.fenceT < 2.2 ? 'warn' : 'on';
  const pairs = [];
  if (e.fenceState !== 'off' && e.nodes.length >= 2) {
    const n = e.nodes.length;
    for (let k = 0; k < (n > 2 ? n : 1); k++) pairs.push([e.nodes[k], e.nodes[(k + 1) % n]]);
  }
  e.fence = (e.fence || []).filter((b) => !b.done);
  while (e.fence.length > pairs.length) e.fence.pop().done = true;
  while (e.fence.length < pairs.length) {
    e.fence.push(g.beam(e, { warn: Math.max(0, 2.2 - e.fenceT), life: 999, width: 8, len: 1, color: '#00f0ff' }));
  }
  pairs.forEach(([a1, b1], k) => {
    const bm = e.fence[k];
    bm.x = a1.x; bm.y = a1.y;
    bm.angle = Math.atan2(b1.y - a1.y, b1.x - a1.x);
    bm.len = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  });
  if (!onStage(e, g)) return;

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    const a = aim(e, g);
    for (const sp of [210, 255, 300]) g.shoot(e.x, e.y, a, sp, '#00f0ff', { kind: 'shard' });
    if (!e.shielded) ring(g, e.x, e.y, 12, 170, '#b847ff', e.spin);
    e.fireCD = frantic ? 0.7 : 1.0;
  }
  if (frantic) {
    e.spiralCD = (e.spiralCD || 0) - dt;
    if (e.spiralCD <= 0) {
      e.spiralCD = 0.1;
      for (let k = 0; k < 3; k++) g.shoot(e.x, e.y, e.spin * 2.2 + (k / 3) * TAU, 190, '#00f0ff');
    }
  }
}

function spawnNodes(e, g, n) {
  e.nodes = [];
  for (let k = 0; k < n; k++) {
    const node = g.minion('node', e.x, e.y, e);
    if (node) e.nodes.push(node);
  }
  g.explode(e.x, e.y, '#00f0ff', 40);
}

// ------------------------------------------------------------
// SINGULARITY: a black hole that wants you. Constant pull, debris
// spiralling in on the accretion disk, jets from the poles, and
// bursts of Hawking radiation with extra gravity wells when hurt.
// ------------------------------------------------------------
// Strength of the Singularity's pull (multiplayer clients predict it too).
export function singularityPull(e) {
  return { strength: e.hp / e.maxHp < 0.5 ? 150 : 110, reach: 1100 };
}

function singularity(e, dt, g) {
  const hp = e.hp / e.maxHp, enraged = hp < 0.5;
  hoverTo(e, g.W / 2 + Math.sin(e.t * 0.2) * g.W * 0.18, g.H * 0.42 + Math.sin(e.t * 0.27) * g.H * 0.12, 0.4, e.baseSpeed * 4);
  e.spin = (e.spin || 0) + dt * 0.8;
  if (!onStage(e, g)) return;
  const pull = singularityPull(e);
  g.pull(e.x, e.y, pull.strength, pull.reach, dt);

  e.fireCD -= dt;
  if (e.fireCD <= 0) {
    // Debris on the disk: starts far out, spirals in and is swallowed
    for (let k = 0; k < 3; k++) {
      const a = e.spin * 1.7 + (k / 3) * TAU;
      g.shoot(e.x + Math.cos(a) * 330, e.y + Math.sin(a) * 330, 0, 0, '#ff9f43', {
        orbit: { center: e, vt: enraged ? 140 : 115, vr: -55, minR: e.r * 0.8 }, life: 9
      });
    }
    e.fireCD = enraged ? 0.42 : 0.5;
  }
  // Polar jets: on for 2.5s out of every 6
  e.jetT = ((e.jetT || 0) + dt) % 6;
  if (e.jetT < 2.5) {
    e.jetCD = (e.jetCD || 0) - dt;
    if (e.jetCD <= 0) {
      e.jetCD = 0.12;
      for (const off of [0, Math.PI]) g.shoot(e.x, e.y, e.spin * 0.6 + off, 230, '#e0b0ff', { kind: 'shard' });
    }
  }
  if (enraged) {
    e.hawkCD = (e.hawkCD ?? 2) - dt;
    if (e.hawkCD <= 0) {
      ring(g, e.x, e.y, 24, 150, '#ffffff', e.spin);
      const wells = g.hazards().filter((h) => h.kind === 'well' && h.owner === e);
      if (wells.length < 2) {
        for (let tries = 0; tries < 10; tries++) {
          const x = g.W * (0.15 + g.rand() * 0.7), y = g.H * (0.15 + g.rand() * 0.7);
          if (Math.hypot(x - g.p.x, y - g.p.y) > 220 && Math.hypot(x - e.x, y - e.y) > 200) {
            g.hazard('well', { x, y, owner: e, life: 7, reach: 200, strength: 110 });
            break;
          }
        }
      }
      e.hawkCD = 3.5;
    }
  }
}

// ------------------------------------------------------------
// Minions
// ------------------------------------------------------------
// Carrier interceptor: swoops in on an S-curve, takes a shot when close.
function fighter(e, dt, g) {
  const a = aim(e, g);
  const weave = Math.sin(e.t * 3 + (e.seed || 0)) * 0.9;
  const sp = e.baseSpeed;
  e.vx += (Math.cos(a + weave) * sp - e.vx) * Math.min(1, dt * 2.5);
  e.vy += (Math.sin(a + weave) * sp - e.vy) * Math.min(1, dt * 2.5);
  e.angle = Math.atan2(e.vy, e.vx);
  e.fireCD -= dt;
  if (e.fireCD <= 0 && dist(e, g) < 300) {
    g.shoot(e.x, e.y, a, 300, '#ff9f1a');
    e.fireCD = e.fireRate;
  }
}

// Nexus shield node: positioned by its Nexus, fires the odd shot.
function node(e, dt, g) {
  e.vx = 0; e.vy = 0;
  e.fireCD -= dt;
  if (e.fireCD <= 0 && onStage(e, g)) {
    g.shoot(e.x, e.y, aim(e, g), 200, '#00f0ff');
    e.fireCD = e.fireRate + g.rand();
  }
}

const AI = { colossus, glacier, helios, arachne, pulsar, binary, leviathan, carrier, kraken, dreadnought, nexus, singularity, fighter, node };

// Runs the AI for any boss or minion defined here. Returns false for
// enemies this module doesn't know, so game.js can fall through.
export function updateSpaceEnemy(e, dt, g) {
  const fn = AI[e.ai];
  if (!fn) return false;
  fn(e, dt, g);
  return true;
}
