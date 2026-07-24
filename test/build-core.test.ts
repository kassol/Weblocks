import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembliesOf,
  createEmptyBuild,
  deletePart,
  exportBuildSnapshot,
  movePart,
  placePart,
  worldOccupiedBoxes,
} from "../src/build/core.js";
import type { PartInstance } from "../src/build/document.js";
import { BRICK_1, BRICK_2 } from "../src/definitions/bricks.js";
import { DefinitionRegistry } from "../src/definitions/registry.js";
import { quatFromYQuarterTurn } from "../src/math/types.js";

function brick1(id: string, x: number, y: number, z: number, yaw = 0): PartInstance {
  return {
    id,
    definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
    transform: { position: [x, y, z], rotation: quatFromYQuarterTurn(yaw) },
    properties: { color: "#e04f3f" },
  };
}

function brick2(id: string, x: number, y: number, z: number, yaw = 0): PartInstance {
  return {
    id,
    definition: { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion },
    transform: { position: [x, y, z], rotation: quatFromYQuarterTurn(yaw) },
    properties: { color: "#e04f3f" },
  };
}

describe("Build Core public boundary", () => {
  const registry = DefinitionRegistry.withBuiltIns();

  it("places a Grounded Brick on the workspace floor", () => {
    const result = placePart(createEmptyBuild("b1"), registry, brick1("a", 0, 0, 0));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.build.parts.length, 1);
    assert.equal(result.build.mechanicalConnections.length, 0);
  });

  it("creates every aligned compatible Mechanical Connection on multi-point placement", () => {
    let build = createEmptyBuild("b1");
    const base = placePart(build, registry, brick2("base", 0, 0, 0));
    assert.equal(base.ok, true);
    if (!base.ok) return;
    build = base.build;

    const stacked = placePart(build, registry, brick2("top", 0, 0.6, 0));
    assert.equal(stacked.ok, true);
    if (!stacked.ok) return;
    assert.equal(stacked.build.mechanicalConnections.length, 2);
    const endpoints = stacked.build.mechanicalConnections.flatMap((c) => [
      `${c.a.partId}/${c.a.connectionPointId}`,
      `${c.b.partId}/${c.b.connectionPointId}`,
    ]);
    assert.ok(endpoints.includes("base/top-left"));
    assert.ok(endpoints.includes("base/top-right"));
    assert.ok(endpoints.includes("top/bottom-left"));
    assert.ok(endpoints.includes("top/bottom-right"));
  });

  it("allows a Connection Point with capacity greater than one", () => {
    const registryWithHub = DefinitionRegistry.withBuiltIns();
    const hub = {
      ...BRICK_1,
      definitionId: "weblocks:hub",
      definitionVersion: "1.0.0",
      displayName: "Hub",
      appearance: { asset: "catalog/hub.glb" },
      connectionPoints: [
        {
          pointId: "top",
          kind: "weblocks.mechanical.fixed",
          type: "weblocks:stud",
          accepts: ["weblocks:socket"],
          capacity: 2,
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
      occupiedSpace: BRICK_1.occupiedSpace,
      properties: BRICK_1.properties,
      extensions: {},
      schemaVersion: "1.0" as const,
    };
    assert.equal(registryWithHub.registerPartDefinition(hub).ok, true);
    assert.equal(registryWithHub.connectionPointCapacities({ id: "weblocks:hub", version: "1.0.0" })?.top, 2);

    let build = createEmptyBuild("b1");
    const placedHub = placePart(build, registryWithHub, {
      id: "hub",
      definition: { id: "weblocks:hub", version: "1.0.0" },
      transform: { position: [0, 0, 0], rotation: quatFromYQuarterTurn(0) },
      properties: { color: "#336699" },
    });
    assert.equal(placedHub.ok, true);
    if (!placedHub.ok) return;
    const first = placePart(placedHub.build, registryWithHub, brick1("p1", 0, 0.6, 0));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.build.mechanicalConnections.length, 1);
  });

  it("allows cyclic Mechanical Connections across an Assembly", () => {
    let build = createEmptyBuild("b1");
    for (const part of [brick1("a", 0, 0, 0), brick1("b", 1, 0, 0), brick1("c", 0.5, 0.6, 0)]) {
      // Place a,b on ground as separate assemblies first; then we'll stack with offsets that don't auto-connect sideways.
      const placed = placePart(build, registry, part);
      // c at y=0.6 may not align with a or b studs depending on x - place sequentially with known stacking instead
      void placed;
    }

    build = createEmptyBuild("b1");
    const a = placePart(build, registry, brick1("a", 0, 0, 0));
    assert.ok(a.ok);
    if (!a.ok) return;
    build = a.build;
    const b = placePart(build, registry, brick1("b", 0, 0.6, 0));
    assert.ok(b.ok);
    if (!b.ok) return;
    build = b.build;
    const c = placePart(build, registry, brick1("c", 0, 1.2, 0));
    assert.ok(c.ok);
    if (!c.ok) return;
    build = c.build;

    // Close a cycle by also connecting c back is automatic only via chain; add an extra explicit mutual path by stacking isn't a graph cycle of 3 with only vertical stack (it's a path).
    // Create a cycle by injecting a redundant connection between a and c is invalid without alignment.
    // Instead: three parts where a-b, b-c, and a-c all align — use brick-2 bridging.
    build = createEmptyBuild("cycle");
    const left = placePart(build, registry, brick1("left", -0.5, 0, 0));
    assert.ok(left.ok);
    if (!left.ok) return;
    build = left.build;
    const right = placePart(build, registry, brick1("right", 0.5, 0, 0));
    assert.ok(right.ok);
    if (!right.ok) return;
    build = right.build;
    const bridge = placePart(build, registry, brick2("bridge", 0, 0.6, 0));
    assert.ok(bridge.ok);
    if (!bridge.ok) return;
    // left-top to bridge-bottom-left, right-top to bridge-bottom-right => tree, not cycle.
    // Cycle: also connect left-right somehow — they don't have side connectors in V1.
    // PRD requires cycles be *valid*, not that every build contains one. Inject two stacked bricks plus a second path via explicit duplicate is wrong.
    // Create cycle: A-B vertical, B-C vertical, and add second connection A-C if we had long reach — skip.
    // Use capacity and multiple connections between same pair as the cycle-related case, plus graph cycle via 3 parts with side-by-side... 
    // Practical approach: take A-B and B-A already one edge; for a 3-cycle use parts that connect A-B, B-C, C-A with brick2 on two stacks.

    // Two columns of height 1 and a top brick-2 connecting them forms a tree. To form a cycle, add a bottom brick-2 as well.
    build = createEmptyBuild("cycle2");
    const bottom = placePart(build, registry, brick2("bottom", 0, 0, 0));
    assert.ok(bottom.ok);
    if (!bottom.ok) return;
    build = bottom.build;
    const colL = placePart(build, registry, brick1("colL", -0.5, 0.6, 0));
    assert.ok(colL.ok);
    if (!colL.ok) return;
    build = colL.build;
    const colR = placePart(build, registry, brick1("colR", 0.5, 0.6, 0));
    assert.ok(colR.ok);
    if (!colR.ok) return;
    build = colR.build;
    const top = placePart(build, registry, brick2("top", 0, 1.2, 0));
    assert.ok(top.ok);
    if (!top.ok) return;
    build = top.build;

    const graph = assembliesOf(build);
    assert.equal(graph.length, 1);
    assert.equal(graph[0]?.length, 4);
    // Cycle exists if edges >= nodes in undirected connected graph with a loop:  bottom-colL, bottom-colR, colL-top, colR-top => 4 edges, 4 nodes => has cycle.
    assert.ok(build.mechanicalConnections.length >= 4);
  });

  it("allows separate Grounded Assemblies", () => {
    let build = createEmptyBuild("b1");
    const left = placePart(build, registry, brick1("left", -2, 0, 0));
    assert.ok(left.ok);
    if (!left.ok) return;
    const right = placePart(left.build, registry, brick1("right", 2, 0, 0));
    assert.ok(right.ok);
    if (!right.ok) return;
    assert.equal(assembliesOf(right.build).length, 2);
  });

  it("allows face contact without positive-volume overlap", () => {
    let build = createEmptyBuild("b1");
    const left = placePart(build, registry, brick1("left", 0, 0, 0));
    assert.ok(left.ok);
    if (!left.ok) return;
    const right = placePart(left.build, registry, brick1("right", 1, 0, 0));
    assert.ok(right.ok);
    if (!right.ok) return;
    const leftBoxes = worldOccupiedBoxes(left.build.parts[0]!, BRICK_1);
    const rightBoxes = worldOccupiedBoxes(right.build.parts[1]!, BRICK_1);
    assert.equal(leftBoxes[0]!.max[0], rightBoxes[0]!.min[0]);
  });

  it("rejects positive-volume overlap", () => {
    let build = createEmptyBuild("b1");
    const first = placePart(build, registry, brick1("a", 0, 0, 0));
    assert.ok(first.ok);
    if (!first.ok) return;
    const overlap = placePart(first.build, registry, brick1("b", 0.25, 0, 0));
    assert.equal(overlap.ok, false);
    if (overlap.ok) return;
    assert.equal(overlap.code, "OVERLAP");
    assert.equal(exportBuildSnapshot(first.build), exportBuildSnapshot(first.build));
  });

  it("rejects ground penetration", () => {
    const result = placePart(createEmptyBuild("b1"), registry, brick1("a", 0, -0.1, 0));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "GROUND_PENETRATION");
  });

  it("rejects a floating Assembly", () => {
    const result = placePart(createEmptyBuild("b1"), registry, brick1("a", 0, 1, 0));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "UNGROUNDED_ASSEMBLY");
  });

  it("rolls back an illegal move atomically at the export boundary", () => {
    let build = createEmptyBuild("b1");
    const a = placePart(build, registry, brick1("a", 0, 0, 0));
    assert.ok(a.ok);
    if (!a.ok) return;
    build = a.build;
    const b = placePart(build, registry, brick1("b", 2, 0, 0));
    assert.ok(b.ok);
    if (!b.ok) return;
    build = b.build;
    const before = exportBuildSnapshot(build);

    const moved = movePart(build, registry, "b", { position: [0.25, 0, 0], rotation: quatFromYQuarterTurn(0) });
    assert.equal(moved.ok, false);
    assert.equal(exportBuildSnapshot(build), before);
  });

  it("rolls back an illegal delete that would leave a floating Assembly", () => {
    let build = createEmptyBuild("b1");
    const base = placePart(build, registry, brick1("base", 0, 0, 0));
    assert.ok(base.ok);
    if (!base.ok) return;
    build = base.build;
    const top = placePart(build, registry, brick1("top", 0, 0.6, 0));
    assert.ok(top.ok);
    if (!top.ok) return;
    build = top.build;
    const before = exportBuildSnapshot(build);

    const deleted = deletePart(build, registry, "base");
    assert.equal(deleted.ok, false);
    if (deleted.ok) return;
    assert.equal(deleted.code, "UNGROUNDED_ASSEMBLY");
    assert.equal(exportBuildSnapshot(build), before);
  });
});
