/** The spatial checks behind validateTrack: gates on and along the path, path self-separation, start pad and obstacles. */
import type { ObstacleCollider, TerrainSampler, TrackData, TrackObstacle, Vec3 } from '../../contracts';
import { distanceToBox, gateColliders, isRoundObstacle } from './colliders';
import { gatePassed } from './gate';
import type { PathIndex } from './pathIndex';
import { pathTangent, wrapAngle, yawOf } from './spline';
import { WATER_MARGIN } from './styles';
import type { TrackStats } from './validate';

export const MIN_PATH_SEPARATION = 8;
export const SEPARATION_PROBE = 12;
export const MAX_OBSTACLES = 250;
/** Path samples closer than this along the path never count as a second pass of the track. */
const SAME_PASS = 24;
export const TREE_CLEARANCE = 4;
export const MARKER_CLEARANCE = 1.5;
/** A path sample this close to a gate box means the drone would clip the frame. */
const BLOCK_MARGIN = 0.2;

type Err = (message: string) => void;

export function footprint(o: TrackObstacle): number {
  return isRoundObstacle(o.kind) ? o.size[0] : Math.hypot(o.size[0], o.size[2]) / 2;
}

export function isLargeObstacle(o: TrackObstacle): boolean {
  return o.kind === 'tree' || o.kind === 'rock' || o.kind === 'wall';
}

/** Gates sit on the path in order, face along it, are crossed by it, and their frames stay clear of it. */
export function checkGates(track: TrackData, sampler: TerrainSampler, index: PathIndex, err: Err): void {
  const { gates, path, closed } = track;
  const m = path.length;
  const t: Vec3 = [0, 0, 0];
  const boxes: ObstacleCollider[] = [];
  let prev = -1;
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    const at = index.nearest(g.pos[0], g.pos[1], g.pos[2]);
    if (index.lastDist > 0.75) {
      err(`gate ${i}: ${index.lastDist.toFixed(2)} m off the path`);
      continue;
    }
    if (at <= prev) err(`gate ${i}: out of order along the path`);
    prev = at;
    pathTangent(path, at, closed, t);
    if (Math.hypot(t[0], t[2]) > 0.2 && Math.abs(wrapAngle(g.yaw - yawOf(t[0], t[2]))) > 0.3) err(`gate ${i}: yaw disagrees with the path heading`);
    if (g.kind === 'dive' && Math.abs(g.pitch - Math.asin(t[1])) > 0.35) err(`gate ${i}: pitch disagrees with the path slope`);
    const a = closed ? path[(at - 3 + m) % m] : path[at - 3];
    const b = closed ? path[(at + 3) % m] : path[at + 3];
    if (a && b && !gatePassed(g, a, b)) err(`gate ${i}: the path does not cross its opening`);
    boxes.length = 0;
    gateColliders(g, sampler, boxes);
    blocked: for (let o = -8; o <= 8; o++) {
      const j = closed ? (at + o + m) % m : at + o;
      if (j < 0 || j >= m) continue;
      for (const box of boxes) {
        if (distanceToBox(box, path[j][0], path[j][1], path[j][2]) < BLOCK_MARGIN) {
          err(`gate ${i}: frame blocks the path`);
          break blocked;
        }
      }
    }
  }
}

/** Two stretches of path that are far apart along it must stay >= MIN_PATH_SEPARATION apart horizontally. */
export function checkSeparation(track: TrackData, index: PathIndex, stats: TrackStats, err: Err): void {
  const path = track.path;
  const m = path.length;
  const hits: number[] = [];
  for (let i = 0; i < m; i++) {
    hits.length = 0;
    index.collectXZ(path[i][0], path[i][2], SEPARATION_PROBE, hits);
    for (const j of hits) {
      if (j <= i) continue;
      const apart = track.closed ? Math.min(j - i, m - (j - i)) : j - i;
      if (apart <= SAME_PASS) continue;
      const dist = Math.hypot(path[j][0] - path[i][0], path[j][2] - path[i][2]);
      if (dist < stats.minPathSeparation) stats.minPathSeparation = dist;
    }
  }
  if (stats.minPathSeparation < MIN_PATH_SEPARATION) err(`path passes itself within ${stats.minPathSeparation.toFixed(1)} m`);
}

export function checkStartAndObstacles(track: TrackData, sampler: TerrainSampler, index: PathIndex, stats: TrackStats, err: Err): void {
  const d = sampler.data;
  const waterFloor = d.waterLevel + WATER_MARGIN;
  const extent = (d.resolution * d.cellSize) / 2;
  const { start, gates, obstacles } = track;
  const g0 = gates[0];
  const ground = sampler.heightAt(start.pos[0], start.pos[2]);
  if (Math.abs(start.pos[1] - ground) > 0.05) err('start pad is not on the ground');
  if (ground < waterFloor) err('start pad is in or next to water');
  const back = Math.hypot(g0.pos[0] - start.pos[0], g0.pos[2] - start.pos[2]);
  if (back < 8 - 1e-3 || back > 12 + 1e-3) err(`start pad is ${back.toFixed(1)} m from the first gate`);
  if (Math.abs(wrapAngle(start.yaw - yawOf(g0.pos[0] - start.pos[0], g0.pos[2] - start.pos[2]))) > 0.02) err('start yaw does not face the first gate');
  if (obstacles.length > MAX_OBSTACLES) err(`${obstacles.length} obstacles (max ${MAX_OBSTACLES})`);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const fp = footprint(o);
    if (!o.pos.every(Number.isFinite) || !o.size.every((s) => Number.isFinite(s) && s > 0)) {
      err(`obstacle ${i}: bad pose or size`);
      continue;
    }
    const h = sampler.heightAt(o.pos[0], o.pos[2]);
    if (Math.abs(o.pos[1] - h) > 0.05) err(`obstacle ${i} (${o.kind}): not on the ground`);
    if (h < d.waterLevel + 0.1) err(`obstacle ${i} (${o.kind}): in water`);
    if (Math.abs(o.pos[0] - d.origin[0] - extent) > extent || Math.abs(o.pos[2] - d.origin[1] - extent) > extent) err(`obstacle ${i}: off the map`);
    index.nearestXZ(o.pos[0], o.pos[2]);
    const edge = index.lastDist - fp;
    const large = isLargeObstacle(o);
    if (large) stats.minObstacleClearance = Math.min(stats.minObstacleClearance, edge);
    if (edge < (large ? TREE_CLEARANCE : MARKER_CLEARANCE) - 1e-6) err(`obstacle ${i} (${o.kind}): ${edge.toFixed(1)} m from the path`);
    for (const g of gates) {
      if (Math.hypot(o.pos[0] - g.pos[0], o.pos[2] - g.pos[2]) < Math.max(g.width, g.height) / 2 + fp + 0.5) err(`obstacle ${i} (${o.kind}): touches gate ${g.index}`);
    }
  }
}
