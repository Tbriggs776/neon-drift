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

- One room type: `neondrift`, up to 4 clients.
- On room create, a 6-char code is generated (alphabet skips 0/O/1/I).
- Messages handled: `setName`, `setReady`, `start` (host only, all players must be ready).
- On `start`, the server picks a seed and broadcasts `gameStart { seed }` to everyone, then locks the room.

## Phases beyond 8a (not in this server yet)

- 8b: broadcast player positions at 20Hz.
- 8c: server-authoritative simulation (run the game loop on the server, clients send input only).
- 8d: reconnection, in-room chat, disconnect handling.
