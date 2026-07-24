import {
  createEmptyBuild,
  deletePart,
  exportBuildSnapshot,
  movePart,
  placePart,
  validateCommittedBuild,
  type EditRejection,
} from "../build/core.js";
import { loadBuild, type BuildDocument, type PartInstance, type Transform } from "../build/document.js";
import type { DefinitionRegistry } from "../definitions/registry.js";
import { definitionKey, type ChallengeDefinition, type JsonValue, type PartDefinitionRef } from "../definitions/types.js";
import { evaluateChallenge, type ChallengeEvaluation } from "../challenge/evaluator.js";
import { quatFromYQuarterTurn, type Quat, type Vec3 } from "../math/types.js";

export type InteractionMode = "browsing" | "holding-new" | "holding-existing";

export type Activity =
  | { readonly kind: "free-build" }
  | {
      readonly kind: "challenge";
      readonly challengeId: string;
      readonly challengeVersion: string;
      readonly initialPartIds: ReadonlySet<string>;
    };

export type HeldNewPart = {
  readonly definition: PartDefinitionRef;
  readonly transform: Transform;
  readonly properties: Readonly<Record<string, JsonValue>>;
};

export type HeldExistingPart = {
  readonly partId: string;
  readonly origin: Transform;
  readonly transform: Transform;
};

export type SessionState = {
  readonly activity: Activity;
  readonly mode: InteractionMode;
  readonly build: BuildDocument;
  readonly heldNew?: HeldNewPart;
  readonly heldExisting?: HeldExistingPart;
  readonly challengeSuccess: boolean;
  readonly lastEvaluation?: ChallengeEvaluation;
};

export type RendererEffect =
  | { readonly type: "rebuild-scene" }
  | { readonly type: "update-ghost"; readonly transform: Transform; readonly legal: boolean }
  | { readonly type: "clear-ghost" }
  | { readonly type: "acknowledge-placement"; readonly partId: string }
  | { readonly type: "challenge-success" };

export type StorageEffect = {
  readonly type: "persist-committed-build";
  readonly snapshot: string;
};

export type SessionSuccess = {
  readonly ok: true;
  readonly state: SessionState;
  readonly rendererEffects: readonly RendererEffect[];
  readonly storageEffects: readonly StorageEffect[];
};

export type SessionRejection = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly state: SessionState;
};

export type SessionResult = SessionSuccess | SessionRejection;

function success(
  state: SessionState,
  rendererEffects: readonly RendererEffect[] = [],
  storageEffects: readonly StorageEffect[] = [],
): SessionSuccess {
  return { ok: true, state, rendererEffects, storageEffects };
}

function reject(state: SessionState, code: string, message: string): SessionRejection {
  return { ok: false, code, message, state };
}

function browsing(state: SessionState, build: BuildDocument = state.build): SessionState {
  return {
    activity: state.activity,
    mode: "browsing",
    build,
    challengeSuccess: state.challengeSuccess,
    ...(state.lastEvaluation ? { lastEvaluation: state.lastEvaluation } : {}),
  };
}

function reevaluate(state: SessionState, registry: DefinitionRegistry, challenge: ChallengeDefinition | undefined): SessionState {
  if (!challenge || state.activity.kind !== "challenge") {
    return browsing(state);
  }
  const evaluation = evaluateChallenge(challenge, state.build, registry);
  return {
    ...browsing(state),
    challengeSuccess: evaluation.passed,
    lastEvaluation: evaluation,
  };
}

function committedEffects(previous: BuildDocument, next: BuildDocument): StorageEffect[] {
  const before = exportBuildSnapshot(previous);
  const after = exportBuildSnapshot(next);
  if (before === after) return [];
  return [{ type: "persist-committed-build", snapshot: after }];
}

function defaultProperties(registry: DefinitionRegistry, ref: PartDefinitionRef): Record<string, JsonValue> {
  const definition = registry.resolvePart(ref);
  if (!definition) return {};
  const properties: Record<string, JsonValue> = {};
  for (const [key, property] of Object.entries(definition.properties)) {
    properties[key] = property.default;
  }
  return properties;
}

export class ApplicationSession {
  #state: SessionState;
  readonly #registry: DefinitionRegistry;

  private constructor(registry: DefinitionRegistry, state: SessionState) {
    this.#registry = registry;
    this.#state = state;
  }

