// ============================================================
// SPACE BOSS ART
// ============================================================
// Drawing for the bosses and minions in bosses.js. Everything here is
// drawn in world coordinates (several bosses are spread over many parts),
// so callers must NOT translate to the boss first. Returns false for
// enemy types it doesn't know.
// ============================================================
import { rgba, drawBlackHoleArt } from './backdrop.js';
import { makeRockSprite } from './spaceArt.js';
import { krakenArms } from '../shared/bosses.js';

const TAU = Math.PI * 2;

function glowDot(ctx, x, y, r, color, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
  g.addColorStop(0.35, rgba(color, 0.7 * a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function aimAngle(e, player) {
  return player ? Math.atan2(player.y - e.y, player.x - e.x) : Math.PI / 2;
}

// ------------------------------------------------------------
function colossus(ctx, e, t, player) {
  const hp = e.hp / e.maxHp;
  if (!e.sprite) {
    e.sprite = makeRockSprite(e.r, 'stone', { body: '#5e4634', shade: '#1d140e', rim: '#ffb347' }, 77);
    e.cracks = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + Math.sin(i * 7.1) * 0.3;
      const pts = [[0, 0]];
      let x = 0, y = 0, ang = a;
      for (let k = 0; k < 4; k++) {
        ang += Math.sin(i * 3.3 + k * 1.9) * 0.6;
        x += Math.cos(ang) * e.r * 0.22;
        y += Math.sin(ang) * e.r * 0.22;
        pts.push([x, y]);
      }
      e.cracks.push(pts);
    }
    e.boulders = [0, 1, 2, 3].map((k) => makeRockSprite(9 + k * 2, 'stone', { body: '#5e4634', shade: '#1d140e', rim: '#ffb347' }, 300 + k));
  }
  const rot = e.rot || 0;
  // Orbiting boulders
  e.boulders.forEach((s, k) => {
    const a = t * 0.9 + (k / 4) * TAU;
    const bx = e.x + Math.cos(a) * e.r * 1.55, by = e.y + Math.sin(a) * e.r * 1.25;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(t * 1.5 + k);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    ctx.restore();
  });
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(rot);
  ctx.drawImage(e.sprite, -e.sprite.width / 2, -e.sprite.height / 2);
  // Magma cracks open up as it takes damage
  const open = Math.min(e.cracks.length, 2 + Math.ceil((1 - hp) * e.cracks.length));
  const pulse = 0.6 + Math.sin(t * 4) * 0.25;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < open; i++) {
    const pts = e.cracks[i];
    ctx.strokeStyle = `rgba(255, 120, 30, ${pulse * 0.5})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 230, 150, ${pulse})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
  // Molten eye, always on the player
  const a = aimAngle(e, player);
  ctx.save();
  ctx.translate(e.x + Math.cos(a) * e.r * 0.15, e.y + Math.sin(a) * e.r * 0.15);
  ctx.globalCompositeOperation = 'lighter';
  glowDot(ctx, 0, 0, e.r * 0.45, '#ff8a00', 0.9);
  ctx.globalCompositeOperation = 'source-over';
  ctx.rotate(a);
  ctx.fillStyle = '#1a0800';
  ctx.beginPath(); ctx.ellipse(0, 0, e.r * 0.07, e.r * 0.2, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------
function glacier(ctx, e, t) {
  if (!e.sprite) e.sprite = makeRockSprite(e.r, 'crystal', { body: '#9fd8ee', shade: '#1e4a68', rim: '#8ff0ff' }, 91);
  const sp = Math.hypot(e.vx, e.vy);
  // Telegraph before a ram
  if (e.mode === 'aim') {
    ctx.save();
    const blink = Math.sin(t * 24) > 0;
    ctx.strokeStyle = rgba('#bff4ff', blink ? 0.6 : 0.25);
    ctx.lineWidth = e.r * 1.6;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.chargeAng) * 2000, e.y + Math.sin(e.chargeAng) * 2000); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.chargeAng) * 2000, e.y + Math.sin(e.chargeAng) * 2000); ctx.stroke();
    ctx.restore();
  }
  // Comet tail
  if (sp > 30) {
    const a = Math.atan2(e.vy, e.vx);
    const len = e.r * (2 + Math.min(10, sp / 60));
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, -len, 0);
    g.addColorStop(0, 'rgba(200, 245, 255, 0.7)');
    g.addColorStop(1, 'rgba(90, 200, 250, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -e.r * 0.9);
    ctx.quadraticCurveTo(-len * 0.4, -e.r * 1.4, -len, 0);
    ctx.quadraticCurveTo(-len * 0.4, e.r * 1.4, 0, e.r * 0.9);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glowDot(ctx, e.x, e.y, e.r * 2, '#5ac8fa', 0.35);
  ctx.restore();
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(t * 0.6);
  ctx.drawImage(e.sprite, -e.sprite.width / 2, -e.sprite.height / 2);
  ctx.restore();
  // Frost sparkles
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 6; k++) {
    const a = t * 0.7 + k * 1.05;
    const d = e.r * (1.2 + 0.3 * Math.sin(t * 2 + k));
    const s = 1 + (Math.sin(t * 6 + k * 2) > 0.5 ? 1.5 : 0);
    ctx.fillRect(e.x + Math.cos(a) * d - s / 2, e.y + Math.sin(a) * d - s / 2, s, s);
  }
  ctx.restore();
}

// ------------------------------------------------------------
function helios(ctx, e, t, player) {
  const hp = e.hp / e.maxHp;
  const hot = hp < 0.45;
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalCompositeOperation = 'lighter';
  // Corona
  const cg = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 2.8);
  cg.addColorStop(0, rgba(hot ? '#ff6b35' : '#ffb000', 0.55));
  cg.addColorStop(1, rgba('#ff3d00', 0));
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(0, 0, r * 2.8, 0, TAU); ctx.fill();
  // Flame tongues
  const n = 18;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + (e.spin || 0) * 0.3;
    const len = r * (1.25 + 0.3 * Math.sin(t * 5 + k * 2.3) + (hot ? 0.35 : 0));
    ctx.fillStyle = rgba(k % 2 ? '#ffd23f' : '#ff6b35', 0.45);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.12) * r * 0.9, Math.sin(a - 0.12) * r * 0.9);
    ctx.quadraticCurveTo(Math.cos(a + 0.1) * len * 0.85, Math.sin(a + 0.1) * len * 0.85, Math.cos(a) * len, Math.sin(a) * len);
    ctx.quadraticCurveTo(Math.cos(a - 0.05) * len * 0.8, Math.sin(a - 0.05) * len * 0.8, Math.cos(a + 0.12) * r * 0.9, Math.sin(a + 0.12) * r * 0.9);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Photosphere
  const body = ctx.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r);
  body.addColorStop(0, '#fffbe8');
  body.addColorStop(0.45, hot ? '#ffd0a0' : '#ffe680');
  body.addColorStop(0.85, hot ? '#ff6b35' : '#ffb000');
  body.addColorStop(1, '#ff7a00');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  // Granules drifting across the surface
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
  for (let k = 0; k < 10; k++) {
    const a = k * 2.4 + (e.spin || 0) * 0.4;
    const d = r * (0.25 + (k % 4) * 0.18);
    ctx.fillStyle = 'rgba(200, 70, 0, 0.18)';
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.12, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // The eye: a dark sunspot that tracks you
  const a = aimAngle(e, player);
  ctx.translate(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
  ctx.fillStyle = 'rgba(90, 20, 0, 0.85)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
  ctx.fillStyle = hot ? '#ffffff' : '#fff2a0';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------
function arachne(ctx, e, t, player) {
  const facing = Math.hypot(e.vx, e.vy) > 10 ? Math.atan2(e.vy, e.vx) : aimAngle(e, player);
  e.face = e.face === undefined ? facing : e.face + Math.atan2(Math.sin(facing - e.face), Math.cos(facing - e.face)) * 0.15;
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.face);
  // Legs: four per side, two segments each, stepping in alternation
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 4; k++) {
      const step = Math.sin((e.legPhase || 0) + k * 1.6 + (side > 0 ? Math.PI : 0));
      const baseA = side * (0.5 + k * 0.5);
      const hipX = Math.cos(baseA) * r * 0.45, hipY = Math.sin(baseA) * r * 0.45;
      const kneeA = baseA + side * 0.15 + step * 0.12;
      const kneeX = hipX + Math.cos(kneeA) * r * 0.85, kneeY = hipY + Math.sin(kneeA) * r * 0.85 - 0;
      const footA = baseA + side * 0.5 + step * 0.2;
      const footX = kneeX + Math.cos(footA) * r * 0.9, footY = kneeY + Math.sin(footA) * r * 0.9;
      ctx.strokeStyle = '#1c2a1c';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
      ctx.strokeStyle = rgba('#39ff14', 0.75);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#39ff14';
      ctx.beginPath(); ctx.arc(kneeX, kneeY, 2.2, 0, TAU); ctx.fill();
    }
  }
  // Abdomen with mine pods
  ctx.shadowColor = '#39ff14';
  ctx.shadowBlur = 16;
  const ab = ctx.createRadialGradient(-r * 0.6, -r * 0.2, 2, -r * 0.5, 0, r * 0.9);
  ab.addColorStop(0, '#3a5a3a');
  ab.addColorStop(1, '#0a160a');
  ctx.fillStyle = ab;
  ctx.beginPath(); ctx.ellipse(-r * 0.55, 0, r * 0.85, r * 0.7, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#39ff14';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  for (let k = 0; k < 5; k++) {
    const px = -r * 0.95 + (k % 3) * r * 0.3, py = (k < 3 ? -1 : 1) * r * 0.22 + (k >= 3 ? 0 : 0);
    ctx.fillStyle = '#2a2e3e';
    ctx.beginPath(); ctx.arc(px, py, r * 0.13, 0, TAU); ctx.fill();
    ctx.fillStyle = Math.sin(t * 6 + k) > 0 ? '#ff3860' : '#5a1020';
    ctx.beginPath(); ctx.arc(px, py, r * 0.05, 0, TAU); ctx.fill();
  }
  // Head with an eye cluster
  ctx.fillStyle = '#16261a';
  ctx.strokeStyle = '#39ff14';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(r * 0.35, 0, r * 0.48, r * 0.42, 0, 0, TAU); ctx.fill(); ctx.stroke();
  const eyes = [[0.55, -0.14, 0.09], [0.55, 0.14, 0.09], [0.68, -0.05, 0.06], [0.68, 0.05, 0.06], [0.4, -0.24, 0.05], [0.4, 0.24, 0.05]];
  for (const [ex, ey, er] of eyes) {
    ctx.fillStyle = '#b8ff9a';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(ex * r, ey * r, er * r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  if (e.detFlash > 0) {
    ctx.save();
    ctx.strokeStyle = rgba('#39ff14', e.detFlash * 1.6);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * (2.5 - e.detFlash * 2), 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------
function pulsar(ctx, e, t) {
  const r = e.r;
  const ang = e.beamAng || 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  // Magnetic field loops
  ctx.rotate(ang);
  ctx.strokeStyle = rgba('#5ac8fa', 0.28);
  ctx.lineWidth = 1.2;
  for (let k = 1; k <= 3; k++) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(0, s * r * k * 0.9, r * k * 0.7, r * k * 0.9, 0, 0, TAU);
      ctx.stroke();
    }
  }
  // Emitter cones along the beam axes
  const nb = Math.max(2, (e.beams && e.beams.length) || 2);
  ctx.fillStyle = rgba('#bfefff', 0.7);
  for (let k = 0; k < nb; k++) {
    ctx.save();
    ctx.rotate((k / nb) * TAU);
    ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.35); ctx.lineTo(r * 1.7, 0); ctx.lineTo(r * 0.8, r * 0.35); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // Spinning tick ring
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(-t * 2);
  ctx.strokeStyle = rgba('#5ac8fa', 0.75);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 7]);
  ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // White-hot core, flickering fast
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.75 + 0.25 * Math.sin(t * 22);
  glowDot(ctx, e.x, e.y, r * 2.2 * pulse, '#5ac8fa', 0.9);
  glowDot(ctx, e.x, e.y, r * 0.9, '#ffffff', 1);
  ctx.restore();
}

// ------------------------------------------------------------
function binary(ctx, e, t) {
  if (!e.parts || e.parts.length < 2) return;
  const [A, B] = e.parts;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Orbit path
  ctx.strokeStyle = 'rgba(255, 220, 150, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(e.x, e.y, e.orbitR || 60, (e.orbitR || 60) * 0.9, 0, 0, TAU); ctx.stroke();
  // Plasma bridge pulled between the two stars
  const mx = e.x + Math.sin(t * 1.2) * 18, my = e.y + Math.cos(t * 1.4) * 18;
  for (const [w, a] of [[12, 0.12], [5, 0.35], [2, 0.8]]) {
    ctx.strokeStyle = `rgba(255, 230, 170, ${a})`;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(mx, my, B.x, B.y); ctx.stroke();
  }
  const star = (p, core, corona) => {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.6);
    g.addColorStop(0, rgba(corona, 0.55));
    g.addColorStop(1, rgba(corona, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.6, 0, TAU); ctx.fill();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + t * (core === '#fff3c8' ? 0.6 : -0.8);
      const len = p.r * (1.25 + 0.2 * Math.sin(t * 6 + k));
      ctx.strokeStyle = rgba(corona, 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r); ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const b = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 0, p.x, p.y, p.r);
    b.addColorStop(0, '#ffffff');
    b.addColorStop(0.5, core);
    b.addColorStop(1, corona);
    ctx.fillStyle = b;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
  };
  star(A, '#fff3c8', '#ffb000');
  star(B, '#e0f4ff', '#4aa8ff');
  // Shared core
  glowDot(ctx, e.x, e.y, e.r * 1.4, '#ffe8a0', 0.9);
  ctx.restore();
}

// ------------------------------------------------------------
function leviathan(ctx, e, t) {
  if (!e.parts) return;
  const segs = e.parts;
  ctx.save();
  // Bioluminescent spine running through every segment
  ctx.strokeStyle = rgba('#3affd8', 0.35);
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  for (const s of segs) ctx.lineTo(s.x, s.y);
  ctx.stroke();
  // Segments, tail first so the head overlaps
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const prev = i > 0 ? segs[i - 1] : e;
    const a = Math.atan2(prev.y - s.y, prev.x - s.x);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    if (i === segs.length - 1) {
      // Tail fluke
      ctx.fillStyle = rgba('#3affd8', 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-s.r * 2.6, -s.r * 1.6 + Math.sin(t * 6) * 3); ctx.lineTo(-s.r * 1.6, 0); ctx.lineTo(-s.r * 2.6, s.r * 1.6 + Math.sin(t * 6) * 3);
      ctx.closePath();
      ctx.fill();
    }
    if (i % 3 === 0) {
      // Side fins
      ctx.fillStyle = rgba('#b847ff', 0.45);
      const flap = Math.sin(t * 5 + i) * 0.25;
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s.r * 0.3, sd * s.r * 0.6);
        ctx.lineTo(-s.r * 1.2, sd * s.r * (1.7 + flap));
        ctx.lineTo(-s.r * 0.6, sd * s.r * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    const g = ctx.createRadialGradient(-s.r * 0.2, -s.r * 0.4, 1, 0, 0, s.r);
    g.addColorStop(0, '#2a6a64');
    g.addColorStop(1, '#06201e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, s.r * 1.15, s.r, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba('#3affd8', 0.8);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Armor ridge and glowing spots
    ctx.strokeStyle = rgba('#3affd8', 0.35);
    ctx.beginPath(); ctx.arc(s.r * 0.4, 0, s.r * 0.8, -1.2, 1.2); ctx.stroke();
    const glow = 0.5 + 0.5 * Math.sin(t * 4 - i * 0.6);
    ctx.fillStyle = `rgba(160, 255, 240, ${0.4 + glow * 0.6})`;
    ctx.beginPath(); ctx.arc(0, -s.r * 0.5, 1.8, 0, TAU); ctx.arc(0, s.r * 0.5, 1.8, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Head
  const ha = e.heading || 0;
  const jaw = 0.25 + 0.2 * Math.sin(t * 7) + (e.lunge > 0 ? 0.35 : 0);
  ctx.translate(e.x, e.y);
  ctx.rotate(ha);
  ctx.shadowColor = '#3affd8';
  ctx.shadowBlur = 16;
  for (const sd of [-1, 1]) {
    // Mandibles
    ctx.save();
    ctx.rotate(sd * jaw);
    ctx.fillStyle = '#0e3a36';
    ctx.strokeStyle = '#3affd8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(e.r * 0.3, sd * e.r * 0.3);
    ctx.quadraticCurveTo(e.r * 1.5, sd * e.r * 0.7, e.r * 1.7, sd * e.r * 0.05);
    ctx.lineTo(e.r * 0.9, sd * e.r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const hg = ctx.createRadialGradient(0, -e.r * 0.3, 2, 0, 0, e.r * 1.2);
  hg.addColorStop(0, '#3a8a80');
  hg.addColorStop(1, '#062420');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(e.r * 1.1, 0);
  ctx.quadraticCurveTo(e.r * 0.6, -e.r * 1.0, -e.r * 0.9, -e.r * 0.8);
  ctx.lineTo(-e.r * 0.9, e.r * 0.8);
  ctx.quadraticCurveTo(e.r * 0.6, e.r * 1.0, e.r * 1.1, 0);
  ctx.fill();
  ctx.strokeStyle = '#3affd8';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  for (const sd of [-1, 1]) {
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#b847ff';
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.ellipse(e.r * 0.45, sd * e.r * 0.42, e.r * 0.2, e.r * 0.1, sd * 0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b847ff';
    ctx.beginPath(); ctx.arc(e.r * 0.5, sd * e.r * 0.42, e.r * 0.06, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------
function carrier(ctx, e, t, player) {
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  // Engines at the rear (top of screen), flaring
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const ex of [-0.6, 0, 0.6]) {
    const fl = 0.8 + Math.sin(t * 20 + ex * 5) * 0.2;
    const g = ctx.createLinearGradient(0, -r * 0.95, 0, -r * (1.6 + fl * 0.4));
    g.addColorStop(0, 'rgba(255, 220, 160, 0.9)');
    g.addColorStop(1, 'rgba(255, 120, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ex * r - 8, -r * 0.95); ctx.lineTo(ex * r + 8, -r * 0.95); ctx.lineTo(ex * r, -r * (1.6 + fl * 0.4));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Hull: broad stern, swept wings, blunt prow pointing down
  ctx.shadowColor = '#ff9f1a';
  ctx.shadowBlur = 18;
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, '#1e1a16');
  hull.addColorStop(0.5, '#4a4036');
  hull.addColorStop(1, '#1e1a16');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, -r);
  ctx.lineTo(r * 0.8, -r);
  ctx.lineTo(r * 1.35, -r * 0.35);
  ctx.lineTo(r * 1.35, r * 0.05);
  ctx.lineTo(r * 0.55, r * 0.25);
  ctx.lineTo(r * 0.4, r * 1.0);
  ctx.lineTo(-r * 0.4, r * 1.0);
  ctx.lineTo(-r * 0.55, r * 0.25);
  ctx.lineTo(-r * 1.35, r * 0.05);
  ctx.lineTo(-r * 1.35, -r * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff9f1a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Deck plating and stripes
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1.5;
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath(); ctx.moveTo(k * r * 0.2, -r * 0.95); ctx.lineTo(k * r * 0.12, r * 0.9); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 159, 26, 0.5)';
  for (let k = 0; k < 6; k++) ctx.fillRect(-r * 0.05, -r * 0.7 + k * r * 0.25, r * 0.1, r * 0.1);
  // Bridge tower
  ctx.fillStyle = '#5a4e42';
  ctx.fillRect(r * 0.5, -r * 0.75, r * 0.32, r * 0.5);
  ctx.strokeStyle = '#ff9f1a';
  ctx.lineWidth = 1;
  ctx.strokeRect(r * 0.5, -r * 0.75, r * 0.32, r * 0.5);
  ctx.fillStyle = '#ffe9b0';
  ctx.fillRect(r * 0.54, -r * 0.7, r * 0.24, 3);
  // Hangar bay at the prow
  const bay = 0.5 + 0.5 * Math.sin(t * 3);
  ctx.fillStyle = `rgba(255, 180, 60, ${0.35 + bay * 0.4})`;
  ctx.fillRect(-r * 0.3, r * 0.55, r * 0.6, r * 0.38);
  ctx.strokeStyle = '#ffd23f';
  ctx.strokeRect(-r * 0.3, r * 0.55, r * 0.6, r * 0.38);
  // Running lights
  for (const [lx, ly] of [[-1.3, -0.15], [1.3, -0.15], [-0.75, -0.95], [0.75, -0.95]]) {
    ctx.fillStyle = Math.sin(t * 4 + lx) > 0 ? '#ff3860' : '#4a1018';
    ctx.beginPath(); ctx.arc(lx * r, ly * r, 2.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // Wing turret pods
  for (const pod of e.parts || []) {
    const a = pod.a ?? aimAngle(pod, player);
    ctx.save();
    ctx.translate(pod.x, pod.y);
    ctx.fillStyle = '#3a3028';
    ctx.strokeStyle = '#ff9f1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, pod.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.rotate(a);
    ctx.fillStyle = '#8a7a6a';
    ctx.fillRect(0, -3, pod.r * 1.4, 6);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// ------------------------------------------------------------
function kraken(ctx, e, t, player) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Tentacles behind the body (multiplayer views rebuild them from synced numbers)
  for (const arm of e.arms || krakenArms(e)) {
    const pts = arm.pts;
    const winding = arm.slam >= 0 && arm.slam < 0.6;
    const n = pts.length;
    const sx = e.x, sy = e.y;
    for (let j = n - 1; j >= 0; j--) {
      const p0 = j > 0 ? pts[j - 1] : { x: sx, y: sy };
      const p1 = pts[j];
      const w = 12 * (1 - j / n) + 2.5;
      ctx.strokeStyle = winding ? '#3a6a2a' : '#1a3020';
      ctx.lineWidth = w + 3;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      ctx.strokeStyle = winding ? '#b8ff9a' : '#2e5a34';
      ctx.lineWidth = w;
      ctx.stroke();
    }
    // Suckers
    for (let j = 1; j < n; j += 2) {
      const glow = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 5 - j));
      ctx.fillStyle = winding ? '#ffffff' : `rgba(122, 255, 106, ${glow})`;
      ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, Math.max(1.2, 3 * (1 - j / n)), 0, TAU); ctx.fill();
    }
    // Glowing tip
    const tip = pts[n - 1];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowDot(ctx, tip.x, tip.y, 9, '#7aff6a', 0.8);
    ctx.restore();
  }
  // Mantle
  const a = aimAngle(e, player);
  ctx.translate(e.x, e.y);
  ctx.shadowColor = '#7aff6a';
  ctx.shadowBlur = 20;
  const mg = ctx.createRadialGradient(-e.r * 0.3, -e.r * 0.5, 2, 0, 0, e.r * 1.3);
  mg.addColorStop(0, '#5a3a8a');
  mg.addColorStop(0.6, '#2a1a4a');
  mg.addColorStop(1, '#0a0618');
  ctx.fillStyle = mg;
  ctx.beginPath();
  const bob = Math.sin(t * 2) * 0.06;
  ctx.ellipse(0, 0, e.r * (1 + bob), e.r * (1.05 - bob), 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#7aff6a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Spots
  for (let k = 0; k < 9; k++) {
    const sa = k * 2.1, sd = e.r * (0.45 + (k % 3) * 0.15);
    ctx.fillStyle = `rgba(184, 71, 255, ${0.4 + 0.3 * Math.sin(t * 3 + k)})`;
    ctx.beginPath(); ctx.arc(Math.cos(sa) * sd, Math.sin(sa) * sd, 2 + (k % 3), 0, TAU); ctx.fill();
  }
  // The eye
  const blink = (t % 4) < 0.12 ? 0.15 : 1;
  ctx.fillStyle = '#f0ffe0';
  ctx.beginPath(); ctx.ellipse(0, 0, e.r * 0.42, e.r * 0.3 * blink, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7aff6a';
  ctx.beginPath(); ctx.arc(Math.cos(a) * e.r * 0.15, Math.sin(a) * e.r * 0.1, e.r * 0.18 * Math.max(0.3, blink), 0, TAU); ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath(); ctx.ellipse(Math.cos(a) * e.r * 0.17, Math.sin(a) * e.r * 0.11, e.r * 0.05, e.r * 0.14 * blink, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------
function dreadnought(ctx, e, t) {
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  // Engine bank at the stern (top)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = -2; k <= 2; k++) {
    const fl = 0.8 + Math.sin(t * 25 + k) * 0.2;
    const g = ctx.createLinearGradient(0, -r * 1.3, 0, -r * (1.9 + fl * 0.3));
    g.addColorStop(0, 'rgba(160, 220, 255, 0.95)');
    g.addColorStop(1, 'rgba(60, 120, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(k * r * 0.18 - 6, -r * 1.3); ctx.lineTo(k * r * 0.18 + 6, -r * 1.3); ctx.lineTo(k * r * 0.18, -r * (1.9 + fl * 0.3)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // Hull in layers
  ctx.shadowColor = '#ff3860';
  ctx.shadowBlur = 20;
  const hull = ctx.createLinearGradient(-r * 0.7, 0, r * 0.7, 0);
  hull.addColorStop(0, '#16121a');
  hull.addColorStop(0.5, '#3e3440');
  hull.addColorStop(1, '#16121a');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 1.3);
  ctx.lineTo(r * 0.55, -r * 1.3);
  ctx.lineTo(r * 0.75, -r * 0.5);
  ctx.lineTo(r * 0.68, r * 0.5);
  ctx.lineTo(r * 0.25, r * 1.2);
  ctx.lineTo(-r * 0.25, r * 1.2);
  ctx.lineTo(-r * 0.68, r * 0.5);
  ctx.lineTo(-r * 0.75, -r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff3860';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Armor bands and spine
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 2;
  for (let k = -3; k <= 3; k++) {
    const y = k * r * 0.3;
    const hw = r * (0.7 - Math.max(0, k) * 0.12);
    ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(hw, y); ctx.stroke();
  }
  ctx.fillStyle = '#4e4250';
  ctx.fillRect(-r * 0.12, -r * 1.1, r * 0.24, r * 2.1);
  ctx.strokeStyle = rgba('#ff3860', 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(-r * 0.12, -r * 1.1, r * 0.24, r * 2.1);
  // Bridge
  ctx.fillStyle = '#5e5260';
  ctx.fillRect(-r * 0.22, -r * 0.95, r * 0.44, r * 0.3);
  ctx.fillStyle = '#ffe9b0';
  for (let k = 0; k < 5; k++) ctx.fillRect(-r * 0.18 + k * r * 0.08, -r * 0.88, 3, 2);
  // Spinal cannon muzzle, charging when the beam is telegraphed
  const charging = e.cannon && !e.cannon.done && e.cannon.warn > 0;
  const firing = e.cannon && !e.cannon.done && e.cannon.warn <= 0;
  const ck = charging ? 1 - e.cannon.warn / e.cannon.warnMax : firing ? 1 : 0.2;
  ctx.globalCompositeOperation = 'lighter';
  glowDot(ctx, 0, r * 1.15, 10 + ck * 22, '#ff3860', 0.5 + ck * 0.5);
  ctx.restore();
  // Turrets
  (e.parts || []).forEach((pt, k) => {
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.fillStyle = '#2e2632';
    ctx.strokeStyle = '#ff3860';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, pt.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.rotate(pt.a ?? Math.PI / 2);
    ctx.fillStyle = '#8a7a8a';
    ctx.fillRect(2, -4, pt.r * 1.3, 3);
    ctx.fillRect(2, 1, pt.r * 1.3, 3);
    ctx.fillStyle = e.turret === k ? '#ffffff' : '#ff3860';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
    ctx.restore();
  });
}

// ------------------------------------------------------------
// Icosahedron vertices for the Nexus core (unit radius)
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
].map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
const ICO_E = [];
for (let i = 0; i < 12; i++) {
  for (let j = i + 1; j < 12; j++) {
    const [a, b] = [ICO_V[i], ICO_V[j]];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1.1) ICO_E.push([i, j]);
  }
}

function nexus(ctx, e, t) {
  // Tethers from core to nodes (the laser fence between nodes is drawn as beams)
  const nodes = e.nodes || [];
  ctx.save();
  ctx.strokeStyle = rgba('#b847ff', 0.25);
  ctx.lineWidth = 1;
  for (const nd of nodes) { ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(nd.x, nd.y); ctx.stroke(); }
  ctx.restore();
  // Rotating wireframe icosahedron
  const r = e.r * 1.1;
  const ay = t * 0.7, ax = t * 0.45;
  const proj = ICO_V.map(([x, y, z]) => {
    let x1 = x * Math.cos(ay) + z * Math.sin(ay);
    let z1 = -x * Math.sin(ay) + z * Math.cos(ay);
    let y1 = y * Math.cos(ax) - z1 * Math.sin(ax);
    let z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
    const persp = 1 / (1.8 - z2 * 0.5);
    return [e.x + x1 * r * persp * 1.6, e.y + y1 * r * persp * 1.6, z2];
  });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glowDot(ctx, e.x, e.y, e.r * 1.4, e.shielded ? '#00f0ff' : '#b847ff', 0.8);
  ctx.lineWidth = 1.6;
  for (const [i, j] of ICO_E) {
    const depth = (proj[i][2] + proj[j][2]) / 2;
    ctx.strokeStyle = rgba(e.shielded ? '#00f0ff' : '#ff2d95', 0.35 + (depth + 1) * 0.3);
    ctx.beginPath(); ctx.moveTo(proj[i][0], proj[i][1]); ctx.lineTo(proj[j][0], proj[j][1]); ctx.stroke();
  }
  for (const [x, y, z] of proj) {
    ctx.fillStyle = rgba('#ffffff', 0.4 + (z + 1) * 0.3);
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  ctx.restore();
  // Hex shield while nodes stand
  if (e.shielded) {
    ctx.save();
    const sr = e.r * 1.75;
    const hit = e.shieldHit > 0 ? e.shieldHit / 0.15 : 0;
    ctx.strokeStyle = rgba('#00f0ff', 0.35 + hit * 0.5);
    ctx.fillStyle = rgba('#00f0ff', 0.05 + hit * 0.12);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, sr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = rgba('#00f0ff', 0.18 + hit * 0.3);
    ctx.lineWidth = 1;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + t * 0.3;
      const hx = e.x + Math.cos(a) * sr * 0.72, hy = e.y + Math.sin(a) * sr * 0.72;
      ctx.beginPath();
      for (let q = 0; q < 6; q++) {
        const qa = (q / 6) * TAU;
        q ? ctx.lineTo(hx + Math.cos(qa) * 9, hy + Math.sin(qa) * 9) : ctx.moveTo(hx + Math.cos(qa) * 9, hy + Math.sin(qa) * 9);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------
function singularity(ctx, e, t) {
  const hp = e.hp / e.maxHp;
  const hot = hp < 0.5;
  // Gravitational lensing: smeared star arcs circling the hole
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    const rr = e.r * (1.9 + (k % 4) * 0.35);
    const a = t * (0.9 - (k % 4) * 0.15) + k * 1.7;
    ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 0.25 + (k % 3) * 0.1); ctx.stroke();
  }
  // Infalling streams
  ctx.strokeStyle = rgba(hot ? '#ffffff' : '#ff9f43', 0.25);
  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (let s = 0; s <= 20; s++) {
      const u = s / 20;
      const rr = e.r * (4.5 - u * 3.4);
      const a = (e.spin || 0) * 1.7 + (k / 3) * TAU + u * 2.4;
      s ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  ctx.restore();
  drawBlackHoleArt(ctx, e.x, e.y, e.r, t * (hot ? 1.6 : 1), hot ? '#bfe4ff' : '#ff9f43', '#b847ff');
}

// ------------------------------------------------------------
// Minions
// ------------------------------------------------------------
function fighter(ctx, e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.angle || 0);
  ctx.globalCompositeOperation = 'lighter';
  glowDot(ctx, -e.r * 1.1, 0, 8, '#ff9f1a', 0.7);
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(40, 24, 8, 0.9)';
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(e.r * 1.4, 0);
  ctx.lineTo(-e.r, -e.r * 1.1);
  ctx.lineTo(-e.r * 0.5, 0);
  ctx.lineTo(-e.r, e.r * 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe9b0';
  ctx.beginPath(); ctx.arc(e.r * 0.3, 0, 2, 0, TAU); ctx.fill();
  ctx.restore();
}

function node(ctx, e, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.save();
  ctx.rotate(-t * 2);
  ctx.strokeStyle = rgba('#00f0ff', 0.6);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(0, 0, e.r * 1.35, 0, TAU); ctx.stroke();
  ctx.restore();
  ctx.rotate(t * 1.5);
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#062a3a';
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, 3 + Math.sin(t * 8) * 1, 0, TAU); ctx.fill();
  ctx.restore();
}

const ART = { colossus, glacier, helios, arachne, pulsar, binary, leviathan, carrier, kraken, dreadnought, nexus, singularity, fighter, node };

export function drawSpaceEnemy(ctx, e, t, player) {
  const fn = ART[e.type];
  if (!fn) return false;
  fn(ctx, e, t, player);
  return true;
}

// Telegraphed laser beams (Pulsar, Binary tether, Dreadnought cannon).
export function drawBeam(ctx, b, t) {
  const x2 = b.x + Math.cos(b.angle) * b.len, y2 = b.y + Math.sin(b.angle) * b.len;
  ctx.save();
  if (b.warn > 0) {
    const k = 1 - b.warn / b.warnMax;
    ctx.strokeStyle = rgba(b.color, 0.15 + k * 0.25);
    ctx.lineWidth = b.width * (0.3 + k * 0.7);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = rgba(b.color, Math.sin(t * 30) > 0 ? 0.8 : 0.35);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
  } else {
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.85 + Math.sin(t * 60) * 0.15;
    ctx.strokeStyle = rgba(b.color, 0.3 * flick);
    ctx.lineWidth = b.width * 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = rgba(b.color, 0.85);
    ctx.lineWidth = b.width;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, b.width * 0.35);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.restore();
}

