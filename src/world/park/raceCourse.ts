/**
 * The park's drone race: a closed course that weaves through the built park, low over the walkways, past the rides and under coaster
 * track wherever the gap allows. Planning runs on a 2 m voxel grid in which every static solid, every flat ride's swept envelope and
 * every coaster train's envelope along its rails is grown by RACE.clearance. A loop visits a ring of rides in turn around the park,
 * the line is smoothed, then given the lowest height that climbs no steeper than RACE.climb and keeps clear of everything above and
 * below it. Every metre of the finished line is then checked exactly against the real part shapes and envelopes, and gates go on the
 * straights where their bars and legs touch nothing and no leg stands on a walkway.
 *
 * Trees are left to the final planting pass, which removes every tree whose mature envelope reaches a route (planting.ts), so the line
 * only prefers to avoid them. The ride envelopes were measured over 300 s of running (.bench/park-race/envelopes.mjs) and
 * raceCourse.test.ts runs the rides again to check that no moving part comes near the line.
 */
import type { TerrainSampler, TrackData, TrackGate, Vec3 } from '../../contracts';
import { gateColliders } from '../track/colliders';
import { Rng, deriveSeed } from '../track/rng';
import { PartBVH, partDistance } from './collision';
import { railSample, sampleRail } from './curve';
import { inverseRotate } from './math';
import { plantingBounds, plantingProxies } from './planting';
import { PARK_GRADE } from './surfaces';
import type { CoasterFamily, FlatFamily, ParkData, ParkPart, RideDefinition } from './types';

export const RACE = {
  /** Planning clearance: every solid and ride envelope is grown by this much (metres) before the course is routed. */
  clearance: 3,
  /** Exact clearance every metre of the finished line keeps from solids and ride envelopes. */
  exact: 2.2,
  /** Lowest and highest line height above the park grade, metres. */
  low: 5,
  ceiling: 40,
  /** Planning grid cell, metres (layers are 1 m). */
  cell: 2,
  /** Distance between gates along the line, metres (each gap varies by a fifth either way). */
  gateSpacing: 65,
  /** How far from a walkway the line may stray, metres. */
  walkwayReach: 60,
  /** Gate frames and legs keep this far from park solids, metres. */
  gateClearance: 0.25,
  laps: 2,
} as const;

/** How far each flat ride's moving parts reach from the ride centre, and how high above its base, measured and then padded by 1.5 m. */
export const FLAT_ENVELOPE: Record<FlatFamily, { reach: number; top: number }> = {
  wheel: { reach: 28, top: 56.5 }, carousel: { reach: 18.5, top: 25.7 }, swings: { reach: 18.5, top: 40 }, ship: { reach: 24.2, top: 32 },
  pendulum: { reach: 27.6, top: 35.1 }, drop: { reach: 7.6, top: 64.6 }, teacups: { reach: 16.8, top: 17.3 }, scrambler: { reach: 10.1, top: 9 },
  observation: { reach: 8.9, top: 53.8 }, enterprise: { reach: 16.1, top: 21.1 }, topspin: { reach: 14.4, top: 23.8 },
};

/** How far a coaster train's moving parts reach from the rail centreline, measured and then padded by 0.5 m. */
export function trainEnvelope(family: CoasterFamily): { above: number; below: number; side: number } {
  return family === 'inverted' ? { above: 1.4, below: 2.65, side: 2.1 } : { above: 3, below: 1.65, side: 2.3 };
}

/** Tightest turn the line keeps where the space allows, metres. */
const RACE_TURN = 15;
/** Metres of line per height step. */
const HEIGHT_STEP = 4;
/** Most whole-metre layers the line may change between height steps, and the cost of each size of change: one layer per step
 * (a climb of 1 in 4) is cheap, steeper climbs cost the square of their size and are used only where nothing gentler fits. */
const MAX_LAYER_CHANGE = 8;
const LAYER_CHANGE_COST = Array.from({ length: MAX_LAYER_CHANGE + 1 }, (_, d) => d === 0 ? 0 : d === 1 ? 3 : 12 * d * d);
/** Slabs at least this wide each way (half size, metres) are roofs: the space under them is closed. */
const ROOF_HALF = 6;
/** Columns this close to a coaster rail in plan count as park, metres. */
const RAIL_REACH = 30;
/** Dead-end detours: a stretch this long (metres) within this gap of the route further than this along it. */
const DETOUR_RUN = 40;
const DETOUR_GAP = 30;
const DETOUR_APART = 120;
const RAIL_STEP = 0.5;
const HASH = 8;
const hashKey = (x: number, z: number): number => (Math.floor(x / HASH) + 512) * 1024 + Math.floor(z / HASH) + 512;

/** World box round a part, for the part tree. */
function partBox(part: ParkPart, out: Float64Array, o: number): void {
  const [x, y, z, w] = part.rot, h = part.half;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  for (let r = 0; r < 3; r++) {
    const e = Math.abs(m[r * 3]) * h[0] + Math.abs(m[r * 3 + 1]) * h[1] + Math.abs(m[r * 3 + 2]) * h[2];
    out[o + r] = part.pos[r] - e; out[o + 3 + r] = part.pos[r] + e;
  }
}

