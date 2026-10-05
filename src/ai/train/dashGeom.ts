/**
 * Static geometry of a training world for the live training dashboard (tools/brain/dashServer.mjs): a downsampled height grid,
 * the gates with their opening outlines in world space, the centreline, the obstacles and the track's collider boxes. Every
 * value is a plain number, string, boolean or null, rounded, so the result goes straight through JSON.stringify.
 */
import type { TrackGate, Vec3 } from '../../contracts';
import { GATE_COLORS } from '../../ui/trackPreviewModel';
import { isRoundObstacle, trackColliders } from '../../world/track/colliders';
import { archSpring, trackGateFrame } from '../../world/track/gate';
import type { TrainWorld } from './worlds';

/** Side of the downsampled height grid. */
export const DASH_GRID = 128;
/** Most centreline points sent per world. */
export const DASH_PATH_MAX = 1500;

export interface DashTerrain {
  /** World (x, z) of grid sample (0, 0) and of the full-resolution sample (0, 0); the grid spans the same square. */
  origin: [number, number];
  /** The full-resolution terrain: metres between samples and samples per side. */
  cellSize: number;
  resolution: number;
  /** The downsampled grid: `n` x `n` samples `step` metres apart, row-major (index j * n + i, i along +X, j along +Z). */
  n: number;
  step: number;
  /** Block-averaged heights, rounded to 0.1 m. */
  height: number[];
  min: number;
  max: number;
  /** Water surface height, or null when the map has no water. */
  water: number | null;
}

export interface DashGate {
  index: number;
  kind: string;
  /** Map colour of the kind (src/ui/trackPreviewModel.ts GATE_COLORS). */
  color: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  width: number;
  height: number;
  /** The manoeuvre the gate belongs to (split-s, power-loop, ...), or null. */
  feature: string | null;
  /** Tunnel sleeve length, metres, or null. */
  depth: number | null;
  /** Unit travel direction through the opening. */
  forward: Vec3;
  /** Closed loop of world points round the clear opening. */
  outline: Vec3[];
}

export interface DashObstacle {
  kind: string;
  pos: Vec3;
  yaw: number;
  size: Vec3;
  /** size is (radius, height, radius) rather than full extents. */
  round: boolean;
}

export interface DashBox {
  center: Vec3;
  half: Vec3;
  yaw: number;
}

export interface DashWorld {
  index: number;
  style: string;
  seed: number;
  closed: boolean;
  laps: number;
  /** Centreline length, metres. */
  length: number;
  start: { pos: Vec3; yaw: number };
  terrain: DashTerrain;
  gates: DashGate[];
  /** Thinned centreline: x, y, z, arc length s from the first point, ground height under the point. */
  path: [number, number, number, number, number][];
  obstacles: DashObstacle[];
  /** The track's own collider boxes (gate frames and obstacles). */
  boxes: DashBox[];
  /** Trees and rocks the drones also collide with (not sent, only counted). */
  vegetationColliders: number;
}

// `+ 0` turns -0 into 0, which JSON writes as 0 anyway.
const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const v2 = (v: readonly number[]): Vec3 => [r2(v[0]), r2(v[1]), r2(v[2])];

/** The JSON the dashboard draws world `index` from. */
export function worldGeometry(w: TrainWorld, index: number): DashWorld {
  const track = w.track;
  const boxes = trackColliders(track, w.sampler);
  return {
    index,
    style: track.style ?? w.style,
    seed: w.seed,
    closed: track.closed,
    laps: track.laps,
    length: r1(track.length),
    start: { pos: v2(track.start.pos), yaw: r4(track.start.yaw) },
    terrain: downsampleTerrain(w),
    gates: track.gates.map(dashGate),
    path: thinPath(w),
    obstacles: track.obstacles.map((o) => ({ kind: o.kind, pos: v2(o.pos), yaw: r4(o.yaw), size: v2(o.size), round: isRoundObstacle(o.kind) })),
    boxes: boxes.map((b) => ({ center: v2(b.center), half: v2(b.half), yaw: r4(b.yaw) })),
    vegetationColliders: Math.max(0, w.colliders.length - boxes.length),
  };
}

