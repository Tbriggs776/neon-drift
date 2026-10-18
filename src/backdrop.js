// ============================================================
// SPACE BACKDROP
// ============================================================
// Draws a sector's sky behind the action: nebula, three layers of stars,
// the sector's big feature (planet, sun, black hole, galaxy...), drifting
// dust and the odd shooting star. Also draws the hyperspace jump between
// sectors.
//
// The slow parts (nebula, far stars, the feature) are painted once into an
// offscreen canvas per sector and screen size, then blitted every frame.
// Only cheap animated bits are drawn live. Purely cosmetic, so it uses its
// own seeded RNG and never touches gameRand().
// ============================================================

const MARGIN = 48;        // the cache is bigger than the screen so parallax never shows an edge
const PARALLAX = 0.035;   // how far the far sky shifts as the ship moves

let cache = null;         // { key, canvas, near, mid, dust, sector }

function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Blend a color toward white (amt > 0) or black (amt < 0).
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const mix = (c) => Math.round(c + (t - c) * k);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ------------------------------------------------------------
// Cache building
// ------------------------------------------------------------
function buildCache(sector, w, h) {
  const bd = sector.backdrop;
  const rand = mulberry(0x5eed + sector.index * 7919);
  const cw = w + MARGIN * 2, ch = h + MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');

  // Deep space gradient
  const grad = g.createLinearGradient(0, 0, cw * 0.3, ch);
  grad.addColorStop(0, bd.top);
  grad.addColorStop(1, bd.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, cw, ch);

  // Far star dust (tiny, dim, lots of them)
  const farCount = Math.round((cw * ch) / 2600 * (bd.stars || 1));
  for (let i = 0; i < farCount; i++) {
    const a = 0.15 + rand() * 0.45;
    const tint = rand();
    g.fillStyle = tint < 0.12 ? `rgba(255, 210, 230, ${a})` : tint < 0.24 ? `rgba(190, 225, 255, ${a})` : `rgba(255, 255, 255, ${a})`;
    const s = rand() < 0.08 ? 1.5 : 1;
    g.fillRect(rand() * cw, rand() * ch, s, s);
  }

  drawNebula(g, cw, ch, bd, rand, sector);
  drawFeatureStatic(g, cw, ch, bd.feature || { type: 'none' }, rand);

  // A soft vignette pulls the eye to the middle of the arena
  const vig = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, cw, ch);

  // Live star layers, in 0..1 space so they tile at any screen size
  const mkStars = (n, minS, maxS) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const tint = rand();
      out.push({
        x: rand(), y: rand(),
        s: minS + rand() * (maxS - minS),
        tw: 0.6 + rand() * 2.4,
        ph: rand() * Math.PI * 2,
        c: tint < 0.15 ? '#ffd0e8' : tint < 0.3 ? '#bfe4ff' : tint < 0.38 ? '#fff0b0' : '#ffffff'
      });
    }
    return out;
  };
  const density = bd.stars || 1;
  const near = mkStars(Math.round(26 * density), 1.6, 2.6);
  const mid = mkStars(Math.round(70 * density), 0.9, 1.6);
  const dust = [];
  for (let i = 0; i < 34; i++) dust.push({ x: rand(), y: rand(), z: 0.4 + rand() * 0.9, l: 4 + rand() * 10 });

  return { canvas, near, mid, dust, sector, w, h, flash: 0, flashX: 0, flashY: 0, shoot: null, shootCD: 3 + rand() * 4, rand };
}

