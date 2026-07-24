import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRICK_1, BRICK_2, BRICK_4 } from "../src/definitions/bricks.js";
import type { ChallengeDefinition } from "../src/definitions/types.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { ApplicationSession } from "../src/session/application-session.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";

function miniChallenge(): ChallengeDefinition {
  return {
    schemaVersion: "1.0",
    challengeId: "weblocks:mini-bridge",
    challengeVersion: "1.0.0",
    metadata: {
      title: "Mini bridge",
      prompt: "Connect the supports",
      estimatedMinutes: 5,
    },
    initialScene: {
      parts: [
        {
          id: "start-support",
          definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
          transform: { position: [-0.5, 0, 0], rotation: quatFromYQuarterTurn(0) },
          properties: { color: "#777777" },
        },
        {
          id: "end-support",
          definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
          transform: { position: [0.5, 0, 0], rotation: quatFromYQuarterTurn(0) },
          properties: { color: "#777777" },
        },
      ],
      mechanicalConnections: [],
    },
    availableParts: [
      { definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }, maxCount: null },
      { definition: { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion }, maxCount: null },
      { definition: { id: BRICK_4.definitionId, version: BRICK_4.definitionVersion }, maxCount: null },
    ],
    zones: [
      { zoneId: "start", volumes: [{ shape: "box", min: [-1, 0, -0.5], max: [0, 2, 0.5] }] },
      { zoneId: "end", volumes: [{ shape: "box", min: [0, 0, -0.5], max: [1, 2, 0.5] }] },
    ],
    successConditions: [
      { conditionId: "span", type: "assembly-spans-zones", zones: ["start", "end"] },
      { conditionId: "share", type: "parts-share-assembly", parts: ["start-support", "end-support"] },
    ],
    requiredExtensions: [],
    extensions: {},
  };
}

describe("Application Session public seam", () => {
  it("drives a small Challenge from load through legal commands to success", () => {
    const registry = DefinitionRegistry.withBuiltIns();
    assert.ok(registry.registerChallengeDefinition(miniChallenge()).ok);

    const started = ApplicationSession.startChallenge(registry, "weblocks:mini-bridge", "1.0.0");
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const session = started.session;
    assert.equal(session.state.challengeSuccess, false);
    assert.equal(session.state.build.parts.length, 2);

    // Pick a brick-2 and place it bridging both supports at y=0.6.
    let result = session.pickNewPart({ id: BRICK_2.definitionId, version: BRICK_2.definitionVersion }, [0, 0.6, 0]);
    assert.equal(result.ok, true);

    result = session.updateHeldTransform({ position: [0, 0.6, 0], rotation: quatFromYQuarterTurn(0) });
    assert.equal(result.ok, true);
    if (result.ok) {
      const ghost = result.rendererEffects.find((effect) => effect.type === "update-ghost");
      assert.ok(ghost && ghost.type === "update-ghost");
      if (ghost && ghost.type === "update-ghost") {
        assert.equal(ghost.legal, true);
      }
    }

    result = session.commitHeld("bridge");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(session.state.mode, "browsing");
    assert.equal(session.state.build.parts.length, 3);
    assert.ok(session.state.build.mechanicalConnections.length >= 2);
    assert.equal(session.state.challengeSuccess, true);
    assert.ok(result.storageEffects.some((effect) => effect.type === "persist-committed-build"));
    assert.ok(result.rendererEffects.some((effect) => effect.type === "challenge-success"));
    assert.ok(result.rendererEffects.some((effect) => effect.type === "acknowledge-placement"));
  });

  it("rejects illegal commits without mutating the exported Build", () => {
    const registry = DefinitionRegistry.withBuiltIns();
    const session = ApplicationSession.startFreeBuild(registry);
    const before = session.exportBuild();

    assert.ok(session.pickNewPart({ id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }).ok);
    assert.ok(session.updateHeldTransform({ position: [0, 1, 0], rotation: quatFromYQuarterTurn(0) }).ok);
    const commit = session.commitHeld("floating");
    assert.equal(commit.ok, false);
    assert.equal(session.exportBuild(), before);
  });
});
