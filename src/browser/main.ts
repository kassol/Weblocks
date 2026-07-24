import "./styles.css";
import { BRICK_1, BRICK_2, BRICK_4 } from "../definitions/bricks.js";
import { DefinitionRegistry } from "../definitions/registry.js";
import type { PartDefinitionRef } from "../definitions/types.js";
import { quatFromYQuarterTurn } from "../math/types.js";
import { ApplicationSession, type SessionResult } from "../session/application-session.js";
import { LocalBuildRepository } from "../storage/local-build-repository.js";
import { detectAndGateFromWindow } from "./capability.js";
import { ThreeEditorAdapter } from "./editor-adapter.js";
import { IndexedDbSnapshotStore } from "./indexeddb-store.js";
import { proposePlacementTransform } from "./placement.js";
import {
  ghostClientPoint,
  intentOnPointerMove,
  isProtectedCameraGesture,
  sampleFromEvent,
  type HitTarget,
  type PointerSample,
  TOUCH_GHOST_OFFSET_PX,
} from "./pointer-semantics.js";

const registry = DefinitionRegistry.withBuiltIns();
const catalog: readonly { ref: PartDefinitionRef; label: string; color: string }[] = [
  { ref: { id: BRICK_1.definitionId, version: BRICK_1.definitionVersion }, label: "1 单位", color: "#e04f3f" },
  { ref: { id: BRICK_2.definitionId, version: BRICK_2.definitionVersion }, label: "2 单位", color: "#3d8bfd" },
  { ref: { id: BRICK_4.definitionId, version: BRICK_4.definitionVersion }, label: "4 单位", color: "#2bb673" },
];

function renderUnsupported(root: HTMLElement, missing: readonly string[]): void {
  root.innerHTML = `<section class="unsupported" role="alert">
    <div>
      <h1>Weblocks 需要更新的浏览器</h1>
      <p>当前环境缺少：${missing.join("、")}。</p>
      <p>请使用支持 WebGL2 与 Pointer Events 的 Chrome / Edge / Firefox / Safari。</p>
    </div>
  </section>`;
}

const importFailureLabels: Record<string, string> = {
  MALFORMED_BUILD: "文件内容损坏或格式不符",
  UNSUPPORTED_SCHEMA_VERSION: "作品文件版本不受支持",
  MISSING_PART_DEFINITION: "缺少所需的部件定义",
  MISSING_CONNECTION_POINT: "缺少所需的连接位",
  UNSUPPORTED_REQUIRED_EXTENSION: "包含不支持的必需扩展",
  CAPACITY_EXCEEDED: "连接位超出容量",
};

