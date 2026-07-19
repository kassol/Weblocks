// PROTOTYPE — pure Part Definition validation and editor projection.

const box = (min, max) => ({ shape: "box", min, max });
const frame = (translation, rotation = [0, 0, 0, 1]) => ({ translation, rotation });
const point = (pointId, kind, type, accepts, translation, extra = {}) => ({
  pointId, kind, type, accepts, capacity: 1, frame: frame(translation), ...extra
});

function base(definitionId, definitionVersion, displayName, asset, occupiedSpace, connectionPoints, properties, extensions = {}) {
  return {
    schemaVersion: "1.0",
    definitionId,
    definitionVersion,
    displayName,
    appearance: { asset, tintProperty: Object.hasOwn(properties, "color") ? "color" : undefined },
    occupiedSpace,
    connectionPoints,
    properties,
    extensions
  };
}

const fixed = "weblocks.mechanical.fixed";
const conductive = "weblocks.electrical.conductive";
const rotational = "weblocks.mechanical.rotational";

export const definitions = [
  base(
    "weblocks:brick-2",
    "1",
    "2 单位积木",
    "catalog/brick-2.glb",
    [box([-1, 0, -.5], [1, .6, .5])],
    [
      point("top-left", fixed, "weblocks:stud", ["weblocks:socket"], [-.5, .6, 0], { allowedQuarterTurns: [0, 1, 2, 3] }),
      point("top-right", fixed, "weblocks:stud", ["weblocks:socket"], [.5, .6, 0], { allowedQuarterTurns: [0, 1, 2, 3] }),
      point("bottom-left", fixed, "weblocks:socket", ["weblocks:stud"], [-.5, 0, 0], { frame: frame([-.5, 0, 0], [1, 0, 0, 0]), allowedQuarterTurns: [0, 1, 2, 3] }),
      point("bottom-right", fixed, "weblocks:socket", ["weblocks:stud"], [.5, 0, 0], { frame: frame([.5, 0, 0], [1, 0, 0, 0]), allowedQuarterTurns: [0, 1, 2, 3] })
    ],
    { color: { type: "color", default: "#e04f3f" } }
  ),
  base(
    "weblocks:lamp",
    "1",
    "灯",
    "catalog/lamp.glb",
    [box([-.5, 0, -.5], [.5, 1.2, .5])],
    [
      point("mount", fixed, "weblocks:socket", ["weblocks:stud"], [0, 0, 0], { frame: frame([0, 0, 0], [1, 0, 0, 0]), allowedQuarterTurns: [0, 1, 2, 3] }),
      point("positive", conductive, "weblocks:terminal", ["weblocks:wire-end"], [-.25, .2, .5]),
      point("negative", conductive, "weblocks:terminal", ["weblocks:wire-end"], [.25, .2, .5])
    ],
    { color: { type: "color", default: "#ffd54a" } },
    {
      "weblocks.electrical.v1": {
        component: "lamp",
        terminals: { positive: "positive", negative: "negative" }
      }
    }
  ),
  base(
    "weblocks:fan",
    "1",
    "风扇",
    "catalog/fan.glb",
    [box([-.7, 0, -.25], [.7, 1.4, .25])],
    [
      point("mount", fixed, "weblocks:socket", ["weblocks:stud"], [0, 0, 0], { frame: frame([0, 0, 0], [1, 0, 0, 0]), allowedQuarterTurns: [0, 1, 2, 3] }),
      point("positive", conductive, "weblocks:terminal", ["weblocks:wire-end"], [-.2, .2, .25]),
      point("negative", conductive, "weblocks:terminal", ["weblocks:wire-end"], [.2, .2, .25]),
      point("shaft", rotational, "weblocks:shaft", ["weblocks:bearing"], [0, .8, .25])
    ],
    { direction: { type: "enum", values: ["forward", "reverse"], default: "forward" } },
    {
      "weblocks.electrical.v1": {
        component: "motor",
        terminals: { positive: "positive", negative: "negative" },
        shaftPoint: "shaft",
        directionProperty: "direction"
      }
    }
  ),
  base(
    "weblocks:two-way-switch",
    "1",
    "双控开关",
    "catalog/two-way-switch.glb",
    [box([-.6, 0, -.4], [.6, .8, .4])],
    [
      point("mount", fixed, "weblocks:socket", ["weblocks:stud"], [0, 0, 0], { frame: frame([0, 0, 0], [1, 0, 0, 0]), allowedQuarterTurns: [0, 1, 2, 3] }),
      point("common", conductive, "weblocks:terminal", ["weblocks:wire-end"], [-.3, .2, .4]),
      point("traveler-a", conductive, "weblocks:terminal", ["weblocks:wire-end"], [0, .2, .4]),
      point("traveler-b", conductive, "weblocks:terminal", ["weblocks:wire-end"], [.3, .2, .4])
    ],
    { position: { type: "enum", values: ["a", "b"], default: "a" } },
    {
      "weblocks.electrical.v1": {
        component: "two-way-switch",
        common: "common",
        travelers: ["traveler-a", "traveler-b"],
        positionProperty: "position"
      }
    }
  )
];

