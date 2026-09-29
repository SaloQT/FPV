import { describe, expect, it } from 'vitest';
import { ATLAS_MIPS, ATLAS_SIZE, TILE, TILE_SIZE, buildLeafAtlas, tileRect } from './leafAtlas';

const CUT = 128;
let built: Uint8Array[] | null = null;
const atlas = (): Uint8Array[] => (built ??= buildLeafAtlas());

/** Fraction of a tile's texels at or above the alpha cut, at a mip level. */
function coverage(level: number, tile: number): number {
  const size = ATLAS_SIZE >> level, side = size / 2, ox = (tile & 1) * side, oy = (tile >> 1) * side;
  let n = 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (atlas()[level][((oy + y) * size + ox + x) * 4 + 3] >= CUT) n++;
  return n / (side * side);
}

describe('leaf atlas', () => {
  it('is a 256 x 256 RGBA8 pyramid down to 4 x 4', () => {
    expect(atlas().length).toBe(ATLAS_MIPS);
    atlas().forEach((level, l) => expect(level.length).toBe((ATLAS_SIZE >> l) ** 2 * 4));
    expect(ATLAS_SIZE >> (ATLAS_MIPS - 1)).toBe(4);
  });

  it('tiles the atlas 2 x 2 with rectangles that cover it exactly', () => {
    expect(TILE_SIZE * 2).toBe(ATLAS_SIZE);
    expect(tileRect(TILE.sprig)).toEqual([0, 0, 0.5, 0.5]);
    expect(tileRect(TILE.needles)).toEqual([0.5, 0, 1, 0.5]);
    expect(tileRect(TILE.blob)).toEqual([0, 0.5, 0.5, 1]);
    expect(tileRect(TILE.conifer)).toEqual([0.5, 0.5, 1, 1]);
  });

  it('leaves the border of every tile empty so bilinear taps never bleed between shapes', () => {
    const base = atlas()[0];
    for (let tile = 0; tile < 4; tile++) {
      const ox = (tile & 1) * TILE_SIZE, oy = (tile >> 1) * TILE_SIZE;
      for (let k = 0; k < TILE_SIZE; k++) {
        for (const [x, y] of [[k, 0], [k, TILE_SIZE - 1], [0, k], [TILE_SIZE - 1, k]]) {
          expect(base[((oy + y) * ATLAS_SIZE + ox + x) * 4 + 3]).toBe(0);
        }
      }
    }
  });

  it('gives every tile a leaf shape that fills a sensible part of it, with soft and hard alpha both present', () => {
    for (let tile = 0; tile < 4; tile++) {
      const c = coverage(0, tile);
      expect(c).toBeGreaterThan(0.05);
      expect(c).toBeLessThan(0.85);
    }
    const base = atlas()[0];
    let soft = 0, solid = 0;
    for (let i = 3; i < base.length; i += 4) { if (base[i] > 0 && base[i] < 255) soft++; else if (base[i] === 255) solid++; }
    expect(soft).toBeGreaterThan(500);
    expect(solid).toBeGreaterThan(2000);
  });

  it('shades opaque texels with lit mid-greys and never black, so leaves do not turn into holes', () => {
    for (const level of [0, 2, 4]) {
      const data = atlas()[level];
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(data[i + 1]);
        expect(data[i]).toBe(data[i + 2]);
        if (data[i + 3] >= CUT) { expect(data[i]).toBeGreaterThan(20); sum += data[i]; n++; }
      }
      expect(n).toBeGreaterThan(0);
      expect(sum / n).toBeGreaterThan(90);
      expect(sum / n).toBeLessThan(230);
    }
  });

  it('keeps the alpha-tested coverage of every tile through the mips so distant leaves keep their mass', () => {
    for (let tile = 0; tile < 4; tile++) {
      const ref = coverage(0, tile);
      for (let level = 1; level <= 4; level++) expect(Math.abs(coverage(level, tile) - ref)).toBeLessThan(0.06);
    }
  });

  it('is deterministic', () => {
    const again = buildLeafAtlas();
    again.forEach((level, l) => expect(level).toEqual(atlas()[l]));
  });
});
