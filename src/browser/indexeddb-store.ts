import type { SnapshotStore } from "../storage/local-build-repository.js";

const DB_NAME = "weblocks";
const DB_VERSION = 1;
const STORE_NAME = "builds";
const ACTIVE_KEY = "active";

/**
 * One active Build snapshot in IndexedDB. Each replacement is a single
 * readwrite transaction with one put, so an interrupted page leaves either
 * the previous complete snapshot or the new one — never a partial document.
 */
export class IndexedDbSnapshotStore implements SnapshotStore {
  #db?: Promise<IDBDatabase>;

  #open(): Promise<IDBDatabase> {
    if (!this.#db) {
      this.#db = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      });
      // A transient open failure must not poison every later read and write.
      this.#db.catch(() => {
        this.#db = undefined;
      });
    }
    return this.#db;
  }

  async readSnapshot(): Promise<string | null> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_KEY);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
  }

  async replaceSnapshot(snapshot: string): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(snapshot, ACTIVE_KEY);
      // Resolve only on oncomplete: onsuccess of the put fires before the
      // transaction is durably committed.
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
    });
  }
}
