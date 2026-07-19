import { assess, BUDGET, type PerformanceSample } from "./budget.ts";

const passing: PerformanceSample = {
  parts: BUDGET.parts,
  connectionPoints: BUDGET.connectionPoints,
  fps: BUDGET.minimumFps,
  frameP95Ms: BUDGET.maximumFrameP95Ms,
  inputP95Ms: BUDGET.maximumInputP95Ms,
  candidateP95Ms: BUDGET.maximumCandidateP95Ms,
  interactiveMs: BUDGET.maximumInteractiveMs,
  initialTransferKiB: BUDGET.maximumInitialTransferKiB
};

if (!assess(passing).passed) throw new Error("boundary sample must pass");
for (const [field, value] of Object.entries({
  parts: BUDGET.parts + 1,
  connectionPoints: BUDGET.connectionPoints + 1,
  fps: BUDGET.minimumFps - 1,
  frameP95Ms: BUDGET.maximumFrameP95Ms + 1,
  inputP95Ms: BUDGET.maximumInputP95Ms + 1,
  candidateP95Ms: BUDGET.maximumCandidateP95Ms + 1,
  interactiveMs: BUDGET.maximumInteractiveMs + 1,
  initialTransferKiB: BUDGET.maximumInitialTransferKiB + 1
})) {
  if (assess({ ...passing, [field]: value }).passed) throw new Error(`${field} over budget must fail`);
}
console.log("budget: boundary passes; 8 over-budget cases fail");
