/** Track validation: everything the generator guarantees, checked again from the finished TrackData alone. */
import type { TerrainSampler, TrackData } from '../../contracts';
import { gateClearance, gateSiteSlope } from './clearance';
import { PathIndex } from './pathIndex';
import { pathCurvature } from './spline';
import {
  FALLBACK_MIN_GATES,
  MAX_CURVATURE,
  MAX_DIVE_GATE_SLOPE,
  MAX_GATE_SLOPE,
  MIN_BOTTOM_CLEARANCE,
  MIN_GATE_SPACING,
  MIN_PATH_AGL,
  STYLE_SPECS,
  WATER_MARGIN,
} from './styles';
import { MAX_OBSTACLES, MIN_PATH_SEPARATION, SEPARATION_PROBE, checkGates, checkSeparation, checkStartAndObstacles } from './validateParts';

export interface TrackStats {
  gateCount: number;
  lengthM: number;
  minGateSpacing: number;
  maxCurvature: number;
  minPathAgl: number;
  minGateClearance: number;
  maxGateSlopeDeg: number;
  /** Smallest horizontal distance between path samples that are far apart along the path (capped at SEPARATION_PROBE). */
  minPathSeparation: number;
  elevationGainM: number;
  elevationStd: number;
  closureGapM: number;
  obstacleCount: number;
  /** Smallest edge-to-path distance over trees/rocks/walls (Infinity when there are none). */
  minObstacleClearance: number;
}

export interface TrackValidation {
  ok: boolean;
  errors: string[];
  stats: TrackStats;
}

export { MAX_OBSTACLES, MIN_PATH_SEPARATION, SEPARATION_PROBE };

