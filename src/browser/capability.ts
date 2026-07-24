export type BrowserCapabilities = {
  readonly webgl2: boolean;
  readonly pointerEvents: boolean;
  readonly pointerCapture: boolean;
  readonly maxTouchPoints: number;
};

export type CapabilityGateResult =
  | { readonly ok: true; readonly capabilities: BrowserCapabilities }
  | { readonly ok: false; readonly missing: readonly string[]; readonly capabilities: BrowserCapabilities };

export function detectCapabilities(env: {
  readonly createWebGL2Context: () => unknown | null;
  readonly pointerEvent: unknown;
  readonly elementPrototype: { setPointerCapture?: unknown };
  readonly maxTouchPoints: number;
}): BrowserCapabilities {
  return {
    webgl2: Boolean(env.createWebGL2Context()),
    pointerEvents: typeof env.pointerEvent !== "undefined",
    pointerCapture: typeof env.elementPrototype.setPointerCapture === "function",
    maxTouchPoints: env.maxTouchPoints,
  };
}

/** Desktop and tablet share one gate: WebGL2 + Pointer Events + pointer capture. */
export function evaluateCapabilityGate(capabilities: BrowserCapabilities): CapabilityGateResult {
  const missing: string[] = [];
  if (!capabilities.webgl2) missing.push("WebGL2");
  if (!capabilities.pointerEvents) missing.push("Pointer Events");
  if (!capabilities.pointerCapture) missing.push("pointer capture");
  if (missing.length > 0) {
    return { ok: false, missing, capabilities };
  }
  return { ok: true, capabilities };
}

export function detectAndGateFromWindow(win: Window & typeof globalThis): CapabilityGateResult {
  const canvas = win.document.createElement("canvas");
  return evaluateCapabilityGate(
    detectCapabilities({
      createWebGL2Context: () => canvas.getContext("webgl2"),
      pointerEvent: (win as unknown as { PointerEvent?: unknown }).PointerEvent,
      elementPrototype: win.Element.prototype,
      maxTouchPoints: win.navigator.maxTouchPoints ?? 0,
    }),
  );
}