  static startFreeBuild(registry: DefinitionRegistry, buildId = "build-1"): ApplicationSession {
    return new ApplicationSession(registry, {
      activity: { kind: "free-build" },
      mode: "browsing",
      build: createEmptyBuild(buildId),
      challengeSuccess: false,
    });
  }

  static startChallenge(
    registry: DefinitionRegistry,
    challengeId: string,
    challengeVersion: string,
    buildId = "build-1",
  ): { ok: true; session: ApplicationSession; result: SessionSuccess } | SessionRejection {
    const challenge = registry.resolveChallenge(challengeId, challengeVersion);
    if (!challenge) {
      const empty = ApplicationSession.startFreeBuild(registry, buildId);
      return reject(empty.state, "MISSING_CHALLENGE", `Challenge ${challengeId}@${challengeVersion} is unavailable.`);
    }

    let build = createEmptyBuild(buildId);
    for (const part of challenge.initialScene.parts) {
      const placed = placePart(build, registry, {
        id: part.id,
        definition: part.definition,
        transform: part.transform,
        properties: part.properties,
      });
      if (!placed.ok) {
        const empty = ApplicationSession.startFreeBuild(registry, buildId);
        return reject(empty.state, placed.code, `Initial scene rejected: ${placed.message}`);
      }
      build = placed.build;
    }

    for (const connection of challenge.initialScene.mechanicalConnections) {
      const present = build.mechanicalConnections.some(
        (entry) =>
          (entry.a.partId === connection.a.partId &&
            entry.a.connectionPointId === connection.a.connectionPointId &&
            entry.b.partId === connection.b.partId &&
            entry.b.connectionPointId === connection.b.connectionPointId) ||
          (entry.a.partId === connection.b.partId &&
            entry.a.connectionPointId === connection.b.connectionPointId &&
            entry.b.partId === connection.a.partId &&
            entry.b.connectionPointId === connection.a.connectionPointId),
      );
      if (!present) {
        build = {
          ...build,
          mechanicalConnections: [
            ...build.mechanicalConnections,
            { id: connection.id, a: connection.a, b: connection.b },
          ],
        };
      }
    }

    const validated = validateCommittedBuild(build, registry);
    if (!validated.ok) {
      const empty = ApplicationSession.startFreeBuild(registry, buildId);
      return reject(empty.state, validated.code, `Initial scene rejected: ${validated.message}`);
    }
    build = validated.build;

    const session = new ApplicationSession(registry, {
      activity: {
        kind: "challenge",
        challengeId,
        challengeVersion,
        initialPartIds: new Set(challenge.initialScene.parts.map((part) => part.id)),
      },
      mode: "browsing",
      build,
      challengeSuccess: false,
    });
    session.#state = reevaluate(session.#state, registry, challenge);
    const result = success(session.#state, [{ type: "rebuild-scene" }]);
    return { ok: true, session, result };
  }

  get state(): SessionState {
    return this.#state;
  }

  #challenge(): ChallengeDefinition | undefined {
    if (this.#state.activity.kind !== "challenge") return undefined;
    return this.#registry.resolveChallenge(this.#state.activity.challengeId, this.#state.activity.challengeVersion);
  }

  #inventoryRemaining(ref: PartDefinitionRef): number | null {
    const challenge = this.#challenge();
    if (!challenge) return null;
    const available = challenge.availableParts.find((entry) => definitionKey(entry.definition) === definitionKey(ref));
    if (!available) return 0;
    if (available.maxCount === null) return null;
    const used = this.#state.build.parts.filter(
      (part) =>
        definitionKey(part.definition) === definitionKey(ref) &&
        (this.#state.activity.kind !== "challenge" || !this.#state.activity.initialPartIds.has(part.id)),
    ).length;
    return Math.max(0, available.maxCount - used);
  }

