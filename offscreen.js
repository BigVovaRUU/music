import { getTrack } from "./db.js";

let audioContext;
let gainNode;
let sourceNode;
let audioBuffer;
let startedAt = 0;
let pausedAt = 0;
let loadingTrackId = null;

const state = {
  currentTrackId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 0.72,
  loopEnabled: true,
  error: null,
};

function getCurrentTime() {
  if (!state.isPlaying || !audioContext || !state.duration) return pausedAt;
  const elapsed = Math.max(0, audioContext.currentTime - startedAt);
  return state.loopEnabled ? elapsed % state.duration : Math.min(elapsed, state.duration);
}

async function emitState() {
  state.currentTime = getCurrentTime();
  await chrome.runtime
    .sendMessage({ target: "service-worker", type: "playback-state", state: { ...state } })
    .catch(() => {});
}

function ensureAudioGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
    gainNode = audioContext.createGain();
    gainNode.gain.value = state.volume;
    gainNode.connect(audioContext.destination);
  }
}

function stopSource() {
  if (!sourceNode) return;
  sourceNode.onended = null;
  try {
    sourceNode.stop();
  } catch (_error) {
    // A stopped AudioBufferSourceNode cannot be stopped twice.
  }
  sourceNode.disconnect();
  sourceNode = null;
}

async function loadTrack(trackId) {
  if (state.currentTrackId === trackId && audioBuffer) return;
  if (loadingTrackId === trackId) return;

  loadingTrackId = trackId;
  const isSameTrack = state.currentTrackId === trackId;
  const track = await getTrack(trackId);
  if (!track) throw new Error("Трек не найден. Добавьте его снова.");

  ensureAudioGraph();
  const arrayBuffer = await track.blob.arrayBuffer();
  audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  state.currentTrackId = trackId;
  state.duration = audioBuffer.duration;
  pausedAt = isSameTrack ? Math.min(pausedAt, state.duration) : 0;
  loadingTrackId = null;
}

async function startPlayback(trackId, offset = pausedAt) {
  stopSource();
  await loadTrack(trackId);
  ensureAudioGraph();
  await audioContext.resume();

  const safeOffset = state.duration ? Math.max(0, offset) % state.duration : 0;
  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.loop = state.loopEnabled;
  sourceNode.connect(gainNode);
  sourceNode.onended = () => {
    if (!state.loopEnabled && state.isPlaying) {
      state.isPlaying = false;
      pausedAt = 0;
      emitState();
    }
  };
  sourceNode.start(0, safeOffset);
  startedAt = audioContext.currentTime - safeOffset;
  pausedAt = safeOffset;
  state.isPlaying = true;
  state.error = null;
  await emitState();
}

async function pausePlayback() {
  pausedAt = getCurrentTime();
  state.isPlaying = false;
  stopSource();
  await emitState();
}

async function handleMessage(message) {
  switch (message.type) {
    case "play-track":
      await startPlayback(message.trackId, 0);
      break;
    case "resume":
      if (state.currentTrackId) await startPlayback(state.currentTrackId, pausedAt);
      break;
    case "pause":
      await pausePlayback();
      break;
    case "seek": {
      pausedAt = Math.max(0, Math.min(Number(message.time) || 0, state.duration || 0));
      if (state.isPlaying && state.currentTrackId) {
        await startPlayback(state.currentTrackId, pausedAt);
      } else {
        await emitState();
      }
      break;
    }
    case "set-volume":
      state.volume = Math.max(0, Math.min(Number(message.volume) || 0, 1));
      ensureAudioGraph();
      gainNode.gain.setTargetAtTime(state.volume, audioContext.currentTime, 0.025);
      await emitState();
      break;
    case "set-loop":
      state.loopEnabled = Boolean(message.enabled);
      if (sourceNode) sourceNode.loop = state.loopEnabled;
      await emitState();
      break;
    case "stop":
      state.isPlaying = false;
      state.currentTrackId = null;
      state.duration = 0;
      pausedAt = 0;
      audioBuffer = null;
      stopSource();
      await emitState();
      break;
    case "get-state":
      await emitState();
      break;
    case "hydrate-state":
      Object.assign(state, message.state, { isPlaying: false, error: null });
      pausedAt = Number(state.currentTime) || 0;
      if (gainNode) gainNode.gain.value = state.volume;
      break;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen") return;
  handleMessage(message).catch(async (error) => {
    loadingTrackId = null;
    state.isPlaying = false;
    state.error = error.message || "Не удалось воспроизвести трек.";
    await emitState();
  });
});

setInterval(() => {
  if (state.isPlaying) emitState();
}, 500);
