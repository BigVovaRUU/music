import { getTrack } from "./db.js";

const CROSSFADE_SECONDS = 5;

let audioContext;
let masterGainNode;
let sourceNode;
let sourceGainNode;
let audioBuffer;
let startedAt = 0;
let pausedAt = 0;
let queueTrackIds = [];
let transitionTimer;
let transitionFinalizeTimer;
let transitionSourceNode;
let transitionGainNode;
let transitionTrackId;
let transitionBuffer;
let transitionStartedAt = 0;
let playbackGeneration = 0;

const bufferCache = new Map();

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
  return Math.min(Math.max(0, audioContext.currentTime - startedAt), state.duration);
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
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = state.volume;
    masterGainNode.connect(audioContext.destination);
  }
}

function stopNode(node) {
  if (!node) return;
  node.onended = null;
  try {
    node.stop();
  } catch (_error) {
    // AudioBufferSourceNode can only be stopped once.
  }
  node.disconnect();
}

function clearTransitionTimers() {
  clearTimeout(transitionTimer);
  clearTimeout(transitionFinalizeTimer);
  transitionTimer = undefined;
  transitionFinalizeTimer = undefined;
}

function stopAllSources() {
  playbackGeneration += 1;
  clearTransitionTimers();
  stopNode(sourceNode);
  stopNode(transitionSourceNode);
  sourceNode = null;
  sourceGainNode = null;
  transitionSourceNode = null;
  transitionGainNode = null;
  transitionTrackId = null;
  transitionBuffer = null;
}

async function getTrackBuffer(trackId) {
  if (bufferCache.has(trackId)) return bufferCache.get(trackId);

  const track = await getTrack(trackId);
  if (!track) throw new Error("Трек не найден. Добавьте его снова.");

  ensureAudioGraph();
  const decoded = await audioContext.decodeAudioData(await track.blob.arrayBuffer());
  bufferCache.set(trackId, decoded);
  return decoded;
}

function getNextTrackId() {
  if (!state.currentTrackId) return null;
  const availableQueue = queueTrackIds.length ? queueTrackIds : [state.currentTrackId];
  const currentIndex = availableQueue.indexOf(state.currentTrackId);
  if (currentIndex < 0) return availableQueue[0] || state.currentTrackId;
  return availableQueue[(currentIndex + 1) % availableQueue.length];
}

function createSource(buffer, initialGain = 1) {
  const node = audioContext.createBufferSource();
  const nodeGain = audioContext.createGain();
  node.buffer = buffer;
  node.loop = false;
  nodeGain.gain.value = initialGain;
  node.connect(nodeGain);
  nodeGain.connect(masterGainNode);
  return { node, nodeGain };
}

function attachEndHandler(node, generation) {
  node.onended = () => {
    if (generation !== playbackGeneration || !state.isPlaying || transitionSourceNode) return;
    if (!state.loopEnabled) {
      finishPlayback();
      return;
    }

    const nextTrackId = getNextTrackId();
    if (!nextTrackId) return;
    startPlayback(nextTrackId, 0, queueTrackIds).catch(async (error) => {
      state.isPlaying = false;
      state.error = error.message || "Не удалось продолжить воспроизведение.";
      stopAllSources();
      await emitState();
    });
  };
}

async function scheduleTransition(generation = playbackGeneration) {
  if (transitionSourceNode) return;
  clearTransitionTimers();
  if (!state.isPlaying || !state.loopEnabled || !sourceNode) return;

  const nextTrackId = getNextTrackId();
  if (!nextTrackId) return;

  const nextBuffer = await getTrackBuffer(nextTrackId);
  if (generation !== playbackGeneration || !state.isPlaying) return;

  const remaining = Math.max(0, state.duration - getCurrentTime());
  const fadeDuration = Math.min(
    CROSSFADE_SECONDS,
    state.duration / 2,
    nextBuffer.duration / 2,
    remaining,
  );

  if (fadeDuration <= 0.05) return;
  const delay = Math.max(0, remaining - fadeDuration);
  transitionTimer = setTimeout(
    () => beginTransition(nextTrackId, nextBuffer, fadeDuration, generation),
    delay * 1000,
  );
}

function beginTransition(nextTrackId, nextBuffer, fadeDuration, generation) {
  if (generation !== playbackGeneration || !state.isPlaying || !sourceNode || transitionSourceNode) return;

  const now = audioContext.currentTime;
  const incoming = createSource(nextBuffer, 0);
  transitionSourceNode = incoming.node;
  transitionGainNode = incoming.nodeGain;
  transitionTrackId = nextTrackId;
  transitionBuffer = nextBuffer;
  transitionStartedAt = now;

  sourceGainNode.gain.cancelScheduledValues(now);
  sourceGainNode.gain.setValueAtTime(sourceGainNode.gain.value, now);
  sourceGainNode.gain.linearRampToValueAtTime(0, now + fadeDuration);
  transitionGainNode.gain.setValueAtTime(0, now);
  transitionGainNode.gain.linearRampToValueAtTime(1, now + fadeDuration);
  transitionSourceNode.start(now);

  transitionFinalizeTimer = setTimeout(
    () => finalizeTransition(fadeDuration, generation),
    fadeDuration * 1000,
  );
}

