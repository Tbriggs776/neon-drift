// ============================================================
// SEEDED PRNG (mulberry32)
// ============================================================
// Used for gameplay randomness so runs with the same seed produce
// identical outcomes — foundation for weekly challenges, ghost-run
// replays, and (eventually) deterministic multiplayer.
//
// Cosmetic randomness (particles, screen shake) intentionally stays
// on Math.random() so visual effects can vary between replays
// without breaking determinism of gameplay-affecting rolls.
// ============================================================

let _state = 1;
let _currentSeed = 1;

// Hash a string to a 32-bit int (FNV-1a). Lets us accept either numbers
// or strings (e.g., a challenge slug) as seeds without ceremony.
function hashStringToInt(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function setRandomSeed(seed) {
  const s = typeof seed === 'string' ? hashStringToInt(seed) : (seed >>> 0);
  _state = s || 1;
  _currentSeed = _state;
}

export function getCurrentSeed() {
  return _currentSeed;
}

// mulberry32 — tiny, fast, good statistical properties for games.
export function gameRand() {
  _state = (_state + 0x6D2B79F5) >>> 0;
  let t = _state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function gameRandInt(maxExclusive) {
  return Math.floor(gameRand() * maxExclusive);
}

// Seed at module load so gameRand() works even before a run starts.
setRandomSeed((Date.now() ^ 0xabcdef) >>> 0);
