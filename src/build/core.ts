import type { DefinitionRegistry } from "../definitions/registry.js";
import type { ConnectionPointDefinition, PartDefinition } from "../definitions/types.js";
import { MECHANICAL_FIXED_KIND } from "../definitions/types.js";
import {
  boxPenetratesGround,
  boxesHavePositiveVolumeOverlap,
  boxTouchesGround,
  transformLocalBox,
  type AxisAlignedBox,
} from "../math/box.js";
import {
  EPSILON,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type Quat,
  type Vec3,
  vec3AlmostEqual,
  vec3Dot,
  isYQuarterTurn,
} from "../math/types.js";
import {
  BUILD_FORMAT,
  BUILD_SCHEMA_VERSION,
  serializeBuild,
  type BuildDocument,
  type MechanicalConnection,
  type PartInstance,
  type Transform,
} from "./document.js";

export type ValidityFailureCode =
  | "OVERLAP"
  | "GROUND_PENETRATION"
  | "UNGROUNDED_ASSEMBLY"
  | "INCOMPATIBLE_CONNECTION"
  | "CAPACITY_EXCEEDED"
  | "UNKNOWN_PART"
  | "UNKNOWN_DEFINITION"
  | "INVALID_ORIENTATION";

export type EditRejection = {
  readonly ok: false;
  readonly code: ValidityFailureCode;
  readonly message: string;
};

export type EditSuccess = {
  readonly ok: true;
  readonly build: BuildDocument;
};

export type EditResult = EditSuccess | EditRejection;

export type WorldConnectionPoint = {
  readonly partId: string;
  readonly point: ConnectionPointDefinition;
  readonly position: Vec3;
  readonly rotation: Quat;
};

function reject(code: ValidityFailureCode, message: string): EditRejection {
  return { ok: false, code, message };
}

export function createEmptyBuild(id: string): BuildDocument {
  return {
    format: BUILD_FORMAT,
    schemaVersion: BUILD_SCHEMA_VERSION,
    id,
    parts: [],
    mechanicalConnections: [],
    extensions: [],
  };
}

export function exportBuildSnapshot(build: BuildDocument): string {
  return serializeBuild(build);
}

export function connectionPointsAreCompatible(left: ConnectionPointDefinition, right: ConnectionPointDefinition): boolean {
  return left.kind === right.kind && left.accepts.includes(right.type) && right.accepts.includes(left.type);
}

export function worldOccupiedBoxes(part: PartInstance, definition: PartDefinition): AxisAlignedBox[] {
  const rotate = (v: Vec3) => quatRotateVec3(part.transform.rotation, v);
  return definition.occupiedSpace.map((space) =>
    transformLocalBox({ min: space.min, max: space.max }, part.transform.position, "y-quarter", rotate),
  );
}

export function worldConnectionPoint(part: PartInstance, point: ConnectionPointDefinition): WorldConnectionPoint {
  const position = (() => {
    const local = quatRotateVec3(part.transform.rotation, point.frame.translation);
    return [
      local[0] + part.transform.position[0],
      local[1] + part.transform.position[1],
      local[2] + part.transform.position[2],
    ] as Vec3;
  })();
  const rotation = quatNormalize(quatMultiply(part.transform.rotation, point.frame.rotation));
  return { partId: part.id, point, position, rotation };
}

function framesAlign(left: WorldConnectionPoint, right: WorldConnectionPoint): boolean {
  if (!vec3AlmostEqual(left.position, right.position, 1e-4)) {
    return false;
  }
  if (left.point.kind !== MECHANICAL_FIXED_KIND || right.point.kind !== MECHANICAL_FIXED_KIND) {
    return false;
  }
  // Local +Y is the Connection Point outward axis. Mating points must oppose.
  const leftOut = quatRotateVec3(left.rotation, [0, 1, 0]);
  const rightOut = quatRotateVec3(right.rotation, [0, 1, 0]);
  if (vec3Dot(leftOut, rightOut) > -1 + 1e-3) {
    return false;
  }
  // V1 committed Parts are already restricted to Y quarter-turns; twist is therefore discrete.
  const allowedLeft = left.point.allowedQuarterTurns ?? [0, 1, 2, 3];
  const allowedRight = right.point.allowedQuarterTurns ?? [0, 1, 2, 3];
  return allowedLeft.some((turn) => allowedRight.includes(turn));
}