function drawNebula(g, cw, ch, bd, rand, sector) {
  const colors = bd.nebula || [];
  if (!colors.length) return;
  const alpha = bd.nebulaAlpha || 0.2;
  const style = bd.nebulaStyle || 'clouds';
  const base = Math.min(cw, ch);

  // Paint at half resolution, then scale up: softer and much cheaper
  const nw = Math.ceil(cw / 2), nh = Math.ceil(ch / 2);
  const nc = document.createElement('canvas');
  nc.width = nw;
  nc.height = nh;
  const n = nc.getContext('2d');
  n.globalCompositeOperation = 'lighter';

  const blob = (x, y, r, color, a) => {
    const rg = n.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rgba(color, a));
    rg.addColorStop(0.45, rgba(color, a * 0.45));
    rg.addColorStop(1, rgba(color, 0));
    n.fillStyle = rg;
    n.beginPath();
    n.arc(x, y, r, 0, Math.PI * 2);
    n.fill();
  };
  const pick = () => colors[Math.floor(rand() * colors.length)];
  const nb = base / 2;

  if (style === 'clouds' || style === 'grid') {
    for (let i = 0; i < 16; i++) {
      blob(rand() * nw, rand() * nh, nb * (0.25 + rand() * 0.45), pick(), alpha * (0.5 + rand() * 0.7));
    }
  } else if (style === 'wisps') {
    // Filaments: blobs strung along a few lazy curves
    for (let f = 0; f < 4; f++) {
      const c = pick();
      let x = rand() * nw, y = rand() * nh;
      let ang = rand() * Math.PI * 2;
      const steps = 26;
      for (let s = 0; s < steps; s++) {
        ang += (rand() - 0.5) * 0.6;
        x += Math.cos(ang) * nb * 0.06;
        y += Math.sin(ang) * nb * 0.06;
        blob(x, y, nb * (0.08 + rand() * 0.16), c, alpha * (0.4 + rand() * 0.7));
      }
    }
    for (let i = 0; i < 6; i++) blob(rand() * nw, rand() * nh, nb * (0.3 + rand() * 0.3), pick(), alpha * 0.4);
  } else if (style === 'band') {
    // A dusty diagonal band, like looking along a belt
    const ang = -0.35 + rand() * 0.2;
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const x = t * nw * 1.2 - nw * 0.1;
      const y = nh * 0.5 + Math.tan(ang) * (x - nw / 2) + (rand() - 0.5) * nh * 0.18;
      blob(x, y, nb * (0.1 + rand() * 0.2), pick(), alpha * (0.5 + rand() * 0.6));
    }
  } else if (style === 'shell') {
    // Supernova shell: a ragged ring of glowing gas around the center
    const cx = nw / 2, cy = nh / 2, R = nb * 0.85;
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2;
      const rr = R * (0.85 + rand() * 0.3);
      blob(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9, nb * (0.06 + rand() * 0.12), pick(), alpha * (0.5 + rand() * 0.8));
    }
    blob(cx, cy, R * 0.6, colors[1] || colors[0], alpha * 0.35);
  } else if (style === 'swirl') {
    // Spiral arms around the feature (black hole, galactic core)
    const f = bd.feature || {};
    const cx = (f.x ?? 0.5) * nw, cy = (f.y ?? 0.5) * nh;
    for (let arm = 0; arm < 3; arm++) {
      const c = colors[arm % colors.length];
      const off = (arm / 3) * Math.PI * 2;
      for (let s = 0; s < 34; s++) {
        const t = s / 34;
        const a = off + t * Math.PI * 2.4;
        const r = nb * (0.08 + t * 1.1);
        blob(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, nb * (0.05 + t * 0.18), c, alpha * (1.1 - t * 0.6));
      }
    }
  }

  // Dark dust lanes give the gas some depth
  n.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 5; i++) {
    const x = rand() * nw, y = rand() * nh, r = nb * (0.15 + rand() * 0.3);
    const rg = n.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    n.fillStyle = rg;
    n.fillRect(x - r, y - r, r * 2, r * 2);
  }

  g.save();
  g.globalCompositeOperation = 'lighter';
  g.drawImage(nc, 0, 0, cw, ch);
  g.restore();

  // NEXUS ARRAY: a faint holographic grid etched into the sky
  if (style === 'grid') {
    g.save();
    g.strokeStyle = rgba(sector.accent, 0.07);
    g.lineWidth = 1;
    const step = 64;
    for (let x = 0; x < cw; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ch); g.stroke(); }
    for (let y = 0; y < ch; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); }
    g.restore();
  }
}

// ------------------------------------------------------------
// Features (static part, painted into the cache)
// ------------------------------------------------------------
function drawFeatureStatic(g, cw, ch, f, rand) {
  const base = Math.min(cw, ch);
  const x = (f.x ?? 0.5) * cw, y = (f.y ?? 0.5) * ch, r = (f.r ?? 0.1) * base;
  switch (f.type) {
    case 'planet': drawPlanet(g, x, y, r, f, rand); break;
    case 'gasgiant': drawGasGiant(g, x, y, r, f, rand); break;
    case 'moon': drawMoon(g, x, y, r, f, rand); break;
    case 'sun': drawSun(g, x, y, r, f); break;
    case 'galaxy': drawGalaxy(g, x, y, r, f, rand); break;
    case 'fleet': drawFleet(g, x, y, r, f, rand); break;
    case 'station': drawStationFar(g, x, y, r, f, rand); break;
    case 'shipyard': drawShipyard(g, cw, ch, x, y, r, f, rand); break;
    case 'remnant': drawRemnant(g, x, y, r, f); break;
    case 'core': drawCore(g, x, y, r, f, rand); break;
    default: break;
  }
}

