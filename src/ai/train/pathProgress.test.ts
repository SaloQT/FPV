import { describe, expect, it } from 'vitest';
import type { TrackData, TrackGate, Vec3 } from '../../contracts';
import { Rng } from '../../sim/math3d';
import {
  PATH_AHEAD, PATH_GATE_SLACK, PATH_MAX_STEP, arcToGate, gateArc, packPath, pathArc, pathDelta, pathPaid, pathSearch, resamplePath, type PackedPath,
} from './pathProgress';

function gate(index: number, pos: Vec3, yaw: number, extra: Partial<TrackGate> = {}): TrackGate {
  return { index, kind: 'square', pos, yaw, pitch: 0, roll: 0, width: 3, height: 3, ...extra };
}

function track(path: Vec3[], closed: boolean, gates: TrackGate[], start: Vec3 = path[0]): TrackData {
  return { seed: 1, style: 'race', gates, obstacles: [], path, closed, length: 0, start: { pos: start, yaw: 0 }, laps: closed ? 3 : 1 };
}

function circle(r: number, n: number, y = 10): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [r * Math.cos(a), y, r * Math.sin(a)] as Vec3;
  });
}

/** Flies `pts` in order and sums the rewarded progress the way the kernel does: search from the last sample, arc, delta. */
function fly(p: PackedPath, pts: Vec3[]): { total: number; steps: number[] } {
  let idx = pathSearch(p, p.startSample, pts[0]);
  let s = pathArc(p, idx, pts[0]);
  let total = 0;
  const steps: number[] = [];
  for (const q of pts.slice(1)) {
    idx = pathSearch(p, idx, q);
    const s1 = pathArc(p, idx, q);
    const d = pathDelta(p, s, s1);
    steps.push(d);
    total += d;
    s = s1;
  }
  return { total, steps };
}

describe('path resampling', () => {
  it('spaces a closed path evenly and does not repeat its first point', () => {
    const pts = resamplePath(circle(50, 37), true);
    const perimeter = 37 * 2 * 50 * Math.sin(Math.PI / 37);
    expect(pts.length).toBe(Math.round(perimeter));
    const gaps = pts.map((p, i) => Math.hypot(...([0, 1, 2].map((k) => pts[(i + 1) % pts.length][k] - p[k]) as [number, number, number])));
    for (const g of gaps) expect(g).toBeGreaterThan(0.95);
    for (const g of gaps) expect(g).toBeLessThan(1.05);
  });

  it('keeps the true end of an open run', () => {
    const pts = resamplePath([[0, 0, 0], [10.5, 0, 0]], false);
    expect(pts.length).toBe(12);
    expect(pts[10][0]).toBeCloseTo(10);
    expect(pts[11][0]).toBeCloseTo(10.5);
  });

  it('gives no path for fewer than two points or zero length', () => {
    expect(resamplePath([], false)).toEqual([]);
    expect(resamplePath([[1, 2, 3]], true)).toEqual([]);
    expect(packPath(track([[1, 1, 1], [1, 1, 1]], false, [gate(0, [1, 1, 1], 0)])).count).toBe(0);
  });
});

describe('packed path', () => {
  it('stores cumulative arc length and the lap length of a circuit', () => {
    const p = packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)]));
    expect(p.closed).toBe(true);
    for (let i = 1; i < p.count; i++) expect(p.points[i * 4 + 3]).toBeGreaterThan(p.points[(i - 1) * 4 + 3]);
    expect(p.length).toBeCloseTo(2 * Math.PI * 80, 0);
  });

  it('starts a gate spawn on the branch that runs through the gate forwards', () => {
    // Out along +X at 10 m, a half loop up, back along -X at 16 m: the two straights stack 6 m apart. The gate on the way back
    // (travelling -X) sits nearer the way out, which runs through it the wrong way.
    const path: Vec3[] = [];
    for (let x = 0; x <= 60; x += 1) path.push([x, 10, 0]);
    for (let a = 1; a < 30; a++) path.push([60 + 3 * Math.sin((a / 30) * Math.PI), 13 - 3 * Math.cos((a / 30) * Math.PI), 0]);
    for (let x = 60; x >= 0; x -= 1) path.push([x, 16, 0]);
    const g = gate(0, [30, 12.5, 0], Math.PI / 2);
    const p = packPath(track(path, false, [g]));
    const i = p.gateSample[0];
    expect(p.points[i * 4 + 1]).toBeCloseTo(16, 0);
    expect(p.points[i * 4]).toBeCloseTo(30, 0);
  });

  it('starts a pad spawn at the sample nearest the start', () => {
    const p = packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)], [0, 10, 80]));
    const i = p.startSample;
    expect(Math.hypot(p.points[i * 4], p.points[i * 4 + 2] - 80)).toBeLessThan(1);
  });
});

