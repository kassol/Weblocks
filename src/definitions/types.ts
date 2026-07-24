import type { Quat, Vec3 } from "../math/types.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export type OccupiedSpaceBox = {
  readonly shape: "box";
  readonly min: Vec3;
  readonly max: Vec3;
};

export type LocalFrame = {
  readonly translation: Vec3;
  readonly rotation: Quat;
};

export type ConnectionPointDefinition = {
  readonly pointId: string;
  readonly kind: string;
  readonly type: string;
  readonly accepts: readonly string[];
  readonly capacity: number;
  readonly frame: LocalFrame;
  readonly allowedQuarterTurns?: readonly number[];
};

export type PropertyDefinition =
  | { readonly type: "color"; readonly default: string }
  | { readonly type: "enum"; readonly values: readonly string[]; readonly default: string };

export type PartDefinition = {
  readonly schemaVersion: "1.0";
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly displayName: string;
  readonly appearance: {
    readonly asset: string;
    readonly tintProperty?: string;
  };
  readonly occupiedSpace: readonly OccupiedSpaceBox[];
  readonly connectionPoints: readonly ConnectionPointDefinition[];
  readonly properties: Readonly<Record<string, PropertyDefinition>>;
  readonly extensions: Readonly<Record<string, JsonValue>>;
};

export type PartDefinitionRef = {
  readonly id: string;
  readonly version: string;
};

export type ZoneVolume = {
  readonly shape: "box";
  readonly min: Vec3;
  readonly max: Vec3;
};

export type ChallengeZone = {
  readonly zoneId: string;
  readonly volumes: readonly ZoneVolume[];
};

export type SuccessCondition =
  | { readonly conditionId: string; readonly type: "assembly-spans-zones"; readonly zones: readonly string[] }
  | { readonly conditionId: string; readonly type: "player-parts-clear-zone"; readonly zone: string }
  | { readonly conditionId: string; readonly type: "player-part-count"; readonly min: number; readonly max: number }
  | { readonly conditionId: string; readonly type: "parts-share-assembly"; readonly parts: readonly string[] };

export type AvailablePart = {
  readonly definition: PartDefinitionRef;
  readonly maxCount: number | null;
};

export type ChallengeInitialPart = {
  readonly id: string;
  readonly definition: PartDefinitionRef;
  readonly transform: {
    readonly position: Vec3;
    readonly rotation: Quat;
  };
  readonly properties: Readonly<Record<string, JsonValue>>;
};

export type ChallengeInitialConnection = {
  readonly id: string;
  readonly a: { readonly partId: string; readonly connectionPointId: string };
  readonly b: { readonly partId: string; readonly connectionPointId: string };
};

export type ChallengeDefinition = {
  readonly schemaVersion: "1.0";
  readonly challengeId: string;
  readonly challengeVersion: string;
  readonly metadata: {
    readonly title: string;
    readonly prompt: string;
    readonly estimatedMinutes: number;
  };
  readonly initialScene: {
    readonly parts: readonly ChallengeInitialPart[];
    readonly mechanicalConnections: readonly ChallengeInitialConnection[];
  };
  readonly availableParts: readonly AvailablePart[];
  readonly zones: readonly ChallengeZone[];
  readonly successConditions: readonly SuccessCondition[];
  readonly requiredExtensions: readonly string[];
  readonly extensions: Readonly<Record<string, JsonValue>>;
};

export const MECHANICAL_FIXED_KIND = "weblocks.mechanical.fixed";
export const STUD_TYPE = "weblocks:stud";
export const SOCKET_TYPE = "weblocks:socket";

export function definitionKey(ref: PartDefinitionRef): string {
  return `${ref.id}@${ref.version}`;
}

export function challengeKey(challengeId: string, challengeVersion: string): string {
  return `${challengeId}@${challengeVersion}`;
}
