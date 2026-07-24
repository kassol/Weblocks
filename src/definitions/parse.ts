import type { Quat, Vec3 } from "../math/types.js";
import { asQuat, asVec3, quatIsNormalized } from "../math/types.js";
import {
  type ChallengeDefinition,
  type ConnectionPointDefinition,
  type JsonValue,
  type OccupiedSpaceBox,
  type PartDefinition,
  type PropertyDefinition,
  type SuccessCondition,
} from "./types.js";

export type ParseFailure = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

function fail(code: string, message: string): ParseFailure {
  return { ok: false, code, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function parseBox(value: unknown, label: string): OccupiedSpaceBox | ParseFailure {
  if (!isObject(value) || !hasOnlyKeys(value, ["shape", "min", "max"]) || value.shape !== "box") {
    return fail("MALFORMED_DEFINITION", `${label} must be a box with shape/min/max.`);
  }
  if (!isFiniteTuple(value.min, 3) || !isFiniteTuple(value.max, 3)) {
    return fail("MALFORMED_DEFINITION", `${label} min/max must be finite vec3.`);
  }
  if (value.min.some((n, axis) => n >= (value.max as number[])[axis]!)) {
    return fail("MALFORMED_DEFINITION", `${label} must be a positive volume box.`);
  }
  return { shape: "box", min: asVec3(value.min), max: asVec3(value.max) };
}

function parseConnectionPoint(value: unknown): ConnectionPointDefinition | ParseFailure {
  if (!isObject(value)) {
    return fail("MALFORMED_DEFINITION", "Connection Point must be an object.");
  }
  const allowedKeys = ["pointId", "kind", "type", "accepts", "capacity", "frame", "allowedQuarterTurns"] as const;
  const keys = Object.keys(value);
  if (keys.some((key) => !(allowedKeys as readonly string[]).includes(key))) {
    return fail("MALFORMED_DEFINITION", "Connection Point has unknown fields.");
  }
  if (!isNonEmptyString(value.pointId) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.type)) {
    return fail("MALFORMED_DEFINITION", "Connection Point identity/type fields are required.");
  }
  if (!Array.isArray(value.accepts) || value.accepts.length < 1 || !value.accepts.every(isNonEmptyString)) {
    return fail("MALFORMED_DEFINITION", `${value.pointId}: accepts must be a non-empty string array.`);
  }
  if (!Number.isInteger(value.capacity) || (value.capacity as number) < 1) {
    return fail("MALFORMED_DEFINITION", `${value.pointId}: capacity must be a positive integer.`);
  }
  if (!isObject(value.frame) || !hasOnlyKeys(value.frame, ["translation", "rotation"])) {
    return fail("MALFORMED_DEFINITION", `${value.pointId}: frame is required.`);
  }
  if (!isFiniteTuple(value.frame.translation, 3) || !isFiniteTuple(value.frame.rotation, 4)) {
    return fail("MALFORMED_DEFINITION", `${value.pointId}: frame translation/rotation invalid.`);
  }
  if (!quatIsNormalized(asQuat(value.frame.rotation))) {
    return fail("MALFORMED_DEFINITION", `${value.pointId}: rotation must be a unit quaternion.`);
  }
  let allowedQuarterTurns: number[] | undefined;
  if (value.allowedQuarterTurns !== undefined) {
    if (!Array.isArray(value.allowedQuarterTurns) || !value.allowedQuarterTurns.every((n) => Number.isInteger(n) && n >= 0 && n <= 3)) {
      return fail("MALFORMED_DEFINITION", `${value.pointId}: allowedQuarterTurns must be 0–3 integers.`);
    }
    allowedQuarterTurns = value.allowedQuarterTurns as number[];
  }
  return {
    pointId: value.pointId,
    kind: value.kind,
    type: value.type,
    accepts: value.accepts as string[],
    capacity: value.capacity as number,
    frame: {
      translation: asVec3(value.frame.translation),
      rotation: asQuat(value.frame.rotation),
    },
    ...(allowedQuarterTurns ? { allowedQuarterTurns } : {}),
  };
}

function parseProperty(value: unknown, propertyId: string): PropertyDefinition | ParseFailure {
  if (!isObject(value) || !isNonEmptyString(value.type)) {
    return fail("MALFORMED_DEFINITION", `${propertyId}: property definition malformed.`);
  }
  if (value.type === "color") {
    if (!isNonEmptyString(value.default)) {
      return fail("MALFORMED_DEFINITION", `${propertyId}: color default required.`);
    }
    return { type: "color", default: value.default };
  }
  if (value.type === "enum") {
    if (!Array.isArray(value.values) || !value.values.every(isNonEmptyString) || !isNonEmptyString(value.default)) {
      return fail("MALFORMED_DEFINITION", `${propertyId}: enum values/default required.`);
    }
    if (!(value.values as string[]).includes(value.default)) {
      return fail("MALFORMED_DEFINITION", `${propertyId}: default must be one of values.`);
    }
    return { type: "enum", values: value.values as string[], default: value.default };
  }
  return fail("MALFORMED_DEFINITION", `${propertyId}: unsupported property type.`);
}

export type PartDefinitionParseResult = { readonly ok: true; readonly definition: PartDefinition } | ParseFailure;

export function parsePartDefinition(value: unknown): PartDefinitionParseResult {
  if (!isObject(value)) {
    return fail("MALFORMED_DEFINITION", "Part Definition must be an object.");
  }
  const allowed = [
    "schemaVersion",
    "definitionId",
    "definitionVersion",
    "displayName",
    "appearance",
    "occupiedSpace",
    "connectionPoints",
    "properties",
    "extensions",
  ] as const;
  if (!hasOnlyKeys(value, allowed)) {
    return fail("MALFORMED_DEFINITION", "Part Definition has missing or unknown top-level fields.");
  }
  if (value.schemaVersion !== "1.0") {
    return fail("UNSUPPORTED_SCHEMA_VERSION", `Part Definition schema ${String(value.schemaVersion)} is unsupported.`);
  }
  if (!isNonEmptyString(value.definitionId) || !value.definitionId.includes(":")) {
    return fail("MALFORMED_DEFINITION", "definitionId must be a namespaced non-empty string.");
  }
  if (!isNonEmptyString(value.definitionVersion) || !isNonEmptyString(value.displayName)) {
    return fail("MALFORMED_DEFINITION", "definitionVersion and displayName are required.");
  }
  if (!isObject(value.appearance) || !isNonEmptyString(value.appearance.asset)) {
    return fail("MALFORMED_DEFINITION", "appearance.asset is required.");
  }
  const appearanceKeys = Object.keys(value.appearance);
  if (appearanceKeys.some((key) => key !== "asset" && key !== "tintProperty")) {
    return fail("MALFORMED_DEFINITION", "appearance has unknown fields.");
  }
  if (!Array.isArray(value.occupiedSpace) || value.occupiedSpace.length < 1) {
    return fail("MALFORMED_DEFINITION", "occupiedSpace requires at least one box.");
  }
  const occupiedSpace: OccupiedSpaceBox[] = [];
  for (const [index, raw] of value.occupiedSpace.entries()) {
    const parsed = parseBox(raw, `occupiedSpace[${index}]`);
    if (!parsed || "ok" in parsed) {
      return parsed as ParseFailure;
    }
    occupiedSpace.push(parsed);
  }
  if (!Array.isArray(value.connectionPoints)) {
    return fail("MALFORMED_DEFINITION", "connectionPoints must be an array.");
  }
  const connectionPoints: ConnectionPointDefinition[] = [];
  const pointIds = new Set<string>();
  for (const raw of value.connectionPoints) {
    const parsed = parseConnectionPoint(raw);
    if ("ok" in parsed) return parsed;
    if (pointIds.has(parsed.pointId)) {
      return fail("MALFORMED_DEFINITION", `Duplicate Connection Point ${parsed.pointId}.`);
    }
    pointIds.add(parsed.pointId);
    connectionPoints.push(parsed);
  }
  if (!isObject(value.properties)) {
    return fail("MALFORMED_DEFINITION", "properties must be an object.");
  }
  const properties: Record<string, PropertyDefinition> = {};
  for (const [propertyId, raw] of Object.entries(value.properties)) {
    const parsed = parseProperty(raw, propertyId);
    if ("ok" in parsed) return parsed;
    properties[propertyId] = parsed;
  }
  if (value.appearance.tintProperty !== undefined) {
    if (!isNonEmptyString(value.appearance.tintProperty) || !(value.appearance.tintProperty in properties)) {
      return fail("MALFORMED_DEFINITION", "appearance.tintProperty must reference a property.");
    }
  }
  if (!isObject(value.extensions)) {
    return fail("MALFORMED_DEFINITION", "extensions must be an object.");
  }
  for (const key of Object.keys(value.extensions)) {
    if (!key.includes(".")) {
      return fail("MALFORMED_DEFINITION", `${key}: extension key must be namespaced.`);
    }
    if (!isJsonValue(value.extensions[key])) {
      return fail("MALFORMED_DEFINITION", `${key}: extension data must be JSON.`);
    }
  }
  return {
    ok: true,
    definition: {
      schemaVersion: "1.0",
      definitionId: value.definitionId,
      definitionVersion: value.definitionVersion,
      displayName: value.displayName,
      appearance: {
        asset: value.appearance.asset,
        ...(value.appearance.tintProperty
          ? { tintProperty: value.appearance.tintProperty as string }
          : {}),
      },
      occupiedSpace,
      connectionPoints,
      properties,
      extensions: value.extensions as Record<string, JsonValue>,
    },
  };
}

function parseSuccessCondition(value: unknown, zoneIds: Set<string>, partIds: Set<string>): SuccessCondition | ParseFailure {
  if (!isObject(value) || !isNonEmptyString(value.conditionId) || !isNonEmptyString(value.type)) {
    return fail("MALFORMED_DEFINITION", "success condition malformed.");
  }
  switch (value.type) {
    case "assembly-spans-zones": {
      if (!Array.isArray(value.zones) || !value.zones.every((z) => typeof z === "string" && zoneIds.has(z))) {
        return fail("MALFORMED_DEFINITION", `${value.conditionId}: unknown Zone reference.`);
      }
      return { conditionId: value.conditionId, type: "assembly-spans-zones", zones: value.zones as string[] };
    }
    case "player-parts-clear-zone": {
      if (!isNonEmptyString(value.zone) || !zoneIds.has(value.zone)) {
        return fail("MALFORMED_DEFINITION", `${value.conditionId}: unknown Zone reference.`);
      }
      return { conditionId: value.conditionId, type: "player-parts-clear-zone", zone: value.zone };
    }
    case "player-part-count": {
      if (!Number.isInteger(value.min) || !Number.isInteger(value.max) || (value.min as number) < 0 || (value.max as number) < (value.min as number)) {
        return fail("MALFORMED_DEFINITION", `${value.conditionId}: invalid Part count range.`);
      }
      return { conditionId: value.conditionId, type: "player-part-count", min: value.min as number, max: value.max as number };
    }
    case "parts-share-assembly": {
      if (!Array.isArray(value.parts) || !value.parts.every((p) => typeof p === "string" && partIds.has(p))) {
        return fail("MALFORMED_DEFINITION", `${value.conditionId}: unknown initial Part reference.`);
      }
      return { conditionId: value.conditionId, type: "parts-share-assembly", parts: value.parts as string[] };
    }
    default:
      return fail("MALFORMED_DEFINITION", `${value.conditionId}: unsupported condition type.`);
  }
}

export type ChallengeDefinitionParseResult =
  | { readonly ok: true; readonly definition: ChallengeDefinition }
  | ParseFailure;

export function parseChallengeDefinition(value: unknown): ChallengeDefinitionParseResult {
  if (!isObject(value)) {
    return fail("MALFORMED_DEFINITION", "Challenge Definition must be an object.");
  }
  const allowed = [
    "schemaVersion",
    "challengeId",
    "challengeVersion",
    "metadata",
    "initialScene",
    "availableParts",
    "zones",
    "successConditions",
    "requiredExtensions",
    "extensions",
  ] as const;
  if (!hasOnlyKeys(value, allowed)) {
    return fail("MALFORMED_DEFINITION", "Challenge Definition has missing or unknown top-level fields.");
  }
  if (value.schemaVersion !== "1.0") {
    return fail("UNSUPPORTED_SCHEMA_VERSION", `Challenge Definition schema ${String(value.schemaVersion)} is unsupported.`);
  }
  if (!isNonEmptyString(value.challengeId) || !value.challengeId.includes(":") || !isNonEmptyString(value.challengeVersion)) {
    return fail("MALFORMED_DEFINITION", "challengeId/challengeVersion invalid.");
  }
  if (
    !isObject(value.metadata) ||
    !hasOnlyKeys(value.metadata, ["title", "prompt", "estimatedMinutes"]) ||
    !isNonEmptyString(value.metadata.title) ||
    !isNonEmptyString(value.metadata.prompt) ||
    typeof value.metadata.estimatedMinutes !== "number" ||
    !Number.isFinite(value.metadata.estimatedMinutes)
  ) {
    return fail("MALFORMED_DEFINITION", "metadata malformed.");
  }
  if (!isObject(value.initialScene) || !hasOnlyKeys(value.initialScene, ["parts", "mechanicalConnections"])) {
    return fail("MALFORMED_DEFINITION", "initialScene malformed.");
  }
  if (!Array.isArray(value.initialScene.parts) || !Array.isArray(value.initialScene.mechanicalConnections)) {
    return fail("MALFORMED_DEFINITION", "initialScene collections malformed.");
  }

  const partIds = new Set<string>();
  const parts = [];
  for (const raw of value.initialScene.parts) {
    if (!isObject(raw) || !hasOnlyKeys(raw, ["id", "definition", "transform", "properties"])) {
      return fail("MALFORMED_DEFINITION", "initial Part malformed.");
    }
    if (!isNonEmptyString(raw.id) || partIds.has(raw.id)) {
      return fail("MALFORMED_DEFINITION", "initial Part IDs must be unique.");
    }
    if (
      !isObject(raw.definition) ||
      !hasOnlyKeys(raw.definition, ["id", "version"]) ||
      !isNonEmptyString(raw.definition.id) ||
      !isNonEmptyString(raw.definition.version)
    ) {
      return fail("MALFORMED_DEFINITION", `initial Part ${raw.id} definition ref invalid.`);
    }
    if (
      !isObject(raw.transform) ||
      !hasOnlyKeys(raw.transform, ["position", "rotation"]) ||
      !isFiniteTuple(raw.transform.position, 3) ||
      !isFiniteTuple(raw.transform.rotation, 4) ||
      !quatIsNormalized(asQuat(raw.transform.rotation))
    ) {
      return fail("MALFORMED_DEFINITION", `initial Part ${raw.id} transform invalid.`);
    }
    if (!isObject(raw.properties) || !isJsonValue(raw.properties)) {
      return fail("MALFORMED_DEFINITION", `initial Part ${raw.id} properties invalid.`);
    }
    partIds.add(raw.id);
    parts.push({
      id: raw.id,
      definition: { id: raw.definition.id, version: raw.definition.version },
      transform: {
        position: asVec3(raw.transform.position),
        rotation: asQuat(raw.transform.rotation),
      },
      properties: raw.properties as Record<string, JsonValue>,
    });
  }

  const connections = [];
  const connectionIds = new Set<string>();
  for (const raw of value.initialScene.mechanicalConnections) {
    if (!isObject(raw) || !hasOnlyKeys(raw, ["id", "a", "b"]) || !isNonEmptyString(raw.id) || connectionIds.has(raw.id)) {
      return fail("MALFORMED_DEFINITION", "initial Mechanical Connection malformed.");
    }
    for (const end of [raw.a, raw.b]) {
      if (!isObject(end) || !hasOnlyKeys(end, ["partId", "connectionPointId"]) || !isNonEmptyString(end.partId) || !isNonEmptyString(end.connectionPointId) || !partIds.has(end.partId)) {
        return fail("MALFORMED_DEFINITION", `Mechanical Connection ${raw.id} endpoint invalid.`);
      }
    }
    connectionIds.add(raw.id);
    connections.push({
      id: raw.id,
      a: raw.a as { partId: string; connectionPointId: string },
      b: raw.b as { partId: string; connectionPointId: string },
    });
  }

  if (!Array.isArray(value.availableParts)) {
    return fail("MALFORMED_DEFINITION", "availableParts must be an array.");
  }
  const availableParts = [];
  for (const raw of value.availableParts) {
    if (!isObject(raw) || !hasOnlyKeys(raw, ["definition", "maxCount"])) {
      return fail("MALFORMED_DEFINITION", "availableParts entry malformed.");
    }
    if (
      !isObject(raw.definition) ||
      !hasOnlyKeys(raw.definition, ["id", "version"]) ||
      !isNonEmptyString(raw.definition.id) ||
      !isNonEmptyString(raw.definition.version)
    ) {
      return fail("MALFORMED_DEFINITION", "availableParts definition ref invalid.");
    }
    if (!(raw.maxCount === null || (Number.isInteger(raw.maxCount) && (raw.maxCount as number) >= 1))) {
      return fail("MALFORMED_DEFINITION", "maxCount must be null or a positive integer.");
    }
    availableParts.push({
      definition: { id: raw.definition.id, version: raw.definition.version },
      maxCount: raw.maxCount as number | null,
    });
  }

  if (!Array.isArray(value.zones)) {
    return fail("MALFORMED_DEFINITION", "zones must be an array.");
  }
  const zoneIds = new Set<string>();
  const zones = [];
  for (const raw of value.zones) {
    if (!isObject(raw) || !hasOnlyKeys(raw, ["zoneId", "volumes"]) || !isNonEmptyString(raw.zoneId) || zoneIds.has(raw.zoneId)) {
      return fail("MALFORMED_DEFINITION", "Zone IDs must be unique.");
    }
    if (!Array.isArray(raw.volumes) || raw.volumes.length < 1) {
      return fail("MALFORMED_DEFINITION", `${raw.zoneId}: at least one volume required.`);
    }
    const volumes = [];
    for (const [index, volume] of raw.volumes.entries()) {
      const parsed = parseBox(volume, `${raw.zoneId}[${index}]`);
      if ("ok" in parsed) return parsed;
      volumes.push(parsed);
    }
    zoneIds.add(raw.zoneId);
    zones.push({ zoneId: raw.zoneId, volumes });
  }

  if (!Array.isArray(value.successConditions) || value.successConditions.length < 1) {
    return fail("MALFORMED_DEFINITION", "at least one success condition is required.");
  }
  const conditionIds = new Set<string>();
  const successConditions: SuccessCondition[] = [];
  for (const raw of value.successConditions) {
    const parsed = parseSuccessCondition(raw, zoneIds, partIds);
    if ("ok" in parsed) return parsed;
    if (conditionIds.has(parsed.conditionId)) {
      return fail("MALFORMED_DEFINITION", "success condition IDs must be unique.");
    }
    conditionIds.add(parsed.conditionId);
    successConditions.push(parsed);
  }

  if (!Array.isArray(value.requiredExtensions) || !value.requiredExtensions.every(isNonEmptyString)) {
    return fail("MALFORMED_DEFINITION", "requiredExtensions must be a string array.");
  }
  if (!isObject(value.extensions)) {
    return fail("MALFORMED_DEFINITION", "extensions must be an object.");
  }
  for (const required of value.requiredExtensions) {
    if (!(required in value.extensions)) {
      return fail("MALFORMED_DEFINITION", `${required}: required extension payload missing.`);
    }
  }
  for (const key of Object.keys(value.extensions)) {
    if (!key.includes(".")) {
      return fail("MALFORMED_DEFINITION", `${key}: extension key must be namespaced.`);
    }
    if (!isJsonValue(value.extensions[key])) {
      return fail("MALFORMED_DEFINITION", `${key}: extension data must be JSON.`);
    }
  }

  return {
    ok: true,
    definition: {
      schemaVersion: "1.0",
      challengeId: value.challengeId,
      challengeVersion: value.challengeVersion,
      metadata: {
        title: value.metadata.title,
        prompt: value.metadata.prompt,
        estimatedMinutes: value.metadata.estimatedMinutes,
      },
      initialScene: { parts, mechanicalConnections: connections },
      availableParts,
      zones,
      successConditions,
      requiredExtensions: value.requiredExtensions as string[],
      extensions: value.extensions as Record<string, JsonValue>,
    },
  };
}
