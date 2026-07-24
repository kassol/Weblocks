import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRIDGE_CHALLENGE,
  BRIDGE_CHALLENGE_ID,
  BRIDGE_CHALLENGE_VERSION,
  bridgeHint,
  bridgeProgress,
} from "../src/challenge/bridge-challenge.js";
import { BRICK_1, BRICK_2, BRICK_4 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { definitionKey, type PartDefinitionRef } from "../src/definitions/types.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";
import { ApplicationSession, type SessionSuccess } from "../src/session/application-session.js";

const BRICK_1_REF = { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion };
const BRICK_2_REF = { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion };
const BRICK_4_REF = { id: BRICK_4.definitionId, version: BRICK_4.definitionVersion };

function registryWithBridge(): DefinitionRegistry {
  const registry = DefinitionRegistry.withBuiltIns();
  const registered = registry.registerChallengeDefinition(BRIDGE_CHALLENGE);
  assert.equal(registered.ok, true, registered.ok ? "" : registered.message);
  return registry;
}

function startBridge(registry: DefinitionRegistry): ApplicationSession {
  const started = ApplicationSession.startChallenge(registry, BRIDGE_CHALLENGE_ID, BRIDGE_CHALLENGE_VERSION);
  assert.equal(started.ok, true, started.ok ? "" : started.message);
  if (!started.ok) throw new Error("unreachable");
  return started.session;
}

function commit(
  session: ApplicationSession,
  ref: PartDefinitionRef,
  id: string,
  x: number,
  y: number,
): SessionSuccess {
  assert.ok(session.pickNewPart(ref).ok);
  assert.ok(session.updateHeldTransform({ position: [x, y, 0], rotation: quatFromYQuarterTurn(0) }).ok);
  const result = session.commitHeld(id);
  assert.equal(result.ok, true, result.ok ? "" : `${id}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function conditionPassed(session: ApplicationSession, conditionId: string): boolean {
  const result = session.state.lastEvaluation?.results.find((entry) => entry.conditionId === conditionId);
  assert.ok(result, `condition ${conditionId} missing from evaluation`);
  return result.passed;
}

describe("Bridge Challenge Definition", () => {
  it("publishes an immutable schema-v1 definition over the three Bricks with unlimited inventory", () => {
    registryWithBridge();

    assert.equal(BRIDGE_CHALLENGE.schemaVersion, "1.0");
    assert.equal(Object.isFrozen(BRIDGE_CHALLENGE), true);
    assert.equal(Object.isFrozen(BRIDGE_CHALLENGE.successConditions), true);
    assert.equal(Object.isFrozen(BRIDGE_CHALLENGE.initialScene.parts[0]), true);

    assert.deepEqual(
      BRIDGE_CHALLENGE.availableParts.map((entry) => definitionKey(entry.definition)).sort(),
      [BRICK_1_REF, BRICK_2_REF, BRICK_4_REF].map(definitionKey).sort(),
    );
    assert.ok(BRIDGE_CHALLENGE.availableParts.every((entry) => entry.maxCount === null));

    assert.deepEqual(
      BRIDGE_CHALLENGE.zones.map((zone) => zone.zoneId).sort(),
      ["destination", "start"],
    );
    assert.deepEqual(BRIDGE_CHALLENGE.requiredExtensions, []);

    const span = BRIDGE_CHALLENGE.successConditions.find((entry) => entry.type === "assembly-spans-zones");
    const share = BRIDGE_CHALLENGE.successConditions.find((entry) => entry.type === "parts-share-assembly");
    assert.equal(BRIDGE_CHALLENGE.successConditions.length, 2);
    assert.ok(span && span.type === "assembly-spans-zones");
    assert.deepEqual([...span.zones].sort(), ["destination", "start"]);
    assert.ok(share && share.type === "parts-share-assembly");
    assert.deepEqual([...share.parts].sort(), ["destination-support", "start-support"]);
  });

  it("starts with Grounded locked supports, both conditions unmet, and no success", () => {
    const session = startBridge(registryWithBridge());

    assert.equal(session.state.build.parts.length, 2);
    assert.equal(session.state.challengeSuccess, false);
    assert.equal(conditionPassed(session, "bridge-spans"), false);
    assert.equal(conditionPassed(session, "supports-linked"), false);

    const locked = session.pickExistingPart("start-support");
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.code, "AUTHOR_PART_LOCKED");
  });

  it("succeeds through a low deck build of three player Parts", () => {
    const session = startBridge(registryWithBridge());

    commit(session, BRICK_4_REF, "deck-a", -1.5, 0.6);
    commit(session, BRICK_4_REF, "deck-b", 2.5, 0.6);
    assert.equal(session.state.challengeSuccess, false);

    const final = commit(session, BRICK_2_REF, "stitch", 0.5, 1.2);
    assert.equal(session.state.challengeSuccess, true);
    assert.ok(final.rendererEffects.some((effect) => effect.type === "challenge-success"));
    assert.equal(conditionPassed(session, "bridge-spans"), true);
    assert.equal(conditionPassed(session, "supports-linked"), true);
  });

  it("fails while the destination support is outside the Assembly, then succeeds once linked", () => {
    const session = startBridge(registryWithBridge());

    commit(session, BRICK_2_REF, "start-link", -2.5, 0.6);
    commit(session, BRICK_4_REF, "deck", -0.5, 1.2);
    commit(session, BRICK_2_REF, "stitch", 1.5, 1.8);
    commit(session, BRICK_4_REF, "overhang", 3.5, 1.2);

    assert.equal(conditionPassed(session, "bridge-spans"), true);
    assert.equal(conditionPassed(session, "supports-linked"), false);
    assert.equal(session.state.challengeSuccess, false);

    commit(session, BRICK_2_REF, "destination-link", 2.5, 0.6);
    assert.equal(session.state.challengeSuccess, true);
  });

  it("keeps the published definition untouched by play", () => {
    const registry = registryWithBridge();
    const before = structuredClone(BRIDGE_CHALLENGE);
    const session = startBridge(registry);
    commit(session, BRICK_4_REF, "deck-a", -1.5, 0.6);
    commit(session, BRICK_4_REF, "deck-b", 2.5, 0.6);
    commit(session, BRICK_2_REF, "stitch", 0.5, 1.2);

    assert.deepEqual(registry.resolveChallenge(BRIDGE_CHALLENGE_ID, BRIDGE_CHALLENGE_VERSION), before);
    assert.deepEqual(BRIDGE_CHALLENGE, before);
  });
});

describe("Bridge hint copy", () => {
  const base = { playerPartCount: 0, spanPassed: false, sharePassed: false, success: false };

  it("computes progress from an evaluation", () => {
    const progress = bridgeProgress(
      {
        passed: false,
        results: [
          { conditionId: "bridge-spans", type: "assembly-spans-zones", passed: true },
          { conditionId: "supports-linked", type: "parts-share-assembly", passed: false },
        ],
      },
      3,
    );
    assert.deepEqual(progress, { playerPartCount: 3, spanPassed: true, sharePassed: false, success: false });
  });

  it("guides the first placement, then escalates to a concrete next-placement cue", () => {
    const calm = bridgeHint(base, false);
    const strong = bridgeHint(base, true);
    assert.ok(calm.length > 0);
    assert.notEqual(calm, strong);
    assert.ok(strong.includes("试试看"));
  });

  it("points at the destination support when the span holds but the supports are unlinked", () => {
    const progress = { ...base, playerPartCount: 4, spanPassed: true };
    assert.ok(bridgeHint(progress, false).includes("支撑"));
    assert.ok(bridgeHint(progress, true).includes("终点支撑"));
  });

  it("celebrates the success state", () => {
    const done = { ...base, playerPartCount: 3, spanPassed: true, sharePassed: true, success: true };
    assert.equal(bridgeHint(done, false), bridgeHint(done, true));
    assert.ok(bridgeHint(done, false).includes("搭好"));
  });
});
