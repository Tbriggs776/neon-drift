// ============================================================
// Enemy roster, wave plan and AI for multiplayer.
//
// Ported from the single-player game (src/game.js: ENEMY_DEFS,
// getWaveInfo, updateEnemies) so co-op fights the same enemies with the
// same patterns. Differences: enemies chase the nearest living pilot and
// waves scale with the number of pilots. Keep the two in step when tuning
// either one. The 12 sector bosses and their adds aren't ported: their AI
// is shared with single player (shared/bosses.js) and added at startup by
// installSharedDefs().
// ============================================================
const { shared } = require('./shared');

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
  sentinel: { hp: 50, speed: 90,  r: 26, color: '#ffea00', score: 280, ai: 'sentinel', fireRate: 1.0 },
  prism:    { hp: 45, speed: 100, r: 28, color: '#5ac8fa', score: 300, ai: 'prism',   fireRate: 0.9 },
  // Mega
  warden:   { hp: 70, speed: 60,  r: 42, color: '#ff3860', score: 750, ai: 'warden',  fireRate: 0.5 }
};

const BOSS_TYPES = ['warden', 'obelisk', 'hive', 'sentinel', 'prism'];

// Adds the sector bosses and their minions (fighters, shield nodes).
function installSharedDefs(bosses) {
  Object.assign(ENEMY_DEFS, bosses.SPACE_BOSS_DEFS, bosses.MINION_DEFS);
  for (const type of Object.keys(bosses.SPACE_BOSS_DEFS)) {
    if (!BOSS_TYPES.includes(type)) BOSS_TYPES.push(type);
  }
}

const WAVE_NAMES = ['SWARM', 'LATTICE', 'FRACTURE', 'CASCADE', 'BREACH', 'TEMPEST', 'RIPTIDE', 'ECLIPSE', 'VORTEX', 'SURGE'];

function isBoss(type) { return BOSS_TYPES.includes(type); }

// Same schedule as single player: 20 sectors of 5 waves, each ending in
// that sector's boss, the Warden every 25, enemy types unlocking as waves
// climb. `pilots` adds enemies and toughness so a full squad still has to
// work for it.
function getWaveInfo(waveNum, pilots = 1) {
  const { sectorForWave, WAVES_PER_SECTOR } = shared().sectors;
  const sector = sectorForWave(waveNum);
  const diffMul = 1 + (waveNum - 1) * 0.08 + Math.pow(Math.max(0, waveNum - 12), 1.15) * 0.02;
  const extra = Math.max(0, pilots - 1);
  const hpMul = 1 + extra * 0.3;
  // A boss takes the whole squad's fire, so it gets tougher faster.
  const bossHpMul = 1 + extra * 0.7;
  const loop = Math.floor((waveNum - 1) / 25);

  if (waveNum % 25 === 0) {
    const tier = loop + 1;
    return {
      kind: 'mega', waveNum, sector, diffMul, hpMul,
      name: tier === 1 ? 'WARDEN' : `WARDEN +${tier - 1}`,
      bossType: 'warden', bossScale: (1 + loop * 0.6) * bossHpMul
    };
  }
  if (sector.waveInSector === WAVES_PER_SECTOR - 1) {
    const bossType = sector.boss;
    return {
      kind: 'mini', waveNum, sector, diffMul, hpMul,
      name: bossType.toUpperCase() + (sector.loop > 0 ? ` +${sector.loop}` : ''),
      bossType, bossScale: (1 + loop * 0.35) * bossHpMul
    };
  }
  const types = ['grunt'];
  if (waveNum >= 3) types.push('drifter');
  if (waveNum >= 4) types.push('turret');
  if (waveNum >= 6) types.push('weaver');
  if (waveNum >= 12) types.push('splitter');
  if (waveNum >= 17) types.push('phantom');
  if (waveNum >= 22) types.push('bomber');
  if (waveNum >= 32) types.push('lancer');
  const baseCount = Math.min(6 + Math.floor(waveNum * 0.9), 34);
  return {
    kind: 'regular', waveNum, sector, diffMul, hpMul,
    name: WAVE_NAMES[(waveNum - 1) % WAVE_NAMES.length],
    enemyCount: Math.min(Math.round(baseCount * (1 + extra * 0.5)), 60),
    types
  };
}

