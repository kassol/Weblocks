import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyBuild, placePart } from "../src/build/core.js";
import { proposePlacementTransform } from "../src/browser/placement.js";
import { BRICK_1 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";
import { ApplicationSession } from "../src/session/application-session.js";

describe("Free Build placement seam", () => {
  const registry = DefinitionRegistry.withBuiltIns();

  it("proposes ground snaps at half-unit grid", () => {
    const transform = proposePlacementTransform({
      registry,
      build: createEmptyBuild("b"),
      definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
      groundOrHit: [1.24, 0, -0.6],
      yawTurns: 1,
    });
    assert.deepEqual(transform.position, [1, 0, -0.5]);
    assert.deepEqual(transform.rotation, quatFromYQuarterTurn(1));
  });

  it("snaps onto a nearby stud for stacking", () => {
    let build = createEmptyBuild("b");
    const base = placePart(build, registry, {
      id: "base",
      definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
      transform: { position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#e04f3f" },
    });
    assert.equal(base.ok, true);
    if (!base.ok) return;
    build = base.build;

    const transform = proposePlacementTransform({
      registry,
      build,
      definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
      groundOrHit: [0.1, 0, 0.05],
      yawTurns: 0,
    });
    assert.deepEqual(transform.position, [0, 0.6, 0]);
  });

  it("drives Free Build place/rotate/cancel through Application Session", () => {
    const session = ApplicationSession.startFreeBuild(registry);
    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.equal(session.state.mode, "holding-new");
    assert.ok(session.rotateHeld(1).ok);
    assert.ok(session.cancelOrPutBack().ok);
    assert.equal(session.state.mode, "browsing");

    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.ok(
      session.updateHeldTransform({ position: [2, 0, 0], rotation: quatFromYQuarterTurn(0) }).ok,
    );
    const placed = session.commitHeld("p1");
    assert.equal(placed.ok, true);
    assert.equal(session.state.build.parts.length, 1);

    assert.ok(session.pickExistingPart("p1").ok);
    assert.ok(session.deleteHeld().ok);
    assert.equal(session.state.build.parts.length, 0);
  });

  it("rejects an illegal Free Build commit without mutating the Build", () => {
    const session = ApplicationSession.startFreeBuild(registry);
    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.ok(session.updateHeldTransform({ position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) }).ok);
    assert.ok(session.commitHeld("a").ok);

    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.ok(session.updateHeldTransform({ position: [0.2, 0, 0], rotation: quatFromYQuarterTurn(0) }).ok);
    const before = session.exportBuild();
    const rejected = session.commitHeld("b");
    assert.equal(rejected.ok, false);
    assert.equal(session.exportBuild(), before);
  });

  it("puts an existing Part back without deleting it", () => {
    const session = ApplicationSession.startFreeBuild(registry);
    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.ok(session.updateHeldTransform({ position: [1, 0, 1], rotation: quatFromYQuarterTurn(0) }).ok);
    assert.ok(session.commitHeld("keep").ok);
    assert.ok(session.pickExistingPart("keep").ok);
    assert.ok(session.updateHeldTransform({ position: [3, 0, 3], rotation: quatFromYQuarterTurn(0) }).ok);
    assert.ok(session.cancelOrPutBack().ok);
    assert.equal(session.state.mode, "browsing");
    assert.equal(session.state.build.parts.length, 1);
    assert.deepEqual(session.state.build.parts[0]?.transform.position, [1, 0, 1]);
  });
});
