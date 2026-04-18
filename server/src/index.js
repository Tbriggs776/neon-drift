const http = require('http');
const express = require('express');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { NeonDriftRoom } = require('./NeonDriftRoom.js');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.type('text/plain').send('neon-drift game server'));

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define('neondrift', NeonDriftRoom);

const port = Number(process.env.PORT) || 2567;
// Railway (and most cloud hosts) require binding to 0.0.0.0 explicitly
// so the edge proxy can route traffic to the container.
gameServer.listen(port, '0.0.0.0').then(() => {
  console.log(`[neon-drift-server] listening on 0.0.0.0:${port}`);
}).catch((err) => {
  console.error('[neon-drift-server] failed to start:', err);
  process.exit(1);
});