function startFreeBuild(root: HTMLElement, repository: LocalBuildRepository, resumeSource: string | null): void {
  const session = ApplicationSession.startFreeBuild(registry, "free-build-1");
  let yawTurns = 0;
  let dragging = false;
  let hitAtDown: HitTarget = { type: "empty" };
  let modeAtDown: "browsing" | "holding-new" | "holding-existing" = "browsing";
  let lastClient = { x: 0, y: 0 };
  let dragDistance = 0;
  let activePointers = new Map<number, PointerSample>();
  let lastLegal = false;
  let lastMessage = "从托盘拿起一个部件开始搭建";

  function persistEffects(result: SessionResult): void {
    if (result.ok) repository.applyStorageEffects(result.storageEffects);
  }

  if (resumeSource) {
    const resumed = session.importBuild(resumeSource);
    lastMessage = resumed.ok ? "已恢复上次保存的作品" : "上次保存的作品无法读取，已开始新作品";
  }

  root.innerHTML = `
    <div class="shell">
      <div class="brand"><strong>Weblocks</strong><span>Free Build</span></div>
      <div class="status" id="status" aria-live="polite"></div>
      <div class="feedback" id="feedback" data-legal="true" hidden>
        <span class="feedback-icon" aria-hidden="true"></span>
        <span id="feedback-text"></span>
      </div>
      <canvas id="viewport" aria-label="拼搭工作区"></canvas>
      <div class="actions" id="actions" aria-label="持件操作">
        <button type="button" data-action="rotate-left" aria-label="向左旋转 90 度">↶ 90°</button>
        <button type="button" data-action="rotate-right" aria-label="向右旋转 90 度">↷ 90°</button>
        <button type="button" data-action="cancel" id="cancel-btn">取消</button>
        <button type="button" data-action="delete" id="delete-btn" hidden>删除</button>
      </div>
      <nav class="tray" id="tray" aria-label="部件托盘"></nav>
      <div class="filebar" aria-label="作品文件">
        <button type="button" id="export-btn">导出 JSON</button>
        <button type="button" id="import-btn">导入 JSON</button>
        <input type="file" id="import-input" accept="application/json,.json" hidden>
      </div>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>("#viewport")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  const feedback = root.querySelector<HTMLElement>("#feedback")!;
  const feedbackText = root.querySelector<HTMLElement>("#feedback-text")!;
  const actions = root.querySelector<HTMLElement>("#actions")!;
  const cancelBtn = root.querySelector<HTMLButtonElement>("#cancel-btn")!;
  const deleteBtn = root.querySelector<HTMLButtonElement>("#delete-btn")!;
  const tray = root.querySelector<HTMLElement>("#tray")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("#export-btn")!;
  const importBtn = root.querySelector<HTMLButtonElement>("#import-btn")!;
  const importInput = root.querySelector<HTMLInputElement>("#import-input")!;

  const adapter = new ThreeEditorAdapter({ canvas, registry });
  adapter.start();

  for (const item of catalog) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.def = `${item.ref.id}@${item.ref.version}`;
    button.setAttribute("aria-label", `拿起${item.label}积木`);
    button.innerHTML = `<span class="swatch" style="background:${item.color}"></span><span>${item.label}</span>`;
    button.addEventListener("click", () => {
      const result = session.pickNewPart(item.ref, [0, 0, 0], yawTurns);
      if (!result.ok) {
        lastMessage = result.message;
      } else {
        lastMessage = `已拿起 ${item.label}：移动放置，点一下放下`;
      }
      refresh();
    });
    tray.append(button);
  }

  actions.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "rotate-left") {
      yawTurns = (yawTurns + 3) % 4;
      session.rotateHeld(-1);
      lastMessage = "已向左旋转 90°";
    } else if (action === "rotate-right") {
      yawTurns = (yawTurns + 1) % 4;
      session.rotateHeld(1);
      lastMessage = "已向右旋转 90°";
    } else if (action === "cancel") {
      session.cancelOrPutBack();
      lastMessage = session.state.mode === "browsing" ? "已取消或放回" : lastMessage;
    } else if (action === "delete") {
      const result = session.deleteHeld();
      persistEffects(result);
      lastMessage = result.ok ? "已删除部件" : result.message;
    }
    refresh();
  });

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([session.exportBuild()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "weblocks-build.json";
    anchor.click();
    URL.revokeObjectURL(url);
    lastMessage = "已导出当前作品为 JSON 文件";
    refresh();
  });

  importBtn.addEventListener("click", () => importInput.click());

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    void file.text().then((source) => {
      const result = session.importBuild(source);
      if (result.ok) {
        persistEffects(result);
        lastMessage = "已导入作品";
      } else {
        const label = importFailureLabels[result.code] ?? "无法导入";
        lastMessage = `导入失败（${label}）：${result.message} 当前作品未受影响。`;
      }
      refresh();
    });
  });

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * Math.min(devicePixelRatio, 1.5));
    canvas.height = Math.floor(rect.height * Math.min(devicePixelRatio, 1.5));
    adapter.resize(rect.width, rect.height);
  }

  function refresh(): void {
    const state = session.state;
    const hidePartId = state.mode === "holding-existing" ? state.heldExisting?.partId : undefined;
    adapter.syncBuild(state.build, hidePartId ? { hidePartId } : undefined);
    const held =
      state.heldNew
        ? {
            id: "__ghost__",
            definition: state.heldNew.definition,
            transform: state.heldNew.transform,
            properties: state.heldNew.properties,
          }
        : state.heldExisting
          ? {
              id: state.heldExisting.partId,
              definition: state.build.parts.find((p) => p.id === state.heldExisting?.partId)?.definition ?? {
                id: BRICK_1.definitionId,
                version: BRICK_1.definitionVersion,
              },
              transform: state.heldExisting.transform,
              properties: { color: "#e04f3f" },
            }
          : undefined;

    adapter.syncGhost(held && state.mode !== "browsing" ? held : undefined, lastLegal);

    const holding = state.mode !== "browsing";
    actions.classList.toggle("visible", holding);
    cancelBtn.textContent = state.mode === "holding-existing" ? "放回" : "取消";
    deleteBtn.hidden = state.mode !== "holding-existing";
    feedback.hidden = !holding;
    feedback.dataset.legal = lastLegal ? "true" : "false";
    feedbackText.textContent = holding
      ? lastLegal
        ? "可以放下 · 图案与颜色均为合法提示"
        : "不能放下 · 重叠、浮空或穿地"
      : "";

    status.innerHTML = `<strong>状态</strong><br>模式 ${state.mode}<br>部件 ${state.build.parts.length}<br>连接 ${state.build.mechanicalConnections.length}<br>触控抬升 ${TOUCH_GHOST_OFFSET_PX}px<br>${lastMessage}`;

    for (const button of tray.querySelectorAll("button")) {
      const def = button.getAttribute("data-def");
      const active =
        state.heldNew && def === `${state.heldNew.definition.id}@${state.heldNew.definition.version}`;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function updateHeldFromClient(clientX: number, clientY: number, kind: string): void {
    const sample = { pointerId: 1, kind: kind === "touch" ? ("touch" as const) : ("mouse" as const), buttons: 1, clientX, clientY };
    const ghost = ghostClientPoint(sample);
    const ground = adapter.groundPosition(ghost.clientX, ghost.clientY, canvas);
    if (!ground) return;
    const state = session.state;
    const definition =
      state.heldNew?.definition ??
      state.build.parts.find((part) => part.id === state.heldExisting?.partId)?.definition;
    if (!definition) return;
    const transform = proposePlacementTransform({
      registry,
      build: state.build,
      definition,
      groundOrHit: ground,
      yawTurns,
    });
    // When holding existing, keep part id path via move; session.updateHeldTransform handles both.
    const result = session.updateHeldTransform(transform);
    if (result.ok) {
      const ghostEffect = result.rendererEffects.find((effect) => effect.type === "update-ghost");
      lastLegal = ghostEffect && ghostEffect.type === "update-ghost" ? ghostEffect.legal : false;
    } else {
      lastLegal = false;
    }
  }

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const sample = sampleFromEvent(event);
    activePointers.set(sample.pointerId, sample);
    lastClient = { x: event.clientX, y: event.clientY };
    dragDistance = 0;
    modeAtDown = session.state.mode;
    const ghost = ghostClientPoint(sample);
    hitAtDown = adapter.hitTest(ghost.clientX, ghost.clientY, canvas);
    dragging = true;

    if (session.state.mode === "browsing" && hitAtDown.type === "part" && event.button === 0) {
      session.pickExistingPart(hitAtDown.partId);
      lastMessage = `已拿起部件 ${hitAtDown.partId}`;
      lastLegal = true;
      refresh();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const sample = sampleFromEvent(event);
    activePointers.set(sample.pointerId, sample);
    const deltaX = event.clientX - lastClient.x;
    const deltaY = event.clientY - lastClient.y;
    dragDistance += Math.hypot(deltaX, deltaY);

    if (!dragging) {
      if (session.state.mode !== "browsing") {
        updateHeldFromClient(event.clientX, event.clientY, event.pointerType);
        refresh();
      }
      return;
    }

    lastClient = { x: event.clientX, y: event.clientY };
    const pointers = [...activePointers.values()];
    const intent = intentOnPointerMove({
      mode: modeAtDown === "browsing" && session.state.mode !== "browsing" ? "browsing" : session.state.mode,
      pointers,
      hitAtDown,
      deltaX,
      deltaY,
      proposedTransform: undefined,
    });

    // If we just picked a part on down, treat subsequent move as held update / protected camera.
    if (session.state.mode !== "browsing") {
      if (isProtectedCameraGesture(pointers)) {
        adapter.orbit(deltaX, deltaY);
        return;
      }
      updateHeldFromClient(event.clientX, event.clientY, event.pointerType);
      refresh();
      return;
    }

    if (intent.type === "orbit-camera") {
      adapter.orbit(intent.deltaX, intent.deltaY);
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    const sample = sampleFromEvent(event);
    activePointers.delete(sample.pointerId);
    const wasDragging = dragging;
    dragging = activePointers.size > 0;
    if (!wasDragging) return;

    if (session.state.mode === "browsing") {
      return;
    }

    // Picked on this gesture with negligible movement: keep holding for click-place.
    if (modeAtDown === "browsing" && dragDistance < 6) {
      refresh();
      return;
    }

    if (isProtectedCameraGesture([...activePointers.values(), sample]) && dragDistance > 6) {
      refresh();
      return;
    }

    updateHeldFromClient(event.clientX, event.clientY, event.pointerType);
    if (event.button === 0 || event.pointerType === "touch") {
      const before = session.state.build.parts.length;
      const result = session.commitHeld();
      persistEffects(result);
      if (result.ok) {
        lastMessage = session.state.build.parts.length > before ? "已放下合法部件" : "已移动部件";
        yawTurns = 0;
      } else {
        lastMessage = result.message;
        lastLegal = false;
      }
    }
    refresh();
  });

  canvas.addEventListener("pointercancel", (event) => {
    activePointers.delete(event.pointerId);
    dragging = activePointers.size > 0;
  });

  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      adapter.restoreFromBuild(session.state.build);
      refresh();
      lastMessage = "图形上下文已恢复，作品未丢失";
      refresh();
    },
    false,
  );

  window.addEventListener("resize", resize);
  resize();
  refresh();

  // Stress fixture for acceptance metrics when ?stress=1
  if (new URLSearchParams(location.search).has("stress")) {
    void loadStress(session, adapter, refresh);
  }

  // Expose a tiny test hook for manual/dev inspection without leaking Three internals.
  (window as unknown as { __weblocks?: unknown }).__weblocks = {
    getMode: () => session.state.mode,
    getPartCount: () => session.state.build.parts.length,
    getStatusText: () => status.textContent,
    getFeedbackText: () => feedbackText.textContent,
    isFeedbackLegal: () => feedback.dataset.legal === "true",
    getBuildSnapshot: () => session.exportBuild(),
  };
}

async function loadStress(
  session: ApplicationSession,
  adapter: ThreeEditorAdapter,
  refresh: () => void,
): Promise<void> {
  const start = performance.now();
  // brick-2 has 4 Connection Points → 250 Parts yield 1,000 visible indicators.
  for (let i = 0; i < 250; i += 1) {
    const x = ((i % 25) - 12) * 2.5;
    const z = (Math.floor(i / 25) - 5) * 1.5;
    session.pickNewPart({ id: BRICK_2.definitionId, version: BRICK_2.definitionVersion }, [x, 0, z], 0);
    session.updateHeldTransform({ position: [x, 0, z], rotation: quatFromYQuarterTurn(0) });
    session.commitHeld(`stress-${i}`);
  }
  refresh();
  const elapsed = performance.now() - start;
  const metrics = {
    parts: session.state.build.parts.length,
    visibleConnectionPoints: session.state.build.parts.length * 4,
    setupMs: Math.round(elapsed),
  };
  console.info("[weblocks-stress]", metrics);
  (window as unknown as { __weblocksStress?: unknown }).__weblocksStress = metrics;
  void adapter;
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("#app missing");
}

async function bootFreeBuild(target: HTMLElement): Promise<void> {
  const repository = new LocalBuildRepository(new IndexedDbSnapshotStore());
  let resumeSource: string | null = null;
  try {
    resumeSource = await repository.resume();
  } catch {
    // A blocked or failing IndexedDB must not prevent play; start fresh.
    resumeSource = null;
  }
  startFreeBuild(target, repository, resumeSource);
}

const gate = detectAndGateFromWindow(window);
if (!gate.ok) {
  renderUnsupported(root, gate.missing);
} else {
  void bootFreeBuild(root);
}
