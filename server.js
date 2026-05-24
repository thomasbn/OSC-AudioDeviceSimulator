const express = require('express');
const WebSocket = require('ws');
const osc = require('osc');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ── Device state ───────────────────────────────────────────────────────────
const CH = 8;

const state = {
  channels: Array.from({ length: CH }, (_, i) => ({
    id: i + 1,
    name: `CH ${i + 1}`,
    fader: 0.75,
    pan: 0.0,
    mute: false,
    solo: false,
    eq: { high: 0, mid: 0, low: 0 },
    level: 0,
    clip: false,
  })),
  master: { volume: 0.85, levelL: 0, levelR: 0, clipL: false, clipR: false },
  transport: { playing: false, recording: false, bpm: 120, position: 0 },
};

// ── OSC ────────────────────────────────────────────────────────────────────
let udpPort = null;
let oscCfg = { localPort: 8000, remoteAddress: '127.0.0.1', remotePort: 57120 };

function argValue(a) {
  return a !== null && typeof a === 'object' && 'value' in a ? a.value : a;
}

function openOSC(cfg) {
  if (udpPort) {
    try { udpPort.close(); } catch (_) {}
    udpPort = null;
  }
  oscCfg = { ...cfg };

  const port = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: cfg.localPort,
    remoteAddress: cfg.remoteAddress,
    remotePort: cfg.remotePort,
    metadata: true,
  });

  port.on('message', (msg, _tt, info) => {
    applyOSC(msg);
    broadcast({
      type: 'osc_in',
      address: msg.address,
      args: msg.args.map(argValue),
      from: `${info.address}:${info.port}`,
      ts: Date.now(),
    });
    broadcast({ type: 'state', state });
  });

  port.on('error', err => {
    console.error('OSC error:', err.message);
    broadcast({ type: 'osc_error', message: err.message });
  });

  port.open();
  udpPort = port;
  console.log(`OSC UDP  listen :${cfg.localPort}  →  ${cfg.remoteAddress}:${cfg.remotePort}`);
}

function applyOSC(msg) {
  const addr = msg.address;
  const v = msg.args.length ? argValue(msg.args[0]) : undefined;
  let m;

  if ((m = addr.match(/^\/ch(?:annel)?\/(\d+)\/(fader|pan|mute|solo|name)$/))) {
    const ch = state.channels[+m[1] - 1];
    if (!ch) return;
    switch (m[2]) {
      case 'fader': ch.fader = Math.max(0, Math.min(1, +v)); break;
      case 'pan':   ch.pan   = Math.max(-1, Math.min(1, +v)); break;
      case 'mute':  ch.mute  = !!+v; break;
      case 'solo':  ch.solo  = !!+v; break;
      case 'name':  ch.name  = String(v); break;
    }
  } else if ((m = addr.match(/^\/ch(?:annel)?\/(\d+)\/eq\/(high|mid|low)$/))) {
    const ch = state.channels[+m[1] - 1];
    if (ch) ch.eq[m[2]] = Math.max(-12, Math.min(12, +v));
  } else if (addr === '/master/volume') {
    state.master.volume = Math.max(0, Math.min(1, +v));
  } else if (addr === '/transport/play') {
    state.transport.playing = true;
  } else if (addr === '/transport/stop') {
    state.transport.playing = false;
    state.transport.recording = false;
  } else if (addr === '/transport/record') {
    state.transport.recording = !state.transport.recording;
  } else if (addr === '/transport/bpm') {
    state.transport.bpm = Math.max(20, Math.min(300, +v));
  }
}

