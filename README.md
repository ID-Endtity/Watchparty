# Watchparty

Private, low-latency screen sharing in the browser — share your screen in a code-protected room and let a few friends watch live. WebRTC for video, WebSocket for signaling.

## How it works

- The streamer shares their screen straight from the browser (`getDisplayMedia`).
- Video travels peer-to-peer over WebRTC (mesh) — the server only relays the handshake.
- Viewers join a private room with a code. No accounts, no installs.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in two or more tabs, join the same room code, and share.

## Status

- ✅ Signaling server (rooms, relay, static serving)
- ✅ Room join + live peer list
- ⬜ WebRTC media pipeline (screen capture + peer connections) — next milestone
