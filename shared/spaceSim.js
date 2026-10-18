// ============================================================
// SPACE SIM: cover, collision, hazards and fancy enemy shots
// ============================================================
// Shared by single player (src/game.js) and the multiplayer server
// (server/src/NeonDriftRoom.js), so solo and co-op play by the same rules.
// No drawing here (src/spaceArt.js does that) and no reach into either
// game: hazard functions take a "hazard world" object `hw`:
//
//   hw.W, hw.H            arena size
//   hw.sector             current sector (sectors.js)
//   hw.hazards            live hazards (this module fills it)
//   hw.obstacles          static cover (gate pylons get added here)
//   hw.clock              countdowns for timed hazards
//   hw.rand()             the wave's hazard stream (gameplay rolls)
//   hw.diff               the wave's difficulty multiplier
//   hw.live               false once the wave is clear: leftovers can't hurt
//   hw.pilots()           living pilots ({ x, y, r, iframes })
//   hw.hurt(pilot)        damage one pilot
//   hw.enemies()          live enemies
//   hw.isBoss(e)
//   hw.hitEnemy(e, amt)   damage an enemy (and kill it at 0 HP)
//   hw.enemyShots()       enemy bullets; hw.dropShots(pred) removes some
//   hw.rockBroken(h, shooter, points, dropCore)   a pilot shot a rock apart
//   hw.fx(type, data)     cosmetic events: debris, mine, strike, flare,
//                         wellGone, cometTrail
//   hw.nextId()           optional: ids for syncing hazards to clients
// ============================================================

const TAU = Math.PI * 2;

// ------------------------------------------------------------
// Geometry. Obstacles are circles ({shape:'circle', x, y, r}) or
// axis-aligned rects ({shape:'rect', x, y, w, h}).
// ------------------------------------------------------------
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

export function circleRectOverlap(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < cr * cr;
}

export function obstacleOverlap(cx, cy, cr, o) {
  if (o.shape === 'circle') {
    const dx = cx - o.x, dy = cy - o.y, rr = cr + o.r;
    return dx * dx + dy * dy < rr * rr;
  }
  return circleRectOverlap(cx, cy, cr, o);
}

export function insideObstacle(obstacles, x, y, r) {
  if (!obstacles) return false;
  for (const o of obstacles) if (obstacleOverlap(x, y, r, o)) return true;
  return false;
}

// Where a circle overlapping obstacle o has to go to just touch it, plus
// the surface normal. null if they don't overlap.
export function pushOutOf(cx, cy, cr, o) {
  if (o.shape === 'circle') {
    const dx = cx - o.x, dy = cy - o.y;
    const d = Math.hypot(dx, dy), rr = cr + o.r;
    if (d >= rr) return null;
    const nx = d > 1e-3 ? dx / d : 1, ny = d > 1e-3 ? dy / d : 0;
    return { x: o.x + nx * rr, y: o.y + ny * rr, nx, ny };
  }
  const qx = Math.max(o.x, Math.min(cx, o.x + o.w));
  const qy = Math.max(o.y, Math.min(cy, o.y + o.h));
  const dx = cx - qx, dy = cy - qy;
  const d = Math.hypot(dx, dy);
  if (d >= cr) return null;
  if (d > 1e-3) return { x: qx + (dx / d) * cr, y: qy + (dy / d) * cr, nx: dx / d, ny: dy / d };
  // Center inside the rect: leave by the nearest side
  const left = cx - o.x, right = o.x + o.w - cx, top = cy - o.y, bottom = o.y + o.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: o.x - cr, y: cy, nx: -1, ny: 0 };
  if (m === right) return { x: o.x + o.w + cr, y: cy, nx: 1, ny: 0 };
  if (m === top) return { x: cx, y: o.y - cr, nx: 0, ny: -1 };
  return { x: cx, y: o.y + o.h + cr, nx: 0, ny: 1 };
}

// Move a circle from (fromX, fromY) toward (toX, toY), stopping at obstacle
// edges. Overlaps are pushed out along the surface normal, so the circle
// slides along walls and curves around rocks. Long moves (dashes) go in
// small steps so they can't tunnel through thin cover.
export function resolveMove(obstacles, fromX, fromY, toX, toY, r) {
  if (!obstacles || obstacles.length === 0) return { x: toX, y: toY };
  const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / Math.max(4, r * 0.8)));
  const sx = (toX - fromX) / steps, sy = (toY - fromY) / steps;
  let x = fromX, y = fromY;
  for (let i = 0; i < steps; i++) {
    x += sx;
    y += sy;
    for (let pass = 0; pass < 2; pass++) {
      for (const o of obstacles) {
        const res = pushOutOf(x, y, r, o);
        if (res) { x = res.x; y = res.y; }
      }
    }
  }
  return { x, y };
}