export function assembliesOf(build: BuildDocument): readonly (readonly string[])[] {
  const neighbours = new Map<string, string[]>();
  for (const part of build.parts) {
    neighbours.set(part.id, []);
  }
  for (const connection of build.mechanicalConnections) {
    neighbours.get(connection.a.partId)?.push(connection.b.partId);
    neighbours.get(connection.b.partId)?.push(connection.a.partId);
  }
  const seen = new Set<string>();
  const assemblies: string[][] = [];
  for (const part of build.parts) {
    if (seen.has(part.id)) continue;
    const ids: string[] = [];
    const pending = [part.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      pending.push(...(neighbours.get(id) ?? []));
    }
    assemblies.push(ids);
  }
  return assemblies;
}

function endpointKey(partId: string, connectionPointId: string): string {
  return `${partId}/${connectionPointId}`;
}

function countEndpointUses(connections: readonly MechanicalConnection[], partId: string, connectionPointId: string): number {
  const key = endpointKey(partId, connectionPointId);
  let count = 0;
  for (const connection of connections) {
    const a = endpointKey(connection.a.partId, connection.a.connectionPointId);
    const b = endpointKey(connection.b.partId, connection.b.connectionPointId);
    if (a === key || b === key) count += 1;
  }
  return count;
}

export function discoverAlignedConnections(
  candidate: PartInstance,
  candidateDefinition: PartDefinition,
  build: BuildDocument,
  registry: DefinitionRegistry,
  existingConnections: readonly MechanicalConnection[],
): { ok: true; connections: MechanicalConnection[] } | EditRejection {
  const candidatePoints = candidateDefinition.connectionPoints
    .filter((point) => point.kind === MECHANICAL_FIXED_KIND)
    .map((point) => worldConnectionPoint(candidate, point));

  const discovered: MechanicalConnection[] = [];
  let connectionIndex = 0;

  for (const other of build.parts) {
    if (other.id === candidate.id) continue;
    const otherDefinition = registry.resolvePart(other.definition);
    if (!otherDefinition) {
      return reject("UNKNOWN_DEFINITION", `Missing Part Definition for ${other.id}.`);
    }
    const otherPoints = otherDefinition.connectionPoints
      .filter((point) => point.kind === MECHANICAL_FIXED_KIND)
      .map((point) => worldConnectionPoint(other, point));

    for (const left of candidatePoints) {
      for (const right of otherPoints) {
        if (!connectionPointsAreCompatible(left.point, right.point)) continue;
        if (!framesAlign(left, right)) continue;

        const leftUses =
          countEndpointUses(existingConnections, left.partId, left.point.pointId) +
          countEndpointUses(discovered, left.partId, left.point.pointId);
        const rightUses =
          countEndpointUses(existingConnections, right.partId, right.point.pointId) +
          countEndpointUses(discovered, right.partId, right.point.pointId);
        if (leftUses >= left.point.capacity) {
          return reject("CAPACITY_EXCEEDED", `Connection Point ${left.partId}/${left.point.pointId} is at capacity.`);
        }
        if (rightUses >= right.point.capacity) {
          return reject("CAPACITY_EXCEEDED", `Connection Point ${right.partId}/${right.point.pointId} is at capacity.`);
        }

        discovered.push({
          id: `auto-${candidate.id}-${connectionIndex++}`,
          a: { partId: left.partId, connectionPointId: left.point.pointId },
          b: { partId: right.partId, connectionPointId: right.point.pointId },
        });
      }
    }
  }

  return { ok: true, connections: discovered };
}