// Builds the plain fields an enemy needs. The room copies them onto its
// synced Enemy schema object. `scale` multiplies HP; `diffMul` speeds up
// movement and fire rate a little.
function makeEnemy(type, scale, diffMul, worldW, worldH) {
  const def = ENEMY_DEFS[type];
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * worldW; y = -30; }
  else if (side === 1) { x = worldW + 30; y = Math.random() * worldH; }
  else if (side === 2) { x = Math.random() * worldW; y = worldH + 30; }
  else { x = -30; y = Math.random() * worldH; }
  if (isBoss(type)) { x = worldW / 2; y = -80; }
  const speedScale = 1 + (diffMul - 1) * 0.18;
  return {
    type, x, y,
    hp: def.hp * scale,
    maxHp: def.hp * scale,
    r: def.r,
    score: Math.ceil(def.score * scale),
    ai: def.ai,
    baseSpeed: def.speed * speedScale,
    fireCD: def.fireRate ? Math.random() * def.fireRate : 0,
    fireRate: def.fireRate ? def.fireRate / (1 + (diffMul - 1) * 0.15) : 0,
    vx: 0, vy: 0, angle: 0, t: 0, phase: 0,
    splitLeft: type === 'splitter' ? 2 : 0,
    phantomCycle: 0,
    charge: 0,
    intangible: false
  };
}