// Screen wrap: once a ship fully leaves one edge it reappears on the
// opposite one. If the far side is blocked by cover, it stops at the edge.
export function wrapPosition(obstacles, x, y, r, W, H) {
  let nx = x, ny = y;
  if (nx < -r) nx += W + 2 * r;
  else if (nx > W + r) nx -= W + 2 * r;
  if (ny < -r) ny += H + 2 * r;
  else if (ny > H + r) ny -= H + 2 * r;
  if (nx === x && ny === y) return { x, y };
  if (insideObstacle(obstacles, nx, ny, r)) {
    return { x: Math.max(-r, Math.min(W + r, x)), y: Math.max(-r, Math.min(H + r, y)) };
  }
  return { x: nx, y: ny };
}

function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  // Quick accept: is either endpoint inside?
  if (x1 >= rect.x && x1 <= rect.x + rect.w && y1 >= rect.y && y1 <= rect.y + rect.h) return true;
  if (x2 >= rect.x && x2 <= rect.x + rect.w && y2 >= rect.y && y2 <= rect.y + rect.h) return true;
  const rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
  if (segmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx + rw, ry + rh, rx, ry + rh)) return true;
  if (segmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx, ry)) return true;
  return false;
}

// The obstacle a moving bullet's path crosses, or null.
export function segmentHitsObstacle(obstacles, x1, y1, x2, y2) {
  if (!obstacles || obstacles.length === 0) return null;
  for (const o of obstacles) {
    if (o.shape === 'circle' ? segDist(o.x, o.y, x1, y1, x2, y2) < o.r : segmentIntersectsRect(x1, y1, x2, y2, o)) return o;
  }
  return null;
}

// Space objects shrink on small screens so a phone arena isn't wall to wall
export function spaceScale(W, H) {
  return Math.max(0.6, Math.min(1, Math.min(W, H) / 720));
}

// ------------------------------------------------------------
// Cover: each regular wave lays out the sector's cover (asteroids, ice,
// crystal clusters, derelict hull plates, station modules) using one of the
// sector's layouts. Pure data: the client adds sprites from `seed`.
// ------------------------------------------------------------
const COVER_GAP = 56;      // room left between obstacles so a ship can slip through
const SPAWN_CLEAR = 130;   // keep the middle clear

// Candidate centers for a layout. Returns more spots than needed; the
// caller keeps the ones that fit.
function layoutSpots(layout, n, rand, W, H) {
  const m = Math.min(W, H) * 0.12;
  const spots = [];
  const tries = n * 4;
  if (layout === 'clusters') {
    const groups = 2 + Math.floor(rand() * 2);
    const centers = [];
    for (let g = 0; g < groups; g++) centers.push({ x: m + rand() * (W - m * 2), y: m + rand() * (H - m * 2) });
    for (let i = 0; i < tries; i++) {
      const c = centers[i % groups];
      const a = rand() * TAU, d = 40 + rand() * 90;
      spots.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d });
    }
  } else if (layout === 'belt') {
    // A diagonal band of rock across the arena
    const flip = rand() < 0.5 ? 1 : -1;
    for (let i = 0; i < tries; i++) {
      const t = rand();
      const x = W * (0.06 + t * 0.88);
      const y = H * (0.5 + flip * (t - 0.5) * 0.6) + (rand() - 0.5) * 120;
      spots.push({ x, y });
    }
  } else if (layout === 'ring') {
    const R = Math.min(W, H) * (0.3 + rand() * 0.06);
    const off = rand() * TAU;
    for (let i = 0; i < tries; i++) {
      const a = off + (i / Math.max(1, n)) * TAU + (rand() - 0.5) * 0.3;
      spots.push({ x: W / 2 + Math.cos(a) * R * (W > H ? 1.35 : 1), y: H / 2 + Math.sin(a) * R });
    }
  } else if (layout === 'lanes') {
    // Two lines of cover with gaps, across the long side of the screen
    const wide = W >= H;
    for (let i = 0; i < tries; i++) {
      const lane = i % 2;
      const t = 0.1 + rand() * 0.8;
      const across = 0.28 + lane * 0.44 + (rand() - 0.5) * 0.06;
      spots.push(wide ? { x: W * t, y: H * across } : { x: W * across, y: H * t });
    }
  } else {
    for (let i = 0; i < tries; i++) spots.push({ x: m + rand() * (W - m * 2), y: m + rand() * (H - m * 2) });
  }
  return spots;
}