describe('progress along the path', () => {
  it('sums to the lap length over a lap, through the wrap at sample 0', () => {
    const p = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)]));
    // Two laps at 0.4 m per decision, 1.5 m off the line
    const pts: Vec3[] = [];
    const n = Math.round((2 * p.length) / 0.4);
    for (let k = 0; k <= n; k++) {
      const a = 0.3 + (k / n) * 4 * Math.PI;
      pts.push([61.5 * Math.cos(a), 10.5, 61.5 * Math.sin(a)]);
    }
    const { total, steps } = fly(p, pts);
    expect(total).toBeGreaterThan(2 * p.length - 1);
    expect(total).toBeLessThan(2 * p.length + 1);
    for (const d of steps) expect(d).toBeGreaterThan(0);
  });

  it('counts flying backwards as negative progress', () => {
    const p = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)], [60 * Math.cos(1), 10, 60 * Math.sin(1)]));
    const pts: Vec3[] = [];
    for (let k = 0; k <= 200; k++) {
      const a = 1 - k * 0.006;
      pts.push([60 * Math.cos(a), 10, 60 * Math.sin(a)]);
    }
    const { total } = fly(p, pts);
    expect(total).toBeCloseTo(-200 * 0.006 * 60, 0);
  });

  it('follows a loop that passes over itself without jumping branches', () => {
    // A power loop in the X-Y plane: in at y=5, round a 6 m radius circle, out at y=5 again, on to x=80
    const path: Vec3[] = [];
    for (let x = 0; x < 40; x++) path.push([x, 5, 0]);
    for (let a = 0; a < 60; a++) {
      const t = (a / 60) * 2 * Math.PI;
      path.push([40 + 6 * Math.sin(t), 11 - 6 * Math.cos(t), 0.05 * a]);
    }
    for (let x = 40; x <= 80; x++) path.push([x, 5, 3]);
    const p = packPath(track(path, false, [gate(0, [20, 5, 0], -Math.PI / 2)]));
    // Fly the centreline itself at 0.4 m steps
    const dense = resamplePath(path, false, 0.4);
    const { total, steps } = fly(p, dense);
    expect(total).toBeGreaterThan(p.length - 1);
    for (const d of steps) expect(Math.abs(d)).toBeLessThan(1);
  });

  it('clamps one decision to PATH_MAX_STEP and stays within the window', () => {
    const path: Vec3[] = Array.from({ length: 200 }, (_, i) => [i, 5, 0] as Vec3);
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)]));
    const i = pathSearch(p, 0, [150, 5, 0]);
    expect(i).toBe(PATH_AHEAD);
    expect(pathDelta(p, 0, pathArc(p, i, [150, 5, 0]))).toBe(PATH_MAX_STEP);
    expect(pathDelta(p, 30, 0)).toBe(-PATH_MAX_STEP);
  });

  it('projects between samples so progress is smooth', () => {
    const path: Vec3[] = Array.from({ length: 50 }, (_, i) => [i, 5, 0] as Vec3);
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)]));
    const i = pathSearch(p, 10, [12.3, 6, 0.5]);
    expect(pathArc(p, i, [12.3, 6, 0.5])).toBeCloseTo(12.3, 4);
    // The ends clamp: before the first sample and past the last
    expect(pathArc(p, pathSearch(p, 0, [-3, 5, 0]), [-3, 5, 0])).toBe(0);
    expect(pathArc(p, pathSearch(p, 45, [60, 5, 0]), [60, 5, 0])).toBeCloseTo(49, 4);
  });

  it('rewards the take-off leg of an open run from a pad before the first sample', () => {
    // The run starts at the first gate (x = 10, 5 m up); the pad is on the ground 10 m before it
    const path: Vec3[] = Array.from({ length: 51 }, (_, i) => [10 + i, 5, 0] as Vec3);
    const pad: Vec3 = [0, 0, 0];
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)], pad));
    const lead = Math.hypot(10, 5);
    expect(p.startSample).toBe(0);
    expect(Math.abs(p.length - (lead + 50))).toBeLessThan(0.1); // the 1 m resampling cuts the corner at the first gate
    const pts: Vec3[] = [];
    for (let k = 0; k <= 40; k++) pts.push([10 * (k / 40), 0.05 + 4.95 * (k / 40), 0]);
    const { total, steps } = fly(p, pts);
    expect(total).toBeGreaterThan(lead - 0.5);
    for (const d of steps) expect(d).toBeGreaterThan(0);
    // Flying away from the first gate costs progress
    expect(fly(p, [[0, 0.05, 0], [-3, 0.05, 0]]).total).toBeLessThan(0);
  });

  it('adds no lead-in to a circuit or to a run that already starts at the pad', () => {
    const run: Vec3[] = Array.from({ length: 51 }, (_, i) => [i, 5, 0] as Vec3);
    expect(packPath(track(run, false, [gate(0, [10, 5, 0], -Math.PI / 2)], [0.5, 5, 0])).length).toBeCloseTo(50, 3);
    expect(packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)], [0, 0, 0])).length).toBeCloseTo(2 * Math.PI * 80, 0);
  });
});