function drawPlanet(g, x, y, r, f, rand) {
  const light = -Math.PI * 0.75;
  if (f.ring) drawRing(g, x, y, r, f.ring, true);
  // Atmosphere halo
  const atmo = g.createRadialGradient(x, y, r * 0.95, x, y, r * 1.35);
  atmo.addColorStop(0, rgba(f.atmo || f.c1, 0.35));
  atmo.addColorStop(1, rgba(f.atmo || f.c1, 0));
  g.fillStyle = atmo;
  g.beginPath(); g.arc(x, y, r * 1.35, 0, Math.PI * 2); g.fill();
  // Body
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  const body = g.createRadialGradient(x + Math.cos(light) * r * 0.45, y + Math.sin(light) * r * 0.45, r * 0.1, x, y, r * 1.05);
  body.addColorStop(0, shade(f.c1, 0.35));
  body.addColorStop(0.5, f.c1);
  body.addColorStop(1, f.c2);
  g.fillStyle = body;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  // Surface: soft continents / cloud streaks
  for (let i = 0; i < 14; i++) {
    const bx = x + (rand() - 0.5) * r * 1.8, by = y + (rand() - 0.5) * r * 1.8;
    g.fillStyle = rand() < 0.5 ? rgba('#ffffff', 0.07) : 'rgba(0, 0, 0, 0.12)';
    g.beginPath();
    g.ellipse(bx, by, r * (0.15 + rand() * 0.35), r * (0.05 + rand() * 0.12), rand() * 0.6 - 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // Night side
  const night = g.createLinearGradient(x + Math.cos(light) * r, y + Math.sin(light) * r, x - Math.cos(light) * r, y - Math.sin(light) * r);
  night.addColorStop(0, 'rgba(0, 0, 0, 0)');
  night.addColorStop(0.55, 'rgba(0, 0, 0, 0.15)');
  night.addColorStop(1, 'rgba(0, 0, 8, 0.85)');
  g.fillStyle = night;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
  // Rim light on the lit edge
  g.save();
  g.strokeStyle = rgba(f.atmo || f.c1, 0.8);
  g.lineWidth = Math.max(1.5, r * 0.025);
  g.shadowColor = f.atmo || f.c1;
  g.shadowBlur = 12;
  g.beginPath(); g.arc(x, y, r, light - 1.2, light + 1.2); g.stroke();
  g.restore();
  if (f.ring) drawRing(g, x, y, r, f.ring, false);
}

function drawRing(g, x, y, r, ring, back) {
  g.save();
  g.translate(x, y);
  g.rotate(ring.tilt || 0);
  const from = back ? Math.PI : 0, to = back ? Math.PI * 2 : Math.PI;
  for (let k = 0; k < 5; k++) {
    g.strokeStyle = rgba(ring.color, (back ? 0.18 : 0.42) * (1 - k * 0.15));
    g.lineWidth = r * 0.05;
    g.beginPath();
    g.ellipse(0, 0, r * (1.5 + k * 0.1), r * (0.32 + k * 0.022), 0, from, to);
    g.stroke();
  }
  g.restore();
}

function drawGasGiant(g, x, y, r, f, rand) {
  const atmo = g.createRadialGradient(x, y, r * 0.97, x, y, r * 1.18);
  atmo.addColorStop(0, rgba(f.atmo || f.c1, 0.4));
  atmo.addColorStop(1, rgba(f.atmo || f.c1, 0));
  g.fillStyle = atmo;
  g.beginPath(); g.arc(x, y, r * 1.18, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = f.c2;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  // Wavy cloud bands
  const bands = f.bands || [f.c1];
  for (let i = 0; i < 26; i++) {
    const by = y - r + (i / 26) * r * 2;
    const bh = r * (0.03 + rand() * 0.06);
    g.fillStyle = rgba(bands[i % bands.length], 0.14 + rand() * 0.16);
    g.beginPath();
    g.moveTo(x - r, by);
    for (let sx = -r; sx <= r; sx += r / 12) {
      g.lineTo(x + sx, by + Math.sin(sx / r * 6 + i) * bh * 0.6);
    }
    g.lineTo(x + r, by + bh);
    g.lineTo(x - r, by + bh);
    g.closePath();
    g.fill();
  }
  // Storm eye
  g.fillStyle = rgba('#ffffff', 0.18);
  g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.55, r * 0.12, r * 0.05, 0.1, 0, Math.PI * 2); g.fill();
  const sh = g.createRadialGradient(x - r * 0.4, y - r * 0.6, r * 0.2, x, y, r * 1.05);
  sh.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
  sh.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
  sh.addColorStop(1, 'rgba(0, 0, 10, 0.8)');
  g.fillStyle = sh;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

function drawMoon(g, x, y, r, f, rand) {
  g.save();
  const body = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, shade(f.c1, 0.3));
  body.addColorStop(0.6, f.c1);
  body.addColorStop(1, f.c2);
  g.fillStyle = body;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.clip();
  for (let i = 0; i < 12; i++) {
    const cx = x + (rand() - 0.5) * r * 1.6, cy = y + (rand() - 0.5) * r * 1.6, cr = r * (0.06 + rand() * 0.16);
    g.fillStyle = 'rgba(0, 0, 0, 0.18)';
    g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, cr, Math.PI, Math.PI * 1.6); g.stroke();
  }
  g.restore();
}

function drawSun(g, x, y, r, f) {
  const glowR = r * (f.horizon ? 1.6 : f.giant ? 3.2 : 4.5);
  const glow = g.createRadialGradient(x, y, r * 0.5, x, y, glowR);
  glow.addColorStop(0, rgba(f.corona, 0.55));
  glow.addColorStop(0.35, rgba(f.corona, 0.18));
  glow.addColorStop(1, rgba(f.corona, 0));
  g.fillStyle = glow;
  g.beginPath(); g.arc(x, y, glowR, 0, Math.PI * 2); g.fill();
  const body = g.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, f.core);
  body.addColorStop(0.7, shade(f.corona, 0.35));
  body.addColorStop(1, f.corona);
  g.save();
  // A sun filling the floor of the screen stays dim, or bullets vanish on it
  if (f.horizon) g.globalAlpha = 0.42;
  g.fillStyle = body;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.restore();
  if (f.horizon) {
    // Granulation and a darker limb
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255, 220, 160, 0.05)' : 'rgba(90, 20, 0, 0.12)';
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.01 + Math.random() * 0.025), 0, Math.PI * 2); g.fill();
    }
    const limb = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    limb.addColorStop(0, 'rgba(40, 8, 0, 0.35)');
    limb.addColorStop(0.85, 'rgba(40, 8, 0, 0)');
    limb.addColorStop(1, 'rgba(255, 140, 40, 0.25)');
    g.fillStyle = limb;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }
}

