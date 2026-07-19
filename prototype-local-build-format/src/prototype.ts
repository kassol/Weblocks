import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import {
  AUTOSAVE_DEBOUNCE_MS,
  BUILD_FORMAT,
  BUILD_SCHEMA_VERSION,
  advanceAutosave,
  loadBuild,
  resumeLatest,
  scheduleCommittedBuild,
  serializeBuild,
  type Build,
  type LoadOptions,
  type LocalBuildState,
} from "./build-format.ts";

const catalog = {
  "weblocks:brick-1@1.0.0": ["top", "bottom"],
  "weblocks:brick-2@1.0.0": ["top-left", "top-right", "bottom-left", "bottom-right"],
} as const;

const options: LoadOptions = {
  catalog,
  supportedExtensions: new Set(["weblocks:note@1.0.0"]),
};

function fixture(): Build {
  return {
    format: BUILD_FORMAT,
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: "build-bridge-001",
    parts: [
      {
        id: "part-left",
        definition: { id: "weblocks:brick-1", version: "1.0.0" },
        transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1] },
        properties: { color: "yellow" },
      },
      {
        id: "part-span",
        definition: { id: "weblocks:brick-2", version: "1.0.0" },
        transform: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
        properties: { color: "blue" },
      },
    ],
    mechanicalConnections: [
      {
        id: "connection-left-span",
        a: { partId: "part-left", connectionPointId: "top" },
        b: { partId: "part-span", connectionPointId: "bottom-left" },
      },
    ],
    extensions: [],
  };
}

function cloneBuild(build: Build): Build {
  return JSON.parse(JSON.stringify(build)) as Build;
}

function runBoundaryScenarios(): void {
  const original = fixture();
  const roundTrip = loadBuild(serializeBuild(original), options);
  assert.equal(roundTrip.ok, true);
  if (!roundTrip.ok) return;
  assert.deepEqual(roundTrip.build, original);

  const optional = cloneBuild(original);
  optional.extensions.push({
    id: "future:electric-layout",
    version: "1.0.0",
    required: false,
    data: { nets: [{ id: "net-1", members: ["part-left"] }] },
  });
  const optionalResult = loadBuild(serializeBuild(optional), options);
  assert.equal(optionalResult.ok, true);
  if (!optionalResult.ok) return;
  assert.deepEqual(optionalResult.build.extensions, optional.extensions);
  assert.equal(optionalResult.warnings.length, 1);

  const required = cloneBuild(optional);
  required.extensions[0]!.required = true;
  const requiredResult = loadBuild(serializeBuild(required), options);
  assert.deepEqual(requiredResult, {
    ok: false,
    code: "UNSUPPORTED_REQUIRED_EXTENSION",
    message: "Required extension future:electric-layout@1.0.0 is not supported; the Build was not opened.",
  });

  const missingDefinition = cloneBuild(original);
  missingDefinition.parts[0]!.definition.version = "2.0.0";
  assert.equal(loadBuild(serializeBuild(missingDefinition), options).ok, false);

  const malformedConnection = cloneBuild(original);
  malformedConnection.mechanicalConnections[0]!.b.connectionPointId = "missing-point";
  const malformedResult = loadBuild(serializeBuild(malformedConnection), options);
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.code, "MISSING_CONNECTION_POINT");

  let local: LocalBuildState = scheduleCommittedBuild({}, original, 0);
  local = advanceAutosave(local, AUTOSAVE_DEBOUNCE_MS - 1);
  assert.equal(local.stored, undefined);
  local = advanceAutosave(local, AUTOSAVE_DEBOUNCE_MS);
  assert.equal(local.stored?.revision, 1);
  const resumed = resumeLatest(local, options);
  assert.equal(resumed?.ok, true);

  console.log("build-format: 6 boundary scenarios passed");
}

type PrototypeState = {
  nowMs: number;
  build: Build;
  local: LocalBuildState;
  runtime: { selectedPartId?: string; ghostVisible: boolean; undoEntries: number };
  lastResult: string;
};

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

