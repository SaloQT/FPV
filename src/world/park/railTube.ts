import type { Vec3 } from '../../contracts';
import type { RailSample } from './curve';
import { clamp, wrap } from './math';
import { RAIL } from './rideDimensions';
import type { CoasterCurve } from './types';

/** The straight tube lengths a track's running rails are built from: where each length starts along the track, and its start point on the left and right rail. */
interface BuiltRails { stations: readonly number[]; left: readonly Vec3[]; right: readonly Vec3[] }
const built = new WeakMap<CoasterCurve, BuiltRails>();

/** Remember the rail tube lengths built for a track, so cars can ride on them rather than on the exact curve they were cut from. */
export function registerBuiltRails(curve: CoasterCurve, stations: readonly number[], points: readonly (readonly Vec3[])[]): void {
  built.set(curve, { stations, left: points[0], right: points[1] });
}

/** The shift that carries the point `q` onto the nearest point of the straight length a-b. */
function shiftOntoLength(q: Vec3, a: Vec3, b: Vec3, out: Vec3): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const t = clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy + (q[2] - a[2]) * dz) / Math.max(dx * dx + dy * dy + dz * dz, 1e-15), 0, 1);
  out[0] = a[0] + dx * t - q[0]; out[1] = a[1] + dy * t - q[1]; out[2] = a[2] + dz * t - q[2];
}

const left: Vec3 = [0, 0, 0], right: Vec3 = [0, 0, 0], shiftLeft: Vec3 = [0, 0, 0], shiftRight: Vec3 = [0, 0, 0];

/** Move a rail sample from the exact track curve onto the tube lengths actually built there, so a bogie's wheels touch the rail tubes
 * instead of sinking into them where a straight length cuts inside the curve. The sample moves by the average of what the left and right rail
 * need, and rolls about the track direction by half the difference in how far each rail needs to rise, so the bogie sits level on both rails.
 * The tangent and the arc position are unchanged, so ride timing is not affected. Tracks without registered rails are left as they are. */
export function seatOnBuiltRails(curve: CoasterCurve, at: number, sample: RailSample): void {
  const rails = built.get(curve);
  if (!rails) return;
  const s = wrap(at, curve.length), stations = rails.stations;
  let lo = 0, hi = stations.length - 1;
  while (hi > lo) { const mid = (lo + hi + 1) >>> 1; if (stations[mid] <= s) lo = mid; else hi = mid - 1; }
  const next = lo + 1 < stations.length ? lo + 1 : 0, t = sample.tangent, u = sample.up;
  const r0 = t[1] * u[2] - t[2] * u[1], r1 = t[2] * u[0] - t[0] * u[2], r2 = t[0] * u[1] - t[1] * u[0];
  left[0] = sample.pos[0] - r0 * RAIL.halfGauge; left[1] = sample.pos[1] - r1 * RAIL.halfGauge; left[2] = sample.pos[2] - r2 * RAIL.halfGauge;
  right[0] = sample.pos[0] + r0 * RAIL.halfGauge; right[1] = sample.pos[1] + r1 * RAIL.halfGauge; right[2] = sample.pos[2] + r2 * RAIL.halfGauge;
  shiftOntoLength(left, rails.left[lo], rails.left[next], shiftLeft);
  shiftOntoLength(right, rails.right[lo], rails.right[next], shiftRight);
  for (let k = 0; k < 3; k++) sample.pos[k] += (shiftLeft[k] + shiftRight[k]) / 2;
  const roll = ((shiftLeft[0] - shiftRight[0]) * u[0] + (shiftLeft[1] - shiftRight[1]) * u[1] + (shiftLeft[2] - shiftRight[2]) * u[2]) / (2 * RAIL.halfGauge);
  u[0] += roll * r0; u[1] += roll * r1; u[2] += roll * r2;
  const n = Math.hypot(u[0], u[1], u[2]); u[0] /= n; u[1] /= n; u[2] /= n;
}
