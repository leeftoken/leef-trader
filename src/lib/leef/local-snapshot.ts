import type { LeefSnapshot } from "./types";

/**
 * Local backup of the last live book — a "small solid local backup" for
 * instant, useful reloads. PAINT-ONLY: the market engine never reads this
 * file; use-snapshot.ts paints it exactly like the build-time seed, and the
 * staleness gate keeps trading impossible until a real live pull lands.
 *
 * IndexedDB, fail-silent (private mode / quota / disabled storage all
 * degrade to "no cache"), same conventions as the evidence journal.
 */

const DB_NAME = "leef-local";
const STORE = "snapshot";
const KEY = "latest";
/** Ignore a cached book older than this — it would paint misleading prices. */
export const LOCAL_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
/** Write at most this often; the book changes every cycle. */
export const LOCAL_SNAPSHOT_SAVE_MIN_MS = 30_000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastSaveAt = 0;

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (!idbAvailable()) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (!settled) {
        settled = true;
        resolve(db);
      }
    };
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE);
        } catch {
          /* store exists */
        }
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

/** Fire-and-forget write of the latest live book (throttled internally). */
export function saveLocalSnapshot(snap: LeefSnapshot): void {
  if (snap.source !== "live") return;
  const now = Date.now();
  if (now - lastSaveAt < LOCAL_SNAPSHOT_SAVE_MIN_MS) return;
  lastSaveAt = now;
  void openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE, "readwrite").objectStore(STORE).put(snap, KEY);
    } catch {
      /* fail silent */
    }
  });
}

/** Latest cached live book, or null when absent, too old, or unreadable. */
export async function loadLocalSnapshot(): Promise<LeefSnapshot | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const snap = await new Promise<unknown>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!snap || typeof snap !== "object") return null;
    const s = snap as LeefSnapshot;
    if (s.source !== "live" || !Array.isArray(s.pools)) return null;
    const fetchedAt = Date.parse(s.fetchedAt);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > LOCAL_SNAPSHOT_MAX_AGE_MS) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}
