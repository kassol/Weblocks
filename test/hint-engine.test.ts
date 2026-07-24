import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HINT_ESCALATION_IDLE_MS,
  HINT_ESCALATION_INVALID_STREAK,
  createHintEscalation,
  isEscalated,
  noteInvalidPlacement,
  noteManualHint,
  noteValidAction,
} from "../src/challenge/hint-engine.js";

describe("Hint escalation engine", () => {
  it("stays at the base hint before the 18 s idle deadline", () => {
    const state = createHintEscalation(0);
    assert.equal(isEscalated(state, HINT_ESCALATION_IDLE_MS - 1), false);
  });

  it("escalates exactly at 18 s without a valid action", () => {
    const state = createHintEscalation(0);
    assert.equal(isEscalated(state, HINT_ESCALATION_IDLE_MS), true);
  });

  it("does not escalate after a single invalid placement", () => {
    const state = noteInvalidPlacement(createHintEscalation(0));
    assert.equal(isEscalated(state, 1_000), false);
  });

  it("escalates after two consecutive invalid placements", () => {
    let state = createHintEscalation(0);
    for (let i = 0; i < HINT_ESCALATION_INVALID_STREAK; i += 1) {
      state = noteInvalidPlacement(state);
    }
    assert.equal(isEscalated(state, 1_000), true);
  });

  it("resets the idle timer and the invalid streak on a valid action", () => {
    let state = noteInvalidPlacement(createHintEscalation(0));
    state = noteValidAction(10_000);
    state = noteInvalidPlacement(state);
    assert.equal(isEscalated(state, 10_000 + HINT_ESCALATION_IDLE_MS - 1), false);
    assert.equal(isEscalated(state, 10_000 + HINT_ESCALATION_IDLE_MS), true);
  });

  it("a valid action de-escalates an idle escalation", () => {
    let state = createHintEscalation(0);
    assert.equal(isEscalated(state, HINT_ESCALATION_IDLE_MS + 5_000), true);
    state = noteValidAction(HINT_ESCALATION_IDLE_MS + 5_000);
    assert.equal(isEscalated(state, HINT_ESCALATION_IDLE_MS + 5_001), false);
  });

  it("a manual hint request escalates immediately and resets on a valid action", () => {
    let state = noteManualHint(createHintEscalation(0));
    assert.equal(isEscalated(state, 1), true);
    state = noteValidAction(2);
    assert.equal(isEscalated(state, 3), false);
  });
});
