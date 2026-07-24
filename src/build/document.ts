import type { DefinitionRegistry } from "../definitions/registry.js";
import type { JsonValue, PartDefinitionRef } from "../definitions/types.js";
import { definitionKey } from "../definitions/types.js";
import type { Quat, Vec3 } from "../math/types.js";
import { asQuat, asVec3, quatIsNormalized, quatNormalize } from "../math/types.js";

export const BUILD_FORMAT = "weblocks.build" as const;
export const BUILD_SCHEMA_VERSION = 1 as const;

export type Transform = {
  readonly position: Vec3;
  readonly rotation: Quat;
};

export type PartInstance = {
  readonly id: string;
  readonly definition: PartDefinitionRef;
  readonly transform: Transform;
  readonly properties: Readonly<Record<string, JsonValue>>;
};

export type ConnectionEndpoint = {
  readonly partId: string;
  readonly connectionPointId: string;
};

export type MechanicalConnection = {
  readonly id: string;
  readonly a: ConnectionEndpoint;
  readonly b: ConnectionEndpoint;
};

export type BuildExtension = {
  readonly id: string;
  readonly version: string;
  readonly required: boolean;
  readonly data: JsonValue;
};

export type BuildDocument = {
  readonly format: typeof BUILD_FORMAT;
  readonly schemaVersion: typeof BUILD_SCHEMA_VERSION;
  readonly id: string;
  readonly parts: readonly PartInstance[];
  readonly mechanicalConnections: readonly MechanicalConnection[];
  readonly extensions: readonly BuildExtension[];
};

export type LoadFailureCode =
  | "MALFORMED_BUILD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "MISSING_PART_DEFINITION"
  | "MISSING_CONNECTION_POINT"
  | "UNSUPPORTED_REQUIRED_EXTENSION"
  | "CAPACITY_EXCEEDED";

export type BuildLoadResult =
  | { readonly ok: true; readonly build: BuildDocument; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: LoadFailureCode; readonly message: string };

const objectKeys = {
  build: ["format", "schemaVersion", "id", "parts", "mechanicalConnections", "extensions"],
  part: ["id", "definition", "transform", "properties"],
  definition: ["id", "version"],
  transform: ["position", "rotation"],
  connection: ["id", "a", "b"],
  endpoint: ["partId", "connectionPointId"],
  extension: ["id", "version", "required", "data"],
} as const;