/** Exact distances from a point to the park's static solids and to the swept envelopes of its rides. */
export class RaceClearance {
  readonly solids: ParkPart[];
  readonly boxes: Float64Array;
  private readonly tree: PartBVH;
  private readonly trees: Set<ParkPart>;
  private readonly flats: RideDefinition[];
  private readonly rails: { pos: Float64Array; up: Float64Array; along: Float64Array; env: { above: number; below: number; side: number }; hash: Map<number, number[]> }[] = [];
  private readonly local: Vec3 = [0, 0, 0];
  private readonly normal: Vec3 = [0, 0, 0];
  /** `except`: a coaster whose trains are left out of `rides` (the one a follow-the-coaster guide flies beside). */
  constructor(readonly park: ParkData, except?: number) {
    this.solids = park.parts.filter(p => p.solid && p.body < 0); this.trees = plantingProxies(park);
    this.boxes = new Float64Array(this.solids.length * 6); this.solids.forEach((p, i) => partBox(p, this.boxes, i * 6));
    this.tree = new PartBVH(this.solids, this.boxes);
    this.flats = park.rides.filter(r => !r.curve);
    const s = railSample();
    for (const ride of park.rides) if (ride.curve && ride.id !== except) {
      const n = Math.ceil(ride.curve.length / RAIL_STEP), pos = new Float64Array(n * 3), up = new Float64Array(n * 3), along = new Float64Array(n * 3), hash = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        sampleRail(ride.curve, i * RAIL_STEP, s);
        for (let k = 0; k < 3; k++) { pos[i * 3 + k] = s.pos[k]; up[i * 3 + k] = s.up[k]; along[i * 3 + k] = s.tangent[k]; }
        const key = hashKey(s.pos[0], s.pos[2]), list = hash.get(key); if (list) list.push(i); else hash.set(key, [i]);
      }
      this.rails.push({ pos, up, along, env: trainEnvelope(ride.family as CoasterFamily), hash });
    }
  }
  /** Distance to the nearest static solid; tree stand-ins count only when `trees` is set (the planting pass clears them off the line). */
  solid(x: number, y: number, z: number, trees = false): number {
    return this.tree.nearest(x, y, z, i => {
      const part = this.solids[i];
      if (!trees && this.trees.has(part)) return Infinity;
      const l = this.local; l[0] = x - part.pos[0]; l[1] = y - part.pos[1]; l[2] = z - part.pos[2];
      return partDistance(part, inverseRotate(part.rot, l, l), this.normal);
    });
  }
  /** Distance to the nearest flat-ride envelope or coaster-train envelope (negative inside), capped at about 8 m for trains. */
  rides(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const r of this.flats) {
      const e = FLAT_ENVELOPE[r.family as FlatFamily], radial = Math.hypot(x - r.pos[0], z - r.pos[2]) - e.reach;
      const vertical = Math.max(PARK_GRADE - 1 - y, y - (r.pos[1] + e.top));
      best = Math.min(best, radial > 0 || vertical > 0 ? Math.hypot(Math.max(radial, 0), Math.max(vertical, 0)) : Math.max(radial, vertical));
    }
    for (const rail of this.rails) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = rail.hash.get(hashKey(x + dx * HASH, z + dz * HASH)); if (!list) continue;
      const { pos, up, along, env } = rail;
      for (const i of list) {
        const o = i * 3, px = x - pos[o], py = y - pos[o + 1], pz = z - pos[o + 2];
        const a = px * along[o] + py * along[o + 1] + pz * along[o + 2], u = px * up[o] + py * up[o + 1] + pz * up[o + 2];
        const side = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - a * a - u * u));
        const ds = side - env.side, du = Math.max(u - env.above, -env.below - u), da = Math.abs(a) - RAIL_STEP;
        best = Math.min(best, ds > 0 || du > 0 || da > 0 ? Math.hypot(Math.max(ds, 0), Math.max(du, 0), Math.max(da, 0)) : Math.max(ds, du, da));
      }
    }
    return best;
  }
  distance(x: number, y: number, z: number): number { return Math.min(this.solid(x, y, z), this.rides(x, y, z)); }
  /** World boxes that hold the ride envelopes `rides` measures: one per flat ride, one per 8 m of coaster rail. */
  rideBounds(): [Vec3, Vec3][] {
    const out: [Vec3, Vec3][] = [];
    for (const r of this.flats) {
      const e = FLAT_ENVELOPE[r.family as FlatFamily];
      out.push([[r.pos[0] - e.reach, PARK_GRADE - 1, r.pos[2] - e.reach], [r.pos[0] + e.reach, r.pos[1] + e.top, r.pos[2] + e.reach]]);
    }
    const chunk = Math.round(HASH / RAIL_STEP);
    for (const { pos, env } of this.rails) {
      const grow = Math.max(env.above, env.below, env.side) + RAIL_STEP, n = pos.length / 3;
      for (let a = 0; a < n; a += chunk) {
        const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (let i = a; i < Math.min(n, a + chunk + 1); i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k] - grow); hi[k] = Math.max(hi[k], pos[i * 3 + k] + grow); }
        out.push([lo, hi]);
      }
    }
    return out;
  }
}

/** Voxel grid of everything grown by the planning clearance, with each column's lowest open flight layer and its routing cost. */
class PlanGrid {
  readonly nx: number; readonly nz: number; readonly nk: number;
  readonly blocked: Uint8Array;
  readonly lowest: Int16Array;
  readonly cost: Float32Array;
  readonly walkway: Float32Array;
  readonly trees: Uint8Array;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number) {
    this.nx = Math.ceil((x1 - x0) / RACE.cell); this.nz = Math.ceil((z1 - z0) / RACE.cell); this.nk = RACE.ceiling + RACE.clearance + 4;
    this.blocked = new Uint8Array(this.nx * this.nz * this.nk); this.lowest = new Int16Array(this.nx * this.nz).fill(-1);
    this.cost = new Float32Array(this.nx * this.nz).fill(Infinity); this.walkway = new Float32Array(this.nx * this.nz).fill(Infinity); this.trees = new Uint8Array(this.nx * this.nz);
  }
  cellX(x: number): number { return Math.floor((x - this.x0) / RACE.cell); }
  cellZ(z: number): number { return Math.floor((z - this.z0) / RACE.cell); }
  centreX(i: number): number { return this.x0 + (i + 0.5) * RACE.cell; }
  centreZ(j: number): number { return this.z0 + (j + 0.5) * RACE.cell; }
  column(x: number, z: number): number {
    const i = this.cellX(x), j = this.cellZ(z);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  /** Marks every voxel a world box touches. */
  mark(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    const i0 = Math.max(0, this.cellX(minX)), i1 = Math.min(this.nx - 1, this.cellX(maxX)), j0 = Math.max(0, this.cellZ(minZ)), j1 = Math.min(this.nz - 1, this.cellZ(maxZ));
    const k0 = Math.max(0, Math.floor(minY - PARK_GRADE)), k1 = Math.min(this.nk - 1, Math.floor(maxY - PARK_GRADE));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const o = (j * this.nx + i) * this.nk; for (let k = k0; k <= k1; k++) this.blocked[o + k] = 1; }
  }
  open(column: number, k: number): boolean { return k >= 0 && k < this.nk - 1 && !this.blocked[column * this.nk + k] && !this.blocked[column * this.nk + k + 1]; }
  /** Lowest open layer at or above `from` in a column, or -1. */
  openFrom(column: number, from: number): number {
    for (let k = Math.max(from, RACE.low); k <= RACE.ceiling; k++) if (this.open(column, k)) return k;
    return -1;
  }
}

