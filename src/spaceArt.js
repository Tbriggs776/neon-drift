// ============================================================
// SPACE ART: obstacles and hazards
// ============================================================
// Asteroids, ice, crystals and wreckage are painted once into small
// offscreen sprites (with their glow baked in) and then blitted rotated
// every frame, so a screen full of rocks stays cheap. Hazards that animate
// (mines, comets, flares, lightning, shock pulses, laser gates) are drawn
// live. Drawing only: the simulation lives in game.js.
// ============================================================
import { rgba, shade, drawBlackHoleArt } from './backdrop.js';

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

function sprite(size) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size);
  return c;
}

// Path helper (ctx.roundRect is missing on older iOS and Android web views)
function roundRectPath(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function tracePoly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

// ------------------------------------------------------------
// Rocks: kind is 'stone' | 'ice' | 'metal' | 'crystal'
// colors: { body, shade, rim } from the sector
// ------------------------------------------------------------
// solid: static cover. Gets glowing mineral veins and a heavier rim so it
// reads as unbreakable terrain next to the drifting rocks you can shoot.
export function makeRockSprite(r, kind, colors, seed, solid = false) {
  const rand = mulberry(seed);
  const pad = 12;
  const size = r * 2 + pad * 2;
  const c = sprite(size);
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  g.translate(cx, cy);

  if (kind === 'crystal') {
    drawCrystalCluster(g, r, colors, rand);
    return c;
  }

  // Outline: lumpy for stone, faceted for ice, angular for metal
  const n = kind === 'ice' ? 7 + Math.floor(rand() * 3) : kind === 'metal' ? 6 + Math.floor(rand() * 3) : 10 + Math.floor(rand() * 5);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * (Math.PI / n);
    const rr = r * (kind === 'metal' ? 0.7 + rand() * 0.35 : 0.8 + rand() * 0.22);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }

  // Glow halo + body
  g.save();
  g.shadowColor = colors.rim;
  g.shadowBlur = 10;
  tracePoly(g, pts);
  const body = g.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r * 1.1);
  body.addColorStop(0, shade(colors.body, kind === 'ice' ? 0.55 : 0.28));
  body.addColorStop(0.55, colors.body);
  body.addColorStop(1, colors.shade);
  g.fillStyle = body;
  g.fill();
  g.restore();

  g.save();
  tracePoly(g, pts);
  g.clip();
  if (kind === 'stone') {
    // Craters with a lit lower rim
    const craters = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < craters; i++) {
      const a = rand() * Math.PI * 2, d = rand() * r * 0.55, cr = r * (0.12 + rand() * 0.2);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      g.fillStyle = 'rgba(0, 0, 0, 0.3)';
      g.beginPath(); g.arc(x, y, cr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      g.lineWidth = Math.max(1, cr * 0.18);
      g.beginPath(); g.arc(x, y, cr, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
    }
    // Speckle
    for (let i = 0; i < r * 1.2; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.15)';
      g.fillRect((rand() - 0.5) * r * 2, (rand() - 0.5) * r * 2, 1.5, 1.5);
    }
  } else if (kind === 'ice') {
    // Facets catching the light
    for (let i = 0; i < pts.length; i += 2) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      g.fillStyle = `rgba(255, 255, 255, ${0.06 + rand() * 0.14})`;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (const [x, y] of pts) { g.moveTo(r * 0.15, -r * 0.1); g.lineTo(x * 0.9, y * 0.9); }
    g.stroke();
    // Specular glint
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath(); g.ellipse(-r * 0.35, -r * 0.4, r * 0.18, r * 0.07, -0.6, 0, Math.PI * 2); g.fill();
  } else if (kind === 'metal') {
    // Hull plating seams, scorch and a dying running light
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const y = (rand() - 0.5) * r * 1.6;
      g.beginPath(); g.moveTo(-r, y); g.lineTo(r, y + (rand() - 0.5) * r * 0.3); g.stroke();
    }
    g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    for (let i = 0; i < 3; i++) {
      const x = (rand() - 0.5) * r * 1.6;
      g.beginPath(); g.moveTo(x, -r); g.lineTo(x, r); g.stroke();
    }
    const sc = g.createRadialGradient(r * 0.3, r * 0.2, 0, r * 0.3, r * 0.2, r * 0.6);
    sc.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    sc.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = sc;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.fillStyle = colors.rim;
    g.shadowColor = colors.rim;
    g.shadowBlur = 6;
    g.fillRect(-r * 0.3, -r * 0.2, 2, 2);
  }
  if (solid) {
    // Mineral veins: bright seams branching through the rock
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let v = 0; v < 3; v++) {
      let x = (rand() - 0.5) * r * 0.6, y = (rand() - 0.5) * r * 0.6;
      let a = rand() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        a += (rand() - 0.5) * 1.2;
        x += Math.cos(a) * r * 0.22;
        y += Math.sin(a) * r * 0.22;
        g.lineTo(x, y);
      }
      g.strokeStyle = rgba(colors.rim, 0.25);
      g.lineWidth = 4;
      g.stroke();
      g.strokeStyle = rgba(colors.rim, 0.75);
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.restore();
  }
  // Night side shading
  const night = g.createLinearGradient(-r, -r, r, r);
  night.addColorStop(0, 'rgba(0, 0, 0, 0)');
  night.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  g.fillStyle = night;
  g.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  g.restore();

  // Neon rim, the house style: bright on the lit edge, faint all round
  g.save();
  tracePoly(g, pts);
  g.strokeStyle = rgba(colors.rim, solid ? 0.7 : 0.35);
  g.lineWidth = solid ? 2.4 : 1.2;
  g.stroke();
  g.shadowColor = colors.rim;
  g.shadowBlur = 8;
  g.strokeStyle = rgba(colors.rim, 0.85);
  g.lineWidth = 1.6;
  g.beginPath();
  const half = Math.floor(pts.length / 2);
  for (let i = 0; i <= half; i++) {
    const [x, y] = pts[(i + Math.floor(pts.length * 0.55)) % pts.length];
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  g.restore();
  return c;
}

