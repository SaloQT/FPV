/** The spatial checks behind validateTrack: gates on and along the path, path self-separation, start pad and obstacles. */
import type { ObstacleCollider, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { distanceToBox, gateColliders, isRoundObstacle, supportBase } from './colliders';
import { gatePassed } from './gate';
import {
  DROP_ARM, FLY_UNDER_CLEARANCE, FLY_UNDER_SUPPORT_CLEARANCE, isCompositeObstacle, obstacleKeepOuts, obstacleParts, obstacleToWorld, tunnelKeepOuts, windowWall,
} from './kindGeometry';
import type { PathIndex } from './pathIndex';
import { pathTangent, wrapAngle, yawOf } from './spline';
import { WATER_MARGIN, hasFeatures } from './styles';
import type { TrackStats } from './validate';

export const MIN_PATH_SEPARATION = 8;
export const SEPARATION_PROBE = 12;
export const MAX_OBSTACLES = 250;
/** Path samples closer than this along the path never count as a second pass of the track. */
export const SAME_PASS = 24;
export const TREE_CLEARANCE = 4;
export const MARKER_CLEARANCE = 1.5;
/** A path sample this close to a gate box means the drone would clip the frame. */
export const BLOCK_MARGIN = 0.2;

type Err = (message: string) => void;

export function footprint(o: TrackObstacle): number {
  return isRoundObstacle(o.kind) ? o.size[0] : Math.hypot(o.size[0], o.size[2]) / 2;
}

export function isLargeObstacle(o: TrackObstacle): boolean {
  return o.kind === 'tree' || o.kind === 'rock' || o.kind === 'wall';
}

/** Obstacles that keep TREE_CLEARANCE from the line: trees, rocks, walls and the solid structures (flown-under beams and bridges excepted). */
export function keepsTreeClearance(o: TrackObstacle): boolean {
  return isLargeObstacle(o) || (isCompositeObstacle(o.kind) && o.kind !== 'beam' && o.kind !== 'bridge');
}

/** Ground discs (x, z, radius) a gate occupies for obstacle placement: its opening, a window's wall, a tunnel's sleeve, a drop's arm. */
export function gateDiscs(g: TrackGate): { x: number; z: number; r: number }[] {
  let r = Math.max(g.width, g.height) / 2;
  if (g.kind === 'window') r = Math.max(r, windowWall(g).half);
  if (g.kind === 'drop') r += DROP_ARM + 0.2;
  const out = [{ x: g.pos[0], z: g.pos[2], r }];
  if (g.kind === 'tunnel') out.push(...tunnelKeepOuts(g));
  return out;
}

/** Longest stretch of a wall one of its ground discs covers. */
const WALL_DISC = 1;

/**
 * Ground discs an obstacle covers: for a structure several along its long side (kindGeometry keep-outs), for a wall a chain of
 * small discs along its length (so a long thin wall is not one big circle), otherwise one round footprint.
 */
export function obstacleDiscs(o: TrackObstacle): { x: number; z: number; r: number }[] {
  if (isCompositeObstacle(o.kind)) return obstacleKeepOuts(o);
  if (o.kind !== 'wall') return [{ x: o.pos[0], z: o.pos[2], r: footprint(o) }];
  const len = o.size[0];
  const n = Math.max(1, Math.ceil(len / WALL_DISC));
  const seg = len / n;
  const r = 0.5 * Math.hypot(seg, o.size[2]);
  const out: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = obstacleToWorld(o, -len / 2 + seg * (i + 0.5), 0, 0);
    out.push({ x: p[0], z: p[2], r });
  }
  return out;
}

/** True when two sets of ground discs come within `gap` of each other. */
export function discsMeet(a: readonly { x: number; z: number; r: number }[], b: readonly { x: number; z: number; r: number }[], gap: number): boolean {
  for (const p of a) for (const q of b) if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r + gap) return true;
  return false;
}

/** True when an obstacle comes within `gap` of a gate (its opening, a window's wall, a tunnel's sleeve). */
export function touchesGate(g: TrackGate, o: TrackObstacle, gap: number): boolean {
  return discsMeet(gateDiscs(g), obstacleDiscs(o), gap);
}

/**
 * Exact fit of an obstacle against the line on a feature track: how far (metres) the path stays beyond what the obstacle needs,
 * and the raw edge distance. Structures are checked part by part in 3D (beams and bridges: supports FLY_UNDER_SUPPORT_CLEARANCE,
 * deck and rails FLY_UNDER_CLEARANCE, so the line may pass under them; the others TREE_CLEARANCE). Rocks and walls use their exact
 * rectangle, horizontally. Everything else keeps the round footprint the original styles use.
 */
export function obstacleFit(o: TrackObstacle, sampler: TerrainSampler, index: PathIndex): { margin: number; edge: number } {
  const need = keepsTreeClearance(o) ? TREE_CLEARANCE : MARKER_CLEARANCE;
  const path = index.path;
  const hits: number[] = [];
  if (isCompositeObstacle(o.kind)) {
    const under = o.kind === 'beam' || o.kind === 'bridge';
    const reach = Math.hypot(o.size[0], o.size[2]) / 2 + TREE_CLEARANCE + 2;
    index.collectXZ(o.pos[0], o.pos[2], reach, hits);
    let margin = Infinity;
    let edge = Infinity;
    for (const p of obstacleParts(o, supportBase(o, sampler))) {
      const box: ObstacleCollider = { kind: 'box', center: obstacleToWorld(o, p.c[0], p.c[1], p.c[2]), half: p.h, yaw: o.yaw };
      const want = under ? (p.role === 'support' ? FLY_UNDER_SUPPORT_CLEARANCE : FLY_UNDER_CLEARANCE) : TREE_CLEARANCE;
      for (const j of hits) {
        const d = distanceToBox(box, path[j][0], path[j][1], path[j][2]);
        if (d < edge) edge = d;
        if (d - want < margin) margin = d - want;
      }
    }
    return { margin, edge };
  }
  if (o.kind === 'rock' || o.kind === 'wall') {
    const reach = footprint(o) + need + 2;
    index.collectXZ(o.pos[0], o.pos[2], reach, hits);
    let edge = reach;
    for (const j of hits) {
      const box: ObstacleCollider = { kind: 'box', center: [o.pos[0], path[j][1], o.pos[2]], half: [o.size[0] / 2, 1, o.size[2] / 2], yaw: o.yaw };
      edge = Math.min(edge, distanceToBox(box, path[j][0], path[j][1], path[j][2]));
    }
    return { margin: edge - need, edge };
  }
  index.nearestXZ(o.pos[0], o.pos[2]);
  const edge = index.lastDist - footprint(o);
  return { margin: edge - need, edge };
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
    if ((g.kind === 'dive' || g.kind === 'drop') && Math.abs(g.pitch - Math.asin(Math.max(-1, Math.min(1, t[1])))) > 0.35) err(`gate ${i}: pitch disagrees with the path slope`);
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
  /** Feature tracks check obstacles against their exact shapes; the original styles keep the round footprints they were built with. */
  const exact = hasFeatures(track.style);
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
    if (exact) {
      const fit = obstacleFit(o, sampler, index);
      if (keepsTreeClearance(o)) stats.minObstacleClearance = Math.min(stats.minObstacleClearance, fit.edge);
      if (fit.margin < -1e-6) err(`obstacle ${i} (${o.kind}): ${fit.edge.toFixed(1)} m from the path`);
      for (const g of gates) if (touchesGate(g, o, 0.5)) err(`obstacle ${i} (${o.kind}): touches gate ${g.index}`);
      continue;
    }
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