/** Binary heap of grid cells keyed by cost. */
class Heap {
  private items: number[] = []; private keys: number[] = [];
  get size(): number { return this.items.length; }
  push(item: number, key: number): void {
    const a = this.items, k = this.keys; let i = a.length; a.push(item); k.push(key);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; a[i] = a[p]; k[i] = k[p]; i = p; }
    a[i] = item; k[i] = key;
  }
  pop(): number {
    const a = this.items, k = this.keys, top = a[0], item = a.pop()!, key = k.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= a.length) break; if (c + 1 < a.length && k[c + 1] < k[c]) c++; if (k[c] >= key) break; a[i] = a[c]; k[i] = k[c]; i = c; }
      a[i] = item; k[i] = key;
    }
    return top;
  }
}

function buildGrid(park: ParkData, clearance: RaceClearance): PlanGrid {
  const C = RACE.clearance, pad = Math.max(RACE.walkwayReach, RAIL_REACH) + 4;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const cover = (x: number, z: number) => { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); };
  for (const n of park.nodes) cover(n.pos[0], n.pos[2]);
  const s = railSample();
  for (const ride of park.rides) if (ride.curve) for (let at = 0; at < ride.curve.length; at += 4) { sampleRail(ride.curve, at, s); cover(s.pos[0], s.pos[2]); }
  const grid = new PlanGrid(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
  const trees = plantingProxies(park), b = clearance.boxes;
  clearance.solids.forEach((part, i) => {
    if (trees.has(part)) return;
    // Under a roof or any other wide slab the line would be flying indoors, so everything beneath one is closed too.
    const o = i * 6, roof = part.half[0] >= ROOF_HALF && part.half[2] >= ROOF_HALF && (part.shape === 'box' || part.shape === 'gable');
    grid.mark(b[o] - C, roof ? PARK_GRADE - 1 : b[o + 1] - C, b[o + 2] - C, b[o + 3] + C, b[o + 4] + C, b[o + 5] + C);
  });
  for (const ride of park.rides) {
    if (!ride.curve) {
      // The line goes round flat rides, never over them.
      const e = FLAT_ENVELOPE[ride.family as FlatFamily], reach = e.reach + C + RACE.cell * Math.SQRT1_2, top = ride.pos[1] + e.top + C;
      for (let j = grid.cellZ(ride.pos[2] - reach); j <= grid.cellZ(ride.pos[2] + reach); j++) for (let i = grid.cellX(ride.pos[0] - reach); i <= grid.cellX(ride.pos[0] + reach); i++) {
        if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz || Math.hypot(grid.centreX(i) - ride.pos[0], grid.centreZ(j) - ride.pos[2]) > reach) continue;
        grid.mark(grid.centreX(i), PARK_GRADE - 1, grid.centreZ(j), grid.centreX(i), Math.max(top, PARK_GRADE + grid.nk), grid.centreZ(j));
      }
      continue;
    }
    const env = trainEnvelope(ride.family as CoasterFamily), s = railSample(), mid = (env.above - env.below) / 2, r = Math.hypot(env.side, (env.above + env.below) / 2) + C;
    for (let at = 0; at < ride.curve.length; at += 1) {
      sampleRail(ride.curve, at, s);
      const c = [s.pos[0] + s.up[0] * mid, s.pos[1] + s.up[1] * mid, s.pos[2] + s.up[2] * mid];
      grid.mark(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r);
    }
  }
  // Distance from each column to the nearest walkway centreline, so the line stays in the park and near its open corridors.
  for (const path of park.paths) {
    const a = park.nodes[path.a].pos, c = park.nodes[path.b].pos, reach = RACE.walkwayReach;
    for (let j = grid.cellZ(Math.min(a[2], c[2]) - reach); j <= grid.cellZ(Math.max(a[2], c[2]) + reach); j++) for (let i = grid.cellX(Math.min(a[0], c[0]) - reach); i <= grid.cellX(Math.max(a[0], c[0]) + reach); i++) {
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue;
      const x = grid.centreX(i), z = grid.centreZ(j), dx = c[0] - a[0], dz = c[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1))), d = Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t), o = j * grid.nx + i;
      if (d < grid.walkway[o]) grid.walkway[o] = d;
    }
  }
  // Coaster country counts as park too, so the line can reach the rails and pass under them.
  for (const ride of park.rides) if (ride.curve) {
    const s = railSample(), reach = RAIL_REACH;
    for (let at = 0; at < ride.curve.length; at += 2) {
      sampleRail(ride.curve, at, s);
      for (let j = grid.cellZ(s.pos[2] - reach); j <= grid.cellZ(s.pos[2] + reach); j++) for (let i = grid.cellX(s.pos[0] - reach); i <= grid.cellX(s.pos[0] + reach); i++) {
        if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue;
        const d = Math.hypot(grid.centreX(i) - s.pos[0], grid.centreZ(j) - s.pos[2]), o = j * grid.nx + i;
        if (d <= reach && d < grid.walkway[o]) grid.walkway[o] = d;
      }
    }
  }
  for (const plant of park.plantings ?? []) {
    const reach = plantingBounds(plant).radius + 2;
    for (let j = grid.cellZ(plant.pos[2] - reach); j <= grid.cellZ(plant.pos[2] + reach); j++) for (let i = grid.cellX(plant.pos[0] - reach); i <= grid.cellX(plant.pos[0] + reach); i++) {
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz || Math.hypot(grid.centreX(i) - plant.pos[0], grid.centreZ(j) - plant.pos[2]) > reach) continue;
      const o = j * grid.nx + i; if (grid.trees[o] < 255) grid.trees[o]++;
    }
  }
  for (let o = 0; o < grid.nx * grid.nz; o++) {
    const k = grid.openFrom(o, RACE.low); grid.lowest[o] = k;
    if (k < 0 || grid.walkway[o] > RACE.walkwayReach) continue;
    grid.cost[o] = 1 + 0.06 * (k - RACE.low) + 0.5 * Math.min(grid.trees[o], 4) + 0.012 * grid.walkway[o];
  }
  return grid;
}

