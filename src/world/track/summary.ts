/** Track summary for the UI (track select screen, HUD lap info). */
import type { TrackData } from '../../contracts';
import { pathCurvature } from './spline';

export interface TrackSummary {
  gates: number;
  /** Length of the whole course: one lap x laps for closed tracks. */
  lengthM: number;
  lengthLapM: number;
  /** Sum of the climbs along one lap (descents do not count). */
  elevationGainM: number;
  /** Tightest curvature along the path, in 1/m. */
  maxCurvature: number;
  /** Time-averaged speed of a fast but sensible pilot: a lateral-acceleration-limited speed at every path sample. */
  avgSpeedHintMs: number;
}

/** A racing quad pulls roughly 2.5 g in a corner and tops out around 30 m/s on a tight course. */
const LATERAL_ACCEL = 25;
const TOP_SPEED = 30;
const MIN_SPEED = 6;

export function describeTrack(track: TrackData): TrackSummary {
  const { path, closed } = track;
  const m = path.length;
  const kappa = pathCurvature(path, closed, 2);
  let maxCurvature = 0;
  let gain = 0;
  let time = 0;
  let dist = 0;
  const edges = closed ? m : m - 1;
  for (let i = 0; i < edges; i++) {
    const a = path[i];
    const b = path[(i + 1) % m];
    const ds = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (b[1] > a[1]) gain += b[1] - a[1];
    const k = Math.max(kappa[i], kappa[(i + 1) % m]);
    if (k > maxCurvature) maxCurvature = k;
    const v = Math.min(Math.max(Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-6)), MIN_SPEED), TOP_SPEED);
    time += ds / v;
    dist += ds;
  }
  const laps = closed ? track.laps : 1;
  return {
    gates: track.gates.length,
    lengthM: track.length * laps,
    lengthLapM: track.length,
    elevationGainM: gain,
    maxCurvature,
    avgSpeedHintMs: time > 0 ? Math.min(dist / time, TOP_SPEED) : TOP_SPEED,
  };
}
