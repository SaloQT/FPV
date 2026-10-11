import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { publishTrunkGrid, rasterTrunkGrid, TRUNK_RADIUS_MAX_M, trunkGridFor } from './trunkGrid';

// A 64 x 64 terrain of 2 m cells from (-64, -64): the grid of 32 cells is 4 m a cell, cell i spanning x = -65 + 4 i .. -61 + 4 i.
const terrain = { resolution: 64, cellSize: 2, origin: [-64, -64] } as unknown as TerrainData;

describe('trunk grid', () => {
  it('stores a trunk in the cell its axis falls in, with its place inside the cell, radius and kind', () => {
    const g = rasterTrunkGrid(terrain, [{ x: 0, z: 0, radius: 0.5, conifer: true }], 32);
    // x = 0 is grid coordinate (0 + 64) / 2 + 0.5 = 32.5 terrain texels of 64, i.e. 16.25 cells of 32.
    const o = (16 * 32 + 16) * 4;
    expect(g[o] / 255).toBeCloseTo(0.25, 2);
    expect(g[o + 1] / 255).toBeCloseTo(0.25, 2);
    expect((g[o + 2] / 255) * TRUNK_RADIUS_MAX_M).toBeCloseTo(0.5, 2);
    expect(g[o + 3]).toBe(255);
    let filled = 0;
    for (let k = 3; k < g.length; k += 4) if (g[k] !== 0) filled++;
    expect(filled).toBe(1);
  });

  it('keeps the thicker of two trunks in one cell and skips trunks off the map', () => {
    const g = rasterTrunkGrid(terrain, [
      { x: 0, z: 0, radius: 0.3, conifer: false },
      { x: 0.5, z: 0.5, radius: 0.6, conifer: false },
      { x: 0.2, z: 0.2, radius: 0.4, conifer: true },
      { x: 500, z: 0, radius: 1, conifer: false },
    ], 32);
    const o = (16 * 32 + 16) * 4;
    expect((g[o + 2] / 255) * TRUNK_RADIUS_MAX_M).toBeCloseTo(0.6, 2);
    expect(g[o + 3]).toBe(128);
  });

  it('publishes per terrain', () => {
    const data = new Uint8Array(4);
    publishTrunkGrid(terrain, data);
    expect(trunkGridFor(terrain)).toBe(data);
    expect(trunkGridFor({ ...terrain } as TerrainData)).toBeUndefined();
  });
});
