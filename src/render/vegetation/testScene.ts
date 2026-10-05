import type { TerrainData, TrackData, Vec3 } from '../../contracts';
import { createTerrainSampler, generateTerrain } from '../../world/terrain';
import { generateTrack } from '../../world/track/generator';
import { obstacleKeepOuts, tunnelKeepOuts } from '../../world/track/kindGeometry';
import { placeVegetation, TIER_LIMITS, type InstanceSet, type VegPlacement } from './placement';

export interface TestScene {
  terrain: TerrainData;
  track: TrackData;
  high: VegPlacement;
}

let cached: TestScene | null = null;

/** A real 2 km generated terrain, a race track over it and the high-tier placement, built once per test file. */
export function testScene(): TestScene {
  if (!cached) {
    const terrain = generateTerrain({ seed: 7, quality: 'low', resolution: 256, cellSize: 8 });
    const track = generateTrack({ seed: 2, style: 'race' }, createTerrainSampler(terrain));
    cached = { terrain, track, high: placeVegetation(terrain, track, TIER_LIMITS.high) };
  }
  return cached;
}

/** Horizontal distance from (x, z) to the nearest sample of the path. */
export function pathDistance(path: readonly Vec3[], x: number, z: number): number {
  let best = Infinity;
  for (const p of path) best = Math.min(best, Math.hypot(x - p[0], z - p[2]));
  return best;
}

/** Calls `visit` for every pair of instances closer than `reach` (bucketed, so 20k instances stay cheap). */
export function eachPair(s: InstanceSet, reach: number, visit: (i: number, j: number, d: number) => void): void {
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 100_003 + cz;
  for (let i = 0; i < s.count; i++) {
    const k = key(Math.floor(s.pos[i * 3] / reach), Math.floor(s.pos[i * 3 + 2] / reach));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  for (let i = 0; i < s.count; i++) {
    const cx = Math.floor(s.pos[i * 3] / reach), cz = Math.floor(s.pos[i * 3 + 2] / reach);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of cells.get(key(cx + dx, cz + dz)) ?? []) {
          if (j <= i) continue;
          const d = Math.hypot(s.pos[i * 3] - s.pos[j * 3], s.pos[i * 3 + 2] - s.pos[j * 3 + 2]);
          if (d < reach) visit(i, j, d);
        }
      }
    }
  }
}

/** Ground discs the placement keeps clear: gate openings and tunnel sleeves, obstacles and the launch pad (same radii as placement.ts). */
export function blockerDiscs(track: TrackData): { x: number; z: number; r: number }[] {
  const out = track.gates.map((g) => ({ x: g.pos[0], z: g.pos[2], r: 0.5 * Math.hypot(g.width, g.height) + 2 }));
  for (const g of track.gates) if (g.kind === 'tunnel') out.push(...tunnelKeepOuts(g));
  for (const o of track.obstacles) out.push(...obstacleKeepOuts(o));
  out.push({ x: track.start.pos[0], z: track.start.pos[2], r: 8 });
  return out;
}
