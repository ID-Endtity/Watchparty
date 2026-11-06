// Watchparty client — WebSocket signaling + room UI.
//
// The WebRTC media pipeline (screen capture + peer connections) is the next
// milestone. Signaling and room state are fully wired; the media functions are
// stubbed with TODO(next) markers plus a written flow so the next step is obvious.

const el = (id) => document.getElementById(id);

// --- DOM ---
const joinScreen = el('join-screen');
const roomScreen = el('room-screen');
const roomCodeInput = el('room-code');
const joinBtn = el('join-btn');
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
// peerId -> RTCPeerConnection (filled in the WebRTC milestone)
const peers = new Map();

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
  const code = roomCodeInput.value.trim();
  if (!code) return;
  send({ type: 'join', room: code });
  joinScreen.classList.add('hidden');
  roomScreen.classList.remove('hidden');
  roomLabel.textContent = code.toUpperCase();
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
      msg.peers.forEach((id) => peers.set(id, null));
      setStreamerState(msg.streamerId === selfId, msg.streamerId);
      renderPeers();
      break;

    case 'peer-joined':
      peers.set(msg.peerId, null);
      renderPeers();
      // TODO(next): if isStreamer, create a connection + offer for this new viewer.
      break;

    case 'peer-left':
      closePeer(msg.peerId);
      renderPeers();
      break;

    case 'stream-started':
      setStreamerState(msg.streamerId === selfId, msg.streamerId);
      if (!isStreamer) setupViewer(msg.streamerId);
      else startOffersToAllPeers();
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
      setStatus(msg.message, false);
      break;
  }
}

// --- Streaming: WebRTC media (next milestone) ---
//
// Planned flow:
//   Streamer: getDisplayMedia() -> localStream -> send 'stream-started' ->
//     for each viewer, new RTCPeerConnection -> addTracks -> createOffer ->
//     setLocalDescription -> send { type:'offer', targetId, sdp }.
//   Viewer:  on 'offer', new RTCPeerConnection -> add 'recvonly' transceiver ->
//     setRemoteDescription(offer) -> createAnswer -> setLocalDescription ->
//     send { type:'answer', targetId, sdp }. Video arrives via pc.ontrack.
//   Both:    on 'icecandidate', send { type:'ice-candidate', targetId, candidate };
//     on receiving one, pc.addIceCandidate(candidate).

async function startStreaming() {
  // TODO(next):
  //   localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  //   localPreview.srcObject = localStream;
  //   streamArea.classList.remove('hidden');
  //   send({ type: 'stream-started' });
  console.warn('startStreaming() not implemented — next milestone.');
}

function startOffersToAllPeers() {
  // TODO(next): for each peer id (except self), create a connection and send an offer.
}

function stopStreaming() {
  // TODO(next):
  //   send({ type: 'stream-stopped' });
  //   localStream.getTracks().forEach((t) => t.stop());
  //   tearDownStream();
  console.warn('stopStreaming() not implemented — next milestone.');
}

function setupViewer(streamerId) {
  // TODO(next): create a connection to streamerId; the offer arrives via handleOffer.
  console.warn('setupViewer() not implemented — next milestone.');
}

function handleOffer(msg) {
  // TODO(next): viewer side — see flow above.
  console.warn('handleOffer() not implemented — next milestone.');
}

function handleAnswer(msg) {
  // TODO(next): streamer side — pc.setRemoteDescription(msg.sdp).
  console.warn('handleAnswer() not implemented — next milestone.');
}

function handleIceCandidate(msg) {
  // TODO(next): pc.addIceCandidate(msg.candidate).
  console.warn('handleIceCandidate() not implemented — next milestone.');
}

function closePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();
  peers.delete(peerId);
}

function tearDownStream() {
  streamArea.classList.add('hidden');
  remoteVideo.srcObject = null;
  localPreview.srcObject = null;
  localStream = null;
}

// --- Wire up ---
joinBtn.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
shareBtn.addEventListener('click', startStreaming);
stopBtn.addEventListener('click', stopStreaming);

connect();
