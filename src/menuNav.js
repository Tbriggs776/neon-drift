// ============================================================
// NEON DRIFT - MENU NAVIGATION (gamepad, TV remote, arrow keys)
// ============================================================
// The overlay menus were built for mouse and touch. This adds spatial
// focus navigation so a controller or TV remote can drive every screen:
//   D-pad / left stick / arrow keys   move focus to the nearest item
//   A / Enter / remote OK             activate the focused item
//   B / Escape / Backspace / Back     press the overlay's back button
// Each overlay names its back button with a data-nav-back attribute.
// Scrollable panes marked data-nav-scroll take up/down until they hit
// an edge, so long lists (leaderboard) stay readable without a pointer.
// ============================================================

const FOCUSABLE = [
  'button', 'input', 'select', 'textarea',
  '.upgrade', '.shop-item', '.meta-node',
  '[data-nav-scroll]'
].join(',');
const NATIVE_FOCUSABLE = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/;
const FIELD = 'input, textarea, select';

const KEY_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const DIRS = ['up', 'down', 'left', 'right'];
// Samsung Tizen (10009) and LG webOS (461) report the remote's Back key this way.
const TV_BACK_KEYCODES = [10009, 461];

const REPEAT_DELAY_MS = 400;
const REPEAT_RATE_MS = 130;
const STICK_THRESHOLD = 0.6;
const SCROLL_STEP = 80;

let navActive = false;   // player is driving menus with keys / pad right now
let tvMode = false;      // TV builds have no pointer, so nav is always on

// Gamepad edge + repeat tracking. Held state is tracked every frame, even
// during gameplay, so a stick held while an overlay pops up doesn't move
// focus until it's released and pressed again.
const padHeld = { up: false, down: false, left: false, right: false };
const padRepeatAt = { up: 0, down: 0, left: 0, right: 0 };
let padLastA = false;
let padLastB = false;
// Android WebView can deliver a pad's very first D-pad press as both Gamepad
// state and an arrow keydown (before the Gamepad API is active). Skip the
// duplicate key so focus moves once.
let padMovedAt = 0;
const PAD_KEY_DEDUPE_MS = 80;

function topOverlay() {
  const shown = document.querySelectorAll('.overlay:not(.hidden)');
  return shown.length ? shown[shown.length - 1] : null;
}

