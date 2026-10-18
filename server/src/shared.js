// ============================================================
// Game rules shared with the client (/shared): sectors, boss AI, the
// cover / hazard simulation and wingmen. They're ES modules and the server is
// CommonJS, so index.js loads them once with import() before the room is
// defined; shared() hands them out after that.
// ============================================================
const path = require('path');
const { pathToFileURL } = require('url');

let mods = null;

async function loadShared() {
  const load = (file) => import(pathToFileURL(path.join(__dirname, '../../shared', file)).href);
  const [sectors, bosses, sim, wingmen] = await Promise.all([
    load('sectors.js'),
    load('bosses.js'),
    load('spaceSim.js'),
    load('wingmen.js')
  ]);
  mods = { sectors, bosses, sim, wingmen };
  return mods;
}

function shared() {
  if (!mods) throw new Error('shared modules not loaded yet (call loadShared first)');
  return mods;
}

module.exports = { loadShared, shared };
