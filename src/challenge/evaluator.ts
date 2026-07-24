import { assembliesOf, worldOccupiedBoxes } from "../build/core.js";
import type { BuildDocument } from "../build/document.js";
import type { DefinitionRegistry } from "../definitions/registry.js";
import type { ChallengeDefinition, ChallengeZone, SuccessCondition } from "../definitions/types.js";
import { boxesHavePositiveVolumeOverlap, type AxisAlignedBox } from "../math/box.js";

export type ConditionResult = {
  readonly conditionId: string;
  readonly type: SuccessCondition["type"];
  readonly passed: boolean;
};

export type ChallengeEvaluation = {
  readonly passed: boolean;
  readonly results: readonly ConditionResult[];
};

function zoneBoxes(zone: ChallengeZone): AxisAlignedBox[] {
  return zone.volumes.map((volume) => ({ min: volume.min, max: volume.max }));
}

function partBoxes(build: BuildDocument, registry: DefinitionRegistry, partId: string): AxisAlignedBox[] {
  const part = build.parts.find((entry) => entry.id === partId);
  if (!part) return [];
  const definition = registry.resolvePart(part.definition);
  if (!definition) return [];
  return worldOccupiedBoxes(part, definition);
}

function assemblyReachesZone(
  assemblyIds: readonly string[],
  build: BuildDocument,
  registry: DefinitionRegistry,
  zone: ChallengeZone,
): boolean {
  const volumes = zoneBoxes(zone);
  return assemblyIds.some((partId) => {
    const boxes = partBoxes(build, registry, partId);
    return boxes.some((box) => volumes.some((volume) => boxesHavePositiveVolumeOverlap(box, volume)));
  });
}

function evaluateCondition(
  condition: SuccessCondition,
  challenge: ChallengeDefinition,
  build: BuildDocument,
  registry: DefinitionRegistry,
  initialPartIds: ReadonlySet<string>,
): ConditionResult {
  const zonesById = new Map(challenge.zones.map((zone) => [zone.zoneId, zone]));

  if (condition.type === "assembly-spans-zones") {
    const assemblies = assembliesOf(build);
    const passed = assemblies.some((assembly) =>
      condition.zones.every((zoneId) => {
        const zone = zonesById.get(zoneId);
        return zone ? assemblyReachesZone(assembly, build, registry, zone) : false;
      }),
    );
    return { conditionId: condition.conditionId, type: condition.type, passed };
  }

  if (condition.type === "player-parts-clear-zone") {
    const zone = zonesById.get(condition.zone);
    if (!zone) {
      return { conditionId: condition.conditionId, type: condition.type, passed: false };
    }
    const volumes = zoneBoxes(zone);
    const playerParts = build.parts.filter((part) => !initialPartIds.has(part.id));
    const blocked = playerParts.some((part) => {
      const boxes = partBoxes(build, registry, part.id);
      return boxes.some((box) => volumes.some((volume) => boxesHavePositiveVolumeOverlap(box, volume)));
    });
    return { conditionId: condition.conditionId, type: condition.type, passed: !blocked };
  }

  if (condition.type === "player-part-count") {
    const count = build.parts.filter((part) => !initialPartIds.has(part.id)).length;
    const passed = count >= condition.min && count <= condition.max;
    return { conditionId: condition.conditionId, type: condition.type, passed };
  }

  const assemblies = assembliesOf(build);
  const passed = assemblies.some((assembly) => condition.parts.every((partId) => assembly.includes(partId)));
  return { conditionId: condition.conditionId, type: condition.type, passed };
}

export function evaluateChallenge(
  challenge: ChallengeDefinition,
  build: BuildDocument,
  registry: DefinitionRegistry,
): ChallengeEvaluation {
  const initialPartIds = new Set(challenge.initialScene.parts.map((part) => part.id));
  const results = challenge.successConditions.map((condition) =>
    evaluateCondition(condition, challenge, build, registry, initialPartIds),
  );
  return { passed: results.every((result) => result.passed), results };
}