export function validateCommittedBuild(build: BuildDocument, registry: DefinitionRegistry): EditResult {
  for (const part of build.parts) {
    if (!isYQuarterTurn(part.transform.rotation)) {
      return reject("INVALID_ORIENTATION", `Part ${part.id} orientation must be a Y-axis quarter-turn.`);
    }
    if (!registry.resolvePart(part.definition)) {
      return reject("UNKNOWN_DEFINITION", `Part ${part.id} references unavailable definition.`);
    }
  }

  const boxesByPart = new Map<string, AxisAlignedBox[]>();
  for (const part of build.parts) {
    const definition = registry.resolvePart(part.definition)!;
    const boxes = worldOccupiedBoxes(part, definition);
    for (const box of boxes) {
      if (boxPenetratesGround(box)) {
        return reject("GROUND_PENETRATION", `Part ${part.id} penetrates the ground.`);
      }
    }
    boxesByPart.set(part.id, boxes);
  }

  const partList = [...build.parts];
  for (let i = 0; i < partList.length; i += 1) {
    for (let j = i + 1; j < partList.length; j += 1) {
      const left = partList[i]!;
      const right = partList[j]!;
      const leftBoxes = boxesByPart.get(left.id)!;
      const rightBoxes = boxesByPart.get(right.id)!;
      for (const a of leftBoxes) {
        for (const b of rightBoxes) {
          if (boxesHavePositiveVolumeOverlap(a, b)) {
            return reject("OVERLAP", `Parts ${left.id} and ${right.id} have positive-volume Occupied Space overlap.`);
          }
        }
      }
    }
  }

  for (const assembly of assembliesOf(build)) {
    const grounded = assembly.some((partId) => {
      const boxes = boxesByPart.get(partId)!;
      return boxes.some((box) => boxTouchesGround(box));
    });
    if (!grounded) {
      return reject("UNGROUNDED_ASSEMBLY", `Assembly [${assembly.join(", ")}] is not Grounded.`);
    }
  }

  for (const connection of build.mechanicalConnections) {
    const leftPart = build.parts.find((entry) => entry.id === connection.a.partId);
    const rightPart = build.parts.find((entry) => entry.id === connection.b.partId);
    if (!leftPart || !rightPart) {
      return reject("UNKNOWN_PART", `Connection ${connection.id} references a missing Part.`);
    }
    const leftDefinition = registry.resolvePart(leftPart.definition)!;
    const rightDefinition = registry.resolvePart(rightPart.definition)!;
    const leftPoint = leftDefinition.connectionPoints.find((entry) => entry.pointId === connection.a.connectionPointId);
    const rightPoint = rightDefinition.connectionPoints.find((entry) => entry.pointId === connection.b.connectionPointId);
    if (!leftPoint || !rightPoint) {
      return reject("UNKNOWN_PART", `Connection ${connection.id} references a missing Connection Point.`);
    }
    if (!connectionPointsAreCompatible(leftPoint, rightPoint)) {
      return reject("INCOMPATIBLE_CONNECTION", `Connection ${connection.id} endpoints are not type-compatible.`);
    }
    const leftWorld = worldConnectionPoint(leftPart, leftPoint);
    const rightWorld = worldConnectionPoint(rightPart, rightPoint);
    if (!framesAlign(leftWorld, rightWorld)) {
      return reject("INCOMPATIBLE_CONNECTION", `Connection ${connection.id} endpoints are not aligned.`);
    }
    for (const end of [
      { partId: connection.a.partId, point: leftPoint },
      { partId: connection.b.partId, point: rightPoint },
    ]) {
      const uses = countEndpointUses(build.mechanicalConnections, end.partId, end.point.pointId);
      if (uses > end.point.capacity) {
        return reject("CAPACITY_EXCEEDED", `Connection Point ${end.partId}/${end.point.pointId} exceeds capacity.`);
      }
    }
  }

  return { ok: true, build };
}