// One AI step. `p` is the target pilot ({x, y}); `fx` provides
// shoot(x, y, angle, speed, color), spawnAdds(e) for the hive and
// move(e, x, y) to slide along cover.
function updateEnemyAI(e, p, dt, worldW, worldH, fx) {
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
    if (dist > 300) {
      e.vx = (dx / dist) * spd;
      e.vy = (dy / dist) * spd;
    } else {
      e.vx *= 0.9; e.vy *= 0.9;
    }
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      fx.shoot(e.x, e.y, Math.atan2(dy, dx), 260, '#ffea00');
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'weaver') {
    const targetDist = 220;
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    const ddx = p.x - (dx / dist) * targetDist - e.x;
    const ddy = p.y - (dy / dist) * targetDist - e.y;
    const dmag = Math.hypot(ddx, ddy) || 1;
    e.vx = (ddx / dmag + Math.cos(tangent) * 0.6) * spd;
    e.vy = (ddy / dmag + Math.sin(tangent) * 0.6) * spd;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      fx.shoot(e.x, e.y, Math.atan2(dy, dx), 340, '#b847ff');
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'phantom') {
    // Blinks in and out; invisible (and untouchable) for the last 35%.
    e.phantomCycle += dt;
    const phase = (e.phantomCycle % 3) / 3;
    e.intangible = phase >= 0.65;
    const boost = e.intangible ? 1.3 : 1;
    e.vx = (dx / dist) * spd * boost;
    e.vy = (dy / dist) * spd * boost;
  } else if (e.ai === 'bomber') {
    if (dist > 230) {
      e.vx = (dx / dist) * spd;
      e.vy = (dy / dist) * spd;
    } else {
      e.vx *= 0.85; e.vy *= 0.85;
    }
    e.fireCD -= dt;
    if (e.fireCD <= 0 && dist < 500) {
      const ang = Math.atan2(dy, dx);
      for (let k = -2; k <= 2; k++) fx.shoot(e.x, e.y, ang + k * 0.08, 180, '#ff6b35');
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'lancer') {
    // Pause to aim, then charge in a straight line.
    e.charge -= dt;
    if (e.charge <= 0) {
      e.angle = Math.atan2(dy, dx);
      e.charge = 1.6;
    }
    const chargeRatio = e.charge / 1.6;
    if (chargeRatio > 0.7) {
      e.vx *= 0.88; e.vy *= 0.88;
    } else {
      e.vx = Math.cos(e.angle) * spd * 2.3;
      e.vy = Math.sin(e.angle) * spd * 2.3;
    }
    e.fireCD -= dt;
    if (e.fireCD <= 0 && chargeRatio < 0.5) {
      fx.shoot(e.x, e.y, e.angle, 450, '#ffffff');
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'obelisk') {
    const targetY = worldH * 0.25;
    const targetX = worldW / 2 + Math.sin(e.t * 0.4) * (worldW * 0.2);
    e.vx = (targetX - e.x) * 0.8;
    e.vy = (targetY - e.y) * 0.8;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      const rayCount = e.hp / e.maxHp > 0.5 ? 4 : 6;
      for (let k = 0; k < rayCount; k++) {
        fx.shoot(e.x, e.y, (k / rayCount) * Math.PI * 2 + e.t * 1.2, 240, '#b847ff');
      }
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'hive') {
    const targetDist = 280;
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    const ddx = p.x - (dx / dist) * targetDist - e.x;
    const ddy = p.y - (dy / dist) * targetDist - e.y;
    const dmag = Math.hypot(ddx, ddy) || 1;
    e.vx = (ddx / dmag) * spd + Math.cos(tangent) * spd * 0.4;
    e.vy = (ddy / dmag) * spd + Math.sin(tangent) * spd * 0.4;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      fx.spawnAdds(e);
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'sentinel') {
    e.vx = (dx / dist) * spd;
    e.vy = (dy / dist) * spd;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      const ang = Math.atan2(dy, dx);
      for (let k = -1; k <= 1; k++) fx.shoot(e.x, e.y, ang + k * 0.14, 320, '#ffea00');
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'prism') {
    const targetDist = 320;
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    const ddx = p.x - (dx / dist) * targetDist - e.x;
    const ddy = p.y - (dy / dist) * targetDist - e.y;
    const dmag = Math.hypot(ddx, ddy) || 1;
    e.vx = (ddx / dmag + Math.cos(tangent) * 0.8) * spd;
    e.vy = (ddy / dmag + Math.sin(tangent) * 0.8) * spd;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      const colors = ['#5ac8fa', '#ff2d95', '#ffea00'];
      const enraged = e.hp / e.maxHp < 0.5;
      for (let c = 0; c < 3; c++) {
        const ang = e.t * (c === 0 ? 1.2 : c === 1 ? -1.5 : 0.9) + c * (Math.PI * 2 / 3);
        fx.shoot(e.x, e.y, ang, 240 + c * 20, colors[c]);
        if (enraged) fx.shoot(e.x, e.y, ang + Math.PI, 240 + c * 20, colors[c]);
      }
      e.fireCD = e.fireRate;
    }
  } else if (e.ai === 'warden') {
    // Four phases by HP: rings, aimed fans, dense double rings, enraged.
    const targetY = worldH * 0.22;
    const targetX = worldW / 2 + Math.sin(e.t * 0.7) * (worldW * 0.25);
    e.vx = (targetX - e.x) * 1.2;
    e.vy = (targetY - e.y) * 1.2;
    e.fireCD -= dt;
    if (e.fireCD <= 0) {
      const hpFrac = e.hp / e.maxHp;
      e.phase = hpFrac < 0.25 ? 3 : hpFrac < 0.5 ? 2 : hpFrac < 0.8 ? 1 : 0;
      const aim = Math.atan2(dy, dx);
      if (e.phase === 0) {
        for (let k = 0; k < 8; k++) fx.shoot(e.x, e.y, (k / 8) * Math.PI * 2 + e.t * 0.3, 220, '#ff3860');
        e.fireCD = 1.2;
      } else if (e.phase === 1) {
        for (let k = -2; k <= 2; k++) fx.shoot(e.x, e.y, aim + k * 0.18, 280, '#ff3860');
        for (let k = 0; k < 4; k++) fx.shoot(e.x, e.y, e.t * 2 + k * Math.PI / 2, 200, '#ff2d95');
        e.fireCD = 0.9;
      } else if (e.phase === 2) {
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2 + e.t * 0.6;
          fx.shoot(e.x, e.y, ang, 200, '#ff3860');
          fx.shoot(e.x, e.y, ang + Math.PI / 12, 260, '#ff2d95');
        }
        for (let k = -1; k <= 1; k++) fx.shoot(e.x, e.y, aim + k * 0.1, 360, '#ffea00');
        e.fireCD = 0.7;
      } else {
        for (let k = 0; k < 16; k++) fx.shoot(e.x, e.y, (k / 16) * Math.PI * 2 + e.t * 0.8, 240, '#ff3860');
        for (let k = -2; k <= 2; k++) fx.shoot(e.x, e.y, aim + k * 0.08, 420, '#ffffff');
        e.fireCD = 0.5;
      }
    }
  }

  fx.move(e, e.x + e.vx * dt, e.y + e.vy * dt);
  keepInside(e, worldW, worldH);
}

// Enemies spawn just outside the world. Once fully inside they stay
// inside, so kiting enemies and bosses can't back out of bullet range.
function keepInside(e, worldW, worldH) {
  if (!e.entered && e.x > e.r && e.x < worldW - e.r && e.y > e.r && e.y < worldH - e.r) {
    e.entered = true;
  }
  if (e.entered) {
    e.x = Math.max(e.r, Math.min(worldW - e.r, e.x));
    e.y = Math.max(e.r, Math.min(worldH - e.r, e.y));
  }
}

module.exports = { ENEMY_DEFS, BOSS_TYPES, isBoss, getWaveInfo, makeEnemy, updateEnemyAI, keepInside, installSharedDefs };
