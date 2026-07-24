import { worldConnectionPoint } from "../build/core.js";
import type { BuildDocument, Transform } from "../build/document.js";
import type { DefinitionRegistry } from "../definitions/registry.js";
import type { PartDefinitionRef } from "../definitions/types.js";
import { MECHANICAL_FIXED_KIND, STUD_TYPE } from "../definitions/types.js";
import { quatFromYQuarterTurn, type Vec3 } from "../math/types.js";

export function proposePlacementTransform(options: {
  readonly registry: DefinitionRegistry;
  readonly build: BuildDocument;
  readonly definition: PartDefinitionRef;
  readonly groundOrHit: Vec3;
  readonly yawTurns: number;
}): Transform {
  const rotation = quatFromYQuarterTurn(options.yawTurns);
  const snapped: Vec3 = [snapHalf(options.groundOrHit[0]), 0, snapHalf(options.groundOrHit[2])];

  // Prefer stacking onto a nearby stud if within snap distance.
  let best: { position: Vec3; distance: number } | undefined;
  for (const part of options.build.parts) {
    const definition = options.registry.resolvePart(part.definition);
    if (!definition) continue;
    for (const point of definition.connectionPoints) {
      if (point.kind !== MECHANICAL_FIXED_KIND || point.type !== STUD_TYPE) continue;
      const world = worldConnectionPoint(part, point);
      const dx = world.position[0] - snapped[0];
      const dz = world.position[2] - snapped[2];
      const distance = Math.hypot(dx, dz);
      if (distance > 0.55) continue;
      const candidate: Vec3 = [world.position[0], world.position[1], world.position[2]];
      if (!best || distance < best.distance) {
        best = { position: candidate, distance };
      }
    }
  }

  if (best) {
    return { position: best.position, rotation };
  }
  return { position: snapped, rotation };
}

function snapHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