function withoutPartConnections(build: BuildDocument, partId: string): MechanicalConnection[] {
  return build.mechanicalConnections.filter((connection) => connection.a.partId !== partId && connection.b.partId !== partId);
}

export function placePart(
  build: BuildDocument,
  registry: DefinitionRegistry,
  part: PartInstance,
): EditResult {
  if (build.parts.some((existing) => existing.id === part.id)) {
    return reject("UNKNOWN_PART", `Part ${part.id} already exists.`);
  }
  const definition = registry.resolvePart(part.definition);
  if (!definition) {
    return reject("UNKNOWN_DEFINITION", `Unavailable Part Definition for ${part.id}.`);
  }
  if (!isYQuarterTurn(part.transform.rotation)) {
    return reject("INVALID_ORIENTATION", `Part ${part.id} orientation must be a Y-axis quarter-turn.`);
  }

  const withoutSelf: BuildDocument = {
    ...build,
    parts: [...build.parts, part],
    mechanicalConnections: [...build.mechanicalConnections],
  };
  const discovered = discoverAlignedConnections(part, definition, withoutSelf, registry, build.mechanicalConnections);
  if (!discovered.ok) return discovered;

  const candidate: BuildDocument = {
    ...build,
    parts: [...build.parts, part],
    mechanicalConnections: [...build.mechanicalConnections, ...discovered.connections],
  };
  return validateCommittedBuild(candidate, registry);
}

export function movePart(
  build: BuildDocument,
  registry: DefinitionRegistry,
  partId: string,
  transform: Transform,
): EditResult {
  const existing = build.parts.find((part) => part.id === partId);
  if (!existing) {
    return reject("UNKNOWN_PART", `Part ${partId} does not exist.`);
  }
  if (!isYQuarterTurn(transform.rotation)) {
    return reject("INVALID_ORIENTATION", `Part ${partId} orientation must be a Y-axis quarter-turn.`);
  }

  const moved: PartInstance = { ...existing, transform };
  const remainingParts = build.parts.map((part) => (part.id === partId ? moved : part));
  const remainingConnections = withoutPartConnections(build, partId);
  const definition = registry.resolvePart(moved.definition)!;

  const provisional: BuildDocument = {
    ...build,
    parts: remainingParts,
    mechanicalConnections: remainingConnections,
  };
  const discovered = discoverAlignedConnections(moved, definition, provisional, registry, remainingConnections);
  if (!discovered.ok) return discovered;

  const candidate: BuildDocument = {
    ...build,
    parts: remainingParts,
    mechanicalConnections: [...remainingConnections, ...discovered.connections],
  };
  const validated = validateCommittedBuild(candidate, registry);
  if (!validated.ok) {
    return validated;
  }
  return validated;
}

export function deletePart(build: BuildDocument, registry: DefinitionRegistry, partId: string): EditResult {
  if (!build.parts.some((part) => part.id === partId)) {
    return reject("UNKNOWN_PART", `Part ${partId} does not exist.`);
  }
  const candidate: BuildDocument = {
    ...build,
    parts: build.parts.filter((part) => part.id !== partId),
    mechanicalConnections: withoutPartConnections(build, partId),
  };
  return validateCommittedBuild(candidate, registry);
}

/** True when boxes share a face/edge/point but no positive volume. */
export function boxesContactWithoutOverlap(a: AxisAlignedBox, b: AxisAlignedBox): boolean {
  const overlap = boxesHavePositiveVolumeOverlap(a, b);
  if (overlap) return false;
  const separated =
    a.max[0] < b.min[0] - EPSILON ||
    b.max[0] < a.min[0] - EPSILON ||
    a.max[1] < b.min[1] - EPSILON ||
    b.max[1] < a.min[1] - EPSILON ||
    a.max[2] < b.min[2] - EPSILON ||
    b.max[2] < a.min[2] - EPSILON;
  return !separated;
}
