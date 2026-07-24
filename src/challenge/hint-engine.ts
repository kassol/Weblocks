/** Idle time without a valid action before the current hint escalates. */
export const HINT_ESCALATION_IDLE_MS = 18_000;
/** Consecutive invalid placements before the current hint escalates. */
export const HINT_ESCALATION_INVALID_STREAK = 2;

/**
 * Escalation state for contextual hints. Pure and clock-injected: callers pass
 * timestamps in, so tests drive time explicitly. Runtime data only — never part
 * of a Challenge Definition.
 */
export type HintEscalation = {
  readonly lastValidActionAt: number;
  readonly invalidStreak: number;
  readonly manualRequested: boolean;
};

export function createHintEscalation(nowMs: number): HintEscalation {
  return { lastValidActionAt: nowMs, invalidStreak: 0, manualRequested: false };
}

/** A committed valid edit resets both counters and any manual request. */
export function noteValidAction(nowMs: number): HintEscalation {
  return createHintEscalation(nowMs);
}

export function noteInvalidPlacement(state: HintEscalation): HintEscalation {
  return { ...state, invalidStreak: state.invalidStreak + 1 };
}

export function noteManualHint(state: HintEscalation): HintEscalation {
  return { ...state, manualRequested: true };
}

export function isEscalated(state: HintEscalation, nowMs: number): boolean {
  return (
    state.manualRequested ||
    state.invalidStreak >= HINT_ESCALATION_INVALID_STREAK ||
    nowMs - state.lastValidActionAt >= HINT_ESCALATION_IDLE_MS
  );
}
