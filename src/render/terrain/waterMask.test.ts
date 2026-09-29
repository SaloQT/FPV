import { describe, expect, it } from 'vitest';
import { WaterMask } from './waterMask';

const N = 64;
const CELL = 4;
const ORIGIN: [number, number] = [-128, -128];

/** Flat at 20 m with a 3x3 texel pit of 5 m centred on texel (10, 50). */
function makeHeights(): Float32Array {
  const h = new Float32Array(N * N).fill(20);
  for (let j = 49; j <= 51; j++) for (let i = 9; i <= 11; i++) h[j * N + i] = 5;
  return h;
}

const worldX = (i: number): number => ORIGIN[0] + i * CELL;
const worldZ = (j: number): number => ORIGIN[1] + j * CELL;

describe('WaterMask', () => {
  it('is disabled without water or when nothing dips below it', () => {
    expect(new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 20, -Infinity).enabled).toBe(false);
    expect(new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 20, 4).enabled).toBe(false);
    expect(new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 20, 12).enabled).toBe(true);
  });

  it('finds the pit inside the map and rejects dry regions', () => {
    const m = new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 20, 12);
    expect(m.regionBelow(worldX(9), worldZ(49), worldX(11), worldZ(51))).toBe(true);
    expect(m.regionBelow(worldX(30), worldZ(30), worldX(40), worldZ(40))).toBe(false);
    expect(m.regionBelow(worldX(0), worldZ(0), worldX(5), worldZ(5))).toBe(false);
  });

  it('follows the mirrored extension beyond the map border', () => {
    const m = new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 100, 12);
    // Reflecting across z = N - 1 puts a copy of the pit at texel row 2 * 63 - 50 = 76.
    expect(m.regionBelow(worldX(9), worldZ(74), worldX(11), worldZ(78))).toBe(true);
    // Reflecting across x = 0 puts one at texel column -10.
    expect(m.regionBelow(worldX(-12), worldZ(49), worldX(-8), worldZ(51))).toBe(true);
    expect(m.regionBelow(worldX(-30), worldZ(10), worldX(-20), worldZ(20))).toBe(false);
    expect(m.regionBelow(worldX(200), worldZ(200), worldX(210), worldZ(210))).toBe(false);
  });

  it('covers the whole plane for rectangles wider than the mirror period', () => {
    const m = new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 20, 12);
    expect(m.regionBelow(worldX(-500), worldZ(-500), worldX(500), worldZ(500))).toBe(true);
  });

  it('draws water over the far plane when its height is under the water level', () => {
    const wet = new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 10, 12);
    expect(wet.regionBelow(worldX(300), worldZ(300), worldX(310), worldZ(310))).toBe(true);
    const dry = new WaterMask(makeHeights(), N, CELL, ORIGIN, 5, 100, 12);
    expect(dry.regionBelow(worldX(300), worldZ(300), worldX(310), worldZ(310))).toBe(false);
  });
});
