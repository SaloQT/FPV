import { describe, expect, it } from 'vitest';
import { ATLAS_H, ATLAS_MIPS, ATLAS_W, COLOUR_RANGE, TILE, TILES_X, TILES_Y, TILE_COUNT, TILE_SIZE, buildLeafAtlas, buildLeafAtlasSliced, leafColour, tileCoverage, tileRect, type LeafAtlas } from './leafAtlas';

const CUT = 128;
const TONE = [0.06, 0.125, 0.03];
const SLOW = 60000;
let built: LeafAtlas | null = null;
const atlas = (): LeafAtlas => (built ??= buildLeafAtlas());

const coverage = (level: number, tile: number): number => tileCoverage(atlas().colour[level], ATLAS_W >> level, ATLAS_H >> level, tile);

describe('leaf atlas', () => {
  it('is a pair of RGBA8 pyramids down to 4 x 4 texels per tile', () => {
    for (const pyramid of [atlas().colour, atlas().data]) {
      expect(pyramid.length).toBe(ATLAS_MIPS);
      pyramid.forEach((level, l) => expect(level.length).toBe((ATLAS_W >> l) * (ATLAS_H >> l) * 4));
    }
    expect(TILE_SIZE >> (ATLAS_MIPS - 1)).toBe(4);
    expect(ATLAS_W).toBe(TILE_SIZE * TILES_X);
    expect(ATLAS_H).toBe(TILE_SIZE * TILES_Y);
  }, SLOW);

  it('tiles the atlas 3 x 2 with rectangles that cover it exactly', () => {
    expect(TILE_COUNT).toBe(TILES_X * TILES_Y);
    expect(tileRect(TILE.sprig)).toEqual([0, 0, 1 / 3, 0.5]);
    expect(tileRect(TILE.shrub)).toEqual([2 / 3, 0.5, 1, 1]);
    let area = 0;
    for (let t = 0; t < TILE_COUNT; t++) {
      const [u0, v0, u1, v1] = tileRect(t);
      area += (u1 - u0) * (v1 - v0);
    }
    expect(area).toBeCloseTo(1, 9);
  }, SLOW);

  it('leaves the border of every tile empty so bilinear taps never bleed between shapes', () => {
    const base = atlas().colour[0];
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE;
      for (let k = 0; k < TILE_SIZE; k++) {
        for (const [x, y] of [[k, 0], [k, TILE_SIZE - 1], [0, k], [TILE_SIZE - 1, k]]) {
          expect(base[((oy + y) * ATLAS_W + ox + x) * 4 + 3]).toBe(0);
        }
      }
    }
  }, SLOW);

  it('gives every tile a leaf shape that fills a sensible part of it', () => {
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const c = coverage(0, tile);
      expect(c).toBeGreaterThan(0.05);
      expect(c).toBeLessThan(0.85);
    }
  }, SLOW);

  it('paints green leaf colours with real-foliage ratios: green above red above blue on average, some yellow and some dead leaves', () => {
    const data = atlas().colour[0];
    let r = 0, g = 0, b = 0, n = 0, yellow = 0, dead = 0;
    for (const tile of [TILE.sprig, TILE.birch, TILE.blob]) {
      const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE;
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const o = ((oy + y) * ATLAS_W + ox + x) * 4;
          if (data[o + 3] < CUT) continue;
          const lr = data[o] * TONE[0], lg = data[o + 1] * TONE[1], lb = data[o + 2] * TONE[2];
          r += lr; g += lg; b += lb; n++;
          if (lr > lg * 0.9) dead++;
          else if (lr > lg * 0.6) yellow++;
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(g).toBeGreaterThan(r * 1.5);
    expect(r).toBeGreaterThan(b);
    expect(yellow / n).toBeGreaterThan(0.01);
    expect(dead / n).toBeGreaterThan(0.001);
    expect(dead / n).toBeLessThan(0.12);
  }, SLOW);

  it('decodes to colour multipliers around 1, never black or over the range, in every opaque texel', () => {
    for (const level of [0, 2, 4]) {
      const data = atlas().colour[level];
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < CUT) continue;
        const m = ((data[i] + data[i + 1] + data[i + 2]) / 3 / 255) * COLOUR_RANGE;
        expect(m).toBeGreaterThan(0.1);
        sum += m; n++;
      }
      expect(n).toBeGreaterThan(0);
      expect(sum / n).toBeGreaterThan(0.45);
      expect(sum / n).toBeLessThan(1.5);
    }
  }, SLOW);

  it('stores flat-ish tilt, translucency and openness, with veins and stems opaque to light and interiors darker', () => {
    const colour = atlas().colour[0], data = atlas().data[0];
    let thin = 0, thick = 0, open = 0, closed = 0, tiltSpread = 0, n = 0;
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE;
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const o = ((oy + y) * ATLAS_W + ox + x) * 4;
          if (colour[o + 3] < CUT) continue;
          n++;
          tiltSpread += Math.abs(data[o] - 128) + Math.abs(data[o + 1] - 128);
          if (data[o + 2] > 200) thin++; else if (data[o + 2] < 60) thick++;
          if (data[o + 3] > 220) open++; else if (data[o + 3] < 128) closed++;
        }
      }
    }
    expect(thin).toBeGreaterThan(n * 0.2);
    expect(thick).toBeGreaterThan(n * 0.001);
    expect(open).toBeGreaterThan(n * 0.05);
    expect(closed).toBeGreaterThan(n * 0.02);
    expect(tiltSpread / n).toBeGreaterThan(4);
  }, SLOW);

  it('keeps the alpha-tested coverage of every tile through the mips so distant leaves keep their mass', () => {
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const ref = coverage(0, tile);
      for (let level = 1; level <= 4; level++) expect(Math.abs(coverage(level, tile) - ref)).toBeLessThan(0.06);
    }
  }, SLOW);

  it('ramps leaf colour from green through yellow-green to dead brown', () => {
    const c: [number, number, number] = [0, 0, 0];
    leafColour(0, 1, c);
    expect(c[1]).toBeGreaterThanOrEqual(c[0]);
    leafColour(0.35, 1, c);
    expect(c[0] / c[1]).toBeGreaterThan(1.2);
    leafColour(1, 1, c);
    expect(c[0]).toBeGreaterThan(c[1] * 2);
  }, SLOW);

  it('is deterministic', () => {
    const again = buildLeafAtlas();
    const firstDiff = (a: Uint8Array, b: Uint8Array): number => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
    again.colour.forEach((level, l) => expect(firstDiff(level, atlas().colour[l])).toBe(-1));
    again.data.forEach((level, l) => expect(firstDiff(level, atlas().data[l])).toBe(-1));
  }, SLOW);

  it('the time-sliced build yields many times and equals the synchronous atlas', async () => {
    let hops = 0;
    const sliced = await buildLeafAtlasSliced(2, async () => { hops++; });
    expect(hops).toBeGreaterThan(50);
    const same = (a: Uint8Array, b: Uint8Array): boolean => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    sliced.colour.forEach((level, l) => expect(same(level, atlas().colour[l])).toBe(true));
    sliced.data.forEach((level, l) => expect(same(level, atlas().data[l])).toBe(true));
  }, SLOW);
});