function drawGalaxy(g, x, y, r, f, rand) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.5);
  g.scale(1, 0.45);
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
  core.addColorStop(0, rgba('#ffffff', 0.7));
  core.addColorStop(0.3, rgba(f.c1, 0.35));
  core.addColorStop(1, rgba(f.c1, 0));
  g.fillStyle = core;
  g.beginPath(); g.arc(0, 0, r * 0.4, 0, Math.PI * 2); g.fill();
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 900; i++) {
      const t = rand();
      const a = arm * Math.PI + t * Math.PI * 3;
      const d = r * t + (rand() - 0.5) * r * 0.12;
      g.fillStyle = rgba(rand() < 0.6 ? f.c1 : f.c2, 0.25 * (1 - t) + 0.05);
      g.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1.4, 1.4);
    }
  }
  g.restore();
}

function hullSilhouette(g, len, h, rand, c1, glow, lit) {
  // A long capital ship: wedge prow, stepped superstructure, engine block
  g.fillStyle = c1;
  g.strokeStyle = rgba(glow, 0.35);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(len * 0.5, 0);
  g.lineTo(len * 0.2, -h * 0.5);
  g.lineTo(-len * 0.1, -h * 0.55);
  g.lineTo(-len * 0.15, -h * 0.9);
  g.lineTo(-len * 0.3, -h * 0.9);
  g.lineTo(-len * 0.35, -h * 0.6);
  g.lineTo(-len * 0.5, -h * 0.6);
  g.lineTo(-len * 0.5, h * 0.5);
  g.lineTo(len * 0.25, h * 0.45);
  g.closePath();
  g.fill();
  g.stroke();
  if (lit) {
    for (let i = 0; i < 18; i++) {
      g.fillStyle = rgba(rand() < 0.7 ? '#ffe9b0' : glow, 0.5 + rand() * 0.4);
      g.fillRect(-len * 0.45 + rand() * len * 0.8, -h * 0.4 + rand() * h * 0.8, 1.5, 1.5);
    }
  }
  // Engine glow
  g.fillStyle = rgba(glow, 0.5);
  g.fillRect(-len * 0.52, -h * 0.4, 3, h * 0.8);
}

