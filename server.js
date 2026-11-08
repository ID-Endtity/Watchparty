import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --- Static file server ---
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR + '/')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// --- Signaling ---
const wss = new WebSocketServer({ server });

// rooms: roomCode -> { clients: Map<id, ws>, streamerId: string | null }
const rooms = new Map();

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

// 32 unambiguous characters (no I, O, 0, 1). 8 chars ≈ 40 bits of entropy.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function clientsIn(roomCode) {
  return rooms.get(roomCode)?.clients;
}

function broadcast(roomCode, message, exceptId = null) {
  const clients = clientsIn(roomCode);
  if (!clients) return;
  for (const [id, client] of clients) {
    if (id !== exceptId) send(client, message);
  }
}

// Put a socket into a room (creating the room if needed) and announce it.
function addClientToRoom(ws, roomCode) {
  if (!rooms.has(roomCode)) rooms.set(roomCode, { clients: new Map(), streamerId: null });
  const room = rooms.get(roomCode);
  ws.roomCode = roomCode;
  room.clients.set(ws.id, ws);
  send(ws, {
    type: 'joined',
    room: roomCode,
    selfId: ws.id,
    peers: [...room.clients.keys()].filter((id) => id !== ws.id),
    streamerId: room.streamerId,
  });
  broadcast(roomCode, { type: 'peer-joined', peerId: ws.id }, ws.id);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'join': {
      const roomCode = normalizeCode(msg.room);
      if (!roomCode) return send(ws, { type: 'error', message: 'Room code required' });
      if (!rooms.has(roomCode)) return send(ws, { type: 'error', message: 'Room not found' });
      addClientToRoom(ws, roomCode);
      break;
    }

    case 'create-room': {
      let roomCode;
      do {
        roomCode = generateCode();
      } while (rooms.has(roomCode));
      addClientToRoom(ws, roomCode);
      break;
    }

    case 'stream-started': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (room.streamerId) return send(ws, { type: 'error', message: 'Someone is already streaming' });
      room.streamerId = ws.id;
      broadcast(ws.roomCode, { type: 'stream-started', streamerId: ws.id });
      break;
    }

    case 'stream-stopped': {
      const room = rooms.get(ws.roomCode);
      if (room && room.streamerId === ws.id) {
        room.streamerId = null;
        broadcast(ws.roomCode, { type: 'stream-stopped' });
      }
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      const clients = clientsIn(ws.roomCode);
      const target = clients?.get(msg.targetId);
      if (!target) return send(ws, { type: 'error', message: 'Peer not found' });
      const relay = { type: msg.type, fromId: ws.id };
      if (msg.type === 'ice-candidate') relay.candidate = msg.candidate;
      else relay.sdp = msg.sdp;
      send(target, relay);
      break;
    }

    default:
      send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

wss.on('connection', (ws) => {
  ws.id = randomUUID();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: 'Invalid JSON' });
    }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.clients.delete(ws.id);
    if (room.streamerId === ws.id) {
      room.streamerId = null;
      broadcast(ws.roomCode, { type: 'stream-stopped' });
    }
    broadcast(ws.roomCode, { type: 'peer-left', peerId: ws.id });
    if (room.clients.size === 0) rooms.delete(ws.roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Watchparty running at http://localhost:${PORT}`);
});
