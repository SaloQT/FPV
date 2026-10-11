import type { Quat, Vec3 } from '../../contracts';

export const TAU = 2 * Math.PI;
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const wrap = (v: number, n: number): number => { const r = v % n; return r === 0 ? 0 : r < 0 ? r + n : r; };
export const smooth = (t: number): number => { const u = clamp(t, 0, 1); return u * u * u * (10 + u * (-15 + 6 * u)); };
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function rotate(q: Quat, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const [x, y, z, w] = q, [a, b, c] = v;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  out[0] = a + w * tx + y * tz - z * ty; out[1] = b + w * ty + z * tx - x * tz; out[2] = c + w * tz + x * ty - y * tx;
  return out;
}
export function inverseRotate(q: Quat, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const [x, y, z, w] = q, [a, b, c] = v;
  const tx = 2 * (-y * c + z * b), ty = 2 * (-z * a + x * c), tz = 2 * (-x * b + y * a);
  out[0] = a + w * tx - y * tz + z * ty; out[1] = b + w * ty - z * tx + x * tz; out[2] = c + w * tz - x * ty + y * tx;
  return out;
}
export function qmul(a: Quat, b: Quat): Quat {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export function axisAngle(axis: Vec3, angle: number): Quat { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; }
export function basisQuat(right: Vec3, up: Vec3, back: Vec3): Quat {
  const m00 = right[0], m01 = up[0], m02 = back[0], m10 = right[1], m11 = up[1], m12 = back[1], m20 = right[2], m21 = up[2], m22 = back[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  const n = Math.hypot(...q); return q.map(v => v / n) as Quat;
}
export function yawPoint(pos: Vec3, yaw: number, local: Vec3): Vec3 {
  const c = Math.cos(yaw), s = Math.sin(yaw); return [pos[0] + c * local[0] + s * local[2], pos[1] + local[1], pos[2] - s * local[0] + c * local[2]];
}
export function pose(): import('./types').BodyPose { return { pos: [0, 0, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], omega: [0, 0, 0] }; }