async function finalizeTransition(fadeDuration, generation) {
  if (generation !== playbackGeneration || !transitionSourceNode || !transitionBuffer) return;

  stopNode(sourceNode);
  sourceNode = transitionSourceNode;
  sourceGainNode = transitionGainNode;
  audioBuffer = transitionBuffer;
  state.currentTrackId = transitionTrackId;
  state.duration = audioBuffer.duration;
  startedAt = transitionStartedAt;
  pausedAt = Math.min(fadeDuration, state.duration);

  transitionSourceNode = null;
  transitionGainNode = null;
  transitionTrackId = null;
  transitionBuffer = null;
  transitionFinalizeTimer = undefined;

  attachEndHandler(sourceNode, generation);
  await emitState();
  await scheduleTransition(generation);
}

async function finishPlayback() {
  state.isPlaying = false;
  pausedAt = 0;
  stopAllSources();
  await emitState();
}

async function startPlayback(trackId, offset = pausedAt, trackIds) {
  if (Array.isArray(trackIds) && trackIds.length) queueTrackIds = [...new Set(trackIds)];
  stopAllSources();
  const generation = playbackGeneration;
  ensureAudioGraph();
  await audioContext.resume();

  audioBuffer = await getTrackBuffer(trackId);
  if (generation !== playbackGeneration) return;

  state.currentTrackId = trackId;
  state.duration = audioBuffer.duration;
  const safeOffset = Math.min(Math.max(0, Number(offset) || 0), Math.max(0, state.duration - 0.01));
  const current = createSource(audioBuffer, 1);
  sourceNode = current.node;
  sourceGainNode = current.nodeGain;
  attachEndHandler(sourceNode, generation);
  sourceNode.start(0, safeOffset);
  startedAt = audioContext.currentTime - safeOffset;
  pausedAt = safeOffset;
  state.isPlaying = true;
  state.error = null;
  await emitState();
  await scheduleTransition(generation);
}

async function pausePlayback() {
  if (transitionSourceNode && transitionBuffer) {
    pausedAt = Math.max(0, audioContext.currentTime - transitionStartedAt);
    state.currentTrackId = transitionTrackId;
    state.duration = transitionBuffer.duration;
    audioBuffer = transitionBuffer;
  } else {
    pausedAt = getCurrentTime();
  }

  state.isPlaying = false;
  stopAllSources();
  await emitState();
}

async function handleMessage(message) {
  switch (message.type) {
    case "play-track":
      await startPlayback(message.trackId, 0, message.trackIds);
      break;
    case "resume":
      if (state.currentTrackId) await startPlayback(state.currentTrackId, pausedAt, message.trackIds);
      break;
    case "pause":
      await pausePlayback();
      break;
    case "seek": {
      pausedAt = Math.max(0, Math.min(Number(message.time) || 0, state.duration || 0));
      if (state.isPlaying && state.currentTrackId) {
        await startPlayback(state.currentTrackId, pausedAt, message.trackIds);
      } else {
        await emitState();
      }
      break;
    }
    case "set-volume":
      state.volume = Math.max(0, Math.min(Number(message.volume) || 0, 1));
      ensureAudioGraph();
      masterGainNode.gain.setTargetAtTime(state.volume, audioContext.currentTime, 0.025);
      await emitState();
      break;
    case "set-loop":
      state.loopEnabled = Boolean(message.enabled);
      if (!state.loopEnabled && transitionSourceNode) {
        clearTransitionTimers();
        stopNode(transitionSourceNode);
        transitionSourceNode = null;
        transitionGainNode = null;
        transitionTrackId = null;
        transitionBuffer = null;
        const now = audioContext.currentTime;
        sourceGainNode.gain.cancelScheduledValues(now);
        sourceGainNode.gain.setValueAtTime(1, now);
      } else if (state.isPlaying) {
        await scheduleTransition(playbackGeneration);
      }
      await emitState();
      break;
    case "set-queue":
      queueTrackIds = Array.isArray(message.trackIds) ? [...new Set(message.trackIds)] : [];
      if (state.isPlaying) await scheduleTransition(playbackGeneration);
      break;
    case "stop":
      state.isPlaying = false;
      state.currentTrackId = null;
      state.duration = 0;
      pausedAt = 0;
      audioBuffer = null;
      stopAllSources();
      await emitState();
      break;
    case "get-state":
      await emitState();
      break;
    case "hydrate-state":
      Object.assign(state, message.state, { isPlaying: false, error: null });
      pausedAt = Number(state.currentTime) || 0;
      if (masterGainNode) masterGainNode.gain.value = state.volume;
      break;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen") return;
  handleMessage(message).catch(async (error) => {
    state.isPlaying = false;
    state.error = error.message || "Не удалось воспроизвести трек.";
    stopAllSources();
    await emitState();
  });
});

setInterval(() => {
  if (state.isPlaying) emitState();
}, 500);
