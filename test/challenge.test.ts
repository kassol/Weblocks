import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyBuild, placePart } from "../src/build/core.js";
import type { BuildDocument, PartInstance } from "../src/build/document.js";
import { evaluateChallenge } from "../src/challenge/evaluator.js";
import { BRICK_1, BRICK_4 } from "../src/definitions/bricks.js";
import type { ChallengeDefinition } from "../src/definitions/types.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";

function part(id: string, def: { definitionId: string; definitionVersion: string }, x: number, y: number, z: number): PartInstance {
  return {
    id,
    definition: { id: def.definitionId, version: def.definitionVersion },
    transform: { position: [x, y, z], rotation: quatFromYQuarterTurn(0) },
    properties: { color: "#e04f3f" },
  };
}

function challengeFixture(): ChallengeDefinition {
  return {
    schemaVersion: "1.0",
    challengeId: "weblocks:test-bridge",
    challengeVersion: "1.0.0",
    metadata: { title: "Test", prompt: "Connect", estimatedMinutes: 5 },
    initialScene: {
      parts: [
        {
          id: "start-support",
          definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
          transform: { position: [-3, 0, 0], rotation: quatFromYQuarterTurn(0) },
          properties: { color: "#888888" },
        },
        {
          id: "end-support",
          definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
          transform: { position: [3, 0, 0], rotation: quatFromYQuarterTurn(0) },
          properties: { color: "#888888" },
        },
      ],
      mechanicalConnections: [],
    },
    availableParts: [
      { definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }, maxCount: null },
      { definition: { id: BRICK_4.definitionId, version: BRICK_4.definitionVersion }, maxCount: null },
    ],
    zones: [
      { zoneId: "start", volumes: [{ shape: "box", min: [-3.5, 0, -0.5], max: [-2.5, 2, 0.5] }] },
      { zoneId: "end", volumes: [{ shape: "box", min: [2.5, 0, -0.5], max: [3.5, 2, 0.5] }] },
      { zoneId: "danger", volumes: [{ shape: "box", min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }] },
    ],
    successConditions: [
      { conditionId: "span", type: "assembly-spans-zones", zones: ["start", "end"] },
      { conditionId: "clear", type: "player-parts-clear-zone", zone: "danger" },
      { conditionId: "count", type: "player-part-count", min: 1, max: 6 },
      { conditionId: "share", type: "parts-share-assembly", parts: ["start-support", "end-support"] },
    ],
    requiredExtensions: [],
    extensions: {},
  };
}

function buildFromParts(registry: DefinitionRegistry, parts: PartInstance[]): BuildDocument {
  let build = createEmptyBuild("challenge-build");
  for (const entry of parts) {
    const placed = placePart(build, registry, entry);
    if (placed.ok === false) throw new Error(placed.message);
    build = placed.build;
  }
  return build;
}