function drawCrystalCluster(g, r, colors, rand) {
  const shards = 5 + Math.floor(rand() * 3);
  const list = [];
  for (let i = 0; i < shards; i++) {
    list.push({ a: (i / shards) * Math.PI * 2 + (rand() - 0.5) * 0.5, len: r * (0.6 + rand() * 0.45), wid: r * (0.18 + rand() * 0.12) });
  }
  // Back to front so the long ones read clearly
  list.sort((p, q) => p.len - q.len);
  g.shadowColor = colors.rim;
  g.shadowBlur = 12;
  for (const s of list) {
    g.save();
    g.rotate(s.a);
    const pts = [[0, -s.wid * 0.5], [s.len * 0.75, -s.wid * 0.5], [s.len, 0], [s.len * 0.75, s.wid * 0.5], [0, s.wid * 0.5]];
    const grad = g.createLinearGradient(0, -s.wid, 0, s.wid);
    grad.addColorStop(0, shade(colors.body, 0.5));
    grad.addColorStop(0.5, colors.body);
    grad.addColorStop(1, colors.shade);
    g.fillStyle = grad;
    tracePoly(g, pts);
    g.fill();
    g.strokeStyle = rgba(colors.rim, 0.9);
    g.lineWidth = 1.4;
    g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(s.len * 0.1, 0); g.lineTo(s.len * 0.92, 0); g.stroke();
    g.restore();
  }
  // Glowing heart
  const heart = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
  heart.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  heart.addColorStop(0.4, rgba(colors.rim, 0.6));
  heart.addColorStop(1, rgba(colors.rim, 0));
  g.fillStyle = heart;
  g.beginPath(); g.arc(0, 0, r * 0.4, 0, Math.PI * 2); g.fill();
}

