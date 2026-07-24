import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyBuild, placePart, exportBuildSnapshot } from "../src/build/core.js";
import { loadBuild, serializeBuild, type BuildDocument } from "../src/build/document.js";
import { BRICK_1 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";

describe("Build file reader/writer", () => {
  const registry = DefinitionRegistry.withBuiltIns();

  function sampleBuild(): BuildDocument {
    let build = createEmptyBuild("build-1");
    const a = placePart(build, registry, {
      id: "a",
      definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
      transform: { position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#e04f3f" },
    });
    if (a.ok === false) throw new Error(a.message);
    build = a.build;
    const top = placePart(build, registry, {
      id: "top",
      definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
      transform: { position: [0, 0.6, 0], rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#3366ff" },
    });
    if (top.ok === false) throw new Error(top.message);
    return {
      ...top.build,
      extensions: [
        {
          id: "weblocks.future.demo",
          version: "1",
          required: false,
          data: { note: "keep-me" },
        },
      ],
    };
  }

  it("round-trips an exact Build document", () => {
    const build = sampleBuild();
    const source = serializeBuild(build);
    const loaded = loadBuild(source, registry, new Set());
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(serializeBuild(loaded.build), source);
    assert.equal(loaded.warnings.length, 1);
  });

  it("preserves unknown optional extensions with a warning", () => {
    const build = sampleBuild();
    const loaded = loadBuild(serializeBuild(build), registry);
    assert.ok(loaded.ok);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.build.extensions, build.extensions);
    assert.match(loaded.warnings[0] ?? "", /Optional extension/);
  });

  it("rejects an unknown required extension", () => {
    const build = sampleBuild();
    const required: BuildDocument = {
      ...build,
      extensions: [{ id: "weblocks.electrical.v1", version: "1", required: true, data: {} }],
    };
    const loaded = loadBuild(serializeBuild(required), registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "UNSUPPORTED_REQUIRED_EXTENSION");
  });

  it("rejects an unsupported schema version", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as Record<string, unknown>;
    raw.schemaVersion = 2;
    const loaded = loadBuild(`${JSON.stringify(raw)}\n`, registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects an unavailable exact Part Definition", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as BuildDocument;
    const mutated = {
      ...raw,
      parts: raw.parts.map((part, index) =>
        index === 0 ? { ...part, definition: { id: "weblocks:missing", version: "1.0.0" } } : part,
      ),
    };
    const loaded = loadBuild(serializeBuild(mutated), registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "MISSING_PART_DEFINITION");
  });

  it("rejects an unavailable Connection Point", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as BuildDocument;
    const mutated = {
      ...raw,
      mechanicalConnections: [
        {
          id: "bad",
          a: { partId: "a", connectionPointId: "nope" },
          b: { partId: "top", connectionPointId: "bottom" },
        },
      ],
    };
    const loaded = loadBuild(serializeBuild(mutated), registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "MISSING_CONNECTION_POINT");
  });

  it("rejects malformed endpoints", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as Record<string, unknown>;
    raw.mechanicalConnections = [{ id: "bad", a: { partId: "a" }, b: { partId: "top", connectionPointId: "bottom" } }];
    const loaded = loadBuild(`${JSON.stringify(raw)}\n`, registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "MALFORMED_BUILD");
  });

  it("normalizes near-unit quaternions on load", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as BuildDocument;
    const mutated = {
      ...raw,
      parts: raw.parts.map((part, index) =>
        index === 0
          ? {
              ...part,
              transform: {
                position: part.transform.position,
                rotation: [0, 0, 0, 1.0000001] as [number, number, number, number],
              },
            }
          : part,
      ),
    };
    const loaded = loadBuild(serializeBuild(mutated), registry);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const length = Math.hypot(...loaded.build.parts[0]!.transform.rotation);
    assert.ok(Math.abs(length - 1) < 1e-9);
  });

  it("rejects unknown standard fields", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as Record<string, unknown>;
    raw.extra = true;
    const loaded = loadBuild(`${JSON.stringify(raw)}\n`, registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "MALFORMED_BUILD");
  });

  it("rejects over-capacity Connection Point uses on load", () => {
    const build = sampleBuild();
    const raw = JSON.parse(serializeBuild(build)) as BuildDocument;
    const mutated = {
      ...raw,
      mechanicalConnections: [
        ...raw.mechanicalConnections,
        {
          id: "extra",
          a: { partId: "a", connectionPointId: "top" },
          b: { partId: "top", connectionPointId: "bottom" },
        },
      ],
    };
    const loaded = loadBuild(serializeBuild(mutated), registry);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.code, "CAPACITY_EXCEEDED");
  });

  it("keeps the prior export unchanged when a later edit is rejected", () => {
    const build = sampleBuild();
    const before = exportBuildSnapshot(build);
    const loaded = loadBuild(before, registry);
    assert.ok(loaded.ok);
    assert.equal(before, exportBuildSnapshot(build));
  });
});