function makeCover(kind, x, y, rand, W, H) {
  const k = spaceScale(W, H);
  if (kind === 'wreck' || kind === 'station') {
    const long = ((kind === 'station' ? 100 : 90) + rand() * 80) * k;
    const short = ((kind === 'station' ? 34 : 28) + rand() * 14) * Math.max(0.8, k);
    const horiz = rand() < 0.6;
    const w = horiz ? long : short, h = horiz ? short : long;
    return { shape: 'rect', kind, x: x - w / 2, y: y - h / 2, w, h, seed: Math.floor(rand() * 1e9) };
  }
  // Cover rocks run bigger than the drifting ones (max 34) and carry veins
  const r = ((kind === 'crystal' ? 30 : 38) + rand() * 26) * k;
  return {
    shape: 'circle', kind, x, y,
    r: r * 0.9,
    spriteR: r,
    rot: rand() * TAU,
    spin: (rand() - 0.5) * 0.12,
    seed: Math.floor(rand() * 1e9)
  };
}

// Does a new obstacle leave enough room around the others and the middle?
function coverFits(o, placed, W, H) {
  const margin = 24;
  if (o.shape === 'circle') {
    if (o.x - o.r < margin || o.x + o.r > W - margin || o.y - o.r < margin || o.y + o.r > H - margin) return false;
  } else if (o.x < margin || o.x + o.w > W - margin || o.y < margin || o.y + o.h > H - margin) return false;
  if (obstacleOverlap(W / 2, H / 2, SPAWN_CLEAR, o)) return false;
  for (const p of placed) {
    if (o.shape === 'circle' && obstacleOverlap(o.x, o.y, o.r + COVER_GAP, p)) return false;
    if (o.shape === 'rect') {
      if (p.shape === 'circle' && circleRectOverlap(p.x, p.y, p.r + COVER_GAP, o)) return false;
      if (p.shape === 'rect' && o.x < p.x + p.w + COVER_GAP && o.x + o.w + COVER_GAP > p.x &&
          o.y < p.y + p.h + COVER_GAP && o.y + o.h + COVER_GAP > p.y) return false;
    }
  }
  return true;
}

// Cover for one regular wave. Only the middle is kept clear (not where the
// ships are), so every pilot on the same seed gets the same map; callers
// nudge ships out of any cover they end up inside.
export function generateCover(sector, W, H, rand) {
  const cover = sector.cover;
  const [lo, hi] = cover.count;
  const want = lo + Math.floor(rand() * (hi - lo + 1)) + Math.min(2, sector.loop);
  const layout = cover.layouts[(sector.waveInSector + Math.floor(rand() * 2)) % cover.layouts.length];
  const placed = [];
  for (const spot of layoutSpots(layout, want, rand, W, H)) {
    if (placed.length >= want) break;
    const kind = cover.kinds[Math.floor(rand() * cover.kinds.length)];
    const o = makeCover(kind, spot.x, spot.y, rand, W, H);
    if (coverFits(o, placed, W, H)) placed.push(o);
  }
  return placed;
}

// Nearest open spot for a ship that ended up inside cover.
export function freeSpot(obstacles, x, y, r, W, H) {
  if (!insideObstacle(obstacles, x, y, r + 4)) return { x, y };
  if (!insideObstacle(obstacles, W / 2, H / 2, r + 4)) return { x: W / 2, y: H / 2 };
  for (let rad = 40; rad < Math.max(W, H); rad += 30) {
    for (let ang = 0; ang < TAU; ang += Math.PI / 8) {
      const tx = x + Math.cos(ang) * rad, ty = y + Math.sin(ang) * rad;
      if (tx > r && tx < W - r && ty > r && ty < H - r && !insideObstacle(obstacles, tx, ty, r + 4)) return { x: tx, y: ty };
    }
  }
  return { x, y };
}

// ------------------------------------------------------------
// HAZARDS
// ------------------------------------------------------------
// Each sector brings its own trouble (see sectors.js `hazards`):
//   rock    drifting asteroids that wrap around the screen. Shoot them and
//           they split (big → medium → small), Asteroids style. They hurt
//           on contact and soak up enemy fire.
//   mine    proximity mines: arm when a pilot gets close, blow after a short
//           fuse. Shoot one to set it off early; blasts hurt enemies too
//           and chain into nearby mines.
//   well    gravity wells: pull every ship and bend every bullet nearby.
//           The core hurts.
//   gate    laser fences between two pylons, cycling off / flicker / on.
//   comet   streaks across the arena after a warning at the edge.
//   flare   solar flare: a lane flashes a warning, then burns.
//   strike  ion storm lightning: a marked circle, then a bolt.
//   pulse   shock rings rolling out from a point. Dash through them.
// Counts (rocks, mines, wells, gates) are placed when the wave starts.
// The rest arrive on timers (every N seconds) until the wave is clear.
export const HAZARD_TIMED = ['comets', 'flares', 'strikes', 'pulses'];
export const ROCK_TIERS = {
  3: { r: 34, hp: 5, score: 15 },
  2: { r: 20, hp: 3, score: 10 },
  1: { r: 11, hp: 1, score: 5 }
};

