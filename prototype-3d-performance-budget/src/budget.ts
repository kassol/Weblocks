export type PerformanceSample = {
  parts: number;
  connectionPoints: number;
  fps: number;
  frameP95Ms: number;
  inputP95Ms: number;
  candidateP95Ms: number;
  interactiveMs: number;
  initialTransferKiB: number;
};

export const BUDGET = Object.freeze({
  parts: 250,
  connectionPoints: 1000,
  minimumFps: 45,
  maximumFrameP95Ms: 34,
  maximumInputP95Ms: 50,
  maximumCandidateP95Ms: 8,
  maximumInteractiveMs: 3000,
  maximumInitialTransferKiB: 1536
});

export function assess(sample: PerformanceSample) {
  const gates = {
    parts: sample.parts <= BUDGET.parts,
    connectionPoints: sample.connectionPoints <= BUDGET.connectionPoints,
    fps: sample.fps >= BUDGET.minimumFps,
    frameP95: sample.frameP95Ms <= BUDGET.maximumFrameP95Ms,
    input: sample.inputP95Ms <= BUDGET.maximumInputP95Ms,
    candidate: sample.candidateP95Ms <= BUDGET.maximumCandidateP95Ms,
    interactive: sample.interactiveMs <= BUDGET.maximumInteractiveMs,
    transfer: sample.initialTransferKiB <= BUDGET.maximumInitialTransferKiB
  };
  return { passed: Object.values(gates).every(Boolean), gates };
}