describe("Challenge Evaluator", () => {
  const registry = DefinitionRegistry.withBuiltIns();
  const challenge = challengeFixture();
  assert.equal(registry.registerChallengeDefinition(challenge).ok, true);

  it("requires all four condition types under implicit AND", () => {
    const initial = buildFromParts(registry, [
      part("start-support", BRICK_1, -3, 0, 0),
      part("end-support", BRICK_1, 3, 0, 0),
    ]);
    const failed = evaluateChallenge(challenge, initial, registry);
    assert.equal(failed.passed, false);
    assert.equal(failed.results.length, 4);
  });

  it("passes implicit AND when span, clear, count, and share all hold", () => {
    const longBrick = {
      ...BRICK_4,
      definitionId: "weblocks:and-span",
      definitionVersion: "1.0.0",
      displayName: "And span",
      appearance: { asset: "catalog/and-span.glb" },
      occupiedSpace: [{ shape: "box" as const, min: [-3.5, 0, -0.5] as const, max: [3.5, 0.6, 0.5] as const }],
      connectionPoints: [
        {
          pointId: "bottom-start",
          kind: "weblocks.mechanical.fixed",
          type: "weblocks:socket",
          accepts: ["weblocks:stud"],
          capacity: 1,
          frame: { translation: [-3, 0, 0] as const, rotation: [1, 0, 0, 0] as const },
          allowedQuarterTurns: [0, 1, 2, 3],
        },
        {
          pointId: "bottom-end",
          kind: "weblocks.mechanical.fixed",
          type: "weblocks:socket",
          accepts: ["weblocks:stud"],
          capacity: 1,
          frame: { translation: [3, 0, 0] as const, rotation: [1, 0, 0, 0] as const },
          allowedQuarterTurns: [0, 1, 2, 3],
        },
      ],
    };
    const registry2 = DefinitionRegistry.withBuiltIns();
    assert.ok(registry2.registerPartDefinition(longBrick).ok);
    const andChallenge: ChallengeDefinition = {
      ...challenge,
      challengeId: "weblocks:and-all",
      zones: [
        { zoneId: "start", volumes: [{ shape: "box", min: [-3.5, 0, -0.5], max: [-2.5, 2, 0.5] }] },
        { zoneId: "end", volumes: [{ shape: "box", min: [2.5, 0, -0.5], max: [3.5, 2, 0.5] }] },
        { zoneId: "danger", volumes: [{ shape: "box", min: [-0.5, 0, 2], max: [0.5, 1, 3] }] },
      ],
      availableParts: [{ definition: { id: "weblocks:and-span", version: "1.0.0" }, maxCount: null }],
    };
    assert.ok(registry2.registerChallengeDefinition(andChallenge).ok);

    let build = buildFromParts(registry2, [
      part("start-support", BRICK_1, -3, 0, 0),
      part("end-support", BRICK_1, 3, 0, 0),
    ]);
    const bridge = placePart(build, registry2, {
      id: "bridge",
      definition: { id: "weblocks:and-span", version: "1.0.0" },
      transform: { position: [0, 0.6, 0], rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#e04f3f" },
    });
    if (bridge.ok === false) throw new Error(bridge.message);
    build = bridge.build;

    const result = evaluateChallenge(andChallenge, build, registry2);
    assert.equal(result.passed, true);
    assert.equal(result.results.every((entry) => entry.passed), true);
  });

  it("treats a single Part Occupied Space that reaches both Zones as spanning", () => {
    const narrow: ChallengeDefinition = {
      ...challenge,
      challengeId: "weblocks:span-only",
      successConditions: [{ conditionId: "span", type: "assembly-spans-zones", zones: ["start", "end"] }],
      initialScene: { parts: [], mechanicalConnections: [] },
    };
    const registry2 = DefinitionRegistry.withBuiltIns();
    assert.ok(registry2.registerChallengeDefinition(narrow).ok);

    // brick-4 at origin: occupied x [-2,2], zones at ±3 — doesn't reach. Place at 0 with custom? Use multiple? 
    // Place brick-4 isn't long enough for ±3. Use two connected bricks? Spec says single Part can span — use a temporary long definition.
    const longBrick = {
      ...BRICK_4,
      definitionId: "weblocks:brick-long",
      definitionVersion: "1.0.0",
      displayName: "Long",
      occupiedSpace: [{ shape: "box" as const, min: [-3.5, 0, -0.5] as const, max: [3.5, 0.6, 0.5] as const }],
      connectionPoints: BRICK_1.connectionPoints,
      appearance: { asset: "catalog/long.glb" },
    };
    assert.ok(registry2.registerPartDefinition(longBrick).ok);
    const build = buildFromParts(registry2, [
      {
        id: "long",
        definition: { id: "weblocks:brick-long", version: "1.0.0" },
        transform: { position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) },
        properties: { color: "#e04f3f" },
      },
    ]);
    const result = evaluateChallenge(narrow, build, registry2);
    assert.equal(result.passed, true);
  });

  it("allows passing above a forbidden Zone without intersecting its volume", () => {
    const narrow: ChallengeDefinition = {
      ...challenge,
      challengeId: "weblocks:clear-only",
      successConditions: [{ conditionId: "clear", type: "player-parts-clear-zone", zone: "danger" }],
      initialScene: { parts: [], mechanicalConnections: [] },
    };
    const registry2 = DefinitionRegistry.withBuiltIns();
    assert.ok(registry2.registerChallengeDefinition(narrow).ok);
    const high = {
      ...BRICK_4,
      definitionId: "weblocks:high-bridge",
      definitionVersion: "1.0.0",
      occupiedSpace: [{ shape: "box" as const, min: [-2, 0, -0.5] as const, max: [2, 0.6, 0.5] as const }],
      connectionPoints: BRICK_1.connectionPoints,
      appearance: { asset: "catalog/high.glb" },
      displayName: "High",
    };
    assert.ok(registry2.registerPartDefinition(high).ok);
    // Floating would fail place — put support columns outside danger and bridge at y=1.2
    let build = createEmptyBuild("b");
    // Place grounded feet outside danger then stack — simpler: evaluate against a handcrafted build document bypassing place for floating high part? Evaluator doesn't require grounded.
    build = {
      ...build,
      parts: [
        {
          id: "high",
          definition: { id: "weblocks:high-bridge", version: "1.0.0" },
          transform: { position: [0, 1.2, 0], rotation: quatFromYQuarterTurn(0) },
          properties: { color: "#e04f3f" },
        },
      ],
    };
    const result = evaluateChallenge(narrow, build, registry2);
    assert.equal(result.passed, true);
  });

  it("counts only player-added Parts for player-part-count", () => {
    const narrow: ChallengeDefinition = {
      ...challenge,
      challengeId: "weblocks:count-only",
      successConditions: [{ conditionId: "count", type: "player-part-count", min: 1, max: 1 }],
    };
    const registry2 = DefinitionRegistry.withBuiltIns();
    assert.ok(registry2.registerChallengeDefinition(narrow).ok);
    const build = buildFromParts(registry2, [
      part("start-support", BRICK_1, -3, 0, 0),
      part("end-support", BRICK_1, 3, 0, 0),
      part("player-1", BRICK_1, 0, 0, 0),
    ]);
    const result = evaluateChallenge(narrow, build, registry2);
    assert.equal(result.passed, true);
  });

  it("fails parts-share-assembly until targets share an Assembly", () => {
    const narrow: ChallengeDefinition = {
      ...challenge,
      challengeId: "weblocks:share-only",
      successConditions: [{ conditionId: "share", type: "parts-share-assembly", parts: ["start-support", "end-support"] }],
    };
    const registry2 = DefinitionRegistry.withBuiltIns();
    assert.ok(registry2.registerChallengeDefinition(narrow).ok);

    const disconnected = buildFromParts(registry2, [
      part("start-support", BRICK_1, -3, 0, 0),
      part("end-support", BRICK_1, 3, 0, 0),
      part("near-end", BRICK_1, 3, 0.6, 0),
    ]);
    assert.equal(evaluateChallenge(narrow, disconnected, registry2).passed, false);

    // Connect them with a chain of grounded bricks — long path on ground: can't connect -3 to 3 with brick-1 without many parts. Use long brick definition.
    const longBrick = {
      ...BRICK_4,
      definitionId: "weblocks:link",
      definitionVersion: "1.0.0",
      displayName: "Link",
      occupiedSpace: [{ shape: "box" as const, min: [-0.5, 0, -0.5] as const, max: [0.5, 0.6, 0.5] as const }],
      appearance: { asset: "catalog/link.glb" },
      connectionPoints: [
        {
          pointId: "top",
          kind: "weblocks.mechanical.fixed",
          type: "weblocks:stud",
          accepts: ["weblocks:socket"],
          capacity: 1,
          frame: { translation: [0, 0.6, 0] as const, rotation: [0, 0, 0, 1] as const },
          allowedQuarterTurns: [0, 1, 2, 3],
        },
        {
          pointId: "bottom",
          kind: "weblocks.mechanical.fixed",
          type: "weblocks:socket",
          accepts: ["weblocks:stud"],
          capacity: 1,
          frame: { translation: [0, 0, 0] as const, rotation: [1, 0, 0, 0] as const },
          allowedQuarterTurns: [0, 1, 2, 3],
        },
      ],
    };
    // Stacking end-support and start won't connect across distance. Manually craft connections in the build document for this unit test of the evaluator (evaluator only cares about graph).
    const linked: BuildDocument = {
      ...createEmptyBuild("linked"),
      parts: [
        part("start-support", BRICK_1, -3, 0, 0),
        part("end-support", BRICK_1, 3, 0, 0),
        part("mid", BRICK_1, 0, 0, 0),
      ],
      mechanicalConnections: [
        { id: "c1", a: { partId: "start-support", connectionPointId: "top" }, b: { partId: "mid", connectionPointId: "bottom" } },
        { id: "c2", a: { partId: "mid", connectionPointId: "top" }, b: { partId: "end-support", connectionPointId: "bottom" } },
      ],
    };
    void longBrick;
    assert.equal(evaluateChallenge(narrow, linked, registry2).passed, true);
  });
});