function drawFleet(g, x, y, r, f, rand) {
  // Derelict capital ships hanging in the dark, some broken in half
  const ships = 4;
  for (let i = 0; i < ships; i++) {
    const sx = x + (rand() - 0.5) * r * 2.2;
    const sy = y + (rand() - 0.5) * r * 0.9;
    const len = r * (0.35 + rand() * 0.5);
    g.save();
    g.translate(sx, sy);
    g.rotate(-0.2 + (rand() - 0.5) * 0.5);
    g.globalAlpha = 0.4 + rand() * 0.25;
    hullSilhouette(g, len, len * 0.16, rand, f.c1, f.glow, !!f.battle || rand() < 0.4);
    g.restore();
  }
}

function drawStationFar(g, x, y, r, f, rand) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.25);
  // Ring habitat
  g.strokeStyle = f.c1;
  g.lineWidth = r * 0.12;
  g.beginPath(); g.ellipse(0, 0, r, r * 0.38, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = rgba(f.glow, 0.35);
  g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(0, 0, r * 1.06, r * 0.41, 0, 0, Math.PI * 2); g.stroke();
  // Spokes and hub
  g.strokeStyle = f.c1;
  g.lineWidth = r * 0.04;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.38); g.stroke();
  }
  g.fillStyle = shade(f.c1, 0.15);
  g.beginPath(); g.arc(0, 0, r * 0.16, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rgba(f.glow, 0.6);
  g.lineWidth = 1;
  g.stroke();
  // Solar wings
  g.fillStyle = rgba('#3a5aa8', 0.55);
  g.fillRect(-r * 0.05, -r * 0.75, r * 0.1, r * 0.55);
  g.fillRect(-r * 0.05, r * 0.2, r * 0.1, r * 0.55);
  g.restore();
}

function drawShipyard(g, cw, ch, x, y, r, f, rand) {
  // Scaffolding girders across the top of the sky with a half-built hull
  g.save();
  g.globalAlpha = 0.45;
  g.strokeStyle = rgba(shade(f.c1, 0.2), 0.9);
  g.lineWidth = 2;
  const top = y - r * 0.35, bot = y + r * 0.25;
  g.beginPath(); g.moveTo(0, top); g.lineTo(cw, top + r * 0.1); g.stroke();
  g.beginPath(); g.moveTo(0, bot); g.lineTo(cw, bot + r * 0.1); g.stroke();
  g.lineWidth = 1;
  for (let sx = 0; sx < cw; sx += 46) {
    const t1 = top + (sx / cw) * r * 0.1, t2 = bot + (sx / cw) * r * 0.1;
    g.beginPath(); g.moveTo(sx, t1); g.lineTo(sx + 46, t2); g.moveTo(sx, t1); g.lineTo(sx, t2); g.stroke();
  }
  g.translate(x, (top + bot) / 2 + r * 0.05);
  g.globalAlpha = 0.55;
  hullSilhouette(g, r * 1.3, r * 0.22, rand, f.c1, f.glow, true);
  g.restore();
}

function drawRemnant(g, x, y, r, f) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(x, y, 0, x, y, r * 0.18);
  core.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  core.addColorStop(0.2, rgba(f.c2, 0.4));
  core.addColorStop(1, rgba(f.c2, 0));
  g.fillStyle = core;
  g.beginPath(); g.arc(x, y, r * 0.18, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawCore(g, x, y, r, f, rand) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const bulge = g.createRadialGradient(x, y, 0, x, y, r);
  bulge.addColorStop(0, rgba(f.c1, 0.3));
  bulge.addColorStop(0.25, rgba(f.c2, 0.12));
  bulge.addColorStop(1, rgba(f.c2, 0));
  g.fillStyle = bulge;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 1400; i++) {
    const a = rand() * Math.PI * 2, d = Math.pow(rand(), 2) * r;
    g.fillStyle = rgba(rand() < 0.5 ? f.c1 : '#ffffff', 0.08 + rand() * 0.2);
    g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 1.2, 1.2);
  }
  g.restore();
}

