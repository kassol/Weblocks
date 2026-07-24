import type { Transform } from "../build/document.js";
import type { PartDefinitionRef } from "../definitions/types.js";
import type { Vec3 } from "../math/types.js";

/** Touch ghost lifts 54 CSS px above the primary contact (PRD / #16). */
export const TOUCH_GHOST_OFFSET_PX = 54;

export type PointerKind = "mouse" | "touch" | "pen" | "other";

export type PointerSample = {
  readonly pointerId: number;
  readonly kind: PointerKind;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
};

export type HitTarget =
  | { readonly type: "ground"; readonly position: Vec3 }
  | { readonly type: "part"; readonly partId: string; readonly position: Vec3 }
  | { readonly type: "empty" };

export type SemanticIntent =
  | { readonly type: "pick-new"; readonly definition: PartDefinitionRef }
  | { readonly type: "pick-existing"; readonly partId: string }
  | { readonly type: "update-held"; readonly transform: Transform }
  | { readonly type: "commit-held" }
  | { readonly type: "cancel-or-put-back" }
  | { readonly type: "delete-held" }
  | { readonly type: "rotate-held"; readonly deltaQuarterTurns: 1 | -1 }
  | { readonly type: "orbit-camera"; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: "noop" };

export type InteractionMode = "browsing" | "holding-new" | "holding-existing";

export type GestureContext = {
  readonly mode: InteractionMode;
  readonly activePointers: readonly PointerSample[];
  readonly hit: HitTarget;
  readonly yawTurns: number;
  readonly proposedTransform?: Transform;
};

function pointerKind(type: string): PointerKind {
  if (type === "mouse" || type === "touch" || type === "pen") return type;
  return "other";
}

export function sampleFromEvent(event: {
  pointerId: number;
  pointerType: string;
  buttons: number;
  clientX: number;
  clientY: number;
}): PointerSample {
  return {
    pointerId: event.pointerId,
    kind: pointerKind(event.pointerType),
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

export function ghostClientPoint(
  sample: PointerSample,
  offsetPx: number = TOUCH_GHOST_OFFSET_PX,
): { clientX: number; clientY: number } {
  if (sample.kind === "touch") {
    return { clientX: sample.clientX, clientY: sample.clientY - offsetPx };
  }
  return { clientX: sample.clientX, clientY: sample.clientY };
}

/**
 * Decide the semantic intent for a pointer-up / click commit attempt.
 * Camera orbit is handled separately on move while browsing/holding with protected gestures.
 */
export function intentOnPrimaryActivate(ctx: {
  readonly mode: InteractionMode;
  readonly hit: HitTarget;
  readonly proposedTransform?: Transform;
}): SemanticIntent {
  if (ctx.mode === "browsing") {
    if (ctx.hit.type === "part") {
      return { type: "pick-existing", partId: ctx.hit.partId };
    }
    return { type: "noop" };
  }
  if (ctx.proposedTransform) {
    return { type: "update-held", transform: ctx.proposedTransform };
  }
  return { type: "commit-held" };
}

/** While holding: right-button mouse drag or two-finger touch orbits; never places. */
export function isProtectedCameraGesture(pointers: readonly PointerSample[]): boolean {
  if (pointers.length >= 2 && pointers.every((p) => p.kind === "touch" || p.kind === "pen")) {
    return true;
  }
  const mouse = pointers.find((p) => p.kind === "mouse");
  if (mouse && (mouse.buttons & 2) === 2) {
    return true;
  }
  return false;
}

/** While browsing: any primary-button empty-space drag orbits. */
export function isBrowsingOrbitGesture(mode: InteractionMode, pointers: readonly PointerSample[], hitAtDown: HitTarget): boolean {
  if (mode !== "browsing") return false;
  if (hitAtDown.type === "part") return false;
  const primary = pointers[0];
  if (!primary) return false;
  return primary.buttons === 1 || primary.kind === "touch";
}

export function intentOnPointerMove(ctx: {
  readonly mode: InteractionMode;
  readonly pointers: readonly PointerSample[];
  readonly hitAtDown: HitTarget;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly proposedTransform?: Transform;
}): SemanticIntent {
  if (ctx.mode === "browsing") {
    if (isBrowsingOrbitGesture(ctx.mode, ctx.pointers, ctx.hitAtDown)) {
      return { type: "orbit-camera", deltaX: ctx.deltaX, deltaY: ctx.deltaY };
    }
    return { type: "noop" };
  }
  if (isProtectedCameraGesture(ctx.pointers)) {
    return { type: "orbit-camera", deltaX: ctx.deltaX, deltaY: ctx.deltaY };
  }
  if (ctx.proposedTransform) {
    return { type: "update-held", transform: ctx.proposedTransform };
  }
  return { type: "noop" };
}