/** Cheapest 8-connected route between two columns, with `extra` added per column entered. */
function route(grid: PlanGrid, from: number, to: number, extra: Float32Array): number[] | null {
  const n = grid.nx * grid.nz, g = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), done = new Uint8Array(n), heap = new Heap();
  const tx = to % grid.nx, tz = Math.floor(to / grid.nx), h = (o: number) => Math.hypot(o % grid.nx - tx, Math.floor(o / grid.nx) - tz);
  g[from] = 0; heap.push(from, h(from));
  while (heap.size) {
    const o = heap.pop(); if (done[o]) continue; done[o] = 1;
    if (o === to) break;
    const x = o % grid.nx, z = Math.floor(o / grid.nx);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= grid.nx || nz >= grid.nz) continue;
      const q = nz * grid.nx + nx; if (done[q] || !Number.isFinite(grid.cost[q])) continue;
      const step = (dx && dz ? Math.SQRT2 : 1) * ((grid.cost[o] + grid.cost[q]) / 2 + extra[q]), cost = g[o] + step;
      if (cost < g[q]) { g[q] = cost; parent[q] = o; heap.push(q, cost + h(q)); }
    }
  }
  if (!done[to]) return null;
  const out: number[] = []; for (let o = to; o >= 0; o = parent[o]) out.push(o);
  return out.reverse();
}

/** Columns a ride's waypoint may use, best first: low, open, near the ride, under its rails for a coaster. */
function waypoint(grid: PlanGrid, ride: RideDefinition, centre: [number, number], taken: Set<number>): number {
  let best = -1, bestScore = Infinity;
  const near = ride.curve ? 14 : FLAT_ENVELOPE[ride.family as FlatFamily].reach + RACE.clearance + 4, far = near + 30;
  const rail: [number, number][] = [];
  if (ride.curve) { const s = railSample(); for (let at = 0; at < ride.curve.length; at += 6) { sampleRail(ride.curve, at, s); rail.push([s.pos[0], s.pos[2]]); } }
  const reach = ride.curve ? Math.max(...rail.map(p => Math.hypot(p[0] - ride.pos[0], p[1] - ride.pos[2]))) + 20 : far;
  for (let j = grid.cellZ(ride.pos[2] - reach); j <= grid.cellZ(ride.pos[2] + reach); j++) for (let i = grid.cellX(ride.pos[0] - reach); i <= grid.cellX(ride.pos[0] + reach); i++) {
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue;
    const o = j * grid.nx + i; if (!Number.isFinite(grid.cost[o]) || taken.has(o)) continue;
    const x = grid.centreX(i), z = grid.centreZ(j);
    let score: number;
    if (ride.curve) {
      // Prefer flying low under the rails: an open column with blocked layers overhead within 6 m of the track in plan.
      let d = Infinity; for (const p of rail) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z));
      if (d > 8) continue;
      let overhead = false; for (let k = grid.lowest[o] + 2; k < grid.nk; k++) if (grid.blocked[o * grid.nk + k]) { overhead = true; break; }
      score = grid.lowest[o] * 2 + d + (overhead ? -12 : 0) + grid.trees[o] * 3;
    } else {
      const d = Math.hypot(x - ride.pos[0], z - ride.pos[2]); if (d < near || d > far) continue;
      score = grid.lowest[o] * 2 + (d - near) * 0.3 + grid.trees[o] * 3;
    }
    score += 0.02 * Math.hypot(x - centre[0], z - centre[1]) + grid.walkway[o] * 0.1;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Point on a closed polyline at `i` (wrapping). */
const at = <T>(a: T[], i: number): T => a[((i % a.length) + a.length) % a.length];

