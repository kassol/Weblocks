import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCapabilities, evaluateCapabilityGate } from "../src/browser/capability.js";
import {
  ghostClientPoint,
  intentOnPointerMove,
  isProtectedCameraGesture,
  TOUCH_GHOST_OFFSET_PX,
} from "../src/browser/pointer-semantics.js";

describe("Capability gate", () => {
  it("passes when WebGL2, Pointer Events, and pointer capture exist", () => {
    const capabilities = detectCapabilities({
      createWebGL2Context: () => ({}),
      pointerEvent: function PointerEvent() {},
      elementPrototype: { setPointerCapture: () => {} },
      maxTouchPoints: 2,
    });
    const gate = evaluateCapabilityGate(capabilities);
    assert.equal(gate.ok, true);
  });

  it("fails with specific missing capabilities", () => {
    const capabilities = detectCapabilities({
      createWebGL2Context: () => null,
      pointerEvent: undefined,
      elementPrototype: {},
      maxTouchPoints: 0,
    });
    const gate = evaluateCapabilityGate(capabilities);
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.deepEqual(gate.missing, ["WebGL2", "Pointer Events", "pointer capture"]);
  });
});

describe("Pointer semantics", () => {
  it("lifts touch ghost by the calibrated constant", () => {
    const point = ghostClientPoint({
      pointerId: 1,
      kind: "touch",
      buttons: 1,
      clientX: 100,
      clientY: 200,
    });
    assert.equal(point.clientY, 200 - TOUCH_GHOST_OFFSET_PX);
    assert.equal(TOUCH_GHOST_OFFSET_PX, 54);
  });

  it("treats two-finger touch as protected camera while holding", () => {
    assert.equal(
      isProtectedCameraGesture([
        { pointerId: 1, kind: "touch", buttons: 1, clientX: 10, clientY: 10 },
        { pointerId: 2, kind: "touch", buttons: 1, clientX: 40, clientY: 40 },
      ]),
      true,
    );
  });

  it("treats mouse right-drag as protected camera while holding", () => {
    assert.equal(
      isProtectedCameraGesture([{ pointerId: 1, kind: "mouse", buttons: 2, clientX: 10, clientY: 10 }]),
      true,
    );
  });

  it("orbits on empty-space drag while browsing", () => {
    const intent = intentOnPointerMove({
      mode: "browsing",
      pointers: [{ pointerId: 1, kind: "mouse", buttons: 1, clientX: 20, clientY: 20 }],
      hitAtDown: { type: "ground", position: [0, 0, 0] },
      deltaX: 12,
      deltaY: -4,
    });
    assert.equal(intent.type, "orbit-camera");
  });

  it("does not place while protected camera gestures fire", () => {
    const intent = intentOnPointerMove({
      mode: "holding-new",
      pointers: [
        { pointerId: 1, kind: "touch", buttons: 1, clientX: 10, clientY: 10 },
        { pointerId: 2, kind: "touch", buttons: 1, clientX: 30, clientY: 30 },
      ],
      hitAtDown: { type: "ground", position: [0, 0, 0] },
      deltaX: 8,
      deltaY: 2,
      proposedTransform: {
        position: [1, 0, 1],
        rotation: [0, 0, 0, 1],
      },
    });
    assert.equal(intent.type, "orbit-camera");
  });
});
