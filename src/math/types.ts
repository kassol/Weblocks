export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export const EPSILON = 1e-6;

export function asVec3(values: readonly number[]): Vec3 {
  return [values[0]!, values[1]!, values[2]!];
}

export function asQuat(values: readonly number[]): Quat {
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function almostEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function vec3AlmostEqual(a: Vec3, b: Vec3, epsilon = EPSILON): boolean {
  return almostEqual(a[0], b[0], epsilon) && almostEqual(a[1], b[1], epsilon) && almostEqual(a[2], b[2], epsilon);
}

export function quatLength(q: Quat): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

export function quatNormalize(q: Quat): Quat {
  const length = quatLength(q);
  if (length < EPSILON) {
    return [0, 0, 0, 1];
  }
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function quatIsNormalized(q: Quat, epsilon = 1e-3): boolean {
  return almostEqual(quatLength(q), 1, epsilon);
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const result = quatMultiply(quatMultiply(q, p), quatConjugate(q));
  return [result[0], result[1], result[2]];
}

/** Relative rotation `inv(a) * b` as a quaternion. */
export function quatRelative(a: Quat, b: Quat): Quat {
  return quatMultiply(quatConjugate(a), b);
}

export function quatAlmostEqual(a: Quat, b: Quat, epsilon = EPSILON): boolean {
  const same =
    almostEqual(a[0], b[0], epsilon) &&
    almostEqual(a[1], b[1], epsilon) &&
    almostEqual(a[2], b[2], epsilon) &&
    almostEqual(a[3], b[3], epsilon);
  const opposite =
    almostEqual(a[0], -b[0], epsilon) &&
    almostEqual(a[1], -b[1], epsilon) &&
    almostEqual(a[2], -b[2], epsilon) &&
    almostEqual(a[3], -b[3], epsilon);
  return same || opposite;
}

/** Quarter-turn around +Y: 0→identity, 1→90°, 2→180°, 3→270°. */
export function quatFromYQuarterTurn(turns: number): Quat {
  const angle = (turns % 4) * (Math.PI / 2);
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

export function isYQuarterTurn(q: Quat, epsilon = 1e-4): boolean {
  for (let turn = 0; turn < 4; turn += 1) {
    if (quatAlmostEqual(quatNormalize(q), quatFromYQuarterTurn(turn), epsilon)) {
      return true;
    }
  }
  return false;
}