export function rockRadius(tier, W, H) {
  return Math.round(ROCK_TIERS[tier].r * (0.75 + spaceScale(W, H) * 0.25));
}

function randomPilot(hw) {
  const pilots = hw.pilots();
  if (!pilots.length) return { x: hw.W / 2, y: hw.H / 2 };
  // One pilot: no roll, so single player's seeded stream stays as it was
  if (pilots.length === 1) return pilots[0];
  return pilots[Math.floor(hw.rand() * pilots.length) % pilots.length];
}

function nearestPilotDist(hw, x, y) {
  let best = Infinity;
  for (const p of hw.pilots()) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  return best;
}

// Place the wave's hazards and start the timers. `boss` waves use the
// sector's bossHazards (usually none); wave 1 is always calm.
export function setupHazards(hw, waveNum, boss) {
  hw.hazards.length = 0;
  hw.clock = {};
  hw.wells = null;
  const sector = hw.sector;
  const cfg = waveNum === 1 ? {} : boss ? (sector.bossHazards || {}) : (sector.hazards || {});
  const rand = hw.rand;
  const { W, H } = hw;
  // A little more trouble deeper into a sector, and on every lap of the 20
  const ramp = (1 + sector.waveInSector * 0.12 + sector.loop * 0.35) * (waveNum === 2 ? 0.6 : 1);
  // Small screens get fewer rocks and mines than a desktop-sized arena
  const area = Math.max(0.45, Math.min(1.3, (W * H) / (1280 * 720)));
  const count = (n) => (n ? Math.max(1, Math.round(n * ramp * area)) : 0);
  // Spots are rolled without looking at the ships (same layout for every
  // pilot on a seed); one that lands on a ship is mirrored across the
  // arena instead of re-rolled.
  const openSpot = (d, r) => {
    for (let k = 0; k < 30; k++) {
      let x = r + rand() * (W - r * 2), y = r + rand() * (H - r * 2);
      if (Math.hypot(x - W / 2, y - H / 2) < d * 0.6 || insideObstacle(hw.obstacles, x, y, r + 20)) continue;
      if (nearestPilotDist(hw, x, y) < d && !insideObstacle(hw.obstacles, W - x, H - y, r + 20)) { x = W - x; y = H - y; }
      return { x, y };
    }
    return null;
  };

  for (let k = 0; k < count(cfg.rocks); k++) {
    const at = openSpot(230, 40);
    if (!at) continue;
    const a = rand() * TAU, sp = 25 + rand() * 45;
    spawnHazard(hw, 'rock', { x: at.x, y: at.y, tier: rand() < 0.7 ? 3 : 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, variant: Math.floor(rand() * 4) });
  }
  for (let k = 0; k < count(cfg.mines); k++) {
    const at = openSpot(170, 30);
    if (at) spawnHazard(hw, 'mine', at);
  }
  for (let k = 0; k < (cfg.wells || 0) + (cfg.wells ? Math.min(1, sector.loop) : 0); k++) {
    const at = openSpot(260, 60);
    if (at) spawnHazard(hw, 'well', at);
  }
  for (let k = 0; k < (cfg.gates || 0); k++) {
    for (let tries = 0; tries < 20; tries++) {
      const len = 170 + rand() * 150;
      const a = rand() * Math.PI;
      const cx = W * (0.2 + rand() * 0.6), cy = H * (0.2 + rand() * 0.6);
      const x1 = cx - Math.cos(a) * len / 2, y1 = cy - Math.sin(a) * len / 2;
      const x2 = cx + Math.cos(a) * len / 2, y2 = cy + Math.sin(a) * len / 2;
      const inside = (x, y) => x > 30 && x < W - 30 && y > 30 && y < H - 30;
      if (!inside(x1, y1) || !inside(x2, y2)) continue;
      if (insideObstacle(hw.obstacles, x1, y1, 40) || insideObstacle(hw.obstacles, x2, y2, 40)) continue;
      if (segDist(W / 2, H / 2, x1, y1, x2, y2) < 90) continue;
      // Gates start somewhere in their off phase, so there's time to step clear
      spawnHazard(hw, 'gate', { x1, y1, x2, y2, offset: rand() * 1.2 });
      break;
    }
  }
  for (const kind of HAZARD_TIMED) {
    if (cfg[kind]) {
      const every = cfg[kind] / Math.sqrt(ramp);
      hw.clock[kind] = { every, left: 2.5 + rand() * every * 0.6 };
    }
  }
}

