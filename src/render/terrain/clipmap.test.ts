import { describe, expect, it } from 'vitest';
import { buildTileIndices, Clipmap, Frustum, levelCount, levelSpacing, MAX_TILES, snapLevels, TILE_FLOATS, TILE_QUADS } from './clipmap';

describe('levelCount', () => {
  it('reaches the view distance with the coarsest half-width', () => {
    for (const [cell, dist] of [[4, 1500], [4, 2500], [4, 3500], [4, 5000], [1, 300], [8, 1500]]) {
      const n = levelCount(cell, dist);
      expect(32 * levelSpacing(cell, n - 1)).toBeGreaterThanOrEqual(dist);
      if (n > 1) expect(32 * levelSpacing(cell, n - 2)).toBeLessThan(dist);
    }
  });

  it('never returns fewer than one level', () => {
    expect(levelCount(4, 1)).toBe(1);
  });
});

describe('snapLevels', () => {
  it('keeps every finer level within one coarse quad of the ring centre', () => {
    const c = new Int32Array(20);
    for (let i = 0; i < 400; i++) {
      const x = Math.sin(i * 12.9898) * 43758.5453 % 5000, z = Math.sin(i * 78.233) * 12345.678 % 5000;
      snapLevels(x, z, -1024, -1024, 4, 6, c);
      for (let l = 0; l < 6; l++) {
        expect(Math.abs(c[2 * l] % 2)).toBe(0);
        expect(Math.abs(c[2 * l + 1] % 2)).toBe(0);
        if (l > 0) {
          expect(Math.abs(c[2 * (l - 1)] / 2 - c[2 * l])).toBeLessThanOrEqual(1);
          expect(Math.abs(c[2 * (l - 1) + 1] / 2 - c[2 * l + 1])).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('Clipmap tiling', () => {
  it('covers the outermost square with no gaps; only the one-quad tuck under each finer border is drawn twice', () => {
    const levels = 4, cell = 1, clip = new Clipmap();
    const span = 64 * 2 ** (levels - 1);
    const cover = new Uint8Array(span * span);
    for (let i = 0; i < 60; i++) {
      const x = Math.sin(i * 3.1) * 900 + i * 0.37, z = Math.cos(i * 1.7) * 900 - i * 0.61;
      const n = clip.build(x, z, -256, -256, cell, levels, -10, 10, null);
      expect(n).toBeLessThanOrEqual(MAX_TILES);
      cover.fill(0);
      const last = levels - 1;
      let minX = Infinity, minZ = Infinity;
      for (let t = 0; t < n; t++) {
        const o = t * TILE_FLOATS, l = clip.tiles[o + 5];
        if (l === last) { minX = Math.min(minX, clip.tiles[o]); minZ = Math.min(minZ, clip.tiles[o + 1]); }
      }
      for (let t = 0; t < n; t++) {
        const o = t * TILE_FLOATS, l = clip.tiles[o + 5], f = 2 ** l;
        const w = clip.tiles[o + 2], h = clip.tiles[o + 3];
        expect(w).toBeLessThanOrEqual(TILE_QUADS);
        expect(h).toBeLessThanOrEqual(TILE_QUADS);
        expect(clip.tiles[o + 4]).toBe(levelSpacing(cell, l));
        const gx = clip.tiles[o] * f - minX * 2 ** last, gz = clip.tiles[o + 1] * f - minZ * 2 ** last;
        for (let zz = gz; zz < gz + h * f; zz++) for (let xx = gx; xx < gx + w * f; xx++) cover[zz * span + xx]++;
      }
      let doubled = 0;
      for (let k = 0; k < cover.length; k++) {
        if (cover[k] < 1 || cover[k] > 2) throw new Error(`cell ${k} covered ${cover[k]} times (frame ${i})`);
        if (cover[k] === 2) doubled++;
      }
      let expected = 0;
      for (let l = 1; l < levels; l++) expected += (32 * 32 - 30 * 30) * 4 ** l;
      expect(doubled).toBe(expected);
    }
  });

  it('uses 64x64 quads for level 0 and 64x64 minus a 30x30 hole for every ring', () => {
    const clip = new Clipmap();
    clip.build(10, 20, 0, 0, 4, 3, 0, 1, null);
    expect(clip.stats.quads).toBe(64 * 64 + 2 * (64 * 64 - 30 * 30));
    expect(clip.stats.tiles).toBeGreaterThanOrEqual(16 + 2 * 12);
  });
});

describe('Frustum culling', () => {
  it('drops tiles behind and beside the camera, keeps the ones ahead', () => {
    const f = new Frustum();
    f.setFromCamera([0, 0, 0], [0, 0, 0, 1], Math.PI / 2, 1, 1);
    expect(f.intersectsBox(-1, -1, -101, 1, 1, -99)).toBe(true);
    expect(f.intersectsBox(-1, -1, 99, 1, 1, 101)).toBe(false);
    expect(f.intersectsBox(150, -1, -101, 152, 1, -99)).toBe(false);
    expect(f.intersectsBox(90, -1, -101, 152, 1, -99)).toBe(true);
    expect(f.intersectsBox(-1, 150, -101, 1, 152, -99)).toBe(false);
  });

  it('follows the camera orientation (yaw of +90 deg looks along -X)', () => {
    const f = new Frustum();
    const s = Math.SQRT1_2;
    f.setFromCamera([0, 0, 0], [0, s, 0, s], Math.PI / 2, 1, 1);
    expect(f.intersectsBox(-101, -1, -1, -99, 1, 1)).toBe(true);
    expect(f.intersectsBox(-1, -1, -101, 1, 1, -99)).toBe(false);
  });

  it('culls tiles in a built clipmap', () => {
    const all = new Clipmap(), cut = new Clipmap();
    const f = new Frustum();
    f.setFromCamera([0, 5, 0], [0, 0, 0, 1], 1.2, 16 / 9);
    const a = all.build(0, 0, -1024, -1024, 4, 5, 0, 50, null);
    const b = cut.build(0, 0, -1024, -1024, 4, 5, 0, 50, f);
    expect(b).toBeLessThan(a);
    expect(cut.stats.culledTiles).toBe(a - b);
  });
});

describe('tile index buffer', () => {
  it('has 16x16 quads split along the (0,0)-(1,1) diagonal', () => {
    const idx = buildTileIndices();
    expect(idx.length).toBe(16 * 16 * 6);
    expect(Array.from(idx.slice(0, 6))).toEqual([0, 1, 18, 0, 18, 17]);
    expect(Math.max(...idx)).toBe(17 * 17 - 1);
  });
});
