import {
  MECHANICAL_FIXED_KIND,
  SOCKET_TYPE,
  STUD_TYPE,
  type ConnectionPointDefinition,
  type OccupiedSpaceBox,
  type PartDefinition,
} from "./types.js";
import type { Quat, Vec3 } from "../math/types.js";

const IDENTITY: Quat = [0, 0, 0, 1];
/** 180° around X — flips a bottom socket to face down. */
const FLIP_X: Quat = [1, 0, 0, 0];

function box(min: Vec3, max: Vec3): OccupiedSpaceBox {
  return { shape: "box", min, max };
}

function point(
  pointId: string,
  type: string,
  accepts: readonly string[],
  translation: Vec3,
  rotation: Quat = IDENTITY,
  capacity = 1,
): ConnectionPointDefinition {
  return {
    pointId,
    kind: MECHANICAL_FIXED_KIND,
    type,
    accepts,
    capacity,
    frame: { translation, rotation },
    allowedQuarterTurns: [0, 1, 2, 3],
  };
}

function brick(
  definitionId: string,
  displayName: string,
  asset: string,
  occupiedSpace: readonly OccupiedSpaceBox[],
  connectionPoints: readonly ConnectionPointDefinition[],
): PartDefinition {
  return {
    schemaVersion: "1.0",
    definitionId,
    definitionVersion: "1.0.0",
    displayName,
    appearance: { asset, tintProperty: "color" },
    occupiedSpace,
    connectionPoints,
    properties: {
      color: { type: "color", default: "#e04f3f" },
    },
    extensions: {},
  };
}

/** 1×1×1 cell Brick: one stud on top, one socket on bottom. */
export const BRICK_1: PartDefinition = brick(
  "weblocks:brick-1",
  "1 单位积木",
  "catalog/brick-1.glb",
  [box([-0.5, 0, -0.5], [0.5, 0.6, 0.5])],
  [
    point("top", STUD_TYPE, [SOCKET_TYPE], [0, 0.6, 0]),
    point("bottom", SOCKET_TYPE, [STUD_TYPE], [0, 0, 0], FLIP_X),
  ],
);

/** 2-unit Brick along +X. */
export const BRICK_2: PartDefinition = brick(
  "weblocks:brick-2",
  "2 单位积木",
  "catalog/brick-2.glb",
  [box([-1, 0, -0.5], [1, 0.6, 0.5])],
  [
    point("top-left", STUD_TYPE, [SOCKET_TYPE], [-0.5, 0.6, 0]),
    point("top-right", STUD_TYPE, [SOCKET_TYPE], [0.5, 0.6, 0]),
    point("bottom-left", SOCKET_TYPE, [STUD_TYPE], [-0.5, 0, 0], FLIP_X),
    point("bottom-right", SOCKET_TYPE, [STUD_TYPE], [0.5, 0, 0], FLIP_X),
  ],
);

/** 4-unit Brick along +X. */
export const BRICK_4: PartDefinition = brick(
  "weblocks:brick-4",
  "4 单位积木",
  "catalog/brick-4.glb",
  [box([-2, 0, -0.5], [2, 0.6, 0.5])],
  [
    point("top-0", STUD_TYPE, [SOCKET_TYPE], [-1.5, 0.6, 0]),
    point("top-1", STUD_TYPE, [SOCKET_TYPE], [-0.5, 0.6, 0]),
    point("top-2", STUD_TYPE, [SOCKET_TYPE], [0.5, 0.6, 0]),
    point("top-3", STUD_TYPE, [SOCKET_TYPE], [1.5, 0.6, 0]),
    point("bottom-0", SOCKET_TYPE, [STUD_TYPE], [-1.5, 0, 0], FLIP_X),
    point("bottom-1", SOCKET_TYPE, [STUD_TYPE], [-0.5, 0, 0], FLIP_X),
    point("bottom-2", SOCKET_TYPE, [STUD_TYPE], [0.5, 0, 0], FLIP_X),
    point("bottom-3", SOCKET_TYPE, [STUD_TYPE], [1.5, 0, 0], FLIP_X),
  ],
);

export const BUILT_IN_PART_DEFINITIONS: readonly PartDefinition[] = [BRICK_1, BRICK_2, BRICK_4];