function sendOSC(address, args = []) {
  if (!udpPort) return false;
  const typed = args.map(v => {
    if (typeof v === 'boolean') return { type: 'i', value: v ? 1 : 0 };
    const n = Number(v);
    if (!isNaN(n) && typeof v !== 'string') {
      return Number.isInteger(n) ? { type: 'i', value: n } : { type: 'f', value: n };
    }
    return { type: 's', value: String(v) };
  });
  try {
    udpPort.send({ address, args: typed });
    broadcast({
      type: 'osc_out',
      address,
      args: typed.map(a => a.value),
      to: `${oscCfg.remoteAddress}:${oscCfg.remotePort}`,
      ts: Date.now(),
    });
    return true;
  } catch (e) {
    console.error('sendOSC error:', e.message);
    return false;
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(json);
  }
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state }));
  ws.send(JSON.stringify({ type: 'config', config: oscCfg }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'set_config':
        openOSC({ ...oscCfg, ...msg.config });
        broadcast({ type: 'config', config: oscCfg });
        break;

      case 'control': {
        const ch = state.channels[msg.ch];
        if (!ch) break;
        if (msg.param === 'eq') {
          ch.eq[msg.band] = msg.value;
          sendOSC(`/channel/${msg.ch + 1}/eq/${msg.band}`, [msg.value]);
        } else {
          ch[msg.param] = msg.value;
          sendOSC(`/channel/${msg.ch + 1}/${msg.param}`, [msg.value]);
        }
        broadcast({ type: 'state', state });
        break;
      }

      case 'master':
        state.master.volume = msg.value;
        sendOSC('/master/volume', [msg.value]);
        broadcast({ type: 'state', state });
        break;

      case 'transport': {
        const { action, value } = msg;
        if (action === 'play') {
          state.transport.playing = true;
          sendOSC('/transport/play', [1]);
        } else if (action === 'stop') {
          state.transport.playing = false;
          state.transport.recording = false;
          sendOSC('/transport/stop', [1]);
        } else if (action === 'record') {
          state.transport.recording = !state.transport.recording;
          sendOSC('/transport/record', [state.transport.recording ? 1 : 0]);
        } else if (action === 'bpm') {
          state.transport.bpm = value;
          sendOSC('/transport/bpm', [value]);
        }
        broadcast({ type: 'state', state });
        break;
      }

      case 'send_osc':
        sendOSC(msg.address, msg.args || []);
        break;
    }
  });
});

// ── Level simulation ───────────────────────────────────────────────────────
let tick = 0;
let positionTimer = null;

setInterval(() => {
  tick++;
  const anySolo = state.channels.some(c => c.solo);

  let L = 0, R = 0;
  state.channels.forEach(ch => {
    const audible = !ch.mute && (!anySolo || ch.solo) && ch.fader > 0;
    if (audible) {
      // Organic-ish pseudo-signal using overlapping sines
      const sig =
        0.5 * Math.abs(Math.sin(tick * 0.07 + ch.id * 2.1)) +
        0.3 * Math.abs(Math.sin(tick * 0.13 + ch.id * 0.9)) +
        0.2 * Math.abs(Math.sin(tick * 0.23 + ch.id * 3.7));
      ch.level = ch.fader * sig;
      ch.clip  = ch.level > 0.95;
      const panL = Math.cos(((ch.pan + 1) / 2) * Math.PI * 0.5);
      const panR = Math.sin(((ch.pan + 1) / 2) * Math.PI * 0.5);
      L += ch.level * panL;
      R += ch.level * panR;
    } else {
      ch.level = Math.max(0, ch.level - 0.08); // natural decay
      ch.clip  = false;
    }
  });

  state.master.levelL = Math.min(1.05, (L / CH) * 2.6 * state.master.volume);
  state.master.levelR = Math.min(1.05, (R / CH) * 2.6 * state.master.volume);
  state.master.clipL  = state.master.levelL > 1.0;
  state.master.clipR  = state.master.levelR > 1.0;

  broadcast({
    type: 'levels',
    ch: state.channels.map(c => ({ level: c.level, clip: c.clip })),
    masterL: Math.min(1, state.master.levelL),
    masterR: Math.min(1, state.master.levelR),
    clipL: state.master.clipL,
    clipR: state.master.clipR,
  });
}, 40); // ~25 fps

// Transport position counter
setInterval(() => {
  if (state.transport.playing) {
    state.transport.position += state.transport.bpm / 60 / 4; // quarter notes @ 4 ticks/s
    broadcast({ type: 'position', position: state.transport.position });
  }
}, 250);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  OSC Simulator  →  http://localhost:${PORT}\n`);
  openOSC(oscCfg);
});

process.on('SIGINT', () => {
  if (udpPort) try { udpPort.close(); } catch (_) {}
  process.exit(0);
});
