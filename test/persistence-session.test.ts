import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyBuild, placePart } from "../src/build/core.js";
import { serializeBuild, type BuildDocument } from "../src/build/document.js";
import { BRICK_1 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";
import { ApplicationSession, type SessionResult } from "../src/session/application-session.js";
import {
  AUTOSAVE_DEBOUNCE_MS,
  LocalBuildRepository,
  type DebounceScheduler,
  type SnapshotStore,
} from "../src/storage/local-build-repository.js";

const BRICK_1_REF = { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion };

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
  snapshot: string | null = null;
  replaceCalls: string[] = [];

  readSnapshot(): Promise<string | null> {
    return Promise.resolve(this.snapshot);
  }

  replaceSnapshot(snapshot: string): Promise<void> {
    this.replaceCalls.push(snapshot);
    this.snapshot = snapshot;
    return Promise.resolve();
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Mirrors the browser wiring: committed-edit storage effects feed the repository. */
function persistEffects(repository: LocalBuildRepository, result: SessionResult): void {
  if (result.ok) repository.applyStorageEffects(result.storageEffects);
}

function placeFirstBrick(session: ApplicationSession, id: string, x = 0): SessionResult {
  assert.ok(session.pickNewPart(BRICK_1_REF).ok);
  assert.ok(session.updateHeldTransform({ position: [x, 0, 0], rotation: quatFromYQuarterTurn(0) }).ok);
  return session.commitHeld(id);
}

function buildWithOptionalExtension(registry: DefinitionRegistry): BuildDocument {
  let build = createEmptyBuild("portable-1");
  const placed = placePart(build, registry, {
    id: "a",
    definition: BRICK_1_REF,
    transform: { position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) },
    properties: { color: "#e04f3f" },
  });
  if (!placed.ok) throw new Error(placed.message);
  build = placed.build;
  return {
    ...build,
    extensions: [{ id: "weblocks.future.electric", version: "1", required: false, data: { volts: 5 } }],
  };
}

function emptyDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "weblocks.build",
    schemaVersion: 1,
    id: "doc-1",
    parts: [],
    mechanicalConnections: [],
    extensions: [],
    ...overrides,
  });
}

function partEntry(id: string, definition: { id: string; version: string }, x = 0): Record<string, unknown> {
  return {
    id,
    definition,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0, 1] },
    properties: {},
  };
}

