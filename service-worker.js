const OFFSCREEN_PATH = "offscreen.html";
let creatingOffscreen;
let lastPersistAt = 0;

async function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return false;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play a locally selected music track while the popup is closed.",
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
  }

  await creatingOffscreen;
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "service-worker") return false;

  if (message.type === "playback-state") {
    const now = Date.now();
    const shouldPersist = !message.state?.isPlaying || now - lastPersistAt >= 1000;
    const persist = shouldPersist
      ? chrome.storage.local.set({ playbackState: message.state }).then(() => {
          lastPersistAt = now;
        })
      : Promise.resolve();

    Promise.all([
      persist,
      chrome.runtime
        .sendMessage({ target: "popup", type: "playback-state", state: message.state })
        .catch(() => {}),
    ])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  ensureOffscreenDocument()
    .then(async (wasCreated) => {
      if (wasCreated) {
        const saved = await chrome.storage.local.get("playbackState");
        if (saved.playbackState) {
          await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "hydrate-state",
            state: { ...saved.playbackState, isPlaying: false, error: null },
          });
        }
      }
      await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
