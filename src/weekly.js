// ============================================================
// WEEKLY CHALLENGE CONTENT
// ============================================================
// Everything that makes a week's challenge its own, rolled from the week
// (its Monday, YYYY-MM-DD) so every pilot gets the same run with no server
// involved:
//   - a route of generated sectors: one sector's sky recoloured, another's
//     cover, a mix of two sectors' hazards, and a new name
//   - a featured boss guarding the first sector, with two twists; every
//     later sector boss gets one twist
//   - two rules that hold for the whole run
// Pure data: game.js reads it (newRun, getWaveInfo, spawnEnemy...).
// ============================================================

import { SECTORS, WAVES_PER_SECTOR } from '../shared/sectors.js';
import { makeRng } from './rng.js';

// Twists a challenge boss can carry. game.js applies them (applyBossTwists).
export const TWISTS = {
  overclocked:  { name: 'OVERCLOCKED',  desc: 'Moves and fires 30% faster' },
  bulwark:      { name: 'BULWARK',      desc: 'Raises a shield every few seconds' },
  escorted:     { name: 'ESCORTED',     desc: 'Calls in fighter escorts' },
  regenerating: { name: 'REGENERATING', desc: 'Heals when you stop hitting it' },
  volatile:     { name: 'VOLATILE',     desc: 'Bursts into fire and fighters when it dies' },
  fortified:    { name: 'FORTIFIED',    desc: '50% more hull' }
};

// Bosses that already shield themselves don't take Bulwark.
const NO_BULWARK = ['nexus', 'mirage'];

// Rules for the whole run.
export const RULES = {
  glass:     { name: 'GLASS HULL',   desc: 'One hull point, double damage' },
  storm:     { name: 'HAZARD STORM', desc: 'Sector hazards are far denser' },
  swarm:     { name: 'SWARM',        desc: '40% more enemies every wave' },
  overdrive: { name: 'OVERDRIVE',    desc: 'Enemies move 20% faster' },
  coreRush:  { name: 'CORE RUSH',    desc: 'Cores are worth double' }
};

// Hand-picked headliners; other weeks roll one.
const FEATURED_OVERRIDES = {
  '2026-10-19': 'mirage'   // Mirage's debut week
};

const NAME_A = ['SHATTERED', 'HOLLOW', 'BURNING', 'SILENT', 'DROWNED', 'FRACTURED', 'GILDED', 'VIOLET',
  'HAUNTED', 'SUNKEN', 'STATIC', 'ASHEN', 'MIRRORED', 'RUSTED', 'BLEEDING', 'FROZEN', 'ENDLESS', 'FALLEN'];
const NAME_B = ['REACH', 'VEIL', 'SHOAL', 'DRIFT', 'SPIRAL', 'MAW', 'DEEP', 'CROWN', 'LATTICE', 'WAKE',
  'HALO', 'RIFT', 'NARROWS', 'EXPANSE', 'GARDEN', 'SPIRE', 'CHOIR', 'TIDE'];
const TAGLINES = ['Nobody charted this one', 'The map ends here', 'Stranger every week', 'Signals from nowhere',
  'Something new is waiting', 'Only the brave log in', 'Off the edge of the chart', 'Not on any star map',
  'It changes when you blink', 'One week only', 'Every pilot, same sky', 'Fly it before it\'s gone'];

const COUNT_HAZARDS = ['rocks', 'mines', 'wells', 'gates'];

const BOSS_POOL = [...new Set(SECTORS.flatMap((s) => [s.boss, s.altBoss]).filter((b) => b && b !== 'warden'))];

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function weekNumber(week) {
  return Math.floor(Date.parse(week + 'T00:00:00Z') / (7 * 864e5));
}