/** Resamples a closed 2D polyline at even spacing. */
function resample(points: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [], n = points.length;
  let total = 0; for (let i = 0; i < n; i++) total += Math.hypot(at(points, i + 1)[0] - points[i][0], at(points, i + 1)[1] - points[i][1]);
  const count = Math.max(8, Math.round(total / step)), spacing = total / count;
  let seg = 0, segStart = 0, segLen = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
  for (let k = 0; k < count; k++) {
    const s = k * spacing;
    while (s > segStart + segLen && seg < n - 1) { segStart += segLen; seg++; segLen = Math.hypot(at(points, seg + 1)[0] - points[seg][0], at(points, seg + 1)[1] - points[seg][1]); }
    const t = segLen ? (s - segStart) / segLen : 0, a = points[seg], b = at(points, seg + 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Turn radius in plan at point i of a closed line, from the points `span` either side. */
function turnRadius(line: [number, number][], i: number, span: number): number {
  const a = at(line, i - span), b = line[i], c = at(line, i + span);
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  return area < 1e-9 ? Infinity : ab * bc * ca / (4 * area);
}

/**
 * The far end of the first dead-end detour on a closed route of grid columns (a stretch at least DETOUR_RUN long that runs within
 * DETOUR_GAP of a part of the route more than DETOUR_APART further along it), or -1 when there is none.
 */
function detour(grid: PlanGrid, cells: number[]): number {
  const n = cells.length, xs = cells.map(o => grid.centreX(o % grid.nx)), zs = cells.map(o => grid.centreZ(Math.floor(o / grid.nx)));
  const hash = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const key = hashKey(xs[i], zs[i]), list = hash.get(key); if (list) list.push(i); else hash.set(key, [i]); }
  let run = 0, runStart = -1;
  for (let i = 0; i < n; i++) {
    let partner = -1;
    const span = Math.ceil(DETOUR_GAP / HASH);
    for (let dx = -span; dx <= span && partner < 0; dx++) for (let dz = -span; dz <= span && partner < 0; dz++) for (const j of hash.get(hashKey(xs[i] + dx * HASH, zs[i] + dz * HASH)) ?? []) {
      const apart = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (apart * RACE.cell > DETOUR_APART && Math.hypot(xs[i] - xs[j], zs[i] - zs[j]) < DETOUR_GAP) { partner = j; break; }
    }
    if (partner < 0) { run = 0; continue; }
    if (!run) runStart = i;
    if (++run * RACE.cell >= DETOUR_RUN) {
      // The detour's far end is half way round from where the parallel run starts to its partner.
      const j = partner, ahead = (j - runStart + n) % n;
      return (runStart + Math.floor(ahead / 2)) % n;
    }
  }
  return -1;
}

/** The race line in plan: a loop through a ring of ride waypoints, smoothed. Null when no loop fits. */
function planLoop(park: ParkData, grid: PlanGrid, rng: Rng): [number, number][] | null {
  const centre: [number, number] = [park.nodes.reduce((s, n) => s + n.pos[0], 0) / park.nodes.length, park.nodes.reduce((s, n) => s + n.pos[2], 0) / park.nodes.length];
  const angle = (x: number, z: number) => Math.atan2(z - centre[1], x - centre[0]);
  const startAngle = angle(park.launch.pos[0], park.launch.pos[2]), turn = rng.chance(0.5) ? 1 : -1;
  const sweep = (r: RideDefinition) => { let a = (angle(r.pos[0], r.pos[2]) - startAngle) * turn; while (a <= 0) a += 2 * Math.PI; while (a > 2 * Math.PI) a -= 2 * Math.PI; return a; };
  const rides = [...park.rides].sort((a, b) => sweep(a) - sweep(b));
  const want = Math.max(5, Math.min(14, Math.round(rides.length * 0.6))), offset = rng.next() * rides.length / want;
  const chosen = Array.from({ length: want }, (_, k) => rides[Math.floor(offset + k * rides.length / want) % rides.length]).filter((r, i, a) => a.indexOf(r) === i);
  const taken = new Set<number>(), stops: number[] = [];
  for (const ride of chosen) { const o = waypoint(grid, ride, centre, taken); if (o >= 0) { stops.push(o); taken.add(o); } }
  if (stops.length < 4) return null;
  // Route the legs; where the loop runs back alongside itself (a dead-end detour), drop the stop that caused it and route again.
  let cells: number[] = [];
  for (let tries = 0; ; tries++) {
    const ring = [...stops, stops[0]], starts: number[] = [];
    // Each leg pays extra near earlier legs, so the loop does not fly back down its own corridor.
    const extra = new Float32Array(grid.nx * grid.nz), spread = 10;
    cells = [];
    for (let k = 0; k + 1 < ring.length; k++) {
      const leg = route(grid, ring[k], ring[k + 1], extra); if (!leg) return null;
      starts.push(cells.length); cells.push(...(k ? leg.slice(1) : leg));
      const ex = ring[k + 1] % grid.nx, ez = Math.floor(ring[k + 1] / grid.nx);
      for (const o of leg) {
        const x = o % grid.nx, z = Math.floor(o / grid.nx);
        for (let dz = -spread; dz <= spread; dz++) for (let dx = -spread; dx <= spread; dx++) {
          const qx = x + dx, qz = z + dz; if (qx < 0 || qz < 0 || qx >= grid.nx || qz >= grid.nz || dx * dx + dz * dz > spread * spread || Math.hypot(qx - ex, qz - ez) < 12) continue;
          const q = qz * grid.nx + qx; extra[q] = Math.max(extra[q], 2.5);
        }
      }
    }
    cells.pop();
    const spur = detour(grid, cells);
    if (spur < 0 || stops.length <= 4 || tries >= 4) break;
    // The stop reached last before the detour's far end is the one that pulled the loop out there.
    let drop = 0; for (let k = 0; k < starts.length; k++) if (starts[k] <= spur) drop = k;
    stops.splice(drop, 1);
  }
  let line: [number, number][] = resample(cells.map(o => [grid.centreX(o % grid.nx), grid.centreZ(Math.floor(o / grid.nx))]), 2);
  const passable = (x: number, z: number, limit: number) => { const o = grid.column(x, z); return o >= 0 && Number.isFinite(grid.cost[o]) && grid.lowest[o] <= limit; };
  const ease = (i: number, step: number, loose = false) => {
    const p = line[i], a = at(line, i - 1), b = at(line, i + 1), x = p[0] + step * ((a[0] + b[0]) / 2 - p[0]), z = p[1] + step * ((a[1] + b[1]) / 2 - p[1]);
    const o = grid.column(p[0], p[1]);
    if (passable(x, z, loose ? RACE.ceiling : o >= 0 && grid.lowest[o] >= 0 ? grid.lowest[o] + 3 : RACE.low + 3)) { p[0] = x; p[1] = z; }
  };
  for (let pass = 0; pass < 160; pass++) {
    for (let i = 0; i < line.length; i++) ease(i, 0.5);
    if (pass % 40 === 39) line = resample(line, 2);
  }
  // Open out any turn tighter than RACE_TURN where the space allows.
  for (let pass = 0; pass < 400; pass++) {
    const tight: number[] = [];
    for (let i = 0; i < line.length; i++) if (turnRadius(line, i, 3) < RACE_TURN) tight.push(i);
    if (!tight.length) break;
    for (const i of tight) for (let d = -4; d <= 4; d++) ease(((i + d) % line.length + line.length) % line.length, 1, true);
    if (pass % 50 === 49) line = resample(line, 2);
  }
  // Resampling can cut a corner of a closed column: move such points into the nearest open one, then ease them back into line.
  line = resample(line, 1);
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const p of line) {
      const o = grid.column(p[0], p[1]);
      if (o >= 0 && Number.isFinite(grid.cost[o])) continue;
      let best: [number, number] | null = null, bestD = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = p[0] + dx * RACE.cell, z = p[1] + dz * RACE.cell, q = grid.column(x, z);
        if (q < 0 || !Number.isFinite(grid.cost[q])) continue;
        const cx = grid.centreX(q % grid.nx), cz = grid.centreZ(Math.floor(q / grid.nx)), d = Math.hypot(cx - p[0], cz - p[1]);
        if (d < bestD) { bestD = d; best = [cx, cz]; }
      }
      if (!best) return null;
      p[0] = best[0]; p[1] = best[1]; moved = true;
    }
    if (!moved) break;
    for (let i = 0; i < line.length; i++) ease(i, 0.5);
  }
  return line;
}

