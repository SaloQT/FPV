import type { TrackData } from '../contracts';
import { pathCurvature } from '../world/track/spline';

/** Cornering limit and top speed of a fast pilot on a tight course: the same figures `world/track/summary.ts` documents. */
export const LATERAL_ACCEL = 25;
export const TOP_SPEED = 30;
/** A pilot never slows below this on a course, however tight the corner. */
export const MIN_SPEED = 6;
/** Speeding up and braking along the line, m/s^2. */
export const ACCEL = 14;
export const BRAKE = 18;

const CURVATURE_STRIDE = 2;

/** Seconds for one lap of an ideal pilot: the curvature-limited speed at every path point, smoothed by what the quad can accelerate and brake. */
export function estimateLapTime(track: TrackData): number {
  const path = track.path;
  const n = path.length;
  if (n < 2) return NaN;
  const closed = track.closed;
  const edges = closed ? n : n - 1;
  const kappa = pathCurvature(path, closed, CURVATURE_STRIDE);
  const limit = new Float64Array(n);
  for (let i = 0; i < n; i++) limit[i] = Math.min(Math.max(Math.sqrt(LATERAL_ACCEL / Math.max(kappa[i], 1e-6)), MIN_SPEED), TOP_SPEED);
  const ds = new Float64Array(edges);
  for (let i = 0; i < edges; i++) {
    const a = path[i], b = path[(i + 1) % n];
    ds[i] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const v = Float64Array.from(limit);
  if (!closed) v[0] = Math.min(v[0], MIN_SPEED);
  // Two sweeps each way: on a circuit the speed at the line carries over from the end of the lap.
  const sweeps = closed ? 2 : 1;
  for (let s = 0; s < sweeps; s++) {
    for (let k = 0; k < edges; k++) {
      const i = k % n, j = (k + 1) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * ACCEL * ds[i]));
    }
    for (let k = edges - 1; k >= 0; k--) {
      const i = k % n, j = (k + 1) % n;
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * BRAKE * ds[i]));
    }
  }
  let t = 0;
  for (let i = 0; i < edges; i++) t += (2 * ds[i]) / (v[i] + v[(i + 1) % n]);
  return t;
}