function pickTwists(rng, boss, n) {
  const pool = Object.keys(TWISTS).filter((t) => !(t === 'bulwark' && NO_BULWARK.includes(boss)));
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export function weeklyChallenge(week) {
  const rng = makeRng('weekly:' + week);
  const featured = FEATURED_OVERRIDES[week] || pick(rng, BOSS_POOL);
  const featuredTwists = pickTwists(rng, featured, 2);
  const rulePool = Object.keys(RULES);
  const rules = [];
  while (rules.length < 2) rules.push(rulePool.splice(Math.floor(rng() * rulePool.length), 1)[0]);
  const ch = { week, featured, featuredTwists, rules, sectors: new Map() };
  ch.first = weeklySector(ch, 0);
  return ch;
}

// Generated sector k (0-based) of the week's route.
function weeklySector(ch, k) {
  if (ch.sectors.has(k)) return ch.sectors.get(k);
  const rng = makeRng(`${ch.week}:${k}`);
  const sky = SECTORS[Math.floor(rng() * SECTORS.length)];
  const shift = 30 + Math.floor(rng() * 11) * 30;
  const coverFrom = SECTORS[Math.floor(rng() * SECTORS.length)];
  const hazA = SECTORS[Math.floor(rng() * SECTORS.length)].hazards || {};
  const hazB = SECTORS[Math.floor(rng() * SECTORS.length)].hazards || {};

  const hazards = { ...hazA };
  const extra = Object.keys(hazB).filter((key) => !(key in hazards));
  if (extra.length) { const key = pick(rng, extra); hazards[key] = hazB[key]; }
  if (ch.rules.includes('storm')) {
    for (const key of Object.keys(hazards)) {
      hazards[key] = COUNT_HAZARDS.includes(key) ? Math.round(hazards[key] * 1.6 + 1) : hazards[key] * 0.6;
    }
  }

  let boss = ch.featured;
  if (k > 0) {
    const others = BOSS_POOL.filter((b) => b !== ch.featured);
    boss = pick(rng, others);
  }
  const home = SECTORS.find((s) => s.boss === boss || s.altBoss === boss);
  const twists = k === 0 ? ch.featuredTwists : pickTwists(rng, boss, 1);

  const sector = recolor({
    name: `${pick(rng, NAME_A)} ${pick(rng, NAME_B)}`,
    tagline: pick(rng, TAGLINES),
    accent: sky.accent, secondary: sky.secondary,
    backdrop: structuredClone(sky.backdrop),
    rock: { ...sky.rock },
    rockKind: sky.rockKind,
    cover: structuredClone(coverFrom.cover),
    hazards,
    bossHazards: home?.bossHazards ? { ...home.bossHazards } : undefined,
    boss,
    twists
  }, shift);
  // Backdrops and rock sprites are cached by index: keep weekly ones apart
  // from the 20 regular sectors and from other weeks.
  sector.index = 100000 + (weekNumber(ch.week) % 1000) * 100 + k;
  ch.sectors.set(k, sector);
  return sector;
}

// Same shape as sectorForWave() in shared/sectors.js.
export function weeklySectorForWave(ch, waveNum) {
  const number = Math.floor((Math.max(1, waveNum) - 1) / WAVES_PER_SECTOR);
  return {
    ...weeklySector(ch, number),
    number: number + 1,
    loop: Math.floor(number / SECTORS.length),
    waveInSector: (Math.max(1, waveNum) - 1) % WAVES_PER_SECTOR
  };
}

// ---- Colour: rotate every #rrggbb in the sky and rocks by `deg` ----
function recolor(sector, deg) {
  const walk = (v) => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return hueShift(v, deg);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v)) v[key] = walk(v[key]);
    }
    return v;
  };
  // Accents colour HUD and card text, so they stay bright after the shift
  sector.accent = readable(hueShift(sector.accent, deg));
  sector.secondary = readable(hueShift(sector.secondary, deg));
  walk(sector.backdrop);
  walk(sector.rock);
  return sector;
}

// Lighten toward white until the colour reads on the dark HUD (pure blue
// is the usual offender).
function readable(hex) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  while (0.299 * r + 0.587 * g + 0.114 * b < 150) {
    [r, g, b] = [r, g, b].map((c) => Math.round(c + (255 - c) * 0.15));
  }
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function hueShift(hex, deg) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
