import { almostEqual, type Vec3 } from "./types.js";

export type AxisAlignedBox = {
  readonly min: Vec3;
  readonly max: Vec3;
};

export function boxVolume(box: AxisAlignedBox): number {
  return Math.max(0, box.max[0] - box.min[0]) * Math.max(0, box.max[1] - box.min[1]) * Math.max(0, box.max[2] - box.min[2]);
}

export function boxesHavePositiveVolumeOverlap(a: AxisAlignedBox, b: AxisAlignedBox): boolean {
  return (
    a.min[0] < b.max[0] &&
    a.max[0] > b.min[0] &&
    a.min[1] < b.max[1] &&
    a.max[1] > b.min[1] &&
    a.min[2] < b.max[2] &&
    a.max[2] > b.min[2]
  );
}

export function boxesTouchOrOverlap(a: AxisAlignedBox, b: AxisAlignedBox): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}

export function transformLocalBox(box: AxisAlignedBox, position: Vec3, rotationAxes: "y-quarter" | "general", quatRotate: (v: Vec3) => Vec3): AxisAlignedBox {
  // V1 committed orientations are Y quarter-turns; AABB remains axis-aligned after transform.
  void rotationAxes;
  const corners: Vec3[] = [
    [box.min[0], box.min[1], box.min[2]],
    [box.min[0], box.min[1], box.max[2]],
    [box.min[0], box.max[1], box.min[2]],
    [box.min[0], box.max[1], box.max[2]],
    [box.max[0], box.min[1], box.min[2]],
    [box.max[0], box.min[1], box.max[2]],
    [box.max[0], box.max[1], box.min[2]],
    [box.max[0], box.max[1], box.max[2]],
  ];
  const world = corners.map((corner) => {
    const rotated = quatRotate(corner);
    return [rotated[0] + position[0], rotated[1] + position[1], rotated[2] + position[2]] as Vec3;
  });
  const min: Vec3 = [
    Math.min(...world.map((c) => c[0])),
    Math.min(...world.map((c) => c[1])),
    Math.min(...world.map((c) => c[2])),
  ];
  const max: Vec3 = [
    Math.max(...world.map((c) => c[0])),
    Math.max(...world.map((c) => c[1])),
    Math.max(...world.map((c) => c[2])),
  ];
  return { min, max };
}

export function boxTouchesGround(box: AxisAlignedBox, epsilon = 1e-6): boolean {
  return almostEqual(box.min[1], 0, epsilon) || (box.min[1] < 0 && box.max[1] > 0);
}

export function boxPenetratesGround(box: AxisAlignedBox, epsilon = 1e-6): boolean {
  return box.min[1] < -epsilon;
}
