import type { Quat, Vec3 } from '../contracts';

export const G0 = 9.80665;
export const DEG = Math.PI / 180;
export const TWO_PI = Math.PI * 2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function newVec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function newQuat(): Quat {
  return [0, 0, 0, 1];
}

/** Seeded PRNG (mulberry32) with a cached Box-Muller gaussian; allocation-free after construction. */
export class Rng {
  private s: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  reseed(seed: number): void {
    this.s = seed >>> 0;
    this.hasSpare = false;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  gauss(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = TWO_PI * v;
    this.spare = r * Math.sin(a);
    this.hasSpare = true;
    return r * Math.cos(a);
  }
}

export function quatNormalize(q: Quat): void {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-12) {
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[3] = 1;
    return;
  }
  const inv = 1 / n;
  q[0] *= inv;
  q[1] *= inv;
  q[2] *= inv;
  q[3] *= inv;
}

export function quatSetYaw(q: Quat, yaw: number): void {
  q[0] = 0;
  q[1] = Math.sin(yaw * 0.5);
  q[2] = 0;
  q[3] = Math.cos(yaw * 0.5);
}

/** out = a * b (Hamilton product). `out` may alias `a` or `b`. */
export function quatMul(out: Quat, a: Quat, b: Quat): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Body rotation by rate (wx,wy,wz) [rad/s, body axes] for dt: q <- q * dq (exact for constant rate), then normalised. */
export function quatIntegrateBody(q: Quat, wx: number, wy: number, wz: number, dt: number): void {
  const wm = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const half = wm * dt * 0.5;
  let s: number;
  let c: number;
  if (half < 1e-4) {
    const h2 = half * half;
    c = 1 - h2 * 0.5;
    s = dt * 0.5 * (1 - h2 / 6);
  } else {
    c = Math.cos(half);
    s = Math.sin(half) / wm;
  }
  const dx = wx * s, dy = wy * s, dz = wz * s;
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  q[0] = qw * dx + qx * c + qy * dz - qz * dy;
  q[1] = qw * dy - qx * dz + qy * c + qz * dx;
  q[2] = qw * dz + qx * dy - qy * dx + qz * c;
  q[3] = qw * c - qx * dx - qy * dy - qz * dz;
  const n = 1 / Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  q[0] *= n;
  q[1] *= n;
  q[2] *= n;
  q[3] *= n;
}

/** out = R(q) v (body -> world). `out` must not alias `v`. */
export function quatRotate(q: Quat, vx: number, vy: number, vz: number, out: Vec3): void {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
}

/** out = R(q)^T v (world -> body). `out` must not alias `v`. */
export function quatRotateInv(q: Quat, vx: number, vy: number, vz: number, out: Vec3): void {
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
}

/** Row-major 3x3 rotation matrix (body -> world) written into `m` (length 9). */
export function quatToMat3(q: Quat, m: ArrayLike<number> & { [i: number]: number }): void {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz);
  m[1] = 2 * (xy - wz);
  m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz);
  m[4] = 1 - 2 * (xx + zz);
  m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy);
  m[7] = 2 * (yz + wx);
  m[8] = 1 - 2 * (xx + yy);
}

/** Angle in radians between the body +Y axis and world up. */
export function tiltAngle(q: Quat): number {
  const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  return Math.acos(clamp(upY, -1, 1));
}
