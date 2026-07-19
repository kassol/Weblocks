// PROTOTYPE — pure Challenge Definition validation and capability projection.

const partRef = (definitionId, version = "1") => ({ definitionId, version });
const transform = (translation, rotation = [0, 0, 0, 1]) => ({ translation, rotation });
const scenePart = (partId, definition, translation, properties = {}) => ({ partId, definition, transform: transform(translation), properties });
const zone = (zoneId, min, max) => ({ zoneId, volumes: [{ shape: "box", min, max }] });

const coreConditions = new Set([
  "assembly-spans-zones",
  "player-parts-clear-zone",
  "player-part-count",
  "parts-share-assembly"
]);

const profiles = {
  v1: { extensions: new Set(), conditions: coreConditions },
  future: { extensions: new Set(["weblocks.electrical.v1"]), conditions: new Set([...coreConditions, "weblocks.electrical.closed-circuit"]) }
};

function challenge(challengeId, title, prompt, initialScene, availableParts, zones, successConditions, extra = {}) {
  return {
    schemaVersion: "1.0",
    challengeId,
    challengeVersion: "1",
    metadata: { title, prompt, estimatedMinutes: 20 },
    initialScene,
    availableParts,
    zones,
    successConditions,
    requiredExtensions: extra.requiredExtensions || [],
    extensions: extra.extensions || {}
  };
}

export const challenges = [
  challenge(
    "weblocks:connect-two-zones",
    "连接两端",
    "用任意结构把左右两端连成一个组件。",
    {
      parts: [
        scenePart("left-anchor", partRef("weblocks:brick-1"), [-3, 0, 0], { color: "#5f8dd3" }),
        scenePart("right-anchor", partRef("weblocks:brick-1"), [3, 0, 0], { color: "#5f8dd3" })
      ],
      connections: []
    },
    [
      { definition: partRef("weblocks:brick-1"), maxCount: 4 },
      { definition: partRef("weblocks:brick-2"), maxCount: 6 }
    ],
    [zone("left", [-3.5, 0, -.75], [-2.5, 1.5, .75]), zone("right", [2.5, 0, -.75], [3.5, 1.5, .75])],
    [
      { conditionId: "span", type: "assembly-spans-zones", zones: ["left", "right"] },
      { conditionId: "budget", type: "player-part-count", min: 1, max: 6 }
    ]
  ),
  challenge(
    "weblocks:avoid-garden",
    "绕开花坛",
    "连接起点和终点，但不要让玩家添加的部件进入花坛体积。",
    {
      parts: [
        scenePart("start-marker", partRef("weblocks:brick-1"), [-3, 0, 0], { color: "#4fa66f" }),
        scenePart("end-marker", partRef("weblocks:brick-1"), [3, 0, 0], { color: "#4fa66f" })
      ],
      connections: []
    },
    [{ definition: partRef("weblocks:brick-2"), maxCount: null }],
    [
      zone("start", [-3.5, 0, -.75], [-2.5, 1.5, .75]),
      zone("end", [2.5, 0, -.75], [3.5, 1.5, .75]),
      zone("garden", [-1, 0, -1], [1, 1, 1])
    ],
    [
      { conditionId: "span", type: "assembly-spans-zones", zones: ["start", "end"] },
      { conditionId: "clear", type: "player-parts-clear-zone", zone: "garden" }
    ]
  ),
  challenge(
    "weblocks:connect-flag",
    "连接旗帜",
    "让底座和旗帜通过机械连接进入同一组件。",
    {
      parts: [
        scenePart("base", partRef("weblocks:brick-1"), [-2, 0, 0], { color: "#d98044" }),
        scenePart("flag-post", partRef("weblocks:brick-2"), [2, 0, 0], { color: "#d98044" }),
        scenePart("flag", partRef("weblocks:flag"), [2, .6, 0], { color: "#e34d59" })
      ],
      connections: [{
        connectionId: "flag-on-post",
        kind: "weblocks.mechanical.fixed",
        a: { partId: "flag-post", pointId: "top-left" },
        b: { partId: "flag", pointId: "mount" }
      }]
    },
    [{ definition: partRef("weblocks:brick-2"), maxCount: 4 }],
    [],
    [
      { conditionId: "connected", type: "parts-share-assembly", parts: ["base", "flag"] },
      { conditionId: "budget", type: "player-part-count", min: 1, max: 4 }
    ]
  ),
  challenge(
    "local:light-the-lamp-demo",
    "点亮小屋（未来示例）",
    "连接电源、双控开关和灯，使电路闭合。",
    {
      parts: [
        scenePart("switch", partRef("weblocks:two-way-switch"), [-1, 0, 0], { position: "a" }),
        scenePart("lamp", partRef("weblocks:lamp"), [1, 0, 0], { color: "#ffd54a" })
      ],
      connections: []
    },
    [{ definition: partRef("weblocks:wire"), maxCount: 6 }],
    [],
    [{
      conditionId: "closed-circuit",
      type: "weblocks.electrical.closed-circuit",
      extension: "weblocks.electrical.v1",
      parts: ["switch", "lamp"]
    }],
    {
      requiredExtensions: ["weblocks.electrical.v1"],
      extensions: { "weblocks.electrical.v1": { circuitMode: "steady-state" } }
    }
  )
];

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function exactPartRef(reference) {
  return reference?.definitionId?.includes(":") && Boolean(reference.version);
}

