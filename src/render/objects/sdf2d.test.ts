import { describe, expect, it } from 'vitest';
import { polygonArea } from './polygon';
import { contourShapes, sdCapsule, sdCircle, sdRoundBox, sdTaperedCapsule, smoothMin, subtract } from './sdf2d';

const BOX = { x0: -0.2, z0: -0.2, x1: 0.2, z1: 0.2 };

describe('sdf2d', () => {
  it('distance functions are signed and zero on the boundary', () => {
    expect(sdCircle(0.1, 0, 0, 0, 0.1)).toBeCloseTo(0, 9);
    expect(sdCircle(0, 0, 0, 0, 0.1)).toBeCloseTo(-0.1, 9);
    expect(sdRoundBox(0.05, 0, 0, 0, 0.05, 0.03, 0.01)).toBeCloseTo(0, 9);
    expect(sdCapsule(0.05, 0.02, 0, 0, 0.1, 0, 0.02)).toBeCloseTo(0, 9);
    expect(sdTaperedCapsule(0, 0.04, 0, 0, 0.2, 0, 0.04, 0.01)).toBeLessThan(1e-9);
    expect(sdTaperedCapsule(0.21, 0, 0, 0, 0.2, 0, 0.04, 0.01)).toBeCloseTo(0, 9);
  });

  it('smoothMin never exceeds the plain union and subtract cuts a hole', () => {
    expect(smoothMin(0.1, 0.11, 0.05)).toBeLessThan(0.1);
    expect(smoothMin(0.1, 1, 0.05)).toBe(0.1);
    expect(subtract(-1, -0.5)).toBe(0.5);
  });

  it('traces a circle to a polygon with the right area', () => {
    const shapes = contourShapes((x, z) => sdCircle(x, z, 0.01, -0.02, 0.1), BOX, 0.004, 0.0004);
    expect(shapes.length).toBe(1);
    expect(shapes[0].holes.length).toBe(0);
    expect(Math.abs(polygonArea(shapes[0].outline))).toBeCloseTo(Math.PI * 0.01, 3);
  });

  it('assigns cut-outs as holes of the plate that contains them', () => {
    const f = (x: number, z: number): number => subtract(sdRoundBox(x, z, 0, 0, 0.15, 0.1, 0.02), Math.min(sdCircle(x, z, -0.06, 0, 0.03), sdCircle(x, z, 0.06, 0, 0.03)));
    const shapes = contourShapes(f, BOX, 0.004, 0.0004);
    expect(shapes.length).toBe(1);
    expect(shapes[0].holes.length).toBe(2);
    const net = Math.abs(polygonArea(shapes[0].outline)) - shapes[0].holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
    expect(net).toBeCloseTo(0.3 * 0.2 - 2 * Math.PI * 0.0009 - 0.0004 * (4 - Math.PI), 3);
  });

  it('keeps separate islands separate', () => {
    const f = (x: number, z: number): number => Math.min(sdCircle(x, z, -0.1, 0, 0.04), sdCircle(x, z, 0.1, 0, 0.04));
    expect(contourShapes(f, BOX, 0.004, 0.0004).length).toBe(2);
  });
});
