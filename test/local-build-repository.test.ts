import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTOSAVE_DEBOUNCE_MS,
  LocalBuildRepository,
  type DebounceScheduler,
  type SnapshotStore,
} from "../src/storage/local-build-repository.js";

class ManualScheduler implements DebounceScheduler {
  #nextHandle = 0;
  #tasks = new Map<number, { readonly at: number; readonly run: () => void }>();
  #now = 0;

  schedule(callback: () => void, delayMs: number): () => void {
    this.#nextHandle += 1;
    const handle = this.#nextHandle;
    this.#tasks.set(handle, { at: this.#now + delayMs, run: callback });
    return () => {
      this.#tasks.delete(handle);
    };
  }

  advance(ms: number): void {
    this.#now += ms;
    for (const [handle, task] of [...this.#tasks]) {
      if (task.at <= this.#now) {
        this.#tasks.delete(handle);
        task.run();
      }
    }
  }
}

class FakeSnapshotStore implements SnapshotStore {
  snapshot: string | null;
  replaceCalls: string[] = [];
  failNextReplace = false;

  constructor(initial: string | null = null) {
    this.snapshot = initial;
  }

  readSnapshot(): Promise<string | null> {
    return Promise.resolve(this.snapshot);
  }

  replaceSnapshot(snapshot: string): Promise<void> {
    this.replaceCalls.push(snapshot);
    if (this.failNextReplace) {
      this.failNextReplace = false;
      return Promise.reject(new Error("simulated aborted transaction"));
    }
    this.snapshot = snapshot;
    return Promise.resolve();
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Local Build Repository", () => {
  it("does not write before the 500 ms deadline", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);

    repository.scheduleSave("snapshot-1");
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS - 1);
    await settle();
    assert.equal(store.replaceCalls.length, 0);

    scheduler.advance(1);
    await settle();
    assert.deepEqual(store.replaceCalls, ["snapshot-1"]);
  });

  it("restarts the debounce on each later committed edit", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);

    repository.scheduleSave("first");
    scheduler.advance(300);
    repository.scheduleSave("second");

    scheduler.advance(AUTOSAVE_DEBOUNCE_MS - 1);
    await settle();
    assert.equal(store.replaceCalls.length, 0);

    scheduler.advance(1);
    await settle();
    assert.deepEqual(store.replaceCalls, ["second"]);
    assert.equal(store.snapshot, "second");
  });

  it("replaces the prior revision with exactly one atomic snapshot", async () => {
    const store = new FakeSnapshotStore("prior-revision");
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);

    repository.scheduleSave("next-revision");
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();

    assert.deepEqual(store.replaceCalls, ["next-revision"]);
    assert.equal(store.snapshot, "next-revision");
  });

  it("keeps the prior complete snapshot resumable after a failed replacement", async () => {
    const store = new FakeSnapshotStore("prior-revision");
    store.failNextReplace = true;
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);

    repository.scheduleSave("interrupted");
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();

    assert.equal(await repository.resume(), "prior-revision");
  });

  it("resumes null when no snapshot exists", async () => {
    const repository = new LocalBuildRepository(new FakeSnapshotStore(), new ManualScheduler());
    assert.equal(await repository.resume(), null);
  });

  it("resumes the latest complete snapshot", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);

    repository.scheduleSave("v1");
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    repository.scheduleSave("v2");
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();

    assert.equal(await repository.resume(), "v2");
  });
});