// Draw a rock (hazard or circular cover) using its cached sprite.
export function drawRock(ctx, o) {
  const s = o.sprite;
  if (!s) return;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.rot || 0);
  ctx.drawImage(s, -s.width / 2, -s.height / 2);
  if (o.hitFlash > 0) {
    // Flash on hit: add the sprite over itself
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, o.hitFlash / 0.1) * 0.7;
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------
// Rectangular cover: derelict hull plates and station modules
// ------------------------------------------------------------
export function makePanelSprite(w, h, kind, colors, seed) {
  const rand = mulberry(seed);
  const pad = 10;
  const c = sprite(Math.max(w, h) + pad * 2);
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(h + pad * 2);
  const g = c.getContext('2d');
  g.translate(pad, pad);
  const horizontal = w >= h;
  const long = horizontal ? w : h, short = horizontal ? h : w;
  if (!horizontal) { g.translate(w, 0); g.rotate(Math.PI / 2); }
  // From here on draw a horizontal piece `long` x `short`

  if (kind === 'station') {
    // Pressurised module: rounded ends, ribbing, lit windows, edge lights
    const rad = short * 0.45;
    g.save();
    g.shadowColor = colors.rim;
    g.shadowBlur = 10;
    roundRectPath(g, 0, 0, long, short, rad);
    const body = g.createLinearGradient(0, 0, 0, short);
    body.addColorStop(0, shade('#5a6478', 0.25));
    body.addColorStop(0.45, '#3a4256');
    body.addColorStop(1, '#141822');
    g.fillStyle = body;
    g.fill();
    g.restore();
    g.save();
    roundRectPath(g, 0, 0, long, short, rad); g.clip();
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 2;
    for (let x = rad; x < long - rad / 2; x += 22) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, short); g.stroke();
    }
    for (let x = rad + 8; x < long - rad; x += 22) {
      if (rand() < 0.3) continue;
      g.fillStyle = rand() < 0.8 ? 'rgba(255, 230, 170, 0.8)' : rgba(colors.rim, 0.9);
      g.fillRect(x, short * 0.32, 5, short * 0.14);
    }
    g.restore();
    g.strokeStyle = rgba(colors.rim, 0.85);
    g.lineWidth = 1.5;
    g.shadowColor = colors.rim;
    g.shadowBlur = 6;
    roundRectPath(g, 1, 1, long - 2, short - 2, rad); g.stroke();
    // Docking collars
    g.fillStyle = '#5a6478';
    g.shadowBlur = 0;
    g.fillRect(-3, short * 0.3, 4, short * 0.4);
    g.fillRect(long - 1, short * 0.3, 4, short * 0.4);
    return c;
  }

  // Wreck: a torn slab of hull, jagged at one end, scorched, a few lights
  const pts = [[0, short * 0.08], [long * 0.85, 0], [long, short * 0.15]];
  const teeth = 5;
  for (let i = 1; i < teeth; i++) {
    pts.push([long - (i % 2 ? short * 0.18 * rand() + 4 : 0), short * (i / teeth)]);
  }
  pts.push([long * 0.92, short], [short * 0.2, short], [0, short * 0.85]);
  g.save();
  g.shadowColor = colors.rim;
  g.shadowBlur = 10;
  tracePoly(g, pts);
  const body = g.createLinearGradient(0, 0, 0, short);
  body.addColorStop(0, shade(colors.body, 0.3));
  body.addColorStop(0.5, colors.body);
  body.addColorStop(1, colors.shade);
  g.fillStyle = body;
  g.fill();
  g.restore();
  g.save();
  tracePoly(g, pts);
  g.clip();
  g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  g.lineWidth = 1.5;
  for (let x = 14; x < long; x += 18 + rand() * 14) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, short); g.stroke();
  }
  g.beginPath(); g.moveTo(0, short * 0.5); g.lineTo(long, short * 0.5); g.stroke();
  // Hazard stripes on the intact end
  g.fillStyle = 'rgba(255, 200, 40, 0.35)';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 10, 0); g.lineTo(i * 10 + 5, 0); g.lineTo(i * 10 - 5 + 5, short); g.lineTo(i * 10 - 5, short);
    g.fill();
  }
  // Scorch around the tear
  const sc = g.createRadialGradient(long, short / 2, 0, long, short / 2, short * 1.4);
  sc.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  sc.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = sc;
  g.fillRect(0, 0, long, short);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = rand() < 0.5 ? rgba(colors.rim, 0.9) : 'rgba(255, 230, 170, 0.7)';
    g.fillRect(20 + rand() * (long * 0.6), short * (0.2 + rand() * 0.6), 2.5, 2.5);
  }
  g.restore();
  g.save();
  tracePoly(g, pts);
  g.strokeStyle = rgba(colors.rim, 0.8);
  g.lineWidth = 1.5;
  g.shadowColor = colors.rim;
  g.shadowBlur = 6;
  g.stroke();
  g.restore();
  return c;
}