// Make a hazard. Bosses call this too (Colossus calves rocks, Arachne lays
// mines, Helios throws flares, Singularity opens wells).
export function spawnHazard(hw, kind, props = {}) {
  const sector = hw.sector;
  const rnd = hw.rand;
  const { W, H } = hw;
  let h = null;
  if (kind === 'rock') {
    const tier = props.tier || 3;
    const rk = sector.rockKind || 'stone';
    h = {
      kind, tier, x: props.x, y: props.y, vx: props.vx || 0, vy: props.vy || 0,
      r: rockRadius(tier, W, H) * 0.92, hp: ROCK_TIERS[tier].hp * (1 + (hw.diff - 1) * 0.2),
      rot: Math.random() * TAU, spin: (Math.random() - 0.5) * (4 - tier) * 0.6,
      rockKind: rk, variant: props.variant ?? Math.floor(Math.random() * 4),
      hitFlash: 0, owner: props.owner || null
    };
  } else if (kind === 'mine') {
    const a = rnd() * TAU;
    h = {
      kind, x: props.x, y: props.y, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8,
      r: 11, trigger: 72, blast: 88, fuse: 0, fuseMax: 0.7, hp: 1, seed: Math.random() * 10,
      owner: props.owner || null
    };
  } else if (kind === 'well') {
    h = {
      kind, x: props.x, y: props.y, core: props.core || 16, reach: props.reach || 240,
      strength: props.strength || 135, seed: Math.random() * 10, life: props.life || 0,
      color: '#b847ff', disk: sector.secondary || '#ff9f43',
      owner: props.owner || null
    };
  } else if (kind === 'gate') {
    const pylonR = 12;
    h = {
      kind, x1: props.x1, y1: props.y1, x2: props.x2, y2: props.y2,
      x: (props.x1 + props.x2) / 2, y: (props.y1 + props.y2) / 2,
      pylonR, width: 7, t: props.offset || 0, offTime: 2.4, warnTime: 0.7, onTime: 2.2, state: 'off',
      color: sector.accent
    };
    hw.obstacles.push({ shape: 'circle', kind: 'pylon', x: props.x1, y: props.y1, r: pylonR, noDraw: true });
    hw.obstacles.push({ shape: 'circle', kind: 'pylon', x: props.x2, y: props.y2, r: pylonR, noDraw: true });
  } else if (kind === 'comet') {
    // Enter from a random edge, aimed through the middle of the arena
    const side = Math.floor(rnd() * 4);
    const m = 60;
    let x, y;
    if (side === 0) { x = rnd() * W; y = -m; }
    else if (side === 1) { x = W + m; y = rnd() * H; }
    else if (side === 2) { x = rnd() * W; y = H + m; }
    else { x = -m; y = rnd() * H; }
    const tx = W * (0.25 + rnd() * 0.5), ty = H * (0.25 + rnd() * 0.5);
    const a = Math.atan2(ty - y, tx - x), sp = 560 + rnd() * 120;
    h = {
      kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 14, warn: 1.3,
      markX: Math.max(18, Math.min(W - 18, x)), markY: Math.max(18, Math.min(H - 18, y))
    };
  } else if (kind === 'flare') {
    const axis = props.axis || (rnd() < 0.5 ? 'x' : 'y');
    let pos = props.pos;
    if (pos === undefined) {
      if (rnd() < 0.5) { const p = randomPilot(hw); pos = axis === 'x' ? p.x : p.y; }
      else pos = (axis === 'x' ? W : H) * (0.15 + rnd() * 0.7);
    }
    h = { kind, axis, pos, half: 36 + rnd() * 16, warn: 1.6, warnMax: 1.6, burn: 0.55, burnMax: 0.55, hit: false, owner: props.owner || null };
  } else if (kind === 'strike') {
    const p = randomPilot(hw);
    h = {
      kind, x: Math.max(30, Math.min(W - 30, p.x + (rnd() - 0.5) * 240)),
      y: Math.max(30, Math.min(H - 30, p.y + (rnd() - 0.5) * 240)),
      r: 46, warn: 1.1, warnMax: 1.1, burn: 0.25, burnMax: 0.25, struck: false, boltSeed: Math.random()
    };
  } else if (kind === 'pulse') {
    let x = W / 2, y = H / 2;
    for (let k = 0; k < 10; k++) {
      x = W * (0.1 + rnd() * 0.8); y = H * (0.1 + rnd() * 0.8);
      if (nearestPilotDist(hw, x, y) > 220) break;
    }
    h = { kind, x, y, warn: 1.0, warnMax: 1.0, radius: 0, speed: 240, maxRadius: Math.hypot(W, H), thick: 7, hit: false, color: sector.accent };
  }
  if (h) {
    if (hw.nextId) h.id = hw.nextId();
    hw.hazards.push(h);
  }
  return h;
}

