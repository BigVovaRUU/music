import { deleteTrack, getTracks, saveTrack } from "./db.js";

const elements = {
  addButton: document.querySelector("#addButton"),
  currentFile: document.querySelector("#currentFile"),
  currentTime: document.querySelector("#currentTime"),
  currentTitle: document.querySelector("#currentTitle"),
  duration: document.querySelector("#duration"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  emptyState: document.querySelector("#emptyState"),
  fileInput: document.querySelector("#fileInput"),
  loopButton: document.querySelector("#loopButton"),
  loopTopButton: document.querySelector("#loopTopButton"),
  nextButton: document.querySelector("#nextButton"),
  playButton: document.querySelector("#playButton"),
  previousButton: document.querySelector("#previousButton"),
  progress: document.querySelector("#progress"),
  toast: document.querySelector("#toast"),
  trackList: document.querySelector("#trackList"),
  volume: document.querySelector("#volume"),
};

let tracks = [];
let playback = {
  currentTrackId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 0.72,
  loopEnabled: true,
  error: null,
};
let toastTimer;
let lastError;

function titleFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const value = Number(input.value) || 0;
  const percentage = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${percentage}%`);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function sendAudio(type, payload = {}) {
  return chrome.runtime
    .sendMessage({ target: "service-worker", type, ...payload })
    .then((result) => {
      if (!result?.ok) throw new Error(result?.error || "Фоновый проигрыватель недоступен.");
    })
    .catch((error) => showToast(error.message));
}

function getCurrentTrack() {
  return tracks.find((track) => track.id === playback.currentTrackId) || tracks[0] || null;
}

function getTrackQueue() {
  return tracks.map((track) => track.id);
}

function renderPlayer() {
  const track = getCurrentTrack();
  const hasTracks = tracks.length > 0;
  const isPlaying = Boolean(playback.isPlaying && track && track.id === playback.currentTrackId);

  elements.currentTitle.textContent = track?.title || "Добавьте музыку";
  elements.currentFile.textContent = track?.fileName || "Поддерживаются аудиофайлы";
  elements.currentTime.textContent = formatTime(playback.currentTime);
  elements.duration.textContent = formatTime(playback.duration);
  elements.progress.max = String(playback.duration || 100);
  elements.progress.value = String(playback.currentTime || 0);
  elements.progress.disabled = !playback.duration;
  elements.playButton.disabled = !hasTracks;
  elements.previousButton.disabled = tracks.length < 2;
  elements.nextButton.disabled = tracks.length < 2;
  elements.playButton.classList.toggle("is-playing", isPlaying);
  elements.playButton.setAttribute("aria-label", isPlaying ? "Пауза" : "Воспроизвести");
  elements.volume.value = String(playback.volume);

  for (const button of [elements.loopButton, elements.loopTopButton]) {
    button.setAttribute("aria-pressed", String(playback.loopEnabled));
  }
  elements.loopButton.querySelector("span").textContent = playback.loopEnabled
    ? "Повтор включён"
    : "Повтор выключен";

  setRangeFill(elements.progress);
  setRangeFill(elements.volume);
}

function trackRowTemplate(track) {
  const row = document.createElement("div");
  row.className = "track-row";
  row.dataset.id = track.id;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Воспроизвести ${track.title}`);
  row.classList.toggle("is-current", track.id === playback.currentTrackId);

  row.innerHTML = `
    <img class="track-thumbnail" src="assets/night-cover-512.png" alt="" />
    <span class="track-meta">
      <span class="track-title"></span>
      <span class="track-filename"></span>
    </span>
    <button class="remove-button" type="button" aria-label="Удалить трек">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
    </button>
  `;
  row.querySelector(".track-title").textContent = track.title;
  row.querySelector(".track-filename").textContent = track.fileName;

  const playTrack = () => sendAudio("play-track", { trackId: track.id, trackIds: getTrackQueue() });
  row.addEventListener("click", (event) => {
    if (!event.target.closest(".remove-button")) playTrack();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      playTrack();
    }
  });
  row.querySelector(".remove-button").addEventListener("click", async () => {
    if (track.id === playback.currentTrackId) await sendAudio("stop");
    await deleteTrack(track.id);
    tracks = tracks.filter((item) => item.id !== track.id);
    await sendAudio("set-queue", { trackIds: getTrackQueue() });
    render();
    showToast("Трек удалён");
  });
  return row;
}