function arrayOf(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

export function connectionPointsAreCompatible(left, right) {
  return left.kind === right.kind && left.accepts.includes(right.type) && right.accepts.includes(left.type);
}

export function validateDefinition(definition) {
  const errors = [];
  if (definition.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (!definition.definitionId?.includes(":")) errors.push("definitionId must be namespaced");
  if (!definition.definitionVersion) errors.push("definitionVersion is required");
  if (!definition.appearance?.asset) errors.push("appearance.asset is required");
  if (!definition.occupiedSpace?.length) errors.push("at least one Occupied Space box is required");

  for (const space of definition.occupiedSpace || []) {
    if (space.shape !== "box" || !arrayOf(space.min, 3) || !arrayOf(space.max, 3) || space.min.some((value, axis) => value >= space.max[axis])) {
      errors.push("Occupied Space must be a positive local axis-aligned box");
    }
  }

  const ids = new Set();
  for (const connectionPoint of definition.connectionPoints || []) {
    if (!connectionPoint.pointId || ids.has(connectionPoint.pointId)) errors.push("Connection Point IDs must be unique and non-empty");
    ids.add(connectionPoint.pointId);
    if (!connectionPoint.kind || !connectionPoint.type || !connectionPoint.accepts?.length) errors.push(`${connectionPoint.pointId}: typed compatibility is required`);
    if (!Number.isInteger(connectionPoint.capacity) || connectionPoint.capacity < 1) errors.push(`${connectionPoint.pointId}: capacity must be a positive integer`);
    if (!arrayOf(connectionPoint.frame?.translation, 3) || !arrayOf(connectionPoint.frame?.rotation, 4)) errors.push(`${connectionPoint.pointId}: a full local frame is required`);
    else if (Math.abs(Math.hypot(...connectionPoint.frame.rotation) - 1) > 1e-9) errors.push(`${connectionPoint.pointId}: rotation must be a unit quaternion`);
    if (connectionPoint.kind === fixed && !connectionPoint.allowedQuarterTurns?.length) errors.push(`${connectionPoint.pointId}: fixed mechanical points require allowedQuarterTurns`);
  }

  for (const [propertyId, property] of Object.entries(definition.properties || {})) {
    if (property.type === "enum" && !property.values?.includes(property.default)) errors.push(`${propertyId}: default must be one of values`);
    if (!['color', 'enum'].includes(property.type)) errors.push(`${propertyId}: unsupported property type`);
  }

  if (definition.appearance.tintProperty && !Object.hasOwn(definition.properties, definition.appearance.tintProperty)) errors.push("appearance.tintProperty must reference a property");
  for (const key of Object.keys(definition.extensions || {})) if (!key.includes(".")) errors.push(`${key}: extension key must be namespaced`);
  return errors;
}

const profiles = {
  v1: new Set([fixed]),
  future: new Set([fixed, conductive, rotational])
};

export function projectForEditor(definition, profile = "v1") {
  const supported = profiles[profile];
  const activeConnectionPoints = definition.connectionPoints.filter(connectionPoint => supported.has(connectionPoint.kind));
  const ignoredConnectionPoints = definition.connectionPoints.filter(connectionPoint => !supported.has(connectionPoint.kind));
  return {
    identity: `${definition.definitionId}@${definition.definitionVersion}`,
    asset: definition.appearance.asset,
    occupiedBoxes: definition.occupiedSpace.length,
    activeConnectionPoints,
    ignoredConnectionPoints,
    propertyControls: Object.entries(definition.properties).map(([propertyId, property]) => ({ propertyId, ...property })),
    preservedExtensions: Object.keys(definition.extensions)
  };
}

export function auditDefinitions() {
  const brick = definitions[0];
  return definitions.map(definition => {
    const v1 = projectForEditor(definition, "v1");
    const future = projectForEditor(definition, "future");
    return {
      definitionId: definition.definitionId,
      errors: validateDefinition(definition),
      v1Active: v1.activeConnectionPoints.length,
      v1Ignored: v1.ignoredConnectionPoints.length,
      futureActive: future.activeConnectionPoints.length,
      extensionKeys: v1.preservedExtensions
    };
  }).concat({
    definitionId: "compatibility-probe",
    errors: connectionPointsAreCompatible(brick.connectionPoints[0], brick.connectionPoints[2]) && !connectionPointsAreCompatible(brick.connectionPoints[0], brick.connectionPoints[1]) ? [] : ["typed compatibility failed"],
    v1Active: 0,
    v1Ignored: 0,
    futureActive: 0,
    extensionKeys: []
  });
}
