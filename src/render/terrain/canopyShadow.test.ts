import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { fromHalf } from '../half';
import { canopyShadowFor, publishCanopyShadow, rasterCanopyShadow, type ShadowCrown } from './canopyShadow';

function flatTerrain(): TerrainData {
  const n = 256, z = new Float32Array(n * n);
  return { seed: 1, resolution: n, cellSize: 4, origin: [-512, -512], height: z, maps: { soil: z, flow: z, deposit: z, wetness: z }, minHeight: 0, maxHeight: 1, waterLevel: -Infinity };
}

const texel = (t: TerrainData, size: number, x: number, z: number): number => {
  const i = Math.round(((x - t.origin[0]) / t.cellSize + 0.5) / t.resolution * size - 0.5);
  const j = Math.round(((z - t.origin[1]) / t.cellSize + 0.5) / t.resolution * size - 0.5);
  return (j * size + i) * 4;
};

const crown = (x: number, z: number, y = 0): ShadowCrown => ({ x, y, z, cx: 0, cy: 8, cz: 0, rx: 4, ry: 3, rz: 4, density: 0.5 });

describe('canopy shadow map', () => {
  const t = flatTerrain();

  it('gives a crown its vertical optical depth and its bottom and top heights, and nothing outside it', () => {
    const out = rasterCanopyShadow(t, [crown(0, 0, 10)], 256);
    const k = texel(t, 256, 0, 0);
    // Through the centre the chord is 2 * ry = 6 m at density 0.5: optical depth 3, from y = 10 + 8 - 3 to 10 + 8 + 3.
    expect(fromHalf(out[k])).toBeCloseTo(3, 1);
    expect(fromHalf(out[k + 1])).toBeCloseTo(15, 1);
    expect(fromHalf(out[k + 2])).toBeCloseTo(21, 1);
    expect(fromHalf(out[texel(t, 256, 12, 0)])).toBe(0);
  });

  it('adds overlapping crowns and spans both of their heights', () => {
    const out = rasterCanopyShadow(t, [crown(0, 0, 0), crown(0, 0, 6)], 256);
    const k = texel(t, 256, 0, 0);
    expect(fromHalf(out[k])).toBeCloseTo(6, 1);
    expect(fromHalf(out[k + 1])).toBeCloseTo(5, 1);
    expect(fromHalf(out[k + 2])).toBeCloseTo(17, 1);
  });

  it('is published per terrain', () => {
    const data = new Uint16Array(4);
    publishCanopyShadow(t, data);
    expect(canopyShadowFor(t)).toBe(data);
    expect(canopyShadowFor(flatTerrain())).toBeUndefined();
  });
});
