export type { Vec3, Quat } from "./math/types.js";
export { quatFromYQuarterTurn } from "./math/types.js";

export type {
  PartDefinition,
  ChallengeDefinition,
  PartDefinitionRef,
  SuccessCondition,
} from "./definitions/types.js";
export { BUILT_IN_PART_DEFINITIONS, BRICK_1, BRICK_2, BRICK_4 } from "./definitions/bricks.js";
export { DefinitionRegistry } from "./definitions/registry.js";
export { parsePartDefinition, parseChallengeDefinition } from "./definitions/parse.js";

export type { BuildDocument, PartInstance, MechanicalConnection } from "./build/document.js";
export { loadBuild, serializeBuild, BUILD_FORMAT, BUILD_SCHEMA_VERSION } from "./build/document.js";
export {
  createEmptyBuild,
  placePart,
  movePart,
  deletePart,
  exportBuildSnapshot,
  assembliesOf,
  validateCommittedBuild,
  worldOccupiedBoxes,
} from "./build/core.js";

export { evaluateChallenge } from "./challenge/evaluator.js";
export type { ChallengeEvaluation } from "./challenge/evaluator.js";

export { ApplicationSession } from "./session/application-session.js";
export type { SessionState, SessionResult, RendererEffect, StorageEffect } from "./session/application-session.js";

export { LocalBuildRepository, AUTOSAVE_DEBOUNCE_MS } from "./storage/local-build-repository.js";
export type { SnapshotStore, DebounceScheduler } from "./storage/local-build-repository.js";
