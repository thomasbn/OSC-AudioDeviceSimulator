# OSC Audio Device Simulator

A browser-based audio mixing console that speaks [Open Sound Control (OSC)](https://opensoundcontrol.stanford.edu/). Simulates a hardware audio device — receive and send OSC messages over UDP while controlling a full 8-channel mixer in your browser.

## Features

- **8-channel mixer** with faders, pan, EQ (high/mid/low), mute, and solo per channel
- **Master section** with stereo VU meters and master volume fader
- **Transport controls** — play, stop, record, BPM
- **Animated VU meters** with clip indicators
- **Bidirectional OSC** — controls send OSC out; incoming OSC updates the UI
- **OSC monitor** — live log of all in/out messages with timestamps
- **Manual OSC send** — send any address and args directly from the UI
- **Configurable routing** — set local listen port and remote host:port in the header

## Quick Start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## OSC Reference

Default ports: **listen `8000`**, **send to `127.0.0.1:57120`**. Both are configurable in the UI header.

### Channels

| Address | Args | Range |
|---|---|---|
| `/channel/N/fader` | `float` | `0.0` – `1.0` |
| `/channel/N/pan` | `float` | `-1.0` (L) – `1.0` (R) |
| `/channel/N/mute` | `int` | `0` or `1` |
| `/channel/N/solo` | `int` | `0` or `1` |
| `/channel/N/name` | `string` | channel label |
| `/channel/N/eq/high` | `float` | `-12.0` – `+12.0` dB |
| `/channel/N/eq/mid` | `float` | `-12.0` – `+12.0` dB |
| `/channel/N/eq/low` | `float` | `-12.0` – `+12.0` dB |

`N` = channel number `1`–`8`.

### Master

| Address | Args | Range |
|---|---|---|
| `/master/volume` | `float` | `0.0` – `1.0` |

### Transport

| Address | Args | Description |
|---|---|---|
| `/transport/play` | `int 1` | Start playback |
| `/transport/stop` | `int 1` | Stop playback and recording |
| `/transport/record` | `int` | Toggle recording |
| `/transport/bpm` | `float` | Set BPM (20–300) |

## Testing with oscsend

Send a test message from your terminal using `oscsend` (part of [liblo](http://liblo.sourceforge.net/)):

```bash
# Set channel 1 fader to 80%
oscsend localhost 8000 /channel/1/fader f 0.8

# Mute channel 3
oscsend localhost 8000 /channel/3/mute i 1

# Start transport
oscsend localhost 8000 /transport/play i 1

# Set BPM
oscsend localhost 8000 /transport/bpm f 140.0
```

Or use **TouchOSC**, **Max/MSP**, **Pure Data**, **SuperCollider**, or any other OSC-capable software pointed at port `57121`.

## Architecture

```
Browser (WebSocket)  ←→  Node.js server  ←→  OSC UDP
     UI controls              bridge           external tools
```

- **`server.js`** — Express HTTP server + WebSocket server + OSC UDP port. Bridges browser controls to OSC and vice versa. Runs a 25 fps level simulation for the VU meters.
- **`public/index.html`** — Single-file frontend. Canvas-based rotary knobs, CSS VU meters, vertical faders, WebSocket client.

## Configuration

| Setting | Default | Description |
|---|---|---|
| Local port | `8000` | UDP port the simulator listens on for incoming OSC |
| Remote address | `127.0.0.1` | IP to send outgoing OSC messages to |
| Remote port | `57120` | UDP port to send outgoing OSC messages to |
| HTTP port | `3000` | Web UI port (set via `PORT` env var) |

Change the HTTP port:

```bash
PORT=8080 npm start
```

## Dependencies

| Package | Purpose |
|---|---|
| [`osc`](https://github.com/colinbdclark/osc.js) | OSC encoding/decoding over UDP |
| [`ws`](https://github.com/websockets/ws) | WebSocket server |
| [`express`](https://expressjs.com) | Static file serving |
