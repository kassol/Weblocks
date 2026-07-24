import type { StorageEffect } from "../session/application-session.js";

export const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Storage seam for the one active Build snapshot. `replaceSnapshot` must be
 * atomic: after a failure or interruption the prior complete snapshot is
 * still what `readSnapshot` returns — never a partial document.
 */
export type SnapshotStore = {
  readSnapshot(): Promise<string | null>;
  replaceSnapshot(snapshot: string): Promise<void>;
};

/** Schedules a callback after a delay and returns a function that cancels it. */
export type DebounceScheduler = {
  schedule(callback: () => void, delayMs: number): () => void;
};

const timeoutScheduler: DebounceScheduler = {
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export class LocalBuildRepository {
  readonly #store: SnapshotStore;
  readonly #scheduler: DebounceScheduler;
  #cancelPending?: () => void;

  constructor(store: SnapshotStore, scheduler: DebounceScheduler = timeoutScheduler) {
    this.#store = store;
    this.#scheduler = scheduler;
  }

  /** Feeds the Application Session's committed-edit effects into autosave. */
  applyStorageEffects(effects: readonly StorageEffect[]): void {
    for (const effect of effects) {
      if (effect.type === "persist-committed-build") {
        this.scheduleSave(effect.snapshot);
      }
    }
  }

  /** Trailing 500 ms debounce; each later committed edit restarts the timer. */
  scheduleSave(snapshot: string): void {
    this.#cancelPending?.();
    this.#cancelPending = this.#scheduler.schedule(() => {
      this.#cancelPending = undefined;
      // A rejected replacement leaves the prior complete snapshot in the store.
      void this.#store.replaceSnapshot(snapshot).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  resume(): Promise<string | null> {
    return this.#store.readSnapshot();
  }
}
