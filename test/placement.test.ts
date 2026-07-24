import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyBuild, placePart } from "../src/build/core.js";
import type { BuildDocument } from "../src/build/document.js";
import { proposePlacementTransform } from "../src/browser/placement.js";
import { BRICK_1, BRICK_2 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn, type Vec3 } from "../src/math/types.js";

const BRICK_1_REF = { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion };
const BRICK_2_REF = { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion };

const registry = DefinitionRegistry.withBuiltIns();

function buildWith(parts: readonly { id: string; ref: typeof BRICK_1_REF; position: Vec3 }[]): BuildDocument {
  let build = createEmptyBuild("placement-test");
  for (const entry of parts) {
    const placed = placePart(build, registry, {
      id: entry.id,
      definition: entry.ref,
      transform: { position: entry.position, rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#e04f3f" },
    });
    if (!placed.ok) throw new Error(`${entry.id}: ${placed.message}`);
    build = placed.build;
  }
  return build;
}

describe("Placement proposal", () => {
  it("keeps the half-grid ground snap when no stud is nearby", () => {
    const transform = proposePlacementTransform({
      registry,
      build: createEmptyBuild("empty"),
      definition: BRICK_1_REF,
      groundOrHit: [1.2, 0, 0.3],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [1, 0, 0.5]);
  });

  it("stacks a brick-1 onto a nearby stud", () => {
    const build = buildWith([{ id: "base", ref: BRICK_1_REF, position: [0, 0, 0] }]);
    const transform = proposePlacementTransform({
      registry,
      build,
      definition: BRICK_1_REF,
      groundOrHit: [0.1, 0, 0.1],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [0, 0.6, 0]);
  });

  it("aligns a brick-2 socket onto a lone stud instead of centering on it", () => {
    const build = buildWith([{ id: "base", ref: BRICK_1_REF, position: [0, 0, 0] }]);
    const transform = proposePlacementTransform({
      registry,
      build,
      definition: BRICK_2_REF,
      groundOrHit: [0.4, 0, 0],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [0.5, 0.6, 0]);

    const committed = placePart(build, registry, {
      id: "bridge",
      definition: BRICK_2_REF,
      transform,
      properties: { color: "#3d8bfd" },
    });
    assert.equal(committed.ok, true, committed.ok ? "" : committed.message);
    if (committed.ok) assert.equal(committed.build.mechanicalConnections.length, 1);
  });

  it("bridges two towers so both sockets connect", () => {
    const build = buildWith([
      { id: "left", ref: BRICK_1_REF, position: [0, 0, 0] },
      { id: "right", ref: BRICK_1_REF, position: [1, 0, 0] },
    ]);
    const transform = proposePlacementTransform({
      registry,
      build,
      definition: BRICK_2_REF,
      groundOrHit: [0.5, 0, 0],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [0.5, 0.6, 0]);

    const committed = placePart(build, registry, {
      id: "bridge",
      definition: BRICK_2_REF,
      transform,
      properties: { color: "#3d8bfd" },
    });
    assert.equal(committed.ok, true, committed.ok ? "" : committed.message);
    if (committed.ok) assert.equal(committed.build.mechanicalConnections.length, 2);
  });

  it("skips candidates whose preview is illegal in favor of a legal one", () => {
    const build = buildWith([
      { id: "tower-base", ref: BRICK_1_REF, position: [0, 0, 0] },
      { id: "tower-top", ref: BRICK_1_REF, position: [0, 0.6, 0] },
      { id: "side", ref: BRICK_1_REF, position: [1, 0, 0] },
    ]);
    // At (0.5, 0.6) the brick-2 would overlap tower-top; the legal spot is one level up.
    const transform = proposePlacementTransform({
      registry,
      build,
      definition: BRICK_2_REF,
      groundOrHit: [0.5, 0, 0],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [0.5, 1.2, 0]);
  });

  it("previews a moved Part without colliding with its own old placement", () => {
    const build = buildWith([
      { id: "base", ref: BRICK_1_REF, position: [0, 0, 0] },
      { id: "rider", ref: BRICK_1_REF, position: [0, 0.6, 0] },
    ]);
    const transform = proposePlacementTransform({
      registry,
      build,
      definition: BRICK_1_REF,
      groundOrHit: [0.1, 0, 0],
      yawTurns: 0,
      movingPartId: "rider",
    });
    assert.deepEqual(transform.position, [0, 0.6, 0]);
  });
});
