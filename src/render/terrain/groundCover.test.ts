import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { bakeTrackDistance, GROUND_COVER_SIZE, groundCoverFor, publishGroundCover, rasterGroundCover, TRACK_WEAR_RANGE_M, type CoverCrown } from './groundCover';

// 256 samples at 4 m: 1024 m across, so one cover texel of a 256 grid is exactly one terrain cell.
function flatTerrain(): TerrainData {
  const n = 256, z = new Float32Array(n * n);
  return { seed: 1, resolution: n, cellSize: 4, origin: [-512, -512], height: z, maps: { soil: z, flow: z, deposit: z, wetness: z }, minHeight: 0, maxHeight: 1, waterLevel: -Infinity };
}

// Texel of world (x, z) in the cover grid, the inverse of the shader's (terrainTexel(xz) + 0.5) / N mapping.
const texel = (t: TerrainData, size: number, x: number, z: number): number => {
  const i = Math.round(((x - t.origin[0]) / t.cellSize + 0.5) / t.resolution * size - 0.5);
  const j = Math.round(((z - t.origin[1]) / t.cellSize + 0.5) / t.resolution * size - 0.5);
  return (j * size + i) * 4;
};

const crown = (x: number, z: number, radius: number, conifer = false): CoverCrown => ({ x, z, radius, strength: 1, conifer });

describe('forest-floor cover', () => {
  const t = flatTerrain();

  it('is bare without trees and a full rgba grid of the documented size', () => {
    const out = rasterGroundCover(t, [], 64);
    expect(out.length).toBe(64 * 64 * 4);
    expect(out.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))).toBe(true);
    expect(rasterGroundCover(t, []).length).toBe(GROUND_COVER_SIZE * GROUND_COVER_SIZE * 4);
  });

  it('gives a lone crown only partial cover, so a single tree in a meadow keeps its grass', () => {
    const out = rasterGroundCover(t, [crown(0, 0, 6)], 256);
    const centre = out[texel(t, 256, 0, 0)] / 255;
    expect(centre).toBeGreaterThan(0.3);
    expect(centre).toBeLessThanOrEqual(0.5);
    expect(out[texel(t, 256, 12, 0)]).toBe(0);
  });

  it('closes up where crowns overlap, and records which of them shed needles', () => {
    const stand = [crown(-3, 0, 6), crown(3, 0, 6, true), crown(0, 4, 6)];
    const out = rasterGroundCover(t, stand, 256);
    const k = texel(t, 256, 0, 1);
    expect(out[k] / 255).toBeGreaterThan(0.6);
    expect(out[k + 1] / 255).toBeGreaterThan(0.15);
    expect(out[k + 1] / 255).toBeLessThan(0.6);
  });

  it('is published per terrain and read back by the terrain module', () => {
    const data = new Uint8Array(4);
    const other = flatTerrain();
    publishGroundCover(t, data);
    expect(groundCoverFor(t)).toBe(data);
    expect(groundCoverFor(other)).toBeUndefined();
  });
});

describe('distance to the racing line', () => {
  const t = flatTerrain();

  it('stores the horizontal distance to the path in alpha, saturating at the range, and leaves the cover channels alone', () => {
    const out = rasterGroundCover(t, [crown(0, 0, 6)], 256);
    const before = out.slice();
    bakeTrackDistance(t, [[-100, 5, 0], [100, 40, 0]], false, out, 256);
    const dist = (x: number, z: number): number => out[texel(t, 256, x, z) + 3] / 255 * TRACK_WEAR_RANGE_M;
    expect(dist(0, 0)).toBeLessThan(2.1);
    expect(dist(20, 8)).toBeCloseTo(8, 0);
    expect(dist(0, -16)).toBeCloseTo(16, 0);
    expect(dist(0, 60)).toBe(TRACK_WEAR_RANGE_M);
    // Past the open end the distance is to the end point, not the infinite line.
    expect(dist(140, 0)).toBe(TRACK_WEAR_RANGE_M);
    for (let k = 0; k < out.length; k++) if (k % 4 !== 3) expect(out[k]).toBe(before[k]);
  });

  it('joins the last point to the first on a closed course', () => {
    const square: number[][] = [[-50, 0, -50], [50, 0, -50], [50, 0, 50], [-50, 0, 50]];
    const open = bakeTrackDistance(t, square, false, rasterGroundCover(t, [], 256), 256);
    const closed = bakeTrackDistance(t, square, true, rasterGroundCover(t, [], 256), 256);
    const k = texel(t, 256, -50, 0) + 3;
    expect(open[k]).toBe(255);
    expect(closed[k] / 255 * TRACK_WEAR_RANGE_M).toBeLessThan(2.1);
  });
});