export function removeHazard(hw, h) {
  h.dead = true;
  const i = hw.hazards.indexOf(h);
  if (i >= 0) hw.hazards.splice(i, 1);
}

// Gravity toward (x, y) on one ship, sliding around cover.
export function pullShip(obstacles, s, x, y, strength, reach, dt) {
  const dx = x - s.x, dy = y - s.y;
  const d = Math.hypot(dx, dy);
  if (d > reach || d < 1) return;
  const f = strength * Math.max(0.3, 1 - d / reach);
  const res = resolveMove(obstacles, s.x, s.y, s.x + (dx / d) * f * dt, s.y + (dy / d) * f * dt, s.r || 12);
  s.x = res.x;
  s.y = res.y;
}

// Bend a bullet toward any gravity well in reach. True if it got swallowed.
export function applyWellGravity(wells, b, dt) {
  if (!wells) return false;
  for (const w of wells) {
    const dx = w.x - b.x, dy = w.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < w.core) return true;
    if (d > w.reach) continue;
    const f = w.strength * 7 * (1 - d / w.reach);
    b.vx += (dx / d) * f * dt;
    b.vy += (dy / d) * f * dt;
  }
  return false;
}

// A rock or mine the shot overlaps (and hasn't already hit), or null.
export function hazardHitByShot(hw, shot) {
  for (const h of hw.hazards) {
    if ((h.kind !== 'rock' && h.kind !== 'mine') || (shot.hitIds && shot.hitIds.has(h))) continue;
    const dx = shot.x - h.x, dy = shot.y - h.y, rr = shot.r + h.r;
    if (dx * dx + dy * dy < rr * rr) return h;
  }
  return null;
}

