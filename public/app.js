// Watchparty client — WebSocket signaling + WebRTC media.
//
// The streamer captures the screen with getDisplayMedia and sends an offer to
// each viewer (mesh); viewers auto-answer and display the stream. The server
// only relays the handshake — video travels peer-to-peer.

const el = (id) => document.getElementById(id);

// --- DOM ---
const joinScreen = el('join-screen');
const roomScreen = el('room-screen');
const roomCodeInput = el('room-code');
const joinBtn = el('join-btn');
const createBtn = el('create-btn');
const copyBtn = el('copy-btn');
const joinError = el('join-error');
const roomLabel = el('room-label');
const streamStatus = el('stream-status');
const shareBtn = el('share-btn');
const stopBtn = el('stop-btn');
const streamArea = el('stream-area');
const remoteVideo = el('remote-video');
const localPreview = el('local-preview');
const peersEl = el('peers');

// --- State ---
let socket = null;
let selfId = null;
let isStreamer = false;
let localStream = null;
// peerId -> RTCPeerConnection (null until a connection is opened to that peer)
const peers = new Map();

// STUN helps peers discover their public address so direct connections work
// across the internet (behind NATs). The local "host" candidate already works
// on localhost, so this only matters once you leave your machine. It's Google's
// public STUN server — swap it for your own if you prefer.
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

// --- WebSocket ---
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}`);

  socket.onmessage = (event) => handleMessage(JSON.parse(event.data));
  socket.onclose = () => setStatus('Disconnected — reload to reconnect', false);
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// --- Room flow ---
function joinRoom() {
  joinError.textContent = '';
  const code = roomCodeInput.value.trim();
  if (!code) {
    joinError.textContent = 'Enter a room code';
    return;
  }
  send({ type: 'join', room: code });
}

function createRoom() {
  joinError.textContent = '';
  send({ type: 'create-room' });
}

function copyCode() {
  const code = roomLabel.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code)
    .then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    })
    .catch(() => {});
}

function renderPeers() {
  peersEl.innerHTML = '';
  for (const id of peers.keys()) {
    const li = document.createElement('li');
    li.textContent = id === selfId ? 'You' : shortId(id);
    if (id === selfId) li.classList.add('you');
    peersEl.appendChild(li);
  }
}

function shortId(id) {
  return id.slice(0, 8);
}

function setStatus(text, live) {
  streamStatus.textContent = text;
  streamStatus.classList.toggle('live', !!live);
}

function setStreamerState(streaming, streamerId) {
  isStreamer = streaming;
  shareBtn.classList.toggle('hidden', streaming);
  stopBtn.classList.toggle('hidden', !streaming);
  const text = streaming
    ? (streamerId === selfId ? 'You are streaming' : 'Live')
    : 'No stream yet';
  setStatus(text, streaming);
}

// --- Server message handling ---
function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      selfId = msg.selfId;
      roomLabel.textContent = msg.room;
      joinScreen.classList.add('hidden');
      roomScreen.classList.remove('hidden');
      msg.peers.forEach((id) => peers.set(id, null));
      setStreamerState(msg.streamerId === selfId, msg.streamerId);
      renderPeers();
      break;

    case 'peer-joined':
      peers.set(msg.peerId, null);
      renderPeers();
      // A viewer joined after we started streaming — send them an offer too.
      if (isStreamer) offerTo(msg.peerId).catch((err) => console.error('offer failed:', err));
      break;

    case 'peer-left':
      closePeer(msg.peerId);
      renderPeers();
      break;

    case 'stream-started':
      setStreamerState(msg.streamerId === selfId, msg.streamerId);
      // Only the confirmed streamer initiates; viewers wait for the offer.
      if (isStreamer) startOffersToAllPeers();
      break;

    case 'stream-stopped':
      setStreamerState(false, null);
      tearDownStream();
      break;

    case 'offer':
      handleOffer(msg);
      break;

    case 'answer':
      handleAnswer(msg);
      break;

    case 'ice-candidate':
      handleIceCandidate(msg);
      break;

    case 'error':
      console.error('Server error:', msg.message);
      if (selfId) {
        setStatus(msg.message, false);
      } else {
        joinError.textContent = msg.message;
      }
      // If we captured a screen but were never confirmed as streamer (e.g. a
      // race where someone else was already streaming), release the capture.
      if (localStream && !isStreamer) {
        localStream.getTracks().forEach((t) => t.stop());
        tearDownStream();
      }
      break;
  }
}

// --- WebRTC helpers ---

// Create a connection to one peer and wire up the ICE-candidate relay.
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.pendingCandidates = [];

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      send({ type: 'ice-candidate', targetId: peerId, candidate: event.candidate });
    }
  };

  peers.set(peerId, pc);
  return pc;
}

// Apply any ICE candidates that arrived before the remote description was set
// (a narrow race: candidates can trickle in faster than setRemoteDescription).
async function flushPendingCandidates(pc) {
  const pending = pc.pendingCandidates;
  pc.pendingCandidates = [];
  for (const candidate of pending) {
    await pc.addIceCandidate(candidate);
  }
}

// Streamer side: open a connection to one viewer and send them an offer.
async function offerTo(peerId) {
  if (!localStream) return;

  const pc = createPeerConnection(peerId);
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'offer', targetId: peerId, sdp: offer });
}

// --- Streaming controls ---

async function startStreaming() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    // User cancelled the share dialog or denied permission.
    console.error('Screen capture failed:', err);
    setStatus('Screen capture cancelled', false);
    return;
  }

  localPreview.srcObject = localStream;
  streamArea.classList.remove('hidden');
  send({ type: 'stream-started' });
}

function startOffersToAllPeers() {
  for (const peerId of peers.keys()) {
    offerTo(peerId).catch((err) => console.error('offer failed:', err));
  }
}

function stopStreaming() {
  send({ type: 'stream-stopped' });
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  // The server broadcasts 'stream-stopped' back to us too, which resets the UI.
}

// --- Viewer side ---

async function handleOffer(msg) {
  const pc = createPeerConnection(msg.fromId);

  // Viewer is receive-only: declare that we want to receive video + audio.
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    streamArea.classList.remove('hidden');
  };

  await pc.setRemoteDescription(msg.sdp);
  await flushPendingCandidates(pc);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: 'answer', targetId: msg.fromId, sdp: answer });
}

// --- Shared (both sides) ---

async function handleAnswer(msg) {
  const pc = peers.get(msg.fromId);
  if (!pc) return;
  await pc.setRemoteDescription(msg.sdp);
  await flushPendingCandidates(pc);
}

async function handleIceCandidate(msg) {
  const pc = peers.get(msg.fromId);
  if (!pc) return;
  if (!pc.remoteDescription) {
    // Offer/answer not applied yet — buffer it, flush later.
    pc.pendingCandidates.push(msg.candidate);
    return;
  }
  await pc.addIceCandidate(msg.candidate);
}

function closePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();
  peers.delete(peerId);
}

function closeAllConnections() {
  for (const [id, pc] of peers) {
    if (pc) pc.close();
    peers.set(id, null);
  }
}

function tearDownStream() {
  streamArea.classList.add('hidden');
  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  localStream = null;
  closeAllConnections();
}

// --- Wire up ---
createBtn.addEventListener('click', createRoom);
joinBtn.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
copyBtn.addEventListener('click', copyCode);
shareBtn.addEventListener('click', startStreaming);
stopBtn.addEventListener('click', stopStreaming);

connect();
