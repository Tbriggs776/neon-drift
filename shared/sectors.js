// ============================================================
// SECTORS: the 20 maps a run drifts through
// ============================================================
// Every sector lasts 5 waves and ends with its own boss. Clearing the boss
// opens the shop, then the ship jumps to the next sector. After sector 20
// the rotation starts again from sector 1, one tier harder.
//
// Each sector sets:
//   backdrop  colors, nebula, star field and the big feature in the sky
//             (drawn by backdrop.js)
//   cover     the static obstacle kinds and how they're laid out
//   hazards   what drifts, blinks, burns or pulls while you fight
//             counts: rocks, mines, wells, gates (alive for the wave)
//             every-N-seconds: comets, flares, strikes, pulses
//   boss      the enemy type that guards the sector's jump gate
//   altBoss   optional second guard; it and `boss` take turns week by week
//   rock      asteroid colors for this sector (body, shade, rim glow)
// ============================================================

export const WAVES_PER_SECTOR = 5;

export const SECTORS = [
  {
    name: 'OUTER RIM', tagline: 'Where the drift begins',
    accent: '#00f0ff', secondary: '#ff2d95',
    backdrop: {
      top: '#03030c', bottom: '#0a0a24',
      nebula: ['#2b3bbf', '#00b8d9', '#7a2bbf'], nebulaAlpha: 0.2, nebulaStyle: 'clouds',
      stars: 1.1, dust: '#9fe8ff', drift: [-10, 3],
      feature: { type: 'planet', x: 0.84, y: 0.24, r: 0.12, c1: '#4d8dff', c2: '#0a1440', atmo: '#7fd8ff' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['scatter', 'clusters'] },
    hazards: { rocks: 2 },
    rock: { body: '#3a3550', shade: '#15121f', rim: '#00f0ff' },
    boss: 'obelisk'
  },
  {
    name: 'ASTEROID BELT', tagline: 'Mind the rocks',
    accent: '#ffb347', secondary: '#00f0ff',
    backdrop: {
      top: '#07040a', bottom: '#1a0e12',
      nebula: ['#b0612a', '#5a2a6a', '#2a4a7a'], nebulaAlpha: 0.16, nebulaStyle: 'band',
      stars: 0.9, dust: '#ffcf8a', drift: [-18, 6],
      feature: { type: 'sun', x: 0.12, y: 0.16, r: 0.05, core: '#fff3d1', corona: '#ff9f43' }
    },
    cover: { kinds: ['asteroid'], count: [4, 6], layouts: ['belt', 'scatter', 'clusters'] },
    hazards: { rocks: 5 },
    bossHazards: { rocks: 2 },
    rock: { body: '#5a4232', shade: '#1d140e', rim: '#ffb347' },
    boss: 'colossus'
  },
  {
    name: 'CRIMSON NEBULA', tagline: 'Something hatches in the red',
    accent: '#ff2d95', secondary: '#ffea00',
    backdrop: {
      top: '#0c0208', bottom: '#22060f',
      nebula: ['#ff2d55', '#b0124a', '#ff7a3d', '#5a0a3a'], nebulaAlpha: 0.32, nebulaStyle: 'wisps',
      stars: 0.8, dust: '#ff8fb8', drift: [-8, -6],
      feature: { type: 'sun', x: 0.78, y: 0.7, r: 0.09, core: '#ffd1c4', corona: '#ff3860', giant: true }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['clusters', 'scatter'] },
    hazards: { rocks: 2, mines: 3 },
    rock: { body: '#4a2a36', shade: '#1a0a12', rim: '#ff2d95' },
    boss: 'hive'
  },
  {
    name: 'FROZEN EXPANSE', tagline: 'Comets out of the dark',
    accent: '#8ff0ff', secondary: '#b8a4ff',
    backdrop: {
      top: '#020812', bottom: '#08223a',
      nebula: ['#4ac8ff', '#9ab8ff', '#2a6a9a'], nebulaAlpha: 0.18, nebulaStyle: 'clouds',
      stars: 1.2, dust: '#e0faff', drift: [-6, 10],
      feature: { type: 'planet', x: 0.2, y: 0.78, r: 0.14, c1: '#d8f4ff', c2: '#2a4a6a', atmo: '#bff4ff', ring: { tilt: -0.35, color: '#bfe9ff' } }
    },
    cover: { kinds: ['ice'], count: [3, 5], layouts: ['scatter', 'ring'] },
    hazards: { rocks: 3, comets: 7 },
    rockKind: 'ice',
    rock: { body: '#9fd8ee', shade: '#2a5a78', rim: '#8ff0ff' },
    boss: 'glacier'
  },
  {
    name: 'DERELICT FLEET', tagline: 'A graveyard that still bites',
    accent: '#ff3860', secondary: '#ffea00',
    backdrop: {
      top: '#05040a', bottom: '#140c18',
      nebula: ['#5a2a4a', '#2a2a5a', '#7a3a2a'], nebulaAlpha: 0.16, nebulaStyle: 'clouds',
      stars: 1, dust: '#ffb0a0', drift: [-12, 0],
      feature: { type: 'fleet', x: 0.7, y: 0.3, r: 0.3, c1: '#2a2438', glow: '#ff3860' }
    },
    cover: { kinds: ['wreck', 'asteroid'], count: [3, 5], layouts: ['lanes', 'scatter'] },
    hazards: { rocks: 2, mines: 2 },
    rockKind: 'metal',
    rock: { body: '#4a4a58', shade: '#16161e', rim: '#ff3860' },
    boss: 'warden'
  },
  {
    name: 'SOLAR CORONA', tagline: 'Too close to the sun',
    accent: '#ffea00', secondary: '#ff6b35',
    backdrop: {
      top: '#140600', bottom: '#2a0c02',
      nebula: ['#ff9f1a', '#ff3d00', '#ffd23f'], nebulaAlpha: 0.22, nebulaStyle: 'wisps',
      stars: 0.4, dust: '#ffe08a', drift: [-4, 4],
      feature: { type: 'sun', x: 0.5, y: 1.32, r: 0.6, core: '#ffd27a', corona: '#ff5a00', horizon: true }
    },
    cover: { kinds: ['asteroid'], count: [2, 3], layouts: ['scatter'] },
    hazards: { rocks: 1, flares: 6 },
    rock: { body: '#3a1e10', shade: '#140804', rim: '#ffb000' },
    boss: 'helios'
  },
  {
    name: 'THE MINEFIELD', tagline: 'Step lightly',
    accent: '#39ff14', secondary: '#ff3860',
    backdrop: {
      top: '#020804', bottom: '#081a10',
      nebula: ['#1f7a3a', '#0a4a3a', '#4a7a1a'], nebulaAlpha: 0.16, nebulaStyle: 'clouds',
      stars: 1, dust: '#b8ffb0', drift: [-8, 4],
      feature: { type: 'moon', x: 0.82, y: 0.2, r: 0.07, c1: '#a8b8a0', c2: '#1a221a' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['clusters', 'scatter'] },
    hazards: { rocks: 1, mines: 7 },
    bossHazards: { mines: 3 },
    rock: { body: '#33402e', shade: '#10160e', rim: '#39ff14' },
    boss: 'arachne'
  },
  {
    name: 'STORM GIANT', tagline: 'Lightning off the cloud tops',
    accent: '#c08bff', secondary: '#ffea00',
    backdrop: {
      top: '#06040e', bottom: '#120a26',
      nebula: ['#6a3abf', '#3a2a8a'], nebulaAlpha: 0.12, nebulaStyle: 'clouds',
      stars: 0.9, dust: '#d8c0ff', drift: [-14, 0],
      feature: { type: 'gasgiant', x: 0.62, y: 1.12, r: 0.62, c1: '#b48cff', c2: '#2a1650', bands: ['#9a6ae0', '#d0b0ff', '#6a4ab0', '#e8c8ff'], atmo: '#c8a8ff' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['scatter', 'lanes'] },
    hazards: { rocks: 2, strikes: 3.5 },
    rock: { body: '#3e3456', shade: '#14101e', rim: '#c08bff' },
    boss: 'sentinel'
  },
  {
    name: 'PULSAR GRAVEYARD', tagline: 'The lighthouse never sleeps',
    accent: '#5ac8fa', secondary: '#ffffff',
    backdrop: {
      top: '#02030a', bottom: '#060a1a',
      nebula: ['#2a5aff', '#5ac8fa', '#1a1a5a'], nebulaAlpha: 0.2, nebulaStyle: 'wisps',
      stars: 1.3, dust: '#c8ecff', drift: [-8, -4],
      feature: { type: 'pulsar', x: 0.24, y: 0.3, r: 0.02, color: '#bfefff' }
    },
    cover: { kinds: ['asteroid', 'crystal'], count: [3, 5], layouts: ['ring', 'scatter'] },
    hazards: { rocks: 2, pulses: 6 },
    rock: { body: '#2e3a4e', shade: '#0e121c', rim: '#5ac8fa' },
    boss: 'pulsar'
  },
  {
    name: 'ORBITAL RUINS', tagline: 'Laser fences still hold the line',
    accent: '#ff6b35', secondary: '#00f0ff',
    backdrop: {
      top: '#04050a', bottom: '#0e1220',
      nebula: ['#3a4a7a', '#7a3a2a'], nebulaAlpha: 0.14, nebulaStyle: 'clouds',
      stars: 1, dust: '#ffc8a8', drift: [-10, 2],
      feature: { type: 'station', x: 0.78, y: 0.28, r: 0.16, c1: '#3a4258', glow: '#ff6b35' }
    },
    cover: { kinds: ['station', 'wreck'], count: [3, 5], layouts: ['lanes', 'scatter'] },
    hazards: { gates: 2, rocks: 1 },
    rockKind: 'metal',
    rock: { body: '#4a4e5e', shade: '#16181f', rim: '#ff6b35' },
    boss: 'warden'
  },
  {
    name: 'BINARY SUNS', tagline: 'Two stars, one dance',
    accent: '#ffd23f', secondary: '#5ac8fa',
    backdrop: {
      top: '#0a0610', bottom: '#1a1020',
      nebula: ['#ff9f43', '#5ac8fa', '#ff2d95'], nebulaAlpha: 0.18, nebulaStyle: 'wisps',
      stars: 0.8, dust: '#fff0c0', drift: [-6, 6],
      feature: { type: 'binary', x: 0.8, y: 0.2, r: 0.025, coreA: '#fff3c8', coronaA: '#ffb000', coreB: '#e0f4ff', coronaB: '#4aa8ff' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['ring', 'scatter'] },
    hazards: { rocks: 2, flares: 9 },
    rock: { body: '#4a3a2e', shade: '#18120e', rim: '#ffd23f' },
    boss: 'binary'
  },
  {
    name: 'CRYSTAL NEBULA', tagline: 'Light bends here',
    accent: '#5ac8fa', secondary: '#ff2d95',
    backdrop: {
      top: '#060414', bottom: '#120a2a',
      nebula: ['#5ac8fa', '#ff2d95', '#ffea00', '#b847ff'], nebulaAlpha: 0.26, nebulaStyle: 'wisps',
      stars: 1.1, dust: '#ffffff', drift: [-6, -6],
      feature: { type: 'galaxy', x: 0.22, y: 0.28, r: 0.16, c1: '#c8b8ff', c2: '#5ac8fa' }
    },
    cover: { kinds: ['crystal'], count: [3, 5], layouts: ['clusters', 'ring'] },
    hazards: { rocks: 2, mines: 2 },
    rockKind: 'crystal',
    rock: { body: '#6a5aa8', shade: '#1e1638', rim: '#5ac8fa' },
    boss: 'prism',
    altBoss: 'mirage'
  },
  {
    name: 'ABYSSAL VOID', tagline: 'Something long is swimming',
    accent: '#3affd8', secondary: '#b847ff',
    backdrop: {
      top: '#000004', bottom: '#02040c',
      nebula: ['#0a3a4a', '#1a0a3a'], nebulaAlpha: 0.14, nebulaStyle: 'clouds',
      stars: 0.45, dust: '#7affe6', drift: [-4, 2],
      feature: { type: 'none' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['scatter', 'clusters'] },
    hazards: { rocks: 2, wells: 1 },
    rock: { body: '#22303a', shade: '#080c10', rim: '#3affd8' },
    boss: 'leviathan'
  },
  {
    name: 'ENEMY SHIPYARD', tagline: 'They build them here',
    accent: '#ff9f1a', secondary: '#00f0ff',
    backdrop: {
      top: '#05050a', bottom: '#12121c',
      nebula: ['#4a3a2a', '#2a3a5a'], nebulaAlpha: 0.12, nebulaStyle: 'clouds',
      stars: 0.9, dust: '#ffd8a0', drift: [-14, 0],
      feature: { type: 'shipyard', x: 0.5, y: 0.1, r: 0.32, c1: '#2a2a36', glow: '#ff9f1a' }
    },
    cover: { kinds: ['station', 'wreck'], count: [3, 5], layouts: ['lanes', 'clusters'] },
    hazards: { gates: 2, mines: 2 },
    rockKind: 'metal',
    rock: { body: '#4e4a44', shade: '#181614', rim: '#ff9f1a' },
    boss: 'carrier'
  },
  {
    name: 'SUPERNOVA REMNANT', tagline: 'Shockwaves from a dead star',
    accent: '#ff3860', secondary: '#00f0ff',
    backdrop: {
      top: '#08020a', bottom: '#1a0612',
      nebula: ['#ff3860', '#00c8ff', '#ff9f43', '#b847ff'], nebulaAlpha: 0.3, nebulaStyle: 'shell',
      stars: 1, dust: '#ffc0d0', drift: [-6, 4],
      feature: { type: 'remnant', x: 0.5, y: 0.5, r: 0.42, c1: '#ff3860', c2: '#00c8ff' }
    },
    cover: { kinds: ['asteroid', 'crystal'], count: [2, 4], layouts: ['ring', 'scatter'] },
    hazards: { rocks: 2, pulses: 5 },
    rock: { body: '#4a2a3a', shade: '#180a12', rim: '#ff3860' },
    boss: 'warden'
  },
  {
    name: "KRAKEN'S REACH", tagline: 'The nebula has arms',
    accent: '#7aff6a', secondary: '#b847ff',
    backdrop: {
      top: '#020a06', bottom: '#06180e',
      nebula: ['#2aff8a', '#0a8a6a', '#7a2aff', '#1a5a2a'], nebulaAlpha: 0.26, nebulaStyle: 'wisps',
      stars: 0.9, dust: '#c8ffb8', drift: [-6, -4],
      feature: { type: 'planet', x: 0.86, y: 0.76, r: 0.1, c1: '#4aff9a', c2: '#06301a', atmo: '#8affc0' }
    },
    cover: { kinds: ['asteroid'], count: [3, 5], layouts: ['clusters', 'scatter'] },
    hazards: { rocks: 3, wells: 1, mines: 2 },
    rock: { body: '#2a4234', shade: '#0a140e', rim: '#7aff6a' },
    boss: 'kraken'
  },
  {
    name: 'WAR ZONE', tagline: 'The fleet is still shooting',
    accent: '#ff3860', secondary: '#ffea00',
    backdrop: {
      top: '#08040a', bottom: '#1a0a10',
      nebula: ['#7a1a2a', '#3a1a4a', '#7a4a1a'], nebulaAlpha: 0.2, nebulaStyle: 'clouds',
      stars: 0.9, dust: '#ffb8a0', drift: [-20, 2],
      feature: { type: 'fleet', x: 0.3, y: 0.24, r: 0.34, c1: '#2a2030', glow: '#ffea00', battle: true }
    },
    cover: { kinds: ['wreck', 'asteroid'], count: [3, 5], layouts: ['lanes', 'scatter'] },
    hazards: { rocks: 3, strikes: 4, comets: 9 },
    rockKind: 'metal',
    rock: { body: '#4a3e40', shade: '#181214', rim: '#ff3860' },
    boss: 'dreadnought'
  },
  {
    name: 'NEXUS ARRAY', tagline: 'The machines are listening',
    accent: '#00f0ff', secondary: '#b847ff',
    backdrop: {
      top: '#02060c', bottom: '#06122a',
      nebula: ['#00b8ff', '#5a2aff', '#00ffc8'], nebulaAlpha: 0.18, nebulaStyle: 'grid',
      stars: 1, dust: '#a8f8ff', drift: [-8, 8],
      feature: { type: 'station', x: 0.18, y: 0.24, r: 0.14, c1: '#1a2a3a', glow: '#00f0ff', ring: true }
    },
    cover: { kinds: ['station', 'crystal'], count: [3, 5], layouts: ['ring', 'lanes'] },
    hazards: { gates: 3, mines: 2 },
    rockKind: 'metal',
    rock: { body: '#2e3e4e', shade: '#0e141a', rim: '#00f0ff' },
    boss: 'nexus'
  },
  {
    name: 'EVENT HORIZON', tagline: 'Nothing gets out',
    accent: '#b847ff', secondary: '#ff9f43',
    backdrop: {
      top: '#020004', bottom: '#0a0414',
      nebula: ['#5a1aaf', '#ff7a2a', '#1a0a4a'], nebulaAlpha: 0.2, nebulaStyle: 'swirl',
      stars: 1.1, dust: '#e0c0ff', drift: [-4, 4],
      feature: { type: 'blackhole', x: 0.9, y: 0.14, r: 0.03, disk: '#ff9f43', glow: '#b847ff' }
    },
    cover: { kinds: ['asteroid'], count: [2, 4], layouts: ['ring', 'scatter'] },
    hazards: { rocks: 3, wells: 2 },
    rock: { body: '#3a2a4a', shade: '#100a18', rim: '#b847ff' },
    boss: 'singularity'
  },
  {
    name: 'GALACTIC CORE', tagline: 'The heart of everything',
    accent: '#ffea00', secondary: '#ff2d95',
    backdrop: {
      top: '#0a0606', bottom: '#20100a',
      nebula: ['#ffd23f', '#ff6b35', '#ff2d95', '#b847ff'], nebulaAlpha: 0.22, nebulaStyle: 'swirl',
      stars: 1.5, dust: '#fff0c8', drift: [-6, 2],
      feature: { type: 'core', x: 0.5, y: 0.5, r: 0.5, c1: '#fff0c8', c2: '#ff9f43' }
    },
    cover: { kinds: ['asteroid', 'crystal'], count: [3, 5], layouts: ['ring', 'clusters'] },
    hazards: { rocks: 3, wells: 1, pulses: 7, strikes: 6 },
    rock: { body: '#4a3a2a', shade: '#18120a', rim: '#ffea00' },
    boss: 'warden'
  }
];

// Sector for a 1-indexed wave. `number` keeps counting past 20 so the HUD
// can show SECTOR 21, 22... while the map itself loops back to sector 1.
export function sectorForWave(waveNum) {
  const number = Math.floor((Math.max(1, waveNum) - 1) / WAVES_PER_SECTOR);
  const index = number % SECTORS.length;
  const loop = Math.floor(number / SECTORS.length);
  return {
    index,
    number: number + 1,
    loop,
    waveInSector: (Math.max(1, waveNum) - 1) % WAVES_PER_SECTOR,  // 0..4, 4 = boss
    ...SECTORS[index],
    boss: sectorBoss(SECTORS[index])
  };
}

// Weeks since the Monday of 1970-01-05 (UTC). Every pilot, and the server,
// agrees on it without talking to anyone.
export function weekIndex(now = Date.now()) {
  return Math.floor((now / 864e5 + 3) / 7);
}

// A sector with an altBoss swaps guards each week. Mirage debuted the week
// of 2026-10-19 (week 2964), so even weeks from then are the altBoss's.
const ALT_BOSS_DEBUT_WEEK = 2964;
export function sectorBoss(sector, now = Date.now()) {
  if (!sector.altBoss) return sector.boss;
  return (weekIndex(now) - ALT_BOSS_DEBUT_WEEK) % 2 === 0 ? sector.altBoss : sector.boss;
}

// " II", " III"... appended to a sector or boss name on later loops.
export function loopSuffix(loop) {
  if (loop <= 0) return '';
  const numerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return ' ' + (numerals[loop - 1] || `+${loop}`);
}