/** Checks the whole track. `kappa` may pass a precomputed pathCurvature(path, closed, 2) to save a pass. */
export function validateTrack(track: TrackData, sampler: TerrainSampler, kappa?: Float32Array): TrackValidation {
  const errors: string[] = [];
  const err = (m: string): void => {
    if (errors.length < 40) errors.push(m);
  };
  const spec = STYLE_SPECS[track.style];
  const d = sampler.data;
  const extent = d.resolution * d.cellSize;
  const cx = d.origin[0] + extent / 2;
  const cz = d.origin[1] + extent / 2;
  const waterFloor = d.waterLevel + WATER_MARGIN;
  const { gates, path, obstacles } = track;
  const n = gates.length;
  const m = path.length;
  const stats: TrackStats = {
    gateCount: n,
    lengthM: track.length,
    minGateSpacing: Infinity,
    maxCurvature: 0,
    minPathAgl: Infinity,
    minGateClearance: Infinity,
    maxGateSlopeDeg: 0,
    minPathSeparation: SEPARATION_PROBE,
    elevationGainM: 0,
    elevationStd: 0,
    closureGapM: 0,
    obstacleCount: obstacles.length,
    minObstacleClearance: Infinity,
  };

  if (n < FALLBACK_MIN_GATES || n > spec.maxGates) err(`gate count ${n} outside ${FALLBACK_MIN_GATES}..${spec.maxGates}`);
  if (track.closed !== spec.closed) err(`closed flag ${track.closed} but ${track.style} tracks are ${spec.closed ? 'closed' : 'open'}`);
  if (track.style === 'race' && gates[0]?.kind !== 'start') err('race track must begin with a start gate');
  if (track.style === 'sprint' && gates[n - 1]?.kind !== 'finish') err('sprint track must end with a finish gate');
  if (!Number.isInteger(track.laps) || track.laps < 1) err(`laps ${track.laps} is not a positive integer`);
  if (m < 10 || n === 0) {
    err('path or gates missing');
    return { ok: false, errors, stats };
  }

  for (let i = 0; i < n; i++) {
    const g = gates[i];
    const dive = g.kind === 'dive';
    if (g.index !== i) err(`gate ${i}: index ${g.index}`);
    if (!g.pos.every(Number.isFinite) || !Number.isFinite(g.yaw)) {
      err(`gate ${i}: non-finite pose`);
      continue;
    }
    const clear = gateClearance(g, sampler);
    stats.minGateClearance = Math.min(stats.minGateClearance, clear);
    if (clear < MIN_BOTTOM_CLEARANCE - 1e-3) err(`gate ${i}: opening only ${clear.toFixed(2)} m above ground`);
    if (sampler.heightAt(g.pos[0], g.pos[2]) < waterFloor - 1e-6) err(`gate ${i}: in or next to water`);
    const slope = gateSiteSlope(sampler, g.pos[0], g.pos[2]);
    stats.maxGateSlopeDeg = Math.max(stats.maxGateSlopeDeg, (slope * 180) / Math.PI);
    if (slope > (dive ? MAX_DIVE_GATE_SLOPE : MAX_GATE_SLOPE) + 1e-3) err(`gate ${i}: site slope ${((slope * 180) / Math.PI).toFixed(1)} deg`);
    if (Math.hypot(g.pos[0] - cx, g.pos[2] - cz) > spec.corridor * extent + 1e-3) err(`gate ${i}: outside the ${spec.corridor} extent corridor`);
    if (!dive && g.pitch !== 0) err(`gate ${i}: only dive gates may be pitched`);
    for (let j = 0; j < i; j++) {
      const s = Math.hypot(g.pos[0] - gates[j].pos[0], g.pos[1] - gates[j].pos[1], g.pos[2] - gates[j].pos[2]);
      stats.minGateSpacing = Math.min(stats.minGateSpacing, s);
      if (s < MIN_GATE_SPACING) err(`gates ${j} and ${i}: only ${s.toFixed(1)} m apart`);
    }
  }

  let len = 0;
  let sum = 0;
  let sum2 = 0;
  let gain = 0;
  let outside = false;
  const edges = track.closed ? m : m - 1;
  for (let i = 0; i < m; i++) {
    const p = path[i];
    if (!p.every(Number.isFinite)) {
      err(`path sample ${i}: non-finite`);
      return { ok: false, errors, stats };
    }
    const agl = p[1] - sampler.heightAt(p[0], p[2]);
    stats.minPathAgl = Math.min(stats.minPathAgl, agl);
    sum += p[1];
    sum2 += p[1] * p[1];
    if (Math.hypot(p[0] - cx, p[2] - cz) > spec.corridor * extent + 15) outside = true;
  }
  for (let i = 0; i < edges; i++) {
    const a = path[i];
    const b = path[(i + 1) % m];
    const s = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    len += s;
    if (b[1] > a[1]) gain += b[1] - a[1];
    if (s < 0.5 || s > 1.5) err(`path spacing ${s.toFixed(2)} m at sample ${i}`);
  }
  stats.elevationGainM = gain;
  stats.elevationStd = Math.sqrt(Math.max(sum2 / m - (sum / m) ** 2, 0));
  if (track.closed) stats.closureGapM = Math.hypot(path[m - 1][0] - path[0][0], path[m - 1][1] - path[0][1], path[m - 1][2] - path[0][2]);
  if (stats.minPathAgl < MIN_PATH_AGL - 1e-3) err(`path comes within ${stats.minPathAgl.toFixed(2)} m of the ground`);
  if (track.closed && stats.closureGapM > 1.5) err(`closed loop gap ${stats.closureGapM.toFixed(2)} m`);
  if (Math.abs(len - track.length) > 0.02 * len + 1) err(`length ${track.length.toFixed(1)} disagrees with the path (${len.toFixed(1)})`);
  if (track.length < spec.minLength || track.length > spec.maxLength) err(`length ${track.length.toFixed(0)} m outside ${spec.minLength}..${spec.maxLength}`);

  const k = kappa ?? pathCurvature(path, track.closed, 2);
  for (let i = 0; i < m; i++) if (k[i] > stats.maxCurvature) stats.maxCurvature = k[i];
  if (stats.maxCurvature > MAX_CURVATURE) err(`path curvature ${stats.maxCurvature.toFixed(3)} exceeds ${MAX_CURVATURE.toFixed(3)} (radius ${(1 / stats.maxCurvature).toFixed(1)} m)`);

  const index = new PathIndex(path);
  checkGates(track, sampler, index, err);
  checkSeparation(track, index, stats, err);
  checkStartAndObstacles(track, sampler, index, stats, err);
  if (outside) err('path leaves the corridor');
  return { ok: errors.length === 0, errors, stats };
}
