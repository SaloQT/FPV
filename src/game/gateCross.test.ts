import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../contracts';
import { fillGateFrame, gateCrossed, gateCrossing, insideOpening, makeGateFrame } from './gateCross';
import { makeGate } from './testKit';

const v = (x: number, y: number, z: number): Vec3 => [x, y, z];

describe('fillGateFrame', () => {
  it('yaw 0 faces -Z with +X to the right', () => {
    const f = fillGateFrame(makeGate(), makeGateFrame());
    expect(f.forward[2]).toBeCloseTo(-1);
    expect(f.right[0]).toBeCloseTo(1);
    expect(f.up[1]).toBeCloseTo(1);
  });

  it('positive yaw turns counter-clockwise from above (toward -X)', () => {
    const f = fillGateFrame(makeGate({ yaw: Math.PI / 2 }), makeGateFrame());
    expect(f.forward[0]).toBeCloseTo(-1);
    expect(f.right[2]).toBeCloseTo(-1);
  });

  it('positive pitch climbs', () => {
    const f = fillGateFrame(makeGate({ pitch: 0.5 }), makeGateFrame());
    expect(f.forward[1]).toBeCloseTo(Math.sin(0.5));
  });

  it('positive roll tips the top toward the right (clockwise from behind)', () => {
    const f = fillGateFrame(makeGate({ roll: Math.PI / 2 }), makeGateFrame());
    expect(f.up[0]).toBeCloseTo(1);
    expect(f.right[1]).toBeCloseTo(-1);
  });

  it('builds an orthonormal right-handed frame for combined angles', () => {
    const f = fillGateFrame(makeGate({ yaw: 0.7, pitch: -0.4, roll: 1.1 }), makeGateFrame());
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(f.right, f.up)).toBeCloseTo(0);
    expect(dot(f.right, f.forward)).toBeCloseTo(0);
    expect(dot(f.up, f.forward)).toBeCloseTo(0);
    expect(dot(f.forward, f.forward)).toBeCloseTo(1);
    const cx = f.right[1] * f.up[2] - f.right[2] * f.up[1];
    const cy = f.right[2] * f.up[0] - f.right[0] * f.up[2];
    const cz = f.right[0] * f.up[1] - f.right[1] * f.up[0];
    expect(cx).toBeCloseTo(-f.forward[0]);
    expect(cy).toBeCloseTo(-f.forward[1]);
    expect(cz).toBeCloseTo(-f.forward[2]);
  });
});

describe('gateCrossed', () => {
  it('passes through the opening in the travel direction', () => {
    expect(gateCrossed(makeGate(), v(0, 2, -8), v(0, 2, -12))).toBe(true);
  });

  it('does not count a pass beside, above or below the opening', () => {
    const g = makeGate();
    expect(gateCrossed(g, v(3, 2, -8), v(3, 2, -12))).toBe(false);
    expect(gateCrossed(g, v(0, 4, -8), v(0, 4, -12))).toBe(false);
    expect(gateCrossed(g, v(0, 0.5, -8), v(0, 0.5, -12))).toBe(false);
  });

  it('does not count flying around the gate', () => {
    const g = makeGate();
    expect(gateCrossed(g, v(-5, 2, -8), v(-5, 2, -9))).toBe(false);
    expect(gateCrossed(g, v(0, 2, -8), v(4, 2, -9.9))).toBe(false);
  });

  it('does not count the wrong direction', () => {
    expect(gateCrossed(makeGate(), v(0, 2, -12), v(0, 2, -8))).toBe(false);
  });

  it('does not count a segment that stops short of the plane', () => {
    expect(gateCrossed(makeGate(), v(0, 2, -8), v(0, 2, -9.9))).toBe(false);
  });

  it('catches a segment much longer than the gate (no tunnelling)', () => {
    expect(gateCrossed(makeGate(), v(0, 2, 90), v(0, 2, -110))).toBe(true);
  });

  it('interpolates the crossing point along an oblique segment', () => {
    const g = makeGate();
    expect(gateCrossed(g, v(-0.8, 2, -8), v(0.8, 2, -12))).toBe(true);
    expect(gateCrossed(g, v(-3, 2, -8), v(-1.5, 2, -12))).toBe(false);
    expect(gateCrossed(g, v(-3, 2, -8), v(3, 2, -12))).toBe(true);
  });

  it('follows the gate heading when yawed', () => {
    const g = makeGate({ pos: [10, 2, 0], yaw: Math.PI / 2 });
    expect(gateCrossed(g, v(12, 2, 0), v(8, 2, 0))).toBe(true);
    expect(gateCrossed(g, v(8, 2, 0), v(12, 2, 0))).toBe(false);
    expect(gateCrossed(g, v(10, 2, 8), v(10, 2, 12))).toBe(false);
  });

  it('a rolled gate turns its opening with it', () => {
    const g = makeGate({ roll: Math.PI / 2, width: 2, height: 1 });
    expect(gateCrossed(g, v(0, 2.9, -8), v(0, 2.9, -12))).toBe(true);
    expect(gateCrossed(g, v(0.9, 2, -8), v(0.9, 2, -12))).toBe(false);
  });

  it('a 45 degree tilt admits the diagonal but not the far corner', () => {
    const g = makeGate({ roll: Math.PI / 4, width: 2, height: 1 });
    const d = 0.9 / Math.SQRT2;
    expect(gateCrossed(g, v(-d, 2 + d, -8), v(-d, 2 + d, -12))).toBe(true);
    expect(gateCrossed(g, v(d, 2 + d, -8), v(d, 2 + d, -12))).toBe(false);
  });

  it('a pitched (dive) gate is crossed along its own axis', () => {
    const g = makeGate({ kind: 'dive', pitch: -Math.PI / 4, width: 2, height: 2 });
    const s = Math.SQRT1_2;
    expect(gateCrossed(g, v(0, 2 + 3 * s, -10 + 3 * s), v(0, 2 - 3 * s, -10 - 3 * s))).toBe(true);
    expect(gateCrossed(g, v(0, 5, -13), v(0, 5, -7))).toBe(false);
  });
});

describe('insideOpening', () => {
  it('hoops are ellipses: the bounding-box corner is outside', () => {
    const hoop = makeGate({ kind: 'hoop', width: 2, height: 2 });
    expect(insideOpening(hoop, 0.7, 0.7)).toBe(true);
    expect(insideOpening(hoop, 0.9, 0.9)).toBe(false);
  });

  it('arches are a rectangle with a round top', () => {
    const arch = makeGate({ kind: 'arch', width: 2, height: 3 });
    expect(insideOpening(arch, 0.95, -1.4)).toBe(true);
    expect(insideOpening(arch, 0, 1.4)).toBe(true);
    expect(insideOpening(arch, 0.9, 1.4)).toBe(false);
    expect(insideOpening(arch, 0, 1.6)).toBe(false);
  });

  it('squares accept the whole rectangle', () => {
    const sq = makeGate();
    expect(insideOpening(sq, 0.99, 0.49)).toBe(true);
    expect(insideOpening(sq, 1.01, 0)).toBe(false);
  });
});

describe('gateCrossing', () => {
  it('returns the fraction along the segment', () => {
    const g = makeGate();
    expect(gateCrossing(g, fillGateFrame(g, makeGateFrame()), v(0, 2, -8), v(0, 2, -12))).toBeCloseTo(0.5);
  });

  it('reports -1 when there is no crossing', () => {
    const g = makeGate();
    expect(gateCrossing(g, fillGateFrame(g, makeGateFrame()), v(0, 2, -12), v(0, 2, -8))).toBe(-1);
  });
});
