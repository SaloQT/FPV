import { describe, expect, it } from 'vitest';
import type { TerrainData, TerrainSampler } from '../contracts';
import { makeTrack } from '../game/testKit';
import { PAD_SIZE, PAD_THICKNESS } from '../render/objects/trackMesh';
import { flatTerrain } from '../sim/testkit';
import { PadGround } from './padGround';

const HALF = PAD_SIZE / 2;
const START = { pos: [10, 4, -20] as [number, number, number], yaw: 0 };

/** Flat 5 m ground with a bump: the pad corner at (+HALF, +HALF) of the start sits on a 0.3 m rise. */
function bumpy(): TerrainSampler {
  const base = flatTerrain(5);
  return {
    ...base,
    heightAt: (x, z) => (x > START.pos[0] + HALF - 0.05 && z > START.pos[2] + HALF - 0.05 && x < START.pos[0] + HALF + 1 && z < START.pos[2] + HALF + 1 ? 5.3 : 5),
    slopeAt: () => 0.4,
    normalAt: (_x, _z, out = [0, 1, 0]) => {
      out[0] = 0.2;
      out[1] = 0.98;
      out[2] = 0;
      return out;
    },
  };
}

describe('PadGround', () => {
  it('is the plain terrain without a track', () => {
    const g = new PadGround(flatTerrain(3), null);
    expect(g.padTop).toBe(-Infinity);
    expect(g.heightAt(10, -20)).toBe(3);
    expect(g.onPad(10, -20)).toBe(false);
    expect(g.slopeAt(10, -20)).toBe(0);
  });

  it('raises the ground by the pad thickness inside the footprint only', () => {
    const g = new PadGround(flatTerrain(5), makeTrack(2, { start: START }));
    expect(g.padTop).toBeCloseTo(5 + PAD_THICKNESS, 12);
    expect(g.heightAt(10, -20)).toBeCloseTo(5 + PAD_THICKNESS, 12);
    expect(g.heightAt(10 + HALF - 0.01, -20 - HALF + 0.01)).toBeCloseTo(5 + PAD_THICKNESS, 12);
    expect(g.heightAt(10 + HALF + 0.05, -20)).toBe(5);
    expect(g.heightAt(10, -20 + HALF + 0.05)).toBe(5);
    expect(g.onPad(10, -20)).toBe(true);
    expect(g.onPad(10 + HALF + 0.05, -20)).toBe(false);
  });

  it('follows the pad yaw', () => {
    const g = new PadGround(flatTerrain(0), makeTrack(1, { start: { pos: [0, 0, 0], yaw: Math.PI / 2 } }));
    // A quarter turn maps the square onto itself.
    expect(g.onPad(HALF - 0.01, HALF - 0.01)).toBe(true);
    expect(g.onPad(HALF + 0.02, 0)).toBe(false);
    // A 45 degree turn puts the corners on the axes: (HALF, HALF) is outside, (0.8, 0) is inside.
    const g45 = new PadGround(flatTerrain(0), makeTrack(1, { start: { pos: [0, 0, 0], yaw: Math.PI / 4 } }));
    expect(g45.onPad(HALF, HALF)).toBe(false);
    expect(g45.onPad(HALF + 0.2, 0)).toBe(true);
    expect(g45.onPad(HALF * Math.SQRT2 + 0.02, 0)).toBe(false);
  });

  it('puts the pad plate above the highest terrain sample under it, like the mesh', () => {
    const g = new PadGround(bumpy(), makeTrack(2, { start: START }));
    expect(g.padTop).toBeCloseTo(5.3 + PAD_THICKNESS, 12);
    // Everywhere on the pad the surface is the same flat plate, even where the terrain is lower.
    expect(g.heightAt(10, -20)).toBeCloseTo(5.3 + PAD_THICKNESS, 12);
    expect(g.heightAt(9.8, -20.2)).toBeCloseTo(5.3 + PAD_THICKNESS, 12);
  });

  it('reports a flat normal and zero slope on the pad and the terrain elsewhere', () => {
    const g = new PadGround(bumpy(), makeTrack(2, { start: START }));
    expect(g.normalAt(10, -20)).toEqual([0, 1, 0]);
    expect(g.slopeAt(10, -20)).toBe(0);
    const out: [number, number, number] = [9, 9, 9];
    expect(g.normalAt(10, -20, out)).toBe(out);
    expect(out).toEqual([0, 1, 0]);
    expect(g.normalAt(50, 50)).toEqual([0.2, 0.98, 0]);
    expect(g.slopeAt(50, 50)).toBe(0.4);
  });

  it('retargets with set() and keeps the handed-out closure valid', () => {
    const g = new PadGround(flatTerrain(0), makeTrack(1, { start: { pos: [0, 0, 0], yaw: 0 } }));
    const fn = g.groundHeightAt;
    expect(fn(0, 0)).toBeCloseTo(PAD_THICKNESS, 12);
    g.set(flatTerrain(8), makeTrack(1, { start: { pos: [100, 0, 100], yaw: 0 } }));
    expect(fn(0, 0)).toBe(8);
    expect(fn(100, 100)).toBeCloseTo(8 + PAD_THICKNESS, 12);
    g.set(flatTerrain(8), null);
    expect(fn(100, 100)).toBe(8);
    expect(g.padTop).toBe(-Infinity);
  });

  it('exposes the data and the raycast of the base terrain', () => {
    const base = flatTerrain(2);
    const g = new PadGround(base, null);
    expect(g.data as TerrainData).toBe(base.data);
    expect(g.raycast([0, 10, 0], [0, -1, 0], 100)?.t).toBeCloseTo(8, 12);
  });
});
