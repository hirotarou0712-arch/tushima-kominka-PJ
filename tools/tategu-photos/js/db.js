const DB_NAME = "tategu-photos";
const DB_VERSION = 1;
const SCHEMA_KEY = "schemaVersion";
export const SCHEMA_VERSION = "list-v1";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
      if (!db.objectStoreNames.contains("openings")) {
        db.createObjectStore("openings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("walls")) {
        db.createObjectStore("walls", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("photos")) {
        const photos = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
        photos.createIndex("owner", ["ownerType", "ownerId"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

export async function dbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function dbDelete(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function photosFor(ownerType, ownerId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const idx = db.transaction("photos", "readonly").objectStore("photos").index("owner");
    const req = idx.getAll([ownerType, ownerId]);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function addPhoto(ownerType, ownerId, blob) {
  const db = await openDb();
  const tx = db.transaction("photos", "readwrite");
  tx.objectStore("photos").add({
    ownerType,
    ownerId,
    blob,
    mime: blob.type || "image/jpeg",
    createdAt: Date.now()
  });
  await txDone(tx);
}

export async function deletePhoto(id) {
  await dbDelete("photos", id);
}

export async function allPhotos() {
  return dbGetAll("photos");
}

export async function photoCounts() {
  const photos = await allPhotos();
  const map = {};
  for (const p of photos) {
    const key = `${p.ownerType}:${p.ownerId}`;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

export async function deleteOpening(id) {
  const photos = await photosFor("opening", id);
  const db = await openDb();
  const tx = db.transaction(["openings", "photos"], "readwrite");
  tx.objectStore("openings").delete(id);
  const photoStore = tx.objectStore("photos");
  for (const p of photos) {
    photoStore.delete(p.id);
  }
  await txDone(tx);
}

async function metaPut(key, value) {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value, key);
  await txDone(tx);
}

/** 旧シード（地図版）からリスト版へ移行。一度だけデータを空にする。 */
export async function ensureSchema() {
  const cur = await dbGet("meta", SCHEMA_KEY);
  if (cur === SCHEMA_VERSION) return { migrated: false };
  const openings = await dbGetAll("openings");
  const photos = await allPhotos();
  const hadData = openings.length > 0 || photos.length > 0;
  await clearAll();
  await metaPut(SCHEMA_KEY, SCHEMA_VERSION);
  return { migrated: hadData };
}

export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction(["openings", "walls", "photos", "meta"], "readwrite");
  tx.objectStore("openings").clear();
  tx.objectStore("walls").clear();
  tx.objectStore("photos").clear();
  tx.objectStore("meta").clear();
  await txDone(tx);
}

export function nextId(items, prefix) {
  let max = 0;
  for (const item of items) {
    const m = String(item.id).match(new RegExp(`^${prefix}(\\d+)$`, "i"));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