function render(state: PrototypeState): void {
  console.clear();
  console.log(`${bold}PROTOTYPE — local Build format${reset}`);
  console.log(`${dim}Logical clock: ${state.nowMs} ms · autosave debounce: ${AUTOSAVE_DEBOUNCE_MS} ms${reset}\n`);
  console.log(`${bold}Persistence state${reset}`);
  console.log(JSON.stringify({ pendingDueAtMs: state.local.pending?.dueAtMs, storedRevision: state.local.stored?.revision }, null, 2));
  console.log(`\n${bold}Runtime-only state (never serialized)${reset}`);
  console.log(JSON.stringify(state.runtime, null, 2));
  console.log(`\n${bold}Current Build document${reset}`);
  console.log(serializeBuild(state.build).trim());
  console.log(`${bold}Last result${reset}: ${state.lastResult}\n`);
  console.log(`${bold}[e]${reset} ${dim}commit edit${reset}  ${bold}[t]${reset} ${dim}advance 500 ms${reset}  ${bold}[r]${reset} ${dim}resume latest${reset}`);
  console.log(`${bold}[o]${reset} ${dim}round-trip optional extension${reset}  ${bold}[x]${reset} ${dim}try required unknown extension${reset}`);
  console.log(`${bold}[i]${reset} ${dim}export + import same JSON${reset}  ${bold}[q]${reset} ${dim}quit${reset}`);
}

async function runInteractive(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let state: PrototypeState = {
    nowMs: 0,
    build: fixture(),
    local: {},
    runtime: { selectedPartId: "part-span", ghostVisible: true, undoEntries: 2 },
    lastResult: "No action yet.",
  };

  while (true) {
    render(state);
    const key = (await terminal.question("> ")).trim().toLowerCase();
    if (key === "q") break;

    if (key === "e") {
      const next = cloneBuild(state.build);
      next.parts[1]!.transform.position[0] += 0.25;
      state = {
        ...state,
        build: next,
        local: scheduleCommittedBuild(state.local, next, state.nowMs),
        runtime: { selectedPartId: "part-span", ghostVisible: false, undoEntries: state.runtime.undoEntries + 1 },
        lastResult: `Committed valid edit; autosave scheduled for ${state.nowMs + AUTOSAVE_DEBOUNCE_MS} ms.`,
      };
    } else if (key === "t") {
      const nowMs = state.nowMs + AUTOSAVE_DEBOUNCE_MS;
      const local = advanceAutosave(state.local, nowMs);
      state = { ...state, nowMs, local, lastResult: local.stored ? `Atomic snapshot revision ${local.stored.revision} is complete.` : "Nothing pending." };
    } else if (key === "r") {
      const result = resumeLatest(state.local, options);
      state = result?.ok
        ? { ...state, build: result.build, lastResult: `Resumed latest complete snapshot. ${result.warnings.join(" ")}` }
        : { ...state, lastResult: result ? `${result.code}: ${result.message}` : "No local snapshot exists." };
    } else if (key === "o" || key === "x") {
      const candidate = cloneBuild(state.build);
      candidate.extensions = [{ id: "future:electric-layout", version: "1.0.0", required: key === "x", data: { nets: [] } }];
      const result = loadBuild(serializeBuild(candidate), options);
      state = result.ok
        ? { ...state, build: result.build, lastResult: `Loaded whole Build. ${result.warnings.join(" ")}` }
        : { ...state, lastResult: `${result.code}: ${result.message}` };
    } else if (key === "i") {
      const exportedFile = serializeBuild(state.build);
      const imported = loadBuild(exportedFile, options);
      state = imported.ok
        ? { ...state, build: imported.build, lastResult: `Export/import used the same validator; ${Buffer.byteLength(exportedFile)} bytes.` }
        : { ...state, lastResult: `${imported.code}: ${imported.message}` };
    } else {
      state = { ...state, lastResult: `Unknown action ${JSON.stringify(key)}.` };
    }
  }

  terminal.close();
}

if (process.argv.includes("--check")) {
  runBoundaryScenarios();
} else {
  await runInteractive();
}
