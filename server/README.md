# Neon Drift — Game Server

Colyseus room server for multiplayer lobbies.

## Local dev

```bash
cd server
npm install
npm run dev
```

Server listens on `http://localhost:2567` (WebSocket on `ws://localhost:2567`). The
client picks this up from `VITE_COLYSEUS_URL` in the main project's `.env.local`.

## Railway deploy

1. In the Railway dashboard, create a new project from this GitHub repo (`Tbriggs776/neon-drift`).
2. In the service settings, set **Root Directory** to `server`. Railway will detect Node, run `npm install`, and start via `npm start`.
3. Enable **Generate Domain** in the Networking section. Railway returns a URL like `neon-drift-server-production.up.railway.app`.
4. In Vercel's project settings for the client, add an environment variable:
   - `VITE_COLYSEUS_URL` = `wss://<your-railway-domain>` (note: `wss://`, not `https://`)
5. Redeploy the Vercel project so the new env var is baked into the bundle.

## What the server does

- One room type: `neondrift`, up to 5 pilots.
- On room create, a 6-char code is generated (alphabet skips 0/O/1/I).
- Lobby messages: `setName`, `setLoadout`, `setReady`, `start` (host only, all players must be ready).
- On `start`, the server picks a seed, broadcasts `gameStart { seed }`, locks the room and runs the authoritative simulation at 30Hz. Clients send `input` and `dash`, and pick upgrades with `pickUpgrade` between waves.

### Shared game rules

The 20 sectors, the sector bosses and the cover / hazard simulation live in `/shared` as ES modules, shared with the browser client. The server is CommonJS, so `src/shared.js` loads them with `import()` before the room is defined. Railway builds from the repo root (`railway.toml`), so `/shared` is always there.

What the server syncs for space sectors:
- `obstacles` (+ `mapId`): the wave's cover. Clients paint sprites from each obstacle's `seed`.
- `hazards`: rocks, mines, gravity wells, laser gates, comets, flares, lightning and shock pulses.
- `beams`: telegraphed boss lasers.
- On each enemy: `vals` (the boss's art fields, see `BOSS_SYNC`), `parts` (multi-part hitboxes), `shielded`, and `owner` for a boss's adds.
- `warpTime`, `warpTo`, `sectorWave`: the hyperspace jump between sectors.

### Local play-testing

```bash
cd server
NEON_DEV=1 npm run dev
```

`NEON_DEV=1` turns on test messages: `devWave` (jump to a wave), `devGod` (invulnerable pilot), `devPos` (move your pilot) and `devKill` (clear the wave). Never set it in production.