// Drifting rocks soak up enemy fire.
export function hazardBlocksShot(hw, b) {
  if (b.orbit) return false;
  for (const h of hw.hazards) {
    if (h.kind !== 'rock') continue;
    const dx = b.x - h.x, dy = b.y - h.y, rr = b.r + h.r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// A pilot's shot hits a rock or mine. `shooter` is passed back through
// hw.rockBroken for scoring.
export function damageHazard(hw, h, amt, shooter) {
  if (h.kind === 'mine') { explodeMine(hw, h); return; }
  if (h.kind !== 'rock') return;
  h.hp -= amt;
  h.hitFlash = 0.1;
  if (h.hp <= 0) shatterRock(hw, h, shooter);
}

// Split a rock into two smaller ones (or dust if it was small).
export function shatterRock(hw, h, shooter) {
  if (h.dead) return;
  removeHazard(hw, h);
  hw.fx('debris', h);
  if (shooter) {
    const dropCore = h.tier === 1 && hw.rand() < 0.3;
    hw.rockBroken(h, shooter, ROCK_TIERS[h.tier].score, dropCore);
  }
  if (h.tier > 1) {
    const base = Math.atan2(h.vy, h.vx) + Math.PI / 2;
    const sp = Math.hypot(h.vx, h.vy) * 1.3 + 40;
    for (const s of [-1, 1]) {
      const a = base + (s > 0 ? 0 : Math.PI) + (hw.rand() - 0.5) * 0.6;
      spawnHazard(hw, 'rock', {
        x: h.x + Math.cos(a) * h.r * 0.4, y: h.y + Math.sin(a) * h.r * 0.4,
        tier: h.tier - 1, vx: Math.cos(a) * sp + h.vx * 0.5, vy: Math.sin(a) * sp + h.vy * 0.5, variant: h.variant
      });
    }
  }
}

export function explodeMine(hw, m) {
  if (m.dead) return;
  removeHazard(hw, m);
  hw.fx('mine', m);
  if (hw.live) {
    for (const p of hw.pilots()) {
      if (Math.hypot(p.x - m.x, p.y - m.y) < m.blast + p.r * 0.5) hw.hurt(p);
    }
  }
  for (const e of [...hw.enemies()]) {
    if (e.dead || hw.isBoss(e)) continue;
    if (Math.hypot(e.x - m.x, e.y - m.y) < m.blast + e.r) hw.hitEnemy(e, 5 * Math.sqrt(hw.diff));
  }
  // Chain reaction: nearby mines go off a beat later
  for (const o of hw.hazards) {
    if (o.kind === 'mine' && Math.hypot(o.x - m.x, o.y - m.y) < m.blast * 1.4 && (o.fuse <= 0 || o.fuse > 0.15)) {
      o.fuse = o.fuseMax = 0.15;
    }
    if (o.kind === 'rock' && Math.hypot(o.x - m.x, o.y - m.y) < m.blast + o.r) o.hp -= 3;
  }
}

export function updateHazards(hw, dt) {
  const { W, H } = hw;
  // Once the wave is clear, leftovers keep drifting but can't hurt anyone
  const live = hw.live;
  const pilots = hw.pilots();
  const hurtIf = (test) => {
    if (!live) return;
    for (const p of pilots) if (p.iframes <= 0 && test(p)) hw.hurt(p);
  };
  // Timed hazards keep coming until the wave is clear
  if (live) {
    for (const kind of HAZARD_TIMED) {
      const c = hw.clock[kind];
      if (!c) continue;
      c.left -= dt;
      if (c.left <= 0) {
        c.left = c.every * (0.75 + hw.rand() * 0.5);
        spawnHazard(hw, kind.slice(0, -1));
      }
    }
  }

  let wells = null;
  // Walk a snapshot: rocks split and comets smash things mid-loop
  for (const h of hw.hazards.slice()) {
    if (h.dead) continue;
    if (h.kind === 'rock') {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.spin * dt;
      if (h.hitFlash > 0) h.hitFlash -= dt;
      // Wrap around the screen like the classic
      const m = h.r + 4;
      if (h.x < -m) h.x = W + m; else if (h.x > W + m) h.x = -m;
      if (h.y < -m) h.y = H + m; else if (h.y > H + m) h.y = -m;
      // Bounce off static cover
      for (const o of hw.obstacles) {
        const res = pushOutOf(h.x, h.y, h.r, o);
        if (!res) continue;
        h.x = res.x; h.y = res.y;
        const dot = h.vx * res.nx + h.vy * res.ny;
        if (dot < 0) { h.vx -= 2 * dot * res.nx; h.vy -= 2 * dot * res.ny; }
      }
      if (h.hp <= 0) { shatterRock(hw, h, true); continue; }
      if (live) {
        for (const p of pilots) {
          if (p.iframes > 0 || Math.hypot(h.x - p.x, h.y - p.y) >= h.r + p.r) continue;
          hw.hurt(p);
          shatterRock(hw, h, null);
          break;
        }
      }
    } else if (h.kind === 'mine') {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.x < 30 || h.x > W - 30) h.vx *= -1;
      if (h.y < 30 || h.y > H - 30) h.vy *= -1;
      if (h.fuse > 0) {
        h.fuse -= dt;
        if (h.fuse <= 0) explodeMine(hw, h);
      } else if (live && pilots.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < h.trigger)) {
        h.fuse = h.fuseMax = 0.7;
      }
    } else if (h.kind === 'well') {
      (wells || (wells = [])).push(h);
      if (h.life) {
        h.life -= dt;
        if (h.life <= 0) { hw.fx('wellGone', h); removeHazard(hw, h); continue; }
      }
      if (live) for (const p of pilots) pullShip(hw.obstacles, p, h.x, h.y, h.strength, h.reach, dt);
      hurtIf((p) => Math.hypot(p.x - h.x, p.y - h.y) < h.core + p.r);
    } else if (h.kind === 'gate') {
      h.t = (h.t + dt) % (h.offTime + h.warnTime + h.onTime);
      h.state = h.t < h.offTime ? 'off' : h.t < h.offTime + h.warnTime ? 'warn' : 'on';
      if (h.state === 'on') {
        hurtIf((p) => segDist(p.x, p.y, h.x1, h.y1, h.x2, h.y2) < h.width / 2 + p.r * 0.8);
        for (const e of [...hw.enemies()]) {
          if (!e.dead && !hw.isBoss(e) && segDist(e.x, e.y, h.x1, h.y1, h.x2, h.y2) < h.width / 2 + e.r) hw.hitEnemy(e, 6 * dt);
        }
      }
    } else if (h.kind === 'comet') {
      if (h.warn > 0) { h.warn -= dt; continue; }
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      hw.fx('cometTrail', h);
      hurtIf((p) => Math.hypot(h.x - p.x, h.y - p.y) < h.r + p.r);
      for (const e of [...hw.enemies()]) {
        if (!e.dead && !hw.isBoss(e) && Math.hypot(h.x - e.x, h.y - e.y) < h.r + e.r) hw.hitEnemy(e, 8);
      }
      for (const o of hw.hazards.slice()) {
        if (o.kind === 'rock' && !o.dead && Math.hypot(h.x - o.x, h.y - o.y) < h.r + o.r) shatterRock(hw, o, null);
      }
      if (h.x < -300 || h.x > W + 300 || h.y < -300 || h.y > H + 300) removeHazard(hw, h);
    } else if (h.kind === 'flare') {
      if (h.warn > 0) { h.warn -= dt; continue; }
      h.burn -= dt;
      const inBand = (x, y, r) => Math.abs((h.axis === 'x' ? x : y) - h.pos) < h.half + r;
      if (!h.hit) {
        h.hit = true;
        hw.fx('flare', h);
        for (const e of [...hw.enemies()]) {
          if (!e.dead && !hw.isBoss(e) && inBand(e.x, e.y, e.r)) hw.hitEnemy(e, 4);
        }
      }
      hurtIf((p) => inBand(p.x, p.y, p.r * 0.5));
      // The flare burns away enemy fire in its lane
      hw.dropShots((b) => inBand(b.x, b.y, 0));
      if (h.burn <= 0) removeHazard(hw, h);
    } else if (h.kind === 'strike') {
      if (h.warn > 0) { h.warn -= dt; continue; }
      if (!h.struck) {
        h.struck = true;
        hw.fx('strike', h);
        hurtIf((p) => Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5);
        for (const e of [...hw.enemies()]) {
          if (!e.dead && !hw.isBoss(e) && Math.hypot(e.x - h.x, e.y - h.y) < h.r + e.r) hw.hitEnemy(e, 6);
        }
      }
      h.burn -= dt;
      if (h.burn <= 0) removeHazard(hw, h);
    } else if (h.kind === 'pulse') {
      if (h.warn > 0) { h.warn -= dt; continue; }
      h.radius += h.speed * dt;
      // A ring hits each pilot at most once
      h.hitSet = h.hitSet || new Set();
      if (live) {
        for (const p of pilots) {
          if (h.hitSet.has(p) || p.iframes > 0) continue;
          if (Math.abs(Math.hypot(p.x - h.x, p.y - h.y) - h.radius) < h.thick + p.r * 0.6) {
            h.hitSet.add(p);
            h.hit = true;
            hw.hurt(p);
          }
        }
      }
      if (h.radius > h.maxRadius) removeHazard(hw, h);
    }
  }
  hw.wells = wells;
}