/**
 * Heights above grade along a plan line. The line is split into steps of HEIGHT_STEP metres; each step flies at one whole-metre
 * layer that is open over the whole step, moving at most MAX_LAYER_CHANGE layers to the next step.
 * The loop of layers with the least total height (plus a little for every change) is found by dynamic programming, so the line
 * dives under anything it can pass beneath instead of climbing over it. Layers where the exact check fails are closed and the
 * search runs again. Null when no loop of layers fits.
 */
function fitHeights(grid: PlanGrid, line: [number, number][], clearance: RaceClearance, report?: (note: string) => void): number[] | { breaks: number[] } | null {
  const n = line.length, cols = line.map(p => grid.column(p[0], p[1]));
  if (cols.some(o => o < 0 || grid.lowest[o] < 0)) { report?.('line leaves the open columns'); return null; }
  const steps = Math.floor(n / HEIGHT_STEP), K = RACE.ceiling + 1, closed = new Uint8Array(steps * K);
  const allowed = new Uint8Array(steps * K);
  const refresh = () => {
    for (let j = 0; j < steps; j++) for (let k = RACE.low; k < K; k++) {
      let ok = !closed[j * K + k];
      for (let d = -1; d <= HEIGHT_STEP && ok; d++) ok = grid.open(at(cols, j * HEIGHT_STEP + d), k);
      allowed[j * K + k] = ok ? 1 : 0;
    }
  };
  const solve = (): Int16Array | null => {
    let best: Int16Array | null = null, bestCost = Infinity;
    const cost = new Float64Array(steps * K), from = new Int16Array(steps * K);
    for (let k0 = RACE.low; k0 < K; k0++) {
      if (!allowed[k0]) continue;
      cost.fill(Infinity); cost[k0] = k0;
      for (let j = 1; j <= steps; j++) {
        const jj = j % steps, prev = (j - 1) * K;
        for (let k = RACE.low; k < K; k++) {
          if (!allowed[jj * K + k] || (j === steps && k !== k0)) continue;
          let c = Infinity, f = -1;
          for (let d = -MAX_LAYER_CHANGE; d <= MAX_LAYER_CHANGE; d++) {
            const q = k + d; if (q < RACE.low || q >= K || !Number.isFinite(cost[prev + q])) continue;
            const v = cost[prev + q] + k + LAYER_CHANGE_COST[Math.abs(d)]; if (v < c) { c = v; f = q; }
          }
          if (j === steps) { if (c < bestCost) { bestCost = c; best = new Int16Array(steps); let q = f; best[0] = k0; for (let back = steps - 1; back >= 1; back--) { best[back] = q; q = from[back * K + q]; } } }
          else { cost[jj * K + k] = c; from[jj * K + k] = f; }
        }
      }
    }
    return best;
  };
  for (let round = 0; round < 30; round++) {
    refresh();
    const layers = solve();
    if (!layers) {
      // Follow the heights the line can reach from the start, twice round the loop. Where none are left, the line would have to jump
      // (say from under a rail straight up over a roof): the plan line itself has to move away from there.
      let reach: number[] = []; for (let k = RACE.low; k < K; k++) if (allowed[k]) reach.push(k);
      let dead = -1;
      for (let j = 1; j <= 2 * steps && dead < 0; j++) {
        const jj = j % steps, next: number[] = [];
        for (let k = RACE.low; k < K; k++) if (allowed[jj * K + k] && reach.some(q => Math.abs(q - k) <= MAX_LAYER_CHANGE)) next.push(k);
        if (!next.length) dead = jj; reach = next;
      }
      report?.(`no loop of heights (round ${round}): ${dead < 0 ? 'the loop cannot close' : `the line would have to jump at ${line[dead * HEIGHT_STEP].map(Math.round)}`}`);
      if (dead < 0) return null;
      const breaks: number[] = [];
      for (let d = -3 * HEIGHT_STEP; d <= 2 * HEIGHT_STEP; d++) breaks.push(at(cols, dead * HEIGHT_STEP + d));
      return { breaks };
    }
    const heights = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i / HEIGHT_STEP) % steps, t = (i % HEIGHT_STEP) / HEIGHT_STEP, a = layers[j], b = layers[(j + 1) % steps];
      heights[i] = a + (b - a) * t + 0.5;
    }
    for (let i = n - (n % HEIGHT_STEP); i < n; i++) heights[i] = layers[0] + 0.5;
    const eased = heights.map((_, i) => { let s = 0; for (let d = -4; d <= 4; d++) s += at(heights, i + d); return s / 9; });
    let failed = false;
    for (let i = 0; i < n; i++) {
      if (clearance.distance(line[i][0], PARK_GRADE + eased[i], line[i][1]) >= RACE.exact) continue;
      const j = Math.floor(i / HEIGHT_STEP) % steps, k = Math.floor(eased[i]);
      for (let d = -1; d <= 1; d++) for (const kk of [k, k + 1]) if (kk < K) closed[(((j + d) % steps + steps) % steps) * K + kk] = 1;
      failed = true;
    }
    if (!failed) return eased;
  }
  report?.('exact check still failing after 30 rounds');
  return null;
}

type GateKindChoice = 'square' | 'arch' | 'hoop';

