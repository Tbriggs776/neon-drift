// ============================================================
// WINGMEN: a squad of small fighters you call in
// ============================================================
// Kills charge a meter; when it's full the pilot launches a squad that
// flies free around the arena for a while, hunting enemies on its own
// (not orbiting the ship like Combat Drones). The meter doesn't charge
// while the squad is out.
//
// Shared by single player (src/game.js) and the multiplayer server
// (server/src/NeonDriftRoom.js). updateWingman() gets the wingman `w` and
// a small API `g`:
//   g.W, g.H                  arena size
//   g.home                    { x, y } of the pilot who launched it
//   g.enemies()               targets: x, y, r, optional vx/vy for leading (skip intangible)
//   g.alive(e)                is that target still in the fight
//   g.shoot(w, angle)         fire one shot from the wingman
// ============================================================

export const WING = {
  squad: 3,            // fighters per launch
  duration: 15,        // seconds they stay out
  perKill: 0.05,       // meter per kill (20 kills to fill)
  perBossKill: 0.35,
  speed: 330,
  turn: 3.2,           // how quickly velocity bends toward where it wants to go
  range: 340,          // firing range
  fireCD: 0.25,
  damage: 0.8,         // of the pilot's main-gun damage (shots also home lightly)
  shotSpeed: 620,
  strafe: 150          // circles this far from its target while firing
};

export function wingCharge(isBoss) {
  return isBoss ? WING.perBossKill : WING.perKill;
}

// A fresh squad fanning out from the pilot. `rand` is any 0..1 source.
export function launchSquad(x, y, angle, rand) {
  const squad = [];
  for (let k = 0; k < WING.squad; k++) {
    const a = angle + (k - (WING.squad - 1) / 2) * 0.9;
    squad.push({
      x, y,
      vx: Math.cos(a) * WING.speed, vy: Math.sin(a) * WING.speed,
      angle: a,
      fireCD: 0.3 + k * 0.1,
      retarget: 0,
      target: null,
      orbit: rand() < 0.5 ? 1 : -1,   // which way it circles a target
      wp: null                         // patrol waypoint when nothing's left
    });
  }
  return squad;
}

function nearest(w, g) {
  let best = null, bd = Infinity;
  for (const e of g.enemies()) {
    if (e.intangible) continue;
    const d = Math.hypot(e.x - w.x, e.y - w.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

export function updateWingman(w, dt, g) {
  w.retarget -= dt;
  if (!w.target || !g.alive(w.target) || w.retarget <= 0) {
    w.target = nearest(w, g);
    w.retarget = 0.6;
  }

  // Where it wants to be: circling its target at strafe range, or patrolling
  let tx, ty;
  const t = w.target;
  if (t) {
    const dx = w.x - t.x, dy = w.y - t.y;
    const d = Math.hypot(dx, dy) || 1;
    const around = Math.atan2(dy, dx) + w.orbit * 0.6;
    const ring = WING.strafe + (t.r || 12);
    tx = t.x + Math.cos(around) * ring;
    ty = t.y + Math.sin(around) * ring;
    if (d > ring * 2) { tx = t.x; ty = t.y; }   // far off: close the distance first
  } else {
    if (!w.wp || Math.hypot(w.wp.x - w.x, w.wp.y - w.y) < 60) {
      // Patrol near the pilot so the squad is on hand when the next wave lands
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 160;
      w.wp = { x: g.home.x + Math.cos(a) * r, y: g.home.y + Math.sin(a) * r };
    }
    tx = w.wp.x; ty = w.wp.y;
  }

  const want = Math.atan2(ty - w.y, tx - w.x);
  const k = Math.min(1, dt * WING.turn);
  w.vx += (Math.cos(want) * WING.speed - w.vx) * k;
  w.vy += (Math.sin(want) * WING.speed - w.vy) * k;
  w.x += w.vx * dt;
  w.y += w.vy * dt;
  // Stay in the arena: turn back at the walls
  const m = 20;
  if (w.x < m) { w.x = m; w.vx = Math.abs(w.vx); }
  if (w.x > g.W - m) { w.x = g.W - m; w.vx = -Math.abs(w.vx); }
  if (w.y < m) { w.y = m; w.vy = Math.abs(w.vy); }
  if (w.y > g.H - m) { w.y = g.H - m; w.vy = -Math.abs(w.vy); }

  // Nose follows the target while in range, else the flight path
  const inRange = t && Math.hypot(t.x - w.x, t.y - w.y) < WING.range + (t.r || 0);
  w.angle = inRange ? Math.atan2(t.y - w.y, t.x - w.x) : Math.atan2(w.vy, w.vx);
  w.fireCD -= dt;
  if (inRange && w.fireCD <= 0) {
    w.fireCD = WING.fireCD;
    // Lead the target: aim where it will be when the shot arrives
    const lead = Math.hypot(t.x - w.x, t.y - w.y) / WING.shotSpeed;
    g.shoot(w, Math.atan2(t.y + (t.vy || 0) * lead - w.y, t.x + (t.vx || 0) * lead - w.x));
  }
}