export function validateChallenge(definition) {
  const errors = [];
  if (definition.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (!definition.challengeId?.includes(":")) errors.push("challengeId must be namespaced");
  if (!definition.challengeVersion) errors.push("challengeVersion is required");
  if (!definition.metadata?.title || !definition.metadata?.prompt) errors.push("title and prompt are required");
  if (!(definition.metadata?.estimatedMinutes > 0)) errors.push("estimatedMinutes must be positive");

  const partIds = new Set();
  for (const part of definition.initialScene?.parts || []) {
    if (!part.partId || partIds.has(part.partId)) errors.push("initial Part IDs must be unique and non-empty");
    partIds.add(part.partId);
    if (!exactPartRef(part.definition)) errors.push(`${part.partId}: exact Part Definition reference required`);
    if (!finiteArray(part.transform?.translation, 3) || !finiteArray(part.transform?.rotation, 4)) errors.push(`${part.partId}: complete transform required`);
    else if (Math.abs(Math.hypot(...part.transform.rotation) - 1) > 1e-9) errors.push(`${part.partId}: rotation must be a unit quaternion`);
  }

  const connectionIds = new Set();
  for (const connection of definition.initialScene?.connections || []) {
    if (!connection.connectionId || connectionIds.has(connection.connectionId)) errors.push("initial Mechanical Connection IDs must be unique and non-empty");
    connectionIds.add(connection.connectionId);
    if (!connection.kind || !connection.a?.pointId || !connection.b?.pointId) errors.push(`${connection.connectionId}: kind and endpoint pointIds are required`);
    if (![connection.a?.partId, connection.b?.partId].every(partId => partIds.has(partId))) errors.push(`${connection.connectionId}: endpoints must reference initial Parts`);
  }

  const availableRefs = new Set();
  for (const entry of definition.availableParts || []) {
    const key = `${entry.definition?.definitionId}@${entry.definition?.version}`;
    if (!exactPartRef(entry.definition) || availableRefs.has(key)) errors.push("available Part Definition references must be exact and unique");
    availableRefs.add(key);
    if (entry.maxCount !== null && (!Number.isInteger(entry.maxCount) || entry.maxCount < 1)) errors.push(`${key}: maxCount must be null or a positive integer`);
  }

  const zoneIds = new Set();
  for (const challengeZone of definition.zones || []) {
    if (!challengeZone.zoneId || zoneIds.has(challengeZone.zoneId)) errors.push("Zone IDs must be unique and non-empty");
    zoneIds.add(challengeZone.zoneId);
    if (!challengeZone.volumes?.length) errors.push(`${challengeZone.zoneId}: at least one Zone volume required`);
    for (const volume of challengeZone.volumes || []) {
      if (volume.shape !== "box" || !finiteArray(volume.min, 3) || !finiteArray(volume.max, 3) || volume.min.some((value, axis) => value >= volume.max[axis])) errors.push(`${challengeZone.zoneId}: Zone volumes must be positive boxes`);
    }
  }

  const conditionIds = new Set();
  if (!definition.successConditions?.length) errors.push("at least one success condition is required");
  for (const condition of definition.successConditions || []) {
    if (!condition.conditionId || conditionIds.has(condition.conditionId)) errors.push("success condition IDs must be unique and non-empty");
    conditionIds.add(condition.conditionId);
    if (condition.type === "assembly-spans-zones" && !condition.zones?.every(zoneId => zoneIds.has(zoneId))) errors.push(`${condition.conditionId}: unknown Zone reference`);
    if (condition.type === "player-parts-clear-zone" && !zoneIds.has(condition.zone)) errors.push(`${condition.conditionId}: unknown Zone reference`);
    if (condition.type === "player-part-count" && (!Number.isInteger(condition.min) || !Number.isInteger(condition.max) || condition.min < 0 || condition.max < condition.min)) errors.push(`${condition.conditionId}: invalid Part count range`);
    if (condition.type === "parts-share-assembly" && !condition.parts?.every(partId => partIds.has(partId))) errors.push(`${condition.conditionId}: unknown initial Part reference`);
    if (!coreConditions.has(condition.type) && (!condition.extension || !definition.requiredExtensions.includes(condition.extension))) errors.push(`${condition.conditionId}: extension condition must declare a required extension`);
  }

  for (const required of definition.requiredExtensions || []) if (!Object.hasOwn(definition.extensions, required)) errors.push(`${required}: required extension payload missing`);
  for (const key of Object.keys(definition.extensions || {})) if (!key.includes(".")) errors.push(`${key}: extension key must be namespaced`);
  return errors;
}

export function projectChallenge(definition, profile = "v1") {
  const supported = profiles[profile];
  const unsupportedExtensions = definition.requiredExtensions.filter(extension => !supported.extensions.has(extension));
  const unsupportedConditions = definition.successConditions.filter(condition => !supported.conditions.has(condition.type));
  return {
    identity: `${definition.challengeId}@${definition.challengeVersion}`,
    editable: unsupportedExtensions.length === 0 && unsupportedConditions.length === 0,
    unsupportedExtensions,
    unsupportedConditions,
    initialPartCount: definition.initialScene.parts.length,
    availablePartCount: definition.availableParts.length,
    zoneCount: definition.zones.length,
    conditionCount: definition.successConditions.length,
    preservedExtensions: Object.keys(definition.extensions)
  };
}

export function auditChallenges() {
  return challenges.map(definition => ({
    challengeId: definition.challengeId,
    errors: validateChallenge(definition),
    v1Editable: projectChallenge(definition, "v1").editable,
    futureEditable: projectChallenge(definition, "future").editable
  }));
}
