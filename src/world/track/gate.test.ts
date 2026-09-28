import { describe, expect, it } from 'vitest';
import type { GateKind, TrackGate, Vec3 } from '../../contracts';
import { Rng } from './rng';
import { gateOutline, gatePassed, insideOpening, trackGateFrame } from './gate';

function gate(over: Partial<TrackGate> = {}): TrackGate {
  return { index: 0, kind: 'square', pos: [10, 6, -20], yaw: 0, roll: 0, pitch: 0, width: 2, height: 2, ...over };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** World point at (u right, v up, w forward) from the gate centre. */
function at(g: TrackGate, u: number, v: number, w: number): Vec3 {
  const f = trackGateFrame(g);
  return [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v + f.forward[k] * w) as Vec3;
}

describe('trackGateFrame', () => {
  it('is orthonormal and right-handed for random yaw, roll and pitch', () => {
    const rng = new Rng(9);
    for (let n = 0; n < 500; n++) {
      const g = gate({ yaw: rng.range(-Math.PI, Math.PI), roll: rng.range(-0.6, 0.6), pitch: rng.range(-1.1, 1.1) });
      const f = trackGateFrame(g);
      expect(Math.hypot(...f.right)).toBeCloseTo(1, 9);
      expect(Math.hypot(...f.up)).toBeCloseTo(1, 9);
      expect(Math.hypot(...f.forward)).toBeCloseTo(1, 9);
      expect(dot(f.right, f.up)).toBeCloseTo(0, 9);
      expect(dot(f.right, f.forward)).toBeCloseTo(0, 9);
      expect(dot(f.up, f.forward)).toBeCloseTo(0, 9);
      const rxu = cross(f.right, f.up);
      for (let k = 0; k < 3; k++) expect(rxu[k]).toBeCloseTo(-f.forward[k], 9);
    }
  });

  it('faces -Z at yaw 0, turns toward -X with positive yaw and climbs with positive pitch', () => {
    const f0 = trackGateFrame(gate());
    expect(f0.forward[2]).toBeCloseTo(-1, 9);
    expect(f0.right[0]).toBeCloseTo(1, 9);
    expect(f0.up[1]).toBeCloseTo(1, 9);
    expect(trackGateFrame(gate({ yaw: Math.PI / 2 })).forward[0]).toBeCloseTo(-1, 9);
    expect(trackGateFrame(gate({ pitch: 0.5 })).forward[1]).toBeGreaterThan(0.45);
  });

  it('rolls clockwise seen from behind: the top moves toward +right', () => {
    const f = trackGateFrame(gate({ roll: 0.4 }));
    expect(f.up[0]).toBeGreaterThan(0.35);
    expect(f.right[1]).toBeLessThan(-0.35);
  });

  it('keeps the right vector horizontal when the gate is only pitched', () => {
    const f = trackGateFrame(gate({ yaw: 1, pitch: -1 }));
    expect(f.right[1]).toBeCloseTo(0, 12);
  });
});

describe('gatePassed', () => {
  const kinds: GateKind[] = ['square', 'arch', 'hoop', 'dive', 'start', 'finish'];

  it('is true when the segment goes through the opening along the travel direction', () => {
    for (const kind of kinds) {
      for (const [yaw, pitch, roll] of [[0, 0, 0], [0.8, 0, 0.3], [-2.4, kind === 'dive' ? -1 : 0, 0], [3, 0.4, -0.5]]) {
        const g = gate({ kind, yaw, pitch, roll, width: 2.4, height: 2 });
        expect(gatePassed(g, at(g, 0.1, 0.1, -3), at(g, 0.1, 0.1, 3))).toBe(true);
        expect(gatePassed(g, at(g, -0.5, -0.4, -0.01), at(g, -0.5, -0.4, 0.01))).toBe(true);
      }
    }
  });

  it('is false when flying backwards through the opening', () => {
    for (const kind of kinds) {
      const g = gate({ kind, yaw: 0.7, roll: 0.2, pitch: kind === 'dive' ? -0.9 : 0 });
      expect(gatePassed(g, at(g, 0, 0, 3), at(g, 0, 0, -3))).toBe(false);
    }
  });

  it('is false when passing beside, above or below the frame', () => {
    const g = gate({ yaw: 1.1, width: 2, height: 2 });
    for (const [u, v] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [5, 5], [1.2, 1.2]]) {
      expect(gatePassed(g, at(g, u, v, -2), at(g, u, v, 2))).toBe(false);
    }
  });

  it('is false when the segment stops short of the plane or starts beyond it', () => {
    const g = gate();
    expect(gatePassed(g, at(g, 0, 0, -3), at(g, 0, 0, -0.5))).toBe(false);
    expect(gatePassed(g, at(g, 0, 0, 0.5), at(g, 0, 0, 3))).toBe(false);
  });

  it('is false when flying around the gate (crossing the plane far outside, then coming back)', () => {
    const g = gate({ yaw: 0.3 });
    const a = at(g, 8, 0, -4);
    const b = at(g, 8, 0, 4);
    expect(gatePassed(g, a, b)).toBe(false);
    expect(gatePassed(g, b, at(g, 0, 0, 4))).toBe(false);
  });

  it('uses the pitched axis: a dive gate is entered along the descent', () => {
    const g = gate({ kind: 'dive', pitch: -1.05, yaw: 0.4, width: 6, height: 6 });
    const f = trackGateFrame(g);
    const from: Vec3 = [g.pos[0] - f.forward[0] * 10, g.pos[1] - f.forward[1] * 10, g.pos[2] - f.forward[2] * 10];
    const to: Vec3 = [g.pos[0] + f.forward[0] * 10, g.pos[1] + f.forward[1] * 10, g.pos[2] + f.forward[2] * 10];
    expect(gatePassed(g, from, to)).toBe(true);
    // Level flight 5 m above the centre crosses the pitched plane ~10 m from the opening.
    const h: Vec3 = [-Math.sin(g.yaw), 0, -Math.cos(g.yaw)];
    const a: Vec3 = [g.pos[0] - h[0] * 10, g.pos[1] + 5, g.pos[2] - h[2] * 10];
    const b: Vec3 = [g.pos[0] + h[0] * 12, g.pos[1] + 5, g.pos[2] + h[2] * 12];
    expect(gatePassed(g, a, b)).toBe(false);
  });
});

describe('opening shapes', () => {
  it('square accepts the whole rectangle, hoop only the ellipse, arch the rectangle plus its round top', () => {
    const sq = gate({ width: 2, height: 2 });
    const hoop = gate({ kind: 'hoop', width: 2, height: 2 });
    const arch = gate({ kind: 'arch', width: 2, height: 3 });
    expect(insideOpening(sq, 0.95, 0.95)).toBe(true);
    expect(insideOpening(hoop, 0.95, 0.95)).toBe(false);
    expect(insideOpening(hoop, 0.6, 0.6)).toBe(true);
    expect(insideOpening(arch, 0.95, -1.4)).toBe(true);
    expect(insideOpening(arch, 0.95, 1.4)).toBe(false);
    expect(insideOpening(arch, 0, 1.49)).toBe(true);
    expect(insideOpening(arch, 0, 1.6)).toBe(false);
  });

  it('outline points all lie inside (or on) the opening', () => {
    for (const kind of ['square', 'arch', 'hoop', 'dive', 'flag'] as GateKind[]) {
      const g = gate({ kind, width: 2.2, height: 2.6 });
      for (const [u, v] of gateOutline(g)) expect(insideOpening(g, u * 0.999, v * 0.999)).toBe(true);
    }
  });
});
