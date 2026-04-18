const { Room } = require('colyseus');
const { Schema, MapSchema, type } = require('@colyseus/schema');

// ---- Schema state classes (plain JS — no decorators) ----

class Player extends Schema {
  constructor() {
    super();
    this.name = '';
    this.ready = false;
    this.isHost = false;
    // 8b: live gameplay state broadcast from each client while in a started run.
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.hp = 3;
    this.dead = false;
  }
}
type('string')(Player.prototype, 'name');
type('boolean')(Player.prototype, 'ready');
type('boolean')(Player.prototype, 'isHost');
type('float32')(Player.prototype, 'x');
type('float32')(Player.prototype, 'y');
type('float32')(Player.prototype, 'angle');
type('int16')(Player.prototype, 'hp');
type('boolean')(Player.prototype, 'dead');

class RoomState extends Schema {
  constructor() {
    super();
    this.code = '';
    this.started = false;
    this.seed = 0;
    this.players = new MapSchema();
  }
}
type('string')(RoomState.prototype, 'code');
type('boolean')(RoomState.prototype, 'started');
type('int32')(RoomState.prototype, 'seed');
type({ map: Player })(RoomState.prototype, 'players');

// Easy-to-share room code alphabet: no 0/O or 1/I confusables.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  let c = '';
  for (let i = 0; i < 6; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

class NeonDriftRoom extends Room {
  onCreate(options) {
    this.maxClients = 4;
    this.setState(new RoomState());
    this.state.code = generateCode();
    // Expose the code via metadata so other clients can find it.
    this.setMetadata({ code: this.state.code });

    this.onMessage('setName', (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.name = String(name || '').slice(0, 20);
    });

    this.onMessage('setReady', (client, ready) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.started) return;
      p.ready = !!ready;
    });

    this.onMessage('playerState', (client, payload) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !this.state.started) return;
      if (typeof payload?.x === 'number') p.x = payload.x;
      if (typeof payload?.y === 'number') p.y = payload.y;
      if (typeof payload?.angle === 'number') p.angle = payload.angle;
      if (typeof payload?.hp === 'number') p.hp = payload.hp | 0;
      if (typeof payload?.dead === 'boolean') p.dead = payload.dead;
    });

    this.onMessage('start', (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.isHost || this.state.started) return;
      const all = Array.from(this.state.players.values());
      if (all.length < 1) return;
      const allReady = all.every((x) => x.ready);
      if (!allReady) return;
      this.state.seed = Math.floor(Math.random() * 0x7fffffff);
      this.state.started = true;
      this.broadcast('gameStart', { seed: this.state.seed });
      // Lock the room so no new joins mid-run.
      this.lock();
    });
  }

  onJoin(client, options) {
    const player = new Player();
    player.name = (options && options.name)
      ? String(options.name).slice(0, 20)
      : 'Pilot';
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    const wasHost = this.state.players.get(client.sessionId)?.isHost || false;
    this.state.players.delete(client.sessionId);
    if (wasHost && this.state.players.size > 0) {
      const next = this.state.players.values().next().value;
      if (next) next.isHost = true;
    }
  }
}

module.exports = { NeonDriftRoom, Player, RoomState };