// ------------------------------------------------------------
// Per-frame drawing
// ------------------------------------------------------------
// view.px / view.py: the ship's offset from screen center, for parallax.
export function drawSpaceBackdrop(ctx, w, h, sector, time, view = { px: 0, py: 0 }, dt = 0.016) {
  const key = `${sector.index}:${w}x${h}`;
  if (!cache || cache.key !== key) {
    cache = buildCache(sector, w, h);
    cache.key = key;
  }
  const c = cache;
  const bd = sector.backdrop;
  const base = Math.min(w, h);
  const ox = Math.max(-MARGIN, Math.min(MARGIN, -view.px * PARALLAX));
  const oy = Math.max(-MARGIN, Math.min(MARGIN, -view.py * PARALLAX));

  ctx.drawImage(c.canvas, -MARGIN + ox, -MARGIN + oy);

  // Feature animation (sits on the far layer, so it moves with the cache)
  const f = bd.feature || { type: 'none' };
  const fx = (f.x ?? 0.5) * (w + MARGIN * 2) - MARGIN + ox;
  const fy = (f.y ?? 0.5) * (h + MARGIN * 2) - MARGIN + oy;
  const fr = (f.r ?? 0.1) * (base + MARGIN * 2);
  drawFeatureLive(ctx, f, fx, fy, fr, time, c, w, h, dt);

  // Star layers drift with the sector current and shift with the ship
  const [driftX, driftY] = bd.drift || [-10, 0];
  const layer = (stars, depth, glow) => {
    const sx = time * driftX * depth - view.px * PARALLAX * depth * 4;
    const sy = time * driftY * depth - view.py * PARALLAX * depth * 4;
    for (const s of stars) {
      let x = (s.x * w + sx) % w; if (x < 0) x += w;
      let y = (s.y * h + sy) % h; if (y < 0) y += h;
      const tw = 0.55 + 0.45 * Math.sin(time * s.tw + s.ph);
      ctx.globalAlpha = tw;
      ctx.fillStyle = s.c;
      ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      if (glow && s.s > 2.2 && tw > 0.8) {
        // Diffraction spikes on the brightest stars
        ctx.globalAlpha = (tw - 0.8) * 2.5;
        ctx.fillRect(x - s.s * 2.5, y - 0.5, s.s * 5, 1);
        ctx.fillRect(x - 0.5, y - s.s * 2.5, 1, s.s * 5);
      }
    }
    ctx.globalAlpha = 1;
  };
  ctx.save();
  layer(c.mid, 0.6, false);
  layer(c.near, 1.3, true);

  // Space dust streaks, the closest layer
  ctx.strokeStyle = rgba(bd.dust || '#ffffff', 0.22);
  ctx.lineWidth = 1;
  const dmag = Math.hypot(driftX, driftY) || 1;
  const ux = driftX / dmag, uy = driftY / dmag;
  ctx.beginPath();
  for (const d of c.dust) {
    const sx = time * driftX * 3 * d.z - view.px * PARALLAX * 8 * d.z;
    const sy = time * driftY * 3 * d.z - view.py * PARALLAX * 8 * d.z;
    let x = (d.x * w + sx) % w; if (x < 0) x += w;
    let y = (d.y * h + sy) % h; if (y < 0) y += h;
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * d.l * d.z, y - uy * d.l * d.z);
  }
  ctx.stroke();

  // The odd shooting star
  c.shootCD -= dt;
  if (!c.shoot && c.shootCD <= 0) {
    const a = Math.PI * (0.15 + Math.random() * 0.2) + (Math.random() < 0.5 ? 0 : Math.PI * 0.5);
    c.shoot = { x: Math.random() * w, y: Math.random() * h * 0.5, a, life: 0.7 };
    c.shootCD = 5 + Math.random() * 7;
  }
  if (c.shoot) {
    const s = c.shoot;
    s.life -= dt;
    s.x += Math.cos(s.a) * 900 * dt;
    s.y += Math.sin(s.a) * 900 * dt;
    const k = Math.max(0, s.life / 0.7);
    const tail = ctx.createLinearGradient(s.x, s.y, s.x - Math.cos(s.a) * 120, s.y - Math.sin(s.a) * 120);
    tail.addColorStop(0, `rgba(255, 255, 255, ${0.8 * k})`);
    tail.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = tail;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(s.a) * 120, s.y - Math.sin(s.a) * 120); ctx.stroke();
    if (s.life <= 0) c.shoot = null;
  }
  ctx.restore();
}