/** Gates on the straights of a closed line, starting with the start gate nearest the launch spot. */
function placeGates(park: ParkData, path: Vec3[], clearance: RaceClearance, rng: Rng): { gates: TrackGate[]; first: number } | null {
  const n = path.length, flat = { heightAt: () => PARK_GRADE } as unknown as TerrainSampler, walkways = park.paths.map(p => ({ a: park.nodes[p.a].pos, b: park.nodes[p.b].pos, half: p.width / 2 }));
  const fits = (s: number, kind: GateKindChoice | 'start'): TrackGate | null => {
    const p = path[s], a = at(path, s - 4), b = at(path, s + 4), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], flatLen = Math.hypot(dx, dz);
    if (Math.abs(dy) / flatLen > 0.08) return null;
    const back = at(path, s - 12), ahead = at(path, s + 12), h1 = Math.atan2(p[2] - back[2], p[0] - back[0]), h2 = Math.atan2(ahead[2] - p[2], ahead[0] - p[0]);
    if (Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) > 0.3) return null;
    for (let j = 0; j < n; j++) {
      const gap = Math.min(Math.abs(j - s), n - Math.abs(j - s));
      if (gap > 40 && Math.hypot(path[j][0] - p[0], path[j][1] - p[1], path[j][2] - p[2]) < 25) return null;
    }
    const size = kind === 'start' ? [8, 4.6] : kind === 'arch' ? [rng.range(5.5, 6.5), 0] : kind === 'hoop' ? [rng.range(5, 6), 0] : [rng.range(5.5, 7), rng.range(3.8, 4.6)];
    const width = size[0], height = kind === 'arch' ? width * 1.25 : kind === 'hoop' ? width : size[1];
    if (p[1] - height / 2 < PARK_GRADE + 1.2) return null;
    const gate: TrackGate = { index: 0, kind, pos: [p[0], p[1], p[2]], yaw: Math.atan2(-dx, -dz), pitch: 0, roll: 0, width, height };
    for (const box of gateColliders(gate, flat)) {
      const h = box.half, cy = Math.cos(box.yaw), sy = Math.sin(box.yaw), axis = h[0] >= h[1] && h[0] >= h[2] ? 0 : h[1] >= h[2] ? 1 : 2;
      const long = h[axis], thick = Math.max(...h.filter((_, k) => k !== axis)), steps = Math.max(1, Math.ceil(long / 0.25));
      const grounded = box.center[1] - h[1] < PARK_GRADE + 0.3;
      for (let t = -steps; t <= steps; t++) {
        const o = long * t / steps, lx = axis === 0 ? o : 0, ly = axis === 1 ? o : 0, lz = axis === 2 ? o : 0;
        const x = box.center[0] + cy * lx + sy * lz, y = box.center[1] + ly, z = box.center[2] - sy * lx + cy * lz;
        if (y > PARK_GRADE + 0.35 && clearance.solid(x, y, z, true) < thick + RACE.gateClearance) return null;
        if (clearance.rides(x, y, z) < thick + 0.5) return null;
        for (let j = -60; j <= 60; j++) { if (Math.abs(j) <= 6) continue; const q = at(path, s + j); if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) < 2.5) return null; }
      }
      if (grounded) for (const w of walkways) {
        const ex = w.b[0] - w.a[0], ez = w.b[2] - w.a[2], t = Math.max(0, Math.min(1, ((box.center[0] - w.a[0]) * ex + (box.center[2] - w.a[2]) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(box.center[0] - w.a[0] - ex * t, box.center[2] - w.a[2] - ez * t) < w.half + 0.5 + Math.max(h[0], h[2])) return null;
      }
    }
    return gate;
  };
  const search = (target: number, window: number, kinds: (GateKindChoice | 'start')[]): [number, TrackGate] | null => {
    for (let d = 0; d <= window; d++) for (const s of d ? [target + d, target - d] : [target]) for (const kind of kinds) { const g = fits(((s % n) + n) % n, kind); if (g) return [((s % n) + n) % n, g]; }
    return null;
  };
  // The start gate goes on the stretch of line nearest the launch spot.
  const L = park.launch.pos; let near = 0; for (let i = 1; i < n; i++) if (Math.hypot(path[i][0] - L[0], path[i][2] - L[2]) < Math.hypot(path[near][0] - L[0], path[near][2] - L[2])) near = i;
  const opening = search(near, 200, ['start']); if (!opening) return null;
  const [first, startGate] = opening, gates = [startGate];
  // Distances are counted along the line from the start gate.
  const offset = (s: number) => (s - first + n) % n, spacing = RACE.gateSpacing;
  let along = 0;
  for (;;) {
    let target = along + Math.round(spacing * rng.range(0.8, 1.2)), found: [number, TrackGate] | null = null;
    const pick = rng.next(), kinds: GateKindChoice[] = pick < 0.55 ? ['square', 'arch', 'hoop'] : pick < 0.8 ? ['arch', 'square', 'hoop'] : ['hoop', 'square', 'arch'];
    while (!found && target < n - spacing * 0.6) {
      const hit = search(first + target, 12, kinds);
      if (hit && offset(hit[0]) > along + 30 && offset(hit[0]) < n - 30) found = hit; else target += 25;
    }
    if (!found) break;
    along = offset(found[0]); found[1].index = gates.length; gates.push(found[1]);
  }
  return gates.length < 8 ? null : { gates, first };
}

/** Plan distance from a start pad to gate 0 that the search starts at, metres: every generated training track has its pad 10 m back. */
const PAD_GATE_DISTANCE = 10;
/** Plan distance from a pad to any gate standing on posts (the tour's hoops), metres. */
const PAD_GATE_GAP = 10;
/** Room the flight from the pad to gate 0 keeps from solids and ride envelopes, metres (a coaster's guide runs 2 m from its rails). */
const FLIGHT_CLEARANCE = 1;
/** Height over the pad a brain has climbed to by the time it leaves the pad's column, metres. */
const LIFT = 3;

/**
 * A pad on open ground straight behind `gate`, facing it: off the walkways, PAD_GATE_GAP from every gate in `stands`, nothing over
 * it up to LIFT, and FLIGHT_CLEARANCE round the flight from LIFT over it to the gate, as near PAD_GATE_DISTANCE back as it fits. Null
 * when there is none.
 */
