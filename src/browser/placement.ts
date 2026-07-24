import { placePart, worldConnectionPoint } from "../build/core.js";
import type { BuildDocument, Transform } from "../build/document.js";
import type { DefinitionRegistry } from "../definitions/registry.js";
import type { PartDefinitionRef } from "../definitions/types.js";
import { MECHANICAL_FIXED_KIND, SOCKET_TYPE, STUD_TYPE } from "../definitions/types.js";
import { quatFromYQuarterTurn, quatRotateVec3, type Vec3 } from "../math/types.js";

const SNAP_RADIUS = 0.55;
const PROBE_ID = "__placement-probe__";

export function proposePlacementTransform(options: {
  readonly registry: DefinitionRegistry;
  readonly build: BuildDocument;
  readonly definition: PartDefinitionRef;
  readonly groundOrHit: Vec3;
  readonly yawTurns: number;
  /** When moving an existing Part, exclude it so previews ignore its old placement. */
  readonly movingPartId?: string;
}): Transform {
  const rotation = quatFromYQuarterTurn(options.yawTurns);
  const snapped: Vec3 = [snapHalf(options.groundOrHit[0]), 0, snapHalf(options.groundOrHit[2])];
  const held = options.registry.resolvePart(options.definition);
  if (!held) {
    return { position: snapped, rotation };
  }

  const build = options.movingPartId ? withoutPart(options.build, options.movingPartId) : options.build;
  const socketOffsets = held.connectionPoints
    .filter((point) => point.kind === MECHANICAL_FIXED_KIND && point.type === SOCKET_TYPE)
    .map((point) => quatRotateVec3(rotation, point.frame.translation));

  // Candidate origins place one held socket exactly onto a nearby stud.
  const candidates: { position: Vec3; distance: number }[] = [];
  for (const part of build.parts) {
    const definition = options.registry.resolvePart(part.definition);
    if (!definition) continue;
    for (const point of definition.connectionPoints) {
      if (point.kind !== MECHANICAL_FIXED_KIND || point.type !== STUD_TYPE) continue;
      const stud = worldConnectionPoint(part, point).position;
      for (const offset of socketOffsets) {
        const origin: Vec3 = [stud[0] - offset[0], stud[1] - offset[1], stud[2] - offset[2]];
        const distance = Math.hypot(origin[0] - snapped[0], origin[2] - snapped[2]);
        if (distance > SNAP_RADIUS) continue;
        candidates.push({ position: origin, distance });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.position[1] - b.position[1]);

  for (const candidate of candidates) {
    if (previewIsLegal(build, options.registry, options.definition, candidate.position, rotation)) {
      return { position: candidate.position, rotation };
    }
  }
  return { position: snapped, rotation };
}

function previewIsLegal(
  build: BuildDocument,
  registry: DefinitionRegistry,
  definition: PartDefinitionRef,
  position: Vec3,
  rotation: Transform["rotation"],
): boolean {
  return placePart(build, registry, {
    id: PROBE_ID,
    definition,
    transform: { position, rotation },
    properties: {},
  }).ok;
}

function withoutPart(build: BuildDocument, partId: string): BuildDocument {
  return {
    ...build,
    parts: build.parts.filter((part) => part.id !== partId),
    mechanicalConnections: build.mechanicalConnections.filter(
      (connection) => connection.a.partId !== partId && connection.b.partId !== partId,
    ),
  };
}

function snapHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