// ------------------------------------------------------------
// Enemy shot motion (the extras bosses use; see enemyShoot in game.js):
//   delay   hang in place this long before moving
//   orbit   { center, vt, vr, minR }: spiral around center (an object with x/y)
//   accel   speed change per second, clamped to [minSpeed, maxSpeed]
//   turn    constant curve in rad/s
//   homing  max turn toward `target` in rad/s, for homeTime seconds
//   grow    radius growth per second, up to maxR
//   burst   { count, speed, color, kind }: pops into a ring when life runs out
// Returns 'swallowed' when an orbiting shot reaches its center (or the
// center died), 'burst' when a burst shell is due, else null.
// ------------------------------------------------------------
export function advanceShot(b, dt, target) {
  const prevX = b.x, prevY = b.y;
  b.age = (b.age || 0) + dt;
  b.life -= dt;
  if (b.delay > 0) {
    b.delay -= dt;
  } else if (b.orbit) {
    const o = b.orbit;
    const dx = b.x - o.center.x, dy = b.y - o.center.y;
    let rr = Math.hypot(dx, dy);
    let th = Math.atan2(dy, dx);
    rr += o.vr * dt;
    th += (o.vt / Math.max(rr, 20)) * dt;
    if (rr <= (o.minR || 8) || o.center.dead) return 'swallowed';
    b.x = o.center.x + Math.cos(th) * rr;
    b.y = o.center.y + Math.sin(th) * rr;
    b.vx = (b.x - prevX) / Math.max(dt, 1e-4);
    b.vy = (b.y - prevY) / Math.max(dt, 1e-4);
  } else {
    if (b.accel) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ns = Math.max(b.minSpeed ?? 30, Math.min(b.maxSpeed ?? 900, sp + b.accel * dt));
      b.vx *= ns / sp; b.vy *= ns / sp;
    }
    if (b.turn) {
      const c = Math.cos(b.turn * dt), sn = Math.sin(b.turn * dt);
      const vx = b.vx * c - b.vy * sn;
      b.vy = b.vx * sn + b.vy * c;
      b.vx = vx;
    }
    if (b.homing && target && b.age < (b.homeTime ?? 2.2)) {
      const cur = Math.atan2(b.vy, b.vx);
      const want = Math.atan2(target.y - b.y, target.x - b.x);
      const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const a = cur + Math.max(-b.homing * dt, Math.min(b.homing * dt, d));
      const sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(a) * sp;
      b.vy = Math.sin(a) * sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  if (b.grow && b.r < (b.maxR || 20)) b.r = Math.min(b.maxR || 20, b.r + b.grow * dt);
  if (b.burst && b.life <= 0) return 'burst';
  return null;
}

// The ring a burst shell pops into. `shoot(x, y, angle, speed, color, opts)`.
export function burstRing(b, shoot, rand) {
  const bs = b.burst;
  const off = rand() * TAU;
  for (let k = 0; k < bs.count; k++) {
    shoot(b.x, b.y, off + (k / bs.count) * TAU, bs.speed, bs.color, { kind: bs.kind || 'orb' });
  }
}
