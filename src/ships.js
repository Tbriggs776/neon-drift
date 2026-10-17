// ============================================================
// SHIPS — the ten player ships, their art and their perks.
//
// Each ship's hull is drawn once per color into an offscreen sprite (the
// gradients and glows are too costly to redraw every frame on phones);
// engine flames are drawn live on top. Ship-local units: the nose points to
// +x, ships are about 46 long and 34 wide. drawShipModel() is called inside
// the player's transform (translate/rotate/bank) and scales to game size.
//
// Perk numbers live in shared/ships.json so the multiplayer server applies
// exactly the same stats.
// ============================================================
import SHIP_STATS from '../shared/ships.json';

// Pilot colors. In multiplayer the server gives each pilot their chosen
// color unless someone already has it.
export const PILOT_COLORS = ['#ff2d95', '#00f0ff', '#39ff14', '#bc8cff', '#ff8c1a', '#ff3b3b', '#3b7bff', '#ffd23f'];
export const PILOT_COLOR_NAMES = ['Magenta', 'Cyan', 'Lime', 'Violet', 'Ember', 'Crimson', 'Cobalt', 'Gold'];

// ---------- color + path helpers ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, target, amt) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amt));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
// Top-half outline (from nose to tail, y <= 0) mirrored into a full outline.
function mirrored(top) {
  const bottom = top.slice(1, -1).reverse().map(([x, y]) => [x, -y]);
  return top.concat(bottom);
}
function vGrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function glowLine(ctx, color, width, blur, segs) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
  ctx.stroke();
  ctx.restore();
}
function dropShadow(ctx) {
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
}
const STEEL_LIGHT = '#e9edf1', STEEL_MID = '#a7aeb6', STEEL_DARK = '#4b5158';
const GLASS_HI = '#323b48', GLASS_LO = '#040507';

// ---------- the ten hulls ----------

