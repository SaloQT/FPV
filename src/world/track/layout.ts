/** Layout: the abstract gate plan a style generator produces before it is turned into a smooth, validated track. */
import type { TerrainSampler } from '../../contracts';
import { gateSiteSlope } from './clearance';
import type { Rng } from './rng';
import { MAX_DIVE_GATE_SLOPE, MAX_GATE_SLOPE, WATER_MARGIN, type GateSpec, type StyleSpec } from './styles';

export interface LayoutGate {
  x: number;
  z: number;
  spec: GateSpec;
  /** Wanted height of the opening's lowest edge above the highest ground under it. */
  clear: number;
  roll: number;
  /** Dive gates fix their travel axis; the path is forced through them along it. */
  dive?: { yaw: number; pitch: number };
}

export interface Layout {
  closed: boolean;
  gates: LayoutGate[];
}

export interface LayoutCtx {
  sampler: TerrainSampler;
  spec: StyleSpec;
  difficulty: number;
  gateCount: number;
  /** Map centre and full side length. */
  cx: number;
  cz: number;
  extent: number;
  /** Ground height below which gates and obstacles are not placed. */
  waterFloor: number;
  rng: Rng;
}

export function makeCtx(sampler: TerrainSampler, spec: StyleSpec, difficulty: number, gateCount: number, rng: Rng): LayoutCtx {
  const d = sampler.data;
  const extent = d.resolution * d.cellSize;
  return {
    sampler,
    spec,
    difficulty,
    gateCount,
    cx: d.origin[0] + extent / 2,
    cz: d.origin[1] + extent / 2,
    extent,
    waterFloor: d.waterLevel + WATER_MARGIN,
    rng,
  };
}

/** True when a gate may stand here: inside the corridor, dry, and the ground around it is not too steep. */
export function siteOk(c: LayoutCtx, x: number, z: number, dive: boolean): boolean {
  if (Math.hypot(x - c.cx, z - c.cz) > c.spec.corridor * c.extent) return false;
  const s = c.sampler;
  if (s.heightAt(x, z) < c.waterFloor) return false;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (s.heightAt(x + 3 * Math.cos(a), z + 3 * Math.sin(a)) < c.waterFloor) return false;
  }
  return gateSiteSlope(s, x, z) <= (dive ? MAX_DIVE_GATE_SLOPE : MAX_GATE_SLOPE);
}

/** Mean of the ground height on a ring around (x, z) minus the height at the centre: > 0 in bowls and valleys, < 0 on ridges and hills. */
export function localConcavity(s: TerrainSampler, x: number, z: number, radius: number): number {
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    sum += s.heightAt(x + radius * Math.cos(a), z + radius * Math.sin(a));
  }
  return sum / 8 - s.heightAt(x, z);
}

/** Terrain roughness over a disc: standard deviation of heights plus worst slope, used to pick where to build. */
export function areaRoughness(s: TerrainSampler, x: number, z: number, radius: number): number {
  let sum = 0;
  let sum2 = 0;
  let maxSlope = 0;
  let n = 0;
  for (let ring = 0; ring < 3; ring++) {
    const r = (radius * ring) / 2;
    const k = ring === 0 ? 1 : 12;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * 2 * Math.PI;
      const px = x + r * Math.cos(a);
      const pz = z + r * Math.sin(a);
      const h = s.heightAt(px, pz);
      sum += h;
      sum2 += h * h;
      n++;
      const sl = s.slopeAt(px, pz);
      if (sl > maxSlope) maxSlope = sl;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(sum2 / n - mean * mean, 0)) + 25 * maxSlope;
}

export function nearest2D(list: { x: number; z: number }[], x: number, z: number, skip = -1): number {
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (i === skip) continue;
    const d = Math.hypot(list[i].x - x, list[i].z - z);
    if (d < best) best = d;
  }
  return best;
}

/** Distance from (x, z) to the nearest [x, z] pair in `list`. */
export function nearestPair(list: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (const p of list) {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best) best = d;
  }
  return best;
}
