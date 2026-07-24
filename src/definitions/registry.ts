import { BUILT_IN_PART_DEFINITIONS } from "./bricks.js";
import { parseChallengeDefinition, parsePartDefinition } from "./parse.js";
import {
  challengeKey,
  definitionKey,
  type ChallengeDefinition,
  type PartDefinition,
  type PartDefinitionRef,
} from "./types.js";

export type CapabilitySet = ReadonlySet<string>;

export type RegistryLoadFailure = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

export class DefinitionRegistry {
  readonly #parts = new Map<string, PartDefinition>();
  readonly #challenges = new Map<string, ChallengeDefinition>();
  readonly #supportedCapabilities: CapabilitySet;

  constructor(options?: { supportedCapabilities?: CapabilitySet }) {
    this.#supportedCapabilities = options?.supportedCapabilities ?? new Set(["weblocks.mechanical.fixed"]);
  }

  static withBuiltIns(options?: { supportedCapabilities?: CapabilitySet }): DefinitionRegistry {
    const registry = new DefinitionRegistry(options);
    for (const definition of BUILT_IN_PART_DEFINITIONS) {
      const result = registry.registerPartDefinition(definition);
      if (!result.ok) {
        throw new Error(`Built-in Part Definition failed: ${result.message}`);
      }
    }
    return registry;
  }

  registerPartDefinition(input: unknown): { ok: true; definition: PartDefinition } | RegistryLoadFailure {
    const parsed = parsePartDefinition(input);
    if (!parsed.ok) {
      return parsed;
    }
    const key = definitionKey({ id: parsed.definition.definitionId, version: parsed.definition.definitionVersion });
    if (this.#parts.has(key)) {
      return { ok: false, code: "DUPLICATE_DEFINITION", message: `Part Definition ${key} is already registered.` };
    }
    this.#parts.set(key, parsed.definition);
    return { ok: true, definition: parsed.definition };
  }

  registerChallengeDefinition(input: unknown): { ok: true; definition: ChallengeDefinition } | RegistryLoadFailure {
    const parsed = parseChallengeDefinition(input);
    if (!parsed.ok) {
      return parsed;
    }
    for (const required of parsed.definition.requiredExtensions) {
      if (!this.#supportedCapabilities.has(required)) {
        return {
          ok: false,
          code: "UNSUPPORTED_REQUIRED_EXTENSION",
          message: `Required extension ${required} is not supported; Challenge was not registered for editing.`,
        };
      }
    }
    for (const available of parsed.definition.availableParts) {
      if (!this.resolvePart(available.definition)) {
        return {
          ok: false,
          code: "MISSING_PART_DEFINITION",
          message: `Challenge references unavailable Part Definition ${definitionKey(available.definition)}.`,
        };
      }
    }
    for (const part of parsed.definition.initialScene.parts) {
      if (!this.resolvePart(part.definition)) {
        return {
          ok: false,
          code: "MISSING_PART_DEFINITION",
          message: `Challenge initial Part ${part.id} references unavailable Part Definition ${definitionKey(part.definition)}.`,
        };
      }
    }
    const key = challengeKey(parsed.definition.challengeId, parsed.definition.challengeVersion);
    if (this.#challenges.has(key)) {
      return { ok: false, code: "DUPLICATE_DEFINITION", message: `Challenge Definition ${key} is already registered.` };
    }
    this.#challenges.set(key, parsed.definition);
    return { ok: true, definition: parsed.definition };
  }

  resolvePart(ref: PartDefinitionRef): PartDefinition | undefined {
    return this.#parts.get(definitionKey(ref));
  }

  resolveChallenge(challengeId: string, challengeVersion: string): ChallengeDefinition | undefined {
    return this.#challenges.get(challengeKey(challengeId, challengeVersion));
  }

  /** Catalog projection: hide definitions with no supported Connection Point kinds. */
  listActivatableParts(): readonly PartDefinition[] {
    return [...this.#parts.values()].filter((definition) =>
      definition.connectionPoints.some((point) => this.#supportedCapabilities.has(point.kind)),
    );
  }

  connectionPointCapacities(ref: PartDefinitionRef): Readonly<Record<string, number>> | undefined {
    const definition = this.resolvePart(ref);
    if (!definition) return undefined;
    return Object.fromEntries(definition.connectionPoints.map((point) => [point.pointId, point.capacity]));
  }

  supportedCapabilities(): CapabilitySet {
    return this.#supportedCapabilities;
  }
}