function isVisible(el) {
  if (el.disabled || el.closest('.hidden')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function focusables(overlay) {
  return [...overlay.querySelectorAll(FOCUSABLE)].filter(isVisible);
}

function defaultTarget(overlay) {
  const items = focusables(overlay);
  return items.find(el => el.matches('[data-nav-default]'))
    || items.find(el => el.matches('.upgrade, .shop-item:not(.locked), .meta-node:not(.locked):not(.maxed)'))
    || items.find(el => el.matches('.btn:not(.secondary)'))
    || items[0]
    || null;
}

function focusEl(el) {
  if (!el) return;
  if (!NATIVE_FOCUSABLE.test(el.tagName) && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
  }
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Returns the focused element if it's a live target inside the top overlay.
function currentIn(overlay) {
  const el = document.activeElement;
  if (!el || el === document.body || !overlay.contains(el) || !isVisible(el)) return null;
  return el;
}

function setNavActive(on) {
  navActive = on || tvMode;
  document.body.classList.toggle('nav-active', navActive);
}

function ensureFocus() {
  const overlay = topOverlay();
  if (overlay && !currentIn(overlay)) focusEl(defaultTarget(overlay));
}

function move(dir) {
  const overlay = topOverlay();
  if (!overlay) return;
  const current = currentIn(overlay);
  if (!current) { focusEl(defaultTarget(overlay)); return; }

  if (current.matches('[data-nav-scroll]') && (dir === 'up' || dir === 'down')) {
    const before = current.scrollTop;
    current.scrollTop += dir === 'down' ? SCROLL_STEP : -SCROLL_STEP;
    if (current.scrollTop !== before) return;
  }

  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of focusables(overlay)) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let primary, gap, drift;
    if (dir === 'down') {
      if (cy - fy <= 1 || r.bottom <= from.bottom) continue;
      primary = Math.max(0, r.top - from.bottom);
      gap = Math.max(0, r.left - from.right, from.left - r.right);
      drift = Math.abs(cx - fx);
    } else if (dir === 'up') {
      if (fy - cy <= 1 || r.top >= from.top) continue;
      primary = Math.max(0, from.top - r.bottom);
      gap = Math.max(0, r.left - from.right, from.left - r.right);
      drift = Math.abs(cx - fx);
    } else if (dir === 'right') {
      if (cx - fx <= 1 || r.right <= from.right) continue;
      primary = Math.max(0, r.left - from.right);
      gap = Math.max(0, r.top - from.bottom, from.top - r.bottom);
      drift = Math.abs(cy - fy);
    } else {
      if (fx - cx <= 1 || r.left >= from.left) continue;
      primary = Math.max(0, from.left - r.right);
      gap = Math.max(0, r.top - from.bottom, from.top - r.bottom);
      drift = Math.abs(cy - fy);
    }
    // Stay in the same row / column when possible; drift breaks ties.
    const score = primary + gap * 3 + drift * 0.1;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) focusEl(best);
}

function activate() {
  const overlay = topOverlay();
  if (!overlay) return;
  const el = currentIn(overlay);
  if (!el) { focusEl(defaultTarget(overlay)); return; }
  if (el.matches(FIELD)) { el.focus(); return; }

  const index = focusables(overlay).indexOf(el);
  el.click();
  // The shop and Hangar rebuild their grid on purchase, which drops focus.
  // Put it back on the same slot, or on the default of whatever opened.
  requestAnimationFrame(() => {
    const top = topOverlay();
    if (!top || currentIn(top)) return;
    const after = focusables(top);
    focusEl(top === overlay && after[index] ? after[index] : defaultTarget(top));
  });
}

// Presses the top overlay's back button. Returns true if something handled it,
// so the native Android back handler knows whether to exit the app instead.
export function navBack() {
  const overlay = topOverlay();
  if (!overlay) return false;
  const btn = overlay.dataset.navBack && document.getElementById(overlay.dataset.navBack);
  if (!btn || !isVisible(btn)) return false;
  btn.click();
  return true;
}

// Text fields keep left/right for the caret until it reaches an edge.
// Email inputs don't expose selectionStart, so treat them as always at an edge.
function fieldAllowsNav(field, dir) {
  if (dir === 'up' || dir === 'down') return field.tagName !== 'TEXTAREA';
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (start == null) return true;
  if (dir === 'left') return start === 0 && end === 0;
  return start === field.value.length && end === field.value.length;
}

function onKeyDown(e) {
  const overlay = topOverlay();
  if (!overlay) return;
  const target = e.target instanceof Element ? e.target : null;
  const inField = !!(target && target.matches(FIELD));

  const dir = KEY_DIRS[e.key];
  if (dir) {
    if (inField && !fieldAllowsNav(target, dir)) return;
    e.preventDefault();
    if (performance.now() - padMovedAt < PAD_KEY_DEDUPE_MS) return;
    setNavActive(true);
    move(dir);
    return;
  }

  if (e.key === 'Tab') { setNavActive(true); return; }

  if (e.key === 'Enter' || (e.key === ' ' && !inField && target?.tagName !== 'BUTTON')) {
    // Fields keep Enter for their own submit handlers (join room, friend search).
    if (inField) return;
    e.preventDefault();
    setNavActive(true);
    activate();
    return;
  }

  const isBack = e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack'
    || (e.key === 'Backspace' && !inField)
    || TV_BACK_KEYCODES.includes(e.keyCode);
  // defaultPrevented: the game already used Escape to toggle pause.
  if (isBack && !e.defaultPrevented && navBack()) e.preventDefault();
}

function pressed(gp, i) {
  const b = gp.buttons[i];
  return !!(b && (b.pressed || b.value > 0.5));
}

// Called once per frame from the game's gamepad poll with the active pad.
export function navGamepadFrame(gp, now) {
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  const held = {
    up: pressed(gp, 12) || ly < -STICK_THRESHOLD,
    down: pressed(gp, 13) || ly > STICK_THRESHOLD,
    left: pressed(gp, 14) || lx < -STICK_THRESHOLD,
    right: pressed(gp, 15) || lx > STICK_THRESHOLD
  };
  const a = pressed(gp, 0);
  const b = pressed(gp, 1);
  const overlay = topOverlay();

  for (const dir of DIRS) {
    if (!held[dir]) {
      padRepeatAt[dir] = 0;
    } else if (overlay && !padHeld[dir]) {
      setNavActive(true);
      move(dir);
      padMovedAt = now;
      padRepeatAt[dir] = now + REPEAT_DELAY_MS;
    } else if (overlay && padRepeatAt[dir] && now >= padRepeatAt[dir]) {
      move(dir);
      padRepeatAt[dir] = now + REPEAT_RATE_MS;
    }
    padHeld[dir] = held[dir];
  }

  if (overlay && a && !padLastA) { setNavActive(true); activate(); }
  if (overlay && b && !padLastB) { setNavActive(true); navBack(); }
  padLastA = a;
  padLastB = b;
}

// TV builds: no pointer exists, so keep focus rings on and bump layout for
// couch distance (see html.tv rules in styles.css).
export function setTvMode(on) {
  tvMode = on;
  document.documentElement.classList.toggle('tv', on);
  setNavActive(on);
  if (on) requestAnimationFrame(ensureFocus);
}

export function initMenuNav() {
  window.addEventListener('keydown', onKeyDown);
  // Any pointer use hands control back to mouse / touch and hides focus rings.
  window.addEventListener('pointerdown', () => setNavActive(false), true);

  // When an overlay opens or closes, move focus into whatever is now on top.
  // With no overlay left (gameplay), drop focus from the hidden button so a
  // stray Enter or Space can't press it mid-run.
  const obs = new MutationObserver(() => {
    if (!topOverlay()) {
      const el = document.activeElement;
      if (el && el.closest && el.closest('.overlay')) el.blur();
      return;
    }
    if (navActive) requestAnimationFrame(ensureFocus);
  });
  document.querySelectorAll('.overlay').forEach(el => {
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}