describe("Committed-edit persistence through the Application Session seam", () => {
  const registry = DefinitionRegistry.withBuiltIns();

  it("persists only committed valid edits; previews and rejections never write", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);
    const session = ApplicationSession.startFreeBuild(registry);

    persistEffects(repository, session.pickNewPart(BRICK_1_REF));
    persistEffects(repository, session.updateHeldTransform({ position: [0, 1, 0], rotation: quatFromYQuarterTurn(0) }));
    const rejected = session.commitHeld("floating");
    assert.equal(rejected.ok, false);
    persistEffects(repository, rejected);
    persistEffects(repository, session.cancelOrPutBack());

    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    assert.equal(store.replaceCalls.length, 0);

    const committed = placeFirstBrick(session, "kept");
    assert.equal(committed.ok, true);
    persistEffects(repository, committed);
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    assert.deepEqual(store.replaceCalls, [session.exportBuild()]);
  });

  it("leaves the stored snapshot untouched by later ghosts and rejected edits", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);
    const session = ApplicationSession.startFreeBuild(registry);

    persistEffects(repository, placeFirstBrick(session, "kept"));
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    const persisted = store.snapshot;
    assert.equal(persisted, session.exportBuild());

    assert.ok(session.pickNewPart(BRICK_1_REF).ok);
    assert.ok(session.updateHeldTransform({ position: [0.2, 0, 0], rotation: quatFromYQuarterTurn(0) }).ok);
    const rejected = session.commitHeld("overlap");
    assert.equal(rejected.ok, false);
    persistEffects(repository, rejected);
    persistEffects(repository, session.cancelOrPutBack());

    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    assert.equal(store.replaceCalls.length, 1);
    assert.equal(store.snapshot, persisted);
  });

  it("resumes a stored snapshot through the same loader and reproduces the Build", async () => {
    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);
    const first = ApplicationSession.startFreeBuild(registry, "free-build-1");

    persistEffects(repository, placeFirstBrick(first, "a"));
    persistEffects(repository, placeFirstBrick(first, "b", 2));
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    assert.equal(store.replaceCalls.length, 1);

    const resumeSource = await repository.resume();
    assert.ok(resumeSource);
    const resumed = ApplicationSession.startFreeBuild(registry, "free-build-1");
    assert.ok(resumed.importBuild(resumeSource).ok);
    assert.equal(resumed.exportBuild(), first.exportBuild());
  });

  it("round-trips export then import including unknown optional extension data", () => {
    const source = serializeBuild(buildWithOptionalExtension(registry));
    const session = ApplicationSession.startFreeBuild(registry);
    assert.ok(session.importBuild(source).ok);
    assert.equal(session.exportBuild(), source);
    assert.deepEqual(session.state.build.extensions, [
      { id: "weblocks.future.electric", version: "1", required: false, data: { volts: 5 } },
    ]);
  });

  it("rejects every import failure class without touching the Build or the stored snapshot", async () => {
    const failureCases: readonly { readonly name: string; readonly source: string; readonly code: string }[] = [
      { name: "malformed JSON", source: "{", code: "MALFORMED_BUILD" },
      { name: "unknown top-level field", source: emptyDocument({ camera: {} }), code: "MALFORMED_BUILD" },
      { name: "unsupported schema", source: emptyDocument({ schemaVersion: 2 }), code: "UNSUPPORTED_SCHEMA_VERSION" },
      {
        name: "unknown required extension",
        source: emptyDocument({
          extensions: [{ id: "weblocks.future.physics", version: "1", required: true, data: null }],
        }),
        code: "UNSUPPORTED_REQUIRED_EXTENSION",
      },
      {
        name: "missing Part Definition",
        source: emptyDocument({ parts: [partEntry("p", { id: "weblocks:missing", version: "9.9.9" })] }),
        code: "MISSING_PART_DEFINITION",
      },
      {
        name: "missing Connection Point",
        source: emptyDocument({
          parts: [partEntry("p", BRICK_1_REF), partEntry("q", BRICK_1_REF, 2)],
          mechanicalConnections: [
            { id: "c", a: { partId: "p", connectionPointId: "nope" }, b: { partId: "q", connectionPointId: "bottom" } },
          ],
        }),
        code: "MISSING_CONNECTION_POINT",
      },
      {
        name: "Connection Point over capacity",
        source: emptyDocument({
          parts: [partEntry("p", BRICK_1_REF), partEntry("q", BRICK_1_REF, 2), partEntry("r", BRICK_1_REF, 4)],
          mechanicalConnections: [
            { id: "c1", a: { partId: "p", connectionPointId: "top" }, b: { partId: "q", connectionPointId: "bottom" } },
            { id: "c2", a: { partId: "p", connectionPointId: "top" }, b: { partId: "r", connectionPointId: "bottom" } },
          ],
        }),
        code: "CAPACITY_EXCEEDED",
      },
    ];

    const store = new FakeSnapshotStore();
    const scheduler = new ManualScheduler();
    const repository = new LocalBuildRepository(store, scheduler);
    const session = ApplicationSession.startFreeBuild(registry);
    persistEffects(repository, placeFirstBrick(session, "kept"));
    scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    const trustedBuild = session.exportBuild();
    const trustedSnapshot = store.snapshot;

    for (const failure of failureCases) {
      const result = session.importBuild(failure.source);
      assert.equal(result.ok, false, failure.name);
      if (result.ok) continue;
      assert.equal(result.code, failure.code, failure.name);
      assert.ok(result.message.length > 0, failure.name);
      persistEffects(repository, result);
      scheduler.advance(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      assert.equal(session.exportBuild(), trustedBuild, failure.name);
      assert.equal(store.snapshot, trustedSnapshot, failure.name);
    }
  });
});
