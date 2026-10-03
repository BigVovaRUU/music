const DB_NAME = "quiet-frame-audio";
const DB_VERSION = 1;
const STORE_NAME = "tracks";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, operation) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = operation(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function getTracks() {
  return runTransaction("readonly", (store) => store.getAll()).then((tracks) =>
    tracks.sort((a, b) => b.addedAt - a.addedAt),
  );
}

export function getTrack(id) {
  return runTransaction("readonly", (store) => store.get(id));
}

export function saveTrack(track) {
  return runTransaction("readwrite", (store) => store.put(track));
}

export function deleteTrack(id) {
  return runTransaction("readwrite", (store) => store.delete(id));
}
