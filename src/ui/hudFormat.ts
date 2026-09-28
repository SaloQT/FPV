import type { Quat } from '../contracts';

export const LOW_CELL_V = 3.5;
export const CRITICAL_CELL_V = 3.3;
/** Highest voltage a charged LiPo/LiHV cell reads; used to guess the pack size from a fresh battery. */
const MAX_CELL_V = 4.25;

/** Cells in a pack that reads `packVolts` while (nearly) fully charged. */
export function estimateCells(packVolts: number): number {
  if (!(packVolts > 0.5)) return 1;
  return Math.min(12, Math.max(1, Math.ceil(packVolts / MAX_CELL_V)));
}

/** Integer cache key for a value shown with 0.1 resolution below 10 and in whole units from there on. */
export function mixedKey(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) < 9.95) return Math.round(v * 10);
  return v < 0 ? -1000 + Math.round(v) : 1000 + Math.round(v);
}

/** Text for a `mixedKey`: "3.2" or "-0.4" for small values, "27" for large ones. */
export function formatMixed(key: number): string {
  if (key >= 1000) return String(key - 1000);
  if (key <= -1000) return String(key + 1000);
  return (key / 10).toFixed(1);
}

/** `q` is a value in hundredths of a volt. */
export function formatVolts(hundredths: number): string {
  return `${(hundredths / 100).toFixed(2)}V`;
}

/** Pitch and roll of a body-to-world quaternion, in radians. Pitch > 0 is nose up; roll > 0 is right wing down. */
export interface Attitude {
  pitch: number;
  roll: number;
}

export function quatPitchRoll(q: Quat, out: Attitude): Attitude {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const forwardY = 2 * (x * w - y * z);
  const rightY = 2 * (x * y + z * w);
  const upY = 1 - 2 * (x * x + z * z);
  out.pitch = Math.asin(forwardY < -1 ? -1 : forwardY > 1 ? 1 : forwardY);
  out.roll = Math.atan2(-rightY, upY);
  return out;
}

/**
 * Elevation and roll of the FPV camera itself: the body tilted `tilt` rad up about its right axis. Elevation is the look
 * direction above the horizon (not body pitch plus tilt, which is only right when the quad is not banked); roll is the
 * tilt of the horizon in the picture, right wing down positive.
 */
export function cameraPitchRoll(q: Quat, tilt: number, out: Attitude): Attitude {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const forwardY = 2 * (x * w - y * z);
  const rightY = 2 * (x * y + z * w);
  const upY = 1 - 2 * (x * x + z * z);
  const s = Math.sin(tilt), c = Math.cos(tilt);
  const lookY = s * upY + c * forwardY;
  out.pitch = Math.asin(lookY < -1 ? -1 : lookY > 1 ? 1 : lookY);
  out.roll = Math.atan2(-rightY, c * upY - s * forwardY);
  return out;
}

/** Vertical pixel offset of the horizon from the view centre for a camera pitched `pitch` rad above it. */
export function horizonOffsetPx(pitch: number, fovY: number, heightPx: number): number {
  const p = Math.min(Math.max(pitch, -1.45), 1.45);
  return Math.tan(p) * (heightPx / (2 * Math.tan(fovY / 2)));
}