function drawFeatureLive(ctx, f, x, y, r, time, c, w, h, dt) {
  ctx.save();
  if (f.type === 'sun') {
    // Breathing corona
    const pulse = 1 + Math.sin(time * 1.3) * 0.06;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.7 * pulse);
    g.addColorStop(0, rgba(f.corona, 0.35));
    g.addColorStop(1, rgba(f.corona, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 1.7 * pulse, 0, Math.PI * 2); ctx.fill();
    // Diffraction spikes, like a bright star in a telescope photo
    if (!f.horizon) {
      const len = Math.min(r * 4.5, 160) * (1 + Math.sin(time * 0.9) * 0.08);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        const sg = ctx.createLinearGradient(x, y, ex, ey);
        sg.addColorStop(0, 'rgba(255, 250, 235, 0.5)');
        sg.addColorStop(1, 'rgba(255, 250, 235, 0)');
        ctx.strokeStyle = sg;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      }
    } else {
      // Prominences licking up from the horizon sun
      ctx.strokeStyle = rgba(f.corona, 0.2);
      ctx.lineWidth = 5;
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.35 + Math.sin(time * 0.3 + k) * 0.05;
        const hgt = r * (0.08 + 0.05 * Math.sin(time * 0.8 + k * 2));
        const bx = x + Math.cos(a) * r, by = y + Math.sin(a) * r;
        ctx.beginPath();
        ctx.arc(bx, by, hgt, a + Math.PI * 0.1, a + Math.PI * 0.9 + Math.PI, false);
        ctx.stroke();
      }
    }
  } else if (f.type === 'binary') {
    // Two distant suns circling a shared center (dim, so they never pass for the boss)
    ctx.globalAlpha = 0.55;
    const a = time * 0.15;
    const sep = r * 2.4;
    const ax = x + Math.cos(a) * sep, ay = y + Math.sin(a) * sep * 0.5;
    const bx = x - Math.cos(a) * sep, by = y - Math.sin(a) * sep * 0.5;
    ctx.globalCompositeOperation = 'lighter';
    for (const [sx, sy, core, cor, rr] of [[ax, ay, f.coreA, f.coronaA, r], [bx, by, f.coreB, f.coronaB, r * 0.7]]) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr * 4);
      g.addColorStop(0, rgba(core, 0.95));
      g.addColorStop(0.2, rgba(cor, 0.5));
      g.addColorStop(1, rgba(cor, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rr * 4, 0, Math.PI * 2); ctx.fill();
    }
    // Mass transfer stream between them
    ctx.strokeStyle = rgba(f.coronaA, 0.18);
    ctx.lineWidth = r * 0.3;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(x + Math.sin(a) * r, y - Math.cos(a) * r, bx, by); ctx.stroke();
  } else if (f.type === 'pulsar') {
    const a = time * 1.6;
    ctx.globalCompositeOperation = 'lighter';
    const len = Math.max(w, h) * 1.4;
    // Kept faint and short so nobody mistakes them for a boss laser
    const len2 = len * 0.35;
    for (const off of [0, Math.PI]) {
      const g = ctx.createLinearGradient(x, y, x + Math.cos(a + off) * len2, y + Math.sin(a + off) * len2);
      g.addColorStop(0, rgba(f.color, 0.16));
      g.addColorStop(1, rgba(f.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a + off - 0.035) * len2, y + Math.sin(a + off - 0.035) * len2);
      ctx.lineTo(x + Math.cos(a + off + 0.035) * len2, y + Math.sin(a + off + 0.035) * len2);
      ctx.fill();
    }
    const pulse = 0.7 + 0.3 * Math.sin(time * 9);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 30 * pulse);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
    g.addColorStop(0.3, rgba(f.color, 0.35));
    g.addColorStop(1, rgba(f.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 30 * pulse, 0, Math.PI * 2); ctx.fill();
  } else if (f.type === 'blackhole') {
    ctx.globalAlpha = 0.6;
    drawBlackHoleArt(ctx, x, y, r, time * 0.5, f.disk, f.glow);
  } else if (f.type === 'gasgiant') {
    // Lightning flickering inside the cloud tops
    c.flash -= dt;
    if (c.flash <= -0.4 - Math.random() * 3) {
      c.flash = 0.18;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const d = r * (0.75 + Math.random() * 0.2);
      c.flashX = x + Math.cos(a) * d;
      c.flashY = y + Math.sin(a) * d;
    }
    if (c.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(c.flashX, c.flashY, 0, c.flashX, c.flashY, r * 0.12);
      g.addColorStop(0, `rgba(240, 230, 255, ${c.flash * 3})`);
      g.addColorStop(1, 'rgba(240, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.flashX, c.flashY, r * 0.12, 0, Math.PI * 2); ctx.fill();
    }
  } else if (f.type === 'fleet' && f.battle) {
    // Distant battle: flak bursts and tracer fire
    c.flash -= dt;
    if (c.flash <= 0) {
      c.flash = 0.15 + Math.random() * 0.5;
      c.flashX = x + (Math.random() - 0.5) * r * 2;
      c.flashY = y + (Math.random() - 0.5) * r;
    }
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.flashX, c.flashY, 0, c.flashX, c.flashY, 14);
    g.addColorStop(0, `rgba(255, 220, 140, ${Math.min(1, c.flash * 2)})`);
    g.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.flashX, c.flashY, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 80, 100, 0.35)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const t = (time * 0.7 + k * 0.33) % 1;
      const sx = x - r + t * r * 2, sy = y + Math.sin(k * 3) * r * 0.3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 18, sy - 4); ctx.stroke();
    }
  } else if (f.type === 'station' || f.type === 'shipyard') {
    // Blinking nav lights
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) {
      const on = Math.sin(time * 2 + k * 1.7) > 0.6;
      if (!on) continue;
      const a = (k / 5) * Math.PI * 2 - 0.25;
      const lx = x + Math.cos(a) * r * (f.type === 'station' ? 1 : 0.6);
      const ly = y + Math.sin(a) * r * (f.type === 'station' ? 0.38 : 0.12);
      ctx.fillStyle = k % 2 ? rgba(f.glow, 0.9) : 'rgba(255, 80, 80, 0.9)';
      ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (f.type === 'core') {
    const pulse = 0.9 + Math.sin(time * 0.7) * 0.1;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.25 * pulse);
    g.addColorStop(0, rgba(f.c1, 0.16));
    g.addColorStop(1, rgba(f.c1, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 0.25 * pulse, 0, Math.PI * 2); ctx.fill();
  } else if (f.type === 'remnant') {
    // The dead star at the heart of the shell flickers (no rings here:
    // those would read as the sector's real shock pulses)
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.6 + Math.sin(time * 11) * 0.2 + Math.sin(time * 3.7) * 0.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.7 * flick})`);
    g.addColorStop(1, rgba(f.c2, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Shared by the sky feature, gravity-well hazards and the Singularity boss.
export function drawBlackHoleArt(ctx, x, y, r, time, disk = '#ff9f43', glow = '#b847ff') {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.2);
  halo.addColorStop(0, rgba(glow, 0.4));
  halo.addColorStop(1, rgba(glow, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
  // Accretion disk: tilted rings of hot gas streaming around
  ctx.translate(x, y);
  ctx.rotate(-0.35);
  for (let k = 0; k < 7; k++) {
    const rr = r * (1.3 + k * 0.22);
    ctx.strokeStyle = rgba(k < 2 ? '#fff4d8' : disk, 0.5 - k * 0.06);
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.setLineDash([rr * 0.6, rr * 0.25]);
    ctx.lineDashOffset = -time * rr * (2.2 - k * 0.2);
    ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = 'source-over';
  // Event horizon with a lensed photon ring
  ctx.fillStyle = '#000000';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba('#fff0d0', 0.85);
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.shadowColor = disk;
  ctx.shadowBlur = r * 0.6;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2); ctx.stroke();
  // Front half of the disk passes in front of the hole
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(disk, 0.55);
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.45, r * 0.42, 0, 0.1, Math.PI - 0.1); ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------
// Hyperspace jump between sectors
// ------------------------------------------------------------
// k runs 0 → 1 over the jump. Stars stretch into streaks, the screen
// flashes white at the midpoint (when the sector swaps), then the streaks
// collapse back into the new sky.
const warpStars = [];
for (let i = 0; i < 220; i++) {
  warpStars.push({ a: Math.random() * Math.PI * 2, d: 0.05 + Math.random() * 0.95, c: Math.random() });
}

export function drawWarp(ctx, w, h, k, color = '#00f0ff') {
  const cx = w / 2, cy = h / 2;
  const R = Math.hypot(w, h) / 2;
  // Speed ramps up to the flash, then back down
  const speed = k < 0.5 ? Math.pow(k / 0.5, 2) : Math.pow((1 - k) / 0.5, 2);
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 8, ${0.55 * speed})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of warpStars) {
    const d0 = ((s.d + k * 3) % 1) * R;
    const len = 6 + speed * R * 0.55 * s.d;
    const x1 = cx + Math.cos(s.a) * d0, y1 = cy + Math.sin(s.a) * d0;
    const x2 = cx + Math.cos(s.a) * (d0 + len), y2 = cy + Math.sin(s.a) * (d0 + len);
    ctx.strokeStyle = s.c < 0.6 ? `rgba(255, 255, 255, ${0.25 + speed * 0.6})` : rgba(color, 0.3 + speed * 0.6);
    ctx.lineWidth = 1 + speed * 2 * s.d;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // Tunnel glow
  const tg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
  tg.addColorStop(0, rgba(color, 0.25 * speed));
  tg.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // White flash around the midpoint
  const flash = Math.max(0, 1 - Math.abs(k - 0.5) / 0.08);
  if (flash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.9})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