  pickNewPart(ref: PartDefinitionRef, position: Vec3 = [0, 0, 0], yawTurns = 0): SessionResult {
    if (this.#state.mode !== "browsing") {
      return reject(this.#state, "INVALID_MODE", "Can only pick a new Part while browsing.");
    }
    if (!this.#registry.resolvePart(ref)) {
      return reject(this.#state, "MISSING_PART_DEFINITION", `Unavailable Part Definition ${definitionKey(ref)}.`);
    }
    if (this.#state.activity.kind === "challenge") {
      const remaining = this.#inventoryRemaining(ref);
      if (remaining === 0) {
        return reject(this.#state, "INVENTORY_EMPTY", `No remaining inventory for ${definitionKey(ref)}.`);
      }
    }
    const transform: Transform = { position, rotation: quatFromYQuarterTurn(yawTurns) };
    this.#state = {
      activity: this.#state.activity,
      mode: "holding-new",
      build: this.#state.build,
      challengeSuccess: this.#state.challengeSuccess,
      heldNew: {
        definition: ref,
        transform,
        properties: defaultProperties(this.#registry, ref),
      },
      ...(this.#state.lastEvaluation ? { lastEvaluation: this.#state.lastEvaluation } : {}),
    };
    return success(this.#state, [{ type: "update-ghost", transform, legal: false }]);
  }

  pickExistingPart(partId: string): SessionResult {
    if (this.#state.mode !== "browsing") {
      return reject(this.#state, "INVALID_MODE", "Can only pick an existing Part while browsing.");
    }
    if (this.#state.activity.kind === "challenge" && this.#state.activity.initialPartIds.has(partId)) {
      return reject(this.#state, "AUTHOR_PART_LOCKED", `Authored Part ${partId} cannot be picked up.`);
    }
    const part = this.#state.build.parts.find((entry) => entry.id === partId);
    if (!part) {
      return reject(this.#state, "UNKNOWN_PART", `Part ${partId} does not exist.`);
    }
    this.#state = {
      activity: this.#state.activity,
      mode: "holding-existing",
      build: this.#state.build,
      challengeSuccess: this.#state.challengeSuccess,
      heldExisting: { partId, origin: part.transform, transform: part.transform },
      ...(this.#state.lastEvaluation ? { lastEvaluation: this.#state.lastEvaluation } : {}),
    };
    return success(this.#state, [{ type: "update-ghost", transform: part.transform, legal: true }]);
  }

  updateHeldTransform(transform: Transform): SessionResult {
    if (this.#state.mode === "holding-new" && this.#state.heldNew) {
      const ghost: PartInstance = {
        id: "__ghost__",
        definition: this.#state.heldNew.definition,
        transform,
        properties: this.#state.heldNew.properties,
      };
      const preview = placePart(this.#state.build, this.#registry, ghost);
      this.#state = {
        ...this.#state,
        heldNew: { ...this.#state.heldNew, transform },
      };
      return success(this.#state, [{ type: "update-ghost", transform, legal: preview.ok }]);
    }
    if (this.#state.mode === "holding-existing" && this.#state.heldExisting) {
      const preview = movePart(this.#state.build, this.#registry, this.#state.heldExisting.partId, transform);
      this.#state = {
        ...this.#state,
        heldExisting: { ...this.#state.heldExisting, transform },
      };
      return success(this.#state, [{ type: "update-ghost", transform, legal: preview.ok }]);
    }
    return reject(this.#state, "INVALID_MODE", "No held Part to update.");
  }

  rotateHeld(deltaQuarterTurns: 1 | -1): SessionResult {
    const heldTransform = this.#state.heldNew?.transform ?? this.#state.heldExisting?.transform;
    if (!heldTransform) {
      return reject(this.#state, "INVALID_MODE", "No held Part to rotate.");
    }
    const current = yawTurnsOf(heldTransform.rotation);
    const next = ((current + deltaQuarterTurns) % 4 + 4) % 4;
    return this.updateHeldTransform({
      position: heldTransform.position,
      rotation: quatFromYQuarterTurn(next),
    });
  }

  cancelOrPutBack(): SessionResult {
    if (this.#state.mode === "holding-new") {
      this.#state = browsing(this.#state);
      return success(this.#state, [{ type: "clear-ghost" }]);
    }
    if (this.#state.mode === "holding-existing" && this.#state.heldExisting) {
      const restored = movePart(
        this.#state.build,
        this.#registry,
        this.#state.heldExisting.partId,
        this.#state.heldExisting.origin,
      );
      const build = restored.ok ? restored.build : this.#state.build;
      this.#state = browsing(this.#state, build);
      return success(this.#state, [{ type: "clear-ghost" }, { type: "rebuild-scene" }]);
    }
    return reject(this.#state, "INVALID_MODE", "Nothing to cancel.");
  }

  deleteHeld(): SessionResult {
    if (this.#state.mode !== "holding-existing" || !this.#state.heldExisting) {
      return reject(this.#state, "INVALID_MODE", "Only a held existing Part can be deleted.");
    }
    const previous = this.#state.build;
    const deleted = deletePart(previous, this.#registry, this.#state.heldExisting.partId);
    if (!deleted.ok) {
      return reject(this.#state, deleted.code, deleted.message);
    }
    this.#state = reevaluate(browsing(this.#state, deleted.build), this.#registry, this.#challenge());
    const effects: RendererEffect[] = [{ type: "clear-ghost" }, { type: "rebuild-scene" }];
    if (this.#state.challengeSuccess) effects.push({ type: "challenge-success" });
    return success(this.#state, effects, committedEffects(previous, deleted.build));
  }

  commitHeld(partId?: string): SessionResult {
    const previous = this.#state.build;
    if (this.#state.mode === "holding-new" && this.#state.heldNew) {
      const id = partId ?? `part-${previous.parts.length + 1}`;
      const placed = placePart(previous, this.#registry, {
        id,
        definition: this.#state.heldNew.definition,
        transform: this.#state.heldNew.transform,
        properties: this.#state.heldNew.properties,
      });
      if (!placed.ok) {
        return rejectFromEdit(this.#state, placed);
      }
      this.#state = reevaluate(browsing(this.#state, placed.build), this.#registry, this.#challenge());
      const rendererEffects: RendererEffect[] = [
        { type: "clear-ghost" },
        { type: "rebuild-scene" },
        { type: "acknowledge-placement", partId: id },
      ];
      if (this.#state.challengeSuccess) rendererEffects.push({ type: "challenge-success" });
      return success(this.#state, rendererEffects, committedEffects(previous, placed.build));
    }

    if (this.#state.mode === "holding-existing" && this.#state.heldExisting) {
      const moved = movePart(
        previous,
        this.#registry,
        this.#state.heldExisting.partId,
        this.#state.heldExisting.transform,
      );
      if (!moved.ok) {
        return rejectFromEdit(this.#state, moved);
      }
      this.#state = reevaluate(browsing(this.#state, moved.build), this.#registry, this.#challenge());
      const rendererEffects: RendererEffect[] = [{ type: "clear-ghost" }, { type: "rebuild-scene" }];
      if (this.#state.challengeSuccess) rendererEffects.push({ type: "challenge-success" });
      return success(this.#state, rendererEffects, committedEffects(previous, moved.build));
    }

    return reject(this.#state, "INVALID_MODE", "No held Part to commit.");
  }

  importBuild(source: string): SessionResult {
    const loaded = loadBuild(source, this.#registry);
    if (!loaded.ok) {
      return reject(this.#state, loaded.code, loaded.message);
    }
    const previous = this.#state.build;
    this.#state = reevaluate(browsing(this.#state, loaded.build), this.#registry, this.#challenge());
    return success(this.#state, [{ type: "rebuild-scene" }], committedEffects(previous, loaded.build));
  }

  exportBuild(): string {
    return exportBuildSnapshot(this.#state.build);
  }
}

function rejectFromEdit(state: SessionState, edit: EditRejection): SessionRejection {
  return reject(state, edit.code, edit.message);
}

function yawTurnsOf(rotation: Quat): number {
  for (let turn = 0; turn < 4; turn += 1) {
    const candidate = quatFromYQuarterTurn(turn);
    if (
      Math.abs(candidate[0] - rotation[0]) < 1e-4 &&
      Math.abs(candidate[1] - rotation[1]) < 1e-4 &&
      Math.abs(candidate[2] - rotation[2]) < 1e-4 &&
      Math.abs(candidate[3] - rotation[3]) < 1e-4
    ) {
      return turn;
    }
    if (
      Math.abs(candidate[0] + rotation[0]) < 1e-4 &&
      Math.abs(candidate[1] + rotation[1]) < 1e-4 &&
      Math.abs(candidate[2] + rotation[2]) < 1e-4 &&
      Math.abs(candidate[3] + rotation[3]) < 1e-4
    ) {
      return turn;
    }
  }
  return 0;
}