function downsampleTerrain(w: TrainWorld): DashTerrain {
  const t = w.terrain;
  const res = t.resolution;
  const n = Math.min(DASH_GRID, res);
  const ratio = (res - 1) / (n - 1);
  const reach = Math.floor(ratio / 2);
  const height = new Array<number>(n * n);
  for (let j = 0; j < n; j++) {
    const cj = Math.round(j * ratio);
    const j0 = Math.max(0, cj - reach), j1 = Math.min(res - 1, cj + reach);
    for (let i = 0; i < n; i++) {
      const ci = Math.round(i * ratio);
      const i0 = Math.max(0, ci - reach), i1 = Math.min(res - 1, ci + reach);
      let sum = 0;
      for (let b = j0; b <= j1; b++) for (let a = i0; a <= i1; a++) sum += t.height[b * res + a];
      height[j * n + i] = r1(sum / ((j1 - j0 + 1) * (i1 - i0 + 1)));
    }
  }
  return {
    origin: [r2(t.origin[0]), r2(t.origin[1])],
    cellSize: t.cellSize,
    resolution: res,
    n,
    step: r4(ratio * t.cellSize),
    height,
    min: r1(t.minHeight),
    max: r1(t.maxHeight),
    water: Number.isFinite(t.waterLevel) ? r2(t.waterLevel) : null,
  };
}

function dashGate(g: TrackGate): DashGate {
  const f = trackGateFrame(g);
  const outline = openingLoop(g).map(([u, v]): Vec3 => [
    r2(g.pos[0] + u * f.right[0] + v * f.up[0]),
    r2(g.pos[1] + u * f.right[1] + v * f.up[1]),
    r2(g.pos[2] + u * f.right[2] + v * f.up[2]),
  ]);
  return {
    index: g.index,
    kind: g.kind,
    color: (GATE_COLORS as Record<string, string>)[g.kind] ?? '#ffffff',
    pos: v2(g.pos),
    yaw: r4(g.yaw),
    pitch: r4(g.pitch),
    roll: r4(g.roll),
    width: r2(g.width),
    height: r2(g.height),
    feature: g.feature ?? null,
    depth: g.depth !== undefined && Number.isFinite(g.depth) ? r2(g.depth) : null,
    forward: [r4(f.forward[0]), r4(f.forward[1]), r4(f.forward[2])],
    outline,
  };
}

/** In-plane points (u along right, v along up) walking once round the clear opening, as src/world/track/gate.ts shapes it. */
export function openingLoop(g: Pick<TrackGate, 'kind' | 'width' | 'height'>): [number, number][] {
  const hw = g.width / 2;
  const hh = g.height / 2;
  const out: [number, number][] = [];
  if (g.kind === 'hoop' || g.kind === 'dive' || g.kind === 'drop') {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      out.push([hw * Math.cos(a), hh * Math.sin(a)]);
    }
    return out;
  }
  if (g.kind === 'arch') {
    const vs = archSpring(g as TrackGate);
    out.push([-hw, -hh], [hw, -hh]);
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI;
      out.push([hw * Math.cos(a), vs + hw * Math.sin(a)]);
    }
    return out;
  }
  out.push([-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]);
  return out;
}

/** Every k-th centreline point (and the last), with the arc length measured on the full path and the ground under it. */
function thinPath(w: TrainWorld): [number, number, number, number, number][] {
  const p = w.track.path;
  const n = p.length;
  if (n === 0) return [];
  const stride = Math.max(1, Math.ceil(n / DASH_PATH_MAX));
  const out: [number, number, number, number, number][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
    if (i % stride === 0 || i === n - 1) out.push([r2(p[i][0]), r2(p[i][1]), r2(p[i][2]), r1(s), r1(w.sampler.heightAt(p[i][0], p[i][2]))]);
  }
  // A path whose length is not a multiple of the stride can end one point over the cap with the last point added.
  if (out.length > DASH_PATH_MAX) out.splice(out.length - 2, 1);
  return out;
}