function bodyGlide(ctx, color) {
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(1, s);
    ctx.beginPath();
    ctx.moveTo(6, -6);
    ctx.quadraticCurveTo(-4, -10, -11, -16.5);
    ctx.quadraticCurveTo(-14.5, -17, -14, -13);
    ctx.quadraticCurveTo(-12, -9, -10, -5);
    ctx.closePath();
    ctx.fillStyle = vGrad(ctx, -17, -5, [[0, mix(color, '#000000', 0.35)], [0.6, color], [1, mix(color, '#ffffff', 0.25)]]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 236, 242, 0.85)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(23, 0);
  ctx.bezierCurveTo(18, -6.5, 6, -9.5, -4, -8.5);
  ctx.bezierCurveTo(-11, -8, -15, -6, -15, 0);
  ctx.bezierCurveTo(-15, 6, -11, 8, -4, 8.5);
  ctx.bezierCurveTo(6, 9.5, 18, 6.5, 23, 0);
  ctx.closePath();
  ctx.save();
  dropShadow(ctx);
  ctx.fillStyle = vGrad(ctx, -9, 9, [[0, mix(color, '#ffffff', 0.45)], [0.35, color], [1, mix(color, '#000000', 0.55)]]);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = vGrad(ctx, -8, -2, [[0, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  ctx.beginPath();
  ctx.ellipse(4, -5.2, 15, 2.2, -0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const glass = ctx.createRadialGradient(9, -1.5, 0.5, 7, 0, 9);
  glass.addColorStop(0, '#3a4452');
  glass.addColorStop(1, '#050608');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(7, 0, 8.5, 4.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 210, 220, 0.7)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(7, 0, 6.6, 2.9, 0, Math.PI * 1.12, Math.PI * 1.55);
  ctx.stroke();
  glowLine(ctx, 'rgba(255,255,255,0.9)', 0.9, 6, [[19, -3.6, 22.4, -0.8], [19, 3.6, 22.4, 0.8]]);
  for (const y of [-3.6, 3.6]) {
    ctx.fillStyle = '#1b1e22';
    ctx.beginPath(); ctx.arc(-14.2, y, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(220, 226, 232, 0.8)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function bodyMonolith(ctx, color) {
  const hull = [[22, 0], [-5, -14], [-16, -11], [-14, 0], [-16, 11], [-5, 14]];
  ctx.save();
  poly(ctx, hull);
  dropShadow(ctx);
  ctx.fillStyle = '#7d848c';
  ctx.fill();
  ctx.restore();
  ctx.save();
  poly(ctx, hull);
  ctx.clip();
  ctx.fillStyle = vGrad(ctx, -14, 0, [[0, STEEL_LIGHT], [1, STEEL_MID]]);
  poly(ctx, [[22, 0], [-5, -14], [-16, -11], [-14, 0]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, 0, 14, [[0, '#80878f'], [1, STEEL_DARK]]);
  poly(ctx, [[22, 0], [-14, 0], [-16, 11], [-5, 14]]);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  poly(ctx, [[22, 0], [8, -7], [8, 7]]);
  ctx.fill();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.3;
  for (let x = -18; x < 24; x += 1.4) {
    ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x + 3, 16); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.55)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(-14, 0);
  ctx.moveTo(8, -7); ctx.lineTo(8, 7);
  ctx.moveTo(-5, -14); ctx.lineTo(-2, -4);
  ctx.moveTo(-5, 14); ctx.lineTo(-2, 4);
  ctx.stroke();
  const g = ctx.createLinearGradient(10, -5, -2, 5);
  g.addColorStop(0, '#2c3440');
  g.addColorStop(1, '#07090c');
  ctx.fillStyle = g;
  poly(ctx, [[12, 0], [0, -6], [-3, 0], [0, 6]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 230, 255, 0.55)';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(9, -1.2); ctx.lineTo(2, -4.4); ctx.stroke();
  glowLine(ctx, 'rgba(255,255,255,0.95)', 1.1, 8, [[-1, -12.6, 20.5, -0.6], [-1, 12.6, 20.5, 0.6]]);
  glowLine(ctx, color, 1.6, 10, [[-15.4, -10, -13.6, -1], [-15.4, 10, -13.6, 1]]);
  ctx.fillStyle = '#2a2e33';
  ctx.fillRect(-17, -7.5, 3, 4);
  ctx.fillRect(-17, 3.5, 3, 4);
}

function bodyPlaid(ctx, color) {
  const outline = mirrored([[23, 0], [12, -3.5], [2, -5.5], [-6, -15.5], [-12, -16], [-10.5, -6.5], [-16.5, -4.5], [-16.5, 0]]);
  ctx.save();
  poly(ctx, outline);
  dropShadow(ctx);
  ctx.fillStyle = vGrad(ctx, -16, 16, [[0, '#ffffff'], [0.45, '#e3e8ee'], [1, '#9ea8b4']]);
  ctx.fill();
  ctx.restore();
  ctx.save();
  poly(ctx, outline);
  ctx.clip();
  const sheen = ctx.createLinearGradient(-16, -16, 24, 16);
  sheen.addColorStop(0, 'rgba(200, 220, 255, 0)');
  sheen.addColorStop(0.5, 'rgba(255, 230, 245, 0.25)');
  sheen.addColorStop(1, 'rgba(200, 220, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-20, -20, 46, 40);
  ctx.strokeStyle = 'rgba(70, 80, 95, 0.4)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(-2, -5.5); ctx.lineTo(-10.5, -6.5);
  ctx.moveTo(-2, 5.5); ctx.lineTo(-10.5, 6.5);
  ctx.moveTo(-16.5, 0); ctx.lineTo(-6, 0);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(1, -6.6); ctx.lineTo(-6.6, -14.4);
  ctx.moveTo(1, 6.6); ctx.lineTo(-6.6, 14.4);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-15.5, 0); ctx.stroke();
  ctx.restore();
  const glass = ctx.createLinearGradient(16, 0, -4, 0);
  glass.addColorStop(0, GLASS_HI);
  glass.addColorStop(1, GLASS_LO);
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.quadraticCurveTo(8, -3.6, -3, -3.2);
  ctx.quadraticCurveTo(-5, 0, -3, 3.2);
  ctx.quadraticCurveTo(8, 3.6, 16, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(12, -1); ctx.quadraticCurveTo(6, -2.6, 1, -2.4); ctx.stroke();
  glowLine(ctx, 'rgba(255,255,255,0.95)', 1, 8, [[17.5, -1.9, 21.8, -0.4], [17.5, 1.9, 21.8, 0.4]]);
  ctx.fillStyle = '#1b1e22';
  ctx.fillRect(-17.5, -4.6, 2.4, 3.6);
  ctx.fillRect(-17.5, 1, 2.4, 3.6);
}

// X-wing style: long white fuselage, four wings in an open X, wingtip cannons.
function bodyStriker(ctx, color) {
  // Wings: the far (lower) pair darker and offset, the near pair on top.
  for (const s of [-1, 1]) {
    for (const layer of [0, 1]) {
      const dx = layer === 0 ? -1.6 : 0;
      ctx.save();
      ctx.scale(1, s);
      poly(ctx, [[-3 + dx, -3], [-6 + dx, -17], [-12.5 + dx, -17], [-13 + dx, -3]]);
      ctx.fillStyle = layer === 0
        ? '#6d737b'
        : vGrad(ctx, -17, -3, [[0, '#c9ced4'], [1, '#f2f4f6']]);
      if (layer === 1) dropShadow(ctx);
      ctx.fill();
      ctx.restore();
      if (layer === 1) {
        ctx.save();
        ctx.scale(1, s);
        // Squadron stripe in the pilot color
        ctx.fillStyle = color;
        poly(ctx, [[-4.4, -8], [-5.2, -11], [-12.7, -11], [-12.9, -8]]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 44, 50, 0.5)';
        ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-9.3, -17); ctx.stroke();
        // Wingtip cannon
        ctx.fillStyle = '#3a3f46';
        ctx.fillRect(-12, -17.9, 23, 1.6);
        ctx.fillStyle = '#9aa1a9';
        ctx.fillRect(9, -18.1, 4, 2);
        ctx.restore();
      }
    }
  }
  // Engine nacelles at the wing roots
  for (const y of [-5.2, 5.2]) {
    ctx.fillStyle = vGrad(ctx, y - 2.6, y + 2.6, [[0, '#d9dde2'], [1, '#6f767e']]);
    ctx.beginPath();
    ctx.roundRect(-16, y - 2.6, 13, 5.2, 2.6);
    ctx.fill();
    ctx.fillStyle = '#1d2024';
    ctx.beginPath(); ctx.ellipse(-3.4, y, 0.9, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Fuselage
  const fuselage = mirrored([[25, 0], [12, -1.8], [2, -3.6], [-12, -3.8], [-15, -2.6], [-15, 0]]);
  ctx.save();
  poly(ctx, fuselage);
  dropShadow(ctx);
  ctx.fillStyle = vGrad(ctx, -4, 4, [[0, '#ffffff'], [0.5, '#dfe3e8'], [1, '#8d959e']]);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  poly(ctx, [[18, -0.9], [12, -1.6], [12, 1.6], [18, 0.9]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, -2.6, 2.6, [[0, GLASS_HI], [1, GLASS_LO]]);
  ctx.beginPath();
  ctx.ellipse(4.5, 0, 4.6, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(4.5, 0, 3.6, 1.5, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
}

// TIE style: metal ball cockpit between two hexagonal solar panels.
function bodyInterceptor(ctx, color) {
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(1, s);
    // Strut
    ctx.fillStyle = vGrad(ctx, -11, -4, [[0, '#9aa1a9'], [1, '#5c636b']]);
    ctx.fillRect(-2, -11, 4, 7);
    // Hex panel
    const hex = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      hex.push([Math.cos(a) * 11.5, -15 + Math.sin(a) * 4.6]);
    }
    ctx.save();
    poly(ctx, hex);
    dropShadow(ctx);
    ctx.fillStyle = vGrad(ctx, -19.6, -10.4, [[0, '#2a3340'], [1, '#141920']]);
    ctx.fill();
    ctx.restore();
    ctx.save();
    poly(ctx, hex);
    ctx.clip();
    ctx.strokeStyle = 'rgba(140, 160, 185, 0.35)';
    ctx.lineWidth = 0.4;
    for (let x = -12; x <= 12; x += 2.2) {
      ctx.beginPath(); ctx.moveTo(x, -20); ctx.lineTo(x, -10); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#b8bec6';
    ctx.lineWidth = 1.1;
    poly(ctx, hex);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-10.5, -15); ctx.lineTo(10.5, -15); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  // Ball cockpit
  ctx.save();
  dropShadow(ctx);
  const ball = ctx.createRadialGradient(-1.5, -2.5, 1, 0, 0, 7);
  ball.addColorStop(0, '#e7ebef');
  ball.addColorStop(0.6, '#8d959e');
  ball.addColorStop(1, '#3d434a');
  ctx.fillStyle = ball;
  ctx.beginPath(); ctx.arc(0, 0, 6.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Octagonal window with spokes
  ctx.fillStyle = GLASS_LO;
  ctx.beginPath(); ctx.arc(2.4, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = 0.45;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(2.4, 0); ctx.lineTo(2.4 + Math.cos(a) * 3.3, Math.sin(a) * 3.3); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#5c636b';
  ctx.fillRect(5.6, -2.6, 1.6, 1.4);
  ctx.fillRect(5.6, 1.2, 1.6, 1.4);
}

// Light-freighter style: a round saucer with two forward mandibles and a
// side-mounted cockpit tube.
function bodyCorsair(ctx, color) {
  // Mandibles
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(1, s);
    poly(ctx, [[6, -2], [21, -2.4], [23, -3.8], [21, -8.4], [6, -10]]);
    ctx.fillStyle = vGrad(ctx, -10, -2, [[0, '#8d949c'], [1, '#c6cbd1']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 44, 50, 0.5)';
    ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(10, -2.3); ctx.lineTo(10, -9.6); ctx.moveTo(16, -2.4); ctx.lineTo(16, -9); ctx.stroke();
    ctx.restore();
  }
  // Saucer
  ctx.save();
  dropShadow(ctx);
  const disc = ctx.createRadialGradient(-6, -5, 2, -3, 0, 16);
  disc.addColorStop(0, '#e2e6ea');
  disc.addColorStop(0.7, '#a0a7af');
  disc.addColorStop(1, '#5c636b');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(-3, 0, 14.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(40, 44, 50, 0.45)';
  ctx.lineWidth = 0.45;
  ctx.beginPath(); ctx.arc(-3, 0, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(-3, 0, 4.5, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(-3 + Math.cos(a) * 4.5, Math.sin(a) * 4.5);
    ctx.lineTo(-3 + Math.cos(a) * 14.5, Math.sin(a) * 14.5);
    ctx.stroke();
  }
  // Greeble vents
  ctx.fillStyle = 'rgba(30, 33, 38, 0.6)';
  [[-12, -4, 3, 2], [-9, 6, 2.5, 3], [0, -10, 3, 1.6], [-14, 2, 2, 2], [2, 7, 2.2, 1.6]].forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));
  // Dish
  ctx.fillStyle = '#d8dce1';
  ctx.beginPath(); ctx.arc(-7, -7.5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6a7179';
  ctx.beginPath(); ctx.arc(-7, -7.5, 1.1, 0, Math.PI * 2); ctx.fill();
  // Side cockpit tube
  ctx.fillStyle = vGrad(ctx, 9.5, 14.5, [[0, '#d0d4d9'], [1, '#7b828a']]);
  ctx.beginPath(); ctx.roundRect(2, 9.5, 11, 5, 2.5); ctx.fill();
  ctx.fillStyle = GLASS_LO;
  ctx.beginPath(); ctx.arc(12, 12, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Rear engine grille glows in the pilot color
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(-3, 0, 13.6, Math.PI * 0.78, Math.PI * 1.22); ctx.stroke();
  ctx.restore();
}

// A-wing style: a small wedge between two big side engines.
function bodyDart(ctx, color) {
  for (const y of [-11, 11]) {
    ctx.save();
    dropShadow(ctx);
    ctx.fillStyle = vGrad(ctx, y - 3, y + 3, [[0, '#dfe3e7'], [1, '#6c737b']]);
    ctx.beginPath(); ctx.roundRect(-16, y - 3, 19, 6, 1.4); ctx.fill();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillRect(-12, y - 0.8, 13, 1.6);
    ctx.fillStyle = '#2b2f35';
    ctx.fillRect(2, y - 2.2, 2.5, 4.4);
  }
  const wedge = mirrored([[21, 0], [6, -5], [-10, -9], [-14, -8], [-12, 0]]);
  ctx.save();
  poly(ctx, wedge);
  dropShadow(ctx);
  ctx.fillStyle = vGrad(ctx, -9, 9, [[0, mix(color, '#ffffff', 0.35)], [0.5, color], [1, mix(color, '#000000', 0.5)]]);
  ctx.fill();
  ctx.restore();
  // White nose panels like the real paint scheme
  ctx.fillStyle = vGrad(ctx, -5, 5, [[0, '#ffffff'], [1, '#b7bec6']]);
  poly(ctx, [[21, 0], [9, -4], [9, 4]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, -2.4, 2.4, [[0, GLASS_HI], [1, GLASS_LO]]);
  ctx.beginPath(); ctx.ellipse(3, 0, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.ellipse(3, 0, 2.8, 1.6, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
}

// Y-wing style: long cockpit nose, a thin neck and two long engine nacelles.
function bodyHalberd(ctx, color) {
  for (const y of [-9, 9]) {
    ctx.save();
    dropShadow(ctx);
    ctx.fillStyle = vGrad(ctx, y - 2.8, y + 2.8, [[0, '#e3e6ea'], [1, '#737a82']]);
    ctx.beginPath(); ctx.roundRect(-20, y - 2.8, 24, 5.6, 2.8); ctx.fill();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillRect(-1, y - 2.6, 2.2, 5.2);
    ctx.strokeStyle = 'rgba(40, 44, 50, 0.5)';
    ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(-14, y - 2.6); ctx.lineTo(-14, y + 2.6); ctx.moveTo(-8, y - 2.6); ctx.lineTo(-8, y + 2.6); ctx.stroke();
  }
  // Cross spar and neck
  ctx.fillStyle = '#7c838b';
  ctx.fillRect(-6, -9, 3.4, 18);
  ctx.fillStyle = '#5b6168';
  ctx.fillRect(-4, -1.8, 13, 3.6);
  ctx.strokeStyle = 'rgba(200, 205, 212, 0.5)';
  ctx.lineWidth = 0.4;
  for (let x = -3; x < 9; x += 1.6) {
    ctx.beginPath(); ctx.moveTo(x, -1.8); ctx.lineTo(x + 0.8, 1.8); ctx.stroke();
  }
  // Cockpit section
  const nose = mirrored([[25, 0], [20, -2.6], [9, -4.4], [7, -3.6], [7, 0]]);
  ctx.save();
  poly(ctx, nose);
  dropShadow(ctx);
  ctx.fillStyle = vGrad(ctx, -4.4, 4.4, [[0, '#ffffff'], [0.5, '#dadfe4'], [1, '#8a929b']]);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  poly(ctx, [[21, -1.9], [17, -3], [17, 3], [21, 1.9]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, -2, 2, [[0, GLASS_HI], [1, GLASS_LO]]);
  ctx.beginPath(); ctx.ellipse(12.5, 0, 3.4, 2, 0, 0, Math.PI * 2); ctx.fill();
  // Ion turret
  ctx.fillStyle = '#545a61';
  ctx.beginPath(); ctx.arc(9, 0, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(9, -0.4, 5, 0.8);
}

// Naboo starfighter style: a chrome needle with swept engine pods and long
// tail spikes.
function bodyRoyal(ctx, color) {
  const chrome = (y0, y1) => vGrad(ctx, y0, y1, [[0, '#ffffff'], [0.35, '#c9ced4'], [0.55, '#6e757d'], [0.8, '#e6e9ec'], [1, '#8a9199']]);
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(1, s);
    // Swept arm
    poly(ctx, [[4, -2.4], [-3, -9], [-6, -9], [-2, -2.4]]);
    ctx.fillStyle = '#9ba2aa';
    ctx.fill();
    // Engine pod with a long tail spike
    ctx.save();
    dropShadow(ctx);
    ctx.beginPath();
    ctx.moveTo(3, -10.5);
    ctx.quadraticCurveTo(4.5, -12.8, 0, -13);
    ctx.lineTo(-12, -12.6);
    ctx.lineTo(-24, -10.5);
    ctx.lineTo(-12, -8.6);
    ctx.lineTo(0, -8.2);
    ctx.quadraticCurveTo(4.5, -8.4, 3, -10.5);
    ctx.closePath();
    ctx.fillStyle = chrome(-13, -8.2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillRect(-2, -12.9, 2.2, 4.6);
    ctx.restore();
  }
  const needle = mirrored([[27, 0], [14, -2.4], [4, -4], [-4, -3.4], [-8, -1.6], [-8, 0]]);
  ctx.save();
  poly(ctx, needle);
  dropShadow(ctx);
  ctx.fillStyle = chrome(-4, 4);
  ctx.fill();
  ctx.restore();
  // Painted spine (yellow on the original, the pilot color here)
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = vGrad(ctx, -1.8, 1.8, [[0, GLASS_HI], [1, GLASS_LO]]);
  ctx.beginPath(); ctx.ellipse(9.5, 0, 3.6, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  // Astromech dome
  ctx.fillStyle = '#f2f4f6';
  ctx.beginPath(); ctx.arc(-5, 0, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(-5.6, -0.5, 1.2, 1);
}

// Star Destroyer style: a long grey wedge with a stepped superstructure and
// a bridge tower at the stern.
function bodyDreadnought(ctx, color) {
  const wedge = [[26, 0], [-15, -15], [-15, 15]];
  ctx.save();
  poly(ctx, wedge);
  dropShadow(ctx);
  ctx.fillStyle = '#8a9198';
  ctx.fill();
  ctx.restore();
  ctx.save();
  poly(ctx, wedge);
  ctx.clip();
  ctx.fillStyle = vGrad(ctx, -15, 0, [[0, '#c3c8ce'], [1, '#e6e9ec']]);
  poly(ctx, [[26, 0], [-15, -15], [-15, 0]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, 0, 15, [[0, '#a4abb2'], [1, '#5f666e']]);
  poly(ctx, [[26, 0], [-15, 0], [-15, 15]]);
  ctx.fill();
  // Hull plating grid
  ctx.strokeStyle = 'rgba(40, 44, 50, 0.3)';
  ctx.lineWidth = 0.35;
  for (let x = -14; x < 24; x += 3) {
    ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x, 16); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(-15, -9); ctx.moveTo(24, 0); ctx.lineTo(-15, 9); ctx.stroke();
  ctx.restore();
  // Center trench
  ctx.strokeStyle = 'rgba(30, 33, 38, 0.6)';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(4, 0); ctx.stroke();
  // Stepped superstructure
  ctx.fillStyle = vGrad(ctx, -5, 5, [[0, '#d7dbe0'], [1, '#727981']]);
  poly(ctx, [[6, 0], [-15, -5.5], [-15, 5.5]]);
  ctx.fill();
  ctx.fillStyle = vGrad(ctx, -3, 3, [[0, '#e8ebee'], [1, '#808790']]);
  ctx.fillRect(-14, -3, 8, 6);
  // Bridge tower and its two globes
  ctx.fillStyle = '#5b6168';
  ctx.fillRect(-12.5, -4.4, 2.6, 8.8);
  ctx.fillStyle = '#d9dde2';
  ctx.beginPath(); ctx.arc(-11.2, -5.6, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-11.2, 5.6, 1.4, 0, Math.PI * 2); ctx.fill();
  // Running lights in the pilot color along the leading edges
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  for (let k = 0; k < 5; k++) {
    const t = 0.15 + k * 0.17;
    const x = 26 - 41 * t, y = 15 * t;
    ctx.beginPath(); ctx.arc(x, -y + 0.6, 0.55, 0, Math.PI * 2); ctx.arc(x, y - 0.6, 0.55, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---------- the roster ----------
// engines: [x, y, length, halfWidth] flames drawn live behind the hull.
// guns: [x, y] muzzle points for the firing flash.
const ART = {
  glide:       { body: bodyGlide,       engines: [[-14, -3.6, 14, 2.8], [-14, 3.6, 14, 2.8]], guns: [[22, -2], [22, 2]] },
  monolith:    { body: bodyMonolith,    engines: [[-15, -5.5, 16, 3.2], [-15, 5.5, 16, 3.2]], guns: [[20, -1.5], [20, 1.5]] },
  plaid:       { body: bodyPlaid,       engines: [[-16, -2.8, 17, 2.6], [-16, 2.8, 17, 2.6]], guns: [[22, -1], [22, 1]] },
  striker:     { body: bodyStriker,     engines: [[-16, -5.2, 15, 2.4], [-16, 5.2, 15, 2.4]], guns: [[13, -17.1], [13, 17.1]] },
  interceptor: { body: bodyInterceptor, engines: [[-6.5, -2.2, 10, 1.8], [-6.5, 2.2, 10, 1.8]], guns: [[7.5, -1.9], [7.5, 1.9]] },
  corsair:     { body: bodyCorsair,     engines: [[-17.5, -4.5, 13, 2.4], [-18, 0, 14, 2.6], [-17.5, 4.5, 13, 2.4]], guns: [[23, -3.8], [23, 3.8]] },
  dart:        { body: bodyDart,        engines: [[-16, -11, 16, 2.8], [-16, 11, 16, 2.8]], guns: [[4.5, -11], [4.5, 11]] },
  halberd:     { body: bodyHalberd,     engines: [[-20, -9, 17, 2.6], [-20, 9, 17, 2.6]], guns: [[25, -0.6], [25, 0.6]] },
  royal:       { body: bodyRoyal,       engines: [[-11, -10.6, 13, 2.2], [-11, 10.6, 13, 2.2]], guns: [[16, -2], [16, 2]] },
  dreadnought: { body: bodyDreadnought, engines: [[-15, -6, 15, 2.8], [-15, 0, 18, 3.2], [-15, 6, 15, 2.8]], guns: [[12, -7.5], [12, 7.5]] }
};

export const SHIPS = SHIP_STATS.map((s) => ({ ...s, ...ART[s.id] }));
export const DEFAULT_SHIP = SHIPS[0].id;

export function getShip(id) {
  return SHIPS.find((s) => s.id === id) || SHIPS[0];
}

// ---------- sprite cache ----------
// Hull sprites cover ship-local x in [-26, 30], y in [-21, 21].
const SPRITE_X0 = -26, SPRITE_Y0 = -21, SPRITE_W = 56, SPRITE_H = 42, SPRITE_RES = 4;
const spriteCache = new Map();

function getSprite(ship, color) {
  const key = ship.id + color;
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = SPRITE_W * SPRITE_RES;
    c.height = SPRITE_H * SPRITE_RES;
    const g = c.getContext('2d');
    g.setTransform(SPRITE_RES, 0, 0, SPRITE_RES, -SPRITE_X0 * SPRITE_RES, -SPRITE_Y0 * SPRITE_RES);
    ship.body(g, color);
    spriteCache.set(key, c);
  }
  return c;
}

// Engine flame: a soft cone in the pilot color with a white-hot core.
function flame(ctx, x, y, len, width, color, t, seed) {
  const flick = 1 + Math.sin(t * 38 + seed) * 0.12 + Math.sin(t * 61 + seed * 2) * 0.06;
  const L = len * flick;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x, y, x - L, y);
  g.addColorStop(0, rgba(color, 0.95));
  g.addColorStop(0.45, rgba(color, 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - width);
  ctx.quadraticCurveTo(x - L * 0.55, y - width * 0.9, x - L, y);
  ctx.quadraticCurveTo(x - L * 0.55, y + width * 0.9, x, y + width);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.ellipse(x - L * 0.15, y, L * 0.25, width * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Ships are designed about 46 units long; the game draws them at this scale
// so they read the same size as the old 28px ship plus a little presence.
export const SHIP_GAME_SCALE = 0.78;

// Draws a ship in the current transform (origin = ship center, +x = nose).
// opts: { thrust (0..1+), flash (hit blink), alpha, scale }
export function drawShipModel(ctx, id, color, t, opts = {}) {
  const ship = getShip(id);
  const scale = opts.scale ?? SHIP_GAME_SCALE;
  ctx.save();
  ctx.scale(scale, scale);
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  const thrust = opts.thrust ?? 1;
  ship.engines.forEach(([x, y, len, w], i) => flame(ctx, x, y, len * (0.55 + 0.45 * thrust), w, color, t, i * 1.7));
  ctx.drawImage(getSprite(ship, color), SPRITE_X0, SPRITE_Y0, SPRITE_W, SPRITE_H);
  if (opts.flash) {
    // Hit blink: brighten the hull for a frame.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= 0.55;
    ctx.drawImage(getSprite(ship, color), SPRITE_X0, SPRITE_Y0, SPRITE_W, SPRITE_H);
  }
  ctx.restore();
}

// Muzzle points in game units (already scaled), for the firing flash.
export function shipGuns(id) {
  return getShip(id).guns.map(([x, y]) => [x * SHIP_GAME_SCALE, y * SHIP_GAME_SCALE]);
}