function renderLibrary() {
  elements.trackList.replaceChildren(...tracks.map(trackRowTemplate));
  elements.emptyState.hidden = tracks.length > 0;
}

function syncLibraryState() {
  for (const row of elements.trackList.querySelectorAll(".track-row")) {
    row.classList.toggle("is-current", row.dataset.id === playback.currentTrackId);
  }
}

function render() {
  renderPlayer();
  renderLibrary();
}

async function importFiles(files) {
  const audioFiles = [...files].filter((file) => file.type.startsWith("audio/"));
  if (!audioFiles.length) {
    showToast("Выберите аудиофайл");
    return;
  }

  for (const file of audioFiles) {
    const track = {
      id: crypto.randomUUID(),
      title: titleFromFilename(file.name),
      fileName: file.name,
      type: file.type,
      size: file.size,
      addedAt: Date.now(),
      blob: file,
    };
    await saveTrack(track);
  }

  tracks = await getTracks();
  await sendAudio("set-queue", { trackIds: getTrackQueue() });
  render();
  showToast(audioFiles.length === 1 ? "Трек добавлен" : `Добавлено треков: ${audioFiles.length}`);
}

function stepTrack(direction) {
  if (!tracks.length) return;
  const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === playback.currentTrackId));
  const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
  sendAudio("play-track", { trackId: tracks[nextIndex].id, trackIds: getTrackQueue() });
}

function togglePlayback() {
  if (!tracks.length) return;
  if (playback.isPlaying) {
    sendAudio("pause");
  } else if (playback.currentTrackId) {
    sendAudio("resume", { trackIds: getTrackQueue() });
  } else {
    sendAudio("play-track", { trackId: tracks[0].id, trackIds: getTrackQueue() });
  }
}

function toggleLoop() {
  sendAudio("set-loop", { enabled: !playback.loopEnabled });
}

elements.addButton.addEventListener("click", () => elements.fileInput.click());
elements.emptyAddButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", async () => {
  await importFiles(elements.fileInput.files);
  elements.fileInput.value = "";
});
elements.playButton.addEventListener("click", togglePlayback);
elements.previousButton.addEventListener("click", () => stepTrack(-1));
elements.nextButton.addEventListener("click", () => stepTrack(1));
elements.loopButton.addEventListener("click", toggleLoop);
elements.loopTopButton.addEventListener("click", toggleLoop);
elements.progress.addEventListener("input", () => setRangeFill(elements.progress));
elements.progress.addEventListener("change", () =>
  sendAudio("seek", { time: Number(elements.progress.value), trackIds: getTrackQueue() }),
);
elements.volume.addEventListener("input", () => {
  setRangeFill(elements.volume);
  sendAudio("set-volume", { volume: Number(elements.volume.value) });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "popup" || message.type !== "playback-state") return;
  playback = { ...playback, ...message.state };
  if (playback.error && playback.error !== lastError) showToast(playback.error);
  lastError = playback.error;
  renderPlayer();
  syncLibraryState();
});

async function initialize() {
  const [saved, loadedTracks] = await Promise.all([
    chrome.storage.local.get("playbackState"),
    getTracks(),
  ]);
  tracks = loadedTracks;
  playback = { ...playback, ...saved.playbackState };
  render();
  await sendAudio("set-queue", { trackIds: getTrackQueue() });
  await sendAudio("get-state");
}

initialize().catch((error) => showToast(error.message));