export function drawPanel(ctx, o) {
  const s = o.sprite;
  if (!s) return;
  ctx.drawImage(s, o.x - 10, o.y - 10);
}

// ------------------------------------------------------------
// Hazards
// ------------------------------------------------------------
export function drawMine(ctx, m, time) {
  ctx.save();
  ctx.translate(m.x, m.y);
  const armed = m.fuse > 0;
  const blink = armed ? (Math.sin(time * 40) > 0) : (Math.sin(time * 3 + m.seed) > 0.7);
  // Trigger radius hint
  ctx.strokeStyle = armed ? 'rgba(255, 56, 96, 0.55)' : 'rgba(255, 56, 96, 0.12)';
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, m.trigger, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  if (armed) {
    // Blast radius fills in as the fuse burns
    const k = 1 - m.fuse / m.fuseMax;
    ctx.fillStyle = `rgba(255, 56, 96, ${0.08 + k * 0.18})`;
    ctx.beginPath(); ctx.arc(0, 0, m.blast * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.rotate(time * 0.8 + m.seed);
  // Spikes
  ctx.strokeStyle = '#8a8fa8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.moveTo(Math.cos(a) * m.r * 0.7, Math.sin(a) * m.r * 0.7);
    ctx.lineTo(Math.cos(a) * m.r * 1.35, Math.sin(a) * m.r * 1.35);
  }
  ctx.stroke();
  ctx.fillStyle = '#c8cce0';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(Math.cos(a) * m.r * 1.35, Math.sin(a) * m.r * 1.35, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  // Shell
  const body = ctx.createRadialGradient(-m.r * 0.3, -m.r * 0.3, 1, 0, 0, m.r);
  body.addColorStop(0, '#7a7f98');
  body.addColorStop(1, '#1e2030');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, m.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 56, 96, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Sensor light
  ctx.fillStyle = blink ? '#ff3860' : '#4a1020';
  ctx.shadowColor = '#ff3860';
  ctx.shadowBlur = blink ? 16 : 0;
  ctx.beginPath(); ctx.arc(0, 0, m.r * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawWell(ctx, w, time) {
  // Faint pull rings that slide inward
  ctx.save();
  ctx.strokeStyle = rgba(w.color || '#b847ff', 0.18);
  ctx.lineWidth = 1;
  for (let k = 0; k < 4; k++) {
    const t = 1 - ((time * 0.35 + k / 4) % 1);
    ctx.globalAlpha = t * 0.9;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.core + (w.reach - w.core) * t, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  drawBlackHoleArt(ctx, w.x, w.y, w.core, time + w.seed, w.disk || '#ff9f43', w.color || '#b847ff');
}

export function drawComet(ctx, c, time) {
  if (c.warn > 0) {
    // Telegraph: dashed path and a blinking chevron at the entry edge
    ctx.save();
    const blink = Math.sin(time * 18) > 0;
    ctx.strokeStyle = `rgba(160, 240, 255, ${blink ? 0.45 : 0.2})`;
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + c.vx * 4, c.y + c.vy * 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(c.markX, c.markY);
    ctx.rotate(Math.atan2(c.vy, c.vx));
    ctx.fillStyle = blink ? '#bff4ff' : 'rgba(191, 244, 255, 0.4)';
    ctx.shadowColor = '#8ff0ff';
    ctx.shadowBlur = 12;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.moveTo(10 + k * 12, 0); ctx.lineTo(-2 + k * 12, -9); ctx.lineTo(-2 + k * 12, 9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  ctx.save();
  const ang = Math.atan2(c.vy, c.vx);
  ctx.translate(c.x, c.y);
  ctx.rotate(ang);
  ctx.globalCompositeOperation = 'lighter';
  // Tail
  const tail = ctx.createLinearGradient(0, 0, -c.r * 14, 0);
  tail.addColorStop(0, 'rgba(200, 245, 255, 0.85)');
  tail.addColorStop(0.3, 'rgba(90, 200, 250, 0.35)');
  tail.addColorStop(1, 'rgba(90, 200, 250, 0)');
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(0, -c.r);
  ctx.quadraticCurveTo(-c.r * 6, -c.r * 2.2 + Math.sin(time * 10) * 2, -c.r * 14, 0);
  ctx.quadraticCurveTo(-c.r * 6, c.r * 2.2, 0, c.r);
  ctx.fill();
  // Coma + nucleus
  const head = ctx.createRadialGradient(0, 0, 0, 0, 0, c.r * 2.2);
  head.addColorStop(0, 'rgba(255, 255, 255, 1)');
  head.addColorStop(0.35, 'rgba(160, 240, 255, 0.7)');
  head.addColorStop(1, 'rgba(90, 200, 250, 0)');
  ctx.fillStyle = head;
  ctx.beginPath(); ctx.arc(0, 0, c.r * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawFlare(ctx, f, w, h, time) {
  ctx.save();
  const vertical = f.axis === 'x';
  const along = vertical ? h : w;
  if (f.warn > 0) {
    const k = 1 - f.warn / f.warnMax;
    const a = 0.12 + 0.18 * (Math.sin(time * (8 + k * 20)) * 0.5 + 0.5);
    ctx.fillStyle = `rgba(255, 160, 0, ${a})`;
    if (vertical) ctx.fillRect(f.pos - f.half, 0, f.half * 2, h);
    else ctx.fillRect(0, f.pos - f.half, w, f.half * 2);
    // Hazard hatching
    ctx.strokeStyle = `rgba(255, 220, 80, ${0.25 + k * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = -f.half * 2; s < along + f.half * 2; s += 22) {
      if (vertical) { ctx.moveTo(f.pos - f.half, s); ctx.lineTo(f.pos + f.half, s + f.half * 0.8); }
      else { ctx.moveTo(s, f.pos - f.half); ctx.lineTo(s + f.half * 0.8, f.pos + f.half); }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.7)';
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    if (vertical) { ctx.moveTo(f.pos - f.half, 0); ctx.lineTo(f.pos - f.half, h); ctx.moveTo(f.pos + f.half, 0); ctx.lineTo(f.pos + f.half, h); }
    else { ctx.moveTo(0, f.pos - f.half); ctx.lineTo(w, f.pos - f.half); ctx.moveTo(0, f.pos + f.half); ctx.lineTo(w, f.pos + f.half); }
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // The burn: a white-hot band with a ragged plasma edge
    const k = f.burn / f.burnMax;
    ctx.globalCompositeOperation = 'lighter';
    const g = vertical
      ? ctx.createLinearGradient(f.pos - f.half * 1.6, 0, f.pos + f.half * 1.6, 0)
      : ctx.createLinearGradient(0, f.pos - f.half * 1.6, 0, f.pos + f.half * 1.6);
    g.addColorStop(0, 'rgba(255, 90, 0, 0)');
    g.addColorStop(0.3, `rgba(255, 140, 0, ${0.6 * k})`);
    g.addColorStop(0.5, `rgba(255, 250, 220, ${0.95 * k})`);
    g.addColorStop(0.7, `rgba(255, 140, 0, ${0.6 * k})`);
    g.addColorStop(1, 'rgba(255, 90, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let s = 0; s <= along; s += 24) {
      const wob = Math.sin(s * 0.05 + time * 20) * f.half * 0.25;
      if (vertical) ctx.lineTo(f.pos - f.half * 1.6 - wob, s);
      else ctx.lineTo(s, f.pos - f.half * 1.6 - wob);
    }
    for (let s = along; s >= 0; s -= 24) {
      const wob = Math.cos(s * 0.05 + time * 17) * f.half * 0.25;
      if (vertical) ctx.lineTo(f.pos + f.half * 1.6 + wob, s);
      else ctx.lineTo(s, f.pos + f.half * 1.6 + wob);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawStrike(ctx, s, time) {
  ctx.save();
  if (s.warn > 0) {
    const k = 1 - s.warn / s.warnMax;
    ctx.strokeStyle = `rgba(200, 160, 255, ${0.35 + k * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(200, 160, 255, ${0.06 + k * 0.16})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * k, 0, Math.PI * 2); ctx.fill();
    // Crosshair ticks
    ctx.beginPath();
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2 + time * 2;
      ctx.moveTo(s.x + Math.cos(a) * (s.r + 4), s.y + Math.sin(a) * (s.r + 4));
      ctx.lineTo(s.x + Math.cos(a) * (s.r + 12), s.y + Math.sin(a) * (s.r + 12));
    }
    ctx.stroke();
  } else {
    // Lightning bolt from the top of the screen into the target
    const k = s.burn / s.burnMax;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(230, 210, 255, ${k})`;
    ctx.shadowColor = '#c08bff';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let x = s.x + (s.boltSeed - 0.5) * 120, y = -10;
    ctx.moveTo(x, y);
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      x = s.x + (s.boltSeed - 0.5) * 120 * (1 - t) + (i < steps ? Math.sin(i * 12.9898 + s.boltSeed * 78) * 22 : 0);
      y = -10 + (s.y + 10) * t;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.4);
    g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
    g.addColorStop(0.4, `rgba(192, 139, 255, ${0.6 * k})`);
    g.addColorStop(1, 'rgba(192, 139, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 1.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawPulse(ctx, p, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (p.warn > 0) {
    // The source charges up
    const k = 1 - p.warn / p.warnMax;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 12 + k * 26);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.4 + k * 0.6})`);
    g.addColorStop(0.4, rgba(p.color, 0.5 * k + 0.2));
    g.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 12 + k * 26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(p.color, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 40 - k * 28, 0, Math.PI * 2); ctx.stroke();
  } else {
    const fade = Math.max(0, 1 - p.radius / p.maxRadius);
    ctx.strokeStyle = rgba(p.color, 0.25 * fade + 0.1);
    ctx.lineWidth = p.thick * 2.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * fade + 0.2})`;
    ctx.lineWidth = p.thick * 0.7;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function drawGate(ctx, gt, time) {
  const { x1, y1, x2, y2 } = gt;
  ctx.save();
  if (gt.state === 'warn') {
    const flick = Math.sin(time * 30) > 0 ? 0.55 : 0.2;
    ctx.strokeStyle = rgba(gt.color, flick);
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  } else if (gt.state === 'on') {
    ctx.globalCompositeOperation = 'lighter';
    const jitter = Math.sin(time * 50) * 1.2;
    ctx.strokeStyle = rgba(gt.color, 0.35);
    ctx.lineWidth = gt.width * 2.4 + jitter;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = rgba(gt.color, 0.85);
    ctx.lineWidth = gt.width;
    ctx.shadowColor = gt.color;
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = gt.width * 0.35;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.restore();
  // Emitter pylons
  for (const [px, py] of [[x1, y1], [x2, y2]]) {
    ctx.save();
    ctx.translate(px, py);
    const body = ctx.createRadialGradient(-4, -4, 1, 0, 0, gt.pylonR);
    body.addColorStop(0, '#7a8298');
    body.addColorStop(1, '#1a1e2a');
    ctx.fillStyle = body;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      k ? ctx.lineTo(Math.cos(a) * gt.pylonR, Math.sin(a) * gt.pylonR) : ctx.moveTo(Math.cos(a) * gt.pylonR, Math.sin(a) * gt.pylonR);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(gt.color, 0.9);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = gt.color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.fillStyle = gt.state === 'on' ? '#ffffff' : gt.state === 'warn' ? gt.color : rgba(gt.color, 0.35);
    ctx.beginPath(); ctx.arc(0, 0, gt.pylonR * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