export function padBehind(park: ParkData, gate: TrackGate, clearance: RaceClearance, stands: readonly TrackGate[]): TrackData['start'] | null {
  const walkways = park.paths.map(p => ({ a: park.nodes[p.a].pos, b: park.nodes[p.b].pos, half: p.width / 2 }));
  const fx = -Math.sin(gate.yaw), fz = -Math.cos(gate.yaw), back0 = PAD_GATE_DISTANCE;
  for (let back = back0; back <= back0 + 45; back += 3) for (const side of [0, 4, -4, 8, -8, 12, -12]) {
    const x = gate.pos[0] - fx * back - fz * side, z = gate.pos[2] - fz * back + fx * side;
    if (stands.some(g => g !== gate && Math.hypot(g.pos[0] - x, g.pos[2] - z) < PAD_GATE_GAP)) continue;
    if (walkways.some(w => {
      const ex = w.b[0] - w.a[0], ez = w.b[2] - w.a[2], u = Math.max(0, Math.min(1, ((x - w.a[0]) * ex + (z - w.a[2]) * ez) / (ex * ex + ez * ez || 1)));
      return Math.hypot(x - w.a[0] - ex * u, z - w.a[2] - ez * u) < w.half + 1.5;
    })) continue;
    let clear = true;
    // Paving under the pad is the floor it stands on: the column keeps its height from solids, up to 2 m.
    for (let h = 0.4; h <= LIFT && clear; h += 0.5) clear = clearance.solid(x, PARK_GRADE + h, z, true) >= Math.min(2, h) - 0.05 && clearance.rides(x, PARK_GRADE + h, z) >= RACE.exact;
    // The flight from over the pad to the gate, every metre.
    const ax = x, ay = PARK_GRADE + LIFT, az = z, d = Math.hypot(gate.pos[0] - ax, gate.pos[1] - ay, gate.pos[2] - az);
    for (let t = 0; t <= d && clear; t += 1) {
      const f = t / d, px = ax + (gate.pos[0] - ax) * f, py = ay + (gate.pos[1] - ay) * f, pz = az + (gate.pos[2] - az) * f;
      clear = clearance.solid(px, py, pz, true) >= FLIGHT_CLEARANCE && clearance.rides(px, py, pz) >= FLIGHT_CLEARANCE;
    }
    if (clear) return { pos: [x, PARK_GRADE, z], yaw: Math.atan2(-(gate.pos[0] - x), -(gate.pos[2] - z)) };
  }
  return null;
}

/**
 * Where the race starts when padBehind finds no spot: open lawn 15 to 60 m back along the line from the start gate, off the walkways,
 * with nothing above it up to the line and room round it, facing the gate. Falls back to the park's launch spot.
 */
function startPad(park: ParkData, path: Vec3[], first: number, gate: TrackGate, clearance: RaceClearance): { pos: Vec3; yaw: number } {
  const n = path.length, walkways = park.paths.map(p => ({ a: park.nodes[p.a].pos, b: park.nodes[p.b].pos, half: p.width / 2 }));
  for (let back = 15; back <= 60; back += 3) for (const side of [0, 4, -4, 8, -8, 12, -12]) {
    const p = at(path, first - back), q = at(path, first - back + 2), dx = q[0] - p[0], dz = q[2] - p[2], len = Math.hypot(dx, dz) || 1;
    const x = p[0] - dz / len * side, z = p[2] + dx / len * side;
    if (walkways.some(w => { const ex = w.b[0] - w.a[0], ez = w.b[2] - w.a[2], u = Math.max(0, Math.min(1, ((x - w.a[0]) * ex + (z - w.a[2]) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(x - w.a[0] - ex * u, z - w.a[2] - ez * u) < w.half + 1.5; })) continue;
    let clear = true;
    for (let h = 0.4; h <= p[1] - PARK_GRADE && clear; h += 0.5) clear = clearance.solid(x, PARK_GRADE + h, z, true) >= (h < 2 ? 2 : RACE.exact) && clearance.rides(x, PARK_GRADE + h, z) >= RACE.exact;
    if (!clear) continue;
    for (let i = 1; i < n && clear; i += 4) clear = Math.hypot(path[i][0] - x, path[i][2] - z) > 3 || path[i][1] - PARK_GRADE > 4;
    if (clear) return { pos: [x, PARK_GRADE, z], yaw: Math.atan2(-(gate.pos[0] - x), -(gate.pos[2] - z)) };
  }
  return park.launch;
}

/**
 * The park's race course, or null when none fits (the park recipe then falls back to free flight). Deterministic per park seed.
 * `parkMap` is the map summary every park route carries.
 */
export function buildRaceCourse(park: ParkData, parkMap: TrackData['parkMap'], report?: (note: string) => void): TrackData | null {
  const clearance = new RaceClearance(park), grid = buildGrid(park, clearance);
  report?.(`grid ${grid.nx} x ${grid.nz} x ${grid.nk}, ${grid.cost.filter(Number.isFinite).length} open columns`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const rng = new Rng(deriveSeed(park.recipe.seed, 977, attempt));
    let line: [number, number][] | null = null, heights: number[] | null = null;
    // A loop that would have to jump in height closes the columns where it would, and is planned again.
    for (let replan = 0; replan < 6 && !heights; replan++) {
      line = planLoop(park, grid, new Rng(deriveSeed(park.recipe.seed, 977, attempt))); if (!line) break;
      const fit = fitHeights(grid, line, clearance, report);
      if (!fit) break;
      if (Array.isArray(fit)) heights = fit; else for (const o of fit.breaks) grid.cost[o] = Infinity;
    }
    if (!line) { report?.(`attempt ${attempt}: no loop`); continue; }
    if (!heights) { report?.(`attempt ${attempt}: ${line.length} m loop, no heights fit`); continue; }
    const path: Vec3[] = line.map((p, i) => [p[0], PARK_GRADE + heights[i], p[1]]);
    const placed = placeGates(park, path, clearance, rng); if (!placed) { report?.(`attempt ${attempt}: ${line.length} m loop, too few gates`); continue; }
    const ordered = [...path.slice(placed.first), ...path.slice(0, placed.first)];
    let length = 0; for (let i = 0; i < ordered.length; i++) { const a = ordered[i], b = at(ordered, i + 1); length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
    const start = padBehind(park, placed.gates[0], clearance, placed.gates) ?? startPad(park, path, placed.first, placed.gates[0], clearance);
    return { seed: park.recipe.seed, style: 'race', gates: placed.gates, obstacles: [], path: ordered, closed: true, length, start, laps: RACE.laps, parkCourse: 'race', parkMap };
  }
  return null;
}
