import { BRICK_1, BRICK_2, BRICK_4 } from "../definitions/bricks.js";
import type { ChallengeDefinition } from "../definitions/types.js";
import type { ChallengeEvaluation } from "./evaluator.js";

export const BRIDGE_CHALLENGE_ID = "weblocks:bridge-river";
export const BRIDGE_CHALLENGE_VERSION = "1.0.0";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The first published Challenge: bridge the river between two authored Grounded
 * supports. Immutable — all runtime data (Build, completion, hint counters)
 * lives outside this definition.
 */
export const BRIDGE_CHALLENGE: ChallengeDefinition = deepFreeze({
  schemaVersion: "1.0",
  challengeId: BRIDGE_CHALLENGE_ID,
  challengeVersion: BRIDGE_CHALLENGE_VERSION,
  metadata: {
    title: "帮机器人搭桥过河",
    prompt: "河水拦住了机器人。用积木搭一座桥，把两岸的支撑连成一体，机器人就能从起点走到终点。",
    estimatedMinutes: 5,
  },
  initialScene: {
    parts: [
      {
        id: "start-support",
        definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
        transform: { position: [-3, 0, 0], rotation: [0, 0, 0, 1] },
        properties: { color: "#8a5a2b" },
      },
      {
        id: "destination-support",
        definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion },
        transform: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
        properties: { color: "#8a5a2b" },
      },
    ],
    mechanicalConnections: [],
  },
  availableParts: [
    { definition: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }, maxCount: null },
    { definition: { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion }, maxCount: null },
    { definition: { id: BRICK_4.definitionId, version: BRICK_4.definitionVersion }, maxCount: null },
  ],
  zones: [
    { zoneId: "start", volumes: [{ shape: "box", min: [-3.5, 0, -0.5], max: [-2.5, 2.5, 0.5] }] },
    { zoneId: "destination", volumes: [{ shape: "box", min: [2.5, 0, -0.5], max: [3.5, 2.5, 0.5] }] },
  ],
  successConditions: [
    { conditionId: "bridge-spans", type: "assembly-spans-zones", zones: ["start", "destination"] },
    { conditionId: "supports-linked", type: "parts-share-assembly", parts: ["start-support", "destination-support"] },
  ],
  requiredExtensions: [],
  extensions: {
    "weblocks.ui.zones": {
      start: { label: "起点", icon: "▲", color: "#2383ff" },
      destination: { label: "终点", icon: "★", color: "#1f9d63" },
    },
    "weblocks.scenery.water": {
      volumes: [{ shape: "box", min: [-2.5, 0, -4], max: [2.5, 0.05, 4] }],
    },
  },
});

export type BridgeProgress = {
  readonly playerPartCount: number;
  readonly spanPassed: boolean;
  readonly sharePassed: boolean;
  readonly success: boolean;
};

export function bridgeProgress(evaluation: ChallengeEvaluation | undefined, playerPartCount: number): BridgeProgress {
  const passed = (type: string): boolean =>
    evaluation?.results.find((result) => result.type === type)?.passed ?? false;
  return {
    playerPartCount,
    spanPassed: passed("assembly-spans-zones"),
    sharePassed: passed("parts-share-assembly"),
    success: evaluation?.passed ?? false,
  };
}

/** Contextual hint copy: a nudge, never a scripted solution sequence. */
export function bridgeHint(progress: BridgeProgress, escalated: boolean): string {
  if (progress.success) {
    return "桥搭好了！机器人已经可以从起点走到终点。";
  }
  if (progress.spanPassed && !progress.sharePassed) {
    return escalated
      ? "试试看：在终点支撑顶部的圆点上放一块积木，让桥和支撑连接起来。"
      : "桥已经碰到两岸区域了，再让它和两岸的支撑连接起来。";
  }
  if (progress.playerPartCount === 0) {
    return escalated
      ? "试试看：拿起一块长积木，移到起点支撑的正上方，底部圆孔对准支撑顶上的圆点，点一下放下。"
      : "从托盘拿起一块积木，放到起点支撑顶上的圆点试试。";
  }
  return escalated
    ? "试试看：把新积木的底部圆孔对准已放积木顶上的圆点，一步一步向对岸延伸。"
    : "让积木的圆孔对准圆点连接起来，一路搭到对岸的终点支撑。";
}