describe('progress stops paying past the gate due next', () => {
  /**
   * The kernel's path reward over `pts` (env.wgsl stepEnvs): gate 0 due at the start, `passes(prev, pos, next)` says whether a
   * move clears the gate due next. A move that clears one pays in full and measures the arc left from the gate passed.
   */
  function fly(p: PackedPath, pts: Vec3[], passes: (prev: Vec3, pos: Vec3, next: number) => boolean): number {
    const gates = p.gateSample.length;
    let next = 0;
    let idx = pathSearch(p, p.startSample, pts[0]);
    let s = pathArc(p, idx, pts[0]);
    let left = arcToGate(p, next, s);
    let paid = 0;
    for (let k = 1; k < pts.length; k++) {
      let passed = -1;
      if (passes(pts[k - 1], pts[k], next)) {
        passed = next;
        next = (next + 1) % gates;
      }
      idx = pathSearch(p, idx, pts[k]);
      const s1 = pathArc(p, idx, pts[k]);
      const d = pathDelta(p, s, s1);
      if (passed < 0) {
        paid += pathPaid(left, d);
        left -= d;
      } else {
        paid += d;
        left = arcToGate(p, next, s1, passed);
      }
      s = s1;
    }
    return paid;
  }

  /** Points along the x axis through `xs`, 0.4 m apart. */
  function along(xs: number[]): Vec3[] {
    const out: Vec3[] = [[xs[0], 5, 0]];
    for (let k = 1; k < xs.length; k++) {
      const n = Math.ceil(Math.abs(xs[k] - xs[k - 1]) / 0.4);
      for (let j = 1; j <= n; j++) out.push([xs[k - 1] + ((xs[k] - xs[k - 1]) * j) / n, 5, 0]);
    }
    return out;
  }

  // A 300 m run with gates at x = 50, 100, 150 and 280 (an open run finishes at its last gate)
  const GX = [50, 100, 150, 280];
  const line = (): PackedPath => packPath(track(Array.from({ length: 301 }, (_, i) => [i, 5, 0] as Vec3), false,
    GX.map((x, i) => gate(i, [x, 5, 0], -Math.PI / 2))));
  /** Crossing gate `next`'s x forwards clears it, except the first `misses` crossings of gate 0. */
  const crossing = (misses = 0) => {
    let missed = 0;
    return (a: Vec3, b: Vec3, next: number): boolean => {
      if (!(a[0] < GX[next] && b[0] >= GX[next])) return false;
      if (next === 0 && missed < misses) { missed++; return false; }
      return true;
    };
  };

  it('pays the whole run when every gate is cleared', () => {
    expect(fly(line(), along([0, 160]), crossing())).toBeCloseTo(160, 4);
  });

  it('pays nothing for flying on after a miss', () => {
    expect(fly(line(), along([0, 200]), crossing(Infinity))).toBeCloseTo(50 + PATH_GATE_SLACK, 4);
  });

  it('pays for going back through a missed gate and on: the retry is what earns', () => {
    const p = line();
    // Back behind the missed gate, it is down to what it earned getting there
    expect(fly(p, along([0, 80, 30]), crossing(1))).toBeCloseTo(30, 4);
    // Through it the second time and on to the end: the whole run's progress
    expect(fly(p, along([0, 80, 30, 200]), crossing(1))).toBeCloseTo(200, 4);
    // Hanging about past the missed gate pays nothing either way
    expect(fly(p, along([0, 80, 55, 90, 60]), crossing(Infinity))).toBeCloseTo(50 + PATH_GATE_SLACK, 4);
  });

  it('measures the next pass of a one-gate circuit a lap ahead, even when the drone crosses a little before the gate sample', () => {
    const p = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)]));
    const g = gateArc(p, 0);
    expect(arcToGate(p, 0, g - 0.5, 0)).toBeCloseTo(p.length + 0.5, 3);
    expect(arcToGate(p, 0, g + 0.5, 0)).toBeCloseTo(p.length - 0.5, 3);
    // A spawn 1.5 m behind it measures from the drone
    expect(arcToGate(p, 0, g - 1.5)).toBeCloseTo(1.5, 3);
  });

  it('pays every lap of a circuit, one gate or two unevenly spaced', () => {
    const lap = (a0: number, a1: number): Vec3[] => {
      const n = Math.round(((a1 - a0) * 61.5) / 0.4);
      return Array.from({ length: n + 1 }, (_, k) => {
        const a = a0 + ((a1 - a0) * k) / n;
        return [61.5 * Math.cos(a), 10.5, 61.5 * Math.sin(a)] as Vec3;
      });
    };
    const angle = (q: Vec3): number => Math.atan2(q[2], q[0]);
    // Clears gate `next` where the angle crosses its own
    const at = (angles: number[]) => (a: Vec3, b: Vec3, next: number): boolean => {
      const t = angles[next], da = (x: number): number => Math.atan2(Math.sin(x - t), Math.cos(x - t));
      return da(angle(a)) < 0 && da(angle(b)) >= 0;
    };
    const one = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)]));
    expect(fly(one, lap(0.3, 0.3 + 4 * Math.PI), at([0]))).toBeCloseTo(2 * one.length, -1);
    const g1 = 0.2 * 2 * Math.PI;
    const two = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0), gate(1, [60 * Math.cos(g1), 10, 60 * Math.sin(g1)], 0)]));
    expect(fly(two, lap(0.3, 0.3 + 4 * Math.PI), at([0, g1]))).toBeCloseTo(2 * two.length, -1);
  });

  it('pays nothing over any wander that comes back to where it started without a gate', () => {
    const rng = new Rng(3);
    let left = 20, paid = 0, sum = 0;
    const move = (d: number): void => {
      paid += pathPaid(left, d);
      left -= d;
      sum += d;
    };
    for (let k = 0; k < 2000; k++) move(Math.max(-10, Math.min(10, 4 * rng.gauss())));
    while (Math.abs(sum) > 1e-9) move(-Math.sign(sum) * Math.min(5, Math.abs(sum)));
    expect(paid).toBeCloseTo(0, 6);
  });
});
