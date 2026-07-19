export const BUILD_FORMAT = "weblocks.build";
export const BUILD_SCHEMA_VERSION = 1;
export const AUTOSAVE_DEBOUNCE_MS = 500;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PartDefinitionRef = {
  id: string;
  version: string;
};

export type Transform = {
  position: [number, number, number];
  rotation: [number, number, number, number];
};

export type PartInstance = {
  id: string;
  definition: PartDefinitionRef;
  transform: Transform;
  properties: Record<string, JsonValue>;
};

export type ConnectionEndpoint = {
  partId: string;
  connectionPointId: string;
};

export type MechanicalConnection = {
  id: string;
  a: ConnectionEndpoint;
  b: ConnectionEndpoint;
};

export type BuildExtension = {
  id: string;
  version: string;
  required: boolean;
  data: JsonValue;
};

export type Build = {
  format: typeof BUILD_FORMAT;
  schemaVersion: typeof BUILD_SCHEMA_VERSION;
  id: string;
  parts: PartInstance[];
  mechanicalConnections: MechanicalConnection[];
  extensions: BuildExtension[];
};

export type PartCatalog = Record<string, readonly string[]>;

export type LoadOptions = {
  catalog: PartCatalog;
  supportedExtensions?: ReadonlySet<string>;
};

export type LoadFailureCode =
  | "MALFORMED_BUILD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNSUPPORTED_REQUIRED_EXTENSION"
  | "MISSING_PART_DEFINITION"
  | "MISSING_CONNECTION_POINT";

export type LoadResult =
  | { ok: true; build: Build; warnings: string[] }
  | { ok: false; code: LoadFailureCode; message: string };

const objectKeys = {
  build: ["format", "schemaVersion", "id", "parts", "mechanicalConnections", "extensions"],
  part: ["id", "definition", "transform", "properties"],
  definition: ["id", "version"],
  transform: ["position", "rotation"],
  connection: ["id", "a", "b"],
  endpoint: ["partId", "connectionPointId"],
  extension: ["id", "version", "required", "data"],
} as const;

function failure(code: LoadFailureCode, message: string): LoadResult {
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
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function definitionKey(ref: PartDefinitionRef): string {
  return `${ref.id}@${ref.version}`;
}

function extensionKey(extension: BuildExtension): string {
  return `${extension.id}@${extension.version}`;
}

export function serializeBuild(build: Build): string {
  return `${JSON.stringify(build, null, 2)}\n`;
}

export function loadBuild(source: string, options: LoadOptions): LoadResult {
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

  const partIds = new Set<string>();
  const pointIdsByPart = new Map<string, ReadonlySet<string>>();
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
    const rotationLength = Math.hypot(...transform.rotation);
    if (Math.abs(rotationLength - 1) > 0.001) {
      return failure("MALFORMED_BUILD", `Part ${id} rotation must be a normalized quaternion.`);
    }
    if (!isObject(properties) || !isJsonValue(properties)) {
      return failure("MALFORMED_BUILD", `Part ${id} properties must contain JSON values only.`);
    }

    const ref = definition as PartDefinitionRef;
    const points = options.catalog[definitionKey(ref)];
    if (!points) {
      return failure("MISSING_PART_DEFINITION", `Part ${id} requires unavailable Part Definition ${definitionKey(ref)}.`);
    }
    partIds.add(id);
    pointIdsByPart.set(id, new Set(points));
  }

  const connectionIds = new Set<string>();
  const occupiedEndpoints = new Set<string>();
  for (const rawConnection of value.mechanicalConnections) {
    if (!isObject(rawConnection) || !hasOnlyKeys(rawConnection, objectKeys.connection) || !isNonEmptyString(rawConnection.id) || connectionIds.has(rawConnection.id)) {
      return failure("MALFORMED_BUILD", "Mechanical Connection IDs must be non-empty and unique.");
    }
    const endpoints = [rawConnection.a, rawConnection.b];
    for (const rawEndpoint of endpoints) {
      if (!isObject(rawEndpoint) || !hasOnlyKeys(rawEndpoint, objectKeys.endpoint) || !isNonEmptyString(rawEndpoint.partId) || !isNonEmptyString(rawEndpoint.connectionPointId)) {
        return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} has a malformed endpoint.`);
      }
      const availablePoints = pointIdsByPart.get(rawEndpoint.partId);
      if (!availablePoints) {
        return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} references missing Part ${rawEndpoint.partId}.`);
      }
      if (!availablePoints.has(rawEndpoint.connectionPointId)) {
        return failure(
          "MISSING_CONNECTION_POINT",
          `Mechanical Connection ${rawConnection.id} references unavailable Connection Point ${rawEndpoint.partId}/${rawEndpoint.connectionPointId}.`,
        );
      }
      const endpointKey = `${rawEndpoint.partId}/${rawEndpoint.connectionPointId}`;
      if (occupiedEndpoints.has(endpointKey)) {
        return failure("MALFORMED_BUILD", `Connection Point ${endpointKey} exceeds its V1 capacity of one.`);
      }
      occupiedEndpoints.add(endpointKey);
    }
    const a = rawConnection.a as ConnectionEndpoint;
    const b = rawConnection.b as ConnectionEndpoint;
    if (a.partId === b.partId && a.connectionPointId === b.connectionPointId) {
      return failure("MALFORMED_BUILD", `Mechanical Connection ${rawConnection.id} connects an endpoint to itself.`);
    }
    connectionIds.add(rawConnection.id);
  }

  const extensionIds = new Set<string>();
  const warnings: string[] = [];
  const supportedExtensions = options.supportedExtensions ?? new Set<string>();
  for (const rawExtension of value.extensions) {
    if (!isObject(rawExtension) || !hasOnlyKeys(rawExtension, objectKeys.extension) || !isNonEmptyString(rawExtension.id) || !isNonEmptyString(rawExtension.version) || typeof rawExtension.required !== "boolean" || !isJsonValue(rawExtension.data)) {
      return failure("MALFORMED_BUILD", "A Build extension is malformed.");
    }
    const extension = rawExtension as BuildExtension;
    const key = extensionKey(extension);
    if (extensionIds.has(key)) {
      return failure("MALFORMED_BUILD", `Extension ${key} appears more than once.`);
    }
    extensionIds.add(key);
    if (!supportedExtensions.has(key)) {
      if (extension.required) {
        return failure("UNSUPPORTED_REQUIRED_EXTENSION", `Required extension ${key} is not supported; the Build was not opened.`);
      }
      warnings.push(`Optional extension ${key} was preserved but is inactive.`);
    }
  }

  return { ok: true, build: value as Build, warnings };
}

export type LocalBuildState = {
  pending?: { dueAtMs: number; snapshot: string };
  stored?: { revision: number; snapshot: string };
};

export function scheduleCommittedBuild(state: LocalBuildState, build: Build, nowMs: number): LocalBuildState {
  return {
    ...state,
    pending: {
      dueAtMs: nowMs + AUTOSAVE_DEBOUNCE_MS,
      snapshot: serializeBuild(build),
    },
  };
}

export function advanceAutosave(state: LocalBuildState, nowMs: number): LocalBuildState {
  if (!state.pending || nowMs < state.pending.dueAtMs) return state;
  return {
    stored: {
      revision: (state.stored?.revision ?? 0) + 1,
      snapshot: state.pending.snapshot,
    },
  };
}

export function resumeLatest(state: LocalBuildState, options: LoadOptions): LoadResult | undefined {
  return state.stored ? loadBuild(state.stored.snapshot, options) : undefined;
}