function failure(code: LoadFailureCode, message: string): BuildLoadResult {
  return { ok: false, code, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === allowed.length && actual.every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function extensionKey(extension: BuildExtension): string {
  return `${extension.id}@${extension.version}`;
}

export function serializeBuild(build: BuildDocument): string {
  return `${JSON.stringify(build, null, 2)}\n`;
}

export function loadBuild(source: string, registry: DefinitionRegistry, supportedExtensions?: ReadonlySet<string>): BuildLoadResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return failure("MALFORMED_BUILD", "The file is not valid JSON.");
  }

  if (!isObject(value) || !hasOnlyKeys(value, objectKeys.build)) {
    return failure("MALFORMED_BUILD", "The Build document has missing or unknown top-level fields.");
  }
  if (value.format !== BUILD_FORMAT) {
    return failure("MALFORMED_BUILD", `Expected format ${BUILD_FORMAT}.`);
  }
  if (value.schemaVersion !== BUILD_SCHEMA_VERSION) {
    return failure(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Schema ${String(value.schemaVersion)} is not supported; this reader supports schema ${BUILD_SCHEMA_VERSION}.`,
    );
  }
  if (!isNonEmptyString(value.id) || !Array.isArray(value.parts) || !Array.isArray(value.mechanicalConnections) || !Array.isArray(value.extensions)) {
    return failure("MALFORMED_BUILD", "The Build identity or collections are malformed.");
  }

  const parts: PartInstance[] = [];
  const partIds = new Set<string>();
  const pointsByPart = new Map<string, Readonly<Record<string, number>>>();

  for (const rawPart of value.parts) {
    if (!isObject(rawPart) || !hasOnlyKeys(rawPart, objectKeys.part)) {
      return failure("MALFORMED_BUILD", "A Part instance has missing or unknown fields.");
    }
    const { id, definition, transform, properties } = rawPart;
    if (!isNonEmptyString(id) || partIds.has(id)) {
      return failure("MALFORMED_BUILD", "Part instance IDs must be non-empty and unique.");
    }
    if (!isObject(definition) || !hasOnlyKeys(definition, objectKeys.definition) || !isNonEmptyString(definition.id) || !isNonEmptyString(definition.version)) {
      return failure("MALFORMED_BUILD", `Part ${id} has an invalid Part Definition reference.`);
    }
    if (!isObject(transform) || !hasOnlyKeys(transform, objectKeys.transform) || !isFiniteTuple(transform.position, 3) || !isFiniteTuple(transform.rotation, 4)) {
      return failure("MALFORMED_BUILD", `Part ${id} has an invalid transform.`);
    }
    if (!quatIsNormalized(asQuat(transform.rotation))) {
      return failure("MALFORMED_BUILD", `Part ${id} rotation must be a normalized quaternion.`);
    }
    if (!isObject(properties) || !isJsonValue(properties)) {
      return failure("MALFORMED_BUILD", `Part ${id} properties must contain JSON values only.`);
    }

    const ref = { id: definition.id, version: definition.version };
    const capacities = registry.connectionPointCapacities(ref);
    if (!capacities) {
      return failure("MISSING_PART_DEFINITION", `Part ${id} requires unavailable Part Definition ${definitionKey(ref)}.`);
    }

    partIds.add(id);
    pointsByPart.set(id, capacities);
    parts.push({
      id,
      definition: ref,
      transform: {
        position: asVec3(transform.position),
        rotation: quatNormalize(asQuat(transform.rotation)),
      },
      properties: properties as Record<string, JsonValue>,
    });
  }

  const mechanicalConnections: MechanicalConnection[] = [];
  const connectionIds = new Set<string>();
  const endpointUseCount = new Map<string, number>();

  for (const rawConnection of value.mechanicalConnections) {
    if (!isObject(rawConnection) || !hasOnlyKeys(rawConnection, objectKeys.connection) || !isNonEmptyString(rawConnection.id) || connectionIds.has(rawConnection.id)) {
      return failure("MALFORMED_BUILD", "Mechanical Connection IDs must be non-empty and unique.");
    }
    const endpoints = [rawConnection.a, rawConnection.b];
    const parsedEnds: ConnectionEndpoint[] = [];
    for (const rawEndpoint of endpoints) {
      if (!isObject(rawEndpoint) || !hasOnlyKeys(rawEndpoint, objectKeys.endpoint) || !isNonEmptyString(rawEndpoint.partId) || !isNonEmptyString(rawEndpoint.connectionPointId)) {
        return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} has a malformed endpoint.`);
      }
      const availablePoints = pointsByPart.get(rawEndpoint.partId);
      if (!availablePoints) {
        return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} references missing Part ${rawEndpoint.partId}.`);
      }
      const capacity = availablePoints[rawEndpoint.connectionPointId];
      if (!Number.isInteger(capacity) || (capacity as number) < 1) {
        return failure(
          "MISSING_CONNECTION_POINT",
          `Mechanical Connection ${rawConnection.id} references unavailable Connection Point ${rawEndpoint.partId}/${rawEndpoint.connectionPointId}.`,
        );
      }
      const endpointKey = `${rawEndpoint.partId}/${rawEndpoint.connectionPointId}`;
      const nextUseCount = (endpointUseCount.get(endpointKey) ?? 0) + 1;
      if (nextUseCount > (capacity as number)) {
        return failure("CAPACITY_EXCEEDED", `Connection Point ${endpointKey} exceeds its declared capacity of ${capacity}.`);
      }
      endpointUseCount.set(endpointKey, nextUseCount);
      parsedEnds.push({ partId: rawEndpoint.partId, connectionPointId: rawEndpoint.connectionPointId });
    }
    const [a, b] = parsedEnds as [ConnectionEndpoint, ConnectionEndpoint];
    if (a.partId === b.partId && a.connectionPointId === b.connectionPointId) {
      return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} connects an endpoint to itself.`);
    }
    connectionIds.add(rawConnection.id);
    mechanicalConnections.push({ id: rawConnection.id, a, b });
  }

  const extensions: BuildExtension[] = [];
  const extensionIds = new Set<string>();
  const warnings: string[] = [];
  const supported = supportedExtensions ?? new Set<string>();

  for (const rawExtension of value.extensions) {
    if (
      !isObject(rawExtension) ||
      !hasOnlyKeys(rawExtension, objectKeys.extension) ||
      !isNonEmptyString(rawExtension.id) ||
      !isNonEmptyString(rawExtension.version) ||
      typeof rawExtension.required !== "boolean" ||
      !isJsonValue(rawExtension.data)
    ) {
      return failure("MALFORMED_BUILD", "A Build extension is malformed.");
    }
    const extension = rawExtension as BuildExtension;
    const key = extensionKey(extension);
    if (extensionIds.has(key)) {
      return failure("MALFORMED_BUILD", `Extension ${key} appears more than once.`);
    }
    extensionIds.add(key);
    if (!supported.has(key)) {
      if (extension.required) {
        return failure("UNSUPPORTED_REQUIRED_EXTENSION", `Required extension ${key} is not supported; the Build was not opened.`);
      }
      warnings.push(`Optional extension ${key} was preserved but is inactive.`);
    }
    extensions.push(extension);
  }

  return {
    ok: true,
    build: {
      format: BUILD_FORMAT,
      schemaVersion: BUILD_SCHEMA_VERSION,
      id: value.id,
      parts,
      mechanicalConnections,
      extensions,
    },
    warnings,
  };
}
